function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 30, 90);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(6.5, 5.5, 7.5);
  camera.lookAt(0, 0, 0);

  // Lights: strong key + weak ambient
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
  key.position.set(8, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10; key.shadow.camera.right = 10;
  key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 1; key.shadow.camera.far = 40;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.8);
  rim.position.set(-7, 3, -6);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0x334466, 0.9));

  // The one lit cube
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(3, 3, 3),
    new THREE.MeshStandardMaterial({
      color: 0xd97b3f,
      metalness: 0.35,
      roughness: 0.35,
      emissive: 0x1a0d05,
      flatShading: true
    })
  );
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);

  // Subtle starfield via Points (no extra meshes)
  const starCount = 350;
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 45 + Math.random() * 30;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.8 - 5;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xcfe0ff, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.9
  }));
  scene.add(stars);

  // Soft radial glow sprite (procedural DataTexture, no DOM)
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2, dy = y - size / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const a = Math.max(0, 1 - d);
      const alpha = Math.pow(a, 2.2) * 140;
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 150;
      data[idx + 2] = 80;
      data[idx + 3] = alpha;
    }
  }
  const glowTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  glow.scale.set(16, 16, 1);
  glow.position.set(0, 0, -2);
  scene.add(glow);

  function update(t) {
    cube.rotation.y = t * 0.7;
    cube.rotation.x = Math.sin(t * 0.4) * 0.35;
    cube.position.y = Math.sin(t * 1.1) * 0.35;
    glow.material.opacity = 0.85 + Math.sin(t * 1.1) * 0.15;
    stars.rotation.y = t * 0.02;
  }

  update(0);
  return { scene, camera, update };
}
