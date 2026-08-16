/* ============ MODAL ============ */
function openModal(id){
  modalTaskId = id;
  subAddFor = null; commentAddFor = null;
  document.getElementById("modal-backdrop").classList.add("show");
  renderModal();
}
function closeModal(){
  modalTaskId = null;
  subAddFor = null; commentAddFor = null;
  document.getElementById("modal-backdrop").classList.remove("show");
}
function renderModal(){
  const t = T(modalTaskId);
  if(!t){ closeModal(); return; }

  const subs = (t.subtasks||[]).map((s,i) => {
    const prioCls = (s.priority && s.priority !== "P4") ? " " + s.priority.toLowerCase() : "";
    let subMeta = "";
    if(s.due_date){
      let cls = "";
      if(isToday(s.due_date)) cls = " date-today";
      else if(isOverdue(s.due_date)) cls = " date-overdue";
      else {
        const tom = (function(){ const x = new Date(); x.setDate(x.getDate()+1); return iso(x); })();
        if(s.due_date === tom) cls = " date-tomorrow";
        else if(isFuture(s.due_date)) cls = " date-future";
      }
      const ico = s.due_is_recurring ? SVG.refresh : SVG.calendar;
      subMeta += `<span class="tag${cls}"><span class="ico sm">${ico}</span>${fmtDate(s.due_date)}${s.due_time?" "+s.due_time:""}</span>`;
    } else if(s.due_is_recurring && s.due_string){
      subMeta += `<span class="tag"><span class="ico sm">${SVG.refresh}</span>${esc(s.due_string)}</span>`;
    }
    (s.chosen_labels||[]).forEach(l => {
      subMeta += `<span class="tag"><span class="ico sm" style="color:${lblColor(l)}">${SVG.labelTag}</span>${esc(l)}</span>`;
    });
    return `<div class="sub-row${s.done?' done':''}">
      <button class="sub-check${prioCls}${s.done?' done':''}" onclick="toggleSub('${t.id}',${i},${!s.done})">${SVG.check}</button>
      <div class="sub-body">
        <span class="sub-text" onclick="openModal('${s.id}')">${esc(s.text)}</span>
        ${subMeta ? `<div class="sub-meta">${subMeta}</div>` : ""}
      </div>
      <button class="sub-del" onclick="delSub('${t.id}',${i})" title="${tr("common.delete")}">×</button>
    </div>`;
  }).join("");

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <span class="breadcrumb">${esc(t.project)}${t.section?' / '+esc(t.section):''}</span>
      <span class="spacer"></span>
      <button class="mh-btn" onclick="navTask(-1)" title="${esc(tr('modal.prev_task'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
      <button class="mh-btn" onclick="navTask(1)" title="${esc(tr('modal.next_task'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
      ${t.sticky ? `<button class="task-pin mh-pin" onclick="toggleSticky('${t.id}')" title="${esc(tr('sticky.unmake'))}"><span class="on">${SVG.pin}</span><span class="off">${SVG.pinOff}</span></button>` : ""}
      <button class="mh-btn" onclick="openTaskCtxMenu(event,'${t.id}', true)" title="${esc(tr('modal.more_actions'))}"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
      <button class="mh-btn" onclick="closeModal()" title="${esc(tr('common.close'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="modal-main">
        <div class="modal-name-row">
          <button class="modal-check ${PCLS[t.priority]||''}${t.completed?' done':''}" onclick="completeTask('${t.id}')">${t.completed?SVG.check:''}</button>
          <textarea class="modal-title" rows="1" oninput="autoSize(this)" onblur="upd('${t.id}','text',this.value)">${esc(t.text)}</textarea>
        </div>
        <div class="modal-desc-row">
          <textarea class="modal-desc" rows="1" oninput="autoSize(this)" onblur="upd('${t.id}','description',this.value)" placeholder="${tr("modal.description_ph")}">${esc(t.description)}</textarea>
        </div>
        <div class="modal-subtasks">
          <div class="subtasks-head">${tr("modal.subtasks")} ${(t.subtasks||[]).length ? `(${(t.subtasks||[]).filter(s=>s.done).length}/${(t.subtasks||[]).length})` : ""}</div>
          ${subs}
          ${subAddFor === t.id
            ? `<div class="add-form sub-add-form">
                <input id="sub-add-input" placeholder="${tr("modal.subtask_name_ph")}" onkeydown="handleSubAddKey(event,'${t.id}')">
                <div class="form-actions">
                  <span></span>
                  <div class="form-buttons">
                    <button class="btn-secondary" onclick="cancelSubAdd()">${tr("common.cancel")}</button>
                    <button class="btn-primary" onclick="submitSubAdd('${t.id}')">${tr("modal.add_subtask")}</button>
                  </div>
                </div>
              </div>`
            : `<button class="sub-add-btn" onclick="startSubAdd('${t.id}')"><span class="plus">+</span> ${tr("modal.add_subtask")}</button>`}
        </div>
        ${renderComments(t)}
      </div>
      <div class="modal-side">
        ${(function(){
          const crown = `<span class="md-pro" title="${esc(tr('pro.locked'))}">${GOLD_CROWN}</span>`;
          const plus = `<span class="md-plus">${SVG.plus}</span>`;
          const chosen = t.chosen_labels || [];
          const isRec = t.due_is_recurring || (t.due_string && /^every/i.test(t.due_string));
          const dateIco = isRec ? REPEAT_ICON : SVG.calendar;
          let dateTxt;
          if(isRec){
            // The recurrence string carries its own time ("every Friday at 17:00").
            // Only append due_time during the brief window before Todoist syncs it in.
            let lbl = repeatLabel(t.due_string);
            if(t.due_time && lbl.indexOf(t.due_time) === -1) lbl += " " + t.due_time;
            dateTxt = esc(lbl);
          } else {
            dateTxt = `${fmtDate(t.due_date)}${t.due_time ? ' ' + t.due_time : ''}`;
          }
          const dateVal = t.due_date
            ? `<span class="md-ico">${dateIco}</span><span class="md-txt">${dateTxt}</span>`
            : plus;
          const projVal = `<span class="md-ico" style="color:${projColor(t.project)}">${SVG.hash}</span><span class="md-txt">${esc(t.project)}${t.section ? " / " + esc(t.section) : ""}</span>`;
          const prioVal = `<span class="md-ico ${PCLS[t.priority] || ''}">${SVG.flag}</span><span class="md-txt">${t.priority}</span>`;
          return `
            <div class="md-field">
              <div class="md-key">${tr("modal.project")}</div>
              <button class="md-val" onclick="openModalProject(event,'${t.id}')">${projVal}</button>
            </div>
            <hr class="md-sep">
            <div class="md-field">
              <div class="md-key">${tr("modal.date")}</div>
              <button class="md-val${t.due_date ? '' : ' empty'}" id="md-date-btn" onclick="openModalDate(event,'${t.id}')">${dateVal}</button>
            </div>
            <hr class="md-sep">
            <div class="md-field">
              <div class="md-key">${tr("modal.deadline")} ${crown}</div>
              <button class="md-val empty" disabled title="${esc(tr('pro.locked'))}">${plus}</button>
            </div>
            <hr class="md-sep">
            <div class="md-field">
              <div class="md-key">${tr("modal.priority")}</div>
              <button class="md-val" onclick="openModalPriority(event,'${t.id}')">${prioVal}</button>
            </div>
            <hr class="md-sep">
            <div class="md-field labels">
              <div class="md-key">${tr("modal.labels")}</div>
              <div class="md-labels">
                ${chosen.map(l => `<span class="md-chip"><span class="ch-color" style="background:${lblColor(l)}"></span><span class="md-chip-name">${esc(l)}</span><button class="md-chip-x" title="${esc(tr('labels.remove'))}" onclick="event.stopPropagation(); toggleLabel('${t.id}','${l}'); renderModal()">×</button></span>`).join("")}
                <button class="md-label-add" title="${esc(tr('modal.set_labels'))}" onclick="openModalLabels(event,'${t.id}')">${SVG.plus}</button>
              </div>
            </div>
            <hr class="md-sep">
            <div class="md-field">
              <div class="md-key">${tr("modal.reminders")} ${crown}</div>
              <button class="md-val empty" disabled title="${esc(tr('pro.locked'))}">${plus}</button>
            </div>
            <hr class="md-sep">
            <div class="md-field">
              <div class="md-key">${tr("modal.location")} ${crown}</div>
              <button class="md-val empty" disabled title="${esc(tr('pro.locked'))}">${plus}</button>
            </div>`;
        })()}
      </div>
    </div>`;
  document.querySelectorAll(".modal textarea").forEach(autoSize);
}
function autoSize(el){
  el.style.height = "auto";
  el.style.height = (el.scrollHeight + 2) + "px";
}

/* ============ COMMENTS ============ */
function fmtCommentTime(iso){
  if(!iso) return "";
  try{
    const d = new Date(iso);
    const today = new Date(); today.setHours(0,0,0,0);
    const day = new Date(d); day.setHours(0,0,0,0);
    const diff = Math.round((today - day)/86400000);
    const hm = d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
    if(diff === 0) return `Today ${hm}`;
    if(diff === 1) return `Yesterday ${hm}`;
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")} ${hm}`;
  } catch(e){ return iso.slice(0,16).replace("T"," "); }
}

