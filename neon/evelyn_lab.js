/* evelyn_lab.js - The Lab view of the NEON Concourse (pure ES5, no network).
   Gives the round-2 modules a screen: Game X-Ray, Asset Studio (IPS), 3D viewer, Code Forge / AST IDE, and a
   status list of the modules that have no screen of their own (paper boosts, late-2026, agent OS, sovereign local,
   language core, hybrid RAG, code power, manual compiler, window engine, WASM, code engine).
   Every action works on a file the learner picks or on a made-up sample. Nothing is uploaded, nothing is fetched,
   no ROM or disc data ships with Evelyn, and the companion bridge (evelyn_bridge.js) is never started from here. */
(function (root) {
  "use strict";

  var doc = root.document;
  function $(id) { return doc.getElementById(id); }
  function out(text) { $("labOut").textContent = String(text); }
  function hex(n, w) { var s = n.toString(16).toUpperCase(); while (s.length < w) s = "0" + s; return s; }

  function readBytes(file, cb) {
    var rd = new root.FileReader();
    rd.onload = function () { cb(new Uint8Array(rd.result)); };
    rd.onerror = function () { out("Could not read " + file.name + "."); };
    rd.readAsArrayBuffer(file);
  }
  function readText(file, cb) {
    var rd = new root.FileReader();
    rd.onload = function () { cb(String(rd.result)); };
    rd.onerror = function () { out("Could not read " + file.name + "."); };
    rd.readAsText(file);
  }
  /* The file goes to the learner's own downloads folder from this page; it is never sent anywhere. */
  function saveBytes(name, u8) {
    var blob = new root.Blob([u8], { type: "application/octet-stream" });
    var url = root.URL.createObjectURL(blob);
    var a = doc.createElement("a");
    a.href = url; a.download = name;
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------- panel switching ---------- */
  var PANELS = ["xray", "asset", "view3d", "code", "book", "status"];
  function showPanel(name) {
    for (var i = 0; i < PANELS.length; i++) {
      $("lab-" + PANELS[i]).classList.toggle("hidden", PANELS[i] !== name);
      $("labTab-" + PANELS[i]).classList.toggle("active", PANELS[i] === name);
    }
    if (name === "status") renderStatus();
    if (name === "view3d") draw3d();
    if (name === "book") refreshBooks();
  }

  /* ---------- Book Game: a book the learner has read becomes a game ---------- */
  var book = null, lastCart = null;
  var SAMPLE_TITLE = "The Lantern Fox of Pebble Bay";
  var SAMPLE_TEXT = [
    "Mira lived in the white house beside the lighthouse. Every evening she climbed the long stairs to polish the great lamp. The lamp shone across the water and guided the fishing boats home.",
    "One morning Mira found a small orange fox asleep under the lamp. The fox had a tail like a flame and a collar made of silver wire. \"Who are you?\" asked Mira. \"I am the lantern fox,\" said the fox. \"I keep the light warm when the wind is cold.\"",
    "Tobin was the baker in the village below the hill. Each day Tobin carried warm bread up the path to the lighthouse. \"Your lamp is brighter than ever,\" said Tobin. \"The fox helps me,\" replied Mira.",
    "The village council did not believe in lantern foxes. The council members said that a lamp needs oil and a wick and nothing more. They sent Tobin to look for tricks.",
    "Tobin climbed the stairs and counted every step. There were ninety stairs, and at the top the fox was curled up beside the glass. \"This is no trick,\" said Tobin. \"I see a friend who loves the light.\"",
    "The bay was quiet that night until a storm rolled in from the sea. The wind pushed the waves against the rocks, and the lamp flickered. Mira held the lamp steady while the fox kept the flame warm.",
    "The fishing boats found the harbor by the shining lamp. Every sailor reached the pier safely before midnight. The bakery sold three hundred loaves that week, and the harbor bell rang for the safe return.",
    "In the morning the council came to the lighthouse with their notebooks. \"We were wrong,\" said the oldest member. \"A lighthouse needs a keeper and a lantern fox.\" Mira smiled and Tobin passed around the bread.",
    "From then on the village kept a small lamp in every window. The lamps reminded everyone of the lantern fox and the night of the storm. Children learned to polish glass, to carry bread, and to share light.",
    "Mira grew up and became the keeper of the great lamp. Tobin baked bread for forty years and taught his grandchildren the lantern song. The fox slept every winter beside the warm glass and woke in the spring."
  ].join("\n\n");

  function bookInfo(msg) { $("labBookInfo").textContent = msg; }
  function wordCount(t) { return (String(t).match(/[A-Za-z']+/g) || []).length; }
  /* the whole text of every book the learner loads stays in their archive (IndexedDB store "books") */
  function keepBook(name, text) {
    book = { title: name, text: text };
    var B = root.EvelynBackend;
    if (B && B.EvelynDB) B.EvelynDB.put("books", name, { title: name, text: text, words: wordCount(text), savedAt: new Date().toISOString() });
    if ($("labBookShelf")) refreshBooks(name);
  }
  function refreshBooks(select) {
    var B = root.EvelynBackend, BG = root.EvelynBookGames, sel = $("labBookShelf");
    if (!B || !BG || !sel) return;
    B.EvelynDB.getAll("books", function (list) {
      var keep = select || (sel.value || ""), html = "<option value=\"\">(pick a book)</option>", have = {}, i;
      for (i = 0; i < list.length; i++) { have[list[i].title] = 1; html += "<option value=\"b:" + String(list[i].title).replace(/[<>&\"]/g, "") + "\">" + String(list[i].title).replace(/[<>&\"]/g, "") + " (full book, " + list[i].words + " words)</option>"; }
      var shelves = BG.listShelves(B.ShelfLibrary);
      for (i = 0; i < shelves.length; i++) if (!have[shelves[i].shelf]) html += "<option value=\"s:" + shelves[i].shelf.replace(/[<>&\"]/g, "") + "\">" + shelves[i].shelf.replace(/[<>&\"]/g, "") + " (shelf, " + shelves[i].entries + " entries)</option>";
      sel.innerHTML = html;
      if (keep) for (i = 0; i < sel.options.length; i++) if (sel.options[i].value === "b:" + keep || sel.options[i].value === keep) sel.selectedIndex = i;
    });
  }
  function pickBook() {
    var v = $("labBookShelf").value, B = root.EvelynBackend, BG = root.EvelynBookGames;
    if (!v) return;
    if (v.indexOf("b:") === 0) {
      B.EvelynDB.get("books", v.slice(2), function (rec) {
        if (rec && rec.text) { book = { title: rec.title, text: rec.text }; bookInfo("Loaded \"" + rec.title + "\" (" + rec.words + " words)."); }
      });
    } else {
      var s = BG.fromShelf(B.ShelfLibrary, v.slice(2));
      book = { title: s.title, text: s.text };
      bookInfo("Rebuilt \"" + s.title + "\" from its shelf (" + wordCount(s.text) + " words; a shelf keeps only the start of each paragraph, so a full book makes a better game).");
    }
  }
  function applyPreset() {
    var id = $("labBookPreset").value, BG = root.EvelynBookGames, ps = BG.presets(), i;
    for (i = 0; i < ps.length; i++) if (ps[i].id === id) { $("labBookStyle").value = ps[i].style; $("labBookFocus").value = ps[i].focus; }
  }
  function makeBookGame() {
    var BG = root.EvelynBookGames, typed = $("labBookText").value, text, title;
    if (typed.replace(/\s+/g, " ").trim().length >= 200) { text = typed; title = typed.replace(/\s+/g, " ").trim().split(/[.!?]/)[0].slice(0, 36) || "My text"; }
    else if (book) { text = book.text; title = book.title; }
    else { out("Pick a book you have read, choose a .txt file, use the sample story, or paste some text first."); return; }
    var r = BG.makeGame(text, { title: title, style: $("labBookStyle").value, focus: $("labBookFocus").value, wish: $("labBookWish").value, count: Number($("labBookCount").value) || 12, seed: Number($("labBookSeed").value) || 7, shelf: title });
    if (!r.ok) { lastCart = null; out("No game this time: " + r.errors.join(" ")); return; }
    lastCart = r.cart;
    var kinds = [], k;
    for (k in r.report.made) kinds.push(r.report.made[k] + " x " + k);
    out(["Made a game: " + r.cart.title,
      "Style: " + r.cart.bookGame.style + " (" + r.cart.engine + " engine) | about: " + r.cart.bookGame.focus + " | grade " + r.cart.grade + " | " + r.cart.items.length + " questions",
      "Questions: " + kinds.join(", "),
      "Characters found: " + (r.report.characters.slice(0, 8).join(", ") || "none") + (r.report.note ? "\nNote: " + r.report.note : ""),
      "Every question is cut from the book and every answer is checked against its text. The kid-safe filter is on.",
      "First question: " + r.cart.items[0].q,
      "Press Play it."].join("\n"));
    bookInfo("Ready: " + r.cart.items.length + " questions.");
  }
  function playBookGame() {
    if (!lastCart) { out("Make a game first."); return; }
    $("wkJson").value = JSON.stringify(lastCart, null, 2);
    $("wkLoadPlay").click();                        /* the Workshop validates it, saves it in the archive and opens the player */
  }

  /* ---------- Game X-Ray ---------- */
  function describeReport(rep, fileName) {
    if (!rep || !rep.ok) return "X-Ray could not read " + fileName + ": " + (rep && rep.error ? rep.error : "unknown format");
    var lines = ["File: " + fileName, "Summary: " + rep.summary];
    if (rep.format) lines.push("Format: " + rep.format);
    var d = rep.disassembly || [], i;
    lines.push("Instructions read: " + d.length);
    for (i = 0; i < d.length && i < 8; i++) lines.push("  " + (typeof d[i] === "string" ? d[i] : JSON.stringify(d[i])));
    if (rep.tilesDecoded !== undefined) lines.push("8x8 tiles decoded: " + rep.tilesDecoded);
    lines.push("Taken apart on this device; nothing was uploaded.");
    return lines.join("\n");
  }
  function runXray(u8, name) {
    var G6 = root.EvelynGameXRayGen6, GX = root.EvelynGameXRay;
    var rep = G6 ? G6.analyzeUpToGen6(u8, name) : (GX ? GX.analyzeGameFile(u8, name) : null);
    out(describeReport(rep, name));
  }
  function sampleNes() {
    /* A made-up 24 KB cartridge image with a 10-byte boot routine and one tile: no real game data. */
    var rom = new Uint8Array(16 + 16384 + 8192), i;
    rom[0] = 0x4E; rom[1] = 0x45; rom[2] = 0x53; rom[3] = 0x1A; rom[4] = 1; rom[5] = 1; rom[6] = 1;
    var code = [0x78, 0xD8, 0xA9, 0x05, 0x8D, 0x00, 0x20, 0x4C, 0x00, 0x80];
    for (i = 0; i < code.length; i++) rom[16 + i] = code[i];
    var tile = [0x3C, 0x42, 0x81, 0x81, 0x81, 0x81, 0x42, 0x3C, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < tile.length; i++) rom[16 + 16384 + i] = tile[i];
    return rom;
  }

  /* ---------- Asset Studio: IPS patches ---------- */
  function ipsDemo() {
    var AS = root.EvelynAssetStudio;
    if (!AS) { out("Asset Studio is not loaded."); return; }
    var orig = new root.Uint8Array(64), mod, i;
    for (i = 0; i < orig.length; i++) orig[i] = (i * 7) & 255;
    mod = new root.Uint8Array(orig);
    mod[10] = 0xAA; mod[11] = 0xBB; mod[40] = 0x01;
    var made = AS.IPSPatcher.createPatch(orig, mod);
    if (!made.ok) { out("Patch failed: " + made.error); return; }
    var applied = AS.IPSPatcher.applyPatch(orig, made.patch), same = applied.ok;
    for (i = 0; same && i < mod.length; i++) if (applied.patched[i] !== mod[i]) same = false;
    out(["IPS demo on a made-up 64-byte file",
      "Changed bytes: 3 in 2 records -> patch of " + made.patch.length + " bytes (records: " + made.recordCount + ")",
      "Applying the patch to the untouched file gives the changed file: " + (same ? "YES" : "NO"),
      "A patch holds only the changed bytes, so it can be shared without sharing the game."].join("\n"));
  }
  function ipsMake() {
    var a = $("labOrig").files[0], b = $("labMod").files[0];
    if (!a || !b) { out("Pick the original file and the changed file first."); return; }
    readBytes(a, function (ou) {
      readBytes(b, function (mu) {
        var made = root.EvelynAssetStudio.IPSPatcher.createPatch(ou, mu);
        if (!made.ok) { out("Could not make a patch: " + made.error); return; }
        saveBytes("changes.ips", made.patch);
        out("Made changes.ips: " + made.recordCount + " record(s), " + made.patch.length + " bytes. Saved to your downloads.");
      });
    });
  }
  function ipsApply() {
    var r = $("labRom").files[0], p = $("labIps").files[0];
    if (!r || !p) { out("Pick the file to patch and the .ips patch first."); return; }
    readBytes(r, function (ru) {
      readBytes(p, function (pu) {
        var res = root.EvelynAssetStudio.IPSPatcher.applyPatch(ru, pu);
        if (!res.ok) { out("Patch refused: " + res.error + " (your file was not changed)."); return; }
        saveBytes("patched_" + r.name, res.patched);
        out("Applied " + res.recordsApplied + " record(s) to a copy of " + r.name + ". The original file is untouched.");
      });
    });
  }

  /* ---------- 3D viewer ---------- */
  var mesh3d = null, cam3d = null, ren3d = null;
  function draw3d() {
    var E3 = root.Evelyn3D;
    if (!E3) return;
    if (!ren3d) { ren3d = new E3.SoftwareRenderer3D(160, 120); cam3d = new E3.Camera3D({ z: -6, focalMm: 50 }); }
    if (!mesh3d) mesh3d = E3.makeCube(2);
    var cv = $("lab3dCanvas"), ctx = cv.getContext("2d");
    ren3d.clear();
    ren3d.drawMesh(mesh3d, { x: 0, y: 0, z: 0.6, rx: Number($("lab3dRx").value) / 50, ry: Number($("lab3dRy").value) / 50 }, cam3d, [40, 228, 252]);
    var img = ctx.createImageData(ren3d.w, ren3d.h);
    img.data.set(new root.Uint8ClampedArray(ren3d.pixels.buffer, ren3d.pixels.byteOffset, ren3d.pixels.byteLength));
    ctx.putImageData(img, 0, 0);
    $("lab3dInfo").textContent = "Triangles drawn: " + ren3d.lastStats.drawnTris + " | pixels written: " + ren3d.lastStats.pixelsWritten + " | no WebGL, drawn by the CPU";
  }
  function pickMesh() {
    var E3 = root.Evelyn3D, v = $("lab3dMesh").value;
    mesh3d = v === "glider" ? E3.makeGlider() : E3.makeCube(2);
    draw3d();
  }
  function loadObj() {
    var f = $("lab3dFile").files[0];
    if (!f) return;
    readText(f, function (txt) {
      var res = root.Evelyn3D.parseOBJ(txt);
      if (!res.ok) { out("OBJ refused: " + res.error); return; }
      mesh3d = res.mesh; draw3d();
      out("Loaded " + f.name + ": " + res.mesh.vertexCount + " vertices, " + res.mesh.triCount + " triangles.");
    });
  }

  /* ---------- Code Forge and AST IDE ---------- */
  var db = null;
  function sqlDb() {
    if (db) return db;
    db = new root.EvelynCodeForge.MiniSQL();
    db.exec("CREATE TABLE orders (item, shift, coins)");
    db.exec("INSERT INTO orders VALUES ('Drain Snake leggings', 'day', 18)");
    db.exec("INSERT INTO orders VALUES ('Biscuit mittens', 'night', 11)");
    db.exec("INSERT INTO orders VALUES ('Aurora scarf', 'night', 27)");
    return db;
  }
  function runSql() {
    var res = sqlDb().exec($("labSql").value);
    if (!res.ok) { out("SQL error: " + res.error); return; }
    var rows = res.rows || [], lines = ["Rows: " + rows.length], i;
    for (i = 0; i < rows.length; i++) lines.push("  " + JSON.stringify(rows[i]));
    out(lines.join("\n"));
  }
  function lintCode() {
    var rep = root.EvelynAST.analyze($("labCodeIn").value), lines = [], i, items = rep.errors.concat(rep.warnings);
    lines.push(rep.ok ? "No errors found." : "Problems found: " + rep.errors.length + " error(s), " + rep.warnings.length + " warning(s).");
    for (i = 0; i < items.length; i++) lines.push("  line " + (items[i].line || "?") + " [" + items[i].code + "] " + (items[i].message || items[i].msg || ""));
    out(lines.join("\n"));
  }

  /* ---------- status list for the modules without a screen ---------- */
  var MODULES = [
    ["EvelynPaperBoost", "Paper Boost 1", "evelyn_paper_boost_tests.js"], ["EvelynPaperBoost2", "Paper Boost 2", "evelyn_paper_boost2_tests.js"],
    ["EvelynPaperBoost3", "Paper Boost 3", "evelyn_paper_boost3_tests.js"], ["EvelynLate2026", "Late-2026 Core", "evelyn_late2026_tests.js"],
    ["EvelynAgentOS", "Agent OS 2027", "evelyn_agent_os_tests.js"], ["EvelynSovereign", "Sovereign Local AI", "evelyn_sovereign_local_tests.js"],
    ["EvelynLangCore", "Language Core", "evelyn_lang_core_tests.js"], ["EvelynHybridRAG", "Hybrid Code RAG", "evelyn_hybrid_rag_tests.js"],
    ["EvelynCodePower", "Code Power", "evelyn_code_power_tests.js"], ["EvelynManualCompiler", "Manual Compiler", "evelyn_manual_compiler_tests.js"],
    ["EvelynWindowEngine", "Window Engine", "evelyn_window_engine_tests.js"], ["EvelynWasmAccel", "WASM Accel", "evelyn_turbo_tests.js"],
    ["EvelynCodeEngine", "Code Engine", "evelyn_turbo_tests.js"], ["EvelynAST", "AST IDE", "evelyn_turbo_tests.js"],
    ["EvelynGameXRay", "Game X-Ray", "evelyn_game_xray_tests.js"], ["EvelynGameXRayGen6", "Game X-Ray Gen 4-6", "evelyn_game_xray_gen6_tests.js"],
    ["EvelynAssetStudio", "Asset Studio", "evelyn_asset_studio_tests.js"], ["Evelyn3D", "3D Engine", "evelyn_3d_tests.js"],
    ["EvelynCodeForge", "Code Forge", "evelyn_code_forge_tests.js"],
    ["EvelynBookGames", "Book Games", "evelyn_bookgames_tests.js"]
  ];
  function renderStatus() {
    var lines = ["Module                      Loaded  Exports  Test file"], i, m, g, n, k;
    for (i = 0; i < MODULES.length; i++) {
      m = MODULES[i]; g = root[m[0]]; n = 0;
      if (g) for (k in g) if (Object.prototype.hasOwnProperty.call(g, k)) n++;
      lines.push((m[1] + "                            ").slice(0, 28) + (g ? "yes     " : "NO      ") + (String(n) + "       ").slice(0, 9) + m[2]);
    }
    lines.push("");
    lines.push("Run the tests: node tests/run_all.js (or open evelyn_test_runner.html).");
    lines.push("Companion bridge: OFF. It is a separate program (node neon/evelyn_bridge.js), loopback only, with a per-start");
    lines.push("token. This page never starts it and never calls a server.");
    lines.push("LAN layer pool: simulation only in this build. It opens no sockets.");
    $("labStatus").textContent = lines.join("\n");
  }

  /* ---------- wiring ---------- */
  function mount() {
    if (!$("sec-lab")) return;
    var i;
    for (i = 0; i < PANELS.length; i++) (function (p) { $("labTab-" + p).onclick = function () { showPanel(p); }; })(PANELS[i]);
    $("labRetro").onchange = function (ev) { var f = ev.target.files[0]; if (f) readBytes(f, function (u8) { runXray(u8, f.name); }); };
    $("labRetroSample").onclick = function () { runXray(sampleNes(), "sample.nes"); };
    $("labIpsDemo").onclick = ipsDemo;
    $("labIpsMake").onclick = ipsMake;
    $("labIpsApply").onclick = ipsApply;
    $("lab3dMesh").onchange = pickMesh;
    $("lab3dRx").oninput = draw3d;
    $("lab3dRy").oninput = draw3d;
    $("lab3dFile").onchange = loadObj;
    $("labSqlRun").onclick = runSql;
    $("labLint").onclick = lintCode;
    if (root.EvelynBookGames) {
      var ps = root.EvelynBookGames.presets(), ph = "<option value=\"\">(my own words below)</option>", pi;
      for (pi = 0; pi < ps.length; pi++) ph += "<option value=\"" + ps[pi].id + "\">" + ps[pi].name + "</option>";
      $("labBookPreset").innerHTML = ph;
      $("labBookPreset").onchange = applyPreset;
      $("labBookShelf").onchange = pickBook;
      $("labBookFile").onchange = function (ev) { var f = ev.target.files[0]; if (f) readText(f, function (t) { keepBook(f.name.replace(/\.txt$/i, ""), t); bookInfo("Loaded \"" + f.name + "\" (" + wordCount(t) + " words) and kept it in your archive."); }); };
      $("labBookSample").onclick = function () { book = { title: SAMPLE_TITLE, text: SAMPLE_TEXT }; bookInfo("Sample story ready (" + wordCount(SAMPLE_TEXT) + " words, written for Evelyn)."); };
      $("labBookMake").onclick = makeBookGame;
      $("labBookPlay").onclick = playBookGame;
    }
    showPanel("xray");
  }

  root.EvelynLab = { mount: mount, showPanel: showPanel, sampleNes: sampleNes, keepBook: keepBook, sampleText: SAMPLE_TEXT, onShow: function () { showPanel("xray"); } };
  if (doc && doc.readyState !== "loading") mount();
  else if (doc) doc.addEventListener("DOMContentLoaded", mount);
})(typeof window !== "undefined" ? window : global);
