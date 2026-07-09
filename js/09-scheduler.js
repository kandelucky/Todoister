/* ============ RESCHEDULE (Today view, overdue batch) ============ */
function overdueTasks(){
  return state.filter(t => !t.completed && t.due_date && isOverdue(t.due_date));
}
function showRescheduleMenu(){
  timePickFn = null; repeatPickFn = null; datePickCurrent = ""; calYear = calMonth = undefined;
  openDatePicker("reschedule-btn", rescheduleOverdue);
}
function rescheduleOverdue(date){
  closeAllPopovers();
  const tasks = overdueTasks();
  tasks.forEach(t => upd(t.id, "due_date", date || ""));
  render();
}

function showMoreMenu(){
  closeAllPopovers();
  const btn = document.getElementById("ia-more-btn");
  if(!btn) return;
  const r = btn.getBoundingClientRect();
  const m = document.createElement("div");
  m.id = "more-popover";
  m.className = "more-popover";
  m.innerHTML = `
    <div class="prio-option" onclick="event.stopPropagation(); showLabelsMenu()">
      <span class="pflag" style="color:var(--text-2)">${SVG.tag}</span>
      <span class="pname">${tr("modal.labels")}</span>
      <span class="pkbd">@</span>
    </div>`;
  document.body.appendChild(m);
  positionPopover(m, r);
}

function showLabelsMenu(){
  closeAllPopovers();
  const btn = document.getElementById("ia-labels-btn") || document.getElementById("ia-more-btn");
  if(!btn) return;
  const r = btn.getBoundingClientRect();
  const selected = (inlineAdd && inlineAdd.labels) || [];
  const m = document.createElement("div");
  m.id = "labels-popover";
  m.className = "labels-popover";
  m.innerHTML = `
    <input class="labels-search" id="labels-search-input" placeholder="${tr("labels.search_ph")}"
      oninput="filterLabelsMenu(this.value)" onclick="event.stopPropagation()">
    <div id="labels-menu-items">` +
    ALL_LABELS.map(l => {
      const on = selected.includes(l);
      return `<div class="prio-option" data-label="${esc(l)}" onclick="event.stopPropagation(); toggleInlineLabel('${l}')">
        <span class="pflag" style="color:${lblColor(l)}">${SVG.labelTag}</span>
        <span class="pname">${esc(l)}</span>
        ${on ? `<span class="pcheck">✓</span>` : ""}
      </div>`;
    }).join("") +
    `</div>`;
  document.body.appendChild(m);
  positionPopover(m, r);
  setTimeout(() => { const i = document.getElementById("labels-search-input"); if(i) i.focus(); }, 0);
}
function filterLabelsMenu(q){
  q = (q || "").trim().toLowerCase();
  document.querySelectorAll("#labels-menu-items .prio-option").forEach(el => {
    el.style.display = (el.dataset.label || "").toLowerCase().includes(q) ? "" : "none";
  });
}

function toggleInlineLabel(l){
  if(!inlineAdd) return;
  if(!inlineAdd.labels) inlineAdd.labels = [];
  const i = inlineAdd.labels.indexOf(l);
  if(i >= 0) inlineAdd.labels.splice(i, 1);
  else inlineAdd.labels.push(l);
  const btn = document.getElementById("ia-labels-btn") || document.getElementById("ia-more-btn");
  if(btn) btn.classList.toggle("has-label", inlineAdd.labels.length > 0);
  renderInlineLabels();
  showLabelsMenu();
}

function renderInlineLabels(){
  const wrap = document.getElementById("ia-labels-chips");
  if(!wrap) return;
  const labs = (inlineAdd && inlineAdd.labels) || [];
  if(!labs.length){ wrap.innerHTML = ""; return; }
  wrap.innerHTML = labs.map(l => `
    <span class="label-chip">
      <span class="ch-color" style="background:${lblColor(l)}"></span>
      ${esc(l)}
      <span class="ch-x" onclick="event.stopPropagation(); removeInlineLabel('${l}')" title="${tr("labels.remove")}">×</span>
    </span>`).join("");
}

