/* evelyn_skills_bench.js - Inkling with and without Evelyn's notes and skills, on basic tasks and on three.js scenes.
   node js/test/evelyn_skills_bench.js --port 1249 --backend llama.cpp --model inkling --out tests/tmp/skills_bench/llama
   node js/test/evelyn_skills_bench.js --port 1234 --backend lmstudio --model thinkingmachines/inkling-2-mini --out tests/tmp/skills_bench/lmstudio
   Options: --suite basic,three,photo  --trials 2  --conds alone,loop,notes,skill,skillcal  --maxtokens 6000  --wait-idle 1
   Nothing is started or stopped here: the server is the caller's, and it took its turn in the GPU queue.

   Conditions (same task, same seed in every condition; the seed makes a run repeatable, it does not make it a fair sample):
     alone     one call, effort high, no notes, the code is not run before the score
     loop      the run-and-repair loop with no notes (notes OFF)
     notes     the loop plus verified notes retrieved from an OffsetShelfStore (notes ON)
     skill     the loop with a skill: its invariants and its BM25 cards (the same notes, plus the craft notes and a visual-quality
               system prompt for three.js), the effort the skill suggests; for three.js the loop's checker also runs the visual checks
     skillcal  the same, with the Caldera graphics skill registered next to the craft skill (shows what a trigger that is too wide does)
   The grounded questions (suite basic, kind qa) have no loop: alone, notes and skill only.
   Every final code is also run through the visual checks of js/evelyn_visual_craft.js and the result is recorded (visualErrors),
   whatever the condition, so the conditions can be compared on it. The notes were written by the same hand as the checks.
   Plain ES5. */
