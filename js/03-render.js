/* ============ RENDER ============ */
let scrollState = {boardX: 0, columns: {}, listY: 0};

function captureScroll(){
  const bv = document.getElementById("project-board-view");
  if(bv) scrollState.boardX = bv.scrollLeft;
  document.querySelectorAll(".board_section[data-col]").forEach(sec => {
    const list = sec.querySelector("[role=group]");
    if(list) scrollState.columns[sec.dataset.col] = list.scrollTop;
  });
  const lw = document.querySelector(".list-wrap");
  if(lw) scrollState.listY = lw.scrollTop;
}

function restoreScroll(){
  const bv = document.getElementById("project-board-view");
  if(bv && scrollState.boardX) bv.scrollLeft = scrollState.boardX;
  document.querySelectorAll(".board_section[data-col]").forEach(sec => {
    const list = sec.querySelector("[role=group]");
    if(list && scrollState.columns[sec.dataset.col] !== undefined){
      list.scrollTop = scrollState.columns[sec.dataset.col];
    }
  });
  const lw = document.querySelector(".list-wrap");
  if(lw && scrollState.listY) lw.scrollTop = scrollState.listY;
}

function render(){
  captureScroll();
  document.getElementById("app-sidebar-container").classList.toggle("disconnected", !connected);
  renderSidebar();
  renderHeader();
  renderContent();
  renderStickies();
  restoreScroll();
  if(modalTaskId) renderModal();
}

/* ============ STICKY NOTES (super-priority, top-right queue) ============ */
// Up to STICKY_MAX tasks can be pinned; STICKY_VISIBLE cards are shown, the rest
// wait in a queue behind a "+N" card (click → popover with the whole queue).
// Complete / delete / unpin → the next queued task surfaces automatically.
const STICKY_MAX = 10;
const STICKY_VISIBLE = 2;
let _stickySig = "";   // last rendered signature — skip rebuild when unchanged (avoids sync flicker)
const _PRIO_RANK = {P1:1, P2:2, P3:3, P4:4};
// Queue order: soonest due first (no due → last) → higher priority → text A→Z.
function stickyOrder(a, b){
  const da = a.due_date ? a.due_date + "T" + (a.due_time || "99:99") : "9999";
  const db = b.due_date ? b.due_date + "T" + (b.due_time || "99:99") : "9999";
  if(da !== db) return da < db ? -1 : 1;
  const pa = _PRIO_RANK[a.priority] || 4, pb = _PRIO_RANK[b.priority] || 4;
  if(pa !== pb) return pa - pb;
  return (a.text || "").localeCompare(b.text || "", undefined, {sensitivity:"base"});
}
function stickyTasks(){ return state.filter(t => t.sticky && !t.completed).sort(stickyOrder); }
function renderStickies(){
  const layer = document.getElementById("sticky-layer");
  if(!layer) return;
  if(!connected){ if(_stickySig !== ""){ layer.innerHTML = ""; _stickySig = ""; closeStickyPopover(); } return; }
  const all = stickyTasks();
  const list = all.slice(0, STICKY_VISIBLE);
  const more = all.length - list.length;
  // Only touch the DOM when the visible set actually changes. render() runs on every
  // sync poll; without this guard the cards would be recreated each time and flicker.
  const sig = all.map(t => t.id + "|" + (t.priority||"") + "|" + (t.text||"") + "|" + (t.due_date||"") + (t.due_time||"")).join("§");
  if(sig === _stickySig) return;
  _stickySig = sig;
  layer.innerHTML = list.map((t) => {
    const pc = PCLS[t.priority] || "";
    return `<div class="sticky-note">
      <span class="sticky-bang">!</span>
      <button class="sticky-check ${pc}" onclick="completeTask('${t.id}')" title="${esc(tr('sticky.complete'))}">${SVG.check}</button>
      <span class="sticky-text" onclick="openModal('${t.id}')" title="${esc(t.text)}">${esc(t.text)}</span>
      <button class="sticky-unpin" onclick="toggleSticky('${t.id}')" title="${esc(tr('sticky.unmake'))}">×</button>
    </div>`;
  }).join("") + (more > 0
    ? `<div class="sticky-note sticky-more" id="sticky-more" onclick="openStickyPopover(event)" title="${esc(tr('sticky.queue'))}">+${more}</div>`
    : "");
  if(more <= 0) closeStickyPopover(); else if(_stickyPopOpen) renderStickyPopover();
}
function toggleSticky(id){
  const t = T(id); if(!t) return;
  if(!t.sticky && stickyTasks().length >= STICKY_MAX){
    showToast(tr("sticky.limit", {n: STICKY_MAX}), "warn");
    return;
  }
  upd(id, "sticky", !t.sticky);
}
/* --- queue popover: every pinned task in queue order --- */
let _stickyPopOpen = false;
function _stickyPopEl(){
  let el = document.getElementById("sticky-pop");
  if(!el){
    el = document.createElement("div");
    el.id = "sticky-pop";
    el.className = "ctx-menu sticky-pop";
    document.body.appendChild(el);
  }
  return el;
}
function renderStickyPopover(){
  const el = _stickyPopEl();
  const all = stickyTasks();
  el.innerHTML = `<div class="ctx-head">${esc(tr("sticky.queue"))} · ${all.length}/${STICKY_MAX}</div>` +
    all.map((t, i) => {
      const pc = PCLS[t.priority] || "";
      return `<div class="sticky-row${i < STICKY_VISIBLE ? " shown" : ""}">
        <button class="sticky-check ${pc}" onclick="completeTask('${t.id}')" title="${esc(tr('sticky.complete'))}">${SVG.check}</button>
        <span class="sticky-row-text" onclick="openModal('${t.id}'); closeStickyPopover()">${esc(t.text)}</span>
        ${t.due_date ? `<span class="sticky-row-due${isOverdue(t.due_date) ? " overdue" : ""}">${esc(fmtDate(t.due_date))}${t.due_time ? " " + esc(t.due_time) : ""}</span>` : ""}
        <button class="sticky-unpin" onclick="toggleSticky('${t.id}')" title="${esc(tr('sticky.unmake'))}">×</button>
      </div>`;
    }).join("");
}
function openStickyPopover(ev){
  if(ev) ev.stopPropagation();
  if(!stickyTasks().length) return;
  const el = _stickyPopEl();
  renderStickyPopover();
  el.classList.add("show");
  _stickyPopOpen = true;
  // anchor under the "+N" card (or the sticky layer when opened from the tray)
  const anchor = document.getElementById("sticky-more") || document.querySelector("#sticky-layer .sticky-note") || document.getElementById("sticky-layer");
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth || 320;
  el.style.top = Math.min(r.bottom + 8, window.innerHeight - el.offsetHeight - 8) + "px";
  el.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
}
function closeStickyPopover(){
  const el = document.getElementById("sticky-pop");
  if(el) el.classList.remove("show");
  _stickyPopOpen = false;
}
document.addEventListener("click", e => {
  if(_stickyPopOpen && !e.target.closest("#sticky-pop") && !e.target.closest("#sticky-more")) closeStickyPopover();
});
document.addEventListener("keydown", e => {
  if(e.key === "Escape" && _stickyPopOpen){ closeStickyPopover(); e.stopImmediatePropagation(); }
}, true);

