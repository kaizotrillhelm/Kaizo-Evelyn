function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(0, 11, 16);
  camera.lookAt(0, 0, 0);

  // Glowing sun
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffd27a,
      emissive: 0xff9922,
      emissiveIntensity: 2.0,
      roughness: 0.6,
      metalness: 0.0
    })
  );
  scene.add(sun);

  // Light at the sun
  const sunLight = new THREE.PointLight(0xfff1d6, 400, 0, 2);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x334466, 0.6));

  // Orbit helper (thin ring in the XZ plane)
  function makeOrbitRing(radius) {
    const segments = 128;
    const points = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x3a4a66, transparent: true, opacity: 0.7 });
    const ring = new THREE.LineLoop(geo, mat);
    scene.add(ring);
  }

  const planets = [];
  const configs = [
    { radius: 3.0, size: 0.40, speed: 0.9, phase: 0.0, color: 0x6fb7ff },
    { radius: 5.5, size: 0.55, speed: 0.55, phase: 2.1, color: 0xff9a5c },
    { radius: 8.0, size: 0.70, speed: 0.30, phase: 4.4, color: 0x9dff9d }
  ];

  for (const cfg of configs) {
    makeOrbitRing(cfg.radius);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.size, 24, 24),
      new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.7, metalness: 0.1 })
    );
    scene.add(mesh);
    planets.push({ mesh, radius: cfg.radius, speed: cfg.speed, phase: cfg.phase });
  }

  function update(t) {
    for (const p of planets) {
      const a = p.phase + p.speed * t;
      p.mesh.position.set(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
    }
    sun.material.emissiveIntensity = 2.0 + 0.4 * Math.sin(t * 2.0);
  }

  update(0);

  return { scene, camera, update };
}
