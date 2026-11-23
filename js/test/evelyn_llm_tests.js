/* evelyn_llm_tests.js - the model loader and agent front (js/evelyn_llm.js), the client's browser path and the command line, against a mock server.
   node js/test/evelyn_llm_tests.js
   The mock is the one of tests/mock_llm_server.js (started as a child process, CORS on). No model, no GPU, nothing leaves the machine. Plain ES5. */
"use strict";
var path = require("path");
var os = require("os");
var fs = require("fs");
var cp = require("child_process");
var JS = path.join(__dirname, "..");
var ROOT = path.join(JS, "..");
var E = require(path.join(JS, "evelyn_core.js"));
var A = require(path.join(JS, "evelyn_inkling_agent.js"));
var LLM = require(path.join(JS, "evelyn_llm.js"));

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function assert(c, m) { if (!c) throw new Error(m || "assertion failed"); }

var srv = cp.spawn(process.execPath, [path.join(ROOT, "tests", "mock_llm_server.js"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
var PORT = 0;
srv.stdout.once("data", function (d) { PORT = JSON.parse(String(d)).port; run(); });
process.on("exit", function () { try { srv.kill(); } catch (e) { /* done */ } });

function mk(extra) {
  var lib = new E.LibraryStore("evelyn_llm_test"); lib.clear(); lib.loadStarterPack();
  var pm = new E.ProfileManager("evelyn_llm_test"); pm.reset();
  var o = { lib: lib, pm: pm, url: "http://127.0.0.1:" + PORT, model: "mock-model" }, k;
  for (k in extra) o[k] = extra[k];
  return LLM.create(o);
}

test("client: baseUrl is parsed, models() lists the server's ids", function (done) {
  var c = new A.InklingClient({ baseUrl: "http://127.0.0.1:" + PORT + "/" });
  assert(c.host === "127.0.0.1" && c.port === PORT && c.pathPrefix === "", "host, port and prefix");
  c.models(function (err, ids) { try { assert(!err && ids.indexOf("mock-model") >= 0, String(err)); done(); } catch (e) { done(e); } });
});
test("client: a closed port is reported in words, once", function (done) {
  var c = new A.InklingClient({ baseUrl: "http://127.0.0.1:9" }), n = 0;
  c.models(function (err) { n++; try { assert(err && /not reachable/.test(err.message), String(err)); assert(n === 1); setTimeout(done, 50); } catch (e) { done(e); } });
});
test("test(): reports the server and whether the model is listed", function (done) {
  mk().test(function (err, r) { try { assert(!err && r.hasModel && r.models.length === 2, JSON.stringify(r)); done(); } catch (e) { done(e); } });
});
test("ask(): a sum goes through the fast path with no model call", function (done) {
  mk().ask("17+25", function (err, r) { try { assert(!err && !r.inklingCalled && /42/.test(r.answer)); done(); } catch (e) { done(e); } });
});
test("ask(): a question goes to the model; with notes off the library is not sent", function (done) {
  mk({ notes: false }).ask("How many bells does the harbour tower of Brindlewick have?", function (err, r) {
    try { assert(!err && r.inklingCalled && /17 bells/.test(r.answer) && r.hits === 0, JSON.stringify(r)); done(); } catch (e) { done(e); }
  });
});
test("write(): the code loop returns code the checker passed", function (done) {
  mk().write("function sumEven(a) returns the sum of the even numbers", function (err, r) {
    try { assert(!err && r.ok && /function sumEven/.test(r.code) && r.calls === 1, JSON.stringify(r).slice(0, 200)); done(); } catch (e) { done(e); }
  });
});
test("write(): a first reply that does not parse is repaired (2 calls)", function (done) {
  mk().write("function broken() returns 1", function (err, r) {
    try { assert(!err && r.ok && r.calls === 2 && r.history[0].ok === false, JSON.stringify(r.history)); done(); } catch (e) { done(e); }
  });
});
test("skills: a three.js task activates the craft skill, a plain one activates none", function (done) {
  var llm = mk();
  var a = llm.skillRegistry.prepare("Write a three.js scene", {}), b = llm.skillRegistry.prepare("function sumEven(a) returns", {});
  try { assert(a.activeSkills.indexOf("threejs-visual-craft") >= 0 && b.activeSkills.length === 0, JSON.stringify([a.activeSkills, b.activeSkills])); done(); } catch (e) { done(e); }
});
test("verifiers: node runs and checks the name; the browser one only parses", function (done) {
  var nv = LLM.nodeVerifier("f"), pv = LLM.parseVerifier("f");
  try {
    assert(nv("function f(){return 1}").ok && !nv("function g(){}").ok && !nv("while(true){}").ok && !nv("function f( {").ok, "node verifier");
    assert(pv("function f(){while(true){}}").ok && !pv("function g(){}").ok && !pv("function f( {").ok, "parse verifier");
    done();
  } catch (e) { done(e); }
});
test("command line: /llm, /agent, /write, /bins with piped input", function (done) {
  var data = path.join(os.tmpdir(), "evl-llm-cli-" + process.pid);
  var input = ["/llm", "/agent 17+25", "/agent How many bells does the harbour tower of Brindlewick have?", "/write function sumEven(a) returns the sum of the even numbers", "/bins", "/quit"].join(String.fromCharCode(10)) + String.fromCharCode(10);
  var r = cp.spawnSync(process.execPath, [path.join(JS, "evelyn_cli.js"), "--data", data, "--llm", "http://127.0.0.1:" + PORT, "--llm-model", "mock-model"], { input: input, encoding: "utf8", timeout: 60000 });
  var out = r.stdout || "";
  try {
    assert(r.status === 0, "exit " + r.status + " " + r.stderr);
    assert(/Reachable: .* lists 2 model/.test(out), "llm test line");
    assert(/17 \+ 25 = 42/.test(out) && /Fast-Path/.test(out), "agent sum");
    assert(/17 bells/.test(out), "agent model answer");
    assert(/function sumEven/.test(out) && /the checker passed it/.test(out), "write");
    assert(/No pack loaded/.test(out), "bins");
    done();
  } catch (e) { done(new Error(e.message + " | " + out.slice(-600))); }
});
test("command line: without --llm the new commands say so", function (done) {
  var data = path.join(os.tmpdir(), "evl-llm-cli2-" + process.pid);
  var r = cp.spawnSync(process.execPath, [path.join(JS, "evelyn_cli.js"), "--data", data], { input: "/llm" + String.fromCharCode(10) + "/quit" + String.fromCharCode(10), encoding: "utf8", timeout: 30000 });
  try { assert(r.status === 0 && /No language model set/.test(r.stdout), r.stdout); done(); } catch (e) { done(e); }
});
test("command line: --pack resolves the tutor .bin by tier", function (done) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "evl-pack-"));
  fs.writeFileSync(path.join(dir, "tutor.bin"), require(path.join(ROOT, "tools", "make_test_model.js")).build({ seed: 5 }));
  fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ bins: [{ id: "tutor_small", role: "tutor", backend: "*", file: "tutor.bin", format: "TNY2", minTier: "potato" }] }));
  var r = cp.spawnSync(process.execPath, [path.join(JS, "evelyn_cli.js"), "--data", path.join(dir, "d"), "--pack", path.join(dir, "pack.json"), "--tier", "potato"], { input: "/bins" + String.fromCharCode(10) + "/quit" + String.fromCharCode(10), encoding: "utf8", timeout: 30000 });
  try { assert(r.status === 0 && /tutor 'tutor_small' loaded for tier potato/.test(r.stdout) && /tutor: tutor_small/.test(r.stdout) && /router: none/.test(r.stdout), r.stdout + r.stderr); done(); } catch (e) { done(e); }
});

function run() {
  var passed = 0, failed = 0, idx = 0;
  (function next() {
    if (idx >= tests.length) {
      console.log("\n=== MODEL LOADER AND AGENT SUITE: " + passed + " passed, " + failed + " failed ===");
      process.exit(failed ? 1 : 0);
    }
    var cur = tests[idx++], fin = false;
    function done(err) {
      if (fin) return; fin = true;
      if (err) { failed++; console.log("[FAIL] " + cur.name + String.fromCharCode(10) + "       " + (err.stack || err)); } else { passed++; console.log("[PASS] " + cur.name); }
      setTimeout(next, 0);
    }
    try { cur.fn(done); } catch (e) { done(e); }
  })();
}
