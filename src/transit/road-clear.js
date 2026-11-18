// Relatia liniei T1 cu drumurile si caile ferate desenate de oras (logica pura, fara Three.js –
// se poate testa in Node).
import { GROUND_LIFT, roadStyle } from '../core/util.js';
//
// Orasul (src/core/city.js) deseneaza drumurile OSM ca panglici drapate pe teren, ridicate cu GROUND_LIFT
// (src/core/util.js: minor 0,10 / major 0,13 / autostrada 0,15 / CF 0,20 m peste heightAt) si cu polygonOffset. T1 merge ~4,4 km pe strazi (Str. Garii, Vatra, Stefan cel Mare, DJ208L): daca platforma
// inierbata ar sta mai jos decat asfaltul, drumul ar acoperi sinele (palpaire / sine care „dispar” in cursa).
// De aceea calculam, pentru fiecare esantion al traseului:
//  - need[i]    = cota minima a platformei (suprafata drumului / CF de dedesubt + garda);
//  - surf[i]    = cota suprafetei celui mai inalt drum suprapus (NaN daca nu exista);
//  - onRoad[i]  = 1 daca platforma calca pe un drum (bordura devine perete vertical, nu taluz verde);
// si lista trecerilor la nivel (drumuri care taie axa sub un unghi > 20°; tratamentul – trecere la nivel cu
// sina la cota asfaltului sau pasaj – il alege route.js dupa profilul in lung).

// latimile panglicilor (aceleasi ca in src/core/city.js)
export const ROAD_WIDTH = {
  motorway: 24, motorway_link: 8, trunk: 14, trunk_link: 7, primary: 11, primary_link: 6, secondary: 9,
  tertiary: 8, residential: 6, unclassified: 5.5, living_street: 5, service: 3.5, pedestrian: 5,
};
// inaltarea suprafetei peste teren = GROUND_LIFT al orasului + 0,08 m rezerva (panglicile sunt drapate pe
// varfuri; intre varfuri pot iesi cu cativa cm peste heightAt) => platforma T1 sta la >= ~0,40 m peste heightAt pe strazi
const LIFT_RESERVE = 0.08;
const LAT = [-1, -0.5, 0.5, 1];
export const SURFACE_LIFT = {
  major: GROUND_LIFT.major + LIFT_RESERVE, minor: GROUND_LIFT.minor + LIFT_RESERVE,
  motorway: GROUND_LIFT.motorway + LIFT_RESERVE, rail: GROUND_LIFT.rail + LIFT_RESERVE,
};
export const ROAD_CLEAR = 0.25;   // platforma T1 sta cu cel putin atat peste asfalt
export const RAIL_CLEAR = 0.35;   // ... si peste panglicile CF ale orasului (au polygonOffset mai puternic)
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link']);
const CROSS_SIN = Math.sin((20 * Math.PI) / 180);

export function roadBucket(k) {
  return k.startsWith('motorway') ? 'motorway' : MAJOR.has(k) ? 'major' : 'minor';
}

// segmentele (drum / CF) ale orasului, cu semilatime si inaltare
export function cityStrips(osm, opts = {}) {
  const lift = { ...SURFACE_LIFT, ...(opts.lift || {}) };
  const width = { ...ROAD_WIDTH, ...(opts.width || {}) };
  const out = [];
  for (const w of osm.roads || []) {
    // drumurile in constructie sunt redesenate de motorway.js (cu cota impusa la trecerea T1)
    if (!w.p || w.p.length < 2 || w.k === 'construction') continue;
    const b = roadBucket(w.k);
    // latimea desenata de oras (util.js roadStyle, inclusiv benzile din OSM)
    const hw = (opts.width?.[w.k] || roadStyle(w).width || 5) / 2;
    for (let i = 0; i < w.p.length - 1; i++) out.push({ a: w.p[i], b: w.p[i + 1], hw, lift: lift[b], clear: ROAD_CLEAR, road: true, n: w.n || w.ref || w.k, ref: w.ref || '', k: w.k });
  }
  for (const w of osm.rails || []) {
    if (!w.p || w.p.length < 2 || w.k === 'platform') continue;
    const hw = (w.k === 'rail' ? 3.6 : 3) / 2;
    for (let i = 0; i < w.p.length - 1; i++) out.push({ a: w.p[i], b: w.p[i + 1], hw, lift: lift.rail, clear: RAIL_CLEAR, road: false, n: 'CF', k: w.k });
  }
  return out;
}

