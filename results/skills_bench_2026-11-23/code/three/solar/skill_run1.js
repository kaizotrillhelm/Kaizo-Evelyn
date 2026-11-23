function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(0, 9, 14);
  camera.lookAt(0, 0, 0);

  // Key light: warm point light at the sun
  const sunLight = new THREE.PointLight(0xffe0b0, 2.2, 0, 1.6);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x223044, 0.55));

  // Sun
  const sunGeo = new THREE.SphereGeometry(1.3, 32, 32);
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 1.6,
    roughness: 0.6, metalness: 0
  });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  scene.add(sun);

  // Soft radial glow sprite (generated DataTexture, no DOM)
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const a = Math.max(0, 1 - d);
      const alpha = Math.pow(a, 2.2);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = Math.round(210 * alpha + 40 * (1 - alpha));
      data[i + 2] = Math.round(120 * alpha);
      data[i + 3] = Math.round(alpha * 230);
    }
  }
  const glowTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true
  }));
  glow.scale.set(7, 7, 1);
  scene.add(glow);

  // Starfield
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 60 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xcdd8ff, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.9
  }));
  scene.add(stars);

  // Orbit guide lines + planets
  const orbitDefs = [
    { radius: 3.2, size: 0.45, color: 0x6fb7ff, emissive: 0x1a4a7a, speed: 0.55, phase: 0.0 },
    { radius: 5.8, size: 0.65, color: 0xff9a5c, emissive: 0x6a2a10, speed: 0.34, phase: 2.1 },
    { radius: 8.6, size: 0.55, color: 0x9fe08a, emissive: 0x2a5a20, speed: 0.22, phase: 4.4 }
  ];

  const planets = [];
  orbitDefs.forEach((def) => {
    const ringPts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * def.radius, 0, Math.sin(a) * def.radius));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({
      color: 0x3a4a66, transparent: true, opacity: 0.75
    }));
    scene.add(ring);

    const mat = new THREE.MeshStandardMaterial({
      color: def.color, emissive: def.emissive, emissiveIntensity: 0.35,
      roughness: 0.75, metalness: 0.15
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(def.size, 24, 24), mat);
    planet.userData = def;
    scene.add(planet);
    planets.push(planet);
  });

  function update(t) {
    for (const p of planets) {
      const d = p.userData;
      const a = t * d.speed + d.phase;
      p.position.set(Math.cos(a) * d.radius, 0, Math.sin(a) * d.radius);
      p.rotation.y = t * 0.8 + d.phase;
    }
    const s = 7 + Math.sin(t * 1.7) * 0.35;
    glow.scale.set(s, s, 1);
    sunLight.intensity = 2.2 + Math.sin(t * 1.7) * 0.18;
  }

  return { scene, camera, update };
}
