/* ============ AI AGENT PANEL ("AI აგენტის პანელი") ============ */
// Bridge view between Todoister and an AI agent (v1 = კიკი; the contract is generic —
// see AGENT-API.md). Spec: Kiki/_work/triage-handover/SPEC.md v0.2 + Lasha's decisions
// (2026-08-16). Server side: agent_panel.py. Ported from კიკი's approved mockup
// (panel.js / active.js) — same look, real data + real endpoints.
//
// Two tabs, one card shape, one button:
//   აქტიური        — pinned · overdue · today · tomorrow          (Stage 3, 2026-08-18)
//   დაუხარისხებელი — Inbox captures + the agent's proposal          (Stage 1)
// Tab 1 needs no agent data: plain task fields, grouped აპინული (n/10) · ვადაგადაცილებული (due asc,
// collapsed to 10 + „მეტი…") · დღეს · ხვალ. One card, one tab (Kiki Q2): whatever tab 2 shows is
// left out here. Card: priority circle = შესრულდა · გადადება ▾ (ხვალ · 2-3 დღე · კვირა · თვე ·
// როდესმე · თარიღი… = the app's own date popover with time + repeat) writes the due at once and
// bumps the Todoist label „(+n)" (Lasha: visible on the phone) · მეტი ▾ = ნაწილობრივ · დაშალე ·
// გადაიტანე… (plain project/section edit, the card stays open) · წაშალე (deferred, as on tab 2) ·
// დატოვე. Intervention (the only inline block): the 5th postpone OR an overdue age ≥ 30 days →
// instead of postponing: დავშალოთ · როდესმეში · წაშალე · მაინც გადადე. Age „N დღე" on the card
// (orange ≥ 7, red ≥ 30). Decisions carry recipe.tab = "active" + group + snap (sort key), so a
// decided card stays in ITS group, in place, dimmed, until the round closes; undo on tab 1
// clears the status ("" — never "proposed", that word means a tab-2 card).
// ვეთანხმები and შესრულდა run immediately through the app's own endpoints, with undo. წაშალე is DEFERRED
// (agent_status "deleted_pending": hidden from the app's lists, restorable on the card) and
// becomes a real delete only when the round closes. Agent actions (დაშალე, „?" flag, comment)
// accumulate and go with „გადაამოწმე (N)" → POST /api/agent_queue → panel locked until the
// agent posts agent_done. „გადაამოწმე (N)" (or „დაასრულე" when nothing is to send) closes the
// round: POST /api/agent_round_close → deferred deletes run, decided cards leave the tab.
// Agent offline (B3, Lasha 2026-08-17): the panel stays usable — standard actions (ვეთანხმები ·
// შესრულდა · წაშალე · undo) and the round close („დაასრულე") work without the agent (they use the
// app's own endpoints; the agent reads the log at its next poll); only the agent actions (დაშალე ·
// „?" · comment · „გადაამოწმე (N)") are locked until it is back — drafts + split marks stay.
// The sidebar item is disabled only while no agent has EVER connected (agentInfo.known = false).
//
// Round rules (Kiki's ISSUES-2026-08-17 A1/A2, Lasha): a card never moves after a decision —
// the order is frozen when it first shows (localStorage) and new proposals append at the end;
// a decided card stays in place, dimmed, with its verdict + undo, until the round closes.
// Decisions live server-side (task_local.agent_status + agent_decision = undo recipe), so a
// restart loses nothing; only unsent comment/flag drafts sit in localStorage.

let agentInfo = { connected:false, known:false, busy:false, name:"", last_seen:"", last_analysis:"", open_batches:[], queued:0,
                  pending_deletes:[], round_closed_at:"" };
// offline = an agent has connected before, but not within the last 60 s (and nothing is being processed)
function agentOffline(){ return !!agentInfo.known && !agentInfo.connected && !agentInfo.busy; }
let agentTab = "active";           // remembered per browser (localStorage agent_tab); #triage deep link → tab 2
try { agentTab = localStorage.getItem("agent_tab") === "triage" ? "triage" : "active"; } catch(_){}
let agentActiveIds = new Set();    // ids on tab 1 in the last render (which tab a shared handler acts on)
let agentOverAll = false;          // overdue group expanded past AGENT_OVER_SHOW
const AGENT_OVER_SHOW = 10;
let agentSentN = 0;                // items in the batch we just sent (for the „მუშავდება" line)
let _agentWasBusy = false;
// Per-card session state: id → {decided, kind:'accept'|'complete'|'delete'|'split', changes, action (undo/redo
// object, rebuilt from the server-side recipe after a restart), prop (edited proposal), comment,
// cmOpen, flag}. Verdict text is derived (agentVerdict) so a language switch re-renders it.
const agentUI = {};
const AGENT_DECIDED = ["accepted", "changed", "split", "deleted_pending", "completed", "postponed", "partial", "kept"];   // server statuses shown dimmed this round
const AGENT_POSTPONE_RE = /^\(\+(\d+)\)$/;   // Todoist label "(+3)" = postponed 3 times
/* ---- frozen card order (A1): ids in the order they first appeared; a card keeps its index
   for the whole round, newcomers append, cards that leave the tab are dropped ---- */
const AGENT_ORDER_KEY = "agent_order";
let agentOrder = [];
try { agentOrder = JSON.parse(localStorage.getItem(AGENT_ORDER_KEY) || "[]"); if(!Array.isArray(agentOrder)) agentOrder = []; } catch(_){ agentOrder = []; }
function agentOrdered(pool){
  const idx = new Map(agentOrder.map((id, i) => [id, i]));
  const known = pool.filter(t => idx.has(t.id)).sort((a, b) => idx.get(a.id) - idx.get(b.id));
  const out = known.concat(pool.filter(t => !idx.has(t.id)));
  const ids = out.map(t => t.id);
  if(JSON.stringify(ids) !== JSON.stringify(agentOrder)){
    agentOrder = ids;
    try { if(ids.length) localStorage.setItem(AGENT_ORDER_KEY, JSON.stringify(ids)); else localStorage.removeItem(AGENT_ORDER_KEY); } catch(_){}
  }
  return out;
}
/* ---- unsent drafts (comment text · flag) survive a restart — browser localStorage (Lasha's
   decision 1). Nothing real lives here: the panel only marks tasks that already exist + sync. ---- */
const AGENT_DRAFTS_KEY = "agent_drafts";
function agentDraftsLoad(){
  try {
    const m = JSON.parse(localStorage.getItem(AGENT_DRAFTS_KEY) || "{}");
    Object.keys(m).forEach(id => {
      const d = m[id] || {}, cm = d.comment || "";
      if(cm.trim() || d.flag) agentUI[id] = { tab: d.tab === "active" ? "active" : "triage", comment: cm, flag: !!d.flag, cmOpen: !!cm.trim() };
    });
  } catch(_){}
}
function agentDraftsSave(){
  const m = {};
  Object.keys(agentUI).forEach(id => {
    const ui = agentUI[id], cm = (ui.comment || "").trim();
    if(cm || ui.flag) m[id] = { comment: ui.comment || "", flag: !!ui.flag, tab: ui.tab || "triage" };
  });
  try {
    if(Object.keys(m).length) localStorage.setItem(AGENT_DRAFTS_KEY, JSON.stringify(m));
    else localStorage.removeItem(AGENT_DRAFTS_KEY);
  } catch(_){}
}

/* ---- icons (Lucide-style, inline SVG — no text symbols anywhere on the panel) ---- */
const AG_ICO = {
  caret:   '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  flag:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  cmt:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  undo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  clip:    '<svg class="clip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  // dropdown items
  tomorrow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  days:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01"/></svg>',
  week:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M7 14h10"/></svg>',
  month:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M7 14h10M7 18h6"/></svg>',
  someday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  date:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg>',
  part:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>',
  split:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="M12 9c-4 0-6 2-6 6v6"/><path d="M12 9c4 0 6 2 6 6v6"/></svg>',
  trash:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
  key:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  copy:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  rotate:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  keep:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></svg>',
  edit:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  done:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
  repeat:  '<svg class="rep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  desc:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/></svg>',
  move:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/></svg>',
};

/* ---- shared dropdown: Todoister's .more-popover + .prio-option, every item = icon + text ---- */
function agentMenu(btn, items){
  const open = document.getElementById("more-popover");
  closeAllPopovers();
  if(open && open._btn === btn) return;            // second click on the same button = toggle off
  const m = document.createElement("div");
  m.id = "more-popover"; m.className = "more-popover kp-menu"; m._btn = btn;
  m.innerHTML = items.map((it, i) =>
    `<div class="prio-option ${it.disabled ? "disabled" : ""}" data-i="${i}" ${it.disabled && it.title ? `title="${esc(it.title)}"` : ""}><span class="pflag">${AG_ICO[it.ico] || ""}</span><span class="pname">${esc(it.label)}</span></div>`
  ).join("");
  m.addEventListener("click", e => {
    e.stopPropagation();
    const o = e.target.closest(".prio-option"); if(!o) return;
    if(items[+o.dataset.i].disabled) return;       // locked item (agent offline) — menu stays open
    closeAllPopovers();
    items[+o.dataset.i].fn();
  });
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  let x = r.right - w, y = r.bottom + 4;
  if(x < 8) x = r.left;
  if(y + h > window.innerHeight - 8) y = r.top - h - 4;
  m.style.left = x + "px"; m.style.top = y + "px";
}

