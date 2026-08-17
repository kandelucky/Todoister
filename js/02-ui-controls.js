/* ============ STYLED DIALOGS (alert / confirm / prompt) ============ */
// In-app replacements for native alert()/confirm()/prompt() — same .pd-* visual,
// one shared backdrop (#confirm-backdrop > #confirm-dialog). All return Promises.
//   uiAlert(opts)   -> Promise            one OK button (informational / errors)
//   uiConfirm(opts) -> Promise<bool>      cancel + ok question
//   uiPrompt(opts)  -> Promise<string>    text field; trimmed text on ok, falsy on cancel
// opts: {title, body, note, ok, cancel}  (+ uiPrompt: {def, placeholder, maxlength})
let _confirmResolver = null;
function _resolveConfirm(v){
  document.getElementById("confirm-backdrop").classList.remove("show");
  const r = _confirmResolver; _confirmResolver = null;
  if(r) r(v);
}
function _resolvePrompt(ok){
  const inp = document.getElementById("ui-prompt-input");
  _resolveConfirm(ok && inp ? inp.value.trim() : null);
}
// note = optional grey sub-lines under the body (one <p> per non-empty line)
function _uiNote(note){
  return note
    ? note.split("\n").filter(Boolean).map(line => `<p class="pd-note">${esc(line)}</p>`).join("")
    : "";
}
// body block: a message paragraph (only if non-empty) + any extra markup (note / input)
function _uiBody(body, extra){
  return `<div class="pd-body">${body ? `<p class="pd-msg">${esc(body)}</p>` : ""}${extra || ""}</div>`;
}
function _openDialog(html){
  document.getElementById("confirm-dialog").innerHTML = html;
  document.getElementById("confirm-backdrop").classList.add("show");
}
function uiAlert(opts){
  opts = opts || {};
  return new Promise(resolve => {
    _confirmResolver = resolve;
    _openDialog(`
      <div class="pd-head">${esc(opts.title || "")}</div>
      ${_uiBody(opts.body, _uiNote(opts.note))}
      <div class="pd-foot">
        <button class="pd-btn primary" onclick="_resolveConfirm(true)">${esc(opts.ok || tr("common.ok"))}</button>
      </div>`);
  });
}
function uiConfirm(opts){
  opts = opts || {};
  return new Promise(resolve => {
    _confirmResolver = resolve;
    _openDialog(`
      <div class="pd-head">${esc(opts.title || "")}</div>
      ${_uiBody(opts.body, _uiNote(opts.note))}
      <div class="pd-foot">
        <button class="pd-btn cancel" onclick="_resolveConfirm(false)">${esc(opts.cancel || tr("common.cancel"))}</button>
        <button class="pd-btn primary" onclick="_resolveConfirm(true)">${esc(opts.ok || tr("common.delete"))}</button>
      </div>`);
  });
}
function uiPrompt(opts){
  opts = opts || {};
  return new Promise(resolve => {
    _confirmResolver = resolve;
    const field = `<input id="ui-prompt-input" class="pd-input" type="text" value="${esc(opts.def || "")}"
        placeholder="${esc(opts.placeholder || "")}" maxlength="${opts.maxlength || 200}"
        onkeydown="if(event.key==='Enter'){event.preventDefault();_resolvePrompt(true);}">`;
    _openDialog(`
      <div class="pd-head">${esc(opts.title || "")}</div>
      ${_uiBody(opts.body, field)}
      <div class="pd-foot">
        <button class="pd-btn cancel" onclick="_resolvePrompt(false)">${esc(opts.cancel || tr("common.cancel"))}</button>
        <button class="pd-btn primary" onclick="_resolvePrompt(true)">${esc(opts.ok || tr("common.save"))}</button>
      </div>`);
    setTimeout(() => { const i = document.getElementById("ui-prompt-input"); if(i){ i.focus(); i.select(); } }, 30);
  });
}
// Exposed on window so the notebook bundle (same window) can call them too.
window.uiAlert = uiAlert; window.uiConfirm = uiConfirm; window.uiPrompt = uiPrompt;

