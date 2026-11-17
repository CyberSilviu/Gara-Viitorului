import * as THREE from 'three';
import { Batch, Phys, panelGeo, instanced, compose } from './builder.js';
import { PAVE_Y, addSign, GEO, instancedPair, floorLine } from './kit.js';
import { addCars, BUS } from './vehicles.js';

// Piata garii (vest), autogara, kiss & ride, biciclete, statii EV, colectare selectiva, gradini de ploaie,
// tehnica verde (rezervor de apa pluviala, pompe de caldura geotermale) si piateta de est cu stocarea de energie.
// Fasia x = -42 … -30 (fosta rezerva T1) = bretelele autobuzelor + fasie verde; T1 opreste pe fata de vest a peronului 1.
export const ZONES = {
  forecourt: [-30, -112, -5, 60],
  westN: [-63, -30, -49.5, -5.5],
  westS: [-63, 3.5, -49.5, 47.5], // la sud de z ≈ 48 incep blocurile cu parter comercial (OSM 1349190811)
  east: [58.5, -84, 87, -40],   // intre linia de garaj OSM (x ≈ 56, balast pana la 58) si linia industriala de la x ≈ 89
  bikeShelter: [-21, -103, -9, -97.5],
  busIsland: [-20.2, 10, -15.6, 54],
  battery: [70, -57.6, 82.4, -50.8],
  busLane: [-29.6, 6, -23.4, 60],
  taxiLane: [-29.6, -112, -23.4, -73],
};
// gradini de ploaie [x0, z0, x1, z1] (sistemul local): bordura +0,2 m, apa in mijloc. Nimic nu se aseaza in ele.
export const RAIN_GARDENS = [[-58.4, 9, -54.6, 18], [-58.4, 24, -54.6, 33], [-58.4, 38, -54.6, 46.5], [-58.4, -24, -54.6, -14], [-26.8, -8, -23.2, 4]];