/* ---- header / sidebar (called from renderHeader / renderSidebar) ---- */
function agentTitle(){
  const d = new Date();
  const dow = trList("date.dow_full")[d.getDay()] || "";
  const mon = trList("date.month_full")[d.getMonth()] || "";
  return `${dow}, ${d.getDate()} ${mon}`;
}
function agentRenderHeader(){
  const sub = document.getElementById("agent-sub");
  const btn = document.getElementById("agent-reanalyse-btn");
  const on = currentView === "agent";
  if(sub){
    sub.style.display = on ? "" : "none";
    if(on){
      const la = agentInfo.last_analysis ? tr("agent.sub_last", {time: agentInfo.last_analysis.slice(11, 16)}) : tr("agent.sub_never");
      let conn = agentInfo.connected ? tr("agent.connection_on") : tr("agent.connection_off");
      const duty = agentInfo.duty || null;
      if(agentInfo.connected && (agentInfo.sessions || 0) > 1){
        // several sessions of the agent are polling → say which one is on duty (receives queue + trigger)
        conn = tr("agent.duty_sessions", {name: (duty && duty.agent) || agentInfo.name || "", n: agentInfo.sessions});
      }
      const tip = (agentInfo.name || "") + (duty && duty.session ? " · " + duty.session.slice(0, 8) : "");
      // audit line (Package B): the last write that came in with an agent key
      const lw = agentInfo.last_write;
      const lwHtml = lw && lw.agent
        ? ` · <span class="kp-lw" title="${esc(lw.text || lw.id || "")}">${esc(tr("agent.last_write", {name: lw.agent, time: (lw.at || "").slice(11, 16), what: lw.path || ""}))}</span>`
        : "";
      sub.innerHTML = `${esc(la)} · <span class="kp-dot ${agentInfo.connected ? "" : "off"}" title="${esc(tip)}"></span> ${esc(conn)}${lwHtml}`;
    }
  }
  if(btn){
    btn.style.display = on ? "" : "none";
    btn.disabled = !agentInfo.connected || agentInfo.busy;
  }
  const kb = document.getElementById("agent-keys-btn");
  if(kb) kb.style.display = on ? "" : "none";
}

/* ---- access keys dialog (Package B, apikeys.py): who may talk to this Todoister ---- */
let _agentKeysDir = "";
async function agentKeysDialog(){
  let d = {keys: [], dir: ""};
  try { const r = await fetch("/api/keys"); d = await r.json(); } catch(_){}
  _agentKeysDir = d.dir || "";
  _agentKeysRender(d.keys || [], null);
}
function _agentKeysRender(keys, fresh){
  const rows = (keys || []).map(k => `
    <div class="kp-key-row">
      <span class="nm">${esc(k.name)}</span>
      <span class="sc ${esc(k.scope)}">${esc(tr("agent.keys_scope_" + k.scope))}</span>
      <span class="lu" title="${esc(k.last_used_at || "")}">${k.last_used_at ? esc(tr("agent.keys_last_used", {time: k.last_used_at.slice(8, 10) + "." + k.last_used_at.slice(5, 7) + " " + k.last_used_at.slice(11, 16)})) : esc(tr("agent.keys_never_used"))}</span>
      <button class="kp-key-ic" title="${esc(tr("agent.keys_copy"))}" onclick="agentKeyCopy('${esc(k.name)}')">${AG_ICO.copy}</button>
      <button class="kp-key-ic" title="${esc(tr("agent.keys_rotate"))}" onclick="agentKeyRotate('${esc(k.name)}','${esc(k.scope)}')">${AG_ICO.rotate}</button>
      <button class="kp-key-ic danger" title="${esc(tr("agent.keys_revoke"))}" onclick="agentKeyRevoke('${esc(k.name)}')">${AG_ICO.trash}</button>
    </div>`).join("");
  _openDialog(`
    <div class="pd-head">${esc(tr("agent.keys_title"))}</div>
    <div class="pd-body">
      <p class="pd-msg">${esc(tr("agent.keys_body"))}</p>
      <div class="kp-keys">${rows || `<p class="pd-note">${esc(tr("agent.keys_empty"))}</p>`}</div>
      <p class="pd-note">${esc(tr("agent.keys_dir", {dir: _agentKeysDir}))}</p>
      ${fresh ? `<div class="kp-key-fresh"><div class="t">${esc(tr("agent.keys_fresh", {name: fresh.name}))}</div><code>${esc(fresh.key)}</code><div class="pd-note">${esc(fresh.file)}</div></div>` : ""}
      <div class="kp-key-new">
        <input id="kp-key-name" class="pd-input" type="text" maxlength="32" placeholder="${esc(tr("agent.keys_name_ph"))}" onkeydown="if(event.key==='Enter'){event.preventDefault();agentKeyMake();}">
        <select id="kp-key-scope" class="pd-input">
          <option value="full">${esc(tr("agent.keys_scope_full"))}</option>
          <option value="panel">${esc(tr("agent.keys_scope_panel"))}</option>
        </select>
        <button class="pd-btn primary" onclick="agentKeyMake()">${esc(tr("agent.keys_new"))}</button>
      </div>
    </div>
    <div class="pd-foot"><button class="pd-btn cancel" onclick="_resolveConfirm(false)">${esc(tr("common.close"))}</button></div>`);
}
async function agentKeyMake(){
  const inp = document.getElementById("kp-key-name"), sel = document.getElementById("kp-key-scope");
  const name = (inp && inp.value || "").trim(), scope = sel ? sel.value : "full";
  if(!/^[A-Za-z0-9._-]{1,32}$/.test(name)){ showToast(tr("agent.keys_bad_name"), "", 3500); return; }
  const d = await post("/api/keys_make", {name, scope});
  if(d && d.key) _agentKeysRender(d.keys, {name, key: d.key, file: d.file});
}
async function agentKeyRotate(name, scope){
  const ok = await uiConfirm({title: tr("agent.keys_rotate_q", {name}), body: tr("agent.keys_rotate_body"), ok: tr("agent.keys_rotate")});
  if(!ok){ agentKeysDialog(); return; }
  const d = await post("/api/keys_make", {name, scope: scope || "full"});
  if(d && d.key) _agentKeysRender(d.keys, {name, key: d.key, file: d.file}); else agentKeysDialog();
}
async function agentKeyRevoke(name){
  const ok = await uiConfirm({title: tr("agent.keys_revoke_q", {name}), body: tr("agent.keys_revoke_body"), ok: tr("agent.keys_revoke")});
  if(!ok){ agentKeysDialog(); return; }
  const d = await post("/api/keys_revoke", {name});
  _agentKeysRender(d && d.keys || [], null);
}
async function agentKeyCopy(name){
  const d = await post("/api/keys_read", {name});
  const key = d && d.key || "";
  if(!key){ showToast(tr("agent.keys_file_missing"), "", 4000); return; }
  try { await navigator.clipboard.writeText(key); showToast(tr("agent.keys_copied", {name}), "ok", 3000); }
  catch(_){ _agentKeysRender(await (await fetch("/api/keys")).json().then(x => x.keys), {name, key, file: d.file}); }
}
function agentPendingCount(){
  // cards awaiting a decision on both tabs
  return agentPools().all.filter(t => !(agentUI[t.id] && agentUI[t.id].decided)).length;
}
function agentRenderNav(){
  const li = document.getElementById("filter_agent");
  const badge = document.getElementById("count-agent");
  if(!li || !badge) return;
  li.classList.toggle("disabled", !agentInfo.known && !agentInfo.connected && !agentInfo.busy);   // B3: offline ≠ disabled
  li.classList.toggle("locked", !!agentInfo.busy);
  if(agentInfo.busy){
    if(!badge.querySelector(".spin")) badge.innerHTML = '<span class="spin"></span>';
  } else {
    const n = agentPendingCount();
    badge.textContent = n ? String(n) : "";
  }
  // agent answered → toast once (the panes re-render on their own);
  // agent vanished mid-processing → toast once, the batch keeps waiting in the DB
  if(_agentWasBusy && !agentInfo.busy){
    if(agentInfo.connected) showToast(tr("agent.answer_arrived"), "ok", 4000);
    else showToast(tr("agent.connection_lost"), "", 6000);
  }
  _agentWasBusy = !!agentInfo.busy;
}
async function agentReanalyse(){
  const b = document.getElementById("agent-reanalyse-btn"); if(b) b.disabled = true;
  try {
    await post("/api/agent_trigger", {});
    showToast(tr("agent.reanalyse_sent"), "ok", 4000);
  } catch(_){}
  agentRenderHeader();
}

/* ---- data ---- */
// Tab 2 = Inbox captures that carry a proposal awaiting a decision (A4: Inbox only — anything
// else belongs to tab 1) + the cards decided in the current round (server: status in
// AGENT_DECIDED and decided after the last round close), kept in place, dimmed, with verdict +
// undo. Tasks marked for deferred deletion are not in `state` (hidden from the app) — they
// arrive as agentInfo.pending_deletes. Order = frozen (agentOrdered).
// Which tab a persisted decision belongs to (recipe.tab; decisions from before stage 3 = triage).
function agentDecTab(t){ const d = t.agent_decision || {}; return ((d.recipe && d.recipe.tab) || d.tab) === "active" ? "active" : "triage"; }
function agentDecidedThisRound(t){ return AGENT_DECIDED.includes(t.agent_status) && (t.agent_decided_at || "") > (agentInfo.round_closed_at || ""); }
function agentTriageTasks(){
  const seen = new Set(), pool = [];
  const add = t => { if(!seen.has(t.id)){ seen.add(t.id); pool.push(t); } };
  state.forEach(t => {
    if(t.parent_id) return;
    const ui = agentUI[t.id];
    if(t.agent_status === "proposed" && t.agent_proposal && t.project === INBOX_NAME && !t.completed) add(t);
    else if(agentDecidedThisRound(t) && agentDecTab(t) === "triage"){ agentHydrate(t, "triage"); add(t); }
    // დაშალე not yet sent (agent was offline at round close) → stays on the tab until „გადაამოწმე"
    else if(t.agent_status === "split" && agentDecTab(t) === "triage" && !t.completed){ agentHydrate(t, "triage"); add(t); }
    else if(ui && ui.decided && ui.tab === "triage") add(t);          // decision posted, state not back yet
  });
  (agentInfo.pending_deletes || []).forEach(t => { if(agentDecTab(t) === "triage"){ agentHydrate(t, "triage"); add(t); } });
  return agentOrdered(pool);
}
/* ---- tab 1 data: plain task fields, four groups. Decided cards (this round, recipe.tab =
   "active") stay in their recipe.group; everything on tab 2 is excluded (one card, one tab);
   tasks sent to the agent (queued) wait for its answer and show nowhere. ---- */
