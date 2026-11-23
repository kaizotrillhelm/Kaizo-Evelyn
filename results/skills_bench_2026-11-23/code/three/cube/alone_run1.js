function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d29);

  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(5, 8, 6);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.5);
  fillLight.position.set(-6, -2, -4);
  scene.add(fillLight);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8ef7,
    roughness: 0.35,
    metalness: 0.25
  });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  function update(t) {
    cube.rotation.x = t * 0.9;
    cube.rotation.y = t * 1.3;
    cube.rotation.z = t * 0.5;
  }

  return { scene, camera, update };
}
