import * as THREE from 'three';
import { Batch, Phys, panelGeo, triGeo, instanced } from './builder.js';
import { TRACKS, PLATFORMS, PLAT_Y, RAIL_TOP, toLocal, toWorld, lxAt, stitchRoute, snapToDesign } from './frame.js';
import { PAVE_Y, addSign, GEO, instancedPair } from './kit.js';
import { ribbonGeometry, densify } from '../core/util.js';

// Peroane inaltate (55 cm peste sina), copertine fotovoltaice ondulate, sine + traverse, catenara 25 kV.
// Liniile urmeaza caile OSM reale (osm.json), aliniate la offsetul proiectat doar in dreptul peroanelor.

// segmentele de copertina (intrerupte in dreptul pasarelei)
export const CANOPIES = {
  P1: { x0: 14.5, x1: 18.6, colX: 15.1, segs: [[-110, -77], [-47, 168]], butterfly: false },
  P2: { x0: 27.25, x1: 32.25, colX: 29.75, segs: [[-100, -77], [-47, 178]], butterfly: true },
  P3: { x0: 40.05, x1: 45.75, colX: 42.9, segs: [[-47, 164]], butterfly: true },
};
const canopyY = (z) => PLAT_Y + 4.35 + 0.55 * Math.sin((2 * Math.PI * (z + 110)) / 36);

