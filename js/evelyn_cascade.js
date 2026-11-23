/* evelyn_cascade.js - tiny KV21 subagents and a confidence gate in front of Inkling.

   Tier 0  deterministic Evelyn: a sum, a shelf lookup (under 1 ms, no model)
   Tier 1  Tiny2Model subagents, each a role primed once and kept as a KV21 snapshot:
             expander: turns a loose question into shelf keywords
             router:   says how hard the question is
           A role costs one memory copy to switch to (importKVCache), then a few letters of generation.
   Tier 2  Inkling at the effort the router chose, over the excerpts Evelyn found
   Tier 3  Inkling at high effort

   The confidence of a tiny subagent is the gap between its best and second best next-letter score (read from
   model.score, no extra exponentials). A subagent whose smallest gap is under marginThreshold is not trusted.

   Plain ES5, no network: the Inkling object is any object with chat(messages, effort, cb).

   Written from a design in an AI Studio chat (see CREDITS.md). Changes made on reading it, each covered by a test in
   js/test/evelyn_inkling_tests.js: a role cannot be registered on a model with no weights, a sum that divides by zero is
   left to the model, the library may be a LibraryStore or a MultiShelfLibrary, and a snapshot from a model of another
   shape is refused (importKVCache checks it). The tiny model here is Evelyn's TNY2, which has no trained weights yet:
   the tests prove the mechanics with random weights, and what a trained router or expander would decide is untested. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var E = isNode ? require("./evelyn_core.js") : root.Evelyn;

  /* ======================================================================
     1. RUN THE TINY MODEL FROM ITS CURRENT PREFIX AND KEEP THE WEAKEST MARGIN
     ====================================================================== */
  /* The model must already hold its prefix (model.kvPrefixLen). Letters of input go in after it, then the end token,
     then up to maxChars letters come out. margin = best score minus second best score at each step. */
  function thinkWithMargin(model, input, maxChars) {
    if (!model || !model.loaded) throw new Error("thinkWithMargin needs a loaded TNY2 model");
    var clean = E.cleanAscii(input).replace(/\n/g, " ");
    var p = model.kvPrefixLen, i;
    for (i = 0; i < clean.length && p < E.CTX - 2; i++, p++) model.step(clean.charCodeAt(i) - 30, p);
    model.step(1, p++);

    var out = [], minMargin = 1e9, sumMargin = 0, steps = 0;
    var limit = Math.min(E.CTX, p + (maxChars === undefined ? 24 : maxChars));
    for (; p < limit; p++) {
      var best = 0, second = 1, sc = model.score;
      if (sc[1] > sc[0]) { best = 1; second = 0; }
      for (i = 2; i < E.VOCAB; i++) {
        var s = sc[i];
        if (s > sc[best]) { second = best; best = i; }
        else if (s > sc[second]) { second = i; }
      }
      var margin = sc[best] - sc[second];
      if (margin < minMargin) minMargin = margin;
      sumMargin += margin; steps++;
      if (best <= 1) break;
      out.push(String.fromCharCode(best + 30));
      model.step(best, p);
    }
    return {
      text: out.join(""),
      minMargin: steps ? minMargin : 0,
      avgMargin: steps ? sumMargin / steps : 0,
      steps: steps
    };
  }

  /* ======================================================================
     2. KV21 SUBAGENT POOL
     ====================================================================== */
  function KV21SubagentPool(model) {
    this.model = model;
    this.snapshots = Object.create(null);   /* role name -> Uint8Array (KV21 bytes) */
  }

  KV21SubagentPool.prototype.registerRole = function (roleName, prefixPrompt) {
    if (!this.model || !this.model.loaded) throw new Error("registerRole needs a loaded TNY2 model");
    this.model.reset();
    var len = this.model.prime(prefixPrompt);
    this.snapshots[roleName] = this.model.exportKVCache(len);
    this.model.reset();
    return { role: roleName, prefixTokens: len, bytes: this.snapshots[roleName].length };
  };

  KV21SubagentPool.prototype.hasRole = function (roleName) { return !!this.snapshots[roleName]; };

  KV21SubagentPool.prototype.runRole = function (roleName, query, maxChars) {
    var snap = this.snapshots[roleName];
    if (!snap) throw new Error("Unknown KV21 subagent role: " + roleName);
    this.model.importKVCache(snap);   /* a memory copy: the prefix is not computed again */
    return thinkWithMargin(this.model, query, maxChars);
  };

  /* ======================================================================
     3. THE TIERED ORCHESTRATOR
     ====================================================================== */
  var MATH_RE = /^(?:what is +)?(\d+) *([+\-*\/%]) *(\d+) *\?? *$/i;

  /* any library with search(q, k) (LibraryStore) or slideSearch(q, shelves, k) (MultiShelfLibrary) */
  function searchLib(lib, q, k) {
    if (!lib) return [];
    if (typeof lib.search === "function") return lib.search(q, k);
    if (typeof lib.slideSearch === "function") return lib.slideSearch(q, null, k);
    return [];
  }

  function TieredEvelynOrchestrator(opts) {
    this.lib = opts.lib;                 /* LibraryStore or MultiShelfLibrary */
    this.pm = opts.pm;                   /* ProfileManager */
    this.pool = opts.pool || null;       /* KV21SubagentPool, optional */
    this.inkling = opts.inkling || null; /* object with chat(messages, effort, cb), optional */
    this.marginThreshold = opts.marginThreshold !== undefined ? opts.marginThreshold : 1.25;
    this.topK = opts.topK || 2;
  }

  TieredEvelynOrchestrator.prototype.handle = function (question, cb) {
    var q = E.cleanAscii(question).replace(/\n/g, " ").replace(/^\s+|\s+$/g, "");

    /* TIER 0: a sum, answered by CodeSandbox (division or remainder by 0 is left to the model) */
    var mm = MATH_RE.exec(q);
    if (mm && !((mm[2] === "/" || mm[2] === "%") && Number(mm[3]) === 0)) {
      var expr = mm[1] + " " + mm[2] + " " + mm[3];
      var val = E.fmtNum(E.CodeSandbox.toNum(E.CodeSandbox.evalExpr(expr, {})));
      cb(null, { tier: 0, answer: expr + " = " + val, inklingCalled: false, trace: [] });
      return;
    }

    /* TIER 1: tiny subagents for keywords and effort */
    var searchQuery = q, routeEffort = "low", trace = [], pool = this.pool, thr = this.marginThreshold;
    if (pool && pool.model && pool.model.loaded) {
      if (pool.hasRole("expander")) {
        var exp = pool.runRole("expander", q, 32);
        trace.push("expander(margin=" + exp.minMargin.toFixed(2) + "): " + exp.text);
        if (exp.minMargin >= thr && exp.text) searchQuery = q + " " + exp.text;
      }
      if (pool.hasRole("router")) {
        var rt = pool.runRole("router", q, 10);
        trace.push("router(margin=" + rt.minMargin.toFixed(2) + "): " + rt.text);
        if (rt.minMargin >= thr && rt.text.indexOf("HIGH") >= 0) routeEffort = "high";
        else if (rt.minMargin < thr) routeEffort = "medium";   /* an unsure router chooses the middle */
      }
    }

    var hits = searchLib(this.lib, searchQuery, this.topK);

    /* no Inkling: answer from the shelf alone */
    if (!this.inkling) {
      var localAns = hits.length ? (hits[0].fact + (hits[0].ex ? "\nExample: " + hits[0].ex : "")) : "No local match found.";
      cb(null, { tier: 1, answer: localAns, trace: trace, hitsUsed: hits.length, inklingCalled: false });
      return;
    }

    if (hits.length === 0 && routeEffort === "low") routeEffort = "medium";

    /* TIER 2 and 3: Inkling over a short grounded brief */
    var ctx = [], i, h;
    for (i = 0; i < hits.length; i++) {
      h = hits[i];
      ctx.push("[" + h.topic + "#" + h.id + "] " + h.fact + (h.ex ? " Ex: " + h.ex : ""));
    }
    var messages = [
      { role: "system", content: "You are Inkling inside Evelyn. Ground all facts and numbers in the provided excerpts when present. Be concise." },
      { role: "user", content: "Mode: " + this.pm.profile.mode + "\nExcerpts:\n" + (ctx.length ? ctx.join("\n") : "(none)") + "\n\nQuestion: " + q }
    ];
    this.inkling.chat(messages, routeEffort, function (err, reply) {
      if (err) { cb(err); return; }
      cb(null, {
        tier: routeEffort === "high" ? 3 : 2, effort: routeEffort, answer: reply,
        trace: trace, hitsUsed: hits.length, inklingCalled: true
      });
    });
  };

  var API = {
    thinkWithMargin: thinkWithMargin,
    KV21SubagentPool: KV21SubagentPool,
    TieredEvelynOrchestrator: TieredEvelynOrchestrator,
    searchLib: searchLib
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynCascade = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
