/* evelyn_art.js - 100% Raw ES5 JavaScript Graphics, CRT Neon-Green Console Portrait
   (Black Hair + Neon-Pink Under-Highlights), 16x16 Pixel Icons & Favicon Generator.
   Zero external images. Runs offline on any CPU/browser. */
(function (root) {
  "use strict";

  /* CRT Phosphor Green + Neon Pink Highlight Palette */
  var PAL = {
    ".": null,            // transparent
    "0": "#020b06",       // CRT deep phosphor black-green
    "1": "#082414",       // dark CRT bezel / shadow green
    "2": "#126e3a",       // mid console green
    "3": "#28e47c",       // phosphor CRT green
    "4": "#58ffa8",       // bright neon mint-green glow
    "5": "#090a10",       // jet-black hair outer
    "6": "#182224",       // black hair CRT-green sheen
    "7": "#ff2ec4",       // neon pink under-hair highlight (vivid)
    "8": "#ff7ae8",       // neon pink bright edge highlight
    "9": "#e4bfa4",       // warm skin base
    "a": "#c2947c",       // skin shadow
    "b": "#f0f8fc",       // bright white specular
    "c": "#28e4fc",       // electric cyan accent
    "d": "#fcd838",       // amber gold accent
    "e": "#fc5888",       // alert coral / fire
    "f": "#1d2a32"        // dark tech jacket
  };

  /* =========================================================================
     1. PROCEDURAL CRT CONSOLE PORTRAIT OF EVELYN
        Virtual 128x128 coordinate space scaled cleanly to any canvas size.
        Options: { mood: "idle"|"thinking"|"talking"|"happy"|"fixing", frame: 0 }
     ========================================================================= */
  function drawEvelynPortrait(canvas, opts) {
    if (!canvas || !canvas.getContext) return;
    opts = opts || {};
    var mood = opts.mood || "idle";
    var frame = opts.frame || 0;
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;

    ctx.save();
    ctx.scale(W / 128, H / 128);

    /* 1. Deep CRT phosphor glass background */
    var bgGrad = ctx.createRadialGradient(64, 58, 8, 64, 64, 72);
    bgGrad.addColorStop(0, mood === "fixing" ? "#0d3a2c" : "#0a2e1a");
    bgGrad.addColorStop(0.65, "#03150c");
    bgGrad.addColorStop(1, "#010804");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 128, 128);

    /* 2. Scrolling faint green console code bars behind Evelyn */
    ctx.fillStyle = "rgba(40, 228, 124, 0.14)";
    var colX = [10, 22, 102, 114];
    for (var ci = 0; ci < colX.length; ci++) {
      var yOff = ((frame * (1 + (ci % 2)) + ci * 27) % 118);
      for (var k = 0; k < 5; k++) {
        var gy = (yOff + k * 22) % 120;
        ctx.fillRect(colX[ci], gy, 6, 2);
        ctx.fillRect(colX[ci], gy + 5, 4, 2);
      }
    }

    /* Subtle subtle breathing bob */
    var bob = Math.sin(frame * 0.08) * 1.1;
    ctx.save();
    ctx.translate(0, bob);

    /* 3. BACK LAYER OF HAIR: Jet-black silhouette + NEON PINK UNDER-HIGHLIGHTS
          The neon pink sits UNDER the black outer hair along jaw/neck/shoulders */
    ctx.fillStyle = "#08090f";
    ctx.beginPath();
    ctx.moveTo(32, 46);
    ctx.quadraticCurveTo(26, 78, 30, 104);
    ctx.lineTo(98, 104);
    ctx.quadraticCurveTo(102, 78, 96, 46);
    ctx.quadraticCurveTo(64, 14, 32, 46);
    ctx.fill();

    /* Vivid Neon Pink Under-Highlights peeking underneath the black hair */
    var pinkGlow = ctx.createLinearGradient(34, 64, 34, 104);
    pinkGlow.addColorStop(0, "#ff2ec4");
    pinkGlow.addColorStop(0.55, "#ff5ce0");
    pinkGlow.addColorStop(1, "#b81488");
    ctx.fillStyle = pinkGlow;
    /* Left inner under-hair layer */
    ctx.beginPath();
    ctx.moveTo(35, 62);
    ctx.quadraticCurveTo(32, 82, 36, 102);
    ctx.lineTo(48, 100);
    ctx.quadraticCurveTo(44, 82, 45, 64);
    ctx.closePath();
    ctx.fill();
    /* Right inner under-hair layer */
    ctx.beginPath();
    ctx.moveTo(93, 62);
    ctx.quadraticCurveTo(96, 82, 92, 102);
    ctx.lineTo(80, 100);
    ctx.quadraticCurveTo(84, 82, 83, 64);
    ctx.closePath();
    ctx.fill();
    /* Bright neon-pink highlight strands catching CRT light */
    ctx.strokeStyle = "#ff9cf0";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(38, 69); ctx.quadraticCurveTo(36, 84, 39, 98);
    ctx.moveTo(42, 72); ctx.quadraticCurveTo(41, 86, 43, 96);
    ctx.moveTo(90, 69); ctx.quadraticCurveTo(92, 84, 89, 98);
    ctx.moveTo(86, 72); ctx.quadraticCurveTo(87, 86, 85, 96);
    ctx.stroke();

    /* 4. Shoulders & Dark Tech Console Jacket with CRT Green Seam Glow */
    ctx.fillStyle = "#101a1e";
    ctx.beginPath();
    ctx.moveTo(22, 128);
    ctx.quadraticCurveTo(28, 98, 48, 94);
    ctx.lineTo(80, 94);
    ctx.quadraticCurveTo(100, 98, 106, 128);
    ctx.closePath();
    ctx.fill();

    /* High collar + neon green console trim */
    ctx.strokeStyle = "#39ff88";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(47, 95); ctx.lineTo(56, 110); ctx.lineTo(64, 114);
    ctx.lineTo(72, 110); ctx.lineTo(81, 95);
    ctx.stroke();
    ctx.fillStyle = "#28e47c";
    ctx.fillRect(62, 114, 4, 10);

    /* 5. Neck & Adult Face (with soft CRT green screen light on cheek/chin) */
    ctx.fillStyle = "#c89c82";
    ctx.fillRect(57, 82, 14, 15);
    ctx.fillStyle = "#b08268";
    ctx.beginPath();
    ctx.ellipse(64, 86, 7, 4, 0, 0, Math.PI);
    ctx.fill();

    var faceGrad = ctx.createRadialGradient(60, 56, 5, 64, 62, 26);
    faceGrad.addColorStop(0, "#ebd0bc");
    faceGrad.addColorStop(0.75, "#d8b096");
    faceGrad.addColorStop(1, "#9ab8a0"); // subtle emerald CRT screen bounce on jaw edge
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.moveTo(44, 52);
    ctx.quadraticCurveTo(44, 76, 56, 84);
    ctx.quadraticCurveTo(64, 88, 72, 84);
    ctx.quadraticCurveTo(84, 76, 84, 52);
    ctx.quadraticCurveTo(84, 34, 64, 34);
    ctx.quadraticCurveTo(44, 34, 44, 52);
    ctx.fill();

    /* Subtle CRT green rim light along outer cheek */
    ctx.strokeStyle = "rgba(88, 255, 168, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(45, 58); ctx.quadraticCurveTo(46, 74, 55, 82);
    ctx.moveTo(83, 58); ctx.quadraticCurveTo(82, 74, 73, 82);
    ctx.stroke();

    /* 6. Facial Features (Blinking Eyes with CRT Green Reflection + Animated Mouth) */
    var blink = (frame % 140) > 135;
    var eyeY = 58;
    /* Eyebrows */
    ctx.strokeStyle = "#101218";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    var browTilt = mood === "thinking" || mood === "fixing" ? 1.5 : 0;
    ctx.moveTo(49, 52 + browTilt); ctx.quadraticCurveTo(54, 50, 59, 52);
    ctx.moveTo(69, 52); ctx.quadraticCurveTo(74, 50, 79, 52 + browTilt);
    ctx.stroke();

    if (blink) {
      ctx.strokeStyle = "#101218"; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(50, eyeY); ctx.lineTo(59, eyeY);
      ctx.moveTo(69, eyeY); ctx.lineTo(78, eyeY);
      ctx.stroke();
    } else {
      /* Sclera */
      ctx.fillStyle = "#edf7f2";
      ctx.beginPath(); ctx.ellipse(54.5, eyeY, 4.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(73.5, eyeY, 4.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      /* Dark irises + phosphor green console glint */
      var lookX = mood === "thinking" ? Math.sin(frame * 0.15) * 1.4 : 0;
      ctx.fillStyle = "#141c24";
      ctx.beginPath(); ctx.arc(54.5 + lookX, eyeY, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(73.5 + lookX, eyeY, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#58ffa8";
      ctx.fillRect(53.2 + lookX, eyeY - 1.6, 1.4, 1.4);
      ctx.fillRect(72.2 + lookX, eyeY - 1.6, 1.4, 1.4);
      /* Upper lash line */
      ctx.strokeStyle = "#090a10"; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(49.5, eyeY - 1.4); ctx.quadraticCurveTo(54.5, eyeY - 4.2, 59.5, eyeY - 1);
      ctx.moveTo(68.5, eyeY - 1); ctx.quadraticCurveTo(73.5, eyeY - 4.2, 78.5, eyeY - 1.4);
      ctx.stroke();
    }

    /* Nose hint */
    ctx.strokeStyle = "#b88a70"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(64, 62); ctx.lineTo(63, 68); ctx.lineTo(65.5, 68.5); ctx.stroke();

    /* Mouth (animated for talking / mood) */
    ctx.strokeStyle = "#7a3b48"; ctx.fillStyle = "#3a1420"; ctx.lineWidth = 1.6;
    if (mood === "talking" && (frame % 10) < 5) {
      ctx.beginPath(); ctx.ellipse(64, 75.5, 4.5, 2.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (mood === "happy") {
      ctx.beginPath(); ctx.moveTo(58, 74); ctx.quadraticCurveTo(64, 79.5, 70, 74); ctx.stroke();
    } else if (mood === "thinking" || mood === "fixing") {
      ctx.beginPath(); ctx.moveTo(60, 75.5); ctx.lineTo(68, 75); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(59, 75); ctx.quadraticCurveTo(64, 77.2, 69, 74.8); ctx.stroke();
    }

    /* 7. FRONT LAYER OF JET-BLACK HAIR (framing face, letting neon pink peek beneath) */
    ctx.fillStyle = "#080910";
    ctx.beginPath();
    ctx.moveTo(33, 48);
    ctx.quadraticCurveTo(36, 22, 64, 21);
    ctx.quadraticCurveTo(92, 22, 95, 48);
    ctx.quadraticCurveTo(97, 68, 92, 82);
    ctx.quadraticCurveTo(88, 66, 84, 50);
    ctx.quadraticCurveTo(76, 36, 60, 42);
    ctx.quadraticCurveTo(48, 46, 44, 52);
    ctx.quadraticCurveTo(40, 66, 36, 82);
    ctx.quadraticCurveTo(31, 68, 33, 48);
    ctx.fill();

    /* Side-swept black bangs */
    ctx.beginPath();
    ctx.moveTo(42, 34);
    ctx.quadraticCurveTo(56, 48, 72, 42);
    ctx.quadraticCurveTo(60, 34, 42, 34);
    ctx.fill();

    /* Cool CRT-green sheen on the black crown */
    ctx.strokeStyle = "rgba(72, 252, 168, 0.35)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(44, 30); ctx.quadraticCurveTo(64, 24, 84, 30);
    ctx.moveTo(36, 52); ctx.quadraticCurveTo(35, 64, 38, 75);
    ctx.moveTo(92, 52); ctx.quadraticCurveTo(93, 64, 90, 75);
    ctx.stroke();

    ctx.restore(); // end breathing bob

    /* 8. CRT CONSOLE OVERLAY: Phosphor scanlines, HUD brackets, status LED & bezel */
    applyCRTOverlay(ctx, 128, 128, mood, frame);
    ctx.restore();
  }

  /* Reusable CRT scanline + HUD overlay */
  function applyCRTOverlay(ctx, w, h, mood, frame) {
    /* Horizontal phosphor scanlines */
    ctx.fillStyle = "rgba(0, 12, 6, 0.28)";
    for (var y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

    /* Subtle green moving CRT refresh bar */
    var scanY = (frame * 2) % h;
    ctx.fillStyle = "rgba(88, 255, 168, 0.08)";
    ctx.fillRect(0, scanY, w, 8);

    /* Console corner brackets */
    ctx.strokeStyle = "#39ff88";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(5, 14); ctx.lineTo(5, 5); ctx.lineTo(14, 5);
    ctx.moveTo(w - 14, 5); ctx.lineTo(w - 5, 5); ctx.lineTo(w - 5, 14);
    ctx.moveTo(5, h - 14); ctx.lineTo(5, h - 5); ctx.lineTo(14, h - 5);
    ctx.moveTo(w - 14, h - 5); ctx.lineTo(w - 5, h - 5); ctx.lineTo(w - 5, h - 14);
    ctx.stroke();

    /* Status LED + label */
    var ledColor = mood === "fixing" ? "#fcd838" : mood === "talking" ? "#ff2ec4" : "#48fca8";
    ctx.fillStyle = ledColor;
    ctx.fillRect(9, 9, 4, 4);
    ctx.fillStyle = "#58ffa8";
    ctx.font = "bold 7px monospace";
    ctx.fillText("EVELYN:" + String(mood || "idle").toUpperCase(), 16, 13.5);

    /* Outer CRT bezel border */
    ctx.strokeStyle = "#187a42";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  }

  /* =========================================================================
     2. 16x16 RAW-JS PIXEL ICON PACK (ZERO EXTERNAL FILES)
        Each character maps directly to PAL above.
     ========================================================================= */
  var ICONS = {
    /* App icon & Favicon: Evelyn in green CRT frame, black hair, neon pink under-highlights */
    evelyn: [
      "3333333333333333",
      "3000055555500003",
      "3000555665550003",
      "3005555555555003",
      "3005599999955003",
      "3005590990955003",
      "3005599999955003",
      "3005799aa9975003",
      "3005789999875003",
      "3005779999775003",
      "300778f33f877003",
      "30007ff44ff70003",
      "300ffff33ffff003",
      "300ffff33ffff003",
      "3000000000000003",
      "3333333333333333"
    ],
    /* Echo orb / CRT waveform */
    echo: [
      "0000033333300000",
      "0003300000033000",
      "0030000440000300",
      "0300044004400030",
      "0300400770040030",
      "3004007887004003",
      "3004078bb8704003",
      "3040078bb8700403",
      "3040078bb8700403",
      "3004078bb8704003",
      "3004007887004003",
      "0300400770040030",
      "0300044004400030",
      "0030000440000300",
      "0003300000033000",
      "0000033333300000"
    ],
    /* Static Choir Hound: small CRT monitor with husky ears & cyan static */
    hound: [
      "0000000000000000",
      "0033000000003300",
      "0034300000034300",
      "0034433333344300",
      "0030000000000300",
      "0030cccccccc0300",
      "0030c00cc00c0300",
      "0030c40cc40c0300",
      "0030cccccccc0300",
      "0030ccc00ccc0300",
      "0030cc7777cc0300",
      "0030000000000300",
      "0033333333333300",
      "0000300000030000",
      "0003300000033000",
      "0000000000000000"
    ],
    /* Who Moved the Plinth: Clock + Stone Plinth */
    plinth: [
      "0000033333300000",
      "0000300440030000",
      "0003000400003000",
      "0003000444003000",
      "0003000000003000",
      "0000300000030000",
      "0000033333300000",
      "0000000000000000",
      "000dddddddddd000",
      "000d00000000d000",
      "0000cccccccc0000",
      "0000c000000c0000",
      "0000c000000c0000",
      "00cccccccccccc00",
      "00c0000000000c00",
      "00cccccccccccc00"
    ],
    /* The Long Climb: Snowline peak + Rim */
    climb: [
      "0000000bb0000000",
      "000000bbbb000000",
      "00000bbbbbb00000",
      "0000bbccccbb0000",
      "0000cccccccc0000",
      "000cc333333cc000",
      "0003333333333000",
      "0033322222233300",
      "0032222dd2222300",
      "032222d00d222230",
      "032222dddd222230",
      "3222222222222223",
      "3222111111112223",
      "3111111111111113",
      "3333333333333333",
      "0000000000000000"
    ],
    /* Room P-1 Maze */
    maze: [
      "3333333333333333",
      "3700030000d00003",
      "3033030333d33303",
      "3030000300000303",
      "3030333303330303",
      "3000300003000003",
      "3330303333033303",
      "3000303000030003",
      "3033303033330333",
      "3000003000000003",
      "3033333333033303",
      "3030000003030003",
      "3030333303030443",
      "3000300000030443",
      "3333333333333333",
      "0000000000000000"
    ],
    /* Atlantis Field Guide */
    guide: [
      "0033333333330000",
      "0034444444433000",
      "0034000000430300",
      "0034004400430300",
      "0034043340430300",
      "0034043440430300",
      "0034004400430300",
      "0034000300430300",
      "0034077770430300",
      "0034000000430300",
      "00340cccc0430300",
      "0034000000430300",
      "0034444444430300",
      "0033333333333300",
      "0000000000000000",
      "0000000000000000"
    ],
    /* Kaizo Trillhelm Shop Till */
    shop: [
      "0000000000000000",
      "000dddddddddd000",
      "00d0000000000d00",
      "00d0444444440d00",
      "00d0400000040d00",
      "00d0444444440d00",
      "00dddddddddddd00",
      "0333333333333330",
      "030c0c0c0c0c0c30",
      "0300000000000030",
      "0307070707070730",
      "0300000000000030",
      "0333333333333330",
      "030000dddd000030",
      "0333333333333330",
      "0000000000000000"
    ],
    /* Alchemy Flask */
    alchemy: [
      "000000cccc000000",
      "000000c00c000000",
      "000000c00c000000",
      "000000c00c000000",
      "00000c0000c00000",
      "0000c004400c0000",
      "000c00000000c000",
      "00c0044444400c00",
      "00c0443333440c00",
      "0c043337733340c0",
      "0c043378873340c0",
      "0c043337733340c0",
      "0c003333333300c0",
      "00cc00000000cc00",
      "0000cccccccc0000",
      "0000000000000000"
    ],
    /* Cartridge Workshop </> */
    workshop: [
      "0000000000000000",
      "0333333333333330",
      "0300000000000030",
      "0300000004000030",
      "0300040040040030",
      "0300400040004030",
      "0304000400000430",
      "0300400400004030",
      "0300040400040030",
      "0300004000000030",
      "0300000000000030",
      "0307777777777030",
      "0300000000000030",
      "0333333333333330",
      "0000000000000000",
      "0000000000000000"
    ],
    /* EvelynDoctor Self-Repair Cross + Pulse */
    doctor: [
      "0000033333300000",
      "0000034444300000",
      "0000034444300000",
      "0000034444300000",
      "0333334444333330",
      "0344444444444430",
      "0344447777444430",
      "0344778888774430",
      "0344447777444430",
      "0344444444444430",
      "0333334444333330",
      "0000034444300000",
      "0000034444300000",
      "0000034444300000",
      "0000033333300000",
      "0000000000000000"
    ],
    /* Trophy Star */
    trophy: [
      "0000000dd0000000",
      "000000dddd000000",
      "00000dddddd00000",
      "0ddddddddddddd00",
      "00dddd4444ddd000",
      "000ddd4444dd0000",
      "0000ddddddd00000",
      "000dddd dddd0000".replace(" ", "d"),
      "00ddd00dd00dd000",
      "00dd000dd000d000",
      "0000000dd0000000",
      "000000dddd000000",
      "0000dddddddd0000",
      "0003333333333000",
      "0000000000000000",
      "0000000000000000"
    ],
    /* Sound Speaker */
    sound: [
      "0000000000000000",
      "0000000330000000",
      "0000003430040000",
      "0000034430004000",
      "0033344430400400",
      "0034444430040400",
      "0034444430040040",
      "0034444430040040",
      "0034444430040040",
      "0034444430040400",
      "0033344430400400",
      "0000034430004000",
      "0000003430040000",
      "0000000330000000",
      "0000000000000000",
      "0000000000000000"
    ],
    /* X-Ray Glass Box */
    xray: [
      "0033333333333300",
      "0300000000000030",
      "0304400000044030",
      "0304000770004030",
      "0300007887000030",
      "0300078448700030",
      "0300078448700030",
      "0300007887000030",
      "0300000770000030",
      "030c0c0c0c0c0030",
      "0300000000000030",
      "0304444004444030",
      "0300000000000030",
      "0033333333333300",
      "0000000000000000",
      "0000000000000000"
    ]
  };

  /* Render any 16x16 icon to a <canvas> at `scale` (default 2 -> 32x32) */
  function renderIcon(name, scale, scanlines) {
    var bmp = ICONS[name] || ICONS.echo;
    scale = scale || 2;
    var cv = document.createElement("canvas");
    cv.width = 16 * scale;
    cv.height = 16 * scale;
    var ctx = cv.getContext("2d");
    for (var y = 0; y < 16; y++) {
      var row = bmp[y];
      for (var x = 0; x < 16; x++) {
        var col = PAL[row.charAt(x)];
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
    if (scanlines) {
      ctx.fillStyle = "rgba(0, 12, 6, 0.25)";
      for (var sy = 0; sy < cv.height; sy += 2) ctx.fillRect(0, sy, cv.width, 1);
    }
    return cv;
  }

  function iconDataURL(name, scale) {
    return renderIcon(name, scale || 2, true).toDataURL("image/png");
  }

  /* Set browser tab favicon dynamically from Evelyn's raw JS icon */
  function installFavicon() {
    if (typeof document === "undefined") return;
    var link = document.querySelector("link[rel*='icon']") || document.createElement("link");
    link.type = "image/png";
    link.rel = "shortcut icon";
    link.href = iconDataURL("evelyn", 2);
    document.getElementsByTagName("head")[0].appendChild(link);
  }

  /* Mount an animated Evelyn CRT console portrait into any container element */
  function mountConsole(containerEl, size) {
    size = size || 160;
    var cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    cv.style.display = "block";
    cv.style.border = "2px solid #28e47c";
    cv.style.boxShadow = "0 0 12px rgba(40, 228, 124, 0.35)";
    containerEl.appendChild(cv);

    var ctrl = { mood: "idle", frame: 0, running: true, canvas: cv };
    function tick() {
      if (ctrl.running) {
        ctrl.frame++;
        drawEvelynPortrait(cv, { mood: ctrl.mood, frame: ctrl.frame });
      }
      if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(tick);
    }
    tick();
    return {
      setMood: function (m) { ctrl.mood = m || "idle"; },
      stop: function () { ctrl.running = false; },
      canvas: cv
    };
  }

  root.EvelynArt = {
    PALETTE: PAL,
    ICONS: ICONS,
    drawEvelynPortrait: drawEvelynPortrait,
    applyCRTOverlay: applyCRTOverlay,
    renderIcon: renderIcon,
    iconDataURL: iconDataURL,
    installFavicon: installFavicon,
    mountConsole: mountConsole
  };
})(typeof window !== "undefined" ? window : global);
