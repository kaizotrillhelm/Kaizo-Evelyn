/* evelyn_registry.js - Hardware tiers, modular LLM backend profiles, and a multi-.bin registry.
   Plain ES5, zero dependencies. Works in Node (with fs) or in a browser (with a custom readFile).

   1. Hardware tiers (potato, standard, workstation) say which features are on and how large a .bin may be.
   2. Backend profiles (inkling, qwen, nemotron, muse, and registerBackend for later ones) hold each model's own
      effort fields, thinking end tag, grammar safety and effort schedules, so the harness stays generic.
   3. BinRegistry picks the best TNY2 .bin for a role (tutor, expander, router, critic), a backend and a tier,
      checks its CRC32, and returns null when none exists, so the caller falls back to BM25 and the backend's schedule.

   No warranty: see the disclaimer in README.md. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var fs = isNode ? require("fs") : null;
  var path = isNode ? require("path") : null;
  var E = isNode ? require("./evelyn_core.js") : root.Evelyn;
  var S = isNode ? require("./evelyn_stream.js") : root.EvelynStream;
  var P = null;
  if (isNode) { try { P = require("./evelyn_potato.js"); } catch (e0) { P = null; } }
  else P = root.EvelynPotato || null;

  /* ======================================================================
     1. HARDWARE TIERS AND FEATURE LOCKING
     ====================================================================== */
  var TIER_RANK = { potato: 0, standard: 1, workstation: 2 };

  var TIER_POLICIES = {
    potato: {
      rank: 0,
      usePotatoMath: true,      /* installs EvelynPotato level 1 on a Tiny2Model */
      streamMode: "slice",      /* one layer in memory at a time */
      maxBinBytes: 2 * 1024 * 1024,
      features: {
        solo_tutor: true, offset_shelf: true, remote_llm: false, local_gguf: false,
        multi_bin_cascade: false, code_loop: false, visual_verifier: false
      }
    },
    standard: {
      rank: 1,
      usePotatoMath: false,
      streamMode: "resident",
      maxBinBytes: 32 * 1024 * 1024,
      features: {
        solo_tutor: true, offset_shelf: true, remote_llm: true, local_gguf: false,
        multi_bin_cascade: true, code_loop: true, visual_verifier: true
      }
    },
    workstation: {
      rank: 2,
      usePotatoMath: false,
      streamMode: "resident",
      maxBinBytes: 512 * 1024 * 1024,
      features: {
        solo_tutor: true, offset_shelf: true, remote_llm: true, local_gguf: true,
        multi_bin_cascade: true, code_loop: true, visual_verifier: true
      }
    }
  };

  function hasFeature(tierName, featureName) {
    var pol = TIER_POLICIES[tierName] || TIER_POLICIES.standard;
    return !!(pol.features && pol.features[featureName]);
  }

  function requireFeature(tierName, featureName) {
    if (!hasFeature(tierName, featureName)) {
      throw new Error("Feature '" + featureName + "' is locked on hardware tier '" + tierName + "'.");
    }
  }

  /* ======================================================================
     2. MODULAR LLM BACKEND PROFILES
     ====================================================================== */
  var BACKENDS = Object.create(null);

  function registerBackend(name, spec) {
    BACKENDS[String(name).toLowerCase()] = spec;
  }

  function getBackend(name) {
    var key = String(name || "inkling").toLowerCase();
    return BACKENDS[key] || BACKENDS.inkling;
  }

  function copyKw(extra) {
    var kw = {}, k;
    if (extra && extra.chat_template_kwargs) for (k in extra.chat_template_kwargs) kw[k] = extra.chat_template_kwargs[k];
    return kw;
  }

  /* Inkling 2 Mini (the live-tested LM Studio / llama.cpp findings) */
  registerBackend("inkling", {
    name: "inkling",
    thinkEndTag: "<|content_text|>",
    grammarSafeWithThinking: false,   /* a token-0 grammar produced "..." in 7 of 8 live runs */
    supportsSlots: false,             /* enable only when the server answers 200 on /slots */
    effortScheduleWithNotes: [0.30, 0.15, 0.05],
    effortScheduleNoNotes: [0.55, 0.25, 0.10],
    formatEffort: function (effort, extra) {
      var body = {}, kw;
      if (typeof effort === "number") {
        kw = copyKw(extra);
        kw.reasoning_effort = effort;
        body.chat_template_kwargs = kw;
      } else {
        body.reasoning_effort = effort || "low";
      }
      return body;
    }
  });

  /* Qwen (Qwen3 / Qwen2.5-Coder on llama.cpp, vLLM or LM Studio) */
  registerBackend("qwen", {
    name: "qwen",
    thinkEndTag: "</think>",
    grammarSafeWithThinking: false,   /* safe when enable_thinking is false */
    supportsSlots: false,
    effortScheduleWithNotes: [0.0, 0.0],
    effortScheduleNoNotes: [0.7, 0.0],
    formatEffort: function (effort, extra) {
      var thinkOn = typeof effort === "number" ? effort >= 0.2 : (effort === "medium" || effort === "high");
      var kw = copyKw(extra);
      kw.enable_thinking = thinkOn;
      return { chat_template_kwargs: kw };
    }
  });

  /* Nemotron (Nano / Super reasoning toggles) */
  registerBackend("nemotron", {
    name: "nemotron",
    thinkEndTag: "</think>",
    grammarSafeWithThinking: false,
    supportsSlots: false,
    effortScheduleWithNotes: [0.2, 0.0],
    effortScheduleNoNotes: [0.7, 0.2],
    formatEffort: function (effort, extra) {
      var thinkOn = typeof effort === "number" ? effort >= 0.15 : (effort !== "none" && effort !== "minimal");
      var kw = copyKw(extra);
      kw.enable_thinking = thinkOn;
      return { chat_template_kwargs: kw };
    }
  });

  /* Muse (placeholder defaults: tune after a first live benchmark on Muse) */
  registerBackend("muse", {
    name: "muse",
    thinkEndTag: "</think>",
    grammarSafeWithThinking: true,
    supportsSlots: false,
    effortScheduleWithNotes: ["low", "low"],
    effortScheduleNoNotes: ["medium", "low"],
    formatEffort: function (effort) {
      return { reasoning_effort: effort === undefined ? "low" : effort };
    }
  });

  /* ======================================================================
     3. MULTI-.BIN REGISTRY (role + backend + hardware tier + CRC32 pin)
     ======================================================================
     manifest entry:
       { id, role: "tutor|expander|router|critic", backend: "inkling|...|*", file, format: "TNY2",
         minTier: "potato|standard|workstation", priority: number, crc32: optional IEEE CRC32 } */
  function BinRegistry(opts) {
    opts = opts || {};
    var baseDir = opts.baseDir || ".";
    this.tier = opts.tier || "standard";
    this.policy = TIER_POLICIES[this.tier] || TIER_POLICIES.standard;
    this.baseDir = baseDir;
    this.readFile = opts.readFile || (fs ? function (rel) {
      var b = fs.readFileSync(path.join(baseDir, rel));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    } : null);
    this.entries = [];
    this.loaded = Object.create(null);   /* entry.id -> { meta, model } */
  }

  BinRegistry.prototype.register = function (entry) {
    this.entries.push(entry);
    return this;
  };

  BinRegistry.prototype.loadManifest = function (manifestObj) {
    var list = (manifestObj && manifestObj.bins) || [], i;
    for (i = 0; i < list.length; i++) this.register(list[i]);
    return this;
  };

  /* The best entry for (role, backend) that this tier allows. An exact backend match beats "*".
     Returns null when none qualifies, so the caller falls back cleanly. */
  BinRegistry.prototype.resolve = function (role, backendName) {
    var myRank = this.policy.rank, want = String(backendName || "*").toLowerCase();
    var best = null, bestScore = -1, i, e, eb, rank, score;
    for (i = 0; i < this.entries.length; i++) {
      e = this.entries[i];
      if (e.role !== role) continue;
      rank = TIER_RANK[e.minTier || "potato"] || 0;
      if (rank > myRank) continue;
      eb = String(e.backend || "*").toLowerCase();
      if (eb !== want && eb !== "*") continue;
      score = (eb === want ? 1000 : 0) + rank * 100 + (e.priority || 0);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  };

  /* Loads and caches the resolved .bin: size limit, CRC32, format, potato math on the potato tier. */
  BinRegistry.prototype.getModel = function (role, backendName) {
    var entry = this.resolve(role, backendName);
    if (!entry) return null;
    if (this.loaded[entry.id]) return this.loaded[entry.id];
    if (!this.readFile) throw new Error("BinRegistry needs a readFile(path) loader.");

    var buf = this.readFile(entry.file);
    if (buf.byteLength > this.policy.maxBinBytes) {
      throw new Error("Bin '" + entry.id + "' (" + buf.byteLength + " B) exceeds the limit of tier '" + this.tier + "'.");
    }
    if (entry.crc32 !== undefined && entry.crc32 !== null && S) {
      var actual = S.crc32(new Uint8Array(buf));
      if (actual !== entry.crc32) {
        throw new Error("Bin '" + entry.id + "' CRC32 mismatch: expected " + entry.crc32 + ", got " + actual);
      }
    }
    if (entry.format && entry.format !== "TNY2") {
      throw new Error("Format '" + entry.format + "' is not supported by Tiny2Model yet.");
    }

    var model = new E.Tiny2Model();
    model.loadFromArrayBuffer(buf);
    if (this.policy.usePotatoMath && P) P.install(model, 1);
    this.loaded[entry.id] = { meta: entry, model: model };
    return this.loaded[entry.id];
  };

  var API = {
    TIER_RANK: TIER_RANK,
    TIER_POLICIES: TIER_POLICIES,
    hasFeature: hasFeature,
    requireFeature: requireFeature,
    BACKENDS: BACKENDS,
    registerBackend: registerBackend,
    getBackend: getBackend,
    BinRegistry: BinRegistry
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynRegistry = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
