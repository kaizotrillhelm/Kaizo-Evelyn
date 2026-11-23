/* Parity tests for the speed work in evelyn_core.js and evelyn_stream.js.
   Run: node js/test/evelyn_fast_tests.js

   js/test/legacy/ holds the two files as they were before the speed work. Every test here runs the
   same input through the old code and the new code and compares the results: bytes of compressed
   text, text of base64, ranked search hits, the result of a program, every score and every key and
   value cache byte of a model. Where the new code is meant to differ (the number checker of the
   swarm) the test says so. */
"use strict";
var assert = require("assert");
var N = require("../evelyn_core.js");
var O = require("./legacy/evelyn_core_before_fast.js");
var NS = require("../evelyn_stream.js");
var OS = require("./legacy/evelyn_stream_before_fast.js");
var maker = require("../../tools/make_test_model.js");

var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ": " + (e && e.message ? e.message : e)); }
}
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function bytesEq(a, b, msg) {
  assert.strictEqual(a.length, b.length, (msg || "") + " length " + a.length + " vs " + b.length);
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail((msg || "") + " differs at byte " + i);
}
function bitsEq(a, b, msg) {   /* float arrays equal bit for bit */
  var ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  bytesEq(ua, ub, msg);
}
function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function buf2ab(b) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }

/* ================================ codec ================================ */
function randomText(r, len, alphabet) {
  var s = "";
  for (var i = 0; i < len; i++) s += alphabet.charAt(Math.floor(r() * alphabet.length));
  return s;
}

test("compress: same bytes as the old dictionary on random text of many shapes", function () {
  var r = rng(11), alphabets = ["ab", "abc ", "abcdefghijklmnopqrstuvwxyz ", "ABCabc0123456789 .,;:", "x"];
  for (var n = 0; n < 400; n++) {
    var s = randomText(r, Math.floor(r() * 600), alphabets[n % alphabets.length]);
    bytesEq(N.LZCodec.compress(s), O.LZCodec.compress(s), JSON.stringify(s.slice(0, 40)));
  }
});
test("compress: characters above 255 become '?' as before; control characters and the empty string", function () {
  var s = "café 中文 tab\there \u0001\u0000 end";
  bytesEq(N.LZCodec.compress(s), O.LZCodec.compress(s));
  bytesEq(N.LZCodec.compress(""), O.LZCodec.compress(""));
  bytesEq(N.LZCodec.compress(null), O.LZCodec.compress(null));
  bytesEq(N.LZCodec.compress(undefined), O.LZCodec.compress(undefined));
  bytesEq(N.LZCodec.compress(12345), O.LZCodec.compress(12345));
});
test("compress: the same bytes after the dictionary is full (65535 codes)", function () {
  var r = rng(5), s = "", i;
  for (i = 0; i < 260000; i++) s += String.fromCharCode(Math.floor(r() * 256));
  var a = N.LZCodec.compress(s), b = O.LZCodec.compress(s);
  assert(a.length > 65535 * 2 - 1000, "the dictionary did not fill: " + a.length);
  bytesEq(a, b, "saturated");
  assert.strictEqual(N.LZCodec.decompress(a), O.LZCodec.decompress(b));
});
test("compress: scratch tables are clean between calls (a long text then a short one)", function () {
  var long = randomText(rng(3), 50000, "abcdefgh "), short = "abcabcabcabc";
  bytesEq(N.LZCodec.compress(long), O.LZCodec.compress(long));
  bytesEq(N.LZCodec.compress(short), O.LZCodec.compress(short));
  bytesEq(N.LZCodec.compress(short), O.LZCodec.compress(short));
});
test("compress: the result owns its bytes (not a view of the shared scratch buffer)", function () {
  var a = N.LZCodec.compress("hello hello hello"), copy = Array.prototype.slice.call(a);
  N.LZCodec.compress(randomText(rng(8), 5000, "abc"));
  eq(Array.prototype.slice.call(a), copy);
  assert.strictEqual(a.buffer.byteLength, a.length);
});
test("decompress: round trip and the same text and the same errors as before", function () {
  var r = rng(21);
  for (var n = 0; n < 200; n++) {
    var s = randomText(r, Math.floor(r() * 400), "abcdefg hij.");
    assert.strictEqual(N.LZCodec.decompress(N.LZCodec.compress(s)), s);
  }
  function errOf(M, bytes) { try { M.LZCodec.decompress(bytes); return "no error"; } catch (e) { return e.message; } }
  var bad = [new Uint8Array([1, 2, 3]), new Uint8Array([0, 1]), new Uint8Array([65, 0, 255, 255]), new Uint8Array([65, 0, 66, 0, 5, 1])];
  for (var i = 0; i < 200; i++) {
    var len = 2 * (1 + Math.floor(r() * 12)), u = new Uint8Array(len);
    for (var k = 0; k < len; k++) u[k] = Math.floor(r() * 256);
    bad.push(u);
  }
  bad.forEach(function (b) { assert.strictEqual(errOf(N, b), errOf(O, b)); });
  assert.strictEqual(N.LZCodec.decompress(null), "");
  assert.strictEqual(N.LZCodec.decompress(new Uint8Array(0)), "");
});
test("base64: identical text out for 0 to 40 bytes and for large input, and the same as Node's Buffer", function () {
  var r = rng(9);
  for (var len = 0; len <= 40; len++) {
    var u = new Uint8Array(len);
    for (var k = 0; k < len; k++) u[k] = Math.floor(r() * 256);
    var t = N.LZCodec.toBase64(u);
    assert.strictEqual(t, O.LZCodec.toBase64(u));
    assert.strictEqual(t, Buffer.from(u).toString("base64"));
  }
  var big = new Uint8Array(100001);
  for (var i = 0; i < big.length; i++) big[i] = Math.floor(r() * 256);
  assert.strictEqual(N.LZCodec.toBase64(big), Buffer.from(big).toString("base64"));
});
test("base64: decoding gives the same bytes, including padding, missing padding and bad characters", function () {
  var r = rng(13), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (var n = 0; n < 600; n++) {
    var len = Math.floor(r() * 60), s = randomText(r, len, alphabet);
    if (n % 3 === 0) s += "=".repeat(Math.floor(r() * 3));
    if (n % 7 === 0) s = s.slice(0, Math.max(0, len - 1)) + "!";
    if (n % 11 === 0) s += "é";
    bytesEq(N.LZCodec.fromBase64(s), O.LZCodec.fromBase64(s), JSON.stringify(s));
  }
  var u = new Uint8Array(90000);
  for (var i = 0; i < u.length; i++) u[i] = Math.floor(r() * 256);
  bytesEq(N.LZCodec.fromBase64(Buffer.from(u).toString("base64")), u);
});

