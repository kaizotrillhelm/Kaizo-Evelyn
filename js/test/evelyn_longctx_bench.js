/* evelyn_longctx_bench.js - a needle in a haystack: the whole pile in Inkling's prompt, or Evelyn's shelf search sending the one record.
   node js/test/evelyn_longctx_bench.js --port 1249 [--records 2700] [--questions 6] [--out tests/tmp/longctx_results.json]

   The haystack is synthetic: one sentence for each of N invented stations ("Station Quenmora (sector 14) keeps the copper valves in locker
   B47-K and opens at 6:30 AM."), 40 items shared by many stations, so a question has to name its station to be answerable.
   Each question asks for the locker of one station. Two ways, the same model, the same effort:
     pile    every record is in the prompt (as much of the server's context as the records fill), then the question;
     evelyn  the records are an OffsetShelfStore of N entries, BM25 finds the top 3, EvelynInklingAgent sends those (about 150 tokens)
             and checks the answer's numbers against them.
   An answer is right when it contains the locker code. The tool prints the prompt size the server counted, the time and the tokens of
   each, and says whether the server's context (read from /props) held the pile. The pile's first question pays the whole prefill; later
   questions reuse the server's prompt cache for the same start, so both the first and the later times are shown.
   Plain ES5 style. Nothing is started or stopped here. */
