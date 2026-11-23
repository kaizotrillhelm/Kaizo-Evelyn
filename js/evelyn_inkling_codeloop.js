/* evelyn_inkling_codeloop.js - Evelyn's code loop around a local Inkling: retrieve, generate, run, repair.

   For a task that asks for code, Evelyn does what she does for a question, and then one thing more:
     1. the task is searched in an OffsetShelfStore of verified notes (an API's real names and rules; each slice CRC32 checked);
     2. Inkling is asked for the code, with the notes in the prompt and an effort that depends on whether notes were found;
     3. the code is RUN by a verifier the caller supplies (a function that returns { ok, errors: [text, ...] });
     4. when it fails, the exact errors go back to Inkling for a repair, up to maxRepairs times.
   The loop never judges the code itself: a program ran it, or it did not pass.

   Plain ES5. Node or browser; the verifier is the caller's (in Node it should run the code in a child process with
   no file, network or process access; see js/test/three_verify_worker.js for one). */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var E = isNode ? require("./evelyn_core.js") : root.Evelyn;

  /* the code of a reply: the first fenced block that contains the marker (a function name), else the longest block */
  function extractCode(text, marker) {
    var fence = String.fromCharCode(96, 96, 96);   /* three backticks, written as codes so the ES5 scan of the files stays simple */
    var re = new RegExp(fence + "[ \\t]*([A-Za-z0-9_+-]*)[ \\t]*\\r?\\n([\\s\\S]*?)" + fence, "g"), m, blocks = [];
    while ((m = re.exec(String(text || ""))) !== null) blocks.push(m[2]);
    if (!blocks.length) {
      /* an unclosed block at the end of a reply that ran out of tokens is not code that can be run */
      return null;
    }
    var i;
    if (marker) for (i = 0; i < blocks.length; i++) if (blocks[i].indexOf(marker) >= 0) return blocks[i];
    var best = blocks[0];
    for (i = 1; i < blocks.length; i++) if (blocks[i].length > best.length) best = blocks[i];
    return best;
  }

  function EvelynCodeLoop(opts) {
    this.store = opts.store || null;        /* OffsetShelfStore of verified notes */
    this.client = opts.client;              /* object with chat(messages, effort, cb) */
    this.verify = opts.verify;              /* function (code) -> { ok, errors } */
    this.marker = opts.marker || null;      /* a name the code must define, used to pick the block */
    this.maxRepairs = opts.maxRepairs === undefined ? 2 : opts.maxRepairs;
    this.topK = opts.topK || 4;
    this.system = opts.system || "You are a careful engineer. Use ONLY the verified notes when they cover a name or a rule. Reply with the code in one fenced block.";
    this.effortWith = opts.effortWith || "low";        /* when notes were found */
    this.effortWithout = opts.effortWithout || "medium";
    this.onCall = opts.onCall || null;      /* function (info) after each model call: { round, ms, usage } */
  }

  /* cb(err, result): result = { code, ok, rounds, calls, firstDraftOk, history: [{ round, ok, errors }], hits, effort, noCode } */
  EvelynCodeLoop.prototype.run = function (task, cb) {
    var self = this, hits = [], contextLines = [], i;
    try { hits = this.store ? this.store.searchFull(E.cleanAscii(task).replace(/\n/g, " "), this.topK) : []; } catch (e) { cb(e); return; }
    for (i = 0; i < hits.length; i++) contextLines.push("[" + hits[i].shelf + "#" + hits[i].id + " | " + hits[i].topic + "] " + hits[i].fullText);
    var effort = hits.length ? this.effortWith : this.effortWithout;
    var messages = [
      { role: "system", content: this.system },
      { role: "user", content: (contextLines.length ? "Verified notes:\n" + contextLines.join("\n") + "\n\n" : "") + task }
    ];
    var history = [], calls = 0, round = 0, firstDraftOk = null;

    function ask(effortNow) {
      var t0 = Date.now();
      self.client.chat(messages, effortNow, function (err, text) {
        calls++;
        if (self.onCall) self.onCall({ round: round, ms: Date.now() - t0, usage: self.client.lastUsage || null, error: err ? String(err.message || err) : null });
        if (err) {
          /* a reply with no answer text (the budget ran out in thinking) counts as a failed round, not a crash */
          history.push({ round: round, ok: false, errors: ["no reply: " + String(err.message || err)] });
          if (firstDraftOk === null) firstDraftOk = false;
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
      messages = messages.concat([
        { role: "assistant", content: text },
        { role: "user", content: "The code was run and failed these checks:\n- " + errors.slice(0, 8).join("\n- ") + "\nReturn the complete corrected code in one fenced block." }
      ]);
      ask("low");
    }
    function finish(code, ok) {
      cb(null, { code: code, ok: ok, rounds: round, calls: calls, firstDraftOk: firstDraftOk, history: history, hits: hits.length, effort: effort, noCode: !code });
    }
    ask(effort);
  };

  var API = { EvelynCodeLoop: EvelynCodeLoop, extractCode: extractCode };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynCodeLoop = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
