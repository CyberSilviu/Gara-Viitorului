import * as THREE from 'three';
import { GeoBuf, SegmentIndex, canvasTexture, rng } from './util.js';
import { unproject } from './geo.js';
import { ROUTE } from '../transit/route-data.js';

// Poduri rutiere reale (OSM bridge=yes) si rampele lor de acces.
//  1) planBridges: cota tablierului = max pe deschidere (teren + gabarit) – 7,0 m peste CF (catenara 25 kV),
//     5,5 m peste drumuri, 3 m peste apa – plus grosimea tablierului; drumurile legate (capete la < 1 m) urca /
//     coboara spre pod cu panta <= 5,5 % (rampe pe rambleu cu ziduri de sprijin).
//  2) buildBridgeStructures: tablier (beton), trotuare cu borduri, parapete + mana curenta, pile intre linii
//     (niciodata la < RAIL_CLEAR de o sina sau la < T1_CLEAR de axa liniei T1 – traseul real din route-data.js),
//     culei la capete, ziduri de sprijin la rampe. Unde T1 nu lasa loc, deschiderea creste (pila mutata mai departe).

export const RAMP_GRADE = 0.055;
export const CLEARANCE = { rail: 7.0, road: 5.5, water: 3.0 };
export const DECK_DEPTH = 1.45;      // de la suprafata drumului la intradosul tablierului
const BRIDGE_WALK = 1.8;             // trotuar pe pod (fiecare parte)
const PARAPET_W = 0.4, PARAPET_H = 1.05;
export const RAIL_CLEAR = 3.6;       // distanta minima de la orice punct al pilei la o sina CF
export const T1_CLEAR = 5.0;         // distanta minima de la orice punct al pilei la axa T1 (gabarit + catenara + spatiu de siguranta)
const PIER_HALF = 0.9;               // jumatate din grosimea riglei pilei, de-a lungul drumului

// axa T1 (traseul generat din OSM), indexata o singura data
let t1IndexCache = null;
function t1Index() {
  if (!t1IndexCache) { t1IndexCache = new SegmentIndex(40); if (ROUTE?.pts?.length > 1) t1IndexCache.addPolyline(ROUTE.pts, 0, 't1'); }
  return t1IndexCache;
}

const keyOf = (x, z) => Math.round(x) + ',' + Math.round(z);

