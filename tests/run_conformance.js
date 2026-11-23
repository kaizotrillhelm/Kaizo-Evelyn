/* run_conformance.js - runs tests/conformance.txt through every edition and compares the output with the JavaScript edition.
   node tests/run_conformance.js [--only js,c,basic] [--keep] [--verbose]
   Needs: node. The C edition is used when c/out/evelyn_proto(.exe) exists (run c/build.bat or make first).
   The BASIC edition runs in the bundled interpreter (tests/qbi.js); if FreeBASIC (fbc) is on PATH it is compiled and run too. */
"use strict";
var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var maker = require("../tools/make_test_model.js");

var ROOT = path.resolve(__dirname, "..");
var args = process.argv.slice(2);
var only = null, keep = args.indexOf("--keep") >= 0, verbose = args.indexOf("--verbose") >= 0;
args.forEach(function (a, i) { if (a === "--only" && args[i + 1]) only = args[i + 1].split(","); });

var TMP = path.join(__dirname, "tmp", "conf");
var EXE = process.platform === "win32" ? ".exe" : "";

/* what each edition runs */
var EDITIONS = {
  js:    { sections: ["core", "kv", "sampling", "swarm", "net", "full"] },
  c:     { sections: ["core", "kv", "sampling", "swarm", "net", "full"] },
  basic: { sections: ["core", "kv", "sampling", "swarm", "net"] }
};

function readSections() {
  var text = fs.readFileSync(path.join(__dirname, "conformance.txt"), "utf8").replace(/\r/g, "");
  var sections = {}, cur = "core";
  text.split("\n").forEach(function (line) {
    var m = /^@section (\w+)/.exec(line);
    if (m) { cur = m[1]; if (!sections[cur]) sections[cur] = []; return; }
    if (!sections[cur]) sections[cur] = [];
    sections[cur].push(line);
  });
  return sections;
}

function prepareDir(name, sections, secNames, refs) {
  var dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "TEST.BIN"), maker.build({}));
  fs.writeFileSync(path.join(dir, "FULL.BIN"), maker.build({ D: 96, L: 4, H: 4, HID: 256, seed: 7 }));
  var lines = [];
  secNames.forEach(function (s) { if (sections[s]) lines = lines.concat(sections[s]); });
  lines.push("QUIT");
  fs.writeFileSync(path.join(dir, "script.txt"), lines.join("\n") + "\n");
  if (refs) Object.keys(refs).forEach(function (k) { fs.writeFileSync(path.join(dir, k), refs[k]); });
  return dir;
}

function run(cmd, argv, cwd, timeoutMs) {
  var r = cp.spawnSync(cmd, argv, { cwd: cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs || 600000 });
  return { out: (r.stdout || Buffer.alloc(0)).toString("latin1"), err: (r.stderr || Buffer.alloc(0)).toString("latin1"), status: r.status, error: r.error };
}

function runEdition(name, dir) {
  var script = path.join(dir, "script.txt");
  if (name === "js") return run(process.execPath, [path.join(ROOT, "js", "evelyn_proto.js"), script], dir);
  if (name === "c") {
    var exe = path.join(ROOT, "c", "out", "evelyn_proto" + EXE);
    if (!fs.existsSync(exe)) return null;
    return run(exe, [script], dir);
  }
  if (name === "basic") return run(process.execPath, [path.join(__dirname, "qbi.js"), path.join(ROOT, "basic", "evelyn_proto.bas"), "--cmd", script], dir, 900000);
  if (name === "basic-fbc") {
    var exe = path.join(dir, "evelyn_proto_fbc" + EXE);
    var build = run("fbc", ["-lang", "qb", "-x", exe, path.join(ROOT, "basic", "evelyn_proto.bas")], path.join(ROOT, "basic"));
    if (build.status !== 0) return { out: "", err: "fbc could not compile evelyn_proto.bas:\n" + build.out + build.err, status: build.status || 1 };
    return run(exe, [script], dir);
  }
  return null;
}

function haveFbc() {
  var r = cp.spawnSync(process.platform === "win32" ? "where" : "which", ["fbc"], { encoding: "utf8" });
  return r.status === 0;
}

function lines(s) { return s.replace(/\r/g, "").replace(/\n$/, "").split("\n").map(function (l) { return l.replace(/\s+$/, ""); }); }

var FLOAT_LINE = /^(SCORES|SUM|BACK|QDOT)\b/;
function numeric(t) { return /^-?\d+(\.\d+)?$/.test(t); }

function sameLine(a, b) {
  if (a === b) return true;
  if (!FLOAT_LINE.test(a)) return false;
  var ta = a.split(/[ ,=]+/), tb = b.split(/[ ,=]+/);
  if (ta.length !== tb.length) return false;
  for (var i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    if (!numeric(ta[i]) || !numeric(tb[i])) return false;
    var x = parseFloat(ta[i]), y = parseFloat(tb[i]);
    if (Math.abs(x - y) > 1e-3 * Math.max(1, Math.abs(x))) return false;
  }
  return true;
}

