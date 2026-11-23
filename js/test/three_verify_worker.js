/* three_verify_worker.js - runs generated three.js code against the real three r187 and checks what it built.
   Started by evelyn_threejs_bench.js as:
     node --permission --allow-fs-read=<this file> --allow-fs-read=<three build folder> three_verify_worker.js <three.cjs> <task>
   with the code on stdin. Node's permission model is on, so the code cannot write files, open sockets or start programs.
   Prints one JSON line: { ok, errors: [...] }. No renderer and no GPU: only the scene graph is built and measured. */
"use strict";
var vm = require("vm");

var threePath = process.argv[2], task = process.argv[3];
var THREE = require(threePath);

var chunks = [];
process.stdin.on("data", function (d) { chunks.push(d); });
process.stdin.on("end", function () {
  var code = Buffer.concat(chunks).toString("utf8"), errors = [], warns = [];
  var realWarn = console.warn, realErr = console.error;
  console.warn = function () { warns.push(Array.prototype.join.call(arguments, " ")); };
  console.error = function () { warns.push(Array.prototype.join.call(arguments, " ")); };
  function out() {
    console.warn = realWarn; console.error = realErr;
    process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors: errors.slice(0, 10) }) + "\n");
  }
  var fn;
  try {
    fn = vm.runInNewContext(code + "\n;typeof buildScene === 'function' ? buildScene : null", { Math: Math, console: { log: function () {}, warn: function () {}, error: function () {} } }, { timeout: 3000 });
  } catch (e) { errors.push("the code did not load: " + String(e && e.message || e).slice(0, 160)); return out(); }
  if (typeof fn !== "function") { errors.push("the code does not define a function named buildScene"); return out(); }

  var r;
  try { r = fn(THREE); } catch (e2) { errors.push("buildScene(THREE) threw: " + String(e2 && e2.message || e2).slice(0, 200)); return out(); }
  if (!r || typeof r !== "object") { errors.push("buildScene must return { scene, camera, update }"); return out(); }
  if (!r.scene || !r.scene.isScene) errors.push("the returned scene is not a THREE.Scene");
  if (!r.camera || !r.camera.isCamera) errors.push("the returned camera is not a THREE camera");
  if (typeof r.update !== "function") errors.push("the returned update is not a function");
  if (errors.length) return out();

  function call(t) { try { r.update(t); return true; } catch (e3) { errors.push("update(" + t + ") threw: " + String(e3 && e3.message || e3).slice(0, 160)); return false; } }
  function meshes(pred) { var a = []; r.scene.traverse(function (o) { if (o.isMesh && (!pred || pred(o))) a.push(o); }); return a; }
  function lights() { var a = []; r.scene.traverse(function (o) { if (o.isLight) a.push(o); }); return a; }
  function wp(o) { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); }
  function finite(label) {
    var bad = 0;
    r.scene.updateMatrixWorld(true);
    r.scene.traverse(function (o) {
      var p = o.position, s = o.scale, q = o.rotation;
      if (![p.x, p.y, p.z, s.x, s.y, s.z, q.x, q.y, q.z].every(isFinite)) bad++;
    });
    if (bad) errors.push(bad + " object(s) have a position, scale or rotation that is not a finite number " + label);
  }
  function geo(o, type) { return o.geometry && o.geometry.type === type; }

  if (!call(0)) return out();
  finite("after update(0)");

  if (task === "cube") {
    var box = meshes(function (o) { return geo(o, "BoxGeometry"); })[0];
    if (!box) errors.push("no Mesh with a BoxGeometry in the scene");
    if (!lights().length) errors.push("no light in the scene (a lit material would be black)");
    if (box) {
      var a = [box.rotation.x, box.rotation.y, box.rotation.z];
      if (call(1)) {
        var moved = Math.abs(box.rotation.x - a[0]) + Math.abs(box.rotation.y - a[1]) + Math.abs(box.rotation.z - a[2]);
        if (moved < 1e-3) errors.push("the cube's rotation is the same after update(0) and update(1)");
        finite("after update(1)");
      }
    }
  } else if (task === "solar") {
    var spheres = meshes(function (o) { return geo(o, "SphereGeometry"); });
    if (spheres.length !== 4) errors.push("expected exactly 4 SphereGeometry meshes (a sun and 3 planets), found " + spheres.length);
    else {
      var sun = null, planets = [];
      spheres.forEach(function (m) { if (wp(m).length() < 1e-6) sun = m; else planets.push(m); });
      if (!sun) errors.push("no sphere at the origin for the sun at t = 0");
      else if (planets.length !== 3) errors.push("expected 3 planets away from the sun, found " + planets.length);
      else {
        var d0 = planets.map(function (m) { return wp(m).length(); }), p0 = planets.map(wp);
        var sorted = d0.slice().sort(function (x, y) { return x - y; }), distinct = true;
        for (var i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] < 1) distinct = false;
        if (!distinct) errors.push("the three orbit radii are not at least 1 unit apart: " + sorted.map(function (x) { return x.toFixed(2); }).join(", "));
        if (call(2)) {
          if (wp(sun).length() > 1e-6) errors.push("the sun is not at the origin at t = 2");
          planets.forEach(function (m, k) {
            var p = wp(m), moved2 = p.distanceTo(p0[k]), d2 = p.length();
            if (moved2 < 1e-3) errors.push("planet " + (k + 1) + " does not move between update(0) and update(2)");
            else if (Math.abs(d2 - d0[k]) / d0[k] > 0.02) errors.push("planet " + (k + 1) + " does not keep its orbit radius (" + d0[k].toFixed(2) + " then " + d2.toFixed(2) + ")");
            if (Math.abs(p.y - p0[k].y) > 1e-3) errors.push("planet " + (k + 1) + " leaves the XZ plane");
          });
          finite("after update(2)");
        }
      }
    }
    if (!lights().length) errors.push("no light in the scene");
  } else if (task === "island") {
    var grounds = meshes(function (o) { return geo(o, "PlaneGeometry"); });
    if (!grounds.length) errors.push("no PlaneGeometry ground");
    else {
      var g = grounds[0];
      g.updateWorldMatrix(true, false);
      var q = new THREE.Quaternion(); g.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      var n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      if (n.y < 0.9) errors.push("the PlaneGeometry ground is not horizontal facing up (its normal has y = " + n.y.toFixed(2) + "; a plane starts vertical)");
      var par = g.geometry.parameters || {};
      if (!(par.width >= 20 && par.height >= 20)) errors.push("the ground is smaller than 20 by 20");
      if (!g.receiveShadow) errors.push("the ground does not receive shadows");
    }
    var inst = null;
    r.scene.traverse(function (o) { if (o.isInstancedMesh && !inst) inst = o; });
    if (!inst) errors.push("no InstancedMesh for the trees");
    else {
      if (inst.count < 30) errors.push("the InstancedMesh holds " + inst.count + " instances, at least 30 are needed");
      var arr = inst.instanceMatrix.array, seen = {}, distinctN = 0, far = 0, nonfinite = 0;
      for (var k2 = 0; k2 < inst.count; k2++) {
        var x = arr[k2 * 16 + 12], y = arr[k2 * 16 + 13], z = arr[k2 * 16 + 14];
        if (![x, y, z].every(isFinite)) { nonfinite++; continue; }
        var key = x.toFixed(1) + "," + z.toFixed(1);
        if (!seen[key]) { seen[key] = 1; distinctN++; }
        if (Math.abs(x) > 25 || Math.abs(z) > 25) far++;
      }
      if (nonfinite) errors.push(nonfinite + " tree instance matrices are not finite");
      if (distinctN < 10) errors.push("only " + distinctN + " different tree positions (setMatrixAt was probably not called for each instance)");
      if (far) errors.push(far + " trees stand more than 25 units from the origin");
      if (!inst.castShadow) errors.push("the trees (InstancedMesh) do not cast shadows");
    }
    var sunL = lights().filter(function (l) { return l.isDirectionalLight; })[0];
    if (!sunL) errors.push("no DirectionalLight");
    else if (!sunL.castShadow) errors.push("the DirectionalLight does not cast shadows");
    if (r.camera.position.length() < 1) errors.push("the camera stands at the origin, inside the island");
  } else { errors.push("unknown task " + task); }

  if (warns.length) errors.push("three.js warned: " + warns[0].slice(0, 160));
  out();
});
