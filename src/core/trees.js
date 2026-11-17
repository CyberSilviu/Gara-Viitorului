import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, pointInPoly, bboxOf, canvasTexture } from './util.js';

// Copaci instantiati: 4 specii (foioase cu coroana lata, foioase mici/rotunde, conifere, plopi).
// Fiecare specie = UN InstancedMesh (trunchi + coroana in aceeasi geometrie => 4 apeluri de desenare in total).
// Coroana = cateva icosaedre grupate, normale "netede" spre centrul coroanei (aspect de frunzis, nu de poliedru),
// textura de frunzis; culoarea pe instanta nuanteaza doar coroana (atributul aCrown), trunchiul ramane maro.
// Vant: legare usoara in shaderul de varfuri (proportional cu inaltimea), faza din pozitia instantei.

const SPECIES = ['broad', 'round', 'conifer', 'poplar'];
const MAX_TREES = 12500;          // ~73 triunghiuri / copac in medie => ~0,9 M triunghiuri
const MAX_STREET = 4500;

function foliageTexture() {
  const r = rng(77);
  const t = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, h);
    // ciorchini de frunze: pete deschise + goluri intunecate (lumina / umbra in coroana)
    for (let i = 0; i < 900; i++) {
      const x = r() * w, y = r() * h, rad = 3 + r() * 9, l = r() < 0.35 ? 70 + r() * 60 : 190 + r() * 65;
      g.fillStyle = `rgba(${l},${l},${l},${0.35 + r() * 0.4})`;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      if (x < rad) { g.beginPath(); g.arc(x + w, y, rad, 0, Math.PI * 2); g.fill(); }
      if (y < rad) { g.beginPath(); g.arc(x, y + h, rad, 0, Math.PI * 2); g.fill(); }
    }
    for (let i = 0; i < 2500; i++) { const l = r() < 0.5 ? 60 : 245; g.fillStyle = `rgba(${l},${l},${l},0.35)`; g.fillRect(r() * w, r() * h, 2, 2); }
  });
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// geometrie ne-indexata cu atributele position/normal/uv/color/aCrown
function part(geo, crown, color, centre = null, soft = 0.75) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv1');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), cr = new Float32Array(n).fill(crown ? 1 : 0);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aCrown', new THREE.BufferAttribute(cr, 1));
  if (crown && centre) { // normale: amestec intre normala fetei si directia din centrul coroanei
    const p = g.attributes.position, nr = g.attributes.normal, v = new THREE.Vector3(), m = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, i).sub(centre).normalize();
      m.fromBufferAttribute(nr, i).multiplyScalar(1 - soft).addScaledVector(v, soft).normalize();
      nr.setXYZ(i, m.x, m.y, m.z);
    }
  }
  return g;
}

function trunk(h, r0, r1, seg = 5) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true);
  g.translate(0, h / 2 - 0.3, 0);
  return part(g, false, 0x5b4636);
}

function lump(rad, x, y, z, sy = 1, detail = 0) {
  const g = new THREE.IcosahedronGeometry(rad, detail);
  g.scale(1, sy, 1);
  g.rotateY(x * 3.1 + z * 1.7);
  g.translate(x, y, z);
  return g;
}

