// Calculeaza traseul tramvaiului usor T1 (Gara Pascani -> Hub Turbion A7xA8) din datele OSM reale.
// Utilizare: node scripts/build-route.mjs   (citeste public/data/osm.json si public/data/dem.json)
// Scrie: src/transit/route-data.js
//
// Principiu (feedback: „pe calea ferata existenta, iar la Triaj la dreapta spre turbion”):
//  1. terminal cu transfer peron-la-peron pe fata VEST a Peronului 1 (sistemul local al garii, x = 8,1 m,
//     opritor la z = +63 m, statia z = +66…+116 m);
//  2. spre sud, pe linie proprie IN CULOARUL CF existent, de-a lungul marginii VEST a liniilor CF 500
//     (axa dublei linii T1 la >= 6,4 m de cea mai vestica sina OSM => fiecare fir T1 la >= 4,5 m de axul CF);
//     trece pe sub podul rutier DN28A (Str. Gradinitei, Vatra), apoi pe langa grupa de linii a Triajului;
//  3. dupa Triaj: curba la DREAPTA (raza >= 60 m) si aliniament direct peste campuri / zona industriala
//     pana la hub-ul de langa turbionul A7 x A8 (traverseaza DJ208 Str. Stefan cel Mare si paraul pe poduri scurte);
//  4. verificari: garda fata de TOATE cladirile, fata de toate sinele OSM, raze, statii, poduri, intersectii.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/osm.json'), 'utf8'));
const dem = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/dem.json'), 'utf8'));

const ORIGIN = { lat: 47.25689, lon: 26.72403 };
const R = 6378137, lat0 = (ORIGIN.lat * Math.PI) / 180;
const project = (lat, lon) => [((lon - ORIGIN.lon) * Math.PI) / 180 * R * Math.cos(lat0), -((lat - ORIGIN.lat) * Math.PI) / 180 * R];

