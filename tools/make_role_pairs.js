/* make_role_pairs.js - Inkling writes the training pairs for Evelyn's two small roles.
   node tools/make_role_pairs.js --port 1249 --out tests/tmp/pairs.jsonl [--per-note 16] [--router 90] [--seed 500]

   EXP: pairs: for every note of the shelves, Inkling writes casual questions that need that note without using its words; the pair is
   { prompt: "EXP:<question>", target: "<the note's topic, lower case>" }.
   RT: pairs: Inkling writes quick lookups (target LOW) and real coding or design tasks (target HIGH).
   The labels come from the instruction given to Inkling, not from how Inkling did on the tasks, and everything is written by one model:
   a model trained on these pairs learns this model's idea of a messy question. Nothing here needs more than the server on --port
   (the GPU queue is the one that started it). Plain Node, ES5 style. */
"use strict";
var fs = require("fs");
var path = require("path");
var E = require("../js/evelyn_core.js");
var A = require("../js/evelyn_inkling_agent.js");
var TT = require("../js/test/threejs_tasks.js");

function arg(n, d) { var i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; }
var PORT = Number(arg("port", 1249)), OUT = arg("out", path.join(__dirname, "..", "tests", "tmp", "pairs.jsonl"));
var PER_NOTE = Number(arg("per-note", 16)), ROUTER_N = Number(arg("router", 90)), SEED = Number(arg("seed", 500));

/* the notes: the three.js shelf and the starter library of the core */
function notes() {
  var out = TT.NOTES.map(function (n) { return { topic: n.topic, text: n.fullText }; });
  var lib = new E.LibraryStore("evelyn_pairs_tmp"); lib.clear(); lib.loadStarterPack();
  var hits = lib.records.map(function (r) { return lib.readRecord(r); });
  hits.forEach(function (h) { out.push({ topic: h.topic, text: h.fact + (h.ex ? " " + h.ex : "") }); });
  return out;
}

function clean(line) {
  var t = E.cleanAscii(String(line)).replace(/^[\s\-*\d.)"']+/, "").replace(/["']+$/, "").replace(/\s+/g, " ").trim();
  return t;
}
function lines(text) {
  return String(text).split(/\r?\n/).map(clean).filter(function (t) { return t.length >= 8 && t.length <= 90 && !/^(here|sure|note|these)\b/i.test(t) && !/:$/.test(t); });
}

var seed = SEED;
function ask(prompt, cb) {
  var client = new A.InklingClient({ port: PORT, model: "inkling", maxTokens: 1500, temperature: 0.9, timeoutMs: 300000, extra: { seed: seed++ } });
  client.chat([{ role: "user", content: prompt }], 0.1, function (err, text) { cb(err, text ? lines(text) : []); });
}

var pairs = [], seen = Object.create(null);
function add(prompt, target) { var key = prompt + "|" + target; if (seen[key]) return false; seen[key] = 1; pairs.push({ prompt: prompt, target: target }); return true; }

function forNotes(list, i, done) {
  if (i >= list.length) return done();
  var n = list[i];
  var p = "Here is a reference note.\nTOPIC: " + n.topic + "\nTEXT: " + n.text + "\n\n" +
    "Write " + PER_NOTE + " different things a person might type when they need this note. Casual wording, some of them complaints or vague descriptions of a problem. " +
    "Say it another way instead of reusing the topic's own words. One per line, no numbering, no quotes, under 80 characters.";
  ask(p, function (err, qs) {
    var got = 0;
    if (!err) qs.forEach(function (q) { if (add("EXP:" + q, E.cleanAscii(n.topic).toLowerCase())) got++; });
    console.log("[" + (i + 1) + "/" + list.length + "] " + n.topic + ": " + got + " questions" + (err ? " (" + err.message.slice(0, 60) + ")" : ""));
    forNotes(list, i + 1, done);
  });
}

function forRouter(kind, target, want, done) {
  var got = 0, tries = 0;
  (function more() {
    if (got >= want || tries >= 12) return done();
    tries++;
    var p = kind === "easy"
      ? "Write 25 different short requests a person might type to an AI assistant that are EASY: a quick fact, a definition, a one-line lookup, a small conversion or a how-long-do-I-wait question. One per line, no numbering, no quotes, under 80 characters, every one about a different subject."
      : "Write 25 different requests a person might type to an AI assistant that are HARD: they need real programming or design work, such as writing an algorithm, a data structure, a game, a 3D scene, a parser, a concurrent program or debugging a tricky bug. One per line, no numbering, no quotes, under 80 characters, every one about a different subject.";
    ask(p, function (err, qs) {
      if (!err) qs.forEach(function (q) { if (got < want && add("RT:" + q, target)) got++; });
      console.log("router " + target + ": " + got + " of " + want + " (try " + tries + (err ? ", " + err.message.slice(0, 60) : "") + ")");
      more();
    });
  })();
}

var list = notes();
console.log(list.length + " notes, " + PER_NOTE + " questions each, " + ROUTER_N + " router pairs each way");
forNotes(list, 0, function () {
  forRouter("easy", "LOW", ROUTER_N, function () {
    forRouter("hard", "HIGH", ROUTER_N, function () {
      /* a fixed shuffle so every fifth line (the held-out ones) mixes the kinds */
      var s = 12345; function r() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
      for (var i = pairs.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = pairs[i]; pairs[i] = pairs[j]; pairs[j] = t; }
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, pairs.map(function (p) { return JSON.stringify(p); }).join("\n") + "\n");
      var ex = pairs.filter(function (p) { return p.prompt.indexOf("EXP:") === 0; }).length;
      console.log("wrote " + pairs.length + " pairs (" + ex + " EXP, " + (pairs.length - ex) + " RT) to " + OUT);
    });
  });
});
