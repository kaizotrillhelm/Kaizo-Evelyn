// Written by Inkling 2 Mini (Q4_K_M) for the task "Solar system".
// Condition: Inkling + Evelyn (loop, no notes). Seed 1101. Run 2 of 2.
// The checks of js/test/three_verify_worker.js: passes all checks.
// Everything below this comment is the model's code, unchanged.

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
  camera.position.set(0, 10, 15);
  camera.lookAt(0, 0, 0);

  // Sun
  const sunMaterial = new THREE.MeshStandardMaterial({
    color: 0xffcc55,
    emissive: 0xff9922,
    emissiveIntensity: 2.2,
    roughness: 1,
    metalness: 0
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.3, 48, 48), sunMaterial);
  scene.add(sun);

  // Light at the sun's position
  const sunLight = new THREE.PointLight(0xffe2a8, 2.2, 0, 0);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x334466, 0.6));

  // Orbit rings (visual guides)
  function makeOrbitRing(radius) {
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x445577, transparent: true, opacity: 0.45 });
    return new THREE.Line(geometry, material);
  }

  // Planet definitions: radius at least 1 unit apart
  const planetDefs = [
    { radius: 3.2, size: 0.42, speed: 0.90, phase: 0.0, color: 0x66ccff },
    { radius: 5.4, size: 0.58, speed: 0.55, phase: 2.1, color: 0xff8866 },
    { radius: 7.8, size: 0.50, speed: 0.32, phase: 4.3, color: 0x88dd88 }
  ];

  const planets = planetDefs.map((def) => {
    scene.add(makeOrbitRing(def.radius));
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.size, 32, 32),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85, metalness: 0.05 })
    );
    scene.add(mesh);
    return { mesh, ...def };
  });

  function update(t) {
    sun.rotation.y = t * 0.25;
    sunMaterial.emissiveIntensity = 2.2 + 0.35 * Math.sin(t * 2.0);

    for (const p of planets) {
      const a = p.phase + p.speed * t;
      p.mesh.position.set(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
      p.mesh.rotation.y = t * 0.8 + p.phase;
    }
  }

  update(0);

  return { scene, camera, update };
}
