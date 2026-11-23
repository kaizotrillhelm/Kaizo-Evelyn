/* evelyn_inkling_agent.js - Evelyn as the fast path, the retrieval and the checker around a local Inkling.

   Inkling runs as an OpenAI-compatible server on this machine (llama-server with the Inkling 2 Mini GGUF, or any
   other server that answers /v1/chat/completions). Evelyn stands in front of it:
     1. a sum of two whole numbers is answered by CodeSandbox, with no model call;
     2. the question is searched in an OffsetShelfStore, which reads only the byte slices it needs (each one CRC32 checked);
     3. the reasoning effort is "low" when excerpts were found and "medium" when none were;
     4. the draft comes back, every number in it must be a number of the excerpts or of the question, and a draft that
        fails is sent back once with the list of numbers that are missing.

   Plain ES5. The server client needs Node's http module; the agent itself takes any object with chat(messages, effort, cb),
   so a browser can pass its own client.

   Written from a design in an AI Studio chat (see CREDITS.md). Changes made on reading it, each covered by a test in
   js/test/evelyn_inkling_tests.js: the client reports HTTP errors, text that is not JSON, a reply with no content and a
   closed port, each once; a sum that divides by zero goes to the model (CodeSandbox answers 0 for it); the number check
   allows the numbers of the question and ignores list numbers and thousands separators; a repair that is still wrong
   returns the shelf text, never the made-up number. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var E = isNode ? require("./evelyn_core.js") : root.Evelyn;
  var http = isNode ? require("http") : null;

  /* ======================================================================
     1. CLIENT FOR AN OPENAI-COMPATIBLE SERVER (llama-server running Inkling)
     ====================================================================== */
  function InklingClient(opts) {
    opts = opts || {};
    this.host = opts.host || "127.0.0.1";
    this.port = opts.port || 8080;
    this.model = opts.model || "inkling-2-mini";
    this.temperature = opts.temperature !== undefined ? opts.temperature : 0.2;
    this.maxTokens = opts.maxTokens || 350;
    this.timeoutMs = opts.timeoutMs || 120000;
    this.extra = opts.extra || {};          /* more fields for the request body, such as chat_template_kwargs */
    this.lastRequest = null;                /* the last body sent, for tests and for the report */
    this.lastRaw = null;                    /* the last message object that came back, with any reasoning_content */
    this.lastUsage = null;                  /* the usage block of the last reply (prompt and completion tokens), when the server sends it */
  }

  /* The effort of a request. A word ("low", "medium", "high") goes in the reasoning_effort field. A number goes in
     chat_template_kwargs.reasoning_effort, because a server that renders the chat template (LM Studio's llama.cpp, the
     Inkling template) ignores a number in the top-level field and uses 0.9 (measured 2026-11-23, see README). */
  function effortFields(effort, extra) {
    var body = {};
    if (typeof effort === "number") {
      var kw = {}, k;
      if (extra && extra.chat_template_kwargs) for (k in extra.chat_template_kwargs) kw[k] = extra.chat_template_kwargs[k];
      kw.reasoning_effort = effort;
      body.chat_template_kwargs = kw;
    } else {
      body.reasoning_effort = effort === undefined || effort === null ? "low" : effort;
    }
    return body;
  }

  /* effort is "low", "medium", "high" or a number from 0 to 0.99 */
  InklingClient.prototype.chat = function (messages, effort, cb) {
    var self = this, finished = false;
    function done(err, text) { if (finished) return; finished = true; cb(err, text); }
    if (!http) { done(new Error("InklingClient needs Node's http module")); return; }
    var body = {
      model: this.model,
      messages: messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens
    };
    var k, ef = effortFields(effort, this.extra);
    for (k in this.extra) if (Object.prototype.hasOwnProperty.call(this.extra, k)) body[k] = this.extra[k];
    for (k in ef) body[k] = ef[k];
    this.lastRequest = body;
    var payload = JSON.stringify(body);
    var req = http.request({
      hostname: this.host, port: this.port, path: "/v1/chat/completions", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, function (res) {
      var chunks = [];
      res.on("data", function (d) { chunks.push(d); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8"), json;
        try { json = JSON.parse(text); } catch (e) {
          done(new Error("Inkling server answered " + res.statusCode + " with text that is not JSON: " + text.slice(0, 120)));
          return;
        }
        if (res.statusCode >= 400 || json.error) {
          var m = json.error && (json.error.message || json.error);
          done(new Error("Inkling server error " + res.statusCode + ": " + String(m || text).slice(0, 200)));
          return;
        }
        var msg = json.choices && json.choices[0] && json.choices[0].message;
        if (!msg) { done(new Error("Inkling server sent no choices")); return; }
        self.lastRaw = msg;
        self.lastUsage = json.usage || null;
        var content = typeof msg.content === "string" ? msg.content : "";
        if (!content.replace(/\s+/g, "")) {
          done(new Error("Inkling sent no answer text (finish: " + (json.choices[0].finish_reason || "?") +
            "); the token limit may have been used up by reasoning"));
          return;
        }
        done(null, content);
      });
      res.on("error", done);
    });
    req.setTimeout(this.timeoutMs, function () { req.destroy(new Error("Inkling request timed out after " + self.timeoutMs + " ms")); });
    req.on("error", done);
    req.write(payload);
    req.end();
  };

  /* ======================================================================
     2. THE NUMBER CHECK: every number of the draft is a whole number of the sources
     ====================================================================== */
  /* "1,000" is one number; a list marker such as "2." at the start of a line is not a number of the text */
  function numbersOf(text) {
    var t = String(text || "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
    return t.match(/\d+(?:\.\d+)?/g) || [];
  }

  function stripMarkers(text) {
    return String(text || "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/^[ \t]*\d{1,2}[.)][ \t]+/gm, " ");
  }

  /* hits: [{ fullText }] or library records [{ fact, ex }]; extraText: more text whose numbers are allowed (the question) */
  function verifyNumbersAgainstHits(answer, hits, extraText) {
    var allowed = Object.create(null), i, m, src;
    for (i = 0; i < hits.length; i++) {
      src = (hits[i].fullText || "") + " " + (hits[i].fact || "") + " " + (hits[i].ex || "");
      var nums = numbersOf(src);
      for (m = 0; m < nums.length; m++) allowed[nums[m]] = true;
    }
    var extra = numbersOf(extraText);
    for (m = 0; m < extra.length; m++) allowed[extra[m]] = true;
    var draft = numbersOf(stripMarkers(answer)), bad = [];
    for (i = 0; i < draft.length; i++) if (!allowed[draft[i]] && bad.indexOf(draft[i]) < 0) bad.push(draft[i]);
    return bad;
  }

  /* [shelf#id] citations of the answer that are not among the hits: an invented source. This is what the grammar of
     evelyn_gguf_driver.js was meant to guarantee; on Inkling 2 Mini a grammar stops the model thinking, so the answer is
     written freely and the citations are checked afterwards. */
  function verifyCitationsAgainstHits(answer, hits) {
    var ok = Object.create(null), i, bad = [];
    for (i = 0; i < hits.length; i++) ok[hits[i].shelf + "#" + hits[i].id] = true;
    var re = /\[([^\]]*#\d[^\]]*)\]/g, m, parts, k, id;
    while ((m = re.exec(String(answer || ""))) !== null) {
      parts = m[1].split(/[,;|]/);
      for (k = 0; k < parts.length; k++) {
        id = parts[k].replace(/^\s+|\s+$/g, "");
        if (/^[A-Za-z0-9_-]+#\d+$/.test(id) && !ok[id] && bad.indexOf(id) < 0) bad.push(id);
      }
    }
    return bad;
  }

  /* ======================================================================
     3. THE AGENT
     ====================================================================== */
  function EvelynInklingAgent(offsetStore, profileMgr, inkling, opts) {
    opts = opts || {};
    this.store = offsetStore;
    this.pm = profileMgr;
    this.inkling = inkling;
    this.topK = opts.topK || 3;
    /* a constant prefix, so a llama-server or vLLM server hits its prefix cache on every turn */
    this.systemPrompt = opts.systemPrompt ||
      "You are Inkling, working inside the Evelyn offline agent. " +
      "Use ONLY the provided CRC32-verified shelf excerpts when citing numbers or facts. " +
      "Cite sources as [shelf#id]. Be concise and match the learner's mode (R=Read, A=Audio, D=Do, M=Mix).";
  }

  /* "what is 18*4": digits, one operator, digits. A division or remainder by 0 goes to Inkling. */
  var MATH_RE = /^(?:what is +)?(\d+) *([+\-*\/%]) *(\d+) *\?? *$/i;

  EvelynInklingAgent.prototype.ask = function (question, cb) {
    var self = this;
    var q = E.cleanAscii(question).replace(/\n/g, " ").replace(/^\s+|\s+$/g, "");

    /* 1. zero-token fast path */
    var mm = MATH_RE.exec(q);
    if (mm && !((mm[2] === "/" || mm[2] === "%") && Number(mm[3]) === 0)) {
      var expr = mm[1] + " " + mm[2] + " " + mm[3];
      var val = E.fmtNum(E.CodeSandbox.toNum(E.CodeSandbox.evalExpr(expr, {})));
      cb(null, { answer: expr + " = " + val, path: "Evelyn Fast-Path (0 LLM tokens)", verified: true, inklingCalled: false });
      return;
    }

    /* 2. surgical retrieval: only the matching byte slices are read, each with its CRC32 */
    var hits;
    try { hits = this.store ? this.store.searchFull(q, this.topK) : []; } catch (e) { cb(e); return; }
    var contextLines = [], i;
    for (i = 0; i < hits.length; i++) {
      contextLines.push("[" + hits[i].shelf + "#" + hits[i].id + " | " + hits[i].topic + "] " + hits[i].fullText);
    }

    /* 3. effort: low when the facts are in hand, medium when the question is open */
    var effort = hits.length > 0 ? "low" : "medium";
    var prof = this.pm.profile;
    var userMsg =
      "Learner mode: " + prof.mode + " | Mastered: " + (prof.masteredTopics.length ? prof.masteredTopics.join(", ") : "none") + "\n" +
      (contextLines.length ? ("Verified Excerpts:\n" + contextLines.join("\n") + "\n\n") : "No local excerpts found.\n\n") +
      "Question: " + q;
    var messages = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: userMsg }
    ];

    /* 4. Inkling writes, Evelyn checks, one repair pass at most */
    this.inkling.chat(messages, effort, function (err, draft) {
      if (err) { cb(err); return; }
      if (hits.length === 0) {
        cb(null, { answer: draft, path: "Inkling (" + effort + ", ungrounded)", verified: false, inklingCalled: true, hits: 0 });
        return;
      }
      var bad = verifyNumbersAgainstHits(draft, hits, q), badCites = verifyCitationsAgainstHits(draft, hits);
      if (bad.length === 0 && badCites.length === 0) {
        cb(null, { answer: draft, path: "Evelyn RAG + Inkling (" + effort + ")", verified: true, inklingCalled: true, hits: hits.length });
        return;
      }
      var repair = messages.concat([
        { role: "assistant", content: draft },
        {
          role: "user",
          content: "Checker warning: " +
            (bad.length ? "number(s) [" + bad.join(", ") + "] do not appear in the verified excerpts. " : "") +
            (badCites.length ? "source(s) [" + badCites.join(", ") + "] are not among the excerpts. " : "") +
            "Rewrite concisely using only verified numbers and sources, or state what is missing."
        }
      ]);
      self.inkling.chat(repair, "low", function (err2, fixed) {
        if (err2) {
          cb(null, { answer: contextLines.join("\n"), path: "Clamped to Evelyn Source", verified: true, inklingCalled: true, hits: hits.length, badNumbers: bad, badCitations: badCites });
          return;
        }
        var still = verifyNumbersAgainstHits(fixed, hits, q).concat(verifyCitationsAgainstHits(fixed, hits));
        cb(null, {
          answer: still.length === 0 ? fixed : contextLines.join("\n"),
          path: still.length === 0 ? "Evelyn RAG + Inkling (self-corrected)" : "Clamped to Evelyn Source",
          verified: true, inklingCalled: true, hits: hits.length, badNumbers: bad, badCitations: badCites, stillBad: still
        });
      });
    });
  };

  var API = {
    InklingClient: InklingClient,
    EvelynInklingAgent: EvelynInklingAgent,
    verifyNumbersAgainstHits: verifyNumbersAgainstHits,
    verifyCitationsAgainstHits: verifyCitationsAgainstHits,
    numbersOf: numbersOf,
    effortFields: effortFields
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynInkling = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
