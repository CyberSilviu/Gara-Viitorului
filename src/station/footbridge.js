import * as THREE from 'three';
import { Batch, Phys, panelGeo, invisibleBox, invisibleFloor } from './builder.js';
import { PLAT_Y } from './frame.js';
import { PAVE_Y, addSign } from './kit.js';

// Pasarela pietonala peste toate liniile (cota de mers 8.6 m, peste catenaria de 25 kV),
// vitrata, cu scari + lifturi panoramice spre fiecare peron si spre ambele capete (oras / Electroputere).
export const DECK = { y: 8.6, z0: -70.6, z1: -65.4, x0: -19.4, x1: 65.2 };
const RISE_STEP = 0.17, GOING = 0.29;

// scari (spre sud, de la marginea pasarelei) si lifturi
export const STAIRS = [
  { id: 'W', x0: -19.2, x1: -16.2, yBot: PAVE_Y, label: 'Piața Gării' },
  { id: 'P1', x0: 12.6, x1: 15.2, yBot: PLAT_Y, label: 'Peronul 1' },
  { id: 'P2', x0: 28.85, x1: 30.65, yBot: PLAT_Y, label: 'Peronul 2' },
  { id: 'P3', x0: 42.0, x1: 43.8, yBot: PLAT_Y, label: 'Peronul 3' },
  { id: 'E', x0: 61.6, x1: 64.6, yBot: PAVE_Y, label: 'Electroputere' },
];
// lift: side = +1 => putul e la sud de pasarela (iesire jos spre sud); -1 => la nord (iesire jos spre nord)
export const LIFTS = [
  { id: 'W', x0: -15.2, x1: -13.2, side: 1, yBot: PAVE_Y },
  { id: 'P1', x0: 12.0, x1: 14.0, side: -1, yBot: PLAT_Y },
  { id: 'P2', x0: 28.75, x1: 30.75, side: -1, yBot: PLAT_Y },
  { id: 'P3', x0: 41.9, x1: 43.9, side: -1, yBot: PLAT_Y },
  { id: 'E', x0: 59.2, x1: 61.2, side: 1, yBot: PAVE_Y },
];
const SHAFT_D = 2.4;

