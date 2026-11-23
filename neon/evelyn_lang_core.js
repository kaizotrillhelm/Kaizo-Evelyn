/* evelyn_lang_core.js - Modular Multi-Language Engine for Evelyn
   Supports any language via ~25-line declarative Language Packs across 4 block styles:
     - braces      (JS, C, C++, Rust, Go, Java)
     - indent      (Python, Nim)
     - end_keyword (BASIC, Lua, Ruby)
     - label       (6502, MIPS, ARM, RISC-V Assembly)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. LANGUAGE PACK REGISTRY (BUILTIN PACKS + RUNTIME JSON EXTENSIBILITY)
     ========================================================================= */
  var packs = Object.create(null);
  var extMap = Object.create(null);

  function toSetMap(arr) {
    var m = Object.create(null);
    for (var i = 0; i < (arr ? arr.length : 0); i++) m[arr[i]] = 1;
    return m;
  }

  function registerLanguage(spec) {
    if (!spec || !spec.id) throw new Error("Language pack requires an 'id'.");
    var norm = {
      id: spec.id,
      name: spec.name || spec.id,
      extensions: spec.extensions || [],
      lineComment: spec.lineComment || "",
      blockCommentStart: spec.blockCommentStart || "",
      blockCommentEnd: spec.blockCommentEnd || "",
      strings: spec.strings || ['"', "'"],
      blockStyle: spec.blockStyle || "braces", // braces | indent | end_keyword | label
      defRegex: spec.defRegex instanceof RegExp ? spec.defRegex : new RegExp(spec.defRegex, spec.defFlags || ""),
      endRegex: spec.endRegex ? (spec.endRegex instanceof RegExp ? spec.endRegex : new RegExp(spec.endRegex, spec.endFlags || "")) : null,
      testRegex: spec.testRegex ? (spec.testRegex instanceof RegExp ? spec.testRegex : new RegExp(spec.testRegex)) : /^test_/i,
      keywords: toSetMap(spec.keywords || []),
      caseInsensitive: !!spec.caseInsensitive,
      runner: spec.runner || null
    };
    packs[norm.id] = norm;
    for (var i = 0; i < norm.extensions.length; i++) {
      extMap[norm.extensions[i].toLowerCase()] = norm.id;
    }
    return norm;
  }

  function getPack(langOrFile) {
    if (packs[langOrFile]) return packs[langOrFile];
    var s = String(langOrFile || "").toLowerCase();
    var dot = s.lastIndexOf(".");
    if (dot >= 0 && extMap[s.slice(dot)]) return packs[extMap[s.slice(dot)]];
    return packs.javascript;
  }

  /* Built-in Packs covering all 4 block families */
  registerLanguage({
    id: "javascript", name: "JavaScript (ES5)", extensions: [".js"],
    lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", strings: ['"', "'"],
    blockStyle: "braces",
    defRegex: "^\\s*function\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(([^)]*)\\)",
    keywords: ["var","function","if","else","for","while","return","true","false","null","new","this"],
    runner: "node {file}"
  });

  registerLanguage({
    id: "python", name: "Python", extensions: [".py"],
    lineComment: "#", strings: ['"', "'"],
    blockStyle: "indent",
    defRegex: "^\\s*def\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\(([^)]*)\\)\\s*:",
    keywords: ["def","class","if","elif","else","for","while","return","import","from","in","and","or","not","True","False","None"],
    runner: "python3 {file}"
  });

  registerLanguage({
    id: "c", name: "C (C89/C99)", extensions: [".c", ".h"],
    lineComment: "//", blockCommentStart: "/*", blockCommentEnd: "*/", strings: ['"', "'"],
    blockStyle: "braces",
    defRegex: "^\\s*(?:static\\s+)?(?:const\\s+)?(?:unsigned\\s+)?[A-Za-z_][A-Za-z0-9_*\\s]+?\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\(([^)]*)\\)\\s*\\{?",
    keywords: ["int","float","double","char","void","long","short","unsigned","signed","static","const","if","else","for","while","return","struct","typedef"],
    runner: "tcc -run {file}"
  });

  registerLanguage({
    id: "basic", name: "QuickBASIC / FreeBASIC", extensions: [".bas"],
    lineComment: "'", strings: ['"'],
    blockStyle: "end_keyword", caseInsensitive: true,
    defRegex: "^\\s*(?:SUB|FUNCTION)\\s+([A-Za-z_][A-Za-z0-9_$%!]*)\\s*(?:\\(([^)]*)\\))?",
    defFlags: "i",
    endRegex: "^\\s*END\\s+(?:SUB|FUNCTION)\\b",
    endFlags: "i",
    keywords: ["SUB","FUNCTION","END","DIM","IF","THEN","ELSE","FOR","TO","NEXT","DO","LOOP","PRINT","LET","RETURN"],
    runner: "fbc -lang qb {file}"
  });

  registerLanguage({
    id: "lua", name: "Lua", extensions: [".lua"],
    lineComment: "--", strings: ['"', "'"],
    blockStyle: "end_keyword",
    defRegex: "^\\s*(?:local\\s+)?function\\s+([A-Za-z_][A-Za-z0-9_.]*)\\s*\\(([^)]*)\\)",
    endRegex: "^\\s*end\\b",
    keywords: ["local","function","end","if","then","else","elseif","for","while","do","return","true","false","nil","and","or","not"],
    runner: "lua {file}"
  });

  registerLanguage({
    id: "asm6502", name: "6502 Assembly", extensions: [".asm", ".s"],
    lineComment: ";", strings: ['"'],
    blockStyle: "label", caseInsensitive: true,
    defRegex: "^\\s*([A-Za-z_][A-Za-z0-9_]*):",
    keywords: ["LDA","LDX","LDY","STA","STX","STY","ADC","SBC","CLC","SEC","INX","DEX","INY","DEY","CPX","BNE","BEQ","JMP","JSR","RTS","NOP","BRK"],
    runner: "evelyn-vm6502 {file}"
  });

  /* =========================================================================
     2. GENERIC PACK-DRIVEN LEXER & SYNTAX CHECKER (ANY LANGUAGE)
     ========================================================================= */
  function lex(src, langOrFile) {
    var pk = getPack(langOrFile);
    var s = String(src || ""), n = s.length, i = 0, line = 1, col = 1;
    var tokens = [], errors = [];
    var lc = pk.lineComment, bcs = pk.blockCommentStart, bce = pk.blockCommentEnd;

    while (i < n) {
      var ch = s.charAt(i);
      if (ch === " " || ch === "\t" || ch === "\r") { i++; col++; continue; }
      if (ch === "\n") { i++; line++; col = 1; continue; }

      /* Line comments */
      if (lc && s.slice(i, i + lc.length) === lc) {
        var cStart = i;
        while (i < n && s.charAt(i) !== "\n") { i++; col++; }
        tokens.push({ type: "comment", val: s.slice(cStart, i), line: line, start: cStart, end: i });
        continue;
      }

      /* Block comments */
      if (bcs && bce && s.slice(i, i + bcs.length) === bcs) {
        var bcLine = line, bcStart = i;
        i += bcs.length; col += bcs.length;
        var closed = false;
        while (i < n) {
          if (s.slice(i, i + bce.length) === bce) { i += bce.length; col += bce.length; closed = true; break; }
          if (s.charAt(i) === "\n") { line++; col = 1; } else col++;
          i++;
        }
        if (!closed) errors.push({ line: bcLine, col: 1, code: "UNCLOSED_COMMENT", msg: "Unclosed block comment." });
        tokens.push({ type: "comment", val: s.slice(bcStart, i), line: bcLine, start: bcStart, end: i });
        continue;
      }

      /* Strings */
      if (pk.strings.indexOf(ch) >= 0) {
        var q = ch, sStart = i, sLine = line, sCol = col, okStr = false;
        i++; col++;
        while (i < n) {
          var sc = s.charAt(i);
          if (sc === "\\") { i += 2; col += 2; continue; }
          if (sc === q) { i++; col++; okStr = true; break; }
          if (sc === "\n") break;
          i++; col++;
        }
        if (!okStr) errors.push({ line: sLine, col: sCol, code: "UNCLOSED_STRING", msg: "Unclosed string literal." });
        tokens.push({ type: "string", val: s.slice(sStart, i), line: sLine, start: sStart, end: i });
        continue;
      }

      /* Numbers */
      if (ch >= "0" && ch <= "9") {
        var nStart = i;
        while (i < n && /[0-9a-fA-FxX.]/.test(s.charAt(i))) { i++; col++; }
        tokens.push({ type: "number", val: s.slice(nStart, i), line: line, start: nStart, end: i });
        continue;
      }

      /* Identifiers & Keywords */
      if (/[A-Za-z_$]/.test(ch)) {
        var idStart = i;
        while (i < n && /[A-Za-z0-9_$]/.test(s.charAt(i))) { i++; col++; }
        var word = s.slice(idStart, i);
        var keyCheck = pk.caseInsensitive ? word.toUpperCase() : word;
        tokens.push({ type: pk.keywords[keyCheck] ? "keyword" : "ident", val: word, line: line, start: idStart, end: i });
        continue;
      }

      tokens.push({ type: "punct", val: ch, line: line, start: i, end: i + 1 });
      i++; col++;
    }
    return { lang: pk.id, tokens: tokens, errors: errors };
  }

  function checkSyntax(src, langOrFile) {
    var lx = lex(src, langOrFile);
    var errors = lx.errors.slice(0), stack = [];
    var pairs = { "(": ")", "{": "}", "[": "]" };
    for (var i = 0; i < lx.tokens.length; i++) {
      var t = lx.tokens[i];
      if (t.type !== "punct") continue;
      if (t.val === "(" || t.val === "{" || t.val === "[") {
        stack.push(t);
      } else if (t.val === ")" || t.val === "}" || t.val === "]") {
        if (!stack.length || pairs[stack[stack.length - 1].val] !== t.val) {
          errors.push({ line: t.line, code: "BAD_BRACKET", msg: "Unexpected '" + t.val + "' on line " + t.line });
        } else {
          stack.pop();
        }
      }
    }
    for (var k = 0; k < stack.length; k++) {
      errors.push({ line: stack[k].line, code: "UNCLOSED_BRACKET", msg: "Unclosed '" + stack[k].val + "' on line " + stack[k].line });
    }
    return { ok: errors.length === 0, lang: lx.lang, errors: errors };
  }

  /* =========================================================================
     3. UNIVERSAL 4-FAMILY CODE CHUNKER + POLYGLOT REPO MAP
     ========================================================================= */
  function leadingIndent(ln) {
    var n = 0;
    while (n < ln.length && (ln.charAt(n) === " " || ln.charAt(n) === "\t")) n += (ln.charAt(n) === "\t" ? 4 : 1);
    return n;
  }

  function chunkByDefinitions(src, fileName, langOverride) {
    var pk = getPack(langOverride || fileName);
    var lines = String(src || "").split(/\r?\n/);
    var chunks = [], sigs = [], i = 0;

    while (i < lines.length) {
      var m = lines[i].match(pk.defRegex);
      if (!m) { i++; continue; }
      var sym = m[1], params = (m[2] || "").trim(), startLine = i + 1;
      var body = [];

      if (pk.blockStyle === "braces") {
        var depth = 0, opened = false;
        while (i < lines.length) {
          var ln = lines[i]; body.push(ln);
          for (var c = 0; c < ln.length; c++) {
            if (ln.charAt(c) === "{") { depth++; opened = true; }
            else if (ln.charAt(c) === "}") depth--;
          }
          i++;
          if (opened && depth <= 0) break;
        }
      } else if (pk.blockStyle === "indent") {
        var baseInd = leadingIndent(lines[i]);
        body.push(lines[i]); i++;
        while (i < lines.length) {
          var tLn = lines[i].trim();
          if (tLn === "" || (pk.lineComment && tLn.indexOf(pk.lineComment) === 0)) { body.push(lines[i]); i++; continue; }
          if (leadingIndent(lines[i]) > baseInd) { body.push(lines[i]); i++; }
          else break;
        }
        while (body.length > 1 && body[body.length - 1].trim() === "") body.pop();
      } else if (pk.blockStyle === "end_keyword") {
        var endInd = leadingIndent(lines[i]);
        body.push(lines[i]); i++;
        while (i < lines.length) {
          body.push(lines[i]);
          var hitEnd = pk.endRegex && pk.endRegex.test(lines[i]) && leadingIndent(lines[i]) <= endInd;
          i++;
          if (hitEnd) break;
        }
      } else {
        /* label style (Assembly) */
        body.push(lines[i]); i++;
        while (i < lines.length && !pk.defRegex.test(lines[i])) {
          body.push(lines[i]); i++;
        }
        while (body.length > 1 && body[body.length - 1].trim() === "") body.pop();
      }

      var sig = pk.blockStyle === "label" ? (sym + ":") : (sym + "(" + params + ")");
      sigs.push(sig);
      chunks.push({
        id: fileName + ":" + sym, file: fileName, lang: pk.id,
        symbol: sym, signature: sig, startLine: startLine, endLine: startLine + body.length - 1,
        text: body.join("\n")
      });
    }

    return {
      file: fileName, lang: pk.id, chunks: chunks,
      repoMapLine: fileName + " [" + pk.id + "]: " + (sigs.length ? sigs.join(", ") : "(script)")
    };
  }

  /* =========================================================================
     4. POLYGLOT CALL GRAPH, TOKEN-SAFE RENAME & SYNTAX-GUARDED PATCHER
     ========================================================================= */
  function buildCallGraph(filesMap) {
    var defs = Object.create(null), calls = Object.create(null), calledBy = Object.create(null);
    var fName, i, ch;
    for (fName in filesMap) {
      var res = chunkByDefinitions(filesMap[fName], fName);
      for (i = 0; i < res.chunks.length; i++) {
        ch = res.chunks[i];
        defs[ch.symbol] = ch;
        calls[ch.symbol] = [];
        if (!calledBy[ch.symbol]) calledBy[ch.symbol] = [];
      }
    }
    for (var sym in defs) {
      var lx = lex(defs[sym].text, defs[sym].lang);
      var toks = lx.tokens, seen = Object.create(null);
      for (i = 0; i < toks.length; i++) {
        var t = toks[i], nxt = toks[i + 1];
        var isCall = t.type === "ident" && defs[t.val] && t.val !== sym &&
                     ((nxt && nxt.val === "(") || defs[sym].lang === "basic" || defs[sym].lang === "asm6502");
        if (isCall && !seen[t.val]) {
          seen[t.val] = 1;
          calls[sym].push(t.val);
          if (!calledBy[t.val]) calledBy[t.val] = [];
          calledBy[t.val].push(sym);
        }
      }
    }
    return {
      defs: defs, calls: calls, calledBy: calledBy,
      impactOf: function (targetSym) {
        var visited = Object.create(null), q = [targetSym], affectedTests = [];
        visited[targetSym] = 1;
        while (q.length) {
          var cur = q.shift();
          var pk = defs[cur] ? getPack(defs[cur].lang) : packs.javascript;
          if (pk.testRegex.test(cur)) affectedTests.push(cur);
          var up = calledBy[cur] || [];
          for (var j = 0; j < up.length; j++) if (!visited[up[j]]) { visited[up[j]] = 1; q.push(up[j]); }
        }
        return { callers: (calledBy[targetSym] || []).slice(0), callees: (calls[targetSym] || []).slice(0), affectedTests: affectedTests };
      }
    };
  }

  function safeRename(src, oldName, newName, langOrFile) {
    if (!oldName || !newName || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName)) {
      return { ok: false, error: "Invalid identifier." };
    }
    var lx = lex(src, langOrFile), toks = lx.tokens, edits = [];
    for (var i = 0; i < toks.length; i++) {
      var prev = i > 0 ? toks[i - 1] : null;
      if (toks[i].type === "ident" && toks[i].val === oldName && !(prev && prev.val === ".")) {
        edits.push(toks[i]);
      }
    }
    var out = src;
    for (var j = edits.length - 1; j >= 0; j--) {
      out = out.slice(0, edits[j].start) + newName + out.slice(edits[j].end);
    }
    return { ok: true, lang: lx.lang, code: out, replacements: edits.length };
  }

  function applySafePatch(src, searchBlock, replaceBlock, langOrFile) {
    var idx = String(src || "").indexOf(searchBlock);
    if (idx < 0) return { ok: false, error: "Search block not found.", code: src };
    if (src.indexOf(searchBlock, idx + 1) >= 0) return { ok: false, error: "Ambiguous search block.", code: src };
    var patched = src.slice(0, idx) + replaceBlock + src.slice(idx + searchBlock.length);
    var beforeErr = checkSyntax(src, langOrFile).errors.length;
    var after = checkSyntax(patched, langOrFile);
    if (after.errors.length > beforeErr) {
      return { ok: false, rolledBack: true, error: "Rolled back (" + after.lang + "): " + after.errors[0].msg, code: src };
    }
    return { ok: true, rolledBack: false, lang: after.lang, code: patched };
  }

  root.EvelynLangCore = {
    registerLanguage: registerLanguage,
    getPack: getPack,
    listLanguages: function () { var out = []; for (var k in packs) out.push(k); return out; },
    lex: lex,
    checkSyntax: checkSyntax,
    chunkByDefinitions: chunkByDefinitions,
    buildCallGraph: buildCallGraph,
    safeRename: safeRename,
    applySafePatch: applySafePatch
  };
})(typeof window !== "undefined" ? window : global);
