// Written by Inkling 2 Mini (Q4_K_M) for the task "Solar system".
// Condition: Inkling + Evelyn (loop, no notes). Seed 1100. Run 1 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b16);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 9, 13);
  camera.lookAt(0, 0, 0);

  // --- Sun ---
  const sunGeo = new THREE.SphereGeometry(1, 48, 48);
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: 0xff9a2a,
    emissiveIntensity: 2.0,
    roughness: 1,
    metalness: 0
  });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  scene.add(sun);

  // --- Light ---
  const sunLight = new THREE.PointLight(0xffe3b3, 2.2, 0, 0);
  scene.add(sunLight);
  const ambient = new THREE.AmbientLight(0x334466, 0.6);
  scene.add(ambient);

  // --- Planets ---
  const planetDefs = [
    { orbitRadius: 3.0, size: 0.32, speed: 0.90, phase: 0.0, color: 0x6fa8dc },
    { orbitRadius: 4.7, size: 0.48, speed: 0.55, phase: 2.1, color: 0xe08e79 },
    { orbitRadius: 6.4, size: 0.72, speed: 0.33, phase: 4.2, color: 0xa88bd8 }
  ];

  const planets = [];

  for (const def of planetDefs) {
    // Orbit ring
    const ringPoints = [];
    const segments = 128;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(a) * def.orbitRadius, 0, Math.sin(a) * def.orbitRadius));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMat = new THREE.LineBasicMaterial({ color: 0x3a4a6a, transparent: true, opacity: 0.7 });
    const ring = new THREE.LineLoop(ringGeo, ringMat);
    scene.add(ring);

    // Planet sphere
    const geo = new THREE.SphereGeometry(def.size, 32, 32);
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: 0.85,
      metalness: 0.1
    });
    const planet = new THREE.Mesh(geo, mat);
    scene.add(planet);

    planets.push({ mesh: planet, def: def });
  }

  function update(t) {
    // Sun glow pulse (pure function of t)
    sunMat.emissiveIntensity = 2.0 + 0.5 * Math.sin(t * 2.0);
    const s = 1.0 + 0.03 * Math.sin(t * 2.0);
    sun.scale.set(s, s, s);

    // Planets on circular orbits in the XZ plane
    for (const p of planets) {
      const angle = p.def.phase + p.def.speed * t;
      p.mesh.position.set(
        Math.cos(angle) * p.def.orbitRadius,
        0,
        Math.sin(angle) * p.def.orbitRadius
      );
      p.mesh.rotation.y = angle * 2.0;
    }
  }

  update(0);

  return { scene, camera, update };
}