// ---------- relief (aceeasi formula ca src/core/terrain.js) ----------
function sampleRaw(x, z) {
  const { nx, nz, minX, minZ, maxX, maxZ, heights } = dem;
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const fx = cl(((x - minX) / (maxX - minX)) * (nx - 1), 0, nx - 1.0001);
  const fz = cl(((z - minZ) / (maxZ - minZ)) * (nz - 1), 0, nz - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const h = (a, b) => heights[b * nx + a];
  return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz;
}
const base = sampleRaw(0, 0);
function heightAt(x, z) {
  let h = sampleRaw(x, z) - base;
  const d = Math.hypot(x, z);
  if (d < 700) { const t = Math.min(1, Math.max(0, (d - 380) / 320)); const s = t * t * (3 - 2 * t); h = h * s; }
  return h;
}

// ---------- sistemul local al garii (ca src/station/frame.js) ----------
const B = (158.3 * Math.PI) / 180;
const A = { x: Math.sin(B), z: -Math.cos(B) };
const E = { x: A.z, z: -A.x };
const toWorld = (lx, lz) => [lx * E.x + lz * A.x, lx * E.z + lz * A.z];
const toLocal = (x, z) => [x * E.x + z * E.z, x * A.x + z * A.z];

// ---------- parametri ----------
const STEP = 4;
const TERM_X = 8.1;          // axa liniei T1 la terminal (fata vest a Peronului 1)
const BUFFER_Z = 63;         // opritorul (s = 0)
const RAIL_OFF = 6.4;        // axa dublei linii T1 fata de cea mai vestica sina OSM (1,7 + 4,5 + rezerva)
const CORR_END = +(process.env.CORR_END || 2150);   // sfarsitul aliniamentului din culoarul CF (z local)
const DN28A = project(47.24479, 26.7313);             // podul rutier DN28A peste CF (Vatra)
const TRIAJ = project(47.23834, 26.73565);            // statia CF Pascani Triaj
// capatul de la hub: acelasi aliniament ca hub.js / motorway.js (hub-ul existent, NE de turbion)
const HUB_END = [-737.5, 4255.5];
const HUB_DIR = (() => { const d = [-27.13, 33.4], l = Math.hypot(...d); return [d[0] / l, d[1] / l]; })();

// ---------- sinele OSM in sistemul local ----------
const rails = osm.rails.filter((r) => r.k === 'rail' && r.p.length > 1);
const railsL = rails.map((r) => r.p.map(([x, z]) => toLocal(x, z)));
function westEdge(lz) {
  let m = Infinity;
  for (const L of railsL) for (let i = 0; i < L.length - 1; i++) {
    const [a, b] = L[i], [c, d] = L[i + 1];
    if ((b - lz) * (d - lz) <= 0 && b !== d) {
      const x = a + ((c - a) * (lz - b)) / (d - b);
      if (x > -150 && x < 70) m = Math.min(m, x);
    }
  }
  return m;
}

// ---------- drumurile OSM (latimi ca src/core/util.js ROAD_WIDTH / roadStyle) ----------
const ROAD_W = { motorway: 24, motorway_link: 8, trunk: 14, trunk_link: 7, primary: 11, primary_link: 6, secondary: 9, secondary_link: 6,
  tertiary: 8, tertiary_link: 5.5, residential: 6, unclassified: 5.5, living_street: 5, service: 3.5, pedestrian: 5 };
const roadWidth = (w) => {
  let wd = ROAD_W[w.k] || 5;
  if (w.lanes && ['primary', 'secondary', 'tertiary', 'trunk'].includes(w.k)) wd = Math.max(wd, Math.min(22, w.lanes * 3.3 + 1));
  return wd;
};
const ROAD_GAP = 4;          // axa T1 la >= semilatimea drumului + 4 m de axul ORICARUI drum (in afara traversarilor)
const roadsAll = osm.roads.filter((w) => w.k !== 'construction' && w.p.length > 1);
const roadsL = roadsAll.map((w) => ({ w, hw: roadWidth(w) / 2, L: w.p.map(([x, z]) => toLocal(x, z)) }));

// ---------- 1+2a: intre Str. Garii si linii (lz 63…AUTO_END) ----------
// axa T1 la ~6,5 m de cea mai vestica sina (linie curenta / grupa de linii), dar niciodata mai aproape de
// axul unui drum decat semilatimea + 4 m (Str. Garii ramane in intregime pentru autobuze si masini).
const RAIL_TARGET = 6.5;
const AUTO_END = 1450;       // de aici traseul e dat prin varfuri (zona Triaj, unde liniile se desfac spre vest)
const LZ = [];
for (let lz = BUFFER_Z; lz <= AUTO_END; lz += STEP) LZ.push(lz);
const edge = LZ.map(westEdge);
const WW = Math.round(40 / STEP);
const hiX = LZ.map((_, i) => {
  let m = Infinity;
  for (let j = Math.max(0, i - WW); j <= Math.min(LZ.length - 1, i + WW); j++) if (Number.isFinite(edge[j])) m = Math.min(m, edge[j]);
  return (Number.isFinite(m) ? m : 21) - RAIL_TARGET;
});
// limita vest: drumurile aflate la vest de linie (sectiune transversala la lz, cu fereastra +-20 m)
function roadCuts(lz) {
  const out = [];
  for (const r of roadsL) for (let i = 0; i < r.L.length - 1; i++) {
    const [a, b] = r.L[i], [c, d] = r.L[i + 1];
    if ((b - lz) * (d - lz) <= 0 && b !== d) out.push({ x: a + ((c - a) * (lz - b)) / (d - b), r });
  }
  return out;
}
const loX = LZ.map((lz, i) => {
  let m = -Infinity;
  for (let dz = -20; dz <= 20; dz += 4) for (const c of roadCuts(lz + dz)) {
    if (c.r.w.br) continue;                                   // pod rutier: T1 trece pe sub el
    if (c.x < hiX[i] - 2 && c.x > -150) m = Math.max(m, c.x + c.r.hw + ROAD_GAP + 0.3);
  }
  return m;
});
let tx = LZ.map((lz, i) => (lz <= 175 ? TERM_X : Math.max(loX[i], hiX[i])));
const K = Math.round(70 / STEP);
const clampX = (v, i) => Math.max(loX[i], Math.min(hiX[i], v));
for (let it = 0; it < 80; it++) {
  const nx = tx.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - K); j <= Math.min(tx.length - 1, i + K); j++) { s += tx[j]; n++; }
    return clampX(s / n, i);
  });
  for (let i = 0; i < nx.length; i++) if (LZ[i] <= 175) nx[i] = TERM_X;   // terminalul + capatul Peronului 1: aliniament drept
  // ultimii 120 m: aliniament drept (racordare la varfurile din zona Triaj)
  const xe = Math.min(...nx.filter((_, i) => LZ[i] > AUTO_END - 120).map((v, k) => v));
  for (let i = 0; i < nx.length; i++) if (LZ[i] > AUTO_END - 120) nx[i] = xe;
  tx = nx;
}
for (let it = 0; it < 30; it++) tx = tx.map((v, i) => (i < 2 || i > tx.length - 3 || LZ[i] <= 175 || LZ[i] > AUTO_END - 120) ? v : clampX((tx[i - 2] + tx[i - 1] + v + tx[i + 1] + tx[i + 2]) / 5, i));
const autoBad = LZ.filter((_, i) => loX[i] > hiX[i] + 0.01);
if (autoBad.length) console.log('ATENTIE: banda drum-linie prea ingusta la lz =', autoBad.join(','));

