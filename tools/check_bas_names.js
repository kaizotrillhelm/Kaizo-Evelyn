/* check_bas_names.js - lists identifiers in the BASIC sources that are BASIC / FreeBASIC keywords
   (BASIC ignores case, so a name like iF is the keyword IF and sIn is SIN).
   node tools/check_bas_names.js */
"use strict";
var fs = require("fs"), path = require("path");
var KW = {};
JSON.parse(fs.readFileSync(path.join(__dirname, "bas_keywords.json"), "utf8")).forEach(function (k) { KW[k] = true; });
var bad = 0, dir = path.join(__dirname, "..", "basic");
fs.readdirSync(dir).filter(function (f) { return /\.(bi|bas)$/.test(f); }).forEach(function (f) {
  fs.readFileSync(path.join(dir, f), "latin1").split(/\r?\n/).forEach(function (line, i) {
    line = line.replace(/"[^"]*"/g, '""').replace(/'.*$/, "");
    var seen = {};
    (line.match(/[A-Za-z][A-Za-z0-9_]*/g) || []).forEach(function (w) {
      var u = w.toUpperCase();
      /* a keyword written in capitals is the keyword; a lower-case start means it is meant as a name */
      if (KW[u] && w !== u && /^[a-z]/.test(w) && !seen[w]) { seen[w] = 1; console.log(f + ":" + (i + 1) + "  " + w + "  is the keyword " + u); bad++; }
    });
  });
});
console.log(bad ? bad + " name(s) collide with a keyword" : "no identifier collides with a keyword");
process.exit(bad ? 1 : 0);