const AGENT_GROUPS = ["pin", "over", "today", "tom"];
function agentGroupOf(t){
  if(t.sticky) return "pin";
  const d = (t.due_date || "").slice(0, 10); if(!d) return "";
  const today = todayISO(); if(d < today) return "over"; if(d === today) return "today";
  const tm = new Date(); tm.setDate(tm.getDate() + 1); return d === iso(tm) ? "tom" : "";
}
function agentSnap(t){ return { due_date: t.due_date || "", due_time: t.due_time || "", priority: t.priority || "P4", text: t.text || "" }; }
function agentUiGroup(t){ const ui = agentUI[t.id]; const g = ui && ui.action && ui.action.recipe && ui.action.recipe.group; return AGENT_GROUPS.includes(g) ? g : (agentGroupOf(t) || "over"); }
// sort key: due → time → priority → text; a decided card keeps the key it had when decided (snap)
function agentSortKey(t){
  const ui = agentUI[t.id]; const s = (ui && ui.decided && ui.action && ui.action.recipe && ui.action.recipe.snap) || t;
  return (s.due_date ? s.due_date + "T" + (s.due_time || "99:99") : "9999") + "|" + (_PRIO_RANK[s.priority] || 4) + "|" + (s.text || "").toLowerCase();
}
function agentOverdueDays(t){
  const d = (t.due_date || "").slice(0, 10); if(!d || !isOverdue(d)) return 0;
  const [y, m, dd] = d.split("-").map(Number), [y2, m2, d2] = todayISO().split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y, m - 1, dd)) / 86400000);
}
function agentActiveGroups(triageIds){
  const g = { pin: [], over: [], today: [], tom: [] }, ids = new Set();
  const put = (t, grp) => { if(!grp || ids.has(t.id)) return; ids.add(t.id); g[grp].push(t); };
  state.forEach(t => {
    if(t.parent_id || triageIds.has(t.id)) return;
    const ui = agentUI[t.id];
    if(agentDecidedThisRound(t) && agentDecTab(t) === "active"){ agentHydrate(t, "active"); put(t, agentUiGroup(t)); return; }
    if(t.agent_status === "split" && agentDecTab(t) === "active" && !t.completed){ agentHydrate(t, "active"); put(t, agentUiGroup(t)); return; }
    if(ui && ui.decided && ui.tab === "active"){ put(t, agentUiGroup(t)); return; }   // decision posted, state not back yet
    if(t.completed || t.agent_status === "queued") return;
    put(t, agentGroupOf(t));
  });
  (agentInfo.pending_deletes || []).forEach(t => { if(agentDecTab(t) === "active"){ agentHydrate(t, "active"); put(t, agentUiGroup(t)); } });
  AGENT_GROUPS.forEach(k => g[k].sort((a, b) => { const ka = agentSortKey(a), kb = agentSortKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; }));
  const list = AGENT_GROUPS.reduce((acc, k) => acc.concat(g[k]), []);
  return { groups: g, list, ids, pending: list.filter(t => !(agentUI[t.id] && agentUI[t.id].decided)).length };
}
// both tabs at once (tab 2 first — it has priority for a task that would qualify for both)
function agentPools(){
  const triage = agentTriageTasks();
  const act = agentActiveGroups(new Set(triage.map(t => t.id)));
  agentActiveIds = act.ids;
  return { triage, act, all: triage.concat(act.list) };
}
function agentPendingDelete(id){ return (agentInfo.pending_deletes || []).find(t => t.id === id); }
function agentTask(id){ return T(id) || agentPendingDelete(id); }
function agentUiFor(id, tab){
  const ui = agentUI[id] || (agentUI[id] = { tab: agentActiveIds.has(id) ? "active" : "triage" });
  if(tab) ui.tab = tab;
  return ui;
}
// recipe base for a decision made on a card: which tab (+ group and sort snapshot on tab 1)
function agentBase(id){
  const t = agentTask(id);
  if(t && agentActiveIds.has(id)) return { tab: "active", group: agentUiGroup(t), snap: agentSnap(t) };
  return { tab: "triage" };
}
// A card decided in an earlier session (or before a reload): rebuild its session state from the
// server-side decision {kind, changes, recipe} so the verdict shows and undo works.
function agentHydrate(t, tab){
  const ui = agentUiFor(t.id, tab);
  if(ui.decided) return;
  // the user just undid exactly this decision (same decided_at) and the state is not back
  // yet — do not resurrect it from the stale snapshot
  if(ui.undone && ui.undone === (t.agent_decided_at || "")) return;
  const d = t.agent_decision || {};
  const byStatus = { deleted_pending: "delete", split: "split", completed: "complete", postponed: "postpone", partial: "partial", kept: "keep" };
  const kind = d.kind || byStatus[t.agent_status] || "accept";
  const recipe = d.recipe || { changes: d.changes || null };
  if(kind === "delete" && !recipe.text) recipe.text = t.text;
  if(tab && !recipe.tab) recipe.tab = tab;
  agentMark(t.id, agentActionFor(t.id, kind, recipe));
}
function agentMark(id, action){
  const ui = agentUiFor(id);
  ui.decided = true; ui.kind = action.kind; ui.changes = (action.recipe && action.recipe.changes) || null; ui.action = action;
  ui.undone = ""; ui.esc = null;
  if(action.recipe && action.recipe.tab) ui.tab = action.recipe.tab;
}
function agentUnmark(id){
  const ui = agentUI[id]; if(!ui) return;
  const t = agentTask(id);
  ui.undone = (t && t.agent_decided_at) || "";     // guard for agentHydrate until the server confirms
  ui.decided = false; ui.kind = ""; ui.changes = null; ui.action = null;
}
function agentVerdict(ui){
  if(!ui || !ui.decided) return "";
  if(ui.kind === "delete") return tr("agent.verdict_delete_pending");
  if(ui.kind === "complete") return tr("agent.verdict_completed");
  if(ui.kind === "split") return tr("agent.verdict_split");
  if(ui.kind === "partial") return tr("agent.verdict_partial");
  if(ui.kind === "keep") return tr("agent.verdict_keep");
  if(ui.kind === "postpone"){ const r = (ui.action && ui.action.recipe) || {}; return tr("agent.verdict_postponed", {when: agentWhenLabel(r), n: r.n || 0}); }
  if(ui.changes){ const what = Object.entries(ui.changes).map(([k, v]) => `${k}=${v}`).join(", "); return tr("agent.verdict_changed", {what}); }
  return tr("agent.verdict_accepted");
}
// One undo/redo pair per decision, built from a recipe — the same code path live and after a
// restart (the recipe is persisted in task_local.agent_decision by /api/agent_status).
//   accept: {fields:[{field,oldVal,newVal}], subtasks:[text], createdSubs:[id], mergeInto, mergedSub, text, changes, proposal}
//   complete: {text, proposal}     delete: {text}     split: {}
//   postpone (tab 1): {fields:[due_date · due_time · due_string · chosen_labels], when, date, n, changes:{due, due_string}}
//   partial / keep (tab 1): {} — no task change, the status alone is the record
// Every recipe may carry tab ("active" | "triage") + group + snap (tab 1: where the card sits).
function agentActionFor(id, kind, recipe){
  const r = recipe || {};
  const status = kind === "delete" ? "deleted_pending" : kind === "split" ? "split" : kind === "complete" ? "completed"
               : kind === "postpone" ? "postponed" : kind === "partial" ? "partial" : kind === "keep" ? "kept"
               : (r.changes ? "changed" : "accepted");
  const tab = r.tab === "active" ? "active" : "triage";
  const cleared = tab === "active" ? "" : "proposed";   // undo: a tab-1 card never becomes "proposed" (that is a tab-2 word)
  // შესრულდა = the app's own completion (same endpoint as the check circle), nothing else changes
  const setDone = async v => { const tt = T(id); if(tt) tt.completed = v; await post("/api/update", {id, field: "completed", value: v}); };
  const applyFields = async dir => {
    for(const c of (r.fields || [])){
      const v = dir === "undo" ? c.oldVal : c.newVal;
      const tt = T(id); if(tt) tt[c.field] = v;
      await post("/api/update", {id, field: c.field, value: v});
    }
  };
  const addSubs = async () => {
    r.createdSubs = [];
    const before = new Set(((T(id) || {}).subtasks || []).map(x => x.id));
    for(const txt of (r.subtasks || [])) await post("/api/subtask_add", {id, text: txt});
    r.createdSubs = ((T(id) || {}).subtasks || []).map(x => x.id).filter(x => !before.has(x));
  };
  const doMerge = async () => {
    r.mergedSub = "";
    if(!r.mergeInto || !T(r.mergeInto)) return;
    const before = new Set(((T(r.mergeInto) || {}).subtasks || []).map(x => x.id));
    await post("/api/subtask_add", {id: r.mergeInto, text: r.text || ""});
    r.mergedSub = (((T(r.mergeInto) || {}).subtasks || []).map(x => x.id).find(x => !before.has(x))) || "";
    await post("/api/task_delete", {id});
  };
  const action = {
    kind, status, recipe: r,
    label: kind === "delete" ? (r.text || tr("undo.label_delete")) : kind === "split" ? tr("agent.more_split") : kind === "complete" ? tr("undo.label_completed")
         : kind === "postpone" ? tr("agent.postpone") : kind === "partial" ? tr("agent.more_partial") : kind === "keep" ? tr("agent.more_keep") : tr("undo.label_agent_accept"),
    undo: async () => {
      agentUnmark(id); render();
      if(kind === "complete") await setDone(false);
      if(kind === "postpone") await applyFields("undo");
      if(kind === "accept"){
        if(r.mergeInto){ if(r.mergedSub) await post("/api/task_delete", {id: r.mergedSub}); await post("/api/task_restore", {id, subs: []}); }
        for(const sid of (r.createdSubs || [])) await post("/api/task_delete", {id: sid});
        await applyFields("undo");
      }
      await post("/api/agent_status", {id, status: cleared, tab});
    },
    redo: async () => {
      agentMark(id, action); render();
      if(kind === "complete") await setDone(true);
      if(kind === "postpone") await applyFields("redo");
      if(kind === "accept"){ await applyFields("redo"); await addSubs(); await doMerge(); }
      await agentPostStatus(id, action);
    },
  };
  return action;
}
// The decision record the server keeps (agent_status + agent_decision = undo recipe) — sent on
// redo and again when a postpone grows (time / repeat added from the date popover).
async function agentPostStatus(id, action){
  const r = action.recipe || {};
  await post("/api/agent_status", {id, status: action.status, tab: r.tab === "active" ? "active" : "triage", changes: r.changes || null,
                                    proposal: r.proposal || null, verdict: agentVerdict(agentUI[id]),
                                    decision: {kind: action.kind, changes: r.changes || null, recipe: r}});
}
// The proposal in effect for a card: the user's edited copy if any, else the agent's original.
function agentProposal(t){
  const ui = agentUI[t.id];
  return (ui && ui.prop) || t.agent_proposal || {};
}
function agentEditProp(t){
  const ui = agentUiFor(t.id);
  if(!ui.prop) ui.prop = JSON.parse(JSON.stringify(t.agent_proposal || {}));
  return ui.prop;
}
// Proposal target = project + section. The agent may send project + section, or a single
// "section" of the form "Project / Section", or just a section (assumed in the task's project).
function agentTarget(t, p){
  let project = (p.project || "").trim(), section = (p.section || "").trim();
  if(!project && section.includes(" / ")){ const i = section.indexOf(" / "); project = section.slice(0, i).trim(); section = section.slice(i + 3).trim(); }
  if(!project && section && projects.includes(section) && !((projectSections[t.project] || []).includes(section))){ project = section; section = ""; }
  if(!project) project = t.project;
  return { project, section };
}
// Proposal due → ISO date ("" = no date). Lenient: ISO, today/tomorrow (ka/en), +Nd.
function agentDueISO(v){
  v = (v || "").trim();
  if(!v) return "";
  if(/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const low = v.toLowerCase();
  const d = new Date();
  if(low === "today" || low === "დღეს") return iso(d);
  if(low === "tomorrow" || low === "ხვალ"){ d.setDate(d.getDate() + 1); return iso(d); }
  const m = low.match(/^\+(\d+)d$/); if(m){ d.setDate(d.getDate() + Number(m[1])); return iso(d); }
  return "";                                       // unknown wording → no date proposal
}
// Proposal recurrence (C2): Todoist grammar ("every wednesday at 20:00"); anything else = none.
function agentRepeat(p){ const v = (p.due_string || "").trim(); return isRecurrenceStr(v) ? v : ""; }
function agentChanges(t){
  // diff between the edited proposal and the agent's original (what the agent learns from)
  const ui = agentUI[t.id]; if(!ui || !ui.prop || !t.agent_proposal) return null;
  const a = t.agent_proposal, b = ui.prop, out = {};
  const ta = agentTarget(t, a), tb = agentTarget(t, b);
  if(ta.project !== tb.project) out.project = tb.project;
  if(ta.section !== tb.section) out.section = tb.section || "—";
  if((a.priority || "") !== (b.priority || "")) out.priority = b.priority || "";
  if(agentDueISO(a.due) !== agentDueISO(b.due) || (a.time || "") !== (b.time || "")) out.due = (agentDueISO(b.due) || "—") + (b.time ? " " + b.time : "");
  if(agentRepeat(a) !== agentRepeat(b)) out.due_string = agentRepeat(b) || "—";
  if(JSON.stringify(a.labels || []) !== JSON.stringify(b.labels || [])) out.labels = (b.labels || []).map(l => "@" + l).join(" ") || "—";
  return Object.keys(out).length ? out : null;
}

/* ---- view ---- */
function renderAgentPanel(row){
  if(!agentInfo.known && !agentInfo.connected && !agentInfo.busy){
    // no agent has ever connected: nothing to show yet (deep link / hash only — the sidebar item is disabled)
    row.innerHTML = `<div class="list-wrap kp-wrap"><div class="kp-off"><b>${esc(tr("agent.disabled_title"))}</b>${esc(tr("agent.disabled_body"))}</div></div>`;
    return;
  }
  const off = agentOffline();
  // B3: agent away → the panel keeps working for standard actions + round close; agent actions wait.
  // A batch already sent simply waits in the DB (decision 1) — say so on the strip.
  const strip = off ? `<div class="kp-offline" id="kp-offline"><span class="kp-dot off"></span><b>${esc(tr("agent.offline_title"))}</b><span>${esc(tr("agent.offline_body"))}</span>${agentInfo.queued ? `<span class="wait">${esc(tr("agent.queue_waiting", {n: agentInfo.queued}))}</span>` : ""}</div>` : "";
  const pools = agentPools(), triage = pools.triage, act = pools.act;
  // drafts left over from tasks that left both tabs (decided elsewhere, no longer due) → drop
  Object.keys(agentUI).forEach(id => {
    const ui = agentUI[id];
    if(!ui.decided && !triage.some(t => t.id === id) && !act.ids.has(id)){ delete agentUI[id]; }
  });
  agentDraftsSave();
  const nTri = triage.filter(t => !(agentUI[t.id] && agentUI[t.id].decided)).length;
  const nAct = act.pending;
  const f = agentFooterInfo(pools);
  let body;
  if(agentInfo.busy){
    body = `<div class="kp-proc" id="kp-proc"><b><span class="spin"></span>${esc(tr("agent.processing"))}</b>${esc(tr("agent.processing_sub", {n: agentSentN || agentInfo.queued || 0}))}</div>`;
  } else {
    const pane = agentTab === "triage"
      ? `<section class="kp-pane" id="pane-triage">
           <div class="kp-legend">${esc(tr("agent.legend_triage"))}</div>
           <div id="kp-cards">${triage.length ? triage.map(agentTriageCard).join("") : `<div class="kp-empty">${esc(tr("agent.empty_triage"))}</div>`}</div>
         </section>`
      : `<section class="kp-pane" id="pane-active">
           <div class="kp-legend">${esc(tr("agent.legend_active"))}</div>
           <div id="kt-list">${agentActiveList(act)}</div>
         </section>`;
    body = pane + `<div class="kp-submit" id="kp-footer">
        <span id="kp-summary">${esc(f.summary)}</span>
        <button class="kp-send" id="kp-send" onclick="agentSend()" ${f.disabled ? "disabled" : ""}>${esc(f.label)}</button>
      </div>`;
  }
  row.innerHTML = `<div class="list-wrap kp-wrap ${off ? "offline" : ""}">${strip}
    <div class="kp-tabs ${agentInfo.busy ? "locked" : ""}" role="tablist">
      <button class="kp-tab ${agentTab === "active" ? "active" : ""}" id="tab-active" onclick="agentSetTab('active')">${esc(tr("agent.tab_active"))} <span class="kp-tab-n ${nAct ? "sage" : ""}">${nAct}</span></button>
      <button class="kp-tab ${agentTab === "triage" ? "active" : ""}" id="tab-triage" onclick="agentSetTab('triage')">${esc(tr("agent.tab_triage"))} <span class="kp-tab-n ${nTri ? "sage" : ""}">${nTri}</span></button>
    </div>${body}</div>`;
  row.querySelectorAll("textarea.cm.show").forEach(t => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; });
}
function agentSetTab(t){ agentTab = t === "triage" ? "triage" : "active"; try { localStorage.setItem("agent_tab", agentTab); } catch(_){} render(); }