// ---------- 1+2b: zona Triaj (lz > AUTO_END), varfuri in sistemul local ----------
// liniile Triajului se desfac spre VEST; T1 ramane la ~7 m vest de cea mai vestica linie de grupa (#…5473),
// la est de drumurile de serviciu ale triajului; traverseaza doar capatul liniei de garaj moarte (#…5483).
const XA = tx[tx.length - 1];
const XEND = -59.5;          // la ~6,5 m vest de linia de grupa (x = -53) pana la capatul culoarului
// [lx, lz, raza maxima a racordarii]
const VTX = [[XA, AUTO_END], [XA, 1600, 400], [-28, 1772, 400], [XEND, 1880, 150], [XEND, CORR_END]];
function filletPolyline(V, Rmax) {
  const out = [V[0]];
  for (let k = 1; k < V.length - 1; k++) {
    const l0 = Math.hypot(V[k][0] - V[k - 1][0], V[k][1] - V[k - 1][1]), l1 = Math.hypot(V[k + 1][0] - V[k][0], V[k + 1][1] - V[k][1]);
    let Rr = V[k][2] || Rmax, arc;
    for (; Rr >= 90; Rr -= 10) { arc = arcPoints(V[k - 1], V[k], V[k + 1], Rr); if (arc.T <= 0.48 * Math.min(l0, l1)) break; }
    if (Rr < 90) console.log('ATENTIE: raza < 90 m la varful', V[k]);
    out.push(...arc.pts);
  }
  out.push(V[V.length - 1]);
  return out;
}
const triajL = resample(filletPolyline(VTX, 400).map(([x, z]) => [x, z]), STEP);
const corridor = [...LZ.map((lz, i) => toWorld(tx[i], lz)), ...triajL.slice(1).map(([x, z]) => toWorld(x, z))];

// ---------- 3: racordarea la dreapta spre hub ----------
function arcPoints(A0, B0, C0, Rr) {
  const u = [A0[0] - B0[0], A0[1] - B0[1]], v = [C0[0] - B0[0], C0[1] - B0[1]];
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  u[0] /= lu; u[1] /= lu; v[0] /= lv; v[1] /= lv;
  const ang = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
  const theta = Math.PI - ang;
  if (!(theta > 0.01)) return { pts: [B0], T: 0 };
  const T = Rr * Math.tan(theta / 2);
  const P1 = [B0[0] + u[0] * T, B0[1] + u[1] * T], P2 = [B0[0] + v[0] * T, B0[1] + v[1] * T];
  const bis = [u[0] + v[0], u[1] + v[1]]; const lb = Math.hypot(...bis);
  const dC = Rr / Math.sin(ang / 2);
  const Cc = [B0[0] + bis[0] / lb * dC, B0[1] + bis[1] / lb * dC];
  const a1 = Math.atan2(P1[1] - Cc[1], P1[0] - Cc[0]);
  let da = Math.atan2(P2[1] - Cc[1], P2[0] - Cc[0]) - a1;
  while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const nSeg = Math.max(2, Math.ceil(Math.abs(da) * Rr / 3));
  const out = [];
  for (let k = 0; k <= nSeg; k++) { const a = a1 + da * k / nSeg; out.push([Cc[0] + Math.cos(a) * Rr, Cc[1] + Math.sin(a) * Rr]); }
  return { pts: out, T, P1, P2 };
}
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-6) continue;
    let d = step - carry;
    while (d <= L) { out.push([x0 + (x1 - x0) * d / L, z0 + (z1 - z0) * d / L]); d += step; }
    carry = L - (d - step);
  }
  const lp = pts[pts.length - 1], lo = out[out.length - 1];
  if (Math.hypot(lp[0] - lo[0], lp[1] - lo[1]) > step * 0.3) out.push(lp);
  return out;
}

