/* ============ POLL ============ */
// Background sync (server-side) refreshes SQLite every 30s.
// To see the UI live — 10s poll, but only when idle
// (focused input/textarea, modal, inline-add form → poll stops).
function shouldPoll(){
  if(window.__trayHidden) return false;   // window hidden to the tray (app.py) — resume on show
  if(modalTaskId) return false;
  if(inlineAdd) return false;
  if(subAddFor || commentAddFor) return false;
  const el = document.activeElement;
  if(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return false;
  if(document.getElementById("lightbox").classList.contains("show")) return false;
  return true;
}
setInterval(() => { if(shouldPoll()) fetchState(); }, 10000);

window.addEventListener("online", () => {
  isOffline = false;
  showToast(tr("toast.online"), "ok");
  manualSync();
});
window.addEventListener("offline", () => {
  isOffline = true;
  showToast(tr("toast.offline"), "warn");
  render();
});

// Bootstrap: load the language first, then the app
(window.I18N ? window.I18N.init() : Promise.resolve()).then(() => {
  if(window.I18N){ window.I18N.apply(); updateLangToggle(); }
  fetchState();
});
