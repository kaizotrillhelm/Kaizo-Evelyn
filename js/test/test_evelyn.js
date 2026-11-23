/* Unit tests for evelyn_core.js. Run: node test/test_evelyn.js  (from the js folder) */
"use strict";
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var E = require("../evelyn_core.js");
var maker = require("../../tools/make_test_model.js");

var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ": " + (e && e.message ? e.message : e)); }
}
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

function rngInt(seed) {
  var s = seed >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
}
function buf2ab(b) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
function makeModel(opt) {
  var m = new E.Tiny2Model();
  m.loadFromArrayBuffer(buf2ab(maker.build(opt)));
  return m;
}
function fresh() {
  E.Storage.backend = null; E.Storage.clear();
  var lib = new E.LibraryStore("t_lib"); lib.loadStarterPack();
  var pm = new E.ProfileManager("t_pm");
  return { lib: lib, pm: pm };
}

/* ---------- independent reference LZW (array dictionary, no shared code) ---------- */
function refLzw(str) {
  var dict = [], i, codes = [], w = "";
  for (i = 0; i < 256; i++) dict.push(String.fromCharCode(i));
  for (i = 0; i < str.length; i++) {
    var c = str.charAt(i), wc = w + c;
    if (dict.indexOf(wc) >= 0) w = wc;
    else { codes.push(dict.indexOf(w)); dict.push(wc); w = c; }
  }
  if (w) codes.push(dict.indexOf(w));
  return codes;
}

/* ================================ LZW and base64 ================================ */
test("lzw matches an independent reference", function () {
  var samples = ["a", "aa", "aaaaaaaaaa", "hello hello hello", "abababababab", "TOBEORNOTTOBEORTOBEORNOT",
    "Boiling water for 1 minute kills bacteria."];
  samples.forEach(function (s) {
    var z = E.LZCodec.compress(s), codes = [];
    for (var i = 0; i < z.length; i += 2) codes.push(z[i] | (z[i + 1] << 8));
    eq(codes, refLzw(s), s);
  });
});
test("lzw round trip on random text", function () {
  var r = rngInt(7);
  for (var n = 0; n < 200; n++) {
    var len = r() % 300, s = "";
    for (var i = 0; i < len; i++) s += String.fromCharCode(32 + (r() % 6) * (1 + (r() % 3)));
    eq(E.LZCodec.decompress(E.LZCodec.compress(s)), s);
  }
});
test("lzw empty string and bad streams", function () {
  eq(E.LZCodec.compress("").length, 0);
  eq(E.LZCodec.decompress(new Uint8Array(0)), "");
  assert.throws(function () { E.LZCodec.decompress(new Uint8Array([1, 2, 3])); });
  assert.throws(function () { E.LZCodec.decompress(new Uint8Array([200, 1])); });
  assert.throws(function () { E.LZCodec.decompress(new Uint8Array([65, 0, 99, 9])); });
});
test("lzw shrinks repetitive text", function () {
  var s = new Array(200).join("water ");
  assert.ok(E.LZCodec.compress(s).length < s.length / 4);
});
test("base64 agrees with Buffer", function () {
  var r = rngInt(3);
  for (var len = 0; len < 40; len++) {
    var u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = r() & 255;
    var b = E.LZCodec.toBase64(u8);
    eq(b, Buffer.from(u8).toString("base64"));
    eq(Array.prototype.slice.call(E.LZCodec.fromBase64(b)), Array.prototype.slice.call(u8));
  }
});