// grila spatiala simpla pentru segmente
export function segGrid(segs, cell = 40) {
  const map = new Map();
  for (const g of segs) {
    const pad = g.hw + 8;
    const x0 = Math.floor((Math.min(g.a[0], g.b[0]) - pad) / cell), x1 = Math.floor((Math.max(g.a[0], g.b[0]) + pad) / cell);
    const z0 = Math.floor((Math.min(g.a[1], g.b[1]) - pad) / cell), z1 = Math.floor((Math.max(g.a[1], g.b[1]) + pad) / cell);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = x + ',' + z;
      let arr = map.get(k);
      if (!arr) map.set(k, (arr = []));
      arr.push(g);
    }
  }
  return { near(x, z) { return map.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) || []; } };
}

// distanta de la (x,z) la segmentul ab; scrie punctul cel mai apropiat in out
export function distSeg(x, z, a, b, out) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  const qx = a[0] + dx * t, qz = a[1] + dz * t;
  if (out) { out[0] = qx; out[1] = qz; }
  return Math.hypot(x - qx, z - qz);
}

/**
 * P = puncte [x,z] ale axei T1, S = distante cumulate, H(x,z) = teren, edgeFn(s) = semilatimea platformei
 * (pana la fata exterioara a bordurii). Returneaza { need, surf, onRoad, crossings }.
 */
export function analyseRoads(P, S, osm, H, edgeFn, opts = {}) {
  const N = P.length;
  const need = new Float32Array(N).fill(-Infinity);
  const surf = new Float32Array(N).fill(NaN);
  const onRoad = new Uint8Array(N);
  const crossings = [];
  if (!osm) return { need, surf, onRoad, crossings };
  const segs = cityStrips(osm, opts);
  const grid = segGrid(segs);
  const q = [0, 0];
  for (let i = 0; i < N; i++) {
    const [x, z] = P[i];
    const e = edgeFn(S[i]) + 0.3;
    // directia laterala (pentru cotele de la marginile platformei: platforma e orizontala transversal)
    const A = P[Math.max(0, i - 1)], B = P[Math.min(N - 1, i + 1)];
    const tl = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const rx = -(B[1] - A[1]) / tl, rz = (B[0] - A[0]) / tl;
    const hC = H(x, z);
    for (const g of grid.near(x, z)) {
      if (distSeg(x, z, g.a, g.b, q) > g.hw + e) continue;
      // suprafata panglicii: cea mai inalta dintre axa drumului si punctele platformei (5 pe latime) aflate pe drum
      let hm = Math.max(H(q[0], q[1]), hC);
      for (const f of LAT) {
        const px = x + rx * e * f, pz = z + rz * e * f;
        if (distSeg(px, pz, g.a, g.b) <= g.hw + 0.5) hm = Math.max(hm, H(px, pz));
      }
      const ys = hm + g.lift;
      if (g.road) {
        onRoad[i] = 1;
        if (!(surf[i] >= ys)) surf[i] = ys;
      }
      need[i] = Math.max(need[i], ys + g.clear);
    }
  }
  // drumurile noi (in constructie, ex. DJ208L relocat) sunt desenate de motorway.js cu cota impusa = cota caii
  // la trecerea T1 => le tratam doar ca treceri (fara borduri), fara garda si fara dala proprie
  const pinnedW = { primary: 9.5, secondary: 8, tertiary: 7 };
  for (const w of osm.roads || []) {
    if (w.k !== 'construction' || !w.p || w.p.length < 2 || /motorway/.test(w.c || '')) continue;
    const hw = (pinnedW[w.c] || 5) / 2;
    for (let i = 0; i < w.p.length - 1; i++) segs.push({ a: w.p[i], b: w.p[i + 1], hw, lift: 0, clear: 0, road: true, pinned: true, n: w.n || w.ref || 'drum nou', k: 'construction' });
  }
  // treceri la nivel: drumuri care intersecteaza axa sub un unghi mare
  const RC = 40, rcell = new Map();
  for (let i = 0; i < N - 1; i++) {
    const x0 = Math.floor(Math.min(P[i][0], P[i + 1][0]) / RC), x1 = Math.floor(Math.max(P[i][0], P[i + 1][0]) / RC);
    const z0 = Math.floor(Math.min(P[i][1], P[i + 1][1]) / RC), z1 = Math.floor(Math.max(P[i][1], P[i + 1][1]) / RC);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx + ',' + gz;
      let arr = rcell.get(k);
      if (!arr) rcell.set(k, (arr = []));
      arr.push(i);
    }
  }
  for (const g of segs) {
    if (!g.road) continue;
    const cand = new Set();
    const x0 = Math.floor(Math.min(g.a[0], g.b[0]) / RC), x1 = Math.floor(Math.max(g.a[0], g.b[0]) / RC);
    const z0 = Math.floor(Math.min(g.a[1], g.b[1]) / RC), z1 = Math.floor(Math.max(g.a[1], g.b[1]) / RC);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) for (const i of rcell.get(gx + ',' + gz) || []) cand.add(i);
    for (const i of cand) {
      const A = P[i], B = P[i + 1], C = g.a, D = g.b;
      // filtru rapid pe cutii
      if (Math.max(A[0], B[0]) < Math.min(C[0], D[0]) || Math.min(A[0], B[0]) > Math.max(C[0], D[0])) continue;
      if (Math.max(A[1], B[1]) < Math.min(C[1], D[1]) || Math.min(A[1], B[1]) > Math.max(C[1], D[1])) continue;
      const rx = B[0] - A[0], rz = B[1] - A[1], qx = D[0] - C[0], qz = D[1] - C[1];
      const den = rx * qz - rz * qx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((C[0] - A[0]) * qz - (C[1] - A[1]) * qx) / den, u = ((C[0] - A[0]) * rz - (C[1] - A[1]) * rx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const sin = Math.abs(den) / (Math.hypot(rx, rz) * Math.hypot(qx, qz) || 1);
      if (sin < CROSS_SIN) continue;
      const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
      const s = S[i] + t * (S[i + 1] - S[i]);
      const e = edgeFn(s);
      const half = g.hw / sin + (e * cos) / sin + 0.6;
      const x = A[0] + rx * t, z = A[1] + rz * t;
      const ql = Math.hypot(qx, qz) || 1;
      crossings.push({ s, s0: s - half, s1: s + half, x, z, y: H(x, z) + g.lift, sin, n: g.n, ref: g.ref || '', k: g.k, hw: g.hw, dx: qx / ql, dz: qz / ql, pinned: !!g.pinned });
    }
  }
  crossings.sort((a, b) => a.s - b.s);
  // unim trecerile care se suprapun (ex. doua segmente ale aceluiasi drum)
  const merged = [];
  for (const c of crossings) {
    const last = merged[merged.length - 1];
    if (last && c.s0 <= last.s1 + 1 && last.pinned === c.pinned) { last.s1 = Math.max(last.s1, c.s1); last.y = Math.max(last.y, c.y); if (!last.n && c.n) last.n = c.n; }
    else merged.push({ ...c });
  }
  return { need, surf, onRoad, crossings: merged };
}

