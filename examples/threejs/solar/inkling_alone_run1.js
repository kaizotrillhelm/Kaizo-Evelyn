// Written by Inkling 2 Mini (Q4_K_M) for the task "Solar system".
// Condition: Inkling alone. Seed 1100. Run 1 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);

  const camera = new THREE.PerspectiveCamera(55, 16 / 10, 0.1, 200);
  camera.position.set(13, 10, 15);
  camera.lookAt(0, 0, 0);

  // Sun (emissive sphere at origin)
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0x1a0d00,
    emissive: 0xffb347,
    emissiveIntensity: 2.2
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.6, 48, 32), sunMat);
  scene.add(sun);

  // Lights
  const sunLight = new THREE.PointLight(0xffe6c0, 1.6, 0, 0);
  scene.add(sunLight);
  const ambient = new THREE.AmbientLight(0x334466, 0.7);
  scene.add(ambient);

  // Orbit rings
  function orbitRing(radius, color) {
    const pts = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 });
    return new THREE.LineLoop(geo, mat);
  }

  // Three planets on circular orbits in the XZ plane
  const planetDefs = [
    { r: 3.5, size: 0.45, color: 0x6fb3ff, speed: 0.9, phase: 0.0 },
    { r: 6.0, size: 0.60, color: 0xff9d5c, speed: 0.55, phase: 2.1 },
    { r: 8.5, size: 0.75, color: 0x8dff9e, speed: 0.32, phase: 4.4 }
  ];

  const planets = planetDefs.map((def) => {
    scene.add(orbitRing(def.r, 0x8899bb));
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: 0.6,
      metalness: 0.1
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.size, 32, 24), mat);
    scene.add(mesh);
    return { ...def, mesh };
  });

  function update(t) {
    for (const p of planets) {
      const a = p.phase + t * p.speed;
      p.mesh.position.set(Math.cos(a) * p.r, 0, Math.sin(a) * p.r);
      p.mesh.rotation.y = t * 0.8 + p.phase;
    }
    sunMat.emissiveIntensity = 2.1 + 0.5 * Math.sin(t * 2.0);
  }

  update(0);

  return { scene, camera, update };
}
