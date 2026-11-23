# Credits and sources

Evelyn is original code. The ideas, formats and reference texts it builds on come from the work below. Every entry has a link.

**How to read this file.** Links to papers are built from the id or the title in the research notes the code was written from; they were not each opened and checked, and the descriptions of what a paper says are the notes' descriptions. Where only a title is known the link is an arXiv search. Where no link could be given, none is invented.

**Licence of Evelyn itself.** Evelyn's own code and documents are under the MIT licence (see `LICENSE`). That does not cover the works listed below: the downloaded reference texts and the ideas, projects and papers credited here keep their own licences. Evelyn is **not** a copy of any of them. In particular it contains no code, data or trained weights from Tiny-2.1: that repository's data licences (ODbL and CC BY-SA for three fact files and the trained network) do not carry over.

---

## 1. The starting point

| Project | Link | Licence | What Evelyn takes from it |
| --- | --- | --- | --- |
| Tiny-2.1 (WollyMonjac) | https://github.com/WollyMonjac/Tiny-2.1 | MIT | The idea of a tiny character-level question-answering transformer that fits on a 1.44 MB floppy and runs under MS-DOS, and the shape of its model file. Evelyn's `TNY2` and `KV21` formats and the JavaScript, C and BASIC editions were written from a description of that project; its source files were not read, so no code is copied from it. If you merge code from the repository, keep its MIT notice. |

## 2. Software projects whose ideas are used (no code copied)

| Project | Link | Licence | Idea used |
| --- | --- | --- | --- |
| BitNet / bitnet.cpp (Microsoft) | https://github.com/microsoft/BitNet | MIT | ternary weights, add-only inference (`BitNetI2S`) |
| llguidance | https://github.com/guidance-ai/llguidance | MIT | masking invalid tokens by grammar before sampling |
| XGrammar | https://github.com/mlc-ai/xgrammar | Apache-2.0 | same |
| exo | https://github.com/exo-explore/exo | Apache-2.0 | splitting a model's layers across several cheap devices (`ExoLayerPool`, a simulation) |
| **AirLLM** (lyogavin) | https://github.com/lyogavin/airllm | Apache-2.0 | **Inspiration for `js/evelyn_stream.js`**: run a model that does not fit in memory by loading one layer at a time, running it and dropping it; read the next layer ahead while the current one computes; check each layer shard. Evelyn takes the ideas only: the `layerAt(l)` accessor, per-layer prefetch, per-layer CRC32 pins (`SovereignManifest`), layer-order prefill, and a text store addressed by byte offset (`OffsetShelfStore`). No AirLLM code and no Python is included; the implementation is written fresh in ES5 for the `TNY2` file. |
| llama.cpp | https://github.com/ggml-org/llama.cpp | MIT | the local model server the optional bridge can talk to |
| whisper.cpp | https://github.com/ggml-org/whisper.cpp | MIT | offline speech-to-text path (`LocalTranscriptPipe`) |
| uzu | https://github.com/trymirai/uzu | MIT | an example of benchmarking local engines (`RuntimeBenchSelector`) |
| MLX | https://github.com/ml-explore/mlx | MIT | named in the design notes as a backend the benchmark could pick |
| Ollama | https://github.com/ollama/ollama | MIT | named in the design notes as a backend the benchmark could pick |

## 3. Research

### 3.1 Frontier systems (`neon/evelyn_frontier.js`, `neon/evelyn_inkling_fast.js`)

