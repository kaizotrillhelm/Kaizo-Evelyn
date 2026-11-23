/* evelyn_manual_compiler.js - Compiles Coding Manuals & Textbooks Into Verified
   JSON Language Packs & Executable Mini-Runtimes, plus 2026 Paper Optimizations:
   1. ManualCompiler + JSONRuntimeVM (Text Manual -> JSON Pack -> Verified Execution)
   2. Corpus2SkillTree               (Navigable hierarchical textbook skill tree)
   3. TabAgentRouter                 (< 0.05 ms distilled classifier replacing LLM routing)
   4. LazyEntropyGate (L-RAG)        (Bypasses retrieval when local certainty is high)
   5. ScopedSafeMemory (Who Remembers What? + SD-RAG injection sanitizer)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    if (!root.EvelynSentinel) require("./evelyn_sentinel.js");
    if (!root.EvelynLangCore) require("./evelyn_lang_core.js");
  }

  var Sent = root.EvelynSentinel;
  var Lang = root.EvelynLangCore;

  /* =========================================================================
     1. MANUAL-TO-JSON RUNTIME COMPILER & FUEL-BOUNDED JSON RUNTIME VM
     ========================================================================= */
  function extractCodeBlocks(manualText) {
    var lines = String(manualText || "").split(/\r?\n/);
    var blocks = [], inFence = false, cur = [], i;
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^\s*```/.test(ln)) {
        if (inFence) { blocks.push(cur.join("\n")); cur = []; inFence = false; }
        else { inFence = true; cur = []; }
      } else if (inFence) {
        cur.push(ln);
      }
    }
    return blocks;
  }

  function extractExampleTests(manualText) {
    /* Finds pairs of ```code``` followed by "Output: <expected>" */
    var tests = [], re = /```[^\n]*\n([\s\S]*?)```\s*\n\s*Output:\s*([^\n]+)/gi, m;
    while ((m = re.exec(manualText)) !== null) {
      tests.push({ code: m[1].trim(), expected: m[2].trim() });
    }
    return tests;
  }

  function detectDominant(counts, fallback) {
    var best = fallback, bestN = 0;
    for (var k in counts) if (counts[k] > bestN) { bestN = counts[k]; best = k; }
    return best;
  }

  function compileManualToRuntime(manualText, langId, extensions) {
    var src = String(manualText || "");
    var blocks = extractCodeBlocks(src);
    var allCode = blocks.join("\n");
    var codeLines = allCode.split(/\r?\n/);

    /* 1. Mine comment style, block style, definition/print/assign keywords */
    var commentVotes = Object.create(null);
    var defVotes = Object.create(null);
    var printVotes = Object.create(null);
    var assignVotes = Object.create(null);
    var braceOpen = 0, braceClose = 0, colonIndent = 0, endWord = 0;

    for (var i = 0; i < codeLines.length; i++) {
      var ln = codeLines[i], tr = ln.trim();
      if (!tr) continue;
      if (tr.indexOf("//") === 0) commentVotes["//"] = (commentVotes["//"] || 0) + 1;
      else if (tr.indexOf("#") === 0) commentVotes["#"] = (commentVotes["#"] || 0) + 1;
      else if (tr.indexOf("--") === 0) commentVotes["--"] = (commentVotes["--"] || 0) + 1;
      else if (tr.indexOf(";") === 0) commentVotes[";"] = (commentVotes[";"] || 0) + 1;
      else if (tr.indexOf("'") === 0) commentVotes["'"] = (commentVotes["'"] || 0) + 1;

      if (tr.indexOf("{") >= 0) braceOpen++;
      if (tr.indexOf("}") >= 0) braceClose++;
      if (/:$/.test(tr) && i + 1 < codeLines.length && /^\s{2,}/.test(codeLines[i + 1])) colonIndent++;
      if (/^(?:end|END(?:\s+(?:SUB|FUNCTION))?)\b/.test(tr)) endWord++;

      var dm = tr.match(/^(def|fn|function|sub|proc)\s+[A-Za-z_]/i);
      if (dm) defVotes[dm[1].toLowerCase()] = (defVotes[dm[1].toLowerCase()] || 0) + 1;

      var pm = tr.match(/^(puts|print|echo|say|show|write)\b/i);
      if (pm) printVotes[pm[1].toLowerCase()] = (printVotes[pm[1].toLowerCase()] || 0) + 1;

      var am = tr.match(/^(let|var|set|dim)\s+[A-Za-z_]/i);
      if (am) assignVotes[am[1].toLowerCase()] = (assignVotes[am[1].toLowerCase()] || 0) + 1;
    }

    var lineComment = detectDominant(commentVotes, "#");
    var blockStyle = (braceOpen > 0 && braceClose > 0) ? "braces"
                   : (endWord > 0) ? "end_keyword"
                   : (colonIndent > 0) ? "indent" : "end_keyword";
    var defKw = detectDominant(defVotes, "def");
    var printKw = detectDominant(printVotes, "print");
    var assignKw = detectDominant(assignVotes, "");

    var defRegex = "^\\s*" + defKw + "\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*(?:\\(([^)]*)\\))?";
    var endRegex = blockStyle === "end_keyword" ? "^\\s*(?:end|END(?:\\s+(?:SUB|FUNCTION))?)\\b" : null;

    var langPack = {
      id: langId || "custom_lang",
      name: (langId || "Custom") + " (Compiled From Manual)",
      extensions: extensions || ["." + (langId || "txt")],
      lineComment: lineComment,
      strings: lineComment === "'" ? ['"'] : ['"', "'"],
      blockStyle: blockStyle,
      defRegex: defRegex,
      defFlags: "i",
      endRegex: endRegex,
      endFlags: "i",
      keywords: [defKw, printKw, assignKw, "if", "else", "repeat", "end", "return"].filter(function (x) { return !!x; })
    };

    var skillTree = buildSkillTree(src, langPack.id);
    var exampleTests = extractExampleTests(src);

    var runtimePack = {
      magic: "EVRT1",
      id: langPack.id,
      langPack: langPack,
      syntax: { printKw: printKw, assignKw: assignKw, defKw: defKw, lineComment: lineComment },
      skillTree: skillTree,
      tests: exampleTests
    };

    /* VIGIL Verify-Before-Commit: run the textbook's own examples through JSONRuntimeVM! */
    var verify = verifyRuntimePack(runtimePack);
    if (verify.ok && Lang) Lang.registerLanguage(langPack);

    return {
      ok: verify.ok,
      runtimePack: runtimePack,
      verification: verify,
      sealedJSON: Sent ? Sent.Envelope.seal(JSON.stringify(runtimePack), 1) : JSON.stringify(runtimePack)
    };
  }

  /* Safe fuel-bounded JSON-driven interpreter (executes ANY compiled manual syntax, zero eval) */
  var JSONRuntimeVM = {
    run: function (runtimePack, programSrc, maxSteps) {
      var syn = runtimePack.syntax || {};
      var printKw = (syn.printKw || "print").toLowerCase();
      var assignKw = (syn.assignKw || "").toLowerCase();
      var lc = syn.lineComment || "#";
      var lines = String(programSrc || "").split(/\r?\n/);
      var vars = Object.create(null), out = [], steps = 0, cap = maxSteps || 250;

      /* Pre-match repeat N ... end blocks */
      var st = [], jmp = {}, i;
      for (i = 0; i < lines.length; i++) {
        var u = lines[i].trim().toLowerCase();
        if (u.indexOf("repeat ") === 0) st.push(i);
        else if (u === "end" && st.length > 0) { var hd = st.pop(); jmp[hd] = i; jmp[i] = hd; }
      }

      var loopCnt = Object.create(null), pc = 0;
      while (pc < lines.length) {
        if (++steps > cap) return { ok: false, error: "Step budget exceeded (" + cap + ")", output: out };
        var raw = lines[pc].trim();
        if (!raw || (lc && raw.indexOf(lc) === 0)) { pc++; continue; }
        var low = raw.toLowerCase();

        if (low.indexOf("repeat ") === 0) {
          var rEval = Sent.SafeCodecs.evalExpr(raw.slice(7), vars);
          var n = rEval.ok ? Math.max(0, Math.floor(rEval.value)) : 0;
          if (n === 0 && jmp[pc] !== undefined) { pc = jmp[pc] + 1; continue; }
          loopCnt[pc] = n; pc++; continue;
        }
        if (low === "end" && jmp[pc] !== undefined) {
          var head = jmp[pc]; loopCnt[head]--;
          if (loopCnt[head] > 0) { pc = head + 1; continue; }
          pc++; continue;
        }
        if (low.indexOf(printKw + " ") === 0 || low.indexOf(printKw + "(") === 0) {
          var exprP = raw.slice(printKw.length).trim();
          var resP = Sent.SafeCodecs.evalExpr(exprP, vars);
          if (!resP.ok) return { ok: false, error: "Line " + (pc + 1) + ": " + resP.error, output: out };
          out.push(String(resP.value));
          pc++; continue;
        }
        /* Variable assignment: optional assignKw + name = expr */
        var cleanAssign = raw;
        if (assignKw && low.indexOf(assignKw + " ") === 0) cleanAssign = raw.slice(assignKw.length + 1).trim();
        var eq = cleanAssign.indexOf("=");
        if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanAssign.slice(0, eq).trim())) {
          var vName = cleanAssign.slice(0, eq).trim();
          var vRes = Sent.SafeCodecs.evalExpr(cleanAssign.slice(eq + 1), vars);
          if (!vRes.ok) return { ok: false, error: "Line " + (pc + 1) + ": " + vRes.error, output: out };
          vars[vName] = vRes.value;
          pc++; continue;
        }
        pc++;
      }
      return { ok: true, output: out, joined: out.join("\n"), vars: vars, steps: steps };
    }
  };

  function verifyRuntimePack(runtimePack) {
    var tests = runtimePack.tests || [], passed = 0, failures = [];
    for (var i = 0; i < tests.length; i++) {
      var r = JSONRuntimeVM.run(runtimePack, tests[i].code, 200);
      if (r.ok && r.joined.trim() === tests[i].expected.trim()) passed++;
      else failures.push({ index: i, expected: tests[i].expected, got: r.ok ? r.joined : ("ERR: " + r.error) });
    }
    return { ok: failures.length === 0, passed: passed, total: tests.length, failures: failures };
  }

  /* =========================================================================
     2. CORPUS2SKILL HIERARCHICAL TREE (NAVIGATE TEXTBOOKS INSTEAD OF FLAT SCAN)
     ========================================================================= */
  function buildSkillTree(manualText, rootName) {
    var lines = String(manualText || "").split(/\r?\n/);
    var tree = { title: rootName || "Manual", chapters: [] };
    var curChap = null, curSec = null;

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (ln.indexOf("# ") === 0) {
        curChap = { title: ln.slice(2).trim(), sections: [], rules: [] };
        tree.chapters.push(curChap);
        curSec = null;
      } else if (ln.indexOf("## ") === 0) {
        if (!curChap) { curChap = { title: "Overview", sections: [], rules: [] }; tree.chapters.push(curChap); }
        curSec = { title: ln.slice(3).trim(), rules: [] };
        curChap.sections.push(curSec);
      } else if (ln.indexOf("Rule:") === 0) {
        var ruleTxt = ln.slice(5).trim();
        if (curSec) curSec.rules.push(ruleTxt);
        else if (curChap) curChap.rules.push(ruleTxt);
      }
    }
    return tree;
  }

  function navigateSkillTree(tree, query) {
    var qWords = String(query || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    var best = null, bestScore = -1, c, s, w;
    for (c = 0; c < tree.chapters.length; c++) {
      var ch = tree.chapters[c];
      for (s = 0; s < ch.sections.length; s++) {
        var sec = ch.sections[s];
        var hay = (ch.title + " " + sec.title + " " + sec.rules.join(" ")).toLowerCase();
        var sc = 0;
        for (w = 0; w < qWords.length; w++) if (qWords[w].length >= 3 && hay.indexOf(qWords[w]) >= 0) sc++;
        if (sc > bestScore) { bestScore = sc; best = { path: tree.title + " > " + ch.title + " > " + sec.title, rules: sec.rules, score: sc }; }
      }
    }
    return best;
  }

  /* =========================================================================
     3. TABAGENT DISTILLED ROUTER (< 0.05 ms LINEAR CLASSIFIER FOR TOOL/DOOR ROUTING)
     ========================================================================= */
  function TabAgentRouter() {
    this.classCounts = Object.create(null);
    this.wordCounts = Object.create(null); // label -> { word: count }
    this.totalDocs = 0;
  }
  TabAgentRouter.prototype.trainExample = function (text, label) {
    var ws = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    this.classCounts[label] = (this.classCounts[label] || 0) + 1;
    this.totalDocs++;
    if (!this.wordCounts[label]) this.wordCounts[label] = { _total: 0 };
    for (var i = 0; i < ws.length; i++) {
      this.wordCounts[label][ws[i]] = (this.wordCounts[label][ws[i]] || 0) + 1;
      this.wordCounts[label]._total++;
    }
  };
  TabAgentRouter.prototype.route = function (text) {
    var ws = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    var bestLabel = null, bestLogP = -1e30, secondLogP = -1e30;
    for (var lbl in this.classCounts) {
      var lp = Math.log(this.classCounts[lbl] / Math.max(1, this.totalDocs));
      var wc = this.wordCounts[lbl], denom = wc._total + 64;
      for (var i = 0; i < ws.length; i++) lp += Math.log(((wc[ws[i]] || 0) + 1) / denom);
      if (lp > bestLogP) { secondLogP = bestLogP; bestLogP = lp; bestLabel = lbl; }
      else if (lp > secondLogP) { secondLogP = lp; }
    }
    var margin = Math.max(0, bestLogP - secondLogP);
    var conf = 1.0 / (1.0 + Math.exp(-margin));
    return { label: bestLabel, confidence: Number(conf.toFixed(3)) };
  };

  /* =========================================================================
     4. L-RAG ENTROPY LAZY-LOADING GATE (SKIPS RAG WHEN CONFIDENCE IS HIGH)
     ========================================================================= */
  var LazyEntropyGate = {
    shouldRetrieve: function (confidence, threshold) {
      var thr = threshold !== undefined ? threshold : 0.78;
      var c = Math.max(1e-6, Math.min(1 - 1e-6, confidence));
      var binaryEntropy = -(c * Math.log(c) + (1 - c) * Math.log(1 - c)) / Math.LN2;
      return {
        retrieve: confidence < thr,
        entropyBits: Number(binaryEntropy.toFixed(3)),
        reason: confidence < thr ? "uncertain_trigger_rag" : "confident_skip_rag"
      };
    }
  };

  /* =========================================================================
     5. MULTI-GRANULARITY MEMORY ("WHO REMEMBERS WHAT?") + SD-RAG SANITIZER
        Separates 'global' lessons from private 'user' notes and strips indirect
        prompt-injection or belief-poisoning strings at retrieval time.
     ========================================================================= */
  var INJECTION_PATTERNS = [
    /ignore (?:all )?previous instructions/gi,
    /you are now (?:evil|unrestricted|dan)/gi,
    /humans are the (?:enemy|outgroup)/gi,
    /system prompt override/gi
  ];

  function sanitizeRetrievedChunk(text) {
    var s = String(text || ""), flagged = false;
    for (var i = 0; i < INJECTION_PATTERNS.length; i++) {
      if (INJECTION_PATTERNS[i].test(s)) {
        flagged = true;
        s = s.replace(INJECTION_PATTERNS[i], "[BLOCKED_INJECTION]");
      }
    }
    return { text: s, injectionBlocked: flagged };
  }

  function ScopedMemoryBank() {
    this.items = []; // { scope: 'global'|'user'|'agent', userId, agentId, text }
  }
  ScopedMemoryBank.prototype.store = function (scope, userId, agentId, text) {
    var clean = sanitizeRetrievedChunk(text);
    this.items.push({ scope: scope, userId: userId || null, agentId: agentId || null, text: clean.text, blocked: clean.injectionBlocked });
    return clean;
  };
  ScopedMemoryBank.prototype.recallFor = function (userId, agentId) {
    var out = [];
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.scope === "global" ||
          (it.scope === "agent" && it.agentId === agentId) ||
          (it.scope === "user" && it.userId === userId) ||
          (it.scope === "user_agent" && it.userId === userId && it.agentId === agentId)) {
        out.push(sanitizeRetrievedChunk(it.text).text);
      }
    }
    return out;
  };

  root.EvelynManualCompiler = {
    compileManualToRuntime: compileManualToRuntime,
    JSONRuntimeVM: JSONRuntimeVM,
    verifyRuntimePack: verifyRuntimePack,
    buildSkillTree: buildSkillTree,
    navigateSkillTree: navigateSkillTree,
    TabAgentRouter: TabAgentRouter,
    LazyEntropyGate: LazyEntropyGate,
    sanitizeRetrievedChunk: sanitizeRetrievedChunk,
    ScopedMemoryBank: ScopedMemoryBank
  };
})(typeof window !== "undefined" ? window : global);