// ---------- cladiri (index spatial) – TOATE cladirile pe care orasul le deseneaza ----------
const { STATION_EXCLUDE } = await import(pathToFileURL(path.join(ROOT, 'src/config/zones.js')).href);
const EXCL = [...STATION_EXCLUDE];
function pip(x, z, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
const centroidOf = (p) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const bMeta = osm.buildings.filter((b) => { const [cx, cz] = centroidOf(b.p); return !EXCL.some((e) => pip(cx, cz, e)); });
const blds = bMeta.map((b) => b.p);
const CELL = 60, grid = new Map();
blds.forEach((p, bi) => {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
    for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
      const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(bi);
    }
});
function nearestBuilding(x, z) {
  let best = { d: Infinity, bi: -1 };
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL), seen = new Set();
  for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
    for (const bi of grid.get(ix + ',' + iz) || []) {
      if (seen.has(bi)) continue; seen.add(bi);
      const p = blds[bi];
      let dmin = Infinity;
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, az] = p[i], [bx, bz] = p[i + 1], vx = bx - ax, vz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
        dmin = Math.min(dmin, Math.hypot(x - ax - vx * t, z - az - vz * t));
      }
      const sd = pip(x, z, p) ? -dmin : dmin;
      if (sd < best.d) best = { d: sd, bi };
    }
  }
  return best;
}
const clearanceOf = (pts) => { let m = Infinity; for (const p of pts) m = Math.min(m, nearestBuilding(p[0], p[1]).d); return m; };
// distanta pana la cea mai apropiata sina OSM (axa)
const railSegs = [];
for (const r of rails) for (let i = 0; i < r.p.length - 1; i++) railSegs.push([r.p[i], r.p[i + 1]]);
function railDist(x, z) {
  let m = Infinity;
  for (const [a, b] of railSegs) {
    if (Math.min(a[0], b[0]) - 40 > x || Math.max(a[0], b[0]) + 40 < x || Math.min(a[1], b[1]) - 40 > z || Math.max(a[1], b[1]) + 40 < z) continue;
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)));
    m = Math.min(m, Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t));
  }
  return m;
}

// varful racordarii: intersectia axei culoarului (directia +z local) cu aliniamentul hub-ului
const C0 = corridor[corridor.length - 1];
const dC = [A.x, A.z];
const den = dC[0] * HUB_DIR[1] - dC[1] * HUB_DIR[0];
const tX = ((HUB_END[0] - C0[0]) * HUB_DIR[1] - (HUB_END[1] - C0[1]) * HUB_DIR[0]) / den;
const X = [C0[0] + dC[0] * tX, C0[1] + dC[1] * tX];
// ---------- 4: traversarea DJ208L (TO-DO 9): T1 NU mai calca pe carosabil ----------
// DJ208L (Str. Crizantemelor -> Lunca) merge aproape paralel cu aliniamentul hub-ului (~6°). T1 ramane pe latura
// NV a drumului (la >= semilatime + 4 m), il traverseaza O SINGURA DATA, sub DJ_ANG, pe pod (curba in S cu raza
// DJ_R), apoi intra pe aliniamentul terminalului (HUB_DIR) pe latura SE, pana la acelasi capat HUB_END.
const DJ_ANG = 65, DJ_R = 65, DJ_STRAIGHT = 22;   // unghi de traversare (grade), raza curbelor, aliniament peste drum
const djWay = osm.roads.filter((w) => w.ref === 'DJ208L' && w.k !== 'construction' && w.p.length > 1)
  .flatMap((w) => w.p.slice(0, -1).map((p, i) => [p, w.p[i + 1]]))
  .map(([a, b]) => ({ a, b, l: Math.hypot(b[0] - a[0], b[1] - a[1]) }))
  .filter((g) => g.l > 1)
  .map((g) => ({ ...g, d: distPS(HUB_END, g.a, g.b) }))
  .sort((g, h) => g.d - h.d)[0];
