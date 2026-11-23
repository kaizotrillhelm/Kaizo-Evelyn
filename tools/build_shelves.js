/* build_shelves.js - turns the downloaded coding references into Evelyn text shelves.
   node tools/build_shelves.js /g/CandorPix/EvelynLibrary
   Reads   <lib>/_raw/<source>/...   (made by tools/fetch_coding_refs.sh)
   Writes  <lib>/shelves/<source>-NN.txt  (load with "+TXT Shelf") and <lib>/shelves/MANIFEST.json
   Evelyn keeps the first 180 characters of each paragraph, so every entry is a short, self-contained line
   that starts with its heading. Entries are never invented: each is a cut of the source text. */
var fs = require("fs"), path = require("path"), cp = require("child_process");
var lib = path.resolve(process.argv[2] || "./library"), raw = path.join(lib, "_raw"), outDir = path.join(lib, "shelves");
fs.mkdirSync(outDir, { recursive: true });
var MAX = 178, PER_FILE = 4000;

var SOURCES = [
  { id: "learnxinyminutes", dir: "learnxinyminutes", ext: /\.md$/, skip: /(README|CONTRIBUTING)\.md$|\/(ru|de|fr|es|pt|zh|ja|ko|it|tr|vi|nl|pl|id|uk|cs|ar|he|hu|th|fa|bn|el|ro|bg|ca|fi|sv|da|no|sk|sl|hr|sr|lt|lv|et)\//i, name: "Learn X in Y Minutes", url: "https://github.com/adambard/learnxinyminutes-docs", licence: "CC BY-SA 3.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0/" },
  { id: "mdn-javascript", dir: "mdn-javascript/files/en-us/web/javascript", ext: /\.md$/, name: "MDN Web Docs: JavaScript", url: "https://github.com/mdn/content", licence: "CC BY-SA 2.5 (prose), CC0 (code examples)", licenceUrl: "https://creativecommons.org/licenses/by-sa/2.5/" },
  { id: "eloquent-javascript", dir: "eloquent-javascript", ext: /^\d\d_.*\.md$/, flat: true, name: "Eloquent JavaScript (Marijn Haverbeke)", url: "https://github.com/marijnh/Eloquent-JavaScript", licence: "CC BY-NC 3.0", licenceUrl: "https://creativecommons.org/licenses/by-nc/3.0/" },
  { id: "javascript-info", dir: "javascript-info/1-js", ext: /\.md$/, name: "The JavaScript Language (javascript.info, Ilya Kantor)", url: "https://github.com/javascript-tutorial/en.javascript.info", licence: "CC BY-NC 4.0-based; read the repository's LICENSE.md before sharing", licenceUrl: "https://creativecommons.org/licenses/by-nc/4.0/" },
  { id: "node-api", dir: "node-api/doc/api", ext: /\.md$/, name: "Node.js API documentation", url: "https://github.com/nodejs/node", licence: "MIT", licenceUrl: "https://github.com/nodejs/node/blob/main/LICENSE" },
  { id: "rust-book", dir: "rust-book/src", ext: /\.md$/, name: "The Rust Programming Language", url: "https://github.com/rust-lang/book", licence: "MIT or Apache-2.0", licenceUrl: "https://github.com/rust-lang/book#license" },
  { id: "python-docs", dir: "python-docs", ext: /\.txt$/, skip: /(^|\/)(whatsnew|bugs|about|license|copyright|c-api|extending|distributing|installing|using)\//, name: "Python 3.13 documentation", url: "https://docs.python.org/3.13/download.html", licence: "PSF licence; code examples Zero-Clause BSD", licenceUrl: "https://docs.python.org/3.13/license.html" },
  { id: "sicp", dir: "sicp/html", ext: /\.xhtml$|\.html$/, html: true, name: "Structure and Interpretation of Computer Programs (HTML edition)", url: "https://github.com/sarabander/sicp", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  { id: "think-python-2e", dir: "think-python-2e/book", ext: /\.tex$/, tex: true, name: "Think Python 2e (Allen Downey)", url: "https://github.com/AllenDowney/ThinkPython2", licence: "repository MIT; the book's own licence is in its front matter", licenceUrl: "https://github.com/AllenDowney/ThinkPython2/blob/master/LICENSE" }
];

function walk(d, acc) {
  var list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return acc; }
  list.forEach(function (e) {
    var p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== ".git") walk(p, acc); } else acc.push(p);
  });
  return acc;
}