function agentTriageCard(t){
  const ui = agentUI[t.id] || {};
  const p = agentProposal(t);
  const orig = t.agent_proposal || {};
  const conf = ["high","mid","low"].includes(p.confidence) ? p.confidence : "mid";
  const type = ["simple","complex","info","note"].includes(p.type) ? p.type : "simple";
  const tgt = agentTarget(t, p), tgt0 = agentTarget(t, orig);
  const prio = ["P1","P2","P3","P4"].includes(p.priority) ? p.priority : t.priority;
  const due = agentDueISO(p.due), due0 = agentDueISO(orig.due);
  const rep = agentRepeat(p), rep0 = agentRepeat(orig);
  const dueTxt = (due ? fmtDate(due) + (p.time ? " " + p.time : "") : (rep ? "" : tr("agent.no_date"))) + (rep ? (due ? " · " : "") + repeatLabel(rep) : "");
  const labels = Array.isArray(p.labels) ? p.labels : [];
  const chg = { section: tgt.project !== tgt0.project || tgt.section !== tgt0.section, prio: prio !== (orig.priority || t.priority),
                due: due !== due0 || (p.time || "") !== (orig.time || "") || rep !== rep0, labels: JSON.stringify(labels) !== JSON.stringify(orig.labels || []) };
  const descAdd = (p.description_append || "").trim();
  const secTxt = (tgt.project === t.project ? "" : tgt.project + " / ") + (tgt.section || (tgt.project === t.project ? tr("agent.no_section") : ""));
  const merge = p.merge_into && T(p.merge_into) ? `<span title="${esc(T(p.merge_into).text)}">${esc(tr("agent.merge_into", {title: T(p.merge_into).text}))}</span>` : "";
  const subs = Array.isArray(p.subtasks) && p.subtasks.length ? `<ul class="subs">${p.subtasks.map(s => `<li>${esc(String(s))}</li>`).join("")}</ul>` : "";
  const q = conf === "low" && Array.isArray(p.questions) && p.questions.length ? `<div class="q">${esc(p.questions.join(" · "))}</div>` : "";
  const hasFile = (t.comments || []).some(c => c.attachment);
  const cm = ui.comment || "", cmOpen = ui.cmOpen || !!cm.trim();
  const done = !!ui.decided;
  const off = agentOffline();               // B3: comment / „?" locked while the agent is away
  const mainDone = p.complete === true;     // agent proposes completion → შესრულდა is the main button
  // same shape as tab 1: check circle + postpone button + the same More list + the escalation block
  const pcls = ["P1","P2","P3"].includes(t.priority) ? t.priority.toLowerCase() : "";
  const dn = done && ui.kind === "complete" ? " on" : "";
  const e = ui.esc;
  const escTxt = e ? (e.n >= 5 ? tr("agent.esc_count", {n: e.n}) : tr("agent.esc_age", {n: e.age})) : "";
  return `<div class="kt ${done ? "done" : ""} ${ui.flag ? "flagged" : ""} ${e ? "esc-on" : ""}" id="kt-${t.id}">
    <span class="conf ${conf}" title="${esc(tr("agent.conf_" + conf))}"></span>
    <button class="chk ${pcls}${dn}" title="${esc(tr("agent.complete"))}" onclick="agentComplete('${t.id}')">${AG_ICO.check}</button>
    <div class="body">
      <div class="ttl">${esc(t.text)}${hasFile ? AG_ICO.clip : ""}<span class="kp-type ${type}">${esc(tr("agent.type_" + type))}</span></div>
      ${p.read ? `<div class="read"><b>${esc(p.read)}</b></div>` : ""}
      <div class="prop" id="ag-prop-${t.id}">
        <span class="pv ${chg.section ? "changed" : ""}" onclick="agentPickSection(event,'${t.id}')">${esc(secTxt)}</span>
        <span class="pv ${prio.toLowerCase()} ${chg.prio ? "changed" : ""}" onclick="agentPickPrio(event,'${t.id}')">${prio}</span>
        <span class="pv ${chg.due ? "changed" : ""}" id="ag-due-${t.id}" onclick="agentPickDate(event,'${t.id}')">${rep ? AG_ICO.repeat : ""}${esc(dueTxt)}</span>
        <span class="pv ${chg.labels ? "changed" : ""}" onclick="agentPickLabels(event,'${t.id}')">${labels.length ? esc(labels.map(l => "@" + l).join(" ")) : "@…"}</span>
        ${merge}
      </div>
      ${descAdd ? `<div class="desc" title="${esc(tr("agent.desc_append"))}">${AG_ICO.desc}<span>${esc(descAdd)}</span></div>` : ""}
      ${subs}${q}
      <textarea class="cm ${cmOpen ? "show" : ""}" id="cm-${t.id}" rows="1" placeholder="${esc(tr("agent.comment_ph"))}" oninput="agentCm('${t.id}',this)" ${off ? "readonly" : ""}>${esc(cm)}</textarea>
      ${e ? `<div class="esc show">${esc(escTxt)}
        <div class="sub">
          <button onclick="agentEscSplit('${t.id}')" ${off ? `disabled title="${esc(tr("agent.offline_locked"))}"` : ""}>${esc(tr("agent.esc_split"))}</button>
          <button onclick="agentEscSomeday('${t.id}')">${esc(tr("agent.esc_someday"))}</button>
          <button class="warn" onclick="agentEscDelete('${t.id}')">${esc(tr("agent.esc_delete"))}</button>
          <button onclick="agentEscAnyway('${t.id}')">${esc(tr("agent.esc_anyway"))}</button>
          <button class="x" onclick="agentEscClose('${t.id}')" title="${esc(tr("agent.undo"))}">${AG_ICO.undo}</button>
        </div></div>` : ""}
    </div>
    <div class="acts">
      ${mainDone ? `<button class="act ok" onclick="agentComplete('${t.id}')">${esc(tr("agent.complete"))}</button>`
                 : `<button class="act ok" onclick="agentAccept('${t.id}')">${esc(tr("agent.accept"))}</button>`}
      <button class="act" id="ag-pp-${t.id}" onclick="event.stopPropagation(); agentMenuWhen(this,'${t.id}')">${esc(tr("agent.postpone"))}${AG_ICO.caret}</button>
      <button class="act" onclick="event.stopPropagation(); agentMenuMore(this,'${t.id}')">${esc(tr("agent.more"))}${AG_ICO.caret}</button>
    </div>
    <div class="dec"><span>${esc(agentVerdict(ui))}</span><button class="undo" title="${esc(tr("agent.undo"))}" onclick="agentUndo('${t.id}')">${AG_ICO.undo}</button></div>
    <button class="ic cmt ${cmOpen ? "on" : ""}" id="ic-${t.id}" title="${esc(off ? tr("agent.offline_locked") : tr("agent.comment"))}" onclick="agentCmToggle('${t.id}')" ${off ? "disabled" : ""}>${AG_ICO.cmt}</button>
    <button class="ic flag ${ui.flag ? "on" : ""}" id="fl-${t.id}" title="${esc(off ? tr("agent.offline_locked") : tr("agent.flag"))}" onclick="agentFlag('${t.id}')" ${off ? "disabled" : ""}>${AG_ICO.flag}</button>
  </div>`;
}

