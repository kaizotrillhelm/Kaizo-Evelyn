/* evelyn_proto.js - line protocol used by tests/run_conformance.js.
   Usage: node evelyn_proto.js script.txt
   Every edition (JS, C, BASIC) reads the same script and prints the same lines. */
"use strict";
var fs = require("fs");
var E = require("./evelyn_core.js");

function unesc(s) {
  var bytes = [], i = 0;
  while (i < s.length) {
    var c = s.charAt(i);
    if (c === "\\" && i + 1 < s.length) {
      var d = s.charAt(i + 1);
      if (d === "n") { bytes.push(10); i += 2; continue; }
      if (d === "t") { bytes.push(9); i += 2; continue; }
      if (d === "\\") { bytes.push(92); i += 2; continue; }
      if (d === "x" && /^[0-9a-fA-F]{2}$/.test(s.substr(i + 2, 2))) { bytes.push(parseInt(s.substr(i + 2, 2), 16)); i += 4; continue; }
    }
    var b = Buffer.from(c, "utf8");
    for (var k = 0; k < b.length; k++) bytes.push(b[k]);
    i++;
  }
  return Buffer.from(bytes).toString("utf8");
}

function esc(s) {
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c === 92) out += "\\\\";
    else if (c === 10) out += "\\n";
    else if (c === 9) out += "\\t";
    else if (c >= 32 && c <= 126) out += s.charAt(i);
    else out += "\\x" + ("0" + (c & 255).toString(16)).slice(-2);
  }
  return out;
}

