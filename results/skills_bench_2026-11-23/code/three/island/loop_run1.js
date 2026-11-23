function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 70, 160);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  camera.position.set(30, 28, 30);
  camera.lookAt(0, 1.5, 0);

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a5f3a, 0.65);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(25, 35, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  // Ground (plane, at least 20x20, receives shadows)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44),
    new THREE.MeshStandardMaterial({ color: 0x5aa15c, flatShading: true, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Island base (low-poly mound under the plane)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(23, 27, 4, 9, 1),
    new THREE.MeshStandardMaterial({ color: 0xd8c07a, flatShading: true, roughness: 1 })
  );
  base.position.y = -2.05;
  base.receiveShadow = true;
  base.castShadow = true;
  scene.add(base);

  // Helper: merge two geometries with a constant vertex color each
  function colored(geo, color) {
    const g = geo.toNonIndexed();
    const count = g.attributes.position.count;
    const c = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }

  function mergeGeoms(geoms) {
    let pos = [], norm = [], col = [];
    for (const g of geoms) {
      pos.push(...g.attributes.position.array);
      norm.push(...g.attributes.normal.array);
      col.push(...g.attributes.color.array);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }

  // Tree geometry: trunk + two-tier cone foliage, base at y=0
  const trunk = new THREE.CylinderGeometry(0.32, 0.45, 1.5, 5);
  trunk.translate(0, 0.75, 0);
  const cone1 = new THREE.ConeGeometry(1.7, 2.6, 6);
  cone1.translate(0, 2.6, 0);
  const cone2 = new THREE.ConeGeometry(1.15, 2.0, 6);
  cone2.translate(0, 4.2, 0);

  const treeGeo = mergeGeoms([
    colored(trunk, 0x7a4a2b),
    colored(cone1, 0x2e7d32),
    colored(cone2, 0x43a047)
  ]);

  const treeMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9
  });

  // Deterministic pseudo-random
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(187);

  const COUNT = 36;
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, COUNT);
  trees.castShadow = true;
  trees.receiveShadow = true;

  const data = [];
  for (let i = 0; i < COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 3 + rand() * 19; // within 22 units of origin
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    data.push({
      x, z,
      s: 0.7 + rand() * 0.8,
      rotY: rand() * Math.PI * 2,
      phase: rand() * Math.PI * 2,
      speed: 0.8 + rand() * 0.9
    });
  }

  const dummy = new THREE.Object3D();
  scene.add(trees);

  function layout(t) {
    for (let i = 0; i < COUNT; i++) {
      const d = data[i];
      const sway = Math.sin(t * d.speed + d.phase) * 0.05;
      const pulse = 1 + Math.sin(t * 1.3 + d.phase) * 0.03;
      dummy.position.set(d.x, 0, d.z);
      dummy.rotation.set(0, d.rotY, sway);
      dummy.scale.setScalar(d.s * pulse);
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;
  }
  layout(0);

  // A few low-poly rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8d8d, flatShading: true, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + rand() * 0.9, 0), rockMat);
    const angle = rand() * Math.PI * 2;
    const radius = 6 + rand() * 16;
    rock.position.set(Math.cos(angle) * radius, 0.3, Math.sin(angle) * radius);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  function update(t) {
    layout(t);
    sun.position.set(25 + Math.sin(t * 0.1) * 3, 35, 15 + Math.cos(t * 0.1) * 3);
  }

  return { scene, camera, update };
}
