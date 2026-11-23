function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 14, 22);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sunLight = new THREE.PointLight(0xffcc88, 2, 0);
  scene.add(sunLight);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(10, 20, 10);
  scene.add(dir);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 1.6, roughness: 0.6, metalness: 0 })
  );
  scene.add(sun);

  const planetDefs = [
    { radius: 4.5, size: 0.55, speed: 0.9, color: 0x66aaff, emissive: 0x113355 },
    { radius: 7.5, size: 0.8, speed: 0.5, color: 0xff8844, emissive: 0x331100 },
    { radius: 10.5, size: 0.65, speed: 0.28, color: 0x88dd88, emissive: 0x113311 }
  ];

  const planets = planetDefs.map((def) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.size, 24, 24),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.emissive, emissiveIntensity: 0.4, roughness: 0.7, metalness: 0.1 })
    );
    mesh.castShadow = true;
    scene.add(mesh);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(def.radius - 0.03, def.radius + 0.03, 128),
      new THREE.MeshBasicMaterial({ color: 0x445566, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    return { mesh, def };
  });

  function update(t) {
    sun.rotation.y = t * 0.2;
    for (const { mesh, def } of planets) {
      const a = t * def.speed;
      mesh.position.set(Math.cos(a) * def.radius, 0, Math.sin(a) * def.radius);
      mesh.rotation.y = t * def.speed * 2;
    }
  }

  update(0);
  return { scene, camera, update };
}
