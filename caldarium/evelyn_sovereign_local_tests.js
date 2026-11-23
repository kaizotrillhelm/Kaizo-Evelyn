/* evelyn_sovereign_local_tests.js - Automated ES5 Tests for EvelynSovereign
   Run in Node.js: node evelyn_sovereign_local_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_sentinel.js");
    require("./evelyn_sovereign_local.js");
  }

  var Sov = root.EvelynSovereign;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. RuntimeBenchSelector filters buggy engines and picks fastest valid kernel */
  test("RuntimeBenchSelector: Rejects inaccurate kernel and selects fastest valid engine", function (done) {
    var pick = Sov.RuntimeBenchSelector.pickFastest([
      { id: "broken_fast", run: function (x) { return x * 3; } }, // wrong math!
      { id: "slow_exact",  run: function (x) { var s = 0; for (var i = 0; i < 400; i++) s += i; return x * 2 + (s - s); } },
      { id: "fast_exact",  run: function (x) { return x * 2; } }
    ], 21, 150, 42);
    assert(pick.ok && pick.winner === "fast_exact", "Expected fast_exact winner, got " + pick.winner);
    done();
  });

  /* 2. LanLayerPool splits 12 layers across 3 heterogeneous cheap devices + INT8 wire hops */
  test("LanLayerPool: Partitions layers across old LAN devices, handles dropout & quantizes hops", function (done) {
    var peers = [
      { id: "old_laptop_1", freeRamMB: 1024, alive: true },
      { id: "budget_phone", freeRamMB: 512,  alive: true },
      { id: "pi_zero",      freeRamMB: 512,  alive: true },
      { id: "dead_tablet",  freeRamMB: 2048, alive: false }
    ];
    var part = Sov.LanLayerPool.partitionLayers(12, peers);
    assert(part.ok && part.shards.length === 3, "Expected 3 active peer shards (dead_tablet skipped)");
    assertEq(part.shards[0].startLayer, 0, "First shard must start at layer 0");
    assertEq(part.shards[2].endLayer, 12, "Last shard must end at layer 12");
    assert(part.shards[0].layerCount >= part.shards[1].layerCount, "Bigger-RAM peer should hold >= layers");

    /* Run pipeline pass on 96-wide vector -> 2 LAN hops * (96 + 4) = 200 wire bytes total */
    var v0 = new Float32Array(96); v0[0] = 1.0;
    var pipe = Sov.LanLayerPool.runPipeline(v0, part.shards, function (vec) {
      var nx = new Float32Array(vec.length);
      for (var i = 0; i < vec.length; i++) nx[i] = vec[i] + 0.1;
      return nx;
    });
    assertEq(pipe.hops, 2, "Expected 2 inter-device hops across 3 shards");
    assertEq(pipe.totalWireBytes, 200, "Expected 200 bytes total across 2 INT8 quantized hops");
    assert(Math.abs(pipe.output[0] - 2.2) < 0.08, "Pipeline activation sum drifted: " + pipe.output[0]);
    done();
  });

  /* 3. PrivacyRedactor enforces hard air-gapped lockout AND reversible PII scrubbing on hybrid route */
  test("PrivacyRedactor: Enforces air-gapped lockout and reversibly scrubs names, emails, phones & keys", function (done) {
    var airgapped = new Sov.PrivacyRedactor({ airgappedOnly: true, privateNames: ["Maya"] });
    var rLocal = airgapped.prepareRoute("Maya needs help with 3D code", "hard_frontier");
    assertEq(rLocal.destination, "local", "Air-gapped mode must never route externally");

    var hybrid = new Sov.PrivacyRedactor({ airgappedOnly: false, privateNames: ["Maya", "Kowalski"] });
    var raw = "Maya Kowalski (maya@home.org, 555-234-5678) has key sk-1234567890abcd.";
    var routed = hybrid.prepareRoute(raw, "hard_frontier");
    assertEq(routed.destination, "optional_cloud_scrubbed", "Hybrid hard task should route scrubbed");
    assert(routed.payload.indexOf("Maya") < 0 && routed.payload.indexOf("maya@home.org") < 0 &&
           routed.payload.indexOf("555-234-5678") < 0 && routed.payload.indexOf("sk-1234567890abcd") < 0,
      "Private PII leaked into outbound payload: " + routed.payload);

    var restored = hybrid.restore("Fixed code for " + routed.payload, routed.revMap);
    assert(restored.indexOf("Maya Kowalski") >= 0 && restored.indexOf("555-234-5678") >= 0, "Local restore failed: " + restored);
    done();
  });

  /* 4. SovereignManifest detects silent upstream weight changes + LocalTranscriptPipe cleans speech text */
  test("SovereignManifest & LocalTranscriptPipe: Detects 1-byte silent change and cleans speech transcripts", function (done) {
    var man = new Sov.SovereignManifest();
    var weights = new Uint8Array([10, 20, 30, 40, 50]);
    man.pin("TINY.BIN", weights, "2.1.0");
    assert(man.verify("TINY.BIN", weights).ok, "Intact weights must verify");

    var silentlyChanged = new Uint8Array([10, 20, 31, 40, 50]);
    assert(!man.verify("TINY.BIN", silentlyChanged).ok, "1-byte silent modification must be caught");

    var clean = Sov.LocalTranscriptPipe.cleanTranscript("[BLANK_AUDIO] um, water boils at, uh, 100 degrees C. [NOISE]");
    assertEq(clean, "Water boils at, 100 degrees C.", "Speech transcript cleanup mismatch: " + clean);
    done();
  });

  /* 5. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_sovereign_local.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_sovereign_local.js", "evelyn_sovereign_local_tests.js"];
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
      console.log("\n=== SOVEREIGN LOCAL AI RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN SOVEREIGN LOCAL AI & MULTI-DEVICE POOL TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
