function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171512);

  const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 100);

  // Simple procedural equirect environment so metals/glass have something to reflect
  const ew = 64, eh = 32;
  const envData = new Uint8Array(ew * eh * 4);
  for (let y = 0; y < eh; y++) {
    for (let x = 0; x < ew; x++) {
      const v = y / (eh - 1);
      const u = x / (ew - 1);
      const sun = Math.max(0, 1 - Math.hypot(u - 0.3, v - 0.25) * 3.2);
      const r = 255 * (0.25 + 0.75 * (1 - v)) + sun * 120;
      const g = 235 * (0.22 + 0.7 * (1 - v)) + sun * 110;
      const b = 215 * (0.2 + 0.6 * (1 - v)) + sun * 90;
      const i = (y * ew + x) * 4;
      envData[i] = Math.min(255, r);
      envData[i + 1] = Math.min(255, g);
      envData[i + 2] = Math.min(255, b);
      envData[i + 3] = 255;
    }
  }
  const envTex = new THREE.DataTexture(envData, ew, eh, THREE.RGBAFormat);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  envTex.needsUpdate = true;
  scene.environment = envTex;

  // Table top
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(9, 0.35, 6),
    new THREE.MeshStandardMaterial({ color: 0x6f5138, roughness: 0.55, metalness: 0.0 })
  );
  table.position.y = -0.175;
  table.receiveShadow = true;
  scene.add(table);

  // Glass sphere
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 64, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.05,
      transmission: 0.9,
      thickness: 1.4,
      ior: 1.5,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
      attenuationColor: new THREE.Color(0xdfeef2),
      attenuationDistance: 2.5,
      envMapIntensity: 1.4
    })
  );
  glass.position.set(-1.9, 0.85, 0.35);
  glass.castShadow = true;
  scene.add(glass);

  // Polished metal sphere
  const metal = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 64, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xd8d8dc,
      metalness: 1.0,
      roughness: 0.12,
      clearcoat: 0.25,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.3
    })
  );
  metal.position.set(0.1, 0.7, -0.55);
  metal.castShadow = true;
  scene.add(metal);

  // Matte ceramic sphere
  const ceramic = new THREE.Mesh(
    new THREE.SphereGeometry(0.78, 64, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xb45a3c,
      metalness: 0.0,
      roughness: 0.88,
      clearcoat: 0.0,
      envMapIntensity: 0.35
    })
  );
  ceramic.position.set(1.95, 0.78, 0.45);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // Key light
  const key = new THREE.DirectionalLight(0xfff1dd, 3.2);
  key.position.set(4.5, 6.5, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 25;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0004;
  scene.add(key);

  // Fill light
  const fill = new THREE.DirectionalLight(0xcfd8ff, 0.7);
  fill.position.set(-5, 3, -2);
  scene.add(fill);

  // Gentle ambient lift
  const hemi = new THREE.HemisphereLight(0xf5ead8, 0x2a241e, 0.35);
  scene.add(hemi);

  const target = new THREE.Vector3(0, 0.75, 0);
  const radius = 7.2;
  const height = 2.9;

  function update(t) {
    const a = t * 0.12;
    camera.position.set(Math.cos(a) * radius, height, Math.sin(a) * radius);
    camera.lookAt(target);
  }

  update(0);

  return { scene, camera, update };
}
