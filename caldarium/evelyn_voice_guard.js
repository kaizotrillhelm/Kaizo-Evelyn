/* evelyn_voice_guard.js - Runtime AI-Tic Detector, Cleaner & Canon Voice Guard.
   Sits between TNY2 / Evolution / Director and the screen/voice output.
   Pure ES5 (zero lookbehinds, zero Map/Set/arrows). Works in Browser & Node. */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode && !root.EvelynBackend) require("./evelyn_backend.js");

  /* Direct swaps: copula avoidance, Latinate buzzwords, colorful verb inflation */
  var LEXICON_SWAPS = [
    [/\bserves as a\b/gi, "is a"],
    [/\bserves as the\b/gi, "is the"],
    [/\bstands as a\b/gi, "is a"],
    [/\bfunctions as a\b/gi, "is a"],
    [/\boperates as a\b/gi, "is a"],
    [/\bboasts a\b/gi, "has a"],
    [/\bboasts\b/gi, "has"],
    [/\butilize\b/gi, "use"],
    [/\butilizes\b/gi, "uses"],
    [/\butilized\b/gi, "used"],
    [/\butilizing\b/gi, "using"],
    [/\bfacilitate\b/gi, "help"],
    [/\bfacilitates\b/gi, "helps"],
    [/\bleverage\b/gi, "use"],
    [/\bleverages\b/gi, "uses"],
    [/\bleveraging\b/gi, "using"],
    [/\bcommence\b/gi, "start"],
    [/\bcommences\b/gi, "starts"],
    [/\belucidate\b/gi, "explain"],
    [/\bdelve into\b/gi, "look at"],
    [/\bdelve\b/gi, "look"],
    [/\bunderscore\b/gi, "show"],
    [/\bunderscores\b/gi, "shows"],
    [/\bunderscoring\b/gi, "showing"],
    [/\bshowcase\b/gi, "show"],
    [/\bshowcases\b/gi, "shows"],
    [/\bshowcasing\b/gi, "showing"],
    [/\bunveiled\b/gi, "showed"],
    [/\bspearheaded\b/gi, "led"],
    [/\bforged a\b/gi, "made a"],
    [/\bfoster\b/gi, "build"],
    [/\bfosters\b/gi, "builds"],
    [/\bfostering\b/gi, "building"],
    [/\bseamless\b/gi, "smooth"],
    [/\brobust\b/gi, "strong"],
    [/\bpivotal\b/gi, "main"],
    [/\btapestry\b/gi, "mix"],
    [/\bcomprehensive\b/gi, "full"],
    [/\bmethodology\b/gi, "method"]
  ];

  /* Empty intensifier adverbs (Tic #20) */
  var EMPTY_ADVERBS = /\b(quietly|genuinely|fundamentally|notably|impressively|effortlessly|meticulously|deeply|universally)\s+/gi;

  /* Throat-clearing, meta-hedges, chatbot chatter, transitions (Tics #10, #12, #15, #24, #27) */
  var STRIP_OPENERS = [
    /^\s*(certainly!?|of course!?|great question!?|you're absolutely right!?|you are absolutely right!?)\s*/i,
    /^\s*(let's dive in!?|let's unpack this\.?|picture this:|buckle up\.?|here's the kicker:|here is the breakdown:)\s*/i,
    /^\s*(it is important to note that|it's important to note that|it is worth mentioning that|one must remember that)\s*/i,
    /^\s*(furthermore,|moreover,|additionally,|consequently,|overall,|in conclusion,|in summary,|that being said,)\s*/i
  ];

  var STRIP_CLOSERS = [
    /\s*(i hope this helps!?|let me know if you need anything else\.?|would you like me to expand on that\??|let that sink in\.?)\s*$/i
  ];

  /* Detection-only / rewrite rules covering Tics #1-#63 */
  var AUDIT_RULES = [
    { id: "negative_parallelism", sev: "high", re: /\b(?:not|(?:is|are|was|were|does|do|did)n['’]t)\s+just\b.{1,60}\b(?:but|it['’]s|it is)|\bisn['’]t about\b.{1,60}\bit['’]s|\bnot only\b.{1,60}\bbut also|\bmore than just\b/i, msg: "Negative parallelism ('not just X, but Y'). Start directly at Y." },
    { id: "rather_than", sev: "med", re: /\brather than\b/i, msg: "Contrastive 'rather than' framing." },
    { id: "rule_of_three_abstract", sev: "med", re: /\b\w+(?:tion|sion|ity|ment|ness|ance|ence),\s+\w+(?:tion|sion|ity|ment|ness|ance|ence),\s+and\s+\w+(?:tion|sion|ity|ment|ness|ance|ence)\b/i, msg: "Abstract rule-of-three triplet." },
    { id: "staccato_qa", sev: "med", re: /\b(The result|What changed|The catch|The answer|The truth)\?\s+[A-Z]/, msg: "Staccato rhetorical Q&A." },
    { id: "trailing_participle", sev: "med", re: /,\s+(highlighting|underscoring|emphasizing|ensuring|signaling|reflecting|symbolizing|showcasing|fostering)\b/i, msg: "Trailing participial editorializing tag-on." },
    { id: "false_range", sev: "med", re: /\bfrom\s+(beginners|novices|simple|small|local|backyard|junior)\b.{1,35}\bto\s+(experts|masters|complex|global|seasoned|large)\b/i, msg: "False 'from X to Y' spectrum." },
    { id: "everyone_hook", sev: "high", re: /\bwhether you(?:'re| are) a\b.{1,50}\bor a\b/i, msg: "Universal everyone-audience hook." },
    { id: "spatial_crutch", sev: "med", re: /\b(sits at the intersection of|lies at the (?:very )?heart of|operates within the realm of)\b/i, msg: "Spatial metaphor crutch." },
    { id: "fragment_triplet", sev: "med", re: /\bNo\s+\w+\.\s+No\s+\w+\.\s+Just\s+\w+\./i, msg: "Staccato fragment triplet ('No X. No Y. Just Z.')." },
    { id: "tourism_inflation", sev: "high", re: /\b(stands as a testament|watershed moment|enduring legacy|reimagining the future|in today's fast-paced)\b/i, msg: "Inflated symbolism or tourism-brochure phrasing." },
    { id: "vague_attribution", sev: "med", re: /\b(studies show|many experts argue|some critics argue|observers have cited|industry reports suggest)\b/i, msg: "Vague unattributed authority." },
    { id: "chatbot_artifact", sev: "high", re: /(oaicite|contentReference|turn0search|utm_source=chatgpt|utm_source=openai|\[\s*(?:Company|Entertainer|Founder|Your)\s+Name\s*\])/i, msg: "Chatbot artifact, UTM leak, or unfilled placeholder." },
    { id: "apologetic_ux", sev: "high", re: /\b(oops!?\s+something went wrong|we're sorry,?\s+we couldn't complete|uh-oh|whoopsie)\b/i, msg: "Apologetic non-actionable UX microcopy." },
    { id: "somatic_cliche", sev: "high", re: /\b(breath (?:he|she|they) didn't know|knuckles turned white|shiver ran down|swallowed thickly|couldn't help but|smell of ozone|air thick with tension|tightening in (?:his|her|their) chest|knot formed in)\b/i, msg: "Recycled somatic/sensory cliché." },
    { id: "emotional_beat_pad", sev: "high", re: /\b(flicker of something|filing (?:it|that) away|an unspoken understanding|something shifted between them|said more than words ever could)\b/i, msg: "Subtext announcement or emotional-beat padding." },
    { id: "voice_laced_with", sev: "high", re: /\bvoice\s+(laced|tinged|dripping|thick|heavy)\s+with\b/i, msg: "Voice-laced-with emotion dialogue tag." },
    { id: "therapy_speak", sev: "high", re: /\b(set a boundary|process(?:ing)? (?:my|your|our) emotions|validate your feelings|hold space for)\b/i, msg: "Therapy-speak in spoken dialogue." },
    { id: "tag_action_lock", sev: "med", re: /,"\s+(?:he|she|they|[A-Z][a-z]+)\s+(?:said|replied|whispered|murmured|asked),\s+[a-z]+ing\b/, msg: "1-2-3 dialogue tag-and-participial-action lock." },
    { id: "parroting_echo", sev: "med", re: /\b([A-Z][a-z]{2,})\?\s+What do you mean,?\s+\1\?/i, msg: "Mechanical dialogue parroting." },
    { id: "stock_ai_name", sev: "med", re: /\b(Elara Voss|Aethelgard|Eldoria|Seraphina|Aurelius)\b/, msg: "Stock AI placeholder name outside canon roster." },
    { id: "markdown_leak", sev: "high", re: /(```|\*\*[^*]{2,30}:\*\*|^\s*#{1,4}\s)/m, msg: "Raw Markdown formatting inside spoken or UI prose." }
  ];

  /* Seamslop tracker (Tic #9): tracks recent non-domain content words across turns */
  var STOP_WORDS = {
    the:1,and:1,for:1,that:1,with:1,this:1,from:1,your:1,have:1,will:1,what:1,when:1,where:1,
    which:1,about:1,into:1,they:1,them:1,their:1,there:1,then:1,than:1,check:1,shelf:1,rule:1,
    cart:1,door:1,game:1,round:1,score:1,clock:1,time:1,team:1,okay:1,note:1,water:1,light:1,
    miles:1,feet:1,line:1,dial:1,stop:1,move:1,next:1,back:1,more:1,only:1,each:1,every:1
  };
  var recentTurns = [];

  function recordForSeamslop(text) {
    recentTurns.push(String(text || "").toLowerCase());
    if (recentTurns.length > 6) recentTurns.shift();
  }

  function findSeamslopWords(text) {
    var combined = recentTurns.join(" ") + " " + String(text || "").toLowerCase();
    var words = combined.match(/[a-z]{5,}/g) || [];
    var counts = Object.create(null), flagged = [], i;
    for (i = 0; i < words.length; i++) {
      var w = words[i];
      if (STOP_WORDS[w]) continue;
      counts[w] = (counts[w] || 0) + 1;
    }
    var curWords = String(text || "").toLowerCase().match(/[a-z]{5,}/g) || [];
    var seen = Object.create(null);
    for (i = 0; i < curWords.length; i++) {
      var cw = curWords[i];
      if (!seen[cw] && counts[cw] >= 4) {
        seen[cw] = 1;
        flagged.push(cw);
      }
    }
    return flagged;
  }

  /* Audit any string and return list of detected AI tics */
  function audit(text, opts) {
    opts = opts || {};
    var s = String(text || "");
    var hits = [], i;

    for (i = 0; i < AUDIT_RULES.length; i++) {
      var r = AUDIT_RULES[i];
      if (r.re.test(s)) hits.push({ id: r.id, sev: r.sev, msg: r.msg });
    }
    /* Em-dash budget check (Tic #6): max 1 per short response */
    var ems = s.match(/\u2014|--/g) || [];
    if (ems.length > 1) {
      hits.push({ id: "em_dash_overuse", sev: "med", msg: "Too many em dashes (" + ems.length + "). Use periods, commas, or parentheses." });
    }
    /* Lexicon buzzword density check (Tic #7) */
    var buzzCount = 0;
    for (i = 0; i < LEXICON_SWAPS.length; i++) {
      if (LEXICON_SWAPS[i][0].test(s)) buzzCount++;
    }
    if (buzzCount > 0) {
      hits.push({ id: "ai_lexicon", sev: buzzCount >= 2 ? "high" : "med", msg: "Detected " + buzzCount + " AI buzzword/copula-avoidance pattern(s)." });
    }
    if (EMPTY_ADVERBS.test(s)) {
      EMPTY_ADVERBS.lastIndex = 0;
      hits.push({ id: "empty_adverb", sev: "med", msg: "Empty intensifier adverb (quietly/notably/genuinely/etc.)." });
    }
    for (i = 0; i < STRIP_OPENERS.length; i++) {
      if (STRIP_OPENERS[i].test(s)) { hits.push({ id: "throat_clearing", sev: "high", msg: "Chatbot opener, hedge, or formal transition." }); break; }
    }
    if (opts.checkSeamslop) {
      var slop = findSeamslopWords(s);
      if (slop.length) hits.push({ id: "seamslop", sev: "med", msg: "Repeated content word across turns: " + slop.join(", ") });
    }
    return { clean: hits.length === 0, hits: hits };
  }

  /* Canon voice enforcement (prevents Tic #55 Hive Voice and locks cast sheets) */
  function enforceCanonVoice(speaker, text) {
    var s = String(text || "").trim();
    var sp = String(speaker || "").toLowerCase();
    if (!sp) return s;

    if (sp === "vera") {
      s = s.replace(/!+/g, ".");
    } else if (sp === "dritchlyssa") {
      s = s.replace(/\bdon't\b/gi, "do not")
           .replace(/\bcan't\b/gi, "cannot")
           .replace(/\bwon't\b/gi, "will not")
           .replace(/\bisn't\b/gi, "is not")
           .replace(/\bit's\b/gi, "it is")
           .replace(/\bi'm\b/gi, "I am")
           .replace(/\bwe're\b/gi, "we are")
           .replace(/\bplease,?\s*/gi, "");
    } else if (sp === "dr candor" || sp === "candor") {
      s = s.replace(/\b(no|sorry)\b[,.!]?\s*/gi, "");
      if (s.indexOf("Zeep zorp, team.") < 0 && s.length < 108) s = s + " Zeep zorp, team.";
    } else if (sp === "evelyn") {
      s = s.replace(/\bi (?:don't|do not) know\b/gi, "Okay. Check the shelf");
    } else if (sp === "julian") {
      s = s.replace(/\b(he|him|his|she|her|they|them|their)\b/gi, "Julian");
    }
    return s.replace(/\s{2,}/g, " ").trim();
  }

  /* Deterministic cleaner: removes/rewrites AI tics before text reaches the learner */
  function clean(text, opts) {
    opts = opts || {};
    var s = String(text || "");
    var i;

    /* 1. Normalize curly quotes and strip raw Markdown wrappers */
    s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    s = s.replace(/```[a-z]*\n?/gi, "").replace(/\*\*([^*]+)\*\*/g, "$1");

    /* 2. Strip URL tracking leaks & internal citation tokens */
    s = s.replace(/[?&](?:utm_source|referrer)=(?:chatgpt\.com|openai|driver\.com|grok\.com)\b/gi, "");
    s = s.replace(/contentReference\[[^\]]*\]/g, "");

    /* 3. Strip chatbot openers, closers, formal transitions, meta-hedges */
    for (i = 0; i < STRIP_OPENERS.length; i++) s = s.replace(STRIP_OPENERS[i], "");
    for (i = 0; i < STRIP_CLOSERS.length; i++) s = s.replace(STRIP_CLOSERS[i], "");

    /* 4. Chop "Whether you're X or Y," everyone-audience hooks at the comma */
    s = s.replace(/\bwhether you(?:'re| are)\s+[^,]{3,70},\s*/i, "");

    /* 5. Collapse "It's not just X, it's Y" / "not just X—it's Y" to start at Y */
    s = s.replace(/\b(?:it is|it's|this is|this isn't|it isn't)\s+not\s+just\s+[^.,;\u2014]{2,55}[,;\u2014-]+\s*(?:but\s+)?(?:it is|it's|they are|they're)\s+/gi, "It is ");
    s = s.replace(/\bnot\s+just\s+[^.,;\u2014]{2,45}[,;\u2014-]+\s*(?:but(?:\s+also)?\s+)/gi, "");

    /* 6. Replace apologetic UX microcopy with literal action copy */
    s = s.replace(/\b(?:oops!?\s+)?something went wrong\.?(?:\s+please try again later!?)?/gi, "Action failed. Check your entry and try again.");
    s = s.replace(/\bwe're sorry,?\s+we couldn't complete your request(?: at this time)?\.?/gi, "Request did not finish. Try the step again.");

    /* 7. Downgrade buzzwords, copula avoidance, colorful verbs, spatial crutches */
    for (i = 0; i < LEXICON_SWAPS.length; i++) s = s.replace(LEXICON_SWAPS[i][0], LEXICON_SWAPS[i][1]);
    s = s.replace(/\bsits at the intersection of\b/gi, "connects");
    s = s.replace(/\blies at the (?:very )?heart of\b/gi, "is central to");
    s = s.replace(EMPTY_ADVERBS, "");

    /* 8. Strip dialogue padding & trailing participial fluff */
    s = s.replace(/,?\s*her voice (?:laced|tinged|dripping|thick) with [a-z ]+/gi, "");
    s = s.replace(/,?\s*his voice (?:laced|tinged|dripping|thick) with [a-z ]+/gi, "");
    s = s.replace(/,\s+(?:highlighting|underscoring|emphasizing|ensuring|signaling|showcasing)\s+[^.!?]+/gi, "");

    /* 9. Replace em dashes with clean periods/commas */
    s = s.replace(/\s*(?:\u2014|--)\s*/g, ", ");

    /* 10. Clean spacing & capitalize opening letter */
    s = s.replace(/\s{2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
    if (s.length > 0 && s.charAt(0) >= "a" && s.charAt(0) <= "z") {
      s = s.charAt(0).toUpperCase() + s.slice(1);
    }

    /* 11. Apply canon voice sheet if speaker is specified */
    if (opts.speaker) s = enforceCanonVoice(opts.speaker, s);

    /* 12. Enforce 128-character Echo cap if flagged */
    if (opts.isEcho && s.length > 128) s = s.slice(0, 125).trim() + "...";

    if (opts.trackHistory !== false) recordForSeamslop(s);
    return s;
  }

  /* Wrap EvelynBackend.EchoWorker.think and AudioFX.speak so all AI communication is guarded */
  var hooksInstalled = false;
  function installHooks() {
    if (hooksInstalled || !root.EvelynBackend) return false;
    hooksInstalled = true;
    var B = root.EvelynBackend;

    if (B.EchoWorker && typeof B.EchoWorker.think === "function") {
      var origThink = B.EchoWorker.think;
      B.EchoWorker.think = function (q, creat, cb) {
        origThink.call(B.EchoWorker, q, creat, function (err, res) {
          if (!err && res && res.text) {
            res.rawText = res.text;
            res.text = clean(res.text, { isEcho: true, speaker: "evelyn" });
          }
          cb(err, res);
        });
      };
    }

    if (B.AudioFX && typeof B.AudioFX.speak === "function") {
      var origSpeak = B.AudioFX.speak;
      B.AudioFX.speak = function (txt) {
        origSpeak.call(B.AudioFX, clean(txt, { trackHistory: false }));
      };
    }
    return true;
  }

  root.EvelynVoiceGuard = {
    audit: audit,
    clean: clean,
    enforceCanonVoice: enforceCanonVoice,
    findSeamslopWords: findSeamslopWords,
    resetHistory: function () { recentTurns = []; },
    installHooks: installHooks
  };
})(typeof window !== "undefined" ? window : global);
