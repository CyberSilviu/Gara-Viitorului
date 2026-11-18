import * as THREE from 'three';
import { merge, box, cyl, tint, sweepStrip, sweepProfile, makeCanvas, canvasTex, wheelSet } from './util3d.js';
import { solveLevels, verifyLevels, sAtIdx, Yat, DECK, wayKind } from './mw-levels.js';
import { t1Pins } from './road-clear.js';

// Autostrazile A7 si A8 si nodul turbion Pascani–Sodomeni, modelate 3D din datele OSM
// (construction=motorway / motorway_link, cu bridge/layer). Cotele vin din mw-levels.js:
//  - sol ≈ teren netezit; bridge=yes / layer=1 => +7,5 m; layer=2 sau doua pasaje care se intretaie => +15 m;
//    layer=-1 (tunelul A8 vest) => sub teren; orice intersectie in plan ramasa la acelasi nivel este ridicata automat;
//  - rampe cu panta maxima 4,5 %, tabliere pe pile (fara pile pe drumurile de dedesubt), poduri peste paraul Zmeul;
//  - trecerea la nivel a T1 peste DJ208L relocat (cota drumului = cota sinei, parapete intrerupte).
// Trafic animat (autoturisme, autocare, camioane) pe benzi si bretele, faruri / stopuri noaptea.


