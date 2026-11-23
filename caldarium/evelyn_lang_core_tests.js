/* evelyn_lang_core_tests.js - Automated ES5 Tests for EvelynLangCore
   Verifies all 4 block families (braces, indent, end_keyword, label) + runtime JSON language plug-ins.
   Run in Node.js: node evelyn_lang_core_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) require("./evelyn_lang_core.js");

  var L = root.EvelynLangCore;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Chunking & Repo Map across all 4 block families: Python, C, BASIC, 6502 Assembly */
  test("4 Block Families: Chunks Python (indent), C (braces), BASIC (end_keyword), and 6502 ASM (label)", function (done) {
    var py = [
      "def boil_minutes(alt_ft):",
      "    if alt_ft > 6500:",
      "        return 3",
      "    return 1",
      "",
      "def greet(name):",
      "    return 'hi ' + name"
    ].join("\n");
    var rPy = L.chunkByDefinitions(py, "camp.py");
    assertEq(rPy.lang, "python", "Auto-detect .py failed");
    assertEq(rPy.chunks.length, 2, "Expected 2 Python functions");
    assert(rPy.chunks[0].text.indexOf("return 1") >= 0 && rPy.chunks[0].text.indexOf("greet") < 0, "Python indent chunk leaked into next def");

    var cSrc = [
      "static int clamp_pwm(int v) {",
      "  if (v > 70) return 70;",
      "  return v;",
      "}",
      "int drive_step(int x) {",
      "  return clamp_pwm(x);",
      "}"
    ].join("\n");
    var rC = L.chunkByDefinitions(cSrc, "motor.c");
    assertEq(rC.lang, "c", "Auto-detect .c failed");
    assertEq(rC.chunks.length, 2, "Expected 2 C functions");
    assertEq(rC.chunks[0].symbol, "clamp_pwm", "C symbol name mismatch");

    var bas = [
      "SUB MoveBot (steps)",
      "  PRINT steps",
      "END SUB",
      "FUNCTION DoubleVal (n)",
      "  DoubleVal = n * 2",
      "END FUNCTION"
    ].join("\n");
    var rBas = L.chunkByDefinitions(bas, "rover.bas");
    assertEq(rBas.chunks.length, 2, "Expected 2 BASIC routines");
    assertEq(rBas.chunks[1].symbol, "DoubleVal", "BASIC function name mismatch");

    var asm = "init:\n  LDA #$00\n  LDX #$04\nloop:\n  ADC #$05\n  DEX\n  BNE loop\n  BRK";
    var rAsm = L.chunkByDefinitions(asm, "mul.asm");
    assertEq(rAsm.chunks.length, 2, "Expected 2 6502 label blocks");
    assertEq(rAsm.chunks[1].symbol, "loop", "6502 label name mismatch");
    done();
  });

  /* 2. Polyglot Call Graph & Affected-Test Selection on Multi-File Python Project */
  test("Polyglot CallGraph: Maps cross-file Python callers & selects affected test_* functions", function (done) {
    var cg = L.buildCallGraph({
      "math_lib.py": "def scale_ratio(a, b):\n    return a * b\n",
      "rover.py": "def compute_pwm(dist):\n    return scale_ratio(dist, 2)\ndef play_beep():\n    return 1\n",
      "test_rover.py": "def test_pwm_drive():\n    return compute_pwm(10)\ndef test_audio():\n    return play_beep()\n"
    });
    var impact = cg.impactOf("scale_ratio");
    assert(impact.callers.indexOf("compute_pwm") >= 0, "Missed Python caller compute_pwm");
    assert(impact.affectedTests.indexOf("test_pwm_drive") >= 0, "Missed transitive Python test_pwm_drive");
    assert(impact.affectedTests.indexOf("test_audio") < 0, "Unrelated test_audio should not be selected");
    done();
  });

  /* 3. Token-Safe Rename & Syntax-Guarded Patching in Python and C */
  test("SafeRename & ApplySafePatch: Protects comments/strings and rolls back syntax breaks in Python & C", function (done) {
    var pyCode = "def f(x):\n    # keep x in comment\n    s = 'x'\n    return x + 1";
    var renPy = L.safeRename(pyCode, "x", "speed", "demo.py");
    assert(renPy.ok && renPy.code.indexOf("# keep x in comment") >= 0 && renPy.code.indexOf("'x'") >= 0 && renPy.code.indexOf("return speed + 1") >= 0,
      "Python safeRename corrupted comment or string: " + renPy.code);

    var badPyPatch = L.applySafePatch(pyCode, "return x + 1", "return (x + 1", "demo.py");
    assert(!badPyPatch.ok && badPyPatch.rolledBack && badPyPatch.code === pyCode, "Broken Python patch was not rolled back");

    var cCode = "int run(int a) {\n  /* a stays in comment */\n  return a + 2;\n}";
    var renC = L.safeRename(cCode, "a", "val", "demo.c");
    assert(renC.ok && renC.code.indexOf("/* a stays in comment */") >= 0 && renC.code.indexOf("return val + 2;") >= 0,
      "C safeRename corrupted block comment");
    done();
  });

  /* 4. Zero-Code Runtime Extensibility: Register Rust (.rs) from a Plain JSON Pack */
  test("Zero-Code Language Plug-In: Registers Rust (.rs) from JSON at runtime with full tooling", function (done) {
    var rustPackJson = JSON.stringify({
      id: "rust", name: "Rust", extensions: [".rs"],
      lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", strings: ['"'],
      blockStyle: "braces",
      defRegex: "^\\s*(?:pub\\s+)?fn\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\(([^)]*)\\)",
      testRegex: "^test_",
      keywords: ["pub","fn","let","mut","if","else","return","struct","impl","for","in","while"],
      runner: "rustc {file}"
    });
    L.registerLanguage(JSON.parse(rustPackJson));

    var rsFiles = {
      "lib.rs": "pub fn add_clamp(x: i32) -> i32 {\n    if x > 70 { return 70; }\n    x\n}",
      "tests.rs": "fn test_clamp() {\n    let v = add_clamp(99);\n}"
    };
    var ch = L.chunkByDefinitions(rsFiles["lib.rs"], "lib.rs");
    assertEq(ch.lang, "rust", "Custom .rs auto-detection failed");
    assertEq(ch.chunks[0].symbol, "add_clamp", "Rust fn extraction failed");

    var cg = L.buildCallGraph(rsFiles);
    var imp = cg.impactOf("add_clamp");
    assert(imp.affectedTests.indexOf("test_clamp") >= 0, "Custom Rust pack failed call-graph test selection");
    done();
  });

  /* 5. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_lang_core.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_lang_core.js", "evelyn_lang_core_tests.js"];
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
      console.log("\n=== MODULAR LANGUAGE CORE RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN MODULAR MULTI-LANGUAGE CORE TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
