function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(10, 11, 16);
  camera.lookAt(0, 0, 0);

  const key = new THREE.PointLight(0xffe0b0, 900, 0, 2);
  key.position.set(0, 0, 0);
  scene.add(key);
  const ambient = new THREE.AmbientLight(0x334466, 0.55);
  scene.add(ambient);

  // Starfield
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 60 + Math.random() * 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  scene.add(new THREE.Points(starGeo, starMat));

  // Sun
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0xffcc55, emissive: 0xffaa22, emissiveIntensity: 2.4, roughness: 0.6, metalness: 0 })
  );
  scene.add(sun);

  // Soft radial glow via generated DataTexture (no DOM)
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const a = Math.max(0, 1 - d);
      const alpha = Math.pow(a, 2.2) * 255;
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = Math.round(220 * a + 40);
      data[idx + 2] = Math.round(140 * a);
      data[idx + 3] = alpha;
    }
  }
  const glowTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95
  }));
  glow.scale.set(9, 9, 1);
  scene.add(glow);

  function orbitRing(radius, color) {
    const seg = 128;
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 });
    return new THREE.LineLoop(geo, mat);
  }

  const planets = [];
  const defs = [
    { radius: 3.2, size: 0.45, speed: 0.55, color: 0x7fd4ff, emissive: 0x0a2a3a, ring: 0x3a6a8a },
    { radius: 5.6, size: 0.62, speed: 0.32, color: 0xffb066, emissive: 0x2a1206, ring: 0x8a5a3a },
    { radius: 8.2, size: 0.85, speed: 0.18, color: 0xc98aff, emissive: 0x1c0a2a, ring: 0x5a3a8a }
  ];

  for (const d of defs) {
    scene.add(orbitRing(d.radius, d.ring));
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(d.size, 32, 24),
      new THREE.MeshStandardMaterial({ color: d.color, emissive: d.emissive, emissiveIntensity: 0.5, roughness: 0.75, metalness: 0.15 })
    );
    mesh.position.set(d.radius, 0, 0);
    group.add(mesh);
    scene.add(group);
    planets.push({ group, speed: d.speed });
  }

  function update(t) {
    for (const p of planets) {
      p.group.rotation.y = t * p.speed;
    }
    glow.material.opacity = 0.85 + Math.sin(t * 2.0) * 0.12;
  }

  return { scene, camera, update };
}
