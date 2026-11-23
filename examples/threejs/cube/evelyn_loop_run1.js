// Written by Inkling 2 Mini (Q4_K_M) for the task "Spinning cube".
// Condition: Inkling + Evelyn (loop, no notes). Seed 1000. Run 1 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d29);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(3.5, 2.5, 4.5);
  camera.lookAt(0, 0, 0);

  const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8ef7,
    roughness: 0.35,
    metalness: 0.25
  });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x88aaff, 0.6);
  rimLight.position.set(-5, -2, -4);
  scene.add(rimLight);

  function update(t) {
    cube.rotation.x = t * 0.7;
    cube.rotation.y = t * 1.1;
    cube.rotation.z = t * 0.3;
  }

  update(0);

  return { scene, camera, update };
}
