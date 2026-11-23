/* evelyn_window_engine_tests.js - Automated ES5 Tests for EvelynWindowEngine
   Run in Node.js: node evelyn_window_engine_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_3d.js");
    require("./evelyn_window_engine.js");
  }

  var E3 = root.Evelyn3D;
  var IK = root.EvelynWindowEngine;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. ShortConv1D mixes 4 recent tokens cleanly in constant O(4*D) ops */
  test("ShortConv1D: Computes exact 4-tap causal depthwise convolution on streaming vectors", function (done) {
    var conv = new IK.ShortConv1D(2, [0.5, 0.25, 0.15, 0.10]);
    var out = new Float32Array(2);
    conv.step(new Float32Array([10, 0]), out);
    assert(Math.abs(out[0] - 5.0) < 1e-4, "Tap 0 expected 5.0, got " + out[0]);
    conv.step(new Float32Array([20, 4]), out);
    /* 0.5*20 + 0.25*10 = 12.5; 0.5*4 + 0.25*0 = 2.0 */
    assert(Math.abs(out[0] - 12.5) < 1e-4 && Math.abs(out[1] - 2.0) < 1e-4, "Tap 1 mismatch: " + out[0] + "," + out[1]);
    done();
  });

  /* 2. SlidingWindowRingKV stays constant memory + 5:1 HybridSWAStack savings math */
  test("SlidingWindowRingKV & HybridSWAStack: Constant O(W) ring cap after 500 tokens & ~5x KV savings", function (done) {
    var swa = new IK.SlidingWindowRingKV(4, 16);
    for (var t = 0; t < 500; t++) {
      swa.push(new Float32Array([1, 0, t * 0.01, 0]), new Float32Array([0, 1, 0, t]));
    }
    assertEq(swa.activeCount(), 16, "Ring buffer must stay capped at W=16 even after 500 tokens");
    var att = new Float32Array(4);
    swa.attend(new Float32Array([1, 0, 1, 0]), att);
    assert(isFinite(att[3]) && att[3] > 480, "Attended value should come strictly from latest 16-token window, got " + att[3]);

    var sav = IK.HybridSWAStack.estimateSavings(24, 2048, 64, 6);
    assert(sav.speedupFactor >= 4.5 && sav.kvRamSavedPct >= 78, "Expected ~5x SWA speedup, got " + sav.speedupFactor);
    done();
  });

  /* 3. AttentionResidualLoop preserves cross-pass attention & halts early on convergence */
  test("AttentionResidualLoop: Runs multi-pass gated attention residuals and early-halts on steady states", function (done) {
    var hard = IK.AttentionResidualLoop.run(new Float32Array([1, -1, 0.5, 0.2]), function (h, loop) {
      return new Float32Array([Math.tanh(h[1] + loop), Math.tanh(h[2] - 0.5), Math.tanh(h[3] + 0.8), Math.tanh(h[0])]);
    }, { maxLoops: 3, haltEps: 0.005 });
    assertEq(hard.loopsRun, 3, "Expected all 3 recurrent passes on active transform");
    assert(hard.trace[2].newestWeight > 0 && hard.trace[2].newestWeight < 1, "Cross-pass attention weight must blend history");

    var steady = IK.AttentionResidualLoop.run(new Float32Array([0.5, 0.5, 0.5, 0.5]), function (h) {
      return new Float32Array(h);
    }, { maxLoops: 4, haltEps: 0.01 });
    assert(steady.haltedEarly && steady.loopsRun === 1, "Fixed-point state should halt at loop 1");
    done();
  });

  /* 4. Visual3DInspector catches off-screen camera, clipped edges & approves framed lit 3D cube */
  test("Visual3DInspector: Approves framed lit 3D cube and catches blank/off-screen & clipped cameras", function (done) {
    var ren = new E3.SoftwareRenderer3D(120, 90);
    var cube = E3.makeCube(2);

    /* Case A: Properly framed rotated lit cube -> passes */
    var goodCam = new E3.Camera3D({ z: -7, focalMm: 45 });
    ren.clear(0xFF1C0404);
    ren.drawMesh(cube, { x: 0, y: 0, z: 0, rx: 0.45, ry: 0.65 }, goodCam, [40, 228, 252]);
    var okRep = IK.Visual3DInspector.inspect(ren, 0xFF1C0404);
    assert(okRep.ok && okRep.coverage > 0.05 && okRep.lumSpread > 15, "Good framed cube failed inspector: " + JSON.stringify(okRep));

    /* Case B: Off-screen camera (cube behind camera at z=-20) -> catches OFFSCREEN_OR_BLANK */
    ren.clear(0xFF1C0404);
    ren.drawMesh(cube, { x: 0, y: 0, z: -20, rx: 0.4, ry: 0.4 }, goodCam, [40, 228, 252]);
    var blankRep = IK.Visual3DInspector.inspect(ren, 0xFF1C0404);
    assert(!blankRep.ok && blankRep.issues.indexOf("OFFSCREEN_OR_BLANK") >= 0, "Missed blank/off-screen camera");

    /* Case C: Camera way too close (z=-2.2) -> catches edge clipping or inside mesh */
    var closeCam = new E3.Camera3D({ z: -2.2, focalMm: 50 });
    ren.clear(0xFF1C0404);
    ren.drawMesh(cube, { x: 0, y: 0, z: 0, rx: 0.3, ry: 0.5 }, closeCam, [40, 228, 252]);
    var closeRep = IK.Visual3DInspector.inspect(ren, 0xFF1C0404);
    assert(!closeRep.ok && (closeRep.issues.indexOf("FRAME_EDGE_CLIP") >= 0 || closeRep.issues.indexOf("CAMERA_INSIDE_MESH") >= 0),
      "Too-close camera should trigger clip/inside issue");
    done();
  });

  /* 5. PrecisionPolicy & Adaptive ReasoningBudget */
  test("Policy: Pins high KV precision + 4 loops + Y-up header for 3D builds and drops to 1 loop for quick edits", function (done) {
    var build3D = IK.Policy.chooseConfig("three.js 3D shader scene", false);
    var quickEdit = IK.Policy.chooseConfig("three.js 3D shader scene", true);
    var proseTask = IK.Policy.chooseConfig("geography quiz", false);

    assertEq(build3D.kvPrecision, "FP32_OR_BF16_SAFE", "3D tasks must protect KV precision");
    assertEq(build3D.recurrentLoops, 4, "Initial 3D build should get 4 recurrent loops");
    assert(build3D.pinnedHeader.indexOf("Y-up") >= 0, "3D tasks must pin Y-up coordinate spec");
    assertEq(quickEdit.recurrentLoops, 1, "Small follow-up edit should drop to 1 fast loop");
    assertEq(proseTask.weightPrecision, "BITNET_I2S", "Non-3D prose tasks can use ultra-fast BitNet I2S");
    done();
  });

  /* 6. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_window_engine.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_window_engine.js", "evelyn_window_engine_tests.js"];
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
      console.log("\n=== WINDOW ENGINE RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN WINDOW ENGINE (5:1 SWA, SHORTCONV, ATTN RESIDUALS & 3D VISUAL INSPECTOR) TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
