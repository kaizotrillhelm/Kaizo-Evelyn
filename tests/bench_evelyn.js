/* bench_evelyn.js - speed, size, memory and accuracy of Evelyn's parts, old code against new code
   and against outside baselines.
     node tests/bench_evelyn.js            the whole suite
     node tests/bench_evelyn.js --quick    shorter runs
     node tests/bench_evelyn.js --only=3   one section (1 to 5; a list like --only=2,3 works)
     node --jitless tests/bench_evelyn.js --quick --only=3   the same with the JIT off, as an old engine runs it
     node tests/bench_evelyn.js --json     numbers only, as JSON (for a log or a diff between two machines)

   "old" is js/test/legacy/ (the files as they were before the speed work); "new" is js/. Nothing
   here needs a trained TINY.BIN: models are generated (tools/make_test_model.js) with random
   weights, so the engine's speed is real and its text is not meaningful.

   Every speed line is the best of several runs of at least 120 ms each (the first run is thrown
   away as warm-up), so a single slow moment does not show. Numbers depend on the machine and on
   the Node version; compare two lines of the same run, not lines from different machines. */
"use strict";
var zlib = require("zlib");
var path = require("path");
var N = require("../js/evelyn_core.js");
var O = require("../js/test/legacy/evelyn_core_before_fast.js");
var NS = require("../js/evelyn_stream.js");
var OS = require("../js/test/legacy/evelyn_stream_before_fast.js");
var P = require("../js/evelyn_potato.js");
var maker = require("../tools/make_test_model.js");

var QUICK = process.argv.indexOf("--quick") >= 0, AS_JSON = process.argv.indexOf("--json") >= 0;
var ONLY = (process.argv.filter(function (a) { return /^--only=/.test(a); })[0] || "").slice(7);   /* --only=3 or --only=2,3 */
function want(n) { return !ONLY || ("," + ONLY + ",").indexOf("," + n + ",") >= 0; }
var report = {}, MIN_MS = QUICK ? 40 : 120, RUNS = QUICK ? 3 : 5;

var problems = [];
function check(ok, what) { if (!ok) problems.push(what); }
function out() { if (!AS_JSON) console.log.apply(console, arguments); }
function nowMs() { var t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; }

