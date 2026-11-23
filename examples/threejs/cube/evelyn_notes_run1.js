// Written by Inkling 2 Mini (Q4_K_M) for the task "Spinning cube".
// Condition: Inkling + Evelyn (loop with notes). Seed 1000. Run 1 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(6, 5, 8);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(5, 10, 7);
  scene.add(directional);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0x4fa3ff, roughness: 0.4, metalness: 0.3 })
  );
  cube.castShadow = true;
  scene.add(cube);

  function update(t) {
    cube.rotation.y = t * 0.8;
    cube.rotation.x = t * 0.3;
  }

  update(0);

  return { scene, camera, update };
}
