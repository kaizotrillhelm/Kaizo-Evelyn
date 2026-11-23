// Written by Inkling 2 Mini (Q4_K_M) for the task "Solar system".
// Condition: Inkling + Evelyn (loop with notes). Seed 1100. Run 1 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(25, 20, 25);
  camera.lookAt(0, 0, 0);

  // Light
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);
  const sunLight = new THREE.PointLight(0xffcc88, 2.5, 0, 1.5);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  // Sun
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      emissive: 0xffaa00,
      emissiveIntensity: 1.6,
      roughness: 0.6,
      metalness: 0
    })
  );
  scene.add(sun);

  // Orbits
  const orbitData = [
    { radius: 5, speed: 0.8, size: 0.9, color: 0x66aaff },
    { radius: 9, speed: 0.45, size: 1.3, color: 0xff8844 },
    { radius: 13, speed: 0.25, size: 1.6, color: 0x88dd88 }
  ];

  const orbitGroups = [];

  orbitData.forEach((d) => {
    // orbit ring (visual guide)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(d.radius - 0.05, d.radius + 0.05, 128),
      new THREE.MeshBasicMaterial({ color: 0x334455, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);

    const group = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(d.size, 32, 32),
      new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.7, metalness: 0.1 })
    );
    planet.position.set(d.radius, 0, 0);
    group.add(planet);
    scene.add(group);
    orbitGroups.push({ group, speed: d.speed });
  });

  function update(t) {
    for (const o of orbitGroups) {
      o.group.rotation.y = t * o.speed;
    }
  }

  return { scene, camera, update };
}