/* ops per second: how many calls fit in MIN_MS, repeated RUNS times, best run kept */
function rate(fn) {
  fn();
  var per = 1, t0 = nowMs(), best = 0;
  while (nowMs() - t0 < 5) { for (var i = 0; i < per; i++) fn(); per *= 2; if (per > 1e7) break; }
  var iters = Math.max(1, Math.round(per / 2));
  for (var run = 0; run < RUNS; run++) {
    var s = nowMs(), n = 0;
    do { for (var k = 0; k < iters; k++) fn(); n += iters; } while (nowMs() - s < MIN_MS);
    var ops = n * 1000 / (nowMs() - s);
    if (ops > best) best = ops;
  }
  return best;
}
function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : n.toFixed(1); }
function versus(section, label, oldFn, newFn, unit, extra) {
  var a = rate(oldFn), b = rate(newFn);
  out("  " + (label + "                                        ").slice(0, 44) + "old " + (fmt(a) + " " + unit + "      ").slice(0, 14) +
    "new " + (fmt(b) + " " + unit + "      ").slice(0, 14) + "x" + (b / a).toFixed(2) + (extra ? "  " + extra : ""));
  (report[section] = report[section] || {})[label] = { old: a, "new": b, speedup: b / a, unit: unit };
}
function single(section, label, fn, unit) {
  var a = rate(fn);
  out("  " + (label + "                                        ").slice(0, 44) + fmt(a) + " " + unit);
  (report[section] = report[section] || {})[label] = { rate: a, unit: unit };
}
function note(section, key, value, text) { (report[section] = report[section] || {})[key] = value; out("  " + text); }
function head(s) { out("\n=== " + s + " ==="); }
function buf2ab(b) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
function bytesEq(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

out("Evelyn benchmark  node " + process.version + "  " + process.platform + " " + process.arch + (QUICK ? "  (quick)" : ""));

/* ---------------------------------------------------------------- 1. coding lab */
if (want(1)) {
head("1. Coding lab (CodeSandbox)");
(function () {
  var cases = [
    { name: "operator precedence", src: "PRINT 2 + 3 * 4 - 6 / 2", out: ["11"] },
    { name: "division and remainder by zero", src: "PRINT 10 / 0\nPRINT 10 % 0", out: ["0", "0"] },
    { name: "text and numbers", src: "LET x = 5\nPRINT \"val=\" + x", out: ["val=5"] },
    { name: "nested REPEAT and IF", src: "LET s = 0\nREPEAT 5\n  REPEAT 4\n    LET s = s + 1\n  END\nEND\nIF s == 20 THEN PRINT \"OK\"", out: ["OK"] },
    { name: "REPEAT 0 skips its body", src: "LET a = 1\nREPEAT 0\n  LET a = 99\nEND\nPRINT a", out: ["1"] },
    { name: "names in any case", src: "let Water = 3\nPRINT water + WATER", out: ["6"] },
    { name: "the 500-step limit stops a loop", src: "REPEAT 1000\n  LET x = x + 1\nEND", ok: false }
  ];
  var pass = 0;
  cases.forEach(function (c) {
    var r = N.CodeSandbox.run(c.src), ok = c.ok === false ? !r.ok : (r.ok && JSON.stringify(r.output) === JSON.stringify(c.out));
    if (ok) pass++; else out("  FAIL: " + c.name + " " + JSON.stringify(r));
  });
  check(pass === cases.length, "the coding lab gave a wrong answer on a fixed case");
  note("sandbox", "accuracy", pass + "/" + cases.length, "accuracy: " + pass + " of " + cases.length + " fixed cases right");
  var prog = "CLEAR\nLET sum = 0\nREPEAT 40\n  LET sum = sum + 3 * 7 - 2\n  MOVE 1\n  TURN RIGHT\nEND\nPRINT sum";
  versus("sandbox", "40-pass loop with the turtle", function () { O.CodeSandbox.run(prog); }, function () { N.CodeSandbox.run(prog); }, "runs/s");
  var tiny = "PRINT 2 + 3 * 4";
  versus("sandbox", "one line", function () { O.CodeSandbox.run(tiny); }, function () { N.CodeSandbox.run(tiny); }, "runs/s");
  var sum = 0, tx = 4, ty = 4, dir = 0, dx = [1, 0, -1, 0], dy = [0, 1, 0, -1];
  single("sandbox", "same loop written in plain JavaScript", function () {
    sum = 0; tx = 4; ty = 4; dir = 0;
    for (var i = 0; i < 40; i++) { sum += 3 * 7 - 2; tx += dx[dir]; ty += dy[dir]; dir = (dir + 1) & 3; }
  }, "runs/s");
})();
}

/* ---------------------------------------------------------------- 2. LZW and base64 */
if (want(2)) {
head("2. Text compression (LZCodec)");
(function () {
  var fs = require("fs"), prose = "", i;
  ["../README.md", "../SOURCES.md", "../js/README.md", "../c/README.md"].forEach(function (f) {
    try { prose += fs.readFileSync(path.join(__dirname, f), "utf8") + "\n"; } catch (e) { /* a missing file is left out */ }
  });
  var big = prose.replace(/[^\x20-\x7E\n]/g, " "), one = N.STARTER_FACTS[0].fact, r = rng(5), noise = "";
  for (i = 0; i < 20000; i++) noise += String.fromCharCode(32 + Math.floor(r() * 90));
  var zNew = N.LZCodec.compress(big), zOld = O.LZCodec.compress(big), zlibB = zlib.deflateSync(Buffer.from(big, "utf8"));
  check(bytesEq(zNew, zOld) && N.LZCodec.decompress(zNew) === big, "the compressor no longer equals the old one or does not round trip");
  note("lzw", "same_bytes", bytesEq(zNew, zOld), "same output bytes as the old compressor: " + bytesEq(zNew, zOld));
  note("lzw", "roundtrip", N.LZCodec.decompress(zNew) === big, "round trip exact: " + (N.LZCodec.decompress(zNew) === big));
  out("  sizes of " + big.length + " characters of Evelyn's own README text: LZW " + zNew.length + " bytes (" + (zNew.length / big.length * 100).toFixed(1) +
    "%), zlib deflate " + zlibB.length + " bytes (" + (zlibB.length / big.length * 100).toFixed(1) + "%)");
  report.lzw.sizes = { raw: big.length, lzw: zNew.length, zlib: zlibB.length };
  var nz = N.LZCodec.compress(noise), noz = zlib.deflateSync(Buffer.from(noise));
  out("  sizes of 20000 random printable characters: LZW " + nz.length + " bytes, zlib " + noz.length + " bytes");
  versus("lzw", "compress one fact (" + one.length + " chars)", function () { O.LZCodec.compress(one); }, function () { N.LZCodec.compress(one); }, "ops/s");
  versus("lzw", "compress " + (big.length >> 10) + " KB of prose", function () { O.LZCodec.compress(big); }, function () { N.LZCodec.compress(big); }, "ops/s");
  versus("lzw", "compress 20 KB of noise", function () { O.LZCodec.compress(noise); }, function () { N.LZCodec.compress(noise); }, "ops/s");
  single("lzw", "zlib.deflateSync, " + (big.length >> 10) + " KB (baseline)", function () { zlib.deflateSync(big); }, "ops/s");
  versus("lzw", "decompress " + (big.length >> 10) + " KB", function () { O.LZCodec.decompress(zOld); }, function () { N.LZCodec.decompress(zNew); }, "ops/s");
  var b64 = N.LZCodec.toBase64(zNew), nodeB64 = Buffer.from(zNew).toString("base64");
  check(b64 === nodeB64, "base64 text differs from Node's");
  note("lzw", "base64_same_as_node", b64 === nodeB64, "base64 text same as Node's Buffer: " + (b64 === nodeB64));
  versus("lzw", "toBase64 " + (zNew.length >> 10) + " KB", function () { O.LZCodec.toBase64(zOld); }, function () { N.LZCodec.toBase64(zNew); }, "ops/s");
  versus("lzw", "fromBase64 " + (b64.length >> 10) + " KB", function () { O.LZCodec.fromBase64(b64); }, function () { N.LZCodec.fromBase64(b64); }, "ops/s");
  single("lzw", "Buffer.from(base64) (baseline)", function () { Buffer.from(b64, "base64"); }, "ops/s");
})();
}

/* ---------------------------------------------------------------- 3. the TNY2 engine */
if (want(3)) {
head("3. Neural engine (Tiny2Model, Tiny2StreamModel, optional integer engine)");
var SHAPE = { D: 96, L: 4, H: 4, HID: 256, seed: 2026 };   /* the shape of the real TINY.BIN */
(function () {
  var buf = buf2ab(maker.build(SHAPE)), man = NS.buildSovereignManifest(buf);
  out("  generated weights: " + (buf.byteLength / 1024).toFixed(1) + " KB (D=96, L=4, H=4, HID=256)");
  function load(M) { var m = new M.Tiny2Model(); m.loadFromArrayBuffer(buf); return m; }
  var mOld = load(O), mNew = load(N), prompt = "what is the capital of estonia";
  var tOld = mOld.think(prompt, 0), tNew = mNew.think(prompt, 0);
  check(tOld === tNew, "engine text differs from the old engine");
  note("engine", "text_same_as_old", tOld === tNew, "text of old and new engine equal: " + (tOld === tNew) + "  (" + JSON.stringify(tNew.slice(0, 24)) + "...)");
  var sOld = (mOld.reset(), mOld.step(5, 0), Array.prototype.slice.call(mOld.score)), sNew = (mNew.reset(), mNew.step(5, 0), Array.prototype.slice.call(mNew.score));
  note("engine", "scores_bit_equal", JSON.stringify(sOld) === JSON.stringify(sNew), "scores of old and new engine bit-equal: " + (JSON.stringify(sOld) === JSON.stringify(sNew)));

  versus("engine", "think(), core engine", function () { mOld.reset(); mOld.think(prompt, 0); }, function () { mNew.reset(); mNew.think(prompt, 0); }, "answers/s");
  var chars = tNew.length + prompt.length;
  out("  (one answer here = " + prompt.length + " letters read and " + tNew.length + " written)");

  var a = new OS.Tiny2StreamModel(), b = new NS.Tiny2StreamModel(), a2 = new OS.Tiny2StreamModel(), b2 = new NS.Tiny2StreamModel();
  a.loadFromBuffer(buf, "resident", man); b.loadFromBuffer(buf, "resident", man);
  a2.loadFromBuffer(buf, "slice", man); b2.loadFromBuffer(buf, "slice", man);
  note("engine", "stream_text_same", a.think(prompt).text === b.think(prompt).text && b.think(prompt).text === tNew,
    "streamed text equals the core engine's: " + (b.think(prompt).text === tNew));
  versus("engine", "think(), streaming, resident", function () { a.think(prompt); }, function () { b.think(prompt); }, "answers/s");
  versus("engine", "think(), streaming, slice + CRC", function () { a2.think(prompt); }, function () { b2.think(prompt); }, "answers/s", "(CRC once per layer; was at every use)");
  b2.source.verifyEvery = true;
  single("engine", "think(), streaming, slice + CRC every use", function () { b2.think(prompt); }, "answers/s");
  b2.source.verifyEvery = false;

  /* the optional integer engine: speed, then how far its answers move */
  [1, 2].forEach(function (level) {
    var mp = load(N); P.install(mp, level);
    var base = rate(function () { mNew.reset(); mNew.think(prompt, 0); }), pot = rate(function () { mp.reset(); mp.think(prompt, 0); });
    out("  integer engine, level " + level + ": " + fmt(pot) + " answers/s vs " + fmt(base) + " for the exact engine  x" + (pot / base).toFixed(2));
    (report.engine["potato_level_" + level] = { rate: pot, exact_rate: base, speedup: pot / base });
    var prompts = ["what is the capital of estonia", "how do plants make oxygen", "boil water for one minute", "3 4 5 triangle", "ask echo about mars and the whale",
      "a loop repeats a block of code", "the sun rises in the east", "binary 101 is five", "gravity pulls things down", "share three loaves among four"];
    var cmp = P.compare(load(N), P.install(load(N), level), prompts);
    out("    accuracy on random weights, " + cmp.steps + " letters: cosine mean " + cmp.cosineMean.toFixed(5) + ", worst " + cmp.cosineMin.toFixed(5) +
      ", largest score error " + (cmp.maxRelErr * 100).toFixed(2) + "% of the score range, best letter the same " + (cmp.top1Share * 100).toFixed(1) +
      "%, whole answers the same " + cmp.textSame + "/" + cmp.texts);
    report.engine["potato_level_" + level].accuracy = cmp;
  });
  out("  (random weights give nearly flat scores, so the best letter flips easily; a trained TINY.BIN must be measured the same way)");

  /* the integer dot product of the packet module against the float product */
  var q = new Float32Array(64), kf = new Float32Array(64), k8 = new Int8Array(64), rr = rng(99), kb = 0, i;
  for (i = 0; i < 64; i++) { q[i] = (rr() - 0.5) * 4; kf[i] = (rr() - 0.5) * 4; if (Math.abs(kf[i]) > kb) kb = Math.abs(kf[i]); }
  var ks = kb / 127;
  for (i = 0; i < 64; i++) k8[i] = Math.round(kf[i] / ks);
  var exact = 0; for (i = 0; i < 64; i++) exact += q[i] * kf[i];
  var qd = N.quantizedQKDot(q, k8, 0, ks, 64);
  out("  quantizedQKDot against the float dot product: exact " + exact.toFixed(5) + ", integer " + qd.toFixed(5) + ", error " +
    (Math.abs(exact - qd) / (Math.abs(exact) + 1e-9) * 100).toFixed(2) + "%");

  /* memory: a loaded engine, resident against slice */
  var before = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  var holders = [];
  for (i = 0; i < 5; i++) holders.push(load(N));
  var after = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  report.engine.bytes_per_core_model = (after - before) / 5;
  out("  memory of one loaded core engine: about " + ((after - before) / 5 / 1024).toFixed(0) + " KB (file " + (buf.byteLength / 1024).toFixed(0) + " KB plus caches)");
  holders.length = 0;
})();
}

/* ---------------------------------------------------------------- 4. library and search */
if (want(4)) {
head("4. Library search, offset store, number checker");
(function () {
  function big(M, copies) {
    var lib = new M.LibraryStore("bench_" + copies);
    for (var i = 0; i < copies; i++) M.STARTER_FACTS.forEach(function (f) { lib.addEntry(f.topic + " vol" + i, f.cat, f.fact + " Edition " + i + ".", f.ex); });
    return lib;
  }
  [4, 60, 250].forEach(function (copies) {
    var lo = big(O, copies), ln = big(N, copies), n = lo.records.length, q = "how does photosynthesis make oxygen";
    var same = JSON.stringify(lo.search(q, 2)) === JSON.stringify(ln.search(q, 2));
    check(same, "search results differ from the old search at " + n + " entries");
    versus("search", n + " entries, top 2", function () { lo.search(q, 2); }, function () { ln.search(q, 2); }, "queries/s", same ? "" : "RESULTS DIFFER");
  });
  /* linear scan baseline: every record decompressed and searched for the words */
  var lin = big(N, 60), words = ["photosynthesis", "oxygen"];
  single("search", "linear scan of 960 entries (baseline)", function () {
    for (var i = 0; i < lin.records.length; i++) {
      var rec = lin.readRecord(lin.records[i]), t = (rec.topic + " " + rec.fact).toLowerCase();
      for (var w = 0; w < words.length; w++) if (t.indexOf(words[w]) >= 0) break;
    }
  }, "queries/s");
  /* recall: does the right entry come first for its own topic? */
  var lib = big(N, 1), hit = 0;
  N.STARTER_FACTS.forEach(function (f) { var h = lib.search(f.topic, 1); if (h.length && h[0].topic.indexOf(f.topic) === 0) hit++; });
  note("search", "top1_own_topic", hit + "/" + N.STARTER_FACTS.length, "the entry comes first when its own topic is the query: " + hit + " of " + N.STARTER_FACTS.length);

  var S = new NS.OffsetShelfStore(), recs = [];
  for (var i = 0; i < 500; i++) { var f = N.STARTER_FACTS[i % N.STARTER_FACTS.length]; recs.push({ shelf: f.cat, topic: f.topic + " " + i, fullText: f.fact + " " + f.ex + new Array(400).join(" ") }); }
  var meta = S.buildFromRecords(recs), hits = S.searchFull("pythagorean triangle", 2), read = hits.reduce(function (a, h) { return a + h.bytesRead; }, 0);
  note("search", "offset_io", read / meta.totalBytes, "OffsetShelfStore: a query read " + read + " of " + meta.totalBytes + " bytes (" + (read / meta.totalBytes * 100).toFixed(2) + "%)");

  /* the number checker: 1000 in the source, 100 in the draft */
  function swarm(M) {
    var ms = new M.MultiShelfLibrary(), pm = new M.ProfileManager("bench_pm_" + M.LZCodec.MAX_CODE);
    ms.addShelf("health", [{ topic: "rehydration", fact: "Mix 6 teaspoons sugar in 1000 ml water." }]);
    var s = new M.DeliberationSwarm(ms, pm, null), hits = ms.slideSearch("rehydration", ["health"], 1);
    return { bogus: s._verifyDraft("Mix 100 teaspoons sugar.", hits).ok, wrong: s._verifyDraft("Mix 99 teaspoons sugar.", hits).ok, right: s._verifyDraft("Mix 6 teaspoons sugar in 1000 ml water.", hits).ok };
  }
  var so = swarm(O), sn = swarm(N);
  out("  number checker, draft '100' against a source that says 1000: old accepts " + so.bogus + ", new accepts " + sn.bogus + " (the new one is right to refuse)");
  out("    draft '99': old " + so.wrong + ", new " + sn.wrong + "; draft with the source's own numbers: old " + so.right + ", new " + sn.right);
  report.swarm = { old: so, "new": sn };
})();
}

/* ---------------------------------------------------------------- 5. packets */
if (want(5)) {
head("5. Packets for slow links (EvelynNet)");
(function () {
  var frame = { playerId: 3, x: 124.375, y: -42.125, vx: 3.125, vy: -1.75, buttons: 5, seq: 4091 };
  var packed = N.EvelynNet.packFrame(frame.playerId, frame.x, frame.y, frame.vx, frame.vy, frame.buttons, frame.seq), un = N.EvelynNet.unpackFrame(packed);
  var json = Buffer.byteLength(JSON.stringify(frame));
  out("  one frame: " + packed.length + " bytes against " + json + " bytes of JSON (" + ((1 - packed.length / json) * 100).toFixed(1) + "% smaller)");
  out("  round trip error: x " + Math.abs(frame.x - un.x) + ", vx " + Math.abs(frame.vx - un.vx));
  report.net = { packed: packed.length, json: json };
  single("net", "pack + unpack", function () { N.EvelynNet.unpackFrame(N.EvelynNet.packFrame(3, 124.375, -42.125, 3.125, -1.75, 5, 4091)); }, "frames/s");
  single("net", "JSON stringify + parse (baseline)", function () { JSON.parse(JSON.stringify(frame)); }, "frames/s");
  var w = new Float32Array(256), r = rng(3), i, worst = 0;
  for (i = 0; i < 256; i++) w[i] = (r() - 0.5) * 2;
  var back = N.EvelynNet.unpackBotBrain(N.EvelynNet.packBotBrain(w));
  for (i = 0; i < 256; i++) worst = Math.max(worst, Math.abs(w[i] - back[i]));
  out("  bot brain of 256 weights: " + N.EvelynNet.packBotBrain(w).length + " bytes against " + (256 * 4) + " as floats, largest weight error " + worst.toFixed(5));
})();
}

if (problems.length) { console.log("\nPROBLEMS:\n  " + problems.join("\n  ")); process.exitCode = 1; }
if (AS_JSON) console.log(JSON.stringify(report, null, 1));
else out("\nDone.");
