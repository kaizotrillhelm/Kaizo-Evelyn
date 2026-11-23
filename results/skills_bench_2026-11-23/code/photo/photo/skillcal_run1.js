function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1c22);
  scene.fog = new THREE.Fog(0x1a1c22, 14, 30);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);

  // Table
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.6, metalness: 0.05 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 8), tableMat);
  table.position.y = -0.15;
  table.receiveShadow = true;
  scene.add(table);

  // Glass sphere (left)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 0.9,
    ior: 1.5,
    thickness: 0.6,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2
  });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 32), glassMat);
  glass.position.set(-2, 0.85, 0);
  glass.castShadow = true;
  scene.add(glass);

  // Polished metal sphere (center)
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xd8dce2,
    metalness: 1.0,
    roughness: 0.2
  });
  const metal = new THREE.Mesh(new THREE.SphereGeometry(1.0, 48, 32), metalMat);
  metal.position.set(0, 1.0, 0);
  metal.castShadow = true;
  scene.add(metal);

  // Matte ceramic sphere (right)
  const ceramicMat = new THREE.MeshPhysicalMaterial({
    color: 0xc94f3d,
    roughness: 0.85,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5
  });
  const ceramic = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), ceramicMat);
  ceramic.position.set(2, 0.7, 0);
  ceramic.castShadow = true;
  scene.add(ceramic);

  // Lights
  const key = new THREE.DirectionalLight(0xfff2e0, 3.0);
  key.position.set(5, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fb4ff, 0.7);
  fill.position.set(-6, 4, -3);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(ambient);

  const rim = new THREE.PointLight(0xffd9a0, 12, 30, 2);
  rim.position.set(0, 6, -6);
  scene.add(rim);

  const R = 9;
  function update(t) {
    const a = t * 0.18;
    camera.position.set(Math.cos(a) * R, 3.4, Math.sin(a) * R);
    camera.lookAt(0, 0.9, 0);
  }
  update(0);

  return { scene, camera, update };
}
