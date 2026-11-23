/* evelyn_skills.js - Claude-Code-style modular Skills backed by full-text BM25 CRC32 shelves.
   Plain ES5, zero dependencies. Works in Node or in a browser.

   Progressive disclosure:
     Level 1 (always in memory, 0 prompt tokens): name, triggers, effort hints
     Level 2 (on activation): compact invariants and the matched verifier commands
     Level 3 (on demand): the top-K full-text BM25 cards from the skill's CRC32-verified shelf store

   The skill store answers the same calls as EvelynStream.OffsetShelfStore (searchFull, searchScored), so it can be
   handed straight to EvelynCodeLoop as its store. It also parses simple SKILL.md files (--- key: value frontmatter,
   ## Section cards). No warranty: see the disclaimer in README.md. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var S = isNode ? require("./evelyn_stream.js") : root.EvelynStream;

  var STOP = Object.create(null);
  ("a an the is are was were be been of in on to for and or with that this it as at by from into not no what how when where can")
    .split(" ").forEach(function (w) { STOP[w] = 1; });

  /* Splits camelCase and snake_case and keeps the original identifier too */
  function tokenizeCodeText(text) {
    var raw = String(text || "");
    var split = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-\/.:]+/g, " ");
    var tokens = (raw + " " + split).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
    var out = [], i, w;
    for (i = 0; i < tokens.length; i++) {
      w = tokens[i];
      if (STOP[w]) continue;
      out.push(w);
      if (w.length > 5 && /(ing|tion|ment)$/.test(w)) out.push(w.slice(0, -3));
      else if (w.length > 4 && /es$/.test(w)) out.push(w.slice(0, -2));
      else if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) out.push(w.slice(0, -1));
    }
    return out;
  }

  /* ======================================================================
     1. FULL-TEXT BM25 CRC32 SHELF STORE (indexes the whole text)
     ====================================================================== */
  function SkillShelfStore() {
    this.entries = [];
    this.inv = Object.create(null);
    this.blob = new Uint8Array(0);
    this.avgDocLen = 1;
  }

  SkillShelfStore.prototype.buildFromRecords = function (records) {
    var chunks = [], totalBytes = 0, totalTokens = 0, i, j, w;
    this.entries = [];
    this.inv = Object.create(null);

    for (i = 0; i < records.length; i++) {
      var r = records[i], txt = String(r.fullText || ""), bytes = new Uint8Array(txt.length);
      for (j = 0; j < txt.length; j++) bytes[j] = txt.charCodeAt(j) & 0x7F;
      var id = this.entries.length;
      var crc = S ? S.crc32(bytes, 0, bytes.length) : 0;

      var topicToks = tokenizeCodeText(r.topic || "");
      var bodyToks = tokenizeCodeText(txt);
      var docLen = topicToks.length + bodyToks.length;
      totalTokens += docLen;

      this.entries.push({
        id: id, shelf: r.shelf || "skill", topic: r.topic || "note",
        offset: totalBytes, length: bytes.length, crc32: crc, docLen: docLen || 1
      });
      chunks.push(bytes);
      totalBytes += bytes.length;

      var tfMap = Object.create(null), inTopic = Object.create(null);
      for (j = 0; j < topicToks.length; j++) {
        tfMap[topicToks[j]] = (tfMap[topicToks[j]] || 0) + 1;
        inTopic[topicToks[j]] = true;
      }
      for (j = 0; j < bodyToks.length; j++) tfMap[bodyToks[j]] = (tfMap[bodyToks[j]] || 0) + 1;
      for (w in tfMap) {
        if (!this.inv[w]) this.inv[w] = [];
        this.inv[w].push({ id: id, tf: tfMap[w], inTopic: !!inTopic[w] });
      }
    }

    this.avgDocLen = this.entries.length ? (totalTokens / this.entries.length) : 1;
    this.blob = new Uint8Array(totalBytes);
    var cur = 0;
    for (i = 0; i < chunks.length; i++) { this.blob.set(chunks[i], cur); cur += chunks[i].length; }
    return { count: this.entries.length, totalBytes: totalBytes };
  };

  SkillShelfStore.prototype.readFullText = function (id) {
    var e = this.entries[id];
    if (!e) return null;
    var slice = this.blob.subarray(e.offset, e.offset + e.length);
    if (S && S.crc32(slice, 0, slice.length) !== e.crc32) {
      throw new Error("SkillShelfStore CRC32 mismatch on id " + id);
    }
    var chars = new Array(slice.length), i;
    for (i = 0; i < slice.length; i++) chars[i] = String.fromCharCode(slice[i]);
    return { id: e.id, shelf: e.shelf, topic: e.topic, fullText: chars.join(""), bytesRead: slice.length };
  };

  /* [{ score, hit }] best first (internal list form) */
  SkillShelfStore.prototype.rankList = function (q, topK) {
    var qToks = tokenizeCodeText(q), N = this.entries.length || 1;
    var avgdl = this.avgDocLen || 1, k1 = 1.2, b = 0.75;
    var scores = Object.create(null), seenQ = Object.create(null), i, j, w, list, df, idf, p, dl, tfNorm, id;

    for (i = 0; i < qToks.length; i++) {
      w = qToks[i];
      if (seenQ[w]) continue;
      seenQ[w] = true;
      list = this.inv[w];
      if (!list) continue;
      df = list.length;
      idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (j = 0; j < list.length; j++) {
        p = list[j]; dl = this.entries[p.id].docLen;
        tfNorm = (p.tf * (k1 + 1)) / (p.tf + k1 * (1 - b + b * (dl / avgdl)));
        scores[p.id] = (scores[p.id] || 0) + idf * tfNorm * (p.inTopic ? 2.4 : 1.0);
      }
    }
    var ranked = [];
    for (id in scores) ranked.push([Number(id), scores[id]]);
    ranked.sort(function (a, c) { return c[1] - a[1] || a[0] - c[0]; });
    var out = [], k = Math.min(topK || 4, ranked.length), hit;
    for (i = 0; i < k; i++) {
      hit = this.readFullText(ranked[i][0]);
      hit.score = ranked[i][1];
      out.push({ score: ranked[i][1], hit: hit });
    }
    return out;
  };

  /* the same call as OffsetShelfStore.searchFull: an array of hits, each with .score */
  SkillShelfStore.prototype.searchFull = function (q, topK) {
    var list = this.rankList(q, topK), out = [], i;
    for (i = 0; i < list.length; i++) out.push(list[i].hit);
    return out;
  };

  /* the same shape as OffsetShelfStore.searchScored, which EvelynCodeLoop reads (.hits, .topScore, .relGap) */
  SkillShelfStore.prototype.searchScored = function (q, topK) {
    var hits = this.searchFull(q, topK);
    var top = hits.length ? hits[0].score : 0, second = hits.length > 1 ? hits[1].score : 0;
    return { hits: hits, topScore: top, secondScore: second, gap: top - second, relGap: top > 0 ? (top - second) / top : 0 };
  };

  /* ======================================================================
     2. SKILL.md PARSER (frontmatter and ## Section cards)
     ====================================================================== */
  function parseSkillMarkdown(mdText) {
    var text = String(mdText || "").replace(/\r\n/g, "\n");
    var meta = { name: "unnamed", description: "", triggers: [], invariants: [], effort: 0.30 };
    var body = text, i, k, v, col;

    if (text.indexOf("---\n") === 0) {
      var end = text.indexOf("\n---\n", 4);
      if (end > 0) {
        var fmLines = text.slice(4, end).split("\n");
        for (i = 0; i < fmLines.length; i++) {
          col = fmLines[i].indexOf(":");
          if (col < 1) continue;
          k = fmLines[i].slice(0, col).replace(/^\s+|\s+$/g, "").toLowerCase();
          v = fmLines[i].slice(col + 1).replace(/^\s+|\s+$/g, "");
          if (k === "name") meta.name = v;
          else if (k === "description") meta.description = v;
          else if (k === "triggers") meta.triggers = v.split(/\s*,\s*/).filter(Boolean);
          else if (k === "effort") { var ef = parseFloat(v); meta.effort = isNaN(ef) ? 0.30 : ef; }
        }
        body = text.slice(end + 5);
      }
    }

    var sections = body.split(/^##\s+/m), records = [], s, nl, heading, content, rLines, r, clean;
    for (s = 1; s < sections.length; s++) {
      nl = sections[s].indexOf("\n");
      if (nl < 0) continue;
      heading = sections[s].slice(0, nl).replace(/^\s+|\s+$/g, "");
      content = sections[s].slice(nl + 1).replace(/^\s+|\s+$/g, "");
      if (heading.toLowerCase().indexOf("invariant") === 0 || heading.toLowerCase().indexOf("rule") === 0) {
        rLines = content.split("\n");
        for (r = 0; r < rLines.length; r++) {
          clean = rLines[r].replace(/^[\s\-*]+/, "").replace(/\s+$/, "");
          if (clean) meta.invariants.push(clean);
        }
      } else if (content) {
        records.push({ shelf: meta.name, topic: heading, fullText: content });
      }
    }
    return {
      name: meta.name, description: meta.description, triggers: meta.triggers,
      effortWithNotes: meta.effort, invariants: meta.invariants, records: records, verifiers: []
    };
  }

  /* ======================================================================
     3. SKILL REGISTRY (activates skills, builds compact prompts and verifier lists)
     ====================================================================== */
  function SkillRegistry() {
    this.skills = [];
    this.byName = Object.create(null);
  }

  SkillRegistry.prototype.register = function (def) {
    var store = new SkillShelfStore();
    if (def.records && def.records.length) store.buildFromRecords(def.records);
    var entry = {
      name: def.name,
      description: def.description || "",
      triggers: (def.triggers || []).map(function (t) { return String(t).toLowerCase(); }),
      invariants: def.invariants || [],
      verifiers: def.verifiers || [],   /* [{ pattern: RegExp, cmd, note, requiresApproval }] */
      effortWithNotes: def.effortWithNotes !== undefined ? def.effortWithNotes : 0.30,
      effortNoNotes: def.effortNoNotes !== undefined ? def.effortNoNotes : 0.50,
      store: store
    };
    this.skills.push(entry);
    this.byName[entry.name] = entry;
    return entry;
  };

  SkillRegistry.prototype.registerMarkdown = function (mdText) {
    return this.register(parseSkillMarkdown(mdText));
  };

  /* scores every skill against the task text (and optional file paths) */
  SkillRegistry.prototype.match = function (task, filePaths) {
    var hay = (String(task || "") + " " + (filePaths ? filePaths.join(" ") : "")).toLowerCase();
    var hits = [], i, j, sk, score, matched;
    for (i = 0; i < this.skills.length; i++) {
      sk = this.skills[i]; score = 0; matched = [];
      for (j = 0; j < sk.triggers.length; j++) {
        if (hay.indexOf(sk.triggers[j]) >= 0) { score++; matched.push(sk.triggers[j]); }
      }
      if (score > 0) hits.push({ skill: sk, score: score, matched: matched });
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits;
  };

  /* a compact, grounded prompt packet and the matched verifier commands for Inkling / EvelynCodeLoop */
  SkillRegistry.prototype.prepare = function (task, opts) {
    opts = opts || {};
    var topK = opts.topK || 4;
    var matches = opts.skillName
      ? (this.byName[opts.skillName] ? [{ skill: this.byName[opts.skillName], score: 99, matched: ["explicit"] }] : [])
      : this.match(task, opts.filePaths);

    if (!matches.length) {
      return { activeSkills: [], invariants: [], excerpts: [], verifiers: [], systemAddition: "", contextBlock: "", suggestedEffort: 0.45, store: null };
    }

    var active = [], invOut = [], invSeen = Object.create(null);
    var scoredAll = [], verOut = [], verSeen = Object.create(null);
    var taskLower = String(task || "").toLowerCase(), i, j, sk, res, vr;

    for (i = 0; i < Math.min(opts.maxSkills || 2, matches.length); i++) {
      sk = matches[i].skill;
      active.push(sk.name);
      for (j = 0; j < sk.invariants.length; j++) {
        if (!invSeen[sk.invariants[j]]) { invSeen[sk.invariants[j]] = true; invOut.push(sk.invariants[j]); }
      }
      res = sk.store.rankList(task, topK);
      for (j = 0; j < res.length; j++) scoredAll.push(res[j]);

      for (j = 0; j < sk.verifiers.length; j++) {
        vr = sk.verifiers[j];
        if (!vr.pattern || vr.pattern.test(taskLower)) {
          if (!verSeen[vr.cmd]) { verSeen[vr.cmd] = true; verOut.push({ cmd: vr.cmd, note: vr.note || "", requiresApproval: !!vr.requiresApproval }); }
        }
      }
    }

    scoredAll.sort(function (a, b) { return b.score - a.score; });
    var excerpts = [], ctxLines = [], h;
    for (i = 0; i < Math.min(topK, scoredAll.length); i++) {
      h = scoredAll[i].hit;
      excerpts.push(h);
      ctxLines.push("[" + h.shelf + "#" + h.id + " | " + h.topic + "] " + h.fullText);
    }

    var primary = matches[0].skill;
    return {
      activeSkills: active,
      invariants: invOut,
      excerpts: excerpts,
      verifiers: verOut,
      systemAddition: "Active skill(s): " + active.join(", ") + ".\nHard invariants (do NOT violate):\n- " + invOut.join("\n- "),
      contextBlock: ctxLines.length ? ("Verified skill notes:\n" + ctxLines.join("\n")) : "",
      suggestedEffort: excerpts.length ? primary.effortWithNotes : primary.effortNoNotes,
      store: primary.store    /* drop-in for EvelynCodeLoop({ store }) */
    };
  };

  var API = {
    tokenizeCodeText: tokenizeCodeText,
    SkillShelfStore: SkillShelfStore,
    parseSkillMarkdown: parseSkillMarkdown,
    SkillRegistry: SkillRegistry
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynSkills = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