function renderSidebar(){
  document.getElementById("count-inbox").textContent = projectCount("Inbox") || "";
  document.getElementById("count-today").textContent =
    state.filter(t => t.due_date && (isToday(t.due_date) || isOverdue(t.due_date)) && !t.completed).length || "";
  document.getElementById("count-upcoming").textContent =
    state.filter(t => isFuture(t.due_date) && !t.completed).length || "";
  // Filters & Labels has no count badge in Todoist (the old "help" hack is gone).
  document.getElementById("count-help").textContent = "";
  // Reporting has no count badge in Todoist (completed history isn't a live count).
  document.getElementById("count-completed").textContent = "";
  const userProjects = projects.filter(p => p !== INBOX_NAME);  // Inbox is its own top nav item, not a "My Project"
  document.getElementById("projects-used").textContent = tr("sidebar.used", {n: userProjects.length, total: PROJECT_LIMIT});

  const list = document.getElementById("projects_list");
  list.className = projectsCollapsed ? "collapsed" : "";
  // Notebook is pinned to the top as a special project (notebook icon, no drag/menu),
  // separated from the regular drag-orderable projects by a divider.
  const regular = userProjects.filter(p => p !== NOTEBOOK_PROJECT);
  let html = "";
  if(userProjects.includes(NOTEBOOK_PROJECT)){
    const active = currentView === "project:" + NOTEBOOK_PROJECT ? " active" : "";
    html += `<li class="project-item nb-project${active}" id="project-${esc(NOTEBOOK_PROJECT)}">
      <button class="project-item-link" onclick="setView('project:${esc(NOTEBOOK_PROJECT)}')">
        <span class="ico" style="color:${projColor(NOTEBOOK_PROJECT)}">${SVG.notebook}</span>
        <span class="project-name">${esc(NOTEBOOK_PROJECT)}</span>
        <span class="project-count">${projectCount(NOTEBOOK_PROJECT) || ""}</span>
        <span class="project-actions" onclick="openNotebookMenu(event)">${SVG.moreH}</span>
      </button>
    </li>`;
    if(regular.length) html += `<li class="nb-divider"></li>`;
  } else {
    // Notebook not created yet — opt-in row (notes are a real project, so they cost a slot)
    html += `<li class="project-item nb-enable" onclick="enableNotes()">
      <button class="project-item-link">
        <span class="ico nb-enable-ico">${SVG.notebook}</span>
        <span class="project-name">${tr("notes.enable")}</span>
      </button>
    </li>`;
    if(regular.length) html += `<li class="nb-divider"></li>`;
  }
  html += regular.map(p => {
    const count = projectCount(p);
    const active = currentView === "project:" + p ? " active" : "";
    return `<li class="project-item${active}" id="project-${esc(p)}" draggable="true"
        ondragstart="onProjDragStart(event,'${esc(p)}')" ondragend="onProjDragEnd(event)"
        ondragover="onProjDragOver(event)" ondragleave="onProjDragLeave(event)" ondrop="onProjDrop(event,'${esc(p)}')">
      <button class="project-item-link" onclick="setView('project:${esc(p)}')">
        <span class="ico" style="color:${projColor(p)}">${SVG.hash}</span>
        <span class="project-name">${esc(p)}</span>
        <span class="project-count">${count || ""}</span>
        <span class="project-actions" onclick="openProjectMenu(event,'${esc(p)}')">${SVG.moreH}</span>
      </button>
    </li>`;
  }).join("");
  list.innerHTML = html;

  document.querySelectorAll(".sidebar-nav-item").forEach(el => {
    // A label/filter view (opened from Filters & Labels) keeps that item active.
    const active = el.dataset.view === currentView
      || (el.dataset.view === "filters" && (currentView.startsWith("label:") || currentView.startsWith("filter:")));
    el.classList.toggle("active", active);
  });
  renderUserCard();
}

