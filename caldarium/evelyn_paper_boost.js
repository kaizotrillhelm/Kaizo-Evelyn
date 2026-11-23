/* evelyn_paper_boost.js - Six Unexplored 2026 Paper Mechanisms for Small/Medium Hardware:
   1. ContextOfExperts   (Parallel Context-of-Experts contrastive logit decoding)
   2. JitRLModulator     (Training-free test-time logit modulation from past outcomes)
   3. FadeMemory         (Adaptive exponential decay + conflict resolution + pruning)
   4. CodeLineSkimmer    (SWE-Pruner goal-aware line skimmer for tight context budgets)
   5. CellAwareTableIndex(Topo-RAG exact row/column tabular retriever)
   6. TrustBroker & TrajGuard (Epistemic reliability + quadratic voting + SWE-Replay + StepShield)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. PARALLEL CONTEXT-OF-EXPERTS DECODING (BREAKS CTX=128 MULTI-DOC LIMIT)
        Combines per-document logit vectors with retrieval weights + contrastive prior.
     ========================================================================= */
  var ContextOfExperts = {
    combineLogits: function (expertLogitsList, weights, baseLogits, beta) {
      var k = expertLogitsList.length;
      if (k === 0) return baseLogits ? new Float32Array(baseLogits) : new Float32Array(0);
      var V = expertLogitsList[0].length;
      var out = new Float32Array(V);
      var b = beta !== undefined ? beta : 0.35;
      var wSum = 0.0, e, i;
      for (e = 0; e < k; e++) wSum += (weights && weights[e] > 0) ? weights[e] : 1.0;

      for (i = 0; i < V; i++) {
        var mix = 0.0;
        for (e = 0; e < k; e++) {
          var w = ((weights && weights[e] > 0) ? weights[e] : 1.0) / wSum;
          mix += w * expertLogitsList[e][i];
        }
        var prior = baseLogits ? baseLogits[i] : 0.0;
        out[i] = mix + b * (mix - prior); // Retrieval-aware contrastive boost
      }
      return out;
    },
    argmax: function (logits) {
      var best = 0;
      for (var i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
      return best;
    }
  };

  /* =========================================================================
     2. JitRL (JUST-IN-TIME LOGIT REINFORCEMENT WITHOUT GRADIENT UPDATES)
     ========================================================================= */
  function wordSet(text) {
    var m = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    var s = Object.create(null);
    for (var i = 0; i < m.length; i++) s[m[i]] = 1;
    return s;
  }
  function jaccard(setA, setB) {
    var inter = 0, uni = 0, k;
    for (k in setA) { uni++; if (setB[k]) inter++; }
    for (k in setB) { if (!setA[k]) uni++; }
    return uni === 0 ? 0 : (inter / uni);
  }

  function JitRLModulator() {
    this.experiences = []; // { words, goodTok, badTok, reward }
  }
  JitRLModulator.prototype.recordFeedback = function (queryText, goodTok, badTok, reward) {
    this.experiences.push({
      words: wordSet(queryText),
      goodTok: goodTok,
      badTok: badTok,
      reward: reward !== undefined ? reward : 2.5
    });
    if (this.experiences.length > 200) this.experiences.shift();
  };
  JitRLModulator.prototype.modulateLogits = function (queryText, logits, minSim) {
    var thr = minSim !== undefined ? minSim : 0.35;
    var qw = wordSet(queryText);
    var out = new Float32Array(logits);
    var matched = 0;
    for (var i = 0; i < this.experiences.length; i++) {
      var ex = this.experiences[i];
      var sim = jaccard(qw, ex.words);
      if (sim >= thr) {
        matched++;
        var delta = ex.reward * sim;
        if (ex.goodTok >= 0 && ex.goodTok < out.length) out[ex.goodTok] += delta;
        if (ex.badTok >= 0 && ex.badTok < out.length) out[ex.badTok] -= delta;
      }
    }
    return { logits: out, matchedExperiences: matched };
  };

  /* =========================================================================
     3. FADEMEM (ADAPTIVE EXPONENTIAL DECAY + CONFLICT RESOLUTION + PRUNING)
     ========================================================================= */
  function FadeMemory(decayRate) {
    this.decayRate = decayRate !== undefined ? decayRate : 0.25;
    this.map = Object.create(null); // key -> { key, val, importance, updatedAt, hits }
    this.conflictsResolved = 0;
  }
  FadeMemory.prototype.observe = function (key, val, importance, nowMs) {
    var now = nowMs !== undefined ? nowMs : Date.now();
    var imp = importance !== undefined ? importance : 1.0;
    var existing = this.map[key];
    var conflict = false;
    if (existing) {
      if (existing.val !== val) {
        conflict = true;
        this.conflictsResolved++;
        existing.val = val;
        existing.importance = Math.max(existing.importance, imp) + 0.5; // Resolved conflicts stay sticky
      } else {
        existing.hits += 1;
        existing.importance = Math.min(10.0, existing.importance + 0.35);
      }
      existing.updatedAt = now;
    } else {
      this.map[key] = { key: key, val: val, importance: imp, updatedAt: now, hits: 1 };
    }
    return { conflictResolved: conflict, entry: this.map[key] };
  };
  FadeMemory.prototype.retention = function (entry, nowMs) {
    var ageDays = Math.max(0, ((nowMs !== undefined ? nowMs : Date.now()) - entry.updatedAt) / 86400000);
    return Math.exp((-this.decayRate * ageDays) / Math.max(0.5, entry.importance));
  };
  FadeMemory.prototype.prune = function (minRetention, nowMs) {
    var thr = minRetention !== undefined ? minRetention : 0.25;
    var now = nowMs !== undefined ? nowMs : Date.now();
    var pruned = [];
    for (var k in this.map) {
      if (this.retention(this.map[k], now) < thr) {
        pruned.push(k);
        delete this.map[k];
      }
    }
    return { prunedCount: pruned.length, prunedKeys: pruned };
  };

  /* =========================================================================
     4. SWE-PRUNER (GOAL-AWARE CODE LINE SKIMMER FOR SMALL CONTEXT WINDOWS)
     ========================================================================= */
  var CodeLineSkimmer = {
    skim: function (code, goalText, maxLines, errorLineNo) {
      var lines = String(code || "").split(/\r?\n/);
      var cap = maxLines || 12;
      if (lines.length <= cap) return { code: code, kept: lines.length, dropped: 0 };
      var goalW = wordSet(goalText);
      var scored = [], i, w;

      for (i = 0; i < lines.length; i++) {
        var ln = lines[i], tr = ln.trim(), sc = 0;
        if (i === 0 || /^\s*(?:function|def|fn|SUB|int|static)\b/.test(ln)) sc += 10; // Keep header
        if (errorLineNo && Math.abs((i + 1) - errorLineNo) <= 1) sc += 12;           // Keep error neighborhood
        if (/\breturn\b/.test(tr)) sc += 4;
        if (tr === "" || tr.indexOf("//") === 0 || tr.indexOf("#") === 0) sc -= 3;   // Drop comments/blanks first
        var lw = tr.toLowerCase().match(/[a-z0-9_]+/g) || [];
        for (w = 0; w < lw.length; w++) if (goalW[lw[w]]) sc += 5;
        scored.push({ idx: i, score: sc });
      }

      scored.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
      var keepSet = Object.create(null);
      for (i = 0; i < Math.min(cap, scored.length); i++) keepSet[scored[i].idx] = 1;

      var out = [], skipping = false, kept = 0;
      for (i = 0; i < lines.length; i++) {
        if (keepSet[i]) { out.push(lines[i]); kept++; skipping = false; }
        else if (!skipping) { out.push("  // ..."); skipping = true; }
      }
      return { code: out.join("\n"), kept: kept, dropped: lines.length - kept };
    }
  };

  /* =========================================================================
     5. TOPO-RAG CELL-AWARE TABLE INDEX (PRESERVES ROW/COLUMN COORDINATES)
     ========================================================================= */
  function CellAwareTableIndex() {
    this.tables = Object.create(null); // name -> { keyCol, headers, rows }
  }
  CellAwareTableIndex.prototype.addTable = function (name, keyCol, headers, rows) {
    this.tables[name] = { keyCol: keyCol, headers: headers.slice(0), rows: rows.slice(0) };
  };
  CellAwareTableIndex.prototype.queryCell = function (tableName, rowKey, colName) {
    var t = this.tables[tableName];
    if (!t) return { ok: false, error: "Unknown table: " + tableName };
    var rk = String(rowKey || "").toLowerCase();
    var ck = String(colName || "").toLowerCase();
    var targetCol = null, i;
    for (i = 0; i < t.headers.length; i++) {
      if (t.headers[i].toLowerCase() === ck) { targetCol = t.headers[i]; break; }
    }
    if (!targetCol) return { ok: false, error: "Unknown column: " + colName };
    for (i = 0; i < t.rows.length; i++) {
      if (String(t.rows[i][t.keyCol] || "").toLowerCase() === rk) {
        return {
          ok: true,
          value: t.rows[i][targetCol],
          provenance: "[table:" + tableName + " | row:" + t.rows[i][t.keyCol] + " | col:" + targetCol + "]"
        };
      }
    }
    return { ok: false, error: "Row not found: " + rowKey };
  };

  /* =========================================================================
     6. EPISTEMIC TRUST BROKER (QUADRATIC VOTING) + SWE-REPLAY / STEPSHIELD GUARD
     ========================================================================= */
  function TrustBroker() {
    this.stats = Object.create(null); // "echoId|subject" -> { wins, trials }
  }
  TrustBroker.prototype.recordOutcome = function (echoId, subject, ok) {
    var k = echoId + "|" + subject;
    if (!this.stats[k]) this.stats[k] = { wins: 0, trials: 0 };
    this.stats[k].trials++;
    if (ok) this.stats[k].wins++;
  };
  TrustBroker.prototype.reliability = function (echoId, subject) {
    var rec = this.stats[echoId + "|" + subject];
    if (!rec) return 0.5;
    return (rec.wins + 1) / (rec.trials + 2); // Laplace-smoothed trust
  };
  /* Quadratic trust voting: weight = sqrt(reliability * 100) so weak Echoes cannot drown experts */
  TrustBroker.prototype.quadraticVote = function (subject, proposals) {
    var tally = Object.create(null), i;
    for (i = 0; i < proposals.length; i++) {
      var p = proposals[i];
      var rel = this.reliability(p.echoId, subject);
      var qWeight = Math.sqrt(rel * 100.0) * (p.confidence || 1.0);
      tally[p.answer] = (tally[p.answer] || 0) + qWeight;
    }
    var bestAns = null, bestScore = -1;
    for (var ans in tally) {
      if (tally[ans] > bestScore) { bestScore = tally[ans]; bestAns = ans; }
    }
    return { winner: bestAns, score: Number(bestScore.toFixed(2)), tally: tally };
  };

  /* StepShield Early Intervention + SWE-Replay Checkpoint Rollback */
  function TrajGuard(maxSteps) {
    this.maxSteps = maxSteps || 12;
    this.checkpoints = []; // { step, actionSig, state }
    this.steps = 0;
  }
  TrajGuard.prototype.step = function (actionSig, stateSnapshot) {
    this.steps++;
    if (this.steps > this.maxSteps) {
      return { allow: false, intervene: true, reason: "step_budget_exceeded", savedRollback: this.lastCheckpoint() };
    }
    /* Detect immediate repeated-action loop anomaly (StepShield early halt) */
    var n = this.checkpoints.length;
    if (n >= 2 && this.checkpoints[n - 1].actionSig === actionSig && this.checkpoints[n - 2].actionSig === actionSig) {
      return { allow: false, intervene: true, reason: "action_loop_detected", savedRollback: this.checkpoints[n - 2] };
    }
    var cp = { step: this.steps, actionSig: actionSig, state: JSON.parse(JSON.stringify(stateSnapshot || {})) };
    this.checkpoints.push(cp);
    return { allow: true, intervene: false, checkpoint: cp };
  };
  TrajGuard.prototype.lastCheckpoint = function () {
    return this.checkpoints.length ? this.checkpoints[this.checkpoints.length - 1] : null;
  };
  /* SWE-Replay: branch cleanly from an earlier valid checkpoint instead of restarting at step 0 */
  TrajGuard.prototype.branchFrom = function (stepNo) {
    for (var i = 0; i < this.checkpoints.length; i++) {
      if (this.checkpoints[i].step === stepNo) {
        this.checkpoints = this.checkpoints.slice(0, i + 1);
        this.steps = stepNo;
        return { ok: true, state: JSON.parse(JSON.stringify(this.checkpoints[i].state)) };
      }
    }
    return { ok: false, error: "Checkpoint not found: " + stepNo };
  };

  root.EvelynPaperBoost = {
    ContextOfExperts: ContextOfExperts,
    JitRLModulator: JitRLModulator,
    FadeMemory: FadeMemory,
    CodeLineSkimmer: CodeLineSkimmer,
    CellAwareTableIndex: CellAwareTableIndex,
    TrustBroker: TrustBroker,
    TrajGuard: TrajGuard
  };
})(typeof window !== "undefined" ? window : global);
