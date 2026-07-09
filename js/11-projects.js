/* ============ PROJECT MENU + DIALOG ============ */
// Exact Todoist project ⋯-menu icons (copied 1:1 from the real app)
const PROJ_ICONS = {
  add_above: `<svg viewBox="0 0 24 24" width=24 height=24 aria-hidden=true><path fill=currentColor d="M9 6.74 6.35 9.4a.5.5 0 0 1-.7-.7l3.53-3.54a.5.5 0 0 1 .7 0l3.55 3.53a.5.5 0 0 1-.71.7L10 6.69V18.5a.5.5 0 1 1-1 0zM17 15h2.5a.5.5 0 1 1 0 1H17v2.5a.5.5 0 1 1-1 0V16h-2.5a.5.5 0 1 1 0-1H16v-2.5a.5.5 0 1 1 1 0z"></path></svg>`,
  add_below: `<svg viewBox="0 0 24 24" width=24 height=24 aria-hidden=true><path fill=currentColor d="M9 17.26 6.35 14.6a.5.5 0 0 0-.7.7l3.53 3.54a.5.5 0 0 0 .7 0l3.55-3.53a.5.5 0 0 0-.71-.7L10 17.31V5.5a.5.5 0 1 0-1 0zM17 9h2.5a.5.5 0 1 0 0-1H17V5.5a.5.5 0 1 0-1 0V8h-2.5a.5.5 0 1 0 0 1H16v2.5a.5.5 0 1 0 1 0z"></path></svg>`,
  edit: `<svg viewBox="0 0 24 24" width=24 height=24 aria-hidden=true><g fill=none fill-rule=evenodd><path fill=currentColor d="M9.5 19h10a.5.5 0 1 1 0 1h-10a.5.5 0 1 1 0-1"></path><path stroke=currentColor d="M4.42 16.03a1.5 1.5 0 0 0-.43.9l-.22 2.02a.5.5 0 0 0 .55.55l2.02-.21a1.5 1.5 0 0 0 .9-.44L18.7 7.4a1.5 1.5 0 0 0 0-2.12l-.7-.7a1.5 1.5 0 0 0-2.13 0L4.42 16.02z"></path></g></svg>`,
  favorites: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M3.5 8.75C3.5 13 7 16 12 20c5-4 8.5-7 8.5-11.25A4.75 4.75 0 0 0 15.75 4q-2 0-3.75 2-1.75-2-3.75-2A4.75 4.75 0 0 0 3.5 8.75M15.75 5a3.75 3.75 0 0 1 3.75 3.75c0 3.13-1.753 5.32-7.5 9.967-5.747-4.648-7.5-6.837-7.5-9.967A3.75 3.75 0 0 1 8.25 5c1.019 0 2.008.528 2.997 1.659l.753.86.753-.86C13.743 5.528 14.73 5 15.75 5" clip-rule=evenodd></path></svg>`,
  move: `<svg viewBox="0 0 24 24" width=24 height=24 aria-hidden=true><g fill=none transform="translate(4 4)"><circle cx=8 cy=8 r=7.5 stroke=currentColor></circle><path fill=currentColor d="M10.11 7.82 8.15 5.85a.5.5 0 1 1 .7-.7l2.83 2.82a.5.5 0 0 1 0 .71l-2.83 2.83a.5.5 0 1 1-.7-.7l1.98-1.99H4.5a.5.5 0 1 1 0-1z"></path></g></svg>`,
  duplicate: `<svg width=24 height=24 viewBox="0 0 24 24" fill=none xmlns=http://www.w3.org/2000/svg aria-hidden=true><path fill-rule=evenodd clip-rule=evenodd d="M7.26756 5H18C18.5523 5 19 5.44772 19 6V16.7324C19.5978 16.3866 20 15.7403 20 15V6C20 4.89543 19.1046 4 18 4H9C8.25972 4 7.61337 4.4022 7.26756 5ZM6 7H15C16.1046 7 17 7.89543 17 9V18C17 19.1046 16.1046 20 15 20H6C4.89543 20 4 19.1046 4 18V9C4 7.89543 4.89543 7 6 7ZM5 9C5 8.44772 5.44772 8 6 8H15C15.5523 8 16 8.44772 16 9V18C16 18.5523 15.5523 19 15 19H6C5.44772 19 5 18.5523 5 18V9ZM11 14H13.5C13.7761 14 14 13.7761 14 13.5C14 13.2239 13.7761 13 13.5 13H11V10.5C11 10.2239 10.7761 10 10.5 10C10.2239 10 10 10.2239 10 10.5V13H7.5C7.22386 13 7 13.2239 7 13.5C7 13.7761 7.22386 14 7.5 14H10V16.5C10 16.7761 10.2239 17 10.5 17C10.7761 17 11 16.7761 11 16.5V14Z" fill=currentColor></path></svg>`,
  share: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M11 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8m7.427 3.619C16.803 14.197 14.323 13.5 11 13.5s-5.803.697-7.427 2.119A2.5 2.5 0 0 0 5.22 20h11.56a2.5 2.5 0 0 0 1.647-4.381m-14.195.752C5.647 15.133 7.898 14.5 11 14.5s5.354.633 6.768 1.871A1.5 1.5 0 0 1 16.78 19H5.22a1.5 1.5 0 0 1-.988-2.629M14 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0m3.5 2a.5.5 0 0 1 0-1H20V6.5a.5.5 0 0 1 1 0V9h2.5a.5.5 0 0 1 0 1H21v2.5a.5.5 0 0 1-1 0V10z" clip-rule=evenodd></path></svg>`,
  copy_link: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor d="m8.354 12.95-.708-.707L5.88 14.01a3 3 0 1 0 4.242 4.243l3.536-3.536a3 3 0 0 0 0-4.242l-.707.707a2 2 0 0 1 0 2.828l-3.536 3.536a2 2 0 1 1-2.828-2.828z"></path><path fill=currentColor d="m15.778 11.182.707.707 1.768-1.768A3 3 0 1 0 14.01 5.88l-3.535 3.535a3 3 0 0 0 0 4.243l.707-.707a2 2 0 0 1 0-2.829l3.535-3.535a2 2 0 1 1 2.829 2.828z"></path></svg>`,
  view_activity: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2m0 1a1 1 0 0 0-1 1v5h2.691l1.362-2.724a.5.5 0 0 1 .917.053l1.473 4.05 1.576-5.516a.5.5 0 0 1 .938-.066L15.825 12H19V7a1 1 0 0 0-1-1zm13 7h-3.5a.5.5 0 0 1-.457-.297l-1.44-3.241-1.622 5.675a.5.5 0 0 1-.95.034l-1.604-4.408-.98 1.96A.5.5 0 0 1 8 13H5v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z" clip-rule=evenodd></path></svg>`,
  save_template: `<svg viewBox="0 0 24 24" xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M9.001 5h1V4h-1a2 2 0 0 0-2 2v1h-1a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2v-1h-1v1a1 1 0 0 1-1 1h-1V9a2 2 0 0 0-2-2h-7V6a1 1 0 0 1 1-1m6-1h-3v1h3zm4 2v1h1V6a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1m1 6V9h-1v3zm-14-4h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1" clip-rule=evenodd></path></svg>`,
  browse_templates: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M10.241 4.004h3.513c.554 0 1.004.448 1.004 1v9.638l-5.52-7.855V5.004c0-.552.449-1 1.003-1m4.844 15.4.048-.074a3.772 3.772 0 0 1-6.218.074L1.863 9.37a1.995 1.995 0 0 1 .493-2.786l2.878-2.007a2.01 2.01 0 0 1 2.795.49l.205.292v-.355c0-1.105.899-2 2.007-2h3.513c1.109 0 2.007.895 2.007 2v.361l.21-.298a2.01 2.01 0 0 1 2.796-.492l2.877 2.008a1.995 1.995 0 0 1 .493 2.785zm.676-12.295v9.589l5.554-7.903a1 1 0 0 0-.247-1.393l-2.877-2.007a1.006 1.006 0 0 0-1.398.245zM5.81 5.396 2.932 7.403a1 1 0 0 0-.247 1.393L9.737 18.83a2.766 2.766 0 0 0 3.844.675 2.744 2.744 0 0 0 .678-3.83L7.207 5.64a1.006 1.006 0 0 0-1.398-.245m6.189 12.983a1 1 0 0 1-1.004-1c0-.552.45-1 1.004-1s1.003.448 1.003 1-.45 1-1.003 1" clip-rule=evenodd></path></svg>`,
  add_extension: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true class=svg_icon><path fill=currentColor fill-rule=evenodd d="M3 10.01V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v4.01c0 .1.134.142.198.066l.057-.066A3 3 0 0 1 19 9.401a3 3 0 1 1-.802 4.523c-.064-.076-.198-.033-.198.066V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.01c0-.569.4-.93.764-1.049.357-.117.86-.065 1.201.341a2 2 0 1 0 0-2.564c-.34.406-.844.458-1.2.341A1.1 1.1 0 0 1 3 10.01M5 5a1 1 0 0 0-1 1v4.01c0 .1.135.142.198.066l.057-.066A3 3 0 0 1 5 9.401a3 3 0 1 1-.802 4.523C4.135 13.848 4 13.89 4 13.99V18a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4.01c0-.569.4-.93.764-1.049.358-.117.86-.065 1.201.341a2 2 0 1 0 0-2.564c-.34.406-.843.458-1.2.341A1.1 1.1 0 0 1 17 10.01V6a1 1 0 0 0-1-1z" clip-rule=evenodd></path></svg>`,
  import_csv: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M12.5 14.293V4.5a.5.5 0 0 0-1 0v9.793l-2.146-2.147a.5.5 0 0 0-.708.708l3 3a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708zM19.53 19c.26 0 .47-.224.47-.5s-.21-.5-.47-.5H4.47c-.26 0-.47.224-.47.5s.21.5.47.5z" clip-rule=evenodd></path></svg>`,
  export_csv: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M12.691 4.038q.09.036.163.108l3 3a.5.5 0 0 1-.708.708L13 5.707V15a.5.5 0 0 1-1 0V5.707L9.854 7.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .545-.108M4 11.5v5A2.5 2.5 0 0 0 6.5 19h12a2.5 2.5 0 0 0 2.5-2.5v-5a.5.5 0 0 0-1 0v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 5 16.5v-5a.5.5 0 0 0-1 0" clip-rule=evenodd></path></svg>`,
  email: `<svg viewBox="0 0 24 24" width=24 height=24 aria-hidden=true><g fill=none fill-rule=evenodd><path fill=currentColor fill-rule=nonzero d="m12 11.4 4.7-3.8a.5.5 0 1 1 .6.8L12 12.6 6.7 8.4a.5.5 0 0 1 .6-.8z"></path><rect width=15 height=13 x=4.5 y=5.5 stroke=currentColor rx=2></rect></g></svg>`,
  calendar_feed: `<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 fill=none viewBox="0 0 24 24" aria-hidden=true><path fill=currentColor fill-rule=evenodd d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5.514a9 9 0 0 0-.11-1H18a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v5.624a9 9 0 0 0-1-.11V6a2 2 0 0 1 2-2m6 13a1 1 0 0 1-.216-.023q-.301-.706-.714-1.346A1 1 0 1 1 12 17m-3-5a1 1 0 0 1-.63.93 9 9 0 0 0-1.347-.714A1 1 0 1 1 9 12m7 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2m1-5a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-5 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2M7 8a.5.5 0 0 0 0 1h10a.5.5 0 0 0 0-1zM4.5 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M3 17a.5.5 0 0 1 .5-.5c2.276 0 4 1.724 4 4a.5.5 0 0 1-1 0c0-1.724-1.276-3-3-3A.5.5 0 0 1 3 17m.5-3.5a.5.5 0 0 0 0 1c3.474 0 6 2.526 6 6a.5.5 0 1 0 1 0c0-4.026-2.974-7-7-7" clip-rule=evenodd></path></svg>`,
  archive: `<svg viewBox="0 0 24 24" width=24 height=24 aria-hidden=true><g fill=none><path stroke=currentColor d="M5.5 9.5V18A1.5 1.5 0 0 0 7 19.5h10a1.5 1.5 0 0 0 1.5-1.5V9.5zm-1 0h15V7A1.5 1.5 0 0 0 18 5.5H6A1.5 1.5 0 0 0 4.5 7z"></path><rect width=6 height=1 x=9 y=12 fill=currentColor rx=0.5></rect></g></svg>`,
  delete: `<svg viewBox="0 0 24 24" xmlns=http://www.w3.org/2000/svg width=24 height=24 aria-hidden=true><g fill=none fill-rule=evenodd><path d="M0 0h24v24H0z"></path><rect width=14 height=1 x=5 y=6 fill=currentColor rx=0.5></rect><path fill=currentColor d="M10 9h1v8h-1zm3 0h1v8h-1z"></path><path stroke=currentColor d="M17.5 6.5h-11V18A1.5 1.5 0 0 0 8 19.5h8a1.5 1.5 0 0 0 1.5-1.5zm-9 0h7V5A1.5 1.5 0 0 0 14 3.5h-4A1.5 1.5 0 0 0 8.5 5z"></path></g></svg>`,
};
// Faithful Todoist menu order; `on:false` = present but inactive (greyed, "not needed yet")
const PROJ_MENU = [
  {icon:"add_above", key:"proj.add_above", act:"add_above", on:true},
  {icon:"add_below", key:"proj.add_below", act:"add_below", on:true},
  {sep:true},
  {icon:"edit", key:"ctx.edit", act:"edit", on:true},
  {icon:"favorites", key:"proj.favorites", on:false},
  {icon:"move", key:"proj.move", on:false},
  {icon:"duplicate", key:"ctx.duplicate", on:false},
  {sep:true},
  {icon:"share", key:"proj.share", on:false},
  {icon:"copy_link", key:"proj.copy_link", on:false},
  {icon:"view_activity", key:"proj.view_activity", on:false},
  {sep:true},
  {icon:"save_template", key:"proj.save_template", on:false},
  {icon:"browse_templates", key:"proj.browse_templates", on:false},
  {icon:"add_extension", key:"proj.add_extension", on:false},
  {sep:true},
  {icon:"import_csv", key:"proj.import_csv", on:false},
  {icon:"export_csv", key:"proj.export_csv", on:false},
  {icon:"email", key:"proj.email", on:false},
  {icon:"calendar_feed", key:"proj.calendar_feed", on:false},
  {sep:true},
  {icon:"archive", key:"proj.archive", act:"archive", on:true},
  {icon:"delete", key:"common.delete", act:"delete", on:true, del:true},
];
// Todoist project color palette, in picker order (keys match TODOIST_COLORS)
const PROJECT_COLORS = [
  "berry_red","red","orange","yellow","olive_green","lime_green","green",
  "mint_green","teal","sky_blue","light_blue","blue","grape","violet",
  "lavender","magenta","salmon","charcoal","grey","taupe",
];
let projDialog = null;  // {mode:'add'|'edit'|'delete', target, name, anchor, above, color}

