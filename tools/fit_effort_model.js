/* fit_effort_model.js - fit the effort model on the rows that the three.js benchmark logged.
   node tools/fit_effort_model.js results1.json [results2.json ...] [--out effort_model.json] [--min-rows 20]

   A row is a run of Evelyn's code loop (conditions loop and notes) with its features, the effort of its first call, whether the first
   draft passed and the tokens of that call. Files from before the loop logged features have no rows and are skipped.
   Prints how many rows there were, whether the model could be fitted (with the reason when not), and what it would choose for the
   three tasks of the benchmark. With few rows the answer is "default": that is the honest result, not an error. */
"use strict";
var fs = require("fs");
var path = require("path");
var M = require("../js/evelyn_effort_model.js");

function arg(n, d) { var i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; }
var OUT = arg("out", null), MIN = Number(arg("min-rows", 20));
var files = process.argv.slice(2).filter(function (a, i, all) { return /\.json$/.test(a) && all[i - 1] !== "--out"; });
var rows = [], skipped = 0;
files.forEach(function (f) {
  JSON.parse(fs.readFileSync(f, "utf8")).results.forEach(function (r) {
    if (!r.features || !r.efforts || !r.efforts.length || r.cond === "alone") { skipped++; return; }
    rows.push(M.rowFromRun({ features: r.features, efforts: r.efforts, firstDraftOk: r.firstDraftOk, tokens: r.callTokens }));
  });
});
var model = new M.EffortModel({ minRows: MIN }).fit(rows);
var pass = rows.filter(function (r) { return r.ok; }).length;
console.log("rows: " + rows.length + " (" + pass + " first drafts passed, " + (rows.length - pass) + " failed), " + skipped + " runs skipped");
console.log("model: " + (model.fitted ? "fitted" : "NOT fitted") + " - " + model.reason);
var probes = [
  { name: "task with notes, strong hit", f: { hits: 4, topScore: 14, relGap: 0.3, promptChars: 2600, hasCodeWords: 1 } },
  { name: "task with no notes", f: { hits: 0, topScore: 0, relGap: 0, promptChars: 480, hasCodeWords: 1 } }
];
probes.forEach(function (p) {
  var c = model.choose(p.f);
  console.log("  " + p.name + ": effort " + c.effort + ", max tokens " + c.maxTokens + ", source " + c.source + (c.pPass !== undefined ? ", P(pass) " + c.pPass.toFixed(2) : ""));
});
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(model.toJSON(), null, 1)); console.log("saved " + OUT + " (" + fs.statSync(OUT).size + " bytes)"); }
