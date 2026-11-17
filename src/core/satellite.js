import * as THREE from 'three';
import { unproject, project } from './geo.js';

// Imagini satelitare reale pe teren.
//  1) Baza offline: Sentinel-2 cloudless 2016 (EOX, CC BY 4.0), dale web-mercator descarcate de
//     scripts/fetch-satellite.mjs in public/data/sat/. Lipite intr-o singura textura (canvas) si puse direct
//     pe mesh-urile terenului (atributul uv2, calculat per varf: x,z -> lat/lon -> mercator).
//  2) Detaliu: Esri World Imagery, incarcat DOAR la rulare (nu se salveaza in proiect), pe un arbore cuaternar dupa
//     distanta fata de camera (z18 aproape ... z15 departe) peste toata zona fina. Fiecare dala = un "petic" de
//     teren obtinut prin decuparea EXACTA a triunghiurilor terenului (aceleasi plane => fara cusaturi).
//     Se incarca dupa distanta fata de camera, maxim MAX_TEX texturi in memorie; la eroare de retea ramane baza.
export const ATTRIB_S2 = 'Sentinel-2 cloudless – s2maps.eu, EOX IT Services GmbH (date Copernicus Sentinel 2016 modificate)';
export const ATTRIB_ESRI = 'Imagini: Esri, Maxar, Earthstar Geographics, GIS User Community';
const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const MAX_TEX = 230;      // texturi Esri in memorie (vizibile + cache), ~256 KB fiecare
const MAX_LEAVES = 200;   // frunze dorite simultan (restul memoriei = cache / parinti de rezerva)
const MAX_PARALLEL = 7;
const LS_KEY = 'gv-satelit';
const Z_MIN = 15, Z_MAX = 18;
// distanta (m, 3D: orizontal + inaltimea camerei peste teren) sub care se cere nivelul z
const LOD_DIST = { 16: 4000, 17: 1200, 18: 300 };
const DROP_DIST = 7000;   // dale din cache mai departe de atat se elibereaza
const FILL_K = 0.075;     // umplutura (neumbrita) proportionala cu soarele – imaginea are deja umbrele "pictate"

// ---------- corectia de culoare a imaginilor (contrast + saturatie; ACES le spala) ----------
export const GRADE = {
  uFill: { value: new THREE.Color(0, 0, 0) },
  uSat: { value: 1.28 },
  uCon: { value: 1.12 },
  uGain: { value: 1.12 },
};
export function gradeMaterial(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, GRADE);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFill;\nuniform float uSat, uCon, uGain;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec3 c = max(diffuseColor.rgb, vec3(0.0));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = 0.12 * pow(max(c, vec3(0.0)) / 0.12, vec3(uCon));
    diffuseColor.rgb = min(c * uGain, vec3(0.9));
  }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uFill;');
  };
  mat.customProgramCacheKey = () => 'gv-sat-grade-1';
  return mat;
}
// aceeasi corectie, pe CPU (culori liniare) – pentru orizont
export function gradeColor(c, out = new THREE.Color()) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, s = GRADE.uSat.value, k = GRADE.uCon.value, gn = GRADE.uGain.value;
  const f = (v) => Math.min(0.9, 0.12 * Math.pow(Math.max(0, l + (v - l) * s) / 0.12, k) * gn);
  return out.setRGB(f(c.r), f(c.g), f(c.b));
}

// ---------- web-mercator (coordonate de dala fractionare) ----------
export const lon2tx = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2ty = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };
const tx2lon = (tx, z) => (tx / 2 ** z) * 360 - 180;
const ty2lat = (ty, z) => { const n = Math.PI - (2 * Math.PI * ty) / 2 ** z; return (180 / Math.PI) * Math.atan(Math.sinh(n)); };
// x,z locale -> coordonate de dala fractionare la nivelul z
export function localToTile(x, zz, z) {
  const { lat, lon } = unproject(x, zz);
  return [lon2tx(lon, z), lat2ty(lat, z)];
}
// dreptunghiul local (axe aliniate: lon const => x const, lat const => z const) al unei dale
export function tileRect(z, X, Y) {
  const a = project(ty2lat(Y, z), tx2lon(X, z)), b = project(ty2lat(Y + 1, z), tx2lon(X + 1, z));
  return { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z };
}

