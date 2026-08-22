/* ============================================================
   Buddy — the engine (state, decay, phases, sprites, XP).

   Ported out of the playground `Desktop/Tamagotchi/buddy-todoister.html`,
   which keeps engine and UI in one 3300-line file. Only the SYSTEM came
   over; the full window's UI (celebrations, dialogs, speech bubble, gold
   piles, name editing, pickers) stayed behind and arrives with the full
   window later. Creature facts live in js/15-buddy-creatures.js — nothing
   dragon-specific belongs here.

   All logic sits inside this IIFE: the host app already owns globals named
   `state`, `render`, `save` and `tr`, so only window.Buddy is exposed.

   ❗ Two deliberate differences from the playground, both because the app
   has no Buddy window yet:
     1. queued level-ups apply immediately in a loop instead of being
        staggered one-per-celebration — there is no celebration to wait on;
     2. hatching (egg -> phase 3) sets `hatched` silently, without the
        one-time naming popup.
   Both must be re-synced when the full window lands, or the two versions
   drift apart.
   ============================================================ */
(function () {

  /* ============ Active creature ============ */
  var CREATURE = (window.selectCreature ? window.selectCreature() : (window.CREATURE || (window.CREATURES || {}).dragon));
  if (!CREATURE) { console.warn('buddy: no creature definition loaded — engine disabled'); return; }
  // Sprite sheet -> CSS var, so app.css never hardcodes the creature's picture.
  document.documentElement.style.setProperty('--sprite-sheet', "url('" + CREATURE.sprite.url + "')");

  /* ============ Constants ============ */
  var MAX_SPRITE_STAGE = CREATURE.growth.maxSpriteStage;
  // care cost depends only on phase: feed = play = 10 + (phase-1),
  // sleep = floor(5 + (phase-1)*0.5) -> +1 every second phase
  var FEED_BASE = 10, PLAY_BASE = 10, SLEEP_BASE = 5;
  function feedCost(stage) { return FEED_BASE + (stage - 1); }
  function playCost(stage) { return PLAY_BASE + (stage - 1); }
  function sleepCost(stage) { return Math.floor(SLEEP_BASE + (stage - 1) * 0.5); }
  var CARE_GAIN = 30;
  var HEALTHY_THRESHOLD = 25; // a stat below this blocks growth
  var DEATH_DAYS = 3;         // PRESENT days at food=0 = death (only food kills)
  var DAY_MS = 24 * 60 * 60 * 1000;
  var TICK_MS = 60 * 1000;    // heartbeat: settle decay, wake from sleep, repaint
  // Absence rules — see the "Presence" block below for what counts as being here.
  var ABSENCE_MS = 48 * 60 * 60 * 1000;  // grace window after the last interaction
  var ABSENCE_RATE = 0.25;               // decay speed once that window has passed
  var NEGLECT_LOSS = 0.10;               // share of the level lost per neglected day
  var NEGLECT_FLOOR_STAGE = 14;          // ...and the phase that loss can never cross

  /* ============ State ============ */
  // Default name for the active creature in the app's current language.
  function creatureName() {
    var l = (window.I18N && window.I18N.lang) || 'en';
    var dn = CREATURE.defaultName || {};
    return dn[l] || dn.en || 'Buddy';
  }

  var state = {
    xp: 0,            // current spendable balance
    totalEarned: 0,   // lifetime XP (counter only)
    stage: 1,         // current phase (advances by consuming balance)
    food: 100,
    happy: 100,
    energy: 100,
    alive: true,
    daysAtZero: 0,
    sleeping: false,
    sleepStart: 0,
    sleepDuration: 0,
    sleepStartEnergy: 0,
    eatingUntil: 0,
    vacation: false,
    hatched: false,
    mascotName: creatureName(),
    lastUpdate: Date.now(),
    lastInteractionAt: Date.now(), // last click/keypress inside the window
    lastPresenceDay: '',           // calendar day that was last charged
    neglectDays: 0                 // present days in a row spent under the threshold
  };

  /* ============ Local encryption (obfuscation tier) ============ */
  // The save is stored encrypted so it is unreadable at a glance and not
  // casually editable. Obfuscation-grade only — the key ships with the app.
  // The keyed checksum makes a hand-edited save fail to load (-> fresh state).
  // ❗ Same key and envelope as the playground, so a save moves between them.
  var BUDDY_KEY = 'mg-buddy-v1::7Qx2-pLm9-Zr4t-Wd8k';
  var ENC_PREFIX = 'B1:';

  function _hash32(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function _mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function _keystream(key, salt, n) {
    var rnd = _mulberry32(_hash32(key + '|' + salt));
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = (rnd() * 256) & 0xff;
    return out;
  }
  function _checksum(key, bytes) {
    var h = _hash32(key);
    for (var i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 2654435761) >>> 0;
    return (h >>> 0).toString(36);
  }
  function _b64encode(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function _b64decode(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function encryptState(obj) {
    var data = new TextEncoder().encode(JSON.stringify(obj)); // UTF-8 (Georgian names)
    var r = new Uint32Array(1); crypto.getRandomValues(r);
    var salt = r[0].toString(36); // per-save salt -> ciphertext differs every write
    var ks = _keystream(BUDDY_KEY, salt, data.length);
    var enc = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) enc[i] = data[i] ^ ks[i];
    return ENC_PREFIX + salt + '.' + _checksum(BUDDY_KEY, enc) + '.' + _b64encode(enc);
  }
  function decryptState(str) {
    if (str.indexOf(ENC_PREFIX) !== 0) return JSON.parse(str); // legacy plain save
    var body = str.slice(ENC_PREFIX.length);
    var d1 = body.indexOf('.'), d2 = body.indexOf('.', d1 + 1);
    var salt = body.slice(0, d1);
    var sum = body.slice(d1 + 1, d2);
    var enc = _b64decode(body.slice(d2 + 1));
    if (_checksum(BUDDY_KEY, enc) !== sum) throw new Error('integrity check failed (tampered or wrong key)');
    var ks = _keystream(BUDDY_KEY, salt, enc.length);
    var data = new Uint8Array(enc.length);
    for (var i = 0; i < enc.length; i++) data[i] = enc[i] ^ ks[i];
    return JSON.parse(new TextDecoder().decode(data));
  }

  /* ============ Save / load ============ */
  // ❗ localStorage for now — same key as the playground. Moving the save into
  // triage.db (SQLite) is still open; see the dragon memory file.
  var STORE_KEY = 'mascot_test';
  function save() {
    try { localStorage.setItem(STORE_KEY, encryptState(state)); }
    catch (e) { console.warn('buddy: save failed —', e && e.message); }
  }
  function load() {
    var s = null;
    try { s = localStorage.getItem(STORE_KEY); } catch (e) { s = null; }
    if (s) {
      try {
        var parsed = decryptState(s);
        if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
        state = parsed;
        // Migrations for older saves
        if (state.totalEarned === undefined) state.totalEarned = state.xp;
        if (state.sleeping === undefined) state.sleeping = false;
        if (state.sleepStart === undefined) state.sleepStart = 0;
        if (state.sleepDuration === undefined) state.sleepDuration = 0;
        if (state.sleepStartEnergy === undefined) state.sleepStartEnergy = 0;
        if (state.eatingUntil === undefined) state.eatingUntil = 0;
        if (state.vacation === undefined) state.vacation = false;
        if (state.hatched === undefined) state.hatched = (state.stage >= 3);
        if (state.mascotName === undefined) state.mascotName = creatureName();
        if (state.mascotName === 'Vasiko') state.mascotName = creatureName();
        if (state.lastUpdate === undefined) state.lastUpdate = Date.now();
        if (state.lastInteractionAt === undefined) state.lastInteractionAt = state.lastUpdate;
        if (state.lastPresenceDay === undefined) state.lastPresenceDay = '';
        if (state.neglectDays === undefined) state.neglectDays = 0;
        if (state.alive) {   // stats stay >= 1 while alive (old 0% saves)
          state.food = Math.max(1, state.food);
          state.happy = Math.max(1, state.happy);
          state.energy = Math.max(1, state.energy);
        }
        if (state.stage === undefined) {   // derive the phase from lifetime XP
          state.stage = 1;
          while (totalXpToReachStage(state.stage + 1) <= state.totalEarned) {
            state.stage++;
            if (state.stage > 10000) break;
          }
        }
      } catch (e) {
        console.warn('buddy: ignored corrupted save, starting fresh —', e && e.message);
      }
    }
    applyTimeDecay();
  }

  /* ============ Presence ============
     Everything punitive in this engine is keyed to days the user was actually
     here. A "present day" = a calendar day with at least one click or keypress
     inside the window.

     ❗ Presence is taken from INTERACTION, not from the window being visible.
     Todoister hides to the tray on X and the process keeps running — sync,
     badge, this heartbeat — so a live process is not presence. And a window
     left open on a second monitor is not presence either; only a hidden window
     would be caught by a visibility flag, an untouched one would not.

     The rule this implements, in one line:
         absence is forgiven, presence plus neglect is not. */
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // One neglected day above the sprite ceiling costs a share of the current
  // level. Scale-free, so it stings the same at every phase. When the balance
  // runs out the level itself drops and a gold pile leaves the cave floor —
  // which is only safe up here, where the sprite is frozen and the hoard is
  // the only thing rendering the level. ❗ Phase 14 is the floor: the grown
  // creature can never be taken away, only its gold. You lose time, not the pet.
  function chargeNeglect() {
    state.xp -= xpToNextFromStage(getStage()) * NEGLECT_LOSS;
    while (state.xp < 0 && state.stage > NEGLECT_FLOOR_STAGE) {
      state.stage--;
      state.xp += xpToNextFromStage(state.stage);
    }
    if (state.xp < 0) state.xp = 0;
  }

  // Charge one present day, once. Called from markInteraction.
  function settlePresentDay(now) {
    var key = dayKey(now);
    if (state.lastPresenceDay === key) return false;   // this day is already paid
    var firstEver = !state.lastPresenceDay;
    state.lastPresenceDay = key;
    // a fresh save gets its first day free; eggs, sleep, vacation and death
    // are all outside the rules anyway
    if (firstEver || !state.alive || state.vacation || getStage() <= 2) return false;

    var changed = false;
    // Starvation only runs on days he was here — this is what makes it
    // impossible for an absence to kill the pet, however long it lasts.
    if (state.food <= 1) {
      state.daysAtZero += 1;
      changed = true;
      if (CREATURE.can.die && state.daysAtZero >= DEATH_DAYS) {
        state.alive = false;
        state.food = 0; state.happy = 0; state.energy = 0;
      }
    }
    // Neglect: seen first (the ill sprite, every phase), charged only above 13.
    // Below that the consequences are the ill picture and the shut growth gate
    // and nothing else — a bar leak there would be refilled by the day's income
    // before it was noticed, so the only person it could ever reach is one who
    // opens the app and finishes nothing. That is a bad week, not carelessness.
    if (state.alive && avgComfort() < HEALTHY_THRESHOLD) {
      state.neglectDays += 1;
      changed = true;
      if (getStage() >= NEGLECT_FLOOR_STAGE) chargeNeglect();
    } else if (state.neglectDays) {
      state.neglectDays = 0;
      changed = true;
    }
    return changed;
  }

  var _lastMark = 0, _lastMarkSaved = 0;
  function markInteraction() {
    var now = Date.now();
    if (now - _lastMark < 1000) return;      // key repeat / drag noise
    _lastMark = now;
    applyTimeDecay();                        // settle the old span before the clock resets
    var changed = settlePresentDay(now);
    state.lastInteractionAt = now;
    // the timestamp has to survive a restart, but not at one write per click
    if (changed || now - _lastMarkSaved > TICK_MS) { _lastMarkSaved = now; save(); }
    if (changed) renderStrip();
  }

  /* ============ Real-time decay ============ */
  // Stats fall in real time, app open or not: the elapsed time since
  // lastUpdate is converted to a fraction of a day and charged at once.
  // Inside the 48 h after the last interaction that time counts in full; past
  // that it counts at a quarter, so four days away costs about what one day
  // here does. Being away is not a choice the app should punish, and the fix
  // has to be retroactive — vacation mode has to be remembered in advance,
  // which is exactly the thing ADHD does not do.
  function effectiveDays(from, to) {
    var boundary = (state.lastInteractionAt || 0) + ABSENCE_MS;
    var fastMs = Math.max(0, Math.min(to, boundary) - from);
    var slowMs = Math.max(0, to - Math.max(from, boundary));
    return (fastMs + slowMs * ABSENCE_RATE) / DAY_MS;
  }

  function applyTimeDecay() {
    var now = Date.now();
    // time is frozen while dead, on vacation, asleep, or still an egg
    if (!state.alive || state.vacation || state.sleeping || getStage() <= 2) {
      state.lastUpdate = now;
      return;
    }
    if (now - state.lastUpdate <= 0) { state.lastUpdate = now; return; }   // clock moved back
    var elapsedDays = effectiveDays(state.lastUpdate, now);

    var ss = statList();
    for (var i = 0; i < ss.length; i++) {
      var k = ss[i].key;
      state[k] = Math.max(1, state[k] - elapsedDays * ss[i].decay);
    }

    // ❗ The starvation clock is NOT charged here — it advances one day at a
    // time in settlePresentDay(), so time spent away never counts towards
    // death. All that happens here is the reset: fed above the floor, clear.
    if (state.food > 1) state.daysAtZero = 0;
    state.lastUpdate = now;
  }

  /* ============ Phases / XP ============
     xpToNext(N) = ceil(xpToNext(N-1) * m / 10) * 10, starting at 50 — each
     level costs m more than the last, rounded up to the nearest ten. A level-up
     consumes balance; state.totalEarned is a lifetime counter only.

     m is not constant: 1.1 through phase 7, then 1.25.
       50 60 70 80 90 100 | 130 170 220 280 350 440 550  = 2590 to phase 14
     The head must stay fast — a first day that cracks the egg, hatches it and
     reaches the first drawn sprite is what makes the pet a hook at all; a
     reward two weeks out is a reward that does not exist. The tail is where it
     should stretch, so the last sprites arrive as something anticipated. */
  var GROWTH_M_EARLY = 1.1, GROWTH_M_LATE = 1.25;
  var GROWTH_M_SWITCH = 6;   // index of the 7->8 cost, the first one to steepen
  var _xpCostCache = [];
  function xpToNextFromStage(stage) {
    if (stage <= 0) return 0;
    while (_xpCostCache.length < stage) {
      if (_xpCostCache.length === 0) { _xpCostCache.push(50); continue; }
      var m = _xpCostCache.length < GROWTH_M_SWITCH ? GROWTH_M_EARLY : GROWTH_M_LATE;
      _xpCostCache.push(Math.ceil(_xpCostCache[_xpCostCache.length - 1] * m / 10) * 10);
    }
    return _xpCostCache[stage - 1];
  }
  var _totalXpCache = [0];
  function totalXpToReachStage(N) {
    if (N <= 1) return 0;
    while (_totalXpCache.length < N) {
      var idx = _totalXpCache.length;
      _totalXpCache.push(_totalXpCache[idx - 1] + xpToNextFromStage(idx));
    }
    return _totalXpCache[N - 1];
  }
  function getStage() { return state.stage; }
  function xpToNext() { return Math.max(0, xpToNextFromStage(state.stage) - state.xp); }

  function statList() { return CREATURE.stats; }
  function statMin() { return HEALTHY_THRESHOLD; }

  // Average comfort across all stats — how well the creature is being kept.
  // ❗ It does NOT touch income any more; see addXP for why.
  function avgComfort() {
    var ss = statList(), sum = 0;
    for (var i = 0; i < ss.length; i++) sum += state[ss[i].key];
    return sum / ss.length;
  }

  // The growth gate: a single stat below its minimum blocks the level-up.
  function isHealthyForGrowth() {
    var ss = statList();
    for (var i = 0; i < ss.length; i++) if (state[ss[i].key] < statMin(ss[i].key)) return false;
    return true;
  }
  function reviveCost() { return Math.ceil(xpToNextFromStage(Math.max(1, state.stage - 1)) * 0.5); }
  // Earned enough but held back by an unwell stat (drives the red hint later).
  function isGrowthPaused() {
    return state.alive && getStage() >= 3 && !isHealthyForGrowth()
        && state.xp >= xpToNextFromStage(state.stage) - 1;
  }
  // Ill: the visible consequence of neglect, at every phase. The picture
  // desaturates and the growth gate is shut. Above phase 13 it also costs gold
  // (chargeNeglect) — but only on days he was actually here.
  function isNeglected() {
    return state.alive && getStage() >= 3 && avgComfort() < HEALTHY_THRESHOLD;
  }

  function canAdvanceNow() {
    if (!state.alive || state.sleeping || state.vacation) return false;
    if (state.eatingUntil && Date.now() < state.eatingUntil) return false;  // not mid-meal
    if (!isHealthyForGrowth()) return false;
    return state.xp >= xpToNextFromStage(state.stage);
  }
  function advanceOneLevel() {
    if (!canAdvanceNow()) return false;
    var wasEgg = state.stage <= 2;
    state.xp -= xpToNextFromStage(state.stage);
    state.stage++;
    // ❗ no naming popup here yet — the playground opens one on the first hatch
    if (wasEgg && state.stage >= 3 && !state.hatched) state.hatched = true;
    return true;
  }
  // ❗ Queued levels apply at once (see the header note): with no celebration
  // to pace them, staggering would only hide progress.
  function checkGrowth() {
    var grew = false, guard = 0;
    while (advanceOneLevel()) { grew = true; if (++guard > 10000) break; }
    if (grew) flashLevel();     // the strip's only celebration until the window has one
    return grew;
  }

  /* ============ Care ============ */
  function care(stat) {
    if (!state.alive || state.sleeping || state.vacation) return false;
    applyTimeDecay();                       // settle pending decay first
    if (getStage() <= 2) return false;      // an egg needs no care
    // capability gate — a creature that cannot eat/play/sleep ignores that action
    if (stat === 'food' && !CREATURE.can.eat) return false;
    if (stat === 'happy' && !CREATURE.can.play) return false;
    if (stat === 'energy' && !CREATURE.can.sleep) return false;
    if (state.energy <= 1 && stat === 'happy') return false;                        // too tired to play
    if (stat === 'energy' && state.eatingUntil && Date.now() < state.eatingUntil) return false; // mid-meal

    var stage = getStage();
    var cost = stat === 'energy' ? sleepCost(stage)
             : stat === 'food' ? feedCost(stage)
             : playCost(stage);
    if (state.xp < cost) return false;

    if (stat === 'energy') {                // sleep is not one-shot
      if (state.energy >= 100) return false;
      state.xp -= cost;
      startSleep();
      return true;
    }
    if (state[stat] >= 100) return false;
    state.xp -= cost;
    state[stat] = Math.min(100, state[stat] + CARE_GAIN);
    if (stat === 'food') {
      state.energy = Math.min(100, state.energy + 10);
      state.eatingUntil = Date.now() + (5000 + Math.random() * 5000); // eating animation 5-10 s
      repaintAt(state.eatingUntil);
    }
    checkGrowth();                          // recovery may release queued XP
    save(); renderStrip();
    return true;
  }

  function startSleep() {
    applyTimeDecay();                       // settle decay before freezing time
    state.sleeping = true;
    state.sleepStart = Date.now();
    state.sleepDuration = (120 + Math.random() * 180) * 1000;  // 2-5 minutes
    state.sleepStartEnergy = state.energy;
    save(); renderStrip();
  }
  function endSleep() {
    state.energy = 100;
    state.happy = Math.min(100, state.happy + 10);
    state.sleeping = false;
    state.sleepStart = 0;
    state.sleepDuration = 0;
    state.sleepStartEnergy = 0;
    state.lastUpdate = Date.now();          // the sleep period does not decay
    checkGrowth();
    save(); renderStrip();
  }

  /* ============ Sprites ============ */
  // Which cell of the sheet: the creature owns the layout, the engine only asks.
  function getSpritePos(stage, slot) { return CREATURE.spriteAt(stage, slot); }
  function bgPos(pos) {
    var s = CREATURE.sprite;
    return ((pos.col / (s.cols - 1)) * 100) + '% ' + ((pos.row / (s.rows - 1)) * 100) + '%';
  }
  // CREATURE.scaleAt() (the phase growth curve) is deliberately NOT used here:
  // the strip's 63px scene shows every phase at the same fixed scale(0.85), the
  // way the playground draws it. The curve belongs to the full window's scene.

  // Which state the picture shows, most urgent first.
  function getActiveSlot() {
    var stage = getStage();
    if (stage === 1) return 'egg1';
    if (stage === 2) return 'egg2';
    if (!state.alive) return 'dead';
    if (state.vacation) return 'idle_normal';
    if (state.sleeping) return 'sleeping';
    if (state.eatingUntil && Date.now() < state.eatingUntil) return 'eating';
    if (state.food <= 1) return 'hungry';
    if (state.energy < 25) return 'sleepy';
    if (state.happy >= 75) return 'idle_happy';
    if (state.happy >= 50) return 'idle_joyful';
    return 'idle_normal';
  }

  /* ============ XP income ============ */
  function addXP(n) {
    if (!state.alive || state.vacation) return 0;
    applyTimeDecay();
    var stage = getStage();
    // ❗ The creature's condition never changes what the user's work is worth.
    // A finished task pays the same whether the pet is thriving or starving —
    // the old "unwell -> flat +1" branch cut a 30 XP task to 1 in the middle of
    // a bad week, which is a 97% cut on the one act this whole app exists to
    // encourage, delivered at the worst possible moment. If a hungry pet can
    // devalue closed work, the pet has become a tax on the app's core function.
    // Neglect is answered by the gate below and by the ill sprite, never here.
    var added = Math.max(0, Math.round(n));
    // Gate closed: XP may rise to levelCost-1 but never cross into a level.
    // The surplus is frozen, not lost — it lands once the pet recovers.
    if (stage >= 3 && !isHealthyForGrowth()) {
      var cap = Math.max(0, xpToNextFromStage(stage) - 1);
      added = Math.min(added, Math.max(0, cap - state.xp));
    }
    state.xp += added;
    state.totalEarned += added;
    checkGrowth();
    save(); renderStrip();
    return added;
  }

  // Time travel, for testing: push lastUpdate back N days and re-settle.
  function tick(days) {
    if (!state.alive) return;
    if (getStage() <= 2) { save(); renderStrip(); return; }
    state.lastUpdate -= days * DAY_MS;
    applyTimeDecay();
    save(); renderStrip();
  }

  /* ============ The sidebar strip ============
     Report only for now — the rings show the three stats, nothing is
     clickable. Markup lives in index.html (.buddy-strip). */
  var RING_KEYS = ['food', 'happy', 'energy'];   // ring order = markup order

  // Anything else drawing the same state (the window) subscribes here, so the
  // engine never has to know who is on screen.
  var listeners = [];
  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
  }
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { console.warn('buddy: listener failed —', e && e.message); }
    }
  }

  /* ============ The HEY signal ============
     The strip's job is to tell you when to look, so anything urgent takes over
     the one line of free text it has — the name — and gives it back afterwards.
     Same states the playground's HEY bubble showed. Two tones: `hey` for the
     things that want you now, `hey calm` for the ones that are just news.
     ❗ Card level was dropped, so this is the only place urgency can appear. */
  var _flashUntil = 0;            // level-up: transient, deliberately not saved
  function flashLevel() { _flashUntil = Date.now() + 8000; repaintAt(_flashUntil); }
  // The heartbeat is a minute wide; a signal that lasts seconds needs its own
  // repaint or it lingers until the next tick.
  function repaintAt(ts) {
    var ms = ts - Date.now();
    if (ms > 0 && ms < 15 * 60 * 1000) setTimeout(renderStrip, ms + 50);
  }

  function heySignal() {
    var now = Date.now();
    if (!state.alive) return { key: 'buddy.hey_dead', calm: false };
    if (getStage() <= 2 || state.vacation) return null;    // egg and vacation say nothing
    if (state.sleeping) return { key: 'buddy.hey_sleep', calm: true };
    if (state.eatingUntil && now < state.eatingUntil) return { key: 'buddy.hey_eat', calm: true };
    if (now < _flashUntil) return { key: 'buddy.hey_level', calm: true };
    if (state.food <= HEALTHY_THRESHOLD) return { key: 'buddy.hey_hungry', calm: false };
    if (state.energy <= HEALTHY_THRESHOLD) return { key: 'buddy.hey_tired', calm: false };
    if (state.happy <= HEALTHY_THRESHOLD) return { key: 'buddy.hey_sad', calm: false };
    return null;
  }

  function renderStrip() {
    var strip = document.getElementById('buddy-strip');
    if (!strip) { notify(); return; }   // no strip on screen, but the window may be

    var stage = getStage();
    var nameEl = strip.querySelector('.buddy-name');
    if (nameEl) {
      var isEgg = stage <= 2;
      var hey = heySignal();
      nameEl.textContent = hey
        ? ((window.I18N && window.I18N.t(hey.key)) || hey.key)
        : (isEgg ? ((window.I18N && window.I18N.t('buddy.egg_name')) || 'Egg') : state.mascotName);
      nameEl.classList.toggle('hey', !!hey);
      nameEl.classList.toggle('calm', !!(hey && hey.calm));
    }
    var lvlEl = strip.querySelector('.buddy-lv b');
    if (lvlEl) lvlEl.textContent = stage;

    // Picture: sheet cell for the current phase + state, scaled by the growth curve.
    var dragonEl = strip.querySelector('.buddy-dragon');
    if (dragonEl) {
      var pos = getSpritePos(stage, getActiveSlot());
      if (pos) {
        dragonEl.style.backgroundPosition = bgPos(pos);
        dragonEl.style.display = '';
      } else {
        dragonEl.style.display = 'none';   // phase with no drawn sprite
      }
    }

    var rings = strip.querySelectorAll('.buddy-ring');
    for (var i = 0; i < rings.length && i < RING_KEYS.length; i++) {
      var v = Math.max(0, Math.min(100, state[RING_KEYS[i]]));
      rings[i].style.setProperty('--p', v);
      rings[i].classList.remove('mid', 'bad');
      if (v <= 25) rings[i].classList.add('bad');
      else if (v <= 50) rings[i].classList.add('mid');
    }
    strip.classList.toggle('vacation', !!state.vacation);
    strip.classList.toggle('dead', !state.alive);
    strip.classList.toggle('sick', isNeglected());   // desaturated + dimmed (app.css)
    notify();
  }

  /* ============ Heartbeat ============
     Decay is recomputed from lastUpdate on every load, so a tick that only
     repaints needs no write — we save when the tick actually changed
     something (woke up, or the pet died). */
  function heartbeat() {
    var wasAlive = state.alive;
    if (state.sleeping && state.sleepStart && Date.now() - state.sleepStart >= state.sleepDuration) {
      endSleep();
      return;
    }
    applyTimeDecay();
    if (wasAlive && !state.alive) save();
    renderStrip();
  }

  /* ============ Init ============ */
  load();
  renderStrip();
  setInterval(heartbeat, TICK_MS);
  // The presence signal — one listener per event, capture phase so nothing can
  // swallow it. This is the whole implementation of "a day the app was opened";
  // app.py is not involved at all.
  document.addEventListener('pointerdown', markInteraction, true);
  document.addEventListener('keydown', markInteraction, true);
  if (window.I18N && window.I18N.onChange) window.I18N.onChange(renderStrip);

  window.Buddy = {
    addXP: addXP,
    care: care,
    tick: tick,
    render: renderStrip,
    onChange: onChange,
    getState: function () { return state; },
    // what a scene needs to draw the creature: which cell, and how big for this phase
    spriteStyle: function () {
      var pos = getSpritePos(getStage(), getActiveSlot());
      return { pos: pos ? bgPos(pos) : null, scale: CREATURE.scaleAt(getStage()), sick: isNeglected() };
    },
    comfort: avgComfort,
    levelCost: function () { return xpToNextFromStage(getStage()); },
    // read-only helpers the UI layers ask for
    getStage: getStage,
    xpToNext: xpToNext,
    costs: function () {
      var s = getStage();
      return { food: feedCost(s), happy: playCost(s), energy: sleepCost(s) };
    },
    isGrowthPaused: isGrowthPaused,
    isNeglected: isNeglected,
    neglectDays: function () { return state.neglectDays || 0; },
    reviveCost: reviveCost,
    maxSpriteStage: MAX_SPRITE_STAGE
  };
})();
