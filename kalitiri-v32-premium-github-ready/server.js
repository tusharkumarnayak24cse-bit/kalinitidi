const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const GAME_VERSION = "3.3.0";
const MIN_CLIENT_VERSION = String(process.env.MIN_CLIENT_VERSION || GAME_VERSION);
const MAINTENANCE_MODE = String(process.env.MAINTENANCE_MODE || "").toLowerCase() === "true";
const MAINTENANCE_MESSAGE = String(process.env.MAINTENANCE_MESSAGE || "Kaali Ni Tidi is receiving a premium update. Please try again shortly.");
const IS_PROD = process.env.NODE_ENV === "production";
const TURN_TIMEOUT_MS = Math.max(10_000, Number(process.env.TURN_TIMEOUT_MS || 60_000));
const BOT_ACTION_DELAY_MS = Math.max(700, Number(process.env.BOT_ACTION_DELAY_MS || 1400));
const TRICK_REVIEW_MS = Math.max(1800, Number(process.env.TRICK_REVIEW_MS || 3800));
const LOBBY_RECONNECT_GRACE_MS = 90_000;
const HOST_REASSIGN_GRACE_MS = 60_000;
const EMPTY_ROOM_TTL_MS = 20 * 60_000;
const ROOM_IDLE_TTL_MS = 4 * 60 * 60_000;
const MAX_ROOMS = Math.max(50, Number(process.env.MAX_ROOMS || 500));
const RECONNECT_GRACE_MS = Math.max(30_000, Number(process.env.RECONNECT_GRACE_MS || 90_000));
const PERSISTENCE_FILE = String(process.env.PERSISTENCE_FILE || "").trim();
const TURN_URL = String(process.env.TURN_URL || "").trim();
const TURN_USERNAME = String(process.env.TURN_USERNAME || "").trim();
const TURN_CREDENTIAL = String(process.env.TURN_CREDENTIAL || "").trim();

const configuredOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean)
);
if (process.env.RENDER_EXTERNAL_URL) configuredOrigins.add(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, ""));

function requestOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === "null") return true;
  if (["capacitor://localhost", "http://localhost", "https://localhost"].includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.host === req.headers.host) return true;
    if (configuredOrigins.has(origin.replace(/\/$/, ""))) return true;
    if (!IS_PROD && ["localhost", "127.0.0.1"].includes(parsed.hostname)) return true;
    if (!configuredOrigins.size && parsed.protocol === "https:" && parsed.hostname.endsWith(".onrender.com")) return true;
  } catch {}
  return false;
}

const io = new Server(server, {
  maxHttpBufferSize: 64 * 1024,
  perMessageDeflate: false,
  cors: { origin: true, methods: ["GET", "POST"], credentials: false },
  allowRequest: (req, callback) => callback(null, requestOriginAllowed(req))
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://three-spades.onrender.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
});
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true, region:REGION_ID }));

app.get("/api/public-config",(_req,res)=>res.json({region:REGION_ID,season:currentSeasonId(),version:GAME_VERSION,minClientVersion:MIN_CLIENT_VERSION,maintenance:MAINTENANCE_MODE,maintenanceMessage:MAINTENANCE_MESSAGE,pushConfigured:Boolean(process.env.FIREBASE_PROJECT_ID),turnConfigured:Boolean(TURN_URL)}));
app.get("/api/room/:code/qr", async (req,res)=>{ try { const code=String(req.params.code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8); if(!code)return res.status(400).send("Invalid room"); const base=String(process.env.PUBLIC_GAME_URL||process.env.RENDER_EXTERNAL_URL||`${req.protocol}://${req.get("host")}`).replace(/\/$/,""); const url=`${base}/?room=${encodeURIComponent(code)}`; const svg=await QRCode.toString(url,{type:"svg",margin:1,width:320,errorCorrectionLevel:"M"}); res.type("image/svg+xml").set("Cache-Control","no-store").send(svg); } catch(e){res.status(500).send("QR unavailable");} });
app.get("/api/admin/overview",(req,res)=>{if(!adminAllowed(req))return res.status(401).json({ok:false});res.json({ok:true,region:REGION_ID,analytics,rooms:rooms.size,users:users.size,rankedQueued:[...rankedQueues.values()].reduce((a,q)=>a+q.length,0),reports:reports.slice(-50),errors:clientErrors.slice(-50),usersList:[...users.values()].slice(-100).map(u=>({id:u.id,username:u.username,displayName:u.displayName,bannedUntil:u.bannedUntil||null})),tournaments:[...tournaments.values()].map(tournamentPublic)});});
app.post("/api/admin/room/:code/close",express.json({limit:"8kb"}),(req,res)=>{if(!adminAllowed(req))return res.status(401).json({ok:false});const r=rooms.get(String(req.params.code||"").toUpperCase());if(!r)return res.status(404).json({ok:false});destroyRoom(r,"admin-closed");res.json({ok:true});});
app.post("/api/admin/user/:id/ban",express.json({limit:"8kb"}),(req,res)=>{if(!adminAllowed(req))return res.status(401).json({ok:false});const u=users.get(String(req.params.id||""));if(!u)return res.status(404).json({ok:false});const hours=Math.max(1,Math.min(24*365,Number(req.body?.hours||24)));u.bannedUntil=Date.now()+hours*3600000;u.banReason=String(req.body?.reason||"Moderator action").slice(0,120);persistAccountsSoon();for(const sock of io.sockets.sockets.values())if(sock.data?.userId===u.id){sock.emit("accountBanned",{until:u.bannedUntil,reason:u.banReason});sock.disconnect(true);}res.json({ok:true,bannedUntil:u.bannedUntil});});

app.use(express.static(path.join(__dirname, "public"), { maxAge: IS_PROD ? "1h" : 0, etag: true }));

const rooms = new Map();
const rateBuckets = new Map();
const leaderboard = new Map();
const reports = [];
const users = new Map();
const accountSessions = new Map();
const rankedQueues = new Map();
const replays = [];
const tournaments = new Map();
const clientErrors = [];
const analytics = { startedAt:Date.now(), connections:0, roomsCreated:0, roundsCompleted:0, rankedMatches:0, reports:0, clientErrors:0 };
const ACCOUNTS_FILE = String(process.env.ACCOUNTS_FILE || (PERSISTENCE_FILE ? path.join(path.dirname(PERSISTENCE_FILE), "kalitiri-accounts.json") : "")).trim();
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const REGION_ID = String(process.env.REGION_ID || process.env.RENDER_REGION || "local").trim();
const SPECTATOR_DELAY_MS = Math.max(0, Number(process.env.SPECTATOR_DELAY_MS || 5000));
const PRIVATE_TURN_OPTIONS = new Set([30_000,45_000,60_000,90_000]);
const PRIVATE_SPECTATOR_OPTIONS = new Set([0,5_000,10_000]);
const SERIES_OPTIONS = new Set([1,3,5]);
const ROOM_THEMES = new Set(["classic","dark","royal","red"]);
function normalizeTurnTimeoutMs(v){ const n=Number(v); return PRIVATE_TURN_OPTIONS.has(n)?n:TURN_TIMEOUT_MS; }
function normalizeSpectatorDelayMs(v){ const n=Number(v); return PRIVATE_SPECTATOR_OPTIONS.has(n)?n:SPECTATOR_DELAY_MS; }
function normalizeSeriesBestOf(v){ const n=Number(v); return SERIES_OPTIONS.has(n)?n:1; }
function fixedTeamsEligible(playerCount){ return [4,6,8].includes(Number(playerCount)); }
function normalizeTeamMode(v, playerCount){ return String(v)==="fixed" && fixedTeamsEligible(playerCount) ? "fixed" : "random"; }
function normalizeRoomTheme(v){ return ROOM_THEMES.has(String(v)) ? String(v) : "classic"; }
let persistTimer = null;
let accountsPersistTimer = null;


function normalizeUsername(v) { return String(v || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0,20); }
function publicUser(u) {
  if (!u) return null;
  const season = currentSeasonId();
  const ss = u.seasons?.[season] || { rating:1000, games:0, wins:0 };
  const xp=Number(u.xp||0), level=levelFromXp(xp), floor=xpFloorForLevel(level), next=xpFloorForLevel(level+1);
  return { id:u.id, username:u.username, displayName:u.displayName, avatar:u.avatar, createdAt:u.createdAt,
    stats:u.stats || {}, rating:ss.rating || 1000, rank:rankTier(ss.rating||1000), xp, level, xpFloor:floor, xpNext:next, season, seasonStats:ss,
    achievements:u.achievements || [], friends:u.friends || [], settings:u.settings || {}, challenges:getDailyChallenges(u), weeklyChallenges:getWeeklyChallenges(u) };
}
function currentSeasonId() { const d=new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`; }
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, u) {
  try { const a=Buffer.from(hashPassword(password,u.salt).hash,"hex"), b=Buffer.from(u.passwordHash,"hex"); return a.length===b.length && crypto.timingSafeEqual(a,b); } catch { return false; }
}
function persistAccountsSoon() {
  if (!ACCOUNTS_FILE) return;
  clearTimeout(accountsPersistTimer);
  accountsPersistTimer=setTimeout(()=>{ try {
    fs.mkdirSync(path.dirname(ACCOUNTS_FILE),{recursive:true});
    const tmp=`${ACCOUNTS_FILE}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify({version:1,savedAt:Date.now(),users:[...users.values()],replays:replays.slice(-500),tournaments:[...tournaments.values()]}));
    fs.renameSync(tmp,ACCOUNTS_FILE);
  } catch(e){ console.error("Account persistence failed:",e.message); } },250);
  accountsPersistTimer.unref?.();
}
function restoreAccounts() {
  if (!ACCOUNTS_FILE || !fs.existsSync(ACCOUNTS_FILE)) return;
  try { const raw=JSON.parse(fs.readFileSync(ACCOUNTS_FILE,"utf8"));
    for(const u of raw.users||[]) if(u?.id&&u?.username) users.set(u.id,u);
    for(const r of raw.replays||[]) replays.push(r);
    for(const t of raw.tournaments||[]) if(t?.id) tournaments.set(t.id,t);
    console.log(`Restored ${users.size} account(s).`);
  } catch(e){ console.error("Account restore failed:",e.message); }
}
function findUserByUsername(username) { const n=normalizeUsername(username); return [...users.values()].find(u=>u.username===n) || null; }
function issueSession(userId) { const token=crypto.randomBytes(32).toString("hex"); accountSessions.set(token,{userId,createdAt:Date.now()}); return token; }
function userForSocket(socket) { return socket.data?.userId ? users.get(socket.data.userId) : null; }
function ensureSeason(u) { const id=currentSeasonId(); u.seasons ||= {}; u.seasons[id] ||= {rating:1000,games:0,wins:0,points:0}; return u.seasons[id]; }
function rankTier(rating=1000){ const r=Number(rating||1000); if(r>=1900)return "Master"; if(r>=1650)return "Diamond"; if(r>=1450)return "Platinum"; if(r>=1250)return "Gold"; if(r>=1050)return "Silver"; return "Bronze"; }
function levelFromXp(xp=0){ return Math.max(1,Math.floor(Math.sqrt(Math.max(0,Number(xp||0))/120))+1); }
function xpFloorForLevel(level){ return Math.max(0,Math.pow(Math.max(0,Number(level||1)-1),2)*120); }
function getWeeklyChallenges(u){ const d=new Date(),start=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-((d.getUTCDay()+6)%7))); const week=start.toISOString().slice(0,10);u.weekly||={};if(u.weekly.week!==week)u.weekly={week,wins:0,rounds:0,contracts:0,points:0};return [{id:"weekly5",label:"Win 5 rounds",goal:5,value:u.weekly.wins||0},{id:"weekly10",label:"Play 10 rounds",goal:10,value:u.weekly.rounds||0},{id:"weeklyContract",label:"Make 3 contracts",goal:3,value:u.weekly.contracts||0}].map(x=>({...x,done:x.value>=x.goal})); }
function unlockAchievement(u,id,label) { u.achievements ||= []; if(!u.achievements.some(a=>a.id===id)) u.achievements.push({id,label,unlockedAt:Date.now()}); }
function dailySeed() { return Math.floor(Date.now()/86400000); }
function getDailyChallenges(u) {
  const day=new Date().toISOString().slice(0,10); u.daily ||= {};
  if(u.daily.day!==day) u.daily={day,wins:0,rounds:0,points:0};
  const variants=[
    [{id:"play2",label:"Play 2 rounds",goal:2,value:u.daily.rounds||0},{id:"win1",label:"Win 1 round",goal:1,value:u.daily.wins||0}],
    [{id:"points300",label:"Earn 300 award points",goal:300,value:u.daily.points||0},{id:"play3",label:"Play 3 rounds",goal:3,value:u.daily.rounds||0}],
    [{id:"win2",label:"Win 2 rounds",goal:2,value:u.daily.wins||0},{id:"points500",label:"Earn 500 award points",goal:500,value:u.daily.points||0}]
  ]; return variants[dailySeed()%variants.length].map(x=>({...x,done:x.value>=x.goal}));
}
function updateCloudRoundStats(room, i, won) {
  const p=room.players[i]; if(!p?.accountId) return;
  const u=users.get(p.accountId); if(!u) return;
  u.stats ||= {rounds:0,wins:0,losses:0,points:0,tricksWon:0,highestBid:0,contractsMade:0,contractsFailed:0};
  u.stats.rounds++; won?u.stats.wins++:u.stats.losses++; u.stats.points += Number(p.lastAward||0);
  if(i===room.bid.bidderIndex){ u.stats.highestBid=Math.max(u.stats.highestBid||0,Number(room.bid.current||0)); if(room.roundSummary?.made)u.stats.contractsMade++;else u.stats.contractsFailed++; }
  const xpGain=30+(won?45:10)+Math.min(40,Math.floor(Number(p.roundPoints||0)/10));u.xp=Number(u.xp||0)+xpGain;u.lastXpGain=xpGain;
  u.daily ||= {}; getDailyChallenges(u); u.daily.rounds++; if(won)u.daily.wins++; u.daily.points+=Number(p.lastAward||0);
  getWeeklyChallenges(u);u.weekly.rounds++;if(won)u.weekly.wins++;u.weekly.points+=Number(p.lastAward||0);if(i===room.bid.bidderIndex&&room.roundSummary?.made)u.weekly.contracts++;
  if(u.stats.wins>=1)unlockAchievement(u,"first_win","First Victory");
  if(u.stats.wins>=10)unlockAchievement(u,"ten_wins","Ten Victories");
  if((u.stats.tricksWon||0)>=100)unlockAchievement(u,"hundred_tricks","100 Tricks Won");
  if((u.stats.highestBid||0)>=500)unlockAchievement(u,"max_bid","Maximum Bidder");
  const ss=ensureSeason(u); ss.games++; if(won)ss.wins++; ss.points+=Number(p.lastAward||0);
}
function updateRatings(room, winners) {
  if(!room.ranked)return; const ids=room.players.map(p=>p.accountId).filter(Boolean); if(ids.length<2)return;
  const winnerIds=new Set(winners.map(i=>room.players[i]?.accountId).filter(Boolean));
  const avg=ids.reduce((a,id)=>a+(ensureSeason(users.get(id)).rating||1000),0)/ids.length;
  for(const id of ids){ const u=users.get(id); if(!u)continue; const ss=ensureSeason(u); const expected=1/(1+10**((avg-ss.rating)/400)); const score=winnerIds.has(id)?1:0; ss.rating=Math.max(100,Math.round(ss.rating+24*(score-expected))); }
  analytics.rankedMatches++;
}
function storeReplay(room, bidderPoints, defensePoints, made) {
  const replay={id:crypto.randomBytes(8).toString("hex"),createdAt:Date.now(),code:room.code,round:room.round,playerCount:room.playerCount,ranked:Boolean(room.ranked),deckCount:roomDeckCount(room),
    auditId:room.auditId||null, integrity:{...(room.integrity||{})},
    players:room.players.map(p=>({name:p.name,avatar:p.avatar,accountId:p.accountId||null,team:p.team,score:p.score,lastAward:p.lastAward,roundPoints:p.roundPoints||0})),bid:room.bid.current,trump:room.trump,bidderIndex:room.bid.bidderIndex,bidderPoints,defensePoints,made,
    mvpIndex:room.roundSummary?.mvpIndex??null, events:(room.replayEvents||[]).slice(-400)};
  replays.push(replay); if(replays.length>500)replays.shift(); room.lastReplayId=replay.id; persistAccountsSoon(); return replay;
}
function recordReplayEvent(room,type,data={}) { room.replayEvents ||= []; room.replayEvents.push({t:Date.now(),type,...data}); if(room.replayEvents.length>300)room.replayEvents.shift(); }
function removeFromRankedQueue(socketId){ for(const [key,q] of rankedQueues){ const n=q.filter(x=>x.socketId!==socketId); if(n.length)rankedQueues.set(key,n); else rankedQueues.delete(key); } }
function rankedQueueKey(playerCount, deckCount = deckCountFor(playerCount), rating=1000){ const band=Math.floor(Number(rating||1000)/250); return `${currentSeasonId()}:${playerCount}:${deckCount}:${band}`; }
function checkRankedQueue(playerCount, deckCount = deckCountFor(playerCount), rating=1000){ const key=rankedQueueKey(playerCount, deckCount, rating), q=rankedQueues.get(key)||[]; const live=q.filter(x=>io.sockets.sockets.has(x.socketId)); rankedQueues.set(key,live); if(live.length<playerCount)return;
  const group=live.splice(0,playerCount); rankedQueues.set(key,live); const hostSocket=io.sockets.sockets.get(group[0].socketId); if(!hostSocket)return;
  const firstUser=users.get(group[0].userId), code=roomCode(); const room=createRoomState(code,hostSocket.id,firstUser.displayName,firstUser.avatar,playerCount,firstUser.id,deckCount);
  room.ranked=true; room.isPublic=false; room.matchConfirmation=true; room.turnTimeoutMs=60_000; room.spectatorDelayMs=SPECTATOR_DELAY_MS; room.players=[]; room.botDifficulty="hard"; room.replayEvents=[];
  for(const item of group){ const sock=io.sockets.sockets.get(item.socketId), u=users.get(item.userId); if(!sock||!u)continue; const pl=makeHumanPlayer(sock.id,u.displayName,u.avatar,u.id); pl.rankedConfirmed=false; room.players.push(pl); sock.join(code); sock.emit("rankedMatched",{code,reconnectToken:pl.reconnectToken,playerCount,deckCount,season:currentSeasonId()}); }
  room.hostPlayerToken=room.players[0]?.reconnectToken||null; room.hostSocket=room.players[0]?.id||null; rooms.set(code,room); analytics.roomsCreated++; emitRoom(room);
}
function tournamentPublic(t){ return {id:t.id,name:t.name,size:t.size,status:t.status,entrants:t.entrants?.map(id=>{const u=users.get(id);return u?{id,name:u.displayName,avatar:u.avatar}:null}).filter(Boolean)||[],round:t.round||0,champion:t.champion||null,champions:t.champions||[]}; }
function maybeStartTournament(t){ if(t.status!=="open"||t.entrants.length<t.size)return; t.status="active"; t.round=1; t.activeRooms=[]; createTournamentStage(t,t.entrants.slice()); }
function createTournamentStage(t, entrants){ t.stageEntrants=entrants.slice(); t.stageWinners=[]; t.activeRooms=[]; for(let a=0;a<entrants.length;a+=4){ const ids=entrants.slice(a,a+4); if(ids.length<4){t.stageWinners.push(...ids);continue;} const connected=ids.map(id=>[...io.sockets.sockets.values()].find(s=>s.data?.userId===id)); if(connected.some(x=>!x)){ t.stageWinners.push(...ids.slice(0,2)); continue; }
    const u0=users.get(ids[0]), code=roomCode(), room=createRoomState(code,connected[0].id,u0.displayName,u0.avatar,4,u0.id); room.players=[]; room.tournamentId=t.id; room.tournamentRound=t.round; room.isPublic=false; room.botDifficulty="hard"; room.turnTimeoutMs=60_000; room.spectatorDelayMs=SPECTATOR_DELAY_MS; room.replayEvents=[];
    ids.forEach((id,k)=>{const u=users.get(id),sock=connected[k],pl=makeHumanPlayer(sock.id,u.displayName,u.avatar,u.id);pl.ready=true;room.players.push(pl);sock.join(code);sock.emit("tournamentMatch",{tournamentId:t.id,code,reconnectToken:pl.reconnectToken,round:t.round});}); room.hostPlayerToken=room.players[0].reconnectToken; room.hostSocket=room.players[0].id; rooms.set(code,room);t.activeRooms.push(code);setTimeout(()=>startRound(room),800);
  } persistAccountsSoon(); }
