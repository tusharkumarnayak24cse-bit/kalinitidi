const PACKAGED_GAME_SERVER = window.KNT_CONFIG?.gameServer || "https://three-spades.onrender.com";
// Capacitor Android serves bundled assets from https://localhost. iOS commonly uses capacitor://localhost.
// Treat both as packaged apps so Socket.IO connects to the real multiplayer backend, not the phone itself.
const IS_PACKAGED_APP = location.protocol === "file:" || location.protocol === "capacitor:" || location.hostname === "localhost";
const GAME_SERVER = IS_PACKAGED_APP ? PACKAGED_GAME_SERVER : null;
const socket = GAME_SERVER
  ? io(GAME_SERVER, { transports:["websocket","polling"], timeout:20000, reconnection:true })
  : io({ transports:["websocket","polling"], timeout:20000, reconnection:true });
let state = null;

const $ = id => document.getElementById(id);
const suitSymbol = { S:"♠", H:"♥", D:"♦", C:"♣" };
const suitName = { S:"Spades", H:"Hearts", D:"Diamonds", C:"Clubs" };
const avatars = ["😎","🧔","👨","👩","🧑","🦁","🐯","🦊","🐼","🐺","🦅","👑"];
const emojis = ["😂","🔥","👏","😎","🤝","😤"];
const voicePeers=new Map(), voiceAudioEls=new Map(), voiceCandidateQueues=new Map(), voiceMeters=new Map(), individuallyMuted=new Set();
let localVoiceStream=null, voiceJoined=false, voiceMuted=false, voiceMeterFrame=null;
let rtcConfig={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]};

let soundOn = localStorage.getItem("knt_sound") !== "off";
const SESSION_KEY = "knt_reconnect_session_v1";
let resumeInFlight = false;
let lastTrickSignature = "";
let lastHandSignature = "";
let language = localStorage.getItem("knt_lang") || "en";
let selectedAvatar = localStorage.getItem("knt_avatar") || "😎";
const mutedChatPlayers=new Set();
const STATS_KEY="knt_stats_v1";
const ACCOUNT_TOKEN_KEY="knt_account_token_v1";
const STYLE_KEY="knt_style_v1";
let cloudUser=null;
let rankedQueued=false;
let practicePending=false;
let lastRecordedRoundKey="";
let handOrder=[];
let handOrderRoundKey="";
let arrangeMode=false;
let arrangeSelectedCardId=null;
let dealAnimatedRoundKey="";
let selectedPlayCardId=null;
let playConfirmEnabled=localStorage.getItem("knt_play_confirm_v22")!=="off";
let actionLocked=false;
let performanceMode=localStorage.getItem("knt_performance_v22")==="on";
let wakeLock=null;
let backGuardArmed=false;
function haptic(ms=18){try{if(navigator.vibrate)navigator.vibrate(ms);}catch{}}
function setActionLocked(on){actionLocked=!!on;document.body.classList.toggle("action-locked",actionLocked);document.querySelectorAll("#actionPanel button,#actionPanel select,#actionPanel input,#playConfirmBar button").forEach(el=>el.disabled=actionLocked);}
function emitAction(event,payload,done){if(actionLocked){toast("Action already sent — waiting for server.");return false;}setActionLocked(true);const timer=setTimeout(()=>setActionLocked(false),4500);socket.emit(event,payload,res=>{clearTimeout(timer);setActionLocked(false);if(res&&!res.ok)toast(res.error||"Action rejected.");done?.(res);});return true;}
async function updateWakeLock(){const active=state&&!state.spectator&&["bidding","contract","playing"].includes(state.phase);try{if(active&&!document.hidden&&navigator.wakeLock&&!wakeLock){wakeLock=await navigator.wakeLock.request("screen");wakeLock.addEventListener?.("release",()=>{wakeLock=null;});}if((!active||document.hidden)&&wakeLock){await wakeLock.release();wakeLock=null;}}catch{wakeLock=null;}}
function applyPerformanceMode(){document.body.classList.toggle("performance-mode",performanceMode);const b=$("performanceBtn");if(b)b.textContent=performanceMode?"⚡ Data Saver ON":"⚡ Performance";if(socket?.connected)socket.emit("clientMode",{lowNetwork:performanceMode});}
function armBackGuard(){if(!IS_PACKAGED_APP||backGuardArmed)return;try{history.pushState({kntGame:true},"");backGuardArmed=true;}catch{}}
function activeLiveMatch(){return !!state&&!state.spectator&&["bidding","contract","playing"].includes(state.phase);}

function animateCardPlay(el,send){
  if(!el||el.classList.contains("card-launching"))return;
  el.classList.add("card-launching"); beep("deal");
  setTimeout(send,145);
}

function readSession(){
  try{const v=JSON.parse(localStorage.getItem(SESSION_KEY)||"null");return v&&v.code&&v.reconnectToken?v:null;}catch{return null;}
}
function saveSession(code,reconnectToken){
  if(!code||!reconnectToken)return;localStorage.setItem(SESSION_KEY,JSON.stringify({code,reconnectToken,savedAt:Date.now()}));
}
function clearSession(){localStorage.removeItem(SESSION_KEY);}
function tryResumeSession(showMessage=false){
  const session=readSession();if(!session||!socket.connected||resumeInFlight)return;
  resumeInFlight=true;
  socket.emit("resumeSession",session,res=>{
    resumeInFlight=false;
    if(res?.ok){saveSession(res.code||session.code,res.reconnectToken||session.reconnectToken);if(Number(res.missedTricks||0)>0)v16Modal("Reconnect recap",`<p>You missed <b>${Number(res.missedTricks)}</b> trick${Number(res.missedTricks)===1?"":"s"} while offline.</p><p>Review the Bid & Trick History panel before your next move.</p><small>Audit ${escapeHtml(res.auditId||"—")}</small>`);else if(showMessage)toast(language==="gu"?"તમારી સીટ ફરી જોડાઈ ગઈ.":"Reconnected to your seat.");return;}
    if(res?.error&&(/expired|not found|invalid reconnect/i.test(res.error))){clearSession();if(showMessage)toast(language==="gu"?"જૂનો રૂમ હવે ઉપલબ્ધ નથી.":"Your previous room has expired.");}
  });
}

const i18n = {
  en:{
    title:"Kaali Ni Tidi",subtitle:"Online multiplayer card table",profile:"PLAYER PROFILE",quickLogin:"Quick login",
    profileHelp:"Your name and avatar are saved on this browser.",yourName:"Your name",avatar:"Avatar",saveProfile:"Save profile",
    heroTitle:"Play Kaali Ni Tidi with your friends.",heroText:"Choose 3–8 players for private, public and competitive tables. The 3-player mode is a custom reduced-deck variant.",
    createRoom:"Create room",players:"Players",createPrivate:"Create room",botsHelp:"Empty seats become bots when the host starts.",
    joinRoom:"Join room",roomCode:"Room code",join:"Join room",copyCode:"Copy room code",startGame:"Start game",round:"Round",bid:"Bid",
    hukum:"Hukum",trick:"Trick",yourHand:"Your hand",scoreboard:"Scoreboard",chat:"Table chat",send:"Send",gameLog:"Game log"
  },
  gu:{
    title:"કાળી ની તીડી",subtitle:"ઓનલાઇન મલ્ટિપ્લેયર કાર્ડ ટેબલ",profile:"ખેલાડી પ્રોફાઇલ",quickLogin:"ઝડપી લૉગિન",
    profileHelp:"તમારું નામ અને અવતાર આ બ્રાઉઝરમાં સેવ રહેશે.",yourName:"તમારું નામ",avatar:"અવતાર",saveProfile:"પ્રોફાઇલ સેવ કરો",
    heroTitle:"મિત્રો સાથે કાળી ની તીડી રમો.",heroText:"3–8 ખેલાડીઓ માટે પ્રાઇવેટ, પબ્લિક અને સ્પર્ધાત્મક ટેબલ. 3 ખેલાડી મોડ કસ્ટમ રિડ્યુસ્ડ-ડેક વેરિઅન્ટ છે.",
    createRoom:"રૂમ બનાવો",players:"ખેલાડીઓ",createPrivate:"રૂમ બનાવો",botsHelp:"હોસ્ટ ગેમ શરૂ કરે ત્યારે ખાલી સીટ બોટ બનશે.",
    joinRoom:"રૂમ જોડાઓ",roomCode:"રૂમ કોડ",join:"જોડાઓ",copyCode:"રૂમ કોડ કૉપી",startGame:"ગેમ શરૂ કરો",round:"રાઉન્ડ",bid:"બિડ",
    hukum:"હુકમ",trick:"હાથ",yourHand:"તમારા પત્તા",scoreboard:"સ્કોરબોર્ડ",chat:"ટેબલ ચેટ",send:"મોકલો",gameLog:"ગેમ લોગ"
  },
  hi:{
    title:"काली नी तीडी",subtitle:"ऑनलाइन मल्टीप्लेयर कार्ड टेबल",profile:"खिलाड़ी प्रोफ़ाइल",quickLogin:"क्विक लॉगिन",
    profileHelp:"आपका नाम और अवतार इस डिवाइस पर सेव रहेगा।",yourName:"आपका नाम",avatar:"अवतार",saveProfile:"प्रोफ़ाइल सेव करें",
    heroTitle:"दोस्तों के साथ काली नी तीडी खेलें।",heroText:"3–8 खिलाड़ियों के साथ निजी, सार्वजनिक और प्रतिस्पर्धी टेबल।",
    createRoom:"रूम बनाएं",players:"खिलाड़ी",createPrivate:"रूम बनाएं",botsHelp:"होस्ट गेम शुरू करे तो खाली सीट बॉट बन जाती है।",
    joinRoom:"रूम जॉइन करें",roomCode:"रूम कोड",join:"जॉइन करें",copyCode:"रूम कोड कॉपी",startGame:"गेम शुरू करें",round:"राउंड",bid:"बिड",
    hukum:"हुकुम",trick:"ट्रिक",yourHand:"आपके कार्ड",scoreboard:"स्कोरबोर्ड",chat:"टेबल चैट",send:"भेजें",gameLog:"गेम लॉग"
  }
};

function tr(key){ return i18n[language]?.[key] || i18n.en[key] || key; }

function applyLanguage(){
  document.documentElement.lang = language === "gu" ? "gu" : language === "hi" ? "hi" : "en";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = tr(key);
  });
  $("langBtn").textContent = language === "en" ? "ગુજરાતી" : language === "gu" ? "हिंदी" : "English";
  if(state) render();
}

function toast(text){
  const el=$("toast"); el.textContent=text; el.classList.remove("hidden");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.add("hidden"),2200);
}

function beep(kind="tap"){
  if(!soundOn) return;
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx) return;
    const ctx=beep.ctx||(beep.ctx=new AudioCtx());
    if(ctx.state==="suspended")ctx.resume?.();
    const patterns={
      tap:[[420,.045,.08]], deal:[[620,.04,.055],[760,.025,.06]], bid:[[520,.035,.07],[710,.03,.08]],
      win:[[660,.04,.09],[820,.045,.1],[990,.04,.14],[1240,.03,.16]], chat:[[520,.025,.07]], turn:[[760,.03,.08],[940,.025,.09]], trick:[[520,.035,.07],[680,.03,.07],[820,.035,.11]], coin:[[880,.035,.06],[1120,.025,.08]]
    };
    let t=ctx.currentTime;
    for(const [freq,volume,duration] of (patterns[kind]||patterns.tap)){
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type=kind==="win"?"triangle":"sine";osc.frequency.setValueAtTime(freq,t);
      gain.gain.setValueAtTime(volume,t);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
      osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+duration);t+=duration*.72;
    }
  }catch{}
}

function renderAvatarPicker(){
  const wrap=$("avatarPicker"); if(!wrap)return;
  wrap.innerHTML="";
  avatars.forEach(a=>{
    const b=document.createElement("button"); b.type="button";
    b.className=`avatar-option ${a===selectedAvatar?"selected":""}`; b.textContent=a;
    b.setAttribute("role","radio"); b.setAttribute("aria-checked",a===selectedAvatar?"true":"false");
    b.setAttribute("aria-label",`Use ${a} avatar`);
    b.addEventListener("click",()=>{
      selectedAvatar=a;
      try{localStorage.setItem("knt_avatar",a);}catch{}
      renderAvatarPicker(); beep();
    });
    wrap.appendChild(b);
  });
  const preview=$("avatarPreview"); if(preview)preview.textContent=selectedAvatar;
}

const playerModeText={
  3:"3 players · 1 reduced deck (no 2s) · 16 cards each",
  4:"4 players · choose 1 or 2 full decks",
  5:"5 players · 2 reduced decks · 16 cards each",
  6:"6 players · 2 reduced decks · 16 cards each",
  7:"7 players · 2 reduced decks · 8 cards each",
  8:"8 players · 2 full decks · 13 cards each"
};
function syncPlayerCountUI(value){
  const count=String(value||$("playerCount")?.value||"8");
  if($("playerCount"))$("playerCount").value=count;
  document.querySelectorAll(".player-count-btn").forEach(btn=>btn.classList.toggle("selected",btn.dataset.count===count));
  const deckWrap=$("fourPlayerDeckWrap"); deckWrap?.classList.toggle("hidden",count!=="4");
  const info=$("playerModeInfo"); if(info){
    if(count==="4"){const dc=Number($("fourPlayerDeckCount")?.value||1);info.textContent=dc===2?"4 players · 2 full decks · 26 cards each · 500 pts · bidding 300–500":"4 players · 1 full deck · 13 cards each · 250 pts · bidding 150–250";}
    else info.textContent=playerModeText[count]||"";
  }
}

function currentProfile(){
  const name=($("profileName").value||localStorage.getItem("knt_name")||"Player").trim().slice(0,18);
  return {name:name||"Player",avatar:selectedAvatar};
}

