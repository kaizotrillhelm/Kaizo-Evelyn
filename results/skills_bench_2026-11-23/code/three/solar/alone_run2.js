function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06060f);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  camera.position.set(0, 9.5, 19);
  camera.lookAt(0, 0, 0);

  // Lights
  scene.add(new THREE.AmbientLight(0x8899cc, 0.35));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
  dirLight.position.set(6, 12, 8);
  scene.add(dirLight);
  const sunLight = new THREE.PointLight(0xffc477, 120, 0, 2);
  scene.add(sunLight);

  // Sun (glowing sphere at origin)
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xff7a00,
    emissiveIntensity: 2.4,
    roughness: 1,
    metalness: 0
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 48, 48), sunMat);
  scene.add(sun);

  // Static deterministic starfield
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const starCount = 500;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const r = 60 + rand() * 60;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    starPos[i * 3] = s * Math.cos(phi) * r;
    starPos[i * 3 + 1] = u * r;
    starPos[i * 3 + 2] = s * Math.sin(phi) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.0,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9
  }));
  scene.add(stars);

  // Three planets on circular XZ-plane orbits (radii >= 1 apart)
  const planetDefs = [
    { radius: 3.0, size: 0.38, speed: 0.90, angle0: 0.0, color: 0x5fd0c5, emissive: 0x0a2e2a, spin: 1.4 },
    { radius: 5.5, size: 0.55, speed: 0.50, angle0: 2.1, color: 0xf28c4a, emissive: 0x2a1206, spin: 0.9 },
    { radius: 8.0, size: 0.75, speed: 0.28, angle0: 4.2, color: 0x9a7bd8, emissive: 0x150a2a, spin: 0.6 }
  ];

  const planets = planetDefs.map((def) => {
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.emissive,
      emissiveIntensity: 0.6,
      roughness: 0.7,
      metalness: 0.15
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.size, 32, 32), mat);
    scene.add(mesh);

    const pts = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * def.radius, 0, Math.sin(a) * def.radius));
    }
    const orbitLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x3a4a6b, transparent: true, opacity: 0.55 })
    );
    scene.add(orbitLine);

    return { ...def, mesh };
  });

  function update(t) {
    for (const p of planets) {
      const a = p.angle0 + p.speed * t;
      p.mesh.position.set(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
      p.mesh.rotation.y = t * p.spin;
    }

    const pulse = 0.5 + 0.5 * Math.sin(t * 2.0);
    sunMat.emissiveIntensity = 2.0 + 0.8 * pulse;
    sunLight.intensity = 100 + 40 * pulse;

    const camAngle = t * 0.1;
    camera.position.set(Math.cos(camAngle) * 19, 9.5, Math.sin(camAngle) * 19);
    camera.lookAt(0, 0, 0);
  }

  update(0);

  return { scene, camera, update };
}
