/* ============ CALENDAR (Stage A — own tasks, day/week/month; no Google link yet) ============ */
const CAL_HOUR_PX = 48;          // grid height of one hour
const CAL_EVENT_MIN = 60;        // visual slot of a timed task, in minutes (tasks have no duration)
const CAL_PRIO_COLOR = {P1:"var(--p1)", P2:"var(--p2)", P3:"var(--p3)", P4:"var(--p4)"};
let calViewMode = (function(){ try{ return localStorage.getItem("cal_view") || "week"; }catch(_){ return "week"; } })();
if(!["day","week","month"].includes(calViewMode)) calViewMode = "week";
let calAnchor = null;            // ISO of the focused day (week shows its Monday-week, month its month)
let calScrollTop = null;         // grid scroll, preserved across the 10s poll re-renders

/* ---- Google Calendar (read-only, via the calendar's secret iCal URL).
   The server fetches/caches the ICS; the client caches the expanded range
   and re-renders when a fresh fetch lands. ---- */
let gcalInfo = {connected:false, name:"", sync_ready:false};   // from /api/state
let gcalCache = {key:"", at:0, events:null, loading:false};
const GCAL_TTL = 5*60*1000;

function gcalReset(){ gcalCache = {key:"", at:0, events:null, loading:false}; }

function calGcalEvents(startISO, nDays){
  if(!gcalInfo.connected) return [];
  const key = startISO + ":" + nDays;
  if(gcalCache.key === key && gcalCache.events && Date.now() - gcalCache.at < GCAL_TTL)
    return gcalCache.events;
  if(gcalCache.loading) return (gcalCache.key === key && gcalCache.events) || [];
  const stale = gcalCache.key === key ? gcalCache.events : null;
  gcalCache = {key, at:0, events: stale, loading:true};
  fetch(`/api/gcal_events?start=${startISO}&days=${nDays}`)
    .then(r => r.json())
    .then(d => {
      gcalCache = {key, at: Date.now(), events: d.events || [], loading:false};
      if(currentView === "calendar") render();
    })
    .catch(() => { gcalCache.loading = false; });
  return stale || [];
}

async function gcalConnectAsk(){
  const url = await uiPrompt({
    title: tr("cal.gcal_connect_t"),
    body: tr("cal.gcal_connect_body"),
    placeholder: "https://calendar.google.com/…/basic.ics",
    ok: tr("cal.gcal_connect_ok"),
    maxlength: 500
  });
  if(!url) return;
  try {
    await post("/api/gcal_set_url", {url});
    gcalReset();
    showToast(tr("cal.gcal_connected", {name: gcalInfo.name}), "ok");
    render();
  } catch(e){
    showToast(tr("cal.gcal_bad", {msg: e.message}), "error");
  }
}

async function gcalDisconnectAsk(){
  const yes = await uiConfirm({
    title: tr("cal.gcal_disc_t"),
    body: tr("cal.gcal_disc_body", {name: gcalInfo.name}),
    ok: tr("cal.gcal_disc_ok")
  });
  if(!yes) return;
  try { await post("/api/gcal_disconnect", {}); } catch(e){}
  gcalReset();
  render();
}

