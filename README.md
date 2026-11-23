# Evelyn and her Echoes

![Evelyn: the concourse, a question to Echo, and the Lab](media/evelyn_demo.gif)

More: [the portrait, 10 seconds](media/evelyn_face_float.gif) and [the cartridge player, validator, debugger and safety charter](media/evelyn_features.gif).

Evelyn is an offline tutor, adventure game and coding lab for computers with little memory and no network. It comes from the Tiny-2.1 conversation saved in `AI-Studio_Tiny-2.1-Inter-Model-Communication-Capabilities_20261122-1804.md`. This folder holds three editions of it, each with its own tests, plus tests that run the same script through all three and compare the output.

| Folder | Edition | Runs on |
| --- | --- | --- |
| `js/` | JavaScript (ES5, no dependencies) | any browser from a file, or Node |
| `c/` | C (C89 style) | any C compiler; written with old DOS compilers in mind |
| `basic/` | BASIC (QuickBASIC dialect, FreeBASIC `-lang qb`) | FreeBASIC, including DOS and Raspberry Pi targets |

The JavaScript edition is the reference. The other two are checked against it.

## What is in it

- **Library.** Text is compressed with 16-bit LZW, stored as base64, and indexed by word. `LIBRARY.EVL` is the file format; all three editions read and write the same file. A starter set of 16 facts is built in, and any `.txt` file can be added.
- **Neural engine.** A reader for the `TNY2` weight file (4 layers of width 96 for the real `TINY.BIN`) with an 8-bit KV cache. It answers one character at a time. The `KV21` format moves a cache from one model to another. The shape of the file comes from the loader in the source conversation; no trained `TINY.BIN` was available here, so the tests use generated weights.
- **Learner profile.** The reading, audio, doing or mixed style, experience points, topics mastered, and the adventure state. `USER.CFG` is the file format.
- **Tutor.** Answers arithmetic itself, otherwise looks the question up in the library, shapes the answer to the learner's style, and adds the neural engine's text when a model is loaded.
- **Adventure.** Four rooms with a puzzle each, using the same library for hints.
- **Coding lab.** A small language (`LET`, `PRINT`, `IF..THEN`, `REPEAT`/`END`, `MOVE`, `TURN`, `CLEAR`) that draws on a 12 by 12 turtle grid and stops after 500 steps.
- **Extras in the JavaScript and C editions.** Several shelves of knowledge searched together with a checker that rejects numbers the sources do not hold, the 12-byte game packet and 6-byte-plus-weights bot packet for slow links, and the integer dot product for weak CPUs.

| Part | JS | C | BASIC |
| --- | --- | --- | --- |
| LZW and base64 | yes | yes | yes (dictionary of 4095 codes) |
| Library, ingest, `LIBRARY.EVL` | yes | yes | yes (1000 entries) |
| `TNY2` engine, greedy answers | yes | yes | yes |
| Sampling with a seed | yes | yes | no |
| `KV21` export and import | yes | yes | no (a primed prefix works) |
| Profile and `USER.CFG` | yes | yes | yes |
| Tutor, adventure, coding lab | yes | yes | yes |
| Several shelves and the checker | yes | yes | no |
| Packets and the integer dot | yes | yes | no |
| Browser page | yes | | |

## Running it

```powershell
node js\evelyn_cli.js                      # terminal
start js\index.html                        # browser, nothing to install
c\build.bat ; c\out\evelyn.exe             # C, Visual Studio compiler (or: make -C c)
node tests\qbi.js basic\evelyn.bas         # BASIC in the bundled interpreter
basic\build.bat ; basic\evelyn.exe         # BASIC with FreeBASIC (fbc on the PATH)
```

All three programs take the same commands: a question, `/mode R|A|D|M`, `/adv` to enter or leave the adventure, `/code LET a=4;PRINT a*a`, `/profile` and `/quit`. Pass a `.BIN` file to load a `TNY2` model and any other file to add it to the library.

## Tests

```powershell
node tests\run_all.js
```

This runs, in order: generated files are current, BASIC names avoid keywords, no stray control characters, the JavaScript unit tests (48), the BASIC interpreter tests (49), the C build, the C unit tests (212), the cross-edition conformance run, and the command line programs for all three (24 checks).

