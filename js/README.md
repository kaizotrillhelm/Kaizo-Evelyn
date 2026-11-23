# Evelyn, JavaScript edition

The reference edition. Plain ES5 with typed arrays; no packages, no build step.

```powershell
node evelyn_cli.js [--bin TINY.BIN] [--lib book.txt] [--data folder]   # terminal; profile and library kept in ./evelyn_data
start index.html                                                       # browser; kept in localStorage
node test\test_evelyn.js                                               # 48 unit tests
```

In a page, load `evelyn_core.js` and use the global `Evelyn`. In Node, `require("./evelyn_core.js")`.

| Name | What it is |
| --- | --- |
| `Evelyn.LZCodec`, `Evelyn.LibraryStore` | compression, base64, the library (`addEntry`, `search`, `ingestPlainText`, `toText`, `fromText`) |
| `Evelyn.Tiny2Model` | `loadFromArrayBuffer`, `step`, `think(text, creativity)`, `prime`, `exportKVCache`, `importKVCache` |
| `EvelynStream` (`evelyn_stream.js`) | layer streaming: `Tiny2StreamModel` (`loadFromBuffer`, `loadFromAsyncShards`, `think`, `thinkAsync`, `layerAt`), `buildSovereignManifest`, `splitTny2Shards`, `OffsetShelfStore`, `crc32`. Inspired by AirLLM; see the top-level README |
| `Evelyn.ProfileManager` | learner profile; `toCfg` and `fromCfg` read and write `USER.CFG` |
| `Evelyn.CodeSandbox`, `Evelyn.AdventureEngine`, `Evelyn.SwarmTutor` | coding lab, adventure, tutor |
| `Evelyn.MultiShelfLibrary`, `Evelyn.DeliberationSwarm` | several shelves with the number checker |
| `Evelyn.EvelynNet`, `Evelyn.quantizedQKDot` | packets for slow links, integer dot product |
| `Evelyn.Storage` | localStorage in a browser, memory otherwise; `useDirectory(folder)` keeps keys as files under Node |
| `Evelyn.AudioDriver` | browser speech, with a square-wave fallback; `chirpPlan(text)` lists the notes |

`evelyn_proto.js` is the driver used by `tests/run_conformance.js`; run `node evelyn_proto.js script.txt` to see one result line per command.
