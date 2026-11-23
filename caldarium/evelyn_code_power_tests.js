/* evelyn_code_power_tests.js - Automated ES5 Tests for EvelynCodePower
   Run in Node.js: node evelyn_code_power_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_sentinel.js");
    require("./evelyn_ast_ide.js");
    require("./evelyn_hybrid_rag.js");
    require("./evelyn_code_power.js");
  }

  var CP = root.EvelynCodePower;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. PatchApplier: exact patch, whitespace-tolerant patch, and automatic AST syntax rollback */
  test("PatchApplier: Applies exact & trimmed hunks cleanly and rolls back syntax-breaking patches", function (done) {
    var src = "function area(w, h) {\n  var out = w + h;\n  return out;\n}";
    var good = CP.PatchApplier.apply(src, "var out = w + h;", "var out = w * h;");
    assert(good.ok && good.code.indexOf("w * h") >= 0, "Exact hunk patch failed");

    /* Whitespace-tolerant match when indentation differs */
    var trimmed = CP.PatchApplier.apply(src, "var out = w + h;\nreturn out;", "  var out = w * h;\n  return out;");
    assert(trimmed.ok && trimmed.matchMode === "trimmed" && trimmed.code.indexOf("w * h") >= 0, "Trimmed hunk match failed");

    /* Patch introducing an unclosed parenthesis must roll back automatically */
    var broken = CP.PatchApplier.apply(src, "var out = w + h;", "var out = (w * h;");
    assert(!broken.ok && broken.rolledBack && broken.code === src, "Syntax-breaking patch was not rolled back");
    done();
  });

  /* 2. CallGraph: Multi-file caller/callee discovery & transitive affected-test selection */
  test("CallGraph: Maps callers, callees, and transitive affected unit tests across files", function (done) {
    var cg = new CP.CallGraph();
    cg.indexFiles({
      "net.js": "function packByte(v) { return v & 255; }\nfunction packFrame(x) { return packByte(x); }",
      "game.js": "function sendMove(x) { return packFrame(x); }\nfunction drawHud() { return 1; }",
      "tests.js": "function test_net_send() { return sendMove(5); }\nfunction test_hud() { return drawHud(); }"
    });

    var slice = cg.getImpactSlice("packByte");
    assert(slice.callers.indexOf("packFrame") >= 0, "Missed direct caller packFrame");
    assert(slice.affectedTests.indexOf("test_net_send") >= 0, "Missed transitive affected test test_net_send");
    assert(slice.affectedTests.indexOf("test_hud") < 0, "Unrelated test_hud should not be selected");
    done();
  });

  /* 3. PropTester: Finds failing property & shrinks noisy array down to minimal counterexample */
  test("PropTester: Finds bug in broken sort and shrinks counterexample to <= 2 elements", function (done) {
    /* Intentionally buggy sort that forgets to sort arrays of length >= 2 */
    function buggySort(arr) { return arr; }
    var res = CP.PropTester.checkArrayProperty(function (xs) {
      var out = buggySort(xs);
      for (var i = 1; i < out.length; i++) if (out[i] < out[i - 1]) return false;
      return true;
    }, { trials: 50, seed: 99 });

    assert(!res.ok, "PropTester should catch unsorted array");
    assert(res.shrunkFailure.length === 2, "Shrinker should reduce failure to 2 elements, got " + JSON.stringify(res.shrunkFailure));
    assert(res.shrunkFailure[0] > res.shrunkFailure[1], "Shrunk counterexample must still fail property");

    /* Valid sort passes all trials */
    var okRes = CP.PropTester.checkArrayProperty(function (xs) {
      var out = xs.slice(0).sort(function (a, b) { return a - b; });
      for (var i = 1; i < out.length; i++) if (out[i] < out[i - 1]) return false;
      return true;
    }, { trials: 50, seed: 99 });
    assert(okRes.ok, "Valid sort should pass all property trials");
    done();
  });

  /* 4. MiniTypeChecker & TraceRecorder */
  test("MiniTypeChecker & TraceRecorder: Catches invalid method calls, mixed string+num, and pinpoints NaN step", function (done) {
    var badTypes = [
      'var count = 5;',
      'var label = "score";',
      'count.push(1);',
      'count.toUpperCase();',
      'var oops = label + count;'
    ].join("\n");
    var tRep = CP.MiniTypeChecker.check(badTypes);
    assert(!tRep.ok && tRep.issues.length === 3, "Expected 3 type issues, got " + tRep.issues.length);

    var tr = new CP.TraceRecorder(50);
    tr.record("speed", 10);
    tr.record("speed", 20);
    tr.record("speed", NaN);
    tr.record("speed", 30);
    var firstBad = tr.findFirstAnomaly();
    assert(firstBad && firstBad.step === 3 && firstBad.oldVal === 20, "Tracer failed to pinpoint step 3 NaN transition");
    done();
  });

  /* 5. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_code_power.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_code_power.js", "evelyn_code_power_tests.js"];
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
      console.log("\n=== CODE POWER RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN CODE POWER (PATCHER, CALL-GRAPH, SHRINKER & TYPE/TRACE) TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
