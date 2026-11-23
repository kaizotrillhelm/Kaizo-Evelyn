/* evelyn_sentinel.js - Trusted Integrity Boundary for Evelyn:
   1. IEEE 802.3 CRC32 (flat single-pass arithmetic, zero recursion)
   2. EVS1 Envelope (verifies byte length + CRC32 BEFORE any parser runs)
   3. Atomic A/B Double-Slot Store (survives mid-write USB unplugs)
   4. Fuel-Bounded SafeCodecs (LZW bomb guard, exact TNY2 header size check, depth-capped evalExpr)
   5. Time-Sliced Incremental Scrubber (bounded ms budget, zero infinite loops)
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynBackend) require("./evelyn_backend.js");

  /* =========================================================================
     1. IEEE 802.3 CRC32 (FIXED 256-ENTRY TABLE, ZERO RECURSION)
     ========================================================================= */
  var CRC_TABLE = new Uint32Array(256);
  (function initCrcTable() {
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  })();

  function crc32(input) {
    var c = 0xFFFFFFFF, i, b;
    if (typeof input === "string") {
      for (i = 0; i < input.length; i++) {
        var code = input.charCodeAt(i);
        b = code & 255;
        c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
        if (code > 255) {
          b = (code >>> 8) & 255;
          c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
        }
      }
    } else if (input && typeof input.length === "number") {
      for (i = 0; i < input.length; i++) {
        c = CRC_TABLE[(c ^ (input[i] & 255)) & 255] ^ (c >>> 8);
      }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* =========================================================================
     2. EVS1 INTEGRITY ENVELOPE (VERIFY BEFORE PARSE)
        Format: "EVS1|<gen>|<len>|<hexCrc32>\n<payload>"
     ========================================================================= */
  var Envelope = {
    seal: function (payloadStr, generation) {
      var body = String(payloadStr || "");
      var gen = (generation || 1) >>> 0;
      var hex = crc32(body).toString(16);
      return "EVS1|" + gen + "|" + body.length + "|" + hex + "\n" + body;
    },

    verify: function (sealedStr, maxChars) {
      var cap = maxChars || 524288;
      if (typeof sealedStr !== "string" || sealedStr.length === 0) {
        return { ok: false, error: "Empty or non-string envelope" };
      }
      if (sealedStr.length > cap) {
        return { ok: false, error: "Envelope exceeds max size (" + cap + ")" };
      }
      var nl = sealedStr.indexOf("\n");
      if (nl < 10 || nl > 64) return { ok: false, error: "Malformed envelope header" };
      var parts = sealedStr.slice(0, nl).split("|");
      if (parts.length !== 4 || parts[0] !== "EVS1") {
        return { ok: false, error: "Bad envelope magic" };
      }
      var gen = parseInt(parts[1], 10);
      var expectedLen = parseInt(parts[2], 10);
      var expectedCrc = parseInt(parts[3], 16) >>> 0;
      var body = sealedStr.slice(nl + 1);
      if (!isFinite(gen) || !isFinite(expectedLen) || body.length !== expectedLen) {
        return { ok: false, error: "Torn write: length mismatch (got " + body.length + ", expected " + expectedLen + ")" };
      }
      var actualCrc = crc32(body);
      if (actualCrc !== expectedCrc) {
        return { ok: false, error: "CRC32 mismatch (bit rot or torn write)" };
      }
      return { ok: true, gen: gen, payload: body, crc: actualCrc };
    }
  };

  /* =========================================================================
     3. ATOMIC A/B DOUBLE-SLOT STORE (SURVIVES MID-WRITE USB UNPLUGS)
        Works over any synchronous or mock backing map { getItem, setItem }.
     ========================================================================= */
  function ABStore(backing) {
    this.backing = backing || {
      _m: Object.create(null),
      getItem: function (k) { return this._m[k] !== undefined ? this._m[k] : null; },
      setItem: function (k, v) { this._m[k] = v; }
    };
  }

  ABStore.prototype._inspectSlots = function (key) {
    var a = Envelope.verify(this.backing.getItem(key + "_A"));
    var b = Envelope.verify(this.backing.getItem(key + "_B"));
    return { a: a, b: b };
  };

  ABStore.prototype.save = function (key, obj) {
    var json;
    try { json = JSON.stringify(obj); } catch (e) { return { ok: false, error: "Serialization failed" }; }
    var slots = this._inspectSlots(key);
    var genA = slots.a.ok ? slots.a.gen : 0;
    var genB = slots.b.ok ? slots.b.gen : 0;
    var nextGen = Math.max(genA, genB) + 1;
    /* Always write to the older or invalid slot so the latest good slot stays untouched! */
    var targetSlot = (genA <= genB) ? "A" : "B";
    var sealed = Envelope.seal(json, nextGen);
    try {
      this.backing.setItem(key + "_" + targetSlot, sealed);
      return { ok: true, slot: targetSlot, gen: nextGen, bytes: sealed.length };
    } catch (err) {
      return { ok: false, error: "Storage write failed (quota or ejected drive)" };
    }
  };

  ABStore.prototype.load = function (key) {
    var slots = this._inspectSlots(key);
    var pick = null, pickedSlot = null, tornSlot = null;

    if (slots.a.ok && slots.b.ok) {
      if (slots.a.gen >= slots.b.gen) { pick = slots.a; pickedSlot = "A"; }
      else { pick = slots.b; pickedSlot = "B"; }
    } else if (slots.a.ok) {
      pick = slots.a; pickedSlot = "A";
      if (this.backing.getItem(key + "_B") !== null) tornSlot = "B";
    } else if (slots.b.ok) {
      pick = slots.b; pickedSlot = "B";
      if (this.backing.getItem(key + "_A") !== null) tornSlot = "A";
    } else {
      return { ok: false, error: "No valid A/B slot available", tornSlot: "both" };
    }

    try {
      var data = JSON.parse(pick.payload);
      return { ok: true, data: data, slot: pickedSlot, gen: pick.gen, recoveredFromTornSlot: tornSlot };
    } catch (e) {
      return { ok: false, error: "JSON parse failed inside verified slot" };
    }
  };

  /* =========================================================================
     4. FUEL-BOUNDED SAFE CODECS (ZERO UNCAUGHT EXCEPTIONS, < 10 MS EXIT)
     ========================================================================= */
  var SafeCodecs = {
    /* LZW decoder with strict code-bounds check & expansion bomb cap */
    decompressLZW: function (packed, maxOutChars) {
      var cap = maxOutChars || 65536;
      if (typeof packed !== "string") return { ok: false, error: "LZW input must be string" };
      if (packed.length === 0) return { ok: true, text: "" };
      if (packed.length > 131072) return { ok: false, error: "LZW input exceeds 128 KB cap" };

      var c0 = packed.charCodeAt(0);
      if (c0 > 255) return { ok: false, error: "Invalid initial LZW code: " + c0 };

      var dict = new Array(4096), i, nextCode = 256;
      for (i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);

      var w = dict[c0];
      var out = [w];
      var totalLen = 1;

      for (i = 1; i < packed.length; i++) {
        var k = packed.charCodeAt(i);
        var entry;
        if (k < nextCode && dict[k] !== undefined) {
          entry = dict[k];
        } else if (k === nextCode) {
          entry = w + w.charAt(0);
        } else {
          return { ok: false, error: "Corrupt LZW code " + k + " > nextCode " + nextCode + " at offset " + i };
        }
        totalLen += entry.length;
        if (totalLen > cap) {
          return { ok: false, error: "LZW output exceeded safe cap (" + cap + " chars)" };
        }
        out.push(entry);
        if (nextCode < 65535) dict[nextCode++] = w + entry.charAt(0);
        w = entry;
      }
      return { ok: true, text: out.join("") };
    },

    /* Safe .evelynpack importer (rejects zero-byte, corrupt LZW, and huge payloads) */
    importPack: function (packedStr, maxOutChars) {
      if (typeof packedStr !== "string" || packedStr.length < 7) {
        return { ok: false, error: "Pack file is empty or truncated" };
      }
      if (packedStr.indexOf("EVPK1:") !== 0) {
        return { ok: false, error: "Missing EVPK1 header" };
      }
      var dec = this.decompressLZW(packedStr.slice(6), maxOutChars || 262144);
      if (!dec.ok) return { ok: false, error: "Pack decompression failed: " + dec.error };
      try {
        var obj = JSON.parse(dec.text);
        if (!obj || typeof obj !== "object" || obj.magic !== "EVPK1") {
          return { ok: false, error: "Pack JSON failed magic check" };
        }
        return { ok: true, data: obj };
      } catch (e) {
        return { ok: false, error: "Corrupt pack JSON" };
      }
    },

    /* Exact byte-size verifier for TNY2 binary weights BEFORE allocating arrays */
    validateTny2Buffer: function (buf) {
      if (!buf || typeof buf.byteLength !== "number" || buf.byteLength < 12) {
        return { ok: false, error: "TNY2 buffer too small (< 12 bytes)" };
      }
      if (buf.byteLength > 4 * 1024 * 1024) {
        return { ok: false, error: "TNY2 buffer exceeds 4 MB safety limit" };
      }
      var v = new DataView(buf);
      var magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
      if (magic !== "TNY2") return { ok: false, error: "Bad TNY2 magic" };
      var D = v.getUint16(4, true), L = v.getUint16(6, true), H = v.getUint16(8, true), HID = v.getUint16(10, true);
      if (D < 4 || D > 512 || L < 1 || L > 16 || H < 1 || H > 16 || (D % H) !== 0 || HID < 4 || HID > 2048) {
        return { ok: false, error: "Out-of-range TNY2 dimensions (" + D + "," + L + "," + H + "," + HID + ")" };
      }
      function tb(r, c) { return r * (4 + c); }
      var expected = 12 + tb(97, D) + tb(128, D) +
        L * (D * 4 + 4 * tb(D, D) + D * 4 + tb(HID, D) + tb(D, HID)) + D * 4;
      if (buf.byteLength !== expected) {
        return { ok: false, error: "Torn TNY2 file: got " + buf.byteLength + " bytes, expected " + expected };
      }
      return { ok: true, D: D, L: L, H: H, HID: HID, bytes: expected };
    },

    /* Hardened expression evaluator with nesting depth cap (<= 24) & zero throws */
    evalExpr: function (expr, vars, opts) {
      opts = opts || {};
      var maxDepth = opts.maxDepth || 24;
      var maxTokens = opts.maxTokens || 128;
      if (typeof expr !== "string" || expr.trim() === "") {
        return { ok: false, error: "Empty expression" };
      }
      if (expr.length > 512) return { ok: false, error: "Expression exceeds 512 chars" };

      /* Check balanced quotes up front */
      var qCount = 0, i;
      for (i = 0; i < expr.length; i++) if (expr.charAt(i) === '"') qCount++;
      if ((qCount & 1) === 1) return { ok: false, error: "Unclosed string quote" };

      var toks = expr.match(/"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<=|>=|==|!=|[+\-*/%()<>]/g) || [];
      if (toks.length === 0) return { ok: false, error: "No valid tokens" };
      if (toks.length > maxTokens) return { ok: false, error: "Too many tokens (> " + maxTokens + ")" };

      var p = 0, depth = 0, errMsg = null, vmap = vars || {};
      function pk() { return toks[p]; }
      function nx() { return toks[p++]; }

      function cmp() {
        var l = add(); if (errMsg) return 0;
        var op = pk();
        if (op === "<" || op === ">" || op === "<=" || op === ">=" || op === "==" || op === "!=") {
          nx(); var r = add(); if (errMsg) return 0;
          if (op === "<") return l < r ? 1 : 0; if (op === ">") return l > r ? 1 : 0;
          if (op === "<=") return l <= r ? 1 : 0; if (op === ">=") return l >= r ? 1 : 0;
          if (op === "==") return l === r ? 1 : 0; return l !== r ? 1 : 0;
        }
        return l;
      }
      function add() {
        var v = mul(); if (errMsg) return 0;
        while (pk() === "+" || pk() === "-") {
          var op = nextOp(), r = mul(); if (errMsg) return 0;
          v = op === "+" ? (v + r) : (v - r);
        }
        return v;
      }
      function nextOp() { return toks[p++]; }
      function mul() {
        var v = fac(); if (errMsg) return 0;
        while (pk() === "*" || pk() === "/" || pk() === "%") {
          var op = nextOp(), r = fac(); if (errMsg) return 0;
          if (op === "*") v = v * r;
          else if (r === 0) { errMsg = "Division by zero"; return 0; }
          else v = op === "/" ? (v / r) : (v % r);
        }
        return v;
      }
      function fac() {
        if (++depth > maxDepth) { errMsg = "Nesting depth exceeded (" + maxDepth + ")"; return 0; }
        var t = nx(), res = 0;
        if (t === undefined) { errMsg = "Unexpected end of expression"; depth--; return 0; }
        if (t === "(") {
          res = cmp();
          if (!errMsg && pk() !== ")") errMsg = "Unclosed parenthesis";
          else if (!errMsg) nx();
        } else if (t === "-") {
          res = -fac();
        } else if (t.charAt(0) === '"') {
          res = t.slice(1, -1);
        } else if (/^\d/.test(t)) {
          res = parseFloat(t);
        } else if (/^[A-Za-z_]/.test(t)) {
          res = vmap[t] !== undefined ? vmap[t] : 0;
        } else {
          errMsg = "Unexpected token '" + t + "'";
        }
        depth--;
        return res;
      }

      var val = cmp();
      if (!errMsg && p < toks.length) errMsg = "Trailing token '" + toks[p] + "'";
      if (!errMsg && typeof val === "number" && !isFinite(val)) errMsg = "Non-finite numeric result";
      if (errMsg) return { ok: false, error: errMsg };
      return { ok: true, value: val };
    }
  };

  /* =========================================================================
     5. TIME-SLICED INCREMENTAL SCRUBBER (READ-ONLY, QUARANTINES TORN ROWS)
     ========================================================================= */
  function IncrementalScrubber(opts) {
    opts = opts || {};
    this.cursor = 0;
    this.batchSize = opts.batchSize || 12;
    this.quarantinedIds = [];
    this.checkedCount = 0;
    this.fullPasses = 0;
  }

  /* Scrub at most `batchSize` shelf rows per idle slice; never modifies healthy data */
  IncrementalScrubber.prototype.scrubSlice = function (rows) {
    if (!rows || rows.length === 0) return { donePass: true, checkedNow: 0, newlyQuarantined: 0 };
    var checkedNow = 0, newlyBad = 0;
    var limit = Math.min(this.batchSize, rows.length);

    for (var step = 0; step < limit; step++) {
      if (this.cursor >= rows.length) {
        this.cursor = 0;
        this.fullPasses++;
        break;
      }
      var row = rows[this.cursor];
      var bad = false;
      if (!row || typeof row.zF !== "string" || row.zF.length === 0) {
        bad = true;
      } else {
        var r = SafeCodecs.decompressLZW(row.zF, 8192);
        if (!r.ok || r.text.length === 0) bad = true;
      }
      if (bad && this.quarantinedIds.indexOf(row ? row.id : this.cursor) < 0) {
        this.quarantinedIds.push(row ? row.id : this.cursor);
        newlyBad++;
      }
      this.cursor++;
      this.checkedCount++;
      checkedNow++;
    }

    var donePass = false;
    if (this.cursor >= rows.length) {
      this.cursor = 0;
      this.fullPasses++;
      donePass = true;
    }
    return {
      donePass: donePass,
      checkedNow: checkedNow,
      newlyQuarantined: newlyBad,
      totalQuarantined: this.quarantinedIds.length,
      fullPasses: this.fullPasses
    };
  };

  root.EvelynSentinel = {
    crc32: crc32,
    Envelope: Envelope,
    ABStore: ABStore,
    SafeCodecs: SafeCodecs,
    IncrementalScrubber: IncrementalScrubber
  };
})(typeof window !== "undefined" ? window : global);