// items: [{ w, pts (dense), s (lungimi cumulate), width, lift, bucket }]; groundY(x, z, lift) = suprafata drapata
export function planBridges({ items, groundY, terrainH, railIndex, waterIndex }) {
  // index al capetelor (potrivire la < 1 m)
  const ends = new Map();
  const addEnd = (x, z, idx, atStart) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = keyOf(x + dx, z + dz);
      let a = ends.get(k); if (!a) ends.set(k, (a = []));
      a.push({ idx, atStart, x, z });
    }
  };
  items.forEach((it, idx) => {
    if (it.pts.length < 2) return;
    addEnd(it.pts[0][0], it.pts[0][1], idx, true);
    const q = it.pts[it.pts.length - 1]; addEnd(q[0], q[1], idx, false);
  });
  const connectedAt = (x, z, self) => {
    const a = ends.get(keyOf(x, z)) || [];
    const seen = new Set(), out = [];
    for (const e of a) if (e.idx !== self && !seen.has(e.idx) && Math.hypot(e.x - x, e.z - z) < 1) { seen.add(e.idx); out.push(e); }
    return out;
  };
  // drumuri "de dedesubt" (fara podurile insele)
  const under = new SegmentIndex(40);
  items.forEach((it, idx) => { if (!it.w.br && it.bucket !== 'construction') for (let i = 0; i < it.pts.length - 1; i++) under.add(it.pts[i][0], it.pts[i][1], it.pts[i + 1][0], it.pts[i + 1][1], it.width / 2, idx); });

  const profiles = new Map(); // idx -> Float32Array (cota minima a axei; -Infinity = pe teren)
  const profOf = (idx) => { let p = profiles.get(idx); if (!p) { p = new Float32Array(items[idx].pts.length).fill(-Infinity); profiles.set(idx, p); } return p; };
  const bridges = [];
  items.forEach((it, idx) => {
    const { w, pts } = it;
    if (!w.br || it.bucket === 'construction' || pts.length < 2) return;
    const hw = it.width / 2;
    const near = new Set();
    for (const e of [...connectedAt(pts[0][0], pts[0][1], idx), ...connectedAt(pts[pts.length - 1][0], pts[pts.length - 1][1], idx)]) near.add(e.idx);
    let Y = -Infinity;
    const over = new Set();
    const len = it.s[it.s.length - 1];
    pts.forEach(([x, z], pi) => {
      const t = terrainH(x, z);
      const inner = it.s[pi] > 6 && len - it.s[pi] > 6; // la capete drumurile legate / intersectiile nu conteaza
      Y = Math.max(Y, groundY(x, z, it.lift));
      if (railIndex && railIndex.nearest(x, z, hw + 4).d < hw + 4) { Y = Math.max(Y, t + CLEARANCE.rail + DECK_DEPTH); over.add('rail'); }
      if (waterIndex) {
        const nw = waterIndex.nearest(x, z, hw + 30);
        if (nw.seg && nw.d < nw.seg.r + hw) {
          // rau (>= 16 m): gabarit 3 m; parau / canal: albia e sapata sub drum (DEM-ul n-o vede) => pod la nivelul strazii
          if (nw.seg.r >= 8 && len >= 40) Y = Math.max(Y, t + CLEARANCE.water + DECK_DEPTH); else Y = Math.max(Y, groundY(x, z, it.lift) + 0.3);
          over.add('water');
        }
      }
      if (inner) under.query({ minX: x - hw - 12, maxX: x + hw + 12, minZ: z - hw - 12, maxZ: z + hw + 12 }, (s) => {
        if (s.tag === idx || near.has(s.tag)) return false;
        const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
        let u = ((x - s.ax) * dx + (z - s.az) * dz) / L2; u = Math.max(0, Math.min(1, u));
        if (Math.hypot(s.ax + dx * u - x, s.az + dz * u - z) < s.r + 1) { Y = Math.max(Y, t + CLEARANCE.road + DECK_DEPTH); over.add('road'); }
        return false;
      });
    });
    if (!over.size) {
      if (!(w.L >= 1)) return; // pod fara obstacol cunoscut si fara nivel => drum obisnuit
      Y += 0.25; over.add('vale');
    }
    const p = profOf(idx); p.fill(Y);
    const mid = pts[Math.floor(pts.length / 2)];
    const ll = unproject(mid[0], mid[1]);
    bridges.push({
      id: w.id, idx, name: w.n || w.ref || 'Pod rutier', ref: w.ref || null, pts, y: Y, width: it.width,
      over: [...over], length: it.s[it.s.length - 1], lat: +ll.lat.toFixed(5), lon: +ll.lon.toFixed(5),
      x: mid[0], z: mid[1], clearance: +(Y - DECK_DEPTH - terrainH(mid[0], mid[1])).toFixed(2), ramps: [],
    });
  });

  // rampele: propagare pe drumurile legate, panta RAMP_GRADE
  const queue = [];
  for (const b of bridges) {
    const it = items[b.idx];
    for (const atStart of [true, false]) {
      const q = atStart ? it.pts[0] : it.pts[it.pts.length - 1];
      queue.push({ x: q[0], z: q[1], h: b.y, from: b.idx, bridge: b });
    }
  }
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const { x, z, h, from, bridge } = queue.shift();
    for (const e of connectedAt(x, z, from)) {
      const it = items[e.idx];
      if (it.w.br && profiles.has(e.idx)) continue;
      if (it.bucket === 'construction') continue;
      const p = profOf(e.idx);
      const len = it.s[it.s.length - 1];
      let changed = false;
      for (let i = 0; i < it.pts.length; i++) {
        const d = e.atStart ? it.s[i] : len - it.s[i];
        const y = h - RAMP_GRADE * d;
        if (y > p[i] + 1e-3) { p[i] = y; changed = true; }
      }
      if (!changed) continue;
      if (!bridge.ramps.includes(it.w.id)) bridge.ramps.push(it.w.id);
      const far = e.atStart ? it.pts[it.pts.length - 1] : it.pts[0];
      const hFar = h - RAMP_GRADE * len;
      if (hFar > groundY(far[0], far[1], it.lift) + 0.05) queue.push({ x: far[0], z: far[1], h: hFar, from: e.idx, bridge });
    }
  }
  // curatam profilele care nu ies deloc deasupra terenului
  for (const [idx, p] of profiles) {
    const it = items[idx];
    let any = false;
    for (let i = 0; i < p.length; i++) {
      const g = groundY(it.pts[i][0], it.pts[i][1], it.lift);
      if (p[i] > g + 0.02) any = true;
    }
    if (!any) profiles.delete(idx);
  }
  return { profiles, bridges };
}