function laneTexture(kind) {
  const c = makeCanvas(256, 512), g = c.getContext('2d');
  // asfalt
  g.fillStyle = kind === 'road' ? '#4a4d51' : '#3a3d41'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 2600; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  g.fillStyle = '#f2f2ee';
  const line = (u, w, dashed) => {
    const x = u * 256 - w / 2;
    if (!dashed) g.fillRect(x, 0, w, 512);
    else g.fillRect(x, 0, w, 512 * (6 / 18));
  };
  if (kind === 'mw') {
    line(0.066, 5, false); line(0.43, 5, true); line(0.76, 7, false); line(0.985, 5, false);
  } else if (kind === 'link') {
    line(0.09, 6, false); line(0.91, 6, false);
  } else {
    line(0.06, 5, false); line(0.5, 5, true); line(0.94, 5, false);
  }
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildMotorways(ctx, shared, route = null) {
  const osm = ctx.city?.osm;
  if (!osm) return null;
  const H = ctx.terrain.heightAt;
  const nodeXZ = ctx.geo.project(47.21388, 26.70568);
  const group = new THREE.Group();
  group.name = 'autostrazi-a7-a8';

  // ---------------- cote (layer / bridge din OSM + rezolvarea intersectiilor), vezi mw-levels.js ----------------
  // drumurile noi (ex. DJ208L relocat) fata de T1: trecere la nivel la cota sinei sau, unde drumul aproape paralel
  // s-ar suprapune peste platforma, asfalt cu 0,3 m sub platforma (vezi road-clear.js / t1Pins)
  const pins = route ? t1Pins(osm, route, wayKind) : [];
  const lv = solveLevels(osm.roads, osm.rivers, H, { pins });
  const { ways, crossings, maxLift } = lv;
  if (import.meta.env?.DEV) {
    const bad = verifyLevels(lv);
    const fmt = (b) => `${b.kind} ${b.a.ref || b.a.type}/${b.b.ref || b.b.type} @${Math.round(b.x)},${Math.round(b.z)} Δy=${b.dy.toFixed(1)}`;
    const cross = bad.filter((b) => b.kind === 'cross'), side = bad.filter((b) => b.kind === 'side');
    // intersectie la acelasi nivel = eroare; bretele alaturate cu parapete care se ating = doar informativ
    if (cross.length) console.warn('A7/A8: intersectii la acelasi nivel', cross.map(fmt));
    if (side.length) console.info('A7/A8: cai alaturate la cote usor diferite', side.map(fmt));
  }

  // ---------------- geometrie ----------------
  const asphalt = { mw: [], link: [], road: [] };
  const barriers = [], deckFaces = [], skirts = [], pierMats = [], portals = [];
  const lampPos = [];
  function samplesOf(w) {
    const out = [];
    const n = w.pts.length;
    for (let i = 0; i < n; i++) {
      const a = w.pts[Math.max(0, i - 1)], b = w.pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      out.push({ x: w.pts[i][0], y: w.Y[i], z: w.pts[i][1], rx: -dz, rz: dx, s: w.S[i], t: H(w.pts[i][0], w.pts[i][1]), lift: w.lift[i], deck: w.deck[i] });
    }
    return out;
  }
  // grila cu esantioanele tuturor cailor: pilele nu se pun pe un drum aflat dedesubt
  const CELL = 40, sGrid = new Map();
  for (const w of ways) w.pts.forEach(([x, z], i) => {
    const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    if (!sGrid.has(k)) sGrid.set(k, []);
    sGrid.get(k).push([w, i]);
  });
  const roadBelow = (x, z, top, self) => {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [o, j] of sGrid.get((gx + dx) + ',' + (gz + dz)) || []) {
      if (o === self || o.Y[j] > top - 2) continue;
      if (Math.hypot(o.pts[j][0] - x, o.pts[j][1] - z) < o.width / 2 + 2.2) return true;
    }
    return false;
  };
  // punct (stalp) aflat pe o alta cale de la acelasi nivel / de deasupra (pasaj), sau la < 1,2 m de marginea ei
  const laneClash = (x, z, y, self) => {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [o, j] of sGrid.get((gx + dx) + ',' + (gz + dz)) || []) {
      if (o === self || j >= o.pts.length - 1 || o.Y[j] < y - 1.5 || o.Y[j] > y + 12.5) continue; // stalp de 11 m: nici sub un pasaj
      const a = o.pts[j], b = o.pts[j + 1], vx = b[0] - a[0], vz = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)));
      if (Math.hypot(a[0] + vx * u - x, a[1] + vz * u - z) < o.width / 2 + 1.2) return true;
    }
    return false;
  };
  const quadSide = (arr, sd, a, b, c, d) => { if (sd > 0) arr.push(...b, ...d, ...a, ...a, ...d, ...c); else arr.push(...a, ...c, ...b, ...b, ...c, ...d); };
  for (const w of ways) {
    const smp = samplesOf(w);
    w.smp = smp;
    const hw = w.width / 2;
    asphalt[w.type].push(sweepStrip(smp, -hw, hw, 0, { uvScale: 1 / 18 }));
    // parapete / glisiere (profil New Jersey simplificat)
    const bh = w.type === 'road' ? 0.75 : 0.9;
    // parapetii se intrerup la trecerea la nivel cu T1 (altfel tramvaiul ar trece prin ei)
    const runs = [];
    let cur = [];
    for (const p of smp) {
      const blocked = w.pinned && pins.some((pn) => Math.hypot(p.x - pn.x, p.z - pn.z) < 13);
      if (blocked) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length > 1) runs.push(cur);
    for (const run of runs) for (const sd of [-1, 1]) {
      const prof = sd > 0
        ? [[hw + 0.1, 0], [hw + 0.12, bh], [hw + 0.32, bh], [hw + 0.5, 0]]
        : [[-hw - 0.5, 0], [-hw - 0.32, bh], [-hw - 0.12, bh], [-hw - 0.1, 0]];
      barriers.push(sweepProfile(run, prof, { color: 0xc4c7ca }));
    }
    // tablier (pe pile) sau rambleu, pe fiecare segment
    for (let i = 0; i < smp.length - 1; i++) {
      const p = smp[i], q = smp[i + 1];
      const bridge = p.deck && q.deck;
      const e = hw + 0.5;
      for (const sd of [-1, 1]) {
        const P0 = (s, off, dy) => [s.x + s.rx * off * sd, s.y + dy, s.z + s.rz * off * sd];
        if (bridge) {
          quadSide(deckFaces, sd, P0(p, e, 0), P0(p, e, -DECK), P0(q, e, 0), P0(q, e, -DECK));
          // intrados (fata de jos) – o singura data
          if (sd > 0) deckFaces.push(...P0(p, -e, -DECK), ...P0(q, -e, -DECK), ...P0(p, e, -DECK), ...P0(p, e, -DECK), ...P0(q, -e, -DECK), ...P0(q, e, -DECK));
        } else if (!(w.tunnel && p.y < p.t - 0.5 && q.y < q.t - 0.5)) {
          const hp = Math.max(0.3, p.y - p.t), hq = Math.max(0.3, q.y - q.t);
          quadSide(skirts, sd, P0(p, e, 0), P0(p, e + hp * 1.6, -(hp + 0.9)), P0(q, e, 0), P0(q, e + hq * 1.6, -(hq + 0.9)));
        }
      }
      if (bridge) {
        const sMid = (p.s + q.s) / 2;
        const x = (p.x + q.x) / 2, z = (p.z + q.z) / 2, top = (p.y + q.y) / 2 - DECK;
        if ((w.lastPier === undefined || sMid - w.lastPier > 30) && top - Math.min(p.t, q.t) > 1 && !roadBelow(x, z, top + DECK, w)) {
          w.lastPier = sMid;
          pierMats.push({ x, z, top, bot: Math.min(p.t, q.t) - 1.5, yaw: Math.atan2(p.rx, p.rz) + Math.PI / 2, w: w.width * 0.55 });
        }
      }
    }
    // portaluri de tunel (A8 vest, layer = -1): unde calea intra sub teren
    if (w.tunnel) {
      for (const [i0, di] of [[0, 1], [smp.length - 1, -1]]) {
        for (let i = i0; i >= 0 && i < smp.length; i += di) {
          const p = smp[i];
          if (p.y + 7.2 < p.t) {
            const yaw = Math.atan2(p.rx, p.rz);
            portals.push(box(w.width + 3, 1.6, 1.2, 0, 7.0, 0, 0xb3b7bb, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw + Math.PI / 2).setPosition(p.x, p.y, p.z)));
            for (const sd of [-1, 1]) portals.push(box(1.2, 7.8, 1.2, sd * (hw + 1.1), 3.9, 0, 0xb3b7bb, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw + Math.PI / 2).setPosition(p.x, p.y, p.z)));
            break;
          }
        }
      }
    }
    // stalpi de iluminat in zona nodului
    if (w.type !== 'road' && !w.tunnel) {
      let last = -1e9;
      for (const p of smp) {
        const dn = Math.hypot(p.x - nodeXZ.x, p.z - nodeXZ.z);
        if (dn > 1500) continue;
        if (p.s - last <= 48) continue;
        // stalpul sta in spatele parapetului (fata exterioara la hw + 0,5 m): la 1,7 m de marginea carosabilului,
        // si la >= 1,2 m de marginea ORICAREI alte cai (bretele alaturate, zone de convergenta)
        const lx = p.x + p.rx * (hw + 1.7), lz = p.z + p.rz * (hw + 1.7);
        if (laneClash(lx, lz, p.y, w)) continue;
        last = p.s;
        lampPos.push({ x: lx, y: p.y, z: lz, yaw: Math.atan2(p.rx, p.rz) });
      }
    }
  }
  const mk = (arr, color) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); if (color !== undefined) tint(g, color); return g; };
  const concreteParts = [...barriers, ...portals];
  if (deckFaces.length) concreteParts.push(mk(deckFaces, 0xb3b7bb));

  const roadMats = {};
  for (const k of ['mw', 'link', 'road']) {
    if (!asphalt[k].length) continue;
    const tex = laneTexture(k);
    roadMats[k] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const m = new THREE.Mesh(merge(asphalt[k], { uv: true, color: false }), roadMats[k]);
    m.receiveShadow = true; m.name = 'asfalt-' + k;
    group.add(m);
  }
  const conMesh = new THREE.Mesh(merge(concreteParts), shared.concreteMat);
  conMesh.name = 'autostrada-beton'; conMesh.castShadow = true; conMesh.receiveShadow = true;
  group.add(conMesh);
  const skMesh = new THREE.Mesh(mk(skirts, 0x6f8a4a), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  skMesh.name = 'autostrada-taluzuri'; skMesh.receiveShadow = true;
  group.add(skMesh);

  // pile
  const pierGeo = new THREE.BoxGeometry(1, 1, 1.6); pierGeo.translate(0, 0.5, 0);
  const piers = new THREE.InstancedMesh(pierGeo, new THREE.MeshStandardMaterial({ color: 0xbfc3c7, roughness: 0.8 }), Math.max(1, pierMats.length));
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), vv = new THREE.Vector3(), sc = new THREE.Vector3();
  pierMats.forEach((p, i) => {
    q4.setFromEuler(e.set(0, p.yaw, 0));
    m4.compose(vv.set(p.x, p.bot, p.z), q4, sc.set(p.w, Math.max(0.5, p.top - p.bot), 1));
    piers.setMatrixAt(i, m4);
  });
  piers.count = pierMats.length;
  piers.castShadow = true; piers.name = 'pile-pasaje';
  group.add(piers);

  // stalpi de iluminat (instantiati) + corpuri LED
  const poleGeo = merge([cyl(0.09, 0.14, 11, 6, 0, 5.5, 0, 0x8b9096), box(0.1, 0.1, 2.2, 0, 10.9, -1.0, 0x8b9096)]);
  const headGeo = new THREE.BoxGeometry(0.35, 0.12, 0.8); headGeo.translate(0, 10.82, -2.0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.4 }), Math.max(1, lampPos.length));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffd9a0, emissiveIntensity: 0.1 });
  const heads = new THREE.InstancedMesh(headGeo, lampMat, Math.max(1, lampPos.length));
  lampPos.forEach((p, i) => {
    // bratul spre carosabil: dreapta drumului este -r => rotim astfel incat -z local sa arate spre axa
    q4.setFromEuler(e.set(0, p.yaw, 0)); // bratul (-z local) spre axa drumului
    m4.compose(vv.set(p.x, p.y, p.z), q4, sc.set(1, 1, 1));
    poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
  });
  poles.count = heads.count = lampPos.length;
  poles.name = 'iluminat-nod'; heads.name = 'iluminat-led';
  group.add(poles, heads);

  ctx.scene.add(group);

  // ascundem panglicile maro "in constructie" desenate de oras (le inlocuim cu modelul 3D)
  const cm = ctx.city?.group?.getObjectByName('drumuri-construction');
  if (cm) cm.visible = false;

  // ---------------- trafic ----------------
  const mwWays = ways.filter((w) => w.type !== 'road' && w.len > 10);
  const succ = new Map(), hasPred = new Set();
  for (const w of mwWays) succ.set(w, mwWays.filter((o) => o !== w && o.k0 === w.k1));
  for (const w of mwWays) for (const o of succ.get(w)) hasPred.add(o);
  const entries = mwWays.filter((w) => !hasPred.has(w) && w.type === 'mw');
  const traffic = buildTraffic(ctx, group, mwWays, succ, entries.length ? entries : mwWays, nodeXZ);

  ctx.env.onChange((st) => {
    lampMat.emissiveIntensity = 0.1 + st.night * 3.0;
    traffic.setNight(st.night);
  });

  // utilitare pentru alte parti (indicatoare, trasee spre aeroporturi)
  function pointOn(w, s, lat = 0, out = new THREE.Vector3()) {
    s = THREE.MathUtils.clamp(s, 0, w.len);
    const [i, f, j] = sAtIdx(w, s);
    const a = w.smp[i], b = w.smp[j];
    out.set(a.x + (b.x - a.x) * f + (a.rx + (b.rx - a.rx) * f) * lat, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f + (a.rz + (b.rz - a.rz) * f) * lat);
    return out;
  }
  // statistici pentru panoul de informatii (niveluri efective in zona nodului, intersectii denivelate)
  const lvSet = new Set();
  for (const w of ways) {
    if (Math.min(...w.pts.map((p) => Math.hypot(p[0] - nodeXZ.x, p[1] - nodeXZ.z))) > 1300) continue;
    lvSet.add(w.level);
  }
  const graded = crossings.filter((c) => c.dy >= 7).length;
  const minDy = crossings.reduce((m, c) => Math.min(m, c.dy), Infinity);
  const bridgesN = ways.filter((w) => w.br).length;
  console.info(`A7/A8: ${ways.length} cai, ${crossings.length} intersectii in plan (${graded} denivelate, Δy min ${minDy.toFixed(1)} m), ${pierMats.length} pile, ${lampPos.length} stalpi, nivel maxim +${maxLift.toFixed(1)} m, ${pins.length} treceri T1`);
  return {
    group, ways, mwWays, succ, nodeXZ, pointOn, Yat, traffic, crossings, pins,
    levels: [...lvSet].filter((l) => l >= 0).length, maxLift, graded, minDy, bridges: bridgesN, piers: pierMats.length,
  };
}