/* ================================ text helpers ================================ */
test("fmtNum", function () {
  var cases = [[0, "0"], [-0, "0"], [42, "42"], [-7, "-7"], [3.5, "3.5"], [0.75, "0.75"], [1 / 3, "0.333333"],
    [2 / 3, "0.666667"], [0.1 + 0.2, "0.3"], [-0.0000001, "0"], [1234.5678901, "1234.56789"], [100, "100"],
    [1e12, "1000000000000"], [0.0078125, "0.007813"], [-2.5, "-2.5"], [0.000001, "0.000001"]];
  cases.forEach(function (c) { eq(E.fmtNum(c[0]), c[1], String(c[0])); });
});
test("valOf", function () {
  eq(E.valOf("42"), 42); eq(E.valOf("  -3.5abc"), -3.5); eq(E.valOf("abc"), 0); eq(E.valOf(".5"), 0.5);
  eq(E.valOf("+7"), 7); eq(E.valOf(""), 0); eq(E.valOf("1e3"), 1);
});
test("cleanAscii", function () {
  eq(E.cleanAscii("  hello   world  "), "hello world");
  eq(E.cleanAscii("it’s “ok” – fine"), "it's \"ok\" - fine");
  eq(E.cleanAscii("café"), "caf");
  eq(E.cleanAscii("aéb"), "a b");
  eq(E.cleanAscii("tab\there"), "tab here");
  eq(E.cleanAscii("line1\nline2"), "line1\nline2");
  eq(E.cleanAscii(null), "");
});
test("tokenizeWords drops stop words", function () {
  eq(E.tokenizeWords("What is the Gravity of Mars?"), ["gravity", "mars"]);
  eq(E.tokenizeWords(""), []);
});
test("xorshift32 matches a BigInt reference", function () {
  var g = new E.XorShift32(12345), x = 12345n, M = 0xFFFFFFFFn;
  for (var i = 0; i < 20; i++) {
    x ^= (x << 13n) & M; x ^= x >> 17n; x ^= (x << 5n) & M;
    eq(g.next(), Number(x) / 4294967296);
  }
});

/* ================================ library ================================ */
test("starter library has 16 entries and finds water", function () {
  var f = fresh();
  eq(f.lib.stats().entries, 16);
  var hits = f.lib.search("how do I purify water", 2);
  eq(hits[0].topic, "water purification");
  assert.ok(hits[0].fact.indexOf("Boiling") === 0);
});
test("library search ranks topic words above fact words and ties go to the lower id", function () {
  var lib = new E.LibraryStore("t_rank");
  lib.addEntry("zebra", "x", "an animal with stripes", "");
  lib.addEntry("stripes", "x", "a pattern of lines", "");
  lib.addEntry("pattern", "x", "stripes and dots", "");
  eq(lib.search("stripes", 3).map(function (h) { return h.id; }), [1, 0, 2]);
  eq(lib.search("nothing here", 3), []);
  eq(lib.search("the of a", 3), []);
  /* one topic word (3) beats two fact words (1 + 1), and a tie goes to the lower id */
  var lib2 = new E.LibraryStore("t_rank2");
  lib2.addEntry("filler", "x", "red and blue paint", "");
  lib2.addEntry("red", "x", "a colour", "");
  eq(lib2.search("red blue", 2).map(function (h) { return h.id; }), [1, 0]);
  eq(lib2.search("red", 2).map(function (h) { return h.id; }), [1, 0]);
  var lib3 = new E.LibraryStore("t_rank3");
  lib3.addEntry("one", "x", "shared word here", "");
  lib3.addEntry("two", "x", "shared word there", "");
  eq(lib3.search("shared", 2).map(function (h) { return h.id; }), [0, 1]);
});
test("library ingest chunks paragraphs", function () {
  var lib = new E.LibraryStore("t_ing");
  var para1 = "The camel stores fat in its hump and can go a long time without water in the desert.";
  var n = lib.ingestPlainText(para1 + "\n\nshort\n\n" + para1 + " " + para1, "book");
  eq(n, 1 + 2);
  eq(lib.records[0].topic, "The camel stores");
  eq(lib.records[0].cat, "book");
  assert.ok(lib.search("camel hump", 1).length === 1);
});
test("library text file round trip", function () {
  var f = fresh();
  var text = f.lib.toText(), lib2 = new E.LibraryStore("t_lib2");
  eq(lib2.fromText(text), 16);
  eq(lib2.search("gravity", 1)[0].topic, "gravity");
  eq(lib2.toText(), text);
});
test("library persists through Storage", function () {
  var f = fresh();
  f.lib.save();
  var lib2 = new E.LibraryStore("t_lib");
  assert.ok(lib2.load());
  eq(lib2.stats(), f.lib.stats());
  assert.ok(!new E.LibraryStore("other").load());
});
test("Storage.useDirectory writes files", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "evl-"));
  E.Storage.useDirectory(dir);
  try {
    E.Storage.setItem("k1", "v1");
    eq(E.Storage.getItem("k1"), "v1");
    eq(E.Storage.getItem("missing"), null);
    assert.ok(fs.readdirSync(dir).length === 1);
  } finally { E.Storage.backend = null; }
});

