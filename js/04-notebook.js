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
      .map(t => ({ id:t.id, title: t.text || "", body: t.description || "",
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
  async saveBody(id, body){
    await post("/api/update", {id, field:"description", value: body});
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

