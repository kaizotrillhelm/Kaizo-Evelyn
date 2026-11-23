/* evelyn_run_all_tests.js - Master Zero-Dependency Test Runner for the Full Evelyn Stack
   Runs all 27 Evelyn verification suites in order and prints a unified pass/fail report.
   Usage: node evelyn_run_all_tests.js */
(function () {
  "use strict";

  var fs = require("fs");
  var path = require("path");
  var cp = require("child_process");

  var SUITES = [
    { file: "evelyn_tests.js",                label: "01. Core Backend, TNY2 Worker, SandEngine & Validator" },
    { file: "evelyn_doctor_tests.js",         label: "02. Self-Diagnostics, Fault Injection & Watchdogs" },
    { file: "evelyn_suite_tests.js",          label: "03. All 78 Cartridges, 15 Concourse Doors & Evolution" },
    { file: "evelyn_director_voice_tests.js", label: "04. Anti-Tic Voice Guard, World Director & CineCamera" },
    { file: "evelyn_frontier_tests.js",       label: "05. Frontier AI (BitNet I2S, Titans, Looped, Grammar, HippoRAG)" },
    { file: "evelyn_robotics_tests.js",       label: "06. Robotics Sim, 2-Link IK, PID, Kalman & Safety Governor" },
    { file: "evelyn_fuzz_tests.js",           label: "07. Sentinel CRC32, A/B USB Recovery & 1,000-Input Fuzz" },
    { file: "evelyn_charter_tests.js",        label: "08. Immutable Core Charter & Read-Only OBD-II Diagnostics" },
    { file: "evelyn_game_xray_tests.js",      label: "09. Retro Game X-Ray Gen 1-4 (NES, GB, WAD, DOS, ISO, CHIP-8)" },
    { file: "evelyn_game_xray_gen6_tests.js", label: "10. Retro Game X-Ray Gen 4-6 (MD, N64, PS1, GBA, DC, GC, PS2)" },
    { file: "evelyn_asset_studio_tests.js",   label: "11. Sprite Animator, Background Transplant & IPS ROM Patcher" },
    { file: "evelyn_3d_tests.js",             label: "12. Pure-CPU Z-Buffer 3D Rasterizer, .OBJ & 2.5D Raycaster" },
    { file: "evelyn_code_forge_tests.js",     label: "13. Code Forge (MiniGit, MiniSQL, 6502 VM & App Exporter)" },
    { file: "evelyn_turbo_tests.js",          label: "14. AST IDE, Native WASM i8_dot, BPE/RoPE/FIM & Bridge" },
    { file: "evelyn_hybrid_rag_tests.js",     label: "15. Hybrid Code RAG (BM25 + 16-Byte Binary Vectors + RRF)" },
    { file: "evelyn_code_power_tests.js",     label: "16. Safe Patcher, Call-Graph Slicer, Prop Shrinker & Tracer" },
    { file: "evelyn_lang_core_tests.js",      label: "17. Modular 4-Family Multi-Language Core + Rust JSON Plug-In" },
    { file: "evelyn_manual_compiler_tests.js",label: "18. Manual-to-JSON Runtime Compiler + TabAgent + L-RAG + SD-RAG" },
    { file: "evelyn_paper_boost_tests.js",    label: "19. Paper Boost 1 (CoE, JitRL, FadeMem, Skimmer, Topo-RAG, Traj)" },
    { file: "evelyn_paper_boost2_tests.js",   label: "20. Paper Boost 2 (Conformal, BudgetCascade, Bloom, UCB, Membox)" },
    { file: "evelyn_paper_boost3_tests.js",   label: "21. Paper Boost 3 (DAG, MMR, CacheGuard, TaintCFI, AutoSR)" },
    { file: "evelyn_inkling_fast_tests.js",   label: "22. Inkling-Fast (5:1 SWA, ShortConv, AttnResid & 3D Inspector)" },
    { file: "evelyn_late2026_tests.js",       label: "23. Late-2026 Core (Steer, PoseCache, Prosody, LEASH, MCP/A2A)" },
    { file: "evelyn_agent_os_tests.js",       label: "24. Agent OS 2027 (eight platform pillars)" },
    { file: "evelyn_sovereign_local_tests.js",label: "25. Sovereign Local AI (Auto-Bench, Exo LAN Pool, Redactor & Manifest)" },
    { file: "evelyn_chums_tests.js",          label: "26. Chum Loft (Echoes and DritchChums: care, friends, kin, races, duels)" },
    { file: "evelyn_bookgames_tests.js",     label: "27. Book Games (a game from any book: characters, ideas, styles, archive)" }
  ];

  var passed = 0, failed = 0, missing = 0, tAll = Date.now();
  console.log("=======================================================================");
  console.log("  EVELYN MASTER VERIFICATION RUNNER (" + SUITES.length + " SUITES)");
  console.log("=======================================================================\n");

  for (var i = 0; i < SUITES.length; i++) {
    var s = SUITES[i];
    var fp = path.join(__dirname, s.file);
    if (!fs.existsSync(fp)) {
      missing++;
      console.log("[SKIP] " + s.label + " (file not in folder: " + s.file + ")");
      continue;
    }
    var t0 = Date.now();
    var res = cp.spawnSync(process.execPath, [fp], { encoding: "utf8", timeout: 20000 });
    var dt = Date.now() - t0;
    if (res.status === 0) {
      passed++;
      console.log("[PASS] " + s.label + " (" + dt + " ms)");
    } else {
      failed++;
      console.log("[FAIL] " + s.label + " (" + dt + " ms)");
      if (res.stdout) console.log(res.stdout.trim());
      if (res.stderr) console.log(res.stderr.trim());
    }
  }

  console.log("\n=======================================================================");
  console.log("  TOTAL: " + passed + " passed, " + failed + " failed, " + missing + " missing (" + (Date.now() - tAll) + " ms)");
  console.log("=======================================================================");
  process.exit(failed > 0 ? 1 : 0);
})();
