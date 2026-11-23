function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 40, 120);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.set(9, 7, 11);
  camera.lookAt(0, 0, 0);

  // Lights: strong key + weak ambient
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
  key.position.set(12, 14, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.9);
  rim.position.set(-10, 4, -12);
  scene.add(rim);

  const ambient = new THREE.AmbientLight(0x8899bb, 0.35);
  scene.add(ambient);

  // Starfield (Points, no extra meshes)
  const starCount = 600;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 60 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.7, sizeAttenuation: true, fog: false })
  );
  scene.add(stars);

  // Soft glow sprite behind the cube (atmosphere, no mesh)
  const glowMat = new THREE.SpriteMaterial({
    color: 0x2a3f66,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(22, 22, 1);
  glow.position.set(0, 0, -6);
  scene.add(glow);

  // The lit cube
  const cubeGeo = new THREE.BoxGeometry(4, 4, 4);
  const cubeMat = new THREE.MeshStandardMaterial({
    color: 0x4f8fd0,
    metalness: 0.55,
    roughness: 0.3,
    emissive: 0x0a1a2e,
    emissiveIntensity: 0.6
  });
  const cube = new THREE.Mesh(cubeGeo, cubeMat);
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);

  // Ground disc to catch shadow
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshStandardMaterial({ color: 0x131a2a, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3.4;
  ground.receiveShadow = true;
  scene.add(ground);

  function update(t) {
    cube.rotation.y = t * 0.7;
    cube.rotation.x = Math.sin(t * 0.35) * 0.35;
    cube.position.y = Math.sin(t * 1.2) * 0.35;
    glow.material.opacity = 0.45 + Math.sin(t * 1.2) * 0.12;
    stars.rotation.y = t * 0.01;
  }

  update(0);
  return { scene, camera, update };
}
