function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1e);
  scene.fog = new THREE.FogExp2(0x0a0f1e, 0.012);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);
  camera.position.set(0, 14, 22);
  camera.lookAt(0, 0, 0);

  // Lights
  const ambient = new THREE.AmbientLight(0x334466, 0.5);
  scene.add(ambient);
  const sunLight = new THREE.PointLight(0xffd9a0, 60, 0, 1.6);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  // Sun
  const sunGeo = new THREE.SphereGeometry(2.2, 48, 32);
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xffcc55,
    emissive: 0xffaa22,
    emissiveIntensity: 2.2,
    roughness: 0.6,
    metalness: 0.0
  });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  scene.add(sun);

  // Soft radial glow texture generated procedurally (no DOM)
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const a = Math.max(0, 1 - d);
      const alpha = Math.pow(a, 2.2);
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = Math.floor(220 - 100 * d);
      data[idx + 2] = Math.floor(140 - 110 * d);
      data[idx + 3] = Math.floor(alpha * 255);
    }
  }
  const glowTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTex.needsUpdate = true;
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(14, 14, 1);
  scene.add(glow);

  // Starfield
  const starCount = 1200;
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
  const starMat = new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.35, sizeAttenuation: true });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Orbit guide rings
  function makeRing(radius) {
    const pts = [];
    const segs = 128;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x3a4a66, transparent: true, opacity: 0.55 });
    return new THREE.Line(geo, mat);
  }

  // Planets: radius, size, color, speed
  const planetDefs = [
    { radius: 5.5, size: 0.55, color: 0x7ec8e3, emissive: 0x1a3a4a, speed: 0.9, phase: 0.0 },
    { radius: 10.0, size: 0.85, color: 0xe0a060, emissive: 0x3a2410, speed: 0.45, phase: 2.1 },
    { radius: 15.0, size: 1.15, color: 0xc46a5a, emissive: 0x33120c, speed: 0.22, phase: 4.2 }
  ];

  const orbitGroups = [];
  planetDefs.forEach((def) => {
    scene.add(makeRing(def.radius));
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.emissive,
      emissiveIntensity: 0.5,
      roughness: 0.75,
      metalness: 0.15
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(def.size, 32, 24), mat);
    planet.position.set(def.radius, 0, 0);
    group.add(planet);
    scene.add(group);
    orbitGroups.push({ group, def });
  });

  function update(t) {
    for (const { group, def } of orbitGroups) {
      group.rotation.y = t * def.speed + def.phase;
    }
    glow.scale.set(14 + Math.sin(t * 1.6) * 0.9, 14 + Math.sin(t * 1.6) * 0.9, 1);
    glow.material.opacity = 0.9 + Math.sin(t * 1.6) * 0.1;
    stars.rotation.y = t * 0.005;
  }

  return { scene, camera, update };
}
