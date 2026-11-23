// Written by Inkling 2 Mini (Q4_K_M) for the task "Spinning cube".
// Condition: Inkling + Evelyn (loop, no notes). Seed 1001. Run 2 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141824);

  const camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.1, 100);
  camera.position.set(4.5, 3.5, 6.5);
  camera.lookAt(0, 0, 0);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4da6ff,
    roughness: 0.35,
    metalness: 0.35
  });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(5, 8, 6);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.5);
  fillLight.position.set(-6, -2, -4);
  scene.add(fillLight);

  function update(t) {
    cube.rotation.x = t * 0.8;
    cube.rotation.y = t * 1.15;
    cube.rotation.z = t * 0.35;
  }

  update(0);

  return { scene, camera, update };
}
