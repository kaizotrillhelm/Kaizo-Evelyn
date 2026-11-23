function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 18, 60);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(7, 5.5, 9);
  camera.lookAt(0, 0, 0);

  // Lights: strong key + weak ambient
  const ambient = new THREE.AmbientLight(0x8899bb, 0.35);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
  key.position.set(8, 12, 6);
  key.castShadow = true;
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x4a6cff, 0.8);
  rim.position.set(-6, 3, -8);
  scene.add(rim);

  // The one lit cube
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(3, 3, 3),
    new THREE.MeshStandardMaterial({
      color: 0xd97b3f,
      metalness: 0.35,
      roughness: 0.35,
      emissive: 0x1a0d05
    })
  );
  cube.castShadow = true;
  scene.add(cube);

  // Starfield via THREE.Points (no extra meshes)
  const starCount = 700;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 40 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.35, sizeAttenuation: true, fog: false })
  );
  scene.add(stars);

  // Soft radial glow sprite via procedural DataTexture (no DOM)
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - d);
      const alpha = Math.pow(a, 2.2) * 140;
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 180;
      data[idx + 2] = 110;
      data[idx + 3] = alpha;
    }
  }
  const glowTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false })
  );
  glow.scale.set(14, 14, 1);
  glow.position.set(0, 0, -2);
  scene.add(glow);

  function update(t) {
    cube.rotation.y = t * 0.9;
    cube.rotation.x = t * 0.45;
    glow.material.opacity = 0.85 + 0.15 * Math.sin(t * 2.0);
  }

  return { scene, camera, update };
}
