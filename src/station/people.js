import * as THREE from 'three';
import { toWorld, toLocal, ROT_Y, PLAT_Y, PLATFORMS } from './frame.js';
import { HALL, PAVE_Y } from './kit.js';
import { CANOPIES } from './platforms.js';
import { ZONES, RAIN_GARDENS } from './plaza.js';
import { PASSAGE } from './building.js';

// Calatorii din gara (TO-DO 7): pe peroanele 1–3 (langa margine, cu fata spre linie, mai multi langa banci / adaposturi,
// unii pe banci), la statia T1 „Peronul 1 Sud”, la insula autogarii (la coada in dreptul usilor), in hol (sala de
// asteptare, automatele de bilete, ghiseul de informare, tabela de plecari) si cativa pietoni intre hol, peroane,
// autogara si T1. In „Azi”: o multime mai mica pe peroanele joase de azi, in fata garii si la statia de pe Str. Garii.
// Totul se lucreaza in sistemul local al garii (frame.js) si se trece in coordonate lume.

const F = HALL.floor;
const ISLAND_Y = PAVE_Y + 0.16;
const BUS_SEAT_X = ZONES.busIsland[2] - 1.2;

export function addStationPeople(ctx, { plaza, colliders }) {
  const P = ctx.people;
  if (!P) return null;
  const yawL = (dlx, dlz) => Math.atan2(dlx, dlz) + ROT_Y; // directie locala -> yaw lume
  const toW = (pts) => pts.map((p) => { const [x, z] = toWorld(p.x, p.z); return { ...p, x, z, yaw: p.yaw + ROT_Y }; });
  const pathW = (pts) => pts.map(([lx, y, lz]) => { const [x, z] = toWorld(lx, lz); return [x, y, z]; });

  // ---------------- obstacole (sistem local) ----------------
  // cutiile de coliziune (Phys) ale fiecarei epoci: AABB locale + cota
  const boxesOf = (meshes) => {
    const out = [], v = new THREE.Vector3();
    for (const m of meshes) {
      m.updateMatrixWorld(true);
      const pos = m.geometry.attributes.position, per = m.geometry.index ? 24 : 36;
      if (pos.count % per) continue;
      for (let k = 0; k < pos.count; k += per) {
        let x0 = Infinity, z0 = Infinity, y0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = -Infinity;
        for (let i = k; i < k + per; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          const [lx, lz] = toLocal(v.x, v.z);
          x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        out.push([x0, z0, x1, z1, y0, y1]);
      }
    }
    return out;
  };
  const BOX = { future: boxesOf([...colliders.shared, ...colliders.future]), today: boxesOf([...colliders.shared, ...colliders.today]) };
  const blocked = (era, x, z, y, r = 0.3) => {
    for (const b of BOX[era]) if (b[5] > y + 0.15 && b[4] < y + 1.8 && x > b[0] - r && x < b[2] + r && z > b[1] - r && z < b[3] + r) return true;
    return false;
  };
  const inRect = (x, z, [a, b, c, d], m = 0) => x > a - m && x < c + m && z > b - m && z < d + m;
  const C = (x, z, r) => ({ x, z, r });

  // mobilierul de peron (aceleasi reguli ca in platforms.js): banci, adaposturi, cosuri, coloane SOS
  const avoidZ = (z) => (z > -86 && z < -42) || (z > -37 && z < -21); // pasarela (scari + lifturi) si pasajul de sub cladire
  const benchesP = [];
  for (let z = -100; z <= 160; z += 16) {
    if ((z > -84 && z < -44) || (z > -36 && z < -22)) continue;
    benchesP.push({ x: z > -46 && z < 44 ? 11.4 : 12.2, z, ry: Math.PI / 2, pid: 'P1' });
  }
  const shelters = [];
  for (const pid of ['P2', 'P3']) {
    const p = PLATFORMS.find((q) => q.id === pid), xc = (p.x0 + p.x1) / 2;
    for (let z = p.z0 + 10; z < p.z1 - 6; z += 24) {
      if ((z > -84 && z < -44) || (z > -36 && z < -22) || Math.abs(z - 20) < 6 || Math.abs(z - 92) < 6) continue;
      benchesP.push({ x: xc - 0.55, z, ry: -Math.PI / 2, pid }, { x: xc + 0.55, z, ry: Math.PI / 2, pid });
    }
    for (const z of [20, 92]) shelters.push({ xc, z, pid });
  }
  const platAvoid = [];
  for (const b of benchesP) platAvoid.push(C(b.x, b.z - 0.6, 0.95), C(b.x, b.z + 0.6, 0.95));
  for (const p of PLATFORMS) {
    const xc = p.id === 'P1' ? 12.0 : (p.x0 + p.x1) / 2;
    for (const z of [-14, 104]) platAvoid.push(C(xc, z, 0.6));
    platAvoid.push(C(p.id === 'P1' ? 12.0 : xc, p.id === 'P1' ? 52 : 46, 1.4));
  }
  for (const z of [70, 110]) platAvoid.push(C(11.6, z, 0.5)); // stalpii semnelor T1
  const inShelter = (x, z) => shelters.some((s) => Math.abs(x - s.xc) < 1.35 && Math.abs(z - s.z) < 3.4);

  // obstacolele din piata (copaci, stalpi, cosuri, biciclete, statii EV, masini parcate) + structuri
  const plazaAvoid = { future: [], today: [] };
  const pr = plaza?.props || {};
  for (const [k, r, eras] of [['trees', 1.0, ['future']], ['lamps', 0.45, ['future']], ['bins', 0.55, ['future', 'today']], ['bikes', 0.7, ['future']], ['docks', 0.6, ['future']], ['evs', 0.6, ['future']], ['cars', 2.6, ['today']], ['evCars', 2.6, ['future']]]) {
    for (const o of pr[k] || []) for (const e of eras) plazaAvoid[e].push(C(o.x, o.z, r));
  }
  for (const z of [-100, -76, -52, -28, -4, 20]) plazaAvoid.today.push(C(-28.5, z, 0.45)); // stalpii de azi
  const structs = (plaza?.structures || []).map((s) => s.r);
  const offPlaza = (x, z) => structs.some((r) => inRect(x, z, r, 0.4)) || RAIN_GARDENS.some((r) => inRect(x, z, r, 0.4));

  const handles = [];
  let nStatic = 0;
  const group = (pts, opts) => { const w = toW(pts); nStatic += w.length; handles.push(P.addGroup({ points: w, ...opts })); return w.length; };
  // imprastiere in sistemul local (dreptunghi), cu verificarea obstacolelor
  const spread = (era, rect, y, count, seed, face, opts = {}) => P.scatter({
    rect: { x0: rect[0], z0: rect[1], x1: rect[2], z1: rect[3] }, y, count, seed,
    yaw: Array.isArray(face) ? Math.atan2(face[0], face[1]) : 0,
    target: face && !Array.isArray(face) ? [face.x, face.z] : null,
    avoid: opts.avoid || [], minDist: opts.minDist ?? 0.8, jitterYaw: opts.jitter ?? 0.35, weight: opts.weight,
    inside: (x, z) => !(opts.reject && opts.reject(x, z)) && !blocked(era, x, z, y),
  });
  const nearBench = (pid) => (x, z) => {
    let d = 1e9;
    for (const b of benchesP) if (b.pid === pid) d = Math.min(d, Math.abs(z - b.z));
    for (const s of shelters) if (s.pid === pid) d = Math.min(d, Math.abs(z - s.z) * 0.6);
    return 0.3 + 0.7 * Math.exp(-d / 10);
  };

  // ================= VIITOR =================
  const E = 'future';
  // --- peronul 1 (linia 1 la est) ---
  const p1 = PLATFORMS[0], c1 = CANOPIES.P1;
  group(spread(E, [c1.colX + 0.75, p1.z0 + 8, p1.x1 - 1.05, 150], PLAT_Y, 34, 11, [1, 0], { avoid: platAvoid, reject: (x, z) => avoidZ(z) || (z > 58 && z < 120 && x < 12.8), weight: nearBench('P1') }), { era: E, seed: 11, wheelchair: 1 });
  // --- peroanele 2 si 3 (o linie de fiecare parte) ---
  let seed = 20;
  for (const pid of ['P2', 'P3']) {
    const p = PLATFORMS.find((q) => q.id === pid), c = CANOPIES[pid];
    for (const [side, xa, xb] of [[-1, p.x0 + 1.05, c.colX - 0.65], [1, c.colX + 0.65, p.x1 - 1.05]]) {
      group(spread(E, [xa, p.z0 + 6, xb, p.z1 - 8], PLAT_Y, 22, seed, [side, 0], { avoid: platAvoid, reject: (x, z) => avoidZ(z) || inShelter(x, z), weight: nearBench(pid), minDist: 0.75 }), { era: E, seed, wheelchair: seed % 2 });
      seed++;
    }
  }
  // --- asezati pe banci (peroane) si in adaposturi ---
  const seated = [];
  benchesP.forEach((b, i) => {
    if (b.pid === 'P1' && b.z > 76 && b.z < 102) return; // aici sta adapostul statiei T1 (src/transit/stops.js)
    const n = (i * 7) % 5 === 0 ? 0 : (i * 3) % 4 === 0 ? 2 : 1;
    const offs = n === 2 ? [-0.55, 0.55] : [((i * 5) % 3 - 1) * 0.6];
    for (let k = 0; k < n; k++) seated.push({ x: b.x, y: PLAT_Y, z: b.z + offs[k], yaw: b.ry });
  });
  shelters.forEach((s, i) => {
    seated.push({ x: s.xc - 0.22, y: PLAT_Y, z: s.z - 1.2 + (i % 2), yaw: -Math.PI / 2 }, { x: s.xc + 0.22, y: PLAT_Y, z: s.z + 0.9, yaw: Math.PI / 2 });
  });
  group(seated, { kind: 'sit', era: E, seed: 30 });

  // --- statia T1 „Peronul 1 Sud” (fata de vest a peronului 1, z 62 … 118; axa T1 la x = 8,1) ---
  // adapostul, validatorul si afisajul statiei sunt construite de modulul de transport (dupa gara) => populam dupa el
  const t1Zone = [p1.x0 + 0.95, 64, 11.55, 116];
  P.defer(() => {
    const t1Avoid = (ctx.transit?.stops?.props || []).filter((q) => q.stop === 'gara').map((q) => { const [x, z] = toLocal(q.x, q.z); return C(x, z, q.r + 0.4); });
    const pts = spread(E, t1Zone, PLAT_Y, 20, 40, [-1, 0], { avoid: [...platAvoid, ...t1Avoid], minDist: 0.75, jitter: 0.45 });
    group(pts, { era: E, seed: 40, wheelchair: 1, luggage: 0.4 });
  });

  // --- autogara: cozi la usile autobuzului (oprire z = 30, usi la z ≈ 25 si 31,5), scaune, asteptare ---
  const [bx0, bz0, bx1, bz1] = ZONES.busIsland;
  const queue = [];
  for (const [zq, n] of [[25.2, 6], [31.6, 5]]) {
    for (let k = 0; k < n; k++) {
      const x = bx0 + 0.75 + Math.min(k, 3) * 0.62, z = zq + (k > 3 ? (k - 3) * 0.62 : 0) + ((k * 37) % 7 - 3) * 0.03;
      queue.push({ x, y: ISLAND_Y, z, yaw: -Math.PI / 2 + ((k * 13) % 5 - 2) * 0.08 });
    }
  }
  group(queue, { era: E, seed: 50, luggage: 0.35, phone: 0.3 });
  const busSeated = [];
  [bz0 + 5, bz0 + 13, bz0 + 21, bz0 + 29, bz0 + 37].forEach((z, i) => {
    for (const o of [-0.9, -0.3, 0.3, 0.9]) if (((i * 4 + o * 10) | 0) % 3 !== 0) busSeated.push({ x: BUS_SEAT_X, y: ISLAND_Y, z: z - o, yaw: -Math.PI / 2 });
  });
  group(busSeated, { kind: 'sit', era: E, seed: 51 });
  group(spread(E, [bx0 + 0.75, bz0 + 2, bx1 - 2.0, bz1 - 2], ISLAND_Y, 9, 52, [-1, 0], { reject: (x, z) => Math.abs(z - 25.2) < 1.3 || Math.abs(z - 31.6) < 1.6 || inRect(x, z, [bx0, 24, bx0 + 3.2, 35]) }), { era: E, seed: 52, wheelchair: 1 });

  // --- holul: sala de asteptare (scaune), automate, ghiseu, tabela de plecari, culoarul spre pasaj ---
  const lounge = [];
  let li = 0;
  for (const z of [-23.2, -20.6, -18.0, -15.4]) for (const x of [-20.0, -16.9]) for (const o of [-0.9, -0.3, 0.3, 0.9]) { if ((li++ * 5) % 8 < 5) lounge.push({ x: x - o, y: F, z, yaw: Math.PI }); }
  group(lounge, { kind: 'sit', era: E, seed: 60 });
  group([
    { x: -20.6, y: F, z: -45.0, yaw: -Math.PI / 2 }, { x: -20.6, y: F, z: -42.0, yaw: -Math.PI / 2, mode: 0 }, { x: -20.6, y: F, z: -40.5, yaw: -Math.PI / 2 },
    { x: -19.7, y: F, z: -42.1, yaw: -Math.PI / 2 - 0.2 },
    { x: -16.4, y: F, z: -36.95, yaw: Math.PI },
    { x: -14.9, y: F, z: -36.7, yaw: Math.PI, wheelchair: true }, // ghiseul coborat (PMR)
  ], { era: E, seed: 61, phone: 0, children: 0 });
  group(spread(E, [-19.9, -46.3, -14.6, -40.6], F, 10, 62, { x: -17.4, z: HALL.z0 }, { avoid: [C(-14.0, -46.9, 0.9)], jitter: 0.15 }), { era: E, seed: 62, phone: 0.1 });
  group(spread(E, [-20.6, -35.6, -8.6, -25.8], F, 9, 63, [1, 0], { avoid: [C(-12.3, -25.4, 0.9), C(-21.3, -33.4, 0.9), C(-21.3, -25.2, 0.9)], jitter: 1.4, minDist: 1.1 }), { era: E, seed: 63 });

  // --- piata garii ---
  group(spread(E, [-29.0, -48.5, -23.0, -12.5], PAVE_Y, 8, 70, { x: HALL.x0, z: -29 }, { avoid: plazaAvoid.future, reject: offPlaza, jitter: 0.9, minDist: 1.2 }), { era: E, seed: 70 });
  group(spread(E, [-22.6, -10.5, -12.6, 8.8], PAVE_Y, 7, 71, [0, 1], { avoid: [...plazaAvoid.future, ...[-8, -2, 4].map((z) => C(-17.3, z, 1.3))], reject: offPlaza, jitter: 1.5, minDist: 1.2 }), { era: E, seed: 71 });
  group(spread(E, [-15.1, 11, -12.3, 52], PAVE_Y, 5, 72, [-1, 0], { avoid: plazaAvoid.future, reject: offPlaza, jitter: 1.2, minDist: 1.5 }), { era: E, seed: 72 });
  group(spread(E, [-53.9, 4.5, -50.4, 46.5], PAVE_Y, 6, 73, [1, 0], { avoid: plazaAvoid.future, reject: offPlaza, jitter: 1.5, minDist: 1.5 }), { era: E, seed: 73 });
  // banci in piata: cele de langa gradina de ploaie (fata spre +x) si cele din piata verde (fata spre ±z)
  group([
    { x: -17.3, y: PAVE_Y, z: -8.5, yaw: Math.PI / 2 }, { x: -17.3, y: PAVE_Y, z: 3.6, yaw: Math.PI / 2 },
    { x: -56.5, y: PAVE_Y, z: 6.2, yaw: 0 }, { x: -56.5, y: PAVE_Y, z: 21.5, yaw: Math.PI }, { x: -56.5, y: PAVE_Y, z: 34.9, yaw: 0 }, { x: -56.5, y: PAVE_Y, z: -10.0, yaw: Math.PI },
  ], { kind: 'sit', era: E, seed: 74 });

  // --- pietoni (viitor) ---
  const walkers = [
    // piata -> hol -> pasaj -> peronul 1
    { path: [[-26, PAVE_Y, -29], [-21.5, F, -29], [-7.2, F, -29], [PASSAGE.x0, F, -29], [PASSAGE.x1, PLAT_Y, -29], [13.9, PLAT_Y, -21], [13.9, PLAT_Y, 40]], speed: 1.35, pause: 6 },
    // hol -> peronul 1 -> statia T1
    { path: [[-12, F, -30], [PASSAGE.x0, F, -28], [PASSAGE.x1, PLAT_Y, -28], [13.9, PLAT_Y, -20], [13.9, PLAT_Y, 63], [11.2, PLAT_Y, 67], [11.2, PLAT_Y, 79]], speed: 1.25, pause: 8 },
    // autogara -> piata -> usa de vest a holului
    { path: [[-17.9, ISLAND_Y, 44], [-17.9, ISLAND_Y, 11.5], [-14, PAVE_Y, 8], [-14, PAVE_Y, -9], [-23.3, PAVE_Y, -10], [-23.3, PAVE_Y, -29], [-21.2, F, -29], [-17, F, -33]], speed: 1.2, pause: 5 },
    // usa de sud a holului -> autogara
    { path: [[-14.3, F, -34], [-14.3, F, -16], [-16.2, F, -13], [-16.2, PAVE_Y, -9.5], [-14.2, PAVE_Y, 8], [-17.6, ISLAND_Y, 12], [-17.6, ISLAND_Y, 36]], speed: 1.3, pause: 7 },
    // parcarea de biciclete -> usa de nord a holului
    { path: [[-20.5, PAVE_Y, -95], [-21.6, PAVE_Y, -80], [-21.6, PAVE_Y, -50], [-18.5, PAVE_Y, -49], [-18.5, F, -46.8]], speed: 1.4, pause: 6 },
    // in lungul peroanelor
    { path: [[13.9, PLAT_Y, -12], [13.9, PLAT_Y, 150]], speed: 1.15, pause: 4 },
    { path: [[28.45, PLAT_Y, -38], [28.45, PLAT_Y, 160]], speed: 1.3, pause: 5 },
    { path: [[31.1, PLAT_Y, 150], [31.1, PLAT_Y, -16]], speed: 1.2, pause: 5 },
    { path: [[41.3, PLAT_Y, -38], [41.3, PLAT_Y, 150]], speed: 1.25, pause: 6 },
    { path: [[44.5, PLAT_Y, 140], [44.5, PLAT_Y, -16]], speed: 1.35, pause: 4 },
    // statia T1: plimbare scurta pe peron
    { path: [[11.0, PLAT_Y, 66], [11.0, PLAT_Y, 80]], speed: 0.9, pause: 9 },
    // piata, prin fata holului
    { path: [[-26.5, PAVE_Y, -60], [-26.5, PAVE_Y, -14]], speed: 1.3, pause: 5 },
  ];
  const wh = walkers.map((w, i) => P.addWalker({ ...w, path: pathW(w.path), loop: true, era: E, seed: 80 + i }));

  // ================= AZI =================
  const T = 'today', YT = 0.62;
  const old = [[9.8, 18.7, -107, 170], [27.15, 32.35, -75, 178], [39.95, 45.85, -66, 166]];
  const lampAvoid = [];
  for (const [x0, x1, z0, z1] of old) for (let z = z0 + 12; z < z1; z += 30) lampAvoid.push(C((x0 + x1) / 2 + (x0 < 15 ? 2.5 : 0), z, 0.6));
  const crossing = (z) => Math.abs(z + 4) < 2 || Math.abs(z - 58) < 2;
  group(spread(T, [15.6, -60, old[0][1] - 0.9, 140], YT, 14, 90, [1, 0], { avoid: lampAvoid, reject: (x, z) => crossing(z) }), { era: T, seed: 90 });
  group(spread(T, [old[1][0] + 0.9, -60, 28.9, 150], YT, 7, 91, [-1, 0], { avoid: lampAvoid, reject: (x, z) => crossing(z) }), { era: T, seed: 91 });
  group(spread(T, [30.6, -60, old[1][1] - 0.9, 150], YT, 6, 92, [1, 0], { avoid: lampAvoid, reject: (x, z) => crossing(z) }), { era: T, seed: 92 });
  group(spread(T, [old[2][0] + 0.9, -50, old[2][1] - 0.9, 140], YT, 9, 93, [-1, 0], { avoid: lampAvoid, reject: (x, z) => crossing(z), minDist: 1.0 }), { era: T, seed: 93 });
  // statia de autobuz de azi (Str. Garii): la bordura, cu fata spre strada; doi pe banca
  group([{ x: -40.0, y: 0.12, z: 16.2, yaw: -Math.PI / 2 }, { x: -39.9, y: 0.12, z: 17.9, yaw: -Math.PI / 2 + 0.4 }, { x: -39.95, y: 0.12, z: 21.0, yaw: -Math.PI / 2 - 0.3 }], { era: T, seed: 94, luggage: 0.4 });
  group([{ x: -38.72, y: 0.12, z: 18.9, yaw: -Math.PI / 2 }, { x: -38.72, y: 0.12, z: 20.1, yaw: -Math.PI / 2 }], { kind: 'sit', era: T, seed: 95 });
  // in fata cladirii (azi: parcare)
  group(spread(T, [-17.4, -42, -12.6, -12], PAVE_Y, 7, 96, [1, 0], { avoid: plazaAvoid.today, jitter: 1.6, minDist: 1.3 }), { era: T, seed: 96 });
  const whT = [
    { path: [[-17, PAVE_Y, -36], [-13, PAVE_Y, -30], [-13, PAVE_Y, 20]], speed: 1.2, pause: 6 },
    { path: [[14.5, YT, -60], [14.5, YT, 120]], speed: 1.2, pause: 6 },
    // azi calatorii traverseaza liniile pe dulapii de lemn (traversarea de la z = -4)
    { path: [[15.5, YT, -14], [17.5, YT, -4], [18.7, 0.6, -4], [27.15, 0.6, -4], [32.35, 0.6, -4], [39.95, 0.6, -4], [42.5, YT, -4], [42.5, YT, 20]], speed: 1.1, pause: 10 },
  ].map((w, i) => P.addWalker({ ...w, path: pathW(w.path), loop: true, era: T, seed: 120 + i }));

  const total = nStatic + wh.length + whT.length;
  console.info(`Persoane in gara: ${nStatic} statice + ${wh.length + whT.length} pietoni`);
  return {
    handles, walkers: [...wh, ...whT], total,
    setVisible(on) { handles.forEach((h) => h.setVisible(on)); [...wh, ...whT].forEach((w) => w?.setVisible(on)); },
  };
}
