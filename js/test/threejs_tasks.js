/* threejs_tasks.js - three tasks, a shelf of verified three r187 notes, and the verifier call.
   Used by evelyn_threejs_bench.js (the comparison) and evelyn_inkling_tests.js (the verifier is tested on known code first). */
"use strict";
var path = require("path");
var cp = require("child_process");

var THREE_CJS = path.resolve(__dirname, "..", "..", "..", "CalderaWorld_2026-10-24", "node_modules", "three", "build", "three.cjs");
var WORKER = path.join(__dirname, "three_verify_worker.js");

var CONTRACT =
  "Write three.js r187 code. Reply with ONE fenced js code block that contains only a function buildScene(THREE). " +
  "It builds the scene from the THREE namespace it is given and returns { scene, camera, update }. update(t) takes the time " +
  "in seconds and sets all animated state as a pure function of t. No imports, no DOM, no renderer, no requestAnimationFrame, no Date.\nTask: ";

var TASKS = {
  cube: {
    title: "spinning cube",
    text: CONTRACT + "one lit cube (BoxGeometry) that spins: update(t) sets its rotation from t. Include a light and a PerspectiveCamera that sees the cube."
  },
  solar: {
    title: "solar system",
    text: CONTRACT + "a small solar system: a glowing sun (a sphere at the origin with an emissive material) and exactly three planets (spheres) on circular orbits " +
      "in the XZ plane around the sun, with orbit radii at least 1 unit apart, each moving at its own speed as a function of t. A light must be in the scene. No moons."
  },
  island: {
    title: "low-poly island with instanced trees",
    text: CONTRACT + "a low-poly island: a horizontal ground (PlaneGeometry, at least 20 by 20, receives shadows) and at least 30 trees drawn as ONE InstancedMesh " +
      "(use setMatrixAt for every instance, spread within 25 units of the origin, the trees cast shadows), a DirectionalLight with shadows on, " +
      "and a camera that looks at the island from above and to the side."
  }
};

/* verified notes about three r187, one shelf. Each one is a rule that holds for r187. */
var NOTES = [
  { shelf: "three", topic: "Geometry classes", fullText: "BoxGeometry(width, height, depth), SphereGeometry(radius, widthSegments, heightSegments), CylinderGeometry, ConeGeometry, PlaneGeometry(width, height), CircleGeometry, TorusGeometry. THREE.Geometry was removed in r125: every geometry is a BufferGeometry. A mesh is new THREE.Mesh(geometry, material)." },
  { shelf: "three", topic: "Plane ground horizontal", fullText: "A PlaneGeometry lies in the XY plane and faces +Z, so it stands upright. To make a ground that faces up, set mesh.rotation.x = -Math.PI / 2. A ground that should show shadows needs mesh.receiveShadow = true." },
  { shelf: "three", topic: "Lights and lit materials", fullText: "MeshStandardMaterial, MeshPhongMaterial and MeshLambertMaterial are black without a light in the scene; MeshBasicMaterial ignores lights. Add an AmbientLight or HemisphereLight plus a DirectionalLight or PointLight. Lights are Object3D: scene.add(light)." },
  { shelf: "three", topic: "Instanced mesh trees", fullText: "new THREE.InstancedMesh(geometry, material, count). For each instance i: dummy.position.set(x, y, z); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix), with dummy = new THREE.Object3D(). Then mesh.instanceMatrix.needsUpdate = true. mesh.count is the number of instances drawn. One InstancedMesh is one draw call." },
  { shelf: "three", topic: "Shadows", fullText: "Shadows need renderer.shadowMap.enabled = true, light.castShadow = true, mesh.castShadow = true on the objects that cast and mesh.receiveShadow = true on the ones that receive. A DirectionalLight shadow covers only its shadow camera box: set light.shadow.camera.left, right, top, bottom, near and far (for example -30, 30, 30, -30, 1, 80). InstancedMesh also has castShadow." },
  { shelf: "three", topic: "Animation as a function of time", fullText: "Do not read the clock inside the update. With the time t given: mesh.rotation.y = t * speed. A circular orbit in the XZ plane: planet.position.set(Math.cos(t * speed) * radius, 0, Math.sin(t * speed) * radius). The distance from the origin stays equal to radius at every t." },
  { shelf: "three", topic: "Orbit with a group", fullText: "Put a child mesh at x = radius inside a THREE.Group and rotate the group: group.rotation.y = t * speed. The child orbits the group's origin on a circle of that radius. Groups are added with scene.add(group); a child with group.add(mesh)." },
  { shelf: "three", topic: "Materials emissive glow color", fullText: "MeshStandardMaterial takes { color, emissive, emissiveIntensity, roughness, metalness }. A glowing sun: color 0xffcc00, emissive 0xffaa00, emissiveIntensity 1 or more. Colors are hex numbers or new THREE.Color(0xff8800). The scene background is scene.background = new THREE.Color(0x101820)." },
  { shelf: "three", topic: "Point light intensity", fullText: "Since r155 light intensities are physical. A PointLight(color, intensity, distance, decay) has decay 2 by default, so at a distance of 10 or more it needs an intensity in the hundreds or thousands to be visible, for example new THREE.PointLight(0xffffff, 3000, 0, 2). A DirectionalLight(color, intensity) has no falloff; an intensity of 2 to 4 is usual." },
  { shelf: "three", topic: "Camera placement", fullText: "new THREE.PerspectiveCamera(fov, aspect, near, far), for example (50, 16 / 9, 0.1, 200). Place it with camera.position.set(x, y, z) and aim it with camera.lookAt(0, 0, 0). A camera at the origin sits inside the scene's objects. For a view from above and to the side use a position such as (25, 20, 25)." }
];

/* run the generated code in a child with Node's permission model on (nothing may be written, opened or started) */
function verifyCode(task, code) {
  var r = cp.spawnSync(process.execPath, [
    "--permission", "--allow-fs-read=" + WORKER, "--allow-fs-read=" + path.dirname(THREE_CJS),
    WORKER, THREE_CJS, task
  ], { input: code, encoding: "utf8", timeout: 15000 });
  if (r.error) return { ok: false, errors: ["verifier could not run: " + r.error.message] };
  var line = (r.stdout || "").trim().split("\n").pop();
  try { return JSON.parse(line); } catch (e) { return { ok: false, errors: ["verifier gave no result: " + String((r.stderr || r.stdout || "").slice(0, 200))] }; }
}

module.exports = { TASKS: TASKS, NOTES: NOTES, verifyCode: verifyCode, THREE_CJS: THREE_CJS };
