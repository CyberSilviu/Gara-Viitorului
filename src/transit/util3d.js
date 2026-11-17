import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Utilitare geometrice comune pentru modulul de transport.
// Toate geometriile "statice" se unesc (merge) pe material, ca sa avem putine draw call-uri.

const _c = new THREE.Color();

// seteaza culoarea pe varfuri (atribut 'color')
export function tint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// normalizeaza geometriile (ne-indexate, aceleasi atribute) si le uneste
export function merge(list, { uv = false, color = true } = {}) {
  const prepared = [];
  for (let g of list) {
    if (!g) continue;
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (color && !g.attributes.color) tint(g, 0xffffff);
    if (uv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) {
      if (k === 'position' || k === 'normal' || (k === 'color' && color) || (k === 'uv' && uv)) continue;
      g.deleteAttribute(k);
    }
    g.morphAttributes = {};
    g.clearGroups();
    prepared.push(g);
  }
  if (!prepared.length) return null;
  return mergeGeometries(prepared, false);
}

// cutie colorata, cu transformare optionala
export function box(w, h, d, x = 0, y = 0, z = 0, color = 0xffffff, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return tint(g, color);
}

export function cyl(rt, rb, h, seg, x, y, z, color, rotX = 0, rotZ = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return tint(g, color);
}

// roti de vehicul: cilindri culcati (axa = x), cu janta deschisa la culoare pe fata exterioara
// r = raza, w = latimea anvelopei, x = semiecartament, zs = pozitiile osiilor (inainte = -z)
export function wheelSet(r, w, x, zs, seg = 10) {
  const out = [];
  for (const z of zs) for (const sx of [-1, 1]) {
    out.push(cyl(r, r, w, seg, sx * x, r, z, 0x16181b, 0, Math.PI / 2));
    out.push(cyl(r * 0.55, r * 0.55, 0.02, seg, sx * (x + w / 2 + 0.005), r, z, 0x9aa3ab, 0, Math.PI / 2));
  }
  return out;
}

// aplica o matrice si returneaza geometria
export function xf(g, m) { g.applyMatrix4(m); return g; }

// matrice din pozitie + unghi de rotatie in jurul lui Y
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function placeMatrix(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromAxisAngle(_up, ry);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s);
}

// Panglica 3D de-a lungul unei curbe: samples = [{x,y,z, rx, rz}] (rx,rz = vector "dreapta" orizontal)
// a = deplasare laterala stanga, b = dreapta, dy = inaltare. Normala in sus.
export function sweepStrip(samples, a, b, dy = 0, { uvScale = 1, color = null, dy2 = null } = {}) {
  const pos = [], uv = [];
  let d = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const p = samples[i], q = samples[i + 1];
    const seg = Math.hypot(q.x - p.x, q.z - p.z);
    const yA = dy, yB = dy2 === null ? dy : dy2;
    const P = (s, off, yy) => [s.x + s.rx * off, s.y + yy, s.z + s.rz * off];
    const pa = P(p, a, yA), pb = P(p, b, yB), qa = P(q, a, yA), qb = P(q, b, yB);
    // dreapta = (-tz, tx) => ordinea (b_p, b_q, a_p) da normala in sus
    pos.push(...pb, ...qb, ...pa, ...pa, ...qb, ...qa);
    const d0 = d * uvScale, d1 = (d + seg) * uvScale;
    uv.push(1, d0, 1, d1, 0, d0, 0, d0, 1, d1, 0, d1);
    d += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  if (color !== null) tint(g, color);
  return g;
}

// Profil (sectiune transversala) maturat de-a lungul curbei.
// profile = [[lat, dy], ...] (lat = dreapta +). Fara capace.
export function sweepProfile(samples, profile, { color = null, closed = false } = {}) {
  const pos = [];
  const n = profile.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < samples.length - 1; i++) {
    const p = samples[i], q = samples[i + 1];
    for (let k = 0; k < last; k++) {
      const [l0, h0] = profile[k], [l1, h1] = profile[(k + 1) % n];
      const A = [p.x + p.rx * l0, p.y + h0, p.z + p.rz * l0];
      const B = [p.x + p.rx * l1, p.y + h1, p.z + p.rz * l1];
      const C = [q.x + q.rx * l0, q.y + h0, q.z + q.rz * l0];
      const D = [q.x + q.rx * l1, q.y + h1, q.z + q.rz * l1];
      // profil parcurs stanga -> sus -> dreapta => fete spre exterior
      pos.push(...A, ...B, ...C, ...B, ...D, ...C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  if (color !== null) tint(g, color);
  return g;
}

// text pe canvas (cu diacritice)
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// pictograma avion (desenata, pentru indicatoare)
export function drawPlane(g, cx, cy, s, color = '#fff', rot = -Math.PI / 4) {
  g.save();
  g.translate(cx, cy); g.rotate(rot); g.scale(s / 100, s / 100);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, -50); g.quadraticCurveTo(7, -45, 7, -30);
  g.lineTo(7, -8); g.lineTo(48, 14); g.lineTo(48, 24); g.lineTo(7, 12);
  g.lineTo(6, 34); g.lineTo(18, 44); g.lineTo(18, 51); g.lineTo(0, 45);
  g.lineTo(-18, 51); g.lineTo(-18, 44); g.lineTo(-6, 34); g.lineTo(-7, 12);
  g.lineTo(-48, 24); g.lineTo(-48, 14); g.lineTo(-7, -8); g.lineTo(-7, -30);
  g.quadraticCurveTo(-7, -45, 0, -50);
  g.fill();
  g.restore();
}

export const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