/* ---- comment + „?" flag (independent of any decision; survive undo) ---- */
function agentCmToggle(id){
  if(agentOffline()){ showToast(tr("agent.offline_locked"), "warn", 3000); return; }
  const ui = agentUiFor(id); ui.cmOpen = !ui.cmOpen;
  const t = document.getElementById("cm-" + id); if(!t) return;
  const show = ui.cmOpen || !!(ui.comment || "").trim();
  t.classList.toggle("show", show);
  document.getElementById("ic-" + id).classList.toggle("on", show);
  if(show){ t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; t.focus(); }
  agentRefreshFooter();
}
function agentCm(id, t){
  t.style.height = "auto"; t.style.height = t.scrollHeight + "px";
  const ui = agentUiFor(id); ui.comment = t.value; ui.cmOpen = true;
  agentDraftsSave();
  agentRefreshFooter();
}
function agentFlag(id){
  if(agentOffline()){ showToast(tr("agent.offline_locked"), "warn", 3000); return; }
  const ui = agentUiFor(id); ui.flag = !ui.flag;
  const c = document.getElementById("kt-" + id); if(c) c.classList.toggle("flagged", ui.flag);
  const f = document.getElementById("fl-" + id); if(f) f.classList.toggle("on", ui.flag);
  agentDraftsSave();
  agentRefreshFooter();
  agentRenderNav();
}
// The one button: „გადაამოწმე (N)" when something goes to the agent; „დაასრულე" when only
// decisions (accept / deferred delete) wait for the round to close; disabled when neither.
function agentFooterInfo(pools){
  const items = agentItemsToSend(); const n = items.active.length + items.triage.length;
  const pool = (pools || agentPools()).all;
  const decided = pool.filter(t => agentUI[t.id] && agentUI[t.id].decided).length;
  // B3 offline: nothing goes to the agent now — the button only closes the round („დაასრულე"),
  // and only when a decision that the close acts on exists (split marks wait for the agent)
  const off = agentOffline();
  const closable = pool.filter(t => agentUI[t.id] && agentUI[t.id].decided && agentUI[t.id].kind !== "split").length;
  const dels = (agentInfo.pending_deletes || []).length;
  let summary = tr("agent.summary", {n}) + (n ? tr("agent.summary_split", {a: items.active.length, t: items.triage.length}) : "");
  if(off && n) summary += tr("agent.summary_offline");
  if(dels) summary += tr("agent.summary_deletes", {n: dels});
  return { items, n, decided, dels, summary, off,
           label: off ? tr("agent.finish") : n ? tr("agent.recheck", {n}) : decided ? tr("agent.finish") : tr("agent.recheck", {n: 0}),
           disabled: off ? !closable : (!n && !decided) };
}
function agentRefreshFooter(){
  const f = agentFooterInfo();
  const s = document.getElementById("kp-summary"), b = document.getElementById("kp-send");
  if(s) s.textContent = f.summary;
  if(b){ b.textContent = f.label; b.disabled = f.disabled; }
}

