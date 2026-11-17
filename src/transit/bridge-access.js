import * as THREE from 'three';
import { merge, box } from './util3d.js';
import { TRACK_HALF } from './route.js';

// Statia „Centru – Spital (pod DN28A)”: turn de scari + lift panoramic (sticla) pe partea VEST a peronului,
// legat printr-o pasarela scurta la cota tablierului de trotuarul podului rutier DN28A (OSM way 28912198).
// Cota tablierului: ctx.city.roadHeightAt(x, z) la capatul pasarelei (fallback: bridge.y).
const BRIDGE_ID = 28912198;
const H_PLAT = 0.42;         // peronul T1 peste platforma caii (ca stops.js)
const WALK = 2.5;            // trotuarul podurilor (src/core/roads.js SIDEWALK)

export function buildBridgeAccess(ctx, route, shared) {
  const st = route.stops.find((s) => s.id === 'centru');
  const bridges = ctx.city?.bridges || [];
  const br = bridges.find((b) => b.id === BRIDGE_ID) || bridges.find((b) => b.ref === 'DN28A');
  if (!st || !br || !br.pts || br.pts.length < 2) { console.warn('T1: podul DN28A sau statia Centru lipsesc – fara turn de acces'); return null; }

  // distanta de la un punct la axul tablierului
  const deckDist = (x, z) => {
    let m = Infinity;
    for (let i = 0; i < br.pts.length - 1; i++) {
      const [ax, az] = br.pts[i], [bx, bz] = br.pts[i + 1], vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
      m = Math.min(m, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
    return m;
  };

  // sistem local al turnului: X = spre vest (dreapta sensului de mers), Z = in lungul liniei (spre pod), Y = sus
  const side = 1;
  const LAT0 = TRACK_HALF + 4.45 + 0.25;       // fata exterioara a peronului vest + rost
  const TW = 4.2, TL = 5.0;                    // amprenta turnului
  const sT0 = st.s + 16.5;                     // turnul sta la capatul sudic al peronului (spre pod; peronul = st.s +-21)
  const tg = new THREE.Vector3(); route.tangent(sT0, tg); tg.y = 0; tg.normalize();
  const X = new THREE.Vector3(-tg.z, 0, tg.x).multiplyScalar(side), Y = new THREE.Vector3(0, 1, 0), Z = tg.clone();
  const o = route.offsetPoint(sT0, side * LAT0, new THREE.Vector3());
  const base = route.heightAtS(sT0) + H_PLAT;
  const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(o.x, base, o.z);
  const W = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(M);

  // capatul pasarelei: inaintam pe Z pana la marginea trotuarului podului
  const reach = br.width / 2 + WALK - 0.4;
  let Lf = null;
  for (let z = TL; z < TL + 60; z += 0.25) { const p = W(TW / 2, z); if (deckDist(p.x, p.z) <= reach) { Lf = z + 0.6; break; } }
  if (Lf == null) { console.warn('T1: pasarela spre podul DN28A nu ajunge la tablier'); return null; }
  const pe = W(TW / 2, Lf);
  // cota trotuarului: cea mai apropiata suprafata de drum de cota tablierului
  let yDeck = ctx.city?.roadHeightAt?.(pe.x, pe.z, br.y);
  if (!(yDeck > base + 2)) yDeck = br.y;
  const h = yDeck - base;                      // inaltimea de urcat (peron -> pod)
  if (!(h > 2 && h < 20)) { console.warn('T1: cota podului DN28A neasteptata', h); return null; }

  const steel = [], glass = [], slab = [], cabin = [], glow = [];
  const add = (arr, g) => { g.applyMatrix4(M); arr.push(g); };
  const STEEL = 0x5b6470, CONC = 0xc3c6ca;
  const terr = (lz) => route.terrainAtS(sT0 + lz) - base;   // teren (aprox. axa) relativ la peron

  // ---- fundatie + stalpi + acoperis ----
  add(slab, box(TW + 0.4, Math.max(0.3, -terr(TL / 2) + 0.6), TL + 0.4, TW / 2, Math.min(-0.15, terr(TL / 2) / 2 - 0.3), TL / 2, CONC));
  for (const [cx, cz] of [[0, 0], [TW, 0], [0, TL], [TW, TL]]) add(steel, box(0.2, h + 3.0, 0.2, cx, (h + 3.0) / 2, cz, STEEL));
  add(steel, box(TW + 0.6, 0.25, TL + 0.6, TW / 2, h + 3.1, TL / 2, 0x3f4650));     // acoperis
  add(glow, box(TW - 0.4, 0.04, 0.2, TW / 2, h + 2.95, TL / 2, 0xfff1d0));           // LED sub acoperis

  // ---- lift panoramic: put de sticla X 0,2…2,0, Z 0,3…2,3 + cabina (la nivelul peronului) ----
  const SX0 = 0.2, SX1 = 2.0, SZ0 = 0.3, SZ1 = 2.3, sh = h + 2.6;
  add(glass, box(SX1 - SX0, sh, 0.03, (SX0 + SX1) / 2, sh / 2, SZ0, 0xffffff));
  add(glass, box(0.03, sh, SZ1 - SZ0, SX0, sh / 2, (SZ0 + SZ1) / 2, 0xffffff));
  add(glass, box(0.03, sh, SZ1 - SZ0, SX1, sh / 2, (SZ0 + SZ1) / 2, 0xffffff));
  for (const [cx, cz] of [[SX0, SZ0], [SX1, SZ0], [SX0, SZ1], [SX1, SZ1]]) add(steel, box(0.08, sh, 0.08, cx, sh / 2, cz, 0x9aa3ab));
  add(cabin, box(1.5, 2.3, 1.7, (SX0 + SX1) / 2, 1.2, (SZ0 + SZ1) / 2, 0xd9dde2));
  add(glow, box(0.5, 0.18, 0.02, (SX0 + SX1) / 2, 2.6, SZ1 + 0.02, 0x22d3ee));     // indicator „LIFT”

  // ---- scari: rampe duble (11 trepte de 0,28 m pe rampa), podeste la Z 0,1…1,0 si 4,0…4,9; numar impar de rampe ----
  const STEPS = 11, FZ0 = 1.0, FZ1 = 4.0, tread = (FZ1 - FZ0) / STEPS;
  let nF = Math.ceil(h / (STEPS * 0.175)); if (nF % 2 === 0) nF++;
  const rise = h / (nF * STEPS);
  const FA = [2.2, 3.1], FB = [3.2, 4.1];
  for (let f = 0; f < nF; f++) {
    const y0 = f * STEPS * rise, up = f % 2 === 0;               // rampa para: X 2,2…3,1 spre +Z; impara: X 3,2…4,1 spre -Z
    const [x0, x1] = up ? FA : FB;
    for (let k = 0; k < STEPS; k++) {
      const z = up ? FZ0 + (k + 0.5) * tread : FZ1 - (k + 0.5) * tread;
      add(slab, box(x1 - x0, rise + 0.06, tread + 0.02, (x0 + x1) / 2, y0 + (k + 0.5) * rise, z, 0xb9bdc2));
    }
    // vanga inclinata (grinda de otel sub trepte)
    const len = Math.hypot(FZ1 - FZ0, STEPS * rise), ang = Math.atan2(STEPS * rise, FZ1 - FZ0) * (up ? -1 : 1);
    const g = box(0.12, 0.3, len, x0 + (x1 - x0) / 2, 0, 0, STEEL); g.translate(-(x0 + x1) / 2, 0, 0); g.rotateX(ang); g.translate((x0 + x1) / 2, y0 + STEPS * rise / 2 - 0.2, (FZ0 + FZ1) / 2);
    add(steel, g);
    // podest la capatul rampei
    const yl = y0 + STEPS * rise;
    if (f < nF - 1) add(slab, box(FB[1] - FA[0], 0.18, 0.9, (FA[0] + FB[1]) / 2, yl - 0.09, up ? 4.45 : 0.55, CONC));
  }
  // nivelul de sus (cota podului): podest + iesirea liftului, legate de pasarela
  add(slab, box(TW, 0.25, TL - 2.4, TW / 2, h - 0.125, (2.4 + TL) / 2 + 0.0, CONC));
  // perete de sticla pe fata exterioara (spre strada) si pe fata dinspre gara
  add(glass, box(0.03, h + 2.8, TL, TW, (h + 2.8) / 2, TL / 2, 0xffffff));
  add(glass, box(TW, h + 2.8, 0.03, TW / 2, (h + 2.8) / 2, 0, 0xffffff));

  // ---- pasarela (cota trotuarului podului) Z TL…Lf, latime 2,8 m, parapet de sticla + mana curenta ----
  const PX0 = 0.7, PX1 = 3.5, pl = Lf - TL;
  add(slab, box(PX1 - PX0, 0.3, pl, (PX0 + PX1) / 2, h - 0.15, TL + pl / 2, CONC));
  add(slab, box(PX1 - PX0 + 0.3, 0.6, pl, (PX0 + PX1) / 2, h - 0.6, TL + pl / 2, 0xaeb2b6)); // grinda
  for (const px of [PX0, PX1]) {
    add(glass, box(0.03, 1.1, pl, px, h + 0.55, TL + pl / 2, 0xffffff));
    add(steel, box(0.07, 0.07, pl, px, h + 1.12, TL + pl / 2, 0x9aa3ab));
  }
  for (let z = TL + 7; z < Lf - 3; z += 8) {                          // stalpi intermediari pana la teren
    const yb = terr(z) - 0.3;
    add(steel, box(0.35, h - 0.9 - yb, 0.35, (PX0 + PX1) / 2, (h - 0.9 + yb) / 2, z, STEEL));
  }

  // ---- mesh-uri ----
  const group = new THREE.Group();
  group.name = 't1-acces-pod-dn28a';
  const mk = (arr, mat, name, opts) => { const g = merge(arr, opts); if (!g) return null; const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
  const conMat = shared.concreteMat;
  const slabMesh = mk(slab, conMat, 't1-turn-scari-trepte');
  mk(steel, shared.steelPaint, 't1-turn-scari-structura');
  mk(cabin, shared.steelPaint, 't1-lift-cabina');
  const gl = mk(glass, shared.glassMat, 't1-turn-scari-sticla', { color: false });
  if (gl) gl.castShadow = false;
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  mk(glow, glowMat, 't1-turn-scari-led');
  ctx.scene.add(group);
  // podestele / pasarela sunt walkable (modul pieton); index.js le scoate in „Azi” (futureToggles)
  if (slabMesh && ctx.walkables) ctx.walkables.push(slabMesh);

  console.info(`T1: turn de scari + lift la statia Centru (s ${sT0.toFixed(0)}), urcare ${h.toFixed(1)} m, pasarela ${pl.toFixed(1)} m spre trotuarul podului DN28A`);
  return { group, height: h, footway: pl };
}
