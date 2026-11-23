/* evelyn_chums.js - the DritchChum pet raising system of Evelyn (from Scar Brand), also called Echoes.
   "Echo" and "DritchChum" are interchangeable words for the same creature system. Echoes are generally the nice
   creatures, DritchChums generally the nastier ones, and every pair can be friends in the right circumstances.
   Pets are the owner's CREATURE records only (tools/gen_chums.js): never a humanoid, never a woman or girl.
   Rules from the Scar Brand plan: stats (Stand, Reach, Glide, Keep, Hum) show as thread weight and colour, never as
   numbers; nothing is hurt on screen; a creature that runs out of care is released, kindly; breeding makes kin of the
   same creature only (a change of kind waits for an owner-approved table).
   Pure ES5, no dependencies besides evelyn_chums_data.js. Browser and Node. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynChumsData) require("./evelyn_chums_data.js");
  var DATA = root.EvelynChumsData || { species: [], hash: "none" };

  var STATS = ["Stand", "Reach", "Glide", "Keep", "Hum"];
  var ACTIONS = ["feed", "play", "rest", "mend", "story", "hum"];
  var STAGES = ["kit", "young", "grown"];
  var LOFT_SIZE = 6;
  var RELEASE_DAYS = 3;   /* days with no care and no trust before a creature goes home */
  var CATCH_UP_DAYS = 2;  /* most days of change applied in one visit */
  var STAGE_DAYS = { young: 3, grown: 8 };
  var WEIGHTS = ["wisp", "fine", "medium", "heavy", "braided"];
  var STAT_COLOURS = { Stand: "indigo", Reach: "saffron", Glide: "teal", Keep: "madder red", Hum: "violet" };
  var ELEMENT_COLOURS = {
    fire: "ember red", water: "tide blue", earth: "clay brown", plant: "moss green", light: "lamp gold",
    darkness: "ink blue", holy: "pearl white", demon: "cinder purple", eldritch: "deep teal", psychic: "orchid",
    spirit: "mist grey", slime: "lime", metal: "pewter", candy: "rose pink"
  };
  var WOMAN_WORDS = /\b(woman|women|girl|girls|lady|ladies|female|queen|princess|witch|maid|mermaid|nurse|humanoid|she|her)\b/i;
  var HARM_WORDS = /\b(hurt|hurts|wound|wounds|bleed|bleeds|kill|kills|dies|dead|injure|injures|bite|bites|punch|punches)\b/i;

  /* ---------------------------------------------------------------- small helpers */
  function rngFrom(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------------------------------------------------------------- the two words, one system */
  var TERM_RE = /\b(dritch[\s\-]?chums?|echoes|echos|echo)\b/gi;
  function labelForRole(role) { return role === "naughty" ? "DritchChum" : "Echo"; }
  function isTerm(word) { TERM_RE.lastIndex = 0; var m = TERM_RE.exec(String(word || "")); TERM_RE.lastIndex = 0; return !!m; }
  /* Rewrite every Echo / DritchChum word in a text to the label that fits one creature or role. */
  function speakAs(text, roleOrSpecies) {
    var role = (roleOrSpecies && roleOrSpecies.r) ? roleOrSpecies.r : roleOrSpecies;
    var label = labelForRole(role);
    return String(text || "").replace(TERM_RE, function (w) {
      var plural = /s$/i.test(w) && !/^dritch/i.test(w) ? true : /chums$/i.test(w);
      if (label === "Echo") return plural ? "Echoes" : "Echo";
      return plural ? "DritchChums" : "DritchChum";
    });
  }

  /* ---------------------------------------------------------------- species */
  var BY_ID = {};
  var SPECIES = [];
  (function () {
    for (var i = 0; i < DATA.species.length; i++) {
      var s = DATA.species[i];
      if (isPetSafe(s)) { SPECIES.push(s); BY_ID[s.id] = s; }
    }
  })();
  function isPetSafe(s) {
    if (!s || !s.id || !s.n) return false;
    var text = [s.n, s.fam, s.quirk, s.voice, s.eatHow, s.temp].join(" ");
    return !WOMAN_WORDS.test(text);
  }
  function getSpecies(id) { return BY_ID[id] || null; }
  function listSpecies(role) {
    var out = [];
    for (var i = 0; i < SPECIES.length; i++) if (!role || SPECIES[i].r === role) out.push(SPECIES[i]);
    return out;
  }

  /* ---------------------------------------------------------------- state */
  function ensureState(profile) {
    if (!profile) throw new Error("A learner profile is required.");
    var c = profile.chums;
    if (!c || typeof c !== "object") c = profile.chums = {};
    if (!c.roster) c.roster = [];
    if (!c.log) c.log = [];
    if (!c.cups) c.cups = { race: 0, duel: 0 };
    if (!c.seen) c.seen = {};
    if (typeof c.day !== "number") c.day = 0;
    if (typeof c.nextId !== "number") c.nextId = 1;
    if (typeof c.lastTick !== "number") c.lastTick = 0;
    return c;
  }
  function findChum(profile, id) {
    var r = ensureState(profile).roster;
    for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i];
    return null;
  }
  function note(c, text) { c.log.push(text); if (c.log.length > 40) c.log.shift(); }

  function makeBrain(rng) {
    var w = [], i;
    for (i = 0; i < 30; i++) w.push(Math.round((rng() * 2 - 1) * 100) / 100);
    return w;
  }
  function paletteFor(sp, rng) {
    var a = ELEMENT_COLOURS[sp.el[0]] || "mist grey";
    var b = ELEMENT_COLOURS[sp.el[1] || sp.el[0]] || a;
    var accents = ["thread white", "marigold", "slate", "plum", "sea glass"];
    return [a, b, pick(rng, accents)];
  }

  /* Adopt a creature as a kit. Only pet-safe CREATURE species can be adopted. */
  function adopt(profile, speciesId, name, seed) {
    var c = ensureState(profile);
    var sp = getSpecies(speciesId);
    if (!sp) return { ok: false, reason: "That is not a creature in the loft list. Only creatures can be raised." };
    if (c.roster.length >= LOFT_SIZE) return { ok: false, reason: "The loft holds " + LOFT_SIZE + ". Pick one to say goodbye to first." };
    var rng = rngFrom((seed || 1) + strHash(speciesId));
    var nice = sp.r === "nice";
    var stats = { Stand: 10, Reach: 10, Glide: 10, Keep: 10, Hum: 10 };
    var chum = {
      id: "c" + (c.nextId++), sp: sp.id, name: String(name || sp.n.split(" ")[0]).slice(0, 24),
      stage: "kit", age: 0, born: c.day, seed: Math.floor(rng() * 1e9),
      stats: stats, affinity: pick(rng, STATS),
      needs: { hunger: 30, energy: 80, joy: 50, trust: nice ? 40 : 20 },
      palette: paletteFor(sp, rng), brain: makeBrain(rng), bonds: {}, careCount: 0, emptyDays: 0, parents: null
    };
    c.roster.push(chum);
    c.seen[sp.id] = 1;
    note(c, chum.name + " joined the loft as " + article(labelForRole(sp.r)) + " " + labelForRole(sp.r) + ".");
    return { ok: true, chum: chum, label: labelForRole(sp.r), line: chumLine(chum, "arrive") };
  }
  function article(w) { return /^[aeiou]/i.test(w) ? "an" : "a"; }

  /* ---------------------------------------------------------------- care */
  var ACTION_RULES = {
    feed:  { stat: "Stand", hunger: -35, energy: 4,   joy: 5,   trust: 3 },
    play:  { stat: "Glide", hunger: 8,   energy: -15, joy: 20,  trust: 4 },
    rest:  { stat: "Keep",  hunger: 5,   energy: 40,  joy: 2,   trust: 2 },
    mend:  { stat: "Reach", hunger: 0,   energy: -3,  joy: 4,   trust: 8 },
    story: { stat: "Hum",   hunger: 2,   energy: -2,  joy: 10,  trust: 10 },
    hum:   { stat: "Hum",   hunger: 2,   energy: -2,  joy: 8,   trust: 6 }
  };
  var LINES = {
    arrive: "{n} blinks at the loft and settles beside the thread basket.",
    feed:   "{n} finishes the bowl and looks {a} about it.",
    play:   "{n} plays a {a} game and lets you win twice.",
    rest:   "{n} curls up in the warm corner and sleeps.",
    mend:   "{n} holds still while the loose thread is stitched back.",
    story:  "{n} listens to the whole story and asks for the ending again.",
    hum:    "{n} hums back one note, then a second one.",
    mischief: "{n} swipes a biscuit, shares half, and hides the crumbs.",
    full:   "{n} is full and happy to wait for the next meal.",
    release: "{n} goes home to {h}. The loft door stays open for {n}."
  };
  function adjective(sp) { var t = String(sp.temp || "calm").split(/[,\s]+/)[0]; return t || "calm"; }
  function chumLine(chum, key, extra) {
    var sp = getSpecies(chum.sp);
    var line = (LINES[key] || LINES.arrive).replace(/\{n\}/g, chum.name).replace(/\{a\}/g, adjective(sp)).replace(/\{h\}/g, (sp.home || "the wild"));
    if (extra) line += " " + extra;
    return line.length > 128 ? line.slice(0, 127).replace(/\s+\S*$/, "") + "." : line;
  }
  function stageFor(age) { return age >= STAGE_DAYS.grown ? "grown" : age >= STAGE_DAYS.young ? "young" : "kit"; }

  /* One care action. opts.correct = true after a right quiz answer (a bigger gain); a wrong answer never costs anything. */
  function care(profile, chumId, action, opts) {
    opts = opts || {};
    var c = ensureState(profile);
    var chum = findChum(profile, chumId);
    if (!chum) return { ok: false, reason: "No such creature in the loft." };
    var rule = ACTION_RULES[action];
    if (!rule) return { ok: false, reason: "Care actions are: " + ACTIONS.join(", ") + "." };
    var sp = getSpecies(chum.sp);
    var nice = sp.r === "nice";
    var n = chum.needs;
    var rng = rngFrom(chum.seed + chum.careCount * 977 + strHash(action));
    var gain = 2 + (opts.correct ? 3 : 0) + (chum.affinity === rule.stat ? 1 : 0);
    if (!nice) gain = Math.round(gain * 1.3);                         /* DritchChums grow their stats faster ... */
    var trustGain = nice ? Math.round(rule.trust * 1.3) : rule.trust; /* ... Echoes trust sooner. */
    if (opts.correct) trustGain += 2;
    chum.stats[rule.stat] = clamp(chum.stats[rule.stat] + gain, 0, 100);
    n.hunger = clamp(n.hunger + rule.hunger, 0, 100);
    n.energy = clamp(n.energy + rule.energy, 0, 100);
    n.joy = clamp(n.joy + rule.joy, 0, 100);
    n.trust = clamp(n.trust + trustGain, 0, 100);
    chum.careCount++;
    var event = null, key = action;
    if (action === "feed" && n.hunger <= 5) key = "full";
    /* DritchChums play pranks. Harmless ones, and the prank always ends in sharing. */
    if (!nice && rng() < 0.25) { event = "mischief"; key = "mischief"; n.joy = clamp(n.joy + 6, 0, 100); }
    chum.emptyDays = 0;
    return { ok: true, event: event, line: chumLine(chum, key), view: threadView(chum) };
  }

  /* Time passes one loft day: hunger grows, energy dips, age grows, stages change. A creature with no care for three
     whole days is released to its home, kindly. Never harmed. */
  function tickDay(profile) {
    var c = ensureState(profile);
    c.day++;
    var released = [];
    for (var i = c.roster.length - 1; i >= 0; i--) {
      var ch = c.roster[i], n = ch.needs, sp = getSpecies(ch.sp);
      ch.age++;
      ch.stage = stageFor(ch.age);
      n.hunger = clamp(n.hunger + 25, 0, 100);
      n.energy = clamp(n.energy - 10, 0, 100);
      n.joy = clamp(n.joy - 8, 0, 100);
      if (n.hunger >= 100 && n.trust <= 5) ch.emptyDays++; else ch.emptyDays = 0;
      if (ch.emptyDays >= RELEASE_DAYS) {
        var line = chumLine(ch, "release");
        note(c, line);
        released.push({ id: ch.id, name: ch.name, line: line });
        c.roster.splice(i, 1);
        for (var j = 0; j < c.roster.length; j++) delete c.roster[j].bonds[ch.id];
      }
    }
    return { day: c.day, released: released };
  }
  /* Real-clock ticks, with at most two days of catching up per visit so a child who was away is welcomed, not punished. */
  function tickByClock(profile, nowMs) {
    var c = ensureState(profile);
    if (!c.lastTick) { c.lastTick = nowMs; return { day: c.day, released: [] }; }
    var days = Math.min(CATCH_UP_DAYS, Math.floor((nowMs - c.lastTick) / 86400000));
    var res = { day: c.day, released: [] };
    for (var d = 0; d < days; d++) { var r = tickDay(profile); res.day = r.day; res.released = res.released.concat(r.released); }
    if (days > 0) c.lastTick = nowMs;
    return res;
  }

  /* ---------------------------------------------------------------- how a creature shows: thread weight and colour */
  function threadView(chum) {
    var out = {}, i;
    for (i = 0; i < STATS.length; i++) {
      var s = STATS[i], v = chum.stats[s];
      out[s] = { weight: WEIGHTS[clamp(Math.floor(v / 20), 0, 4)], colour: STAT_COLOURS[s] };
    }
    return out;
  }
  function needWord(kind, v) {
    if (kind === "hunger") return v >= 75 ? "very hungry" : v >= 45 ? "peckish" : "full";
    if (kind === "energy") return v <= 20 ? "worn out" : v <= 50 ? "sleepy" : "lively";
    if (kind === "joy") return v >= 70 ? "delighted" : v >= 35 ? "content" : "glum";
    return v >= 70 ? "devoted" : v >= 35 ? "friendly" : "wary";
  }
  function describe(chum) {
    var sp = getSpecies(chum.sp);
    var n = chum.needs;
    return chum.name + " is " + article(labelForRole(sp.r)) + " " + labelForRole(sp.r) + " (" + sp.n + "), " + chum.stage + ", " +
      needWord("hunger", n.hunger) + ", " + needWord("energy", n.energy) + ", " + needWord("joy", n.joy) + " and " + needWord("trust", n.trust) +
      ". Colours: " + chum.palette.join(", ") + ".";
  }

  /* ---------------------------------------------------------------- friendship: right circumstances make friends */
  var CIRCUMSTANCES = [
    { id: "shared_meal",    kind: "friendly", bond: 9,  text: "{a} and {b} share one bowl and finish it together." },
    { id: "story_night",    kind: "friendly", bond: 9,  text: "{a} and {b} listen to the same story and laugh at the same line." },
    { id: "storm_shelter",  kind: "friendly", bond: 11, text: "A storm hits the loft. {a} and {b} huddle under one blanket." },
    { id: "mending_circle", kind: "friendly", bond: 10, text: "{a} holds the thread while {b} gets mended." },
    { id: "hum_chorus",     kind: "friendly", bond: 10, text: "{a} and {b} find the same note and hold it." },
    { id: "lost_kit",       kind: "friendly", bond: 13, text: "{a} and {b} find a lost kit and walk it home together." },
    { id: "race_day",       kind: "rival",    bond: 3,  text: "{a} and {b} race and tease each other the whole way." },
    { id: "duel_cup",       kind: "rival",    bond: 3,  text: "{a} and {b} duel for the cup, then trade ribbons." }
  ];
  function circumstance(id) { for (var i = 0; i < CIRCUMSTANCES.length; i++) if (CIRCUMSTANCES[i].id === id) return CIRCUMSTANCES[i]; return null; }
  function friendlyCircumstances() { return CIRCUMSTANCES.filter(function (c) { return c.kind === "friendly"; }); }
  function bondLabel(v) { return v >= 60 ? "best friends" : v >= 30 ? "friends" : v > 0 ? "wary of each other" : "strangers"; }

  /* Two creatures meet in a circumstance. A first meeting between an Echo and a DritchChum starts wary (a smaller
     bond); every friendly circumstance grows it, so any pair becomes friends with enough friendly meetings. */
  function befriend(profile, aId, bId, circId) {
    var a = findChum(profile, aId), b = findChum(profile, bId);
    if (!a || !b || a === b) return { ok: false, reason: "Two different creatures of the loft are needed." };
    var circ = circumstance(circId);
    if (!circ) return { ok: false, reason: "Unknown circumstance." };
    var spA = getSpecies(a.sp), spB = getSpecies(b.sp);
    var mixed = spA.r !== spB.r;
    var current = a.bonds[b.id] || 0;
    var gain = circ.bond;
    if (mixed && current < 15) gain = Math.max(2, Math.round(gain * 0.6));
    var absorbs = (spA.abs || []).concat(spB.abs || []);
    if (absorbs.length && (spA.el.indexOf(spB.el[0]) >= 0 || spB.el.indexOf(spA.el[0]) >= 0)) gain += 2;
    var v = clamp(current + gain, 0, 100);
    a.bonds[b.id] = v; b.bonds[a.id] = v;
    var text = circ.text.replace(/\{a\}/g, a.name).replace(/\{b\}/g, b.name);
    return { ok: true, bond: v, label: bondLabel(v), mixed: mixed, rivalry: circ.kind === "rival", line: text };
  }

  /* ---------------------------------------------------------------- breeding: kin of the same creature only */
  function breed(profile, aId, bId, seed) {
    var c = ensureState(profile);
    var a = findChum(profile, aId), b = findChum(profile, bId);
    if (!a || !b || a === b) return { ok: false, reason: "Two different creatures of the loft are needed." };
    if (a.sp !== b.sp) return { ok: false, reason: "Kin stays the same creature. A change of kind waits for an owner-approved table." };
    if (a.stage !== "grown" || b.stage !== "grown") return { ok: false, reason: "Both must be grown." };
    if (a.needs.trust < 40 || b.needs.trust < 40) return { ok: false, reason: "Both must trust you first." };
    if (c.roster.length >= LOFT_SIZE) return { ok: false, reason: "The loft is full." };
    var sp = getSpecies(a.sp);
    var rng = rngFrom((seed || 7) + a.seed + b.seed);
    var kit = adopt(profile, sp.id, sp.n.split(" ")[0] + " Kin", rng() * 1e6).chum;
    kit.parents = [a.id, b.id];
    kit.palette = [pick(rng, [a.palette[0], b.palette[0]]), pick(rng, [a.palette[1], b.palette[1]]), pick(rng, [a.palette[2], b.palette[2]])];
    kit.affinity = pick(rng, [a.affinity, b.affinity]);
    for (var i = 0; i < kit.brain.length; i++) {
      var w = rng() < 0.5 ? a.brain[i] : b.brain[i];
      if (rng() < 0.08) w = clamp(w + (rng() - 0.5) * 0.4, -1, 1);
      kit.brain[i] = Math.round(w * 100) / 100;
    }
    return { ok: true, chum: kit, line: kit.name + " is a kit of " + a.name + " and " + b.name + ". Same creature, new colours." };
  }

  /* ---------------------------------------------------------------- races and duels: friendly, nobody is hurt */
  function score(chum, weights, rng) {
    var s = 0, i;
    for (i = 0; i < STATS.length; i++) s += chum.stats[STATS[i]] * (weights[STATS[i]] || 0);
    s -= chum.needs.hunger * 0.1;
    s += chum.brain[0] * 4;
    return s + rng() * 12;
  }
  function race(profile, ids, seed) {
    var c = ensureState(profile), rng = rngFrom(seed || 3), rows = [], i;
    for (i = 0; i < ids.length; i++) {
      var ch = findChum(profile, ids[i]);
      if (ch) rows.push({ id: ch.id, name: ch.name, score: score(ch, { Glide: 1, Reach: 0.6, Keep: 0.4 }, rng) });
    }
    if (rows.length < 2) return { ok: false, reason: "A race needs at least two creatures.", ranking: [], rows: [], winnerId: null };
    rows.sort(function (a, b) { return b.score - a.score; });
    c.cups.race++; note(c, rows[0].name + " won the race cup round.");
    /* Racers neighbouring each other on the track tease each other: a friendly rivalry bond. */
    for (i = 0; i + 1 < rows.length; i++) befriend(profile, rows[i].id, rows[i + 1].id, "race_day");
    return { ok: true, ranking: rows.map(function (r) { return r.name; }), rows: rows.map(function (r) { return { id: r.id, name: r.name }; }),
      winnerId: rows[0].id, line: rows[0].name + " crosses first. " + rows[rows.length - 1].name + " gets the biggest cheer." };
  }
  function duel(profile, aId, bId, seed) {
    var c = ensureState(profile), rng = rngFrom(seed || 5);
    var a = findChum(profile, aId), b = findChum(profile, bId);
    if (!a || !b || a === b) return { ok: false, reason: "Two different creatures are needed." };
    var w = { Stand: 1, Keep: 0.8, Hum: 0.8 };
    var sa = score(a, w, rng), sb = score(b, w, rng);
    var spA = getSpecies(a.sp), spB = getSpecies(b.sp);
    if (spB.weak.indexOf(spA.el[0]) >= 0) sa += 10;
    if (spA.weak.indexOf(spB.el[0]) >= 0) sb += 10;
    var win = sa >= sb ? a : b, lose = win === a ? b : a;
    c.cups.duel++;
    befriend(profile, a.id, b.id, "duel_cup");
    return { ok: true, winnerId: win.id, loserId: lose.id, line: win.name + " holds the last note longest. " + lose.name + " gets the first ribbon anyway." };
  }

  /* ---------------------------------------------------------------- learning: care questions drawn from the species data */
  var ALL_ELEMENTS = ["fire", "water", "earth", "plant", "light", "darkness", "holy", "demon", "eldritch", "psychic", "spirit", "slime", "metal", "candy"];
  function otherThan(rng, list, avoid, n) {
    var out = [], pool = list.filter(function (x) { return avoid.indexOf(x) < 0; }), guard = 0;
    while (out.length < n && guard++ < 200 && pool.length) { var v = pick(rng, pool); if (out.indexOf(v) < 0) out.push(v); }
    return out;
  }
  function quizFor(chum, seed) {
    var sp = getSpecies(chum.sp), rng = rngFrom((seed || 11) + chum.seed);
    var items = [], id = "chum_" + sp.id.replace(/[^A-Za-z0-9]/g, "_");
    if (sp.weak.length) {
      items.push({ id: id + "_weak", shelf: "chums#" + sp.id, q: "Which element does " + sp.n + " take double damage from?",
        ans: sp.weak[0], wrong: otherThan(rng, ALL_ELEMENTS, sp.weak, 3),
        failRule: sp.n + " is weak to " + sp.weak.join(", ") + ". Use those elements to calm it, never to hurt it." });
    }
    if (sp.res.length) {
      items.push({ id: id + "_res", shelf: "chums#" + sp.id, q: "Which element does " + sp.n + " resist?",
        ans: sp.res[0], wrong: otherThan(rng, ALL_ELEMENTS, sp.res, 3),
        failRule: sp.n + " resists " + sp.res.join(", ") + "." });
    }
    if (sp.home) {
      var homes = [];
      for (var i = 0; i < SPECIES.length && homes.length < 3; i++) {
        var h = SPECIES[(i * 7 + chum.seed) % SPECIES.length].home;
        if (h && h !== sp.home && homes.indexOf(h) < 0) homes.push(h);
      }
      if (homes.length === 3) items.push({ id: id + "_home", shelf: "chums#" + sp.id, q: "Where does " + sp.n + " live?",
        ans: sp.home, wrong: homes, failRule: sp.n + " lives in " + sp.home + "." });
    }
    var modes = ["mouth", "dissolve", "psychic"];
    if (modes.indexOf(sp.eat) >= 0) {
      items.push({ id: id + "_eat", shelf: "chums#" + sp.id, q: "How does " + sp.n + " eat? (mouth, dissolve or psychic)",
        ans: sp.eat, wrong: modes.filter(function (m) { return m !== sp.eat; }).concat(["it does not eat"]),
        failRule: sp.n + " eats by way of '" + sp.eat + "'." });
    }
    return items;
  }
  /* A cartridge-shaped deck of care questions for the learner's loft, plain enough for the validator and the guard. */
  function careDeck(profile, seed) {
    var c = ensureState(profile), items = [];
    for (var i = 0; i < c.roster.length; i++) items = items.concat(quizFor(c.roster[i], (seed || 11) + i));
    return {
      id: "chum_loft", title: "Chum Loft Care", engine: "quiz", series: "SB", grade: "3-5", subject: "science", subjects: ["science", "creatures"],
      goal: "Look after the creatures of the loft and learn what they eat, resist and need.",
      echoLine: "Every creature in the loft has a rule to learn. Right answers earn thicker thread.",
      items: items
    };
  }

  /* ---------------------------------------------------------------- words: "feed my echo Pip", "play with dritch chum Gnash" */
  function parseCommand(profile, text) {
    var t = String(text || "").toLowerCase();
    var act = null, i;
    for (i = 0; i < ACTIONS.length; i++) if (new RegExp("\\b" + ACTIONS[i] + "\\b").test(t)) { act = ACTIONS[i]; break; }
    if (!act && /\bplay(ing)?\b/.test(t)) act = "play";
    if (!act && /\b(sing|sings|singing)\b/.test(t)) act = "hum";
    var r = ensureState(profile).roster, who = null;
    for (i = 0; i < r.length; i++) if (t.indexOf(r[i].name.toLowerCase()) >= 0) { who = r[i]; break; }
    if (!who && r.length === 1 && TERM_RE.test(t)) who = r[0];
    TERM_RE.lastIndex = 0;
    return { action: act, chumId: who ? who.id : null };
  }

  /* ---------------------------------------------------------------- compact brain codec (36 bytes) for sharing */
  function brainBytes(chum) {
    var w = chum.brain, n = w.length, big = 0, i;
    for (i = 0; i < n; i++) if (Math.abs(w[i]) > big) big = Math.abs(w[i]);
    var scale = big > 1e-8 ? big / 127 : 1, out = new Uint8Array(6 + n), dv = new DataView(out.buffer);
    dv.setUint16(0, n, true); dv.setFloat32(2, scale, true);
    for (i = 0; i < n; i++) dv.setInt8(6 + i, clamp(Math.round(w[i] / scale), -127, 127));
    return out;
  }

  /* ---------------------------------------------------------------- the Chum Loft panel (DOM, ES5) */
  function createLoft(opts) {
    opts = opts || {};
    var profile = opts.profile, host = null, filter = "all";
    var onSave = opts.onSave || function () {};
    var onMonitor = opts.onMonitor || function () {};
    var quizState = null;

    function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; }
    function btn(label, fn) {
      var b = el("button", "margin:2px;padding:4px 8px;background:#050520;color:#0ff;border:1px solid #0ff;font:12px monospace;cursor:pointer", label);
      b.onclick = fn; return b;
    }
    function render() {
      if (!host) return;
      host.innerHTML = "";
      var c = ensureState(profile);
      var box = el("div", "border:1px solid #0ff;padding:8px;margin:8px 0;color:#9ff;font:12px monospace;background:#02020f");
      box.appendChild(el("div", "color:#ff0;font-weight:bold", "CHUM LOFT // Echoes and DritchChums are the same system"));
      box.appendChild(el("div", "margin:4px 0", "Echoes are usually the gentle ones. DritchChums are usually the cheeky ones. Both become friends when the moment is right. Loft: " + c.roster.length + "/" + LOFT_SIZE));
      var row = el("div");
      var sel = el("select", "background:#050520;color:#0ff;border:1px solid #0ff;font:12px monospace;max-width:100%");
      var list = filter === "all" ? SPECIES : listSpecies(filter);
      for (var i = 0; i < list.length; i++) {
        var o = document.createElement("option");
        o.value = list[i].id; o.textContent = labelForRole(list[i].r) + ": " + list[i].n;
        sel.appendChild(o);
      }
      row.appendChild(btn("All", function () { filter = "all"; render(); }));
      row.appendChild(btn("Echoes", function () { filter = "nice"; render(); }));
      row.appendChild(btn("DritchChums", function () { filter = "naughty"; render(); }));
      row.appendChild(sel);
      row.appendChild(btn("Adopt", function () {
        var res = adopt(profile, sel.value, null, Date.now() & 0xffff);
        onMonitor(0, 0, 0, res.ok ? res.line : res.reason); onSave(); render();
      }));
      row.appendChild(btn("Next day", function () { var r = tickDay(profile); if (r.released.length) onMonitor(0, 0, 0, r.released[0].line); onSave(); render(); }));
      box.appendChild(row);
      if (c.roster.length >= 2) box.appendChild(contestBox(c));
      for (var k = 0; k < c.roster.length; k++) box.appendChild(card(c.roster[k]));
      if (quizState) box.appendChild(quizBox());
      host.appendChild(box);
    }
    /* Track, duel stage and meeting corner. Races and duels are friendly: the bars only show who crossed first. */
    var contestText = "", timer = null;
    function chumSelect(c, sel0) {
      var s = el("select", "background:#050520;color:#0ff;border:1px solid #0ff;font:12px monospace;max-width:140px");
      for (var i = 0; i < c.roster.length; i++) {
        var o = document.createElement("option"); o.value = c.roster[i].id; o.textContent = c.roster[i].name;
        if (i === sel0) o.selected = true;
        s.appendChild(o);
      }
      return s;
    }
    function contestBox(c) {
      var b = el("div", "border:1px solid #066;margin:6px 0;padding:6px");
      var head = el("div", "color:#ff0", "");
      function cupsText() { head.textContent = "TRACK, DUEL STAGE AND MEETING CORNER   cups: race " + c.cups.race + ", duel " + c.cups.duel; }
      cupsText(); b.appendChild(head);
      var lanes = el("div", "margin:4px 0");
      var laneBars = {};
      for (var i = 0; i < c.roster.length; i++) {
        var lane = el("div", "display:flex;align-items:center;gap:6px;margin:1px 0");
        lane.appendChild(el("span", "width:90px;overflow:hidden;white-space:nowrap;color:#6aa", c.roster[i].name));
        var tr = el("div", "flex:1;height:8px;background:#0a1a2a");
        var bar = el("div", "height:8px;width:0%;background:#0cc");
        tr.appendChild(bar); lane.appendChild(tr); lanes.appendChild(lane);
        laneBars[c.roster[i].id] = bar;
      }
      b.appendChild(lanes);
      var out = el("div", "color:#fc6;min-height:16px;margin:3px 0", contestText);
      var r1 = el("div");
      r1.appendChild(btn("Race everyone", function () {
        var res = api.race();
        if (!res.ok) { contestText = res.reason; render(); return; }
        contestText = res.line;
        cupsText();
        onMonitor(0, 0, 0, res.line);
        /* animate: the winner reaches 100 percent, the rest finish a little behind */
        if (timer) clearInterval(timer);
        var steps = 0, total = 24, n = res.rows.length;
        out.textContent = "...they are off!";
        timer = setInterval(function () {
          steps++;
          for (var q = 0; q < n; q++) {
            var final = 100 - q * Math.max(3, Math.floor(30 / n));
            var bb = laneBars[res.rows[q].id];
            if (bb) bb.style.width = Math.min(final, Math.round(final * steps / total)) + "%";
          }
          if (steps >= total) { clearInterval(timer); timer = null; out.textContent = res.line; }
        }, 45);
        onSave();
      }));
      b.appendChild(r1);
      var r2 = el("div", "margin-top:4px");
      var d1 = chumSelect(c, 0), d2 = chumSelect(c, 1);
      r2.appendChild(d1); r2.appendChild(el("span", "", " vs ")); r2.appendChild(d2);
      r2.appendChild(btn("Duel (hold the last note)", function () {
        var res = api.duel(d1.value, d2.value);
        contestText = res.ok ? res.line : res.reason; onMonitor(0, 0, 0, contestText); onSave(); render();
      }));
      b.appendChild(r2);
      var r3 = el("div", "margin-top:4px");
      var m1 = chumSelect(c, 0), m2 = chumSelect(c, 1);
      var mc = el("select", "background:#050520;color:#0ff;border:1px solid #0ff;font:12px monospace");
      var fr = friendlyCircumstances();
      for (var f = 0; f < fr.length; f++) { var oo = document.createElement("option"); oo.value = fr[f].id; oo.textContent = fr[f].id.replace(/_/g, " "); mc.appendChild(oo); }
      r3.appendChild(m1); r3.appendChild(el("span", "", " + ")); r3.appendChild(m2); r3.appendChild(mc);
      r3.appendChild(btn("Let them meet", function () {
        var res = api.meet(m1.value, m2.value, mc.value);
        contestText = res.ok ? res.line + " They are " + res.label + "." : res.reason; onMonitor(0, 0, 0, contestText); onSave(); render();
      }));
      b.appendChild(r3);
      b.appendChild(out);
      return b;
    }
    function card(ch) {
      var sp = getSpecies(ch.sp), d = el("div", "border-top:1px dashed #066;margin-top:6px;padding-top:4px");
      d.appendChild(el("div", "color:#fff", describe(ch)));
      var tv = threadView(ch), bars = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:3px 0");
      for (var s in tv) {
        var w = WEIGHTS.indexOf(tv[s].weight) + 1;
        var b = el("div", "width:" + (w * 14) + "px;height:8px;background:#0cc;opacity:" + (0.35 + w * 0.13));
        b.title = s + ": " + tv[s].weight + " " + tv[s].colour + " thread";
        bars.appendChild(el("span", "font-size:10px;color:#6aa", s));
        bars.appendChild(b);
      }
      d.appendChild(bars);
      for (var i = 0; i < ACTIONS.length; i++) (function (act) {
        d.appendChild(btn(act, function () {
          quizState = { chumId: ch.id, act: act, items: quizFor(ch, Date.now() & 0xffff) };
          if (!quizState.items.length) { var r0 = care(profile, ch.id, act, {}); onMonitor(0, 0, 0, r0.line); quizState = null; onSave(); }
          render();
        }));
      })(ACTIONS[i]);
      d.appendChild(el("span", "color:#789;font-size:11px", " " + sp.quirk));
      return d;
    }
    function quizBox() {
      var it = quizState.items[0], b = el("div", "border:1px solid #fa0;padding:6px;margin-top:6px;color:#fc6");
      b.appendChild(el("div", "", it.q));
      var opts2 = [it.ans].concat(it.wrong.slice(0, 3)).sort(function (a, z) { return strHash(a + it.id) - strHash(z + it.id); });
      for (var i = 0; i < opts2.length; i++) (function (choice) {
        b.appendChild(btn(choice, function () {
          var ok = choice === it.ans;
          var res = care(profile, quizState.chumId, quizState.act, { correct: ok });
          onMonitor(0, 0, 0, (ok ? "Right. " : it.failRule + " ") + res.line);
          quizState = null; onSave(); render();
        }));
      })(opts2[i]);
      return b;
    }
    var api;
    api = {
      mountDOM: function (h) { host = h; render(); },
      refresh: render,
      race: function (seed) {
        var ids = ensureState(profile).roster.map(function (r) { return r.id; });
        return race(profile, ids, seed || (Date.now() & 0xffff));
      },
      duel: function (aId, bId, seed) { return duel(profile, aId, bId, seed || (Date.now() & 0xffff)); },
      meet: function (aId, bId, circId) { return befriend(profile, aId, bId, circId); },
      adopt: function (id, name) { var r = adopt(profile, id, name, Date.now() & 0xffff); onSave(); render(); return r; },
      tickDay: function () { var r = tickDay(profile); onSave(); render(); return r; },
      parseChat: function (text) {
        var cmd = parseCommand(profile, text);
        if (!cmd.action || !cmd.chumId) return null;
        var r = care(profile, cmd.chumId, cmd.action, {}); onSave(); render(); return r;
      }
    };
    return api;
  }

  root.EvelynChums = {
    version: "1.0",
    STATS: STATS, ACTIONS: ACTIONS, STAGES: STAGES, LOFT_SIZE: LOFT_SIZE, CIRCUMSTANCES: CIRCUMSTANCES,
    SPECIES: SPECIES, dataHash: DATA.hash,
    labelForRole: labelForRole, isTerm: isTerm, speakAs: speakAs,
    getSpecies: getSpecies, listSpecies: listSpecies, isPetSafe: isPetSafe,
    ensureState: ensureState, findChum: findChum,
    adopt: adopt, care: care, tickDay: tickDay, tickByClock: tickByClock,
    threadView: threadView, describe: describe, chumLine: chumLine,
    circumstance: circumstance, friendlyCircumstances: friendlyCircumstances, befriend: befriend, bondLabel: bondLabel,
    breed: breed, race: race, duel: duel,
    quizFor: quizFor, careDeck: careDeck, parseCommand: parseCommand, brainBytes: brainBytes,
    createLoft: createLoft,
    RULES: { LOFT_SIZE: LOFT_SIZE, RELEASE_DAYS: RELEASE_DAYS, CATCH_UP_DAYS: CATCH_UP_DAYS, STAGE_DAYS: STAGE_DAYS, ACTION_RULES: ACTION_RULES,
      STAT_COLOURS: STAT_COLOURS, ELEMENT_COLOURS: ELEMENT_COLOURS, WEIGHTS: WEIGHTS, MISCHIEF_CHANCE: 0.25 },
    HARM_WORDS: HARM_WORDS, WOMAN_WORDS: WOMAN_WORDS
  };
  /* The same system under its other name. */
  root.EvelynEchoes = root.EvelynChums;
  root.EvelynDritchChums = root.EvelynChums;
  if (typeof module !== "undefined" && module.exports) module.exports = root.EvelynChums;
})(typeof window !== "undefined" ? window : global);
