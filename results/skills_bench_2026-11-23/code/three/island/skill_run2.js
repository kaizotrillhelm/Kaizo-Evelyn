function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d6);
  scene.fog = new THREE.Fog(0x87b5d6, 55, 130);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 300);
  camera.position.set(30, 24, 30);
  camera.lookAt(0, 2, 0);

  // Lighting: strong key + weak ambient
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(26, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xbcd6e8, 0.55));

  // Ground: horizontal plane, receives shadows
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 46, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6fbf5a, roughness: 0.95, metalness: 0, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Low-poly trees: ONE InstancedMesh (cones), spread within 25 units
  const treeCount = 42;
  const treeGeo = new THREE.ConeGeometry(1.35, 4.2, 6, 1);
  treeGeo.translate(0, 2.1, 0);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e7d3a, roughness: 0.85, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  trees.castShadow = true;
  trees.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const treeData = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < treeCount; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 3 + rand() * 21; // within 25 units of origin
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const s = 0.7 + rand() * 0.9;
    treeData.push({ x, z, s, phase: rand() * Math.PI * 2 });
    dummy.position.set(x, 0, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  // Atmospheric depth: soft drifting cloud puffs as Points (no extra meshes)
  const puffCount = 40;
  const puffPos = new Float32Array(puffCount * 3);
  const puffSeed = [];
  for (let i = 0; i < puffCount; i++) {
    const a = rand() * Math.PI * 2;
    const r = 18 + rand() * 28;
    puffPos[i * 3] = Math.cos(a) * r;
    puffPos[i * 3 + 1] = 16 + rand() * 10;
    puffPos[i * 3 + 2] = Math.sin(a) * r;
    puffSeed.push({ a, r, y: puffPos[i * 3 + 1], speed: 0.05 + rand() * 0.05 });
  }
  const puffGeo = new THREE.BufferGeometry();
  puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3));
  const puffMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false });
  const puffs = new THREE.Points(puffGeo, puffMat);
  scene.add(puffs);

  function update(t) {
    // Gentle sway: pure function of t
    for (let i = 0; i < treeCount; i++) {
      const d = treeData[i];
      const sway = Math.sin(t * 1.4 + d.phase) * 0.06;
      dummy.position.set(d.x, 0, d.z);
      dummy.scale.set(d.s, d.s, d.s);
      dummy.rotation.set(sway, d.phase, sway * 0.6);
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;

    // Drifting clouds: pure function of t
    const pos = puffGeo.attributes.position.array;
    for (let i = 0; i < puffCount; i++) {
      const p = puffSeed[i];
      const a = p.a + t * p.speed;
      pos[i * 3] = Math.cos(a) * p.r;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = Math.sin(a) * p.r;
    }
    puffGeo.attributes.position.needsUpdate = true;
  }

  update(0);
  return { scene, camera, update };
}