/* ================================ neural engine ================================ */
test("model loads and reports its shape", function () {
  var m = makeModel({ D: 24, L: 2, H: 4, HID: 48 });
  eq([m.D, m.L, m.H, m.HID, m.HD], [24, 2, 4, 48, 6]);
  eq(maker.build({}).length, E.tny2Size(24, 2, 48));
  var full = maker.build({ D: 96, L: 4, H: 4, HID: 256 });
  eq(full.length, E.tny2Size(96, 4, 256));
  var m2 = new E.Tiny2Model(); m2.loadFromArrayBuffer(buf2ab(full));
  eq(m2.D, 96);
});
test("model rejects bad files", function () {
  var m = new E.Tiny2Model(), good = maker.build({});
  var bad = Buffer.from(good); bad[0] = 88;
  assert.throws(function () { m.loadFromArrayBuffer(buf2ab(bad)); }, /TNY2/);
  assert.throws(function () { m.loadFromArrayBuffer(buf2ab(good.slice(0, good.length - 10))); }, /truncated/);
  assert.throws(function () { m.loadFromArrayBuffer(new ArrayBuffer(4)); });
  var odd = Buffer.from(good); odd.writeUInt16LE(5, 8);
  assert.throws(function () { m.loadFromArrayBuffer(buf2ab(odd)); }, /range/);
  assert.throws(function () { new E.Tiny2Model().step(2, 0); }, /No TNY2/);
});
test("model scores are finite and deterministic", function () {
  var a = makeModel({}), b = makeModel({});
  for (var p = 0; p < 10; p++) { a.step(30 + p, p); b.step(30 + p, p); }
  for (var i = 0; i < E.VOCAB; i++) { assert.ok(isFinite(a.score[i])); eq(a.score[i], b.score[i]); }
});
test("different seeds give different models", function () {
  var a = makeModel({ seed: 1 }), b = makeModel({ seed: 2 });
  a.step(40, 0); b.step(40, 0);
  assert.ok(a.score[10] !== b.score[10]);
});
test("greedy think is repeatable and uses many letters", function () {
  var m = makeModel({});
  var o1 = m.think("what is gravity", 0), o2 = m.think("what is gravity", 0);
  eq(o1, o2);
  assert.ok(o1.length > 20);
  var distinct = {}; for (var i = 0; i < o1.length; i++) distinct[o1.charAt(i)] = 1;
  assert.ok(Object.keys(distinct).length >= 6);
});
test("different prompts give different answers", function () {
  var m = makeModel({});
  assert.notStrictEqual(m.think("hello", 0), m.think("mars", 0));
});
test("pick: greedy takes the first maximum and sampling follows the seeded rng", function () {
  var m = makeModel({});
  for (var i = 0; i < E.VOCAB; i++) m.score[i] = -5;
  m.score[7] = 3; m.score[40] = 3;
  eq(m.pick(0), 7);
  m.score[7] = 1; m.score[40] = 2;
  m.rng = new E.XorShift32(5);
  var a = [], b;
  for (i = 0; i < 20; i++) a.push(m.pick(3));
  m.rng = new E.XorShift32(5); b = [];
  for (i = 0; i < 20; i++) b.push(m.pick(3));
  eq(a, b);
  a.forEach(function (t) { assert.ok(t === 7 || t === 40, "only near-best tokens: " + t); });
  m.rng = new E.XorShift32(5); m.score[7] = -5; m.score[40] = -5;
  eq(m.pick(3), 0);
});
test("sampling with a seed is repeatable", function () {
  var m = makeModel({});
  m.rng = new E.XorShift32(11); var a = m.think("tell me", 4);
  m.rng = new E.XorShift32(11); var b = m.think("tell me", 4);
  eq(a, b);
  m.rng = new E.XorShift32(12); assert.notStrictEqual(m.think("tell me", 4), a);
});
test("think ends when the model picks token 0 or 1", function () {
  var m = makeModel({});
  var realPick = m.pick, calls = 0;
  m.pick = function () { return ++calls > 3 ? 1 : 40; };
  eq(m.think("hi", 0), "FFF");
  m.pick = realPick;
});
test("kv21 export has the documented layout and a prefix import continues exactly", function () {
  var a = makeModel({}), b = makeModel({});
  var n = a.prime("SECRET:PIN=4921;");
  eq(n, 16);
  var kv = a.exportKVCache(n);
  eq(kv.length, 10 + 2 * n * 2 * (4 + 24));
  eq(String.fromCharCode(kv[0], kv[1], kv[2], kv[3]), "KV21");
  eq(new DataView(kv.buffer).getUint16(4, true), 24);
  eq(new DataView(kv.buffer).getUint16(6, true), 2);
  eq(new DataView(kv.buffer).getUint16(8, true), 16);
  eq(b.importKVCache(kv), 16);
  var ref = a.think("Q:PIN?A:", 0), got = b.think("Q:PIN?A:", 0);
  eq(got, ref);
  var c = makeModel({});
  assert.notStrictEqual(c.think("Q:PIN?A:", 0), ref);
  var ab = new E.Tiny2Model(); ab.loadFromArrayBuffer(buf2ab(maker.build({})));
  eq(ab.exportKVCache(n).length, kv.length);
});
test("kv21 import rejects mismatched or damaged data", function () {
  var a = makeModel({}), big = makeModel({ D: 32, H: 4, HID: 64 });
  a.prime("hello");
  var kv = a.exportKVCache(5);
  assert.throws(function () { big.importKVCache(kv); }, /mismatch/);
  var bad = new Uint8Array(kv); bad[0] = 0;
  assert.throws(function () { a.importKVCache(bad); }, /KV21/);
  assert.throws(function () { a.importKVCache(kv.subarray(0, 40)); }, /truncated/);
  assert.throws(function () { a.importKVCache(new Uint8Array(3)); });
});
test("prime and reset", function () {
  var m = makeModel({});
  eq(m.prime("abc"), 3); eq(m.prime("de"), 5); m.reset(); eq(m.kvPrefixLen, 0);
  var long = ""; for (var i = 0; i < 200; i++) long += "x";
  eq(m.prime(long), 126);
});
test("full size model loads and steps", function () {
  var m = makeModel({ D: 96, L: 4, H: 4, HID: 256 });
  var out = m.think("what is water", 0);
  assert.ok(out.length > 5);
});

