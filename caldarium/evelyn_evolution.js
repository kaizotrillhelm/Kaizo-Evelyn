/* evelyn_evolution.js - Adaptive Curriculum, Focus Detection, Procedural Item
   Evolution (24+ dynamic rows per cartridge) & KV21 Cross-Cartridge Hand-Off.
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynBackend) require("./evelyn_backend.js");
  var B = root.EvelynBackend;

  /* Subject keyword map for detecting player focus mentions & lesson topics */
  var SUBJECT_KEYWORDS = {
    arithmetic: ["add", "subtract", "multiply", "multiplication", "divide", "division", "times table", "arithmetic", "math", "maths", "sums"],
    fractions:  ["fraction", "fractions", "half", "halves", "quarter", "quarters", "decimal", "decimals", "percent", "percentage"],
    ratios:     ["ratio", "ratios", "proportion", "scale", "scaling", "unit rate", "recipe", "batch"],
    factors:    ["factor", "factors", "multiple", "multiples", "prime", "primes", "square", "squares", "area", "rectangle"],
    algebra:    ["algebra", "equation", "equations", "ballast", "constraint", "budget", "expected value"],
    time:       ["time", "clock", "schedule", "schedules", "timetable", "elapsed", "deadline", "minute", "minutes"],
    money:      ["money", "change", "till", "discount", "discounts", "price", "cost", "ledger"],
    phonics:    ["phonics", "letter sound", "rhyme", "rhymes", "syllable", "syllables", "counting", "early reading", "first words"],
    grammar:    ["grammar", "punctuation", "noun", "verb", "adjective", "adverb", "antonym", "synonym", "spelling", "word", "words"],
    writing:    ["writing", "story", "episode", "narrative", "voice", "rule", "creative"],
    science:    ["science", "matter", "melting", "freezing", "density", "buoyancy", "boiling", "climate", "altitude", "temperature", "plant", "plants", "habitat", "ecology", "acid", "base", "chemistry"],
    physics:    ["physics", "speed", "acceleration", "force", "g-force", "projectile", "angle", "reflection", "light", "rate", "fuel", "heat", "lift"],
    health:     ["health", "water", "boil", "rehydration", "safety", "first aid", "clean"],
    geography:  ["geography", "map", "atlas", "direction", "left", "right", "biome", "town", "settlement", "region", "mountain", "climate"],
    history:    ["history", "era", "timeline", "date", "dates", "chronology", "archaeology", "evidence"],
    logic:      ["logic", "boolean", "and", "or", "not", "condition", "conditional", "negation", "graph", "route", "shortest path", "sorting", "pattern", "patterns", "memory"],
    coding:     ["code", "coding", "program", "programming", "loop", "loops", "variable", "variables", "debug", "debugging", "sandbox", "robot", "schedule", "ai", "neural", "weights"],
    music:      ["music", "note", "notes", "rhythm", "tempo", "harmony", "chord", "chords", "melody", "beat", "beats", "song"],
    art:        ["art", "design", "geometry", "symmetry", "layout", "lettering", "contrast", "animation", "frame", "frames", "poster", "sign"],
    language:   ["spanish", "french", "german", "italian", "japanese", "portuguese", "mandarin", "arabic", "language", "translate", "phrase", "sign language", "fingerspelling"]
  };

  var PHRASE_BANK = [
    { lang: "Spanish", en: "water", tr: "agua" },
    { lang: "Spanish", en: "thank you", tr: "gracias" },
    { lang: "Spanish", en: "bread", tr: "pan" },
    { lang: "French",  en: "hello", tr: "bonjour" },
    { lang: "French",  en: "water", tr: "eau" },
    { lang: "French",  en: "thank you", tr: "merci" },
    { lang: "German",  en: "water", tr: "Wasser" },
    { lang: "German",  en: "bread", tr: "Brot" },
    { lang: "Italian", en: "good morning", tr: "buongiorno" },
    { lang: "Italian", en: "water", tr: "acqua" },
    { lang: "Japanese", en: "thank you", tr: "arigato" },
    { lang: "Portuguese", en: "thank you", tr: "obrigado" },
    { lang: "Mandarin", en: "hello", tr: "ni hao" },
    { lang: "Arabic",  en: "peace", tr: "salam" }
  ];

  var GRAMMAR_BANK = [
    { q: "Opposite of 'early'?", ans: "late", wrong: ["soon", "fast", "bright"], rule: "Early and late are antonyms." },
    { q: "Past tense of 'build'?", ans: "built", wrong: ["builded", "builds", "building"], rule: "The irregular past tense of build is built." },
    { q: "Which word is an adverb in 'She walked quickly'?", ans: "quickly", wrong: ["walked", "she", "quick"], rule: "Quickly describes how the action happened, so it is an adverb." },
    { q: "How many syllables are in 'al-ti-tude'?", ans: "3", wrong: ["2", "4", "1"], rule: "Al-ti-tude has three syllable beats." },
    { q: "Fix the comma splice: 'The tram left, we ran.'", ans: "The tram left, so we ran.", wrong: ["The tram left we ran.", "The tram, left we ran.", "The tram left, running."], rule: "Join two complete clauses with a conjunction, semicolon, or period." },
    { q: "Which word rhymes with 'lantern light'?", ans: "bright", wrong: ["lamp", "lane", "lift"], rule: "Light and bright share the same ending sound." }
  ];

  var SCIENCE_BANK = [
    { q: "At what temperature does water boil at sea level?", ans: "100 C", wrong: ["0 C", "50 C", "37 C"], rule: "Water boils at 100 C and freezes at 0 C at sea level." },
    { q: "At what altitude does snow begin on the Caldera wall?", ans: "17,000 ft", wrong: ["22,000 ft", "25,000 ft", "9,000 ft"], rule: "Caldera snow begins at 17,000 ft; wall ice begins at 22,000 ft." },
    { q: "What happens when an acid (vinegar) meets a base (baking soda)?", ans: "Carbon dioxide gas bubbles form", wrong: ["Water freezes solid", "Iron turns to gold", "Nothing reacts"], rule: "Acid plus base releases carbon dioxide gas that lifts baked goods." },
    { q: "Above 6,500 ft elevation, how long should drinking water boil?", ans: "3 minutes", wrong: ["10 seconds", "30 seconds", "30 minutes"], rule: "Lower air pressure lowers boiling temperature, so boil 3 minutes above 6,500 ft." },
    { q: "An object floats in a liquid when its density is what compared to the liquid?", ans: "Lower than the liquid", wrong: ["Higher than the liquid", "Always zero", "Double the liquid"], rule: "Lower-density objects displace enough liquid weight to float." }
  ];

  var CODING_BANK = [
    { q: "In Evelyn's sandbox, how many times does REPEAT 4 ... END run?", ans: "4 times", wrong: ["3 times", "5 times", "Forever"], rule: "REPEAT N executes its body exactly N times." },
    { q: "If LET x = 6 and LET x = x + 3, what does PRINT x show?", ans: "9", wrong: ["6", "3", "18"], rule: "The variable x updates from 6 to 6 + 3 = 9." },
    { q: "Which query finds orders with a hammer AND no ladder?", ans: "tool=hammer AND NOT tool=ladder", wrong: ["tool=hammer OR tool=ladder", "NOT tool=hammer", "tool=ladder"], rule: "AND requires both rules; NOT excludes the second item." },
    { q: "A loop counts 1, 2, 3 instead of 1, 2, 3, 4. What kind of bug is this?", ans: "Off-by-one error", wrong: ["Syntax typo", "Divide by zero", "Infinite loop"], rule: "Stopping one step early or late is an off-by-one error." }
  ];

  function ensureProfileEvo(profile) {
    if (!profile) return { focusWeights: {}, recentLessons: [], handoff: null, recent8: [], sr: {} };
    if (!profile.focusWeights) profile.focusWeights = {};
    if (!profile.recentLessons) profile.recentLessons = [];
    if (!profile.recent8) profile.recent8 = [];
    if (!profile.sr) profile.sr = {};
    return profile;
  }

  /* Extract subject tags from free text (chat prompt or lesson note) */
  function detectSubjects(text) {
    var low = String(text || "").toLowerCase();
    var found = [], k, i;
    for (k in SUBJECT_KEYWORDS) {
      var list = SUBJECT_KEYWORDS[k];
      for (i = 0; i < list.length; i++) {
        if (low.indexOf(list[i]) >= 0) {
          found.push(k);
          break;
        }
      }
    }
    return found;
  }

  /* Parse what the player says they want to focus on and update profile weights */
  function parseFocusIntent(profile, text) {
    ensureProfileEvo(profile);
    var detected = detectSubjects(text);
    if (!detected.length) return { matched: [], summary: "No specific focus subject detected." };
    var boost = /\b(focus|practice|practise|learn|study|want|help|review|more)\b/i.test(text) ? 3 : 1;
    for (var i = 0; i < detected.length; i++) {
      var s = detected[i];
      profile.focusWeights[s] = Math.min(20, (profile.focusWeights[s] || 0) + boost);
    }
    return {
      matched: detected,
      boost: boost,
      summary: "Focus updated (" + detected.join(", ") + "). Cartridges will weave these into upcoming rounds."
    };
  }

  /* Record a completed tutorial or classroom/parent lesson plan */
  function logLesson(profile, title, subjects, facts) {
    ensureProfileEvo(profile);
    var subList = (subjects && subjects.length) ? subjects.slice(0) : detectSubjects(title + " " + (facts || []).join(" "));
    if (!subList.length) subList = ["science"];
    var lesson = {
      id: "les_" + (profile.recentLessons.length + 1),
      title: String(title || "Recent Lesson").slice(0, 80),
      subjects: subList,
      facts: [],
      at: Date.now()
    };
    var factArr = facts || [];
    for (var i = 0; i < factArr.length; i++) {
      var f = factArr[i];
      if (typeof f === "string") {
        var parts = f.split("|");
        if (parts.length >= 2) {
          lesson.facts.push({ q: parts[0].trim(), ans: parts[1].trim(), rule: (parts[2] || parts[0] + " -> " + parts[1]).trim() });
        } else {
          lesson.facts.push({ q: "From lesson '" + lesson.title + "': what is the key rule?", ans: f.trim().slice(0, 64), rule: f.trim() });
        }
        if (B && B.ShelfLibrary) B.ShelfLibrary.add("lesson", lesson.title, f.trim().slice(0, 180), "From recent tutorial.");
      } else if (f && f.q && f.ans) {
        lesson.facts.push({ q: f.q, ans: f.ans, wrong: f.wrong, rule: f.rule || (f.q + " -> " + f.ans) });
        if (B && B.ShelfLibrary) B.ShelfLibrary.add("lesson", lesson.title, f.q + " " + f.ans, f.rule || "");
      }
    }
    profile.recentLessons.push(lesson);
    if (profile.recentLessons.length > 12) profile.recentLessons.shift();
    for (var s = 0; s < subList.length; s++) {
      profile.focusWeights[subList[s]] = Math.min(20, (profile.focusWeights[subList[s]] || 0) + 4);
    }
    return lesson;
  }

  /* Compute adaptive mastery tier (1..5) from rolling accuracy & XP */
  function computeTier(profile) {
    ensureProfileEvo(profile);
    var r = profile.recent8;
    var acc = 0.7;
    if (r.length >= 4) {
      var sum = 0;
      for (var i = 0; i < r.length; i++) sum += r[i];
      acc = sum / r.length;
    }
    var xpBase = Math.min(3, Math.floor((profile.xp || 0) / 120));
    var tier = 1 + xpBase + (acc >= 0.85 ? 1 : (acc <= 0.55 ? -1 : 0));
    return Math.max(1, Math.min(5, tier));
  }

  function topFocusSubjects(profile, limit) {
    ensureProfileEvo(profile);
    var pairs = [], k;
    for (k in profile.focusWeights) {
      if (profile.focusWeights[k] > 0) pairs.push([k, profile.focusWeights[k]]);
    }
    pairs.sort(function (a, b) { return b[1] - a[1]; });
    var out = [];
    for (var i = 0; i < Math.min(limit || 3, pairs.length); i++) out.push(pairs[i][0]);
    return out;
  }

  /* Procedural generator producing valid, canon-safe items for any subject & tier */
  function makeProceduralItem(subject, tier, rng, seqIdx) {
    var id = "evo_" + subject + "_" + tier + "_" + seqIdx;
    var a, b, c, ans;
    if (subject === "fractions") {
      var dens = tier <= 2 ? [2, 4, 8] : [4, 5, 8, 10];
      var d = dens[Math.floor(rng() * dens.length)];
      a = 1 + Math.floor(rng() * (d - 1));
      var pct = Math.round((a / d) * 100);
      return {
        id: id, shelf: "evo_fractions", tag: "fractions",
        q: "What percent equals " + a + "/" + d + "?",
        ans: pct + "%",
        wrong: [Math.max(5, pct - 15) + "%", Math.min(95, pct + 10) + "%", Math.round(100 / d) + "%"],
        failRule: a + " divided by " + d + " is " + (a / d).toFixed(2) + ", which is " + pct + "%."
      };
    }
    if (subject === "ratios" || subject === "money") {
      a = 2 + Math.floor(rng() * (3 + tier));
      b = 2 + Math.floor(rng() * (3 + tier));
      c = 2 + Math.floor(rng() * 3);
      ans = a * c;
      return {
        id: id, shelf: "evo_ratios", tag: subject,
        q: "A batch uses " + a + " cups for " + b + " servings. How many cups for " + (b * c) + " servings?",
        ans: String(ans),
        wrong: [String(ans + a), String(Math.max(1, ans - b)), String(a + c)],
        failRule: "Multiply both parts by " + c + ": " + a + " times " + c + " equals " + ans + "."
      };
    }
    if (subject === "factors") {
      var bases = [12, 18, 24, 30, 36, 48, 60];
      var n = bases[Math.floor(rng() * bases.length)];
      var f = [2, 3, 4, 6][Math.floor(rng() * 4)];
      return {
        id: id, shelf: "evo_factors", tag: "factors",
        q: "A tray holds " + n + " pastries in " + f + " equal rows. How many columns?",
        ans: String(n / f),
        wrong: [String(n / f + 2), String(Math.max(1, n / f - 1)), String(f)],
        failRule: f + " rows times " + (n / f) + " columns equals " + n + " pastries."
      };
    }
    if (subject === "time") {
      var startH = 8 + Math.floor(rng() * 4); // 8..11 AM
      var startM = Math.floor(rng() * 6) * 5;
      var leg = [2, 4, 5, 6, 14][Math.floor(rng() * 5)];
      var tot = startH * 60 + startM + leg;
      var endH = Math.floor(tot / 60), endM = tot % 60;
      var ap1 = startH >= 12 ? "PM" : "AM";
      var ap2 = endH >= 12 ? "PM" : "AM";
      var s12 = (startH > 12 ? startH - 12 : startH) + ":" + (startM < 10 ? "0" : "") + startM + " " + ap1;
      var e12 = (endH > 12 ? endH - 12 : endH) + ":" + (endM < 10 ? "0" : "") + endM + " " + ap2;
      var w1 = (endH > 12 ? endH - 12 : endH) + ":" + (((endM + 10) % 60) < 10 ? "0" : "") + ((endM + 10) % 60) + " " + ap2;
      var w2 = (endH > 12 ? endH - 12 : endH) + ":" + (((endM + 5) % 60) < 10 ? "0" : "") + ((endM + 5) % 60) + " " + ap2;
      return {
        id: id, shelf: "corale#16", tag: "time",
        q: "Leave at " + s12 + " on a " + leg + "-minute Coccyx Corale leg. Arrival clock?",
        ans: e12, wrong: [w1, w2, s12],
        failRule: "Add " + leg + " minutes to " + s12 + " to reach " + e12 + "."
      };
    }
    if (subject === "language") {
      var ph = PHRASE_BANK[Math.floor(rng() * PHRASE_BANK.length)];
      var wrongs = [];
      for (var i = 0; i < PHRASE_BANK.length && wrongs.length < 3; i++) {
        var cand = PHRASE_BANK[(i + seqIdx) % PHRASE_BANK.length].tr;
        if (cand !== ph.tr && wrongs.indexOf(cand) < 0) wrongs.push(cand);
      }
      return {
        id: id, shelf: "evo_language", tag: "language",
        q: "In " + ph.lang + ", how do you say '" + ph.en + "'?",
        ans: ph.tr, wrong: wrongs,
        failRule: "'" + ph.en + "' in " + ph.lang + " is '" + ph.tr + "'."
      };
    }
    if (subject === "grammar" || subject === "phonics" || subject === "writing") {
      var g = GRAMMAR_BANK[Math.floor(rng() * GRAMMAR_BANK.length)];
      return { id: id, shelf: "evo_grammar", tag: subject, q: g.q, ans: g.ans, wrong: g.wrong.slice(0), failRule: g.rule };
    }
    if (subject === "science" || subject === "health" || subject === "geography" || subject === "physics") {
      var sc = SCIENCE_BANK[Math.floor(rng() * SCIENCE_BANK.length)];
      return { id: id, shelf: "evo_science", tag: subject, q: sc.q, ans: sc.ans, wrong: sc.wrong.slice(0), failRule: sc.rule };
    }
    if (subject === "coding" || subject === "logic") {
      var cd = CODING_BANK[Math.floor(rng() * CODING_BANK.length)];
      return { id: id, shelf: "evo_coding", tag: subject, q: cd.q, ans: cd.ans, wrong: cd.wrong.slice(0), failRule: cd.rule };
    }
    /* Default: tier-scaled arithmetic */
    var maxN = 5 + tier * 3;
    a = 2 + Math.floor(rng() * maxN);
    b = 2 + Math.floor(rng() * (4 + tier * 2));
    var useMul = (tier >= 2 && rng() < 0.65);
    ans = useMul ? (a * b) : (a + b);
    return {
      id: id, shelf: "evo_arithmetic", tag: "arithmetic",
      q: useMul ? (a + " x " + b) : (a + " + " + b),
      ans: String(ans),
      wrong: [String(ans + 2), String(Math.max(0, ans - 1)), String(ans + a)],
      failRule: useMul ? (a + " times " + b + " is " + ans + ".") : (a + " plus " + b + " is " + ans + ".")
    };
  }

  /* Build items directly from the learner's most recent lessons/tutorials */
  function itemsFromRecentLessons(profile, rng) {
    ensureProfileEvo(profile);
    var out = [], i, j;
    for (i = profile.recentLessons.length - 1; i >= 0 && out.length < 6; i--) {
      var les = profile.recentLessons[i];
      for (j = 0; j < les.facts.length && out.length < 6; j++) {
        var f = les.facts[j];
        out.push({
          id: "lesitem_" + les.id + "_" + j,
          shelf: "lesson:" + les.title,
          tag: "recent_lesson",
          q: "[Recent Lesson: " + les.title + "] " + f.q,
          ans: f.ans,
          wrong: (f.wrong && f.wrong.length) ? f.wrong.slice(0) : ["Skip this step", "Ask the shelf again", "Double the value"],
          failRule: f.rule
        });
      }
    }
    return out;
  }

  /* Evolve any cartridge into a fresh, personalized 24-item deck */
  function evolveCartridge(cart, profile, seed, targetCount) {
    ensureProfileEvo(profile);
    var rng = B.createRng(seed || 2026);
    var tier = computeTier(profile);
    var want = targetCount || 24;
    var focusList = topFocusSubjects(profile, 3);
    var copy = JSON.parse(JSON.stringify(cart));
    var baseItems = (copy.items || []).slice(0);
    var deck = [];
    var seenQ = Object.create(null);

    function pushUnique(it) {
      if (!it || !it.q || seenQ[it.q]) return;
      seenQ[it.q] = 1;
      deck.push(it);
    }

    /* 1. Overdue SM-2 items from this cartridge come first */
    var due = B.Scheduler ? B.Scheduler.dueIds(profile) : [];
    var i;
    for (i = 0; i < baseItems.length; i++) {
      if (due.indexOf(baseItems[i].id) >= 0) pushUnique(baseItems[i]);
    }
    /* 2. Inject recent-lesson items so the game immediately reinforces tutorials */
    var lesItems = itemsFromRecentLessons(profile, rng);
    for (i = 0; i < lesItems.length && deck.length < want; i++) pushUnique(lesItems[i]);

    /* 3. Include remaining canon core items of the cartridge */
    for (i = 0; i < baseItems.length && deck.length < want; i++) pushUnique(baseItems[i]);

    /* 4. Fill to `want` (24+) alternating cartridge subjects and learner focus subjects */
    var cartSubs = (copy.subjects && copy.subjects.length) ? copy.subjects : [copy.subject || "arithmetic"];
    var pool = [];
    for (i = 0; i < cartSubs.length; i++) {
      var mapped = detectSubjects(cartSubs[i]);
      pool.push(mapped.length ? mapped[0] : "arithmetic");
    }
    for (i = 0; i < focusList.length; i++) pool.push(focusList[i]);
    if (!pool.length) pool.push("arithmetic");

    var guard = 0;
    while (deck.length < want && guard < want * 4) {
      var subj = pool[guard % pool.length];
      pushUnique(makeProceduralItem(subj, tier, rng, guard));
      guard++;
    }

    /* 5. The fixed banks (science, coding, grammar) hold only a handful of questions, so a cartridge whose subjects
       map to them can stall below `want`. Top the deck up with the generators that never run out (arithmetic,
       factors, time, ratios, fractions), tier-scaled, so every cartridge always evolves to a full deck. */
    var topUp = ["arithmetic", "factors", "time", "ratios", "fractions"];
    var topGuard = 0;
    while (deck.length < want && topGuard < want * 40) {
      pushUnique(makeProceduralItem(topUp[topGuard % topUp.length], tier, rng, guard + topGuard));
      topGuard++;
    }

    copy.items = deck;
    copy.evolutionMeta = {
      tier: tier,
      focusSubjects: focusList,
      recentLessonCount: profile.recentLessons.length,
      injectedLessons: lesItems.length,
      totalItems: deck.length,
      handoffUsed: profile.handoff ? profile.handoff.fromCart : null
    };
    return copy;
  }

  /* Recommend top Concourse cartridges matching recent lessons + focus mentions */
  function recommendCartridges(catalog, profile, topN) {
    ensureProfileEvo(profile);
    var focus = topFocusSubjects(profile, 5);
    var scored = [], i, j;
    for (i = 0; i < catalog.length; i++) {
      var c = catalog[i], sc = 0;
      var hay = (c.title + " " + (c.subjects || []).join(" ") + " " + c.subject).toLowerCase();
      for (j = 0; j < focus.length; j++) {
        if (detectSubjects(hay).indexOf(focus[j]) >= 0) sc += (profile.focusWeights[focus[j]] || 1);
      }
      scored.push({ cart: c, score: sc });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var out = [];
    for (i = 0; i < Math.min(topN || 5, scored.length); i++) out.push(scored[i].cart);
    return out;
  }

  /* Cross-cartridge KV21 state hand-off */
  function writeHandoff(profile, fromCart, streak, unlockedTopic) {
    ensureProfileEvo(profile);
    profile.handoff = {
      fromCart: fromCart.id,
      fromTitle: fromCart.title,
      streak: streak || 0,
      topic: unlockedTopic || fromCart.subject,
      prefix: ("HO:" + (fromCart.subject || "gen").slice(0, 6) + "|S=" + (streak || 0) + "|").slice(0, 24),
      at: Date.now()
    };
    if (B && B.EchoWorker && B.EchoWorker.loaded) {
      B.EchoWorker.pinPrefix(profile.handoff.prefix);
    }
    return profile.handoff;
  }

  /* Build parent/teacher read-out with focus insights & away-from-screen activity */
  function buildParentReadout(profile, cart) {
    ensureProfileEvo(profile);
    var tier = computeTier(profile);
    var focus = topFocusSubjects(profile, 4);
    var due = B.Scheduler ? B.Scheduler.dueIds(profile) : [];
    var recNames = [];
    for (var i = 0; i < profile.recentLessons.length; i++) recNames.push(profile.recentLessons[i].title);
    return [
      "=== EVELYN PARENT & TEACHER READ-OUT ===",
      "Learner        : " + (profile.name || "Learner") + " | Mode: " + (profile.mode || "M") + " | Adaptive Tier: " + tier + "/5",
      "Total XP       : " + (profile.xp || 0),
      "Focus Subjects : " + (focus.length ? focus.join(", ") : "Balanced across shelves"),
      "Recent Lessons : " + (recNames.length ? recNames.join("; ") : "None logged yet"),
      "SM-2 Due Soon  : " + (due.length ? due.slice(0, 6).join(", ") : "All caught up"),
      "Away-From-Screen Activity: " + ((cart && cart.parentActivity) ? cart.parentActivity : "Pick one fact from today's shelf and test it together at the kitchen table.")
    ].join("\n");
  }

  root.EvelynEvolution = {
    SUBJECT_KEYWORDS: SUBJECT_KEYWORDS,
    detectSubjects: detectSubjects,
    parseFocusIntent: parseFocusIntent,
    logLesson: logLesson,
    computeTier: computeTier,
    topFocusSubjects: topFocusSubjects,
    makeProceduralItem: makeProceduralItem,
    evolveCartridge: evolveCartridge,
    recommendCartridges: recommendCartridges,
    writeHandoff: writeHandoff,
    buildParentReadout: buildParentReadout
  };
})(typeof window !== "undefined" ? window : global);
