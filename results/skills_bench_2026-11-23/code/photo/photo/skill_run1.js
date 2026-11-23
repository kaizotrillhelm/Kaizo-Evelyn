function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11131a);
  scene.fog = new THREE.Fog(0x11131a, 14, 30);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);

  // --- Procedural equirectangular environment (no DOM needed) ---
  const w = 64, h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 top -> 1 bottom
    let r, g, b;
    if (v < 0.45) {
      const k = v / 0.45;
      r = 207 + (106 - 207) * k; g = 216 + (113 - 216) * k; b = 232 + (128 - 232) * k;
    } else if (v < 0.55) {
      const k = (v - 0.45) / 0.1;
      r = 106 + (42 - 106) * k; g = 113 + (45 - 113) * k; b = 128 + (54 - 128) * k;
    } else {
      const k = (v - 0.55) / 0.45;
      r = 42 + (12 - 42) * k; g = 45 + (13 - 45) * k; b = 54 + (18 - 54) * k;
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // bright warm "softbox" band on one side
      const dx = Math.min(Math.abs(x - 20), w - Math.abs(x - 20));
      const dy = Math.abs(y - 9);
      const glow = Math.exp(-(dx * dx / 60 + dy * dy / 18));
      r = Math.min(255, r + glow * 120);
      g = Math.min(255, g + glow * 110);
      b = Math.min(255, b + glow * 80);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const envTex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  envTex.needsUpdate = true;
  scene.environment = envTex;

  // --- Table ---
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2e24, roughness: 0.55, metalness: 0.05 })
  );
  table.position.y = -0.15;
  table.receiveShadow = true;
  scene.add(table);

  // --- Spheres ---
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 48, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1.0,
      ior: 1.5,
      thickness: 0.6,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.2
    })
  );
  glass.position.set(-2, 0.85, 0);
  glass.castShadow = true;
  scene.add(glass);

  const metal = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 48, 32),
    new THREE.MeshStandardMaterial({
      color: 0xd8dde6,
      metalness: 1.0,
      roughness: 0.18,
      envMapIntensity: 1.3
    })
  );
  metal.position.set(0, 0.7, 0.4);
  metal.castShadow = true;
  scene.add(metal);

  const ceramic = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 48, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0xc96f4a,
      roughness: 0.82,
      metalness: 0,
      clearcoat: 0.25,
      clearcoatRoughness: 0.6
    })
  );
  ceramic.position.set(2, 0.9, -0.2);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // --- Lights ---
  const key = new THREE.DirectionalLight(0xfff1dd, 3.2);
  key.position.set(5, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6; key.shadow.camera.right = 6;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1; key.shadow.camera.far = 25;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.7);
  fill.position.set(-6, 3, -3);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0x404650, 0.35);
  scene.add(ambient);

  // --- Camera path ---
  const radius = 8.5;
  const height = 3.2;

  function update(t) {
    const angle = t * 0.12;
    camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    camera.lookAt(0, 0.7, 0);
  }
  update(0);

  return { scene, camera, update };
}