function removeInlineLabel(l){
  if(!inlineAdd || !inlineAdd.labels) return;
  const i = inlineAdd.labels.indexOf(l);
  if(i >= 0) inlineAdd.labels.splice(i, 1);
  const btn = document.getElementById("ia-labels-btn");
  if(btn) btn.classList.toggle("has-label", inlineAdd.labels.length > 0);
  renderInlineLabels();
}

function refreshAddBtn(){
  const name = document.getElementById("ia-name");
  const btn = document.getElementById("ia-add-btn");
  if(!name || !btn) return;
  btn.disabled = !name.value.trim();
}

function closeAllPopovers(){
  ["prio-popover","more-popover","labels-popover","date-popover","project-popover","time-popover","repeat-popover"].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.remove();
  });
}

/* ---- Time sub-popover (opened from the date scheduler) ---- */
function openTimePopover(ev){
  if(ev) ev.stopPropagation();
  const anchorRect = (ev && ev.currentTarget) ? ev.currentTarget.getBoundingClientRect() : null;
  closeAllPopovers();
  if(!timePickFn) return;
  const initTime = timePickCurrent || tpRoundNow();
  const m = document.createElement("div");
  m.id = "time-popover"; m.className = "time-popover";
  m.innerHTML = `
    <div class="tp-row tp-time-row"><span class="tp-key">${tr("time.label")}</span>
      <div class="tp-time-wrap">
        <input type="text" id="tp-time" class="tp-input" value="${esc(initTime)}" autocomplete="off"
          inputmode="numeric" placeholder="HH:MM"
          oninput="highlightTpTime(this.value)"
          onclick="event.stopPropagation(); showTpTimeList()" onfocus="this.select()">
        <div id="tp-time-list" class="tp-time-list" style="display:none">${tpTimeOptionsHtml(initTime)}</div>
      </div></div>
    <div class="tp-row"><span class="tp-key">${tr("time.duration")}</span>
      <button class="tp-val" disabled title="${esc(tr('pro.locked'))}">${tr("time.no_duration")}<span class="md-pro">${GOLD_CROWN}</span></button></div>
    <div class="tp-row tp-tz-row"><span class="tp-key">${tr("time.timezone")}</span>
      <button class="tp-select-btn" onclick="toggleTpTz(event)"><span id="tp-tz-label">${timePickTz ? esc(timePickTz) : tr("time.floating")}</span><span class="tp-caret">${SVG.chevronDown}</span></button>
      <div id="tp-tz-menu" class="tp-tz-menu" style="display:none"></div></div>
    <div class="tp-foot">
      <button class="tp-btn cancel" onclick="closeAllPopovers()">${tr("common.cancel")}</button>
      <button class="tp-btn save" onclick="saveTimePopover()">${tr("common.save")}</button>
    </div>`;
  document.body.appendChild(m);
  positionPopover(m, anchorRect || {top:120,left:120,bottom:140,right:300,width:0,height:0});
}
function showTpTimeList(){
  const list = document.getElementById("tp-time-list");
  if(!list) return;
  const i = document.getElementById("tp-time");
  highlightTpTime(i ? i.value : "");
  list.style.display = "block";
  scrollTpTimeIntoView();
}
function hideTpTimeList(){
  const list = document.getElementById("tp-time-list");
  if(list) list.style.display = "none";
}
/* Time list: 15-minute increments, easier than a two-part native picker. */
function tpRoundNow(){
  const d = new Date();
  let h = d.getHours(), m = Math.round(d.getMinutes() / 15) * 15;
  if(m === 60){ m = 0; h = (h + 1) % 24; }
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function tpTimeOptionsHtml(sel){
  let html = "";
  for(let mins = 0; mins < 24 * 60; mins += 15){
    const hh = String(Math.floor(mins / 60)).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    const t = `${hh}:${mm}`;
    html += `<div class="tp-time-opt${t === sel ? ' on' : ''}" data-t="${t}" onclick="pickTpTime('${t}')">${t}</div>`;
  }
  return html;
}
function normalizeTime(v){
  // Accept "16:15", "1615", "16.15", "16 15", "9:5" → "HH:MM" (or "" if unparseable).
  const m = (v || "").trim().match(/^(\d{1,2})\s*[:.\s]?\s*(\d{1,2})$/);
  if(!m) return "";
  let h = parseInt(m[1], 10), mn = parseInt(m[2], 10);
  if(h > 23 || mn > 59) return "";
  return String(h).padStart(2, "0") + ":" + String(mn).padStart(2, "0");
}
function pickTpTime(t){
  const i = document.getElementById("tp-time");
  if(i){ i.value = t; }
  highlightTpTime(t);
  hideTpTimeList();   // close after selecting, like Todoist
}
function highlightTpTime(v){
  const norm = normalizeTime(v);
  const list = document.getElementById("tp-time-list");
  if(!list) return;
  list.querySelectorAll(".tp-time-opt").forEach(el => {
    el.classList.toggle("on", el.getAttribute("data-t") === norm);
  });
}
function scrollTpTimeIntoView(){
  const list = document.getElementById("tp-time-list");
  if(!list) return;
  const on = list.querySelector(".tp-time-opt.on");
  if(on){ list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.clientHeight / 2; }
}
function tpLocalTz(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }catch(_){ return ""; } }
function tpTzMenuHtml(){
  const local = tpLocalTz();
  const check = `<span class="tz-check">${SVG.check}</span>`;
  const blank = `<span class="tz-check"></span>`;
  return `
    <div class="tp-tz-opt" onclick="pickTpTz(event,'')">
      ${timePickTz === "" ? check : blank}
      <span class="tz-text"><span class="tz-name">${tr("time.floating")}</span><span class="tz-desc">${tr("time.floating_desc")}</span></span>
    </div>
    ${local ? `<div class="tp-tz-opt" onclick="pickTpTz(event,'${esc(local)}')">
      ${timePickTz === local ? check : blank}
      <span class="tz-text"><span class="tz-name">${esc(local)}</span><span class="tz-desc">${tr("time.current_tz_desc")}</span></span>
    </div>` : ""}
    <button class="tp-tz-help" onclick="event.stopPropagation(); openTzHelp()"><span class="tzh-ico">${HELP_Q_ICON}</span>${tr("time.tz_help")}</button>`;
}
function toggleTpTz(ev){
  ev.stopPropagation();
  hideTpTimeList();   // don't leave the time list open behind the tz menu
  const m = document.getElementById("tp-tz-menu");
  if(!m) return;
  if(m.style.display === "none"){ m.innerHTML = tpTzMenuHtml(); m.style.display = "block"; }
  else { m.style.display = "none"; }
}
function pickTpTz(ev, tz){
  ev.stopPropagation();
  timePickTz = tz;
  const l = document.getElementById("tp-tz-label");
  if(l) l.textContent = tz ? tz : tr("time.floating");
  const m = document.getElementById("tp-tz-menu");
  if(m) m.style.display = "none";
}
function openTzHelp(){ fetch("/open-tz-help").catch(() => {}); }
function saveTimePopover(){
  const i = document.getElementById("tp-time");
  const tm = i ? normalizeTime(i.value) : "";
  const fn = timePickFn, tz = timePickTz;
  closeAllPopovers();
  if(fn) fn(tm, tz);
}

