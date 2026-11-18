import * as THREE from 'three';
import { merge, box, sweepStrip, sweepProfile, makeCanvas, canvasTex, wheelSet } from './util3d.js';
import { COACH_DEST } from './hub.js';

// Legatura Hub Turbion -> nodul A7×A8: un sens giratoriu la sol pe DJ208L relocat (pe tronsonul de la nivelul
// terenului, in locul cu terasamente minime, la >= 25 m de bretele / pasaje). In giratoriu se leaga:
//  - cele doua capete ale DJ208L: panglica DJ (asfalt, parapete, taluz) e taiata local, iar bratele noi pornesc exact
//    din ultimul esantion pastrat (aceeasi pozitie, cota, normala, latime) => fara rost si fara palpaire;
//  - drumul de acces cu 2 benzi din banda autocarelor hub-ului (urmeaza terenul, panta <= 5 %, borduri, marcaje);
//  - capetele libere ale bretelelor nodului de langa hub (datele OSM ale santierului le lasa „in aer” langa DJ208L).
// Autocarele spre aeroporturi (IAS / SCV / BCM) circula animat: peron -> drum de acces -> giratoriu -> bretea
// -> A8 Est / A7 Nord / A7 Sud (lantul de cai al traficului din motorway.js, golurile OSM < 45 m sunt sarite).

const ROAD_W = 9.0, R_OUT = 23, R_IN = 14.5, MAX_GRADE = 0.05, R_CUT = R_OUT + 14, MIN_ARM_SEP = 0.62; // ~36°

function markTex(kind) {
  const c = makeCanvas(128, 256), g = c.getContext('2d');
  g.fillStyle = '#45484c'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 700; i++) { const v = 50 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  g.fillStyle = '#f2f2ee';
  g.fillRect(5, 0, 4, 256); g.fillRect(119, 0, 4, 256);
  if (kind === 'two') g.fillRect(62, 0, 4, 96);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// esantioane {x,y,z,rx,rz,s} dintr-o polilinie [x,z]
function samplesXZ(pts) {
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    out.push({ x: pts[i][0], y: 0, z: pts[i][1], rx: -dz, rz: dx, s });
  }
  return out;
}
const bez = (P0, P1, P2, P3, n) => {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([0, 1].map((j) => u * u * u * P0[j] + 3 * u * u * t * P1[j] + 3 * u * t * t * P2[j] + t * t * t * P3[j]));
  }
  return out;
};
function resample(pts, step) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const d = Math.hypot(x1 - x0, z1 - z0);
    let t = step - acc;
    while (t < d) { out.push([x0 + (x1 - x0) * t / d, z0 + (z1 - z0) * t / d]); t += step; }
    acc = d - (t - step);
  }
  const L = pts[pts.length - 1], P = out[out.length - 1];
  if (Math.hypot(L[0] - P[0], L[1] - P[1]) > step * 0.3) out.push(L); else out[out.length - 1] = L;
  return out;
}
// cota: urmeaza terenul (+lift), capete fixe, panta <= MAX_GRADE (numai prin ridicare => niciodata sub teren)
function profile(smp, H, y0, y1, lift = 0.22, fixFirst = 0) {
  const n = smp.length;
  const t = smp.map((p) => H(p.x, p.z) + lift);
  const y = t.slice();
  const fixed = (i) => i === 0 || i === n - 1 || smp[i].s <= fixFirst;
  for (let it = 0; it < 4; it++) {
    for (let i = 0; i < n; i++) if (smp[i].s <= fixFirst) y[i] = y0;
    y[0] = y0; y[n - 1] = y1;
    for (let i = 1; i < n - 1; i++) if (!fixed(i)) y[i] = Math.max(t[i], (y[i - 1] + y[i] * 2 + y[i + 1]) / 4);
    for (let i = 1; i < n; i++) if (!fixed(i)) y[i] = Math.max(y[i], y[i - 1] - MAX_GRADE * (smp[i].s - smp[i - 1].s));
    for (let i = n - 2; i >= 0; i--) if (!fixed(i)) y[i] = Math.max(y[i], y[i + 1] - MAX_GRADE * (smp[i + 1].s - smp[i].s));
  }
  // langa capetele fixe terenul poate fi mai sus decat cota impusa: debleu scurt (coborare) ca panta sa ramana <= 5 %
  for (let i = n - 2; i >= 0; i--) if (!fixed(i)) y[i] = Math.min(y[i], y[i + 1] + MAX_GRADE * (smp[i + 1].s - smp[i].s));
  for (let i = 1; i < n; i++) if (!fixed(i)) y[i] = Math.min(y[i], y[i - 1] + MAX_GRADE * (smp[i].s - smp[i - 1].s));
  smp.forEach((p, i) => { p.y = y[i]; p.t = t[i] - lift; });
  return smp;
}
function segHit(A, B, C, D) {
  const rx = B[0] - A[0], rz = B[1] - A[1], qx = D[0] - C[0], qz = D[1] - C[1];
  const den = rx * qz - rz * qx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((C[0] - A[0]) * qz - (C[1] - A[1]) * qx) / den, u = ((C[0] - A[0]) * rz - (C[1] - A[1]) * rx) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
const segDist = (x, z, A, B) => { const dx = B[0] - A[0], dz = B[1] - A[1], t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[1]) * dz) / (dx * dx + dz * dz || 1e-9))); return Math.hypot(A[0] + dx * t - x, A[1] + dz * t - z); };
const polyHit = (P, Q) => { for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < Q.length - 1; j++) if (segHit(P[i], P[i + 1], Q[j], Q[j + 1])) return true; return false; };
const angDiff = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
const maxGradeOf = (smp) => { let g = 0; for (let i = 1; i < smp.length; i++) { const ds = smp[i].s - smp[i - 1].s; if (ds > 0.5) g = Math.max(g, Math.abs(smp[i].y - smp[i - 1].y) / ds); } return g; };