function fmtSize(b){
  if(!b) return "";
  if(b < 1024) return b + " B";
  if(b < 1024*1024) return (b/1024).toFixed(0) + " KB";
  return (b/1024/1024).toFixed(1) + " MB";
}

function renderComments(t){
  const comms = t.comments || [];
  const list = comms.map(c => {
    let att = "";
    if(c.attachment){
      const a = c.attachment;
      const isImage = a.image || (a.file_type && a.file_type.startsWith("image/"));
      if(isImage){
        // Use tn_l[0] (528px) for preview; full image for lightbox.
        // Todoist file URLs require Bearer auth → proxy through our server.
        const thumb = (a.tn_l && a.tn_l[0]) || (a.tn_m && a.tn_m[0]) || a.image || a.file_url;
        const full  = a.image || a.file_url || thumb;
        const thumbProxy = "/api/attachment?u=" + encodeURIComponent(thumb);
        const fullProxy  = "/api/attachment?u=" + encodeURIComponent(full);
        const cap = [a.file_name, fmtSize(a.file_size)].filter(Boolean).join(" · ");
        att = `<div class="comment-att">
          <img class="comment-att-img" src="${esc(thumbProxy)}" alt="" onclick="openLightbox('${esc(fullProxy)}')">
          ${cap ? `<div class="comment-att-caption">${esc(cap)}</div>` : ""}
        </div>`;
      } else if(a.file_url){
        const fileProxy = "/api/attachment?u=" + encodeURIComponent(a.file_url);
        const cap = [a.file_name, fmtSize(a.file_size)].filter(Boolean).join(" · ");
        att = `<div class="comment-att">
          <a class="comment-att-file" href="${esc(fileProxy)}" target="_blank">📎 ${esc(cap || tr("common.file"))}</a>
        </div>`;
      }
    }
    return `<div class="comment-row">
      <div class="comment-avatar">${tr("user.initial")}</div>
      <div class="comment-body">
        <div class="comment-meta"><span class="author">${tr("user.name")}</span><span>${fmtCommentTime(c.posted_at)}</span></div>
        <div class="comment-text">${esc(c.content)}</div>
        ${att}
      </div>
      <button class="comment-del" onclick="delComment('${c.id}')" title="${tr("common.delete")}">×</button>
    </div>`;
  }).join("");

  const addUi = commentAddFor === t.id
    ? `<div class="add-form sub-add-form">
        <textarea id="comment-add-input" placeholder="${tr("comment.placeholder")}" rows="2" style="width:100%; border:none; background:none; padding:0; color:var(--text); font-size:14px; resize:none; outline:none; font-family:inherit; line-height:1.5;" onkeydown="handleCommentKey(event,'${t.id}')"></textarea>
        <div class="comment-attach-bar">
          <input type="file" id="comment-file-input"
            style="position:absolute; left:-9999px; width:1px; height:1px; opacity:0; pointer-events:none;"
            onchange="onCommentFile(event)">
          <label class="comment-attach-btn" for="comment-file-input" title="${tr("comment.attach_file")}">${SVG.paperclip} ${tr("comment.attach")}</label>
          <div class="comment-attach-status" id="comment-attach-status" style="display:none"></div>
        </div>
        <div class="form-actions">
          <span></span>
          <div class="form-buttons">
            <button class="btn-secondary" onclick="cancelCommentAdd()">${tr("common.cancel")}</button>
            <button class="btn-primary" onclick="submitComment('${t.id}')">${tr("comment.submit")}</button>
          </div>
        </div>
      </div>`
    : `<button class="comment-add-btn" onclick="startCommentAdd('${t.id}')"><span class="plus">+</span> ${tr("comment.add")}</button>`;

  return `<div class="modal-comments">
    <div class="comments-head">${tr("comment.comments")} ${comms.length ? `(${comms.length})` : ""}</div>
    ${list}
    ${addUi}
  </div>`;
}