// The calendar's ⋯ menu. Two independent Google levels: view-only (secret
// iCal URL, no cloud project) and full sync (OAuth, events + reminders).
function openCalMenu(ev){
  ev.stopPropagation();
  const m = document.getElementById("ctx-menu");
  const view = gcalInfo.connected
    ? `<div class="ctx-mi" onclick="closeCtx(); gcalDisconnectAsk()"><span class="ctx-ico">${SVG.cloudOff}</span><span class="label">${tr("cal.gcal_disconnect")}</span></div>`
    : `<div class="ctx-mi" onclick="closeCtx(); gcalConnectAsk()"><span class="ctx-ico">${SVG.cloud}</span><span class="label">${tr("cal.gcal_connect")}</span></div>`;
  const syn = gcalInfo.sync_ready
    ? `<div class="ctx-mi" onclick="closeCtx(); gcalSyncDisconnectAsk()"><span class="ctx-ico">${SVG.check}</span><span class="label">${tr("cal.sync_off")}</span></div>`
    : `<div class="ctx-mi" onclick="closeCtx(); gcalSyncSetupAsk()"><span class="ctx-ico">${SVG.refresh}</span><span class="label">${tr("cal.sync_setup")}</span></div>`;
  m.innerHTML = `${view}
    ${syn}
    <div class="ctx-sep"></div>
    <div class="ctx-mi" onclick="closeCtx(); openGuide('calendar')"><span class="ctx-ico">${SVG.help}</span><span class="label">${tr("cal.menu_help")}</span></div>
    <div class="ctx-mi" onclick="closeCtx(); openGuide('calendar-simple')"><span class="ctx-ico">${SVG.cloud}</span><span class="label">${tr("cal.menu_help_simple")}</span></div>
    <div class="ctx-mi" onclick="closeCtx(); openGuide('calendar-full')"><span class="ctx-ico">${SVG.book}</span><span class="label">${tr("cal.menu_help_full")}</span></div>`;
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}

/* ---- Full sync (OAuth): the user pastes their own Google Cloud OAuth
   client id/secret; the server opens the consent screen in the browser and
   receives the loopback callback. ---- */
function gcalSyncDialog(){
  return new Promise(resolve => {
    window._gcSyncFinish = ok => {
      const cid = document.getElementById("gc-cid"), cs = document.getElementById("gc-cs");
      const v = ok ? {client_id: (cid ? cid.value.trim() : ""), client_secret: (cs ? cs.value.trim() : "")} : null;
      document.getElementById("confirm-backdrop").classList.remove("show");
      resolve(v);
    };
    const extra = `<input id="gc-cid" class="pd-input" type="text" placeholder="Client ID" maxlength="200">
      <input id="gc-cs" class="pd-input" type="text" placeholder="Client secret" maxlength="200" style="margin-top:8px">`;
    _openDialog(`
      <div class="pd-head">${esc(tr("cal.sync_setup_t"))}</div>
      ${_uiBody(tr("cal.sync_setup_body"), extra)}
      <div class="pd-foot">
        <button class="pd-btn cancel" style="margin-right:auto" onclick="openGuide('calendar-full')">${esc(tr("cal.sync_help"))}</button>
        <button class="pd-btn cancel" onclick="_gcSyncFinish(false)">${esc(tr("common.cancel"))}</button>
        <button class="pd-btn primary" onclick="_gcSyncFinish(true)">${esc(tr("cal.sync_setup_ok"))}</button>
      </div>`);
  });
}

async function gcalSyncSetupAsk(){
  const v = await gcalSyncDialog();
  if(!v) return;
  if(!v.client_id || !v.client_secret){
    showToast(tr("cal.sync_need_both"), "error");
    return;
  }
  try {
    await post("/api/gcal_oauth_creds", v);
    showToast(tr("cal.sync_browser"), "ok");
  } catch(e){
    showToast(tr("cal.gcal_bad", {msg: e.message}), "error");
  }
}

async function gcalSyncDisconnectAsk(){
  const yes = await uiConfirm({
    title: tr("cal.sync_off_t"),
    body: tr("cal.sync_off_body"),
    ok: tr("cal.gcal_disc_ok")
  });
  if(!yes) return;
  try { await post("/api/gcal_oauth_disconnect", {}); } catch(e){}
  render();
}

// Read-only details dialog (a Google event has no task modal to open).
function gcalShow(i){
  const g = (gcalCache.events || [])[i];
  if(!g) return;
  const d = calParseISO(g.date);
  const monFull = I18N.list("date.month_full");
  const when = `${d.getDate()} ${monFull[d.getMonth()]} ${d.getFullYear()}`
    + (g.time ? `, ${g.time}–${g.end_time}` : "");
  uiAlert({title: g.title, body: when, note: tr("cal.gcal_event_note", {name: gcalInfo.name})});
}

