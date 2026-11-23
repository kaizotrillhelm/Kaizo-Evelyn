function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d29);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(4, 3, 5);
  camera.lookAt(0, 0, 0);

  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(5, 8, 6);
  scene.add(light);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x4f9dff, roughness: 0.4, metalness: 0.3 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  function update(t) {
    cube.rotation.x = t * 0.9;
    cube.rotation.y = t * 1.3;
    cube.rotation.z = t * 0.5;
  }

  update(0);

  return { scene, camera, update };
}