function hex(u8) {
  var s = "";
  for (var i = 0; i < u8.length; i++) s += ("0" + u8[i].toString(16)).slice(-2);
  return s;
}
function unhex(h) {
  var out = [];
  for (var i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return new Uint8Array(out);
}
function fnv1a(u8) {
  var h = 0x811c9dc5;
  for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}
function fmtList(a) {
  var s = [];
  for (var i = 0; i < a.length; i++) s.push(E.fmtNum(a[i]));
  return s.join(",");
}
function numList(s) {
  var out = [];
  if (!s) return out;
  var p = s.split(",");
  for (var i = 0; i < p.length; i++) out.push(E.valOf(p[i]));
  return out;
}

var lib = new E.LibraryStore("proto_lib");
var pm = new E.ProfileManager("proto_profile");
var model = new E.Tiny2Model();
var tutor = new E.SwarmTutor(lib, pm, model);
var adv = new E.AdventureEngine(pm, lib);
var multi = new E.MultiShelfLibrary();
var swarm = new E.DeliberationSwarm(multi, pm, model);

var out = [];
function say(line) { out.push(line); }
function sayLines(prefix, text) {
  var lines = String(text).split("\n");
  for (var i = 0; i < lines.length; i++) say(prefix + " " + esc(lines[i]));
}
function readFileOrNull(f) { try { return fs.readFileSync(f); } catch (e) { return null; } }

var HANDLERS = {
  "LZ.ENC": function (a) {
    var z = E.LZCodec.compress(a), b = E.LZCodec.toBase64(z);
    say("HEX" + (z.length ? " " + hex(z) : ""));
    say("B64" + (b ? " " + b : ""));
    say("DEC " + esc(E.LZCodec.decompress(E.LZCodec.fromBase64(b))));
  },
  "LZ.DEC": function (a) {
    try { say("DEC " + esc(E.LZCodec.decompress(unhex(a)))); } catch (e) { say("ERR"); }
  },
  "B64.ENC": function (a) { say("B64 " + E.LZCodec.toBase64(unhex(a))); },
  "B64.DEC": function (a) { var b = E.LZCodec.fromBase64(a); say("HEX" + (b.length ? " " + hex(b) : "")); },
  "FMT": function (a) { say("FMT " + E.fmtNum(E.valOf(a))); },
  "VAL": function (a) { say("VAL " + E.fmtNum(E.valOf(a))); },
  "CLEAN": function (a) { say("TEXT " + esc(E.cleanAscii(a))); },
  "WORDS": function (a) { say("WORDS " + E.tokenizeWords(a).join(" ")); },

  "LIB.CLEAR": function () { lib.clear(); say("OK"); },
  "LIB.STARTER": function () { lib.loadStarterPack(); say("ENTRIES " + lib.stats().entries); },
  "LIB.ADD": function (a) {
    var f = a.split("|");
    say("ID " + lib.addEntry(f[0], f[1], f[2], f[3] || ""));
  },
  "LIB.INGEST": function (a) {
    var bar = a.indexOf("|");
    say("CHUNKS " + lib.ingestPlainText(a.slice(bar + 1), a.slice(0, bar)));
  },
  "LIB.SEARCH": function (a) {
    var bar = a.indexOf("|"), k = parseInt(a.slice(0, bar), 10);
    var hits = lib.search(a.slice(bar + 1), k);
    if (!hits.length) { say("NONE"); return; }
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      say("HIT " + h.id + "|" + esc(h.topic) + "|" + esc(h.cat) + "|" + esc(h.fact) + "|" + esc(h.ex));
    }
  },
  "LIB.STATS": function () { var s = lib.stats(); say("ENTRIES " + s.entries + " CHARS " + s.compressedChars); },
  "LIB.SAVE": function (a) { fs.writeFileSync(a, lib.toText()); say("OK"); },
  "LIB.LOAD": function (a) {
    var b = readFileOrNull(a);
    if (!b) { say("FAIL"); return; }
    var n = lib.fromText(b.toString("latin1"));
    say(n > 0 ? "LOADED " + n : "FAIL");
  },

  "NN.LOAD": function (a) {
    var b = readFileOrNull(a);
    if (!b) { say("ERR"); return; }
    try {
      var ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      var m = model.loadFromArrayBuffer(ab);
      say("MODEL D=" + m.D + " L=" + m.L + " H=" + m.H + " HID=" + m.HID);
    } catch (e) { say("ERR"); }
  },
  "NN.RESET": function () { model.reset(); say("PREFIX 0"); },
  "NN.SEED": function (a) { model.rng = new E.XorShift32(parseInt(a, 10)); say("SEED " + parseInt(a, 10)); },
  "NN.SCORE": function (a) {
    var clean = E.cleanAscii(a).replace(/\n/g, " "), p = 0, i;
    for (i = 0; i < clean.length && p < E.CTX - 2; i++, p++) model.step(clean.charCodeAt(i) - 30, p);
    model.step(1, p);
    var best = 0, sum = 0;
    for (i = 0; i < E.VOCAB; i++) { if (model.score[i] > model.score[best]) best = i; sum += model.score[i]; }
    var first = [];
    for (i = 0; i < 8; i++) first.push(E.fmtNum(model.score[i]));
    say("ARGMAX " + best);
    say("SCORES " + first.join(" "));
    say("SUM " + E.fmtNum(sum));
  },
  "NN.THINK": function (a) {
    var bar = a.indexOf("|");
    say("OUT " + esc(model.think(a.slice(bar + 1), E.valOf(a.slice(0, bar)))));
  },
  "NN.PRIME": function (a) { say("PREFIX " + model.prime(a)); },
  "NN.KVSAVE": function (a) {
    var bar = a.indexOf("|"), u8 = model.exportKVCache(parseInt(a.slice(bar + 1), 10));
    fs.writeFileSync(a.slice(0, bar), Buffer.from(u8));
    say("KV BYTES " + u8.length + " SUM " + fnv1a(u8));
  },
  "NN.KVLOAD": function (a) {
    var b = readFileOrNull(a);
    if (!b) { say("ERR"); return; }
    try { say("PREFIX " + model.importKVCache(new Uint8Array(b))); } catch (e) { say("ERR"); }
  },

  "PM.RESET": function () { pm.reset(); say("OK"); },
  "PM.MODE": function (a) { say("MODE " + pm.setMode(a)); },
  "PM.SUCCESS": function (a) {
    var f = a.split("|");
    pm.recordSuccess(f[0], f.length > 1 ? Math.floor(E.valOf(f[1])) : undefined);
    say("XP " + pm.profile.xp);
  },
  "PM.BEST": function () { say("BEST " + pm.bestLearnedMode()); },
  "PM.CFG": function () {
    var lines = pm.toCfg().replace(/\n$/, "").split("\n");
    for (var i = 0; i < lines.length; i++) say("CFG " + esc(lines[i]));
  },
  "PM.SAVE": function (a) { fs.writeFileSync(a, pm.toCfg()); say("OK"); },
  "PM.LOAD": function (a) {
    var b = readFileOrNull(a);
    if (!b) { say("FAIL"); return; }
    pm.fromCfg(b.toString("latin1"));
    say("LOADED");
  },
  "FILE.CAT": function (a) {
    var b = readFileOrNull(a);
    if (!b) { say("NOFILE"); return; }
    var lines = b.toString("latin1").replace(/\r/g, "").replace(/\n$/, "").split("\n");
    for (var i = 0; i < lines.length; i++) say("FILE " + esc(lines[i]));
  },

  "EXPR": function (a) {
    var v = E.CodeSandbox.evalExpr(a, {});
    say("EXPR " + (typeof v === "string" ? "s:" + esc(v) : "n:" + E.fmtNum(v)));
  },
  "CODE": function (a) {
    var r = E.CodeSandbox.run(a), i;
    say("RESULT " + (r.ok ? "OK" : "ERR"));
    if (!r.ok) say("ERROR " + esc(r.error));
    for (i = 0; i < r.output.length; i++) say("OUT " + esc(r.output[i]));
    if (r.grid) { var rows = r.grid.split("\n"); for (i = 0; i < rows.length; i++) say("GRID " + rows[i]); }
    var names = Object.keys(r.vars).sort();
    for (i = 0; i < names.length; i++) {
      var v = r.vars[names[i]];
      say("VAR " + names[i] + "=" + (typeof v === "string" ? "s:" + esc(v) : "n:" + E.fmtNum(v)));
    }
  },

  "ADV.RESET": function () { pm.profile.adventureState = { room: "camp", inventory: [], solved: [] }; say("OK"); },
  "ADV": function (a) { sayLines("ADV", adv.command(a)); },
  "ASK": function (a) {
    E.AudioDriver.lastSpoken = "";
    var r = tutor.ask(a);
    sayLines("ASK", r.text);
    say("SOURCE " + r.source);
    say("XP " + pm.profile.xp);
    say("SPOKE " + E.AudioDriver.lastSpoken.length);
    say("MASTERED " + pm.profile.masteredTopics.length);
  },
  "CHIRP": function (a) {
    var plan = E.AudioDriver.chirpPlan(a), f = [];
    for (var i = 0; i < plan.length; i++) f.push(plan[i].freq);
    say("CHIRP " + plan.length + " " + f.join(","));
  },

  "MS.RESET": function () { multi = new E.MultiShelfLibrary(); swarm = new E.DeliberationSwarm(multi, pm, model); E.Storage.clear(); say("OK"); },
  "MS.ADD": function (a) {
    var f = a.split("|");
    if (!multi.shelves[f[0]]) multi.addShelf(f[0], []);
    multi.shelves[f[0]].store.addEntry(f[1], f[0], f[2], f[3] || "");
    say("OK");
  },
  "MS.ASK": function (a) {
    var bar = a.indexOf("|"), sh = a.slice(0, bar);
    var r = swarm.askWithSources(a.slice(bar + 1), sh === "*" ? null : sh.split(","));
    sayLines("ANSWER", r.answer);
    say("SOURCES " + esc(r.sources.join(" ")));
    for (var i = 0; i < r.internalConversation.length; i++) say("CHAT " + esc(r.internalConversation[i]));
  },

  "NET.FRAME": function (a) {
    var f = numList(a), u8 = E.EvelynNet.packFrame(f[0], f[1], f[2], f[3], f[4], f[5], f[6]);
    var b = E.EvelynNet.unpackFrame(u8);
    say("HEX " + hex(u8));
    say("BACK id=" + b.playerId + " x=" + E.fmtNum(b.x) + " y=" + E.fmtNum(b.y) + " vx=" + E.fmtNum(b.vx) + " vy=" + E.fmtNum(b.vy) + " buttons=" + b.buttons + " seq=" + b.seq);
  },
  "NET.BRAIN": function (a) {
    var u8 = E.EvelynNet.packBotBrain(numList(a));
    say("HEX " + hex(u8));
    say("BACK " + fmtList(E.EvelynNet.unpackBotBrain(u8)));
  },
  "QDOT": function (a) {
    var p = a.split("|"), q = numList(p[0]), k = numList(p[1]);
    say("QDOT " + E.fmtNum(E.quantizedQKDot(q, k, 0, E.valOf(p[2]), q.length)));
  }
};

