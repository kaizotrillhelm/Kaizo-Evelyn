/* skill_caldera_graphics.js - CalderaWorld graphics, compute and shot-check skill for Evelyn.
   Built from the 2026-11-23 read-only research notes. Plain ES5, no backticks.
   Run "node js/skill_caldera_graphics.js" to see what Inkling would receive for three sample tasks.
   The shelf text states what the research notes said on 2026-11-23; it is not re-measured here, so check a figure
   against the Caldera repository before relying on it. No warranty: see the disclaimer in README.md. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  var Skills = isNode ? require("./evelyn_skills.js") : root.EvelynSkills;

  var CALDERA_GRAPHICS_SKILL = {
    name: "caldera-graphics",
    description: "CalderaWorld three.js r187 rendering stack, looks, WebGL/WebGPU/WGSL/Rust WASM layers, cinematography, and shot guards.",
    effortWithNotes: 0.30,
    effortNoNotes: 0.50,
    triggers: [
      "caldera", "calderaworld", "ovalook", "three.js", "r187", "clod", "voxveg",
      "gpupt", "pt.rs", "skin_rebase", "raycam", "framecheck", "cam_guard",
      "orientation.js", "episode_gates", "render_episode", "shotsheet", "shotscript",
      "shot reader", "ida", "hillaire", "jonswap", "froxel", "meshlet", "wgsl", "tsl",
      "stage_ground", "stagekit", "look menu", "ride guard", "r15", "k01", "k02", "d01", "c01"
    ],

    /* compact Level-2 invariants, injected whenever this skill activates */
    invariants: [
      "Rule of one survivor per job (UNIFIED.md). Paths live under CalderaWorld_2026-10-24/ unless noted.",
      "Engine is three.js r187. Four device tiers: potato, low, mid, high; rendered outputs ALWAYS run the top rung. Everything works with no model.",
      "WebGL classic vs WebGPU split: world, store, episodes, render output, ovalook, AO, film, aes, and anime passes stay on WebGL classic GLSL. WebGPU/TSL is opt-in and only won WGSL compute (+97%).",
      "Rust WASM (viewer/bud/parts/worldconv/rust/) MUST keep bit-exact parity with its JS twins (31/31 and 61/61 parity tests); the Rust BVH exists for determinism, not speed.",
      "Cinematography is dual-camera: every shot must satisfy BOTH 16:9 and 9:16 (orientation.js, rules D01-D06) and pass framecheck.js separately on the horizontal and the vertical camera.",
      "Sessions NEVER rewatch their own renders. Run pure JS unit tests (node tools/test_*.mjs) freely; GPU checks (python tools/check_*.py) need explicit approval."
    ],

    /* Level-3 CRC32-verified BM25 shelves: only the 2-4 matching cards enter the prompt */
    records: [
      {
        shelf: "caldera_core",
        topic: "architecture tiers unified rule overview",
        fullText:
          "CalderaWorld_2026-10-24 uses three.js r187 with ~2,925 modules, 118 features, and 132 registry entries. " +
          "Core rule is one survivor per job (UNIFIED.md) with four tiers: potato, low, mid, high (weak devices run a cheaper rung of the same look; rendered outputs always run top rung). " +
          "Everything operates model-free. Strongest areas: look system, physical sky/light/water/skin, and camera guarding. " +
          "Weakest area: photographic people (score ledger ~254 FAIL, 61 NEAR, 5 PASS; path-traced shed rounds all FAIL; Ida figures read as toon-shaded; no top/dress cloth PASS)."
      },
      {
        shelf: "caldera_looks",
        topic: "ovalook look menu toon cel anime painted film photo routes",
        fullText:
          "One Look menu from ovalook.ui() is built identically everywhere; ovalook is WebGL classic GLSL only. " +
          "Foreground (characters) and Background (world) looks are chosen separately; Original is default. " +
          "Period looks: Toon, Cel, hull and screen ink, Poster colour, 80s/90s OVA, 70s/80s/90s film decades, 35mm stack, paper finish (background only), multiplane glass. " +
          "Opt-in painted looks: Gouache, Oil, Painter, Painted strokes, Layered strokes, painted grass, plus 32 animation styles (flicker defaults to 5%). " +
          "Photo routes: frame:photo-live and frame:photo-pt (path-traced). Parity table is in LOOKS_REFERENCE.md."
      },
      {
        shelf: "caldera_lighting",
        topic: "physical sky hillaire clouds froxel fog light kit water jonswap winter skin sss hair cloth tone curve",
        fullText:
          "Physical sky: Hillaire tables, clouds, froxel fog, 27 weathers, 21 biome atmospheres (GPU vs CPU 0.13-0.18%; CPU vs Monte Carlo 1-4%). " +
          "Light kit: probe volume baked from tracer BVH, bent normals, multi-bounce AO. " +
          "Water: JONSWAP FFT cascades, foam, caustics, underwater, buoyancy. Winter: ice, drifts, rime, halos, aurora. " +
          "Skin: one shared SSS profile read by raster, tracer, and cel shader (6 SSS styles). Hair strand solver: 20,000 guide-bound ribbons. Cloth solver and garment system. F82 metals, flake paint, leaf optics, wind. " +
          "Frame: one tone curve across 4 languages (ACES variants, AgX, Khronos Neutral), histogram/local exposure, TAA, physical bloom, fixed-clock capture with browser/GPU sharding."
      },
      {
        shelf: "caldera_geometry",
        topic: "clod cluster lod voxveg trees ida crowds meshlet visibility buffer skin_rebase performance",
        fullText:
          "Cluster LOD (clod) and voxel vegetation (voxveg: ~470,000 trees over 218 chunks, ~1.5 ms GPU per million triangles on RTX 4060 Ti). " +
          "Instanced Ida crowds draw 49,997 people in 17.6-20.3 ms on High. " +
          "Meshlet/visibility-buffer pipeline runs 0.21 ms GPU vs 1.91 ms standard on a 19M-triangle street. " +
          "skin_rebase.js keeps skinned people exact 62-72 km from world origin. " +
          "Performance gap: world viewer takes 18-22 ms GPU at 1080p vs 6.06 ms (165 fps) target; nothing measured on phone, VR, 4K, or live Shopify theme."
      },
      {
        shelf: "caldera_compute",
        topic: "webgl webgpu tsl wgsl compute rust wasm js twins workers gpu arbiter",
        fullText:
          "WebGL classic draws world, store, episodes, render output, and all GLSL passes (looks, film, water, strokes, ink, AO, aes, anime). " +
          "WebGPU/TSL is opt-in (tone, grade, exposure, TAA, bloom nodes; verified on 4060 Ti, 23-27 checks) and only beats classic on WGSL compute (+97% faster; no draw mode was 15% faster). " +
          "WGSL compute runs path tracer (180 checks, GPU lab 47/47), sky tables, voxveg level selection, ocean FFT. " +
          "Rust->WASM crate at viewer/bud/parts/worldconv/rust/ (1,415 lines; 106 KB and 118 KB builds): noise, UV raster, painter, BVH, CPU path tracer, heat-weight skinning, mesh cleanup; JS twins match bit-for-bit (31/31 and 61/61 parity tests). " +
          "Workers handle GLB parse (824 exports byte-identical to GLTFLoader), converter (12.6s on 16 workers vs 93s on 1), voxveg, clod, sharedmem; worker rendering (163 vs 40.7 fps under main-thread load) is blocked on owner decision. " +
          "GPU arbiter: FIFO queue, ComfyUI-aware, multi-card planner (38 checks; 1.7-1.9x on 4 shards)."
      },
      {
        shelf: "caldera_rays",
        topic: "raycaster depth probe stage_ground stagekit limbs gpupt path tracer bvh pt.rs",
        fullText:
          "Gameplay and camera rays: three.js Raycaster + 1-pixel GPU depth probe, floor ray in stage_ground.js, box/capsule collision in stagekit and limbs. " +
          "GPU path tracer in parts/gpupt/: two-level BVH, skinned refit, HDR env with MIS, rough glass, clearcoat, sheen, SSS random walk, a-trous denoiser, 5-rung ladder (~3.5M rays/s on shared 3090; no hardware RT cores in WebGPU). " +
          "CPU path tracer in Rust (pt.rs): 10.4M rays in 1.75s on 8 workers, used for potato-tier stills. " +
          "Note: Rust BVH is 1.1s vs JS 1.0s (kept for determinism, not speed)."
      },
      {
        shelf: "caldera_cinema",
        topic: "cinematography camera moves rigs grammar c01 c11 e01 e07 orientation d01 d06 raycam k01 k09 framecheck episode_gates shot reader",
        fullText:
          "Shot plan: 137-move catalog (~20 pure rigs), 7 genre cartridges, 61 director styles, grammar C01-C11 (lens by shot kind, 180-deg line, jump cut, hold, thirds, headroom, clear line to face), editing E01-E07, dual 16:9 and 9:16 via orientation.js (rules D01-D06), oner camera, scene look-ahead. " +
          "Model-free guards: raycam.js K01-K09 (inside solid, subject hidden, near wall, swept move, whip speed, roll, height); framecheck.js runs pure checks separately on horizontal and vertical cameras; pace gate, ride guards R1-R15, picture V1-V6, opening audit; episode_gates.py writes build/gates.json and render_episode.py refuses rendering without a passed gate for the current timeline hash. " +
          "Shot Reader 8B (on request only, never self-rewatch): 16 frames/shot (~14s/shot on 4060 Ti Q4_K_M); accurate on height 0.99, angle 0.97, pitch 0.93, framing 0.90, entities 1.0, WEAK on camera move 0.53 (orbit/pan 0%), lens 0.60, routes 0.55; untrusted for cel, indoors, >2 people."
      },
      {
        shelf: "caldera_gaps",
        topic: "known gaps bugs wiring cam_guard r15 frames rust wasm wgsl test_shotscript test_bud vertical debt",
        fullText:
          "Priority known gaps to fix: " +
          "(1) cam_guard.py runs in episode_gates.py --visual, but render_episode.py ignores its result, actors are null so K02 (subject hidden) cannot fire, only the horizontal camera is ray-audited, ride cameras are skipped, and docs still say nothing wired. " +
          "(2) Frame-check R15 has no data: no timeline.json carries a frames array; qwen3-vl-4b still step has no code. " +
          "(3) rust/ and wasm/ are untracked in git; Nov 19 .wasm files predate the Nov 21 spectral tracer in pt.rs (uncalled); no multi-threaded WASM. " +
          "(4) Newer WGSL/TSL files (clouds, fog, DDGI, 4-cascade ocean FFT, tsl_materials, camera_fx) lack docs, tests, and GPU checks; water WGSL unverified since 2026-11-19. " +
          "(5) Integration debt: render-guide slices not rebuilt into buds; Plant It deliberately stale; store episode screen, Plant It player, Studio lack the 9:16 switch; credits/travel/set-piece vertical rules unwired. " +
          "(6) Failing tests: test_shotscript.mjs fails 1 of 66 (likely the dual-camera change); test_bud.mjs has 1 stale failure."
      }
    ],

    /* sub-domain verifier routing for EvelynCodeLoop (commands are suggestions: the caller decides what to run) */
    verifiers: [
      { pattern: /cam_guard|raycam|k0[1-9]|episode_gates|render_episode|actor|vertical/, cmd: "node tools/test_camguard.mjs", note: "52 checks (passed 2026-11-23)" },
      { pattern: /framecheck|r15|frames|out of frame|framing/, cmd: "node tools/test_framecheck.mjs", note: "10 checks" },
      { pattern: /orientation|9:16|16:9|vertical|d0[1-6]|dual/, cmd: "node tools/test_orientation.mjs", note: "40 checks" },
      { pattern: /shotscript|shot grammar|c0[1-9]|c1[01]|e0[1-7]/, cmd: "node tools/test_shotscript.mjs", note: "66 checks (1 known failure to investigate)" },
      { pattern: /shotsheet|shot reader|fidelity|craft score/, cmd: "node tools/test_shotsheet.mjs", note: "143 checks" },
      { pattern: /move|rig|cameramove|orbit|pan|oner/, cmd: "node tools/test_cameramoves.mjs", note: "87 checks" },
      { pattern: /showkit|episode|timeline/, cmd: "node tools/test_showkit.mjs", note: "201 checks" },
      { pattern: /pace/, cmd: "node tools/test_pace_check.mjs", note: "pace gate" },
      { pattern: /opening/, cmd: "node tools/test_opening_audit.mjs", note: "opening audit" },
      { pattern: /judge|looper/, cmd: "node tools/test_judge.mjs", note: "judge scorer" },
      { pattern: /wgsl|webgpu|tsl|gpupt|sky|water|ocean|ddgi|clouds|fog/, cmd: "python tools/check_<name>.py", note: "GPU check (REQUIRES explicit user approval before running)", requiresApproval: true }
    ]
  };

  function registerCalderaGraphicsSkill(registry) {
    return registry.register(CALDERA_GRAPHICS_SKILL);
  }

  /* quick self-test: progressive disclosure on three Caldera tasks */
  if (isNode && require.main === module) {
    var reg = new Skills.SkillRegistry();
    registerCalderaGraphicsSkill(reg);

    var tasks = [
      "Wire cam_guard.py into render_episode.py refusal, pass real actors so K02 fires, and audit the 9:16 vertical camera.",
      "Add a new 80s OVA film look pass to ovalook.ui() and check whether to write it in GLSL or WebGPU TSL.",
      "Rebuild the Rust WASM crate in worldconv/rust/ to expose the Nov 21 spectral tracer in pt.rs while keeping JS twin parity."
    ];
    for (var i = 0; i < tasks.length; i++) {
      var pkt = reg.prepare(tasks[i], { topK: 2 });
      console.log("\n=== TASK " + (i + 1) + " ===");
      console.log("Active skills:", pkt.activeSkills, "| Effort:", pkt.suggestedEffort);
      console.log("Selected shelves:", pkt.excerpts.map(function (e) { return e.shelf + "#" + e.id + " (" + e.bytesRead + " B)"; }));
      console.log("Auto-selected verifiers:", pkt.verifiers.map(function (v) { return v.cmd + (v.requiresApproval ? " [APPROVAL]" : ""); }));
    }
  }

  var API = {
    CALDERA_GRAPHICS_SKILL: CALDERA_GRAPHICS_SKILL,
    registerCalderaGraphicsSkill: registerCalderaGraphicsSkill
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CalderaGraphicsSkill = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