/* ---- proposal chips → Todoister's own pickers (callbacks edit the proposal, not the task) ---- */
function agentPickSection(ev, id){
  ev.stopPropagation(); closeAllPopovers();
  const t = T(id); if(!t || (agentUI[id] && agentUI[id].decided)) return;
  const cur = agentTarget(t, agentProposal(t));
  const m = document.createElement("div");
  m.id = "project-popover"; m.className = "labels-popover";
  let rows = "";
  projects.forEach(p => {
    const on = cur.project === p && !cur.section;
    rows += `<div class="prio-option" onclick="event.stopPropagation(); agentSetTarget('${id}','${esc(p)}','')">
      <span class="pflag" style="color:${projColor(p)}">${SVG.hash}</span><span class="pname">${esc(p)}</span>${on ? `<span class="pcheck">✓</span>` : ""}</div>`;
    (projectSections[p] || []).forEach(s => {
      const onS = cur.project === p && cur.section === s;
      rows += `<div class="prio-option" style="padding-left:28px" onclick="event.stopPropagation(); agentSetTarget('${id}','${esc(p)}','${esc(s)}')">
        <span class="pname">${esc(s)}</span>${onS ? `<span class="pcheck">✓</span>` : ""}</div>`;
    });
  });
  m.innerHTML = rows;
  document.body.appendChild(m);
  positionPopover(m, ev.currentTarget.getBoundingClientRect());
}
function agentSetTarget(id, project, section){
  const t = T(id); if(!t) return;
  const p = agentEditProp(t); p.project = project; p.section = section;
  closeAllPopovers(); render();
}
function agentPickPrio(ev, id){
  ev.stopPropagation(); closeAllPopovers();
  const t = T(id); if(!t || (agentUI[id] && agentUI[id].decided)) return;
  const cur = agentProposal(t).priority || t.priority;
  const m = document.createElement("div");
  m.id = "prio-popover"; m.className = "prio-popover";
  m.innerHTML = ["P1","P2","P3","P4"].map(p => `
    <div class="prio-option" onclick="event.stopPropagation(); agentSetPrio('${id}','${p}')">
      <span class="pflag" style="color:var(--${p.toLowerCase()})">${p === "P4" ? SVG.flag : SVG.flagFill}</span>
      <span class="pname">${esc(tr("prio." + p.toLowerCase()))}</span>${cur === p ? `<span class="pcheck">✓</span>` : ""}
    </div>`).join("");
  document.body.appendChild(m);
  positionPopover(m, ev.currentTarget.getBoundingClientRect());
}
function agentSetPrio(id, p){
  const t = T(id); if(!t) return;
  agentEditProp(t).priority = p; closeAllPopovers(); render();
}
function agentPickDate(ev, id){
  ev.stopPropagation();
  const t = T(id); if(!t || (agentUI[id] && agentUI[id].decided)) return;
  const p = agentProposal(t);
  datePickCurrent = agentDueISO(p.due);
  repeatAnchorISO = datePickCurrent;
  calYear = calMonth = undefined;
  openDatePicker("ag-due-" + id,
    date => { const e = agentEditProp(t); e.due = date || ""; if(!date){ e.time = ""; e.due_string = ""; } closeAllPopovers(); render(); },
    time => { const e = agentEditProp(t); e.time = time || ""; render(); },
    p.time || "",
    rs => { const e = agentEditProp(t); e.due_string = rs || ""; if(rs && !agentDueISO(e.due)) e.due = todayISO(); render(); },
    agentRepeat(p));
}
function agentPickLabels(ev, id){
  ev.stopPropagation(); closeAllPopovers();
  const t = T(id); if(!t || (agentUI[id] && agentUI[id].decided)) return;
  if(!ALL_LABELS.length){ showToast(tr("fl.no_labels"), "warn"); return; }
  const m = document.createElement("div");
  m.id = "labels-popover"; m.className = "labels-popover";
  m.innerHTML = `<input class="labels-search" id="ag-labels-search" placeholder="${esc(tr("labels.search_ph"))}" oninput="agentFilterLabels('${id}', this.value)" onclick="event.stopPropagation()"><div id="ag-labels-items">${agentLabelRows(id, "")}</div>`;
  document.body.appendChild(m);
  positionPopover(m, ev.currentTarget.getBoundingClientRect());
  setTimeout(() => { const i = document.getElementById("ag-labels-search"); if(i) i.focus(); }, 0);
}
function agentLabelRows(id, q){
  const t = T(id); if(!t) return "";
  const sel = agentProposal(t).labels || [];
  const ql = (q || "").toLowerCase();
  return ALL_LABELS.filter(l => !ql || l.toLowerCase().includes(ql)).map(l => `
    <div class="prio-option" onclick="event.stopPropagation(); agentToggleLabel('${id}','${esc(l)}')">
      <span class="pflag" style="color:${lblColor(l)}">${SVG.labelTag}</span><span class="pname">${esc(l)}</span>${sel.includes(l) ? `<span class="pcheck">✓</span>` : ""}
    </div>`).join("");
}
function agentFilterLabels(id, q){ const h = document.getElementById("ag-labels-items"); if(h) h.innerHTML = agentLabelRows(id, q); }
function agentToggleLabel(id, l){
  const t = T(id); if(!t) return;
  const p = agentEditProp(t); const arr = [...(p.labels || [])];
  const i = arr.indexOf(l); if(i >= 0) arr.splice(i, 1); else arr.push(l);
  p.labels = arr;
  const h = document.getElementById("ag-labels-items"); const q = document.getElementById("ag-labels-search");
  if(h) h.innerHTML = agentLabelRows(id, q ? q.value : "");
  // refresh the chip without closing the popover
  const card = document.getElementById("kt-" + id);
  if(card){ const pv = card.querySelectorAll(".prop .pv")[3]; if(pv){ pv.textContent = arr.length ? arr.map(x => "@" + x).join(" ") : "@…"; pv.classList.add("changed"); } }
  agentRefreshFooter();
}

/* ---- decisions ---- */
function agentMenuMore(btn, id){
  const t = agentTask(id);
  const mainDone = !!t && agentProposal(t).complete === true;
  // whichever of ვეთანხმები / შესრულდა is not the main button lives here
  agentMenu(btn, [
    mainDone ? { label: tr("agent.accept"), ico: "check", fn: () => agentAccept(id) } : null,
    { label: tr("agent.more_edit"),    ico: "edit",  fn: () => agentHintEdit(id) },
    { label: tr("agent.more_partial"), ico: "part",  fn: () => agentPartial(id) },
    { label: tr("agent.more_split"),   ico: "split", fn: () => agentSplit(id), disabled: agentOffline(), title: tr("agent.offline_locked") },
    { label: tr("agent.more_delete"),  ico: "trash", fn: () => agentDelete(id) },
    { label: tr("agent.more_keep"),    ico: "keep",  fn: () => agentKeep(id) },
  ].filter(Boolean));
}
function agentHintEdit(id){
  const p = document.getElementById("ag-prop-" + id);
  if(p){ p.classList.remove("pulse"); void p.offsetWidth; p.classList.add("pulse"); }
  showToast(tr("agent.edit_hint"), "ok", 4000);
}
// A card-level undo unwinds exactly that card's action (and drops it from the global undo stack).
// The action's own undo clears the mark + the server status (comment / flag / edits survive).
async function agentUndo(id){
  const ui = agentUI[id]; if(!ui || !ui.decided) return;
  if(ui.action){
    const i = undoStack.indexOf(ui.action); if(i >= 0){ undoStack.splice(i, 1); updateUndoButtons(); }
    await ui.action.undo();
  } else {
    const tab = ui.tab === "active" ? "active" : "triage";
    agentUnmark(id); render();
    await post("/api/agent_status", {id, status: tab === "active" ? "" : "proposed", tab});
  }
}
// დაშალე — a mark for the agent (goes with „გადაამოწმე"); persisted server-side like the rest.
async function agentSplit(id){
  if(agentOffline()){ showToast(tr("agent.offline_locked"), "warn", 3000); return; }
  const t = agentTask(id); if(!t) return;
  await agentActionFor(id, "split", agentBase(id)).redo();
}
// წაშალე — DEFERRED (A2): the task is only marked (agent_status deleted_pending) and hidden
// from the app; the card stays in place with „უკან" until the round closes, when the real
// task_delete runs (agentRoundClose). Undo before that = clear the mark, nothing else changed.
async function agentDelete(id){
  const t = agentTask(id); if(!t) return;
  const action = agentActionFor(id, "delete", Object.assign(agentBase(id), { text: t.text }));
  await action.redo();
  recordAction(action);
}
// შესრულდა (A3) — the capture is already done: complete the task now (the app's own completion,
// synced as item_complete), record agent_status "completed" so the agent learns; the card stays
// in place, dimmed, undoable (completed=false) until the round closes. Nothing else is written.
async function agentComplete(id){
  const t = T(id); if(!t || t.completed) return;
  const base = agentBase(id);
  const action = agentActionFor(id, "complete", Object.assign(base, { text: t.text, proposal: base.tab === "active" ? null : agentProposal(t) }));
  await action.redo();
  recordAction(action);
}

