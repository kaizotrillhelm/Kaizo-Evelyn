/* evelyn_skills_tests.js - registry, skills, the Caldera skill and the visual check.
   node js/test/evelyn_skills_tests.js
   Plain ES5. No GPU, no network, no model server: the model client is a stub and THREE is a tiny stand-in. */
"use strict";
var path = require("path");
var JS = path.join(__dirname, "..");
var S = require(path.join(JS, "evelyn_stream.js"));
var Reg = require(path.join(JS, "evelyn_registry.js"));
var Skills = require(path.join(JS, "evelyn_skills.js"));
var Caldera = require(path.join(JS, "skill_caldera_graphics.js"));
var VC = require(path.join(JS, "evelyn_visual_craft.js"));
var CodeLoop = require(path.join(JS, "evelyn_inkling_codeloop.js"));
var maker = require(path.join(JS, "..", "tools", "make_test_model.js"));

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function assert(c, m) { if (!c) throw new Error(m || "assertion failed"); }
function assertEq(a, b, m) { if (a !== b) throw new Error((m ? m + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }

/* ---------------- registry ---------------- */
function toAB(buf) { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }
var binA = maker.build({ seed: 11 }), binB = maker.build({ seed: 12 });
var files = { "tutor.bin": toAB(binA), "router_inkling.bin": toAB(binB), "router_any.bin": toAB(binA) };
function reg(tier, extra) {
  var r = new Reg.BinRegistry({ tier: tier, readFile: function (f) { return files[f]; } });
  r.loadManifest({ bins: [
    { id: "tutor1", role: "tutor", backend: "*", file: "tutor.bin", format: "TNY2", minTier: "potato", priority: 1 },
    { id: "router_any", role: "router", backend: "*", file: "router_any.bin", format: "TNY2", minTier: "potato", priority: 1 },
    { id: "router_ink", role: "router", backend: "inkling", file: "router_inkling.bin", format: "TNY2", minTier: "standard", priority: 1, crc32: S.crc32(new Uint8Array(files["router_inkling.bin"])) }
  ].concat(extra || []) });
  return r;
}

test("tiers lock the heavy features on a potato", function () {
  assert(Reg.hasFeature("potato", "solo_tutor"));
  assert(!Reg.hasFeature("potato", "code_loop"));
  assert(!Reg.hasFeature("standard", "local_gguf"));
  assert(Reg.hasFeature("workstation", "local_gguf"));
  var threw = false;
  try { Reg.requireFeature("potato", "visual_verifier"); } catch (e) { threw = true; }
  assert(threw, "requireFeature must throw on a locked feature");
});

test("backend profiles format effort for each model", function () {
  var ink = Reg.getBackend("inkling").formatEffort(0.3, { chat_template_kwargs: { x: 1 } });
  assertEq(ink.chat_template_kwargs.reasoning_effort, 0.3);
  assertEq(ink.chat_template_kwargs.x, 1, "extra kwargs kept");
  assertEq(Reg.getBackend("qwen").formatEffort(0.0).chat_template_kwargs.enable_thinking, false);
  assertEq(Reg.getBackend("qwen").formatEffort(0.7).chat_template_kwargs.enable_thinking, true);
  assertEq(Reg.getBackend("muse").formatEffort("high").reasoning_effort, "high");
  assertEq(Reg.getBackend("unknown-model").name, "inkling", "unknown backends fall back to inkling");
  Reg.registerBackend("tmp", { name: "tmp" });
  assertEq(Reg.getBackend("TMP").name, "tmp");
});

test("registry: exact backend beats wildcard; tier filters; no match gives null", function () {
  assertEq(reg("standard").resolve("router", "inkling").id, "router_ink");
  assertEq(reg("standard").resolve("router", "qwen").id, "router_any", "wildcard for another backend");
  assertEq(reg("potato").resolve("router", "inkling").id, "router_any", "the standard-only bin is not allowed on a potato");
  assertEq(reg("standard").resolve("critic", "inkling"), null);
});

test("registry: loads, caches, checks CRC32 and size", function () {
  var r = reg("standard"), a = r.getModel("router", "inkling"), b = r.getModel("router", "inkling");
  assert(a && a.model && a.model.loaded, "model loaded");
  assert(a === b, "cached");
  assertEq(reg("standard").getModel("critic", "inkling"), null);
  var bad = reg("standard", [{ id: "badcrc", role: "expander", backend: "*", file: "tutor.bin", format: "TNY2", minTier: "potato", crc32: 123 }]);
  var threw = false;
  try { bad.getModel("expander", "x"); } catch (e) { threw = /CRC32/.test(e.message); }
  assert(threw, "wrong CRC32 must throw");
  var tiny = new Reg.BinRegistry({ tier: "potato", readFile: function () { return new ArrayBuffer(3 * 1024 * 1024); } });
  tiny.register({ id: "big", role: "tutor", backend: "*", file: "x", format: "TNY2", minTier: "potato" });
  threw = false;
  try { tiny.getModel("tutor", "x"); } catch (e2) { threw = /exceeds/.test(e2.message); }
  assert(threw, "a bin over the tier limit must throw");
  var fmt = reg("standard", [{ id: "tny3", role: "tutor", backend: "inkling", file: "tutor.bin", format: "TNY3", minTier: "potato", priority: 50 }]);
  threw = false;
  try { fmt.getModel("tutor", "inkling"); } catch (e3) { threw = /not supported/.test(e3.message); }
  assert(threw, "TNY3 is not loadable yet");
});

test("registry: the potato tier installs the integer math", function () {
  var r = reg("potato"), m = r.getModel("tutor", "any");
  assert(m.model._potato, "EvelynPotato installed on the potato tier");
});

/* ---------------- skills ---------------- */
test("tokenizer splits camelCase and snake_case and keeps the identifier", function () {
  var t = Skills.tokenizeCodeText("cam_guard OffsetShelfStore");
  assert(t.indexOf("cam") >= 0 && t.indexOf("guard") >= 0 && t.indexOf("offset") >= 0 && t.indexOf("shelf") >= 0 && t.indexOf("store") >= 0);
  assert(Skills.tokenizeCodeText("constructor valueOf").indexOf("constructor") >= 0, "words that are Object.prototype names are ordinary words");
});

test("shelf store indexes the whole text, checks CRC32, and ranks by topic", function () {
  var st = new Skills.SkillShelfStore();
  var long = new Array(60).join("filler ") + " zanzibarword at the very end";
  st.buildFromRecords([
    { shelf: "s", topic: "alpha topic", fullText: "first note about alpha" },
    { shelf: "s", topic: "long note", fullText: long },
    { shelf: "s", topic: "beta", fullText: "second note about beta zanzibarword" }
  ]);
  var h = st.searchFull("zanzibarword", 3);
  assert(h.length === 2, "a word far past 240 characters is found");
  var sc = st.searchScored("alpha", 2);
  assert(sc.hits && sc.hits[0].topic === "alpha topic" && typeof sc.topScore === "number" && typeof sc.relGap === "number", "searchScored has the OffsetShelfStore shape");
  st.blob[0] ^= 0x55;
  var threw = false;
  try { st.readFullText(0); } catch (e) { threw = /CRC32/.test(e.message); }
  assert(threw, "a changed byte is caught");
});

test("SKILL.md parser: frontmatter, invariants and cards", function () {
  var md = "---\nname: demo\ndescription: a demo\ntriggers: foo, bar baz\neffort: 0.25\n---\n## Invariants\n- never do x\n- always do y\n## Card One\nthe first card text\n## Card Two\nthe second card text\n";
  var sk = Skills.parseSkillMarkdown(md);
  assertEq(sk.name, "demo");
  assertEq(sk.triggers.length, 2);
  assertEq(sk.invariants.length, 2);
  assertEq(sk.records.length, 2);
  assertEq(sk.effortWithNotes, 0.25);
  var r = new Skills.SkillRegistry();
  r.registerMarkdown(md);
  var pkt = r.prepare("please change foo now", { topK: 1 });
  assertEq(pkt.activeSkills[0], "demo");
  assert(/never do x/.test(pkt.systemAddition));
});

test("Caldera skill: progressive disclosure on real tasks", function () {
  var r = new Skills.SkillRegistry();
  Caldera.registerCalderaGraphicsSkill(r);
  var none = r.prepare("write a binary search in C", {});
  assertEq(none.activeSkills.length, 0);
  assertEq(none.systemAddition, "");
  assertEq(none.store, null);
  var p1 = r.prepare("Wire cam_guard.py into render_episode.py refusal, pass real actors so K02 fires, and audit the 9:16 vertical camera.", { topK: 2 });
  assertEq(p1.activeSkills[0], "caldera-graphics");
  assertEq(p1.invariants.length, 6);
  assert(p1.excerpts.length === 2 && p1.excerpts[0].fullText.length > 0, "two cards");
  assert(p1.verifiers.some(function (v) { return v.cmd === "node tools/test_camguard.mjs"; }), "camguard suite routed");
  assert(p1.verifiers.some(function (v) { return v.cmd === "node tools/test_orientation.mjs"; }), "orientation suite routed");
  assertEq(p1.suggestedEffort, 0.30);
  var p3 = r.prepare("Rebuild the Rust WASM crate in worldconv/rust/ to expose the spectral tracer in pt.rs keeping JS twin parity", { topK: 2 });
  assert(p3.excerpts.some(function (e) { return e.shelf === "caldera_compute" || e.shelf === "caldera_rays"; }), "compute or rays shelf found");
  var p2 = r.prepare("Add an 80s OVA look pass to ovalook.ui()", { topK: 1 });
  assertEq(p2.excerpts[0].shelf, "caldera_looks");
  var gpu = r.prepare("check the WGSL cloud shader on caldera", { topK: 1 });
  assert(gpu.verifiers.some(function (v) { return v.requiresApproval; }), "the GPU check asks for approval");
});

test("skill store works as the store of EvelynCodeLoop", function (done) {
  var r = new Skills.SkillRegistry();
  Caldera.registerCalderaGraphicsSkill(r);
  var pkt = r.prepare("Add an 80s OVA look pass to ovalook.ui() in caldera", { topK: 2 }), seen = null;
  var client = { lastUsage: null, chat: function (messages, effort, cb) { seen = { messages: messages, effort: effort }; cb(null, "```js\nvar x = 1;\n```"); } };
  var loop = new CodeLoop.EvelynCodeLoop({
    store: pkt.store, client: client, verify: function () { return { ok: true, errors: [] }; },
    system: VC.VISUAL_SYSTEM + "\n\n" + pkt.systemAddition, scheduleWith: [pkt.suggestedEffort, 0.15, 0.05]
  });
  loop.run("Add an 80s OVA look pass to ovalook.ui() in caldera", function (err, res) {
    try {
      assert(!err, String(err));
      assert(res.ok && res.hits >= 1, "hits found through the skill store");
      assertEq(seen.effort, 0.30);
      assert(/Verified notes:/.test(seen.messages[1].content), "notes are in the prompt");
      assert(/Hard invariants/.test(seen.messages[0].content), "invariants are in the system prompt");
      done();
    } catch (e) { done(e); }
  });
});

/* ---------------- visual check ---------------- */
function V3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
V3.prototype.project = function (cam) { var d = cam.dist - this.z; this.x = this.x / (d * cam.k); this.y = this.y / (d * cam.k); return this; };
function Box3() { this.min = new V3(1e9, 1e9, 1e9); this.max = new V3(-1e9, -1e9, -1e9); }
Box3.prototype.isEmpty = function () { return this.max.x < this.min.x; };
Box3.prototype.expandByObject = function (o) {
  var h = o.half || 1;
  this.min = new V3(Math.min(this.min.x, -h), Math.min(this.min.y, -h), Math.min(this.min.z, -h));
  this.max = new V3(Math.max(this.max.x, h), Math.max(this.max.y, h), Math.max(this.max.z, h));
};
var THREE = { Vector3: V3, Box3: Box3, BackSide: 1 };
function fakeScene(objs, fog) {
  return { fog: fog || null, updateMatrixWorld: function () {}, traverse: function (fn) { objs.forEach(fn); } };
}
function cam(dist) { return { dist: dist, k: 1, updateMatrixWorld: function () {} }; }
var STD = { side: 0 }, BASIC = { isMeshBasicMaterial: true, side: 0 };

test("visual check passes a lit, atmospheric, well framed scene", function () {
  var s = fakeScene([
    { isMesh: true, geometry: {}, material: STD, half: 1 },
    { isDirectionalLight: true, intensity: 3 }, { isAmbientLight: true, intensity: 0.1 }, { isPoints: true }
  ]);
  assertEq(VC.verifySceneVisuals(THREE, s, cam(3)).length, 0);
});

test("visual check names each flaw", function () {
  var flat = fakeScene([{ isMesh: true, geometry: {}, material: BASIC, half: 1 }]);
  var e = VC.verifySceneVisuals(THREE, flat, cam(3)).join("\n");
  assert(/no PointLight/.test(e) && /flat MeshBasicMaterial/.test(e) && /atmospheric depth/.test(e), "no light, flat material, no atmosphere");
  var washed = fakeScene([
    { isMesh: true, geometry: {}, material: STD, half: 1 }, { isPointLight: true, intensity: 2 },
    { isAmbientLight: true, intensity: 1.5 }, { isPoints: true }
  ]);
  assert(/ambient/.test(VC.verifySceneVisuals(THREE, washed, cam(3)).join("")), "ambient too strong");
  var far = fakeScene([{ isMesh: true, geometry: {}, material: STD, half: 1 }, { isPointLight: true, intensity: 3 }, { isPoints: true }]);
  assert(/fills only/.test(VC.verifySceneVisuals(THREE, far, cam(40)).join("")), "subject too small");
  var fogged = fakeScene([{ isMesh: true, geometry: {}, material: STD, half: 1 }, { isPointLight: true, intensity: 3 }], {});
  assertEq(VC.verifySceneVisuals(THREE, fogged, cam(3)).length, 0, "fog counts as atmosphere");
  assertEq(VC.verifySceneVisuals(THREE, fakeScene([{ isMesh: true, geometry: {}, material: STD, half: 1 }, { isPointLight: true, intensity: 3 }]), cam(3), { requireAtmosphere: false }).length, 0);
});

test("visual check ignores a BackSide sky dome when framing", function () {
  var s = fakeScene([
    { isMesh: true, geometry: {}, material: STD, half: 1 }, { isMesh: true, geometry: {}, material: { side: 1 }, half: 500 },
    { isPointLight: true, intensity: 3 }, { isPoints: true }
  ]);
  assertEq(VC.verifySceneVisuals(THREE, s, cam(3)).length, 0);
});

test("craft notes and system prompt contain no backticks", function () {
  var all = VC.VISUAL_SYSTEM + JSON.stringify(VC.THREE_VISUAL_CRAFT_NOTES) + JSON.stringify(Caldera.CALDERA_GRAPHICS_SKILL);
  assert(all.indexOf(String.fromCharCode(96)) < 0, "no backtick in the shipped text");
  assertEq(VC.THREE_VISUAL_CRAFT_NOTES.length, 2);
});

var passed = 0, failed = 0, idx = 0;
function next() {
  if (idx >= tests.length) {
    console.log("\n=== SKILLS AND REGISTRY SUITE: " + passed + " passed, " + failed + " failed ===");
    process.exit(failed > 0 ? 1 : 0);
  }
  var cur = tests[idx++], fin = false;
  function done(err) {
    if (fin) return; fin = true;
    if (err) { failed++; console.log("[FAIL] " + cur.name + "\n       " + (err.stack || err)); }
    else { passed++; console.log("[PASS] " + cur.name); }
    setTimeout(next, 0);
  }
  try { if (cur.fn.length) cur.fn(done); else { cur.fn(); done(); } } catch (e) { done(e); }
}
console.log("=== EVELYN SKILLS, REGISTRY AND VISUAL CHECK TESTS (" + tests.length + ") ===");
next();
