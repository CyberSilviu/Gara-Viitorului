import * as THREE from 'three';
import { Batch, panelGeo } from './builder.js';
import { RAIL_TOP, toLocal } from './frame.js';

// Trenuri CFR animate pe traseele OSM reale (+-1.5 km): sosesc, opresc la peron cu usile deschise, pleaca.
// Directia se schimba la fiecare ciclu (vin cand dinspre nord, cand dinspre sud).

function std(name, o) { const m = new THREE.MeshStandardMaterial(o); m.name = name; return m; }

class Route {
  constructor(pts) {
    this.p = pts;
    this.s = [0];
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.s[this.s.length - 1];
  }
  at(s, out) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    const t = (s - this.s[lo]) / (this.s[hi] - this.s[lo] || 1);
    out[0] = this.p[lo][0] + (this.p[hi][0] - this.p[lo][0]) * t;
    out[1] = this.p[lo][1] + (this.p[hi][1] - this.p[lo][1]) * t;
    return out;
  }
  // arc-lungimea punctului cel mai apropiat de lz local dat (pe zona statiei)
  sAtLocalZ(lz) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < this.p.length; i++) {
      const d = Math.abs(toLocal(this.p[i][0], this.p[i][1])[1] - lz);
      if (d < bd) { bd = d; best = i; }
    }
    return this.s[best];
  }
}

// profil lateral al vagonului (lungime pe x, inaltime pe y), cu bot aerodinamic la capete
function carShape(L, noseF, noseR) {
  const s = new THREE.Shape();
  const h = 4.05, y0 = 0.55, half = L / 2;
  s.moveTo(-half + (noseR ? 0.3 : 0), y0);
  s.lineTo(half - (noseF ? 0.3 : 0), y0);
  if (noseF) {
    s.lineTo(half, 1.1);
    s.quadraticCurveTo(half + 0.15, 2.1, half - 0.7, 3.1);
    s.quadraticCurveTo(half - 1.6, h, half - 2.8, h);
  } else s.lineTo(half, h);
  if (noseR) {
    s.lineTo(-half + 2.8, h);
    s.quadraticCurveTo(-half + 1.6, h, -half + 0.7, 3.1);
    s.quadraticCurveTo(-half - 0.15, 2.1, -half, 1.1);
  } else s.lineTo(-half, h);
  s.closePath();
  return s;
}

function buildCar(mats, spec, L, noseF, noseR, withPanto) {
  const W = 2.9;
  const car = new THREE.Group();
  const B = new Batch('vagon');
  const geo = new THREE.ExtrudeGeometry(carShape(L, noseF, noseR), { depth: W - 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 6 });
  geo.rotateY(-Math.PI / 2);
  geo.translate((W - 0.12) / 2, 0, 0);
  B.add(mats.body, geo);
  // acoperis si sasiu
  B.aabb(mats.roof, -1.2, 4.05, -L / 2 + (noseR ? 3 : 0.3), 1.2, 4.2, L / 2 - (noseF ? 3 : 0.3));
  B.aabb(mats.dark, -1.3, 0.25, -L / 2 + 1, 1.3, 0.62, L / 2 - 1);
  for (const bz of [-L / 2 + 3.2, L / 2 - 3.2]) {
    B.aabb(mats.dark, -1.2, 0.05, bz - 1.4, 1.2, 0.6, bz + 1.4);
    for (const s of [-1, 1]) for (const w of [-0.9, 0.9]) B.add(mats.dark, new THREE.CylinderGeometry(0.42, 0.42, 0.14, 12).rotateZ(Math.PI / 2), s * 0.72, 0.42, bz + w);
  }
  // benzi decorative + ferestre
  const z0 = -L / 2 + (noseR ? 3.2 : 0.8), z1 = L / 2 - (noseF ? 3.2 : 0.8);
  for (const s of [-1, 1]) {
    B.aabb(mats.stripe, s * 1.452 - 0.01, spec.stripeY[0], -L / 2 + 0.6, s * 1.452 + 0.01, spec.stripeY[1], L / 2 - 0.6);
    B.aabb(mats.win, s * 1.455 - 0.012, 1.95, z0, s * 1.455 + 0.012, 2.95, z1);
  }
  // parbriz
  if (noseF) B.add(mats.win, new THREE.BoxGeometry(2.3, 1.1, 0.3), 0, 2.7, L / 2 - 0.4, 0, -0.75);
  if (noseR) B.add(mats.win, new THREE.BoxGeometry(2.3, 1.1, 0.3), 0, 2.7, -L / 2 + 0.4, 0, 0.75);
  // faruri
  if (noseF) for (const s of [-1, 1]) B.box(mats.light, s * 0.85, 1.35, L / 2 + 0.02, 0.3, 0.14, 0.06);
  if (noseR) for (const s of [-1, 1]) B.box(mats.tail, s * 0.85, 1.35, -L / 2 - 0.02, 0.3, 0.14, 0.06);
  // golurile usilor (vizibile cand usile se deschid)
  const doorsZ = spec.doors(L);
  for (const dz of doorsZ) for (const s of [-1, 1]) B.aabb(mats.dark, s * 1.456 - 0.006, 1.15, dz - 0.7, s * 1.456 + 0.006, 3.2, dz + 0.7);
  // pantograf
  if (withPanto) {
    B.aabb(mats.dark, -0.9, 4.2, -1.2, 0.9, 4.45, 1.2);
    const arm = (y0, y1, z0a, z1a) => { const L2 = Math.hypot(y1 - y0, z1a - z0a); B.add(mats.dark, new THREE.BoxGeometry(0.06, 0.06, L2), 0, (y0 + y1) / 2, (z0a + z1a) / 2, 0, -Math.atan2(y1 - y0, z1a - z0a)); };
    arm(4.45, 5.0, -0.9, 0.4); arm(5.0, 5.45, 0.4, -0.2);
    B.aabb(mats.dark, -0.9, 5.45, -0.25, 0.9, 5.5, -0.15);
  }
  if (spec.exhaust) B.aabb(mats.dark, -0.6, 4.2, -2, 0.6, 4.6, 1.5);
  B.build(car, { cast: true, receive: false });
  // foile usilor (doua mesh-uri: cele care gliseaza spre +z si spre -z), pe ambele parti
  const D1 = new Batch('usi+'), D2 = new Batch('usi-');
  for (const dz of doorsZ) for (const s of [-1, 1]) {
    D1.aabb(mats.door, s * 1.475 - 0.025, 1.15, dz, s * 1.475 + 0.025, 3.2, dz + 0.68);
    D2.aabb(mats.door, s * 1.475 - 0.025, 1.15, dz - 0.68, s * 1.475 + 0.025, 3.2, dz);
  }
  const [dPlus] = D1.build(car, { cast: false });
  const [dMinus] = D2.build(car, { cast: false });
  dPlus.matrixAutoUpdate = true; dMinus.matrixAutoUpdate = true;
  car.userData = { dPlus, dMinus };
  return car;
}

