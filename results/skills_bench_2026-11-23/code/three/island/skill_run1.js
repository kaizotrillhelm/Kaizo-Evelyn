function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1a2b);
  scene.fog = new THREE.Fog(0x0e1a2b, 60, 140);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 300);
  camera.position.set(30, 28, 30);
  camera.lookAt(0, 1.5, 0);

  // Lighting: strong key, weak ambient
  const ambient = new THREE.AmbientLight(0x8fb0d8, 0.35);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(24, 34, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Horizontal ground (PlaneGeometry faces +Z, so rotate flat)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x3f7a44, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // One InstancedMesh of low-poly trees
  const treeCount = 42;
  const treeGeo = new THREE.ConeGeometry(0.85, 2.6, 5);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x1f5c2e, roughness: 0.85, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  trees.castShadow = true;

  const dummy = new THREE.Object3D();
  const golden = Math.PI * (3.0 - Math.sqrt(5.0));
  for (let i = 0; i < treeCount; i++) {
    // deterministic spread within 25 units of origin
    const r = 3 + 20 * Math.sqrt(((i * 0.61803398875) % 1));
    const a = i * golden;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = 0.7 + 0.7 * ((i * 0.377) % 1);
    dummy.position.set(x, 1.3 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.y = i * 1.7;
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  // Starfield via THREE.Points (no extra meshes)
  const starCount = 400;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = (i * 2.399963) % (Math.PI * 2);
    const phi = Math.acos(1 - 2 * ((i * 0.731) % 1));
    const radius = 90 + (i % 5) * 8;
    starPos[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    starPos[i * 3 + 1] = Math.abs(Math.cos(phi)) * radius * 0.6 + 5;
    starPos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.9
  }));
  scene.add(stars);

  function update(t) {
    stars.rotation.y = t * 0.02;
    sun.intensity = 2.2 + 0.15 * Math.sin(t * 1.4);
  }

  return { scene, camera, update };
}
