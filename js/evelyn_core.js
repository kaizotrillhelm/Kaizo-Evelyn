/* evelyn_core.js - Evelyn and her Echoes, JavaScript edition.

   Offline knowledge library, TNY2 neural engine with KV21 cache sharing,
   learner profile, text adventure, coding sandbox, multi-shelf deliberation
   and the low-bandwidth packet codecs. Plain ES5, no dependencies.
   Runs from file:// in a browser or under Node (require("./evelyn_core.js")).

   This file is the reference implementation. The C and BASIC editions are
   checked against it by tests/run_conformance.js. */

(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var VOCAB = 97;
  var CTX = 128;

  /* ======================================================================
     0. TEXT AND NUMBER HELPERS (the C and BASIC editions repeat these rules)
     ====================================================================== */

  /* Number to text: whole numbers print whole; others print up to six
     decimals with trailing zeros removed. Meant for |x| below 1e9. */
  function fmtNum(x) {
    if (x !== x) return "NaN";
    if (x === Infinity) return "Infinity";
    if (x === -Infinity) return "-Infinity";
    var neg = x < 0, a = neg ? -x : x;
    var s;
    if (Math.floor(a) === a && a < 1e15) {
      s = String(a);
    } else {
      var scaled = Math.floor(a * 1e6 + 0.5);
      var ip = Math.floor(scaled / 1e6);
      var fp = scaled - ip * 1e6;
      s = String(ip);
      if (fp > 0) {
        var f = String(fp);
        while (f.length < 6) f = "0" + f;
        f = f.replace(/0+$/, "");
        s += "." + f;
      }
    }
    if (s === "0") return "0";
    return neg ? "-" + s : s;
  }

  /* Text to number: optional spaces, optional sign, digits with an optional
     fraction. Anything after that is ignored. No digits gives 0. */
  function valOf(s) {
    var m = /^ *([+-]?)(\d+(?:\.\d+)?|\.\d+)/.exec(String(s));
    if (!m) return 0;
    var v = parseFloat(m[2]);
    return m[1] === "-" ? -v : v;
  }

  function cleanAscii(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/[^\x20-\x7E\n]/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/^[ \n]+|[ \n]+$/g, "");
  }

  var STOP_WORDS = Object.create(null);
  (function () {
    var list = "a an the is are was were of in on to for and or it its what which who where when how do does did can you me tell about".split(" ");
    for (var i = 0; i < list.length; i++) STOP_WORDS[list[i]] = true;
  })();

  function tokenizeWords(text) {
    var m = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    var out = [];
    for (var i = 0; i < m.length; i++) {
      if (!STOP_WORDS[m[i]]) out.push(m[i]);
    }
    return out;
  }

  /* xorshift32: the same generator in every edition, so sampling can be tested */
  function XorShift32(seed) {
    this.state = (seed === undefined ? 2463534242 : seed) >>> 0;
    if (this.state === 0) this.state = 2463534242;
  }
  XorShift32.prototype.next = function () {
    var x = this.state;
    x ^= (x << 13) >>> 0; x >>>= 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0; x >>>= 0;
    this.state = x;
    return x / 4294967296;
  };

  /* ======================================================================
     1. STORAGE: browser localStorage, a folder under Node, or memory
     ====================================================================== */
  var Storage = {
    mem: Object.create(null),
    backend: null,
    getItem: function (key) {
      try {
        if (this.backend) return this.backend.getItem(key);
        if (typeof window !== "undefined" && window.localStorage) return window.localStorage.getItem(key);
      } catch (e) {}
      return Object.prototype.hasOwnProperty.call(this.mem, key) ? this.mem[key] : null;
    },
    setItem: function (key, value) {
      try {
        if (this.backend) { this.backend.setItem(key, value); return; }
        if (typeof window !== "undefined" && window.localStorage) { window.localStorage.setItem(key, value); return; }
      } catch (e) {}
      this.mem[key] = String(value);
    },
    clear: function () { this.mem = Object.create(null); },
    /* Node only: keep every key as a file in dir */
    useDirectory: function (dir) {
      var fs = require("fs"), path = require("path");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      function file(key) { return path.join(dir, String(key).replace(/[^A-Za-z0-9_.-]/g, "_") + ".json"); }
      this.backend = {
        getItem: function (key) { var f = file(key); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null; },
        setItem: function (key, value) { fs.writeFileSync(file(key), String(value)); }
      };
    }
  };

  /* ======================================================================
     2. LZW COMPRESSOR (16-bit codes, little endian) AND BASE64
     ====================================================================== */
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /* The compressor looks a (prefix code, next character) pair up in a chained hash table:
     4096 buckets of 16-bit heads (8 KB), the hash is shifts and xors (no multiply), and the
     chain arrays are touched only up to the codes that were made. The scratch tables are
     made on first use and cleared by walking the buckets that were touched, so a short fact
     costs a few hundred operations and no allocation of a dictionary. Output is identical,
     byte for byte, to the older string-keyed dictionary (js/test/legacy keeps that version
     and the tests compare the two). */
  var LZ_BUCKETS = 4096, LZ_MASK = LZ_BUCKETS - 1;
  var lzHead = null, lzNext = null, lzPref = null, lzChar = null, lzTouched = null, lzOut = null;

  function lzScratch(need) {
    if (!lzHead) {
      lzHead = new Uint16Array(LZ_BUCKETS);
      lzTouched = new Uint16Array(LZ_BUCKETS);
      lzNext = new Uint16Array(65536);
      lzPref = new Uint16Array(65536);
      lzChar = new Uint8Array(65536);
      lzOut = new Uint8Array(512);
    }
    if (lzOut.length < need) {
      var n = lzOut.length;
      while (n < need) n *= 2;
      lzOut = new Uint8Array(n);
    }
  }

  var B64_REV = new Int8Array(128), B64_CODES = new Array(64);
  (function () {
    var i;
    for (i = 0; i < 128; i++) B64_REV[i] = -1;
    for (i = 0; i < 64; i++) { B64_REV[B64.charCodeAt(i)] = i; B64_CODES[i] = B64.charCodeAt(i); }
  })();
  function b64Val(code) { return code < 128 ? B64_REV[code] : -1; }

  var LZCodec = {
    MAX_CODE: 65535,

    compress: function (str) {
      str = String(str === undefined || str === null ? "" : str);
      var len = str.length;
      if (!len) return new Uint8Array(0);
      lzScratch(len * 2);
      var out = lzOut, outPos = 0, head = lzHead, nxt = lzNext, pref = lzPref, chr = lzChar, touched = lzTouched;
      var nextCode = 256, nTouched = 0, i, ch, c, h, code;
      ch = str.charCodeAt(0);
      var w = ch > 255 ? 63 : ch;
      for (i = 1; i < len; i++) {
        ch = str.charCodeAt(i);
        c = ch > 255 ? 63 : ch;
        h = ((w << 4) ^ (w >>> 4) ^ (c << 3) ^ c) & LZ_MASK;
        code = head[h];
        while (code !== 0) {
          if (pref[code] === w && chr[code] === c) break;
          code = nxt[code];
        }
        if (code !== 0) {
          w = code;
        } else {
          out[outPos++] = w & 255;
          out[outPos++] = (w >> 8) & 255;
          if (nextCode < LZCodec.MAX_CODE) {
            if (head[h] === 0) touched[nTouched++] = h;
            pref[nextCode] = w;
            chr[nextCode] = c;
            nxt[nextCode] = head[h];
            head[h] = nextCode;
            nextCode++;
          }
          w = c;
        }
      }
      out[outPos++] = w & 255;
      out[outPos++] = (w >> 8) & 255;
      for (i = 0; i < nTouched; i++) head[touched[i]] = 0;
      var result = new Uint8Array(outPos);
      result.set(out.subarray(0, outPos));
      return result;
    },

    decompress: function (bytes) {
      if (!bytes || bytes.length === 0) return "";
      var n = bytes.length;
      if (n % 2 !== 0) throw new Error("Corrupt LZW stream: odd length");
      var dict = [], i;
      for (i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);
      var first = bytes[0] | (bytes[1] << 8);
      if (first > 255) throw new Error("Corrupt LZW stream at code " + first);
      var w = dict[first], result = [w], nextCode = 256;
      for (i = 2; i < n; i += 2) {
        var k = bytes[i] | (bytes[i + 1] << 8), entry;
        if (k < nextCode && dict[k] !== undefined) entry = dict[k];
        else if (k === nextCode) entry = w + w.charAt(0);
        else throw new Error("Corrupt LZW stream at code " + k);
        result.push(entry);
        if (nextCode < LZCodec.MAX_CODE) dict[nextCode++] = w + entry.charAt(0);
        w = entry;
      }
      return result.join("");
    },

    toBase64: function (bytes) {
      var n = bytes.length, parts = [], buf = [], i;
      for (i = 0; i < n; i += 3) {
        var b0 = bytes[i];
        var b1 = i + 1 < n ? bytes[i + 1] : 0;
        var b2 = i + 2 < n ? bytes[i + 2] : 0;
        var trip = (b0 << 16) | (b1 << 8) | b2;
        buf.push(B64_CODES[(trip >> 18) & 63], B64_CODES[(trip >> 12) & 63],
          i + 1 < n ? B64_CODES[(trip >> 6) & 63] : 61, i + 2 < n ? B64_CODES[trip & 63] : 61);
        if (buf.length >= 4096) { parts.push(String.fromCharCode.apply(null, buf)); buf = []; }
      }
      if (buf.length) parts.push(String.fromCharCode.apply(null, buf));
      return parts.join("");
    },

    fromBase64: function (b64) {
      var s = String(b64), len = s.length;
      while (len > 0 && s.charCodeAt(len - 1) === 61) len--;
      var rem = len & 3;
      var out = new Uint8Array((len >> 2) * 3 + (rem === 0 ? 0 : (rem === 1 ? 1 : rem - 1))), o = 0;
      for (var i = 0; i < len; i += 4) {
        var c0 = b64Val(s.charCodeAt(i));
        var c1 = i + 1 < len ? b64Val(s.charCodeAt(i + 1)) : 0;
        var c2 = i + 2 < len ? b64Val(s.charCodeAt(i + 2)) : 0;
        var c3 = i + 3 < len ? b64Val(s.charCodeAt(i + 3)) : 0;
        var trip = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
        out[o++] = (trip >> 16) & 255;
        if (i + 2 < len) out[o++] = (trip >> 8) & 255;
        if (i + 3 < len) out[o++] = trip & 255;
      }
      return out;
    }
  };

  /* ======================================================================
     3. PERMANENT COMPRESSED KNOWLEDGE LIBRARY
     ====================================================================== */
  var STARTER_FACTS = [
    { topic: "water purification", cat: "survival", fact: "Boiling water for 1 minute kills bacteria and parasites. Solar disinfection (SODIS) uses clear plastic bottles in direct sun for 6 hours.", ex: "Pour muddy water through cloth first, then boil or sun-clear it." },
    { topic: "oral rehydration", cat: "health", fact: "Oral rehydration solution replaces lost water and salts during dehydration.", ex: "Mix 6 level teaspoons sugar + 1/2 teaspoon salt in 1 liter of clean water." },
    { topic: "solar energy", cat: "science", fact: "Solar panels turn sunlight directly into electricity using silicon cells; mirrors can concentrate heat for cooking.", ex: "A foil-lined cardboard box traps sun heat to bake or warm water." },
    { topic: "photosynthesis", cat: "science", fact: "Plants use sunlight, water, and carbon dioxide to make sugar and release oxygen.", ex: "Leaves are green because chlorophyll absorbs red and blue light." },
    { topic: "gravity", cat: "science", fact: "Gravity pulls objects with mass toward each other; Earth's gravity accelerates falling objects at about 9.8 m/s^2.", ex: "Drop a pebble and a crumpled paper together: both hit at nearly the same time." },
    { topic: "fractions", cat: "math", fact: "A fraction a/b shows 'a' equal parts out of 'b' total parts in a whole.", ex: "Sharing 3 loaves of bread among 4 people gives each person 3/4 of a loaf." },
    { topic: "pythagorean theorem", cat: "math", fact: "In a right triangle, a^2 + b^2 = c^2 where c is the longest side.", ex: "A 3-4-5 rope triangle makes a perfect 90-degree corner for building walls." },
    { topic: "loops in coding", cat: "coding", fact: "A loop repeats a block of instructions without rewriting the same lines over and over.", ex: "REPEAT 4: MOVE 3, TURN RIGHT draws a square in 3 lines instead of 8." },
    { topic: "variables in coding", cat: "coding", fact: "A variable is a named box in memory that holds a number or word that can change.", ex: "LET water = 10; LET water = water - 2 leaves 8." },
    { topic: "conditionals in coding", cat: "coding", fact: "An IF statement checks a rule and only runs code when that rule is true.", ex: "IF temp > 100 THEN PRINT \"BOILING\" decides what action to take." },
    { topic: "compass navigation", cat: "geography", fact: "The sun rises in the east and sets in the west; at solar noon in the northern hemisphere, shadows point north.", ex: "Put a stick in the ground, mark the shadow tip, wait 15 minutes, mark again: the line runs West-to-East." },
    { topic: "binary numbers", cat: "coding", fact: "Computers represent every letter, number, and sound using just two states: 0 and 1 (bits).", ex: "In binary, 5 is 101 because (1*4) + (0*2) + (1*1) = 5." },
    { topic: "estonia", cat: "geography", fact: "Estonia is in Northern Europe by the Baltic Sea; its capital is Tallinn.", ex: "Estonia borders Latvia to the south and Russia to the east." },
    { topic: "peru", cat: "geography", fact: "Peru is in South America along the Andes mountains; its capital is Lima and people speak Spanish.", ex: "Ancient Incas built stone terraces in Peru to farm steep mountain slopes." },
    { topic: "mars", cat: "space", fact: "Mars is the 4th planet from the Sun; iron oxide dust gives it a rusty red color.", ex: "A year on Mars takes 687 Earth days because it orbits farther from the Sun." },
    { topic: "whale", cat: "animals", fact: "A whale is a warm-blooded mammal, not a fish; it breathes air through lungs.", ex: "Whales must swim up to the ocean surface to breathe through a blowhole." }
  ];

  function LibraryStore(storageKey) {
    this.storageKey = storageKey || "evelyn_library_v1";
    this.records = [];
    this.invIndex = Object.create(null);
  }

  LibraryStore.prototype._index = function (id, topic, fact) {
    var words = tokenizeWords(topic + " " + fact), seen = Object.create(null);
    for (var i = 0; i < words.length; i++) {
      if (seen[words[i]]) continue;
      seen[words[i]] = true;
      if (!this.invIndex[words[i]]) this.invIndex[words[i]] = [];
      this.invIndex[words[i]].push(id);
    }
  };

  LibraryStore.prototype.clear = function () {
    this.records = [];
    this.invIndex = Object.create(null);
  };

  LibraryStore.prototype.addEntry = function (topic, cat, fact, ex) {
    var id = this.records.length;
    var cleanT = cleanAscii(topic), cleanF = cleanAscii(fact), cleanE = cleanAscii(ex || "");
    this.records.push({
      id: id,
      topic: cleanT,
      cat: cleanAscii(cat || "general"),
      zFact: LZCodec.toBase64(LZCodec.compress(cleanF)),
      zEx: cleanE ? LZCodec.toBase64(LZCodec.compress(cleanE)) : ""
    });
    this._index(id, cleanT, cleanF);
    return id;
  };

  LibraryStore.prototype.loadStarterPack = function () {
    for (var i = 0; i < STARTER_FACTS.length; i++) {
      var f = STARTER_FACTS[i];
      this.addEntry(f.topic, f.cat, f.fact, f.ex);
    }
  };

  LibraryStore.prototype.ingestPlainText = function (rawText, sourceLabel) {
    var txt = cleanAscii(rawText);
    var paras = txt.split(/\n\s*\n/);
    var count = 0;
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i].replace(/\n+/g, " ").replace(/^ +| +$/g, "");
      if (p.length < 25) continue;
      var topic = p.split(/ +/).slice(0, 3).join(" ");
      for (var off = 0; off < p.length; off += 140) {
        var chunk = p.slice(off, off + 170).replace(/^ +| +$/g, "");
        if (chunk.length >= 20) {
          this.addEntry(topic, sourceLabel || "imported", chunk, "");
          count++;
        }
      }
    }
    this.save();
    return count;
  };

  LibraryStore.prototype.readRecord = function (rec) {
    return {
      id: rec.id,
      topic: rec.topic,
      cat: rec.cat,
      fact: LZCodec.decompress(LZCodec.fromBase64(rec.zFact)),
      ex: rec.zEx ? LZCodec.decompress(LZCodec.fromBase64(rec.zEx)) : ""
    };
  };

  /* Ranked by score, then by lower id. A query word that sits in the topic
     scores 3, a word found only in the fact scores 1. */
  /* The lower-cased topic of a record is made once and kept beside the records (not in them, so
     nothing extra is saved to disk). A record that was replaced gets a new entry. */
  LibraryStore.prototype._topicLower = function (id) {
    var rec = this.records[id], c = this._tl ? this._tl[id] : undefined;
    if (!this._tl) this._tl = [];
    if (!c || c.r !== rec) c = this._tl[id] = { r: rec, t: rec.topic.toLowerCase() };
    return c.t;
  };

  LibraryStore.prototype.search = function (query, topK) {
    topK = topK || 2;
    var qWords = tokenizeWords(query);
    if (qWords.length === 0) return [];
    var n = this.records.length, i, j, id;
    if (!this._sc || this._sc.length < n) this._sc = new Int32Array(n + 64);
    var scores = this._sc, ids = [];
    for (i = 0; i < qWords.length; i++) {
      var w = qWords[i], list = this.invIndex[w];
      if (!list) continue;
      for (j = 0; j < list.length; j++) {
        id = list[j];
        if (scores[id] === 0) ids.push(id);
        scores[id] += this._topicLower(id).indexOf(w) >= 0 ? 3 : 1;
      }
    }
    var k = Math.min(topK, ids.length), out = [], pick, m;
    if (k <= 8) {
      /* a few best ones: k passes over the candidates, no full sort */
      for (pick = 0; pick < k; pick++) {
        var bi = pick, bid = ids[pick], bs = scores[bid];
        for (m = pick + 1; m < ids.length; m++) {
          var cid = ids[m], cs = scores[cid];
          if (cs > bs || (cs === bs && cid < bid)) { bi = m; bid = cid; bs = cs; }
        }
        if (bi !== pick) { ids[bi] = ids[pick]; ids[pick] = bid; }
      }
    } else {
      ids.sort(function (a, b) { return (scores[b] - scores[a]) || (a - b); });
    }
    for (i = 0; i < k; i++) out.push(this.readRecord(this.records[ids[i]]));
    for (i = 0; i < ids.length; i++) scores[ids[i]] = 0;
    return out;
  };

  LibraryStore.prototype.stats = function () {
    var compBytes = 0;
    for (var i = 0; i < this.records.length; i++) compBytes += this.records[i].zFact.length + this.records[i].zEx.length;
    return { entries: this.records.length, compressedChars: compBytes };
  };

  /* One record per line: topic TAB cat TAB zFact TAB zEx (the same file the C and BASIC editions use) */
  LibraryStore.prototype.toText = function () {
    var lines = [];
    for (var i = 0; i < this.records.length; i++) {
      var r = this.records[i];
      lines.push(r.topic + "\t" + r.cat + "\t" + r.zFact + "\t" + r.zEx);
    }
    return lines.join("\n") + (lines.length ? "\n" : "");
  };

  LibraryStore.prototype.fromText = function (text) {
    var lines = String(text).split(/\r?\n/), n = 0;
    this.clear();
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      var f = lines[i].split("\t");
      if (f.length < 3) continue;
      var rec = { id: this.records.length, topic: f[0], cat: f[1], zFact: f[2], zEx: f[3] || "" };
      var dec = this.readRecord(rec);
      this.records.push(rec);
      this._index(rec.id, rec.topic, dec.fact);
      n++;
    }
    return n;
  };

  LibraryStore.prototype.save = function () {
    Storage.setItem(this.storageKey, this.toText());
  };

  LibraryStore.prototype.load = function () {
    var raw = Storage.getItem(this.storageKey);
    if (!raw) return false;
    try { return this.fromText(raw) > 0; } catch (e) { return false; }
  };

  /* ======================================================================
     4. TNY2 NEURAL ENGINE (byte for byte the TINY.BIN layout) AND KV21
     ====================================================================== */
  function tny2Size(D, L, HID) {
    return 12 + (VOCAB + CTX) * (4 + D) +
      L * (4 * D + 4 * D * (4 + D) + 4 * D + HID * (4 + D) + D * (4 + HID)) + 4 * D;
  }

  function Tiny2Model() {
    this.loaded = false;
    this.D = 0; this.L = 0; this.H = 0; this.HD = 0; this.HID = 0;
    this.attDiv = 1;
    this.kvPrefixLen = 0;
    this.rng = null;
  }

  Tiny2Model.prototype._readTable = function (view, buf, off, rows, cols) {
    var scale = new Float32Array(rows), w = new Int8Array(rows * cols);
    for (var r = 0; r < rows; r++) {
      scale[r] = view.getFloat32(off.v, true);
      off.v += 4;
      w.set(new Int8Array(buf, off.v, cols), r * cols);
      off.v += cols;
    }
    return { scale: scale, w: w, rows: rows, cols: cols };
  };

  Tiny2Model.prototype._readGains = function (view, off, n) {
    var g = new Float32Array(n);
    for (var i = 0; i < n; i++) { g[i] = view.getFloat32(off.v, true); off.v += 4; }
    return g;
  };

  Tiny2Model.prototype.loadFromArrayBuffer = function (buf) {
    if (buf.byteLength < 12) throw new Error("Not a TNY2 weight file (too short)");
    var view = new DataView(buf);
    var magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== "TNY2") throw new Error("Not a TNY2 weight file (expected TINY.BIN v2)");
    var D = view.getUint16(4, true), L = view.getUint16(6, true);
    var H = view.getUint16(8, true), HID = view.getUint16(10, true);
    if (D < 1 || D > 512 || L < 1 || L > 16 || H < 1 || D % H !== 0 || HID < 1 || HID > 2048) {
      throw new Error("TNY2 header out of range");
    }
    if (buf.byteLength < tny2Size(D, L, HID)) throw new Error("TNY2 file is truncated");
    this.D = D; this.L = L; this.H = H; this.HID = HID;
    this.HD = (D / H) | 0;
    this.attDiv = Math.sqrt(this.HD);

    var off = { v: 12 };
    this.emb = this._readTable(view, buf, off, VOCAB, D);
    this.pos = this._readTable(view, buf, off, CTX, D);
    this.wq = []; this.wk = []; this.wv = []; this.wo = [];
    this.f1 = []; this.f2 = []; this.g1 = []; this.g2 = [];
    this.kc = []; this.vc = []; this.ks = []; this.vs = [];
    for (var l = 0; l < L; l++) {
      this.g1.push(this._readGains(view, off, D));
      this.wq.push(this._readTable(view, buf, off, D, D));
      this.wk.push(this._readTable(view, buf, off, D, D));
      this.wv.push(this._readTable(view, buf, off, D, D));
      this.wo.push(this._readTable(view, buf, off, D, D));
      this.g2.push(this._readGains(view, off, D));
      this.f1.push(this._readTable(view, buf, off, HID, D));
      this.f2.push(this._readTable(view, buf, off, D, HID));
      this.kc.push(new Int8Array(CTX * D));
      this.vc.push(new Int8Array(CTX * D));
      this.ks.push(new Float32Array(CTX));
      this.vs.push(new Float32Array(CTX));
    }
    this.gf = this._readGains(view, off, D);
    this.bx = new Float32Array(D); this.bh = new Float32Array(D);
    this.bq = new Float32Array(D); this.bt = new Float32Array(D);
    this.ba = new Float32Array(D); this.bm = new Float32Array(HID);
    this.bs = new Float32Array(CTX); this.score = new Float32Array(VOCAB);
    this.kvPrefixLen = 0;
    this.loaded = true;
    return { D: D, L: L, H: H, HID: HID };
  };

  Tiny2Model.prototype._matvec = function (t, x, y) {
    var rows = t.rows, cols = t.cols, w = t.w, sc = t.scale;
    for (var r = 0; r < rows; r++) {
      var s = 0.0, base = r * cols;
      for (var c = 0; c < cols; c++) s += w[base + c] * x[c];
      y[r] = s * sc[r];
    }
  };

  /* For the second feed-forward matrix, whose input has just been through the ReLU and holds
     many zeros: the columns that are not zero are picked out once (their numbers and their
     places), and every row multiplies only those. Adding w * 0 never changes a sum, so the
     result equals _matvec bit for bit. When more than half of the columns are live the plain
     loop is faster and is used. (Measured on a 96 by 256 matrix: 1.2 times faster at half
     zeros and 3.0 times at four fifths on a current JIT, and 1.7 to 3.9 times with no JIT.) */
  Tiny2Model.prototype._matvecSparse = function (t, x, y) {
    var rows = t.rows, cols = t.cols, w = t.w, sc = t.scale, c, r, k = 0;
    if (!this._nz || this._nz.length < cols) { this._nz = new Int32Array(cols); this._nzv = new Float32Array(cols); }
    var idx = this._nz, val = this._nzv;
    for (c = 0; c < cols; c++) if (x[c] !== 0) { idx[k] = c; val[k] = x[c]; k++; }
    if (k > (cols >> 1)) { this._matvec(t, x, y); return; }
    for (r = 0; r < rows; r++) {
      var s = 0.0, base = r * cols;
      for (c = 0; c < k; c++) s += w[base + idx[c]] * val[c];
      y[r] = s * sc[r];
    }
  };

  Tiny2Model.prototype._norm = function (x, g, y) {
    var D = this.D, s = 0.0, i;
    for (i = 0; i < D; i++) s += x[i] * x[i];
    var inv = 1.0 / Math.sqrt(s / D + 1e-5);
    for (i = 0; i < D; i++) y[i] = x[i] * inv * g[i];
  };

  Tiny2Model.prototype._store = function (dst, dstOff, src) {
    var D = this.D, big = 0.0, i, v;
    for (i = 0; i < D; i++) {
      v = src[i] < 0 ? -src[i] : src[i];
      if (v > big) big = v;
    }
    if (big < 1e-20) big = 1e-20;
    var k = 127.0 / big;
    for (i = 0; i < D; i++) {
      v = src[i] * k;
      dst[dstOff + i] = (v < 0 ? v - 0.5 : v + 0.5) | 0;   /* the same rounding as ceil / floor on [-127, 127] */
    }
    return big / 127.0;
  };

  /* One token at position p; leaves the next-token scores in this.score */
  Tiny2Model.prototype.step = function (tok, p) {
    if (!this.loaded) throw new Error("No TNY2 model loaded");
    if (tok < 0 || tok >= VOCAB || p < 0 || p >= CTX) throw new Error("step out of range");
    var D = this.D, L = this.L, H = this.H, HD = this.HD, HID = this.HID;
    var i, j, l, h;
    var eBase = tok * D, pBase = p * D;
    var es = this.emb.scale[tok], ps = this.pos.scale[p];
    for (i = 0; i < D; i++) this.bx[i] = this.emb.w[eBase + i] * es + this.pos.w[pBase + i] * ps;

    for (l = 0; l < L; l++) {
      this._norm(this.bx, this.g1[l], this.bh);
      this._matvec(this.wk[l], this.bh, this.bt);
      this.ks[l][p] = this._store(this.kc[l], p * D, this.bt);
      this._matvec(this.wv[l], this.bh, this.bt);
      this.vs[l][p] = this._store(this.vc[l], p * D, this.bt);
      this._matvec(this.wq[l], this.bh, this.bq);

      var kcl = this.kc[l], vcl = this.vc[l], ksl = this.ks[l], vsl = this.vs[l];
      for (h = 0; h < H; h++) {
        var hOff = h * HD, big = -1e30;
        for (j = 0; j <= p; j++) {
          var kp = j * D + hOff, s = 0.0;
          for (i = 0; i < HD; i++) s += this.bq[hOff + i] * kcl[kp + i];
          s = (s * ksl[j]) / this.attDiv;
          this.bs[j] = s;
          if (s > big) big = s;
        }
        var sum = 0.0;
        for (j = 0; j <= p; j++) {
          var diff = this.bs[j] - big;
          this.bs[j] = diff < -60 ? 0.0 : Math.exp(diff);
          sum += this.bs[j];
        }
        for (i = 0; i < HD; i++) this.ba[hOff + i] = 0.0;
        for (j = 0; j <= p; j++) {
          if (this.bs[j] === 0.0) continue;
          var vp = j * D + hOff, wgt = (this.bs[j] * vsl[j]) / sum;
          for (i = 0; i < HD; i++) this.ba[hOff + i] += wgt * vcl[vp + i];
        }
      }
      this._matvec(this.wo[l], this.ba, this.bt);
      for (i = 0; i < D; i++) this.bx[i] += this.bt[i];

      this._norm(this.bx, this.g2[l], this.bh);
      this._matvec(this.f1[l], this.bh, this.bm);
      for (i = 0; i < HID; i++) if (this.bm[i] < 0) this.bm[i] = 0;
      this._matvecSparse(this.f2[l], this.bm, this.bt);
      for (i = 0; i < D; i++) this.bx[i] += this.bt[i];
    }
    this._norm(this.bx, this.gf, this.bh);
    this._matvec(this.emb, this.bh, this.score);
  };

  /* creativity 0 takes the best token; above 0 samples from tokens near the best */
  Tiny2Model.prototype.pick = function (creativity) {
    var i, best = 0;
    for (i = 1; i < VOCAB; i++) if (this.score[i] > this.score[best]) best = i;
    if (!creativity || creativity <= 0) return best;
    var t = creativity / 5.0, sum = 0.0;
    for (i = 0; i < VOCAB; i++) {
      var d = (this.score[i] - this.score[best]) / t;
      var ex = d < -60 ? 0.0 : Math.exp(d);
      this.bs[i] = ex < 0.15 ? 0.0 : ex;
      sum += this.bs[i];
    }
    var rnd = this.rng ? this.rng.next() : Math.random();
    var r = sum * rnd;
    for (i = 0; i < VOCAB; i++) {
      r -= this.bs[i];
      if (r < 0.0 && this.bs[i] > 0.0) return i;
    }
    return best;
  };

  Tiny2Model.prototype.reset = function () { this.kvPrefixLen = 0; };

  /* Feed text as a prefix and keep it in the cache; think() then continues after it */
  Tiny2Model.prototype.prime = function (text) {
    if (!this.loaded) return 0;
    var clean = cleanAscii(text).replace(/\n/g, " ");
    var p = this.kvPrefixLen;
    for (var i = 0; i < clean.length && p < CTX - 2; i++, p++) this.step(clean.charCodeAt(i) - 30, p);
    this.kvPrefixLen = p;
    return p;
  };

  Tiny2Model.prototype.think = function (question, creativity) {
    if (!this.loaded) return "";
    var clean = cleanAscii(question).replace(/\n/g, " ");
    var p = this.kvPrefixLen;
    for (var i = 0; i < clean.length && p < CTX - 2; i++, p++) this.step(clean.charCodeAt(i) - 30, p);
    this.step(1, p++);
    var out = [];
    for (; p < CTX; p++) {
      var tok = this.pick(creativity || 0);
      if (tok <= 1) break;
      out.push(String.fromCharCode(tok + 30));
      this.step(tok, p);
    }
    return out.join("");
  };

  /* KV21: "KV21", D u16, L u16, len u16, then per layer and position:
     key scale f32, key int8[D], value scale f32, value int8[D] */
  Tiny2Model.prototype.exportKVCache = function (seqLen) {
    seqLen = Math.max(0, Math.min(seqLen | 0, CTX));
    var perToken = 4 + this.D;
    var buf = new ArrayBuffer(10 + this.L * seqLen * 2 * perToken);
    var view = new DataView(buf);
    view.setUint8(0, 75); view.setUint8(1, 86); view.setUint8(2, 50); view.setUint8(3, 49);
    view.setUint16(4, this.D, true);
    view.setUint16(6, this.L, true);
    view.setUint16(8, seqLen, true);
    var off = 10;
    for (var l = 0; l < this.L; l++) {
      for (var t = 0; t < seqLen; t++) {
        view.setFloat32(off, this.ks[l][t], true); off += 4;
        new Int8Array(buf, off, this.D).set(this.kc[l].subarray(t * this.D, (t + 1) * this.D));
        off += this.D;
        view.setFloat32(off, this.vs[l][t], true); off += 4;
        new Int8Array(buf, off, this.D).set(this.vc[l].subarray(t * this.D, (t + 1) * this.D));
        off += this.D;
      }
    }
    return new Uint8Array(buf);
  };

  Tiny2Model.prototype.importKVCache = function (u8) {
    var buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    if (buf.byteLength < 10) throw new Error("KV cache too short");
    var view = new DataView(buf);
    if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== "KV21") {
      throw new Error("Not a KV21 file");
    }
    var d = view.getUint16(4, true), l = view.getUint16(6, true), len = view.getUint16(8, true);
    if (d !== this.D || l !== this.L) throw new Error("KV cache dimensions mismatch");
    if (len > CTX) throw new Error("KV cache longer than the context");
    if (buf.byteLength < 10 + l * len * 2 * (4 + d)) throw new Error("KV cache is truncated");
    var off = 10;
    for (var layer = 0; layer < this.L; layer++) {
      for (var t = 0; t < len; t++) {
        this.ks[layer][t] = view.getFloat32(off, true); off += 4;
        this.kc[layer].set(new Int8Array(buf, off, this.D), t * this.D); off += this.D;
        this.vs[layer][t] = view.getFloat32(off, true); off += 4;
        this.vc[layer].set(new Int8Array(buf, off, this.D), t * this.D); off += this.D;
      }
    }
    this.kvPrefixLen = len;
    return len;
  };

  /* ======================================================================
     5. LEARNER PROFILE (R read, A audio, D do, M mix)
     ====================================================================== */
  function listText(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(String(arr[i]).replace(/[|\r\n]/g, " "));
    return out.join("|");
  }
  function textList(s) { return s ? s.split("|") : []; }

  function ProfileManager(storageKey) {
    this.storageKey = storageKey || "evelyn_profile_v1";
    this.reset();
  }

  ProfileManager.prototype.reset = function () {
    this.profile = {
      name: "Explorer",
      mode: "M",
      pace: "normal",
      xp: 0,
      masteredTopics: [],
      modeFeedback: { R: 0, A: 0, D: 0, M: 0 },
      adventureState: { room: "camp", inventory: [], solved: [] },
      recentQueries: []
    };
  };

  /* USER.CFG: KEY=value lines; lists are joined with | */
  ProfileManager.prototype.toCfg = function () {
    var p = this.profile, f = p.modeFeedback;
    return [
      "NAME=" + String(p.name).replace(/[\r\n]/g, " "),
      "MODE=" + p.mode,
      "PACE=" + String(p.pace).replace(/[\r\n]/g, " "),
      "XP=" + p.xp,
      "FB=" + f.R + "," + f.A + "," + f.D + "," + f.M,
      "ROOM=" + p.adventureState.room,
      "SOLVED=" + listText(p.adventureState.solved),
      "INV=" + listText(p.adventureState.inventory),
      "MASTERED=" + listText(p.masteredTopics),
      "RECENT=" + listText(p.recentQueries)
    ].join("\n") + "\n";
  };

  ProfileManager.prototype.fromCfg = function (text) {
    this.reset();
    var p = this.profile, lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var eq = lines[i].indexOf("=");
      if (eq < 1) continue;
      var k = lines[i].slice(0, eq), v = lines[i].slice(eq + 1);
      if (k === "NAME") p.name = v || "Explorer";
      else if (k === "MODE") { if ("RADM".indexOf(v.charAt(0)) >= 0 && v) p.mode = v.charAt(0); }
      else if (k === "PACE") p.pace = v || "normal";
      else if (k === "XP") p.xp = Math.floor(valOf(v));
      else if (k === "FB") {
        var f = v.split(",");
        p.modeFeedback = { R: Math.floor(valOf(f[0])), A: Math.floor(valOf(f[1])), D: Math.floor(valOf(f[2])), M: Math.floor(valOf(f[3])) };
      }
      else if (k === "ROOM") p.adventureState.room = v || "camp";
      else if (k === "SOLVED") p.adventureState.solved = textList(v);
      else if (k === "INV") p.adventureState.inventory = textList(v);
      else if (k === "MASTERED") p.masteredTopics = textList(v);
      else if (k === "RECENT") p.recentQueries = textList(v);
    }
  };

  ProfileManager.prototype.load = function () {
    var raw = Storage.getItem(this.storageKey);
    if (raw) this.fromCfg(raw);
  };

  ProfileManager.prototype.save = function () {
    Storage.setItem(this.storageKey, this.toCfg());
  };

  ProfileManager.prototype.setMode = function (m) {
    var code = String(m || "M").toUpperCase().charAt(0);
    if ("RADM".indexOf(code) >= 0) { this.profile.mode = code; this.save(); }
    return this.profile.mode;
  };

  ProfileManager.prototype.recordSuccess = function (topic, bonusXp) {
    this.profile.xp += bonusXp === undefined ? 10 : bonusXp;
    this.profile.modeFeedback[this.profile.mode] += 1;
    if (topic && this.profile.masteredTopics.indexOf(topic) < 0) this.profile.masteredTopics.push(topic);
    this.save();
  };

  /* The mode with the highest count wins (R, A, D, M order on a tie); with no counts the current mode stays */
  ProfileManager.prototype.bestLearnedMode = function () {
    var modes = ["R", "A", "D", "M"], best = this.profile.mode, bestScore = 0;
    for (var i = 0; i < modes.length; i++) {
      var sc = this.profile.modeFeedback[modes[i]] || 0;
      if (sc > bestScore) { bestScore = sc; best = modes[i]; }
    }
    return best;
  };

  /* ======================================================================
     6. AUDIO: offline speech, with a PC-speaker style tone fallback
     ====================================================================== */
  var AudioDriver = {
    ctx: null,
    lastSpoken: "",
    /* What the tone fallback plays for a text: up to 14 notes, 45 ms apart */
    chirpPlan: function (text) {
      var n = Math.min(String(text).length, 14), plan = [];
      for (var i = 0; i < n; i++) {
        var c = String(text).charCodeAt(i);
        plan.push({ freq: c === 32 ? 0 : 280 + (c % 24) * 35, startMs: i * 45, durMs: 42 });
      }
      return plan;
    },
    speak: function (text, mode) {
      if (mode === "R" || mode === "D") return;
      this.lastSpoken = text;
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
          var utter = new SpeechSynthesisUtterance(text);
          utter.rate = 0.95;
          window.speechSynthesis.speak(utter);
          return;
        } catch (e) {}
      }
      this.playRetroChirp(text);
    },
    playRetroChirp: function (text) {
      if (typeof window === "undefined") return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC();
      var now = this.ctx.currentTime, plan = this.chirpPlan(text);
      for (var i = 0; i < plan.length; i++) {
        var osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        var t0 = now + plan[i].startMs / 1000, t1 = t0 + plan[i].durMs / 1000;
        osc.type = "square";
        osc.frequency.value = plan[i].freq;
        gain.gain.setValueAtTime(0.03, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t1 - 0.002);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t0);
        osc.stop(t1);
      }
    }
  };

  /* ======================================================================
     7. CODING SANDBOX (LET PRINT CLEAR MOVE TURN REPEAT/END IF..THEN)
     ====================================================================== */
  var CODING_LESSONS = [
    { id: 1, title: "Hello Desert", goal: "Print your message with PRINT \"HELLO\"", starter: "PRINT \"HELLO OASIS\"" },
    { id: 2, title: "Variables & Math", goal: "Store 6 in LET a and 7 in LET b, then PRINT a * b", starter: "LET a = 6\nLET b = 7\nPRINT a * b" },
    { id: 3, title: "Draw a Square (Loops)", goal: "Use REPEAT 4 ... END with MOVE 3 and TURN RIGHT", starter: "CLEAR\nREPEAT 4\n  MOVE 3\n  TURN RIGHT\nEND" },
    { id: 4, title: "Smart Decision (IF)", goal: "Check IF water < 5 THEN PRINT \"FIND WELL\"", starter: "LET water = 3\nIF water < 5 THEN PRINT \"FIND WELL\"" }
  ];

  function isStr(v) { return typeof v === "string"; }
  function toNum(v) { return isStr(v) ? valOf(v) : v; }
  function toTxt(v) { return isStr(v) ? v : fmtNum(v); }
  function isTrue(v) { return isStr(v) ? v.length > 0 : v !== 0; }

  /* Expression parser. The cursor lives in module variables (the parser is not re-entered), so
     an expression costs no closures. Tokens of an expression text are cached: names are made
     upper case once, when the text is first seen. */
  var EXPR_RE = /"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<=|>=|==|!=|[+\-*\/%()<>=]/g;
  var exprCache = Object.create(null), exprCacheN = 0;
  var pT = [], pI = 0, pV = null;

  function tokenize(expr) {
    var key = String(expr), hit = exprCache[key];
    if (hit) return hit;
    var toks = key.match(EXPR_RE) || [];
    for (var i = 0; i < toks.length; i++) {
      var c0 = toks[i].charCodeAt(0);
      if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95) toks[i] = toks[i].toUpperCase();
    }
    if (exprCacheN >= 512) { exprCache = Object.create(null); exprCacheN = 0; }
    exprCache[key] = toks; exprCacheN++;
    return toks;
  }

  function pFactor() {
    var t = pT[pI++];
    if (t === undefined) return 0;
    if (t === "(") {
      var v = pCmp();
      if (pT[pI] === ")") pI++;
      return v;
    }
    if (t === "-") return -toNum(pFactor());
    var c0 = t.charCodeAt(0);
    if (c0 === 34) return t.slice(1, -1);
    if (c0 >= 48 && c0 <= 57) return parseFloat(t);
    return Object.prototype.hasOwnProperty.call(pV, t) ? pV[t] : 0;
  }
  function pMul() {
    var val = pFactor(), op;
    while ((op = pT[pI]) === "*" || op === "/" || op === "%") {
      pI++;
      var r = toNum(pFactor()), l = toNum(val);
      if (op === "*") val = l * r;
      else if (op === "/") val = r === 0 ? 0 : l / r;
      else val = r === 0 ? 0 : l % r;
    }
    return val;
  }
  function pAdd() {
    var val = pMul(), op;
    while ((op = pT[pI]) === "+" || op === "-") {
      pI++;
      var r = pMul();
      if (op === "+") val = (isStr(val) || isStr(r)) ? toTxt(val) + toTxt(r) : val + r;
      else val = toNum(val) - toNum(r);
    }
    return val;
  }
  function pCmp() {
    var left = pAdd(), op = pT[pI];
    if (op === "<" || op === ">" || op === "<=" || op === ">=" || op === "==" || op === "!=" || op === "=") {
      pI++;
      var right = pAdd(), c;
      if (isStr(left) && isStr(right)) c = left < right ? -1 : (left > right ? 1 : 0);
      else { var a = toNum(left), b = toNum(right); c = a < b ? -1 : (a > b ? 1 : 0); }
      if (op === "<") return c < 0 ? 1 : 0;
      if (op === ">") return c > 0 ? 1 : 0;
      if (op === "<=") return c <= 0 ? 1 : 0;
      if (op === ">=") return c >= 0 ? 1 : 0;
      if (op === "!=") return c !== 0 ? 1 : 0;
      return c === 0 ? 1 : 0;
    }
    return left;
  }

  function trimBoth(s) { return s.replace(/^\s+|\s+$/g, ""); }

  /* What a command line means, worked out the first time the line is run (so an error in a
     line that is never reached is never reported, as before). raw and upper are the trimmed
     text and its upper-case form; n is the line number for messages. */
  function planCommand(raw, upper, n) {
    if (upper.indexOf("LET ") === 0) {
      var eq = raw.indexOf("=");
      if (eq < 0) return { op: "ERR", msg: "Line " + n + ": LET needs '='" };
      var vname = trimBoth(raw.slice(4, eq));
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(vname)) return { op: "ERR", msg: "Line " + n + ": bad variable name '" + vname + "'" };
      return { op: "LET", name: vname.toUpperCase(), expr: raw.slice(eq + 1) };
    }
    if (upper.indexOf("PRINT ") === 0) return { op: "PRINT", expr: raw.slice(6) };
    if (upper === "CLEAR") return { op: "CLEAR" };
    if (upper.indexOf("MOVE ") === 0) return { op: "MOVE", expr: raw.slice(5) };
    if (upper.indexOf("TURN ") === 0) return { op: "TURN", left: trimBoth(upper.slice(5)) === "LEFT" };
    if (upper.indexOf("REPEAT ") === 0) return { op: "REPEAT", expr: raw.slice(7) };
    if (upper === "END") return { op: "END" };
    return { op: "ERR", msg: "Line " + n + ": Unknown command '" + raw + "'" };
  }

  var CodeSandbox = {
    toNum: toNum,
    toTxt: toTxt,

    /* Expression grammar: comparison > + - > * / % > unary minus > ( ) "text" number name.
       Names are not case sensitive. Dividing or taking a remainder by 0 gives 0. */
    evalExpr: function (expr, vars) {
      pT = tokenize(expr); pI = 0; pV = vars;
      var v = pCmp();
      pV = null;
      return v;
    },

    run: function (source) {
      var lines = String(source || "").split(/\r?\n/);
      var vars = {}, output = [], gridSize = 12, grid = [], r, c;
      for (r = 0; r < gridSize; r++) { grid.push([]); for (c = 0; c < gridSize; c++) grid[r].push("."); }
      var tx = 4, ty = 4, dir = 0;
      var dx = [1, 0, -1, 0], dy = [0, 1, 0, -1];
      grid[ty][tx] = "#";
      var self = this;
      function fail(msg, withGrid) {
        return { ok: false, error: msg, output: output, vars: vars, grid: withGrid ? self._renderGrid(grid, tx, ty) : "" };
      }

      /* trimmed and upper-cased once; the jump table pairs each REPEAT with its END */
      var raws = new Array(lines.length), uppers = new Array(lines.length), plans = new Array(lines.length);
      var stack = [], jumps = {};
      for (var i = 0; i < lines.length; i++) {
        raws[i] = trimBoth(lines[i]);
        var s = uppers[i] = raws[i].toUpperCase();
        if (s.indexOf("REPEAT ") === 0) {
          stack.push(i);
        } else if (s === "END") {
          if (stack.length === 0) return fail("Line " + (i + 1) + ": END without REPEAT");
          var start = stack.pop();
          jumps[i] = start; jumps[start] = i;
        }
      }
      if (stack.length > 0) return fail("Missing END for REPEAT");

      var loopCounters = {}, pc = 0, steps = 0, MAX_STEPS = 500;
      while (pc < lines.length) {
        if (++steps > MAX_STEPS) return fail("Stopped after 500 steps (loop limit)", true);
        var plan = plans[pc];
        if (plan === undefined) {
          var raw = raws[pc];
          if (!raw || raw.charAt(0) === "#") plan = { op: "SKIP" };
          else {
            var upper = uppers[pc];
            if (upper.indexOf("IF ") === 0) {
              var thenIdx = upper.indexOf(" THEN ");
              if (thenIdx < 0) plan = { op: "ERR", msg: "Line " + (pc + 1) + ": IF needs THEN" };
              else {
                var act = trimBoth(raw.slice(thenIdx + 6));
                plan = { op: "IF", cond: raw.slice(3, thenIdx), act: planCommand(act, act.toUpperCase(), pc + 1) };
              }
            } else plan = planCommand(raw, upper, pc + 1);
          }
          plans[pc] = plan;
        }
        if (plan.op === "SKIP") { pc++; continue; }
        if (plan.op === "IF") {
          if (!isTrue(this.evalExpr(plan.cond, vars))) { pc++; continue; }
          plan = plan.act;
        }

        var op = plan.op;
        if (op === "ERR") {
          return fail(plan.msg);
        } else if (op === "LET") {
          vars[plan.name] = this.evalExpr(plan.expr, vars);
        } else if (op === "PRINT") {
          output.push(toTxt(this.evalExpr(plan.expr, vars)));
        } else if (op === "CLEAR") {
          for (r = 0; r < gridSize; r++) for (c = 0; c < gridSize; c++) grid[r][c] = ".";
          tx = 4; ty = 4; dir = 0; grid[ty][tx] = "#";
        } else if (op === "MOVE") {
          var dist = Math.max(0, Math.min(20, Math.floor(toNum(this.evalExpr(plan.expr, vars)))));
          for (var m = 0; m < dist; m++) {
            tx = Math.max(0, Math.min(gridSize - 1, tx + dx[dir]));
            ty = Math.max(0, Math.min(gridSize - 1, ty + dy[dir]));
            grid[ty][tx] = "#";
          }
        } else if (op === "TURN") {
          dir = plan.left ? (dir + 3) % 4 : (dir + 1) % 4;
        } else if (op === "REPEAT") {
          var cnt = Math.max(0, Math.floor(toNum(this.evalExpr(plan.expr, vars))));
          if (cnt === 0) { pc = jumps[pc] + 1; continue; }
          loopCounters[pc] = cnt;
        } else if (op === "END") {
          var head = jumps[pc];
          loopCounters[head] -= 1;
          if (loopCounters[head] > 0) { pc = head + 1; continue; }
        }
        pc++;
      }
      return { ok: true, vars: vars, output: output, grid: this._renderGrid(grid, tx, ty) };
    },

    _renderGrid: function (grid, tx, ty) {
      var rows = [];
      for (var r = 0; r < grid.length; r++) {
        var line = [];
        for (var c = 0; c < grid[r].length; c++) line.push(r === ty && c === tx ? "@" : grid[r][c]);
        rows.push(line.join(" "));
      }
      return rows.join("\n");
    }
  };

  /* ======================================================================
     8. DESERT ADVENTURE
     ====================================================================== */
  var ROOMS = {
    camp: {
      title: "Solar Camp",
      desc: "Your solar radio is quiet and your canteen is low. To the EAST is the Dry Well. To the NORTH is the Signal Tower.",
      exits: [["east", "well"], ["north", "tower"]],
      puzzle: {
        id: "p_solar",
        prompt: "Challenge: You have 1 liter of cloudy water. What two steps make it safe to drink? (Type answer or 'hint')",
        keywords: ["cloth", "boil", "sun"], hintTopic: "water purification", reward: "Clean Canteen (+20 XP)", xp: 20
      }
    },
    well: {
      title: "The Dry Well & Builder's Corner",
      desc: "Builders left two ropes of lengths 3m and 4m to frame a straight 90-degree shelter corner. To the WEST is Camp; SOUTH is the Vault.",
      exits: [["west", "camp"], ["south", "vault"]],
      puzzle: {
        id: "p_pyth",
        prompt: "Math Challenge: What must the 3rd diagonal rope length be so a^2 + b^2 = c^2? (Number)",
        keywords: ["5", "five"], hintTopic: "pythagorean theorem", reward: "Brass Key (+20 XP)", xp: 20
      }
    },
    tower: {
      title: "Signal Tower",
      desc: "The beacon screen shows binary: 101. Decode it to tune the antenna! SOUTH goes to Camp.",
      exits: [["south", "camp"]],
      puzzle: {
        id: "p_bin",
        prompt: "Coding Challenge: What decimal number is binary 101?",
        keywords: ["5", "five"], hintTopic: "binary numbers", reward: "Signal Boost (+20 XP)", xp: 20
      }
    },
    vault: {
      title: "The Underground Library Vault",
      desc: "Shelves of compressed knowledge crystals glow softly! NORTH returns to the Well.",
      exits: [["north", "well"]],
      puzzle: {
        id: "p_frac",
        prompt: "Final Challenge: Share 3 loaves of bread equally among 4 travelers. How much does each get?",
        keywords: ["3/4", "0.75"], hintTopic: "fractions", reward: "Master Oasis Key (+50 XP)", xp: 50
      }
    }
  };

  function AdventureEngine(profileMgr, library) {
    this.pm = profileMgr;
    this.lib = library;
  }

  AdventureEngine.prototype.look = function () {
    var st = this.pm.profile.adventureState;
    var room = ROOMS[st.room] || ROOMS.camp;
    var solved = st.solved.indexOf(room.puzzle.id) >= 0;
    return "== " + room.title + " ==\n" + room.desc + "\n" +
      (solved ? "[Solved! Reward: " + room.puzzle.reward + "]" : room.puzzle.prompt) +
      "\nCommands: GO <dir>, ANSWER <text>, HINT";
  };

  AdventureEngine.prototype.command = function (cmdLine) {
    var raw = String(cmdLine || "").replace(/^\s+|\s+$/g, "");
    var up = raw.toUpperCase();
    var st = this.pm.profile.adventureState;
    var room = ROOMS[st.room] || ROOMS.camp;
    var i;

    if (up === "" || up === "LOOK") return this.look();
    if (up.indexOf("GO ") === 0) {
      var dir = raw.slice(3).replace(/^\s+|\s+$/g, "").toLowerCase(), names = [];
      for (i = 0; i < room.exits.length; i++) {
        names.push(room.exits[i][0]);
        if (room.exits[i][0] === dir) {
          st.room = room.exits[i][1];
          this.pm.save();
          return this.look();
        }
      }
      return "You can't go '" + dir + "'. Exits: " + names.join(", ");
    }
    if (up === "HINT") {
      var hits = this.lib.search(room.puzzle.hintTopic, 1);
      if (hits.length > 0) {
        return "[Library Hint - " + hits[0].topic + "] " + hits[0].fact + (hits[0].ex ? "\nExample: " + hits[0].ex : "");
      }
      return "Try checking the Library for: " + room.puzzle.hintTopic;
    }
    var ans = (up.indexOf("ANSWER ") === 0 ? raw.slice(7) : raw).toLowerCase();
    for (i = 0; i < room.puzzle.keywords.length; i++) {
      if (ans.indexOf(room.puzzle.keywords[i]) >= 0) {
        if (st.solved.indexOf(room.puzzle.id) < 0) {
          st.solved.push(room.puzzle.id);
          st.inventory.push(room.puzzle.reward);
          this.pm.recordSuccess(room.puzzle.hintTopic, room.puzzle.xp);
        }
        return "CORRECT! Unlocked: " + room.puzzle.reward + "\nXP: " + this.pm.profile.xp;
      }
    }
    return "Not quite! Type HINT to pull knowledge from the compressed library, or try again.";
  };

  /* ======================================================================
     9. SWARM TUTOR: library first, optional neural net, shaped to the learner
     ====================================================================== */
  function SwarmTutor(library, profileMgr, tinyModel) {
    this.lib = library;
    this.pm = profileMgr;
    this.model = tinyModel || new Tiny2Model();
  }

  SwarmTutor.prototype.formatForModality = function (question, record, nnAnswer) {
    var mode = this.pm.profile.mode;
    if (!record) {
      if (nnAnswer) return { text: nnAnswer, source: "TNY2 Neural Weights" };
      return {
        text: "I could not find '" + question + "' in the local Library yet. Try importing a .txt encyclopedia or asking about science, math, survival, or coding!",
        source: "Offline Guide"
      };
    }
    var fact = record.fact, ex = record.ex || "", out;
    if (mode === "R") out = "[READ] " + record.topic.toUpperCase() + "\n" + fact + (ex ? "\nNote: " + ex : "");
    else if (mode === "A") out = "[AUDIO] " + fact + (ex ? " Example: " + ex : "");
    else if (mode === "D") {
      out = "[DO] Try applying '" + record.topic + "':\n" + (ex ? "Action: " + ex : "Fact: " + fact) +
        "\nMini-Check: Can you explain '" + record.topic + "' in your own words or test it in Code/Adventure?";
    } else {
      out = "[MIX] " + fact + (ex ? "\nApplied Example: " + ex : "") + (nnAnswer ? "\nTiny-Net says: " + nnAnswer : "");
    }
    AudioDriver.speak(fact + (ex ? " Example: " + ex : ""), mode);
    this.pm.recordSuccess(record.topic);
    return { text: out, source: nnAnswer ? "Library + TNY2" : "Compressed Library" };
  };

  /* "what is 18*4" style questions: digits, one operator, digits */
  function matchArithmetic(q) {
    var m = /^(?:what is +)?(\d+ *[+\-*\/%] *\d+) *\?? *$/i.exec(q);
    return m ? m[1] : null;
  }

  SwarmTutor.prototype.ask = function (question) {
    var q = cleanAscii(question);
    this.pm.profile.recentQueries.push(q);
    if (this.pm.profile.recentQueries.length > 20) this.pm.profile.recentQueries.shift();
    this.pm.save();

    var expr = matchArithmetic(q);
    if (expr) {
      var val = fmtNum(toNum(CodeSandbox.evalExpr(expr, {})));
      return this.formatForModality(q, {
        topic: "arithmetic", fact: expr + " = " + val,
        ex: "If you split or group " + expr + ", the result is " + val + "."
      }, "");
    }
    var hits = this.lib.search(q, 1), rec = hits.length > 0 ? hits[0] : null, nnAns = "";
    if (this.model && this.model.loaded) {
      var prompt = rec ? (this.pm.profile.mode + ":" + rec.fact.slice(0, 40) + "|" + q.slice(0, 30)) : q;
      nnAns = this.model.think(prompt, 0);
    }
    return this.formatForModality(q, rec, nnAns);
  };

  /* ======================================================================
     10. MULTI-SHELF LIBRARY AND THE PRE-ANSWER CHECK
     ====================================================================== */
  function MultiShelfLibrary() {
    this.names = [];
    this.shelves = Object.create(null);
  }

  MultiShelfLibrary.prototype.addShelf = function (name, entries) {
    var store = new LibraryStore("evelyn_shelf_" + name);
    if (!store.load() && entries && entries.length) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        store.addEntry(e.topic, name, e.fact, e.ex || "");
      }
      store.save();
    }
    if (!this.shelves[name]) this.names.push(name);
    this.shelves[name] = { store: store };
    return store;
  };

  MultiShelfLibrary.prototype.slideSearch = function (question, activeShelves, topKPerShelf) {
    var hits = [], names = activeShelves && activeShelves.length ? activeShelves : this.names;
    for (var i = 0; i < names.length; i++) {
      var entry = this.shelves[names[i]];
      if (!entry) continue;
      var found = entry.store.search(question, topKPerShelf || 2);
      for (var j = 0; j < found.length; j++) {
        found[j].sourceId = names[i] + "#" + found[j].id;
        hits.push(found[j]);
      }
    }
    return hits;
  };

  function DeliberationSwarm(multiLib, profileMgr, tinyModel) {
    this.multiLib = multiLib;
    this.pm = profileMgr;
    this.model = tinyModel;
  }

  /* The checker reads every number of the draft (source tags left out) against the retrieved text */
  DeliberationSwarm.prototype._verifyDraft = function (draftText, sourceHits) {
    var transcript = ["Drafter: Proposed answer using " + sourceHits.length + " source(s)."];
    if (sourceHits.length === 0) {
      transcript.push("Checker: REJECTED - no matching source in persistent library.");
      return { ok: false, transcript: transcript, verifiedCitations: [] };
    }
    /* A number of the draft must be a whole number of the sources: 100 is not backed by 1000. */
    var allowed = Object.create(null), cites = [], i, m;
    for (i = 0; i < sourceHits.length; i++) {
      var srcNums = (sourceHits[i].fact + " " + (sourceHits[i].ex || "")).match(/\d+(?:\.\d+)?/g) || [];
      for (m = 0; m < srcNums.length; m++) allowed[srcNums[m]] = true;
      cites.push("[" + sourceHits[i].sourceId + ": " + sourceHits[i].topic + "]");
    }
    var nums = draftText.replace(/\[[^\]]*\]/g, " ").match(/\d+(?:\.\d+)?/g) || [];
    for (i = 0; i < nums.length; i++) {
      if (!allowed[nums[i]]) {
        transcript.push("Checker: WARNING - number '" + nums[i] + "' not backed by source; clamping to source text.");
        return { ok: false, transcript: transcript, verifiedCitations: cites };
      }
    }
    transcript.push("Checker: VERIFIED against " + cites.join(", "));
    return { ok: true, transcript: transcript, verifiedCitations: cites };
  };

  DeliberationSwarm.prototype.askWithSources = function (question, targetShelves) {
    var hits = this.multiLib.slideSearch(question, targetShelves, 1);
    var mode = this.pm.profile.mode, parts = [], i;
    for (i = 0; i < hits.length; i++) {
      var h = hits[i];
      parts.push(h.fact + (h.ex ? " (Example: " + h.ex + ")" : "") + " [" + h.sourceId + "]");
    }
    if (this.model && this.model.loaded && hits.length > 0) {
      var hint = this.model.think(mode + ":" + hits[0].fact.slice(0, 40) + "|" + question.slice(0, 30), 0);
      if (hint) parts.push("Tiny-Net Note: " + hint);
    }
    var draft = parts.join("\n"), check = this._verifyDraft(draft, hits), finalAnswer = "";
    if (check.ok) finalAnswer = draft;
    else {
      var safe = [];
      for (i = 0; i < hits.length; i++) safe.push(hits[i].fact + " [" + hits[i].sourceId + "]");
      finalAnswer = safe.join("\n");
    }
    if (!finalAnswer) finalAnswer = "No verified source found across shelves. Try importing a .txt module for this topic.";
    return { answer: finalAnswer, sources: check.verifiedCitations, internalConversation: check.transcript };
  };

  /* Q * K with Q squeezed to 8 bits: integer multiply-add, as a weak CPU would do it */
  function quantizedQKDot(qFloat, kInt8, kOffset, kScale, len) {
    var i, big = 0.0;
    for (i = 0; i < len; i++) {
      var a = qFloat[i] < 0 ? -qFloat[i] : qFloat[i];
      if (a > big) big = a;
    }
    if (big < 1e-20) return 0.0;
    var qScale = big / 127.0, invQ = 127.0 / big, acc = 0;
    for (i = 0; i < len; i++) acc += ((qFloat[i] * invQ) | 0) * kInt8[kOffset + i];
    return acc * qScale * kScale;
  }

  /* ======================================================================
     11. NETWORK PACKETS FOR 56k AND METERED LINKS
     ====================================================================== */
  function clamp16(v) { return v > 32767 ? 32767 : (v < -32768 ? -32768 : v); }

  var EvelynNet = {
    /* 12 bytes: id, buttons, seq u16, x and y in 1/16 units, vx and vy in 1/256 units */
    packFrame: function (playerId, x, y, vx, vy, buttons, seq) {
      var buf = new ArrayBuffer(12), v = new DataView(buf);
      v.setUint8(0, playerId & 255);
      v.setUint8(1, buttons & 255);
      v.setUint16(2, seq & 65535, true);
      v.setInt16(4, clamp16(Math.round(x * 16)), true);
      v.setInt16(6, clamp16(Math.round(y * 16)), true);
      v.setInt16(8, clamp16(Math.round(vx * 256)), true);
      v.setInt16(10, clamp16(Math.round(vy * 256)), true);
      return new Uint8Array(buf);
    },
    unpackFrame: function (u8) {
      var v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      return {
        playerId: v.getUint8(0), buttons: v.getUint8(1), seq: v.getUint16(2, true),
        x: v.getInt16(4, true) / 16, y: v.getInt16(6, true) / 16,
        vx: v.getInt16(8, true) / 256, vy: v.getInt16(10, true) / 256
      };
    },
    /* u16 count, f32 scale, then one signed byte per weight */
    packBotBrain: function (weights) {
      var n = weights.length, big = 0, i;
      for (i = 0; i < n; i++) { var a = Math.abs(weights[i]); if (a > big) big = a; }
      var scale = big > 1e-8 ? big / 127.0 : 1.0;
      var buf = new ArrayBuffer(6 + n), v = new DataView(buf);
      v.setUint16(0, n, true);
      v.setFloat32(2, scale, true);
      for (i = 0; i < n; i++) v.setInt8(6 + i, Math.max(-127, Math.min(127, Math.round(weights[i] / scale))));
      return new Uint8Array(buf);
    },
    unpackBotBrain: function (u8) {
      var v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      var n = v.getUint16(0, true), scale = v.getFloat32(2, true), w = new Float32Array(n);
      for (var i = 0; i < n; i++) w[i] = v.getInt8(6 + i) * scale;
      return w;
    }
  };

  /* ======================================================================
     EXPORT
     ====================================================================== */
  var Evelyn = {
    version: VERSION, VOCAB: VOCAB, CTX: CTX,
    fmtNum: fmtNum, valOf: valOf, cleanAscii: cleanAscii, tokenizeWords: tokenizeWords,
    XorShift32: XorShift32, Storage: Storage,
    LZCodec: LZCodec, STARTER_FACTS: STARTER_FACTS, LibraryStore: LibraryStore,
    tny2Size: tny2Size, Tiny2Model: Tiny2Model,
    ProfileManager: ProfileManager, AudioDriver: AudioDriver,
    CodeSandbox: CodeSandbox, CODING_LESSONS: CODING_LESSONS,
    ROOMS: ROOMS, AdventureEngine: AdventureEngine, SwarmTutor: SwarmTutor,
    MultiShelfLibrary: MultiShelfLibrary, DeliberationSwarm: DeliberationSwarm,
    quantizedQKDot: quantizedQKDot, EvelynNet: EvelynNet
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Evelyn;
  else root.Evelyn = Evelyn;
  if (typeof module === "undefined" || !module.exports) root.Oasis = Evelyn;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