function advanceTournamentRoom(room,winnerIndexes){ const t=tournaments.get(room.tournamentId); if(!t||t.status!=="active")return; const wins=winnerIndexes.map(i=>room.players[i]?.accountId).filter(Boolean); t.stageWinners.push(...wins); t.activeRooms=t.activeRooms.filter(c=>c!==room.code); if(t.activeRooms.length)return; const uniq=[...new Set(t.stageWinners)]; if(uniq.length<=1){t.status="complete";t.champion=uniq[0]||null;t.champions=uniq;persistAccountsSoon();return;} if(uniq.length<4){t.status="complete";t.champion=uniq[0]||null;t.champions=uniq;persistAccountsSoon();return;} t.round++; createTournamentStage(t,uniq); }
function adminAllowed(req){ return ADMIN_KEY && String(req.headers["x-admin-key"]||req.query.key||"")===ADMIN_KEY; }

function safeRoomSnapshot(room) {
  const copy = { ...room };
  delete copy.actionTimer; delete copy.lobbyEvictionTimer; delete copy.hostReassignTimer;
  copy.spectators = [];
  copy.players = room.players.map(p => {
    const q = { ...p };
    delete q.disconnectTimer;
    return q;
  });
  copy.actionKey = null;
  copy.actionDeadline = null;
  return copy;
}
function persistRoomsSoon() {
  if (!PERSISTENCE_FILE) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(PERSISTENCE_FILE), { recursive:true });
      const payload = {
        version: 1,
        savedAt: Date.now(),
        rooms: [...rooms.values()].map(safeRoomSnapshot),
        leaderboard: [...leaderboard.entries()]
      };
      const tmp = `${PERSISTENCE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, PERSISTENCE_FILE);
    } catch (err) {
      console.error("Persistence write failed:", err.message);
    }
  }, 250);
  persistTimer.unref?.();
}
function restorePersistentState() {
  if (!PERSISTENCE_FILE || !fs.existsSync(PERSISTENCE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(PERSISTENCE_FILE, "utf8"));
    for (const [k,v] of raw.leaderboard || []) leaderboard.set(k,v);
    for (const saved of raw.rooms || []) {
      if (!saved?.code || !Array.isArray(saved.players)) continue;
      saved.spectators = new Map();
      saved.deckCount = deckCountFor(saved.playerCount, saved.deckCount);
      saved.actionTimer = null; saved.lobbyEvictionTimer = null; saved.hostReassignTimer = null;
      saved.actionKey = null; saved.actionDeadline = null;
      saved.bidHistory ||= []; saved.trickHistory ||= []; saved.scoreLedger ||= []; saved.integrity ||= {deckVerified:false,scoreVerified:true};
      saved.turnTimeoutMs = normalizeTurnTimeoutMs(saved.turnTimeoutMs); saved.spectatorDelayMs = normalizeSpectatorDelayMs(saved.spectatorDelayMs);
      saved.preset ||= "classic";
      saved.voiceEnabled = saved.voiceEnabled !== false;
      saved.spectatorsEnabled = saved.spectatorsEnabled !== false;
      saved.tableTheme = normalizeRoomTheme(saved.tableTheme);
      saved.seriesBestOf = normalizeSeriesBestOf(saved.seriesBestOf);
      saved.teamMode = normalizeTeamMode(saved.teamMode, saved.playerCount);
      saved.fixedTeams = saved.fixedTeams && fixedTeamsEligible(saved.playerCount) ? saved.fixedTeams : null;
      saved.series ||= {bestOf:saved.seriesBestOf,targetWins:saved.seriesBestOf>1?Math.ceil(saved.seriesBestOf/2):0,winsA:0,winsB:0,complete:false,winner:null,results:[],teamAIndexes:[],teamBIndexes:[]};
      // If the server restarted during the post-trick review pause, resume from the next trick.
      if (saved.trickResolving) { saved.trickResolving = false; saved.trickReviewUntil = null; saved.trick = []; saved.leadSuit = null; }
      saved.emptySince = Date.now();
      saved.players.forEach((pl, i) => {
        pl.voiceJoined = false; pl.voiceMuted = false;
        if (!pl.bot) {
          pl.connected = false;
          pl.autoControlled = saved.phase !== "lobby";
          pl.id = `restored-${saved.code}-${i}`;
          pl.reconnectUntil = Date.now() + RECONNECT_GRACE_MS;
        }
      });
      // Never restore a bot-only match. A room must always have at least one real player seat.
      if (!saved.players.some(pl => !pl.bot)) continue;
      rooms.set(saved.code, saved);
    }
    console.log(`Restored ${rooms.size} room(s) from persistence.`);
  } catch (err) {
    console.error("Persistence restore failed:", err.message);
  }
}

const SUITS = ["S", "H", "D", "C"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

function makeReconnectToken() { return crypto.randomBytes(24).toString("hex"); }
function touchRoom(room) { room.lastActivityAt = Date.now(); persistRoomsSoon(); }
function rateKey(socket, scope, action) { return `${scope === "ip" ? (socket.handshake.address || "unknown") : socket.id}:${action}`; }
function takeRate(socket, action, limit, windowMs, scope = "socket") {
  const key = rateKey(socket, scope, action), now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) { bucket = { startedAt: now, count: 0 }; rateBuckets.set(key, bucket); }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
function rejectRate(ack, message = "Too many requests. Please wait a moment.") { ack?.({ ok:false, error:message }); }
function connectedHumans(room) { return room.players.filter(p => !p.bot && p.connected); }
function humanSeats(room) { return room.players.filter(p => !p.bot); }
function hasReconnectableHuman(room, exceptIndex = -1) {
  const now = Date.now();
  return room.players.some((p, i) => i !== exceptIndex && !p.bot && !p.connected && p.reconnectToken && Number(p.reconnectUntil || 0) > now);
}
function destroyRoom(room, reason = "expired") {
  clearTimeout(room.actionTimer); clearTimeout(room.lobbyEvictionTimer); clearTimeout(room.hostReassignTimer);
  room.players?.forEach(p => clearTimeout(p.disconnectTimer));
  rooms.delete(room.code); io.to(room.code).emit("roomClosed", { reason }); persistRoomsSoon();
  for (const liveSocket of io.sockets.sockets.values()) if (liveSocket.rooms.has(room.code)) liveSocket.leave(room.code);
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += alphabet[crypto.randomInt(0, alphabet.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || "").replace(/[<>]/g, "").trim().slice(0, 18) || "Player";
}

function cleanAvatar(avatar) {
  const allowed = ["😎","🧔","👨","👩","🧑","🦁","🐯","🦊","🐼","🐺","🦅","👑"];
  return allowed.includes(String(avatar)) ? String(avatar) : "😎";
}

function cleanChat(text) {
  return String(text || "").replace(/[<>]/g, "").trim().slice(0, 180);
}

function deckCountFor(playerCount, requestedDeckCount = null) {
  // v21: 4-player rooms may explicitly choose one or two full decks.
  // 3-player remains one reduced deck; 5–8-player tables remain two decks.
  if (playerCount === 4 && Number(requestedDeckCount) === 2) return 2;
  return playerCount > 4 ? 2 : 1;
}

function roomDeckCount(room) {
  return deckCountFor(room.playerCount, room.deckCount);
}

function ranksFor(playerCount) {
  // Custom odd-player modes remove only zero-point ranks so every player receives
  // the same number of cards and the full scoring total stays in play.
  if (playerCount === 3) return RANKS.filter(r => r !== "2");                  // 48 cards = 16 each (1 deck)
  if (playerCount === 5) return RANKS.filter(r => !["2","4","6"].includes(r)); // 80 cards = 16 each (2 decks)
  if (playerCount === 6) return RANKS.filter(r => r !== "2");                  // 96 cards = 16 each (2 decks)
  if (playerCount === 7) return ["3","5","10","J","Q","K","A"];               // 56 cards = 8 each (2 decks)
  return RANKS;                                                                  // 4P=52, 8P=104
}

function makeDeck(room) {
  const cards = [];
  const copies = roomDeckCount(room);
  const ranks = ranksFor(room.playerCount);
  for (let copy = 1; copy <= copies; copy++) {
    for (const suit of SUITS) {
      for (const rank of ranks) {
        cards.push({ suit, rank, copy, id: `${copy}-${suit}-${rank}` });
      }
    }
  }
  return shuffle(cards);
}

function shuffle(cards) {
  // v22 fair-play: Fisher–Yates with Node's cryptographically secure RNG.
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function expectedDeckIds(room) {
  const ids=[];
  for(let copy=1;copy<=roomDeckCount(room);copy++) for(const suit of SUITS) for(const rank of ranksFor(room.playerCount)) ids.push(`${copy}-${suit}-${rank}`);
  return ids;
}
function verifyDeckIntegrity(room, cards) {
  const expected=expectedDeckIds(room), actual=(cards||[]).map(c=>c.id);
  const ok=actual.length===expected.length && new Set(actual).size===actual.length && expected.every(id=>actual.includes(id));
  room.integrity ||= {}; room.integrity.deckVerified=ok; room.integrity.deckCheckedAt=Date.now();
  return ok;
}
function verifyScoreIntegrity(room, finalCheck = false) {
  const total=totalPointsFor(room);
  const audited=(room.trickHistory||[]).reduce((sum,t)=>sum+Number(t.points||0),0);
  let scored=room.players.reduce((sum,p)=>sum+Number(p.roundPoints||0),0);
  let ok=scored===audited && (finalCheck ? scored===total : scored<=total);
  let recovered=false;

  // If a transient state mismatch is detected, rebuild per-player round points from
  // the server's audited trick history instead of allowing the match to crash/drift.
  if(!ok && audited<=total){
    const rebuilt=room.players.map(()=>0);
    for(const trick of (room.trickHistory||[])){
      const wi=Number(trick.winnerIndex);
      if(Number.isInteger(wi)&&wi>=0&&wi<rebuilt.length) rebuilt[wi]+=Number(trick.points||0);
    }
    room.players.forEach((p,i)=>{p.roundPoints=rebuilt[i];});
    scored=rebuilt.reduce((a,b)=>a+b,0);
    ok=scored===audited && (finalCheck ? scored===total : scored<=total);
    recovered=ok;
    if(recovered) addLog(room, "Score state was safely rebuilt from the audited trick history.");
  }

  room.integrity ||= {};
  room.integrity.scoreVerified=ok;
  room.integrity.scoreRecovered=Boolean(room.integrity.scoreRecovered||recovered);
  room.integrity.scoreCheckedAt=Date.now();
  room.integrity.scoredPoints=scored;
  room.integrity.expectedPoints=finalCheck?total:null;
  if(!ok) console.error(`SCORE_INTEGRITY_FAIL ${room.auditId||room.code}: scored=${scored} audited=${audited} total=${total} final=${finalCheck}`);
  return ok;
}
function ruleSummaryFor(room) {
  const d=roomDeckCount(room), cards=totalTricksFor(room), min=minBidFor(room), max=maxBidFor(room);
  const series=Number(room.seriesBestOf||1)>1?` · Bo${room.seriesBestOf}`:"";
  const teams=room.teamMode==="fixed"?" · Fixed teams":"";
  return `${room.playerCount}P · ${d} deck${d===2?"s":""} · ${cards} cards each · ${totalPointsFor(room)} pts · Bid ${min}–${max}${series}${teams}`;
}

function cardPoints(card) {
  if (card.suit === "S" && card.rank === "3") return 30;
  if (["10","J","Q","K","A"].includes(card.rank)) return 10;
  if (card.rank === "5") return 5;
  return 0;
}

function scoringCardsCapturedBy(room, teamIndexes) {
  const team = new Set(teamIndexes || []);
  const cards = [];
  for (const trick of (room.trickHistory || [])) {
    if (!team.has(Number(trick.winnerIndex))) continue;
    for (const play of (trick.cards || [])) {
      const pts = cardPoints(play.card);
      if (!pts) continue;
      cards.push({
        ...publicCard(play.card),
        points: pts,
        playedByIndex: Number(play.playerIndex),
        capturedInTrick: Number(trick.number || 0),
        capturedByIndex: Number(trick.winnerIndex)
      });
    }
  }
  return cards;
}

function scoringBreakdown(cards) {
  const groups = [
    ["3♠", c => c.suit === "S" && c.rank === "3", 30],
    ["A", c => c.rank === "A", 10],
    ["K", c => c.rank === "K", 10],
    ["Q", c => c.rank === "Q", 10],
    ["J", c => c.rank === "J", 10],
    ["10", c => c.rank === "10", 10],
    ["5", c => c.rank === "5", 5]
  ];
  return groups.map(([label, test, each]) => {
    const count = (cards || []).filter(test).length;
    return { label, each, count, total: count * each };
  }).filter(x => x.count > 0);
}

function publicCard(card) {
  return { suit: card.suit, rank: card.rank, copy: card.copy, id: card.id };
}

function cardLabel(card) {
  const copyLabel = deckCountForCard(card) > 1 ? ` · Deck ${card.copy}` : "";
  return `${card.rank}${card.suit}${copyLabel}`;
}

function deckCountForCard(card) {
  return Number(card.copy || 1) > 1 ? 2 : 1;
}

function minBidFor(room) {
  // v20 house rule: every two-deck table opens bidding at 300.
  return roomDeckCount(room) === 2 ? 300 : 150;
}

function maxBidFor(room) {
  return roomDeckCount(room) === 2 ? 500 : 250;
}

function bidIncrementFor(room) {
  // Official two-deck page uses a minimum +5 increment.
  return 5;
}

function totalPointsFor(room) {
  return roomDeckCount(room) === 2 ? 500 : 250;
}

function totalTricksFor(room) {
  // Number of tricks must match the number of cards dealt to each player.
  return (ranksFor(room.playerCount).length * SUITS.length * roomDeckCount(room)) / room.playerCount;
}

function partnerCountFor(room) {
  if (room.playerCount === 3 || room.playerCount === 4) return 1;
  if (room.playerCount === 5 || room.playerCount === 6) return 2;
  if (room.playerCount === 7 || room.playerCount === 8) return 3;
  return 1;
}

function sameIndexSet(a,b){
  const aa=[...(a||[])].map(Number).sort((x,y)=>x-y), bb=[...(b||[])].map(Number).sort((x,y)=>x-y);
  return aa.length===bb.length && aa.every((v,i)=>v===bb[i]);
}
function resetSeries(room, preserveFixedTeams = false){
  room.seriesBestOf = normalizeSeriesBestOf(room.seriesBestOf);
  if(!preserveFixedTeams) room.fixedTeams = null;
  room.series = {
    bestOf: room.seriesBestOf,
    targetWins: room.seriesBestOf>1 ? Math.ceil(room.seriesBestOf/2) : 0,
    winsA:0,winsB:0,complete:false,winner:null,results:[],
    teamAIndexes: preserveFixedTeams && room.fixedTeams ? room.fixedTeams.A.slice() : [],
    teamBIndexes: preserveFixedTeams && room.fixedTeams ? room.fixedTeams.B.slice() : []
  };
}
function fixedSideFor(room, playerIndex){
  if(!room.fixedTeams) return null;
  if(room.fixedTeams.A?.includes(playerIndex)) return "A";
  if(room.fixedTeams.B?.includes(playerIndex)) return "B";
  return null;
}
function fixedPartnerOptionGroups(room, viewerIndex){
  if(room.phase!=="contract" || viewerIndex!==room.bid.bidderIndex || room.teamMode!=="fixed" || !room.fixedTeams) return [];
  const side=fixedSideFor(room,viewerIndex); if(!side) return [];
  const mates=(room.fixedTeams[side]||[]).filter(i=>i!==viewerIndex);
  return mates.map(i=>(room.players[i]?.hand||[]).map(publicCard));
}
function updateSeriesAfterRound(room, made, bidderTeam, defenseTeam){
  room.seriesBestOf = normalizeSeriesBestOf(room.seriesBestOf);
  room.series ||= {bestOf:room.seriesBestOf,targetWins:room.seriesBestOf>1?Math.ceil(room.seriesBestOf/2):0,winsA:0,winsB:0,complete:false,winner:null,results:[],teamAIndexes:[],teamBIndexes:[]};
  room.series.bestOf=room.seriesBestOf; room.series.targetWins=room.seriesBestOf>1?Math.ceil(room.seriesBestOf/2):0;
  if(room.teamMode==="fixed" && fixedTeamsEligible(room.playerCount) && !room.fixedTeams){
    room.fixedTeams={A:bidderTeam.slice(),B:defenseTeam.slice()};
    room.series.teamAIndexes=room.fixedTeams.A.slice(); room.series.teamBIndexes=room.fixedTeams.B.slice();
    addLog(room,"Fixed series teams locked from Round 1.");
  }
  if(room.seriesBestOf<=1) return;
  let winnerSide;
  if(room.teamMode==="fixed" && room.fixedTeams){
    const winIndexes=made?bidderTeam:defenseTeam;
    winnerSide=sameIndexSet(winIndexes,room.fixedTeams.A)?"A":"B";
  } else winnerSide=made?"A":"B";
  if(winnerSide==="A")room.series.winsA++; else room.series.winsB++;
  room.series.results.push({round:room.round,winner:winnerSide,made:Boolean(made),bid:Number(room.bid.current||0),ts:Date.now()});
  room.series.results=room.series.results.slice(-15);
  const target=room.series.targetWins;
  if(target && (room.series.winsA>=target || room.series.winsB>=target)){
    room.series.complete=true; room.series.winner=room.series.winsA>=target?"A":"B";
    addLog(room,`${room.teamMode==="fixed"?`Team ${room.series.winner}`:(room.series.winner==="A"?"Contract side":"Opposite side")} won the best-of-${room.seriesBestOf} series.`);
  }
}

function makeHumanPlayer(socketId, name, avatar, accountId = null) {
  return {
    id: socketId,
    accountId,
    reconnectToken: makeReconnectToken(),
    name,
    avatar,
    bot: false,
    autoControlled: false,
    connected: true,
    voiceJoined: false,
    voiceMuted: false,
    hand: [],
    score: 0,
    team: null,
    roundPoints: 0,
    lastAward: 0,
    lastSeenAt: Date.now(),
    reconnectUntil: null,
    ready: false,
    rematchReady: false,
    timeoutStreak: 0,
    disconnectedRound: null,
    disconnectedTrickNumber: null
  };
}

function createRoomState(code, hostSocket, name, avatar, playerCount, accountId = null, requestedDeckCount = null) {
  const host = makeHumanPlayer(hostSocket, name, avatar, accountId);
  const now = Date.now();
  return {
    code,
    hostSocket,
    hostPlayerToken: host.reconnectToken,
    playerCount,
    deckCount: deckCountFor(playerCount, requestedDeckCount),
    phase: "lobby",
    dealerIndex: playerCount - 1,
    players: [host],
    deck: [],
    bid: { current: null, bidderIndex: null, turnIndex: 0, passed: [], acted: [] },
    bidHistory: [],
    trump: null,
    calledPartners: [],
    revealedPartners: [],
    partnerOwnerIndexes: [],
    bidderTeam: [],
    turnIndex: 0,
    leadSuit: null,
    trick: [],
    trickNumber: 0,
    lastTrick: null,
    trickHistory: [],
    scoreLedger: [],
    trickResolving: false,
    trickReviewUntil: null,
    log: [],
    chat: [],
    round: 0,
    createdAt: now,
    lastActivityAt: now,
    emptySince: null,
    actionKey: null,
    actionDeadline: null,
    actionTimer: null,
    lobbyEvictionTimer: null,
    hostReassignTimer: null,
    spectators: new Map(),
    isPublic: false,
    quickMatch: false,
    botDifficulty: "normal",
    botPersonality: "balanced",
    reports: [],
    ranked: false,
    matchConfirmation: false,
    privatePinHash: null,
    replayEvents: [],
    auditId: null,
    integrity: { deckVerified:false, scoreVerified:true },
    roundSummary: null,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    spectatorDelayMs: SPECTATOR_DELAY_MS,
    preset: "classic",
    theme: "classic",
    voiceEnabled: true,
    spectatorsEnabled: true,
    tableTheme: "classic",
    seriesBestOf: 1,
    teamMode: "random",
    fixedTeams: null,
    series: {bestOf:1,targetWins:0,winsA:0,winsB:0,complete:false,winner:null,results:[],teamAIndexes:[],teamBIndexes:[]},
    sameTeamRematchReady: []
  };
}

function addBot(room, index) {
  room.players.push({
    id: `bot-${room.code}-${room.round}-${index}-${Math.random().toString(36).slice(2,7)}`,
    reconnectToken: null,
    name: `Bot ${index}`,
    avatar: ["🤖","🦊","🐯","🦁"][index % 4],
    bot: true,
    autoControlled: false,
    connected: true,
    voiceJoined: false,
    voiceMuted: false,
    hand: [],
    score: 0,
    team: null,
    roundPoints: 0,
    lastAward: 0,
    ready: true,
    rematchReady: true,
    reconnectUntil: null
  });
}

function addLog(room, text) {
  room.log.unshift(text);
  room.log = room.log.slice(0, 14);
}

function emitRoom(room) {
  room.players.forEach((p, index) => {
    if (p.bot || !p.connected) return;
    const compact=Boolean(io.sockets.sockets.get(p.id)?.data?.lowNetwork);
    io.to(p.id).emit("state", serializeRoom(room, index, false, null, compact));
  });
  for (const [socketId, spec] of (room.spectators || new Map())) {
    const snapshot=serializeRoom(room, null, true, spec);
    const delay=room.ranked?SPECTATOR_DELAY_MS:Number(room.spectatorDelayMs||0);
    if(delay>0)setTimeout(()=>{if(io.sockets.sockets.has(socketId)&&rooms.has(room.code))io.to(socketId).emit("state",snapshot);},delay);
    else io.to(socketId).emit("state", snapshot);
  }
  persistRoomsSoon();
}

function serializeRoom(room, viewerIndex, spectator = false, spectatorProfile = null, compact = false) {
  const viewer = spectator ? { hand:[], reconnectToken:null } : room.players[viewerIndex];
  return {
    code: room.code,
    playerCount: room.playerCount,
    deckCount: roomDeckCount(room),
    availableRanks: ranksFor(room.playerCount).slice(),
    cardsEach: totalTricksFor(room),
    phase: room.phase,
    round: room.round,
    dealerIndex: room.dealerIndex,
    viewerIndex,
    host: !spectator && viewer.reconnectToken && viewer.reconnectToken === room.hostPlayerToken,
    spectator,
    spectatorProfile,
    isPublic: Boolean(room.isPublic),
    botDifficulty: room.botDifficulty || "normal",
    botPersonality: room.botPersonality || "balanced",
    allReady: room.players.filter(p => !p.bot && p.connected).every(p => p.ready),
    readyCount: room.players.filter(p => !p.bot && p.connected && p.ready).length,
    connectedHumanCount: room.players.filter(p => !p.bot && p.connected).length,
    spectatorCount: room.spectators?.size || 0,
    ranked: Boolean(room.ranked),
    matchConfirmation: Boolean(room.matchConfirmation),
    tournamentId: room.tournamentId || null,
    lastReplayId: room.lastReplayId || null,
    region: REGION_ID,
    players: room.players.map((p, i) => ({
      index: i,
      name: p.name,
      avatar: p.avatar || "😎",
      bot: p.bot,
      autoControlled: Boolean(p.autoControlled),
      connected: p.connected,
      voiceJoined: Boolean(p.voiceJoined),
      voiceMuted: Boolean(p.voiceMuted),
      ready: Boolean(p.ready),
      rematchReady: Boolean(p.rematchReady),
      rankedConfirmed: Boolean(p.rankedConfirmed),
      accountId: p.accountId || null,
      reconnectUntil: p.reconnectUntil || null,
      cards: p.hand.length,
      score: p.score,
      roundPoints: p.roundPoints,
      lastAward: p.lastAward || 0,
      timeoutStreak: Number(p.timeoutStreak || 0),
      team: (room.phase === "roundEnd" || i === room.bid.bidderIndex || room.revealedPartners.includes(i) || room.revealedPartners.length >= partnerCountFor(room)) ? p.team : null
    })),
    hand: spectator ? [] : viewer.hand.map(publicCard),
    bid: {
      current: room.bid.current,
      bidderIndex: room.bid.bidderIndex,
      turnIndex: room.bid.turnIndex,
      passed: room.bid.passed.slice(),
      min: minBidFor(room),
      max: maxBidFor(room),
      increment: bidIncrementFor(room),
      history: compact ? (room.bidHistory||[]).slice(-6) : (room.bidHistory||[]).slice()
    },
    legalCardIds: spectator || room.phase!=="playing" || viewerIndex==null ? [] : legalCards(room,viewerIndex).map(c=>c.id),
    trump: room.trump,
    calledPartners: room.calledPartners.map(c => ({ suit: c.suit, rank: c.rank, copy: c.copy || 1, id: c.id || `${c.copy || 1}-${c.suit}-${c.rank}` })),
    revealedPartners: room.revealedPartners.slice(),
    bidderTeam: room.phase === "roundEnd" ? room.bidderTeam.slice() : room.revealedPartners.length ? room.bidderTeam.slice() : [room.bid.bidderIndex].filter(i => i !== null),
    turnIndex: room.turnIndex,
    leadSuit: room.leadSuit,
    trick: room.trick.map(t => ({ playerIndex: t.playerIndex, card: publicCard(t.card) })),
    trickNumber: room.trickNumber,
    lastTrick: room.lastTrick,
    trickHistory: compact ? (room.trickHistory||[]).slice(-2) : (room.trickHistory||[]).slice(-5),
    trickResolving: Boolean(room.trickResolving),
    trickReviewUntil: room.trickReviewUntil || null,
    trickReviewMs: TRICK_REVIEW_MS,
    partnerCount: partnerCountFor(room),
    totalPoints: totalPointsFor(room),
    pointValues: { threeSpades:30, ace:10, king:10, queen:10, jack:10, ten:10, five:5, other:0 },
    totalTricks: totalTricksFor(room),
    actionDeadline: room.actionDeadline,
    actionTimeoutMs: Number(room.turnTimeoutMs||TURN_TIMEOUT_MS),
    spectatorDelayMs: Number(room.spectatorDelayMs||0),
    voiceEnabled: room.voiceEnabled !== false,
    spectatorsEnabled: room.spectatorsEnabled !== false,
    tableTheme: normalizeRoomTheme(room.tableTheme),
    seriesBestOf: normalizeSeriesBestOf(room.seriesBestOf),
    teamMode: room.teamMode || "random",
    series: room.series ? {
      bestOf:room.series.bestOf||room.seriesBestOf||1,targetWins:room.series.targetWins||0,winsA:room.series.winsA||0,winsB:room.series.winsB||0,
      complete:Boolean(room.series.complete),winner:room.series.winner||null,results:(room.series.results||[]).slice(-9),
      teamAIndexes:room.phase==="roundEnd"?(room.series.teamAIndexes||[]).slice():[],teamBIndexes:room.phase==="roundEnd"?(room.series.teamBIndexes||[]).slice():[]
    } : null,
    fixedPartnerOptionGroups: spectator ? [] : fixedPartnerOptionGroups(room, viewerIndex),
    scoreLedger: (room.scoreLedger||[]).slice(),
    ruleSummary: ruleSummaryFor(room),
    auditId: room.auditId || null,
    integrity: { ...(room.integrity||{}) },
    roundSummary: room.roundSummary || null,
    preset: room.preset || "classic",
    lowNetwork: compact,
    log: compact ? room.log.slice(0,6) : room.log.slice(),
    chat: compact ? room.chat.slice(-12) : room.chat.slice(-40)
  };
}

function startRound(room) {
  touchRoom(room);
  room.round += 1;
  room.phase = "bidding";
  room.trump = null;
  room.calledPartners = [];
  room.revealedPartners = [];
  room.partnerOwnerIndexes = [];
  room.bidderTeam = [];
  room.leadSuit = null;
  room.trick = [];
  room.trickNumber = 0;
  room.lastTrick = null;
  room.trickHistory = [];
  room.scoreLedger = [];
  room.bidHistory = [];
  room.auditId = `${room.code}-R${room.round}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  room.integrity = { deckVerified:false, scoreVerified:true, scoredPoints:0, expectedPoints:null };
  room.roundSummary = null;
  room.trickResolving = false;
  room.trickReviewUntil = null;
  room.replayEvents = [];

  // The server alone creates and shuffles the deal. The client never receives or supplies deck order.
  room.deck = makeDeck(room);
  let deckOk = verifyDeckIntegrity(room, room.deck);
  for (let retry=0; retry<2 && !deckOk; retry++) {
    room.deck = makeDeck(room);
    deckOk = verifyDeckIntegrity(room, room.deck);
  }
  if (!deckOk) {
    addLog(room, "Deal integrity check failed. Round stopped safely.");
    room.phase = "lobby";
    emitRoom(room);
    return;
  }
  recordReplayEvent(room,"roundStart",{round:room.round,auditId:room.auditId,ruleSummary:ruleSummaryFor(room),deckVerified:true});

  room.players.forEach(p => {
    p.hand = [];
    p.roundPoints = 0;
    p.lastAward = 0;
    p.team = null;
    p.ready = false;
    p.rematchReady = false;
  });

  const cardsEach = room.deck.length / room.playerCount;
  for (let c = 0; c < cardsEach; c++) {
    for (let p = 0; p < room.playerCount; p++) {
      room.players[p].hand.push(room.deck.pop());
    }
  }
  room.players.forEach(p => sortHand(p.hand));

  room.dealerIndex = (room.dealerIndex + 1) % room.playerCount;
  const firstBidder = (room.dealerIndex + 1) % room.playerCount;
  room.bid = {
    current: null,
    bidderIndex: null,
    turnIndex: firstBidder,
    passed: [],
    acted: []
  };
  verifyScoreIntegrity(room);
  addLog(room, `Round ${room.round} started. Bidding begins. Audit ${room.auditId.slice(0,8).toUpperCase()}.`);
  if (room.playerCount === 3) addLog(room, "3-player custom variant: 1 reduced deck without 2s · 48 cards · 16 each · 250 points · bidder + 1 hidden partner vs 1 defender.");
  if (room.playerCount === 4 && roomDeckCount(room) === 1) addLog(room, "4-player mode: 1 full deck · 52 cards · 13 each · 250 points · bid 150–250 · bidder + 1 hidden partner vs 2 defenders.");
  if (room.playerCount === 4 && roomDeckCount(room) === 2) addLog(room, "4-player DOUBLE-DECK mode: 2 full decks · 104 cards · 26 each · 500 points · bid 300–500 by 5 · bidder + 1 hidden partner vs 2 defenders.");
  if (room.playerCount === 5) addLog(room, "5-player rules: 2 reduced decks · 80 cards · 16 each · 500 points · bidder + 2 hidden partners.");
  if (room.playerCount === 6) addLog(room, "6-player rules: 2 reduced decks · 96 cards · 16 each · 500 points · bidder + 2 hidden partners.");
  if (room.playerCount === 7) addLog(room, "7-player custom variant: 2 reduced decks · 56 cards · 8 each · 500 points · bid 300–500 by 5 · bidder + 3 hidden partners.");
  if (room.playerCount === 8) addLog(room, "8-player mode: 2 full decks · 104 cards · 13 each · 500 points · bid 300–500 by 5 · bidder + 3 hidden partners vs 4 defenders.");
  emitRoom(room);
  scheduleBot(room);
}

