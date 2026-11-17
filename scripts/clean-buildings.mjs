// Curata public/data/osm.json de "cladirile" care nu pot fi cladiri reale in model:
// amprente peste drumuri, peste cai ferate, in apa, pe traseul T1 sau pe autostrazile A7/A8.
// (Amprentele Microsoft ML detecteaza uneori copertine de peron, vagoane, camioane sau poduri ca "cladiri".)
// Utilizare: node scripts/clean-buildings.mjs      (backup: scripts/.osm-cache/osm.before-clean.json)
import fs from 'node:fs';
import path from 'node:path';
import { roadStyle } from '../src/core/util.js';
import { ROUTE } from '../src/transit/route-data.js';

const file = path.resolve('public/data/osm.json');
const osm = JSON.parse(fs.readFileSync(file, 'utf8'));
const backup = path.resolve('scripts/.osm-cache/osm.before-clean.json');
fs.mkdirSync(path.dirname(backup), { recursive: true });
if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(osm));

// ---------- geometrie ----------
const pip = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };
function segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {
  // 0 daca se intersecteaza, altfel minimul distantelor capat-segment
  const o = (px, pz, qx, qz, rx, rz) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  if (o(ax, az, bx, bz, cx, cz) !== o(ax, az, bx, bz, dx, dz) && o(cx, cz, dx, dz, ax, az) !== o(cx, cz, dx, dz, bx, bz)) return 0;
  const ps = (px, pz, x0, z0, x1, z1) => {
    const vx = x1 - x0, vz = z1 - z0, l = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / l));
    return Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t));
  };
  return Math.min(ps(ax, az, cx, cz, dx, dz), ps(bx, bz, cx, cz, dx, dz), ps(cx, cz, ax, az, bx, bz), ps(dx, dz, ax, az, bx, bz));
}

// ---------- index de segmente (grila) ----------
const CELL = 40;
const grid = new Map();
const key = (i, j) => i * 100003 + j;
function addLine(pts, r, reason) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
    const s = { x0, z0, x1, z1, r, reason };
    const i0 = Math.floor((Math.min(x0, x1) - r) / CELL), i1 = Math.floor((Math.max(x0, x1) + r) / CELL);
    const j0 = Math.floor((Math.min(z0, z1) - r) / CELL), j1 = Math.floor((Math.max(z0, z1) + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const kk = key(i, j); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(s);
    }
  }
}

// drumuri (latimea randata / 2 + 0,5 m)
for (const w of osm.roads) {
  const { width, bucket } = roadStyle(w);
  if (w.k === 'service' && w.p.length < 3) continue; // alei scurte de parcare
  const reason = bucket === 'motorway' || bucket === 'construction' ? 'autostradă' : 'drum';
  addLine(w.p, width / 2 + (reason === 'autostradă' ? 12 : 0.5), reason);
}
// cai ferate (± 2,5 m)
for (const w of osm.rails) if (w.k !== 'platform') addLine(w.p, 2.5, 'cale ferată');
// rauri / paraie
for (const w of osm.rivers) addLine(w.p, w.k === 'river' ? 20 : 2, 'apă');
// traseul T1 (± 7 m)
addLine(ROUTE.pts, 7, 'traseu T1');
// suprafete de apa
const waters = osm.areas.filter((a) => a.k === 'water');

function hitReason(p) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const seen = new Set();
  for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
    for (const s of grid.get(key(i, j)) || []) {
      if (seen.has(s)) continue; seen.add(s);
      // segment in interiorul poligonului?
      if (pip(s.x0, s.z0, p) || pip(s.x1, s.z1, p)) return s.reason;
      for (let a = 0; a < p.length - 1; a++) {
        if (segSegDist(p[a][0], p[a][1], p[a + 1][0], p[a + 1][1], s.x0, s.z0, s.x1, s.z1) < s.r) return s.reason;
      }
    }
  }
  const [cx, cz] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  for (const wtr of waters) if (pip(cx, cz, wtr.p)) return 'apă';
  return null;
}

// dreptunghiularitate (aria / aria cutiei orientate minime)
function rectangularity(p) {
  const a = area(p); let best = Infinity;
  for (let k = 0; k < p.length - 1; k++) {
    const ang = Math.atan2(p[k + 1][1] - p[k][1], p[k + 1][0] - p[k][0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p) { const u = x * c - z * s, v = x * s + z * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v); }
    const ar = (x1 - x0) * (z1 - z0);
    if (ar < best) best = ar, rectangularity.aspect = Math.max(x1 - x0, z1 - z0) / Math.max(0.1, Math.min(x1 - x0, z1 - z0));
  }
  return a / best;
}

const stats = {};
const kept = [];
for (const b of osm.buildings) {
  let reason = hitReason(b.p);
  // OSM: pastram cladirile cartate atinse doar la margine de un drum (strazi trasate imprecis), dar nu pe cele peste CF/T1/autostrada/apa
  if (reason === 'drum' && b.t !== 'ms') {
    // doar daca drumul trece prin mijlocul cladirii o eliminam
    const [cx, cz] = b.p.reduce((s, q) => [s[0] + q[0] / b.p.length, s[1] + q[1] / b.p.length], [0, 0]);
    const tiny = [[cx - 1, cz - 1], [cx + 1, cz - 1], [cx + 1, cz + 1], [cx - 1, cz + 1], [cx - 1, cz - 1]];
    reason = hitReason(tiny) === 'drum' ? 'drum' : null;
  }
  if (!reason && b.t === 'ms') {
    const ar = area(b.p), rect = rectangularity(b.p), asp = rectangularity.aspect;
    if (ar > 3000 && asp > 6) reason = 'formă de tren / șopron';
    else if (rect < 0.45) reason = 'formă neregulată';
  }
  if (reason) { stats[reason] = (stats[reason] || 0) + 1; continue; }
  kept.push(b);
}
osm.buildings = kept;
fs.writeFileSync(file + '.tmp', JSON.stringify(osm));
fs.renameSync(file + '.tmp', file);
console.log('Eliminate:', stats, '· rămase:', kept.length);
