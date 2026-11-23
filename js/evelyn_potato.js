/* evelyn_potato.js - an optional integer engine for Evelyn's TNY2 model, for machines with no
   fast floating point unit and a small cache (the "potato" target: a 486 or a first Pentium,
   a phone from a decade ago, anything where a float multiply costs much more than an integer one).

   What it changes, and what it costs. The reference engine (evelyn_core.js) multiplies an
   Int8 weight by a Float32 activation, rows * columns times. Here the activation vector is
   rounded to Int8 once, the whole product is Int8 x Int8 summed in a 32-bit integer, and each row
   takes one float multiply at the end. That is a different number from the reference engine: the
   scores differ in the third or fourth digit and now and then a close call between two letters
   goes the other way. So this file is NOT used by default, and the C and BASIC editions (which
   are checked against the reference engine letter for letter) do not have it. The weight file is
   the same TNY2 file; nothing about the formats changes.

   level 1  integer matrix products only (every weight matrix), zero columns skipped after the ReLU
   level 2  level 1, plus the query is rounded to Int8 once per head so the attention scores are
            integer sums, the softmax reads its exponentials from a 513-entry table (2 KB) instead of
            calling Math.exp, and positions whose weight is under 1/2000 of the total are skipped

   What was measured (tests/bench_evelyn.js, the real TINY.BIN shape, random weights):
     current V8 with its JIT     level 1: 0.82 times the speed of the exact engine (slower), level 2: 0.84
     the same with --jitless     level 1: 1.42 times the speed (faster), level 2: 1.42
   A JIT turns the float loop into native code and the integer version gains nothing; an engine that
   only interprets (the closest thing to an old browser that can be run here) saves the float work.
   Level 2 added nothing measurable over level 1 in either mode on this shape; the attention is a
   small part of the work at 128 positions. Use level 1 unless a measurement on the target machine
   says otherwise. Nothing here was run on a real old machine.

   An Int32 sum cannot overflow for any file the loader accepts: the longest column count is 2048,
   2048 * 127 * 127 is about 33 million, and an Int32 holds 2.1 billion.

   How far the answers move is measured, not assumed: compare(exact, potato, prompts) feeds both
   engines the same letters and reports the cosine of the scores, the largest score error and how
   often the best letter is the same. Run it on the real TINY.BIN before trusting it; the
   tests in js/test use random weights, whose scores are nearly flat, so they under-state
   agreement for a trained file and cannot say what a trained file does.

   Plain ES5: no Math.imul, no typed array fill, no other ES2015 call. Usage:
     var P = require("./evelyn_potato.js");   // or the global EvelynPotato
     P.install(model, 2);                      // model: an Evelyn.Tiny2Model that is loaded
     P.installStream(streamModel);             // level 1 for EvelynStream.Tiny2StreamModel
     P.uninstall(model);                       // back to the reference engine */