function saveProfile(){
  const p=currentProfile();
  localStorage.setItem("knt_name",p.name); localStorage.setItem("knt_avatar",p.avatar);
  $("profileName").value=p.name; toast(language==="gu"?"પ્રોફાઇલ સેવ થયું.":"Profile saved."); beep("win");
}

function showGame(){
  $("homeScreen").classList.add("hidden"); $("profilePanel").classList.add("hidden"); $("discoveryPanel")?.classList.add("hidden"); $("competitiveHub")?.classList.add("hidden"); $("gameScreen").classList.remove("hidden");
  document.body.classList.add("in-game");
  armBackGuard();
}

function createCard(card,opts={}){
  const el=document.createElement("div");
  const red=card.suit==="H"||card.suit==="D";
  el.className=`card ${red?"red":""} ${opts.playable?"playable":""} ${opts.dim?"dim":""}`;
  el.dataset.cardId=card.id;
  const copyText=(state?.deckCount||1)===2?String(card.copy):"";
  const symbol=suitSymbol[card.suit];
  el.innerHTML=`<div class="card-corner top"><b>${card.rank}</b><span>${symbol}</span></div><div class="card-pip">${symbol}</div><div class="card-corner bottom"><b>${card.rank}</b><span>${symbol}</span></div>${copyText?`<div class="copy">D${copyText}</div>`:""}`;
  return el;
}

function legalCardIds(){
  if(!state||state.phase!=="playing"||state.trickResolving||state.turnIndex!==state.viewerIndex)return new Set();
  if(Array.isArray(state.legalCardIds))return new Set(state.legalCardIds);
  if(!state.leadSuit)return new Set(state.hand.map(c=>c.id));
  const same=state.hand.filter(c=>c.suit===state.leadSuit);
  return new Set((same.length?same:state.hand).map(c=>c.id));
}

async function joinVoice(){
  if(voiceJoined)return;
  if(!navigator.mediaDevices?.getUserMedia){toast("Voice is not supported here.");return;}
  try{
    localVoiceStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    voiceJoined=true;voiceMuted=false;updateVoiceControls();attachSpeakingMeter(state?.viewerIndex,localVoiceStream);
    socket.emit("voiceJoin",{},async res=>{
      if(!res?.ok){leaveVoice(false);toast(res?.error||"Could not join voice.");return;}
      for(const i of res.peers||[])await makeVoiceOffer(i);
      toast("Voice connected.");
    });
  }catch(e){console.error(e);toast("Allow microphone permission to use voice.");}
}
function leaveVoice(notify=true){
  if(notify&&voiceJoined)socket.emit("voiceLeave");
  voiceJoined=false;voiceMuted=false;
  localVoiceStream?.getTracks().forEach(t=>t.stop());localVoiceStream=null;
  [...voicePeers.keys()].forEach(closeVoicePeer);voiceCandidateQueues.clear();voiceMeters.clear();
  if(voiceMeterFrame)cancelAnimationFrame(voiceMeterFrame);voiceMeterFrame=null;updateVoiceControls();
}
function toggleVoiceMute(){
  if(!localVoiceStream)return;
  voiceMuted=!voiceMuted;
  localVoiceStream.getAudioTracks().forEach(t=>t.enabled=!voiceMuted);
  socket.emit("voiceMuteState",{muted:voiceMuted});updateVoiceControls();
}
function updateVoiceControls(){
  const a=$("joinVoiceBtn"),b=$("muteVoiceBtn"),c=$("leaveVoiceBtn"),d=$("voiceStatus");if(!a||!b||!c||!d)return;
  a.classList.toggle("hidden",voiceJoined);b.classList.toggle("hidden",!voiceJoined);c.classList.toggle("hidden",!voiceJoined);
  b.textContent=voiceMuted?"🎙 Unmute":"🔇 Mute";d.textContent=voiceJoined?(voiceMuted?"Voice · muted":"Voice · connected"):"Voice off";
}
function getVoicePeer(i){
  if(voicePeers.has(i))return voicePeers.get(i);
  const pc=new RTCPeerConnection(rtcConfig);voicePeers.set(i,pc);
  localVoiceStream?.getTracks().forEach(t=>pc.addTrack(t,localVoiceStream));
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("voiceSignal",{targetIndex:i,signal:{kind:"candidate",candidate:e.candidate.toJSON?e.candidate.toJSON():e.candidate}})};
  pc.ontrack=e=>{const stream=e.streams?.[0]||new MediaStream([e.track]);attachRemoteAudio(i,stream);attachSpeakingMeter(i,stream)};
  pc.onconnectionstatechange=()=>{if(["failed","closed"].includes(pc.connectionState))closeVoicePeer(i)};
  return pc;
}
async function makeVoiceOffer(i){
  if(!voiceJoined||i===state?.viewerIndex)return;
  try{const pc=getVoicePeer(i),offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit("voiceSignal",{targetIndex:i,signal:{kind:"offer",description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}}});}catch(e){console.error(e)}
}
async function handleVoiceSignal(i,sig){
  if(!voiceJoined||!sig)return;
  try{
    const pc=getVoicePeer(i);
    if(sig.kind==="offer"){
      await pc.setRemoteDescription(sig.description);await flushCandidates(i,pc);
      const ans=await pc.createAnswer();await pc.setLocalDescription(ans);
      socket.emit("voiceSignal",{targetIndex:i,signal:{kind:"answer",description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}}});
    }else if(sig.kind==="answer"){
      await pc.setRemoteDescription(sig.description);await flushCandidates(i,pc);
    }else if(sig.kind==="candidate"&&sig.candidate){
      if(pc.remoteDescription)await pc.addIceCandidate(sig.candidate);
      else{const q=voiceCandidateQueues.get(i)||[];q.push(sig.candidate);voiceCandidateQueues.set(i,q);}
    }
  }catch(e){console.error("voice",e)}
}
async function flushCandidates(i,pc){for(const c of voiceCandidateQueues.get(i)||[]){try{await pc.addIceCandidate(c)}catch{}}voiceCandidateQueues.delete(i)}
function attachRemoteAudio(i,stream){
  let a=voiceAudioEls.get(i);if(!a){a=document.createElement("audio");a.autoplay=true;a.playsInline=true;$("voiceAudioContainer")?.appendChild(a);voiceAudioEls.set(i,a)}
  a.srcObject=stream;a.muted=individuallyMuted.has(i);const pp=a.play();if(pp?.catch)pp.catch(()=>{});
}
function closeVoicePeer(i){
  try{voicePeers.get(i)?.close()}catch{}voicePeers.delete(i);
  const a=voiceAudioEls.get(i);if(a){a.srcObject=null;a.remove();voiceAudioEls.delete(i)}
  voiceCandidateQueues.delete(i);voiceMeters.delete(i);setSeatSpeaking(i,false);
}
function toggleIndividualVoice(i){
  if(individuallyMuted.has(i))individuallyMuted.delete(i);else individuallyMuted.add(i);
  const a=voiceAudioEls.get(i);if(a)a.muted=individuallyMuted.has(i);renderSeats();
}
function attachSpeakingMeter(i,stream){
  if(i==null||!stream)return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    if(!attachSpeakingMeter.ctx)attachSpeakingMeter.ctx=new AC();const ctx=attachSpeakingMeter.ctx,source=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();
    an.fftSize=256;an.smoothingTimeConstant=.75;source.connect(an);voiceMeters.set(i,{an,data:new Uint8Array(an.frequencyBinCount),speaking:false});if(!voiceMeterFrame)runVoiceMeter();
  }catch{}
}
function runVoiceMeter(){
  let last=0;const tick=t=>{voiceMeterFrame=requestAnimationFrame(tick);if(t-last<120)return;last=t;for(const [i,m] of voiceMeters){m.an.getByteFrequencyData(m.data);let s=0;for(const v of m.data)s+=v;const speaking=s/Math.max(1,m.data.length)>18;if(speaking!==m.speaking){m.speaking=speaking;setSeatSpeaking(i,speaking)}}};voiceMeterFrame=requestAnimationFrame(tick);
}
function setSeatSpeaking(i,on){document.querySelector(`.seat[data-player-index="${i}"]`)?.classList.toggle("speaking",!!on)}

function render(){
  if(!state)return;
  showGame();
  $("roomBadge").classList.remove("hidden"); $("roomBadge").textContent=`ROOM ${state.code}`;
  const phases={lobby:"Lobby",bidding:language==="gu"?"બિડિંગ":"Bidding",contract:language==="gu"?"હુકમ પસંદગી":"Contract",playing:language==="gu"?"ચાલુ ગેમ":"Playing",roundEnd:language==="gu"?"રાઉન્ડ પૂર્ણ":"Round finished"};
  $("phaseText").textContent=phases[state.phase]||state.phase;
  $("roundNo").textContent=state.round||"—"; $("currentBid").textContent=state.bid.current??"—";
  $("trumpText").textContent=state.trump?`${suitSymbol[state.trump]} ${language==="gu"?"હુકમ":suitName[state.trump]}`:"—";
  $("trickNo").textContent=`${state.trickNumber}/${state.totalTricks || 8}`;
  const bidderPoints=(state.players||[]).filter(p=>p.team==="bidder").reduce((sum,p)=>sum+(p.roundPoints||0),0);
  const defensePoints=(state.players||[]).filter(p=>p.team==="defense").reduce((sum,p)=>sum+(p.roundPoints||0),0);
  const teamsKnown=state.phase==="roundEnd" || (state.revealedPartners||[]).length>=Number(state.partnerCount||0);
  if($("bidderPoints")) $("bidderPoints").textContent=bidderPoints;
  if($("defensePoints")) $("defensePoints").textContent=defensePoints;
  if($("bidderPointsLabel")) $("bidderPointsLabel").textContent=teamsKnown?"Bidder pts":"Known bidder";
  if($("defensePointsLabel")) $("defensePointsLabel").textContent=teamsKnown?"Defense pts":"Known defense";
  renderLobby();
  const visible=state.phase!=="lobby"; $("tablePanel").classList.toggle("hidden",!visible); $("lobbyPanel").classList.toggle("hidden",visible);
  if(!visible){renderRuleSummary();updateWakeLock();return;}
  renderSeats();renderTrick();renderHand();renderActions();renderScoreboard();renderHistories();renderLog();renderChat();renderTurnText();renderRuleSummary();updateWakeLock();
  const spectator=Boolean(state.spectator);if(spectator){["joinVoiceBtn","muteVoiceBtn","leaveVoiceBtn"].forEach(id=>$(id)?.classList.add("hidden"));}else updateVoiceControls();
  const mePlayer=!spectator?state.players[state.viewerIndex]:null;$("reclaimBtn")?.classList.toggle("hidden",!mePlayer?.autoControlled||!mePlayer?.connected);
  if($("chatInput")){ $("chatInput").disabled=spectator; $("chatInput").placeholder=spectator?"Spectators can read chat":"Message…"; }
}

