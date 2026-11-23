/* evelyn_game_xray.js - Offline Static Retro-Game Dissector & Explainer for Evelyn
   Inspects iNES (.nes), Game Boy (.gb/.gbc), WAD (.wad), MS-DOS (.exe),
   ISO 9660 (.iso), CHIP-8 (.ch8), and plain source files (.js/.bas/.c).
   Decodes 2bpp planar tiles, computes Shannon entropy maps, extracts ASCII strings,
   disassembles 6502 & CHIP-8 instructions, and generates Evelyn lessons.
   Pure ES5. Zero external dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    if (!root.EvelynBackend) require("./evelyn_backend.js");
    if (!root.EvelynEvolution) require("./evelyn_evolution.js");
    if (!root.EvelynVoiceGuard) require("./evelyn_voice_guard.js");
  }

  var E = root.EvelynEvolution;
  var VG = root.EvelynVoiceGuard;

  var MAX_SCAN_BYTES = 2 * 1024 * 1024; // Fuel cap: inspect at most 2 MB slice on weak CPUs

  function readAscii(u8, start, len) {
    var out = "", end = Math.min(u8.length, start + len);
    for (var i = start; i < end; i++) {
      var b = u8[i];
      if (b === 0) break;
      if (b >= 32 && b <= 126) out += String.fromCharCode(b);
    }
    return out.trim();
  }

  function u16le(u8, off) { return u8[off] | (u8[off + 1] << 8); }
  function u32le(u8, off) {
    return ((u8[off]) | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0;
  }

  /* =========================================================================
     1. FORMAT FINGERPRINTER & HEADER PARSERS
     ========================================================================= */
  function identifyBinary(u8, fileName) {
    if (!u8 || u8.length === 0) return { ok: false, error: "Empty file (0 bytes)." };
    var name = String(fileName || "").toLowerCase();

    /* A. iNES (.nes) — 16-byte header starting with "NES\x1A" */
    if (u8.length >= 16 && u8[0] === 0x4E && u8[1] === 0x45 && u8[2] === 0x53 && u8[3] === 0x1A) {
      var prgBanks = u8[4], chrBanks = u8[5], f6 = u8[6], f7 = u8[7];
      var mapper = (f7 & 0xF0) | (f6 >> 4);
      var trainer = (f6 & 4) ? 512 : 0;
      var chrOffset = 16 + trainer + prgBanks * 16384;
      var prgKB = prgBanks * 16, chrKB = chrBanks * 8;
      var tileCount = chrBanks > 0 ? Math.floor((chrKB * 1024) / 16) : 0;
      return {
        ok: true, format: "NES (iNES)", cpu: "6502 (Ricoh 2A03)", era: "1983-1995",
        summary: "NES cartridge with " + prgKB + " KB of 6502 program code (PRG), " +
                 (chrBanks > 0 ? (chrKB + " KB of 2bpp tile art (" + tileCount + " 8x8 tiles)") : "CHR-RAM (drawn by code)") +
                 ", Mapper #" + mapper + ", and " + ((f6 & 1) ? "Vertical" : "Horizontal") + " scroll mirroring.",
        details: {
          prgKB: prgKB, chrKB: chrKB, tileCount: tileCount, mapper: mapper,
          mirroring: (f6 & 1) ? "Vertical" : "Horizontal",
          batterySave: !!(f6 & 2),
          codeOffset: 16 + trainer,
          tileOffset: chrBanks > 0 && chrOffset < u8.length ? chrOffset : -1,
          tileMode: "nes_2bpp"
        }
      };
    }

    /* B. Game Boy / GBC (.gb / .gbc) — Check header checksum at 0x014D or logo bytes at 0x0104 */
    if (u8.length >= 0x0150) {
      var chk = 0, i;
      for (i = 0x0134; i <= 0x014C; i++) chk = (chk - u8[i] - 1) & 0xFF;
      var logoMatch = (u8[0x0104] === 0xCE && u8[0x0105] === 0xED && u8[0x0106] === 0x66 && u8[0x0107] === 0x66);
      if (logoMatch || (chk === u8[0x014D] && (name.indexOf(".gb") >= 0 || u8[0x0148] <= 8))) {
        var title = readAscii(u8, 0x0134, 15) || "UNTITLED";
        var cartType = u8[0x0147];
        var romKB = 32 << Math.min(8, u8[0x0148]);
        var mbc = cartType === 0 ? "ROM Only (32 KB)" : (cartType <= 3 ? "MBC1" : (cartType <= 0x13 ? "MBC3" : "MBC5/Other"));
        return {
          ok: true, format: "Game Boy", cpu: "Sharp SM83 (8-bit Z80-like)", era: "1989-2001",
          summary: "Game Boy ROM '" + title + "' (" + romKB + " KB, controller " + mbc + "). Header checksum " +
                   (chk === u8[0x014D] ? "valid (0x" + chk.toString(16) + ")." : "mismatch."),
          details: {
            title: title, romKB: romKB, mapper: mbc, checksumValid: chk === u8[0x014D],
            codeOffset: 0x0150, tileOffset: u8.length >= 0x0200 ? 0x0150 : -1, tileMode: "gb_2bpp"
          }
        };
      }
    }

    /* C. DOOM-Style WAD Archive ("IWAD" or "PWAD") */
    if (u8.length >= 12) {
      var sig4 = readAscii(u8, 0, 4);
      if (sig4 === "IWAD" || sig4 === "PWAD") {
        var numLumps = u32le(u8, 4), dirOff = u32le(u8, 8);
        var lumpNames = [];
        if (dirOff < u8.length) {
          var maxL = Math.min(numLumps, 16);
          for (var l = 0; l < maxL; l++) {
            var pos = dirOff + l * 16;
            if (pos + 16 > u8.length) break;
            lumpNames.push(readAscii(u8, pos + 8, 8));
          }
        }
        return {
          ok: true, format: "WAD (" + sig4 + ")", cpu: "x86 / Engine Data Archive", era: "1993+",
          summary: sig4 + " asset pack holding " + numLumps + " named data lumps (maps, textures, palettes, sounds). Sample lumps: " + (lumpNames.join(", ") || "none") + ".",
          details: { kind: sig4, numLumps: numLumps, dirOffset: dirOff, sampleLumps: lumpNames, codeOffset: -1, tileOffset: -1 }
        };
      }
    }

    /* D. ISO 9660 CD-ROM Image (Primary Volume Descriptor at Sector 16 = 0x8000) */
    if (u8.length >= 0x8054 && u8[0x8000] === 0x01 && readAscii(u8, 0x8001, 5) === "CD001") {
      var sysId = readAscii(u8, 0x8008, 32) || "Unknown";
      var volId = readAscii(u8, 0x8028, 32) || "UNTITLED_DISC";
      var sectors = u32le(u8, 0x8050);
      var estMB = ((sectors * 2048) / (1024 * 1024)).toFixed(1);
      return {
        ok: true, format: "ISO 9660 CD-ROM", cpu: "Optical Disc Filesystem", era: "1988-2005",
        summary: "CD-ROM volume '" + volId + "' (System: " + sysId + "), " + sectors + " sectors of 2,048 bytes (~" + estMB + " MB total).",
        details: { volumeId: volId, systemId: sysId, sectors: sectors, sectorSize: 2048, codeOffset: -1, tileOffset: -1 }
      };
    }

    /* E. MS-DOS MZ Executable (.exe) */
    if (u8.length >= 28 && u8[0] === 0x4D && u8[1] === 0x5A) {
      var pages = u16le(u8, 4), relocs = u16le(u8, 6), hdrParas = u16le(u8, 8);
      var initIP = u16le(u8, 20), initCS = u16le(u8, 22);
      var codeStart = hdrParas * 16;
      return {
        ok: true, format: "MS-DOS MZ Executable", cpu: "16-bit x86 (8086/286/386/486)", era: "1981-1998",
        summary: "DOS MZ program: " + pages + " pages (512 bytes each), " + relocs + " segment relocations, header " + codeStart + " bytes, entry CS:IP = " + initCS.toString(16) + ":" + initIP.toString(16) + ".",
        details: { pages: pages, relocations: relocs, headerBytes: codeStart, initCS: initCS, initIP: initIP, codeOffset: codeStart, tileOffset: -1 }
      };
    }

    /* F. CHIP-8 VM ROM (.ch8 or tiny <= 3584-byte big-endian binary) */
    if (name.indexOf(".ch8") >= 0 || (u8.length >= 2 && u8.length <= 3584 && (u8[0] === 0x00 || (u8[0] >> 4) === 0x6 || (u8[0] >> 4) === 0xA || (u8[0] >> 4) === 0x1))) {
      return {
        ok: true, format: "CHIP-8 VM Program", cpu: "CHIP-8 Interpreted VM (16 registers, 64x32 display)", era: "1977-present",
        summary: "CHIP-8 game binary (" + u8.length + " bytes = " + Math.floor(u8.length / 2) + " two-byte opcodes). Loads at address 0x200 and draws sprites by XOR.",
        details: { opcodes: Math.floor(u8.length / 2), loadAddress: 0x200, codeOffset: 0, tileOffset: -1 }
      };
    }

    return {
      ok: true, format: "Raw Binary / Unknown Retro Format", cpu: "Unknown", era: "Retro",
      summary: "Unrecognized binary (" + u8.length + " bytes). Inspect the entropy map and extracted ASCII strings below to locate text, art, and code.",
      details: { bytes: u8.length, codeOffset: -1, tileOffset: -1 }
    };
  }

  /* =========================================================================
     2. 2BPP PLANAR 8x8 TILE DECODER (NES & GAME BOY GRAPHICS FORMAT)
        Returns array of 64-pixel Uint8Arrays (palette indices 0..3).
     ========================================================================= */
  function decode2BppTiles(u8, startOffset, maxTiles, mode) {
    if (!u8 || startOffset < 0 || startOffset >= u8.length) return [];
    var count = Math.min(maxTiles || 16, Math.floor((u8.length - startOffset) / 16));
    var tiles = [], t, y, x;
    for (t = 0; t < count; t++) {
      var base = startOffset + t * 16;
      var pixels = new Uint8Array(64);
      for (y = 0; y < 8; y++) {
        var lo = mode === "gb_2bpp" ? u8[base + y * 2] : u8[base + y];
        var hi = mode === "gb_2bpp" ? u8[base + y * 2 + 1] : u8[base + y + 8];
        for (x = 0; x < 8; x++) {
          var shift = 7 - x;
          pixels[y * 8 + x] = ((lo >> shift) & 1) | (((hi >> shift) & 1) << 1);
        }
      }
      tiles.push(pixels);
    }
    return tiles;
  }

  /* =========================================================================
     3. SHANNON ENTROPY MAP PROFILER (REVEALS PADDING vs TEXT vs CODE vs COMPRESSED)
     ========================================================================= */
  function profileEntropy(u8, buckets) {
    var total = Math.min(u8.length, MAX_SCAN_BYTES);
    var numB = Math.max(1, Math.min(buckets || 16, total));
    var sliceSize = Math.max(1, Math.floor(total / numB));
    var out = [], b, i;
    var counts = new Uint32Array(256);

    for (b = 0; b < numB; b++) {
      for (i = 0; i < 256; i++) counts[i] = 0;
      var s = b * sliceSize;
      var e = (b === numB - 1) ? total : Math.min(total, s + sliceSize);
      var len = Math.max(1, e - s);
      for (i = s; i < e; i++) counts[u8[i]]++;
      var H = 0.0;
      for (i = 0; i < 256; i++) {
        if (counts[i] > 0) {
          var p = counts[i] / len;
          H -= p * (Math.log(p) / Math.LN2);
        }
      }
      var guess = H < 1.5 ? "Empty padding / blank bank"
                : H < 4.8 ? "Text, maps, or uncompressed tiles"
                : H < 7.3 ? "Compiled machine code or mixed tables"
                : "Compressed data or raw audio";
      out.push({ offset: s, bytes: len, entropy: Number(H.toFixed(2)), guess: guess });
    }
    return out;
  }

  /* =========================================================================
     4. PRINTABLE ASCII STRING EXTRACTOR (FUEL-CAPPED)
     ========================================================================= */
  function extractStrings(u8, minLen, maxCount) {
    var minL = minLen || 5, cap = maxCount || 24;
    var scanLen = Math.min(u8.length, 262144);
    var res = [], cur = "", start = 0;
    for (var i = 0; i < scanLen && res.length < cap; i++) {
      var b = u8[i];
      if (b >= 32 && b <= 126) {
        if (cur.length === 0) start = i;
        cur += String.fromCharCode(b);
      } else {
        if (cur.length >= minL) res.push({ offset: start, text: cur.slice(0, 64) });
        cur = "";
      }
    }
    if (cur.length >= minL && res.length < cap) res.push({ offset: start, text: cur.slice(0, 64) });
    return res;
  }

  /* =========================================================================
     5. EDUCATIONAL DISASSEMBLERS (6502 & CHIP-8 WITH PLAIN ENGLISH NOTES)
     ========================================================================= */
  function hex2(n) { return (n < 16 ? "0" : "") + (n & 255).toString(16).toUpperCase(); }
  function hex4(n) { return hex2((n >> 8) & 255) + hex2(n & 255); }

  function disassemble6502(u8, startOffset, maxInst) {
    var lines = [], p = startOffset || 0, lim = maxInst || 12;
    while (p < u8.length && lines.length < lim) {
      var op = u8[p], b1 = u8[p + 1] || 0, b2 = u8[p + 2] || 0;
      var abs = b1 | (b2 << 8);
      var item;
      if (op === 0x78)      item = { bytes: 1, asm: "SEI", note: "Turn off interrupts while setting up hardware." };
      else if (op === 0xD8) item = { bytes: 1, asm: "CLD", note: "Clear decimal math mode (standard NES boot)." };
      else if (op === 0xA9) item = { bytes: 2, asm: "LDA #$" + hex2(b1), note: "Load number " + b1 + " into register A." };
      else if (op === 0xA2) item = { bytes: 2, asm: "LDX #$" + hex2(b1), note: "Load number " + b1 + " into index register X." };
      else if (op === 0xA0) item = { bytes: 2, asm: "LDY #$" + hex2(b1), note: "Load number " + b1 + " into index register Y." };
      else if (op === 0x8D) item = { bytes: 3, asm: "STA $" + hex4(abs), note: "Store register A into memory/hardware address $" + hex4(abs) + "." };
      else if (op === 0xAD) item = { bytes: 3, asm: "LDA $" + hex4(abs), note: "Read memory/hardware address $" + hex4(abs) + " into A." };
      else if (op === 0x4C) item = { bytes: 3, asm: "JMP $" + hex4(abs), note: "Jump straight to address $" + hex4(abs) + " (game loop)." };
      else if (op === 0x20) item = { bytes: 3, asm: "JSR $" + hex4(abs), note: "Call subroutine at $" + hex4(abs) + "." };
      else if (op === 0x60) item = { bytes: 1, asm: "RTS", note: "Return from subroutine." };
      else if (op === 0xE8) item = { bytes: 1, asm: "INX", note: "Add 1 to register X (loop counter)." };
      else if (op === 0xCA) item = { bytes: 1, asm: "DEX", note: "Subtract 1 from register X (countdown)." };
      else if (op === 0xD0) item = { bytes: 2, asm: "BNE " + (b1 > 127 ? b1 - 256 : b1), note: "Branch if last result was not zero (loop repeat)." };
      else if (op === 0xEA) item = { bytes: 1, asm: "NOP", note: "Wait 2 CPU cycles (timing pad)." };
      else                  item = { bytes: 1, asm: ".BYTE $" + hex2(op), note: "Data byte or extended opcode 0x" + hex2(op) + "." };
      lines.push({ offset: p, asm: item.asm, note: item.note });
      p += item.bytes;
    }
    return lines;
  }

  function disassembleChip8(u8, startOffset, maxInst) {
    var lines = [], p = startOffset || 0, lim = maxInst || 12;
    while (p + 1 < u8.length && lines.length < lim) {
      var op = (u8[p] << 8) | u8[p + 1];
      var hi = (op >> 12) & 0xF, x = (op >> 8) & 0xF, y = (op >> 4) & 0xF, n = op & 0xF, nn = op & 0xFF, nnn = op & 0xFFF;
      var asm = "DATA " + hex4(op), note = "Sprite/data bytes.";
      if (op === 0x00E0) { asm = "CLS"; note = "Clear the 64x32 monochrome screen."; }
      else if (op === 0x00EE) { asm = "RET"; note = "Return from subroutine."; }
      else if (hi === 0x1) { asm = "JP $" + hex4(nnn); note = "Jump to address 0x" + hex4(nnn) + " (main game loop)."; }
      else if (hi === 0x6) { asm = "LD V" + x.toString(16).toUpperCase() + ", " + nn; note = "Set register V" + x + " to " + nn + "."; }
      else if (hi === 0x7) { asm = "ADD V" + x.toString(16).toUpperCase() + ", " + nn; note = "Add " + nn + " to register V" + x + "."; }
      else if (hi === 0xA) { asm = "LD I, $" + hex4(nnn); note = "Point sprite index I to address 0x" + hex4(nnn) + "."; }
      else if (hi === 0xD) { asm = "DRW V" + x + ", V" + y + ", " + n; note = "Draw " + n + "-row XOR sprite at (V" + x + ", V" + y + "); sets VF=1 on collision."; }
      lines.push({ offset: p, asm: asm, note: note });
      p += 2;
    }
    return lines;
  }

  /* =========================================================================
     6. FULL ANALYSIS PIPELINE + EVELYN LESSON CONVERTER
     ========================================================================= */
  function analyzeGameFile(arrayBufOrU8, fileName) {
    var u8 = arrayBufOrU8 instanceof Uint8Array ? arrayBufOrU8
           : (arrayBufOrU8 && arrayBufOrU8.byteLength !== undefined ? new Uint8Array(arrayBufOrU8) : null);
    if (!u8 || u8.length === 0) return { ok: false, error: "File is empty or unreadable." };

    var id = identifyBinary(u8, fileName);
    if (!id.ok) return id;

    var entropyMap = profileEntropy(u8, 12);
    var strings = extractStrings(u8, 5, 16);
    var tiles = (id.details.tileOffset >= 0) ? decode2BppTiles(u8, id.details.tileOffset, 8, id.details.tileMode) : [];
    var disasm = [];
    if (id.format === "NES (iNES)" && id.details.codeOffset >= 0) {
      disasm = disassemble6502(u8, id.details.codeOffset, 10);
    } else if (id.format === "CHIP-8 VM Program") {
      disasm = disassembleChip8(u8, 0, 10);
    }

    var summary = VG ? VG.clean(id.summary, { trackHistory: false }) : id.summary;
    return {
      ok: true,
      fileName: fileName || "game.bin",
      bytes: u8.length,
      format: id.format,
      cpu: id.cpu,
      era: id.era,
      summary: summary,
      details: id.details,
      entropyMap: entropyMap,
      strings: strings,
      tilesDecoded: tiles.length,
      tiles: tiles,
      disassembly: disasm
    };
  }

  /* Turn any dissected retro game into an Evelyn lesson that evolves all 78 cartridges */
  function createEvelynLesson(report, profile) {
    if (!report || !report.ok) return null;
    var facts = [
      "What platform format is " + report.fileName + "? | " + report.format + " | " + report.summary,
      "How many bytes does one 8x8 2-bit planar retro tile use? | 16 bytes | 64 pixels times 2 bits equals 128 bits, which is 16 bytes."
    ];
    if (report.details && report.details.tileCount > 0) {
      facts.push("How many 8x8 tiles fit in " + report.details.chrKB + " KB of CHR art? | " + report.details.tileCount + " | Multiply KB by 1024 and divide by 16 bytes per tile.");
    }
    if (report.format === "ISO 9660 CD-ROM") {
      facts.push("How many bytes are in one standard ISO 9660 CD-ROM data sector? | 2048 | Sector 16 starts at 16 * 2048 = 32,768 bytes (0x8000).");
    }
    if (E && profile) {
      return E.logLesson(profile, "Retro Game X-Ray: " + report.fileName, ["coding", "math"], facts);
    }
    return { title: "Retro Game X-Ray: " + report.fileName, facts: facts };
  }

  root.EvelynGameXRay = {
    identifyBinary: identifyBinary,
    decode2BppTiles: decode2BppTiles,
    profileEntropy: profileEntropy,
    extractStrings: extractStrings,
    disassemble6502: disassemble6502,
    disassembleChip8: disassembleChip8,
    analyzeGameFile: analyzeGameFile,
    createEvelynLesson: createEvelynLesson
  };
})(typeof window !== "undefined" ? window : global);
