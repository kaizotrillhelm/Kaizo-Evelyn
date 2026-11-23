/* make_test_model.js - writes a deterministic random TNY2 file for tests.
   The weights are random, so the model produces letters but no meaning.
   It exercises the same code path as a trained TINY.BIN of the same shape.

   node make_test_model.js out.bin [D L H HID seed]
   Default shape is small (D=24 L=2 H=4 HID=48) so the BASIC interpreter stays quick.
   Pass 96 4 4 256 for the shape of the real TINY.BIN. */
"use strict";
var fs = require("fs");

var VOCAB = 97, CTX = 128;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(opt) {
  opt = opt || {};
  var D = opt.D || 24, L = opt.L || 2, H = opt.H || 4, HID = opt.HID || 48;
  var rnd = mulberry32(opt.seed === undefined ? 2026 : opt.seed);
  var size = 12 + (VOCAB + CTX) * (4 + D) +
    L * (4 * D + 4 * D * (4 + D) + 4 * D + HID * (4 + D) + D * (4 + HID)) + 4 * D;
  var buf = new ArrayBuffer(size), v = new DataView(buf), off = 0;
  function u16(x) { v.setUint16(off, x, true); off += 2; }
  function f32(x) { v.setFloat32(off, x, true); off += 4; }
  function i8(x) { v.setInt8(off, x); off += 1; }
  function randInt8() { return Math.floor(rnd() * 255) - 127; }
  function table(rows, cols, scaleFn) {
    for (var r = 0; r < rows; r++) {
      f32(scaleFn(r));
      for (var c = 0; c < cols; c++) i8(randInt8());
    }
  }
  function gains(n) { for (var i = 0; i < n; i++) f32(0.9 + 0.2 * rnd()); }

  v.setUint8(0, 84); v.setUint8(1, 78); v.setUint8(2, 89); v.setUint8(3, 50); off = 4;
  u16(D); u16(L); u16(H); u16(HID);
  /* tokens 0 and 1 (stop and end of question) get tiny rows so they rarely win */
  table(VOCAB, D, function (r) { return r < 2 ? 0.0002 : 0.002; });
  table(CTX, D, function () { return 0.006; });
  var sq = 1 / (73 * Math.sqrt(D)), sh = 1 / (73 * Math.sqrt(HID));
  for (var l = 0; l < L; l++) {
    gains(D);
    table(D, D, function () { return sq; });
    table(D, D, function () { return sq; });
    table(D, D, function () { return sq; });
    table(D, D, function () { return sq * 2; });
    gains(D);
    table(HID, D, function () { return sq; });
    table(D, HID, function () { return sh * 2; });
  }
  gains(D);
  if (off !== size) throw new Error("size mismatch " + off + " vs " + size);
  return Buffer.from(buf);
}

module.exports = { build: build };

if (require.main === module) {
  var a = process.argv.slice(2);
  if (!a[0]) { console.error("usage: node make_test_model.js out.bin [D L H HID seed]"); process.exit(2); }
  var b = build({ D: +a[1] || 24, L: +a[2] || 2, H: +a[3] || 4, HID: +a[4] || 48, seed: a[5] === undefined ? 2026 : +a[5] });
  fs.writeFileSync(a[0], b);
  console.log("wrote " + a[0] + " (" + b.length + " bytes)");
}