function projMenuAction(act, name){
  if(act === "add_above") openProjectDialog("add", name, true);
  else if(act === "add_below") openProjectDialog("add", name, false);
  else if(act === "edit") openProjectDialog("edit", name);
  else if(act === "archive") archiveProject(name);
  else if(act === "delete") confirmDeleteProject(name);
}
function openProjectMenu(ev, name){
  ev.stopPropagation();
  const m = document.getElementById("ctx-menu");
  m.innerHTML = PROJ_MENU.map(it => {
    if(it.sep) return `<div class="ctx-sep proj-sep"></div>`;
    const cls = "ctx-mi proj-mi" + (it.del ? " del" : "") + (it.on ? "" : " disabled");
    const click = it.on ? ` onclick="projMenuAction('${it.act}','${esc(name)}'); closeCtx()"` : "";
    return `<div class="${cls}"${click}><span class="ctx-ico proj-ico">${PROJ_ICONS[it.icon]}</span><span class="label">${tr(it.key)}</span></div>`;
  }).join("");
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}

function userProjectCount(){ return projects.filter(p => p !== INBOX_NAME).length; }

// Opt-in: create (or restore) the Notebook project on demand. Notes live in a real
// Todoist project (so they sync), which costs one of the 5 Free-tier slots.
function enableNotes(){
  if(projects.includes(NOTEBOOK_PROJECT)) return;
  if(userProjectCount() >= PROJECT_LIMIT){
    showToast(tr("notes.limit", {n: PROJECT_LIMIT}), "error");
    return;
  }
  // If a Notebook project exists but is archived, restore it instead of duplicating
  if((archivedProjects || []).some(a => a.name === NOTEBOOK_PROJECT)){
    post("/api/project_unarchive", {name: NOTEBOOK_PROJECT})
      .then(() => setView("project:" + NOTEBOOK_PROJECT));
    return;
  }
  post("/api/project_add", {name: NOTEBOOK_PROJECT, color: "charcoal"})
    .then(() => setView("project:" + NOTEBOOK_PROJECT));
}
// Opt-out menu on the pinned Notebook: archive (reversible) or delete (permanent).
// No rename/color — the notes feature keys off the literal project name "Notebook".
function openNotebookMenu(ev){
  ev.stopPropagation();
  const m = document.getElementById("ctx-menu");
  m.innerHTML =
    `<div class="ctx-mi proj-mi" onclick="archiveProject('${NOTEBOOK_PROJECT}'); closeCtx()"><span class="ctx-ico proj-ico">${PROJ_ICONS.archive}</span><span class="label">${tr("proj.archive")}</span></div>`
    + `<div class="ctx-sep proj-sep"></div>`
    + `<div class="ctx-mi proj-mi del" onclick="confirmDeleteProject('${NOTEBOOK_PROJECT}'); closeCtx()"><span class="ctx-ico proj-ico">${PROJ_ICONS.delete}</span><span class="label">${tr("common.delete")}</span></div>`;
  positionCtx(m, ev.currentTarget.getBoundingClientRect());
}

