import * as THREE from 'three';
import { panelGeo, compose, instanced, transformGeo, normalizeGeo } from './builder.js';
import { PLATFORMS, PLAT_Y } from './frame.js';
import { PARTS, PASSAGE } from './building.js';

// Piese comune: semne, linii in pardoseala, mobilier instantiat.

export const PAVE_Y = 0.36;   // cota pavajului din piata
export const HALL = { x0: -22, x1: -6.6, z0: -47.9, z1: -11.8, floor: 0.42 };

// Cota suprafetei de mers in sistemul local (pentru linii LED / benzi tactile)
export function floorY(x, z) {
  if (x >= HALL.x0 && x <= HALL.x1 && z >= HALL.z0 && z <= HALL.z1) return HALL.floor;
  if (x >= PASSAGE.x0 && x <= PASSAGE.x1 && z >= PASSAGE.z0 && z <= PASSAGE.z1) return PASSAGE.yIn + ((x - PASSAGE.x0) / (PASSAGE.x1 - PASSAGE.x0)) * (PASSAGE.yOut - PASSAGE.yIn);
  for (const p of PLATFORMS) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return PLAT_Y;
  return PAVE_Y;
}

// Semn (panou din atlas) — fata spre +z inainte de rotatia ry
export function addSign(B, M, atlas, id, x, y, z, ry = 0, w = 2.0, h = 0.5, double = true) {
  const uv = atlas.uv[id];
  if (!uv) return;
  const d = 0.07;
  B.box(M.dark, x, y, z, w + 0.08, h + 0.08, d, ry);
  const off = d / 2 + 0.006;
  const sx = Math.sin(ry), cz = Math.cos(ry);
  B.add(M.signs, panelGeo(w, h, ...uv), x + sx * off, y, z + cz * off, ry);
  if (double) B.add(M.signs, panelGeo(w, h, ...uv), x - sx * off, y, z - cz * off, ry + Math.PI);
}

// Linie in pardoseala (LED sau banda tactila) pe polilinia pts [[x,z],...] in sistemul local
export function floorLine(B, mat, pts, width = 0.14, lift = 0.012, thick = 0.02) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(L / 1.0));
    const ry = Math.atan2(x1 - x0, z1 - z0);
    for (let k = 0; k < n; k++) {
      const ta = k / n, tb = (k + 1) / n;
      const xa = x0 + (x1 - x0) * ta, za = z0 + (z1 - z0) * ta, xb = x0 + (x1 - x0) * tb, zb = z0 + (z1 - z0) * tb;
      const ya = floorY(xa, za), yb = floorY(xb, zb);
      const seg = Math.hypot(xb - xa, zb - za);
      const rx = -Math.atan2(yb - ya, seg);
      B.box(mat, (xa + xb) / 2, (ya + yb) / 2 + lift, (za + zb) / 2, width, thick, seg + 0.01, ry, 0, rx);
    }
  }
}