**Conformance.** `tests/conformance.txt` is one script of 228 commands in six sections: core (180), kv (12), sampling (11), swarm (11), net (11) and full (3). Each edition has a small driver (`js/evelyn_proto.js`, `c/evelyn_proto.c`, `basic/evelyn_proto.bas`) that reads the script and prints one result line per command. `tests/run_conformance.js` runs the script through every edition and compares the lines with the JavaScript output. Score lines may differ in the sixth decimal; every other line must be identical. It also compares the files the editions write (`LIBRARY.EVL`, `USER.CFG`, `KV21` caches) byte for byte, and feeds each edition the files the JavaScript edition wrote. The neural engine is checked on generated models, including one with the real `TINY.BIN` shape (JavaScript and C).

Result on this machine: JavaScript and C agree on 1135 output lines in all six sections, and BASIC agrees on the 1011 lines of the core section, with byte-identical files.

**Planted bugs.** The suite was tried against deliberate faults (a changed ranking weight, a changed rounding rule in the KV quantizer, a changed note frequency in C, a changed rounding rule in BASIC). Each was reported by at least one test.

## What has and has not been checked

- The JavaScript edition ran in Node 25 and in a real browser (the page loads, answers, runs the adventure and the coding lab, and saves the profile).
- The C edition was compiled with Visual Studio's compiler (`cl`). It is written to C89 rules and has a Makefile for gcc with `-std=c89 -pedantic`, but no gcc was available to try it. The DOS and Turbo C code paths (`sound()`, huge pointers) were not compiled.
- **The BASIC edition was not compiled with FreeBASIC, which is not installed here.** It ran in `tests/qbi.js`, an interpreter for the subset of BASIC it uses. The interpreter is strict on purpose: it refuses undeclared variables, stops on 16-bit INTEGER overflow, rounds SINGLE values to 32 bits at every step, and requires exact types for by-reference arguments. That catches the usual mistakes, but only a real compiler shows whether the declarations and file statements are accepted. The first thing to try on a machine with FreeBASIC is `node tests\run_conformance.js`: when `fbc` is on the PATH it compiles `basic/evelyn_proto.bas` and compares that program with the JavaScript edition too.
- No real `TINY.BIN` was available. When you have one, run the same question through `TINY.EXE` and through `node js\evelyn_cli.js --bin TINY.BIN` and compare.

## Differences from the code in the conversation

The editions follow the conversation's design, with these changes made so the three agree and the tests have exact answers.

- The namespace is `Evelyn` (`Oasis` remains as an alias in browsers).
- Library search lists higher scores first and, on a tie, the lower entry number.
- The coding language accepts `=` as well as `==` in conditions, ignores the case of variable names, joins strings with `+`, and prints numbers with at most six decimals.
- A solved puzzle awards the experience points its reward text names (20, 20, 20 and 50). Before, every puzzle gave 10.
- The checker in the multi-shelf code ignores the `[shelf#id]` tags when it looks for numbers; with them in, almost every answer failed.
- `bestLearnedMode` returns the learner's current mode when no mode has a count yet.
- In Node 25 the global `localStorage` printed a warning, so the browser's storage is used only inside a browser; Node uses a folder (`Storage.useDirectory`).
- The `KV21` header lists the width first, then the layer count, then the length, as the JavaScript code in the conversation did. The C helper in the conversation wrote the layer count first.
- `Tiny2Model.prime(text)` was added: it feeds text as a prefix that stays in the cache, so a prefix exported from one model can be imported by another and the second model continues exactly where the first stood.
- The micro game demo (Verlet rope and evolving bots) from the conversation is not included.

## Folders

```
js/       evelyn_core.js  evelyn_cli.js  evelyn_proto.js  index.html  test/test_evelyn.js
c/        evelyn.h  evelyn.c  evelyn_data.h  evelyn_cli.c  evelyn_proto.c  evelyn_test.c  build.bat  Makefile
basic/    evelyn_core.bi  evelyn_data.bi  evelyn_io.bi  evelyn_decl.bi  evelyn.bas  evelyn_proto.bas  build.bat  build.sh
tools/    make_test_model.js  gen_data.js  gen_decl.js  check_bas_names.js  bas_keywords.json
tests/    run_all.js  run_conformance.js  conformance.txt  qbi.js  test_qbi.js  test_clis.js
```

