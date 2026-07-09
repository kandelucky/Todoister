/* ============ DRAG & DROP ============ */
function onCardDragStart(e, tid){
  draggedTaskId = tid;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", tid);
  e.currentTarget.classList.add("dragging");
}
function onCardDragEnd(e){
  e.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".board_section.drag-over").forEach(el => el.classList.remove("drag-over"));
  draggedTaskId = null;
}
function onColDragOver(e){
  if(draggedSectionName !== null){
    // SECTION REORDER MODE
    const sec = e.currentTarget;
    // Only allow drops on editable (named) sections
    if(sec.dataset.editable !== "1") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = sec.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    document.querySelectorAll(".board_section.sec-drop-before, .board_section.sec-drop-after")
      .forEach(el => el.classList.remove("sec-drop-before","sec-drop-after"));
    sec.classList.add(before ? "sec-drop-before" : "sec-drop-after");
    return;
  }
  if(!draggedTaskId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const sec = e.currentTarget;
  if(!sec.classList.contains("drag-over")){
    document.querySelectorAll(".board_section.drag-over").forEach(el => el.classList.remove("drag-over"));
    sec.classList.add("drag-over");
  }
}
function onColDragLeave(e){
  const sec = e.currentTarget;
  if(!sec.contains(e.relatedTarget)){
    sec.classList.remove("drag-over","sec-drop-before","sec-drop-after");
  }
}
function onColDrop(e, sectionName){
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over","sec-drop-before","sec-drop-after");
  if(draggedSectionName !== null){
    // SECTION REORDER DROP
    const sec = e.currentTarget;
    if(sec.dataset.editable !== "1"){ draggedSectionName = null; return; }
    const rect = sec.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    submitSectionReorder(draggedSectionName, sectionName, before ? "before" : "after");
    draggedSectionName = null;
    return;
  }
  if(!draggedTaskId) return;
  const t = T(draggedTaskId);
  if(!t) return;
  if((t.section || "") !== sectionName){
    upd(draggedTaskId, "section", sectionName);
  }
  draggedTaskId = null;
}

function onSectionDragStart(e, name){
  draggedSectionName = name;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", `section:${name}`);
  e.currentTarget.classList.add("sec-dragging");
  // header drag bubbling to card dragstart is prevented because header is the deepest draggable here
  e.stopPropagation();
}
function onSectionDragEnd(e){
  e.currentTarget.classList.remove("sec-dragging");
  document.querySelectorAll(".board_section.sec-drop-before, .board_section.sec-drop-after")
    .forEach(el => el.classList.remove("sec-drop-before","sec-drop-after"));
  draggedSectionName = null;
}

function submitSectionReorder(movedName, targetName, position){
  if(movedName === targetName) return;
  const proj = currentProject();
  if(!proj) return;
  const current = (projectSections[proj] || []).slice();
  const fromIdx = current.indexOf(movedName);
  if(fromIdx === -1) return;
  current.splice(fromIdx, 1);  // remove from old position
  let toIdx = current.indexOf(targetName);
  if(toIdx === -1) return;  // target disappeared somehow
  if(position === "after") toIdx += 1;
  current.splice(toIdx, 0, movedName);
  // Optimistic local update
  projectSections[proj] = current;
  render();
  post("/api/section_reorder", {project: proj, order: current});
}
function navTask(dir){
  const list = visibleTasks();
  const i = list.findIndex(t => t.id === modalTaskId);
  if(i < 0) return;
  const next = list[(i + dir + list.length) % list.length];
  if(next) openModal(next.id);
}

/* ============ INLINE ADD ============ */
function startInlineAdd(proj, section){
  inlineAdd = {proj, section, date:"", time:"", tz:"", priority:"P4", labels:[]};
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();
  render();
  setTimeout(()=>{ const i = document.getElementById("ia-name"); if(i) i.focus(); }, 0);
}
function cancelInlineAdd(){ inlineAdd = null; inlineAddAttachment = null; closeQuickAddBox(); render(); }
function renderAddForm(proj, section){
  // Project/section options (cascaded)
  let projOpts = "";
  projects.forEach(p => {
    const secs = projectSections[p] || [];
    projOpts += `<option value="${esc(p)}|" ${p===proj && !section?'selected':''}>${esc(p)} — (no section)</option>`;
    secs.forEach(s => {
      projOpts += `<option value="${esc(p)}|${esc(s)}" ${p===proj && s===section?'selected':''}>${esc(p)} / ${esc(s)}</option>`;
    });
  });
  return `<div class="add-form">
    <textarea id="ia-name" rows="1" placeholder="${tr("task.name_ph")}"
      oninput="autoSize(this); refreshAddBtn()" onkeydown="handleAddKey(event)"></textarea>
    <textarea class="desc" id="ia-desc" rows="1" placeholder="${tr("modal.description_ph")}"
      oninput="autoSize(this)" onkeydown="if(event.key==='Escape') cancelInlineAdd();"></textarea>
    <div class="selected-labels" id="ia-labels-chips"></div>
    <div class="selected-labels" id="ia-attach-chip" style="display:none"></div>
    <div class="form-tools">
      <button id="ia-date-btn" onclick="event.stopPropagation(); showDateMenu()" title="${tr("tooltip.date")}">
        ${SVG.calendar}<span id="ia-date-lbl" style="display:none"></span>
      </button>
      <input type="file" id="ia-file-input" style="position:absolute; left:-9999px; width:1px; height:1px; opacity:0;" onchange="onInlineAttach(event)">
      <label class="add-attach-btn" for="ia-file-input" title="${tr("comment.attach_file")}" id="ia-attach-btn">${SVG.paperclip}</label>
      <button id="ia-prio-btn" onclick="event.stopPropagation(); showPrioMenu()" title="${tr("tooltip.priority")}">
        ${SVG.flag}<span id="ia-prio-lbl" style="display:none"></span>
      </button>
      <button id="ia-reminder-btn" class="pro" title="${tr("tooltip.reminder_pro")}">${SVG.bell}</button>
      <button id="ia-labels-btn" onclick="event.stopPropagation(); showLabelsMenu()" title="${tr("tooltip.labels")}">${SVG.tag}</button>
    </div>
    <div class="form-actions">
      <select class="proj-select" id="ia-proj-select" onchange="onInlineProjChange(this.value)">
        ${projOpts}
      </select>
      <div class="form-buttons">
        <button class="btn-secondary" onclick="cancelInlineAdd()">${tr("common.cancel")}</button>
        <button class="btn-primary" id="ia-add-btn" onclick="submitInlineAdd()" disabled>${tr("common.add")}</button>
      </div>
    </div>
  </div>`;
}
function handleAddKey(e){
  // Enter submits (without Shift); Shift+Enter inserts newline
  if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); submitInlineAdd(); }
  if(e.key === "Escape") cancelInlineAdd();
}
function applyInlineDate(d){
  if(!inlineAdd) return;
  inlineAdd.date = d || "";
  if(!inlineAdd.date) inlineAdd.time = "";   // no date → no time (matches Todoist)
  const btn = document.getElementById("ia-date-btn");
  if(!btn) return;
  const lbl = btn.querySelector("#ia-date-lbl");
  btn.classList.remove("has-label","date-today","date-tomorrow","date-future","date-overdue");
  if(d){
    lbl.textContent = fmtDate(d) + (inlineAdd.time ? " " + inlineAdd.time : "");
    lbl.style.display = "";
    btn.classList.add("has-label");
    // Pick color by relative date
    const tom = (function(){ const x = new Date(); x.setDate(x.getDate()+1); return iso(x); })();
    if(isToday(d)) btn.classList.add("date-today");
    else if(isOverdue(d)) btn.classList.add("date-overdue");
    else if(d === tom) btn.classList.add("date-tomorrow");
    else btn.classList.add("date-future");
  } else {
    lbl.style.display = "none";
  }
}
function applyInlineTime(tm, tz){
  if(!inlineAdd) return;
  inlineAdd.time = tm || "";
  if(tz !== undefined) inlineAdd.tz = tz || "";
  if(inlineAdd.time && !inlineAdd.date) inlineAdd.date = todayISO();
  applyInlineDate(inlineAdd.date);   // refresh the chip (shows date + time)
}