function sortHand(hand) {
  const suitOrder = { S: 0, H: 1, D: 2, C: 3 };
  hand.sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || RANK_VALUE[a.rank] - RANK_VALUE[b.rank]);
}

function nextActiveBidder(room, from) {
  for (let step = 1; step <= room.playerCount; step++) {
    const i = (from + step) % room.playerCount;
    if (!room.bid.passed.includes(i)) return i;
  }
  return from;
}

function handleBid(room, playerIndex, amount, pass, options = {}) {
  if (room.phase !== "bidding" || room.bid.turnIndex !== playerIndex) return false;
  touchRoom(room);
  if(!options.auto&&room.players[playerIndex]&&!room.players[playerIndex].bot)room.players[playerIndex].timeoutStreak=0;

  if (pass) {
    if (!room.bid.passed.includes(playerIndex)) room.bid.passed.push(playerIndex);
    room.bidHistory.push({playerIndex,pass:true,amount:null,auto:Boolean(options.auto),ts:Date.now()});
    addLog(room, options.auto ? `${room.players[playerIndex].name} timed out and passed automatically.` : `${room.players[playerIndex].name} passed.`);
    recordReplayEvent(room,"pass",{playerIndex,auto:Boolean(options.auto)});
  } else {
    const value = Number(amount);
    const increment = bidIncrementFor(room);
    const minimum = room.bid.current === null ? minBidFor(room) : room.bid.current + increment;
    if (!Number.isInteger(value) || value < minimum || value > maxBidFor(room) || value % increment !== 0) return false;
    room.bid.current = value;
    room.bid.bidderIndex = playerIndex;
    room.bidHistory.push({playerIndex,pass:false,amount:value,auto:Boolean(options.auto),ts:Date.now()});
    addLog(room, `${room.players[playerIndex].name} bid ${value}.`);
    recordReplayEvent(room,"bid",{playerIndex,amount:value});
  }

  if (!room.bid.acted.includes(playerIndex)) room.bid.acted.push(playerIndex);

  if (room.bid.current === null && room.bid.passed.length >= room.playerCount) {
    clearActionSchedule(room);
    addLog(room, "Everyone passed. Redealing.");
    setTimeout(() => { if (rooms.has(room.code)) startRound(room); }, 700);
    return true;
  }

  const activeNonBidder = room.players.map((_, i) => i).filter(i => i !== room.bid.bidderIndex && !room.bid.passed.includes(i));
  if (room.bid.current !== null && activeNonBidder.length === 0) {
    finishBidding(room);
    return true;
  }

  room.bid.turnIndex = nextActiveBidder(room, playerIndex);
  emitRoom(room);
  scheduleBot(room);
  return true;
}

