function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 12, 18);
  camera.lookAt(0, 0, 0);

  // Lights
  const sunLight = new THREE.PointLight(0xffe0a0, 200, 0, 2);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  const ambient = new THREE.AmbientLight(0x223344, 0.6);
  scene.add(ambient);

  // Sun
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffcc44,
      emissive: 0xffaa22,
      emissiveIntensity: 2.0,
      roughness: 1,
      metalness: 0
    })
  );
  scene.add(sun);

  // Planets: radii at least 1 unit apart
  const planetDefs = [
    { radius: 3.0, size: 0.35, speed: 0.9, phase: 0.0, color: 0x4fa3ff },
    { radius: 5.5, size: 0.5, speed: 0.55, phase: 2.1, color: 0xff7a4f },
    { radius: 8.5, size: 0.7, speed: 0.32, phase: 4.2, color: 0x7ee08a }
  ];

  const planets = [];

  // Orbit rings
  planetDefs.forEach((def) => {
    const ringGeo = new THREE.RingGeometry(def.radius - 0.03, def.radius + 0.03, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x334455,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
  });

  planetDefs.forEach((def) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.size, 24, 24),
      new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.8,
        metalness: 0.1
      })
    );
    scene.add(mesh);
    planets.push({ mesh, ...def });
  });

  function update(t) {
    for (const p of planets) {
      const a = p.speed * t + p.phase;
      p.mesh.position.set(p.radius * Math.cos(a), 0, p.radius * Math.sin(a));
      p.mesh.rotation.y = a * 2;
    }
  }

  update(0);

  return { scene, camera, update };
}
