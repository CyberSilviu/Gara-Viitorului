import * as THREE from 'three';

// Generator pseudo-aleator determinist (aceeasi lume la fiecare rulare)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return a / 2;
}

export function centroid(poly) {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
}

export function bboxOf(poly) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX, minZ, maxX, maxZ };
}

// ---------------------------------------------------------------------------------------------
// Geometrie plana (pura, fara THREE) – folosita de city.js si de scripts/clean-buildings.mjs
// ---------------------------------------------------------------------------------------------

// distanta punct – segment
export function distPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

const orient = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);

// segmentele AB si CD se intersecteaza (inclusiv atingere)
export function segsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const o1 = orient(ax, az, bx, bz, cx, cz), o2 = orient(ax, az, bx, bz, dx, dz);
  const o3 = orient(cx, cz, dx, dz, ax, az), o4 = orient(cx, cz, dx, dz, bx, bz);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  const on = (px, pz, qx, qz, rx, rz) => Math.min(px, qx) - 1e-9 <= rx && rx <= Math.max(px, qx) + 1e-9 && Math.min(pz, qz) - 1e-9 <= rz && rz <= Math.max(pz, qz) + 1e-9;
  if (o1 === 0 && on(ax, az, bx, bz, cx, cz)) return true;
  if (o2 === 0 && on(ax, az, bx, bz, dx, dz)) return true;
  if (o3 === 0 && on(cx, cz, dx, dz, ax, az)) return true;
  if (o4 === 0 && on(cx, cz, dx, dz, bx, bz)) return true;
  return false;
}

// distanta minima intre segmentele AB si CD (0 daca se intersecteaza)
export function distSegSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  if (segsIntersect(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  return Math.min(
    distPointSeg(ax, az, cx, cz, dx, dz), distPointSeg(bx, bz, cx, cz, dx, dz),
    distPointSeg(cx, cz, ax, az, bx, bz), distPointSeg(dx, dz, ax, az, bx, bz),
  );
}

const bbOverlap = (a, b, pad = 0) => a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minZ - pad <= b.maxZ && a.maxZ + pad >= b.minZ;

// Doua poligoane (inele [[x,z],...]) se intersecteaza: un varf al unuia in celalalt SAU doua laturi se taie.
// (nu doar centroidul!) `ba`/`bb` = bbox-uri precalculate (optional).
export function polyIntersectsPoly(A, B, ba = bboxOf(A), bb = bboxOf(B)) {
  if (!bbOverlap(ba, bb)) return false;
  for (const [x, z] of A) if (pointInPoly(x, z, B)) return true;
  for (const [x, z] of B) if (pointInPoly(x, z, A)) return true;
  for (let i = 0, j = A.length - 1; i < A.length; j = i++) {
    const ax = A[j][0], az = A[j][1], bx = A[i][0], bz = A[i][1];
    for (let k = 0, l = B.length - 1; k < B.length; l = k++) {
      if (segsIntersect(ax, az, bx, bz, B[l][0], B[l][1], B[k][0], B[k][1])) return true;
    }
  }
  return false;
}

// Poligonul atinge "banda" de raza r in jurul segmentului AB (segment in poligon sau la distanta < r de o latura)
export function polyNearSegment(poly, ax, az, bx, bz, r) {
  if (pointInPoly(ax, az, poly) || pointInPoly(bx, bz, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distSegSeg(poly[j][0], poly[j][1], poly[i][0], poly[i][1], ax, az, bx, bz) < r) return true;
  }
  return false;
}

// Infasuratoarea convexa (monotone chain). Returneaza inel inchis.
export function convexHull(points) {
  const P = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of P) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hull.push([hull[0][0], hull[0][1]]);
  return hull;
}

// Dreptunghiul de arie minima (rotating calipers pe infasuratoare): { long, short, area }
export function minAreaRect(points) {
  const H = convexHull(points);
  let best = null;
  for (let i = 0; i < H.length - 1; i++) {
    let ux = H[i + 1][0] - H[i][0], uz = H[i + 1][1] - H[i][1];
    const L = Math.hypot(ux, uz); if (L < 1e-9) continue;
    ux /= L; uz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of H) { const a = x * ux + z * uz, b = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const w = a1 - a0, h = b1 - b0;
    if (!best || w * h < best.area) best = { long: Math.max(w, h), short: Math.min(w, h), area: w * h };
  }
  return best || { long: 0, short: 0, area: 0 };
}

