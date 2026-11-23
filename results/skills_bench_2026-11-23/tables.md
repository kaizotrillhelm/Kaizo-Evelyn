# Evelyn skills bench: llama.cpp, inkling

Server context 102400 tokens, 2 trials per cell. Effort probe on a trivial sum: [{"effort":0,"tokens":35,"answer":"42"},{"effort":0.9,"tokens":41,"answer":"42"}].

## basic/code (32 runs)

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 8 | 8 of 8 | 8 of 8 | 1.0 | 1141 | 22 |
| Loop, notes off | 8 | 8 of 8 | 8 of 8 | 1.0 | 354 | 7 |
| Loop, notes on | 8 | 8 of 8 | 8 of 8 | 1.0 | 343 | 7 |
| Loop + skill | 8 | 8 of 8 | 8 of 8 | 1.0 | 331 | 7 |

### basic/code / sumEven

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 2 of 2 | 2 of 2 | 1.0 | 345 | 7 |
| Loop, notes off | 2 | 2 of 2 | 2 of 2 | 1.0 | 289 | 6 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 204 | 5 |
| Loop + skill | 2 | 2 of 2 | 2 of 2 | 1.0 | 171 | 4 |

### basic/code / wordFreq

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 2 of 2 | 2 of 2 | 1.0 | 3182 | 61 |
| Loop, notes off | 2 | 2 of 2 | 2 of 2 | 1.0 | 446 | 9 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 380 | 8 |
| Loop + skill | 2 | 2 of 2 | 2 of 2 | 1.0 | 374 | 8 |

### basic/code / balanced

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 2 of 2 | 2 of 2 | 1.0 | 560 | 11 |
| Loop, notes off | 2 | 2 of 2 | 2 of 2 | 1.0 | 320 | 7 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 332 | 7 |
| Loop + skill | 2 | 2 of 2 | 2 of 2 | 1.0 | 487 | 10 |

### basic/code / mergeIntervals

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 2 of 2 | 2 of 2 | 1.0 | 477 | 10 |
| Loop, notes off | 2 | 2 of 2 | 2 of 2 | 1.0 | 363 | 7 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 458 | 9 |
| Loop + skill | 2 | 2 of 2 | 2 of 2 | 1.0 | 291 | 6 |

## basic/qa (9 runs)

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 3 | 0 of 3 | 0 of 3 | 1.0 | 457 | 9 |
| Loop, notes on | 3 | 3 of 3 | 3 of 3 | 1.0 | 83 | 2 |
| Loop + skill | 3 | 3 of 3 | 3 of 3 | 1.0 | 75 | 2 |

### basic/qa / bells

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 0 of 2 | 0 of 2 | 1.0 | 450 | 9 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 68 | 2 |
| Loop + skill | 2 | 2 of 2 | 2 of 2 | 1.0 | 64 | 2 |

### basic/qa / vault

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run |
| --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 1 | 0 of 1 | 0 of 1 | 1.0 | 472 | 9 |
| Loop, notes on | 1 | 1 of 1 | 1 of 1 | 1.0 | 112 | 3 |
| Loop + skill | 1 | 1 of 1 | 1 of 1 | 1.0 | 98 | 2 |

Failures:

- bells / alone / trial 1: the answer does not contain 17 or seventeen
- bells / alone / trial 2: the answer does not contain 17 or seventeen
- vault / alone / trial 1: the answer does not contain odalys fenn

## three/code (30 runs)

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run | Visual checks clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 6 | 3 of 6 | 3 of 6 | 1.0 | 3949 | 76 | 2 of 3 |
| Loop, notes off | 6 | 6 of 6 | 6 of 6 | 1.0 | 1916 | 37 | 2 of 6 |
| Loop, notes on | 6 | 6 of 6 | 6 of 6 | 1.0 | 1220 | 24 | 1 of 6 |
| Loop + skill | 6 | 1 of 6 | 6 of 6 | 1.8 | 2989 | 60 | 6 of 6 |
| Loop + skill + Caldera | 6 | 0 of 6 | 6 of 6 | 2.0 | 3474 | 71 | 6 of 6 |