function finishBidding(room) {
  touchRoom(room);
  const bidder = room.bid.bidderIndex;
  if (bidder === null) return;
  addLog(room, `${room.players[bidder].name} wins the bid at ${room.bid.current}.`);

  room.phase = "contract";
  room.bidderTeam = [bidder];
  room.players[bidder].team = "bidder";
  emitRoom(room);
  scheduleBot(room);
}

function chooseContract(room, playerIndex, trump, partnerCards) {
  if (room.phase !== "contract" || room.bid.bidderIndex !== playerIndex) return { ok:false, error:"Only the bid winner can set the contract." };
  touchRoom(room);
  if(room.players[playerIndex]&&!room.players[playerIndex].bot)room.players[playerIndex].timeoutStreak=0;
  if (!SUITS.includes(trump)) return { ok:false, error:"Choose a valid Hukum suit." };

  const need = partnerCountFor(room);
  if (!Array.isArray(partnerCards) || partnerCards.length !== need) {
    return { ok:false, error:`Choose exactly ${need} hidden partner card${need === 1 ? "" : "s"}.` };
  }

  const cleaned = [];
  const seenCards = new Set();
  const ownerIndexes = [];
  const seenOwners = new Set();

  for (const c of partnerCards) {
    if (!c || !SUITS.includes(c.suit) || !RANKS.includes(String(c.rank))) {
      return { ok:false, error:"Invalid partner card." };
    }
    const copies = roomDeckCount(room);
    const copy = copies === 2 ? Number(c.copy) : 1;
    if (copy < 1 || copy > copies) {
      return { ok:false, error:"Invalid deck copy." };
    }

    const key = `${copy}-${c.suit}-${c.rank}`;
    if (seenCards.has(key)) return { ok:false, error:"Choose different physical cards for each hidden partner." };
    if (room.players[playerIndex].hand.some(h => h.id === key)) {
      return { ok:false, error:"You cannot call a partner card that is in your own hand." };
    }

    const ownerIndex = room.players.findIndex((p, i) => i !== playerIndex && p.hand.some(h => h.id === key));
    if (ownerIndex < 0) return { ok:false, error:"That partner card is not available in this deal." };
    if (seenOwners.has(ownerIndex)) {
      return { ok:false, error:`For the locked team setup, the ${need} called cards must belong to ${need} different players. Choose another card.` };
    }
    if(room.teamMode==="fixed" && room.fixedTeams){
      const bidderSide=fixedSideFor(room,playerIndex);
      if(!bidderSide || !(room.fixedTeams[bidderSide]||[]).includes(ownerIndex)){
        return {ok:false,error:"Fixed-team series: choose the partner card from your fixed team."};
      }
    }

    seenCards.add(key);
    seenOwners.add(ownerIndex);
    ownerIndexes.push(ownerIndex);
    cleaned.push({ suit: c.suit, rank: String(c.rank), copy, id: key });
  }

  room.trump = trump;
  room.calledPartners = cleaned;
  room.partnerOwnerIndexes = ownerIndexes;
  room.phase = "playing";
  room.turnIndex = room.bid.bidderIndex; // Highest bidder leads the first trick.
  room.leadSuit = null;
  room.trick = [];
  room.trickResolving = false;
  room.trickReviewUntil = null;
  addLog(room, `${room.players[playerIndex].name} chose ${trump} as Hukum and called ${need} hidden partner${need === 1 ? "" : "s"}.`);
  recordReplayEvent(room,"contract",{playerIndex,trump,partners:cleaned.map(publicCard)});
  emitRoom(room);
  scheduleBot(room);
  return { ok:true };
}

function legalCards(room, playerIndex) {
  const hand = room.players[playerIndex].hand;
  if (!room.leadSuit) return hand;
  const following = hand.filter(c => c.suit === room.leadSuit);
  return following.length ? following : hand;
}

function resolvePartnerReveal(room, playerIndex, card) {
  const calledIndex = room.calledPartners.findIndex(c => (c.id || `${c.copy || 1}-${c.suit}-${c.rank}`) === card.id);
  if (calledIndex < 0 || playerIndex === room.bid.bidderIndex) return;
  if (room.partnerOwnerIndexes[calledIndex] !== playerIndex) return;

  if (!room.bidderTeam.includes(playerIndex)) {
    room.bidderTeam.push(playerIndex);
    room.revealedPartners.push(playerIndex);
    room.players[playerIndex].team = "bidder";
    addLog(room, `Partner Revealed! ${room.players[playerIndex].name} joined the bidder team.`);
  }

  if (room.revealedPartners.length >= partnerCountFor(room)) {
    room.players.forEach((p, i) => {
      if (!room.bidderTeam.includes(i)) p.team = "defense";
    });
    const bidderSide = room.bidderTeam.length;
    const defenders = room.playerCount - bidderSide;
    addLog(room, `All hidden partners are revealed. Teams are now ${bidderSide} vs ${defenders}.`);
  }
}

function playCard(room, playerIndex, cardId, options = {}) {
  if (room.phase !== "playing" || room.trickResolving || room.turnIndex !== playerIndex) return false;
  touchRoom(room);
  const player = room.players[playerIndex];
  if(!options.auto&&!player.bot)player.timeoutStreak=0;
  const idx = player.hand.findIndex(c => c.id === cardId);
  if (idx < 0) return false;

  const card = player.hand[idx];
  const legal = legalCards(room, playerIndex);
  if (!legal.some(c => c.id === card.id)) return false;

  player.hand.splice(idx, 1);
  if (!room.leadSuit) room.leadSuit = card.suit;
  room.trick.push({ playerIndex, card });
  resolvePartnerReveal(room, playerIndex, card);
  addLog(room, options.auto ? `${player.name} timed out — ${cardLabel(card)} was auto-played.` : `${player.name} played ${cardLabel(card)}.`);
  recordReplayEvent(room,"play",{playerIndex,card:publicCard(card),auto:Boolean(options.auto)});

  if (room.trick.length === room.playerCount) {
    resolveTrick(room);
  } else {
    room.turnIndex = (playerIndex + 1) % room.playerCount;
    emitRoom(room);
    scheduleBot(room);
  }
  return true;
}

function resolveTrick(room) {
  const lead = room.leadSuit;
  let winner = room.trick[0];

  function strength(play) {
    const c = play.card;
    // In the supplied KaliTiri rules, 3♠ is worth 30 points but ranks
    // as an ordinary 3 for trick-taking. PowerHouse wins over non-PowerHouse;
    // otherwise only the led suit can win.
    const trumpBonus = c.suit === room.trump ? 1000 : 0;
    const leadBonus = c.suit === lead ? 500 : 0;
    return trumpBonus + leadBonus + RANK_VALUE[c.rank];
  }

  function samePlayingValue(a, b) {
    return a.card.suit === b.card.suit && a.card.rank === b.card.rank;
  }

  for (const p of room.trick.slice(1)) {
    const ps = strength(p), ws = strength(winner);
    // Official duplicate-card rule: if the same card value appears again,
    // the later/second copy wins the tie.
    if (ps > ws || (ps === ws && samePlayingValue(p, winner))) winner = p;
  }

  const points = room.trick.reduce((sum, p) => sum + cardPoints(p.card), 0);
  room.players[winner.playerIndex].roundPoints += points;
  room.lastTrick = {
    number: room.trickNumber + 1,
    winnerIndex: winner.playerIndex,
    points,
    cards: room.trick.map(t => ({ playerIndex: t.playerIndex, card: publicCard(t.card) }))
  };
  room.trickHistory.push(room.lastTrick);
  room.trickHistory = room.trickHistory.slice(-Math.max(5,totalTricksFor(room)));
  const scoringCards=room.trick.map(t=>({playerIndex:t.playerIndex,card:publicCard(t.card),points:cardPoints(t.card)})).filter(x=>x.points>0);
  room.scoreLedger.push({number:room.lastTrick.number,winnerIndex:winner.playerIndex,points,scoringCards,cards:room.lastTrick.cards.slice()});
  room.scoreLedger=room.scoreLedger.slice(-Math.max(5,totalTricksFor(room)));
  verifyScoreIntegrity(room);
  room.trickNumber += 1;
  addLog(room, `${room.players[winner.playerIndex].name} won the trick (+${points}).`);
  recordReplayEvent(room,"trick",{winnerIndex:winner.playerIndex,points,cards:room.lastTrick.cards});
  const wu=users.get(room.players[winner.playerIndex]?.accountId); if(wu){wu.stats||={};wu.stats.tricksWon=(wu.stats.tricksWon||0)+1;}

  room.turnIndex = winner.playerIndex;
  room.trickResolving = true;
  verifyScoreIntegrity(room);
  room.trickReviewUntil = Date.now() + TRICK_REVIEW_MS;
  clearActionSchedule(room);

  // Keep the completed trick on the table long enough for every player to see it.
  // No player/bot action is accepted during this review window.
  emitRoom(room);
  const roomCode = room.code;
  setTimeout(() => {
    const liveRoom = rooms.get(roomCode);
    if (!liveRoom || liveRoom !== room || liveRoom.phase !== "playing" || !liveRoom.trickResolving) return;
    liveRoom.trick = [];
    liveRoom.leadSuit = null;
    liveRoom.trickResolving = false;
    liveRoom.trickReviewUntil = null;
    verifyScoreIntegrity(liveRoom);
    const noCards = liveRoom.players.every(p => p.hand.length === 0);
    if (noCards) finishRound(liveRoom);
    else {
      emitRoom(liveRoom);
      scheduleBot(liveRoom);
    }
  }, TRICK_REVIEW_MS).unref?.();
}

