/* evelyn_paper_boost2.js - Six Additional 2026 Paper Mechanisms for Weak/Medium Hardware:
   1. ConformalFilter    (CommCP split conformal prediction quantile filtering)
   2. BudgetCascade      (BudgetMem 4-tier cost-aware escalation cascade)
   3. ShardBloomRouter   (ShardMemo 8-byte Bloom masks for budgeted flash I/O)
   4. UCBBandit          (SCATE / OptimAI UCB1 action & test-strategy scheduler)
   5. MemboxLoom         (Membox topic-coherent memory boxes + timeline links)
   6. FlipRegressionGate (AgentDevel + MonoScale monotonic flip-centered gating)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. COMMCP SPLIT CONFORMAL PREDICTION FILTER (DISTRIBUTION-FREE COVERAGE)
     ========================================================================= */
  function ConformalFilter(alpha) {
    this.alpha = alpha !== undefined ? alpha : 0.10; // Default 90% coverage guarantee
    this.qHat = 1.0;
    this.calibrated = false;
  }

  /* Calibration scores = nonconformity scores (1 - confidence) on verified correct examples */
  ConformalFilter.prototype.calibrate = function (nonconformityScores) {
    if (!nonconformityScores || nonconformityScores.length === 0) return this.qHat;
    var sorted = nonconformityScores.slice(0).sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var rank = Math.ceil((n + 1) * (1.0 - this.alpha));
    if (rank < 1) rank = 1;
    if (rank > n) rank = n;
    this.qHat = sorted[rank - 1];
    this.calibrated = true;
    return this.qHat;
  };

  ConformalFilter.prototype.accept = function (confidence) {
    var nonconf = 1.0 - Math.max(0, Math.min(1, confidence));
    return {
      accepted: nonconf <= this.qHat,
      nonconformity: Number(nonconf.toFixed(4)),
      threshold: Number(this.qHat.toFixed(4))
    };
  };

  /* =========================================================================
     2. BUDGETMEM 4-TIER COST-AWARE CASCADE (CHEAPEST CONFIDENT TIER WINS)
     ========================================================================= */
  var BudgetCascade = {
    /* tiers: [{ name, costMs, run(query) -> { answer, confidence } }] ordered cheapest first */
    execute: function (query, tiers, conformalFilter, maxCostMs) {
      var budget = maxCostMs !== undefined ? maxCostMs : 1000;
      var spent = 0, trace = [], best = null;

      for (var i = 0; i < tiers.length; i++) {
        var tier = tiers[i];
        if (spent + tier.costMs > budget && best !== null) break;
        spent += tier.costMs;
        var res = tier.run(query);
        var check = conformalFilter ? conformalFilter.accept(res.confidence) : { accepted: res.confidence >= 0.8 };
        trace.push({ tier: tier.name, costMs: tier.costMs, confidence: res.confidence, accepted: check.accepted });
        if (!best || res.confidence > best.confidence) {
          best = { tier: tier.name, answer: res.answer, confidence: res.confidence };
        }
        if (check.accepted) {
          return { ok: true, tierUsed: tier.name, answer: res.answer, confidence: res.confidence, spentMs: spent, trace: trace };
        }
      }
      return {
        ok: best !== null,
        tierUsed: best ? best.tier : "none",
        answer: best ? best.answer : "",
        confidence: best ? best.confidence : 0,
        spentMs: spent,
        trace: trace
      };
    }
  };

  /* =========================================================================
     3. SHARDMEMO 64-BIT BLOOM-MASKED SHARD ROUTER (8 BYTES PER SHARD IN RAM)
     ========================================================================= */
  function hashPair(word) {
    var h1 = 2166136261, h2 = 5381, i;
    for (i = 0; i < word.length; i++) {
      var c = word.charCodeAt(i);
      h1 ^= c; h1 = (h1 + (h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24)) >>> 0;
      h2 = (((h2 << 5) + h2) ^ c) >>> 0;
    }
    return [h1 & 63, h2 & 63];
  }

  function pop32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0F0F0F0F;
    x = x + (x >>> 8); x = x + (x >>> 16);
    return x & 0x3F;
  }

  function makeMask64(text) {
    var mask = new Uint32Array(2);
    var ws = String(text || "").toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
    for (var i = 0; i < ws.length; i++) {
      var bits = hashPair(ws[i]);
      for (var b = 0; b < 2; b++) {
        var bit = bits[b];
        if (bit < 32) mask[0] |= (1 << bit);
        else mask[1] |= (1 << (bit - 32));
      }
    }
    return mask;
  }

  function ShardBloomRouter() {
    this.shards = []; // { id, mask: Uint32Array(2) }
  }
  ShardBloomRouter.prototype.registerShard = function (shardId, sampleTermsText) {
    this.shards.push({ id: shardId, mask: makeMask64(sampleTermsText) });
  };
  /* Select at most maxProbeShards whose 64-bit Bloom signature overlaps query bits */
  ShardBloomRouter.prototype.selectShards = function (query, maxProbeShards) {
    var qm = makeMask64(query);
    var qBits = pop32(qm[0]) + pop32(qm[1]);
    if (qBits === 0) return [];
    var scored = [];
    for (var i = 0; i < this.shards.length; i++) {
      var sm = this.shards[i].mask;
      var overlap = pop32(qm[0] & sm[0]) + pop32(qm[1] & sm[1]);
      if (overlap > 0) scored.push({ id: this.shards[i].id, overlap: overlap, ratio: overlap / qBits });
    }
    scored.sort(function (a, b) { return b.overlap - a.overlap; });
    return scored.slice(0, maxProbeShards || 2);
  };

  /* =========================================================================
     4. SCATE / OPTIMAI UCB1 BANDIT SCHEDULER (TEST & STRATEGY SELECTION)
     ========================================================================= */
  function UCBBandit(armNames, exploreC) {
    this.c = exploreC !== undefined ? exploreC : 1.41;
    this.totalPulls = 0;
    this.arms = [];
    for (var i = 0; i < (armNames ? armNames.length : 0); i++) {
      this.arms.push({ name: armNames[i], pulls: 0, rewardSum: 0.0 });
    }
  }
  UCBBandit.prototype.selectArm = function () {
    var bestIdx = 0, bestScore = -1e30;
    for (var i = 0; i < this.arms.length; i++) {
      var a = this.arms[i];
      if (a.pulls === 0) return a.name; // Always explore unvisited arms first
      var mean = a.rewardSum / a.pulls;
      var bonus = this.c * Math.sqrt(Math.log(this.totalPulls) / a.pulls);
      if (mean + bonus > bestScore) { bestScore = mean + bonus; bestIdx = i; }
    }
    return this.arms[bestIdx].name;
  };
  UCBBandit.prototype.update = function (armName, reward) {
    this.totalPulls++;
    for (var i = 0; i < this.arms.length; i++) {
      if (this.arms[i].name === armName) {
        this.arms[i].pulls++;
        this.arms[i].rewardSum += reward;
        return;
      }
    }
  };

  /* =========================================================================
     5. MEMBOX TOPIC LOOM (COHERENT MEMORY BOXES + EVENT TIMELINE)
     ========================================================================= */
  function MemboxLoom() {
    this.boxes = []; // { id, topic, turns: [], sealed: bool, createdAt }
    this.activeBox = null;
  }
  MemboxLoom.prototype.addTurn = function (topic, role, text) {
    var tNorm = String(topic || "general").toLowerCase();
    if (!this.activeBox || this.activeBox.topic !== tNorm) {
      if (this.activeBox) this.activeBox.sealed = true;
      this.activeBox = {
        id: "box_" + (this.boxes.length + 1),
        topic: tNorm,
        turns: [],
        sealed: false,
        createdAt: Date.now()
      };
      this.boxes.push(this.activeBox);
    }
    this.activeBox.turns.push({ role: role, text: String(text || "") });
    return this.activeBox;
  };
  MemboxLoom.prototype.recallTopic = function (topic) {
    var tNorm = String(topic || "").toLowerCase(), turns = [];
    for (var i = 0; i < this.boxes.length; i++) {
      if (this.boxes[i].topic === tNorm) {
        for (var j = 0; j < this.boxes[i].turns.length; j++) turns.push(this.boxes[i].turns[j]);
      }
    }
    return turns;
  };

  /* =========================================================================
     6. AGENTDEVEL + MONOSCALE FLIP-CENTERED MONOTONIC REGRESSION GATE
     ========================================================================= */
  var FlipRegressionGate = {
    evaluate: function (beforeResults, afterResults) {
      var regressions = [], fixes = [], beforePass = 0, afterPass = 0, id;
      var allIds = Object.create(null);
      for (id in beforeResults) allIds[id] = 1;
      for (id in afterResults) allIds[id] = 1;

      for (id in allIds) {
        var b = !!beforeResults[id], a = !!afterResults[id];
        if (b) beforePass++;
        if (a) afterPass++;
        if (b && !a) regressions.push(id);
        else if (!b && a) fixes.push(id);
      }
      var approved = (regressions.length === 0) && (afterPass >= beforePass);
      return {
        approved: approved,
        beforePass: beforePass,
        afterPass: afterPass,
        regressions: regressions,
        fixes: fixes,
        reason: approved ? "monotonic_pass" : ("blocked_regressions: " + regressions.join(", "))
      };
    }
  };

  root.EvelynPaperBoost2 = {
    ConformalFilter: ConformalFilter,
    BudgetCascade: BudgetCascade,
    ShardBloomRouter: ShardBloomRouter,
    UCBBandit: UCBBandit,
    MemboxLoom: MemboxLoom,
    FlipRegressionGate: FlipRegressionGate
  };
})(typeof window !== "undefined" ? window : global);