export function buildHubLink(ctx, motorway, hub, shared) {
  if (!motorway || !hub) return null;
  const H = ctx.terrain.heightAt;
  const ways = motorway.ways;
  const L2W = (u, v) => { const p = hub.toWorld(u, 0, v); return [p.x, p.z]; };
  const W2L = (x, z) => { const dx = x - hub.O.x, dz = z - hub.O.z; return [dx * hub.X.x + dz * hub.X.z, dx * hub.Z.x + dz * hub.Z.z]; };
  const gateEnd = L2W(-75, 168);

  // ---- locul giratoriului: pe DJ208L relocat, la sol, terasamente minime, departe de bretele / pasaje ----
  const djs = ways.filter((w) => w.type === 'road' && /DJ208L/.test(w.ref || '') && w.smp && w.smp.length > 8);
  let best = null;
  for (const w of djs) {
    const n = w.smp.length;
    for (let i = 3; i < n - 3; i++) {
      const c = w.smp[i];
      if (Math.hypot(c.x - gateEnd[0], c.z - gateEnd[1]) > 1100) continue;
      const [lu, lv] = W2L(c.x, c.z);
      if (lu > -110 && lu < 100 && lv < 210) continue;                       // nu pe platforma / parcarea hub-ului
      // tot tronsonul taiat (si inca 25 m) la sol: fara tablier, fara rambleu inalt
      let ok = true;
      for (let j = 0; j < n && ok; j++) {
        const p = w.smp[j], d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < R_CUT + 4 && (p.deck || p.lift > 0.3)) ok = false;
        if (d < R_OUT + 25 && p.deck) ok = false;
      }
      if (!ok) continue;
      if (Math.hypot(w.smp[0].x - c.x, w.smp[0].z - c.z) < R_CUT + 8 || Math.hypot(w.smp[n - 1].x - c.x, w.smp[n - 1].z - c.z) < R_CUT + 8) continue;
      // >= 25 m de orice alta cale (bretele, autostrazi, pasaje, alte drumuri)
      for (const o of ways) {
        if (o === w) continue;
        for (const [x, z] of o.pts) if (Math.hypot(x - c.x, z - c.z) < R_OUT + o.width / 2 + 25) { ok = false; break; }
        if (!ok) break;
      }
      if (!ok) continue;
      // terasamente: abaterea terenului fata de cota inelului, pe inel si in insula
      let earth = 0;
      for (let k = 0; k < 24; k++) for (const r of [R_IN * 0.6, R_IN, R_OUT, R_OUT + 3]) {
        const a = k / 24 * Math.PI * 2;
        earth = Math.max(earth, Math.abs(H(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r) - (w.Y[i] - 0.3)));
      }
      const cost = earth * 25 + Math.hypot(c.x - gateEnd[0], c.z - gateEnd[1]) / 40;
      if (!best || cost < best.cost) best = { w, i, cost, earth };
    }
  }
  if (!best) { console.warn('Hub: niciun loc la sol pe DJ208L pentru giratoriu'); return null; }
  const dj = best.w, djS = dj.smp;
  const C = [djS[best.i].x, djS[best.i].z];
  const yC = dj.Y[best.i];
  // tronsonul DJ inlocuit: esantioanele din raza R_CUT; capetele pastrate ia (inainte) si ib (dupa)
  let ia = best.i, ib = best.i;
  while (ia > 0 && Math.hypot(djS[ia].x - C[0], djS[ia].z - C[1]) < R_CUT) ia--;
  while (ib < djS.length - 1 && Math.hypot(djS[ib].x - C[0], djS[ib].z - C[1]) < R_CUT) ib++;

  // ---- taiem panglica DJ208L (asfalt, parapete, taluzuri) intre ia si ib (triunghiuri degenerate) ----
  let cutTris = 0;
  const onCut = (x, y, z) => {
    for (let i = ia; i < ib; i++) {
      const a = djS[i], b = djS[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9;
      const t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
      if (t < 0 || t > 1) continue;
      const d = Math.abs((x - a.x) * dz - (z - a.z) * dx) / Math.sqrt(L2);
      if (d < 16 && Math.abs(y - (a.y + (b.y - a.y) * t)) < 6) return true;
    }
    return false;
  };
  for (const name of ['asfalt-road', 'autostrada-beton', 'autostrada-taluzuri']) {
    const m = motorway.group.getObjectByName(name);
    const pa = m?.geometry?.attributes.position;
    if (!pa || m.geometry.index) continue;
    const arr = pa.array;
    for (let k = 0; k < arr.length; k += 9) {
      const cx = (arr[k] + arr[k + 3] + arr[k + 6]) / 3, cy = (arr[k + 1] + arr[k + 4] + arr[k + 7]) / 3, cz = (arr[k + 2] + arr[k + 5] + arr[k + 8]) / 3;
      if (Math.hypot(cx - C[0], cz - C[1]) > R_CUT + 30) continue;
      if (!onCut(cx, cy, cz)) continue;
      for (let j = 0; j < 9; j += 3) { arr[k + j] = cx; arr[k + j + 1] = cy; arr[k + j + 2] = cz; }
      cutTris++;
    }
    pa.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  }

  // ---- geometrie ----
  const asph2 = [], asph1 = [], kerbs = [], skirts = [], green = [], paint = [];
  const quadSide = (arr, sd, a, b, c, d) => { if (sd > 0) arr.push(...b, ...d, ...a, ...a, ...d, ...c); else arr.push(...a, ...c, ...b, ...b, ...c, ...d); };
  function addRoad(smp, width, lanes, kerb = true) {
    const hw = width / 2;
    (lanes === 2 ? asph2 : asph1).push(sweepStrip(smp, -hw, hw, 0, { uvScale: 1 / 9 }));
    for (const sd of [-1, 1]) {
      // bordura 0,15 m + taluz pana la teren
      if (kerb) kerbs.push(sweepProfile(smp, sd > 0 ? [[hw, 0], [hw, 0.15], [hw + 0.3, 0.15], [hw + 0.3, 0]] : [[-hw - 0.3, 0], [-hw - 0.3, 0.15], [-hw, 0.15], [-hw, 0]], { color: 0xc9c9c4 }));
      for (let i = 0; i < smp.length - 1; i++) {
        const p = smp[i], q = smp[i + 1], e = hw + 0.3;
        const hp = Math.max(0.25, p.y - p.t), hq = Math.max(0.25, q.y - q.t);
        const P0 = (s, off, dy) => [s.x + s.rx * off * sd, s.y + dy, s.z + s.rz * off * sd];
        quadSide(skirts, sd, P0(p, e, 0), P0(p, e + hp * 1.6, -(hp + 0.6)), P0(q, e, 0), P0(q, e + hq * 1.6, -(hq + 0.6)));
      }
    }
  }
  const ringPt = (ang, r = R_OUT) => [C[0] + Math.cos(ang) * r, C[1] + Math.sin(ang) * r];
  const angTo = (x, z) => Math.atan2(z - C[1], x - C[0]);
  // brat: curba de la un capat (pozitie + directie spre giratoriu) pana in inel (R_OUT - 1, sub asfaltul inelului)
  const armXZ = (P, T, n = 30, aRing = null, cap = Infinity) => {
    const a = aRing ?? angTo(P[0], P[1]), P3 = ringPt(a, R_OUT - 1.0);
    const d = Math.hypot(P3[0] - P[0], P3[1] - P[1]);
    const c1 = Math.min(d * 0.4, cap);
    return { xz: resample(bez(P, [P[0] + T[0] * c1, P[1] + T[1] * c1], ringPt(a, R_OUT + Math.min(d * 0.35, 60)), P3, n), 3), ang: a };
  };
  const arms = [];
  // 1) bratele DJ208L: pornesc exact din esantionul pastrat (ia / ib) => aceeasi muchie ca panglica DJ
  for (const [k, dir] of [[ia, 1], [ib, -1]]) {
    const p = djS[k], q = djS[k + dir];
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const { xz, ang } = armXZ([p.x, p.z], [(q.x - p.x) / l, (q.z - p.z) / l], 12);
    const smp = profile(samplesXZ(xz), H, p.y, yC, 0.22);
    // prima normala = normala DJ (ordinea de parcurgere a bratului ia: in sensul caii; ib: invers => normala inversata)
    smp[0].rx = p.rx * dir; smp[0].rz = p.rz * dir;
    arms.push({ kind: 'DJ208L', smp, ang, width: dj.width, joint: { x: p.x, y: p.y, z: p.z, rx: p.rx * dir, rz: p.rz * dir }, at: 0, djIdx: k });
  }
  // 2) drumul de acces (2 benzi): din banda autocarelor (cota pietei) pe latura de vest a hub-ului, apoi spre giratoriu
  const gate = [[-61, 75], [-66, 75], [-72, 79], [-75, 88], [-75, 150]].map(([u, v]) => L2W(u, v));
  const gdl = Math.hypot(gateEnd[0] - gate[4][0], gateEnd[1] - gate[4][1]);
  const ga = armXZ(gateEnd, [(gateEnd[0] - gate[4][0]) / gdl, (gateEnd[1] - gate[4][1]) / gdl], 60);
  const access = profile(samplesXZ(resample([...gate, ...ga.xz], 3)), H, hub.levelB + 0.06, yC, 0.22, 14);
  addRoad(access, ROAD_W, 2);
  const accessXZ = access.map((p) => [p.x, p.z]);
  // 3) bretelele cu capat liber langa hub (la sol), daca bratul nu se intersecteaza cu altele si are loc pe inel
  const k0s = new Map(), k1s = new Map();
  for (const w of ways) { k0s.set(w.k0, (k0s.get(w.k0) || 0) + 1); k1s.set(w.k1, (k1s.get(w.k1) || 0) + 1); }
  // parti la sol ale DJ208L pastrat (pe sub tablierul pasajului DJ se poate trece)
  const djKeep = [];
  for (const part of [djS.slice(0, ia + 1), djS.slice(ib)]) {
    let run = [];
    for (const p of part) { if (p.deck || p.lift > 4) { if (run.length > 1) djKeep.push(run); run = []; } else run.push([p.x, p.z]); }
    if (run.length > 1) djKeep.push(run);
  }
  const taken = [...arms.map((a) => a.ang), ga.ang];
  const skipped = [], merged = [];
  const cands = [];
  for (const w of ways) {
    if (w.type !== 'link' || !w.smp) continue;
    for (const [k, i, out] of [[w.k1, w.pts.length - 1, false], [w.k0, 0, true]]) {
      if ((k0s.get(k) || 0) + (k1s.get(k) || 0) > 1) continue;
      const [x, z] = w.pts[i];
      if (Math.hypot(x - C[0], z - C[1]) > 600 || Math.abs(w.Y[i] - H(x, z)) > 2.5 || w.lift[i] > 0.5) continue;
      // capat de intrare care se varsa pe la mijlocul altei cai (ex. 42 / 100 in A8 Est, nod OSM interior): e legat deja
      if (!out && ways.some((o) => o !== w && o.type !== 'road' && o.pts.some((p, j) => j < o.pts.length - 1 && segDist(x, z, p, o.pts[j + 1]) < o.width / 2 + 1 && Math.abs(o.Y[j] - w.Y[i]) < 2))) { merged.push(w.id); continue; }
      cands.push({ w, i, out, x, z, d: Math.hypot(x - C[0], z - C[1]) });
    }
  }
  cands.sort((a, b) => (b.out - a.out) || a.d - b.d); // intai bretelele de iesire spre autostrada (autocarele)
  for (const e of cands) {
    const s = e.w.smp[e.i], j = e.out ? 1 : e.w.pts.length - 2;
    let tx = e.x - e.w.pts[j][0], tz = e.z - e.w.pts[j][1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;               // directia „in afara” bretelei
    // unghiul de intrare in inel: cel natural sau cel mai apropiat unghi liber (bratele la >= ~36° unul de altul)
    const a0 = angTo(e.x, e.z);
    let aR = null;
    for (let k = 0; k <= 30 && aR === null; k++) for (const sg of k ? [1, -1] : [1]) {
      const c = a0 + sg * k * 0.04;
      if (!taken.some((a) => angDiff(a, c) < MIN_ARM_SEP)) { aR = c; break; }
    }
    if (aR === null) { skipped.push(`${e.w.id} (loc pe inel)`); continue; }
    const { xz, ang } = armXZ([e.x, e.z], [tx, tz], 40, aR, 30);
    const P = xz.slice(2);
    const hitWith = polyHit(P, accessXZ) ? 'acces' : djKeep.some((D) => polyHit(P, D)) ? 'DJ208L' : arms.find((a) => polyHit(P, a.smp.map((p) => [p.x, p.z])))?.kind;
    if (hitWith) { skipped.push(`${e.w.id} (intersectie cu ${hitWith})`); continue; }
    // bratul de iesire e parcurs giratoriu -> bretea (in sensul bretelei), cel de intrare bretea -> giratoriu
    const path = e.out ? xz.slice().reverse() : xz;
    const smp = e.out ? profile(samplesXZ(path), H, yC, e.w.Y[e.i], 0.22) : profile(samplesXZ(path), H, e.w.Y[e.i], yC, 0.22);
    const jIdx = e.out ? smp.length - 1 : 0;
    smp[jIdx].rx = s.rx; smp[jIdx].rz = s.rz;
    taken.push(ang);
    arms.push({ kind: 'bretea ' + e.w.id, e, smp, ang, width: e.w.width, joint: { x: s.x, y: s.y, z: s.z, rx: s.rx, rz: s.rz }, at: jIdx });
  }
  for (const a of arms) addRoad(a.smp, a.width, a.kind === 'DJ208L' ? 2 : 1);

  // inelul giratoriului (asfalt cu 3 cm mai sus => acopera capetele bratelor fara palpaire)
  const ringXZ = [];
  for (let k = 0; k <= 96; k++) { const a = -k / 96 * Math.PI * 2; ringXZ.push(ringPt(a, (R_OUT + R_IN) / 2)); }
  const ringSmp = samplesXZ(ringXZ).map((p) => ((p.y = yC + 0.03), (p.t = H(p.x, p.z)), p));
  const rw = (R_OUT - R_IN) / 2;
  const ringGeo = sweepStrip(ringSmp, -rw, rw, 0, { uvScale: 1 / 9 });
  const ringMat = new THREE.MeshStandardMaterial({ map: markTex('one'), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  for (let i = 0; i < ringSmp.length - 1; i++) {
    const p = ringSmp[i], q = ringSmp[i + 1], e = rw + 0.3;
    const hp = Math.max(0.25, p.y - p.t), hq = Math.max(0.25, q.y - q.t);
    const P0 = (s, off, dy) => [s.x + s.rx * off, s.y + dy, s.z + s.rz * off];
    quadSide(skirts, 1, P0(p, e, 0), P0(p, e + hp * 1.6, -(hp + 0.6)), P0(q, e, 0), P0(q, e + hq * 1.6, -(hq + 0.6)));
  }
  // insula centrala (iarba + bordura inalta) + stalpi indicator
  kerbs.push(sweepProfile(ringSmp, [[-rw - 0.4, 0], [-rw - 0.4, 0.22], [-rw, 0.22], [-rw, 0]], { color: 0xdedbd2 }));
  green.push(new THREE.CylinderGeometry(R_IN - 0.4, R_IN - 0.4, 0.5, 40).translate(C[0], yC - 0.03, C[1]));
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2;
    paint.push(box(0.12, 2.2, 0.12, C[0] + Math.cos(a) * 3, yC + 1.3, C[1] + Math.sin(a) * 3, 0x64748b));
  }
  // marcaje de cedare a trecerii la intrarea in giratoriu: linie transversala intrerupta + triunghiuri
  const yieldAt = (smp, w, toRing) => {
    // esantionul aflat la ~R_OUT + 1,5 m de centru
    let p = null;
    for (const s of toRing ? smp.slice().reverse() : smp) if (Math.hypot(s.x - C[0], s.z - C[1]) > R_OUT + 1.5) { p = s; break; }
    if (!p) return;
    const yaw = Math.atan2(p.rx, p.rz);
    const n = Math.max(3, Math.floor(w / 1.0));
    for (let k = 0; k < n; k++) {
      const off = -w / 2 + 0.4 + k * (w - 0.8) / (n - 1);
      paint.push(box(0.6, 0.02, 0.3, 0, 0, 0, 0xf2f2ee).rotateY(yaw).translate(p.x + p.rx * off, p.y + 0.025, p.z + p.rz * off));
    }
  };
  yieldAt(access, ROAD_W, true);
  for (const a of arms) yieldAt(a.smp, a.width, !(a.e && a.e.out));

  // ---- asamblare ----
  const group = new THREE.Group();
  group.name = 'hub-acces-giratoriu';
  const mat2 = new THREE.MeshStandardMaterial({ map: markTex('two'), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const mat1 = new THREE.MeshStandardMaterial({ map: markTex('one'), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const mkMesh = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.receiveShadow = true; group.add(m); return m; };
  const roadMeshes = [];
  if (asph2.length) roadMeshes.push(mkMesh(merge(asph2, { uv: true, color: false }), mat2, 'hub-acces-asfalt'));
  if (asph1.length) roadMeshes.push(mkMesh(merge(asph1, { uv: true, color: false }), mat1, 'hub-racorduri-asfalt'));
  roadMeshes.push(mkMesh(ringGeo, ringMat, 'giratoriu-asfalt'));
  const sk = new THREE.BufferGeometry(); sk.setAttribute('position', new THREE.Float32BufferAttribute(skirts, 3)); sk.computeVertexNormals();
  mkMesh(sk, new THREE.MeshStandardMaterial({ color: 0x6f8a4a, roughness: 1, side: THREE.DoubleSide }), 'hub-acces-taluz');
  mkMesh(merge([...kerbs, ...paint]), shared.concreteMat, 'hub-acces-borduri').castShadow = true;
  mkMesh(merge(green.map((g) => { const c = new THREE.Color(0x4d7c35); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; })), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 'giratoriu-insula');
  ctx.scene.add(group);
  // drumul si giratoriul sunt si suprafete de mers (plimbare)
  for (const m of roadMeshes) ctx.walkables.push(m);

  // ---- rosturi: abaterea muchiilor bratelor fata de capatul caii la care se leaga (tinta < 5 cm) ----
  const joints = arms.map((a) => {
    const p = a.smp[a.at], J = a.joint, hw = a.width / 2;
    let gap = 0;
    for (const sd of [-1, 1]) gap = Math.max(gap, Math.hypot(p.x + p.rx * hw * sd - (J.x + J.rx * hw * sd), p.z + p.rz * hw * sd - (J.z + J.rz * hw * sd)));
    return { kind: a.kind, gap, dy: Math.abs(p.y - J.y), grade: maxGradeOf(a.smp) };
  });

  // ---- autocarele spre aeroporturi: graf de rutare (motorway.ways + drumurile existente ale orasului) ----
  // noduri = varfurile cailor (pas ~8 m); muchii in sensul caii (autostrazi / bretele / giratorii = sens unic) si in
  // ambele sensuri pe drumuri. Datele OSM ale santierului nu impart noduri peste tot (iesiri / intrari pe la mijlocul
  // altei cai, goluri intre tronsoane): un capat de cale se leaga de cel mai apropiat varf al altei cai la < 45 m,
  // in aceeasi directie (cai cu sens unic) si la aceeasi cota (± 3 m). Bretelele / autostrazile nu se leaga de drumurile
  // orasului (numai drumurile noi, ex. capetele DJ208L / DJ208 relocate, se leaga de reteaua existenta).
  const GAP = 45, NX = [], NY = [], NZ = [], NW = [], NI = [], adj = [];
  const node = (x, y, z, w, i) => { NX.push(x); NY.push(y); NZ.push(z); NW.push(w); NI.push(i); adj.push([]); return NX.length - 1; };
  const edge = (a, b, c, gap = 0) => adj[a].push([b, c, gap]);
  const wayNodes = new Map();
  const oneWay = (w) => w.type !== 'road' || w.k0 === w.k1;
  for (const w of ways) {
    if (!w.smp || w.len < 5) continue;
    const ids = w.pts.map((p, i) => node(p[0], w.Y[i], p[1], w, i));
    wayNodes.set(w, ids);
    for (let i = 0; i < ids.length - 1; i++) {
      if (w === dj && i >= ia && i < ib) continue; // tronsonul DJ208L inlocuit de giratoriu
      const d = w.S[i + 1] - w.S[i];
      edge(ids[i], ids[i + 1], d);
      if (!oneWay(w)) edge(ids[i + 1], ids[i], d);
    }
    if (w.k0 === w.k1) edge(ids[ids.length - 1], ids[0], 0); // inel (giratoriul DJ208)
  }
  const cityKey = new Map();
  for (const r of ctx.city?.roads || []) {
    if (r.k === 'construction' || !r.pts || r.pts.length < 2) continue;
    let prev = -1, px = 0, pz = 0;
    for (const [x, z] of r.pts) {
      const k = x.toFixed(1) + ',' + z.toFixed(1);
      let id = cityKey.get(k);
      if (id === undefined) { id = node(x, H(x, z) + 0.12, z, r, -1); cityKey.set(k, id); }
      if (prev >= 0 && prev !== id) { const d = Math.hypot(x - px, z - pz); edge(prev, id, d); edge(id, prev, d); }
      prev = id; px = x; pz = z;
    }
  }
  const GC = 50, ngrid = new Map();
  for (let n = 0; n < NX.length; n++) { const k = Math.floor(NX[n] / GC) + ',' + Math.floor(NZ[n] / GC); if (!ngrid.has(k)) ngrid.set(k, []); ngrid.get(k).push(n); }
  const near = (x, z, f) => { const gx = Math.floor(x / GC), gz = Math.floor(z / GC); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const n of ngrid.get((gx + a) + ',' + (gz + b)) || []) f(n); };
  const tanAt = (w, i) => { const a = w.pts[Math.max(0, i - 1)], b = w.pts[Math.min(w.pts.length - 1, i + 1)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  let repaired = 0;
  for (const [w, ids] of wayNodes) {
    if (w.k0 === w.k1) continue;
    const n = ids.length, two = !oneWay(w);
    // porturi: [varf, tangenta caii, se poate iesi?, se poate intra?]
    for (const [pi, t, canOut, canIn] of [[n - 1, tanAt(w, n - 1), true, two], [0, tanAt(w, 0), two, true]]) {
      const P = ids[pi], best = new Map();
      near(NX[P], NZ[P], (m) => {
        const o = NW[m];
        if (o === w) return;
        const city = NI[m] < 0;
        if (city && w.type !== 'road') return;
        const d = Math.hypot(NX[m] - NX[P], NZ[m] - NZ[P]);
        // nod OSM comun sau capat apropiat: legat doar daca cotele sunt apropiate (mw-levels aliniaza acum capetele bretelelor)
        if (d > GAP || Math.abs(NY[m] - NY[P]) > 3) return;
        const pr = best.get(o);
        if (!pr || d < pr.d) best.set(o, { m, d, city });
      });
      const outSign = pi === 0 ? -1 : 1, inSign = -outSign;
      for (const [o, { m, d, city }] of best) {
        const ow = !city && oneWay(o) && o.k0 !== o.k1; // inelele (giratorii) se pot intra / parasi din orice unghi
        const ot = city ? null : tanAt(o, NI[m]);
        const al = ot ? ot[0] * t[0] + ot[1] * t[1] : 0;
        const cost = d < 0.5 ? 0.01 : d * 3 + 5; // legaturile reale (noduri comune) au prioritate
        if (canOut && (!ow || al * outSign > 0.3)) { edge(P, m, cost, d); if (d >= 0.5) repaired++; }
        if (canIn && (!ow || al * inSign > 0.3)) { edge(m, P, cost, d); if (d >= 0.5) repaired++; }
      }
    }
  }
  // Dijkstra (heap binar) din mai multe surse
  function dijkstra(src, isGoal) {
    const dist = new Float64Array(NX.length).fill(Infinity), prev = new Int32Array(NX.length).fill(-1), pgap = new Float64Array(NX.length);
    const h = [];
    const push = (d, n) => { h.push([d, n]); let i = h.length - 1; while (i) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } };
    const pop = () => { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; };
    for (const [n, d0] of src) if (d0 < dist[n]) { dist[n] = d0; push(d0, n); }
    while (h.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      if (isGoal(u)) { const path = []; let gap = 0; for (let v = u; v >= 0; v = prev[v]) { path.unshift(v); gap = Math.max(gap, pgap[v]); } return { path, d, gap }; }
      for (const [v, c, g] of adj[u]) if (d + c < dist[v]) { dist[v] = d + c; prev[v] = u; pgap[v] = g; push(d + c, v); }
    }
    return null;
  }
  const N = motorway.nodeXZ;
  const end = (w) => w.pts[w.pts.length - 1];
  // A8 Est (Targu Frumos / Iasi), A7 Nord (Suceava), A7 Sud (Bacau): cale de autostrada orientata spre tinta
  const goal = {
    IAS: (w) => /A8/.test(w.ref) && end(w)[0] > N.x + 1200 && end(w)[0] > w.pts[0][0],
    SCV: (w) => /A7/.test(w.ref) && end(w)[1] < N.z - 1200 && end(w)[1] < w.pts[0][1],
    BCM: (w) => /A7/.test(w.ref) && end(w)[1] > N.z + 1200 && end(w)[1] > w.pts[0][1],
  };
  const isMwGoal = (code) => (u) => NI[u] >= 0 && NW[u].type === 'mw' && goal[code](NW[u]) && NW[u].len - NW[u].S[NI[u]] > 200;
  // iesirile din giratoriu: bretelele legate (in sensul bretelei) si cele doua brate DJ208L (pe DJ208L, spre exterior)
  const exits = [];
  for (const a of arms) {
    const armLen = a.smp[a.smp.length - 1].s;
    if (a.e && a.e.out && wayNodes.has(a.e.w)) exits.push({ a, n: wayNodes.get(a.e.w)[0], armLen, fwd: true });
    if (a.djIdx !== undefined) exits.push({ a, n: wayNodes.get(dj)[a.djIdx], armLen, fwd: false });
  }
  const rMid = (R_OUT + R_IN) / 2 + 1.2;
  const arcTo = (ang) => { let da = ga.ang - ang; while (da <= 0.2) da += Math.PI * 2; return da; };
  function routeFor(code) {
    const r = dijkstra(exits.map((x) => [x.n, rMid * arcTo(x.a.ang) + x.armLen]), isMwGoal(code));
    if (!r) return null;
    const ex = exits.find((x) => x.n === r.path[0]);
    // pe calea tinta pana la capatul ei
    const u = r.path[r.path.length - 1], w = NW[u], ids = wayNodes.get(w);
    for (let i = NI[u] + 1; i < ids.length; i++) r.path.push(ids[i]);
    return { ...r, ex, last: w };
  }
  // intoarcerea (de pe autostrada tinta, sensul opus, inapoi in giratoriu pe un brat DJ208L) – numai verificare
  const entryNodes = new Set(arms.filter((a) => a.djIdx !== undefined).map((a) => wayNodes.get(dj)[a.djIdx]));
  function returnFor(code) {
    const back = {
      IAS: (w) => /A8/.test(w.ref) && w.pts[0][0] > N.x + 1200 && w.pts[0][0] > end(w)[0],
      SCV: (w) => /A7/.test(w.ref) && w.pts[0][1] < N.z - 1200 && w.pts[0][1] < end(w)[1],
      BCM: (w) => /A7/.test(w.ref) && w.pts[0][1] > N.z + 1200 && w.pts[0][1] > end(w)[1],
    }[code];
    const src = [];
    for (const [w, ids] of wayNodes) if (w.type === 'mw' && back(w) && Math.hypot(w.pts[0][0] - N.x, w.pts[0][1] - N.z) < 4000) src.push([ids[0], 0]);
    const r = dijkstra(src, (v) => entryNodes.has(v));
    return r ? { len: r.d, gap: r.gap } : null;
  }
  // benzile de asfalt desenate (verificare: autocarele nu ies de pe asfalt)
  const BC = 40, bgrid = new Map();
  const addBand = (ax, az, bx, bz, hw) => {
    const s = { ax, az, bx, bz, hw };
    for (let gx = Math.floor((Math.min(ax, bx) - hw) / BC); gx <= Math.floor((Math.max(ax, bx) + hw) / BC); gx++)
      for (let gz = Math.floor((Math.min(az, bz) - hw) / BC); gz <= Math.floor((Math.max(az, bz) + hw) / BC); gz++) { const k = gx + ',' + gz; if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(s); }
  };
  for (const w of ways) if (w.smp) for (let i = 0; i < w.pts.length - 1; i++) { if (w === dj && i >= ia && i < ib) continue; addBand(w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1], w.width / 2); }
  for (const r of ctx.city?.roads || []) if (r.k !== 'construction' && r.pts) for (let i = 0; i < r.pts.length - 1; i++) addBand(r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], (r.width || 6) / 2);
  for (const [smp, wd] of [[access, ROAD_W], ...arms.map((a) => [a.smp, a.width])]) for (let i = 0; i < smp.length - 1; i++) addBand(smp[i].x, smp[i].z, smp[i + 1].x, smp[i + 1].z, wd / 2);
  const offAsphalt = (x, z) => {
    const dr = Math.hypot(x - C[0], z - C[1]);
    if (dr >= R_IN - 0.05 && dr <= R_OUT + 0.05) return 0;
    let best = Infinity;
    for (const s of bgrid.get(Math.floor(x / BC) + ',' + Math.floor(z / BC)) || []) {
      best = Math.min(best, segDist(x, z, [s.ax, s.az], [s.bx, s.bz]) - s.hw);
      if (best <= 0) return 0;
    }
    return best;
  };
  const LANE = (u) => { const w = NW[u]; if (NI[u] < 0) return Math.max(1.6, (w.width || 6) / 4); return w.type === 'mw' ? 0.95 : w.type === 'link' || w.k0 === w.k1 ? 0 : w.width / 4; };
  const coachGeo = (hex) => merge([
    box(2.5, 3.0, 12.2, 0, 1.9, 0, 0xffffff), box(2.52, 1.0, 11.6, 0, 2.35, 0.2, 0x1e293b),
    box(2.53, 0.4, 12.22, 0, 1.0, 0, hex), box(2.4, 1.2, 0.05, 0, 2.35, -6.11, 0x1e293b),
    box(2.0, 0.25, 0.05, 0, 3.15, -6.12, hex), ...wheelSet(0.5, 0.3, 1.05, [-4.1, 3.6, 4.9]),
  ]);
  const cMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
  const lines = [];
  COACH_DEST.forEach((d, i) => {
    if (!goal[d.code]) return;
    const res = routeFor(d.code);
    if (!res) return;
    // polilinie: peron (banda autocare) -> drum de acces -> giratoriu (sens trigonometric) -> brat -> graf
    const pts = [];
    const push = (x, y, z) => { const p = pts[pts.length - 1]; if (!p || Math.hypot(p[0] - x, p[2] - z) > 0.5) pts.push([x, y, z]); };
    const uBay = -40 + i * 24 + 1;
    for (let u = uBay; u > -61; u -= 3) { const w = hub.toWorld(u, hub.levelB + 0.06, 78); push(w.x, w.y, w.z); }
    const nPlaza = pts.length;
    let nAcc = 0;
    for (const p of access) { if (Math.hypot(p.x - C[0], p.z - C[1]) < R_OUT + 2) break; push(p.x + p.rx * 2.1, p.y, p.z + p.rz * 2.1); nAcc = pts.length; }
    const ex = res.ex, a0 = ga.ang, da = arcTo(ex.a.ang);
    for (let k = 0; k <= 24; k++) { const a = a0 - da * k / 24; push(C[0] + Math.cos(a) * rMid, yC + 0.03, C[1] + Math.sin(a) * rMid); }
    // bratul: bretelele sunt construite giratoriu -> bretea; bratele DJ208L DJ -> giratoriu (parcurse invers, banda din dreapta)
    const armPts = ex.fwd ? ex.a.smp : ex.a.smp.slice().reverse();
    const laneArm = ex.fwd ? 0 : ex.a.width / 4;
    armPts.forEach((p, k) => {
      if (Math.hypot(p.x - C[0], p.z - C[1]) <= R_OUT - 1) return;
      const q = armPts[Math.min(armPts.length - 1, k + 1)], o = armPts[Math.max(0, k - 1)];
      const tx = q.x - o.x, tz = q.z - o.z, tl = Math.hypot(tx, tz) || 1;
      push(p.x - tz / tl * laneArm, p.y, p.z + tx / tl * laneArm);
    });
    const P = res.path;
    P.forEach((u, k) => {
      const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
      const tx = NX[b] - NX[a], tz = NZ[b] - NZ[a], tl = Math.hypot(tx, tz) || 1, l = LANE(u);
      push(NX[u] - tz / tl * l, NY[u], NZ[u] + tx / tl * l);
    });
    const S = [0];
    for (let k = 1; k < pts.length; k++) S.push(S[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]));
    const mesh = new THREE.InstancedMesh(coachGeo(d.hex), cMat, 2);
    mesh.name = 'autocar-' + d.code; mesh.castShadow = true; mesh.frustumCulled = false;
    group.add(mesh);
    // cel mai mare salt intre puncte consecutive + verificarea „pe asfalt” (esantion la 2 m, de la drumul de acces)
    let jump = 0, off = 0, offN = 0, nS = 0;
    for (let k = 1; k < pts.length; k++) jump = Math.max(jump, Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]));
    for (let k = nPlaza + 1; k < pts.length; k++) {
      const [x0, , z0] = pts[k - 1], [x1, , z1] = pts[k], m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
      for (let j = 0; j < m; j++) { const e = offAsphalt(x0 + (x1 - x0) * j / m, z0 + (z1 - z0) * j / m); nS++; if (e > 0.05) { offN++; off = Math.max(off, e); } }
    }
    const ids = [];
    for (const u of P) { const w = NW[u], id = NI[u] < 0 ? 'oras ' + (w.ref || w.name || w.id) : String(w.id); if (ids[ids.length - 1] !== id) ids.push(id); }
    lines.push({ d, pts, S, len: S[S.length - 1], mesh, sHub: S[Math.min(S.length - 1, nAcc + 25)], chain: ids, partial: false, reached: true, via: res.last.ref, jump, gap: res.gap, off, offN, samples: nS, exit: ex.a.kind, back: returnFor(d.code) });
  });
  const pAt = (L, s, out) => {
    s = Math.min(Math.max(s, 0), L.len);
    let lo = 0, hi = L.S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.S[m] <= s) lo = m; else hi = m; }
    const f = L.S[hi] > L.S[lo] ? (s - L.S[lo]) / (L.S[hi] - L.S[lo]) : 0;
    const A = L.pts[lo], B = L.pts[hi];
    return out.set(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f);
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  // ciclu: 60 s la peron (imbarcare), apoi ~12 m/s pe drumul de acces / giratoriu si ~24 m/s pe bretele / autostrada
  const WAIT = 60;
  function place(L, k, tt) {
    let s;
    if (tt < WAIT) s = 0;
    else { const t = tt - WAIT; s = t * 12 < L.sHub ? t * 12 : L.sHub + (t - L.sHub / 12) * 24; }
    if (s > L.len) return false;
    pAt(L, s + 4.9, a); pAt(L, s - 4.9, b);
    p.addVectors(a, b).multiplyScalar(0.5);
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    e.set(Math.atan2(dy, Math.hypot(dx, dz) || 1), Math.atan2(-dx, -dz), 0);
    q.setFromEuler(e);
    m4.compose(p, q, one);
    L.mesh.setMatrixAt(k, m4);
    return true;
  }
  for (const L of lines) L.cycle = WAIT + L.sHub / 12 + (L.len - L.sHub) / 24 + 10;
  let tg = 0;
  ctx.addUpdate((dt) => {
    tg += dt;
    lines.forEach((L, li) => {
      for (let k = 0; k < 2; k++) {
        const tt = (tg + k * L.cycle / 2 + li * 17) % L.cycle;
        if (!place(L, k, tt)) { m4.makeScale(0, 0, 0); L.mesh.setMatrixAt(k, m4); }
      }
      L.mesh.instanceMatrix.needsUpdate = true;
    });
  });

  const [cu, cv] = W2L(C[0], C[1]);
  const f2 = (x) => (x * 100).toFixed(1);
  console.info(`Hub: giratoriu R${R_OUT} m pe DJ208L (cale ${dj.id}, s ${Math.round(dj.S[best.i])} m) la (${cu.toFixed(0)}, ${cv.toFixed(0)}) local hub, cota ${yC.toFixed(2)}, terasamente max ${best.earth.toFixed(2)} m, ${cutTris} triunghiuri DJ inlocuite; `
    + `acces ${Math.round(access[access.length - 1].s)} m, panta max ${(maxGradeOf(access) * 100).toFixed(2)} %; brate: ${joints.map((j) => `${j.kind} rost ${f2(j.gap)} cm / Δy ${f2(j.dy)} cm / panta ${(j.grade * 100).toFixed(1)} %`).join('; ')}`
    + `${skipped.length ? `; bretele nelegate: ${skipped.join(', ')}` : ''}${merged.length ? `; bretele varsate in alta cale (legate): ${merged.join(', ')}` : ''}; graf: ${repaired} legaturi reparate (< ${GAP} m); autocare: ${lines.map((L) => `${L.d.code} ${Math.round(L.len)} m via ${L.exit} -> ${L.via} (gol max ${L.gap.toFixed(1)} m, salt max ${L.jump.toFixed(1)} m, ${L.offN}/${L.samples} esantioane in afara asfaltului, max ${L.off.toFixed(2)} m; intoarcere ${L.back ? Math.round(L.back.len) + ' m' : 'NU'})`).join(', ')}`);
  return { group, center: new THREE.Vector3(C[0], yC, C[1]), access, arms, joints, lines, ring: { C, yC, R_OUT, R_IN }, skipped, merged, repaired };
}
