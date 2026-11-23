function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 18, 45);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(7, 5.5, 9);
  camera.lookAt(0, 0, 0);

  // Key light (strong) with shadows
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
  key.position.set(8, 12, 6);
  key.castShadow = true;
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  // Weak ambient fill
  const ambient = new THREE.AmbientLight(0x8899ff, 0.35);
  scene.add(ambient);

  // Cool rim light for edge definition
  const rim = new THREE.DirectionalLight(0x66aaff, 0.8);
  rim.position.set(-9, 4, -7);
  scene.add(rim);

  // The one lit cube
  const geo = new THREE.BoxGeometry(4, 4, 4);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8b04b,
    metalness: 0.35,
    roughness: 0.35,
    emissive: 0x1a0e00,
    emissiveIntensity: 0.4
  });
  const cube = new THREE.Mesh(geo, mat);
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);

  function update(t) {
    cube.rotation.y = t * 0.6;
    cube.rotation.x = Math.sin(t * 0.4) * 0.35;
    cube.position.y = Math.sin(t * 1.2) * 0.35;
  }

  return { scene, camera, update };
}