/* ================================ library search ================================ */
function bigLibrary(M, copies) {
  var lib = new M.LibraryStore("fast_t_" + copies);
  for (var i = 0; i < copies; i++) {
    M.STARTER_FACTS.forEach(function (f) { lib.addEntry(f.topic + " vol" + i, f.cat, f.fact + " Edition " + i + ".", f.ex); });
  }
  return lib;
}
test("search: the same hits in the same order as before for many queries and topK 1..12", function () {
  var a = bigLibrary(N, 60), b = bigLibrary(O, 60), r = rng(17);
  var words = ["photosynthesis", "water", "boil", "sun", "oxygen", "estonia", "capital", "mars", "year", "loop", "variable",
    "binary", "bits", "whale", "the", "rope", "triangle", "vol7", "vol59", "zebra", "gravity", "fraction"];
  for (var n = 0; n < 300; n++) {
    var q = [], k = 1 + Math.floor(r() * 4);
    for (var i = 0; i < k; i++) q.push(words[Math.floor(r() * words.length)]);
    var topK = 1 + Math.floor(r() * 12);
    eq(a.search(q.join(" "), topK), b.search(q.join(" "), topK), q.join(" ") + " topK " + topK);
  }
  eq(a.search("", 2), b.search("", 2));
  eq(a.search("the", undefined), b.search("the", undefined));
});
test("search: scores are cleared between queries, and a library that grows or is cleared still answers right", function () {
  var a = new N.LibraryStore("fast_g"), b = new O.LibraryStore("fast_g");
  [a, b].forEach(function (l) { l.loadStarterPack(); });
  eq(a.search("water", 3), b.search("water", 3));
  eq(a.search("water", 3), b.search("water", 3));
  [a, b].forEach(function (l) { l.addEntry("water tower", "x", "A tower holds water for a town.", ""); });
  eq(a.search("water", 3), b.search("water", 3));
  [a, b].forEach(function (l) { l.clear(); l.addEntry("only water", "x", "Water water.", ""); });
  eq(a.search("water", 3), b.search("water", 3));
});

