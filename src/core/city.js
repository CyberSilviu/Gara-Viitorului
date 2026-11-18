import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  rng, pointInPoly, polyArea, centroid, bboxOf, densify, ribbonGeometry, discGeometry, canvasTexture,
  polyIntersectsPoly, convexHull, SegmentIndex, roadStyle, GROUND_LIFT, GROUND_OFFSET, orientedRect, GeoBuf,
} from './util.js';
import {
  facadeTextures, FACADE_TILES, roofTileTexture, roofMetalTexture, roofFlatTexture, asphaltTexture, paverTexture, groundPatternCanvas,
} from './textures.js';
import { TRACKS, stitchRoute, toLocal, toWorld } from '../station/frame.js';
import { buildRoads, buildRails } from './roads.js';
import { buildTrees } from './trees.js';
import { localToTile, gradeColor } from './satellite.js';
import { project } from './geo.js';

// Orasul Pascani real, din OpenStreetMap (public/data/osm.json):
// cladiri extrudate, drumuri, cai ferate, Siretul, ape, paduri si parcuri.
// `exclude` = poligoane [[x,z],...] unde NU desenam cladirile OSM (inlocuite de modelul nostru).
// Testul este o intersectie reala de poligoane (orice varf inauntru sau doua laturi care se taie), nu doar centroidul.
//
// Ordinea straturilor drapate (cota peste heightAt = suprafata exacta a terenului, vezi GROUND_LIFT din util.js):
//   zone 0,04 < apa 0,06 < drumuri minore 0,10 < drumuri majore 0,13 < autostrada/santier 0,15 < CF oras 0,20 < T1

// Piata garii desenata de modulul garii (sistemul local al garii: x spre linii, z de-a lungul axei; vezi station/plaza.js ZONES)
// – aici orasul nu deseneaza drumuri (aleile parcarii OSM ar iesi prin pavaj).
const STATION_SQUARE_LOCAL = [
  [-30, -112, -5, 60],      // forecourt
  [-63, -30, -49.5, -5.5],  // westN
  [-63, 3.5, -49.5, 62],    // westS
  [57.5, -84, 87, -40],     // piateta de est
  [-13, -62.5, 11.5, 58],   // cladirea de calatori
];
const localRect = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => toWorld(x, z));
const STATION_TRACK_R = 520; // raza in care modulul garii deseneaza propriile linii (station/platforms.js buildTracks)