// current date picker callback + anchor (reusable: inline add + reschedule)
let datePickFn = null, datePickAnchorId = null, datePickCurrent = "";  // datePickCurrent = the date already on the task (ISO), so the calendar can seed + highlight it
let timePickFn = null, timePickCurrent = "", timePickTz = "";   // optional time sub-picker for the date scheduler
let repeatPickFn = null, repeatPickCurrent = "", repeatAnchorISO = "";   // optional repeat sub-picker for the date scheduler
const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`;
const REPEAT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
const HELP_Q_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><line x1="12" y1="17" x2="12" y2="17"/></svg>`;

/* ---- Natural-language date parsing for "Type a date" (Todoist-like, en + ka) ---- */
function _wdIndex(tok){
  // 0=Sunday..6=Saturday, matching Date.getDay()
  const en = [["sunday","sun"],["monday","mon"],["tuesday","tue","tues"],["wednesday","wed"],
              ["thursday","thu","thurs"],["friday","fri"],["saturday","sat"]];
  for(let i=0;i<7;i++) for(const n of en[i]) if(n===tok || (n.length>3 && tok.length>=3 && n.startsWith(tok))) return i;
  const ka = ["კვირა","ორშაბათი","სამშაბათი","ოთხშაბათი","ხუთშაბათი","პარასკევი","შაბათი"];
  for(let i=0;i<7;i++) if(ka[i]===tok || (tok.length>=3 && ka[i].startsWith(tok))) return i;
  return null;
}
function _moIndex(tok){
  const en = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const ka = ["იანვარი","თებერვალი","მარტი","აპრილი","მაისი","ივნისი","ივლისი","აგვისტო","სექტემბერი","ოქტომბერი","ნოემბერი","დეკემბერი"];
  for(let i=0;i<12;i++){ if(tok.length>=3 && (en[i].startsWith(tok) || ka[i].startsWith(tok))) return i; }
  const enA = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const kaA = ["იან","თებ","მარ","აპრ","მაი","ივნ","ივლ","აგვ","სექ","ოქტ","ნოე","დეკ"];
  for(let i=0;i<12;i++) if(enA[i]===tok || kaA[i]===tok) return i;
  return null;
}
function parseDateInput(raw){
  const s = (raw||"").trim().toLowerCase();
  if(!s) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const out = d => iso(d);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                       // ISO
  const kw = {today:0,"დღეს":0,tomorrow:1,tom:1,"ხვალ":1,yesterday:-1,"გუშინ":-1,"ზეგ":2};
  if(s in kw){ const d=new Date(today); d.setDate(d.getDate()+kw[s]); return out(d); }
  let m = s.match(/^\+(\d{1,3})$/) || s.match(/^in\s+(\d{1,3})\s*d(?:ays?)?$/)
       || s.match(/^(\d{1,3})\s*d(?:ays?)?$/) || s.match(/^(\d{1,3})\s*დღე/);
  if(m){ const d=new Date(today); d.setDate(d.getDate()+parseInt(m[1],10)); return out(d); }
  let next = false, w = s;
  if(/^next\s+/.test(s)){ next=true; w=s.replace(/^next\s+/,""); }
  else if(/^მომდევნო\s+/.test(s)){ next=true; w=s.replace(/^მომდევნო\s+/,""); }
  const wd = _wdIndex(w);
  if(wd!==null){ const d=new Date(today); let add=(wd-d.getDay()+7)%7; if(add===0||next) add=add===0?7:add; if(next&&add<=7) add=((wd-d.getDay()+7)%7)||7; d.setDate(d.getDate()+add); return out(d); }
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/);     // dd.mm[.yyyy]
  if(m){ let dd=+m[1], mm=+m[2], yy=m[3]?+m[3]:today.getFullYear(); if(yy<100) yy+=2000;
    if(mm>=1&&mm<=12&&dd>=1&&dd<=31){ const d=new Date(yy,mm-1,dd); if(d.getMonth()===mm-1) return out(d); } }
  let dm = s.match(/^(\d{1,2})\s+([a-zა-ჰ]+)$/);                    // "10 jun" / "10 ივნისი"
  let md = s.match(/^([a-zა-ჰ]+)\s+(\d{1,2})$/);                    // "jun 10"
  let day=null, moTok=null;
  if(dm){ day=+dm[1]; moTok=dm[2]; } else if(md){ day=+md[2]; moTok=md[1]; }
  if(day!==null){ const mo=_moIndex(moTok); if(mo!==null && day>=1 && day<=31){
    let d=new Date(today.getFullYear(),mo,day); if(d<today) d=new Date(today.getFullYear()+1,mo,day); return out(d); } }
  return null;
}
function datePreviewLabel(isoStr){
  const d = new Date(isoStr+"T00:00:00");
  const loc = (window.I18N && I18N.lang==="ka") ? "ka-GE" : "en-US";
  return d.toLocaleDateString(loc,{weekday:"short", day:"numeric", month:"short", year:"numeric"});
}
function dateTypePreview(v){
  const box = document.getElementById("date-type-result");
  const inp = document.getElementById("date-search-input");
  if(!box || !inp) return;
  const s = (v||"").trim();
  if(!s){ box.style.display="none"; box.innerHTML=""; inp.classList.remove("nomatch"); return; }
  const r = parseDateInput(s);
  box.style.display = "";
  if(r){
    inp.classList.remove("nomatch");
    box.innerHTML = `<div class="date-opt" onclick="datePickFn('${r}'); closeAllPopovers()">
      <span class="d-ico">${SVG.calendar}</span><span class="d-name">${esc(datePreviewLabel(r))}</span></div>`;
  } else {
    inp.classList.add("nomatch");
    box.innerHTML = `<div class="date-nomatch">${tr("date.no_match")}</div>`;
  }
}
function showDateMenu(){
  repeatPickFn = null;
  datePickCurrent = (inlineAdd && inlineAdd.date) || "";
  timePickTz = (inlineAdd && inlineAdd.tz) || "";
  calYear = calMonth = undefined;
  openDatePicker("ia-date-btn", applyInlineDate, applyInlineTime, (inlineAdd && inlineAdd.time) || "");
}
function openDatePicker(anchorId, fn, timeFn, curTime, repeatFn, curRepeat){
  // Only (re)set the time/repeat context when a caller provides it; navCal reopens
  // with 2 args during month navigation and must keep the existing sub-pickers.
  if(arguments.length >= 3){ timePickFn = timeFn || null; timePickCurrent = curTime || ""; }
  if(arguments.length >= 5){ repeatPickFn = repeatFn || null; repeatPickCurrent = curRepeat || ""; }
  closeAllPopovers();
  const btn = document.getElementById(anchorId);
  if(!btn) return;
  datePickFn = fn; datePickAnchorId = anchorId;
  const r = btn.getBoundingClientRect();
  const now = new Date();
  // A fresh open (caller passes the date/time context, arguments.length >= 3) seeds
  // the calendar to the date already on the task so its month + day are visible;
  // navCal() reopens with 2 args and keeps the month the user navigated to.
  if(arguments.length >= 3){
    const seed = datePickCurrent ? new Date(datePickCurrent + "T00:00:00") : now;
    calYear = seed.getFullYear(); calMonth = seed.getMonth();
  } else if(calYear === undefined || calMonth === undefined || Number.isNaN(calYear)){
    calYear = now.getFullYear(); calMonth = now.getMonth();
  }
  const tom = new Date(now); tom.setDate(tom.getDate()+1);
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const nextWeekend = new Date(now);
  nextWeekend.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const dowShort = trList("date.dow_short");
  const monShort = trList("date.month_short");
  const dayName = d => dowShort[d.getDay()];
  const monthShort = monShort;
  const fmtShort = d => `${dayName(d)} ${d.getDate()} ${monthShort[d.getMonth()]}`;

  const cal = buildCalendar(calYear, calMonth);
  const m = document.createElement("div");
  m.id = "date-popover";
  m.className = "date-popover";
  m.innerHTML = `
    <div class="date-search">
      <input id="date-search-input" placeholder="${tr("date.type_date_ph")}" autocomplete="off"
        oninput="dateTypePreview(this.value)"
        onkeydown="if(event.key==='Enter'){const r=parseDateInput(this.value); if(r){ datePickFn(r); closeAllPopovers(); }}">
      <div id="date-type-result" class="date-type-result" style="display:none"></div>
    </div>
    <div class="date-quick">
      <div class="date-opt today" onclick="datePickFn('${todayISO()}'); closeAllPopovers()">
        <span class="d-ico">${SVG.calendar}</span>
        <span class="d-name">${tr("date.today")}</span>
        <span class="d-when">${dayName(now)}</span>
      </div>
      <div class="date-opt tomorrow" onclick="datePickFn('${iso(tom)}'); closeAllPopovers()">
        <span class="d-ico" style="font-size:18px">☀</span>
        <span class="d-name">${tr("date.tomorrow")}</span>
        <span class="d-when">${dayName(tom)}</span>
      </div>
      <div class="date-opt nextweek" onclick="datePickFn('${iso(nextWeek)}'); closeAllPopovers()">
        <span class="d-ico" style="font-size:18px">→</span>
        <span class="d-name">${tr("date.next_week")}</span>
        <span class="d-when">${fmtShort(nextWeek)}</span>
      </div>
      <div class="date-opt weekend" onclick="datePickFn('${iso(nextWeekend)}'); closeAllPopovers()">
        <span class="d-ico" style="font-size:16px">🛋</span>
        <span class="d-name">${tr("date.next_weekend")}</span>
        <span class="d-when">${fmtShort(nextWeekend)}</span>
      </div>
    </div>
    ${cal}
    <div class="date-bottom">
      ${timePickFn ? `<button class="date-foot-btn${timePickCurrent?' on':''}" onclick="openTimePopover(event)"><span class="dfb-ico">${CLOCK_ICON}</span>${timePickCurrent ? esc(timePickCurrent) : tr("time.label")}</button>` : ""}
      ${repeatPickFn ? `<button class="date-foot-btn${repeatPickCurrent?' on':''}" onclick="openRepeatPopover(event)"><span class="dfb-ico">${REPEAT_ICON}</span>${repeatPickCurrent ? esc(repeatLabel(repeatPickCurrent)) : tr("repeat.label")}</button>` : ""}
      <button class="date-btn-bottom" onclick="datePickFn(''); closeAllPopovers()">${tr("date.no_date")}</button>
    </div>
  `;
  document.body.appendChild(m);
  positionPopover(m, r);
}