function renderLobby(){
  $("lobbyPlayers").innerHTML="";
  state.players.forEach((p,i)=>{
    const div=document.createElement("div");div.className=`player-card ${p.ready?"is-ready":""} ${!p.connected&&!p.bot?"is-away":""}`;
    const ready=p.bot?"BOT":p.ready?"READY":"NOT READY";
    const reconnect=(!p.connected&&!p.bot&&p.reconnectUntil)?`<small class="reconnect-count" data-until="${p.reconnectUntil}">Reconnect 90s</small>`:"";
    const actions=(!state.spectator&&i!==state.viewerIndex&&!p.bot)?`<div class="player-actions"><button type="button" class="tiny-btn mute-chat-btn" data-index="${i}">${mutedChatPlayers.has(i)?"Unmute":"Mute"}</button><button type="button" class="tiny-btn report-btn" data-index="${i}">Report</button>${state.host?`<button type="button" class="tiny-btn danger-btn kick-btn" data-index="${i}">Remove</button>`:""}</div>`:"";
    div.innerHTML=`<div class="player-avatar">${p.avatar||"😎"}</div><div class="player-card-main"><strong>${escapeHtml(p.name)}${i===state.viewerIndex?" · You":""}</strong><span>${p.bot?"Bot":"Player"} · Seat ${i+1} · <b class="ready-label">${ready}</b></span>${reconnect}</div>${actions}`;
    $("lobbyPlayers").appendChild(div);
  });
  const humans=state.connectedHumanCount||state.players.filter(p=>!p.bot&&p.connected).length;
  $("lobbyHelp").textContent=`${state.players.length}/${state.playerCount} players · ${state.deckCount||1} deck${(state.deckCount||1)===2?"s":""} · ${state.cardsEach||0} cards each · ${state.totalPoints||0} pts · ${state.readyCount||0}/${humans} ready · Bots: ${state.botDifficulty||"normal"}${state.isPublic?" · Public":" · Private"}`;
  const readyBtn=$("readyBtn"),rankedConfirm=$("rankedConfirmBtn"),me=state.players[state.viewerIndex];
  if(readyBtn){readyBtn.classList.toggle("hidden",state.spectator||state.ranked);readyBtn.textContent=me?.ready?"✓ Ready":"○ Mark Ready";readyBtn.classList.toggle("is-ready",!!me?.ready);}
  if(rankedConfirm){rankedConfirm.classList.toggle("hidden",!state.ranked||state.spectator||me?.rankedConfirmed);rankedConfirm.textContent=me?.rankedConfirmed?"✓ Confirmed":"Confirm Ranked Match";}
  $("startBtn").classList.toggle("hidden",!state.host||state.ranked);
  if(state.host){$("startBtn").disabled=!state.allReady;$("startBtn").title=state.allReady?"Start game":"Everyone must be ready";}
  bindPlayerActionButtons();
}
function renderSeats(){
  const ring=$("seatRing");ring.innerHTML="";const n=state.players.length;const baseViewer=state.spectator?0:state.viewerIndex;
  state.players.forEach((p,i)=>{
    const relative=(i-baseViewer+n)%n;
    const angle=(90+(360*relative/n))*Math.PI/180;
    let x=50+43.5*Math.cos(angle),y=50+38.5*Math.sin(angle);
    if(!state.spectator&&i===state.viewerIndex){x=50;y=87;}
    const seat=document.createElement("div");
    seat.dataset.playerIndex=String(i);
    seat.className=`seat ${i===state.viewerIndex?"viewer":"opponent"} ${state.turnIndex===i&&state.phase==="playing"&&!state.trickResolving?"active":""} ${p.voiceJoined?"voice-connected":""} ${p.voiceMuted?"voice-muted":""} ${!p.connected&&!p.bot?"reconnecting":""}`;
    seat.style.left=`${x}%`;seat.style.top=`${y}%`;
    const role=i===state.bid?.bidderIndex?(language==="gu"?"બિડર":"Bidder"):p.team==="bidder"?(language==="gu"?"પાર્ટનર":"Partner"):p.team==="defense"?(language==="gu"?"ડિફેન્સ":"Defense"):"";
    const isTurn=state.turnIndex===i&&state.phase==="playing"&&!state.trickResolving;
    const reconnectBadge=!p.connected&&!p.bot?`<span class="reconnect-badge" data-until="${p.reconnectUntil||0}">↻ BOT ASSIST · 90s</span>`:"";
    const miniBacks=Array.from({length:Math.min(6,Math.max(0,p.cards||0))},()=>"<i></i>").join("");
    const dealer=i===state.dealerIndex?`<span class="dealer-chip" title="Dealer">D</span>`:"";
    const tools=(!state.spectator&&i!==state.viewerIndex&&!p.bot)?`<div class="seat-tools"><button type="button" class="seat-tool mute-chat-seat" title="Mute chat">${mutedChatPlayers.has(i)?"💬✓":"💬×"}</button><button type="button" class="seat-tool report-seat" title="Report player">⚑</button>${state.host?`<button type="button" class="seat-tool kick-seat" title="Remove player">✕</button>`:""}</div>`:"";
    seat.innerHTML=`<div class="seat-card">${dealer}${isTurn?`<div class="turn-chip">${language==="gu"?"ચાલ":"TURN"}</div><div class="seat-timer" aria-hidden="true"><i></i></div>`:""}<div class="avatar">${p.avatar||"😎"}</div><div class="seat-main"><span class="name">${escapeHtml(p.name)}${i===state.viewerIndex?" · You":""}</span><div class="seat-stats">${role?`<span class="role-badge ${p.team}">${role}</span>`:""}${reconnectBadge}</div></div><div class="opponent-hand" aria-label="${p.cards} cards"><span class="mini-cards">${miniBacks}</span><b>${p.cards}</b></div>${p.voiceJoined&&i!==state.viewerIndex?`<button type="button" class="voice-person-btn">${individuallyMuted.has(i)?"🔇 Unmute":"🔊 Mute"}</button>`:""}${tools}</div>`;
    const vb=seat.querySelector(".voice-person-btn");if(vb)vb.addEventListener("click",()=>toggleIndividualVoice(i));
    seat.querySelector(".mute-chat-seat")?.addEventListener("click",()=>{if(mutedChatPlayers.has(i))mutedChatPlayers.delete(i);else mutedChatPlayers.add(i);renderSeats();renderChat();});
    seat.querySelector(".report-seat")?.addEventListener("click",()=>{const reason=prompt("Reason for report?","Inappropriate behavior");if(!reason)return;socket.emit("reportPlayer",{playerIndex:i,reason},res=>toast(res?.ok?"Report sent.":res?.error||"Could not report."));});
    seat.querySelector(".kick-seat")?.addEventListener("click",()=>{if(!confirm(`Remove ${p.name}?`))return;socket.emit("kickPlayer",{playerIndex:i},res=>{if(res&&!res.ok)toast(res.error);});});
    if(voiceMeters.get(i)?.speaking)seat.classList.add("speaking");
    ring.appendChild(seat);
  });
}

function renderTrick(){
  const area=$("trickArea");area.innerHTML="";const n=Math.max(state.playerCount,4);const baseViewer=state.spectator?0:state.viewerIndex;
  state.trick.forEach(play=>{
    const relative=(play.playerIndex-baseViewer+n)%n;
    const angle=(90+(360*relative/n))*Math.PI/180,x=50+32*Math.cos(angle),y=50+31*Math.sin(angle);
    const wrap=document.createElement("div");wrap.className=`played-card ${state.trickResolving&&state.lastTrick?.winnerIndex===play.playerIndex?"winning-play":""}`;wrap.style.left=`${x}%`;wrap.style.top=`${y}%`;wrap.style.setProperty("--play-rotate",`${((relative/n)*18-9).toFixed(1)}deg`);wrap.appendChild(createCard(play.card));area.appendChild(wrap);
  });
  if(state.lastTrick && state.trickResolving){
    const winner=state.players[state.lastTrick.winnerIndex];
    const flash=document.createElement("div");flash.className="trick-winner-flash hold";
    flash.innerHTML=`<span>🏆</span><strong>${escapeHtml(winner?.name||"Player")}</strong><small>+${state.lastTrick.points||0} pts · trick won</small>`;
    area.appendChild(flash);
    const gain=document.createElement("div");gain.className="point-gain-float";gain.textContent=`+${state.lastTrick.points||0} POINTS`;area.appendChild(gain);
  }
  const strip=$("lastTrickStrip");
  if(strip){
    if(state.lastTrick && !state.trickResolving){
      const winner=state.players[state.lastTrick.winnerIndex];
      const cards=(state.lastTrick.cards||[]).map(play=>`<span class="last-trick-mini ${play.playerIndex===state.lastTrick.winnerIndex?"winner":""}"><b>${play.card.rank}${suitSymbol[play.card.suit]}</b></span>`).join("");
      strip.innerHTML=`<span class="last-trick-label">Previous trick</span><div class="last-trick-cards">${cards}</div><span class="last-trick-winner">🏆 ${escapeHtml(winner?.name||"Player")} · +${state.lastTrick.points||0}</span>`;
      strip.classList.remove("hidden");
    }else strip.classList.add("hidden");
  }
  let msg="";
  if(state.phase==="bidding")msg=language==="gu"?"બિડિંગ ચાલુ છે":"Auction in progress";
  else if(state.phase==="contract")msg=language==="gu"?"હુકમ અને પાર્ટનર પસંદ થઈ રહ્યા છે":"Choosing Hukum & partners";
  else if(state.phase==="playing"&&state.trickResolving)msg=language==="gu"?"હાથ જુઓ — આગળનો હાથ થોડીવારમાં":"Review trick — next trick shortly";
  else if(state.phase==="playing")msg=state.leadSuit?`${language==="gu"?"લીડ":"Lead"}: ${suitSymbol[state.leadSuit]}`:(language==="gu"?"નવો હાથ":"New trick");
  else msg=language==="gu"?"રાઉન્ડ પૂર્ણ":"Round complete";
  $("centerMessage").textContent=msg;
}

