/* test_qbi.js - checks the BASIC interpreter (qbi.js) itself: the semantics Evelyn relies on, and the mistakes it must catch.
   node tests/test_qbi.js */
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "qbi-"));
var passed = 0, failed = 0, failures = [];

function run(src, opts) {
  opts = opts || {};
  var f = path.join(dir, "t.bas");
  fs.writeFileSync(f, src);
  var args = [path.join(__dirname, "qbi.js"), f];
  if (opts.cmd) args.push("--cmd", opts.cmd);
  if (opts.stdin) { fs.writeFileSync(path.join(dir, "in.txt"), opts.stdin); args.push("--stdin", path.join(dir, "in.txt")); }
  var r = cp.spawnSync(process.execPath, args, { cwd: dir, encoding: "latin1" });
  return { out: r.stdout.replace(/\r/g, ""), err: r.stderr, status: r.status };
}
function ok(name, src, expected, opts) {
  var r = run(src, opts);
  if (r.status === 0 && r.out === expected) passed++;
  else { failed++; failures.push(name + ": expected " + JSON.stringify(expected) + " got " + JSON.stringify(r.out) + " " + r.err.trim()); }
}
function fails(name, src, pattern) {
  var r = run(src);
  if (r.status !== 0 && pattern.test(r.err)) passed++;
  else { failed++; failures.push(name + ": expected an error matching " + pattern + " got status " + r.status + " out " + JSON.stringify(r.out) + " err " + r.err.trim()); }
}