// Deterministic avatar color from the account name (Todoist-like palette).
const AVATAR_COLORS = ["#dc4c3e","#eb8909","#7ecc49","#299438","#6accbc","#158fad","#4073ff","#884dff","#af38eb","#e05194","#808080"];
function avatarColor(s){
  let h = 0; for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
// Probe a given avatar URL once; on load failure, fall back to initials app-wide.
let _avatarProbe = { url:"", failed:false };
function probeAvatar(url){
  if(_avatarProbe.url === url) return;
  _avatarProbe = { url, failed:false };
  const img = new Image();
  img.onerror = () => { if(_avatarProbe.url === url){ _avatarProbe.failed = true; render(); } };
  img.src = url;
}
function paintAvatar(el){
  const name = (account.name || "").trim();
  el.style.backgroundImage = "";
  el.style.background = "";
  el.textContent = "";
  const url = connected ? (account.avatar_url || "") : "";
  if(url) probeAvatar(url);
  if(url && !_avatarProbe.failed){
    el.style.backgroundImage = `url("${url}")`;
  } else {
    paintInitial(el, name);
  }
}
function paintInitial(el, name){
  if(!connected){ el.style.background = "var(--text-3)"; el.textContent = "—"; return; }
  const ch = name ? Array.from(name)[0] : tr("user.initial");
  el.style.background = avatarColor(name || "me");
  el.textContent = ch.toUpperCase();
}
function renderUserCard(){
  const nameEl = document.getElementById("user-name");
  const avEl = document.getElementById("user-avatar");
  if(!nameEl || !avEl) return;
  nameEl.textContent = !connected ? tr("account.disconnected")
                     : (account.name || tr("user.name"));
  paintAvatar(avEl);
}

function renderHeader(){
  const refreshBtn = document.getElementById("refresh-btn");
  const pendingPill = document.getElementById("pending-pill");
  if(!connected){
    // Disconnected: blank the header and hide every action.
    document.getElementById("view-title").textContent = "";
    ["refresh-btn","pending-pill","display-btn","reschedule-btn","fl-display-btn","filter-opts-btn","undo-btn","redo-btn"].forEach(id => {
      const el = document.getElementById(id); if(el) el.style.display = "none";
    });
    const bc0 = document.getElementById("view-breadcrumb"); if(bc0) bc0.style.display = "none";
    const lc0 = document.getElementById("list-cal-switch"); if(lc0) lc0.classList.remove("show");
    return;
  }
  // Connected: restore the always-on header pieces (per-view ones handled below).
  if(refreshBtn) refreshBtn.style.display = "";
  if(pendingPill) pendingPill.style.display = "";
  ["undo-btn","redo-btn"].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = ""; });
  let title;
  if(currentView === "inbox") title = tr("nav.inbox");
  else if(currentView.startsWith("project:")) title = currentView.slice(8);
  else if(currentView.startsWith("label:")) title = currentView.slice(6);
  else if(currentView.startsWith("filter:")){ const f = filterById(currentView.slice(7)); title = f ? f.name : tr("nav.filters_labels"); }
  else title = {today:tr("nav.today"), upcoming:tr("nav.upcoming"), filters:tr("nav.filters_labels"), completed:tr("nav.reporting"), calendar:tr("nav.calendar"), "projects-page":tr("sidebar.my_projects")}[currentView] || currentView;
  if(searchQuery){
    const n = visibleTasks().length;
    title += tr("header.search_results", {n});
  }
  document.getElementById("view-title").textContent = title;
  // Breadcrumb + Display button: only on filter & label views; ⋯ only on filters
  const bc = document.getElementById("view-breadcrumb");
  const flBtn = document.getElementById("fl-display-btn");
  const optsBtn = document.getElementById("filter-opts-btn");
  if(isDisplayView()){
    const sub = currentView.startsWith("filter:") ? tr("fl.my_filters") : tr("fl.labels");
    bc.style.display = "";
    bc.innerHTML = `<span class="bc-link" onclick="setView('filters')">${esc(tr("nav.filters_labels"))}</span>`
      + `<span class="bc-sep">/</span><span class="bc-link" onclick="setView('filters')">${esc(sub)}</span>`;
    flBtn.style.display = "inline-flex";
    optsBtn.style.display = currentView.startsWith("filter:") ? "inline-flex" : "none";
  } else {
    bc.style.display = "none";
    flBtn.style.display = "none";
    optsBtn.style.display = "none";
  }
  const pill = document.getElementById("pending-pill");
  pill.classList.remove("has", "offline");
  pill.title = "";
  pill.onclick = null;
  const hasErr = !!(syncState.last_push_error || syncState.last_pull_error);
  if(isOffline || hasErr){
    const errMsg = syncState.last_push_error || syncState.last_pull_error || "";
    pill.textContent = pendingCount > 0
      ? tr("pill.pending_offline", {n: pendingCount})
      : tr("pill.offline");
    pill.classList.add("offline");
    pill.title = errMsg
      ? tr("pill.click_retry", {msg: errMsg})
      : tr("pill.manual_sync");
    pill.style.cursor = "pointer";
    pill.onclick = () => manualSync();
  } else if(pendingCount > 0){
    pill.textContent = tr("pill.pending", {n: pendingCount});
    pill.classList.add("has");
    pill.title = tr("pill.pending_title");
  } else {
    pill.textContent = syncState.last_sync_at
      ? tr("pill.synced", {time: syncState.last_sync_at.slice(11,16)})
      : "";
    pill.style.cursor = "default";
  }
  // Display toggle: only for project views (where board makes sense).
  // Notebook uses its own notes view, not board/list — hide the toggle there.
  const dispBtn = document.getElementById("display-btn");
  if(isProjectView() && !searchQuery && currentView !== "project:" + NOTEBOOK_PROJECT){
    dispBtn.classList.add("show");
    if(viewMode === "board"){
      dispBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="18"/><rect x="14" y="3" width="7" height="10"/></svg> ${tr("view_toggle.board")}`;
    } else {
      dispBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> ${tr("view_toggle.list")}`;
    }
  } else {
    dispBtn.classList.remove("show");
  }
  // Reschedule button — only in the Today view, when there are overdue tasks
  const rb = document.getElementById("reschedule-btn");
  if(rb){
    rb.style.display = (currentView === "today" && !searchQuery && overdueTasks().length > 0) ? "" : "none";
  }
  // List/Calendar switch (version D): Upcoming only (elsewhere it clutters the view) + the calendar itself
  const lcSw = document.getElementById("list-cal-switch");
  if(lcSw){
    const inCal = currentView === "calendar";
    const show = inCal || (currentView === "upcoming" && !searchQuery);
    lcSw.classList.toggle("show", show);
    lcSw.querySelector('[data-lc="list"]').classList.toggle("on", !inCal);
    lcSw.querySelector('[data-lc="cal"]').classList.toggle("on", inCal);
  }
}

