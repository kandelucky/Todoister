/* ============================================================
   Buddy — creature layer (registry + the dragon definition).

   Copied verbatim from the playground `Desktop/Tamagotchi/creatures/`
   (registry.js + dragon.js, 2026-06-07) — that pair is the live one; the
   older copy under the gitignored `buddy/creatures/` lacks the `stats`
   block the engine reads. Two changes only:
     - the two files are concatenated (registry first, so window.CREATURES
       exists before the dragon registers itself);
     - sprite.url -> /assets/buddy-dragon.png, the path this app serves.
   Everything dragon-specific lives here; js/16-buddy.js stays
   creature-agnostic. A new creature = another block in this file.
   ============================================================ */

/* ============================================================
   Creature registry — the swappable "creature/thing" layer.

   The Buddy SYSTEM (xp, decay, growth, death, vacation, save, UI)
   is creature-agnostic. Everything that makes the pet a *dragon*
   (sprite sheet, growth curve, end-game, voice, name, what it can
   do) lives in a creature definition under window.CREATURES.

   To add a new creature or thing:
     1. copy creatures/dragon.js → creatures/<id>.js
     2. give it its own sprite sheet + config + replies
     3. register it (window.CREATURES.<id> = {...})
     4. include it with a <script> tag in buddy-test.html
     5. select it: localStorage['mascot_creature'] = '<id>'

   A creature that is an inanimate "thing" (no eating/sleeping/
   dying) just sets the matching can.* flags to false — the system
   honours them.
   ============================================================ */
(function () {
  window.CREATURES = window.CREATURES || {};

  // Which creature is active (persisted). Falls back to 'dragon'.
  function activeId() {
    try {
      var id = localStorage.getItem("mascot_creature");
      if (id && window.CREATURES[id]) return id;
    } catch (e) {}
    return "dragon";
  }

  // Resolve + expose the active creature definition as window.CREATURE.
  // Call this once before the Buddy system runs.
  window.selectCreature = function () {
    var def = window.CREATURES[activeId()] || window.CREATURES.dragon;
    window.CREATURE = def;
    return def;
  };

  window.listCreatures = function () { return Object.keys(window.CREATURES); };
})();

/* ============================================================
   Dragon — the default Buddy creature.

   This is the reference creature definition. It is the SINGLE
   source of everything dragon-specific; the system reads from it
   and never hard-codes dragon facts. Use it as the template for
   new creatures/things (see creatures/registry.js).

   Contract consumed by the system:
     id              string
     defaultName     { <lang>: string }   name after hatching
     sprite          { url, cols, rows, cell }   sheet geometry
     can             { eat, sleep, play, die, hatch, endgame }
     growth          { eggStages, maxSpriteStage, scaleFrom, scaleTo }
     slots           [string]             animation/state slots
     spriteAt(stage, slot) -> {row,col}|null
     scaleAt(stage)        -> number
     endgame         { startStage, tierCount, spotsFixed,
                       tierAt(tier)->{row,col}, spotAt(idx)->{x,y} } | null
     phaseName(n)    -> string            age label (informational)
     replies         { okPool:{<lang>:[..]}, okEndgamePool:{<lang>:[..]} }
   ============================================================ */