`evelyn_data.h` and `evelyn_data.bi` are generated from `js/evelyn_core.js` by `node tools\gen_data.js`, so the starter facts, rooms and lessons exist once. `evelyn_decl.bi` is generated by `node tools\gen_decl.js`. After changing a fact, a room or a procedure header, run both; `run_all.js` fails when they are out of date.

## File formats

- **`TNY2`**: `TNY2`, then width, layers, heads and hidden size as 16-bit numbers; then the token table (97 rows), the position table (128 rows), then for each layer the gains, the q, k, v and o tables, the gains and the two feed-forward tables; then the final gains. A table row is a 32-bit float scale followed by one signed byte per column. All numbers are little endian.
- **`KV21`**: `KV21`, width, layers and length as 16-bit numbers; then for each layer and position the key scale, the key bytes, the value scale and the value bytes.
- **`LIBRARY.EVL`**: one line per entry, `topic TAB category TAB fact TAB example`, where the fact and the example are base64 text of the LZW codes.
- **`USER.CFG`**: `KEY=value` lines (`NAME`, `MODE`, `PACE`, `XP`, `FB`, `ROOM`, `SOLVED`, `INV`, `MASTERED`, `RECENT`); lists are joined with `|`.
- **Game packet**: player, buttons, sequence (16 bits), then x, y (units of 1/16) and vx, vy (units of 1/256) as signed 16-bit numbers. **Bot packet**: weight count (16 bits), a 32-bit float scale, one signed byte per weight.

## The NEON stack (`neon/`, added 2026-11-22)

The later turns of the Tiny-2.1 conversation and its "Adaptive Learning Suite" branch (`AI-Studio_...-2049.md` files) built a second, browser-first JavaScript stack on top of the same ideas. It lives in `neon/`, all ES5, no dependencies, Node or browser, and it is separate from the `js/` reference edition (its own `EvelynBackend`, IndexedDB shelves, Web Worker `TNY2`).

| File | What it is |
| --- | --- |
| `evelyn_backend.js`, `evelyn_cartridges.js` | storage (IndexedDB, fallback), shelves, Worker `TNY2`, SM-2, audio; the `.cart.json` validator, canon tables, sand engine |
| `evelyn_concourse.html` | the playable hub (open it from a file); `evelyn_neon.html` is the earlier single-file version |
| `evelyn_evolution.js`, `evelyn_suite_78.js`, `evelyn_suite_integration.js` | 78 cartridges in 15 doors; decks of 24 that adapt to recent lessons and the learner's stated focus |
| `evelyn_voice_guard.js`, `evelyn_director.js` | runtime AI-tic filter; reactive world state between games and camera framing |
| `evelyn_frontier.js`, `evelyn_robotics.js`, `evelyn_bot_rx/` | graph memory, grammar decoding and related systems; robot simulator, safety governor, Arduino receiver sketch |
| `evelyn_sentinel.js`, `evelyn_charter.js` | CRC32 envelopes, atomic store, scrubber; sealed ethos, zero-harm gate, read-only OBD-II |
| `evelyn_doctor.js`, `evelyn_art.js` | self-repair and watchdogs; CRT portrait and favicon |
| `evelyn_net.js`, `game_engine_demo.html` | packet codecs; the micro game engine demo |
| **`evelyn_chums.js`** (+ generated `evelyn_chums_data.js`) | **the DritchChum / Echo pet raising system** |

