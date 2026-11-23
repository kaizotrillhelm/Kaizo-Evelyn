/* run_all.js - every test of the three editions, one summary.
   node tests/run_all.js [--no-build]
   Steps: generated files current, BASIC names, stray control characters, JS unit tests, BASIC interpreter tests,
   C build and unit tests, cross-edition conformance, command line programs. */
"use strict";
var fs = require("fs");
var path = require("path");
var cp = require("child_process");

var ROOT = path.resolve(__dirname, "..");
var NODE = process.execPath;
var EXE = process.platform === "win32" ? ".exe" : "";
var noBuild = process.argv.indexOf("--no-build") >= 0;
var results = [];

function step(name, fn) {
  process.stdout.write(("  " + name + " ...").padEnd(46));
  var t0 = Date.now(), r;
  try { r = fn(); } catch (e) { r = { status: "FAIL", note: String(e.message || e) }; }
  var ms = Date.now() - t0;
  console.log(r.status + (r.note ? "  " + r.note : "") + "  (" + ms + " ms)");
  results.push({ name: name, status: r.status, detail: r.detail });
  if (r.status === "FAIL" && r.detail) console.log(r.detail.split("\n").map(function (l) { return "      " + l; }).join("\n"));
}

function run(cmd, args, cwd) {
  var r = cp.spawnSync(cmd, args, { cwd: cwd || ROOT, encoding: "latin1", maxBuffer: 256 * 1024 * 1024, shell: false });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), error: r.error };
}

function node(script, args) {
  var r = run(NODE, [path.join(ROOT, script)].concat(args || []));
  var last = r.out.trim().split("\n").filter(function (l) { return /\d+ passed|agree|current|collides/.test(l); }).pop() || "";
  return { status: r.code === 0 ? "PASS" : "FAIL", note: last.trim(), detail: r.code === 0 ? "" : r.out.slice(-3000) };
}

function controlCharScan() {
  var bad = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
      var p = path.join(dir, d.name);
      if (d.isDirectory()) { if (d.name !== "tmp" && d.name !== "out" && d.name !== "node_modules") walk(p); return; }
      if (!/\.(js|c|h|bas|bi|html|md|txt|bat|json|ps1|sh)$/.test(d.name) && d.name !== "Makefile") return;
      var b = fs.readFileSync(p);
      for (var i = 0; i < b.length; i++) {
        var c = b[i];
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) { bad.push(path.relative(ROOT, p) + " byte " + i + " = " + c); break; }
      }
    });
  }
  walk(ROOT);
  return { status: bad.length ? "FAIL" : "PASS", detail: bad.join("\n") };
}

console.log("Evelyn tests");
step("generated data files are current", function () { return node("tools/gen_data.js", ["--check"]); });
step("generated BASIC declarations are current", function () { return node("tools/gen_decl.js", ["--check"]); });
step("BASIC names avoid keywords", function () { return node("tools/check_bas_names.js"); });
step("no stray control characters", controlCharScan);
step("JavaScript unit tests", function () { return node("js/test/test_evelyn.js"); });
step("JavaScript layer-streaming tests", function () { return node("js/test/evelyn_stream_tests.js"); });
step("BASIC interpreter tests", function () { return node("tests/test_qbi.js"); });

var cBuilt = fs.existsSync(path.join(ROOT, "c", "out", "evelyn_test" + EXE));
step("C build", function () {
  if (noBuild && cBuilt) return { status: "SKIP", note: "--no-build, using the existing build" };
  var r;
  if (process.platform === "win32") r = run("cmd.exe", ["/c", ".\\build.bat"], path.join(ROOT, "c"));
  else r = run("make", [], path.join(ROOT, "c"));
  if (r.error || (r.code !== 0 && /not found|not recognized|No such file|cannot find/i.test(r.out + (r.error || "")))) return { status: "SKIP", note: "no C compiler found" };
  cBuilt = r.code === 0;
  return { status: r.code === 0 ? "PASS" : "FAIL", detail: r.code === 0 ? "" : r.out.slice(-3000) };
});
step("C unit tests", function () {
  var exe = path.join(ROOT, "c", "out", "evelyn_test" + EXE);
  if (!fs.existsSync(exe)) return { status: "SKIP", note: "C edition not built" };
  var r = run(exe, []);
  return { status: r.code === 0 ? "PASS" : "FAIL", note: r.out.trim().split("\n").pop(), detail: r.code === 0 ? "" : r.out };
});
step("cross-edition conformance", function () {
  var r = run(NODE, [path.join(ROOT, "tests", "run_conformance.js")]);
  var skipped = /\[c\] skipped/.test(r.out);
  var summary = r.out.trim().split("\n").filter(function (l) { return /^\[(c|basic|basic-fbc)\] OK/.test(l); }).map(function (l) { return l.replace(/ output lines match.*/, "").replace("OK  ", ""); }).join(", ");
  return { status: r.code === 0 ? "PASS" : "FAIL", note: (summary ? "agree: js, " + summary : "") + (skipped ? " (C skipped)" : ""), detail: r.code === 0 ? "" : r.out.slice(-4000) };
});
step("command line programs", function () { return node("tests/test_clis.js"); });