// ---------- decuparea triunghiurilor terenului fin intr-un dreptunghi ----------
// Triunghiurile sunt EXACT cele ale mesh-ului (diagonala (i,j+1)-(i+1,j)), deci fiecare petic e coplanar cu terenul.
export function clipTerrain(F, heightAt, r, lift = 0) {
  const pos = [];
  const i0 = Math.max(0, Math.floor((r.minX - F.minX) / F.sx)), i1 = Math.min(Math.round((F.maxX - F.minX) / F.sx), Math.ceil((r.maxX - F.minX) / F.sx));
  const j0 = Math.max(0, Math.floor((r.minZ - F.minZ) / F.sz)), j1 = Math.min(Math.round((F.maxZ - F.minZ) / F.sz), Math.ceil((r.maxZ - F.minZ) / F.sz));
  const clip = (poly, axis, val, keepGreater) => {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      const pi = keepGreater ? p[axis] >= val : p[axis] <= val, qi = keepGreater ? q[axis] >= val : q[axis] <= val;
      if (pi) out.push(p);
      if (pi !== qi) { const t = (val - p[axis]) / (q[axis] - p[axis]); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const x0 = F.minX + i * F.sx, x1 = x0 + F.sx, z0 = F.minZ + j * F.sz, z1 = z0 + F.sz;
    for (const tri of [[[x0, z0], [x0, z1], [x1, z0]], [[x0, z1], [x1, z1], [x1, z0]]]) {
      // planul triunghiului (din cotele exacte ale varfurilor)
      const hs = tri.map(([x, z]) => heightAt(x, z));
      let poly = tri;
      poly = clip(poly, 0, r.minX, true); if (poly.length < 3) continue;
      poly = clip(poly, 0, r.maxX, false); if (poly.length < 3) continue;
      poly = clip(poly, 1, r.minZ, true); if (poly.length < 3) continue;
      poly = clip(poly, 1, r.maxZ, false); if (poly.length < 3) continue;
      // cota pe planul triunghiului (interpolare baricentrica, nu heightAt – evita ambiguitatea pe muchii)
      const [A, B, C] = tri;
      const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      const hAt = (x, z) => {
        const l1 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (z - C[1])) / det;
        const l2 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (z - C[1])) / det;
        return l1 * hs[0] + l2 * hs[1] + (1 - l1 - l2) * hs[2];
      };
      const v = poly.map(([x, z]) => [x, hAt(x, z) + lift, z]);
      // triunghiurile originale sunt in ordine (a,b,d) => normala in sus; pastram orientarea prin evantai
      for (let k = 1; k < v.length - 1; k++) pos.push(...v[0], ...v[k], ...v[k + 1]);
    }
  }
  return new Float32Array(pos);
}

