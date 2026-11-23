function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 200);
  camera.position.set(11, 9, 13);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  const sunLight = new THREE.PointLight(0xffd27a, 900, 0, 2);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(8, 12, 6);
  scene.add(dir);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.25, 48, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      emissive: 0xffaa00,
      emissiveIntensity: 1.6,
      roughness: 0.6,
      metalness: 0.0
    })
  );
  scene.add(sun);

  const planetDefs = [
    { radius: 3.4, size: 0.42, speed: 0.9, phase: 0.0, color: 0x6fb1ff, emissive: 0x113355 },
    { radius: 5.6, size: 0.58, speed: 0.55, phase: 2.1, color: 0xff8a5c, emissive: 0x331100 },
    { radius: 8.0, size: 0.50, speed: 0.32, phase: 4.2, color: 0x9be07a, emissive: 0x113311 }
  ];

  const planets = planetDefs.map((def) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.size, 32, 24),
      new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.emissive,
        emissiveIntensity: 0.35,
        roughness: 0.75,
        metalness: 0.05
      })
    );
    scene.add(mesh);
    return { mesh, ...def };
  });

  function update(t) {
    sun.material.emissiveIntensity = 1.45 + 0.35 * Math.sin(t * 2.0);

    for (const p of planets) {
      const a = t * p.speed + p.phase;
      p.mesh.position.set(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
      p.mesh.rotation.y = t * p.speed * 2.0;
    }
  }

  update(0);

  return { scene, camera, update };
}
