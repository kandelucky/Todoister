/* ============ SECTIONS ============ */
// Inline "Add section" — Todoist-style: an input + Add/Cancel where the trigger was.
function renderAddSectionForm(proj, after){
  return `<div class="add-section-form" data-after="${esc(after)}">
    <input type="text" id="is-name" placeholder="${tr("section.name_ph")}"
      oninput="refreshSecBtn()" onkeydown="handleSectionKey(event)" autocomplete="off">
    <div class="form-buttons">
      <button class="btn-primary" id="is-add-btn" onclick="submitAddSection()" disabled>${tr("section.add_btn")}</button>
      <button class="btn-secondary" onclick="cancelAddSection()">${tr("common.cancel")}</button>
    </div>
  </div>`;
}
function startAddSection(proj, after){
  inlineSection = {proj, after};
  render();
  setTimeout(()=>{ const i = document.getElementById("is-name"); if(i) i.focus(); }, 0);
}
function cancelAddSection(){ inlineSection = null; render(); }
function refreshSecBtn(){
  const i = document.getElementById("is-name");
  const b = document.getElementById("is-add-btn");
  if(i && b) b.disabled = !i.value.trim();
}
function handleSectionKey(e){
  if(e.key === "Enter"){ e.preventDefault(); submitAddSection(); }
  if(e.key === "Escape") cancelAddSection();
}
function submitAddSection(){
  if(!inlineSection) return;
  const i = document.getElementById("is-name");
  const name = i ? i.value.trim() : "";
  if(!name){ return; }
  const proj = inlineSection.proj, after = inlineSection.after;
  const body = {project:proj, name};
  if(after && after !== "__end__") body.after = after;
  inlineSection = null;
  post("/api/section_add", body);
}
function openSectionMenu(ev, proj, name){
  ev.stopPropagation();
  const m = document.getElementById("ctx-menu");
  m.innerHTML = `
    <div class="ctx-mi" onclick="startRenameSection('${esc(proj)}','${esc(name)}'); closeCtx()"><span class="ctx-ico">${SVG.edit}</span><span class="label">${tr("section.rename")}</span></div>
    <div class="ctx-sep"></div>
    <div class="ctx-mi del" onclick="deleteSection('${esc(proj)}','${esc(name)}'); closeCtx()"><span class="ctx-ico">${SVG.trash}</span><span class="label">${tr("section.delete")}</span></div>`;
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}
// Inline section rename (Todoist-style: the header title becomes an input).
function sectionTitleHtml(proj, name){
  if(inlineRename && inlineRename.proj === proj && inlineRename.name === name){
    return `<input class="sec-rename-input" id="sec-rename-input" type="text" value="${esc(name)}"
      onkeydown="handleRenameKey(event)" onblur="submitRename()" autocomplete="off">`;
  }
  return `<button onclick="startRenameSection('${esc(proj)}','${esc(name)}')">${esc(name)}</button>`;
}
function startRenameSection(proj, name){
  inlineRename = {proj, name};
  render();
  setTimeout(()=>{ const i = document.getElementById("sec-rename-input"); if(i){ i.focus(); i.select(); } }, 0);
}
function cancelRename(){ inlineRename = null; render(); }
function handleRenameKey(e){
  if(e.key === "Enter"){ e.preventDefault(); e.target.blur(); }
  if(e.key === "Escape"){ e.preventDefault(); cancelRename(); }
}
function submitRename(){
  if(!inlineRename) return;
  const i = document.getElementById("sec-rename-input");
  const proj = inlineRename.proj, oldName = inlineRename.name;
  const v = i ? i.value.trim() : "";
  inlineRename = null;
  if(v && v !== oldName) post("/api/section_rename", {project:proj, old:oldName, new:v});
  else render();
}
async function deleteSection(proj, name){
  if(!await uiConfirm({title: tr("section.delete_title"), body: tr("section.delete_confirm", {name}), ok: tr("common.delete")})) return;
  post("/api/section_delete", {project:proj, name});
}