function compare(name, ref, got) {
  var diffs = [], n = Math.max(ref.length, got.length);
  for (var i = 1; i < n; i++) {       /* line 0 names the edition */
    var a = ref[i], b = got[i];
    if (a === undefined || b === undefined || !sameLine(a, b)) {
      var cmd = "";
      for (var j = i; j >= 0; j--) if (ref[j] && ref[j].indexOf(">> ") === 0) { cmd = ref[j]; break; }
      diffs.push({ line: i, ref: a, got: b, cmd: cmd });
      if (diffs.length >= 12) break;
    }
  }
  return diffs;
}

function fileBytes(dir, f) { var p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p) : null; }
function sameFile(a, b, text) {
  if (!a || !b) return false;
  if (text) return a.toString("latin1").replace(/\r/g, "") === b.toString("latin1").replace(/\r/g, "");
  return Buffer.compare(a, b) === 0;
}

function main() {
  var sections = readSections(), failures = 0, ran = [];
  fs.mkdirSync(TMP, { recursive: true });

  /* pass 1: the JavaScript edition writes the files the others read back */
  var d1 = prepareDir("js-pass1", sections, EDITIONS.js.sections, null);
  var r1 = runEdition("js", d1);
  if (!r1 || r1.status !== 0) { console.log("JavaScript edition failed:\n" + (r1 && r1.err)); process.exit(1); }
  var refs = {
    "ref_lib.evl": fileBytes(d1, "lib_out.evl"),
    "ref_kv.bin": fileBytes(d1, "kv_out.bin"),
    "ref_user.cfg": fileBytes(d1, "user_out.cfg")
  };
  Object.keys(refs).forEach(function (k) { if (!refs[k]) { console.log("JavaScript edition did not write " + k); failures++; refs[k] = Buffer.alloc(0); } });

  /* pass 2: every edition with the reference files in place */
  var results = {}, outDirs = {};
  var names = ["js", "c", "basic"];
  if (haveFbc()) { names.push("basic-fbc"); EDITIONS["basic-fbc"] = { sections: ["core"] }; }
  else console.log("[basic-fbc] FreeBASIC (fbc) not found: the BASIC edition ran in the bundled interpreter only");
  if (only) names = names.filter(function (n) { return only.indexOf(n) >= 0 || n === "js"; });
  names.forEach(function (name) {
    var dir = prepareDir(name, sections, EDITIONS[name].sections, refs);
    var t0 = Date.now(), r = runEdition(name, dir);
    if (!r) { console.log("[" + name + "] skipped (not built)"); return; }
    if (r.status !== 0 || r.error) {
      console.log("[" + name + "] FAILED to run (exit " + r.status + ")\n" + r.err.slice(0, 2000) + r.out.slice(-1500));
      failures++;
      return;
    }
    results[name] = lines(r.out); outDirs[name] = dir; ran.push(name);
    fs.writeFileSync(path.join(dir, "output.txt"), r.out);
    if (verbose) console.log("[" + name + "] " + results[name].length + " lines in " + (Date.now() - t0) + " ms");
  });

  /* the JavaScript reference output, restricted to the lines each edition ran */
  var refLines = results.js;
  ran.forEach(function (name) {
    if (name === "js") return;
    var secs = EDITIONS[name].sections;
    var refSub = lines(runRefSubset(sections, secs, refs));
    var diffs = compare(name, refSub, results[name]);
    if (diffs.length) {
      failures++;
      console.log("[" + name + "] DIFFERS from the JavaScript edition (" + diffs.length + "+ lines):");
      diffs.forEach(function (d) {
        console.log("   " + d.cmd);
        console.log("     js: " + d.ref);
        console.log("     " + name + ": " + d.got);
      });
    } else {
      console.log("[" + name + "] OK  " + results[name].length + " output lines match the JavaScript edition (" + secs.join(", ") + ")");
    }
    /* files written by the edition must be byte for byte the ones JavaScript wrote */
    [["lib_out.evl", true], ["user_out.cfg", true], ["kv_out.bin", false], ["kv_short.bin", false]].forEach(function (f) {
      var a = fileBytes(outDirs[name], f[0]);
      if (!a) return;
      var ok = sameFile(fileBytes(outDirs.js, f[0]), a, f[1]);
      if (!ok) { failures++; console.log("[" + name + "] file " + f[0] + " differs from the JavaScript edition"); }
      else if (verbose) console.log("[" + name + "] file " + f[0] + " identical");
    });
  });
  if (ran.indexOf("js") >= 0) console.log("[js] reference run: " + results.js.length + " output lines");

  if (!keep) { /* leave the output of the last run for inspection, remove nothing */ }
  console.log(failures ? "CONFORMANCE: " + failures + " problem(s)" : "CONFORMANCE: all editions agree");
  process.exit(failures ? 1 : 0);
}

/* the JavaScript output for just the sections another edition ran */
function runRefSubset(sections, secs, refs) {
  var dir = prepareDir("js-subset-" + secs.join("-"), sections, secs, refs);
  var r = runEdition("js", dir);
  return r.out;
}

main();
