import * as THREE from 'three';
import { Batch, Phys, triGeo, panelGeo, instanced } from './builder.js';
import { HALL, addSign, floorLine, GEO, instancedPair } from './kit.js';
import { PASSAGE } from './building.js';

// „Holul Viitorului”: atrium din lemn lamelar si sticla, lipit de fatada vestica a aripii nord.
// Fatada istorica devine peretele interior al holului (se vede prin luminatorul de sus).
const { x0: X0, x1: X1, z0: Z0, z1: Z1, floor: F } = HALL;
const OVER = -24.6; // consola acoperisului spre piata
export const hy = (x) => 6.2 + 3.4 * Math.pow(Math.max(0, (X1 - x) / (X1 - X0)), 0.85);

// usile (aliniate cu montantii)
export const DOORS = {
  west: [-31.66, -26.24],  // z
  north: [-20.23, -16.7],  // x
  south: [-18.17, -14.33], // x
};

export function buildHall(ctx, M, root, atlas, board) {
  const group = new THREE.Group();
  group.name = 'holul-viitorului';
  root.add(group);
  const B = new Batch('hol');
  const P = new Phys('hol');

  // ---------------- pardoseala ----------------
  B.aabb(M.terrazzo, X0, 0, Z0, X1, F, Z1, 4);
  P.floor(X0 - 0.3, Z0, X1, Z1, F);
  // gratarul de la intrare (nervuri gri, nu un dreptunghi negru)
  B.aabb(M.entryMat, X0 - 0.2, F, DOORS.west[0] + 0.4, X0 + 1.6, F + 0.01, DOORS.west[1] - 0.4, 0.5);

  // ---------------- acoperis curb (lemn + sedum) ----------------
  const N = 14;
  const xs = [];
  for (let i = 0; i <= N; i++) xs.push(X1 + ((OVER - X1) * i) / N);
  const quad = (a, b, c, d) => [a, b, c, a, c, d];
  const top = [], under = [], sideN = [], sideS = [], sky = [];
  const SKY = -8.4; // luminator langa fatada istorica
  for (let i = 0; i < N; i++) {
    const xa = xs[i], xb = xs[i + 1];
    const ya = hy(xa), yb = hy(xb);
    if (xb >= SKY) { sky.push(...quad([xa, ya + 0.3, Z0], [xa, ya + 0.3, Z1], [xb, yb + 0.3, Z1], [xb, yb + 0.3, Z0])); continue; }
    const xa2 = Math.min(xa, SKY), ya2 = hy(xa2);
    // ordinea varfurilor => normala in sus (fata cu sedum vizibila de deasupra)
    top.push(...quad([xa2, ya2 + 0.62, Z0], [xb, yb + 0.62, Z0], [xb, yb + 0.62, Z1], [xa2, ya2 + 0.62, Z1]));
    under.push(...quad([xa2, ya2, Z0], [xb, yb, Z0], [xb, yb, Z1], [xa2, ya2, Z1]));
    // fasciile laterale: normala spre exterior (-z la nord, +z la sud)
    sideN.push(...quad([xa2, ya2, Z0 - 0.01], [xb, yb, Z0 - 0.01], [xb, yb + 0.62, Z0 - 0.01], [xa2, ya2 + 0.62, Z0 - 0.01]));
    sideS.push(...quad([xa2, ya2, Z1 + 0.01], [xa2, ya2 + 0.62, Z1 + 0.01], [xb, yb + 0.62, Z1 + 0.01], [xb, yb, Z1 + 0.01]));
  }
  const uvXZ = (tris, s = 2) => tris.map((p) => [p[0] / s, p[2] / s]);
  B.add(M.sedum, triGeo(top, uvXZ(top, 3)));
  B.add(M.slats, triGeo(under, uvXZ(under, 1.2)));
  B.add(M.timber, triGeo(sideN, sideN.map((p) => [p[0] / 2, p[1]])));
  B.add(M.timber, triGeo(sideS, sideS.map((p) => [p[0] / 2, p[1]])));
  B.add(M.glass, triGeo(sky));
  // fascia vestica (lemn) si atic verde
  const yO = hy(OVER);
  B.aabb(M.timber, OVER - 0.12, yO - 0.05, Z0, OVER + 0.05, yO + 0.7, Z1, 1);
  // structura luminatorului
  for (let z = Z0; z <= Z1 + 0.01; z += 2.4) B.box(M.steel, (SKY + X1) / 2, hy((SKY + X1) / 2) + 0.28, z, X1 - SKY + 0.4, 0.08, 0.08, 0, 0);
  // grinda de rezemare pe zidul istoric
  B.aabb(M.timber, X1 - 0.45, hy(X1) - 0.55, Z0, X1, hy(X1) - 0.05, Z1);

  // ---------------- grinzi curbe din lemn lamelar + stalpi ----------------
  const beamZ = [];
  for (let z = Z0 + 1.8; z < Z1; z += 3.6) beamZ.push(z);
  for (const z of beamZ) {
    for (let i = 0; i < N; i++) {
      const xa = xs[i], xb = xs[i + 1];
      const ya = hy(xa) - 0.3, yb = hy(xb) - 0.3;
      const L = Math.hypot(xb - xa, yb - ya);
      B.add(M.timber, new THREE.BoxGeometry(L + 0.02, 0.6, 0.26), (xa + xb) / 2, (ya + yb) / 2, z, 0, 0, Math.atan2(yb - ya, xb - xa));
    }
    const inDoor = z > DOORS.west[0] - 0.3 && z < DOORS.west[1] + 0.3;
    if (!inDoor) B.aabb(M.timber, X0 + 0.05, F, z - 0.17, X0 + 0.4, hy(X0) - 0.3, z + 0.17);
  }

  // ---------------- fatade vitrate ----------------
  // vest (x = X0), usa principala spre piata / T1
  const nW = 20, stepW = (Z1 - Z0) / nW;
  const yTopW = hy(X0);
  for (let i = 0; i < nW; i++) {
    const za = Z0 + i * stepW, zb = za + stepW;
    const door = za >= DOORS.west[0] - 0.01 && zb <= DOORS.west[1] + 0.01;
    const yb = door ? 3.25 : F;
    B.add(M.glass, panelGeo(stepW, yTopW - yb), X0, (yTopW + yb) / 2, (za + zb) / 2, -Math.PI / 2);
    B.aabb(M.timber, X0 - 0.14, F, za - 0.06, X0 + 0.04, yTopW, za + 0.06);
  }
  B.aabb(M.timber, X0 - 0.14, F, Z1 - 0.06, X0 + 0.04, yTopW, Z1 + 0.06);
  B.aabb(M.timber, X0 - 0.16, 3.2, Z0, X0 + 0.04, 3.32, Z1);           // rigla orizontala
  B.aabb(M.timber, X0 - 0.16, 6.3, Z0, X0 + 0.04, 6.4, Z1);
  // usi glisante (deschise) — foile parcate langa gol
  for (const s of [-1, 1]) {
    const z = s < 0 ? DOORS.west[0] - 0.75 : DOORS.west[1] + 0.75;
    B.add(M.glassTint, panelGeo(1.4, 2.8), X0 - 0.25, F + 1.4, z, -Math.PI / 2);
  }
  B.aabb(M.steelWhite, X0 - 0.3, 3.08, DOORS.west[0] - 1.5, X0 - 0.16, 3.2, DOORS.west[1] + 1.5); // caseta usilor glisante
  P.wallAabb(X0 - 0.15, F, Z0, X0 + 0.15, F + 3, DOORS.west[0]);
  P.wallAabb(X0 - 0.15, F, DOORS.west[1], X0 + 0.15, F + 3, Z1);

  // nord (z = Z0) si sud (z = Z1): geam cu marginea superioara dupa curba acoperisului
  const facadeXZ = (z, xa0, xb0, door, side) => {
    const n = 6, st = (xb0 - xa0) / n;
    for (let i = 0; i < n; i++) {
      const xa = xa0 + i * st, xb = xa + st;
      const isDoor = xa >= door[0] - 0.01 && xb <= door[1] + 0.01;
      const yb = isDoor ? 3.25 : F;
      B.add(M.glass, triGeo([[xa, yb, z], [xb, yb, z], [xb, hy(xb), z], [xa, yb, z], [xb, hy(xb), z], [xa, hy(xa), z]]));
      B.aabb(M.timber, xa - 0.06, F, z - 0.1, xa + 0.06, hy(xa), z + 0.1);
    }
    B.aabb(M.timber, xb0 - 0.06, F, z - 0.1, xb0 + 0.06, hy(xb0), z + 0.1);
    B.aabb(M.timber, xa0, 3.2, z - 0.12, xb0, 3.32, z + 0.12);
    B.aabb(M.steelWhite, door[0] - 0.2, 3.08, Math.min(z + side * 0.14, z + side * 0.3), door[1] + 0.2, 3.2, Math.max(z + side * 0.14, z + side * 0.3));
    P.wallAabb(xa0, F, z - 0.15, door[0], F + 3, z + 0.15);
    P.wallAabb(door[1], F, z - 0.15, xb0, F + 3, z + 0.15);
  };
  facadeXZ(Z0, X0, -11.4, DOORS.north, -1);
  facadeXZ(Z1, X0, -10.5, DOORS.south, 1);

  // ---------------- perete digital (tabela de plecari) ----------------
  const boardMat = new THREE.MeshBasicMaterial({ map: board.texture, toneMapped: false });
  boardMat.name = 'tabela';
  B.aabb(M.dark, -21.5, 3.05, Z0 + 0.2, -13.3, 7.45, Z0 + 0.5);
  B.add(boardMat, panelGeo(8, 4), -17.4, 5.25, Z0 + 0.52, 0);
  // a doua tabela, deasupra pasajului spre peroane (spre vest)
  B.aabb(M.dark, X1 - 0.45, 5.0, -30.9, X1 - 0.3, 6.9, -27.1);
  B.add(boardMat, panelGeo(3.6, 1.8), X1 - 0.47, 5.95, -29, -Math.PI / 2);

  // ---------------- automate de bilete ----------------
  const kioskZ = [-45.0, -43.5, -42.0, -40.5];
  for (const z of kioskZ) {
    B.box(M.steelWhite, -21.45, F + 0.95, z, 0.5, 1.9, 0.95);
    B.box(M.dark, -21.18, F + 1.25, z, 0.04, 0.75, 0.62);
    B.add(M.signs, panelGeo(0.6, 0.15, ...atlas.uv.bilete), -21.15, F + 1.25, z, Math.PI / 2);
    B.box(M.dark, -21.2, F + 0.8, z, 0.12, 0.08, 0.4); // fanta card / tichet (la 0.8 m — accesibil)
  }
  addSign(B, M, atlas, 'bilete', -21.0, 3.1, -42.75, Math.PI / 2, 2.2, 0.55, false);
  P.wallAabb(-22, F, -45.6, -21.1, F + 2, -39.9);

  // ---------------- punct de informare (ghiseu coborat PMR) ----------------
  B.aabb(M.steelWhite, -17.4, F, -39.2, -15.4, F + 1.05, -37.6);
  B.aabb(M.steelWhite, -15.4, F, -39.2, -14.4, F + 0.78, -37.6); // ghiseu coborat 78 cm
  B.aabb(M.timber, -17.5, F + 1.05, -39.3, -15.4, F + 1.12, -37.5);
  B.aabb(M.timber, -15.4, F + 0.78, -39.3, -14.3, F + 0.84, -37.5);
  B.box(M.dark, -16.4, F + 1.4, -38.6, 0.6, 0.4, 0.05);
  addSign(B, M, atlas, 'info', -15.9, 3.3, -38.4, 0, 2.0, 0.5);
  addSign(B, M, atlas, 'access', -15.9, 2.65, -38.4, 0, 1.6, 0.4);
  P.wallAabb(-17.5, F, -39.3, -14.3, F + 1.1, -37.5);

  // ---------------- cafenea ----------------
  B.aabb(M.timber, -11.3, F, -46.8, -7.2, F + 1.05, -45.2, 1);
  B.aabb(M.white, -11.4, F + 1.05, -46.9, -7.1, F + 1.12, -45.1);
  B.aabb(M.steelWhite, -11.3, F, -47.85, -6.65, F + 2.2, -47.35);
  B.box(M.dark, -9.8, F + 1.4, -46.4, 0.5, 0.5, 0.45);
  B.box(M.steel, -8.4, F + 1.3, -46.4, 0.35, 0.35, 0.35);
  addSign(B, M, atlas, 'cafe', -9.2, 3.4, -45.6, 0, 2.0, 0.5);
  P.wallAabb(-11.4, F, -47.9, -7.1, F + 1.2, -45.1);
  const tables = [[-12.4, -43.2], [-9.4, -43.2], [-12.4, -40.6], [-9.4, -40.6]];
  for (const [x, z] of tables) {
    B.cyl(M.white, x, F + 0.72, z, 0.45, 0.04, 16);
    B.cyl(M.steel, x, F, z, 0.05, 0.72, 6);
  }
  const stools = [];
  for (const [x, z] of tables) for (const d of [-0.75, 0.75]) stools.push({ x: x + d, y: F, z, ry: d > 0 ? -Math.PI / 2 : Math.PI / 2, s: 0.8 });

  // ---------------- dulapuri pentru bagaje ----------------
  B.aabb(M.steelWhite, X1 - 0.65, F, -24.5, X1 - 0.02, F + 2.2, -19.5);
  for (let z = -24.5; z <= -19.49; z += 0.625) B.aabb(M.dark, X1 - 0.68, F + 0.05, z - 0.015, X1 - 0.64, F + 2.15, z + 0.015);
  for (const y of [0.75, 1.45]) B.aabb(M.dark, X1 - 0.68, F + y - 0.015, -24.5, X1 - 0.64, F + y + 0.015, -19.5);
  addSign(B, M, atlas, 'locker', X1 - 0.12, 3.0, -22, -Math.PI / 2, 2.0, 0.5, false);
  P.wallAabb(X1 - 0.7, F, -24.5, X1, F + 2.2, -19.5);
  // toalete in aripa istorica (usa + semn)
  B.aabb(M.dark, X1 - 0.08, F, -16.6, X1 + 0.02, F + 2.4, -15.2);
  addSign(B, M, atlas, 'wc', X1 - 0.12, 3.0, -15.9, -Math.PI / 2, 2.0, 0.5, false);

  // ---------------- peretele verde + sala de asteptare ----------------
  B.aabb(M.timber, -13.55, F, -24.6, -12.85, F + 0.6, -16.4, 1);
  B.add(M.greenWall, new THREE.BoxGeometry(0.4, 3.8, 8.0), -13.2, F + 0.6 + 1.9, -20.5);
  // re-UV peretele verde (repetare)
  const gw = B.map.get(M.greenWall).at(-1);
  { const uv = gw.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.5); }
  P.wallAabb(-13.55, F, -24.6, -12.85, F + 4.4, -16.4);
  const seats = [];
  for (const z of [-23.2, -20.6, -18.0, -15.4]) for (const x of [-20.0, -16.9]) seats.push({ x, y: F, z, ry: Math.PI });
  instancedPair(group, GEO.seatShells, M.seat, GEO.seatFrame, M.steel, seats, { name: 'scaune-hol' });
  addSign(B, M, atlas, 'sala', -17.6, 3.4, -24.9, 0, 2.2, 0.55);
  // plante in ghivece
  const pots = [[-21.3, -25.2], [-21.3, -12.6], [-12.4, -12.6], [-8.0, -13.4], [-8.0, -25.6], [-21.3, -33.4], [-14.0, -46.9], [-12.3, -25.4]];
  instancedPair(group, GEO.pot, M.concrete, GEO.foliage, M.leaf, pots.map(([x, z], i) => ({ x, y: F, z, ry: i, s: 0.9 + (i % 3) * 0.15 })), { name: 'ghivece-hol' });
  group.add(instanced(GEO.bollard, M.seat, stools.map((s) => ({ ...s, sx: 2.2, sz: 2.2, sy: 0.8 })), { name: 'scaune-cafenea' }));

  // ---------------- orientare: semne suspendate ----------------
  const hubX = -17.0;
  const hangY = 3.6;
  addSign(B, M, atlas, 'pasarela', hubX, hangY, -32.9, -Math.PI / 2, 2.2, 0.55);
  addSign(B, M, atlas, 'peroane', hubX, hangY, -30.5, -Math.PI / 2, 2.2, 0.55);
  addSign(B, M, atlas, 't1', hubX, hangY, -28.1, -Math.PI / 2, 2.2, 0.55);
  addSign(B, M, atlas, 'bus', hubX, hangY, -25.7, -Math.PI / 2, 2.2, 0.55);
  B.aabb(M.steel, hubX - 0.03, hangY + 0.3, -34.2, hubX + 0.03, hangY + 0.36, -24.4);
  for (const z of [-34, -24.6]) B.aabb(M.steel, hubX - 0.015, hangY + 0.3, z - 0.015, hubX + 0.015, hy(hubX) - 0.1, z + 0.015);
  addSign(B, M, atlas, 'peroane', X1 - 0.12, 5.4 - 0.9, -26.3, -Math.PI / 2, 1.6, 0.4, false);
  addSign(B, M, atlas, 'bus', -16.25, 3.6, Z1 - 0.4, Math.PI, 2.0, 0.5, false);
  // iesiri de urgenta (verzi, luminoase)
  const exitMat = M.exitGlow;
  B.box(exitMat, X0 + 0.25, 3.5, -28.95, 0.06, 0.25, 0.6);
  B.box(exitMat, -18.45, 3.5, Z0 + 0.65, 0.6, 0.25, 0.06);
  B.box(exitMat, -16.25, 3.5, Z1 - 0.2, 0.6, 0.25, 0.06);
  B.box(exitMat, X1 - 0.1, 5.1, -29, 0.06, 0.25, 0.6);

  // ---------------- iluminat LED inteligent (lampi liniare suspendate) ----------------
  for (const z of beamZ) {
    for (let i = 1; i < N - 2; i++) {
      const xa = xs[i], xb = xs[i + 1];
      if (xa < X0 + 0.8) continue;
      const ya = hy(xa) - 1.6, yb = hy(xb) - 1.6;
      const L = Math.hypot(xb - xa, yb - ya);
      B.add(M.ledCool, new THREE.BoxGeometry(L, 0.06, 0.1), (xa + xb) / 2, (ya + yb) / 2, z + 0.5, 0, 0, Math.atan2(yb - ya, xb - xa));
    }
  }

  // ---------------- linii LED de orientare in pardoseala ----------------
  // verde -> peroane CFR ; portocaliu -> tren usor T1 ; albastru -> autobuze ; mov -> pasarela
  const zG = -28.3, zO = -28.75, zB = -29.2, zP = -29.65;
  floorLine(B, M.ledGreen, [[-29.6, zG], [X1, zG], [PASSAGE.x1 + 0.6, zG], [12.2, zG], [12.2, -50.6]], 0.13);
  // portocaliu: prin pasaj pe peronul 1, apoi spre sud de-a lungul peronului pana la statia T1 (fata de vest, z 66 … 116)
  floorLine(B, M.ledOrange, [[X1 - 0.2, zO], [PASSAGE.x1 + 0.6, zO], [12.9, zO], [12.9, 62.5], [11.1, 64.5], [11.1, 116]], 0.13);
  floorLine(B, M.ledBlue, [[X1 - 0.2, zB], [-14.8, zB], [-14.8, -9.5], [-19.2, 8.5]], 0.13);
  floorLine(B, M.ledPurple, [[X1 - 0.2, zP], [-19.0, zP], [-19.0, -48.6], [-17.7, -50.3]], 0.13);
  // banda tactila de ghidaj (galben) intrare -> info -> pasaj -> peronul 1 -> lift
  const zT = -30.6;
  floorLine(B, M.guide, [[-29.4, zT], [-17.9, zT], [-17.9, -36.9]], 0.4, 0.008, 0.016);
  floorLine(B, M.guide, [[-17.9, zT], [X1, zT], [PASSAGE.x1, zT], [11.2, zT], [11.2, -74.4], [13.0, -74.4]], 0.4, 0.008, 0.016);
  // dale de avertizare (buline) in punctele de decizie
  for (const [x, z] of [[-17.9, zT], [-22.6, zT], [X1 + 0.6, zT], [11.2, zT], [-17.9, -37.0]]) floorLine(B, M.tactile, [[x - 0.4, z], [x + 0.4, z]], 0.8, 0.01, 0.018);

  const meshes = B.build(group);
  const phys = P.build(group);

  // lumina calda interioara (doar noaptea)
  const light = new THREE.PointLight(0xffe2b8, 0, 34, 1.6);
  light.position.set(-15, 5.2, -30);
  group.add(light);

  return {
    group, meshes, phys,
    setNight(n) { light.intensity = n * 60; light.visible = n > 0.05; },
  };
}
