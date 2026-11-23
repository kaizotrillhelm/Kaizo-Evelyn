/* evelyn_game_xray_gen6_tests.js - Automated ES5 Tests for Gen 4 through Gen 6
   Static Dissection & Gen 7 Encryption Boundary.
   Run in Node.js: node evelyn_game_xray_gen6_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_evolution.js");
    require("./evelyn_voice_guard.js");
    require("./evelyn_game_xray.js");
    require("./evelyn_game_xray_gen6.js");
  }

  var G6 = root.EvelynGameXRayGen6;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }
  function putStr(u8, off, s) { for (var i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i); }

  /* 1. Gen 4: Sega Genesis / Mega Drive */
  test("Gen 4: Identifies Sega Genesis / Mega Drive ROM header & title", function (done) {
    var md = new Uint8Array(0x200);
    putStr(md, 0x100, "SEGA MEGA DRIVE ");
    putStr(md, 0x150, "STARLIGHT RUNNER 1992");
    putStr(md, 0x180, "GM T-99012 -00");
    var rep = G6.analyzeUpToGen6(md, "starlight.md");
    assert(rep.ok && rep.gen === 4 && rep.details.title === "STARLIGHT RUNNER 1992", "Mega Drive parse failed");
    done();
  });

  /* 2. Gen 5: N64 Big-Endian (.z64) & Byte-Swapped (.v64) Endianness Unswapper */
  test("Gen 5: Detects N64 .z64 and unswaps byte-swapped .v64 title accurately", function (done) {
    var z64 = new Uint8Array(0x1010);
    z64[0] = 0x80; z64[1] = 0x37; z64[2] = 0x12; z64[3] = 0x40;
    z64[8] = 0x80; z64[9] = 0x00; z64[10] = 0x04; z64[11] = 0x00; // Entry 0x80000400
    putStr(z64, 0x20, "CALDERA RACER 64");

    /* Create authentic byte-swapped .v64 copy (every 2 bytes flipped) */
    var v64 = new Uint8Array(z64.length);
    for (var i = 0; i + 1 < z64.length; i += 2) { v64[i] = z64[i + 1]; v64[i + 1] = z64[i]; }

    var rZ = G6.analyzeUpToGen6(z64, "caldera.z64");
    var rV = G6.analyzeUpToGen6(v64, "caldera.v64");
    assert(rZ.ok && rZ.details.byteOrder === "z64" && rZ.details.title === "CALDERA RACER 64", "z64 parse failed");
    assert(rV.ok && rV.details.byteOrder === "v64" && rV.details.title === "CALDERA RACER 64", "v64 unswap failed: " + rV.details.title);
    assertEq(rV.details.entryPC, "0x80000400", "N64 entry PC mismatch after unswap");
    done();
  });

  /* 3. Gen 5: PlayStation 1 PS-X EXE + MIPS R3000A Educational Disassembler */
  test("Gen 5: Parses PlayStation 1 PS-X EXE header and disassembles real MIPS R3000A opcodes", function (done) {
    var psx = new Uint8Array(0x820);
    putStr(psx, 0, "PS-X EXE");
    /* Entry PC = 0x80010000 (little-endian), Load = 0x80010000, Size = 0x0800 */
    psx[0x10] = 0x00; psx[0x11] = 0x00; psx[0x12] = 0x01; psx[0x13] = 0x80;
    psx[0x18] = 0x00; psx[0x19] = 0x00; psx[0x1A] = 0x01; psx[0x1B] = 0x80;
    psx[0x1C] = 0x00; psx[0x1D] = 0x08;

    /* Write 3 real MIPS R3000A little-endian words at 0x800:
       1) LUI $t0, 0x1F80  -> 0x3C081F80
       2) ADDIU $t1, $zero, 5 -> 0x24090005
       3) JR $ra           -> 0x03E00008 */
    var words = [0x3C081F80, 0x24090005, 0x03E00008];
    for (var i = 0; i < words.length; i++) {
      var o = 0x800 + i * 4, w = words[i];
      psx[o] = w & 255; psx[o + 1] = (w >>> 8) & 255; psx[o + 2] = (w >>> 16) & 255; psx[o + 3] = (w >>> 24) & 255;
    }

    var rep = G6.analyzeUpToGen6(psx, "demo97.exe");
    assert(rep.ok && rep.gen === 5 && rep.format === "PlayStation 1 (PS-X EXE)", "PS-X EXE parse failed");
    assertEq(rep.details.entryPC, "0x80010000", "PS1 entry PC mismatch");
    assertEq(rep.disassembly[0].asm, "LUI $t0, 0x1F80", "Expected LUI $t0");
    assertEq(rep.disassembly[1].asm, "ADDIU $t1, $zero, 5", "Expected ADDIU $t1");
    assertEq(rep.disassembly[2].asm, "JR $ra", "Expected JR $ra");
    done();
  });

  /* 4. Gen 6: Game Boy Advance (.gba), Dreamcast (IP.BIN), GameCube (GCM), PS2 (ELF) */
  test("Gen 6: Parses GBA complement checksum, Dreamcast IP.BIN, GameCube 0xC2339F3D, and PS2 MIPS ELF", function (done) {
    /* GBA */
    var gba = new Uint8Array(0x100);
    putStr(gba, 0xA0, "OASIS_QUEST");
    putStr(gba, 0xAC, "AOQE");
    gba[0xB2] = 0x96;
    var chk = 0; for (var i = 0xA0; i <= 0xBC; i++) chk = (chk - gba[i]) & 0xFF;
    gba[0xBD] = (chk - 0x19) & 0xFF;
    var rGba = G6.analyzeUpToGen6(gba, "oasis.gba");
    assert(rGba.ok && rGba.gen === 6 && rGba.details.title === "OASIS_QUEST", "GBA parse failed");

    /* Dreamcast IP.BIN */
    var dc = new Uint8Array(0x120);
    putStr(dc, 0x00, "SEGA SEGAKATANA ");
    putStr(dc, 0x40, "T-99901N  ");
    putStr(dc, 0x50, "20000914");
    putStr(dc, 0x60, "1ST_READ.BIN    ");
    putStr(dc, 0x80, "SKYFARM GLIDER DC");
    var rDc = G6.analyzeUpToGen6(dc, "ip.bin");
    assert(rDc.ok && rDc.gen === 6 && rDc.details.bootFile === "1ST_READ.BIN" && rDc.details.title === "SKYFARM GLIDER DC", "Dreamcast parse failed");

    /* GameCube */
    var gc = new Uint8Array(0x80);
    putStr(gc, 0x00, "G99E01");
    gc[0x1C] = 0xC2; gc[0x1D] = 0x33; gc[0x1E] = 0x9F; gc[0x1F] = 0x3D;
    putStr(gc, 0x20, "ORPHAN CUBE RACER");
    var rGc = G6.analyzeUpToGen6(gc, "racer.gcm");
    assert(rGc.ok && rGc.gen === 6 && rGc.details.gameId === "G99E01" && rGc.details.title === "ORPHAN CUBE RACER", "GameCube parse failed");

    /* PS2 MIPS ELF */
    var elf = new Uint8Array(64);
    elf[0] = 0x7F; elf[1] = 0x45; elf[2] = 0x4C; elf[3] = 0x46;
    elf[4] = 1; elf[5] = 1; // 32-bit LE
    elf[18] = 8; // MIPS
    elf[24] = 0x00; elf[25] = 0x00; elf[26] = 0x10; elf[27] = 0x00; // 0x00100000
    var rElf = G6.analyzeUpToGen6(elf, "SLUS_200.01");
    assert(rElf.ok && rElf.gen === 6 && rElf.details.machine === 8 && rElf.details.entryPC === "0x00100000", "PS2 ELF parse failed");
    done();
  });

  /* 5. Gen 7 Encryption Boundary: Identifies Wii header and stops cleanly without decrypting */
  test("Gen 7 Boundary: Identifies Wii header (0x5D1C9EA3) and stops cleanly at encrypted partition boundary", function (done) {
    var wii = new Uint8Array(0x80);
    putStr(wii, 0x00, "R99E01");
    wii[0x18] = 0x5D; wii[0x19] = 0x1C; wii[0x1A] = 0x9E; wii[0x1B] = 0xA3;
    putStr(wii, 0x20, "WII SAMPLE DISC");
    var rWii = G6.analyzeUpToGen6(wii, "disc.iso");
    assert(rWii.ok && rWii.gen === 7 && rWii.encryptedPartitions === true, "Wii boundary detection failed");
    assertEq(rWii.strings.length, 0, "Must not scan encrypted Gen 7 partitions");
    done();
  });

  /* 6. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_game_xray_gen6.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_game_xray_gen6.js", "evelyn_game_xray_gen6_tests.js"];
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
      console.log("\n=== GEN 4-6 X-RAY RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN GEN 4-6 RETRO GAME X-RAY TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
