import * as THREE from 'three';
import { merge, tint, box, cyl, sweepProfile, makeCanvas, canvasTex } from './util3d.js';
import { TRACK_HALF } from './route.js';
import { ROUTE } from './route-data.js';

// Calea de rulare T1, doua linii, fara catenara (tramvai pe baterii):
//  - in culoarul CF 500 (ROUTE.corridor): cale clasica pe PRISMA DE PIATRA SPARTA (textura de piatra), traverse de
//    beton la 0,6 m, taluz de balast — la fel ca liniile CFR vecine;
//  - in afara culoarului (spre hub): "cale inierbata" (gazon intre sine), traverse la 1,25 m, bordura joasa cu LED,
//  rambleuri, viaducte si pod peste parau.
export function buildTrack(ctx, route, mats) {
  const group = new THREE.Group();
  group.name = 't1-cale';
  const L = route.length;
  const ramp = route.laneRamp;
  const DS = 4;

  // ---------- texturi ----------
  const grassTex = canvasTex((() => {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#4f7a34'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      const l = 22 + Math.random() * 26;
      g.fillStyle = `hsl(${88 + Math.random() * 25},${40 + Math.random() * 20}%,${l}%)`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 2 + Math.random() * 3);
    }
    return c;
  })());
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(2, 1 / 3);
  // piatra sparta (balast) – granule gri / gri-bej, cu umbre
  const stoneTex = canvasTex((() => {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#7d7a74'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * 128, y = Math.random() * 128, r = 1.2 + Math.random() * 2.6;
      g.fillStyle = 'rgba(40,36,32,0.45)'; g.beginPath(); g.ellipse(x + 0.8, y + 0.8, r, r * 0.75, Math.random() * 3, 0, 7); g.fill();
      const l = 42 + Math.random() * 30;
      g.fillStyle = `hsl(${25 + Math.random() * 25},${4 + Math.random() * 10}%,${l}%)`;
      g.beginPath(); g.ellipse(x, y, r, r * 0.75, Math.random() * 3, 0, 7); g.fill();
    }
    return c;
  })());
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.repeat.set(2, 1 / 2.5);
  const [C0, C1] = ROUTE.corridor || [0, -1];
  const inCorr = (s) => s >= C0 && s <= C1;
  // ACELASI polygonOffset pe toate suprafetele caii (gazon, sine, traverse, borduri, dale de trecere):
  // ordinea dintre ele ramane cea geometrica (sinele +0,16 m peste gazon nu mai „dispar” sub gazon la distanta).
  // Fata de drumuri, calea e mai „tare” pe ambele componente: orasul are factor -1 / units -1…-6 (GROUND_OFFSET),
  // drumurile noi din motorway.js -3 / -6; T1 are -4 / -16. In plus platforma are garda reala >= 0,25 m peste
  // asfalt pe toata latimea (road-clear.js, verificat). Factorul NU se mareste mai mult: deplasarea lui creste cu
  // patratul distantei la unghiuri razante, iar gazonul ar acoperi partea de jos a tramvaielor si peroanele
  // (care nu au polygonOffset) — ex. -6 doar pe gazon ascundea sinele de la ~25 m in vederea din cabina.
  const PO = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 };
  for (const k of ['steel', 'sleeper', 'concrete']) Object.assign(mats[k], PO);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, ...PO });
  const ballastMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 1, ...PO });

  // ---------- platforma inierbata (latime variabila: se ingusteaza la capete) ----------
  const edge = (s) => TRACK_HALF * ramp(s) + 1.75;
  // zone cu cale inglobata la cota asfaltului (treceri la nivel + tronsonul comun cu DJ208L), vezi route.js
  const zones = route.levelZones || [];
  const inLevel = (s) => zones.some((c) => s >= c.s0 && s <= c.s1);
  const axis = route.samples(0, L, DS);
  const bedPos = [], bedUv = [], balPos = [], balUv = [];
  for (let i = 0; i < axis.length - 1; i++) {
    const p = axis[i], q = axis[i + 1];
    const ep = edge(p.s), eq = edge(q.s);
    const A = [p.x - p.rx * ep, p.y, p.z - p.rz * ep], B = [p.x + p.rx * ep, p.y, p.z + p.rz * ep];
    const C = [q.x - q.rx * eq, q.y, q.z - q.rz * eq], D = [q.x + q.rx * eq, q.y, q.z + q.rz * eq];
    if (inLevel((p.s + q.s) / 2)) continue; // dala de trecere (mai jos) inlocuieste gazonul / balastul
    const bal = inCorr((p.s + q.s) / 2);
    (bal ? balPos : bedPos).push(...B, ...D, ...A, ...A, ...D, ...C);
    (bal ? balUv : bedUv).push(1, p.s, 1, q.s, 0, p.s, 0, p.s, 1, q.s, 0, q.s);
  }
  for (const [pos, uv, mat, name] of [[bedPos, bedUv, grassMat, 't1-gazon'], [balPos, balUv, ballastMat, 't1-balast']]) {
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.name = name;
    group.add(m);
  }

  // ---------- sine (2 linii x 2 fire) ----------
  const railProfile = [[-0.04, -0.05], [-0.04, 0.16], [0.04, 0.16], [0.04, -0.05]];
  // In zonele la nivel fiecare fir urmareste asfaltul de sub el (ciuperca = asfalt + 1 cm; drumul drapat pe teren
  // are panta transversala, deci firele capata o mica supraînaltare), cu racordare liniara pe 4 m la capete;
  // esantionare la 0,5 m in zone, 4 m in rest.
  const RHr = ctx.city?.roadHeightAt;
  const zw = (s) => { let w = 0; for (const c of zones) w = Math.max(w, s >= c.s0 && s <= c.s1 ? 1 : Math.max(0, 1 - Math.min(Math.abs(s - c.s0), Math.abs(s - c.s1)) / 4)); return w; };
  function railSamples(latFn) {
    const cuts = [0];
    for (const c of [...zones].sort((a, b) => a.s0 - b.s0)) { const a = Math.max(cuts[cuts.length - 1], c.s0 - 4), b = Math.min(L, c.s1 + 4); if (b > a) cuts.push(a, b); }
    cuts.push(L);
    const out = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      if (cuts[k + 1] - cuts[k] < 1e-3) continue;
      const part = route.samples(cuts[k], cuts[k + 1], k % 2 ? 0.5 : DS, latFn);
      out.push(...(out.length ? part.slice(1) : part));
    }
    if (RHr) for (const p of out) {
      const w = zw(p.s);
      if (w <= 0) continue;
      const r = RHr(p.x, p.z, p.y + 0.15);
      if (r != null && Math.abs(r - (p.y + 0.15)) < 0.4) p.y += w * (r - 0.15 - p.y);
    }
    return out;
  }
  const railGeos = [];
  for (const side of [-1, 1]) {
    for (const r of [-0.7175, 0.7175]) {
      railGeos.push(sweepProfile(railSamples((s) => side * TRACK_HALF * ramp(s) + r), railProfile, { color: 0x9aa3ab }));
    }
  }
  const rails = new THREE.Mesh(merge(railGeos), mats.steel);
  rails.name = 't1-sine';
  rails.castShadow = false;
  group.add(rails);

  // ---------- bordura cu LED + rambleu (taluz) ----------
  // segment atins de o zona la nivel (acolo platforma e pavata, fara borduri / taluz)
  const inCrossing = (s0, s1) => zones.some((c) => s1 >= c.s0 && s0 <= c.s1);
  const kerb = [], led = [], slope = [], deck = [], parapet = [], wall = [], balSlope = [];
  for (let i = 0; i < axis.length - 1; i++) {
    const p = axis[i], q = axis[i + 1];
    const ep = edge(p.s), eq = edge(q.s);
    if (inCrossing(p.s, q.s)) continue;
    const corr = inCorr((p.s + q.s) / 2) && !(p.k === 2 && q.k === 2);
    for (const sd of [-1, 1]) {
      if (corr) {
        // culoarul CF: fara bordura / LED; prisma de balast coboara 1:1,5 pana la teren (ca liniile CFR)
        const P0 = (smp, off, dy) => [smp.x + smp.rx * off * sd, smp.y + dy, smp.z + smp.rz * off * sd];
        const quad = (a, b, c, d) => { if (sd > 0) balSlope.push(...b, ...d, ...a, ...a, ...d, ...c); else balSlope.push(...a, ...c, ...b, ...b, ...c, ...d); };
        const hp = Math.max(0.35, p.y - p.t + 0.35), hq = Math.max(0.35, q.y - q.t + 0.35);
        quad(P0(p, ep, 0), P0(p, ep + hp * 1.5, -hp), P0(q, eq, 0), P0(q, eq + hq * 1.5, -hq));
        continue;
      }
      // bordura 0,2 m latime, 0,12 m peste gazon
      const e0 = ep + 0.02, e1 = ep + 0.22, f0 = eq + 0.02, f1 = eq + 0.22;
      const P0 = (smp, off, dy) => [smp.x + smp.rx * off * sd, smp.y + dy, smp.z + smp.rz * off * sd];
      // a,b = punct interior/exterior la p ; c,d = la q. Normala: in sus / spre exterior
      const quad = (arr, a, b, c, d) => { if (sd > 0) arr.push(...b, ...d, ...a, ...a, ...d, ...c); else arr.push(...a, ...c, ...b, ...b, ...c, ...d); };
      quad(kerb, P0(p, e0, 0.12), P0(p, e1, 0.12), P0(q, f0, 0.12), P0(q, f1, 0.12));
      // banda LED pe fata interioara a bordurii
      quad(led, P0(p, e0 - 0.005, 0.02), P0(p, e0 - 0.005, 0.1), P0(q, f0 - 0.005, 0.02), P0(q, f0 - 0.005, 0.1));
      if (p.k === 2 && q.k === 2) {
        // viaduct: fata laterala a tablierului + parapet
        quad(deck, P0(p, e1 + 1.0, 0.12), P0(p, e1 + 1.0, -1.6), P0(q, f1 + 1.0, 0.12), P0(q, f1 + 1.0, -1.6));
        quad(deck, P0(p, e1, 0.12), P0(p, e1 + 1.0, 0.12), P0(q, f1, 0.12), P0(q, f1 + 1.0, 0.12));
        quad(parapet, P0(p, e1 + 0.95, 0.12), P0(p, e1 + 0.95, 1.15), P0(q, f1 + 0.95, 0.12), P0(q, f1 + 0.95, 1.15));
        quad(parapet, P0(p, e1 + 0.95, 1.15), P0(p, e1 + 0.95, 0.12), P0(q, f1 + 0.95, 1.15), P0(q, f1 + 0.95, 0.12));
      } else if (p.road && q.road && p.rs === p.rs && q.rs === q.rs) {
        // pe strada: bordura are fata exterioara verticala pana sub asfalt (fara taluz verde peste carosabil)
        quad(wall, P0(p, e1, 0.12), P0(p, e1, p.rs - p.y - 0.1), P0(q, f1, 0.12), P0(q, f1, q.rs - q.y - 0.1));
      } else {
        // fata exterioara a bordurii + taluz pana la teren
        const hp = Math.max(0.2, p.y - p.t), hq = Math.max(0.2, q.y - q.t);
        const wp = e1 + Math.max(0.3, hp * 1.5), wq = f1 + Math.max(0.3, hq * 1.5);
        quad(slope, P0(p, e1, 0.12), P0(p, wp, -(hp + 0.8)), P0(q, f1, 0.12), P0(q, wq, -(hq + 0.8)));
      }
    }
  }
  const mk = (arr, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    if (color !== undefined) tint(g, color);
    return g;
  };
  const kerbMesh = new THREE.Mesh(merge([mk(kerb, 0xc9ccd0), mk(deck, 0xb8bcc0), mk(parapet, 0xd4d6d9), wall.length ? mk(wall, 0xaeb2b6) : null]), mats.concrete);
  kerbMesh.name = 't1-borduri';
  kerbMesh.receiveShadow = true;
  group.add(kerbMesh);
  if (balSlope.length) {
    const bg = mk(balSlope);
    // UV simple (x,z lume) pentru textura de piatra pe taluzul prismei
    const pa = bg.getAttribute('position'), uvs = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) { uvs[i * 2] = pa.getX(i) / 2.2; uvs[i * 2 + 1] = pa.getZ(i) / 2.2 + pa.getY(i) / 2.2; }
    bg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const balSlopeMat = new THREE.MeshStandardMaterial({ map: stoneTex.clone(), color: 0xd6d2cc, roughness: 1, side: THREE.DoubleSide });
    balSlopeMat.map.repeat.set(1, 1); balSlopeMat.map.needsUpdate = true;
    const bm = new THREE.Mesh(bg, balSlopeMat);
    bm.name = 't1-prisma-balast';
    bm.receiveShadow = true;
    group.add(bm);
  }
  const slopeMat = new THREE.MeshStandardMaterial({ color: 0x5f7f3e, roughness: 1, side: THREE.DoubleSide });
  const slopeMesh = new THREE.Mesh(mk(slope), slopeMat);
  slopeMesh.name = 't1-taluz';
  slopeMesh.receiveShadow = true;
  group.add(slopeMesh);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffb27a, emissive: 0xff8a3d, emissiveIntensity: 0.25, roughness: 0.4 });
  const ledMesh = new THREE.Mesh(mk(led), ledMat);
  ledMesh.name = 't1-led';
  group.add(ledMesh);

  // ---------- cale inglobata (treceri la nivel + tronson comun cu DJ208L) ----------
  // Profilul T1 e fixat in aceste zone la cota asfaltului (route.js): ciuperca sinei = asfalt + 1 cm. Dala (beton
  // asfaltic) e drapata pe ctx.city.roadHeightAt(x, z) + 2 mm => continua suprafata drumului pe toata latimea
  // platformei; unde platforma iese de pe carosabil dala sta la nivelul ciupercii. Capetele dalei: fata verticala
  // pana la gazon. Polygon offset-ul caii (mai puternic decat al orasului) => dala acopera panglica drumului.
  const RH = ctx.city?.roadHeightAt;
  const slabPos = [], slabEnds = [];
  const slabY = (x, z, yT) => { const r = RH ? RH(x, z, yT) : null; return r != null && Math.abs(r - yT) < 0.4 ? r + 0.002 : yT - 0.005; };
  const _o = new THREE.Vector3();
  for (const c of zones) {
    const s0 = Math.max(0, c.s0), s1 = Math.min(L, c.s1);
    if (s1 - s0 < 1) continue;
    let E = 0;
    for (let s = s0; s <= s1; s += 1) E = Math.max(E, edge(s));
    E += 0.25;
    const ns = Math.max(2, Math.ceil(s1 - s0)), nl = Math.ceil(2 * E);
    const grid = [];
    for (let a = 0; a <= ns; a++) {
      const s = s0 + ((s1 - s0) * a) / ns, row = [];
      const yR = route.heightAtS(s) + 0.15; // ciuperca sinei - 1 cm = cota asfaltului impusa
      for (let b = 0; b <= nl; b++) {
        route.offsetPoint(s, -E + (2 * E * b) / nl, _o);
        row.push([_o.x, slabY(_o.x, _o.z, yR), _o.z]);
      }
      grid.push(row);
    }
    for (let a = 0; a < ns; a++) for (let b = 0; b < nl; b++) {
      const A = grid[a][b], B = grid[a][b + 1], C = grid[a + 1][b], D = grid[a + 1][b + 1];
      slabPos.push(...A, ...C, ...B, ...B, ...C, ...D);
    }
    // fetele de capat (dala -> platforma inierbata de dedesubt)
    for (const [row, sg] of [[grid[0], -1], [grid[ns], 1]]) {
      const yb = route.heightAtS(sg < 0 ? s0 : s1) - 0.02;
      for (let b = 0; b < nl; b++) {
        const A = row[b], B = row[b + 1], A2 = [A[0], yb, A[2]], B2 = [B[0], yb, B[2]];
        slabEnds.push(...A, ...A2, ...B, ...B, ...A2, ...B2);
      }
    }
  }
  if (slabPos.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([...slabPos, ...slabEnds], 3));
    sg.computeVertexNormals();
    const crossMat = new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 0.92, side: THREE.DoubleSide, ...PO });
    const cm = new THREE.Mesh(sg, crossMat);
    cm.name = 't1-treceri-la-nivel';
    cm.receiveShadow = true;
    group.add(cm);
  }
  const signals = buildCrossingSignals(ctx, zones, edge);
  if (signals) group.add(signals.group);

  // ---------- traverse (instantiate) ----------
  // culoarul CF: traverse de beton la 0,6 m (ca liniile CFR); in rest (cale inierbata) la 1,25 m
  const sleeperGeo = new THREE.BoxGeometry(2.4, 0.14, 0.26);
  const sList = [];
  for (let s = 0.6; s < L; s += inCorr(s) ? 0.6 : 1.25) sList.push(s);
  const nSl = sList.length;
  const sleepers = new THREE.InstancedMesh(sleeperGeo, mats.sleeper, nSl * 2);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const tg = new THREE.Vector3();
  let ci = 0;
  for (let k = 0; k < nSl; k++) {
    const s = sList[k];
    route.tangent(s, tg);
    e.set(0, Math.atan2(tg.x, tg.z), 0);
    q4.setFromEuler(e);
    const r = ramp(s);
    for (const side of [-1, 1]) {
      if (side === 1 && r < 0.02) continue; // linie simpla
      if (inLevel(s)) continue; // cale inglobata: fara traverse vizibile
      route.offsetPoint(s, side * TRACK_HALF * r, v);
      v.y += 0.0;
      m4.compose(v, q4, one);
      sleepers.setMatrixAt(ci++, m4);
    }
  }
  sleepers.count = ci;
  sleepers.instanceMatrix.needsUpdate = true;
  sleepers.name = 't1-traverse';
  group.add(sleepers);

  // ---------- pile pentru viaducte ----------
  const pierPos = [];
  let lastPier = -1e9;
  for (let s = 0; s < L; s += 2) {
    if (route.kindAt(s) === 2 && s - lastPier > 22) {
      // nu in albia paraului (podul trece peste apa dintr-o singura deschidere)
      const nearStream = (route.streams || []).some((st) => Math.abs(s - st.s) < 7);
      // nici pe carosabilul de sub pasajele T1 (Str. Prisacii, DJ208)
      const onRoad = [-2.6, 0, 2.6].some((d) => { route.offsetPoint(s, d, tg); return ctx.city?.roadHeightAt?.(tg.x, tg.z, route.terrainAtS(s)) != null; });
      if (!nearStream && !onRoad) { pierPos.push(s); lastPier = s; }
    }
  }
  if (pierPos.length) {
    const pierGeo = new THREE.BoxGeometry(5.2, 1, 1.4);
    pierGeo.translate(0, 0.5, 0);
    tint(pierGeo, 0xb8bcc0); // materialul de beton foloseste culori pe varfuri (altfel pilele ar iesi negre)
    const pv3 = new THREE.Vector3(), ps3 = new THREE.Vector3();
    const piers = new THREE.InstancedMesh(pierGeo, mats.concrete, pierPos.length);
    pierPos.forEach((s, i) => {
      route.tangent(s, tg);
      const top = route.heightAtS(s) - 1.6, bot = route.terrainAtS(s) - 1.5;
      const p = route.pos(s, v);
      e.set(0, Math.atan2(tg.x, tg.z), 0); q4.setFromEuler(e);
      m4.compose(pv3.set(p.x, bot, p.z), q4, ps3.set(1, Math.max(0.5, top - bot), 1));
      piers.setMatrixAt(i, m4);
    });
    piers.name = 't1-pile';
    piers.castShadow = true;
    group.add(piers);
  }

  // geometrie statica, lunga de 5 km: sferele de incadrare calculate o data, explicit (fara „disparitii” la cull)
  group.traverse((o) => {
    if (o.isInstancedMesh) o.computeBoundingSphere();
    else if (o.isMesh) o.geometry.computeBoundingSphere();
  });
  ctx.scene.add(group);

  ctx.env.onChange((st) => { ledMat.emissiveIntensity = 0.25 + st.night * 2.2; });

  return { group, ledMat, signals };
}

