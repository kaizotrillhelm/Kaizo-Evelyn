/* basic_verify_worker.js - runs model-written plain JavaScript on test cases.
   Started by basic_tasks.js as:
     node --permission --allow-fs-read=<this file> basic_verify_worker.js <fnName> <casesJson> <mutatesFirstArg 0|1>
   with the code on stdin. Node's permission model is on: the code cannot write files, open sockets or start programs.
   Prints one JSON line { ok, errors }. Plain ES5. */
"use strict";
var vm = require("vm");
var fnName = process.argv[2], cases = JSON.parse(process.argv[3]), keepInput = process.argv[4] === "1";

function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

var chunks = [];
process.stdin.on("data", function (d) { chunks.push(d); });
process.stdin.on("end", function () {
  var code = Buffer.concat(chunks).toString("utf8"), errors = [];
  function out() { process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors: errors.slice(0, 6) }) + "\n"); }
  var fn;
  try {
    fn = vm.runInNewContext(code + "\n;typeof " + fnName + " === 'function' ? " + fnName + " : null", { Math: Math, console: { log: function () {}, warn: function () {}, error: function () {} } }, { timeout: 3000 });
  } catch (e) { errors.push("the code did not load: " + String(e && e.message || e).slice(0, 160)); return out(); }
  if (typeof fn !== "function") { errors.push("the code does not define a function named " + fnName); return out(); }
  cases.forEach(function (c, i) {
    var args = JSON.parse(JSON.stringify(c[0])), before = canon(args), got;
    try { got = vm.runInNewContext("f.apply(null, a)", { f: fn, a: args }, { timeout: 2000 }); } catch (e2) { errors.push("case " + i + " threw: " + String(e2 && e2.message || e2).slice(0, 100)); return; }
    if (canon(got) !== canon(c[1])) errors.push("case " + i + ": " + fnName + "(" + JSON.stringify(c[0]).slice(1, -1).slice(0, 60) + ") returned " + canon(got).slice(0, 60) + ", expected " + canon(c[1]).slice(0, 60));
    if (keepInput && canon(args) !== before) errors.push("case " + i + ": the function changed its input");
  });
  out();
});