var scriptPath = process.argv[2];
if (!scriptPath) { console.error("usage: node evelyn_proto.js script.txt"); process.exit(2); }
var lines = fs.readFileSync(scriptPath, "latin1").split(/\r?\n/);
say("EVELYN-PROTO 1 js");
for (var li = 0; li < lines.length; li++) {
  var line = lines[li];
  if (!line || line.charAt(0) === "#" || line.charAt(0) === "@") continue;
  var sp = line.indexOf(" ");
  var cmd = sp < 0 ? line : line.slice(0, sp);
  var arg = sp < 0 ? "" : line.slice(sp + 1);
  if (cmd === "QUIT") break;
  say(">> " + line);
  var h = HANDLERS[cmd];
  if (!h) { say("UNKNOWN " + cmd); continue; }
  try {
    h(unescArg(cmd, arg));
  } catch (e) {
    say("EXCEPTION " + (e && e.message ? e.message : e));
  }
}
function unescArg(cmd, arg) {
  /* file names and hex are literal; text commands take the escapes */
  if (/^(LIB\.SAVE|LIB\.LOAD|NN\.LOAD|NN\.KVLOAD|PM\.SAVE|PM\.LOAD|FILE\.CAT|NN\.SEED|PM\.MODE|NET\.|LZ\.DEC|B64\.|QDOT|FMT|VAL)/.test(cmd)) return arg;
  if (cmd === "NN.KVSAVE") return arg;
  return unesc(arg);
}
process.stdout.write(out.join("\n") + "\n");
