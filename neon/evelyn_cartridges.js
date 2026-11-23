/* evelyn_cartridges.js - .cart.json Schema, Canon/Rule Validator,
   6 Data-Driven Game Engines (with X-Ray Stepper & Uint32Array Blit) & Canon Packs. */
(function (root) {
  "use strict";
  var B = root.EvelynBackend;

  /* =========================================================================
     1. SHARED CANON TABLES (FROM LORE_SCRATCHPAD.md)
     ========================================================================= */
  var CORALE_TRAVEL = {
    "plaza|shop": 2, "shop|plaza": 2, "shop|gondola": 4, "gondola|shop": 4,
    "plaza|gondola": 5, "gondola|plaza": 5, "gondola|start house": 14,
    "start house|gondola": 14, "start house|track": 6, "track|start house": 6
  };

  var GRAND_ROAD = [
    { mile: 0, name: "Palm Harbour", elev: 0, look: "boardwalks, piers, stilt houses, market, toll gate" },
    { mile: 9, name: "Fernhollow", elev: 3200, look: "stilt houses up a slope, moss walls, waterfalls, hot springs, tea garden" },
    { mile: 19, name: "Teahouse Terrace", elev: 6800, look: "five stone terraces of tile-roofed houses, packing halls, tea estate" },
    { mile: 30, name: "Larch Green", elev: 10500, look: "alpine houses round a meadow, chapel, vineyard, larch forest" },
    { mile: 42, name: "Cairnwell", elev: 14200, look: "stone-and-steel rows in the slope, heat pipes, steam stacks, observatory" },
    { mile: 53, name: "Frostgate", elev: 17500, look: "concrete terraces, covered walkways, heating stack, red rescue post, snowcats" },
    { mile: 64, name: "Glacierhold", elev: 22200, look: "glass halls and tunnel mouths in rock, cable lift, ice blocks" },
    { mile: 74, name: "Cloudsill", elev: 26400, look: "cantilevered platforms, glass galleries, sky-tram tower, weather station" },
    { mile: 85, name: "Stratum", elev: 30500, look: "sealed spur tubes, hydroponic domes, pressure doors" },
    { mile: 96, name: "Thin Reach", elev: 34800, look: "nine pressure domes linked by tubes, solar rows, suit shops" },
    { mile: 106, name: "Rim Anchorage", elev: 38600, look: "lit tunnel streets, glass piers over the crater edge, broadcast tower, night market" },
    { mile: 114, name: "Crown Gate", elev: 42000, look: "plaza under the arch, eight domes, studios, licence hearing hall, hotels" }
  ];

  var CREATURES = [
    { id: "ATL-ENM-001", name: "Static Choir Hounds", elems: ["psychic","spirit"], weak: ["eldritch","light","holy"], resist: ["psychic","spirit","darkness"], absorb: [], home: "Server Farm Alley", hint: "Do not sit on the stool; it is a login." },
    { id: "ATL-ENM-017", name: "Dune Chorus Worm", elems: ["earth","demon"], weak: ["plant","spirit","holy"], resist: ["earth","demon","metal"], absorb: [], home: "Saltsea Arcade Dunes", hint: "Insert a coin only if you can carry the prize back." },
    { id: "ATL-ENM-019", name: "Reef Cathedral Squid", elems: ["water","eldritch"], weak: ["earth","light","holy"], resist: ["eldritch","fire","darkness"], absorb: ["water"], home: "Reef Cathedral", hint: "Light a candle at the door; the tide will not follow it." },
    { id: "ATL-ENM-022", name: "Aurora Weaver", elems: ["eldritch","light"], weak: ["spirit","demon"], resist: ["eldritch","light","darkness"], absorb: [], home: "Frostline Strata", hint: "Do not thaw anything you cannot name." },
    { id: "ATL-ENM-024", name: "Cloud-Sea Kraken", elems: ["water","light"], weak: ["earth","darkness","demon"], resist: ["light","fire","holy"], absorb: ["water"], home: "Skyfarm Shoals", hint: "Tie your boat to a cloud, never to an island." },
    { id: "ATL-FRD-005", name: "Biscuit Golems", elems: ["earth","holy"], weak: ["plant","darkness","demon"], resist: ["earth","holy","metal"], absorb: [], home: "Treehouse Teahouse", hint: "Warm tea and crumb-rolling trails." },
    { id: "b61_80_003", name: "Lantern Witch in the Woods", elems: ["plant","light"], weak: ["fire","demon","slime"], resist: ["plant","light","water"], absorb: [], home: "Hollow Hive Jungle", hint: "Knock three times on any trunk before you climb it." },
    { id: "b101_120_057", name: "Graveyard Moon Eye-Mass", elems: ["darkness","spirit"], weak: ["light","holy","eldritch"], resist: ["darkness","spirit","psychic"], absorb: [], home: "The Hollow Hills", hint: "Watch the ridge line under cloud cover." }
  ];

  function evalElementHit(creature, pulse) {
    if (creature.absorb.indexOf(pulse) >= 0) return { mult: -1, text: "ABSORBED (healed!)" };
    if (creature.weak.indexOf(pulse) >= 0) return { mult: 2, text: "WEAKNESS (2x)" };
    if (creature.resist.indexOf(pulse) >= 0) return { mult: 0.5, text: "RESISTED (0.5x)" };
    return { mult: 1, text: "NEUTRAL (1x)" };
  }

  function fmtClock12(totalMin) {
    var m = ((totalMin % 1440) + 1440) % 1440;
    var h24 = Math.floor(m / 60), min = m % 60;
    var ap = h24 >= 12 ? "PM" : "AM";
    var h12 = h24 % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + (min < 10 ? "0" : "") + min + " " + ap;
  }

  function seedDefaultShelves() {
    var L = B.ShelfLibrary;
    if (L.rows.length > 0) return;
    var i;
    for (i = 0; i < CREATURES.length; i++) {
      var c = CREATURES[i];
      L.add("creatures", c.name, c.name + " (" + c.id + ") lives at " + c.home + ". Weak to: " + c.weak.join(", ") + ". Resists: " + c.resist.join(", ") + "." + (c.absorb.length ? " Absorbs: " + c.absorb.join(", ") + "." : ""), "Map hint: " + c.hint);
    }
    for (i = 0; i < GRAND_ROAD.length; i++) {
      var s = GRAND_ROAD[i];
      L.add("caldera", s.name, s.name + " is at mile " + s.mile + " (" + s.elev + " ft): " + s.look + ".", "Caldera snow: 17,000 ft; Caldera ice: 22,000 ft; Spire ice: 25,000 ft.");
    }
    L.add("corale", "Coccyx Corale* travel clocks", "Coccyx Corale* walk times: plaza-shop 2m, shop-gondola 4m, plaza-gondola 5m, gondola-start house 14m, start house-track 6m (slide 1m). Last car up 5:07 PM (5:21 PM arrival). Shop closes 6:00 PM.", "Dritchlyssa turns the sign at 5:00 PM.");
    L.add("pu", "Pyramid U Room P-1", "Pyramid U add period closes at 12:00 PM. Wendell logs arrival at 9:07 AM. Maren reaches Lavinia at 11:58 AM. Room P-1 has no cohort of record.", "Connie: Not cohort.");
    L.add("math", "elements arithmetic", "Gold Au (79), Iron Fe (26), Silver Ag (47), Mercury Hg (80, liquid). Water freezes 0 C and boils 100 C. Right triangle: a^2 + b^2 = c^2.", "3-4-5 makes a right corner.");
  }

  /* =========================================================================
     2. .CART.JSON SCHEMA & AUTOMATED CANON/RULE VALIDATOR
     ========================================================================= */
  var CartridgeValidator = {
    validate: function (cart) {
      var errs = [], warns = [];
      if (!cart || typeof cart !== "object") return { ok: false, errors: ["Cartridge must be a JSON object."], warnings: [] };
      var req = ["id", "title", "engine", "series", "grade", "subject", "goal", "echoLine", "items"];
      for (var i = 0; i < req.length; i++) {
        if (!cart[req[i]]) errs.push("Missing required field: " + req[i]);
      }
      if (cart.echoLine && cart.echoLine.length > 128) {
        errs.push("echoLine exceeds 128 characters (" + cart.echoLine.length + ").");
      }
      var allText = JSON.stringify(cart);
      /* 12-hour AM/PM clock enforcement */
      if (/\b(?:1[3-9]|2[0-3]):[0-5]\d\b/.test(allText) || /\b0\d:[0-5]\d\b(?!\s*(?:AM|PM))/i.test(allText)) {
        errs.push("Found 24-hour clock format. Use 12-hour AM/PM clocks (e.g. 8:50 AM, 5:07 PM).");
      }
      /* Content & canon spelling guards */
      if (/mannequin/i.test(allText)) errs.push("Content rule: remove 'mannequin'.");
      if (/winter games|olympic/i.test(allText)) errs.push("Name rule: remove 'Winter Games' or 'Olympic'.");
      if (/DritchLyssa/.test(allText)) errs.push("Spelling rule: write 'Dritchlyssa' with lower-case l.");
      if (/Coccyx Corale(?!\*)/.test(allText)) errs.push("Name rule: write 'Coccyx Corale*' with an asterisk in player text.");
      if (/Julian[^"]{0,60}\b(he|him|his|she|her|they|them|their)\b/i.test(allText)) {
        errs.push("Pronoun rule: Julian uses no pronouns; repeat the name Julian.");
      }
      if (/Static Choir Hound[^"]{0,80}weak[^"]{0,30}darkness/i.test(allText)) {
        errs.push("Element rule: Static Choir Hounds resist darkness and are weak to eldritch, light, and holy.");
      }
      if (cart.items && cart.items.length) {
        for (var j = 0; j < cart.items.length; j++) {
          var it = cart.items[j];
          if (!it.shelf) warns.push("Item #" + (j + 1) + " has no shelf source tag.");
          if (!it.failRule) errs.push("Item #" + (j + 1) + " needs a teaching failRule.");
          if (it.echo && it.echo.length > 128) errs.push("Item #" + (j + 1) + " echo line > 128 chars.");
        }
      } else {
        errs.push("Cartridge needs at least 1 item in items[].");
      }
      return { ok: errs.length === 0, errors: errs, warnings: warns };
    }
  };

  /* =========================================================================
     3. SIX CANON DEFAULT .CART.JSON CARTRIDGES
     ========================================================================= */
  var DEFAULT_CARTRIDGES = [
    {
      id: "static_choir_sweep", title: "Static Choir Sweep", engine: "shooter", series: "XSK",
      grade: "6-8", subject: "math", creatureId: "ATL-ENM-001",
      goal: "Clear Static Choir Hounds in Server Farm Alley using an element they are weak to.",
      echoLine: "Elias: \"Sorry, door. Pick Light, Holy, or Eldritch, then match the sum.\"",
      bossEvery: 4,
      items: [
        { id: "sw1", q: "7 x 8", ans: "56", wrong: ["54","63","48"], shelf: "math#18", failRule: "7 times 8 is 56." },
        { id: "sw2", q: "9 x 6", ans: "54", wrong: ["45","56","64"], shelf: "math#18", failRule: "9 times 6 is 54." },
        { id: "sw3", q: "72 / 8", ans: "9", wrong: ["8","7","12"], shelf: "math#18", failRule: "72 divided by 8 is 9." },
        { id: "sw4", q: "Symbol for Gold?", ans: "Au", wrong: ["Ag","Gd","Go"], shelf: "math#18", failRule: "Gold is Au (79); Ag is Silver." },
        { id: "sw5", q: "14 + 29", ans: "43", wrong: ["33","42","53"], shelf: "math#18", failRule: "14 plus 29 is 43." }
      ]
    },
    {
      id: "who_moved_plinth", title: "Who Moved the Plinth?", engine: "detective", series: "XSK",
      grade: "9-11", subject: "logic",
      goal: "Find the impossible Coccyx Corale* alibi for the empty plinth at 8:50 AM.",
      echoLine: "Elara Vance: \"Check every witness clock against travel minutes. I am correct.\"",
      items: [
        {
          id: "pl1", shelf: "corale#16",
          q: "Case 8:50 AM — Which witness clock breaks the Coccyx Corale* travel table?",
          ans: "Julian: start house 8:42 AM -> shop 8:50 AM",
          wrong: [
            "Elara Vance: shop till 8:46 AM -> shop 8:50 AM",
            "Vance: gondola 8:38 AM -> start house 8:52 AM"
          ],
          failRule: "Start house to gondola (14m) + gondola to shop (4m) = 18m. 8:42 AM + 18m = 9:00 AM, so 8:50 AM is impossible."
        },
        {
          id: "pl2", shelf: "corale#16",
          q: "Case 5:21 PM — Which witness clock breaks the Coccyx Corale* travel table?",
          ans: "Elias: plaza 5:12 PM -> start house 5:21 PM",
          wrong: [
            "Dritchlyssa: turned shop sign at 5:00 PM -> returns window 5:21 PM",
            "Jeb: last gondola car 5:07 PM -> start house 5:21 PM"
          ],
          failRule: "Plaza to gondola (5m) + gondola to start house (14m) = 19m. 5:12 PM + 19m = 5:31 PM."
        }
      ]
    },
    {
      id: "the_long_climb", title: "The Long Climb", engine: "journey", series: "MLM",
      grade: "6-8", subject: "geo",
      goal: "Climb all 12 Grand Road stops from Palm Harbour (mi 0) to Crown Gate (mi 114).",
      echoLine: "Tsubaki taps her corn soup thermos: \"Soup first. Then count each mile leg.\"",
      items: [
        { id: "cl1", stop: 1, q: "Palm Harbour (mi 0) to Fernhollow (mi 9): how many miles?", ans: "9 miles", wrong: ["12 miles","6 miles"], shelf: "caldera#9", failRule: "9 minus 0 is 9 miles." },
        { id: "cl2", stop: 5, q: "Frostgate sits on the Snowline band. Where does Caldera snow start?", ans: "17,000 ft", wrong: ["22,000 ft","25,000 ft"], shelf: "caldera#13", failRule: "Caldera snow starts at 17,000 ft; Caldera ice starts at 22,000 ft." },
        { id: "cl3", stop: 6, q: "Glacierhold sits on Glacier Road. Where does Caldera ice start?", ans: "22,000 ft", wrong: ["17,000 ft","25,000 ft"], shelf: "caldera#14", failRule: "Caldera ice starts at 22,000 ft (25,000 ft is the Spire's own ice line)." },
        { id: "cl4", stop: 11, q: "BOSS ARCH — Crown Gate at mile 114: how high is the Caldera Rim?", ans: "42,000 ft", wrong: ["28,000 ft","25,000 ft"], shelf: "caldera#19", failRule: "The Caldera Rim sits at 42,000 ft (Rim Ring is 282.7 miles)." }
      ]
    },
    {
      id: "room_p1_maze", title: "Room P-1 Maze", engine: "maze", series: "PU",
      grade: "6-8", subject: "logic",
      goal: "Reach Room P-1 starting at 9:07 AM before the 12:00 PM add-period close.",
      echoLine: "Wendell: \"State your purpose.\" Lavinia: \"Pending Review.\"",
      items: [
        { id: "mz1", q: "Lavinia asks behind frosted glass: What time does the Pyramid U add period close?", ans: "12:00 PM", wrong: ["5:07 PM","6:00 PM"], shelf: "pu#17", failRule: "Pyramid U add period closes at 12:00 PM. 5:07 PM and 6:00 PM are Coccyx Corale* clocks." }
      ]
    },
    {
      id: "atlantis_field_guide", title: "Atlantis Field Guide & Teach-Back", engine: "detective", series: "Concourse",
      grade: "6-8", subject: "science",
      goal: "Match creatures to homes and correct confused Echoes in Teach-Back rounds.",
      echoLine: "Verify every home, map hint, and absorption rule against the creature shelf.",
      items: [
        { id: "gd1", q: "TEACH-BACK: A confused Echo says 'Darkness deals double damage to Static Choir Hounds.' Correct it!", ans: "False: Hounds resist Darkness; use Eldritch, Light, or Holy.", wrong: ["True: Darkness deals 2x.","True: Water deals 2x."], shelf: "creatures#0", failRule: "Static Choir Hounds resist psychic, spirit, and darkness; they are weak to eldritch, light, and holy." },
        { id: "gd2", q: "What happens if you fire a Water pulse at Reef Cathedral Squid?", ans: "It absorbs Water and heals.", wrong: ["Double damage (2x).","It flees to Frostline Strata."], shelf: "creatures#2", failRule: "Reef Cathedral Squid absorbs water. Use earth, light, or holy." },
        { id: "gd3", q: "Where does Dune Chorus Worm live? (Hint: 'Insert a coin only if you can carry the prize back.')", ans: "Saltsea Arcade Dunes", wrong: ["Hollow Hive Jungle","Skyfarm Shoals"], shelf: "creatures#1", failRule: "Dune Chorus Worm lives in Saltsea Arcade Dunes, not Hollow Hive Jungle." },
        { id: "gd4", q: "Where does Aurora Weaver live? (Hint: 'Do not thaw anything you cannot name.')", ans: "Frostline Strata", wrong: ["Reef Cathedral","Treehouse Teahouse"], shelf: "creatures#3", failRule: "Aurora Weaver lives in Frostline Strata (speed 5, weak to spirit and demon)." }
      ]
    },
    {
      id: "kaizo_trillhelm_shift", title: "Kaizo Trillhelm Shift & Sand Lab", engine: "alchemy", series: "Concourse",
      grade: "3-5", subject: "science",
      goal: "Test real Uint32Array falling-sand chemistry (Water+Fire=Steam, Water+Seed=Plant) and music code.",
      echoLine: "Dritchlyssa: \"I note that steam rises when fire meets water in the basin.\"",
      items: [
        { id: "al1", q: "Mix Fire + Water to create Steam, or Water + Seed to grow Neon Plants.", ans: "Steam & Plants", wrong: [], shelf: "math#18", failRule: "Water boils into steam at 100 degrees C." }
      ]
    }
  ];

  /* =========================================================================
     4. FAST Uint32Array ImageData FALLING-SAND ENGINE (ZERO fillRect LOOPS!)
     ========================================================================= */
  var SandEngine = {
    W: 80, H: 44, mat: 1, painting: false, grid: null, img: null, pix32: null,
    steam: 0, plants: 0,
    /* Little-endian 0xAABBGGRR matching TINY 2.1 Neon Palette */
    PAL32: new Uint32Array([
      0xFF100202, // 0: bg #020210
      0xFF38D8FC, // 1: sand #fcd838
      0xFFFCE428, // 2: water #28e4fc
      0xFF8858FC, // 3: fire #fc5888
      0xFFDCC8B8, // 4: steam #b8c8dc
      0xFF987868, // 5: stone #687898
      0xFFE848FC, // 6: seed #fc48e8
      0xFFA8FC48  // 7: plant #48fca8
    ]),
    init: function (canvas) {
      this.grid = new Uint8Array(this.W * this.H);
      this.steam = 0; this.plants = 0;
      for (var x = 20; x <= 60; x++) this.grid[36 * this.W + x] = 5;
      for (var y = 24; y <= 36; y++) { this.grid[y * this.W + 20] = 5; this.grid[y * this.W + 60] = 5; }
      var ctx = canvas.getContext("2d");
      this.img = ctx.createImageData(this.W, this.H);
      this.pix32 = new Uint32Array(this.img.data.buffer);
    },
    paint: function (gx, gy) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx < this.W && ny >= 0 && ny < this.H) this.grid[ny * this.W + nx] = this.mat;
        }
      }
    },
    stepAndDraw: function (canvas, rng, onEvent) {
      if (!this.grid) this.init(canvas);
      var W = this.W, H = this.H, g = this.grid, x, y, i;
      for (y = H - 2; y >= 0; y--) {
        for (x = 0; x < W; x++) {
          i = y * W + x;
          var m = g[i];
          if (m === 0 || m === 5 || m === 7) continue;
          if (m === 1 || m === 6) {
            var b = (y + 1) * W + x;
            if (g[b] === 0 || g[b] === 2) { var t = g[b]; g[b] = m; g[i] = t; }
            else {
              var d = rng() < 0.5 ? -1 : 1;
              if (x + d >= 0 && x + d < W && g[(y + 1) * W + x + d] === 0) { g[(y + 1) * W + x + d] = m; g[i] = 0; }
            }
            if (m === 6 && ((y > 0 && g[(y - 1) * W + x] === 2) || (x > 0 && g[y * W + x - 1] === 2) || (x + 1 < W && g[y * W + x + 1] === 2))) {
              g[i] = 7;
              if (y > 0 && g[(y - 1) * W + x] === 0) g[(y - 1) * W + x] = 7;
              if (++this.plants === 6 && onEvent) onEvent("plants");
            }
          } else if (m === 2) {
            if (g[(y + 1) * W + x] === 0) { g[(y + 1) * W + x] = 2; g[i] = 0; }
            else {
              var dw = rng() < 0.5 ? -1 : 1;
              if (x + dw >= 0 && x + dw < W && g[y * W + x + dw] === 0) { g[y * W + x + dw] = 2; g[i] = 0; }
            }
          } else if (m === 3) {
            if (rng() < 0.12) { g[i] = 0; continue; }
            var nb = [(y - 1) * W + x, (y + 1) * W + x, y * W + x - 1, y * W + x + 1];
            for (var n = 0; n < 4; n++) {
              if (nb[n] >= 0 && nb[n] < W * H && g[nb[n]] === 2) {
                g[nb[n]] = 4; g[i] = 4;
                if (++this.steam === 8 && onEvent) onEvent("steam");
              }
            }
            if (y > 0 && g[(y - 1) * W + x] === 0 && rng() < 0.5) { g[(y - 1) * W + x] = 3; g[i] = 0; }
          }
        }
      }
      for (y = 1; y < H; y++) {
        for (x = 0; x < W; x++) {
          if (g[y * W + x] === 4) {
            if (rng() < 0.04) g[y * W + x] = 0;
            else if (g[(y - 1) * W + x] === 0) { g[(y - 1) * W + x] = 4; g[y * W + x] = 0; }
          }
        }
      }
      /* Single-pass Uint32Array blit (1 canvas draw call total!) */
      var p32 = this.pix32, pal = this.PAL32;
      for (i = 0; i < W * H; i++) p32[i] = pal[g[i]];
      canvas.getContext("2d").putImageData(this.img, 0, 0);
    }
  };

  root.EvelynCartridges = {
    CORALE_TRAVEL: CORALE_TRAVEL,
    GRAND_ROAD: GRAND_ROAD,
    CREATURES: CREATURES,
    evalElementHit: evalElementHit,
    fmtClock12: fmtClock12,
    seedDefaultShelves: seedDefaultShelves,
    CartridgeValidator: CartridgeValidator,
    DEFAULT_CARTRIDGES: DEFAULT_CARTRIDGES,
    SandEngine: SandEngine
  };
})(typeof window !== "undefined" ? window : global);