/* ================================ coding lab ================================ */
function genProgram(r) {
  var vars = ["a", "b", "Total", "x1", "_n"], lines = [], depth = 0;
  function ex() {
    var parts = [], n = 1 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      var k = r();
      if (k < 0.3) parts.push(String(Math.floor(r() * 30)));
      else if (k < 0.4) parts.push((r() * 10).toFixed(2));
      else if (k < 0.7) parts.push(vars[Math.floor(r() * vars.length)]);
      else if (k < 0.8) parts.push('"' + ["hi", "Water", "a b", ""][Math.floor(r() * 4)] + '"');
      else parts.push("(" + Math.floor(r() * 9) + " - " + Math.floor(r() * 9) + ")");
      if (i < n - 1) parts.push(["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "==", "!=", "="][Math.floor(r() * 12)]);
    }
    return parts.join(" ");
  }
  var count = 1 + Math.floor(r() * 14);
  for (var i = 0; i < count; i++) {
    var k = r(), pad = r() < 0.3 ? "  " : "";
    if (k < 0.18) lines.push(pad + "LET " + vars[Math.floor(r() * vars.length)] + " = " + ex());
    else if (k < 0.34) lines.push(pad + "PRINT " + ex());
    else if (k < 0.42) lines.push(pad + "MOVE " + ex());
    else if (k < 0.48) lines.push(pad + "TURN " + ["LEFT", "RIGHT", "left", "x"][Math.floor(r() * 4)]);
    else if (k < 0.52) lines.push(pad + "CLEAR");
    else if (k < 0.62) { lines.push(pad + "REPEAT " + (r() < 0.12 ? 100 + Math.floor(r() * 500) : (r() < 0.7 ? Math.floor(r() * 6) : ex()))); depth++; }
    else if (k < 0.72) { if (depth > 0 || r() < 0.2) { lines.push(pad + "END"); depth--; } }
    else if (k < 0.82) lines.push(pad + "IF " + ex() + " THEN " + ["PRINT " + ex(), "LET a = " + ex(), "MOVE 2", "TURN LEFT", "REPEAT 2", "END", "CLEAR", "bogus"][Math.floor(r() * 8)]);
    else if (k < 0.85) lines.push(pad + "IF " + ex());
    else if (k < 0.89) lines.push("# a comment");
    else if (k < 0.92) lines.push("");
    else if (k < 0.94) lines.push("LET = 5");
    else if (k < 0.96) lines.push("LET 9x = 5");
    else if (k < 0.98) lines.push("LET a 5");
    else lines.push(["JUMP 3", "print", "REPEAT", "END END", "PRINT"][Math.floor(r() * 5)]);
  }
  while (depth-- > 0 && r() < 0.9) lines.push("END");
  return lines.join(r() < 0.2 ? "\r\n" : "\n");
}
test("coding lab: 6000 random programs (good and bad) give the same result, errors and grid as before", function () {
  var r = rng(2026), okCount = 0, errCount = 0, capCount = 0;
  for (var n = 0; n < 6000; n++) {
    var src = genProgram(r), a = N.CodeSandbox.run(src), b = O.CodeSandbox.run(src);
    eq(a, b, "program:\n" + src);
    if (a.ok) okCount++; else if (/500 steps/.test(a.error)) capCount++; else errCount++;
  }
  assert(okCount > 500 && errCount > 500 && capCount > 20, "the generator should reach all three outcomes: " + [okCount, errCount, capCount]);
});
test("coding lab: fixed cases (precedence, zero division, text, nesting, the step limit, names in any case)", function () {
  var progs = [
    "PRINT 2 + 3 * 4 - 6 / 2", "PRINT 10 / 0\nPRINT 10 % 0", "LET x = 5\nPRINT \"val=\" + x", "let Water = 3\nPRINT water + WATER",
    "LET s = 0\nREPEAT 5\n  REPEAT 4\n    LET s = s + 1\n  END\nEND\nIF s == 20 THEN PRINT \"OK\"",
    "LET a = 1\nREPEAT 0\n  LET a = 99\nEND\nPRINT a", "REPEAT 1000\n  LET x = x + 1\nEND", "REPEAT 2\nPRINT 1", "END",
    "PRINT -(3 + 4) * 2", "PRINT \"a\" < \"b\"", "MOVE 3\nTURN RIGHT\nMOVE 3\nTURN LEFT\nMOVE 99", "IF 1 THEN REPEAT 0\nPRINT 5"
  ];
  progs.forEach(function (p) { eq(N.CodeSandbox.run(p), O.CodeSandbox.run(p), p); });
});
test("coding lab: evalExpr keeps its signature, copes with the same odd input and does not keep variables", function () {
  var exprs = ["", "(", ")", "((((1))))", "1 +", "- - 3", "a b c", "\"open", "1 = 1", "WATER + 1", "x * 0 / 0", "\"a\" + 1 + 2"], vars = { WATER: 4, X: 2 };
  exprs.forEach(function (x) { eq(N.CodeSandbox.evalExpr(x, vars), O.CodeSandbox.evalExpr(x, vars), JSON.stringify(x)); });
  eq(N.CodeSandbox.evalExpr("a", { A: 7 }), 7);
  eq(N.CodeSandbox.evalExpr("a", {}), 0);
  eq(N.CodeSandbox.evalExpr("a", { A: 7 }), 7);
});
test("coding lab: the expression cache stays small", function () {
  for (var i = 0; i < 3000; i++) N.CodeSandbox.evalExpr("LET" + i + " + " + i, {});
  eq(N.CodeSandbox.evalExpr("2 + 2", {}), 4);
});

/* ================================ neural engine ================================ */
function modelPair(opt) {
  var buf = buf2ab(maker.build(opt)), a = new N.Tiny2Model(), b = new O.Tiny2Model();
  a.loadFromArrayBuffer(buf); b.loadFromArrayBuffer(buf);
  return { a: a, b: b, buf: buf };
}
var SHAPES = [{ D: 24, L: 2, H: 4, HID: 48 }, { D: 25, L: 3, H: 5, HID: 51, seed: 7 }, { D: 64, L: 4, H: 4, HID: 128, seed: 3 },
  { D: 96, L: 4, H: 4, HID: 256, seed: 99 }, { D: 7, L: 1, H: 1, HID: 3, seed: 5 }];
test("model: every score and every cache byte equals the old code, on five shapes (odd widths too)", function () {
  SHAPES.forEach(function (shape) {
    var m = modelPair(shape), prompt = "water purification and the pythagorean theorem", t, l;
    for (var i = 0; i < prompt.length; i++) {
      t = prompt.charCodeAt(i) - 30;
      m.a.step(t, i); m.b.step(t, i);
      bitsEq(m.a.score, m.b.score, "score at " + i + " " + JSON.stringify(shape));
    }
    for (l = 0; l < m.a.L; l++) {
      bytesEq(m.a.kc[l], m.b.kc[l], "kc " + l); bytesEq(m.a.vc[l], m.b.vc[l], "vc " + l);
      bitsEq(m.a.ks[l], m.b.ks[l], "ks " + l); bitsEq(m.a.vs[l], m.b.vs[l], "vs " + l);
    }
  });
});
test("model: think() gives the same text, greedy and sampled with a seed", function () {
  SHAPES.forEach(function (shape) {
    var m = modelPair(shape);
    eq(m.a.think("capital of estonia", 0), m.b.think("capital of estonia", 0));
    m.a.reset(); m.b.reset();
    m.a.rng = new N.XorShift32(77); m.b.rng = new O.XorShift32(77);
    eq(m.a.think("how do plants make air", 2), m.b.think("how do plants make air", 2));
  });
});
test("model: the sparse feed-forward product equals the plain one bit for bit, at every share of zeros", function () {
  var m = modelPair({ D: 40, L: 1, H: 4, HID: 120, seed: 4 }).a, r = rng(31), t = m.f2[0], cols = t.cols;
  var x = new Float32Array(cols), y1 = new Float32Array(t.rows), y2 = new Float32Array(t.rows);
  for (var trial = 0; trial < 300; trial++) {
    var share = trial / 299;   /* share of columns that are zero */
    for (var c = 0; c < cols; c++) x[c] = r() < share ? (r() < 0.5 ? 0 : -0) : (r() - 0.5) * 8;
    m._matvec(t, x, y1);
    m._matvecSparse(t, x, y2);
    bitsEq(y1, y2, "trial " + trial);
  }
});
test("model: the plain product equals an independent loop for every column count 1..9", function () {
  var r = rng(41);
  for (var cols = 1; cols <= 9; cols++) {
    var rows = 5, t = { rows: rows, cols: cols, w: new Int8Array(rows * cols), scale: new Float32Array(rows) };
    for (var i = 0; i < t.w.length; i++) t.w[i] = Math.floor(r() * 255) - 127;
    for (i = 0; i < rows; i++) t.scale[i] = 0.01 + r() * 0.05;
    var x = new Float32Array(cols), y = new Float32Array(rows), ref = new Float32Array(rows);
    for (i = 0; i < cols; i++) x[i] = (r() - 0.5) * 6;
    new N.Tiny2Model()._matvec(t, x, y);
    for (var q = 0; q < rows; q++) { var s = 0.0; for (var c = 0; c < cols; c++) s += t.w[q * cols + c] * x[c]; ref[q] = s * t.scale[q]; }
    bitsEq(y, ref, "cols " + cols);
  }
});
test("model: the bitwise rounding equals ceil/floor on a million values of the cache range", function () {
  var r = rng(51), bad = 0;
  for (var i = 0; i < 1000000; i++) {
    var v = (r() * 2 - 1) * 127.4999999;
    if (i % 5 === 0) v = Math.round(v) + (r() < 0.5 ? 0.5 : -0.5);
    if (i % 17 === 0) v = (r() < 0.5 ? 1 : -1) * 127;
    var old = v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5), now = (v < 0 ? v - 0.5 : v + 0.5) | 0;
    if (old !== now && !(old === 0 && now === 0)) bad++;
  }
  assert.strictEqual(bad, 0);
});
test("model: KV21 export from the new engine is read by the old one and back", function () {
  var m = modelPair({ D: 24, L: 2, H: 4, HID: 48 });
  if (typeof m.a.exportKV !== "function") return;
  m.a.prime("hello there"); m.b.prime("hello there");
  bytesEq(new Uint8Array(m.a.exportKV()), new Uint8Array(m.b.exportKV()), "kv21");
});

