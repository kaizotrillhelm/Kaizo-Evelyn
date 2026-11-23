/* evelyn_inkling_live.js - the agent and the copilot against a REAL llama-server running the Inkling GGUF.
   node js/test/evelyn_inkling_live.js --port 1249 [--maxtokens 1500]
   The server is started elsewhere, through the GPU queue (ShotReader_2026-11-20/tools/sr_server.mjs on the 3090 while
   ComfyUI is idle). Nothing is started or stopped here. Without a server on the port the file says SKIPPED and exits 0.
   It prints what the server did, because whether a given server honours reasoning_effort, a grammar or the /slots
   endpoints is exactly what the design left open. Plain ES5. */
(function () {
  "use strict";
  var http = require("http");
  var E = require("../evelyn_core.js");
  var S = require("../evelyn_stream.js");
  var A = require("../evelyn_inkling_agent.js");
  var G = require("../evelyn_gguf_copilot.js");

  function arg(n, d) { var i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; }
  var PORT = Number(arg("port", 1249)), MAXTOK = Number(arg("maxtokens", 1500));

  var results = [], idx = 0, steps = [];
  function step(name, fn) { steps.push({ name: name, fn: fn }); }
  function note(s) { console.log("       " + s); }
  function getJson(p, cb) {
    var r = http.get({ hostname: "127.0.0.1", port: PORT, path: p, timeout: 4000 }, function (res) {
      var b = []; res.on("data", function (d) { b.push(d); });
      res.on("end", function () { var t = Buffer.concat(b).toString("utf8"), j = null; try { j = JSON.parse(t); } catch (e) { j = null; } cb(null, res.statusCode, j, t); });
    });
    r.on("error", function (e) { cb(e); }); r.on("timeout", function () { r.destroy(new Error("timeout")); });
  }

  function makeStore() {
    var store = new S.OffsetShelfStore();
    store.buildFromRecords([
      { shelf: "caldera", topic: "Frostgate", fullText: "Frostgate sits at mile 53 along the Grand Road on the Snowline band, 17,000 ft up. Its heating stack burns 12 tonnes of fuel a week and the rescue post holds 4 snowcats." },
      { shelf: "health", topic: "Oral rehydration", fullText: "Oral rehydration drink: mix 6 level teaspoons of sugar and half a teaspoon of salt into 1 litre of clean water." },
      { shelf: "bonetown", topic: "Gondola", fullText: "The last gondola car up leaves at 5:07 PM and arrives at 5:21 PM." }
    ]);
    return store;
  }
  function pm() { var p = new E.ProfileManager("evelyn_live_test"); p.reset(); return p; }

  step("server: health, props and the slot endpoint", function (done) {
    getJson("/health", function (err, code, j) {
      if (err) return done(err);
      note("/health " + code + " " + JSON.stringify(j));
      getJson("/props", function (e2, c2, p) {
        note("/props " + c2 + (p ? " model=" + (p.model_alias || p.model_path || "?") + " n_ctx=" + (p.default_generation_settings && p.default_generation_settings.n_ctx) : ""));
        getJson("/slots", function (e3, c3, s, text) {
          note("/slots " + c3 + " " + (s ? (Array.isArray(s) ? s.length + " slot(s)" : JSON.stringify(s).slice(0, 120)) : String(text).slice(0, 120)));
          done();
        });
      });
    });
  });

  step("agent: sum with no model call; grounded question with a real model", function (done) {
    var client = new A.InklingClient({ port: PORT, maxTokens: MAXTOK, model: "inkling" });
    var agent = new A.EvelynInklingAgent(makeStore(), pm(), client);
    agent.ask("what is 18*4", function (err, r) {
      if (err) return done(err);
      if (r.answer !== "18 * 4 = 72" || r.inklingCalled) return done(new Error("fast path failed: " + JSON.stringify(r)));
      var t0 = Date.now();
      agent.ask("Where is Frostgate and how much fuel does its heating stack burn?", function (err2, r2) {
        if (err2) return done(err2);
        note("path: " + r2.path + " | verified: " + r2.verified + " | " + (Date.now() - t0) + " ms | usage " + JSON.stringify(client.lastUsage));
        note("answer: " + String(r2.answer).replace(/\s+/g, " ").slice(0, 300));
        note("reasoning_content present: " + !!(client.lastRaw && client.lastRaw.reasoning_content) + (client.lastRaw && client.lastRaw.reasoning_content ? " (" + client.lastRaw.reasoning_content.length + " letters)" : ""));
        if (!r2.answer) return done(new Error("no answer"));
        if (r2.verified && A.verifyNumbersAgainstHits(r2.answer, store53(), "").length && r2.path.indexOf("Clamped") < 0) return done(new Error("a verified answer carries a number that is not in the excerpts"));
        done();
      });
    });
  });
  function store53() { return makeStore().searchFull("Frostgate", 1); }

  step("agent: does reasoning_effort change the work? (same question, five efforts)", function (done) {
    var efforts = ["low", "high", 0.0, 0.5, 0.99], out = [], i = 0;
    var client = new A.InklingClient({ port: PORT, maxTokens: MAXTOK, model: "inkling" });
    var msgs = [{ role: "user", content: "A train leaves at 3:10 PM and travels 2 hours 35 minutes. When does it arrive? Answer in one line." }];
    (function nextEffort() {
      if (i >= efforts.length) {
        out.forEach(function (o) { note("effort " + JSON.stringify(o.effort) + ": " + o.ms + " ms, completion_tokens " + (o.usage && o.usage.completion_tokens) + ", thinking letters " + o.think + ", answer: " + o.answer.replace(/\s+/g, " ").slice(0, 70)); });
        var toks = out.map(function (o) { return o.usage && o.usage.completion_tokens; });
        note("completion_tokens by effort: " + JSON.stringify(toks) + (toks[0] !== toks[1] ? "  -> the effort word changes the work" : "  -> no difference seen"));
        return done();
      }
      var ef = efforts[i++], t0 = Date.now();
      client.chat(msgs, ef, function (err, text) {
        if (err) { out.push({ effort: ef, ms: Date.now() - t0, usage: client.lastUsage, think: 0, answer: "ERROR " + err.message }); return nextEffort(); }
        out.push({ effort: ef, ms: Date.now() - t0, usage: client.lastUsage, think: client.lastRaw && client.lastRaw.reasoning_content ? client.lastRaw.reasoning_content.length : 0, answer: text });
        nextEffort();
      });
    })();
  });

  step("copilot: a grammar built from the shelf ids keeps the answer to real citations (chat endpoint, streamed)", function (done) {
    var store = makeStore(), hits = store.searchFull("rehydration sugar salt water", 1);
    var cp = new G.EvelynInklingCopilot({ port: PORT, offsetStore: store });
    var grammar = cp.buildGroundedGrammar(hits);
    var t0 = Date.now(), first = null;
    cp.streamWithCopilot({
      messages: [{ role: "user", content: "Using only this excerpt, say how to mix an oral rehydration drink. Reply as JSON with answer and sources.\n[" + hits[0].shelf + "#" + hits[0].id + "] " + hits[0].fullText }],
      grammar: grammar, effort: "low", maxTokens: MAXTOK, temperature: 0.2,
      onToken: function () { if (first === null) first = Date.now() - t0; }
    }, function (err, r) {
      if (err) return done(err);
      note("events " + r.events + ", first token " + first + " ms, total " + (Date.now() - t0) + " ms, aborted " + r.aborted);
      note("text: " + r.text.replace(/\s+/g, " ").slice(0, 300));
      var json = null, m = /\{[\s\S]*\}\s*$/.exec(r.text);
      try { json = JSON.parse(m ? m[0] : r.text); } catch (e) { json = null; }
      if (!json) return done(new Error("the grammar did not produce JSON (the server may not apply a grammar on this endpoint)"));
      var ok = Array.isArray(json.sources) && json.sources.every(function (s) { return s === hits[0].shelf + "#" + hits[0].id || s === "none"; });
      note("parsed JSON; sources " + JSON.stringify(json.sources) + (ok ? "  -> only the real id" : "  -> NOT confined to the real id"));
      if (!ok) return done(new Error("sources are not confined to the shelf ids"));
      done();
    });
  });

  step("copilot: the loop cut on a real stream (a prompt that asks for the same sentence again and again)", function (done) {
    var cp = new G.EvelynInklingCopilot({ port: PORT, loopRepeats: 2 });
    var t0 = Date.now();
    cp.streamWithCopilot({
      messages: [{ role: "user", content: "Write the sentence 'The quick brown fox jumps over the lazy dog near the old river bank.' repeated forever, with no other words." }],
      effort: "low", maxTokens: 700, temperature: 0.0
    }, function (err, r) {
      if (err) return done(err);
      note("aborted: " + r.aborted + ", " + r.text.length + " letters in " + (Date.now() - t0) + " ms, events " + r.events);
      if (r.aborted !== "loop_detected") return done(new Error("expected the repeat to be cut; the model wrote " + r.text.length + " letters without a 48-letter repeat"));
      done();
    });
  });

  step("copilot: checkpoint and rewind a slot (needs the server's --slot-save-path)", function (done) {
    var cp = new G.EvelynInklingCopilot({ port: PORT });
    cp.checkpoint(0, "evelyn_live_test.bin", function (err, r) {
      if (err) { note("not available on this server: " + err.message); return done(); }
      note("save: " + JSON.stringify(r).slice(0, 160));
      cp.rewind(0, "evelyn_live_test.bin", function (e2, r2) {
        if (e2) return done(e2);
        note("restore: " + JSON.stringify(r2).slice(0, 160)); done();
      });
    });
  });

  function run() {
    if (idx >= steps.length) {
      var f = results.filter(function (r) { return !r; }).length;
      console.log("\n=== LIVE INKLING: " + (results.length - f) + " passed, " + f + " failed ===");
      process.exit(f ? 1 : 0);
    }
    var cur = steps[idx++], fin = false;
    function done(err) {
      if (fin) return; fin = true;
      results.push(!err);
      console.log((err ? "[FAIL] " : "[PASS] ") + cur.name + (err ? "\n       " + (err.stack || err) : ""));
      setTimeout(run, 0);
    }
    try { cur.fn(done); } catch (e) { done(e); }
  }

  getJson("/health", function (err) {
    if (err) { console.log("SKIPPED: no server on port " + PORT + " (" + err.message + ")"); process.exit(0); }
    console.log("=== EVELYN LIVE TEST AGAINST A REAL INKLING SERVER, port " + PORT + " ===");
    run();
  });
})();