function cleanInline(s) {
  return s
    .replace(/\{\{\s*[A-Za-z]+\(\s*["']([^"']+)["'][^)]*\)\s*\}\}/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\{%[^%]*%\}/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"")
    .replace(/[`*]{1,3}/g, "")
    .replace(/(^|\s)_{1,3}([^_\s][^_]*?)_{1,3}(?=$|[\s.,;:!?)])/g, "$1$2")
    .replace(/\s+/g, " ").trim();
}
function nonAscii(s) { return s.replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7e]/g, ""); }

/* one entry = "Heading: text", cut at sentence ends to fit */
function emit(out, heading, text) {
  text = nonAscii(text).trim();
  if (text.length < 28) return;
  var alpha = (text.match(/[A-Za-z]/g) || []).length;
  if (alpha / text.length < 0.5) return;
  var h = nonAscii(heading || "").slice(0, 40).trim();
  var room = MAX - (h ? h.length + 2 : 0);
  var rest = text, first = true;
  while (rest.length > 0) {
    var piece = rest;
    if (piece.length > room) {
      var cut = piece.lastIndexOf(". ", room - 1);
      if (cut < 40) cut = piece.lastIndexOf(" ", room - 1);
      if (cut < 20) cut = room;
      piece = piece.slice(0, cut + 1).trim();
    }
    if (piece.length >= 28) out.push((h ? h + ": " : "") + piece);
    rest = rest.slice(piece.length).trim();
    if (!first && out.length % 7 === 0) break;   /* a long paragraph gives at most a few entries */
    first = false;
    if (rest.length < 28) break;
  }
}

function fromMarkdown(src, out) {
  src = src.replace(/\r/g, "");
  src = src.replace(/^---\n[\s\S]*?\n---\n/, "");
  var lines = src.split("\n"), heading = "", para = [], code = null, i;
  function flush() { if (para.length) { emit(out, heading, cleanInline(para.join(" "))); para = []; } }
  for (i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      if (code === null) { flush(); code = []; }
      else { var c = code.join(" ").replace(/\s+/g, " ").trim(); if (c.length >= 12 && c.length <= 130) emit(out, heading, "Example: " + c); code = null; }
      continue;
    }
    if (code !== null) { code.push(l.trim()); continue; }
    var h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { flush(); heading = cleanInline(h[2]); continue; }
    if (/^\s*$/.test(l)) { flush(); continue; }
    if (/^\s*\|?[-: |]+\|?\s*$/.test(l)) continue;
    if (/^\s*(<|\{%|\{\{|!\[)/.test(l) && !/^\s*\{\{/.test(l)) { continue; }
    para.push(l.replace(/^\s*([-*+]|\d+\.)\s+/, ""));
  }
  flush();
}
function fromHtml(src, out) {
  src = src.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi, "\n\n# $1\n\n").replace(/<\/p>|<br\s*\/?>/gi, "\n\n");
  fromMarkdown(src.replace(/<[^>]+>/g, " "), out);
}
function fromTex(src, out) {
  src = src.replace(/%.*$/gm, "").replace(/\\(chapter|section|subsection)\*?\{([^}]*)\}/g, "\n\n# $2\n\n").replace(/\\begin\{(verbatim|lstlisting|code)\}[\s\S]*?\\end\{\1\}/g, "\n\n")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?\{([^}]*)\}/g, "$2").replace(/\\[a-zA-Z]+\*?/g, " ").replace(/[{}$~]/g, " ");
  fromMarkdown(src, out);
}
function fromRst(src, out) {  /* the Python text docs: underlined headings */
  var lines = src.replace(/\r/g, "").split("\n"), md = [], i;
  for (i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && /^[=\-*#~^]{3,}\s*$/.test(lines[i + 1]) && lines[i].trim() && !/^[=\-*#~^]+$/.test(lines[i].trim())) { md.push("## " + lines[i].trim()); i++; }
    else if (/^[=\-*#~^]{3,}\s*$/.test(lines[i])) continue; else md.push(lines[i]);
  }
  fromMarkdown(md.join("\n"), out);
}

var manifest = { made: new Date().toISOString().slice(0, 10), note: "Cuts of the sources' own text, 178 characters at most each, ASCII only. Licences below; keep the notices when you share a shelf.", shelves: [] };
SOURCES.forEach(function (S) {
  var base = path.join(raw, S.dir), files = walk(base, []).filter(function (f) {
    var rel = path.relative(base, f).replace(/\\/g, "/");
    return S.ext.test(S.flat ? path.basename(f) : f) && !(S.skip && S.skip.test("/" + rel));
  }).sort();
  var out = [], seen = Object.create(null);
  files.forEach(function (f) {
    var txt = fs.readFileSync(f, "utf8"), before = out.length, tmp = [];
    try {
      if (S.html) fromHtml(txt, tmp); else if (S.tex) fromTex(txt, tmp); else if (S.id === "python-docs") fromRst(txt, tmp); else fromMarkdown(txt, tmp);
    } catch (e) { return; }
    tmp.forEach(function (e) { var k = e.toLowerCase().slice(0, 90); if (!seen[k]) { seen[k] = 1; out.push(e); } });
  });
  var commit = "";
  try { commit = cp.execFileSync("git", ["-C", path.join(raw, S.id.replace("python-docs", "python-docs")), "rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch (e) { commit = S.id === "python-docs" ? "python-3.13-docs-text.zip" : ""; }
  var n = 0, part = 0;
  while (n < out.length) {
    part++;
    var chunk = out.slice(n, n + PER_FILE), fname = S.id + "-" + (part < 10 ? "0" : "") + part + ".txt";
    fs.writeFileSync(path.join(outDir, fname), chunk.join("\n\n") + "\n");
    manifest.shelves.push({ file: fname, source: S.name, url: S.url, licence: S.licence, licenceUrl: S.licenceUrl, version: commit, entries: chunk.length });
    n += PER_FILE;
  }
  console.log(S.id + ": " + files.length + " files -> " + out.length + " entries in " + part + " shelf file(s)");
});
var TITLES = { "aesop-fables": "Aesop's Fables", "alice-in-wonderland": "Alice's Adventures in Wonderland", "federalist-papers": "The Federalist Papers", "us-constitution": "The Constitution of the United States", "douglass-narrative": "Narrative of the Life of Frederick Douglass", "potter-14304": "Beatrix Potter (Gutenberg 14304)", "potter-14814": "Beatrix Potter (Gutenberg 14814)", "potter-14407": "The Tale of Benjamin Bunny", "potter-14838": "The Tale of Peter Rabbit", "bastiat-the-law": "The Law (Frederic Bastiat)", "mill-on-liberty": "On Liberty (John Stuart Mill)", "sinclair-the-jungle": "The Jungle (Upton Sinclair)", "thoreau-civil-disobedience": "Civil Disobedience (Henry David Thoreau)", "declaration-of-independence": "The Declaration of Independence" };
/* the reading library: <lib>/_raw/reading/*.txt (made by tools/fetch_reading_refs.py), one shelf set per book */
(function () {
  var dir = path.join(raw, "reading"), files;
  try { files = fs.readdirSync(dir).filter(function (f) { return /\.txt$/.test(f); }).sort(); } catch (e) { return; }
  files.forEach(function (f) {
    var txt = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r/g, ""), m = /^Title: (.*)\nSource: (.*)\nLicence: (.*)\n/.exec(txt);
    if (!m) return;
    var title = m[1].trim(), body = txt.slice(m[0].length);
    if (!title) {
      var cand = body.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 5 && /[A-Z]{3}/.test(l) && !/ILLUSTRATION|FREDERICK|WARNE|BY$/i.test(l); });
      title = cand.slice(0, 2).join(" ").slice(0, 60);
    }
    if (TITLES[f.replace(/.txt$/, "")]) title = TITLES[f.replace(/.txt$/, "")];
    var out = [], seen = Object.create(null), tmp = [];
    fromMarkdown("# " + title.replace(/^#+\s*/, "") + "\n\n" + body, tmp);
    tmp.forEach(function (e) { var k = e.toLowerCase().slice(0, 90); if (!seen[k]) { seen[k] = 1; out.push(e); } });
    var n = 0, part = 0, id = "reading-" + f.replace(/\.txt$/, "");
    while (n < out.length) {
      part++;
      var chunk = out.slice(n, n + PER_FILE), fname = id + "-" + (part < 10 ? "0" : "") + part + ".txt";
      fs.writeFileSync(path.join(outDir, fname), chunk.join("\n\n") + "\n");
      manifest.shelves.push({ file: fname, source: title, url: m[2], licence: m[3], licenceUrl: "", version: "", entries: chunk.length });
      n += PER_FILE;
    }
    console.log(id + ": \"" + title + "\" -> " + out.length + " entries");
  });
})();
fs.writeFileSync(path.join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 1));
console.log("shelf files: " + manifest.shelves.length);