function distPS(p, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t);
}
const djU = [(djWay.b[0] - djWay.a[0]) / djWay.l, (djWay.b[1] - djWay.a[1]) / djWay.l];
if (djU[0] * HUB_DIR[0] + djU[1] * HUB_DIR[1] < 0) { djU[0] = -djU[0]; djU[1] = -djU[1]; }
let djN = [-djU[1], djU[0]];
const offDJ = (p) => (p[0] - djWay.a[0]) * djN[0] + (p[1] - djWay.a[1]) * djN[1];
if (offDJ(HUB_END) < 0) djN = [-djN[0], -djN[1]];   // +n = latura terminalului (SE)
const djA = (DJ_ANG * Math.PI) / 180;
const djW = [Math.cos(djA) * djU[0] + Math.sin(djA) * djN[0], Math.cos(djA) * djU[1] + Math.sin(djA) * djN[1]];
const djT = DJ_R * Math.tan(Math.acos(djW[0] * HUB_DIR[0] + djW[1] * HUB_DIR[1]) / 2);
const half12 = djT + DJ_STRAIGHT / 2;                     // jumatate din V1-V2 (traversarea e la mijloc)
const d2 = (offDJ(HUB_END) - half12 * Math.sin(djA)) / (HUB_DIR[0] * djN[0] + HUB_DIR[1] * djN[1]);
const V2 = [HUB_END[0] - HUB_DIR[0] * d2, HUB_END[1] - HUB_DIR[1] * d2];
const V1 = [V2[0] - djW[0] * 2 * half12, V2[1] - djW[1] * 2 * half12];
console.log(`DJ208L: traversare unica la ${DJ_ANG}° in (${[0, 1].map((k) => Math.round((V1[k] + V2[k]) / 2))}), V1 (${V1.map(Math.round)}), V2 (${V2.map(Math.round)}), aliniament terminal ${d2.toFixed(0)} m, R ${DJ_R} m`);
const lHub = Math.hypot(V1[0] - X[0], V1[1] - X[1]);
let turn = null;
const HALF = 3.6, CLEAR = 3.0;
for (const Rr of [600, 500, 420, 360, 300, 250, 200, 160, 120, 90, 70, 60]) {
  const arc = arcPoints(corridor[corridor.length - 2], X, V1, Rr);
  if (arc.T > tX * 0.98 || arc.T > lHub * 0.5) continue;
  const cl = clearanceOf(arc.pts), rd = Math.min(...arc.pts.map((p) => railDist(p[0], p[1])));
  if (!turn || (cl >= HALF + CLEAR && rd >= RAIL_OFF - 0.3)) turn = { Rr, arc, cl, rd };
  if (cl >= HALF + CLEAR && rd >= RAIL_OFF - 0.3) break;
}
console.log(`Varf racordare la (${X.map(Math.round)}), raza ${turn.Rr} m, T = ${turn.arc.T.toFixed(0)} m, garda cladiri ${turn.cl.toFixed(1)} m, garda CF ${turn.rd.toFixed(1)} m`);
// culoarul se opreste la inceputul curbei
const PC = turn.arc.P1;
const corr2 = corridor.filter((p) => (p[0] - PC[0]) * dC[0] + (p[1] - PC[1]) * dC[1] < -1);
const sArc1 = arcPoints(X, V1, V2, DJ_R), sArc2 = arcPoints(V1, V2, HUB_END, DJ_R);
let pts = resample([...corr2, ...turn.arc.pts, ...sArc1.pts, ...sArc2.pts, HUB_END], STEP);

const N = pts.length;
const S = [0];
for (let i = 1; i < N; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
const LEN = S[N - 1];
function sAt(x, z) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < N; i++) { const d = Math.hypot(pts[i][0] - x, pts[i][1] - z); if (d < bd) { bd = d; bi = i; } }
  return S[bi];
}
// portiunea din culoarul CF (cale cu piatra sparta si traverse de beton, ca reteaua CFR)
const corridorEnd = Math.round(sAt(...PC));

// raze de curbura
let minR = Infinity, minRs = 0;
for (let i = 2; i < N - 2; i++) {
  const a = pts[i - 2], b = pts[i], c = pts[i + 2];
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const Rr = cross < 1e-6 ? 1e5 : (ab * bc * ac) / (2 * cross);
  if (Rr < minR) { minR = Rr; minRs = S[i]; }
}

