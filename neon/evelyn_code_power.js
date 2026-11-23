/* evelyn_code_power.js - Four Deterministic Coding Multipliers for Evelyn:
   1. PatchApplier    (Search/Replace hunks + whitespace-tolerant match + AST rollback)
   2. CallGraphSlicer (Multi-file caller/callee graph + affected-test selector)
   3. PropTester      (Seeded QuickCheck property fuzzer + minimal counterexample shrinker)
   4. MiniTypeChecker & TraceRecorder (ES5 type-tag lint + time-travel anomaly finder)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    if (!root.EvelynBackend) require("./evelyn_backend.js");
    if (!root.EvelynAST) require("./evelyn_ast_ide.js");
    if (!root.EvelynHybridRAG) require("./evelyn_hybrid_rag.js");
  }

  var B = root.EvelynBackend;
  var AST = root.EvelynAST;
  var RAG = root.EvelynHybridRAG;

  /* =========================================================================
     1. SEARCH-AND-REPLACE HUNK PATCHER WITH AUTOMATIC AST ROLLBACK
     ========================================================================= */
  var PatchApplier = {
    apply: function (src, searchBlock, replaceBlock, opts) {
      opts = opts || {};
      var text = String(src || ""), needle = String(searchBlock || ""), rep = String(replaceBlock || "");
      if (!needle) return { ok: false, error: "Empty search block.", code: text };

      var patched = null, matchMode = "exact";
      var first = text.indexOf(needle);
      if (first >= 0) {
        if (text.indexOf(needle, first + 1) >= 0) {
          return { ok: false, error: "Ambiguous search block (matches multiple places).", code: text };
        }
        patched = text.slice(0, first) + rep + text.slice(first + needle.length);
      } else {
        /* Whitespace-tolerant line match fallback */
        var srcLines = text.split(/\r?\n/);
        var nLines = needle.split(/\r?\n/);
        var matches = [];
        for (var i = 0; i <= srcLines.length - nLines.length; i++) {
          var allOk = true;
          for (var j = 0; j < nLines.length; j++) {
            if (srcLines[i + j].trim() !== nLines[j].trim()) { allOk = false; break; }
          }
          if (allOk) matches.push(i);
        }
        if (matches.length === 0) return { ok: false, error: "Search block not found in file.", code: text };
        if (matches.length > 1) return { ok: false, error: "Ambiguous trimmed match.", code: text };
        matchMode = "trimmed";
        var at = matches[0];
        var outLines = srcLines.slice(0, at).concat(rep.split(/\r?\n/), srcLines.slice(at + nLines.length));
        patched = outLines.join("\n");
      }

      /* Automatic syntax-regression rollback using EvelynAST */
      if (opts.verifySyntax !== false && AST) {
        var beforeErrs = AST.analyze(text).errors.length;
        var afterRep = AST.analyze(patched);
        if (afterRep.errors.length > beforeErrs) {
          return {
            ok: false,
            rolledBack: true,
            error: "Patch rolled back: introduced syntax error (" + afterRep.errors[0].msg + ").",
            code: text
          };
        }
      }
      return { ok: true, rolledBack: false, matchMode: matchMode, code: patched };
    }
  };

  /* =========================================================================
     2. STATIC CALL-GRAPH IMPACT SLICER (FINDS CALLERS, CALLEES & AFFECTED TESTS)
     ========================================================================= */
  function CallGraph() {
    this.defs = Object.create(null);     // fnName -> { id, file, text }
    this.calls = Object.create(null);    // fnName -> [calleeNames]
    this.calledBy = Object.create(null); // fnName -> [callerNames]
  }

  CallGraph.prototype.indexFiles = function (filesMap) {
    this.defs = Object.create(null);
    this.calls = Object.create(null);
    this.calledBy = Object.create(null);

    /* Pass 1: collect all function definitions across files */
    var fName, i, ch;
    for (fName in filesMap) {
      var parsed = RAG.chunkCodeByFunctions(filesMap[fName], fName);
      for (i = 0; i < parsed.chunks.length; i++) {
        ch = parsed.chunks[i];
        this.defs[ch.symbol] = ch;
        this.calls[ch.symbol] = [];
        if (!this.calledBy[ch.symbol]) this.calledBy[ch.symbol] = [];
      }
    }

    /* Pass 2: link caller -> callee edges via AST tokens */
    for (var sym in this.defs) {
      var toks = AST.lexJS(this.defs[sym].text).tokens;
      var seen = Object.create(null);
      for (i = 0; i < toks.length - 1; i++) {
        var t = toks[i], nxt = toks[i + 1], prev = i > 0 ? toks[i - 1] : null;
        if (t.type === "ident" && nxt.val === "(" && !(prev && prev.val === "function")) {
          if (this.defs[t.val] && t.val !== sym && !seen[t.val]) {
            seen[t.val] = 1;
            this.calls[sym].push(t.val);
            if (!this.calledBy[t.val]) this.calledBy[t.val] = [];
            this.calledBy[t.val].push(sym);
          }
        }
      }
    }
  };

  /* Compute 1-hop context slice + all transitive test_* functions affected by changing `sym` */
  CallGraph.prototype.getImpactSlice = function (sym) {
    var callers = (this.calledBy[sym] || []).slice(0);
    var callees = (this.calls[sym] || []).slice(0);
    var affectedTests = [];
    var visited = Object.create(null), queue = [sym];
    visited[sym] = 1;

    while (queue.length > 0) {
      var cur = queue.shift();
      if (/^test_|Test$/.test(cur)) affectedTests.push(cur);
      var up = this.calledBy[cur] || [];
      for (var i = 0; i < up.length; i++) {
        if (!visited[up[i]]) { visited[up[i]] = 1; queue.push(up[i]); }
      }
    }
    return { symbol: sym, callers: callers, callees: callees, affectedTests: affectedTests };
  };

  /* =========================================================================
     3. QUICKCHECK-STYLE PROPERTY TESTER WITH AUTOMATIC COUNTEREXAMPLE SHRINKING
     ========================================================================= */
  var PropTester = {
    checkArrayProperty: function (propFn, opts) {
      opts = opts || {};
      var trials = opts.trials || 80;
      var rng = B.createRng(opts.seed || 2026);
      var edgeCases = [[], [0], [1], [-1], [2, 1], [1, 1, 1], [5, -5, 0, 5]];
      var failing = null, trialNum = 0, i, k;

      for (i = 0; i < edgeCases.length + trials; i++) {
        trialNum = i + 1;
        var sample;
        if (i < edgeCases.length) {
          sample = edgeCases[i].slice(0);
        } else {
          var len = Math.floor(rng() * 14);
          sample = [];
          for (k = 0; k < len; k++) sample.push(Math.floor(rng() * 41) - 20);
        }
        var ok = false;
        try { ok = !!propFn(sample.slice(0)); } catch (e) { ok = false; }
        if (!ok) { failing = sample; break; }
      }

      if (!failing) return { ok: true, trialsRun: trialNum };

      /* Automatic Delta Shrinking: reduce failing array to minimal counterexample */
      var cur = failing.slice(0), shrinkSteps = 0, improved = true;
      while (improved && shrinkSteps < 100) {
        improved = false;
        /* Try removing one element at a time */
        for (i = 0; i < cur.length; i++) {
          var cand = cur.slice(0, i).concat(cur.slice(i + 1));
          var stillFails = false;
          try { stillFails = !propFn(cand.slice(0)); } catch (e) { stillFails = true; }
          if (stillFails) { cur = cand; shrinkSteps++; improved = true; break; }
        }
        if (improved) continue;
        /* Try shrinking magnitudes toward 0 */
        for (i = 0; i < cur.length; i++) {
          if (cur[i] === 0) continue;
          var halved = cur.slice(0);
          halved[i] = cur[i] > 0 ? Math.floor(cur[i] / 2) : Math.ceil(cur[i] / 2);
          if (halved[i] === cur[i]) halved[i] = 0;
          var failsHalf = false;
          try { failsHalf = !propFn(halved.slice(0)); } catch (e) { failsHalf = true; }
          if (failsHalf) { cur = halved; shrinkSteps++; improved = true; break; }
        }
      }

      return {
        ok: false,
        failedAtTrial: trialNum,
        rawFailure: failing,
        shrunkFailure: cur,
        shrinkSteps: shrinkSteps
      };
    }
  };

  /* =========================================================================
     4. MINI ES5 TYPE-TAG CHECKER + TIME-TRAVEL VARIABLE TRACER
     ========================================================================= */
  var ARRAY_ONLY = { push:1, pop:1, shift:1, unshift:1, splice:1, join:1 };
  var STRING_ONLY = { toUpperCase:1, toLowerCase:1, charAt:1, trim:1, split:1 };

  var MiniTypeChecker = {
    check: function (src) {
      var toks = AST.lexJS(src).tokens;
      var types = Object.create(null); // varName -> "number"|"string"|"boolean"|"array"|"object"
      var issues = [];

      function inferLiteral(t) {
        if (!t) return "unknown";
        if (t.type === "number") return "number";
        if (t.type === "string") return "string";
        if (t.val === "true" || t.val === "false") return "boolean";
        if (t.val === "[") return "array";
        if (t.val === "{") return "object";
        if (t.type === "ident" && types[t.val]) return types[t.val];
        return "unknown";
      }

      for (var i = 0; i < toks.length; i++) {
        var t = toks[i], n1 = toks[i + 1], n2 = toks[i + 2], n3 = toks[i + 3];
        if (t.val === "var" && n1 && n1.type === "ident" && n2 && n2.val === "=") {
          types[n1.val] = inferLiteral(n3);
        }
        /* Check invalid method calls: x.push() on non-array, n.toUpperCase() on number */
        if (t.type === "ident" && types[t.val] && n1 && n1.val === "." && n2 && n2.type === "ident") {
          var ty = types[t.val];
          if (ARRAY_ONLY[n2.val] && ty !== "array") {
            issues.push({ line: t.line, code: "TYPE_METHOD", msg: "Cannot call array method ." + n2.val + "() on " + ty + " '" + t.val + "'." });
          }
          if (STRING_ONLY[n2.val] && ty !== "string") {
            issues.push({ line: t.line, code: "TYPE_METHOD", msg: "Cannot call string method ." + n2.val + "() on " + ty + " '" + t.val + "'." });
          }
        }
        /* Flag mixed string + number implicit coercion ("5" + 3 -> "53") */
        if (n1 && n1.val === "+" && n2) {
          var lTy = inferLiteral(t), rTy = inferLiteral(n2);
          if ((lTy === "string" && rTy === "number") || (lTy === "number" && rTy === "string")) {
            issues.push({ line: n1.line, code: "MIXED_ADD", msg: "Mixed string + number addition on line " + n1.line + " converts number to text." });
          }
        }
      }
      return { ok: issues.length === 0, types: types, issues: issues };
    }
  };

  function TraceRecorder(capacity) {
    this.cap = capacity || 200;
    this.events = [];
    this.lastVals = Object.create(null);
    this.stepNo = 0;
  }
  TraceRecorder.prototype.record = function (varName, newVal) {
    this.stepNo++;
    var oldVal = this.lastVals[varName];
    this.lastVals[varName] = newVal;
    this.events.push({ step: this.stepNo, name: varName, oldVal: oldVal, newVal: newVal });
    if (this.events.length > this.cap) this.events.shift();
  };
  TraceRecorder.prototype.findFirstAnomaly = function (predicateFn) {
    var fn = predicateFn || function (ev) { return typeof ev.newVal === "number" && !isFinite(ev.newVal); };
    for (var i = 0; i < this.events.length; i++) {
      if (fn(this.events[i])) return this.events[i];
    }
    return null;
  };

  root.EvelynCodePower = {
    PatchApplier: PatchApplier,
    CallGraph: CallGraph,
    PropTester: PropTester,
    MiniTypeChecker: MiniTypeChecker,
    TraceRecorder: TraceRecorder
  };
})(typeof window !== "undefined" ? window : global);