function calMonday(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - (x.getDay() + 6) % 7);   // Mon=0 … Sun=6
  return x;
}
const calParseISO = s => { const p = s.split("-").map(Number); return new Date(p[0], p[1]-1, p[2]); };
function calShift(n){
  const d = calParseISO(calAnchor);
  if(calViewMode === "day") d.setDate(d.getDate() + n);
  else if(calViewMode === "month"){ d.setDate(1); d.setMonth(d.getMonth() + n); }
  else d.setDate(d.getDate() + n*7);
  calAnchor = iso(d);
  render();
}
function calGotoToday(){ calAnchor = todayISO(); render(); }
function calSetView(m){
  calViewMode = m;
  try{ localStorage.setItem("cal_view", m); }catch(_){ }
  render();
}
function calOpenDay(dateISO){ calAnchor = dateISO; calSetView("day"); }

function calToolbarHtml(label){
  const CHEV_L = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const CHEV_R = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  const sw = ["day","week","month"].map(m =>
    `<button class="${calViewMode===m?'on':''}" onclick="calSetView('${m}')">${esc(tr("cal."+m))}</button>`).join("");
  return `<div class="cal-toolbar">
      <button class="cal-tb-btn cal-tb-today" onclick="calGotoToday()">${esc(tr("date.today"))}</button>
      <button class="cal-tb-btn" onclick="calShift(-1)" title="${esc(tr("cal.prev_week"))}">${CHEV_L}</button>
      <button class="cal-tb-btn" onclick="calShift(1)" title="${esc(tr("cal.next_week"))}">${CHEV_R}</button>
      <span class="cal-tb-label">${esc(label)}</span>
      <div class="cal-view-switch">${sw}</div>
      <button class="cal-tb-btn cal-menu-btn" onclick="openCalMenu(event)" title="${esc(gcalInfo.connected ? gcalInfo.name : "")}">${SVG.more}</button>
    </div>`;
}

// Shown in the calendar view only while no Google link is active (neither the
// view-only iCal nor full OAuth sync). Disappears once either is connected —
// from then on the ⋯ menu is the only entry point.
function calBannerHtml(){
  if(gcalInfo.connected || gcalInfo.sync_ready) return "";
  return `<div class="cal-banner">
      <span class="bico">${SVG.cloud}</span>
      <div class="btxt">
        <div class="btitle">${esc(tr("cal.banner_title"))}</div>
        <div class="bsub">${esc(tr("cal.banner_sub"))}</div>
      </div>
      <div class="bacts">
        <div class="brow"><a class="blink" onclick="openGuide('calendar-simple')">${esc(tr("cal.sync_help"))}</a>
          <button class="bbtn ghost" onclick="gcalConnectAsk()">${esc(tr("cal.banner_simple"))}</button></div>
        <div class="brow"><a class="blink" onclick="openGuide('calendar-full')">${esc(tr("cal.sync_help"))}</a>
          <button class="bbtn primary" onclick="gcalSyncSetupAsk()">${esc(tr("cal.banner_full"))}</button></div>
      </div>
    </div>`;
}

function calToolbarLabel(a, b){
  const monFull = I18N.list("date.month_full"), monShort = I18N.list("date.month_short");
  if(a.getMonth() === b.getMonth()) return `${monFull[a.getMonth()]} ${a.getFullYear()}`;
  if(a.getFullYear() === b.getFullYear()) return `${monShort[a.getMonth()]} – ${monShort[b.getMonth()]} ${a.getFullYear()}`;
  return `${monShort[a.getMonth()]} ${a.getFullYear()} – ${monShort[b.getMonth()]} ${b.getFullYear()}`;
}

// Overlapping timed entries sit side by side: greedy column per event, then
// each event's width = the widest overlap group it belongs to. Tasks occupy
// the visual CAL_EVENT_MIN slot; Google events use their real duration (.dur).
function calLayoutDay(evs){
  const durOf = e => e.dur || CAL_EVENT_MIN;
  const nameOf = e => (e.t ? e.t.text : e.g.title) || "";
  evs.sort((a,b) => a.start - b.start || nameOf(a).localeCompare(nameOf(b)));
  const placed = [];
  evs.forEach(e => {
    let col = 0;
    while(placed.some(p => p.col === col && p.start + durOf(p) > e.start)) col++;
    e.col = col;
    placed.push(e);
  });
  evs.forEach(e => {
    const overlap = evs.filter(o => o.start < e.start + durOf(e) && o.start + durOf(o) > e.start);
    e.cols = Math.max(...overlap.map(o => o.col)) + 1;
  });
}

