/* mock_llm_server.js - a stand-in for llama-server / LM Studio for the tests: /v1/models and /v1/chat/completions, with CORS.
   node tests/mock_llm_server.js [port]   prints {"port":N}. The reply depends on the last user message:
   a question about "Brindlewick" gets the shelf fact back; a task that names a function gets a correct small function; anything else
   gets a short line. Nothing is sent anywhere else. */
"use strict";
var http = require("http");
var port = Number(process.argv[2] || 0);
var FENCE = String.fromCharCode(96, 96, 96);
var srv = http.createServer(function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.url === "/v1/models") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ data: [{ id: "mock-model" }, { id: "inkling" }] })); }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    var b = []; req.on("data", function (d) { b.push(d); });
    req.on("end", function () {
      var body = JSON.parse(Buffer.concat(b).toString("utf8")), msgs = body.messages, last = msgs[msgs.length - 1].content, first = msgs[msgs.length > 1 ? 1 : 0].content, text;
      if (/function\s+sumEven/.test(first)) text = "Here it is:\n" + FENCE + "js\nfunction sumEven(a) { var t = 0; for (var i = 0; i < a.length; i++) if (a[i] % 2 === 0) t += a[i]; return t; }\n" + FENCE;
      else if (/function\s+broken/.test(first) && msgs.length < 4) text = FENCE + "js\nfunction broken( { return 1;\n" + FENCE;
      else if (/function\s+broken/.test(first)) text = FENCE + "js\nfunction broken() { return 1; }\n" + FENCE;
      else if (/Brindlewick|bells/i.test(last)) text = "The harbour tower of Brindlewick has 17 bells [library#0].";
      else text = "ok";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { completion_tokens: text.length >> 2 }, _seen: { model: body.model, effort: body.reasoning_effort || (body.chat_template_kwargs || {}).reasoning_effort || null, system: msgs[0].content.slice(0, 200) } }));
    });
    return;
  }
  res.writeHead(404); res.end("{}");
});
srv.listen(port, "127.0.0.1", function () { console.log(JSON.stringify({ port: srv.address().port })); });