/* ---- Repeat sub-popover (opened from the date scheduler) ---- */
function repeatOrdinal(n){
  // English ordinal suffix; only used where the connector ("on the") is non-empty.
  const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function isRecurrenceStr(s){ return /^every/i.test((s || "").trim()); }
function repeatLabel(s){
  s = (s || "").toLowerCase().trim();
  const map = {
    "every day": tr("repeat.every_day"),
    "every week": tr("repeat.every_week"),
    "every weekday": tr("repeat.every_weekday"),
    "every month": tr("repeat.every_month"),
    "every year": tr("repeat.every_year"),
  };
  if(map[s]) return map[s];
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
function openRepeatPopover(ev){
  if(ev) ev.stopPropagation();
  const anchorRect = (ev && ev.currentTarget) ? ev.currentTarget.getBoundingClientRect() : null;
  closeAllPopovers();
  if(!repeatPickFn) return;
  const base = repeatAnchorISO ? new Date(repeatAnchorISO + "T00:00:00") : new Date();
  const dowFull = trList("date.dow_full");
  const monFull = trList("date.month_full");
  const onW = (tr("repeat.on") || "").trim();
  const onTh = (tr("repeat.on_the") || "").trim();
  const nth = repeatOrdinal(base.getDate());
  // strip a trailing "at HH:MM" so a timed recurrence still matches its preset
  const cur = (repeatPickCurrent || "").toLowerCase().replace(/\s+at\s+\d{1,2}:\d{2}.*$/, "").trim();
  const opts = [
    { s: "every day",     name: tr("repeat.every_day"),     when: "" },
    { s: "every week",    name: tr("repeat.every_week"),    when: onW ? `${onW} ${dowFull[base.getDay()]}` : "" },
    { s: "every weekday", name: tr("repeat.every_weekday"), when: `(${tr("repeat.every_weekday_when")})` },
    { s: "every month",   name: tr("repeat.every_month"),   when: onTh ? `${onTh} ${nth}` : "" },
    { s: "every year",    name: tr("repeat.every_year"),    when: onW ? `${onW} ${monFull[base.getMonth()]} ${nth}` : "" },
  ];
  const check = `<span class="rp-check">${SVG.check}</span>`;
  let rows = opts.map(o => `
    <div class="rp-opt" onclick="event.stopPropagation(); applyRepeat('${o.s}')">
      <span class="rp-ico">${REPEAT_ICON}</span>
      <span class="rp-text"><b>${o.name}</b>${o.when ? ` <span class="rp-when">${o.when}</span>` : ""}</span>
      ${cur === o.s ? check : ""}
    </div>`).join("");
  rows += `<div class="rp-opt rp-custom" onclick="openRepeatCustom(event)">
      <span class="rp-ico">${SVG.calendar}</span>
      <span class="rp-text"><b>${tr("repeat.custom")}</b></span>
    </div>`;
  if(repeatPickCurrent){
    rows = `<div class="rp-opt rp-clear" onclick="event.stopPropagation(); applyRepeat('')">
        <span class="rp-ico">${SVG.x || '✕'}</span>
        <span class="rp-text"><b>${tr("repeat.no_repeat")}</b></span>
      </div>` + rows;
  }
  const m = document.createElement("div");
  m.id = "repeat-popover"; m.className = "repeat-popover";
  m.innerHTML = rows;
  document.body.appendChild(m);
  positionPopover(m, anchorRect || {top:120,left:120,bottom:140,right:300,width:0,height:0});
}
function applyRepeat(s){
  const fn = repeatPickFn;
  closeAllPopovers();
  if(fn) fn(s);
}
/* Custom repeat — centred dialog (Based on / Every N unit / Ends), Todoist-style. */
let customRepeatState = null;
function parseCustomRepeat(s){
  // Best-effort parse of an existing due_string into the dialog's fields.
  s = (s || "").toLowerCase().trim();
  const st = { based: "scheduled", every: 1, unit: "day", ends: "never", endDate: "" };
  if(!s) return st;
  if(/^every!/.test(s)) st.based = "completed";
  const num = s.match(/every!?\s+(\d+)/);
  if(num) st.every = Math.max(1, parseInt(num[1], 10));
  if(/week/.test(s)) st.unit = "week";
  else if(/month/.test(s)) st.unit = "month";
  else if(/year/.test(s)) st.unit = "year";
  else st.unit = "day";
  const end = s.match(/ending\s+(\d{4}-\d{2}-\d{2})/);
  if(end){ st.ends = "date"; st.endDate = end[1]; }
  return st;
}
function buildCustomRepeat(st){
  const bang = st.based === "completed" ? "!" : "";
  // Todoist's parser likes "every day" for N=1 and "every 2 weeks" for N>1.
  let str = st.every == 1
    ? `every${bang} ${st.unit}`
    : `every${bang} ${st.every} ${st.unit}s`;
  // Verified against the Todoist API: "every … ending <ISO date>" keeps is_recurring
  // and caps the recurrence at that date (inclusive).
  if(st.ends === "date" && st.endDate) str += ` ending ${st.endDate}`;
  return str;
}
function openRepeatCustom(ev){
  if(ev) ev.stopPropagation();
  const fn = repeatPickFn;
  closeAllPopovers();
  if(!fn) return;
  repeatPickFn = fn;   // closeAllPopovers doesn't clear it, but be explicit
  customRepeatState = parseCustomRepeat(repeatPickCurrent);
  renderCustomRepeat();
}
function renderCustomRepeat(){
  const old = document.getElementById("crd-backdrop");
  if(old) old.remove();
  const st = customRepeatState;
  const radio = (on) => `<span class="crd-radio${on ? ' on' : ''}"></span>`;
  const unitOpt = (v) => `<option value="${v}"${st.unit === v ? ' selected' : ''}>${tr("repeat.unit_" + v)}</option>`;
  const bd = document.createElement("div");
  bd.id = "crd-backdrop"; bd.className = "crd-backdrop";
  bd.onclick = (e) => { if(e.target === bd) closeCustomRepeat(); };
  bd.innerHTML = `
    <div class="crd" onclick="event.stopPropagation()">
      <div class="crd-head">
        <span class="crd-title">${tr("repeat.custom_title")}</span>
        <button class="crd-close" onclick="closeCustomRepeat()">${SVG.close || '✕'}</button>
      </div>
      <div class="crd-body">
        <div class="crd-section">
          <div class="crd-label">${tr("repeat.based_on")}</div>
          <label class="crd-opt" onclick="setCrd('based','scheduled')">${radio(st.based==='scheduled')}<span>${tr("repeat.scheduled_date")}</span></label>
          <label class="crd-opt" onclick="setCrd('based','completed')">${radio(st.based==='completed')}<span>${tr("repeat.completed_date")}</span></label>
        </div>
        <div class="crd-section">
          <div class="crd-label">${tr("repeat.every_label")}</div>
          <div class="crd-every">
            <input type="number" min="1" max="999" class="crd-num" value="${st.every}"
              onchange="setCrd('every', Math.max(1, parseInt(this.value,10)||1))">
            <select class="crd-unit" onchange="setCrd('unit', this.value)">
              ${["day","week","month","year"].map(unitOpt).join("")}
            </select>
          </div>
        </div>
        <div class="crd-section">
          <div class="crd-label">${tr("repeat.ends")}</div>
          <label class="crd-opt" onclick="setCrd('ends','never')">${radio(st.ends==='never')}<span>${tr("repeat.ends_never")}</span></label>
          <label class="crd-opt" onclick="setCrd('ends','date')">${radio(st.ends==='date')}<span>${tr("repeat.ends_on")}</span></label>
          ${st.ends === 'date' ? `<input type="date" class="crd-enddate"
              value="${esc(st.endDate || repeatAnchorISO || todayISO())}"
              min="${esc(repeatAnchorISO || todayISO())}"
              onchange="setCrd('endDate', this.value)">` : ""}
        </div>
      </div>
      <div class="crd-foot">
        <button class="tp-btn cancel" onclick="closeCustomRepeat()">${tr("common.cancel")}</button>
        <button class="tp-btn save" onclick="saveCustomRepeat()">${tr("common.save")}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
}
function setCrd(key, val){
  if(!customRepeatState) return;
  // The end date can't be before the task's own date — a recurrence can't finish
  // before it starts. Clamp to the task date (or today) and keep the floor on the input.
  const minEnd = repeatAnchorISO || todayISO();
  let clamped = false;
  if(key === "endDate" && val && val < minEnd){ val = minEnd; clamped = true; }
  customRepeatState[key] = val;
  if(key === "ends" && val === "date" && !customRepeatState.endDate) customRepeatState.endDate = minEnd;
  // Re-render when a change affects layout (radio state / end-date row) or when the
  // end date was clamped, so the input shows the corrected value.
  if(key === "based" || key === "ends" || clamped) renderCustomRepeat();
}
function closeCustomRepeat(){
  const bd = document.getElementById("crd-backdrop");
  if(bd) bd.remove();
  customRepeatState = null;
}
function saveCustomRepeat(){
  const st = customRepeatState;
  const str = st ? buildCustomRepeat(st) : "";
  closeCustomRepeat();
  applyRepeat(str);
}

/* ---- Task-modal field pickers (Todoist-style popovers) ---- */
function openModalDate(ev, id){
  // Stop the bubble so the global outside-click handler doesn't immediately close it.
  if(ev) ev.stopPropagation();
  const t = T(id);
  timePickTz = (t && t.due_timezone) || "";
  // Reuse the shared date popover; pass a time sub-picker that writes due_time + tz
  // (defaulting the date to today if a time is set on an undated task).
  repeatAnchorISO = (t && t.due_date) || "";
  datePickCurrent = (t && t.due_date) || "";
  openDatePicker("md-date-btn",
    function(v){ upd(id, "due_date", v); if(!v){ upd(id, "due_time", ""); } renderModal(); },
    function(tm, tz){
      const tt = T(id);
      if(tm && tt && !tt.due_date) upd(id, "due_date", todayISO());
      upd(id, "due_time", tm);
      if(tz !== undefined) upd(id, "due_timezone", tz || "");
      renderModal();
    },
    (t && t.due_time) || "",
    function(rs){
      const tt = T(id);
      if(rs && tt && !tt.due_date) upd(id, "due_date", todayISO());
      upd(id, "due_string", rs);
      renderModal();
    },
    // Only treat the string as a recurrence — Todoist also echoes a plain date back
    // as due_string ("2026-06-19"), which must NOT show up in the Repeat slot.
    (t && isRecurrenceStr(t.due_string)) ? t.due_string : "");
}
function openModalPriority(ev, id){
  ev.stopPropagation();
  closeAllPopovers();
  const t = T(id); if(!t) return;
  const items = [
    {id:"P1", cls:"p1"}, {id:"P2", cls:"p2"}, {id:"P3", cls:"p3"}, {id:"P4", cls:"p4"},
  ];
  const m = document.createElement("div");
  m.id = "prio-popover"; m.className = "prio-popover";
  m.innerHTML = items.map(p => `
    <div class="prio-option" onclick="event.stopPropagation(); upd('${id}','priority','${p.id}'); closeAllPopovers(); renderModal()">
      <span class="pflag" style="color:var(--${p.cls})">${p.id === "P4" ? SVG.flag : SVG.flagFill}</span>
      <span class="pname">${tr("prio." + p.id.toLowerCase())}</span>
      ${t.priority === p.id ? `<span class="pcheck">✓</span>` : ""}
    </div>`).join("");
  document.body.appendChild(m);
  positionPopover(m, ev.currentTarget.getBoundingClientRect());
}
function modalLabelsItemsHtml(id){
  const t = T(id); const sel = (t && t.chosen_labels) || [];
  return ALL_LABELS.map(l => `
    <div class="prio-option" data-label="${esc(l)}" onclick="event.stopPropagation(); toggleLabel('${id}','${l}'); rebuildModalLabels('${id}')">
      <span class="pflag" style="color:${lblColor(l)}">${SVG.labelTag}</span>
      <span class="pname">${esc(l)}</span>
      ${sel.includes(l) ? `<span class="pcheck">✓</span>` : ""}
    </div>`).join("");
}
function rebuildModalLabels(id){
  const box = document.getElementById("modal-labels-items");
  if(box) box.innerHTML = modalLabelsItemsHtml(id);
}
function filterModalLabels(q){
  q = (q || "").trim().toLowerCase();
  document.querySelectorAll("#modal-labels-items .prio-option").forEach(el => {
    el.style.display = (el.dataset.label || "").toLowerCase().includes(q) ? "" : "none";
  });
}
function openModalLabels(ev, id){
  ev.stopPropagation();
  closeAllPopovers();
  if(!ALL_LABELS.length){ showToast(tr("fl.no_labels"), "warn"); return; }
  const m = document.createElement("div");
  m.id = "labels-popover"; m.className = "labels-popover";
  m.innerHTML = `<input class="labels-search" id="modal-labels-search" placeholder="${tr('labels.search_ph')}" oninput="filterModalLabels(this.value)" onclick="event.stopPropagation()"><div id="modal-labels-items">${modalLabelsItemsHtml(id)}</div>`;
  document.body.appendChild(m);
  positionPopover(m, ev.currentTarget.getBoundingClientRect());
  setTimeout(() => { const i = document.getElementById("modal-labels-search"); if(i) i.focus(); }, 0);
}
function openModalProject(ev, id){
  ev.stopPropagation();
  closeAllPopovers();
  const t = T(id); if(!t) return;
  const m = document.createElement("div");
  m.id = "project-popover"; m.className = "labels-popover";
  let rows = "";
  projects.forEach(p => {
    const on = t.project === p && !t.section;
    rows += `<div class="prio-option" onclick="event.stopPropagation(); upd('${id}','project','${esc(p)}'); upd('${id}','section',''); closeAllPopovers(); renderModal()">
      <span class="pflag" style="color:${projColor(p)}">${SVG.hash}</span>
      <span class="pname">${esc(p)}</span>
      ${on ? `<span class="pcheck">✓</span>` : ""}
    </div>`;
    (projectSections[p] || []).forEach(s => {
      const onS = t.project === p && t.section === s;
      rows += `<div class="prio-option" style="padding-left:28px" onclick="event.stopPropagation(); upd('${id}','project','${esc(p)}'); upd('${id}','section','${esc(s)}'); closeAllPopovers(); renderModal()">
        <span class="pname">${esc(s)}</span>
        ${onS ? `<span class="pcheck">✓</span>` : ""}
      </div>`;
    });
  });
  m.innerHTML = rows;
  document.body.appendChild(m);
  positionPopover(m, ev.currentTarget.getBoundingClientRect());
}

function positionPopover(el, triggerRect){
  // Measure after insertion in DOM
  const w = el.offsetWidth || 240;
  const h = el.offsetHeight || 300;
  const pad = 8;
  let left = triggerRect.left;
  if(left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
  if(left < pad) left = pad;
  // Try below; if doesn't fit, place above; if neither, pin to top
  let top = triggerRect.bottom + 4;
  if(top + h > window.innerHeight - pad){
    const above = triggerRect.top - h - 4;
    if(above >= pad) top = above;
    else top = Math.max(pad, window.innerHeight - h - pad);
  }
  el.style.left = left + "px";
  el.style.top  = top + "px";
}
function applyInlinePrio(p){
  if(!inlineAdd) return;
  inlineAdd.priority = p;
  const btn = document.getElementById("ia-prio-btn");
  if(!btn) return;
  const lbl = btn.querySelector("#ia-prio-lbl");
  btn.classList.remove("p1","p2","p3","has-label");
  if(p !== "P4"){
    btn.classList.add(p.toLowerCase(), "has-label");
    lbl.textContent = p;
    lbl.style.display = "";
  } else if(lbl){
    lbl.style.display = "none";
  }
}

function showPrioMenu(){
  closeAllPopovers();
  const btn = document.getElementById("ia-prio-btn");
  if(!btn) return;
  const r = btn.getBoundingClientRect();
  const cur = (inlineAdd && inlineAdd.priority) || "P4";
  const items = [
    {id:"P1", name:tr("prio.p1"), cls:"p1"},
    {id:"P2", name:tr("prio.p2"), cls:"p2"},
    {id:"P3", name:tr("prio.p3"), cls:"p3"},
    {id:"P4", name:tr("prio.p4"), cls:"p4"},
  ];
  const m = document.createElement("div");
  m.id = "prio-popover";
  m.className = "prio-popover";
  m.innerHTML = items.map(p => `
    <div class="prio-option" onclick="event.stopPropagation(); setInlinePrio('${p.id}')">
      <span class="pflag" style="color:var(--${p.cls})">${p.id === "P4" ? SVG.flag : SVG.flagFill}</span>
      <span class="pname">${p.name}</span>
      ${cur === p.id ? `<span class="pcheck">✓</span>` : ""}
    </div>`).join("");
  document.body.appendChild(m);
  positionPopover(m, r);
}

function closePrioMenu(){
  const m = document.getElementById("prio-popover");
  if(m) m.remove();
}

function setInlinePrio(p){
  applyInlinePrio(p);
  closeAllPopovers();
}
function onInlineProjChange(val){
  if(!inlineAdd) return;
  const idx = val.indexOf("|");
  inlineAdd.proj = idx < 0 ? val : val.slice(0, idx);
  inlineAdd.section = idx < 0 ? "" : val.slice(idx + 1);
}
let inlineAddAttachment = null;
const MAX_UPLOAD = 5 * 1024 * 1024;   // Todoist Free tier

async function uploadFileToTodoist(file){
  if(file.size > MAX_UPLOAD){
    throw new Error(tr("error.file_too_big_5mb", {size: fmtBytes(file.size)}));
  }
  const b64 = await fileToBase64(file);
  const r = await fetch("/api/upload", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({filename:file.name, type:file.type||"application/octet-stream", data:b64}),
  });
  const d = await r.json();
  if(d.error) throw new Error(d.error);
  return d;
}

async function onInlineAttach(ev){
  const file = ev.target.files && ev.target.files[0];
  if(!file) return;
  const chip = document.getElementById("ia-attach-chip");
  const btn = document.getElementById("ia-attach-btn");
  if(chip){
    chip.style.display = "";
    chip.innerHTML = `<span class="label-chip">${tr("upload.uploading_short", {file: esc(file.name)})}</span>`;
  }
  try {
    const d = await uploadFileToTodoist(file);
    inlineAddAttachment = d;
    if(btn) btn.classList.add("has-file");
    if(chip) chip.innerHTML = `<span class="label-chip">📎 ${esc(d.file_name||file.name)} <span style="color:var(--text-3); margin-left:4px">${fmtBytes(d.file_size||file.size)}</span><span class="ch-x" onclick="clearInlineAttach()" title="${tr("common.delete")}">×</span></span>`;
  } catch(e){
    if(chip) chip.innerHTML = `<span class="label-chip" style="color:var(--accent); border-color:var(--accent)">${esc(e.message)}<span class="ch-x" onclick="clearInlineAttach()">×</span></span>`;
    inlineAddAttachment = null;
  } finally {
    ev.target.value = "";
  }
}

function clearInlineAttach(){
  inlineAddAttachment = null;
  const chip = document.getElementById("ia-attach-chip");
  if(chip){ chip.style.display = "none"; chip.innerHTML = ""; }
  const btn = document.getElementById("ia-attach-btn");
  if(btn) btn.classList.remove("has-file");
}

async function submitInlineAdd(){
  if(!inlineAdd) return;
  const name = document.getElementById("ia-name").value.trim();
  if(!name){ cancelInlineAdd(); return; }
  const desc = document.getElementById("ia-desc").value.trim();
  const attach = inlineAddAttachment;
  const wasGlobal = !!inlineAdd.global;
  const projName = inlineAdd.proj;
  const d = await post("/api/task_add", {
    text:name, project:inlineAdd.proj, section:inlineAdd.section,
    description:desc, priority:inlineAdd.priority, due_date:inlineAdd.date,
    due_time: inlineAdd.time || "", due_timezone: inlineAdd.tz || "",
    labels: inlineAdd.labels || [],
    where:"bottom"
  });
  // If file attached → also create a comment with the attachment on the new task
  if(attach && d && d.new_id){
    await post("/api/comment_add", {id: d.new_id, text: "", attachment: attach});
  }
  inlineAdd = null;
  inlineAddAttachment = null;
  closeQuickAddBox();
  closeAllPopovers();
  render();
  // The quick-add dialog can target a project you are not looking at — confirm it landed.
  if(wasGlobal) showToast(tr("toast.task_added", {project: projName}), "ok");
}
/* ---- Global quick add (Todoist "Q") — the same .add-form in a floating dialog,
   works from every view (Today / Upcoming / filters / search / calendar). The
   section-level "+ Add task" buttons keep the inline form. ---- */
function quickAdd(){ openQuickAdd(); }
function openQuickAdd(opts){
  if(!connected) return;
  closeAllPopovers();
  let proj = currentProject() || "Inbox";
  if(proj === NOTEBOOK_PROJECT) proj = "Inbox";   // notebook pages have their own create flow
  const o = opts || {};
  const date = o.date || (currentView === "today" ? todayISO() : "");
  const time = (o.date && o.time) || "";          // a preset time only makes sense with a date
  inlineAdd = {proj, section:"", date, time, tz:"", priority:"P4", labels:[], global:true};
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();
  document.getElementById("qa-dialog").innerHTML = renderAddForm(proj, "");
  document.getElementById("qa-backdrop").classList.add("show");
  applyInlineDate(date);
  const i = document.getElementById("ia-name"); if(i) i.focus();
}
function closeQuickAddBox(){
  const bd = document.getElementById("qa-backdrop");
  if(bd) bd.classList.remove("show");
  const dlg = document.getElementById("qa-dialog");
  if(dlg) dlg.innerHTML = "";
  if(calAddCtx) calAddCtx = null;   // ghost slot goes away with the dialog (caller re-renders)
}