function openProjectDialog(mode, name, above){
  if(mode === "add" && userProjectCount() >= PROJECT_LIMIT){
    showToast(tr("proj.limit", {n: PROJECT_LIMIT}), "error");
    return;
  }
  if(mode === "edit"){
    const meta = projectMeta[name] || {};
    projDialog = {mode, target:name, name, anchor:null, above:false, color: meta.color || "charcoal"};
  } else {
    projDialog = {mode:"add", target:null, name:"", anchor: name || null, above: !!above, color:"charcoal"};
  }
  renderProjectDialog();
  document.getElementById("proj-dialog-backdrop").classList.add("show");
  setTimeout(()=>{ const i = document.getElementById("pd-name"); if(i){ i.focus(); i.select(); } }, 30);
}

function renderProjectDialog(){
  const d = projDialog; if(!d) return;
  const title = d.mode === "edit" ? tr("proj.edit_title") : tr("proj.add_title");
  const okText = d.mode === "edit" ? tr("common.save") : tr("common.add");
  const swatches = PROJECT_COLORS.map(c =>
    `<span class="pd-sw${c===d.color?' sel':''}" style="background:${TODOIST_COLORS[c]}" title="${c.replace(/_/g,' ')}" onclick="selectProjColor('${c}')">${SVG.check}</span>`
  ).join("");
  document.getElementById("proj-dialog").innerHTML = `
    <div class="pd-head">${title}</div>
    <div class="pd-body">
      <label class="pd-label" for="pd-name">${tr("proj.name_label")}</label>
      <input id="pd-name" class="pd-input" type="text" value="${esc(d.name)}" maxlength="120"
             placeholder="${tr("proj.name_ph")}" oninput="onProjNameInput(this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault(); submitProjectDialog();} else if(event.key==='Escape'){closeProjectDialog();}">
      <label class="pd-label">${tr("proj.color_label")} <span class="pd-cname" id="pd-cname">${(d.color||'').replace(/_/g,' ')}</span></label>
      <div class="pd-swatches">${swatches}</div>
    </div>
    <div class="pd-foot">
      <button class="pd-btn cancel" onclick="closeProjectDialog()">${tr("common.cancel")}</button>
      <button class="pd-btn primary" id="pd-ok" onclick="submitProjectDialog()" ${d.name.trim()?'':'disabled'}>${okText}</button>
    </div>`;
}

