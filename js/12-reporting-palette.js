/* ============ REPORTING (completed tasks) ============ */
let reporting = { cursor:null, loaded:false, loading:false, error:"" };
function completedTasks(){
  return state.filter(t => t.completed)
    .slice()
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
}
const EXPORT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

function renderReporting(row){
  const controls = `<div class="rep-controls">
      <button class="rep-filter" disabled>${tr("rep.all_workspaces")}<span class="rep-caret">${SVG.chevronDown}</span></button>
      <button class="rep-filter" disabled>${tr("rep.all_projects")}<span class="rep-caret">${SVG.chevronDown}</span></button>
      <button class="rep-filter" disabled>${tr("rep.everyone")}<span class="rep-caret">${SVG.chevronDown}</span></button>
      <span class="rep-tab active">${tr("rep.completed_tab")}</span>
      <span class="rep-tab disabled">${tr("rep.any_date")}</span>
    </div>`;
  row.innerHTML = `<div class="reporting-page">
      <div class="rep-head">
        <h2 class="rep-title">${tr("rep.title")}</h2>
        <button class="rep-export" disabled title="${esc(tr('rep.export_pro'))}"><span class="rep-ico">${EXPORT_ICON}</span>${tr("rep.export")}</button>
      </div>
      ${controls}
      <div id="reporting-body">${reportingBodyHtml()}</div>
    </div>`;
  paintRepAvatars(row);
  if(!reporting.loaded && !reporting.loading) loadReporting();
}

function reportingBodyHtml(){
  const items = completedTasks();
  if(!items.length){
    if(reporting.loading) return `<div class="rep-info">${tr("rep.loading")}</div>`;
    if(reporting.error) return `<div class="rep-info">${tr("rep.error")}</div>`;
    return `<div class="rep-info">${tr("rep.empty")}</div>`;
  }
  const groups = [];
  const idx = {};
  for(const it of items){
    const key = repDayKey(it.completed_at);
    if(!(key in idx)){ idx[key] = groups.length; groups.push({ label: repDayLabel(it.completed_at), items: [] }); }
    groups[idx[key]].items.push(it);
  }
  let html = groups.map(g => `<section class="rep-group">
      <header class="rep-group-head">
        <span class="rep-group-date">${esc(g.label)}</span>
        <span class="rep-group-count">${g.items.length}</span>
      </header>
      <ul class="rep-events">${g.items.map(repEventHtml).join("")}</ul>
    </section>`).join("");
  if(reporting.cursor){
    html += `<button class="rep-more" onclick="loadReporting()">${reporting.loading ? tr("rep.loading") : tr("rep.load_more")}</button>`;
  } else {
    html += `<div class="rep-end">${tr("rep.thats_it")}</div>`;
  }
  return html;
}

function repEventHtml(t){
  const color = (projectMeta[t.project] || {}).color;
  const proj = t.project ? `<span class="rep-proj"><span class="rep-proj-dot" style="background:${TODOIST_COLORS[color] || 'var(--text-3)'}"></span>${esc(t.project)}</span>` : "";
  return `<li class="rep-event" onclick="openModal('${esc(t.id)}')">
    <span class="user-avatar rep-avatar" data-rep-avatar="1"></span>
    <span class="rep-text"><span class="rep-who">${tr("rep.you")}</span> ${tr("rep.completed_verb")} <span class="rep-task">${esc(t.text || "")}</span></span>
    ${proj}
    <span class="rep-time" title="${esc(t.completed_at)}">${esc(repTime(t.completed_at))}</span>
  </li>`;
}

async function loadReporting(){
  if(reporting.loading) return;
  reporting.loading = true;
  reporting.error = "";
  refreshReportingBody();
  try{
    const url = "/api/completed" + (reporting.cursor ? ("?cursor=" + encodeURIComponent(reporting.cursor)) : "");
    const d = await (await fetch(url)).json();
    if(d.error) reporting.error = d.error;
    reporting.cursor = d.next_cursor || null;
    reporting.loaded = true;
  }catch(e){
    reporting.error = String(e);
  }
  reporting.loading = false;
  // The fetched completed tasks were mirrored into the DB; pull them into local
  // state so the list (and the task modal) can use them. fetchState re-renders.
  await fetchState();
}

function refreshReportingBody(){
  if(currentView !== "completed") return;
  const b = document.getElementById("reporting-body");
  if(b){ b.innerHTML = reportingBodyHtml(); paintRepAvatars(b); }
}

function paintRepAvatars(scope){
  (scope || document).querySelectorAll("[data-rep-avatar]").forEach(el => { el.removeAttribute("data-rep-avatar"); paintAvatar(el); });
}