export function buildFootbridge(ctx, M, root, atlas) {
  const group = new THREE.Group();
  group.name = 'pasarela';
  root.add(group);
  const B = new Batch('pasarela');
  const P = new Phys('pasarela');
  const { y: DY, z0: Z0, z1: Z1, x0: X0, x1: X1 } = DECK;
  const ZC = (Z0 + Z1) / 2;

  // ---------------- tablier, grinzi cu zabrele, acoperis PV ----------------
  B.aabb(M.concrete, X0, DY - 0.62, Z0, X1, DY - 0.05, Z1);
  B.aabb(M.terrazzo, X0, DY - 0.05, Z0 + 0.15, X1, DY, Z1 - 0.15, 3);
  P.floor(X0, Z0, X1, Z1, DY); // pe toata latimea: fara fanta intre cabina liftului si pasarela
  const TOP = DY + 3.1;
  for (const z of [Z0 + 0.1, Z1 - 0.1]) {
    B.aabb(M.steelWhite, X0, DY - 0.75, z - 0.15, X1, DY - 0.35, z + 0.15);    // talpa inferioara
    B.aabb(M.steelWhite, X0, TOP, z - 0.15, X1, TOP + 0.3, z + 0.15);          // talpa superioara
    const n = Math.round((X1 - X0) / 4.2);
    const st = (X1 - X0) / n;
    for (let i = 0; i <= n; i++) {
      const x = X0 + i * st;
      B.aabb(M.steelWhite, x - 0.1, DY - 0.4, z - 0.1, x + 0.1, TOP, z + 0.1);
      if (i < n) {
        const L = Math.hypot(st, TOP - DY + 0.4);
        const a = Math.atan2(TOP - DY + 0.4, st) * (i % 2 ? 1 : -1);
        B.add(M.steelWhite, new THREE.BoxGeometry(L, 0.12, 0.12), x + st / 2, (TOP + DY - 0.4) / 2, z, 0, 0, a);
      }
    }
  }
  // acoperis: placa + panouri fotovoltaice + streasina cu LED
  B.aabb(M.steelWhite, X0 - 0.4, TOP + 0.3, Z0 - 0.6, X1 + 0.4, TOP + 0.5, Z1 + 0.6);
  B.add(M.pv, panelGeo(X1 - X0 + 0.6, Z1 - Z0 + 1.0, 0, 0, (X1 - X0) / 1.7, (Z1 - Z0 + 1) / 1.0), (X0 + X1) / 2, TOP + 0.52, ZC, 0, -Math.PI / 2);
  B.aabb(M.ledCool, X0, TOP - 0.05, Z0 + 0.35, X1, TOP, Z0 + 0.45);
  B.aabb(M.ledCool, X0, TOP - 0.05, Z1 - 0.45, X1, TOP, Z1 - 0.35);
  // linie LED mov pe mijlocul pasarelei
  B.aabb(M.ledPurple, X0 + 0.5, DY + 0.002, ZC - 0.07, X1 - 0.5, DY + 0.016, ZC + 0.07);

  // ---------------- pereti vitrati (cu goluri pentru scari si lifturi) ----------------
  const openS = [...STAIRS.map((s) => [s.x0, s.x1]), ...LIFTS.filter((l) => l.side > 0).map((l) => [l.x0, l.x1])].sort((a, b) => a[0] - b[0]);
  const openN = LIFTS.filter((l) => l.side < 0).map((l) => [l.x0, l.x1]).sort((a, b) => a[0] - b[0]);
  const wallRuns = (opens) => {
    const runs = []; let x = X0;
    for (const [a, b] of opens) { if (a > x) runs.push([x, a]); x = Math.max(x, b); }
    if (x < X1) runs.push([x, X1]);
    return runs;
  };
  for (const [z, opens] of [[Z0 + 0.12, openN], [Z1 - 0.12, openS]]) {
    for (const [a, b] of wallRuns(opens)) {
      B.add(M.glass, panelGeo(b - a, TOP - DY), (a + b) / 2, (TOP + DY) / 2, z, 0);
      B.aabb(M.steel, a, DY + 1.0, z - 0.04, b, DY + 1.06, z + 0.04); // mana curenta
      P.wallAabb(a, DY - 0.2, z - 0.12, b, DY + 2.6, z + 0.12);
    }
    for (const [a, b] of opens) B.aabb(M.steelWhite, a - 0.05, DY + 2.4, z - 0.1, b + 0.05, TOP, z + 0.1);
  }
  // capete vitrate
  for (const x of [X0 + 0.1, X1 - 0.1]) {
    B.add(M.glass, panelGeo(Z1 - Z0, TOP - DY), x, (TOP + DY) / 2, ZC, Math.PI / 2);
    P.wallAabb(x - 0.12, DY - 0.2, Z0, x + 0.12, DY + 2.6, Z1);
  }

  // ---------------- stalpi (fara stalpi intre linii: reazeme pe peroane) ----------------
  for (const x of [X0 + 0.6, X1 - 0.6]) for (const z of [Z0 + 0.5, Z1 - 0.5]) B.aabb(M.steelWhite, x - 0.3, 0, z - 0.3, x + 0.3, DY - 0.6, z + 0.3);
  for (const [x, y0, twin] of [[16.4, PLAT_Y, true], [29.75, PLAT_Y, false], [42.9, PLAT_Y, false]]) {
    const zs = twin ? [Z0 + 0.5, Z1 - 0.5] : [ZC];
    for (const z of zs) { B.aabb(M.steelWhite, x - 0.3, y0, z - 0.3, x + 0.3, DY - 0.6, z + 0.3); P.wallAabb(x - 0.3, y0, z - 0.3, x + 0.3, y0 + 2.5, z + 0.3); }
    if (!twin) B.aabb(M.steelWhite, x - 0.35, DY - 1.1, Z0, x + 0.35, DY - 0.6, Z1);
  }

  // ---------------- scari ----------------
  for (const s of STAIRS) {
    const rise = DY - s.yBot;
    const half = rise / 2;
    const n = Math.round(half / RISE_STEP);
    const h = half / n, run = n * GOING;
    const W = s.x1 - s.x0, xc = (s.x0 + s.x1) / 2;
    let z = Z1, y = DY;
    const flights = [];
    for (let f = 0; f < 2; f++) {
      for (let k = 0; k < n; k++) {
        const zt = z + k * GOING, yt = y - k * h;
        B.aabb(M.concrete, s.x0, yt - h - 0.14, zt, s.x1, yt - h, zt + GOING);
        B.aabb(M.terrazzo, s.x0, yt - h, zt, s.x1, yt - h + 0.02, zt + GOING);
        B.aabb(M.tactile, s.x0 + 0.05, yt - h + 0.02, zt, s.x1 - 0.05, yt - h + 0.025, zt + 0.05); // nas de treapta contrastant
      }
      flights.push([z, y, z + run, y - half]);
      P.ramp(xc, z - 0.05, y, xc, z + run, y - half, W);
      z += run; y -= half;
      if (f === 0) {
        B.aabb(M.concrete, s.x0, y - 0.3, z, s.x1, y, z + 1.6);
        P.floor(s.x0, z, s.x1, z + 1.6, y);
        z += 1.6;
      }
    }
    const zEnd = z;
    // vanguri laterale + parapet din sticla + mana curenta
    for (const xs of [s.x0 - 0.06, s.x1 + 0.06]) {
      for (const [za, ya, zb, yb] of flights) {
        const L = Math.hypot(zb - za, yb - ya), a = Math.atan2(ya - yb, zb - za);
        B.add(M.steelWhite, new THREE.BoxGeometry(0.12, 0.4, L), xs, (ya + yb) / 2 - 0.25, (za + zb) / 2, 0, a);
        B.add(M.glass, new THREE.BoxGeometry(0.02, 1.0, L), xs, (ya + yb) / 2 + 0.5, (za + zb) / 2, 0, a);
        B.add(M.steel, new THREE.BoxGeometry(0.06, 0.06, L), xs, (ya + yb) / 2 + 1.0, (za + zb) / 2, 0, a);
      }
      P.wallAabb(xs - 0.08, s.yBot, Z1, xs + 0.08, DY + 1.2, zEnd);
    }
    // perete sub capatul de sus (nu se poate intra sub scara din spate)
    P.wallAabb(s.x0, s.yBot, Z1 - 0.15, s.x1, DY - 0.7, Z1 + 0.15);
    B.aabb(M.steelWhite, s.x0 - 0.1, s.yBot, Z1 - 0.15, s.x1 + 0.1, DY - 0.62, Z1 + 0.05);
  }

  // ---------------- semne pe pasarela ----------------
  const sy = DY + 2.55;
  addSign(B, M, atlas, 'p1', 13.9, sy, ZC, -Math.PI / 2, 1.9, 0.48);
  addSign(B, M, atlas, 'p2', 29.75, sy, ZC, -Math.PI / 2, 1.9, 0.48);
  addSign(B, M, atlas, 'p3', 42.9, sy, ZC, -Math.PI / 2, 1.9, 0.48);
  addSign(B, M, atlas, 'iesireE', 56.0, sy, ZC, -Math.PI / 2, 1.9, 0.48);
  addSign(B, M, atlas, 'iesireV', -6.0, sy, ZC, Math.PI / 2, 1.9, 0.48);
  addSign(B, M, atlas, 'cctv', 3.0, sy, ZC, -Math.PI / 2, 1.9, 0.48);
  for (const l of LIFTS) addSign(B, M, atlas, 'lift', (l.x0 + l.x1) / 2, DY + 2.75, l.side > 0 ? Z1 - 0.2 : Z0 + 0.2, l.side > 0 ? Math.PI : 0, 1.4, 0.35, false);
  // camere CCTV pe pasarela
  for (const x of [-12, 8, 24, 38, 52]) B.box(M.dark, x, TOP - 0.25, ZC, 0.14, 0.14, 0.34);

  // ---------------- lifturi panoramice ----------------
  const lifts = [];
  for (const l of LIFTS) {
    const zs0 = l.side > 0 ? Z1 : Z0 - SHAFT_D, zs1 = l.side > 0 ? Z1 + SHAFT_D : Z0;
    const deckFace = l.side > 0 ? zs0 : zs1;   // fata spre pasarela (golul de sus)
    const farFace = l.side > 0 ? zs1 : zs0;    // fata opusa (golul de jos)
    const xc = (l.x0 + l.x1) / 2, zc = (zs0 + zs1) / 2;
    const yTopS = TOP + 0.4;
    // stalpi de colt + panouri de sticla
    for (const x of [l.x0, l.x1]) for (const z of [zs0, zs1]) B.aabb(M.steelWhite, x - 0.08, l.yBot, z - 0.08, x + 0.08, yTopS, z + 0.08);
    for (const x of [l.x0, l.x1]) B.add(M.glass, panelGeo(SHAFT_D, yTopS - l.yBot), x, (yTopS + l.yBot) / 2, zc, Math.PI / 2);
    B.add(M.glass, panelGeo(l.x1 - l.x0, DY - 0.62 - l.yBot), xc, (DY - 0.62 + l.yBot) / 2, deckFace, 0);
    B.add(M.glass, panelGeo(l.x1 - l.x0, yTopS - (l.yBot + 2.5)), xc, (yTopS + l.yBot + 2.5) / 2, farFace, 0);
    B.aabb(M.steelWhite, l.x0 - 0.1, yTopS, zs0 - 0.1, l.x1 + 0.1, yTopS + 0.4, zs1 + 0.1);
    B.aabb(M.concrete, l.x0, l.yBot - 0.3, zs0, l.x1, l.yBot - 0.02, zs1);
    // coliziuni permanente
    P.wallAabb(l.x0 - 0.1, l.yBot, zs0, l.x0 + 0.1, yTopS, zs1);
    P.wallAabb(l.x1 - 0.1, l.yBot, zs0, l.x1 + 0.1, yTopS, zs1);
    P.wallAabb(l.x0, l.yBot, deckFace - 0.1, l.x1, DY - 0.7, deckFace + 0.1);
    P.wallAabb(l.x0, DY - 0.3, farFace - 0.1, l.x1, yTopS, farFace + 0.1);
    // cabina animata
    const cab = new THREE.Group();
    const CB = new Batch('cabina');
    const w = l.x1 - l.x0 - 0.3, d = SHAFT_D - 0.3;
    CB.box(M.steel, 0, -0.08, 0, w, 0.16, d);
    CB.box(M.steelWhite, 0, 2.35, 0, w, 0.12, d);
    for (const sx of [-1, 1]) {
      CB.add(M.glassTint, panelGeo(d, 2.2), (sx * w) / 2, 1.15, 0, Math.PI / 2);
      CB.box(M.steel, (sx * w) / 2, 1.0, 0, 0.05, 0.05, d);
    }
    CB.box(M.ledCool, 0, 2.27, 0, w * 0.6, 0.03, 0.3);
    CB.build(cab, { cast: false });
    // podeaua cabinei acopera tot putul (+10 cm) => nu ramane fanta spre peron la iesirea din lift
    const floor = invisibleFloor(w, SHAFT_D + 0.2);
    cab.add(floor);
    cab.position.set(xc, l.yBot, zc);
    group.add(cab);
    // porti (blocheaza golul cand cabina nu e la nivelul respectiv)
    const gateTop = invisibleBox(l.x1 - l.x0, 2.6, 0.2);
    gateTop.position.set(xc, DY + 1.3, deckFace);
    const gateBot = invisibleBox(l.x1 - l.x0, 2.6, 0.2);
    gateBot.position.set(xc, l.yBot + 1.3, farFace);
    group.add(gateTop, gateBot);
    lifts.push({ ...l, cab, floor, gateTop, gateBot, phase: (lifts.length * 5.3) % 22 });
  }

  const meshes = B.build(group);
  const phys = P.build(group);

  // animatia lifturilor: asteapta jos 5 s, urca 1 m/s, asteapta sus 5 s, coboara
  function update(dt, t) {
    for (const l of lifts) {
      const H = DY - l.yBot, travel = H / 1.0, wait = 5;
      const T = 2 * (travel + wait);
      const u = (t + l.phase) % T;
      let y;
      if (u < wait) y = 0;
      else if (u < wait + travel) y = THREE.MathUtils.smoothstep(u - wait, 0, travel) * H;
      else if (u < 2 * wait + travel) y = H;
      else y = (1 - THREE.MathUtils.smoothstep(u - 2 * wait - travel, 0, travel)) * H;
      l.cab.position.y = l.yBot + y;
      l.gateTop.position.y = y > H - 0.02 ? -500 : DY + 1.3;
      l.gateBot.position.y = y < 0.02 ? -500 : l.yBot + 1.3;
    }
  }
  const dynamicColliders = lifts.flatMap((l) => [l.gateTop, l.gateBot]);
  const dynamicWalkables = lifts.map((l) => l.floor);
  return { group, meshes, phys, update, dynamicColliders, dynamicWalkables, lifts };
}
