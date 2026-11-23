/* evelyn_cli.js - Evelyn in a terminal.
   node evelyn_cli.js [--bin TINY.BIN] [--lib book.txt] [--data folder]
   Commands: /mode R|A|D|M  /adv  /code <lines separated by ;>  /shelf  /profile  /quit
   Anything else is a question. Profile and library are kept in the data folder (default ./evelyn_data). */
"use strict";
var fs = require("fs");
var readline = require("readline");
var E = require("./evelyn_core.js");

var args = process.argv.slice(2), dataDir = "evelyn_data", binFile = null, libFiles = [];
for (var i = 0; i < args.length; i++) {
  if (args[i] === "--bin" && args[i + 1]) binFile = args[++i];
  else if (args[i] === "--lib" && args[i + 1]) libFiles.push(args[++i]);
  else if (args[i] === "--data" && args[i + 1]) dataDir = args[++i];
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
libFiles.forEach(function (f) { console.log("Imported chunks from " + f + ":", lib.ingestPlainText(fs.readFileSync(f, "utf8"), f)); });

var tutor = new E.SwarmTutor(lib, pm, model);
var adv = new E.AdventureEngine(pm, lib);
var inAdv = false;
console.log("EVELYN (JavaScript) | learner: " + pm.profile.name + " | mode " + pm.profile.mode + " | xp " + pm.profile.xp + " | library entries: " + lib.stats().entries);
console.log("Commands: /mode R|A|D|M  /adv  /code <lines separated by ;>  /profile  /quit  or ask a question");

var rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.prompt();
rl.on("line", function (line) {
  var s = line.trim();
  if (s === "/quit") { rl.close(); return; }
  if (s.indexOf("/mode ") === 0) console.log("Mode ->", pm.setMode(s.slice(6)));
  else if (s === "/adv") { inAdv = !inAdv; console.log(inAdv ? adv.look() : "Back to the tutor."); }
  else if (s === "/profile") console.log(pm.toCfg());
  else if (s.indexOf("/code ") === 0) {
    var r = E.CodeSandbox.run(s.slice(6).replace(/;/g, "\n"));
    console.log(r.ok ? r.output.join("\n") + "\n" + r.grid : "Error: " + r.error);
  }
  else if (inAdv) console.log(adv.command(s));
  else if (s) { var res = tutor.ask(s); console.log(res.text + "\n[" + res.source + "]"); }
  rl.prompt();
});
rl.on("close", function () { pm.save(); process.exit(0); });
