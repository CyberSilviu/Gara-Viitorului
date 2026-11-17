import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Motorul 3D: renderer, scena, camera, bucla de animatie si registrul de "update"-uri.
export function createEngine(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.3, 45000);
  camera.position.set(-260, 180, 320);

  const clock = new THREE.Clock();
  const updates = [];
  const raycaster = new THREE.Raycaster();

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const engine = {
    THREE, renderer, labelRenderer, scene, camera, clock, raycaster, container,
    // fn(dt, elapsed) apelata in fiecare cadru
    addUpdate(fn) { updates.push(fn); return () => updates.splice(updates.indexOf(fn), 1); },
    start(beforeRender) {
      renderer.setAnimationLoop(() => {
        const dt = Math.min(clock.getDelta(), 0.1);
        const t = clock.elapsedTime;
        for (let i = 0; i < updates.length; i++) updates[i](dt, t);
        if (beforeRender) beforeRender(dt, t);
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
      });
    },
    // pas manual (depanare / teste automate cand fereastra nu e vizibila)
    step(n = 1, dt = 1 / 30) {
      let t = clock.elapsedTime;
      for (let k = 0; k < n; k++) { t += dt; for (let i = 0; i < updates.length; i++) updates[i](dt, t); }
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    },
  };
  return engine;
}
