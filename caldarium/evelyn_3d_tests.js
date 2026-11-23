/* evelyn_3d_tests.js - Automated ES5 Tests for Evelyn3D Software Engine
   Run in Node.js: node evelyn_3d_tests.js */
(function (root) {
  "use strict";

  var isNode = (typeof module !== "undefined" && typeof require === "function");
  if (isNode) require("./evelyn_3d.js");

  var E3 = root.Evelyn3D;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
  function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + " - " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
  }

  /* 1. Wavefront .OBJ parser (quads, texture/normal slashes, negative indices) & export round-trip */
  test("OBJ Codec: Parses quads, slash indices, negative indices, rejects malformed OBJ & round-trips", function (done) {
    var quadObj = [
      "# Simple 3D quad panel",
      "v -1 -1 0", "v 1 -1 0", "v 1 1 0", "v -1 1 0",
      "f 1/1/1 2/2/1 3/3/1 4/4/1"
    ].join("\n");
    var parsed = E3.parseOBJ(quadObj);
    assert(parsed.ok, "Valid quad OBJ failed: " + parsed.error);
    assertEq(parsed.mesh.vertexCount, 4, "Expected 4 vertices");
    assertEq(parsed.mesh.triCount, 2, "1 quad should triangulate into 2 triangles");

    var exported = E3.exportOBJ(parsed.mesh, "Panel");
    var reparsed = E3.parseOBJ(exported);
    assert(reparsed.ok && reparsed.mesh.triCount === 2, "OBJ export/reparse round-trip failed");

    assert(!E3.parseOBJ("").ok, "Empty OBJ must fail");
    assert(!E3.parseOBJ("v 0 0 0\nf 1 2 99").ok, "Out-of-bounds face index must fail");
    done();
  });

  /* 2. Focal-length projection math (135mm telephoto magnifies more than 24mm wide-angle) */
  test("Camera3D: Telephoto 135mm magnifies off-axis points wider than 24mm wide-angle lens", function (done) {
    var wideCam = new E3.Camera3D({ z: -5, focalMm: 24 });
    var teleCam = new E3.Camera3D({ z: -5, focalMm: 135 });
    var pWide = wideCam.project(1, 0, 0, 160, 120);
    var pTele = teleCam.project(1, 0, 0, 160, 120);
    assert(pTele.sx > pWide.sx, "Telephoto should project x=1 farther from center than wide-angle");
    assertEq(wideCam.project(0, 0, -6, 160, 120), null, "Point behind camera must clip cleanly to null");
    done();
  });

  /* 3. Z-Buffer Occlusion: Closer red cube stays in front even when drawn BEFORE farther cyan cube */
  test("SoftwareRenderer3D: Z-buffer keeps closer mesh in front regardless of draw order", function (done) {
    var ren = new E3.SoftwareRenderer3D(120, 90);
    var cam = new E3.Camera3D({ z: -6, focalMm: 50 });
    var cube = E3.makeCube(2);

    ren.clear(0xFF000000);
    /* Draw NEAR pink/red cube FIRST at z=-2, then FAR cyan cube SECOND at z=+2 */
    ren.drawMesh(cube, { x: 0, y: 0, z: -2, rx: 0, ry: 0 }, cam, [252, 72, 232]);
    var centerIdx = Math.floor(90 / 2) * 120 + Math.floor(120 / 2);
    var nearPixel = ren.pixels[centerIdx];
    assert(nearPixel !== 0xFF000000, "Near cube should cover screen center");

    ren.drawMesh(cube, { x: 0, y: 0, z: 2, rx: 0, ry: 0 }, cam, [40, 228, 252]);
    assertEq(ren.pixels[centerIdx], nearPixel, "Far cube overwrote closer cube — Z-buffer failed");
    assert(ren.lastStats.culledTris > 0, "Backface culling should skip hidden back triangles");
    done();
  });

  /* 4. 2.5D Raycaster hits exact wall distance inside Room P-1 Maze layout */
  test("Raycaster25D: Exact DDA distance and tile detection inside Room P-1 Maze", function (done) {
    var maze = [
      "###########",
      "#P..#..G..#",
      "#.#.#.###.#",
      "#.#...#...#",
      "###########"
    ];
    /* Player at (1.5, 1.5) looking east (+X) -> wall '#' is at column 4 (x=4.0), distance = 2.5 */
    var hit = E3.Raycaster25D.castRay(maze, 1.5, 1.5, 1, 0, 20);
    assert(hit.hit && hit.tile === "#" && Math.abs(hit.dist - 2.5) < 0.01, "Expected wall at 2.5 units, got " + hit.dist);
    done();
  });

  /* 5. CPU Speed Budget: 60 frames of rotating 3D spaceship + cube at 160x120 */
  test("Perf Budget: 60 full Z-buffered 3D frames at 160x120 run fast on CPU", function (done) {
    var ren = new E3.SoftwareRenderer3D(160, 120);
    var cam = new E3.Camera3D({ z: -6, focalMm: 45 });
    var cube = E3.makeCube(1.8), glider = E3.makeGlider();
    var t0 = Date.now();
    for (var f = 0; f < 60; f++) {
      ren.clear();
      ren.drawMesh(cube, { x: -1.2, y: 0, z: 1.0, rx: f * 0.04, ry: f * 0.06 }, cam, [40, 228, 252]);
      ren.drawMesh(glider, { x: 1.0, y: 0.2, z: -0.5, rx: 0.2, ry: f * 0.08 }, cam, [72, 252, 168]);
    }
    var dt = Date.now() - t0;
    assert(dt < 2500, "60 software 3D frames exceeded budget: " + dt + " ms");
    done();
  });

  /* 6. ES5 Audit */
  if (isNode) {
    test("ES5 Audit: Zero ES6+ syntax in evelyn_3d.js and evelyn_3d_tests.js", function (done) {
      var fs = require("fs"), path = require("path");
      var files = ["evelyn_3d.js", "evelyn_3d_tests.js"];
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
      console.log("\n=== EVELYN 3D ENGINE RESULT: " + pass + " passed, " + fail + " failed ===");
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
  console.log("=== EVELYN 3D SOFTWARE ENGINE & RAYCASTER TESTS (" + tests.length + ") ===");
  next();
})(typeof window !== "undefined" ? window : global);
