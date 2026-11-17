import * as THREE from 'three';
import { merge, box, cyl, tint, makeCanvas, canvasTex, roundRect, drawPlane, wheelSet } from './util3d.js';

// Hub-ul de mobilitate "Hub Turbion A7×A8": capatul T1, autocare spre aeroporturi, park & ride,
// incarcatoare rapide pentru masini electrice, bike sharing, vertiport eVTOL pe acoperis,
// spatii verzi si colectare selectiva. Sistem local: u (x local) = inapoi pe linie (spre oras),
// v (z local) = spre stanga liniei (SE), y = sus. Originea = centrul peronului terminus.

export const COACH_DEST = [
  { code: 'IAS', text: '✈ Aeroport Iași (IAS) · 55 min', color: '#38bdf8', hex: 0x38bdf8, via: 'A8 Est' },
  { code: 'SCV', text: '✈ Aeroport Suceava (SCV) · 45 min', color: '#a78bfa', hex: 0xa78bfa, via: 'A7 Nord' },
  { code: 'BCM', text: '✈ Aeroport Bacău (BCM) · 60 min', color: '#fb923c', hex: 0xfb923c, via: 'A7 Sud' },
  { code: 'REG', text: '🚌 Târgu Frumos · Roman · Târgu Neamț', color: '#4ade80', hex: 0x4ade80, via: 'A8 / A7' },
];

