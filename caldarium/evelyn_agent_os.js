/* evelyn_agent_os.js - Offline "Agent Platform 2027" Kernel for Small & Medium Hardware:
   1. RBACFileSystem       (POSIX-style virtual FS with per-path ACLs & per-turn least privilege)
   2. SandboxPool          (N agents x M checkpointed, cloneable sandboxes)
   3. ActorRuntime         (Separates Agent Definition, Instance & Session; bespoke tool allowlists)
   4. ConversationHub      (Separates user-facing Conversation from raw X-Ray Agent Session)
   5. ApprovalInbox        (Focused human-in-the-loop approval & question cards)
   6. EventListenerBus     (On-the-fly dynamic event monitors with predicates & TTL)
   7. DurableWorkflowEngine(Code-defined workflows that pause on Inbox & serialize across reboots)
   8. AppRegistry          (Forkable OS-within-an-OS apps in filesystem + 6 container view modes)
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  /* =========================================================================
     1. RBAC FILESYSTEM (PER-PATH ACLS + TURN-INITIATOR LEAST-PRIVILEGE)
     ========================================================================= */
  function normPath(p) {
    var s = "/" + String(p || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (s.indexOf("..") >= 0) return null;
    return s;
  }

  function RBACFileSystem() {
    this.files = Object.create(null); // path -> string content
    this.acls = [];                   // [{ prefix, roles: { parent: "rw", kid: "r", echo: "r" } }]
  }

  RBACFileSystem.prototype.setACL = function (prefixPath, rolePerms) {
    var p = normPath(prefixPath);
    if (!p) return false;
    this.acls.push({ prefix: p, roles: JSON.parse(JSON.stringify(rolePerms)) });
    /* Longest prefix matches first */
    this.acls.sort(function (a, b) { return b.prefix.length - a.prefix.length; });
    return true;
  };

  RBACFileSystem.prototype._permForRole = function (pathStr, role) {
    for (var i = 0; i < this.acls.length; i++) {
      var a = this.acls[i];
      if (pathStr === a.prefix || pathStr.indexOf(a.prefix + "/") === 0 || a.prefix === "/") {
        return a.roles[role] || "";
      }
    }
    return "";
  };

  /* Effective permission = actor permission INTERSECTED with turn initiator permission! */
  RBACFileSystem.prototype.canAccess = function (pathStr, modeChar, actorRole, initiatorRole) {
    var p = normPath(pathStr);
    if (!p) return false;
    var pAct = this._permForRole(p, actorRole);
    var pInit = initiatorRole ? this._permForRole(p, initiatorRole) : pAct;
    return (pAct.indexOf(modeChar) >= 0) && (pInit.indexOf(modeChar) >= 0);
  };

  RBACFileSystem.prototype.write = function (pathStr, content, actorRole, initiatorRole) {
    var p = normPath(pathStr);
    if (!p) return { ok: false, error: "Invalid path." };
    if (!this.canAccess(p, "w", actorRole, initiatorRole)) {
      return { ok: false, error: "RBAC denied write on " + p + " for " + actorRole + " (initiator: " + (initiatorRole || actorRole) + ")." };
    }
    this.files[p] = String(content || "");
    return { ok: true, path: p, bytes: this.files[p].length };
  };

  RBACFileSystem.prototype.read = function (pathStr, actorRole, initiatorRole) {
    var p = normPath(pathStr);
    if (!p) return { ok: false, error: "Invalid path." };
    if (!this.canAccess(p, "r", actorRole, initiatorRole)) {
      return { ok: false, error: "RBAC denied read on " + p };
    }
    if (this.files[p] === undefined) return { ok: false, error: "File not found: " + p };
    return { ok: true, path: p, content: this.files[p] };
  };

  /* =========================================================================
     2. N AGENTS x M CHECKPOINTED SANDBOXES POOL
     ========================================================================= */
  function SandboxPool() {
    this.sandboxes = Object.create(null);
    this.checkpoints = Object.create(null);
  }
  SandboxPool.prototype.create = function (id, initialState) {
    this.sandboxes[id] = { id: id, env: JSON.parse(JSON.stringify(initialState || {})) };
    return this.sandboxes[id];
  };
  SandboxPool.prototype.checkpoint = function (sandboxId, cpId) {
    var sb = this.sandboxes[sandboxId];
    if (!sb) return { ok: false, error: "Sandbox not found." };
    this.checkpoints[cpId] = JSON.parse(JSON.stringify(sb.env));
    return { ok: true, checkpointId: cpId };
  };
  SandboxPool.prototype.cloneFromCheckpoint = function (cpId, newSandboxId) {
    if (!this.checkpoints[cpId]) return { ok: false, error: "Checkpoint not found." };
    this.sandboxes[newSandboxId] = { id: newSandboxId, env: JSON.parse(JSON.stringify(this.checkpoints[cpId])) };
    return { ok: true, sandbox: this.sandboxes[newSandboxId] };
  };

  /* =========================================================================
     3. CONVERSATION HUB (SEPARATES USER CONVERSATION FROM RAW AGENT SESSION)
     ========================================================================= */
  function ConversationHub() {
    this.conversations = Object.create(null); // convId -> [{ from, text, widget, at }]
  }
  ConversationHub.prototype.post = function (convId, fromAgent, text, embeddedApp) {
    if (!this.conversations[convId]) this.conversations[convId] = [];
    var msg = { from: fromAgent, text: String(text || ""), widget: embeddedApp || null, at: Date.now() };
    this.conversations[convId].push(msg);
    return msg;
  };
  ConversationHub.prototype.readConversation = function (convId) {
    return (this.conversations[convId] || []).slice(0);
  };

  /* =========================================================================
     4. AGENTS AS ACTORS (SEPARATE DEFINITION, INSTANCE, SESSION & BESPOKE TOOLS)
     ========================================================================= */
  function ActorRuntime(toolMap, convHub) {
    this.tools = toolMap || Object.create(null);
    this.convHub = convHub || new ConversationHub();
    this.definitions = Object.create(null);
    this.instances = Object.create(null);
    this.nextInst = 1;
  }

  ActorRuntime.prototype.defineAgent = function (def) {
    /* def: { id, role, allowedTools: [...], runTurn(ctx, input) } */
    this.definitions[def.id] = {
      id: def.id,
      role: def.role || "echo",
      allowedTools: (def.allowedTools || []).slice(0),
      runTurn: def.runTurn
    };
    return this.definitions[def.id];
  };

  ActorRuntime.prototype.spawnInstance = function (defId, sandboxId) {
    var def = this.definitions[defId];
    if (!def) throw new Error("Unknown agent definition: " + defId);
    var instId = defId + "#" + (this.nextInst++);
    this.instances[instId] = {
      id: instId,
      defId: defId,
      role: def.role,
      sandboxId: sandboxId || null,
      hooks: [],             // Self-improving per-actor runtime hooks isolated from other actors
      sessionTrace: []       // Raw internal tool calls & thoughts (hidden from Conversation!)
    };
    return this.instances[instId];
  };

  ActorRuntime.prototype.addActorHook = function (instId, hookFn) {
    if (this.instances[instId]) this.instances[instId].hooks.push(hookFn);
  };

  ActorRuntime.prototype.runTurn = function (instId, convId, input, initiatorRole) {
    var inst = this.instances[instId];
    var def = inst ? this.definitions[inst.defId] : null;
    if (!inst || !def) return { ok: false, error: "Invalid actor instance." };
    var self = this;

    var ctx = {
      instanceId: inst.id,
      sandboxId: inst.sandboxId,
      initiatorRole: initiatorRole || inst.role,
      /* Raw thought stays inside sessionTrace (inspectable via X-Ray, never dumped to user chat) */
      logSession: function (note) {
        inst.sessionTrace.push({ kind: "thought", note: String(note) });
      },
      /* Explicit tool call with strict bespoke-tool enforcement */
      callTool: function (toolName, args) {
        if (def.allowedTools.indexOf(toolName) < 0) {
          inst.sessionTrace.push({ kind: "tool_denied", tool: toolName });
          return { ok: false, error: "Tool '" + toolName + "' not permitted for actor '" + def.id + "'." };
        }
        if (toolName === "post_message") {
          var posted = self.convHub.post(convId, inst.id, args.text, args.widget);
          inst.sessionTrace.push({ kind: "post_message", text: posted.text });
          return { ok: true, message: posted };
        }
        var fn = self.tools[toolName];
        if (!fn) return { ok: false, error: "Missing tool handler: " + toolName };
        var res = fn(args || {}, { actorRole: inst.role, initiatorRole: initiatorRole || inst.role, sandboxId: inst.sandboxId });
        inst.sessionTrace.push({ kind: "tool_call", tool: toolName, ok: !(res && res.ok === false) });
        return res;
      }
    };

    var effectiveInput = input;
    for (var h = 0; h < inst.hooks.length; h++) effectiveInput = inst.hooks[h](effectiveInput);
    var out = def.runTurn(ctx, effectiveInput);
    return { ok: true, result: out, sessionLen: inst.sessionTrace.length };
  };

  /* =========================================================================
     5. FOCUSED HUMAN APPROVAL INBOX
     ========================================================================= */
  function ApprovalInbox() {
    this.items = []; // { id, title, requiredRole, payload, status: 'pending'|'approved'|'rejected', workflowId }
    this.nextId = 1;
  }
  ApprovalInbox.prototype.enqueue = function (opts) {
    var item = {
      id: "inb_" + (this.nextId++),
      title: opts.title || "Review Request",
      requiredRole: opts.requiredRole || "parent",
      appWidget: opts.appWidget || null,
      payload: opts.payload || {},
      workflowId: opts.workflowId || null,
      status: "pending",
      decisionBy: null
    };
    this.items.push(item);
    return item;
  };
  ApprovalInbox.prototype.listPending = function (role) {
    var out = [];
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].status === "pending" && (!role || this.items[i].requiredRole === role)) out.push(this.items[i]);
    }
    return out;
  };
  ApprovalInbox.prototype.resolve = function (itemId, approve, resolverRole) {
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.id === itemId) {
        if (it.requiredRole && resolverRole !== it.requiredRole && resolverRole !== "parent") {
          return { ok: false, error: "Only '" + it.requiredRole + "' may resolve this inbox item." };
        }
        it.status = approve ? "approved" : "rejected";
        it.decisionBy = resolverRole;
        return { ok: true, item: it };
      }
    }
    return { ok: false, error: "Inbox item not found." };
  };

  /* =========================================================================
     6. DYNAMIC EVENT LISTENERS & MONITORS (ON-THE-FLY, WITH TTL & FILTERS)
     ========================================================================= */
  function EventListenerBus() {
    this.listeners = []; // { id, topic, filterFn, actionFn, expiresAt, hits }
  }
  EventListenerBus.prototype.addListener = function (id, topic, filterFn, actionFn, ttlMs, nowMs) {
    var now = nowMs !== undefined ? nowMs : Date.now();
    this.listeners.push({
      id: id, topic: topic,
      filterFn: filterFn || function () { return true; },
      actionFn: actionFn,
      expiresAt: ttlMs ? (now + ttlMs) : 0,
      hits: 0
    });
  };
  EventListenerBus.prototype.emit = function (topic, payload, nowMs) {
    var now = nowMs !== undefined ? nowMs : Date.now();
    var triggered = [];
    for (var i = this.listeners.length - 1; i >= 0; i--) {
      var L = this.listeners[i];
      if (L.expiresAt && now > L.expiresAt) { this.listeners.splice(i, 1); continue; }
      if (L.topic === topic || L.topic === "*") {
        if (L.filterFn(payload)) {
          L.hits++;
          L.actionFn(payload);
          triggered.push(L.id);
        }
      }
    }
    return triggered;
  };

  /* =========================================================================
     7. CODE-DEFINED DURABLE WORKFLOW ENGINE (PAUSES ON INBOX, SURVIVES REBOOT)
     ========================================================================= */
  function DurableWorkflowEngine(inbox) {
    this.inbox = inbox || new ApprovalInbox();
    this.defs = Object.create(null);
    this.runs = Object.create(null);
    this.nextRun = 1;
  }
  DurableWorkflowEngine.prototype.define = function (name, steps) {
    /* step: { id, kind: 'code'|'wait_inbox', run(state), title, requiredRole } */
    this.defs[name] = steps.slice(0);
  };
  DurableWorkflowEngine.prototype.start = function (name, initState) {
    var id = "wf_" + (this.nextRun++);
    this.runs[id] = { id: id, defName: name, cursor: 0, status: "running", state: JSON.parse(JSON.stringify(initState || {})), pendingInboxId: null };
    return this._advance(id);
  };
  DurableWorkflowEngine.prototype._advance = function (runId) {
    var run = this.runs[runId], steps = this.defs[run.defName];
    while (run.cursor < steps.length) {
      var st = steps[run.cursor];
      if (st.kind === "wait_inbox") {
        var inb = this.inbox.enqueue({ title: st.title, requiredRole: st.requiredRole || "parent", payload: run.state, workflowId: runId });
        run.status = "paused_inbox";
        run.pendingInboxId = inb.id;
        return run;
      }
      run.state[st.id] = st.run(run.state);
      run.cursor++;
    }
    run.status = "completed";
    return run;
  };
  DurableWorkflowEngine.prototype.exportStateJSON = function () { return JSON.stringify(this.runs); };
  DurableWorkflowEngine.prototype.importStateJSON = function (json) { this.runs = JSON.parse(json); };
  DurableWorkflowEngine.prototype.resumeAfterInbox = function (runId, approved) {
    var run = this.runs[runId];
    if (!run || run.status !== "paused_inbox") return { ok: false, error: "Workflow not paused on inbox." };
    run.pendingInboxId = null;
    if (!approved) { run.status = "cancelled"; return { ok: true, run: run }; }
    run.cursor++;
    run.status = "running";
    return { ok: true, run: this._advance(runId) };
  };

  /* =========================================================================
     8. FORKABLE APPS-IN-FILESYSTEM + 6 CONTAINER LAYOUT MODES
     ========================================================================= */
  var CONTAINER_MODES = ["tmux_split", "embedded_in_message", "app_with_sidebar", "infinite_canvas", "layered_windows", "resizable_grid"];

  function AppRegistry(rbacFs) {
    this.fs = rbacFs;
  }
  AppRegistry.prototype.installSystemApp = function (appId, appSpec, actorRole) {
    var path = "/apps/" + appId + ".app.json";
    var payload = JSON.stringify({
      id: appId,
      title: appSpec.title || appId,
      container: CONTAINER_MODES.indexOf(appSpec.container) >= 0 ? appSpec.container : "app_with_sidebar",
      components: appSpec.components || [],
      forkedFrom: null
    });
    return this.fs.write(path, payload, actorRole || "parent", actorRole || "parent");
  };
  AppRegistry.prototype.forkAppForUser = function (appId, userId, userRole, customPatch) {
    var base = this.fs.read("/apps/" + appId + ".app.json", userRole, userRole);
    if (!base.ok) return base;
    var obj = JSON.parse(base.content);
    obj.forkedFrom = "/apps/" + appId + ".app.json";
    if (customPatch) {
      for (var k in customPatch) obj[k] = customPatch[k];
    }
    var userPath = "/home/" + userId + "/apps/" + appId + ".app.json";
    var wr = this.fs.write(userPath, JSON.stringify(obj), userRole, userRole);
    return wr.ok ? { ok: true, path: userPath, app: obj } : wr;
  };

  root.EvelynAgentOS = {
    CONTAINER_MODES: CONTAINER_MODES,
    RBACFileSystem: RBACFileSystem,
    SandboxPool: SandboxPool,
    ConversationHub: ConversationHub,
    ActorRuntime: ActorRuntime,
    ApprovalInbox: ApprovalInbox,
    EventListenerBus: EventListenerBus,
    DurableWorkflowEngine: DurableWorkflowEngine,
    AppRegistry: AppRegistry
  };
})(typeof window !== "undefined" ? window : global);
