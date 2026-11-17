import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SegmentIndex, roadStyle, GROUND_LIFT, discGeometry, ribbonGeometry, profileRibbon, cleanDense, canvasTexture, rng } from './util.js';
import { asphaltTexture, paverTexture } from './textures.js';
import { planBridges, buildBridgeStructures } from './bridges.js';

// ---------- Drumuri (din city.js) ----------
// - latimi pe clase (util.js roadStyle), esantionare la <= 8 m pe suprafata exacta a terenului
// - capete / intersectii rotunde (discuri) => fara goluri la intersectii
// - fara drumuri peste liniile garii (campul de linii) si in piata garii (o deseneaza modulul garii)
// - fara drumuri de serviciu care merg "pe" calea ferata (axa la < 4 m de o sina pe cea mai mare parte)
// - PODURI REALE (bridges.js): tablier la gabarit peste CF / drumuri / apa, rampe <= 5,5 % pe rambleu
// Texturi: asfalt cu marcaje pe UV-urile panglicii (u 0..1 de-a curmezisul, v = metri de-a lungul):
//   majore = axa intrerupta + linii de margine; strazi cu 2 benzi (tertiare) = axa; rezidentiale / serviciu = fara.
//   Trotuare (pavele) = o a doua panglica, mai lata cu 2 x 2,5 m, putin sub drum (strazi rezidentiale si majore).
export function buildRoads(ctx, { osm, group, heightAt, terrainH, inTrackField, inSquare, railIndex, waterIndex, offsetMat }) {
  const L = GROUND_LIFT;
  const roadGroups = { major: [], minorMarked: [], minor: [], motorway: [], construction: [], walk: [] };
  const MARKED_MINOR = ['tertiary', 'tertiary_link', 'unclassified'];
  const WALK_K = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk'];
  const SIDEWALK = 2.5;
  const STEP = 8;
  const scaleU = (g, k, setU = null) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, setU ?? uv.getX(i) * k); return g; };
  const groundY = (x, z, lift) => heightAt(x, z) + lift;

  // 1) pregatire: puncte dense + lungimi cumulate pentru fiecare drum
  const items = [];
  for (const w of osm.roads) {
    if (!w.p || w.p.length < 2) continue;
    const { width, bucket } = roadStyle(w);
    const pts = cleanDense(w.p, STEP);
    if (pts.length < 2) continue;
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    items.push({ w, pts, s, width, bucket, lift: L[bucket], walk: WALK_K.includes(w.k) && (bucket === 'major' || bucket === 'minor') });
  }
  // 2) poduri + rampe
  const { profiles, bridges } = planBridges({ items, groundY, terrainH, railIndex, waterIndex });

  const roadIndex = new SegmentIndex(60);
  const surfIndex = new SegmentIndex(30); // pentru roadHeightAt
  const roadRuns = [];
  const lampRuns = [];
  let droppedNearRail = 0, clippedPts = 0;
  items.forEach((it, idx) => {
    const { w, width, bucket, lift, walk } = it;
    const prof = profiles.get(idx) || null;
    const dense = it.pts;
    if (bucket !== 'construction' && !prof) {
      let near = 0;
      for (const [x, z] of dense) if (railIndex.nearest(x, z, 4).d < 4) near++;
      if (near / dense.length > 0.5) { droppedNearRail++; return; }
    }
    const grp = bucket === 'minor' && MARKED_MINOR.includes(w.k) && width >= 5.5 ? 'minorMarked' : bucket;
    // taiem portiunile din campul de linii / piata garii (in bucati continue); podurile nu se taie
    const runs = [];
    let cur = [];
    dense.forEach((q, i) => {
      const elevated = prof && prof[i] > groundY(q[0], q[1], lift) + 0.02;
      const bad = bucket !== 'construction' && !elevated && (inTrackField(q[0], q[1]) || inSquare(q[0], q[1]));
      if (bad) { clippedPts++; if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(i);
    });
    if (cur.length > 1) runs.push(cur);
    const rr = width / 2, ww = width + 2 * SIDEWALK;
    for (const ids of runs) {
      const run = ids.map((i) => dense[i]);
      const py = prof ? ids.map((i) => prof[i]) : null;
      const yAt = (ex, ez, k, lf) => (py ? Math.max(groundY(ex, ez, lf), py[k] + (lf - lift)) : groundY(ex, ez, lf));
      const arr = roadGroups[grp];
      arr.push(py ? profileRibbon(run, width, (x, z, k) => yAt(x, z, k, lift)) : ribbonGeometry(run, width, heightAt, lift, STEP));
      if (walk) {
        const g = py ? profileRibbon(run, ww, (x, z, k) => yAt(x, z, k, L.minor - 0.03)) : ribbonGeometry(run, ww, heightAt, L.minor - 0.03, STEP);
        roadGroups.walk.push(scaleU(g, ww));
      }
      // capete rotunde + colturi stranse (> 45°); discurile stau 1 cm sub panglica, asfalt fara marcaje (u = 0,25)
      const joints = [0, run.length - 1];
      for (let i = 1; i < run.length - 1; i++) {
        const ax = run[i][0] - run[i - 1][0], az = run[i][1] - run[i - 1][1], bx = run[i + 1][0] - run[i][0], bz = run[i + 1][1] - run[i][1];
        const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
        if (la < 1e-3 || lb < 1e-3) continue;
        if ((ax * bx + az * bz) / (la * lb) < 0.7) joints.push(i);
      }
      for (const i of joints) {
        const segs = i === 0 || i === run.length - 1 ? 12 : 10;
        const elevated = py && py[i] > groundY(run[i][0], run[i][1], lift) + 0.02;
        const hfn = elevated ? () => py[i] - lift : heightAt;
        arr.push(scaleU(discGeometry(run[i][0], run[i][1], rr, hfn, lift - 0.01, segs), 1, 0.25));
        if (walk && !elevated) roadGroups.walk.push(scaleU(discGeometry(run[i][0], run[i][1], ww / 2, heightAt, L.minor - 0.04, segs), 1, 0));
      }
      roadRuns.push({ pts: run, k: w.k, width, id: w.id, name: w.n || null, ref: w.ref || null, bridge: !!(prof && w.br), y: py });
      if (bucket !== 'construction') roadIndex.addPolyline(run, rr + 1.2, w.k);
      if (bucket !== 'construction') {
        for (let i = 0; i < run.length - 1; i++) {
          surfIndex.add(run[i][0], run[i][1], run[i + 1][0], run[i + 1][1], rr + (walk ? SIDEWALK : 0.3),
            { lift, y0: py ? py[i] : null, y1: py ? py[i + 1] : null, deck: !!(prof && w.br) });
        }
      }
      lampRuns.push({ pts: run, k: w.k, y: py });
    }
  });

  const roadMats = {
    major: offsetMat('major', { map: asphaltTexture('major'), color: 0xd4d4d4, roughness: 0.9 }),
    minorMarked: offsetMat('minor', { map: asphaltTexture('center'), color: 0xeeeeee, roughness: 0.93 }),
    minor: offsetMat('minor', { map: asphaltTexture('none'), color: 0xffffff, roughness: 0.95 }),
    motorway: offsetMat('motorway', { map: asphaltTexture('none'), color: 0xc4c4c4, roughness: 0.9 }),
    construction: offsetMat('construction', { color: 0x9c8466, roughness: 1 }),
    walk: offsetMat('water', { map: paverTexture(), roughness: 0.9 }),
  };
  roadMats.walk.polygonOffsetUnits = -2.5;
  const roadMeshes = {};
  for (const [k, arr] of Object.entries(roadGroups)) {
    if (!arr.length) continue;
    const m = new THREE.Mesh(mergeGeometries(arr, false), roadMats[k]);
    m.receiveShadow = true; m.name = k === 'walk' ? 'trotuare' : 'drumuri-' + k; group.add(m);
    roadMeshes[k] = m;
    arr.forEach((g) => g.dispose());
  }

  // 3) structurile podurilor (tablier, pile, culei, parapete, ziduri de sprijin)
  const st = buildBridgeStructures({
    items, profiles, bridges, groundY, terrainH, railIndex, waterIndex,
    walkW: (it) => (it.walk ? SIDEWALK : 0),
  });
  group.add(st.group);
  for (const b of bridges) delete b.idx;

  // cota suprafetei drumului desenat (inclusiv poduri / rampe) sau null daca (x, z) nu e pe un drum.
  // yHint (optional): cand doua drumuri se suprapun (pod peste strada) alegem suprafata cea mai apropiata de yHint;
  // fara yHint => cea mai inalta.
  function roadHeightAt(x, z, yHint = null) {
    let best = null, bestScore = Infinity;
    surfIndex.query({ minX: x - 16, maxX: x + 16, minZ: z - 16, maxZ: z + 16 }, (sg) => {
      const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L2 = dx * dx + dz * dz || 1;
      let u = ((x - sg.ax) * dx + (z - sg.az) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      if (Math.hypot(sg.ax + dx * u - x, sg.az + dz * u - z) > sg.r) return false;
      const t = sg.tag, g = heightAt(x, z) + t.lift;
      const y = t.y0 == null ? g : (t.deck ? t.y0 + (t.y1 - t.y0) * u : Math.max(g, t.y0 + (t.y1 - t.y0) * u));
      const score = yHint == null ? -y : Math.abs(y - yHint);
      if (score < bestScore) { bestScore = score; best = y; }
      return false;
    });
    return best;
  }

  // Mod satelit: strazile raman TOATE vizibile (asfalt usor transparent, ortofoto se vede la margini)
  function setSatelliteMode(on) {
    for (const [k, m] of Object.entries(roadMeshes)) {
      if (k === 'construction') continue;
      // drumurile raman opace in ambele moduri: cu transparenta (fara depthWrite) trotuarele se desenau peste asfalt
      m.visible = true;
      m.material.transparent = false; m.material.opacity = 1; m.material.depthWrite = true; m.material.needsUpdate = true;
    }
  }

  return { roadRuns, roadIndex, lampRuns, roadMeshes, roadHeightAt, bridges, setSatelliteMode, droppedNearRail, clippedPts, pierCount: st.pierCount };
}

// ---------- Cai ferate in stratul orasului: balast + traverse + 2 sine ----------
// In raza garii liniile 1–6 sunt desenate detaliat de modulul garii: aici sarim aceleasi cai OSM.
// Balastul (trapez, cu textura de piatra si traverse pictate) peste tot; traversele 3D (instantiate) si sinele 3D
// (otel, imbinate) pana la RAIL3D_R de gara – mai departe se vad oricum doar ca balast.
export function buildRails(ctx, { osm, group, heightAt, stationTracks, stationR, offsetMat }) {
  const RAIL3D_R = 3000, SLEEPER_R = 1800, GAUGE = 1.435, RAIL_H = 0.16, SLEEPER = 0.62;
  const ballastGeoms = [], railGeoms = [];
  let railSkipped = 0, sleeperPts = [];
  for (const w of osm.rails) {
    if (w.k === 'platform' || w.k === 'proposed') continue;
    const dense = cleanDense(w.p, 6);
    const runs = [];
    let cur = [];
    for (const q of dense) {
      const dup = Math.hypot(q[0], q[1]) < stationR && stationTracks.nearest(q[0], q[1], 3).d < 2.2;
      if (dup) { railSkipped++; if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(q);
    }
    if (cur.length > 1) runs.push(cur);
    for (const run of runs) {
      // balast: panglica lata (umar) + coronament
      ballastGeoms.push(ribbonGeometry(run, 4.2, heightAt, GROUND_LIFT.rail - 0.06, 6));
      const near = run.some(([x, z]) => Math.hypot(x, z) < RAIL3D_R);
      if (!near) continue;
      const y = (x, z) => heightAt(x, z) + GROUND_LIFT.rail + 0.12;
      // doua sine (cutii subtiri) – profileRibbon pentru coroana + doua fete laterale
      for (const sg of [-1, 1]) {
        const off = (sg * GAUGE) / 2;
        const shifted = offsetLine(run, off);
        railGeoms.push(railBar(shifted, y, RAIL_H));
      }
      // traverse
      let acc = 0;
      for (let i = 0; i < run.length - 1; i++) {
        const [x0, z0] = run[i], [x1, z1] = run[i + 1];
        const d = Math.hypot(x1 - x0, z1 - z0);
        while (acc < d) {
          const t = acc / d, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
          if (Math.hypot(x, z) < SLEEPER_R) sleeperPts.push(x, z, Math.atan2(x1 - x0, z1 - z0));
          acc += SLEEPER;
        }
        acc -= d;
      }
    }
  }
  const ballastTex = canvasTexture(64, 256, (g, w, h) => {
    const rr = rng(11);
    g.fillStyle = '#6f675d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `hsl(${25 + rr() * 15},${6 + rr() * 6}%,${26 + rr() * 34}%)`; g.fillRect(rr() * w, rr() * h, 1 + rr() * 2, 1 + rr() * 2); }
    // margini (umarul balastului) mai deschise, centru patat de rugina
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(150,140,125,.45)'); gr.addColorStop(0.18, 'rgba(0,0,0,0)'); gr.addColorStop(0.82, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(150,140,125,.45)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(92,60,40,.25)'; g.fillRect(w * 0.3, 0, w * 0.4, h);
    // traverse pictate (vazute de departe, unde nu exista cele 3D)
    g.fillStyle = 'rgba(70,58,48,.85)'; for (let y = 0; y < h; y += 26) g.fillRect(9, y, w - 18, 9);
    g.fillStyle = '#9da3a8'; g.fillRect(22, 0, 3, h); g.fillRect(w - 25, 0, 3, h);
  });
  ballastTex.wrapS = ballastTex.wrapT = THREE.RepeatWrapping;
  ballastTex.repeat.set(1, 1 / 4);
  const out = { railSkipped, sleepers: 0 };
  if (ballastGeoms.length) {
    const m = new THREE.Mesh(mergeGeometries(ballastGeoms, false), offsetMat('rail', { map: ballastTex, roughness: 0.95 }));
    m.receiveShadow = true; m.name = 'cai-ferate'; group.add(m);
    ballastGeoms.forEach((g) => g.dispose());
  }
  if (railGeoms.length) {
    const m = new THREE.Mesh(mergeGeometries(railGeoms, false), new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }));
    m.name = 'cai-ferate-sine'; m.castShadow = false; group.add(m);
    railGeoms.forEach((g) => g.dispose());
  }
  const nS = sleeperPts.length / 3;
  if (nS) {
    const geo = new THREE.BoxGeometry(2.6, 0.16, 0.26);
    const sl = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 }), nS);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nS; i++) {
      const x = sleeperPts[i * 3], z = sleeperPts[i * 3 + 1], a = sleeperPts[i * 3 + 2];
      q.setFromAxisAngle(up, a);
      mtx.compose(v.set(x, heightAt(x, z) + GROUND_LIFT.rail + 0.04, z), q, one);
      sl.setMatrixAt(i, mtx);
    }
    sl.computeBoundingSphere();
    sl.receiveShadow = true; sl.name = 'cai-ferate-traverse';
    group.add(sl);
    out.sleepers = nS;
  }
  return out;
}

// polilinie decalata lateral cu `off` metri (normala stanga = (-tz, tx))
function offsetLine(pts, off) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    out.push([pts[i][0] - (tz / l) * off, pts[i][1] + (tx / l) * off]);
  }
  return out;
}
// sina: coroana (0,07 m) + doua fete laterale, de la y(x,z) la y + h
function railBar(pts, y, h) {
  const top = profileRibbon(pts, 0.072, (x, z) => y(x, z) + h);
  const pos = [];
  const side = (off) => offsetLine(pts, off);
  const L = side(0.036), R = side(-0.036);
  for (let i = 0; i < pts.length - 1; i++) {
    for (const [P, flip] of [[L, false], [R, true]]) {
      const a = P[i], b = P[i + 1];
      const ya = y(a[0], a[1]), yb = y(b[0], b[1]);
      const q = [[a[0], ya, a[1]], [b[0], yb, b[1]], [b[0], yb + h, b[1]], [a[0], ya + h, a[1]]];
      const tri = flip ? [q[0], q[2], q[1], q[0], q[3], q[2]] : [q[0], q[1], q[2], q[0], q[2], q[3]];
      for (const p of tri) pos.push(p[0], p[1], p[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();

  return mergeGeometries([top, g], false);
}
