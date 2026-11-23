/* eval_roles.js - does a trained TINY.BIN help? Runs the held-out pairs through the engine that really runs it.
   node tools/eval_roles.js --tiny tests/tmp/TINY.BIN --val tests/tmp/TINY.BIN.val.jsonl [--threshold 1.25]

   Router: for each held-out RT: pair, the KV21 role "RT:" is run on the question; the text must equal the label (LOW or HIGH).
   Reported for every pair, for the pairs whose smallest margin reached the threshold and for the rest.
   Expander: for each held-out EXP: pair, the shelf (the three.js notes and the starter library, topics as entries) is searched with
   the question alone and with the question plus the expander's words (used only when its margin reached the threshold). The right
   entry is the one whose topic is the pair's target. Reported: the right entry first, and among the first three, for both ways.
   The shelf here is small (26 entries), so plain search is already good; this measures whether the expander adds anything on top.
   No random numbers, so the same files give the same numbers. */
"use strict";
var fs = require("fs");
var path = require("path");
var E = require("../js/evelyn_core.js");
var S = require("../js/evelyn_stream.js");
var C = require("../js/evelyn_cascade.js");
var TT = require("../js/test/threejs_tasks.js");

function arg(n, d) { var i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; }
var TINY = arg("tiny"), VAL = arg("val", TINY + ".val.jsonl"), THR = Number(arg("threshold", 1.25));
if (!TINY || !fs.existsSync(TINY)) { console.log("usage: node tools/eval_roles.js --tiny TINY.BIN [--val file]"); process.exit(2); }

var buf = fs.readFileSync(TINY);
var model = new E.Tiny2Model();
model.loadFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
var pool = new C.KV21SubagentPool(model);
pool.registerRole("router", "RT:"); pool.registerRole("expander", "EXP:");

var rows = fs.readFileSync(VAL, "utf8").split("\n").filter(Boolean).map(function (l) { return JSON.parse(l); });

/* the shelf: same notes as tools/make_role_pairs.js */
var recs = TT.NOTES.map(function (n) { return { shelf: "three", topic: n.topic, fullText: n.fullText }; });
var lib = new E.LibraryStore("evelyn_eval_tmp"); lib.clear(); lib.loadStarterPack();
lib.records.forEach(function (r) { var h = lib.readRecord(r); recs.push({ shelf: "starter", topic: h.topic, fullText: h.fact + (h.ex ? " " + h.ex : "") }); });
var store = new S.OffsetShelfStore(); store.buildFromRecords(recs);
function rankIds(q) { return store.rank(q).map(function (x) { return x[0]; }); }
function idOfTopic(t) { for (var i = 0; i < store.entries.length; i++) if (E.cleanAscii(store.entries[i].topic).toLowerCase() === t) return i; return -1; }

var r = { n: 0, ok: 0, nHi: 0, okHi: 0, nLo: 0, okLo: 0, byLabel: { LOW: [0, 0], HIGH: [0, 0] } };
var x = { n: 0, plain1: 0, plain3: 0, exp1: 0, exp3: 0, used: 0, exact: 0, plain1Used: 0, exp1Used: 0 };
rows.forEach(function (row) {
  if (row.prompt.indexOf("RT:") === 0) {
    var q = row.prompt.slice(3), out = pool.runRole("router", q, 8), got = out.text.replace(/\s+/g, "");
    r.n++; r.byLabel[row.target][1]++;
    if (got === row.target) { r.ok++; r.byLabel[row.target][0]++; }
    if (out.minMargin >= THR) { r.nHi++; if (got === row.target) r.okHi++; } else { r.nLo++; if (got === row.target) r.okLo++; }
  } else if (row.prompt.indexOf("EXP:") === 0) {
    var qq = row.prompt.slice(4), want = idOfTopic(row.target);
    if (want < 0) return;
    var ex = pool.runRole("expander", qq, 30), plain = rankIds(qq), useIt = ex.minMargin >= THR && ex.text;
    var expanded = useIt ? rankIds(qq + " " + ex.text) : plain;
    x.n++;
    if (plain[0] === want) x.plain1++; if (plain.slice(0, 3).indexOf(want) >= 0) x.plain3++;
    if (expanded[0] === want) x.exp1++; if (expanded.slice(0, 3).indexOf(want) >= 0) x.exp3++;
    if (useIt) { x.used++; if (plain[0] === want) x.plain1Used++; if (expanded[0] === want) x.exp1Used++; }
    if (ex.text === row.target.slice(0, 30)) x.exact++;
  }
});
function pct(a, b) { return b ? (100 * a / b).toFixed(0) + "% (" + a + " of " + b + ")" : "n/a"; }
console.log("held-out pairs: " + rows.length + "; margin threshold " + THR);
console.log("ROUTER  right label: " + pct(r.ok, r.n) + "   LOW " + pct(r.byLabel.LOW[0], r.byLabel.LOW[1]) + "   HIGH " + pct(r.byLabel.HIGH[0], r.byLabel.HIGH[1]));
console.log("        confident (margin >= threshold): " + pct(r.okHi, r.nHi) + "   unsure: " + pct(r.okLo, r.nLo));
console.log("EXPANDER question alone, right entry first: " + pct(x.plain1, x.n) + ", in the first three: " + pct(x.plain3, x.n));
console.log("        with the expansion (when confident): first " + pct(x.exp1, x.n) + ", in the first three: " + pct(x.exp3, x.n));
console.log("        expansion used on " + pct(x.used, x.n) + "; on those, first-place alone " + pct(x.plain1Used, x.used) + " against with expansion " + pct(x.exp1Used, x.used));
console.log("        the expander wrote the exact topic: " + pct(x.exact, x.n));
console.log(JSON.stringify({ router: r, expander: x, threshold: THR }));
