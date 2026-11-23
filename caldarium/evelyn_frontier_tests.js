/* evelyn_frontier_tests.js - Automated Verification Suite for All 7 Frontier AI Features
   Run in Node.js: node evelyn_frontier_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_frontier.js");
  }

  var B = root.EvelynBackend;
  var F = root.EvelynFrontier;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. BitNet b1.58 / I2_S ternary packing & multiplication-free matvec */
  test("TernaryPacked: 4x compression vs INT8, exact ternary unpack, zero inner-loop multiplies & cosine fidelity", function (done) {
    var rng = B.createRng(2026);
    var rows = 64, cols = 96;
    var wFloat = new Float32Array(rows * cols);
    var x = new Float32Array(cols);
    var i, r, c;
    for (i = 0; i < wFloat.length; i++) wFloat[i] = (rng() * 2 - 1) * 1.2;
    for (i = 0; i < cols; i++) x[i] = rng() * 2 - 1;

    var packed = F.TernaryPacked.packTernary(wFloat, rows, cols);
    assert(packed.stats.compressionVsInt8 > 3.9, "Expected ~4x compression vs INT8, got " + packed.stats.compressionVsInt8);
    assert(packed.stats.sparsity > 0.15, "Expected real ternary zeros in sparsity");

    var unpacked = F.TernaryPacked.unpackTernary(packed);
    for (i = 0; i < unpacked.length; i++) {
      assert(unpacked[i] === -1 || unpacked[i] === 0 || unpacked[i] === 1, "Invalid ternary weight at " + i);
    }

    var yTernary = new Float32Array(rows);
    var yRef = new Float32Array(rows);
    var opReport = F.TernaryPacked.matvecTernary(packed, x, yTernary);
    assertEq(opReport.mulOpsInLoop, 0, "Inner ternary loop must execute zero multiplications");
    assert(opReport.skippedZeros > 0, "Ternary matvec should skip zero weights");

    /* Compare cosine similarity against full float32 reference matvec */
    var dot = 0, n1 = 0, n2 = 0;
    for (r = 0; r < rows; r++) {
      var acc = 0;
      for (c = 0; c < cols; c++) acc += wFloat[r * cols + c] * x[c];
      yRef[r] = acc;
      dot += yRef[r] * yTernary[r];
      n1 += yRef[r] * yRef[r];
      n2 += yTernary[r] * yTernary[r];
    }
    var cosSim = dot / Math.sqrt(n1 * n2);
    assert(cosSim > 0.85, "Ternary matvec cosine similarity too low: " + cosSim.toFixed(3));
    done();
  });

  /* 2. Titans Test-Time Surprise Memory + Nested Learning / Sleep Consolidation */
  test("ContinuumMemory: Surprise-driven test-time learning, surprise drop on repeat, and Sleep consolidation", function (done) {
    var mem = new F.ContinuumMemory(32);

    /* First exposure to surprising new facts */
    var obs1 = mem.observe("capital of estonia", "tallinn");
    var obs2 = mem.observe("last gondola corale", "5:07 PM");
    var obs3 = mem.observe("frostgate elevation", "17,500 ft");
    assert(obs1.surprise > 0.1, "Novel fact should yield positive surprise");

    /* Repeat the same fact: surprise should fall as fastM has adapted at test time */
    var obs1Again = mem.observe("capital of estonia", "tallinn");
    assert(obs1Again.surprise < obs1.surprise, "Repeated fact should produce lower surprise (" + obs1Again.surprise + " vs " + obs1.surprise + ")");

    /* Recall immediately from test-time fast weights */
    var r1 = mem.recall("capital of estonia");
    var r2 = mem.recall("last gondola corale");
    assert(r1 && r1.val === "tallinn", "Failed to recall Estonia capital from fastM");
    assert(r2 && r2.val === "5:07 PM", "Failed to recall 5:07 PM gondola from fastM");

    /* Sleep consolidation moves fastM -> slowM and preserves prior memories when a new fact arrives */
    var sleepRep = mem.sleepConsolidate(0.7);
    assert(sleepRep.slowNorm > 0 && sleepRep.fastNorm < obs3.updatedFastNorm, "Sleep should transfer norm to slowM");
    mem.observe("pyramid u close", "12:00 PM");

    var r1After = mem.recall("capital of estonia");
    var rNew = mem.recall("pyramid u close");
    assert(r1After && r1After.val === "tallinn" && r1After.consolidated, "Sleep-consolidated fact should survive new learning");
    assert(rNew && rNew.val === "12:00 PM", "New fact should recall cleanly alongside consolidated slowM");
    done();
  });

  /* 3. Looped / Recurrent-Depth Reasoner with Adaptive Halting */
  test("LoopedReasoner: Early-halts on easy convergent state and uses extra depth on hard state", function (done) {
    /* Contractive block representing an easy token that converges quickly */
    var easyBlock = function (h) {
      var out = new Float32Array(h.length);
      for (var i = 0; i < h.length; i++) out[i] = h[i] * 0.99;
      return out;
    };
    var easyRes = F.LoopedReasoner.run(new Float32Array([0.5, -0.5, 0.25, 0.25]), easyBlock, { maxLoops: 5, haltEps: 0.01 });
    assert(easyRes.haltedEarly && easyRes.loopsRun === 1, "Easy convergent token should early-exit at loop 1, got " + easyRes.loopsRun);

    /* Non-trivial reasoning block that rotates state across passes */
    var hardBlock = function (h, loopIdx) {
      var out = new Float32Array(h.length);
      for (var i = 0; i < h.length; i++) out[i] = Math.tanh(h[(i + 1) % h.length] * 1.4 + 0.2 * (loopIdx + 1));
      return out;
    };
    var hardRes = F.LoopedReasoner.run(new Float32Array([0.1, -0.8, 0.4, 0.9]), hardBlock, { maxLoops: 4, haltEps: 0.005 });
    assertEq(hardRes.loopsRun, 4, "Hard reasoning token should run full 4 recurrent depth passes");
    assertEq(hardRes.trace.length, 4, "Expected 4 trace entries for X-Ray monitor");
    done();
  });

  /* 4. Grammar-Constrained Logit Decoding + forced-token Skip + Anti-Tic Masking + CRANE */
  test("GrammarDecoder: Forces 100% valid 12-hr clocks, skips forced tokens, blocks AI tics, and runs CRANE", function (done) {
    var rng = B.createRng(99);
    function noisyLogits() {
      var arr = new Float32Array(97);
      for (var i = 0; i < 97; i++) arr[i] = rng() * 4 - 2;
      return arr;
    }

    /* Even with completely random logits, clock12 MUST output a valid 12-hour AM/PM clock */
    for (var trial = 0; trial < 15; trial++) {
      var dec = F.GrammarDecoder.decode("clock12", noisyLogits, { maxLen: 10 });
      assert(/^(?:[1-9]|1[0-2]):[0-5][0-9] (?:AM|PM)$/.test(dec.text), "Invalid 12-hour clock emitted: '" + dec.text + "'");
      assert(dec.skippedForcedSteps >= 2, "Expected forced-token fast-forward skips on ':' / ' ' / 'M'");
    }

    /* Shelf citation grammar MUST output [letters#digits] */
    var cite = F.GrammarDecoder.decode("shelfCite", noisyLogits, { maxLen: 16 });
    assert(/^\[[a-z]+#[0-9]+\]$/.test(cite.text), "Invalid shelf citation emitted: '" + cite.text + "'");

    /* Logit-level anti-tic mask blocks 'delve' before sampling even when logits strongly favor 'e' */
    var pref = "Let us delv";
    var mask = F.GrammarDecoder.computeMask(null, pref, ["delve", "not just"]);
    var eTok = "e".charCodeAt(0) - 30;
    assertEq(mask[eTok], 0, "Token 'e' completing banned word 'delve' must be masked to 0");

    /* CRANE two-phase decode: unconstrained scratchpad -> grammar-locked clock answer */
    var crane = F.GrammarDecoder.decodeCRANE(noisyLogits, noisyLogits, "clock12", { scratchLen: 8, answerLen: 10 });
    assert(crane.scratchpad.length > 0, "CRANE scratchpad should generate freely");
    assert(/^(?:[1-9]|1[0-2]):[0-5][0-9] (?:AM|PM)$/.test(crane.answer), "CRANE final answer must satisfy clock12: " + crane.answer);
    done();
  });

  /* 5. HippoRAG-2 Multi-Hop Associative Graph Memory */
  test("GraphMemory: Resolves 2-hop queries across disconnected shelf passages via Personalized PageRank", function (done) {
    var g = new F.GraphMemory();

    /* Passage 1 links Saltsea Arcade Dunes -> Dune Chorus Worm (does NOT mention elements) */
    g.addPassage("place_dunes", "Saltsea Arcade Dunes is home to the Dune Chorus Worm.", "atlas", ["Saltsea Arcade Dunes", "Dune Chorus Worm"]);
    g.addTriple("Dune Chorus Worm", "lives in", "Saltsea Arcade Dunes", "place_dunes");

    /* Passage 2 links Dune Chorus Worm -> plant/spirit/holy (does NOT mention Saltsea Arcade Dunes!) */
    g.addPassage("elem_worm", "Dune Chorus Worm is weak to plant, spirit, and holy.", "creatures", ["Dune Chorus Worm", "plant", "holy"]);
    g.addTriple("Dune Chorus Worm", "weak to", "plant", "elem_worm");
    g.addTriple("Dune Chorus Worm", "weak to", "holy", "elem_worm");

    /* Unrelated distractor passage */
    g.addPassage("elem_squid", "Reef Cathedral Squid lives in Reef Cathedral and absorbs water.", "creatures", ["Reef Cathedral Squid", "Reef Cathedral", "water"]);
    g.addTriple("Reef Cathedral Squid", "lives in", "Reef Cathedral", "elem_squid");

    /* 2-hop query mentions ONLY 'Saltsea Arcade Dunes' and 'weak to' (never names Dune Chorus Worm!) */
    var res = g.queryMultiHop("What is the creature in Saltsea Arcade Dunes weak to?", 3);
    assert(res.passages.length >= 2, "Expected multi-hop passage results");
    var foundElemPassage = false;
    for (var i = 0; i < 2; i++) {
      if (res.passages[i].label === "elem_worm") foundElemPassage = true;
    }
    assert(foundElemPassage, "graph memory PPR failed to retrieve disconnected 2-hop passage 'elem_worm' in top 2");
    done();
  });

  /* 6. Probe-Gated Activation Steering & Persona Vectors */
  test("ActivationSteerer: Computes contrastive vector and probe-gates drift without touching clean states", function (done) {
    var pos = [new Float32Array([1.0, 0.2, -0.8, 0.1]), new Float32Array([0.9, 0.1, -0.7, 0.0])];
    var neg = [new Float32Array([-0.8, -0.1, 0.9, 0.0]), new Float32Array([-0.9, -0.2, 0.8, -0.1])];
    var conciseVec = F.ActivationSteerer.computeVector(pos, neg);
    var verboseProbe = new Float32Array([-conciseVec[0], -conciseVec[1], -conciseVec[2], -conciseVec[3]]);

    /* Clean concise activation -> probe stays low -> NO steering applied */
    var cleanH = new Float32Array([0.8, 0.1, -0.7, 0.0]);
    var rClean = F.ActivationSteerer.probeGatedSteer(cleanH, verboseProbe, conciseVec, { threshold: 0.3 });
    assert(!rClean.steered && rClean.appliedAlpha === 0, "Clean state should not be steered");

    /* Drifting verbose activation -> probe spikes -> steering pulls it back toward concise */
    var driftH = new Float32Array([-0.85, -0.15, 0.85, 0.0]);
    var rDrift = F.ActivationSteerer.probeGatedSteer(driftH, verboseProbe, conciseVec, { threshold: 0.3, kp: 1.0 });
    assert(rDrift.steered && rDrift.probeAfter < rDrift.probeBefore, "Probe-gated steering failed to reduce verbose drift");
    done();
  });

  /* 7. Byte Latent Entropy Patcher (BLT-style dynamic segmentation) */
  test("EntropyPatcher: Merges predictable English into longer patches and isolates high-entropy codes", function (done) {
    var ep = new F.EntropyPatcher();
    var corpus = "";
    for (var i = 0; i < 20; i++) {
      corpus += "what is the capital of france what is the capital of japan what is the capital of peru ";
    }
    ep.train(corpus);

    var predRes = ep.patch("what is the capital of france", 3.0, 8);
    var hardRes = ep.patch("5:07 PM ATL-ENM-001 3/4+1/8", 3.0, 8);
    assert(predRes.compressionFactor > hardRes.compressionFactor,
      "Predictable text should merge into larger patches (" + predRes.compressionFactor.toFixed(2) + " vs " + hardRes.compressionFactor.toFixed(2) + ")");

    var highLoopPatches = 0;
    for (var p = 0; p < hardRes.patches.length; p++) {
      if (hardRes.patches[p].computeLoops >= 3) highLoopPatches++;
    }
    assert(highLoopPatches > 0, "High-entropy payload patches should receive extra recurrent loop budget");
    done();
  });

  /* 8. ES5 Syntax Compatibility Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax blockers in evelyn_frontier.js and evelyn_frontier_tests.js", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_frontier.js", "evelyn_frontier_tests.js"];
      var banned = [
        [/\bArray\.from\s*\(/, "Array.from"],
        [/\bnew\s+Map\s*\(/, "new Map"],
        [/\bnew\s+Set\s*\(/, "new Set"],
        [new RegExp("=" + ">"), "arrow function"],
        [/\(\?</, "ES2018 regex lookbehind"]
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
        logFn("\n=== FRONTIER SUITE RESULT: " + pass + " passed, " + fail + " failed (" + (Date.now() - t0) + " ms) ===");
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
    logFn("=== EVELYN 2025-2026 FRONTIER AI TEST SUITE (" + tests.length + " tests) ===");
    next();
  }

  if (isNode) runAll();
  else root.EvelynFrontierTests = { runAll: runAll };
})(typeof window !== "undefined" ? window : global);