**DritchChums and Echoes (owner ruling, 2026-11-22).** The pet raising system is the DritchChum system of Scar Brand (`BocaDeAmourGame_2026-11-21/PLAN_SCAR_BRAND_ADAPTATION.md` section 6). "Echo" and "DritchChum" are interchangeable words for the same creatures and the same code (`EvelynChums`, also `EvelynEchoes` and `EvelynDritchChums`; chat commands accept either word). By convention the nice creatures are Echoes and the nastier ones DritchChums, and every pair can become friends in the right circumstances (shared meal, story night, storm shelter, mending circle, hum chorus, a lost kit; races and duels make friendly rivals). **Pets are never humanoid women:** species come only from the `creature` records of `CharacterDatabase` (111: 52 Echoes, 59 DritchChums; the 47 humanoids are never pets, and the generator drops any creature whose text describes a woman or girl). Rules taken from the plan: stats (Stand, Reach, Glide, Keep, Hum) show as thread weight and colour, never as numbers; nothing is hurt on screen; a creature with three days of no care is released to its home, kindly (a month away costs at most two days); kin of the same creature only, with inherited palette, stitch affinity and a 30-weight brain (36 bytes); care questions come from the species table (weak to, resists, home, how it eats) and a wrong answer never costs anything. DritchChums play harmless pranks and grow stats faster; Echoes trust sooner. The species file is generated: `node tools/gen_chums.js` (`--check` is part of `run_all.js`).