/* ============ HELP & RESOURCES ============ */
// Mirrors Todoist's Help & resources menu. Items with a real URL open it;
// the rest (in-app actions, e.g. keyboard shortcuts) are shown but inactive.
const HELP_ITEMS = [
  {key:"help.center",          icon:"help",      url:"https://todoist.com/help"},
  {key:"help.getting_started", icon:"list",      guide:true},
  {key:"help.inspiration",     icon:"lightbulb", url:"https://todoist.com/inspiration"},
  {key:"help.youtube",         icon:"play",      url:"https://www.youtube.com/@todoist"},
  {key:"help.newsletter",      icon:"bell",      url:"https://todoist.substack.com/subscribe"},
  {key:"help.templates",       icon:"copy",      url:"https://app.todoist.com/app/templates"},
  {key:"help.integrations",    icon:"puzzle",    url:"https://app.todoist.com/app/settings/integrations"},
  {key:"help.shortcuts",       icon:"keyboard",  action:"shortcuts"},
  {key:"help.download",        icon:"arrowDown", url:"https://todoist.com/downloads"},
];
function openHelpMenu(ev){
  ev.stopPropagation();
  const m = document.getElementById("ctx-menu");
  const todoisterItem =
    `<div class="ctx-mi" onclick="openTodoisterSubmenu(event)" onmouseenter="openTodoisterSubmenu(event)">` +
      `<span class="ctx-ico">${SVG.book}</span>` +
      `<span class="label">${tr("help.todoister")}</span>` +
      `<span class="kbd">›</span></div>` +
    `<div class="ctx-sep"></div>`;
  m.innerHTML = todoisterItem + HELP_ITEMS.map(it => {
    const ico = `<span class="ctx-ico">${SVG[it.icon] || ""}</span>`;
    const lbl = `<span class="label">${tr(it.key)}</span>`;
    if(it.guide) return `<div class="ctx-mi" onclick="closeCtx(); openGuide()">${ico}${lbl}</div>`;
    if(it.action === "shortcuts") return `<div class="ctx-mi" onclick="closeCtx(); openShortcuts()">${ico}${lbl}</div>`;
    return it.url
      ? `<a class="ctx-mi" href="${it.url}" target="_blank" rel="noopener" onclick="closeCtx()">${ico}${lbl}</a>`
      : `<div class="ctx-mi disabled">${ico}${lbl}</div>`;
  }).join("");
  // open above the trigger, left-aligned (sidebar bottom)
  m.classList.add("show");
  const mw = m.offsetWidth || 240, mh = m.offsetHeight || 360;
  const r = ev.currentTarget.getBoundingClientRect();
  m.style.left = Math.min(r.left, window.innerWidth - mw - 8) + "px";
  m.style.top = Math.max(8, r.top - mh - 4) + "px";
}
// This program's own help — a separate menu beside Todoist's Help & resources.
const HELP_TOPICS = [
  {key:"help.t_program",  icon:"book",     topic:"program"},
  {key:"help.t_sync",     icon:"refresh",  topic:"sync"},
  {key:"help.t_agent",    icon:"sparkles", topic:"agent"},
  {key:"help.t_notes",    icon:"message",  topic:"notes"},
  {key:"help.t_buddy",    icon:"paw",      topic:"buddy"},
  {sep:true},
  {key:"help.t_calendar",        icon:"calendar", topic:"calendar"},
  {key:"help.t_calendar_simple", icon:"cloud",    topic:"calendar-simple"},
  {key:"help.t_calendar_full",   icon:"refresh",  topic:"calendar-full"},
];
function openTodoisterSubmenu(ev){
  ev.stopPropagation();
  const sm = document.getElementById("ctx-submenu");
  sm.innerHTML = HELP_TOPICS.map(it => {
    if(it.sep) return `<div class="ctx-sep"></div>`;
    const ico = `<span class="ctx-ico">${SVG[it.icon] || ""}</span>`;
    const lbl = `<span class="label">${tr(it.key)}</span>`;
    return `<div class="ctx-mi" onclick="closeCtx(); openGuide('${it.topic}')">${ico}${lbl}</div>`;
  }).join("");
  const r = ev.currentTarget.getBoundingClientRect();
  sm.classList.add("show");
  sm.style.left = Math.min(r.right + 4, window.innerWidth - 200) + "px";
  sm.style.top = Math.min(r.top, window.innerHeight - sm.offsetHeight - 8) + "px";
}
function openGuide(topic){
  const ov = document.getElementById("guide-overlay");
  const fr = document.getElementById("guide-frame");
  const lang = (window.I18N && I18N.lang) || "en";
  fr.src = "/guide?topic=" + encodeURIComponent(topic || "program") + "&lang=" + lang;
  ov.classList.add("show");
}
function closeGuide(){
  const ov = document.getElementById("guide-overlay");
  ov.classList.remove("show");
  document.getElementById("guide-frame").src = "about:blank";
}

