/* evelyn_game_xray_gen6.js - Extends EvelynGameXRay through Console Generation 6:
   - Gen 4: Sega Genesis / Mega Drive
   - Gen 5: Nintendo 64 (.z64/.v64/.n64 endian auto-fix), PlayStation 1 (PS-X EXE + MIPS R3000A)
   - Gen 6: Game Boy Advance (.gba checksum), Sega Dreamcast (IP.BIN), GameCube (.gcm/.iso), PS2/ELF
   - Gen 7+: Wii / Encrypted-disc boundary detector (read-only, zero DRM bypass)
   - Weak-CPU File.slice(0, 131072) streamer so multi-GB ISOs use only 128 KB RAM.
   Pure ES5. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynGameXRay) require("./evelyn_game_xray.js");

  var Base = root.EvelynGameXRay;

  function readAscii(u8, start, len) {
    var out = "", end = Math.min(u8.length, start + len);
    for (var i = start; i < end; i++) {
      var b = u8[i];
      if (b === 0) break;
      if (b >= 32 && b <= 126) out += String.fromCharCode(b);
    }
    return out.trim();
  }
  function u16le(u8, o) { return u8[o] | (u8[o + 1] << 8); }
  function u32le(u8, o) { return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0; }
  function u32be(u8, o) { return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0; }
  function hex8(n) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < 8) s = "0" + s;
    return "0x" + s;
  }

  /* =========================================================================
     1. EDUCATIONAL MIPS R3000A / R4300i DISASSEMBLER (PS1 / N64 / PS2)
        Fixed 32-bit instructions (little-endian for PS1/PS2, big-endian for N64).
     ========================================================================= */
  var MIPS_REGS = [
    "$zero","$at","$v0","$v1","$a0","$a1","$a2","$a3",
    "$t0","$t1","$t2","$t3","$t4","$t5","$t6","$t7",
    "$s0","$s1","$s2","$s3","$s4","$s5","$s6","$s7",
    "$t8","$t9","$k0","$k1","$gp","$sp","$fp","$ra"
  ];

  function disassembleMIPS(u8, startOffset, maxInst, bigEndian) {
    var lines = [], p = startOffset || 0, lim = maxInst || 10;
    while (p + 3 < u8.length && lines.length < lim) {
      var word = bigEndian ? u32be(u8, p) : u32le(u8, p);
      var op = (word >>> 26) & 0x3F;
      var rs = (word >>> 21) & 0x1F;
      var rt = (word >>> 16) & 0x1F;
      var rd = (word >>> 11) & 0x1F;
      var fn = word & 0x3F;
      var imm = word & 0xFFFF;
      var simm = imm > 32767 ? imm - 65536 : imm;
      var target = (word & 0x03FFFFFF) << 2;

      var asm, note;
      if (word === 0) {
        asm = "NOP";
        note = "No operation (MIPS branch delay slot or timing pad).";
      } else if (op === 0x0F) {
        asm = "LUI " + MIPS_REGS[rt] + ", 0x" + imm.toString(16).toUpperCase();
        note = "Load upper 16 bits (0x" + imm.toString(16).toUpperCase() + "0000) into " + MIPS_REGS[rt] + ".";
      } else if (op === 0x09) {
        asm = "ADDIU " + MIPS_REGS[rt] + ", " + MIPS_REGS[rs] + ", " + simm;
        note = "Set " + MIPS_REGS[rt] + " = " + MIPS_REGS[rs] + " + " + simm + ".";
      } else if (op === 0x0D) {
        asm = "ORI " + MIPS_REGS[rt] + ", " + MIPS_REGS[rs] + ", 0x" + imm.toString(16).toUpperCase();
        note = "Combine lower bits 0x" + imm.toString(16).toUpperCase() + " into " + MIPS_REGS[rt] + ".";
      } else if (op === 0x23) {
        asm = "LW " + MIPS_REGS[rt] + ", " + simm + "(" + MIPS_REGS[rs] + ")";
        note = "Load 32-bit word from RAM at " + MIPS_REGS[rs] + " + " + simm + " into " + MIPS_REGS[rt] + ".";
      } else if (op === 0x2B) {
        asm = "SW " + MIPS_REGS[rt] + ", " + simm + "(" + MIPS_REGS[rs] + ")";
        note = "Store 32-bit word from " + MIPS_REGS[rt] + " into RAM at " + MIPS_REGS[rs] + " + " + simm + ".";
      } else if (op === 0x02) {
        asm = "J " + hex8(target);
        note = "Jump to instruction address " + hex8(target) + ".";
      } else if (op === 0x03) {
        asm = "JAL " + hex8(target);
        note = "Call function at " + hex8(target) + " and save return address in $ra.";
      } else if (op === 0x00 && fn === 0x08) {
        asm = "JR " + MIPS_REGS[rs];
        note = "Jump to address in " + MIPS_REGS[rs] + (rs === 31 ? " (return from function)." : ".");
      } else if (op === 0x00 && fn === 0x21) {
        asm = "ADDU " + MIPS_REGS[rd] + ", " + MIPS_REGS[rs] + ", " + MIPS_REGS[rt];
        note = "Add " + MIPS_REGS[rs] + " + " + MIPS_REGS[rt] + " into " + MIPS_REGS[rd] + ".";
      } else {
        asm = ".WORD " + hex8(word);
        note = "MIPS opcode 0x" + op.toString(16).toUpperCase() + " (data or extended instruction).";
      }
      lines.push({ offset: p, asm: asm, note: note });
      p += 4;
    }
    return lines;
  }

  /* =========================================================================
     2. GEN 4, GEN 5, GEN 6 & GEN 7+ FORMAT IDENTIFIER
     ========================================================================= */
  function unswapN64Header(u8, mode) {
    var out = new Uint8Array(Math.min(64, u8.length)), i;
    if (mode === "v64") {
      for (i = 0; i + 1 < out.length; i += 2) { out[i] = u8[i + 1]; out[i + 1] = u8[i]; }
    } else if (mode === "n64") {
      for (i = 0; i + 3 < out.length; i += 4) {
        out[i] = u8[i + 3]; out[i + 1] = u8[i + 2]; out[i + 2] = u8[i + 1]; out[i + 3] = u8[i];
      }
    } else {
      for (i = 0; i < out.length; i++) out[i] = u8[i];
    }
    return out;
  }

  function identifyGen4To6(u8, fileName) {
    if (!u8 || u8.length < 16) return null;

    /* 1. Gen 5: Nintendo 64 (.z64 big-endian, .v64 byte-swapped, .n64 little-endian) */
    var m0 = u32be(u8, 0);
    if (u8.length >= 64 && (m0 === 0x80371240 || m0 === 0x37804012 || m0 === 0x40123780)) {
      var order = m0 === 0x80371240 ? "z64" : (m0 === 0x37804012 ? "v64" : "n64");
      var hdr = unswapN64Header(u8, order);
      var title = readAscii(hdr, 0x20, 20) || "UNTITLED N64";
      var pc = u32be(hdr, 0x08);
      return {
        ok: true, gen: 5, format: "Nintendo 64 (" + order + ")", cpu: "MIPS R4300i (64-bit RISC)", era: "1996-2001",
        summary: "N64 ROM '" + title + "' stored in " + order + " byte order. MIPS entry point: " + hex8(pc) + ".",
        details: { title: title, byteOrder: order, entryPC: hex8(pc), crc1: hex8(u32be(hdr, 0x10)), codeOffset: u8.length >= 0x1004 ? 0x1000 : -1, mipsBigEndian: true }
      };
    }

    /* 2. Gen 5: PlayStation 1 Executable ("PS-X EXE") */
    if (u8.length >= 0x800 && readAscii(u8, 0, 8) === "PS-X EXE") {
      var psxPC = u32le(u8, 0x10);
      var psxLoad = u32le(u8, 0x18);
      var psxSize = u32le(u8, 0x1C);
      return {
        ok: true, gen: 5, format: "PlayStation 1 (PS-X EXE)", cpu: "MIPS R3000A (32-bit RISC)", era: "1994-2001",
        summary: "PS1 binary with 2,048-byte sector header. Loads " + psxSize + " bytes at RAM " + hex8(psxLoad) + " and jumps to " + hex8(psxPC) + ".",
        details: { entryPC: hex8(psxPC), loadAddr: hex8(psxLoad), payloadBytes: psxSize, codeOffset: 0x800, mipsBigEndian: false }
      };
    }

    /* 3. Gen 6: Sega Dreamcast IP.BIN ("SEGA SEGAKATANA " at 0x000 or 0x010 raw sector) */
    var dcOff = (u8.length >= 0x100 && readAscii(u8, 0, 15) === "SEGA SEGAKATANA") ? 0
              : (u8.length >= 0x110 && readAscii(u8, 0x10, 15) === "SEGA SEGAKATANA") ? 0x10 : -1;
    if (dcOff >= 0) {
      var dcProd = readAscii(u8, dcOff + 0x40, 10);
      var dcDate = readAscii(u8, dcOff + 0x50, 8);
      var dcBoot = readAscii(u8, dcOff + 0x60, 16);
      var dcTitle = readAscii(u8, dcOff + 0x80, 64) || "UNTITLED DC";
      return {
        ok: true, gen: 6, format: "Sega Dreamcast (IP.BIN)", cpu: "Hitachi SH-4 (32-bit RISC)", era: "1998-2001",
        summary: "Dreamcast disc '" + dcTitle + "' (ID: " + dcProd + ", Date: " + dcDate + ", Boot: " + dcBoot + ").",
        details: { title: dcTitle, productId: dcProd, releaseDate: dcDate, bootFile: dcBoot, codeOffset: -1 }
      };
    }

    /* 4. Gen 6: Nintendo GameCube (.iso / .gcm — magic 0xC2339F3D at +0x1C) */
    if (u8.length >= 0x60 && u32be(u8, 0x1C) === 0xC2339F3D) {
      var gcId = readAscii(u8, 0, 6);
      var gcTitle = readAscii(u8, 0x20, 64) || "UNTITLED GC";
      return {
        ok: true, gen: 6, format: "Nintendo GameCube (GCM/ISO)", cpu: "IBM PowerPC Gekko (32-bit)", era: "2001-2006",
        summary: "GameCube disc '" + gcTitle + "' (Game ID: " + gcId + "). Unencrypted Gen 6 header verified via magic 0xC2339F3D.",
        details: { gameId: gcId, title: gcTitle, codeOffset: -1 }
      };
    }

    /* 5. Gen 7 Boundary Check: Nintendo Wii (magic 0x5D1C9EA3 at +0x18) */
    if (u8.length >= 0x60 && u32be(u8, 0x18) === 0x5D1C9EA3) {
      var wiiId = readAscii(u8, 0, 6);
      var wiiTitle = readAscii(u8, 0x20, 64) || "UNTITLED WII";
      return {
        ok: true, gen: 7, encryptedPartitions: true, format: "Nintendo Wii (Gen 7 Encrypted Boundary)", cpu: "IBM PowerPC Broadway", era: "2006-2013",
        summary: "Wii disc header '" + wiiTitle + "' (ID: " + wiiId + "). Gen 7 partitions are AES-encrypted; Evelyn stops at the public header and does not decrypt retail media.",
        details: { gameId: wiiId, title: wiiTitle, encrypted: true, codeOffset: -1 }
      };
    }

    /* 6. Gen 6: Game Boy Advance (.gba — fixed 0x96 at 0xB2 + complement checksum at 0xBD) */
    if (u8.length >= 0xC0 && u8[0xB2] === 0x96) {
      var gbaChk = 0;
      for (var i = 0xA0; i <= 0xBC; i++) gbaChk = (gbaChk - u8[i]) & 0xFF;
      gbaChk = (gbaChk - 0x19) & 0xFF;
      if (gbaChk === u8[0xBD]) {
        var gbaTitle = readAscii(u8, 0xA0, 12) || "UNTITLED GBA";
        var gbaCode = readAscii(u8, 0xAC, 4);
        return {
          ok: true, gen: 6, format: "Game Boy Advance (.gba)", cpu: "ARM7TDMI (32-bit ARM / 16-bit Thumb)", era: "2001-2007",
          summary: "GBA ROM '" + gbaTitle + "' (Code: " + gbaCode + "). Header complement checksum valid (0x" + gbaChk.toString(16).toUpperCase() + ").",
          details: { title: gbaTitle, gameCode: gbaCode, checksumValid: true, codeOffset: 0 }
        };
      }
    }

    /* 7. Gen 6: PlayStation 2 / Standard 32-bit ELF Executable (\x7FELF) */
    if (u8.length >= 52 && u8[0] === 0x7F && u8[1] === 0x45 && u8[2] === 0x4C && u8[3] === 0x46) {
      var isLE = (u8[5] === 1);
      var mach = isLE ? u16le(u8, 18) : ((u8[18] << 8) | u8[19]);
      var entry = isLE ? u32le(u8, 24) : u32be(u8, 24);
      var cpuName = mach === 8 ? "MIPS R5900 (PlayStation 2 / MIPS)" : (mach === 40 ? "ARM" : (mach === 3 ? "x86" : "Machine #" + mach));
      return {
        ok: true, gen: 6, format: mach === 8 ? "PlayStation 2 / MIPS ELF" : "ELF Executable", cpu: cpuName, era: "1999+",
        summary: "Standard ELF binary for " + cpuName + " (" + (isLE ? "little-endian" : "big-endian") + "), entry point " + hex8(entry) + ".",
        details: { machine: mach, littleEndian: isLE, entryPC: hex8(entry), codeOffset: -1 }
      };
    }

    /* 8. Gen 4: Sega Genesis / Mega Drive ("SEGA MEGA DRIVE" or "SEGA GENESIS" at 0x100) */
    if (u8.length >= 0x1B0) {
      var mdSig = readAscii(u8, 0x100, 16);
      if (mdSig.indexOf("SEGA MEGA DRIVE") === 0 || mdSig.indexOf("SEGA GENESIS") === 0) {
        var mdTitle = readAscii(u8, 0x150, 48) || readAscii(u8, 0x120, 48) || "UNTITLED MD";
        var mdSerial = readAscii(u8, 0x180, 14);
        return {
          ok: true, gen: 4, format: "Sega Genesis / Mega Drive", cpu: "Motorola 68000 (16/32-bit) + Z80", era: "1988-1996",
          summary: "Mega Drive ROM '" + mdTitle + "' (Serial: " + mdSerial + "). Dual-CPU layout: 68000 runs game logic, Z80 drives sound.",
          details: { title: mdTitle, serial: mdSerial, romEnd: hex8(u32be(u8, 0x1A4)), codeOffset: 0x200 }
        };
      }
    }

    return null;
  }

  /* Unified Gen 1..6 analyzer (checks Gen 4-6 first, then falls back to EvelynGameXRay Gen 1-4) */
  function analyzeUpToGen6(arrayBufOrU8, fileName) {
    var u8 = arrayBufOrU8 instanceof Uint8Array ? arrayBufOrU8
           : (arrayBufOrU8 && arrayBufOrU8.byteLength !== undefined ? new Uint8Array(arrayBufOrU8) : null);
    if (!u8 || u8.length === 0) return { ok: false, error: "Empty file." };

    var ext = identifyGen4To6(u8, fileName);
    if (!ext) return Base.analyzeGameFile(u8, fileName);

    var disasm = [];
    if ((ext.format.indexOf("PlayStation 1") === 0 || ext.format.indexOf("Nintendo 64") === 0) && ext.details.codeOffset >= 0) {
      disasm = disassembleMIPS(u8, ext.details.codeOffset, 10, !!ext.details.mipsBigEndian);
    }
    return {
      ok: true,
      fileName: fileName || "retro.bin",
      bytes: u8.length,
      gen: ext.gen,
      encryptedPartitions: !!ext.encryptedPartitions,
      format: ext.format,
      cpu: ext.cpu,
      era: ext.era,
      summary: ext.summary,
      details: ext.details,
      entropyMap: Base.profileEntropy(u8, 12),
      strings: ext.encryptedPartitions ? [] : Base.extractStrings(u8, 5, 16),
      disassembly: disasm
    };
  }

  /* Weak-CPU Browser Helper: reads only the first 128 KB of a 700 MB / 4.7 GB ISO! */
  function inspectBrowserFileSlice(fileObj, cb) {
    if (!fileObj || typeof FileReader === "undefined") {
      if (cb) cb({ ok: false, error: "Browser File API unavailable." });
      return;
    }
    var slice = fileObj.slice ? fileObj.slice(0, Math.min(fileObj.size, 131072)) : fileObj;
    var r = new FileReader();
    r.onload = function () {
      var rep = analyzeUpToGen6(r.result, fileObj.name);
      rep.fullDiskBytes = fileObj.size;
      rep.streamedSliceBytes = slice.size;
      if (cb) cb(rep);
    };
    r.onerror = function () { if (cb) cb({ ok: false, error: "Could not read file slice." }); };
    r.readAsArrayBuffer(slice);
  }

  root.EvelynGameXRayGen6 = {
    disassembleMIPS: disassembleMIPS,
    identifyGen4To6: identifyGen4To6,
    analyzeUpToGen6: analyzeUpToGen6,
    inspectBrowserFileSlice: inspectBrowserFileSlice
  };
})(typeof window !== "undefined" ? window : global);
