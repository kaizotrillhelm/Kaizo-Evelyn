// Written by Inkling 2 Mini (Q4_K_M) for the task "Spinning cube".
// Condition: Inkling alone. Seed 1001. Run 2 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d24);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 2.2);
  directional.position.set(5, 6, 4);
  scene.add(directional);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4a90d9,
    roughness: 0.35,
    metalness: 0.25
  });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  function update(t) {
    cube.rotation.x = t * 0.8;
    cube.rotation.y = t * 1.3;
    cube.rotation.z = Math.sin(t * 0.6) * 0.3;
  }

  update(0);

  return { scene, camera, update };
}