function onProjNameInput(v){
  projDialog.name = v;
  const ok = document.getElementById("pd-ok");
  if(ok) ok.disabled = !v.trim();
}
function selectProjColor(c){
  projDialog.color = c;
  const sw = [...document.querySelectorAll("#proj-dialog .pd-sw")];
  PROJECT_COLORS.forEach((cc,i)=>{ if(sw[i]) sw[i].classList.toggle("sel", cc===c); });
  const cn = document.getElementById("pd-cname"); if(cn) cn.textContent = c.replace(/_/g,' ');
}
function closeProjectDialog(){
  document.getElementById("proj-dialog-backdrop").classList.remove("show");
  projDialog = null;
}
function submitProjectDialog(){
  const d = projDialog; if(!d) return;
  const nm = (d.name||"").trim();
  if(!nm) return;
  if(d.mode === "edit"){
    if(currentView === "project:" + d.target) currentView = "project:" + nm;
    post("/api/project_update", {name: d.target, new_name: nm, color: d.color});
  } else {
    post("/api/project_add", {name: nm, color: d.color, anchor: d.anchor, above: d.above});
  }
  closeProjectDialog();
}
function archiveProject(name){
  if(currentView === "project:" + name) currentView = "inbox";
  post("/api/project_archive", {name});
}
function confirmDeleteProject(name){
  projDialog = {mode:"delete", target:name};
  document.getElementById("proj-dialog").innerHTML = `
    <div class="pd-head">${tr("proj.delete_title")}</div>
    <div class="pd-body"><p style="color:var(--text-2); font-size:14px; line-height:1.5; margin:8px 0 2px;">${tr("proj.delete_body", {name: esc(name)})}</p></div>
    <div class="pd-foot">
      <button class="pd-btn cancel" onclick="closeProjectDialog()">${tr("common.cancel")}</button>
      <button class="pd-btn primary" onclick="doDeleteProject()">${tr("common.delete")}</button>
    </div>`;
  document.getElementById("proj-dialog-backdrop").classList.add("show");
}
function doDeleteProject(){
  const n = projDialog && projDialog.target;
  closeProjectDialog();
  if(n){
    if(currentView === "project:" + n) currentView = "inbox";
    post("/api/project_delete", {name:n});
  }
}