/* ---- tab 1 decisions ---- */
// ნაწილობრივ / დატოვე — nothing changes on the task; the status is the record (the agent reads it
// in the log). The card dims with its verdict until the round closes.
async function agentPartial(id){
  const t = T(id); if(!t) return;
  const action = agentActionFor(id, "partial", Object.assign(agentBase(id), { text: t.text }));
  await action.redo(); recordAction(action);
}
async function agentKeep(id){
  const t = T(id); if(!t) return;
  const action = agentActionFor(id, "keep", Object.assign(agentBase(id), { text: t.text }));
  await action.redo(); recordAction(action);
}
// გადადება ▾ — writes the due at once (the app's own /api/update) and bumps the Todoist label
// "(+n)" (Lasha: the counter must be visible on the phone). when = tomorrow | days (+3) | week |
// month | someday (date cleared → time + recurrence go too, like the app) | date (ISO from the popover).
// Intervention: the 5th postpone OR an overdue age ≥ 30 days (Kiki Q2) — when a DATE is chosen
// (someday is one of the block's own answers) the block shows first; „მაინც გადადე" = force.
// `extra` = {field, value} from the popover's time / repeat sub-picker when it comes before the date.
function agentWhenDate(when){
  const d = new Date();
  if(when === "tomorrow") d.setDate(d.getDate() + 1);
  else if(when === "days") d.setDate(d.getDate() + 3);
  else if(when === "week") d.setDate(d.getDate() + 7);
  else if(when === "month") d.setMonth(d.getMonth() + 1);
  else return "";
  return iso(d);
}
function agentWhenLabel(r){
  if(r.when === "date") return r.date ? fmtDate(r.date) + (r.fields || []).filter(f => f.field === "due_time" && f.newVal).map(f => " " + f.newVal).join("") : tr("agent.when_someday");
  return tr("agent.when_" + (r.when || "someday"));
}
async function agentPostpone(id, when, date, force, extra){
  const t = T(id); if(!t) return;
  const ui = agentUI[id];
  if(ui && ui.decided) return;
  const n = (t.postpone_count || 0) + 1, age = agentOverdueDays(t);
  const newDate = when === "date" ? (date || "") : agentWhenDate(when);
  if(!force && newDate && (n >= 5 || age >= 30)){       // intervention first — the answer buttons decide
    const u = agentUiFor(id, agentBase(id).tab); u.esc = { when, date: newDate, extra: extra || null, n, age };
    render(); return;
  }
  const fields = [];
  const push = (field, oldVal, newVal) => { if(JSON.stringify(oldVal) !== JSON.stringify(newVal)) fields.push({field, oldVal, newVal}); };
  push("due_date", t.due_date || "", newDate);
  if(!newDate){ push("due_time", t.due_time || "", ""); push("due_string", isRecurrenceStr(t.due_string) ? t.due_string : "", ""); }
  const changes = { due: newDate || "—" };
  if(extra && extra.field === "due_time"){ push("due_time", t.due_time || "", extra.value || ""); changes.due = (newDate || "—") + (extra.value ? " " + extra.value : ""); }
  if(extra && extra.field === "due_string"){ push("due_string", isRecurrenceStr(t.due_string) ? t.due_string : "", extra.value || ""); changes.due_string = extra.value || "—"; }
  const labels = (t.chosen_labels || []).filter(l => !AGENT_POSTPONE_RE.test(l)).concat(["(+" + n + ")"]);
  push("chosen_labels", t.chosen_labels || [], labels);
  const action = agentActionFor(id, "postpone", Object.assign(agentBase(id), { fields, when, date: newDate, n, changes, text: t.text }));
  await action.redo();
  recordAction(action);
}
// The date popover on „თარიღი…": date decides (postpone); time / repeat before the date = postpone
// to the task's own date (today when undated) carrying that field; anything picked after the
// decision grows the same decision (one card, one decision — still one undo).
async function agentPostponeField(id, field, value){
  const t = T(id); if(!t) return;
  const ui = agentUI[id];
  if(ui && ui.decided){
    if(ui.kind === "postpone" && ui.action) await agentPostponeAppend(id, field, value);
    return;
  }
  if(field === "due_date"){ closeAllPopovers(); await agentPostpone(id, "date", value, false); return; }
  await agentPostpone(id, "date", (t.due_date || "").slice(0, 10) || todayISO(), false, { field, value });
}
async function agentPostponeAppend(id, field, value){
  const ui = agentUI[id], r = ui.action.recipe, cur = T(id); if(!cur) return;
  value = value || "";
  const oldVal = field === "due_string" ? (isRecurrenceStr(cur.due_string) ? cur.due_string : "") : (cur[field] || "");
  if(oldVal === value) return;
  r.fields = r.fields || []; r.fields.push({field, oldVal, newVal: value});
  cur[field] = value;
  await post("/api/update", {id, field, value});
  r.changes = r.changes || {};
  if(field === "due_date"){ r.date = value; r.changes.due = (value || "—") + (cur.due_time ? " " + cur.due_time : ""); }
  if(field === "due_time") r.changes.due = ((cur.due_date || "").slice(0, 10) || "—") + (value ? " " + value : "");
  if(field === "due_string") r.changes.due_string = value || "—";
  ui.changes = r.changes;
  await agentPostStatus(id, ui.action);
  render();
}
function agentPickPostponeDate(id){
  const t = T(id); if(!t) return;
  datePickCurrent = (t.due_date || "").slice(0, 10);
  repeatAnchorISO = datePickCurrent;
  timePickTz = t.due_timezone || "";
  calYear = calMonth = undefined;
  openDatePicker("ag-pp-" + id,
    date => agentPostponeField(id, "due_date", date || ""),
    time => agentPostponeField(id, "due_time", time || ""),
    t.due_time || "",
    rs => agentPostponeField(id, "due_string", rs || ""),
    isRecurrenceStr(t.due_string) ? t.due_string : "");
}
// intervention answers
function agentEscAnyway(id){ const ui = agentUI[id]; if(!ui || !ui.esc) return; const e = ui.esc; ui.esc = null; agentPostpone(id, e.when, e.date, true, e.extra); }
function agentEscSomeday(id){ const ui = agentUI[id]; if(ui) ui.esc = null; agentPostpone(id, "someday", "", true); }
function agentEscSplit(id){ if(agentOffline()){ showToast(tr("agent.offline_locked"), "warn", 3000); return; } const ui = agentUI[id]; if(ui) ui.esc = null; agentSplit(id); }
function agentEscDelete(id){ const ui = agentUI[id]; if(ui) ui.esc = null; agentDelete(id); }
function agentEscClose(id){ const ui = agentUI[id]; if(ui) ui.esc = null; render(); }
// გადაიტანე… — a plain project/section edit through the app's own upd() (its own undo step);
// the card stays open — moving does not decide an active task (Kiki Q2: the most common fix).
function agentPickMove(btn, id){
  const t = T(id); if(!t) return;
  closeAllPopovers();
  const m = document.createElement("div");
  m.id = "project-popover"; m.className = "labels-popover";
  let rows = "";
  projects.forEach(p => {
    const on = t.project === p && !t.section;
    rows += `<div class="prio-option" onclick="event.stopPropagation(); agentMoveTo('${id}','${esc(p)}','')">
      <span class="pflag" style="color:${projColor(p)}">${SVG.hash}</span><span class="pname">${esc(p)}</span>${on ? `<span class="pcheck">✓</span>` : ""}</div>`;
    (projectSections[p] || []).forEach(sec => {
      const onS = t.project === p && t.section === sec;
      rows += `<div class="prio-option" style="padding-left:28px" onclick="event.stopPropagation(); agentMoveTo('${id}','${esc(p)}','${esc(sec)}')">
        <span class="pname">${esc(sec)}</span>${onS ? `<span class="pcheck">✓</span>` : ""}</div>`;
    });
  });
  m.innerHTML = rows;
  document.body.appendChild(m);
  positionPopover(m, btn.getBoundingClientRect());
}
function agentMoveTo(id, project, section){
  const t = T(id); if(!t) return;
  if(t.project !== project){ upd(id, "project", project); upd(id, "section", section || ""); }
  else if((t.section || "") !== (section || "")) upd(id, "section", section || "");
  closeAllPopovers(); render();
}
/* ---- tab 1 menus ---- */
function agentMenuWhen(btn, id){
  agentMenu(btn, [
    { label: tr("agent.when_tomorrow"), ico: "tomorrow", fn: () => agentPostpone(id, "tomorrow") },
    { label: tr("agent.when_days"),     ico: "days",     fn: () => agentPostpone(id, "days") },
    { label: tr("agent.when_week"),     ico: "week",     fn: () => agentPostpone(id, "week") },
    { label: tr("agent.when_month"),    ico: "month",    fn: () => agentPostpone(id, "month") },
    { label: tr("agent.when_someday"),  ico: "someday",  fn: () => agentPostpone(id, "someday") },
    { label: tr("agent.when_date"),     ico: "date",     fn: () => agentPickPostponeDate(id) },
  ]);
}
function agentMenuMoreActive(btn, id){
  agentMenu(btn, [
    { label: tr("agent.more_partial"), ico: "part",  fn: () => agentPartial(id) },
    { label: tr("agent.more_split"),   ico: "split", fn: () => agentSplit(id), disabled: agentOffline(), title: tr("agent.offline_locked") },
    { label: tr("agent.more_move"),    ico: "move",  fn: () => agentPickMove(btn, id) },
    { label: tr("agent.more_delete"),  ico: "trash", fn: () => agentDelete(id) },
    { label: tr("agent.more_keep"),    ico: "keep",  fn: () => agentKeep(id) },
  ]);
}
/* ---- tab 1 card ---- */
function agentActiveCard(t){
  const ui = agentUI[t.id] || {};
  const done = !!ui.decided, off = agentOffline();
  const due = (t.due_date || "").slice(0, 10), today = todayISO();
  const grp = agentGroupOf(t);
  const dcls = !due ? "" : due < today ? "over" : due === today ? "today" : grp === "tom" ? "tom" : "fut";
  const rep = isRecurrenceStr(t.due_string);
  const age = agentOverdueDays(t);
  const n = t.postpone_count || 0;
  const labels = (t.chosen_labels || []).filter(l => !AGENT_POSTPONE_RE.test(l));
  const proj = (t.project || "") + (t.section ? " / " + t.section : "");
  const hasFile = (t.comments || []).some(c => c.attachment);
  const cm = ui.comment || "", cmOpen = ui.cmOpen || !!cm.trim();
  const pcls = ["P1","P2","P3"].includes(t.priority) ? t.priority.toLowerCase() : "";
  const e = ui.esc;
  const dn = done && ui.kind === "complete" ? " on" : "";     // decided completion -> circle stays filled
  const escTxt = e ? (e.n >= 5 ? tr("agent.esc_count", {n: e.n}) : tr("agent.esc_age", {n: e.age})) : "";
  return `<div class="kt ${done ? "done" : ""} ${ui.flag ? "flagged" : ""} ${t.sticky ? "pinned" : ""} ${e ? "esc-on" : ""}" id="kt-${t.id}">
    <button class="chk ${pcls}${dn}" title="${esc(tr("agent.complete"))}" onclick="agentComplete('${t.id}')">${AG_ICO.check}</button>
    <div class="body">
      <div class="ttl">${esc(t.text)}${hasFile ? AG_ICO.clip : ""}</div>
      <div class="tags">
        ${due ? `<span class="d ${dcls}">${rep ? AG_ICO.repeat : ""}${esc(fmtDate(due))}${t.due_time ? " " + esc(t.due_time) : ""}</span>` : ""}
        ${age ? `<span class="age ${age >= 30 ? "max" : age >= 7 ? "warn" : ""}">${esc(tr("agent.age_days", {n: age}))}</span>` : ""}
        ${proj ? `<span class="proj">${esc(proj)}</span>` : ""}
        ${labels.map(l => `<span>@${esc(l)}</span>`).join("")}
        ${n ? `<span class="cnt ${n >= 5 ? "max" : ""}">@(+${n})</span>` : ""}
      </div>
      <textarea class="cm ${cmOpen ? "show" : ""}" id="cm-${t.id}" rows="1" placeholder="${esc(tr("agent.comment_ph"))}" oninput="agentCm('${t.id}',this)" ${off ? "readonly" : ""}>${esc(cm)}</textarea>
      ${e ? `<div class="esc show">${esc(escTxt)}
        <div class="sub">
          <button onclick="agentEscSplit('${t.id}')" ${off ? `disabled title="${esc(tr("agent.offline_locked"))}"` : ""}>${esc(tr("agent.esc_split"))}</button>
          <button onclick="agentEscSomeday('${t.id}')">${esc(tr("agent.esc_someday"))}</button>
          <button class="warn" onclick="agentEscDelete('${t.id}')">${esc(tr("agent.esc_delete"))}</button>
          <button onclick="agentEscAnyway('${t.id}')">${esc(tr("agent.esc_anyway"))}</button>
          <button class="x" onclick="agentEscClose('${t.id}')" title="${esc(tr("agent.undo"))}">${AG_ICO.undo}</button>
        </div></div>` : ""}
    </div>
    <div class="acts">
      <button class="act" id="ag-pp-${t.id}" onclick="event.stopPropagation(); agentMenuWhen(this,'${t.id}')">${esc(tr("agent.postpone"))}${AG_ICO.caret}</button>
      <button class="act" onclick="event.stopPropagation(); agentMenuMoreActive(this,'${t.id}')">${esc(tr("agent.more"))}${AG_ICO.caret}</button>
    </div>
    <div class="dec"><span>${esc(agentVerdict(ui))}</span><button class="undo" title="${esc(tr("agent.undo"))}" onclick="agentUndo('${t.id}')">${AG_ICO.undo}</button></div>
    <button class="ic cmt ${cmOpen ? "on" : ""}" id="ic-${t.id}" title="${esc(off ? tr("agent.offline_locked") : tr("agent.comment"))}" onclick="agentCmToggle('${t.id}')" ${off ? "disabled" : ""}>${AG_ICO.cmt}</button>
    <button class="ic flag ${ui.flag ? "on" : ""}" id="fl-${t.id}" title="${esc(off ? tr("agent.offline_locked") : tr("agent.flag"))}" onclick="agentFlag('${t.id}')" ${off ? "disabled" : ""}>${AG_ICO.flag}</button>
  </div>`;
}
function agentActiveList(act){
  const g = act.groups;
  if(!act.list.length) return `<div class="kp-empty">${esc(tr("agent.empty_active"))}</div>`;
  const names = { pin: tr("agent.pinned"), over: tr("agent.overdue"), today: tr("agent.today"), tom: tr("agent.tomorrow") };
  let html = "";
  AGENT_GROUPS.forEach(k => {
    const items = g[k]; if(!items.length) return;
    let shown = items, more = "";
    if(k === "over" && items.length > AGENT_OVER_SHOW){
      if(!agentOverAll){ shown = items.slice(0, AGENT_OVER_SHOW); more = `<button class="kp-more" onclick="agentOverToggle()">${esc(tr("agent.more_show", {n: items.length - AGENT_OVER_SHOW}))}</button>`; }
      else more = `<button class="kp-more" onclick="agentOverToggle()">${esc(tr("agent.less"))}</button>`;
    }
    html += `<div class="kt-day ${k}">${esc(names[k])} <span class="n">${items.length}${k === "pin" ? " / " + STICKY_MAX : ""}</span></div>` + shown.map(agentActiveCard).join("") + more;
  });
  return html;
}
function agentOverToggle(){ agentOverAll = !agentOverAll; render(); }
// ვეთანხმები — writes the whole proposal at once (move · priority · due · labels · title ·
// subtasks · merge) through the app's own endpoints; ONE undo step for all of it.
async function agentAccept(id){
  const t = T(id); if(!t) return;
  const p = agentProposal(t);
  const changes = agentChanges(t);
  const tgt = agentTarget(t, p);
  const due = agentDueISO(p.due), time = due ? (p.time || "") : "";
  const fields = [];   // {field, oldVal, newVal} — applied in this order (project before section)
  const push = (field, oldVal, newVal) => { if(JSON.stringify(oldVal) !== JSON.stringify(newVal)) fields.push({field, oldVal, newVal}); };
  if(tgt.project !== t.project){ push("project", t.project, tgt.project); push("section", t.section || "", tgt.section); }
  else if((t.section || "") !== tgt.section) push("section", t.section || "", tgt.section);
  if(["P1","P2","P3","P4"].includes(p.priority)) push("priority", t.priority, p.priority);
  const rep = agentRepeat(p);
  if(p.due !== undefined){ push("due_date", t.due_date || "", due); if(due) push("due_time", t.due_time || "", time); }
  else if(rep && !t.due_date) push("due_date", "", todayISO());          // recurrence needs a start date (same default as the app)
  // recurrence (C2): after the date/time, so the due object Todoist gets = date + "every … at HH:MM"
  if(p.due_string !== undefined) push("due_string", isRecurrenceStr(t.due_string) ? t.due_string : "", rep);
  if(Array.isArray(p.labels)) push("chosen_labels", t.chosen_labels || [], p.labels);
  // description: cleaned title → original text goes in when empty; then description_append (C2) as a new paragraph
  let desc = t.description || "";
  if(p.title && p.title.trim() && p.title.trim() !== t.text){
    push("text", t.text, p.title.trim());
    if(!desc.trim()) desc = t.text;
  }
  const descAdd = (p.description_append || "").trim();
  if(descAdd) desc = (desc.trim() ? desc.replace(/\s+$/, "") + "\n\n" : "") + descAdd;
  push("description", t.description || "", desc);
  const subtasks = Array.isArray(p.subtasks) ? p.subtasks.map(s => String(s).trim()).filter(Boolean) : [];
  const mergeInto = p.merge_into && T(p.merge_into) ? p.merge_into : "";
  // the recipe = everything undo/redo needs; persisted server-side with the decision
  const action = agentActionFor(id, "accept", { fields, subtasks, mergeInto, text: t.text, changes, proposal: p });
  await action.redo();
  recordAction(action);
}