export function buildTrains(ctx, M, worldGroup, tracks) {
  const heightAt = ctx.terrain.heightAt;
  const winMat = std('ferestre-tren', { color: 0x1b2836, roughness: 0.15, metalness: 0.5, emissive: 0xffe2a8, emissiveIntensity: 0 });
  const common = {
    roof: std('acoperis-tren', { color: 0x8b9299, roughness: 0.5, metalness: 0.4 }),
    dark: std('sasiu', { color: 0x202428, roughness: 0.7, metalness: 0.3 }),
    win: winMat,
    light: std('faruri', { color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.5 }),
    tail: std('stopuri', { color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 0.8 }),
  };
  const specs = {
    emu: {
      name: 'Rame electrice (EMU) – magistrala 500', cars: 3, carLen: 26.5, panto: [1],
      mats: { ...common, body: std('caroserie-emu', { color: 0xf1f3f5, roughness: 0.35, metalness: 0.25 }), stripe: std('banda-emu', { color: 0x0b4ea2, roughness: 0.4 }), door: std('usi-emu', { color: 0xf2c200, roughness: 0.4 }) },
      stripeY: [0.7, 1.15], doors: (L) => [-L / 4, L / 4],
      ids: { 1: { type: 'IR', no: 1662, dest: 'București Nord', via: 'Roman · Bacău · Adjud' }, '-1': { type: 'IR', no: 1765, dest: 'Vicșani', via: 'Suceava' } },
      track: 'L2', stopZ: 40, color: '#e11d48',
    },
    dmu: {
      name: 'Automotor diesel (DMU) – linia 606', cars: 2, carLen: 25, panto: [],
      mats: { ...common, body: std('caroserie-dmu', { color: 0x1e40af, roughness: 0.4, metalness: 0.2 }), stripe: std('banda-dmu', { color: 0xf8fafc, roughness: 0.4 }), door: std('usi-dmu', { color: 0xe5e7eb, roughness: 0.4 }) },
      stripeY: [2.95, 3.35], doors: (L) => [-L / 2 + 5, L / 2 - 5], exhaust: true,
      ids: { 1: { type: 'R', no: 5522, dest: 'Iași', via: 'Târgu Frumos' }, '-1': { type: 'R', no: 5521, dest: 'Târgu Neamț', via: 'Topile' } },
      track: 'L4', stopZ: 45, color: '#2563eb',
    },
  };

  const trains = [];
  let k = 0;
  for (const sp of Object.values(specs)) {
    const tr = tracks[sp.track];
    if (!tr || !tr.route || tr.route.length < 2) continue;
    const route = new Route(tr.route);
    const group = new THREE.Group();
    group.name = sp.name;
    worldGroup.add(group);
    const cars = [];
    for (let i = 0; i < sp.cars; i++) {
      const car = buildCar(sp.mats, sp, sp.carLen, i === 0, i === sp.cars - 1, sp.panto.includes(i));
      group.add(car);
      cars.push(car);
    }
    const Ltot = sp.cars * sp.carLen + (sp.cars - 1) * 1.0;
    const sStop = route.sAtLocalZ(sp.stopZ);
    trains.push({ sp, route, group, cars, Ltot, sStop, dir: k % 2 ? -1 : 1, t0: -k * 95, state: null });
    k++;
  }

  // profil de miscare: apropiere (croaziera + franare), stationare, plecare (accelerare + croaziera), pauza
  const V = 19, AD = 0.55, AA = 0.5, DWELL = 42, PAUSE = 25;
  function motion(tr, t) {
    const room = Math.min(tr.sStop, tr.route.length - tr.sStop) - tr.Ltot / 2 - 5;
    const D1 = Math.max(150, Math.min(1350, room)), D2 = D1;
    const brake = (V * V) / (2 * AD), tb = V / AD;
    const tc1 = Math.max(0, (D1 - brake) / V);
    const acc = (V * V) / (2 * AA), ta = V / AA;
    const tc2 = Math.max(0, (D2 - acc) / V);
    const T1 = tc1 + tb, T2 = T1 + DWELL, T3 = T2 + ta + tc2, T4 = T3 + PAUSE;
    let u = t - tr.t0;
    if (u < 0) u = ((u % T4) + T4) % T4;
    const cycle = Math.floor(u / T4);
    u -= cycle * T4;
    let d, phase, rem = 0, open = 0;
    if (u < tc1) { d = V * u; phase = 'approach'; rem = D1 - d; }
    else if (u < T1) { const q = u - tc1; d = D1 - brake + V * q - 0.5 * AD * q * q; phase = 'approach'; rem = D1 - d; }
    else if (u < T2) { d = D1; phase = 'dwell'; const q = u - T1; open = THREE.MathUtils.clamp(Math.min(q - 3, DWELL - 6 - q) / 2, 0, 1); }
    else if (u < T3) { const q = u - T2; d = D1 + (q < ta ? 0.5 * AA * q * q : acc + V * (q - ta)); phase = 'depart'; }
    else { d = D1 + D2; phase = 'hidden'; }
    return { d, phase, rem, open, cycle, D1 };
  }

  const P = [0, 0], Q = [0, 0];
  // starea pe linii (pentru ecrane si benzile LED): live[nrLinie] = { phase, rem, train } sau null — obiecte refolosite (fara alocari pe cadru)
  const live = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  for (const tr of trains) tr.liveState = { phase: '', rem: 0, train: null };
  function update(dt, t) {
    for (let l = 1; l <= 6; l++) live[l] = null;
    for (const tr of trains) {
      const m = motion(tr, t);
      const dir = m.cycle % 2 ? -tr.dir : tr.dir;
      const c = tr.sStop - dir * m.D1 + dir * m.d;
      tr.group.visible = m.phase !== 'hidden';
      tr.state = m;
      tr.c = c; tr.curDir = dir;
      if (!tr.group.visible) continue;
      const no = +tr.sp.track.slice(1);
      if (m.phase === 'dwell' || (m.phase === 'approach' && m.rem < 700) || (m.phase === 'depart' && m.d - m.D1 < 120)) {
        const ls = tr.liveState;
        ls.phase = m.phase; ls.rem = m.rem; ls.train = tr.sp.ids[dir];
        live[no] = ls;
      }
      for (let i = 0; i < tr.cars.length; i++) {
        const car = tr.cars[i];
        const sc = c + dir * (tr.Ltot / 2 - tr.sp.carLen / 2 - i * (tr.sp.carLen + 1));
        const b = tr.sp.carLen * 0.36;
        route_at(tr.route, sc - dir * b, P);
        route_at(tr.route, sc + dir * b, Q);
        const x = (P[0] + Q[0]) / 2, z = (P[1] + Q[1]) / 2;
        car.position.set(x, heightAt(x, z) + RAIL_TOP, z);
        car.rotation.y = Math.atan2(Q[0] - P[0], Q[1] - P[1]);
        const { dPlus, dMinus } = car.userData;
        dPlus.position.z = m.open * 0.66; dMinus.position.z = -m.open * 0.66;
        dPlus.scale.x = dMinus.scale.x = 1 + m.open * 0.015;
      }
    }
  }
  function route_at(r, s, out) { return r.at(s, out); }

  ctx.env.onChange((st) => { winMat.emissiveIntensity = 0.15 + st.night * 1.3; });
  for (const tr of trains) {
    ctx.mapLive.push(() => (tr.group.visible ? { x: tr.cars[0].position.x, z: tr.cars[0].position.z, color: tr.sp.color } : null));
  }
  return { trains, update, live };
}
