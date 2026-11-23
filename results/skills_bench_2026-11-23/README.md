# Skills bench, 2026-11-23: Inkling with and without Evelyn's notes and skills

Inkling 2 Mini (Q4_K_M) on LM Studio's llama.cpp runtime (server build b1-29b52d3), the RTX 3090, context 102,400 tokens, 8-bit cache, started through the GPU queue. One server, one request at a time. Runner: `js/test/evelyn_skills_bench.js`; tables: `tables.md` (every suite, task and setup); every reply's final code: `code/`; every number: `results.json`; the pictures: `gifs/`.

**The LM Studio application was not tested.** Everything here ran against the llama.cpp server. The same runner takes `--port 1234 --model thinkingmachines/inkling-2-mini` for LM Studio's own server; that run has not been made.

**About `results.json`.** It is schema 1: the verdicts, calls, tokens, seconds, efforts, notes found, active skills, visual flags, and the round-by-round errors of the photorealistic runs. It has no record of the server start line (card, cache type), the model file (the field `model` is the name sent, `inkling`), prompts, replies or thinking text; those are logged by the current runner (schema 2) and are described in the main README ("What the skills bench logs"). `node tests/check_bench_results.js results/skills_bench_2026-11-23/results.json` checks the file against the runner: 2,306 checks, 0 errors, 1 warning (the grounded questions have 9 of 18 planned runs).

## The five setups

| Setup | What it is |
| --- | --- |
| Inkling alone | One call at effort `high`, no notes, the code is not run before it is scored. |
| Loop, notes off | Evelyn's run-and-repair loop with no notes: the code is run, the exact errors go back, up to 2 repairs. |
| Loop, notes on | The same loop plus verified notes retrieved from an `OffsetShelfStore`. |
| Loop + skill | The loop with a skill (`js/evelyn_skills.js`): its rules, its notes (the same notes plus the three.js craft notes), a visual-quality system prompt, the effort the skill suggests. For three.js the loop's checker also runs the visual checks. |
| Loop + skill + Caldera | The same with the Caldera graphics skill registered next to the craft skill. |

The same seed is used in every setup for a task. A seed makes a run repeatable; it does not make two runs a fair sample. Two trials per cell is a small sample.

## Three.js scenes (cube, solar system, island; 30 runs)

| Setup | Runs | First draft passes | Final passes | Calls | Tokens | Seconds | Visual checks clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 6 | 3 of 6 | 3 of 6 | 1.0 | 3949 | 76 | 2 of 3 |
| Loop, notes off | 6 | 6 of 6 | 6 of 6 | 1.0 | 1916 | 37 | 2 of 6 |
| Loop, notes on | 6 | 6 of 6 | 6 of 6 | 1.0 | 1220 | 24 | 1 of 6 |
| Loop + skill | 6 | 1 of 6 | 6 of 6 | 1.8 | 2989 | 60 | 6 of 6 |
| Loop + skill + Caldera | 6 | 0 of 6 | 6 of 6 | 2.0 | 3474 | 71 | 6 of 6 |

"Pass" is the structural checker of `js/test/three_verify_worker.js` (object counts, geometry types, orbits, shadows). "Visual checks clean" counts the passing scenes that also pass `verifySceneVisuals` (lighting contrast, materials, atmosphere, framing); it was measured on every final code, whatever the setup. Neither checker looks at a picture.

## Photorealistic still life (10 runs)

A table, exactly three spheres (glass with transmission, polished metal, matte ceramic), a key light with shadows and a fill light, no `MeshBasicMaterial`, a camera on a circle.

| Setup | Runs | First draft passes | Final passes | Calls | Tokens | Seconds | Visual checks clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 0 of 2 | 0 of 2 | 1.0 | 5904 | 113 | 0 of 0 |
| Loop, notes off | 2 | 0 of 2 | 2 of 2 | 2.0 | 4188 | 83 | 0 of 2 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 1719 | 34 | 0 of 2 |
| Loop + skill | 2 | 0 of 2 | 2 of 2 | 2.0 | 3675 | 75 | 2 of 2 |
| Loop + skill + Caldera | 2 | 0 of 2 | 2 of 2 | 2.0 | 2780 | 57 | 2 of 2 |

