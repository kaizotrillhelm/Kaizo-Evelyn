/* evelyn_stream.js - layer-streaming TNY2 for Evelyn: one layer in memory at a time.

   Inspired by AirLLM (https://github.com/lyogavin/airllm, Apache-2.0), which runs a large
   model on a small GPU by loading one layer at a time, running it, and dropping it. Evelyn's
   version does the same for the TNY2 weight file, on any machine with too little memory for
   the whole file. No AirLLM code or Python is used; this is a clean ES5 implementation.

   What is here (all of it plain ES5, no dependencies; browser, Web Worker and Node):
     - layerAt(l): one accessor for a layer, from three sources:
         resident  (all layers parsed up front, the classic way),
         slice     (parsed from the file buffer when asked, then dropped: zero-copy row views),
         prefetch  (an asynchronous fetcher, such as IndexedDB or a file read, asked for layer
                    l+1 while layer l computes)
     - zero-copy row views: a weight row is an Int8Array view into the source buffer
     - layer-order prefill: the whole prompt goes through layer 0, then layer 1, ... so a layer
       is loaded once per prompt and once per generated letter, not once per prompt letter
     - SovereignManifest: a CRC32 for the header, the embedding tables, every layer and the final
       gains, so a damaged or truncated layer is found before it is used
     - honest numbers: layersLoaded, bytesRead and lettersPerSec are counted, not estimated
     - OffsetShelfStore: the search index stays in memory, the full text stays in a blob or a file
       and is read by byte offset when it is needed

   The output is identical to Evelyn.Tiny2Model (js/evelyn_core.js) for the same weights; the
   tests compare the text and every byte of the KV cache. */
