/* evelyn_agent_os_tests.js - Automated ES5 Tests for EvelynAgentOS (8 Pillars)
   Run in Node.js: node evelyn_agent_os_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) require("./evelyn_agent_os.js");

  var OS = root.EvelynAgentOS;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. RBAC Filesystem enforces role ACLs and turn-initiator least privilege */
  test("RBACFileSystem: Enforces per-path role ACLs and per-turn initiator permission intersection", function (done) {
    var fs = new OS.RBACFileSystem();
    fs.setACL("/shelves",   { parent: "rw", kid: "r",  echo: "rw" });
    fs.setACL("/charter",   { parent: "r",  kid: "r",  echo: "r"  });
    fs.setACL("/home/kid1", { parent: "rw", kid: "rw", echo: "rw" });

    assert(fs.write("/shelves/geo.txt", "Estonia=Tallinn", "parent", "parent").ok, "Parent should write /shelves");
    assert(!fs.write("/shelves/geo.txt", "tamper", "kid", "kid").ok, "Kid must not write /shelves");
    /* Even though echo has 'rw' on /shelves, an echo acting on a KID turn is restricted to 'r'! */
    assert(!fs.write("/shelves/geo.txt", "via echo", "echo", "kid").ok, "Turn-initiator intersection must block echo writing /shelves for kid");
    assert(fs.write("/home/kid1/notes.txt", "my math note", "echo", "kid").ok, "Echo acting for kid can write /home/kid1");
    assert(!fs.write("/charter/vows.txt", "edit", "parent", "parent").ok, "Read-only /charter blocks writes");
    done();
  });

  /* 2. Actors (bespoke tools + isolated hooks) + N Agents x M Checkpointed Sandboxes + Session vs Conversation */
  test("ActorRuntime, SandboxPool & ConversationHub: Isolates tools, clones sandboxes & hides session internals", function (done) {
    var pool = new OS.SandboxPool();
    pool.create("base_sb", { speed: 10 });
    pool.checkpoint("base_sb", "cp_0");
    var c1 = pool.cloneFromCheckpoint("cp_0", "sb_A");
    var c2 = pool.cloneFromCheckpoint("cp_0", "sb_B");
    c1.sandbox.env.speed = 99;
    assertEq(c2.sandbox.env.speed, 10, "Cloned sandboxes must stay strictly isolated");

    var hub = new OS.ConversationHub();
    var rt = new OS.ActorRuntime({
      calc: function (a) { return { ok: true, value: a.x * a.y }; },
      shell: function () { return { ok: true, ran: true }; }
    }, hub);

    /* Bespoke MathActor: allowed ONLY calc + post_message (no shell!) */
    rt.defineAgent({
      id: "math_actor", role: "echo", allowedTools: ["calc", "post_message"],
      runTurn: function (ctx, inp) {
        ctx.logSession("Checking forbidden shell first");
        var denied = ctx.callTool("shell", {});
        var sum = ctx.callTool("calc", { x: inp.x, y: inp.y });
        ctx.callTool("post_message", { text: "Answer is " + sum.value + "." });
        return { deniedOk: !denied.ok, val: sum.value };
      }
    });

    var inst = rt.spawnInstance("math_actor", "sb_A");
    rt.addActorHook(inst.id, function (inp) { return { x: inp.x, y: inp.y + 1 }; }); // Actor-local hook!
    var turn = rt.runTurn(inst.id, "conv_1", { x: 6, y: 6 }, "kid");
    assert(turn.ok && turn.result.deniedOk && turn.result.val === 42, "Actor tool isolation or hook failed");

    /* Conversation has ONLY the 1 clean posted message; raw session trace stays separate for X-Ray */
    var msgs = hub.readConversation("conv_1");
    assertEq(msgs.length, 1, "Conversation should show only explicit post_message outputs");
    assertEq(msgs[0].text, "Answer is 42.", "Posted message text mismatch");
    assert(inst.sessionTrace.length >= 4, "Raw session trace should preserve internal thoughts and tool calls");
    done();
  });

  /* 3. Durable Code-Defined Workflow pauses on ApprovalInbox, survives serialized reboot, and resumes */
  test("DurableWorkflowEngine & ApprovalInbox: Pauses on inbox, survives reboot serialization & resumes", function (done) {
    var inbox = new OS.ApprovalInbox();
    var wf1 = new OS.DurableWorkflowEngine(inbox);
    var steps = [
      { id: "prep", kind: "code", run: function (st) { return st.raw * 2; } },
      { id: "gate", kind: "wait_inbox", title: "Approve custom shelf import?", requiredRole: "parent" },
      { id: "commit", kind: "code", run: function (st) { return "COMMITTED:" + st.prep; } }
    ];
    wf1.define("import_shelf", steps);

    var run = wf1.start("import_shelf", { raw: 21 });
    assertEq(run.status, "paused_inbox", "Workflow must pause at wait_inbox step");
    assertEq(inbox.listPending("parent").length, 1, "Inbox should hold 1 pending parent approval");

    /* Kid cannot approve a parent-only Inbox card */
    assert(!inbox.resolve(run.pendingInboxId, true, "kid").ok, "Kid must not approve parent Inbox card");

    /* Simulate full reboot: serialize workflow state to JSON and restore into a brand-new engine */
    var saved = wf1.exportStateJSON();
    var wf2 = new OS.DurableWorkflowEngine(inbox);
    wf2.define("import_shelf", steps);
    wf2.importStateJSON(saved);

    assert(inbox.resolve(run.pendingInboxId, true, "parent").ok, "Parent approval should succeed");
    var resumed = wf2.resumeAfterInbox(run.id, true);
    assert(resumed.ok && resumed.run.status === "completed" && resumed.run.state.commit === "COMMITTED:42",
      "Durable workflow failed to complete after reboot resume");
    done();
  });

  /* 4. Dynamic Event Listeners with predicates & TTL expiration */
  test("EventListenerBus: Triggers on matching filtered events and auto-expires after TTL", function (done) {
    var bus = new OS.EventListenerBus(), alerts = [];
    bus.addListener("watch_rover", "sensor", function (p) { return p.frontCm < 15; }, function (p) { alerts.push(p.frontCm); }, 5000, 1000);

    assertEq(bus.emit("sensor", { frontCm: 40 }, 1500).length, 0, "Safe distance should not trigger listener");
    assertEq(bus.emit("sensor", { frontCm: 8 }, 2000).length, 1, "Close obstacle should trigger listener");
    assertEq(alerts[0], 8, "Listener payload mismatch");
    assertEq(bus.emit("sensor", { frontCm: 5 }, 7000).length, 0, "Expired TTL listener must auto-remove");
    done();
  });

  /* 5. Forkable Apps-in-Filesystem + Container View Modes */
  test("AppRegistry: Forks system app into user filesystem with custom container without touching base app", function (done) {
    var fs = new OS.RBACFileSystem();
    fs.setACL("/apps",      { parent: "rw", kid: "r"  });
    fs.setACL("/home/kid1", { parent: "rw", kid: "rw" });

    var reg = new OS.AppRegistry(fs);
    assert(reg.installSystemApp("concourse", { title: "Concourse", container: "app_with_sidebar" }, "parent").ok, "Install system app failed");

    var forked = reg.forkAppForUser("concourse", "kid1", "kid", { container: "infinite_canvas", title: "Kid1 Canvas" });
    assert(forked.ok && forked.app.container === "infinite_canvas" && forked.app.forkedFrom === "/apps/concourse.app.json", "App fork failed");

    /* Base system app remains unchanged */
    var orig = JSON.parse(fs.read("/apps/concourse.app.json", "kid", "kid").content);
    assertEq(orig.container, "app_with_sidebar", "Base system app was mutated by user fork");
    done();
  });

  /* 6. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_agent_os.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_agent_os.js", "evelyn_agent_os_tests.js"];
      var banned = [[/\bArray\.from\s*\(/, "Array.from"], [/\bnew\s+Map\s*\(/, "Map"], [/\bnew\s+Set\s*\(/, "Set"], [/\)\s*=>/, "arrow"], [/\(\?</, "lookbehind"]];
      for (var i = 0; i < files.length; i++) {
        var fp = path.join(__dirname, files[i]);
        if (!fs.existsSync(fp)) continue;
        var src = fs.readFileSync(fp, "utf8");
        for (var j = 0; j < banned.length; j++) assert(!banned[j][0].test(src), files[i] + " failed ES5 guard: " + banned[j][1]);
      }
      done();
    });
  }

  var pass = 0, fail = 0, idx = 0;
  function next() {
    if (idx >= tests.length) {
      console.log("\n=== EVELYN AGENT OS 2027 RESULT: " + pass + " passed, " + fail + " failed ===");
      if (isNode) process.exit(fail > 0 ? 1 : 0);
      return;
    }
    var cur = tests[idx++], ended = false;
    function done(err) {
      if (ended) return; ended = true;
      if (err) { fail++; console.log("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
      else { pass++; console.log("[PASS] " + cur.name); }
      setTimeout(next, 0);
    }
    try { cur.fn(done); } catch (e) { done(e); }
  }
  console.log("=== EVELYN AGENT OS 2027 (8 PILLARS) TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
