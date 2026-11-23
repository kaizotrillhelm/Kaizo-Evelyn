/* evelyn_late2026_tests.js - Automated ES5 Tests for EvelynLate2026
   Run in Node.js: node evelyn_late2026_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) require("./evelyn_late2026_core.js");

  var L26 = root.EvelynLate2026;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Mid-task steerability without resetting earlier completed steps */
  test("SteerablePlanner: Applies mid-task constraint pivot while preserving completed step outputs", function (done) {
    var plan = new L26.SteerablePlanner([
      { id: "load", run: function () { return 42; } },
      { id: "format", run: function (ctx, cons) { return cons.indexOf("use_12hr") >= 0 ? (ctx.load + " @ 5:07 PM") : String(ctx.load); } }
    ], ["offline_only"]);

    var s1 = plan.stepNext();
    assertEq(s1.value, 42, "Step 1 failed");
    plan.interrupt("use_12hr"); // Mid-task user correction!
    var s2 = plan.stepNext();
    assert(s2.done && s2.value === "42 @ 5:07 PM" && plan.outputs.load === 42, "Mid-task steer failed: " + s2.value);
    done();
  });

  /* 2. 3D Pose-indexed spatial memory survives eviction + Dynamic Resolution Scaling */
  test("SpatialWorldCache & DRS: Anchor rooms survive eviction and frustum query finds room on pan-back", function (done) {
    var wc = new L26.SpatialWorldCache(3, 4);
    wc.storePose("camp_well", 10, 0, 0, 0, { water: "clean" }, true); // Anchor at +X
    /* Push 10 transient frames far away to overflow recent buffer */
    for (var i = 0; i < 10; i++) wc.storePose("tmp_" + i, -30, 0, i, 3.14, {}, false);

    /* Pan camera back to face +X (yaw = 0) -> anchor room is still recalled cleanly */
    var hits = wc.queryFrustum(0, 0, 0, 0, 0.5, 25);
    assert(hits.length === 1 && hits[0].id === "camp_well" && hits[0].state.water === "clean", "Spatial anchor lost on pan-back");

    var stillRes = L26.DynamicResScaler.compute(160, 120, 0.05);
    var turnRes = L26.DynamicResScaler.compute(160, 120, 2.2);
    assert(stillRes.width === 160 && turnRes.width < 120 && (turnRes.width % 4) === 0, "DRS scaling mismatch");
    done();
  });

  /* 3. Prosody stage-direction parser drives acoustics & portrait jaw envelope */
  test("ProsodyDirector: Maps plain-English acting directions to acoustics and vowel mouth envelope", function (done) {
    var wh = L26.ProsodyDirector.direct("whispered nervously", "check dial");
    var ex = L26.ProsodyDirector.direct("excited bright", "we won!");
    assert(wh.acoustics.volume < 0.5 && wh.acoustics.rate > 1.1, "Whispered nervous acoustics mismatch");
    assert(ex.acoustics.mood === "happy" && ex.acoustics.volume > 0.9, "Excited acoustics mismatch");
    assertEq(wh.mouthEnvelope.length, "check dial".length, "Envelope length mismatch");
    done();
  });

  /* 4. Spec satisfiability, Vericoding exhaustive prover & OpenSpec boundary contract */
  test("SpecBoundaryGuard: Catches UNSAT specs, proves invariants exhaustively & enforces OpenSpec contracts", function (done) {
    /* Valid sled weight spec: rider(50..70) + frame(20..35) == 92 */
    var sat = L26.SpecBoundaryGuard.checkSpecSat(
      [{ name: "rider", min: 50, max: 70, step: 2 }, { name: "frame", min: 20, max: 35, step: 1 }],
      function (v) { return v.rider + v.frame === 92; }
    );
    assert(sat.satisfiable && sat.witness.rider + sat.witness.frame === 92, "Valid sled spec must be SAT");

    /* Contradictory spec: x > 10 AND x < 5 -> caught BEFORE coding */
    var unsat = L26.SpecBoundaryGuard.checkSpecSat([{ name: "x", min: 0, max: 20, step: 1 }], function (v) { return v.x > 10 && v.x < 5; });
    assert(!unsat.satisfiable, "Contradictory spec must return UNSAT");

    /* Exhaustive Vericoding proof on clampPwm over [-150..150] */
    var dom = []; for (var x = -150; x <= 150; x++) dom.push(x);
    var proof = L26.SpecBoundaryGuard.proveInvariant(
      function (v) { return Math.max(-70, Math.min(70, v)); },
      dom,
      function (inp, out) { return out >= -70 && out <= 70; }
    );
    assert(proof.proven && proof.checked === 301, "Exhaustive clamp invariant should prove over all 301 inputs");

    /* OpenSpec boundary check */
    var cBad = L26.SpecBoundaryGuard.verifyContract(
      { allowedFiles: ["game.js"], lockedSymbols: ["guardMessage"] },
      ["game.js", "evelyn_charter.js"], ["guardMessage"]
    );
    assert(!cBad.ok && cBad.violations.length === 2, "Boundary contract must reject unauthorized file and locked symbol");
    done();
  });

  /* 5. LEASH Lease-Enforced Safety Harness for physical actuators */
  test("LEASHGovernor: Enforces lease expiration, scope match, revocation & deterministic sensor commit gate", function (done) {
    var leash = new L26.LEASHGovernor();
    var ls = leash.issueLease("rover_echo", "DRIVE", 400, 1000);
    assert(leash.commitAction(ls.id, "DRIVE", function () { return true; }, 1200).allowed, "Valid lease + clear sensor gate should commit");
    assert(!leash.commitAction(ls.id, "DRIVE", function () { return false; }, 1250).allowed, "Failed sensor gate must block commit");
    assert(!leash.commitAction(ls.id, "FLASH_MCU", function () { return true; }, 1260).allowed, "Wrong op scope must block");
    assert(!leash.commitAction(ls.id, "DRIVE", function () { return true; }, 1500).allowed, "Expired lease (>1400ms) must block");
    done();
  });

  /* 6. Parallel Worktrees + Temporal Repo Graph + Surgical Feature Ablation + MCP/A2A Bus */
  test("WorktreePool, SurgicalFeatureEditor & AgentMessageBus: Races worktrees, ablates feature orthogonally & routes RPC", function (done) {
    var pool = new L26.WorktreePool({ "math.js": "function dbl(x){return x+1;}" });
    pool.recordSafeguardNote("math.js", "dbl", "Keep finite number guard for DOS");
    assertEq(pool.lookupSafeguards("math.js", "dbl").length, 1, "Temporal safeguard note missing");

    var raced = pool.raceCandidates([
      { id: "cand_bad", file: "math.js", content: "function dbl(x){return x-1;}" },
      { id: "cand_good", file: "math.js", content: "function dbl(x){return x*2;}" }
    ], function (wt) {
      return wt["math.js"].indexOf("x*2") >= 0 ? { ok: true, score: 100 } : { ok: false, score: 0 };
    });
    assert(raced.ok && raced.winner === "cand_good" && pool.base["math.js"].indexOf("x*2") >= 0, "Worktree race merge failed");

    /* Orthogonal feature ablation leaves exactly 0 projection along removed direction */
    var h = new Float32Array([2.0, 3.0, -1.0, 4.0]);
    var badDir = new Float32Array([1.0, 1.0, 0.0, 0.0]);
    var ab = L26.SurgicalFeatureEditor.ablateFeature(h, badDir);
    var u = L26.SurgicalFeatureEditor.normalize(badDir), residualDot = 0;
    for (var i = 0; i < 4; i++) residualDot += ab.state[i] * u[i];
    assert(Math.abs(residualDot) < 1e-5, "Orthogonal feature ablation left residual: " + residualDot);

    /* Local MCP + A2A bus */
    var bus = new L26.AgentMessageBus();
    bus.registerTool("sum", "Add a+b", function (a) { return a.x + a.y; });
    bus.registerAgent("obd_echo", ["obd2", "repair"], function (t) { return "Checked " + t.code; });
    assertEq(bus.rpc({ method: "tools/call", params: { name: "sum", args: { x: 8, y: 9 } } }).result, 17, "MCP tool call failed");
    var disc = bus.rpc({ method: "a2a/discover", params: { capability: "obd2" } });
    assertEq(disc.result[0].id, "obd_echo", "A2A discovery failed");
    assertEq(bus.rpc({ method: "a2a/delegate", params: { agentId: "obd_echo", task: { code: "P0300" } } }).result, "Checked P0300", "A2A delegate failed");
    done();
  });

  /* 7. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_late2026_core.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_late2026_core.js", "evelyn_late2026_tests.js"];
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
      console.log("\n=== LATE-2026 ADAPTATIONS RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN LATE-2026 ARCHITECTURAL ADAPTATIONS TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