(function (root) {
  "use strict";

  var EXP_STEPS = 512, EXP_SCALE = 32.0;          /* e^x for x in [-16, 0], 32 steps to the unit */
  var EXP_LUT = new Float32Array(EXP_STEPS + 1);
  for (var ei = 0; ei <= EXP_STEPS; ei++) EXP_LUT[ei] = Math.exp(-ei / EXP_SCALE);

  /* e^diff for diff <= 0 by table and a straight line between two entries; zero below -16 */
  function expNeg(diff) {
    if (diff <= -16.0) return 0.0;
    if (diff >= 0.0) return 1.0;
    var u = -diff * EXP_SCALE, idx = u | 0, frac = u - idx;
    return EXP_LUT[idx] + frac * (EXP_LUT[idx + 1] - EXP_LUT[idx]);
  }

  /* x[0..n) rounded to Int8 in dst; returns the scale (value = dst * scale), 0 when all are zero */
  function quantize(x, n, dst) {
    var big = 0.0, i, v;
    for (i = 0; i < n; i++) { v = x[i] < 0 ? -x[i] : x[i]; if (v > big) big = v; }
    if (big < 1e-20) return 0.0;
    var inv = 127.0 / big;
    for (i = 0; i < n; i++) { v = x[i] * inv; dst[i] = (v < 0 ? v - 0.5 : v + 0.5) | 0; }
    return big / 127.0;
  }

  /* y = (W * q) * rowScale * xScale with W an Int8 table (core layout: rows * cols contiguous) */
  function matvecQ(t, q, xScale, y) {
    var rows = t.rows, cols = t.cols, w = t.w, sc = t.scale, limit = cols - 3, r, c, base, acc;
    if (xScale === 0.0) { for (r = 0; r < rows; r++) y[r] = 0.0; return; }
    for (r = 0; r < rows; r++) {
      acc = 0; base = r * cols; c = 0;
      for (; c < limit; c += 4) {
        acc = (acc + w[base + c] * q[c] + w[base + c + 1] * q[c + 1] + w[base + c + 2] * q[c + 2] + w[base + c + 3] * q[c + 3]) | 0;
      }
      for (; c < cols; c++) acc = (acc + w[base + c] * q[c]) | 0;
      y[r] = acc * (xScale * sc[r]);
    }
  }

  /* the same for the stream layout: one Int8Array with a row every `stride` bytes, weights after 4 bytes of scale */
  function matvecQStrided(t, q, xScale, y) {
    var rows = t.rows, cols = t.cols, stride = t.stride, w = t.bytes, sc = t.scale, limit = cols - 3, r, c, base, acc;
    if (xScale === 0.0) { for (r = 0; r < rows; r++) y[r] = 0.0; return; }
    for (r = 0; r < rows; r++) {
      acc = 0; base = r * stride + 4; c = 0;
      for (; c < limit; c += 4) {
        acc = (acc + w[base + c] * q[c] + w[base + c + 1] * q[c + 1] + w[base + c + 2] * q[c + 2] + w[base + c + 3] * q[c + 3]) | 0;
      }
      for (; c < cols; c++) acc = (acc + w[base + c] * q[c]) | 0;
      y[r] = acc * (xScale * sc[r]);
    }
  }

  /* only the columns of q that are not zero (after a ReLU about half of them are) */
  function matvecQSparse(t, q, xScale, y, idx, val, stride) {
    var rows = t.rows, cols = t.cols, w = t.w, sc = t.scale, r, c, k = 0, base, acc;
    if (xScale === 0.0) { for (r = 0; r < rows; r++) y[r] = 0.0; return; }
    for (c = 0; c < cols; c++) if (q[c] !== 0) { idx[k] = c; val[k] = q[c]; k++; }
    var kLim = k - 3, rowStep = stride ? stride : cols, rowSkip = stride ? 4 : 0;
    w = stride ? t.bytes : w;
    for (r = 0; r < rows; r++) {
      acc = 0; base = r * rowStep + rowSkip; c = 0;
      for (; c < kLim; c += 4) {
        acc = (acc + w[base + idx[c]] * val[c] + w[base + idx[c + 1]] * val[c + 1] +
          w[base + idx[c + 2]] * val[c + 2] + w[base + idx[c + 3]] * val[c + 3]) | 0;
      }
      for (; c < k; c++) acc = (acc + w[base + idx[c]] * val[c]) | 0;
      y[r] = acc * (xScale * sc[r]);
    }
  }

  function install(model, level) {
    if (!model || !model.loaded) throw new Error("EvelynPotato.install: load a TNY2 model first");
    level = level === 1 ? 1 : 2;
    if (model._potato) uninstall(model);
    var maxDim = Math.max(model.D, model.HID);
    var s = model._potato = {
      level: level, qx: new Int8Array(maxDim), qm: new Int8Array(maxDim), qh: new Int8Array(model.HD),
      idx: new Int32Array(maxDim), val: new Int8Array(maxDim),
      saved: { _matvec: model._matvec, _matvecSparse: model._matvecSparse, step: model.step, own: {} }
    };
    var keys = ["_matvec", "_matvecSparse", "step"], i;
    for (i = 0; i < keys.length; i++) s.saved.own[keys[i]] = Object.prototype.hasOwnProperty.call(model, keys[i]);

    model._matvec = function (t, x, y) { matvecQ(t, s.qx, quantize(x, t.cols, s.qx), y); };
    model._matvecSparse = function (t, x, y) { matvecQSparse(t, s.qm, quantize(x, t.cols, s.qm), y, s.idx, s.val, 0); };

    if (level === 2) {
      model.step = function (tok, p) {
        if (tok < 0 || tok >= 97 || p < 0 || p >= 128) throw new Error("step out of range");
        var D = this.D, L = this.L, H = this.H, HD = this.HD, HID = this.HID, qx = s.qx, qh = s.qh;
        var i, j, l, h, xs;
        var eBase = tok * D, pBase = p * D, es = this.emb.scale[tok], ps = this.pos.scale[p];
        for (i = 0; i < D; i++) this.bx[i] = this.emb.w[eBase + i] * es + this.pos.w[pBase + i] * ps;
        var invAttDiv = 1.0 / this.attDiv;

        for (l = 0; l < L; l++) {
          this._norm(this.bx, this.g1[l], this.bh);
          xs = quantize(this.bh, D, qx);                  /* once for the key, value and query products */
          matvecQ(this.wk[l], qx, xs, this.bt);
          this.ks[l][p] = this._store(this.kc[l], p * D, this.bt);
          matvecQ(this.wv[l], qx, xs, this.bt);
          this.vs[l][p] = this._store(this.vc[l], p * D, this.bt);
          matvecQ(this.wq[l], qx, xs, this.bq);

          var kcl = this.kc[l], vcl = this.vc[l], ksl = this.ks[l], vsl = this.vs[l];
          for (h = 0; h < H; h++) {
            var hOff = h * HD, big = -1e30, qBig = 0.0, qv;
            for (i = 0; i < HD; i++) { qv = this.bq[hOff + i]; if (qv < 0) qv = -qv; if (qv > qBig) qBig = qv; }
            var qScale = qBig < 1e-20 ? 0.0 : (qBig / 127.0) * invAttDiv;
            if (qScale > 0.0) {
              var invQ = 127.0 / qBig;
              for (i = 0; i < HD; i++) { qv = this.bq[hOff + i] * invQ; qh[i] = (qv < 0 ? qv - 0.5 : qv + 0.5) | 0; }
            }
            for (j = 0; j <= p; j++) {
              var sc = 0.0;
              if (qScale > 0.0) {
                var kp = j * D + hOff, acc = 0;
                for (i = 0; i < HD; i++) acc = (acc + qh[i] * kcl[kp + i]) | 0;
                sc = acc * qScale * ksl[j];
              }
              this.bs[j] = sc;
              if (sc > big) big = sc;
            }
            var sum = 0.0, ex;
            for (j = 0; j <= p; j++) { ex = expNeg(this.bs[j] - big); this.bs[j] = ex; sum += ex; }
            var invSum = 1.0 / sum, floor = sum * 0.0005;
            for (i = 0; i < HD; i++) this.ba[hOff + i] = 0.0;
            for (j = 0; j <= p; j++) {
              if (this.bs[j] <= floor) continue;
              var vp = j * D + hOff, wgt = this.bs[j] * vsl[j] * invSum;
              for (i = 0; i < HD; i++) this.ba[hOff + i] += wgt * vcl[vp + i];
            }
          }
          xs = quantize(this.ba, D, qx);
          matvecQ(this.wo[l], qx, xs, this.bt);
          for (i = 0; i < D; i++) this.bx[i] += this.bt[i];

          this._norm(this.bx, this.g2[l], this.bh);
          xs = quantize(this.bh, D, qx);
          matvecQ(this.f1[l], qx, xs, this.bm);
          for (i = 0; i < HID; i++) if (this.bm[i] < 0) this.bm[i] = 0;
          this._matvecSparse(this.f2[l], this.bm, this.bt);
          for (i = 0; i < D; i++) this.bx[i] += this.bt[i];
        }
        this._norm(this.bx, this.gf, this.bh);
        xs = quantize(this.bh, D, qx);
        matvecQ(this.emb, qx, xs, this.score);
      };
    }
    return model;
  }

  function uninstall(model) {
    var s = model && model._potato;
    if (!s) return model;
    var names = ["_matvec", "_matvecSparse", "step"], i;
    for (i = 0; i < names.length; i++) {
      if (s.saved.own[names[i]]) model[names[i]] = s.saved[names[i]];
      else delete model[names[i]];
    }
    delete model._potato;
    return model;
  }

  /* level 1 for the layer-streaming model (its tables are one strided Int8Array each) */
  function installStream(model) {
    if (!model || !model.loaded) throw new Error("EvelynPotato.installStream: load a model first");
    if (model._potato) uninstallStream(model);
    var maxDim = Math.max(model.meta.D, model.meta.HID);
    var s = model._potato = { qx: new Int8Array(maxDim), qm: new Int8Array(maxDim), idx: new Int32Array(maxDim), val: new Int8Array(maxDim),
      saved: { _matvec: model._matvec, _matvecSparse: model._matvecSparse } };
    model._matvec = function (t, x, y) { matvecQStrided(t, s.qx, quantize(x, t.cols, s.qx), y); };
    model._matvecSparse = function (t, x, y) { matvecQSparse(t, s.qm, quantize(x, t.cols, s.qm), y, s.idx, s.val, t.stride); };
    return model;
  }
  function uninstallStream(model) {
    if (model && model._potato) { delete model._matvec; delete model._matvecSparse; delete model._potato; }
    return model;
  }

  /* Teacher-forced comparison of two loaded Tiny2Model objects (exact and potato): both are fed the
     same letters, so one wrong guess does not carry into the next. prompts: array of strings.
     Returns { steps, cosineMean, cosineMin, maxAbsErr, maxRelErr, top1Same, top1Share, textSame }. */
  function compare(exact, potato, prompts) {
    var steps = 0, cosSum = 0, cosMin = 1, maxAbs = 0, maxRel = 0, same = 0, textSame = 0, texts = 0, n, i, k, p;
    for (n = 0; n < prompts.length; n++) {
      var clean = String(prompts[n]).replace(/[^\x20-\x7E]/g, " ");
      for (p = 0; p < clean.length && p < 126; p++) {
        var tok = clean.charCodeAt(p) - 30;
        exact.step(tok, p); potato.step(tok, p);
        var dot = 0, na = 0, nb = 0, bestA = 0, bestB = 0, lo = 1e30, hi = -1e30;
        for (k = 0; k < 97; k++) {
          var a = exact.score[k], b = potato.score[k];
          dot += a * b; na += a * a; nb += b * b;
          if (a > exact.score[bestA]) bestA = k;
          if (b > potato.score[bestB]) bestB = k;
          if (a < lo) lo = a; if (a > hi) hi = a;
          var d = a > b ? a - b : b - a;
          if (d > maxAbs) maxAbs = d;
        }
        var range = hi - lo;
        for (k = 0; k < 97; k++) { var e = Math.abs(exact.score[k] - potato.score[k]) / (range > 1e-9 ? range : 1); if (e > maxRel) maxRel = e; }
        var cs = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-30);
        cosSum += cs; if (cs < cosMin) cosMin = cs;
        if (bestA === bestB) same++;
        steps++;
      }
      exact.reset(); potato.reset();
      var ta = exact.think(prompts[n], 0), tb = potato.think(prompts[n], 0);
      exact.reset(); potato.reset();
      texts++; if (ta === tb) textSame++;
    }
    return { steps: steps, cosineMean: cosSum / steps, cosineMin: cosMin, maxAbsErr: maxAbs, maxRelErr: maxRel,
      top1Same: same, top1Share: same / steps, textSame: textSame, texts: texts };
  }

  var EvelynPotato = {
    install: install, uninstall: uninstall, installStream: installStream, uninstallStream: uninstallStream,
    compare: compare, expNeg: expNeg, quantize: quantize, EXP_LUT: EXP_LUT
  };
  if (typeof module !== "undefined" && module.exports) module.exports = EvelynPotato;
  else root.EvelynPotato = EvelynPotato;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
