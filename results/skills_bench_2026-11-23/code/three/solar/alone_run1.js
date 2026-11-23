function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060f);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(0, 9.5, 17);
  camera.lookAt(0, 0, 0);

  // Lights
  scene.add(new THREE.AmbientLight(0x8899bb, 0.6));
  const sunLight = new THREE.PointLight(0xfff2d0, 2.2, 0, 0);
  scene.add(sunLight);

  // Sun (glowing)
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xffcc55,
    emissive: 0xffaa22,
    emissiveIntensity: 2.2,
    roughness: 1,
    metalness: 0
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), sunMat);
  scene.add(sun);

  // Soft additive halo around the sun
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffbb44,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 24), haloMat);
  scene.add(halo);

  // Orbit definitions (radii at least 1 unit apart)
  const orbitDefs = [
    { radius: 3.2, size: 0.32, color: 0x5fb4ff, speed: 0.90, phase: 0.0 },
    { radius: 5.6, size: 0.45, color: 0xff8a5c, speed: 0.55, phase: 2.1 },
    { radius: 8.4, size: 0.60, color: 0x8fe07a, speed: 0.32, phase: 4.2 }
  ];

  // Faint orbit rings in the XZ plane
  for (const def of orbitDefs) {
    const pts = [];
    const seg = 128;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * def.radius, 0, Math.sin(a) * def.radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const ring = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
      color: 0x334466,
      transparent: true,
      opacity: 0.6
    }));
    scene.add(ring);
  }

  // Planets
  const planets = orbitDefs.map(def => {
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: 0.75,
      metalness: 0.1
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.size, 32, 24), mat);
    scene.add(mesh);
    return { mesh, def };
  });

  const update = (t) => {
    for (const { mesh, def } of planets) {
      const a = def.phase + def.speed * t;
      mesh.position.set(Math.cos(a) * def.radius, 0, Math.sin(a) * def.radius);
      mesh.rotation.y = a * 3;
    }

    // Pulsing glow on the sun
    const pulse = Math.sin(t * 2.0);
    sunMat.emissiveIntensity = 2.1 + 0.45 * pulse;
    haloMat.opacity = 0.16 + 0.05 * pulse;
    halo.scale.setScalar(1 + 0.06 * pulse);

    // Slow camera drift (pure function of t)
    const camA = t * 0.12;
    camera.position.set(Math.sin(camA) * 17, 9.5, Math.cos(camA) * 17);
    camera.lookAt(0, 0, 0);
  };

  update(0);

  return { scene, camera, update };
}