/* ============ KEYBOARD SHORTCUTS (faithful Todoist copy) ============ */
// Tokens: 'then' / 'or' render as connectors, 'sep,' as a separating comma,
// everything else is a key cap. Mirrors Todoist's "?" shortcuts dialog.
const SHORTCUTS = [
  {g:"General", rows:[
    {l:"Open task view",            k:["Enter"]},
    {l:"Select task",               k:["X"]},
    {l:"Select all tasks",          k:["Ctrl","A"]},
    {l:"Move focus up",             k:["↑","or","K"]},
    {l:"Move focus down",           k:["↓","or","J"]},
    {l:"Move focus to the left",    k:["←"]},
    {l:"Move focus to the right",   k:["→"]},
    {l:"Dismiss/cancel",            k:["Esc"]},
    {l:"Undo",                      k:["Z","or","Ctrl","Z"]},
    {l:"Open Quick Find",           k:["Ctrl","K"]},
    {l:"Show keyboard shortcuts",   k:["?"]},
    {l:"Open/close sidebar",        k:["M"]},
    {l:"Collapse/expand view",      k:["Ctrl","Alt","0"]},
  ]},
  {g:"Quick Add", rows:[
    {l:"Add task",                  k:["Q"]},
    {l:"Dictate tasks with Ramble", k:["⇧","Q"]},
    {l:"Pick project",              k:["#"]},
    {l:"Pick section",              k:["/"]},
    {l:"Add assignee",              k:["+"]},
    {l:"Add label",                 k:["@"]},
    {l:"Set priority",              k:["P1","sep,","P2","sep,","P3","sep,","P4"]},
    {l:"Add reminder",              k:["!"]},
  ]},
  {g:"Navigate", rows:[
    {l:"Go to home",                k:["G","then","H","or","H"]},
    {l:"Go to Inbox",               k:["G","then","I"]},
    {l:"Go to Today",               k:["G","then","T"]},
    {l:"Go to Upcoming",            k:["G","then","U"]},
    {l:"Go to Filters & Labels",    k:["G","then","V"]},
    {l:"Go to reporting",           k:["G","then","A"]},
    {l:"Open project…",             k:["G","then","P"]},
    {l:"Open section…",             k:["G","then","/"]},
    {l:"Open label…",               k:["G","then","L"]},
    {l:"Open task in its project",  k:["⇧","G"]},
    {l:"Open Productivity",         k:["O","then","P"]},
    {l:"Open notifications",        k:["O","then","N"]},
    {l:"Open user menu",            k:["O","then","U"]},
    {l:"Open settings",             k:["O","then","S"]},
    {l:"Open themes",               k:["O","then","T"]},
  ]},
  {g:"Edit task", rows:[
    {l:"Edit task",                 k:["Ctrl","E"]},
    {l:"Complete focused task",     k:["E"]},
    {l:"Comment on task",           k:["C"]},
    {l:"Set date…",                 k:["T"]},
    {l:"Remove date",               k:["⇧","T"]},
    {l:"Set deadline…",             k:["D"]},
    {l:"Remove deadline",           k:["⇧","D"]},
    {l:"Set priority…",             k:["Y"]},
    {l:"Assign to…",                k:["⇧","R"]},
    {l:"Change labels",             k:["L"]},
    {l:"Move to…",                  k:["V"]},
    {l:"Delete task permanently…",  k:["⇧","Delete"]},
    {l:"Copy link to task",         k:["⇧","Ctrl","C"]},
    {l:"More actions",              k:[".","or","⇧","."]},
    {l:"Move to and edit the task below", k:["Ctrl","↓"]},
    {l:"Move to and edit the task above", k:["Ctrl","↑"]},
    {l:"Move focus to multi-select toolbar", k:[","]},
  ]},
  {g:"Add task", rows:[
    {l:"Add new task to the bottom of the list", k:["A"]},
    {l:"Add new task to the top of the list",    k:["⇧","A"]},
    {l:"Save new task and create another one below", k:["Enter"]},
    {l:"Save task and create another one below", k:["⇧","Enter"]},
    {l:"Save task and create another one above", k:["Ctrl","Enter"]},
  ]},
  {g:"Sub-task", rows:[
    {l:"Expand/collapse task",        k:["⇧","E"]},
    {l:"Increase indent of selected task", k:["Ctrl","]"]},
    {l:"Decrease indent of selected task", k:["Ctrl","["]},
  ]},
  {g:"Projects", rows:[
    {l:"Add project",               k:["Alt","P"]},
    {l:"Add section",               k:["S"]},
    {l:"Share project",             k:["⇧","S"]},
    {l:"Change layout & view",      k:["⇧","V"]},
    {l:"Sort by date",              k:["D"]},
    {l:"Sort by priority",          k:["P"]},
    {l:"Sort alphabetically",       k:["N"]},
    {l:"Sort by assignee",          k:["R"]},
    {l:"More actions",              k:["W"]},
  ]},
  {g:"Calendar and Upcoming views", rows:[
    {l:"Go back to today",          k:["T","or","Alt","⇧","Y"]},
    {l:"Go to next week/month",     k:["⇧","→"]},
    {l:"Go to previous week/month", k:["⇧","←"]},
    {l:"Scroll up in week view",    k:["↑"]},
    {l:"Scroll down in week view",  k:["↓"]},
  ]},
];
function ksKeys(keys){
  return keys.map(t =>
    (t === "then" || t === "or") ? `<span class="ks-conn">${t}</span>`
    : t === "sep," ? `<span class="ks-conn">,</span>`
    : `<span class="cmdk-kbd">${esc(t)}</span>`
  ).join("");
}
function openShortcuts(){
  const body = document.getElementById("ks-body");
  body.innerHTML = SHORTCUTS.map(s =>
    `<div class="ks-group"><div class="ks-gtitle">${esc(s.g)}</div>` +
    s.rows.map(r =>
      `<div class="ks-row"><span class="ks-label">${esc(r.l)}</span>` +
      `<span class="ks-keys">${ksKeys(r.k)}</span></div>`).join("") +
    `</div>`
  ).join("");
  const t = document.getElementById("ks-title");
  if(t) t.textContent = tr("help.shortcuts");
  document.getElementById("ks-overlay").classList.add("show");
}
function closeShortcuts(){ document.getElementById("ks-overlay").classList.remove("show"); }
function shortcutsOpen(){ return document.getElementById("ks-overlay").classList.contains("show"); }

