/* ============ AI AGENT PANEL ("AI აგენტის პანელი") ============ */
// Bridge view between Todoister and an AI agent (v1 = კიკი; the contract is generic —
// see AGENT-API.md). Spec: Kiki/_work/triage-handover/SPEC.md v0.2 + Lasha's decisions
// (2026-08-16). Server side: agent_panel.py. Ported from კიკი's approved mockup
// (panel.js / active.js) — same look, real data + real endpoints.
//
// Two tabs, one card shape, one button:
//   აქტიური        — pinned · overdue · today · tomorrow          (Stage 3)
//   დაუხარისხებელი — Inbox captures + the agent's proposal          (Stage 1, this file)
// Standard actions (ვეთანხმები / წაშალე) run immediately through the app's own
// endpoints, with undo. Agent actions (დაშალე, „?" flag, comment) accumulate and go with
// „გადაამოწმე (N)" → POST /api/agent_queue → panel locked until the agent posts agent_done.
// No agent connected → the sidebar item is disabled; the queue waits in the DB.

let agentInfo = { connected:false, busy:false, name:"", last_seen:"", last_analysis:"", open_batches:[], queued:0 };
let agentTab = "triage";           // Stage 1: tab 2 is the built one (tab 1 arrives in Stage 3)
let agentSentN = 0;                // items in the batch we just sent (for the „მუშავდება" line)
let _agentWasBusy = false;
// Per-card session state: id → {decided, verdict, kind:'accept'|'delete'|'split', action (undo/redo
// object), prop (edited proposal), changes, comment, cmOpen, flag, snap (task snapshot for deleted)}
const agentUI = {};

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
  keep:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></svg>',
  edit:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};

