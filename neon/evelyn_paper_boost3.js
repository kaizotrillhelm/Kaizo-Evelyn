/* evelyn_paper_boost3.js - Third Wave of 2026 Paper Adaptations for Small/Medium Hardware:
   1. TaskTreeDAG       (ROMA + Dep-Search topological subtask runner with cycle guard)
   2. InfoGainPruner    (Less is More for RAG: MMR diversity & utility budget pruning)
   3. SafeSemanticCache (CacheAttack defense: order-sensitive numeric/polarity fingerprint)
   4. TaintCFI          (CaMeLs + POLARIS: locked control-flow plan + data taint isolation)
   5. MetamorphicQuizzer(Family-Based Eval: equivalent clock, math & code-var transforms)
   6. MiniAutoSR        (AutoSR + AutoNumerics: OLS symbolic law discovery from (x, y) data)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. ROMA + DEP-SEARCH TOPOLOGICAL SUBTASK DAG (WITH CYCLE DETECTION)
     ========================================================================= */
  var TaskTreeDAG = {
    run: function (nodes) {
      /* nodes: [{ id, deps: [id...], run(depOutputs) -> value }] */
      var byId = Object.create(null), inDeg = Object.create(null), children = Object.create(null);
      var i, j, nd;
      for (i = 0; i < nodes.length; i++) {
        nd = nodes[i];
        byId[nd.id] = nd;
        inDeg[nd.id] = 0;
        children[nd.id] = [];
      }
      for (i = 0; i < nodes.length; i++) {
        nd = nodes[i];
        var deps = nd.deps || [];
        for (j = 0; j < deps.length; j++) {
          if (!byId[deps[j]]) return { ok: false, error: "Missing dependency '" + deps[j] + "' for " + nd.id };
          children[deps[j]].push(nd.id);
          inDeg[nd.id]++;
        }
      }

      var queue = [], order = [], outputs = Object.create(null);
      for (i = 0; i < nodes.length; i++) if (inDeg[nodes[i].id] === 0) queue.push(nodes[i].id);

      while (queue.length > 0) {
        var curId = queue.shift();
        order.push(curId);
        var depOut = Object.create(null);
        var curDeps = byId[curId].deps || [];
        for (j = 0; j < curDeps.length; j++) depOut[curDeps[j]] = outputs[curDeps[j]];
        outputs[curId] = byId[curId].run(depOut);

        var nexts = children[curId];
        for (j = 0; j < nexts.length; j++) {
          inDeg[nexts[j]]--;
          if (inDeg[nexts[j]] === 0) queue.push(nexts[j]);
        }
      }

      if (order.length !== nodes.length) {
        return { ok: false, error: "Cycle detected in subtask dependency graph." };
      }
      return { ok: true, order: order, outputs: outputs };
    }
  };

  /* =========================================================================
     2. LESS IS MORE FOR RAG (INFORMATION-GAIN & REDUNDANCY PRUNING / MMR)
     ========================================================================= */
  function tokenSet(s) {
    var m = String(s || "").toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
    var set = Object.create(null);
    for (var i = 0; i < m.length; i++) set[m[i]] = 1;
    return set;
  }
  function jaccardSet(a, b) {
    var inter = 0, uni = 0, k;
    for (k in a) { uni++; if (b[k]) inter++; }
    for (k in b) { if (!a[k]) uni++; }
    return uni === 0 ? 0 : (inter / uni);
  }

  var InfoGainPruner = {
    /* candidates: [{ id, text, relevance }] */
    select: function (candidates, opts) {
      opts = opts || {};
      var maxChars = opts.maxChars || 400;
      var minRel = opts.minRelevance !== undefined ? opts.minRelevance : 0.2;
      var lambda = opts.redundancyPenalty !== undefined ? opts.redundancyPenalty : 0.7;

      var pool = [], i;
      for (i = 0; i < candidates.length; i++) {
        if ((candidates[i].relevance || 0) >= minRel) {
          pool.push({ item: candidates[i], toks: tokenSet(candidates[i].text), picked: false });
        }
      }

      var chosen = [], chosenToks = [], usedChars = 0;
      while (true) {
        var bestIdx = -1, bestGain = -1e9;
        for (i = 0; i < pool.length; i++) {
          if (pool[i].picked) continue;
          var len = pool[i].item.text.length;
          if (usedChars + len > maxChars && chosen.length > 0) continue;
          var maxSim = 0;
          for (var c = 0; c < chosenToks.length; c++) {
            var sim = jaccardSet(pool[i].toks, chosenToks[c]);
            if (sim > maxSim) maxSim = sim;
          }
          var gain = pool[i].item.relevance - lambda * maxSim;
          if (gain > bestGain) { bestGain = gain; bestIdx = i; }
        }
        if (bestIdx < 0 || bestGain <= 0) break;
        pool[bestIdx].picked = true;
        chosen.push(pool[bestIdx].item);
        chosenToks.push(pool[bestIdx].toks);
        usedChars += pool[bestIdx].item.text.length;
      }
      return { selected: chosen, usedChars: usedChars, droppedCount: candidates.length - chosen.length };
    }
  };

  /* =========================================================================
     3. CACHEATTACK DEFENSE: COLLISION-RESISTANT SEMANTIC CACHE
        Requires exact structural match on ordered numbers, polarity & directions.
     ========================================================================= */
  var CRITICAL_TOKENS = {
    not:1, never:1, no:1, left:1, right:1, up:1, down:1, before:1, after:1,
    bigger:1, smaller:1, more:1, less:1, above:1, below:1, add:1, subtract:1, multiply:1, divide:1
  };

  function structuralFingerprint(text) {
    var m = String(text || "").toLowerCase().match(/\d+(?:\.\d+)?|<=|>=|!=|[<>+\-*/]|[a-z]+/g) || [];
    var sig = [];
    for (var i = 0; i < m.length; i++) {
      if (/^\d|^[<>+\-*/!=]/.test(m[i]) || CRITICAL_TOKENS[m[i]]) sig.push(m[i]);
    }
    return sig.join("|");
  }

  function SafeSemanticCache(minJaccard) {
    this.minJaccard = minJaccard !== undefined ? minJaccard : 0.55;
    this.entries = [];
  }
  SafeSemanticCache.prototype.put = function (query, answer) {
    this.entries.push({
      query: query, answer: answer,
      sig: structuralFingerprint(query),
      toks: tokenSet(query)
    });
    if (this.entries.length > 128) this.entries.shift();
  };
  SafeSemanticCache.prototype.get = function (query) {
    var qSig = structuralFingerprint(query);
    var qToks = tokenSet(query);
    var best = null, bestSim = 0;
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      if (e.sig !== qSig) continue; // Blocks CacheAttack & polarity/order collisions!
      var sim = jaccardSet(qToks, e.toks);
      if (sim >= this.minJaccard && sim > bestSim) { bestSim = sim; best = e; }
    }
    return best ? { hit: true, answer: best.answer, similarity: Number(bestSim.toFixed(3)) } : { hit: false };
  };

  /* =========================================================================
     4. CAMELS + POLARIS CONTROL-FLOW INTEGRITY & TAINT TRACKING
        Locks step plan BEFORE reading untrusted text; blocks tainted privileged ops.
     ========================================================================= */
  var PRIVILEGED_OPS = { WRITE_FILE:1, SERIAL_DRIVE:1, EXEC_CODE:1, FLASH_MCU:1 };

  function TaintCFI(lockedPlan) {
    this.plan = (lockedPlan || []).slice(0);
    this.cursor = 0;
    this.violations = [];
  }
  TaintCFI.wrapUntrusted = function (val, source) {
    return { value: val, tainted: true, source: source || "external" };
  };
  TaintCFI.wrapTrusted = function (val) {
    return { value: val, tainted: false, source: "trusted_core" };
  };
  TaintCFI.prototype.authorize = function (opName, argEnvelope) {
    if (this.cursor >= this.plan.length || this.plan[this.cursor] !== opName) {
      var err1 = "CFI plan mismatch: expected '" + (this.plan[this.cursor] || "END") + "', got '" + opName + "'";
      this.violations.push(err1);
      return { allowed: false, reason: "cfi_plan_violation", detail: err1 };
    }
    if (PRIVILEGED_OPS[opName] && argEnvelope && argEnvelope.tainted) {
      var err2 = "Taint block: untrusted data from '" + argEnvelope.source + "' cannot invoke " + opName;
      this.violations.push(err2);
      return { allowed: false, reason: "taint_violation", detail: err2 };
    }
    this.cursor++;
    return { allowed: true, stepCompleted: this.cursor, value: argEnvelope ? argEnvelope.value : null };
  };

  /* =========================================================================
     5. METAMORPHIC PROBLEM FAMILY GENERATOR (TESTS UNDERSTANDING, NOT ROTE)
     ========================================================================= */
  var MetamorphicQuizzer = {
    /* Shift a Coccyx Corale* elapsed-time problem by deltaMin minutes (always 12-hr AM/PM) */
    shiftClockFamily: function (startTotalMin, legMin, shifts) {
      function fmt12(m) {
        var mm = ((m % 1440) + 1440) % 1440;
        var h24 = Math.floor(mm / 60), mn = mm % 60;
        var ap = h24 >= 12 ? "PM" : "AM";
        var h12 = h24 % 12; if (h12 === 0) h12 = 12;
        return h12 + ":" + (mn < 10 ? "0" : "") + mn + " " + ap;
      }
      var list = shifts || [0, 15, 35], out = [];
      for (var i = 0; i < list.length; i++) {
        var s = startTotalMin + list[i];
        out.push({
          q: "Leave at " + fmt12(s) + " on a " + legMin + "-minute leg. Arrival clock?",
          ans: fmt12(s + legMin),
          shiftMin: list[i]
        });
      }
      return out;
    },

    /* Rename variables in a small code snippet to create structurally identical quiz variants */
    renameCodeFamily: function (code, varName, altNames) {
      var re = new RegExp("\\b" + varName + "\\b", "g");
      var out = [];
      for (var i = 0; i < altNames.length; i++) {
        out.push({ varName: altNames[i], code: String(code).replace(re, altNames[i]) });
      }
      return out;
    }
  };

  /* =========================================================================
     6. AUTOSR + AUTONUMERICS: DETERMINISTIC SYMBOLIC EQUATION DISCOVERY
        Fits constant, linear (a*x+b), quadratic (a*x^2+b*x+c), and inverse (a/x+b).
     ========================================================================= */
  function solve3x3(A, b) {
    /* Gaussian elimination with partial pivoting on 3x3 linear system */
    var M = [
      [A[0][0], A[0][1], A[0][2], b[0]],
      [A[1][0], A[1][1], A[1][2], b[1]],
      [A[2][0], A[2][1], A[2][2], b[2]]
    ];
    var col, row, k;
    for (col = 0; col < 3; col++) {
      var piv = col;
      for (row = col + 1; row < 3; row++) if (Math.abs(M[row][col]) > Math.abs(M[piv][col])) piv = row;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      for (row = col + 1; row < 3; row++) {
        var f = M[row][col] / M[col][col];
        for (k = col; k < 4; k++) M[row][k] -= f * M[col][k];
      }
    }
    var x = [0, 0, 0];
    for (row = 2; row >= 0; row--) {
      var s = M[row][3];
      for (k = row + 1; k < 3; k++) s -= M[row][k] * x[k];
      x[row] = s / M[row][row];
    }
    return x;
  }

  function fitLinearXY(xs, ys) {
    var n = xs.length, sx = 0, sy = 0, sxx = 0, sxy = 0, i;
    for (i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    var denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return null;
    var a = (n * sxy - sx * sy) / denom;
    var b = (sy - a * sx) / n;
    var mse = 0;
    for (i = 0; i < n; i++) { var e = (a * xs[i] + b) - ys[i]; mse += e * e; }
    return { a: a, b: b, mse: mse / n };
  }

  var MiniAutoSR = {
    discover: function (points) {
      if (!points || points.length < 3) return { ok: false, error: "Need at least 3 (x, y) data points." };
      var xs = [], ys = [], invXs = [], canInv = true, i;
      for (i = 0; i < points.length; i++) {
        xs.push(points[i][0]); ys.push(points[i][1]);
        if (Math.abs(points[i][0]) < 1e-9) canInv = false;
        else invXs.push(1.0 / points[i][0]);
      }

      var candidates = [];

      /* Model 1: Linear y = a*x + b (2 params) */
      var lin = fitLinearXY(xs, ys);
      if (lin) {
        candidates.push({
          family: "linear", params: 2, mse: lin.mse,
          formula: "y = " + lin.a.toFixed(4) + "*x + " + lin.b.toFixed(4),
          predict: function (x) { return lin.a * x + lin.b; }
        });
      }

      /* Model 2: Quadratic y = a*x^2 + b*x + c (3 params) */
      var s0 = xs.length, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
      for (i = 0; i < xs.length; i++) {
        var x = xs[i], x2 = x * x, y = ys[i];
        s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
        t0 += y; t1 += x * y; t2 += x2 * y;
      }
      var qCoef = solve3x3([[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]], [t2, t1, t0]);
      if (qCoef) {
        var qMse = 0;
        for (i = 0; i < xs.length; i++) {
          var qe = (qCoef[0] * xs[i] * xs[i] + qCoef[1] * xs[i] + qCoef[2]) - ys[i];
          qMse += qe * qe;
        }
        qMse /= xs.length;
        candidates.push({
          family: "quadratic", params: 3, mse: qMse,
          formula: "y = " + qCoef[0].toFixed(4) + "*x^2 + " + qCoef[1].toFixed(4) + "*x + " + qCoef[2].toFixed(4),
          predict: function (x) { return qCoef[0] * x * x + qCoef[1] * x + qCoef[2]; }
        });
      }

      /* Model 3: Inverse y = a/x + b (2 params) */
      if (canInv) {
        var inv = fitLinearXY(invXs, ys);
        if (inv) {
          candidates.push({
            family: "inverse", params: 2, mse: inv.mse,
            formula: "y = " + inv.a.toFixed(4) + "/x + " + inv.b.toFixed(4),
            predict: function (x) { return inv.a / x + inv.b; }
          });
        }
      }

      /* Parsimony-weighted ranking: prefer simpler model when MSE is tied near 0 */
      candidates.sort(function (u, v) {
        var scoreU = u.mse + u.params * 1e-4;
        var scoreV = v.mse + v.params * 1e-4;
        return scoreU - scoreV;
      });
      var best = candidates[0];
      return { ok: true, best: best, allCandidates: candidates };
    }
  };

  root.EvelynPaperBoost3 = {
    TaskTreeDAG: TaskTreeDAG,
    InfoGainPruner: InfoGainPruner,
    SafeSemanticCache: SafeSemanticCache,
    TaintCFI: TaintCFI,
    MetamorphicQuizzer: MetamorphicQuizzer,
    MiniAutoSR: MiniAutoSR
  };
})(typeof window !== "undefined" ? window : global);