/* ============ TASK ACTIONS ============ */
function completeTask(id){
  const t = T(id); if(!t) return;
  const wasDone = t.completed;
  upd(id, "completed", !t.completed);  // through upd() so undo/redo records it
  if(!wasDone){
    // Completing (not un-completing): a small congratulatory toast. For a recurring
    // task, surface that it comes back — Todoist shows the next occurrence; we show
    // the pattern (repeatLabel), which we already have locally. Undo stays available.
    const sub = (t.due_is_recurring && t.due_string)
      ? tr("toast.done_repeats", {when: repeatLabel(t.due_string)}) : "";
    showToast({title: tr("toast.done_title"), sub}, null, 4000,
      {label: tr("undo.undo_btn"), fn: doUndoMain});
    // Buddy earns from finished work — the only XP source in the app.
    // Flat base, plus a bonus when the task was closed by its due date. The
    // priority link is gone on purpose: P1 pays the *label*, and Lasha sets
    // that label himself, so a paid priority slowly stops meaning "urgent" —
    // a data-quality problem, since the agent panel triages by priority. A due
    // date closed on time is the behaviour this app exists to produce, so here
    // the shortcut and the goal are the same act and it needs no defence.
    // ❗ Base + bonus, never a penalty. Late must not pay less than fresh —
    // closing an overdue task is the hardest thing this app asks for. Undated
    // must not pay less either, or Inbox capture turns into compulsory dating.
    // ❗ Un-completing does NOT take the XP back: an undo should not punish.
    if (window.Buddy) window.Buddy.addXP(BUDDY_XP_BASE + (buddyOnTime(t) ? BUDDY_XP_ON_TIME : 0));
  }
}
const BUDDY_XP_BASE = 20;      // every finished task, whatever it is
const BUDDY_XP_ON_TIME = 10;   // ...and this on top when its date had not passed
// Undated tasks are not "on time" — they simply take the base, no penalty.
function buddyOnTime(t){ return !!t.due_date && !isOverdue(t.due_date); }
function toggleLabel(id, lbl){
  const t = T(id); const arr = [...(t.chosen_labels||[])];
  const i = arr.indexOf(lbl);
  if(i>=0) arr.splice(i,1); else arr.push(lbl);
  upd(id, "chosen_labels", arr);  // upd sets local state + records undo
  renderModal();
}
function toggleSub(id, idx, done){ post("/api/subtask_toggle", {id, idx, done}).then(renderModal); }
function delSub(id, idx){ post("/api/subtask_del", {id, idx}).then(renderModal); }
function startSubAdd(id){
  subAddFor = id; renderModal();
  setTimeout(()=>{ const i = document.getElementById("sub-add-input"); if(i) i.focus(); }, 0);
}
function cancelSubAdd(){ subAddFor = null; renderModal(); }
function handleSubAddKey(e, id){
  if(e.key === "Enter"){ e.preventDefault(); submitSubAdd(id); }
  if(e.key === "Escape") cancelSubAdd();
}
async function submitSubAdd(id){
  const input = document.getElementById("sub-add-input");
  const v = (input && input.value.trim()) || "";
  if(!v){ cancelSubAdd(); return; }
  subAddFor = null;
  await post("/api/subtask_add", {id, text:v});
}
function quickDate(id, kind){
  const d = new Date();
  if(kind==='tomorrow') d.setDate(d.getDate()+1);
  else if(kind==='nextweek') d.setDate(d.getDate()+((8-d.getDay())%7||7));
  else if(kind==='weekend') d.setDate(d.getDate()+((6-d.getDay()+7)%7||7));
  upd(id, 'due_date', iso(d));
  if(modalTaskId === id) renderModal();
}

