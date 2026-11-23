/* evelyn_game_xray_tests.js - Automated ES5 Tests for EvelynGameXRay
   Run in Node.js: node evelyn_game_xray_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_evolution.js");
    require("./evelyn_suite_78.js");
    require("./evelyn_voice_guard.js");
    require("./evelyn_game_xray.js");
  }

  var E = root.EvelynEvolution;
  var S = root.EvelynSuite78;
  var VG = root.EvelynVoiceGuard;
  var GX = root.EvelynGameXRay;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Synthetic iNES (.nes) ROM: header, 6502 disassembly, 2bpp tile decode, and lesson evolution */
  test("GameXRay: Parses iNES (.nes), disassembles 6502 boot code, decodes 2bpp tile & creates Evelyn lesson", function (done) {
    var rom = new Uint8Array(16 + 16384 + 8192);
    rom[0] = 0x4E; rom[1] = 0x45; rom[2] = 0x53; rom[3] = 0x1A; // "NES\x1A"
    rom[4] = 1; // 1 x 16 KB PRG
    rom[5] = 1; // 1 x 8 KB CHR (512 tiles)
    rom[6] = 0x01; // Vertical mirroring, Mapper 0

    /* Write real 6502 boot sequence at PRG offset 16 */
    var code = [0x78, 0xD8, 0xA9, 0x05, 0x8D, 0x00, 0x20, 0x4C, 0x00, 0x80];
    for (var i = 0; i < code.length; i++) rom[16 + i] = code[i];

    /* Write an ASCII credit string inside PRG */
    var msg = "SOLAR_QUEST_1991";
    for (i = 0; i < msg.length; i++) rom[100 + i] = msg.charCodeAt(i);

    /* Write 1 solid 2bpp tile at CHR offset (16 + 16384): plane0=0xFF, plane1=0xFF -> color index 3 */
    var chrOff = 16 + 16384;
    for (i = 0; i < 16; i++) rom[chrOff + i] = 0xFF;

    var rep = GX.analyzeGameFile(rom, "solar_quest.nes");
    assert(rep.ok && rep.format === "NES (iNES)", "Failed to identify iNES");
    assertEq(rep.details.prgKB, 16, "PRG size mismatch");
    assertEq(rep.details.chrKB, 8, "CHR size mismatch");
    assertEq(rep.details.tileCount, 512, "Expected 512 8x8 tiles in 8 KB CHR");
    assertEq(rep.disassembly[0].asm, "SEI", "Expected SEI first 6502 instruction");
    assertEq(rep.disassembly[2].asm, "LDA #$05", "Expected LDA #$05");
    assertEq(rep.tiles[0][0], 3, "2bpp tile pixel (0,0) with both planes 1 must decode to palette index 3");

    var foundStr = false;
    for (i = 0; i < rep.strings.length; i++) if (rep.strings[i].text.indexOf("SOLAR_QUEST_1991") >= 0) foundStr = true;
    assert(foundStr, "ASCII string extractor missed SOLAR_QUEST_1991");
    assert(VG.audit(rep.summary).clean, "Summary contained AI tic: " + rep.summary);

    /* Convert analysis into an Evelyn lesson and verify it evolves Cartridge #1 */
    var prof = { name: "Leo", mode: "M", xp: 0, trophies: [], sr: {}, recent8: [], focusWeights: {}, recentLessons: [] };
    var les = GX.createEvelynLesson(rep, prof);
    assert(les && les.facts.length >= 3, "Lesson generator should produce >= 3 game facts");
    var evolved = E.evolveCartridge(S.getById("static_choir_tune_up"), prof, 42, 24);
    assert(evolved.items[0].q.indexOf("Retro Game X-Ray: solar_quest.nes") >= 0, "Game X-Ray lesson did not evolve cartridge deck");
    done();
  });

  /* 2. Synthetic Game Boy (.gb) with authentic header checksum */
  test("GameXRay: Parses Game Boy (.gb) title, ROM size & valid boot-ROM header checksum", function (done) {
    var gb = new Uint8Array(0x0300);
    gb[0x0104] = 0xCE; gb[0x0105] = 0xED; gb[0x0106] = 0x66; gb[0x0107] = 0x66;
    var title = "DUNE_RUNNER";
    for (var i = 0; i < title.length; i++) gb[0x0134 + i] = title.charCodeAt(i);
    gb[0x0147] = 0x01; // MBC1
    gb[0x0148] = 0x01; // 64 KB
    var chk = 0;
    for (i = 0x0134; i <= 0x014C; i++) chk = (chk - gb[i] - 1) & 0xFF;
    gb[0x014D] = chk;

    var rep = GX.analyzeGameFile(gb, "dune_runner.gb");
    assert(rep.ok && rep.format === "Game Boy", "Failed to identify Game Boy ROM");
    assertEq(rep.details.title, "DUNE_RUNNER", "Game Boy title mismatch");
    assertEq(rep.details.romKB, 64, "Game Boy ROM KB mismatch");
    assert(rep.details.checksumValid, "Game Boy checksum should validate");
    done();
  });

  /* 3. Synthetic WAD, MS-DOS MZ, ISO 9660, and CHIP-8 */
  test("GameXRay: Parses DOOM WAD, MS-DOS MZ .exe, ISO 9660 CD-ROM, and CHIP-8 opcodes", function (done) {
    /* WAD */
    var wad = new Uint8Array(64);
    var wHdr = "PWAD"; for (var i = 0; i < 4; i++) wad[i] = wHdr.charCodeAt(i);
    wad[4] = 1; // 1 lump
    wad[8] = 16; // dir at offset 16
    var lname = "E1M1"; for (i = 0; i < 4; i++) wad[24 + i] = lname.charCodeAt(i);
    var rWad = GX.analyzeGameFile(wad, "level1.wad");
    assert(rWad.ok && rWad.format === "WAD (PWAD)" && rWad.details.sampleLumps[0] === "E1M1", "WAD parse failed");

    /* MS-DOS MZ */
    var dos = new Uint8Array(128);
    dos[0] = 0x4D; dos[1] = 0x5A; dos[4] = 4; dos[8] = 2; // 4 pages, 32-byte header
    var rDos = GX.analyzeGameFile(dos, "pong94.exe");
    assert(rDos.ok && rDos.format === "MS-DOS MZ Executable" && rDos.details.headerBytes === 32, "MZ parse failed");

    /* ISO 9660 */
    var iso = new Uint8Array(0x8100);
    iso[0x8000] = 0x01;
    var cd = "CD001"; for (i = 0; i < 5; i++) iso[0x8001 + i] = cd.charCodeAt(i);
    var vol = "RETRO_1996_DISC"; for (i = 0; i < vol.length; i++) iso[0x8028 + i] = vol.charCodeAt(i);
    iso[0x8050] = 100; // 100 sectors
    var rIso = GX.analyzeGameFile(iso, "classic96.iso");
    assert(rIso.ok && rIso.format === "ISO 9660 CD-ROM" && rIso.details.volumeId === "RETRO_1996_DISC", "ISO 9660 parse failed");

    /* CHIP-8 */
    var ch8 = new Uint8Array([0x00, 0xE0, 0x60, 0x0A, 0xA2, 0x20, 0xD0, 0x15, 0x12, 0x00]);
    var rCh8 = GX.analyzeGameFile(ch8, "pong.ch8");
    assert(rCh8.ok && rCh8.format === "CHIP-8 VM Program", "CHIP-8 parse failed");
    assertEq(rCh8.disassembly[0].asm, "CLS", "Expected CHIP-8 CLS");
    assertEq(rCh8.disassembly[3].asm, "DRW V0, V1, 5", "Expected CHIP-8 DRW opcode");
    done();
  });

  /* 4. Entropy profiler distinguishes zero padding from pseudorandom compressed blocks + Empty guard */
  test("GameXRay: Entropy profiler separates blank banks (<1 bit/B) from high-entropy blocks (>6 bits/B)", function (done) {
    assert(!GX.analyzeGameFile(new Uint8Array(0), "empty.nes").ok, "Empty buffer must fail cleanly");
    var buf = new Uint8Array(2048);
    /* First 1024 bytes = 0x00 padding; second 1024 bytes = pseudorandom high-entropy data */
    var x = 123456789;
    for (var i = 1024; i < 2048; i++) { x = (x * 1664525 + 1013904223) >>> 0; buf[i] = (x >>> 24) & 255; }
    var map = GX.profileEntropy(buf, 2);
    assert(map[0].entropy < 0.5, "Zero-padded half should have near-zero entropy, got " + map[0].entropy);
    assert(map[1].entropy > 6.5, "High-entropy half should exceed 6.5 bits/byte, got " + map[1].entropy);
    done();
  });

  /* 5. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_game_xray.js and evelyn_game_xray_tests.js", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_game_xray.js", "evelyn_game_xray_tests.js"];
      var banned = [[/\bArray\.from\s*\(/, "Array.from"], [/\bnew\s+Map\s*\(/, "Map"], [/\bnew\s+Set\s*\(/, "Set"], [new RegExp("[\\w$)]\\s*=" + ">"), "arrow"], [/\(\?</, "lookbehind"]];
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
      console.log("\n=== RETRO GAME X-RAY RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN RETRO GAME X-RAY TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
