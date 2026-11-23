function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd8ff);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(28, 26, 30);
  camera.lookAt(0, 0, 0);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x8bd17a, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const treeCount = 36;
  const treeGeometry = new THREE.ConeGeometry(1.1, 3.2, 6);
  const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x1f7a3a, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, treeCount);
  trees.castShadow = true;

  const dummy = new THREE.Object3D();
  const base = [];
  for (let i = 0; i < treeCount; i++) {
    const angle = i * 2.399963229728653;
    const radius = 3 + 20 * Math.sqrt((i + 0.5) / treeCount);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    base.push({ x, z, phase: i * 1.7 });
    dummy.position.set(x, 1.6, z);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(24, 34, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  function update(t) {
    for (let i = 0; i < treeCount; i++) {
      const b = base[i];
      dummy.position.set(b.x, 1.6 + Math.sin(t * 2 + b.phase) * 0.08, b.z);
      dummy.rotation.set(0, b.phase, Math.sin(t * 2.2 + b.phase) * 0.06);
      dummy.scale.setScalar(1 + 0.05 * Math.sin(t * 3 + b.phase));
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;
  }

  return { scene, camera, update };
}
