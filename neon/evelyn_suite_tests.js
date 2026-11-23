/* evelyn_suite_tests.js - Comprehensive ES5 Test Suite for All 78 Cartridges,
   15 Concourse Doors, Canon/Guard Compliance, Adaptive Evolution & Integration.
   Run in Node.js: node evelyn_suite_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_cartridges.js");
    require("./evelyn_doctor.js");
    require("./evelyn_evolution.js");
    require("./evelyn_suite_78.js");
    require("./evelyn_suite_integration.js");
  }

  var B = root.EvelynBackend;
  var C = root.EvelynCartridges;
  var E = root.EvelynEvolution;
  var S = root.EvelynSuite78;
  var UI = root.EvelynSuiteUI;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Exact count, unique numbering 1..78, unique IDs/titles, and 15 Concourse doors */
  test("Suite 78: Exact 78 cartridges, sequential numbers 1..78, unique IDs/titles, all 15 doors populated", function (done) {
    assertEq(S.CARTRIDGES.length, 78, "Expected 78 cartridges");
    assertEq(S.CONCOURSE_DOORS.length, 15, "Expected 15 Concourse Mall doors");

    var seenId = Object.create(null), seenTitle = Object.create(null), doorCounts = Object.create(null);
    for (var i = 0; i < S.CARTRIDGES.length; i++) {
      var c = S.CARTRIDGES[i];
      assertEq(c.num, i + 1, "Sequential numbering broken at index " + i);
      assert(!seenId[c.id], "Duplicate cartridge id: " + c.id);
      assert(!seenTitle[c.title], "Duplicate cartridge title: " + c.title);
      seenId[c.id] = 1;
      seenTitle[c.title] = 1;
      assert(S.BY_DOOR[c.door] !== undefined, "Unknown Concourse door '" + c.door + "' on #" + c.num);
      doorCounts[c.door] = (doorCounts[c.door] || 0) + 1;
    }
    for (var d = 0; d < S.CONCOURSE_DOORS.length; d++) {
      var did = S.CONCOURSE_DOORS[d].id;
      assert((doorCounts[did] || 0) >= 2, "Concourse door '" + did + "' has too few cartridges: " + (doorCounts[did] || 0));
    }
    done();
  });

  /* 2. Coverage Matrix: all 4 grade bands and all 27 groups (A..AA) covered */
  test("Coverage Matrix: Every grade band (PK-2, 3-5, 6-8, 9-12) and all 27 groups covered", function (done) {
    var bands = { "PK-2": 0, "3-5": 0, "6-8": 0, "9-12": 0 };
    var groups = Object.create(null);
    for (var i = 0; i < S.CARTRIDGES.length; i++) {
      var c = S.CARTRIDGES[i];
      groups[c.group] = (groups[c.group] || 0) + 1;
      for (var b = 0; b < c.gradeBands.length; b++) {
        bands[c.gradeBands[b]] = (bands[c.gradeBands[b]] || 0) + 1;
      }
    }
    assert(bands["PK-2"] >= 10, "PK-2 coverage too low: " + bands["PK-2"]);
    assert(bands["3-5"] >= 25, "3-5 coverage too low: " + bands["3-5"]);
    assert(bands["6-8"] >= 30, "6-8 coverage too low: " + bands["6-8"]);
    assert(bands["9-12"] >= 15, "9-12 coverage too low: " + bands["9-12"]);
    var gCount = 0; for (var g in groups) gCount++;
    assertEq(gCount, 27, "Expected all 27 groups (A through AA)");
    done();
  });

  /* 3. Strict Canon, Content, Voice & Guard-Table Audit across all 78 cartridges */
  test("Canon & Guard Audit: All 78 cartridges pass CartridgeValidator and suite content/voice/guard rules", function (done) {
    var bannedTerms = [
      [/mannequin/i, "banned word mannequin"],
      [/winter games|olympic/i, "banned event name"],
      [/death zone/i, "must use Sealed Tube band instead of Death Zone"],
      [/\bnoon\b/i, "deadlines must use 12:00 PM instead of noon"],
      [/dysentery|caulk|oxen|wagon/i, "banned frontier-trail device"],
      [/arrest warrant|red coat|plane ticket/i, "banned chase-game device"],
      [/trash-zapper|space cadet/i, "banned shooter device"],
      [/troll gate|pizza troll/i, "banned attribute-gate device"],
      [/exploding eraser|rainbow-brush/i, "banned paint-tool device"],
      [/chronometer|time-cop/i, "banned time-travel device"],
      [/\bclone\b|\blookalike\b/i, "banned Evelyn term"]
    ];

    for (var i = 0; i < S.CARTRIDGES.length; i++) {
      var c = S.CARTRIDGES[i];
      var rep = C.CartridgeValidator.validate(c);
      assert(rep.ok, "Cartridge #" + c.num + " (" + c.id + ") failed CartridgeValidator: " + rep.errors.join("; "));
      assert(c.echoLine.length <= 128, "#" + c.num + " echoLine > 128 chars");
      assert(c.setPiece && c.setPiece.length > 5, "#" + c.num + " missing setPiece");
      assert(c.parentActivity && c.parentActivity.length > 10, "#" + c.num + " missing parentActivity");

      var blob = JSON.stringify(c);
      for (var b = 0; b < bannedTerms.length; b++) {
        assert(!bannedTerms[b][0].test(blob), "#" + c.num + " (" + c.id + ") hit " + bannedTerms[b][1]);
      }

      /* Character voice rules */
      var veraMatch = c.echoLine.match(/Vera:\s*"([^"]+)"/);
      if (veraMatch) assert(veraMatch[1].indexOf("!") < 0, "#" + c.num + " Vera must not use exclamation marks");

      var dritchMatch = c.echoLine.match(/Dritchlyssa:\s*"([^"]+)"/);
      if (dritchMatch) {
        assert(!/\b(don't|can't|won't|it's|i'm|isn't)\b/i.test(dritchMatch[1]), "#" + c.num + " Dritchlyssa uses no contractions");
        assert(!/\bplease\b/i.test(dritchMatch[1]), "#" + c.num + " Dritchlyssa never says please");
      }

      var candorMatch = c.echoLine.match(/Dr Candor:\s*"([^"]+)"/);
      if (candorMatch) {
        assert(!/\b(no|sorry)\b/i.test(candorMatch[1]), "#" + c.num + " Dr Candor never says no or sorry");
      }
    }
    done();
  });

  /* 4. Evolution Engine: Chat focus parsing + recent tutorial injection */
  test("Evolution: Detects player focus mentions and injects recent tutorial lessons into any cartridge", function (done) {
    var prof = { name: "Leo", mode: "M", xp: 0, trophies: [], sr: {}, recent8: [], focusWeights: {}, recentLessons: [] };
    var fRes = E.parseFocusIntent(prof, "I want to focus on fractions and Spanish words today!");
    assert(fRes.matched.indexOf("fractions") >= 0 && fRes.matched.indexOf("language") >= 0, "Failed to detect fractions + Spanish focus");
    assert(prof.focusWeights.fractions >= 3 && prof.focusWeights.language >= 3, "Focus weights not boosted");

    /* Log a recent classroom/home tutorial */
    var les = E.logLesson(prof, "Solar Cooking & Fractions", ["fractions", "science"], [
      "What fraction equals 50%? | 1/2 | Half of 100% is 50%, written 1/2.",
      "What does foil inside a solar box do? | Reflects sunlight | Foil reflects solar energy inward."
    ]);
    assertEq(les.facts.length, 2, "Expected 2 lesson facts recorded");

    /* Evolve Cartridge #1 (Static Choir Tune-Up) and verify >= 24 items + injected lesson facts */
    var evolved = E.evolveCartridge(S.getById("static_choir_tune_up"), prof, 777, 24);
    assertEq(evolved.items.length, 24, "Evolved cartridge should hold 24 playable items");
    assertEq(evolved.evolutionMeta.injectedLessons, 2, "Recent lesson items were not injected");
    assert(evolved.items[0].q.indexOf("[Recent Lesson: Solar Cooking & Fractions]") === 0, "Recent lesson item should surface first");

    /* Recommended cartridges should prioritize fractions/language/science games */
    var recs = E.recommendCartridges(S.CARTRIDGES, prof, 5);
    assertEq(recs.length, 5, "Expected 5 recommended cartridges");
    var hasFocusMatch = false;
    for (var i = 0; i < recs.length; i++) {
      var subs = E.detectSubjects(recs[i].title + " " + recs[i].subjects.join(" "));
      if (subs.indexOf("fractions") >= 0 || subs.indexOf("language") >= 0 || subs.indexOf("science") >= 0) hasFocusMatch = true;
    }
    assert(hasFocusMatch, "Recommended cartridges did not reflect learner focus");
    done();
  });

  /* 5. All 78 Cartridges Evolve Cleanly to 24 Valid Items Each */
  test("Evolution Scale: Every single one of the 78 cartridges evolves cleanly to 24 valid items", function (done) {
    var prof = { name: "Ada", mode: "D", xp: 150, trophies: [], sr: {}, recent8: [1,1,1,1,1,1,1,0], focusWeights: { coding: 4 }, recentLessons: [] };
    for (var i = 0; i < S.CARTRIDGES.length; i++) {
      var ev = E.evolveCartridge(S.CARTRIDGES[i], prof, 1000 + i, 24);
      assert(ev.items.length >= 24, "Cartridge #" + (i + 1) + " evolved to only " + ev.items.length + " items");
      assert(ev.evolutionMeta.tier >= 2, "High-accuracy learner should evolve to tier >= 2");
      var rep = C.CartridgeValidator.validate(ev);
      assert(rep.ok, "Evolved cartridge #" + (i + 1) + " failed validator: " + rep.errors.join("; "));
    }
    done();
  });

  /* 6. End-to-End Play Loop, Toy Mode, SM-2, KV21 Handoff & Parent Read-Out */
  test("Controller: Play loop, funny fail teaching, Toy Mode zero-score, KV21 handoff & Parent Read-Out", function (done) {
    var prof = { name: "Sam", mode: "M", xp: 0, trophies: [], sr: {}, recent8: [], focusWeights: {}, recentLessons: [] };
    var ctrl = UI.createController({ profile: prof });
    ctrl.applyFocusText("Please help me practice ratios and time");
    ctrl.addRecentLesson("Kitchen Math", "Double 3/4 cup | 1.5 cups | Two 3/4 cups make 6/4 = 1.5 cups.");

    var ev = ctrl.openCartridge("the_long_climb", 42);
    assert(ev && ev.items.length === 24, "Controller failed to open evolved The Long Climb");

    /* Wrong answer teaches without losing run */
    var wrongRes = ctrl.submitAnswer("totally_wrong_answer");
    assert(!wrongRes.ok && wrongRes.msg.indexOf("Rule:") >= 0, "Wrong answer must teach rule");
    assertEq(ctrl.state.streak, 0, "Wrong answer resets streak");

    /* Five right answers trigger Set Piece + Trophy + KV21 handoff */
    var lastRes;
    for (var k = 0; k < 5; k++) {
      var it = ctrl.currentItem();
      lastRes = ctrl.submitAnswer(it.ans);
      assert(lastRes.ok, "Correct answer rejected at round " + k);
    }
    assert(lastRes.isSetPiece, "Round 5 should trigger Set Piece");
    assert(prof.handoff && prof.handoff.fromCart === "the_long_climb", "KV21 handoff not recorded");
    assert(prof.trophies.indexOf("The Long Climb") >= 0, "Trophy not awarded");
    assert(prof.xp === 50, "Expected 50 XP from 5 correct rounds");

    /* Opening a second cartridge receives the KV21 handoff */
    var ev2 = ctrl.openCartridge("zeep_zorp_quiz_show", 99);
    assertEq(ev2.evolutionMeta.handoffUsed, "the_long_climb", "Second cartridge did not receive KV21 handoff");

    /* Toy Mode: zero score & zero XP change */
    ctrl.state.toyMode = true;
    var xpBefore = prof.xp;
    var rToy = ctrl.submitAnswer(ctrl.currentItem().ans);
    assert(rToy.ok && prof.xp === xpBefore, "Toy Mode must not modify XP");

    /* Parent Read-Out contains focus, recent lesson, and away-from-screen activity */
    var ro = E.buildParentReadout(prof, ev2);
    assert(ro.indexOf("Kitchen Math") >= 0 && ro.indexOf("Away-From-Screen Activity:") >= 0, "Parent Read-Out missing details");
    done();
  });

  /* 7. ES5 Syntax Compatibility Audit for all new files */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax blockers in evolution, suite 78, and integration files", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_evolution.js", "evelyn_suite_78.js", "evelyn_suite_integration.js", "evelyn_suite_tests.js"];
      var banned = [
        [/\bArray\.from\s*\(/, "Array.from"],
        [/\bnew\s+Map\s*\(/, "new Map"],
        [/\bnew\s+Set\s*\(/, "new Set"],
        [new RegExp("=" + ">"), "arrow function"],
        [/\?\./, "optional chaining"]
      ];
      for (var i = 0; i < files.length; i++) {
        var fp = path.join(__dirname, files[i]);
        if (!fs.existsSync(fp)) continue;
        var src = fs.readFileSync(fp, "utf8");
        for (var j = 0; j < banned.length; j++) {
          assert(!banned[j][0].test(src), files[i] + " failed ES5 guard: " + banned[j][1]);
        }
      }
      done();
    });
  }

  /* Runner */
  function runAll(logFn, onDone) {
    logFn = logFn || function (s) { console.log(s); };
    var pass = 0, fail = 0, idx = 0, t0 = Date.now();
    function next() {
      if (idx >= tests.length) {
        logFn("\n=== SUITE 78 RESULT: " + pass + " passed, " + fail + " failed (" + (Date.now() - t0) + " ms) ===");
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
    logFn("=== EVELYN 78-CARTRIDGE SUITE & EVOLUTION TESTS (" + tests.length + " suites) ===");
    next();
  }

  if (isNode) runAll();
  else root.EvelynSuiteTests = { runAll: runAll };
})(typeof window !== "undefined" ? window : global);