(function (root) {
  "use strict";

  var VOCAB = 97;
  var CTX = 128;

  /* ======================================================================
     1. CRC32 (IEEE 802.3) AND THE SOVEREIGN MANIFEST
     ====================================================================== */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8, offset, length) {
    var start = offset || 0;
    var end = start + (length !== undefined ? length : (u8.length - start));
    var c = 0xFFFFFFFF;
    for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function tableBytes(rows, cols) { return rows * (4 + cols); }
  function layerBytes(D, HID) {
    return D * 4 + 4 * tableBytes(D, D) + D * 4 + tableBytes(HID, D) + tableBytes(D, HID);
  }

  /* Reads the header and works out where every part of the file is. Throws on a short,
     foreign or truncated buffer. */
  function parseHeaderAndOffsets(buf) {
    if (!buf || buf.byteLength < 12) throw new Error("TNY2 buffer too short for header.");
    var v = new DataView(buf);
    var magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
    if (magic !== "TNY2") throw new Error("Not a TNY2 binary file.");
    var D = v.getUint16(4, true), L = v.getUint16(6, true);
    var H = v.getUint16(8, true), HID = v.getUint16(10, true);
    if (D < 1 || D > 512 || L < 1 || L > 16 || H < 1 || D % H !== 0 || HID < 1 || HID > 2048) {
      throw new Error("TNY2 header out of range.");
    }
    var embOff = 12, embLen = tableBytes(VOCAB, D);
    var posOff = embOff + embLen, posLen = tableBytes(CTX, D);
    var layerLen = layerBytes(D, HID);
    var layers = [], cur = posOff + posLen;
    for (var l = 0; l < L; l++) { layers.push({ index: l, offset: cur, length: layerLen }); cur += layerLen; }
    var gfOff = cur, gfLen = D * 4, total = gfOff + gfLen;
    if (buf.byteLength < total) throw new Error("TNY2 truncated: expected " + total + " bytes, got " + buf.byteLength);
    return {
      D: D, L: L, H: H, HD: (D / H) | 0, HID: HID,
      embOff: embOff, embLen: embLen, posOff: posOff, posLen: posLen,
      layers: layers, layerLen: layerLen, gfOff: gfOff, gfLen: gfLen, totalBytes: total
    };
  }

  /* CRC32 pins for the header, the two lookup tables, each layer and the final gains. */
  function buildSovereignManifest(buf) {
    var meta = parseHeaderAndOffsets(buf);
    var u8 = new Uint8Array(buf), list = [];
    for (var l = 0; l < meta.L; l++) {
      var lr = meta.layers[l];
      list.push({ index: l, offset: lr.offset, length: lr.length, crc32: crc32(u8, lr.offset, lr.length) });
    }
    return {
      magic: "TNY2", D: meta.D, L: meta.L, H: meta.H, HID: meta.HID, totalBytes: meta.totalBytes,
      headerCrc32: crc32(u8, 0, 12),
      embPosCrc32: crc32(u8, meta.embOff, meta.embLen + meta.posLen),
      gfCrc32: crc32(u8, meta.gfOff, meta.gfLen),
      layers: list
    };
  }

  /* ======================================================================
     2. ZERO-COPY TABLES AND LAYERS
     ====================================================================== */
  function readTableView(buf, o, rows, cols) {
    var view = new DataView(buf);
    var scale = new Float32Array(rows), rowViews = new Array(rows);
    for (var r = 0; r < rows; r++) {
      scale[r] = view.getFloat32(o.p, true);
      o.p += 4;
      rowViews[r] = new Int8Array(buf, o.p, cols);   /* a view into the source: no weight byte is copied */
      o.p += cols;
    }
    return { scale: scale, rowViews: rowViews, rows: rows, cols: cols };
  }

  function readGains(buf, o, n) {
    var view = new DataView(buf), g = new Float32Array(n);
    for (var i = 0; i < n; i++) { g[i] = view.getFloat32(o.p, true); o.p += 4; }
    return g;
  }

  /* expectedCrc (optional) is checked over the whole layer before any of it is used */
  function parseLayerSlice(buf, byteOffset, D, HID, expectedCrc) {
    var start = byteOffset || 0, len = layerBytes(D, HID);
    if (buf.byteLength - start < len) throw new Error("Incomplete layer shard (expected " + len + " bytes).");
    if (expectedCrc !== undefined && expectedCrc !== null) {
      var actual = crc32(new Uint8Array(buf), start, len);
      if (actual !== expectedCrc) {
        throw new Error("Layer shard CRC32 mismatch: expected 0x" + expectedCrc.toString(16) + ", got 0x" + actual.toString(16));
      }
    }
    var o = { p: start };
    return {
      g1: readGains(buf, o, D),
      wq: readTableView(buf, o, D, D), wk: readTableView(buf, o, D, D),
      wv: readTableView(buf, o, D, D), wo: readTableView(buf, o, D, D),
      g2: readGains(buf, o, D),
      f1: readTableView(buf, o, HID, D), f2: readTableView(buf, o, D, HID)
    };
  }

  /* Cuts a TNY2 buffer into the base part (header, tokens, positions), one shard per layer,
     and the final gains, plus the manifest. This is how a file would be stored as separate
     records in IndexedDB or as separate files on a disk. */
  function splitTny2Shards(buf) {
    var manifest = buildSovereignManifest(buf), meta = parseHeaderAndOffsets(buf), shards = [];
    for (var l = 0; l < meta.L; l++) {
      var lr = meta.layers[l];
      shards.push(buf.slice(lr.offset, lr.offset + lr.length));
    }
    return {
      manifest: manifest,
      baseSlice: buf.slice(0, meta.posOff + meta.posLen),
      gfSlice: buf.slice(meta.gfOff, meta.gfOff + meta.gfLen),
      shards: shards
    };
  }

  /* ======================================================================
     3. LAYER SOURCES
     ====================================================================== */
  function ResidentSource(buf, meta, manifest) {
    this.mode = "resident";
    this.layers = new Array(meta.L);
    for (var l = 0; l < meta.L; l++) {
      var lr = meta.layers[l];
      this.layers[l] = parseLayerSlice(buf, lr.offset, meta.D, meta.HID, manifest ? manifest.layers[l].crc32 : null);
    }
  }
  ResidentSource.prototype.layerAt = function (l, stats) {
    if (stats) stats.residentHits++;
    return this.layers[l];
  };

  function SliceStreamSource(buf, meta, manifest) {
    this.mode = "slice";
    this.buf = buf; this.meta = meta; this.manifest = manifest || null;
  }
  SliceStreamSource.prototype.layerAt = function (l, stats) {
    var lr = this.meta.layers[l];
    var layer = parseLayerSlice(this.buf, lr.offset, this.meta.D, this.meta.HID, this.manifest ? this.manifest.layers[l].crc32 : null);
    if (stats) { stats.layersLoaded++; stats.bytesRead += lr.length; }
    return layer;
  };

  /* fetchShardAsync(layerIndex, callback(err, arrayBuffer)) returns one layer's bytes. While
     layer l computes, layer l+1 is already being fetched. */
  function AsyncPrefetchSource(meta, manifest, fetchShardAsync) {
    this.mode = "prefetch";
    this.meta = meta; this.manifest = manifest || null;
    this.fetchShardAsync = fetchShardAsync;
    this.inflight = Object.create(null);
  }
  AsyncPrefetchSource.prototype.prefetch = function (l) {
    if (l < 0 || l >= this.meta.L || this.inflight[l]) return;
    var slot = { done: false, err: null, buf: null, waiters: [] };
    this.inflight[l] = slot;
    this.fetchShardAsync(l, function (err, buf) {
      slot.done = true; slot.err = err; slot.buf = buf;
      var w = slot.waiters; slot.waiters = [];
      for (var i = 0; i < w.length; i++) w[i](err, buf);
    });
  };
  AsyncPrefetchSource.prototype.layerAtAsync = function (l, stats, cb) {
    var self = this;
    if (!this.inflight[l]) this.prefetch(l);
    if (l + 1 < this.meta.L) this.prefetch(l + 1);
    var slot = this.inflight[l];
    function finish(err, buf) {
      delete self.inflight[l];                      /* the layer is dropped after use */
      if (err) { cb(err); return; }
      try {
        var layer = parseLayerSlice(buf, 0, self.meta.D, self.meta.HID, self.manifest ? self.manifest.layers[l].crc32 : null);
        if (stats) { stats.layersLoaded++; stats.bytesRead += self.meta.layerLen; }
        cb(null, layer);
      } catch (e) { cb(e); }
    }
    if (slot.done) finish(slot.err, slot.buf); else slot.waiters.push(finish);
  };

  /* ======================================================================
     4. THE STREAMING MODEL
     ====================================================================== */
  function cleanAscii(s) {   /* the same rules as Evelyn.cleanAscii */
    return String(s === undefined || s === null ? "" : s)
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
      .replace(/[^\x20-\x7E\n]/g, " ").replace(/[ \t]{2,}/g, " ").replace(/^[ \n]+|[ \n]+$/g, "")
      .replace(/\n/g, " ");
  }

  function newStats() {
    return { layersLoaded: 0, bytesRead: 0, residentHits: 0, charsGenerated: 0, elapsedMs: 0, lettersPerSec: 0 };
  }

  function Tiny2StreamModel() {
    this.loaded = false;
    this.meta = null; this.source = null;
    this.emb = null; this.pos = null; this.gf = null;
    this.kc = []; this.vc = []; this.ks = []; this.vs = [];
    this.stats = newStats();
  }

  Tiny2StreamModel.prototype._alloc = function (meta) {
    this.meta = meta;
    this.attDiv = Math.sqrt(meta.HD);
    this.kc = []; this.vc = []; this.ks = []; this.vs = [];
    for (var l = 0; l < meta.L; l++) {
      this.kc.push(new Int8Array(CTX * meta.D)); this.vc.push(new Int8Array(CTX * meta.D));
      this.ks.push(new Float32Array(CTX)); this.vs.push(new Float32Array(CTX));
    }
    this.bx = new Float32Array(meta.D); this.bh = new Float32Array(meta.D);
    this.bq = new Float32Array(meta.D); this.bt = new Float32Array(meta.D);
    this.ba = new Float32Array(meta.D); this.bm = new Float32Array(meta.HID);
    this.bs = new Float32Array(CTX); this.score = new Float32Array(VOCAB);
  };

  /* mode "resident" (default) parses every layer now; "slice" parses a layer each time it is
     asked for. Pass a manifest to have every layer checked against its CRC32. */
  Tiny2StreamModel.prototype.loadFromBuffer = function (buf, mode, manifest) {
    var meta = parseHeaderAndOffsets(buf);
    this._alloc(meta);
    var o = { p: meta.embOff };
    this.emb = readTableView(buf, o, VOCAB, meta.D);
    this.pos = readTableView(buf, o, CTX, meta.D);
    this.gf = readGains(buf, { p: meta.gfOff }, meta.D);
    this.source = (mode === "slice") ? new SliceStreamSource(buf, meta, manifest) : new ResidentSource(buf, meta, manifest);
    this.loaded = true;
    return meta;
  };

  /* The base part and the final gains are held; each layer comes from fetchShardAsync. */
  Tiny2StreamModel.prototype.loadFromAsyncShards = function (baseSlice, gfSlice, manifest, fetchShardAsync) {
    var D = manifest.D, HID = manifest.HID;
    var meta = {
      D: D, L: manifest.L, H: manifest.H, HD: (D / manifest.H) | 0, HID: HID,
      embOff: 12, embLen: tableBytes(VOCAB, D),
      posOff: 12 + tableBytes(VOCAB, D), posLen: tableBytes(CTX, D),
      layers: manifest.layers, layerLen: layerBytes(D, HID), totalBytes: manifest.totalBytes
    };
    this._alloc(meta);
    var o = { p: 12 };
    this.emb = readTableView(baseSlice, o, VOCAB, D);
    this.pos = readTableView(baseSlice, o, CTX, D);
    this.gf = readGains(gfSlice, { p: 0 }, D);
    this.source = new AsyncPrefetchSource(meta, manifest, fetchShardAsync);
    this.loaded = true;
    return meta;
  };

  Tiny2StreamModel.prototype.layerAt = function (l) { return this.source.layerAt(l, this.stats); };

  Tiny2StreamModel.prototype._matvec = function (t, x, y) {
    var rows = t.rows, cols = t.cols, rv = t.rowViews, sc = t.scale;
    for (var r = 0; r < rows; r++) {
      var w = rv[r], s = 0.0;
      for (var c = 0; c < cols; c++) s += w[c] * x[c];
      y[r] = s * sc[r];
    }
  };

  Tiny2StreamModel.prototype._norm = function (x, g, y) {
    var D = this.meta.D, s = 0.0, i;
    for (i = 0; i < D; i++) s += x[i] * x[i];
    var inv = 1.0 / Math.sqrt(s / D + 1e-5);
    for (i = 0; i < D; i++) y[i] = x[i] * inv * g[i];
  };

  Tiny2StreamModel.prototype._storeKV = function (dst, off, src) {
    var D = this.meta.D, big = 0.0, i, v;
    for (i = 0; i < D; i++) { v = src[i] < 0 ? -src[i] : src[i]; if (v > big) big = v; }
    if (big < 1e-20) big = 1e-20;
    var k = 127.0 / big;
    for (i = 0; i < D; i++) { v = src[i] * k; dst[off + i] = v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5); }
    return big / 127.0;
  };

  /* One layer for one position. The same arithmetic runs whether the caller walks tokens first
     (the classic order) or layers first (layer-order prefill). */
  Tiny2StreamModel.prototype._computeLayerPos = function (layer, l, p, x) {
    var D = this.meta.D, H = this.meta.H, HD = this.meta.HD, HID = this.meta.HID, i, j, h;
    this._norm(x, layer.g1, this.bh);
    this._matvec(layer.wk, this.bh, this.bt);
    this.ks[l][p] = this._storeKV(this.kc[l], p * D, this.bt);
    this._matvec(layer.wv, this.bh, this.bt);
    this.vs[l][p] = this._storeKV(this.vc[l], p * D, this.bt);
    this._matvec(layer.wq, this.bh, this.bq);

    var kcl = this.kc[l], vcl = this.vc[l], ksl = this.ks[l], vsl = this.vs[l];
    for (h = 0; h < H; h++) {
      var ho = h * HD, big = -1e30;
      for (j = 0; j <= p; j++) {
        var kp = j * D + ho, s = 0.0;
        for (i = 0; i < HD; i++) s += this.bq[ho + i] * kcl[kp + i];
        s = (s * ksl[j]) / this.attDiv;
        this.bs[j] = s;
        if (s > big) big = s;
      }
      var sum = 0.0;
      for (j = 0; j <= p; j++) {
        var df = this.bs[j] - big;
        this.bs[j] = df < -60 ? 0.0 : Math.exp(df);
        sum += this.bs[j];
      }
      for (i = 0; i < HD; i++) this.ba[ho + i] = 0.0;
      for (j = 0; j <= p; j++) {
        if (this.bs[j] === 0.0) continue;
        var vp = j * D + ho, w = (this.bs[j] * vsl[j]) / sum;
        for (i = 0; i < HD; i++) this.ba[ho + i] += w * vcl[vp + i];
      }
    }
    this._matvec(layer.wo, this.ba, this.bt);
    for (i = 0; i < D; i++) x[i] += this.bt[i];
    this._norm(x, layer.g2, this.bh);
    this._matvec(layer.f1, this.bh, this.bm);
    for (i = 0; i < HID; i++) if (this.bm[i] < 0) this.bm[i] = 0;
    this._matvec(layer.f2, this.bm, this.bt);
    for (i = 0; i < D; i++) x[i] += this.bt[i];
  };

  Tiny2StreamModel.prototype._embedToken = function (tok, p, dst) {
    var D = this.meta.D, ew = this.emb.rowViews[tok], pw = this.pos.rowViews[p];
    var es = this.emb.scale[tok], ps = this.pos.scale[p];
    for (var i = 0; i < D; i++) dst[i] = ew[i] * es + pw[i] * ps;
  };

  Tiny2StreamModel.prototype._greedyPick = function () {
    var best = 0;
    for (var i = 1; i < VOCAB; i++) if (this.score[i] > this.score[best]) best = i;
    return best;
  };

  Tiny2StreamModel.prototype._finalScores = function (x) {
    this._norm(x, this.gf, this.bh);
    this._matvec(this.emb, this.bh, this.score);
  };

  Tiny2StreamModel.prototype._promptTokens = function (question) {
    var clean = cleanAscii(question), toks = [];
    for (var i = 0; i < clean.length && toks.length < CTX - 2; i++) toks.push(clean.charCodeAt(i) - 30);
    toks.push(1);   /* end of question */
    return toks;
  };

  Tiny2StreamModel.prototype._finishStats = function (n, t0) {
    this.stats.charsGenerated = n;
    this.stats.elapsedMs = Math.max(1, Date.now() - t0);
    this.stats.lettersPerSec = (n * 1000) / this.stats.elapsedMs;
  };

  /* Answers a question with greedy choice. maxNew limits the answer length (default: to the end
     of the 128-position context). Layer-order prefill: each layer is loaded once for the whole
     prompt, then once for every letter that is generated. */
  Tiny2StreamModel.prototype.think = function (question, maxNew) {
    this.stats = newStats();
    var t0 = Date.now(), D = this.meta.D, L = this.meta.L, l, p;
    var toks = this._promptTokens(question), P = toks.length, X = new Array(P);
    for (p = 0; p < P; p++) { X[p] = new Float32Array(D); this._embedToken(toks[p], p, X[p]); }

    for (l = 0; l < L; l++) {
      var layer = this.layerAt(l);
      for (p = 0; p < P; p++) this._computeLayerPos(layer, l, p, X[p]);
    }
    this._finalScores(X[P - 1]);

    var out = [], limit = Math.min(CTX, P + (maxNew === undefined ? CTX : maxNew));
    for (p = P; p < limit; p++) {
      var tok = this._greedyPick();
      if (tok <= 1) break;
      out.push(String.fromCharCode(tok + 30));
      this._embedToken(tok, p, this.bx);
      for (l = 0; l < L; l++) this._computeLayerPos(this.layerAt(l), l, p, this.bx);
      this._finalScores(this.bx);
    }
    this._finishStats(out.length, t0);
    return { text: out.join(""), stats: this.stats };
  };

  /* The same answer from an asynchronous source; layer l+1 is fetched while layer l computes. */
  Tiny2StreamModel.prototype.thinkAsync = function (question, maxNew, cb) {
    var self = this;
    this.stats = newStats();
    var t0 = Date.now(), D = this.meta.D, L = this.meta.L, p;
    var toks = this._promptTokens(question), P = toks.length, X = new Array(P);
    for (p = 0; p < P; p++) { X[p] = new Float32Array(D); this._embedToken(toks[p], p, X[p]); }
    var out = [], limit = Math.min(CTX, P + (maxNew === undefined ? CTX : maxNew));

    function prefill(l) {
      if (l >= L) { self._finalScores(X[P - 1]); generate(P); return; }
      self.source.layerAtAsync(l, self.stats, function (err, layer) {
        if (err) { cb(err); return; }
        for (var q = 0; q < P; q++) self._computeLayerPos(layer, l, q, X[q]);
        prefill(l + 1);
      });
    }
    function generate(pos) {
      if (pos >= limit) { done(); return; }
      var tok = self._greedyPick();
      if (tok <= 1) { done(); return; }
      out.push(String.fromCharCode(tok + 30));
      self._embedToken(tok, pos, self.bx);
      stepLayer(pos, 0);
    }
    function stepLayer(pos, l) {
      if (l >= L) { self._finalScores(self.bx); generate(pos + 1); return; }
      self.source.layerAtAsync(l, self.stats, function (err, layer) {
        if (err) { cb(err); return; }
        self._computeLayerPos(layer, l, pos, self.bx);
        stepLayer(pos, l + 1);
      });
    }
    function done() { self._finishStats(out.length, t0); cb(null, { text: out.join(""), stats: self.stats }); }
    prefill(0);
  };

  /* ======================================================================
     5. OFFSET SHELF STORE: the index in memory, the full text on disk
     ====================================================================== */
  var STOP_W = { a: 1, an: 1, the: 1, is: 1, are: 1, was: 1, what: 1, which: 1, of: 1, "in": 1, on: 1, to: 1, "for": 1, and: 1, or: 1 };

  function OffsetShelfStore() {
    this.entries = [];             /* { id, shelf, topic, offset, length, crc32 } */
    this.inv = Object.create(null);
    this.blob = new Uint8Array(0);
  }

  /* records: [{ shelf, topic, fullText }]. The blob stands for the file on disk; a host that
     keeps the text in a file saves this.blob there and passes a sliceReader to the readers. */
  OffsetShelfStore.prototype.buildFromRecords = function (records) {
    var chunks = [], total = 0, i, j;
    this.entries = []; this.inv = Object.create(null);
    for (i = 0; i < records.length; i++) {
      var r = records[i], txt = String(r.fullText || ""), bytes = new Uint8Array(txt.length);
      for (j = 0; j < txt.length; j++) bytes[j] = txt.charCodeAt(j) & 0x7F;
      var id = this.entries.length;
      this.entries.push({ id: id, shelf: r.shelf || "book", topic: r.topic || "entry", offset: total, length: bytes.length, crc32: crc32(bytes, 0, bytes.length) });
      chunks.push(bytes); total += bytes.length;
      var ws = (String(r.topic || "") + " " + txt.slice(0, 240)).toLowerCase().match(/[a-z0-9*]+/g) || [];
      var seen = Object.create(null);
      for (j = 0; j < ws.length; j++) {
        if (STOP_W[ws[j]] || seen[ws[j]]) continue;
        seen[ws[j]] = 1;
        if (!this.inv[ws[j]]) this.inv[ws[j]] = [];
        this.inv[ws[j]].push(id);
      }
    }
    this.blob = new Uint8Array(total);
    var cur = 0;
    for (i = 0; i < chunks.length; i++) { this.blob.set(chunks[i], cur); cur += chunks[i].length; }
    return { count: this.entries.length, totalBytes: total };
  };

  /* Reads only [offset, offset+length) and checks its CRC32. */
  OffsetShelfStore.prototype.readFullText = function (id, sliceReader) {
    var e = this.entries[id];
    if (!e) return null;
    var slice = sliceReader ? sliceReader(e.offset, e.length) : this.blob.subarray(e.offset, e.offset + e.length);
    if (crc32(slice, 0, slice.length) !== e.crc32) throw new Error("OffsetShelfStore CRC32 mismatch on id " + id);
    var chars = new Array(slice.length);
    for (var i = 0; i < slice.length; i++) chars[i] = String.fromCharCode(slice[i]);
    return { id: e.id, shelf: e.shelf, topic: e.topic, fullText: chars.join(""), bytesRead: slice.length };
  };

  OffsetShelfStore.prototype.searchFull = function (q, topK, sliceReader) {
    var ws = String(q || "").toLowerCase().match(/[a-z0-9*]+/g) || [];
    var scores = Object.create(null), i, j;
    for (i = 0; i < ws.length; i++) {
      var list = this.inv[ws[i]];
      if (!list) continue;
      for (j = 0; j < list.length; j++) scores[list[j]] = (scores[list[j]] || 0) + 1;
    }
    var ranked = [];
    for (var k in scores) ranked.push([Number(k), scores[k]]);
    ranked.sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    var out = [];
    for (i = 0; i < Math.min(topK || 1, ranked.length); i++) out.push(this.readFullText(ranked[i][0], sliceReader));
    return out;
  };

  var EvelynStream = {
    VOCAB: VOCAB, CTX: CTX,
    crc32: crc32, layerBytes: layerBytes,
    parseHeaderAndOffsets: parseHeaderAndOffsets,
    buildSovereignManifest: buildSovereignManifest,
    splitTny2Shards: splitTny2Shards,
    parseLayerSlice: parseLayerSlice,
    Tiny2StreamModel: Tiny2StreamModel,
    OffsetShelfStore: OffsetShelfStore
  };

  if (typeof module !== "undefined" && module.exports) module.exports = EvelynStream;
  else root.EvelynStream = EvelynStream;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
