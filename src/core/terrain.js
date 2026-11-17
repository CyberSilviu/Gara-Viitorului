import * as THREE from 'three';

// Teren real din SRTM (public/data/dem.json). Altitudinea y este RELATIVA la cota garii (gara = 0).
//
// heightAt(x, z) intoarce EXACT cota suprafetei randate (interpolare baricentrica pe aceleasi triunghiuri ca
// mesh-ul), deci tot ce este drapat cu heightAt(...) + o mica ridicare nu "intra" niciodata sub teren.
//
// Doua grile imbricate:
//  - fina (~15 m) peste oras + coridorul spre nodul turbion (x ∈ [-2600, 1600], z ∈ [-1800, 5800]);
//  - grosiera (~75 m) in rest, cu o gaura exact in dreptul celei fine. Marginea grilei fine urmeaza exact
//    laturile grilei grosiere (fara fisuri), cu o tranzitie lina de ~150 m.
// SRTM-ul este netezit usor (contine si copaci / acoperisuri) si esantionat bicubic (fara "cute" la 265 m).
const FINE = { minX: -2600, maxX: 1600, minZ: -1800, maxZ: 5800 };
const COARSE_CELL = 75;   // m
const FINE_DIV = 5;       // 75 / 5 = 15 m
const BLEND_CELLS = 10;   // tranzitia fin -> grosier (celule fine)
const LANDUSE_BASE = '#6f8f4a'; // culoarea de baza a ierbii (fundalul hartii de utilizare a terenului)

