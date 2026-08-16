/* ============ DATA ============ */
const PRIO = [
  {id:"P1", name:"P1 — Urgent"},
  {id:"P2", name:"P2 — High"},
  {id:"P3", name:"P3 — Medium"},
  {id:"P4", name:"P4 — Normal"},
];
const PCLS = {P1:"priority_1", P2:"priority_2", P3:"priority_3", P4:"priority_4"};
// Todoist's gold "Pro" crown (filled #ffba0a), shown next to Pro-only fields.
const GOLD_CROWN = `<svg viewBox="0 0 24 24" fill="#ffba0a" aria-hidden="true"><path d="M2 18l2-10 5 5 3-7 3 7 5-5 2 10z"/><rect x="2" y="19" width="20" height="2.4" rx="1"/></svg>`;

// Labels are loaded from synced Todoist data (via /api/state into setLabels()).
// Todoist's named color palette -> hex (a fixed palette, not account data).
const TODOIST_COLORS = {
  berry_red:"#b8256f", red:"#db4035", orange:"#ff9933", yellow:"#fad000",
  olive_green:"#afb83b", lime_green:"#7ecc49", green:"#299438", mint_green:"#6accbc",
  teal:"#158fad", sky_blue:"#14aaf5", light_blue:"#96c3eb", blue:"#4073ff",
  grape:"#884dff", violet:"#af38eb", lavender:"#eb96eb", magenta:"#e05194",
  salmon:"#ff8d85", charcoal:"#808080", grey:"#b8b8b8", gray:"#b8b8b8", taupe:"#ccac93",
};
let LABELS = [];        // [{name, color}] from synced Todoist labels
let ALL_LABELS = [];    // label names, derived from LABELS
let LABEL_COLOR = {};   // name -> hex
function setLabels(list){
  LABELS = Array.isArray(list) ? list : [];
  ALL_LABELS = LABELS.map(l => l.name);
  LABEL_COLOR = {};
  LABELS.forEach(l => { LABEL_COLOR[l.name] = TODOIST_COLORS[l.color] || "#808080"; });
}
const lblColor = l => LABEL_COLOR[l] || "#808080";
let filters = [];  // saved filters [{id,name,query,color,is_favorite,is_synced}] from /api/state

