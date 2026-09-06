const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[char]));
}

async function adminFetch(url, options = {}) {
  const key = $("adminKey").value.trim();
  const headers = new Headers(options.headers || {});
  headers.set("x-admin-key", key);
  return fetch(url, { ...options, headers, cache:"no-store" });
}

async function load() {
  const r = await adminFetch("/api/admin/overview");
  if (!r.ok) {
    $("adminData").innerHTML = '<div class="hub-card">Unauthorized</div>';
    return;
  }
  const d = await r.json(), a = d.analytics || {};
  $("adminData").innerHTML = `<div class="hub-card"><h3>Server</h3><p>Region: <b>${esc(d.region)}</b></p><p>Rooms: <b>${d.rooms}</b> · Accounts: <b>${d.users}</b></p><p>Ranked queue: <b>${d.rankedQueued}</b></p></div><div class="hub-card"><h3>Activity</h3><p>Connections ${a.connections||0}</p><p>Rounds ${a.roundsCompleted||0}</p><p>Ranked ${a.rankedMatches||0}</p></div><div class="hub-card"><h3>Moderation</h3><p>Reports ${a.reports||0}</p><div class="mini-list">${(d.reports||[]).slice(-10).reverse().map(x=>`<div class="mini-row"><span>${esc(x.reporter)} → ${esc(x.target)}</span><small>${esc(x.reason)}</small>${x.targetAccountId?`<button class="tiny-btn admin-ban" data-id="${esc(x.targetAccountId)}">Ban 24h</button>`:""}</div>`).join("")}</div></div><div class="hub-card"><h3>Client errors</h3><p>${a.clientErrors||0} captured</p><div class="mini-list">${(d.errors||[]).slice(-10).reverse().map(x=>`<div class="mini-row"><small>${esc(x.message)}</small></div>`).join("")}</div></div><div class="hub-card"><h3>Tournaments</h3><div class="mini-list">${(d.tournaments||[]).map(t=>`<div class="mini-row"><span>${esc(t.name)}</span><b>${t.entrants.length}/${t.size} ${esc(t.status)}</b></div>`).join("")}</div></div>`;
}

async function banUser(id) {
  const reason = prompt("Ban reason", "Moderator action");
  if (!reason) return;
  const r = await adminFetch(`/api/admin/user/${encodeURIComponent(id)}/ban`, {
    method:"POST",
    headers:{ "content-type":"application/json" },
    body:JSON.stringify({ hours:24, reason })
  });
  alert(r.ok ? "Account suspended for 24 hours." : "Ban failed.");
  load();
}

$("loadAdmin").addEventListener("click", load);
document.addEventListener("click", event => {
  const button = event.target.closest?.(".admin-ban");
  if (button) banUser(button.dataset.id);
});
