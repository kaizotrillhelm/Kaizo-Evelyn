/* evelyn_effort_model.js - a few weights, learned from Evelyn's own runs, that pick Inkling's reasoning effort and token budget.

   Every run of EvelynCodeLoop leaves a row: what the search found (hits, top BM25 score, the gap to the second hit), how long
   the prompt was, whether the task has code words, the effort used on the first call, whether the first draft passed, and how
   many tokens the first call wrote. EffortModel fits two small models on such rows:
     1. P(first draft passes | features, effort): logistic regression on standardised features, a ridge penalty, batch gradient steps;
     2. ln(tokens of the first call): ridge least squares, used for a token budget that is the 90th percentile of the fit.
   choose(features) returns the lowest effort on a grid from 0.05 to 0.85 whose predicted pass chance reaches the target
   (default 0.8), or the effort with the best chance when none reaches it, with a token budget.
   It saves as a small JSON object (about 40 numbers). It will not decide on too little data: with fewer than minRows rows, or rows
   of one outcome only, or one effort only, choose() returns the default of the loop and says source "default".

   Plain ES5, no dependencies, pure functions of the rows (no random numbers, so the same rows give the same model). */
(function (root) {
  "use strict";

  var NAMES = ["hits", "topScore", "relGap", "promptChars", "hasCodeWords", "effort"];

  function featureVector(f, effort) {
    return [
      Math.min(Number(f.hits) || 0, 4) / 4,
      Math.log(1 + (Number(f.topScore) || 0)),
      Number(f.relGap) || 0,
      Math.log(1 + (Number(f.promptChars) || 0)),
      f.hasCodeWords ? 1 : 0,
      Number(effort) || 0
    ];
  }

  function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }

  /* solve A x = b for a small dense system (Gaussian elimination with partial pivoting) */
  function solve(A, b) {
    var n = b.length, i, j, k, M = [], x = [], piv, t, f;
    for (i = 0; i < n; i++) M.push(A[i].slice(0).concat([b[i]]));
    for (i = 0; i < n; i++) {
      piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[piv][i])) piv = j;
      t = M[i]; M[i] = M[piv]; M[piv] = t;
      if (Math.abs(M[i][i]) < 1e-12) M[i][i] = 1e-12;
      for (j = i + 1; j < n; j++) {
        f = M[j][i] / M[i][i];
        for (k = i; k <= n; k++) M[j][k] -= f * M[i][k];
      }
    }
    for (i = n - 1; i >= 0; i--) {
      t = M[i][n];
      for (j = i + 1; j < n; j++) t -= M[i][j] * x[j];
      x[i] = t / M[i][i];
    }
    return x;
  }

  function EffortModel(opts) {
    opts = opts || {};
    this.minRows = opts.minRows || 20;
    this.target = opts.target !== undefined ? opts.target : 0.8;
    this.grid = opts.grid || [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85];
    this.defaults = opts.defaults || { withNotes: 0.2, withoutNotes: 0.55, maxTokens: 6000 };
    this.fitted = false; this.n = 0; this.reason = "not fitted";
    this.mean = null; this.std = null; this.w = null; this.tw = null; this.resSd = 0;
  }

  /* rows: [{ hits, topScore, relGap, promptChars, hasCodeWords, effort, ok, tokens }]; ok is the first draft */
  EffortModel.prototype.fit = function (rows) {
    var self = this, i, j, k, n = rows.length, d = NAMES.length;
    this.n = n; this.fitted = false;
    var pos = 0, efforts = {};
    for (i = 0; i < n; i++) { if (rows[i].ok) pos++; efforts[Number(rows[i].effort).toFixed(2)] = 1; }
    if (n < this.minRows) { this.reason = "only " + n + " rows, " + this.minRows + " needed"; return this; }
    if (pos === 0 || pos === n) { this.reason = "every row has the same outcome"; return this; }
    if (Object.keys(efforts).length < 2) { this.reason = "only one effort in the rows"; return this; }

    var X = [];
    for (i = 0; i < n; i++) X.push(featureVector(rows[i], rows[i].effort));
    var mean = [], std = [];
    for (j = 0; j < d; j++) {
      var s = 0, q = 0;
      for (i = 0; i < n; i++) s += X[i][j];
      mean.push(s / n);
      for (i = 0; i < n; i++) q += (X[i][j] - mean[j]) * (X[i][j] - mean[j]);
      std.push(Math.sqrt(q / n) || 1);
    }
    var Z = [];
    for (i = 0; i < n; i++) { var z = [1]; for (j = 0; j < d; j++) z.push((X[i][j] - mean[j]) / std[j]); Z.push(z); }

    /* logistic regression, 3000 batch steps, ridge 0.05 on all but the bias */
    var w = []; for (j = 0; j <= d; j++) w.push(0);
    var lr = 0.3, lam = 0.05, it, g, p;
    for (it = 0; it < 3000; it++) {
      g = []; for (j = 0; j <= d; j++) g.push(0);
      for (i = 0; i < n; i++) {
        var dot = 0; for (j = 0; j <= d; j++) dot += w[j] * Z[i][j];
        p = sigmoid(dot) - (rows[i].ok ? 1 : 0);
        for (j = 0; j <= d; j++) g[j] += p * Z[i][j];
      }
      for (j = 0; j <= d; j++) w[j] -= lr * (g[j] / n + (j > 0 ? lam * w[j] : 0));
    }

    /* ridge least squares for ln(tokens) */
    var ata = [], atb = [], y = [];
    for (i = 0; i < n; i++) y.push(Math.log(Math.max(1, Number(rows[i].tokens) || 1)));
    for (j = 0; j <= d; j++) { ata.push([]); atb.push(0); for (k = 0; k <= d; k++) ata[j].push(0); }
    for (i = 0; i < n; i++) for (j = 0; j <= d; j++) { atb[j] += Z[i][j] * y[i]; for (k = 0; k <= d; k++) ata[j][k] += Z[i][j] * Z[i][k]; }
    for (j = 1; j <= d; j++) ata[j][j] += 1.0;
    var tw = solve(ata, atb), sse = 0;
    for (i = 0; i < n; i++) { var pr = 0; for (j = 0; j <= d; j++) pr += tw[j] * Z[i][j]; sse += (y[i] - pr) * (y[i] - pr); }

    this.mean = mean; this.std = std; this.w = w; this.tw = tw; this.resSd = Math.sqrt(sse / n);
    this.fitted = true; this.reason = "fitted on " + n + " rows";
    return self;
  };

  EffortModel.prototype._z = function (f, effort) {
    var x = featureVector(f, effort), z = [1], j;
    for (j = 0; j < x.length; j++) z.push((x[j] - this.mean[j]) / this.std[j]);
    return z;
  };

  /* P(first draft passes) */
  EffortModel.prototype.predict = function (f, effort) {
    if (!this.fitted) return null;
    var z = this._z(f, effort), dot = 0, j;
    for (j = 0; j < z.length; j++) dot += this.w[j] * z[j];
    return sigmoid(dot);
  };

  /* tokens the first call is likely to write, as the 90th percentile of the fit */
  EffortModel.prototype.tokensFor = function (f, effort) {
    if (!this.fitted) return null;
    var z = this._z(f, effort), dot = 0, j;
    for (j = 0; j < z.length; j++) dot += this.tw[j] * z[j];
    return Math.round(Math.exp(dot + 1.28 * this.resSd));
  };

  EffortModel.prototype.choose = function (f) {
    var dflt = (Number(f.hits) > 0 ? this.defaults.withNotes : this.defaults.withoutNotes);
    if (!this.fitted) return { effort: dflt, maxTokens: this.defaults.maxTokens, source: "default", why: this.reason };
    var best = null, chosen = null, i, e, p;
    for (i = 0; i < this.grid.length; i++) {
      e = this.grid[i]; p = this.predict(f, e);
      if (best === null || p > best.p) best = { e: e, p: p };
      if (chosen === null && p >= this.target) chosen = { e: e, p: p };
    }
    var pick = chosen || best;
    var tok = this.tokensFor(f, pick.e);
    return {
      effort: pick.e, pPass: pick.p, reachedTarget: !!chosen, source: "model", why: this.reason,
      maxTokens: Math.max(1000, Math.min(8000, tok))
    };
  };

  EffortModel.prototype.toJSON = function () {
    return { names: NAMES, target: this.target, n: this.n, fitted: this.fitted, reason: this.reason, mean: this.mean, std: this.std, w: this.w, tw: this.tw, resSd: this.resSd };
  };

  EffortModel.fromJSON = function (o, opts) {
    var m = new EffortModel(opts);
    m.target = o.target !== undefined ? o.target : m.target; m.n = o.n; m.fitted = !!o.fitted; m.reason = o.reason;
    m.mean = o.mean; m.std = o.std; m.w = o.w; m.tw = o.tw; m.resSd = o.resSd;
    return m;
  };

  /* a training row from the result of EvelynCodeLoop.run: the first call's effort and tokens, whether the first draft passed */
  function rowFromRun(result) {
    var f = result.features || {};
    return {
      hits: f.hits || 0, topScore: f.topScore || 0, relGap: f.relGap || 0, promptChars: f.promptChars || 0, hasCodeWords: f.hasCodeWords || 0,
      effort: (result.efforts && result.efforts.length ? result.efforts[0] : 0), ok: !!result.firstDraftOk,
      tokens: result.tokens && result.tokens.length ? result.tokens[0] : 0
    };
  }

  var API = { EffortModel: EffortModel, rowFromRun: rowFromRun, featureVector: featureVector, solve: solve };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynEffortModel = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