/* ============ NAV ============ */
function setView(v){
  if(v === "projects-page") showArchivedProjects = false;
  if(v === "completed") reporting = { cursor:null, loaded:false, loading:false, error:"" };
  // Remember where the user came from so the calendar's "List" side can go back.
  if(v === "calendar" && currentView !== "calendar" && lcIsListView(currentView)) calReturnView = currentView;
  currentView = v;
  closeModal();
  inlineAdd = null;
  render();
}
/* List / Calendar header switch (version D) */
let calReturnView = "today";
function lcIsListView(v){
  return v === "inbox" || v === "today" || v === "upcoming"
    || v.startsWith("project:") || v.startsWith("label:") || v.startsWith("filter:");
}
function lcGoCal(){ if(currentView !== "calendar") setView("calendar"); }
function lcGoList(){ if(currentView === "calendar") setView(calReturnView || "today"); }
function toggleProjects(){
  projectsCollapsed = !projectsCollapsed;
  document.getElementById("projects_list").className = projectsCollapsed ? "collapsed" : "";
  document.getElementById("projects-toggle").textContent = projectsCollapsed ? "▸" : "▾";
}

/* ============ CTX MENU ============ */
function openTaskCtxMenu(ev, id, fromModal){
  ev.stopPropagation();
  const t = T(id); if(!t) return;
  const m = document.getElementById("ctx-menu");

  let items = "";
  // sticky note first — pin / unpin with distinct icons (Lasha 2026-08-16)
  items += `<div class="ctx-mi" onclick="toggleSticky('${id}'); closeCtx()"><span class="ctx-ico">${t.sticky ? SVG.pinOff : SVG.pin}</span><span class="label">${t.sticky ? tr("sticky.unmake") : tr("sticky.make")}</span></div>`;
  items += `<div class="ctx-sep"></div>`;
  if(!fromModal){
    items += `<div class="ctx-mi" onclick="addAdjacent('${id}','above'); closeCtx()"><span class="ctx-ico">${SVG.arrowUp}</span><span class="label">${tr("ctx.add_above")}</span></div>`;
    items += `<div class="ctx-mi" onclick="addAdjacent('${id}','below'); closeCtx()"><span class="ctx-ico">${SVG.arrowDown}</span><span class="label">${tr("ctx.add_below")}</span></div>`;
    items += `<div class="ctx-sep"></div>`;
  }
  items += `<div class="ctx-mi" onclick="openModal('${id}'); closeCtx()"><span class="ctx-ico">${SVG.edit}</span><span class="label">${tr("ctx.edit")}</span><span class="kbd">E</span></div>`;
  items += `<div class="ctx-sep"></div>`;
  items += `<div class="ctx-section-row">${tr("modal.date")}</div>
    <div class="ctx-picks">
      <button class="ctx-pick" onclick="quickDate('${id}','today'); closeCtx()"><span class="cp-ico c-today">${SVG.calendar}</span>${tr("date.today")}</button>
      <button class="ctx-pick" onclick="quickDate('${id}','tomorrow'); closeCtx()"><span class="cp-ico c-tom">${SVG.sun}</span>${tr("date.tomorrow")}</button>
      <button class="ctx-pick" onclick="quickDate('${id}','weekend'); closeCtx()"><span class="cp-ico c-wk">${SVG.couch}</span>${tr("date.weekend")}</button>
      <button class="ctx-pick" onclick="quickDate('${id}','nextweek'); closeCtx()"><span class="cp-ico c-nw">${SVG.chevronsRight}</span>${tr("date.next_week")}</button>
    </div>`;
  items += `<div class="ctx-section-row">${tr("modal.priority")}</div>
    <div class="ctx-picks">
      <button class="ctx-pick p1" onclick="upd('${id}','priority','P1'); closeCtx()"><span class="cp-ico">${SVG.flagFill}</span>P1</button>
      <button class="ctx-pick p2" onclick="upd('${id}','priority','P2'); closeCtx()"><span class="cp-ico">${SVG.flagFill}</span>P2</button>
      <button class="ctx-pick p3" onclick="upd('${id}','priority','P3'); closeCtx()"><span class="cp-ico">${SVG.flagFill}</span>P3</button>
      <button class="ctx-pick" onclick="upd('${id}','priority','P4'); closeCtx()"><span class="cp-ico">${SVG.flag}</span>P4</button>
    </div>`;
  items += `<div class="ctx-sep"></div>`;
  items += `<div class="ctx-mi" onclick="openMoveSubmenu(event,'${id}')"><span class="ctx-ico">${SVG.moveRight}</span><span class="label">${tr("ctx.move_to")}</span><span class="kbd">V</span></div>`;
  items += `<div class="ctx-mi" onclick="duplicateTask('${id}'); closeCtx()"><span class="ctx-ico">${SVG.copy}</span><span class="label">${tr("ctx.duplicate")}</span></div>`;
  items += `<div class="ctx-sep"></div>`;
  items += `<div class="ctx-mi del" onclick="deleteTask('${id}'); closeCtx()"><span class="ctx-ico">${SVG.trash}</span><span class="label">${tr("common.delete")}</span></div>`;

  m.innerHTML = items;
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}
function positionCtx(m, r){
  m.classList.add("show");
  const mw = m.offsetWidth || 240;
  const mh = m.offsetHeight || 400;
  m.style.left = Math.min(r.right, window.innerWidth - mw - 8) + "px";
  m.style.top = Math.min(r.bottom + 4, window.innerHeight - mh - 8) + "px";
}
function closeCtx(){
  document.getElementById("ctx-menu").classList.remove("show");
  document.getElementById("ctx-submenu").classList.remove("show");
}
function openMoveSubmenu(ev, id){
  ev.stopPropagation();
  const sm = document.getElementById("ctx-submenu");
  sm.innerHTML = projects.map(p => `<div class="ctx-mi" onclick="upd('${id}','project','${esc(p)}'); closeCtx()"><span class="label">${esc(p)}</span></div>`).join("");
  const r = ev.currentTarget.getBoundingClientRect();
  sm.classList.add("show");
  sm.style.left = Math.min(r.right + 4, window.innerWidth - 200) + "px";
  sm.style.top = Math.min(r.top, window.innerHeight - sm.offsetHeight - 8) + "px";
}