The checker reads the scene graph: it can tell that the materials and lights are physically based, not that the picture looks like a photograph.

## Basic tasks

Four small JavaScript functions (`sumEven`, `wordFreq`, `isBalanced`, `mergeIntervals`; 32 runs): every setup passed every run on the first draft, so these tasks do not separate the setups on correctness. Alone used about 1,100 tokens and 22 seconds per run, the loop and the notes and skill setups about 340 tokens and 7 seconds (one alone run spent 5,532 tokens thinking).

Three grounded questions about an invented place (the answers exist only on the shelf): alone 0 of 3, notes on 3 of 3, skill 3 of 3. **Only 9 of the 12 planned question runs exist**: the server was shut down by another session after the first of the second trial; the rows made against the dead server were removed and not repeated.

## What the results show, and what they do not

- **Notes on were the fastest and cheapest in the three.js and photorealistic runs:** about 1,200 tokens and 24 seconds per three.js run against about 3,950 and 76 for Inkling alone. The notes were written by the same hand as the checks, so this shows what retrieval can do when the right note exists. It is not an unbiased accuracy.
- **Inkling alone failed 5 of its 8 scene runs** (a fifth sphere around the sun; two island runs and one photo run that used the whole 6,000-token budget thinking; one photo run with one physical material instead of two). It used effort `high` and no run of its code, which is part of why.
- **The skill setups were slower and used more tokens, and they are the only setups where every passing scene was clean for the visual checks (16 of 16 across the three.js and photorealistic runs).** That is by construction: their checker runs the visual checks and sends the errors back, the others' checkers do not. It shows the repair step works; it does not show the scenes look better. Nobody compared the pictures against each other except by looking at the GIFs.
- **A flaw in the craft note.** The first drafts of the skill setups failed in all 4 photorealistic runs with "buildScene(THREE) threw: document is not defined": the craft note recommends a canvas texture for a glow, and the task forbids the DOM, so the model used `document.createElement`. The note should suggest a `THREE.DataTexture` filled in code. It was not changed, so these results match the committed code.
- **The Caldera skill adds nothing on these tasks and activates on them anyway**, because "three.js" and "r187" are among its triggers. The triggers are too wide for a generic scene.
- **The effort setting made no visible difference on one trivial question** (35 tokens at 0.0, 41 at 0.9). That is one question.
- **Not measured:** LM Studio's own server, a phone or an old machine, pictures judged by a person or a model, more than 2 trials a cell. The first-draft errors of the 11 three.js skill runs that were repaired before the runner saved history were not kept (the photorealistic runs have them in `results.json`, field `history`).

## The pictures

`gifs/<task>_run<k>.gif`: the five setups side by side, in the order of the table. A panel reads "passes all checks" or "fails the checks" (the structural checker); a failed run that wrote no code shows a message instead of a picture. They are 384 by 216 scenes drawn in a headless Brave with software rendering (no graphics card), a seeded `Math.random`, and for the island, whose scene does not move, one turn of the camera. `tools/threejs_gifs.py` draws them and reports file sizes and page errors; it does not judge them. 40 single-setup GIFs are in `media/skills_bench/llama/single/` on the machine that ran the bench and are not in the repository.

Reproduce (needs a running server on the port, started by you):

```powershell
node js\test\evelyn_skills_bench.js --port 1249 --backend llama.cpp --model inkling --suite basic,three,photo --out tests\tmp\skills_bench\llama
python tools\threejs_gifs.py --three-dir <folder with three.module.js> --bench tests\tmp\skills_bench\llama --media media\skills_bench\llama
node tools\skills_bench_report.js tests\tmp\skills_bench\llama
```
