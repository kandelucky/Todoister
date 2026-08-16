/* ============ NOTEBOOK BRIDGE ============ */
function nbFirstTitle(body){
  const m = (body||"").match(/^#{1,3}\s+(.+)$/m);
  const raw = m ? m[1] : ((body||"").split("\n").find(l=>l.trim()) || tr("common.untitled"));
  return raw.replace(/[*~`#>]/g,"").trim().slice(0,40) || tr("common.untitled");
}
let _nbMounted = false;
function ensureNotebookMounted(){
  if(_nbMounted) return;
  const root = document.getElementById("notebook-root");
  if(root && window.mountNotebook){ window.mountNotebook(root); _nbMounted = true; }
}
// Pin/Archive: our own feature built on top of Todoist. The program auto-creates a
// Todoist section, named in the user's current language AT CREATION time. Matching is
// by emoji prefix so it stays stable across language switches (the existing section is
// never renamed and never duplicated).
const NB_PIN_EMOJI = "📌", NB_ARCHIVE_EMOJI = "📥";
const isPinnedSection  = s => (s || "").startsWith(NB_PIN_EMOJI);
const isArchiveSection = s => (s || "").startsWith(NB_ARCHIVE_EMOJI);
const findSpecialSection = emoji => (projectSections["Notebook"] || []).find(s => (s || "").startsWith(emoji)) || "";
window.NB = {
  _cb: null,
  list(){
    return state.filter(t => t.project === "Notebook" && !t.completed)
      .map(t => ({ id:t.id, title: t.text || "", body: t.description || "", body_json: t.body_json || "", nb_file_url: t.nb_file_url || "",
                   section: t.section || "", priority: t.priority || "P4",
                   due_date: t.due_date || "", due_time: t.due_time || "",
                   pinned: isPinnedSection(t.section), archived: isArchiveSection(t.section),
                   labels: t.chosen_labels || [], comments: t.comments || [] }));
  },
  sections(){ return (projectSections["Notebook"] || []).filter(s => !isPinnedSection(s) && !isArchiveSection(s)); },
  // Reuse an existing special section (matched by emoji), else create one named in the current language.
  async ensureSpecialSection(emoji, i18nKey){
    let name = findSpecialSection(emoji);
    if(!name){ name = tr(i18nKey); await post("/api/section_add", {project:"Notebook", name}); }
    return name;
  },
  allLabels(){
    const s = new Set();
    state.forEach(t => (t.chosen_labels || []).forEach(l => s.add(l)));
    return [...s].sort();
  },
  async reorder(id, dir){ await post("/api/task_reorder", {id, dir}); },
  async setPriority(id, prio){
    const t = T(id); if(t) recordFieldChange(id, "priority", t.priority || "P4", prio);
    await post("/api/update", {id, field:"priority", value: prio});
  },
  async setLabels(id, labels){
    const t = T(id); if(t) recordFieldChange(id, "chosen_labels", t.chosen_labels || [], labels);
    await post("/api/update", {id, field:"chosen_labels", value: labels});
  },
  async uploadImage(file){
    if(file.size > 5*1024*1024) throw new Error(tr("error.image_too_big"));
    const data = await new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = () => rej(new Error(tr("error.file_read_failed")));
      r.readAsDataURL(file);
    });
    const r = await fetch("/api/upload", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({filename:file.name, type:file.type||"image/png", data})});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    return d.file_url ? ("/api/attachment?u=" + encodeURIComponent(d.file_url)) : "";
  },
  // Upload a file and return the full Todoist file_attachment metadata (file_url,
  // file_name, file_type, image, tn_l, …) so it can be attached to a comment.
  async uploadFile(file){
    if(file.size > 5*1024*1024) throw new Error(tr("error.image_too_big"));
    const data = await new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = () => rej(new Error(tr("error.file_read_failed")));
      r.readAsDataURL(file);
    });
    const r = await fetch("/api/upload", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({filename:file.name, type:file.type||"application/octet-stream", data})});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    return d;
  },
  // Fetch a remote image by URL (server-side, no CORS) and upload it to Todoist, so a web
  // image pasted into a note becomes a real attachment. Returns file_attachment metadata.
  async uploadFromUrl(url){
    const r = await fetch("/api/upload_url", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({url})});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    return d;
  },
  // Is a Todoist-hosted file still there? Used on open to drop inline images whose attachment
  // was deleted elsewhere. Defaults to alive on any failure, so a check never deletes by mistake.
  async fileAlive(url){
    try{
      const r = await fetch("/api/file_alive", {method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({url})});
      const d = await r.json();
      return d.alive !== false;
    }catch(e){ return true; }
  },
  // Comments = the only native Todoist attachment mechanism. note_add carries the file.
  async addComment(taskId, text, attachment){
    await post("/api/comment_add", {id: taskId, text: text || "", attachment: attachment || null});
  },
  async deleteComment(commentId){
    await post("/api/comment_delete", {comment_id: commentId});
  },
  // Download an attachment to the file system. The native WebView blocks browser downloads,
  // so the server fetches the file (with our Bearer auth) and reveals it in Explorer.
  async downloadFile(url, name){
    const r = await fetch("/api/download", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({url, name: name || ""})});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    return d;
  },
  // Export: the native WebView blocks downloads, so the server writes the file and
  // opens it (HTML → default browser for printing; other → reveal the folder).
  async exportFile(filename, dataB64, mode){
    const r = await fetch("/api/export_open", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({filename, data: dataB64, open: mode || "browser"})});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    return d;
  },
  subscribe(fn){ this._cb = fn; },
  notify(){ if(this._cb) this._cb({ notes: this.list(), sections: this.sections() }); },
  async addSection(name, after){
    if(name && name.trim()){
      const body = {project:"Notebook", name:name.trim()};
      if(after !== undefined) body.after = after;   // "" = top, name = after that section, undefined = end
      await post("/api/section_add", body);
      await this.reorderSpecial();
    }
  },
  async renameSection(oldName, newName){
    const v = (newName || "").trim();
    if(v && v !== oldName){ await post("/api/section_rename", {project:"Notebook", old:oldName, new:v}); }
  },
  async deleteSection(name){
    await post("/api/section_delete", {project:"Notebook", name});  // notes fall back to "no section"
  },
  async sortSection(sectionName, key){
    const rank = {P1:0, P2:1, P3:2, P4:3};
    const notes = state.filter(t => t.project === "Notebook" && !t.completed && (t.section || "") === (sectionName || "")).slice();
    if(key === "date") notes.sort((a,b) => (a.due_date || "9999-99-99").localeCompare(b.due_date || "9999-99-99"));
    else if(key === "priority") notes.sort((a,b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
    else if(key === "title") notes.sort((a,b) => (a.text || "").localeCompare(b.text || "", undefined, {sensitivity:"base"}));
    const order = notes.map(n => n.id);
    if(order.length) await post("/api/task_reorder", {order});
  },
  async moveSection(name, dir){
    const secs = projectSections["Notebook"] || [];
    const normals = secs.filter(s => !isPinnedSection(s) && !isArchiveSection(s));
    const i = normals.indexOf(name);
    if(i < 0) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if(j < 0 || j >= normals.length) return;
    [normals[i], normals[j]] = [normals[j], normals[i]];
    const pin = secs.find(isPinnedSection), arc = secs.find(isArchiveSection);
    const order = [];
    if(pin) order.push(pin);
    order.push(...normals);
    if(arc) order.push(arc);
    await post("/api/section_reorder", {project:"Notebook", order});
  },
  async moveToSection(id, section){
    const t = T(id); if(t) recordFieldChange(id, "section", t.section || "", section || "");
    await post("/api/update", {id, field:"section", value: section || ""});
  },
  async saveTitle(id, title){
    await post("/api/update", {id, field:"text", value: title || tr("common.untitled")});
  },
  // Dual storage: md → task description (Todoist shows it), json → local task_local.body_json
  // (+ attached as Todoister-page.json after the idle timer — nb_files.py).
  async saveBody(id, md, json){
    await post("/api/update", {id, field:"nb_body", value:{md: md || "", json: json || ""}});
  },
  // Local cache only: the envelope fetched back from the attached file (fresh DB / other PC).
  async cacheBody(id, json){
    await post("/api/update", {id, field:"nb_body_cache", value: json || ""});
  },
  // Page left / window closing → attach the JSON now instead of waiting out the idle timer.
  flushFile(id, beacon){
    const payload = JSON.stringify({id: id || null});
    if(beacon && navigator.sendBeacon){ try { navigator.sendBeacon("/api/nb_flush", payload); return; } catch(e){} }
    fetch("/api/nb_flush", {method:"POST", headers:{"Content-Type":"application/json"}, body: payload, keepalive:true}).catch(()=>{});
  },
  // Read the attached page file (JSON envelope) through the auth proxy; null if missing/invalid.
  async fetchPageFile(url){
    if(!url) return null;
    try {
      const r = await fetch("/api/attachment?u=" + encodeURIComponent(url));
      if(!r.ok) return null;
      return await r.text();
    } catch(e){ return null; }
  },
  async create(section){
    const body = {text:"New page", project:"Notebook", description:""};
    if(section) body.section = section;
    const d = await post("/api/task_add", body);
    const id = d && d.new_id;
    return id ? { id, title:"New page", body:"", labels:[] } : null;
  },
  async setDueDate(id, date){
    const t = T(id); if(t) recordFieldChange(id, "due_date", t.due_date || "", date || "");
    await post("/api/update", {id, field:"due_date", value: date || ""});
  },
  async setDueTime(id, time){
    const t = T(id); if(t) recordFieldChange(id, "due_time", t.due_time || "", time || "");
    await post("/api/update", {id, field:"due_time", value: time || ""});
  },
  async reorderSpecial(){
    const secs = projectSections["Notebook"] || [];
    const pin = secs.find(isPinnedSection), arc = secs.find(isArchiveSection);
    if(!pin && !arc) return;
    const order = [];
    if(pin) order.push(pin);
    order.push(...secs.filter(s => !isPinnedSection(s) && !isArchiveSection(s)));
    if(arc) order.push(arc);
    await post("/api/section_reorder", {project:"Notebook", order});
  },
  async setPinned(id, val){
    const t = T(id); const oldSec = t ? (t.section || "") : "";
    if(val){
      const name = await this.ensureSpecialSection(NB_PIN_EMOJI, "nb.group_pinned");
      recordFieldChange(id, "section", oldSec, name, tr("nb.pin"));
      await post("/api/update", {id, field:"section", value: name});
      await this.reorderSpecial();
    } else {
      recordFieldChange(id, "section", oldSec, "", tr("nb.unpin"));
      await post("/api/update", {id, field:"section", value: ""});
    }
  },
  async setArchived(id, val){
    const t = T(id); const oldSec = t ? (t.section || "") : "";
    if(val){
      const name = await this.ensureSpecialSection(NB_ARCHIVE_EMOJI, "nb.group_archived");
      recordFieldChange(id, "section", oldSec, name, tr("nb.archive"));
      await post("/api/update", {id, field:"section", value: name});
      await this.reorderSpecial();
    } else {
      recordFieldChange(id, "section", oldSec, "", tr("nb.unarchive"));
      await post("/api/update", {id, field:"section", value: ""});
    }
  },
  async duplicate(id){ await post("/api/task_duplicate", {id}); },
  async del(id){ await post("/api/task_delete", {id}); },
};

// ---- One-time migration of notebook pages to dual storage (2026-08-16) ----
// Old format: the whole BlockNote document stored as a JSON array in the task description
// (Todoist showed the page as a code blob). New: description = Markdown, JSON envelope local
// (+ attached file via nb_files.py). Runs once per launch after the first state load; only
// old-format pages are touched, so it is idempotent and resumable (interrupted → next launch).
// Second pass (2026-08-16): descriptions that still carry an uploaded-file link
// (`![x](https://files.todoist.com/…)`) — those links are dead in Todoist (Bearer auth), so
// the storage Markdown now writes such media as a plain "📎 name" line; pages saved before
// that are rewritten once here (from the local envelope when it matches, else from the Markdown).
const TODOIST_FILE_LINK_RE = /\]\(https?:\/\/(files|image-resize)\.todoist\.com\//;
const NB_ATT_MARK = String.fromCodePoint(0x1F4CE);   // 📎 — same as the bundle's NB_ATT_MARK
// Candidates: a dead file link, or a "📎" line (re-normalised if the name should differ).
const hasTodoistFileLinks = md => TODOIST_FILE_LINK_RE.test(md || "") || (md || "").includes(NB_ATT_MARK);
async function convertLinkedNotebookPage(t){
  const T = window.NB_TOOLS;
  const env = T.parseEnvelope(t.body_json || "");
  const blocks = (env && env.md_hash === T.mdHash(t.description || ""))
    ? env.blocks
    : await T.mdToBlocks(t.description || "", t.comments || []);
  const md = await T.blocksToMd(blocks, t.comments || []);
  if(T.mdHash(md) === T.mdHash(t.description || "")) return false;   // same after normalisation → leave
  await window.NB.saveBody(t.id, md, T.envelope(blocks, md));
  return true;
}
let _nbMigrationStarted = false;
async function maybeMigrateNotebookPages(){
  if(_nbMigrationStarted) return;
  const T = window.NB_TOOLS;
  if(!T || !window.NB) return;                    // bundle not ready yet → try on the next poll
  const pages = state.filter(t => t.project === NOTEBOOK_PROJECT && !t.completed);
  const legacy = pages.filter(t => !!T.parseLegacyJsonBody(t.description || ""));
  const linked = pages.filter(t => !T.parseLegacyJsonBody(t.description || "") && hasTodoistFileLinks(t.description || ""));
  _nbMigrationStarted = true;                     // decided: either nothing to do or we run once
  if(!legacy.length && !linked.length) return;
  const total = legacy.length + linked.length;
  let done = 0, failed = 0;
  const bar = showToast(tr("nb.migrating", {n: 0, total}), "", 600000);
  const setMsg = m => { if(bar){ const b = bar.querySelector(".toast-body"); if(b) b.textContent = m; } };
  for(const t of legacy){
    try {
      const blocks = T.parseLegacyJsonBody(t.description || "");
      const md = await T.blocksToMd(blocks);
      const json = T.envelope(blocks, md);
      await window.NB.saveBody(t.id, md, json);
      done++;
    } catch(e){ failed++; console.warn("notebook migration failed for", t.id, e); }
    setMsg(tr("nb.migrating", {n: done + failed, total}));
  }
  let skipped = 0;
  for(const t of linked){
    try { if(await convertLinkedNotebookPage(t)) done++; else skipped++; }
    catch(e){ failed++; console.warn("notebook link rewrite failed for", t.id, e); }
    setMsg(tr("nb.migrating", {n: done + failed + skipped, total}));
  }
  if(bar) bar.remove();
  if(!done && !failed){ if(window.NB.notify) window.NB.notify(); return; }   // nothing actually changed — stay quiet
  showToast(tr(failed ? "nb.migrated_partial" : "nb.migrated", {n: done, failed}), failed ? "error" : "", 8000);
  if(window.NB.notify) window.NB.notify();
}

// ---- Notebook pages deleted on Todoist (phone / web) ----
// The server keeps the local page body when a Notebook task disappears from Todoist and lists
// those pages in state.nb_deleted_pending. Once per new set we ask the user, per page (checkboxes):
// restore on Todoist (text + structure + files that are still downloadable) or discard the local
// copy. "Later" keeps them pending — asked again at the next launch.
let _nbDeletedSeen = new Set();
let _nbDeletedOpen = false;
let nbDeletedPending = [];
function maybeNotebookDeletedCheck(){
  const list = nbDeletedPending || [];
  if(_nbDeletedOpen || !list.length) return;
  if(!list.some(p => !_nbDeletedSeen.has(p.id))) return;   // nothing new since we last asked
  list.forEach(p => _nbDeletedSeen.add(p.id));
  _nbDeletedOpen = true;
  notebookDeletedDialog(list).then(async res => {
    _nbDeletedOpen = false;
    if(!res || !res.action || !res.ids.length) return;
    const bar = showToast(tr(res.action === "restore" ? "nb.deleted_restoring" : "nb.deleted_discarding"), "", 600000);
    let d = null;
    try {
      const r = await fetch("/api/nb_deleted_resolve", {method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ids: res.ids, action: res.action})});
      d = await r.json();
      if(!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    } catch(e){
      if(bar) bar.remove();
      showToast(tr("toast.save_failed", {msg: e.message}), "error");
      return;
    }
    if(bar) bar.remove();
    if(d.tasks){
      state = d.tasks; nbDeletedPending = d.nb_deleted_pending || [];
      pendingCount = d.pending_count !== undefined ? d.pending_count : pendingCount;
      render(); if(window.NB && window.NB.notify) window.NB.notify();
    }
    const sm = d.summary || {};
    if(res.action === "restore"){
      showToast(tr(sm.files_lost ? "nb.deleted_restored_lost" : "nb.deleted_restored", {n: sm.restored || 0, lost: sm.files_lost || 0}), sm.files_lost ? "warn" : "", 8000);
      // The restored description may still carry old file links — regenerate it (see convertLinkedNotebookPage).
      const restoredIds = new Set(res.ids);
      const T = window.NB_TOOLS;
      if(T && window.NB){
        for(const t of state.filter(t => t.project === NOTEBOOK_PROJECT && !t.completed)){
          if(hasTodoistFileLinks(t.description || "")){ try { await convertLinkedNotebookPage(t); } catch(e){} }
        }
      }
    } else {
      showToast(tr("nb.deleted_discarded", {n: sm.discarded || 0}), "", 6000);
    }
  });
}
// Dialog: list of deleted pages with checkboxes (all checked) + restore / discard / later.
// Resolves to {action: "restore"|"discard"|null, ids: [...]}.
function notebookDeletedDialog(list){
  return new Promise(resolve => {
    const finish = action => {
      const ids = [...document.querySelectorAll(".nb-del-item input:checked")].map(i => i.value);
      document.getElementById("confirm-backdrop").classList.remove("show");
      resolve({action, ids});
    };
    window._nbDelFinish = finish;
    window._nbDelToggleAll = on => { document.querySelectorAll(".nb-del-item input").forEach(i => { i.checked = on; }); };
    const rows = list.map(p => `<label class="pd-check nb-del-item">
        <input type="checkbox" value="${esc(p.id)}" checked>
        <span class="nb-del-title">${esc(p.title || tr("common.untitled"))}</span>
        <span class="nb-del-meta">${esc(fmtDeletedAt(p.deleted_at))}${p.files ? " · " + esc(tr("nb.deleted_files", {n: p.files})) : ""}</span>
      </label>`).join("");
    const extra = `<div class="nb-del-list">${rows}</div>
      <div class="nb-del-all">
        <button class="pd-link" onclick="_nbDelToggleAll(true)">${esc(tr("nb.deleted_all"))}</button>
        <button class="pd-link" onclick="_nbDelToggleAll(false)">${esc(tr("nb.deleted_none"))}</button>
      </div>
      <p class="pd-note">${esc(tr("nb.deleted_note"))}</p>`;
    _openDialog(`
      <div class="pd-head">${esc(tr("nb.deleted_title", {n: list.length}))}</div>
      ${_uiBody(tr("nb.deleted_body"), extra)}
      <div class="pd-foot nb-del-foot">
        <button class="pd-btn cancel" onclick="_nbDelFinish(null)">${esc(tr("nb.deleted_later"))}</button>
        <button class="pd-btn danger" onclick="_nbDelFinish('discard')">${esc(tr("nb.deleted_discard"))}</button>
        <button class="pd-btn primary" onclick="_nbDelFinish('restore')">${esc(tr("nb.deleted_restore"))}</button>
      </div>`);
  });
}
function fmtDeletedAt(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, {day:"numeric", month:"short"}) + " " + d.toLocaleTimeString(undefined, {hour:"2-digit", minute:"2-digit"});
}

function renderContent(){
  const row = document.getElementById("board-row");
  const pbv = document.getElementById("project-board-view");
  const nbv = document.getElementById("notebook-view");
  const disc = document.getElementById("disconnected-screen");
  if(!connected){
    pbv.style.display = "none";
    if(nbv) nbv.style.display = "none";
    if(disc) disc.style.display = "flex";
    return;
  }
  if(disc) disc.style.display = "none";
  if(currentView === "project:Notebook"){
    pbv.style.display = "none";
    if(nbv) nbv.style.display = "flex";
    ensureNotebookMounted();
    if(window.NB) window.NB.notify();
    return;
  }
  if(nbv) nbv.style.display = "none";
  pbv.style.display = "";
  pbv.classList.toggle("calendar-mode", currentView === "calendar");
  if(currentView === "calendar"){
    pbv.classList.add("list-mode");
    renderCalendar(row);
    return;
  }
  if(currentView === "agent"){
    pbv.classList.add("list-mode");
    renderAgentPanel(row);   // AI agent panel (js/14-agent.js)
    return;
  }
  if(currentView === "projects-page"){
    pbv.classList.add("list-mode");
    renderProjectsPage(row);
    return;
  }
  if(currentView === "filters"){
    pbv.classList.add("list-mode");
    renderFiltersLabelsPage(row);
    return;
  }
  if(currentView === "completed"){
    pbv.classList.add("list-mode");
    renderReporting(row);
    return;
  }
  if(isProjectView() && !searchQuery && viewMode === "board"){
    pbv.classList.remove("list-mode");
    renderBoard(row);
  } else {
    pbv.classList.add("list-mode");
    renderList(row);
  }
}