function speciesGeometry(kind) {
  const parts = [];
  if (kind === 'broad') { // tei / stejar / artar: coroana lata din 4 ciorchini
    parts.push(trunk(4.2, 0.32, 0.2, 6));
    const C = new THREE.Vector3(0, 6.2, 0);
    for (const [r, x, y, z, sy] of [[2.9, 0, 6.6, 0, 0.85], [2.2, 1.6, 5.6, 0.6, 0.8], [2.1, -1.4, 5.7, -0.9, 0.8], [1.9, -0.4, 5.4, 1.6, 0.8]]) {
      parts.push(part(lump(r, x, y, z, sy), true, 0xffffff, C));
    }
  } else if (kind === 'round') { // pomi fructiferi, arbusti, salcami mici
    parts.push(trunk(2.4, 0.2, 0.13, 5));
    const C = new THREE.Vector3(0, 3.6, 0);
    for (const [r, x, y, z, sy] of [[1.9, 0, 3.9, 0, 0.85], [1.4, 1.0, 3.2, 0.3, 0.85], [1.3, -0.8, 3.3, -0.6, 0.85]]) {
      parts.push(part(lump(r, x, y, z, sy), true, 0xffffff, C));
    }
  } else if (kind === 'conifer') { // molid / pin: trei conuri suprapuse
    parts.push(trunk(3, 0.25, 0.15, 5));
    const C = new THREE.Vector3(0, 6, 0);
    for (const [r, h, y] of [[2.6, 5.2, 4.2], [2.0, 4.4, 6.6], [1.3, 3.6, 9.0]]) {
      const g = new THREE.ConeGeometry(r, h, 7, 1, true);
      g.translate(0, y, 0);
      parts.push(part(g, true, 0xffffff, C, 0.45));
    }
  } else { // plop: coroana inalta si ingusta
    parts.push(trunk(3.5, 0.3, 0.18, 5));
    const C = new THREE.Vector3(0, 9, 0);
    for (const [r, x, y, z, sy] of [[1.9, 0, 6.2, 0, 1.7], [1.6, 0.2, 10.2, -0.1, 1.9], [1.1, -0.1, 13.6, 0.1, 1.9]]) {
      parts.push(part(lump(r, x, y, z, sy), true, 0xffffff, C, 0.6));
    }
  }
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

const WIND = { uTime: { value: 0 } };

function treeMaterial(map, rough) {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: rough, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCrown;\nuniform float uTime;\nvarying float vCrown;')
      .replace('#include <color_vertex>', `vColor = vec3(1.0);
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= mix(vec3(1.0), instanceColor.rgb, aCrown);
#endif
  vCrown = aCrown;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  {
    float ph = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
    float sw = aCrown * max(position.y - 2.0, 0.0) * 0.011;
    float gust = 0.75 + 0.25 * sin(uTime * 0.37 + ph * 0.2);
    transformed.x += sin(uTime * 1.6 + ph) * sw * gust + sin(uTime * 4.3 + position.y * 1.7 + ph) * aCrown * 0.03;
    transformed.z += cos(uTime * 1.25 + ph * 1.3) * sw * 0.6 * gust;
  }
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCrown;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb * 1.25, vCrown);
#endif`);
  };
  m.customProgramCacheKey = () => 'gv-tree-1';
  return m;
}

// culoare pe instanta (sRGB, nuantata usor)
const TINT = {
  broad: [[0.24, 0.30], [0.38, 0.52], [0.24, 0.36]],   // [h], [s], [l]
  round: [[0.20, 0.28], [0.36, 0.50], [0.28, 0.40]],
  conifer: [[0.33, 0.42], [0.25, 0.38], [0.17, 0.25]],
  poplar: [[0.21, 0.27], [0.36, 0.48], [0.26, 0.36]],
};
const SCALE = { broad: [0.75, 1.35], round: [0.7, 1.2], conifer: [0.8, 1.45], poplar: [0.85, 1.25] };

function pickSpecies(k, r) {
  const u = r();
  switch (k) {
    case 'forest': case 'wood': return u < 0.62 ? 'broad' : u < 0.84 ? 'conifer' : u < 0.94 ? 'round' : 'poplar';
    case 'park': return u < 0.55 ? 'broad' : u < 0.75 ? 'round' : u < 0.9 ? 'conifer' : 'poplar';
    case 'cemetery': return u < 0.5 ? 'conifer' : u < 0.8 ? 'broad' : 'poplar';
    case 'orchard': return 'round';
    case 'scrub': return u < 0.8 ? 'round' : 'broad';
    case 'street-major': return u < 0.65 ? 'poplar' : 'broad';
    case 'street': return u < 0.75 ? 'broad' : 'round';
    default: return 'broad';
  }
}

// grila de amprente (copacii de strada nu intra in cladiri)
function buildingGrid(footprints, cell = 60) {
  const grid = new Map();
  for (const f of footprints) {
    const b = f.bb || (f.bb = bboxOf(f.p));
    for (let i = Math.floor(b.minX / cell); i <= Math.floor(b.maxX / cell); i++) {
      for (let j = Math.floor(b.minZ / cell); j <= Math.floor(b.maxZ / cell); j++) {
        const k = i + ',' + j; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(f);
      }
    }
  }
  return (x, z, m = 2) => {
    const a = grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell));
    if (!a) return false;
    for (const f of a) {
      const b = f.bb;
      if (x < b.minX - m || x > b.maxX + m || z < b.minZ - m || z > b.maxZ + m) continue;
      if (pointInPoly(x, z, f.p) || pointInPoly(x + m, z, f.p) || pointInPoly(x - m, z, f.p) || pointInPoly(x, z + m, f.p) || pointInPoly(x, z - m, f.p)) return true;
    }
    return false;
  };
}

