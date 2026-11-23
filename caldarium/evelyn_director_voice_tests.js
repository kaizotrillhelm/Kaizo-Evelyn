/* evelyn_director_voice_tests.js - Comprehensive ES5 Test Suite for
   EvelynVoiceGuard (AI-Tic Detection/Cleaning + Canon Voices),
   EvelynDirector (Cross-Game Reactive World), and CineCamera (Framing Audit).
   Run in Node.js: node evelyn_director_voice_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_cartridges.js");
    require("./evelyn_evolution.js");
    require("./evelyn_suite_78.js");
    require("./evelyn_voice_guard.js");
    require("./evelyn_director.js");
  }

  var B = root.EvelynBackend;
  var S = root.EvelynSuite78;
  var VG = root.EvelynVoiceGuard;
  var Dir = root.EvelynDirector;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. VoiceGuard detects all major AI writing & dialogue tic families */
  test("VoiceGuard: Detects syntactic, lexical, UX, artifact, and dialogue AI tics", function (done) {
    var samples = [
      ["This isn't just about math, it's about survival.", "negative_parallelism"],
      ["It brings clarity, precision, and alignment.", "rule_of_three_abstract"],
      ["The result? Fast code.", "staccato_qa"],
      ["The team finished early, highlighting strong morale.", "trailing_participle"],
      ["Written for everyone from beginners to experts.", "false_range"],
      ["Whether you're a pro or a beginner, check the clock.", "everyone_hook"],
      ["Design sits at the intersection of art and math.", "spatial_crutch"],
      ["No fees. No delays. Just speed.", "fragment_triplet"],
      ["It stands as a testament to local craft.", "tourism_inflation"],
      ["Studies show learners like short loops.", "vague_attribution"],
      ["See https://example.com?utm_source=chatgpt.com [Company Name]", "chatbot_artifact"],
      ["Oops! Something went wrong. Please try again later!", "apologetic_ux"],
      ["Her knuckles turned white and she smelled ozone.", "somatic_cliche"],
      ["A flicker of something crossed his face.", "emotional_beat_pad"],
      ["Stop now, she said, her voice laced with quiet fury.", "voice_laced_with"],
      ["I need to set a boundary while processing my emotions.", "therapy_speak"],
      ["\"Wait here,\" she said, checking the latch.", "tag_action_lock"],
      ["Open? What do you mean, open?", "parroting_echo"],
      ["**Key Point:** Use a loop.", "markdown_leak"]
    ];

    for (var i = 0; i < samples.length; i++) {
      var res = VG.audit(samples[i][0]);
      assert(!res.clean, "Failed to flag sample #" + i + ": " + samples[i][0]);
      var found = false;
      for (var j = 0; j < res.hits.length; j++) if (res.hits[j].id === samples[i][1]) found = true;
      assert(found, "Expected rule '" + samples[i][1] + "' for: " + samples[i][0]);
    }
    done();
  });

  /* 2. VoiceGuard cleans AI slop into direct, plain, actionable prose */
  test("VoiceGuard: Cleans buzzwords, copula avoidance, openers, hedges, UX copy, and UTM leaks", function (done) {
    VG.resetHistory();
    var slop = "Certainly! Let's dive in! Furthermore, it is important to note that this tool serves as a robust tapestry " +
               "that quietly utilizes new methodology, underscoring strong progress. I hope this helps!";
    var cleaned = VG.clean(slop);
    assert(cleaned.indexOf("Certainly") < 0, "Opener remained");
    assert(cleaned.indexOf("dive in") < 0, "Throat-clearing remained");
    assert(cleaned.indexOf("Furthermore") < 0, "Formal transition remained");
    assert(cleaned.indexOf("serves as") < 0, "Copula avoidance remained");
    assert(cleaned.indexOf("quietly") < 0, "Empty adverb remained");
    assert(cleaned.indexOf("utilizes") < 0, "Latinate verb remained");
    assert(cleaned.indexOf("underscoring") < 0, "Trailing participle remained");
    assert(cleaned.indexOf("hope this helps") < 0, "Closer remained");

    var ux = VG.clean("Oops! Something went wrong. Please try again later!");
    assert(ux.indexOf("Oops") < 0 && ux.indexOf("Action failed.") >= 0, "Apologetic UX not rewritten: " + ux);

    var hook = VG.clean("Whether you're a beginner or a veteran, check the dial.");
    assert(hook.indexOf("Whether") < 0 && hook.indexOf("Check the dial.") === 0, "Everyone-hook not chopped: " + hook);

    var utm = VG.clean("Read https://evelyn.local/page?utm_source=chatgpt.com today.");
    assert(utm.indexOf("utm_source") < 0, "UTM leak remained: " + utm);
    done();
  });

  /* 3. Seamslop frequency tracking catches repeated pet words across consecutive turns */
  test("VoiceGuard: Tracks and flags seamslop noun repetition across consecutive Echo turns", function (done) {
    VG.resetHistory();
    VG.clean("Check the architecture of the bridge.");
    VG.clean("The architecture holds the load.");
    VG.clean("Adjust the architecture on track two.");
    var auditRes = VG.audit("Review the architecture before launch.", { checkSeamslop: true });
    var found = false;
    for (var i = 0; i < auditRes.hits.length; i++) if (auditRes.hits[i].id === "seamslop") found = true;
    assert(found, "Seamslop detector failed to flag 'architecture' repeated 4 times");
    done();
  });

  /* 4. Canon Voice Sheet Enforcer preserves character differentiation */
  test("VoiceGuard: Enforces Dritchlyssa, Vera, Dr Candor, Evelyn, Julian & 128-char Echo cap", function (done) {
    var dr = VG.clean("I don't think it's open, please wait.", { speaker: "dritchlyssa" });
    assert(dr.indexOf("don't") < 0 && dr.indexOf("it's") < 0 && dr.indexOf("please") < 0, "Dritchlyssa voice failed: " + dr);

    var ve = VG.clean("How refreshing!! Exact weight!", { speaker: "vera" });
    assert(ve.indexOf("!") < 0, "Vera exclamation mark remained: " + ve);

    var dc = VG.clean("No, sorry, try the next card.", { speaker: "dr candor" });
    assert(!/\b(no|sorry)\b/i.test(dc) && dc.indexOf("Zeep zorp, team.") >= 0, "Dr Candor voice failed: " + dc);

    var ev = VG.clean("I don't know where it went.", { speaker: "evelyn" });
    assert(ev.indexOf("don't know") < 0 && ev.indexOf("Okay.") >= 0, "Evelyn voice failed: " + ev);

    var ju = VG.clean("Julian moved the box because he liked the spot.", { speaker: "julian" });
    assert(!/\bhe\b/i.test(ju), "Julian pronoun remained: " + ju);

    var longLine = VG.clean(new Array(180).join("a"), { isEcho: true });
    assert(longLine.length <= 128, "Echo cap failed: " + longLine.length);
    done();
  });

  /* 5. Full 78-Cartridge AI-Tic Audit */
  test("Suite 78 Tic Sweep: All 78 cartridges pass EvelynVoiceGuard with zero high-severity AI tics", function (done) {
    VG.resetHistory();
    for (var i = 0; i < S.CARTRIDGES.length; i++) {
      var c = S.CARTRIDGES[i];
      var textBlock = c.title + ". " + c.goal + " " + c.echoLine + " " + c.setPiece;
      var rep = VG.audit(textBlock);
      for (var h = 0; h < rep.hits.length; h++) {
        assert(rep.hits[h].sev !== "high", "Cartridge #" + c.num + " (" + c.id + ") hit high-sev tic '" + rep.hits[h].id + "': " + textBlock);
      }
    }
    done();
  });

  /* 6. Reactive World Director changes downstream games across Concourse doors */
  test("Director: Outcomes in one cartridge ripple into and mutate other cartridges cleanly", function (done) {
    VG.resetHistory();
    var world = Dir.createWorldState();
    var profile = { name: "Maya", mode: "M", xp: 40, trophies: [], sr: {}, recent8: [1,1,1,1], focusWeights: {}, recentLessons: [] };

    /* Win #1 Static Choir Tune-Up -> adds choir voice -> ripples into #47 Marimba Staircase */
    var r1 = Dir.recordGameEvent(world, profile, S.getById("static_choir_tune_up"), { won: true, streak: 4, speaker: "evelyn" });
    assertEq(world.choirVoices, 1, "Choir voice count should increment");
    assert(VG.audit(r1.directorLine).clean, "Director line had AI tic: " + r1.directorLine);

    /* Win #5 The Long Climb -> shifts weatherBand -> ripples into #59 Slide Rule Sled */
    Dir.recordGameEvent(world, profile, S.getById("the_long_climb"), { won: true, streak: 2, speaker: "tsubaki" });
    assertEq(world.weatherBand, "frost_spike", "Weather band should shift to frost_spike");

    var marimba = Dir.buildReactiveCartridge(S.getById("marimba_staircase"), profile, world, 101);
    assertEq(marimba.worldModifiers.harmonyBonus, 1, "Marimba Staircase should receive choir harmony bonus");
    assertEq(marimba.items[0].tag, "world_consequence", "Choir consequence item should inject into Marimba deck");

    var sled = Dir.buildReactiveCartridge(S.getById("slide_rule_sled"), profile, world, 202);
    assertEq(sled.worldModifiers.weatherBand, "frost_spike", "Slide Rule Sled should react to frost_spike");
    assertEq(sled.worldModifiers.speedMult, 0.9, "Frost spike should adjust sled speed multiplier");
    done();
  });

  /* 7. Cinematography Camera & 5-Point Framing Auditor */
  test("CineCamera: Shot presets, Dezaki Postcard, Yamada Detail & 5-point framing rules", function (done) {
    var flow = Dir.pickCameraShot({ streak: 4, screenDir: "right" });
    assertEq(flow.preset, "flow", "Streak >= 3 should pick smooth flow preset");
    assertEq(flow.shake, 0, "Flow preset must have zero unmotivated shaky-cam");
    assert(Dir.auditFrame(flow).ok, "Flow frame failed 5-point audit: " + Dir.auditFrame(flow).issues.join("; "));

    var postcard = Dir.pickCameraShot({ setPieceWin: true, screenDir: "right" });
    assertEq(postcard.preset, "dezaki_postcard", "Set-piece win should trigger Dezaki Postcard Memory");
    assert(postcard.audioHush && postcard.holdMs >= 500, "Postcard must hold with sudden audio hush");

    var detail = Dir.pickCameraShot({ missed: true, screenDir: "right" });
    assertEq(detail.preset, "yamada_detail", "Miss should trigger Yamada detail hold");

    /* Framing violations must be caught */
    var badJoint = Dir.pickCameraShot({ streak: 1, screenDir: "right" }); badJoint.cropAt = "knees";
    assert(!Dir.auditFrame(badJoint).ok, "Joint slice at knees must fail audit");

    var badTilt = Dir.pickCameraShot({ streak: 1, screenDir: "right" }); badTilt.horizonTiltDeg = 2.5;
    assert(!Dir.auditFrame(badTilt).ok, "Accidental 2.5-deg Dutch tilt must fail audit");

    var badMerger = Dir.pickCameraShot({ streak: 1, screenDir: "right" }); badMerger.bgMergerX = badMerger.subjectX;
    assert(!Dir.auditFrame(badMerger).ok, "Background pole sprouting from head must fail audit");

    var badLead = Dir.pickCameraShot({ streak: 1, screenDir: "right" }); badLead.subjectX = 0.85; badLead.shortSideIntentional = false;
    assert(!Dir.auditFrame(badLead).ok, "Smashing nose against right edge without intent must fail");
    badLead.shortSideIntentional = true;
    assert(Dir.auditFrame(badLead).ok, "Intentional short-siding exception should pass");

    /* Continuity checks: 180-degree flip & 30-degree jump cut */
    var shotA = Dir.pickCameraShot({ streak: 3, screenDir: "right" });
    var shotFlip = Dir.pickCameraShot({ streak: 3, screenDir: "left" });
    assert(!Dir.auditFrame(shotFlip, shotA).ok, "180-degree flip without axisBridge must fail");
    shotFlip.axisBridge = true;
    assert(Dir.auditFrame(shotFlip, shotA).ok, "180-degree flip with visual bridge should pass");

    var jumpCut = Dir.pickCameraShot({ streak: 3, screenDir: "right" });
    jumpCut.angleDeg = shotA.angleDeg + 12;
    assert(!Dir.auditFrame(jumpCut, shotA).ok, "12-degree shift at same shot size must fail 30-degree rule");
    done();
  });

  /* 8. ES5 Syntax Compatibility Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax or regex lookbehinds in voice guard and director", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_voice_guard.js", "evelyn_director.js", "evelyn_director_voice_tests.js"];
      var banned = [
        [/\bArray\.from\s*\(/, "Array.from"],
        [/\bnew\s+Map\s*\(/, "new Map"],
        [/\bnew\s+Set\s*\(/, "new Set"],
        [new RegExp("=" + ">"), "arrow function"],
        [/\(\?</, "ES2018 regex lookbehind"]
      ];
      for (var i = 0; i < files.length; i++) {
        var fp = path.join(__dirname, files[i]);
        if (!fs.existsSync(fp)) continue;
        var src = fs.readFileSync(fp, "utf8");
        for (var j = 0; j < banned.length; j++) {
          assert(!banned[j][0].test(src), files[i] + " failed ES5 guard: " + banned[j][1]);
        }
      }
      done();
    });
  }

  /* Runner */
  function runAll(logFn, onDone) {
    logFn = logFn || function (s) { console.log(s); };
    var pass = 0, fail = 0, idx = 0, t0 = Date.now();
    function next() {
      if (idx >= tests.length) {
        logFn("\n=== DIRECTOR & VOICE GUARD RESULT: " + pass + " passed, " + fail + " failed (" + (Date.now() - t0) + " ms) ===");
        if (onDone) onDone(pass, fail);
        if (isNode) process.exit(fail > 0 ? 1 : 0);
        return;
      }
      var cur = tests[idx++], ended = false;
      function done(err) {
        if (ended) return; ended = true;
        if (err) { fail++; logFn("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
        else { pass++; logFn("[PASS] " + cur.name); }
        setTimeout(next, 0);
      }
      try { cur.fn(done); } catch (e) { done(e); }
    }
    logFn("=== EVELYN VOICE GUARD, REACTIVE DIRECTOR & CINEMATOGRAPHY TESTS (" + tests.length + ") ===");
    next();
  }

  if (isNode) runAll();
  else root.EvelynDirectorVoiceTests = { runAll: runAll };
})(typeof window !== "undefined" ? window : global);
