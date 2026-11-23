/* evelyn_cli.js - Evelyn in a terminal.
   node evelyn_cli.js [--bin TINY.BIN] [--lib book.txt] [--data folder]
   Commands: /mode R|A|D|M  /adv  /code <lines separated by ;>  /shelf  /profile  /quit
   Anything else is a question. Profile and library are kept in the data folder (default ./evelyn_data).

   A language model on this machine (optional; nothing here starts one, and nothing is sent anywhere else):
     --llm <url>            the server, such as http://127.0.0.1:1234 (LM Studio) or http://127.0.0.1:8080 (llama-server)
     --llm-preset <name>    llama.cpp | lmstudio | ollama (sets url, model and backend; --llm and --llm-model override)
     --llm-model <id>       the model id the server lists
     --backend <name>       inkling | qwen | nemotron | muse (how effort is sent; default from the preset)
     --effort <value>       low | medium | high | a number such as 0.3 (default: the agent chooses, the code loop uses its schedule)
     --no-notes             do not give the library to the model as notes
     --no-skills            do not retrieve skills for code tasks
     --skill <SKILL.md>     add a skill file (repeatable)
     --pack <manifest.json> --tier potato|standard|workstation   load the tutor .bin of a model pack (see README)
   Commands: /llm (test the connection)  /agent <question>  /write <task>  /bins (what the pack resolves to) */
"use strict";
var fs = require("fs");
var readline = require("readline");
var E = require("./evelyn_core.js");

var args = process.argv.slice(2), dataDir = "evelyn_data", binFile = null, libFiles = [];
var llmOpts = { notes: true, skills: true, skillMarkdown: [] }, wantLlm = false, packFile = null, tier = "standard", backendName = null;
for (var i = 0; i < args.length; i++) {
  if (args[i] === "--bin" && args[i + 1]) binFile = args[++i];
  else if (args[i] === "--lib" && args[i + 1]) libFiles.push(args[++i]);
  else if (args[i] === "--data" && args[i + 1]) dataDir = args[++i];
  else if (args[i] === "--llm" && args[i + 1]) { llmOpts.url = args[++i]; wantLlm = true; }
  else if (args[i] === "--llm-preset" && args[i + 1]) { llmOpts.preset = args[++i]; wantLlm = true; }
  else if (args[i] === "--llm-model" && args[i + 1]) { llmOpts.model = args[++i]; wantLlm = true; }
  else if (args[i] === "--backend" && args[i + 1]) { llmOpts.backend = backendName = args[++i]; wantLlm = true; }
  else if (args[i] === "--effort" && args[i + 1]) { var ev = args[++i]; llmOpts.effort = isNaN(Number(ev)) ? ev : Number(ev); wantLlm = true; }
  else if (args[i] === "--no-notes") llmOpts.notes = false;
  else if (args[i] === "--no-skills") llmOpts.skills = false;
  else if (args[i] === "--skill" && args[i + 1]) llmOpts.skillMarkdown.push(fs.readFileSync(args[++i], "utf8"));
  else if (args[i] === "--pack" && args[i + 1]) packFile = args[++i];
  else if (args[i] === "--tier" && args[i + 1]) tier = args[++i];
}
E.Storage.useDirectory(dataDir);

var lib = new E.LibraryStore();
if (!lib.load()) { lib.loadStarterPack(); lib.save(); }
var pm = new E.ProfileManager();
pm.load();
var model = new E.Tiny2Model();
if (binFile) {
  var b = fs.readFileSync(binFile);
  console.log("Loaded TNY2:", JSON.stringify(model.loadFromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))));
}
var registry = null;
if (packFile) {
  var Reg = require("./evelyn_registry.js");
  var packDir = require("path").dirname(require("path").resolve(packFile));
  registry = new Reg.BinRegistry({ tier: tier, baseDir: packDir });
  registry.loadManifest(JSON.parse(fs.readFileSync(packFile, "utf8")));
  if (!binFile) {
    var tut = registry.getModel("tutor", backendName || "*");
    if (tut) { model = tut.model; console.log("Pack: tutor '" + tut.meta.id + "' loaded for tier " + tier); }
    else console.log("Pack: no tutor .bin for tier " + tier + " (the built-in library answers)");
  }
}
libFiles.forEach(function (f) { console.log("Imported chunks from " + f + ":", lib.ingestPlainText(fs.readFileSync(f, "utf8"), f)); });