function buildCalendar(year, month){
  const today = todayISO();
  const days = new Date(year, month + 1, 0).getDate();
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7;  // Monday = 0
  const monthNames = trList("date.month_short");  // Todoist calendar header — short month
  const dowMin = trList("date.dow_min");

  let html = `<div class="cal-header">
    <span class="cal-title">${monthNames[month]} ${year}</span>
    <div class="cal-nav">
      <button onclick="navCal(-1)" title="${tr("cal.prev")}">${SVG.chevronDown ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' : '‹'}</button>
      <button onclick="navCal(0)" title="${tr("cal.today")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg></button>
      <button onclick="navCal(1)" title="${tr("cal.next")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
    </div>
  </div>
  <div class="cal-days">
    ${dowMin.map(d=>`<span>${d}</span>`).join("")}
  </div>
  <div class="cal-grid">`;
  for(let i = 0; i < startDay; i++) html += `<span class="cal-empty"></span>`;
  const sel = (datePickCurrent || "").slice(0, 10);   // the date already on the task
  for(let d = 1; d <= days; d++){
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    let cls = (dateStr === today) ? "cal-today" : "";
    if(dateStr === sel) cls += " cal-selected";
    html += `<span class="cal-day ${cls}" onclick="datePickFn('${dateStr}'); closeAllPopovers()">${d}</span>`;
  }
  html += `</div>`;
  return html;
}

function navCal(dir){
  if(dir === 0){
    const now = new Date();
    calYear = now.getFullYear(); calMonth = now.getMonth();
  } else {
    calMonth += dir;
    if(calMonth < 0){ calMonth = 11; calYear--; }
    if(calMonth > 11){ calMonth = 0; calYear++; }
  }
  // reopen the current picker (inline or reschedule)
  openDatePicker(datePickAnchorId || "ia-date-btn", datePickFn || applyInlineDate);
}

