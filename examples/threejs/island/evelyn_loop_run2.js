// Written by Inkling 2 Mini (Q4_K_M) for the task "Low-poly island with instanced trees".
// Condition: Inkling + Evelyn (loop, no notes). Seed 1201. Run 2 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd3f4);
  scene.fog = new THREE.Fog(0x8fd3f4, 60, 120);

  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 300);
  camera.position.set(22, 20, 22);
  camera.lookAt(0, 0, 0);

  // --- Lights ---
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a7a44, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // --- Island base (low-poly rock) ---
  const baseGeo = new THREE.CylinderGeometry(18, 11, 5, 9, 1);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x9c7a52, flatShading: true });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -2.5;
  base.receiveShadow = true;
  scene.add(base);

  // --- Sand rim ---
  const rimGeo = new THREE.PlaneGeometry(38, 38);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0cf8e, flatShading: true });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.03;
  rim.receiveShadow = true;
  scene.add(rim);

  // --- Grass ground ---
  const groundGeo = new THREE.PlaneGeometry(34, 34, 1, 1);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x5fae4e, flatShading: true });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Deterministic pseudo-random ---
  let seed = 1234567;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  // --- Trees: ONE InstancedMesh ---
  const COUNT = 40;
  const treeGeo = new THREE.ConeGeometry(0.95, 2.6, 6);
  treeGeo.translate(0, 1.3, 0);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e7d3f, flatShading: true });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, COUNT);
  trees.castShadow = true;
  trees.receiveShadow = true;

  const treeData = [];
  for (let i = 0; i < COUNT; i++) {
    const r = Math.sqrt(rand()) * 21;           // within 25 units of origin
    const a = rand() * Math.PI * 2;
    const s = 0.7 + rand() * 0.9;
    treeData.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      sx: s,
      sy: s * (0.85 + rand() * 0.5),
      sz: s,
      rotY: rand() * Math.PI * 2,
      phase: rand() * Math.PI * 2
    });
  }
  scene.add(trees);

  // --- Rocks (low-poly garnish) ---
  const rockGeo = new THREE.IcosahedronGeometry(0.7, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8d8d, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const r = 4 + rand() * 17;
    const a = rand() * Math.PI * 2;
    rock.position.set(Math.cos(a) * r, 0.25, Math.sin(a) * r);
    const s = 0.5 + rand() * 0.9;
    rock.scale.set(s, s * 0.7, s);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // --- Clouds ---
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const cloud = new THREE.Group();
    const n = 2 + Math.floor(rand() * 2);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + rand() * 0.9, 0), cloudMat);
      puff.position.set(j * 1.7 - (n - 1) * 0.85, rand() * 0.5, rand() * 0.8 - 0.4);
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    cloud.position.set(-20 + rand() * 40, 13 + rand() * 3, -12 + rand() * 24);
    cloud.userData.baseX = cloud.position.x;
    cloud.userData.speed = 1.2 + rand() * 0.9;
    scene.add(cloud);
    clouds.push(cloud);
  }

  function wrap(v, min, max) {
    const range = max - min;
    return ((v - min) % range + range) % range + min;
  }

  // --- Animation state (pure function of t) ---
  const dummy = new THREE.Object3D();

  function update(t) {
    for (let i = 0; i < COUNT; i++) {
      const p = treeData[i];
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(
        Math.sin(t * 1.3 + p.phase) * 0.06,
        p.rotY,
        Math.cos(t * 1.1 + p.phase) * 0.06
      );
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;

    for (const c of clouds) {
      c.position.x = wrap(c.userData.baseX + t * c.userData.speed, -32, 32);
    }
  }

  update(0);

  return { scene, camera, update };
}