| Work | As cited | Link | Used for |
| --- | --- | --- | --- |
| Titans: Learning to Memorize at Test Time | Behrouz, Zhong, Mirrokni; NeurIPS 2025 | [arXiv:2501.00663](https://arxiv.org/abs/2501.00663) | `TitansContinuumMemory` in `evelyn_frontier.js` |
| Nested Learning | Behrouz et al.; NeurIPS 2025 | [arXiv:2512.24695](https://arxiv.org/abs/2512.24695) | same module (multi-speed memory) |
| Persona Vectors | Chen et al. | [arXiv:2507.21509](https://arxiv.org/abs/2507.21509) | `ActivationSteerer` in `evelyn_frontier.js` |
| HippoRAG 2: From RAG to Memory | Gutierrez et al.; ICML 2025 | [search](https://arxiv.org/search/?searchtype=all&query=HippoRAG%202%3A%20From%20RAG%20to%20Memory) | `HippoGraphMemory` (graph memory with Personalized PageRank) |
| Byte Latent Transformer | Pagnoni et al.; ACL 2025 | [search](https://arxiv.org/search/?searchtype=all&query=Byte%20Latent%20Transformer) | `EntropyPatcher` |
| XGrammar | Dong et al.; MLSys 2025 | [search](https://arxiv.org/search/?searchtype=all&query=XGrammar) | `GrammarDecoder` (token masking by grammar) |
| CRANE (grammar-constrained decoding) | ICML 2025 | [search](https://arxiv.org/search/?searchtype=all&query=CRANE%20(grammar-constrained%20decoding)) | alternating free and constrained decoding windows |
| Activation-Steered Compression | Azizi et al.; NeurIPS 2026 | [search](https://arxiv.org/search/?searchtype=all&query=Activation-Steered%20Compression) | steering ideas in `ActivationSteerer` |
| Huginn recurrent-depth model | Geiping et al.; February 2025 | [search](https://arxiv.org/search/?searchtype=all&query=Huginn%20recurrent-depth%20model) | `LoopedReasoner`, `evelyn_inkling_fast.js` |
| Tiny Recursive Models | NeurIPS 2026 | [search](https://arxiv.org/search/?searchtype=all&query=Tiny%20Recursive%20Models) | `LoopedReasoner` |

### 3.2 Writing-tic research (`neon/evelyn_voice_guard.js`)

| Work | As cited | Link | Used for |
| --- | --- | --- | --- |
| StoryScope | UMD and Google DeepMind | [arXiv:2604.03136](https://arxiv.org/abs/2604.03136) | dialogue and narrative tics in `evelyn_voice_guard.js` |

Also read for the same module (no links available for most): corpus studies on AI vocabulary (Kobak et al. 2024; Juzek and Ward 2025), Reinhart et al. (PNAS 2025) on nominalizations and trailing participle clauses, and The Economist's article "How to Spot AI Writing" (30 July 2026). The community page [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (text under CC BY-SA 4.0) informed the rule list; the rules in the code are written in our own words.

### 3.3 Manual compiler and agent memory (`neon/evelyn_manual_compiler.js`)

| Work | As cited | Link | Used for |
| --- | --- | --- | --- |
| Doc-to-LoRA | Sakana AI; 2026 | [arXiv:2602.15902](https://arxiv.org/abs/2602.15902) | roadmap idea only (not built): documents to small adapters |
| Text-to-LoRA | Sakana AI; ICML 2025 | [search](https://arxiv.org/search/?searchtype=all&query=Text-to-LoRA) | roadmap idea only |
| TabAgent | - | [search](https://arxiv.org/search/?searchtype=all&query=TabAgent) | `TabAgentRouter` in `evelyn_manual_compiler.js` |
| Corpus2Skill | - | [search](https://arxiv.org/search/?searchtype=all&query=Corpus2Skill) | `buildSkillTree` and `navigateSkillTree` |
| L-RAG | - | [search](https://arxiv.org/search/?searchtype=all&query=L-RAG) | `LazyEntropyGate` |
| VIGIL (verify before commit) | - | [search](https://arxiv.org/search/?searchtype=all&query=VIGIL%20(verify%20before%20commit)) | `verifyRuntimePack` |
| SD-RAG | - | [search](https://arxiv.org/search/?searchtype=all&query=SD-RAG) | `sanitizeRetrievedChunk` |
| Who Remembers What? | - | [search](https://arxiv.org/search/?searchtype=all&query=Who%20Remembers%20What%3F) | `ScopedMemoryBank` |
| CompactRAG | - | [search](https://arxiv.org/search/?searchtype=all&query=CompactRAG) | atomic question-answer nuggets |
| GRACE | - | [search](https://arxiv.org/search/?searchtype=all&query=GRACE) | charter design |
| Warp-Cortex | - | [search](https://arxiv.org/search/?searchtype=all&query=Warp-Cortex) | one shared weight buffer for many Echoes |
| SPARK | - | [search](https://arxiv.org/search/?searchtype=all&query=SPARK) | noted, not built |
| DRIFT | - | [search](https://arxiv.org/search/?searchtype=all&query=DRIFT) | noted, not built |
| Spotter | - | [search](https://arxiv.org/search/?searchtype=all&query=Spotter) | fast controller with reflection on error (robotics) |

### 3.4 Paper boosts (`neon/evelyn_paper_boost.js`, `evelyn_paper_boost2.js`, `evelyn_paper_boost3.js`)

| Work | As cited | Link | Used for |
| --- | --- | --- | --- |
| Parallel Context-of-Experts Decoding | - | [search](https://arxiv.org/search/?searchtype=all&query=Parallel%20Context-of-Experts%20Decoding) | `ContextOfExperts` (`evelyn_paper_boost.js`) |
| JitRL | - | [search](https://arxiv.org/search/?searchtype=all&query=JitRL) | `JitRLModulator` |
| FadeMem | - | [search](https://arxiv.org/search/?searchtype=all&query=FadeMem) | `FadeMemory` |
| SWE-Pruner | - | [search](https://arxiv.org/search/?searchtype=all&query=SWE-Pruner) | `CodeLineSkimmer` |
| Topo-RAG | - | [search](https://arxiv.org/search/?searchtype=all&query=Topo-RAG) | `CellAwareTableIndex` (table-aware retrieval) |
| Epistemic Context Learning | - | [search](https://arxiv.org/search/?searchtype=all&query=Epistemic%20Context%20Learning) | `TrustBroker` (`evelyn_paper_boost.js`) |
| SWE-Replay | - | [search](https://arxiv.org/search/?searchtype=all&query=SWE-Replay) | trajectory branching |
| StepShield | - | [search](https://arxiv.org/search/?searchtype=all&query=StepShield) | `TrajGuard` |
| TrajAD | - | [search](https://arxiv.org/search/?searchtype=all&query=TrajAD) | `TrajGuard` |
| DRAINCODE | - | [search](https://arxiv.org/search/?searchtype=all&query=DRAINCODE) | `TrajGuard` defence |
| CommCP | - | [search](https://arxiv.org/search/?searchtype=all&query=CommCP) | `ConformalFilter` (`evelyn_paper_boost2.js`) |
| BudgetMem | - | [search](https://arxiv.org/search/?searchtype=all&query=BudgetMem) | `BudgetCascade` |
| ShardMemo | - | [search](https://arxiv.org/search/?searchtype=all&query=ShardMemo) | `ShardBloomRouter` |
| SCATE | - | [search](https://arxiv.org/search/?searchtype=all&query=SCATE) | `UCBBandit` |
| OptimAI | - | [search](https://arxiv.org/search/?searchtype=all&query=OptimAI) | `UCBBandit` |
| Membox | - | [search](https://arxiv.org/search/?searchtype=all&query=Membox) | `MemboxLoom` |
| AgentDevel | - | [search](https://arxiv.org/search/?searchtype=all&query=AgentDevel) | `FlipRegressionGate` |
| MonoScale | - | [search](https://arxiv.org/search/?searchtype=all&query=MonoScale) | `FlipRegressionGate` |
| RuleSmith | - | [search](https://arxiv.org/search/?searchtype=all&query=RuleSmith) | cartridge self-play balancing (planned) |
| ROMA | - | [search](https://arxiv.org/search/?searchtype=all&query=ROMA) | `TaskTreeDAG` (`evelyn_paper_boost3.js`) |
| Dep-Search | - | [search](https://arxiv.org/search/?searchtype=all&query=Dep-Search) | task DAG |
| Less is More for RAG | - | [search](https://arxiv.org/search/?searchtype=all&query=Less%20is%20More%20for%20RAG) | `InfoGainPruner` |
| Context Bubble Construction | - | [search](https://arxiv.org/search/?searchtype=all&query=Context%20Bubble%20Construction) | `InfoGainPruner` |
| CacheAttack | - | [search](https://arxiv.org/search/?searchtype=all&query=CacheAttack) | `SafeSemanticCache` |
| CaMeLs Can Use Computers Too | - | [search](https://arxiv.org/search/?searchtype=all&query=CaMeLs%20Can%20Use%20Computers%20Too) | control-flow integrity (`TaintCFI`) |
| POLARIS | - | [search](https://arxiv.org/search/?searchtype=all&query=POLARIS) | data taint tracking |
| InfiAgent | - | [search](https://arxiv.org/search/?searchtype=all&query=InfiAgent) | fixed-budget state card |
| Active Context Compression | - | [search](https://arxiv.org/search/?searchtype=all&query=Active%20Context%20Compression) | fixed-budget state card |
| Capture the Flags: Family-Based Evaluation | - | [search](https://arxiv.org/search/?searchtype=all&query=Capture%20the%20Flags%3A%20Family-Based%20Evaluation) | `MetamorphicQuizzer` |
| Task2Quiz | - | [search](https://arxiv.org/search/?searchtype=all&query=Task2Quiz) | `MetamorphicQuizzer` |
| AutoSR | - | [search](https://arxiv.org/search/?searchtype=all&query=AutoSR) | `MiniAutoSR` |
| AutoNumerics | - | [search](https://arxiv.org/search/?searchtype=all&query=AutoNumerics) | `MiniAutoSR` |

### 3.5 Late-2026 adaptations (`neon/evelyn_late2026_core.js`)

Patterns from product and research announcements in late 2026, rebuilt as small local mechanisms (steerable planning, a pose-indexed spatial cache, dynamic resolution scaling, prosody direction, specification guards, lease-based safety, worktree pools, the MCP and A2A bus). The announcements named were from Google DeepMind (Genie), Tencent (Worldcrafter), Skywork (Matrix-Game), ByteDance (OmniHuman), Fish Audio (Drama), Liquid AI (LFM2.5), Anthropic (Model Context Protocol) and Google (Agent2Agent). No code or model from any of them is used. The claims were taken from a search summary and were not checked.

## 4. Posts and pages

| Source | Link | Used for |
| --- | --- | --- |
| "Agent platform of 2027", post by @john_ssuh | https://x.com/john_ssuh/status/2124336124172935336 | the eight pillars in `neon/evelyn_agent_os.js` |
| Thread on local models, open weights and private inference (21 November 2026) and its replies, including [@gladstein](https://x.com/gladstein), [@natolambert](https://x.com/natolambert), [@jperla](https://x.com/jperla), [@Melt_Dem](https://x.com/Melt_Dem) | no link kept | the ideas in `neon/evelyn_sovereign_local.js` (benchmark the engines, pool old devices, scrub personal data before any online step, offline transcription, pin the model files by checksum) |
| Human Rights Foundation, AI program | https://hrf.org/ai | named in that thread |
| encrypteveryprompt.org | https://encrypteveryprompt.org | named in that thread (privacy-first routing) |
| Interconnects | https://interconnects.ai | named in that thread |
| Large Text Compression Benchmark (Matt Mahoney) | https://mattmahoney.net/dc/text.html | background for the compressed-library design |

---

## 5. Reference libraries used to fill the shelves (not in this repository)

Evelyn's memory is text shelves. The coding shelves were made from the open sources below with `tools/fetch_coding_refs.sh` (downloads them) and `tools/build_shelves.js` (cuts them into short entries). The downloaded files and the shelves are **not** in this repository (`library/` and `shelves/` are ignored): they are other people's work under their own licences. Each entry is a cut of the source text, 178 characters at most, with the source's heading in front.

| Source | Link | Version | Licence | Terms that matter |
| --- | --- | --- | --- | --- |
| MDN Web Docs, JavaScript | https://github.com/mdn/content | `ea7722e` | [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) (prose), CC0 (code samples) | credit MDN contributors; share alike |
| Learn X in Y Minutes | https://github.com/adambard/learnxinyminutes-docs | `78548dd` | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | credit the authors; share alike |
| Structure and Interpretation of Computer Programs, HTML edition | https://github.com/sarabander/sicp | `bda03f7` | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | credit Abelson, Sussman and the HTML edition; share alike |
| Eloquent JavaScript, Marijn Haverbeke | https://github.com/marijnh/Eloquent-JavaScript | `4a58fbd` | [CC BY-NC 3.0](https://creativecommons.org/licenses/by-nc/3.0/) | non-commercial only |
| The JavaScript Language, Ilya Kantor | https://github.com/javascript-tutorial/en.javascript.info | `2020876` | CC BY-NC 4.0-based; see the repository's `LICENSE.md` | non-commercial; credit; ask the author for anything beyond that |
| Node.js API documentation | https://github.com/nodejs/node | `660c104` | [MIT](https://github.com/nodejs/node/blob/main/LICENSE) | keep the notice |
| The Rust Programming Language | https://github.com/rust-lang/book | `5c23042` | MIT or Apache-2.0 | keep the notice |
| Python 3.13 documentation | https://docs.python.org/3.13/download.html | text archive of 3.13 | [PSF licence](https://docs.python.org/3.13/license.html) | keep the notice |
| Think Python 2e, Allen Downey | https://github.com/AllenDowney/ThinkPython2 | `cf3d99c` | repository under MIT; the book carries its own licence in its front matter | check the book's front matter before sharing |

### 5b. Reading library (texts fetched for the shelves; not in this repository)

Fetched with `tools/fetch_reading_refs.py` from the `gutenberg.pglaf.org` mirror and the pages below, kept in `G:CandorPixEvelynLibrary` (outside the repository). The Project Gutenberg header and footer were removed from the shelves; if you share these texts with the Project Gutenberg name, follow [its terms](https://www.gutenberg.org/policy/license.html).

| Text | Link | Licence |
| --- | --- | --- |
| Aesop's Fables | https://www.gutenberg.org/ebooks/21 | public domain |
| Alice's Adventures in Wonderland (Lewis Carroll) | https://www.gutenberg.org/ebooks/11 | public domain |
| The Princess and the Goblin (George MacDonald) | https://www.gutenberg.org/ebooks/34339 | public domain |
| Beatrix Potter, eight tales (Peter Rabbit, Benjamin Bunny, Tom Kitten, Squirrel Nutkin, Tailor of Gloucester, Samuel Whiskers and two more) | Gutenberg ebooks 14304, 14407, 14814, 14837, 14838, 14868, 14872, 15575 (https://www.gutenberg.org/ebooks/14838 for Peter Rabbit) | public domain (US) |
| The Declaration of Independence | https://www.gutenberg.org/ebooks/1 and the [National Archives transcription](https://www.archives.gov/founding-docs/declaration-transcript) | public domain; US government work |
| The Constitution of the United States | https://www.gutenberg.org/ebooks/5 | public domain |
| The Federalist Papers | https://www.gutenberg.org/ebooks/1404 | public domain |
| The Law (Frederic Bastiat) | https://www.gutenberg.org/ebooks/44800 | public domain |
| On Liberty (John Stuart Mill) | https://www.gutenberg.org/ebooks/34901 | public domain |
| Civil Disobedience (Henry David Thoreau) | https://www.gutenberg.org/ebooks/71 | public domain |
| Narrative of the Life of Frederick Douglass | https://www.gutenberg.org/ebooks/23 | public domain |
| The Jungle (Upton Sinclair) | https://www.gutenberg.org/ebooks/140 | public domain (US) |
| I, Pencil (Leonard E. Read), as hosted by Econlib | https://www.econlib.org/library/Essays/rdPncl1.html | freely published by FEE and Econlib; see the page for terms |
| Economics in One Lesson (Henry Hazlitt), as hosted by FEE | https://fee.org/ebooks/economics-in-one-lesson/ | free ebook published by FEE; see the page for terms |
| Where There Is No Dentist, contents page (Hesperian Health Guides) | https://en.hesperian.org/hhg/Where_There_Is_No_Dentist | free for non-commercial use; do not redistribute |

**Asked for but not retrieved, and why.** The Mises Institute page for *Economics in One Lesson* answered 403 to an automated request, so it was not worked around (FEE hosts the same book). Hesperian's *Where There Is No Doctor*, *Water for Life* and *Sanitation and Cleanliness* have no page at the addresses tried, so only the Dentist contents page was saved; their free PDFs are on hesperian.org. The Hillsdale 1776 curriculum, Ashbrook's *Teaching American History* and the Bill of Rights Institute curricula are large sets of pages and downloads behind site navigation, and were not collected. *Flowers and Their Friends* could not be matched to a Gutenberg id.

**Not used, on purpose.**
- The JavaScript book list at https://github.com/EOEboh/Free-Software-Books/blob/main/books/dev-books/JavaScript/javascript.md links mostly to Google Drive and pdfdrive copies of commercial books (for example Flanagan's *JavaScript: The Definitive Guide*). Those copies are not licensed for download, so none was taken. The titles on it that have an official free edition (Eloquent JavaScript and The JavaScript Language) were taken from their official repositories instead.
- *You Don't Know JS* (Kyle Simpson, https://github.com/getify/You-Dont-Know-JS) is CC BY-NC-ND 4.0. The no-derivatives term does not allow cutting it into shelves that are then shared, so it is left out.
- Not-for-sharing licences (NonCommercial, ShareAlike) mean that if you hand out a shelf made from these sources, you must keep the credit above, keep the same licence for share-alike sources, and keep non-commercial sources out of anything sold.

## 6. Data in this repository

- The 111 creature species in `neon/evelyn_chums_data.js` are generated from the author's own character database (`tools/gen_chums.js`); they are original and not taken from any source above.
- The starter facts, rooms and lessons in the three editions were written in the conversation the code came from. No third-party dataset file is embedded (the country and periodic-table datasets that appeared in that conversation are not part of Evelyn).
- The BASIC keyword list in `tools/bas_keywords.json` is a plain list of language keywords used to check names.

## 7. Not in this repository, and why

Real game ROMs and discs, learner profiles, model weight files (`TINY.BIN`), downloaded books and shelves, build output, test scratch files and the private design notes are ignored by `.gitignore`.