export function buildTracks(ctx, M, worldGroup) {
  const heightAt = ctx.terrain.heightAt;
  const rails = ctx.city?.osm?.rails || [];
  const tracks = {};
  for (const t of TRACKS) {
    let route = stitchRoute(rails, { x: t.x, lz: (t.z0 + t.z1) / 2, maxLen: 1600 });
    if (!route) {
      // rezerva: linie dreapta in lungul axei
      route = [toWorld(t.x, -1600), toWorld(t.x, 1600)];
    }
    route = snapToDesign(densify(route, 8), t);
    tracks[t.id] = { ...t, route };
  }
  // geometrie: balast, sine, traverse — doar in zona statiei (+-520 m)
  const R = 520;
  const ballast = [], railBoxes = new Batch('sine'), sleepers = [];
  for (const t of Object.values(tracks)) {
    const pts = t.route.filter(([x, z]) => Math.hypot(x, z) < R);
    if (pts.length < 2) continue;
    t.near = pts;
    ballast.push(ribbonGeometry(pts, 3.6, heightAt, 0.34, 6));
    const dense = densify(pts, 4);
    let acc = 0;
    for (let i = 0; i < dense.length - 1; i++) {
      const [x0, z0] = dense[i], [x1, z1] = dense[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.01) continue;
      const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
      const ry = Math.atan2(dx, dz);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const y = heightAt(mx, mz);
      for (const s of [-0.75, 0.75]) railBoxes.box(M.rail, mx + dz * s, y + RAIL_TOP - 0.075, mz - dx * s, 0.07, 0.15, L + 0.02, ry);
      for (let d = (0.65 - acc) % 0.65; d < L; d += 0.65) {
        const px = x0 + dx * d, pz = z0 + dz * d;
        sleepers.push({ x: px, y: heightAt(px, pz) + RAIL_TOP - 0.15 - 0.08, z: pz, ry });
      }
      acc = (acc + L) % 0.65;
    }
  }
  const group = new THREE.Group();
  group.name = 'linii-cf';
  worldGroup.add(group);
  if (ballast.length) {
    const bm = new THREE.Mesh(ballastMerge(ballast), M.ballast);
    bm.receiveShadow = true; bm.name = 'balast';
    group.add(bm);
  }
  railBoxes.build(group, { cast: false });
  const sl = instanced(new THREE.BoxGeometry(2.6, 0.16, 0.25), M.sleeper, sleepers, { cast: false });
  sl.name = 'traverse';
  group.add(sl);

  // ---------------- catenara 25 kV ----------------
  const C = new Batch('catenara');
  const wires = [];
  const yAt = (x, z) => heightAt(x, z);
  const localTracks = Object.values(tracks).filter((t) => t.near).map((t) => ({ t, L: t.near.map(([x, z]) => toLocal(x, z)) }));
  const addWorldBox = (lx, y, lz, w, h, d, extraRy = 0) => {
    const [x, z] = toWorld(lx, lz);
    C.box(M.steel, x, yAt(x, z) + y, z, w, h, d, Math.atan2(0.3698, 0.9291) + extraRy);
  };
  const footbridgeZone = (z) => z > -82 && z < -54;
  // console pe peroane (in zona peroanelor)
  const mastRows = [
    { x: 16.6, arms: [20.6] },
    { x: 29.75, arms: [25.3, 34.2] },
    { x: 42.9, arms: [38.1, 47.7] },
    { x: 55.2, arms: [51.4] },
  ];
  for (const z of [-100, -40, 10, 60, 110, 160]) {
    for (const m of mastRows) {
      if (m.x === 42.9 && z < -75) continue;
      if (footbridgeZone(z)) continue;
      addWorldBox(m.x, (PLAT_Y + 7.9) / 2, z, 0.3, 7.9 - PLAT_Y, 0.3);
      for (const ax of m.arms) {
        const a = Math.min(ax, m.x) - 0.3, b = Math.max(ax, m.x) + 0.3;
        addWorldBox((a + b) / 2, 7.25, z, b - a, 0.12, 0.12);
        addWorldBox((a + b) / 2, 6.55, z, b - a, 0.08, 0.08);
      }
    }
  }
  // portaluri in afara peroanelor
  for (let z = -420; z <= 380; z += 55) {
    if (z > -130 && z < 200) continue;
    const xs = localTracks.map(({ L }) => lxAt(L, z)).filter((v) => v != null);
    if (xs.length < 2) continue;
    const a = Math.min(...xs) - 3.2, b = Math.max(...xs) + 3.2;
    for (const x of [a, b]) addWorldBox(x, 4.1, z, 0.35, 8.2, 0.35);
    addWorldBox((a + b) / 2, 8.0, z, b - a + 0.4, 0.35, 0.25);
  }
  C.build(group, { cast: true });
  // fire: contact (6.0 m peste sina) + purtator (cu sageata) + pendule
  for (const { t, L } of localTracks) {
    const pts = L.filter(([lx, lz]) => lz > -425 && lz < 385);
    if (pts.length < 2) continue;
    const dense = densify(pts, 5);
    let prev = null;
    for (let i = 0; i < dense.length; i++) {
      const [lx, lz] = dense[i];
      const span = ((lz + 1000) % 55) / 55;
      const zig = (Math.floor((lz + 1000) / 55) % 2 ? 1 : -1) * (0.2 - 0.4 * span);
      const [x, z] = toWorld(lx + zig, lz);
      const g = yAt(x, z);
      const c = [x, g + RAIL_TOP + 5.5, z];
      const m = [x, g + RAIL_TOP + 6.75 - 0.45 * Math.sin(Math.PI * span), z];
      if (prev) { wires.push(...prev.c, ...c, ...prev.m, ...m); }
      if (i % 2 === 0) wires.push(...c, ...m);
      prev = { c, m };
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2b3036, transparent: true, opacity: 0.85 }));
  wl.name = 'catenara-fire';
  group.add(wl);
  return { group, tracks };
}

function ballastMerge(list) {
  // unire simpla (toate ne-indexate, aceleasi atribute)
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // textura balastului: uv.x pe latime, uv.y in metri -> repetare la 3 m
  for (let i = 0; i < uv.length; i += 2) uv[i + 1] /= 3;
  return out;
}

