/* evelyn_bookgames_tests.js - tests for EvelynBookGames (a game from a book, by genre, by the learner's own words, or from their archive).
   Run in Node.js: node evelyn_bookgames_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_cartridges.js");
    require("./evelyn_bookgames.js");
  }
  var BG = root.EvelynBookGames, B = root.EvelynBackend, C = root.EvelynCartridges;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }

  /* An original story written for these tests (not from any published book). */
  var STORY = [
    "The Lantern Fox of Pebble Bay",
    "Mira lived in the white house beside the lighthouse. Every evening she climbed the long stairs to polish the great lamp. The lamp shone across the water and guided the fishing boats home.",
    "One morning Mira found a small orange fox asleep under the lamp. The fox had a tail like a flame and a collar made of silver wire. \"Who are you?\" asked Mira. \"I am the lantern fox,\" said the fox. \"I keep the light warm when the wind is cold.\"",
    "Tobin was the baker in the village below the hill. Each day Tobin carried warm bread up the path to the lighthouse. \"Your lamp is brighter than ever,\" said Tobin. \"The fox helps me,\" replied Mira.",
    "The village council did not believe in lantern foxes. The council members said that a lamp needs oil and a wick and nothing more. They sent Tobin to look for tricks.",
    "Tobin climbed the stairs and counted every step. There were ninety stairs, and at the top the fox was curled up beside the glass. \"This is no trick,\" said Tobin. \"I see a friend who loves the light.\"",
    "The bay was quiet that night until a storm rolled in from the sea. The wind pushed the waves against the rocks, and the lamp flickered. Mira held the lamp steady while the fox kept the flame warm.",
    "The fishing boats found the harbor by the shining lamp. Every sailor reached the pier safely before midnight. The pirate in the old story would have said he wanted to kill the fox, but nobody in Pebble Bay said such things.",
    "At 18:30 the boats left for the evening fishing and the council bell rang. The mannequin in the shop window never moved while the harbor lamp burned brightly. The bakery sold three hundred loaves that week.",
    "In the morning the council came to the lighthouse with their notebooks. \"We were wrong,\" said the oldest member. \"A lighthouse needs a keeper and a lantern fox.\" Mira smiled and Tobin passed around the bread.",
    "From then on the village kept a small lamp in every window. The lamps reminded everyone of the lantern fox and the night of the storm. Children learned to polish glass, to carry bread, and to share light.",
    "Mira grew up and became the keeper of the great lamp. Tobin baked bread for forty years and taught his grandchildren the lantern song. The fox slept every winter beside the warm glass and woke in the spring."
  ].join("\n\n");

  test("analyzeBook: finds the characters, the dialogue speakers, the key words and a grade band", function (done) {
    var A = BG.analyzeBook(STORY, { title: "The Lantern Fox of Pebble Bay" });
    var names = A.characters.map(function (c) { return c.name; });
    assert(names.indexOf("Mira") >= 0 && names.indexOf("Tobin") >= 0, "Mira and Tobin must be found, got " + names.join(","));
    assert(names.indexOf("The") < 0 && names.indexOf("Every") < 0, "Common capitalised words must not be names");
    assert(A.sentences.length >= 30, "Expected 30+ sentences, got " + A.sentences.length);
    var sp = {}; A.quotes.forEach(function (q) { sp[q.speaker] = (sp[q.speaker] || 0) + 1; });
    assert(sp.Tobin >= 2 && sp.Mira >= 1, "Quotes must be attributed: " + JSON.stringify(sp));
    A.quotes.forEach(function (q) { assert(STORY.indexOf(q.quote) >= 0, "A quote must exist in the book: " + q.quote); });
    assert(/^(K-2|3-5|6-8|9-12)$/.test(A.grade), "Grade band " + A.grade);
    var termList = A.terms.map(function (t) { return t.term; });
    assert(termList.indexOf("lantern") >= 0 || termList.indexOf("lighthouse") >= 0, "Key words should include lantern or lighthouse");
    done();
  });

  test("makeGame: every style and focus gives a cartridge that the real validator accepts", function (done) {
    var combos = [["arcade", "both"], ["detective", "characters"], ["detective", "concepts"], ["quiz", "both"], ["arcade", "concepts"], ["quiz", "characters"]];
    combos.forEach(function (c) {
      var r = BG.makeGame(STORY, { title: "The Lantern Fox of Pebble Bay", style: c[0], focus: c[1], count: 8, seed: 3 });
      assert(r.ok, c.join("/") + " failed: " + (r.errors || []).join("; "));
      var v = C.CartridgeValidator.validate(r.cart);
      assert(v.ok, c.join("/") + " fails the validator: " + v.errors.join("; "));
      assert(r.cart.items.length >= 3, c.join("/") + " made " + r.cart.items.length + " items");
      assert(r.cart.engine === (c[0] === "arcade" ? "shooter" : "detective"), "Engine for " + c[0] + " was " + r.cart.engine);
      assert(r.cart.echoLine.length <= 128, "echoLine too long");
      r.cart.items.forEach(function (it) {
        assert(it.id && it.q && it.ans && it.failRule && it.shelf, "Item is missing a field: " + JSON.stringify(it));
        assert(it.wrong.length >= 1 && it.wrong.indexOf(it.ans) < 0, "Wrong answers must differ from the answer");
        var uniq = {}; it.wrong.concat([it.ans]).forEach(function (x) { uniq[x] = 1; });
        assertEq(Object.keys(uniq).length, it.wrong.length + 1, "Options must be distinct for " + it.id);
      });
    });
    done();
  });

  test("makeGame: each right answer is true to the book (quotes and sentences are really in it)", function (done) {
    var r = BG.makeGame(STORY, { title: "The Lantern Fox of Pebble Bay", focus: "both", count: 24, seed: 11 });
    assert(r.ok, "makeGame failed");
    var flat = STORY.replace(/\s+/g, " ");
    var checked = 0;
    r.cart.items.forEach(function (it) {
      if (/^Who said:/.test(it.q)) {
        var q = /Who said: "(.*)"$/.exec(it.q)[1];
        assert(flat.indexOf(q) >= 0, "Quoted line not in the book: " + q);
        var near = flat.slice(Math.max(0, flat.indexOf(q) - 50), flat.indexOf(q) + q.length + 50);
        assert(near.indexOf(it.ans) >= 0, "Speaker " + it.ans + " is not near the line");
        checked++;
      } else if (/^Fill the gap:/.test(it.q)) {
        var gap = it.q.replace("Fill the gap: ", ""), parts = gap.split("_____");
        assert(flat.indexOf((parts[0] + it.ans + parts[1]).trim()) >= 0 || flat.toLowerCase().indexOf((parts[0] + it.ans + parts[1]).trim().toLowerCase()) >= 0, "Filled sentence is not in the book: " + gap);
        checked++;
      } else if (/^Which sentence from the book mentions/.test(it.q)) {
        assert(flat.indexOf(it.ans) >= 0, "Answer sentence not in the book");
        checked++;
      } else if (/^Which of these comes first/.test(it.q)) {
        var ia = flat.indexOf(it.ans), ib = flat.indexOf(it.wrong[0]), ic = flat.indexOf(it.wrong[1]);
        assert(ia >= 0 && ia < ib && ia < ic, "The first sentence must come first in the book");
        checked++;
      } else if (/^Who is it\?/.test(it.q)) {
        assert(flat.indexOf(it.ans) >= 0, "Name must be in the book");
        checked++;
      }
    });
    assert(checked >= 8, "Too few items could be checked: " + checked);
    done();
  });

  test("makeGame: the same seed gives the same game, another seed gives another", function (done) {
    var a = BG.makeGame(STORY, { title: "Fox", seed: 5, count: 10 }), b = BG.makeGame(STORY, { title: "Fox", seed: 5, count: 10 }), c = BG.makeGame(STORY, { title: "Fox", seed: 6, count: 10 });
    assertEq(JSON.stringify(a.cart), JSON.stringify(b.cart), "Same seed must repeat");
    assert(JSON.stringify(a.cart.items) !== JSON.stringify(c.cart.items), "A new seed should change the questions");
    done();
  });

  test("Safety: violent words, 24-hour clocks and banned canon words never reach a game", function (done) {
    for (var seed = 1; seed <= 12; seed++) {
      var r = BG.makeGame(STORY, { title: "Fox", seed: seed, count: 30, focus: "both" });
      assert(r.ok, "seed " + seed + " failed");
      var all = JSON.stringify(r.cart);
      assert(!/\bkill/i.test(all), "A violent sentence got through (seed " + seed + ")");
      assert(!/18:30/.test(all) && !/mannequin/i.test(all), "A canon-rule sentence got through (seed " + seed + ")");
    }
    done();
  });

  test("parseWish: a learner's own words choose the style and the focus", function (done) {
    var w1 = BG.parseWish("I want a space battle about the characters");
    assertEq(w1.style, "arcade", "space battle"); assertEq(w1.focus, "characters", "characters");
    var w2 = BG.parseWish("a mystery about the words and ideas");
    assertEq(w2.style, "detective", "mystery"); assertEq(w2.focus, "concepts", "words");
    var w3 = BG.parseWish("quiz show please");
    assertEq(w3.style, "quiz", "quiz"); assertEq(w3.focus, "both", "default focus");
    var r = BG.makeGame(STORY, { title: "The Lantern Fox of Pebble Bay", wish: "space battle with the characters", seed: 2 });
    assert(r.ok && r.cart.engine === "shooter" && r.cart.bookGame.focus === "characters", "The wish must shape the cartridge");
    assert(/space battle/i.test(r.cart.title), "The learner's own words should appear in the title: " + r.cart.title);
    done();
  });

  test("Archive: a book already on a shelf can be turned into a game; too little text is refused kindly", function (done) {
    /* a private library: the real one is shared with the other suites on a browser page and must not be touched */
    var lib = Object.create(B.ShelfLibrary); lib.rows = []; lib.postings = Object.create(null); lib.lru = { get: function () { return null; }, set: function () {} };
    var sents = STORY.replace(/\n\n/g, " ").match(/[^.!?]+[.!?]["]?/g) || [], i, n = 0;
    for (i = 0; i < sents.length; i++) { var s = sents[i].replace(/\s+/g, " ").trim(); if (s.length >= 30 && s.length <= 175) { lib.add("lanternfox", s.split(" ").slice(0, 3).join(" "), s, ""); n++; } }
    var lst = BG.listShelves(lib);
    assertEq(lst.length, 1, "One shelf expected"); assertEq(lst[0].shelf, "lanternfox", "Shelf name");
    var book = BG.fromShelf(lib, "lanternfox");
    assert(book.text.length > 800, "Shelf text should be rebuilt (" + book.text.length + ")");
    var r = BG.makeGame(book.text, { title: "Lantern Fox", shelf: "lanternfox", seed: 4, count: 6 });
    assert(r.ok, "Game from shelf failed: " + (r.errors || []).join("; "));
    assert(r.cart.items[0].shelf.indexOf("lanternfox#") === 0, "Items should point back at the shelf");
    var tiny = BG.makeGame("Too short. Only two sentences here.", { title: "x" });
    assert(!tiny.ok && tiny.errors[0].indexOf("too short") >= 0, "Short text must be refused with a reason");
    done();
  });

  test("Real books (when present on this machine): Alice, Aesop, Potter and the Federalist Papers all make valid games", function (done) {
    if (!isNode) return done();
    var fs = require("fs"), dir = "G:/CandorPix/EvelynLibrary/_raw/reading/", names = ["alice-in-wonderland", "aesop-fables", "potter-14838", "federalist-papers", "princess-and-the-goblin"], seen = 0;
    names.forEach(function (n) {
      if (!fs.existsSync(dir + n + ".txt")) return;
      seen++;
      var txt = fs.readFileSync(dir + n + ".txt", "utf8").replace(/^Title:.*\nSource:.*\nLicence:.*\n/, "");
      ["both", "characters", "concepts"].forEach(function (f) {
        var r = BG.makeGame(txt, { title: n, focus: f, seed: 9, count: 10 });
        assert(r.ok, n + "/" + f + ": " + (r.errors || []).join("; "));
        assert(C.CartridgeValidator.validate(r.cart).ok, n + "/" + f + " fails the validator");
      });
    });
    console.log("       (real books checked: " + seen + " of " + names.length + ")");
    done();
  });

  test("Evelyn's own shelf loader (the +TXT Shelf path) takes the converted reading shelves and answers questions from them", function (done) {
    if (!isNode) return done();
    var fs = require("fs"), dir = "G:/CandorPix/EvelynLibrary/shelves/", asked = 0;
    var cases = [["reading-alice-in-wonderland-01.txt", "alice", "white rabbit watch pocket"], ["reading-mill-on-liberty-01.txt", "liberty", "individual liberty of action"], ["reading-us-constitution-01.txt", "constitution", "legislative powers Congress Senate"]];
    cases.forEach(function (c) {
      if (!fs.existsSync(dir + c[0])) return;
      var lib = Object.create(B.ShelfLibrary); lib.rows = []; lib.postings = Object.create(null); lib.lru = { get: function () { return null; }, set: function () {} };
      lib.persist = function () {};                       /* do not write the shared archive from a test */
      var n = lib.ingestPlainText(fs.readFileSync(dir + c[0], "utf8"), c[1]);
      assert(n > 50, c[0] + ": the loader took only " + n + " entries");
      var hits = lib.search(c[2], 3);
      assert(hits.length >= 1 && hits[0].fact.length > 30, c[0] + ": no answer for \"" + c[2] + "\"");
      asked++;
    });
    console.log("       (reading shelves loaded and searched through Evelyn's loader: " + asked + " of " + cases.length + ")");
    done();
  });

  test("ES5 Audit: the module and its tests use no ES6 syntax", function (done) {
    if (!isNode) return done();
    var fs = require("fs"), path = require("path");
    var files = ["evelyn_bookgames.js", "evelyn_bookgames_tests.js"];
    var banned = [[/\bArray\.from\s*\(/, "Array.from"], [/\bnew\s+Map\s*\(/, "Map"], [/\bnew\s+Set\s*\(/, "Set"], [new RegExp("[\\w$)]\\s*=" + ">"), "arrow"], [/\(\?</, "lookbehind"], [/(^|[;{}]\s*)(let|const)\s+[A-Za-z_$][\w$]*\s*[=;,]/m, "let/const"]];
    files.forEach(function (f) {
      var src = fs.readFileSync(path.join(__dirname, f), "utf8");
      banned.forEach(function (b) { assert(!b[0].test(src), f + " failed ES5 guard: " + b[1]); });
    });
    done();
  });

  var pass = 0, fail = 0, idx = 0;
  function next() {
    if (idx >= tests.length) {
      console.log("\n=== BOOK GAMES RESULT: " + pass + " passed, " + fail + " failed ===");
      if (isNode) process.exit(fail > 0 ? 1 : 0);
      return;
    }
    var cur = tests[idx++], ended = false;
    function done(err) {
      if (ended) return; ended = true;
      if (err) { fail++; console.log("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
      else { pass++; console.log("[PASS] " + cur.name); }
      setTimeout(next, 0);
    }
    try { cur.fn(done); } catch (e) { done(e); }
  }
  console.log("=== EVELYN BOOK GAMES TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