/* ---------- things that must work ---------- */
ok("print strings", 'PRINT "a" + "b"\nPRINT "x";\nPRINT "y"\n', "ab\nxy\n");
ok("print numbers use a sign column", "PRINT 5\nPRINT -5\n", " 5 \n-5 \n");
ok("integer arithmetic", "DIM i AS INTEGER\ni = 7\nPRINT LTRIM$(STR$(i * 6)); LTRIM$(STR$(i \\ 2)); LTRIM$(STR$(i MOD 4))\n", "4233\n");
ok("division is floating point", "DIM d AS DOUBLE\nd = 7 / 2\nPRINT LTRIM$(STR$(d))\n", "3.5\n");
ok("single rounds to 32 bit", "DIM s AS SINGLE\ns = 0.1#\nPRINT LTRIM$(STR$(s = 0.1#))\n", "0\n");
ok("double keeps 64 bit", "DIM d AS DOUBLE\nd = 0.1#\nPRINT LTRIM$(STR$(d = 0.1#))\n", "-1\n");
ok("CINT rounds half to even", "PRINT LTRIM$(STR$(CINT(2.5#))); LTRIM$(STR$(CINT(3.5#))); LTRIM$(STR$(CINT(-2.5#)))\n", "24-2\n");
ok("INT floors and FIX truncates", "PRINT LTRIM$(STR$(INT(-2.5#))); LTRIM$(STR$(FIX(-2.5#)))\n", "-3-2\n");
ok("string functions", 'PRINT LEFT$("hello", 2); RIGHT$("hello", 2); MID$("hello", 2, 3); STRING$(3, "x"); UCASE$("aB"); CHR$(65); LTRIM$(STR$(ASC("A"))); LTRIM$(STR$(INSTR("hello", "ll")))\n', "heloellxxxABA653\n");
ok("INSTR with a start", 'PRINT LTRIM$(STR$(INSTR(3, "abcabc", "b")))\n', "5\n");
ok("string comparison", 'PRINT LTRIM$(STR$("a" < "b")); LTRIM$(STR$("b" = "b")); LTRIM$(STR$("b" <> "b"))\n', "-1-10\n");
ok("AND OR NOT are bitwise on -1 and 0", "PRINT LTRIM$(STR$((1 = 1) AND (2 = 3))); LTRIM$(STR$((1 = 1) OR (2 = 3))); LTRIM$(STR$(NOT (1 = 2)))\n", "0-1-1\n");
ok("loops", "DIM i AS INTEGER, t AS INTEGER\nFOR i = 1 TO 5\nt = t + i\nNEXT i\nDO WHILE t < 100\nt = t * 2\nLOOP\nPRINT LTRIM$(STR$(t))\n", "120\n");
ok("FOR with STEP and EXIT FOR", "DIM i AS INTEGER\nFOR i = 10 TO 1 STEP -3\nPRINT LTRIM$(STR$(i));\nIF i < 5 THEN EXIT FOR\nNEXT i\nPRINT\n", "1074\n");
ok("DO UNTIL and LOOP UNTIL", "DIM i AS INTEGER\nDO UNTIL i >= 3\ni = i + 1\nLOOP\nDO\ni = i + 1\nLOOP UNTIL i > 5\nPRINT LTRIM$(STR$(i))\n", "6\n");
ok("single line IF with ELSE and colon", 'DIM a AS INTEGER, b AS INTEGER\nIF 1 = 2 THEN a = 1: b = 1 ELSE a = 5\nPRINT LTRIM$(STR$(a)); LTRIM$(STR$(b))\n', "50\n");
ok("block IF ELSEIF ELSE", 'DIM i AS INTEGER\nFOR i = 1 TO 3\nIF i = 1 THEN\nPRINT "a";\nELSEIF i = 2 THEN\nPRINT "b";\nELSE\nPRINT "c";\nEND IF\nNEXT i\nPRINT\n', "abc\n");
ok("functions with recursion", "FUNCTION Fact% (n AS INTEGER)\nIF n <= 1 THEN\nFact% = 1\nELSE\nFact% = n * Fact%(n - 1)\nEND IF\nEND FUNCTION\nPRINT LTRIM$(STR$(Fact%(5)))\n", "120\n");
ok("by reference scalars", "SUB Bump (x AS INTEGER)\nx = x + 1\nEND SUB\nDIM v AS INTEGER\nv = 4\nCALL Bump(v)\nBump v\nPRINT LTRIM$(STR$(v))\n", "6\n");
ok("array elements by reference", "SUB Bump (x AS INTEGER)\nx = x + 1\nEND SUB\nDIM a(3) AS INTEGER\nCALL Bump(a(2))\nPRINT LTRIM$(STR$(a(2)))\n", "1\n");
ok("expressions are passed by value", "SUB Bump (x AS INTEGER)\nx = x + 1\nEND SUB\nDIM v AS INTEGER\nv = 4\nCALL Bump(v + 0)\nPRINT LTRIM$(STR$(v))\n", "4\n");
ok("array parameters and UBOUND", "FUNCTION Sum% (a() AS INTEGER)\nDIM i AS INTEGER, t AS INTEGER\nFOR i = 0 TO UBOUND(a)\nt = t + a(i)\nNEXT i\nSum% = t\nEND FUNCTION\nDIM b(3) AS INTEGER\nb(0) = 1: b(1) = 2: b(2) = 3: b(3) = 4\nPRINT LTRIM$(STR$(Sum%(b())))\n", "10\n");
ok("two dimensional arrays", "DIM g(2, 3) AS INTEGER\ng(1, 2) = 7\ng(2, 3) = 9\nPRINT LTRIM$(STR$(g(1, 2) + g(2, 3)))\n", "16\n");
ok("shared variables and CONST", "CONST K = 6\nDIM SHARED n AS INTEGER\nSUB Add\nn = n + K\nEND SUB\nAdd\nAdd\nPRINT LTRIM$(STR$(n))\n", "12\n");
ok("locals start at zero and empty", "FUNCTION F$ ()\nDIM i AS INTEGER, s AS STRING\nF$ = LTRIM$(STR$(i)) + \"[\" + s + \"]\"\nEND FUNCTION\nPRINT F$()\n", "0[]\n");
ok("SWAP", "DIM a AS INTEGER, b AS INTEGER\na = 1: b = 2\nSWAP a, b\nPRINT LTRIM$(STR$(a)); LTRIM$(STR$(b))\n", "21\n");
ok("#IFDEF skips code", "#IFDEF __FB_DOS__\nPRINT \"dos\"\n#ELSE\nPRINT \"other\"\n#ENDIF\n", "other\n");
ok("COMMAND$", "PRINT COMMAND$\n", "hello there\n", { cmd: "hello there" });
ok("LINE INPUT from stdin", 'DIM s AS STRING\nLINE INPUT s\nPRINT "[" + s + "]"\n', "[one two]\n", { stdin: "one two\nnext\n" });
ok("text file round trip", 'DIM f AS INTEGER, s AS STRING\nf = FREEFILE\nOPEN "x.txt" FOR OUTPUT AS #f\nPRINT #f, "line1"\nPRINT #f, "line2";\nPRINT #f, "!"\nCLOSE #f\nOPEN "x.txt" FOR INPUT AS #f\nDO WHILE NOT EOF(f)\nLINE INPUT #f, s\nPRINT s\nLOOP\nCLOSE #f\n', "line1\nline2!\n");
ok("binary GET of bytes", 'DIM f AS INTEGER, b AS STRING * 1\nf = FREEFILE\nOPEN "b.bin" FOR OUTPUT AS #f\nPRINT #f, "A";\nCLOSE #f\nOPEN "b.bin" FOR BINARY AS #f\nGET #f, , b\nPRINT LTRIM$(STR$(LOF(f))); " "; LTRIM$(STR$(ASC(b)))\nCLOSE #f\n', "1 65\n");
ok("OPEN BINARY creates a missing file and KILL removes it", 'DIM f AS INTEGER\nf = FREEFILE\nOPEN "new.bin" FOR BINARY AS #f\nPRINT LTRIM$(STR$(LOF(f)));\nCLOSE #f\nKILL "new.bin"\nPRINT "ok"\n', "0ok\n");

