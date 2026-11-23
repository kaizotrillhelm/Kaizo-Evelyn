/* evelyn_code_engine.js - Modern Code-Model Primitives in Pure ES5:
   1. BPETokenizer    (Subword compression: 3-4x more code inside same token window)
   2. RoPE            (Rotary Positional Embeddings supporting 1,024..4,096+ contexts)
   3. FIM             (Fill-in-the-Middle <PRE>..<SUF>..<MID> code editing)
   4. PrefixKVCache   (Reuses cached KV prefix when editing lines below the cursor)
   5. SpeculativeCoder(Zero-cost Prompt-Lookup + AST symbol draft verification)
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. BYTE-LEVEL SUBWORD BPE TOKENIZER (BREAKS 1-CHAR-PER-TOKEN LIMIT)
     ========================================================================= */
  function BPETokenizer() {
    this.merges = []; // [ [a, b, newId], ... ]
    this.vocab = [];  // id -> string
    for (var i = 0; i < 256; i++) this.vocab.push(String.fromCharCode(i));
  }

  BPETokenizer.prototype.train = function (corpusText, maxMerges) {
    var lim = maxMerges || 64;
    var s = String(corpusText || "");
    var ids = [];
    var i;
    for (i = 0; i < s.length; i++) ids.push(s.charCodeAt(i) & 255);

    for (var m = 0; m < lim; m++) {
      var counts = Object.create(null), bestKey = null, bestCnt = 1;
      for (i = 0; i < ids.length - 1; i++) {
        var key = ids[i] + "," + ids[i + 1];
        var c = (counts[key] || 0) + 1;
        counts[key] = c;
        if (c > bestCnt) { bestCnt = c; bestKey = key; }
      }
      if (!bestKey || bestCnt < 2) break;
      var parts = bestKey.split(",");
      var a = parseInt(parts[0], 10), b = parseInt(parts[1], 10);
      var newId = this.vocab.length;
      this.vocab.push(this.vocab[a] + this.vocab[b]);
      this.merges.push([a, b, newId]);

      var nextIds = [];
      for (i = 0; i < ids.length; i++) {
        if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) {
          nextIds.push(newId); i++;
        } else {
          nextIds.push(ids[i]);
        }
      }
      ids = nextIds;
    }
    return { vocabSize: this.vocab.length, mergesLearned: this.merges.length };
  };

  BPETokenizer.prototype.encode = function (text) {
    var s = String(text || ""), ids = [], i, m;
    for (i = 0; i < s.length; i++) ids.push(s.charCodeAt(i) & 255);
    for (m = 0; m < this.merges.length; m++) {
      var a = this.merges[m][0], b = this.merges[m][1], nid = this.merges[m][2];
      var next = [];
      for (i = 0; i < ids.length; i++) {
        if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) { next.push(nid); i++; }
        else next.push(ids[i]);
      }
      ids = next;
    }
    return ids;
  };

  BPETokenizer.prototype.decode = function (ids) {
    var out = "";
    for (var i = 0; i < ids.length; i++) out += this.vocab[ids[i]] || "";
    return out;
  };

  /* =========================================================================
     2. ROTARY POSITIONAL EMBEDDINGS (RoPE) FOR LONG CODE CONTEXTS (1,024-4,096)
     ========================================================================= */
  function RoPE(headDim, maxCtx, baseTheta) {
    this.headDim = headDim || 24;
    this.maxCtx = maxCtx || 2048;
    var base = baseTheta || 10000.0;
    var half = (this.headDim / 2) | 0;
    this.cos = new Float32Array(this.maxCtx * half);
    this.sin = new Float32Array(this.maxCtx * half);
    for (var p = 0; p < this.maxCtx; p++) {
      for (var i = 0; i < half; i++) {
        var angle = p / Math.pow(base, (2 * i) / this.headDim);
        this.cos[p * half + i] = Math.cos(angle);
        this.sin[p * half + i] = Math.sin(angle);
      }
    }
  }

  RoPE.prototype.apply = function (vec, pos) {
    var half = (this.headDim / 2) | 0;
    var p = pos % this.maxCtx;
    var out = new Float32Array(this.headDim);
    for (var i = 0; i < half; i++) {
      var c = this.cos[p * half + i], s = this.sin[p * half + i];
      var x0 = vec[2 * i], x1 = vec[2 * i + 1];
      out[2 * i]     = x0 * c - x1 * s;
      out[2 * i + 1] = x0 * s + x1 * c;
    }
    return out;
  };

  /* =========================================================================
     3. FILL-IN-THE-MIDDLE (FIM) CODE FORMATTER & SPLICER
     ========================================================================= */
  var FIM = {
    PRE: "<PRE>", SUF: "<SUF>", MID: "<MID>",
    buildPrompt: function (fullCode, cursorOffset) {
      var off = Math.max(0, Math.min(fullCode.length, cursorOffset));
      var pre = fullCode.slice(0, off);
      var suf = fullCode.slice(off);
      return { prompt: this.PRE + pre + this.SUF + suf + this.MID, prefix: pre, suffix: suf };
    },
    spliceCompletion: function (fimObj, midText) {
      return fimObj.prefix + String(midText || "") + fimObj.suffix;
    }
  };

  /* =========================================================================
     4. INCREMENTAL PREFIX KV-CACHE REUSE (AVOIDS RE-PREFILLING UNCHANGED LINES)
     ========================================================================= */
  function PrefixKVCache() {
    this.cachedTokens = [];
    this.cachedK = [];
    this.cachedV = [];
  }

  PrefixKVCache.prototype.update = function (newTokens, computeStepFn) {
    var common = 0;
    var minL = Math.min(this.cachedTokens.length, newTokens.length);
    while (common < minL && this.cachedTokens[common] === newTokens[common]) common++;

    /* Truncate stale tail after edit point, keep valid prefix 0..common-1 */
    this.cachedTokens.length = common;
    this.cachedK.length = common;
    this.cachedV.length = common;

    var computedNow = 0;
    for (var p = common; p < newTokens.length; p++) {
      var kv = computeStepFn(newTokens[p], p);
      this.cachedTokens.push(newTokens[p]);
      this.cachedK.push(kv.k);
      this.cachedV.push(kv.v);
      computedNow++;
    }
    return { reusedTokens: common, computedTokens: computedNow, totalTokens: newTokens.length };
  };

  /* =========================================================================
     5. PROMPT-LOOKUP + AST SYMBOL SPECULATIVE DRAFTER (ZERO EXTRA WEIGHTS)
     ========================================================================= */
  var SpeculativeCoder = {
    /* Draft up to maxDraft chars straight from matching suffix in prompt or AST symbols */
    draftFromContext: function (codeSoFar, symbolList, maxDraft) {
      var cap = maxDraft || 16;
      /* 1. Try AST symbol completion on active identifier tail */
      var idMatch = codeSoFar.match(/([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (idMatch && symbolList && symbolList.length) {
        var partial = idMatch[1];
        for (var s = 0; s < symbolList.length; s++) {
          var sym = symbolList[s];
          if (sym.length > partial.length && sym.indexOf(partial) === 0) {
            return { source: "ast_symbol", draft: sym.slice(partial.length, partial.length + cap) };
          }
        }
      }
      /* 2. Try Prompt-Lookup n-gram copy from earlier in the same file */
      for (var n = 8; n >= 3; n--) {
        if (codeSoFar.length < n + 2) continue;
        var needle = codeSoFar.slice(codeSoFar.length - n);
        var idx = codeSoFar.lastIndexOf(needle, codeSoFar.length - n - 1);
        if (idx >= 0) {
          var cand = codeSoFar.slice(idx + n, idx + n + cap);
          if (cand.length > 0) return { source: "prompt_lookup", draft: cand };
        }
      }
      return { source: "none", draft: "" };
    },

    /* Verify drafted chars against model target function in 1 simulated batch pass */
    verifyDraft: function (draft, targetVerifyFn) {
      var accepted = "";
      for (var i = 0; i < draft.length; i++) {
        var ch = draft.charAt(i);
        if (targetVerifyFn(i, ch)) accepted += ch;
        else break;
      }
      return { drafted: draft.length, accepted: accepted.length, text: accepted };
    }
  };

  root.EvelynCodeEngine = {
    BPETokenizer: BPETokenizer,
    RoPE: RoPE,
    FIM: FIM,
    PrefixKVCache: PrefixKVCache,
    SpeculativeCoder: SpeculativeCoder
  };
})(typeof window !== "undefined" ? window : global);
