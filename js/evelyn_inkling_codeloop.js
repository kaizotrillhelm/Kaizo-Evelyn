/* evelyn_inkling_codeloop.js - Evelyn's code loop around a local Inkling: retrieve, generate, run, repair.

   For a task that asks for code, Evelyn does what she does for a question, and then one thing more:
     1. the task is searched in an OffsetShelfStore of verified notes (an API's real names and rules; each slice CRC32 checked);
     2. Inkling is asked for the code, with the notes in the prompt, at an effort taken from a schedule;
     3. the code is RUN by a verifier the caller supplies (a function that returns { ok, errors: [text, ...] });
     4. when it fails, the exact errors go back to Inkling for a repair, up to maxRepairs times.
   The loop never judges the code itself: a program ran it, or it did not pass.

   Two things the 2026-11-23 benchmark showed, and what the loop does about them:
     - Inkling can use its whole token budget inside its thinking and send no answer. The loop treats that as a failed round,
       steps the effort down the schedule and asks again with the same messages (the island task, run alone at effort high).
     - Repairs do not pile up: every repair starts again from the same first two messages (system and task with notes, byte for
       byte) and adds only the latest failed code and its errors, so the prompt does not grow and a server that caches the
       start of the prompt (llama.cpp prefix cache, on LM Studio too) reuses it. No /slots call is needed for that.

   Plain ES5. Node or browser; the verifier is the caller's (in Node it should run the code in a child process with
   no file, network or process access; see js/test/three_verify_worker.js for one). */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var E = isNode ? require("./evelyn_core.js") : root.Evelyn;
  var FENCE = String.fromCharCode(96, 96, 96);   /* three backticks, written as codes so the ES5 scan of the files stays simple */

  /* the code of a reply: the first fenced block that contains the marker (a function name), else the longest block */
  function extractCode(text, marker) {
    var re = new RegExp(FENCE + "[ \\t]*([A-Za-z0-9_+-]*)[ \\t]*\\r?\\n([\\s\\S]*?)" + FENCE, "g"), m, blocks = [];
    while ((m = re.exec(String(text || ""))) !== null) blocks.push(m[2]);
    if (!blocks.length) return null;   /* an unclosed block at the end of a reply that ran out of tokens is not code that can be run */
    var i;
    if (marker) for (i = 0; i < blocks.length; i++) if (blocks[i].indexOf(marker) >= 0) return blocks[i];
    var best = blocks[0];
    for (i = 1; i < blocks.length; i++) if (blocks[i].length > best.length) best = blocks[i];
    return best;
  }

  var CODE_WORDS = /\b(function|class|const|let|var|return|import|export|implement|write|build|code|script|scene|three|render|array|loop|parse|sort|test|bug|error)\b/i;

  /* opts: store, client, verify, marker, maxRepairs, topK, system, scheduleWith, scheduleWithout, effortModel, onCall.
     effortModel: an object with choose(features) -> { effort, maxTokens } (js/evelyn_effort_model.js); its effort starts the
     schedule and the later steps go down from it. */
  function EvelynCodeLoop(opts) {
    this.store = opts.store || null;        /* OffsetShelfStore of verified notes */
    this.client = opts.client;              /* object with chat(messages, effort, cb) */
    this.verify = opts.verify;              /* function (code) -> { ok, errors } */
    this.marker = opts.marker || null;      /* a name the code must define, used to pick the block */
    this.maxRepairs = opts.maxRepairs === undefined ? 2 : opts.maxRepairs;
    this.topK = opts.topK || 4;
    this.system = opts.system || "You are a careful engineer. Use ONLY the verified notes when they cover a name or a rule. Reply with the code in one fenced block.";
    this.scheduleWith = opts.scheduleWith || [0.20, 0.10, 0.05];      /* efforts by round when notes were found */
    this.scheduleWithout = opts.scheduleWithout || [0.55, 0.25, 0.10]; /* efforts by round when none were */
    this.effortModel = opts.effortModel || null;
    this.onCall = opts.onCall || null;      /* function (info) after each model call: { round, effort, ms, usage, error } */
  }

  /* cb(err, result): result = { code, ok, rounds, calls, firstDraftOk, history, hits, effort, noCode, features, efforts, tokens, exhausted } */
  EvelynCodeLoop.prototype.run = function (task, cb) {
    var self = this, hits = [], scored = null, contextLines = [], i;
    var cleanTask = E.cleanAscii(task).replace(/\n/g, " ");
    try {
      if (this.store) {
        if (typeof this.store.searchScored === "function") { scored = this.store.searchScored(cleanTask, this.topK); hits = scored.hits; }
        else hits = this.store.searchFull(cleanTask, this.topK);
      }
    } catch (e) { cb(e); return; }
    for (i = 0; i < hits.length; i++) contextLines.push("[" + hits[i].shelf + "#" + hits[i].id + " | " + hits[i].topic + "] " + hits[i].fullText);

    /* the first two messages, kept byte for byte through every retry */
    var baseMessages = [
      { role: "system", content: this.system },
      { role: "user", content: (contextLines.length ? "Verified notes:\n" + contextLines.join("\n") + "\n\n" : "") + task }
    ];
    var features = {
      hits: hits.length, topScore: scored ? scored.topScore : 0, relGap: scored ? scored.relGap : 0,
      promptChars: baseMessages[1].content.length, hasCodeWords: CODE_WORDS.test(task) ? 1 : 0
    };
    var schedule = (hits.length ? this.scheduleWith : this.scheduleWithout).slice(0);
    if (this.effortModel) {
      var rec = this.effortModel.choose(features);
      if (rec && typeof rec.effort === "number") {
        var k;
        schedule[0] = rec.effort;
        for (k = 1; k < schedule.length; k++) schedule[k] = rec.effort * Math.pow(0.5, k);   /* each retry halves the effort */
      }
    }
    function effortAt(r) { return schedule[Math.min(r, schedule.length - 1)]; }

    var messages = baseMessages, history = [], efforts = [], tokens = [], calls = 0, round = 0, firstDraftOk = null, exhausted = 0;

    function ask(effortNow) {
      var t0 = Date.now();
      efforts.push(effortNow);
      self.client.chat(messages, effortNow, function (err, text) {
        calls++;
        tokens.push(self.client.lastUsage ? (self.client.lastUsage.completion_tokens || 0) : 0);   /* a reply that ran out of tokens in thinking counts too */
        if (self.onCall) self.onCall({ round: round, effort: effortNow, ms: Date.now() - t0, usage: self.client.lastUsage || null, error: err ? String(err.message || err) : null });
        if (err) {
          var msgStr = String(err.message || err);
          /* a reply with no answer text (the budget ran out in thinking) is a failed round; the same messages go again at a lower effort */
          var spent = msgStr.indexOf("no answer text") >= 0 || msgStr.indexOf("finish: length") >= 0;
          history.push({ round: round, ok: false, errors: ["no reply: " + msgStr] });
          if (firstDraftOk === null) firstDraftOk = false;
          if (spent && round < self.maxRepairs) {
            exhausted++; round++;
            messages = baseMessages;
            return ask(effortAt(round));
          }
          return finish(null, false);
        }
        var code = extractCode(text, self.marker);
        if (!code) {
          history.push({ round: round, ok: false, errors: ["the reply has no closed fenced code block"] });
          if (firstDraftOk === null) firstDraftOk = false;
          return next(text, ["the reply has no closed fenced code block; reply with the complete code in one fenced block"], null);
        }
        var v;
        try { v = self.verify(code); } catch (e2) { v = { ok: false, errors: ["verifier failed: " + String(e2.message || e2)] }; }
        history.push({ round: round, ok: !!v.ok, errors: v.errors || [] });
        if (firstDraftOk === null) firstDraftOk = !!v.ok;
        if (v.ok) return finish(code, true);
        next(text, v.errors || ["failed"], code);
      });
    }
    function next(text, errors, code) {
      if (round >= self.maxRepairs) return finish(code, false);
      round++;
      /* back to the identical first two messages, then only the latest attempt and its exact errors */
      messages = baseMessages.concat([
        { role: "assistant", content: code ? (FENCE + "\n" + code + "\n" + FENCE) : String(text).slice(0, 600) },
        { role: "user", content: "The code was run and failed these checks:\n- " + errors.slice(0, 8).join("\n- ") + "\nFix ONLY those errors and return the complete code in one fenced block." }
      ]);
      ask(effortAt(round));
    }
    function finish(code, ok) {
      cb(null, {
        code: code, ok: ok, rounds: round, calls: calls, firstDraftOk: firstDraftOk, history: history, hits: hits.length,
        effort: efforts[0], efforts: efforts, tokens: tokens, exhausted: exhausted, noCode: !code, features: features
      });
    }
    ask(effortAt(0));
  };

  var API = { EvelynCodeLoop: EvelynCodeLoop, extractCode: extractCode, CODE_WORDS: CODE_WORDS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynCodeLoop = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