/* ================================ profile and audio ================================ */
test("profile modes, xp and best mode", function () {
  var f = fresh();
  eq(f.pm.setMode("a"), "A"); eq(f.pm.setMode("zzz"), "A"); eq(f.pm.setMode(""), "M");
  f.pm.setMode("D");
  f.pm.recordSuccess("fractions"); f.pm.recordSuccess("fractions"); f.pm.recordSuccess("gravity", 25);
  eq(f.pm.profile.xp, 45);
  eq(f.pm.profile.masteredTopics, ["fractions", "gravity"]);
  eq(f.pm.profile.modeFeedback.D, 3);
  eq(f.pm.bestLearnedMode(), "D");
  var f2 = fresh(); eq(f2.pm.bestLearnedMode(), "M");
});
test("profile cfg round trip", function () {
  var f = fresh();
  f.pm.profile.name = "Leo"; f.pm.setMode("A");
  f.pm.recordSuccess("a|b topic");
  f.pm.profile.adventureState.room = "well";
  f.pm.profile.adventureState.solved.push("p_solar");
  f.pm.profile.adventureState.inventory.push("Clean Canteen (+20 XP)");
  f.pm.profile.recentQueries.push("what is up?");
  var cfg = f.pm.toCfg();
  var pm2 = new E.ProfileManager("t_pm2"); pm2.fromCfg(cfg);
  eq(pm2.profile.name, "Leo"); eq(pm2.profile.mode, "A"); eq(pm2.profile.xp, 10);
  eq(pm2.profile.masteredTopics, ["a b topic"]);
  eq(pm2.profile.adventureState, { room: "well", inventory: ["Clean Canteen (+20 XP)"], solved: ["p_solar"] });
  eq(pm2.profile.recentQueries, ["what is up?"]);
  eq(pm2.toCfg(), pm2.toCfg());
  var pm3 = new E.ProfileManager("t_pm3"); pm3.fromCfg("MODE=Q\nXP=abc\ngarbage\n=x\nNAME=\n");
  eq(pm3.profile.mode, "M"); eq(pm3.profile.xp, 0); eq(pm3.profile.name, "Explorer");
});
test("profile persists through Storage", function () {
  var f = fresh();
  f.pm.setMode("D"); f.pm.recordSuccess("x");
  var pm2 = new E.ProfileManager("t_pm"); pm2.load();
  eq(pm2.profile.mode, "D"); eq(pm2.profile.xp, 10);
});
test("audio speaks only in audio and mix modes and plans its tones", function () {
  E.AudioDriver.lastSpoken = "";
  E.AudioDriver.speak("hi", "R"); eq(E.AudioDriver.lastSpoken, "");
  E.AudioDriver.speak("hi", "D"); eq(E.AudioDriver.lastSpoken, "");
  E.AudioDriver.speak("hi", "A"); eq(E.AudioDriver.lastSpoken, "hi");
  E.AudioDriver.speak("yo", "M"); eq(E.AudioDriver.lastSpoken, "yo");
  var plan = E.AudioDriver.chirpPlan("A B");
  eq(plan.map(function (p) { return p.freq; }), [280 + (65 % 24) * 35, 0, 280 + (66 % 24) * 35]);
  eq(plan[2].startMs, 90);
  eq(E.AudioDriver.chirpPlan("this text is longer than fourteen").length, 14);
});

