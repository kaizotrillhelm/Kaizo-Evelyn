/* qbi.js - a small interpreter for the BASIC subset the Evelyn BASIC edition is written in
   (QuickBASIC / FreeBASIC -lang qb style). It exists so the BASIC edition can be tested on a machine without
   a BASIC compiler. It is strict on purpose:
     - every variable must be declared (DIM / CONST / parameter)
     - INTEGER is 16 bit, LONG is 32 bit: a result outside the range stops the program with "Overflow"
     - SINGLE values are rounded to 32 bit floats at every operation, DOUBLE is a plain double
     - float literals need a suffix (# or ! or the D exponent)
     - a by-reference argument must have exactly the parameter's type
   Usage: node qbi.js program.bas [--cmd "text for COMMAND$"] [--stdin file]
   Not a full BASIC: only the statements and functions the Evelyn sources use. */
"use strict";
var fs = require("fs");
var path = require("path");

var RESERVED = {};
JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "bas_keywords.json"), "utf8")).forEach(function (k) { RESERVED[k] = true; });

function QbError(msg, line) { this.message = msg; this.line = line; }
QbError.prototype = Object.create(Error.prototype);
function EndSignal() {}

/* ---------------------------------------------------------------- preprocessor */
function preprocess(file, defines, out, depth) {
  if (depth > 10) throw new QbError("include nesting too deep");
  var text = fs.readFileSync(file, "latin1").replace(/\r/g, "");
  var lines = text.split("\n"), stack = [], active = true;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].replace(/^\s+|\s+$/g, "");
    var m;
    if ((m = /^#(ifdef|ifndef)\s+(\w+)/i.exec(t))) {
      var def = Object.prototype.hasOwnProperty.call(defines, m[2].toUpperCase());
      var on = m[1].toLowerCase() === "ifdef" ? def : !def;
      stack.push({ parent: active, taken: on });
      active = active && on;
      continue;
    }
    if (/^#else\b/i.test(t)) { var top = stack[stack.length - 1]; active = top.parent && !top.taken; top.taken = true; continue; }
    if (/^#endif\b/i.test(t)) { active = stack.pop().parent; continue; }
    if (!active) continue;
    if ((m = /^#include\s+"([^"]+)"/i.exec(t))) {
      preprocess(path.resolve(path.dirname(file), m[1]), defines, out, depth + 1);
      continue;
    }
    out.push({ text: lines[i], file: path.basename(file), line: i + 1 });
  }
  if (stack.length) throw new QbError("unterminated #IFDEF in " + file);
}

/* ---------------------------------------------------------------- lexer */
function lex(srcLines) {
  var toks = [];
  srcLines.forEach(function (sl) {
    var s = sl.text, i = 0, n = s.length, first = true;
    function push(tok) { tok.line = sl.file + ":" + sl.line; tok.file = sl.file; toks.push(tok); first = false; }
    while (i < n) {
      var c = s.charAt(i);
      if (c === " " || c === "\t") { i++; continue; }
      if (c === "'") break;
      if (c === '"') {
        var j = s.indexOf('"', i + 1);
        if (j < 0) throw new QbError("unterminated string", sl.file + ":" + sl.line);
        push({ k: "str", v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      var m = /^(\d+\.?\d*|\.\d+)(?:([eEdD])([+-]?\d+))?([%&!#])?/.exec(s.slice(i));
      if (m && (c >= "0" && c <= "9" || c === ".")) {
        var hasDot = m[1].indexOf(".") >= 0, hasExp = m[2] !== undefined, suf = m[4], ty;
        var val = parseFloat(m[1] + (hasExp ? "e" + m[3] : ""));
        if (hasDot || hasExp) {
          if (suf === "#" || (hasExp && /[dD]/.test(m[2]))) ty = "D";
          else if (suf === "!") ty = "S";
          else throw new QbError("float literal '" + m[0] + "' needs a # or ! suffix (or a D exponent)", sl.file + ":" + sl.line);
        } else if (suf === "&") ty = "L";
        else if (suf === "%") ty = "I";
        else if (suf === "!") ty = "S";
        else if (suf === "#") ty = "D";
        else ty = (val <= 32767) ? "I" : (val <= 2147483647 ? "L" : "D");
        push({ k: "num", v: val, ty: ty });
        i += m[0].length;
        continue;
      }
      if (c === "&" && /^&[hH][0-9a-fA-F]+/.test(s.slice(i))) {
        var hm = /^&[hH]([0-9a-fA-F]+)(&?)/.exec(s.slice(i));
        push({ k: "num", v: parseInt(hm[1], 16), ty: hm[2] ? "L" : "I" });
        i += hm[0].length;
        continue;
      }
      if (/[A-Za-z]/.test(c)) {
        var im = /^[A-Za-z][A-Za-z0-9_]*[$%&!#]?/.exec(s.slice(i));
        var word = im[0];
        if (word.toUpperCase() === "REM" && first) break;
        push({ k: "id", v: word.toUpperCase(), raw: word });
        i += word.length;
        continue;
      }
      var two = s.substr(i, 2);
      if (two === "<>" || two === "<=" || two === ">=") { push({ k: "op", v: two }); i += 2; continue; }
      if ("+-*/\\^()=<>,;#".indexOf(c) >= 0) { push({ k: "op", v: c }); i++; continue; }
      if (c === ":") { push({ k: "colon" }); i++; first = true; continue; }
      throw new QbError("unexpected character '" + c + "'", sl.file + ":" + sl.line);
    }
    toks.push({ k: "nl", line: sl.file + ":" + sl.line, file: sl.file });
    first = true;
  });
  toks.push({ k: "eof", line: 0 });
  return toks;
}

/* ---------------------------------------------------------------- types and conversions */
var RANK = { I: 1, L: 2, S: 3, D: 4 };
function bankers(x) {
  var f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
function toI16(x) { var r = bankers(x); if (r < -32768 || r > 32767) throw new QbError("Overflow"); return r; }
function toI32(x) { var r = bankers(x); if (r < -2147483648 || r > 2147483647) throw new QbError("Overflow"); return r; }
function defaultOf(ty) { return ty === "$" ? "" : 0; }

/* convert a value of static type from to static type to; returns a function on the value */
function converter(from, to, line) {
  if (from === to) return null;
  if ((from === "$") !== (to === "$")) throw new QbError("Type mismatch (" + from + " to " + to + ")", line);
  if (to === "D") return null;
  if (to === "S") return Math.fround;
  if (to === "I") return from === "L" ? function (x) { if (x < -32768 || x > 32767) throw new QbError("Overflow"); return x; } : toI16;
  if (to === "L") return (from === "I") ? null : toI32;
  return null;
}

/* ---------------------------------------------------------------- parser */
function Parser(toks) {
  this.t = toks; this.p = 0; this.subs = {}; this.funcs = {};
  /* pre-scan names so calls can be told from variables */
  for (var i = 0; i < toks.length - 1; i++) {
    if (toks[i].k === "id" && toks[i + 1].k === "id" && (i === 0 || toks[i - 1].k === "nl" || toks[i - 1].k === "colon")) {
      if (toks[i].v === "SUB") this.subs[toks[i + 1].v] = true;
      else if (toks[i].v === "FUNCTION") this.funcs[toks[i + 1].v] = true;
    }
  }
}
Parser.prototype = {
  peek: function () { return this.t[this.p]; },
  next: function () { return this.t[this.p++]; },
  isId: function (v) { var t = this.t[this.p]; return t.k === "id" && t.v === v; },
  isOp: function (v) { var t = this.t[this.p]; return t.k === "op" && t.v === v; },
  accId: function (v) { if (this.isId(v)) { this.p++; return true; } return false; },
  accOp: function (v) { if (this.isOp(v)) { this.p++; return true; } return false; },
  err: function (msg) { var t = this.peek(); throw new QbError(msg + " (near " + (t.k === "id" ? t.raw : t.k === "op" ? t.v : t.k) + ")", t.line); },
  expectId: function (v) { if (!this.accId(v)) this.err("expected " + v); },
  expectOp: function (v) { if (!this.accOp(v)) this.err("expected '" + v + "'"); },
  atEol: function () { var k = this.peek().k; return k === "nl" || k === "colon" || k === "eof"; },
  skipSeps: function () { while (this.peek().k === "nl" || this.peek().k === "colon") this.p++; },

  /* ---- expressions ---- */
  expr: function () { return this.orExpr(); },
  orExpr: function () {
    var l = this.andExpr();
    while (this.isId("OR") || this.isId("XOR")) { var op = this.next().v, line = this.peek().line; l = { t: "bin", op: op, a: l, b: this.andExpr(), line: line }; }
    return l;
  },
  andExpr: function () {
    var l = this.notExpr();
    while (this.isId("AND")) { var line = this.next().line; l = { t: "bin", op: "AND", a: l, b: this.notExpr(), line: line }; }
    return l;
  },
  notExpr: function () {
    if (this.isId("NOT")) { var line = this.next().line; return { t: "un", op: "NOT", a: this.notExpr(), line: line }; }
    return this.rel();
  },
  rel: function () {
    var l = this.add(), t = this.peek();
    if (t.k === "op" && (t.v === "=" || t.v === "<>" || t.v === "<" || t.v === ">" || t.v === "<=" || t.v === ">=")) {
      this.p++;
      return { t: "bin", op: t.v, a: l, b: this.add(), line: t.line };
    }
    return l;
  },
  add: function () {
    var l = this.mod();
    while (this.isOp("+") || this.isOp("-")) { var t = this.next(); l = { t: "bin", op: t.v, a: l, b: this.mod(), line: t.line }; }
    return l;
  },
  mod: function () {
    var l = this.idiv();
    while (this.isId("MOD")) { var t = this.next(); l = { t: "bin", op: "MOD", a: l, b: this.idiv(), line: t.line }; }
    return l;
  },
  idiv: function () {
    var l = this.mul();
    while (this.isOp("\\")) { var t = this.next(); l = { t: "bin", op: "\\", a: l, b: this.mul(), line: t.line }; }
    return l;
  },
  mul: function () {
    var l = this.unary();
    while (this.isOp("*") || this.isOp("/")) { var t = this.next(); l = { t: "bin", op: t.v, a: l, b: this.unary(), line: t.line }; }
    return l;
  },
  unary: function () {
    if (this.isOp("-")) { var t = this.next(); return { t: "un", op: "NEG", a: this.unary(), line: t.line }; }
    if (this.isOp("+")) { this.p++; return this.unary(); }
    return this.primary();
  },
  primary: function () {
    var t = this.next();
    if (t.k === "num") return { t: "num", v: t.v, ty: t.ty, line: t.line };
    if (t.k === "str") return { t: "str", v: t.v, line: t.line };
    if (t.k === "op" && t.v === "(") { var e = this.expr(); this.expectOp(")"); return { t: "paren", a: e, line: t.line }; }
    if (t.k === "op" && t.v === "#") return this.primary();
    if (t.k === "id") {
      var args = null;
      if (this.isOp("(")) { this.p++; args = []; if (!this.isOp(")")) { do { args.push(this.expr()); } while (this.accOp(",")); } this.expectOp(")"); }
      return { t: "name", name: t.v, raw: t.raw, args: args, line: t.line };
    }
    this.p--; this.err("expression expected");
  },

  /* ---- statements ---- */
  program: function () {
    var out = [];
    this.skipSeps();
    while (this.peek().k !== "eof") { out.push(this.statement()); this.skipSeps(); }
    return out;
  },
  /* statements until one of the given terminator words (not consumed) */
  block: function (terms) {
    var out = [];
    for (;;) {
      this.skipSeps();
      var t = this.peek();
      if (t.k === "eof") this.err("unterminated block, expected " + terms.join(" / "));
      if (t.k === "id") {
        var nx = this.t[this.p + 1];
        for (var i = 0; i < terms.length; i++) {
          var w = terms[i].split(" ");
          if (t.v === w[0] && (w.length === 1 || (nx.k === "id" && nx.v === w[1]))) return out;
        }
      }
      out.push(this.statement());
    }
  },
  params: function () {
    var ps = [];
    if (this.accOp("(")) {
      if (!this.isOp(")")) {
        do {
          var name = this.next();
          if (name.k !== "id") this.err("parameter name expected");
          var arr = false;
          if (this.accOp("(")) { this.expectOp(")"); arr = true; }
          this.expectId("AS");
          ps.push({ name: name.v, array: arr, type: this.typeName() });
        } while (this.accOp(","));
      }
      this.expectOp(")");
    }
    return ps;
  },
  typeName: function () {
    var t = this.next();
    if (t.k !== "id") this.err("type name expected");
    var m = { INTEGER: "I", LONG: "L", SINGLE: "S", DOUBLE: "D", STRING: "$" }[t.v];
    if (!m) this.err("unknown type " + t.raw);
    return m;
  },
  retType: function (name) {
    var s = name.charAt(name.length - 1);
    return { "%": "I", "&": "L", "!": "S", "#": "D", "$": "$" }[s] || "S";
  },
  statement: function () {
    var t = this.peek(), line = t.line;
    if (t.k !== "id") this.err("statement expected");
    var w = t.v;
    switch (w) {
      case "SUB": case "FUNCTION": return this.procDef();
      case "DECLARE": while (!this.atEol()) this.p++; return { t: "nop" };
      case "CONST": return this.constStmt();
      case "DIM": return this.dimStmt();
      case "IF": return this.ifStmt();
      case "FOR": return this.forStmt();
      case "DO": return this.doStmt();
      case "WHILE": return this.whileStmt();
      case "EXIT": this.p++; var what = this.next().v; return { t: "exit", what: what, line: line };
      case "END":
        this.p++;
        return { t: "end", line: line };
      case "CALL": {
        this.p++;
        var nm = this.next();
        var args = [];
        if (this.accOp("(")) { if (!this.isOp(")")) { do { args.push(this.expr()); } while (this.accOp(",")); } this.expectOp(")"); }
        return { t: "call", name: nm.v, args: args, line: line };
      }
      case "PRINT": return this.printStmt();
      case "INPUT": return this.inputStmt(false);
      case "LINE": this.p++; this.expectId("INPUT"); return this.inputStmt(true);
      case "OPEN": return this.openStmt();
      case "CLOSE": {
        this.p++;
        var list = [];
        if (!this.atEol()) { do { this.accOp("#"); list.push(this.expr()); } while (this.accOp(",")); }
        return { t: "close", list: list, line: line };
      }
      case "GET": case "PUT": {
        this.p++; this.accOp("#");
        var fnum = this.expr();
        this.expectOp(",");
        var pos = null;
        if (!this.isOp(",")) pos = this.expr();
        this.expectOp(",");
        return { t: w.toLowerCase(), file: fnum, pos: pos, target: this.expr(), line: line };
      }
      case "KILL": this.p++; return { t: "kill", name: this.expr(), line: line };
      case "SWAP": { this.p++; var a = this.expr(); this.expectOp(","); return { t: "swap", a: a, b: this.expr(), line: line }; }
      case "CLS": case "BEEP": case "RANDOMIZE": case "SYSTEM": this.p++; while (!this.atEol()) this.p++; return { t: w === "SYSTEM" ? "end" : "nop" };
      case "COLOR": case "LOCATE": case "SLEEP": case "SOUND": this.p++; while (!this.atEol()) this.p++; return { t: "nop" };
    }
    /* assignment or SUB call */
    if (this.subs[w] && !(this.t[this.p + 1].k === "op" && this.t[this.p + 1].v === "=")) {
      this.p++;
      var cargs = [];
      if (!this.atEol() && !this.isId("ELSE")) { do { cargs.push(this.expr()); } while (this.accOp(",")); }
      return { t: "call", name: w, args: cargs, line: line };
    }
    var lhs = this.primary();
    this.expectOp("=");
    return { t: "assign", lhs: lhs, rhs: this.expr(), line: line };
  },
  procDef: function () {
    var kind = this.next().v, nm = this.next(), line = nm.line;
    var params = this.params(), ret = null;
    if (kind === "FUNCTION") { ret = this.retType(nm.v); if (this.accId("AS")) ret = this.typeName(); }
    var body = this.block(["END " + kind]);
    this.p += 2;
    return { t: "proc", kind: kind, name: nm.v, params: params, ret: ret, body: body, line: line };
  },
  constStmt: function () {
    this.p++;
    var list = [];
    do { var nm = this.next(); this.expectOp("="); list.push({ name: nm.v, e: this.expr(), line: nm.line }); } while (this.accOp(","));
    return { t: "const", list: list };
  },
  dimStmt: function () {
    var line = this.next().line, shared = this.accId("SHARED"), list = [];
    do {
      var nm = this.next();
      if (nm.k !== "id") this.err("name expected");
      var dims = null;
      if (this.accOp("(")) { dims = []; do { dims.push(this.expr()); } while (this.accOp(",")); this.expectOp(")"); }
      var ty = this.retType(nm.v), fixed = 0;
      if (this.accId("AS")) { ty = this.typeName(); if (ty === "$" && this.accOp("*")) fixed = this.next().v; }
      list.push({ name: nm.v, dims: dims, type: ty, fixed: fixed, line: nm.line });
    } while (this.accOp(","));
    return { t: "dim", shared: shared, list: list, line: line };
  },
  ifStmt: function () {
    var line = this.next().line, cond = this.expr();
    this.expectId("THEN");
    if (this.peek().k === "nl") {
      var arms = [{ cond: cond, body: this.block(["ELSEIF", "ELSE", "END IF"]) }], els = null;
      for (;;) {
        if (this.accId("ELSEIF")) { var c2 = this.expr(); this.expectId("THEN"); arms.push({ cond: c2, body: this.block(["ELSEIF", "ELSE", "END IF"]) }); }
        else if (this.accId("ELSE")) { els = this.block(["END IF"]); }
        else { this.p += 2; break; }
      }
      return { t: "if", arms: arms, els: els, line: line };
    }
    var thenB = [], elseB = null;
    while (!(this.peek().k === "nl" || this.peek().k === "eof" || this.isId("ELSE"))) {
      thenB.push(this.statement());
      if (this.peek().k === "colon") this.p++;
    }
    if (this.accId("ELSE")) {
      elseB = [];
      while (!(this.peek().k === "nl" || this.peek().k === "eof")) { elseB.push(this.statement()); if (this.peek().k === "colon") this.p++; }
    }
    return { t: "if", arms: [{ cond: cond, body: thenB }], els: elseB, line: line };
  },
  forStmt: function () {
    var line = this.next().line, v = this.primary();
    this.expectOp("=");
    var a = this.expr(); this.expectId("TO"); var b = this.expr(), s = null;
    if (this.accId("STEP")) s = this.expr();
    var body = this.block(["NEXT"]);
    this.p++;
    if (!this.atEol()) this.primary();
    return { t: "for", v: v, a: a, b: b, s: s, body: body, line: line };
  },
  doStmt: function () {
    var line = this.next().line, pre = null, post = null;
    if (this.isId("WHILE") || this.isId("UNTIL")) { var k = this.next().v; pre = { until: k === "UNTIL", e: this.expr() }; }
    var body = this.block(["LOOP"]);
    this.p++;
    if (this.isId("WHILE") || this.isId("UNTIL")) { var k2 = this.next().v; post = { until: k2 === "UNTIL", e: this.expr() }; }
    return { t: "do", pre: pre, post: post, body: body, line: line };
  },
  whileStmt: function () {
    var line = this.next().line, c = this.expr(), body = this.block(["WEND"]);
    this.p++;
    return { t: "do", pre: { until: false, e: c }, post: null, body: body, line: line };
  },
  printStmt: function () {
    var line = this.next().line, file = null, items = [], nl = true;
    if (this.accOp("#")) { file = this.expr(); if (!this.atEol()) this.expectOp(","); }
    while (!this.atEol() && !this.isId("ELSE")) {
      if (this.isOp(";")) { this.p++; nl = false; continue; }
      if (this.isOp(",")) { this.p++; items.push({ tab: true }); nl = false; continue; }
      items.push({ e: this.expr() }); nl = true;
    }
    return { t: "print", file: file, items: items, nl: nl, line: line };
  },
  inputStmt: function (isLine) {
    var line = this.peek().line, file = null, prompt = null;
    this.accId("INPUT");
    if (this.accOp("#")) { file = this.expr(); this.expectOp(","); }
    else if (this.peek().k === "str") { prompt = this.next().v; if (!this.accOp(";")) this.expectOp(","); }
    var targets = [];
    do { targets.push(this.primary()); } while (this.accOp(","));
    return { t: "input", line: line, file: file, prompt: prompt, targets: targets, isLine: isLine };
  },
  openStmt: function () {
    var line = this.next().line, name = this.expr();
    this.expectId("FOR");
    var mode = this.next().v;
    if (mode === "BINARY" || mode === "INPUT" || mode === "OUTPUT" || mode === "APPEND") {
      if (this.isId("ACCESS")) { this.p++; this.next(); }
    } else this.err("unknown OPEN mode");
    this.expectId("AS");
    this.accOp("#");
    return { t: "open", name: name, mode: mode, file: this.expr(), line: line };
  }
};

/* ---------------------------------------------------------------- compiler and runtime */
function Interp(opts) {
  this.opts = opts || {};
  this.out = [];
  this.G = [];
  this.gscope = { vars: Object.create(null), n: 0, module: true };
  this.procs = Object.create(null);
  this.files = Object.create(null);
  this.stdin = this.opts.stdin || [];
  this.line = 0;
  this.cmd = this.opts.cmd || "";
  this.cwd = this.opts.cwd || process.cwd();
}

Interp.prototype.write = function (s) { this.out.push(s); if (this.out.length > 2000) this.flush(); };
Interp.prototype.flush = function () {
  if (this.out.length) { fs.writeSync(1, Buffer.from(this.out.join(""), "latin1")); this.out = []; }
};

Interp.prototype.lookup = function (name, scope) {
  if (scope.vars[name]) return scope.vars[name];
  var g = this.gscope.vars[name];
  if (g && (g.shared || scope === this.gscope)) return g;
  return null;
};

Interp.prototype.declare = function (scope, sym) {
  if (RESERVED[sym.name]) throw new QbError(sym.name + " is a reserved word and cannot be a name", sym.line);
  if (scope.vars[sym.name]) throw new QbError("Duplicate definition of " + sym.name, sym.line);
  sym.slot = scope.n++;
  sym.global = scope === this.gscope;
  scope.vars[sym.name] = sym;
  return sym;
};

/* compile an expression to { ty, fn(f) } */
Interp.prototype.cx = function (ast, scope, ctx) {
  var self = this, line = ast.line;
  switch (ast.t) {
    case "num": { var v = ast.v; return { ty: ast.ty, fn: function () { return v; } }; }
    case "str": { var s = ast.v; return { ty: "$", fn: function () { return s; } }; }
    case "paren": return this.cx(ast.a, scope, ctx);
    case "un": return this.cUnary(ast, scope, ctx);
    case "bin": return this.cBinary(ast, scope, ctx);
    case "name": return this.cName(ast, scope, ctx);
  }
  throw new QbError("cannot compile " + ast.t, line);
};

Interp.prototype.cUnary = function (ast, scope, ctx) {
  var a = this.cx(ast.a, scope, ctx), line = ast.line;
  if (ast.op === "NEG") {
    if (a.ty === "$") throw new QbError("Type mismatch", line);
    var ty = a.ty, fn = a.fn;
    if (ty === "I") return { ty: ty, fn: function (f) { var r = -fn(f); if (r > 32767) throw new QbError("Overflow"); return r; } };
    return { ty: ty, fn: function (f) { return -fn(f); } };
  }
  if (a.ty === "$") throw new QbError("Type mismatch", line);
  var f0 = a.fn, tyn = a.ty === "L" ? "L" : "I", conv = a.ty === "L" || a.ty === "I" ? null : toI32;
  return { ty: tyn, fn: function (f) { var x = f0(f); return ~(conv ? conv(x) : x); } };
};

Interp.prototype.cBinary = function (ast, scope, ctx) {
  var a = this.cx(ast.a, scope, ctx), b = this.cx(ast.b, scope, ctx), op = ast.op, line = ast.line;
  var fa = a.fn, fb = b.fn, ty;
  if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
    if ((a.ty === "$") !== (b.ty === "$")) throw new QbError("Type mismatch in comparison", line);
    var cmp = {
      "=": function (x, y) { return x === y; }, "<>": function (x, y) { return x !== y; }, "<": function (x, y) { return x < y; },
      ">": function (x, y) { return x > y; }, "<=": function (x, y) { return x <= y; }, ">=": function (x, y) { return x >= y; }
    }[op];
    return { ty: "I", fn: function (f) { return cmp(fa(f), fb(f)) ? -1 : 0; } };
  }
  if (op === "+" && a.ty === "$" && b.ty === "$") return { ty: "$", fn: function (f) { return fa(f) + fb(f); } };
  if (a.ty === "$" || b.ty === "$") throw new QbError("Type mismatch (string in arithmetic) at operator " + op, line);
  var ra = RANK[a.ty], rb = RANK[b.ty], rmax = Math.max(ra, rb);
  if (op === "AND" || op === "OR" || op === "XOR") {
    var tyl = (a.ty === "L" || b.ty === "L") ? "L" : "I";
    var ca = (a.ty === "I" || a.ty === "L") ? null : toI32, cb = (b.ty === "I" || b.ty === "L") ? null : toI32;
    var bit = { AND: function (x, y) { return x & y; }, OR: function (x, y) { return x | y; }, XOR: function (x, y) { return x ^ y; } }[op];
    return { ty: tyl, fn: function (f) { var x = fa(f), y = fb(f); return bit(ca ? ca(x) : x, cb ? cb(y) : y); } };
  }
  if (op === "\\" || op === "MOD") {
    var tyi = (a.ty === "I" && b.ty === "I") ? "I" : "L";
    return {
      ty: tyi, fn: function (f) {
        var x = toI32(fa(f)), y = toI32(fb(f));
        if (y === 0) throw new QbError("Division by zero");
        var r = op === "\\" ? Math.trunc(x / y) : x % y;
        if (r === 0) r = 0;
        if (tyi === "I" && (r < -32768 || r > 32767)) throw new QbError("Overflow");
        return r;
      }
    };
  }
  if (op === "/") {
    ty = rmax === 4 ? "D" : "S";
    return { ty: ty, fn: function (f) { var y = fb(f); if (y === 0) throw new QbError("Division by zero"); var r = fa(f) / y; return ty === "S" ? Math.fround(r) : r; } };
  }
  ty = rmax === 1 ? "I" : (rmax === 2 ? "L" : (rmax === 3 ? "S" : "D"));
  var calc = { "+": function (x, y) { return x + y; }, "-": function (x, y) { return x - y; }, "*": function (x, y) { return x * y; } }[op];
  if (!calc) throw new QbError("unknown operator " + op, line);
  if (ty === "I") return { ty: ty, fn: function (f) { var r = calc(fa(f), fb(f)); if (r < -32768 || r > 32767) throw new QbError("Overflow (INTEGER " + op + ")"); return r; } };
  if (ty === "L") return { ty: ty, fn: function (f) { var r = calc(fa(f), fb(f)); if (r < -2147483648 || r > 2147483647) throw new QbError("Overflow (LONG " + op + ")"); return r; } };
  if (ty === "S") return { ty: ty, fn: function (f) { return Math.fround(calc(fa(f), fb(f))); } };
  return { ty: ty, fn: function (f) { return calc(fa(f), fb(f)); } };
};

/* element index of an array reference, with bounds checks */
Interp.prototype.cIndex = function (sym, args, scope, ctx, line) {
  var self = this, ix = args.map(function (a) {
    var c = self.cx(a, scope, ctx);
    if (c.ty === "$") throw new QbError("Type mismatch in array index", line);
    return c;
  });
  return function (f, arr) {
    var idx = 0;
    for (var i = 0; i < ix.length; i++) {
      var v = ix[i].fn(f);
      if (v !== Math.floor(v)) v = bankers(v);
      var n = arr.dims[i];
      if (v < 0 || v > n) throw new QbError("Subscript out of range (" + sym.name + " index " + v + " of " + n + ")");
      idx = idx * (n + 1) + v;
    }
    return idx;
  };
};

Interp.prototype.arrGetter = function (sym) {
  var G = this.G;
  if (sym.global) return function () { return G[sym.slot]; };
  var slot = sym.slot;
  return function (f) { return f[slot]; };
};

Interp.prototype.cName = function (ast, scope, ctx) {
  var self = this, name = ast.name, line = ast.line, sym = this.lookup(name, scope);
  /* array element */
  if (sym && sym.kind === "array" && ast.args) {
    var ag = this.arrGetter(sym), ixf = this.cIndex(sym, ast.args, scope, ctx, line);
    return { ty: sym.type, fn: function (f) { var a = ag(f); return a.data[ixf(f, a)]; } };
  }
  if (sym && sym.kind === "const") { var cv = sym.value; return { ty: sym.type, fn: function () { return cv; } }; }
  if (sym && sym.kind === "var" && !ast.args) {
    var G = this.G, slot = sym.slot;
    if (sym.byref) return { ty: sym.type, fn: function (f) { return f[slot].get(); } };
    if (sym.global) return { ty: sym.type, fn: function () { return G[slot]; } };
    return { ty: sym.type, fn: function (f) { return f[slot]; } };
  }
  /* function return value inside its own definition */
  if (ctx && ctx.proc && ctx.proc.kind === "FUNCTION" && name === ctx.proc.name && !ast.args) {
    var rs = ctx.retSlot;
    return { ty: ctx.proc.ret, fn: function (f) { return f[rs]; } };
  }
  var b = this.cBuiltin(ast, scope, ctx);
  if (b) return b;
  if (this.procs[name] && this.procs[name].kind === "FUNCTION") return this.cUserCall(ast, scope, ctx);
  throw new QbError("Variable or function not declared: " + ast.raw, line);
};

Interp.prototype.cUserCall = function (ast, scope, ctx) {
  var self = this, def = this.procs[ast.name], args = ast.args || [];
  var binders = this.cArgs(def, args, scope, ctx, ast.line);
  return {
    ty: def.ret, fn: function (f) { return self.callProc(def, binders.map(function (b) { return b(f); })); }
  };
};

/* argument binders: array params get the array, by-reference scalars get a Ref, expressions get a temporary */
Interp.prototype.cArgs = function (def, args, scope, ctx, line) {
  var self = this;
  if (args.length !== def.params.length) throw new QbError("Argument count mismatch calling " + def.name + " (" + args.length + " for " + def.params.length + ")", line);
  return args.map(function (a, i) {
    var p = def.params[i];
    if (p.array) {
      if (a.t !== "name" || a.args === null || a.args === undefined ? !(a.t === "name") : false) throw new QbError("array argument expected for " + p.name, line);
      var sym = self.lookup(a.name, scope);
      if (!sym || sym.kind !== "array") throw new QbError("array argument expected for " + p.name, line);
      if (sym.type !== p.type) throw new QbError("Parameter type mismatch for array " + p.name, line);
      return self.arrGetter(sym);
    }
    /* an lvalue of exactly the parameter's type is passed by reference */
    if (a.t === "name") {
      var s2 = self.lookup(a.name, scope);
      if (s2 && s2.kind === "var" && !a.args) {
        if (s2.type !== p.type) throw new QbError("Parameter type mismatch: variable " + a.raw + " passed to " + p.name + " of another type (" + s2.type + " vs " + p.type + ")", line);
        var G = self.G, slot = s2.slot;
        if (s2.byref) return function (f) { return f[slot]; };
        if (s2.global) return function () { return { get: function () { return G[slot]; }, set: function (v) { G[slot] = v; } }; };
        return function (f) { return { get: function () { return f[slot]; }, set: function (v) { f[slot] = v; } }; };
      }
      if (s2 && s2.kind === "array" && a.args) {
        if (s2.type !== p.type) throw new QbError("Parameter type mismatch: array element " + a.raw + " passed to " + p.name, line);
        var ag = self.arrGetter(s2), ixf = self.cIndex(s2, a.args, scope, ctx, line);
        return function (f) { var arr = ag(f), ix = ixf(f, arr); return { get: function () { return arr.data[ix]; }, set: function (v) { arr.data[ix] = v; } }; };
      }
    }
    var c = self.cx(a, scope, ctx), conv = converter(c.ty, p.type, line);
    return function (f) { var v = c.fn(f); if (conv) v = conv(v); var box = { v: v }; return { get: function () { return box.v; }, set: function (x) { box.v = x; } }; };
  });
};

var BI = {
  LEN: { a: ["$"], r: "L", f: function (s) { return s.length; } },
  ASC: { a: ["$"], r: "I", f: function (s) { if (!s.length) throw new QbError("Illegal function call: ASC of an empty string"); return s.charCodeAt(0); } },
  "CHR$": { a: ["n"], r: "$", f: function (n) { n = bankers(n); if (n < 0 || n > 255) throw new QbError("Illegal function call: CHR$(" + n + ")"); return String.fromCharCode(n); } },
  "LEFT$": { a: ["$", "n"], r: "$", f: function (s, n) { if (n < 0) throw new QbError("Illegal function call: LEFT$"); return s.slice(0, n); } },
  "RIGHT$": { a: ["$", "n"], r: "$", f: function (s, n) { if (n < 0) throw new QbError("Illegal function call: RIGHT$"); return n === 0 ? "" : s.slice(Math.max(0, s.length - n)); } },
  "UCASE$": { a: ["$"], r: "$", f: function (s) { return s.replace(/[a-z]/g, function (c) { return c.toUpperCase(); }); } },
  "LCASE$": { a: ["$"], r: "$", f: function (s) { return s.replace(/[A-Z]/g, function (c) { return c.toLowerCase(); }); } },
  "LTRIM$": { a: ["$"], r: "$", f: function (s) { return s.replace(/^ +/, ""); } },
  "RTRIM$": { a: ["$"], r: "$", f: function (s) { return s.replace(/ +$/, ""); } },
  "SPACE$": { a: ["n"], r: "$", f: function (n) { if (n < 0) throw new QbError("Illegal function call: SPACE$"); return new Array(n + 1).join(" "); } },
  "STR$": { a: ["n"], r: "$", f: function (x) { var s = String(x); return (x >= 0 ? " " : "") + s; } },
  VAL: { a: ["$"], r: "D", f: function (s) { var m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)/.exec(s); return m ? parseFloat(m[1].replace(/[dD]/, "e")) : 0; } },
  SGN: { a: ["n"], r: "I", f: function (x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); } },
  CINT: { a: ["n"], r: "I", f: toI16 },
  CLNG: { a: ["n"], r: "L", f: toI32 },
  CSNG: { a: ["n"], r: "S", f: Math.fround },
  CDBL: { a: ["n"], r: "D", f: function (x) { return x; } },
  "MKS$": { a: ["n"], r: "$", f: function (x) { var b = Buffer.alloc(4); b.writeFloatLE(x); return b.toString("latin1"); } },
  CVS: { a: ["$"], r: "S", f: function (s) { if (s.length < 4) throw new QbError("Illegal function call: CVS needs 4 bytes"); return Buffer.from(s.slice(0, 4), "latin1").readFloatLE(0); } },
  INT: { a: ["n"], r: "=", f: Math.floor },
  FIX: { a: ["n"], r: "=", f: Math.trunc },
  ABS: { a: ["n"], r: "=", f: function (x) { return Math.abs(x); } },
  SQR: { a: ["n"], r: "F", f: function (x) { if (x < 0) throw new QbError("Illegal function call: SQR of a negative number"); return Math.sqrt(x); } },
  EXP: { a: ["n"], r: "F", f: Math.exp },
  LOG: { a: ["n"], r: "F", f: function (x) { if (x <= 0) throw new QbError("Illegal function call: LOG"); return Math.log(x); } }
};

Interp.prototype.cBuiltin = function (ast, scope, ctx) {
  var self = this, name = ast.name, line = ast.line, args = ast.args || [];
  var spec = BI[name];
  if (spec) {
    if (args.length !== spec.a.length) throw new QbError("Wrong argument count for " + ast.raw, line);
    var cs = args.map(function (a, i) {
      var c = self.cx(a, scope, ctx);
      if ((spec.a[i] === "$") !== (c.ty === "$")) throw new QbError("Type mismatch in argument " + (i + 1) + " of " + ast.raw, line);
      return c;
    });
    var ty = spec.r;
    if (ty === "=") ty = cs[0].ty;
    if (ty === "F") ty = cs[0].ty === "D" ? "D" : "S";
    var fn = spec.f, wrap = (ty === "S");
    if (cs.length === 1) { var c0 = cs[0].fn; return { ty: ty, fn: function (f) { var r = fn(c0(f)); return wrap ? Math.fround(r) : r; } }; }
    var c0b = cs[0].fn, c1b = cs[1].fn;
    return { ty: ty, fn: function (f) { return fn(c0b(f), c1b(f)); } };
  }
  function strArg(i) { var c = self.cx(args[i], scope, ctx); if (c.ty !== "$") throw new QbError("Type mismatch in argument " + (i + 1) + " of " + ast.raw, line); return c.fn; }
  function numArg(i) { var c = self.cx(args[i], scope, ctx); if (c.ty === "$") throw new QbError("Type mismatch in argument " + (i + 1) + " of " + ast.raw, line); return c.fn; }
  if (name === "MID$") {
    var s = strArg(0), st = numArg(1), ln = args.length > 2 ? numArg(2) : null;
    if (args.length < 2 || args.length > 3) throw new QbError("Wrong argument count for MID$", line);
    return {
      ty: "$", fn: function (f) {
        var str = s(f), start = st(f), len = ln ? ln(f) : 1e9;
        if (start < 1 || len < 0) throw new QbError("Illegal function call: MID$(" + start + "," + len + ")");
        return str.substr(start - 1, len);
      }
    };
  }
  if (name === "INSTR") {
    if (args.length === 2) { var a2 = strArg(0), b2 = strArg(1); return { ty: "L", fn: function (f) { return a2(f).indexOf(b2(f)) + 1; } }; }
    var sf = numArg(0), a3 = strArg(1), b3 = strArg(2);
    return { ty: "L", fn: function (f) { var st2 = sf(f); if (st2 < 1) throw new QbError("Illegal function call: INSTR"); var a = a3(f), b = b3(f); if (st2 > a.length + 1) return 0; return a.indexOf(b, st2 - 1) + 1; } };
  }
  if (name === "STRING$") {
    var cnt = numArg(0), c1 = self.cx(args[1], scope, ctx);
    return { ty: "$", fn: function (f) { var n = cnt(f); if (n < 0) throw new QbError("Illegal function call: STRING$"); var ch = c1.ty === "$" ? c1.fn(f).charAt(0) : String.fromCharCode(c1.fn(f)); return new Array(n + 1).join(ch); } };
  }
  if (name === "COMMAND$") return { ty: "$", fn: function () { return self.cmd; } };
  if (name === "FREEFILE") return { ty: "I", fn: function () { for (var i = 1; i < 256; i++) if (!self.files[i]) return i; throw new QbError("Too many files"); } };
  if (name === "LOF") { var lf = numArg(0); return { ty: "L", fn: function (f) { return self.file(lf(f)).buf.length; } }; }
  if (name === "EOF") { var ef = numArg(0); return { ty: "I", fn: function (f) { var fl = self.file(ef(f)); return (fl.mode === "INPUT" ? fl.li >= fl.lines.length : fl.pos >= fl.buf.length) ? -1 : 0; } }; }
  if (name === "INPUT$") { var nn = numArg(0), ff = numArg(1); return { ty: "$", fn: function (f) { var fl = self.file(ff(f)), n = nn(f), r = fl.buf.toString("latin1", fl.pos, fl.pos + n); fl.pos += r.length; return r; } }; }
  if (name === "UBOUND" || name === "LBOUND") {
    var asym = this.lookup(args[0].name, scope);
    if (!asym || asym.kind !== "array") throw new QbError("array expected in " + name, line);
    var ag = this.arrGetter(asym), isU = name === "UBOUND";
    return { ty: "L", fn: function (f) { return isU ? ag(f).dims[0] : 0; } };
  }
  return null;
};

/* ---- lvalues ---- */
Interp.prototype.lvalue = function (ast, scope, ctx) {
  var self = this, name = ast.name, line = ast.line;
  if (ast.t !== "name") throw new QbError("variable expected", line);
  var sym = this.lookup(name, scope), G = this.G;
  if (sym && sym.kind === "array" && ast.args) {
    var ag = this.arrGetter(sym), ixf = this.cIndex(sym, ast.args, scope, ctx, line), ty = sym.type;
    return {
      ty: ty, get: function (f) { var a = ag(f); return a.data[ixf(f, a)]; },
      set: function (f, v) { var a = ag(f); a.data[ixf(f, a)] = v; },
      ref: function (f) { var a = ag(f), ix = ixf(f, a); return { get: function () { return a.data[ix]; }, set: function (v) { a.data[ix] = v; } }; }
    };
  }
  if (sym && sym.kind === "var" && !ast.args) {
    var slot = sym.slot;
    if (sym.byref) return { ty: sym.type, fixed: sym.fixed, get: function (f) { return f[slot].get(); }, set: function (f, v) { f[slot].set(v); } };
    if (sym.global) return { ty: sym.type, fixed: sym.fixed, get: function () { return G[slot]; }, set: function (f, v) { G[slot] = v; } };
    return { ty: sym.type, fixed: sym.fixed, get: function (f) { return f[slot]; }, set: function (f, v) { f[slot] = v; } };
  }
  if (ctx && ctx.proc && ctx.proc.kind === "FUNCTION" && name === ctx.proc.name) {
    var rs = ctx.retSlot;
    return { ty: ctx.proc.ret, get: function (f) { return f[rs]; }, set: function (f, v) { f[rs] = v; } };
  }
  throw new QbError("Variable not declared: " + ast.raw, line);
};

Interp.prototype.assignFn = function (lv, rhsAst, scope, ctx, line) {
  var c = this.cx(rhsAst, scope, ctx), conv = converter(c.ty, lv.ty, line), fixed = lv.fixed, rf = c.fn;
  if (fixed) return function (f) { var s = rf(f); s = s.length >= fixed ? s.slice(0, fixed) : s + new Array(fixed - s.length + 1).join(" "); lv.set(f, s); };
  if (conv) return function (f) { lv.set(f, conv(rf(f))); };
  return function (f) { lv.set(f, rf(f)); };
};

/* ---- statements ---- */
Interp.prototype.cBlock = function (stmts, scope, ctx) {
  var self = this, fns = [];
  stmts.forEach(function (s) { var fn = self.cStmt(s, scope, ctx); if (fn) fns.push(fn); });
  return function (f) {
    for (var i = 0; i < fns.length; i++) { var r = fns[i](f); if (r) return r; }
    return 0;
  };
};

Interp.prototype.allocArray = function (type, dims, fixed) {
  var n = 1;
  dims.forEach(function (d) { n *= d + 1; });
  var data;
  if (type === "I") data = new Int16Array(n);
  else if (type === "L") data = new Int32Array(n);
  else if (type === "S") data = new Float32Array(n);
  else if (type === "D") data = new Float64Array(n);
  else { data = new Array(n); for (var i = 0; i < n; i++) data[i] = ""; }
  return { data: data, dims: dims, type: type };
};

Interp.prototype.cStmt = function (s, scope, ctx) {
  var self = this, line = s.line, G = this.G;
  var wrap = function (fn) { return function (f) { self.line = line; return fn(f); }; };
  switch (s.t) {
    case "nop": return null;
    case "proc": return null;
    case "const": {
      s.list.forEach(function (c) {
        var cc = self.cx(c.e, scope, ctx);
        var sym = self.declare(scope, { name: c.name, kind: "const", type: cc.ty, value: cc.fn([]), shared: true, line: c.line });
        sym.global = scope === self.gscope;
      });
      return null;
    }
    case "dim": {
      var steps = [];
      s.list.forEach(function (d) {
        var sym = { name: d.name, kind: d.dims ? "array" : "var", type: d.type, fixed: d.fixed, shared: s.shared || scope.module && s.shared, line: d.line };
        if (scope === self.gscope && s.shared) sym.shared = true;
        self.declare(scope, sym);
        var slot = sym.slot, isG = sym.global;
        if (d.dims) {
          var dc = d.dims.map(function (e) { var c = self.cx(e, scope, ctx); if (c.ty === "$") throw new QbError("Type mismatch in DIM", line); return c.fn; });
          steps.push(function (f) { var dm = dc.map(function (fn) { return toI32(fn(f)); }); var a = self.allocArray(d.type, dm, d.fixed); if (isG) G[slot] = a; else f[slot] = a; });
        } else {
          var init = d.fixed ? new Array(d.fixed + 1).join(" ") : defaultOf(d.type);
          if (isG) steps.push(function () { G[slot] = init; }); else { ctx.inits.push({ slot: slot, v: init }); }
        }
      });
      if (!steps.length) return null;
      return function (f) { for (var i = 0; i < steps.length; i++) steps[i](f); return 0; };
    }
    case "assign": {
      var lv = this.lvalue(s.lhs, scope, ctx), as = this.assignFn(lv, s.rhs, scope, ctx, line);
      return function (f) { self.line = line; as(f); return 0; };
    }
    case "swap": {
      var la = this.lvalue(s.a, scope, ctx), lb = this.lvalue(s.b, scope, ctx);
      return function (f) { var t = la.get(f); la.set(f, lb.get(f)); lb.set(f, t); return 0; };
    }
    case "call": return wrap(this.cCallStmt(s, scope, ctx));
    case "end": return function () { throw new EndSignal(); };
    case "exit": {
      var code = { FOR: 1, DO: 2, SUB: 3, FUNCTION: 3 }[s.what];
      if (!code) throw new QbError("unknown EXIT " + s.what, line);
      return function () { return code; };
    }
    case "if": {
      var arms = s.arms.map(function (a) {
        var c = self.cx(a.cond, scope, ctx);
        if (c.ty === "$") throw new QbError("Type mismatch in IF condition", line);
        return { c: c.fn, b: self.cBlock(a.body, scope, ctx) };
      });
      var els = s.els ? this.cBlock(s.els, scope, ctx) : null;
      return function (f) {
        self.line = line;
        for (var i = 0; i < arms.length; i++) if (arms[i].c(f) !== 0) return arms[i].b(f);
        return els ? els(f) : 0;
      };
    }
    case "for": {
      var v = this.lvalue(s.v, scope, ctx);
      if (v.ty === "$") throw new QbError("FOR variable must be numeric", line);
      var a0 = this.assignFn(v, s.a, scope, ctx, line);
      var cb = this.cx(s.b, scope, ctx), cs = s.s ? this.cx(s.s, scope, ctx) : null, body = this.cBlock(s.body, scope, ctx);
      var cvt = converter("D", v.ty, line);
      return function (f) {
        self.line = line;
        a0(f);
        var end = cb.fn(f), step = cs ? cs.fn(f) : 1;
        for (;;) {
          var cur = v.get(f);
          if (step >= 0 ? cur > end : cur < end) break;
          var r = body(f);
          if (r === 1) break;
          if (r) return r;
          var nv = v.get(f) + step;
          v.set(f, cvt ? cvt(nv) : nv);
        }
        return 0;
      };
    }
    case "do": {
      var pre = s.pre ? this.cx(s.pre.e, scope, ctx) : null, post = s.post ? this.cx(s.post.e, scope, ctx) : null, db = this.cBlock(s.body, scope, ctx);
      var preU = s.pre && s.pre.until, postU = s.post && s.post.until;
      return function (f) {
        for (;;) {
          self.line = line;
          if (pre) { var t = pre.fn(f) !== 0; if (preU ? t : !t) break; }
          var r = db(f);
          if (r === 2) break;
          if (r) return r;
          if (post) { var t2 = post.fn(f) !== 0; if (postU ? t2 : !t2) break; }
        }
        return 0;
      };
    }
    case "print": return wrap(this.cPrint(s, scope, ctx));
    case "input": return wrap(this.cInput(s, scope, ctx));
    case "open": {
      var nm = this.cx(s.name, scope, ctx), fnum = this.cx(s.file, scope, ctx);
      return wrap(function (f) { self.openFile(nm.fn(f), s.mode, fnum.fn(f)); return 0; });
    }
    case "close": {
      var cl = s.list.map(function (e) { return self.cx(e, scope, ctx).fn; });
      return wrap(function (f) { if (!cl.length) Object.keys(self.files).forEach(function (k) { self.closeFile(+k); }); cl.forEach(function (fn) { self.closeFile(fn(f)); }); return 0; });
    }
    case "kill": { var kn = this.cx(s.name, scope, ctx); return wrap(function (f) { var p = path.resolve(self.cwd, kn.fn(f)); if (!fs.existsSync(p)) throw new QbError("File not found: " + kn.fn(f)); fs.unlinkSync(p); return 0; }); }
    case "get": case "put": return wrap(this.cGetPut(s, scope, ctx));
  }
  throw new QbError("cannot compile statement " + s.t, line);
};

Interp.prototype.cCallStmt = function (s, scope, ctx) {
  var self = this, def = this.procs[s.name];
  if (!def || def.kind !== "SUB") {
    if (def && def.kind === "FUNCTION") {
      var c = this.cName({ t: "name", name: s.name, raw: s.name, args: s.args, line: s.line }, scope, ctx);
      return function (f) { c.fn(f); return 0; };
    }
    throw new QbError("SUB not defined: " + s.name, s.line);
  }
  var binders = this.cArgs(def, s.args, scope, ctx, s.line);
  return function (f) { self.callProc(def, binders.map(function (b) { return b(f); })); return 0; };
};

Interp.prototype.defineProc = function (p) {
  if (RESERVED[p.name.replace(/[$%&!#]$/, "")] && !/[$%&!#]$/.test(p.name)) throw new QbError(p.name + " is a reserved word and cannot be a name", p.line);
  if (this.procs[p.name]) throw new QbError("Procedure defined twice: " + p.name, p.line);
  this.procs[p.name] = { kind: p.kind, name: p.name, params: p.params, ret: p.ret, ast: p, compiled: null };
};

Interp.prototype.compileProc = function (def) {
  var scope = { vars: Object.create(null), n: 0, module: false }, ctx = { proc: def, retSlot: 0, inits: [] }, self = this;
  def.params.forEach(function (p) {
    var sym = { name: p.name, kind: p.array ? "array" : "var", type: p.type, byref: !p.array, line: def.ast.line };
    self.declare(scope, sym);
    sym.global = false;
  });
  ctx.retSlot = scope.n++;
  var body = this.cBlock(def.ast.body, scope, ctx);
  def.compiled = { body: body, n: scope.n, inits: ctx.inits, retSlot: ctx.retSlot, retDefault: def.ret ? defaultOf(def.ret) : 0 };
};

Interp.prototype.callProc = function (def, args) {
  if (!def.compiled) this.compileProc(def);
  var c = def.compiled, f = new Array(c.n), i;
  for (i = 0; i < c.inits.length; i++) f[c.inits[i].slot] = c.inits[i].v;
  for (i = 0; i < args.length; i++) f[i] = args[i];
  f[c.retSlot] = c.retDefault;
  if (this.depth === undefined) this.depth = 0;
  if (++this.depth > 400) throw new QbError("Out of stack space");
  try { c.body(f); } finally { this.depth--; }
  return f[c.retSlot];
};

/* ---- PRINT / INPUT / files ---- */
function fmtPrintNum(x, ty) {
  var s;
  if (ty === "I" || ty === "L" || Number.isInteger(x)) s = String(x);
  else s = String(parseFloat(x.toPrecision(ty === "S" ? 7 : 15)));
  return (x >= 0 ? " " : "") + s + " ";
}

Interp.prototype.cPrint = function (s, scope, ctx) {
  var self = this, items = s.items.map(function (it) {
    if (it.tab) return { tab: true };
    var c = self.cx(it.e, scope, ctx);
    return { c: c };
  }), file = s.file ? this.cx(s.file, scope, ctx).fn : null, nl = s.nl;
  return function (f) {
    var text = "";
    items.forEach(function (it) {
      if (it.tab) { text += new Array(14 - (text.length % 14) + 1).join(" "); return; }
      var v = it.c.fn(f);
      text += it.c.ty === "$" ? v : fmtPrintNum(v, it.c.ty);
    });
    if (nl) text += "\n";
    if (file) { var fl = self.file(file(f)); if (fl.mode !== "OUTPUT" && fl.mode !== "APPEND") throw new QbError("Bad file mode"); fl.out.push(text); }
    else self.write(text);
    return 0;
  };
};

Interp.prototype.cInput = function (s, scope, ctx) {
  var self = this, targets = s.targets.map(function (t) { return self.lvalue(t, scope, ctx); }), file = s.file ? this.cx(s.file, scope, ctx).fn : null;
  return function (f) {
    var line;
    if (file) {
      var fl = self.file(file(f));
      if (fl.mode !== "INPUT") throw new QbError("Bad file mode");
      if (fl.li >= fl.lines.length) throw new QbError("Input past end of file");
      line = fl.lines[fl.li++];
    } else {
      if (s.prompt !== null) self.write(s.prompt);
      line = self.readLine();
      if (line === null) throw new QbError("Input past end (no more stdin lines)");
    }
    if (s.isLine) { targets[0].set(f, line); return 0; }
    var parts = line.split(",");
    targets.forEach(function (t, i) { var v = parts[i] === undefined ? "" : parts[i]; t.set(f, t.ty === "$" ? v : (parseFloat(v) || 0)); });
    return 0;
  };
};

/* the next line typed by the user: from the preloaded --stdin file, else read from standard input one byte at a time */
Interp.prototype.readLine = function () {
  if (this.stdin.length) return this.stdin.shift();
  if (this.opts.preloaded || this.eof) return null;
  this.flush();
  var buf = Buffer.alloc(1), bytes = [];
  for (;;) {
    var n;
    try { n = fs.readSync(0, buf, 0, 1, null); }
    catch (e) { if (e.code === "EAGAIN") continue; if (e.code === "EOF") n = 0; else throw e; }
    if (n === 0) { this.eof = true; if (!bytes.length) return null; break; }
    if (buf[0] === 10) break;
    bytes.push(buf[0]);
  }
  return Buffer.from(bytes).toString("latin1").replace(/\r$/, "");
};

Interp.prototype.file = function (n) {
  var fl = this.files[n];
  if (!fl) throw new QbError("Bad file name or number: " + n);
  return fl;
};

Interp.prototype.openFile = function (name, mode, n) {
  var p = path.resolve(this.cwd, name);
  if (this.files[n]) throw new QbError("File already open: " + n);
  var fl = { name: p, mode: mode, buf: Buffer.alloc(0), pos: 0, out: [], lines: [], li: 0 };
  if (mode === "INPUT") {
    if (!fs.existsSync(p)) throw new QbError("File not found: " + name);
    fl.buf = fs.readFileSync(p);
    var txt = fl.buf.toString("latin1").replace(/\r/g, "");
    fl.lines = txt.split("\n");
    if (fl.lines[fl.lines.length - 1] === "") fl.lines.pop();
  } else if (mode === "BINARY") {
    if (fs.existsSync(p)) fl.buf = fs.readFileSync(p); else fs.writeFileSync(p, Buffer.alloc(0));
  } else if (mode === "OUTPUT") { fs.writeFileSync(p, Buffer.alloc(0)); }
  else if (mode === "APPEND") { if (fs.existsSync(p)) fl.buf = fs.readFileSync(p); fl.out.push(fl.buf.toString("latin1")); }
  this.files[n] = fl;
};

Interp.prototype.closeFile = function (n) {
  var fl = this.files[n];
  if (!fl) return;
  if (fl.mode === "OUTPUT" || fl.mode === "APPEND") fs.writeFileSync(fl.name, Buffer.from(fl.out.join(""), "latin1"));
  else if (fl.mode === "BINARY" && fl.dirty) fs.writeFileSync(fl.name, fl.buf);
  delete this.files[n];
};

Interp.prototype.cGetPut = function (s, scope, ctx) {
  var self = this, fnum = this.cx(s.file, scope, ctx).fn, lv = this.lvalue(s.target, scope, ctx), isGet = s.t === "get";
  var pos = s.pos ? this.cx(s.pos, scope, ctx).fn : null;
  return function (f) {
    var fl = self.file(fnum(f));
    if (fl.mode !== "BINARY") throw new QbError("Bad file mode");
    if (pos) fl.pos = pos(f) - 1;
    var ty = lv.ty, size = ty === "I" ? 2 : (ty === "L" || ty === "S" ? 4 : (ty === "D" ? 8 : lv.fixed));
    if (!size && ty === "$" && !isGet) size = lv.get(f).length;      /* PUT of a plain string writes all of it */
    if (!size && !(ty === "$" && !isGet && size === 0)) throw new QbError("GET/PUT needs a fixed-length string or a numeric variable");
    if (size === 0) return 0;
    if (isGet) {
      if (fl.pos + size > fl.buf.length) throw new QbError("Input past end of file");
      var v;
      if (ty === "I") v = fl.buf.readInt16LE(fl.pos);
      else if (ty === "L") v = fl.buf.readInt32LE(fl.pos);
      else if (ty === "S") v = fl.buf.readFloatLE(fl.pos);
      else if (ty === "D") v = fl.buf.readDoubleLE(fl.pos);
      else v = fl.buf.toString("latin1", fl.pos, fl.pos + size);
      lv.set(f, v);
    } else {
      var val = lv.get(f), b = Buffer.alloc(size);
      if (ty === "I") b.writeInt16LE(val); else if (ty === "L") b.writeInt32LE(val); else if (ty === "S") b.writeFloatLE(val);
      else if (ty === "D") b.writeDoubleLE(val); else b.write(val, "latin1");
      if (fl.pos + size > fl.buf.length) fl.buf = Buffer.concat([fl.buf, Buffer.alloc(fl.pos + size - fl.buf.length)]);
      b.copy(fl.buf, fl.pos);
      fl.dirty = true;
    }
    fl.pos += size;
    return 0;
  };
};

/* ---- run ---- */
Interp.prototype.run = function (file) {
  var src = [];
  preprocess(path.resolve(file), {}, src, 0);
  var toks = lex(src), parser = new Parser(toks);
  var prog = parser.program();
  /* procedures first so calls resolve */
  var self = this;
  prog.forEach(function (s) { if (s.t === "proc") self.defineProc(s); });
  var ctx = { proc: null, retSlot: 0, inits: [] };
  var body = this.cBlock(prog, this.gscope, ctx);
  try {
    body(this.G);
  } catch (e) {
    if (!(e instanceof EndSignal)) { this.closeAll(); throw e; }
  }
  this.closeAll();
};

Interp.prototype.closeAll = function () {
  var self = this;
  Object.keys(this.files).forEach(function (k) { self.closeFile(+k); });
  this.flush();
};

module.exports = { Interp: Interp, QbError: QbError, preprocess: preprocess, lex: lex, Parser: Parser };

if (require.main === module) {
  var args = process.argv.slice(2), file = args[0], cmd = "", stdin = [];
  for (var i = 1; i < args.length; i++) {
    if (args[i] === "--cmd") cmd = args[++i];
    else if (args[i] === "--stdin") stdin = fs.readFileSync(args[++i], "latin1").replace(/\r/g, "").split("\n");
  }
  if (!file) { console.error("usage: node qbi.js program.bas [--cmd text] [--stdin file]"); process.exit(2); }
  var it = new Interp({ cmd: cmd, stdin: stdin, preloaded: args.indexOf("--stdin") >= 0 });
  try {
    it.run(file);
  } catch (e) {
    it.flush();
    if (e instanceof QbError) { console.error("BASIC error: " + e.message + " (line " + (e.line || it.line) + ")"); process.exit(1); }
    throw e;
  }
}
