/* tny2_parity_node.js <TINY.BIN> <parity.json> - the engine's half of tests/check_tny2_parity.py.
   Feeds the same tokens to js/evelyn_core.js and compares its next-letter scores with torch's, position by position. */
"use strict";
var fs = require("fs");
var E = require("../js/evelyn_core.js");

var buf = fs.readFileSync(process.argv[2]);
var ref = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
var m = new E.Tiny2Model();
m.loadFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

function argmax(a) { var b = 0; for (var i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }
function corr(a, b) {
  var n = a.length, ma = 0, mb = 0, i; for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  var sab = 0, saa = 0, sbb = 0; for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
  return sab / Math.sqrt(saa * sbb);
}
var agree = 0, minCorr = 1, sumCorr = 0, p;
for (p = 0; p < ref.tokens.length; p++) {
  m.step(ref.tokens[p], p);
  var mine = Array.prototype.slice.call(m.score), theirs = ref.logits[p];
  if (argmax(mine) === argmax(theirs)) agree++;
  var c = corr(mine, theirs); sumCorr += c; if (c < minCorr) minCorr = c;
}
var n = ref.tokens.length, frac = agree / n, meanCorr = sumCorr / n;
console.log("parity: best letter agrees at " + agree + " of " + n + " positions; score correlation mean " + meanCorr.toFixed(4) + ", lowest " + minCorr.toFixed(4));
if (frac < 0.85 || meanCorr < 0.98 || minCorr < 0.9) { console.log("PARITY FAILED"); process.exit(1); }
console.log("PARITY OK");
