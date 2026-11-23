/* evelyn_bookgames.js - turns a book a learner has read into a game (pure ES5, no network, no model).
   The book is plain text: a file the learner picks, a shelf already in their archive, or something typed in.
   The game is an ordinary .cart.json for the concourse player, checked by the real CartridgeValidator before it is returned.
     EvelynBookGames.analyzeBook(text, opts)      -> { title, characters, terms, quotes, sentences, grade, ... }
     EvelynBookGames.makeGame(textOrAnalysis, o)  -> { ok, cart, report, errors }
         o = { title, style: "arcade"|"detective"|"quiz"|"auto", focus: "characters"|"concepts"|"both",
               wish: "free words from the learner", count: 12, seed: 7, safe: true, shelf: "name" }
     EvelynBookGames.parseWish(words)             -> { style, focus, theme } (a learner's own words choose the game)
     EvelynBookGames.fromShelf(shelfLibrary, name), listShelves(shelfLibrary)   (the learner's archive)
   Every question is cut from the book itself: nothing is invented, and each right answer is checked against the text. */
(function (root) {
  "use strict";

  /* ---------- small helpers ---------- */
  function rngFor(seed) {                       /* mulberry32: the same seed always gives the same game */
    var a = (Number(seed) || 1) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul ? Math.imul(t ^ (t >>> 15), t | 1) : ((t ^ (t >>> 15)) * (t | 1)) >>> 0;
      t ^= t + (Math.imul ? Math.imul(t ^ (t >>> 7), t | 61) : ((t ^ (t >>> 7)) * (t | 61)) >>> 0);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    var a = arr.slice(0), i, j, t;
    for (i = a.length - 1; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pick(arr, n, rnd) { return shuffle(arr, rnd).slice(0, n); }
  function slug(s) { return String(s || "book").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14) || "book"; }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 3).replace(/\s+\S*$/, "") + "..." : s; }

  var STOP = {};
  ("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let like me more most my myself no nor not now of off on once only or other our ours ourselves out over own said same she should so some such than that the their theirs them themselves then there these they this those through to too under until up upon very was we were what when where which while who whom why will with would you your yours yourself yourselves one two three came come went go going got get made make much many must shall thing things little never always still even ever every away back well say says told asked replied cried then than yet however though although whose whether another around without between through nothing something anything everything together presently suppose rather perhaps indeed against toward towards beyond within thus therefore hence whereas").split(" ").forEach(function (w) { STOP[w] = 1; });
  var NOT_NAMES = {};
  ("The A An And But Or So If When Then There They This That These Those It Its He She We You I His Her Their Our My Your What Who Why How Where Which While As At In On Of To For With By From Not No Yes Oh Ah Well Now Here Come Let Do Does Did Is Are Was Were Be Been Have Has Had Will Would Could Should Shall May Might Must Can One Two Three Chapter Mr Mrs Miss Dr St Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Project Gutenberg Illustration Contents Preface Introduction Volume Book Part Section Article Amendment").split(" ").forEach(function (w) { NOT_NAMES[w] = 1; });
  var ABBR = { "Mr": 1, "Mrs": 1, "Ms": 1, "Dr": 1, "St": 1, "Mt": 1, "Jr": 1, "Sr": 1, "vs": 1, "etc": 1, "No": 1, "Col": 1, "Gen": 1, "Capt": 1, "Rev": 1, "Hon": 1 };

  /* Kid-safe filter (on by default): a sentence with one of these words is never used. */
  var UNSAFE = /\b(kill|killed|killing|murder|murdered|blood|bloody|dead|death|die|died|dying|corpse|suicide|rape|raped|naked|sex|sexual|drunk|drunkard|whisk(e)?y|brandy|gin|beer|wine|opium|cocaine|shoot(ing)?|gun|pistol|knife|stab|stabbed|torture|slave|slaves|slavery|whip|whipped|lash(es|ed)?|hell|damn|devil|curse|cursed)\b/i;
  /* The cartridge validator's own canon rules: a sentence that would fail them is dropped before it gets that far. */
  var CANON_BAD = /\b(?:1[3-9]|2[0-3]):[0-5]\d\b|\b0\d:[0-5]\d\b|mannequin|winter games|olympic|DritchLyssa|Static Choir Hound/i;

  /* ---------- text preparation ---------- */
  function cleanText(text) {
    var t = String(text || "").replace(/\r/g, "");
    var s = /\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n/.exec(t), e = /\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG/.exec(t);
    if (s && e && e.index > s.index) t = t.slice(s.index + s[0].length, e.index);
    t = t.replace(/\[Illustration[^\]]*\]/gi, " ").replace(/\u2018|\u2019/g, "'").replace(/\u201c|\u201d/g, "\"").replace(/\u2014|\u2013/g, "-").replace(/_([^_\n]{1,60})_/g, "$1");
    return t;
  }
  function splitParagraphs(t) {
    var raw = t.split(/\n\s*\n/), out = [], i, p;
    for (i = 0; i < raw.length; i++) {
      p = raw[i].replace(/\s+/g, " ").trim();
      if (p.length >= 30) out.push(p);
    }
    return out;
  }
  function splitSentences(par) {          /* no look-behind: scan for . ! ? followed by space and a capital or quote */
    var out = [], start = 0, i, ch, next, word, m;
    for (i = 0; i < par.length - 1; i++) {
      ch = par.charAt(i);
      if (ch !== "." && ch !== "!" && ch !== "?") continue;
      j2: {
        var j = i + 1;
        while (j < par.length && (par.charAt(j) === "\"" || par.charAt(j) === "'" || par.charAt(j) === ")")) j++;
        if (par.charAt(j) !== " ") break j2;
        next = par.charAt(j + 1);
        if (!/[A-Z"']/.test(next)) break j2;
        m = /([A-Za-z]+)$/.exec(par.slice(Math.max(0, i - 6), i)); word = m ? m[1] : "";
        if (ch === "." && ABBR[word]) break j2;
        if (ch === "." && /(^|\s)[A-Z]$/.test(par.slice(Math.max(0, i - 2), i + 1))) break j2;
        out.push(par.slice(start, j).trim()); start = j + 1; i = j;
      }
    }
    if (start < par.length) out.push(par.slice(start).trim());
    return out;
  }
  function syllables(w) {
    w = w.toLowerCase().replace(/[^a-z]/g, "");
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    var m = w.match(/[aeiouy]{1,2}/g);
    return m ? m.length : 1;
  }
  function gradeBand(words, sentences, syl) {
    if (!words || !sentences) return { fk: 0, band: "3-5" };
    var fk = 0.39 * (words / sentences) + 11.8 * (syl / words) - 15.59;
    return { fk: Math.round(fk * 10) / 10, band: fk <= 2.5 ? "K-2" : fk <= 5.5 ? "3-5" : fk <= 8.5 ? "6-8" : "9-12" };
  }

  /* ---------- analysis ---------- */
  function analyzeBook(text, opts) {
    opts = opts || {};
    var t = cleanText(text), pars = splitParagraphs(t), sents = [], i, k, s;
    var capAnyMid = {}, capMid = {}, capAll = {}, lowAll = {}, words = 0, syl = 0, wc = {};
    for (i = 0; i < pars.length; i++) {
      var ss = splitSentences(pars[i]);
      for (k = 0; k < ss.length; k++) {
        s = ss[k];
        if (s.length < 20) continue;
        sents.push({ text: s, par: i, pos: sents.length });
        var toks = s.match(/[A-Za-z][A-Za-z'-]*/g) || [], a;
        for (a = 0; a < toks.length; a++) {
          var w = toks[a], lw = w.toLowerCase().replace(/'s$/, "");
          words++; syl += syllables(w);
          if (a > 0 && /^[A-Z]/.test(w) && !/[.!?"]$/.test(toks[a - 1])) capAnyMid[lw] = (capAnyMid[lw] || 0) + 1;
          if (/^[A-Z][a-z]{2,}$/.test(w)) { capAll[w] = (capAll[w] || 0) + 1; if (a > 0 && !/[.!?"]$/.test(toks[a - 1])) capMid[w] = (capMid[w] || 0) + 1; }
          else if (/^[a-z]{3,}$/.test(w)) lowAll[w] = (lowAll[w] || 0) + 1;
          if (lw.length >= 5 && !STOP[lw] && /^[a-z]+$/.test(lw)) wc[lw] = (wc[lw] || 0) + 1;
        }
      }
    }
    var names = [], n;
    for (n in capMid) {
      if (NOT_NAMES[n] || capMid[n] < 3) continue;
      var low = lowAll[n.toLowerCase()] || 0;
      if (low > capMid[n] * 0.35) continue;                 /* "Rabbit" with many "rabbit" is a noun, not a name */
      names.push({ name: n, count: capAll[n] });
    }
    names.sort(function (a, b) { return b.count - a.count; });
    names = names.slice(0, 10);
    var isName = {}; for (i = 0; i < names.length; i++) isName[names[i].name.toLowerCase()] = 1;
    var terms = [], tw;
    for (tw in wc) {
      if (wc[tw] < 3 || isName[tw] || UNSAFE.test(tw)) continue;
      var capForm = tw.charAt(0).toUpperCase() + tw.slice(1);
      if ((capMid[capForm] || 0) > (lowAll[tw] || 0) || (capAnyMid[tw] || 0) > (lowAll[tw] || 0)) continue;       /* a proper noun (Flopsy, McGregor) is not a "word to learn" */
      terms.push({ term: tw, count: wc[tw] });
    }
    terms.sort(function (a, b) { return b.count - a.count; });
    terms = terms.slice(0, 60);

    /* dialogue: a quoted line plus a speaking verb next to a known name */
    var quotes = [], VERBS = "said|asked|cried|replied|whispered|answered|shouted|exclaimed|called|laughed|sighed|added|thought|declared|muttered|begged";
    var nameRe = names.length ? "(" + names.map(function (x) { return x.name; }).join("|") + ")" : "";
    if (nameRe) {
      var after = new RegExp("^[\"']?,? ?(?:" + VERBS + ") " + nameRe + "\\b|^[\"']?,? ?" + nameRe + " (?:" + VERBS + ")\\b");
      var before = new RegExp(nameRe + " (?:" + VERBS + ")[^\"]{0,20}[:,] ?$");
      for (i = 0; i < pars.length; i++) {
        var p = pars[i], re = /"([^"]{14,150})"/g, m;
        while ((m = re.exec(p))) {
          var q = m[1].trim(), tail = p.slice(m.index + m[0].length, m.index + m[0].length + 40), head = p.slice(Math.max(0, m.index - 45), m.index);
          var a1 = after.exec(tail), b1 = before.exec(head), sp = a1 ? (a1[1] || a1[2]) : (b1 ? b1[1] : null);
          if (sp && /[a-z]/.test(q) && q.split(" ").length >= 3) quotes.push({ quote: q, speaker: sp, par: i });
        }
      }
    }
    var gb = gradeBand(words, sents.length, syl);
    return { title: opts.title || "", paragraphs: pars, sentences: sents, characters: names, terms: terms, quotes: quotes, words: words, grade: gb.band, fk: gb.fk };
  }

  /* ---------- question makers (each returns { q, ans, wrong[], rule, par } or null) ---------- */
  function okSentence(s, min, max, safe) {
    if (s.length < min || s.length > max) return false;
    if (CANON_BAD.test(s)) return false;
    if (safe && UNSAFE.test(s)) return false;
    if (/^\W*(chapter|contents|illustration|copyright|\*)/i.test(s)) return false;
    if (!/[.!?]["']?$/.test(s)) return false;                           /* headings and fragments have no full stop */
    var ws = s.split(" "), caps = 0, i;
    for (i = 0; i < ws.length; i++) if (/^[A-Z]/.test(ws[i])) caps++;
    if (ws.length > 4 && caps / ws.length > 0.6) return false;           /* Title Case lines are headings */
    return (s.match(/[A-Za-z]/g) || []).length / s.length > 0.7;
  }
  function blank(sentence, word) {
    var re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"), hits = sentence.match(new RegExp(re.source, "gi")) || [];
    if (hits.length !== 1) return null;
    return sentence.replace(re, "_____");
  }
  function mkCloze(A, rnd, safe, used) {           /* concepts: the missing word */
    var cands = shuffle(A.sentences, rnd), i, tries = 0;
    for (i = 0; i < cands.length && tries < 400; i++, tries++) {
      var s = cands[i];
      if (used[s.pos] || !okSentence(s.text, 45, 130, safe)) continue;
      var tm, order = shuffle(A.terms.slice(0, 30), rnd), j;
      for (j = 0; j < order.length; j++) {
        tm = order[j].term;
        var b = blank(s.text, tm);
        if (!b) continue;
        var same = A.terms.filter(function (x) { return x.term !== tm && Math.abs(x.term.length - tm.length) <= 3; });
        if (same.length < 3) same = A.terms.filter(function (x) { return x.term !== tm; });
        if (same.length < 3) return null;
        used[s.pos] = 1;
        return { q: "Fill the gap: " + b, ans: tm, wrong: pick(same, 3, rnd).map(function (x) { return x.term; }), rule: "The book says: \"" + clip(s.text, 150) + "\"", par: s.par };
      }
    }
    return null;
  }
  function mkWhoIs(A, rnd, safe, used) {           /* characters: which name goes in the gap */
    if (A.characters.length < 3) return null;
    var cands = shuffle(A.sentences, rnd), i, j;
    for (i = 0; i < cands.length; i++) {
      var s = cands[i];
      if (used[s.pos] || !okSentence(s.text, 35, 120, safe)) continue;
      for (j = 0; j < A.characters.length; j++) {
        var nm = A.characters[j].name, b = blank(s.text, nm);
        if (!b) continue;
        var others = A.characters.filter(function (x) { return x.name !== nm; }).map(function (x) { return x.name; });
        used[s.pos] = 1;
        return { q: "Who is it? " + b, ans: nm, wrong: pick(others, Math.min(3, others.length), rnd), rule: "In the book: \"" + clip(s.text, 150) + "\"", par: s.par };
      }
    }
    return null;
  }
  function mkWhoSaid(A, rnd, safe, used) {         /* characters: who said this line */
    var cands = shuffle(A.quotes, rnd), i;
    for (i = 0; i < cands.length; i++) {
      var q = cands[i], key = "q" + q.par + q.quote.slice(0, 20);
      if (used[key] || !okSentence(q.quote, 14, 140, safe)) continue;
      var others = A.characters.filter(function (x) { return x.name !== q.speaker; }).map(function (x) { return x.name; });
      if (others.length < 2) return null;
      used[key] = 1;
      return { q: "Who said: \"" + q.quote + "\"", ans: q.speaker, wrong: pick(others, Math.min(3, others.length), rnd), rule: q.speaker + " says this line in the book.", par: q.par };
    }
    return null;
  }
  function mkMatch(A, rnd, safe, used) {           /* concepts: which sentence is about the word */
    var terms = shuffle(A.terms.slice(0, 25), rnd), i, j;
    for (i = 0; i < terms.length; i++) {
      var tm = terms[i].term, re = new RegExp("\\b" + tm + "\\b", "i");
      var withT = A.sentences.filter(function (s) { return !used[s.pos] && re.test(s.text) && okSentence(s.text, 40, 100, safe); });
      var without = A.sentences.filter(function (s) { return !re.test(s.text) && okSentence(s.text, 40, 100, safe); });
      if (!withT.length || without.length < 3) continue;
      var s1 = withT[Math.floor(rnd() * withT.length)];
      used[s1.pos] = 1;
      return { q: "Which sentence from the book mentions \"" + tm + "\"?", ans: s1.text, wrong: pick(without, 3, rnd).map(function (x) { return x.text; }), rule: "\"" + clip(s1.text, 150) + "\" is in the book, and it uses the word " + tm + ".", par: s1.par };
    }
    return null;
  }
  function mkOrder(A, rnd, safe, used) {           /* concepts: which of three comes first */
    var pool = A.sentences.filter(function (s) { return okSentence(s.text, 35, 90, safe); });
    if (pool.length < 12) return null;
    var tries, n = pool.length;
    for (tries = 0; tries < 30; tries++) {
      var a = Math.floor(rnd() * (n / 3)), b = Math.floor(n / 3 + rnd() * (n / 3)), c = Math.floor(2 * n / 3 + rnd() * (n / 3));
      if (c >= n) c = n - 1;
      var s1 = pool[a], s2 = pool[b], s3 = pool[c];
      if (!s1 || !s2 || !s3 || used[s1.pos] || s1.text === s2.text || s2.text === s3.text) continue;
      used[s1.pos] = 1;
      return { q: "Which of these comes first in the book?", ans: s1.text, wrong: [s2.text, s3.text], rule: "\"" + clip(s1.text, 140) + "\" is nearer the start; the others come later.", par: s1.par };
    }
    return null;
  }

  /* ---------- the learner's words ---------- */
  var STYLES = {
    arcade:    { engine: "shooter",   label: "Arcade",    host: "Echo", goalVerb: "Shoot the right answer for every round of", words: /arcade|shoot|blast|space|fast|action|laser|battle|race|monster|zap/ },
    detective: { engine: "detective", label: "Detective", host: "Echo", goalVerb: "Solve the case file for every clue in",      words: /detective|mystery|case|clue|spy|solve|secret|investigat/ },
    quiz:      { engine: "detective", label: "Quiz show", host: "Echo", goalVerb: "Win the quiz show on",                        words: /quiz|show|trivia|test|contest|game ?show|school|exam/ }
  };
  function parseWish(wish) {
    var w = String(wish || "").toLowerCase(), style = "", focus = "both", k;
    for (k in STYLES) if (STYLES[k].words.test(w)) { style = k; break; }
    if (/character|who |people|person|friend|hero|names?\b/.test(w) && !/concept|word|idea|vocab|meaning/.test(w)) focus = "characters";
    else if (/concept|word|idea|vocab|meaning|fact|learn|spell/.test(w) && !/character|who |people/.test(w)) focus = "concepts";
    var theme = String(wish || "").replace(/[^A-Za-z0-9 '-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    return { style: style, focus: focus, theme: theme };
  }
  function presets() {
    return [
      { id: "arcade-both", style: "arcade", focus: "both", name: "Arcade: shoot the right answer" },
      { id: "detective-characters", style: "detective", focus: "characters", name: "Detective: who is who" },
      { id: "detective-concepts", style: "detective", focus: "concepts", name: "Detective: the ideas in the book" },
      { id: "quiz-both", style: "quiz", focus: "both", name: "Quiz show: everything in the book" },
      { id: "arcade-concepts", style: "arcade", focus: "concepts", name: "Arcade: missing words" },
      { id: "quiz-characters", style: "quiz", focus: "characters", name: "Quiz show: the characters" }
    ];
  }

  /* ---------- making the game ---------- */
  function makeGame(src, o) {
    o = o || {};
    var A = (src && src.sentences) ? src : analyzeBook(src, o), report = { characters: [], terms: 0, made: {}, droppedByValidator: 0, grade: A.grade, words: A.words };
    var wish = parseWish(o.wish), style = (o.style && o.style !== "auto" && STYLES[o.style]) ? o.style : (wish.style || "detective");
    var focus = o.focus && o.focus !== "auto" ? o.focus : wish.focus, safe = o.safe !== false, count = Math.max(4, Math.min(40, Number(o.count) || 12));
    var seed = Number(o.seed) || 7, rnd = rngFor(seed), title = String(o.title || A.title || "My Book").replace(/\s+/g, " ").trim().slice(0, 60);
    report.characters = A.characters.map(function (c) { return c.name; });
    report.terms = A.terms.length;
    if (A.sentences.length < 12) return { ok: false, errors: ["That text is too short to make a game (needs about 12 sentences)."], report: report };

    var makers = [];
    if (focus === "characters" || focus === "both") makers.push(["who said it", mkWhoSaid], ["who is it", mkWhoIs]);
    if (focus === "concepts" || focus === "both") makers.push(["missing word", mkCloze], ["sentence match", mkMatch], ["what comes first", mkOrder]);
    var hasCast = A.characters.length >= 3 && A.quotes.length >= 2;       /* a story with named people who speak; an essay or a law has none */
    report.hasCharacters = hasCast;
    if (!hasCast && focus === "both") makers = [["missing word", mkCloze], ["sentence match", mkMatch], ["what comes first", mkOrder]];
    if (focus === "characters" && !hasCast) { makers = [["missing word", mkCloze], ["sentence match", mkMatch]]; report.note = "Too few named characters, so the game uses the book's ideas."; }
    var used = {}, items = [], guard = 0, mi = 0, shelf = slug(o.shelf || title), idc = 0;
    while (items.length < count && guard < count * 12) {
      guard++;
      var mk = makers[mi % makers.length]; mi++;
      var q = mk[1](A, rnd, safe, used);
      if (!q || q.wrong.length < 1) continue;
      idc++;
      items.push({ id: "bk" + idc, q: clip(q.q, 260), ans: clip(q.ans, 200), wrong: q.wrong.map(function (x) { return clip(x, 200); }), shelf: shelf + "#" + q.par, failRule: clip(q.rule, 260), kind: mk[0] });
      report.made[mk[0]] = (report.made[mk[0]] || 0) + 1;
    }
    var st = STYLES[style], theme = wish.theme && !/^(make|a|an|the|i|please)\b/i.test(wish.theme) ? clip(wish.theme, 30) : "";
    var echo = clip(st.host + ": \"" + (style === "arcade" ? "Shoot the right answer from " : style === "quiz" ? "Welcome to the quiz show on " : "Every clue is hidden in ") + title + ".\"", 124);
    var cart = {
      id: "book_" + slug(title) + "_" + style + "_" + seed, title: clip((theme ? theme + ": " : "") + title + " (" + st.label + ")", 70),
      engine: st.engine, series: "Book", grade: A.grade || "3-5", subject: "reading",
      goal: clip(st.goalVerb + " " + title + ".", 160), echoLine: echo, items: items,
      bookGame: { title: title, style: style, focus: focus, seed: seed, characters: report.characters.slice(0, 8), madeFrom: "the learner's own copy of the book; nothing was fetched", kidSafeFilter: safe }
    };
    /* the real validator decides: drop any item that breaks a rule, then check the whole cartridge */
    var V = (root.EvelynCartridges && root.EvelynCartridges.CartridgeValidator) || null;
    if (V) {
      var kept = [], j;
      for (j = 0; j < cart.items.length; j++) {
        var probe = { id: cart.id, title: cart.title, engine: cart.engine, series: cart.series, grade: cart.grade, subject: cart.subject, goal: cart.goal, echoLine: cart.echoLine, items: [cart.items[j]] };
        if (V.validate(probe).ok) kept.push(cart.items[j]); else report.droppedByValidator++;
      }
      cart.items = kept;
      var rep = V.validate(cart);
      if (!rep.ok) return { ok: false, errors: rep.errors, report: report };
    }
    if (cart.items.length < 3) return { ok: false, errors: ["Only " + cart.items.length + " usable questions came out of that text. Try a longer book or a different focus."], report: report };
    for (var z = 0; z < cart.items.length; z++) delete cart.items[z].kind;
    return { ok: true, cart: cart, report: report };
  }

  /* ---------- the learner's archive ---------- */
  function listShelves(lib) {
    var out = {}, rows = (lib && lib.rows) || [], i;
    for (i = 0; i < rows.length; i++) out[rows[i].shelf] = (out[rows[i].shelf] || 0) + 1;
    return Object.keys(out).sort().map(function (k) { return { shelf: k, entries: out[k] }; });
  }
  function fromShelf(lib, name) {
    var rows = (lib && lib.rows) || [], parts = [], i, d, cnt = {};
    for (i = 0; i < rows.length; i++) {
      if (rows[i].shelf !== name) continue;
      d = lib.read(rows[i].id);
      if (d && d.fact) parts.push(d.fact);
    }
    for (i = 0; i < parts.length; i++) { var m = /^([^:]{3,60}): /.exec(parts[i]); if (m) cnt[m[1]] = (cnt[m[1]] || 0) + 1; }
    var best = "", bc = 0, k;
    for (k in cnt) if (cnt[k] > bc) { bc = cnt[k]; best = k; }
    var strip = bc > parts.length * 0.5 ? best + ": " : "";
    if (strip) for (i = 0; i < parts.length; i++) if (parts[i].indexOf(strip) === 0) parts[i] = parts[i].slice(strip.length);
    return { title: strip ? best : name, text: parts.join("\n\n") };
  }

  root.EvelynBookGames = { analyzeBook: analyzeBook, makeGame: makeGame, parseWish: parseWish, presets: presets, listShelves: listShelves, fromShelf: fromShelf, STYLES: STYLES, cleanText: cleanText, splitSentences: splitSentences };
})(typeof window !== "undefined" ? window : global);