export function buildHub(ctx, route, shared) {
  const H = ctx.terrain.heightAt;
  const group = new THREE.Group();
  group.name = 'hub-turbion';
  const stop = route.stops[route.stops.length - 1];
  const O = route.pos(stop.s);
  const tg = route.tangent(stop.s).setY(0).normalize();
  const right = new THREE.Vector3(-tg.z, 0, tg.x);
  const X = tg.clone().negate(), Z = right.clone().negate(), Y = new THREE.Vector3(0, 1, 0);
  const y0 = O.y + 0.42; // cota peronului / pietei
  const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(O.x, 0, O.z);
  const toWorld = (u, y, v) => new THREE.Vector3(u, y, v).applyMatrix4(M);
  const terr = (u, v) => { const p = toWorld(u, 0, v); return H(p.x, p.z); };
  const maxTerr = (u0, u1, v0, v1) => {
    let m = -Infinity;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) m = Math.max(m, terr(u0 + (u1 - u0) * i / 6, v0 + (v1 - v0) * j / 6));
    return m;
  };

  const parts = { con: [], glass: [], pv: [], steel: [], glow: [], paint: [], grass: [], asph: [] };
  const add = (k, g) => { g.applyMatrix4(M); parts[k].push(g); return g; };

  // ---------- platforme (piete) pe niveluri, cu ziduri de sprijin pana la teren ----------
  const levelB = Math.max(y0, maxTerr(-62, 62, 5, 92) + 0.3);
  const levelP = Math.max(levelB - 0.2, maxTerr(-62, 62, 95, 160) + 0.3);
  function slab(u0, u1, v0, v1, top, color, kind = 'con') {
    const bot = Math.min(terr(u0, v0), terr(u1, v0), terr(u0, v1), terr(u1, v1)) - 1.2;
    const h = Math.max(0.4, top - bot);
    add(kind, box(u1 - u0, h, v1 - v0, (u0 + u1) / 2, top - h / 2, (v0 + v1) / 2, color));
  }
  slab(-62, 62, 5.2, 93, levelB, 0xc9c6bf);           // piata hub-ului
  slab(-62, 62, 93, 160, levelP, 0x4b4f55, 'asph');   // parcare P+R
  if (levelB - y0 > 0.05) {
    // trepte / rampa intre peron si piata
    add('con', box(46, levelB - y0 + 0.4, 3, 0, y0 + (levelB - y0) / 2 - 0.2, 6.5, 0xb9bdc2));
  }
  // dale decorative si benzi de ghidaj tactil pe piata
  add('glow', box(0.6, 0.02, 80, 0, levelB + 0.02, 49, 0xf5c518)); // traseu tactil peron T1 -> autocare
  for (let u = -55; u <= 55; u += 10) add('con', box(0.12, 0.02, 85, u, levelB + 0.015, 49, 0xa8a49b));

  // ---------- cladirea hub-ului (2 niveluri, fatade vitrate) ----------
  const bU0 = -42, bU1 = 34, bV0 = 12, bV1 = 46, bH = 10.5;
  const bCx = (bU0 + bU1) / 2, bCv = (bV0 + bV1) / 2;
  add('con', box(bU1 - bU0, 0.4, bV1 - bV0, bCx, levelB + 5.0, bCv, 0xe5e7eb));       // planseu etaj
  add('con', box(bU1 - bU0, 0.6, bV1 - bV0, bCx, levelB + bH, bCv, 0xd1d5db));        // acoperis cladire
  // nucleu (scari, lifturi, grupuri sanitare)
  add('con', box(10, bH, 8, bU0 + 8, levelB + bH / 2, bV1 - 6, 0xf1f5f9));
  // pereti vitrati (cu goluri pentru usi pe laturile spre tramvai si spre autocare)
  const glassWall = (u0, u1, v, doors) => {
    let u = u0;
    for (const [d0, d1] of doors.concat([[u1, u1]])) {
      if (d0 > u) add('glass', box(d0 - u, bH - 0.3, 0.06, (u + d0) / 2, levelB + bH / 2 - 0.15, v, 0xffffff));
      if (d1 > d0) add('glass', box(d1 - d0, bH - 3.2, 0.06, (d0 + d1) / 2, levelB + bH - 1.6, v, 0xffffff));
      u = d1;
    }
    for (let k = u0; k <= u1; k += 4) add('steel', box(0.12, bH, 0.14, k, levelB + bH / 2, v, 0x334155));
  };
  glassWall(bU0, bU1, bV0, [[-20, -14], [-4, 4], [14, 20]]);
  glassWall(bU0, bU1, bV1, [[-10, -4], [10, 16]]);
  for (const u of [bU0, bU1]) {
    const g = box(0.06, bH - 0.3, bV1 - bV0, u, levelB + bH / 2 - 0.15, bCv, 0xffffff);
    add('glass', g);
  }
  // colizioni (pereti) pentru plimbare – cutii invizibile pe segmentele de perete fara usi
  const colliderBoxes = [];
  const wallCol = (u0, u1, v0, v1) => colliderBoxes.push([u0, u1, v0, v1]);
  [[bU0, -20], [-14, -4], [4, 14], [20, bU1]].forEach(([a, b]) => wallCol(a, b, bV0 - 0.15, bV0 + 0.15));
  [[bU0, -10], [-4, 10], [16, bU1]].forEach(([a, b]) => wallCol(a, b, bV1 - 0.15, bV1 + 0.15));
  wallCol(bU0 - 0.15, bU0 + 0.15, bV0, bV1); wallCol(bU1 - 0.15, bU1 + 0.15, bV0, bV1);
  // interior: banci, ghisee, zona de asteptare, plante
  for (let u = -30; u <= 20; u += 6) {
    add('paint', box(3.2, 0.45, 0.6, u, levelB + 0.23, 30, 0xf97316));
    add('paint', box(3.2, 0.5, 0.1, u, levelB + 0.7, 30.3, 0x334155));
  }
  add('paint', box(10, 1.1, 1.0, -26, levelB + 0.55, 40, 0xe2e8f0)); // ghiseu informatii
  for (const u of [-34, -12, 8, 26]) {
    add('grass', cyl(0.7, 0.6, 0.8, 10, u, levelB + 0.4, 22, 0x6b4f3a));
    add('grass', tint(new THREE.IcosahedronGeometry(1.1, 0).translate(u, levelB + 1.6, 22), 0x2f6b34));
  }

  // ---------- acoperisul mare fotovoltaic (acopera si peronul T1) ----------
  const roofY = levelB + 13.2;
  const rU0 = -58, rU1 = 46, rV0 = -9, rV1 = 60;
  add('steel', box(rU1 - rU0, 0.7, rV1 - rV0, (rU0 + rU1) / 2, roofY - 0.35, (rV0 + rV1) / 2, 0xe2e8f0));
  const pvg = new THREE.PlaneGeometry(rU1 - rU0 - 1, rV1 - rV0 - 1, 1, 1);
  pvg.rotateX(-Math.PI / 2);
  const uvA = pvg.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * (rU1 - rU0) / 6, uvA.getY(i) * (rV1 - rV0) / 6);
  pvg.translate((rU0 + rU1) / 2, roofY + 0.02, (rV0 + rV1) / 2);
  add('pv', pvg);
  // benzi LED sub acoperis (iluminat nocturn al peronului si al pietei)
  for (let v = -4; v <= 56; v += 10) add('glow', box(rU1 - rU0 - 6, 0.06, 0.35, (rU0 + rU1) / 2, roofY - 0.74, v, 0xfff1d0));
  // luminatoare (benzi vitrate)
  for (const v of [8, 25, 42]) add('glass', box(rU1 - rU0 - 8, 0.1, 2.2, (rU0 + rU1) / 2, roofY + 0.05, v, 0xffffff));
  // stalpi "copac" (trunchi + 4 brate)
  for (const u of [-50, -26, -2, 22, 42]) for (const v of [-6, 54]) {
    if (v === -6 && Math.abs(u) < 26) continue; // nu pe peronul tramvaiului
    add('steel', cyl(0.35, 0.45, roofY - levelB, 10, u, levelB + (roofY - levelB) / 2, v, 0xcbd5e1));
    for (const [du, dv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new THREE.CylinderGeometry(0.12, 0.18, 5.5, 6);
      arm.rotateZ(du * 0.55); arm.rotateX(dv * 0.55);
      arm.translate(u + du * 1.3, roofY - 2.3, v - dv * 1.3);
      add('steel', tint(arm, 0xcbd5e1));
    }
  }

  // ---------- vertiport eVTOL pe acoperis ----------
  const vpU = 20, vpV = 30, vpY = roofY + 2.2;
  add('con', cyl(12, 12, 0.5, 40, vpU, vpY - 0.25, vpV, 0x374151));
  add('con', cyl(1.4, 1.8, 2.0, 12, vpU, roofY + 1.0, vpV, 0x9ca3af));
  add('glow', cyl(9.2, 9.2, 0.02, 40, vpU, vpY + 0.01, vpV, 0xffffff));
  add('con', cyl(8.9, 8.9, 0.03, 40, vpU, vpY + 0.02, vpV, 0x374151));
  // litera V (vertiport) din doua benzi
  for (const sgn of [-1, 1]) {
    const b = new THREE.BoxGeometry(0.9, 0.03, 6.5); b.rotateY(sgn * 0.33); b.translate(vpU + sgn * 1.1, vpY + 0.05, vpV);
    add('glow', tint(b, 0xfacc15));
  }
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; add('glow', box(0.3, 0.12, 0.3, vpU + Math.cos(a) * 11.4, vpY + 0.05, vpV + Math.sin(a) * 11.4, 0x22d3ee)); }
  // vehiculul eVTOL (fuzelaj + 6 rotoare)
  const evtol = new THREE.Group();
  const evMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.3 });
  const evDark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.2, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 3.0, 6, 12).rotateX(Math.PI / 2), evMat);
  body.position.y = 1.3;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1.5), evDark);
  canopy.position.set(0, 1.75, -0.9);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 1.0), evMat); wing.position.y = 1.8;
  const rotors = [];
  evtol.add(body, canopy, wing);
  for (const sx of [-4.4, 4.4]) for (const sz of [-2.2, 0, 2.2]) {
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 5.2), evMat);
    boom.position.set(sx, 1.85, 0);
    if (sz === 0) evtol.add(boom);
    const rot = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.03, 0.2), evDark);
    rot.position.set(sx, 2.05, sz);
    rotors.push(rot); evtol.add(rot);
  }
  for (const sx of [-0.8, 0.8]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.2), evDark); sk.position.set(sx, 0.35, 0); evtol.add(sk); }
  const evBase = toWorld(vpU, vpY, vpV);
  evtol.position.copy(evBase);
  evtol.rotation.y = Math.atan2(X.x, X.z);
  group.add(evtol);

  // ---------- peroane autocare (dinti de fierastrau) + semnalizare digitala ----------
  const bayV = 66;
  add('asph', box(110, 0.06, 14, -6, levelB + 0.03, bayV + 9, 0x3f4349));   // banda autocare
  for (let k = 0; k <= 30; k++) add('glow', box(2.0, 0.02, 0.15, -60 + k * 3.7, levelB + 0.07, bayV + 9, 0xf8fafc));
  const coachParts = [];
  const signMeshes = [];
  COACH_DEST.forEach((d, i) => {
    const u = -40 + i * 24;
    // peron + copertina
    add('con', box(18, 0.25, 4, u, levelB + 0.13, bayV - 1, 0xd6d3cd));
    add('glow', box(18, 0.02, 0.5, u, levelB + 0.27, bayV + 0.75, 0xf5c518));
    add('steel', box(0.15, 3.4, 0.15, u - 7, levelB + 1.7, bayV - 2.6, 0x475569));
    add('steel', box(0.15, 3.4, 0.15, u + 7, levelB + 1.7, bayV - 2.6, 0x475569));
    add('steel', box(17, 0.2, 4.6, u, levelB + 3.5, bayV - 1, 0x475569));
    const pvb = new THREE.PlaneGeometry(17, 4.6); pvb.rotateX(-Math.PI / 2);
    const ua = pvb.attributes.uv; for (let j = 0; j < ua.count; j++) ua.setXY(j, ua.getX(j) * 3, ua.getY(j));
    pvb.translate(u, levelB + 3.62, bayV - 1); add('pv', pvb);
    // autocarul parcat (livrea in culoarea liniei)
    const c = [
      box(2.55, 3.1, 12.4, 0, 1.85, 0, 0xf8fafc), box(2.57, 1.05, 11.8, 0, 2.35, 0.2, 0x1e293b),
      box(2.58, 0.4, 12.42, 0, 1.0, 0, d.hex), box(2.45, 1.3, 0.05, 0, 2.3, -6.21, 0x1e293b),
      box(2.0, 0.25, 0.05, 0, 3.15, -6.22, d.hex),
    ];
    c.push(...wheelSet(0.5, 0.3, 1.05, [-4.1, 3.6, 4.9]));
    const cg = merge(c);
    cg.rotateY(Math.PI / 2 - 0.35);
    cg.translate(u + 1, levelB, bayV + 6.5);
    coachParts.push(cg.applyMatrix4(M));
    // totem digital
    const canvas = makeCanvas(512, 256), g = canvas.getContext('2d');
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = d.color; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#0b1220'; g.font = 'bold 34px Segoe UI, Arial'; g.textBaseline = 'middle';
    g.fillText(`Peron ${i + 1}`, 18, 33);
    g.textAlign = 'right'; g.fillText(d.via, 494, 33); g.textAlign = 'left';
    if (d.code !== 'REG') drawPlane(g, 52, 140, 62, d.color, -Math.PI / 4);
    g.fillStyle = '#fff'; g.font = 'bold 30px Segoe UI, Arial';
    const parts2 = d.text.replace('✈ ', '').replace('🚌 ', '').split(' · ');
    g.fillText(parts2[0], d.code !== 'REG' ? 100 : 18, 124, 400);
    g.fillStyle = '#facc15'; g.font = 'bold 40px Segoe UI, Arial';
    g.fillText(parts2[1] || '', d.code !== 'REG' ? 100 : 18, 178, 400);
    g.fillStyle = '#94a3b8'; g.font = '22px Segoe UI, Arial';
    g.fillText('plecare la fiecare 30 min · bilet integrat T1 + autocar', 18, 230, 476);
    const tex = canvasTex(canvas);
    const sm = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const pg = new THREE.PlaneGeometry(3.2, 1.6);
    pg.rotateY(Math.PI); // fata spre -v (spre piata)
    const sign = new THREE.Mesh(pg, sm);
    sign.position.copy(toWorld(u - 4, levelB + 2.3, bayV - 2.75));
    sign.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    group.add(sign);
    signMeshes.push(sign);
    add('steel', box(3.4, 1.8, 0.1, u - 4, levelB + 2.3, bayV - 2.68, 0x111827));
    add('steel', box(0.15, 1.5, 0.15, u - 4, levelB + 0.75, bayV - 2.65, 0x111827));
  });

  // ---------- parcare P+R: marcaje, copertine PV, incarcatoare rapide ----------
  const prV0 = 100, rows = [104, 118, 132, 146];
  for (const v of rows) for (let u = -58; u <= 58; u += 2.6) add('glow', box(0.12, 0.02, 5.0, u, levelP + 0.02, v, 0xe5e7eb));
  // copertine fotovoltaice peste parcare
  for (const v of [111, 139]) {
    add('steel', box(118, 0.3, 11, 0, levelP + 3.6, v, 0x64748b));
    const pc = new THREE.PlaneGeometry(118, 11); pc.rotateX(-Math.PI / 2); pc.rotateZ(0.08);
    const ua = pc.attributes.uv; for (let j = 0; j < ua.count; j++) ua.setXY(j, ua.getX(j) * 20, ua.getY(j) * 2);
    pc.translate(0, levelP + 3.85, v); add('pv', pc);
    for (let u = -56; u <= 56; u += 8) add('steel', box(0.25, 3.6, 0.25, u, levelP + 1.8, v, 0x64748b));
  }
  // incarcatoare rapide (prima linie)
  const chargers = [];
  for (let u = -56; u <= 56; u += 5.2) {
    add('steel', box(0.6, 1.9, 0.45, u, levelP + 0.95, prV0 + 0.8, 0xf1f5f9));
    add('glow', box(0.4, 0.3, 0.02, u, levelP + 1.45, prV0 + 0.56, 0x22c55e));
    add('glow', box(0.62, 0.08, 0.47, u, levelP + 1.92, prV0 + 0.8, 0x22d3ee));
    chargers.push(u);
  }
  // masini parcate (instantiate)
  const carGeo = merge([box(1.8, 0.62, 4.4, 0, 0.56, 0, 0xffffff), box(1.58, 0.52, 2.3, 0, 1.13, 0.15, 0x1e293b), box(1.82, 0.2, 4.42, 0, 0.32, 0, 0x22262b), ...wheelSet(0.32, 0.2, 0.8, [-1.38, 1.38])]);
  const carSlots = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const v of rows) for (let u = -56.7; u <= 56; u += 2.6) if (rnd() < 0.72) carSlots.push([u, v + (rnd() - 0.5) * 0.3]);
  const cars = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }), carSlots.length);
  const cols = [0xf8fafc, 0x1f2937, 0x9ca3af, 0xb91c1c, 0x1d4ed8, 0x065f46, 0x64748b, 0xe5e7eb];
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  carSlots.forEach(([u, v], i) => {
    const w = toWorld(u, levelP, v);
    m4.makeRotationY(Math.atan2(Z.x, Z.z)).setPosition(w);
    cars.setMatrixAt(i, m4);
    cars.setColorAt(i, col.setHex(cols[Math.floor(rnd() * cols.length)]));
  });
  cars.castShadow = true; cars.name = 'parcare-masini';
  group.add(cars);

  // ---------- bike sharing ----------
  for (let k = 0; k < 14; k++) {
    const u = 38 + (k % 7) * 1.1, v = 7.5 + Math.floor(k / 7) * 2.6;
    add('steel', box(0.08, 0.8, 0.08, u, levelB + 0.4, v, 0x64748b));
    add('paint', cyl(0.34, 0.34, 0.05, 12, u, levelB + 0.36, v - 0.55, 0x111827, 0, Math.PI / 2));
    add('paint', cyl(0.34, 0.34, 0.05, 12, u, levelB + 0.36, v + 0.55, 0x111827, 0, Math.PI / 2));
    add('paint', box(0.06, 0.06, 1.1, u, levelB + 0.62, v, 0x22c55e));
    add('paint', box(0.06, 0.5, 0.06, u, levelB + 0.62, v - 0.25, 0x22c55e));
  }
  add('steel', box(0.3, 2.4, 1.2, 37, levelB + 1.2, 10.5, 0x22c55e)); // totem bike sharing

  // ---------- spatii verzi, copaci, cosuri selective ----------
  add('grass', box(110, 0.3, 4, -6, levelB + 0.15, 54, 0x4d7c35));
  add('grass', box(110, 0.3, 4, -6, levelB + 0.15, 88.5, 0x4d7c35));
  add('grass', box(14, 0.3, 30, 52, levelB + 0.15, 30, 0x4d7c35));
  const treePts = [];
  for (let u = -56; u <= 52; u += 8) { treePts.push([u, 54, levelB]); treePts.push([u + 4, 88.5, levelB]); }
  for (let v = 18; v <= 42; v += 8) treePts.push([52, v, levelB]);
  for (let u = -60; u <= 60; u += 12) treePts.push([u, 157, levelP]);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 1).translate(0, 5.2, 0), new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, flatShading: true }), treePts.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.26, 3.6, 6).translate(0, 1.8, 0), new THREE.MeshStandardMaterial({ color: 0x5a4030 }), treePts.length);
  treePts.forEach(([u, v, yy], i) => { m4.makeTranslation(toWorld(u, yy, v)); crown.setMatrixAt(i, m4); trunk.setMatrixAt(i, m4); });
  crown.castShadow = true;
  group.add(crown, trunk);
  for (const [u, v] of [[-17, 9], [17, 9], [-7, 49], [13, 49]]) {
    [0x2563eb, 0xfacc15, 0x16a34a, 0x92400e, 0x6b7280].forEach((c, k) => add('paint', cyl(0.3, 0.27, 1.0, 10, u + k * 0.7, levelB + 0.5, v, c)));
  }

  // ---------- drum de acces (din DJ208L, ocolind capatul liniei) ----------
  add('asph', box(9, 0.08, 120, -66, levelB + 0.04, 40, 0x3f4349));
  add('asph', box(30, 0.08, 9, -55, levelB + 0.04, -14, 0x3f4349));

  // ---------- inscriptia hub-ului + tabela de plecari in hol ----------
  const nameC = makeCanvas(1024, 160), ng = nameC.getContext('2d');
  ng.fillStyle = '#0b1220'; ng.fillRect(0, 0, 1024, 160);
  ng.fillStyle = '#f97316'; ng.fillRect(0, 140, 1024, 20);
  ng.fillStyle = '#fff'; ng.font = 'bold 76px Segoe UI, Arial'; ng.textBaseline = 'middle';
  ng.fillText('HUB TURBION A7 × A8', 30, 72);
  ng.fillStyle = '#38bdf8'; ng.font = 'bold 40px Segoe UI, Arial'; ng.textAlign = 'right';
  ng.fillText('T1 · ✈ · P+R', 994, 72);
  const nameMat = new THREE.MeshBasicMaterial({ map: canvasTex(nameC), toneMapped: false });
  const nameP = new THREE.PlaneGeometry(26, 4.06); nameP.rotateY(Math.PI);
  const nameM = new THREE.Mesh(nameP, nameMat);
  nameM.position.copy(toWorld(-4, roofY - 1.6, rV0 + 0.4));
  nameM.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  group.add(nameM);

  const boardC = makeCanvas(1024, 512);
  const boardTex = canvasTex(boardC);
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  const bp = new THREE.PlaneGeometry(8, 4); bp.rotateY(Math.PI);
  const board = new THREE.Mesh(bp, boardMat);
  board.position.copy(toWorld(-4, levelB + 3.2, bV1 - 1.2));
  board.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  group.add(board);
  function drawBoard(fleetEta) {
    const g = boardC.getContext('2d');
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#e2e8f0'; g.font = 'bold 48px Segoe UI, Arial'; g.textBaseline = 'middle';
    g.fillText('Plecări · Departures', 30, 44);
    const now = ctx.env.hour;
    const hh = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const rowsB = [
      ['T1', '#f97316', 'Gara Pașcani (tren CFR)', fleetEta != null ? `${Math.max(1, Math.round(fleetEta / 60))} min` : '6 min', 'Peron T1'],
      ['✈', '#38bdf8', 'Aeroport Iași (IAS)', hh(now + 0.25), 'Peron 1'],
      ['✈', '#a78bfa', 'Aeroport Suceava (SCV)', hh(now + 0.4), 'Peron 2'],
      ['✈', '#fb923c', 'Aeroport Bacău (BCM)', hh(now + 0.55), 'Peron 3'],
      ['🚌', '#4ade80', 'Târgu Frumos · Roman', hh(now + 0.33), 'Peron 4'],
      ['🚁', '#facc15', 'eVTOL Iași (în test)', hh(now + 1.0), 'Acoperiș'],
    ];
    rowsB.forEach(([ic, c, dst, t, pl], i) => {
      const y = 112 + i * 66;
      g.fillStyle = i % 2 ? '#111a2c' : '#0f172a'; g.fillRect(16, y - 30, 992, 60);
      g.fillStyle = c; roundRect(g, 26, y - 22, 64, 44, 8); g.fill();
      g.fillStyle = '#0b1220'; g.font = 'bold 28px Segoe UI, Arial'; g.textAlign = 'center'; g.fillText(ic, 58, y + 1); g.textAlign = 'left';
      g.fillStyle = '#fff'; g.font = '32px Segoe UI, Arial'; g.fillText(dst, 110, y, 520);
      g.fillStyle = '#facc15'; g.font = 'bold 32px Segoe UI, Arial'; g.fillText(t, 680, y);
      g.fillStyle = '#94a3b8'; g.font = '28px Segoe UI, Arial'; g.fillText(pl, 830, y);
    });
    boardTex.needsUpdate = true;
  }
  drawBoard(null);

  // ---------- asamblare ----------
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const conMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 });
  const matFor = { con: conMat, glass: shared.glassMat, pv: shared.pvMat, steel: shared.steelPaint, glow: glowMat, paint: paintMat, grass: conMat, asph: conMat };
  const meshes = {};
  for (const [k, arr] of Object.entries(parts)) {
    const list = arr.filter(Boolean);
    if (!list.length) continue;
    const g = merge(list, k === 'pv' ? { uv: true, color: false } : k === 'glass' ? { color: false } : {});
    const m = new THREE.Mesh(g, matFor[k]);
    m.name = 'hub-' + k;
    m.castShadow = k !== 'glass' && k !== 'glow';
    m.receiveShadow = true;
    group.add(m);
    meshes[k] = m;
  }
  const coachMesh = new THREE.Mesh(merge(coachParts), paintMat);
  coachMesh.castShadow = true; coachMesh.name = 'hub-autocare';
  group.add(coachMesh);
  ctx.scene.add(group);

  // plimbare: piata + etajul (podea) sunt "walkable"; peretii sunt coliziuni
  ctx.walkables.push(meshes.con, meshes.asph);
  const colMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const [u0, u1, v0, v1] of colliderBoxes) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, u1 - u0), bH, Math.max(0.3, v1 - v0)), colMat);
    c.position.copy(toWorld((u0 + u1) / 2, levelB + bH / 2, (v0 + v1) / 2));
    c.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    c.updateMatrixWorld();
    group.add(c);
    ctx.colliders.push(c);
  }

  // animatie eVTOL: rotoare + zbor de proba (decolare, stationare, aterizare) la ~2 minute
  let tv = 0;
  ctx.addUpdate((dt) => {
    tv += dt;
    const cyc = tv % 120;
    let h = 0;
    if (cyc > 60 && cyc < 100) { const k = (cyc - 60) / 40; h = Math.sin(k * Math.PI) * 45; }
    const spinning = cyc > 52 && cyc < 108;
    for (const r of rotors) r.rotation.y += dt * (spinning ? 28 : 0.0);
    evtol.position.y = evBase.y + h;
    evtol.rotation.y = Math.atan2(X.x, X.z) + (h > 1 ? Math.sin(tv * 0.2) * 0.15 : 0);
  });

  ctx.env.onChange((st) => {
    glowMat.color.setScalar(0.75 + 0.25 * st.night);
  });

  // amprentele mobilierului exterior / interior (verificari automate: nimic in apa, pe carosabil, in cladiri)
  const props = [];
  const prop = (kind, u, y, v, r) => { const p = toWorld(u, y, v); props.push({ stop: 'hub', kind, x: p.x, y: p.y, z: p.z, r }); };
  for (let u = -30; u <= 20; u += 6) prop('banca', u, levelB, 30, 1.7);
  for (const [u, v] of [[-17, 9], [17, 9], [-7, 49], [13, 49]]) prop('cos', u + 1.4, levelB, v, 1.8);
  for (const [u, v, yy] of treePts) prop('copac', u, yy, v, 0.4);
  for (const u of chargers) prop('incarcator', u, levelP, prV0 + 0.8, 0.4);
  COACH_DEST.forEach((d, i) => { const u = -40 + i * 24; prop('adapost-autocar', u - 7, levelB, bayV - 2.6, 0.2); prop('adapost-autocar', u + 7, levelB, bayV - 2.6, 0.2); prop('totem', u - 4, levelB, bayV - 2.65, 0.2); });
  for (let k = 0; k < 14; k++) prop('bicicleta', 38 + (k % 7) * 1.1, levelB, 7.5 + Math.floor(k / 7) * 2.6, 0.6);
  for (const u of [-50, -26, -2, 22, 42]) for (const v of [-6, 54]) if (!(v === -6 && Math.abs(u) < 26)) prop('stalp-acoperis', u, levelB, v, 0.45);

  const center = toWorld(-4, levelB, 40);
  return {
    group, O, X, Z, toWorld, levelB, levelP, roofY, center, drawBoard, props,
    entrance: toWorld(0, levelB, 8),
    vertiport: toWorld(vpU, vpY, vpV),
    coachBay: toWorld(-4, levelB, bayV),
    parking: toWorld(0, levelP, 125),
    yaw: Math.atan2(X.x, X.z),
    walkYaw: Math.atan2(-Z.x, -Z.z),
  };
}