export async function createCity(ctx, { exclude = [] } = {}) {
  const { scene } = ctx;
  const terrainH = ctx.terrain.heightAt;
  const fineExt = ctx.terrain.fineExtent;
  // straturile drapate: in afara grilei fine (celule de 75 m, cute mai mari) ridicam totul cu inca 12 cm
  const heightAt = fineExt
    ? (x, z) => terrainH(x, z) + (x >= fineExt.minX && x <= fineExt.maxX && z >= fineExt.minZ && z <= fineExt.maxZ ? 0 : 0.12)
    : terrainH;
  const r = await fetch('data/osm.json');
  const osm = await r.json();
  const group = new THREE.Group();
  group.name = 'oras-osm';
  scene.add(group);
  const rand = rng(42);
  const L = GROUND_LIFT;
  const offsetMat = (key, params) => new THREE.MeshStandardMaterial({ ...params, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: GROUND_OFFSET[key] });

  // ---------- zone speciale: campul de linii al garii (infasuratoarea liniilor din jurul garii) ----------
  const trackRails = osm.rails.filter((w) => w.k === 'rail');
  const fieldPts = [];
  for (const w of trackRails) for (const [x, z] of w.p) {
    if (Math.hypot(x, z) > 400) continue;
    const [lx] = toLocal(x, z);
    if (lx > 8 && lx < 75) fieldPts.push([x, z]); // fara curtea Electroputere / liniile industriale (lx > 75)
  }
  const trackField = fieldPts.length >= 3 ? convexHull(fieldPts) : null;
  const trackFieldBB = trackField ? bboxOf(trackField) : null;
  const inTrackField = (x, z) => !!trackField && x >= trackFieldBB.minX && x <= trackFieldBB.maxX && z >= trackFieldBB.minZ && z <= trackFieldBB.maxZ && pointInPoly(x, z, trackField);
  const squarePolys = [...STATION_SQUARE_LOCAL.map(localRect), ...exclude].map((p) => ({ p, b: bboxOf(p) }));
  const inSquare = (x, z) => squarePolys.some(({ p, b }) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInPoly(x, z, p));

  // ---------- Cladiri ----------
  // Geometrie proprie (nu ExtrudeGeometry): pereti cu UV in metri (u = perimetru, v = inaltimea peste sol),
  // acoperisuri in doua ape / in patru ape pe dreptunghiul orientat, sau terasa cu atic.
  // Cate un singur mesh per material (3 fatade + 3 acoperisuri), nuanta pe cladire prin culorile varfurilor.
  const facadeMats = {};
  for (const kind of ['house', 'block', 'ind']) {
    const ft = facadeTextures(kind);
    const m = facadeMats[kind] = new THREE.MeshStandardMaterial({
      map: ft.map, vertexColors: true, roughness: 1, metalness: 1, roughnessMap: ft.rough, metalnessMap: ft.rough,
      emissive: 0xffffff, emissiveMap: ft.emissive, emissiveIntensity: 0,
    });
    // ocluziune ambientala la baza peretelui (v = metri peste sol = vMapUv.y * TH); sub streasina: culori de varf
    const TH = FACADE_TILES[kind][1];
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  { float hG = vMapUv.y * ${TH.toFixed(2)}; diffuseColor.rgb *= mix(0.58, 1.0, smoothstep(-0.25, 1.6, hG)); }`);
    };
    m.customProgramCacheKey = () => 'gv-facade-ao-' + kind;
  }
  const roofMats = {
    tile: new THREE.MeshStandardMaterial({ map: roofTileTexture(), vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ map: roofMetalTexture(), vertexColors: true, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }),
    flat: new THREE.MeshStandardMaterial({ map: roofFlatTexture(), vertexColors: true, roughness: 0.95 }),
  };
  const palette = {
    house: [0xf3e9d6, 0xf6f0e4, 0xeedcc0, 0xf2dfb8, 0xfaf7f0, 0xe9d5b5, 0xe6e9d8, 0xf1d9c8],
    block: [0xeeeeea, 0xf0ebe0, 0xdfe3e6, 0xf0e2cc, 0xe9e2d6],
    ind: [0xc9ccce, 0xb8bdc1, 0xd6d1c4, 0xaeb7bd, 0xc7c1b0],
  };
  const roofPal = {
    tile: [0xb5553a, 0xa04a33, 0xc0663f, 0x8f4430, 0xb86b4b],
    metal: [0x7c8185, 0x6a6e72, 0x6b4a3a, 0x5b3d33, 0x8f9498],
    flat: [0x9a9a96, 0x8a8c8e, 0xa8a49c, 0x7f8285],
  };
  const sideBufs = { house: new GeoBuf(), block: new GeoBuf(), ind: new GeoBuf() };
  const roofBufs = { tile: new GeoBuf(), metal: new GeoBuf(), flat: new GeoBuf() };
  const col = new THREE.Color(), rcol = new THREE.Color();
  const PITCH = Math.tan(Math.PI / 6), COS_P = Math.cos(Math.PI / 6), EAVE = 0.4, PARAPET = 0.6;
  let buildingCount = 0, excludedCount = 0, pitchedCount = 0, aziCount = 0;
  const excludeBoxes = exclude.map((p) => ({ p, b: bboxOf(p) }));
  const footprintIndex = []; // pentru minimap & coliziuni grosiere
  const replaced = [];       // cladiri reale inlocuite de proiect (gara noua, T1) – afisate doar in modul „Azi”
  const roofRanges = [];     // pe cladire: intervalul de varfuri din geometria comuna a acoperisului (nuanta din satelit)
  const roofMeshes = {};
  const IND_T = ['industrial', 'warehouse', 'commercial', 'retail', 'garages', 'garage', 'service', 'farm_auxiliary', 'barn', 'shed'];
  const COLW = { house: 3, block: 3.6, ind: 8 };

  // fata de acoperis plana: uv = (metri pe directia streasinii, metri pe panta)
  const roofFace = (buf, pts, ox, oz, ex, ez, ix, iz, c) => {
    const uvs = pts.map((p) => [(p[0] - ox) * ex + (p[2] - oz) * ez, ((p[0] - ox) * ix + (p[2] - oz) * iz) / COS_P]);
    for (let k = 1; k < pts.length - 1; k++) buf.tri(pts[0], pts[k], pts[k + 1], uvs[0], uvs[k], uvs[k + 1], c, 0, 1, 0);
  };

  for (const b of osm.buildings) {
    const p = b.p;
    if (p.length < 4) continue;
    const bb = bboxOf(p);
    // intersectie reala de poligoane (nu doar centroidul) cu zonele garii / T1
    if (excludeBoxes.some((e) => polyIntersectsPoly(p, e.p, bb, e.b))) { excludedCount++; replaced.push(b); continue; }
    // plasa de siguranta: nicio cladire in campul de linii al garii (copertine / vagoane detectate ca "cladiri")
    if (trackField && b.t === 'ms' && polyIntersectsPoly(p, trackField, bb, trackFieldBB)) { excludedCount++; continue; }
    const [cx, cz] = centroid(p);
    const area = Math.abs(polyArea(p));
    if (area < 6) continue;
    // inel fara punctul de inchidere si fara duplicate, orientat astfel incat normala exterioara a laturii a->b = (-dz, dx)
    let ring = [];
    for (let i = 0; i < p.length - 1; i++) { const q = ring[ring.length - 1]; if (!q || Math.hypot(p[i][0] - q[0], p[i][1] - q[1]) > 0.05) ring.push(p[i]); }
    if (ring.length > 2 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.05) ring.pop();
    if (ring.length < 3) continue;
    {
      const [ax, az] = ring[0], [bx, bz] = ring[1];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const mx = (ax + bx) / 2 - ((bz - az) / L) * 0.02, mz = (az + bz) / 2 + ((bx - ax) / L) * 0.02;
      if (pointInPoly(mx, mz, ring)) ring = ring.reverse();
    }
    let ground = Infinity;
    for (const [x, z] of ring) ground = Math.min(ground, terrainH(x, z));
    const h = b.h || 5.5;
    const kind = ['apartments', 'block', 'dormitory'].includes(b.t) || h >= 11 ? 'block'
      : IND_T.includes(b.t) || (b.t === 'ms' && area > 900) ? 'ind' : 'house';
    const obb = area < 350 ? orientedRect(ring) : null;
    const pitched = !!obb && obb.hw > 1.5 && area / obb.area > 0.8;
    let roofKind = 'flat', eave = h, ridgeH = 0;
    if (pitched) {
      roofKind = rand() < 0.78 ? 'tile' : 'metal';
      ridgeH = obb.hw * PITCH;
      eave = Math.max(2.9, h - ridgeH * 0.7);
    }
    const top = ground + eave;
    col.setHex(palette[kind][Math.floor(rand() * palette[kind].length)]);
    rcol.setHex(roofPal[roofKind][Math.floor(rand() * roofPal[roofKind].length)]).multiplyScalar(0.9 + rand() * 0.15);
    const wall = sideBufs[kind];
    const [TW] = FACADE_TILES[kind];
    const cw = COLW[kind];
    // pereti (+ atic la terasa)
    let u = Math.floor(rand() * (TW / cw)) * cw;
    const yTop = roofKind === 'flat' ? top + PARAPET : top;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      const y0 = ground - 1.5;
      // banda de sus (0,9 m) separata: varfurile de sub streasina / cornisa mai intunecate (ocluziune ambientala)
      const yB = yTop - ground > 3 ? yTop - 0.9 : yTop;
      wall.quad([ax, y0, az], [bx, y0, bz], [bx, yB, bz], [ax, yB, az], [u, y0 - ground], [u + L, y0 - ground], [u + L, yB - ground], [u, yB - ground], col, nx, 0, nz);
      if (yB < yTop) {
        const c0 = wall.count;
        wall.quad([ax, yB, az], [bx, yB, bz], [bx, yTop, bz], [ax, yTop, az], [u, yB - ground], [u + L, yB - ground], [u + L, yTop - ground], [u, yTop - ground], col, nx, 0, nz);
        const k = roofKind === 'flat' ? 0.86 : 0.7;
        for (let vi = c0; vi < wall.count; vi++) if (wall.pos[vi * 3 + 1] > yTop - 1e-3) { wall.col[vi * 3] *= k; wall.col[vi * 3 + 1] *= k; wall.col[vi * 3 + 2] *= k; }
      }
      if (roofKind === 'flat') { // fata interioara a aticului
        wall.quad([bx, top, bz], [ax, top, az], [ax, yTop, az], [bx, yTop, bz], [u + L, eave], [u, eave], [u, eave + PARAPET], [u + L, eave + PARAPET], col, -nx, 0, -nz);
      }
      u = Math.ceil((u + L) / cw) * cw; // fiecare latura incepe cu o coloana intreaga de ferestre
    }
    const roofStart = roofBufs[roofKind].count;
    if (roofKind === 'flat') {
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
      const rb = roofBufs.flat;
      for (const [i0, i1, i2] of tris) {
        const P = [ring[i0], ring[i1], ring[i2]].map(([x, z]) => [x, top, z]);
        rb.tri(P[0], P[1], P[2], [P[0][0], P[0][2]], [P[1][0], P[1][2]], [P[2][0], P[2][2]], rcol, 0, 1, 0);
      }
    } else {
      const { cx: ox, cz: oz, ux, uz, hl, hw } = obb;
      const vx = -uz, vz = ux; // axa scurta
      const gable = hl / hw > 1.8;
      const HL = hl + EAVE, HW = hw + EAVE, ye = top - EAVE * PITCH, yr = top + ridgeH;
      const P = (s, t, y) => [ox + ux * s + vx * t, y, oz + uz * s + vz * t];
      const A = P(-HL, -HW, ye), B = P(HL, -HW, ye), C = P(HL, HW, ye), D = P(-HL, HW, ye);
      const rl = gable ? HL : Math.max(0, hl - hw);
      const R1 = P(-rl, 0, yr), R2 = P(rl, 0, yr);
      const rb = roofBufs[roofKind];
      // panta "t = -HW": streasina A->B, spre interior +v
      roofFace(rb, [A, B, R2, R1], A[0], A[2], ux, uz, vx, vz, rcol);
      roofFace(rb, [C, D, R1, R2], C[0], C[2], -ux, -uz, -vx, -vz, rcol);
      if (!gable) {
        roofFace(rb, [B, C, R2], B[0], B[2], vx, vz, -ux, -uz, rcol);
        roofFace(rb, [D, A, R1], D[0], D[2], -vx, -vz, ux, uz, rcol);
      } else {
        // timpane (in materialul fatadei)
        for (const sg of [-1, 1]) {
          const a = P(sg * hl, -hw, top), c = P(sg * hl, hw, top), r = P(sg * hl, 0, yr);
          wall.tri(a, c, r, [0, eave], [2 * hw, eave], [hw, eave + ridgeH], col, ux * sg, 0, uz * sg);
        }
      }
      pitchedCount++;
    }
    roofRanges.push({ kind: roofKind, s: roofStart, e: roofBufs[roofKind].count, ring, cx, cz });
    footprintIndex.push({ p, h, cx, cz, n: b.n });
    buildingCount++;
  }
  for (const [kind, buf] of Object.entries(sideBufs)) {
    if (!buf.count) continue;
    const m = new THREE.Mesh(buf.build(), facadeMats[kind]);
    m.castShadow = true; m.receiveShadow = true; m.name = 'cladiri-pereti-' + kind;
    group.add(m);
  }
  for (const [kind, buf] of Object.entries(roofBufs)) {
    if (!buf.count) continue;
    const m = new THREE.Mesh(buf.build(), roofMats[kind]);
    m.castShadow = true; m.receiveShadow = true; m.name = 'cladiri-acoperis-' + kind;
    group.add(m);
    roofMeshes[kind] = m;
  }
  const roofTint = tintRoofsFromSatellite(ctx, roofRanges, roofMeshes);

  // ---------- Zone (paduri, parcuri, apa, agricol) ----------
  // Pictate direct in culoarea terenului (ctx.terrain.setLanduse): o textura fina (~2,5 m/px) peste oras + coridor
  // si una grosiera peste tot relieful. Fara poligoane suprapuse => fara "z-fighting" si fara zone care intra sub teren.
  const areaColors = {
    forest: 0x3f6b33, wood: 0x3f6b33, scrub: 0x5b7a3d, grass: 0x7aa456, meadow: 0x86a85a, park: 0x6f9f4f, garden: 0x7aa456,
    farmland: 0xa7a066, orchard: 0x789a4d, vineyard: 0x7f8f4a, residential: 0x9a9a8a, industrial: 0x8f8d86, railway: 0x8a8177,
    cemetery: 0x6c8456, allotments: 0x86a05c, pitch: 0x5f9c4a, stadium: 0x6a9a50, wetland: 0x5f8466, water: 0x3f6f86,
  };
  // ordinea de pictare: utilizari mari intai, detaliile (parcuri, terenuri de sport, ape) deasupra
  const paintOrder = ['farmland', 'meadow', 'vineyard', 'orchard', 'residential', 'industrial', 'railway', 'allotments', 'wetland', 'scrub', 'forest', 'wood', 'grass', 'garden', 'park', 'cemetery', 'stadium', 'pitch', 'water'];
  const areasSorted = osm.areas.filter((a) => a.p.length >= 4)
    .map((a) => ({ a, o: paintOrder.indexOf(a.k) < 0 ? 12 : paintOrder.indexOf(a.k) }))
    .sort((u, w) => u.o - w.o).map((u) => u.a);
  const shadeRand = rng(5);
  const shades = areasSorted.map(() => 0.93 + shadeRand() * 0.12); // fiecare parcela putin diferita
  const tmpC = new THREE.Color();
  // sol stilizat: iarba / brazde / padure (modele mici repetate, brazdele rotite pe fiecare parcela)
  const groundKind = { farmland: 'field', meadow: 'grass', vineyard: 'field', orchard: 'field', allotments: 'field', forest: 'forest', wood: 'forest', scrub: 'forest', grass: 'grass', garden: 'grass', park: 'grass', cemetery: 'grass', pitch: 'grass', stadium: 'grass', wetland: 'grass' };
  const patRand = rng(9);
  const patternFor = (g, kind, hex, i = -1) => {
    if (!kind) return null;
    const c = groundPatternCanvas(kind, hex);
    if (!c || !g.createPattern) return null;
    const pat = g.createPattern(c, 'repeat');
    if (pat && kind === 'field' && i >= 0 && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().rotate(patRand() * 180));
    return pat;
  };
  const paintLanduse = (E, maxPx, mPerPx) => {
    const W = E.maxX - E.minX, D = E.maxZ - E.minZ;
    const cw = Math.max(64, Math.min(maxPx, Math.ceil(W / mPerPx))), ch = Math.max(64, Math.min(maxPx, Math.ceil(D / mPerPx)));
    const sx = cw / W, sz = ch / D;
    const tex = canvasTexture(cw, ch, (g) => {
      const baseHex = parseInt((ctx.terrain.landuseBase || '#6f8f4a').slice(1), 16);
      g.fillStyle = patternFor(g, 'grass', baseHex) || ctx.terrain.landuseBase || '#6f8f4a';
      g.fillRect(0, 0, cw, ch);
      areasSorted.forEach((a, i) => {
        const bb = bboxOf(a.p);
        if (bb.maxX < E.minX || bb.minX > E.maxX || bb.maxZ < E.minZ || bb.minZ > E.maxZ) return;
        tmpC.setHex(areaColors[a.k] ?? areaColors.grass, THREE.SRGBColorSpace);
        if (a.k !== 'water') tmpC.multiplyScalar(Math.round(shades[i] * 25) / 25);
        const hexS = tmpC.getHexString(THREE.SRGBColorSpace);
        g.fillStyle = patternFor(g, groundKind[a.k], parseInt(hexS, 16), i) || '#' + hexS;
        g.beginPath();
        a.p.forEach(([x, z], k) => { const px = (x - E.minX) * sx, pz = (z - E.minZ) * sz; if (k) g.lineTo(px, pz); else g.moveTo(px, pz); });
        g.closePath();
        g.fill();
      });
      // rauri si paraie (sub panglicile de apa, ca sa nu ramana goluri)
      g.strokeStyle = '#3f6f86'; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const w of osm.rivers) {
        const width = w.k === 'river' ? (/(siret)/i.test(w.n || '') ? 45 : 18) : w.k === 'canal' ? 6 : 3.5;
        g.lineWidth = Math.max(1, width * sx);
        g.beginPath();
        w.p.forEach(([x, z], k) => { const px = (x - E.minX) * sx, pz = (z - E.minZ) * sz; if (k) g.lineTo(px, pz); else g.moveTo(px, pz); });
        g.stroke();
      }
    });
    return tex;
  };
  const landuse = {
    fine: fineExt ? paintLanduse(fineExt, 4096, 2.5) : null,
    coarse: paintLanduse(ctx.terrain.extent, 2048, 12),
  };
  if (ctx.terrain.setLanduse) ctx.terrain.setLanduse(landuse);

  // copaci in paduri / parcuri / livezi / cimitire
  const treePoints = [];
  for (const a of osm.areas) {
    if (a.p.length < 4 || !['forest', 'wood', 'park', 'scrub', 'orchard', 'cemetery'].includes(a.k)) continue;
    const p = a.p, bbA = bboxOf(p);
    const area = Math.abs(polyArea(p));
    const density = a.k === 'forest' || a.k === 'wood' ? 1 / 220 : 1 / 450;
    const n = Math.min(1600, Math.floor(area * density));
    for (let i = 0; i < n; i++) {
      const x = bbA.minX + rand() * (bbA.maxX - bbA.minX), z = bbA.minZ + rand() * (bbA.maxZ - bbA.minZ);
      if (pointInPoly(x, z, p)) treePoints.push([x, z, a.k]);
    }
  }
  const waterMat = offsetMat('water', { color: 0x3f6f86, roughness: 0.15, metalness: 0.3 });

  // ---------- Rauri ----------
  const riverGeoms = [];
  const waterIndex = new SegmentIndex(80);
  for (const w of osm.rivers) {
    const width = w.k === 'river' ? (/(siret)/i.test(w.n || '') ? 45 : 18) : w.k === 'canal' ? 6 : 3.5;
    riverGeoms.push(ribbonGeometry(w.p, width, heightAt, L.water, 8));
    waterIndex.addPolyline(w.p, width / 2, 'river');
  }
  if (riverGeoms.length) {
    const m = new THREE.Mesh(mergeGeometries(riverGeoms, false), waterMat);
    m.name = 'rauri'; group.add(m);
  }

  // ---------- Cai ferate: index (pentru drumuri) + liniile desenate de modulul garii ----------
  const railIndex = new SegmentIndex(60);
  for (const w of trackRails) railIndex.addPolyline(w.p, 0, 'rail');
  const stationTracks = new SegmentIndex(40);
  for (const t of TRACKS) {
    const route = stitchRoute(osm.rails, { x: t.x, lz: (t.z0 + t.z1) / 2, maxLen: 1600 });
    if (route) stationTracks.addPolyline(route, 0, t.id);
  }

  // ---------- Drumuri + poduri rutiere (roads.js / bridges.js) ----------
  const roads = buildRoads(ctx, { osm, group, heightAt, terrainH, inTrackField, inSquare, railIndex, waterIndex, offsetMat });
  const { roadRuns, roadIndex, lampRuns, droppedNearRail, clippedPts } = roads;

  // ---------- Cai ferate existente (roads.js buildRails: balast + traverse + sine) ----------
  const { railSkipped } = buildRails(ctx, { osm, group, heightAt, stationTracks, stationR: STATION_TRACK_R, offsetMat });

  // ---------- Copaci (instantiati) ----------
  // nu pe drumuri, pe sine sau in rauri
  const okTree = (x, z) => !roadIndex.hitPoly([[x - 0.5, z - 0.5], [x + 0.5, z - 0.5], [x + 0.5, z + 0.5], [x - 0.5, z + 0.5]])
    && railIndex.nearest(x, z, 5).d > 4 && !waterIndex.hitPoly([[x - 1, z - 1], [x + 1, z - 1], [x + 1, z + 1], [x - 1, z + 1]]);
  const treeOk = treePoints.filter(([x, z]) => okTree(x, z));
  const trees = buildTrees(ctx, {
    group, points: treeOk, terrainH, okTree, roadRuns, footprints: footprintIndex,
    inExcluded: (x, z) => inTrackField(x, z) || inSquare(x, z),
  });
  const maxTrees = trees.count;

  // ---------- Iluminat stradal (puncte luminoase noaptea) ----------
  const lampPos = [];
  for (const w of lampRuns) {
    if (!['primary', 'secondary', 'tertiary', 'residential', 'trunk', 'living_street', 'pedestrian'].includes(w.k)) continue;
    const step = w.k === 'residential' ? 38 : 30;
    const off = w.k === 'residential' ? 4 : 6;
    let acc = 0;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [x0, z0] = w.pts[i], [x1, z1] = w.pts[i + 1];
      const d = Math.hypot(x1 - x0, z1 - z0);
      const nx = -(z1 - z0) / (d || 1), nz = (x1 - x0) / (d || 1);
      while (acc < d) {
        const t = acc / d, x = x0 + (x1 - x0) * t + nx * off, z = z0 + (z1 - z0) * t + nz * off;
        if (!inTrackField(x, z) && !inSquare(x, z)) lampPos.push(x, (roads.roadHeightAt(x - nx * off, z - nz * off) ?? terrainH(x, z)) + 7, z);
        acc += step;
      }
      acc -= d;
    }
  }
  const glowTex = canvasTexture(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(0.25, 'rgba(255,200,120,.65)'); gr.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lampMat = new THREE.PointsMaterial({ size: 9, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 });
  const lamps = new THREE.Points(lampGeo, lampMat);
  lamps.name = 'iluminat-stradal';
  lamps.visible = false;
  group.add(lamps);

  // Ferestre aprinse si iluminat noaptea
  ctx.env.onChange((st) => {
    for (const m of Object.values(facadeMats)) m.emissiveIntensity = st.night * 0.85;
    lampMat.opacity = THREE.MathUtils.smoothstep(st.night, 0.3, 0.8);
    lamps.visible = st.night > 0.3;
  });

  // ---------- Cladirile reale inlocuite de proiect: vizibile doar in modul „Azi” ----------
  {
    const aziGeoms = [], aziRoofs = [];
    for (const b of replaced) {
      const p = b.p;
      if (b.id === 841790852) continue; // cladirea garii: o deseneaza modulul garii in ambele moduri
      const [cx, cz] = centroid(p);
      const [lx, lz] = toLocal(cx, cz);
      if (lx > -14 && lx < 12 && lz > -64 && lz < 60) continue; // amprenta cladirii de calatori
      const area = Math.abs(polyArea(p));
      if (area < 12) continue;
      if (b.t === 'ms' && (area < 30 || (trackField && pointInPoly(cx, cz, trackField)))) continue; // copertine / vagoane detectate fals
      const ring = p.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, -z));
      if (THREE.ShapeUtils.isClockWise(ring)) ring.reverse();
      let ground = Infinity;
      for (const [x, z] of p) ground = Math.min(ground, terrainH(x, z));
      const h = b.h || 5.5;
      try {
        const g = new THREE.ExtrudeGeometry(new THREE.Shape(ring), { depth: h + 1, bevelEnabled: false });
        g.rotateX(-Math.PI / 2); g.translate(0, ground - 1, 0);
        const nonIdx = g.index ? g.toNonIndexed() : g;
        aziGeoms.push(nonIdx);
      } catch (e) { /* forma invalida */ }
    }
    if (aziGeoms.length) {
      const aziGroup = new THREE.Group();
      aziGroup.name = 'cladiri-azi';
      const m = new THREE.Mesh(mergeGeometries(aziGeoms.map((g) => { g.deleteAttribute('uv'); return g; }), false),
        new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.9 }));
      m.castShadow = true; m.receiveShadow = true;
      aziGroup.add(m);
      aziGroup.visible = false;
      group.add(aziGroup);
      ctx.futureToggles.push((on) => { aziGroup.visible = !on; });
    }
    aziCount = aziGeoms.length;
  }

  console.info(`Oras: ${buildingCount} cladiri (${pitchedCount} cu acoperis inclinat, ${excludedCount} excluse, ${aziCount} afisate doar in „Azi”), ${roadRuns.length} tronsoane de drum (${droppedNearRail} drumuri pe CF eliminate, ${clippedPts} puncte taiate in gara), ${osm.rails.length} CF (${railSkipped} puncte desenate de gara), ${maxTrees} copaci (${trees.street} de aliniament, ${Math.round(trees.triangles / 1000)}k tri), ${roads.bridges.length} poduri rutiere (${roads.pierCount} pile)`);
  // ---------- Mod satelit ----------
  // ON: ortofoto inlocuieste pictura stilizata a terenului; TOATE strazile si trotuarele raman vizibile
  // (asfalt usor transparent, vezi roads.js). Caile ferate raman vizibile. OFF: revenim.
  let satellite = false;
  function setSatelliteMode(on) {
    on = !!on;
    if (on === satellite) return;
    satellite = on;
    roads.setSatelliteMode(on);
    if (typeof ctx.terrain.setLanduseVisible === 'function') ctx.terrain.setLanduseVisible(!on);
  }

  return {
    setSatelliteMode, isSatelliteMode: () => satellite,
    group, osm, footprints: footprintIndex, buildingCount,
    trackField, roads: roadRuns, roadIndex, railIndex, waterIndex, landuse,
    roadHeightAt: roads.roadHeightAt, bridges: roads.bridges, bridgePiers: roads.bridgePiers, roofTint,
  };
}

// ---------- Culoarea acoperisurilor din imaginea satelit (Esri, la rulare) ----------
// Pentru cladirile din jurul garii (r <= 1,5 km) si de pe coridorul spre nodul A7xA8 citim dalele Esri (z17 aproape,
// z16 mai departe; max. 120 de cereri, CORS, doar in memorie), luam MEDIANA culorii in interiorul amprentei
// (micsorata spre centru, ca sa evitam marginile / umbrele) si nuantam varfurile acoperisului pe loc.
// La orice eroare ramane paleta initiala.
const ESRI_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ROOF_TEX_MEAN = { tile: 0.68, metal: 0.78, flat: 0.66 }; // luminozitatea medie (liniara) a texturilor de acoperis
function tintRoofsFromSatellite(ctx, ranges, meshes, { radius = 1500, corridor = 260, maxReq = 120, delay = 2500 } = {}) {
  const state = { tinted: 0, tiles: 0, failed: 0, done: false };
  if (typeof document === 'undefined' || typeof fetch !== 'function' || typeof createImageBitmap !== 'function') { state.done = true; return state; }
  const hub = project(47.2175, 26.7142); // nodul A7xA8 (coridorul T1 spre turbion)
  const segD = (x, z) => { // distanta pana la segmentul gara -> nod
    const L2 = hub.x * hub.x + hub.z * hub.z, t = Math.max(0, Math.min(1, (x * hub.x + z * hub.z) / L2));
    return Math.hypot(x - hub.x * t, z - hub.z * t);
  };
  const tiles = new Map();
  for (const b of ranges) {
    if (b.e <= b.s) continue;
    const d = Math.hypot(b.cx, b.cz);
    if (d > radius && segD(b.cx, b.cz) > corridor) continue;
    const zoom = d < 700 ? 17 : 16;
    const [tx, ty] = localToTile(b.cx, b.cz, zoom);
    const key = zoom + '/' + Math.floor(tx) + '/' + Math.floor(ty);
    let t = tiles.get(key);
    if (!t) tiles.set(key, t = { zoom, X: Math.floor(tx), Y: Math.floor(ty), d, list: [] });
    t.d = Math.min(t.d, d);
    t.list.push(b);
  }
  const queue = [...tiles.values()].sort((a, b) => a.d - b.d).slice(0, maxReq);
  state.tiles = queue.length;
  const cnv = document.createElement('canvas'); cnv.width = cnv.height = 256;
  const g = cnv.getContext('2d', { willReadFrequently: true });
  const c = new THREE.Color(), pal = new THREE.Color();
  const dirty = new Set();
  const med = (a) => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
  function apply(t, px) {
    for (const b of t.list) {
      const R = [], G = [], B = [];
      let n = 0;
      const bb = bboxOf(b.ring);
      const step = Math.max(0.6, Math.sqrt(((bb.maxX - bb.minX) * (bb.maxZ - bb.minZ)) / 80));
      for (let x = bb.minX + step / 2; x < bb.maxX; x += step) for (let z = bb.minZ + step / 2; z < bb.maxZ; z += step) {
        const qx = b.cx + (x - b.cx) * 0.75, qz = b.cz + (z - b.cz) * 0.75; // micsorat spre centru
        if (!pointInPoly(qx, qz, b.ring)) continue;
        const [fx, fy] = localToTile(qx, qz, t.zoom);
        const ix = Math.floor((fx - t.X) * 256), iy = Math.floor((fy - t.Y) * 256);
        if (ix < 0 || iy < 0 || ix > 255 || iy > 255) continue;
        const o = (iy * 256 + ix) * 4;
        n++;
        const pr = px[o], pg = px[o + 1], pb = px[o + 2];
        // ignoram vegetatia (copaci peste acoperis / amprenta usor decalata) si umbrele foarte intunecate
        if (pg > pr * 1.04 && pg >= pb) continue;
        if (pr + pg + pb < 110) continue;
        R.push(pr); G.push(pg); B.push(pb);
      }
      if (R.length < 3 || R.length < n * 0.4) continue; // prea putin acoperis vizibil: ramane culoarea din paleta
      c.setRGB(med(R) / 255, med(G) / 255, med(B) / 255, THREE.SRGBColorSpace);
      gradeColor(c, c);
      const k = 1 / ROOF_TEX_MEAN[b.kind];
      const col = meshes[b.kind]?.geometry.attributes.color;
      if (!col) continue;
      pal.setRGB(col.getX(b.s), col.getY(b.s), col.getZ(b.s));
      // 70 % satelit, 30 % paleta; saturatia limitata (fara acoperisuri „fosforescente”)
      let r = Math.min(0.95, Math.max(0.03, (c.r * k) * 0.7 + pal.r * 0.3));
      let gg = Math.min(0.95, Math.max(0.03, (c.g * k) * 0.7 + pal.g * 0.3));
      let bl = Math.min(0.95, Math.max(0.03, (c.b * k) * 0.7 + pal.b * 0.3));
      if (gg > r && gg > bl) { const m = (r + gg + bl) / 3; r = gg = bl = m; } // inca verzui => gri neutru (tabla)
      for (let i = b.s; i < b.e; i++) col.setXYZ(i, r, gg, bl);
      dirty.add(col);
      state.tinted++;
    }
  }
  async function one(t) {
    const url = ESRI_TILE.replace('{z}', t.zoom).replace('{y}', t.Y).replace('{x}', t.X);
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(res.status);
      const bmp = await createImageBitmap(await res.blob());
      g.clearRect(0, 0, 256, 256);
      g.drawImage(bmp, 0, 0, 256, 256);
      bmp.close?.();
      apply(t, g.getImageData(0, 0, 256, 256).data);
    } catch (e) { state.failed++; }
  }
  setTimeout(async () => {
    let i = 0;
    const worker = async () => {
      while (i < queue.length) {
        if (state.failed >= 8 && state.tinted === 0) return; // fara retea / CORS blocat: renuntam
        await one(queue[i++]);
        for (const col of dirty) col.needsUpdate = true;
        dirty.clear();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    state.done = true;
    console.info(`Acoperisuri: ${state.tinted} nuantate din satelit (${state.tiles} dale, ${state.failed} erori)`);
  }, delay);
  return state;
}
