/* evelyn_chums_tests.js - Tests for the DritchChum / Echo pet raising system.
   Run in Node.js: node evelyn_chums_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_cartridges.js");
    require("./evelyn_voice_guard.js");
    require("./evelyn_chums_data.js");
    require("./evelyn_chums.js");
    require("./evelyn_net.js");
  }

  var K = root.EvelynChums, C = root.EvelynCartridges, VG = root.EvelynVoiceGuard, NET = root.EvelynNet || (isNode ? require("./evelyn_net.js") : null);
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }
  function newProfile() { return { name: "Kid", mode: "M", xp: 0, trophies: [], sr: {}, recent8: [], focusWeights: {}, recentLessons: [] }; }
  function firstOf(role) { return K.listSpecies(role)[0]; }

  test("Species: every pet is a creature from the owner's database; none is a humanoid or a woman", function (done) {
    assertEq(K.SPECIES.length, 111, "Expected 111 creature species");
    assertEq(K.listSpecies("nice").length, 52, "Echoes (nice creatures)");
    assertEq(K.listSpecies("naughty").length, 59, "DritchChums (naughty creatures)");
    for (var i = 0; i < K.SPECIES.length; i++) {
      var s = K.SPECIES[i];
      assert(!K.WOMAN_WORDS.test([s.n, s.fam, s.quirk, s.voice, s.eatHow, s.temp].join(" ")), "Woman-like word in species " + s.n);
      assert(s.el && s.el.length >= 1, "Species without an element: " + s.n);
    }
    /* A humanoid, a vehicle or an unknown id can never be adopted */
    var p = newProfile();
    var r1 = K.adopt(p, "ATL-CHR-009", "Nope", 1);
    var r2 = K.adopt(p, "not-a-species", "Nope", 1);
    assert(!r1.ok && !r2.ok, "Humanoid or unknown ids must be refused");
    assertEq(p.chums.roster.length, 0, "Nothing may be added to the loft by a refused adoption");
    /* Every species that the database holds as a humanoid is absent from the pet list */
    var db = isNode ? require("fs").existsSync(require("path").join(__dirname, "..", "..", "CharacterDatabase", "database", "characters.json")) : false;
    if (db) {
      var all = require(require("path").join(__dirname, "..", "..", "CharacterDatabase", "database", "characters.json"));
      all = Array.isArray(all) ? all : all.characters;
      for (var j = 0; j < all.length; j++) {
        if (all[j].kind !== "creature") assert(!K.getSpecies(all[j].id), all[j].kind + " record " + all[j].name + " leaked into the pet list");
      }
    }
    done();
  });

  test("Terms: Echo and DritchChum are interchangeable words for one system", function (done) {
    assert(K === root.EvelynEchoes && K === root.EvelynDritchChums, "Both names must point at the same system");
    var words = ["echo", "Echo", "echoes", "Echoes", "dritchchum", "DritchChum", "Dritch Chum", "dritch-chum", "DritchChums"];
    for (var i = 0; i < words.length; i++) assert(K.isTerm(words[i]), "'" + words[i] + "' must be recognised");
    assert(!K.isTerm("chair") && !K.isTerm("dritch"), "Unrelated words must not match");
    assertEq(K.labelForRole("nice"), "Echo", "Nice creatures are Echoes");
    assertEq(K.labelForRole("naughty"), "DritchChum", "Naughty creatures are DritchChums");
    assertEq(K.speakAs("Feed your echo and your Dritch Chum", "nice"), "Feed your Echo and your Echo", "Rewrite to Echo");
    assertEq(K.speakAs("my echoes and dritchchums", "naughty"), "my DritchChums and DritchChums", "Rewrite to DritchChum");
    /* Commands work with either word */
    var p = newProfile();
    var e = K.adopt(p, firstOf("nice").id, "Pip", 4).chum;
    var d = K.adopt(p, firstOf("naughty").id, "Gnash", 4).chum;
    var c1 = K.parseCommand(p, "please feed my echo Pip");
    var c2 = K.parseCommand(p, "play with dritch chum Gnash");
    assertEq(c1.action, "feed", "feed parsed"); assertEq(c1.chumId, e.id, "Pip found");
    assertEq(c2.action, "play", "play parsed"); assertEq(c2.chumId, d.id, "Gnash found");
    done();
  });

  test("Care: stats show as thread weight and colour, never as numbers; a wrong answer costs nothing", function (done) {
    var p = newProfile();
    var ch = K.adopt(p, firstOf("nice").id, "Pip", 9).chum;
    var before = ch.stats.Stand;
    var right = K.care(p, ch.id, "feed", { correct: true });
    var afterRight = ch.stats.Stand;
    var wrong = K.care(p, ch.id, "feed", { correct: false });
    assert(right.ok && wrong.ok, "Care must succeed");
    assert(afterRight > before, "A right answer grows the stat");
    assert(ch.stats.Stand >= afterRight, "A wrong answer never lowers a stat");
    var view = K.threadView(ch);
    var keys = Object.keys(view);
    assertEq(keys.join(","), K.STATS.join(","), "All five stats shown");
    assert(!/[0-9]/.test(JSON.stringify(view)), "Thread view must hold no digits: " + JSON.stringify(view));
    assert(!/[0-9]/.test(K.describe(ch).replace(/\(.*?\)/g, "")), "Description must show no numbers");
    for (var a = 0; a < K.ACTIONS.length; a++) {
      var r = K.care(p, ch.id, K.ACTIONS[a], {});
      assert(r.ok && r.line.length <= 128, "Action " + K.ACTIONS[a] + " must give a line of 128 characters or fewer");
    }
    assert(!K.care(p, ch.id, "kick", {}).ok, "Unknown actions are refused");
    done();
  });

  test("Nothing is hurt: every care, mischief and release line is free of harm words and clean for the voice guard", function (done) {
    var p = newProfile(), lines = [], i;
    var ids = [];
    for (i = 0; i < 6; i++) ids.push(K.adopt(p, K.SPECIES[(i * 17) % K.SPECIES.length].id, "Buddy" + i, i + 1).chum.id);
    for (i = 0; i < ids.length; i++) {
      for (var a = 0; a < 6; a++) for (var n = 0; n < 6; n++) lines.push(K.care(p, ids[i], K.ACTIONS[a], {}).line);
    }
    for (i = 0; i < 40; i++) lines.push(K.chumLine(K.findChum(p, ids[i % ids.length]), "mischief"));
    var sawMischief = false;
    for (i = 0; i < lines.length; i++) {
      assert(!K.HARM_WORDS.test(lines[i]), "Harm word in: " + lines[i]);
      assert(lines[i].length <= 128, "Line too long: " + lines[i]);
      var res = VG.audit(lines[i]);
      var high = (res.hits || []).filter(function (h) { return h.sev === "high"; });
      assert(high.length === 0, "Voice guard flagged: " + lines[i]);
      if (/swipes a biscuit/.test(lines[i])) sawMischief = true;
    }
    assert(sawMischief, "DritchChum mischief lines must appear");
    done();
  });

  test("Neglect: a creature with no care for three days is released kindly, never harmed", function (done) {
    var p = newProfile();
    var ch = K.adopt(p, firstOf("naughty").id, "Ember", 5).chum;
    ch.needs.trust = 0;
    var released = [], day;
    for (day = 0; day < 10 && !released.length; day++) released = K.tickDay(p).released;
    assertEq(released.length, 1, "The creature must be released");
    assert(/goes home to/.test(released[0].line) && /door stays open/.test(released[0].line), "Release line must be kind: " + released[0].line);
    assert(!K.HARM_WORDS.test(released[0].line), "No harm words");
    assertEq(p.chums.roster.length, 0, "Loft is empty after release");
    /* Real-clock catch-up is capped at two days so a child who was away is not punished */
    var q = newProfile();
    var k2 = K.adopt(q, firstOf("nice").id, "Mo", 6).chum;
    K.tickByClock(q, 1000);
    var r = K.tickByClock(q, 1000 + 30 * 86400000);
    assertEq(r.released.length, 0, "A month away must not release anyone");
    assertEq(k2.age, 2, "Only two days of catch-up");
    done();
  });

  test("Friends in the right circumstances: every Echo and DritchChum pair can become friends", function (done) {
    var p = newProfile();
    var friendly = K.friendlyCircumstances();
    assert(friendly.length >= 4, "At least four friendly circumstances");
    var nice = K.listSpecies("nice"), naughty = K.listSpecies("naughty");
    /* all 52 x 59 species pairs, three at a time in the loft (a pair per round) */
    var pairs = 0;
    for (var i = 0; i < nice.length; i++) {
      for (var j = 0; j < naughty.length; j++) {
        var q = newProfile();
        var a = K.adopt(q, nice[i].id, "A", 1).chum, b = K.adopt(q, naughty[j].id, "B", 1).chum;
        var last = null;
        for (var m = 0; m < 5; m++) last = K.befriend(q, a.id, b.id, friendly[m % friendly.length].id);
        assert(last.bond >= 30 && last.label !== "wary of each other", nice[i].n + " and " + naughty[j].n + " should be friends, bond " + last.bond);
        assertEq(a.bonds[b.id], b.bonds[a.id], "Bond is shared by both");
        pairs++;
      }
    }
    assertEq(pairs, 52 * 59, "All pairs tried");
    /* First meeting between an Echo and a DritchChum starts wary, a same-role pair warms faster */
    var r = newProfile();
    var e1 = K.adopt(r, nice[0].id, "E1", 2).chum, d1 = K.adopt(r, naughty[0].id, "D1", 2).chum, e2 = K.adopt(r, nice[1].id, "E2", 2).chum;
    var mixed = K.befriend(r, e1.id, d1.id, "shared_meal"), same = K.befriend(r, e1.id, e2.id, "shared_meal");
    assert(mixed.mixed && !same.mixed && same.bond > mixed.bond, "Mixed first meeting is wary");
    var rival = K.befriend(r, d1.id, e2.id, "race_day");
    assert(rival.rivalry && rival.bond > 0 && !K.HARM_WORDS.test(rival.line), "Rivals tease and stay friendly");
    done();
  });

  test("Kin: breeding makes the same creature with inherited colours and stitch affinity; change of kind is refused", function (done) {
    var p = newProfile();
    var id = firstOf("naughty").id;
    var a = K.adopt(p, id, "Mum", 1).chum, b = K.adopt(p, id, "Dad", 2).chum;
    var other = K.adopt(p, firstOf("nice").id, "Other", 3).chum;
    assert(!K.breed(p, a.id, b.id, 1).ok, "Kits cannot breed");
    for (var d = 0; d < 9; d++) K.tickDay(p);
    for (var n = 0; n < 12; n++) { K.care(p, a.id, "story", {}); K.care(p, b.id, "story", {}); K.care(p, other.id, "story", {}); }
    assertEq(a.stage, "grown", "Parent grown");
    var kin = K.breed(p, a.id, b.id, 4);
    assert(kin.ok, "Same creature, grown, trusting: " + kin.reason);
    assertEq(kin.chum.sp, id, "Kin is the same creature");
    assertEq(kin.chum.stage, "kit", "Kin starts as a kit");
    assert(kin.chum.palette.every(function (c, i) { return c === a.palette[i] || c === b.palette[i]; }), "Palette inherited from the parents");
    assert(kin.chum.affinity === a.affinity || kin.chum.affinity === b.affinity, "Affinity inherited");
    var cross = K.breed(p, a.id, other.id, 4);
    assert(!cross.ok && /same creature/i.test(cross.reason), "Cross-species breeding refused: " + cross.reason);
    /* The 30-weight brain packs into 36 bytes and survives the round trip within quantization */
    var bytes = K.brainBytes(kin.chum);
    assertEq(bytes.length, 36, "Brain is 36 bytes");
    var back = NET.unpackBotBrain(bytes);
    for (var i = 0; i < 30; i++) assert(Math.abs(back[i] - kin.chum.brain[i]) < 0.01, "Brain weight " + i + " drifted");
    done();
  });

  test("Loft limits, races and duels: six places, friendly contests, no one hurt", function (done) {
    var p = newProfile(), ids = [];
    for (var i = 0; i < 6; i++) ids.push(K.adopt(p, K.SPECIES[i].id, "P" + i, i).chum.id);
    var full = K.adopt(p, K.SPECIES[7].id, "Extra", 1);
    assert(!full.ok && /holds 6/.test(full.reason), "A seventh creature must wait");
    var rc = K.race(p, ids, 11), rc2 = K.race(p, ids, 11);
    assertEq(rc.ranking.length, 6, "All six ranked");
    assertEq(rc.ranking.join(","), rc2.ranking.join(","), "Seeded race is repeatable");
    var du = K.duel(p, ids[0], ids[1], 5);
    assert(du.ok && /ribbon/.test(du.line) && !K.HARM_WORDS.test(du.line), "Duel ends with a ribbon: " + du.line);
    assertEq(p.chums.cups.race, 2, "Race cup rounds counted"); assertEq(p.chums.cups.duel, 1, "Duel cup rounds counted");
    done();
  });

  test("Contests are friendly: races and duels build rivalry bonds between neighbours, and one creature cannot race alone", function (done) {
    var p = newProfile();
    var a = K.adopt(p, firstOf("nice").id, "Lark", 1).chum;
    var solo = K.race(p, [a.id], 2);
    assert(!solo.ok && /two/.test(solo.reason), "A race needs two: " + solo.reason);
    assertEq(p.chums.cups.race, 0, "A refused race counts no cup");
    var b = K.adopt(p, firstOf("naughty").id, "Snag", 1).chum, c = K.adopt(p, K.listSpecies("naughty")[1].id, "Grit", 1).chum;
    var res = K.race(p, [a.id, b.id, c.id], 9);
    assert(res.ok && res.rows.length === 3 && /crosses first/.test(res.line), "Race result: " + res.line);
    assert(!K.HARM_WORDS.test(res.line), "Race line is free of harm words");
    var linked = 0;
    [a, b, c].forEach(function (x) { for (var k in x.bonds) if (x.bonds[k] > 0) linked++; });
    assert(linked >= 4, "Neighbours on the track are linked (" + linked + " bond ends)");
    var before = b.bonds[c.id] || 0;
    var du = K.duel(p, b.id, c.id, 3);
    assert(du.ok && du.loserId && b.bonds[c.id] > before, "A duel grows the bond between the two");
    assertEq(K.bondLabel(b.bonds[c.id]) === "strangers", false, "Duellists are no longer strangers");
    done();
  });

  test("Learning: care questions come from the species data and pass the cartridge validator", function (done) {
    var p = newProfile();
    for (var i = 0; i < 4; i++) K.adopt(p, K.SPECIES[i * 20].id, "Q" + i, i + 1);
    var deck = K.careDeck(p, 3);
    assert(deck.items.length >= 8, "Several questions per loft: " + deck.items.length);
    var rep = C.CartridgeValidator.validate(deck);
    assert(rep.ok, "Validator: " + rep.errors.join("; "));
    for (var j = 0; j < deck.items.length; j++) {
      var it = deck.items[j];
      assertEq(it.wrong.length, 3, "Three wrong answers for " + it.id);
      assert(it.wrong.indexOf(it.ans) < 0, "The answer repeats among the wrong ones for " + it.id);
    }
    /* Canon check: Static Choir Hounds are weak to eldritch, light and holy (a database fact the quiz must keep) */
    var hound = K.getSpecies("ATL-ENM-001");
    assert(hound && hound.weak.join(",") === "eldritch,light,holy", "Hound weakness drifted: " + (hound && hound.weak));
    done();
  });

  test("Loft panel: ES5 audit of the chum files (no arrows, Map, Set, Array.from or optional chaining)", function (done) {
    if (!isNode) return done();
    var fs = require("fs"), path = require("path");
    var files = ["evelyn_chums.js", "evelyn_chums_tests.js"];
    var banned = [
      [/\bArray\.from\s*\(/, "Array.from"], [/\bnew\s+Map\s*\(/, "new Map"], [/\bnew\s+Set\s*\(/, "new Set"],
      [new RegExp("=" + ">"), "arrow function"], [/\?\./, "optional chaining"], [/(?:^|[\n;{}()])\s*(?:const|let)\s+[A-Za-z_$][\w$]*\s*(?:=|;|,)/, "let or const"]
    ];
    for (var i = 0; i < files.length; i++) {
      var src = fs.readFileSync(path.join(__dirname, files[i]), "utf8");
      for (var j = 0; j < banned.length; j++) assert(!banned[j][0].test(src), files[i] + " failed ES5 guard: " + banned[j][1]);
    }
    done();
  });

  function runAll(logFn, onDone) {
    logFn = logFn || function (s) { console.log(s); };
    var pass = 0, fail = 0, idx = 0, t0 = Date.now();
    function next() {
      if (idx >= tests.length) {
        logFn("\n=== CHUM LOFT RESULT: " + pass + " passed, " + fail + " failed (" + (Date.now() - t0) + " ms) ===");
        if (onDone) onDone(pass, fail);
        if (isNode) process.exit(fail > 0 ? 1 : 0);
        return;
      }
      var cur = tests[idx++], ended = false;
      function done(err) {
        if (ended) return; ended = true;
        if (err) { fail++; logFn("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
        else { pass++; logFn("[PASS] " + cur.name); }
        setTimeout(next, 0);
      }
      try { cur.fn(done); } catch (e) { done(e); }
    }
    logFn("=== EVELYN CHUM LOFT (ECHOES AND DRITCHCHUMS) TESTS (" + tests.length + " suites) ===");
    next();
  }

  if (isNode) runAll();
  else root.EvelynChumsTests = { runAll: runAll };
})(typeof window !== "undefined" ? window : global);