/* ================================ coding sandbox ================================ */
function run(src) { return E.CodeSandbox.run(src); }
test("sandbox lessons all run", function () {
  E.CODING_LESSONS.forEach(function (l) { assert.ok(run(l.starter).ok, l.title); });
  eq(run(E.CODING_LESSONS[0].starter).output, ["HELLO OASIS"]);
  eq(run(E.CODING_LESSONS[1].starter).output, ["42"]);
  eq(run(E.CODING_LESSONS[3].starter).output, ["FIND WELL"]);
});
test("sandbox draws a square", function () {
  var r = run(E.CODING_LESSONS[2].starter);
  eq(r.grid.split("\n")[4], ". . . . @ # # # . . . .");
  eq(r.grid.split("\n")[7], ". . . . # # # # . . . .");
});
test("sandbox expressions", function () {
  var ev = function (s) { return E.CodeSandbox.evalExpr(s, {}); };
  eq(ev("2 + 3 * 4"), 14); eq(ev("(2 + 3) * 4"), 20); eq(ev("-3 + 5"), 2); eq(ev("7 / 2"), 3.5);
  eq(ev("7 % 4"), 3); eq(ev("-7 % 4"), -3); eq(ev("5 / 0"), 0); eq(ev("5 % 0"), 0);
  eq(ev("3 < 4"), 1); eq(ev("3 >= 4"), 0); eq(ev("3 == 3"), 1); eq(ev("3 = 3"), 1); eq(ev("3 != 3"), 0);
  eq(ev("\"a\" + \"b\""), "ab"); eq(ev("\"a\" + 5"), "a5"); eq(ev("5 + \"a\""), "5a");
  eq(ev("\"abc\" < \"abd\""), 1); eq(ev("\"b\" == \"b\""), 1); eq(ev("\"3\" * 2"), 6);
  eq(ev("unknown + 1"), 1); eq(ev(""), 0); eq(ev("(1 + 2"), 3); eq(ev("1.5 * 2"), 3);
  eq(E.CodeSandbox.evalExpr("Water + 1", { WATER: 4 }), 5);
});
test("sandbox variables ignore case and repeat counts work", function () {
  var r = run("LET Total = 0\nREPEAT 5\nLET total = TOTAL + 2\nEND\nPRINT TOTAL");
  eq(r.output, ["10"]); eq(r.vars.TOTAL, 10);
  eq(run("REPEAT 0\nPRINT \"never\"\nEND\nPRINT \"after\"").output, ["after"]);
  eq(run("REPEAT 2\nREPEAT 3\nPRINT \"x\"\nEND\nEND").output.length, 6);
});
test("sandbox strings and conditionals", function () {
  var r = run("LET n = \"Leo\"\nPRINT \"Hi \" + n\nIF n == \"Leo\" THEN PRINT \"yes\"\nIF n == \"Bo\" THEN PRINT \"no\"\nIF 1 = 1 THEN LET z = 9\nPRINT z / 4");
  eq(r.output, ["Hi Leo", "yes", "2.25"]);
});
test("sandbox errors", function () {
  eq(run("END").error, "Line 1: END without REPEAT");
  eq(run("REPEAT 2\nPRINT 1").error, "Missing END for REPEAT");
  eq(run("DANCE").error, "Line 1: Unknown command 'DANCE'");
  eq(run("PRINT 1\nIF 1 PRINT 2").error, "Line 2: IF needs THEN");
  eq(run("LET x 5").error, "Line 1: LET needs '='");
  eq(run("LET 5x = 1").error, "Line 1: bad variable name '5x'");
  var loop = run("REPEAT 1000\nPRINT 1\nEND");
  assert.ok(!loop.ok); eq(loop.error, "Stopped after 500 steps (loop limit)"); assert.ok(loop.grid.length > 0);
  eq(run("PRINT").error, "Line 1: Unknown command 'PRINT'");
});
test("sandbox turtle stays on the grid and turns", function () {
  var r = run("MOVE 50\nTURN LEFT\nMOVE 20\nTURN RIGHT\nTURN LEFT\nMOVE -3");
  var rows = r.grid.split("\n");
  eq(rows.length, 12);
  assert.ok(rows[0].indexOf("@") < 0 || rows[0].split(" ").indexOf("@") >= 0);
  var c = run("CLEAR\nMOVE 1");
  eq(c.grid.split("\n")[4], ". . . . # @ . . . . . .");
  eq(run("# a comment\n\nPRINT 1").output, ["1"]);
});

