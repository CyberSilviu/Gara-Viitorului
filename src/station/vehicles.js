import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalizeGeo, transformGeo, instanced, panelGeo } from './builder.js';
import { canvasTex } from './materials.js';

// Vehicule low-poly pentru piata garii: autobuz electric de 12 m si autoturism (cu varianta taxi).
// Fiecare vehicul = cateva geometrii (una pe material) in sistemul propriu (fata spre +z, sol la y = 0),
// desenate cu InstancedMesh => un singur draw call pe material, oricate vehicule.
// Usile autobuzului sunt pe partea DREAPTA (sens de mers spre +z => dreapta = -x).

function std(name, o) { const m = new THREE.MeshStandardMaterial(o); m.name = name; return m; }
const box = (w, h, d, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) => normalizeGeo(transformGeo(new THREE.BoxGeometry(w, h, d), x, y, z, ry, rx, rz));
const wheelGeo = (r, w, seg) => normalizeGeo(new THREE.CylinderGeometry(r, r, w, seg).rotateZ(Math.PI / 2));
const merge = (list) => (list.length === 1 ? list[0] : mergeGeometries(list, false));

// profil lateral extrudat pe latime, cu muchii rotunjite (bevel) si decupaje pentru roti
function extrudeSide(shape, width, bevel, curveSegments = 6) {
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments });
  g.rotateY(-Math.PI / 2);          // x-ul profilului -> z (lungime), extrudarea -> -x
  g.translate(depth / 2, 0, 0);     // centrat pe latime
  return normalizeGeo(g);
}

// decupaj semicircular pentru roata (arc deasupra liniei de jos y0)
function arch(s, zc, yc, r, y0) {
  const a = Math.asin(THREE.MathUtils.clamp((yc - y0) / r, -1, 1));
  s.lineTo(zc - Math.cos(a) * r, y0);
  s.absarc(zc, yc, r, Math.PI + a, -a, true);
}

// ---------------------------------------------------------------------------------------------
// Autobuz electric 12 m (latime 2,55 m, inaltime 3,2 m), cu roti R 0,5 m pe doua axe
export const BUS = { L: 12, W: 2.55, H: 3.2, axles: [3.3, -2.6], wheelR: 0.5 };