(function () {
  "use strict";
  var fs = require("fs");
  var path = require("path");
  var http = require("http");
  var cp = require("child_process");
  var S = require("../evelyn_stream.js");
  var A = require("../evelyn_inkling_agent.js");
  var CL = require("../evelyn_inkling_codeloop.js");
  var Skills = require("../evelyn_skills.js");
  var Caldera = require("../skill_caldera_graphics.js");
  var VC = require("../evelyn_visual_craft.js");
  var TT = require("./threejs_tasks.js");
  var BT = require("./basic_tasks.js");

  function arg(n, d) { var i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; }
  var PORT = Number(arg("port", 1249)), HOST = arg("host", "127.0.0.1"), MODEL = arg("model", "inkling"), BACKEND = arg("backend", "llama.cpp");
  var TRIALS = Number(arg("trials", 2)), MAXTOK = Number(arg("maxtokens", 6000));
  var SUITES = String(arg("suite", "basic,three")).split(",");
  var CONDS = String(arg("conds", "alone,loop,notes,skill,skillcal")).split(",");
  var OUT = path.resolve(arg("out", path.join(__dirname, "..", "..", "tests", "tmp", "skills_bench", BACKEND)));
  var WAIT_IDLE = arg("wait-idle", "0") === "1";
  fs.mkdirSync(path.join(OUT, "code"), { recursive: true });

  var VISUAL_WORKER = path.join(__dirname, "three_verify_worker.js");
  var VISUAL_MODULE = path.join(__dirname, "..", "evelyn_visual_craft.js");
  function isThree(s) { return s === "three" || s === "photo"; }
  var SYSTEM_PLAIN = "You are a careful engineer.";

  /* ---------- stores and skills ---------- */
  function store(records) { var s = new S.OffsetShelfStore(); s.buildFromRecords(records); return s; }
  var STORES = { three: store(TT.NOTES), photo: store(TT.NOTES.concat(TT.NOTES_PHOTO)), basic: store(BT.NOTES), qa: store(BT.QA_NOTES) };

  function skillRegistry(suite, withCaldera) {
    var reg = new Skills.SkillRegistry();
    if (isThree(suite)) {
      reg.register({
        name: "threejs-craft", description: "three.js r187 scenes: verified API notes and visual craft",
        triggers: ["three.js", "buildscene"], effortWithNotes: 0.30, effortNoNotes: 0.50,
        invariants: [
          "Reply with one function buildScene(THREE) that returns { scene, camera, update }; update(t) sets all animated state as a pure function of t.",
          "Obey every object count, geometry type and API name of the task exactly; add visual quality without adding meshes (Points, Sprite, fog).",
          "Use a strong key light with a weak ambient light, MeshStandardMaterial on lit objects, and frame the subject to fill about 60 percent of the view."
        ],
        records: TT.NOTES.concat(suite === "photo" ? TT.NOTES_PHOTO : [], VC.THREE_VISUAL_CRAFT_NOTES)
      });
    } else if (suite === "basic") {
      reg.register({
        name: "js-functions", description: "small pure JavaScript functions",
        triggers: ["function"], effortWithNotes: 0.30, effortNoNotes: 0.50,
        invariants: ["Define the function with the exact name and parameter order of the task; return the result; do not print it; do not change the input."],
        records: BT.NOTES
      });
    } else {
      reg.register({
        name: "brindlewick-lore", description: "facts about Brindlewick", triggers: ["brindlewick"],
        effortWithNotes: 0.30, effortNoNotes: 0.50,
        invariants: ["Answer only from the verified notes; if they do not hold the fact, say so."],
        records: BT.QA_NOTES
      });
    }
    if (withCaldera) Caldera.registerCalderaGraphicsSkill(reg);
    return reg;
  }

  /* ---------- jobs ---------- */
  var jobs = [];
  SUITES.forEach(function (suite) {
    var items = suite === "basic"
      ? Object.keys(BT.TASKS).map(function (id) { return { suite: "basic", kind: "code", task: id, text: BT.TASKS[id].text }; })
          .concat(Object.keys(BT.QA).map(function (id) { return { suite: "basic", kind: "qa", task: id, text: BT.QA[id].text }; }))
      : Object.keys(TT.TASKS).filter(function (id) { return (suite === "photo") === (id === "photo"); })
          .map(function (id) { return { suite: suite, kind: "code", task: id, text: TT.TASKS[id].text }; });
    items.forEach(function (it, ti) {
      for (var tr = 0; tr < TRIALS; tr++) CONDS.forEach(function (cond) {
        if (it.kind === "qa" && (cond === "loop" || cond === "skillcal")) return;
        if (cond === "skillcal" && !isThree(suite)) return;
        jobs.push({ suite: it.suite, kind: it.kind, task: it.task, text: it.text, trial: tr, cond: cond, seed: 2000 + ti * 100 + tr });
      });
    });
  });
  var key = function (j) { return [j.suite, j.task, j.trial, j.cond].join("/"); };

  var resultsPath = path.join(OUT, "results.json"), results = [], probe = null, serverCtx = null;
  if (fs.existsSync(resultsPath)) { try { var prev = JSON.parse(fs.readFileSync(resultsPath, "utf8")); results = prev.results || []; probe = prev.probe || null; } catch (e) { results = []; } }
  var done = {};
  results.forEach(function (r) { done[key(r)] = true; });

  function client(seed) {
    return new A.InklingClient({ host: HOST, port: PORT, model: MODEL, maxTokens: MAXTOK, temperature: 0.6, timeoutMs: 900000, extra: { seed: seed } });
  }

  /* ---------- verifiers ---------- */
  function verifyThree(task, code, visual) {
    var args = ["--permission", "--allow-fs-read=" + VISUAL_WORKER, "--allow-fs-read=" + path.dirname(TT.THREE_CJS)];
    if (visual) args.push("--allow-fs-read=" + VISUAL_MODULE);
    args.push(VISUAL_WORKER, TT.THREE_CJS, task);
    if (visual) args.push("visual");
    var r = cp.spawnSync(process.execPath, args, { input: code, encoding: "utf8", timeout: 20000 });
    if (r.error) return { ok: false, errors: ["verifier could not run: " + r.error.message] };
    var line = (r.stdout || "").trim().split("\n").pop();
    try { return JSON.parse(line); } catch (e) { return { ok: false, errors: ["verifier gave no result: " + String((r.stderr || r.stdout || "").slice(0, 200))] }; }
  }
  function verifier(job, visual) {
    if (isThree(job.suite)) return function (code) { return verifyThree(job.task, code, visual); };
    return function (code) { return BT.verifyCode(job.task, code); };
  }

  /* ---------- the conditions ---------- */
  function finishCode(job, code, base, cb) {
    if (code) {
      var dir = path.join(OUT, "code", job.suite, job.task);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, job.cond + "_run" + (job.trial + 1) + ".js"), code.replace(/\s+$/, "") + "\n");
      if (isThree(job.suite) && base.ok) {
        var v = verifyThree(job.task, code, true);
        base.visualErrors = v.ok ? [] : v.errors;
      }
    }
    base.code = code || null;
    cb(base);
  }

  function runCode(job, cb) {
    var c = client(job.seed), t0 = Date.now(), tokens = 0, marker = isThree(job.suite) ? "buildScene" : BT.TASKS[job.task].fn;
    var tools = { activeSkills: [], hits: 0 }, loopOpts = { client: c, marker: marker, maxRepairs: 2, verify: verifier(job, false), system: SYSTEM_PLAIN,
      onCall: function (info) { if (info.usage) tokens += info.usage.completion_tokens || 0; } };

    if (job.cond === "alone") {
      c.chat([{ role: "system", content: SYSTEM_PLAIN }, { role: "user", content: job.text }], "high", function (err, text) {
        var tk = c.lastUsage ? c.lastUsage.completion_tokens : 0;
        if (err) return cb({ ok: false, firstDraftOk: false, calls: 1, rounds: 0, tokens: tk, ms: Date.now() - t0, errors: ["no reply: " + err.message] });
        var code = CL.extractCode(text, marker);
        if (!code) return cb({ ok: false, firstDraftOk: false, calls: 1, rounds: 0, tokens: tk, ms: Date.now() - t0, errors: ["the reply has no closed fenced code block"] });
        var v = verifier(job, false)(code);
        finishCode(job, code, { ok: v.ok, firstDraftOk: v.ok, calls: 1, rounds: 0, tokens: tk, ms: Date.now() - t0, errors: v.errors }, cb);
      });
      return;
    }
    if (job.cond === "notes") loopOpts.store = STORES[job.suite];
    if (job.cond === "skill" || job.cond === "skillcal") {
      var pkt = skillRegistry(job.suite, job.cond === "skillcal").prepare(job.text, { topK: 4, maxSkills: 2 });
      tools.activeSkills = pkt.activeSkills;
      if (pkt.activeSkills.length) {
        loopOpts.store = pkt.store;
        loopOpts.system = (isThree(job.suite) ? VC.VISUAL_SYSTEM : SYSTEM_PLAIN) + "\n\n" + pkt.systemAddition;
        loopOpts.scheduleWith = [pkt.suggestedEffort, pkt.suggestedEffort / 2, 0.05];
        if (isThree(job.suite)) loopOpts.verify = verifier(job, true);
      }
    }
    new CL.EvelynCodeLoop(loopOpts).run(job.text, function (err, r) {
      if (err) return cb({ ok: false, firstDraftOk: false, calls: 0, rounds: 0, tokens: tokens, ms: Date.now() - t0, errors: [String(err.message || err)], activeSkills: tools.activeSkills });
      var last = r.history[r.history.length - 1];
      /* the pass is always the structural checker; a skill run that passed its own (structural + visual) checker also passes this one */
      var ok = r.ok;
      if (ok && job.cond.indexOf("skill") === 0 && isThree(job.suite)) ok = verifyThree(job.task, r.code, false).ok;
      finishCode(job, r.code, { ok: ok, firstDraftOk: r.firstDraftOk, calls: r.calls, rounds: r.rounds, tokens: tokens, ms: Date.now() - t0,
        errors: ok ? [] : last.errors, history: r.history, hits: r.hits, efforts: r.efforts, exhausted: r.exhausted, activeSkills: tools.activeSkills }, cb);
    });
  }

  function runQa(job, cb) {
    var c = client(job.seed), t0 = Date.now(), messages, effort = "high", active = [];
    if (job.cond === "alone") messages = [{ role: "system", content: SYSTEM_PLAIN }, { role: "user", content: job.text }];
    else {
      var hits, system = SYSTEM_PLAIN + " Answer only from the verified notes; if they do not hold the fact, say so.";
      effort = job.cond === "notes" ? "low" : 0.3;
      if (job.cond === "notes") hits = STORES.qa.searchFull(job.text, 3);
      else {
        var pkt = skillRegistry("qa", false).prepare(job.text, { topK: 3 });
        active = pkt.activeSkills; hits = pkt.excerpts;
        if (pkt.systemAddition) system += "\n\n" + pkt.systemAddition;
      }
      messages = [{ role: "system", content: system }, { role: "user", content: (hits.length ? "Verified notes:\n" + hits.map(function (h) { return "[" + h.shelf + "#" + h.id + " | " + h.topic + "] " + h.fullText; }).join("\n") + "\n\n" : "") + job.text }];
    }
    c.chat(messages, effort, function (err, text) {
      var tk = c.lastUsage ? c.lastUsage.completion_tokens : 0;
      if (err) return cb({ ok: false, firstDraftOk: false, calls: 1, rounds: 0, tokens: tk, ms: Date.now() - t0, errors: ["no reply: " + err.message], activeSkills: active });
      var v = BT.checkAnswer(job.task, text);
      cb({ ok: v.ok, firstDraftOk: v.ok, calls: 1, rounds: 0, tokens: tk, ms: Date.now() - t0, errors: v.errors, answer: String(text).slice(0, 300), activeSkills: active });
    });
  }

  /* ---------- the effort probe: does this server honour a numeric effort in chat_template_kwargs? ---------- */
  function runProbe(cb) {
    if (probe) return cb();
    var out = { question: "What is 17 + 25? Reply with the number only.", runs: [] }, efforts = [0.0, 0.9], i = 0;
    function next() {
      if (i >= efforts.length) { probe = out; return cb(); }
      var c = new A.InklingClient({ host: HOST, port: PORT, model: MODEL, maxTokens: 3000, temperature: 0.6, timeoutMs: 300000, extra: { seed: 7 } }), e = efforts[i++];
      c.chat([{ role: "user", content: out.question }], e, function (err, text) {
        out.runs.push({ effort: e, tokens: c.lastUsage ? c.lastUsage.completion_tokens : null, answer: err ? String(err.message).slice(0, 80) : String(text).slice(0, 40) });
        next();
      });
    }
    next();
  }

  function slotsBusy(cb) {
    http.get({ host: HOST, port: PORT, path: "/slots" }, function (res) {
      var b = []; res.on("data", function (d) { b.push(d); });
      res.on("end", function () { try { cb(JSON.parse(Buffer.concat(b).toString("utf8")).some(function (s) { return s.is_processing; })); } catch (e) { cb(false); } });
    }).on("error", function () { cb(false); });
  }
  function waitIdle(cb) {
    if (!WAIT_IDLE) return cb();
    var idleFor = 0;
    (function tick() {
      slotsBusy(function (busy) {
        idleFor = busy ? 0 : idleFor + 1;
        if (idleFor >= 4) return cb();
        if (!busy || idleFor === 0) process.stdout.write(busy ? "." : "");
        setTimeout(tick, 5000);
      });
    })();
  }

  function save() { fs.writeFileSync(resultsPath, JSON.stringify({ backend: BACKEND, model: MODEL, port: PORT, serverCtx: serverCtx, trials: TRIALS, probe: probe, results: results.map(function (r) { var c = {}, k; for (k in r) if (k !== "code") c[k] = r[k]; return c; }) }, null, 1)); }

  function summary() {
    var lines = [];
    SUITES.forEach(function (suite) {
      ["code", "qa"].forEach(function (kind) {
        var rs0 = results.filter(function (r) { return r.suite === suite && r.kind === kind; });
        if (!rs0.length) return;
        lines.push("\n" + suite + " / " + kind + "      runs  first-draft  final pass  calls  tokens  seconds" + (isThree(suite) ? "  visual-clean" : ""));
        CONDS.forEach(function (cond) {
          var rs = rs0.filter(function (r) { return r.cond === cond; });
          if (!rs.length) return;
          var n = rs.length, f = rs.filter(function (r) { return r.firstDraftOk; }).length, p = rs.filter(function (r) { return r.ok; }).length;
          var sum = function (k) { return rs.reduce(function (a, r) { return a + (r[k] || 0); }, 0); };
          var vis = rs.filter(function (r) { return r.ok && r.visualErrors; }), vclean = vis.filter(function (r) { return !r.visualErrors.length; }).length;
          lines.push("  " + cond.padEnd(9) + String(n).padStart(4) + "  " + (f + "/" + n).padStart(10) + "  " + (p + "/" + n).padStart(10) + "  " + (sum("calls") / n).toFixed(1).padStart(5) + "  " + String(Math.round(sum("tokens") / n)).padStart(6) + "  " + (sum("ms") / n / 1000).toFixed(0).padStart(7) +
            (isThree(suite) ? "  " + (vclean + "/" + vis.length).padStart(10) : ""));
        });
      });
    });
    return lines.join("\n");
  }

  var idx = 0;
  function next() {
    if (idx >= jobs.length) { save(); console.log(summary()); console.log("\nresults: " + resultsPath); process.exit(0); }
    var job = jobs[idx++];
    if (done[key(job)]) return next();
    waitIdle(function () {
      (job.kind === "qa" ? runQa : runCode)(job, function (r) {
        r.suite = job.suite; r.kind = job.kind; r.task = job.task; r.trial = job.trial; r.cond = job.cond; r.seed = job.seed;
        var keep = {}, k; for (k in r) if (k !== "code") keep[k] = r[k];
        results.push(keep); save();
        console.log("[" + idx + "/" + jobs.length + "] " + job.suite + "/" + job.task + " " + job.cond + " t" + job.trial + ": " + (r.ok ? "PASS" : "FAIL") +
          (r.firstDraftOk ? " (first)" : (r.ok ? " (repaired)" : "")) + "  " + r.calls + " call(s), " + r.tokens + " tok, " + Math.round(r.ms / 1000) + " s" +
          (r.activeSkills && r.activeSkills.length ? "  skills=" + r.activeSkills.join("+") : "") +
          (r.visualErrors && r.visualErrors.length ? "  visual:" + r.visualErrors.length : "") + (r.ok ? "" : "  | " + String((r.errors || ["?"])[0]).slice(0, 110)));
        next();
      });
    });
  }

  http.get({ host: HOST, port: PORT, path: "/props" }, function (res) {
    var b = []; res.on("data", function (d) { b.push(d); });
    res.on("end", function () { try { serverCtx = JSON.parse(Buffer.concat(b).toString("utf8")).default_generation_settings.n_ctx; } catch (e) { serverCtx = null; } start(); });
  }).on("error", function () { serverCtx = null; start(); });

  function start() {
    console.log("=== " + BACKEND + " " + MODEL + " port " + PORT + ", server context " + serverCtx + ": " + jobs.length + " runs (" + results.length + " already done) ===");
    waitIdle(function () { runProbe(function () { console.log("effort probe: " + JSON.stringify(probe.runs)); next(); }); });
  }
})();
