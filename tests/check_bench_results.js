/* check_bench_results.js - is a results.json of js/test/evelyn_skills_bench.js consistent with itself?
   node tests/check_bench_results.js <results.json | bench folder> [--expect basic,three,photo] [--strict]
   It checks the file against what the runner promises (not against the model's quality): every run has the fields it should, a pass has no
   errors and a failure has one, calls and repair rounds and the effort list agree, a first-draft pass means one call, the setup decides which
   notes and skills a run may have, the seed is the same in every setup of a task, no row was made against a dead server, the visual
   checks appear only on passing scenes, the speed in tokens per second is plausible, and the number of runs per suite is the number
   planned. ERROR lines make the exit code 1; WARN lines (for example a suite with fewer runs than planned) do not, unless --strict.
   Rows written by a newer runner (schema 2) are checked for their extra fields too. Plain ES5. */
"use strict";
var fs = require("fs");
var path = require("path");

var arg = process.argv[2];
if (!arg) { console.log("usage: node tests/check_bench_results.js <results.json | folder> [--expect basic,three,photo] [--strict]"); process.exit(2); }
var file = fs.existsSync(arg) && fs.statSync(arg).isDirectory() ? path.join(arg, "results.json") : arg;
var strict = process.argv.indexOf("--strict") > 0;
var ei = process.argv.indexOf("--expect");
var expectSuites = ei > 0 ? String(process.argv[ei + 1]).split(",") : null;
var d = JSON.parse(fs.readFileSync(file, "utf8"));

var errors = [], warns = [], checks = 0;
function err(m) { errors.push(m); }
function warn(m) { warns.push(m); }
function ok(c, m) { checks++; if (!c) err(m); }
function label(r) { return r.suite + "/" + r.task + "/" + r.cond + "/t" + r.trial; }

["backend", "model", "port", "serverCtx", "trials", "results"].forEach(function (k) { ok(d[k] !== undefined, "top level has no " + k); });
ok(Array.isArray(d.results), "results is not an array");
var R = d.results || [], schema = d.schema || 1;
ok(d.serverCtx === null || typeof d.serverCtx === "number", "serverCtx is neither a number nor null");
if (!d.probe) warn("no effort probe in the file");