// ---------------------------------------------------------------------------------------
// Peroanele viitorului (in grupul local rotit)
export function buildPlatforms(ctx, M, root, atlas, displays) {
  const group = new THREE.Group();
  group.name = 'peroane-viitor';
  root.add(group);
  const B = new Batch('peroane');
  const P = new Phys('peroane');
  const edgeOf = { P1: [[1, 'L1']], P2: [[-1, 'L2'], [1, 'L3']], P3: [[-1, 'L4'], [1, 'L5']] };
  let pvArea = 0;

  for (const p of PLATFORMS) {
    const { x0, x1, z0, z1 } = p;
    B.aabb(M.concrete, x0, 0.3, z0, x1, PLAT_Y - 0.03, z1);
    B.hquad(M.platform, x0, z0, x1, z1, PLAT_Y, 2);
    P.floor(x0, z0, x1, z1, PLAT_Y);
    for (const [side, tid] of edgeOf[p.id]) {
      const xe = side > 0 ? x1 : x0;
      // bordura alba, banda tactila (buline) si linia de siguranta
      B.aabb(M.white, xe - side * 0.35, PLAT_Y, z0, xe, PLAT_Y + 0.02, z1);
      const xt0 = xe - side * 0.55, xt1 = xe - side * 0.95;
      B.add(M.tactile, triGeo([
        [Math.min(xt0, xt1), PLAT_Y + 0.02, z0], [Math.min(xt0, xt1), PLAT_Y + 0.02, z1], [Math.max(xt0, xt1), PLAT_Y + 0.02, z1],
        [Math.min(xt0, xt1), PLAT_Y + 0.02, z0], [Math.max(xt0, xt1), PLAT_Y + 0.02, z1], [Math.max(xt0, xt1), PLAT_Y + 0.02, z0],
      ], [[0, 0], [0, (z1 - z0) / 0.4], [1, (z1 - z0) / 0.4], [0, 0], [1, (z1 - z0) / 0.4], [1, 0]]));
      // banda LED pe muchia peronului (pulseaza la sosirea trenului)
      B.aabb(M.edge[tid], xe - side * 0.06, PLAT_Y - 0.06, z0, xe + side * 0.01, PLAT_Y + 0.032, z1);
    }
    // capete: rampa 6 % pe peronul 1 (acces fara trepte din piata) / parapet pe insule
    if (p.id === 'P1') {
      for (const [zs, dir] of [[z0, -1], [z1, 1]]) {
        const L = (PLAT_Y - PAVE_Y) / 0.06;
        const ze = zs + dir * L;
        let tri = [[x0, PLAT_Y, zs], [x1 - 1, PLAT_Y, zs], [x1 - 1, PAVE_Y, ze], [x0, PLAT_Y, zs], [x1 - 1, PAVE_Y, ze], [x0, PAVE_Y, ze]];
        let tuv = [[0, 0], [4, 0], [4, 6], [0, 0], [4, 6], [0, 6]];
        if (dir > 0) { tri = [tri[0], tri[2], tri[1], tri[3], tri[5], tri[4]]; tuv = [tuv[0], tuv[2], tuv[1], tuv[3], tuv[5], tuv[4]]; }
        B.add(M.platform, triGeo(tri, tuv));
        P.ramp((x0 + x1 - 1) / 2, zs, PLAT_Y, (x0 + x1 - 1) / 2, ze, PAVE_Y, x1 - 1 - x0);
        B.aabb(M.steel, x1 - 1.05, PAVE_Y, Math.min(zs, ze), x1 - 0.95, PLAT_Y + 1.0, Math.max(zs, ze));
      }
    } else {
      for (const z of [z0, z1]) B.aabb(M.steelWhite, x0 + 0.3, PLAT_Y, z - 0.05, x1 - 0.3, PLAT_Y + 1.1, z + 0.05);
    }
  }

  // ---------------- statia T1 pe fata de VEST a peronului 1 (sud de cladire) ----------------
  // linia T1 (modulul de transport) are axa la x = 8,1, oprire z 66 … 116; usile tramvaiului dau spre est, pe peron.
  {
    const xe = PLATFORMS[0].x0, za = 62, zb = 118;
    B.aabb(M.white, xe, PLAT_Y, za, xe + 0.3, PLAT_Y + 0.02, zb);
    B.add(M.tactile, triGeo([
      [xe + 0.5, PLAT_Y + 0.02, za], [xe + 0.9, PLAT_Y + 0.02, zb], [xe + 0.9, PLAT_Y + 0.02, za],
      [xe + 0.5, PLAT_Y + 0.02, za], [xe + 0.5, PLAT_Y + 0.02, zb], [xe + 0.9, PLAT_Y + 0.02, zb],
    ], [[0, 0], [1, (zb - za) / 0.4], [1, 0], [0, 0], [0, (zb - za) / 0.4], [1, (zb - za) / 0.4]]));
    B.aabb(M.ledOrange, xe - 0.01, PLAT_Y - 0.06, za, xe + 0.06, PLAT_Y + 0.032, zb);
    // semn + afisaj „T1 → Hub Turbion A7×A8” (pe stalpul copertinei, cu fata spre nord si spre sud)
    for (const z of [70, 110]) {
      B.aabb(M.steel, 11.6 - 0.03, PLAT_Y, z - 0.03, 11.6 + 0.03, PLAT_Y + 2.9, z + 0.03);
      addSign(B, M, atlas, 't1', 11.6, PLAT_Y + 3.15, z, 0, 2.2, 0.55);
    }
  }

  // ---------------- copertine fotovoltaice ondulate ----------------
  for (const [pid, c] of Object.entries(CANOPIES)) {
    for (const [za, zb] of c.segs) {
      const xm = (c.x0 + c.x1) / 2;
      const top = [], bot = [], tuv = [];
      const dz = 2;
      const prof = (x) => (c.butterfly ? 0.32 * Math.abs(x - xm) / ((c.x1 - c.x0) / 2) : 0.25 * (x - c.x0) / (c.x1 - c.x0));
      const xsP = c.butterfly ? [c.x0, xm, c.x1] : [c.x0, c.x1];
      for (let z = za; z < zb - 0.01; z += dz) {
        const z2 = Math.min(zb, z + dz);
        for (let k = 0; k < xsP.length - 1; k++) {
          const xa = xsP[k], xb = xsP[k + 1];
          const A = [xa, canopyY(z) + prof(xa), z], Bq = [xb, canopyY(z) + prof(xb), z], Cq = [xb, canopyY(z2) + prof(xb), z2], D = [xa, canopyY(z2) + prof(xa), z2];
          top.push(A, D, Cq, A, Cq, Bq);
          const u = (x) => (x - c.x0) / 1.05, v = (zz) => zz / 1.7;
          tuv.push([u(xa), v(z)], [u(xa), v(z2)], [u(xb), v(z2)], [u(xa), v(z)], [u(xb), v(z2)], [u(xb), v(z)]);
          const off = (q) => [q[0], q[1] - 0.18, q[2]];
          bot.push(off(A), off(Bq), off(Cq), off(A), off(Cq), off(D));
        }
        // benzi LED pe marginile copertinei
        for (const xe of [c.x0 + 0.08, c.x1 - 0.08]) {
          const ya = canopyY(z) + prof(xe) - 0.22, yb = canopyY(z2) + prof(xe) - 0.22;
          B.add(M.ledCool, new THREE.BoxGeometry(0.08, 0.05, z2 - z + 0.02), xe, (ya + yb) / 2, (z + z2) / 2, 0, -Math.atan2(yb - ya, z2 - z));
        }
      }
      // ensure top normals up
      B.add(M.pv, triGeo(top, tuv));
      B.add(M.steelWhite, triGeo(bot));
      pvArea += (c.x1 - c.x0) * (zb - za);
      // stalpi + grinzi transversale la 12 m
      for (let z = za + 3; z < zb - 1; z += 12) {
        const y = canopyY(z) + prof(c.colX) - 0.2;
        B.aabb(M.steelWhite, c.colX - 0.15, PLAT_Y, z - 0.15, c.colX + 0.15, y, z + 0.15);
        B.add(M.steelWhite, new THREE.BoxGeometry(c.x1 - c.x0 - 0.2, 0.22, 0.2), xm, y - 0.05, z);
        P.wallAabb(c.colX - 0.17, PLAT_Y, z - 0.17, c.colX + 0.17, PLAT_Y + 2.4, z + 0.17);
      }
    }
  }

  // ---------------- mobilier de peron ----------------
  const benches = [], sos = [], cams = [], bins = [], shelters = [];
  const binCols = [0x2563eb, 0xeab308, 0x16a34a, 0x7a4a26];
  const avoid = (z) => (z > -84 && z < -44) || (z > -36 && z < -22);
  for (let z = -100; z <= 160; z += 16) {
    if (avoid(z)) continue;
    if (z > -46 && z < 44) benches.push({ x: 11.4, y: PLAT_Y, z, ry: Math.PI / 2 });
    else benches.push({ x: 12.2, y: PLAT_Y, z, ry: Math.PI / 2 });
  }
  for (const pid of ['P2', 'P3']) {
    const p = PLATFORMS.find((q) => q.id === pid), xc = (p.x0 + p.x1) / 2;
    for (let z = p.z0 + 10; z < p.z1 - 6; z += 24) {
      if (avoid(z) || Math.abs(z - 20) < 6 || Math.abs(z - 92) < 6) continue;
      benches.push({ x: xc - 0.55, y: PLAT_Y, z, ry: -Math.PI / 2 }, { x: xc + 0.55, y: PLAT_Y, z, ry: Math.PI / 2 });
    }
    for (const z of [20, 92]) shelters.push([xc, z, p.x1 - p.x0]);
  }
  for (const p of PLATFORMS) {
    const xc = p.id === 'P1' ? 12.0 : (p.x0 + p.x1) / 2;
    for (const z of [-14, 104]) sos.push({ x: xc, y: PLAT_Y, z, ry: p.id === 'P1' ? Math.PI / 2 : 0 });
    const c = CANOPIES[p.id];
    for (const z of [-40, 0, 40, 80, 120, 160]) if (z < p.z1 - 5) cams.push({ x: c.colX, y: canopyY(z) - 0.6, z: z + 3.2, ry: z % 80 ? 0 : Math.PI });
    const bz = p.id === 'P1' ? 52 : 46;
    [-0.9, -0.3, 0.3, 0.9].forEach((d, i) => bins.push({ x: (p.id === 'P1' ? 12.0 : xc), y: PLAT_Y, z: bz + d, ry: Math.PI / 2, c: binCols[i] }));
  }
  instancedPair(group, GEO.benchWood, M.seatWood, GEO.benchSteel, M.steel, benches, { name: 'banci-peron' });
  instancedPair(group, GEO.sosColumn, M.red, GEO.sosButton, M.sosGlow, sos, { name: 'coloane-sos' });
  group.add(instanced(GEO.cctv, M.dark, cams, { cast: false, name: 'camere-peron' }));
  const binMesh = instanced(GEO.bin, M.white, bins, { colors: bins.map((b) => b.c), name: 'cosuri-peron' });
  group.add(binMesh);
  for (const [xc, z, w] of shelters) {
    const sw = Math.min(2.2, w - 2.4);
    B.aabb(M.steelWhite, xc - sw / 2, PLAT_Y + 2.4, z - 3.1, xc + sw / 2, PLAT_Y + 2.5, z + 3.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.aabb(M.steel, xc + sx * sw / 2 - 0.04, PLAT_Y, z + sz * 3 - 0.04, xc + sx * sw / 2 + 0.04, PLAT_Y + 2.4, z + sz * 3 + 0.04);
    B.add(M.glass, panelGeo(6, 2.3), xc - sw / 2, PLAT_Y + 1.2, z, Math.PI / 2);
    B.add(M.glass, panelGeo(6, 2.3), xc + sw / 2, PLAT_Y + 1.2, z, Math.PI / 2);
    B.add(M.glass, panelGeo(sw, 2.3), xc, PLAT_Y + 1.2, z - 3, 0);
    B.aabb(M.seatWood, xc - 0.4, PLAT_Y + 0.42, z - 2.2, xc + 0.4, PLAT_Y + 0.48, z + 2.2);
    B.aabb(M.ledCool, xc - 0.1, PLAT_Y + 2.38, z - 2.8, xc + 0.1, PLAT_Y + 2.4, z + 2.8);
  }
  // ecrane de peron (randul = numarul liniei) + semne cu numarul peronului
  const dispMat = new THREE.MeshBasicMaterial({ map: displays.texture, toneMapped: false });
  dispMat.name = 'ecrane-peron';
  const dispSpots = { P1: [[16.6, 1]], P2: [[28.65, 2], [30.85, 3]], P3: [[41.8, 4], [44.0, 5]] };
  for (const p of PLATFORMS) {
    for (const z of [-24, 46, 116]) {
      if (z > p.z1 - 5) continue;
      const y = PLAT_Y + 3.0;
      for (const [x, line] of dispSpots[p.id]) {
        const uv = displays.uvRow(line - 1);
        B.aabb(M.dark, x - 1.06, y - 0.24, z - 0.06, x + 1.06, y + 0.24, z + 0.06);
        B.add(dispMat, panelGeo(2.0, 0.375, ...uv), x, y, z + 0.065, 0);
        B.add(dispMat, panelGeo(2.0, 0.375, ...uv), x, y, z - 0.065, Math.PI);
        B.aabb(M.steel, x - 0.02, y + 0.24, z - 0.02, x + 0.02, canopyY(z) - 0.1, z + 0.02);
      }
      addSign(B, M, atlas, p.id.toLowerCase(), CANOPIES[p.id].colX, PLAT_Y + 3.0, z + 6, 0, 1.6, 0.4);
    }
    // iesire de urgenta la capete
    for (const z of [p.z0 + 2, p.z1 - 2]) addSign(B, M, atlas, 'exit', CANOPIES[p.id].colX, PLAT_Y + 2.6, z, 0, 1.2, 0.3);
  }

  const meshes = B.build(group);
  const phys = P.build(group);
  return { group, meshes, phys, pvArea };
}

// ---------------------------------------------------------------------------------------
// Peroanele de azi (joase, pavele rosii, traversari la nivel peste linii) — pentru comparatia „azi”
export function buildTodayPlatforms(ctx, M, root) {
  const group = new THREE.Group();
  group.name = 'peroane-azi';
  root.add(group);
  const B = new Batch('peroane-azi');
  const P = new Phys('peroane-azi');
  const Y = 0.62;
  const old = [[9.8, 18.7, -107, 170], [27.15, 32.35, -75, 178], [39.95, 45.85, -66, 166]];
  for (const [x0, x1, z0, z1] of old) {
    B.aabb(M.concrete, x0, 0.3, z0, x1, Y - 0.02, z1);
    B.hquad(M.platformOld, x0, z0, x1, z1, Y, 2);
    P.floor(x0, z0, x1, z1, Y);
  }
  // traversari la nivel (dulapi de lemn) — azi calatorii trec peste linii
  for (const z of [-4, 58]) {
    for (const [a, b] of [[18.7, 27.15], [32.35, 39.95]]) {
      for (let x = a; x < b - 0.01; x += 0.62) B.aabb(M.seatWood, x + 0.02, 0.5, z - 1.2, x + 0.6, 0.6, z + 1.2);
      P.floor(a, z - 1.2, b, z + 1.2, 0.6);
    }
  }
  // stalpi de iluminat vechi (glob)
  const lamps = [];
  for (const [x0, x1, z0, z1] of old) for (let z = z0 + 12; z < z1; z += 30) lamps.push({ x: (x0 + x1) / 2 + (x0 < 15 ? 2.5 : 0), y: Y, z });
  const pole = new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6); pole.translate(0, 2.1, 0);
  const globe = new THREE.SphereGeometry(0.28, 10, 8); globe.translate(0, 4.4, 0);
  group.add(instanced(pole, M.dark, lamps, { name: 'stalpi-peron-azi' }), instanced(globe, M.lamp, lamps, { cast: false, name: 'globuri-peron-azi' }));
  const meshes = B.build(group);
  const phys = P.build(group);
  return { group, meshes, phys };
}
