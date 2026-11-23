/* evelyn_director.js - Reactive Cross-Game World Director + Emotive Cinematography
   & 5-Point Framing Auditor for all 78 Evelyn Cartridges.
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    if (!root.EvelynBackend) require("./evelyn_backend.js");
    if (!root.EvelynEvolution) require("./evelyn_evolution.js");
    if (!root.EvelynSuite78) require("./evelyn_suite_78.js");
    if (!root.EvelynVoiceGuard) require("./evelyn_voice_guard.js");
  }

  var B = root.EvelynBackend;
  var E = root.EvelynEvolution;
  var S = root.EvelynSuite78;
  var VG = root.EvelynVoiceGuard;

  /* =========================================================================
     1. PERSISTENT REACTIVE WORLD STATE (SHARED ACROSS ALL 78 CARTRIDGES)
     ========================================================================= */
  function createWorldState(saved) {
    var base = {
      weatherBand: "calm",     // calm | high_wind | frost_spike | warm_updraft
      choirVoices: 0,          // 0..7 from #1 Static Choir Tune-Up
      tillSurplus: 0,          // balanced days in #21 Kaizo Trillhelm Shift
      unlockedPlaces: [],      // places discovered in Atlas / Field Guide / Rule Writer
      discoveredRules: [],     // place rules learned across doors
      activeConsequences: [],  // ripple notes injected into subsequent cartridges
      recentOutcomes: []       // last 20 game events
    };
    if (saved && typeof saved === "object") {
      for (var k in saved) base[k] = saved[k];
    }
    return base;
  }

  /* Record what happened in any cartridge and compute world ripples for the other 77 */
  function recordGameEvent(world, profile, cart, eventObj) {
    eventObj = eventObj || {};
    var streak = eventObj.streak || 0;
    var won = !!eventObj.won;
    var subject = eventObj.subject || (cart ? cart.subject : "general");
    var speaker = eventObj.speaker || "evelyn";

    world.recentOutcomes.push({
      cartId: cart ? cart.id : "unknown",
      title: cart ? cart.title : "Unknown",
      won: won,
      streak: streak,
      subject: subject,
      at: Date.now()
    });
    if (world.recentOutcomes.length > 20) world.recentOutcomes.shift();

    var ripple = null;
    if (cart) {
      /* Cross-cartridge causal chains */
      if (cart.id === "static_choir_tune_up" && won) {
        world.choirVoices = Math.min(7, world.choirVoices + 1);
        ripple = {
          source: cart.id,
          affects: ["marimba_staircase", "third_verse_hum_trio", "dune_chorus_sand_notes", "rehearsal_vault"],
          note: "Spire choir now has " + world.choirVoices + " tuned Hound voice(s). Music doors gain bonus harmony cues.",
          q: "Choir ripple: " + world.choirVoices + " Hound voices tuned. How many more to reach all 7 bands?",
          ans: String(7 - world.choirVoices),
          wrong: [String(Math.max(0, 6 - world.choirVoices)), String(world.choirVoices), "8"],
          failRule: "7 bands minus " + world.choirVoices + " tuned equals " + (7 - world.choirVoices) + " left."
        };
      } else if ((cart.id === "ice_line_survey" || cart.id === "the_long_climb") && won) {
        world.weatherBand = streak >= 3 ? "warm_updraft" : "frost_spike";
        ripple = {
          source: cart.id,
          affects: ["vent_skiff_to_the_hollow", "frost_loop_caravan", "slide_rule_sled", "soup_cart_timetable"],
          note: "Caldera band shifted to " + world.weatherBand.replace("_", " ") + " after your survey.",
          q: "Caldera weather is now " + world.weatherBand.replace("_", " ") + ". Wall snow still starts at what elevation?",
          ans: "17,000 ft",
          wrong: ["22,000 ft", "25,000 ft", "9,000 ft"],
          failRule: "Snowline on the Caldera wall starts at 17,000 ft."
        };
      } else if (cart.id === "kaizo_trillhelm_shift" && won) {
        world.tillSurplus += 1;
        ripple = {
          source: cart.id,
          affects: ["print_counter_studio", "whale_pond_ledger", "concourse_kiosk_table_reader", "ember_diner_batch_plans"],
          note: "Kaizo Trillhelm balanced " + world.tillSurplus + " shift(s). Print Counter unlocked a fresh order.",
          q: "Kaizo Trillhelm closed at 6:00 PM with " + world.tillSurplus + " balanced shift(s). Shop opens for 1 hour at 5:00 PM. How many minutes?",
          ans: "60 minutes",
          wrong: ["30 minutes", "45 minutes", "90 minutes"],
          failRule: "From 5:00 PM to 6:00 PM is 60 minutes."
        };
      } else if (cart.id === "hollow_hive_field_guide" || cart.id === "atlantis_atlas_tracer" || cart.id === "the_rule_of_the_place") {
        var place = eventObj.place || "Saltsea Arcade Dunes";
        if (world.unlockedPlaces.indexOf(place) < 0) world.unlockedPlaces.push(place);
        ripple = {
          source: cart.id,
          affects: ["where_the_parcel_hiccuped", "zeep_zorp_quiz_show", "who_moved_the_plinth", "registry_rule_writer"],
          note: "Field report logged " + place + " into the shared Concourse atlas.",
          q: "Your atlas report unlocked " + place + ". How many places are on your active map now?",
          ans: String(world.unlockedPlaces.length),
          wrong: [String(world.unlockedPlaces.length + 2), "0", "99"],
          failRule: "Your atlas now holds " + world.unlockedPlaces.length + " logged place(s)."
        };
      } else if (!won) {
        /* Misses shift upcoming pacing and feed a gentle review ripple */
        ripple = {
          source: cart.id,
          affects: ["zeep_zorp_quiz_show", cart.id],
          note: "Next round slows down and surfaces the " + subject + " rule card early."
        };
      }
    }

    if (ripple) {
      world.activeConsequences.push(ripple);
      if (world.activeConsequences.length > 8) world.activeConsequences.shift();
    }

    /* Sync KV21 prefix for TNY2 so the neural Echo knows active world state */
    if (E && profile && cart) {
      E.writeHandoff(profile, cart, streak, subject);
      var kvPrefix = ("W:" + world.weatherBand.slice(0, 4) + "|C=" + world.choirVoices + "|M=" + (profile.mode || "M")).slice(0, 24);
      if (B && B.EchoWorker && B.EchoWorker.loaded) B.EchoWorker.pinPrefix(kvPrefix);
    }

    var rawComment = won
      ? (cart.title + " shift finished with streak " + streak + ". " + (ripple ? ripple.note : "Shelf updated."))
      : ("Try " + cart.title + " once more. Check the " + subject + " shelf rule first.");

    return {
      world: world,
      ripple: ripple,
      directorLine: VG.clean(rawComment, { speaker: speaker, isEcho: true })
    };
  }

  /* Evolve any of the 78 cartridges with both Curriculum Evolution AND live WorldState ripples */
  function buildReactiveCartridge(cart, profile, world, seed) {
    var evolved = E.evolveCartridge(cart, profile, seed || 2026, 24);
    var modifiers = {
      speedMult: world.weatherBand === "high_wind" ? 1.15 : (world.weatherBand === "frost_spike" ? 0.9 : 1.0),
      harmonyBonus: world.choirVoices,
      weatherBand: world.weatherBand,
      activeRipples: []
    };

    /* Inject matching cross-game consequence items into this cartridge's live deck */
    for (var i = world.activeConsequences.length - 1; i >= 0; i--) {
      var rp = world.activeConsequences[i];
      if (rp.affects && rp.affects.indexOf(cart.id) >= 0) {
        modifiers.activeRipples.push(rp.note);
        if (rp.q && rp.ans) {
          evolved.items.unshift({
            id: "world_" + rp.source + "_" + i,
            shelf: "world:" + rp.source,
            tag: "world_consequence",
            q: VG.clean(rp.q, { trackHistory: false }),
            ans: rp.ans,
            wrong: rp.wrong || ["0", "1", "2"],
            failRule: VG.clean(rp.failRule, { trackHistory: false })
          });
        }
      }
    }

    /* Clean cartridge Echo line through VoiceGuard */
    evolved.echoLine = VG.clean(evolved.echoLine, { isEcho: true, trackHistory: false });
    evolved.worldModifiers = modifiers;
    evolved.cameraPlan = pickCameraShot({ streak: 0, isBoss: false, missed: false, tension: 0.2, screenDir: "right" });
    return evolved;
  }

  /* =========================================================================
     2. EMOTIVE CINEMATOGRAPHY & 5-POINT FRAMING ENGINE (CineCamera)
        Follows The Visual Grammar of Emotion & Camera Framing Dos/Don'ts.
     ========================================================================= */
  var SHOT_PRESETS = {
    establish: {
      name: "establish", focalMm: 35, shotSize: "wide", movement: "dolly",
      colorTemp: "neutral", dofBlur: 0.1, shake: 0, holdMs: 0, audioHush: false
    },
    flow: {
      name: "flow", focalMm: 45, shotSize: "medium", movement: "steadicam",
      colorTemp: "warm_amber", dofBlur: 0.35, shake: 0, holdMs: 0, audioHush: false
    },
    pressure: {
      name: "pressure", focalMm: 135, shotSize: "medium_closeup", movement: "static_tripod",
      colorTemp: "cool_cyan", dofBlur: 0.7, shake: 0, holdMs: 0, audioHush: false
    },
    urgency: {
      name: "urgency", focalMm: 24, shotSize: "closeup", movement: "handheld",
      colorTemp: "cool_cyan", dofBlur: 0.45, shake: 3.5, holdMs: 0, audioHush: false
    },
    yamada_detail: {
      name: "yamada_detail", focalMm: 85, shotSize: "insert_detail", movement: "static_tripod",
      colorTemp: "neutral", dofBlur: 0.85, shake: 0, holdMs: 450, audioHush: true
    },
    dezaki_postcard: {
      name: "dezaki_postcard", focalMm: 50, shotSize: "closeup", movement: "freeze_harmony",
      colorTemp: "pastel_memory", dofBlur: 0.2, shake: 0, holdMs: 700, audioHush: true
    }
  };

  /* Choose subjective shot from live gameplay emotion (no unmotivated shaky-cam!) */
  function pickCameraShot(ctx) {
    ctx = ctx || {};
    var preset;
    if (ctx.setPieceWin) preset = SHOT_PRESETS.dezaki_postcard;
    else if (ctx.missed) preset = SHOT_PRESETS.yamada_detail;
    else if (ctx.isBoss && (ctx.tension || 0) >= 0.75) preset = SHOT_PRESETS.urgency;
    else if (ctx.isBoss) preset = SHOT_PRESETS.pressure;
    else if ((ctx.streak || 0) >= 3) preset = SHOT_PRESETS.flow;
    else preset = SHOT_PRESETS.establish;

    var dir = ctx.screenDir || "right";
    /* Place subject on opposite third so gaze/movement has open Lead Room */
    var subjectX = ctx.shortSideIntentional
      ? (dir === "right" ? 0.78 : 0.22)
      : (dir === "right" ? 0.33 : 0.67);

    return {
      preset: preset.name,
      focalMm: preset.focalMm,
      shotSize: preset.shotSize,
      movement: preset.movement,
      colorTemp: preset.colorTemp,
      dofBlur: preset.dofBlur,
      shake: preset.shake,
      holdMs: preset.holdMs,
      audioHush: preset.audioHush,
      eyeY: 0.33,
      headTopY: preset.shotSize === "closeup" ? -0.04 : 0.14,
      cropAt: preset.shotSize === "wide" ? "full" : (preset.shotSize === "closeup" ? "shoulders" : "waist"),
      subjectX: subjectX,
      facing: dir,
      screenDir: dir,
      shortSideIntentional: !!ctx.shortSideIntentional,
      angleDeg: preset.name === "pressure" ? 35 : (preset.name === "urgency" ? 65 : 0),
      horizonTiltDeg: 0,
      bgMergerX: -1,
      dirtyForeground: preset.name === "flow" || preset.name === "pressure"
    };
  }

  var BANNED_JOINT_CROPS = { ankles:1, knees:1, hips:1, wrists:1, elbows:1, neck:1 };

  /* 5-Second Pre-Roll Frame Audit (Headroom, Joints, Lead Room, Horizon/BG, 180°/30° Continuity) */
  function auditFrame(frame, prevFrame) {
    var issues = [];
    if (!frame) return { ok: false, issues: ["Missing frame specification."] };

    /* 1. Eyes & Headroom */
    if (frame.eyeY < 0.22 || frame.eyeY > 0.44) {
      issues.push("Eyes should sit near the upper third (0.22..0.44), got " + frame.eyeY);
    }
    if (frame.shotSize !== "closeup" && frame.shotSize !== "extreme_closeup") {
      if (frame.headTopY >= 0 && frame.headTopY < 0.04) {
        issues.push("Headroom tangent: top of head grazes frame edge (" + frame.headTopY + ").");
      }
      if (frame.headTopY > 0.42 && !frame.intentionalScaleDrop) {
        issues.push("Excessive dead headroom above subject (" + frame.headTopY + ").");
      }
    }

    /* 2. Anatomy: Never slice through a joint */
    if (BANNED_JOINT_CROPS[String(frame.cropAt || "").toLowerCase()]) {
      issues.push("Joint slice: never crop directly through " + frame.cropAt + ".");
    }

    /* 3. Lead Room / Looking Room (unless intentional Short-Siding) */
    if (!frame.shortSideIntentional) {
      if (frame.facing === "right" && frame.subjectX > 0.62) {
        issues.push("Missing lead/looking room: facing right against right edge (x=" + frame.subjectX + ").");
      }
      if (frame.facing === "left" && frame.subjectX < 0.38) {
        issues.push("Missing lead/looking room: facing left against left edge (x=" + frame.subjectX + ").");
      }
    }

    /* 4. Horizon Level & Background Mergers */
    var absTilt = Math.abs(frame.horizonTiltDeg || 0);
    if (absTilt > 0 && absTilt < 12) {
      issues.push("Accidental slight Dutch tilt (" + frame.horizonTiltDeg + " deg). Keep 0 deg or commit >= 15 deg.");
    }
    if (typeof frame.bgMergerX === "number" && frame.bgMergerX >= 0 && Math.abs(frame.bgMergerX - frame.subjectX) < 0.04) {
      issues.push("Background merger: pole/object sprouts behind subject head at x=" + frame.bgMergerX + ".");
    }

    /* 5. Continuity: 180-degree rule & 30-degree jump-cut rule */
    if (prevFrame) {
      if (prevFrame.screenDir && frame.screenDir && prevFrame.screenDir !== frame.screenDir && !frame.axisBridge) {
        issues.push("180-degree violation: flipped screen direction without a visual bridge.");
      }
      var angleDiff = Math.abs((frame.angleDeg || 0) - (prevFrame.angleDeg || 0));
      if (frame.shotSize === prevFrame.shotSize && angleDiff > 0 && angleDiff < 30) {
        issues.push("30-degree jump-cut risk: same shot size (" + frame.shotSize + ") with only " + angleDiff + " deg shift.");
      }
    }

    return { ok: issues.length === 0, issues: issues };
  }

  /* Lightweight ES5 Canvas Satsuei Compositor (color temperature, dirty framing, Dezaki freeze) */
  function renderStageFX(ctx, w, h, cam) {
    if (!ctx || !cam) return;
    ctx.save();
    /* Color temperature wash */
    if (cam.colorTemp === "warm_amber") {
      ctx.fillStyle = "rgba(252, 216, 56, 0.08)";
      ctx.fillRect(0, 0, w, h);
    } else if (cam.colorTemp === "cool_cyan") {
      ctx.fillStyle = "rgba(40, 228, 252, 0.09)";
      ctx.fillRect(0, 0, w, h);
    } else if (cam.colorTemp === "pastel_memory") {
      /* Osamu Dezaki "Postcard Memory" pastel freeze border + high-contrast rim */
      ctx.fillStyle = "rgba(252, 72, 232, 0.14)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#fcd838";
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    }
    /* Dirty framing foreground edge silhouettes for 3D depth */
    if (cam.dirtyForeground) {
      ctx.fillStyle = "rgba(4, 4, 28, 0.55)";
      ctx.fillRect(0, 0, 14, h);
      ctx.fillRect(w - 14, 0, 14, h);
    }
    /* Shallow-DOF vignette on high-pressure telephoto or Yamada detail holds */
    if ((cam.dofBlur || 0) >= 0.65) {
      ctx.strokeStyle = "rgba(4, 4, 28, 0.55)";
      ctx.lineWidth = 18;
      ctx.strokeRect(0, 0, w, h);
    }
    ctx.restore();
  }

  root.EvelynDirector = {
    SHOT_PRESETS: SHOT_PRESETS,
    createWorldState: createWorldState,
    recordGameEvent: recordGameEvent,
    buildReactiveCartridge: buildReactiveCartridge,
    pickCameraShot: pickCameraShot,
    auditFrame: auditFrame,
    renderStageFX: renderStageFX
  };
})(typeof window !== "undefined" ? window : global);