/* ============ ACCOUNT / SYNC PANEL ============ */
function syncStatusInfo(){
  if(!connected) return {cls:"err", label:tr("account.disconnected"), val:""};
  const hasErr = !!(syncState.last_push_error || syncState.last_pull_error);
  if(isOffline || hasErr) return {cls:"err", label:tr("sync.status_offline"), val:""};
  if(syncState.dead_count > 0) return {cls:"err", label:tr("sync.status_dead", {n: syncState.dead_count}), val:""};
  if(pendingCount > 0) return {cls:"warn", label:tr("sync.status_pending", {n: pendingCount}), val:""};
  return {cls:"ok", label:tr("sync.status_synced"),
          val: syncState.last_sync_at ? syncState.last_sync_at.slice(11,16) : ""};
}
// Header pill click when Todoist rejected some queued commands for good
// (pending_ops.dead=1): explain + let the user drop them from the queue.
async function discardDeadOps(){
  const n = syncState.dead_count || 0;
  if(!n) return;
  const ok = await uiConfirm({
    title: tr("sync.dead_title", {n}),
    body: tr("sync.dead_body"),
    note: tr("sync.dead_note", {msg: (syncState.dead_errors || []).join("; ") || "—"}),
    ok: tr("sync.dead_ok"),
  });
  if(!ok) return;
  try {
    const d = await post("/api/sync_discard_dead", {});
    showToast(tr("toast.dead_discarded", {n: (d && d.discarded) || n}), "ok");
  } catch(e){
    showToast(tr("toast.save_failed", {msg: e.message}), "error");
  }
}
function closeSyncPanel(){
  document.getElementById("sync-panel").classList.remove("show");
}
function openSyncPanel(e){
  if(e) e.stopPropagation();
  const panel = document.getElementById("sync-panel");
  if(panel.classList.contains("show")){ closeSyncPanel(); return; }
  const st = syncStatusInfo();
  const name = connected ? (account.name || tr("user.name")) : tr("account.disconnected");
  const emailRow = (connected && account.email)
    ? `<div class="sp-email">${esc(account.email)}</div>` : "";
  const actions = connected
    ? `<button class="sp-btn primary" onclick="syncNowFromPanel()">${SVG.reloadSmall} ${tr("sync.now")}</button>
       <button class="sp-btn danger" onclick="disconnectAccount()">${tr("account.disconnect")}</button>`
    : `<button class="sp-btn primary" onclick="connectAccount()">${tr("account.connect")}</button>`;
  panel.innerHTML =
    `<div class="sp-account">
       <span class="user-avatar"></span>
       <div class="sp-id"><div class="sp-name">${esc(name)}</div>${emailRow}</div>
     </div>
     <div class="sp-sep"></div>
     <div class="sp-rows">
       <div class="sp-row"><span class="sp-dot ${st.cls}"></span><span>${esc(st.label)}</span><span class="sp-val">${esc(st.val)}</span></div>
     </div>
     <div class="sp-sep"></div>
     <div class="sp-actions">${actions}</div>`;
  paintAvatar(panel.querySelector(".user-avatar"));
  panel.classList.add("show");
  const r = document.getElementById("user-btn").getBoundingClientRect();
  panel.style.left = r.left + "px";
  panel.style.top = (r.bottom + 4) + "px";
}
function syncNowFromPanel(){
  closeSyncPanel();
  manualSync();
}
async function disconnectAccount(){
  closeSyncPanel();
  const ok = await uiConfirm({
    title: tr("account.disconnect_title"),
    body: tr("account.disconnect_confirm"),
    note: tr("account.disconnect_filters") + "\n" + tr("account.disconnect_note"),
    ok: tr("account.disconnect"),
  });
  if(!ok) return;
  try {
    const r = await fetch("/api/disconnect", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"});
    const d = await r.json();
    // Server wiped the synced data — mirror that locally and reset the view.
    account = d.account || {name:"", email:"", avatar_url:""};
    connected = d.connected !== undefined ? d.connected : false;
    state = d.tasks || [];
    projects = d.projects || [];
    projectMeta = d.project_meta || {};
    archivedProjects = d.archived_projects || [];
    projectSections = d.project_sections || {};
    setLabels(d.labels || []);
    pendingCount = d.pending_count || 0;
    currentView = "inbox";
    render();
    showToast(tr("account.disconnected_toast"), "ok");
  } catch(e){
    showToast(tr("account.disconnect_failed", {msg: e.message}), "error");
  }
}
function connectAccount(){
  // Onboarding page handles entering + validating a new token, then re-syncs.
  closeSyncPanel();
  location.href = "/onboarding";
}

/* ============ REMINDERS ============ */
async function deleteReminder(rid){
  await post("/api/reminder_delete", {reminder_id: rid});
  if(modalTaskId) renderModal();
}
function closeAddReminder(){
  const p = document.getElementById("rem-pop");
  if(p) p.classList.remove("show");
}
function openAddReminder(tid, ev){
  ev.stopPropagation();
  const pop = document.getElementById("rem-pop");
  const presets = [
    {label: tr("reminder.before_30m"), mm: 30},
    {label: tr("reminder.before_1h"), mm: 60},
    {label: tr("reminder.before_2h"), mm: 120},
    {label: tr("reminder.before_1d"),  mm: 1440},
    {label: tr("reminder.before_3d"),  mm: 4320},
  ];
  pop.innerHTML = `
    ${presets.map(p => `
      <button class="rem-pop-item" onclick="addReminderRelative('${tid}', ${p.mm})">${p.label}</button>
    `).join("")}
    <div class="rem-pop-sep"></div>
    <div class="rem-pop-custom" id="rem-custom">
      <div style="font-size:11px; color:var(--text-3);">${tr("reminder.specific_datetime")}</div>
      <input type="date" id="rem-date" value="${todayISO()}">
      <input type="time" id="rem-time" value="09:00">
      <div class="actions">
        <button onclick="closeAddReminder()">${tr("common.cancel")}</button>
        <button class="primary" onclick="addReminderAbsolute('${tid}')">${tr("common.add")}</button>
      </div>
    </div>
  `;
  pop.classList.add("show");
  positionPopover(pop, ev.target.getBoundingClientRect());
}
async function addReminderRelative(tid, mm){
  closeAddReminder();
  await post("/api/reminder_add", {id: tid, type: "relative", mm_offset: mm});
  if(modalTaskId) renderModal();
}
async function addReminderAbsolute(tid){
  const d = document.getElementById("rem-date").value;
  const tm = document.getElementById("rem-time").value;
  if(!d){ showToast(tr("reminder.enter_date_first"), "warn"); return; }
  closeAddReminder();
  await post("/api/reminder_add", {id: tid, type: "absolute", due_date: d, due_time: tm});
  if(modalTaskId) renderModal();
}

/* ============ FILTERS ============ */
function visibleTasks(){
  let list;
  if(currentView === "completed"){
    list = state.filter(t => t.completed);
    list.sort((a,b) => (b.completed_at||"").localeCompare(a.completed_at||""));
  } else {
    list = state.filter(t => !t.completed);
    if(currentView === "inbox") list = list.filter(t => t.project === "Inbox");
    else if(currentView === "today") list = list.filter(t => t.due_date && (isToday(t.due_date) || isOverdue(t.due_date)));
    else if(currentView === "upcoming"){
      list = list.filter(t => isFuture(t.due_date));
      list.sort((a,b) => a.due_date.localeCompare(b.due_date));
    }
    else if(currentView.startsWith("label:")) list = list.filter(t => (t.chosen_labels || []).includes(currentView.slice(6)));
    else if(currentView.startsWith("filter:")){
      const f = filterById(currentView.slice(7));
      list = f ? list.filter(t => fqEval(fqAst(f.query), t)) : [];
    }
    else if(currentView.startsWith("project:")) list = list.filter(t => t.project === currentView.slice(8));
  }
  if(searchQuery){
    const q = searchQuery.toLowerCase();
    list = list.filter(t => {
      const parts = [
        t.text || "",
        t.description || "",
        (t.chosen_labels || []).join(" "),
        t.project || "",
        t.section || "",
        (t.subtasks || []).map(s => `${s.text || ""} ${s.description || ""}`).join(" "),
        (t.comments || []).map(c => c.content || "").join(" "),
      ];
      return parts.join(" ").toLowerCase().includes(q);
    });
  }
  return list;
}
function projectCount(p){
  // Match Todoist: count incomplete top-level tasks plus their incomplete sub-tasks.
  return state.filter(t => t.project === p && !t.completed)
    .reduce((n, t) => n + 1 + (t.subtasks || []).filter(s => !s.done).length, 0);
}

/* ============ VIEW MODE TOGGLE ============ */
function toggleViewMode(){
  viewMode = viewMode === "board" ? "list" : "board";
  try { localStorage.setItem("viewMode", viewMode); } catch(e){}
  render();
}

/* ============ MANUAL REFRESH ============ */
async function manualRefresh(){
  const btn = document.getElementById("refresh-btn");
  if(btn) btn.classList.add("busy");
  try {
    await post("/api/refresh", {});
  } finally {
    if(btn) btn.classList.remove("busy");
  }
}

/* ============ SEARCH ============ */
function onSearch(v){
  searchQuery = (v || "").trim();
  const input = document.getElementById("search-input");
  if(input) input.classList.toggle("has", !!searchQuery);
  render();
}
function focusSearch(){
  const input = document.getElementById("search-input");
  if(input){ input.focus(); input.select(); }
}