// Semnalizarea trecerilor la nivel T1 (zonele 'nivel' din route.js), pe fiecare sens al drumului:
//  - linie de oprire alba pe banda de apropiere, la 3 m inainte de dala;
//  - stalp cu doua lumini rosii intermitente + crucea Sf. Andrei, la 0,8 m in afara carosabilului;
//  - semibariera scurta (doar peste banda de apropiere) cand drumul e DJ / DN sau colector (> 30 km/h).
function buildCrossingSignals(ctx, zones, edge) {
  const RH = ctx.city?.roadHeightAt;
  const H = ctx.terrain.heightAt;
  const parts = [], lines = [], lamps = [];
  const list = [];
  const MAJOR = ['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link'];
  const yr = (x, z) => { const r = RH ? RH(x, z, H(x, z)) : null; return r != null ? r : H(x, z) + 0.1; };
  for (const c of zones) {
    if (c.type !== 'nivel' || !(c.dx === c.dx)) continue;
    const sin = Math.max(0.35, Math.sin(((c.ang || 90) * Math.PI) / 180));
    const cos = Math.sqrt(1 - sin * sin);
    const hw = c.hw || 3;
    const E = edge(c.s) + 0.25;
    const major = /^D[JN]/.test(c.ref || '') || MAJOR.includes(c.k);
    // distanta (de-a lungul drumului) de la centru pana la 3 m inainte de marginea dalei, pe banda din dreapta
    const a = E / sin + (hw / 2) * (cos / sin) + 3;
    for (const sg of [-1, 1]) {
      // vehiculele vin dinspre +sg*d spre centru; dreapta directiei de mers m = -sg*d este (-mz, mx)
      const rx = sg * c.dz, rz = -sg * c.dx;
      const cx = c.x + sg * c.dx * a, cz = c.z + sg * c.dz * a;
      const yaw = Math.atan2(c.dx, c.dz);
      const lx = cx + (rx * hw) / 2, lz = cz + (rz * hw) / 2;
      lines.push(box(hw - 0.3, 0.01, 0.4, 0, 0, 0, 0xf4f4f0).rotateY(yaw).translate(lx, yr(lx, lz) + 0.012, lz));
      const px = cx + rx * (hw + 0.8), pz = cz + rz * (hw + 0.8), py = yr(px, pz);
      const M = new THREE.Matrix4().makeRotationY(yaw + (sg > 0 ? 0 : Math.PI)).setPosition(px, py, pz);
      parts.push(cyl(0.06, 0.07, 3.2, 8, 0, 1.6, 0, 0xe8e8e8).applyMatrix4(M));
      parts.push(box(0.9, 0.36, 0.12, 0, 2.55, 0, 0x1c1f24).applyMatrix4(M));
      for (const d of [-0.25, 0.25]) lamps.push(new THREE.SphereGeometry(0.1, 10, 6).translate(d, 2.55, 0.08).applyMatrix4(M));
      for (const r of [Math.PI / 5, -Math.PI / 5]) parts.push(tint(new THREE.BoxGeometry(1.15, 0.16, 0.03).rotateZ(r).translate(0, 3.0, 0.02).applyMatrix4(M), 0xf2f2f2));
      if (major) {
        // semibariera: suport + brat alb-rosu (ridicat; lungimea = banda de apropiere)
        parts.push(box(0.3, 1.0, 0.3, 0, 0.5, -0.35, 0xd9d9d9).applyMatrix4(M));
        const len = Math.max(2, hw - 0.4);
        for (let k = 0; k < 5; k++) {
          const seg = new THREE.BoxGeometry(0.09, len / 5, 0.06).translate(0, len / 10 + (k * len) / 5 + 0.95, -0.35);
          parts.push(tint(seg.applyMatrix4(M), k % 2 ? 0xffffff : 0xd32222));
        }
      }
    }
    list.push({ s: c.s, n: c.n, major });
  }
  if (!list.length) return null;
  const group = new THREE.Group();
  group.name = 't1-semnalizare-treceri';
  const pole = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }));
  pole.name = 't1-semnale';
  pole.castShadow = true;
  const lineMesh = new THREE.Mesh(merge(lines), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }));
  lineMesh.name = 't1-linii-oprire';
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2a1a, emissiveIntensity: 0.15 });
  const lampMesh = new THREE.Mesh(merge(lamps, { color: false }), lampMat);
  lampMesh.name = 't1-semnale-lumini';
  group.add(pole, lineMesh, lampMesh);
  // luminile clipesc alternativ cat timp un tramvai e la < 120 m de trecere
  let acc = 0;
  ctx.addUpdate((dt) => {
    acc += dt;
    const veh = ctx.transit?.fleet?.vehicles || [];
    const near = veh.some((v) => list.some((c) => Math.abs((v.s ?? -1e9) - c.s) < 120));
    lampMat.emissiveIntensity = near ? (Math.floor(acc * 2) % 2 ? 2.4 : 0.3) : 0.15;
  });
  return { group, list };
}