/* ---- project drag reorder (sidebar) ---- */
let draggedProjectName = null;
function onProjDragStart(e, name){
  draggedProjectName = name;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", `project:${name}`);
  e.currentTarget.classList.add("proj-dragging");
  e.stopPropagation();
}
function onProjDragEnd(e){
  e.currentTarget.classList.remove("proj-dragging");
  document.querySelectorAll(".project-item.proj-drop-before, .project-item.proj-drop-after")
    .forEach(el => el.classList.remove("proj-drop-before","proj-drop-after"));
  draggedProjectName = null;
}
function onProjDragOver(e){
  if(!draggedProjectName) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const li = e.currentTarget;
  const r = li.getBoundingClientRect();
  const after = (e.clientY - r.top) > r.height / 2;
  li.classList.toggle("proj-drop-after", after);
  li.classList.toggle("proj-drop-before", !after);
}
function onProjDragLeave(e){
  e.currentTarget.classList.remove("proj-drop-before","proj-drop-after");
}
function onProjDrop(e, targetName){
  e.preventDefault(); e.stopPropagation();
  const li = e.currentTarget;
  const after = li.classList.contains("proj-drop-after");
  li.classList.remove("proj-drop-before","proj-drop-after");
  const moved = draggedProjectName;
  if(!moved || moved === targetName) return;
  submitProjectReorder(moved, targetName, after ? "after" : "before");
}
function submitProjectReorder(movedName, targetName, position){
  // Notebook is pinned (not reorderable) — only the regular projects shuffle.
  if(movedName === NOTEBOOK_PROJECT || targetName === NOTEBOOK_PROJECT) return;
  const current = projects.filter(p => p !== INBOX_NAME && p !== NOTEBOOK_PROJECT);
  const fromIdx = current.indexOf(movedName);
  if(fromIdx === -1) return;
  current.splice(fromIdx, 1);
  let toIdx = current.indexOf(targetName);
  if(toIdx === -1) return;
  if(position === "after") toIdx += 1;
  current.splice(toIdx, 0, movedName);
  const head = projects.filter(p => p === INBOX_NAME || p === NOTEBOOK_PROJECT);
  projects = [...head, ...current];
  render();
  post("/api/project_reorder", {order: current});
}