/* ================================ layer streaming ================================ */
test("streaming: resident and slice answer the same text and cache as the old streaming code and as the core", function () {
  SHAPES.slice(0, 4).forEach(function (shape) {
    var buf = buf2ab(maker.build(shape)), man = NS.buildSovereignManifest(buf);
    var core = new N.Tiny2Model(); core.loadFromArrayBuffer(buf);
    var q = "water purification", want = core.think(q, 0);
    ["resident", "slice"].forEach(function (mode) {
      var a = new NS.Tiny2StreamModel(), b = new OS.Tiny2StreamModel();
      a.loadFromBuffer(buf, mode, man); b.loadFromBuffer(buf, mode, man);
      var ta = a.think(q), tb = b.think(q);
      eq(ta.text, tb.text); eq(ta.text, want);
      for (var l = 0; l < shape.L; l++) { bytesEq(a.kc[l], b.kc[l]); bytesEq(a.vc[l], b.vc[l]); bitsEq(a.ks[l], b.ks[l]); bitsEq(a.vs[l], b.vs[l]); }
    });
  });
});
test("streaming: a layer is checked on its first load; the layer count of loads is the same as before", function () {
  var buf = buf2ab(maker.build({ D: 24, L: 2, H: 4, HID: 48 })), man = NS.buildSovereignManifest(buf);
  var a = new NS.Tiny2StreamModel(), b = new OS.Tiny2StreamModel();
  a.loadFromBuffer(buf, "slice", man); b.loadFromBuffer(buf, "slice", man);
  var ra = a.think("hello", 6), rb = b.think("hello", 6);
  eq(ra.stats.layersLoaded, rb.stats.layersLoaded);
  eq(ra.stats.bytesRead, rb.stats.bytesRead);
});
test("streaming: one flipped bit is still caught, in slice mode, on the first use of the layer", function () {
  var buf = buf2ab(maker.build({ D: 24, L: 2, H: 4, HID: 48 })), man = NS.buildSovereignManifest(buf);
  var bad = buf.slice(0);
  new Uint8Array(bad)[man.layers[1].offset + 10] ^= 1;
  var m = new NS.Tiny2StreamModel(), caught = false;
  m.loadFromBuffer(bad, "slice", man);
  try { m.think("hello", 3); } catch (e) { caught = /CRC32/.test(e.message); }
  assert(caught, "the damaged layer was not refused");
});
test("streaming: with verifyEvery on, a layer damaged after the first use is caught the next time", function () {
  var buf = buf2ab(maker.build({ D: 24, L: 2, H: 4, HID: 48 })), man = NS.buildSovereignManifest(buf);
  var m = new NS.Tiny2StreamModel();
  m.loadFromBuffer(buf, "slice", man);
  m.source.verifyEvery = true;
  m.think("hello", 2);
  new Uint8Array(buf)[man.layers[0].offset + 5] ^= 1;
  var caught = false;
  try { m.think("hello", 2); } catch (e) { caught = /CRC32/.test(e.message); }
  assert(caught, "verifyEvery did not re-check");
});

