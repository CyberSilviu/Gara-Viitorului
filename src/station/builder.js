import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Utilitare de constructie: geometria statica se aduna pe material si se uneste (un draw call / material).
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export function normalizeGeo(g) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  geo.morphAttributes = {};
  geo.clearGroups();
  if (geo !== g) g.dispose();
  return geo;
}

// Cutie cu UV in metri (tile = dimensiunea unei repetari a texturii)
export function boxGeo(w, h, d, tile = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
    }
  }
  return g;
}

// Patrulater orizontal (normala +y) cu UV in metri
export function hquadGeo(x0, z0, x1, z1, y, tile = 1) {
  const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0));
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * Math.abs(x1 - x0)) / tile, (uv.getY(i) * Math.abs(z1 - z0)) / tile);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

// Panou vertical (normala +z inainte de rotatie) — pentru semne / ecrane
export function panelGeo(w, h, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// Geometrie din triunghiuri date ca lista de puncte [x,y,z] (cate 3)
export function triGeo(tris, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.computeVertexNormals();
  return g;
}

export function transformGeo(geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}

export class Batch {
  constructor(name = 'batch') { this.name = name; this.map = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    if (!mat) throw new Error('Batch.add fara material');
    transformGeo(geo, x, y, z, ry, rx, rz);
    const g = normalizeGeo(geo);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
    return this;
  }
  box(mat, cx, cy, cz, w, h, d, ry = 0, tile = 0, rx = 0) { return this.add(mat, boxGeo(w, h, d, tile), cx, cy, cz, ry, rx); }
  aabb(mat, x0, y0, z0, x1, y1, z1, tile = 0) {
    return this.box(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 0, tile);
  }
  cyl(mat, x, y0, z, r, h, seg = 10, r2 = null) {
    const g = new THREE.CylinderGeometry(r2 ?? r, r, h, seg);
    return this.add(mat, g, x, y0 + h / 2, z);
  }
  hquad(mat, x0, z0, x1, z1, y, tile = 1) { return this.add(mat, hquadGeo(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, tile)); }
  build(parent, { cast = true, receive = true } = {}) {
    const meshes = [];
    for (const [mat, list] of this.map) {
      if (!list.length) continue;
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      list.forEach((g) => g !== geo && g.dispose());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${this.name}:${mat.name || 'mat'}`;
      mesh.castShadow = cast && !mat.userData.noShadow && !mat.transparent;
      mesh.receiveShadow = receive && !mat.userData.noReceive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.map.clear();
    return meshes;
  }
}

// Coliziuni (pereti) si suprafete de mers — mesh-uri invizibile, unite.
const INVIS_COL = new THREE.MeshBasicMaterial({ visible: false, side: THREE.FrontSide });
const INVIS_WALK = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
INVIS_COL.name = 'coliziune'; INVIS_WALK.name = 'podea';

export class Phys {
  constructor(name) { this.name = name; this.col = []; this.walk = []; }
  wall(cx, cy, cz, w, h, d, ry = 0, rx = 0) { this.col.push(transformGeo(normalizeGeo(new THREE.BoxGeometry(w, h, d)), cx, cy, cz, ry, rx)); return this; }
  wallAabb(x0, y0, z0, x1, y1, z1) { return this.wall((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)); }
  floor(x0, z0, x1, z1, y) { this.walk.push(normalizeGeo(hquadGeo(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, 1))); return this; }
  // rampa / scara: dreptunghi inclinat intre (x0,z0)-(x1,z1) pe latime, de la y0 la y1 (directia = de la capatul 0 la 1)
  ramp(ax, az, ay, bx, bz, by, width) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * (width / 2), nz = (dx / L) * (width / 2);
    const p = [[ax + nx, ay, az + nz], [ax - nx, ay, az - nz], [bx - nx, by, bz - nz], [bx + nx, by, bz + nz]];
    this.walk.push(normalizeGeo(triGeo([p[0], p[1], p[2], p[0], p[2], p[3]])));
    return this;
  }
  geoWalk(g) { this.walk.push(normalizeGeo(g)); return this; }
  build(parent) {
    const out = { colliders: [], walkables: [] };
    if (this.col.length) {
      const m = new THREE.Mesh(mergeGeometries(this.col, false), INVIS_COL);
      m.name = this.name + ':coliziuni'; parent.add(m); out.colliders.push(m);
    }
    if (this.walk.length) {
      const m = new THREE.Mesh(mergeGeometries(this.walk, false), INVIS_WALK);
      m.name = this.name + ':podele'; parent.add(m); out.walkables.push(m);
    }
    this.col = []; this.walk = [];
    return out;
  }
}

export function invisibleBox(w, h, d) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), INVIS_COL);
}
export function invisibleFloor(w, d) {
  const g = new THREE.BoxGeometry(w, 0.1, d);
  g.translate(0, -0.05, 0);
  return new THREE.Mesh(g, INVIS_WALK);
}

// InstancedMesh din lista de transformari {x,y,z,ry,s|sx,sy,sz}
export function instanced(geo, mat, list, { cast = true, receive = true, colors = null, name = '' } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  if (name) mesh.name = name;
  const c = new THREE.Color();
  list.forEach((t, i) => {
    _e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ');
    _q.setFromEuler(_e);
    const s = t.s ?? 1;
    _m.compose(_p.set(t.x, t.y || 0, t.z), _q, _s.set(t.sx ?? s, t.sy ?? s, t.sz ?? s));
    mesh.setMatrixAt(i, _m);
    if (colors) mesh.setColorAt(i, c.set(colors[i % colors.length]));
  });
  mesh.count = list.length;
  mesh.castShadow = cast && !mat.transparent;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

// Uneste mai multe geometrii (cu transformari) intr-una singura — pentru obiecte instantiate compuse
export function compose(parts) {
  const list = parts.map(([geo, x, y, z, ry, rx, rz]) => normalizeGeo(transformGeo(geo, x || 0, y || 0, z || 0, ry || 0, rx || 0, rz || 0)));
  return mergeGeometries(list, false);
}

// Acoperis in patru ape peste dreptunghiul [x0,x1]x[z0,z1] la cota y, inaltime h
export function hipRoofGeo(x0, z0, x1, z1, y, h, over = 0.5) {
  x0 -= over; z0 -= over; x1 += over; z1 += over;
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let r0, r1; // capetele coamei
  if (d >= w) { const k = w / 2; r0 = [cx, y + h, z0 + k]; r1 = [cx, y + h, z1 - k]; }
  else { const k = d / 2; r0 = [x0 + k, y + h, cz]; r1 = [x1 - k, y + h, cz]; }
  const A = [x0, y, z0], B = [x1, y, z0], C = [x1, y, z1], D = [x0, y, z1];
  let tris;
  if (d >= w) {
    tris = [
      [A, r0, B], // capat nord
      [C, r1, D], // capat sud
      [B, r0, r1], [B, r1, C], // panta est
      [D, r1, r0], [D, r0, A], // panta vest
    ];
  } else {
    tris = [
      [D, r0, A], [B, r1, C],
      [A, r0, r1], [A, r1, B],
      [C, r1, r0], [C, r0, D],
    ];
  }
  const flat = [];
  for (const t of tris) flat.push(t[0], t[1], t[2]);
  const uvs = flat.map((p) => [p[0] / 2 + p[1] * 0.3, p[2] / 2]);
  return triGeo(flat, uvs);
}
