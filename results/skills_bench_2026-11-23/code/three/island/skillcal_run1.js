function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd4e8);
  scene.fog = new THREE.Fog(0x9fd4e8, 60, 160);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 400);
  camera.position.set(28, 26, 34);
  camera.lookAt(0, 2, 0);

  // Lighting: strong key + weak ambient
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(30, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xbfd6e4, 0.55));

  // Soft radial glow texture built purely in THREE (no DOM)
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 244; data[i + 2] = 214;
      data[i + 3] = Math.round(a * 230);
    }
  }
  const glowTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTex.needsUpdate = true;

  // Sun glow sprite
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false }));
  glow.scale.set(60, 60, 1);
  glow.position.set(30, 42, 18);
  scene.add(glow);

  // Water base (large, flat)
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshStandardMaterial({ color: 0x2e7f9e, roughness: 0.35, metalness: 0.1, flatShading: true })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.6;
  water.receiveShadow = true;
  scene.add(water);

  // Island ground (horizontal, receives shadows)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x5fae5a, roughness: 0.9, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Low-poly island rim (flattened cone of rock)
  const rim = new THREE.Mesh(
    new THREE.ConeGeometry(24, 7, 9, 1),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5f, roughness: 1, flatShading: true })
  );
  rim.position.y = -3.4;
  rim.rotation.y = 0.3;
  rim.castShadow = true;
  rim.receiveShadow = true;
  scene.add(rim);

  // Trees: ONE InstancedMesh (cone canopy), 40 instances within 25 units
  const treeCount = 40;
  const treeGeo = new THREE.ConeGeometry(1.4, 4.2, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3d, roughness: 0.85, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  trees.castShadow = true;
  trees.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < treeCount; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 4 + rand() * 20; // within 25 units of origin
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const s = 0.7 + rand() * 0.9;
    dummy.position.set(x, 2.1 * s + 0.1, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  // Drifting cloud sprites (pure function of t)
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    sp.scale.set(14 + i * 4, 6 + i * 2, 1);
    clouds.push({ sp, speed: 1.2 + i * 0.5, offset: i * 7.5, baseY: 22 + i * 3 });
    scene.add(sp);
  }

  function update(t) {
    for (const c of clouds) {
      const x = ((t * c.speed + c.offset) % 120) - 60;
      c.sp.position.set(x, c.baseY, -18 - c.offset);
    }
  }

  return { scene, camera, update };
}