function busGeometries() {
  const { L, W, axles, wheelR } = BUS;
  const bev = 0.08, y0 = 0.36, top = 3.12, half = L / 2 - bev;
  const s = new THREE.Shape();
  s.moveTo(-half, y0);
  for (const zc of [...axles].sort((a, b) => a - b)) arch(s, zc, wheelR, wheelR + 0.12 + bev, y0);
  s.lineTo(half, y0);
  s.lineTo(half, 1.05);
  s.lineTo(half - 0.06, 2.85);
  s.quadraticCurveTo(half - 0.1, top, half - 0.45, top);
  s.lineTo(-half + 0.35, top);
  s.quadraticCurveTo(-half, top, -half, top - 0.3);
  s.closePath();
  const body = extrudeSide(s, W, bev, 8);
  const xs = W / 2 + 0.006;          // fata laterala (capacul extrudarii)
  // fata e usor inclinata (de la y 1,05 la 2,85 se retrage 6 cm)
  const zFront = (y) => L / 2 - 0.06 * THREE.MathUtils.clamp((y - 1.05) / 1.8, 0, 1) + 0.012;
  const zr = -L / 2 - 0.012;
  const parts = { body: [body], accent: [], glass: [], dark: [], tire: [], hub: [], roof: [], head: [], tail: [] };
  const door = [[4.95, 1.15], [0.35, 1.3]];    // [z centru, latime] — usa fata (in consola din fata) si usa din mijloc
  const archZ = axles.map((z) => [z - 0.74, z + 0.74]);
  // segmente [z0, z1] din intervalul (a, b) care evita taieturile date
  const runs = (a, b, cuts) => {
    const out = []; let z = a;
    for (const [c0, c1] of [...cuts].sort((p, q) => p[0] - q[0])) { if (c0 > z) out.push([z, Math.min(c0, b)]); z = Math.max(z, c1); }
    if (z < b) out.push([z, b]);
    return out.filter(([p, q]) => q - p > 0.05);
  };
  for (const sx of [-1, 1]) {
    const doorCuts = sx < 0 ? door.map(([z, w]) => [z - w / 2 - 0.1, z + w / 2 + 0.1]) : [];
    // banda de geamuri fumurii (lipseste in dreptul usilor de pe dreapta)
    for (const [a, b] of runs(-L / 2 + 0.5, L / 2 - 0.45, doorCuts)) parts.glass.push(box(0.02, 1.48, b - a, sx * xs, 2.08, (a + b) / 2));
    // montanti negri intre geamuri
    for (let z = -L / 2 + 1.6; z < L / 2 - 1; z += 1.55) {
      if (sx < 0 && door.some(([dz, w]) => Math.abs(z - dz) < w / 2 + 0.2)) continue;
      parts.dark.push(box(0.025, 1.48, 0.07, sx * (xs + 0.004), 2.08, z));
    }
    // livrea: fusta verde jos (intrerupta la roti si la usi) + linie verde sub acoperis
    for (const [a, b] of runs(-L / 2 + 0.25, L / 2 - 0.25, [...archZ, ...doorCuts])) parts.accent.push(box(0.02, 0.42, b - a, sx * (xs - 0.002), 0.82, (a + b) / 2));
    parts.accent.push(box(0.02, 0.1, L - 0.6, sx * (xs - 0.002), 2.92, -0.05));
  }
  // usi duble cu geam (dreapta, -x) + rama
  for (const [z, w] of door) {
    parts.glass.push(box(0.03, 2.35, w, -xs - 0.006, 1.58, z));
    parts.dark.push(box(0.035, 2.45, 0.06, -xs - 0.008, 1.6, z));           // linia dintre foi
    parts.dark.push(box(0.035, 0.06, w + 0.12, -xs - 0.008, 2.8, z));        // rama sus
    for (const e of [-1, 1]) parts.dark.push(box(0.035, 2.45, 0.05, -xs - 0.008, 1.6, z + e * (w / 2 + 0.03)));
  }
  // parbriz mare (usor inclinat) + rama afisajului de destinatie + luneta
  parts.glass.push(box(2.3, 1.45, 0.02, 0, 1.775, zFront(1.775), 0, -0.033));
  parts.dark.push(box(2.02, 0.38, 0.02, 0, 2.66, zFront(2.66) - 0.004, 0, -0.033));
  parts.glass.push(box(2.0, 0.75, 0.02, 0, 2.38, zr));
  parts.accent.push(box(2.42, 0.36, 0.02, 0, 0.78, L / 2 + 0.008));        // botul verde
  // bare de protectie, oglinzi, sasiu (ascunde vederea prin pasajele rotilor)
  parts.dark.push(box(2.46, 0.24, 0.14, 0, 0.44, L / 2 + 0.05), box(2.46, 0.24, 0.14, 0, 0.44, -L / 2 - 0.05));
  parts.dark.push(box(2.1, 0.62, L - 1.2, 0, 0.62, 0));
  for (const z of axles) parts.dark.push(box(1.9, 0.95, 1.44, 0, 0.72, z)); // captuseala pasajelor rotilor (nu se vede prin autobuz)
  parts.dark.push(box(1.0, 0.36, 0.02, 0, 1.75, zr - 0.004));                // rama afisajului din spate
  for (const sx of [-1, 1]) {
    parts.dark.push(box(0.05, 0.05, 0.42, sx * 1.36, 2.62, L / 2 - 0.1, sx * 0.5));
    parts.dark.push(box(0.07, 0.38, 0.2, sx * 1.52, 2.42, L / 2 + 0.08));
  }
  // faruri LED + stopuri
  for (const sx of [-1, 1]) {
    parts.head.push(box(0.42, 0.12, 0.03, sx * 0.86, 0.72, L / 2 + 0.02));
    parts.tail.push(box(0.14, 0.62, 0.03, sx * 1.08, 1.12, -L / 2 - 0.02));
  }
  // acoperis: doua pachete de baterii, climatizare, pantograf de incarcare (fata)
  for (const sx of [-1, 1]) parts.roof.push(box(0.92, 0.3, 3.4, sx * 0.58, top + bev + 0.15, -1.6));
  parts.roof.push(box(1.7, 0.28, 1.5, 0, top + bev + 0.14, 2.6));
  parts.roof.push(box(1.9, 0.12, 2.2, 0, top + bev + 0.32, -1.6));        // carenaj comun peste baterii
  parts.dark.push(box(0.9, 0.08, 0.5, 0, top + bev + 0.33, 4.4), box(0.06, 0.06, 0.9, 0, top + bev + 0.42, 4.2, 0, 0.35));
  // roti: anvelope + capace (pe jumatate in pasajele rotilor)
  for (const z of axles) for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.19);
    parts.tire.push(transformGeo(wheelGeo(wheelR, 0.3, 18), x, wheelR, z));
    parts.hub.push(transformGeo(wheelGeo(0.3, 0.04, 14), sx * (W / 2 - 0.025), wheelR, z));
    parts.dark.push(transformGeo(wheelGeo(0.1, 0.06, 8), sx * (W / 2 - 0.005), wheelR, z));
  }
  const out = {};
  for (const [k, list] of Object.entries(parts)) if (list.length) out[k] = merge(list);
  return out;
}

