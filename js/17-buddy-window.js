/* ============================================================
   Buddy window — the full view, inside Todoister.

   Ported from the standalone playground (Desktop/Tamagotchi/buddy-todoister.html).
   The playground is a self-contained page with its own palette, its own i18n
   engine (BI18N) and its own dialogs; here the window is a normal app modal:
   Todoister's colour tokens, Todoister's I18N, the app's markup conventions.
   Geometry (cave block, the sprite's floor line, the phase growth curve) is
   the one thing copied unchanged — those numbers belong to the sprite sheet.

   All state comes from window.Buddy (js/16-buddy.js). This file only draws.

   ❗ Not ported yet — still only in the playground: level-up celebrations,
   gold piles (phase 14+), the speech bubble, settings/help, rename, vacation,
   death/revive.
   ============================================================ */
(function () {

  var SEG_COUNT = 10;   // every bar is ten segments, as in the playground
  var STATS = [
    { key: 'food',   label: 'buddy.food' },
    { key: 'happy',  label: 'buddy.fun' },
    { key: 'energy', label: 'buddy.energy' }
  ];

  function t(key, vars) { return (window.I18N ? window.I18N.t(key, vars) : key); }
  function el(id) { return document.getElementById(id); }

  // Ten segments, filled to the given percentage; colour follows the same
  // thresholds the strip's rings use, so both read the same at a glance.
  function paintSegs(box, pct) {
    if (!box) return;
    if (box.childElementCount !== SEG_COUNT) {
      box.innerHTML = new Array(SEG_COUNT + 1).join('<span class="seg"></span>');
    }
    var on = Math.round(Math.max(0, Math.min(100, pct)) / (100 / SEG_COUNT));
    var kids = box.children;
    for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < on);
    box.classList.remove('mid', 'bad');
    if (pct <= 25) box.classList.add('bad');
    else if (pct <= 50) box.classList.add('mid');
  }

  function isOpen() {
    var b = el('bw-backdrop');
    return !!b && b.classList.contains('on');
  }

  function render() {
    if (!isOpen() || !window.Buddy) return;
    var s = window.Buddy.getState();
    var stage = window.Buddy.getStage();
    var isEgg = stage <= 2;

    el('bw-lvl').textContent = stage;
    el('bw-xp').textContent = Math.round(s.xp);
    el('bw-name').textContent = isEgg ? t('buddy.egg_name') : s.mascotName;

    // level ring: how far the balance has come towards the next phase
    var cost = window.Buddy.levelCost();
    var done = cost > 0 ? Math.max(0, Math.min(1, s.xp / cost)) : 0;
    var C = 2 * Math.PI * 24;
    el('bw-ring-prog').style.strokeDashoffset = (C * (1 - done)).toFixed(1);
    el('bw-to-next').textContent = t('buddy.to_next', { n: window.Buddy.xpToNext(), stage: stage + 1 });

    // the creature: sheet cell for the current state, size from the phase curve
    var sp = window.Buddy.spriteStyle();
    var pic = el('bw-sprite');
    if (sp.pos) { pic.style.backgroundPosition = sp.pos; pic.style.display = ''; }
    else pic.style.display = 'none';
    el('bw-scale').style.setProperty('--bw-dragon-scale', sp.scale);
    el('bw-zzz').classList.toggle('on', !!s.sleeping);
    el('bw-scene').classList.toggle('sick', !!sp.sick);   // ill: grey creature, dim cave

    // life = the average of the three stats
    var life = window.Buddy.comfort();
    el('bw-life-v').textContent = Math.round(life) + '%';
    paintSegs(el('bw-life-segs'), life);

    // the three stats, each also its care button
    var costs = window.Buddy.costs();
    for (var i = 0; i < STATS.length; i++) {
      var k = STATS[i].key;
      var v = Math.max(0, Math.min(100, s[k]));
      el('bw-' + k + '-v').textContent = Math.round(v) + '%';
      paintSegs(el('bw-' + k + '-segs'), v);
      el('bw-' + k + '-cost').textContent = t('buddy.cost', {
        xp: costs[k], gain: k === 'energy' ? 100 : 30, stat: t(STATS[i].label).toLowerCase()
      });
      // blocked = the engine would refuse the action anyway; show it instead of
      // letting the click do nothing
      var blocked = isEgg || !s.alive || s.sleeping || s.vacation
        || s.xp < costs[k] || v >= 100
        || (k === 'happy' && s.energy <= 1);
      el('bw-btn-' + k).classList.toggle('blocked', blocked);
    }
  }

  window.openBuddyWindow = function () {
    var b = el('bw-backdrop');
    if (!b) return;
    b.classList.add('on');
    if (window.I18N && window.I18N.apply) window.I18N.apply(b);
    render();
  };
  window.closeBuddyWindow = function () {
    var b = el('bw-backdrop');
    if (b) b.classList.remove('on');
  };

  // The strip is the way in — clicking it opens the window (the card level in
  // between was dropped, 2026-08-22).
  document.addEventListener('DOMContentLoaded', function () {
    var strip = el('buddy-strip');
    if (strip) strip.addEventListener('click', window.openBuddyWindow);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) window.closeBuddyWindow();
  });

  // Redraw whenever the engine changes state (care, XP, decay heartbeat).
  if (window.Buddy && window.Buddy.onChange) window.Buddy.onChange(render);
  if (window.I18N && window.I18N.onChange) window.I18N.onChange(render);
})();
