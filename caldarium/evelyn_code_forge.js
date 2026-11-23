/* evelyn_code_forge.js - Upgrades Evelyn Into a Multi-Language Coding Workstation:
   1. MiniHistory           (Content-addressed commits, line-by-line diff, instant rollback)
   2. MiniSQL           (Pure-ES5 relational SQL: CREATE, INSERT, SELECT/WHERE/ORDER/LIMIT/AGG)
   3. Asm6502 & VM6502  (Real 2-pass 6502 assembler with labels + cycle-stepping CPU VM)
   4. SingleFileExporter(Packages student HTML/CSS/JS into 1 standalone offline .html app)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynSentinel) require("./evelyn_sentinel.js");

  var Sent = root.EvelynSentinel;

  /* =========================================================================
     1. MINIHISTORY (OFFLINE VERSION CONTROL, LINE DIFF & ROLLBACK)
     ========================================================================= */
  function cloneMap(obj) {
    var out = Object.create(null);
    for (var k in obj) out[k] = String(obj[k]);
    return out;
  }

  function diffLines(textA, textB) {
    var a = String(textA || "").split(/\r?\n/);
    var b = String(textB || "").split(/\r?\n/);
    var out = [], i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        out.push({ type: "same", text: a[i] }); i++; j++;
      } else if (j < b.length && (i >= a.length || a.indexOf(b[j], i) < 0)) {
        out.push({ type: "add", text: b[j] }); j++;
      } else {
        out.push({ type: "del", text: a[i] }); i++;
      }
    }
    return out;
  }

  function MiniHistory() {
    this.commits = Object.create(null);
    this.order = [];
    this.head = null;
  }

  MiniHistory.prototype.commit = function (message, filesMap) {
    var snap = cloneMap(filesMap || {});
    var payload = (this.head || "ROOT") + "|" + String(message || "update") + "|" + JSON.stringify(snap);
    var hash = (Sent ? Sent.crc32(payload).toString(16) : String(Date.now())) + "_" + this.order.length;
    var rec = { hash: hash, parent: this.head, message: String(message || "update"), files: snap, at: Date.now() };
    this.commits[hash] = rec;
    this.order.push(hash);
    this.head = hash;
    return rec;
  };

  MiniHistory.prototype.log = function () {
    var out = [];
    for (var i = this.order.length - 1; i >= 0; i--) {
      var c = this.commits[this.order[i]];
      out.push({ hash: c.hash, parent: c.parent, message: c.message });
    }
    return out;
  };

  MiniHistory.prototype.checkout = function (hash) {
    var c = this.commits[hash];
    if (!c) return { ok: false, error: "Commit not found: " + hash };
    this.head = hash;
    return { ok: true, files: cloneMap(c.files), commit: c };
  };

  MiniHistory.prototype.diff = function (hashA, hashB, fileName) {
    var a = this.commits[hashA], b = this.commits[hashB];
    if (!a || !b) return { ok: false, error: "Commit hash missing." };
    return { ok: true, lines: diffLines(a.files[fileName] || "", b.files[fileName] || "") };
  };

  /* =========================================================================
     2. MINISQL (PURE-ES5 RELATIONAL QUERY ENGINE — ZERO eval())
        Supports CREATE TABLE, INSERT INTO, SELECT/WHERE/ORDER BY/LIMIT & COUNT/SUM/AVG
     ========================================================================= */
  function parseSqlVal(tok) {
    var s = String(tok || "").trim();
    if ((s.charAt(0) === "'" && s.charAt(s.length - 1) === "'") ||
        (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"')) {
      return s.slice(1, -1);
    }
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
    return s;
  }

  function MiniSQL() {
    this.tables = Object.create(null); // tableName -> { cols: [], rows: [] }
  }

  MiniSQL.prototype.exec = function (sql) {
    var q = String(sql || "").trim().replace(/;$/, "").trim();
    if (!q) return { ok: false, error: "Empty SQL statement." };

    /* CREATE TABLE name (c1, c2, ...) */
    var mCreate = q.match(/^CREATE\s+TABLE\s+([A-Za-z_]\w*)\s*\(([^)]+)\)$/i);
    if (mCreate) {
      var tName = mCreate[1].toLowerCase();
      var cols = mCreate[2].split(",").map(function (c) { return c.trim().split(/\s+/)[0].toLowerCase(); });
      this.tables[tName] = { cols: cols, rows: [] };
      return { ok: true, message: "Created table " + tName + " (" + cols.join(", ") + ")." };
    }

    /* INSERT INTO name VALUES (v1, v2, ...) */
    var mIns = q.match(/^INSERT\s+INTO\s+([A-Za-z_]\w*)\s+VALUES\s*\((.+)\)$/i);
    if (mIns) {
      var tbl = this.tables[mIns[1].toLowerCase()];
      if (!tbl) return { ok: false, error: "Unknown table: " + mIns[1] };
      var rawVals = mIns[2].match(/'[^']*'|"[^"]*"|[^,]+/g) || [];
      if (rawVals.length !== tbl.cols.length) {
        return { ok: false, error: "Column count mismatch: expected " + tbl.cols.length + ", got " + rawVals.length };
      }
      var row = Object.create(null);
      for (var i = 0; i < tbl.cols.length; i++) row[tbl.cols[i]] = parseSqlVal(rawVals[i]);
      tbl.rows.push(row);
      return { ok: true, inserted: 1, rowCount: tbl.rows.length };
    }

    /* SELECT <cols|agg> FROM <tbl> [WHERE c op v] [ORDER BY c [ASC|DESC]] [LIMIT n] */
    var mSel = q.match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z_]\w*)(?:\s+WHERE\s+([A-Za-z_]\w*)\s*(=|!=|>=|<=|>|<)\s*('[^']*'|"[^"]*"|\S+))?(?:\s+ORDER\s+BY\s+([A-Za-z_]\w*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?$/i);
    if (mSel) {
      var src = this.tables[mSel[2].toLowerCase()];
      if (!src) return { ok: false, error: "Unknown table: " + mSel[2] };
      var rows = src.rows.slice(0);

      /* WHERE filter */
      if (mSel[3]) {
        var wCol = mSel[3].toLowerCase(), wOp = mSel[4], wVal = parseSqlVal(mSel[5]);
        var filt = [];
        for (var r = 0; r < rows.length; r++) {
          var v = rows[r][wCol], pass = false;
          if (wOp === "=") pass = (v === wVal);
          else if (wOp === "!=") pass = (v !== wVal);
          else if (wOp === ">") pass = (v > wVal);
          else if (wOp === "<") pass = (v < wVal);
          else if (wOp === ">=") pass = (v >= wVal);
          else if (wOp === "<=") pass = (v <= wVal);
          if (pass) filt.push(rows[r]);
        }
        rows = filt;
      }

      /* Aggregate check: COUNT(*), SUM(col), AVG(col) */
      var selExpr = mSel[1].trim();
      var mAgg = selExpr.match(/^(COUNT|SUM|AVG)\s*\(\s*(\*|[A-Za-z_]\w*)\s*\)$/i);
      if (mAgg) {
        var fn = mAgg[1].toUpperCase(), col = mAgg[2].toLowerCase();
        if (fn === "COUNT") return { ok: true, rows: [{ count: rows.length }] };
        var sum = 0;
        for (var a = 0; a < rows.length; a++) sum += Number(rows[a][col]) || 0;
        if (fn === "SUM") return { ok: true, rows: [{ sum: sum }] };
        return { ok: true, rows: [{ avg: rows.length ? sum / rows.length : 0 }] };
      }

      /* ORDER BY */
      if (mSel[6]) {
        var oCol = mSel[6].toLowerCase(), desc = (mSel[7] && mSel[7].toUpperCase() === "DESC");
        rows.sort(function (x, y) {
          if (x[oCol] < y[oCol]) return desc ? 1 : -1;
          if (x[oCol] > y[oCol]) return desc ? -1 : 1;
          return 0;
        });
      }

      /* LIMIT */
      if (mSel[8]) rows = rows.slice(0, parseInt(mSel[8], 10));

      /* Column projection */
      if (selExpr === "*") return { ok: true, rows: rows };
      var wantCols = selExpr.split(",").map(function (c) { return c.trim().toLowerCase(); });
      var proj = [];
      for (var p = 0; p < rows.length; p++) {
        var pr = Object.create(null);
        for (var c = 0; c < wantCols.length; c++) pr[wantCols[c]] = rows[p][wantCols[c]];
        proj.push(pr);
      }
      return { ok: true, rows: proj };
    }

    return { ok: false, error: "Unsupported SQL syntax: " + q };
  };

  /* =========================================================================
     3. REAL 2-PASS 6502 ASSEMBLER + CYCLE-STEPPING EDUCATIONAL CPU VM
        Matches the 6502 disassembler in evelyn_game_xray.js!
     ========================================================================= */
  function parse6502Num(s) {
    s = String(s || "").trim();
    if (s.charAt(0) === "$") return parseInt(s.slice(1), 16);
    return parseInt(s, 10);
  }

  var Asm6502 = {
    assemble: function (src) {
      var rawLines = String(src || "").split(/\r?\n/);
      var labels = Object.create(null), parsed = [], pc = 0x0600, i;

      /* Pass 1: strip comments, collect labels, measure instruction sizes */
      for (i = 0; i < rawLines.length; i++) {
        var ln = rawLines[i].split(";")[0].trim();
        if (!ln) continue;
        if (ln.indexOf(":") > 0) {
          var pts = ln.split(":");
          labels[pts[0].trim().toLowerCase()] = pc;
          ln = pts.slice(1).join(":").trim();
          if (!ln) continue;
        }
        var m = ln.match(/^([A-Za-z]{3})(?:\s+(.+))?$/);
        if (!m) return { ok: false, error: "Line " + (i + 1) + ": bad syntax '" + ln + "'" };
        var op = m[1].toUpperCase(), arg = (m[2] || "").trim();
        var size = (op === "CLC" || op === "INX" || op === "DEX" || op === "INY" || op === "DEY" || op === "NOP" || op === "BRK") ? 1 : 2;
        parsed.push({ line: i + 1, op: op, arg: arg, addr: pc, size: size });
        pc += size;
      }

      /* Pass 2: emit real 6502 machine bytes */
      var bytes = [];
      for (i = 0; i < parsed.length; i++) {
        var ins = parsed[i], op = ins.op, arg = ins.arg, val;
        if (op === "CLC") bytes.push(0x18);
        else if (op === "INX") bytes.push(0xE8);
        else if (op === "DEX") bytes.push(0xCA);
        else if (op === "INY") bytes.push(0xC8);
        else if (op === "DEY") bytes.push(0x88);
        else if (op === "NOP") bytes.push(0xEA);
        else if (op === "BRK") bytes.push(0x00);
        else if (op === "LDA" && arg.charAt(0) === "#") bytes.push(0xA9, parse6502Num(arg.slice(1)) & 255);
        else if (op === "LDA") bytes.push(0xA5, parse6502Num(arg) & 255);
        else if (op === "LDX" && arg.charAt(0) === "#") bytes.push(0xA2, parse6502Num(arg.slice(1)) & 255);
        else if (op === "LDY" && arg.charAt(0) === "#") bytes.push(0xA0, parse6502Num(arg.slice(1)) & 255);
        else if (op === "STA") bytes.push(0x85, parse6502Num(arg) & 255);
        else if (op === "STX") bytes.push(0x86, parse6502Num(arg) & 255);
        else if (op === "ADC" && arg.charAt(0) === "#") bytes.push(0x69, parse6502Num(arg.slice(1)) & 255);
        else if (op === "CPX" && arg.charAt(0) === "#") bytes.push(0xE0, parse6502Num(arg.slice(1)) & 255);
        else if (op === "BNE" || op === "BEQ") {
          var target = labels[arg.toLowerCase()];
          if (target === undefined) return { ok: false, error: "Line " + ins.line + ": unknown label '" + arg + "'" };
          var rel = target - (ins.addr + 2);
          if (rel < -128 || rel > 127) return { ok: false, error: "Line " + ins.line + ": branch out of range" };
          bytes.push(op === "BNE" ? 0xD0 : 0xF0, rel & 255);
        } else {
          return { ok: false, error: "Line " + ins.line + ": unsupported instruction '" + op + " " + arg + "'" };
        }
      }
      return { ok: true, loadAddr: 0x0600, bytes: new Uint8Array(bytes), labels: labels };
    }
  };

  function VM6502() {
    this.ram = new Uint8Array(2048); // $0000-$00FF zero-page, $0600+ program
    this.reset();
  }
  VM6502.prototype.reset = function () {
    for (var i = 0; i < this.ram.length; i++) this.ram[i] = 0;
    this.A = 0; this.X = 0; this.Y = 0; this.PC = 0x0600;
    this.Z = 0; this.N = 0; this.C = 0; this.halted = false; this.steps = 0;
  };
  VM6502.prototype.load = function (bytes, loadAddr) {
    this.reset();
    var base = loadAddr || 0x0600;
    this.PC = base;
    for (var i = 0; i < bytes.length && base + i < this.ram.length; i++) this.ram[base + i] = bytes[i];
  };
  VM6502.prototype._setZN = function (v) { this.Z = ((v & 255) === 0) ? 1 : 0; this.N = (v & 0x80) ? 1 : 0; };
  VM6502.prototype.step = function () {
    if (this.halted || this.PC >= this.ram.length) { this.halted = true; return this.snapshot(); }
    var op = this.ram[this.PC++], v, rel;
    this.steps++;
    if (op === 0x00) { this.halted = true; }
    else if (op === 0x18) { this.C = 0; }
    else if (op === 0xA9) { this.A = this.ram[this.PC++]; this._setZN(this.A); }
    else if (op === 0xA5) { this.A = this.ram[this.ram[this.PC++]]; this._setZN(this.A); }
    else if (op === 0xA2) { this.X = this.ram[this.PC++]; this._setZN(this.X); }
    else if (op === 0xA0) { this.Y = this.ram[this.PC++]; this._setZN(this.Y); }
    else if (op === 0x85) { this.ram[this.ram[this.PC++]] = this.A; }
    else if (op === 0x86) { this.ram[this.ram[this.PC++]] = this.X; }
    else if (op === 0x69) { v = this.A + this.ram[this.PC++] + this.C; this.C = v > 255 ? 1 : 0; this.A = v & 255; this._setZN(this.A); }
    else if (op === 0xE8) { this.X = (this.X + 1) & 255; this._setZN(this.X); }
    else if (op === 0xCA) { this.X = (this.X - 1) & 255; this._setZN(this.X); }
    else if (op === 0xC8) { this.Y = (this.Y + 1) & 255; this._setZN(this.Y); }
    else if (op === 0x88) { this.Y = (this.Y - 1) & 255; this._setZN(this.Y); }
    else if (op === 0xE0) { v = this.X - this.ram[this.PC++]; this.C = v >= 0 ? 1 : 0; this._setZN(v & 255); }
    else if (op === 0xD0) { rel = this.ram[this.PC++]; if (!this.Z) this.PC += (rel > 127 ? rel - 256 : rel); }
    else if (op === 0xF0) { rel = this.ram[this.PC++]; if (this.Z) this.PC += (rel > 127 ? rel - 256 : rel); }
    else if (op === 0xEA) { /* NOP */ }
    else { this.halted = true; }
    return this.snapshot();
  };
  VM6502.prototype.run = function (maxSteps) {
    var cap = maxSteps || 500;
    while (!this.halted && this.steps < cap) this.step();
    return this.snapshot();
  };
  VM6502.prototype.snapshot = function () {
    return { A: this.A, X: this.X, Y: this.Y, PC: this.PC, Z: this.Z, N: this.N, C: this.C, steps: this.steps, halted: this.halted };
  };

  /* =========================================================================
     4. STANDALONE SINGLE-FILE OFFLINE WEB APP EXPORTER
     ========================================================================= */
  var SingleFileExporter = {
    buildAppHTML: function (project) {
      var title = String((project && project.title) || "My Offline App").replace(/</g, "&lt;");
      var css = String((project && project.css) || "body{font-family:monospace;background:#04041c;color:#48fca8;padding:14px;}");
      var html = String((project && project.html) || "<h3>Hello Offline World</h3>");
      var js = String((project && project.js) || "").replace(/<\/script/gi, "<\\/script");
      return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>" + title +
        "</title>\n<style>\n" + css + "\n</style>\n</head>\n<body>\n" + html +
        "\n<script>\n" + js + "\n</script>\n</body>\n</html>";
    }
  };

  root.EvelynCodeForge = {
    diffLines: diffLines,
    MiniHistory: MiniHistory,
    MiniSQL: MiniSQL,
    Asm6502: Asm6502,
    VM6502: VM6502,
    SingleFileExporter: SingleFileExporter
  };
})(typeof window !== "undefined" ? window : global);