export function buildPlaza(ctx, M, root, atlas, totemTex, boardTex = null) {
  const future = new THREE.Group(); future.name = 'piata-viitor';
  const today = new THREE.Group(); today.name = 'piata-azi';
  const shared = new THREE.Group(); shared.name = 'piata-comun';
  root.add(future, today, shared);
  const B = new Batch('piata');
  const T = new Batch('piata-azi');
  const S = new Batch('piata-comun');
  const P = new Phys('piata');
  const PS = new Phys('piata-comun');
  const Y = PAVE_Y;
  let pvArea = 0;

  // ---------------- pavaje / suprafete ----------------
  const [fx0, fz0, fx1, fz1] = ZONES.forecourt;
  B.hquad(M.paving, fx0, fz0, fx1, fz1, Y, 1.6);
  T.hquad(M.asphalt, fx0, fz0, fx1, fz1, Y, 4);
  PS.floor(fx0, fz0, fx1, fz1, Y);
  for (const k of ['westN', 'westS', 'east']) {
    const [a, b, c, d] = ZONES[k];
    B.hquad(M.paving, a, b, c, d, Y, 1.6);
    P.floor(a, b, c, d, Y);
  }
  // azi: parcare cu marcaje
  for (let z = -100; z < 50; z += 2.6) {
    if (z > -50 && z < -10) continue;
    T.aabb(M.white, -24.2, Y, z, -18.8, Y + 0.025, z + 0.12);
  }
  const cars = [];
  const carCols = [0x9aa4ae, 0x7a1f1f, 0x1f3a5a, 0xe5e7eb, 0x2f2f2f];
  [-96, -91, -83, -75, -69, 9, 18, 24, 31, 36].forEach((z, i) => cars.push({ x: -20.8, y: Y, z: z + 1.3, ry: Math.PI / 2 + (i % 2) * Math.PI, color: carCols[i % carCols.length] }));
  addCars(today, M, cars, 'masini-parcate');
  const oldLamps = [];
  for (let z = -100; z < 40; z += 24) oldLamps.push({ x: -28.5, y: Y, z, ry: Math.PI / 2 });
  instancedPair(today, GEO.lampPole, M.dark, GEO.lampHead, M.lamp, oldLamps, { name: 'stalpi-azi' });

  // ---------------- benzi carosabile (bus / taxi) in viitor ----------------
  // benzile carosabile stau la 2 cm peste pavaj, marcajele la 3,5 cm => fara „z-fighting” din vederea aeriana
  for (const k of ['busLane', 'taxiLane']) { const [a, b, c, d] = ZONES[k]; B.hquad(M.asphalt, a, b, c, d, Y + 0.02, 4); } // banda autobuze / kiss & ride + taxi
  for (const [z0, z1] of [[6, 60], [-112, -73]]) {
    for (let z = z0; z < z1; z += 4) B.aabb(M.white, -26.55, Y + 0.02, z, -26.45, Y + 0.035, z + 2);
    B.aabb(M.concrete, -23.4, Y, z0, -23.2, Y + 0.14, z1); // bordura
  }
  // marcaje "BUS" / "TAXI" (dungi)
  for (const z of [14, 30, 46]) B.aabb(M.binPlastic, -28.8, Y + 0.02, z - 1.8, -24.2, Y + 0.035, z - 1.6);

  // ---------------- autogara: insula de asteptare cu copertina fotovoltaica ----------------
  const [bx0, bz0, bx1, bz1] = ZONES.busIsland;
  B.aabb(M.concrete, bx0, Y, bz0, bx1, Y + 0.16, bz1);
  B.hquad(M.platform, bx0, bz0, bx1, bz1, Y + 0.161, 2);
  P.floor(bx0, bz0, bx1, bz1, Y + 0.16);
  B.aabb(M.tactile, bx0, Y + 0.16, bz0, bx0 + 0.4, Y + 0.18, bz1);
  const cy = Y + 3.6;
  B.aabb(M.steelWhite, bx0 - 0.4, cy, bz0 + 1, bx1 + 0.2, cy + 0.25, bz1 - 1);
  B.add(M.pv, panelGeo(bx1 - bx0 + 0.6, bz1 - bz0 - 2, 0, 0, 4, 24), (bx0 + bx1) / 2 - 0.1, cy + 0.27, (bz0 + bz1) / 2, 0, -Math.PI / 2);
  pvArea += (bx1 - bx0 + 0.6) * (bz1 - bz0 - 2);
  for (let z = bz0 + 3; z < bz1 - 2; z += 8) B.aabb(M.steelWhite, bx1 - 0.6, Y, z - 0.12, bx1 - 0.36, cy, z + 0.12);
  B.aabb(M.ledCool, bx0 - 0.3, cy - 0.04, bz0 + 1, bx0 - 0.15, cy, bz1 - 1);
  const busSeats = [];
  for (let z = bz0 + 5; z < bz1 - 4; z += 8) busSeats.push({ x: bx1 - 1.2, y: Y + 0.16, z, ry: -Math.PI / 2 });
  instancedPair(future, GEO.seatShells, M.seat, GEO.seatFrame, M.steel, busSeats, { name: 'scaune-autogara' });
  addSign(B, M, atlas, 'bus', (bx0 + bx1) / 2, cy - 0.5, bz0 + 1.4, 0, 2.2, 0.55);
  // ecrane de plecari pe insula (aceeasi tabela ca in hol: trenuri CFR + T1), cu doua fete
  const scrMat = boardTex ? new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }) : M.screenOff;
  scrMat.name = scrMat.name || 'ecran-autogara';
  for (const z of [18, 34]) {
    const ex = (bx0 + bx1) / 2;
    B.aabb(M.dark, ex - 0.6, Y + 2.2, z - 0.05, ex + 0.6, Y + 2.8, z + 0.05);
    B.add(scrMat, panelGeo(1.1, 0.55), ex, Y + 2.5, z + 0.056, 0);
    B.add(scrMat, panelGeo(1.1, 0.55), ex, Y + 2.5, z - 0.056, Math.PI);
    B.aabb(M.steel, ex - 0.03, Y + 2.8, z - 0.03, ex + 0.03, Y + 3.6, z + 0.03);
  }
  // autobuzele electrice circula pe un circuit real (vezi buses.js); aici doar punctul de oprire (usile spre insula)
  const busX = -23.4 - 0.15 - BUS.W / 2;
  const buses = [{ x: busX, y: Y + 0.02, z: 22, ry: Math.PI, line: 0 }, { x: busX, y: Y + 0.02, z: 40, ry: Math.PI, line: 1 }];

  // ---------------- fosta fasie T1 (x -42 … -30): bretele bus + fasie verde ----------------
  // T1 pleaca acum de pe fata de vest a peronului 1 (sud de cladire); fasia din fata holului devine:
  //  · breteaua de iesire a autobuzelor spre Str. Garii / Str. Ceferistilor (z ≈ 1 … 11)
  //  · breteaua de intrare dinspre Str. Garii (z ≈ 57 … 67)
  //  · gazon cu arbori, iar in dreptul usii holului (z -35 … -23) pavaj pietonal spre trecerea de pietoni
  for (const [z0, z1] of [[1, 11], [57, 67]]) {
    B.hquad(M.asphalt, -42, z0, -29.6, z1, Y + 0.02, 4);
    for (let x = -41; x < -30.5; x += 3) B.aabb(M.white, x, Y + 0.02, (z0 + z1) / 2 - 0.06, x + 1.5, Y + 0.035, (z0 + z1) / 2 + 0.06);
  }
  B.hquad(M.paving, -42, -35, -30, -23, Y, 1.6);
  P.floor(-42, -35, -30, -23, Y);
  const verge = [[-112, -35], [-23, 1], [11, 57]];
  for (const [z0, z1] of verge) {
    B.aabb(M.concrete, -41.8, Y - 0.05, z0 + 0.2, -30.2, Y + 0.12, z1 - 0.2);
    B.hquad(M.grass, -41.6, z0 + 0.4, -30.4, z1 - 0.4, Y + 0.125, 2);
  }
  // ---------------- kiss & ride, taxi, statii de incarcare EV ----------------
  const evs = [];
  for (const z of [-108, -103, -98, -93]) evs.push({ x: -22.8, y: Y, z, ry: -Math.PI / 2 });
  const ev = instanced(GEO.evCharger, M.white, evs, { name: 'statii-ev' });
  future.add(ev);
  for (const e of evs) B.aabb(M.ledGreen, e.x - 0.16, Y + 1.2, e.z - 0.12, e.x - 0.14, Y + 1.45, e.z + 0.12);
  for (let z = -110; z < -91; z += 5) B.aabb(M.ledGreen, -28.9, Y + 0.02, z, -24.1, Y + 0.035, z + 0.1);
  addSign(B, M, atlas, 'ev', -22.8, 2.8, -100.5, -Math.PI / 2, 2.0, 0.5);
  addSign(B, M, atlas, 'taxi', -22.8, 2.8, -82, -Math.PI / 2, 2.0, 0.5);
  B.aabb(M.steel, -22.83, Y, -82.03, -22.77, 2.55, -81.97);
  B.aabb(M.steel, -22.83, Y, -100.53, -22.77, 2.55, -100.47);
  // doua masini electrice la incarcat (langa bordura cu statiile) si un taxi in statia de taxi
  const evCars = [
    { x: -24.6, y: Y + 0.02, z: -106, ry: Math.PI, color: 0xe5e7eb },
    { x: -24.6, y: Y + 0.02, z: -96, ry: Math.PI, color: 0x1f6f8b },
    { x: -24.6, y: Y + 0.02, z: -84, ry: Math.PI, color: 0xfacc15, taxi: true },
  ];
  addCars(future, M, evCars, 'masini-ev-taxi');

  // ---------------- parcare securizata pentru biciclete (acoperis PV) ----------------
  const [sx0, sz0, sx1, sz1] = ZONES.bikeShelter;
  B.aabb(M.steelWhite, sx0 - 0.3, 2.9, sz0 - 0.4, sx1 + 0.3, 3.1, sz1 + 0.4);
  B.add(M.pv, panelGeo(sx1 - sx0 + 0.6, sz1 - sz0 + 0.8, 0, 0, 7, 4), (sx0 + sx1) / 2, 3.12, (sz0 + sz1) / 2, 0, -Math.PI / 2);
  pvArea += (sx1 - sx0 + 0.6) * (sz1 - sz0 + 0.8);
  for (const x of [sx0, sx1]) for (const z of [sz0, sz1]) B.aabb(M.steel, x - 0.06, Y, z - 0.06, x + 0.06, 2.9, z + 0.06);
  B.add(M.glass, panelGeo(sx1 - sx0, 2.4), (sx0 + sx1) / 2, Y + 1.2, sz0, 0);
  B.add(M.glass, panelGeo(sz1 - sz0, 2.4), sx0, Y + 1.2, (sz0 + sz1) / 2, Math.PI / 2);
  B.add(M.glass, panelGeo(sz1 - sz0, 2.4), sx1, Y + 1.2, (sz0 + sz1) / 2, Math.PI / 2);
  P.wallAabb(sx0, Y, sz0 - 0.1, sx1, Y + 2.4, sz0 + 0.1);
  addSign(B, M, atlas, 'bike', (sx0 + sx1) / 2, 2.55, sz1 + 0.35, 0, 2.2, 0.55);
  const bikes = [];
  for (let x = sx0 + 0.8; x < sx1 - 0.5; x += 0.75) bikes.push({ x, y: Y, z: sz0 + 1.5, ry: 0 }, { x: x + 0.35, y: Y, z: sz0 + 3.6, ry: Math.PI });

  // ---------------- piata verde (vest): arbori, gradini de ploaie, banci, bike-sharing ----------------
  const trees = [];
  for (const x of [-60.5, -52.5]) for (let z = -26; z < 47; z += 8.5) if (z > 4 || z < -8) trees.push({ x: x + ((z * 7) % 3) * 0.3, y: Y, z, ry: z, s: 0.85 + ((z * 13) % 5) * 0.06 });
  for (const z of [-104, -94, -84]) trees.push({ x: -6.5, y: Y, z, ry: z, s: 0.8 });
  for (const [x, z] of [[85, -80], [85, -70], [85, -61], [85, -45], [75, -80], [62, -80]]) trees.push({ x, y: Y, z, ry: x + z, s: 0.9 });
  // doi arbori langa insula autogarii (in afara benzii de autobuze)
  for (const [x, z] of [[-21, 7], [-21.8, 58]]) trees.push({ x, y: Y, z, ry: z, s: 0.7 });
  // fasia verde din fosta zona T1 (fara arbori pe bretelele autobuzelor)
  for (const [z0, z1] of verge) for (let z = z0 + 5; z < z1 - 3; z += 9) trees.push({ x: -36 + ((z * 5) % 3) - 1, y: Y + 0.12, z, ry: z * 1.3, s: 0.75 + ((z * 11) % 4) * 0.05 });
  const treeMeshes = instancedPair(future, GEO.trunk, M.trunk, GEO.crown, M.leaf, trees, { name: 'arbori' });
  { const c = new THREE.Color(); trees.forEach((t, i) => treeMeshes[1].setColorAt(i, c.setHSL(0.25 + (i % 5) * 0.015, 0.45, 0.28 + (i % 3) * 0.04))); }
  // gradini de ploaie (rigole plantate care retin apa de pe pavaj)
  const rain = RAIN_GARDENS;
  const reeds = [];
  for (const [a, b, c, d] of rain) {
    B.aabb(M.concrete, a - 0.2, Y - 0.1, b - 0.2, c + 0.2, Y + 0.12, d + 0.2);
    B.hquad(M.soil, a, b, c, d, Y + 0.14, 2);
    B.hquad(M.water, a + 0.6, b + 1.2, c - 0.6, d - 1.2, Y + 0.165, 3);
    for (let z = b + 0.5; z < d - 0.3; z += 0.9) for (const x of [a + 0.35, c - 0.35]) reeds.push({ x, y: Y + 0.1, z, ry: z * 3, s: 0.35 + ((z * 17) % 4) * 0.05 });
  }
  future.add(instanced(GEO.foliage, M.leaf, reeds, { colors: [0x4f8a3a, 0x7a9a3f, 0x5e7f35, 0xa48a3f], name: 'stuf-gradini' }));
  // gazon peste campul de sonde geotermale
  B.hquad(M.grass, -28.6, -63, -20.4, -51.5, Y + 0.02, 2);
  const caps = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) caps.push({ x: -26.8 + i * 2.6, y: Y + 0.02, z: -60.8 + j * 3.6 });
  future.add(instanced(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 14).translate(0, 0.03, 0), M.ledGreen, caps, { cast: false, name: 'sonde-geotermale' }));
  // banci in piata: in culoarele dintre gradinile de ploaie, cu fata spre gradina (niciodata in apa)
  const benches = [];
  for (const [z, ry] of [[-27, 0], [-10.5, Math.PI], [6.2, 0], [21, Math.PI], [35.5, 0]]) benches.push({ x: -56.5, y: Y, z, ry });
  for (const z of [-6, 0, 6]) benches.push({ x: -21.7, y: Y, z: z - 2, ry: Math.PI / 2 }); // la 1,3 m de bordura gradinii de ploaie
  for (const z of [-76, -64, -52]) benches.push({ x: 84.5, y: Y, z, ry: -Math.PI / 2 });
  instancedPair(future, GEO.benchWood, M.seatWood, GEO.benchSteel, M.steel, benches, { name: 'banci-piata' });
  // statie bike-sharing
  for (let z = -28; z < -14; z += 1.0) bikes.push({ x: -51.0, y: Y, z, ry: Math.PI / 2 });
  const docks = [];
  for (let z = -28; z < -14; z += 1.0) docks.push({ x: -51.0, y: Y, z, ry: Math.PI / 2 });
  future.add(instanced(GEO.bikeDock, M.steelWhite, docks, { name: 'docuri-bike' }));
  future.add(instanced(GEO.bikeFrame, M.dark, bikes, { colors: [0x0e7490, 0x1f2937, 0x0e7490, 0xd97706], name: 'biciclete' }));
  addSign(B, M, atlas, 'bike', -50.2, 2.6, -12.8, Math.PI / 2, 2.0, 0.5);
  B.aabb(M.steel, -50.23, Y, -12.83, -50.17, 2.35, -12.77);
  // treceri de pietoni peste Str. Garii (spre intrarea holului si spre autogara)
  for (const z of [-29.2, 30]) for (let x = -49.4; x < -42.2; x += 1.0) B.aabb(M.white, x, Y + 0.002, z - 2, x + 0.5, Y + 0.014, z + 2);

  // ---------------- colectare selectiva (4 fluxuri) ----------------
  const binCols = [0x2563eb, 0xeab308, 0x16a34a, 0x7a4a26];
  const binIds = ['hartie', 'plastic', 'sticla', 'bio'];
  const stations = [[-27.4, -40.5, Math.PI / 2], [-50.8, 8.5, Math.PI / 2], [66.0, -44.0, Math.PI]];
  const bins = [];
  for (const [x, z, ry] of stations) {
    const ax = Math.sin(ry + Math.PI / 2), az = Math.cos(ry + Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const o = (i - 1.5) * 0.85;
      bins.push({ x: x + ax * o, y: Y, z: z + az * o, ry, s: 1.25, c: binCols[i] });
      addSign(B, M, atlas, binIds[i], x + ax * o + Math.sin(ry) * 0.38, Y + 1.62, z + az * o + Math.cos(ry) * 0.38, ry, 0.72, 0.18, false);
    }
    B.box(M.steelWhite, x - Math.sin(ry) * 0.35, Y + 2.25, z - Math.cos(ry) * 0.35, ...(Math.abs(Math.sin(ry)) > 0.5 ? [0.1, 0.1, 3.8] : [3.8, 0.1, 0.1]));
    addSign(B, M, atlas, 'recycle', x, Y + 2.62, z, ry, 2.0, 0.5);
    B.aabb(M.steel, x - Math.sin(ry) * 0.35 - 0.03, Y, z - Math.cos(ry) * 0.35 - 0.03, x - Math.sin(ry) * 0.35 + 0.03, Y + 2.3, z - Math.cos(ry) * 0.35 + 0.03);
  }
  future.add(instanced(GEO.bin, M.white, bins, { colors: bins.map((b) => b.c), name: 'cosuri-piata' }));

  // ---------------- totemuri digitale cu harta ----------------
  const totemMat = new THREE.MeshBasicMaterial({ map: totemTex, toneMapped: false });
  totemMat.name = 'totem';
  for (const [x, z, ry] of [[-27.4, -35.6, -Math.PI / 2], [-50.6, -9.5, Math.PI / 2], [60.0, -60.0, -Math.PI / 2]]) {
    B.box(M.dark, x, Y + 1.3, z, 0.25, 2.6, 1.3, ry === Math.PI / 2 || ry === -Math.PI / 2 ? 0 : ry);
    const s = Math.sign(-Math.sin(ry)) || 1;
    B.add(totemMat, panelGeo(1.1, 2.2), x - s * 0.13, Y + 1.38, z, ry);
    B.add(totemMat, panelGeo(1.1, 2.2), x + s * 0.13, Y + 1.38, z, ry + Math.PI);
    P.wallAabb(x - 0.2, Y, z - 0.7, x + 0.2, Y + 2.6, z + 0.7);
  }

  // ---------------- stalpi inteligenti (LED, senzori, camera, Wi-Fi) ----------------
  const lamps = [];
  // rand vest al curtii: la x -29,8 (in afara benzilor carosabile, care incep la -29,6)
  for (let z = -104; z < 60; z += 18) if ((z < -72 || z > -44) && Math.abs(z - 4) > 3) lamps.push({ x: -29.8, y: Y, z, ry: Math.PI / 2 });
  // piata verde: randul de langa Str. Garii ocoleste statia de bike-sharing (z -28 … -14) si punctul de colectare (z 7 … 10)
  for (const z of [-29.5, -7, 4.6, 25, 42]) lamps.push({ x: -50.2, y: Y, z, ry: -Math.PI / 2 });
  for (let z = -26; z < 47; z += 17) lamps.push({ x: -62.6, y: Y, z, ry: Math.PI / 2 });
  for (const [x, z] of [[60, -82], [72, -82], [83, -82], [86, -66], [86, -50]]) lamps.push({ x, y: Y, z, ry: Math.PI });
  instancedPair(future, GEO.lampPole, M.steel, GEO.lampHead, M.lamp, lamps, { name: 'stalpi-piata' });
  future.add(instanced(GEO.cctv, M.dark, lamps.map((l) => ({ ...l, y: Y + 4.6, ry: l.ry + Math.PI })), { cast: false, name: 'camere-piata' }));

  // ---------------- tehnica verde: apa pluviala + pompa de caldura geotermala ----------------
  B.cyl(M.steelWhite, -13.0, Y, -58.5, 1.2, 3.2, 20);
  B.cyl(M.binPaper, -13.0, Y + 3.2, -58.5, 1.25, 0.12, 20);
  B.aabb(M.binPaper, -14.25, Y + 1.0, -59.0, -14.18, Y + 2.8, -58.0); // indicator de nivel
  B.cyl(M.steel, -12.6, Y + 3.2, -48.4, 0.09, 4.4, 8);               // burlan de la acoperisul holului
  B.aabb(M.steel, -12.69, Y + 3.25, -57.3, -12.51, Y + 3.43, -48.4);
  B.aabb(M.white, -13.9, Y, -55.6, -12.1, Y + 1.5, -54.4);             // pompa de caldura
  for (const dz of [-0.3, 0.3]) B.cyl(M.dark, -13.0, Y + 1.5, -55 + dz, 0.25, 0.04, 16);
  B.aabb(M.ledGreen, -12.08, Y + 1.1, -55.2, -12.06, Y + 1.3, -54.8);
  P.wallAabb(-14.3, Y, -59.8, -11.7, Y + 3.2, -54.3);

  // ---------------- stocare de energie (piateta est, langa Electroputere) ----------------
  const [ex0, ez0, ex1, ez1] = ZONES.battery;
  for (const z of [ez0 + 1.25, ez1 - 1.25]) {
    B.aabb(M.container, ex0, Y, z - 1.22, ex1, Y + 2.9, z + 1.22);
    for (let x = ex0 + 0.4; x < ex1; x += 0.6) B.aabb(M.container, x, Y + 0.1, z - 1.25, x + 0.12, Y + 2.8, z + 1.25);
    B.aabb(M.white, ex0 - 0.02, Y + 2.0, z - 0.9, ex0, Y + 2.6, z + 0.9);
    B.aabb(M.ledGreen, ex0 - 0.03, Y + 1.0, z - 0.15, ex0, Y + 1.15, z + 0.15);
    for (const x of [ex0 + 2, ex0 + 6, ex0 + 10]) B.aabb(M.dark, x, Y + 2.9, z - 0.6, x + 1.2, Y + 3.3, z + 0.6); // racire
  }
  addSign(B, M, atlas, 'baterie', ex0 - 0.4, 2.2, (ez0 + ez1) / 2, -Math.PI / 2, 2.0, 0.5, false);
  for (let x = ex0 - 1; x <= ex1 + 1; x += 2.48) for (const z of [ez0 - 1, ez1 + 1]) B.aabb(M.steel, x - 0.03, Y, z - 0.03, x + 0.03, Y + 2, z + 0.03);
  B.aabb(M.steel, ex0 - 1, Y + 1.95, ez0 - 1.02, ex1 + 1, Y + 2, ez0 - 0.98);
  B.aabb(M.steel, ex0 - 1, Y + 1.95, ez1 + 0.98, ex1 + 1, Y + 2, ez1 + 1.02);
  P.wallAabb(ex0 - 1, Y, ez0 - 1, ex1 + 1, Y + 3, ez1 + 1);
  addSign(B, M, atlas, 'gara', 60.2, 3.0, -76, -Math.PI / 2, 2.4, 0.6);
  B.aabb(M.steel, 60.17, Y, -76.03, 60.23, 2.7, -75.97);
  // linie mov de la scara de est spre strada
  floorLine(B, M.ledPurple, [[63.1, -49.6], [63.1, -46.6], [84, -46.6]], 0.13);

  const out = {
    future, today, shared,
    counts: { lamps: lamps.length, trees: trees.length, benches: benches.length },
    props: { benches, trees, lamps, bins, bikes, docks, evs, cars, evCars, buses, busSeats },
    // obiecte construite in Batch (pentru verificarea amplasarii): dreptunghiuri locale [x0, z0, x1, z1]
    structures: [
      { name: 'rezervor-apa-pluviala', r: [-14.3, -59.8, -11.7, -54.3] },
      { name: 'stocare-baterii', r: [ZONES.battery[0] - 1, ZONES.battery[1] - 1, ZONES.battery[2] + 1, ZONES.battery[3] + 1] },
      { name: 'insula-autogara', r: ZONES.busIsland },
      { name: 'parcare-biciclete', r: [ZONES.bikeShelter[0] - 0.3, ZONES.bikeShelter[1] - 0.4, ZONES.bikeShelter[2] + 0.3, ZONES.bikeShelter[3] + 0.4] },
      ...[[-27.4, -35.6], [-50.6, -9.5], [60.0, -60.0]].map(([x, z]) => ({ name: 'totem', r: [x - 0.3, z - 0.7, x + 0.3, z + 0.7] })),
      ...[[-22.8, -82], [-22.8, -100.5], [-50.2, -12.8], [60.2, -76]].map(([x, z]) => ({ name: 'stalp-semn', r: [x - 0.1, z - 0.1, x + 0.1, z + 0.1] })),
    ],
    meshesF: B.build(future), meshesT: T.build(today), meshesS: S.build(shared),
    physF: P.build(future), physS: PS.build(shared),
    pvArea,
  };
  return out;
}