// ------------------------------------------------------------------
function buildTraffic(ctx, group, ways, succ, entries, nodeXZ) {
  const rand = Math.random;
  // geometrii: autoturism, autocar, camion (inainte = -z)
  // proportii reale (m): autoturism 4,4 × 1,8 × 1,45; autocar 12,2 × 2,5 × 3,4; camion articulat 15 × 2,55 × 3,9
  const car = merge([
    box(1.8, 0.62, 4.4, 0, 0.56, 0, 0xffffff),
    box(1.58, 0.52, 2.3, 0, 1.13, 0.15, 0x1e293b),
    box(1.82, 0.2, 4.42, 0, 0.32, 0, 0x22262b),
    ...wheelSet(0.32, 0.2, 0.8, [-1.38, 1.38]),
  ]);
  const coach = merge([
    box(2.5, 3.0, 12.2, 0, 1.9, 0, 0xffffff),
    box(2.52, 1.0, 11.6, 0, 2.35, 0.2, 0x1e293b),
    box(2.53, 0.25, 12.22, 0, 1.3, 0, 0x0ea5e9),
    box(2.4, 1.2, 0.05, 0, 2.35, -6.11, 0x1e293b),
    ...wheelSet(0.5, 0.3, 1.05, [-4.1, 3.6, 4.9]),
  ]);
  const truck = merge([
    box(2.5, 2.7, 2.4, 0, 2.05, -6.3, 0xffffff),
    box(2.4, 0.9, 0.05, 0, 2.7, -7.51, 0x1e293b),
    box(2.55, 3.0, 12.6, 0, 2.45, 1.2, 0xe5e7eb),
    box(1.6, 0.35, 15.0, 0, 0.75, -0.2, 0x22262b),
    ...wheelSet(0.5, 0.3, 1.0, [-6.6, -3.6, 4.6, 5.9, 7.0]),
  ]);
  const types = [
    { geo: car, n: 110, len: 4.4, speed: [27, 34], lane: 'any', colors: [0xf8fafc, 0x1f2937, 0x9ca3af, 0xb91c1c, 0x1d4ed8, 0x065f46, 0xd97706, 0x64748b] },
    { geo: coach, n: 18, len: 12.2, speed: [24, 27], lane: 'slow', colors: [0xffffff, 0xf8fafc] },
    { geo: truck, n: 26, len: 15, speed: [21, 24], lane: 'slow', colors: [0xffffff, 0xdc2626, 0x2563eb, 0x16a34a] },
  ];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
  const meshes = types.map((t) => {
    const m = new THREE.InstancedMesh(t.geo, mat, t.n);
    m.name = 'trafic';
    m.castShadow = true;
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  // lumini (faruri albe in fata, stopuri rosii in spate) – geometrie pentru lungime 1, scalata pe z
  const lg = [];
  for (const sx of [-1, 1]) {
    lg.push(box(0.35, 0.18, 0.04, sx * 0.62, 0.7, -0.5, 0xfff7da));
    lg.push(box(0.35, 0.16, 0.04, sx * 0.66, 0.75, 0.5, 0xff1a1a));
  }
  const lightGeo = merge(lg);
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const total = types.reduce((a, t) => a + t.n, 0);
  const lights = new THREE.InstancedMesh(lightGeo, lightMat, total);
  lights.frustumCulled = false;
  lights.name = 'trafic-lumini';
  lights.visible = false;
  group.add(lights);

  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const vehicles = [];
  const col = new THREE.Color();
  types.forEach((t, ti) => {
    for (let i = 0; i < t.n; i++) {
      const w = pick(ways);
      const v = { ti, i, w, s: rand() * w.len, speed: t.speed[0] + rand() * (t.speed[1] - t.speed[0]), lane: 0, len: t.len };
      v.lane = t.lane === 'slow' ? 1 : (rand() < 0.5 ? 0 : 1);
      if (v.lane === 1 && ti === 0) v.speed = Math.min(v.speed, 28);
      vehicles.push(v);
      meshes[ti].setColorAt(i, col.setHex(pick(t.colors)));
    }
    meshes[ti].instanceColor.needsUpdate = true;
  });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), sc = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function lat(v) {
    if (v.w.type === 'link') return 0;
    return v.lane === 0 ? -2.5 : 0.95; // centrele benzilor pe calea de 10 m (banda de urgenta pe dreapta)
  }
  function posOn(w, s, l, out) {
    s = Math.min(Math.max(s, 0), w.len);
    let lo = 0, hi = w.S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w.S[m] <= s) lo = m; else hi = m; }
    const f = w.S[hi] > w.S[lo] ? (s - w.S[lo]) / (w.S[hi] - w.S[lo]) : 0;
    const A = w.smp[lo], B = w.smp[hi];
    out.set(A.x + (B.x - A.x) * f + (A.rx + (B.rx - A.rx) * f) * l, A.y + (B.y - A.y) * f, A.z + (B.z - A.z) * f + (A.rz + (B.rz - A.rz) * f) * l);
    return out;
  }
  let lightsOn = false;
  let acc = 0;
  ctx.addUpdate((dt) => {
    // trafic mai rar actualizat cand camera e departe (economie)
    const cam = ctx.camera.position;
    const far = Math.hypot(cam.x - nodeXZ.x, cam.z - nodeXZ.z) > 9000;
    acc += dt;
    if (far && acc < 0.25) return;
    const step = acc; acc = 0;
    let li = 0;
    for (const v of vehicles) {
      const sp = v.w.type === 'link' ? Math.min(v.speed, 21) : v.speed;
      v.s += sp * step;
      while (v.s > v.w.len) {
        const nx = succ.get(v.w);
        v.s -= v.w.len;
        if (nx && nx.length) { v.w = pick(nx); if (v.w.type === 'link') v.lane = 1; }
        else { v.w = pick(entries); v.s = rand() * 30; }
      }
      const l = lat(v);
      posOn(v.w, v.s + v.len * 0.4, l, a);
      posOn(v.w, v.s - v.len * 0.4, l, b);
      p.addVectors(a, b).multiplyScalar(0.5);
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const hl = Math.hypot(dx, dz) || 1;
      e.set(Math.atan2(dy, hl), Math.atan2(-dx, -dz), 0);
      q.setFromEuler(e);
      m4.compose(p, q, one);
      meshes[v.ti].setMatrixAt(v.i, m4);
      if (lightsOn) {
        const t = types[v.ti];
        m4.compose(p, q, sc.set(v.ti ? 1.35 : 1, v.ti ? 1.6 : 1, t.len));
        lights.setMatrixAt(li++, m4);
      }
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    if (lightsOn) { lights.count = li; lights.instanceMatrix.needsUpdate = true; }
  });

  return {
    vehicles,
    setNight(n) { lightsOn = n > 0.35; lights.visible = lightsOn; },
  };
}