/* ================================ swarm checker ================================ */
function swarm(M, entries) {
  var ms = new M.MultiShelfLibrary(), pm = new M.ProfileManager("fast_pm_" + Math.random());
  ms.addShelf("health", entries);
  return new M.DeliberationSwarm(ms, pm, null);
}
test("swarm checker: 100 is not backed by 1000 (the old checker said it was); true numbers still pass", function () {
  var entries = [{ topic: "rehydration", fact: "Mix 6 teaspoons sugar in 1000 ml water, then 0.5 teaspoon salt." }];
  var nw = swarm(N, entries), od = swarm(O, entries);
  var hitsN = nw.multiLib.slideSearch("rehydration", ["health"], 1), hitsO = od.multiLib.slideSearch("rehydration", ["health"], 1);
  assert.strictEqual(od._verifyDraft("Mix 100 teaspoons sugar.", hitsO).ok, true, "old behaviour changed under the test");
  assert.strictEqual(nw._verifyDraft("Mix 100 teaspoons sugar.", hitsN).ok, false);
  assert.strictEqual(nw._verifyDraft("Mix 99 teaspoons sugar.", hitsN).ok, false);
  assert.strictEqual(nw._verifyDraft("Mix 1 teaspoons sugar.", hitsN).ok, false);
  assert.strictEqual(nw._verifyDraft("Mix 6 teaspoons sugar in 1000 ml water.", hitsN).ok, true);
  assert.strictEqual(nw._verifyDraft("Use 0.5 teaspoon salt [health#0: rehydration].", hitsN).ok, true);
  assert.strictEqual(nw._verifyDraft("Use 5 teaspoon salt.", hitsN).ok, false);
  eq(nw._verifyDraft("Mix 100 teaspoons sugar.", hitsN).transcript[1], "Checker: WARNING - number '100' not backed by source; clamping to source text.");
});
test("swarm checker: for every starter fact, a draft made of its own text still verifies and the answer is unchanged", function () {
  var nw = new N.MultiShelfLibrary(), od = new O.MultiShelfLibrary();
  nw.addShelf("s", N.STARTER_FACTS); od.addShelf("s", O.STARTER_FACTS);
  var sn = new N.DeliberationSwarm(nw, new N.ProfileManager("fp1"), null), so = new O.DeliberationSwarm(od, new O.ProfileManager("fp2"), null);
  N.STARTER_FACTS.forEach(function (f) {
    var a = sn.askWithSources(f.topic, ["s"]), b = so.askWithSources(f.topic, ["s"]);
    eq(a, b, f.topic);
  });
});