function persistHandOrder(){
  if(!handOrderRoundKey)return;
  try{localStorage.setItem(`knt_hand_order_${handOrderRoundKey}`,JSON.stringify(handOrder));}catch{}
}
function syncHandOrder(cards){
  const key=`${state?.code||"room"}:${state?.round||0}`;
  const ids=(cards||[]).map(c=>c.id);
  if(handOrderRoundKey!==key){
    handOrderRoundKey=key;arrangeSelectedCardId=null;arrangeMode=false;
    let saved=[];try{saved=JSON.parse(localStorage.getItem(`knt_hand_order_${key}`)||"[]");}catch{}
    const present=new Set(ids);handOrder=(Array.isArray(saved)?saved:[]).filter(id=>present.has(id));ids.forEach(id=>{if(!handOrder.includes(id))handOrder.push(id);});
  }else{
    const present=new Set(ids);
    handOrder=handOrder.filter(id=>present.has(id));
    ids.forEach(id=>{if(!handOrder.includes(id))handOrder.push(id);});
  }
  persistHandOrder();
}
function orderedHand(cards){
  syncHandOrder(cards);
  const byId=new Map(cards.map(c=>[c.id,c]));
  return handOrder.map(id=>byId.get(id)).filter(Boolean);
}
function moveHandCard(sourceId,targetId){
  if(!sourceId||!targetId||sourceId===targetId)return;
  const from=handOrder.indexOf(sourceId),to=handOrder.indexOf(targetId);
  if(from<0||to<0)return;
  const [id]=handOrder.splice(from,1);handOrder.splice(to,0,id);arrangeSelectedCardId=null;persistHandOrder();renderHand();
}
function autoSortHand(mode=$("sortModeSelect")?.value||"suit"){
  const suitOrder={S:0,H:1,D:2,C:3};const rankOrder={"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,J:11,Q:12,K:13,A:14};
  const pointValue=c=>c.suit==="S"&&c.rank==="3"?30:["10","J","Q","K","A"].includes(c.rank)?10:c.rank==="5"?5:0;
  const arr=state.hand.slice();
  arr.sort((a,b)=>{
    if(mode==="rank")return rankOrder[b.rank]-rankOrder[a.rank]||suitOrder[a.suit]-suitOrder[b.suit]||a.copy-b.copy;
    if(mode==="points")return pointValue(b)-pointValue(a)||rankOrder[b.rank]-rankOrder[a.rank]||suitOrder[a.suit]-suitOrder[b.suit];
    if(mode==="hukum"){const ah=a.suit===state.trump?0:1,bh=b.suit===state.trump?0:1;return ah-bh||suitOrder[a.suit]-suitOrder[b.suit]||rankOrder[b.rank]-rankOrder[a.rank];}
    return suitOrder[a.suit]-suitOrder[b.suit]||rankOrder[a.rank]-rankOrder[b.rank]||a.copy-b.copy;
  });
  handOrder=arr.map(c=>c.id);arrangeSelectedCardId=null;selectedPlayCardId=null;persistHandOrder();renderHand();
}
function setupHandTools(){
  const arrangeBtn=$("arrangeHandBtn"),sortBtn=$("sortHandBtn");if(!arrangeBtn||!sortBtn)return;
  arrangeBtn.classList.toggle("active",arrangeMode);
  arrangeBtn.textContent=arrangeMode?"✓ Done arranging":"↔ Arrange";
  arrangeBtn.onclick=()=>{arrangeMode=!arrangeMode;arrangeSelectedCardId=null;renderHand();};
  sortBtn.onclick=()=>autoSortHand();
  const confirmBtn=$("confirmPlayToggle");if(confirmBtn){confirmBtn.classList.toggle("active",playConfirmEnabled);confirmBtn.textContent=`Confirm: ${playConfirmEnabled?"ON":"OFF"}`;confirmBtn.onclick=()=>{playConfirmEnabled=!playConfirmEnabled;localStorage.setItem("knt_play_confirm_v22",playConfirmEnabled?"on":"off");selectedPlayCardId=null;renderHand();};}
}

function fitHandToWidth(){
  const hand=$("hand");
  if(!hand)return;
  const cards=[...hand.querySelectorAll(".card")];
  const count=cards.length;
  hand.classList.toggle("dense-hand",count>18);
  if(!count)return;
  requestAnimationFrame(()=>{
    const live=[...hand.querySelectorAll(".card")];
    if(!live.length)return;
    const hs=getComputedStyle(hand);
    const sideSafety=count>18?34:18; // reserve space for rotated first/last cards
    const available=Math.max(140,hand.clientWidth-(parseFloat(hs.paddingLeft)||0)-(parseFloat(hs.paddingRight)||0)-sideSafety);

    // v27: 20+ card hands use a compact physical card size first, then overlap.
    // This guarantees that a 26-card double-deck hand stays fully visible instead
    // of placing the final cards outside the viewport.
    let targetWidth=live[0].offsetWidth||62;
    if(count>=24) targetWidth=window.innerWidth<=700?46:52;
    else if(count>=20) targetWidth=window.innerWidth<=700?50:58;
    const targetHeight=Math.round(targetWidth*1.48);
    live.forEach(el=>{
      el.style.width=`${targetWidth}px`;
      el.style.height=`${targetHeight}px`;
      el.style.flexBasis=`${targetWidth}px`;
    });

    if(live.length===1){live[0].style.marginLeft="0px";hand.classList.remove("hand-needs-scroll");return;}
    const idealStep=(available-targetWidth)/(live.length-1);
    const minPeek=count>=24?4:(window.innerWidth<=700?6:9);
    const maxStep=Math.max(minPeek,targetWidth-7);
    const step=Math.max(minPeek,Math.min(maxStep,idealStep));
    const overlap=step-targetWidth;
    live.forEach((el,i)=>{el.style.marginLeft=i===0?"0px":`${overlap}px`;});
    const total=targetWidth+step*(live.length-1);
    const fits=total<=available+1;
    hand.classList.toggle("hand-needs-scroll",!fits);
    if(fits) hand.scrollLeft=0;
  });
}

function renderHand(){
  const hand=$("hand");hand.innerHTML="";const legal=legalCardIds();
  const cards=orderedHand(state.hand);const handTotal=cards.length;
  const roundKey=`${state.code||"room"}:${state.round||0}`;const shouldDeal=dealAnimatedRoundKey!==roundKey&&handTotal>0;
  cards.forEach((card,cardIndex)=>{
    const can=legal.has(card.id),el=createCard(card,{playable:can&&!arrangeMode,dim:state.phase==="playing"&&state.turnIndex===state.viewerIndex&&!can&&!arrangeMode});
    if(shouldDeal)el.classList.add("deal-card");
    if(arrangeMode)el.classList.add("arrange-card");
    if(arrangeSelectedCardId===card.id)el.classList.add("arrange-selected");
    const center=(handTotal-1)/2;
    const maxAngle=handTotal>18?6:(handTotal>13?10:16);
    const fanAngle=center?((cardIndex-center)/center)*maxAngle:0;
    const fanDrop=Math.abs(cardIndex-center)*(handTotal>18?0.28:0.7);
    el.style.setProperty("--fan-angle",`${fanAngle}deg`);
    el.style.setProperty("--fan-drop",`${fanDrop}px`);
    el.style.setProperty("--deal-delay",`${Math.min(cardIndex,16)*32}ms`);
    el.style.zIndex=String(cardIndex+1);
    if(arrangeMode){
      el.tabIndex=0;el.setAttribute("role","button");el.setAttribute("aria-label",`Move ${card.rank} of ${suitName[card.suit]}`);el.draggable=true;
      const choose=()=>{if(!arrangeSelectedCardId){arrangeSelectedCardId=card.id;renderHand();}else if(arrangeSelectedCardId===card.id){arrangeSelectedCardId=null;renderHand();}else moveHandCard(arrangeSelectedCardId,card.id);};
      el.addEventListener("click",choose);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose();}});
      el.addEventListener("dragstart",e=>{arrangeSelectedCardId=card.id;e.dataTransfer?.setData("text/plain",card.id);e.dataTransfer&&(e.dataTransfer.effectAllowed="move");});
      el.addEventListener("dragover",e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect="move";});
      el.addEventListener("drop",e=>{e.preventDefault();const src=e.dataTransfer?.getData("text/plain")||arrangeSelectedCardId;moveHandCard(src,card.id);});
    }else if(can){
      if(selectedPlayCardId===card.id)el.classList.add("play-selected");
      el.tabIndex=0;el.setAttribute("role","button");el.setAttribute("aria-label",`Play ${card.rank} of ${suitName[card.suit]}`);
      const play=()=>{if(state.trickResolving||actionLocked)return;haptic(20);if(playConfirmEnabled){selectedPlayCardId=selectedPlayCardId===card.id?null:card.id;renderHand();return;}animateCardPlay(el,()=>emitAction("playCard",{cardId:card.id},res=>{if(res&&!res.ok)el.classList.remove("card-launching");}));};
      el.addEventListener("click",play);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();play();}});
    }
    hand.appendChild(el);
  });
  fitHandToWidth();
  if(shouldDeal)dealAnimatedRoundKey=roundKey;
  $("handCount").textContent=`${state.hand.length} ${language==="gu"?"પત્તા":"cards"}`;
  setupHandTools();
  if(selectedPlayCardId&&!state.hand.some(c=>c.id===selectedPlayCardId))selectedPlayCardId=null;
  const confirmBar=$("playConfirmBar"),confirmButton=$("confirmPlayBtn"),cancelButton=$("cancelPlayBtn");
  if(confirmBar){const chosen=state.hand.find(c=>c.id===selectedPlayCardId);confirmBar.classList.toggle("hidden",!playConfirmEnabled||!chosen||arrangeMode);if(chosen)$("selectedCardLabel").textContent=`Selected: ${chosen.rank}${suitSymbol[chosen.suit]}${(state.deckCount||1)===2?` · Deck ${chosen.copy}`:""}`;}
  if(confirmButton)confirmButton.onclick=()=>{const id=selectedPlayCardId;if(!id||actionLocked)return;const el=hand.querySelector(`[data-card-id="${CSS.escape(id)}"]`);const send=()=>emitAction("playCard",{cardId:id},res=>{if(res?.ok)selectedPlayCardId=null;else el?.classList.remove("card-launching");});el?animateCardPlay(el,send):send();};
  if(cancelButton)cancelButton.onclick=()=>{selectedPlayCardId=null;renderHand();};
  const help=$("arrangeHelp");if(help){help.textContent=arrangeMode?(language==="gu"?"એક પત્તો પસંદ કરો, પછી નવી જગ્યા પસંદ કરો.":"Tap a card, then tap its new position. You can also drag on desktop."):"";help.classList.toggle("hidden",!arrangeMode);}
  if(arrangeMode) $("legalHint").textContent=language==="gu"?"પત્તા ગોઠવો":"Arrange your cards";
  else if(state.trickResolving) $("legalHint").textContent=language==="gu"?"આ હાથ જોઈ લો…":"Reviewing the completed trick…";
  else if(state.phase==="playing"&&state.turnIndex===state.viewerIndex){
    if(!state.leadSuit) $("legalHint").textContent=language==="gu"?"તમારી લીડ":"Your lead";
    else if(state.hand.some(c=>c.suit===state.leadSuit)) $("legalHint").textContent=`${suitSymbol[state.leadSuit]} ${language==="gu"?"ફોલો કરવો જરૂરી":"must follow suit"}`;
    else $("legalHint").textContent=language==="gu"?"લીડ સુટ નથી — હુકમ અથવા કોઈ પત્તો કાઢો":"Void in lead suit — play Hukum or discard";
  } else $("legalHint").textContent="";
}
function resultCardLabel(c){
  if(!c)return "?";
  const deck=(state?.deckCount||1)===2?` D${c.copy||1}`:"";
  return `${c.rank}${suitSymbol[c.suit]||c.suit}${deck}`;
}
function resultPointCards(cards){
  if(!cards?.length)return '<span class="muted">No scoring cards captured</span>';
  return cards.map(c=>`<span class="result-card-chip ${["H","D"].includes(c.suit)?"red":""}"><b>${resultCardLabel(c)}</b><small>+${c.points||0}</small></span>`).join("");
}
function resultBreakdown(rows){
  if(!rows?.length)return '<div class="result-breakdown-empty">0 scoring points</div>';
  return `<div class="result-breakdown"><div><b>Point card</b><b>Count</b><b>Each</b><b>Total</b></div>${rows.map(r=>`<div><span>${escapeHtml(r.label)}</span><span>${r.count}</span><span>${r.each}</span><strong>${r.total}</strong></div>`).join("")}</div>`;
}
function teamNames(indexes){return (indexes||[]).map(i=>escapeHtml(state.players?.[i]?.name||"Player")).join(" · ")||"—";}
function partnerCallSummary(rs){
  const bidder=escapeHtml(state.players?.[rs.bidderIndex??state.bid?.bidderIndex]?.name||"Bidder");
  const calls=(rs.calledPartners||state.calledPartners||[]).map((c,i)=>{
    const owner=rs.calledPartners?.[i]?.ownerIndex;
    const partner=Number.isInteger(owner)?escapeHtml(state.players?.[owner]?.name||"Partner"):"Hidden";
    return `<span><b>${resultCardLabel(c)}</b> → ${partner}</span>`;
  }).join("");
  return `<div class="partner-call-result"><strong>🤝 ${bidder} called partner card${(rs.calledPartners||[]).length===1?"":"s"}</strong><div>${calls||"—"}</div></div>`;
}
function renderActions(){
  const panel=$("actionPanel");panel.innerHTML="";
  const actionSeconds=Math.max(1,Math.round((state.actionTimeoutMs||60000)/1000));
  if(state.spectator){panel.innerHTML=`<div class="spectator-card"><strong>👁 Spectator mode</strong><span>You can watch the table, score and game log. Player actions are disabled.</span></div>`;return;}
  panel.className=`panel action-panel phase-${state.phase}`;
  if(state.phase==="bidding"){
    if(state.bid.turnIndex!==state.viewerIndex){panel.innerHTML=`<strong>${escapeHtml(state.players[state.bid.turnIndex].name)} ${language==="gu"?"ની બિડની રાહ":"is bidding…"} <b id="actionCountdown" class="inline-countdown">${actionSeconds}</b></strong>`;return;}
    const inc=state.bid.increment || ((state.deckCount||1)===2?10:5);
    const min=state.bid.current==null?state.bid.min:state.bid.current+inc;
    const canBid=min<=state.bid.max;
    const quickBids=[];for(let v=min;v<=state.bid.max&&quickBids.length<6;v+=inc)quickBids.push(v);
    panel.innerHTML=`<div class="bid-head"><div><span class="eyebrow">${language==="gu"?"હાલની સૌથી મોટી બિડ":"HIGHEST BID"}</span><div class="big-bid">${state.bid.current??"—"}</div></div><strong class="your-turn-callout">${language==="gu"?"તમારી બિડ":"Your bid"} <b id="actionCountdown" class="inline-countdown">${actionSeconds}</b></strong></div><div class="quick-bids">${quickBids.map(v=>`<button class="quick-bid" type="button" data-bid="${v}" ${canBid?"":"disabled"}>${v}</button>`).join("")}</div><div class="action-row bid-custom"><label>${language==="gu"?"કસ્ટમ બિડ":"Custom bid"}<input id="bidAmount" type="number" min="${min}" max="${state.bid.max}" step="${inc}" value="${Math.min(min,state.bid.max)}" ${canBid?"":"disabled"}></label><button id="bidBtn" class="primary" type="button" ${canBid?"":"disabled"}>${language==="gu"?"બિડ":"Bid"}</button><button id="passBtn" class="pass-btn" type="button">${language==="gu"?"પાસ":"Pass"}</button></div><p class="note">${state.bid.min}–${state.bid.max}, +${inc} · ${language==="gu"?"સૌથી મોટી બિડ કરનાર પ્રથમ હાથ લીડ કરશે":"highest bidder leads the first trick"}${!canBid?` · ${language==="gu"?"મહત્તમ બિડ થઈ ગઈ — પાસ કરો":"maximum bid reached — pass"}`:""}</p>`;
    const submitBid=amount=>{beep("bid");emitAction("bid",{amount:Number(amount),pass:false});};
    panel.querySelectorAll(".quick-bid").forEach(btn=>btn.addEventListener("click",()=>submitBid(btn.dataset.bid)));
    $("bidBtn").addEventListener("click",()=>submitBid($("bidAmount").value));
    $("passBtn").addEventListener("click",()=>emitAction("bid",{pass:true}));return;
  }

  if(state.phase==="contract"){
    if(state.bid.bidderIndex!==state.viewerIndex){panel.innerHTML=`<strong>${escapeHtml(state.players[state.bid.bidderIndex].name)} ${language==="gu"?`હુકમ અને ${state.partnerCount} ગુપ્ત પાર્ટનર પસંદ કરી રહ્યા છે`:`is choosing Hukum and ${state.partnerCount} hidden partner${state.partnerCount===1?"":"s"}…`} <b id="actionCountdown" class="inline-countdown">${actionSeconds}</b></strong>`;return;}

    const copies=(state.deckCount||1)===2?[1,2]:[1];
    const owned=new Set(state.hand.map(c=>c.id));
    const options=[];
    for(const copy of copies){
      for(const suit of ["S","H","D","C"]){
        for(const rank of (state.availableRanks||["2","3","4","5","6","7","8","9","10","J","Q","K","A"]).slice().reverse()){
          const id=`${copy}-${suit}-${rank}`;
          if(!owned.has(id)) options.push({id,copy,suit,rank});
        }
      }
    }
    const selectOptions=i=>options.map((c,j)=>`<option value="${c.id}" ${j===i?"selected":""}>${c.rank}${suitSymbol[c.suit]}${(state.deckCount||1)===2?` · Deck ${c.copy}`:""}</option>`).join("");
    const partnerHTML=Array.from({length:state.partnerCount},(_,i)=>`<label><b>${language==="gu"?"પાર્ટનર માટે પત્તો પસંદ કરો":"Choose partner card"} ${i+1}</b><select id="partnerCard${i}">${selectOptions(i)}</select><small>This is the partner card call. The partner name stays hidden until this exact card is played.</small></label>`).join("");
    panel.innerHTML=`<div class="contract-timer">${language==="gu"?"સમય":"Time"}: <b id="actionCountdown" class="inline-countdown">${actionSeconds}</b>s</div><div class="contract-choice-title"><strong>🤝 ${escapeHtml(state.players[state.viewerIndex]?.name||"Bidder")}, choose your partner card${state.partnerCount===1?"":"s"}</strong><span>Your bid: ${state.bid.current} · You and your partner${state.partnerCount===1?"":"s"} must score at least ${state.bid.current} points to win.</span></div><div class="contract-grid"><label>${language==="gu"?"હુકમ":"Hukum / Trump"}<select id="trumpPick">${["S","H","D","C"].map(s=>`<option value="${s}">${suitSymbol[s]} ${suitName[s]}</option>`).join("")}</select></label><div class="partner-picks">${partnerHTML}</div><button id="lockContract" class="primary" type="button">${language==="gu"?"પાર્ટનર પત્તો લોક કરો":"Lock partner & start"}</button></div><p class="note">${language==="gu"?`${state.partnerCount} અલગ પત્તા પસંદ કરો. દરેક પત્તો અલગ ખેલાડી પાસે હોવો જરૂરી છે. પાર્ટનર તેનો called card રમે ત્યારે જ જાહેર થશે.`:`The bidder chooses Hukum and ${state.partnerCount} exact partner card${state.partnerCount===1?"":"s"}. Only the chosen card is shown at the start. The partner name is revealed only when that exact card is played.`}</p>`;
    $("lockContract").addEventListener("click",()=>{
      const ids=Array.from({length:state.partnerCount},(_,i)=>$(`partnerCard${i}`).value);
      if(new Set(ids).size!==ids.length){toast(language==="gu"?"દરેક પાર્ટનર માટે અલગ પત્તો પસંદ કરો.":"Choose a different card for each hidden partner.");return;}
      const partnerCards=ids.map(id=>{const [copy,suit,...rankParts]=id.split("-");return {copy:Number(copy),suit,rank:rankParts.join("-")};});
      beep("win");emitAction("contract",{trump:$("trumpPick").value,partnerCards});
    });return;
  }

  if(state.phase==="playing"&&state.trickResolving){
    const winner=state.players[state.lastTrick?.winnerIndex];
    panel.innerHTML=`<div class="trick-review-panel"><strong>🏆 ${escapeHtml(winner?.name||"Player")} won this trick</strong><span>+${state.lastTrick?.points||0} points</span><small>Cards stay on the table so everyone can review the trick.</small><b id="trickReviewCountdown" class="inline-countdown">${Math.max(1,Math.ceil(((state.trickReviewUntil||Date.now())-Date.now())/1000))}</b></div>`;
    return;
  }
  if(state.phase==="playing"){
    const called=(state.calledPartners||[]).map(c=>`${c.rank}${suitSymbol[c.suit]}${(state.deckCount||1)===2?` · Deck ${c.copy}`:""}`).join(" · ");
    const turnLine=state.turnIndex===state.viewerIndex?`<div class="turn-banner mine"><span>●</span><strong>${language==="gu"?"તમારી ચાલ":"YOUR TURN"}</strong><small>${language==="gu"?"હાઇલાઇટ થયેલો પત્તો રમો":"Play a highlighted card"}</small><b id="turnCountdown" class="turn-countdown">${actionSeconds}</b></div>`:`<div class="turn-banner"><span>●</span><strong>${escapeHtml(state.players[state.turnIndex].name)}</strong><small>${language==="gu"?"ની ચાલ":"is playing"}</small><b id="turnCountdown" class="turn-countdown">${actionSeconds}</b></div>`;
    const bidderName=escapeHtml(state.players[state.bid.bidderIndex]?.name||"Bidder");
    const hukumLabel=`${suitSymbol[state.trump]||""} ${suitName[state.trump]||state.trump||"—"}`.trim();
    const revealedNames=(state.revealedPartners||[]).map(i=>escapeHtml(state.players[i]?.name||"Partner")).join(" · ");
    const partnerRevealHTML=revealedNames?`<div class="partner-reveal-banner"><span class="partner-reveal-kicker">🤝 PARTNER REVEALED</span><strong>${revealedNames}</strong><small>Revealed because the bidder's chosen partner card was played.</small></div>`:"";
    const contractCallBanner=`<div class="partner-start-banner contract-call-banner"><div class="contract-call-block hukum-call"><span class="partner-start-kicker">${suitSymbol[state.trump]||""} HUKUM</span><strong>${hukumLabel}</strong><small>Chosen by ${bidderName}</small></div><div class="contract-call-block partner-card-call"><span class="partner-start-kicker">🂠 PARTNER CARD${(state.partnerCount||1)===1?"":"S"}</span><strong>${called||"—"}</strong><small>Only the chosen card is shown now. Partner name appears only when this card is played.</small></div></div>`;
    panel.innerHTML=`${contractCallBanner}${partnerRevealHTML}${turnLine}<div id="afkWarning" class="afk-warning hidden"></div><div class="live-contract"><span>Bidder: <b>${bidderName}</b></span><span>${language==="gu"?"ટાર્ગેટ":"Target"}: <b>${state.bid.current}/${state.totalPoints||500}</b></span><span>${language==="gu"?"હુકમ":"Hukum"}: <b>${hukumLabel}</b></span><span>${language==="gu"?"પાર્ટનર માટે પસંદ પત્તા":"Partner card"}: <b>${called}</b></span>${revealedNames?`<span>${language==="gu"?"પાર્ટનર જાહેર":"Partner revealed"}: <b>${revealedNames}</b></span>`:""}</div>`;return;
  }

  if(state.phase==="roundEnd"){
    const rs=state.roundSummary||{};
    const points=Number(rs.bidderPoints??state.players.filter((_,i)=>state.bidderTeam.includes(i)).reduce((s,p)=>s+p.roundPoints,0));
    const made=rs.made??(points>=state.bid.current);
    const winnerLabel=made?"BIDDER + PARTNER TEAM WINS":"OPPOSITE TEAM WINS";
    const winnerPoints=made?Number(rs.bidderPoints||0):Number(rs.defensePoints||0);
    const loserPoints=made?Number(rs.defensePoints||0):Number(rs.bidderPoints||0);
    const me=state.players[state.viewerIndex];const rematchCount=state.players.filter(p=>!p.bot&&p.connected&&p.rematchReady).length;const humanCount=state.players.filter(p=>!p.bot&&p.connected).length;
    panel.innerHTML=`<div class="section-title round-result final-round-head"><div><span class="winner-kicker">🏆 ROUND WINNER</span><h3 class="success">${winnerLabel}</h3><p><b>${winnerPoints}</b> points vs <b>${loserPoints}</b> points · Bid target <b>${state.bid.current}</b></p><small>${made?`Bidder team reached the bid (${points} ≥ ${state.bid.current}).`:`Bidder team missed the bid (${points} < ${state.bid.current}), so the opposite team wins.`}</small><small>MVP: ${escapeHtml(rs.mvpName||"—")} · ${rs.mvpPoints||0} pts · Audit ${escapeHtml(state.auditId||"—")}</small><small>${rematchCount}/${humanCount} players want a rematch</small></div><div class="round-buttons"><button id="shareResultBtn" class="room-secondary-action" type="button">Share Result</button><button id="rematchBtn" class="room-secondary-action ${me?.rematchReady?"is-ready":""}" type="button">${me?.rematchReady?"✓ Rematch ready":"↻ Rematch"}</button>${state.host?`<button id="nextRoundBtn" class="primary" type="button">Deal next round now</button>`:""}</div></div>`;
    $("shareResultBtn")?.addEventListener("click",shareRoundResult);
    $("rematchBtn")?.addEventListener("click",()=>emitAction("rematch",{}));
    if(state.host)$("nextRoundBtn")?.addEventListener("click",()=>emitAction("nextRound",{}));
  }
}