function finishRound(room) {
  touchRoom(room);
  verifyScoreIntegrity(room, true);
  clearActionSchedule(room);
  room.bidderTeam = [room.bid.bidderIndex, ...room.partnerOwnerIndexes.filter(i => i !== room.bid.bidderIndex)];
  room.players.forEach((p, i) => {
    if (room.bidderTeam.includes(i)) p.team = "bidder";
    else p.team = "defense";
  });

  const bidderPoints = room.players.reduce((sum, p, i) => sum + (room.bidderTeam.includes(i) ? p.roundPoints : 0), 0);
  const defensePoints = room.players.reduce((sum, p, i) => sum + (!room.bidderTeam.includes(i) ? p.roundPoints : 0), 0);
  const contract = room.bid.current;

  // v23 contract rule: bidder + called partner(s) win when their combined
  // captured points MEET OR EXCEED the bid. If they finish below the bid,
  // the opposite/defense side wins the round.
  const made = bidderPoints >= contract;
  const bidderIndex = room.bid.bidderIndex;

  room.players.forEach((p, i) => {
    let award = 0;
    const onBidderTeam = room.bidderTeam.includes(i);

    if (!onBidderTeam) {
      // Opposing team: every player gets the points their team collected.
      award = defensePoints;
    } else if (made) {
      // Successful bidding team: every team member gets the points the team scored.
      award = bidderPoints;
    } else if (i === bidderIndex) {
      // Failed bid: bid winner loses the round's award.
      award = 0;
    } else {
      // Failed bid: the bidder's partners receive half of the other team's points.
      award = Math.floor(defensePoints / 2);
    }

    p.lastAward = award;
    p.score += award;
  });

  verifyScoreIntegrity(room, true);
  const defenseTeam = room.players.map((_,i)=>i).filter(i=>!room.bidderTeam.includes(i));
  const bidderScoringCards = scoringCardsCapturedBy(room, room.bidderTeam);
  const defenseScoringCards = scoringCardsCapturedBy(room, defenseTeam);
  const mvpIndex = room.players.reduce((best,p,i,arr)=>Number(p.roundPoints||0)>Number(arr[best]?.roundPoints||0)?i:best,0);
  room.roundSummary={
    made,
    bid:contract,
    bidderPoints,
    defensePoints,
    bidderIndex,
    bidderTeamIndexes:room.bidderTeam.slice(),
    defenseTeamIndexes:defenseTeam.slice(),
    winningTeam:made?"bidder":"defense",
    losingTeam:made?"defense":"bidder",
    winningPoints:made?bidderPoints:defensePoints,
    losingPoints:made?defensePoints:bidderPoints,
    calledPartners:room.calledPartners.map((c,i)=>({ ...publicCard(c), ownerIndex:room.partnerOwnerIndexes[i] ?? null })),
    bidderScoringCards,
    defenseScoringCards,
    bidderPointBreakdown:scoringBreakdown(bidderScoringCards),
    defensePointBreakdown:scoringBreakdown(defenseScoringCards),
    mvpIndex,
    mvpName:room.players[mvpIndex]?.name||"Player",
    mvpPoints:room.players[mvpIndex]?.roundPoints||0,
    totalPoints:totalPointsFor(room),
    matchStats:{biggestTrick:(room.scoreLedger||[]).reduce((a,t)=>Number(t.points||0)>Number(a?.points||-1)?t:a,null),highestCapture:Math.max(...room.players.map(p=>Number(p.roundPoints||0))),bidderPerformance:{bid:contract,points:bidderPoints,margin:bidderPoints-contract,made},partnerPerformance:room.partnerOwnerIndexes.map(i=>({playerIndex:i,points:Number(room.players[i]?.roundPoints||0)}))},
    scoreLedger:(room.scoreLedger||[]).slice(),
    auditId:room.auditId,
    integrity:{...(room.integrity||{})},
    fairPlayReceipt:{
      auditId:room.auditId,
      deckVerified:Boolean(room.integrity?.deckVerified),
      scoreVerified:Boolean(room.integrity?.scoreVerified),
      scoreRecovered:Boolean(room.integrity?.scoreRecovered),
      scoredPoints:Number(room.integrity?.scoredPoints||0),
      expectedPoints:totalPointsFor(room),
      tricksChecked:Number(room.trickHistory?.length||0),
      serverShuffle:"crypto.randomInt Fisher–Yates",
      generatedAt:Date.now()
    }
  };
  updateSeriesAfterRound(room,made,room.bidderTeam,defenseTeam);
  room.roundSummary.series = room.series ? {...room.series,teamAIndexes:(room.series.teamAIndexes||[]).slice(),teamBIndexes:(room.series.teamBIndexes||[]).slice()} : null;
  room.phase = "roundEnd";
  addLog(room, made
    ? `Bidder + partner team scored ${bidderPoints}, met the bid ${contract}, and WON the round.`
    : `Bidder + partner team scored ${bidderPoints}, below bid ${contract}. Contract failed — the opposite team WON the round.`);
  addLog(room, `Final points: Bidder + partners ${bidderPoints} · Opposite team ${defensePoints} · Total ${bidderPoints + defensePoints}/${totalPointsFor(room)}.`);
  const winningIndexes=[];
  room.players.forEach((p,i) => {
    if (p.bot) return;
    const key = `${p.name}|${p.avatar || "😎"}`;
    const rec = leaderboard.get(key) || { name:p.name, avatar:p.avatar || "😎", rounds:0, wins:0, score:0 };
    rec.rounds += 1;
    const playerWon = room.bidderTeam.includes(i) ? made : !made;
    if (playerWon) { rec.wins += 1; winningIndexes.push(i); }
    rec.score += Number(p.lastAward || 0);
    rec.updatedAt = Date.now();
    leaderboard.set(key, rec);
    updateCloudRoundStats(room,i,playerWon);
  });
  updateRatings(room,winningIndexes);
  storeReplay(room,bidderPoints,defensePoints,made);
  analytics.roundsCompleted++;
  if(room.tournamentId) advanceTournamentRoom(room,winningIndexes);
  persistAccountsSoon();
  persistRoomsSoon();
  emitRoom(room);
}

function botBid(room, index) {
  const p = room.players[index];
  const points = p.hand.reduce((s, c) => s + cardPoints(c), 0);
  const trumpsPotential = Math.max(...SUITS.map(s => p.hand.filter(c => c.suit === s).length));
  const increment = bidIncrementFor(room);
  const minimum = room.bid.current === null ? minBidFor(room) : room.bid.current + increment;
  const raw = minBidFor(room) + Math.floor((points + trumpsPotential * 5) / 20) * increment;
  const target = Math.floor(raw / increment) * increment;
  const difficulty = room.botDifficulty || "normal", personality=room.botPersonality||"balanced";
  let chance = difficulty === "easy" ? 0.55 : difficulty === "hard" ? 0.12 : 0.28;
  if(personality==="aggressive")chance=Math.max(.05,chance-.18);if(personality==="conservative")chance=Math.min(.8,chance+.22);
  const shouldBid = target >= minimum && Math.random() > chance;
  if (shouldBid && minimum <= maxBidFor(room)) {
    handleBid(room, index, Math.min(maxBidFor(room), Math.max(minimum, target)), false);
  } else {
    handleBid(room, index, null, true);
  }
}

function automaticContract(room, index, timedOut = false) {
  const hand = room.players[index]?.hand || [];
  if (!hand.length || room.phase !== "contract" || room.bid.bidderIndex !== index) return;
  const counts = SUITS.map(s => [s, hand.filter(c => c.suit === s).length]).sort((a,b) => b[1] - a[1]);
  const trump = counts[0][0];
  const need = partnerCountFor(room);
  const owners = shuffle(room.players.map((_,i)=>i).filter(i => i !== index)).slice(0, need);
  const rankPreference = { A:13, K:12, Q:11, J:10, "10":9, "5":8, "9":7, "8":6, "7":5, "6":4, "4":3, "3":2, "2":1 };
  const choices = owners.map(ownerIndex => {
    const candidates = room.players[ownerIndex].hand.slice().sort((a,b) => {
      const aBlack = a.suit === "S" && a.rank === "3" ? 1 : 0;
      const bBlack = b.suit === "S" && b.rank === "3" ? 1 : 0;
      if (aBlack !== bBlack) return aBlack - bBlack;
      return (rankPreference[b.rank] || 0) - (rankPreference[a.rank] || 0);
    });
    const c = candidates[0];
    return { suit:c.suit, rank:c.rank, copy:c.copy };
  });
  if (timedOut) addLog(room, `${room.players[index].name} timed out — Hukum and partners were selected automatically.`);
  const result = chooseContract(room, index, trump, choices);
  if (!result.ok) {
    addLog(room, `${room.players[index].name} could not lock the automatic contract. Retrying.`);
    setTimeout(() => { if (rooms.has(room.code)) automaticContract(room, index, timedOut); }, 250);
  }
}

function botContract(room, index) { automaticContract(room, index, false); }

function automaticPlay(room, index, timedOut = false) {
  const legal = legalCards(room, index);
  if (!legal.length) return;
  const sorted = legal.slice().sort((a,b) => {
    const pa = cardPoints(a), pb = cardPoints(b);
    if (pa !== pb) return pa - pb;
    return RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
  });
  let choice = sorted[0];
  const difficulty = room.botDifficulty || "normal", personality=room.botPersonality||"balanced";
  // v33 Hard bots keep a compact memory of cards already exposed. When a valuable
  // trick is live they prefer the cheapest legal card that can currently take it,
  // and avoid donating point cards when they cannot. This remains imperfect on purpose.
  if(difficulty === "hard" && room.trick.length){
    const seen=new Set((room.trickHistory||[]).flatMap(t=>(t.cards||[]).map(x=>x.card.id)).concat(room.trick.map(x=>x.card.id)));
    const lead=room.leadSuit, current=room.trick.reduce((w,x)=>{const st=c=>(c.suit===room.trump?1000:0)+(c.suit===lead?500:0)+(RANK_VALUE[c.rank]||0);return !w||st(x.card)>st(w.card)||(st(x.card)===st(w.card)&&x.card.suit===w.card.suit&&x.card.rank===w.card.rank)?x:w;},null);
    const st=c=>(c.suit===room.trump?1000:0)+(c.suit===lead?500:0)+(RANK_VALUE[c.rank]||0), canWin=legal.filter(c=>st(c)>=st(current.card));
    const trickValue=room.trick.reduce((n,x)=>n+cardPoints(x.card),0), unseenTrumps=expectedDeckIds(room).filter(id=>id.includes(`-${room.trump}-`)&&!seen.has(id)).length;
    if(trickValue>=10&&canWin.length)choice=canWin.slice().sort((a,b)=>st(a)-st(b)||cardPoints(a)-cardPoints(b))[0];
    else if(!canWin.length)choice=legal.slice().sort((a,b)=>cardPoints(a)-cardPoints(b)||RANK_VALUE[a.rank]-RANK_VALUE[b.rank])[0];
    else if(unseenTrumps<=2&&personality==="aggressive")choice=canWin.slice().sort((a,b)=>st(a)-st(b))[0];
  }
  if (difficulty === "easy") {
    choice = legal[Math.floor(Math.random() * legal.length)] || sorted[0];
  } else if (difficulty !== "hard" && room.trick.length) {
    const currentPoints = room.trick.reduce((sum,p) => sum + cardPoints(p.card), 0);
    const threshold=personality==="aggressive"?10:personality==="conservative"?35:20;
    if (currentPoints >= threshold) choice = sorted[sorted.length - 1];
    if(personality==="partner" && room.players[index]?.team==="bidder" && room.trick.some(t=>room.players[t.playerIndex]?.team==="bidder")) choice=sorted[0];
  } else if (!timedOut && Math.random() > (personality==="aggressive"?.25:difficulty === "hard" ? 0.4 : 0.65)) {
    choice = sorted[sorted.length - 1];
  }
  playCard(room, index, choice.id, { auto: timedOut });
}

function botPlay(room, index) { automaticPlay(room, index, false); }

function clearActionSchedule(room) {
  clearTimeout(room.actionTimer);
  room.actionTimer = null;
  room.actionKey = null;
  room.actionDeadline = null;
}

function actionActor(room) {
  if (room.trickResolving) return null;
  if (room.phase === "bidding") return room.bid.turnIndex;
  if (room.phase === "contract") return room.bid.bidderIndex;
  if (room.phase === "playing") return room.turnIndex;
  return null;
}

function actionKeyFor(room) {
  const actor = actionActor(room);
  if (actor === null || actor === undefined) return null;
  if (room.phase === "bidding") return `b:${room.round}:${actor}:${room.bid.current ?? "none"}:${room.bid.passed.join(",")}`;
  if (room.phase === "contract") return `c:${room.round}:${actor}`;
  if (room.phase === "playing") return `p:${room.round}:${room.trickNumber}:${room.trick.length}:${actor}`;
  return null;
}

function runScheduledAction(room, key) {
  if (!rooms.has(room.code) || room.actionKey !== key) return;
  const index = actionActor(room);
  const player = room.players[index];
  if (!player) return clearActionSchedule(room);
  room.actionTimer = null;
  if(!player.bot&&!player.autoControlled){player.timeoutStreak=(player.timeoutStreak||0)+1;if(player.timeoutStreak>=3){player.autoControlled=true;addLog(room,`${player.name} missed 3 turns — Bot Assist enabled. They can reclaim control.`);io.to(player.id).emit("afkAssist",{enabled:true});}}

  if (room.phase === "bidding") {
    if (player.bot || player.autoControlled) botBid(room, index);
    else handleBid(room, index, null, true, { auto:true });
  } else if (room.phase === "contract") {
    automaticContract(room, index, !player.bot && !player.autoControlled);
  } else if (room.phase === "playing") {
    automaticPlay(room, index, !player.bot && !player.autoControlled);
  }
}