const SVG = {
  hash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
  filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  cloudOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,
  pinOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  message: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  flagFill: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15" stroke="currentColor"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  paperclip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>`,
  // Todoist's exact sidebar ⋯ icon (small horizontal dots, 15×3)
  ellipsis: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,   /* Lucide ellipsis — light dots for the task-card menu */
  moreH: `<svg viewBox="0 0 15 3" width="15" height="3" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M1.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  reloadSmall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  notebook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M16 2v20"/></svg>`,
  paw: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><ellipse cx="6" cy="10.5" rx="1.8" ry="2.4"/><ellipse cx="18" cy="10.5" rx="1.8" ry="2.4"/><ellipse cx="9.5" cy="6.5" rx="1.8" ry="2.4"/><ellipse cx="14.5" cy="6.5" rx="1.8" ry="2.4"/><path d="M12 12.5c-2.8 0-5 2.2-5 4.5C7 18.7 8.4 20 10 20c.8 0 1.3-.3 2-.3s1.2.3 2 .3c1.6 0 3-1.3 3-3 0-2.3-2.2-4.5-5-4.5z"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
  moveRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  arrowDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  couch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M3 13a2 2 0 0 1 2-2 2 2 0 0 1 2 2v2h10v-2a2 2 0 0 1 2-2 2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="6" y1="19" x2="6" y2="21"/><line x1="18" y1="19" x2="18" y2="21"/></svg>`,
  chevronsRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><line x1="5" y1="20" x2="19" y2="20"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  // Todoist's label/tag icon (filled), used on task cards next to each label
  labelTag: `<svg viewBox="0 0 12 12" fill="none"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.93 1h3.427C10.264 1 11 1.736 11 2.643V6.07c0 .436-.173.854-.481 1.162L7.232 10.52a1.643 1.643 0 0 1-2.323 0L1.48 7.09a1.643 1.643 0 0 1 0-2.323L4.768 1.48A1.64 1.64 0 0 1 5.93 1m.001.91a.8.8 0 0 0-.569.235L2.145 5.362a.804.804 0 0 0 0 1.138L5.5 9.855a.804.804 0 0 0 1.138 0l3.217-3.217a.8.8 0 0 0 .236-.569V2.713a.804.804 0 0 0-.804-.804zm1.433 3.635a.91.91 0 1 0 0-1.818.91.91 0 0 0 0 1.818"/></svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`,
  puzzle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
  keyboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg>`,
};

/* ============ STATE ============ */
let state = [], projects = [], projectSections = {};
let projectMeta = {};  // name -> {id, color, is_favorite, is_inbox}, from /api/state
let archivedProjects = [];  // [{name, color, count}] — shown on the My Projects page
let showArchivedProjects = false;  // "Archived projects only" toggle on the My Projects page
const PROJECT_LIMIT = 5;  // Todoist Free tier: 5 personal projects (Inbox excluded)
const FILTER_LIMIT = 3;   // Todoist Free tier: 3 filters mirrored to the account
const INBOX_NAME = "Inbox";  // Todoist API always names the inbox project "Inbox"
const NOTEBOOK_PROJECT = "Notebook";  // the notes feature lives in this project; pinned + special in the sidebar
const projColor = p => TODOIST_COLORS[(projectMeta[p] || {}).color] || "var(--text-2)";
let pendingCount = 0;
let prefs = {};            // UI preferences from /api/state (e.g. nb_fav_dismissed)
let nbFavChecked = false;  // the notebook-favorite check runs only once per launch
let syncState = { last_push_error:"", last_pull_error:"", last_sync_at:"" };
let account = { name:"", email:"", avatar_url:"" };  // synced Todoist account
let connected = true;       // false after disconnect (no token)
let syncInterval = 30;      // background auto-sync seconds (from /api/state)
let isOffline = false;  // local-server reachability; corrected by fetchState
let currentView = "inbox";
let projectsCollapsed = false;
let modalTaskId = null;
let inlineAdd = null;
let inlineSection = null;   // {proj, after} — after="__end__" appends, else inserts after that section
let inlineRename = null;    // {proj, name} — section being renamed inline
let subAddFor = null;
let commentAddFor = null;
let searchQuery = "";
let draggedTaskId = null;
let draggedSectionName = null;
let viewMode = (function(){ try{ return localStorage.getItem("viewMode") || "board"; } catch(e){ return "board"; } })();
let calYear, calMonth;

const esc = s => (s||"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// i18n aliases (t is already the task variable — so tr)
const tr = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
const trList = k => (window.I18N ? window.I18N.list(k) : [k]);
const T = id => state.find(t=>t.id===id);

function switchLang(){
  if(!window.I18N) return;
  window.I18N.toggle().then(()=>{
    window.I18N.apply();
    updateLangToggle();
    render();
    if(window.NB) window.NB.notify();
  });
}
function updateLangToggle(){
  const b = document.getElementById("lang-toggle");
  if(b && window.I18N){
    // next language code on the button (what it will switch to)
    const langs = window.I18N.langs;
    const next = langs[(langs.indexOf(window.I18N.lang) + 1) % langs.length];
    b.textContent = next.toUpperCase();
  }
}
// LOCAL date components (no UTC drift)
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayISO = () => iso(new Date());
const isToday = d => d === todayISO();
const isOverdue = d => d && d < todayISO();
const isFuture = d => d && d > todayISO();

function fmtDate(d){
  if(!d) return "";
  if(d.length > 10) d = d.slice(0, 10);   // tolerate a stray datetime ("2026-07-22T15:00:00")
  const today = todayISO();
  if(d === today) return tr("date.today");
  // local-component diff (no timezone math)
  const [y1,m1,d1] = d.split("-").map(Number);
  const [y2,m2,d2] = today.split("-").map(Number);
  const dt1 = new Date(y1, m1-1, d1);
  const dt2 = new Date(y2, m2-1, d2);
  const diff = Math.round((dt1 - dt2) / 86400000);
  if(diff === 1) return tr("date.tomorrow");
  if(diff === -1) return tr("date.yesterday");
  if(diff > 1 && diff < 7) return trList("date.dow_short")[dt1.getDay()];
  return d;
}

function isProjectView(){
  return currentView === "inbox" || currentView.startsWith("project:");
}
function currentProject(){
  if(currentView === "inbox") return "Inbox";
  if(currentView.startsWith("project:")) return currentView.slice(8);
  return null;
}

/* ============ TOAST ============ */
function showToast(msg, type, ttlMs, action){
  const stack = document.getElementById("toast-stack");
  if(!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${type || ""}`;
  // msg is a plain string, or {title, sub} for a two-line (Todoist-style) toast.
  const body = document.createElement("div");
  body.className = "toast-body";
  if(msg && typeof msg === "object"){
    const t = document.createElement("div");
    t.className = "toast-title";
    t.textContent = msg.title || "";
    body.appendChild(t);
    if(msg.sub){
      const s = document.createElement("div");
      s.className = "toast-sub";
      s.textContent = msg.sub;
      body.appendChild(s);
    }
  } else {
    const t = document.createElement("span");
    t.textContent = msg;
    body.appendChild(t);
  }
  el.appendChild(body);
  if(action){
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = action.label;
    b.onclick = () => { el.remove(); action.fn(); };
    el.appendChild(b);
  }
  stack.appendChild(el);
  const ttl = ttlMs || (type === "error" ? 6000 : 3500);
  setTimeout(() => {
    el.classList.add("fade");
    setTimeout(() => el.remove(), 320);
  }, ttl);
}
function applySyncState(d){
  if(!d) return;
  if(d.sync_state){
    const prev = syncState;
    syncState = d.sync_state;
    // Transitioning from error → clear: subtle ok toast
    if(prev.last_push_error && !syncState.last_push_error){
      showToast(tr("toast.reconnected"), "ok");
    }
  }
  if(d.account) account = d.account;
  if(d.connected !== undefined) connected = d.connected;
  if(d.sync_interval !== undefined) syncInterval = d.sync_interval;
}