function renderScoreboard(){
  // Fair-play scoring: before every hidden partner is revealed, never infer the secret
  // team from server-only ownership. Only visibly assigned teams are counted here.
  const bidderPts=state.players.reduce((sum,p)=>sum+(p.team==="bidder"?(p.roundPoints||0):0),0);
  const defensePts=state.players.reduce((sum,p)=>sum+(p.team==="defense"?(p.roundPoints||0):0),0);
  const hiddenPts=state.players.reduce((sum,p)=>sum+(!p.team?(p.roundPoints||0):0),0);
  const captured=state.players.reduce((sum,p)=>sum+(p.roundPoints||0),0);
  const remaining=Math.max(0,(state.totalPoints||0)-captured);
  const teamsFullyKnown=state.phase==="roundEnd" || (state.revealedPartners||[]).length >= Number(state.partnerCount||0);
  $("scoreboard").innerHTML=`<div class="score-row score-head"><strong>${language==="gu"?"ખેલાડી":"Player"}</strong><span>Total</span><span>${language==="gu"?"કૅપ્ચર":"Pts"}</span><span>Team</span></div>${state.players.map((p,i)=>`<div class="score-row ${i===state.viewerIndex?"me":""} ${p.team||""}"><strong>${escapeHtml(p.name)}${i===state.viewerIndex?" · You":""}</strong><span>${p.score}</span><span>${p.roundPoints}</span><span class="score-team">${p.team||"Hidden"}</span></div>`).join("")}`;
  const details=$("pointDetails");
  if(details){
    const d=state.deckCount||1;
    const rows=[
      ["3♠",30,d,30*d],
      ["A",10,4*d,40*d],["K",10,4*d,40*d],["Q",10,4*d,40*d],["J",10,4*d,40*d],["10",10,4*d,40*d],["5",5,4*d,20*d]
    ];
    const target=Number(state.bid?.current||0),needed=Math.max(0,target-bidderPts);
    const bidderMaxPossible=bidderPts+hiddenPts+remaining;
    const pct=target?Math.min(100,Math.round(bidderPts/target*100)):0;
    let contractState="Waiting for bid",dangerClass="live";
    if(target>1){
      if(bidderPts>=target){contractState="Contract secured";dangerClass="safe";}
      else if(bidderMaxPossible<target){contractState="Contract cannot be reached";dangerClass="lost";}
      else if(!teamsFullyKnown&&hiddenPts>0){contractState=`Need ${needed} · ${hiddenPts} pts still on hidden team seat${hiddenPts===1?"":"s"}`;dangerClass="live";}
      else{contractState=`Need ${needed} more point${needed===1?"":"s"}`;dangerClass=remaining&&needed/remaining>.65?"danger":"live";}
    }
    const total=Math.max(1,Number(state.totalPoints||1)),bidderPct=Math.min(100,bidderPts/total*100),defPct=Math.min(100,defensePts/total*100);
    const hiddenSummary=!teamsFullyKnown?`<div><span>Hidden / unassigned</span><b>${hiddenPts}</b></div>`:"";
    const fairPlayNote=!teamsFullyKnown?`<small class="fair-play-note">Hidden-partner points stay unassigned until the partner is revealed, so the score table never exposes the secret team.</small>`:"";
    const rs=state.roundSummary||{};
    let finalResult="";
    if(state.phase==="roundEnd"&&typeof rs.made==="boolean"){
      const bidderWin=Boolean(rs.made);
      const winIdx=bidderWin?(rs.bidderTeamIndexes||state.bidderTeam):(rs.defenseTeamIndexes||[]);
      const loseIdx=bidderWin?(rs.defenseTeamIndexes||[]):(rs.bidderTeamIndexes||state.bidderTeam);
      const winCards=bidderWin?(rs.bidderScoringCards||[]):(rs.defenseScoringCards||[]);
      const loseCards=bidderWin?(rs.defenseScoringCards||[]):(rs.bidderScoringCards||[]);
      const winBreak=bidderWin?(rs.bidderPointBreakdown||[]):(rs.defensePointBreakdown||[]);
      const loseBreak=bidderWin?(rs.defensePointBreakdown||[]):(rs.bidderPointBreakdown||[]);
      const winLabel=bidderWin?"Bidder + Partner Team":"Opposite Team";
      const loseLabel=bidderWin?"Opposite Team":"Bidder + Partner Team";
      finalResult=`<section class="final-result-board">${partnerCallSummary(rs)}<div class="contract-verdict ${bidderWin?"made":"failed"}"><strong>${bidderWin?"✓ CONTRACT MADE":"✕ CONTRACT FAILED"}</strong><span>Bidder team ${rs.bidderPoints||0} ${bidderWin?"≥":"<"} bid ${rs.bid||state.bid.current}. ${bidderWin?"Bidder + partner side wins.":"Opposite side wins."}</span></div><div class="final-team-grid"><article class="final-team-card winner"><span class="team-result-label">🏆 WINNING TEAM</span><h4>${winLabel}</h4><p>${teamNames(winIdx)}</p><div class="team-final-points">${rs.winningPoints??(bidderWin?rs.bidderPoints:rs.defensePoints)} <small>points</small></div>${resultBreakdown(winBreak)}<div class="captured-point-cards"><b>Point cards captured</b><div>${resultPointCards(winCards)}</div></div></article><article class="final-team-card loser"><span class="team-result-label">LOSING TEAM</span><h4>${loseLabel}</h4><p>${teamNames(loseIdx)}</p><div class="team-final-points">${rs.losingPoints??(bidderWin?rs.defensePoints:rs.bidderPoints)} <small>points</small></div>${resultBreakdown(loseBreak)}<div class="captured-point-cards"><b>Point cards captured</b><div>${resultPointCards(loseCards)}</div></div></article></div><div class="final-total-check"><span>Winning + losing points</span><b>${Number(rs.bidderPoints||0)+Number(rs.defensePoints||0)} / ${state.totalPoints||0}</b><span class="${Number(rs.bidderPoints||0)+Number(rs.defensePoints||0)==Number(state.totalPoints||0)?"success":"danger"}">${Number(rs.bidderPoints||0)+Number(rs.defensePoints||0)==Number(state.totalPoints||0)?"✓ All point cards accounted for":"⚠ Check point audit"}</span></div></section>`;
    }
    details.innerHTML=`${finalResult}<div class="point-summary-title"><strong>Point details</strong><span>${state.playerCount}P · ${d} deck${d===2?"s":""} · ${state.cardsEach||0} cards each</span></div><div class="score-race"><div><b>${teamsFullyKnown?"Bidder":"Known bidder"} ${bidderPts}</b><b>${teamsFullyKnown?"Defense":"Known defense"} ${defensePts}</b></div><i><em class="bidder" style="width:${bidderPct}%"></em><em class="defense" style="width:${defPct}%"></em></i></div><div class="contract-progress ${dangerClass}"><div><b>${contractState}</b><span>${bidderPts}/${target||"—"}</span></div><i><em style="width:${pct}%"></em></i></div><div class="live-point-summary"><div><span>Contract</span><b>${state.bid?.current??"—"}/${state.totalPoints||0}</b></div><div><span>${teamsFullyKnown?"Bidder team":"Known bidder"}</span><b>${bidderPts}</b></div><div><span>${teamsFullyKnown?"Defense":"Known defense"}</span><b>${defensePts}</b></div>${hiddenSummary}<div><span>Still in hand</span><b>${remaining}</b></div></div>${fairPlayNote}<div class="mini-point-table"><div class="mpt-head"><span>Card</span><span>Each</span><span>Count</span><span>Total</span></div>${rows.map(r=>`<div><b>${r[0]}</b><span>${r[1]}</span><span>${r[2]}</span><strong>${r[3]}</strong></div>`).join("")}<div class="mpt-total"><b>ALL POINTS</b><span></span><span></span><strong>${state.totalPoints||0}</strong></div></div>`;
  }
}
function renderHistories(){
  const bh=$("bidHistory"),th=$("trickHistory");
  if(bh){const rows=state.bid?.history||[];bh.innerHTML=rows.length?rows.slice(-12).reverse().map(x=>`<div class="history-entry"><b>${escapeHtml(state.players[x.playerIndex]?.name||"Player")}</b><span>${x.pass?"PASS":`Bid ${x.amount}`}${x.auto?" · auto":""}</span></div>`).join(""):'<div class="muted">No bids yet.</div>';}
  if(th){const rows=state.trickHistory||[];th.innerHTML=rows.length?rows.slice().reverse().map(t=>`<div class="history-entry trick"><b>#${t.number||"?"} · 🏆 ${escapeHtml(state.players[t.winnerIndex]?.name||"Player")}</b><span>+${t.points||0}</span><small>${(t.cards||[]).map(x=>`${x.card.rank}${suitSymbol[x.card.suit]}`).join(" · ")}</small></div>`).join(""):'<div class="muted">No completed tricks yet.</div>';}
}
function renderRuleSummary(){const b=$("ruleSummaryBar");if(!b||!state)return;b.classList.remove("hidden");const integ=state.integrity||{};b.innerHTML=`<strong>${escapeHtml(state.ruleSummary||`${state.playerCount}P`)}</strong><span>Timer ${Math.round((state.actionTimeoutMs||60000)/1000)}s · Audit ${escapeHtml(state.auditId||"starts on deal")} · Deck ${integ.deckVerified?"✓":"—"} · Score ${integ.scoreVerified===false?"⚠":"✓"}</span>`;}
async function shareRoundResult(){if(!state)return;const rs=state.roundSummary||{};const text=`Kaali Ni Tidi · ${state.ruleSummary||""}
Round ${state.round} · Bid ${state.bid.current}
${rs.made?"Bidder + partner team WINS":"Opposite team WINS"} · Bidder ${rs.bidderPoints??0} · Opposite ${rs.defensePoints??0}
${rs.made?`${rs.bidderPoints??0} ≥ ${rs.bid??state.bid.current}`:`${rs.bidderPoints??0} < ${rs.bid??state.bid.current}`} · ${rs.made?"Contract made":"Contract failed"}
MVP ${rs.mvpName||"—"} (${rs.mvpPoints||0})
Audit ${state.auditId||"—"}`;try{if(navigator.share)await navigator.share({title:"Kaali Ni Tidi Result",text});else{await navigator.clipboard.writeText(text);toast("Result copied.");}}catch{}}
function renderLog(){$("gameLog").innerHTML=state.log.map(x=>`<div class="log-line">${escapeHtml(x)}</div>`).join("");}