/* ================================ adventure and tutor ================================ */
test("adventure walk-through", function () {
  var f = fresh(), adv = new E.AdventureEngine(f.pm, f.lib);
  assert.ok(adv.look().indexOf("== Solar Camp ==") === 0);
  eq(adv.command(""), adv.look());
  assert.ok(adv.command("go south").indexOf("You can't go 'south'. Exits: east, north") === 0);
  assert.ok(adv.command("not sure").indexOf("Not quite!") === 0);
  assert.ok(adv.command("HINT").indexOf("[Library Hint - water purification] Boiling water") === 0);
  var ok = adv.command("ANSWER boil it and strain through cloth");
  eq(ok, "CORRECT! Unlocked: Clean Canteen (+20 XP)\nXP: 20");
  assert.ok(adv.look().indexOf("[Solved! Reward: Clean Canteen (+20 XP)]") > 0);
  eq(adv.command("boil"), "CORRECT! Unlocked: Clean Canteen (+20 XP)\nXP: 20");
  assert.ok(adv.command("GO east").indexOf("== The Dry Well & Builder's Corner ==") === 0);
  assert.ok(adv.command("it is 5").indexOf("Brass Key") > 0);
  assert.ok(adv.command("go south").indexOf("Underground Library Vault") > 0);
  assert.ok(adv.command("0.75").indexOf("Master Oasis Key (+50 XP)") > 0);
  eq(f.pm.profile.xp, 90);
  eq(f.pm.profile.adventureState.solved.length, 3);
  eq(f.pm.profile.masteredTopics.length, 3);
  eq(adv.command("go north").split("\n")[0], "== The Dry Well & Builder's Corner ==");
  eq(adv.command("go west").split("\n")[0], "== Solar Camp ==");
  eq(adv.command("go north").split("\n")[0], "== Signal Tower ==");
  assert.ok(adv.command("five").indexOf("Signal Boost") > 0);
});
test("tutor answers arithmetic locally and shapes the answer to the learner", function () {
  var f = fresh(), t = new E.SwarmTutor(f.lib, f.pm, new E.Tiny2Model());
  eq(t.ask("what is 18*4").text, "[MIX] 18*4 = 72\nApplied Example: If you split or group 18*4, the result is 72.");
  eq(t.ask("7 / 2 ?").text.split("\n")[0], "[MIX] 7 / 2 = 3.5");
  eq(t.ask("what is 3 + 4 ?").source, "Compressed Library");
  var modes = { R: "[READ] GRAVITY\n", A: "[AUDIO] Gravity pulls", D: "[DO] Try applying 'gravity':\nAction: Drop a pebble", M: "[MIX] Gravity pulls" };
  Object.keys(modes).forEach(function (m) {
    f.pm.setMode(m);
    var r = t.ask("tell me about gravity");
    assert.ok(r.text.indexOf(modes[m]) === 0, m + " -> " + r.text);
  });
  f.pm.setMode("D");
  assert.ok(t.ask("gravity").text.indexOf("Mini-Check: Can you explain 'gravity'") > 0);
  var none = t.ask("zzzz qqqq");
  eq(none.source, "Offline Guide"); assert.ok(none.text.indexOf("I could not find 'zzzz qqqq'") === 0);
  eq(f.pm.profile.recentQueries.length, 9);
  for (var i = 0; i < 30; i++) t.ask("q" + i);
  eq(f.pm.profile.recentQueries.length, 20);
});
test("tutor lets the neural net speak when loaded", function () {
  var f = fresh(), m = makeModel({}), t = new E.SwarmTutor(f.lib, f.pm, m);
  var r = t.ask("gravity");
  eq(r.source, "Library + TNY2");
  assert.ok(r.text.indexOf("Tiny-Net says: ") > 0);
  eq(t.ask("zzzz qqqq").source, "TNY2 Neural Weights");
});