function renderCalendar(row){
  if(!calAnchor) calAnchor = todayISO();
  if(calViewMode === "month"){ renderCalMonth(row); return; }
  const nDays = calViewMode === "day" ? 1 : 7;
  const start = calViewMode === "day" ? calParseISO(calAnchor) : calMonday(calParseISO(calAnchor));
  const days = [];
  for(let i = 0; i < nDays; i++){ const d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
  const dow = I18N.list("date.dow_short");   // Sun..Sat — index matches Date.getDay()
  const PRIO_ORD = {P1:1, P2:2, P3:3, P4:4};

  const byDay = {};
  days.forEach(d => byDay[iso(d)] = {allday:[], gallday:[], timed:[]});
  state.forEach(t => {
    if(t.completed || !t.due_date) return;
    const slot = byDay[t.due_date];
    if(!slot) return;
    if(t.due_time){
      const p = t.due_time.split(":");
      slot.timed.push({t, start: (+p[0])*60 + (+p[1] || 0)});
    } else slot.allday.push(t);
  });
  calGcalEvents(iso(start), nDays).forEach((g, gi) => {
    const slot = byDay[g.date];
    if(!slot) return;
    if(g.all_day) slot.gallday.push({g, gi});
    else {
      const p = g.time.split(":");
      slot.timed.push({g, gi, start: (+p[0])*60 + (+p[1] || 0), dur: g.dur || 60});
    }
  });

  const headCells = days.map(d => {
    const k = iso(d), today = isToday(k) ? " today" : "";
    let chips = byDay[k].allday
      .sort((a,b) => (PRIO_ORD[a.priority]||4) - (PRIO_ORD[b.priority]||4) || (a.text||"").localeCompare(b.text||""))
      .map(t => `<div class="cal-chip" onclick="openModal('${t.id}')" title="${esc(t.text)}"><span class="cal-chip-dot" style="background:${CAL_PRIO_COLOR[t.priority] || "var(--p4)"}"></span><span class="cal-chip-txt">${esc(t.text)}</span><button class="cal-done" onclick="event.stopPropagation(); completeTask('${t.id}')" title="${esc(tr("sticky.complete"))}"></button></div>`)
      .join("");
    chips += byDay[k].gallday
      .map(o => `<div class="cal-chip gcal" onclick="gcalShow(${o.gi})" title="${esc(o.g.title)}"><span class="cal-chip-txt">${esc(o.g.title)}</span></div>`)
      .join("");
    return `<div class="cal-head-cell${today}">
      <div class="cal-dhead"><span class="cal-dow">${esc(dow[d.getDay()] || "")}</span><span class="cal-dnum">${d.getDate()}</span></div>
      <div class="cal-allday">${chips}</div>
    </div>`;
  }).join("");

  const gutter = Array.from({length:24}, (_,h) =>
    `<div class="cal-gutter-hour">${h ? String(h).padStart(2,"0") + ":00" : ""}</div>`).join("");

  const now = new Date();
  const cols = days.map(d => {
    const k = iso(d), today = isToday(k);
    const evs = byDay[k].timed;
    calLayoutDay(evs);
    let html = evs.map(e => {
      const w = 100 / e.cols;
      if(e.g){
        const g = e.g, h = Math.max(18, e.dur/60*CAL_HOUR_PX - 2);
        return `<div class="cal-event gcal" style="top:${e.start/60*CAL_HOUR_PX}px;height:${h}px;left:calc(${e.col*w}% + 2px);width:calc(${w}% - 4px)" onclick="gcalShow(${e.gi})" title="${esc(g.time + "–" + g.end_time + "  " + g.title)}"><span class="cal-ev-time">${esc(g.time)}</span><span class="cal-ev-title">${esc(g.title)}</span></div>`;
      }
      const t = e.t;
      return `<div class="cal-event" style="top:${e.start/60*CAL_HOUR_PX}px;height:${CAL_EVENT_MIN/60*CAL_HOUR_PX - 2}px;left:calc(${e.col*w}% + 2px);width:calc(${w}% - 4px);border-left-color:${CAL_PRIO_COLOR[t.priority] || "transparent"}" onclick="openModal('${t.id}')" title="${esc((t.due_time || "") + "  " + (t.text || ""))}"><span class="cal-ev-time">${esc(t.due_time || "")}</span><span class="cal-ev-title">${esc(t.text || "")}</span><button class="cal-done" onclick="event.stopPropagation(); completeTask('${t.id}')" title="${esc(tr("sticky.complete"))}"></button></div>`;
    }).join("");
    if(today) html += `<div class="cal-now" style="top:${(now.getHours()*60 + now.getMinutes())/60*CAL_HOUR_PX}px"></div>`;
    if(calAddCtx && calAddCtx.date === k){
      html += `<div class="cal-ghost" style="top:${calAddCtx.mins/60*CAL_HOUR_PX}px;height:${CAL_EVENT_MIN/60*CAL_HOUR_PX - 2}px"></div>`;
    }
    return `<div class="cal-col${today ? " today" : ""}" style="height:${24*CAL_HOUR_PX}px" onclick="calSlotClick(event, '${k}')">${html}</div>`;
  }).join("");

  const monFull = I18N.list("date.month_full");
  const label = calViewMode === "day"
    ? `${start.getDate()} ${monFull[start.getMonth()]} ${start.getFullYear()}`
    : calToolbarLabel(days[0], days[6]);
  row.innerHTML = `<div class="cal-wrap">
    ${calToolbarHtml(label)}
    ${calBannerHtml()}
    <div class="cal-scroll" onscroll="calScrollTop = this.scrollTop">
      <div class="cal-head" style="--cal-cols:${nDays}">
        <div class="cal-head-gutter">${esc(tr("cal.all_day"))}</div>
        ${headCells}
      </div>
      <div class="cal-body" style="--cal-cols:${nDays}">
        <div>${gutter}</div>
        ${cols}
      </div>
    </div>
  </div>`;

  const sc = row.querySelector(".cal-scroll");
  if(sc) sc.scrollTop = calScrollTop !== null
    ? calScrollTop
    : Math.max(0, (now.getHours() - 2) * CAL_HOUR_PX);
}

/* ---- Month view (Google-style): Mon–Sun grid, all-day chips first then timed
   chronologically, "+N more" past the cell budget. Day number / "+N more" → day
   view of that date; an empty spot on the cell → quick add with that date. ---- */
function renderCalMonth(row){
  const a = calParseISO(calAnchor);
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const daysIn = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  const gridStart = calMonday(first);
  const nRows = Math.ceil((((first.getDay() + 6) % 7) + daysIn) / 7);
  const cells = [];
  for(let i = 0; i < nRows*7; i++){ const d = new Date(gridStart); d.setDate(d.getDate() + i); cells.push(d); }

  const monFull = I18N.list("date.month_full");
  const dow = I18N.list("date.dow_short");   // Sun..Sat — index matches Date.getDay()
  const PRIO_ORD = {P1:1, P2:2, P3:3, P4:4};
  const byDay = {};
  cells.forEach(d => byDay[iso(d)] = []);
  state.forEach(t => {
    if(t.completed || !t.due_date) return;
    if(byDay[t.due_date]) byDay[t.due_date].push(t);
  });
  calGcalEvents(iso(gridStart), nRows*7).forEach((g, gi) => {
    if(byDay[g.date]) byDay[g.date].push({g, gi});
  });

  const LIMIT = 4;   // chips per cell; above it → LIMIT-1 chips + "+N more"
  const cellsHtml = cells.map(d => {
    const k = iso(d);
    const cls = (d.getMonth() !== a.getMonth() ? " other" : "") + (isToday(k) ? " today" : "");
    const list = byDay[k];
    list.sort((x, y) => {
      const xTime = (x.g ? x.g.time : x.due_time) || "", yTime = (y.g ? y.g.time : y.due_time) || "";
      if(!xTime !== !yTime) return xTime ? 1 : -1;             // all-day before timed
      if(xTime && xTime !== yTime) return xTime.localeCompare(yTime);  // timed → chronological
      const xg = x.g ? 1 : 0, yg = y.g ? 1 : 0;
      if(xg !== yg) return xg - yg;                            // among all-day: tasks first
      if(xg) return (x.g.title||"").localeCompare(y.g.title||"");
      return (PRIO_ORD[x.priority]||4) - (PRIO_ORD[y.priority]||4) || (x.text||"").localeCompare(y.text||"");
    });
    const show = list.length > LIMIT ? list.slice(0, LIMIT - 1) : list;
    let chips = show.map(it => it.g
      ? `<div class="cal-mchip gcal" onclick="event.stopPropagation(); gcalShow(${it.gi})" title="${esc((it.g.time ? it.g.time + "  " : "") + it.g.title)}">` +
          (it.g.time ? `<span class="t">${esc(it.g.time)}</span>` : "") +
          `<span class="x">${esc(it.g.title.split("\n")[0])}</span>
      </div>`
      : `<div class="cal-mchip" onclick="event.stopPropagation(); openModal('${it.id}')" title="${esc((it.due_time ? it.due_time + "  " : "") + (it.text||""))}">` +
        (it.due_time
          ? `<span class="t">${esc(it.due_time)}</span>`
          : `<span class="cal-chip-dot" style="background:${CAL_PRIO_COLOR[it.priority] || "var(--p4)"}"></span>`) +
        `<span class="x">${esc((it.text||"").split("\n")[0])}</span><button class="cal-done" onclick="event.stopPropagation(); completeTask('${it.id}')" title="${esc(tr("sticky.complete"))}"></button>
      </div>`).join("");
    if(list.length > LIMIT){
      chips += `<div class="cal-mmore" onclick="event.stopPropagation(); calOpenDay('${k}')">${esc(tr("cal.more", {n: list.length - (LIMIT - 1)}))}</div>`;
    }
    return `<div class="cal-mcell${cls}" onclick="openQuickAdd({date:'${k}'})">
      <span class="cal-mnum" onclick="event.stopPropagation(); calOpenDay('${k}')">${d.getDate()}</span>
      ${chips}
    </div>`;
  }).join("");

  const dowRow = [1,2,3,4,5,6,0].map(i => `<span>${esc(dow[i] || "")}</span>`).join("");   // Mon..Sun
  row.innerHTML = `<div class="cal-wrap">
    ${calToolbarHtml(`${monFull[a.getMonth()]} ${a.getFullYear()}`)}
    ${calBannerHtml()}
    <div class="cal-mwrap">
      <div class="cal-mdows">${dowRow}</div>
      <div class="cal-mgrid">${cellsHtml}</div>
    </div>
  </div>`;
}

/* ---- Quick add from an empty time slot — opens the global quick-add dialog
   with the slot's date + time prefilled; the ghost marks the picked slot. ---- */
let calAddCtx = null;            // {date, mins} — the slot picked for the quick add

function calTimeStr(mins){
  return String(Math.floor(mins/60)).padStart(2,"0") + ":" + String(mins%60).padStart(2,"0");
}

function calSlotClick(ev, dateISO){
  // A click on a task block opens the modal (its own onclick) — just drop the ghost.
  if(ev.target.closest(".cal-event")){ closeCalAdd(); return; }
  closeAllPopovers();
  const rect = ev.currentTarget.getBoundingClientRect();
  let mins = Math.floor((ev.clientY - rect.top) / (CAL_HOUR_PX/2)) * 30;   // snap to :00/:30
  mins = Math.max(0, Math.min(23*60 + 30, mins));
  calAddCtx = {date: dateISO, mins};
  render();                                      // draws the ghost slot
  openQuickAdd({date: dateISO, time: calTimeStr(mins)});
}

function closeCalAdd(){
  if(calAddCtx){ calAddCtx = null; render(); }   // clears the ghost
}