function renderChat(){
  const wrap=$("chatMessages");wrap.innerHTML="";
  (state.chat||[]).forEach(m=>{
    if(m.playerIndex!==state.viewerIndex&&mutedChatPlayers.has(Number(m.playerIndex)))return;
    const d=document.createElement("div");d.className="chat-msg";
    d.innerHTML=`<div>${m.avatar||"😎"}</div><div><div class="who">${escapeHtml(m.name)}</div><div class="bubble">${escapeHtml(m.text)}</div></div>`;
    wrap.appendChild(d);
  });
  wrap.scrollTop=wrap.scrollHeight;
}

function renderTurnText(){
  let text="";
  if(state.phase==="lobby")text=`${state.players.length}/${state.playerCount}`;
  if(state.phase==="bidding")text=`${language==="gu"?"બિડ":"Bid"}: ${state.players[state.bid.turnIndex].name}`;
  if(state.phase==="contract")text=`${state.players[state.bid.bidderIndex].name} ${language==="gu"?"બિડ જીત્યા":"won bid"}`;
  if(state.phase==="playing")text=`${language==="gu"?"ચાલ":"Turn"}: ${state.players[state.turnIndex].name}`;
  if(state.phase==="roundEnd")text=`${language==="gu"?"રાઉન્ડ":"Round"} ${state.round}`;
  $("turnText").textContent=text;
}

function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}


function showRules(){
  const m=$("rulesModal");if(m)m.classList.remove("hidden");
}
function hideRules(){const m=$("rulesModal");if(m)m.classList.add("hidden");}
$("rulesBtn")?.addEventListener("click",showRules);
$("rulesClose")?.addEventListener("click",hideRules);
$("rulesModal")?.addEventListener("click",e=>{if(e.target.id==="rulesModal")hideRules();});

$("saveProfileBtn").addEventListener("click",saveProfile);
$("langBtn").addEventListener("click",()=>{language=language==="en"?"gu":language==="gu"?"hi":"en";localStorage.setItem("knt_lang",language);applyLanguage();});
$("soundBtn").addEventListener("click",()=>{soundOn=!soundOn;localStorage.setItem("knt_sound",soundOn?"on":"off");$("soundBtn").textContent=soundOn?"🔊":"🔇";if(soundOn)beep("win");});

$("createForm").addEventListener("submit",e=>{
  e.preventDefault();const p=currentProfile();saveProfile();
  socket.emit("createRoom",{name:p.name,avatar:p.avatar,playerCount:Number($("playerCount").value),deckCount:Number($("playerCount").value)===4?Number($("fourPlayerDeckCount")?.value||1):undefined,isPublic:Boolean($("publicRoomToggle")?.checked),botDifficulty:$("botDifficulty")?.value||"normal",botPersonality:$("botPersonality")?.value||"balanced",privatePin:$("createPin")?.value||"",turnTimeoutMs:Number($("turnTimer")?.value||60000),spectatorDelayMs:Number($("spectatorDelay")?.value||5000),preset:$("rulePreset")?.value||"classic"},res=>{if(!res?.ok)return toast(res?.error||"Could not create room.");saveSession(res.code,res.reconnectToken);});
});
$("joinForm").addEventListener("submit",e=>{
  e.preventDefault();const p=currentProfile();saveProfile();
  socket.emit("joinRoom",{name:p.name,avatar:p.avatar,code:$("joinCode").value.toUpperCase(),privatePin:$("joinPin")?.value||""},res=>{if(!res?.ok)return toast(res?.error||"Could not join room.");saveSession(res.code,res.reconnectToken);});
});
$("reclaimBtn")?.addEventListener("click",()=>socket.emit("reclaimControl",{},r=>toast(r?.ok?"You control your seat again.":r?.error||"Could not reclaim control.")));
$("readyBtn")?.addEventListener("click",()=>socket.emit("toggleReady",{},res=>{if(res&&!res.ok)toast(res.error);else haptic(12);}));
$("startBtn").addEventListener("click",()=>emitAction("startGame",{}));
$("copyCodeBtn").addEventListener("click",async()=>{
  if(!state)return;
  try{await navigator.clipboard.writeText(state.code);toast(`Room code ${state.code} copied.`);}
  catch{toast(`Room code: ${state.code}`);}
});
$("fullscreenBtn")?.addEventListener("click",async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen?.();else await document.exitFullscreen?.();try{await screen.orientation?.lock?.("landscape");}catch{}}catch{toast("Fullscreen is not available on this device.");}});
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement){try{screen.orientation?.unlock?.();}catch{}}});
$("performanceBtn")?.addEventListener("click",()=>{performanceMode=!performanceMode;localStorage.setItem("knt_performance_v22",performanceMode?"on":"off");applyPerformanceMode();toast(performanceMode?"Data Saver enabled — reduced effects and smaller live-state history payloads.":"Full animations and history payloads restored.");});
$("auditBtn")?.addEventListener("click",()=>socket.emit("matchAudit",{},r=>{if(!r?.ok)return toast(r?.error||"Audit unavailable.");const a=r.audit||{};const bids=(a.bidHistory||[]).map(x=>`<div class="audit-review-row"><b>${escapeHtml(state?.players?.[x.playerIndex]?.name||"Player")}</b> · ${x.pass?"PASS":`Bid ${x.amount}`}${x.auto?" · auto":""}</div>`).join("")||'<div class="muted">No bids recorded yet.</div>';const tricks=(a.trickHistory||[]).map(t=>`<div class="audit-review-row"><b>Trick ${t.number||"?"} · ${escapeHtml(state?.players?.[t.winnerIndex]?.name||"Player")} +${t.points||0}</b><small>${(t.cards||[]).map(x=>`${escapeHtml(state?.players?.[x.playerIndex]?.name||"P")}: ${x.card.rank}${suitSymbol[x.card.suit]}`).join(" · ")}</small></div>`).join("")||'<div class="muted">No tricks recorded yet.</div>';v16Modal("Match Audit & Review",`<p><b>${escapeHtml(a.auditId||"Not started")}</b></p><p>${escapeHtml(a.ruleSummary||"")}</p><div class="audit-grid"><div>Deck integrity <b>${a.integrity?.deckVerified?"✓ Verified":"—"}</b></div><div>Score integrity <b>${a.integrity?.scoreVerified===false?"⚠ Check failed":"✓ Verified"}</b></div><div>Bids <b>${(a.bidHistory||[]).length}</b></div><div>Tricks <b>${(a.trickHistory||[]).length}</b></div></div><h4>Bid audit</h4><div class="audit-review">${bids}</div><h4>Trick audit</h4><div class="audit-review">${tricks}</div>`);}));

$("chatForm").addEventListener("submit",e=>{
  e.preventDefault();const text=$("chatInput").value.trim();if(!text)return;
  socket.emit("chatMessage",{text},res=>{if(res&&!res.ok)toast(res.error);});$("chatInput").value="";beep("chat");
});
const emojiBar=$("emojiBar");
emojis.forEach(em=>{
  const b=document.createElement("button");b.type="button";b.className="emoji-btn";b.textContent=em;
  b.addEventListener("click",()=>{socket.emit("chatMessage",{text:em},res=>{if(res&&!res.ok)toast(res.error);});beep("chat");});
  emojiBar.appendChild(b);
});

socket.on("state",next=>{
  const prev=state;
  const trickSig=next.lastTrick?`${next.round}:${next.trickNumber}:${next.lastTrick.winnerIndex}:${next.lastTrick.points}`:"";
  const handSig=(next.hand||[]).map(c=>c.id).join("|");
  if(prev&&prev.phase==="playing"&&next.phase==="roundEnd"){beep("win");haptic([40,35,80]);recordRoundStats(next);setTimeout(()=>{refreshCloudMe();refreshReplays();refreshTournaments();},300);}
  else if(prev&&prev.phase==="contract"&&next.phase==="playing"){
    const called=(next.calledPartners||[]).map(c=>`${c.rank}${suitSymbol[c.suit]}${(next.deckCount||1)===2?` (Deck ${c.copy})`:""}`).join(" · ");
    const bidder=next.players?.[next.bid?.bidderIndex]?.name||"Bidder";
    toast(`${bidder} chose ${called||"the called card"} as partner card${(next.partnerCount||1)===1?"":"s"}.`);
    beep("win");
  }
  else if(prev&&next.phase==="playing"&&trickSig&&trickSig!==lastTrickSignature)beep("trick");
  else if(prev&&next.phase==="playing"&&next.turnIndex===next.viewerIndex&&prev.turnIndex!==next.turnIndex)beep("turn");
  else if(prev&&handSig!==lastHandSignature&&next.phase==="playing")beep("deal");
  lastTrickSignature=trickSig;lastHandSignature=handSig;setActionLocked(false);state=next;if(selectedPlayCardId&&!next.hand?.some(c=>c.id===selectedPlayCardId))selectedPlayCardId=null;render();
  $("spectatorStatus")?.classList.toggle("hidden",!next.spectator);
  if(practicePending&&next.phase==="lobby"&&next.host&&!next.spectator){practicePending=false;const me=next.players[next.viewerIndex];const start=()=>socket.emit("startGame",{},r=>{if(r&&!r.ok)toast(r.error);});if(me?.ready)start();else socket.emit("toggleReady",{},r=>{if(r?.ok)start();else toast(r?.error||"Could not start practice.");});}
});
$("joinVoiceBtn")?.addEventListener("click",joinVoice);
$("muteVoiceBtn")?.addEventListener("click",toggleVoiceMute);
$("leaveVoiceBtn")?.addEventListener("click",()=>leaveVoice(true));
$("leaveRoomBtn")?.addEventListener("click",()=>{if(!state)return;const msg=activeLiveMatch()?"Leave the live match? Your seat will switch to Bot Assist while other real players remain.":(language==="gu"?"રૂમ છોડવો છે?":"Leave this room?");if(!confirm(msg))return;socket.emit("leaveRoom",{},()=>{clearSession();location.reload();});});
socket.on("roomClosed",({reason}={})=>{clearSession();const noHumans=reason==="no-human-players";toast(language==="gu"?(noHumans?"કોઈ વાસ્તવિક ખેલાડી બાકી નથી — રૂમ બંધ થયો.":"રૂમ બંધ થઈ ગયો."):(noHumans?"No real players remain — the room was closed.":"Room closed or expired."));setTimeout(()=>location.reload(),1100);});
socket.on("kicked",({reason})=>{clearSession();alert(reason||"You were removed from the room.");location.reload();});
socket.on("voicePeerLeft",({playerIndex})=>closeVoicePeer(Number(playerIndex)));
socket.on("voiceSignal",({fromIndex,signal})=>handleVoiceSignal(Number(fromIndex),signal));
window.addEventListener("beforeunload",e=>{if(voiceJoined)socket.emit("voiceLeave");if(activeLiveMatch()){e.preventDefault();e.returnValue="";}});
window.addEventListener("popstate",()=>{if(!IS_PACKAGED_APP||!backGuardArmed)return;if(activeLiveMatch()){if(confirm("Leave the live match? Bot Assist will take over your seat.")){socket.emit("leaveRoom",{},()=>{clearSession();location.reload();});}else{history.pushState({kntGame:true},"");}}});
document.addEventListener("visibilitychange",()=>updateWakeLock());
updateVoiceControls();

function setNetStatus(mode,text){const el=$("netStatus");if(!el)return;el.className=`net-status ${mode}`;el.textContent=text;}
socket.on("connect",()=>{setNetStatus("online","● Online");socket.emit("clientMode",{lowNetwork:performanceMode});resumeAccount();tryResumeSession(false);socket.emit("rtcConfig",{},res=>{if(res?.ok&&Array.isArray(res.iceServers))rtcConfig={iceServers:res.iceServers};});refreshPublicRooms();});
socket.on("disconnect",()=>{setNetStatus("offline","● Reconnecting…");toast(language==="gu"?"કનેક્શન તૂટ્યું — ફરી જોડાઈ રહ્યા છીએ…":"Connection lost — reconnecting…");});
socket.io.on("reconnect_attempt",()=>setNetStatus("connecting","● Reconnecting…"));
socket.io.on("reconnect",()=>{setNetStatus("online","● Online");tryResumeSession(true);});
socket.on("connect_error",()=>setNetStatus("offline","● Offline"));