/* ================================ multi shelf deliberation ================================ */
test("multi shelf search and the pre-answer check", function () {
  var f = fresh();
  E.Storage.clear();
  var ml = new E.MultiShelfLibrary();
  ml.addShelf("stem", [{ topic: "triangle", fact: "A right triangle with sides 3 and 4 has a diagonal of 5.", ex: "Use a rope." }]);
  ml.addShelf("civics", [{ topic: "triangle vote", fact: "A vote of 2 out of 3 members passes a motion.", ex: "" }]);
  var hits = ml.slideSearch("triangle", null, 2);
  eq(hits.map(function (h) { return h.sourceId; }), ["stem#0", "civics#0"]);
  eq(ml.slideSearch("triangle", ["civics"], 2).length, 1);
  var sw = new E.DeliberationSwarm(ml, f.pm, null);
  var r = sw.askWithSources("triangle", ["stem"]);
  eq(r.sources, ["[stem#0: triangle]"]);
  assert.ok(r.answer.indexOf("diagonal of 5. (Example: Use a rope.) [stem#0]") > 0);
  eq(r.internalConversation[1], "Checker: VERIFIED against [stem#0: triangle]");
  var none = sw.askWithSources("zzzz", null);
  eq(none.answer, "No verified source found across shelves. Try importing a .txt module for this topic.");
  eq(none.internalConversation[1], "Checker: REJECTED - no matching source in persistent library.");
  var model = makeModel({}), sw2 = new E.DeliberationSwarm(ml, f.pm, model);
  var r2 = sw2.askWithSources("triangle", ["stem"]);
  assert.ok(r2.internalConversation.length === 2);
});
test("the checker rejects a number the sources do not hold", function () {
  var f = fresh(), ml = new E.MultiShelfLibrary();
  ml.addShelf("a", [{ topic: "moon", fact: "The moon circles the Earth.", ex: "" }]);
  var sw = new E.DeliberationSwarm(ml, f.pm, null);
  var hits = ml.slideSearch("moon", null, 1);
  var bad = sw._verifyDraft("The moon has 9 craters [a#0]", hits);
  assert.ok(!bad.ok);
  eq(bad.transcript[1], "Checker: WARNING - number '9' not backed by source; clamping to source text.");
  assert.ok(sw._verifyDraft("The moon circles the Earth [a#0]", hits).ok);
});
test("quantized dot product stays close to the float one", function () {
  var r = rngInt(9), q = [], k = new Int8Array(64), ref = 0, i;
  for (i = 0; i < 64; i++) { q.push((r() % 2000) / 1000 - 1); k[i] = (r() % 255) - 127; }
  for (i = 0; i < 64; i++) ref += q[i] * k[i] * 0.01;
  var got = E.quantizedQKDot(q, k, 0, 0.01, 64);
  assert.ok(Math.abs(got - ref) < Math.max(0.05, Math.abs(ref) * 0.05), got + " vs " + ref);
  eq(E.quantizedQKDot([0, 0], new Int8Array([5, 5]), 0, 1, 2), 0);
  eq(E.quantizedQKDot([127, -127], new Int8Array([2, 3]), 0, 1, 2), -127);
});