// ---------------------------------------------------------------------------------------------
// Geometrie: cutii "maturate" de-a lungul unei polilinii (tablier, parapete, ziduri)
// ---------------------------------------------------------------------------------------------
function frames(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let ax = 0, az = 0, bx = 0, bz = 0;
    if (i > 0) { ax = p[0] - pts[i - 1][0]; az = p[1] - pts[i - 1][1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
    if (i < n - 1) { bx = pts[i + 1][0] - p[0]; bz = pts[i + 1][1] - p[1]; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    let tx = ax + bx, tz = az + bz;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = bx; tz = bz; } else { tx /= tl; tz /= tl; }
    const m = 1 / Math.max(0.5, -tz * -az + tx * ax);
    out.push({ x: p[0], z: p[1], tx, tz, nx: -tz * m, nz: tx * m });
  }
  return out;
}
// cutie intre offseturile laterale o0 < o1; yTop(i) / yBot(i, x, z) absolute; s = lungimi cumulate (uv)
function sweepBox(buf, F, s, o0, o1, yTop, yBot, col, caps = true) {
  const P = (i, o, y) => [F[i].x + F[i].nx * o, y, F[i].z + F[i].nz * o];
  for (let i = 0; i < F.length - 1; i++) {
    const j = i + 1;
    const a0 = P(i, o0, 0), a1 = P(j, o0, 0), b0 = P(i, o1, 0), b1 = P(j, o1, 0);
    const ta = yTop(i), tb = yTop(j);
    const ba0 = yBot(i, a0[0], a0[2]), ba1 = yBot(j, a1[0], a1[2]), bb0 = yBot(i, b0[0], b0[2]), bb1 = yBot(j, b1[0], b1[2]);
    const nx = -F[i].tz, nz = F[i].tx;
    const u0 = s[i], u1 = s[j];
    // fata o1 (spre +n)
    buf.quad([b0[0], bb0, b0[2]], [b1[0], bb1, b1[2]], [b1[0], tb, b1[2]], [b0[0], ta, b0[2]], [u0, bb0], [u1, bb1], [u1, tb], [u0, ta], col, nx, 0, nz);
    // fata o0 (spre -n)
    buf.quad([a1[0], ba1, a1[2]], [a0[0], ba0, a0[2]], [a0[0], ta, a0[2]], [a1[0], tb, a1[2]], [u1, ba1], [u0, ba0], [u0, ta], [u1, tb], col, -nx, 0, -nz);
    // sus
    buf.quad([a0[0], ta, a0[2]], [b0[0], ta, b0[2]], [b1[0], tb, b1[2]], [a1[0], tb, a1[2]], [u0, o0], [u0, o1], [u1, o1], [u1, o0], col, 0, 1, 0);
    // jos
    buf.quad([a0[0], ba0, a0[2]], [a1[0], ba1, a1[2]], [b1[0], bb1, b1[2]], [b0[0], bb0, b0[2]], [u0, o0], [u1, o0], [u1, o1], [u0, o1], col, 0, -1, 0);
  }
  if (!caps) return;
  for (const [i, sg] of [[0, -1], [F.length - 1, 1]]) {
    const a = P(i, o0, 0), b = P(i, o1, 0), t = yTop(i);
    buf.quad([a[0], yBot(i, a[0], a[2]), a[2]], [b[0], yBot(i, b[0], b[2]), b[2]], [b[0], t, b[2]], [a[0], t, a[2]], [o0, yBot(i, a[0], a[2])], [o1, yBot(i, b[0], b[2])], [o1, t], [o0, t], col, F[i].tx * sg, 0, F[i].tz * sg);
  }
}
const cumLen = (pts) => { const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return s; };

let concreteTexCache = null;
function concreteTexture() {
  if (concreteTexCache) return concreteTexCache;
  const t = canvasTexture(256, 256, (g, w, h) => {
    const r = rng(77);
    g.fillStyle = '#a9a69f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) { const v = 140 + r() * 60; g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.35)`; g.fillRect(r() * w, r() * h, 2, 2); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(70,70,65,${0.04 + r() * 0.06})`; const x = r() * w; g.fillRect(x, 0, 6 + r() * 20, h); } // dungi de apa
    g.fillStyle = 'rgba(60,60,58,0.35)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); // rosturi de cofraj
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 4, 1 / 4); // 4 m pe placa de cofraj (uv in metri)
  concreteTexCache = t;
  return t;
}

// items / profiles / bridges din planBridges; walkW(it) = latimea trotuarului lateral (0 daca nu are)
export function buildBridgeStructures({ items, profiles, bridges, groundY, terrainH, railIndex, waterIndex, walkW, avoidT1 = true }) {
  const group = new THREE.Group();
  group.name = 'poduri-rutiere';
  const conc = new GeoBuf(), walk = new GeoBuf(), steel = new GeoBuf();
  const white = new THREE.Color(1, 1, 1), grey = new THREE.Color(0.86, 0.86, 0.84), dark = new THREE.Color(0.75, 0.74, 0.72);
  const ground = (i, x, z) => terrainH(x, z) - 0.8;
  let pierCount = 0;

  const t1 = avoidT1 ? t1Index() : null;
  const railD = (x, z) => (railIndex ? railIndex.nearest(x, z, 12).d : Infinity);
  const t1D = (x, z) => (t1 ? t1.nearest(x, z, 12).d : Infinity);
  const pierOk = (x, z) => {
    if (railD(x, z) < RAIL_CLEAR) return false;
    if (t1D(x, z) < T1_CLEAR) return false;
    if (waterIndex) { const nw = waterIndex.nearest(x, z, 40); if (nw.seg && nw.d < nw.seg.r + 2) return false; }
    return true;
  };
  // amprenta pilei (rigla 1,8 m x toata latimea): puncte din metru in metru pe latime, pe 3 linii de-a lungul drumului
  const footprint = (x, z, f, W) => {
    const out = [];
    for (let o = -W; o <= W + 1e-6; o += Math.max(0.5, W / Math.ceil(W))) for (const t of [-PIER_HALF, 0, PIER_HALF]) out.push([x + f.nx * o + f.tx * t, z + f.nz * o + f.tz * t]);
    return out;
  };
  const piers = [];

  for (const b of bridges) {
    const it = items[b.idx];
    const pts = it.pts, s = it.s, F = frames(pts);
    const len = s[s.length - 1];
    const hr = it.width / 2, W = hr + BRIDGE_WALK + PARAPET_W;
    const Y = b.y;
    // tablier
    sweepBox(conc, F, s, -W - 0.15, W + 0.15, () => Y - 0.06, () => Y - DECK_DEPTH, grey);
    // trotuare cu bordura
    sweepBox(walk, F, s, hr, W - PARAPET_W, () => Y + 0.16, () => Y - 0.07, white, false);
    sweepBox(walk, F, s, -(W - PARAPET_W), -hr, () => Y + 0.16, () => Y - 0.07, white, false);
    // parapete + mana curenta + stalpi
    for (const sg of [-1, 1]) {
      const o0 = sg > 0 ? W - PARAPET_W : -W, o1 = sg > 0 ? W : -W + PARAPET_W;
      sweepBox(conc, F, s, o0, o1, () => Y + PARAPET_H, () => Y - 0.07, white);
      const oc = sg * (W - PARAPET_W / 2);
      sweepBox(steel, F, s, oc - 0.06, oc + 0.06, () => Y + PARAPET_H + 0.3, () => Y + PARAPET_H + 0.22, white);
    }
    // pile: candidati din metru in metru; o pila cand deschiderea curenta depaseste ~24 m
    const sup = [0];
    const cand = [];
    for (let d = 8; d < len - 8; d += 1) {
      const k = Math.min(pts.length - 2, s.findIndex((v) => v > d) - 1);
      if (k < 0) continue;
      const t = (d - s[k]) / Math.max(1e-6, s[k + 1] - s[k]);
      const x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
      // toata amprenta pilei trebuie sa fie libera (sine, axa T1, apa)
      const fp = footprint(x, z, { tx: F[k].tx, tz: F[k].tz, nx: -F[k].tz, nz: F[k].tx }, W - 0.2);
      if (fp.every(([px, pz]) => pierOk(px, pz))) cand.push({ d, x, z, k, fp });
    }
    let last = 0;
    for (let ci = 0; ci < cand.length; ci++) {
      const c = cand[ci];
      if (len - c.d < 8) break;
      const nextD = ci + 1 < cand.length ? cand[ci + 1].d : len;
      if (c.d - last >= 22 || (c.d - last >= 12 && nextD - last > 30)) {
        sup.push(c.d); last = c.d;
        const { k, x, z } = c;
        let mt = Infinity, mr = Infinity;
        for (const [px, pz] of c.fp) { mt = Math.min(mt, t1Index().nearest(px, pz, 60).d); mr = Math.min(mr, railIndex ? railIndex.nearest(px, pz, 60).d : Infinity); }
        piers.push({ id: b.id, d: c.d, x, z, t1: mt, rail: mr });
        const tx = F[k].tx, tz = F[k].tz, nx = -tz, nz = tx;
        // rigla (cap) + 3 coloane
        const capPts = [[x - nx * (W - 0.2), z - nz * (W - 0.2)], [x + nx * (W - 0.2), z + nz * (W - 0.2)]];
        const CF = frames(capPts), cs = cumLen(capPts);
        sweepBox(conc, CF, cs, -0.9, 0.9, () => Y - DECK_DEPTH, () => Y - DECK_DEPTH - 1.1, grey);
        const ncol = W > 7 ? 3 : 2;
        for (let q = 0; q < ncol; q++) {
          const o = -W * 0.62 + (q * (W * 1.24)) / (ncol - 1);
          const cx = x + nx * o, cz = z + nz * o;
          const cp = [[cx - tx * 0.6, cz - tz * 0.6], [cx + tx * 0.6, cz + tz * 0.6]];
          sweepBox(conc, frames(cp), cumLen(cp), -0.6, 0.6, () => Y - DECK_DEPTH - 1.1, (i, xx, zz) => terrainH(xx, zz) - 0.5, white);
        }
        pierCount++;
      }
    }
    sup.push(len);
    b.piers = sup.length - 2;
    // culei la capete: perete transversal de 2,5 m grosime pana in teren
    for (const atStart of [true, false]) {
      const i = atStart ? 0 : pts.length - 1;
      const f = F[i];
      const sg = atStart ? 1 : -1;
      const ab = [[f.x, f.z], [f.x + f.tx * sg * 2.5, f.z + f.tz * sg * 2.5]];
      sweepBox(conc, frames(ab), cumLen(ab), -W - 0.3, W + 0.3, () => Y - 0.07, ground, dark);
    }
  }

  // rampe: ziduri de sprijin + parapet (unde rambleul > 1 m)
  for (const [idx, p] of profiles) {
    const it = items[idx];
    if (it.w.br && bridges.some((b) => b.idx === idx)) continue;
    const pts = it.pts, s = it.s, F = frames(pts);
    const hr = it.width / 2 + walkW(it);
    const elev = pts.map(([x, z], i) => p[i] - groundY(x, z, it.lift));
    // sub-tronsoane continue ridicate
    let a = -1;
    const flush = (i0, i1) => {
      if (i1 - i0 < 1) return;
      const sub = pts.slice(i0, i1 + 1), FS = F.slice(i0, i1 + 1), ss = s.slice(i0, i1 + 1);
      const top = (i) => Math.max(p[i0 + i], groundY(sub[i][0], sub[i][1], it.lift)) - 0.02;
      for (const sg of [-1, 1]) {
        const o0 = sg > 0 ? hr : -hr - 0.45, o1 = sg > 0 ? hr + 0.45 : -hr;
        sweepBox(conc, FS, ss, o0, o1, top, ground, dark, false);
        const oc = sg * (hr + 0.22);
        sweepBox(conc, FS, ss, oc - 0.2, oc + 0.2, (i) => top(i) + (elev[i0 + i] > 1 ? 1.0 : 0.25), (i) => top(i), white, false);
      }
    };
    for (let i = 0; i < pts.length; i++) {
      const up = elev[i] > 0.12;
      if (up && a < 0) a = Math.max(0, i - 1);
      if (!up && a >= 0) { flush(a, i); a = -1; }
    }
    if (a >= 0) flush(a, pts.length - 1);
  }

  const mats = {
    conc: new THREE.MeshStandardMaterial({ map: concreteTexture(), vertexColors: true, roughness: 0.92 }),
    walk: new THREE.MeshStandardMaterial({ color: 0xb9b6ae, vertexColors: true, roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5f6a72, vertexColors: true, roughness: 0.45, metalness: 0.6 }),
  };
  for (const [k, buf] of [['conc', conc], ['walk', walk], ['steel', steel]]) {
    if (!buf.count) continue;
    const m = new THREE.Mesh(buf.build(), mats[k]);
    m.castShadow = true; m.receiveShadow = true; m.name = 'poduri-' + k;
    group.add(m);
  }
  return { group, pierCount, piers };
}
