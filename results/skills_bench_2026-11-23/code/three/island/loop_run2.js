function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 60, 140);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 300);
  camera.position.set(30, 28, 30);
  camera.lookAt(0, 0, 0);

  // Deterministic pseudo-random for stable layout
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(1337);

  // Ground (horizontal, at least 20x20, receives shadows)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6fbf5a, flatShading: true, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Low-poly island rim: a slightly larger, darker "sand" plane beneath
  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 56, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xd9c07a, flatShading: true, roughness: 1 })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.25;
  rim.receiveShadow = true;
  scene.add(rim);

  // One InstancedMesh holding all trees
  const treeCount = 40;
  const treeGeo = new THREE.ConeGeometry(1.15, 3.4, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, flatShading: true, roughness: 0.9 });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  trees.castShadow = true;

  const base = [];
  for (let i = 0; i < treeCount; i++) {
    // Spread within 25 units of origin
    let x, z, r;
    do {
      x = (rand() * 2 - 1) * 24;
      z = (rand() * 2 - 1) * 24;
      r = Math.sqrt(x * x + z * z);
    } while (r > 24);
    const s = 0.7 + rand() * 0.9;
    base.push({
      x: x,
      z: z,
      y: (3.4 * s) / 2,
      s: s,
      rot: rand() * Math.PI * 2,
      phase: rand() * Math.PI * 2
    });
  }

  const dummy = new THREE.Object3D();
  for (let i = 0; i < treeCount; i++) {
    const p = base[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  // Lights
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a5a2a, 0.7);
  scene.add(hemi);

  const light = new THREE.DirectionalLight(0xffffff, 1.6);
  light.position.set(25, 32, 18);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.left = -35;
  light.shadow.camera.right = 35;
  light.shadow.camera.top = 35;
  light.shadow.camera.bottom = -35;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 100;
  light.shadow.bias = -0.0005;
  scene.add(light);
  scene.add(light.target);

  function update(t) {
    // Sway each tree as a pure function of t
    for (let i = 0; i < treeCount; i++) {
      const p = base[i];
      const sway = Math.sin(t * 1.4 + p.phase) * 0.09;
      const sway2 = Math.cos(t * 1.1 + p.phase * 1.3) * 0.06;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(sway, p.rot, sway2);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;

    // Slow drift of the sun for animated light/shadow movement
    light.position.set(Math.cos(t * 0.15) * 26, 32, Math.sin(t * 0.15) * 26);
  }

  update(0);

  return { scene, camera, update };
}
