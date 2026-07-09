/* ============ BOARD ============ */
function renderBoard(row){
  const proj = currentProject();
  const namedSecs = projectSections[proj] || [];
  const columns = [{name:"", title:tr("section.none"), editable:false}];
  namedSecs.forEach(s => columns.push({name:s, title:s, editable:true}));

  let html = columns.map(col => renderSection(proj, col)).join("");
  html += (inlineSection && inlineSection.proj === proj && inlineSection.after === "__end__")
    ? renderAddSectionForm(proj, "__end__")
    : `<button class="board_add_section_trigger" onclick="startAddSection('${esc(proj)}','__end__')">${tr("section.add")}</button>`;
  row.innerHTML = html;
}

function renderSection(proj, col){
  const items = state.filter(t => t.project === proj && (t.section || "") === col.name && !t.completed);
  const cards = items.map(t => taskCard(t)).join("");
  const menuBtn = col.editable
    ? `<button class="menu-btn" onclick="openSectionMenu(event,'${esc(proj)}','${esc(col.name)}')">⋯</button>`
    : "";
  const titleEl = col.editable ? sectionTitleHtml(proj, col.name) : esc(col.title);
  const renamingThis = inlineRename && inlineRename.proj === proj && inlineRename.name === col.name;
  const headerDrag = (col.editable && !renamingThis)
    ? `draggable="true" ondragstart="onSectionDragStart(event,'${esc(col.name)}')" ondragend="onSectionDragEnd(event)"`
    : "";
  const adding = inlineAdd && !inlineAdd.global && inlineAdd.proj === proj && inlineAdd.section === col.name;
  const footer = adding ? renderAddForm(proj, col.name)
    : `<button class="plus_add_button" onclick="startInlineAdd('${esc(proj)}','${esc(col.name)}')"><span class="icon_add">${SVG.plus}</span>${tr("task.add")}</button>`;

  return `<section class="board_section board_view" data-col="${esc(col.name || '_none_')}" data-editable="${col.editable ? '1' : '0'}" aria-label="${esc(col.title)}"
    ondragover="onColDragOver(event)" ondragleave="onColDragLeave(event)" ondrop="onColDrop(event,'${esc(col.name)}')">
    <header class="board-section-header" ${headerDrag}>
      <h3>${titleEl}</h3>
      <p>${items.length}</p>
      <span class="spacer"></span>
      ${menuBtn}
    </header>
    <div class="board-task-list" role="group">${cards}</div>
    <div class="board-add-wrap">${footer}</div>
  </section>`;
}

function taskCard(t){
  let tags = "";
  if(t.due_date){
    let cls = "";
    if(isToday(t.due_date)) cls = " date-today";
    else if(isOverdue(t.due_date)) cls = " date-overdue";
    else {
      const tom = (function(){ const x = new Date(); x.setDate(x.getDate()+1); return iso(x); })();
      if(t.due_date === tom) cls = " date-tomorrow";
      else if(isFuture(t.due_date)) cls = " date-future";
    }
    const recIco = t.due_is_recurring ? `<span class="ico sm">${SVG.refresh}</span>` : `<span class="ico sm">${SVG.calendar}</span>`;
    tags += `<span class="tag${cls}" ${t.due_string?`title="${esc(t.due_string)}"`:''}>${recIco}${fmtDate(t.due_date)}${t.due_time?" "+t.due_time:""}</span>`;
  } else if(t.due_is_recurring && t.due_string){
    tags += `<span class="tag"><span class="ico sm">${SVG.refresh}</span>${esc(t.due_string)}</span>`;
  }
  const subs = t.subtasks || [];
  if(subs.length){
    tags += `<span class="tag"><span class="ico sm">${SVG.list}</span>${subs.filter(s=>s.done).length}/${subs.length}</span>`;
  }
  const comms = t.comments || [];
  if(comms.length){
    tags += `<span class="tag"><span class="ico sm">${SVG.message}</span>${comms.length}</span>`;
  }
  const lbls = t.chosen_labels || [];
  const LBL_MAX = 3;
  if(lbls.length){
    let chips = lbls.slice(0, LBL_MAX).map(l =>
      `<span class="tag"><span class="ico sm" style="color:${lblColor(l)}">${SVG.labelTag}</span>${esc(l)}</span>`
    ).join("");
    if(lbls.length > LBL_MAX) chips += `<span class="tag">+${lbls.length - LBL_MAX}</span>`;
    tags += `<span class="card-labels">${chips}</span>`;
  }
  if(t.review_status === "help"){
    tags += `<span class="tag help"><span class="ico sm">${SVG.help}</span>${tr("tag.help")}</span>`;
  }
  const desc = t.description ? `<div class="task_description">${esc(t.description.split("\n")[0].slice(0,80))}</div>` : "";

  const draggable = !t.completed;
  return `<div class="board_task ${t.completed?'completed':''}" ${draggable?'draggable="true"':''}
    ${draggable?`ondragstart="onCardDragStart(event,'${t.id}')" ondragend="onCardDragEnd(event)"`:''}>
    <div class="board-task-card" id="${esc(t.section||'null')}/${t.id}" role="group" onclick="openModal('${t.id}')">
      <div class="task-card-row">
        <button class="task_checkbox ${PCLS[t.priority]||''}" role="checkbox" aria-label="Checkbox for ${esc(t.text)}" onclick="event.stopPropagation(); completeTask('${t.id}')"></button>
        <div class="task-title-container">
          <div id="task-${t.id}-title">
            <div class="task_content">${esc(t.text.split("\n")[0])}</div>
            ${desc}
          </div>
          ${tags ? `<div id="task-info-tags">${tags}</div>` : ""}
        </div>
        <button class="menu-btn" onclick="event.stopPropagation(); openTaskCtxMenu(event,'${t.id}')">⋯</button>
      </div>
    </div>
  </div>`;
}