/* ================================ packets ================================ */
test("frame packet is 12 bytes and round trips", function () {
  var u = E.EvelynNet.packFrame(7, 12.5, -3.25, 1.5, -0.5, 5, 513);
  eq(u.length, 12);
  eq(E.EvelynNet.unpackFrame(u), { playerId: 7, buttons: 5, seq: 513, x: 12.5, y: -3.25, vx: 1.5, vy: -0.5 });
  var big = E.EvelynNet.unpackFrame(E.EvelynNet.packFrame(300, 9999, -9999, 999, -999, 300, 70000));
  eq([big.playerId, big.buttons, big.seq], [44, 44, 4464]);
  eq(big.x, 32767 / 16); eq(big.y, -32768 / 16); eq(big.vx, 32767 / 256); eq(big.vy, -32768 / 256);
});
test("bot brain packet is 6 bytes plus one per weight", function () {
  var w = [0.5, -0.25, 1.0, 0.0, -1.0, 0.123];
  var u = E.EvelynNet.packBotBrain(w);
  eq(u.length, 12);
  var back = E.EvelynNet.unpackBotBrain(u);
  for (var i = 0; i < w.length; i++) assert.ok(Math.abs(back[i] - w[i]) < 1 / 127 + 1e-6);
  eq(E.EvelynNet.packBotBrain(new Array(30).fill(0.3)).length, 36);
  eq(Array.prototype.slice.call(E.EvelynNet.unpackBotBrain(E.EvelynNet.packBotBrain([0, 0]))), [0, 0]);
});

/* ================================ report ================================ */
console.log("evelyn js: " + passed + " passed, " + failed + " failed");
failures.forEach(function (f) { console.log("  FAIL " + f); });
process.exit(failed ? 1 : 0);