// Schedules both bots and the authoritative server-side human turn timeout.
function scheduleBot(room) {
  // A bot-only table must never keep playing. If all real players are offline,
  // freeze the authoritative action timer until somebody reconnects.
  if (!connectedHumans(room).length) {
    if (!room.emptySince) room.emptySince = Date.now();
    clearActionSchedule(room);
    return;
  }
  const key = actionKeyFor(room);
  if (!key) return clearActionSchedule(room);
  if (room.actionKey === key && room.actionTimer) return;

  clearTimeout(room.actionTimer);
  const index = actionActor(room);
  const player = room.players[index];
  if (!player) return clearActionSchedule(room);
  const automatic = player.bot || player.autoControlled;
  const delay = automatic ? BOT_ACTION_DELAY_MS : Number(room.turnTimeoutMs||TURN_TIMEOUT_MS);
  room.actionKey = key;
  room.actionDeadline = Date.now() + delay;
  room.actionTimer = setTimeout(() => runScheduledAction(room, key), delay);
  room.actionTimer.unref?.();
  emitRoom(room); // publish the authoritative deadline after it has been set.
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    const index = room.players.findIndex(p => p.id === socketId);
    if (index >= 0) return { room, index };
  }
  return null;
}

function findSpectatorRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.spectators?.has(socketId)) return { room, spectator: room.spectators.get(socketId) };
  }
  return null;
}

function publicRoomSummary(room) {
  return {
    code: room.code,
    playerCount: room.playerCount,
    deckCount: roomDeckCount(room),
    ruleSummary: ruleSummaryFor(room),
    turnTimeoutMs: Number(room.turnTimeoutMs||TURN_TIMEOUT_MS),
    joined: room.players.filter(p => !p.bot).length,
    phase: room.phase,
    round: room.round,
    botDifficulty: room.botDifficulty || "normal",
    spectatorCount: room.spectators?.size || 0,
    ranked: Boolean(room.ranked),
    matchConfirmation: Boolean(room.matchConfirmation),
    tournamentId: room.tournamentId || null,
    lastReplayId: room.lastReplayId || null,
    region: REGION_ID,
    locked: Boolean(room.privatePinHash),
    voiceEnabled: room.voiceEnabled !== false,
    spectatorsEnabled: room.spectatorsEnabled !== false,
    tableTheme: normalizeRoomTheme(room.tableTheme),
    seriesBestOf: normalizeSeriesBestOf(room.seriesBestOf),
    teamMode: room.teamMode || "random",
    hostName: room.players.find(p => p.reconnectToken === room.hostPlayerToken)?.name || "Host"
  };
}

function listPublicRooms() {
  return [...rooms.values()]
    .filter(r => r.isPublic && r.phase === "lobby")
    .sort((a,b) => b.players.filter(p=>!p.bot).length - a.players.filter(p=>!p.bot).length || b.createdAt-a.createdAt)
    .slice(0, 30)
    .map(publicRoomSummary);
}

function listSpectatableRooms() {
  return [...rooms.values()]
    .filter(r => r.isPublic && r.phase !== "lobby" && r.spectatorsEnabled !== false)
    .sort((a,b) => b.lastActivityAt-a.lastActivityAt)
    .slice(0, 30)
    .map(publicRoomSummary);
}

function assignNextHost(room) {
  const next = room.players.find(p => !p.bot && p.connected && p.reconnectToken);
  if (!next) return false;
  room.hostPlayerToken = next.reconnectToken;
  room.hostSocket = next.id;
  addLog(room, `${next.name} is now the room host.`);
  return true;
}

function scheduleHostReassign(room, disconnectedToken) {
  clearTimeout(room.hostReassignTimer);
  room.hostReassignTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.hostPlayerToken !== disconnectedToken) return;
    const oldHost = room.players.find(p => p.reconnectToken === disconnectedToken);
    if (oldHost?.connected) return;
    if (assignNextHost(room)) emitRoom(room);
  }, HOST_REASSIGN_GRACE_MS);
  room.hostReassignTimer.unref?.();
}

function scheduleLobbyEviction(room, reconnectToken) {
  const timer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    const index = room.players.findIndex(p => p.reconnectToken === reconnectToken);
    if (index < 0 || room.players[index].connected || room.phase !== "lobby") return;
    const wasHost = room.hostPlayerToken === reconnectToken;
    const [removed] = room.players.splice(index, 1);
    addLog(room, `${removed.name} left the lobby.`);
    if (!room.players.length) return destroyRoom(room, "empty");
    if (wasHost) assignNextHost(room);
    emitRoom(room);
  }, LOBBY_RECONNECT_GRACE_MS);
  timer.unref?.();
}

function scheduleInGameReconnectExpiry(room, reconnectToken) {
  const p = room.players.find(x => x.reconnectToken === reconnectToken);
  if (!p) return;
  clearTimeout(p.disconnectTimer);
  p.reconnectUntil = Date.now() + RECONNECT_GRACE_MS;
  p.disconnectTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    const index = room.players.findIndex(x => x.reconnectToken === reconnectToken);
    if (index < 0) return;
    const player = room.players[index];
    if (player.connected) return;
    const wasHost = room.hostPlayerToken === reconnectToken;

    // If this expiry would leave no real player able to return, end the room
    // instead of allowing bots to continue playing by themselves.
    if (!connectedHumans(room).length && !hasReconnectableHuman(room, index)) {
      addLog(room, `No real players remain. The match has been stopped.`);
      return destroyRoom(room, "no-human-players");
    }

    player.bot = true;
    player.autoControlled = false;
    player.connected = true;
    player.reconnectToken = null;
    player.reconnectUntil = null;
    player.id = `bot-expired-${room.code}-${index}-${Date.now()}`;
    player.name = player.name.replace(/\s*\(Bot\)$/i, "") + " (Bot)";
    addLog(room, `${player.name} did not reconnect in time; a bot keeps this seat while real players remain.`);
    if (wasHost) assignNextHost(room);
    emitRoom(room);
    scheduleBot(room);
  }, RECONNECT_GRACE_MS);
  p.disconnectTimer.unref?.();
}

function validateVoiceSignal(signal) {
  if (!signal || typeof signal !== "object" || !["offer","answer","candidate"].includes(signal.kind)) return false;
  let raw = "";
  try { raw = JSON.stringify(signal); } catch { return false; }
  if (raw.length > 16_000) return false;
  if (signal.kind === "offer" || signal.kind === "answer") {
    return signal.description && signal.description.type === signal.kind && typeof signal.description.sdp === "string" && signal.description.sdp.length <= 12_000;
  }
  return signal.candidate && typeof signal.candidate === "object";
}

