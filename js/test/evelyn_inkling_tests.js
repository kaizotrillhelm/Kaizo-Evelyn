/* evelyn_inkling_tests.js - the Inkling agent, the KV21 cascade and the llama-server copilot, against a mock server.
   node js/test/evelyn_inkling_tests.js
   No model and no GPU: the "server" is a small http server in this file that plays the part of llama-server
   (/v1/chat/completions, /completion with server-sent events, /slots). The live run against the real Inkling GGUF is
   js/test/evelyn_inkling_live.js. Plain ES5 in the tests too. */
(function () {
  "use strict";

  var http = require("http");
  var fs = require("fs");
  var path = require("path");
  var E = require("../evelyn_core.js");
  var S = require("../evelyn_stream.js");
  var A = require("../evelyn_inkling_agent.js");
  var C = require("../evelyn_cascade.js");
  var G = require("../evelyn_gguf_copilot.js");

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }
  function has(s, part, msg) { assert(String(s).indexOf(part) >= 0, (msg || "text") + " should contain " + JSON.stringify(part) + ", got " + JSON.stringify(String(s).slice(0, 200))); }

  /* ----------------------------------------------------------------------
     A deterministic TNY2 file (random weights: the letters mean nothing, the mechanics are real)
     ---------------------------------------------------------------------- */
  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeTny2(D, L, H, HID, seed) {
    var VOCAB = 97, CTX = 128;
    function tb(r, c) { return r * (4 + c); }
    var total = 12 + tb(VOCAB, D) + tb(CTX, D) + L * (D * 4 + 4 * tb(D, D) + D * 4 + tb(HID, D) + tb(D, HID)) + D * 4;
    var buf = new ArrayBuffer(total), v = new DataView(buf), rng = rngOf(seed || 42), off = 12;
    v.setUint8(0, 84); v.setUint8(1, 78); v.setUint8(2, 89); v.setUint8(3, 50);
    v.setUint16(4, D, true); v.setUint16(6, L, true); v.setUint16(8, H, true); v.setUint16(10, HID, true);
    function wt(rows, cols, sc) {
      for (var r = 0; r < rows; r++) {
        v.setFloat32(off, sc, true); off += 4;
        for (var c = 0; c < cols; c++) v.setInt8(off++, Math.floor((rng() * 2 - 1) * 45));
      }
    }
    function wg(n) { for (var i = 0; i < n; i++) { v.setFloat32(off, 1.0, true); off += 4; } }
    wt(VOCAB, D, 0.025); wt(CTX, D, 0.025);
    for (var l = 0; l < L; l++) { wg(D); wt(D, D, 0.025); wt(D, D, 0.025); wt(D, D, 0.025); wt(D, D, 0.025); wg(D); wt(HID, D, 0.025); wt(D, HID, 0.025); }
    wg(D);
    assertEq(off, total, "makeTny2 size mismatch");
    return buf;
  }
  function loadedModel(seed) {
    var m = new E.Tiny2Model();
    m.loadFromArrayBuffer(makeTny2(24, 2, 2, 48, seed || 101));
    return m;
  }

  /* ----------------------------------------------------------------------
     The mock server
     ---------------------------------------------------------------------- */
  function startMock(setup, cb) {
    var m = {
      bodies: [], paths: [], closed: 0, sent: 0, chatReplies: [], status: 200,
      sse: null, endless: null, delayMs: 0
    };
    if (setup) setup(m);
    var server = http.createServer(function (req, res) {
      var chunks = [];
      req.on("data", function (d) { chunks.push(d); });
      req.on("end", function () {
        var raw = Buffer.concat(chunks).toString("utf8"), body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = null; }
        m.paths.push(req.url);
        m.bodies.push(body);
        if (m.status >= 400) {
          res.writeHead(m.status, { "Content-Type": "application/json" });
          res.end(m.errorBody || JSON.stringify({ error: { message: "mock failure " + m.status } }));
          return;
        }
        if (req.url.indexOf("/slots/") === 0) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id_slot: 0, filename: body && body.filename, ok: true }));
          return;
        }
        if (req.url === "/v1/chat/completions" && !(body && body.stream)) {
          var reply = m.chatReplies.length > 1 ? m.chatReplies.shift() : m.chatReplies[0];
          if (typeof reply === "function") reply = reply(body);
          if (reply && reply.raw !== undefined) { res.writeHead(200, { "Content-Type": "text/plain" }); res.end(reply.raw); return; }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply && reply.content !== undefined ? reply.content : reply, reasoning_content: "thinking" }, finish_reason: "stop" }] }));
          return;
        }
        /* streams: /completion and /v1/chat/completions with stream:true */
        var chat = req.url === "/v1/chat/completions";
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.on("close", function () { m.closed++; });
        function frame(text, kind) {
          var ev = chat ? { choices: [{ delta: kind === "think" ? { reasoning_content: text } : { content: text } }] } : { content: text, stop: false };
          return "data: " + JSON.stringify(ev) + "\n\n";
        }
        if (m.endless) {
          var timer = setInterval(function () {
            if (res.destroyed || res.writableEnded) { clearInterval(timer); return; }
            res.write(frame(m.endless)); m.sent++;
          }, 1);
          res.on("close", function () { clearInterval(timer); });
          return;
        }
        var list = m.sse || [], i = 0;
        (function pump() {
          if (i >= list.length) { res.write("data: [DONE]\n\n"); res.end(); return; }
          var item = list[i++];
          res.write(frame(typeof item === "string" ? item : item.text, typeof item === "string" ? "text" : item.kind)); m.sent++;
          setTimeout(pump, m.delayMs);
        })();
      });
    });
    server.listen(0, "127.0.0.1", function () {
      m.port = server.address().port;
      m.close = function (fin) { server.close(function () { fin && fin(); }); if (server.closeAllConnections) server.closeAllConnections(); };
      cb(m);
    });
  }
  function withMock(setup, fn, done) {
    startMock(setup, function (m) {
      var fin = false;
      function end(err) { if (fin) return; fin = true; m.close(function () { done(err); }); }
      try { fn(m, end); } catch (e) { end(e); }
    });
  }
  function guard(end, f) { return function () { try { f.apply(null, arguments); } catch (e) { end(e); } }; }

  /* shelves for the agent tests */
  function makeStore() {
    var store = new S.OffsetShelfStore();
    store.buildFromRecords([
      { shelf: "caldera", topic: "Frostgate", fullText: "Frostgate sits at mile 53 along the Grand Road on the Snowline band (17,000 ft). The heating stack burns 12 tonnes a week." },
      { shelf: "health", topic: "Oral rehydration", fullText: "Mix 6 level teaspoons of sugar and half a teaspoon of salt into 1 litre of clean water." },
      { shelf: "bonetown", topic: "Gondola", fullText: "The last gondola car up leaves at 5:07 PM and arrives at 5:21 PM." }
    ]);
    return store;
  }
  function makePm() { var pm = new E.ProfileManager("evelyn_test_inkling"); pm.reset(); return pm; }

  /* ======================================================================
     THE AGENT
     ====================================================================== */
  test("number check: whole numbers only, with the question's numbers allowed", function (done) {
    var hits = [{ fullText: "Cost is 1000 coins and 2.5 kg" }];
    assertEq(A.verifyNumbersAgainstHits("It costs 100 coins.", hits).join(","), "100", "100 is not 1000");
    assertEq(A.verifyNumbersAgainstHits("It costs 1000 coins and 2.5 kg.", hits).length, 0, "the sources' numbers pass");
    assertEq(A.verifyNumbersAgainstHits("It costs 1,000 coins.", hits).length, 0, "1,000 is 1000");
    assertEq(A.verifyNumbersAgainstHits("2.5 kg and 25 kg", hits).join(","), "25", "25 is not 2.5");
    assertEq(A.verifyNumbersAgainstHits("Per [caldera#17] it is 1000.", hits).length, 0, "a citation id is not a number of the text");
    assertEq(A.verifyNumbersAgainstHits("1. Boil water\n2. Add salt\n3) Stir", hits).length, 0, "list markers are not numbers of the text");
    assertEq(A.verifyNumbersAgainstHits("You asked about 15 coins; the answer is 1000.", hits, "is 15 a lot?").length, 0, "the question's numbers pass");
    assertEq(A.verifyNumbersAgainstHits("12 and 12 and 99", hits).join(","), "12,99", "each bad number is listed once");
    done();
  });

  test("agent fast path: a sum is answered by CodeSandbox with no server call", function (done) {
    withMock(function (m) { m.chatReplies = ["never used"]; }, function (m, end) {
      var agent = new A.EvelynInklingAgent(makeStore(), makePm(), new A.InklingClient({ port: m.port }));
      agent.ask("what is 18*4?", guard(end, function (err, r) {
        assert(!err, String(err));
        assertEq(r.answer, "18 * 4 = 72"); assertEq(r.inklingCalled, false); assertEq(r.verified, true);
        has(r.path, "0 LLM tokens");
        agent.ask("7 % 3", guard(end, function (err2, r2) {
          assertEq(r2.answer, "7 % 3 = 1");
          assertEq(m.bodies.length, 0, "the server must not have been called");
          end();
        }));
      }));
    }, done);
  });

  test("agent fast path: a division by 0 is not answered locally (CodeSandbox would say 0)", function (done) {
    withMock(function (m) { m.chatReplies = ["Division by zero is undefined."]; }, function (m, end) {
      var agent = new A.EvelynInklingAgent(makeStore(), makePm(), new A.InklingClient({ port: m.port }));
      agent.ask("what is 7 / 0", guard(end, function (err, r) {
        assert(!err, String(err));
        assertEq(r.inklingCalled, true, "sent on to the model");
        assertEq(m.bodies.length, 1);
        end();
      }));
    }, done);
  });

  test("agent: grounded answer, low effort, constant system prefix, CRC-checked excerpts in the prompt", function (done) {
    withMock(function (m) {
      m.chatReplies = ["Frostgate is at mile 53 on the Grand Road, 17,000 ft up [caldera#0]."];
    }, function (m, end) {
      var client = new A.InklingClient({ port: m.port });
      var agent = new A.EvelynInklingAgent(makeStore(), makePm(), client);
      agent.ask("Where is Frostgate?", guard(end, function (err, r) {
        assert(!err, String(err));
        assertEq(r.verified, true); assertEq(r.hits >= 1, true); has(r.path, "Evelyn RAG + Inkling (low)");
        var b = m.bodies[0];
        assertEq(b.reasoning_effort, "low");
        assertEq(b.messages[0].role, "system");
        has(b.messages[1].content, "[caldera#0 | Frostgate]", "excerpt header");
        has(b.messages[1].content, "mile 53", "excerpt text");
        has(b.messages[1].content, "Learner mode: M", "learner mode");
        agent.ask("What does the gondola do?", guard(end, function (err2) {
          assert(!err2, String(err2));
          assertEq(m.bodies[1].messages[0].content, b.messages[0].content, "the system prefix is the same every turn (prefix cache)");
          end();
        }));
      }));
    }, done);
  });

  test("agent: a number that is in no excerpt sends one repair request with the list", function (done) {
    withMock(function (m) {
      m.chatReplies = ["Frostgate is at mile 530 on the Grand Road.", "Frostgate is at mile 53 on the Grand Road [caldera#0]."];
    }, function (m, end) {
      var agent = new A.EvelynInklingAgent(makeStore(), makePm(), new A.InklingClient({ port: m.port }));
      agent.ask("Where is Frostgate?", guard(end, function (err, r) {
        assert(!err, String(err));
        assertEq(m.bodies.length, 2, "one draft, one repair");
        var msgs = m.bodies[1].messages;
        assertEq(msgs.length, 4); assertEq(msgs[2].role, "assistant"); assertEq(msgs[2].content, "Frostgate is at mile 530 on the Grand Road.");
        has(msgs[3].content, "number(s) [530]");
        assertEq(m.bodies[1].reasoning_effort, "low");
        has(r.path, "self-corrected"); has(r.answer, "mile 53 "); assertEq(r.badNumbers.join(","), "530");
        end();
      }));
    }, done);
  });

  test("agent: a repair that is still wrong returns the shelf text, never the made-up number", function (done) {
    withMock(function (m) {
      m.chatReplies = ["The stack burns 120 tonnes.", "Well, it burns 121 tonnes."];
    }, function (m, end) {
      var agent = new A.EvelynInklingAgent(makeStore(), makePm(), new A.InklingClient({ port: m.port }));
      agent.ask("How much does the Frostgate heating stack burn?", guard(end, function (err, r) {
        assert(!err, String(err));
        has(r.path, "Clamped"); has(r.answer, "12 tonnes a week"); assert(r.answer.indexOf("121") < 0 && r.answer.indexOf("120") < 0);
        assertEq(r.stillBad.join(","), "121");
        end();
      }));
    }, done);
  });

  test("agent: a failed repair call also returns the shelf text", function (done) {
    var n = 0;
    withMock(function (m) {
      m.chatReplies = [function () { n++; return n === 1 ? "It burns 77 tonnes." : { raw: "<html>gateway</html>" }; }];
    }, function (m, end) {
      var agent = new A.EvelynInklingAgent(makeStore(), makePm(), new A.InklingClient({ port: m.port }));
      agent.ask("How much does the Frostgate heating stack burn?", guard(end, function (err, r) {
        assert(!err, String(err)); has(r.path, "Clamped"); has(r.answer, "12 tonnes");
        end();
      }));
    }, done);
  });

  test("agent: no excerpt means medium effort and an answer marked ungrounded", function (done) {
    withMock(function (m) { m.chatReplies = ["A tapir is a mammal."]; }, function (m, end) {
      var agent = new A.EvelynInklingAgent(makeStore(), makePm(), new A.InklingClient({ port: m.port }));
      agent.ask("tell me about tapirs", guard(end, function (err, r) {
        assert(!err, String(err));
        assertEq(m.bodies[0].reasoning_effort, "medium"); assertEq(r.verified, false); has(r.path, "ungrounded");
        has(m.bodies[0].messages[1].content, "No local excerpts found.");
        end();
      }));
    }, done);
  });

  test("agent: a damaged shelf blob is reported as an error, not read", function (done) {
    withMock(function (m) { m.chatReplies = ["unused"]; }, function (m, end) {
      var store = makeStore();
      store.blob[store.entries[0].offset + 2] ^= 1;
      var agent = new A.EvelynInklingAgent(store, makePm(), new A.InklingClient({ port: m.port }));
      agent.ask("Where is Frostgate?", guard(end, function (err) {
        assert(err && String(err).indexOf("CRC32") >= 0, "expected a CRC32 error");
        assertEq(m.bodies.length, 0, "the model must not be asked with damaged text");
        end();
      }));
    }, done);
  });

  test("client: HTTP errors, non-JSON, empty answers and a closed port are errors, each reported once", function (done) {
    var results = [];
    function one(setup, label, next) {
      withMock(setup, function (m, end) {
        var calls = 0, client = new A.InklingClient({ port: m.port });
        client.chat([{ role: "user", content: "hi" }], "low", guard(end, function (err, text) {
          calls++; results.push({ label: label, err: err, text: text });
          setTimeout(function () { assertEq(calls, 1, label + ": callback count"); end(); }, 30);
        }));
      }, function (e) { if (e) return done(e); next(); });
    }
    one(function (m) { m.status = 500; }, "http 500", function () {
      one(function (m) { m.chatReplies = [{ raw: "not json" }]; }, "not json", function () {
        one(function (m) { m.chatReplies = [""]; }, "empty", function () {
          one(function (m) { m.chatReplies = [{ content: "  \n" }]; }, "blank", function () {
            var c = new A.InklingClient({ port: 1 });   /* nothing listens on port 1 */
            var calls = 0;
            c.chat([{ role: "user", content: "hi" }], "low", function (err) {
              calls++; results.push({ label: "refused", err: err });
              setTimeout(function () {
                try {
                  assertEq(calls, 1, "refused: callback count");
                  var want = { "http 500": "mock failure", "not json": "not JSON", "empty": "no answer text", "blank": "no answer text" }, i;
                  for (i = 0; i < results.length - 1; i++) { assert(results[i].err, results[i].label + " should be an error"); has(results[i].err.message, want[results[i].label], results[i].label); }
                  assert(results[results.length - 1].err, "a closed port is an error");
                  done();
                } catch (e) { done(e); }
              }, 30);
            });
          });
        });
      });
    });
  });

  test("client: effort goes out as sent (a word or a number), extra fields are added, the host is this machine", function (done) {
    withMock(function (m) { m.chatReplies = ["ok", "ok"]; }, function (m, end) {
      var c = new A.InklingClient({ port: m.port, extra: { chat_template_kwargs: { enable_thinking: false } }, maxTokens: 99, temperature: 0.7 });
      assertEq(c.host, "127.0.0.1");
      c.chat([{ role: "user", content: "x" }], 0.35, guard(end, function (err) {
        assert(!err, String(err));
        var b = m.bodies[0];
        assertEq(b.reasoning_effort, 0.35); assertEq(b.max_tokens, 99); assertEq(b.temperature, 0.7);
        assertEq(b.chat_template_kwargs.enable_thinking, false);
        c.chat([{ role: "user", content: "x" }], undefined, guard(end, function (err2) {
          assert(!err2); assertEq(m.bodies[1].reasoning_effort, "low", "no effort given means low");
          end();
        }));
      }));
    }, done);
  });

  /* ======================================================================
     THE CASCADE
     ====================================================================== */
  test("thinkWithMargin: the text is the greedy text of the core, the margin is the best score minus the second", function (done) {
    var a = loadedModel(7), b = loadedModel(7), q = "what is a frostgate", i;
    var r = C.thinkWithMargin(a, q, 12);
    /* the same thing written out by hand on a second model with the same weights */
    var clean = E.cleanAscii(q).replace(/\n/g, " "), p = 0;
    for (i = 0; i < clean.length; i++, p++) b.step(clean.charCodeAt(i) - 30, p);
    b.step(1, p++);
    var text = "", minM = 1e9, steps = 0, limit = p + 12;
    for (; p < limit; p++) {
      var idx = [], k;
      for (k = 0; k < E.VOCAB; k++) idx.push(k);
      idx.sort(function (x, y) { return b.score[y] - b.score[x] || x - y; });
      var m = b.score[idx[0]] - b.score[idx[1]];
      if (m < minM) minM = m;
      steps++;
      if (idx[0] <= 1) break;
      text += String.fromCharCode(idx[0] + 30);
      b.step(idx[0], p);
    }
    assertEq(r.text, text, "text");
    assertEq(r.minMargin, minM, "minimum margin");
    assertEq(r.steps, steps, "steps");
    assert(r.avgMargin >= r.minMargin, "the average is not under the minimum");
    assert(r.minMargin >= 0, "a margin is never negative");
    done();
  });

  test("thinkWithMargin: an unloaded model is refused", function (done) {
    var threw = false;
    try { C.thinkWithMargin(new E.Tiny2Model(), "hi", 4); } catch (e) { threw = true; }
    assert(threw, "no weights, no thinking");
    done();
  });

  test("KV21 pool: a role is primed once, switching back gives the same letters and margins every time", function (done) {
    var model = loadedModel(11), pool = new C.KV21SubagentPool(model);
    var ri = pool.registerRole("router", "ROUTE:"), ei = pool.registerRole("expander", "KEYWORDS:");
    var perToken = 4 + 24;
    assertEq(ri.bytes, 10 + 2 * ri.prefixTokens * 2 * perToken, "KV21 size of the router role");
    assertEq(ei.prefixTokens, 9, "KEYWORDS: is 9 letters");
    var r1 = pool.runRole("router", "my stomach hurts from muddy water", 10);
    var e1 = pool.runRole("expander", "my stomach hurts from muddy water", 20);
    var r2 = pool.runRole("router", "my stomach hurts from muddy water", 10);
    var e2 = pool.runRole("expander", "my stomach hurts from muddy water", 20);
    assertEq(r2.text, r1.text, "router text after a switch"); assertEq(r2.minMargin, r1.minMargin, "router margin");
    assertEq(e2.text, e1.text, "expander text after a switch"); assertEq(e2.minMargin, e1.minMargin, "expander margin");
    assertEq(model.kvPrefixLen, ei.prefixTokens, "the prefix length stays the snapshot's, so the next switch starts clean");
    /* a fresh model that primes the same prefix by hand gives the same answer */
    var fresh = loadedModel(11); fresh.prime("ROUTE:");
    var rf = C.thinkWithMargin(fresh, "my stomach hurts from muddy water", 10);
    assertEq(rf.text, r1.text, "primed by hand equals the snapshot"); assertEq(rf.minMargin, r1.minMargin);
    assertEq(pool.hasRole("router"), true); assertEq(pool.hasRole("nope"), false);
    done();
  });

  test("KV21 pool: refuses an unknown role, an unloaded model and a snapshot from another model shape", function (done) {
    var model = loadedModel(3), pool = new C.KV21SubagentPool(model), threw1 = false, threw2 = false, threw3 = false;
    try { pool.runRole("ghost", "x", 3); } catch (e) { threw1 = String(e).indexOf("Unknown") >= 0; }
    try { new C.KV21SubagentPool(new E.Tiny2Model()).registerRole("a", "x"); } catch (e2) { threw2 = true; }
    var other = new E.Tiny2Model(); other.loadFromArrayBuffer(makeTny2(32, 2, 2, 64, 5));
    var po = new C.KV21SubagentPool(other); po.registerRole("r", "ROUTE:");
    pool.snapshots.r = po.snapshots.r;
    try { pool.runRole("r", "x", 3); } catch (e3) { threw3 = String(e3).indexOf("mismatch") >= 0; }
    assert(threw1, "unknown role"); assert(threw2, "unloaded model"); assert(threw3, "shape mismatch");
    done();
  });

  /* a fake pool whose answers are set by the test, so the routing rules are tested on their own */
  function fakePool(roles) {
    return {
      model: { loaded: true },
      hasRole: function (r) { return !!roles[r]; },
      runRole: function (r) { return roles[r]; }
    };
  }
  function fakeLib(record) {
    var lib = { queries: [], search: function (q) { lib.queries.push(q); return record.hits(q); } };
    return lib;
  }
  var HIT = { id: 4, topic: "Water purification", fact: "Boil water for 1 minute.", ex: "" };

  function orchestrate(cfg, question, cb) {
    withMock(function (m) { m.chatReplies = ["model answer"]; }, function (m, end) {
      var lib = fakeLib({ hits: cfg.hits || function () { return [HIT]; } });
      var o = new C.TieredEvelynOrchestrator({
        lib: lib, pm: makePm(), pool: cfg.pool || null,
        inkling: cfg.noInkling ? null : new A.InklingClient({ port: m.port }),
        marginThreshold: 1.25
      });
      o.handle(question, guard(end, function (err, r) {
        try { cb(err, r, m, lib); end(); } catch (e) { end(e); }
      }));
    }, function (e) { if (e) throw e; });
  }

  test("orchestrator tier 0: a sum is answered with no model and no search", function (done) {
    orchestrate({}, "what is 12+30", function (err, r, m, lib) {
      assertEq(r.tier, 0); assertEq(r.answer, "12 + 30 = 42"); assertEq(m.bodies.length, 0); assertEq(lib.queries.length, 0);
      done();
    });
  });

  test("orchestrator: a confident expander adds its keywords to the search, an unsure one does not", function (done) {
    orchestrate({ pool: fakePool({ expander: { text: "water purification boil", minMargin: 2.0 } }) }, "muddy river water hurts", function (err, r, m, lib) {
      assertEq(lib.queries[0], "muddy river water hurts water purification boil", "confident");
      assertEq(r.trace.length, 1);
      orchestrate({ pool: fakePool({ expander: { text: "garbage", minMargin: 0.4 } }) }, "muddy river water hurts", function (err2, r2, m2, lib2) {
        assertEq(lib2.queries[0], "muddy river water hurts", "unsure");
        done();
      });
    });
  });

  test("orchestrator: router HIGH with margin means tier 3 at high effort; unsure means medium; LOW means low", function (done) {
    orchestrate({ pool: fakePool({ router: { text: "HIGH", minMargin: 3 } }) }, "write a parser", function (err, r, m) {
      assertEq(r.tier, 3); assertEq(r.effort, "high"); assertEq(m.bodies[0].reasoning_effort, "high");
      orchestrate({ pool: fakePool({ router: { text: "HIGH", minMargin: 0.2 } }) }, "write a parser", function (err2, r2, m2) {
        assertEq(r2.effort, "medium", "an unsure router goes to the middle"); assertEq(r2.tier, 2);
        orchestrate({ pool: fakePool({ router: { text: "LOW", minMargin: 4 } }) }, "what is a tapir", function (err3, r3, m3) {
          assertEq(r3.effort, "low"); assertEq(r3.hitsUsed, 1);
          done();
        });
      });
    });
  });

  test("orchestrator: no hits lifts low effort to medium; the brief names the excerpt and the mode", function (done) {
    orchestrate({ hits: function () { return []; } }, "what is a tapir", function (err, r, m) {
      assertEq(r.effort, "medium"); has(m.bodies[0].messages[1].content, "(none)");
      orchestrate({}, "boil water how long", function (err2, r2, m2) {
        has(m2.bodies[0].messages[1].content, "[Water purification#4] Boil water for 1 minute.");
        has(m2.bodies[0].messages[1].content, "Mode: M");
        done();
      });
    });
  });

  test("orchestrator: with no Inkling the answer is the shelf text; with no hit it says so", function (done) {
    orchestrate({ noInkling: true }, "boil water", function (err, r, m) {
      assertEq(r.tier, 1); assertEq(r.inklingCalled, false); has(r.answer, "Boil water for 1 minute.");
      orchestrate({ noInkling: true, hits: function () { return []; } }, "boil water", function (err2, r2) {
        assertEq(r2.answer, "No local match found.");
        done();
      });
    });
  });

  test("orchestrator: division by 0 is not answered at tier 0", function (done) {
    orchestrate({}, "what is 5/0", function (err, r, m) {
      assert(r.tier !== 0, "not tier 0"); assertEq(m.bodies.length, 1);
      done();
    });
  });

  test("orchestrator with real pieces: the starter library, a real KV21 pool on a real TNY2 file, a mock server", function (done) {
    withMock(function (m) { m.chatReplies = ["answer from the mock"]; }, function (m, end) {
      var lib = new E.LibraryStore("evelyn_test_inkling_lib"); lib.clear(); lib.loadStarterPack();
      var model = loadedModel(21), pool = new C.KV21SubagentPool(model);
      pool.registerRole("expander", "KEYWORDS:"); pool.registerRole("router", "ROUTE:");
      var o = new C.TieredEvelynOrchestrator({ lib: lib, pm: makePm(), pool: pool, inkling: new A.InklingClient({ port: m.port }), marginThreshold: 0 });
      var stats = lib.stats();
      assert(stats.entries >= 16, "the starter pack is loaded");
      o.handle("how do I purify dirty water", guard(end, function (err, r) {
        assert(!err, String(err));
        assertEq(r.trace.length, 2, "both subagents ran"); has(r.trace[0], "expander(margin="); has(r.trace[1], "router(margin=");
        assertEq(r.inklingCalled, true); assertEq(r.answer, "answer from the mock");
        end();
      }));
    }, done);
  });

  test("searchLib: a LibraryStore and a MultiShelfLibrary both work", function (done) {
    var lib = new E.LibraryStore("evelyn_test_inkling_lib2"); lib.clear(); lib.loadStarterPack();
    var multi = new E.MultiShelfLibrary();
    multi.addShelf("starter_test_shelf", [{ topic: "Tapir", fact: "A tapir is a large browsing mammal." }]);
    assertEq(C.searchLib(multi, "tapir", 2).length >= 1, true, "multi shelf");
    assertEq(C.searchLib(lib, "water", 2).length >= 1, true, "single library");
    assertEq(C.searchLib(null, "x", 2).length, 0, "no library");
    done();
  });

  /* ======================================================================
     THE COPILOT
     ====================================================================== */
  test("grammar: the citations are exactly the shelf ids that were found, nothing else", function (done) {
    var g = G.buildGroundedGrammar([{ shelf: "health", id: 0 }, { shelf: "caldera", id: 7 }]);
    has(g, 'cite   ::= "\\"health#0\\"" | "\\"caldera#7\\""');
    has(g, 'root   ::= "{" ws');
    assert(g.indexOf("health#99") < 0, "no invented id");
    var none = G.buildGroundedGrammar([]);
    has(none, 'cite   ::= "\\"none\\""');
    /* every rule that is used is defined */
    var defined = {}, used = {};
    g.split("\n").forEach(function (l) { var mm = /^(\w+)\s*::=/.exec(l); if (mm) defined[mm[1]] = true; });
    g.split("\n").forEach(function (l) {
      var rhs = l.replace(/^\w+\s*::=/, "").replace(/"(?:[^"\\]|\\.)*"/g, " ").replace(/\[(?:[^\]\\]|\\.)*\]/g, " ");
      (rhs.match(/[a-z]+/g) || []).forEach(function (w) { used[w] = true; });
    });
    Object.keys(used).forEach(function (u) { assert(defined[u], "rule used but not defined: " + u); });
    done();
  });

  test("loopDetected: a stretch that repeats is found, a normal text and an overlap are not", function (done) {
    var phrase = "I should check the fractions shelf and run test_billing next. ";
    assertEq(G.loopDetected(phrase + phrase + phrase, 48, 2), true, "three copies");
    assertEq(G.loopDetected(phrase + phrase, 48, 2), false, "two copies need loopRepeats 1");
    assertEq(G.loopDetected(phrase + phrase, 48, 1), true, "two copies with loopRepeats 1 (the original rule)");
    assertEq(G.loopDetected("The Grand Road runs from the quay to the wall, past Frostgate at mile 53, then on to the Snowline band where the cold begins in earnest.", 48, 1), false, "ordinary text");
    assertEq(new Array(300).join("a"), new Array(300).join("a"));
    assertEq(G.loopDetected(new Array(300).join("a"), 48, 2), true, "one letter forever is a loop");
    assertEq(G.loopDetected("short", 48, 1), false, "too short");
    done();
  });

  test("stream: tokens arrive in order, the callback runs once, onToken sees every piece", function (done) {
    withMock(function (m) { m.sse = ["Hello", ", ", "world", "."]; }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port }), seen = [], calls = 0;
      cp.streamWithCopilot({ prompt: "say hi", effort: 0.1, slotId: 2, grammar: "root ::= x", maxTokens: 20, onToken: function (t) { seen.push(t); } }, guard(end, function (err, r) {
        calls++;
        assert(!err, String(err));
        assertEq(r.text, "Hello, world."); assertEq(r.aborted, null); assertEq(r.events, 4); assertEq(seen.join(""), "Hello, world.");
        var b = m.bodies[0];
        assertEq(m.paths[0], "/completion"); assertEq(b.prompt, "say hi"); assertEq(b.n_predict, 20); assertEq(b.id_slot, 2);
        assertEq(b.cache_prompt, true); assertEq(b.stream, true); assertEq(b.reasoning_effort, 0.1); assertEq(b.grammar, "root ::= x");
        setTimeout(function () { assertEq(calls, 1, "callback count"); end(); }, 40);
      }));
    }, done);
  });

  test("stream, chat endpoint: messages go out, reasoning and answer pieces are both read, [DONE] is ignored", function (done) {
    withMock(function (m) { m.sse = [{ text: "let me think. ", kind: "think" }, { text: "The answer", kind: "text" }, " is 4."]; }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port });
      cp.streamWithCopilot({ messages: [{ role: "user", content: "2+2?" }], effort: "low" }, guard(end, function (err, r) {
        assert(!err, String(err));
        assertEq(m.paths[0], "/v1/chat/completions"); assertEq(m.bodies[0].messages[0].content, "2+2?"); assertEq(m.bodies[0].prompt, undefined);
        assertEq(m.bodies[0].max_tokens, 512); assertEq(m.bodies[0].reasoning_effort, "low");
        assertEq(r.text, "let me think. The answer is 4.");
        end();
      }));
    }, done);
  });

  test("stream: a repeating thought is cut, the server sees the client go, the callback runs once", function (done) {
    var phrase = "Perhaps the cause is the billing rounding, so I should check it again. ";
    withMock(function (m) { m.endless = phrase; }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port }), calls = 0;
      cp.streamWithCopilot({ prompt: "debug" }, guard(end, function (err, r) {
        calls++;
        assert(!err, String(err));
        assertEq(r.aborted, "loop_detected");
        assert(r.text.length >= phrase.length * 3 && r.text.length < phrase.length * 6, "cut after about three copies, got " + r.text.length + " letters");
        var sentAtCut = m.sent;
        setTimeout(guard(end, function () {
          assertEq(calls, 1, "callback count after an abort");
          assertEq(m.closed >= 1, true, "the server saw the connection close");
          assert(m.sent - sentAtCut < 40, "the server stopped generating (" + (m.sent - sentAtCut) + " more events after the cut)");
          end();
        }), 150);
      }));
    }, done);
  });

  test("stream: loopRepeats 1 reproduces the original rule and cuts one copy sooner", function (done) {
    var phrase = "Perhaps the cause is the billing rounding, so I should check it again. ";
    withMock(function (m) { m.endless = phrase; }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port, loopRepeats: 1 });
      cp.streamWithCopilot({ prompt: "debug" }, guard(end, function (err, r) {
        assert(!err, String(err)); assertEq(r.aborted, "loop_detected");
        assert(r.text.length < phrase.length * 3.5, "cut after about two copies, got " + r.text.length);
        end();
      }));
    }, done);
  });

  test("stream: ordinary structured output (a JSON list) is not cut as a loop", function (done) {
    var items = [], i;
    for (i = 0; i < 12; i++) items.push('{"id":' + i + ',"name":"item number ' + i + '","tags":["a","b","c"]}, ');
    withMock(function (m) { m.sse = items; }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port });
      cp.streamWithCopilot({ prompt: "list" }, guard(end, function (err, r) {
        assert(!err, String(err)); assertEq(r.aborted, null); assertEq(r.text, items.join(""));
        end();
      }));
    }, done);
  });

  test("stream: a shelf named while the model is still thinking is read ahead of the answer", function (done) {
    var store = makeStore();
    withMock(function (m) {
      m.sse = ["I should look at the ", "Frostgate ", "notes ", "and the ", "heating stack ", "figures. ", "Then the ", "gondola ", "times ", "next. "];
    }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port, offsetStore: store });
      cp.streamWithCopilot({ prompt: "plan" }, guard(end, function (err, r) {
        assert(!err, String(err));
        assert(r.prefetched.indexOf("caldera#0") >= 0, "Frostgate shelf was read ahead: " + JSON.stringify(r.prefetched));
        assertEq(cp.prefetchCache["caldera#0"].fullText.indexOf("mile 53") >= 0, true, "the cached entry holds the text, CRC checked");
        end();
      }));
    }, done);
  });

  test("stream: an HTTP error or a closed port is one error, once", function (done) {
    withMock(function (m) { m.status = 503; }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port }), calls = 0;
      cp.streamWithCopilot({ prompt: "x" }, guard(end, function (err) {
        calls++;
        assert(err && String(err).indexOf("503") >= 0, "expected a 503 error, got " + err);
        setTimeout(function () {
          try { assertEq(calls, 1); } catch (e) { return end(e); }
          var c2 = new G.EvelynInklingCopilot({ port: 1 }), calls2 = 0;
          c2.streamWithCopilot({ prompt: "x" }, function (err2) {
            calls2++;
            setTimeout(function () { try { assert(err2, "closed port"); assertEq(calls2, 1); end(); } catch (e2) { end(e2); } }, 30);
          });
        }, 30);
      }));
    }, done);
  });

  test("slots: save, restore and erase go to /slots/<id>?action=...; a bad action or a server error is an error", function (done) {
    withMock(function (m) { }, function (m, end) {
      var cp = new G.EvelynInklingCopilot({ port: m.port });
      cp.checkpoint(0, "after_prefill.bin", guard(end, function (err, r) {
        assert(!err, String(err)); assertEq(m.paths[0], "/slots/0?action=save"); assertEq(m.bodies[0].filename, "after_prefill.bin"); assertEq(r.ok, true);
        cp.rewind(0, "after_prefill.bin", guard(end, function (err2) {
          assert(!err2); assertEq(m.paths[1], "/slots/0?action=restore");
          cp.slotAction(3, "erase", null, guard(end, function (err3) {
            assert(!err3); assertEq(m.paths[2], "/slots/3?action=erase");
            cp.slotAction(0, "explode", "x", guard(end, function (err4) {
              assert(err4 && String(err4).indexOf("save, restore or erase") >= 0);
              m.status = 501;
              cp.checkpoint(0, "x.bin", guard(end, function (err5) { assert(err5 && String(err5).indexOf("501") >= 0); end(); }));
            }));
          }));
        }));
      }));
    }, done);
  });

  /* ======================================================================
     THE TNY3 HEADER
     ====================================================================== */
  var T3 = require("../evelyn_tny3.js");
  function throwsWith(fn, part) { try { fn(); } catch (e) { return String(e.message).indexOf(part) >= 0; } return false; }
  var SWEET = { VOCAB: 4096, CTX: 1024, D: 384, L: 6, H: 6, HID: 1024, useRoPE: true, hasAssistantHeads: true, assistantOutputs: 8 };

  test("TNY3 header: written and read back, also from a view that does not start at byte 0", function (done) {
    var buf = T3.buildTny3Header(SWEET), h = T3.parseTny3Header(buf);
    assertEq(buf.byteLength, 24);
    ["VOCAB", "CTX", "D", "L", "H", "HID", "useRoPE", "hasAssistantHeads", "assistantOutputs"].forEach(function (k) { assertEq(h[k], SWEET[k], k); });
    assertEq(h.HD, 64, "head width");
    var padded = new Uint8Array(40); padded.set(new Uint8Array(buf), 9);
    assertEq(T3.parseTny3Header(new Uint8Array(padded.buffer, 9, 24)).VOCAB, 4096, "a view with an offset");
    var plain = T3.parseTny3Header(T3.buildTny3Header({ VOCAB: 97, CTX: 128, D: 96, L: 4, H: 4, HID: 256 }));
    assertEq(plain.useRoPE, false); assertEq(plain.hasAssistantHeads, false); assertEq(plain.assistantOutputs, 0);
    done();
  });

  test("TNY3 header: refused when short, foreign, inconsistent, out of limits or carrying undefined flags", function (done) {
    var good = SWEET;
    function with_(patch) { var s = {}, k; for (k in good) s[k] = good[k]; for (k in patch) s[k] = patch[k]; return T3.buildTny3Header(s); }
    assert(throwsWith(function () { T3.parseTny3Header(new ArrayBuffer(10)); }, "too short"), "short");
    assert(throwsWith(function () { T3.parseTny3Header(makeTny2(24, 2, 2, 48, 1)); }, "Not a TNY3"), "a TNY2 file is not TNY3");
    assert(throwsWith(function () { T3.parseTny3Header(with_({ D: 385 })); }, "Invalid"), "D must divide by H");
    assert(throwsWith(function () { T3.parseTny3Header(with_({ CTX: 8 })); }, "Invalid"), "CTX under 16");
    assert(throwsWith(function () { T3.parseTny3Header(with_({ VOCAB: 4000000 })); }, "limits"), "a damaged vocab field");
    assert(throwsWith(function () { T3.parseTny3Header(with_({ hasAssistantHeads: false })); }, "not the heads flag"), "outputs without the flag");
    assert(throwsWith(function () { T3.parseTny3Header(with_({ assistantOutputs: 0 })); }, "no outputs"), "flag without outputs");
    var raw = new Uint8Array(T3.buildTny3Header(good)); raw[20] |= 4;
    assert(throwsWith(function () { T3.parseTny3Header(raw.buffer); }, "not defined"), "an undefined flag bit");
    done();
  });

  test("TNY3 header: the engine of TNY2 files refuses a TNY3 file; the parameter estimate matches the sizes in the design", function (done) {
    var m = new E.Tiny2Model(), refused = false;
    try { m.loadFromArrayBuffer(T3.buildTny3Header(SWEET)); } catch (e) { refused = true; }
    assert(refused && !m.loaded, "Tiny2Model must not load a TNY3 header");
    var e = T3.tny3ParamEstimate(T3.parseTny3Header(T3.buildTny3Header(SWEET)));
    assertEq(e.positions, 0, "rotary: no position table");
    assert(e.total > 8e6 && e.total < 20e6, "the sweet-spot shape is 8M to 20M weights, got " + e.total);
    var big = T3.tny3ParamEstimate(T3.parseTny3Header(T3.buildTny3Header({ VOCAB: 128000, CTX: 1024, D: 256, L: 4, H: 4, HID: 768 })));
    assertEq(big.embedding, 32768000, "a 128,000 vocabulary at width 256 is 32.7M in the table alone");
    var fixed = T3.tny3ParamEstimate(T3.parseTny3Header(T3.buildTny3Header({ VOCAB: 97, CTX: 128, D: 96, L: 4, H: 4, HID: 256 })));
    assertEq(fixed.positions, 128 * 96, "a fixed position table is CTX x D");
    done();
  });

  test("ES5 only and the files are clean: no arrow, let, const, template literal or control character", function (done) {
    ["evelyn_inkling_agent.js", "evelyn_cascade.js", "evelyn_gguf_copilot.js", "evelyn_tny3.js"].forEach(function (f) {
      var src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      var arrow = new RegExp("=" + ">"), lc = /(^|[\s;(])(let|const)\s+[A-Za-z_$]/m;
      assert(!arrow.test(src), f + ": arrow function");
      assert(!lc.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), f + ": let or const");
      assert(src.indexOf("`") < 0, f + ": template literal");
      for (var i = 0; i < src.length; i++) {
        var c = src.charCodeAt(i);
        assert(c >= 32 || c === 9 || c === 10 || c === 13, f + ": control character " + c + " at " + i);
      }
    });
    done();
  });

  var passed = 0, failed = 0, idx = 0;
  function next() {
    if (idx >= tests.length) {
      console.log("\n=== INKLING SUITE: " + passed + " passed, " + failed + " failed ===");
      process.exit(failed > 0 ? 1 : 0);
      return;
    }
    var cur = tests[idx++], fin = false;
    function done(err) {
      if (fin) return; fin = true;
      if (err) { failed++; console.log("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
      else { passed++; console.log("[PASS] " + cur.name); }
      setTimeout(next, 0);
    }
    try { cur.fn(done); } catch (e) { done(e); }
  }
  console.log("=== EVELYN INKLING AGENT, CASCADE AND COPILOT TESTS (" + tests.length + ") ===");
  next();
})();