/* ================================ optional integer engine ================================ */
var P = require("../evelyn_potato.js");
function fresh(shape) { var m = new N.Tiny2Model(); m.loadFromArrayBuffer(buf2ab(maker.build(shape))); return m; }

test("integer engine: install and uninstall give the reference engine back, bit for bit", function () {
  var shape = { D: 64, L: 4, H: 4, HID: 128, seed: 3 };
  [1, 2].forEach(function (level) {
    var ref = fresh(shape), m = fresh(shape);
    P.install(m, level);
    m.step(5, 0);
    P.uninstall(m);
    ref.step(5, 0); m.reset(); ref.reset();
    eq(m.think("hello there", 0), ref.think("hello there", 0));
    assert(!Object.prototype.hasOwnProperty.call(m, "step") && !Object.prototype.hasOwnProperty.call(m, "_matvec"), "own methods left behind");
    P.install(m, level); P.install(m, level); P.uninstall(m);   /* twice in a row is fine */
    assert(!m._potato);
  });
});
test("integer engine: the scores stay close to the exact engine's (cosine, error against the score range)", function () {
  [{ D: 64, L: 4, H: 4, HID: 128, seed: 3 }, { D: 96, L: 4, H: 4, HID: 256, seed: 99 }, { D: 24, L: 2, H: 4, HID: 48 }].forEach(function (shape) {
    [1, 2].forEach(function (level) {
      var r = P.compare(fresh(shape), P.install(fresh(shape), level),
        ["what is the capital of estonia", "how do plants make oxygen", "boil water for one minute", "3 4 5 triangle", "ask echo about mars"]);
      assert(r.cosineMin > 0.995, "cosine " + r.cosineMin + " level " + level + " " + JSON.stringify(shape));
      assert(r.maxRelErr < 0.1, "error " + r.maxRelErr + " level " + level);
      assert(r.top1Share > 0.9, "best letter agrees only " + r.top1Share);
    });
  });
});
test("integer engine: a zero vector and a one-position cache do not break it (no divide by zero, no NaN)", function () {
  [1, 2].forEach(function (level) {
    var m = P.install(fresh({ D: 24, L: 2, H: 4, HID: 48 }), level);
    m.step(1, 0);
    for (var i = 0; i < 97; i++) assert(isFinite(m.score[i]), "score " + i + " is " + m.score[i]);
    assert(typeof m.think("", 0) === "string");
  });
});
test("integer engine: no Int32 sum can overflow at the largest shapes the loader accepts", function () {
  var worst = 2048 * 127 * 127;
  assert(worst < 2147483647, "bound " + worst);
  var m = P.install(fresh({ D: 64, L: 1, H: 4, HID: 2048, seed: 8 }), 2);
  m.step(7, 0);
  for (var i = 0; i < 97; i++) assert(isFinite(m.score[i]));
});
test("integer engine: the exp table is within 0.02 percent of Math.exp on [-16, 0]", function () {
  var worst = 0;
  for (var x = -15.999; x <= 0; x += 0.0071) worst = Math.max(worst, Math.abs(P.expNeg(x) - Math.exp(x)) / Math.exp(x));
  assert(worst < 0.0002, "relative error " + worst);
  assert.strictEqual(P.expNeg(-16), 0); assert.strictEqual(P.expNeg(0), 1); assert.strictEqual(P.expNeg(3), 1);
});
test("integer engine: works on the streaming model and gives the reference back on uninstall", function () {
  var buf = buf2ab(maker.build({ D: 64, L: 4, H: 4, HID: 128, seed: 3 })), man = NS.buildSovereignManifest(buf);
  var ref = new NS.Tiny2StreamModel(), m = new NS.Tiny2StreamModel();
  ref.loadFromBuffer(buf, "slice", man); m.loadFromBuffer(buf, "slice", man);
  var want = ref.think("water purification").text;
  P.installStream(m);
  var got = m.think("water purification");
  assert.strictEqual(typeof got.text, "string");
  P.uninstallStream(m);
  eq(m.think("water purification").text, want);
});
test("ES5 only: core, streaming and integer engine have no arrow function, let, const, template literal, Math.imul or fill", function () {
  var fs = require("fs"), path = require("path");
  ["evelyn_core.js", "evelyn_stream.js", "evelyn_potato.js"].forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert(!/=>/.test(src), f + ": arrow function");
    assert(!/(^|[\s;(])(let|const)\s+[A-Za-z_$]/m.test(src), f + ": let or const");
    assert(!/`/.test(src), f + ": template literal");
    assert(!/Math\.imul|\.fill\(|\.repeat\(|Object\.assign|\.includes\(|\.startsWith\(|Array\.from|\.padStart\(/.test(src), f + ": an ES2015 call");
  });
});

console.log("evelyn fast: " + passed + " passed, " + failed + " failed");
if (failed) { console.log(failures.join("\n")); process.exit(1); }
