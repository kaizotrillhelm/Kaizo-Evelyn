/* evelyn_doctor_tests.js - Fault-Injection & Auto-Repair Tests for EvelynDoctor
   Run in Node.js: node evelyn_doctor_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_cartridges.js");
    require("./evelyn_doctor.js");
  }

  var B = root.EvelynBackend;
  var C = root.EvelynCartridges;
  var D = root.EvelynDoctor;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Corrupt compressed shelf rows & out-of-bounds postings */
  test("Doctor: Detect and repair corrupt ShelfLibrary rows and out-of-bounds postings", function (done) {
    B.EvelynDB.open(function () {
      B.ShelfLibrary.rows = [];
      B.ShelfLibrary.postings = Object.create(null);
      C.seedDefaultShelves();
      var validBefore = B.ShelfLibrary.rows.length;

      /* Inject one broken row and one out-of-bounds posting gap */
      B.ShelfLibrary.rows.push({ id: validBefore, shelf: "bad", topic: "broken", zF: "", zE: "" });
      B.ShelfLibrary.postings["ghostword"] = new Uint32Array([9999]);

      var d1 = D.diagnose({});
      assert(!d1.healthy, "Doctor should detect corrupt shelf rows and bad postings");

      var res = D.heal({});
      assert(res.healthyAfter, "System should be healthy after heal()");
      assertEq(B.ShelfLibrary.rows.length, validBefore, "Corrupt row should be quarantined while valid rows stay");
      assert(B.ShelfLibrary.postings["ghostword"] === undefined, "Corrupt posting should be cleared on rebuild");
      done();
    });
  });

  /* 2. Completely wiped shelves auto-reseed */
  test("Doctor: Re-seed default shelves automatically when ShelfLibrary is empty", function (done) {
    B.ShelfLibrary.rows = [];
    B.ShelfLibrary.postings = Object.create(null);
    var res = D.heal({});
    assert(res.healthyAfter, "Empty shelves should heal to healthy");
    assert(B.ShelfLibrary.rows.length >= 20, "Default shelves should be restored");
    done();
  });

  /* 3. Malformed learner profile salvaged without wiping trophies or name */
  test("Doctor: Salvage malformed learner profile without losing name or trophies", function (done) {
    var ctx = {
      profiles: {
        learner1: { name: "Maya", mode: "INVALID", xp: NaN, trophies: ["Atlas Detective"], sr: null, recent8: null }
      }
    };
    var d1 = D.diagnose(ctx);
    assert(!d1.healthy, "Doctor should flag malformed profile");
    var res = D.heal(ctx);
    assert(res.healthyAfter, "Profile should be healthy after heal()");
    assertEq(ctx.profiles.learner1.name, "Maya", "Name should be preserved");
    assertEq(ctx.profiles.learner1.mode, "M", "Invalid mode should fall back to M");
    assertEq(ctx.profiles.learner1.xp, 0, "NaN XP should reset to 0");
    assertEq(ctx.profiles.learner1.trophies[0], "Atlas Detective", "Trophies should be preserved");
    assert(typeof ctx.profiles.learner1.sr === "object" && Array.isArray(ctx.profiles.learner1.recent8), "Missing scheduler fields restored");
    done();
  });

  /* 4. Cartridge mechanical repair vs. canon conflict escalation */
  test("Doctor: Auto-fix mechanical cartridge typos and escalate canon conflicts", function (done) {
    var mechanicalBad = {
      id: "mech_test",
      title: "Coccyx Corale Shift",
      engine: "detective",
      series: "XSK",
      grade: "6-8",
      subject: "logic",
      goal: "Ask DritchLyssa at 08:50 and catch the 17:07 gondola.",
      echoLine: new Array(145).join("a"),
      items: [{ id: "m1", q: "Check 18:00 close in Coccyx Corale.", ans: "6:00 PM", wrong: ["5:00 PM"], shelf: "corale#16" }]
    };
    var r1 = D.repairCartridge(mechanicalBad);
    assert(r1.ok, "Mechanical fixes should yield a valid cartridge: " + r1.manualReview.join("; "));
    assert(r1.cart.title === "Coccyx Corale Shift", "Coccyx Corale is written plainly and left as it is");
    assert(r1.cart.goal.indexOf("Dritchlyssa") >= 0, "Dritchlyssa casing fixed");
    assert(r1.cart.goal.indexOf("8:50 AM") >= 0 && r1.cart.goal.indexOf("5:07 PM") >= 0, "Clocks converted to 12-hour AM/PM");
    assert(r1.cart.echoLine.length <= 128, "echoLine trimmed to <= 128 chars");
    assert(r1.cart.items[0].failRule.length > 0, "Missing failRule backfilled");

    /* Canon conflicts must escalate to manualReview (Rule 8: never settle silently) */
    var canonBad = JSON.parse(JSON.stringify(C.DEFAULT_CARTRIDGES[0]));
    canonBad.goal = "Julian said he hit Static Choir Hounds weak to darkness.";
    var r2 = D.repairCartridge(canonBad);
    assert(!r2.ok, "Canon conflicts must remain invalid until reviewed");
    assert(r2.manualReview.length >= 2, "Expected both Julian pronoun and Darkness element escalated");
    done();
  });

  /* 5. Worker desync, hang timeout watchdog, and NaN quarantine */
  test("Doctor: Recover desynced worker, hung inference timeout, and NaN output", function (done) {
    B.EchoWorker.loaded = true;
    B.EchoWorker.worker = null;
    B.EchoWorker.localCore = null;
    var h = D.heal({});
    assert(h.healthyAfter && !B.EchoWorker.loaded, "Desynced worker should reset cleanly");

    /* Inject a mock think() that hangs on 'hang' and emits NaN on 'nan', then attach Watchdog */
    B.EchoWorker.think = function (q, creat, cb) {
      if (q === "hang") return; // never calls back
      if (q === "nan") { cb(null, { text: "bad", acts: [0, NaN, 0, 0], conf: NaN, lps: 1 }); return; }
      cb(null, { text: "ok", acts: [0.5, 0.5, 0.5, 0.5], conf: 0.9, lps: 10 });
    };
    D.Watchdog.attach({ timeoutMs: 45 });

    B.EchoWorker.think("hang", 0, function (err, res) {
      assert(!err && res && res.recovered === true, "Hung worker call should auto-recover via timeout");
      B.EchoWorker.think("nan", 0, function (err2, res2) {
        assert(!err2 && res2 && res2.recovered === true, "NaN worker output should be quarantined and recovered");
        done();
      });
    });
  });

  /* 6. FPS Governor enables Potato Mode after 10 slow frames */
  test("Doctor: FPS Governor enables Potato Mode after 10 slow frames and logs audit events", function (done) {
    D.Watchdog.potatoMode = false;
    D.Watchdog.slowStreak = 0;
    for (var i = 0; i < 9; i++) assertEq(D.Watchdog.noteFrame(75), false, "Should not trigger before 10 frames");
    assertEq(D.Watchdog.noteFrame(75), true, "Should activate Potato Mode on 10th slow frame");
    assert(D.getLog().length > 0, "Audit log should record repair events");
    done();
  });

  /* Runner */
  var passed = 0, failed = 0, idx = 0;
  function next() {
    if (idx >= tests.length) {
      console.log("\n=== DOCTOR SUITE: " + passed + " passed, " + failed + " failed ===");
      if (isNode) process.exit(failed > 0 ? 1 : 0);
      return;
    }
    var cur = tests[idx++];
    var doneFlag = false;
    function finish(err) {
      if (doneFlag) return;
      doneFlag = true;
      if (err) { failed++; console.log("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
      else { passed++; console.log("[PASS] " + cur.name); }
      setTimeout(next, 0);
    }
    try { cur.fn(function (err) { finish(err); }); } catch (e) { finish(e); }
  }
  console.log("=== EVELYN SELF-DIAGNOSTICS & AUTO-REPAIR TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
