import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Cer, soare, lumini si ora zilei (0..24). Emite evenimente cand se schimba ora.
//  - culoarea soarelui depinde de inaltimea lui (portocaliu la rasarit / apus, alb-cald la amiaza);
//  - ceata (perspectiva aeriana) are EXACT culoarea cerului la orizont (esantionata din shader-ul Sky) =>
//    peisajul indepartat se topeste in cer, fara margine;
//  - camera umbrelor urmareste vederea: mica si clara la plimbare / in tren, mai mare cand camera orbitala e departe.
export function createEnvironment(ctx) {
  const { scene, renderer, camera } = ctx;

  // umbre PCF cu raza => margini mai moi (PCFSoftShadowMap ignora raza)
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const sky = new Sky();
  sky.scale.setScalar(40000);
  // cerul e fundal: desenat primul, fara test de adancime (altfel "taie" terenul de dincolo de 20 km)
  sky.material.depthTest = false;
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  scene.add(sky);
  ctx.addUpdate(() => sky.position.set(camera.position.x, 0, camera.position.z)); // cerul ramane centrat pe privitor

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 2.5;
  const sc = sun.shadow.camera;
  sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 2500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);

  scene.fog = new THREE.FogExp2(0xbfd4e6, 0.000058);

  // Stele (vizibile noaptea)
  const starPos = [];
  for (let i = 0; i < 2500; i++) {
    const u1 = Math.random(), v1 = Math.random() * 0.5 + 0.5; // doar emisfera de sus
    const th = u1 * Math.PI * 2, ph = Math.acos(2 * v1 - 1);
    starPos.push(Math.sin(ph) * Math.cos(th) * 30000, Math.cos(ph) * 30000, Math.sin(ph) * Math.sin(th) * 30000);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // Mediu de reflexie (altfel materialele metalice ies aproape negre)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // Lumina lunii (rece, fara umbre)
  const moon = new THREE.DirectionalLight(0x9db8ff, 0);
  moon.position.set(-3000, 5000, 2000);
  scene.add(moon);

  // ---------- culoarea cerului la orizont (pentru ceata) ----------
  // Randam cerul intr-o tinta mica, in virgula mobila (liniar, fara tone mapping), privind spre orizont in 8 directii.
  let skyProbe = null;
  try {
    const W = 8, H = 2, NV = 6; // NV vederi una langa alta, o singura citire (citirea opreste GPU-ul)
    const rt = new THREE.WebGLRenderTarget(W * NV, H, { type: THREE.FloatType, depthBuffer: false });
    rt.scissorTest = true;
    const s2 = new THREE.Scene();
    const m2 = new THREE.Mesh(sky.geometry, sky.material);
    m2.scale.setScalar(40000);
    m2.frustumCulled = false;
    s2.add(m2);
    const cam2 = new THREE.PerspectiveCamera(6, W / H, 1, 100000);
    const buf = new Float32Array(W * NV * H * 4);
    skyProbe = (out) => {
      let r = 0, g = 0, b = 0, n = 0;
      const prev = renderer.getRenderTarget();
      buf.fill(-1);
      for (let k = 0; k < NV; k++) {
        const a = (k / NV) * Math.PI * 2;
        cam2.position.set(0, 0, 0);
        cam2.lookAt(Math.cos(a), 0.035, Math.sin(a)); // ~2° deasupra orizontului
        rt.viewport.set(k * W, 0, W, H); rt.scissor.set(k * W, 0, W, H);
        renderer.setRenderTarget(rt);
        renderer.render(s2, cam2);
      }
      renderer.readRenderTargetPixels(rt, 0, 0, W * NV, H, buf);
      renderer.setRenderTarget(prev);
      for (let i = 0; i < buf.length; i += 4) {
        if (!(buf[i] >= 0) || buf[i] > 50) continue; // discul soarelui / valori invalide
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; n++;
      }
      if (!n || !(r + g + b > 0)) return false;
      out.setRGB(r / n, g / n, b / n);
      return true;
    };
  } catch (e) { skyProbe = null; }

  const listeners = [];
  const sunDir = new THREE.Vector3();
  const state = { hour: 11, night: 0 };
  const SUN_LOW = new THREE.Color(1.0, 0.46, 0.2), SUN_MID = new THREE.Color(1.0, 0.8, 0.6), SUN_HIGH = new THREE.Color(1.0, 0.96, 0.9);
  const fogDay = new THREE.Color();

  // Pascani ~47.26N: orbita aproximativa a soarelui (echinoctiu, sud = +z)
  function setHour(h) {
    state.hour = ((h % 24) + 24) % 24;
    const dayFrac = (state.hour - 6) / 12; // 0 rasarit, 1 apus
    const elev = THREE.MathUtils.degToRad(Math.sin(dayFrac * Math.PI) * 43);
    // azimut de la nord, in sens orar: est 90 (rasarit), sud 180 (amiaza), vest 270 (apus)
    const az = THREE.MathUtils.degToRad(90 + dayFrac * 180);
    sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    u.sunPosition.value.copy(sunDir);
    const elevDeg = THREE.MathUtils.radToDeg(elev);

    const dayness = THREE.MathUtils.clamp((elevDeg + 4) / 14, 0, 1);
    state.night = 1 - dayness;
    sun.intensity = 2.8 * dayness;
    // culoarea soarelui dupa inaltime
    const e = Math.max(0, elevDeg);
    if (e < 12) sun.color.copy(SUN_LOW).lerp(SUN_MID, THREE.MathUtils.smoothstep(e, 0, 12));
    else sun.color.copy(SUN_MID).lerp(SUN_HIGH, THREE.MathUtils.smoothstep(e, 12, 35));
    hemi.intensity = 0.32 + 0.65 * dayness;
    hemi.color.setHSL(0.6, 0.5 - 0.1 * dayness, 0.38 + 0.47 * dayness);
    hemi.groundColor.setHSL(0.22, 0.25, 0.08 + 0.18 * dayness);
    moon.intensity = 0.55 * state.night;
    starMat.opacity = THREE.MathUtils.smoothstep(state.night, 0.5, 1);
    renderer.toneMappingExposure = 0.75 + 0.2 * dayness;
    scene.environmentIntensity = 0.12 + 0.38 * dayness;
    sky.visible = true;
    u.rayleigh.value = 0.4 + 1.4 * dayness;
    // ceata = culoarea cerului la orizont (noaptea: albastru-inchis)
    const night = new THREE.Color().setHSL(0.62, 0.35, 0.025);
    let ok = false;
    try { ok = skyProbe ? skyProbe(fogDay) : false; } catch (err) { ok = false; }
    if (ok) scene.fog.color.copy(fogDay).lerp(night, THREE.MathUtils.smoothstep(state.night, 0.6, 1));
    else scene.fog.color.setHSL(0.6, 0.4, 0.06 + 0.73 * dayness);
    for (const fn of listeners) fn(state);
  }

  // ---------- umbrele urmaresc vederea ----------
  let shadowHalf = 220;
  const texel = new THREE.Vector3(), lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3();
  ctx.addUpdate(() => {
    const target = ctx.focusPoint || camera.position;
    const mode = ctx.controls?.mode;
    let half;
    if (mode === 'walk' || mode === 'ride') half = 90;
    else {
      // orbita: dupa distanta camerei fata de punctul privit (umbre doar in zona din jurul lui)
      const d = camera.position.distanceTo(target);
      half = THREE.MathUtils.clamp(d * 0.55, 120, 1100);
    }
    if (Math.abs(half - shadowHalf) / shadowHalf > 0.12) {
      shadowHalf = half;
      const dist = Math.max(1200, half * 1.6);
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = Math.max(10, dist - half * 1.5 - 400); sc.far = dist + half * 1.5 + 400;
      sc.updateProjectionMatrix();
      const tx = (2 * half) / sun.shadow.mapSize.x;
      sun.shadow.normalBias = Math.max(0.12, tx * 2.2);
      sun.shadow.radius = half > 400 ? 1.5 : 2.5;
    }
    // pozitia, aliniata la texelii hartii de umbre (fara "tremurat" cand camera se misca)
    const tx = (2 * shadowHalf) / sun.shadow.mapSize.x;
    lightRight.crossVectors(sunDir, THREE.Object3D.DEFAULT_UP).normalize();
    if (lightRight.lengthSq() < 1e-6) lightRight.set(1, 0, 0);
    lightUp.crossVectors(lightRight, sunDir).normalize();
    texel.set(target.x, ctx.terrain ? ctx.terrain.heightAt(target.x, target.z) : 0, target.z);
    const a = Math.round(texel.dot(lightRight) / tx) * tx - texel.dot(lightRight);
    const b = Math.round(texel.dot(lightUp) / tx) * tx - texel.dot(lightUp);
    texel.addScaledVector(lightRight, a).addScaledVector(lightUp, b);
    sun.target.position.copy(texel);
    sun.position.copy(texel).addScaledVector(sunDir, Math.max(1200, shadowHalf * 1.6));
    if (sunDir.y < 0.02) sun.position.y = sun.target.position.y + 20;
  });

  setHour(state.hour);

  return {
    sky, sun, hemi, state,
    setHour,
    get hour() { return state.hour; },
    get night() { return state.night; },
    isNight: () => state.night > 0.5,
    onChange(fn) { listeners.push(fn); fn(state); },
  };
}