// ---------- intersectii ----------
function segInt(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s2 = [d[0] - c[0], d[1] - c[1]];
  const dd = r[0] * s2[1] - r[1] * s2[0];
  if (Math.abs(dd) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s2[1] - (c[1] - a[1]) * s2[0]) / dd;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / dd;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
// unghiul de traversare (grade, 90 = perpendicular)
function crossAngle(c) {
  const i = Math.max(0, Math.min(N - 2, Math.round(c.s / STEP))), [a, b] = [pts[i], pts[i + 1]];
  const w = c.w.p; let best = 0, bd = Infinity;
  for (let j = 0; j < w.length - 1; j++) { const d = Math.hypot((w[j][0] + w[j + 1][0]) / 2 - a[0], (w[j][1] + w[j + 1][1]) / 2 - a[1]); if (d < bd) { bd = d; best = j; } }
  const u = [b[0] - a[0], b[1] - a[1]], v = [w[best + 1][0] - w[best][0], w[best + 1][1] - w[best][1]];
  const cs = Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
  return Math.round((Math.acos(Math.min(1, cs)) * 180) / Math.PI);
}
const crossList = (ways, filter) => {
  const out = [];
  for (const w of ways) {
    if (filter && !filter(w)) continue;
    for (let j = 0; j < w.p.length - 1; j++) for (let i = 0; i < N - 1; i++) {
      const t = segInt(pts[i], pts[i + 1], w.p[j], w.p[j + 1]);
      if (t !== null) out.push({ s: Math.round(S[i] + t * (S[i + 1] - S[i])), w });
    }
  }
  return out;
};
const streams = crossList(osm.rivers).map((c) => ({ s: c.s, k: c.w.k, n: c.w.n || '' }));
const roadsX = crossList(osm.roads, (w) => w.k !== 'construction').map((c) => ({ s: c.s, ref: c.w.ref || '', n: c.w.n || '', k: c.w.k, br: !!c.w.br, ang: crossAngle(c) }));
const railX = crossList(rails).map((c) => ({ s: c.s, svc: c.w.svc || '', id: c.w.id, ang: crossAngle(c) }));
const dnS = Math.round(sAt(...DN28A));
// podul DN28A: drumul trece PESTE linie (puntea e construita de modulul orasului, ~7 m peste sine)

// ---------- statii ----------
const stops = [
  { id: 'gara', name: 'Gara Pașcani (peron 1)', s: 91 - BUFFER_Z - 2, term: true },
  { id: 'electroputere', name: 'Electroputere', s: Math.round(sAt(...toWorld(TERM_X, 600))) },
  { id: 'centru', name: 'Centru – Spital (pod DN28A)', s: dnS - 48 },
  { id: 'triaj', name: 'Triaj', s: Math.round(sAt(...TRIAJ)) },
  { id: 'stefan', name: 'Vârful Dealului', s: 0 },
  { id: 'hub', name: 'Hub Turbion A7×A8', s: Math.round(LEN - 40), term: true },
];
{
  // dupa viaductul Prisacii – DJ208 – Varful Dealului (TO-DO 9): statia la sol, dupa ultima traversare
  // (route.js o muta mai departe daca peronul ar ramane totusi pe viaduct)
  const vd = roadsX.find((r) => /Vârful Dealului/.test(r.n)) || roadsX.find((r) => r.ref === 'DJ208');
  stops.find((s) => s.id === 'stefan').s = vd ? vd.s + 70 : Math.round(LEN * 0.75);
}
// niciun peron (± 21 m + 3 m garda) peste un drum care traverseaza linia; latimi ca in src/core/city.js
{
  const Wd = { trunk: 14, primary: 11, secondary: 9, tertiary: 8, residential: 6, unclassified: 5.5, living_street: 5, service: 3.5, pedestrian: 5 };
  const xs = roadsX.filter((r) => Math.abs(r.s - dnS) > 30).map((r) => [r.s - (Wd[r.k] || 5) / 2 - 6, r.s + (Wd[r.k] || 5) / 2 + 6]);
  const clearAt = (s) => !xs.some(([a, b]) => b > s - 24 && a < s + 24) && Math.abs(s - dnS) > 38;
  for (const st of stops) {
    if (st.term || clearAt(st.s)) continue;
    for (let d = 2; d <= 80; d += 2) {
      const c = [st.s - d, st.s + d].find((s) => s > 130 && s < LEN - 130 && clearAt(s));
      if (c !== undefined) { console.log(`Statia ${st.name}: mutata ${st.s} -> ${c} (drum sub peron)`); st.s = c; break; }
    }
  }
}

// ---------- rapoarte ----------
const hs = pts.map(([x, z]) => heightAt(x, z));
const conflicts = [];
let minRail = Infinity, minRailS = 0;
for (let i = 0; i < N; i++) {
  const nb = nearestBuilding(pts[i][0], pts[i][1]);
  if (nb.d < HALF + CLEAR) conflicts.push({ s: Math.round(S[i]), d: +nb.d.toFixed(1), x: Math.round(pts[i][0]), z: Math.round(pts[i][1]), t: bMeta[nb.bi]?.t || '' });
  const rd = railDist(pts[i][0], pts[i][1]);
  if (rd < minRail && S[i] > 0) { minRail = rd; minRailS = S[i]; }
}

const areaOf = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };
const demolish = [];
const demolishSet = new Set();
{
  const seen = demolishSet;
  for (let i = 0; i < N; i++) {
    const nb = nearestBuilding(pts[i][0], pts[i][1]);
    if (nb.d < (S[i] <= corridorEnd ? HALF + CLEAR : HALF + 1.0) && !seen.has(nb.bi)) { seen.add(nb.bi); const b = bMeta[nb.bi]; demolish.push({ c: centroidOf(b.p).map((v) => +v.toFixed(1)), a: Math.round(areaOf(b.p)), t: b.t || '', s: Math.round(S[i]) }); }
  }
}
// ---------- tabel la fiecare 100 m: sina / drum / cladire cea mai apropiata ----------
const roadSegs = [];
for (const r of roadsAll) for (let i = 0; i < r.p.length - 1; i++) roadSegs.push({ a: r.p[i], b: r.p[i + 1], w: r, hw: roadWidth(r) / 2 });
function nearestRoad(x, z) {
  let best = { d: Infinity, m: Infinity, w: null };
  for (const { a, b, w, hw } of roadSegs) {
    if (Math.min(a[0], b[0]) - 60 > x || Math.max(a[0], b[0]) + 60 < x || Math.min(a[1], b[1]) - 60 > z || Math.max(a[1], b[1]) + 60 < z) continue;
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)));
    const d = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
    const m = d - hw - ROAD_GAP;   // marja fata de cerinta (>= 0 = ok)
    if (m < best.m) best = { d, m, w, hw };
  }
  return best;
}
const roadLabel = (w) => (w ? (w.n || w.ref || w.k) + (w.br ? ' [pod]' : '') : '-');
console.log('\n   s |  sina(m) | drum: dist (cerinta) nume                          | cladire(m)');
const corrMin = { rail: { d: Infinity }, road: { m: Infinity }, bld: { d: Infinity } };
for (let i = 0; i < N; i++) {
  const [x, z] = pts[i];
  const rd = railDist(x, z), nr = nearestRoad(x, z), nb = nearestBuilding(x, z);
  if (S[i] <= corridorEnd) {
    if (S[i] > 30 && rd < corrMin.rail.d && !railX.some((c) => Math.abs(c.s - S[i]) < 40)) corrMin.rail = { d: rd, s: S[i] };
    if (nr.w && !nr.w.br && nr.m < corrMin.road.m && !roadsX.some((c) => Math.abs(c.s - S[i]) < 25)) corrMin.road = { ...nr, s: S[i] };
    if (S[i] > 45 && nb.d < corrMin.bld.d && !demolishSet.has(nb.bi)) corrMin.bld = { d: nb.d, s: S[i] };
  }
  if (i % Math.round(100 / STEP) === 0 || i === N - 1)
    console.log(`${String(Math.round(S[i])).padStart(4)} | ${rd.toFixed(1).padStart(8)} | ${nr.d.toFixed(1).padStart(5)} (${(nr.hw + ROAD_GAP).toFixed(1)}) ${roadLabel(nr.w).padEnd(40).slice(0, 40)} | ${nb.d.toFixed(1)}${demolishSet.has(nb.bi) ? ' (demolata)' : ''}`);
}
console.log(`\nMINIME in culoarul CF (s 0…${corridorEnd}, fara traversari): sina ${corrMin.rail.d.toFixed(1)} m @s=${Math.round(corrMin.rail.s)}; ` +
  `drum ${corrMin.road.d.toFixed(1)} m (cerinta ${(corrMin.road.hw + ROAD_GAP).toFixed(1)}, ${roadLabel(corrMin.road.w)}) @s=${Math.round(corrMin.road.s)}; ` +
  `cladire (nedemolata) ${corrMin.bld.d.toFixed(1)} m @s=${Math.round(corrMin.bld.s)}`);
