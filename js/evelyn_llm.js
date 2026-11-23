/* evelyn_llm.js - one front for the model loader and the agent, used by the command line (evelyn_cli.js) and the page (index.html).
   Plain ES5, Node or browser. It connects Evelyn to a language model that runs on the same machine and speaks the OpenAI chat
   format (llama-server, LM Studio, or any server with /v1/chat/completions), and gives three things:
     llm.test(cb)          GET /v1/models: is the server up, which models does it list (no tokens spent)
     llm.ask(question, cb) the agent: arithmetic with no model call, otherwise the library is searched, the model answers from the
                           excerpts, every number and source of the draft is checked (EvelynInklingAgent)
     llm.write(task, cb)   the code loop: notes and skills are retrieved, the model writes code, a checker runs it, the exact errors
                           go back for up to two repairs (EvelynCodeLoop)
   The code checker is the caller's: in Node, evelyn_llm.nodeVerifier(marker) runs the code in a vm context with no globals and a
   3 second limit; in a browser the default only parses the code (new Function, nothing is run) and looks for the function name,
   because a page cannot stop a loop that never ends. Run the result yourself in a sandbox before you trust it.
   No warranty: see the disclaimer in README.md. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var E = isNode ? require("./evelyn_core.js") : root.Evelyn;
  var S = isNode ? require("./evelyn_stream.js") : root.EvelynStream;
  var A = isNode ? require("./evelyn_inkling_agent.js") : root.EvelynInkling;
  var CL = isNode ? require("./evelyn_inkling_codeloop.js") : root.EvelynCodeLoop;
  var Skills = isNode ? require("./evelyn_skills.js") : root.EvelynSkills;
  var Caldera = isNode ? require("./skill_caldera_graphics.js") : root.CalderaGraphicsSkill;
  var VC = isNode ? require("./evelyn_visual_craft.js") : root.EvelynVisualCraft;
  var Reg = null;
  try { Reg = isNode ? require("./evelyn_registry.js") : root.EvelynRegistry; } catch (e0) { Reg = null; }

  /* where the usual servers listen; the page and the command line offer these */
  var PRESETS = {
    "llama.cpp": { url: "http://127.0.0.1:8080", model: "inkling", backend: "inkling" },
    "lmstudio": { url: "http://127.0.0.1:1234", model: "thinkingmachines/inkling-2-mini", backend: "inkling" },
    "ollama": { url: "http://127.0.0.1:11434", model: "qwen3", backend: "qwen" }
  };

  /* a general three.js skill (craft notes and rules); the Caldera skill is registered next to it on request */
  var THREEJS_CRAFT_SKILL = {
    name: "threejs-visual-craft",
    description: "three.js scenes: lighting contrast, atmosphere and framing",
    triggers: ["three.js", "threejs", "buildscene"],
    effortWithNotes: 0.30, effortNoNotes: 0.50,
    invariants: [
      "Obey every object count, geometry type and API name of the task exactly; add visual quality without adding meshes (Points, Sprite, fog).",
      "Use a strong key light with a weak ambient light, MeshStandardMaterial on lit objects, and frame the subject to fill about 60 percent of the view."
    ],
    records: VC ? VC.THREE_VISUAL_CRAFT_NOTES : []
  };

  /* ---------- code checkers ---------- */
  /* Node: runs the code in a vm context with no globals (no require, no process) and a 3 s limit; the name must be defined. */
  function nodeVerifier(marker) {
    var vm = require("vm");
    return function (code) {
      var errors = [];
      try {
        var out = vm.runInNewContext(code + (marker ? "\n;typeof " + marker + " === 'function'" : "\n;true"), { Math: Math, console: { log: function () {}, warn: function () {}, error: function () {} } }, { timeout: 3000 });
        if (marker && out !== true) errors.push("the code does not define a function named " + marker);
      } catch (e) { errors.push("the code did not run: " + String(e && e.message || e).slice(0, 160)); }
      return { ok: errors.length === 0, errors: errors };
    };
  }
  /* browser: parse only, nothing is run */
  function parseVerifier(marker) {
    return function (code) {
      var errors = [];
      try { new Function(code); } catch (e) { errors.push("the code does not parse: " + String(e && e.message || e).slice(0, 160)); }
      if (marker && !new RegExp("function\\s+" + marker + "\\b|(?:var|let|const)\\s+" + marker + "\\b").test(code)) errors.push("the code does not define " + marker);
      return { ok: errors.length === 0, errors: errors };
    };
  }

  /* ---------- the library as a shelf ---------- */
  function libraryShelf(lib) {
    var recs = [], i, r;
    for (i = 0; i < lib.records.length; i++) {
      r = lib.readRecord(lib.records[i]);
      recs.push({ shelf: "library", topic: r.topic, fullText: r.fact + (r.ex ? " " + r.ex : "") });
    }
    var st = new S.OffsetShelfStore();
    st.buildFromRecords(recs);
    return st;
  }

  /* opts: lib, pm (library and profile), url or preset, model, backend, effort ("low" | "medium" | "high" | number), maxTokens,
     notes (default true: the library is the shelf), skills (default true), skillMarkdown (array of SKILL.md texts), verify */
  function create(opts) {
    opts = opts || {};
    var preset = PRESETS[opts.preset] || {};
    var url = opts.url || preset.url || PRESETS["llama.cpp"].url;
    var self = {
      url: url, model: opts.model || preset.model || "inkling", backend: opts.backend || preset.backend || "inkling",
      lib: opts.lib, pm: opts.pm, notes: opts.notes !== false, skills: opts.skills !== false, effort: opts.effort || null
    };
    var skillReg = new Skills.SkillRegistry();
    skillReg.register(THREEJS_CRAFT_SKILL);
    if (Caldera) Caldera.registerCalderaGraphicsSkill(skillReg);
    (opts.skillMarkdown || []).forEach(function (md) { skillReg.registerMarkdown(md); });
    self.skillRegistry = skillReg;

    self.client = function (maxTokens) {
      return new A.InklingClient({ baseUrl: self.url, model: self.model, maxTokens: maxTokens || opts.maxTokens || 3000, temperature: 0.4, timeoutMs: 600000 });
    };

    var shelf = null, shelfCount = -1;
    function currentShelf() {
      if (!self.lib) return null;
      var n = self.lib.records.length;
      if (!shelf || n !== shelfCount) { shelf = libraryShelf(self.lib); shelfCount = n; }
      return shelf;
    }

    self.test = function (cb) {
      self.client().models(function (err, ids) {
        if (err) return cb(err);
        cb(null, { url: self.url, models: ids, hasModel: ids.indexOf(self.model) >= 0 });
      });
    };

    /* the agent: library notes (when notes is on) and the effort rule of the agent (low with excerpts, medium without) */
    self.ask = function (question, cb) {
      var st = self.notes ? currentShelf() : new S.OffsetShelfStore();
      if (!self.notes) st.buildFromRecords([]);
      var client = self.client();
      var agent = new A.EvelynInklingAgent(st, self.pm, client);
      agent.ask(question, cb);
    };

    /* the code loop; r.code is the final code, r.ok whether the checker passed it */
    self.write = function (task, cb) {
      var marker = opts.marker || null;
      var m = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/.exec(task);
      if (!marker && m) marker = m[1];
      var verify = opts.verify || (isNode ? nodeVerifier(marker) : parseVerifier(marker));
      var system = "You are a careful engineer. Reply with the complete code in one fenced block.", store = null, schedule = null, active = [];
      if (self.skills) {
        var pkt = skillReg.prepare(task, { topK: 4, maxSkills: 2 });
        active = pkt.activeSkills;
        if (active.length) { store = pkt.store; system += "\n\n" + pkt.systemAddition; schedule = [pkt.suggestedEffort, pkt.suggestedEffort / 2, 0.05]; }
      }
      var loop = new CL.EvelynCodeLoop({
        store: store, client: self.client(opts.codeTokens || 6000), verify: verify, marker: marker, maxRepairs: 2, system: system,
        scheduleWith: schedule || undefined
      });
      loop.run(task, function (err, r) {
        if (err) return cb(err);
        r.activeSkills = active;
        cb(null, r);
      });
    };

    return self;
  }

  var API = { PRESETS: PRESETS, create: create, nodeVerifier: nodeVerifier, parseVerifier: parseVerifier, libraryShelf: libraryShelf, THREEJS_CRAFT_SKILL: THREEJS_CRAFT_SKILL };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.EvelynLLM = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