/* ============ LIST ============ */
function renderList(row){
  const list = visibleTasks();

  // Section-grouped list (project view, no search) — Todoist-style
  if(isProjectView() && !searchQuery && currentView !== "completed"){
    const proj = currentProject();
    const namedSecs = projectSections[proj] || [];
    const sections = [{name: ""}].concat(namedSecs.map(s => ({name: s})));

    let html = `<div class="list-wrap">`;
    sections.forEach((sec, idx) => {
      const tasks = list.filter(t => (t.section || "") === sec.name);
      if(sec.name){
        html += `<header class="list-sec-head">
          <h3>${sectionTitleHtml(proj, sec.name)}</h3>
          <span class="count">${tasks.length}</span>
          <span class="spacer"></span>
          <button class="menu-btn" onclick="openSectionMenu(event,'${esc(proj)}','${esc(sec.name)}')">⋯</button>
        </header>`;
      }
      tasks.forEach(t => { html += taskCard(t); });
      const adding = inlineAdd && !inlineAdd.global && inlineAdd.proj === proj && inlineAdd.section === sec.name;
      if(adding){
        html += renderAddForm(proj, sec.name);
      } else {
        html += `<button class="plus_add_button list-add" onclick="startInlineAdd('${esc(proj)}','${esc(sec.name)}')"><span class="icon_add">${SVG.plus}</span>${tr("task.add")}</button>`;
      }
      // Hover-only "+ Add section" divider — between sections (not after the last)
      if(inlineSection && inlineSection.proj === proj && inlineSection.after === sec.name){
        html += renderAddSectionForm(proj, sec.name);
      } else if(idx < sections.length - 1){
        html += `<div class="section-divider" onclick="startAddSection('${esc(proj)}','${esc(sec.name)}')"><span class="add-sec-label">${tr("section.add")}</span></div>`;
      }
    });
    html += (inlineSection && inlineSection.proj === proj && inlineSection.after === "__end__")
      ? renderAddSectionForm(proj, "__end__")
      : `<button class="list-add-section" onclick="startAddSection('${esc(proj)}','__end__')">${tr("section.add")}</button>`;
    html += `</div>`;
    row.innerHTML = html;
    return;
  }

  // Filter & label views — honor the Display (group / sort) options
  if(isDisplayView()){
    if(list.length === 0){ row.innerHTML = filterEmptyHtml(); return; }
    const groups = groupTasks(sortTasks(list));
    let html = `<div class="list-wrap">`;
    groups.forEach(grp => {
      if(grp.label){
        html += `<header class="list-sec-head"><h3>${esc(grp.label)}</h3><span class="count">${grp.tasks.length}</span></header>`;
      }
      grp.tasks.forEach(t => { html += taskCard(t); });
    });
    html += `</div>`;
    row.innerHTML = html;
    return;
  }
  // Flat list — search, today, upcoming, completed
  if(list.length === 0){
    row.innerHTML = `<div class="empty-state">${tr("common.no_tasks")}</div>`;
    return;
  }
  row.innerHTML = `<div class="list-wrap">${list.map(t => taskCard(t)).join("")}</div>`;
}