/* ============ API ============ */
async function fetchState(){
  try {
    const r = await fetch("/api/state");
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    state = d.tasks || []; projects = d.projects || []; projectSections = d.project_sections || {};
    projectMeta = d.project_meta || {};
    archivedProjects = d.archived_projects || [];
    setLabels(d.labels || []);
    filters = d.filters || [];
    pendingCount = d.pending_count || 0;
    prefs = d.prefs || {};
    if(d.gcal) gcalInfo = d.gcal;
    applySyncState(d);
    if(isOffline){ isOffline = false; }
    render();
    maybeNotebookFavCheck();
  } catch(e){
    if(!isOffline){
      isOffline = true;
      showToast(tr("toast.app_disconnected", {msg: e.message}), "error");
    }
    render();
  }
}

// Startup check (once per launch): if the Notebook project exists but is NOT a
// Todoist favorite, gently offer to add it — favorites are the only way to make
// it stand out from other projects in the real Todoist app. The dialog has a
// "don't remind me again" option that disables this permanently.
async function maybeNotebookFavCheck(){
  if(nbFavChecked) return;                       // only once per launch
  nbFavChecked = true;
  if(prefs.nb_fav_dismissed) return;             // user opted out
  if(!projects.includes(NOTEBOOK_PROJECT)) return;
  const meta = projectMeta[NOTEBOOK_PROJECT];
  if(!meta || meta.is_favorite) return;          // already a favorite — nothing to do
  const res = await notebookFavDialog();
  if(res.add){
    try { await post("/api/project_update", {name: NOTEBOOK_PROJECT, is_favorite: true}); } catch(e){}
  }
  if(res.dontRemind){
    try { await post("/api/set_pref", {key: "nb_fav_dismissed", value: true}); } catch(e){}
    prefs.nb_fav_dismissed = true;
  }
}