/* ---- shared dropdown: Todoister's .more-popover + .prio-option, every item = icon + text ---- */
function agentMenu(btn, items){
  const open = document.getElementById("more-popover");
  closeAllPopovers();
  if(open && open._btn === btn) return;            // second click on the same button = toggle off
  const m = document.createElement("div");
  m.id = "more-popover"; m.className = "more-popover kp-menu"; m._btn = btn;
  m.innerHTML = items.map((it, i) =>
    `<div class="prio-option" data-i="${i}"><span class="pflag">${AG_ICO[it.ico] || ""}</span><span class="pname">${esc(it.label)}</span></div>`
  ).join("");
  m.addEventListener("click", e => {
    e.stopPropagation();
    const o = e.target.closest(".prio-option"); if(!o) return;
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
      const conn = agentInfo.connected ? tr("agent.connection_on") : tr("agent.connection_off");
      sub.innerHTML = `${esc(la)} · <span class="kp-dot ${agentInfo.connected ? "" : "off"}" title="${esc(agentInfo.name || "")}"></span> ${esc(conn)}`;
    }
  }
  if(btn){
    btn.style.display = on ? "" : "none";
    btn.disabled = !agentInfo.connected || agentInfo.busy;
  }
}
function agentPendingCount(){
  // cards awaiting a decision on both tabs (Stage 1: triage only)
  return agentTriageTasks().filter(t => !(agentUI[t.id] && agentUI[t.id].decided)).length;
}
function agentRenderNav(){
  const li = document.getElementById("filter_agent");
  const badge = document.getElementById("count-agent");
  if(!li || !badge) return;
  li.classList.toggle("disabled", !agentInfo.connected && !agentInfo.busy);
  li.classList.toggle("locked", !!agentInfo.busy);
  if(agentInfo.busy){
    if(!badge.querySelector(".spin")) badge.innerHTML = '<span class="spin"></span>';
  } else {
    const n = agentPendingCount();
    badge.textContent = n ? String(n) : "";
  }
  // agent answered → toast once (the panes re-render on their own)
  if(_agentWasBusy && !agentInfo.busy && agentInfo.connected){
    showToast(tr("agent.answer_arrived"), "ok", 4000);
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
// Tab 2 = tasks that carry a proposal awaiting a decision (+ the ones decided this session,
// kept on screen dimmed with their verdict + undo until the round is sent / the view reloads).
function agentTriageTasks(){
  const out = [];
  state.forEach(t => {
    if(t.parent_id) return;
    const ui = agentUI[t.id];
    if(t.agent_status === "proposed" && t.agent_proposal) out.push(t);
    else if(ui && ui.decided && ui.tab === "triage") out.push(t);
  });
  // deleted this session (no longer in state) — render from the snapshot
  Object.keys(agentUI).forEach(id => {
    const ui = agentUI[id];
    if(ui.decided && ui.tab === "triage" && ui.snap && !T(id)) out.push(ui.snap);
  });
  return out;
}
function agentUiFor(id){ return agentUI[id] || (agentUI[id] = { tab:"triage" }); }
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
function agentChanges(t){
  // diff between the edited proposal and the agent's original (what the agent learns from)
  const ui = agentUI[t.id]; if(!ui || !ui.prop || !t.agent_proposal) return null;
  const a = t.agent_proposal, b = ui.prop, out = {};
  const ta = agentTarget(t, a), tb = agentTarget(t, b);
  if(ta.project !== tb.project) out.project = tb.project;
  if(ta.section !== tb.section) out.section = tb.section || "—";
  if((a.priority || "") !== (b.priority || "")) out.priority = b.priority || "";
  if(agentDueISO(a.due) !== agentDueISO(b.due) || (a.time || "") !== (b.time || "")) out.due = (agentDueISO(b.due) || "—") + (b.time ? " " + b.time : "");
  if(JSON.stringify(a.labels || []) !== JSON.stringify(b.labels || [])) out.labels = (b.labels || []).map(l => "@" + l).join(" ") || "—";
  return Object.keys(out).length ? out : null;
}

/* ---- view ---- */
function renderAgentPanel(row){
  if(!agentInfo.connected && !agentInfo.busy){
    row.innerHTML = `<div class="list-wrap kp-wrap"><div class="kp-off"><b>${esc(tr("agent.disabled_title"))}</b>${esc(tr("agent.disabled_body"))}</div></div>`;
    return;
  }
  const triage = agentTriageTasks();
  const nTri = triage.filter(t => !(agentUI[t.id] && agentUI[t.id].decided)).length;
  const items = agentItemsToSend();
  const n = items.active.length + items.triage.length;
  let body;
  if(agentInfo.busy){
    body = `<div class="kp-proc" id="kp-proc"><b><span class="spin"></span>${esc(tr("agent.processing"))}</b>${esc(tr("agent.processing_sub", {n: agentSentN || agentInfo.queued || 0}))}</div>`;
  } else {
    const pane = agentTab === "triage"
      ? `<section class="kp-pane" id="pane-triage">
           <div class="kp-legend">${esc(tr("agent.legend_triage"))}</div>
           <div id="kp-cards">${triage.length ? triage.map(agentTriageCard).join("") : `<div class="kp-empty">${esc(tr("agent.empty_triage"))}</div>`}</div>
         </section>`
      : `<section class="kp-pane" id="pane-active"><div id="kt-list"><div class="kp-empty">${esc(tr("agent.empty_active"))}</div></div></section>`;
    const summary = tr("agent.summary", {n}) + (n ? tr("agent.summary_split", {a: items.active.length, t: items.triage.length}) : "");
    body = pane + `<div class="kp-submit" id="kp-footer">
        <span id="kp-summary">${esc(summary)}</span>
        <button class="kp-send" id="kp-send" onclick="agentSend()" ${n ? "" : "disabled"}>${esc(tr("agent.recheck", {n}))}</button>
      </div>`;
  }
  row.innerHTML = `<div class="list-wrap kp-wrap">
    <div class="kp-tabs ${agentInfo.busy ? "locked" : ""}" role="tablist">
      <button class="kp-tab ${agentTab === "active" ? "active" : ""}" id="tab-active" onclick="agentSetTab('active')">${esc(tr("agent.tab_active"))} <span class="kp-tab-n">0</span></button>
      <button class="kp-tab ${agentTab === "triage" ? "active" : ""}" id="tab-triage" onclick="agentSetTab('triage')">${esc(tr("agent.tab_triage"))} <span class="kp-tab-n ${nTri ? "sage" : ""}">${nTri}</span></button>
    </div>${body}</div>`;
  row.querySelectorAll("textarea.cm.show").forEach(t => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; });
}
function agentSetTab(t){ agentTab = t; render(); }

function agentTriageCard(t){
  const ui = agentUI[t.id] || {};
  const p = agentProposal(t);
  const orig = t.agent_proposal || {};
  const conf = ["high","mid","low"].includes(p.confidence) ? p.confidence : "mid";
  const type = ["simple","complex","info","note"].includes(p.type) ? p.type : "simple";
  const tgt = agentTarget(t, p), tgt0 = agentTarget(t, orig);
  const prio = ["P1","P2","P3","P4"].includes(p.priority) ? p.priority : t.priority;
  const due = agentDueISO(p.due), due0 = agentDueISO(orig.due);
  const dueTxt = due ? fmtDate(due) + (p.time ? " " + p.time : "") : tr("agent.no_date");
  const labels = Array.isArray(p.labels) ? p.labels : [];
  const chg = { section: tgt.project !== tgt0.project || tgt.section !== tgt0.section, prio: prio !== (orig.priority || t.priority),
                due: due !== due0 || (p.time || "") !== (orig.time || ""), labels: JSON.stringify(labels) !== JSON.stringify(orig.labels || []) };
  const secTxt = (tgt.project === t.project ? "" : tgt.project + " / ") + (tgt.section || (tgt.project === t.project ? tr("agent.no_section") : ""));
  const merge = p.merge_into && T(p.merge_into) ? `<span title="${esc(T(p.merge_into).text)}">${esc(tr("agent.merge_into", {title: T(p.merge_into).text}))}</span>` : "";
  const subs = Array.isArray(p.subtasks) && p.subtasks.length ? `<ul class="subs">${p.subtasks.map(s => `<li>${esc(String(s))}</li>`).join("")}</ul>` : "";
  const q = conf === "low" && Array.isArray(p.questions) && p.questions.length ? `<div class="q">${esc(p.questions.join(" · "))}</div>` : "";
  const hasFile = (t.comments || []).some(c => c.attachment);
  const cm = ui.comment || "", cmOpen = ui.cmOpen || !!cm.trim();
  const done = !!ui.decided;
  return `<div class="kt ${done ? "done" : ""} ${ui.flag ? "flagged" : ""}" id="kt-${t.id}">
    <span class="conf ${conf}" title="${esc(tr("agent.conf_" + conf))}"></span>
    <div class="body">
      <div class="ttl">${esc(t.text)}${hasFile ? AG_ICO.clip : ""}<span class="kp-type ${type}">${esc(tr("agent.type_" + type))}</span></div>
      ${p.read ? `<div class="read"><b>${esc(p.read)}</b></div>` : ""}
      <div class="prop" id="ag-prop-${t.id}">
        <span class="pv ${chg.section ? "changed" : ""}" onclick="agentPickSection(event,'${t.id}')">${esc(secTxt)}</span>
        <span class="pv ${prio.toLowerCase()} ${chg.prio ? "changed" : ""}" onclick="agentPickPrio(event,'${t.id}')">${prio}</span>
        <span class="pv ${chg.due ? "changed" : ""}" id="ag-due-${t.id}" onclick="agentPickDate(event,'${t.id}')">${esc(dueTxt)}</span>
        <span class="pv ${chg.labels ? "changed" : ""}" onclick="agentPickLabels(event,'${t.id}')">${labels.length ? esc(labels.map(l => "@" + l).join(" ")) : "@…"}</span>
        ${merge}
      </div>
      ${subs}${q}
      <textarea class="cm ${cmOpen ? "show" : ""}" id="cm-${t.id}" rows="1" placeholder="${esc(tr("agent.comment_ph"))}" oninput="agentCm('${t.id}',this)">${esc(cm)}</textarea>
    </div>
    <div class="acts">
      <button class="act ok" onclick="agentAccept('${t.id}')">${esc(tr("agent.accept"))}</button>
      <button class="act" onclick="event.stopPropagation(); agentMenuMore(this,'${t.id}')">${esc(tr("agent.more"))}${AG_ICO.caret}</button>
    </div>
    <div class="dec"><span>${esc(ui.verdict || "")}</span><button class="undo" title="${esc(tr("agent.undo"))}" onclick="agentUndo('${t.id}')">${AG_ICO.undo}</button></div>
    <button class="ic cmt ${cmOpen ? "on" : ""}" id="ic-${t.id}" title="${esc(tr("agent.comment"))}" onclick="agentCmToggle('${t.id}')">${AG_ICO.cmt}</button>
    <button class="ic flag ${ui.flag ? "on" : ""}" id="fl-${t.id}" title="${esc(tr("agent.flag"))}" onclick="agentFlag('${t.id}')">${AG_ICO.flag}</button>
  </div>`;
}

/* ---- comment + „?" flag (independent of any decision; survive undo) ---- */
function agentCmToggle(id){
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
  agentRefreshFooter();
}
function agentFlag(id){
  const ui = agentUiFor(id); ui.flag = !ui.flag;
  const c = document.getElementById("kt-" + id); if(c) c.classList.toggle("flagged", ui.flag);
  const f = document.getElementById("fl-" + id); if(f) f.classList.toggle("on", ui.flag);
  agentRefreshFooter();
  agentRenderNav();
}
function agentRefreshFooter(){
  const items = agentItemsToSend(); const n = items.active.length + items.triage.length;
  const s = document.getElementById("kp-summary"), b = document.getElementById("kp-send");
  if(s) s.textContent = tr("agent.summary", {n}) + (n ? tr("agent.summary_split", {a: items.active.length, t: items.triage.length}) : "");
  if(b){ b.textContent = tr("agent.recheck", {n}); b.disabled = n === 0; }
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
  calYear = calMonth = undefined;
  openDatePicker("ag-due-" + id,
    date => { const e = agentEditProp(t); e.due = date || ""; if(!date) e.time = ""; closeAllPopovers(); render(); },
    time => { const e = agentEditProp(t); e.time = time || ""; render(); },
    p.time || "");
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
  agentMenu(btn, [
    { label: tr("agent.more_edit"),   ico: "edit",  fn: () => agentHintEdit(id) },
    { label: tr("agent.more_split"),  ico: "split", fn: () => agentSplit(id) },
    { label: tr("agent.more_delete"), ico: "trash", fn: () => agentDelete(id) },
  ]);
}
function agentHintEdit(id){
  const p = document.getElementById("ag-prop-" + id);
  if(p){ p.classList.remove("pulse"); void p.offsetWidth; p.classList.add("pulse"); }
  showToast(tr("agent.edit_hint"), "ok", 4000);
}
// A card-level undo unwinds exactly that card's action (and drops it from the global undo stack).
function agentUndo(id){
  const ui = agentUI[id]; if(!ui || !ui.decided) return;
  if(ui.action){
    const i = undoStack.indexOf(ui.action); if(i >= 0){ undoStack.splice(i, 1); updateUndoButtons(); }
    ui.action.undo();
    post("/api/agent_status", {id, status: "proposed", tab: "triage"});
  }
  const keep = { comment: ui.comment, cmOpen: ui.cmOpen, flag: ui.flag, prop: ui.prop, tab: "triage" };
  agentUI[id] = keep;
  render();
}
function agentSplit(id){
  const t = T(id); if(!t) return;
  const ui = agentUiFor(id);
  ui.decided = true; ui.kind = "split"; ui.verdict = tr("agent.verdict_split"); ui.action = null;
  render();
}
async function agentDelete(id){
  const t = T(id); if(!t) return;
  const ui = agentUiFor(id);
  ui.snap = JSON.parse(JSON.stringify(t));
  ui.decided = true; ui.kind = "delete"; ui.verdict = tr("agent.verdict_deleted");
  render();
  const d = await post("/api/task_delete", {id});
  const subs = (d && d.deleted_ids) ? d.deleted_ids.filter(x => x !== id) : [];
  const action = {
    label: t.text || tr("undo.label_delete"),
    undo: () => post("/api/task_restore", {id, subs}),
    redo: () => post("/api/task_delete", {id}),
  };
  recordAction(action);
  ui.action = action;
  post("/api/agent_status", {id, status: "rejected", verdict: ui.verdict, tab: "triage"});
}
// ვეთანხმები — writes the whole proposal at once (move · priority · due · labels · title ·
// subtasks · merge) through the app's own endpoints; ONE undo step for all of it.
async function agentAccept(id){
  const t = T(id); if(!t) return;
  const ui = agentUiFor(id);
  const p = agentProposal(t);
  const changes = agentChanges(t);
  const tgt = agentTarget(t, p);
  const due = agentDueISO(p.due), time = due ? (p.time || "") : "";
  const fields = [];   // {field, oldVal, newVal} — applied in this order (project before section)
  const push = (field, oldVal, newVal) => { if(JSON.stringify(oldVal) !== JSON.stringify(newVal)) fields.push({field, oldVal, newVal}); };
  if(tgt.project !== t.project){ push("project", t.project, tgt.project); push("section", t.section || "", tgt.section); }
  else if((t.section || "") !== tgt.section) push("section", t.section || "", tgt.section);
  if(["P1","P2","P3","P4"].includes(p.priority)) push("priority", t.priority, p.priority);
  if(p.due !== undefined){ push("due_date", t.due_date || "", due); if(due) push("due_time", t.due_time || "", time); }
  if(Array.isArray(p.labels)) push("chosen_labels", t.chosen_labels || [], p.labels);
  if(p.title && p.title.trim() && p.title.trim() !== t.text){
    push("text", t.text, p.title.trim());
    if(!(t.description || "").trim()) push("description", t.description || "", t.text);
  }
  const subtasks = Array.isArray(p.subtasks) ? p.subtasks.map(s => String(s).trim()).filter(Boolean) : [];
  const mergeInto = p.merge_into && T(p.merge_into) ? p.merge_into : "";
  const what = changes ? Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(", ") : "";
  ui.decided = true; ui.kind = "accept"; ui.changes = changes;
  ui.verdict = changes ? tr("agent.verdict_changed", {what}) : tr("agent.verdict_accepted");
  ui.snap = JSON.parse(JSON.stringify(t));
  render();

  const applyFields = dir => {
    fields.forEach(c => { const v = dir === "undo" ? c.oldVal : c.newVal; const tt = T(id); if(tt) tt[c.field] = v; post("/api/update", {id, field: c.field, value: v}); });
  };
  let createdSubs = [], mergedSub = "";
  const addSubs = async () => {
    createdSubs = [];
    const before = new Set(((T(id) || {}).subtasks || []).map(s => s.id));
    for(const s of subtasks) await post("/api/subtask_add", {id, text: s});
    createdSubs = ((T(id) || {}).subtasks || []).map(s => s.id).filter(x => !before.has(x));
  };
  const doMerge = async () => {
    mergedSub = "";
    if(!mergeInto) return;
    const before = new Set(((T(mergeInto) || {}).subtasks || []).map(s => s.id));
    await post("/api/subtask_add", {id: mergeInto, text: t.text});
    mergedSub = (((T(mergeInto) || {}).subtasks || []).map(s => s.id).find(x => !before.has(x))) || "";
    await post("/api/task_delete", {id});
  };
  const action = {
    label: tr("undo.label_agent_accept"),
    undo: async () => {
      if(mergeInto){ if(mergedSub) await post("/api/task_delete", {id: mergedSub}); await post("/api/task_restore", {id, subs: []}); }
      for(const sid of createdSubs) await post("/api/task_delete", {id: sid});
      applyFields("undo");
    },
    redo: async () => { applyFields("redo"); await addSubs(); await doMerge(); },
  };
  applyFields("redo");
  await addSubs();
  await doMerge();
  recordAction(action);
  ui.action = action;
  post("/api/agent_status", {id, status: changes ? "changed" : "accepted", changes, verdict: ui.verdict, tab: "triage"});
}

/* ---- the one button: „გადაამოწმე (N)" ---- */
// N = every card (either tab) with an agent action (დაშალე) OR a „?" flag OR a non-empty comment.
function agentItemsToSend(){
  const triage = [];
  Object.keys(agentUI).forEach(id => {
    const ui = agentUI[id];
    const split = ui.decided && ui.kind === "split";
    const cm = (ui.comment || "").trim();
    if(!(split || ui.flag || cm)) return;
    const t = T(id) || ui.snap; if(!t) return;
    triage.push({ task_id: id, action: split ? "split" : null, flag: !!ui.flag,
                  proposal: agentProposal(t), changes: ui.changes || agentChanges(t) || null,
                  decision: ui.verdict || null, comment: cm || null });
  });
  return { active: [], triage };
}
async function agentSend(){
  const items = agentItemsToSend();
  const n = items.active.length + items.triage.length;
  if(!n) return;
  const b = document.getElementById("kp-send"); if(b) b.disabled = true;
  try {
    const d = await post("/api/agent_queue", { active: items.active, triage: items.triage, agent: agentInfo.name || "" });
    agentSentN = (d && d.queued) || n;
    // sent cards leave the round: their status is now "queued" (server); drop the session marks
    items.triage.forEach(it => { delete agentUI[it.task_id]; });
    showToast(tr("agent.sent", {n: agentSentN}), "ok", 4000);
    render();
  } catch(_){ if(b) b.disabled = false; }
}

// deep link: #triage opens tab 2 (the view itself opens only when an agent is connected)
if(location.hash === "#triage") agentTab = "triage";
