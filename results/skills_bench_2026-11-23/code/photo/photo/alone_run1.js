function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17171b);

  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 200);

  // Procedural equirect environment (no renderer needed) for metal/glass reflections
  const w = 64, h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / (h - 1);
      let r = 30 + 210 * v;
      let g = 32 + 195 * v;
      let b = 40 + 175 * v;
      const dx = (x - w * 0.32) / w;
      const dy = (y - h * 0.72) / h;
      const d = Math.sqrt(dx * dx + dy * dy);
      const spot = Math.max(0, 1 - d * 5.5);
      r += 220 * spot; g += 210 * spot; b += 190 * spot;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
      data[i + 3] = 255;
    }
  }
  const envTex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.needsUpdate = true;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  // Table top
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.5, 10),
    new THREE.MeshStandardMaterial({ color: 0x5d4128, roughness: 0.55, metalness: 0.05 })
  );
  table.position.y = -0.25;
  table.receiveShadow = true;
  scene.add(table);

  // Glass sphere
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 64, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.04,
      transmission: 0.92,
      thickness: 1.4,
      ior: 1.5,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
      attenuationColor: new THREE.Color(0xd8ece6),
      attenuationDistance: 2.5
    })
  );
  glass.position.set(-2.3, 1.05, 0.3);
  glass.castShadow = true;
  scene.add(glass);

  // Polished metal sphere
  const metal = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f5, metalness: 0.95, roughness: 0.16 })
  );
  metal.position.set(0.15, 0.8, -0.75);
  metal.castShadow = true;
  scene.add(metal);

  // Matte ceramic sphere
  const ceramic = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0xc96f4a, roughness: 0.88, metalness: 0.0 })
  );
  ceramic.position.set(2.35, 0.9, 0.55);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // Key light
  const key = new THREE.DirectionalLight(0xfff1dd, 3.2);
  key.position.set(6, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  key.shadow.bias = -0.0004;
  scene.add(key);

  // Fill light
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.7);
  fill.position.set(-7, 4, -3);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

  const radius = 10;
  const height = 4.6;
  const lookAt = new THREE.Vector3(0, 1.0, 0);

  function update(t) {
    const a = t * 0.18;
    camera.position.set(Math.cos(a) * radius, height, Math.sin(a) * radius);
    camera.lookAt(lookAt);
  }

  update(0);

  return { scene, camera, update };
}
