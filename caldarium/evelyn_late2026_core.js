/* evelyn_late2026_core.js - Eight Late-2026 Architectural Patterns Adapted for Small/Medium Hardware:
   1. SteerablePlanner      (Mid-task interruptible constraint steering without context reset)
   2. SpatialWorldCache & DRS (3D pose-indexed frustum memory + anchor eviction + dynamic res scaling)
   3. ProsodyDirector       (Plain-English stage directions -> acoustic + portrait animation driver)
   4. SpecBoundaryGuard     (Finite-domain SMT-style satisfiability + Vericoding prover + OpenSpec lock)
   5. LEASHGovernor         (Lease-Enforced Agentic Safety Harness + deterministic sensor commit gate)
   6. WorktreeTraceHealer   (Parallel virtual worktrees + temporal commit-why graph + trace-to-patch)
   7. SurgicalFeatureEditor (Orthogonal feature ablation & dialing inside residual vectors)
   8. AgentMessageBus             (Local JSON-RPC MCP tool registry + A2A capability delegation)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynCodePower) {
    try { require("./evelyn_code_power.js"); } catch (e) {}
  }

  /* =========================================================================
     1. MID-TASK STEERABLE PLANNER (STEERABLE-PLANNING PATTERN)
     ========================================================================= */
  function SteerablePlanner(steps, initialConstraints) {
    this.steps = (steps || []).slice(0); // [{ id, run(ctx, constraints) -> val }]
    this.constraints = (initialConstraints || []).slice(0);
    this.cursor = 0;
    this.outputs = Object.create(null);
    this.interruptLog = [];
  }
  SteerablePlanner.prototype.interrupt = function (newConstraint) {
    this.constraints.push(newConstraint);
    this.interruptLog.push({ atStep: this.cursor, constraint: newConstraint });
  };
  SteerablePlanner.prototype.stepNext = function () {
    if (this.cursor >= this.steps.length) return { done: true, outputs: this.outputs };
    var st = this.steps[this.cursor];
    var val = st.run(this.outputs, this.constraints.slice(0));
    this.outputs[st.id] = val;
    this.cursor++;
    return { done: this.cursor >= this.steps.length, stepId: st.id, value: val, activeConstraints: this.constraints.slice(0) };
  };

  /* =========================================================================
     2. 3D POSE-INDEXED SPATIAL MEMORY + DYNAMIC RESOLUTION SCALER (WORLDCRAFTER / DRS)
     ========================================================================= */
  function wrapAngle(rad) {
    while (rad > Math.PI) rad -= Math.PI * 2;
    while (rad < -Math.PI) rad += Math.PI * 2;
    return rad;
  }

  function SpatialWorldCache(maxRecent, maxAnchors) {
    this.maxRecent = maxRecent || 12;
    this.maxAnchors = maxAnchors || 8;
    this.recent = [];
    this.anchors = [];
  }
  SpatialWorldCache.prototype.storePose = function (id, x, y, z, yawRad, stateObj, isAnchor) {
    var rec = { id: id, x: x, y: y, z: z, yaw: yawRad || 0, state: JSON.parse(JSON.stringify(stateObj || {})), isAnchor: !!isAnchor };
    if (isAnchor) {
      this.anchors.push(rec);
      if (this.anchors.length > this.maxAnchors) this.anchors.shift();
    } else {
      this.recent.push(rec);
      if (this.recent.length > this.maxRecent) this.recent.shift();
    }
    return rec;
  };
  /* Retrieve cached room/object states inside camera geometric frustum (regardless of age!) */
  SpatialWorldCache.prototype.queryFrustum = function (camX, camY, camZ, camYawRad, halfFovRad, maxDist) {
    var fov = halfFovRad || 0.75, lim = maxDist || 50;
    var all = this.anchors.concat(this.recent), hits = [];
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      var dx = r.x - camX, dy = r.y - camY, dz = r.z - camZ;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > lim) continue;
      var angleToObj = dist < 1e-6 ? camYawRad : Math.atan2(dz, dx);
      var diff = Math.abs(wrapAngle(angleToObj - camYawRad));
      if (diff <= fov) hits.push({ id: r.id, dist: Number(dist.toFixed(2)), angleErr: Number(diff.toFixed(3)), isAnchor: r.isAnchor, state: r.state });
    }
    hits.sort(function (a, b) { return a.dist - b.dist; });
    return hits;
  };

  var DynamicResScaler = {
    compute: function (baseW, baseH, angularSpeedRadSec) {
      var spd = Math.abs(angularSpeedRadSec || 0);
      var scale = spd > 1.5 ? 0.55 : (spd > 0.6 ? 0.75 : 1.0);
      var w = Math.max(32, (Math.round(baseW * scale) & ~3));
      var h = Math.max(24, (Math.round(baseH * scale) & ~3));
      return { width: w, height: h, scale: scale };
    }
  };

  /* =========================================================================
     3. PROSODY-DRIVEN ACTING & STAGE-DIRECTION CONTROLLER (DRAMA 3 / OMNIHUMAN)
     ========================================================================= */
  var ProsodyDirector = {
    direct: function (stageDirection, spokenText) {
      var d = String(stageDirection || "").toLowerCase();
      var cfg = { rate: 1.0, pitch: 1.0, volume: 0.85, pauseMs: 120, mood: "talking", jawGain: 1.0 };
      if (/whisper|quiet|hush|secret/.test(d)) { cfg.volume = 0.35; cfg.rate = 0.86; cfg.jawGain = 0.45; }
      if (/nervous|out of breath|rush|hurry/.test(d)) { cfg.rate = 1.18; cfg.pitch = 1.12; cfg.pauseMs = 60; cfg.mood = "thinking"; }
      if (/excited|cheer|happy|bright/.test(d)) { cfg.rate = 1.12; cfg.pitch = 1.15; cfg.volume = 0.95; cfg.mood = "happy"; cfg.jawGain = 1.2; }
      if (/calm|slow|gentle|tired/.test(d)) { cfg.rate = 0.82; cfg.pitch = 0.92; cfg.pauseMs = 190; }

      /* Generate syllable-level amplitude envelope driving Evelyn's CRT portrait mouth */
      var s = String(spokenText || "").toLowerCase(), env = [];
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        var amp = "aeiouy".indexOf(ch) >= 0 ? (0.85 * cfg.jawGain) : (ch === " " || ch === "," || ch === "." ? 0.0 : 0.35 * cfg.jawGain);
        env.push(Number(Math.min(1.0, amp).toFixed(2)));
      }
      return { acoustics: cfg, mouthEnvelope: env };
    }
  };

  /* =========================================================================
     4. SPEC SATISFIABILITY, BOUNDED VERICODING PROVER & OPENSPEC BOUNDARY GUARD
     ========================================================================= */
  var SpecBoundaryGuard = {
    /* Finite-domain constraint solver (catches contradictory specs BEFORE coding) */
    checkSpecSat: function (domains, predicateFn) {
      /* domains: [{ name, min, max, step }] (bounded for fast CPU verification) */
      var assign = Object.create(null), checked = 0, witness = null;
      function search(idx) {
        if (witness || checked > 10000) return;
        if (idx >= domains.length) {
          checked++;
          if (predicateFn(assign)) {
            witness = Object.create(null);
            for (var k in assign) witness[k] = assign[k];
          }
          return;
        }
        var d = domains[idx], st = d.step || 1;
        for (var v = d.min; v <= d.max; v += st) {
          assign[d.name] = v;
          search(idx + 1);
          if (witness) return;
        }
      }
      search(0);
      return { satisfiable: witness !== null, witness: witness, statesChecked: checked };
    },

    /* Vericoding exhaustive invariant prover over finite input domain */
    proveInvariant: function (fn, inputs, invariantFn) {
      for (var i = 0; i < inputs.length; i++) {
        var x = inputs[i], y = fn(x);
        if (!invariantFn(x, y)) {
          return { proven: false, counterexample: { input: x, output: y }, checked: i + 1 };
        }
      }
      return { proven: true, checked: inputs.length };
    },

    /* OpenSpec boundary contract: locks allowed files & immutable API signatures */
    verifyContract: function (contract, touchedFiles, modifiedSymbols) {
      var violations = [], i;
      var allow = contract.allowedFiles || [];
      var locked = contract.lockedSymbols || [];
      for (i = 0; i < touchedFiles.length; i++) {
        if (allow.indexOf(touchedFiles[i]) < 0) violations.push("File outside boundary contract: " + touchedFiles[i]);
      }
      for (i = 0; i < (modifiedSymbols || []).length; i++) {
        if (locked.indexOf(modifiedSymbols[i]) >= 0) violations.push("Locked API signature modified: " + modifiedSymbols[i]);
      }
      return { ok: violations.length === 0, violations: violations };
    }
  };

  /* =========================================================================
     5. LEASH (LEASE-ENFORCED AGENTIC SAFETY HARNESS FOR PHYSICAL ACTUATORS)
     ========================================================================= */
  function LEASHGovernor() {
    this.leases = Object.create(null);
    this.nextId = 1;
    this.auditLog = [];
  }
  LEASHGovernor.prototype.issueLease = function (agentId, allowedOp, ttlMs, nowMs) {
    var now = nowMs !== undefined ? nowMs : Date.now();
    var id = "lease_" + (this.nextId++);
    this.leases[id] = { id: id, agentId: agentId, op: allowedOp, expiresAt: now + (ttlMs || 400), revoked: false };
    return this.leases[id];
  };
  LEASHGovernor.prototype.revokeLease = function (leaseId) {
    if (this.leases[leaseId]) this.leases[leaseId].revoked = true;
  };
  LEASHGovernor.prototype.commitAction = function (leaseId, op, deterministicGateFn, nowMs) {
    var now = nowMs !== undefined ? nowMs : Date.now();
    var ls = this.leases[leaseId];
    if (!ls || ls.revoked) return this._log(false, "invalid_or_revoked_lease", op);
    if (now > ls.expiresAt) return this._log(false, "lease_expired", op);
    if (ls.op !== op) return this._log(false, "operation_scope_mismatch", op);
    var gateOk = false;
    try { gateOk = !!deterministicGateFn(); } catch (e) { gateOk = false; }
    if (!gateOk) return this._log(false, "commit_gate_rejected", op);
    return this._log(true, "committed", op);
  };
  LEASHGovernor.prototype._log = function (allowed, reason, op) {
    var entry = { allowed: allowed, reason: reason, op: op };
    this.auditLog.push(entry);
    return entry;
  };

  /* =========================================================================
     6. PARALLEL WORKTREES + TEMPORAL REPO GRAPH + TRACE-TO-PATCH HEALER
     ========================================================================= */
  function WorktreePool(baseFiles) {
    this.base = JSON.parse(JSON.stringify(baseFiles || {}));
    this.trees = Object.create(null);
    this.commitNotes = []; // Temporal Repo Graph: { file, symbol, whySafeguardExists }
  }
  WorktreePool.prototype.recordSafeguardNote = function (file, symbol, why) {
    this.commitNotes.push({ file: file, symbol: symbol, why: why });
  };
  WorktreePool.prototype.lookupSafeguards = function (file, symbol) {
    var out = [];
    for (var i = 0; i < this.commitNotes.length; i++) {
      var n = this.commitNotes[i];
      if ((!file || n.file === file) && (!symbol || n.symbol === symbol)) out.push(n.why);
    }
    return out;
  };
  WorktreePool.prototype.spawnWorktree = function (name) {
    this.trees[name] = JSON.parse(JSON.stringify(this.base));
    return this.trees[name];
  };
  /* Evaluate competing candidate patches in isolated worktrees and merge winner */
  WorktreePool.prototype.raceCandidates = function (candidates, scoreFn) {
    var best = null, i;
    for (i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var wt = this.spawnWorktree("wt_" + c.id);
      wt[c.file] = c.content;
      var sc = scoreFn(wt);
      if (sc.ok && (!best || sc.score > best.score)) {
        best = { id: c.id, file: c.file, score: sc.score, content: c.content };
      }
    }
    if (best) this.base[best.file] = best.content;
    return best ? { ok: true, winner: best.id, score: best.score } : { ok: false, error: "No candidate passed verification." };
  };

  /* =========================================================================
     7. SURGICAL FEATURE EDITOR (GOODFIRE SILICO ORTHOGONAL ABLATION)
     ========================================================================= */
  var SurgicalFeatureEditor = {
    normalize: function (vec) {
      var s = 0, i, out = new Float32Array(vec.length);
      for (i = 0; i < vec.length; i++) s += vec[i] * vec[i];
      var inv = 1.0 / (Math.sqrt(s) || 1.0);
      for (i = 0; i < vec.length; i++) out[i] = vec[i] * inv;
      return out;
    },
    /* Exact orthogonal projection removing feature direction u from hidden state h */
    ablateFeature: function (h, featureDir) {
      var u = this.normalize(featureDir), dot = 0, i, out = new Float32Array(h.length);
      for (i = 0; i < h.length; i++) dot += h[i] * u[i];
      for (i = 0; i < h.length; i++) out[i] = h[i] - dot * u[i];
      return { state: out, removedProjection: dot };
    },
    dialFeature: function (h, featureDir, delta) {
      var u = this.normalize(featureDir), out = new Float32Array(h.length);
      for (var i = 0; i < h.length; i++) out[i] = h[i] + delta * u[i];
      return out;
    }
  };

  /* =========================================================================
     8. LOCAL OFFLINE MCP + A2A PROTOCOL BUS (JSON-RPC TOOL & AGENT DISCOVERY)
     ========================================================================= */
  function AgentMessageBus() {
    this.tools = Object.create(null);
    this.agents = Object.create(null);
  }
  AgentMessageBus.prototype.registerTool = function (name, desc, handler) {
    this.tools[name] = { name: name, description: desc, handler: handler };
  };
  AgentMessageBus.prototype.registerAgent = function (id, capabilities, handler) {
    this.agents[id] = { id: id, capabilities: capabilities.slice(0), handler: handler };
  };
  AgentMessageBus.prototype.rpc = function (req) {
    var m = req && req.method, p = (req && req.params) || {};
    if (m === "tools/list") {
      var tList = [];
      for (var tn in this.tools) tList.push({ name: tn, description: this.tools[tn].description });
      return { ok: true, result: tList };
    }
    if (m === "tools/call") {
      var tool = this.tools[p.name];
      if (!tool) return { ok: false, error: "Unknown MCP tool: " + p.name };
      return { ok: true, result: tool.handler(p.args || {}) };
    }
    if (m === "a2a/discover") {
      var found = [];
      for (var aid in this.agents) {
        if (!p.capability || this.agents[aid].capabilities.indexOf(p.capability) >= 0) {
          found.push({ id: aid, capabilities: this.agents[aid].capabilities });
        }
      }
      return { ok: true, result: found };
    }
    if (m === "a2a/delegate") {
      var ag = this.agents[p.agentId];
      if (!ag) return { ok: false, error: "Unknown A2A agent: " + p.agentId };
      return { ok: true, result: ag.handler(p.task || {}) };
    }
    return { ok: false, error: "Unsupported RPC method: " + m };
  };

  root.EvelynLate2026 = {
    SteerablePlanner: SteerablePlanner,
    SpatialWorldCache: SpatialWorldCache,
    DynamicResScaler: DynamicResScaler,
    ProsodyDirector: ProsodyDirector,
    SpecBoundaryGuard: SpecBoundaryGuard,
    LEASHGovernor: LEASHGovernor,
    WorktreePool: WorktreePool,
    SurgicalFeatureEditor: SurgicalFeatureEditor,
    AgentMessageBus: AgentMessageBus
  };
})(typeof window !== "undefined" ? window : global);