/**
 * @param points [[x, z, areaKind], ...] – puncte in paduri / parcuri (deja filtrate de okTree)
 * @param roadRuns tronsoanele de drum (pts, k, width, bridge) – pentru copacii de aliniament
 */
export function buildTrees(ctx, { group, points, terrainH, okTree, roadRuns = [], footprints = [], inExcluded = () => false, center = [0, 0], streetR = 2600 }) {
  const r = rng(4242);
  // ---- copaci de aliniament pe strazile rezidentiale (deterministi, rari) ----
  const street = [];
  const inBuilding = buildingGrid(footprints);
  const STREET_K = { residential: 'street', living_street: 'street', tertiary: 'street', secondary: 'street-major', primary: 'street-major', unclassified: 'street-major' };
  for (const w of roadRuns) {
    if (street.length >= MAX_STREET) break;
    const kind = STREET_K[w.k];
    if (!kind || w.bridge) continue;
    const step = kind === 'street' ? 17 : 13;
    const off = (w.width || 6) / 2 + (kind === 'street' ? 3.4 : 4.5);
    let acc = step * 0.5 * r();
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [x0, z0] = w.pts[i], [x1, z1] = w.pts[i + 1];
      const d = Math.hypot(x1 - x0, z1 - z0);
      if (d < 1e-3) continue;
      const nx = -(z1 - z0) / d, nz = (x1 - x0) / d;
      for (; acc < d; acc += step) {
        const t = acc / d, bx = x0 + (x1 - x0) * t, bz = z0 + (z1 - z0) * t;
        if (Math.hypot(bx - center[0], bz - center[1]) > streetR) continue;
        for (const sd of [-1, 1]) {
          if (r() > (kind === 'street' ? 0.42 : 0.5)) continue;
          const x = bx + nx * off * sd, z = bz + nz * off * sd;
          if (inExcluded(x, z) || !okTree(x, z) || inBuilding(x, z, 2.2)) continue;
          street.push([x, z, kind]);
        }
      }
      acc -= d;
    }
  }
  // ---- distribuim pe specii ----
  const all = [];
  const nArea = Math.min(points.length, MAX_TREES - street.length);
  for (let i = 0; i < nArea; i++) all.push(points[Math.floor((i / nArea) * points.length)]);
  all.push(...street);
  const bySp = Object.fromEntries(SPECIES.map((s) => [s, []]));
  for (const [x, z, k] of all) bySp[pickSpecies(k, r)].push([x, z, k]);

  const fol = foliageTexture();
  const mats = { broad: treeMaterial(fol, 0.92), round: treeMaterial(fol, 0.92), conifer: treeMaterial(fol, 0.95), poplar: treeMaterial(fol, 0.9) };
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tc = new THREE.Color();
  const meshes = [];
  let total = 0;
  for (const sp of SPECIES) {
    const list = bySp[sp];
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(speciesGeometry(sp), mats[sp], list.length);
    const [s0, s1] = SCALE[sp], [H, S, Lr] = TINT[sp];
    list.forEach(([x, z, k], i) => {
      let sc = s0 + r() * (s1 - s0);
      if (k === 'street') sc *= 0.85; else if (k === 'orchard' || k === 'scrub') sc *= 0.75;
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      s.set(sc * (0.9 + r() * 0.2), sc * (0.88 + r() * 0.25), sc * (0.9 + r() * 0.2));
      mtx.compose(v.set(x, terrainH(x, z) - 0.15, z), q, s);
      m.setMatrixAt(i, mtx);
      tc.setHSL(H[0] + r() * (H[1] - H[0]), S[0] + r() * (S[1] - S[0]), Lr[0] + r() * (Lr[1] - Lr[0]), THREE.SRGBColorSpace);
      m.setColorAt(i, tc);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'copaci-' + sp;
    group.add(m);
    meshes.push(m);
    total += list.length;
  }
  ctx.addUpdate?.((dt, t) => { WIND.uTime.value = t; });
  const tris = meshes.reduce((a, m) => a + (m.geometry.attributes.position.count / 3) * m.count, 0);
  return { meshes, count: total, street: street.length, triangles: tris };
}
