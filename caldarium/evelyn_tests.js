/* evelyn_tests.js - Comprehensive ES5 Test Suite for Evelyn CALDARIUM Stack
   Run in Node.js : node evelyn_tests.js
   Run in Browser : open evelyn_test_runner.html */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_cartridges.js");
  }

  var B = root.EvelynBackend;
  var C = root.EvelynCartridges;

  /* =========================================================================
     MINIMAL ZERO-DEPENDENCY ASYNC TEST HARNESS (ES5)
     ========================================================================= */
  var tests = [];
  var logFn = function (line) { console.log(line); };

  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || "Assertion failed");
  }
  function assertEq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg ? msg + " — " : "") + "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
    }
  }
  function assertThrows(fn, msg) {
    var threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new Error(msg || "Expected function to throw");
  }

  /* Build a valid minimal TNY2 binary ArrayBuffer (D=8, L=2, H=2, HID=8) */
  function buildSyntheticTny2(D, L, H, HID) {
    D = D || 8; L = L || 2; H = H || 2; HID = HID || 8;
    var VOCAB = 97, CTX = 128;
    function tblBytes(r, c) { return r * (4 + c); }
    var total = 12 + tblBytes(VOCAB, D) + tblBytes(CTX, D) +
                L * (D * 4 + 4 * tblBytes(D, D) + D * 4 + tblBytes(HID, D) + tblBytes(D, HID)) +
                D * 4;
    var buf = new ArrayBuffer(total);
    var view = new DataView(buf);
    var u8 = new Uint8Array(buf);
    var rng = B.createRng(1337);
    var off = 0;

    view.setUint8(0, 84); view.setUint8(1, 78); view.setUint8(2, 89); view.setUint8(3, 50); // "TNY2"
    view.setUint16(4, D, true); view.setUint16(6, L, true);
    view.setUint16(8, H, true); view.setUint16(10, HID, true);
    off = 12;

    function writeTable(rows, cols) {
      for (var r = 0; r < rows; r++) {
        view.setFloat32(off, 0.02, true); off += 4;
        for (var c = 0; c < cols; c++) {
          var v = Math.floor((rng() * 2 - 1) * 40);
          view.setInt8(off++, v);
        }
      }
    }
    function writeGains(n) {
      for (var i = 0; i < n; i++) { view.setFloat32(off, 1.0, true); off += 4; }
    }

    writeTable(VOCAB, D);
    writeTable(CTX, D);
    for (var l = 0; l < L; l++) {
      writeGains(D);
      writeTable(D, D); writeTable(D, D); writeTable(D, D); writeTable(D, D);
      writeGains(D);
      writeTable(HID, D); writeTable(D, HID);
    }
    writeGains(D);
    assertEq(off, total, "Synthetic TNY2 size mismatch");
    return buf;
  }

  /* Lightweight headless canvas mock for SandEngine tests */
  function createMockCanvas(w, h) {
    var putCount = 0, lastImg = null;
    return {
      width: w, height: h,
      getPutCount: function () { return putCount; },
      getLastImg: function () { return lastImg; },
      getContext: function () {
        return {
          createImageData: function (iw, ih) {
            return { width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) };
          },
          putImageData: function (img) { putCount++; lastImg = img; }
        };
      }
    };
  }

  /* =========================================================================
     SUITE 1: PRNG & LZW COMPRESSION
     ========================================================================= */
  test("PRNG: Mulberry32 determinism and seed divergence", function (done) {
    var r1 = B.createRng(2026), r2 = B.createRng(2026), r3 = B.createRng(9999);
    var diffs = 0;
    for (var i = 0; i < 40; i++) {
      var a = r1(), b = r2(), c = r3();
      assert(a >= 0 && a < 1, "PRNG out of [0,1) range");
      assertEq(a, b, "Identical seeds diverged at step " + i);
      if (a !== c) diffs++;
    }
    assert(diffs > 35, "Different seeds produced identical stream");
    done();
  });

  test("LZ: Empty, short, repeated, and prose round-trip + compression", function (done) {
    assertEq(B.LZ.decompress(B.LZ.compress("")), "", "Empty round-trip");
    assertEq(B.LZ.decompress(B.LZ.compress("A")), "A", "Single-char round-trip");
    var sample = "Coccyx Corale walk times: plaza to shop 2 min, shop to gondola 4 min. " +
                 "Coccyx Corale walk times: plaza to gondola 5 min, gondola to start house 14 min. " +
                 "Static Choir Hounds live in Server Farm Alley and Midnight Neon Market.";
    var packed = B.LZ.compress(sample);
    assertEq(B.LZ.decompress(packed), sample, "Prose round-trip failed");
    assert(packed.length < sample.length, "LZW did not shrink repeated prose (" + packed.length + " vs " + sample.length + ")");
    done();
  });

  /* =========================================================================
     SUITE 2: INDEXEDDB + FALLBACK STORAGE & PACKED SHELF LIBRARY
     ========================================================================= */
  test("EvelynDB: Open, put, get, and getAll across stores", function (done) {
    B.EvelynDB.open(function () {
      assert(B.EvelynDB.ready, "EvelynDB should mark ready after open");
      B.EvelynDB.put("profiles", "test_user", { name: "Ada", xp: 42 }, function () {
        B.EvelynDB.get("profiles", "test_user", function (got) {
          assert(got && got.name === "Ada" && got.xp === 42, "EvelynDB get mismatch");
          B.EvelynDB.put("cartridges", "c_test", { id: "c_test", title: "Demo" }, function () {
            B.EvelynDB.getAll("cartridges", function (list) {
              var found = false;
              for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === "c_test") found = true;
              assert(found, "EvelynDB getAll missing stored cartridge");
              done();
            });
          });
        });
      });
    });
  });

  test("ShelfLibrary: Seed, gap-encoded postings, shelf filter, and 64-entry LRU eviction", function (done) {
    B.ShelfLibrary.rows = [];
    B.ShelfLibrary.postings = Object.create(null);
    C.seedDefaultShelves();
    assert(B.ShelfLibrary.rows.length >= 20, "Default shelves should seed 20+ records");

    var hits = B.ShelfLibrary.search("Static Choir Hounds darkness", 2);
    assert(hits.length > 0 && hits[0].topic === "Static Choir Hounds", "Expected Static Choir Hounds top hit");
    assert(hits[0].fact.indexOf("Resists: psychic, spirit, darkness") >= 0, "Canon resistance missing in shelf");

    var filtered = B.ShelfLibrary.search("Frostgate", 2, "caldera");
    assert(filtered.length === 1 && filtered[0].shelf === "caldera", "Shelf filter failed");
    var wrongShelf = B.ShelfLibrary.search("Frostgate", 2, "corale");
    assertEq(wrongShelf.length, 0, "Shelf filter leaked record from another shelf");

    /* Push 75 extra entries to verify LRU eviction (> 64 limit) still decompresses cleanly */
    var firstAddedId = B.ShelfLibrary.rows.length;
    for (var i = 0; i < 75; i++) {
      B.ShelfLibrary.add("lru_test", "topic" + i, "Unique entry number " + i + " for LRU cache check.", "");
    }
    for (var j = 0; j < 75; j++) {
      var r = B.ShelfLibrary.read(firstAddedId + j);
      assert(r && r.fact.indexOf("Unique entry number " + j) >= 0, "LRU read corrupted at " + j);
    }
    assert(B.ShelfLibrary.lru.order.length <= 64, "LRU exceeded 64-entry cap");

    /* Persist & restore test */
    var countBefore = B.ShelfLibrary.rows.length;
    B.ShelfLibrary.persist(function () {
      B.ShelfLibrary.rows = [];
      B.ShelfLibrary.postings = Object.create(null);
      B.ShelfLibrary.restore(function (ok) {
        assert(ok, "ShelfLibrary.restore returned false");
        assertEq(B.ShelfLibrary.rows.length, countBefore, "Restored shelf row count mismatch");
        done();
      });
    });
  });

  test("ShelfLibrary: Multi-paragraph plain text ingestion", function (done) {
    var before = B.ShelfLibrary.rows.length;
    var text = "Water Purification Rules\nBoiling water for 1 minute kills harmful germs.\n\n" +
               "Solar Disinfection Guide\nClear bottles in direct sun for 6 hours clear water.";
    var added = B.ShelfLibrary.ingestPlainText(text, "survival");
    assertEq(added, 2, "Expected 2 paragraphs ingested");
    assertEq(B.ShelfLibrary.rows.length, before + 2, "Shelf row count mismatch");
    var res = B.ShelfLibrary.search("solar disinfection bottles", 1, "survival");
    assert(res.length === 1 && res[0].fact.indexOf("6 hours") >= 0, "Ingested paragraph not searchable");
    done();
  });

  /* =========================================================================
     SUITE 3: ASYNC TNY2 WORKER, INT8xINT8 MATVEC, PINNED KV21 & VERIFIER
     ========================================================================= */
  test("EchoWorker: Reject corrupt header, load synthetic TNY2, pin KV21 prefix, and infer", function (done) {
    var badBuf = new ArrayBuffer(16);
    B.EchoWorker.loadBin("bad.bin", badBuf, function (err) {
      assert(err !== null, "Corrupt TNY2 binary should fail");
      var goodBuf = buildSyntheticTny2(8, 2, 2, 8);
      B.EchoWorker.loadBin("synthetic.bin", goodBuf, function (err2, info) {
        assert(!err2, "Valid synthetic TNY2 failed to load: " + err2);
        assertEq(info.D, 8, "Loaded D mismatch");
        assertEq(info.L, 2, "Loaded L mismatch");

        B.EchoWorker.pinPrefix("MODE:D|", function (err3, plen) {
          assert(!err3, "pinPrefix failed: " + err3);
          assertEq(plen, 7, "Pinned KV21 prefix length mismatch");

          B.EchoWorker.think("what is 7*8", 0, function (err4, out) {
            assert(!err4, "think failed: " + err4);
            assert(typeof out.text === "string", "Output text must be string");
            assert(isFinite(out.conf) && out.conf > 0 && out.conf <= 1.0001, "Confidence invalid: " + out.conf);
            assertEq(out.acts.length, 4, "Expected 4 monitor layer activity slots");
            for (var i = 0; i < 4; i++) assert(isFinite(out.acts[i]), "Layer activity NaN at " + i);
            done();
          });
        });
      });
    });
  });

  test("EchoWorker: Prompt-lookup fact verifier blocks hallucinated numbers", function (done) {
    var shelf = "Caldera snow starts at 17,000 ft; Caldera ice starts at 22,000 ft.";
    var okCheck = B.EchoWorker.verifyAgainstShelf("Snow starts at 17,000 ft.", shelf);
    assert(okCheck.ok && okCheck.text.indexOf("17,000") >= 0, "Valid number rejected");
    var badCheck = B.EchoWorker.verifyAgainstShelf("Snow starts at 99,000 ft.", shelf);
    assert(!badCheck.ok && badCheck.text === "", "Hallucinated number 99,000 was not blocked");
    done();
  });

  /* =========================================================================
     SUITE 4: SM-2 SPACED REPETITION, ADAPTIVE PACING, AUDIO & .EVELYNPACK
     ========================================================================= */
  test("Scheduler: SM-2 interval growth, miss reset, dueIds, and adaptiveSpeed", function (done) {
    var prof = { sr: {}, recent8: [] };
    B.Scheduler.record(prof, "q1", true);
    assertEq(prof.sr.q1.days, 1, "First win should schedule 1 day");
    B.Scheduler.record(prof, "q1", true);
    assertEq(prof.sr.q1.days, 3, "Second win should schedule 3 days");
    B.Scheduler.record(prof, "q1", false);
    assertEq(prof.sr.q1.days, 0.25, "Miss should reset interval to 0.25 days");

    prof.sr.q1.due = Date.now() - 1000; // force overdue
    var due = B.Scheduler.dueIds(prof);
    assert(due.indexOf("q1") >= 0, "Overdue item not returned by dueIds");

    /* Adaptive pacing thresholds */
    assertEq(B.Scheduler.adaptiveSpeed({ recent8: [1, 1] }), 1.0, "<4 attempts should stay 1.0x");
    assertEq(B.Scheduler.adaptiveSpeed({ recent8: [1,1,1,1,1,1,1,1] }), 1.25, "100% should speed up to 1.25x");
    assertEq(B.Scheduler.adaptiveSpeed({ recent8: [0,0,1,0,0,1,0,0] }), 0.72, "25% should slow down to 0.72x");
    assertEq(B.Scheduler.adaptiveSpeed({ recent8: [1,1,1,1,1,0,0,0] }), 1.0, "62.5% should stay 1.0x");
    done();
  });

  test("AudioFX: Pluggable voice adapter and mute guards", function (done) {
    var heard = [];
    B.AudioFX.soundOn = true;
    B.AudioFX.registerVoice(function (t) { heard.push(t); });
    B.AudioFX.speak("Hello Evelyn");
    assertEq(heard.length, 1, "Custom voice should be invoked");
    assertEq(heard[0], "Hello Evelyn", "Custom voice text mismatch");
    B.AudioFX.soundOn = false;
    B.AudioFX.speak("Muted");
    assertEq(heard.length, 1, "Muted AudioFX should not speak");
    B.AudioFX.soundOn = true;
    B.AudioFX.voiceMode = "robot";
    done();
  });

  test("PackCodec: .evelynpack round-trip and corrupt header guard", function (done) {
    var packed = B.PackCodec.exportPack([C.DEFAULT_CARTRIDGES[0]], [{ id: 1, fact: "test" }], { v: 1 });
    assert(packed.indexOf("EVPK1:") === 0, "Missing EVPK1 prefix");
    var unpacked = B.PackCodec.importPack(packed);
    assertEq(unpacked.cartridges[0].id, "static_choir_sweep", "Pack cartridge ID mismatch");
    assertEq(unpacked.shelves[0].fact, "test", "Pack shelf mismatch");
    assertThrows(function () { B.PackCodec.importPack("JUNK:123"); }, "Corrupt pack should throw");
    done();
  });

  /* =========================================================================
     SUITE 5: CANON TABLES, CLOCK FORMATTER & CARTRIDGE VALIDATOR
     ========================================================================= */
  test("Canon Tables: Coccyx Corale travel symmetry, Grand Road 12 stops, and 12-hour clocks", function (done) {
    assertEq(C.CORALE_TRAVEL["plaza|shop"], 2, "plaza|shop = 2");
    assertEq(C.CORALE_TRAVEL["shop|gondola"], 4, "shop|gondola = 4");
    assertEq(C.CORALE_TRAVEL["plaza|gondola"], 5, "plaza|gondola = 5");
    assertEq(C.CORALE_TRAVEL["gondola|start house"], 14, "gondola|start house = 14");
    assertEq(C.CORALE_TRAVEL["start house|track"], 6, "start house|track = 6");
    for (var k in C.CORALE_TRAVEL) {
      var pts = k.split("|");
      assertEq(C.CORALE_TRAVEL[pts[1] + "|" + pts[0]], C.CORALE_TRAVEL[k], "Asymmetric travel edge: " + k);
    }

    assertEq(C.GRAND_ROAD.length, 12, "Grand Road must have 12 settlements");
    assertEq(C.GRAND_ROAD[0].mile, 0, "Start mile 0");
    assertEq(C.GRAND_ROAD[11].mile, 114, "Crown Gate mile 114");
    assertEq(C.GRAND_ROAD[11].elev, 42000, "Rim elevation 42,000 ft");
    for (var i = 1; i < C.GRAND_ROAD.length; i++) {
      assert(C.GRAND_ROAD[i].mile > C.GRAND_ROAD[i - 1].mile, "Grand Road miles must increase");
      assert(C.GRAND_ROAD[i].elev > C.GRAND_ROAD[i - 1].elev, "Grand Road elevation must increase");
    }

    assertEq(C.fmtClock12(0), "12:00 AM", "Midnight");
    assertEq(C.fmtClock12(8 * 60 + 50), "8:50 AM", "Plinth empty anchor");
    assertEq(C.fmtClock12(12 * 60), "12:00 PM", "Noon Pyramid U close");
    assertEq(C.fmtClock12(17 * 60 + 7), "5:07 PM", "Last gondola car");
    assertEq(C.fmtClock12(18 * 60), "6:00 PM", "Shop close");
    assertEq(C.fmtClock12(-60), "11:00 PM", "Negative wrap");
    done();
  });

  test("Canon Elements: Static Choir Hounds resist Darkness; Squid & Kraken absorb Water", function (done) {
    assertEq(C.CREATURES.length, 8, "Expected 8 Section 4 creatures");
    var hound = C.CREATURES[0], worm = C.CREATURES[1], squid = C.CREATURES[2], weaver = C.CREATURES[3], kraken = C.CREATURES[4];
    assertEq(C.evalElementHit(hound, "darkness").mult, 0.5, "Hounds must resist darkness");
    assertEq(C.evalElementHit(hound, "psychic").mult, 0.5, "Hounds must resist psychic");
    assertEq(C.evalElementHit(hound, "light").mult, 2, "Hounds weak to light");
    assertEq(C.evalElementHit(hound, "holy").mult, 2, "Hounds weak to holy");
    assertEq(C.evalElementHit(hound, "eldritch").mult, 2, "Hounds weak to eldritch");
    assertEq(C.evalElementHit(squid, "water").mult, -1, "Squid must absorb water");
    assertEq(C.evalElementHit(kraken, "water").mult, -1, "Kraken must absorb water");
    assertEq(worm.home, "Saltsea Arcade Dunes", "Worm lives in Saltsea Arcade Dunes");
    assertEq(weaver.home, "Frostline Strata", "Weaver lives in Frostline Strata");
    done();
  });

  test("CartridgeValidator: All 6 default cartridges pass; every canon violation is caught", function (done) {
    for (var i = 0; i < C.DEFAULT_CARTRIDGES.length; i++) {
      var rep = C.CartridgeValidator.validate(C.DEFAULT_CARTRIDGES[i]);
      assert(rep.ok, "Default cartridge '" + C.DEFAULT_CARTRIDGES[i].id + "' failed validation: " + rep.errors.join("; "));
    }

    function cloneBase() { return JSON.parse(JSON.stringify(C.DEFAULT_CARTRIDGES[0])); }

    /* 1. Echo line > 128 chars */
    var c1 = cloneBase(); c1.echoLine = new Array(131).join("x");
    assert(!C.CartridgeValidator.validate(c1).ok, "Should reject echoLine > 128 chars");

    /* 2. 24-hour clock format */
    var c2 = cloneBase(); c2.goal = "Arrive by 17:07 at the gondola.";
    assert(!C.CartridgeValidator.validate(c2).ok, "Should reject 17:07 24-hour time");
    var c2b = cloneBase(); c2b.goal = "Check plinth at 08:50 sharp.";
    assert(!C.CartridgeValidator.validate(c2b).ok, "Should reject 08:50 without AM/PM");

    /* 3. Content & name guards */
    var c3 = cloneBase(); c3.goal = "Dress the mannequin.";
    assert(!C.CartridgeValidator.validate(c3).ok, "Should reject mannequin");
    var c4 = cloneBase(); c4.goal = "Win the Winter Games.";
    assert(!C.CartridgeValidator.validate(c4).ok, "Should reject Winter Games");
    var c5 = cloneBase(); c5.goal = "Ask DritchLyssa at the shop.";
    assert(!C.CartridgeValidator.validate(c5).ok, "Should reject capital L in Dritchlyssa");
    var c6 = cloneBase(); c6.goal = "Walk across Coccyx Corale plaza.";
    assert(C.CartridgeValidator.validate(c6).ok, "Coccyx Corale is written plainly, with no asterisk");

    /* 4. Julian pronoun guard */
    var c7 = cloneBase(); c7.goal = "Julian said he moved the box.";
    assert(!C.CartridgeValidator.validate(c7).ok, "Should reject pronoun for Julian");
    var c7ok = cloneBase(); c7ok.goal = "Julian said Julian moved the box.";
    assert(C.CartridgeValidator.validate(c7ok).ok, "Should allow Julian without pronouns");

    /* 5. Element error guard */
    var c8 = cloneBase(); c8.goal = "Static Choir Hounds are weak to darkness.";
    assert(!C.CartridgeValidator.validate(c8).ok, "Should reject Hounds weak to darkness");

    /* 6. Missing failRule */
    var c9 = cloneBase(); delete c9.items[0].failRule;
    assert(!C.CartridgeValidator.validate(c9).ok, "Should reject item without failRule");
    done();
  });

  /* =========================================================================
     SUITE 6: FALLING-SAND Uint32Array ENGINE (PHYSICS, CHEMISTRY & BLIT COUNT)
     ========================================================================= */
  test("SandEngine: Gravity, Water+Fire->Steam, Water+Seed->Plant, and 1 blit/frame", function (done) {
    var cv = createMockCanvas(80, 44);
    var rng = B.createRng(42);
    C.SandEngine.init(cv);

    /* Clear basin for clean physics isolation */
    for (var i = 0; i < C.SandEngine.grid.length; i++) C.SandEngine.grid[i] = 0;

    /* 1. Gravity check: Sand at (10, 5) must fall to (10, 6) */
    C.SandEngine.grid[5 * 80 + 10] = 1;
    C.SandEngine.stepAndDraw(cv, rng);
    assertEq(C.SandEngine.grid[6 * 80 + 10], 1, "Sand did not fall downward");
    assertEq(cv.getPutCount(), 1, "Expected exactly 1 putImageData call per frame");

    /* 2. Water + Fire -> Steam reaction */
    C.SandEngine.grid[15 * 80 + 20] = 2; // water
    C.SandEngine.grid[16 * 80 + 20] = 3; // fire right below
    C.SandEngine.stepAndDraw(cv, rng);
    assert(C.SandEngine.steam > 0, "Water + Fire should produce Steam");

    /* 3. Water + Seed -> Plant reaction */
    C.SandEngine.grid[20 * 80 + 30] = 2; // water above
    C.SandEngine.grid[21 * 80 + 30] = 6; // seed below
    C.SandEngine.stepAndDraw(cv, rng);
    assert(C.SandEngine.plants > 0, "Water + Seed should grow Plants");
    assertEq(cv.getPutCount(), 3, "Expected exactly 3 total putImageData calls for 3 frames");
    done();
  });

  /* =========================================================================
     SUITE 7: ES5 COMPATIBILITY AUDIT & LOW-END CPU PERFORMANCE BUDGET
     ========================================================================= */
  test("Perf Budget: 500 shelf inserts + 50 searches + 120 Sand frames run fast", function (done) {
    var t0 = Date.now();
    var cv = createMockCanvas(80, 44);
    var rng = B.createRng(77);
    C.SandEngine.init(cv);
    for (var f = 0; f < 120; f++) C.SandEngine.stepAndDraw(cv, rng);
    var dt = Date.now() - t0;
    assert(dt < 2000, "120 SandEngine frames took too long: " + dt + "ms");
    done();
  });

  if (isNode) {
    test("ES5 Compatibility Audit: Zero ES6+ syntax blockers in backend & cartridges", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_backend.js", "evelyn_cartridges.js"];
      var banned = [
        [/\bArray\.from\s*\(/, "Array.from() breaks IE11/old Android"],
        [/\bnew\s+Map\s*\(/, "new Map() breaks IE10/old Safari"],
        [/\bnew\s+Set\s*\(/, "new Set() breaks IE10/old Safari"],
        [new RegExp("=" + ">"), "Arrow functions break IE11/old browsers"],
        [/\?\./, "Optional chaining breaks older browsers"]
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

    test("Optional Real TINY.BIN Smoke Test (runs automatically if TINY.BIN is present)", function (done) {
      var fs = require("fs"), path = require("path");
      var binPath = path.join(__dirname, "TINY.BIN");
      if (!fs.existsSync(binPath)) { done(); return; }
      var raw = fs.readFileSync(binPath);
      var ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      B.EchoWorker.loadBin("TINY.BIN", ab, function (err, info) {
        assert(!err, "Real TINY.BIN failed to load: " + err);
        assertEq(info.D, 96, "Expected TINY.BIN D=96");
        B.EchoWorker.think("is a whale a fish", 0, function (err2, res) {
          assert(!err2 && res.text.length > 0, "Real TINY.BIN produced empty output");
          logFn("    [Real TINY.BIN] 'is a whale a fish' -> " + res.text + " (" + res.lps.toFixed(1) + " ltr/s)");
          done();
        });
      });
    });
  }

  /* =========================================================================
     RUNNER
     ========================================================================= */
  function runAll(customLog, onComplete) {
    if (customLog) logFn = customLog;
    var passed = 0, failed = 0, idx = 0, tStart = Date.now();

    function next() {
      if (idx >= tests.length) {
        var summary = "\n=== RESULT: " + passed + " passed, " + failed + " failed (" + (Date.now() - tStart) + " ms) ===";
        logFn(summary);
        if (onComplete) onComplete(passed, failed);
        if (isNode) process.exit(failed > 0 ? 1 : 0);
        return;
      }
      var cur = tests[idx++];
      var finished = false;
      function finish(err) {
        if (finished) return;
        finished = true;
        if (err) { failed++; logFn("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
        else { passed++; logFn("[PASS] " + cur.name); }
        setTimeout(next, 0);
      }
      try {
        cur.fn(function (err) { finish(err); });
      } catch (e) {
        finish(e);
      }
    }
    logFn("=== EVELYN CALDARIUM COMPREHENSIVE TEST SUITE (" + tests.length + " tests) ===");
    next();
  }

  if (isNode) {
    runAll();
  } else {
    root.EvelynTests = { runAll: runAll };
  }
})(typeof window !== "undefined" ? window : global);