// ---------------- geometrii mobilier (cache) ----------------
const cache = {};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const GEO = {
  get benchWood() { return cache.bw ||= compose([[box(2.0, 0.05, 0.45), 0, 0.45, 0], [box(2.0, 0.4, 0.05), 0, 0.72, -0.22, 0, -0.2]]); },
  get benchSteel() { return cache.bs ||= compose([[box(0.06, 0.45, 0.45), -0.8, 0.22, 0], [box(0.06, 0.45, 0.45), 0.8, 0.22, 0], [box(0.06, 0.5, 0.06), -0.8, 0.7, -0.24], [box(0.06, 0.5, 0.06), 0.8, 0.7, -0.24]]); },
  // rand de 4 scaune (sala de asteptare)
  get seatShells() {
    if (cache.ss) return cache.ss;
    const parts = [];
    for (let i = 0; i < 4; i++) { const x = -0.9 + i * 0.6; parts.push([box(0.5, 0.06, 0.46), x, 0.46, 0], [box(0.5, 0.48, 0.05), x, 0.72, -0.22, 0, -0.12]); }
    return (cache.ss = compose(parts));
  },
  get seatFrame() { return cache.sf ||= compose([[box(2.5, 0.08, 0.1), 0, 0.4, 0], [box(0.08, 0.4, 0.4), -1.1, 0.2, 0], [box(0.08, 0.4, 0.4), 1.1, 0.2, 0], [box(0.06, 0.25, 0.4), -1.22, 0.6, 0], [box(0.06, 0.25, 0.4), 1.22, 0.6, 0]]); },
  get trunk() { return cache.tr ||= compose([[new THREE.CylinderGeometry(0.14, 0.22, 3.2, 6), 0, 1.6, 0]]); },
  get crown() { return cache.cr ||= compose([[new THREE.IcosahedronGeometry(2.2, 1), 0, 4.6, 0], [new THREE.IcosahedronGeometry(1.5, 1), 0.7, 5.8, 0.3]]); },
  get pot() { return cache.po ||= compose([[new THREE.CylinderGeometry(0.42, 0.34, 0.7, 12), 0, 0.35, 0]]); },
  get foliage() { return cache.fo ||= compose([[new THREE.IcosahedronGeometry(0.6, 1), 0, 1.15, 0], [new THREE.IcosahedronGeometry(0.42, 1), 0.2, 1.6, -0.1], [new THREE.IcosahedronGeometry(0.35, 0), -0.25, 1.45, 0.2]]); },
  get lampPole() { return cache.lp ||= compose([[new THREE.CylinderGeometry(0.06, 0.1, 6, 8), 0, 3, 0], [box(0.08, 0.08, 1.2), 0, 5.95, 0.55], [box(0.18, 0.5, 0.18), 0, 1.0, 0]]); },
  get lampHead() { return cache.lh ||= compose([[box(0.32, 0.08, 0.7), 0, 5.88, 1.05], [new THREE.SphereGeometry(0.07, 8, 6), 0, 5.72, 0.2]]); },
  get bollard() { return cache.bo ||= compose([[new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), 0, 0.45, 0]]); },
  get bikeFrame() {
    if (cache.bf) return cache.bf;
    const t = (r) => new THREE.TorusGeometry(r, 0.03, 5, 16);
    return (cache.bf = compose([[t(0.33), 0, 0.36, -0.52, Math.PI / 2], [t(0.33), 0, 0.36, 0.52, Math.PI / 2], [box(0.05, 0.05, 0.75), 0, 0.66, 0], [box(0.05, 0.5, 0.05), 0, 0.6, -0.2, 0, 0.3], [box(0.05, 0.5, 0.05), 0, 0.6, 0.4, 0, -0.2], [box(0.5, 0.04, 0.04), 0, 0.98, 0.45], [box(0.12, 0.05, 0.25), 0, 0.92, -0.25]]));
  },
  get bikeDock() { return cache.bd ||= compose([[box(0.25, 1.05, 0.3), 0, 0.52, 0.85], [box(0.18, 0.1, 0.16), 0, 1.1, 0.85]]); },
  get sosColumn() { return cache.sc ||= compose([[box(0.32, 2.2, 0.26), 0, 1.1, 0], [box(0.36, 0.3, 0.3), 0, 2.3, 0]]); },
  get sosButton() { return cache.sb ||= compose([[box(0.2, 0.2, 0.04), 0, 1.35, 0.14], [box(0.34, 0.08, 0.3), 0, 2.48, 0]]); },
  get cctv() { return cache.cc ||= compose([[box(0.12, 0.12, 0.34), 0, 0, 0.12], [box(0.04, 0.2, 0.04), 0, 0.12, 0]]); },
  get bin() { return cache.bi ||= compose([[box(0.55, 1.0, 0.55), 0, 0.5, 0], [box(0.6, 0.06, 0.6), 0, 1.03, 0]]); },
  get evCharger() { return cache.ev ||= compose([[box(0.45, 1.6, 0.3), 0, 0.8, 0], [box(0.6, 0.08, 0.4), 0, 1.64, 0]]); },
};

export function instancedPair(group, geoA, matA, geoB, matB, list, opts = {}) {
  const a = instanced(geoA, matA, list, opts);
  const b = instanced(geoB, matB, list, opts);
  if (opts.name) { a.name = opts.name + ':a'; b.name = opts.name + ':b'; }
  group.add(a, b);
  return [a, b];
}

export { transformGeo, normalizeGeo };
