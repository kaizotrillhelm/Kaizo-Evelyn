/* evelyn_sovereign_local.js - Local Sovereignty & Multi-Device Efficiency for Evelyn:
   1. RuntimeBenchSelector   (Auto-benchmarks local kernels on boot and pins fastest engine)
   2. ExoLayerPool           (Pipeline-parallel layer splitter across cheap LAN devices + INT8 hops)
   3. PrivacyRedactor        (Reversible PII/secret scrubber + hard air-gapped lockout switch)
   4. SovereignManifest      (CRC32 + byte-size lock proving local models/shelves never silently change)
   5. LocalTranscriptPipe    (Normalizes $0/min local whisper.cpp / speech transcripts into lessons)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynSentinel) require("./evelyn_sentinel.js");
  var Sent = root.EvelynSentinel;

  /* =========================================================================
     1. RUNTIME ENGINE AUTO-BENCHMARK SELECTOR ("22 vs 92 tok/s" SOFTWARE LESSON)
     ========================================================================= */
  var RuntimeBenchSelector = {
    /* candidates: [{ id, run(input) -> number }] */
    pickFastest: function (candidates, testInput, iterations, expectedResult) {
      var iters = iterations || 200;
      var results = [];
      /* A whole-millisecond clock cannot tell two fast kernels apart (both read 0 ms and the first listed won), so use
         the high-resolution clock when there is one, and keep the best of three timings to ignore a stray pause. */
      function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i], out = 0, valid = true, perCall = Infinity;
        /* A browser clock may be coarsened to 0.1 ms or even 1 ms (privacy settings), so a timing under 5 ms is repeated
           with ten times the calls until it is long enough to mean something; candidates compare by time per call. */
        for (var rep = 0; rep < 3; rep++) {
          var n = iters, one = 0, grow = 0;
          for (;;) {
            var t0 = now();
            for (var k = 0; k < n; k++) out = c.run(testInput);
            one = now() - t0;
            if (one >= 5 || grow >= 5) break;
            n *= 10; grow++;
          }
          var pc = one / n;
          if (pc < perCall) perCall = pc;
        }
        perCall = Math.max(1e-9, perCall);
        var dt = perCall * iters;
        if (expectedResult !== undefined && Math.abs(out - expectedResult) > 1e-3) valid = false;
        results.push({ id: c.id, ms: dt, opsPerMs: Number((1 / perCall).toFixed(2)), valid: valid, output: out });
      }
      var good = results.filter(function (r) { return r.valid; });
      good.sort(function (a, b) { return a.ms - b.ms; });
      return {
        ok: good.length > 0,
        winner: good.length > 0 ? good[0].id : null,
        rankings: results
      };
    }
  };

  /* =========================================================================
     2. EXO-STYLE MULTI-DEVICE LAN LAYER-SPLIT POOL (INT8 ACTIVATION HOPS)
        Pools 2..N old laptops/phones so no single device needs full model RAM.
     ========================================================================= */
  function quantizeActivation8(floatVec) {
    var n = floatVec.length, big = 0.0, i;
    for (i = 0; i < n; i++) { var a = Math.abs(floatVec[i]); if (a > big) big = a; }
    var sc = big > 1e-8 ? (big / 127.0) : 1.0;
    var q = new Int8Array(n);
    for (i = 0; i < n; i++) q[i] = Math.max(-127, Math.min(127, Math.round(floatVec[i] / sc)));
    return { scale: sc, q: q, wireBytes: n + 4 };
  }

  function dequantizeActivation8(pkt) {
    var out = new Float32Array(pkt.q.length);
    for (var i = 0; i < pkt.q.length; i++) out[i] = pkt.q[i] * pkt.scale;
    return out;
  }

  var ExoLayerPool = {
    /* peers: [{ id, freeRamMB, alive }] -> contiguous non-overlapping layer shards */
    partitionLayers: function (totalLayers, peers) {
      var alive = [];
      var ramSum = 0, i;
      for (i = 0; i < peers.length; i++) {
        if (peers[i].alive !== false && peers[i].freeRamMB > 0) {
          alive.push(peers[i]);
          ramSum += peers[i].freeRamMB;
        }
      }
      if (alive.length === 0) return { ok: false, error: "No live peers available." };

      var shards = [], cursor = 0;
      for (i = 0; i < alive.length; i++) {
        var remainingPeers = alive.length - i;
        var remainingLayers = totalLayers - cursor;
        var share = (i === alive.length - 1)
          ? remainingLayers
          : Math.max(1, Math.min(remainingLayers - (remainingPeers - 1), Math.round(totalLayers * (alive[i].freeRamMB / ramSum))));
        if (share <= 0) continue;
        shards.push({ peerId: alive[i].id, startLayer: cursor, endLayer: cursor + share, layerCount: share });
        cursor += share;
        if (cursor >= totalLayers) break;
      }
      return { ok: cursor === totalLayers, totalLayers: totalLayers, shards: shards };
    },

    /* Execute pipeline-parallel forward pass across peers with INT8 quantized wire hops */
    runPipeline: function (initVec, shards, layerStepFn) {
      var curVec = new Float32Array(initVec);
      var totalWireBytes = 0, hops = 0;
      for (var s = 0; s < shards.length; s++) {
        var sh = shards[s];
        for (var l = sh.startLayer; l < sh.endLayer; l++) {
          curVec = layerStepFn(curVec, l, sh.peerId);
        }
        /* Quantize activation before crossing LAN link to next peer */
        if (s < shards.length - 1) {
          var pkt = quantizeActivation8(curVec);
          totalWireBytes += pkt.wireBytes;
          hops++;
          curVec = dequantizeActivation8(pkt);
        }
      }
      return { output: curVec, hops: hops, totalWireBytes: totalWireBytes };
    }
  };

  /* =========================================================================
     3. PRIVACY REDACTOR & SOVEREIGN HYBRID ROUTER (encrypteveryprompt PATTERN)
     ========================================================================= */
  function PrivacyRedactor(opts) {
    opts = opts || {};
    this.airgappedOnly = opts.airgappedOnly !== undefined ? !!opts.airgappedOnly : true;
    this.privateNames = (opts.privateNames || []).slice(0);
  }

  PrivacyRedactor.prototype.scrub = function (text) {
    var s = String(text || "");
    var revMap = Object.create(null); // placeholder -> original value
    var counts = { USER: 0, EMAIL: 0, PHONE: 0, SECRET: 0 };

    function replaceTag(kind, match) {
      var tok = "<" + kind + "_" + (++counts[kind]) + ">";
      revMap[tok] = match;
      return tok;
    }

    /* 1. Registered family / child names */
    for (var i = 0; i < this.privateNames.length; i++) {
      var nm = this.privateNames[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!nm) continue;
      s = s.replace(new RegExp("\\b" + nm + "\\b", "gi"), function (m) { return replaceTag("USER", m); });
    }
    /* 2. API keys / tokens */
    s = s.replace(/\b(?:sk|pk|ghp|AIza)[-_A-Za-z0-9]{10,}\b/g, function (m) { return replaceTag("SECRET", m); });
    /* 3. Emails */
    s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, function (m) { return replaceTag("EMAIL", m); });
    /* 4. Phone numbers */
    s = s.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, function (m) { return replaceTag("PHONE", m); });

    return { scrubbed: s, revMap: revMap, redactedCount: counts.USER + counts.EMAIL + counts.PHONE + counts.SECRET };
  };

  PrivacyRedactor.prototype.restore = function (text, revMap) {
    var s = String(text || "");
    for (var tok in revMap) s = s.split(tok).join(revMap[tok]);
    return s;
  };

  /* Hybrid router: obeys hard air-gapped lock; scrubs PII before any optional external escalation */
  PrivacyRedactor.prototype.prepareRoute = function (query, taskDifficulty) {
    if (this.airgappedOnly || taskDifficulty !== "hard_frontier") {
      return { destination: "local", payload: query, revMap: null, redactedCount: 0 };
    }
    var sc = this.scrub(query);
    return { destination: "optional_cloud_scrubbed", payload: sc.scrubbed, revMap: sc.revMap, redactedCount: sc.redactedCount };
  };

  /* =========================================================================
     4. SOVEREIGN MODEL & SHELF MANIFEST LOCK ("CAN'T BE QUIETLY CHANGED")
     ========================================================================= */
  function SovereignManifest() {
    this.entries = Object.create(null); // id -> { bytes, crc32, version }
  }
  SovereignManifest.prototype.pin = function (id, dataStrOrU8, version) {
    var len = dataStrOrU8 ? dataStrOrU8.length : 0;
    var crc = Sent.crc32(dataStrOrU8);
    this.entries[id] = { id: id, bytes: len, crc32: crc, version: version || "1.0" };
    return this.entries[id];
  };
  SovereignManifest.prototype.verify = function (id, dataStrOrU8) {
    var pin = this.entries[id];
    if (!pin) return { ok: false, error: "Asset not pinned in SovereignManifest: " + id };
    var len = dataStrOrU8 ? dataStrOrU8.length : 0;
    var crc = Sent.crc32(dataStrOrU8);
    if (len !== pin.bytes || crc !== pin.crc32) {
      return { ok: false, error: "Silent modification or corruption detected on " + id + " (expected CRC " + pin.crc32.toString(16) + ", got " + crc.toString(16) + ")." };
    }
    return { ok: true, id: id, version: pin.version, crc32: crc };
  };

  /* =========================================================================
     5. $0/MIN LOCAL VOICE TRANSCRIPT NORMALIZER (WHISPER.CPP TINY -> LESSON)
     ========================================================================= */
  var LocalTranscriptPipe = {
    cleanTranscript: function (rawWhisperText) {
      var s = String(rawWhisperText || "")
        .replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE)\]/gi, " ")
        .replace(/\b(um|uh|er)\b,?\s*/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (s.length > 0 && s.charAt(0) >= "a" && s.charAt(0) <= "z") {
        s = s.charAt(0).toUpperCase() + s.slice(1);
      }
      return s;
    }
  };

  root.EvelynSovereign = {
    RuntimeBenchSelector: RuntimeBenchSelector,
    quantizeActivation8: quantizeActivation8,
    dequantizeActivation8: dequantizeActivation8,
    ExoLayerPool: ExoLayerPool,
    PrivacyRedactor: PrivacyRedactor,
    SovereignManifest: SovereignManifest,
    LocalTranscriptPipe: LocalTranscriptPipe
  };
})(typeof window !== "undefined" ? window : global);
