/* evelyn_hybrid_rag.js - Hybrid Code & Doc RAG Engine for Weak Hardware:
   1. AST-Boundary Code Chunker + Compact Repo Map Generator
   2. Okapi BM25 Lexical Index (camelCase/snake_case aware, exact symbol matching)
   3. 128-Bit (16-Byte) Binary-Quantized Vector Index + Shift-Add 32-Bit Popcount
   4. Reciprocal Rank Fusion (RRF) + Incremental CRC32 File Cache
   5. Bounded 3-Step Edit -> Test -> Narrow-Error Repair Loop Controller
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynSentinel) require("./evelyn_sentinel.js");
  var Sent = root.EvelynSentinel;

  /* Split camelCase, snake_case, and keep exact identifiers for Code BM25 */
  function codeTokens(text) {
    var s = String(text || "");
    var raw = s.match(/[A-Za-z0-9_#*]+/g) || [];
    var out = [], i, j;
    for (i = 0; i < raw.length; i++) {
      var tok = raw[i];
      var low = tok.toLowerCase();
      if (low.length >= 2) out.push(low);
      /* Also split camelCase & snake_case parts so "calcTotalPrice" matches "total" and "price" */
      var split = tok.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().split(/\s+/);
      if (split.length > 1) {
        for (j = 0; j < split.length; j++) {
          if (split[j].length >= 2) out.push(split[j]);
        }
      }
    }
    return out;
  }

  /* =========================================================================
     1. AST-BOUNDARY CODE CHUNKER + COMPACT REPO MAP
     ========================================================================= */
  function chunkCodeByFunctions(src, fileName) {
    var lines = String(src || "").split(/\r?\n/);
    var chunks = [], signatures = [];
    var i = 0;

    while (i < lines.length) {
      var m = lines[i].match(/^\s*function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/);
      if (m) {
        var fnName = m[1], params = m[2].trim(), startLine = i + 1;
        var depth = 0, seenOpen = false, bodyLines = [];
        while (i < lines.length) {
          var ln = lines[i];
          bodyLines.push(ln);
          for (var c = 0; c < ln.length; c++) {
            if (ln.charAt(c) === "{") { depth++; seenOpen = true; }
            else if (ln.charAt(c) === "}") { depth--; }
          }
          i++;
          if (seenOpen && depth <= 0) break;
        }
        signatures.push(fnName + "(" + params + ")");
        chunks.push({
          id: fileName + ":" + fnName,
          file: fileName,
          symbol: fnName,
          signature: fnName + "(" + params + ")",
          startLine: startLine,
          text: bodyLines.join("\n")
        });
      } else {
        i++;
      }
    }
    /* Fallback for script files with no named function declarations */
    if (chunks.length === 0 && String(src || "").trim().length > 0) {
      chunks.push({
        id: fileName + ":module",
        file: fileName,
        symbol: "module",
        signature: fileName,
        startLine: 1,
        text: String(src).slice(0, 600)
      });
    }
    return {
      file: fileName,
      chunks: chunks,
      repoMapLine: fileName + ": " + (signatures.length ? signatures.join(", ") : "(script)")
    };
  }

  /* =========================================================================
     2. 128-BIT (16-BYTE) BINARY-QUANTIZED VECTOR INDEX + EXACT POPCOUNT32
     ========================================================================= */
  function popcount32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0F0F0F0F;
    x = x + (x >>> 8);
    x = x + (x >>> 16);
    return x & 0x3F;
  }

  /* Project char-trigrams + word stems into 128 signed accumulators -> pack to 4 x Uint32 (16 bytes!) */
  function embedBinary128(text) {
    var acc = new Int32Array(128);
    var s = " " + String(text || "").toLowerCase().replace(/[^a-z0-9_ ]/g, " ") + " ";
    var i, h, b, sign;
    /* Character trigrams give fuzzy / typo / subword similarity */
    for (i = 0; i < s.length - 2; i++) {
      h = ((s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) * 31 + s.charCodeAt(i + 2)) & 0x7FFFFFFF;
      for (var k = 0; k < 2; k++) {
        h = (h * 1103515245 + 12345) & 0x7FFFFFFF;
        b = h & 127;
        sign = ((h >>> 8) & 1) ? 1 : -1;
        acc[b] += sign;
      }
    }
    /* Word-level hashes weighted stronger */
    var toks = codeTokens(text);
    for (i = 0; i < toks.length; i++) {
      h = 2166136261;
      for (var c = 0; c < toks[i].length; c++) {
        h ^= toks[i].charCodeAt(c);
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
      }
      for (var p = 0; p < 3; p++) {
        h = (h * 1664525 + 1013904223) >>> 0;
        b = h & 127;
        sign = ((h >>> 16) & 1) ? 3 : -3;
        acc[b] += sign;
      }
    }
    var bits = new Uint32Array(4);
    for (i = 0; i < 128; i++) {
      if (acc[i] >= 0) bits[i >>> 5] |= (1 << (i & 31));
    }
    return bits; // Exactly 16 bytes!
  }

  function binarySimilarity(vecA, vecB) {
    var diff = popcount32(vecA[0] ^ vecB[0]) + popcount32(vecA[1] ^ vecB[1]) +
               popcount32(vecA[2] ^ vecB[2]) + popcount32(vecA[3] ^ vecB[3]);
    return 1.0 - (diff / 128.0);
  }

  /* =========================================================================
     3. HYBRID RAG STORE (OKAPI BM25 + 16-BYTE BINARY VECTORS + RRF + CRC32 CACHE)
     ========================================================================= */
  function HybridRAGStore() {
    this.docs = [];                       // { id, file, symbol, text, len, tf, binVec }
    this.df = Object.create(null);        // term -> doc count
    this.fileHashes = Object.create(null);// fileName -> crc32 (for incremental indexing!)
    this.repoMap = Object.create(null);   // fileName -> compact signature line
    this.totalLen = 0;
    this.stats = { indexedFiles: 0, skippedUnchanged: 0 };
  }

  HybridRAGStore.prototype._rebuildDF = function () {
    this.df = Object.create(null);
    this.totalLen = 0;
    for (var i = 0; i < this.docs.length; i++) {
      var d = this.docs[i];
      this.totalLen += d.len;
      for (var term in d.tf) this.df[term] = (this.df[term] || 0) + 1;
    }
  };

  HybridRAGStore.prototype.addChunk = function (id, file, symbol, text) {
    var toks = codeTokens(symbol + " " + text);
    var tf = Object.create(null);
    for (var i = 0; i < toks.length; i++) tf[toks[i]] = (tf[toks[i]] || 0) + 1;
    var rec = {
      id: id, file: file || "doc", symbol: symbol || id, text: String(text || ""),
      len: toks.length || 1, tf: tf, binVec: embedBinary128(symbol + " " + text)
    };
    this.docs.push(rec);
    this.totalLen += rec.len;
    for (var term in tf) this.df[term] = (this.df[term] || 0) + 1;
    return rec;
  };

  /* Incremental code file indexer: skips untouched files in 0 ms using CRC32 */
  HybridRAGStore.prototype.indexCodeFile = function (fileName, src) {
    var hash = Sent ? Sent.crc32(src) : src.length;
    if (this.fileHashes[fileName] === hash) {
      this.stats.skippedUnchanged++;
      return { reindexed: false, chunks: 0 };
    }
    /* Remove stale chunks from prior version of this file */
    var kept = [];
    for (var i = 0; i < this.docs.length; i++) {
      if (this.docs[i].file !== fileName) kept.push(this.docs[i]);
    }
    this.docs = kept;
    this._rebuildDF();

    var parsed = chunkCodeByFunctions(src, fileName);
    this.repoMap[fileName] = parsed.repoMapLine;
    for (var c = 0; c < parsed.chunks.length; c++) {
      var ch = parsed.chunks[c];
      this.addChunk(ch.id, ch.file, ch.signature, ch.text);
    }
    this.fileHashes[fileName] = hash;
    this.stats.indexedFiles++;
    return { reindexed: true, chunks: parsed.chunks.length, repoMapLine: parsed.repoMapLine };
  };

  HybridRAGStore.prototype.getRepoMap = function () {
    var lines = [];
    for (var f in this.repoMap) lines.push(this.repoMap[f]);
    lines.sort();
    return lines.join("\n");
  };

  /* Hybrid search: Okapi BM25 + 128-bit Binary Vectors merged by Reciprocal Rank Fusion */
  HybridRAGStore.prototype.searchHybrid = function (query, topK) {
    var N = this.docs.length;
    if (N === 0) return [];
    var k1 = 1.2, b = 0.75, avgLen = this.totalLen / N;
    var qToks = codeTokens(query);
    var qVec = embedBinary128(query);

    var bm25List = [], vecList = [], i, j;
    for (i = 0; i < N; i++) {
      var doc = this.docs[i], bm = 0.0;
      for (j = 0; j < qToks.length; j++) {
        var term = qToks[j];
        var tf = doc.tf[term] || 0;
        if (tf > 0) {
          var df = this.df[term] || 0;
          var idf = Math.log(1.0 + (N - df + 0.5) / (df + 0.5));
          bm += idf * ((tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * (doc.len / avgLen))));
        }
      }
      bm25List.push({ idx: i, score: bm });
      vecList.push({ idx: i, score: binarySimilarity(qVec, doc.binVec) });
    }

    bm25List.sort(function (x, y) { return y.score - x.score; });
    vecList.sort(function (x, y) { return y.score - x.score; });

    var rrf = new Float32Array(N);
    for (i = 0; i < N; i++) {
      if (bm25List[i].score > 0) rrf[bm25List[i].idx] += 1.0 / (60 + i + 1);
      rrf[vecList[i].idx] += 1.0 / (60 + i + 1);
    }

    var fused = [];
    for (i = 0; i < N; i++) {
      fused.push({
        id: this.docs[i].id,
        file: this.docs[i].file,
        symbol: this.docs[i].symbol,
        text: this.docs[i].text,
        rrfScore: rrf[i]
      });
    }
    fused.sort(function (x, y) { return y.rrfScore - x.rrfScore; });
    return fused.slice(0, topK || 3);
  };

  /* Assemble a budget-capped RAG prompt with Repo Map + Top Retrieved Chunks + Citations */
  HybridRAGStore.prototype.buildRAGPrompt = function (question, maxChars, topK) {
    var cap = maxChars || 600;
    var hits = this.searchHybrid(question, topK || 2);
    var map = this.getRepoMap();
    var parts = [];
    if (map) parts.push("[REPO MAP]\n" + map.slice(0, 140));
    var used = parts.join("\n").length;
    var citations = [];
    for (var i = 0; i < hits.length; i++) {
      var snippet = "[" + hits[i].id + "]\n" + hits[i].text;
      var remain = cap - used - question.length - 30;
      if (remain < 40) break;
      parts.push(snippet.slice(0, remain));
      used += Math.min(snippet.length, remain);
      citations.push(hits[i].id);
    }
    parts.push("[Q] " + question);
    return { prompt: parts.join("\n"), citations: citations, hits: hits };
  };

  /* =========================================================================
     4. BOUNDED 3-STEP TEST-DRIVEN REPAIR LOOP CONTROLLER
        Runs testFn(code) -> feeds ONLY the exact failure into proposeFixFn(code, err)
        -> hard stops at maxAttempts so tiny models never spin forever.
     ========================================================================= */
  var RepairLoopController = {
    run: function (initialCode, testFn, proposeFixFn, maxAttempts) {
      var lim = maxAttempts || 3;
      var code = String(initialCode || "");
      var history = [];

      for (var attempt = 1; attempt <= lim; attempt++) {
        var tRes = testFn(code);
        history.push({ attempt: attempt, passed: !!tRes.ok, error: tRes.error || "" });
        if (tRes.ok) {
          return { ok: true, attempts: attempt, code: code, history: history };
        }
        if (attempt < lim) {
          code = proposeFixFn(code, tRes.error || "Test failed", attempt);
        }
      }
      return { ok: false, attempts: lim, code: code, history: history };
    }
  };

  root.EvelynHybridRAG = {
    codeTokens: codeTokens,
    chunkCodeByFunctions: chunkCodeByFunctions,
    popcount32: popcount32,
    embedBinary128: embedBinary128,
    binarySimilarity: binarySimilarity,
    HybridRAGStore: HybridRAGStore,
    RepairLoopController: RepairLoopController
  };
})(typeof window !== "undefined" ? window : global);