**The loft screen** (in `evelyn_concourse.html`, below the Adopt row once two creatures are in the loft): a track where "Race everyone" runs animated lanes (the winner's bar reaches the end, nobody is hurt), a duel stage ("hold the last note", the loser still gets a ribbon) and a meeting corner where two creatures meet in a chosen friendly circumstance and the screen says how they feel. Races and duels grow friendly rivalry bonds between the racers or duellists, and the header counts the two cups.

**Shared with the Scar Brand game.** `BocaDeAmourGame_2026-11-21/data/chums/` (`species.json`, `rules.json`) is generated from this module by `BocaDeAmourGame_2026-11-21/tools/build_chums.js`; `tools/test_chums_link.js` there (run by `run_all.js`) fails when the game's data and the module drift apart. The game keeps the plan's Ledger rule as a flag: 52 of the 111 species have a Ledger entity of the same name and are `playable` there (19 Echoes, 33 DritchChums); the rest stay `ledger: null` until the owner rules. Change the care, bond, kin or release rules here and run `node tools/build_chums.js` in the game folder.

**Changes made while placing the NEON code** (each found by running the suites):
- The ES5 audits in seven test files matched the regular-expression text that does the matching (`=>`); the pattern is now built at run time.
- `evelyn_suite_78.js`: a wrong-answer choice said "noon" where the suite's canon rule wants 12-hour clocks written out; now "ROOM-P1 12 PM".
- `evelyn_evolution.js`: a cartridge whose subjects map to the small fixed question banks (The Umbrella Doors: geography plus coding) stalled at 10 items; the deck is now topped up from the generators that never run out, so every cartridge reaches 24.
- `evelyn_voice_guard.js`: "isn't just about X, it's about Y" was not flagged (only "not just" and "isn't about"); the rule-of-three list missed "-sion" words.
- `evelyn_frontier.js`: the shelf-citation grammar had no length limit, so with random logits it never reached `#` inside 16 characters; names are now 2 to 8 letters.
- `evelyn_robotics.js`: the PID controller now stops integrating while the output is pinned at a limit (anti-windup); `evelyn_robotics_tests.js` uses a slower integral gain (0.05), because with 0.15 the loop still overshot by 5 percent at 4 seconds.
- `evelyn_net.js` is exported for Node as well as the browser; `evelyn_concourse.html` loads every module and mounts the portrait, doctor, hub, director, voice guard, charter gate and Chum Loft, rebuilt when the profile changes; `evelyn_test_runner.html` runs every suite.
- `evelyn_kaizostria_neon.html` (the chat's first attempt at the canon game hub) was left out: the reply was cut off in mid-string and the next turn replaced it with the split stack above.

**Checked:** `node tests/run_all.js` runs the nine Node suites of `neon/` (17, 6, 7, 8, 8, 6, 6, 4 and 10 checks) and `tests/check_neon_browser.py`, which starts its own server and drives real Brave: all suites in the page (64 checks; the eight Node-only audits are skipped there), the concourse (15 doors, 78 cartridges, portrait, loft, adopting an Echo and a DritchChum, chat commands with either word, opening a cartridge, the loft surviving a reload through IndexedDB), and the other two pages load without errors.

**Not checked, and left:** the Arduino sketch (`neon/evelyn_bot_rx/`) was not compiled and the Web Serial robot bridge never touched hardware; no phone, old browser (IE or 2012 builds) or real `TINY.BIN`; the speech and sound paths were not listened to; the C and BASIC editions have no chum system (the NEON stack is JavaScript only); the frontier, robotics and sentinel modules are tested but have no screen in the concourse; the Kaizostria cartridge plan in `cartridges/` still calls the phonics sound-creatures "Echoes" with no raising loop, which fits the new meaning but is not yet linked to the loft.

## The NEON stack, round 2 (2236 export)

The "Adaptive Learning Suite" export (`...-2236.md`, byte-identical to `-2228`) holds 41 code files for this round (its other code blocks are the round-1 files again). The Tiny 2.1 export `-2249` is byte-identical to `-2049` and `-2011`, so it added nothing. All of them are in `neon/`; each was compared with its code block in the export. Every file is the same as the export except the round-1 changes listed above and the changes listed below (mostly the ES5-audit fix in test files). `CREDITS.md` lists, with links and licences, the papers, repositories, posts and pages the code drew on.

| Module (all ES5, no network) | What it does | Tests |
| --- | --- | --- |
| `evelyn_game_xray.js`, `evelyn_game_xray_gen6.js` | take apart a game file on the device: NES, Game Boy, WAD, DOS, ISO, CHIP-8, Mega Drive, N64, PS1, GBA, Dreamcast, GameCube, PS2 (6502 and MIPS listings, tile decoding, entropy map) | 5 + 6 |
| `evelyn_asset_studio.js` | sprite animator, tilemap swap, 2bpp encoder, IPS patcher, palette contrast audit | 6 |
| `evelyn_3d.js` | CPU z-buffer rasterizer, `.OBJ` reader and writer, 2.5D raycaster | 6 |
| `evelyn_code_forge.js`, `evelyn_ast_ide.js` | MiniGit, MiniSQL, 6502 assembler and VM, app exporter; AST linter, autocomplete, safe rename, Big-O profile | 5 + 5 (in `turbo`) |
| `evelyn_wasm_accel.js`, `evelyn_code_engine.js`, `evelyn_bridge.js` | hand-written WebAssembly `i8_dot`, BPE, RoPE, fill-in-the-middle, prefix cache; the optional companion server | 5 (`turbo`) |
| `evelyn_hybrid_rag.js`, `evelyn_code_power.js`, `evelyn_lang_core.js`, `evelyn_manual_compiler.js` | code retrieval; safe patcher and call-graph slicer; a four-family language core; manual-to-JSON compiler | 5, 5, 5, 4 |
| `evelyn_paper_boost.js`, `2`, `3`, `evelyn_inkling_fast.js`, `evelyn_late2026_core.js`, `evelyn_agent_os.js`, `evelyn_sovereign_local.js` | the 2026 paper mechanisms, the looped and sliding-window engine, eight small-hardware adaptations, eight agent-platform pillars, backend auto-benchmark and a LAN layer pool (simulation only) | 7, 6, 7, 6, 7, 6, 5 |
| **`evelyn_lab.js`** (new) | the screen for the modules above: the **Lab** view of the concourse (button 5) with Game X-Ray, Asset Studio and IPS, a 3D viewer, SQL and code check, and a module status list | `check_neon_browser.py` section 2b |

**Changes made while placing them** (each found by a test or by reading the file):
- Same ES5-audit fix as round 1 in seven more test files: the pattern that looks for `=>` no longer matches its own text.
- `evelyn_voice_guard.js`: "isn't just about" and the rule-of-three words ending in "sion", "ance" and "ence" were missed.
- `evelyn_sovereign_local.js`: the backend benchmark read a whole-millisecond clock, so two fast kernels both read 0 ms and the first listed won; it now uses the high-resolution clock, three timings and longer runs when a timing is under 5 ms.
- `evelyn_bridge.js` (the one module that can run code, so it was reviewed line by line): it binds only to 127.0.0.1 and never starts by itself (requiring it opens no port; only `node evelyn_bridge.js` does). Added: a per-start token for every `/api` call except `/api/health`, Host and Origin checks, JSON-only bodies, and `Cross-Origin-Resource-Policy`; a write into a missing folder no longer throws inside the request handler and ends the process; only `.html .js .css .json .bin` are served as static files; a program it runs gets a small environment (no keys or tokens from the server's); a link inside the workspace that leaves it is refused. `evelyn_turbo_tests.js` tests each of these, including a cross-site page, a rebinding host name and a link out of the workspace.
- `tests/run_all.js` runs the 17 new suites and the chat's own master runner (26 suites). The browser check's "at least 150 checks" floor was stale; it is 140 now (143 measured) and it also checks that all 19 suites that run on load announced themselves.
- `evelyn_test_runner.html` loads every module and suite; `evelyn_concourse.html` loads `evelyn_lab.js`.

**Safety review of the modules that reach outside the page.** None of the 41 files makes a network call, uses `eval`, `new Function` or `document.write` (checked by search); only the bridge touches the file system or runs programs, and it is described above. The LAN layer pool is an in-memory simulation with no sockets, so it is off and cannot reach a network. The IPS patcher works on bytes of files the learner picks, never changes the original, checks every record against the file size, and ships no ROM or disc data (the tests use made-up files). The Lab page was checked to request nothing outside its own server.

**Checked (2026-11-22):** `node tests/run_all.js`: every step PASS. That includes `neon/evelyn_run_all_tests.js` (27 suites, 0 failed, 0 missing) and the real-browser check (143 checks in the test page, the Lab view's 11 checks, no page errors, no outside requests). The new suites were also run one by one.

**Not checked, and left:** no real console ROMs, discs, `.OBJ` models or `.ips` patches were tried (only made-up files and the file pickers by script, not a person); the bridge was run only in tests and was never exposed to a network, and `tcc` and `python3` runs through it were not tried; no hardware (robot, car, microcontroller) was touched; no phone, old browser or real `TINY.BIN`; the Lab's file pickers were not used with large files; the LAN pool has no real transport; the paper and product names in `CREDITS.md` were taken from the conversations and not checked; there are no C or BASIC editions of any round-2 module.

**Coding shelves (2026-11-22).** `sh tools/fetch_coding_refs.sh <folder>` downloads open-licence coding references (MDN JavaScript, Learn X in Y Minutes, SICP, Eloquent JavaScript, javascript.info, the Node.js and Python 3.13 docs, the Rust book, Think Python) and `node tools/build_shelves.js <folder>` cuts them into short text entries that load with the "+TXT Shelf" button (43 files, about 154,000 entries, 19 MB; searching them through Evelyn's own shelf code was tried). The downloads are not part of this repository; their licences and the terms that apply are in `CREDITS.md` section 5. Evelyn does not train on them: the shelves are indexed text, and the `TNY2` model still needs its own `TINY.BIN`.

**Book games (2026-11-23).** `neon/evelyn_bookgames.js` turns a book a learner has read into a game for the concourse player. The book can be a `.txt` file, text pasted in, a book already kept in the archive, or a shelf. The game is an ordinary `.cart.json` and is checked by the real cartridge validator before it is returned. Questions are cut from the book itself: who said a line, which name fills a gap, which word is missing, which sentence mentions an idea, which of three comes first. Each right answer is checked against the text in the tests, and a kid-safe filter keeps out violent words and anything the canon rules reject. The learner chooses by **style** (arcade, detective, quiz show), by **focus** (the characters, the ideas and words, or both), through a **preset**, or in **their own words** ("a space battle about the characters" makes an arcade game about the characters). The same seed always makes the same game. Find it in the concourse under **Lab > Book Game**; loading a book with "+TXT Shelf" now also keeps the whole text in the archive (a new IndexedDB store, `books`, database version 2) and offers to make a game from it. A shelf keeps only the first 180 characters of each paragraph, so a full book makes a better game than a shelf does. Tests: `neon/evelyn_bookgames_tests.js` (10 checks, including real books and Evelyn's own shelf loader when the reading library is present) and section 2b of `tests/check_neon_browser.py`.

**Reading library.** `python tools/fetch_reading_refs.py <folder>` fetches public-domain and freely readable texts (a Gutenberg book is accepted only when its own title header matches; a page that answers 403 or 429 is skipped, never worked around) and `node tools/build_shelves.js <folder>` turns them into shelves. What was fetched and what could not be is in `CREDITS.md` section 5b.

Credits and licences of everything Evelyn builds on are in `CREDITS.md`. Evelyn is under the MIT licence (see `LICENSE`).
