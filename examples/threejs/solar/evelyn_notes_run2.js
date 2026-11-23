// Written by Inkling 2 Mini (Q4_K_M) for the task "Solar system".
// Condition: Inkling + Evelyn (loop with notes). Seed 1101. Run 2 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(25, 20, 25);
  camera.lookAt(0, 0, 0);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const sunLight = new THREE.PointLight(0xffcc66, 2.2, 0, 1.6);
  scene.add(sunLight);

  const directional = new THREE.DirectionalLight(0xffffff, 0.6);
  directional.position.set(30, 40, 20);
  scene.add(directional);

  // Sun
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      emissive: 0xffaa00,
      emissiveIntensity: 1.6,
      roughness: 0.7,
      metalness: 0.0
    })
  );
  scene.add(sun);

  // Planets: radius, speed, color
  const planetDefs = [
    { radius: 6, speed: 0.8, size: 0.9, color: 0x4fa3ff },
    { radius: 9, speed: 0.45, size: 1.2, color: 0xff7a4f },
    { radius: 12, speed: 0.25, size: 1.0, color: 0x7dff9a }
  ];

  const orbitGroups = [];

  planetDefs.forEach((def) => {
    const group = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(def.size, 24, 24),
      new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.color,
        emissiveIntensity: 0.15,
        roughness: 0.6,
        metalness: 0.2
      })
    );
    planet.position.set(def.radius, 0, 0);
    group.add(planet);
    scene.add(group);
    orbitGroups.push({ group, speed: def.speed });

    // Orbit guide ring (visual only)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(def.radius - 0.05, def.radius + 0.05, 128),
      new THREE.MeshBasicMaterial({ color: 0x335577, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
  });

  function update(t) {
    orbitGroups.forEach(({ group, speed }) => {
      group.rotation.y = t * speed;
    });
  }

  return { scene, camera, update };
}
