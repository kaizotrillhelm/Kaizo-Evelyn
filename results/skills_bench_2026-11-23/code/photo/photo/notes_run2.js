function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141417);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  // Table top
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.8, metalness: 0 })
  );
  table.position.y = -0.2;
  table.receiveShadow = true;
  scene.add(table);

  // Glass sphere
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 64, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1,
      ior: 1.5,
      thickness: 0.6,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 0.2
    })
  );
  glass.position.set(-1.7, 0.95, 0.2);
  glass.castShadow = true;
  scene.add(glass);

  // Polished metal sphere
  const metal = new THREE.Mesh(
    new THREE.SphereGeometry(0.78, 64, 64),
    new THREE.MeshStandardMaterial({
      color: 0xd8d8dc,
      metalness: 1,
      roughness: 0.22
    })
  );
  metal.position.set(0.25, 0.78, -0.7);
  metal.castShadow = true;
  scene.add(metal);

  // Matte ceramic sphere
  const ceramic = new THREE.Mesh(
    new THREE.SphereGeometry(0.68, 64, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0xe8e2d8,
      metalness: 0,
      roughness: 0.85,
      clearcoat: 0.25,
      clearcoatRoughness: 0.6
    })
  );
  ceramic.position.set(1.75, 0.68, 0.55);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // Key light
  const key = new THREE.DirectionalLight(0xfff1e0, 3);
  key.position.set(6, 10, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.radius = 4;
  scene.add(key);

  // Fill light
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.6);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30241a, 0.35);
  scene.add(hemi);

  const R = 7;
  const h = 3.2;

  function update(t) {
    const a = t * 0.15;
    camera.position.set(Math.cos(a) * R, h, Math.sin(a) * R);
    camera.lookAt(0, 0.6, 0);
  }

  update(0);

  return { scene, camera, update };
}