setInterval(()=>{
  if(!state)return;
  if(state.actionDeadline){
    const timeout=Math.max(1000,state.actionTimeoutMs||60000);
    const remainingMs=Math.max(0,state.actionDeadline-Date.now());
    const remaining=Math.ceil(remainingMs/1000);
    const c=$("turnCountdown");if(c)c.textContent=String(remaining);
    const a=$("actionCountdown");if(a)a.textContent=String(remaining);
    const afk=$("afkWarning");if(afk&&state.phase==="playing"&&state.turnIndex===state.viewerIndex){const show=remaining<=15&&remaining>0;afk.classList.toggle("hidden",!show);if(show){const strikes=Number(state.players?.[state.viewerIndex]?.timeoutStreak||0);afk.textContent=strikes>=2?`⚠ ${remaining}s left — Bot Assist activates if this turn times out.`:`⚠ ${remaining}s left — timeout will auto-play a legal card · AFK ${strikes+1}/3.`;}}
    document.querySelectorAll(".seat.active .seat-timer i").forEach(el=>el.style.transform=`scaleX(${Math.max(0,Math.min(1,remainingMs/timeout))})`);
  }
  if(state.trickResolving&&state.trickReviewUntil){const t=$("trickReviewCountdown");if(t)t.textContent=String(Math.max(0,Math.ceil((state.trickReviewUntil-Date.now())/1000)));}
  document.querySelectorAll("[data-until]").forEach(el=>{const until=Number(el.dataset.until||0);if(!until)return;const sec=Math.max(0,Math.ceil((until-Date.now())/1000));if(el.classList.contains("reconnect-badge"))el.textContent=`↻ BOT ASSIST · ${sec}s`;else el.textContent=`Reconnect ${sec}s`;});
},250);