// Dedicated dialog: a primary "Add to favorites" button + a "don't remind" check.
// Resolves to {add: bool, dontRemind: bool}.
function notebookFavDialog(){
  return new Promise(resolve => {
    const finish = add => {
      const cb = document.getElementById("nb-fav-dont");
      const dontRemind = !!(cb && cb.checked);
      document.getElementById("confirm-backdrop").classList.remove("show");
      resolve({add, dontRemind});
    };
    window._nbFavFinish = finish;
    const extra = `<label class="pd-check">
        <input type="checkbox" id="nb-fav-dont">
        <span>${esc(tr("nb.fav_check_dont"))}</span>
      </label>`;
    _openDialog(`
      <div class="pd-head">${esc(tr("nb.fav_check_title"))}</div>
      ${_uiBody(tr("nb.fav_check_body"), extra)}
      <div class="pd-foot">
        <button class="pd-btn cancel" onclick="_nbFavFinish(false)">${esc(tr("common.close"))}</button>
        <button class="pd-btn primary" onclick="_nbFavFinish(true)">${esc(tr("nb.fav_check_add"))}</button>
      </div>`);
  });
}
async function post(path, body){
  try {
    const r = await fetch(path, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
    if(!r.ok){
      let errMsg = `HTTP ${r.status}`;
      try { const err = await r.json(); if(err.error) errMsg = err.error; } catch(_){}
      throw new Error(errMsg);
    }
    const d = await r.json();
    if(d.tasks){
      state = d.tasks;
      projects = d.projects || projects;
      projectMeta = d.project_meta || projectMeta;
      archivedProjects = d.archived_projects || archivedProjects;
      projectSections = d.project_sections || projectSections;
      if(d.labels) setLabels(d.labels);
      if(d.filters) filters = d.filters;
      pendingCount = d.pending_count !== undefined ? d.pending_count : pendingCount;
      if(d.gcal) gcalInfo = d.gcal;
      applySyncState(d);
      if(isOffline){ isOffline = false; }
      render();
    }
    return d;
  } catch(e){
    isOffline = true;
    showToast(tr("toast.save_failed", {msg: e.message}), "error");
    render();
    throw e;
  }
}
async function manualSync(){
  showToast(tr("toast.syncing"), "ok", 2000);
  try {
    const r = await fetch("/api/sync", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"});
    const d = await r.json();
    if(d.tasks){
      state = d.tasks; projects = d.projects || projects;
      projectMeta = d.project_meta || projectMeta;
      archivedProjects = d.archived_projects || archivedProjects;
      projectSections = d.project_sections || projectSections;
      if(d.filters) filters = d.filters;
      pendingCount = d.pending_count !== undefined ? d.pending_count : pendingCount;
      applySyncState(d);
    }
    if(d.push_error) showToast(tr("toast.push_failed", {msg: d.push_error}), "error");
    if(d.pull_error) showToast(tr("toast.pull_failed", {msg: d.pull_error}), "error");
    if(!d.push_error && !d.pull_error) showToast(tr("toast.sync_ok"), "ok");
    render();
  } catch(e){
    showToast(tr("toast.sync_failed", {msg: e.message}), "error");
  }
}
function upd(id, field, value, label){
  const t = T(id);
  if(t){
    recordFieldChange(id, field, t[field], value, label);
    t[field] = value;
  }
  post("/api/update", {id, field, value});
}

/* ============ UNDO / REDO (Todoist-side history) ============ */
// A generic action history. Any feature pushes recordAction({label, undo, redo});
// undo/redo are functions that reverse / reapply the change. Two producers feed it:
//   1. Task field edits through upd() — coalesced per tick (e.g. project move also
//      clears the section → one step).
//   2. Notebook meta actions (pin/archive/priority/label/date/move) — also via upd()
//      with a friendly label.
//   3. Task delete (deleteTask) — undo restores the task + its subtasks.
// Note TEXT (BlockNote) and duplicate/reorder are intentionally NOT here.
let undoStack = [], redoStack = [], _undoGroup = null;

// ---- generic action API ----
// No per-change toast: undo lives on the ↶/↷ buttons + Ctrl+Z/Y. The only toast
// left is the task-completion one (see completeTask).
function recordAction(action){
  undoStack.push(action);
  if(undoStack.length > 100) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}
function doUndoMain(){
  const a = undoStack.pop(); if(!a) return;
  a.undo();
  redoStack.push(a);
  updateUndoButtons();
}
function doRedoMain(){
  const a = redoStack.pop(); if(!a) return;
  a.redo();
  undoStack.push(a);
  updateUndoButtons();
}
function updateUndoButtons(){
  const u = document.getElementById("undo-btn"), r = document.getElementById("redo-btn");
  if(u) u.disabled = undoStack.length === 0;
  if(r) r.disabled = redoStack.length === 0;
}

// ---- field-edit producer (tasks + notebook meta) ----
function recordFieldChange(id, field, oldVal, newVal, label){
  if(JSON.stringify(oldVal) === JSON.stringify(newVal)) return;  // no real change
  if(!_undoGroup){
    _undoGroup = [];
    queueMicrotask(flushFieldGroup);
  }
  _undoGroup.push({id, field, oldVal, newVal, label});
}
function flushFieldGroup(){
  const g = _undoGroup; _undoGroup = null;
  if(!g || !g.length) return;
  const label = g[0].label || _fieldLabel(g[0].field);
  recordAction({
    label,
    undo: () => applyFieldGroup(g, "undo"),
    redo: () => applyFieldGroup(g, "redo"),
  });
}
function applyFieldGroup(group, dir){
  // Reapply field values directly (bypassing upd) so the replay isn't re-recorded.
  group.forEach(c => {
    const v = dir === "undo" ? c.oldVal : c.newVal;
    const t = T(c.id); if(t) t[c.field] = v;
    post("/api/update", {id: c.id, field: c.field, value: v});
  });
  if(modalTaskId) renderModal();
  render();
}
function _fieldLabel(field){
  const k = "undo.label_" + field, v = tr(k);
  return v === k ? tr("undo.label_generic") : v;
}
// Which undo/redo pair is "active" follows focus: editing note text → BlockNote pair,
// otherwise → the Todoist (header) pair. We only flag it on <body>; CSS dims the rest.
function updateUndoActive(){
  const el = document.activeElement;
  const inNoteText = !!(el && el.closest && el.closest("#notebook-view") &&
    (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA"));
  document.body.classList.toggle("note-text-active", inNoteText);
}
document.addEventListener("focusin", updateUndoActive);
document.addEventListener("focusout", () => setTimeout(updateUndoActive, 0));

