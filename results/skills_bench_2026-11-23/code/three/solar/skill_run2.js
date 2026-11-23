function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(0, 11, 13);
  camera.lookAt(0, 0, 0);

  // Lights: strong key from the sun, weak ambient fill
  const key = new THREE.PointLight(0xffe0b0, 900, 0, 2);
  key.position.set(0, 0, 0);
  scene.add(key);
  const ambient = new THREE.AmbientLight(0x334466, 0.55);
  scene.add(ambient);

  // Sun: emissive sphere + soft radial sprite glow
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffcc44,
      emissive: 0xff9900,
      emissiveIntensity: 2.2,
      roughness: 0.6,
      metalness: 0.0
    })
  );
  scene.add(sun);

  // Procedural radial glow texture (no DOM canvas)
  const glowSize = 128;
  const glowData = new Uint8Array(glowSize * glowSize * 4);
  for (let y = 0; y < glowSize; y++) {
    for (let x = 0; x < glowSize; x++) {
      const dx = x - glowSize / 2;
      const dy = y - glowSize / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (glowSize / 2);
      const falloff = Math.max(0, 1 - d);
      const a = Math.pow(falloff, 1.8);
      const idx = (y * glowSize + x) * 4;
      glowData[idx] = 255;
      glowData[idx + 1] = Math.round(190 * a + 40);
      glowData[idx + 2] = Math.round(90 * a);
      glowData[idx + 3] = Math.round(255 * a);
    }
  }
  const glowTex = new THREE.DataTexture(glowData, glowSize, glowSize, THREE.RGBAFormat);
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  }));
  glow.scale.set(9, 9, 1);
  scene.add(glow);

  // Starfield via Points
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  let seed = 12345;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  for (let i = 0; i < starCount; i++) {
    const r = 60 + rand() * 80;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xcdd8ff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.9
  }));
  scene.add(stars);

  // Orbit guide lines + planets
  const planetDefs = [
    { radius: 3.2, speed: 0.9, size: 0.45, color: 0x6fc3ff, emissive: 0x113355 },
    { radius: 5.6, speed: 0.55, size: 0.7, color: 0xff9a5c, emissive: 0x331505 },
    { radius: 8.4, speed: 0.32, size: 0.95, color: 0x9fe08a, emissive: 0x14301a }
  ];

  const orbitGroups = [];

  function makeCircleLine(radius) {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x4a5a80, transparent: true, opacity: 0.55
    }));
  }

  for (const def of planetDefs) {
    scene.add(makeCircleLine(def.radius));

    const group = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(def.size, 32, 32),
      new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.emissive,
        emissiveIntensity: 0.6,
        roughness: 0.75,
        metalness: 0.15
      })
    );
    planet.position.set(def.radius, 0, 0);
    group.add(planet);
    scene.add(group);
    orbitGroups.push({ group, speed: def.speed });
  }

  function update(t) {
    for (const o of orbitGroups) {
      o.group.rotation.y = t * o.speed;
    }
    glow.material.opacity = 0.85 + 0.15 * Math.sin(t * 2.0);
  }

  return { scene, camera, update };
}