export async function createSatellite(ctx) {
  const T = ctx.terrain;
  if (!T) return null;
  const renderer = ctx.renderer;
  const aniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const maxTexSize = renderer?.capabilities?.maxTextureSize || 4096;
  const group = new THREE.Group();
  group.name = 'satelit-esri';
  ctx.scene.add(group);

  // ================= 1) baza Sentinel-2 =================
  let baseMats = null;
  try {
    const man = await (await fetch('data/sat/manifest.json')).json();
    // cel mai fin nivel care incape intr-o textura
    const L = [...man.levels].sort((a, b) => b.z - a.z).find((l) => Math.max(l.x1 - l.x0 + 1, l.y1 - l.y0 + 1) * 256 <= maxTexSize) || man.levels[0];
    const nx = L.x1 - L.x0 + 1, ny = L.y1 - L.y0 + 1;
    const cv = document.createElement('canvas');
    cv.width = nx * 256; cv.height = ny * 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#5d6b45'; g.fillRect(0, 0, cv.width, cv.height);
    const jobs = [];
    for (let X = L.x0; X <= L.x1; X++) for (let Y = L.y0; Y <= L.y1; Y++) {
      jobs.push(new Promise((res) => {
        const im = new Image();
        im.onload = () => { g.drawImage(im, (X - L.x0) * 256, (Y - L.y0) * 256); res(); };
        im.onerror = () => res();
        im.src = `data/sat/${L.z}/${X}/${Y}.jpg`;
      }));
    }
    await Promise.all(jobs);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    tex.channel = 2;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    // uv2 pe fiecare mesh al terenului (per varf: x,z -> mercator)
    baseMats = new Map();
    for (const m of T.meshes) {
      const p = m.geometry.attributes.position, n = p.count;
      const uv2 = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) {
        const [tx, ty] = localToTile(p.getX(k), p.getZ(k), L.z);
        uv2[k * 2] = (tx - L.x0) / nx;
        uv2[k * 2 + 1] = 1 - (ty - L.y0) / ny;
      }
      m.geometry.setAttribute('uv2', new THREE.BufferAttribute(uv2, 2));
      const mm = gradeMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
      mm.name = m.name + '-satelit';
      baseMats.set(m, mm);
    }
    // peisajul din afara DEM (orizont): culorile Sentinel-2 puternic estompate, esantionate la marginea imaginii
    try {
      const sw = 96, sh = Math.max(8, Math.round((96 * ny) / nx));
      const sc = document.createElement('canvas');
      sc.width = sw; sc.height = sh;
      const sg = sc.getContext('2d', { willReadFrequently: true });
      sg.filter = 'blur(3px)';
      sg.drawImage(cv, -6, -6, sw + 12, sh + 12); // putin marit: estomparea nu "trage" negru de la margini
      const d = sg.getImageData(0, 0, sw, sh).data;
      const tmp = new THREE.Color();
      baseMats.horizonAt = (x, zz, out = new THREE.Color()) => {
        const [tx, ty] = localToTile(x, zz, L.z);
        const u = THREE.MathUtils.clamp(((tx - L.x0) / nx) * sw, 2, sw - 3), v = THREE.MathUtils.clamp(((ty - L.y0) / ny) * sh, 2, sh - 3);
        const k = (Math.floor(v) * sw + Math.floor(u)) * 4;
        tmp.setRGB(d[k] / 255, d[k + 1] / 255, d[k + 2] / 255, THREE.SRGBColorSpace);
        return gradeColor(tmp, out);
      };
    } catch (e) { /* ignorat: orizontul ramane stilizat */ }
  } catch (e) {
    console.warn('Satelit: baza Sentinel-2 lipseste (rulează node scripts/fetch-satellite.mjs)', e);
  }

  // ================= 2) detaliu Esri (la rulare) – arbore cuaternar dupa distanta fata de camera =================
  // z18 < ~300 m, z17 < ~1,2 km, z16 < ~4 km, z15 in rest (doar in zona fina a terenului); in afara => Sentinel-2.
  // Copiii inlocuiesc parintele abia dupa ce s-au incarcat (parintele ramane dedesubt ca rezerva).
  const F = T.fineExtent;
  const FE = F ? { minX: F.minX, maxX: F.maxX, minZ: F.minZ, maxZ: F.maxZ, sx: F.sx, sz: F.sz } : null;
  const tiles = new Map(); // key -> {key,z,X,Y,rect,state,mesh,tex,d}
  const inF = (r) => FE && !(r.maxX <= FE.minX || r.minX >= FE.maxX || r.maxZ <= FE.minZ || r.minZ >= FE.maxZ);
  function getTile(z, X, Y) {
    const key = z + '/' + X + '/' + Y;
    let t = tiles.get(key);
    if (!t) {
      const rect = tileRect(z, X, Y);
      if (!inF(rect)) return null;
      t = { key, z, X, Y, rect, state: 0, d: Infinity };
      tiles.set(key, t);
    }
    return t;
  }
  const roots = [];
  if (FE) {
    const [a0, b0] = localToTile(FE.minX, FE.minZ, Z_MIN), [a1, b1] = localToTile(FE.maxX, FE.maxZ, Z_MIN);
    for (let X = Math.floor(a0); X <= Math.floor(a1); X++) for (let Y = Math.floor(b0); Y <= Math.floor(b1); Y++) {
      const t = getTile(Z_MIN, X, Y); if (t) roots.push(t);
    }
  }

  const loader = new THREE.ImageLoader();
  loader.setCrossOrigin('anonymous');
  let loading = 0, loaded = 0, failStreak = 0, pauseUntil = 0, enabled = true;
  const noRay = () => {};

  function buildMesh(t, img) {
    const pos = clipTerrain(FE, T.heightAt, t.rect, 0);
    if (!pos.length) return null;
    const n = pos.length / 3, uv = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const [tx, ty] = localToTile(pos[k * 3], pos[k * 3 + 2], t.z);
      uv[k * 2] = tx - t.X; uv[k * 2 + 1] = 1 - (ty - t.Y);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // normale netede, calculate la fel ca pe teren (diferente centrale ale suprafetei finale)
    const nor = new Float32Array(n * 3), e = FE.sx;
    for (let k = 0; k < n; k++) {
      const x = pos[k * 3], z = pos[k * 3 + 2];
      const dx = T.heightAt(x + e, z) - T.heightAt(x - e, z), dz = T.heightAt(x, z + e) - T.heightAt(x, z - e);
      const l = Math.hypot(dx, 2 * e, dz);
      nor[k * 3] = -dx / l; nor[k * 3 + 1] = (2 * e) / l; nor[k * 3 + 2] = -dz / l;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    // peticele sunt EXACT coplanare cu terenul (aceleasi triunghiuri); ordinea se face doar din polygonOffset:
    // nivel mai fin => "mai aproape" (un pas intreg de adancime / nivel). Zonele / drumurile orasului au ridicare
    // reala (GROUND_LIFT >= 4 cm) + factor -1, deci raman deasupra.
    const lvl = t.z - Z_MIN + 1; // 1..4
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -0.2 * lvl, polygonOffsetUnits: -lvl,
    });
    gradeMaterial(mat);
    const m = new THREE.Mesh(geo, mat);
    m.name = 'satelit-' + t.key;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.renderOrder = -10 + lvl;
    m.raycast = noRay; // nu interfera cu selectia / plimbarea
    m.visible = false;
    t.tex = tex;
    return m;
  }

  function request(t) {
    t.state = 1; loading++;
    const my = t.req = (t.req || 0) + 1;
    const url = ESRI_URL.replace('{z}', t.z).replace('{y}', t.Y).replace('{x}', t.X);
    loader.load(url, (img) => {
      loading--; failStreak = 0;
      if (t.state !== 1 || t.req !== my || !enabled) { if (t.state === 1 && t.req === my) t.state = 0; return; } // anulat
      const m = buildMesh(t, img);
      if (!m) { t.state = 3; t.retryAt = Infinity; return; }
      t.mesh = m; t.state = 2; loaded++;
      group.add(m);
      acc = 1; // reevaluam vizibilitatea imediat
    }, undefined, () => {
      loading--;
      if (t.req !== my) return;
      t.state = 3; t.fails = (t.fails || 0) + 1;
      t.retryAt = performance.now() + Math.min(300000, 15000 * 2 ** t.fails); // esuat: ramane baza / parintele
      if (++failStreak >= 6) pauseUntil = performance.now() + 30000; // fara retea: pauza
    });
  }
  function unload(t) {
    if (t.mesh) {
      group.remove(t.mesh);
      t.mesh.geometry.dispose(); t.mesh.material.dispose(); t.tex?.dispose();
      t.mesh = null; t.tex = null; loaded--;
    }
    if (t.state === 2) t.state = 0;
  }

  const camPos = new THREE.Vector3();
  let acc = 1;
  let hy = 0;
  const distTo = (t) => {
    const r = t.rect;
    const dx = Math.max(r.minX - camPos.x, 0, camPos.x - r.maxX), dz = Math.max(r.minZ - camPos.z, 0, camPos.z - r.maxZ);
    return Math.hypot(dx, dz, hy);
  };
  const children = (t) => {
    const out = [];
    for (let k = 0; k < 4; k++) { const c = getTile(t.z + 1, t.X * 2 + (k & 1), t.Y * 2 + (k >> 1)); if (c) out.push(c); }
    return out;
  };
  const parentOf = (t) => (t.z > Z_MIN ? tiles.get((t.z - 1) + '/' + (t.X >> 1) + '/' + (t.Y >> 1)) : null);
  let leaves = [];
  function update(dt) {
    if (!enabled || !FE || (acc += dt) < 0.35) return;
    acc = 0;
    ctx.camera.getWorldPosition(camPos);
    hy = Math.max(0, camPos.y - T.heightAt(camPos.x, camPos.z));
    // --- frunzele dorite: extindem intai nodul cel mai apropiat, pana la plafonul de frunze ---
    const open = roots.map((t) => ((t.d = distTo(t)), t)).sort((a, b) => a.d - b.d);
    leaves = [];
    while (open.length) {
      const t = open.shift();
      const thr = t.z < Z_MAX ? LOD_DIST[t.z + 1] : -1;
      if (t.d < thr && leaves.length + open.length + 4 <= MAX_LEAVES) {
        for (const c of children(t)) {
          c.d = distTo(c);
          let i = 0; while (i < open.length && open[i].d <= c.d) i++;
          open.splice(i, 0, c);
        }
      } else leaves.push(t);
    }
    // --- vizibile: frunza incarcata, altfel cel mai apropiat stramos incarcat (rezerva) ---
    const show = new Set();
    for (const t of leaves) {
      if (t.state === 2) { show.add(t); continue; }
      for (let a = parentOf(t); a; a = parentOf(a)) if (a.state === 2) { show.add(a); break; }
    }
    const isLeaf = new Set(leaves);
    // --- memorie: pastram si dale ascunse (cache) pana la MAX_TEX; aruncam intai cele departate ---
    const cached = [];
    for (const t of tiles.values()) {
      if (t.state === 2) {
        t.mesh.visible = show.has(t);
        if (!show.has(t)) { t.d = distTo(t); cached.push(t); }
      } else if (t.state === 1 && !isLeaf.has(t)) t.state = 0; // cerere in zbor care nu mai e dorita => ignorata la sosire
    }
    // loc pentru frunzele dorite care lipsesc (cel mult o "transa" de cereri)
    let missing = 0;
    for (const t of leaves) if (t.state === 0 || t.state === 1) missing++;
    const room = Math.min(missing, MAX_PARALLEL);
    if (loaded + room > MAX_TEX || cached.some((t) => t.d > DROP_DIST)) {
      cached.sort((a, b) => b.d - a.d);
      for (const t of cached) if (loaded + room > MAX_TEX || t.d > DROP_DIST) unload(t);
    }
    // --- cereri noi (cele mai apropiate intai) ---
    const now = performance.now();
    if (now < pauseUntil) return;
    for (const t of leaves) {
      if (loading >= MAX_PARALLEL || loaded + loading >= MAX_TEX) break;
      if (t.state === 3 && now > t.retryAt) t.state = 0;
      if (t.state === 0) request(t);
    }
  }
  ctx.addUpdate(update);
  // umplutura de lumina pentru imagini (urmeaza soarele => noaptea se intuneca)
  ctx.addUpdate(() => {
    const sun = ctx.env?.sun;
    if (sun) GRADE.uFill.value.copy(sun.color).multiplyScalar(sun.intensity * FILL_K);
  });

  // ================= comutator =================
  function setSatellite(on) {
    enabled = !!on;
    T.setSatelliteMaterials?.(enabled && baseMats ? baseMats : null);
    T.setHorizonTint?.(enabled && baseMats?.horizonAt ? baseMats.horizonAt : null);
    group.visible = enabled;
    ctx.city?.setSatelliteMode?.(enabled);
    try { localStorage.setItem(LS_KEY, enabled ? '1' : '0'); } catch (e) { /* ignorat */ }
    if (!enabled) for (const t of tiles.values()) { unload(t); if (t.state === 1) t.state = 0; } // eliberam memoria
    else acc = 1;
  }
  let initial = true;
  try { const v = localStorage.getItem(LS_KEY); if (v === '0') initial = false; } catch (e) { /* ignorat */ }
  setSatellite(initial);
  ctx.setSatellite = setSatellite;

  return {
    setSatellite, isOn: () => enabled, group, tiles,
    attribution: [ATTRIB_S2, ATTRIB_ESRI],
    stats: () => ({ nodes: tiles.size, leaves: leaves.length, loaded, loading, visible: [...tiles.values()].filter((t) => t.mesh?.visible).length,
      byLevel: leaves.reduce((o, t) => ((o[t.z] = (o[t.z] || 0) + 1), o), {}) }),
  };
}
