function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(6, 5, 8);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(10, 12, 8);
  scene.add(directional);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x4f9cf9, roughness: 0.5, metalness: 0.2 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const speed = 1.2;
  function update(t) {
    cube.rotation.y = t * speed;
    cube.rotation.x = t * speed * 0.5;
  }

  return { scene, camera, update };
}
