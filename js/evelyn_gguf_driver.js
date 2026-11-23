/* evelyn_gguf_driver.js - Evelyn drives a local llama-server that runs the Inkling GGUF.

   What owning the server's loop lets Evelyn do that a plain chat call cannot:
     1. a grammar built from the shelf ids she found, so the answer can only cite sources that exist (GBNF);
     2. reading the token stream while it arrives: a thought that repeats itself is cut off, and a shelf the model
        names while it is still thinking is read in advance, so the text is ready when the answer needs it;
     3. checkpoint and rewind of a server slot (llama-server's /slots save and restore), so a failed branch does
        not cost another prefill.
   The effort can be a number from 0 to 0.99 or a word; whether a given server uses it is a thing to test (the tests
   record what the server sent back).

   Plain ES5, Node's http module only. Endpoints: /completion (opts.prompt, already in the model's chat format) or
   /v1/chat/completions (opts.messages, the server applies the template). Both stream server-sent events.

   Written from a design in an AI Studio chat (see CREDITS.md). Changes made on reading it, each covered by a test in
   js/test/evelyn_inkling_tests.js: the result callback runs once (an aborted request could otherwise report twice), the
   stream parser reads both event shapes and "data: [DONE]", the loop cut needs the same 48 letters to have appeared
   twice before (loopRepeats 1 gives the original rule), the prefetch reads at word ends once for each 40 new letters,
   and checkpoint, rewind and erase are named methods. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var http = isNode ? require("http") : null;
  var effortFields = isNode ? require("./evelyn_inkling_agent.js").effortFields : null;   /* one rule for how an effort is sent */

  /* ======================================================================
     1. PURE HELPERS (tested without a server)
     ====================================================================== */
  /* a GBNF grammar: {"answer": "...", "sources": ["shelf#id", ...]} where the sources can only be the hits */
  /* Measured on Inkling 2 Mini (LM Studio's llama.cpp): with a grammar on from the first token the model does not think and
     the answer string was a placeholder ("...") in 7 of 8 runs. The grammar guarantees the shape and the cited ids; it does
     not make the model write an answer. For an answer, let the model think and check the cited ids afterwards
     (verifyCitationsAgainstHits in evelyn_inkling_agent.js). A minimum length for the string was tried and made it ramble. */
  function buildGroundedGrammar(hits) {
    var citeRule = hits && hits.length
      ? hits.map(function (h) { return '"\\"' + h.shelf + "#" + h.id + '\\""'; }).join(" | ")
      : '"\\"none\\""';
    return [
      'root   ::= "{" ws "\\"answer\\"" ws ":" ws string "," ws "\\"sources\\"" ws ":" ws "[" ws cites? ws "]" ws "}"',
      'cites  ::= cite ("," ws cite)*',
      'cite   ::= ' + citeRule,
      'string ::= "\\"" ([^"\\\\\\n] | "\\\\" ["\\\\nrt])* "\\""',
      'ws     ::= [ \\t\\n]*'
    ].join("\n");
  }

  /* true when the last len letters of text have appeared at least repeats times before, with no overlap */
  function loopDetected(text, len, repeats) {
    len = len || 48; repeats = repeats || 2;
    if (text.length < len * 2) return false;
    var probe = text.slice(-len), from = text.length - len - 16, found = 0;
    while (from >= 0) {
      var at = text.lastIndexOf(probe, from);
      if (at < 0) break;
      found++;
      if (found >= repeats) return true;
      from = at - len;
    }
    return false;
  }

  /* one server-sent-events line -> the new text, or null when it carries none */
  function tokenOfEvent(ev) {
    if (typeof ev.content === "string") return ev.content;   /* /completion */
    var c = ev.choices && ev.choices[0];
    if (c && c.delta) {                                       /* /v1/chat/completions */
      var d = c.delta, t = "";
      if (typeof d.reasoning_content === "string") t += d.reasoning_content;
      if (typeof d.content === "string") t += d.content;
      return t;
    }
    return null;
  }

  /* ======================================================================
     2. THE DRIVER
     ====================================================================== */
  function EvelynInklingDriver(opts) {
    opts = opts || {};
    this.host = opts.host || "127.0.0.1";
    this.port = opts.port || 8080;
    this.store = opts.offsetStore || null;   /* EvelynStream.OffsetShelfStore */
    this.tinyModel = opts.tinyModel || null; /* kept for a later learned watcher; not used by the loop below */
    this.prefetchCache = Object.create(null);
    this.loopWindow = opts.loopWindow || 48;
    this.loopRepeats = opts.loopRepeats || 2;
    this.timeoutMs = opts.timeoutMs || 180000;
  }

  /* KV-cache checkpoint or rewind of one server slot (the server needs --slot-save-path) */
  EvelynInklingDriver.prototype.slotAction = function (slotId, action, filename, cb) {
    var finished = false;
    function done(err, res) { if (finished) return; finished = true; cb(err, res); }
    if (!http) { done(new Error("needs Node's http module")); return; }
    if (action !== "save" && action !== "restore" && action !== "erase") { done(new Error("slot action is save, restore or erase")); return; }
    var body = JSON.stringify(action === "erase" ? {} : { filename: filename });
    var req = http.request({
      hostname: this.host, port: this.port, path: "/slots/" + slotId + "?action=" + action, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, function (res) {
      var chunks = [];
      res.on("data", function (d) { chunks.push(d); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8"), json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        if (res.statusCode >= 400 || (json && json.error)) {
          done(new Error("slot " + action + " failed " + res.statusCode + ": " + String(json && json.error ? (json.error.message || json.error) : text).slice(0, 160)));
          return;
        }
        done(null, json || text);
      });
    });
    req.setTimeout(this.timeoutMs, function () { req.destroy(new Error("slot request timed out")); });
    req.on("error", done);
    req.write(body);
    req.end();
  };

  EvelynInklingDriver.prototype.checkpoint = function (slotId, name, cb) { this.slotAction(slotId, "save", name, cb); };
  EvelynInklingDriver.prototype.rewind = function (slotId, name, cb) { this.slotAction(slotId, "restore", name, cb); };

  EvelynInklingDriver.prototype.buildGroundedGrammar = function (hits) { return buildGroundedGrammar(hits); };

  /* Streams one generation. opts: prompt (for /completion) or messages (for /v1/chat/completions), slotId, maxTokens,
     temperature, effort, grammar, loopWindow, loopRepeats, onToken(text). The callback gets
     { text, aborted: null | "loop_detected", prefetched: [ids], events } once. */
  EvelynInklingDriver.prototype.streamWithDriver = function (opts, cb) {
    var self = this, finished = false, aborted = null, req = null;
    function done(err, result) { if (finished) return; finished = true; cb(err, result); }
    if (!http) { done(new Error("needs Node's http module")); return; }
    var chat = !!opts.messages;
    var body = {
      id_slot: opts.slotId || 0,
      cache_prompt: true,
      stream: true,
      temperature: opts.temperature !== undefined ? opts.temperature : 0.4
    };
    var ef = effortFields(opts.effort !== undefined ? opts.effort : 0.25, null), ek;
    for (ek in ef) body[ek] = ef[ek];
    if (chat) { body.messages = opts.messages; body.max_tokens = opts.maxTokens || 512; }
    else { body.prompt = opts.prompt; body.n_predict = opts.maxTokens || 512; }
    if (opts.grammar) body.grammar = opts.grammar;
    var payload = JSON.stringify(body);
    var winLen = opts.loopWindow || this.loopWindow, reps = opts.loopRepeats || this.loopRepeats;
    var fullText = "", recent = [], events = 0, lastPrefetchAt = 0, lastLoopCheck = 0, finalOutput = "";

    /* LM Studio's llama.cpp sends no text deltas while a grammar is on: the whole text is in __lmstudio.model_output of the last event */
    function result() {
      return { text: fullText || finalOutput, aborted: aborted, prefetched: Object.keys(self.prefetchCache), events: events, fromFinalEvent: !fullText && !!finalOutput };
    }

    req = http.request({
      hostname: this.host, port: this.port, path: chat ? "/v1/chat/completions" : "/completion", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, function (res) {
      if (res.statusCode >= 400) {
        var eb = [];
        res.on("data", function (d) { eb.push(d); });
        res.on("end", function () { done(new Error("server answered " + res.statusCode + ": " + Buffer.concat(eb).toString("utf8").slice(0, 200))); });
        return;
      }
      var buf = "";
      res.on("data", function (chunk) {
        if (finished) return;
        buf += chunk.toString("utf8");
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].replace(/\r$/, "").trim();
          if (line.indexOf("data:") !== 0) continue;
          var data = line.slice(5).replace(/^\s+/, "");
          if (data === "[DONE]") continue;
          var ev;
          try { ev = JSON.parse(data); } catch (e) { continue; }
          events++;
          if (ev.__lmstudio && typeof ev.__lmstudio.model_output === "string") finalOutput = ev.__lmstudio.model_output;
          var tok = tokenOfEvent(ev);
          if (!tok) continue;
          fullText += tok;
          recent.push(tok);
          if (recent.length > 64) recent.shift();
          if (opts.onToken) opts.onToken(tok);

          /* A. prefetch: a shelf the model names while it thinks is read now, once for each 40 new letters, at a word end */
          if (self.store && /\s$/.test(tok) && fullText.length - lastPrefetchAt >= 40) {
            lastPrefetchAt = fullText.length;
            var tail = recent.slice(-16).join("");
            var pre = self.store.searchFull(tail, 1);
            if (pre.length) self.prefetchCache[pre[0].shelf + "#" + pre[0].id] = pre[0];
          }

          /* B. loop cut: the same stretch has come round again, so stop paying for it */
          if (fullText.length - lastLoopCheck >= 8 && (lastLoopCheck = fullText.length, loopDetected(fullText, winLen, reps))) {
            aborted = "loop_detected";
            req.destroy();
            done(null, result());
            return;
          }
        }
      });
      res.on("end", function () { done(null, result()); });
      res.on("error", function (err) { done(aborted ? null : err, aborted ? result() : undefined); });
    });
    req.setTimeout(this.timeoutMs, function () { req.destroy(new Error("stream timed out")); });
    req.on("error", function (err) { if (aborted) done(null, result()); else done(err); });
    req.write(payload);
    req.end();
  };

  var API = {
    EvelynInklingDriver: EvelynInklingDriver,
    buildGroundedGrammar: buildGroundedGrammar,
    loopDetected: loopDetected,
    tokenOfEvent: tokenOfEvent
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynGgufDriver = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
