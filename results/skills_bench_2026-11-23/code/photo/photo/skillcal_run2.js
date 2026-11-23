function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1c22);
  scene.fog = new THREE.Fog(0x1a1c22, 14, 30);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);

  // Table
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.6, metalness: 0.05 })
  );
  table.position.y = -0.15;
  table.receiveShadow = true;
  scene.add(table);

  // Glass sphere
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 48, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1,
      ior: 1.5,
      thickness: 0.5,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 0.4
    })
  );
  glass.position.set(-2, 0.9, 0);
  glass.castShadow = true;
  scene.add(glass);

  // Polished metal sphere
  const metal = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1.0, roughness: 0.2 })
  );
  metal.position.set(0, 0.75, 0);
  metal.castShadow = true;
  scene.add(metal);

  // Matte ceramic sphere
  const ceramic = new THREE.Mesh(
    new THREE.SphereGeometry(0.65, 48, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0xc96f4a,
      metalness: 0,
      roughness: 0.85,
      clearcoat: 0.25,
      clearcoatRoughness: 0.6
    })
  );
  ceramic.position.set(2, 0.65, 0);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // Lights
  const key = new THREE.DirectionalLight(0xfff2e0, 3.0);
  key.position.set(5, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 25;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9db4ff, 0.7);
  fill.position.set(-6, 3, -3);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

  // Atmospheric dust motes (Points, no extra meshes)
  const moteCount = 120;
  const motePos = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.sin(i * 12.9898) * 0.5) * 10;
    motePos[i * 3 + 1] = 0.3 + (Math.abs(Math.sin(i * 78.233)) * 4.5);
    motePos[i * 3 + 2] = (Math.cos(i * 39.346) * 0.5) * 10;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xffe6be, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false
  }));
  scene.add(motes);

  const radius = 7.5;
  const height = 3.2;

  function update(t) {
    const angle = t * 0.18;
    camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    camera.lookAt(0, 0.8, 0);
    motes.rotation.y = t * 0.05;
  }

  update(0);

  return { scene, camera, update };
}
