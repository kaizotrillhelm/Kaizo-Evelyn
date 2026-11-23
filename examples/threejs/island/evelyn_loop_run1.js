// Written by Inkling 2 Mini (Q4_K_M) for the task "Low-poly island with instanced trees".
// Condition: Inkling + Evelyn (loop, no notes). Seed 1200. Run 1 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd4e8);
  scene.fog = new THREE.Fog(0x9fd4e8, 70, 140);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 300);
  camera.position.set(26, 24, 26);
  camera.lookAt(0, 0, 0);

  // Lights
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6b8f5a, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(20, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -32;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // Water
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(90, 24),
    new THREE.MeshStandardMaterial({ color: 0x3f8fbf, flatShading: true, roughness: 0.55, metalness: 0.15 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.6;
  water.receiveShadow = true;
  scene.add(water);

  // Island base (sand rim)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(21.5, 24, 2.4, 10, 1),
    new THREE.MeshStandardMaterial({ color: 0xe0c184, flatShading: true, roughness: 1 })
  );
  base.position.y = -1.2;
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);

  // Horizontal ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x58a05a, flatShading: true, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  // Low-poly tree geometry: trunk + two cone tiers, merged with vertex colors
  function buildTreeGeometry() {
    const parts = [
      { g: new THREE.CylinderGeometry(0.16, 0.26, 1.0, 5), color: new THREE.Color(0x7a4a2b), dy: 0.5 },
      { g: new THREE.ConeGeometry(1.25, 2.0, 6), color: new THREE.Color(0x2f7d4c), dy: 1.9 },
      { g: new THREE.ConeGeometry(0.8, 1.6, 6), color: new THREE.Color(0x3f9d5f), dy: 3.0 }
    ];
    const pos = [], norm = [], col = [];
    for (const part of parts) {
      part.g.translate(0, part.dy, 0);
      const ng = part.g.toNonIndexed();
      const p = ng.attributes.position.array;
      const n = ng.attributes.normal.array;
      for (let i = 0; i < p.length / 3; i++) {
        pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        norm.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
        col.push(part.color.r, part.color.g, part.color.b);
      }
      ng.dispose();
      part.g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }

  // Deterministic scatter of trees within 25 units of the origin
  let seed = 42;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  const trees = [];
  let attempts = 0;
  while (trees.length < 36 && attempts < 4000) {
    attempts++;
    const r = 3.5 + Math.sqrt(rand()) * 16.5; // 3.5..20
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    let ok = true;
    for (const t of trees) {
      const dx = t.x - x, dz = t.z - z;
      if (dx * dx + dz * dz < 2.7 * 2.7) { ok = false; break; }
    }
    if (!ok) continue;
    trees.push({ x, z, s: 0.7 + rand() * 0.9, rot: rand() * Math.PI * 2, phase: rand() * Math.PI * 2 });
  }

  const treeGeo = buildTreeGeometry();
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
  treeMesh.castShadow = true;
  treeMesh.receiveShadow = false;
  scene.add(treeMesh);

  const dummy = new THREE.Object3D();

  // Decorative rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, flatShading: true, roughness: 1 });
  const rockPositions = [[-14, 6], [11, -13], [16, 9], [-9, -15]];
  for (const [rx, rz] of rockPositions) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9 + Math.abs(rx) * 0.02, 0), rockMat);
    rock.position.set(rx, 0.4, rz);
    rock.rotation.set(rx, rz, rx * 0.5);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // A few low-poly clouds
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
  const clouds = [];
  for (let i = 0; i < 4; i++) {
    const cloud = new THREE.Group();
    const n = 3 + (i % 2);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + (j % 2) * 0.7, 0), cloudMat);
      puff.position.set(j * 1.8 - n, (j % 2) * 0.4, (j % 3) * 0.6);
      puff.castShadow = true;
      cloud.add(puff);
    }
    cloud.position.set(-30 + i * 18, 14 + (i % 2) * 3, -18 + i * 9);
    scene.add(cloud);
    clouds.push(cloud);
  }

  function update(t) {
    // Trees sway gently; matrices are a pure function of t
    for (let i = 0; i < trees.length; i++) {
      const tr = trees[i];
      const sway = Math.sin(t * 1.4 + tr.phase) * 0.05;
      dummy.position.set(tr.x, 0, tr.z);
      dummy.rotation.set(sway, tr.rot, sway * 0.6);
      dummy.scale.setScalar(tr.s);
      dummy.updateMatrix();
      treeMesh.setMatrixAt(i, dummy.matrix);
    }
    treeMesh.instanceMatrix.needsUpdate = true;

    // Clouds drift slowly
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      c.position.x = -30 + i * 18 + Math.sin(t * 0.12 + i * 1.7) * 5;
      c.position.y = 14 + (i % 2) * 3 + Math.sin(t * 0.5 + i) * 0.4;
    }

    // Water shimmer
    water.position.y = -1.6 + Math.sin(t * 0.8) * 0.12;
  }

  update(0);

  return { scene, camera, update };
}