var tutor = new E.SwarmTutor(lib, pm, model);
var llm = null;
if (wantLlm) {
  var LLM = require("./evelyn_llm.js");
  llmOpts.lib = lib; llmOpts.pm = pm;
  llm = LLM.create(llmOpts);
  console.log("Language model: " + llm.url + " | model " + llm.model + " | backend " + llm.backend + " | notes " + (llm.notes ? "on" : "off") + " | skills " + (llm.skills ? "on" : "off") + "  (/llm tests it)");
}
var adv = new E.AdventureEngine(pm, lib);
var inAdv = false;
console.log("EVELYN (JavaScript) | learner: " + pm.profile.name + " | mode " + pm.profile.mode + " | xp " + pm.profile.xp + " | library entries: " + lib.stats().entries);
console.log("Commands: /mode R|A|D|M  /adv  /code <lines separated by ;>  /profile  /quit  or ask a question");

var rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.prompt();
var queue = [], busy = false, closing = false;
function prompt() { if (!closing) rl.prompt(); }
function pump() {
  if (busy) return;
  if (!queue.length) { if (closing) { pm.save(); process.exit(0); } return; }
  busy = true;
  handle(queue.shift(), function () { busy = false; pump(); });
}
rl.on("line", function (line) { queue.push(line); pump(); });
function handle(line, finish) {
  var s = line.trim();
  if (s === "/quit") { queue.length = 0; rl.close(); finish(); return; }
  if (s.indexOf("/mode ") === 0) console.log("Mode ->", pm.setMode(s.slice(6)));
  else if (s === "/adv") { inAdv = !inAdv; console.log(inAdv ? adv.look() : "Back to the tutor."); }
  else if (s === "/profile") console.log(pm.toCfg());
  else if (s === "/llm" || s.indexOf("/agent ") === 0 || s.indexOf("/write ") === 0 || s === "/bins") {
    if (s === "/bins") {
      if (!registry) console.log("No pack loaded (start with --pack manifest.json --tier standard).");
      else ["tutor", "expander", "router", "critic"].forEach(function (role) { var e = registry.resolve(role, backendName || "*"); console.log(role + ": " + (e ? e.id + " (" + e.file + ", from tier " + (e.minTier || "potato") + ")" : "none; the fallback is used")); });
    } else if (!llm) console.log("No language model set. Start with --llm http://127.0.0.1:1234 (or --llm-preset lmstudio|llama.cpp|ollama).");
    else {
      var back = function () { prompt(); finish(); };
      if (s === "/llm") llm.test(function (err, r) {
        console.log(err ? "Not reachable: " + err.message : "Reachable: " + r.url + " lists " + r.models.length + " model(s)" + (r.hasModel ? "; '" + llm.model + "' is one of them" : "; '" + llm.model + "' is NOT in the list (use --llm-model <id>). First: " + r.models.slice(0, 5).join(", ")));
        back();
      });
      else if (s.indexOf("/agent ") === 0) llm.ask(s.slice(7), function (err, r) {
        console.log(err ? "Error: " + err.message : r.answer + "\n[" + r.path + (r.verified ? ", checked" : ", not checked") + "]");
        back();
      });
      else llm.write(s.slice(7), function (err, r) {
        if (err) console.log("Error: " + err.message);
        else console.log((r.code || "(no code came back)") + "\n[" + (r.ok ? "the checker passed it" : "the checker did NOT pass it: " + ((r.history[r.history.length - 1] || {}).errors || []).join("; ")) + " | " + r.calls + " call(s)" + (r.activeSkills.length ? " | skills: " + r.activeSkills.join(", ") : "") + " | run it in a sandbox before you trust it]");
        back();
      });
      return;
    }
  }
  else if (s.indexOf("/code ") === 0) {
    var r = E.CodeSandbox.run(s.slice(6).replace(/;/g, "\n"));
    console.log(r.ok ? r.output.join("\n") + "\n" + r.grid : "Error: " + r.error);
  }
  else if (inAdv) console.log(adv.command(s));
  else if (s) { var res = tutor.ask(s); console.log(res.text + "\n[" + res.source + "]"); }
  prompt();
  finish();
}
rl.on("close", function () { closing = true; if (!busy) pump(); });
