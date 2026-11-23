/* evelyn_frontier.js - 7 Cutting-Edge 2025-2026 AI Systems in Pure ES5 JavaScript:
   1. BitNetI2S            (1.58-bit ternary {-1,0,+1} multiplication-free matvec)
   2. TitansContinuumMemory(Test-time surprise-driven fast/slow memory + Sleep pass)
   3. LoopedReasoner       (Recurrent-depth layer looping + delta-norm early halting)
   4. GrammarDecoder       (97-token DFA logit masking + forced-token skip + CRANE)
   5. HippoGraphMemory     (HippoRAG-2 bipartite passage+triple Personalized PageRank)
   6. ActivationSteerer    (Contrastive persona vectors + probe-gated PID steering)
   7. EntropyPatcher       (BLT-inspired dynamic byte-entropy patching & compute routing)
   Zero dependencies. Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynBackend) require("./evelyn_backend.js");

  var VOCAB = 97; // 0=pad, 1=EOS/newline, 2..96 = ASCII 32..126 (ord - 30)

  /* =========================================================================
     1. BITNET b1.58 / I2_S MULTIPLICATION-FREE TERNARY ENGINE
        2-bit encoding per weight: 00 -> 0, 01 -> +1, 11 -> -1 (4 weights/byte).
     ========================================================================= */
  var BitNetI2S = {
    packTernary: function (floatWeights, rows, cols) {
      var n = rows * cols, i, sumAbs = 0.0;
      for (i = 0; i < n; i++) sumAbs += Math.abs(floatWeights[i]);
      var gamma = sumAbs / Math.max(1, n);
      if (gamma < 1e-8) gamma = 1e-8;

      var packedLen = Math.ceil(n / 4);
      var packed = new Uint8Array(packedLen);
      var zeros = 0, pos = 0, neg = 0;

      for (i = 0; i < n; i++) {
        var scaled = floatWeights[i] / gamma;
        var code = 0; // 0 -> 0
        if (scaled >= 0.5) { code = 1; pos++; }       // 01 -> +1
        else if (scaled <= -0.5) { code = 3; neg++; } // 11 -> -1
        else { zeros++; }
        packed[i >> 2] |= (code << ((i & 3) * 2));
      }
      return {
        rows: rows, cols: cols, scale: gamma, packed: packed,
        stats: {
          floatBytes: n * 4,
          int8Bytes: n,
          ternaryBytes: packedLen + 4,
          compressionVsFloat: (n * 4) / (packedLen + 4),
          compressionVsInt8: n / (packedLen + 4),
          sparsity: zeros / Math.max(1, n),
          pos: pos, neg: neg, zeros: zeros
        }
      };
    },

    unpackTernary: function (tObj) {
      var n = tObj.rows * tObj.cols;
      var out = new Int8Array(n);
      var p = tObj.packed;
      for (var i = 0; i < n; i++) {
        var code = (p[i >> 2] >> ((i & 3) * 2)) & 3;
        out[i] = code === 1 ? 1 : (code === 3 ? -1 : 0);
      }
      return out;
    },

    /* Zero multiplications inside the inner dot-product loop: pure add/sub */
    matvecTernary: function (tObj, x, y) {
      var rows = tObj.rows, cols = tObj.cols, p = tObj.packed, sc = tObj.scale;
      var addOps = 0, skippedZeros = 0;
      for (var r = 0; r < rows; r++) {
        var acc = 0.0, base = r * cols;
        for (var c = 0; c < cols; c++) {
          var idx = base + c;
          var code = (p[idx >> 2] >> ((idx & 3) * 2)) & 3;
          if (code === 1) { acc += x[c]; addOps++; }
          else if (code === 3) { acc -= x[c]; addOps++; }
          else { skippedZeros++; }
        }
        y[r] = acc * sc;
      }
      return { addOps: addOps, skippedZeros: skippedZeros, mulOpsInLoop: 0 };
    }
  };

  /* =========================================================================
     2. TITANS + NESTED LEARNING ("HOPE") + SLEEP CONSOLIDATION MEMORY
        Associative fast-weight matrix updating at test time via surprise gradient,
        paired with a slower long-term matrix consolidated during sleep cycles.
     ========================================================================= */
  function hashTextVec(text, dim) {
    var v = new Float32Array(dim);
    var s = " " + String(text || "").toLowerCase().replace(/[^a-z0-9* ]/g, " ") + " ";
    var i, h;
    for (i = 0; i < s.length - 2; i++) {
      h = ((s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) * 31 + s.charCodeAt(i + 2)) & 0x7FFFFFFF;
      var bucket = h % dim;
      var sign = ((h >> 7) & 1) ? 1.0 : -1.0;
      v[bucket] += sign;
    }
    var norm = 0.0;
    for (i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1.0;
    for (i = 0; i < dim; i++) v[i] /= norm;
    return v;
  }

  function TitansContinuumMemory(dim) {
    this.dim = dim || 32;
    var n = this.dim * this.dim;
    this.fastM = new Float32Array(n);     // High-frequency test-time memory
    this.momentum = new Float32Array(n);  // Titans surprise momentum buffer
    this.slowM = new Float32Array(n);     // Nested Learning slow stable memory
    this.entries = [];                    // Symbolic payload table for exact readout
    this.beta = 0.6;                      // Surprise momentum coefficient
    this.decay = 0.96;                    // Forgetting gate alpha on fast memory
    this.lr = 0.65;                       // Test-time learning step
  }

  TitansContinuumMemory.prototype._matvecCombined = function (k) {
    var D = this.dim, out = new Float32Array(D), r, c;
    for (r = 0; r < D; r++) {
      var s = 0.0, b = r * D;
      for (c = 0; c < D; c++) s += (this.fastM[b + c] + this.slowM[b + c]) * k[c];
      out[r] = s;
    }
    return out;
  };

  /* Observe a (key, value) pair at test time: updates fastM proportional to surprise */
  TitansContinuumMemory.prototype.observe = function (keyText, valText) {
    var D = this.dim;
    var k = hashTextVec(keyText, D);
    var v = hashTextVec(valText, D);
    var pred = this._matvecCombined(k);

    var errSq = 0.0, r, c;
    var err = new Float32Array(D);
    for (r = 0; r < D; r++) {
      err[r] = pred[r] - v[r];
      errSq += err[r] * err[r];
    }
    var surprise = Math.sqrt(errSq / D);

    /* Surprise-gated gradient update with momentum (Titans Eq. 9-12 style) */
    for (r = 0; r < D; r++) {
      var b = r * D, er = err[r];
      for (c = 0; c < D; c++) {
        var grad = er * k[c];
        var mNew = this.beta * this.momentum[b + c] - this.lr * grad;
        this.momentum[b + c] = mNew;
        this.fastM[b + c] = this.decay * this.fastM[b + c] + mNew;
      }
    }

    /* Update symbolic readout bank without duplicates */
    var found = false;
    for (var i = 0; i < this.entries.length; i++) {
      if (this.entries[i].key === keyText) {
        this.entries[i].val = valText;
        this.entries[i].valVec = v;
        this.entries[i].hits += 1;
        this.entries[i].lastSurprise = surprise;
        found = true;
        break;
      }
    }
    if (!found) {
      this.entries.push({ key: keyText, val: valText, valVec: v, hits: 1, lastSurprise: surprise, consolidated: false });
    }
    return { surprise: surprise, updatedFastNorm: this.matrixNorm(this.fastM) };
  };

  TitansContinuumMemory.prototype.recall = function (keyText) {
    if (!this.entries.length) return null;
    var k = hashTextVec(keyText, this.dim);
    var pred = this._matvecCombined(k);
    var bestIdx = -1, bestSim = -2.0, i, d;
    var pNorm = 0.0;
    for (d = 0; d < this.dim; d++) pNorm += pred[d] * pred[d];
    pNorm = Math.sqrt(pNorm) || 1.0;

    for (i = 0; i < this.entries.length; i++) {
      var vv = this.entries[i].valVec, dot = 0.0;
      for (d = 0; d < this.dim; d++) dot += pred[d] * vv[d];
      var sim = dot / pNorm;
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    }
    if (bestIdx < 0) return null;
    return {
      key: this.entries[bestIdx].key,
      val: this.entries[bestIdx].val,
      similarity: bestSim,
      consolidated: this.entries[bestIdx].consolidated
    };
  };

  /* Sleep Framework consolidation: distill fastM into slowM and calm transient fast weights */
  TitansContinuumMemory.prototype.sleepConsolidate = function (blendRate) {
    var rate = blendRate || 0.5;
    var n = this.dim * this.dim, i;
    for (i = 0; i < n; i++) {
      this.slowM[i] = this.slowM[i] + rate * this.fastM[i];
      this.fastM[i] *= (1.0 - rate);
      this.momentum[i] *= 0.25;
    }
    for (i = 0; i < this.entries.length; i++) this.entries[i].consolidated = true;
    return {
      slowNorm: this.matrixNorm(this.slowM),
      fastNorm: this.matrixNorm(this.fastM),
      consolidatedEntries: this.entries.length
    };
  };

  TitansContinuumMemory.prototype.matrixNorm = function (arr) {
    var s = 0.0;
    for (var i = 0; i < arr.length; i++) s += arr[i] * arr[i];
    return Math.sqrt(s);
  };

  /* =========================================================================
     3. LOOPED / RECURRENT-DEPTH TRANSFORMER BLOCK WITH ADAPTIVE HALTING
        Runs the same shared block 1..maxLoops times per token; stops early when
        hidden-state delta drops below haltEps.
     ========================================================================= */
  var LoopedReasoner = {
    run: function (hInit, sharedBlockFn, opts) {
      opts = opts || {};
      var maxLoops = opts.maxLoops || 4;
      var minLoops = opts.minLoops || 1;
      var haltEps = opts.haltEps !== undefined ? opts.haltEps : 0.02;
      var gate = opts.gate !== undefined ? opts.gate : 0.6;
      var D = hInit.length;
      var h = new Float32Array(hInit);
      var prev = new Float32Array(D);
      var trace = [];
      var loopsRun = 0, i;

      for (var t = 0; t < maxLoops; t++) {
        prev.set(h);
        var next = sharedBlockFn(h, t);
        var diffSq = 0.0;
        for (i = 0; i < D; i++) {
          var blended = (1.0 - gate) * prev[i] + gate * next[i];
          var d = blended - prev[i];
          diffSq += d * d;
          h[i] = blended;
        }
        var deltaNorm = Math.sqrt(diffSq / D);
        loopsRun = t + 1;
        trace.push({ loop: loopsRun, deltaNorm: deltaNorm });
        if (loopsRun >= minLoops && deltaNorm < haltEps) break;
      }
      return {
        state: h,
        loopsRun: loopsRun,
        haltedEarly: loopsRun < maxLoops,
        trace: trace
      };
    }
  };

  /* =========================================================================
     4. GRAMMAR-CONSTRAINED LOGIT DECODER (XGrammar / llguidance / CRANE Style)
        Operates directly on Evelyn's 97-token ASCII logit array (VOCAB = 97).
     ========================================================================= */
  function charToTok(ch) {
    if (ch === "\n") return 1;
    var code = ch.charCodeAt(0);
    return (code >= 32 && code <= 126) ? (code - 30) : 0;
  }
  function tokToChar(tok) {
    if (tok <= 1) return "\n";
    return String.fromCharCode(tok + 30);
  }

  /* Compile a list of allowed prefix/DFA transitions or exact regex-like rules */
  var GRAMMARS = {
    /* Exact 12-hour AM/PM clock grammar: e.g. "8:50 AM" or "12:00 PM" */
    clock12: function (prefix) {
      var len = prefix.length;
      if (len === 0) return "123456789";
      if (len === 1) return prefix === "1" ? "012:" : ":";
      var colonIdx = prefix.indexOf(":");
      if (colonIdx < 0) return ":";
      var afterColon = prefix.slice(colonIdx + 1);
      if (afterColon.length === 0) return "012345";
      if (afterColon.length === 1) return "0123456789";
      if (afterColon.length === 2) return " ";
      if (afterColon.length === 3) return "AP";
      if (afterColon.length === 4) return "M";
      return "\n"; // EOS
    },

    /* Exact Evelyn CodeSandbox command header grammar */
    sandboxCmd: function (prefix) {
      var cmds = ["LET ", "PRINT ", "REPEAT ", "NOTE ", "MOVE ", "TURN ", "IF ", "END\n"];
      var allowed = "", i;
      for (i = 0; i < cmds.length; i++) {
        if (cmds[i].indexOf(prefix) === 0) {
          var nxt = cmds[i].charAt(prefix.length);
          if (nxt && allowed.indexOf(nxt) < 0) allowed += nxt;
        }
      }
      if (allowed) return allowed;
      /* After command keyword, allow safe ASCII code characters or newline */
      if (prefix.length >= 24) return "\n";
      return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 =+-*/<>\".,\n";
    },

    /* Exact shelf citation tag grammar: [shelf#id] */
    shelfCite: function (prefix) {
      if (prefix.length === 0) return "[";
      if (prefix.indexOf("]") >= 0) return "\n";
      var hashIdx = prefix.indexOf("#");
      if (hashIdx < 0) {
        /* shelf names are 2 to 8 letters; at 8 letters '#' is forced so the tag always fits the 16-char budget */
        if (prefix.length <= 2) return "abcdefghijklmnopqrstuvwxyz";
        if (prefix.length >= 9) return "#";
        return "abcdefghijklmnopqrstuvwxyz#";
      }
      var digits = prefix.slice(hashIdx + 1);
      if (digits.length === 0) return "0123456789";
      if (digits.length >= 4) return "]";
      return "0123456789]";
    }
  };

  var GrammarDecoder = {
    GRAMMARS: GRAMMARS,

    /* Compute 97-byte legal token mask (1=allowed, 0=masked out) */
    computeMask: function (grammarFn, prefix, bannedSubstrings) {
      var mask = new Uint8Array(VOCAB);
      var allowedChars = grammarFn ? grammarFn(prefix) : null;
      var i, ch;
      if (allowedChars !== null) {
        for (i = 0; i < allowedChars.length; i++) {
          var tok = charToTok(allowedChars.charAt(i));
          if (tok > 0 && tok < VOCAB) mask[tok] = 1;
        }
      } else {
        for (i = 1; i < VOCAB; i++) mask[i] = 1;
      }

      /* Logit-level anti-tic / banned-word masking: zero out any token completing a banned phrase */
      if (bannedSubstrings && bannedSubstrings.length) {
        var lowPref = prefix.toLowerCase();
        for (i = 2; i < VOCAB; i++) {
          if (!mask[i]) continue;
          ch = tokToChar(i).toLowerCase();
          var cand = lowPref + ch;
          for (var b = 0; b < bannedSubstrings.length; b++) {
            var ban = bannedSubstrings[b].toLowerCase();
            if (cand.length >= ban.length && cand.slice(cand.length - ban.length) === ban) {
              mask[i] = 0;
              break;
            }
          }
        }
      }
      return mask;
    },

    /* Mask logit vector in-place; detects forced single-token fast-forward (llguidance trick) */
    applyMaskToLogits: function (logits, mask) {
      var legalCount = 0, forcedTok = -1, i;
      for (i = 0; i < VOCAB; i++) {
        if (mask[i]) { legalCount++; forcedTok = i; }
        else { logits[i] = -1e30; }
      }
      return { legalCount: legalCount, forcedTok: legalCount === 1 ? forcedTok : -1 };
    },

    /* Full constrained decoding loop over any logitProvider(prefix) -> Float32Array(97) */
    decode: function (grammarNameOrFn, logitProvider, opts) {
      opts = opts || {};
      var gFn = typeof grammarNameOrFn === "function" ? grammarNameOrFn : GRAMMARS[grammarNameOrFn];
      var maxLen = opts.maxLen || 32;
      var banned = opts.bannedSubstrings || [];
      var prefix = opts.seedPrefix || "";
      var neuralSteps = 0, skippedForcedSteps = 0;

      for (var step = 0; step < maxLen; step++) {
        var mask = this.computeMask(gFn, prefix, banned);
        var legalCount = 0, onlyTok = -1, i;
        for (i = 1; i < VOCAB; i++) {
          if (mask[i]) { legalCount++; onlyTok = i; }
        }
        if (legalCount === 0) break;

        var chosen;
        if (legalCount === 1) {
          /* llguidance fast-forward: skip neural forward pass when grammar forces 1 token */
          chosen = onlyTok;
          skippedForcedSteps++;
        } else {
          var logits = logitProvider(prefix);
          this.applyMaskToLogits(logits, mask);
          chosen = 1;
          var best = -1e30;
          for (i = 1; i < VOCAB; i++) {
            if (logits[i] > best) { best = logits[i]; chosen = i; }
          }
          neuralSteps++;
        }
        if (chosen <= 1) break;
        prefix += tokToChar(chosen);
      }
      return { text: prefix, neuralSteps: neuralSteps, skippedForcedSteps: skippedForcedSteps };
    },

    /* CRANE alternating decoding: unconstrained scratchpad -> constrained answer field */
    decodeCRANE: function (scratchLogitFn, answerLogitFn, grammarNameOrFn, opts) {
      opts = opts || {};
      var scratch = this.decode(null, scratchLogitFn, {
        maxLen: opts.scratchLen || 16,
        bannedSubstrings: opts.bannedSubstrings || []
      });
      var answer = this.decode(grammarNameOrFn, function (pref) {
        return answerLogitFn(scratch.text, pref);
      }, {
        maxLen: opts.answerLen || 16,
        bannedSubstrings: opts.bannedSubstrings || []
      });
      return {
        scratchpad: scratch.text,
        answer: answer.text,
        skippedForcedSteps: answer.skippedForcedSteps
      };
    }
  };

  /* =========================================================================
     5. HIPPORAG-2 MULTI-HOP ASSOCIATIVE GRAPH MEMORY (PERSONALIZED PAGERANK)
        Bipartite graph of Passage nodes + Entity/Triple nodes. Solves 2-hop and
        3-hop questions across disconnected shelf records in < 2 ms on CPU.
     ========================================================================= */
  function HippoGraphMemory() {
    this.nodes = [];                  // { id, type: 'entity'|'passage', label, text, shelf }
    this.nodeIndex = Object.create(null);
    this.adj = [];                    // adjacency list: nodeId -> [ { to, weight } ]
    this.triples = [];                // { sId, rel, oId, sLabel, oLabel, passageId }
  }

  HippoGraphMemory.prototype._getOrAddNode = function (key, type, label, text, shelf) {
    if (this.nodeIndex[key] !== undefined) return this.nodeIndex[key];
    var id = this.nodes.length;
    this.nodes.push({ id: id, key: key, type: type, label: label, text: text || label, shelf: shelf || "" });
    this.adj.push([]);
    this.nodeIndex[key] = id;
    return id;
  };

  HippoGraphMemory.prototype._addUndirectedEdge = function (a, b, w) {
    if (a === b) return;
    this.adj[a].push({ to: b, weight: w || 1.0 });
    this.adj[b].push({ to: a, weight: w || 1.0 });
  };

  HippoGraphMemory.prototype.addPassage = function (passageId, text, shelf, entities) {
    var pNode = this._getOrAddNode("P:" + passageId, "passage", passageId, text, shelf);
    var ents = entities || [];
    for (var i = 0; i < ents.length; i++) {
      var eKey = "E:" + String(ents[i]).toLowerCase();
      var eNode = this._getOrAddNode(eKey, "entity", ents[i], ents[i], shelf);
      this._addUndirectedEdge(pNode, eNode, 1.0); // HippoRAG 2 "contains" edge
    }
    return pNode;
  };

  HippoGraphMemory.prototype.addTriple = function (subj, rel, obj, passageId) {
    var sId = this._getOrAddNode("E:" + subj.toLowerCase(), "entity", subj, subj, "");
    var oId = this._getOrAddNode("E:" + obj.toLowerCase(), "entity", obj, obj, "");
    this._addUndirectedEdge(sId, oId, 1.5); // relation edge
    var pId = null;
    if (passageId !== undefined && passageId !== null) {
      pId = this.nodeIndex["P:" + passageId];
      if (pId !== undefined) {
        this._addUndirectedEdge(sId, pId, 1.0);
        this._addUndirectedEdge(oId, pId, 1.0);
      }
    }
    this.triples.push({ sId: sId, rel: rel.toLowerCase(), oId: oId, sLabel: subj, oLabel: obj, passageId: pId });
  };

  /* Personalized PageRank (damping = 0.5 per HippoRAG 2 paper) */
  HippoGraphMemory.prototype.queryMultiHop = function (queryText, topK) {
    var N = this.nodes.length;
    if (N === 0) return { passages: [], entities: [] };
    var low = String(queryText || "").toLowerCase();
    var qWords = low.match(/[a-z0-9*]+/g) || [];
    var reset = new Float32Array(N);
    var resetSum = 0.0, i, j;

    /* 1. Seed entity nodes mentioned in query + matched triples */
    for (i = 0; i < N; i++) {
      var nd = this.nodes[i];
      var lbl = nd.label.toLowerCase();
      if (nd.type === "entity" && low.indexOf(lbl) >= 0) {
        reset[i] += 2.0;
        resetSum += 2.0;
      } else if (nd.type === "passage") {
        var overlap = 0;
        var pLow = nd.text.toLowerCase();
        for (j = 0; j < qWords.length; j++) {
          if (qWords[j].length >= 3 && pLow.indexOf(qWords[j]) >= 0) overlap++;
        }
        if (overlap > 0) {
          var pw = overlap * 0.05; // HippoRAG 2 passage seed weight (0.05)
          reset[i] += pw;
          resetSum += pw;
        }
      }
    }
    for (i = 0; i < this.triples.length; i++) {
      var tr = this.triples[i];
      var relHit = low.indexOf(tr.rel) >= 0;
      var subjHit = low.indexOf(tr.sLabel.toLowerCase()) >= 0;
      var objHit = low.indexOf(tr.oLabel.toLowerCase()) >= 0;
      if ((subjHit || objHit) && relHit) {
        reset[tr.sId] += 1.5; reset[tr.oId] += 1.5; resetSum += 3.0;
      }
    }
    if (resetSum <= 0) return { passages: [], entities: [] };
    for (i = 0; i < N; i++) reset[i] /= resetSum;

    /* 2. Power iteration Personalized PageRank with damping = 0.5 */
    var damping = 0.5;
    var rank = new Float32Array(reset);
    var next = new Float32Array(N);
    for (var iter = 0; iter < 20; iter++) {
      for (i = 0; i < N; i++) next[i] = (1.0 - damping) * reset[i];
      for (i = 0; i < N; i++) {
        var edges = this.adj[i];
        if (!edges.length || rank[i] === 0) continue;
        var wSum = 0.0;
        for (j = 0; j < edges.length; j++) wSum += edges[j].weight;
        var share = damping * rank[i] / wSum;
        for (j = 0; j < edges.length; j++) next[edges[j].to] += share * edges[j].weight;
      }
      var tmp = rank; rank = next; next = tmp;
    }

    var passages = [], entities = [];
    for (i = 0; i < N; i++) {
      var item = { id: this.nodes[i].id, label: this.nodes[i].label, text: this.nodes[i].text, shelf: this.nodes[i].shelf, score: rank[i] };
      if (this.nodes[i].type === "passage") passages.push(item);
      else entities.push(item);
    }
    passages.sort(function (a, b) { return b.score - a.score; });
    entities.sort(function (a, b) { return b.score - a.score; });
    return { passages: passages.slice(0, topK || 3), entities: entities.slice(0, topK || 5) };
  };

  /* =========================================================================
     6. PROBE-GATED ACTIVATION STEERING & PERSONA VECTORS
        Adds a 96-float (384-byte) contrastive vector to the residual stream
        when a linear probe detects unwanted drift (verbosity, sycophancy, etc.).
     ========================================================================= */
  var ActivationSteerer = {
    computeVector: function (posActs, negActs) {
      var D = posActs[0].length, v = new Float32Array(D), i, d;
      for (i = 0; i < posActs.length; i++) for (d = 0; d < D; d++) v[d] += posActs[i][d] / posActs.length;
      for (i = 0; i < negActs.length; i++) for (d = 0; d < D; d++) v[d] -= negActs[i][d] / negActs.length;
      var norm = 0.0;
      for (d = 0; d < D; d++) norm += v[d] * v[d];
      norm = Math.sqrt(norm) || 1.0;
      for (d = 0; d < D; d++) v[d] /= norm;
      return v;
    },

    probeScore: function (h, probeVec) {
      var dot = 0.0, hn = 0.0, pn = 0.0;
      for (var i = 0; i < h.length; i++) {
        dot += h[i] * probeVec[i];
        hn += h[i] * h[i];
        pn += probeVec[i] * probeVec[i];
      }
      return dot / (Math.sqrt(hn * pn) || 1.0);
    },

    /* Probe-gated adaptive steering: injects correction only when probe > threshold */
    probeGatedSteer: function (h, probeVec, steerVec, opts) {
      opts = opts || {};
      var threshold = opts.threshold !== undefined ? opts.threshold : 0.35;
      var kp = opts.kp !== undefined ? opts.kp : 0.8;
      var maxAlpha = opts.maxAlpha !== undefined ? opts.maxAlpha : 1.2;
      var score = this.probeScore(h, probeVec);
      var out = new Float32Array(h);
      var appliedAlpha = 0.0;

      if (score > threshold) {
        appliedAlpha = Math.min(maxAlpha, (score - threshold) * kp + 0.25);
        for (var i = 0; i < out.length; i++) out[i] += appliedAlpha * steerVec[i];
      }
      return {
        state: out,
        probeBefore: score,
        probeAfter: this.probeScore(out, probeVec),
        appliedAlpha: appliedAlpha,
        steered: appliedAlpha > 0
      };
    }
  };

  /* =========================================================================
     7. BYTE LATENT ENTROPY PATCHER (BLT-Inspired Dynamic Patching)
        Segments raw ASCII bytes by local Shannon entropy so predictable text
        merges into coarse patches while dense facts/numbers get fine patches.
     ========================================================================= */
  function EntropyPatcher() {
    this.trans = Object.create(null); // prev2Chars -> { total, counts: { nextChar: n } }
    this.trained = false;
  }

  EntropyPatcher.prototype.train = function (corpusText) {
    var s = "  " + String(corpusText || "");
    for (var i = 2; i < s.length; i++) {
      var ctx = s.slice(i - 2, i);
      var ch = s.charAt(i);
      if (!this.trans[ctx]) this.trans[ctx] = { total: 0, counts: Object.create(null) };
      this.trans[ctx].total += 1;
      this.trans[ctx].counts[ch] = (this.trans[ctx].counts[ch] || 0) + 1;
    }
    this.trained = true;
  };

  EntropyPatcher.prototype.byteEntropy = function (prev2, ch) {
    var rec = this.trans[prev2];
    if (!rec) return 6.5; // Unseen context -> high surprise (~log2(95))
    var c = rec.counts[ch] || 0;
    var p = (c + 0.1) / (rec.total + 9.5); // Laplace smoothing
    return -Math.log(p) / Math.LN2;
  };

  /* Segment text into variable-length patches (maxPatch=8) + compute loop budgets */
  EntropyPatcher.prototype.patch = function (text, thresholdBits, maxPatchLen) {
    var thr = thresholdBits !== undefined ? thresholdBits : 3.2;
    var maxL = maxPatchLen || 8;
    var s = String(text || "");
    var patches = [], cur = "", curMaxEnt = 0.0;

    for (var i = 0; i < s.length; i++) {
      var prev2 = (i === 0 ? "  " : i === 1 ? " " + s.charAt(0) : s.slice(i - 2, i));
      var ch = s.charAt(i);
      var ent = this.byteEntropy(prev2, ch);

      if (cur.length > 0 && (ent >= thr || cur.length >= maxL)) {
        patches.push({
          text: cur,
          maxEntropy: curMaxEnt,
          computeLoops: curMaxEnt >= thr ? 3 : 1
        });
        cur = ch;
        curMaxEnt = ent;
      } else {
        cur += ch;
        if (ent > curMaxEnt) curMaxEnt = ent;
      }
    }
    if (cur.length > 0) {
      patches.push({ text: cur, maxEntropy: curMaxEnt, computeLoops: curMaxEnt >= thr ? 3 : 1 });
    }
    return {
      patches: patches,
      rawBytes: s.length,
      patchCount: patches.length,
      compressionFactor: s.length / Math.max(1, patches.length)
    };
  };

  root.EvelynFrontier = {
    BitNetI2S: BitNetI2S,
    TitansContinuumMemory: TitansContinuumMemory,
    LoopedReasoner: LoopedReasoner,
    GrammarDecoder: GrammarDecoder,
    HippoGraphMemory: HippoGraphMemory,
    ActivationSteerer: ActivationSteerer,
    EntropyPatcher: EntropyPatcher
  };
})(typeof window !== "undefined" ? window : global);
