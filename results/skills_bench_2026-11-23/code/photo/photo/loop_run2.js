function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202226);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.4, 8),
    new THREE.MeshStandardMaterial({
      color: 0x6e4a2e,
      roughness: 0.62,
      metalness: 0.0
    })
  );
  table.position.y = -0.2;
  table.receiveShadow = true;
  table.castShadow = true;
  scene.add(table);

  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 64, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.06,
      metalness: 0.0,
      transmission: 0.9,
      thickness: 1.4,
      ior: 1.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      attenuationColor: new THREE.Color(0xdfefff),
      attenuationDistance: 4.0
    })
  );
  glass.position.set(-2.1, 1.0, 0.2);
  glass.castShadow = true;
  scene.add(glass);

  const metal = new THREE.Mesh(
    new THREE.SphereGeometry(0.78, 64, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0xd9d9de,
      metalness: 1.0,
      roughness: 0.18,
      clearcoat: 0.35,
      clearcoatRoughness: 0.22
    })
  );
  metal.position.set(0.0, 0.78, 0.75);
  metal.castShadow = true;
  scene.add(metal);

  const ceramic = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 64, 64),
    new THREE.MeshStandardMaterial({
      color: 0xb85c3f,
      roughness: 0.88,
      metalness: 0.0
    })
  );
  ceramic.position.set(2.1, 0.9, -0.35);
  ceramic.castShadow = true;
  scene.add(ceramic);

  const key = new THREE.DirectionalLight(0xfff1dd, 3.2);
  key.position.set(5.5, 8.0, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 25;
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.bias = -0.0002;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.65);
  fill.position.set(-6.0, 4.0, -5.0);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(0.0, 5.0, -7.0);
  scene.add(rim);

  function update(t) {
    const angle = t * 0.16;
    const radius = 9.0;
    camera.position.set(Math.sin(angle) * radius, 4.1, Math.cos(angle) * radius);
    camera.lookAt(0, 0.9, 0);
  }

  update(0);

  return { scene, camera, update };
}
