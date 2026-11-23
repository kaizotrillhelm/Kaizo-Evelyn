/* evelyn_stream_tests.js - streamed equals resident equals the reference engine.
   node js/test/evelyn_stream_tests.js
   Plain ES5 in the tests too (no arrow functions, let or const). */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var S, Evelyn;
  if (isNode) {
    S = require("../evelyn_stream.js");
    Evelyn = require("../evelyn_core.js");
  } else { S = root.EvelynStream; Evelyn = root.Evelyn; }

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  function rngOf(seed) {   /* mulberry32 */
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A deterministic TNY2 file of any shape (random weights: letters, not meaning) */
  function makeTny2(D, L, H, HID, seed) {
    var VOCAB = 97, CTX = 128;
    function tb(r, c) { return r * (4 + c); }
    var total = 12 + tb(VOCAB, D) + tb(CTX, D) + L * (D * 4 + 4 * tb(D, D) + D * 4 + tb(HID, D) + tb(D, HID)) + D * 4;
    var buf = new ArrayBuffer(total), v = new DataView(buf), rng = rngOf(seed || 42), off = 12;
    v.setUint8(0, 84); v.setUint8(1, 78); v.setUint8(2, 89); v.setUint8(3, 50);
    v.setUint16(4, D, true); v.setUint16(6, L, true); v.setUint16(8, H, true); v.setUint16(10, HID, true);
    function wt(rows, cols, sc) {
      for (var r = 0; r < rows; r++) {
        v.setFloat32(off, sc, true); off += 4;
        for (var c = 0; c < cols; c++) v.setInt8(off++, Math.floor((rng() * 2 - 1) * 45));
      }
    }
    function wg(n) { for (var i = 0; i < n; i++) { v.setFloat32(off, 1.0, true); off += 4; } }
    wt(VOCAB, D, 0.025); wt(CTX, D, 0.025);
    for (var l = 0; l < L; l++) { wg(D); wt(D, D, 0.025); wt(D, D, 0.025); wt(D, D, 0.025); wt(D, D, 0.025); wg(D); wt(HID, D, 0.025); wt(D, HID, 0.025); }
    wg(D);
    assertEq(off, total, "makeTny2 size mismatch");
    return buf;
  }

  /* Compare the KV cache of two stream models, or a stream model and Evelyn.Tiny2Model */
  function assertKVEq(a, b, L, D, positions, label) {
    for (var l = 0; l < L; l++) {
      var n = positions * D, i, p;
      for (i = 0; i < n; i++) {
        assertEq(a.kc[l][i], b.kc[l][i], label + " kc L" + l + " idx " + i);
        assertEq(a.vc[l][i], b.vc[l][i], label + " vc L" + l + " idx " + i);
      }
      for (p = 0; p < positions; p++) {
        assertEq(a.ks[l][p], b.ks[l][p], label + " ks L" + l + " pos " + p);
        assertEq(a.vs[l][p], b.vs[l][p], label + " vs L" + l + " pos " + p);
      }
    }
  }

  test("D=24 L=2: streamed text and every KV byte equal the resident model", function (done) {
    var buf = makeTny2(24, 2, 2, 48, 101), manifest = S.buildSovereignManifest(buf);
    var res = new S.Tiny2StreamModel(), str = new S.Tiny2StreamModel();
    res.loadFromBuffer(buf, "resident", manifest);
    str.loadFromBuffer(buf, "slice", manifest);
    var q = "what is 7 times 8";
    var r = res.think(q, 16), s = str.think(q, 16);
    assertEq(s.text, r.text, "text");
    assert(s.text.length > 0, "the model should write something");
    assertKVEq(res, str, 2, 24, q.length + 1 + r.text.length, "stream vs resident");
    var loads = 2 * (1 + s.stats.charsGenerated);
    assertEq(s.stats.layersLoaded, loads, "layer-order prefill load count");
    assertEq(s.stats.bytesRead, loads * manifest.layers[0].length, "bytes read");
    assertEq(r.stats.layersLoaded, 0, "resident model loads nothing while answering");
    done();
  });

  test("streamed answer equals Evelyn.Tiny2Model (the reference engine), text and KV cache", function (done) {
    var buf = makeTny2(24, 3, 4, 48, 1), q = "Why is the sky blue?";
    var ref = new Evelyn.Tiny2Model();
    ref.loadFromArrayBuffer(buf.slice(0));
    var refText = ref.think(q, 0);
    var str = new S.Tiny2StreamModel();
    str.loadFromBuffer(buf, "slice", S.buildSovereignManifest(buf));
    var s = str.think(q);
    assertEq(s.text, refText, "text differs from Evelyn.Tiny2Model");
    assert(refText.length > 10, "the answer should be longer than a few letters");
    /* the reference writes the last letter without a cache step after the stop: compare the positions both filled */
    assertKVEq(str, ref, 3, 24, q.length + 1 + refText.length, "stream vs reference");
    done();
  });

  test("real shape D=96 L=4 (381,808 bytes): equal to resident and to the reference, honest cost", function (done) {
    var buf = makeTny2(96, 4, 4, 256, 2026);
    assertEq(buf.byteLength, 381808, "real-shape TNY2 size");
    assertEq(Evelyn.tny2Size(96, 4, 256), 381808, "core agrees on the size");
    var manifest = S.buildSovereignManifest(buf);
    var res = new S.Tiny2StreamModel(), str = new S.Tiny2StreamModel(), ref = new Evelyn.Tiny2Model();
    res.loadFromBuffer(buf, "resident", manifest);
    str.loadFromBuffer(buf, "slice", manifest);
    ref.loadFromArrayBuffer(buf.slice(0));
    var q = "capital of estonia";
    var r = res.think(q, 12), s = str.think(q, 12);
    assertEq(s.text, r.text, "stream vs resident text");
    assertKVEq(res, str, 4, 96, q.length + 1 + r.text.length, "stream vs resident");
    var full = str.think(q);
    assertEq(full.text, ref.think(q, 0), "stream vs reference text");
    var perAnswer = 4 * (1 + s.stats.charsGenerated);
    assertEq(s.stats.layersLoaded, perAnswer, "layers loaded");
    assert(s.stats.bytesRead < 4 * manifest.layers[0].length * (q.length + 1 + 12), "layer-order prefill reads less than token order would");
    console.log("    [cost D=96 L=4] letters=" + s.stats.charsGenerated + " layersLoaded=" + s.stats.layersLoaded +
      " bytesRead=" + (s.stats.bytesRead / 1024).toFixed(1) + " KB speed=" + s.stats.lettersPerSec.toFixed(1) + " letters/s" +
      " (one layer in memory: " + (manifest.layers[0].length / 1024).toFixed(1) + " KB instead of " + (4 * manifest.layers[0].length / 1024).toFixed(1) + " KB)");
    done();
  });

  test("layer-order prefill loads each layer once per prompt, not once per prompt letter", function (done) {
    var buf = makeTny2(24, 2, 2, 48, 5), q = "tell me about gravity please";
    var str = new S.Tiny2StreamModel();
    str.loadFromBuffer(buf, "slice");
    var s = str.think(q, 0);
    assertEq(s.stats.charsGenerated, 0, "maxNew 0 writes nothing");
    assertEq(s.stats.layersLoaded, 2, "a 29-token prompt costs L layer loads, not 29 times L");
    done();
  });

  test("async prefetch: read-ahead shards give the same text and KV cache as resident", function (done) {
    var buf = makeTny2(24, 3, 2, 48, 303), split = S.splitTny2Shards(buf);
    var res = new S.Tiny2StreamModel(), pre = new S.Tiny2StreamModel();
    res.loadFromBuffer(buf, "resident", split.manifest);
    var fetchLog = [], q = "is a whale a fish";
    pre.loadFromAsyncShards(split.baseSlice, split.gfSlice, split.manifest, function (idx, cb) {
      fetchLog.push(idx);
      setTimeout(function () { cb(null, split.shards[idx]); }, 1);
    });
    var r = res.think(q, 10);
    pre.thinkAsync(q, 10, function (err, p) {
      try {
        assert(!err, "thinkAsync errored: " + err);
        assertEq(p.text, r.text, "prefetched text");
        assertKVEq(res, pre, 3, 24, q.length + 1 + r.text.length, "prefetch vs resident");
        assertEq(fetchLog.length, 3 * (1 + p.stats.charsGenerated), "fetch count");
        assertEq(p.stats.layersLoaded, fetchLog.length, "layers loaded equals fetches");
        done();
      } catch (e) { done(e); }
    });
  });

  test("async prefetch: a damaged shard is reported through the callback", function (done) {
    var buf = makeTny2(24, 2, 2, 48, 9), split = S.splitTny2Shards(buf);
    var bad = split.shards[1].slice(0);
    new Uint8Array(bad)[7] ^= 0x40;
    var m = new S.Tiny2StreamModel();
    m.loadFromAsyncShards(split.baseSlice, split.gfSlice, split.manifest, function (idx, cb) {
      setTimeout(function () { cb(null, idx === 1 ? bad : split.shards[idx]); }, 0);
    });
    m.thinkAsync("hello", 4, function (err) {
      try { assert(err && String(err).indexOf("CRC32 mismatch") >= 0, "expected a CRC32 error, got " + err); done(); }
      catch (e) { done(e); }
    });
  });

  test("SovereignManifest: a flipped bit and a truncated file are both caught", function (done) {
    var buf = makeTny2(24, 2, 2, 48, 404), manifest = S.buildSovereignManifest(buf);
    var rot = buf.slice(0);
    new Uint8Array(rot)[manifest.layers[1].offset + 10] ^= 0x01;
    var m = new S.Tiny2StreamModel();
    m.loadFromBuffer(rot, "slice", manifest);
    var caught = false;
    try { m.think("hello", 4); } catch (e) { caught = String(e).indexOf("CRC32 mismatch") >= 0; }
    assert(caught, "a one-bit flip in layer 1 was not caught");
    var res = new S.Tiny2StreamModel(), residentCaught = false;
    try { res.loadFromBuffer(rot, "resident", manifest); } catch (e2) { residentCaught = String(e2).indexOf("CRC32 mismatch") >= 0; }
    assert(residentCaught, "a resident load must also check the manifest");
    var truncCaught = false;
    try { S.parseHeaderAndOffsets(buf.slice(0, buf.byteLength - 8)); } catch (e3) { truncCaught = String(e3).indexOf("truncated") >= 0; }
    assert(truncCaught, "a truncated file must be refused");
    var foreign = false;
    try { S.parseHeaderAndOffsets(new ArrayBuffer(64)); } catch (e4) { foreign = true; }
    assert(foreign, "a file without the TNY2 mark must be refused");
    assertEq(manifest.layers.length, 2, "one pin per layer");
    done();
  });

  test("zero-copy: a weight row is a view into the source buffer", function (done) {
    var buf = makeTny2(24, 2, 2, 48, 11), meta = S.parseHeaderAndOffsets(buf);
    var layer = S.parseLayerSlice(buf, meta.layers[0].offset, 24, 48, null);
    assert(layer.wq.bytes.buffer === buf, "the whole table is one view over the file's ArrayBuffer");
    var row = S.rowView(layer.wq, 3);
    assert(row.buffer === buf && row.length === 24, "a row view shares the file's ArrayBuffer");
    var before = row[0];
    new Int8Array(buf)[row.byteOffset] = before === 5 ? 6 : 5;
    assert(row[0] !== before, "writing the buffer must show through the view");
    done();
  });

  test("OffsetShelfStore: the full text comes back by byte offset, CRC checked, touching only its own bytes", function (done) {
    var article = "Frostgate sits at mile 53 along the Grand Road on the Snowline band (17,000 ft). " +
      new Array(12).join("Concrete terraces, covered walkways, heating stack, red rescue post, snowcats. ");
    assert(article.length > 500, "the test article should be longer than 500 letters");
    var store = new S.OffsetShelfStore();
    var info = store.buildFromRecords([
      { shelf: "caldera", topic: "Frostgate", fullText: article },
      { shelf: "bonetown", topic: "BoneTown", fullText: "The last gondola car up leaves at 5:07 PM and arrives at 5:21 PM." }
    ]);
    assertEq(info.count, 2, "two entries");
    var touched = 0;
    var hits = store.searchFull("Frostgate snowcats", 1, function (off, len) { touched += len; return store.blob.subarray(off, off + len); });
    assertEq(hits.length, 1, "one hit");
    assertEq(hits[0].fullText, article, "full text");
    assertEq(touched, article.length, "only the matching record's bytes are read");
    /* a damaged blob is noticed */
    store.blob[store.entries[1].offset + 3] ^= 1;
    var caught = false;
    try { store.searchFull("gondola", 1); } catch (e) { caught = String(e).indexOf("CRC32") >= 0; }
    assert(caught, "a changed byte must be caught");
    done();
  });

  test("ES5 only: the module has no arrow functions, let, const or template literals", function (done) {
    if (!isNode) { done(); return; }
    var src = require("fs").readFileSync(require("path").join(__dirname, "..", "evelyn_stream.js"), "utf8");
    var arrow = new RegExp("=" + ">"), lc = /(^|[\s;(])(let|const)\s+[A-Za-z_$]/m, tpl = /`/;
    assert(!arrow.test(src), "arrow function found");
    assert(!lc.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "let or const found");
    assert(!tpl.test(src), "template literal found");
    done();
  });

  var passed = 0, failed = 0, idx = 0;
  function next() {
    if (idx >= tests.length) {
      console.log("\n=== STREAMING SUITE: " + passed + " passed, " + failed + " failed ===");
      if (isNode) process.exit(failed > 0 ? 1 : 0);
      return;
    }
    var cur = tests[idx++], fin = false;
    function done(err) {
      if (fin) return; fin = true;
      if (err) { failed++; console.log("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
      else { passed++; console.log("[PASS] " + cur.name); }
      setTimeout(next, 0);
    }
    try { cur.fn(done); } catch (e) { done(e); }
  }
  console.log("=== EVELYN LAYER-STREAMING TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