io.on("connection", socket => {
  analytics.connections++;
  socket.on("pingCheck", (_, ack) => ack?.({ ok:true, serverTime:Date.now() }));
  socket.on("serverInfo",(_,ack)=>ack?.({ok:true,version:GAME_VERSION,minClientVersion:MIN_CLIENT_VERSION,maintenance:MAINTENANCE_MODE,maintenanceMessage:MAINTENANCE_MESSAGE,region:REGION_ID,season:currentSeasonId()}));
  socket.on("roomQr",async(payload={},ack)=>{try{const code=String(payload.code||findRoomBySocket(socket.id)?.room?.code||"").toUpperCase();if(!code)return ack?.({ok:false,error:"Room unavailable."});const base=String(process.env.PUBLIC_GAME_URL||process.env.RENDER_EXTERNAL_URL||"https://three-spades.onrender.com").replace(/\/$/,"");const url=`${base}/?room=${encodeURIComponent(code)}`;const dataUrl=await QRCode.toDataURL(url,{margin:1,width:320,errorCorrectionLevel:"M"});ack?.({ok:true,code,url,dataUrl});}catch(e){ack?.({ok:false,error:"QR unavailable."});}});
  socket.on("clientMode", (payload={},ack)=>{socket.data.lowNetwork=Boolean(payload?.lowNetwork);ack?.({ok:true,lowNetwork:socket.data.lowNetwork});});


  socket.on("accountRegister", (payload={},ack)=>{
    if(!takeRate(socket,"accountRegister",5,60_000,"ip"))return rejectRate(ack);
    const username=normalizeUsername(payload.username), password=String(payload.password||""); if(username.length<3)return ack?.({ok:false,error:"Username needs at least 3 characters."}); if(password.length<6)return ack?.({ok:false,error:"Password needs at least 6 characters."}); if(findUserByUsername(username))return ack?.({ok:false,error:"Username already exists."});
    const {salt,hash}=hashPassword(password), id=crypto.randomUUID(); const u={id,username,displayName:cleanName(payload.displayName||username),avatar:cleanAvatar(payload.avatar),salt,passwordHash:hash,createdAt:Date.now(),friends:[],friendRequests:[],achievements:[],stats:{rounds:0,wins:0,losses:0,points:0,tricksWon:0,highestBid:0},seasons:{},settings:{theme:"classic",cardBack:"emerald",largeText:false,highContrast:false},daily:{}}; users.set(id,u);ensureSeason(u);const token=issueSession(id);socket.data.userId=id;persistAccountsSoon();ack?.({ok:true,token,user:publicUser(u)});
  });
  socket.on("accountLogin",(payload={},ack)=>{ if(!takeRate(socket,"accountLogin",10,60_000,"ip"))return rejectRate(ack); const u=findUserByUsername(payload.username);if(u?.bannedUntil>Date.now())return ack?.({ok:false,error:`Account suspended: ${u.banReason||"moderator action"}`});if(!u||!verifyPassword(String(payload.password||""),u))return ack?.({ok:false,error:"Incorrect username or password."});const token=issueSession(u.id);socket.data.userId=u.id;ack?.({ok:true,token,user:publicUser(u)}); });
  socket.on("accountResume",(payload={},ack)=>{const sess=accountSessions.get(String(payload.token||""));const u=sess&&users.get(sess.userId);if(!u||u.bannedUntil>Date.now())return ack?.({ok:false});socket.data.userId=u.id;ack?.({ok:true,user:publicUser(u)});});
  socket.on("accountLogout",(_,ack)=>{socket.data.userId=null;ack?.({ok:true});});
  socket.on("accountMe",(_,ack)=>ack?.({ok:true,user:publicUser(userForSocket(socket))}));
  socket.on("accountProfile",(payload={},ack)=>{const u=userForSocket(socket);if(!u)return ack?.({ok:false,error:"Sign in first."}); if(payload.displayName)u.displayName=cleanName(payload.displayName);if(payload.avatar)u.avatar=cleanAvatar(payload.avatar);const allowedThemes=["classic","royal","midnight","gujarat"],backs=["emerald","royal","blackgold","traditional"];u.settings||={};if(allowedThemes.includes(payload.theme))u.settings.theme=payload.theme;if(backs.includes(payload.cardBack))u.settings.cardBack=payload.cardBack;u.settings.largeText=Boolean(payload.largeText);u.settings.highContrast=Boolean(payload.highContrast);persistAccountsSoon();ack?.({ok:true,user:publicUser(u)});});
  socket.on("friendSearch",(payload={},ack)=>{const q=normalizeUsername(payload.username);const rows=[...users.values()].filter(u=>u.username.includes(q)).slice(0,10).map(u=>({id:u.id,username:u.username,displayName:u.displayName,avatar:u.avatar}));ack?.({ok:true,rows});});
  socket.on("friendRequest",(payload={},ack)=>{const me=userForSocket(socket),target=users.get(String(payload.userId||""));if(!me||!target||me.id===target.id)return ack?.({ok:false,error:"Invalid friend request."});target.friendRequests||=[];if(!target.friendRequests.includes(me.id))target.friendRequests.push(me.id);persistAccountsSoon();for(const s2 of io.sockets.sockets.values())if(s2.data?.userId===target.id)s2.emit("friendRequestReceived",{from:{id:me.id,username:me.username,displayName:me.displayName,avatar:me.avatar}});ack?.({ok:true});});
  socket.on("friendRespond",(payload={},ack)=>{const me=userForSocket(socket),from=users.get(String(payload.userId||""));if(!me||!from)return ack?.({ok:false,error:"Request not found."});me.friendRequests=(me.friendRequests||[]).filter(id=>id!==from.id);if(payload.accept){me.friends||=[];from.friends||=[];if(!me.friends.includes(from.id))me.friends.push(from.id);if(!from.friends.includes(me.id))from.friends.push(me.id);}persistAccountsSoon();ack?.({ok:true,user:publicUser(me)});});
  socket.on("friendList",(_,ack)=>{const me=userForSocket(socket);if(!me)return ack?.({ok:false,error:"Sign in first."});const online=new Set([...io.sockets.sockets.values()].map(s=>s.data?.userId).filter(Boolean));const rows=(me.friends||[]).map(id=>users.get(id)).filter(Boolean).map(u=>({id:u.id,username:u.username,displayName:u.displayName,avatar:u.avatar,online:online.has(u.id)}));const requests=(me.friendRequests||[]).map(id=>users.get(id)).filter(Boolean).map(u=>({id:u.id,username:u.username,displayName:u.displayName,avatar:u.avatar}));ack?.({ok:true,rows,requests});});
  socket.on("inviteFriend",(payload={},ack)=>{const me=userForSocket(socket),found=findRoomBySocket(socket.id);if(!me||!found)return ack?.({ok:false,error:"Join a room first."});const targetId=String(payload.userId||"");if(!(me.friends||[]).includes(targetId))return ack?.({ok:false,error:"That player is not on your friends list."});let sent=0;for(const s2 of io.sockets.sockets.values())if(s2.data?.userId===targetId){s2.emit("roomInvite",{from:me.displayName,code:found.room.code});sent++;}ack?.({ok:Boolean(sent),error:sent?null:"Friend is offline."});});
  socket.on("rankedJoin",(payload={},ack)=>{if(MAINTENANCE_MODE)return ack?.({ok:false,error:MAINTENANCE_MESSAGE});const me=userForSocket(socket);if(!me)return ack?.({ok:false,error:"Sign in to play ranked."});if(findRoomBySocket(socket.id))return ack?.({ok:false,error:"Leave your room first."});const pc=[3,4,5,6,7,8].includes(Number(payload.playerCount))?Number(payload.playerCount):4;const dc=pc===4&&Number(payload.deckCount)===2?2:deckCountFor(pc);removeFromRankedQueue(socket.id);const rating=ensureSeason(me).rating;const key=rankedQueueKey(pc,dc,rating),q=rankedQueues.get(key)||[];q.push({socketId:socket.id,userId:me.id,joinedAt:Date.now(),deckCount:dc});rankedQueues.set(key,q);ack?.({ok:true,position:q.length,needed:pc,season:currentSeasonId(),rating:ensureSeason(me).rating,deckCount:dc});io.to(socket.id).emit("rankedQueueStatus",{position:q.length,needed:pc,deckCount:dc});checkRankedQueue(pc,dc,rating);});
  socket.on("rankedCancel",(_,ack)=>{removeFromRankedQueue(socket.id);ack?.({ok:true});});
  socket.on("rankedConfirm",(_,ack)=>{const found=findRoomBySocket(socket.id);if(!found||!found.room.ranked||found.room.phase!=="lobby")return ack?.({ok:false,error:"No ranked match to confirm."});found.room.players[found.index].rankedConfirmed=true;emitRoom(found.room);const humans=found.room.players.filter(p=>!p.bot);if(humans.length===found.room.playerCount&&humans.every(p=>p.rankedConfirmed))setTimeout(()=>startRound(found.room),500);ack?.({ok:true});});
  socket.on("seasonInfo",(_,ack)=>{const me=userForSocket(socket);const rows=[...users.values()].map(u=>{const ss=ensureSeason(u);return {name:u.displayName,avatar:u.avatar,rating:ss.rating,games:ss.games,wins:ss.wins};}).sort((a,b)=>b.rating-a.rating).slice(0,50);ack?.({ok:true,season:currentSeasonId(),me:me?publicUser(me):null,rows});});
  socket.on("replayList",(_,ack)=>{const me=userForSocket(socket);const rows=replays.filter(r=>!me||r.players.some(p=>p.accountId===me.id)).slice(-30).reverse().map(r=>({id:r.id,createdAt:r.createdAt,playerCount:r.playerCount,round:r.round,ranked:r.ranked,players:r.players.map(p=>p.name),made:r.made,bid:r.bid}));ack?.({ok:true,rows});});
  socket.on("replayGet",(payload={},ack)=>{const r=replays.find(x=>x.id===String(payload.id||""));if(!r)return ack?.({ok:false,error:"Replay not found."});ack?.({ok:true,replay:r});});
  socket.on("matchAudit",(_,ack)=>{const found=findRoomBySocket(socket.id)||findSpectatorRoomBySocket(socket.id);const room=found?.room;if(!room)return ack?.({ok:false,error:"Not in a room."});ack?.({ok:true,audit:{auditId:room.auditId,ruleSummary:ruleSummaryFor(room),integrity:{...(room.integrity||{})},bidHistory:(room.bidHistory||[]).slice(),trickHistory:(room.trickHistory||[]).slice(),scoreLedger:(room.scoreLedger||[]).slice(),series:room.series||null,roundSummary:room.roundSummary||null}});});
  socket.on("tournamentList",(_,ack)=>ack?.({ok:true,rows:[...tournaments.values()].map(tournamentPublic).slice(-30).reverse()}));
  socket.on("tournamentCreate",(payload={},ack)=>{const me=userForSocket(socket);if(!me)return ack?.({ok:false,error:"Sign in first."});const size=[8,16,32].includes(Number(payload.size))?Number(payload.size):8;const id=crypto.randomBytes(4).toString("hex").toUpperCase(),t={id,name:cleanName(payload.name||`Tournament ${id}`),size,status:"open",entrants:[me.id],createdBy:me.id,createdAt:Date.now(),round:0,activeRooms:[],stageWinners:[]};tournaments.set(id,t);persistAccountsSoon();ack?.({ok:true,tournament:tournamentPublic(t)});});
  socket.on("tournamentJoin",(payload={},ack)=>{const me=userForSocket(socket),t=tournaments.get(String(payload.id||"").toUpperCase());if(!me||!t||t.status!=="open")return ack?.({ok:false,error:"Tournament is not open."});if(!t.entrants.includes(me.id))t.entrants.push(me.id);persistAccountsSoon();maybeStartTournament(t);ack?.({ok:true,tournament:tournamentPublic(t)});});

  socket.on("rtcConfig", (_, ack) => {
    const iceServers = [{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}];
    if (TURN_URL) iceServers.push({ urls:TURN_URL, username:TURN_USERNAME || undefined, credential:TURN_CREDENTIAL || undefined });
    ack?.({ ok:true, iceServers });
  });

  socket.on("listPublicRooms", (_, ack) => ack?.({ ok:true, rooms:listPublicRooms(), spectate:listSpectatableRooms() }));
  socket.on("leaderboard", (_, ack) => {
    const rows=[...leaderboard.values()].sort((a,b)=>b.wins-a.wins || b.score-a.score || a.rounds-b.rounds).slice(0,50);
    ack?.({ ok:true, rows });
  });

  socket.on("clientError", (payload = {}) => {
    if (!takeRate(socket, "clientError", 10, 60_000)) return;
    analytics.clientErrors++; clientErrors.push({ts:Date.now(),socket:socket.id,message:String(payload?.message||"").slice(0,500)}); if(clientErrors.length>200)clientErrors.shift();
    console.warn("CLIENT_ERROR", {
      socket: socket.id,
      message: String(payload?.message || "").slice(0,500),
      stack: String(payload?.stack || "").slice(0,1500),
      url: String(payload?.url || "").slice(0,300)
    });
  });

  socket.on("quickMatch", (payload = {}, ack) => {
    if(MAINTENANCE_MODE)return ack?.({ok:false,error:MAINTENANCE_MESSAGE});
    if (!takeRate(socket, "quickMatch", 12, 60_000, "ip")) return rejectRate(ack);
    if (findRoomBySocket(socket.id) || findSpectatorRoomBySocket(socket.id)) return ack?.({ok:false,error:"Leave your current room first."});
    const preferred = [3,4,5,6,7,8].includes(Number(payload?.playerCount)) ? Number(payload.playerCount) : 8;
    const preferredDeckCount = preferred === 4 && Number(payload?.deckCount) === 2 ? 2 : deckCountFor(preferred);
    let room = [...rooms.values()].find(r => r.isPublic && r.phase === "lobby" && r.playerCount === preferred && roomDeckCount(r) === preferredDeckCount && r.players.length < r.playerCount);
    if (!room && preferred !== 4) room = [...rooms.values()].find(r => r.isPublic && r.phase === "lobby" && r.players.length < r.playerCount);
    const player = makeHumanPlayer(socket.id, cleanName(payload?.name), cleanAvatar(payload?.avatar), socket.data.userId || null);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return ack?.({ok:false,error:"Servers are busy right now."});
      const code = roomCode();
      room = createRoomState(code, socket.id, player.name, player.avatar, preferred, socket.data.userId || null, preferredDeckCount);
      room.isPublic = true; room.quickMatch = true;
      room.botDifficulty = ["easy","normal","hard"].includes(payload?.botDifficulty) ? payload.botDifficulty : "normal";
      room.botPersonality = ["balanced","aggressive","conservative","partner"].includes(payload?.botPersonality) ? payload.botPersonality : "balanced";
      room.turnTimeoutMs = 60_000; room.spectatorDelayMs = 5000; room.preset="classic";
      room.voiceEnabled=true;room.spectatorsEnabled=true;room.tableTheme="classic";room.seriesBestOf=1;room.teamMode="random";resetSeries(room,false);
      room.players[0] = player;
      room.hostPlayerToken = player.reconnectToken; room.hostSocket = socket.id;
      rooms.set(code, room);
    } else {
      room.players.push(player);
      touchRoom(room);
    }
    socket.join(room.code);
    ack?.({ok:true,code:room.code,reconnectToken:player.reconnectToken});
    emitRoom(room);
  });

  socket.on("spectateRoom", (payload = {}, ack) => {
    if (!takeRate(socket, "spectateRoom", 20, 60_000, "ip")) return rejectRate(ack);
    if (findRoomBySocket(socket.id) || findSpectatorRoomBySocket(socket.id)) return ack?.({ok:false,error:"Leave your current room first."});
    const key=String(payload?.code||"").trim().toUpperCase().slice(0,5);
    const room=rooms.get(key);
    if(!room) return ack?.({ok:false,error:"Room not found."});
    if(room.spectatorsEnabled===false) return ack?.({ok:false,error:"Spectators are disabled for this room."});
    const spec={name:cleanName(payload?.name),avatar:cleanAvatar(payload?.avatar),joinedAt:Date.now()};
    room.spectators.set(socket.id,spec); socket.join(key); touchRoom(room);
    ack?.({ok:true,code:key});
    emitRoom(room);
  });

  socket.on("createRoom", (payload = {}, ack) => {
    if(MAINTENANCE_MODE)return ack?.({ok:false,error:MAINTENANCE_MESSAGE});
    if (!takeRate(socket, "createRoom", 6, 60_000, "ip")) return rejectRate(ack);
    if (findRoomBySocket(socket.id)) return ack?.({ ok:false, error:"Leave your current room before creating another." });
    if (rooms.size >= MAX_ROOMS) return ack?.({ ok:false, error:"Servers are busy right now. Please try again shortly." });
    const pc = Number(payload?.playerCount);
    if (![3,4,5,6,7,8].includes(pc)) return ack?.({ ok:false, error:"Choose 3, 4, 5, 6, 7, or 8 players." });

    const code = roomCode();
    const requestedDeckCount = pc === 4 && Number(payload?.deckCount) === 2 ? 2 : 1;
    const room = createRoomState(code, socket.id, cleanName(payload?.name), cleanAvatar(payload?.avatar), pc, socket.data.userId || null, requestedDeckCount);
    room.isPublic = Boolean(payload?.isPublic);
    room.turnTimeoutMs = normalizeTurnTimeoutMs(payload?.turnTimeoutMs);
    room.spectatorDelayMs = normalizeSpectatorDelayMs(payload?.spectatorDelayMs);
    room.preset = ["classic","fast","double","practice"].includes(String(payload?.preset||"")) ? String(payload.preset) : "classic";
    room.voiceEnabled = payload?.voiceEnabled !== false;
    room.spectatorsEnabled = payload?.spectatorsEnabled !== false;
    room.tableTheme = normalizeRoomTheme(payload?.tableTheme);
    room.seriesBestOf = normalizeSeriesBestOf(payload?.seriesBestOf);
    room.teamMode = normalizeTeamMode(payload?.teamMode, pc);
    resetSeries(room,false);
    const pin=String(payload?.privatePin||"").trim(); if(pin){if(!/^\d{4,8}$/.test(pin))return ack?.({ok:false,error:"Room PIN must be 4–8 digits."});room.privatePinHash=crypto.createHash("sha256").update(pin).digest("hex");}
    analytics.roomsCreated++;
    room.botDifficulty = ["easy","normal","hard"].includes(payload?.botDifficulty) ? payload.botDifficulty : "normal";
    room.botPersonality = ["balanced","aggressive","conservative","partner"].includes(payload?.botPersonality) ? payload.botPersonality : "balanced";
    if (room.preset === "practice") { room.botDifficulty="easy"; room.isPublic=false; }
    rooms.set(code, room);
    socket.join(code);
    const token = room.players[0].reconnectToken;
    ack?.({ ok:true, code, reconnectToken:token });
    emitRoom(room);
  });

  socket.on("joinRoom", (payload = {}, ack) => {
    if(MAINTENANCE_MODE)return ack?.({ok:false,error:MAINTENANCE_MESSAGE});
    if (!takeRate(socket, "joinRoom", 20, 60_000, "ip")) return rejectRate(ack);
    if (findRoomBySocket(socket.id)) return ack?.({ ok:false, error:"Leave your current room before joining another." });
    const key = String(payload?.code || "").trim().toUpperCase().slice(0, 5);
    const room = rooms.get(key);
    if (!room) return ack?.({ ok:false, error:"Room not found." });
    if (room.phase !== "lobby") return ack?.({ ok:false, error:"This game already started." });
    if (room.players.length >= room.playerCount) return ack?.({ ok:false, error:"Room is full." });
    if(room.privatePinHash){const ph=crypto.createHash("sha256").update(String(payload?.privatePin||"").trim()).digest("hex");if(ph!==room.privatePinHash)return ack?.({ok:false,error:"Incorrect room PIN."});}

    const player = makeHumanPlayer(socket.id, cleanName(payload?.name), cleanAvatar(payload?.avatar), socket.data.userId || null);
    room.players.push(player);
    touchRoom(room);
    socket.join(key);
    ack?.({ ok:true, code:key, reconnectToken:player.reconnectToken });
    emitRoom(room);
  });

  socket.on("resumeSession", (payload = {}, ack) => {
    if (!takeRate(socket, "resumeSession", 12, 60_000)) return rejectRate(ack);
    const key = String(payload?.code || "").trim().toUpperCase().slice(0, 5);
    const token = String(payload?.reconnectToken || "");
    if (!/^[a-f0-9]{48}$/i.test(token)) return ack?.({ ok:false, error:"Invalid reconnect session." });
    const room = rooms.get(key);
    if (!room) return ack?.({ ok:false, error:"That room has expired." });
    const index = room.players.findIndex(p => !p.bot && p.reconnectToken === token);
    if (index < 0) return ack?.({ ok:false, error:"Reconnect seat not found." });

    const p = room.players[index];
    const oldSocketId = p.id;
    const wasDisconnected = !p.connected || p.autoControlled;
    const missedFromRound = Number(p.disconnectedRound || room.round);
    const missedFromTrick = Number(p.disconnectedTrickNumber ?? room.trickNumber);
    p.id = socket.id;
    p.connected = true;
    p.autoControlled = false;
    const missedTricks=Math.max(0,Number(room.trickNumber||0)-Number(p.disconnectedAtTrick||room.trickNumber||0));
    p.lastSeenAt = Date.now();
    p.reconnectUntil = null;
    clearTimeout(p.disconnectTimer); p.disconnectTimer = null;
    p.voiceJoined = false;
    p.voiceMuted = false;
    if (room.hostPlayerToken === token) room.hostSocket = socket.id;
    room.emptySince = null;
    touchRoom(room);
    socket.join(key);

    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) { oldSocket.leave(key); oldSocket.disconnect(true); }
    }
    if (wasDisconnected) addLog(room, `${p.name} reconnected to seat ${index + 1}.`);
    if (actionActor(room) === index) clearActionSchedule(room);
    ack?.({ ok:true, code:key, reconnectToken:token, viewerIndex:index, missedTricks, auditId:room.auditId||null,
      snapshot:{phase:room.phase,bid:room.bid?.current??null,trump:room.trump||null,calledPartners:(room.calledPartners||[]).map(publicCard),trickNumber:Number(room.trickNumber||0),totalTricks:totalTricksFor(room),turnIndex:Number(room.turnIndex||0),actionDeadline:room.actionDeadline||null,series:room.series||null} });
    emitRoom(room);
    scheduleBot(room);
  });

  socket.on("leaveRoom", (_, ack) => {
    const specFound = findSpectatorRoomBySocket(socket.id);
    if (specFound) {
      specFound.room.spectators.delete(socket.id);
      socket.leave(specFound.room.code);
      emitRoom(specFound.room);
      return ack?.({ok:true});
    }
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:true });
    const { room, index } = found;
    const p = room.players[index];
    const wasHost = p.reconnectToken && room.hostPlayerToken === p.reconnectToken;
    if (p.voiceJoined) socket.to(room.code).emit("voicePeerLeft", { playerIndex:index });

    if (room.phase === "lobby") {
      room.players.splice(index, 1);
      if (!room.players.length) {
        socket.leave(room.code);
        destroyRoom(room, "empty");
        return ack?.({ ok:true });
      }
      if (wasHost) assignNextHost(room);
    } else {
      // If the departing player is the final real-player seat, close the room
      // immediately. Bots are never allowed to finish a match alone.
      const otherHumanSeatExists = room.players.some((x, i) => i !== index && !x.bot);
      if (!otherHumanSeatExists) {
        socket.leave(room.code);
        addLog(room, `The last real player left. The match has been stopped.`);
        destroyRoom(room, "no-human-players");
        return ack?.({ ok:true });
      }

      p.bot = true;
      p.autoControlled = false;
      p.connected = true;
      p.voiceJoined = false;
      p.voiceMuted = false;
      p.reconnectToken = null;
      p.id = `bot-left-${room.code}-${index}-${Date.now()}`;
      p.name = p.name.replace(/\s*\(Bot\)$/i, "") + " (Bot)";
      addLog(room, `${p.name} will finish the game automatically while real players remain.`);
      if (wasHost) assignNextHost(room);
      if (actionActor(room) === index) clearActionSchedule(room);
    }
    touchRoom(room);
    socket.leave(room.code);
    ack?.({ ok:true });
    emitRoom(room);
    scheduleBot(room);
  });

  socket.on("toggleReady", (_, ack) => {
    const found=findRoomBySocket(socket.id);
    if(!found) return ack?.({ok:false,error:"Room not found."});
    const {room,index}=found;
    if(room.phase!=="lobby") return ack?.({ok:false,error:"Ready is only used in the lobby."});
    const p=room.players[index]; if(p.bot) return ack?.({ok:false,error:"Bots are always ready."});
    p.ready=!p.ready; touchRoom(room); ack?.({ok:true,ready:p.ready}); emitRoom(room);
  });

  socket.on("setRoomOptions", (payload={}, ack) => {
    const found=findRoomBySocket(socket.id);
    if(!found) return ack?.({ok:false,error:"Room not found."});
    const {room,index}=found;
    if(room.players[index].reconnectToken!==room.hostPlayerToken || room.phase!=="lobby") return ack?.({ok:false,error:"Only the host can change lobby options."});
    if(["easy","normal","hard"].includes(payload?.botDifficulty)) room.botDifficulty=payload.botDifficulty;
    if(typeof payload?.isPublic==="boolean") room.isPublic=payload.isPublic;
    const sec=Number(payload?.turnTimeoutSec); if([30,45,60,90].includes(sec)) room.turnTimeoutMs=sec*1000;
    const sd=Number(payload?.spectatorDelaySec); if([0,5,10].includes(sd)) room.spectatorDelayMs=sd*1000;
    if(!room.ranked && payload?.turnTimeoutMs!=null) room.turnTimeoutMs=normalizeTurnTimeoutMs(payload.turnTimeoutMs);
    if(!room.ranked && payload?.spectatorDelayMs!=null) room.spectatorDelayMs=normalizeSpectatorDelayMs(payload.spectatorDelayMs);
    touchRoom(room); ack?.({ok:true}); emitRoom(room);
  });

  socket.on("kickPlayer", (payload={}, ack) => {
    if(!takeRate(socket,"kickPlayer",10,30_000)) return rejectRate(ack);
    const found=findRoomBySocket(socket.id); if(!found) return ack?.({ok:false,error:"Room not found."});
    const {room,index}=found; const targetIndex=Number(payload?.playerIndex);
    if(room.players[index].reconnectToken!==room.hostPlayerToken) return ack?.({ok:false,error:"Only the host can remove players."});
    if(!Number.isInteger(targetIndex)||targetIndex<0||targetIndex>=room.players.length||targetIndex===index) return ack?.({ok:false,error:"Invalid player."});
    const target=room.players[targetIndex]; if(target.bot) return ack?.({ok:false,error:"That seat is already a bot."});
    const targetSocket=io.sockets.sockets.get(target.id);
    if(room.phase==="lobby"){
      room.players.splice(targetIndex,1);
    } else {
      target.bot=true;target.connected=true;target.autoControlled=false;target.reconnectToken=null;target.reconnectUntil=null;
      target.id=`bot-kicked-${room.code}-${targetIndex}-${Date.now()}`;target.name=target.name.replace(/\s*\(Bot\)$/i,"")+" (Bot)";
    }
    targetSocket?.emit("kicked",{reason:"Removed by host"}); targetSocket?.leave(room.code);
    addLog(room,`${target.name} was removed by the host.`); touchRoom(room); ack?.({ok:true}); emitRoom(room); scheduleBot(room);
  });

  socket.on("reportPlayer", (payload={}, ack) => {
    if(!takeRate(socket,"reportPlayer",5,60_000)) return rejectRate(ack);
    const found=findRoomBySocket(socket.id); if(!found) return ack?.({ok:false,error:"Room not found."});
    const targetIndex=Number(payload?.playerIndex);
    if(!Number.isInteger(targetIndex)||targetIndex<0||targetIndex>=found.room.players.length||targetIndex===found.index) return ack?.({ok:false,error:"Invalid player."});
    const rec={room:found.room.code,reporter:found.room.players[found.index].name,reporterAccountId:found.room.players[found.index].accountId||null,target:found.room.players[targetIndex].name,targetAccountId:found.room.players[targetIndex].accountId||null,reason:cleanChat(payload?.reason||"Player report"),ts:Date.now()};
    reports.push(rec); analytics.reports++; if(reports.length>500) reports.shift(); console.warn("PLAYER_REPORT",rec);
    ack?.({ok:true});
  });

  socket.on("reclaimControl",(_,ack)=>{const found=findRoomBySocket(socket.id);if(!found)return ack?.({ok:false,error:"Not in a room."});const p=found.room.players[found.index];if(p.bot)return ack?.({ok:false,error:"Bot seat."});p.autoControlled=false;p.timeoutStreak=0;addLog(found.room,`${p.name} reclaimed control from Bot Assist.`);emitRoom(found.room);scheduleBot(found.room);ack?.({ok:true});});

  socket.on("rematch", (_, ack) => {
    const found=findRoomBySocket(socket.id); if(!found) return ack?.({ok:false,error:"Room not found."});
    const {room,index}=found; if(room.phase!=="roundEnd") return ack?.({ok:false,error:"Round is not finished."});
    const p=room.players[index]; p.rematchReady=!p.rematchReady; touchRoom(room); ack?.({ok:true,ready:p.rematchReady}); emitRoom(room);
    const humans=room.players.filter(x=>!x.bot&&x.connected);
    if(humans.length && humans.every(x=>x.rematchReady)) setTimeout(()=>{ if(rooms.has(room.code)&&room.phase==="roundEnd"){if(room.series?.complete)resetSeries(room,room.teamMode==="fixed"&&!!room.fixedTeams);startRound(room);} },450);
  });

  socket.on("newSeries", (payload={}, ack) => {
    if(!takeRate(socket,"newSeries",8,10_000))return rejectRate(ack);
    const found=findRoomBySocket(socket.id);if(!found)return ack?.({ok:false,error:"Room not found."});
    const {room,index}=found;if(room.players[index].reconnectToken!==room.hostPlayerToken)return ack?.({ok:false,error:"Only the host can start a new series."});
    if(room.phase!=="roundEnd")return ack?.({ok:false,error:"Finish the current round first."});
    const sameTeams=Boolean(payload?.sameTeams);
    if(sameTeams){
      if(!fixedTeamsEligible(room.playerCount))return ack?.({ok:false,error:"Same-team rematch is available for 4, 6 and 8 players."});
      const a=(room.roundSummary?.bidderTeamIndexes||room.bidderTeam||[]).slice(),b=(room.roundSummary?.defenseTeamIndexes||[]).slice();
      if(a.length!==b.length)return ack?.({ok:false,error:"This player mode does not have equal team sizes."});
      room.teamMode="fixed";room.fixedTeams={A:a,B:b};resetSeries(room,true);
    } else { room.teamMode=normalizeTeamMode(payload?.teamMode||room.teamMode,room.playerCount); resetSeries(room,false); }
    touchRoom(room);ack?.({ok:true});startRound(room);
  });

  socket.on("startGame", (_, ack) => {
    if (!takeRate(socket, "startGame", 10, 10_000)) return rejectRate(ack);
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:false, error:"Room not found." });
    const { room, index } = found;
    if (room.players[index].reconnectToken !== room.hostPlayerToken) return ack?.({ ok:false, error:"Only the host can start." });
    if (room.phase !== "lobby" && room.phase !== "roundEnd") return ack?.({ ok:false, error:"The game is already running." });
    if(room.ranked && room.phase==="lobby" && room.players.some(p=>!p.bot&&!p.rankedConfirmed)) return ack?.({ok:false,error:"Every ranked player must confirm the match."});
    if (room.phase === "lobby") {
      const humans = room.players.filter(p => !p.bot && p.connected);
      if (humans.some(p => !p.ready)) return ack?.({ok:false,error:"Every connected player must press Ready before the host starts."});
    }
    room.players.forEach(p => { if (!p.bot && !p.connected) p.autoControlled = true; });
    while (room.players.length < room.playerCount) addBot(room, room.players.length + 1);
    touchRoom(room);
    ack?.({ ok:true });
    startRound(room);
  });

  socket.on("bid", (payload = {}, ack) => {
    if (!takeRate(socket, "bid", 30, 10_000)) return rejectRate(ack);
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:false, error:"Room not found." });
    const ok = handleBid(found.room, found.index, payload?.amount, Boolean(payload?.pass));
    ack?.(ok ? { ok:true } : { ok:false, error:`Invalid bid. Use ${bidIncrementFor(found.room)}-point steps between ${minBidFor(found.room)} and ${maxBidFor(found.room)}.` });
  });

  socket.on("contract", (payload = {}, ack) => {
    if (!takeRate(socket, "contract", 12, 10_000)) return rejectRate(ack);
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:false, error:"Room not found." });
    const partnerCards = Array.isArray(payload?.partnerCards) ? payload.partnerCards.slice(0, 3) : [];
    const result = chooseContract(found.room, found.index, String(payload?.trump || ""), partnerCards);
    ack?.(result);
  });

  socket.on("playCard", (payload = {}, ack) => {
    if (!takeRate(socket, "playCard", 30, 10_000)) return rejectRate(ack);
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:false, error:"Room not found." });
    const cardId = String(payload?.cardId || "").slice(0, 16);
    const ok = playCard(found.room, found.index, cardId);
    ack?.(ok ? { ok:true } : { ok:false, error:"That card cannot be played now." });
  });

  socket.on("nextRound", (_, ack) => {
    if (!takeRate(socket, "nextRound", 10, 10_000)) return rejectRate(ack);
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:false, error:"Room not found." });
    const { room, index } = found;
    if (room.players[index].reconnectToken !== room.hostPlayerToken || room.phase !== "roundEnd") return ack?.({ ok:false, error:"Only the host can deal the next round." });
    if(room.series?.complete) return ack?.({ok:false,error:"Series is finished. Start a new series or rematch."});
    touchRoom(room);
    ack?.({ ok:true });
    startRound(room);
  });

  socket.on("tableReaction",(payload={},ack)=>{const found=findRoomBySocket(socket.id);if(!found)return ack?.({ok:false,error:"Not in a room."});const allowed=new Set(["😂","🔥","👏","😎","🤝","😤","👍","❤️"]),emoji=String(payload.emoji||"");if(!allowed.has(emoji))return ack?.({ok:false,error:"Invalid reaction."});io.to(found.room.code).emit("tableReaction",{playerIndex:found.index,emoji,ts:Date.now()});ack?.({ok:true});});
  socket.on("hostVoiceMute",(payload={},ack)=>{const found=findRoomBySocket(socket.id);if(!found)return ack?.({ok:false,error:"Not in a room."});const {room,index}=found;if(room.players[index].reconnectToken!==room.hostPlayerToken)return ack?.({ok:false,error:"Host only."});const ti=Number(payload.playerIndex),target=room.players[ti];if(!target||target.bot||ti===index)return ack?.({ok:false,error:"Invalid player."});target.voiceMuted=true;io.to(target.id).emit("forceVoiceMute",{reason:"Muted by host"});io.to(room.code).emit("voiceMuteState",{playerIndex:ti,muted:true});emitRoom(room);ack?.({ok:true});});

  socket.on("chatMessage", (payload = {}, ack) => {
    if (!takeRate(socket, "chat", 8, 10_000)) return rejectRate(ack, "Chat is moving too fast. Please wait a few seconds.");
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:false, error:"Room not found." });
    const { room, index } = found;
    const msg = cleanChat(payload?.text);
    if (!msg) return ack?.({ ok:false, error:"Message is empty." });
    room.chat.push({ id:`${Date.now()}-${crypto.randomBytes(3).toString("hex")}`, playerIndex:index, name:room.players[index].name, avatar:room.players[index].avatar || "😎", text:msg, ts:Date.now() });
    room.chat = room.chat.slice(-40);
    touchRoom(room);
    ack?.({ ok:true });
    emitRoom(room);
  });

  socket.on("voiceJoin", (_, ack) => {
    if (!takeRate(socket, "voiceJoin", 10, 30_000)) return rejectRate(ack);
    const found = findRoomBySocket(socket.id);
    if (!found) return ack?.({ ok:false, error:"Room not found." });
    const { room, index } = found;
    const me = room.players[index];
    if (room.voiceEnabled === false) return ack?.({ok:false,error:"Voice is disabled for this room."});
    if (me.bot) return ack?.({ ok:false, error:"Bots cannot use voice." });
    const peers = room.players.map((p,i)=>({p,i})).filter(x=>x.i!==index && !x.p.bot && x.p.connected && x.p.voiceJoined).map(x=>x.i);
    me.voiceJoined = true; me.voiceMuted = false;
    socket.to(room.code).emit("voicePeerJoined", { playerIndex:index, name:me.name });
    emitRoom(room);
    ack?.({ ok:true, peers });
  });

  socket.on("voiceLeave", () => {
    const found = findRoomBySocket(socket.id);
    if (!found) return;
    const { room, index } = found;
    room.players[index].voiceJoined = false; room.players[index].voiceMuted = false;
    socket.to(room.code).emit("voicePeerLeft", { playerIndex:index });
    emitRoom(room);
  });

  socket.on("voiceMuteState", (payload = {}) => {
    if (!takeRate(socket, "voiceMute", 80, 10_000)) return;
    const found = findRoomBySocket(socket.id);
    if (!found) return;
    found.room.players[found.index].voiceMuted = Boolean(payload?.muted);
    emitRoom(found.room);
  });

  socket.on("voiceSignal", (payload = {}) => {
    if (!takeRate(socket, "voiceSignal", 180, 10_000)) return;
    const found = findRoomBySocket(socket.id);
    const signal = payload?.signal;
    if (!found || !validateVoiceSignal(signal)) return;
    const { room, index } = found;
    const targetIndex = Number(payload?.targetIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= room.players.length) return;
    const target = room.players[targetIndex];
    if (!room.players[index]?.voiceJoined || !target || target.bot || !target.connected || !target.voiceJoined) return;
    io.to(target.id).emit("voiceSignal", { fromIndex:index, signal });
  });

  socket.on("disconnect", () => {
    removeFromRankedQueue(socket.id);
    const specFound=findSpectatorRoomBySocket(socket.id);
    if(specFound){specFound.room.spectators.delete(socket.id);emitRoom(specFound.room);return;}
    const found = findRoomBySocket(socket.id);
    if (!found) return;
    const { room, index } = found;
    const p = room.players[index];
    if (p.voiceJoined) socket.to(room.code).emit("voicePeerLeft", { playerIndex:index });
    p.voiceJoined = false;
    p.voiceMuted = false;
    p.connected = false;
    p.disconnectedAtTrick = Number(room.trickNumber||0);
    p.lastSeenAt = Date.now();
    p.reconnectUntil = Date.now() + RECONNECT_GRACE_MS;

    if (room.phase === "lobby") {
      addLog(room, `${p.name} disconnected — holding the seat for 90 seconds.`);
      scheduleLobbyEviction(room, p.reconnectToken);
    } else {
      p.autoControlled = false;
      addLog(room, `${p.name} disconnected — seat held for 90 seconds. A timed-out turn may be auto-played, but the seat stays theirs during the reconnect window.`);
      scheduleInGameReconnectExpiry(room, p.reconnectToken);
    }
    if (room.hostPlayerToken === p.reconnectToken) scheduleHostReassign(room, p.reconnectToken);
    if (!connectedHumans(room).length && !room.emptySince) room.emptySince = Date.now();
    emitRoom(room);
    if (actionActor(room) === index) clearActionSchedule(room);
    scheduleBot(room);
  });
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const humans = connectedHumans(room);
    if (humans.length) room.emptySince = null;
    else if (!room.emptySince) room.emptySince = now;
    if (room.emptySince && now - room.emptySince >= EMPTY_ROOM_TTL_MS) destroyRoom(room, "empty-timeout");
    else if (now - room.lastActivityAt >= ROOM_IDLE_TTL_MS) destroyRoom(room, "idle-timeout");
  }
  for (const [key, bucket] of rateBuckets) if (now - bucket.startedAt > 10 * 60_000) rateBuckets.delete(key);
}, 60_000);
cleanupTimer.unref?.();

restoreAccounts();
restorePersistentState();
for (const room of rooms.values()) {
  if (room.phase !== "lobby" && room.phase !== "roundEnd") scheduleBot(room);
}

async function configureScaling(){
  const url=String(process.env.REDIS_URL||"").trim(); if(!url)return;
  try{const {createClient}=require("redis"),{createAdapter}=require("@socket.io/redis-adapter");const pub=createClient({url}),sub=pub.duplicate();await Promise.all([pub.connect(),sub.connect()]);io.adapter(createAdapter(pub,sub));console.log("Redis Socket.IO adapter enabled.");}catch(e){console.warn("Redis scaling not enabled:",e.message);}
}
configureScaling().finally(()=>server.listen(PORT,"0.0.0.0",()=>{console.log(`Kaali Ni Tidi v22 running on port ${PORT} · region ${REGION_ID}`);}));
