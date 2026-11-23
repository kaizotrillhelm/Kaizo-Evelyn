/* basic_tasks.js - four small JavaScript tasks and three grounded questions, each with a checker, plus a shelf of notes.
   Used by evelyn_skills_bench.js. The notes were written by the same hand as the checks, so the notes columns show what
   retrieval can do when the right note exists, not an unbiased accuracy. Plain ES5. */
"use strict";
var path = require("path");
var cp = require("child_process");
var WORKER = path.join(__dirname, "basic_verify_worker.js");

var CONTRACT =
  "Reply with ONE fenced js code block that defines the function described. No imports, no DOM, no console output; " +
  "the function returns its result. Task: ";

var TASKS = {
  sumEven: {
    fn: "sumEven", keepInput: true,
    text: CONTRACT + "function sumEven(numbers) returns the sum of the even numbers of an array of integers (0 for none).",
    cases: [[[[1, 2, 3, 4]], 6], [[[]], 0], [[[7, 9]], 0], [[[-2, 5, 10]], 8], [[[0, 0, 6]], 6]]
  },
  wordFreq: {
    fn: "wordFreq", keepInput: true,
    text: CONTRACT + "function wordFreq(text) returns a plain object that maps each word of the text, lower case, to how many times it occurs. " +
      "A word is a run of letters and apostrophes; every other character separates words.",
    cases: [[["The cat. The dog!"], { the: 2, cat: 1, dog: 1 }], [[""], {}], [["Don't stop, don't."], { "don't": 2, stop: 1 }], [["A a A"], { a: 3 }]]
  },
  balanced: {
    fn: "isBalanced", keepInput: true,
    text: CONTRACT + "function isBalanced(s) returns true when every bracket of ()[]{} in the string is closed by the right kind in the right order; other characters are ignored.",
    cases: [[["([]{})"], true], [["(]"], false], [[""], true], [["a(b[c]d)e"], true], [["(("], false], [["())"], false], [["{[}]"], false]]
  },
  mergeIntervals: {
    fn: "mergeIntervals", keepInput: true,
    text: CONTRACT + "function mergeIntervals(list) takes an array of [start, end] pairs in any order and returns a new array of the merged intervals sorted by start; " +
      "intervals that overlap or touch (next start <= current end) are merged. The input array must not be changed.",
    cases: [[[[[8, 10], [1, 3], [2, 6]]], [[1, 6], [8, 10]]], [[[]], []], [[[[1, 4], [4, 5]]], [[1, 5]]], [[[[5, 7], [1, 2]]], [[1, 2], [5, 7]]], [[[[1, 10], [2, 3]]], [[1, 10]]]]
  }
};

var NOTES = [
  { shelf: "js", topic: "Sum with reduce", fullText: "Array.prototype.reduce((total, x) => total + x, 0) sums an array; the second argument is the start value and makes an empty array give 0. The remainder of a negative number is negative in JavaScript: -2 % 2 is -0 and -3 % 2 is -1, so test evenness with x % 2 === 0 (-0 === 0 is true) and never with x % 2 === 1." },
  { shelf: "js", topic: "Counting words with a regular expression", fullText: "text.toLowerCase().match(/[a-z']+/g) returns an array of the words, or null when there is none, so write (text.toLowerCase().match(/[a-z']+/g) || []). Count with a plain object: counts[w] = (counts[w] || 0) + 1. Use Object.create(null) or hasOwnProperty so that a word such as constructor is an ordinary key." },
  { shelf: "js", topic: "Balanced brackets with a stack", fullText: "Keep an array as a stack. For each character: an opener (, [ or { is pushed; a closer is matched against the top with a map such as { ')': '(', ']': '[', '}': '{' }; if the stack is empty or the top is a different opener the answer is false. Characters that are not brackets are skipped. At the end the answer is stack.length === 0." },
  { shelf: "js", topic: "Merging intervals without changing the input", fullText: "Copy before sorting: list.slice().sort((a, b) => a[0] - b[0]) because sort changes the array in place. Walk the sorted copy with a result array; if the next start is <= the last end, set the last end to Math.max(last end, next end), else push a copy [start, end] so that no pair of the input is shared with the result. An empty list gives []." },
  { shelf: "js", topic: "Function and fenced code block", fullText: "Define the function with the exact name and parameter order of the task and return the result; do not print it. The answer is one fenced code block holding only the function and any helpers it needs." }
];

/* three questions whose answers exist only on the shelf (an invented place), so a model cannot know them */
var QA_NOTES = [
  { shelf: "lore", topic: "Brindlewick harbour tower bells", fullText: "The harbour tower of Brindlewick has 17 bells. They were cast in 1884 and the largest is called Old Marrow." },
  { shelf: "lore", topic: "Brindlewick salt vault key", fullText: "The key to the Brindlewick salt vault is kept by Odalys Fenn, the harbour clerk, in a tin box under the ledger desk." },
  { shelf: "lore", topic: "Brindlewick ferry house", fullText: "The doors of the Brindlewick ferry house are painted saffron yellow and are repainted every spring before the first crossing." }
];
var QA = {
  bells: { text: "How many bells does the harbour tower of Brindlewick have? Answer in one sentence.", any: ["17", "seventeen"] },
  vault: { text: "Who keeps the key to the Brindlewick salt vault? Answer in one sentence.", any: ["odalys fenn"] },
  doors: { text: "What colour are the doors of the Brindlewick ferry house? Answer in one sentence.", any: ["saffron"] }
};

function verifyCode(task, code) {
  var t = TASKS[task];
  var r = cp.spawnSync(process.execPath, [
    "--permission", "--allow-fs-read=" + WORKER, WORKER, t.fn, JSON.stringify(t.cases), t.keepInput ? "1" : "0"
  ], { input: code, encoding: "utf8", timeout: 15000 });
  if (r.error) return { ok: false, errors: ["verifier could not run: " + r.error.message] };
  var line = (r.stdout || "").trim().split("\n").pop();
  try { return JSON.parse(line); } catch (e) { return { ok: false, errors: ["verifier gave no result: " + String((r.stderr || r.stdout || "").slice(0, 200))] }; }
}

function checkAnswer(id, text) {
  var low = String(text || "").toLowerCase(), any = QA[id].any, i;
  for (i = 0; i < any.length; i++) if (low.indexOf(any[i]) >= 0) return { ok: true, errors: [] };
  return { ok: false, errors: ["the answer does not contain " + any.join(" or ")] };
}

module.exports = { TASKS: TASKS, NOTES: NOTES, QA: QA, QA_NOTES: QA_NOTES, verifyCode: verifyCode, checkAnswer: checkAnswer };
