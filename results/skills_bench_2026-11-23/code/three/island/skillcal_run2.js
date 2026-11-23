function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d6);
  scene.fog = new THREE.Fog(0x87b5d6, 60, 140);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 300);
  camera.position.set(28, 26, 28);
  camera.lookAt(0, 2, 0);

  // Lights
  const ambient = new THREE.AmbientLight(0xbfd4e6, 0.35);
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

  // Ground (horizontal plane)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6fae5a, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Low-poly island mound
  const mound = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 20, 3, 9, 1),
    new THREE.MeshStandardMaterial({ color: 0x8a6b46, roughness: 1, flatShading: true })
  );
  mound.position.y = -1.4;
  mound.receiveShadow = true;
  mound.castShadow = true;
  scene.add(mound);

  // Trees: ONE InstancedMesh
  const treeCount = 42;
  const treeGeo = new THREE.ConeGeometry(1.4, 4.2, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 0.9, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  trees.castShadow = true;
  trees.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const treeData = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < treeCount; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 3 + rand() * 20; // within 25 units of origin
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const s = 0.7 + rand() * 0.9;
    treeData.push({ x, z, s, phase: rand() * Math.PI * 2 });
    dummy.position.set(x, 2.1 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  scene.add(trees);

  // Soft radial glow texture generated procedurally (no DOM)
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const a = Math.max(0, 1 - d);
      const alpha = Math.round(a * a * 230);
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 238;
      data[idx + 2] = 190;
      data[idx + 3] = alpha;
    }
  }
  const glowTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTex.needsUpdate = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false }));
  glow.position.set(30, 38, 18);
  glow.scale.set(26, 26, 1);
  scene.add(glow);

  // Atmosphere dust points (no extra meshes)
  const starCount = 160;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 50;
    starPos[i * 3] = Math.cos(a) * r;
    starPos[i * 3 + 1] = 18 + rand() * 40;
    starPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.7 }));
  scene.add(stars);

  function update(t) {
    for (let i = 0; i < treeCount; i++) {
      const d = treeData[i];
      const sway = Math.sin(t * 1.4 + d.phase) * 0.06;
      dummy.position.set(d.x, 2.1 * d.s, d.z);
      dummy.scale.set(d.s, d.s, d.s);
      dummy.rotation.set(sway, d.phase, sway * 0.6);
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;

    const pulse = 1 + Math.sin(t * 0.8) * 0.08;
    glow.scale.set(26 * pulse, 26 * pulse, 1);
    stars.rotation.y = t * 0.02;
  }

  return { scene, camera, update };
}
