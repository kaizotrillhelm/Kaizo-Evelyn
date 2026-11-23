/* evelyn_hybrid_rag_tests.js - Automated ES5 Tests for EvelynHybridRAG
   Run in Node.js: node evelyn_hybrid_rag_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_sentinel.js");
    require("./evelyn_hybrid_rag.js");
  }

  var R = root.EvelynHybridRAG;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. AST-boundary chunking & compact Repo Map */
  test("Chunker & RepoMap: Splits intact functions without cutting bodies and builds compact Repo Map", function (done) {
    var jsFile = [
      "function calcTotalPrice(qty, unit) {",
      "  return qty * unit;",
      "}",
      "",
      "function formatClock12(mins) {",
      "  return (mins % 12) + ':00 AM';",
      "}"
    ].join("\n");
    var res = R.chunkCodeByFunctions(jsFile, "shop.js");
    assertEq(res.chunks.length, 2, "Expected 2 intact function chunks");
    assertEq(res.chunks[0].id, "shop.js:calcTotalPrice", "Chunk 0 ID mismatch");
    assert(res.chunks[0].text.indexOf("return qty * unit;") >= 0, "Function body truncated");
    assert(res.repoMapLine.indexOf("calcTotalPrice(qty, unit)") >= 0 && res.repoMapLine.indexOf("formatClock12(mins)") >= 0, "Repo Map missing signatures");
    assert(res.repoMapLine.length < jsFile.length, "Repo Map should be shorter than full file");
    done();
  });

  /* 2. Exact 32-bit popcount and 16-byte binary vector similarity */
  test("BinaryVectors: Exact popcount32, 16-byte storage per chunk, and higher similarity for related text", function (done) {
    assertEq(R.popcount32(0), 0, "popcount(0)");
    assertEq(R.popcount32(0xFFFFFFFF), 32, "popcount(0xFFFFFFFF)");
    assertEq(R.popcount32(0x0F0F0F0F), 16, "popcount(0x0F0F0F0F)");

    var v1 = R.embedBinary128("function boilWaterTemp() { return 100; }");
    var v2 = R.embedBinary128("water boiling temperature celsius 100");
    var v3 = R.embedBinary128("play marimba staircase music chords");
    assertEq(v1.byteLength, 16, "128-bit binary embedding must be exactly 16 bytes");
    var simClose = R.binarySimilarity(v1, v2);
    var simFar = R.binarySimilarity(v1, v3);
    assert(simClose > simFar, "Related boiling-water chunks should score closer (" + simClose.toFixed(2) + " vs " + simFar.toFixed(2) + ")");
    done();
  });

  /* 3. Hybrid BM25 + Binary Vector RRF search + Incremental CRC32 file cache */
  test("HybridRAGStore: RRF finds exact camelCase symbols & skips unchanged files via CRC32 cache", function (done) {
    var store = new R.HybridRAGStore();
    var fileA = [
      "function computeOrbitalSpeed(radius, mass) {",
      "  return Math.sqrt(mass / radius);",
      "}",
      "function purifyCampWater(altitudeFt) {",
      "  return altitudeFt > 6500 ? 3 : 1;",
      "}"
    ].join("\n");
    var fileB = "function drawLaserBeam(ctx, x, y) { ctx.fillRect(x, y, 4, 12); }";

    var idx1 = store.indexCodeFile("physics.js", fileA);
    assert(idx1.reindexed && idx1.chunks === 2, "First index should chunk physics.js into 2 functions");
    store.indexCodeFile("render.js", fileB);

    /* Re-indexing unchanged physics.js must skip in 0 ms via CRC32 */
    var idxSkip = store.indexCodeFile("physics.js", fileA);
    assert(!idxSkip.reindexed && store.stats.skippedUnchanged === 1, "Unchanged file should skip re-indexing");

    /* Query using natural words ("purify water altitude") finds purifyCampWater via BM25+Vec RRF */
    var hits = store.searchHybrid("how long purify water at high altitude", 2);
    assert(hits.length >= 1 && hits[0].id === "physics.js:purifyCampWater", "Hybrid RRF top hit mismatch: " + (hits[0] ? hits[0].id : "none"));

    /* Prompt builder respects maxChars budget and attaches citations */
    var built = store.buildRAGPrompt("how long purify water at high altitude", 320, 2);
    assert(built.prompt.length <= 360, "RAG prompt exceeded budget: " + built.prompt.length);
    assert(built.citations.indexOf("physics.js:purifyCampWater") >= 0, "RAG prompt missing citation");
    done();
  });

  /* 4. Bounded 3-Step Edit -> Test -> Repair Loop */
  test("RepairLoopController: Converges from test error feedback and enforces hard maxAttempts cap", function (done) {
    var buggy = "function doubleIt(x) { return x + 1; }";
    var res = R.RepairLoopController.run(
      buggy,
      function (code) {
        return code.indexOf("x * 2") >= 0 ? { ok: true } : { ok: false, error: "Expected doubleIt(5)=10, got 6" };
      },
      function (code, err) {
        if (err.indexOf("doubleIt(5)=10") >= 0) return code.replace("x + 1", "x * 2");
        return code;
      },
      3
    );
    assert(res.ok && res.attempts === 2, "Repair loop should fix bug on attempt 2, got " + res.attempts);

    /* Unfixable bug must halt cleanly at maxAttempts = 3 */
    var hard = R.RepairLoopController.run("broken", function () { return { ok: false, error: "still fails" }; }, function (c) { return c; }, 3);
    assert(!hard.ok && hard.attempts === 3, "Unfixable repair loop must stop at cap 3");
    done();
  });

  /* 5. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_hybrid_rag.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_hybrid_rag.js", "evelyn_hybrid_rag_tests.js"];
      var banned = [[/\bArray\.from\s*\(/, "Array.from"], [/\bnew\s+Map\s*\(/, "Map"], [/\bnew\s+Set\s*\(/, "Set"], [new RegExp("[\\w$)]\\s*=" + ">"), "arrow"], [/\(\?</, "lookbehind"]];
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
      console.log("\n=== HYBRID RAG & REPAIR LOOP RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN HYBRID RAG (BM25 + 16-BYTE VECTORS + RRF) TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
