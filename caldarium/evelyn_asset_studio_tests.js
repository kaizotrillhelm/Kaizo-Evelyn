/* evelyn_asset_studio_tests.js - Automated ES5 Tests for EvelynAssetStudio
   Run in Node.js: node evelyn_asset_studio_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_sentinel.js");
    require("./evelyn_evolution.js");
    require("./evelyn_voice_guard.js");
    require("./evelyn_game_xray.js");
    require("./evelyn_asset_studio.js");
  }

  var GX = root.EvelynGameXRay;
  var AS = root.EvelynAssetStudio;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Multi-frame sprite editing, horizontal flip, and hold-weighted animation timing */
  test("SpriteClip: Pixel paint, horizontal flip, and hold-weighted frame animation", function (done) {
    var spr = new AS.SpriteClip({ id: "hero_1", name: "Neon Fox", width: 8, height: 8, fps: 4 });
    spr.setPixel(0, 1, 2, 3); // pink pixel at (1,2)
    spr.addFrame(0, 2);       // frame 1 holds for 2 ticks
    spr.flipHorizontal(1);
    assertEq(spr.getPixel(0, 1, 2), 3, "Frame 0 pixel mismatch");
    assertEq(spr.getPixel(1, 6, 2), 3, "Flipped frame 1 pixel should move from x=1 to x=6");
    assertEq(spr.frameAtMs(0), 0, "0ms should show frame 0");
    assertEq(spr.frameAtMs(260), 1, "260ms (tick 1 at 4fps) should show frame 1");
    assertEq(spr.frameAtMs(520), 1, "520ms (tick 2, held) should stay on frame 1");
    assertEq(spr.frameAtMs(760), 0, "760ms (tick 3) should loop back to frame 0");
    done();
  });

  /* 2. Exact NES & Game Boy 2bpp planar tile encoding <-> decoding round-trip */
  test("RetroTileCodec: Bit-exact 8x8 tile encode/decode round-trip for NES and Game Boy", function (done) {
    var px = new Uint8Array(64);
    for (var i = 0; i < 64; i++) px[i] = (i + Math.floor(i / 8)) & 3;

    var nesBytes = AS.RetroTileCodec.encode2BppTile(px, "nes_2bpp");
    var nesBack = GX.decode2BppTiles(nesBytes, 0, 1, "nes_2bpp")[0];
    var gbBytes = AS.RetroTileCodec.encode2BppTile(px, "gb_2bpp");
    var gbBack = GX.decode2BppTiles(gbBytes, 0, 1, "gb_2bpp")[0];

    for (var j = 0; j < 64; j++) {
      assertEq(nesBack[j], px[j], "NES 2bpp round-trip mismatch at pixel " + j);
      assertEq(gbBack[j], px[j], "Game Boy 2bpp round-trip mismatch at pixel " + j);
    }
    done();
  });

  /* 3. Non-destructive IPS binary patch creation & application on a retro ROM */
  test("IPSPatcher: Creates 29-byte IPS patch for custom sprite swap and applies cleanly to untouched ROM", function (done) {
    var rom = new Uint8Array(16 + 16384 + 8192);
    rom[0] = 0x4E; rom[1] = 0x45; rom[2] = 0x53; rom[3] = 0x1A; rom[4] = 1; rom[5] = 1;
    var chrOffset = 16 + 16384;

    /* Draw a custom smiley 8x8 tile (color index 2) and swap it into tile #0 of CHR bank */
    var customTile = new Uint8Array(64);
    customTile[9] = 2; customTile[14] = 2; customTile[42] = 3; customTile[45] = 3;
    var swap = AS.RetroTileCodec.replaceRomTile(rom, chrOffset, customTile, "nes_2bpp");
    assert(swap.ok, "replaceRomTile failed");

    var ips = AS.IPSPatcher.createPatch(rom, swap.modifiedRom);
    assert(ips.ok && ips.recordCount >= 1 && ips.bytes <= 35, "Expected tiny <= 35-byte IPS patch, got " + ips.bytes);

    /* Apply IPS patch to untouched original ROM and verify exact match */
    var applied = AS.IPSPatcher.applyPatch(rom, ips.patch);
    assert(applied.ok, "applyPatch failed: " + applied.error);
    var decoded = GX.decode2BppTiles(applied.patched, chrOffset, 1, "nes_2bpp")[0];
    assertEq(decoded[9], 2, "Patched ROM missing custom eye pixel");
    assertEq(decoded[42], 3, "Patched ROM missing custom smile pixel");

    /* Corrupt IPS file must be rejected cleanly */
    assert(!AS.IPSPatcher.applyPatch(rom, new Uint8Array([1, 2, 3])).ok, "Corrupt IPS must fail");
    done();
  });

  /* 4. Extract background tiles from Game A -> transplant into Game B + .evasset export/import */
  test("AssetSkinRegistry: Transplants ROM background + custom sprite across cartridges & verifies .evasset", function (done) {
    var rawTiles = [new Uint8Array(64), new Uint8Array(64)];
    for (var i = 0; i < 64; i++) { rawTiles[0][i] = (i % 2) ? 1 : 0; rawTiles[1][i] = 2; }

    var bg = AS.extractBackgroundFromTiles(rawTiles, "homebrew_space.nes", 12, 8);
    var hero = new AS.SpriteClip({ id: "kid_ship", name: "Kid Ship", width: 8, height: 8, fps: 6 });
    hero.setPixel(0, 4, 2, 2);

    var reg = new AS.AssetSkinRegistry();
    reg.registerBackground(bg);
    reg.registerSprite(hero);
    reg.bindToCartridge("static_choir_tune_up", "background", bg.id);
    reg.bindToCartridge("static_choir_tune_up", "playerSprite", hero.id);
    reg.bindToCartridge("room_p1_maze", "background", bg.id);

    var skin1 = reg.getSkin("static_choir_tune_up");
    var skin2 = reg.getSkin("room_p1_maze");
    assert(skin1.background && skin1.background.sourceGame === "homebrew_space.nes", "Background transplant to Cartridge #1 failed");
    assert(skin1.playerSprite && skin1.playerSprite.name === "Kid Ship", "Custom sprite binding failed");
    assert(skin2.background && skin2.background.id === bg.id, "Background transplant to Cartridge #18 failed");

    /* Round-trip export/import of .evasset bundle with CRC32 integrity */
    var expBg = reg.exportAsset("background", bg.id);
    assert(expBg.ok, "exportAsset failed");
    var reg2 = new AS.AssetSkinRegistry();
    var impBg = reg2.importAsset(expBg.bundle);
    assert(impBg.ok && impBg.kind === "background" && impBg.asset.tiles.length === 2, "importAsset round-trip failed");
    assert(!reg2.importAsset(expBg.bundle.slice(0, -4)).ok, "Truncated .evasset must fail CRC32");
    done();
  });

  /* 5. Palette contrast auditor catches dark-on-dark silhouette mergers */
  test("PaletteAuditor: Flags low-contrast dark-on-dark swaps and approves bright neon separation", function (done) {
    var bad = AS.PaletteAuditor.checkSpriteOnBackground("#101430", "#04041c");
    assert(!bad.ok && bad.ratio < 3.0, "Dark navy on dark navy must fail contrast check");
    var good = AS.PaletteAuditor.checkSpriteOnBackground("#48fca8", "#04041c");
    assert(good.ok && good.ratio > 10.0, "Neon mint on deep navy must pass contrast check");
    done();
  });

  /* 6. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_asset_studio.js and tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_asset_studio.js", "evelyn_asset_studio_tests.js"];
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
      console.log("\n=== ASSET STUDIO & IPS PATCHER RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN ASSET STUDIO, BACKGROUND SWAP & IPS TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
