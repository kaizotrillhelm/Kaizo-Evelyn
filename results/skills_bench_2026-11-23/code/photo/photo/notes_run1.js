function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c1a18);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);

  // Table top
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(11, 0.3, 7.5),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75, metalness: 0.05 })
  );
  table.position.y = -0.15;
  table.receiveShadow = true;
  scene.add(table);

  // Glass sphere
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 64, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1.0,
      ior: 1.5,
      thickness: 0.6,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.1
    })
  );
  glass.position.set(-1.15, 0.62, 0.15);
  glass.castShadow = true;
  scene.add(glass);

  // Polished metal sphere
  const metal = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 64, 64),
    new THREE.MeshStandardMaterial({
      color: 0xd8d8dc,
      metalness: 1.0,
      roughness: 0.22
    })
  );
  metal.position.set(1.0, 0.55, -0.45);
  metal.castShadow = true;
  scene.add(metal);

  // Matte ceramic sphere
  const ceramic = new THREE.Mesh(
    new THREE.SphereGeometry(0.68, 64, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0xe8e0d4,
      metalness: 0.0,
      roughness: 0.85,
      clearcoat: 0.25,
      clearcoatRoughness: 0.5
    })
  );
  ceramic.position.set(0.15, 0.68, 1.05);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // Key light
  const key = new THREE.DirectionalLight(0xfff1e0, 3.0);
  key.position.set(6, 10, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.radius = 4;
  scene.add(key);

  // Fill light
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.6);
  fill.position.set(-7, 4, -4);
  scene.add(fill);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30241a, 0.35);
  scene.add(hemi);

  const R = 5.2;
  const h = 2.4;
  const speed = 0.12;

  function update(t) {
    const a = t * speed;
    camera.position.set(Math.cos(a) * R, h, Math.sin(a) * R);
    camera.lookAt(0, 0.55, 0);
  }

  update(0);

  return { scene, camera, update };
}
