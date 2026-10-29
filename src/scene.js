/**
 * Cinematic real-time backdrop built with three.js.
 *
 * This is the piece that stands in for an "Unreal Engine look" without Unreal:
 * physically based materials, exponential fog, volumetric-ish dust, an emissive
 * horizon grid and an UnrealBloom post pass. It runs on the visitor's GPU in a
 * plain browser tab, which is exactly why it can be hosted as a normal website.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export function createBackdrop(canvas, { onFpsChange } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.warn('WebGL unavailable, falling back to a static gradient.', error);
    return { dispose() {}, setIntensity() {} };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#04060b');
  scene.fog = new THREE.FogExp2('#04060b', 0.028);

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 260);
  camera.position.set(0, 7.5, 26);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // ---- lights -------------------------------------------------------------
  scene.add(new THREE.HemisphereLight('#4fd6ff', '#0a0616', 0.55));

  const key = new THREE.PointLight('#3ee8ff', 260, 140, 2);
  key.position.set(-16, 16, 12);
  scene.add(key);

  const rim = new THREE.PointLight('#ff4fd8', 220, 150, 2);
  rim.position.set(20, 9, -18);
  scene.add(rim);

  const sun = new THREE.DirectionalLight('#bfe9ff', 0.9);
  sun.position.set(6, 22, 10);
  scene.add(sun);

  // ---- floor grid ---------------------------------------------------------
  const floorGroup = new THREE.Group();
  floorGroup.position.y = -6;
  scene.add(floorGroup);

  const gridMaterial = new THREE.LineBasicMaterial({
    color: '#1de5ff',
    transparent: true,
    opacity: 0.28,
  });
  const grid = new THREE.GridHelper(320, 160, '#22d3ee', '#0e7490');
  grid.material = gridMaterial;
  grid.material.transparent = true;
  floorGroup.add(grid);

  const glowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({
      color: '#04121a',
      metalness: 0.95,
      roughness: 0.35,
      emissive: '#031a22',
      emissiveIntensity: 0.6,
    }),
  );
  glowFloor.rotation.x = -Math.PI / 2;
  glowFloor.position.y = -0.35;
  floorGroup.add(glowFloor);

  // ---- floating shards ----------------------------------------------------
  const shardGeo = new THREE.IcosahedronGeometry(1, 1);
  const shardMaterials = [
    new THREE.MeshStandardMaterial({ color: '#0c2b3a', metalness: 1, roughness: 0.22, emissive: '#0aa3c2', emissiveIntensity: 0.35, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#2b1030', metalness: 1, roughness: 0.3, emissive: '#c026d3', emissiveIntensity: 0.25, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#101a24', metalness: 0.85, roughness: 0.15, emissive: '#67e8f9', emissiveIntensity: 0.12, flatShading: true }),
  ];

  const shards = [];
  const random = mulberry32(20261030);
  for (let i = 0; i < 26; i += 1) {
    const mesh = new THREE.Mesh(shardGeo, shardMaterials[i % shardMaterials.length]);
    const scale = 0.5 + random() * 2.4;
    mesh.scale.set(scale * (0.6 + random()), scale * (0.5 + random()), scale);
    mesh.position.set((random() - 0.5) * 70, -3 + random() * 22, -30 + random() * 40);
    mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    mesh.userData.spin = new THREE.Vector3((random() - 0.5) * 0.16, (random() - 0.5) * 0.2, (random() - 0.5) * 0.12);
    mesh.userData.baseY = mesh.position.y;
    mesh.userData.phase = random() * Math.PI * 2;
    scene.add(mesh);
    shards.push(mesh);
  }

  // ---- dust ---------------------------------------------------------------
  const dustCount = 900;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPositions[i * 3] = (random() - 0.5) * 120;
    dustPositions[i * 3 + 1] = random() * 40 - 6;
    dustPositions[i * 3 + 2] = (random() - 0.5) * 120;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: '#9be8ff',
      size: 0.16,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  scene.add(dust);

  // ---- horizon ring -------------------------------------------------------
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(46, 0.12, 8, 240),
    new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.5 }),
  );
  ring.position.set(0, 4, -46);
  ring.rotation.x = 0.12;
  scene.add(ring);

  // ---- post processing ----------------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.95, 0.75, 0.22);
  composer.addPass(bloom);

  // ---- interaction --------------------------------------------------------
  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const onPointerMove = (event) => {
    target.x = (event.clientX / window.innerWidth - 0.5) * 2;
    target.y = (event.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
  };
  window.addEventListener('resize', resize);

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  let running = true;
  let frame = 0;
  let quality = 1;
  const clock = new THREE.Clock();

  const onVisibility = () => {
    running = !document.hidden;
    if (running) {
      clock.getDelta();
      frame = requestAnimationFrame(animate);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  function animate() {
    if (!running) return;
    frame = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    pointer.x += (target.x - pointer.x) * 0.045;
    pointer.y += (target.y - pointer.y) * 0.045;

    camera.position.x = pointer.x * 4.2 + Math.sin(elapsed * 0.08) * 1.6;
    camera.position.y = 7.5 - pointer.y * 2.2 + Math.sin(elapsed * 0.11) * 0.4;
    camera.lookAt(0, 3.2, -6);

    for (const mesh of shards) {
      mesh.rotation.x += mesh.userData.spin.x * delta;
      mesh.rotation.y += mesh.userData.spin.y * delta;
      mesh.rotation.z += mesh.userData.spin.z * delta;
      mesh.position.y = mesh.userData.baseY + Math.sin(elapsed * 0.5 + mesh.userData.phase) * 0.55;
    }

    dust.rotation.y = elapsed * 0.014;
    ring.material.opacity = 0.34 + Math.sin(elapsed * 0.7) * 0.12;
    key.intensity = 240 + Math.sin(elapsed * 0.9) * 40;
    gridMaterial.opacity = 0.22 + Math.sin(elapsed * 0.5) * 0.06;

    composer.render();
  }

  if (reducedMotion) {
    composer.render();
  } else {
    animate();
  }

  // Adaptive quality: drop the bloom pass if the machine struggles.
  let last = performance.now();
  let frames = 0;
  const fpsTimer = setInterval(() => {
    frames += 1;
    const now = performance.now();
    if (now - last > 1000) {
      const fps = Math.round((frames * 1000) / (now - last));
      onFpsChange?.(fps, quality);
      if (fps < 32 && quality === 1) {
        quality = 0.75;
        bloom.enabled = false;
        renderer.setPixelRatio(Math.min(1, window.devicePixelRatio));
      }
      frames = 0;
      last = now;
    }
  }, 1000);

  resize();

  return {
    dispose() {
      running = false;
      cancelAnimationFrame(frame);
      clearInterval(fpsTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      composer.dispose();
      renderer.dispose();
    },
    setIntensity(value) {
      bloom.strength = value;
      renderer.toneMappingExposure = 0.75 + value * 0.45;
    },
  };
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
