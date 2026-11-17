import * as THREE from 'three';
import { createTram, setTramNight, SECTION_OFFSETS, CAB_LEN, MID_LEN } from './tram.js';
import { TRACK_HALF } from './route.js';

// Exploatarea liniei T1: profil de viteza (acceleratie 1,1 m/s², franare 1,1 m/s², max 70 km/h,
// limite in curbe si pe strazi), opriri de 20 s in statii, doua vehicule in naveta continua.
export const VMAX = 70 / 3.6;
export const ACC = 1.1, DEC = 1.1, DWELL = 20, TERM_DWELL = 40;

export function createFleet(ctx, route) {
  const L = route.length;
  const DS = 2;
  const n = Math.ceil(L / DS) + 1;
  const vlim = new Float32Array(n);
  const tg0 = new THREE.Vector3(), tg1 = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = Math.min(L, i * DS);
    route.tangent(Math.max(0, s - 6), tg0); route.tangent(Math.min(L, s + 6), tg1);
    const a0 = Math.atan2(tg0.x, tg0.z), a1 = Math.atan2(tg1.x, tg1.z);
    let da = Math.abs(a1 - a0); if (da > Math.PI) da = 2 * Math.PI - da;
    const R = da < 1e-4 ? 1e5 : 12 / da;
    let v = Math.min(VMAX, Math.sqrt(0.9 * R));
    // circulatie pe strada in oras: 50 km/h; zona aparatelor de cale la terminale: 25 km/h
    if (s > 120 && s < 3400) v = Math.min(v, 50 / 3.6);
    if (s < 110 || s > L - 110) v = Math.min(v, 25 / 3.6);
    vlim[i] = v;
  }
  const stops = route.stops;
  for (const st of stops) vlim[Math.round(st.s / DS)] = 0;
  // treceri: accelerare inainte, franare inapoi (profil simetric => valabil in ambele sensuri)
  const prof = Float32Array.from(vlim);
  for (let i = 1; i < n; i++) prof[i] = Math.min(prof[i], Math.sqrt(prof[i - 1] ** 2 + 2 * ACC * DS));
  for (let i = n - 2; i >= 0; i--) prof[i] = Math.min(prof[i], Math.sqrt(prof[i + 1] ** 2 + 2 * DEC * DS));
  const vAt = (s) => {
    const f = THREE.MathUtils.clamp(s / DS, 0, n - 1.001);
    const i = Math.floor(f), t = f - i;
    return prof[i] * (1 - t) + prof[i + 1] * t;
  };
  // timp de parcurs intre statii (pentru afisaje si ETA)
  const runTime = (sA, sB) => {
    let T = 0;
    const a = Math.min(sA, sB), b = Math.max(sA, sB);
    for (let s = a; s < b; s += DS) T += Math.min(DS, b - s) / Math.max(0.8, vAt(s + DS / 2));
    return T;
  };
  const legTimes = [];
  for (let k = 0; k < stops.length - 1; k++) legTimes.push(runTime(stops[k].s, stops[k + 1].s));
  const tripTime = legTimes.reduce((a, b) => a + b, 0) + DWELL * (stops.length - 2);

  // ---------------- vehicule ----------------
  const vehicles = [];
  const mk = (id, color) => {
    const tram = createTram(ctx, id);
    const v = { id, tram, s: stops[0].s, dir: 1, v: 0, mode: 'dwell', timer: 8, target: 1, color, odo: 0, arrivedAt: -1, kmh: 0 };
    vehicles.push(v);
    return v;
  };
  const v1 = mk(1, '#f97316');
  const v2 = mk(2, '#fb923c');
  // al doilea pleaca de la hub, in sens invers
  function resetVehicle(v, atEnd, wait) {
    if (atEnd) { v.s = stops[stops.length - 1].s; v.dir = -1; v.target = stops.length - 2; }
    else { v.s = stops[0].s; v.dir = 1; v.target = 1; }
    v.mode = 'dwell'; v.timer = wait; v.v = 0;
    v.tram.setDirection(v.dir);
  }
  resetVehicle(v1, false, 6);
  resetVehicle(v2, true, 6);

  const listeners = { arrive: [] };
  function step(v, dt) {
    if (v.mode === 'dwell') {
      v.v = 0;
      v.timer -= dt;
      const atTerm = v.target === 1 && v.dir === 1 && Math.abs(v.s - stops[0].s) < 1 || v.target === stops.length - 2 && v.dir === -1 && Math.abs(v.s - stops[stops.length - 1].s) < 1;
      v.charging = atTerm;
      if (v.timer <= 0) { v.mode = 'run'; v.charging = false; }
      return;
    }
    const goal = stops[v.target].s;
    let sp = Math.max(0.8, vAt(v.s));
    // acceleratie limitata si la plecare (nu doar din profil)
    sp = Math.min(sp, v.v + ACC * dt + 0.05);
    v.v = sp;
    let ns = v.s + v.dir * sp * dt;
    v.odo += sp * dt;
    if ((v.dir > 0 && ns >= goal) || (v.dir < 0 && ns <= goal)) {
      ns = goal;
      v.v = 0;
      v.mode = 'dwell';
      const last = v.target === stops.length - 1 || v.target === 0;
      v.timer = last ? TERM_DWELL : DWELL;
      const arrivedIdx = v.target;
      if (last) { v.dir = -v.dir; v.tram.setDirection(v.dir); }
      v.target = v.target + v.dir;
      for (const fn of listeners.arrive) fn(v, arrivedIdx);
    }
    v.s = ns;
  }

  // ---------------- asezare pe cale ----------------
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), f = new THREE.Vector3();
  const halfLens = [CAB_LEN / 2, MID_LEN / 2, CAB_LEN / 2];
  function latFor(v, s) { return v.dir * TRACK_HALF * route.laneRamp(s); }
  function place(v) {
    const secs = v.tram.sections;
    for (let k = 0; k < 3; k++) {
      const sc = v.s + SECTION_OFFSETS[k];
      const hb = halfLens[k] - 1.3;
      const sF = sc + hb, sB = sc - hb;
      route.offsetPoint(Math.min(L, Math.max(0, sF)), latFor(v, sF), pa);
      route.offsetPoint(Math.min(L, Math.max(0, sB)), latFor(v, sB), pb);
      // extrapolare dincolo de capete (nu e cazul in exploatare normala)
      f.subVectors(pa, pb);
      const len = f.length() || 1;
      f.divideScalar(len);
      const sec = secs[k];
      sec.position.addVectors(pa, pb).multiplyScalar(0.5);
      sec.position.y += 0.16;
      const yaw = Math.atan2(-f.x, -f.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
      if (k === 2) sec.rotation.set(-pitch, yaw + Math.PI, 0, 'YXZ');
      else sec.rotation.set(pitch, yaw, 0, 'YXZ');
    }
  }

  // ---------------- afisaje ----------------
  // obiect reutilizat pe vehicul (fara alocari in fiecare cadru)
  function infoFor(v) {
    const o = v.info || (v.info = { next: '', arriving: false, kmh: 0, dest: '', idx: 0 });
    o.dest = v.dir > 0 ? stops[stops.length - 1].name : stops[0].name;
    if (v.mode === 'dwell') {
      const cur = THREE.MathUtils.clamp(v.target - v.dir, 0, stops.length - 1);
      o.next = stops[cur].name; o.arriving = true; o.kmh = 0; o.idx = cur;
    } else {
      o.next = stops[v.target].name; o.arriving = false; o.kmh = v.v * 3.6; o.idx = v.target;
    }
    return o;
  }

  let simScale = 1, paused = false;
  ctx.addUpdate((dt, t) => {
    const sdt = paused ? 0 : dt * simScale;
    for (const v of vehicles) {
      // sub-pasi pentru viteze mari de simulare
      const nSub = Math.max(1, Math.ceil(sdt / 0.05));
      for (let k = 0; k < nSub; k++) step(v, sdt / nSub);
      place(v);
      v.kmh = v.v * 3.6;
      const info = infoFor(v);
      v.tram.updateScreen(t, info);
      v.tram.setDestination(info.dest);
      v.pantT = THREE.MathUtils.clamp((v.pantT || 0) + (v.charging ? dt : -dt) * 0.8, 0, 1);
      v.tram.setCharging(v.pantT);
    }
  });

  ctx.env.onChange((st) => {
    setTramNight(st.night);
    for (const v of vehicles) v.tram.setNight(st.night);
  });

  for (const v of vehicles) ctx.mapLive.push(() => ({ x: v.tram.sections[1].position.x, z: v.tram.sections[1].position.z, color: v.color }));

  return {
    vehicles, vAt, runTime, legTimes, tripTime, stops, resetVehicle, place,
    onArrive(fn) { listeners.arrive.push(fn); },
    setScale(k) { simScale = k; }, get scale() { return simScale; },
    setPaused(p) { paused = p; }, get paused() { return paused; },
    infoFor,
  };
}
