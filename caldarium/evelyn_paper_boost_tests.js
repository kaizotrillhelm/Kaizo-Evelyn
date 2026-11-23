/* evelyn_paper_boost_tests.js - Automated ES5 Tests for EvelynPaperBoost
   Run in Node.js: node evelyn_paper_boost_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) require("./evelyn_paper_boost.js");

  var PB = root.EvelynPaperBoost;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Parallel Context-of-Experts Decoding */
  test("ContextOfExperts: Contrastive logit fusion across isolated chunks beats noisy base prior", function (done) {
    /* Base prior wrongly favors token 0; both retrieved doc experts favor token 3 */
    var base = new Float32Array([4.0, 0.5, 0.2, 0.1]);
    var exp1 = new Float32Array([2.5, 0.4, 0.2, 3.2]);
    var exp2 = new Float32Array([2.2, 0.3, 0.5, 3.4]);
    var fused = PB.ContextOfExperts.combineLogits([exp1, exp2], [0.6, 0.4], base, 0.8);
    assertEq(PB.ContextOfExperts.argmax(fused), 3, "Contrastive CoE fusion should select evidence-backed token 3");
    done();
  });

  /* 2. JitRL training-free logit modulation */
  test("JitRLModulator: Flips wrong prediction to corrected token at test time with zero gradients", function (done) {
    var jit = new PB.JitRLModulator();
    jit.recordFeedback("what is the boiling point of water above 6500 ft", 3, 1, 3.0);
    var rawLogits = new Float32Array([0.1, 2.5, 0.2, 1.8]); // initially prefers token 1
    var mod = jit.modulateLogits("boiling point of water above 6500 ft", rawLogits, 0.35);
    assertEq(mod.matchedExperiences, 1, "Should match stored correction");
    assertEq(PB.ContextOfExperts.argmax(mod.logits), 3, "JitRL should boost corrected token 3 above token 1");
    done();
  });

  /* 3. FadeMem adaptive decay, conflict resolution & pruning */
  test("FadeMemory: Resolves conflicting facts and prunes decayed low-importance noise while keeping core facts", function (done) {
    var fm = new PB.FadeMemory(0.4);
    var day0 = 1000000;
    fm.observe("temp_typo", "xyz", 0.5, day0);
    fm.observe("gondola_close", "5:00 PM", 3.0, day0);
    /* Conflict arrives: update gondola_close to canon 5:07 PM */
    var conf = fm.observe("gondola_close", "5:07 PM", 3.0, day0 + 1000);
    assert(conf.conflictResolved && fm.conflictsResolved === 1, "Conflict resolution should trigger");
    assertEq(fm.map["gondola_close"].val, "5:07 PM", "Updated value mismatch");

    /* Fast-forward 10 days: low-importance typo decays & prunes, sticky core fact survives */
    var day10 = day0 + 10 * 86400000;
    var pRes = fm.prune(0.25, day10);
    assert(pRes.prunedKeys.indexOf("temp_typo") >= 0, "Decayed typo should be pruned");
    assert(fm.map["gondola_close"] !== undefined, "High-importance resolved fact must survive 10-day prune");
    done();
  });

  /* 4. SWE-Pruner goal-aware code skimmer */
  test("CodeLineSkimmer: Shrinks long function while keeping header, error line, goal tokens & return", function (done) {
    var lines = ["function calcMotor(dist, slip) {"];
    for (var i = 0; i < 18; i++) lines.push("  // filler comment line " + i);
    lines.push("  var pwm = dist * slip;"); // line 20 (error line)
    lines.push("  return pwm;");
    lines.push("}");
    var res = PB.CodeLineSkimmer.skim(lines.join("\n"), "fix pwm slip calculation", 6, 20);
    assert(res.kept === 6 && res.dropped > 10, "Should trim down to 6 lines");
    assert(res.code.indexOf("function calcMotor") >= 0 && res.code.indexOf("var pwm = dist * slip;") >= 0 && res.code.indexOf("return pwm;") >= 0,
      "Skimmer dropped essential line:\n" + res.code);
    done();
  });

  /* 5. Topo-RAG cell-aware table retrieval */
  test("CellAwareTableIndex: Exact row/column lookup with cell provenance", function (done) {
    var tbl = new PB.CellAwareTableIndex();
    tbl.addTable("elements", "name", ["name", "symbol", "atomic", "phase"], [
      { name: "Silver", symbol: "Ag", atomic: 47, phase: "solid" },
      { name: "Mercury", symbol: "Hg", atomic: 80, phase: "liquid" }
    ]);
    var q = tbl.queryCell("elements", "Mercury", "phase");
    assert(q.ok && q.value === "liquid" && q.provenance.indexOf("row:Mercury") >= 0, "Cell lookup failed");
    assert(!tbl.queryCell("elements", "Gold", "phase").ok, "Missing row should return { ok: false }");
    done();
  });

  /* 6. Epistemic TrustBroker (quadratic voting) + StepShield early halt + SWE-Replay branch */
  test("TrustBroker & TrajGuard: Quadratic trust outvotes weak Echoes; StepShield halts loops & branches cleanly", function (done) {
    var tb = new PB.TrustBroker();
    for (var i = 0; i < 10; i++) {
      tb.recordOutcome("math_echo", "math", true);
      tb.recordOutcome("guess_echo", "math", false);
    }
    var vote = tb.quadraticVote("math", [
      { echoId: "math_echo", answer: "56", confidence: 1.0 },
      { echoId: "guess_echo", answer: "54", confidence: 1.0 }
    ]);
    assertEq(vote.winner, "56", "Reliable math_echo should outvote unreliable guess_echo");

    var tg = new PB.TrajGuard(10);
    assert(tg.step("edit:line1", { code: "v1" }).allow, "Step 1 should pass");
    assert(tg.step("run:test", { code: "v2" }).allow, "Step 2 should pass");
    assert(tg.step("run:test", { code: "v2" }).allow, "Step 3 (first repeat) allowed");
    var halted = tg.step("run:test", { code: "v2" }); // 3rd identical action -> loop!
    assert(!halted.allow && halted.intervene && halted.reason === "action_loop_detected", "StepShield must halt repeated loop");

    /* SWE-Replay branch directly from valid step 1 */
    var br = tg.branchFrom(1);
    assert(br.ok && br.state.code === "v1" && tg.steps === 1, "SWE-Replay branchFrom(1) failed");
    done();
  });

  /* 7. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_paper_boost.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_paper_boost.js", "evelyn_paper_boost_tests.js"];
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
      console.log("\n=== PAPER BOOST SUITE RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN 2026 PAPER BOOST TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
