function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(22, 24, 22);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a5f2a, 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(25, 35, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4c9a3f, flatShading: true, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const treeCount = 36;
  const treeGeometry = new THREE.ConeGeometry(0.8, 2.4, 6);
  const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x1f6b2a, flatShading: true, roughness: 0.9 });
  const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, treeCount);
  trees.castShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < treeCount; i++) {
    const t = i / (treeCount - 1);
    const radius = 3.5 + 19.5 * t;
    const angle = i * 2.399963229728653;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const s = 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(i * 12.9898));
    dummy.position.set(x, 1.2 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.y = angle;
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.count = treeCount;
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  function update(t) {
    const angle = 0.7 + t * 0.12;
    const radius = 30;
    camera.position.set(Math.cos(angle) * radius, 23, Math.sin(angle) * radius);
    camera.lookAt(0, 0, 0);
  }

  update(0);

  return { scene, camera, update };
}
