// Written by Inkling 2 Mini (Q4_K_M) for the task "Low-poly island with instanced trees".
// Condition: Inkling + Evelyn (loop with notes). Seed 1201. Run 2 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(25, 20, 25);
  camera.lookAt(0, 0, 0);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6fbf5a, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Island group (rotated by update)
  const island = new THREE.Group();
  scene.add(island);

  // Trees: one InstancedMesh (low-poly cone foliage)
  const treeCount = 32;
  const treeGeo = new THREE.ConeGeometry(0.9, 2.6, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x1f7a3a, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  trees.castShadow = true;

  const dummy = new THREE.Object3D();
  // deterministic pseudo-random spread
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < treeCount; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 2 + rand() * 9; // within ~11 units of origin
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const s = 0.7 + rand() * 0.9;
    dummy.position.set(x, 1.3 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  island.add(trees);

  // A low-poly rock for decoration
  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.4, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a8f98, flatShading: true })
  );
  rock.position.set(-3.5, 0.7, 3.5);
  rock.castShadow = true;
  rock.receiveShadow = true;
  island.add(rock);

  // Lighting
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
  dirLight.position.set(20, 30, 10);
  dirLight.castShadow = true;
  dirLight.shadow.camera.left = -30;
  dirLight.shadow.camera.right = 30;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 80;
  dirLight.shadow.mapSize.set(2048, 2048);
  scene.add(dirLight);

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  function update(t) {
    island.rotation.y = t * 0.05;
  }

  return { scene, camera, update };
}
