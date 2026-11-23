function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161f);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(4.5, 3.5, 6.5);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(5, 8, 6);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x88aaff, 0.8);
  rimLight.position.set(-6, -2, -5);
  scene.add(rimLight);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8ff7,
    roughness: 0.35,
    metalness: 0.25
  });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  function update(t) {
    cube.rotation.x = t * 0.7;
    cube.rotation.y = t * 1.1;
    cube.rotation.z = Math.sin(t * 0.5) * 0.2;
  }

  update(0);

  return { scene, camera, update };
}
