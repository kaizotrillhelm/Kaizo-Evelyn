function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(3.2, 2.4, 4.5);
  camera.lookAt(0, 0, 0);

  const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8ff7,
    roughness: 0.35,
    metalness: 0.25
  });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(5, 8, 4);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.6);
  fillLight.position.set(-6, -3, -4);
  scene.add(fillLight);

  function update(t) {
    cube.rotation.x = t * 0.7;
    cube.rotation.y = t * 1.1;
    cube.rotation.z = t * 0.4;
  }

  update(0);

  return { scene, camera, update };
}