var COND_OK = { alone: 1, loop: 1, notes: 1, skill: 1, skillcal: 1 };
var seen = {}, seedOf = {};
R.forEach(function (r) {
  var L = label(r);
  ["ok", "firstDraftOk", "calls", "rounds", "tokens", "ms", "errors", "suite", "kind", "task", "trial", "cond", "seed"].forEach(function (k) { ok(r[k] !== undefined, L + ": no field " + k); });
  ok(COND_OK[r.cond] === 1, L + ": unknown setup " + r.cond);
  ok(r.suite === "basic" || r.suite === "three" || r.suite === "photo", L + ": unknown suite");
  ok(r.kind === "code" || r.kind === "qa", L + ": unknown kind");
  var k = [r.suite, r.task, r.trial, r.cond].join("/");
  ok(!seen[k], L + ": the same run is in the file twice");
  seen[k] = true;
  var sk = [r.suite, r.task, r.trial].join("/");
  if (seedOf[sk] === undefined) seedOf[sk] = r.seed; else ok(seedOf[sk] === r.seed, L + ": seed " + r.seed + " differs from " + seedOf[sk] + " of another setup of the same task and trial");

  /* a pass and its errors */
  if (r.ok) ok(Array.isArray(r.errors) && r.errors.length === 0, L + ": passed but has errors");
  else ok(Array.isArray(r.errors) && r.errors.length >= 1, L + ": failed with no error message");
  ok(!r.ok || r.firstDraftOk || r.rounds >= 1, L + ": passed after a failed first draft with no repair round");
  ok(!(r.firstDraftOk && !r.ok), L + ": first draft passed but the run failed");

  /* calls, rounds, efforts */
  ok(r.calls >= 1, L + ": fewer than 1 call");
  if (r.cond === "alone" || r.kind === "qa") ok(r.calls === 1 && r.rounds === 0, L + ": a single-call setup has " + r.calls + " calls and " + r.rounds + " rounds");
  else if (r.ok || r.firstDraftOk === false) ok(r.calls >= r.rounds + 1, L + ": calls " + r.calls + " but rounds " + r.rounds);
  if (r.firstDraftOk && r.kind === "code" && r.cond !== "alone") ok(r.calls === 1 && r.rounds === 0, L + ": first-draft pass with " + r.calls + " calls");
  if (r.efforts) ok(r.efforts.length === r.calls, L + ": " + r.efforts.length + " efforts for " + r.calls + " calls");
  if (r.history) {
    ok(r.history.length === r.calls, L + ": history has " + r.history.length + " entries for " + r.calls + " calls");
    var last = r.history[r.history.length - 1];
    ok(last && last.ok === r.ok, L + ": the last history entry disagrees with ok");
    ok(r.history[0] && r.history[0].ok === r.firstDraftOk, L + ": the first history entry disagrees with firstDraftOk");
  }

  /* which setup may carry what */
  if (r.cond === "alone") ok(!r.efforts && !r.hits, L + ": 'alone' has efforts or notes hits");
  if (r.kind === "qa") { /* a question run has no loop: no hits count, no efforts list */ }
  else if (r.cond === "loop") ok((r.hits || 0) === 0 && (!r.activeSkills || r.activeSkills.length === 0), L + ": the notes-off loop has notes or skills");
  else if (r.cond === "notes") ok((r.hits || 0) > 0 && (!r.activeSkills || r.activeSkills.length === 0), L + ": the notes-on loop has no notes or has skills");
  else if (r.cond === "skill") {
    ok(r.activeSkills && r.activeSkills.length >= 1, L + ": the skill setup has no active skill");
    if (r.suite !== "basic") ok(r.activeSkills.indexOf("threejs-craft") >= 0 && r.activeSkills.indexOf("caldera-graphics") < 0, L + ": expected only the craft skill, got " + JSON.stringify(r.activeSkills));
  }
  else if (r.cond === "skillcal") ok(r.activeSkills && r.activeSkills.indexOf("threejs-craft") >= 0 && r.activeSkills.indexOf("caldera-graphics") >= 0, L + ": expected both skills, got " + JSON.stringify(r.activeSkills));

  /* visual checks only on passing scenes */
  if (r.suite === "basic") ok(r.visualErrors === undefined, L + ": a basic run has visual errors");
  else if (r.ok) ok(Array.isArray(r.visualErrors), L + ": a passing scene has no visualErrors list");
  else ok(r.visualErrors === undefined, L + ": a failed scene has visual errors");
  if (r.kind === "qa") ok(typeof r.answer === "string", L + ": a question run has no answer text");

  /* the server was there, and the speed makes sense */
  var all = JSON.stringify(r.errors || []);
  ok(!/ECONNREFUSED|not reachable|ECONNRESET/.test(all), L + ": made against a server that was not there: " + all.slice(0, 80));
  ok(r.ms > 0 && r.tokens >= 0, L + ": no time or negative tokens");
  if (r.tokens >= 100 && r.ms > 0) {
    var tps = r.tokens / (r.ms / 1000);
    if (tps < 5 || tps > 400) warn(L + ": " + tps.toFixed(1) + " tokens per second is outside 5 to 400");
  }

  /* schema 2 fields */
  if ((r.schema || 1) >= 2) {
    ["startedAt", "finishedAt", "promptTokens", "completionTokens", "tokensPerSecond", "codeSha256", "calls_detail", "transcript"].forEach(function (f) {
      if (f === "codeSha256" && !r.codeSha256 && !r.ok) return;
      if (f === "codeSha256" && r.kind === "qa") return;
      ok(r[f] !== undefined, L + ": schema 2 field " + f + " is missing");
    });
    if (r.calls_detail) ok(r.calls_detail.length === r.calls, L + ": calls_detail has " + r.calls_detail.length + " entries for " + r.calls + " calls");
  }
});

/* the number of runs per suite against the plan */
var planned = { basic: 32 + 18, three: 30, photo: 10 };
var suites = {};
R.forEach(function (r) { suites[r.suite] = (suites[r.suite] || 0) + 1; });
Object.keys(suites).forEach(function (s) {
  if (expectSuites && expectSuites.indexOf(s) < 0) return;
  if (suites[s] !== planned[s]) warn("suite " + s + " has " + suites[s] + " runs; " + planned[s] + " were planned (the suite is incomplete or was cut)");
});
if (expectSuites) expectSuites.forEach(function (s) { ok(suites[s] > 0, "the suite " + s + " is missing"); });

console.log("file: " + file + "  schema " + schema + "  " + R.length + " runs  (" + Object.keys(suites).map(function (s) { return s + " " + suites[s]; }).join(", ") + ")");
console.log(checks + " checks, " + errors.length + " errors, " + warns.length + " warnings");
errors.forEach(function (e) { console.log("ERROR " + e); });
warns.forEach(function (w) { console.log("WARN  " + w); });
process.exit(errors.length || (strict && warns.length) ? 1 : 0);