// afisaje de destinatie: atlas cu un rand pe linie de autobuz [numar, destinatie]
export function createBusDisplays(lines) {
  const rows = lines.length, RH = 64;
  const tex = canvasTex(512, RH * rows, (g, w, h) => {
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, w, h);
    lines.forEach(([no, dest], i) => {
      const y = i * RH;
      g.fillStyle = '#ffb21f';
      g.fillRect(6, y + 8, 92, RH - 16);
      g.fillStyle = '#0a0a0a';
      g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(no, 52, y + RH / 2 + 1);
      g.fillStyle = '#ffb21f'; g.textAlign = 'left';
      g.font = 'bold 34px sans-serif';
      g.fillText(dest, 112, y + RH / 2 + 1, w - 120);
    });
  });
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  mat.name = 'afisaj-autobuz';
  mat.userData.noShadow = true;
  // uv-urile randului i (v creste in sus => randul 0 e sus)
  const uvRow = (i) => [0, 1 - (i + 1) / rows, 1, 1 - i / rows];
  return { mat, uvRow };
}

// Autobuze electrice: list = [{ x, y, z, ry, line }] (sistemul grupului parinte), displays = createBusDisplays(...)
// B = Batch pentru panourile afisajelor (au uv diferite pe fiecare autobuz).
export function addBuses(group, B, M, list, displays) {
  const mats = {
    body: std('autobuz-caroserie', { color: 0xf3f5f6, roughness: 0.32, metalness: 0.2 }),
    accent: std('autobuz-livrea', { color: 0x16a34a, roughness: 0.4, metalness: 0.2 }),
    glass: std('autobuz-geam', { color: 0x1d2a35, roughness: 0.12, metalness: 0.55 }),
    dark: M.dark, tire: M.rubber, hub: M.steel, roof: M.steelWhite,
    head: M.lamp,
    tail: std('autobuz-stop', { color: 0xc81e1e, emissive: 0xff2020, emissiveIntensity: 0.5, roughness: 0.4 }),
  };
  const geos = busGeometries();
  const meshes = [];
  for (const [k, g] of Object.entries(geos)) {
    const m = instanced(g, mats[k], list, { cast: !['head', 'tail'].includes(k) });
    m.name = 'autobuz:' + k;
    group.add(m);
    meshes.push(m);
  }
  // afisaje: fata (sus), lateral dreapta (langa usa din fata), spate (numarul liniei)
  const { L, W } = BUS;
  for (const b of list) {
    const c = Math.cos(b.ry || 0), s = Math.sin(b.ry || 0);
    const at = (lx, ly, lz) => [b.x + lx * c + lz * s, (b.y || 0) + ly, b.z - lx * s + lz * c];
    const ry = b.ry || 0;
    B.add(displays.mat, panelGeo(1.9, 0.3, ...displays.uvRow(b.line)), ...at(0, 2.66, L / 2 - 0.02), ry);
    B.add(displays.mat, panelGeo(1.1, 0.2, ...displays.uvRow(b.line)), ...at(-W / 2 - 0.03, 2.62, 3.55), ry - Math.PI / 2);
    B.add(displays.mat, panelGeo(0.9, 0.3, ...displays.uvRow(b.line)), ...at(0, 1.75, -L / 2 - 0.035), ry + Math.PI);
  }
  return meshes;
}

// ---------------------------------------------------------------------------------------------
// Autoturism compact (4,5 × 1,8 × 1,5 m) — caroserie colorata pe instanta, geamuri, roti, lumini.
export const CAR = { L: 4.5, W: 1.8, axles: [1.35, -1.35], wheelR: 0.33 };