/**
 * Cote impuse (pins, vezi mw-levels.js) pentru drumurile NOI desenate de motorway.js (ex. DJ208L relocat),
 * acolo unde se intalnesc cu T1:
 *  - trecere propriu-zisa (unghi >= 30°): asfaltul la cota caii + 0,14 m (ciupercile sinelor raman vizibile);
 *  - drum aproape paralel care se suprapune peste platforma (DJ208L relocat, ~3°, pe ~170 m): asfaltul coboara
 *    cu 0,3 m sub platforma T1, ca pe celelalte strazi (altfel drumul acoperea sinele => „sine care dispar”).
 * route = createRoute(); wayKind = functia din mw-levels.js. Returneaza [{x, z, y, r, s, name, kind}].
 */
export function t1Pins(osm, route, wayKind, opts = {}) {
  const pins = [];
  if (!osm || !route) return pins;
  const P = route.pts, S = route.S, N = P.length;
  const below = opts.below ?? 0.3, over = opts.over ?? 0.14;
  const CELL = 40, grid = new Map();
  for (let i = 0; i < N - 1; i++) {
    const k = Math.floor(P[i][0] / CELL) + ',' + Math.floor(P[i][1] / CELL);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  const q = [0, 0];
  const nearest = (x, z) => {
    let best = null;
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of grid.get((gx + dx) + ',' + (gz + dz)) || []) {
      const d = distSeg(x, z, P[i], P[i + 1], q);
      if (!best || d < best.d) {
        const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) || 1;
        best = { d, i, s: S[i] + Math.hypot(q[0] - P[i][0], q[1] - P[i][1]), tx: (P[i + 1][0] - P[i][0]) / l, tz: (P[i + 1][1] - P[i][1]) / l };
      }
    }
    return best;
  };
  for (const r of osm.roads || []) {
    if (r.k !== 'construction' || !r.p || r.p.length < 2 || /motorway/.test(r.c || '')) continue;
    const { type, width } = wayKind(r);
    if (type !== 'road') continue;
    for (let j = 0; j < r.p.length - 1; j++) {
      const [x0, z0] = r.p[j], [x1, z1] = r.p[j + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-6) continue;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const n = Math.max(1, Math.ceil(len / 6));
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
        const nb = nearest(x, z);
        if (!nb) continue;
        const e = 1.7 * route.laneRamp(nb.s) + 1.97;
        if (nb.d > width / 2 + e + 0.6) continue;
        const sin = Math.abs(ux * nb.tz - uz * nb.tx);
        const cross = sin >= 0.5;
        pins.push({ x, z, y: route.heightAtS(nb.s) + (cross ? over : -below), r: 6, s: nb.s, name: r.n || r.ref || '', kind: cross ? 'trecere' : 'sub-platforma' });
      }
    }
  }
  return pins;
}
