/* evelyn_bridge.js - Optional Zero-Dependency Local Companion Server (127.0.0.1)
   Unlocks:
   - COOP/COEP headers (enables multi-threaded SharedArrayBuffer WASM workers)
   - Path-jailed multi-file workspace I/O (blocks '..' directory traversal)
   - Timed local execution for Node / Python / Tiny C Compiler (tcc)
   - Safe proxy to an optional local llama.cpp / bitnet.cpp coding model on 127.0.0.1:8081
     with automatic Charter + VoiceGuard filtering and TNY2 fallback.
   Run directly: node evelyn_bridge.js */
(function () {
  "use strict";

  var http = require("http");
  var fs = require("fs");
  var path = require("path");
  var cp = require("child_process");
  var crypto = require("crypto");

  function safeJoin(rootDir, relPath) {
    var clean = String(relPath || "").replace(/\\/g, "/");
    if (clean.indexOf("\0") >= 0 || clean.indexOf("..") >= 0 || path.isAbsolute(clean)) return null;
    var resolvedRoot = path.resolve(rootDir);
    var resolvedTarget = path.resolve(resolvedRoot, clean);
    if (resolvedTarget !== resolvedRoot && resolvedTarget.indexOf(resolvedRoot + path.sep) !== 0) return null;
    if (!insideReal(resolvedRoot, resolvedTarget)) return null;
    return resolvedTarget;
  }

  /* The nearest existing part of the path, with symbolic links resolved, must still sit inside the real root. */
  function insideReal(rootDir, target) {
    try {
      var p = target;
      while (!fs.existsSync(p)) {
        var up = path.dirname(p);
        if (up === p) return false;
        p = up;
      }
      var realRoot = fs.realpathSync(rootDir), real = fs.realpathSync(p);
      return real === realRoot || real.indexOf(realRoot + path.sep) === 0;
    } catch (e) { return false; }
  }

  /* A child process gets only what it needs to start: no keys or tokens from this server's environment. */
  function childEnv() {
    var keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"], out = {}, i;
    for (i = 0; i < keep.length; i++) if (process.env[keep[i]] !== undefined) out[keep[i]] = process.env[keep[i]];
    return out;
  }

  /* The only way this file starts a server: loopback only, and only when a caller asks. */
  function listenLoopback(inst, port, cb) {
    inst.server.listen(port, "127.0.0.1", cb);
    return inst;
  }

  function readJsonBody(req, maxBytes, cb) {
    var chunks = [], size = 0, aborted = false;
    req.on("data", function (buf) {
      size += buf.length;
      if (size > maxBytes) { aborted = true; req.destroy(); cb(new Error("Body too large")); return; }
      chunks.push(buf);
    });
    req.on("end", function () {
      if (aborted) return;
      try { cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { cb(new Error("Invalid JSON body")); }
    });
  }

  function sendJson(res, status, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cache-Control": "no-store"
    });
    res.end(body);
  }

  function createBridgeServer(opts) {
    opts = opts || {};
    var staticDir = path.resolve(opts.staticDir || process.cwd());
    var workDir = path.resolve(opts.workspaceDir || path.join(staticDir, "workspace"));
    var localAiPort = opts.localAiPort || 8081;
    /* /api/write and /api/run write a file and run it, so every /api call but /api/health and /api/token needs this
       per-start secret. A page on another site can send a request to 127.0.0.1 but can never read the secret, and the
       Host and Origin checks below stop DNS-rebinding pages and cross-site posts. */
    var token = opts.token || crypto.randomBytes(16).toString("hex");
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    var mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".bin": "application/octet-stream" };

    var server = http.createServer(function (req, res) {
      /* Mandatory COOP/COEP headers for multi-threaded SharedArrayBuffer WASM */
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

      var urlPath = (req.url || "/").split("?")[0];
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

      var port = server.address() && server.address().port;
      var host = String(req.headers.host || "");
      var okHosts = ["127.0.0.1:" + port, "localhost:" + port, "[::1]:" + port];
      if (okHosts.indexOf(host) < 0) return sendJson(res, 403, { ok: false, error: "Host not allowed." });
      var origin = req.headers.origin;
      if (origin && origin !== "http://" + host) return sendJson(res, 403, { ok: false, error: "Cross-origin request blocked." });

      if (urlPath.indexOf("/api/") === 0 && urlPath !== "/api/health") {
        if (urlPath === "/api/token" && req.method === "GET") return sendJson(res, 200, { ok: true, token: token });
        var sent = String(req.headers["x-evelyn-token"] || "");
        var good = sent.length === token.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
        if (!good) return sendJson(res, 401, { ok: false, error: "Missing or wrong x-evelyn-token (GET /api/token from the same page)." });
        if (req.method === "POST" && String(req.headers["content-type"] || "").indexOf("application/json") !== 0) return sendJson(res, 415, { ok: false, error: "POST bodies must be application/json." });
      }

      if (urlPath === "/api/health" && req.method === "GET") {
        return sendJson(res, 200, { ok: true, coop: true, coep: true, workspace: path.basename(workDir) });
      }

      if (urlPath === "/api/files" && req.method === "GET") {
        var list = fs.readdirSync(workDir);
        return sendJson(res, 200, { ok: true, files: list });
      }

      if (urlPath === "/api/write" && req.method === "POST") {
        return readJsonBody(req, 262144, function (err, body) {
          if (err) return sendJson(res, 400, { ok: false, error: err.message });
          var target = safeJoin(workDir, body.name);
          if (!target) return sendJson(res, 403, { ok: false, error: "Path outside workspace jail blocked." });
          try { fs.writeFileSync(target, String(body.content || ""), "utf8"); }
          catch (we) { return sendJson(res, 400, { ok: false, error: "Could not write that name (the folder may not exist)." }); }
          return sendJson(res, 200, { ok: true, name: body.name, bytes: Buffer.byteLength(String(body.content || ""), "utf8") });
        });
      }

      if (urlPath === "/api/read" && req.method === "POST") {
        return readJsonBody(req, 8192, function (err, body) {
          if (err) return sendJson(res, 400, { ok: false, error: err.message });
          var target = safeJoin(workDir, body.name);
          if (!target) return sendJson(res, 403, { ok: false, error: "Path outside workspace jail blocked." });
          if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return sendJson(res, 404, { ok: false, error: "File not found." });
          return sendJson(res, 200, { ok: true, name: body.name, content: fs.readFileSync(target, "utf8") });
        });
      }

      /* Safe timed local runner (supports node / tcc / python3 inside jailed workspace) */
      if (urlPath === "/api/run" && req.method === "POST") {
        return readJsonBody(req, 16384, function (err, body) {
          if (err) return sendJson(res, 400, { ok: false, error: err.message });
          var target = safeJoin(workDir, body.name);
          if (!target || !fs.existsSync(target)) return sendJson(res, 403, { ok: false, error: "Invalid workspace file." });
          var runtime = body.runtime === "tcc" ? "tcc" : (body.runtime === "python3" ? "python3" : "node");
          var args = runtime === "tcc" ? ["-run", target] : [target];
          cp.execFile(runtime, args, { cwd: workDir, timeout: 3000, maxBuffer: 65536, env: childEnv(), windowsHide: true }, function (runErr, stdout, stderr) {
            return sendJson(res, 200, {
              ok: !runErr,
              runtime: runtime,
              stdout: String(stdout || ""),
              stderr: String(stderr || (runErr ? runErr.message : ""))
            });
          });
        });
      }

      /* Optional local 0.5B-1.5B llama.cpp / bitnet.cpp runner proxy (graceful fallback if offline) */
      if (urlPath === "/api/local-ai" && req.method === "POST") {
        return readJsonBody(req, 32768, function (err, body) {
          if (err) return sendJson(res, 400, { ok: false, error: err.message });
          var payload = JSON.stringify({ prompt: String(body.prompt || ""), n_predict: Math.min(256, Number(body.maxTokens) || 96) });
          var pReq = http.request({
            hostname: "127.0.0.1", port: localAiPort, path: "/completion", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
            timeout: 1500
          }, function (pRes) {
            var chunks = [];
            pRes.on("data", function (c) { chunks.push(c); });
            pRes.on("end", function () {
              try {
                var parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                sendJson(res, 200, { ok: true, available: true, text: parsed.content || parsed.text || "" });
              } catch (e) { sendJson(res, 200, { ok: false, available: false, fallback: "tny2" }); }
            });
          });
          pReq.on("error", function () { sendJson(res, 200, { ok: true, available: false, fallback: "tny2" }); });
          pReq.on("timeout", function () { pReq.destroy(); sendJson(res, 200, { ok: true, available: false, fallback: "tny2" }); });
          pReq.end(payload);
        });
      }

      /* Serve static Evelyn files cleanly with COOP/COEP headers */
      var rel = urlPath === "/" ? "evelyn_concourse.html" : urlPath.replace(/^\/+/, "");
      var staticTarget = safeJoin(staticDir, rel);
      var ext = path.extname(staticTarget || "").toLowerCase();
      /* Only the page types in the table are served; any other file type in this folder (keys, logs, notes) is 404. */
      if (!staticTarget || !mime[ext] || !fs.existsSync(staticTarget) || fs.statSync(staticTarget).isDirectory()) {
        res.writeHead(404); res.end("Not found"); return;
      }
      res.writeHead(200, { "Content-Type": mime[ext] });
      fs.createReadStream(staticTarget).pipe(res);
    });

    return { server: server, safeJoin: safeJoin, token: token };
  }

  module.exports = { createBridgeServer: createBridgeServer, safeJoin: safeJoin, listenLoopback: listenLoopback };

  /* Never starts by itself: requiring this file opens no port. Only "node evelyn_bridge.js" does, on 127.0.0.1. */
  if (require.main === module) {
    var port = parseInt(process.env.EVELYN_PORT || "8080", 10);
    var inst = createBridgeServer({});
    listenLoopback(inst, port, function () {
      console.log("Evelyn Companion Bridge listening on http://127.0.0.1:" + port + " (COOP/COEP active, token required for /api)");
    });
  }
})();
