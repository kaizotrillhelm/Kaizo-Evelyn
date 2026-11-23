function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161c);
  scene.fog = new THREE.Fog(0x14161c, 14, 30);

  const camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 100);

  // --- Procedural equirect environment texture for glass/metal reflections ---
  const w = 64, h = 32;
  const data = new Uint8Array(w * h * 4);
  const lerp = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / (h - 1);          // 0 top, 1 bottom
      const u = x / (w - 1);
      const warm = Math.max(0, 1 - Math.abs(u - 0.3) * 3);
      const r = Math.floor(lerp(30, 220, Math.pow(1 - v, 1.6)) + warm * 30);
      const g = Math.floor(lerp(32, 200, Math.pow(1 - v, 1.6)) + warm * 20);
      const b = Math.floor(lerp(45, 235, Math.pow(1 - v, 1.4)) + warm * 10);
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
      data[i + 3] = 255;
    }
  }
  const envTex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  envTex.needsUpdate = true;
  scene.environment = envTex;

  // --- Table ---
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.6, metalness: 0.05 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 8), tableMat);
  table.position.y = -0.15;
  table.receiveShadow = true;
  scene.add(table);

  // --- Glass sphere (center) ---
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 0.9,
    ior: 1.5,
    thickness: 0.6,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.1
  });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.95, 48, 32), glassMat);
  glass.position.set(0, 0.95, 0);
  glass.castShadow = true;
  scene.add(glass);

  // --- Polished metal sphere (left) ---
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xd8dde4,
    metalness: 1.0,
    roughness: 0.18
  });
  const metal = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), metalMat);
  metal.position.set(-2.1, 0.7, 0.3);
  metal.castShadow = true;
  scene.add(metal);

  // --- Matte ceramic sphere (right) ---
  const ceramicMat = new THREE.MeshPhysicalMaterial({
    color: 0xb8543f,
    roughness: 0.85,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5
  });
  const ceramic = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 32), ceramicMat);
  ceramic.position.set(2.1, 0.8, -0.2);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // --- Lights ---
  const key = new THREE.DirectionalLight(0xfff2e0, 3.2);
  key.position.set(5, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.far = 25;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
  fill.position.set(-6, 3, -3);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0x404860, 0.35);
  scene.add(ambient);

  // --- Camera orbit ---
  const orbitRadius = 8.5;
  const orbitHeight = 3.6;
  const target = new THREE.Vector3(0, 0.9, 0);

  function update(t) {
    const a = t * 0.15;
    camera.position.set(Math.cos(a) * orbitRadius, orbitHeight, Math.sin(a) * orbitRadius);
    camera.lookAt(target);
  }
  update(0);

  return { scene, camera, update };
}