function repLocale(){ return (window.I18N && I18N.lang === "ka") ? "ka-GE" : "en-US"; }
function repSameDay(a, b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function repDayKey(iso){ const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function repDayLabel(iso){
  const d = new Date(iso), now = new Date(), yest = new Date(); yest.setDate(now.getDate()-1);
  const loc = repLocale();
  const day = d.getDate();
  const month = d.toLocaleDateString(loc, { month: "short" });
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  let mid = "";
  if(repSameDay(d, now)) mid = ` ‧ ${tr("rep.today")}`;
  else if(repSameDay(d, yest)) mid = ` ‧ ${tr("rep.yesterday")}`;
  return `${day} ${month}${mid} ‧ ${weekday}`;
}

function repTime(iso){
  const d = new Date(iso), sec = (Date.now() - d.getTime())/1000;
  if(sec < 60) return tr("rep.just_now");
  if(sec < 3600) return tr("rep.min_ago", { n: Math.floor(sec/60) });
  if(sec < 86400) return tr("rep.hr_ago", { n: Math.floor(sec/3600) });
  const loc = repLocale();
  const day = d.getDate(), month = d.toLocaleDateString(loc, { month: "short" }), yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2,"0"), mm = String(d.getMinutes()).padStart(2,"0");
  return `${day} ${month} ${yr} ${hh}:${mm}`;
}

/* ---- Filter dialog (add / edit) — reuses the project-dialog shell ---- */
let filterDialog = null;  // {mode:'add'|'edit', id, name, query, color}
function openFilterDialog(mode, id){
  if(mode === "edit"){
    const f = filterById(id) || {};
    filterDialog = {mode, id, name: f.name || "", query: f.query || "", color: f.color || "charcoal"};
  } else {
    filterDialog = {mode:"add", id:null, name:"", query:"", color:"charcoal"};
  }
  renderFilterDialog();
  document.getElementById("proj-dialog-backdrop").classList.add("show");
  setTimeout(() => { const i = document.getElementById("fd-name"); if(i){ i.focus(); i.select(); } }, 30);
}
function renderFilterDialog(){
  const d = filterDialog; if(!d) return;
  const title = d.mode === "edit" ? tr("fl.edit_title") : tr("fl.add_title");
  const okText = d.mode === "edit" ? tr("common.save") : tr("common.add");
  const swatches = PROJECT_COLORS.map(c =>
    `<span class="pd-sw${c===d.color?' sel':''}" style="background:${TODOIST_COLORS[c]}" title="${c.replace(/_/g,' ')}" onclick="selectFilterColor('${c}')">${SVG.check}</span>`
  ).join("");
  document.getElementById("proj-dialog").innerHTML = `
    <div class="pd-head">${title}</div>
    <div class="pd-body">
      <label class="pd-label" for="fd-name">${tr("fl.name_label")}</label>
      <input id="fd-name" class="pd-input" type="text" value="${esc(d.name)}" maxlength="120"
             placeholder="${tr("fl.name_ph")}" oninput="onFilterNameInput(this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault(); document.getElementById('fd-query').focus();} else if(event.key==='Escape'){closeFilterDialog();}">
      <label class="pd-label" for="fd-query">${tr("fl.query_label")}</label>
      <input id="fd-query" class="pd-input fd-query" type="text" value="${esc(d.query)}"
             placeholder="${tr("fl.query_ph")}" oninput="filterDialog.query=this.value"
             onkeydown="if(event.key==='Enter'){event.preventDefault(); submitFilterDialog();} else if(event.key==='Escape'){closeFilterDialog();}">
      <div class="fd-hint">${tr("fl.query_hint")}</div>
      <label class="pd-label">${tr("proj.color_label")} <span class="pd-cname" id="fd-cname">${(d.color||'').replace(/_/g,' ')}</span></label>
      <div class="pd-swatches">${swatches}</div>
    </div>
    <div class="pd-foot">
      <button class="pd-btn cancel" onclick="closeFilterDialog()">${tr("common.cancel")}</button>
      <button class="pd-btn primary" id="fd-ok" onclick="submitFilterDialog()" ${d.name.trim()?'':'disabled'}>${okText}</button>
    </div>`;
}
function onFilterNameInput(v){
  filterDialog.name = v;
  const ok = document.getElementById("fd-ok");
  if(ok) ok.disabled = !v.trim();
}
function selectFilterColor(c){
  filterDialog.color = c;
  const sw = [...document.querySelectorAll("#proj-dialog .pd-sw")];
  PROJECT_COLORS.forEach((cc,i) => { if(sw[i]) sw[i].classList.toggle("sel", cc===c); });
  const cn = document.getElementById("fd-cname"); if(cn) cn.textContent = c.replace(/_/g,' ');
}
function closeFilterDialog(){
  document.getElementById("proj-dialog-backdrop").classList.remove("show");
  filterDialog = null;
}
function submitFilterDialog(){
  const d = filterDialog; if(!d) return;
  const nm = (d.name||"").trim();
  if(!nm) return;
  _fqCache = {};  // a query may have changed — drop the parsed-AST cache
  if(d.mode === "edit"){
    post("/api/filter_update", {id: d.id, name: nm, query: d.query || "", color: d.color});
  } else {
    post("/api/filter_add", {name: nm, query: d.query || "", color: d.color});
  }
  closeFilterDialog();
}
function openFilterMenu(ev, id){
  ev.stopPropagation();
  const f = filterById(id) || {};
  const moveItem = f.is_synced
    ? `<div class="ctx-mi" onclick="filterUnsync('${esc(id)}'); closeCtx()"><span class="ctx-ico">${SVG.cloudOff}</span><span class="label">${tr("fl.make_local")}</span></div>`
    : `<div class="ctx-mi" onclick="filterSync('${esc(id)}'); closeCtx()"><span class="ctx-ico">${SVG.cloud}</span><span class="label">${tr("fl.sync_to_todoist")}</span></div>`;
  const m = document.getElementById("ctx-menu");
  m.innerHTML =
    `<div class="ctx-mi" onclick="openFilterDialog('edit','${esc(id)}'); closeCtx()"><span class="ctx-ico">${SVG.edit}</span><span class="label">${tr("section.rename")}</span></div>`
    + moveItem
    + `<div class="ctx-sep"></div>`
    + `<div class="ctx-mi del" onclick="confirmDeleteFilter('${esc(id)}'); closeCtx()"><span class="ctx-ico">${SVG.trash}</span><span class="label">${tr("common.delete")}</span></div>`;
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}
// ⋯ in the filter view header — reuse the row menu for the current filter
function openFilterOptsMenu(ev){
  if(!currentView.startsWith("filter:")) return;
  openFilterMenu(ev, currentView.slice(7));
}
function filterSync(id){
  if(filters.filter(f => f.is_synced).length >= FILTER_LIMIT){
    showToast(tr("fl.sync_limit", {n: FILTER_LIMIT}), "error");
    return;
  }
  post("/api/filter_sync", {id});
}
function filterUnsync(id){ post("/api/filter_unsync", {id}); }

/* ---- Display options (group / sort) for filter & label views ---- */
let filterDisplay = (() => { try { return JSON.parse(localStorage.getItem("filterDisplay")) || {}; } catch(e){ return {}; } })();
filterDisplay.group = filterDisplay.group || "none";
filterDisplay.sort  = filterDisplay.sort  || "manual";
function saveDisplay(){ try { localStorage.setItem("filterDisplay", JSON.stringify(filterDisplay)); } catch(e){} }
function isDisplayView(){ return currentView.startsWith("filter:") || currentView.startsWith("label:"); }
const DISP_GROUPS = ["none","date","priority","project"];
const DISP_SORTS  = ["manual","priority","date","name"];
function displayMenuHtml(){
  const opt = (kind, val) =>
    `<div class="disp-opt${filterDisplay[kind]===val?' sel':''}" onclick="event.stopPropagation(); setDisplay('${kind}','${val}')">`
    + `<span class="disp-check">${SVG.check}</span><span>${tr("disp."+kind+"_"+val)}</span></div>`;
  return `<div class="disp-row">${tr("disp.group")}</div>` + DISP_GROUPS.map(g => opt("group", g)).join("")
       + `<div class="disp-row">${tr("disp.sort")}</div>` + DISP_SORTS.map(s => opt("sort", s)).join("");
}
function openDisplayMenu(ev){
  ev.stopPropagation();
  const m = document.getElementById("ctx-menu");
  m.innerHTML = displayMenuHtml();
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}
function setDisplay(kind, val){
  filterDisplay[kind] = val; saveDisplay();
  const m = document.getElementById("ctx-menu");
  if(m && m.classList.contains("show")) m.innerHTML = displayMenuHtml();  // keep menu open
  render();
}
function sortTasks(list){
  const arr = [...list], s = filterDisplay.sort;
  if(s === "priority") arr.sort((a,b) => (a.priority||"P4").localeCompare(b.priority||"P4"));
  else if(s === "date") arr.sort((a,b) => (a.due_date||"9999-99-99").localeCompare(b.due_date||"9999-99-99"));
  else if(s === "name") arr.sort((a,b) => (a.text||"").localeCompare(b.text||""));
  return arr;  // "manual" → unchanged
}
function groupTasks(list){
  const g = filterDisplay.group;
  if(g === "none") return [{label:"", tasks:list}];
  if(g === "priority"){
    return ["P1","P2","P3","P4"].map(p => ({label: tr("prio."+p.toLowerCase()),
      tasks: list.filter(t => (t.priority||"P4") === p)})).filter(x => x.tasks.length);
  }
  const map = new Map(), groups = [];
  const push = (key, label, t) => { if(!map.has(key)){ map.set(key, {key, label, tasks:[]}); groups.push(map.get(key)); } map.get(key).tasks.push(t); };
  if(g === "date"){
    list.forEach(t => {
      if(!t.due_date) push("zz_none", tr("date.no_date"), t);
      else if(isOverdue(t.due_date)) push("00_over", tr("date.overdue"), t);
      else if(isToday(t.due_date)) push("01_today", tr("date.today"), t);
      else push("d_"+t.due_date, t.due_date, t);
    });
    groups.sort((a,b) => a.key.localeCompare(b.key));
  } else if(g === "project"){
    list.forEach(t => push(t.project || "zz", t.project || tr("section.none"), t));
    groups.sort((a,b) => a.label.localeCompare(b.label));
  }
  return groups;
}
// Real Todoist empty-filter illustration, extracted from the reference snapshot.
const FUNNEL_ART = `<img src="/assets/filter-empty.png" alt="" draggable="false">`;
function filterEmptyHtml(){
  if(!currentView.startsWith("filter:")) return `<div class="empty-state">${tr("common.no_tasks")}</div>`;
  return `<div class="filter-empty">
    <div class="fe-center">
      <span class="fe-illus">${FUNNEL_ART}</span>
      <div class="fe-title">${tr("fl.empty_title")}</div>
    </div>
    <span class="fe-link" onclick="openFiltersHelp()">${SVG.help}<span>${tr("fl.empty_tips")}</span></span>
  </div>`;
}
function openFiltersHelp(){ fetch("/open-filters-help").catch(() => {}); }
async function confirmDeleteFilter(id){
  const f = filterById(id); if(!f) return;
  const ok = await uiConfirm({
    title: tr("fl.delete_title"),
    body: tr("fl.delete_body", {name: f.name}),
    ok: tr("common.delete"),
  });
  if(!ok) return;
  if(currentView === "filter:" + id) currentView = "filters";
  post("/api/filter_delete", {id});
}
function renderProjectsPage(row){
  const userProjects = projects.filter(p => p !== INBOX_NAME);
  const head = `
    <div class="pp-toolbar">
      <span class="pp-used">${tr("sidebar.used", {n: userProjects.length, total: PROJECT_LIMIT})}</span>
      <span class="pp-spacer"></span>
      <label class="pp-arch-toggle">
        <input type="checkbox" ${showArchivedProjects ? "checked" : ""} onchange="toggleArchivedView(this.checked)">
        <span>${tr("proj.archived_only")}</span>
      </label>
      <button class="pp-add" onclick="openProjectDialog('add','')">
        <span class="pp-add-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
        ${tr("proj.add_title")}
      </button>
    </div>`;
  let listHtml;
  if(showArchivedProjects){
    listHtml = (archivedProjects && archivedProjects.length)
      ? archivedProjects.map(a => ppRow(a.name, a.color, a.count, true)).join("")
      : `<div class="pp-empty">${tr("proj.no_archived")}</div>`;
  } else {
    const ordered = userProjects.includes(NOTEBOOK_PROJECT)
      ? [NOTEBOOK_PROJECT, ...userProjects.filter(p => p !== NOTEBOOK_PROJECT)]
      : userProjects;
    listHtml = ordered.length
      ? ordered.map(p => ppRow(p, (projectMeta[p] || {}).color, projectCount(p), false)).join("")
      : `<div class="pp-empty">${tr("proj.none")}</div>`;
  }
  row.innerHTML = `<div class="projects-page">${head}<div class="pp-list">${listHtml}</div></div>`;
}
function ppRow(name, color, count, archived){
  const col = TODOIST_COLORS[color] || "var(--text-2)";
  if(archived){
    return `<div class="pp-item">
      <span class="ico" style="color:${col}">${SVG.hash}</span>
      <span class="pp-name">${esc(name)}</span>
      <span class="pp-count">${count || ""}</span>
      <span class="project-actions pp-actions" onclick="openArchivedMenu(event,'${esc(name)}')">${SVG.moreH}</span>
    </div>`;
  }
  if(name === NOTEBOOK_PROJECT){  // pinned, special — notebook icon, no drag; menu = archive/delete only
    return `<div class="pp-item nb-project">
      <span class="ico" style="color:${col}">${SVG.notebook}</span>
      <span class="pp-name" onclick="setView('project:${esc(name)}')">${esc(name)}</span>
      <span class="pp-count">${count || ""}</span>
      <span class="project-actions pp-actions" onclick="openNotebookMenu(event)">${SVG.moreH}</span>
    </div>`;
  }
  return `<div class="pp-item project-item" draggable="true"
      ondragstart="onProjDragStart(event,'${esc(name)}')" ondragend="onProjDragEnd(event)"
      ondragover="onProjDragOver(event)" ondragleave="onProjDragLeave(event)" ondrop="onProjDrop(event,'${esc(name)}')">
    <span class="ico" style="color:${col}">${SVG.hash}</span>
    <span class="pp-name" onclick="setView('project:${esc(name)}')">${esc(name)}</span>
    <span class="pp-count">${count || ""}</span>
    <span class="project-actions pp-actions" onclick="openProjectMenu(event,'${esc(name)}')">${SVG.moreH}</span>
  </div>`;
}
function toggleArchivedView(on){ showArchivedProjects = on; render(); }
function openArchivedMenu(ev, name){
  ev.stopPropagation();
  const m = document.getElementById("ctx-menu");
  m.innerHTML =
    `<div class="ctx-mi proj-mi" onclick="unarchiveProject('${esc(name)}'); closeCtx()"><span class="ctx-ico proj-ico">${PROJ_ICONS.archive}</span><span class="label">${tr("proj.unarchive")}</span></div>`
    + `<div class="ctx-sep proj-sep"></div>`
    + `<div class="ctx-mi proj-mi del" onclick="confirmDeleteProject('${esc(name)}'); closeCtx()"><span class="ctx-ico proj-ico">${PROJ_ICONS.delete}</span><span class="label">${tr("common.delete")}</span></div>`;
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}
function unarchiveProject(name){
  if(userProjectCount() >= PROJECT_LIMIT){
    showToast(tr("proj.limit", {n: PROJECT_LIMIT}), "error");
    return;
  }
  post("/api/project_unarchive", {name});
}

function duplicateTask(id){ post("/api/task_duplicate", {id}); }
async function deleteTask(id){
  const t = T(id);
  const label = (t && t.content) ? t.content : tr("undo.label_delete");
  const d = await post("/api/task_delete", {id});
  if(modalTaskId === id) closeModal();
  const subs = (d && d.deleted_ids) ? d.deleted_ids.filter(x => x !== id) : [];
  recordAction({
    label,
    undo: () => post("/api/task_restore", {id, subs}),
    redo: () => post("/api/task_delete", {id}),
  });
}
function addAdjacent(id, where){
  const t = T(id); if(!t) return;
  post("/api/task_add", {id, where, text:"New task", project:t.project, section:t.section||""});
}

document.addEventListener("click", e=>{
  if(!e.target.closest("#sync-panel") && !e.target.closest("#user-btn")) closeSyncPanel();
  if(!e.target.closest("#ctx-menu") && !e.target.closest("#ctx-submenu") && !e.target.closest(".menu-btn")) closeCtx();
  if(!e.target.closest("#prio-popover") && !e.target.closest("#ia-prio-btn") &&
     !e.target.closest("#more-popover") && !e.target.closest("#ia-more-btn") &&
     !e.target.closest("#labels-popover") && !e.target.closest("#ia-labels-btn") &&
     !e.target.closest("#date-popover") && !e.target.closest("#ia-date-btn") &&
     !e.target.closest("#project-popover") && !e.target.closest("#time-popover") &&
     !e.target.closest("#repeat-popover") &&
     !e.target.closest(".md-val")){
    closeAllPopovers();
  }
  if(!e.target.closest("#rem-pop") && !e.target.closest(".meta-add")){
    closeAddReminder();
  }
});
document.addEventListener("keydown", e=>{
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y → task undo / redo.
  // Use e.code (physical key) so it works on any keyboard layout — on a Georgian layout
  // e.key would be a Georgian letter, not "z"/"y". Skipped while typing in a field so the
  // browser's native text undo still works there.
  if((e.ctrlKey || e.metaKey) && !e.altKey){
    const isZ = e.code === "KeyZ" || e.key.toLowerCase() === "z";
    const isY = e.code === "KeyY" || e.key.toLowerCase() === "y";
    if(isZ || isY){
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if(!typing){
        if(isZ && !e.shiftKey){ e.preventDefault(); doUndoMain(); return; }
        if((isZ && e.shiftKey) || isY){ e.preventDefault(); doRedoMain(); return; }
      }
    }
  }
  // Ctrl+K → command palette (Todoist-style search). e.code for layout independence.
  if((e.ctrlKey || e.metaKey) && (e.code === "KeyK" || e.key.toLowerCase() === "k")){
    e.preventDefault();
    cmdkOpen();
    return;
  }
  // Ctrl+F → focus search
  if((e.ctrlKey || e.metaKey) && (e.code === "KeyF" || e.key.toLowerCase() === "f") && !modalTaskId){
    e.preventDefault();
    focusSearch();
    return;
  }
  // Q → global quick add (Todoist). e.code for layout independence (Georgian layout).
  if(e.code === "KeyQ" && !e.ctrlKey && !e.metaKey && !e.altKey){
    const el = document.activeElement;
    const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    if(!typing && !shortcutsOpen() && !cmdkIsOpen() && !modalTaskId && !inlineAdd){
      e.preventDefault();
      openQuickAdd();
      return;
    }
  }
  // ? → keyboard shortcuts (only when not typing and nothing else is open)
  if(e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey){
    const el = document.activeElement;
    const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    if(!typing && !shortcutsOpen() && !cmdkIsOpen() && !modalTaskId){
      e.preventDefault();
      openShortcuts();
      return;
    }
  }
  if(e.key === "Escape"){
    if(shortcutsOpen()){ closeShortcuts(); return; }
    if(cmdkIsOpen()){ cmdkClose(); return; }
    if(document.getElementById("lightbox").classList.contains("show")){ closeLightbox(); return; }
    if(document.getElementById("confirm-backdrop").classList.contains("show")){ _resolveConfirm(false); return; }
    if(document.getElementById("sync-panel").classList.contains("show")){ closeSyncPanel(); return; }
    if(document.getElementById("ctx-menu").classList.contains("show")){ closeCtx(); return; }
    if(document.getElementById("prio-popover") || document.getElementById("more-popover") ||
       document.getElementById("labels-popover") || document.getElementById("date-popover")){
      closeAllPopovers(); return;
    }
    if(modalTaskId){ closeModal(); return; }
    if(inlineAdd){ cancelInlineAdd(); return; }
    // Esc with focus on search → clear
    if(document.activeElement === document.getElementById("search-input")){
      document.getElementById("search-input").value = "";
      onSearch("");
      document.getElementById("search-input").blur();
    }
  }
});

/* ============ COMMAND PALETTE (Todoist-style search) ============ */
const CMDK_ICON = {
  search:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  circle:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`,
  home:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`,
  inbox:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
  calDays:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>`,
  checkCircle:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  chart:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  layers:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  plusCircle:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  bolt:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  user:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  gear:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  printer:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  sidebar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
  sparkles:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>`,
};

// Commands. run = supported (wired). No run = shown greyed/disabled (faithful copy).
const CMDK_SECTIONS = [
  {name:'Navigation', items:[
    {icon:CMDK_ICON.home,        label:'Go to home',             keys:['G','then','H'], run:()=>{cmdkClose(); setView('today');}},
    {icon:CMDK_ICON.inbox,       label:'Go to Inbox',            keys:['G','then','I'], run:()=>{cmdkClose(); setView('inbox');}},
    {icon:SVG.calendar,          label:'Go to Today',            keys:['G','then','T'], run:()=>{cmdkClose(); setView('today');}},
    {icon:CMDK_ICON.calDays,     label:'Go to Upcoming',         keys:['G','then','U'], run:()=>{cmdkClose(); setView('upcoming');}},
    {icon:SVG.filter,            label:'Go to Filters & Labels', keys:['G','then','V'], run:()=>{cmdkClose(); setView('filters');}},
    {icon:CMDK_ICON.checkCircle, label:'Go to Completed',        keys:['G','then','C'], run:()=>{cmdkClose(); setView('completed');}},
    {icon:CMDK_ICON.chart,       label:'Go to reporting',        keys:['G','then','A'], run:()=>{cmdkClose(); setView('completed');}},
    {icon:SVG.hash,              label:'Open project…',          keys:['G','then','P'], run:()=>{cmdkClose(); setView('projects-page');}},
    {icon:CMDK_ICON.layers,      label:'Open section…',          keys:['G','then','/']},
    {icon:SVG.tag,               label:'Open label…',            keys:['G','then','L'], run:()=>{cmdkClose(); setView('filters');}},
  ]},
  {name:'Add', items:[
    {icon:CMDK_ICON.plusCircle,  label:'Add task',               keys:['Q'],            run:()=>{cmdkClose(); quickAdd();}},
    {icon:SVG.plus,              label:'Add project',            keys:['Alt','P'],      run:()=>{cmdkClose(); openProjectDialog('add','');}},
    {icon:SVG.plus,              label:'Add filter',             keys:[]},
    {icon:SVG.plus,              label:'Add label',              keys:[]},
  ]},
  {name:'Templates', items:[
    {icon:SVG.puzzle,            label:'Browse templates',       keys:[]},
    {icon:CMDK_ICON.bolt,        label:'Open Productivity',      keys:['O','then','P']},
    {icon:SVG.bell,              label:'Open notifications',     keys:['O','then','N']},
    {icon:CMDK_ICON.user,        label:'Open user menu',         keys:['O','then','U']},
    {icon:CMDK_ICON.gear,        label:'Open settings',          keys:['O','then','S']},
  ]},
  {name:'Help', items:[
    {icon:SVG.keyboard,          label:'Show keyboard shortcuts', keys:['?'], run:()=>{cmdkClose(); openShortcuts();}},
  ]},
  {name:'Miscellaneous', items:[
    {icon:CMDK_ICON.printer,     label:'Print current view',     keys:['Ctrl','P']},
    {icon:CMDK_ICON.sidebar,     label:'Open/close sidebar',     keys:['M']},
    {icon:CMDK_ICON.sparkles,    label:'AI Assist',              keys:[]},
  ]},
];

let cmdkQuery = "";
let cmdkSel = 0;
let cmdkTasksExpanded = false;
let cmdkRuns = [];   // selectable index -> run function

function cmdkRecent(){ try{ return JSON.parse(localStorage.getItem('cmdk_recent') || '[]'); }catch(e){ return []; } }
function cmdkPushRecent(item){
  let r = cmdkRecent().filter(x => !(x.kind === item.kind && x.key === item.key));
  r.unshift(item);
  try{ localStorage.setItem('cmdk_recent', JSON.stringify(r.slice(0,5))); }catch(e){}
}
function cmdkInitial(){ return esc((account.name || 'M').slice(0,1)); }

function cmdkBuild(){
  const ov = document.createElement('div');
  ov.id = 'cmdk-overlay';
  ov.innerHTML = `<div class="cmdk" role="dialog" aria-label="Search">
    <div class="cmdk-head">
      <span class="lupa">${CMDK_ICON.search}</span>
      <input class="cmdk-input" id="cmdk-input" placeholder="Search or type a command…" autocomplete="off">
      <span class="cmdk-kg"><span class="cmdk-kbd">Ctrl</span><span class="cmdk-kbd">K</span></span>
    </div>
    <div class="cmdk-body" id="cmdk-body"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) cmdkClose(); });
  const inp = ov.querySelector('#cmdk-input');
  inp.addEventListener('input', e => { cmdkQuery = e.target.value; cmdkSel = 0; cmdkTasksExpanded = false; cmdkRender(); });
  inp.addEventListener('keydown', cmdkKeydown);
  const body = ov.querySelector('#cmdk-body');
  body.addEventListener('click', e => {
    if(e.target.closest('.cmdk-more')){ cmdkTasksExpanded = true; cmdkRender(); return; }
    const row = e.target.closest('.cmdk-row[data-idx]');
    if(row) cmdkExec(+row.dataset.idx);
  });
  body.addEventListener('mouseover', e => {
    const row = e.target.closest('.cmdk-row[data-idx]');
    if(row){ cmdkSel = +row.dataset.idx; cmdkHighlight(); }
  });
  return ov;
}

function cmdkOpen(){
  if(!connected) return;
  let ov = document.getElementById('cmdk-overlay') || cmdkBuild();
  cmdkQuery = ""; cmdkSel = 0; cmdkTasksExpanded = false;
  ov.classList.add('show');
  const inp = document.getElementById('cmdk-input');
  inp.value = "";
  setTimeout(() => inp.focus(), 0);
  cmdkRender();
}
function cmdkClose(){
  const ov = document.getElementById('cmdk-overlay');
  if(ov) ov.classList.remove('show');
}
function cmdkIsOpen(){
  const ov = document.getElementById('cmdk-overlay');
  return !!(ov && ov.classList.contains('show'));
}

function cmdkHl(text, q){
  const s = esc(text || "");
  if(!q) return s;
  const i = (text || "").toLowerCase().indexOf(q);
  if(i < 0) return s;
  return esc(text.slice(0,i)) + '<mark>' + esc(text.slice(i, i+q.length)) + '</mark>' + esc(text.slice(i+q.length));
}
function cmdkKeysHtml(keys){
  if(!keys || !keys.length) return '';
  return '<span class="keys">' + keys.map(k =>
    k === 'then' ? '<span class="cmdk-then">then</span>' : `<span class="cmdk-kbd">${k}</span>`
  ).join('') + '</span>';
}
function cmdkCrumb(r){
  if(r.kind === 'project') return `<span class="cmdk-av">${cmdkInitial()}</span>My Projects`;
  if(r.kind === 'task')    return '/ ' + esc(r.project || '');
  if(r.kind === 'label')   return 'Labels';
  if(r.kind === 'filter')  return 'Filters';
  return '';
}
function cmdkRunRecent(r){
  cmdkClose();
  cmdkPushRecent(r);
  if(r.kind === 'project') setView('project:' + r.key);
  else if(r.kind === 'task') openModal(r.key);
  else if(r.kind === 'label') setView('label:' + r.key);
  else if(r.kind === 'filter') setView('filter:' + r.key);
}

function cmdkRender(){
  const q = cmdkQuery.trim().toLowerCase();
  const body = document.getElementById('cmdk-body');
  if(!body) return;
  cmdkRuns = [];
  let idx = 0;
  const parts = [];
  const sec = t => parts.push(`<div class="cmdk-seclabel">${t}</div>`);
  const row = o => {
    const myIdx = idx++;
    cmdkRuns[myIdx] = o.run;
    parts.push(`<div class="cmdk-row" data-idx="${myIdx}">
      <span class="lead ${o.iconCls || ''}">${o.icon || ''}</span>
      <span class="lbl">${o.label}${o.sub || ''}</span>
      ${o.crumb ? `<span class="crumb">${o.crumb}</span>` : ''}
      ${o.keys ? cmdkKeysHtml(o.keys) : ''}
    </div>`);
  };
  const rowOff = o => parts.push(`<div class="cmdk-row off">
      <span class="lead">${o.icon || ''}</span>
      <span class="lbl">${o.label}</span>
      ${o.keys ? cmdkKeysHtml(o.keys) : ''}
    </div>`);

  if(!q){
    const rec = cmdkRecent();
    if(rec.length){
      sec('Recently viewed');
      rec.forEach(r => row({
        icon: r.kind === 'project' ? SVG.hash : r.kind === 'label' ? SVG.tag : r.kind === 'filter' ? SVG.filter : CMDK_ICON.circle,
        iconCls: r.kind === 'project' ? 'proj' : '',
        label: esc(r.title),
        crumb: cmdkCrumb(r),
        run: () => cmdkRunRecent(r),
      }));
    }
  } else {
    // Projects
    const ph = projects.filter(p => p.toLowerCase().includes(q));
    if(ph.length){
      sec('Projects');
      ph.forEach(p => row({
        icon: SVG.hash, iconCls: 'proj', label: cmdkHl(p, q),
        crumb: `<span class="cmdk-av">${cmdkInitial()}</span>My Projects`,
        run: () => { cmdkClose(); cmdkPushRecent({kind:'project', key:p, title:p}); setView('project:' + p); },
      }));
    }
    // Tasks (top-level + subtasks), match title + description
    const taskHits = [];
    state.forEach(t => {
      if(t.completed) return;
      if(((t.text || '') + ' ' + (t.description || '')).toLowerCase().includes(q))
        taskHits.push({title:t.text || '', desc:t.description || '', project:t.project, openId:t.id});
      (t.subtasks || []).forEach(s => {
        if(s.done) return;
        if(((s.text || '') + ' ' + (s.description || '')).toLowerCase().includes(q))
          taskHits.push({title:s.text || '', desc:s.description || '', project:t.project, openId:t.id});
      });
    });
    if(taskHits.length){
      sec('Tasks');
      const shown = cmdkTasksExpanded ? taskHits : taskHits.slice(0, 5);
      shown.forEach(tk => {
        const titleHit = tk.title.toLowerCase().includes(q);
        const sub = (!titleHit && tk.desc) ? `<span class="sub">${cmdkHl(tk.desc, q)}</span>` : '';
        row({
          icon: CMDK_ICON.circle, label: cmdkHl(tk.title, q), sub,
          crumb: '/ ' + esc(tk.project || ''),
          run: () => { cmdkClose(); cmdkPushRecent({kind:'task', key:tk.openId, title:tk.title, project:tk.project}); openModal(tk.openId); },
        });
      });
      if(!cmdkTasksExpanded && taskHits.length > 5)
        parts.push(`<div class="cmdk-more">Show more results</div>`);
    }
    // Labels
    const lh = ALL_LABELS.filter(n => n.toLowerCase().includes(q));
    if(lh.length){
      sec('Labels');
      lh.forEach(n => row({
        icon: SVG.tag, label: cmdkHl(n, q),
        run: () => { cmdkClose(); cmdkPushRecent({kind:'label', key:n, title:n}); setView('label:' + n); },
      }));
    }
    // Filters
    const fh = filters.filter(f => (f.name || '').toLowerCase().includes(q));
    if(fh.length){
      sec('Filters');
      fh.forEach(f => row({
        icon: SVG.filter, label: cmdkHl(f.name, q),
        run: () => { cmdkClose(); cmdkPushRecent({kind:'filter', key:f.id, title:f.name}); setView('filter:' + f.id); },
      }));
    }
  }

  // Command sections (filtered by query against the label)
  CMDK_SECTIONS.forEach(s => {
    const items = q ? s.items.filter(it => it.label.toLowerCase().includes(q)) : s.items;
    if(!items.length) return;
    sec(s.name);
    items.forEach(it => {
      if(it.run) row({ icon: it.icon, label: cmdkHl(it.label, q), keys: it.keys, run: it.run });
      else rowOff({ icon: it.icon, label: it.label, keys: it.keys });
    });
  });

  if(idx === 0 && q) parts.push(`<div class="cmdk-empty">No results for &ldquo;${esc(cmdkQuery)}&rdquo;.</div>`);

  body.innerHTML = parts.join('');
  if(cmdkSel >= idx) cmdkSel = idx > 0 ? idx - 1 : 0;
  cmdkHighlight();
}

function cmdkHighlight(){
  const body = document.getElementById('cmdk-body');
  if(!body) return;
  body.querySelectorAll('.cmdk-row.active').forEach(r => r.classList.remove('active'));
  const el = body.querySelector(`.cmdk-row[data-idx="${cmdkSel}"]`);
  if(el){ el.classList.add('active'); el.scrollIntoView({block:'nearest'}); }
}
function cmdkExec(i){ const fn = cmdkRuns[i]; if(fn) fn(); }
function cmdkKeydown(e){
  const count = cmdkRuns.length;
  if(e.key === 'ArrowDown'){ e.preventDefault(); if(count){ cmdkSel = (cmdkSel + 1) % count; cmdkHighlight(); } }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); if(count){ cmdkSel = (cmdkSel - 1 + count) % count; cmdkHighlight(); } }
  else if(e.key === 'Enter'){ e.preventDefault(); cmdkExec(cmdkSel); }
  else if(e.key === 'Escape'){ e.preventDefault(); cmdkClose(); }
}