/* ---------- things that must be refused ---------- */
fails("undeclared variable", "x = 1\n", /not declared/);
fails("INTEGER overflow on assignment", "DIM i AS INTEGER\ni = 32767\ni = i + 1\n", /Overflow/);
fails("INTEGER overflow in a product", "DIM a AS INTEGER, b AS INTEGER\nDIM l AS LONG\na = 300\nb = 300\nl = a * b\n", /Overflow/);
fails("LONG product is fine, INTEGER times CLNG is not an overflow", "DIM a AS INTEGER, l AS LONG\na = 300\nl = CLNG(a) * a * a\nPRINT LTRIM$(STR$(l))\nl = 2147483647\nl = l + 1\n", /Overflow/);
fails("string into a number", 'DIM i AS INTEGER\ni = "a"\n', /Type mismatch/);
fails("number into a string", "DIM s AS STRING\ns = 5\n", /Type mismatch/);
fails("float literal without suffix", "DIM d AS DOUBLE\nd = 0.5\n", /needs a # or !/);
fails("array index out of range", "DIM a(3) AS INTEGER\na(4) = 1\n", /Subscript out of range/);
fails("division by zero", "DIM i AS INTEGER, j AS INTEGER\ni = 1\nj = i \\ 0\n", /Division by zero/);
fails("ASC of an empty string", 'DIM i AS INTEGER\ni = ASC("")\n', /ASC of an empty string/);
fails("MID$ start below 1", 'DIM s AS STRING\ns = MID$("abc", 0, 1)\n', /MID\$/);
fails("by-reference type mismatch", "SUB Bump (x AS INTEGER)\nx = x + 1\nEND SUB\nDIM v AS LONG\nCALL Bump(v)\n", /Parameter type mismatch/);
fails("a variable named like a keyword", "DIM iF AS INTEGER\n", /./);
fails("wrong argument count", "SUB Bump (x AS INTEGER)\nx = x + 1\nEND SUB\nCALL Bump(1, 2)\n", /Argument count/);
fails("reading past the end of a file", 'DIM f AS INTEGER, s AS STRING\nf = FREEFILE\nOPEN "e.txt" FOR OUTPUT AS #f\nCLOSE #f\nOPEN "e.txt" FOR INPUT AS #f\nLINE INPUT #f, s\n', /Input past end/);
fails("opening a missing file for INPUT", 'DIM f AS INTEGER\nf = FREEFILE\nOPEN "nothing.txt" FOR INPUT AS #f\n', /File not found/);
fails("DIM twice", "DIM a AS INTEGER\nDIM a AS INTEGER\n", /Duplicate/);

fs.rmSync(dir, { recursive: true, force: true });
console.log("qbi: " + passed + " passed, " + failed + " failed");
failures.forEach(function (f) { console.log("  FAIL " + f); });
process.exit(failed ? 1 : 0);