function startCommentAdd(id){
  commentAddFor = id; renderModal();
  setTimeout(()=>{ const i = document.getElementById("comment-add-input"); if(i){ i.focus(); autoSize(i); } }, 0);
}
function cancelCommentAdd(){ commentAddFor = null; commentDraftAttachment = null; renderModal(); }
function handleCommentKey(e, id){
  // Ctrl+Enter / Cmd+Enter submits
  if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); submitComment(id); }
  if(e.key === "Escape") cancelCommentAdd();
  setTimeout(()=>autoSize(e.target), 0);
}
let commentDraftAttachment = null;

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmtBytes(b){
  if(b < 1024) return b + " B";
  if(b < 1024*1024) return (b/1024).toFixed(0) + " KB";
  return (b/1024/1024).toFixed(1) + " MB";
}

async function onCommentFile(ev){
  const file = ev.target.files && ev.target.files[0];
  if(!file) return;
  const status = document.getElementById("comment-attach-status");
  if(!status) return;
  status.style.display = "";
  status.classList.remove("error");
  status.textContent = tr("upload.uploading", {file: file.name, size: fmtBytes(file.size)});
  try {
    const d = await uploadFileToTodoist(file);
    commentDraftAttachment = d;
    status.innerHTML = `📎 ${esc(d.file_name || file.name)} <span style="color:var(--text-3)">${fmtBytes(d.file_size || file.size)}</span><span class="x" onclick="clearCommentAttachment()" title="${tr("common.delete")}">×</span>`;
  } catch(e){
    status.classList.add("error");
    status.textContent = e.message;
    commentDraftAttachment = null;
  } finally {
    ev.target.value = "";
  }
}

function clearCommentAttachment(){
  commentDraftAttachment = null;
  const status = document.getElementById("comment-attach-status");
  if(status){ status.style.display = "none"; status.textContent = ""; }
}

async function submitComment(id){
  const input = document.getElementById("comment-add-input");
  const v = (input && input.value.trim()) || "";
  if(!v && !commentDraftAttachment){ cancelCommentAdd(); return; }
  const body = {id, text: v};
  if(commentDraftAttachment) body.attachment = commentDraftAttachment;
  commentAddFor = null;
  commentDraftAttachment = null;
  await post("/api/comment_add", body);
}
async function delComment(cid){
  if(!await uiConfirm({title: tr("comment.delete_confirm"), ok: tr("common.delete")})) return;
  post("/api/comment_delete", {comment_id:cid});
}

/* ============ LIGHTBOX ============ */
function openLightbox(url){
  document.getElementById("lightbox-img").src = url;
  document.getElementById("lightbox").classList.add("show");
}
function closeLightbox(){
  document.getElementById("lightbox").classList.remove("show");
  document.getElementById("lightbox-img").src = "";
}

