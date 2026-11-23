// Written by Inkling 2 Mini (Q4_K_M) for the task "Solar system".
// Condition: Inkling alone. Seed 1101. Run 2 of 2.
// The checks of js/test/three_verify_worker.js: FAILS the checks: expected exactly 4 SphereGeometry meshes (a sun and 3 planets), found 5.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);

  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 200);
  camera.position.set(0, 9, 15);
  camera.lookAt(0, 0, 0);

  // --- Sun ---
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0xff8800,
    emissiveIntensity: 2.2,
    roughness: 1,
    metalness: 0
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 32), sunMat);
  scene.add(sun);

  // Soft additive halo around the sun
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff9933,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.75, 32, 32), haloMat);
  scene.add(halo);

  // --- Lights ---
  const sunLight = new THREE.PointLight(0xfff2dd, 60, 0, 2);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x334455, 0.7));

  // --- Orbit rings ---
  function makeRing(radius) {
    const pts = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const ring = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
      color: 0x3a4a6a,
      transparent: true,
      opacity: 0.55
    }));
    scene.add(ring);
  }

  // --- Planets (radii at least 1 unit apart) ---
  const configs = [
    { radius: 3.0, size: 0.35, color: 0x66ccff, speed: 1.2, phase: 0.0 },
    { radius: 5.0, size: 0.50, color: 0xff8866, speed: 0.7, phase: 2.1 },
    { radius: 7.0, size: 0.45, color: 0x99dd77, speed: 0.4, phase: 4.2 }
  ];

  const planets = [];
  for (const cfg of configs) {
    makeRing(cfg.radius);
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      roughness: 0.75,
      metalness: 0.1
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(cfg.size, 24, 24), mat);
    scene.add(mesh);
    planets.push({ mesh, radius: cfg.radius, speed: cfg.speed, phase: cfg.phase });
  }

  // --- Starfield (static, build-time only) ---
  const starCount = 500;
  const starPos = new Float32Array(starCount * 3);
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < starCount; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = 45 + rand() * 30;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    starPos[i * 3] = r * s * Math.cos(theta);
    starPos[i * 3 + 1] = r * u;
    starPos[i * 3 + 2] = r * s * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.35,
    sizeAttenuation: true
  }));
  scene.add(stars);

  // --- Animation (pure function of t) ---
  function update(t) {
    for (const p of planets) {
      const ang = p.phase + p.speed * t;
      p.mesh.position.set(Math.cos(ang) * p.radius, 0, Math.sin(ang) * p.radius);
      p.mesh.rotation.y = t * 1.5 + p.phase;
    }
    sun.rotation.y = t * 0.2;
    const pulse = 1 + 0.03 * Math.sin(t * 2.0);
    sun.scale.setScalar(pulse);
    halo.scale.setScalar(pulse);
    sunMat.emissiveIntensity = 2.2 + 0.5 * Math.sin(t * 2.0);
    haloMat.opacity = 0.16 + 0.05 * Math.sin(t * 2.0);
  }

  update(0);

  return { scene, camera, update };
}