function carGeometries() {
  const { W, axles, wheelR } = CAR;
  const bev = 0.07, y0 = 0.22;
  const s = new THREE.Shape();
  s.moveTo(-2.15, y0);
  for (const zc of [...axles].sort((a, b) => a - b)) arch(s, zc, wheelR, wheelR + 0.04 + bev, y0);
  s.lineTo(2.15, y0);
  s.lineTo(2.2, 0.5);
  s.lineTo(2.15, 0.78);
  s.lineTo(0.9, 0.95);
  s.lineTo(0.1, 1.42);
  s.lineTo(-1.3, 1.45);
  s.lineTo(-2.1, 1.0);
  s.lineTo(-2.2, 0.8);
  s.lineTo(-2.2, 0.4);
  s.closePath();
  const body = extrudeSide(s, W, bev, 6);
  // „sera” de geamuri: acelasi profil, decalat in afara pe parbriz/luneta, sub linia acoperisului
  const gs = new THREE.Shape();
  gs.moveTo(0.948, 1.032); gs.lineTo(0.322, 1.4); gs.lineTo(-1.583, 1.4); gs.lineTo(-2.08, 1.12); gs.lineTo(-1.95, 0.98); gs.lineTo(0.85, 0.98);
  gs.closePath();
  const gw = W + 0.02;
  const glass = normalizeGeo(new THREE.ExtrudeGeometry(gs, { depth: gw, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(gw / 2, 0, 0));
  const parts = { body: [body], glass: [glass], tire: [], hub: [], head: [], tail: [], dark: [] };
  for (const z of axles) for (const sx of [-1, 1]) {
    parts.tire.push(transformGeo(wheelGeo(wheelR, 0.22, 14), sx * (W / 2 - 0.12), wheelR, z));
    parts.hub.push(transformGeo(wheelGeo(0.2, 0.03, 12), sx * (W / 2 - 0.005), wheelR, z));
  }
  for (const sx of [-1, 1]) {
    parts.head.push(box(0.36, 0.1, 0.05, sx * 0.6, 0.7, 2.24));
    parts.tail.push(box(0.34, 0.12, 0.05, sx * 0.6, 0.86, -2.26));
    parts.dark.push(box(0.05, 0.1, 0.16, sx * 0.94, 1.0, 0.72));            // oglinzi
  }
  for (const z of axles) parts.dark.push(box(1.3, 0.5, 0.86, 0, 0.5, z));     // captuseala pasajelor rotilor
  parts.dark.push(box(1.7, 0.16, 0.08, 0, 0.36, 2.26), box(1.7, 0.16, 0.08, 0, 0.36, -2.27), box(0.9, 0.16, 0.04, 0, 0.55, 2.27));
  const out = {};
  for (const [k, list] of Object.entries(parts)) if (list.length) out[k] = merge(list);
  return out;
}

let _carGeos = null, _carMats = null;
// list = [{ x, y, z, ry, color, taxi? }]
export function addCars(group, M, list, name = 'autoturisme') {
  _carGeos ||= carGeometries();
  _carMats ||= {
    body: std('auto-caroserie', { color: 0xffffff, roughness: 0.3, metalness: 0.35 }),
    glass: std('auto-geam', { color: 0x1a2530, roughness: 0.1, metalness: 0.55 }),
    tire: M.rubber, hub: M.steel, dark: M.dark, head: M.lamp,
    tail: std('auto-stop', { color: 0xb91c1c, emissive: 0xff2020, emissiveIntensity: 0.35, roughness: 0.4 }),
    taxi: std('taxi-semn', { color: 0xfff3c4, emissive: 0xffd34d, emissiveIntensity: 0.6, roughness: 0.5 }),
  };
  const meshes = [];
  for (const [k, g] of Object.entries(_carGeos)) {
    const m = instanced(g, _carMats[k], list, { cast: !['head', 'tail'].includes(k), colors: k === 'body' ? list.map((c) => c.color ?? 0x9aa4ae) : null });
    m.name = name + ':' + k;
    group.add(m);
    meshes.push(m);
  }
  const taxis = list.filter((c) => c.taxi);
  if (taxis.length) {
    const m = instanced(box(0.6, 0.16, 0.24, 0, 1.6, -0.4), _carMats.taxi, taxis, { cast: false });
    m.name = name + ':taxi';
    group.add(m);
    meshes.push(m);
  }
  return meshes;
}
