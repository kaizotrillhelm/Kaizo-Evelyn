/* evelyn_paper_boost2_tests.js - Automated ES5 Tests for EvelynPaperBoost2
   Run in Node.js: node evelyn_paper_boost2_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) require("./evelyn_paper_boost2.js");

  var P2 = root.EvelynPaperBoost2;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. CommCP Split Conformal Filter + BudgetMem 4-Tier Cascade */
  test("ConformalFilter & BudgetCascade: Calibrates quantile and stops at cheapest confident tier", function (done) {
    var cf = new P2.ConformalFilter(0.10);
    /* 10 calibration nonconformity scores (1 - conf) mostly <= 0.15 */
    var q = cf.calibrate([0.02, 0.04, 0.05, 0.07, 0.08, 0.10, 0.11, 0.12, 0.15, 0.25]);
    assert(q >= 0.15 && q <= 0.25, "Unexpected conformal qHat: " + q);
    assert(cf.accept(0.92).accepted, "0.92 confidence (nonconf 0.08) should pass");
    assert(!cf.accept(0.60).accepted, "0.60 confidence (nonconf 0.40) must be filtered out");

    var tiers = [
      { name: "T0_Table", costMs: 1, run: function (qStr) { return qStr === "gold" ? { answer: "Au", confidence: 0.99 } : { answer: "", confidence: 0.1 }; } },
      { name: "T1_RAG",   costMs: 3, run: function () { return { answer: "Boil 1 min", confidence: 0.90 }; } },
      { name: "T2_TNY2",  costMs: 30, run: function () { return { answer: "Fallback", confidence: 0.70 }; } }
    ];

    var fastHit = P2.BudgetCascade.execute("gold", tiers, cf, 100);
    assertEq(fastHit.tierUsed, "T0_Table", "Exact lookup must exit at Tier 0");
    assertEq(fastHit.spentMs, 1, "Tier 0 exit should spend only 1 ms");

    var ragHit = P2.BudgetCascade.execute("boil water", tiers, cf, 100);
    assertEq(ragHit.tierUsed, "T1_RAG", "Unmatched table should escalate cleanly to Tier 1 and stop");
    assertEq(ragHit.spentMs, 4, "Should stop after T0+T1 (4 ms) without firing T2");
    done();
  });

  /* 2. ShardMemo 8-Byte Bloom-Masked Shard Router */
  test("ShardBloomRouter: Probes only budget-capped eligible shards using 8-byte Bloom masks", function (done) {
    var sr = new P2.ShardBloomRouter();
    sr.registerShard("shelf_health", "boil water purification oral rehydration salt sugar bandage");
    sr.registerShard("shelf_c89", "printf malloc struct pointer typedef header compiler");
    sr.registerShard("shelf_music", "marimba octave chord rhythm tempo melody harmony");
    sr.registerShard("shelf_obd", "engine coolant rpm misfire P0300 battery alternator");

    var hits = sr.selectShards("how to fix engine misfire P0300 coolant", 1);
    assertEq(hits.length, 1, "Budget cap maxProbeShards=1 must return at most 1 shard");
    assertEq(hits[0].id, "shelf_obd", "Bloom router missed shelf_obd: " + hits[0].id);
    done();
  });

  /* 3. SCATE / OptimAI UCB1 Bandit Scheduler */
  test("UCBBandit: Explores all arms first, then favors highest-reward strategy", function (done) {
    var b = new P2.UCBBandit(["fuzz", "prop_shrink", "static_ast"], 1.0);
    var seen = [];
    for (var i = 0; i < 3; i++) {
      var arm = b.selectArm();
      seen.push(arm);
      b.update(arm, arm === "prop_shrink" ? 1.0 : 0.1);
    }
    assertEq(seen.length, 3, "Should visit all 3 arms first");
    for (var k = 0; k < 15; k++) {
      var pick = b.selectArm();
      b.update(pick, pick === "prop_shrink" ? 0.95 : 0.05);
    }
    assertEq(b.selectArm(), "prop_shrink", "UCB1 should converge on best-performing arm 'prop_shrink'");
    done();
  });

  /* 4. Membox Topic Loom isolates topic contexts across switches */
  test("MemboxLoom: Groups consecutive topic turns into sealed boxes and recalls clean topic history", function (done) {
    var loom = new P2.MemboxLoom();
    loom.addTurn("fractions", "kid", "What is 3/4 + 1/8?");
    loom.addTurn("fractions", "evelyn", "7/8.");
    loom.addTurn("asm6502", "kid", "What does INX do?");
    loom.addTurn("asm6502", "evelyn", "Adds 1 to X.");
    loom.addTurn("fractions", "kid", "Now try 1/2 + 1/4.");

    assertEq(loom.boxes.length, 3, "Expected 3 timeline boxes (fractions -> asm6502 -> fractions)");
    assert(loom.boxes[0].sealed && loom.boxes[1].sealed && !loom.boxes[2].sealed, "Prior boxes must seal on topic shift");

    var fracHistory = loom.recallTopic("fractions");
    assertEq(fracHistory.length, 3, "Fractions recall should retrieve all 3 turns without asm6502 noise");
    assert(JSON.stringify(fracHistory).indexOf("INX") < 0, "Cross-topic leakage detected in Membox recall");
    done();
  });

  /* 5. AgentDevel + MonoScale Flip-Centered Regression Gate */
  test("FlipRegressionGate: Blocks PASS->FAIL regressions even when total pass count stays equal", function (done) {
    var before = { t1: true, t2: true, t3: true, t4: false };
    /* Trade-off patch fixes t4 but breaks t2 -> total still 3/4, MUST be blocked! */
    var regress = P2.FlipRegressionGate.evaluate(before, { t1: true, t2: false, t3: true, t4: true });
    assert(!regress.approved && regress.regressions[0] === "t2", "Gate must block PASS->FAIL flip on t2");

    /* Monotonic improvement fixes t4 with zero regressions -> approved */
    var clean = P2.FlipRegressionGate.evaluate(before, { t1: true, t2: true, t3: true, t4: true });
    assert(clean.approved && clean.fixes[0] === "t4" && clean.regressions.length === 0, "Monotonic fix must pass gate");
    done();
  });

  /* 6. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_paper_boost2.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_paper_boost2.js", "evelyn_paper_boost2_tests.js"];
      var banned = [[/\bArray\.from\s*\(/, "Array.from"], [/\bnew\s+Map\s*\(/, "Map"], [/\bnew\s+Set\s*\(/, "Set"], [/\)\s*=>/, "arrow"], [/\(\?</, "lookbehind"]];
      for (var i = 0; i < files.length; i++) {
        var fp = path.join(__dirname, files[i]);
        if (!fs.existsSync(fp)) continue;
        var src = fs.readFileSync(fp, "utf8");
        for (var j = 0; j < banned.length; j++) assert(!banned[j][0].test(src), files[i] + " failed ES5 guard: " + banned[j][1]);
      }
      done();
    });
  }

  var pass = 0, fail = 0, idx = 0;
  function next() {
    if (idx >= tests.length) {
      console.log("\n=== PAPER BOOST 2 RESULT: " + pass + " passed, " + fail + " failed ===");
      if (isNode) process.exit(fail > 0 ? 1 : 0);
      return;
    }
    var cur = tests[idx++], ended = false;
    function done(err) {
      if (ended) return; ended = true;
      if (err) { fail++; console.log("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
      else { pass++; console.log("[PASS] " + cur.name); }
      setTimeout(next, 0);
    }
    try { cur.fn(done); } catch (e) { done(e); }
  }
  console.log("=== EVELYN 2026 PAPER BOOST 2 TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
