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
  /* A table is ONE Int8Array view over the file bytes (no weight byte is copied and no view is made
     per row). A row starts at r * stride; its first 4 bytes are the row's scale, which is also read
     into the scale array, and the weights follow. rowView(t, r) makes a view of one row when a
     caller wants one. */
  function readTableView(buf, o, rows, cols) {
    var view = new DataView(buf), stride = 4 + cols, start = o.p;
    var scale = new Float32Array(rows);
    for (var r = 0; r < rows; r++) {
      scale[r] = view.getFloat32(start + r * stride, true);
    }
    o.p = start + rows * stride;
    return { scale: scale, bytes: new Int8Array(buf, start, rows * stride), stride: stride, rows: rows, cols: cols };
  }

  function rowView(t, r) { return new Int8Array(t.bytes.buffer, t.bytes.byteOffset + r * t.stride + 4, t.cols); }

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

  /* The bytes of a slice source are one buffer that stays in memory, so a layer is checked against its
     CRC32 the first time it is used and not again (a layer is parsed once for every letter written,
     and the check reads all of it). Set verifyEvery to true to check at every use. */
  function SliceStreamSource(buf, meta, manifest) {
    this.mode = "slice";
    this.buf = buf; this.meta = meta; this.manifest = manifest || null;
    this.verifyEvery = false;
    this.verified = [];
  }
  SliceStreamSource.prototype.layerAt = function (l, stats) {
    var lr = this.meta.layers[l];
    var crc = null;
    if (this.manifest && (this.verifyEvery || !this.verified[l])) crc = this.manifest.layers[l].crc32;
    var layer = parseLayerSlice(this.buf, lr.offset, this.meta.D, this.meta.HID, crc);
    if (crc !== null) this.verified[l] = true;
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
    var rows = t.rows, cols = t.cols, stride = t.stride, w = t.bytes, sc = t.scale;
    for (var r = 0; r < rows; r++) {
      var s = 0.0, base = r * stride + 4;
      for (var c = 0; c < cols; c++) s += w[base + c] * x[c];
      y[r] = s * sc[r];
    }
  };

  /* For the second feed-forward matrix (its input has just been through the ReLU): only the
     columns that are not zero are multiplied. The result equals _matvec bit for bit. */
  Tiny2StreamModel.prototype._matvecSparse = function (t, x, y) {
    var rows = t.rows, cols = t.cols, stride = t.stride, w = t.bytes, sc = t.scale, c, r, k = 0;
    if (!this._nz || this._nz.length < cols) { this._nz = new Int32Array(cols); this._nzv = new Float32Array(cols); }
    var idx = this._nz, val = this._nzv;
    for (c = 0; c < cols; c++) if (x[c] !== 0) { idx[k] = c; val[k] = x[c]; k++; }
    if (k > (cols >> 1)) { this._matvec(t, x, y); return; }
    for (r = 0; r < rows; r++) {
      var s = 0.0, base = r * stride + 4;
      for (c = 0; c < k; c++) s += w[base + idx[c]] * val[c];
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
    for (i = 0; i < D; i++) { v = src[i] * k; dst[off + i] = (v < 0 ? v - 0.5 : v + 0.5) | 0; }
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
    this._matvecSparse(layer.f2, this.bm, this.bt);
    for (i = 0; i < D; i++) x[i] += this.bt[i];
  };

  Tiny2StreamModel.prototype._embedToken = function (tok, p, dst) {
    var D = this.meta.D, eb = this.emb.bytes, pb = this.pos.bytes;
    var eo = tok * this.emb.stride + 4, po = p * this.pos.stride + 4;
    var es = this.emb.scale[tok], ps = this.pos.scale[p];
    for (var i = 0; i < D; i++) dst[i] = eb[eo + i] * es + pb[po + i] * ps;
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
  var STOP_W = {
    a: 1, an: 1, the: 1, is: 1, are: 1, was: 1, what: 1, which: 1, of: 1, "in": 1, on: 1, to: 1, "for": 1, and: 1, or: 1,
    how: 1, "do": 1, does: 1, my: 1, me: 1, it: 1, "with": 1, from: 1, that: 1, "this": 1, be: 1, as: 1, at: 1, by: 1, can: 1, you: 1, "if": 1
  };

  /* Light stemming, the same on the indexed text and on the question, so the two always meet:
     purification and purifying both give purify, meshes gives mesh, planets gives planet, geometries gives geometry. */
  function shelfStem(w) {
    var n = w.length;
    if (n > 8 && /ication$/.test(w)) return w.slice(0, -7) + "y";
    if (n > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (n > 6 && /ing$/.test(w)) return w.slice(0, -3);
    if (n > 4 && /(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (n > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  /* The words of a text for the shelf index. A name written in code is kept whole and also cut into its parts:
     setPixelRatio gives setpixelratio, set, pixel and ratio; fast_path gives fast_path, fast and path. Repeats are kept
     (they are the term frequency). */
  function tokenizeForShelf(text) {
    var raw = String(text || "").match(/[A-Za-z0-9_]+/g) || [], out = [], i, j, w, parts, cut, p;
    for (i = 0; i < raw.length; i++) {
      w = raw[i];
      cut = w.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/_+/g, " ");
      parts = cut.split(" ");
      if (parts.length > 1) {
        p = w.toLowerCase().replace(/_+/g, "_");
        if (p.length >= 2 && !STOP_W[p]) out.push(shelfStem(p));
        for (j = 0; j < parts.length; j++) {
          p = parts[j].toLowerCase();
          if (p.length >= 2 && !STOP_W[p]) out.push(shelfStem(p));
        }
      } else {
        p = w.toLowerCase();
        if (p.length >= 2 && !STOP_W[p]) out.push(shelfStem(p));
      }
    }
    return out;
  }

  function OffsetShelfStore() {
    this.entries = [];             /* { id, shelf, topic, offset, length, crc32, docLen } */
    this.inv = Object.create(null);   /* term -> flat array: id, term count, 1 when the term is in the topic, id, ... */
    this.avgDocLen = 1;
    this.blob = new Uint8Array(0);
  }

  /* records: [{ shelf, topic, fullText }]. The blob stands for the file on disk; a host that
     keeps the text in a file saves this.blob there and passes a sliceReader to the readers.
     The whole text of every entry is indexed (it was the first 240 letters before 2026-11-23). */
  OffsetShelfStore.prototype.buildFromRecords = function (records) {
    var chunks = [], total = 0, i, j, k, sumLen = 0;
    this.entries = []; this.inv = Object.create(null);
    for (i = 0; i < records.length; i++) {
      var r = records[i], txt = String(r.fullText || ""), bytes = new Uint8Array(txt.length);
      for (j = 0; j < txt.length; j++) bytes[j] = txt.charCodeAt(j) & 0x7F;
      var id = this.entries.length;
      var topicWords = tokenizeForShelf(r.topic || ""), words = tokenizeForShelf(txt), inTopic = Object.create(null), tf = Object.create(null), order = [];
      for (j = 0; j < topicWords.length; j++) { inTopic[topicWords[j]] = 1; words.push(topicWords[j]); }
      for (j = 0; j < words.length; j++) {
        if (!tf[words[j]]) { tf[words[j]] = 0; order.push(words[j]); }
        tf[words[j]]++;
      }
      this.entries.push({ id: id, shelf: r.shelf || "book", topic: r.topic || "entry", offset: total, length: bytes.length, crc32: crc32(bytes, 0, bytes.length), docLen: words.length });
      sumLen += words.length;
      chunks.push(bytes); total += bytes.length;
      for (k = 0; k < order.length; k++) {
        var w = order[k];
        if (!this.inv[w]) this.inv[w] = [];
        this.inv[w].push(id, tf[w], inTopic[w] ? 1 : 0);
      }
    }
    this.avgDocLen = this.entries.length ? Math.max(1, sumLen / this.entries.length) : 1;
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

  /* BM25 over the whole index (k1 1.2, b 0.75), a term that is in an entry's topic counts 2.5 times. Returns the ranked
     [id, score] pairs without reading any text. */
  OffsetShelfStore.prototype.rank = function (q) {
    var terms = tokenizeForShelf(q), seen = Object.create(null), N = this.entries.length || 1, avg = this.avgDocLen || 1;
    var k1 = 1.2, b = 0.75, scores = Object.create(null), i, j;
    for (i = 0; i < terms.length; i++) {
      var w = terms[i];
      if (seen[w]) continue;
      seen[w] = 1;
      var list = this.inv[w];
      if (!list) continue;
      var df = list.length / 3, idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (j = 0; j < list.length; j += 3) {
        var id = list[j], tf = list[j + 1], dl = this.entries[id].docLen || avg;
        var norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avg)));
        scores[id] = (scores[id] || 0) + idf * norm * (list[j + 2] ? 2.5 : 1);
      }
    }
    var ranked = [];
    for (var key in scores) ranked.push([Number(key), scores[key]]);
    ranked.sort(function (x, y) { return y[1] - x[1] || x[0] - y[0]; });
    return ranked;
  };

  /* the best topK entries, read with their CRC32 check; each has .score */
  OffsetShelfStore.prototype.searchFull = function (q, topK, sliceReader) {
    var ranked = this.rank(q), out = [], n = Math.min(topK || 1, ranked.length), i, hit;
    for (i = 0; i < n; i++) { hit = this.readFullText(ranked[i][0], sliceReader); hit.score = ranked[i][1]; out.push(hit); }
    return out;
  };

  /* the same, with how sure the search is: topScore, the gap to the second hit and that gap as a share of the top score.
     The scores depend on the question's length and on the shelf, so compare them for one shelf, not across shelves. */
  OffsetShelfStore.prototype.searchScored = function (q, topK, sliceReader) {
    var hits = this.searchFull(q, topK, sliceReader);
    var top = hits.length ? hits[0].score : 0, second = hits.length > 1 ? hits[1].score : 0;
    return { hits: hits, topScore: top, secondScore: second, gap: top - second, relGap: top > 0 ? (top - second) / top : 0 };
  };

  var EvelynStream = {
    VOCAB: VOCAB, CTX: CTX,
    crc32: crc32, layerBytes: layerBytes,
    parseHeaderAndOffsets: parseHeaderAndOffsets,
    buildSovereignManifest: buildSovereignManifest,
    splitTny2Shards: splitTny2Shards,
    parseLayerSlice: parseLayerSlice,
    rowView: rowView,
    Tiny2StreamModel: Tiny2StreamModel,
    OffsetShelfStore: OffsetShelfStore,
    tokenizeForShelf: tokenizeForShelf
  };

  if (typeof module !== "undefined" && module.exports) module.exports = EvelynStream;
  else root.EvelynStream = EvelynStream;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