/* ============ MY PROJECTS PAGE ============ */
/* ============ FILTER QUERY ENGINE ============
   Follows Todoist's filter syntax (verified against the official docs):
   operators & | ! ( ) ,  +  date/priority/label/project/section/search terms.
   The parser is forgiving — an unrecognized term falls back to a text search. */
function fqTokenize(q){
  const toks = []; let buf = "";
  const flush = () => { const t = buf.trim(); if(t) toks.push({t:"term", v:t}); buf = ""; };
  for(const c of q){
    if(c==="("||c===")"||c==="&"||c==="|"||c===","){ flush(); toks.push({t:c}); }
    else if(c==="!"){ flush(); toks.push({t:"!"}); }
    else buf += c;
  }
  flush();
  return toks;
}
function fqParse(q){
  const toks = fqTokenize(q || ""); let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  function pOr(){ let n = pAnd(); while(peek() && (peek().t==="|" || peek().t===",")){ next(); n = {op:"or", a:n, b:pAnd()}; } return n; }
  function pAnd(){ let n = pNot(); while(peek() && peek().t==="&"){ next(); n = {op:"and", a:n, b:pNot()}; } return n; }
  function pNot(){ if(peek() && peek().t==="!"){ next(); return {op:"not", a:pNot()}; } return pPrim(); }
  function pPrim(){
    const tk = peek();
    if(!tk) return {op:"true"};                 // empty query → match everything
    if(tk.t==="("){ next(); const n = pOr(); if(peek() && peek().t===")") next(); return n; }
    if(tk.t==="term"){ next(); return {op:"term", v:tk.v}; }
    next(); return {op:"true"};                  // stray operator → ignore
  }
  return pOr();
}
function fqDate(offset){ const d = new Date(); d.setDate(d.getDate() + offset); return iso(d); }
function fqTermMatch(termRaw, t){
  const term = termRaw.trim();
  const low = term.toLowerCase();
  if(term.startsWith("@")){ const n = term.slice(1).trim().toLowerCase(); return (t.chosen_labels||[]).some(l => l.toLowerCase() === n); }
  if(term.startsWith("##")){ const n = term.slice(2).trim().toLowerCase(); return (t.project||"").toLowerCase() === n; }
  if(term.startsWith("#")){ const n = term.slice(1).trim().toLowerCase(); return (t.project||"").toLowerCase() === n; }
  if(term.startsWith("/")){ const n = term.slice(1).trim(); if(n === "*" || n === "") return !t.section; return (t.section||"").toLowerCase() === n.toLowerCase(); }
  if(low.startsWith("search:")){ const kw = term.slice(7).trim().toLowerCase(); return ((t.text||"")+" "+(t.description||"")).toLowerCase().includes(kw); }
  // Assignment is a shared-project feature. In a personal account no task has an
  // assignee, so every assignment predicate is false — matching real Todoist
  // (e.g. the default "assigned to: me" filter shows 0 tasks here).
  if(low === "assigned" || low === "shared" || low.startsWith("assigned to:") ||
     low.startsWith("assigned by:") || low.startsWith("added by:") || low.startsWith("workspace:")) return false;
  let m = low.match(/^p([1-4])$/) || low.match(/^priority\s*([1-4])$/);
  if(m) return t.priority === "P" + m[1];
  if(low === "no priority") return (t.priority||"P4") === "P4";
  if(low === "no date" || low === "no due date") return !t.due_date;
  if(low === "no deadline") return !t.deadline_date;
  if(low === "today") return !!t.due_date && isToday(t.due_date);
  if(low === "tomorrow") return t.due_date === fqDate(1);
  if(low === "yesterday") return t.due_date === fqDate(-1);
  if(low === "overdue" || low === "over due" || low === "od") return !!t.due_date && isOverdue(t.due_date);
  if(low === "recurring") return !!t.due_is_recurring;
  if(low === "no labels") return !(t.chosen_labels && t.chosen_labels.length);
  if(low === "subtask") return false;          // our list shows top-level tasks only
  if(low === "view all") return true;
  m = low.match(/^(-?\d+)\s*days?$/) || low.match(/^next\s+(\d+)\s*days?$/);
  if(m){
    if(!t.due_date) return false;
    const n = parseInt(m[1], 10);
    return n >= 0 ? (t.due_date >= fqDate(0) && t.due_date <= fqDate(n))
                  : (t.due_date >= fqDate(n) && t.due_date <= fqDate(0));
  }
  // Unknown term → forgiving text search
  return ((t.text||"")+" "+(t.description||"")).toLowerCase().includes(low);
}
function fqEval(node, t){
  switch(node.op){
    case "true": return true;
    case "term": return fqTermMatch(node.v, t);
    case "not": return !fqEval(node.a, t);
    case "and": return fqEval(node.a, t) && fqEval(node.b, t);
    case "or": return fqEval(node.a, t) || fqEval(node.b, t);
  }
  return false;
}
let _fqCache = {};  // query string -> parsed AST (cleared when a filter is edited)
function fqAst(query){
  if(!(query in _fqCache)) _fqCache[query] = fqParse(query);
  return _fqCache[query];
}
function filterById(id){ return filters.find(f => f.id === id); }
function runFilter(query){
  const ast = fqAst(query);
  return state.filter(t => !t.completed && fqEval(ast, t));
}
function filterCount(f){ return f ? runFilter(f.query).length : 0; }