// Dreptunghiul orientat de arie minima, cu axe: { cx, cz, ux, uz (axa lunga), hl, hw (semi-laturi), area }
export function orientedRect(points) {
  const H = convexHull(points);
  let best = null;
  for (let i = 0; i < H.length - 1; i++) {
    let ux = H[i + 1][0] - H[i][0], uz = H[i + 1][1] - H[i][1];
    const L = Math.hypot(ux, uz); if (L < 1e-9) continue;
    ux /= L; uz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of H) { const a = x * ux + z * uz, b = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { ux, uz, a0, a1, b0, b1, area };
  }
  if (!best) return null;
  const { ux, uz, a0, a1, b0, b1, area } = best;
  const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
  // centrul: a*u + b*v, cu v = (-uz, ux)
  const cx = am * ux - bm * uz, cz = am * uz + bm * ux;
  let hl = (a1 - a0) / 2, hw = (b1 - b0) / 2, ax = ux, az = uz;
  if (hw > hl) { [hl, hw] = [hw, hl]; ax = -uz; az = ux; }
  return { cx, cz, ux: ax, uz: az, hl, hw, area };
}

// Index spatial (grila) pentru segmente cu raza ("benzi" in jurul axelor drumurilor / CF / rauri).
export class SegmentIndex {
  constructor(cell = 60) { this.cell = cell; this.grid = new Map(); this.segs = []; }
  add(ax, az, bx, bz, r, tag) {
    const s = { ax, az, bx, bz, r, tag, id: this.segs.length };
    this.segs.push(s);
    const c = this.cell;
    const x0 = Math.floor((Math.min(ax, bx) - r) / c), x1 = Math.floor((Math.max(ax, bx) + r) / c);
    const z0 = Math.floor((Math.min(az, bz) - r) / c), z1 = Math.floor((Math.max(az, bz) + r) / c);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx * 73856093 ^ gz * 19349663;
      let arr = this.grid.get(k); if (!arr) this.grid.set(k, (arr = []));
      arr.push(s);
    }
    return s;
  }
  addPolyline(pts, r, tag) { for (let i = 0; i < pts.length - 1; i++) this.add(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r, tag); }
  // apeleaza fn(seg) pentru fiecare segment (o singura data) din celulele care acopera bbox-ul; fn intoarce true => stop
  query(bb, fn) {
    const c = this.cell, seen = new Set();
    for (let gx = Math.floor(bb.minX / c); gx <= Math.floor(bb.maxX / c); gx++) for (let gz = Math.floor(bb.minZ / c); gz <= Math.floor(bb.maxZ / c); gz++) {
      const arr = this.grid.get(gx * 73856093 ^ gz * 19349663);
      if (!arr) continue;
      for (const s of arr) { if (seen.has(s.id)) continue; seen.add(s.id); if (fn(s)) return true; }
    }
    return false;
  }
  // primul segment a carui banda (raza r) atinge poligonul, sau null
  hitPoly(poly, bb = bboxOf(poly), filter = null) {
    let hit = null;
    this.query(bb, (s) => {
      if (filter && !filter(s)) return false;
      if (Math.min(s.ax, s.bx) - s.r > bb.maxX || Math.max(s.ax, s.bx) + s.r < bb.minX || Math.min(s.az, s.bz) - s.r > bb.maxZ || Math.max(s.az, s.bz) + s.r < bb.minZ) return false;
      if (polyNearSegment(poly, s.ax, s.az, s.bx, s.bz, s.r)) { hit = s; return true; }
      return false;
    });
    return hit;
  }
  // distanta minima de la punct la orice segment (cautare pana la maxR)
  nearest(x, z, maxR) {
    let best = Infinity, bs = null;
    this.query({ minX: x - maxR, maxX: x + maxR, minZ: z - maxR, maxZ: z + maxR }, (s) => {
      const d = distPointSeg(x, z, s.ax, s.az, s.bx, s.bz);
      if (d < best) { best = d; bs = s; }
      return false;
    });
    return { d: best, seg: bs };
  }
}