/* ---- the one button: „გადაამოწმე (N)" ---- */
// N = every card (either tab) with an agent action (დაშალე) OR a „?" flag OR a non-empty comment.
function agentItemsToSend(){
  const triage = [], active = [];
  Object.keys(agentUI).forEach(id => {
    const ui = agentUI[id];
    const split = ui.decided && ui.kind === "split";
    const cm = (ui.comment || "").trim();
    if(!(split || ui.flag || cm)) return;
    const t = agentTask(id); if(!t) return;
    if(ui.tab === "active")
      active.push({ task_id: id, action: split ? "split" : null, flag: !!ui.flag,
                    decision: agentVerdict(ui) || null, comment: cm || null, changes: ui.changes || null });
    else
      triage.push({ task_id: id, action: split ? "split" : null, flag: !!ui.flag,
                    proposal: agentProposal(t), changes: ui.changes || agentChanges(t) || null,
                    decision: agentVerdict(ui) || null, comment: cm || null });
  });
  return { active, triage };
}
async function agentSend(){
  const f = agentFooterInfo();
  if(f.disabled) return;
  const b = document.getElementById("kp-send"); if(b) b.disabled = true;
  try {
    if(f.n && !f.off){          // offline: nothing is sent — split marks · flags · comments wait for the agent
      const d = await post("/api/agent_queue", { active: f.items.active, triage: f.items.triage, agent: agentInfo.name || "" });
      agentSentN = (d && d.queued) || f.n;
      // sent cards leave the round: their status is now "queued" (server); drop the session marks
      f.items.triage.concat(f.items.active).forEach(it => { delete agentUI[it.task_id]; });
      agentDraftsSave();
      showToast(tr("agent.sent", {n: agentSentN}), "ok", 4000);
    }
    await agentRoundClose(!f.n || f.off);
    render();
  } catch(_){ if(b) b.disabled = false; }
}
// Round close: deferred deletes become real deletes (server), cards decided so far leave the
// tab. One global undo for the whole close (restore every deleted task + its subtasks, cards
// come back undecided).
async function agentRoundClose(toast){
  const d = await post("/api/agent_round_close", {});
  const deleted = (d && d.deleted) || [];
  // decided cards leave the tab; a დაშალე mark not yet sent (agent offline) stays for the next send
  Object.keys(agentUI).forEach(id => { if(agentUI[id].decided && agentUI[id].kind !== "split") delete agentUI[id]; });
  agentDraftsSave();
  if(deleted.length){
    recordAction({
      label: tr("undo.label_agent_round", {n: deleted.length}),
      undo: async () => {
        for(const x of deleted){ await post("/api/task_restore", {id: x.id, subs: x.subs || []}); await post("/api/agent_status", {id: x.id, status: x.tab === "active" ? "" : "proposed", tab: x.tab || "triage"}); }
      },
      redo: async () => {
        for(const x of deleted){ await post("/api/agent_status", {id: x.id, status: "deleted_pending", tab: x.tab || "triage", decision: {kind: "delete", recipe: {text: x.text, tab: x.tab || "triage"}}}); }
        await post("/api/agent_round_close", {});
        Object.keys(agentUI).forEach(id => { if(agentUI[id].decided && agentUI[id].kind !== "split") delete agentUI[id]; });
      },
    });
  }
  if(toast) showToast(deleted.length ? tr("agent.round_closed", {n: deleted.length}) : tr("agent.round_closed0"), "ok", 4000);
}

agentDraftsLoad();
// deep link: #triage opens tab 2 (the view opens once an agent has connected at least once)
if(location.hash === "#triage") agentTab = "triage";
