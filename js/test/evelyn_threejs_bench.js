/* evelyn_threejs_bench.js - Inkling writing three.js scenes, alone and with Evelyn, against the same checks.
   node js/test/evelyn_threejs_bench.js --port 1249 [--trials 2] [--tasks cube,solar,island] [--out tests/tmp/threejs_bench_results.json]
   The server is the Inkling GGUF on LM Studio's llama.cpp runtime, started elsewhere through the GPU queue
   (ShotReader_2026-11-20/tools/sr_server.mjs). Nothing is started or stopped here.

   Three conditions, the same task and the same seed (the seed makes a run repeatable, it does not make it a fair sample):
     alone    one call to Inkling, effort high, no notes, no run of the code before the score
     loop     Evelyn's run-and-repair loop with no notes: the code is run, exact errors go back, up to 2 repairs
     notes    the same loop plus verified three r187 notes retrieved from an OffsetShelfStore (js/test/threejs_tasks.js)
   Every final code is scored by the same verifier (the code runs against the real three r187 in a child process with
   Node's permission model on; only the scene graph is built, no renderer, no picture). The notes were written by the same
   hand as the checks, so the 'notes' column shows what retrieval can do when the right note exists, not an unbiased accuracy.
   Plain ES5. */
(function () {
  "use strict";
  var fs = require("fs");
  var path = require("path");
  var S = require("../evelyn_stream.js");
  var A = require("../evelyn_inkling_agent.js");
  var CL = require("../evelyn_inkling_codeloop.js");
  var TT = require("./threejs_tasks.js");

  function arg(n, d) { var i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; }
  var PORT = Number(arg("port", 1249)), TRIALS = Number(arg("trials", 2)), MAXTOK = Number(arg("maxtokens", 6000));
  var TASKLIST = String(arg("tasks", "cube,solar,island")).split(",");
  var OUT = path.resolve(arg("out", path.join(__dirname, "..", "..", "tests", "tmp", "threejs_bench_results.json")));
  var SYSTEM = "You are a careful three.js engineer.";

  var store = new S.OffsetShelfStore();
  store.buildFromRecords(TT.NOTES);

  function client(seed) { return new A.InklingClient({ port: PORT, model: "inkling", maxTokens: MAXTOK, temperature: 0.6, timeoutMs: 600000, extra: { seed: seed } }); }

  var jobs = [], results = [];
  TASKLIST.forEach(function (task, ti) {
    for (var tr = 0; tr < TRIALS; tr++) ["alone", "loop", "notes"].forEach(function (cond) { jobs.push({ task: task, trial: tr, cond: cond, seed: 1000 + ti * 100 + tr }); });
  });

  function runAlone(job, cb) {
    var c = client(job.seed), t0 = Date.now();
    c.chat([{ role: "system", content: SYSTEM }, { role: "user", content: TT.TASKS[job.task].text }], "high", function (err, text) {
      var tokens = c.lastUsage ? c.lastUsage.completion_tokens : 0;
      if (err) return cb({ ok: false, firstDraftOk: false, calls: 1, rounds: 0, tokens: tokens, ms: Date.now() - t0, errors: ["no reply: " + err.message] });
      var code = CL.extractCode(text, "buildScene");
      if (!code) return cb({ ok: false, firstDraftOk: false, calls: 1, rounds: 0, tokens: tokens, ms: Date.now() - t0, errors: ["the reply has no closed fenced code block"] });
      var v = TT.verifyCode(job.task, code);
      cb({ ok: v.ok, firstDraftOk: v.ok, calls: 1, rounds: 0, tokens: tokens, ms: Date.now() - t0, errors: v.errors, code: code });
    });
  }

  function runLoop(job, withNotes, cb) {
    var c = client(job.seed), t0 = Date.now(), tokens = 0;
    var loop = new CL.EvelynCodeLoop({
      store: withNotes ? store : null, client: c, marker: "buildScene", maxRepairs: 2, system: SYSTEM,
      verify: function (code) { return TT.verifyCode(job.task, code); },
      onCall: function (info) { if (info.usage) tokens += info.usage.completion_tokens || 0; }
    });
    loop.run(TT.TASKS[job.task].text, function (err, r) {
      if (err) return cb({ ok: false, firstDraftOk: false, calls: 0, rounds: 0, tokens: tokens, ms: Date.now() - t0, errors: [String(err.message || err)] });
      var last = r.history[r.history.length - 1];
      cb({ ok: r.ok, firstDraftOk: r.firstDraftOk, calls: r.calls, rounds: r.rounds, tokens: tokens, ms: Date.now() - t0, errors: r.ok ? [] : last.errors, code: r.code, hits: r.hits, effort: r.effort });
    });
  }

  function summary() {
    var conds = ["alone", "loop", "notes"], lines = [];
    lines.push("condition  tasks  first-draft pass  final pass  calls  tokens   seconds");
    conds.forEach(function (cond) {
      var rs = results.filter(function (r) { return r.cond === cond; });
      if (!rs.length) return;
      var n = rs.length, f = rs.filter(function (r) { return r.firstDraftOk; }).length, p = rs.filter(function (r) { return r.ok; }).length;
      var calls = rs.reduce(function (a, r) { return a + r.calls; }, 0), tok = rs.reduce(function (a, r) { return a + r.tokens; }, 0), ms = rs.reduce(function (a, r) { return a + r.ms; }, 0);
      lines.push(cond.padEnd(10) + " " + String(n).padStart(5) + "  " + (f + " / " + n).padStart(16) + "  " + (p + " / " + n).padStart(10) + "  " + (calls / n).toFixed(1).padStart(5) + "  " + Math.round(tok / n).toString().padStart(6) + "  " + (ms / n / 1000).toFixed(0).padStart(7));
    });
    return lines.join("\n");
  }

  var idx = 0;
  function next() {
    if (idx >= jobs.length) {
      console.log("\n" + summary());
      console.log("(averages per run: calls, tokens generated by the model including its thinking, seconds)");
      var byTask = {};
      results.forEach(function (r) { var k = r.task + "/" + r.cond; byTask[k] = (byTask[k] || "") + (r.ok ? "P" : "F") + (r.firstDraftOk ? "" : (r.ok ? "(repaired)" : "")); });
      console.log("per task (P pass, F fail; first draft failed but fixed shown as repaired):");
      Object.keys(byTask).forEach(function (k) { console.log("  " + k.padEnd(14) + byTask[k]); });
      fs.writeFileSync(OUT, JSON.stringify({ port: PORT, trials: TRIALS, results: results }, null, 1));
      console.log("results written to " + OUT);
      process.exit(0);
    }
    var job = jobs[idx++];
    var go = job.cond === "alone" ? runAlone : function (j, cb) { runLoop(j, j.cond === "notes", cb); };
    go(job, function (r) {
      r.task = job.task; r.trial = job.trial; r.cond = job.cond; r.seed = job.seed;
      results.push(r);
      console.log("[" + idx + "/" + jobs.length + "] " + job.task.padEnd(7) + " " + job.cond.padEnd(6) + " trial " + job.trial + ": " + (r.ok ? "PASS" : "FAIL") +
        (r.firstDraftOk ? " (first draft)" : (r.ok ? " (after " + r.rounds + " repair" + (r.rounds > 1 ? "s" : "") + ")" : "")) +
        "  calls " + r.calls + ", " + r.tokens + " tokens, " + (r.ms / 1000).toFixed(0) + " s" + (r.ok ? "" : "  | " + String(r.errors[0] || "").slice(0, 110)));
      fs.writeFileSync(OUT, JSON.stringify({ port: PORT, trials: TRIALS, partial: true, results: results }, null, 1));
      next();
    });
  }
  console.log("=== INKLING WRITING THREE.JS, ALONE AND WITH EVELYN: " + jobs.length + " runs, port " + PORT + " ===");
  next();
})();
