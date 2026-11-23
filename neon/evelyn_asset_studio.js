/* evelyn_asset_studio.js - Custom Sprite & Animation Studio, Cross-Game Background
   Transplanter, NES/Game Boy 2bpp Tile Encoder, Non-Destructive IPS Binary Patcher,
   and Cinematography Palette Contrast Auditor.
   Pure ES5. Zero dependencies. Runs in Browser and Node.js. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    if (!root.EvelynBackend) require("./evelyn_backend.js");
    if (!root.EvelynSentinel) require("./evelyn_sentinel.js");
    if (!root.EvelynGameXRay) require("./evelyn_game_xray.js");
  }

  var B = root.EvelynBackend;
  var Sent = root.EvelynSentinel;

  var DEFAULT_PALETTE = [
    null,       // 0: transparent
    "#28e4fc",  // 1: neon cyan
    "#48fca8",  // 2: neon mint
    "#fc48e8",  // 3: neon pink
    "#fcd838",  // 4: amber gold
    "#f0f8fc",  // 5: bright white
    "#fc5888",  // 6: coral red
    "#4888fc"   // 7: electric blue
  ];

  /* =========================================================================
     1. SPRITE & MULTI-FRAME ANIMATION CLIP (8x8 or 16x16 Indexed Pixels)
     ========================================================================= */
  function SpriteClip(opts) {
    opts = opts || {};
    this.id = opts.id || ("spr_" + Date.now());
    this.name = opts.name || "Custom Sprite";
    this.width = opts.width || 8;
    this.height = opts.height || 8;
    this.palette = opts.palette ? opts.palette.slice(0) : DEFAULT_PALETTE.slice(0);
    this.fps = opts.fps || 8;
    this.frames = []; // Array of { pixels: Uint8Array, hold: 1 }
    if (opts.frames && opts.frames.length) {
      for (var i = 0; i < opts.frames.length; i++) {
        this.frames.push({ pixels: new Uint8Array(opts.frames[i].pixels), hold: opts.frames[i].hold || 1 });
      }
    } else {
      this.addFrame();
    }
  }

  SpriteClip.prototype.addFrame = function (copyFromIdx, hold) {
    var px = new Uint8Array(this.width * this.height);
    if (copyFromIdx !== undefined && this.frames[copyFromIdx]) {
      px.set(this.frames[copyFromIdx].pixels);
    }
    this.frames.push({ pixels: px, hold: hold || 1 });
    return this.frames.length - 1;
  };

  SpriteClip.prototype.setPixel = function (frameIdx, x, y, colorIdx) {
    var f = this.frames[frameIdx];
    if (!f || x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    f.pixels[y * this.width + x] = colorIdx & 255;
  };

  SpriteClip.prototype.getPixel = function (frameIdx, x, y) {
    var f = this.frames[frameIdx];
    if (!f || x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return f.pixels[y * this.width + x];
  };

  SpriteClip.prototype.flipHorizontal = function (frameIdx) {
    var f = this.frames[frameIdx];
    if (!f) return;
    var w = this.width, h = this.height, next = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) next[y * w + (w - 1 - x)] = f.pixels[y * w + x];
    }
    f.pixels = next;
  };

  /* Resolve active frame at elapsed time (respecting per-frame hold counts) */
  SpriteClip.prototype.frameAtMs = function (elapsedMs) {
    var totalHolds = 0, i;
    for (i = 0; i < this.frames.length; i++) totalHolds += (this.frames[i].hold || 1);
    if (totalHolds <= 0) return 0;
    var tick = Math.floor((elapsedMs / 1000) * this.fps) % totalHolds;
    var acc = 0;
    for (i = 0; i < this.frames.length; i++) {
      acc += (this.frames[i].hold || 1);
      if (tick < acc) return i;
    }
    return 0;
  };

  SpriteClip.prototype.drawToCanvas = function (ctx, dx, dy, scale, frameIdx, flipX) {
    var f = this.frames[frameIdx || 0];
    if (!ctx || !f) return;
    var s = scale || 2, w = this.width, h = this.height;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ci = f.pixels[y * w + x];
        var col = this.palette[ci];
        if (!col) continue;
        var drawX = flipX ? (w - 1 - x) : x;
        ctx.fillStyle = col;
        ctx.fillRect(dx + drawX * s, dy + y * s, s, s);
      }
    }
  };

  /* =========================================================================
     2. PORTABLE TILEMAP BACKGROUND (EXTRACT FROM ONE GAME -> DROP INTO ANOTHER)
     ========================================================================= */
  function TilemapBackground(opts) {
    opts = opts || {};
    this.id = opts.id || ("bg_" + Date.now());
    this.name = opts.name || "Custom Background";
    this.sourceGame = opts.sourceGame || "original";
    this.cols = opts.cols || 16;
    this.rows = opts.rows || 10;
    this.bgColor = opts.bgColor || "#04041c";
    this.palette = opts.palette ? opts.palette.slice(0) : DEFAULT_PALETTE.slice(0);
    this.tiles = []; // Array of 64-byte Uint8Arrays (8x8 tiles)
    this.grid = new Uint16Array(this.cols * this.rows); // tile index per cell
    if (opts.tiles) {
      for (var i = 0; i < opts.tiles.length; i++) this.tiles.push(new Uint8Array(opts.tiles[i]));
    }
    if (opts.grid) this.grid.set(opts.grid);
  }

  TilemapBackground.prototype.setTileCell = function (col, row, tileIdx) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    this.grid[row * this.cols + col] = tileIdx & 0xFFFF;
  };

  TilemapBackground.prototype.drawToCanvas = function (ctx, scale) {
    if (!ctx) return;
    var s = scale || 2;
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.cols * 8 * s, this.rows * 8 * s);
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var tid = this.grid[r * this.cols + c];
        var tile = this.tiles[tid];
        if (!tile) continue;
        for (var y = 0; y < 8; y++) {
          for (var x = 0; x < 8; x++) {
            var ci = tile[y * 8 + x];
            var col = this.palette[ci];
            if (!col) continue;
            ctx.fillStyle = col;
            ctx.fillRect((c * 8 + x) * s, (r * 8 + y) * s, s, s);
          }
        }
      }
    }
  };

  /* Build a portable TilemapBackground directly from tiles decoded out of a retro ROM */
  function extractBackgroundFromTiles(tilesArr, sourceName, cols, rows) {
    var bg = new TilemapBackground({
      id: "bg_" + String(sourceName || "retro").replace(/[^a-z0-9]/gi, "_").toLowerCase(),
      name: "Extracted from " + (sourceName || "Retro ROM"),
      sourceGame: sourceName || "retro",
      cols: cols || 16,
      rows: rows || 10,
      tiles: tilesArr
    });
    if (tilesArr.length > 0) {
      for (var r = 0; r < bg.rows; r++) {
        for (var c = 0; c < bg.cols; c++) {
          bg.setTileCell(c, r, (r * bg.cols + c) % tilesArr.length);
        }
      }
    }
    return bg;
  }

  /* =========================================================================
     3. NES & GAME BOY 2BPP TILE ENCODER (EXACT INVERSE OF decode2BppTiles)
     ========================================================================= */
  var RetroTileCodec = {
    encode2BppTile: function (pixels64, mode) {
      var out = new Uint8Array(16);
      for (var y = 0; y < 8; y++) {
        var lo = 0, hi = 0;
        for (var x = 0; x < 8; x++) {
          var v = (pixels64[y * 8 + x] || 0) & 3;
          var shift = 7 - x;
          lo |= (v & 1) << shift;
          hi |= ((v >> 1) & 1) << shift;
        }
        if (mode === "gb_2bpp") {
          out[y * 2] = lo;
          out[y * 2 + 1] = hi;
        } else {
          out[y] = lo;
          out[y + 8] = hi;
        }
      }
      return out;
    },

    /* Non-destructively swap one 8x8 tile inside a copy of a ROM buffer */
    replaceRomTile: function (origRomU8, tileOffset, pixels64, mode) {
      if (!origRomU8 || tileOffset < 0 || tileOffset + 16 > origRomU8.length) {
        return { ok: false, error: "Tile offset out of ROM bounds." };
      }
      var copy = new Uint8Array(origRomU8.length);
      copy.set(origRomU8);
      var encoded = this.encode2BppTile(pixels64, mode);
      copy.set(encoded, tileOffset);
      return { ok: true, modifiedRom: copy, encodedBytes: encoded };
    }
  };

  /* =========================================================================
     4. STANDARD NON-DESTRUCTIVE IPS BINARY PATCHER (1990s RETRO MOD FORMAT)
        Stores ONLY the child's changed bytes; never redistributes original ROMs.
     ========================================================================= */
  var IPSPatcher = {
    createPatch: function (origU8, modU8) {
      if (!origU8 || !modU8 || origU8.length !== modU8.length) {
        return { ok: false, error: "Original and modified buffers must have matching lengths." };
      }
      var chunks = [0x50, 0x41, 0x54, 0x43, 0x48]; // "PATCH"
      var i = 0, n = origU8.length, recordCount = 0;

      while (i < n) {
        if (origU8[i] === modU8[i]) { i++; continue; }
        var start = i;
        while (i < n && origU8[i] !== modU8[i] && (i - start) < 0xFFFF) i++;
        var len = i - start;
        /* Avoid classic IPS sentinel 0x454F46 ("EOF") as a record offset */
        if (start === 0x454F46 && start > 0) { start -= 1; len += 1; }
        chunks.push((start >>> 16) & 255, (start >>> 8) & 255, start & 255);
        chunks.push((len >>> 8) & 255, len & 255);
        for (var k = 0; k < len; k++) chunks.push(modU8[start + k]);
        recordCount++;
      }
      chunks.push(0x45, 0x4F, 0x46); // "EOF"
      return { ok: true, patch: new Uint8Array(chunks), recordCount: recordCount, bytes: chunks.length };
    },

    applyPatch: function (origU8, patchU8) {
      if (!origU8 || !patchU8 || patchU8.length < 8) return { ok: false, error: "IPS patch too short." };
      if (patchU8[0] !== 0x50 || patchU8[1] !== 0x41 || patchU8[2] !== 0x54 || patchU8[3] !== 0x43 || patchU8[4] !== 0x48) {
        return { ok: false, error: "Invalid IPS magic (expected PATCH)." };
      }
      var out = new Uint8Array(origU8.length);
      out.set(origU8);
      var p = 5, applied = 0;

      while (p + 2 < patchU8.length) {
        /* Check "EOF" marker */
        if (patchU8[p] === 0x45 && patchU8[p + 1] === 0x4F && patchU8[p + 2] === 0x46) {
          return { ok: true, patched: out, recordsApplied: applied };
        }
        if (p + 5 > patchU8.length) return { ok: false, error: "Truncated IPS record header." };
        var off = (patchU8[p] << 16) | (patchU8[p + 1] << 8) | patchU8[p + 2];
        var len = (patchU8[p + 3] << 8) | patchU8[p + 4];
        p += 5;

        if (len === 0) {
          /* Standard IPS RLE hunk */
          if (p + 3 > patchU8.length) return { ok: false, error: "Truncated IPS RLE hunk." };
          var rleLen = (patchU8[p] << 8) | patchU8[p + 1];
          var rleVal = patchU8[p + 2];
          p += 3;
          if (off + rleLen > out.length) return { ok: false, error: "IPS RLE write exceeds ROM size." };
          for (var r = 0; r < rleLen; r++) out[off + r] = rleVal;
        } else {
          if (p + len > patchU8.length) return { ok: false, error: "Truncated IPS payload." };
          if (off + len > out.length) return { ok: false, error: "IPS write exceeds ROM size." };
          for (var k = 0; k < len; k++) out[off + k] = patchU8[p + k];
          p += len;
        }
        applied++;
      }
      return { ok: false, error: "Missing IPS EOF marker." };
    }
  };

  /* =========================================================================
     5. CINEMATOGRAPHY SILHOUETTE & PALETTE CONTRAST AUDITOR
        Prevents dark-on-dark foreground/background mergers when kids swap art.
     ========================================================================= */
  function hexLuminance(hex) {
    var clean = String(hex || "#000000").replace("#", "");
    if (clean.length !== 6) return 0;
    function ch(i) {
      var v = parseInt(clean.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  }

  var PaletteAuditor = {
    contrastRatio: function (hexA, hexB) {
      var l1 = hexLuminance(hexA), l2 = hexLuminance(hexB);
      var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    },
    checkSpriteOnBackground: function (spritePrimaryHex, bgHex) {
      var ratio = this.contrastRatio(spritePrimaryHex, bgHex);
      if (ratio < 3.0) {
        return {
          ok: false, ratio: Number(ratio.toFixed(2)),
          advice: "Sprite color blends into the background (" + ratio.toFixed(2) + ":1). Pick a brighter outline or rim light color."
        };
      }
      return { ok: true, ratio: Number(ratio.toFixed(2)), advice: "Clear figure-ground separation (" + ratio.toFixed(2) + ":1)." };
    }
  };

  /* =========================================================================
     6. CROSS-CARTRIDGE SKIN REGISTRY + .EVASSET PORTABLE BUNDLE (CRC32 + LZW)
     ========================================================================= */
  function AssetSkinRegistry() {
    this.sprites = Object.create(null);
    this.backgrounds = Object.create(null);
    this.bindings = Object.create(null); // cartId -> { playerSpriteId, enemySpriteId, backgroundId }
  }

  AssetSkinRegistry.prototype.registerSprite = function (clip) { this.sprites[clip.id] = clip; };
  AssetSkinRegistry.prototype.registerBackground = function (bg) { this.backgrounds[bg.id] = bg; };

  AssetSkinRegistry.prototype.bindToCartridge = function (cartId, slot, assetId) {
    if (!this.bindings[cartId]) this.bindings[cartId] = {};
    this.bindings[cartId][slot] = assetId;
  };

  AssetSkinRegistry.prototype.getSkin = function (cartId) {
    var b = this.bindings[cartId] || {};
    return {
      playerSprite: b.playerSprite ? this.sprites[b.playerSprite] || null : null,
      enemySprite:  b.enemySprite  ? this.sprites[b.enemySprite]  || null : null,
      background:   b.background   ? this.backgrounds[b.background] || null : null
    };
  };

  /* Serialize a SpriteClip or TilemapBackground into a CRC32-verified LZW .evasset string */
  AssetSkinRegistry.prototype.exportAsset = function (kind, id) {
    var obj = kind === "sprite" ? this.sprites[id] : this.backgrounds[id];
    if (!obj) return { ok: false, error: "Asset not found: " + id };
    var plain;
    if (kind === "sprite") {
      var fs = [];
      for (var i = 0; i < obj.frames.length; i++) {
        fs.push({ hold: obj.frames[i].hold, pixels: Array.prototype.slice.call(obj.frames[i].pixels) });
      }
      plain = { kind: "sprite", id: obj.id, name: obj.name, width: obj.width, height: obj.height, fps: obj.fps, palette: obj.palette, frames: fs };
    } else {
      var ts = [];
      for (var t = 0; t < obj.tiles.length; t++) ts.push(Array.prototype.slice.call(obj.tiles[t]));
      plain = { kind: "background", id: obj.id, name: obj.name, sourceGame: obj.sourceGame, cols: obj.cols, rows: obj.rows, bgColor: obj.bgColor, palette: obj.palette, tiles: ts, grid: Array.prototype.slice.call(obj.grid) };
    }
    var compressed = B.LZ.compress(JSON.stringify(plain));
    var sealed = Sent.Envelope.seal(compressed, 1);
    return { ok: true, bundle: sealed, bytes: sealed.length };
  };

  AssetSkinRegistry.prototype.importAsset = function (sealedStr) {
    var env = Sent.Envelope.verify(sealedStr, 262144);
    if (!env.ok) return { ok: false, error: "Asset bundle failed integrity check: " + env.error };
    var dec = Sent.SafeCodecs.decompressLZW(env.payload, 262144);
    if (!dec.ok) return { ok: false, error: "Asset decompression failed: " + dec.error };
    try {
      var data = JSON.parse(dec.text);
      if (data.kind === "sprite") {
        var sp = new SpriteClip(data);
        this.registerSprite(sp);
        return { ok: true, kind: "sprite", asset: sp };
      } else if (data.kind === "background") {
        var bg = new TilemapBackground(data);
        this.registerBackground(bg);
        return { ok: true, kind: "background", asset: bg };
      }
      return { ok: false, error: "Unknown asset kind." };
    } catch (e) {
      return { ok: false, error: "Corrupt asset JSON." };
    }
  };

  root.EvelynAssetStudio = {
    DEFAULT_PALETTE: DEFAULT_PALETTE,
    SpriteClip: SpriteClip,
    TilemapBackground: TilemapBackground,
    extractBackgroundFromTiles: extractBackgroundFromTiles,
    RetroTileCodec: RetroTileCodec,
    IPSPatcher: IPSPatcher,
    PaletteAuditor: PaletteAuditor,
    AssetSkinRegistry: AssetSkinRegistry
  };
})(typeof window !== "undefined" ? window : global);
