/* test_clis.js - drives the three command line programs with the same typed input and checks what they say,
   then starts each one again to see that the learner profile was kept.
   node tests/test_clis.js */
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");

var ROOT = path.resolve(__dirname, "..");
var EXE = process.platform === "win32" ? ".exe" : "";
var INPUT = ["/mode D", "what is gravity", "/adv", "boil it", "/code PRINT 2+3;LET a=4;PRINT a*a", "/profile", "/quit"].join("\n") + "\n";
var NOTHING = "/quit\n";

var editions = [
  { name: "js", cmd: process.execPath, args: function () { return [path.join(ROOT, "js", "evelyn_cli.js"), "--data", "data"]; } },
  { name: "c", cmd: path.join(ROOT, "c", "out", "evelyn" + EXE), args: function () { return []; }, needsBuild: true },
  { name: "basic", cmd: process.execPath, args: function (dir) { return [path.join(__dirname, "qbi.js"), path.join(ROOT, "basic", "evelyn.bas"), "--stdin", path.join(dir, "stdin.txt")]; } }
];

var passed = 0, failed = 0, failures = [];
function check(name, cond, detail) { if (cond) passed++; else { failed++; failures.push(name + (detail ? ": " + detail : "")); } }

editions.forEach(function (ed) {
  if (ed.needsBuild && !fs.existsSync(ed.cmd)) { console.log("[" + ed.name + "] skipped (not built)"); return; }
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "evl-cli-" + ed.name + "-"));
  function go(input) {
    fs.writeFileSync(path.join(dir, "stdin.txt"), input);
    var r = cp.spawnSync(ed.cmd, ed.args(dir), { cwd: dir, input: input, encoding: "latin1", timeout: 120000 });
    return (r.stdout || "").replace(/\r/g, "") + (r.status ? "\n[exit " + r.status + "] " + (r.stderr || "") : "");
  }
  var out = go(INPUT);
  check(ed.name + " banner", /library entries: 16/.test(out), out.slice(0, 200));
  check(ed.name + " do mode", out.indexOf("[DO] Try applying 'gravity':") >= 0);
  check(ed.name + " source label", out.indexOf("[Compressed Library]") >= 0);
  check(ed.name + " adventure", out.indexOf("CORRECT! Unlocked: Clean Canteen (+20 XP)") >= 0 && out.indexOf("XP: 30") >= 0);
  check(ed.name + " code lab prints", /5\n16\n/.test(out));
  check(ed.name + " code lab draws a grid", /\. \. \. \. @ \. \. \. \. \. \. \./.test(out));
  check(ed.name + " profile", /MODE=D/.test(out) && /XP=30/.test(out) && /SOLVED=p_solar/.test(out));
  var again = go(NOTHING);
  check(ed.name + " keeps the profile", /mode D \| xp 30/.test(again), again.slice(0, 300));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("[" + ed.name + "] done");
});

console.log("cli: " + passed + " passed, " + failed + " failed");
failures.forEach(function (f) { console.log("  FAIL " + f); });
process.exit(failed ? 1 : 0);
