/* evelyn_skills_bench_tests.js - the bench runner (evelyn_skills_bench.js) against the mock server: what it logs, and that the log is consistent.
   node js/test/evelyn_skills_bench_tests.js
   A short run (basic suite, tasks sumEven and bells, trial 1, four setups) goes to a temporary folder; then tests/check_bench_results.js reads the
   file, and this test looks at the new fields (schema 2), the transcripts and the saved code. No model, no GPU. Plain ES5. */
"use strict";
var path = require("path");
var os = require("os");
var fs = require("fs");
var cp = require("child_process");
var crypto = require("crypto");
var JS = path.join(__dirname, "..");
var ROOT = path.join(JS, "..");

var passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("[PASS] " + name); } else { failed++; console.log("[FAIL] " + name + (detail ? " | " + String(detail).slice(0, 300) : "")); }
}

var srv = cp.spawn(process.execPath, [path.join(ROOT, "tests", "mock_llm_server.js"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
process.on("exit", function () { try { srv.kill(); } catch (e) { /* done */ } });
srv.stdout.once("data", function (d) {
  var port = JSON.parse(String(d)).port;
  var out = fs.mkdtempSync(path.join(os.tmpdir(), "evl-bench-"));
  var info = path.join(out, "server.log");
  fs.writeFileSync(info, "noise" + String.fromCharCode(10) + JSON.stringify({ ready: true, device: "CUDA0", kv_type: "q8_0", ctx: 1234 }) + String.fromCharCode(10));
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, "evelyn_skills_bench.js"), "--port", String(port), "--backend", "mock", "--model", "mock-model", "--suite", "basic",
    "--only", "sumEven,bells", "--trials", "1", "--conds", "alone,loop,notes,skill", "--out", out, "--server-info", info], { encoding: "utf8", timeout: 120000 });
  check("the runner ends with exit 0", r.status === 0, r.stderr + r.stdout.slice(-300));
  var file = path.join(out, "results.json"), data = null;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { data = null; }
  check("results.json is written and parses", !!data);
  if (!data) { finish(); return; }
  var R = data.results;
  check("schema 2 at the top and a meta block", data.schema === 2 && data.meta && data.meta.nodeVersion === process.version, JSON.stringify(data.meta).slice(0, 200));
  check("meta has the settings, the start line of the server and the effort probe is there", data.meta.settings.only.length === 2 && data.meta.serverStart && data.meta.serverStart.kv_type === "q8_0" && data.probe && data.probe.runs.length === 2, JSON.stringify(data.meta.serverStart));
  check("meta has the repository commit, the three.js version, a start time", typeof data.meta.startedAt === "string" && (data.meta.repoCommit === null || /^[0-9a-f]{40}$/.test(data.meta.repoCommit)) && /^\d+\.\d+/.test(data.meta.threeVersion || "0.0"), JSON.stringify([data.meta.repoCommit, data.meta.threeVersion]));
  check("runs: sumEven in 4 setups and bells in 3 (no loop for a question)", R.length === 7, R.length);
  var one = R.filter(function (x) { return x.task === "sumEven" && x.cond === "alone"; })[0];
  check("a run has start and end times, token counts, speed and the call detail", one && one.schema === 2 && one.startedAt && one.finishedAt && one.promptTokens > 0 && one.completionTokens >= 0 && one.calls_detail.length === 1 && one.calls_detail[0].finishReason === "stop" && one.calls_detail[0].thinkingChars === 27, JSON.stringify(one).slice(0, 300));
  var loop = R.filter(function (x) { return x.task === "sumEven" && x.cond === "notes"; })[0];
  check("a notes run records what the search found (topics and scores)", loop.retrieval && loop.retrieval.hits.length > 0 && typeof loop.retrieval.hits[0].topic === "string" && typeof loop.retrieval.hits[0].score === "number" && typeof loop.retrieval.topScore === "number", JSON.stringify(loop.retrieval).slice(0, 200));
  var skill = R.filter(function (x) { return x.task === "sumEven" && x.cond === "skill"; })[0];
  check("a skill run names the active skill and has a history", skill.activeSkills.indexOf("js-functions") >= 0 && skill.history.length === skill.calls, JSON.stringify(skill.activeSkills));
  var code = path.join(out, "code", "basic", "sumEven", "notes_run1.js");
  check("the saved code file matches codeSha256", fs.existsSync(code) && crypto.createHash("sha256").update(fs.readFileSync(code)).digest("hex") === loop.codeSha256 && loop.codeChars === fs.readFileSync(code).length, loop.codeSha256);
  var tr = null;
  try { tr = JSON.parse(fs.readFileSync(path.join(out, loop.transcript), "utf8")); } catch (e) { tr = null; }
  check("the transcript holds the messages, the reply and the thinking text of every call", tr && tr.calls.length === loop.calls && tr.calls[0].messages.length >= 2 && /function sumEven/.test(tr.calls[0].reply) && tr.calls[0].reasoning === "mock reasoning for the test", tr && JSON.stringify(tr).slice(0, 200));
  var q = R.filter(function (x) { return x.task === "bells" && x.cond === "notes"; })[0];
  check("a question run has the answer, the retrieval and one call", q.answer && q.calls === 1 && q.retrieval && q.retrieval.hits.length > 0 && q.calls_detail.length === 1, JSON.stringify(q).slice(0, 200));
  var v = cp.spawnSync(process.execPath, [path.join(ROOT, "tests", "check_bench_results.js"), file], { encoding: "utf8" });
  check("tests/check_bench_results.js finds the file consistent", v.status === 0, v.stdout);
  var bad = JSON.parse(JSON.stringify(data));
  bad.results[0].ok = true; bad.results[0].errors = ["x"];
  bad.results[1].calls_detail = [];
  var badFile = path.join(out, "bad.json");
  fs.writeFileSync(badFile, JSON.stringify(bad));
  var vb = cp.spawnSync(process.execPath, [path.join(ROOT, "tests", "check_bench_results.js"), badFile], { encoding: "utf8" });
  check("the checker rejects a file where a pass has errors and the call detail is missing", vb.status === 1 && /passed but has errors/.test(vb.stdout) && /calls_detail/.test(vb.stdout), vb.stdout);
  var dead = JSON.parse(JSON.stringify(data));
  dead.results[2].errors = ["no reply: connect ECONNREFUSED 127.0.0.1:1249"]; dead.results[2].ok = false;
  var deadFile = path.join(out, "dead.json");
  fs.writeFileSync(deadFile, JSON.stringify(dead));
  var vd = cp.spawnSync(process.execPath, [path.join(ROOT, "tests", "check_bench_results.js"), deadFile], { encoding: "utf8" });
  check("the checker rejects a row made against a dead server", vd.status === 1 && /server that was not there/.test(vd.stdout), vd.stdout);
  /* a second run on the same folder resumes: nothing is run again and the meta records the resume */
  var r2 = cp.spawnSync(process.execPath, [path.join(__dirname, "evelyn_skills_bench.js"), "--port", String(port), "--backend", "mock", "--model", "mock-model", "--suite", "basic",
    "--only", "sumEven,bells", "--trials", "1", "--conds", "alone,loop,notes,skill", "--out", out], { encoding: "utf8", timeout: 60000 });
  var data2 = JSON.parse(fs.readFileSync(file, "utf8"));
  check("a second run resumes: same 7 rows, the resume is in meta", r2.status === 0 && data2.results.length === 7 && data2.meta.resumedAt && data2.meta.resumedAt.length === 1, r2.stdout.slice(-200));
  finish();
});

function finish() {
  console.log("\n=== BENCH RUNNER LOGGING SUITE: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
}
