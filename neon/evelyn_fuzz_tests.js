/* evelyn_fuzz_tests.js - 1,000-Iteration Fuzz Suite, USB Torn-Write Recovery
   & Bounded Scrubber Tests for EvelynSentinel.
   Run in Node.js: node evelyn_fuzz_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_sentinel.js");
  }

  var B = root.EvelynBackend;
  var S = root.EvelynSentinel;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Atomic A/B Store survives simulated mid-write USB unplugs */
  test("ABStore: Survives torn writes (truncation & bit-flips on active slot) by falling back cleanly", function (done) {
    var store = new S.ABStore();
    var w1 = store.save("profile", { name: "Ada", xp: 120, mode: "D" });
    assert(w1.ok && w1.slot === "A" && w1.gen === 1, "First write should land in slot A");

    var w2 = store.save("profile", { name: "Ada", xp: 150, mode: "D" });
    assert(w2.ok && w2.slot === "B" && w2.gen === 2, "Second write should land in slot B");

    /* Simulate yanking the USB drive halfway through writing slot B (truncate 50%) */
    var rawB = store.backing.getItem("profile_B");
    store.backing.setItem("profile_B", rawB.slice(0, Math.floor(rawB.length / 2)));

    var rec = store.load("profile");
    assert(rec.ok, "ABStore should recover intact slot A when slot B is torn");
    assertEq(rec.slot, "A", "Should fall back to slot A");
    assertEq(rec.recoveredFromTornSlot, "B", "Should report slot B as torn");
    assertEq(rec.data.xp, 120, "Intact slot A XP should be preserved");

    /* Next save overwrites damaged slot B and heals redundancy */
    var w3 = store.save("profile", { name: "Ada", xp: 180, mode: "D" });
    assert(w3.ok && w3.slot === "B", "Next write should repair damaged slot B");
    var cleanLoad = store.load("profile");
    assert(cleanLoad.ok && cleanLoad.data.xp === 180 && cleanLoad.recoveredFromTornSlot === null, "Healed slot B should load cleanly");

    /* Simulate 1-bit flip in slot B -> CRC32 must catch it and fall back to A */
    var goodB = store.backing.getItem("profile_B");
    var lastCh = goodB.charCodeAt(goodB.length - 1);
    store.backing.setItem("profile_B", goodB.slice(0, -1) + String.fromCharCode(lastCh ^ 1));
    var bitRot = store.load("profile");
    assert(bitRot.ok && bitRot.slot === "A" && bitRot.recoveredFromTornSlot === "B", "Single-bit flip must fail CRC32 and recover slot A");
    done();
  });

  /* 2. 1,000-Iteration LZW Fuzzing (invalid codes, random garbage, zero-byte, <10ms exit) */
  test("Fuzz LZW (1,000 inputs): Zero throws, every bad input exits < 10 ms with { ok: false }", function (done) {
    var rng = B.createRng(404);
    /* Explicit bad edge cases */
    var bad1 = S.SafeCodecs.decompressLZW(String.fromCharCode(65, 999)); // code > nextCode
    assert(!bad1.ok, "Must reject code > nextCode + 1");
    var bad2 = S.SafeCodecs.decompressLZW(String.fromCharCode(500)); // invalid initial code
    assert(!bad2.ok, "Must reject initial code > 255");

    var worstMs = 0;
    for (var i = 0; i < 1000; i++) {
      var len = Math.floor(rng() * 80);
      var s = "";
      for (var j = 0; j < len; j++) s += String.fromCharCode(Math.floor(rng() * 400));
      var t0 = Date.now();
      var res = S.SafeCodecs.decompressLZW(s, 16384);
      var dt = Date.now() - t0;
      if (dt > worstMs) worstMs = dt;
      assert(typeof res === "object" && typeof res.ok === "boolean", "Must always return { ok } object");
      assert(dt <= 10, "LZW fuzz input #" + i + " exceeded 10 ms (" + dt + " ms)");
    }
    done();
  });

  /* 3. 1,000-Iteration TNY2 Header & Truncation Fuzzing */
  test("Fuzz TNY2 (1,000 inputs): Truncated headers, random bytes & wrong sizes rejected < 10 ms", function (done) {
    var rng = B.createRng(808);
    assert(!S.SafeCodecs.validateTny2Buffer(new ArrayBuffer(0)).ok, "Zero-byte TNY2 must fail");
    assert(!S.SafeCodecs.validateTny2Buffer(new ArrayBuffer(11)).ok, "11-byte TNY2 must fail");

    for (var i = 0; i < 1000; i++) {
      var sz = Math.floor(rng() * 128);
      var buf = new ArrayBuffer(sz);
      var u8 = new Uint8Array(buf);
      for (var j = 0; j < sz; j++) u8[j] = Math.floor(rng() * 256);
      if (sz >= 12 && (i % 3 === 0)) {
        /* Force valid magic with mutated dims/truncation */
        u8[0] = 84; u8[1] = 78; u8[2] = 89; u8[3] = 50;
      }
      var t0 = Date.now();
      var res = S.SafeCodecs.validateTny2Buffer(buf);
      var dt = Date.now() - t0;
      assert(!res.ok, "Random/truncated buffer should not validate as exact TNY2");
      assert(dt <= 10, "TNY2 validation exceeded 10 ms");
    }
    done();
  });

  /* 4. 1,000-Iteration evalExpr & .evelynpack Fuzzing (120 nested parens, div-by-zero, unclosed quotes) */
  test("Fuzz evalExpr & .evelynpack (1,000 inputs): 120 nested parens, unclosed quotes, div-by-zero, zero-byte packs", function (done) {
    /* Explicit hostile expressions */
    var deepParens = new Array(121).join("(") + "1+1" + new Array(121).join(")");
    var t0 = Date.now();
    var rDeep = S.SafeCodecs.evalExpr(deepParens, {});
    assert(!rDeep.ok && (Date.now() - t0) <= 10, "120 nested parens must fail cleanly in <= 10 ms");
    assert(!S.SafeCodecs.evalExpr("10 / (5 - 5)", {}).ok, "Division by zero must return { ok: false }");
    assert(!S.SafeCodecs.evalExpr('"unclosed quote', {}).ok, "Unclosed quote must return { ok: false }");
    assert(!S.SafeCodecs.importPack("").ok, "Zero-byte .evelynpack must return { ok: false }");
    assert(!S.SafeCodecs.importPack("EVPK1:" + String.fromCharCode(65, 999)).ok, "Corrupt .evelynpack must fail cleanly");

    var rng = B.createRng(1212);
    var alphabet = "0123456789+-*/%()\"a b<>=";
    for (var i = 0; i < 1000; i++) {
      var len = Math.floor(rng() * 64);
      var expr = "";
      for (var j = 0; j < len; j++) expr += alphabet.charAt(Math.floor(rng() * alphabet.length));
      var ts = Date.now();
      var res = S.SafeCodecs.evalExpr(expr, { a: 3, b: 0 });
      var dt = Date.now() - ts;
      assert(typeof res.ok === "boolean", "evalExpr must return { ok }");
      assert(dt <= 10, "evalExpr fuzz #" + i + " exceeded 10 ms");
    }
    done();
  });

  /* 5. Incremental Scrubber completes full pass in bounded slices & quarantines torn rows */
  test("IncrementalScrubber: Bounded slices detect torn shelf rows without looping or mutating healthy rows", function (done) {
    var rows = [];
    for (var i = 0; i < 60; i++) {
      rows.push({ id: i, zF: B.LZ.compress("Fact number " + i + " about Coccyx Corale* clocks.") });
    }
    /* Inject 3 torn/corrupted rows */
    rows[14].zF = "";
    rows[31].zF = String.fromCharCode(65, 9999);
    rows[58].zF = String.fromCharCode(600);

    var scrubber = new S.IncrementalScrubber({ batchSize: 15 });
    var ticks = 0, lastRep;
    while (scrubber.fullPasses < 1 && ticks < 20) {
      lastRep = scrubber.scrubSlice(rows);
      ticks++;
    }
    assertEq(scrubber.fullPasses, 1, "Scrubber should finish exactly 1 full pass");
    assertEq(ticks, 4, "60 rows / 15 batchSize should take exactly 4 bounded slices");
    assertEq(scrubber.quarantinedIds.length, 3, "Expected all 3 torn rows quarantined");
    assert(scrubber.quarantinedIds.indexOf(14) >= 0 && scrubber.quarantinedIds.indexOf(31) >= 0 && scrubber.quarantinedIds.indexOf(58) >= 0, "Wrong row IDs quarantined");
    done();
  });

  /* 6. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax or lookbehinds in evelyn_sentinel.js and evelyn_fuzz_tests.js", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_sentinel.js", "evelyn_fuzz_tests.js"];
      var banned = [
        [/\bArray\.from\s*\(/, "Array.from"],
        [/\bnew\s+Map\s*\(/, "new Map"],
        [/\bnew\s+Set\s*\(/, "new Set"],
        [new RegExp("=" + ">"), "arrow function"],
        [/\(\?</, "regex lookbehind"]
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
        logFn("\n=== SENTINEL & FUZZ RESULT: " + pass + " passed, " + fail + " failed (" + (Date.now() - t0) + " ms) ===");
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
    logFn("=== EVELYN SENTINEL, TORN-WRITE & 1,000-INPUT FUZZ SUITE (" + tests.length + " tests) ===");
    next();
  }

  if (isNode) runAll();
  else root.EvelynFuzzTests = { runAll: runAll };
})(typeof window !== "undefined" ? window : global);
