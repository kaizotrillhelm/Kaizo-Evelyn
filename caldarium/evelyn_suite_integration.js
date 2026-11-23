/* evelyn_suite_integration.js - Connects all 78 Cartridges, 15 Concourse Doors,
   Live Focus/Lesson Evolution & Interactive Engines into Evelyn CALDARIUM.
   Pure ES5. Zero external dependencies. */
(function (root) {
  "use strict";

  var B = root.EvelynBackend;
  var E = root.EvelynEvolution;
  var S = root.EvelynSuite78;

  function createSuiteController(opts) {
    opts = opts || {};
    var profile = opts.profile || { name: "Learner 1", mode: "M", xp: 0, trophies: [], sr: {}, recent8: [], focusWeights: {}, recentLessons: [], handoff: null };
    var onSave = opts.onSave || function () {};
    var onMonitor = opts.onMonitor || function () {};

    var state = {
      doorId: "claw",
      gradeFilter: "ALL",
      toyMode: false,
      activeCart: null,
      evolvedCart: null,
      idx: 0,
      streak: 0,
      score: 0,
      seed: 2026
    };

    function openCartridge(cartId, customSeed) {
      var base = S.getById(cartId);
      if (!base) return null;
      state.activeCart = base;
      state.seed = customSeed || (Date.now() & 0xFFFF);
      state.evolvedCart = E.evolveCartridge(base, profile, state.seed, 24);
      state.idx = 0;
      state.streak = 0;
      state.score = 0;
      return state.evolvedCart;
    }

    function currentItem() {
      if (!state.evolvedCart || !state.evolvedCart.items.length) return null;
      return state.evolvedCart.items[state.idx % state.evolvedCart.items.length];
    }

    function submitAnswer(userAnswer) {
      var it = currentItem();
      if (!it) return { ok: false, msg: "No active item." };
      var normUser = String(userAnswer || "").trim().toLowerCase();
      var normAns = String(it.ans || "").trim().toLowerCase();
      var ok = (normUser === normAns);

      if (B && B.Scheduler) B.Scheduler.record(profile, it.id, ok);
      if (ok) {
        state.streak++;
        if (!state.toyMode) {
          state.score += 10 + state.streak * 2;
          profile.xp = (profile.xp || 0) + 10;
        }
        state.idx++;
        if (state.idx === 5 || state.idx === 10) {
          E.writeHandoff(profile, state.evolvedCart, state.streak, it.tag || state.evolvedCart.subject);
          if (!state.toyMode && profile.trophies.indexOf(state.evolvedCart.title) < 0) {
            profile.trophies.push(state.evolvedCart.title);
          }
        }
        if (B && B.AudioFX) B.AudioFX.ok();
        onSave(profile);
        var isSetPiece = (state.idx % 5 === 0);
        var msg = isSetPiece
          ? "SET PIECE REACHED! " + state.evolvedCart.setPiece + " (" + it.failRule + ")"
          : "Correct! Streak x" + state.streak + ". " + it.failRule;
        onMonitor([0.9, 0.88, 0.92, 0.95], 0.98, 48, state.evolvedCart.title + " streak " + state.streak + ". Zeep zorp, team.");
        return { ok: true, isSetPiece: isSetPiece, msg: msg, nextItem: currentItem(), handoff: profile.handoff };
      } else {
        state.streak = 0;
        if (B && B.AudioFX) B.AudioFX.bad();
        onSave(profile);
        onMonitor([0.45, 0.35, 0.4, 0.5], 0.48, 22, "Close try! Review rule and keep going. Zeep zorp, team.");
        return { ok: false, msg: "Not quite, try again! Rule: " + it.failRule, nextItem: it };
      }
    }

    /* Dial engine closeness sound helper (used by #1 Static Choir Tune-Up & dial games) */
    function playDialCloseness(dialVal, targetVal) {
      if (!B || !B.AudioFX) return 0;
      var diff = Math.abs(Number(dialVal) - Number(targetVal));
      var closeness = Math.max(0, 1 - Math.min(1, diff / Math.max(1, Math.abs(Number(targetVal)) || 10)));
      var hz = 330 + Math.round(closeness * 330);
      B.AudioFX.tone(hz, 90, closeness > 0.92 ? "triangle" : "sawtooth", 0.04);
      return closeness;
    }

    function applyFocusText(text) {
      var res = E.parseFocusIntent(profile, text);
      onSave(profile);
      return res;
    }

    function addRecentLesson(title, factsText) {
      var lines = String(factsText || "").split(/\r?\n/), clean = [];
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].trim();
        if (ln) clean.push(ln);
      }
      var les = E.logLesson(profile, title, null, clean);
      onSave(profile);
      return les;
    }

    /* Mount full 15-Door Concourse Hub & Player into a DOM container */
    function mountDOM(containerEl) {
      if (!containerEl || typeof document === "undefined") return;
      containerEl.innerHTML =
        "<div class='box' style='border-color:#48fca8'>" +
        "<div class='btitle'>CONCOURSE MALL // 15 DOORS &middot; ALL 78 EVOLVING CARTRIDGES</div>" +
        "<div class='row'>" +
          "<input id='evFocusIn' style='flex:1' placeholder='Tell Evelyn what to focus on (e.g. fractions, Spanish, coding loops)...'>" +
          "<button id='evFocusBtn' class='active'>Adapt Games</button>" +
          "<button id='evLessonToggle'>+ Log Recent Lesson</button>" +
          "<select id='evGradeSel'><option value='ALL'>All Grades</option><option value='PK-2'>PK-2</option><option value='3-5'>3-5</option><option value='6-8'>6-8</option><option value='9-12'>9-12</option></select>" +
          "<button id='evSuiteToy'>Toy Mode: OFF</button>" +
        "</div>" +
        "<div id='evLessonBox' class='hidden' style='margin-bottom:8px;padding:6px;border:1px solid #008ca8'>" +
          "<div class='row'><input id='evLesTitle' style='flex:1' placeholder='Lesson/Tutorial Title (e.g. Today: Fractions & Water Boiling)'></div>" +
          "<textarea id='evLesFacts' style='height:62px' placeholder='One fact per line: Question | Answer | Teaching Rule'></textarea>" +
          "<div class='row' style='margin-top:4px;margin-bottom:0'><button id='evLesSave' class='active'>Save Lesson &amp; Evolve All 78 Cartridges</button></div>" +
        "</div>" +
        "<div id='evFocusStatus' style='font-size:12px;color:#48fca8;margin-bottom:6px'></div>" +
        "<div id='evRecBar' class='row' style='font-size:12px'></div>" +
        "<div id='evDoorGrid' class='row'></div>" +
        "<div id='evDoorList' class='row' style='padding:6px;background:#030314;border:1px solid #008ca8'></div>" +
        "<div id='evStage' class='hidden' style='margin-top:8px;padding:8px;border:2px solid #28e4fc;background:#050822'>" +
          "<div id='evStHead' style='color:#fcd838;font-weight:bold;margin-bottom:4px'></div>" +
          "<div id='evStEcho' style='color:#28e4fc;font-size:12px;margin-bottom:6px'></div>" +
          "<div id='evStPrompt' style='color:#f0f8fc;font-size:15px;font-weight:bold;margin-bottom:8px'></div>" +
          "<div id='evStControls' class='row'></div>" +
          "<div id='evStLog' class='out' style='min-height:70px;max-height:150px'></div>" +
          "<div id='evStParent' style='font-size:12px;color:#b8c8dc;margin-top:6px;white-space:pre-wrap'></div>" +
        "</div>" +
        "</div>";

      var elDoorGrid = containerEl.querySelector("#evDoorGrid");
      var elDoorList = containerEl.querySelector("#evDoorList");
      var elRecBar = containerEl.querySelector("#evRecBar");
      var elStatus = containerEl.querySelector("#evFocusStatus");
      var elStage = containerEl.querySelector("#evStage");

      function renderDoors() {
        elDoorGrid.innerHTML = "";
        for (var i = 0; i < S.CONCOURSE_DOORS.length; i++) {
          (function (door) {
            var b = document.createElement("button");
            b.textContent = door.name + " (" + S.getByDoor(door.id).length + ")";
            if (door.id === state.doorId) b.className = "active";
            b.title = door.holds;
            b.onclick = function () { state.doorId = door.id; renderDoors(); renderCartList(); };
            elDoorGrid.appendChild(b);
          })(S.CONCOURSE_DOORS[i]);
        }
      }

      function renderRecs() {
        var recs = E.recommendCartridges(S.CARTRIDGES, profile, 4);
        elRecBar.innerHTML = "<span style='color:#fcd838'>Evolved Picks:</span> ";
        for (var i = 0; i < recs.length; i++) {
          (function (c) {
            var b = document.createElement("button");
            b.textContent = "#" + c.num + " " + c.title;
            b.onclick = function () { launchUI(c.id); };
            elRecBar.appendChild(b);
          })(recs[i]);
        }
      }

      function renderCartList() {
        elDoorList.innerHTML = "";
        var carts = S.getByDoor(state.doorId);
        var shown = 0;
        for (var i = 0; i < carts.length; i++) {
          var c = carts[i];
          if (state.gradeFilter !== "ALL" && c.gradeBands.indexOf(state.gradeFilter) < 0) continue;
          shown++;
          (function (cart) {
            var b = document.createElement("button");
            b.textContent = "#" + cart.num + " " + cart.title + " [" + cart.grade + " | " + cart.engine + "]";
            b.onclick = function () { launchUI(cart.id); };
            elDoorList.appendChild(b);
          })(c);
        }
        if (shown === 0) elDoorList.textContent = "No cartridges in this door match grade " + state.gradeFilter + ".";
      }

      function renderCurrentRound(feedback) {
        var c = state.evolvedCart, it = currentItem();
        if (!c || !it) return;
        elStage.classList.remove("hidden");
        var meta = c.evolutionMeta;
        containerEl.querySelector("#evStHead").textContent =
          "#" + c.num + " " + c.title + " (" + c.engine.toUpperCase() + ", Tier " + meta.tier + "/5, " + meta.totalItems + " evolved items)" +
          (state.toyMode ? " [TOY MODE]" : " | Score " + state.score + " | Streak " + state.streak);
        containerEl.querySelector("#evStEcho").textContent = c.echoLine + (meta.handoffUsed ? " [KV21 carry from " + meta.handoffUsed + "]" : "");
        containerEl.querySelector("#evStPrompt").textContent = "Round " + (state.idx + 1) + ": " + it.q;
        if (feedback) containerEl.querySelector("#evStLog").textContent = feedback;
        containerEl.querySelector("#evStParent").textContent = E.buildParentReadout(profile, c);

        var ctrl = containerEl.querySelector("#evStControls");
        ctrl.innerHTML = "";

        if (c.engine === "typing" || c.engine === "sandbox_code") {
          var inp = document.createElement("input");
          inp.style.flex = "1";
          inp.placeholder = c.engine === "typing" ? "Type exact answer and press Enter..." : "Type rule/answer or pick a button below...";
          var go = document.createElement("button");
          go.className = "active"; go.textContent = "Submit";
          go.onclick = function () { var r = submitAnswer(inp.value); renderCurrentRound(r.msg); };
          inp.onkeydown = function (ev) { if (ev.key === "Enter") go.onclick(); };
          ctrl.appendChild(inp); ctrl.appendChild(go);
        }

        if (c.engine === "dial" && /^\d+(?:\.\d+)?$/.test(String(it.ans))) {
          var targetNum = parseFloat(it.ans);
          var sl = document.createElement("input");
          sl.type = "range"; sl.min = 0; sl.max = Math.max(100, Math.round(targetNum * 2)); sl.step = (targetNum % 1 !== 0) ? "0.1" : "1"; sl.value = 0;
          var lbl = document.createElement("span"); lbl.textContent = "Dial: 0";
          sl.oninput = function () { lbl.textContent = "Dial: " + sl.value; playDialCloseness(sl.value, targetNum); };
          var tuneBtn = document.createElement("button"); tuneBtn.className = "active"; tuneBtn.textContent = "Tune Dial";
          tuneBtn.onclick = function () { var r = submitAnswer(sl.value); renderCurrentRound(r.msg); };
          ctrl.appendChild(sl); ctrl.appendChild(lbl); ctrl.appendChild(tuneBtn);
        }

        /* Choice buttons (always available as accessible touch fallback and for deduction/manifest/array/studio/arcade) */
        var opts = [it.ans].concat(it.wrong || []);
        var rng = B.createRng(state.seed + state.idx * 31);
        opts.sort(function () { return rng() - 0.5; });
        for (var i = 0; i < opts.length; i++) {
          (function (optText) {
            var b = document.createElement("button");
            b.textContent = optText;
            b.onclick = function () { var r = submitAnswer(optText); renderCurrentRound(r.msg); };
            ctrl.appendChild(b);
          })(opts[i]);
        }
        if (profile.mode === "A" && B && B.AudioFX) B.AudioFX.speak(it.q);
      }

      function launchUI(cartId) {
        openCartridge(cartId);
        renderCurrentRound("Goal: " + state.evolvedCart.goal + "\nSet piece: " + state.evolvedCart.setPiece);
      }

      containerEl.querySelector("#evFocusBtn").onclick = function () {
        var txt = containerEl.querySelector("#evFocusIn").value;
        var res = applyFocusText(txt);
        elStatus.textContent = res.summary;
        renderRecs();
        if (state.activeCart) launchUI(state.activeCart.id);
      };
      containerEl.querySelector("#evLessonToggle").onclick = function () {
        containerEl.querySelector("#evLessonBox").classList.toggle("hidden");
      };
      containerEl.querySelector("#evLesSave").onclick = function () {
        var t = containerEl.querySelector("#evLesTitle").value || "Today's Tutorial";
        var f = containerEl.querySelector("#evLesFacts").value;
        var les = addRecentLesson(t, f);
        elStatus.textContent = "Logged lesson '" + les.title + "' (" + les.facts.length + " facts). All 78 cartridges evolved!";
        containerEl.querySelector("#evLessonBox").classList.add("hidden");
        renderRecs();
        if (state.activeCart) launchUI(state.activeCart.id);
      };
      containerEl.querySelector("#evGradeSel").onchange = function (e) { state.gradeFilter = e.target.value; renderCartList(); };
      containerEl.querySelector("#evSuiteToy").onclick = function () {
        state.toyMode = !state.toyMode;
        this.textContent = "Toy Mode: " + (state.toyMode ? "ON" : "OFF");
        if (state.evolvedCart) renderCurrentRound();
      };

      renderDoors();
      renderRecs();
      renderCartList();
    }

    return {
      state: state,
      openCartridge: openCartridge,
      currentItem: currentItem,
      submitAnswer: submitAnswer,
      playDialCloseness: playDialCloseness,
      applyFocusText: applyFocusText,
      addRecentLesson: addRecentLesson,
      mountDOM: mountDOM
    };
  }

  root.EvelynSuiteUI = { createController: createSuiteController };
})(typeof window !== "undefined" ? window : global);
