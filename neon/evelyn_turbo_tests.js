/* evelyn_turbo_tests.js - Automated ES5 Tests for All 5 Speed & Coding Upgrades:
   EvelynAST, EvelynWasmAccel, EvelynCodeEngine, EvelynBridge & ES5 Audit.
   Run in Node.js: node evelyn_turbo_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) {
    require("./evelyn_backend.js");
    require("./evelyn_ast_ide.js");
    require("./evelyn_wasm_accel.js");
    require("./evelyn_code_engine.js");
  }

  var B = root.EvelynBackend;
  var AST = root.EvelynAST;
  var W = root.EvelynWasmAccel;
  var CE = root.EvelynCodeEngine;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. EvelynAST: Bug detection, autocomplete, token-safe rename & Big-O profiler */
  test("EvelynAST: Catches undefined vars, arity mismatch, ES6 blockers; runs autocomplete, rename & Big-O", function (done) {
    var badCode = [
      "function addTwo(a, b) {",
      "  return a + b;",
      "  var dead = 1;",
      "}",
      "let badEs6 = addTwo(5) + ghostVar;"
    ].join("\n");
    var rep = AST.analyze(badCode);
    assert(!rep.ok, "Broken code must fail analysis");
    var codes = [];
    for (var i = 0; i < rep.errors.length; i++) codes.push(rep.errors[i].code);
    for (i = 0; i < rep.warnings.length; i++) codes.push(rep.warnings[i].code);
    assert(codes.indexOf("ES6_KEYWORD") >= 0, "Should flag ES6 'let'");
    assert(codes.indexOf("UNDEF_VAR") >= 0, "Should flag undefined 'ghostVar'");
    assert(codes.indexOf("ARITY_MISMATCH") >= 0, "Should flag addTwo(5) arity mismatch");
    assert(codes.indexOf("UNREACHABLE") >= 0, "Should flag unreachable code after return");

    var ac = AST.complete(rep, "add");
    assert(ac.length === 1 && ac[0].signature === "addTwo(a, b)", "Autocomplete signature failed");

    var ren = AST.renameSymbol('var x = 1; var max = x + "x";', "x", "speed");
    assert(ren.ok && ren.code === 'var speed = 1; var max = speed + "x";', "Safe rename corrupted string or substring: " + ren.code);

    /* Big-O growth profiler distinguishes O(n) vs O(n^2) */
    var lin = AST.profileGrowth(function (n) { return n * 2; }, [10, 20, 40]);
    var quad = AST.profileGrowth(function (n) { return n * n; }, [10, 20, 40]);
    assertEq(lin.estimatedBigO, "O(n)", "Linear growth misclassified: " + lin.estimatedBigO);
    assert(quad.estimatedBigO.indexOf("O(n^2)") === 0, "Quadratic growth misclassified: " + quad.estimatedBigO);
    done();
  });

  /* 2. EvelynWasmAccel: Native WASM i8_dot parity, fastExp LUT accuracy & 4-bit Q4_0 */
  test("EvelynWasmAccel: Native WASM i8_dot matches JS bit-for-bit; fastExp LUT & Q4_0 pass accuracy", function (done) {
    var rng = B.createRng(2026);
    var len = 256;
    var w = new Int8Array(len), x = new Int8Array(len), expected = 0, i;
    for (i = 0; i < len; i++) {
      w[i] = Math.floor(rng() * 254) - 127;
      x[i] = Math.floor(rng() * 254) - 127;
      expected = (expected + w[i] * x[i]) | 0;
    }
    var got = W.dotInt8(w, 0, x, len);
    assertEq(got, expected, "WASM/fallback dotInt8 mismatch");

    /* fastExp accuracy over [-15, 0] */
    var maxErr = 0;
    for (var f = -15.0; f <= 0.0; f += 0.37) {
      var err = Math.abs(W.fastExp(f) - Math.exp(f));
      if (err > maxErr) maxErr = err;
    }
    assert(maxErr < 0.015, "fastExp LUT error too large: " + maxErr);

    /* Q4_0 compression & cosine similarity */
    var wf = new Float32Array(32 * 64), xv = new Float32Array(64);
    for (i = 0; i < wf.length; i++) wf[i] = rng() * 2 - 1;
    for (i = 0; i < 64; i++) xv[i] = rng() * 2 - 1;
    var q4 = W.Q4Codec.packQ4(wf, 32, 64);
    assert(q4.stats.compressionVsInt8 > 1.5, "Q4_0 should shrink INT8 weights noticeably");
    var yQ4 = new Float32Array(32), dot = 0, n1 = 0, n2 = 0;
    W.Q4Codec.matvecQ4(q4, xv, yQ4);
    for (var r = 0; r < 32; r++) {
      var acc = 0; for (var c = 0; c < 64; c++) acc += wf[r * 64 + c] * xv[c];
      dot += acc * yQ4[r]; n1 += acc * acc; n2 += yQ4[r] * yQ4[r];
    }
    assert((dot / Math.sqrt(n1 * n2)) > 0.96, "Q4_0 cosine similarity too low");
    done();
  });

  /* 3. EvelynCodeEngine: BPE, RoPE relative-position invariance, FIM, Prefix KV Reuse & Speculative Drafting */
  test("EvelynCodeEngine: BPE compression, RoPE relative invariance, FIM splice, Prefix KV & Speculative Draft", function (done) {
    /* BPE */
    var bpe = new CE.BPETokenizer();
    var codeCorpus = "function step(x) { return x + 1; }\nfunction loop(x) { return step(x); }\n";
    bpe.train(codeCorpus + codeCorpus + codeCorpus, 24);
    var encoded = bpe.encode(codeCorpus);
    assert(encoded.length < codeCorpus.length * 0.65, "BPE should compress code tokens noticeably (" + encoded.length + " vs " + codeCorpus.length + ")");
    assertEq(bpe.decode(encoded), codeCorpus, "BPE decode must be 100% lossless");

    /* RoPE: dot(RoPE(q, m), RoPE(k, n)) must depend ONLY on (m - n)! */
    var rope = new CE.RoPE(8, 2048);
    var q = new Float32Array([0.5, -0.3, 0.8, 0.1, -0.4, 0.6, 0.2, -0.7]);
    var k = new Float32Array([0.2, 0.9, -0.5, 0.4, 0.7, -0.1, 0.3, 0.5]);
    function dotF(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
    var d1 = dotF(rope.apply(q, 10), rope.apply(k, 25));
    var d2 = dotF(rope.apply(q, 510), rope.apply(k, 525));
    assert(Math.abs(d1 - d2) < 1e-4, "RoPE failed relative-position invariance (" + d1 + " vs " + d2 + ")");

    /* FIM */
    var src = "function hi() {\n  \n  return 1;\n}";
    var fim = CE.FIM.buildPrompt(src, 18);
    assertEq(CE.FIM.spliceCompletion(fim, "var a = 2;"), "function hi() {\n  var a = 2;\n  return 1;\n}", "FIM splice mismatch");

    /* Prefix KV Cache reuse on mid-file edit */
    var kv = new CE.PrefixKVCache();
    var fakeStep = function (tok, p) { return { k: tok + p, v: tok * 2 }; };
    var r1 = kv.update([10, 20, 30, 40, 50], fakeStep);
    assertEq(r1.computedTokens, 5, "Initial fill computes all 5 tokens");
    var r2 = kv.update([10, 20, 30, 99, 100], fakeStep);
    assertEq(r2.reusedTokens, 3, "Edit at index 3 must reuse 3 cached prefix tokens");
    assertEq(r2.computedTokens, 2, "Edit at index 3 must compute only 2 new tokens");

    /* Speculative Coder (AST symbol + prompt lookup) */
    var dAst = CE.SpeculativeCoder.draftFromContext("var x = calcu", ["calculateTotal", "clearGrid"], 16);
    assertEq(dAst.source, "ast_symbol", "Expected AST symbol draft");
    assertEq(dAst.draft, "lateTotal", "Expected suffix 'lateTotal'");
    var ver = CE.SpeculativeCoder.verifyDraft(dAst.draft, function (i, ch) { return "lateTotal".charAt(i) === ch; });
    assertEq(ver.accepted, 9, "All 9 drafted symbol chars should accept");
    done();
  });

  /* 4. EvelynBridge: COOP/COEP headers, path-jail traversal defense, file R/W, node run & local-ai fallback */
  if (isNode) {
    test("EvelynBridge: COOP/COEP headers, path jail, workspace run & local-ai TNY2 fallback", function (done) {
      var http = require("http"), os = require("os"), fs = require("fs"), path = require("path");
      var bridgeMod = require("./evelyn_bridge.js");
      var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evelyn_bridge_test_"));
      var inst = bridgeMod.createBridgeServer({ staticDir: tmpDir, workspaceDir: tmpDir, localAiPort: 59999 });
      assert(typeof bridgeMod.listenLoopback === "function", "The bridge must start only through listenLoopback (127.0.0.1)");

      /* extra = { headers: {...}, noToken: true, raw: "text body" } lets a test act like another site */
      function req(method, urlPath, bodyObj, cb, extra) {
        extra = extra || {};
        var payload = extra.raw !== undefined ? extra.raw : (bodyObj ? JSON.stringify(bodyObj) : "");
        var hdr = (bodyObj || extra.raw !== undefined) ? { "Content-Type": extra.contentType || "application/json", "Content-Length": Buffer.byteLength(payload) } : {};
        if (!extra.noToken) hdr["x-evelyn-token"] = inst.token;
        var k;
        for (k in (extra.headers || {})) hdr[k] = extra.headers[k];
        var r = http.request({
          hostname: "127.0.0.1", port: inst.server.address().port, path: urlPath, method: method,
          headers: hdr
        }, function (res) {
          var bufs = [];
          res.on("data", function (c) { bufs.push(c); });
          res.on("end", function () {
            var txt = Buffer.concat(bufs).toString("utf8"), parsed;
            try { parsed = JSON.parse(txt); } catch (pe) { parsed = txt; }
            cb(null, res.statusCode, res.headers, parsed);
          });
        });
        r.on("error", cb);
        r.end(payload);
      }

      inst.server.listen(0, "127.0.0.1", function () {
        req("GET", "/api/health", null, function (e1, st1, hdr1, b1) {
          assert(!e1 && st1 === 200 && b1.ok, "Health check failed");
          assertEq(hdr1["cross-origin-opener-policy"], "same-origin", "Missing COOP header");
          assertEq(hdr1["cross-origin-embedder-policy"], "require-corp", "Missing COEP header");

          /* A page on another site must not be able to write or run anything: no token, a foreign Origin, a rebinding Host
             name and a text/plain "simple request" are each refused before any file is touched. */
          var port0 = inst.server.address().port;
          req("POST", "/api/write", { name: "x.js", content: "1" }, function (a1, sa) {
            assert(!a1 && sa === 401, "No token must give 401, got " + sa);
            req("POST", "/api/write", { name: "x.js", content: "1" }, function (a2, sb) {
              assert(!a2 && sb === 403, "Foreign Origin must give 403, got " + sb);
              req("POST", "/api/write", { name: "x.js", content: "1" }, function (a3, sc) {
                assert(!a3 && sc === 403, "Rebinding Host must give 403, got " + sc);
                req("POST", "/api/write", null, function (a4, sd) {
                  assert(!a4 && sd === 415, "text/plain body must give 415, got " + sd);
                  req("GET", "/api/token", null, function (a5, se, h5, b5) {
                    assert(!a5 && se === 200 && b5.token === inst.token, "Same-origin page can read the token");
                    assert(h5["cross-origin-resource-policy"] === "same-origin", "Token response must be same-origin only");
                    assert(!fs.existsSync(path.join(tmpDir, "x.js")), "A refused write must leave no file behind");
                    jailAndRun();
                  });
                }, { raw: "{\"name\":\"x.js\",\"content\":\"1\"}", contentType: "text/plain" });
              }, { headers: { Host: "evil.example:" + port0 } });
            }, { headers: { Origin: "http://evil.example" } });
          }, { noToken: true });
        });
        /* Things the first version let through: a write into a missing folder killed the server, any file type in the
           static folder was served, the child process got this server's whole environment, and a link inside the
           workspace could point outside it. */
        function hardening() {
          req("POST", "/api/write", { name: "nodir/x.js", content: "1" }, function (h1, s1) {
            assert(!h1 && s1 === 400, "A write into a missing folder must give 400 and keep the server alive, got " + s1);
            req("POST", "/api/write", { name: "secret.txt", content: "keys" }, function (h2, s2) {
              assert(!h2 && s2 === 200, "Writing secret.txt");
              req("GET", "/secret.txt", null, function (h3, s3) {
                assert(!h3 && s3 === 404, "A .txt file must not be served as a static page, got " + s3);
                req("GET", "/sum.js", null, function (h4, s4, hd4, b4) {
                  assert(!h4 && s4 === 200 && String(b4).indexOf("6 * 7") > 0, "A .js page is still served");
                  process.env.EVELYN_SECRET_TEST = "leak";
                  req("POST", "/api/write", { name: "env.js", content: "console.log(String(process.env.EVELYN_SECRET_TEST));" }, function () {
                    req("POST", "/api/run", { name: "env.js", runtime: "node" }, function (h5, s5, hd5, b5) {
                      delete process.env.EVELYN_SECRET_TEST;
                      assert(!h5 && b5.ok && b5.stdout.trim() === "undefined", "A run must not see the server's environment, got " + JSON.stringify(b5.stdout));
                      var outside = fs.mkdtempSync(path.join(os.tmpdir(), "evelyn_outside_"));
                      fs.writeFileSync(path.join(outside, "o.txt"), "outside", "utf8");
                      var linked = true;
                      try { fs.symlinkSync(outside, path.join(tmpDir, "lnk"), "junction"); } catch (le) { linked = false; }
                      function finish() {
                        try { fs.rmSync(outside, { recursive: true, force: true }); } catch (x) {}
                        inst.server.close(function () {
                          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (x) {}
                          done();
                        });
                      }
                      if (!linked) return finish();
                      req("POST", "/api/read", { name: "lnk/o.txt" }, function (h6, s6) {
                        assert(!h6 && s6 === 403, "A link that leaves the workspace must be refused with 403, got " + s6);
                        finish();
                      });
                    });
                  });
                });
              });
            });
          });
        }
        function jailAndRun() {
          /* Jail test: '..' traversal must return 403 */
          req("POST", "/api/write", { name: "../escape.txt", content: "bad" }, function (e2, st2) {
            assert(!e2 && st2 === 403, "Path jail must block ../escape.txt with 403");

            /* Write & run real JS inside jailed workspace */
            req("POST", "/api/write", { name: "sum.js", content: "console.log(6 * 7);" }, function (e3, st3) {
              assert(!e3 && st3 === 200, "Workspace write failed");
              req("POST", "/api/run", { name: "sum.js", runtime: "node" }, function (e4, st4, _, b4) {
                assert(!e4 && st4 === 200 && b4.ok && b4.stdout.trim() === "42", "Workspace node run failed");

                /* Local AI proxy falls back cleanly to tny2 when no llama-server is running */
                req("POST", "/api/local-ai", { prompt: "hi" }, function (e5, st5, _, b5) {
                  assert(!e5 && st5 === 200 && b5.available === false && b5.fallback === "tny2", "Local AI fallback failed");
                  hardening();
                });
              });
            });
          });
        }
      });
    });

    test("ES5 Audit: Zero ES6+ syntax in AST, WASM, CodeEngine, Bridge & Turbo tests", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_ast_ide.js", "evelyn_wasm_accel.js", "evelyn_code_engine.js", "evelyn_bridge.js", "evelyn_lab.js", "evelyn_turbo_tests.js"];
      var banned = [[/\bArray\.from\s*\(/, "Array.from"], [/\bnew\s+Map\s*\(/, "Map"], [/\bnew\s+Set\s*\(/, "Set"], [new RegExp("[\\w$)]\\s*=" + ">"), "arrow"], [/\(\?</, "lookbehind"]];
      for (var i = 0; i < files.length; i++) {
        var fp = path.join(__dirname, files[i]);
        if (!fs.existsSync(fp)) continue;
        var src = fs.readFileSync(fp, "utf8");
        for (var j = 0; j < banned.length; j++) assert(!banned[j][0].test(src), files[i] + " failed ES5 guard: " + banned[j][1]);
      }
      done();
    });
  }

  var pass = 0, fail = 0, idx = 0;
  function next() {
    if (idx >= tests.length) {
      console.log("\n=== EVELYN TURBO CODING UPGRADES RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN TURBO CODING & ACCELERATOR TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
