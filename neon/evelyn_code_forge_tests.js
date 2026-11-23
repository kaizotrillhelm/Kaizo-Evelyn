/* evelyn_code_forge_tests.js - Automated ES5 Tests for EvelynCodeForge
   Run in Node.js: node evelyn_code_forge_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_sentinel.js");
    require("./evelyn_code_forge.js");
  }

  var CF = root.EvelynCodeForge;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. MiniGit commit, diff, and rollback */
  test("MiniGit: Commits snapshots, generates line-by-line diff, and rolls back cleanly", function (done) {
    var repo = new CF.MiniGit();
    var c1 = repo.commit("Initial pong", { "main.js": "var speed = 2;\nvar score = 0;" });
    var c2 = repo.commit("Speed up ball", { "main.js": "var speed = 5;\nvar score = 0;\nvar combo = 1;" });

    assertEq(repo.log().length, 2, "Expected 2 commits in log");
    var d = repo.diff(c1.hash, c2.hash, "main.js");
    assert(d.ok, "Diff failed");
    var hasAdd = false, hasDel = false;
    for (var i = 0; i < d.lines.length; i++) {
      if (d.lines[i].type === "add" && d.lines[i].text.indexOf("combo") >= 0) hasAdd = true;
      if (d.lines[i].type === "del" && d.lines[i].text.indexOf("speed = 2") >= 0) hasDel = true;
    }
    assert(hasAdd && hasDel, "Diff missed added/deleted lines");

    var rolled = repo.checkout(c1.hash);
    assert(rolled.ok && rolled.files["main.js"].indexOf("speed = 2") >= 0, "Rollback to c1 failed");
    done();
  });

  /* 2. MiniSQL relational queries & aggregates */
  test("MiniSQL: CREATE, INSERT, WHERE filter, ORDER BY DESC, LIMIT, and SUM/AVG/COUNT", function (done) {
    var db = new CF.MiniSQL();
    assert(db.exec("CREATE TABLE orders (item, shift, coins)").ok, "CREATE TABLE failed");
    assert(db.exec("INSERT INTO orders VALUES ('Drain Snake leggings', 'day', 18)").ok, "INSERT 1 failed");
    assert(db.exec("INSERT INTO orders VALUES ('Biscuit mittens', 'night', 11)").ok, "INSERT 2 failed");
    assert(db.exec("INSERT INTO orders VALUES ('Aurora scarf', 'night', 27)").ok, "INSERT 3 failed");

    var q1 = db.exec("SELECT item, coins FROM orders WHERE shift = 'night' ORDER BY coins DESC LIMIT 1");
    assert(q1.ok && q1.rows.length === 1 && q1.rows[0].item === "Aurora scarf" && q1.rows[0].coins === 27, "SELECT WHERE/ORDER/LIMIT failed");

    var qSum = db.exec("SELECT SUM(coins) FROM orders WHERE shift = 'night'");
    assert(qSum.ok && qSum.rows[0].sum === 38, "SUM aggregate expected 38");

    var qCnt = db.exec("SELECT COUNT(*) FROM orders");
    assert(qCnt.ok && qCnt.rows[0].count === 3, "COUNT(*) expected 3");
    done();
  });

  /* 3. Real 6502 2-Pass Assembler + Cycle-Stepping VM (Looping Multiplication!) */
  test("Asm6502 & VM6502: Assembles labeled loop (5 * 4 = 20) into real bytes and executes cleanly", function (done) {
    /* Multiply 5 * 4 using a real 6502 loop and store result at zero-page $00 */
    var asm = [
      "  CLC          ; clear carry",
      "  LDA #$00     ; A = 0 accumulator",
      "  LDX #$04     ; X = 4 loop counter",
      "loop:",
      "  ADC #$05     ; A = A + 5",
      "  DEX          ; X = X - 1",
      "  BNE loop     ; repeat while X != 0",
      "  STA $00      ; store result in RAM[$00]",
      "  BRK          ; stop CPU"
    ].join("\n");

    var built = CF.Asm6502.assemble(asm);
    assert(built.ok, "6502 assembly failed: " + built.error);

    var vm = new CF.VM6502();
    vm.load(built.bytes, built.loadAddr);
    var endState = vm.run(200);
    assert(endState.halted, "VM should halt cleanly on BRK");
    assertEq(endState.A, 20, "Register A should hold 5 * 4 = 20");
    assertEq(vm.ram[0], 20, "Zero-page RAM[$00] should hold 20");

    /* Infinite loop safety check: fuel limit stops runaway assembly without hanging */
    var inf = CF.Asm6502.assemble("LDX #$01\nspin:\nBNE spin");
    vm.load(inf.bytes, inf.loadAddr);
    var capped = vm.run(50);
    assertEq(capped.steps, 50, "Fuel limit must halt infinite 6502 loop at 50 steps");
    done();
  });

  /* 4. Standalone Offline App Exporter escapes </script> safely */
  test("SingleFileExporter: Packages standalone HTML app and escapes closing script tags", function (done) {
    var html = CF.SingleFileExporter.buildAppHTML({
      title: "Farm Seed Log",
      html: "<div id='app'>Ready</div>",
      js: "var s = '</script>safe';"
    });
    assert(html.indexOf("<!DOCTYPE html>") === 0 && html.indexOf("<\\/script>safe") >= 0, "Exported HTML failed escaping check");
    done();
  });

  /* 5. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_code_forge.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_code_forge.js", "evelyn_code_forge_tests.js"];
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
      console.log("\n=== CODE FORGE RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN CODE FORGE (GIT, SQL, 6502 VM & APP EXPORTER) TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
