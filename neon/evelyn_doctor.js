/* evelyn_doctor.js - Offline Self-Diagnostics, Watchdogs & Deterministic Auto-Repair
   ES5 compatible. Works in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    if (!root.EvelynBackend) require("./evelyn_backend.js");
    if (!root.EvelynCartridges) require("./evelyn_cartridges.js");
  }

  var B = root.EvelynBackend;
  var C = root.EvelynCartridges;

  /* Ring buffer of the last 30 diagnostic / repair events (stored locally) */
  var logBuffer = [];
  function recordEvent(level, subsystem, msg) {
    var entry = { time: new Date().toISOString(), level: level, subsystem: subsystem, msg: msg };
    logBuffer.push(entry);
    if (logBuffer.length > 30) logBuffer.shift();
    return entry;
  }

  /* =========================================================================
     1. CARTRIDGE DOCTOR (AUTO-FIXES MECHANICAL BUGS, ESCALATES CANON CONFLICTS)
     ========================================================================= */
  function fixStringMechanical(str, fixes) {
    var s = String(str);
    /* Convert 24-hour afternoon times (13:00..23:59) -> 12-hour PM */
    var s1 = s.replace(/\b(1[3-9]|2[0-3]):([0-5]\d)\b/g, function (_, hh, mm) {
      fixes.push("Converted 24-hour clock " + hh + ":" + mm + " -> " + (parseInt(hh, 10) - 12) + ":" + mm + " PM");
      return (parseInt(hh, 10) - 12) + ":" + mm + " PM";
    });
    /* Convert 00:00..09:59 without AM/PM -> 12-hour AM */
    var s2 = s1.replace(/\b0(\d):([0-5]\d)\b(?!\s*(?:AM|PM))/gi, function (_, h, mm) {
      var hr = (h === "0") ? "12" : h;
      fixes.push("Converted clock 0" + h + ":" + mm + " -> " + hr + ":" + mm + " AM");
      return hr + ":" + mm + " AM";
    });
    /* Spelling of Dritchlyssa (lower-case l) */
    var s4 = s2.replace(/DritchLyssa/g, function () {
      fixes.push("Fixed lower-case l in Dritchlyssa");
      return "Dritchlyssa";
    });
    return s4;
  }

  function repairCartridge(cart) {
    var fixes = [], manual = [];
    if (!cart || typeof cart !== "object") {
      return { cart: null, fixes: [], manualReview: ["Cartridge JSON is unreadable."] };
    }
    var copy = JSON.parse(JSON.stringify(cart));

    /* Backfill missing structural metadata */
    if (!copy.id) { copy.id = "custom_" + Date.now(); fixes.push("Added missing id."); }
    if (!copy.title) { copy.title = "Untitled Cartridge"; fixes.push("Added missing title."); }
    if (!copy.engine) { copy.engine = "detective"; fixes.push("Defaulted missing engine to 'detective'."); }
    if (!copy.series) { copy.series = "Concourse"; fixes.push("Defaulted missing series to 'Concourse'."); }
    if (!copy.grade) { copy.grade = "6-8"; fixes.push("Defaulted missing grade to '6-8'."); }
    if (!copy.subject) { copy.subject = "general"; fixes.push("Defaulted missing subject to 'general'."); }
    if (!copy.goal) { copy.goal = "Complete the shelf questions."; fixes.push("Added default goal."); }
    if (!copy.echoLine) { copy.echoLine = "Echo: Check the shelf rule and try again."; fixes.push("Added default echoLine."); }

    /* Mechanical text repairs across top-level fields */
    copy.title = fixStringMechanical(copy.title, fixes);
    copy.goal = fixStringMechanical(copy.goal, fixes);
    copy.echoLine = fixStringMechanical(copy.echoLine, fixes);
    if (copy.echoLine.length > 128) {
      copy.echoLine = copy.echoLine.slice(0, 125) + "...";
      fixes.push("Trimmed echoLine to 128 characters.");
    }

    if (!copy.items || !copy.items.length) {
      manual.push("Cartridge has zero items in items[]; author must supply questions.");
    } else {
      for (var i = 0; i < copy.items.length; i++) {
        var it = copy.items[i];
        if (!it.id) { it.id = copy.id + "_" + i; fixes.push("Added missing item id #" + i); }
        if (it.q) it.q = fixStringMechanical(it.q, fixes);
        if (it.ans) it.ans = fixStringMechanical(it.ans, fixes);
        if (!it.failRule) {
          it.failRule = "Check the rule on shelf " + (it.shelf || "general") + " and try once more.";
          fixes.push("Added fallback teaching failRule on item " + it.id);
        } else {
          it.failRule = fixStringMechanical(it.failRule, fixes);
        }
        if (it.echo && it.echo.length > 128) {
          it.echo = it.echo.slice(0, 125) + "...";
          fixes.push("Trimmed item " + it.id + " echo to 128 characters.");
        }
      }
    }

    /* Re-validate: remaining errors are canon/content conflicts -> escalate, do NOT silently rewrite */
    var check = C.CartridgeValidator.validate(copy);
    for (var e = 0; e < check.errors.length; e++) {
      manual.push(check.errors[e]);
    }
    if (fixes.length) recordEvent("fix", "cartridge", "Repaired " + copy.id + " (" + fixes.length + " mechanical fixes).");
    if (manual.length) recordEvent("warn", "cartridge", "Escalated " + manual.length + " canon conflict(s) in " + copy.id + ".");
    return { cart: copy, ok: check.ok, fixes: fixes, manualReview: manual };
  }

  /* =========================================================================
     2. FULL SYSTEM DIAGNOSTICS (NON-DESTRUCTIVE HEALTH AUDIT)
     ========================================================================= */
  function diagnose(ctx) {
    ctx = ctx || {};
    var issues = [];

    /* Check 1: Storage readiness */
    if (!B.EvelynDB.ready) {
      issues.push({ subsystem: "storage", code: "DB_NOT_OPEN", fixable: true, detail: "EvelynDB has not finished opening." });
    }

    /* Check 2: ShelfLibrary compression integrity & posting bounds */
    var L = B.ShelfLibrary;
    if (!L.rows || L.rows.length === 0) {
      issues.push({ subsystem: "shelves", code: "SHELVES_EMPTY", fixable: true, detail: "ShelfLibrary has 0 records." });
    } else {
      var badRows = 0;
      for (var i = 0; i < L.rows.length; i++) {
        try {
          var dec = B.LZ.decompress(L.rows[i].zF);
          if (!dec) badRows++;
        } catch (err) { badRows++; }
      }
      if (badRows > 0) {
        issues.push({ subsystem: "shelves", code: "SHELF_CORRUPT_ROWS", fixable: true, detail: badRows + " compressed shelf row(s) unreadable." });
      }
      var badPostings = false;
      for (var word in L.postings) {
        var gaps = L.postings[word];
        var acc = 0;
        for (var g = 0; g < gaps.length; g++) {
          acc += gaps[g];
          if (acc < 0 || acc >= L.rows.length) { badPostings = true; break; }
        }
        if (badPostings) break;
      }
      if (badPostings) {
        issues.push({ subsystem: "shelves", code: "POSTINGS_CORRUPT", fixable: true, detail: "Gap-encoded posting list points past rows.length." });
      }
    }

    /* Check 3: Learner Profiles shape */
    if (ctx.profiles) {
      for (var pid in ctx.profiles) {
        var p = ctx.profiles[pid];
        if (!p || typeof p !== "object" || "RADM".indexOf(p.mode || "") < 0 || typeof p.xp !== "number" || !isFinite(p.xp) || !p.sr || !p.recent8) {
          issues.push({ subsystem: "profiles", code: "PROFILE_MALFORMED", key: pid, fixable: true, detail: "Profile '" + pid + "' has missing or invalid fields." });
        }
      }
    }

    /* Check 4: EchoWorker / TNY2 sanity */
    if (B.EchoWorker.loaded && (!B.EchoWorker.meta || !B.EchoWorker.meta.D || (!B.EchoWorker.worker && !B.EchoWorker.localCore))) {
      issues.push({ subsystem: "worker", code: "WORKER_DESYNC", fixable: true, detail: "EchoWorker marked loaded without an active backend." });
    }

    /* Check 5: Cartridges validation */
    if (ctx.cartridges && ctx.cartridges.length) {
      for (var ci = 0; ci < ctx.cartridges.length; ci++) {
        var rep = C.CartridgeValidator.validate(ctx.cartridges[ci]);
        if (!rep.ok) {
          issues.push({ subsystem: "cartridges", code: "CARTRIDGE_INVALID", index: ci, fixable: true, detail: ctx.cartridges[ci].id + ": " + rep.errors.join("; ") });
        }
      }
    }

    return { healthy: issues.length === 0, issues: issues };
  }

  /* =========================================================================
     3. DETERMINISTIC AUTO-HEALER (FIXES DETECTED PROBLEMS SAFELY)
     ========================================================================= */
  function rebuildShelfIndex() {
    var L = B.ShelfLibrary;
    var cleanRows = [];
    var i;
    for (i = 0; i < L.rows.length; i++) {
      try {
        var fact = B.LZ.decompress(L.rows[i].zF);
        var ex = L.rows[i].zE ? B.LZ.decompress(L.rows[i].zE) : "";
        if (fact && fact.length > 0) {
          cleanRows.push({ shelf: L.rows[i].shelf || "general", topic: L.rows[i].topic || "entry", fact: fact, ex: ex });
        }
      } catch (e) {}
    }
    L.rows = [];
    L.postings = Object.create(null);
    L.lru.map = Object.create(null);
    L.lru.order = [];
    if (cleanRows.length === 0) {
      C.seedDefaultShelves();
    } else {
      for (i = 0; i < cleanRows.length; i++) {
        L.add(cleanRows[i].shelf, cleanRows[i].topic, cleanRows[i].fact, cleanRows[i].ex);
      }
    }
    L.persist();
  }

  function healProfile(p, fallbackName) {
    var safe = (p && typeof p === "object") ? p : {};
    return {
      name: typeof safe.name === "string" && safe.name ? safe.name : (fallbackName || "Learner"),
      mode: ("RADM".indexOf(safe.mode || "") >= 0 && safe.mode) ? safe.mode : "M",
      xp: (typeof safe.xp === "number" && isFinite(safe.xp) && safe.xp >= 0) ? safe.xp : 0,
      trophies: (safe.trophies && typeof safe.trophies.push === "function") ? safe.trophies : [],
      sr: (safe.sr && typeof safe.sr === "object") ? safe.sr : {},
      recent8: (safe.recent8 && typeof safe.recent8.push === "function") ? safe.recent8.slice(-8) : []
    };
  }

  function recoverWorkerToLocal(reason) {
    try { if (B.EchoWorker.worker) B.EchoWorker.worker.terminate(); } catch (e) {}
    B.EchoWorker.worker = null;
    B.EchoWorker.loaded = false;
    B.EchoWorker.meta = null;
    /* Fail pending calls cleanly so callers never hang */
    for (var id in B.EchoWorker.pending) {
      var cb = B.EchoWorker.pending[id];
      delete B.EchoWorker.pending[id];
      try { cb(new Error("Recovered worker: " + reason)); } catch (e) {}
    }
    recordEvent("fix", "worker", "Reset worker (" + reason + "); fell back cleanly to Library shelves.");
  }

  function heal(ctx, cb) {
    ctx = ctx || {};
    var diag = diagnose(ctx);
    var fixed = [], manualReview = [];

    for (var i = 0; i < diag.issues.length; i++) {
      var iss = diag.issues[i];
      if (iss.code === "DB_NOT_OPEN") {
        B.EvelynDB.open();
        fixed.push("Initialized EvelynDB storage.");
        recordEvent("fix", "storage", "Opened EvelynDB.");
      } else if (iss.code === "SHELVES_EMPTY" || iss.code === "SHELF_CORRUPT_ROWS" || iss.code === "POSTINGS_CORRUPT") {
        rebuildShelfIndex();
        fixed.push("Quarantined corrupt rows and rebuilt gap-encoded ShelfLibrary index.");
        recordEvent("fix", "shelves", "Rebuilt ShelfLibrary (" + B.ShelfLibrary.rows.length + " intact records).");
      } else if (iss.code === "PROFILE_MALFORMED" && ctx.profiles) {
        ctx.profiles[iss.key] = healProfile(ctx.profiles[iss.key], iss.key);
        B.EvelynDB.put("profiles", "all", ctx.profiles);
        fixed.push("Repaired profile '" + iss.key + "' while keeping valid XP and trophies.");
        recordEvent("fix", "profiles", "Repaired profile " + iss.key);
      } else if (iss.code === "WORKER_DESYNC") {
        recoverWorkerToLocal("worker state desync");
        fixed.push("Reset EchoWorker cleanly to shelf fallback.");
      } else if (iss.code === "CARTRIDGE_INVALID" && ctx.cartridges) {
        var r = repairCartridge(ctx.cartridges[iss.index]);
        ctx.cartridges[iss.index] = r.cart;
        if (r.fixes.length) fixed.push("Cartridge '" + r.cart.id + "': " + r.fixes.join(" "));
        if (r.manualReview.length) manualReview.push("Cartridge '" + r.cart.id + "' needs human review: " + r.manualReview.join(" "));
      }
    }

    var after = diagnose(ctx);
    var result = { healthyAfter: after.healthy, fixed: fixed, manualReview: manualReview, remaining: after.issues };
    if (cb) cb(result);
    return result;
  }

  /* =========================================================================
     4. LIVE RUNTIME WATCHDOGS (WORKER TIMEOUT, NaN GUARD, FPS GOVERNOR, AUDIO)
     ========================================================================= */
  var Watchdog = {
    potatoMode: false,
    slowStreak: 0,
    timeoutMs: 3500,
    attached: false,

    /* Call once per animation frame with frame delta in ms */
    noteFrame: function (dtMs) {
      if (dtMs > 55) {
        this.slowStreak++;
        if (this.slowStreak >= 10 && !this.potatoMode) {
          this.potatoMode = true;
          recordEvent("fix", "fps", "Detected slow CPU (>55ms/frame x10). Enabled Potato Mode (half-rate simulation).");
        }
      } else {
        this.slowStreak = 0;
      }
      return this.potatoMode;
    },

    /* Wraps EchoWorker.think with hang timeout + NaN quarantine */
    attach: function (opts) {
      if (this.attached) return;
      this.attached = true;
      opts = opts || {};
      if (opts.timeoutMs) this.timeoutMs = opts.timeoutMs;
      var self = this;

      var origThink = B.EchoWorker.think;
      B.EchoWorker.think = function (q, creat, cb) {
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          recoverWorkerToLocal("inference timeout > " + self.timeoutMs + "ms");
          cb(null, { text: "", acts: [0, 0, 0, 0], conf: 0, lps: 0, recovered: true });
        }, self.timeoutMs);

        origThink.call(B.EchoWorker, q, creat, function (err, res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (err || !res || !isFinite(res.conf)) {
            recoverWorkerToLocal(err ? err.message : "NaN confidence output");
            cb(null, { text: "", acts: [0, 0, 0, 0], conf: 0, lps: 0, recovered: true });
            return;
          }
          for (var i = 0; i < (res.acts ? res.acts.length : 0); i++) {
            if (!isFinite(res.acts[i])) {
              recoverWorkerToLocal("NaN layer activation");
              cb(null, { text: "", acts: [0, 0, 0, 0], conf: 0, lps: 0, recovered: true });
              return;
            }
          }
          cb(null, res);
        });
      };

      /* Audio failover guard: if speechSynthesis throws, switch to TINY.C robot voice */
      var origSpeak = B.AudioFX.speak;
      B.AudioFX.speak = function (txt) {
        try {
          origSpeak.call(B.AudioFX, txt);
        } catch (err) {
          B.AudioFX.voiceMode = "robot";
          recordEvent("fix", "audio", "Speech API error; failed over to TINY.C robot tone voice.");
          try { origSpeak.call(B.AudioFX, txt); } catch (e2) { B.AudioFX.voiceMode = "off"; }
        }
      };

      /* Browser global exception safety net */
      if (typeof window !== "undefined") {
        window.addEventListener("error", function (ev) {
          recordEvent("error", "runtime", (ev && ev.message) ? ev.message : "Uncaught runtime error");
          if (opts.onCrash) opts.onCrash(ev);
        });
      }
    }
  };

  root.EvelynDoctor = {
    diagnose: diagnose,
    heal: heal,
    repairCartridge: repairCartridge,
    recoverWorkerToLocal: recoverWorkerToLocal,
    Watchdog: Watchdog,
    getLog: function () { return logBuffer.slice(0); }
  };
})(typeof window !== "undefined" ? window : global);