/* The NEON stack (neon/): concourse, 78 cartridges, adaptive evolution, doctor, guard, director, frontier,
   robotics, sentinel, charter and the Chum Loft (Echoes and DritchChums). Each suite runs in its own process. */
step("chum species data is current", function () {
  var db = path.resolve(ROOT, "..", "CharacterDatabase", "database", "characters.json");
  if (!fs.existsSync(db)) return { status: "SKIP", note: "CharacterDatabase not found" };
  return node("tools/gen_chums.js", ["--check"]);
});
/* Round 2 (the 2236 export) added the retro-game, asset, 3D, code and paper-boost suites below. */
["evelyn_tests", "evelyn_doctor_tests", "evelyn_suite_tests", "evelyn_director_voice_tests", "evelyn_frontier_tests",
 "evelyn_robotics_tests", "evelyn_fuzz_tests", "evelyn_charter_tests", "evelyn_chums_tests",
 "evelyn_game_xray_tests", "evelyn_game_xray_gen6_tests", "evelyn_asset_studio_tests", "evelyn_3d_tests",
 "evelyn_code_forge_tests", "evelyn_turbo_tests", "evelyn_hybrid_rag_tests", "evelyn_code_power_tests",
 "evelyn_lang_core_tests", "evelyn_manual_compiler_tests", "evelyn_paper_boost_tests", "evelyn_paper_boost2_tests",
 "evelyn_paper_boost3_tests", "evelyn_window_engine_tests", "evelyn_late2026_tests", "evelyn_agent_os_tests",
 "evelyn_sovereign_local_tests", "evelyn_bookgames_tests"].forEach(function (name) {
  step("neon: " + name.replace("evelyn_", ""), function () {
    var r = run(NODE, [path.join(ROOT, "neon", name + ".js")], path.join(ROOT, "neon"));
    var lines = r.out.split("\n");
    var summary = lines.filter(function (l) { return /\d+ passed/.test(l); }).pop() || "";
    return { status: r.code === 0 ? "PASS" : "FAIL", note: summary.replace(/=/g, "").trim(), detail: r.code === 0 ? "" : r.out.slice(-3000) };
  });
});
step("neon: the chat's own master runner (27 suites)", function () {
  var r = run(NODE, [path.join(ROOT, "neon", "evelyn_run_all_tests.js")], path.join(ROOT, "neon"));
  var line = r.out.split("\n").filter(function (l) { return /TOTAL:/.test(l); }).pop() || "";
  var ok = r.code === 0 && /27 passed, 0 failed, 0 missing/.test(line);
  return { status: ok ? "PASS" : "FAIL", note: line.replace(/=/g, "").trim(), detail: ok ? "" : r.out.slice(-3000) };
});
step("Scar Brand game chum data is current", function () {
  var game = path.resolve(ROOT, "..", "BocaDeAmourGame_2026-11-21", "tools", "test_chums_link.js");
  if (!fs.existsSync(game)) return { status: "SKIP", note: "BocaDeAmourGame not found" };
  var r = run(NODE, [game], path.dirname(game));
  var last = r.out.split("\n").filter(function (l) { return /\d+ passed/.test(l); }).pop() || "";
  return { status: r.code === 0 ? "PASS" : "FAIL", note: last.replace(/=/g, "").trim(), detail: r.code === 0 ? "" : r.out.slice(-3000) };
});
step("neon: real browser (Brave)", function () {
  var brave = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
  if (!fs.existsSync(brave)) return { status: "SKIP", note: "Brave not found" };
  var probe = run("python", ["-c", "from playwright.sync_api import sync_playwright"]);
  if (probe.code !== 0) return { status: "SKIP", note: "Playwright for Python not installed" };
  var r = run("python", [path.join(ROOT, "tests", "check_neon_browser.py")]);
  return { status: r.code === 0 ? "PASS" : "FAIL", note: r.out.trim().split("\n").pop(), detail: r.code === 0 ? "" : r.out.slice(-3000) };
});

var failed = results.filter(function (r) { return r.status === "FAIL"; }).length;
var skipped = results.filter(function (r) { return r.status === "SKIP"; }).length;
console.log(failed ? "\n" + failed + " step(s) FAILED" : "\nAll steps passed" + (skipped ? " (" + skipped + " skipped)" : ""));
process.exit(failed ? 1 : 0);