### three/code / cube

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run | Visual checks clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 2 of 2 | 2 of 2 | 1.0 | 927 | 18 | 2 of 2 |
| Loop, notes off | 2 | 2 of 2 | 2 of 2 | 1.0 | 721 | 14 | 2 of 2 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 443 | 9 | 1 of 2 |
| Loop + skill | 2 | 1 of 2 | 2 of 2 | 1.5 | 1852 | 37 | 2 of 2 |
| Loop + skill + Caldera | 2 | 0 of 2 | 2 of 2 | 2.0 | 2784 | 57 | 2 of 2 |

### three/code / solar

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run | Visual checks clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 1 of 2 | 1 of 2 | 1.0 | 4919 | 95 | 0 of 1 |
| Loop, notes off | 2 | 2 of 2 | 2 of 2 | 1.0 | 1468 | 28 | 0 of 2 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 1194 | 23 | 0 of 2 |
| Loop + skill | 2 | 0 of 2 | 2 of 2 | 2.0 | 3658 | 74 | 2 of 2 |
| Loop + skill + Caldera | 2 | 0 of 2 | 2 of 2 | 2.0 | 3517 | 72 | 2 of 2 |

### three/code / island

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run | Visual checks clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 0 of 2 | 0 of 2 | 1.0 | 6000 | 115 | 0 of 0 |
| Loop, notes off | 2 | 2 of 2 | 2 of 2 | 1.0 | 3561 | 69 | 0 of 2 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 2024 | 40 | 0 of 2 |
| Loop + skill | 2 | 0 of 2 | 2 of 2 | 2.0 | 3458 | 70 | 2 of 2 |
| Loop + skill + Caldera | 2 | 0 of 2 | 2 of 2 | 2.0 | 4120 | 84 | 2 of 2 |

Failures:

- solar / alone / trial 1: expected exactly 4 SphereGeometry meshes (a sun and 3 planets), found 5
- island / alone / trial 1: the reply has no closed fenced code block
- island / alone / trial 2: no reply: Inkling sent no answer text (finish: length); the token limit may have been used up by reasoning

Passed the structural checks but flagged by the visual checks:

- cube / notes / trial 1: Visual check: ambient/hemisphere light (0.50) is too strong compared to key light (1.20); lower ambient to <= 0.15 * key for crisp light/shadow contrast.
- solar / loop / trial 1: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- solar / notes / trial 1: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- solar / alone / trial 2: Visual check: hero subject fills only 37% of viewport; move camera closer so it fills ~55-70%.
- solar / loop / trial 2: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- solar / notes / trial 2: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- island / loop / trial 1: Visual check: ambient/hemisphere light (0.65) is too strong compared to key light (1.60); lower ambient to <= 0.15 * key for crisp light/shadow contrast.
- island / notes / trial 1: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- island / loop / trial 2: Visual check: ambient/hemisphere light (0.70) is too strong compared to key light (1.60); lower ambient to <= 0.15 * key for crisp light/shadow contrast.
- island / notes / trial 2: Visual check: ambient/hemisphere light (0.60) is too strong compared to key light (1.60); lower ambient to <= 0.15 * key for crisp light/shadow contrast. ; Visual check: scene has no atmospheric depth; add a THREE.Points

## photo/code (10 runs)

| Setup | Runs | First draft passes | Final passes | Calls per run | Tokens per run | Seconds per run | Visual checks clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inkling alone | 2 | 0 of 2 | 0 of 2 | 1.0 | 5904 | 113 | 0 of 0 |
| Loop, notes off | 2 | 0 of 2 | 2 of 2 | 2.0 | 4188 | 83 | 0 of 2 |
| Loop, notes on | 2 | 2 of 2 | 2 of 2 | 1.0 | 1719 | 34 | 0 of 2 |
| Loop + skill | 2 | 0 of 2 | 2 of 2 | 2.0 | 3675 | 75 | 2 of 2 |
| Loop + skill + Caldera | 2 | 0 of 2 | 2 of 2 | 2.0 | 2780 | 57 | 2 of 2 |

Failures:

- photo / alone / trial 1: expected MeshPhysicalMaterial on at least 2 meshes, found 1
- photo / alone / trial 2: no reply: Inkling sent no answer text (finish: length); the token limit may have been used up by reasoning

Passed the structural checks but flagged by the visual checks:

- photo / loop / trial 1: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- photo / notes / trial 1: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- photo / loop / trial 2: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.
- photo / notes / trial 2: Visual check: scene has no atmospheric depth; add a THREE.Points starfield/particles, THREE.Sprite glow, or scene.fog.

