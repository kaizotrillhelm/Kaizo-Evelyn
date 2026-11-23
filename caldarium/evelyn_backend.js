/* evelyn_backend.js - ES5 Compatible Storage, Web Worker TNY2, KV21, SM-2 & Audio
   Works offline on modern browsers and falls back cleanly on IE10/11 & Firefox 45. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. DETERMINISTIC SEEDED PRNG (Mulberry32) FOR REPLAYS & SELF-TESTING
     ========================================================================= */
  function createRng(seed) {
    var a = (seed >>> 0) || 0x9E3779B9;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul ? Math.imul(a ^ (a >>> 15), 1 | a) : ((a ^ (a >>> 15)) * (1 | a)) | 0;
      t = (t + (Math.imul ? Math.imul(t ^ (t >>> 7), 61 | t) : ((t ^ (t >>> 7)) * (61 | t)))) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* =========================================================================
     2. LZW COMPRESSOR + GAP-ENCODED POSTING LISTS + 64-ENTRY LRU CACHE
     ========================================================================= */
  var LZ = {
    compress: function (str) {
      if (!str) return "";
      var dict = Object.create(null), i, w = "", codes = [], next = 256;
      for (i = 0; i < 256; i++) dict[String.fromCharCode(i)] = i;
      for (i = 0; i < str.length; i++) {
        var c = String.fromCharCode(str.charCodeAt(i) & 255), wc = w + c;
        if (dict[wc] !== undefined) w = wc;
        else { codes.push(dict[w]); if (next < 65535) dict[wc] = next++; w = c; }
      }
      if (w !== "") codes.push(dict[w]);
      var out = "";
      for (i = 0; i < codes.length; i++) out += String.fromCharCode(codes[i]);
      return out;
    },
    decompress: function (packed) {
      if (!packed) return "";
      var dict = [], i, next = 256;
      for (i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);
      var w = String.fromCharCode(packed.charCodeAt(0)), res = [w];
      for (i = 1; i < packed.length; i++) {
        var k = packed.charCodeAt(i);
        var e = dict[k] !== undefined ? dict[k] : (k === next ? w + w.charAt(0) : "");
        res.push(e);
        if (next < 65535) dict[next++] = w + e.charAt(0);
        w = e;
      }
      return res.join("");
    }
  };

  function packPostings(sortedIds) {
    var arr = new Uint32Array(sortedIds.length), prev = 0;
    for (var i = 0; i < sortedIds.length; i++) {
      arr[i] = sortedIds[i] - prev;
      prev = sortedIds[i];
    }
    return arr;
  }

  function unpackPostings(gaps) {
    var out = new Array(gaps.length), acc = 0;
    for (var i = 0; i < gaps.length; i++) {
      acc += gaps[i];
      out[i] = acc;
    }
    return out;
  }

  function LRUCache(limit) {
    this.limit = limit || 64;
    this.map = Object.create(null);
    this.order = [];
  }
  LRUCache.prototype.get = function (k) {
    if (this.map[k] === undefined) return undefined;
    var idx = this.order.indexOf(k);
    if (idx >= 0) { this.order.splice(idx, 1); this.order.push(k); }
    return this.map[k];
  };
  LRUCache.prototype.set = function (k, v) {
    if (this.map[k] === undefined && this.order.length >= this.limit) {
      var oldest = this.order.shift();
      delete this.map[oldest];
    }
    this.map[k] = v;
    var idx = this.order.indexOf(k);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(k);
  };

  /* =========================================================================
     3. INDEXEDDB PERSISTENCE (WITH AUTOMATIC IN-MEMORY / LOCALSTORAGE FALLBACK)
     ========================================================================= */
  var EvelynDB = {
    db: null,
    mem: { shelves: {}, weights: {}, cartridges: {}, profiles: {}, books: {} },
    ready: false,
    open: function (cb) {
      var self = this;
      var idb = root.indexedDB || root.mozIndexedDB || root.webkitIndexedDB;
      if (!idb) { self.ready = true; if (cb) cb(false); return; }
      try {
        /* version 2 adds "books": the full text of each book a learner loads, so any book they have read can become a game */
        var req = idb.open("EvelynCaldariumDB_v2", 2);
        req.onupgradeneeded = function (e) {
          var d = e.target.result;
          ["shelves", "weights", "cartridges", "profiles", "books"].forEach(function (s) {
            if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
          });
        };
        req.onsuccess = function (e) { self.db = e.target.result; self.ready = true; if (cb) cb(true); };
        req.onerror = function () { self.ready = true; if (cb) cb(false); };
      } catch (err) {
        self.ready = true; if (cb) cb(false);
      }
    },
    put: function (store, key, val, cb) {
      this.mem[store][key] = val;
      if (!this.db) {
        if (store === "profiles" && typeof localStorage !== "undefined") {
          try { localStorage.setItem("ev_" + key, JSON.stringify(val)); } catch (e) {}
        }
        if (cb) cb(true);
        return;
      }
      try {
        var tx = this.db.transaction([store], "readwrite");
        tx.objectStore(store).put(val, key);
        tx.oncomplete = function () { if (cb) cb(true); };
        tx.onerror = function () { if (cb) cb(false); };
      } catch (e) { if (cb) cb(false); }
    },
    get: function (store, key, cb) {
      var self = this;
      if (!this.db) {
        var v = this.mem[store][key];
        if (v === undefined && store === "profiles" && typeof localStorage !== "undefined") {
          try { v = JSON.parse(localStorage.getItem("ev_" + key)); } catch (e) {}
        }
        if (cb) cb(v);
        return;
      }
      try {
        var tx = this.db.transaction([store], "readonly");
        var r = tx.objectStore(store).get(key);
        r.onsuccess = function () { cb(r.result !== undefined ? r.result : self.mem[store][key]); };
        r.onerror = function () { cb(self.mem[store][key]); };
      } catch (e) { cb(self.mem[store][key]); }
    },
    getAll: function (store, cb) {
      var self = this;
      if (!this.db) {
        var list = [];
        for (var k in this.mem[store]) list.push(this.mem[store][k]);
        cb(list); return;
      }
      try {
        var tx = this.db.transaction([store], "readonly");
        var os = tx.objectStore(store), res = [];
        var cur = os.openCursor();
        cur.onsuccess = function (e) {
          var c = e.target.result;
          if (c) { res.push(c.value); c.continue(); } else cb(res);
        };
        cur.onerror = function () { cb([]); };
      } catch (e) { cb([]); }
    }
  };

  /* =========================================================================
     4. PACKED SHELF LIBRARY (PREBUILT GAP POSTINGS + 64-ENTRY LRU CACHE)
     ========================================================================= */
  var STOP_W = { a:1,an:1,the:1,is:1,are:1,was:1,what:1,which:1,who:1,where:1,when:1,how:1,do:1,does:1,of:1,in:1,on:1,to:1,for:1,and:1,or:1,it:1 };

  var ShelfLibrary = {
    rows: [],
    postings: Object.create(null), // word -> Uint32Array of gap-encoded doc IDs
    lru: new LRUCache(64),
    add: function (shelf, topic, fact, ex) {
      var id = this.rows.length;
      this.rows.push({ id: id, shelf: shelf, topic: topic, zF: LZ.compress(fact), zE: LZ.compress(ex || "") });
      var ws = (topic + " " + fact).toLowerCase().match(/[a-z0-9*]+/g) || [], seen = Object.create(null);
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        if (STOP_W[w] || seen[w]) continue;
        seen[w] = 1;
        var cur = this.postings[w] ? unpackPostings(this.postings[w]) : [];
        cur.push(id);
        this.postings[w] = packPostings(cur);
      }
      return shelf + "#" + id;
    },
    read: function (id) {
      var cached = this.lru.get(id);
      if (cached) return cached;
      var r = this.rows[id];
      if (!r) return null;
      var dec = { id: r.id, src: r.shelf + "#" + r.id, shelf: r.shelf, topic: r.topic, fact: LZ.decompress(r.zF), ex: LZ.decompress(r.zE) };
      this.lru.set(id, dec);
      return dec;
    },
    search: function (q, topK, shelfFilter) {
      var ws = String(q || "").toLowerCase().match(/[a-z0-9*]+/g) || [];
      var scores = Object.create(null), i, j;
      for (i = 0; i < ws.length; i++) {
        var w = ws[i];
        if (STOP_W[w] || !this.postings[w]) continue;
        var ids = unpackPostings(this.postings[w]);
        for (j = 0; j < ids.length; j++) {
          var id = ids[j];
          if (shelfFilter && this.rows[id].shelf !== shelfFilter) continue;
          scores[id] = (scores[id] || 0) + (this.rows[id].topic.toLowerCase().indexOf(w) >= 0 ? 3 : 1);
        }
      }
      var list = [];
      for (var k in scores) list.push([Number(k), scores[k]]);
      list.sort(function (a, b) { return b[1] - a[1]; });
      var out = [];
      for (i = 0; i < Math.min(topK || 2, list.length); i++) out.push(this.read(list[i][0]));
      return out;
    },
    ingestPlainText: function (txt, shelfName) {
      var paras = String(txt || "").replace(/\r/g, "").split(/\n\s*\n/), added = 0;
      for (var i = 0; i < paras.length; i++) {
        var p = paras[i].replace(/\s+/g, " ").trim();
        if (p.length < 24) continue;
        this.add(shelfName || "imported", p.split(" ").slice(0, 3).join(" "), p.slice(0, 180), "");
        added++;
      }
      this.persist();
      return added;
    },
    persist: function (cb) {
      EvelynDB.put("shelves", "main_index", { rows: this.rows, postings: this.postings }, cb);
    },
    restore: function (cb) {
      var self = this;
      EvelynDB.get("shelves", "main_index", function (saved) {
        if (saved && saved.rows && saved.rows.length) {
          self.rows = saved.rows;
          self.postings = saved.postings || Object.create(null);
          if (cb) cb(true);
        } else {
          if (cb) cb(false);
        }
      });
    }
  };

  /* =========================================================================
     5. SELF-CONTAINED TNY2 CORE (INT8xINT8 MATVEC + PINNED KV21 PREFIX CACHE)
        Serialized into an inline Blob Web Worker, with main-thread fallback.
     ========================================================================= */
  function createTiny2Core() {
    var VOCAB = 97, CTX = 128;
    var core = {
      loaded: false, D: 0, L: 0, H: 0, HD: 0, HID: 0, attDiv: 1,
      prefixLen: 0,
      emb: null, pos: null, wq: [], wk: [], wv: [], wo: [], f1: [], f2: [], g1: [], g2: [], gf: null,
      kc: [], vc: [], ks: [], vs: [],
      bx: null, bh: null, bq: null, bt: null, ba: null, bm: null, bs: null, score: null,
      xq: null, layerAct: [0, 0, 0, 0], lastConf: 0
    };

    function readTable(v, b, o, rows, cols) {
      var sc = new Float32Array(rows), w = new Int8Array(rows * cols);
      for (var r = 0; r < rows; r++) {
        sc[r] = v.getFloat32(o.p, true); o.p += 4;
        w.set(new Int8Array(b, o.p, cols), r * cols); o.p += cols;
      }
      return { scale: sc, w: w, rows: rows, cols: cols };
    }
    function readGains(v, o, n) {
      var g = new Float32Array(n);
      for (var i = 0; i < n; i++) { g[i] = v.getFloat32(o.p, true); o.p += 4; }
      return g;
    }

    /* INT8 x INT8 integer-accumulated matvec (SageAttention/TINY-style CPU win) */
    function matvecInt8(t, x, y) {
      var rows = t.rows, cols = t.cols, w = t.w, sc = t.scale, xq = core.xq;
      var big = 0.0, i, r, c;
      for (i = 0; i < cols; i++) {
        var a = x[i] < 0 ? -x[i] : x[i];
        if (a > big) big = a;
      }
      if (big < 1e-20) { for (r = 0; r < rows; r++) y[r] = 0; return; }
      var xScale = big / 127.0, inv = 127.0 / big;
      for (i = 0; i < cols; i++) {
        var v = x[i] * inv;
        xq[i] = v < 0 ? ((v - 0.5) | 0) : ((v + 0.5) | 0);
      }
      for (r = 0; r < rows; r++) {
        var acc = 0, base = r * cols;
        for (c = 0; c < cols; c++) acc = (acc + w[base + c] * xq[c]) | 0;
        y[r] = acc * sc[r] * xScale;
      }
    }

    function rmsNorm(x, g, y) {
      var i, s = 0, D = core.D;
      for (i = 0; i < D; i++) s += x[i] * x[i];
      var inv = 1 / Math.sqrt(s / D + 1e-5);
      for (i = 0; i < D; i++) y[i] = x[i] * inv * g[i];
    }

    function storeKV(dst, off, src) {
      var i, D = core.D, big = 0;
      for (i = 0; i < D; i++) { var a = src[i] < 0 ? -src[i] : src[i]; if (a > big) big = a; }
      if (big < 1e-20) big = 1e-20;
      var k = 127 / big;
      for (i = 0; i < D; i++) { var v = src[i] * k; dst[off + i] = v < 0 ? ((v - 0.5) | 0) : ((v + 0.5) | 0); }
      return big / 127;
    }

    core.load = function (buf) {
      var v = new DataView(buf);
      if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== "TNY2") {
        throw new Error("Invalid TNY2 file");
      }
      core.D = v.getUint16(4, true); core.L = v.getUint16(6, true);
      core.H = v.getUint16(8, true); core.HID = v.getUint16(10, true);
      core.HD = (core.D / core.H) | 0; core.attDiv = Math.sqrt(core.HD);
      var o = { p: 12 };
      core.emb = readTable(v, buf, o, VOCAB, core.D);
      core.pos = readTable(v, buf, o, CTX, core.D);
      core.wq = []; core.wk = []; core.wv = []; core.wo = []; core.f1 = []; core.f2 = [];
      core.g1 = []; core.g2 = []; core.kc = []; core.vc = []; core.ks = []; core.vs = [];
      for (var l = 0; l < core.L; l++) {
        core.g1.push(readGains(v, o, core.D));
        core.wq.push(readTable(v, buf, o, core.D, core.D)); core.wk.push(readTable(v, buf, o, core.D, core.D));
        core.wv.push(readTable(v, buf, o, core.D, core.D)); core.wo.push(readTable(v, buf, o, core.D, core.D));
        core.g2.push(readGains(v, o, core.D));
        core.f1.push(readTable(v, buf, o, core.HID, core.D)); core.f2.push(readTable(v, buf, o, core.D, core.HID));
        core.kc.push(new Int8Array(CTX * core.D)); core.vc.push(new Int8Array(CTX * core.D));
        core.ks.push(new Float32Array(CTX)); core.vs.push(new Float32Array(CTX));
      }
      core.gf = readGains(v, o, core.D);
      core.bx = new Float32Array(core.D); core.bh = new Float32Array(core.D);
      core.bq = new Float32Array(core.D); core.bt = new Float32Array(core.D);
      core.ba = new Float32Array(core.D); core.bm = new Float32Array(core.HID);
      core.bs = new Float32Array(CTX); core.score = new Float32Array(VOCAB);
      core.xq = new Int8Array(Math.max(core.D, core.HID));
      core.prefixLen = 0;
      core.loaded = true;
      return { D: core.D, L: core.L, H: core.H, HID: core.HID };
    };

    core.step = function (tok, p) {
      var D = core.D, L = core.L, H = core.H, HD = core.HD, HID = core.HID, i, j, l, h;
      var eb = tok * D, pb = p * D, es = core.emb.scale[tok], ps = core.pos.scale[p];
      for (i = 0; i < D; i++) core.bx[i] = core.emb.w[eb + i] * es + core.pos.w[pb + i] * ps;
      for (l = 0; l < L; l++) {
        rmsNorm(core.bx, core.g1[l], core.bh);
        matvecInt8(core.wk[l], core.bh, core.bt); core.ks[l][p] = storeKV(core.kc[l], p * D, core.bt);
        matvecInt8(core.wv[l], core.bh, core.bt); core.vs[l][p] = storeKV(core.vc[l], p * D, core.bt);
        matvecInt8(core.wq[l], core.bh, core.bq);

        /* INT8 Q*K dot product per head */
        var kcl = core.kc[l], vcl = core.vc[l], ksl = core.ks[l], vsl = core.vs[l];
        for (h = 0; h < H; h++) {
          var ho = h * HD, qBig = 0;
          for (i = 0; i < HD; i++) { var qa = core.bq[ho + i] < 0 ? -core.bq[ho + i] : core.bq[ho + i]; if (qa > qBig) qBig = qa; }
          var qScale = qBig > 1e-20 ? qBig / 127 : 1, qInv = qBig > 1e-20 ? 127 / qBig : 0;
          for (i = 0; i < HD; i++) core.xq[i] = (core.bq[ho + i] * qInv) | 0;
          var big = -1e30;
          for (j = 0; j <= p; j++) {
            var kp = j * D + ho, acc = 0;
            for (i = 0; i < HD; i++) acc = (acc + core.xq[i] * kcl[kp + i]) | 0;
            var s = (acc * qScale * ksl[j]) / core.attDiv;
            core.bs[j] = s; if (s > big) big = s;
          }
          var sum = 0;
          for (j = 0; j <= p; j++) { var df = core.bs[j] - big; core.bs[j] = df < -60 ? 0 : Math.exp(df); sum += core.bs[j]; }
          for (i = 0; i < HD; i++) core.ba[ho + i] = 0;
          for (j = 0; j <= p; j++) {
            if (!core.bs[j]) continue;
            var vp = j * D + ho, wgt = core.bs[j] * vsl[j] / sum;
            for (i = 0; i < HD; i++) core.ba[ho + i] += wgt * vcl[vp + i];
          }
        }
        matvecInt8(core.wo[l], core.ba, core.bt); for (i = 0; i < D; i++) core.bx[i] += core.bt[i];
        rmsNorm(core.bx, core.g2[l], core.bh); matvecInt8(core.f1[l], core.bh, core.bm);
        var actSum = 0;
        for (i = 0; i < HID; i++) { if (core.bm[i] < 0) core.bm[i] = 0; else actSum += core.bm[i]; }
        if (l < 4) core.layerAct[l] = Math.min(1, (actSum / HID) * 1.4);
        matvecInt8(core.f2[l], core.bm, core.bt); for (i = 0; i < D; i++) core.bx[i] += core.bt[i];
      }
      rmsNorm(core.bx, core.gf, core.bh); matvecInt8(core.emb, core.bh, core.score);
    };

    core.pinPrefix = function (prefixStr) {
      if (!core.loaded) return 0;
      var s = String(prefixStr || "").replace(/[^\x20-\x7E]/g, "").slice(0, 24);
      for (var i = 0; i < s.length; i++) core.step(s.charCodeAt(i) - 30, i);
      core.prefixLen = s.length;
      return core.prefixLen;
    };

    core.think = function (q, creat) {
      if (!core.loaded) return { text: "", acts: [0,0,0,0], conf: 0, lps: 0 };
      var t0 = Date.now(), p = core.prefixLen, i;
      var clean = String(q || "").replace(/[^\x20-\x7E]/g, "").slice(0, Math.max(16, 76 - p));
      for (i = 0; i < clean.length && p < CTX - 2; i++, p++) core.step(clean.charCodeAt(i) - 30, p);
      core.step(1, p++);
      var out = [];
      for (; p < CTX; p++) {
        var best = 0;
        for (i = 1; i < VOCAB; i++) if (core.score[i] > core.score[best]) best = i;
        var chosen = best;
        if (creat > 0) {
          var t = creat / 5, sum = 0;
          for (i = 0; i < VOCAB; i++) {
            var d = (core.score[i] - core.score[best]) / t;
            var ex = d < -60 ? 0 : Math.exp(d);
            core.bs[i] = ex < 0.15 ? 0 : ex; sum += core.bs[i];
          }
          var r = sum * Math.random();
          for (i = 0; i < VOCAB; i++) { r -= core.bs[i]; if (r < 0 && core.bs[i] > 0) { chosen = i; break; } }
        }
        var cs = 0;
        for (i = 0; i < VOCAB; i++) { var df = core.score[i] - core.score[chosen]; cs += df < -60 ? 0 : Math.exp(df); }
        core.lastConf = 1 / cs;
        if (chosen <= 1) break;
        out.push(String.fromCharCode(chosen + 30));
        core.step(chosen, p);
      }
      var sec = Math.max(0.01, (Date.now() - t0) / 1000);
      return { text: out.join(""), acts: core.layerAct.slice(0), conf: core.lastConf, lps: out.length / sec };
    };

    return core;
  }

  /* Async Web Worker Client (auto-falls back to main thread on old browsers / strict file://) */
  var EchoWorker = {
    worker: null,
    localCore: null,
    loaded: false,
    meta: null,
    reqId: 0,
    pending: Object.create(null),
    init: function () {
      if (this.worker || this.localCore) return;
      try {
        if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
          var code = "var core = (" + createTiny2Core.toString() + ")();\n" +
            "onmessage = function(e) {\n" +
            "  var m = e.data;\n" +
            "  try {\n" +
            "    if (m.cmd === 'load') postMessage({ id: m.id, ok: true, res: core.load(m.buf) });\n" +
            "    else if (m.cmd === 'pin') postMessage({ id: m.id, ok: true, res: core.pinPrefix(m.prefix) });\n" +
            "    else if (m.cmd === 'think') postMessage({ id: m.id, ok: true, res: core.think(m.q, m.creat) });\n" +
            "  } catch (err) { postMessage({ id: m.id, ok: false, err: String(err) }); }\n" +
            "};";
          var blob = new Blob([code], { type: "application/javascript" });
          this.worker = new Worker(URL.createObjectURL(blob));
          var self = this;
          this.worker.onmessage = function (ev) {
            var cb = self.pending[ev.data.id];
            delete self.pending[ev.data.id];
            if (cb) cb(ev.data.ok ? null : new Error(ev.data.err), ev.data.res);
          };
          return;
        }
      } catch (e) {}
      this.localCore = createTiny2Core();
    },
    _call: function (msg, cb) {
      this.init();
      if (this.worker) {
        var id = ++this.reqId;
        msg.id = id;
        this.pending[id] = cb;
        this.worker.postMessage(msg);
      } else {
        var self = this;
        setTimeout(function () {
          try {
            var res = msg.cmd === "load" ? self.localCore.load(msg.buf)
                    : msg.cmd === "pin"  ? self.localCore.pinPrefix(msg.prefix)
                    : self.localCore.think(msg.q, msg.creat);
            cb(null, res);
          } catch (err) { cb(err); }
        }, 0);
      }
    },
    loadBin: function (name, arrayBuf, cb) {
      var self = this;
      EvelynDB.put("weights", name, arrayBuf);
      this._call({ cmd: "load", buf: arrayBuf.slice(0) }, function (err, info) {
        if (!err) { self.loaded = true; self.meta = info; }
        if (cb) cb(err, info);
      });
    },
    pinPrefix: function (prefix, cb) {
      if (!this.loaded) { if (cb) cb(null, 0); return; }
      this._call({ cmd: "pin", prefix: prefix }, cb || function () {});
    },
    think: function (q, creat, cb) {
      if (!this.loaded) { cb(null, { text: "", acts: [0,0,0,0], conf: 0, lps: 0 }); return; }
      this._call({ cmd: "think", q: q, creat: creat || 0 }, cb);
    },
    /* Prompt-lookup fact verifier: rejects numbers not present in retrieved shelf fact */
    verifyAgainstShelf: function (nnText, shelfFact) {
      if (!nnText) return { ok: false, text: "" };
      if (!shelfFact) return { ok: true, text: nnText };
      var nums = nnText.match(/\d+(?:\.\d+)?/g) || [];
      for (var i = 0; i < nums.length; i++) {
        if (shelfFact.indexOf(nums[i]) < 0) return { ok: false, text: "" };
      }
      return { ok: true, text: nnText };
    }
  };

  /* =========================================================================
     6. SM-2 LITE SPACED REPETITION + ROLLING-WINDOW ADAPTIVE PACER
     ========================================================================= */
  var Scheduler = {
    record: function (profile, itemId, correct) {
      if (!profile.sr) profile.sr = {};
      var rec = profile.sr[itemId] || { ease: 2.3, days: 1, due: 0, reps: 0 };
      var now = Date.now();
      if (correct) {
        rec.reps += 1;
        rec.days = rec.reps === 1 ? 1 : rec.reps === 2 ? 3 : Math.round(rec.days * rec.ease);
        rec.ease = Math.min(2.8, rec.ease + 0.1);
      } else {
        rec.reps = 0;
        rec.days = 0.25; // Review again in 6 hours
        rec.ease = Math.max(1.4, rec.ease - 0.2);
      }
      rec.due = now + rec.days * 86400000;
      profile.sr[itemId] = rec;

      /* Rolling window of last 8 results for adaptive difficulty */
      if (!profile.recent8) profile.recent8 = [];
      profile.recent8.push(correct ? 1 : 0);
      if (profile.recent8.length > 8) profile.recent8.shift();
    },
    dueIds: function (profile) {
      var out = [], now = Date.now(), sr = profile.sr || {};
      for (var id in sr) { if (sr[id].due <= now) out.push(id); }
      return out;
    },
    adaptiveSpeed: function (profile) {
      var r = profile.recent8 || [];
      if (r.length < 4) return 1.0;
      var sum = 0; for (var i = 0; i < r.length; i++) sum += r[i];
      var acc = sum / r.length;
      if (acc >= 0.85) return 1.25;
      if (acc <= 0.55) return 0.72;
      return 1.0;
    }
  };

  /* =========================================================================
     7. PLUGGABLE VOICE RACK (TINY.C FORMANT ROBOT + OS SPEECH + CUSTOM WASM)
     ========================================================================= */
  var AudioFX = {
    soundOn: true,
    voiceMode: "robot", // robot | speech | custom | off
    customVoice: null,
    ctx: null,
    registerVoice: function (fn) { this.customVoice = fn; this.voiceMode = "custom"; },
    ensure: function () {
      if (!this.soundOn) return null;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    },
    tone: function (hz, ms, type, vol) {
      var ctx = this.ensure(); if (!ctx || !hz) return;
      var osc = ctx.createOscillator(), g = ctx.createGain(), now = ctx.currentTime;
      osc.type = type || "square"; osc.frequency.value = hz;
      g.gain.setValueAtTime(vol || 0.035, now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + ms / 1000);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + ms / 1000 + 0.01);
    },
    ok: function () { this.tone(880, 50); setTimeout(function () { AudioFX.tone(1320, 85); }, 55); },
    bad: function () { this.tone(185, 130, "sawtooth", 0.045); },
    shoot: function () { this.tone(1480, 30, "square", 0.03); },
    speak: function (txt) {
      if (!this.soundOn || this.voiceMode === "off") return;
      if (this.voiceMode === "custom" && this.customVoice) { this.customVoice(txt); return; }
      if (this.voiceMode === "speech" && root.speechSynthesis) {
        try { root.speechSynthesis.cancel(); root.speechSynthesis.speak(new SpeechSynthesisUtterance(txt)); return; } catch (e) {}
      }
      var ctx = this.ensure(); if (!ctx) return;
      var s = String(txt || "").toLowerCase().slice(0, 26), t = ctx.currentTime + 0.01;
      for (var i = 0; i < s.length; i++) {
        var ch = s[i], sh = (115 - 30 * i / (s.length + 1)) / 100, f = 0, dur = 0.038;
        if (ch === "a") f = 860 * sh; else if (ch === "e") f = 1120 * sh;
        else if (ch === "i" || ch === "y") f = 1380 * sh; else if (ch === "o") f = 680 * sh;
        else if (ch === "u") f = 550 * sh; else if ("szcxfhvj".indexOf(ch) >= 0) { f = 2700 + (i % 4) * 300; dur = 0.028; }
        else if ("ptkq".indexOf(ch) >= 0) { f = 3100; dur = 0.014; }
        else if (ch >= "a" && ch <= "z") f = 340 * sh;
        if (f > 0) {
          var osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = "square"; osc.frequency.setValueAtTime(f, t);
          g.gain.setValueAtTime(0.022, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
          osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + dur + 0.005);
        }
        t += dur + 0.011;
      }
    }
  };

  /* =========================================================================
     8. .EVELYNPACK SNEAKER-NET / 56K BUNDLE EXPORTER & IMPORTER
     ========================================================================= */
  var PackCodec = {
    exportPack: function (carts, shelfRows, meta) {
      var json = JSON.stringify({ magic: "EVPK1", meta: meta || {}, cartridges: carts || [], shelves: shelfRows || [] });
      return "EVPK1:" + LZ.compress(json);
    },
    importPack: function (packedStr) {
      if (String(packedStr || "").indexOf("EVPK1:") !== 0) throw new Error("Not an EVPK1 .evelynpack file.");
      return JSON.parse(LZ.decompress(packedStr.slice(6)));
    }
  };

  root.EvelynBackend = {
    createRng: createRng,
    LZ: LZ,
    EvelynDB: EvelynDB,
    ShelfLibrary: ShelfLibrary,
    EchoWorker: EchoWorker,
    Scheduler: Scheduler,
    AudioFX: AudioFX,
    PackCodec: PackCodec
  };
})(typeof window !== "undefined" ? window : global);