export async function createTerrain(ctx) {
  let dem = null;
  try {
    const r = await fetch('data/dem.json');
    if (r.ok) dem = await r.json();
  } catch (e) { /* fara DEM -> teren plat */ }

  // ---------------- esantionarea DEM (netezire usoara + bicubic) ----------------
  let base = 0;
  let sampleRaw = () => 0;
  if (dem) {
    const { nx, nz, minX, minZ, maxX, maxZ } = dem;
    const H = smoothGrid(Float64Array.from(dem.heights), nx, nz);
    const at = (i, j) => H[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
    const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    sampleRaw = (x, z) => {
      const fx = THREE.MathUtils.clamp(((x - minX) / (maxX - minX)) * (nx - 1), 0, nx - 1.000001);
      const fz = THREE.MathUtils.clamp(((z - minZ) / (maxZ - minZ)) * (nz - 1), 0, nz - 1.000001);
      const i = Math.floor(fx), j = Math.floor(fz);
      const tx = fx - i, tz = fz - j;
      const r0 = cr(at(i - 1, j - 1), at(i, j - 1), at(i + 1, j - 1), at(i + 2, j - 1), tx);
      const r1 = cr(at(i - 1, j), at(i, j), at(i + 1, j), at(i + 2, j), tx);
      const r2 = cr(at(i - 1, j + 1), at(i, j + 1), at(i + 1, j + 1), at(i + 2, j + 1), tx);
      const r3 = cr(at(i - 1, j + 2), at(i, j + 2), at(i + 1, j + 2), at(i + 2, j + 2), tx);
      return cr(r0, r1, r2, r3, tz);
    };
    base = sampleRaw(0, 0);
  }

  // Netezim zona garii (platforma CF este orizontala)
  const flatR0 = 380, flatR1 = 700;
  const flattenZones = [{ x: 0, z: 0, r0: flatR0, r1: flatR1, h: 0 }];

  // functia "ideala" (neteda); mesh-ul o esantioneaza, iar heightAt citeste mesh-ul
  function smoothHeight(x, z) {
    let h = sampleRaw(x, z) - base;
    for (const f of flattenZones) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r1) h = THREE.MathUtils.lerp(f.h, h, THREE.MathUtils.smoothstep(d, f.r0, f.r1));
    }
    return h;
  }

  // ---------------- grilele ----------------
  const ext = dem ? { minX: dem.minX, maxX: dem.maxX, minZ: dem.minZ, maxZ: dem.maxZ } : { minX: -9000, maxX: 9000, minZ: -9000, maxZ: 9000 };
  const cnx = Math.max(1, Math.round((ext.maxX - ext.minX) / COARSE_CELL));
  const cnz = Math.max(1, Math.round((ext.maxZ - ext.minZ) / COARSE_CELL));
  const coarse = makeGrid(ext.minX, ext.minZ, (ext.maxX - ext.minX) / cnx, (ext.maxZ - ext.minZ) / cnz, cnx, cnz);
  for (let j = 0; j <= cnz; j++) for (let i = 0; i <= cnx; i++) coarse.H[j * (cnx + 1) + i] = smoothHeight(coarse.ox + i * coarse.sx, coarse.oz + j * coarse.sz);

  // zona fina, aliniata la grila grosiera
  const ci0 = THREE.MathUtils.clamp(Math.floor((FINE.minX - ext.minX) / coarse.sx), 0, cnx);
  const ci1 = THREE.MathUtils.clamp(Math.ceil((FINE.maxX - ext.minX) / coarse.sx), 0, cnx);
  const cj0 = THREE.MathUtils.clamp(Math.floor((FINE.minZ - ext.minZ) / coarse.sz), 0, cnz);
  const cj1 = THREE.MathUtils.clamp(Math.ceil((FINE.maxZ - ext.minZ) / coarse.sz), 0, cnz);
  const hasFine = ci1 > ci0 && cj1 > cj0;
  let fine = null;
  if (hasFine) {
    const fnx = (ci1 - ci0) * FINE_DIV, fnz = (cj1 - cj0) * FINE_DIV;
    fine = makeGrid(coarse.ox + ci0 * coarse.sx, coarse.oz + cj0 * coarse.sz, coarse.sx / FINE_DIV, coarse.sz / FINE_DIV, fnx, fnz);
    for (let j = 0; j <= fnz; j++) for (let i = 0; i <= fnx; i++) {
      const x = fine.ox + i * fine.sx, z = fine.oz + j * fine.sz;
      // marginea = exact suprafata grosiera (fara fisuri); spre interior => relieful fin
      const d = Math.min(i, fnx - i, j, fnz - j);
      const w = THREE.MathUtils.smoothstep(d, 0, BLEND_CELLS);
      const hc = gridSample(coarse, x, z);
      fine.H[j * (fnx + 1) + i] = w >= 1 ? smoothHeight(x, z) : hc + (smoothHeight(x, z) - hc) * w;
    }
  }

  // cota EXACTA a suprafetei randate
  function heightAt(x, z) {
    if (fine && x >= fine.ox && x <= fine.maxX && z >= fine.oz && z <= fine.maxZ) return gridSample(fine, x, z);
    return gridSample(coarse, x, z);
  }

  // ---------------- mesh-uri ----------------
  const cBase = new THREE.Color(LANDUSE_BASE);
  const cLow = new THREE.Color(0x6f8f4a), cHigh = new THREE.Color(0x8c9a5c), cFlood = new THREE.Color(0x5f8a48);
  const c = new THREE.Color();
  const W = ext.maxX - ext.minX, D = ext.maxZ - ext.minZ;
  function buildMesh(G, skip, name) {
    const nvx = G.nx + 1, nvz = G.nz + 1, N = nvx * nvz;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Float32Array(N * 3), uv = new Float32Array(N * 2), uv1 = new Float32Array(N * 2);
    const e = Math.max(G.sx, G.sz);
    for (let j = 0, k = 0; j < nvz; j++) for (let i = 0; i < nvx; i++, k++) {
      const x = G.ox + i * G.sx, z = G.oz + j * G.sz, h = G.H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      // normala din diferente centrale ale suprafetei finale (continua intre cele doua grile)
      const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
      let nx = -dx, ny = 2 * e, nz = -dz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      const t = THREE.MathUtils.clamp((h + 10) / 120, 0, 1);
      c.copy(cFlood).lerp(cLow, Math.min(1, t * 3)).lerp(cHigh, Math.max(0, t - 0.3));
      const n = (Math.sin(x * 0.013) * Math.cos(z * 0.011) + Math.sin(x * 0.0021 + z * 0.0017)) * 0.04;
      // culoarea varfului = raport fata de culoarea de baza (materialul o inmulteste inapoi) =>
      // aceeasi nuanta ca inainte, iar cu o harta de utilizare a terenului ramane doar variatia de relief
      col[k * 3] = (c.r + n) / cBase.r; col[k * 3 + 1] = (c.g + n) / cBase.g; col[k * 3 + 2] = (c.b + n * 0.5) / cBase.b;
      // uv = coordonate normalizate pe intinderea DEM (nord sus) – pentru o eventuala ortofoto / harta
      uv[k * 2] = (x - ext.minX) / W; uv[k * 2 + 1] = 1 - (z - ext.minZ) / D;
      // uv1 = normalizat pe grila proprie (grila fina are harta ei, mai detaliata)
      uv1[k * 2] = (x - G.ox) / (G.maxX - G.ox); uv1[k * 2 + 1] = 1 - (z - G.oz) / (G.maxZ - G.oz);
    }
    const idx = [];
    for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
      if (skip && skip(i, j)) continue;
      const a = j * nvx + i, b = (j + 1) * nvx + i, cc = (j + 1) * nvx + i + 1, d = j * nvx + i + 1;
      // aceeasi impartire ca in gridSample: (a,b,d) pentru u+v<=1, (b,c,d) in rest
      idx.push(a, b, d, b, cc, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    geo.setIndex(N > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.name = name;
    m.matrixAutoUpdate = false;
    ctx.scene.add(m);
    return m;
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, color: cBase });
  mat.name = 'teren';
  const coarseMesh = buildMesh(coarse, hasFine ? (i, j) => i >= ci0 && i < ci1 && j >= cj0 && j < cj1 : null, 'teren-grosier');
  const fineMesh = fine ? buildMesh(fine, null, 'teren') : null;
  const mesh = fineMesh || coarseMesh;

  // ---------------- orizontul: "sorț" de peisaj indepartat in jurul DEM ----------------
  // Porneste EXACT din varfurile de pe marginea grilei grosiere (fara treapta / fisura) si merge radial pana la
  // ~34 km: cota se apropie lin de o cota medie, cu dealuri joase si curbura Pamantului (coboara sub orizont);
  // culoarea = marginea estompata a imaginii satelit (sau a picturii stilizate), iar ceata (culoarea cerului la
  // orizont, vezi environment.js) face perspectiva aeriana => fara margine sau inel plat vizibil.
  const horizon = buildHorizon();
  function buildHorizon() {
    const per = []; // perimetrul grilei grosiere, in sens trigonometric
    const vtx = (i, j) => [coarse.ox + i * coarse.sx, coarse.oz + j * coarse.sz, coarse.H[j * (cnx + 1) + i]];
    for (let i = 0; i < cnx; i++) per.push(vtx(i, 0));
    for (let j = 0; j < cnz; j++) per.push(vtx(cnx, j));
    for (let i = cnx; i > 0; i--) per.push(vtx(i, cnz));
    for (let j = cnz; j > 0; j--) per.push(vtx(0, j));
    const sorted = per.map((p) => p[2]).sort((a, b) => a - b);
    const hFar = sorted[Math.floor(sorted.length * 0.35)] - 4;
    const cx = (ext.minX + ext.maxX) / 2, cz = (ext.minZ + ext.maxZ) / 2;
    const RING = [0, 120, 350, 800, 1600, 3000, 5200, 8500, 13000, 19000, 26000, 34000];
    const NP = per.length, NR = RING.length;
    const pos = new Float32Array(NP * NR * 3), col = new Float32Array(NP * NR * 3);
    const noise = (x, z) => Math.sin(x * 0.00071 + Math.cos(z * 0.00043) * 2.1) * Math.cos(z * 0.00059 - x * 0.00021)
      + 0.5 * Math.sin(x * 0.0019 + z * 0.0013) * Math.sin(z * 0.0023 - x * 0.0007);
    const info = [];
    for (let r = 0; r < NR; r++) for (let p = 0; p < NP; p++) {
      const [px, pz, ph] = per[p];
      const ux = px - cx, uz = pz - cz, ul = Math.hypot(ux, uz) || 1;
      const dist = RING[r];
      const x = px + (ux / ul) * dist, z = pz + (uz / ul) * dist;
      const s = THREE.MathUtils.smoothstep(dist, 0, 7000);
      const hills = noise(x, z) * 22 * s * (1 - THREE.MathUtils.smoothstep(dist, 15000, 30000));
      const y = r === 0 ? ph : THREE.MathUtils.lerp(ph, hFar, s) + hills - (dist * dist) / (2 * 6371000);
      const k = (r * NP + p) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      info.push({ x, z, px, pz, dist, n: noise(x * 2.3, z * 2.3) });
    }
    const idx = [];
    for (let r = 0; r < NR - 1; r++) for (let p = 0; p < NP; p++) {
      const q = (p + 1) % NP;
      const a = r * NP + p, b = r * NP + q, c2 = (r + 1) * NP + q, d = (r + 1) * NP + p;
      idx.push(a, d, b, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // normala in sus garantata (ordinea perimetrului depinde de semnul axelor)
    if (g.attributes.normal.getY(NP * 2) < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); }
    g.computeBoundingSphere();
    const hm = new THREE.MeshLambertMaterial({ vertexColors: true });
    hm.name = 'orizont';
    const mesh = new THREE.Mesh(g, hm);
    mesh.name = 'orizont';
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    ctx.scene.add(mesh);
    const plainEdge = new THREE.Color(LANDUSE_BASE).multiplyScalar(0.95);
    const farA = new THREE.Color(), cc = new THREE.Color(), edge = new THREE.Color();
    // tint(x, z, out) -> culoarea (liniara) a imaginii la marginea DEM; null => stilizat
    function setTint(tint) {
      // media culorilor de pe margine => peisajul indepartat
      farA.setRGB(0, 0, 0);
      const step = Math.max(1, Math.floor(NP / 200));
      let n = 0;
      for (let p = 0; p < NP; p += step) { farA.add(tint ? tint(per[p][0], per[p][1], cc) : plainEdge); n++; }
      farA.multiplyScalar(1 / n);
      for (let k = 0; k < info.length; k++) {
        const v = info[k];
        if (tint) tint(v.px, v.pz, edge); else edge.copy(plainEdge);
        const s = THREE.MathUtils.smoothstep(v.dist, 300, 6000);
        cc.copy(edge).lerp(farA, s);
        const m = 1 + v.n * 0.12 * Math.min(1, v.dist / 500); // petice de campuri / paduri
        col[k * 3] = cc.r * m; col[k * 3 + 1] = cc.g * m; col[k * 3 + 2] = cc.b * m;
      }
      g.attributes.color.needsUpdate = true;
    }
    setTint(null);
    return { mesh, material: hm, setTint };
  }

  // Harta de utilizare a terenului (paduri, campuri, parcuri, ape…) pictata de city.js direct in culoarea terenului:
  // fara poligoane suprapuse => fara "z-fighting" si cu mult mai putine triunghiuri.
  // fine / coarse = texturi care acopera exact fineExtent / extent (nord sus, fundal = LANDUSE_BASE).
  // Materialul "normal" (stilizat / utilizarea terenului) si, peste el, optional, materialul satelitar.
  const plain = new Map(); // mesh -> material stilizat
  let overlay = null;      // Map mesh -> material satelitar (src/core/satellite.js) sau null
  const allMeshes = [fineMesh, coarseMesh].filter(Boolean);
  function applyMaterials() {
    for (const m of allMeshes) m.material = (overlay && overlay.get(m)) || plain.get(m) || mat;
  }
  function setLanduse({ fine: fineTex = null, coarse: coarseTex = null } = {}) {
    for (const [m, tex] of [[fineMesh, fineTex], [coarseMesh, coarseTex]]) {
      if (!m || !tex) continue;
      const mm = mat.clone();
      mm.color.set(0xffffff);
      tex.channel = 1;
      mm.map = tex;
      mm.name = m.name + '-utilizare';
      plain.set(m, mm);
    }
    applyMaterials();
  }
  // materials: Map(mesh -> Material) sau null (revine la harta stilizata)
  function setSatelliteMaterials(materials) {
    overlay = materials || null;
    applyMaterials();
  }

  return {
    mesh, meshes: allMeshes, material: mat, setLanduse, setSatelliteMaterials, landuseBase: LANDUSE_BASE,
    horizonMaterial: horizon.material, horizonMesh: horizon.mesh, setHorizonTint: horizon.setTint,
    heightAt, surfaceAt: heightAt, smoothHeight,
    baseElevation: base, hasDem: !!dem, extent: ext, flattenZones,
    // grilele (pentru cine vrea sa taie geometrie exact pe triunghiurile terenului, ex. zonele din city.js)
    fineExtent: fine ? { minX: fine.ox, maxX: fine.maxX, minZ: fine.oz, maxZ: fine.maxZ, cell: fine.sx, sx: fine.sx, sz: fine.sz } : null,
    coarseGrid: { ox: coarse.ox, oz: coarse.oz, sx: coarse.sx, sz: coarse.sz, nx: coarse.nx, nz: coarse.nz, hole: hasFine ? { i0: ci0, i1: ci1, j0: cj0, j1: cj1 } : null },
    coarseCell: coarse.sx,
  };
}

function makeGrid(ox, oz, sx, sz, nx, nz) {
  return { ox, oz, sx, sz, nx, nz, maxX: ox + sx * nx, maxZ: oz + sz * nz, H: new Float32Array((nx + 1) * (nz + 1)) };
}

// interpolare baricentrica pe triunghiurile mesh-ului (diagonala de la (i, j+1) la (i+1, j))
function gridSample(G, x, z) {
  let fx = (x - G.ox) / G.sx, fz = (z - G.oz) / G.sz;
  fx = fx < 0 ? 0 : fx > G.nx ? G.nx : fx;
  fz = fz < 0 ? 0 : fz > G.nz ? G.nz : fz;
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i >= G.nx) i = G.nx - 1;
  if (j >= G.nz) j = G.nz - 1;
  const u = fx - i, v = fz - j;
  const r = G.nx + 1, H = G.H;
  const k = j * r + i;
  if (u + v <= 1) {
    const h00 = H[k];
    return h00 + u * (H[k + 1] - h00) + v * (H[k + r] - h00);
  }
  const h11 = H[k + r + 1];
  return h11 + (1 - u) * (H[k + r] - h11) + (1 - v) * (H[k + 1] - h11);
}

// netezire usoara a DEM: jumatate din valoare + jumatate din media binomiala 3x3 (SRTM include copaci / cladiri)
function smoothGrid(H, nx, nz) {
  const tmp = new Float64Array(H.length), out = new Float64Array(H.length);
  const at = (A, i, j) => A[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) tmp[j * nx + i] = (at(H, i - 1, j) + 2 * at(H, i, j) + at(H, i + 1, j)) / 4;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = 0.5 * H[j * nx + i] + 0.5 * (at(tmp, i, j - 1) + 2 * at(tmp, i, j) + at(tmp, i, j + 1)) / 4;
  return out;
}