(function () {
  var SLOTS = ['idle_normal', 'idle_joyful', 'idle_happy', 'sleepy', 'sleeping', 'hungry', 'eating', 'dead'];

  // Fixed floor positions for the first 15 gold piles (% of the scene).
  var GOLD_SPOTS = [
    { x: 7.03, y: 77.93 }, { x: 88.87, y: 78.71 },
    { x: 30.08, y: 81.45 }, { x: 69.14, y: 79.88 },
    { x: 10.16, y: 88.67 }, { x: 51.17, y: 86.13 },
    { x: 92.97, y: 88.48 }, { x: 73.44, y: 89.26 },
    { x: 29.88, y: 88.87 }, { x: 14.84, y: 96.68 },
    { x: 80.08, y: 94.34 }, { x: 51.76, y: 93.23 },
    { x: 34.38, y: 96.94 }, { x: 66.02, y: 96.16 },
    { x: 96.29, y: 95.96 }
  ];

  window.CREATURES = window.CREATURES || {};
  window.CREATURES.dragon = {
    id: 'dragon',

    // Name given on hatch (per language; system picks the active lang).
    defaultName: { en: 'Friend', ka: 'მეგობარი' },

    // Sprite sheet: 1024×1792, 8 cols × 14 rows × 128px cells.
    sprite: { url: '/assets/buddy-dragon.png', cols: 8, rows: 14, cell: 128 },

    // What this creature can do. A lifeless "thing" flips these to false.
    can: { eat: true, sleep: true, play: true, die: true, hatch: true, endgame: true },

    // Growth model. Egg = stages 1..eggStages; sprite changes up to
    // maxSpriteStage, then freezes; scale grows linearly across phases 3..max.
    growth: { eggStages: 2, maxSpriteStage: 13, scaleFrom: 0.64, scaleTo: 3.0 },

    /* Stats: the needs that decay over time. Their average is "Life" (health),
       which drives XP income (the "Connection" multiplier) and the growth gate.
         decay   = % lost per day
         deadly  = sitting at/below deathAt for `grace` days kills the creature
       The engine reads decay + the stat set from here; names come from i18n
       (m.<key>) for this creature, or a `name` field for creatures without i18n. */
    stats: [
      { key: 'food',   decay: 25, deadly: true, deathAt: 1, grace: 3 },
      { key: 'happy',  decay: 20 },
      { key: 'energy', decay: 25 }
    ],

    slots: SLOTS,

    /* Sprite cell for a given stage + state slot.
       Layout:
         Row 0: egg (col 0), egg-hot (col 1), gold tiers 1-6 (cols 2-7)
         Rows 1-11: dragon phases 3-13 (8 SLOTS per row)
         phase 14+ -> freezes on the last dragon row (= phase 13). */
    spriteAt: function (stage, slot) {
      if (stage === 1) return { row: 0, col: 0 };
      if (stage === 2) return { row: 0, col: 1 };
      if (stage >= 3) {
        var idx = SLOTS.indexOf(slot);
        if (idx === -1) return null;
        var clamp = Math.min(stage, this.growth.maxSpriteStage);
        return { row: clamp - 2, col: idx }; // phase 3 -> row 1 ... 13 -> row 11
      }
      return null;
    },

    /* Display scale by phase: linear scaleFrom→scaleTo across 3..max,
       fixed scaleTo from max onward, 1.0 while an egg. */
    scaleAt: function (stage) {
      var g = this.growth;
      if (stage <= g.eggStages) return 1.0;
      if (stage >= g.maxSpriteStage) return g.scaleTo;
      var steps = g.maxSpriteStage - 3;
      return g.scaleFrom + ((stage - 3) / steps) * (g.scaleTo - g.scaleFrom);
    },

    /* End-game (phase 14+): gold piles accumulate on the cave floor.
       13 tiers per spot (1 = smallest … 13 = biggest); 15 fixed spots,
       deterministic pseudo-random after that. Set to null on creatures
       with no end-game. */
    endgame: {
      startStage: 14,
      tierCount: 13,
      spotsFixed: GOLD_SPOTS,

      // Sprite cell for a pile tier (1..13).
      //   tier 1-6: row 0 cols 2-7 | 7-11: row 12 cols 3-7 | 12-13: row 13 cols 2-3
      tierAt: function (tier) {
        if (tier >= 1 && tier <= 6) return { row: 0, col: tier + 1 };
        if (tier >= 7 && tier <= 11) return { row: 12, col: tier - 4 };
        if (tier >= 12 && tier <= 13) return { row: 13, col: tier - 10 };
        return null;
      },

      // Floor position for spot index (1-based). >15 = deterministic random.
      spotAt: function (idx) {
        if (idx <= 15) return this.spotsFixed[idx - 1];
        var r = function (s) { return Math.abs(Math.sin(s * 12345.678)) % 1; };
        return { x: 5 + r(idx * 2) * 90, y: 78 + r(idx * 2 + 1) * 19 };
      }
    },

    // Age label (informational only — the UI shows the number).
    phaseName: function (n) {
      if (n <= 3) return 'Hatchling';
      if (n <= 8) return 'Baby';
      if (n <= 12) return 'Juvenile';
      if (n <= 17) return 'Adult';
      return 'Ancient';
    },

    /* Creature voice — the "all good" idle thoughts. okPool plays at any
       phase; okEndgamePool is added once the end-game begins. This is the
       creature-flavour layer (fire, scales, treasure) — a new creature
       ships its own lines here instead of editing the shared lang files. */
    replies: {
      okPool: {
        en: [
          "I feel wonderful! Thank you so much for your care.",
          "Everything is fine. I'm ready for new adventures!",
          "I have energy, a great mood, and I'm not hungry. It's a perfect day!",
          "I'm glad you are monitoring my stats so closely. I feel very good.",
          "Absolute comfort! You can rest assured, I am in top shape!",
          "Neither hunger nor fatigue bothers me. Everything is in perfect balance.",
          "Wonderful mood! I'm ready to wait for your new tasks.",
          "I feel so strong, I think I'll learn to breathe fire soon!",
          "I'm a small, but already quite strong, healthy, and happy dragon.",
          "(Thinking: I'm warm and safe. This is truly the best cave in the world.)",
          "I wonder, will I grow even bigger and more beautiful next year?",
          "(Thinking: What a pleasant peace... I lack nothing for happiness.)",
          "(Thinking: The world is wonderful when they feed you so deliciously and play with you.)",
          "There's a wonderful storm outside, perfect weather for flying in the clouds.",
          "Lightning and thunder... now that's real dragon weather!",
          "(Thinking: My scales shine even in the pitch-black night, just like a real diamond.)"
        ],
        ka: [
          "თავს შესანიშნავად ვგრძნობ! დიდი მადლობა მზრუნველობისთვის.",
          "ყველაფერი რიგზეა. მზად ვარ ახალი თავგადასავლებისთვის!",
          "ენერგიაც მაქვს, განწყობაც და არც მშია. იდეალური დღეა!",
          "მიხარია, რომ ასე ყურადღებით აკვირდებით ჩემს მაჩვენებლებს. თავს ძალიან კარგად ვგრძნობ.",
          "სრული კომფორტი! შეგიძლიათ მშვიდად იყოთ, საუკეთესო ფორმაში ვარ!",
          "არც შიმშილი მაწუხებს და არც დაღლილობა. ყველაფერი იდეალურ ბალანსშია.",
          "მშვენიერი განწყობაა! მზად ვარ, თქვენი ახალი დავალებების შესრულებას დაველოდო.",
          "თავს ისე ძლიერად ვგრძნობ, მგონი, მალე ცეცხლის ფრქვევასაც ვისწავლი!",
          "პატარა, მაგრამ უკვე საკმაოდ ძლიერი, ჯანმრთელი და ბედნიერი დრაკონი ვარ.",
          "(ფიქრობს: თბილად და უსაფრთხოდ ვარ. ეს ნამდვილად საუკეთესო გამოქვაბულია სამყაროში).",
          "საინტერესოა, მომავალ წელს კიდევ უფრო დიდი და ლამაზი გავიზრდები?",
          "(ფიქრობს: რა სასიამოვნო სიმშვიდეა... არაფერი მაკლია ბედნიერებისთვის).",
          "(ფიქრობს: სამყარო მშვენიერია, როცა ასე გემრიელად გაჭმევენ და გეთამაშებიან).",
          "გარეთ მშვენიერი ქარიშხალია, ღრუბლებში ფრენისთვის იდეალური ამინდია.",
          "ელვა და ჭექა-ქუხილი... აი, ნამდვილი დრაკონული ამინდი!",
          "(ფიქრობს: ჩემი ქერცლი შავბნელ ღამეშიც კი ისე ბრწყინავს, როგორც ნამდვილი ალმასი)."
        ]
      },
      okEndgamePool: {
        en: [
          "(Thinking: My stats are perfect, it's time to gather more gold in the cave.)",
          "(Thinking: I wonder when my gold pile will reach the cave ceiling?)",
          "A few large diamonds would look very good on my new scales...",
          "My treasure keeps growing, though for a real dragon, gold is never enough.",
          "The clinking of gold coins... for me, this is the best music in the world.",
          "Sleeping on a pile of gold — now that is true bliss.",
          "(Thinking: Just one more red diamond and my collection will be flawless.)",
          "Gold, silver, precious stones... I think I'm slowly becoming a real dragon.",
          "(Thinking: This cave is quite cozy, but it lacks more brilliance.)",
          "(Thinking: I wonder when I'll be big enough for this entire cave to be mine?)",
          "(Thinking: This corner of the cave is perfect for storing diamonds.)",
          "(Thinking: The cool atmosphere of this cave really suits my wings.)"
        ],
        ka: [
          "(ფიქრობს: ჩემი მაჩვენებლები იდეალურია, დროა, გამოქვაბულში მეტი ოქრო მოვაგროვო).",
          "(ფიქრობს: ნეტავ ჩემი ოქროს გროვა როდის მიაღწევს გამოქვაბულის ჭერს?)",
          "რამდენიმე მსხვილი ბრილიანტი ძალიან მოუხდებოდა ჩემს ახალ ქერცლს...",
          "ჩემი განძი ისევ იზრდება, თუმცა ნამდვილი დრაკონისთვის ოქრო ბევრი არასდროსაა.",
          "ოქროს მონეტების წკრიალი... ჩემთვის ეს საუკეთესო მუსიკაა სამყაროში.",
          "ძილი ოქროს გროვაზე — აი, რა არის ნამდვილი ნეტარება.",
          "(ფიქრობს: კიდევ ერთი წითელი ალმასი და ჩემი კოლექცია უნაკლო იქნება).",
          "ოქრო, ვერცხლი, ძვირფასი თვლები... მგონი, ნელ-ნელა ნამდვილი დრაკონი ვხდები.",
          "(ფიქრობს: ეს გამოქვაბული საკმაოდ მყუდროა, მაგრამ მეტი ბრწყინვალება აკლია).",
          "(ფიქრობს: ნეტავ როდის გავხდები საკმარისად დიდი, რომ მთელი ეს გამოქვაბული ჩემი გახდეს?)",
          "(ფიქრობს: გამოქვაბულის ეს კუთხე იდეალურია ალმასების შესანახად).",
          "(ფიქრობს: ამ გამოქვაბულის გრილი ატმოსფერო ჩემს ფრთებს ძალიან უხდება)."
        ]
      }
    },

    /* Celebration text shown when a phase is reached (creature voice). Types:
       egg = stage 1→2, level = growth phases, max = reaching the cap (end-game
       begins), gold = each end-game level (minimalist). {n} = the new phase. */
    celebrations: {
      egg:   { en: { t: 'Egg warming up!', b: 'Something stirs inside the shell...' },
               ka: { t: 'კვერცხი თბება!', b: 'ნაჭუჭში რაღაც გაიფაცურდა...' } },
      level: { en: { t: 'Phase {n}!', b: 'Your dragon grew bigger.' },
               ka: { t: 'ფაზა {n}!', b: 'შენი დრაკონი წამოიზარდა.' } },
      max:   { en: { t: 'Fully grown!', b: 'Your dragon now hoards gold in its cave.' },
               ka: { t: 'სრულად გაიზარდა!', b: 'ახლა გამოქვაბულში ოქროს აგროვებს.' } },
      gold:  { en: { t: '+1 gold pile', b: '' },
               ka: { t: '+1 ოქროს გროვა', b: '' } }
    }
  };
})();