// ---------------------------------------------------------------------------------------------
// Drumuri: latimi randate + ordinea straturilor (cota peste teren, in metri, fata de heightAt)
// ---------------------------------------------------------------------------------------------
export const ROAD_WIDTH = {
  motorway: 24, motorway_link: 8, trunk: 14, trunk_link: 7, primary: 11, primary_link: 6, secondary: 9, secondary_link: 6,
  tertiary: 8, tertiary_link: 5.5, residential: 6, unclassified: 5.5, living_street: 5, service: 3.5, pedestrian: 5,
};
// Straturi drapate pe teren (heightAt = suprafata exacta a terenului randat):
// zone < apa < drumuri minore < drumuri majore < autostrada < CF (oras) < T1 (modul transport)
export const GROUND_LIFT = { area: 0.04, water: 0.06, minor: 0.1, major: 0.13, motorway: 0.15, construction: 0.15, rail: 0.2 };
// polygonOffset (factor, units) pe straturi – aceeasi ordine; doar "units" creste, factorul ramane -1
export const GROUND_OFFSET = { area: -1, water: -2, minor: -3, major: -4, motorway: -4, construction: -4, rail: -6 };

export function isMotorwayConstruction(w) { return w.k === 'construction' && (/motorway/.test(w.c || '') || /A[78]/.test(w.ref || '')); }

// { width, bucket } pentru un drum din osm.json
export function roadStyle(w) {
  const k = w.k;
  let width = ROAD_WIDTH[k] || 5;
  if (k === 'construction') width = isMotorwayConstruction(w) ? 26 : 8;
  else if (w.lanes && ['primary', 'secondary', 'tertiary', 'trunk'].includes(k)) width = Math.max(width, Math.min(22, w.lanes * 3.3 + 1));
  const bucket = k.startsWith('motorway') ? 'motorway' : k === 'construction' ? 'construction'
    : ['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link'].includes(k) ? 'major' : 'minor';
  return { width, bucket };
}

// Subdivide o polilinie astfel incat segmentele sa nu depaseasca `step` metri
export function densify(points, step = 15) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  out.push(points[points.length - 1]);
  return out;
}