function v16Modal(title,html){const m=$("v16Modal");if(!m)return;$("v16ModalTitle").textContent=title;$("v16ModalContent").innerHTML=html;m.classList.remove("hidden");}
function applyStylePrefs(settings){let s=settings;try{s=s||JSON.parse(localStorage.getItem(STYLE_KEY)||"null")||{};}catch{s={};}document.body.classList.remove("theme-royal","theme-midnight","theme-gujarat","large-text","high-contrast","cardback-royal","cardback-blackgold","cardback-traditional");if(s.theme&&s.theme!=="classic")document.body.classList.add(`theme-${s.theme}`);if(s.largeText)document.body.classList.add("large-text");if(s.highContrast)document.body.classList.add("high-contrast");if(s.cardBack&&s.cardBack!=="emerald")document.body.classList.add(`cardback-${s.cardBack}`);if($("themeSelect"))$("themeSelect").value=s.theme||"classic";if($("cardBackSelect"))$("cardBackSelect").value=s.cardBack||"emerald";if($("largeTextToggle"))$("largeTextToggle").checked=!!s.largeText;if($("contrastToggle"))$("contrastToggle").checked=!!s.highContrast;}
function stylePayload(){return {theme:$("themeSelect")?.value||"classic",cardBack:$("cardBackSelect")?.value||"emerald",largeText:Boolean($("largeTextToggle")?.checked),highContrast:Boolean($("contrastToggle")?.checked)};}
function renderCloudUser(){const signed=!!cloudUser;$("accountSignedOut")?.classList.toggle("hidden",signed);$("accountSignedIn")?.classList.toggle("hidden",!signed);if($("accountBadge"))$("accountBadge").textContent=signed?`${cloudUser.avatar} @${cloudUser.username}`:"Guest";if(!signed){$("seasonSummary").textContent="Sign in to enter ranked matchmaking.";$("achievementList").innerHTML='<div class="muted">Sign in to sync achievements.</div>';$("dailyChallenges").innerHTML='<div class="muted">Sign in to load today’s challenges.</div>';return;}const st=cloudUser.stats||{},ss=cloudUser.seasonStats||{};$("cloudProfile").innerHTML=`<div class="big-avatar">${cloudUser.avatar}</div><div><strong>${escapeHtml(cloudUser.displayName)}</strong><small>@${escapeHtml(cloudUser.username)} · ${st.wins||0} wins · ${st.rounds||0} rounds</small></div>`;$("seasonSummary").innerHTML=`<div class="season-rating">${ss.rating||cloudUser.rating||1000}</div><div>Season ${escapeHtml(cloudUser.season)} · ${ss.wins||0}/${ss.games||0} wins</div>`;$("achievementList").innerHTML=(cloudUser.achievements||[]).length?(cloudUser.achievements||[]).slice(-8).reverse().map(a=>`<div class="mini-row achievement done"><span>🏅 ${escapeHtml(a.label)}</span><small>${new Date(a.unlockedAt).toLocaleDateString()}</small></div>`).join(""):'<div class="muted">Win matches to unlock achievements.</div>';$("dailyChallenges").innerHTML=(cloudUser.challenges||[]).map(c=>`<div class="mini-row"><div><b>${c.done?"✓":"🎯"} ${escapeHtml(c.label)}</b><div class="challenge-bar"><i style="width:${Math.min(100,Math.round(100*c.value/c.goal))}%"></i></div></div><strong>${Math.min(c.value,c.goal)}/${c.goal}</strong></div>`).join("");if(cloudUser.settings)applyStylePrefs(cloudUser.settings);refreshFriends();}
function saveAccountToken(token){try{token?localStorage.setItem(ACCOUNT_TOKEN_KEY,token):localStorage.removeItem(ACCOUNT_TOKEN_KEY);}catch{}}
function resumeAccount(){let token="";try{token=localStorage.getItem(ACCOUNT_TOKEN_KEY)||"";}catch{}if(!token)return;socket.emit("accountResume",{token},r=>{if(r?.ok){cloudUser=r.user;renderCloudUser();refreshReplays();refreshTournaments();}else saveAccountToken("");});}
function loginAccount(register=false){const username=$("accountUsername")?.value||"",password=$("accountPassword")?.value||"",p=currentProfile();socket.emit(register?"accountRegister":"accountLogin",{username,password,displayName:p.name,avatar:p.avatar},r=>{if(!r?.ok)return toast(r?.error||"Account failed.");cloudUser=r.user;saveAccountToken(r.token);renderCloudUser();refreshReplays();refreshTournaments();toast(register?"Account created.":"Signed in.");});}
function refreshCloudMe(){if(!cloudUser)return;socket.emit("accountMe",{},r=>{if(r?.user){cloudUser=r.user;renderCloudUser();}});}
function refreshFriends(){if(!cloudUser)return;socket.emit("friendList",{},r=>{if(!r?.ok)return;const requests=r.requests||[],rows=r.rows||[];$("friendList").innerHTML=[...requests.map(x=>`<div class="mini-row"><span>${x.avatar} ${escapeHtml(x.displayName)} requested you</span><span><button class="tiny-btn friend-accept" data-id="${x.id}">Accept</button></span></div>`),...rows.map(x=>`<div class="mini-row"><span>${x.avatar} ${escapeHtml(x.displayName)} <small>@${escapeHtml(x.username)} · ${x.online?"online":"offline"}</small></span>${x.online?`<button class="tiny-btn friend-invite" data-id="${x.id}">Invite</button>`:""}</div>`)].join("")||'<div class="muted">No friends yet.</div>';document.querySelectorAll(".friend-accept").forEach(b=>b.addEventListener("click",()=>socket.emit("friendRespond",{userId:b.dataset.id,accept:true},r=>{if(r?.ok){cloudUser=r.user;renderCloudUser();}})));document.querySelectorAll(".friend-invite").forEach(b=>b.addEventListener("click",()=>socket.emit("inviteFriend",{userId:b.dataset.id},r=>toast(r?.ok?"Invite sent.":r?.error||"Could not invite."))));});}
function refreshReplays(){if(!cloudUser){$("replayList").innerHTML='<div class="muted">Sign in to see cloud replays.</div>';return;}socket.emit("replayList",{},r=>{const rows=r?.rows||[];$("replayList").innerHTML=rows.length?rows.slice(0,8).map(x=>`<div class="mini-row"><span>${new Date(x.createdAt).toLocaleDateString()} · ${x.playerCount}P · Bid ${x.bid}</span><button class="tiny-btn replay-open" data-id="${x.id}">View</button></div>`).join(""):'<div class="muted">No cloud replays yet.</div>';document.querySelectorAll(".replay-open").forEach(b=>b.addEventListener("click",()=>socket.emit("replayGet",{id:b.dataset.id},res=>{if(!res?.ok)return toast(res?.error);const x=res.replay;v16Modal("Match Replay",`<p><b>${x.playerCount} players · Bid ${x.bid} · ${x.made?"Contract made":"Contract failed"}</b></p><div class="replay-events">${(x.events||[]).map(e=>`<div class="replay-event"><b>${escapeHtml(e.type)}</b> ${e.playerIndex!=null?`· ${escapeHtml(x.players[e.playerIndex]?.name||"")}`:""} ${e.card?`· ${e.card.rank}${suitSymbol[e.card.suit]||e.card.suit}`:""} ${e.amount?`· ${e.amount}`:""}</div>`).join("")}</div>`);})));});}
function refreshTournaments(){socket.emit("tournamentList",{},r=>{const rows=r?.rows||[];$("tournamentList").innerHTML=rows.length?rows.slice(0,8).map(t=>`<div class="mini-row"><span><b>${escapeHtml(t.name)}</b><small>${t.entrants.length}/${t.size} · ${t.status} ${t.round?`· R${t.round}`:""}</small></span>${t.status==="open"?`<button class="tiny-btn tournament-join" data-id="${t.id}">Join</button>`:""}</div>`).join(""):'<div class="muted">No tournaments yet.</div>';document.querySelectorAll(".tournament-join").forEach(b=>b.addEventListener("click",()=>socket.emit("tournamentJoin",{id:b.dataset.id},res=>{toast(res?.ok?"Tournament joined.":res?.error||"Could not join.");refreshTournaments();})));});}
function refreshSeasonBoard(){socket.emit("seasonInfo",{},r=>{if(!r?.ok)return;v16Modal(`Season ${r.season}`,`<div class="leaderboard-list">${(r.rows||[]).map((x,i)=>`<div><b>#${i+1}</b><span>${x.avatar} ${escapeHtml(x.name)}</span><strong>${x.rating} RP · ${x.wins}/${x.games}</strong></div>`).join("")}</div>`);});}

function readStats(){
  try{return JSON.parse(localStorage.getItem(STATS_KEY)||"null")||{rounds:0,wins:0,losses:0,points:0,history:[]};}catch{return {rounds:0,wins:0,losses:0,points:0,history:[]};}
}
function recordRoundStats(st){
  if(st.spectator||st.viewerIndex==null||st.phase!=="roundEnd")return;
  const key=`${st.code}:${st.round}`;if(key===lastRecordedRoundKey)return;lastRecordedRoundKey=key;
  const me=st.players[st.viewerIndex];if(!me)return;
  const bidderPoints=st.players.filter((_,i)=>st.bidderTeam.includes(i)).reduce((a,p)=>a+(p.roundPoints||0),0);
  const made=bidderPoints>=st.bid.current;const onBidder=st.bidderTeam.includes(st.viewerIndex);const won=onBidder?made:!made;
  const d=readStats();d.rounds++;if(won)d.wins++;else d.losses++;d.points+=Number(me.lastAward||0);
  d.history.unshift({ts:Date.now(),room:st.code,round:st.round,result:won?"Win":"Loss",award:Number(me.lastAward||0),bid:st.bid.current});d.history=d.history.slice(0,20);
  try{localStorage.setItem(STATS_KEY,JSON.stringify(d));}catch{}
}
function showStats(){
  const d=readStats(),rate=d.rounds?Math.round(d.wins*100/d.rounds):0;
  $("statsContent").innerHTML=`<div class="stats-grid"><div><span>Rounds</span><strong>${d.rounds}</strong></div><div><span>Wins</span><strong>${d.wins}</strong></div><div><span>Win rate</span><strong>${rate}%</strong></div><div><span>Points earned</span><strong>${d.points}</strong></div></div><h3>Recent matches</h3><div class="history-list">${d.history.length?d.history.map(x=>`<div><span>${new Date(x.ts).toLocaleDateString()} · ${escapeHtml(x.room)} · R${x.round}</span><b class="${x.result==="Win"?"success":"danger"}">${x.result} · +${x.award}</b></div>`).join(""):"<div class='empty-state'>No completed rounds yet.</div>"}</div>`;
  $("statsModal").classList.remove("hidden");
}
function showLeaderboard(){
  $("leaderboardContent").innerHTML='<div class="empty-state">Loading…</div>';$("leaderboardModal").classList.remove("hidden");
  socket.emit("leaderboard",{},res=>{const rows=res?.rows||[];$("leaderboardContent").innerHTML=rows.length?`<div class="leaderboard-list">${rows.map((r,i)=>`<div><b>#${i+1}</b><span>${r.avatar||"😎"} ${escapeHtml(r.name)}</span><strong>${r.wins} wins · ${r.score} pts</strong></div>`).join("")}</div>`:'<div class="empty-state">No leaderboard results yet.</div>';});
}
function bindPlayerActionButtons(){
  document.querySelectorAll(".mute-chat-btn").forEach(b=>b.addEventListener("click",()=>{const i=Number(b.dataset.index);if(mutedChatPlayers.has(i))mutedChatPlayers.delete(i);else mutedChatPlayers.add(i);renderLobby();renderChat();}));
  document.querySelectorAll(".report-btn").forEach(b=>b.addEventListener("click",()=>{const i=Number(b.dataset.index);const reason=prompt("Reason for report?","Inappropriate behavior");if(!reason)return;socket.emit("reportPlayer",{playerIndex:i,reason},res=>toast(res?.ok?"Report sent. Thank you.":res?.error||"Could not report."));}));
  document.querySelectorAll(".kick-btn").forEach(b=>b.addEventListener("click",()=>{const i=Number(b.dataset.index);if(!confirm(`Remove ${state.players[i]?.name||"this player"}?`))return;socket.emit("kickPlayer",{playerIndex:i},res=>{if(res&&!res.ok)toast(res.error);});}));
}
function refreshPublicRooms(){
  if(!socket.connected)return;socket.emit("listPublicRooms",{},res=>{
    if(!res?.ok)return;const open=res.rooms||[],watch=res.spectate||[];const root=$("publicRooms");if(!root)return;
    const cards=[];
    open.forEach(r=>cards.push(`<div class="public-room-card"><div><strong>${r.locked?"🔒 ":""}${escapeHtml(r.hostName)}'s table</strong><span>${r.joined}/${r.playerCount} players · ${r.deckCount||1} deck${(r.deckCount||1)===2?"s":""} · ${r.botDifficulty} bots · ${escapeHtml(r.code)}</span></div><button type="button" class="join-public-btn primary" data-code="${r.code}" data-locked="${r.locked?1:0}">Join</button></div>`));
    watch.forEach(r=>cards.push(`<div class="public-room-card watch"><div><strong>👁 ${escapeHtml(r.hostName)} · Round ${r.round||1}</strong><span>${r.playerCount} players · ${r.deckCount||1} deck${(r.deckCount||1)===2?"s":""} · ${r.spectatorCount||0} watching · ${escapeHtml(r.code)}</span></div><button type="button" class="spectate-public-btn room-secondary-action" data-code="${r.code}">Watch</button></div>`));
    root.innerHTML=cards.join("")||'<div class="empty-state">No public tables right now. Quick Match can create one.</div>';
    root.querySelectorAll(".join-public-btn").forEach(b=>b.addEventListener("click",()=>joinPublicRoom(b.dataset.code,b.dataset.locked==="1")));
    root.querySelectorAll(".spectate-public-btn").forEach(b=>b.addEventListener("click",()=>spectateRoom(b.dataset.code)));
  });
}
function joinPublicRoom(code,locked=false){const p=currentProfile();saveProfile();const privatePin=locked?(prompt("Enter room PIN")||""):"";if(locked&&!privatePin)return;socket.emit("joinRoom",{name:p.name,avatar:p.avatar,code,privatePin},res=>{if(!res?.ok)return toast(res?.error||"Could not join room.");saveSession(res.code,res.reconnectToken);});}
function spectateRoom(code){const p=currentProfile();saveProfile();socket.emit("spectateRoom",{name:p.name,avatar:p.avatar,code},res=>{if(!res?.ok)toast(res?.error||"Could not spectate.");});}
function startQuickMatch(){const p=currentProfile();saveProfile();socket.emit("quickMatch",{name:p.name,avatar:p.avatar,playerCount:Number($("playerCount")?.value||8),deckCount:Number($("playerCount")?.value||8)===4?Number($("fourPlayerDeckCount")?.value||1):undefined,botDifficulty:$("botDifficulty")?.value||"normal",botPersonality:$("botPersonality")?.value||"balanced",privatePin:$("createPin")?.value||""},res=>{if(!res?.ok)return toast(res?.error||"Could not find a match.");saveSession(res.code,res.reconnectToken);toast("Quick Match table found.");});}
function startPractice(){const p=currentProfile();saveProfile();practicePending=true;socket.emit("createRoom",{name:p.name,avatar:p.avatar,playerCount:4,deckCount:1,isPublic:false,botDifficulty:"easy",turnTimeoutMs:60000,spectatorDelayMs:0,preset:"practice"},res=>{if(!res?.ok){practicePending=false;return toast(res?.error||"Could not create practice game.");}saveSession(res.code,res.reconnectToken);});}

$("quickMatchBtn")?.addEventListener("click",startQuickMatch);
$("practiceBtn")?.addEventListener("click",startPractice);
$("tutorialPracticeBtn")?.addEventListener("click",()=>{localStorage.setItem("knt_onboarded_v1","yes");$("tutorialModal").classList.add("hidden");startPractice();});
$("tutorialBtn")?.addEventListener("click",()=>$("tutorialModal").classList.remove("hidden"));
$("tutorialClose")?.addEventListener("click",()=>{localStorage.setItem("knt_onboarded_v1","yes");$("tutorialModal").classList.add("hidden");});
$("refreshRoomsBtn")?.addEventListener("click",refreshPublicRooms);
$("statsBtn")?.addEventListener("click",showStats);$("statsClose")?.addEventListener("click",()=>$("statsModal").classList.add("hidden"));
$("leaderboardBtn")?.addEventListener("click",showLeaderboard);$("leaderboardClose")?.addEventListener("click",()=>$("leaderboardModal").classList.add("hidden"));
$("spectateCodeBtn")?.addEventListener("click",()=>{const c=$("joinCode")?.value.trim().toUpperCase();if(c.length!==5)return toast("Enter a 5-character room code.");spectateRoom(c);});
["tutorialModal","statsModal","leaderboardModal"].forEach(id=>$(id)?.addEventListener("click",e=>{if(e.target.id===id)$(id).classList.add("hidden");}));

setInterval(refreshPublicRooms,5000);
setInterval(()=>{
  if(!socket.connected)return;const started=performance.now();socket.emit("pingCheck",{},res=>{if(!res?.ok)return;const ms=Math.max(0,Math.round(performance.now()-started));const el=$("pingStatus");if(el){el.textContent=`${ms} ms`;el.className=`ping-status ${ms<100?"good":ms<220?"okay":"bad"}`;}const h=$("serverHealthBadge");if(h){h.className=`server-health ${ms<140?"good":ms<300?"okay":"bad"}`;h.textContent=ms<140?"Server good":ms<300?"Server busy":"High latency";}});
},5000);
window.addEventListener("error",e=>socket.connected&&socket.emit("clientError",{message:e.message,stack:e.error?.stack||"",url:location.href}));
window.addEventListener("unhandledrejection",e=>socket.connected&&socket.emit("clientError",{message:String(e.reason?.message||e.reason||"Unhandled promise rejection"),stack:String(e.reason?.stack||""),url:location.href}));



$("loginBtn")?.addEventListener("click",()=>loginAccount(false));
$("registerBtn")?.addEventListener("click",()=>loginAccount(true));
$("logoutBtn")?.addEventListener("click",()=>socket.emit("accountLogout",{},()=>{cloudUser=null;saveAccountToken("");renderCloudUser();}));
$("cloudSaveBtn")?.addEventListener("click",()=>{if(!cloudUser)return;const p=currentProfile(),sp=stylePayload();socket.emit("accountProfile",{displayName:p.name,avatar:p.avatar,...sp},r=>{if(r?.ok){cloudUser=r.user;renderCloudUser();toast("Cloud profile synced.");}else toast(r?.error||"Sync failed.");});});
$("rankedBtn")?.addEventListener("click",()=>{if(!cloudUser)return toast("Sign in to play ranked.");const pc=Number($("rankedPlayerCount")?.value||4);const dc=pc===4?Number($("rankedDeckCount")?.value||1):undefined;socket.emit("rankedJoin",{playerCount:pc,deckCount:dc},r=>{if(!r?.ok)return toast(r?.error||"Could not queue.");rankedQueued=true;$("rankedCancelBtn")?.classList.remove("hidden");$("rankedStatus").textContent=`Searching · ${r.position}/${r.needed} players · ${r.deckCount||1} deck${(r.deckCount||1)===2?"s":""} · ${r.rating} RP`;});});
$("rankedCancelBtn")?.addEventListener("click",()=>socket.emit("rankedCancel",{},()=>{rankedQueued=false;$("rankedCancelBtn").classList.add("hidden");$("rankedStatus").textContent="Queue cancelled.";}));
$("rankedConfirmBtn")?.addEventListener("click",()=>socket.emit("rankedConfirm",{},r=>{if(!r?.ok)toast(r?.error||"Could not confirm.");}));
$("friendSearchBtn")?.addEventListener("click",()=>{if(!cloudUser)return toast("Sign in first.");const username=$("friendSearchInput")?.value||"";socket.emit("friendSearch",{username},r=>{$("friendResults").innerHTML=(r?.rows||[]).map(x=>`<div class="mini-row"><span>${x.avatar} ${escapeHtml(x.displayName)} <small>@${escapeHtml(x.username)}</small></span><button class="tiny-btn friend-add" data-id="${x.id}">Add</button></div>`).join("")||'<div class="muted">No users found.</div>';document.querySelectorAll(".friend-add").forEach(b=>b.addEventListener("click",()=>socket.emit("friendRequest",{userId:b.dataset.id},res=>toast(res?.ok?"Friend request sent.":res?.error||"Could not send."))));});});
$("refreshReplaysBtn")?.addEventListener("click",refreshReplays);$("seasonBoardBtn")?.addEventListener("click",refreshSeasonBoard);
$("createTournamentBtn")?.addEventListener("click",()=>{if(!cloudUser)return toast("Sign in first.");socket.emit("tournamentCreate",{name:$("tournamentName")?.value||"",size:Number($("tournamentSize")?.value||8)},r=>{toast(r?.ok?"Tournament created.":r?.error||"Could not create.");refreshTournaments();});});
$("saveStyleBtn")?.addEventListener("click",()=>{const sp=stylePayload();try{localStorage.setItem(STYLE_KEY,JSON.stringify(sp));}catch{}applyStylePrefs(sp);if(cloudUser)socket.emit("accountProfile",sp,r=>{if(r?.ok)cloudUser=r.user;});toast("Game style applied.");});
$("v16ModalClose")?.addEventListener("click",()=>$("v16Modal")?.classList.add("hidden"));$("v16Modal")?.addEventListener("click",e=>{if(e.target.id==="v16Modal")e.currentTarget.classList.add("hidden");});
socket.on("rankedQueueStatus",x=>{$("rankedStatus").textContent=`Searching · ${x.position}/${x.needed} players`;});
socket.on("rankedMatched",x=>{rankedQueued=false;$("rankedCancelBtn")?.classList.add("hidden");saveSession(x.code,x.reconnectToken);toast(`Ranked match found · ${x.playerCount} players · ${x.deckCount||1} deck${(x.deckCount||1)===2?"s":""}`);});
socket.on("friendRequestReceived",x=>{toast(`${x.from.displayName} sent a friend request.`);refreshFriends();});
socket.on("roomInvite",x=>{if(confirm(`${x.from} invited you to room ${x.code}. Join?`)){const p=currentProfile();socket.emit("joinRoom",{name:p.name,avatar:p.avatar,code:x.code},r=>{if(r?.ok)saveSession(r.code,r.reconnectToken);else toast(r?.error||"Could not join invite.");});}});
socket.on("afkAssist",()=>toast("Bot Assist enabled after 3 missed turns. Tap Take Back Control when ready."));
socket.on("tournamentMatch",x=>{saveSession(x.code,x.reconnectToken);toast(`Tournament round ${x.round} match is ready.`);});

if(!localStorage.getItem("knt_onboarded_v1"))setTimeout(()=>$("tutorialModal")?.classList.remove("hidden"),350);
$("profileName").value=localStorage.getItem("knt_name")||"";
// Persist profile edits even if the user creates/joins a room without pressing Save first.
$("profileName")?.addEventListener("change",()=>{
  const name=($("profileName").value||"").trim().slice(0,18);
  if(name) localStorage.setItem("knt_name",name);
});
$("profileName")?.addEventListener("blur",()=>{
  const name=($("profileName").value||"").trim().slice(0,18);
  if(name) localStorage.setItem("knt_name",name);
});
document.querySelectorAll(".player-count-btn").forEach(btn=>btn.addEventListener("click",()=>{syncPlayerCountUI(btn.dataset.count);beep();}));
$("playerCount")?.addEventListener("change",e=>syncPlayerCountUI(e.target.value));
$("fourPlayerDeckCount")?.addEventListener("change",()=>syncPlayerCountUI("4"));
$("rankedPlayerCount")?.addEventListener("change",e=>$("rankedDeckCount")?.classList.toggle("hidden",e.target.value!=="4"));
$("bidHistoryTab")?.addEventListener("click",()=>{$("bidHistory")?.classList.remove("hidden");$("trickHistory")?.classList.add("hidden");$("bidHistoryTab")?.classList.add("active");$("trickHistoryTab")?.classList.remove("active");});
$("trickHistoryTab")?.addEventListener("click",()=>{$("trickHistory")?.classList.remove("hidden");$("bidHistory")?.classList.add("hidden");$("trickHistoryTab")?.classList.add("active");$("bidHistoryTab")?.classList.remove("active");});
$("rulePreset")?.addEventListener("change",e=>{const v=e.target.value;if(v==="fast"){$("turnTimer").value="30000";}else if(v==="double"){syncPlayerCountUI("4");$("fourPlayerDeckCount").value="2";syncPlayerCountUI("4");$("turnTimer").value="60000";}else if(v==="practice"){syncPlayerCountUI("4");$("fourPlayerDeckCount").value="1";$("botDifficulty").value="easy";$("publicRoomToggle").checked=false;$("turnTimer").value="60000";$("spectatorDelay").value="0";}else{$("turnTimer").value="60000";}});
if($("rankedDeckCount"))$("rankedDeckCount").classList.toggle("hidden",$("rankedPlayerCount")?.value!=="4");
syncPlayerCountUI($("playerCount")?.value||"8");
$("soundBtn").textContent=soundOn?"🔊":"🔇";
renderAvatarPicker();
applyPerformanceMode();
applyStylePrefs();
renderCloudUser();
refreshTournaments();
applyLanguage();
if(socket.connected)tryResumeSession(false);

// v24 — keep all cards visible when the browser, Android WebView, or orientation changes.
let handResizeRaf=0;
window.addEventListener("resize",()=>{cancelAnimationFrame(handResizeRaf);handResizeRaf=requestAnimationFrame(fitHandToWidth);});
window.addEventListener("orientationchange",()=>setTimeout(fitHandToWidth,120));
