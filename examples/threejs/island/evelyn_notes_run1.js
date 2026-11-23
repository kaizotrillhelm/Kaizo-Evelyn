// Written by Inkling 2 Mini (Q4_K_M) for the task "Low-poly island with instanced trees".
// Condition: Inkling + Evelyn (loop with notes). Seed 1200. Run 1 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(25, 20, 25);
  camera.lookAt(0, 0, 0);

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a5f3a, 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 40, 20);
  sun.castShadow = true;
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  const island = new THREE.Group();
  scene.add(island);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4caf50, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  island.add(ground);

  // Low-poly island rim (simple disc base)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 22, 3, 9),
    new THREE.MeshStandardMaterial({ color: 0x8d6e63, flatShading: true })
  );
  base.position.y = -1.5;
  base.receiveShadow = true;
  island.add(base);

  // Trees: ONE InstancedMesh
  const treeCount = 36;
  const treeGeo = new THREE.ConeGeometry(1.2, 3.2, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x1b5e20, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  trees.castShadow = true;

  const dummy = new THREE.Object3D();
  let placed = 0;
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  while (placed < treeCount) {
    const angle = rand() * Math.PI * 2;
    const radius = 3 + rand() * 20; // within 25 units of origin
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const s = 0.7 + rand() * 0.9;
    dummy.position.set(x, 1.6 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.updateMatrix();
    trees.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  trees.instanceMatrix.needsUpdate = true;
  island.add(trees);

  function update(t) {
    island.rotation.y = t * 0.08;
  }

  return { scene, camera, update };
}
