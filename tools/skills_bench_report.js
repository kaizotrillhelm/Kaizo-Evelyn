/* skills_bench_report.js - the tables of an evelyn_skills_bench.js run, as Markdown.
   node tools/skills_bench_report.js <bench folder with results.json> [out.md]
   Reads results.json (written by js/test/evelyn_skills_bench.js) and prints, for every suite, kind and task, one row per setup:
   runs, first-draft passes, final passes, calls, tokens, seconds, and for three.js scenes how many of the passing scenes the visual checks
   found clean. It adds nothing that is not in the file and judges nothing. Plain ES5. */
"use strict";
var fs = require("fs");
var path = require("path");

var dir = process.argv[2], outFile = process.argv[3];
if (!dir) { console.log("usage: node tools/skills_bench_report.js <bench folder> [out.md]"); process.exit(1); }
var d = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
var R = d.results, NL = String.fromCharCode(10);
var CONDS = [["alone", "Inkling alone"], ["loop", "Loop, notes off"], ["notes", "Loop, notes on"], ["skill", "Loop + skill"], ["skillcal", "Loop + skill + Caldera"]];
var out = [];

function avg(rs, k) { return rs.reduce(function (a, r) { return a + (r[k] || 0); }, 0) / rs.length; }
function secs(x) { return (x / 1000).toFixed(0); }
function table(rs, withVisual) {
  var lines = ["| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |" + (withVisual ? " Visual checks clean |" : ""),
    "| --- | --- | --- | --- | --- | --- | --- |" + (withVisual ? " --- |" : "")];
  CONDS.forEach(function (c) {
    var x = rs.filter(function (r) { return r.cond === c[0]; });
    if (!x.length) return;
    var f = x.filter(function (r) { return r.firstDraftOk; }).length, p = x.filter(function (r) { return r.ok; }).length;
    var vis = x.filter(function (r) { return r.ok && r.visualErrors; }), vc = vis.filter(function (r) { return !r.visualErrors.length; }).length;
    lines.push("| " + c[1] + " | " + x.length + " | " + f + " of " + x.length + " | " + p + " of " + x.length + " | " + avg(x, "calls").toFixed(1) + " | " + Math.round(avg(x, "tokens")) + " | " + secs(avg(x, "ms")) + " |" + (withVisual ? " " + vc + " of " + vis.length + " |" : ""));
  });
  return lines.join(NL);
}

out.push("# Evelyn skills bench: " + d.backend + ", " + d.model);
out.push("");
out.push("Server context " + d.serverCtx + " tokens, " + d.trials + " trials per cell. Effort probe on a trivial sum: " + JSON.stringify((d.probe || {}).runs || []) + ".");
out.push("");
var suites = {};
R.forEach(function (r) { var k = r.suite + "/" + r.kind; (suites[k] = suites[k] || []).push(r); });
Object.keys(suites).forEach(function (k) {
  out.push("## " + k + " (" + suites[k].length + " runs)");
  out.push("");
  out.push(table(suites[k], k.indexOf("three") === 0 || k.indexOf("photo") === 0));
  out.push("");
  var tasks = {};
  suites[k].forEach(function (r) { (tasks[r.task] = tasks[r.task] || []).push(r); });
  Object.keys(tasks).forEach(function (t) {
    if (Object.keys(tasks).length < 2) return;
    out.push("### " + k + " / " + t);
    out.push("");
    out.push(table(tasks[t], k.indexOf("three") === 0 || k.indexOf("photo") === 0));
    out.push("");
  });
  var bad = suites[k].filter(function (r) { return !r.ok; });
  if (bad.length) {
    out.push("Failures:");
    out.push("");
    bad.forEach(function (r) { out.push("- " + r.task + " / " + r.cond + " / trial " + (r.trial + 1) + ": " + String((r.errors || ["?"])[0]).slice(0, 200)); });
    out.push("");
  }
  var vflag = suites[k].filter(function (r) { return r.ok && r.visualErrors && r.visualErrors.length; });
  if (vflag.length) {
    out.push("Passed the structural checks but flagged by the visual checks:");
    out.push("");
    vflag.forEach(function (r) { out.push("- " + r.task + " / " + r.cond + " / trial " + (r.trial + 1) + ": " + r.visualErrors.join(" ; ").slice(0, 220)); });
    out.push("");
  }
});
var text = out.join(NL) + NL;
if (outFile) fs.writeFileSync(outFile, text); else process.stdout.write(text);