(function () {
  "use strict";
  var fs = require("fs");
  var path = require("path");
  var http = require("http");
  var S = require("../evelyn_stream.js");
  var A = require("../evelyn_inkling_agent.js");
  var E = require("../evelyn_core.js");

  function arg(n, d) { var i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; }
  var PORT = Number(arg("port", 1249)), N = Number(arg("records", 2700)), Q = Number(arg("questions", 6));
  var OUT = path.resolve(arg("out", path.join(__dirname, "..", "..", "tests", "tmp", "longctx_results.json")));

  var s = 424242; function r() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  function pick(a) { return a[Math.floor(r() * a.length)]; }
  var SYL = ["quen", "mor", "ta", "vel", "dri", "lo", "bas", "kir", "an", "zu", "pel", "som", "tha", "ren", "ul", "vi", "gor", "ne", "sha", "dun"];
  var ITEMS = ["copper valves", "blue lamps", "rope coils", "salt sacks", "spare gaskets", "wool blankets", "tin whistles", "glass floats", "oak pegs", "brass hinges",
    "wax candles", "canvas tarps", "iron nails", "map tubes", "radio tubes", "flint boxes", "tar buckets", "cork rings", "steel cables", "felt boots",
    "paper lanterns", "clay pots", "sail needles", "gear oil", "fuse packs", "chalk lines", "lead weights", "mica sheets", "pine tar", "hemp sacks",
    "bone buttons", "quartz lenses", "silk flags", "coal scoops", "bolt kits", "ink flasks", "ladder hooks", "pulley blocks", "snow shovels", "tea tins"];
  var names = Object.create(null), recs = [], i;
  function makeName() { var n; do { n = pick(SYL) + pick(SYL) + pick(SYL); n = n.charAt(0).toUpperCase() + n.slice(1); } while (names[n]); names[n] = 1; return n; }
  var codes = Object.create(null);
  function makeCode() { var c; do { c = String.fromCharCode(65 + Math.floor(r() * 26)) + (10 + Math.floor(r() * 90)) + "-" + String.fromCharCode(65 + Math.floor(r() * 26)); } while (codes[c]); codes[c] = 1; return c; }
  for (i = 0; i < N; i++) {
    var rec = { name: makeName(), sector: 1 + Math.floor(r() * 99), item: pick(ITEMS), code: makeCode(), hh: 1 + Math.floor(r() * 12), mm: ["00", "15", "30", "45"][Math.floor(r() * 4)], ap: r() < 0.5 ? "AM" : "PM" };
    rec.text = "Station " + rec.name + " (sector " + rec.sector + ") keeps the " + rec.item + " in locker " + rec.code + " and opens at " + rec.hh + ":" + rec.mm + " " + rec.ap + ".";
    recs.push(rec);
  }
  var needles = [], used = Object.create(null);
  while (needles.length < Q) { var k = Math.floor(r() * N); if (!used[k]) { used[k] = 1; needles.push(recs[k]); } }

  var store = new S.OffsetShelfStore();
  store.buildFromRecords(recs.map(function (x) { return { shelf: "stations", topic: "Station " + x.name, fullText: x.text }; }));
  var pile = recs.map(function (x) { return x.text; }).join("\n");
  var SYSTEM = "You answer questions from the records you are given. Answer in one short sentence.";

  function getProps(cb) {
    http.get({ hostname: "127.0.0.1", port: PORT, path: "/props", timeout: 4000 }, function (res) {
      var b = []; res.on("data", function (d) { b.push(d); });
      res.on("end", function () { try { cb(JSON.parse(Buffer.concat(b).toString("utf8")).default_generation_settings.n_ctx); } catch (e) { cb(null); } });
    }).on("error", function () { cb(undefined); });
  }

  var results = [], idx = 0, ctx = null;
  function question(n) { return "In which locker does Station " + n.name + " keep the " + n.item + "?"; }
  function runPile(n, cb) {
    var client = new A.InklingClient({ port: PORT, model: "inkling", maxTokens: 3000, temperature: 0.0, timeoutMs: 1200000 });
    var t0 = Date.now();
    client.chat([{ role: "system", content: SYSTEM }, { role: "user", content: "Records:\n" + pile + "\n\nQuestion: " + question(n) }], 0.2, function (err, text) {
      cb({ way: "pile", ok: !err && String(text).indexOf(n.code) >= 0, answer: err ? "ERROR " + err.message.slice(0, 100) : String(text).replace(/\s+/g, " ").slice(0, 120), ms: Date.now() - t0, promptTokens: client.lastUsage ? client.lastUsage.prompt_tokens : null, cached: client.lastUsage && client.lastUsage.prompt_tokens_details ? client.lastUsage.prompt_tokens_details.cached_tokens : null, outTokens: client.lastUsage ? client.lastUsage.completion_tokens : null });
    });
  }
  function runEvelyn(n, cb) {
    var client = new A.InklingClient({ port: PORT, model: "inkling", maxTokens: 3000, temperature: 0.0, timeoutMs: 600000 });
    var agent = new A.EvelynInklingAgent(store, (function () { var p = new E.ProfileManager("evelyn_longctx"); p.reset(); return p; })(), client, { topK: 3, systemPrompt: SYSTEM });
    var t0 = Date.now();
    agent.ask(question(n), function (err, res) {
      var first = null;
      try { first = store.searchFull(question(n), 1)[0]; } catch (e) { first = null; }
      cb({ way: "evelyn", ok: !err && String(res.answer).indexOf(n.code) >= 0, answer: err ? "ERROR " + err.message.slice(0, 100) : String(res.answer).replace(/\s+/g, " ").slice(0, 120), ms: Date.now() - t0,
        promptTokens: client.lastUsage ? client.lastUsage.prompt_tokens : null, outTokens: client.lastUsage ? client.lastUsage.completion_tokens : null,
        rightRecordFirst: !!(first && first.fullText.indexOf(n.code) >= 0), path: res ? res.path : null });
    });
  }

  function next() {
    if (idx >= needles.length * 2) {
      var P = results.filter(function (x) { return x.way === "pile"; }), V = results.filter(function (x) { return x.way === "evelyn"; });
      function sum(a, f) { return a.reduce(function (t, x) { return t + (x[f] || 0); }, 0); }
      console.log("\nway     right   seconds per question   prompt tokens   output tokens");
      [["pile", P], ["evelyn", V]].forEach(function (w) {
        var a = w[1];
        console.log(w[0].padEnd(7) + " " + (a.filter(function (x) { return x.ok; }).length + " / " + a.length).padStart(6) + "   " + (sum(a, "ms") / a.length / 1000).toFixed(1).padStart(18) + "   " + Math.round(sum(a, "promptTokens") / a.length).toString().padStart(13) + "   " + Math.round(sum(a, "outTokens") / a.length).toString().padStart(13));
      });
      if (P.length > 1) console.log("pile, first question " + (P[0].ms / 1000).toFixed(1) + " s (the whole prefill), later ones " + (sum(P.slice(1), "ms") / (P.length - 1) / 1000).toFixed(1) + " s on average (the server's prompt cache)");
      console.log("Evelyn's search put the right record first in " + V.filter(function (x) { return x.rightRecordFirst; }).length + " of " + V.length + " questions");
      fs.writeFileSync(OUT, JSON.stringify({ port: PORT, serverCtx: ctx, records: N, pileTokens: P.length ? P[0].promptTokens : null, results: results }, null, 1));
      console.log("results written to " + OUT);
      process.exit(0);
    }
    var n = needles[Math.floor(idx / 2)], f = (idx % 2 === 0) ? runPile : runEvelyn;
    idx++;
    f(n, function (x) {
      x.station = n.name; results.push(x);
      console.log("[" + idx + "/" + needles.length * 2 + "] " + x.way.padEnd(6) + " " + n.name.padEnd(10) + " " + (x.ok ? "RIGHT" : "WRONG") + "  " + (x.ms / 1000).toFixed(1) + " s, prompt " + x.promptTokens + " tokens (cached " + (x.cached || 0) + "), wrote " + x.outTokens + "  | " + x.answer.slice(0, 70));
      next();
    });
  }

  getProps(function (c) {
    if (c === undefined) { console.log("no server on port " + PORT); process.exit(1); }
    ctx = c;
    console.log("=== NEEDLE IN A HAYSTACK: " + N + " records, " + needles.length + " questions, server context " + ctx + ", pile " + (pile.length / 1000).toFixed(0) + "k letters ===");
    next();
  });
})();