function labelCount(name){
  return state.filter(t => !t.completed && (t.chosen_labels || []).includes(name)).length;
}
function filterRowHtml(f){
  const c = TODOIST_COLORS[f.color] || "var(--text-2)";
  const sync = f.is_synced
    ? `<span class="fl-synced" title="${tr('fl.synced_badge')}">${SVG.cloud}</span>`
    : `<span class="fl-local" title="${tr('fl.local_badge')}">${SVG.cloudOff}</span>`;
  return `<div class="pp-item" onclick="setView('filter:${esc(f.id)}')">
    ${sync}
    <span class="ico" style="color:${c}">${SVG.filter}</span>
    <span class="pp-name">${esc(f.name)}</span>
    <span class="pp-count">${filterCount(f) || ""}</span>
    <span class="project-actions pp-actions" onclick="openFilterMenu(event,'${esc(f.id)}')">${SVG.moreH}</span>
  </div>`;
}
function renderFiltersLabelsPage(row){
  // Filters split into two groups: synced (mirrored to Todoist, max 3) and local.
  const synced = filters.filter(f => f.is_synced);
  const local  = filters.filter(f => !f.is_synced);
  const syncList = synced.length ? synced.map(filterRowHtml).join("") : `<div class="pp-empty">${tr("fl.none_synced")}</div>`;
  const localList = local.length ? local.map(filterRowHtml).join("") : `<div class="pp-empty">${tr("fl.none_local")}</div>`;
  const filtersSec =
    `<div class="fl-section">
       <div class="fl-head">${tr("fl.filters")}</div>
       <div class="fl-subhead">${tr("fl.synced_head")} <span class="fl-slots">${synced.length}/${FILTER_LIMIT}</span></div>
       <div class="pp-list">${syncList}</div>
       <div class="fl-subhead">${tr("fl.local_head")}</div>
       <div class="pp-list">${localList}</div>
       <button class="pp-add fl-add" onclick="openFilterDialog('add')">
         <span class="pp-add-ico">${SVG.plus}</span>${tr("fl.add")}
       </button>
     </div>`;
  // Labels: live Todoist labels. Clicking one opens that label's tasks.
  const labelRows = LABELS.length
    ? LABELS.map(l => {
        const c = lblColor(l.name);
        return `<div class="pp-item" onclick="setView('label:${esc(l.name)}')">
          <span class="ico" style="color:${c}">${SVG.labelTag}</span>
          <span class="pp-name">${esc(l.name)}</span>
          <span class="pp-count">${labelCount(l.name) || ""}</span>
        </div>`;
      }).join("")
    : `<div class="pp-empty">${tr("fl.no_labels")}</div>`;
  const labelsSec =
    `<div class="fl-section">
       <div class="fl-head">${tr("fl.labels")}</div>
       <div class="pp-list">${labelRows}</div>
     </div>`;
  row.innerHTML = `<div class="projects-page">${filtersSec}${labelsSec}</div>`;
}