// Panglica (drum / cale ferata / rau) drapata pe teren. Returneaza BufferGeometry ne-indexata.
// Fiecare margine (stanga / dreapta) urmareste terenul separat => panglica nu intra in panta transversala.
// La colturi latimea se pastreaza (imbinare "miter", limitata la 2x).
export function ribbonGeometry(points, width, heightAt, lift = 0.2, step = 15, fixedY = null) {
  // eliminam punctele duplicate (segmente de lungime 0 => normale gresite)
  const clean = [];
  for (const p of points) { const q = clean[clean.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) clean.push(p); }
  const pos = [], uv = [];
  if (clean.length < 2) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3)); return g; }
  const pts = densify(clean, step);
  const n = pts.length;
  const left = [], right = [], yl = [], yr = [], ds = [];
  let dist = 0;
  const hw = width / 2;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    // directiile segmentelor adiacente
    let ax = 0, az = 0, bx = 0, bz = 0;
    if (i > 0) { ax = p[0] - pts[i - 1][0]; az = p[1] - pts[i - 1][1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
    if (i < n - 1) { bx = pts[i + 1][0] - p[0]; bz = pts[i + 1][1] - p[1]; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    let tx = ax + bx, tz = az + bz;
    let tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = bx; tz = bz; tl = 1; }
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    // miter: 1 / cos(jumatate din unghi), limitat
    const cosH = Math.max(0.5, nx * -az + nz * ax);
    const m = hw / cosH;
    const L = [p[0] + nx * m, p[1] + nz * m], Rr = [p[0] - nx * m, p[1] - nz * m];
    left.push(L); right.push(Rr);
    if (fixedY !== null) {
      const y = typeof fixedY === 'function' ? fixedY(p[0], p[1], i, n) : fixedY;
      yl.push(y); yr.push(y);
    } else {
      yl.push(heightAt(L[0], L[1]) + lift);
      yr.push(heightAt(Rr[0], Rr[1]) + lift);
    }
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    ds.push(dist);
  }
  for (let i = 0; i < n - 1; i++) {
    const l0 = left[i], r0 = right[i], l1 = left[i + 1], r1 = right[i + 1];
    // ordinea varfurilor => normala in sus (+y)
    pos.push(l0[0], yl[i], l0[1], l1[0], yl[i + 1], l1[1], r0[0], yr[i], r0[1]);
    pos.push(r0[0], yr[i], r0[1], l1[0], yl[i + 1], l1[1], r1[0], yr[i + 1], r1[1]);
    uv.push(0, ds[i], 0, ds[i + 1], 1, ds[i], 1, ds[i], 0, ds[i + 1], 1, ds[i + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Disc (evantai) drapat pe teren – capete / intersectii rotunde pentru drumuri. Ne-indexat, normala in sus.
export function discGeometry(x, z, r, heightAt, lift, segs = 12) {
  const pos = [], uv = [];
  const yc = heightAt(x, z) + lift;
  const rim = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    rim.push([px, heightAt(px, pz) + lift, pz]);
  }
  for (let i = 0; i < segs; i++) {
    const a = rim[i], b = rim[i + 1];
    // (centru, b, a) => normala +y (unghiul creste de la +x spre +z)
    pos.push(x, yc, z, b[0], b[1], b[2], a[0], a[1], a[2]);
    uv.push(0.5, 0, 0.5, r, 0.5, r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Textura din canvas
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Tampon de geometrie ne-indexata care creste singur (pozitie, normala, uv, culoare) – pentru mii de cladiri
// fara mii de BufferGeometry intermediare. tri(...) corecteaza ordinea varfurilor astfel incat normala fetei
// sa fie de aceeasi parte cu directia sugerata (hx, hy, hz); triunghiurile degenerate sunt ignorate.
export class GeoBuf {
  constructor(cap = 4096) { this.cap = cap; this.count = 0; this.pos = new Float32Array(cap * 3); this.nor = new Float32Array(cap * 3); this.uv = new Float32Array(cap * 2); this.col = new Float32Array(cap * 3); }
  grow() {
    const cap = this.cap * 2;
    for (const [k, n] of [['pos', 3], ['nor', 3], ['uv', 2], ['col', 3]]) { const a = new Float32Array(cap * n); a.set(this[k]); this[k] = a; }
    this.cap = cap;
  }
  tri(a, b, c, ua, ub, uc, color, hx, hy, hz) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-6) return;
    nx /= l; ny /= l; nz /= l;
    if (nx * hx + ny * hy + nz * hz < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; nx = -nx; ny = -ny; nz = -nz; }
    if (this.count + 3 > this.cap) this.grow();
    let i = this.count;
    for (const [p, t] of [[a, ua], [b, ub], [c, uc]]) {
      this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
      this.nor[i * 3] = nx; this.nor[i * 3 + 1] = ny; this.nor[i * 3 + 2] = nz;
      this.uv[i * 2] = t[0]; this.uv[i * 2 + 1] = t[1];
      this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
      i++;
    }
    this.count = i;
  }
  quad(a, b, c, d, ua, ub, uc, ud, color, hx, hy, hz) { this.tri(a, b, c, ua, ub, uc, color, hx, hy, hz); this.tri(a, c, d, ua, uc, ud, color, hx, hy, hz); }
  build() {
    const n = this.count, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3));
    g.computeBoundingSphere();
    return g;
  }
}

// Panglica pe puncte DEJA densificate, cu cota pe margine data de yEdge(ex, ez, i) (drumuri pe poduri / rampe).
// uv: u 0..1 de-a curmezisul, v = metri de-a lungul (ca ribbonGeometry). Ne-indexata, normala in sus.
export function profileRibbon(pts, width, yEdge) {
  const n = pts.length, hw = width / 2;
  const left = [], right = [], yl = [], yr = [], ds = [];
  let dist = 0;
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
    const nx = -tz, nz = tx;
    const m = hw / Math.max(0.5, nx * -az + nz * ax);
    const L = [p[0] + nx * m, p[1] + nz * m], R = [p[0] - nx * m, p[1] - nz * m];
    left.push(L); right.push(R);
    yl.push(yEdge(L[0], L[1], i)); yr.push(yEdge(R[0], R[1], i));
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    ds.push(dist);
  }
  const pos = [], uv = [];
  for (let i = 0; i < n - 1; i++) {
    const l0 = left[i], r0 = right[i], l1 = left[i + 1], r1 = right[i + 1];
    pos.push(l0[0], yl[i], l0[1], l1[0], yl[i + 1], l1[1], r0[0], yr[i], r0[1]);
    pos.push(r0[0], yr[i], r0[1], l1[0], yl[i + 1], l1[1], r1[0], yr[i + 1], r1[1]);
    uv.push(0, ds[i], 0, ds[i + 1], 1, ds[i], 1, ds[i], 0, ds[i + 1], 1, ds[i + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Polilinie fara puncte duplicate, densificata la <= step
export function cleanDense(points, step) {
  const clean = [];
  for (const p of points) { const q = clean[clean.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) clean.push(p); }
  return clean.length < 2 ? clean : densify(clean, step);
}