// panta
{
  let g = 0, gs = 0;
  for (let i = 5; i < N; i += 5) { const gg = Math.abs(hs[i] - hs[i - 5]) / (S[i] - S[i - 5]); if (gg > g) { g = gg; gs = S[i]; } }
  console.log(`Panta maxima teren pe traseu (20 m): ${(g * 100).toFixed(1)} % la s=${Math.round(gs)}`);
}

const out = `// GENERAT de scripts/build-route.mjs din OpenStreetMap (© OpenStreetMap contributors, ODbL) – nu edita manual.
// Traseul tramvaiului usor T1 Gara Pascani (peronul 1) -> culoarul CF 500 -> Triaj -> Hub Turbion A7xA8,
// in metri locali (x = est, z = sud).
export const ROUTE = {
  length: ${LEN.toFixed(1)},
  step: ${STEP},
  corridor: [0, ${corridorEnd}],
  dn28a: ${dnS},
  turn: { s0: ${corridorEnd}, R: ${turn.Rr} },
  pts: ${JSON.stringify(pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]))},
  stops: ${JSON.stringify(stops)},
  streams: ${JSON.stringify(streams)},
  demolish: ${JSON.stringify(demolish.map((d) => d.c))},
  // TOATE drumurile OSM taiate de axa T1 (s crescator): k = clasa, ang = unghi (90 = perpendicular),
  // pod = drumul trece PE POD peste T1 (DN28A). Tratamentul (trecere la nivel / pasaj T1 / cale inglobata) il alege
  // src/transit/route.js dupa profilul in lung (vezi tabelul din consola: „T1 × drumuri”).
  roadCrossings: ${JSON.stringify([...roadsX].sort((a, b) => a.s - b.s).map(({ s, ref, n, k, ang, br }) => ({ s, k, ref, n, ang, pod: br })))},
};
`;
const OUT = process.env.ROUTE_OUT || path.join(ROOT, 'src/transit/route-data.js');
fs.writeFileSync(OUT, out);
console.log('Scris:', OUT);
console.log(`Lungime: ${LEN.toFixed(0)} m, puncte: ${N}, raza minima ${minR.toFixed(0)} m la s=${minRs.toFixed(0)}; culoar CF 0…${corridorEnd} m`);
console.log('Statii:', stops.map((s) => `${s.name}@${s.s}`).join(' | '));
console.log('Pod DN28A la s =', dnS, '; paraie:', JSON.stringify(streams));
console.log('Drumuri traversate [s, tip, nume, unghi, pod]:', JSON.stringify(roadsX.map(({ s, n, ref, k, ang, br }) => [s, k, ref || n, ang, br ? 'pod' : 'nivel'])));
console.log('Sine OSM traversate:', railX.length ? JSON.stringify(railX) : 'niciuna', `; garda minima fata de axul CF ${minRail.toFixed(1)} m la s=${minRailS.toFixed(0)}`);
console.log('Cota: start', hs[0].toFixed(1), 'max', Math.max(...hs).toFixed(1), 'min', Math.min(...hs).toFixed(1), 'final', hs[N - 1].toFixed(1));
const grp = [];
for (const c of conflicts) { const g = grp[grp.length - 1]; if (g && c.s - g.s1 <= 8) { g.s1 = c.s; g.dmin = Math.min(g.dmin, c.d); } else grp.push({ s0: c.s, s1: c.s, dmin: c.d, x: c.x, z: c.z, t: c.t }); }
console.log(`Cladiri la < ${HALF + CLEAR} m de axa (platforma 3,6 m + garda 3 m):`, grp.length ? JSON.stringify(grp) : 'niciuna');

// ---------- cladiri care trebuie sa dispara (pe platforma T1) ----------
// In culoarul CF: magazii / anexe CFR dezafectate si amprente ML false (vagoane parcate detectate drept cladiri);
// pe camp: putine anexe gospodaresti (expropriere). Se scriu ca puncte (centroizi) in route-data.js -> exclude.js.
console.log('Cladiri eliminate (centroid, arie, tip, s):', JSON.stringify(demolish));
