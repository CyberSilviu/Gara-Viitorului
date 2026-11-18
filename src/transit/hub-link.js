import * as THREE from 'three';
import { merge, box, tint, makeCanvas, canvasTex, wheelSet } from './util3d.js';
import { COACH_DEST } from './hub.js';

// Legatura Hub Turbion <-> nodul A7×A8, fara giratoriu si fara drum lung de acces: bretele directe pe breteaua 104
// (A8 Vest -> A7, sens unic, la sol, trece chiar pe langa hub, pe latura de vest, cu hub-ul in dreapta ei).
//  - „Drum colector hub” (7 m, sens unic spre sud, borduri, marcaje) pe latura de vest a hub-ului (u ≈ -75), legat
//    de banda autocarelor (v ≈ 76) printr-un racord scurt cu 2 sensuri;
//  - bretea de iesire 104 -> hub: banda de decelerare in dreapta lui 104 (pana 60 m + paralela 160 m, axa la 5,0 m,
//    cota copiata din 104), apoi curba (R >= 60 m, panta <= 5 %) in capatul nordic al colectorului;
//  - bretea de intrare hub -> 104: din capatul sudic al colectorului, curba spre vest, banda de accelerare paralela
//    180 m + pana 60 m in dreapta lui 104, in aval de iesire (fara tesere, fara intersectii).
// Autocarele spre aeroporturi (IAS / SCV / BCM) circula animat dus-intors: peron -> colector -> bretea de intrare ->
// 104 -> graful cailor (Dijkstra, legaturi OSM reparate) -> autostrada tinta; intoarcerea: autostrada -> ... -> 104 ->
// bretea de iesire -> colector -> peron.

const MAX_GRADE = 0.05, COL_W = 7.0, STUB_W = 9.0, RAMP_W = 4.0, LANE_OFF = 5.0, LANE_IN = 3.0, LANE_OUT = 7.0;
const COL_U = -75, STUB_V = 76;

function markTex(kind) {
  const c = makeCanvas(128, 256), g = c.getContext('2d');
  g.fillStyle = '#45484c'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 700; i++) { const v = 50 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  g.fillStyle = '#f2f2ee';
  g.fillRect(5, 0, 4, 256); g.fillRect(119, 0, 4, 256);
  if (kind === 'two') g.fillRect(62, 0, 4, 96);
  if (kind === 'lane') for (let y = 0; y < 256; y += 64) g.fillRect(62, y, 4, 40);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// esantioane {x,y,z,rx,rz,s} dintr-o polilinie [x,z] (rx, rz = normala spre dreapta)
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
const bezPt = (P0, P1, P2, P3, t) => { const u = 1 - t; return [0, 1].map((j) => u * u * u * P0[j] + 3 * u * u * t * P1[j] + 3 * u * t * t * P2[j] + t * t * t * P3[j]); };
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
// raza minima a unei polilinii (cerc prin 3 puncte la ~pas)
function minRadius(pts) {
  let r = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [cx, cz] = pts[i + 1];
    const a = Math.hypot(bx - ax, bz - az), b = Math.hypot(cx - bx, cz - bz), c = Math.hypot(cx - ax, cz - az);
    const cr = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    if (cr > 1e-9) r = Math.min(r, a * b * c / (2 * cr));
  }
  return r;
}
// curba Bezier intre doua poze (punct + directie), cu lungimile de control alese pentru raza minima maxima
function bestCurve(P0, T0, P3, T3, step = 3) {
  const D = Math.hypot(P3[0] - P0[0], P3[1] - P0[1]);
  let best = null;
  for (let c1 = 0.1; c1 <= 1.6; c1 += 0.05) for (let c2 = 0.1; c2 <= 1.6; c2 += 0.05) {
    const P1 = [P0[0] + T0[0] * c1 * D, P0[1] + T0[1] * c1 * D], P2 = [P3[0] - T3[0] * c2 * D, P3[1] - T3[1] * c2 * D];
    const raw = [];
    for (let k = 0; k <= 80; k++) raw.push(bezPt(P0, P1, P2, P3, k / 80));
    const pts = resample(raw, step), r = minRadius(pts);
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const score = Math.min(r, 400) - len * 0.02;
    if (!best || score > best.score) best = { pts, r, len, score };
  }
  return best;
}
// cota: urmeaza terenul (+lift), puncte fixe (index -> y), panta <= MAX_GRADE
function profileFix(smp, H, fix, lift = 0.22) {
  const n = smp.length;
  const t = smp.map((p) => H(p.x, p.z) + lift);
  const y = t.slice();
  const F = new Map(fix);
  for (let it = 0; it < 6; it++) {
    for (const [i, v] of F) y[i] = v;
    for (let i = 1; i < n - 1; i++) if (!F.has(i)) y[i] = Math.max(t[i] - 0.6, (y[i - 1] + y[i] * 2 + y[i + 1]) / 4);
    for (let i = 1; i < n; i++) if (!F.has(i)) y[i] = Math.min(Math.max(y[i], y[i - 1] - MAX_GRADE * (smp[i].s - smp[i - 1].s)), y[i - 1] + MAX_GRADE * (smp[i].s - smp[i - 1].s));
    for (let i = n - 2; i >= 0; i--) if (!F.has(i)) y[i] = Math.min(Math.max(y[i], y[i + 1] - MAX_GRADE * (smp[i + 1].s - smp[i].s)), y[i + 1] + MAX_GRADE * (smp[i + 1].s - smp[i].s));
  }
  smp.forEach((p, i) => { p.y = y[i]; p.t = t[i] - lift; });
  return smp;
}
const segDist = (x, z, A, B) => { const dx = B[0] - A[0], dz = B[1] - A[1], t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[1]) * dz) / (dx * dx + dz * dz || 1e-9))); return Math.hypot(A[0] + dx * t - x, A[1] + dz * t - z); };
const maxGradeOf = (smp) => { let g = 0; for (let i = 1; i < smp.length; i++) { const ds = smp[i].s - smp[i - 1].s; if (ds > 0.5) g = Math.max(g, Math.abs(smp[i].y - smp[i - 1].y) / ds); } return g; };

export function buildHubLink(ctx, motorway, hub, shared) {
  if (!motorway || !hub) return null;
  const H = ctx.terrain.heightAt;
  const ways = motorway.ways;
  const L2W = (u, v) => { const p = hub.toWorld(u, 0, v); return [p.x, p.z]; };
  const W2L = (x, z) => { const dx = x - hub.O.x, dz = z - hub.O.z; return [dx * hub.X.x + dz * hub.X.z, dx * hub.Z.x + dz * hub.Z.z]; };
  const yB = hub.levelB + 0.06;

  // ---- breteaua 104 (A8 Vest -> A7), pe langa hub ----
  const endOf = (w) => w.pts[w.pts.length - 1];
  const r104 = ways.find((w) => w.type === 'link' && w.smp && Math.hypot(w.pts[0][0] + 60.5, w.pts[0][1] - 4654.1) < 20 && Math.hypot(endOf(w)[0] + 1295, endOf(w)[1] - 4299) < 20)
    || ways.find((w) => String(w.id) === '104');
  if (!r104) { console.warn('Hub: breteaua 104 lipseste – fara legatura hub – nod'); return null; }
  const W = r104, WS = W.S, WN = W.pts.length;
  // pozitie / cota / tangenta pe 104 la distanta s
  const at104 = (s) => {
    s = Math.max(0, Math.min(W.len, s));
    let i = 0; while (i < WN - 2 && WS[i + 1] < s) i++;
    const f = (s - WS[i]) / (WS[i + 1] - WS[i] || 1), a = W.pts[i], b = W.pts[i + 1];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    return { x: a[0] + tx * f, z: a[1] + tz * f, y: W.Y[i] + (W.Y[i + 1] - W.Y[i]) * f, tx: tx / tl, tz: tz / tl, i };
  };
  const sAtV = (v) => { for (let i = 0; i < WN - 1; i++) { const v0 = W2L(...W.pts[i])[1], v1 = W2L(...W.pts[i + 1])[1]; if ((v0 - v) * (v1 - v) <= 0 && v0 !== v1) return WS[i] + (WS[i + 1] - WS[i]) * (v0 - v) / (v0 - v1); } return null; };
  const idxAt = (s) => { let i = 0; while (i < WN - 1 && WS[i] < s) i++; return i; }; // primul varf cu S >= s

  // banda paralela (taper + paralela) in dreapta lui 104: esantioane la ~3 m, cota = cota lui 104
  // grow(s) in [0,1]: latimea benzii (0 = inceputul / sfarsitul penei)
  function sideLaneOn(atF, s0, s1, grow, IN, OUT) {
    const out = [];
    const n = Math.max(2, Math.ceil((s1 - s0) / 3));
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n, p = atF(s), g = grow(s);
      const rx = -p.tz, rz = p.tx, b = IN + (OUT - IN) * g;
      out.push({ x: p.x, y: p.y + 0.02, z: p.z, rx, rz, s: s - s0, s104: s, a: IN, b, lane: (IN + b) / 2 * Math.min(1, g * 1.6), t: H(p.x, p.z) });
    }
    return out;
  }
  const sideLane = (s0, s1, grow) => sideLaneOn(at104, s0, s1, grow, LANE_IN, LANE_OUT);
  const lanePt = (p, off = LANE_OFF) => [p.x + p.rx * off, p.z + p.rz * off];

  // ---- colectorul (u = -75, sens -v) ----
  const V_TOP = 170, V_BOT = 50;
  const colXZ = [];
  for (let v = V_TOP; v >= V_BOT - 0.01; v -= 3) colXZ.push(L2W(COL_U, v));
  const col = samplesXZ(colXZ);
  const iStub = col.reduce((b, p, i) => (Math.abs(W2L(p.x, p.z)[1] - STUB_V) < Math.abs(W2L(col[b].x, col[b].z)[1] - STUB_V) ? i : b), 0);
  const colFix = [];
  for (let i = 0; i < col.length; i++) if (Math.abs(i - iStub) <= 3) colFix.push([i, yB]);
  profileFix(col, H, colFix);
  // racordul banda autocarelor <-> colector (2 sensuri, 9 m)
  const stub = samplesXZ([L2W(-58, STUB_V), L2W(-64, STUB_V), L2W(-70, STUB_V), L2W(COL_U, STUB_V)]);
  stub.forEach((p) => { p.y = yB; p.t = H(p.x, p.z); });

  // ---- bretea de iesire 104 -> colector ----
  // desprinderea: prima pozitie (v 450…540) cu raza minima >= 60 m a curbei spre colector
  const colT = [col[1].x - col[0].x, col[1].z - col[0].z].map((c, _, a) => c / Math.hypot(...a));
  let sDiv = null, cOff = null;
  for (let v = 450; v <= 540; v += 15) {
    const s = sAtV(v);
    if (s === null || s < 260) continue;
    const q = at104(s), c = bestCurve(lanePt({ x: q.x, z: q.z, rx: -q.tz, rz: q.tx }), [q.tx, q.tz], [col[0].x, col[0].z], colT);
    if (!cOff || c.r > cOff.r) { cOff = c; sDiv = s; }
    if (c.r >= 60) break;
  }
  if (sDiv === null) { sDiv = sAtV(420) ?? W.len * 0.36; }
  const sOff0 = sDiv - 220, sOff1 = sDiv - 160;         // pana 60 m + paralela 160 m
  const decel = sideLane(sOff0, sDiv, (s) => Math.min(1, Math.max(0, (s - sOff0) / (sOff1 - sOff0))));
  const pD = at104(sDiv);
  const P0 = lanePt(decel[decel.length - 1]);
  if (!cOff) cOff = bestCurve(P0, [pD.tx, pD.tz], [col[0].x, col[0].z], colT);
  const offRamp = samplesXZ(cOff.pts);
  profileFix(offRamp, H, [[0, decel[decel.length - 1].y], [offRamp.length - 1, col[0].y]]);
  offRamp.forEach((p, i) => { const f = p.s / offRamp[offRamp.length - 1].s; p.w = RAMP_W + (COL_W - RAMP_W) * Math.max(0, (f - 0.7) / 0.3); });

  // ---- bretea de intrare colector -> 104 ----
  const colEnd = col[col.length - 1];
  let cOn = null, sAcc0 = 0;
  for (let v = -30; v >= -220; v -= 5) {
    const s = sAtV(v);
    if (s === null || s > W.len - 290) continue; // paralela + pana se termina inainte de capatul lui 104 (despartirea 98 / 103)
    const p = at104(s), q = { x: p.x, z: p.z, rx: -p.tz, rz: p.tx };
    // doua curbe (stanga, apoi dreapta) cu o poza intermediara la mijloc: raze mari
    const A = [colEnd.x, colEnd.z], B = lanePt(q), M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], dl = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const dC = [(B[0] - A[0]) / dl, (B[1] - A[1]) / dl], kd = 2 * (colT[0] * dC[0] + colT[1] * dC[1]);
    const dM = [kd * dC[0] - colT[0], kd * dC[1] - colT[1]]; // tangenta colectorului oglindita fata de coarda => doua arce simetrice
    const c1 = bestCurve(A, colT, M, dM), c2 = bestCurve(M, dM, B, [p.tx, p.tz]);
    const pts2 = c1.pts.concat(c2.pts.slice(1)), r2 = minRadius(resample(pts2, 6));
    const c0 = bestCurve(A, colT, B, [p.tx, p.tz]);
    const c = r2 > c0.r ? { pts: pts2, r: r2, len: c1.len + c2.len } : c0;
    if (c.r >= 60) { cOn = c; sAcc0 = s; break; }
    if (!cOn || c.r > cOn.r) { cOn = c; sAcc0 = s; }
  }
  const onRamp = samplesXZ(cOn.pts);
  const sAcc1 = sAcc0 + 180, sAcc2 = sAcc1 + 60;        // paralela 180 m + pana 60 m
  const accel = sideLane(sAcc0, sAcc2, (s) => Math.min(1, Math.max(0, (sAcc2 - s) / (sAcc2 - sAcc1))));
  profileFix(onRamp, H, [[0, colEnd.y], [onRamp.length - 1, accel[0].y]]);
  onRamp.forEach((p) => { const f = p.s / onRamp[onRamp.length - 1].s; p.w = COL_W + (RAMP_W - COL_W) * Math.min(1, f / 0.3); });

  // ======== drumuri noi (proiect; OSM nu le are): bretea hub -> A8 Est (IAS) si bretea de intoarcere A8 Est -> hub ========
  // A8 Est (Iasi) si A8 Vest trec la ~300 m de colector, cu 104 lipita de A8 Vest pe latura hub-ului si bretelele
  // A7 -> A8 Est (100, 42) lipite de A8 Est pe latura opusa. Ambele bretele noi trec PE POD peste tot manunchiul
  // (gabarit >= 5,0 m + tablier 1,2 m, panta <= 5 %, pile in afara carosabilului).
  //  - IAS dus: continuarea racordului autocarelor peste colector, curba spre sud, pod peste bretea de iesire / 104 / A8 Vest /
  //    A8 Est / 100 / 42, coborare paralela cu A8 Est si intrare pe dreapta ei (paralela 180 m + pana 60 m);
  //  - intoarcere A7 -> hub (varianta c): A7 -> bretelele existente ale turbinei spre A8 Est (100 / 42) -> A8 Est ->
  //    banda de decelerare (pana 60 m + paralela 160 m) -> bucla la dreapta (R 70 m, 250°) urcand -> pod peste A8 -> drum
  //    colector-distribuitor pe latura hub-ului (pod peste DJ208L) -> banda dreapta a colectorului (langa breteaua 104).
  //    (a) nu e posibila: bretelele A7 -> A8 Vest se unesc cu A8 Vest la vest de turbina, in aval de hub.
  const w122 = ways.find((w) => w.smp && w.type === 'mw' && Math.hypot(w.pts[0][0] + 865, w.pts[0][1] - 4688) < 25 && endOf(w)[0] > 0) || ways.find((w) => String(w.id) === '122');
  const tools = (w) => {
    const n = w.pts.length, S = w.S;
    const at = (s) => {
      s = Math.max(0, Math.min(w.len, s));
      let i = 0; while (i < n - 2 && S[i + 1] < s) i++;
      const f = (s - S[i]) / (S[i + 1] - S[i] || 1), a = w.pts[i], b = w.pts[i + 1];
      const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
      return { x: a[0] + tx * f, z: a[1] + tz * f, y: w.Y[i] + (w.Y[i + 1] - w.Y[i]) * f, tx: tx / tl, tz: tz / tl, i };
    };
    const sAtVw = (v) => { for (let i = 0; i < n - 1; i++) { const v0 = W2L(...w.pts[i])[1], v1 = W2L(...w.pts[i + 1])[1]; if ((v0 - v) * (v1 - v) <= 0 && v0 !== v1) return S[i] + (S[i + 1] - S[i]) * (v0 - v) / (v0 - v1); } return null; };
    const idx = (s) => { let i = 0; while (i < n - 1 && S[i] < s) i++; return i; };
    // proiectia unui punct: s si deplasarea laterala (+ = dreapta caii)
    const proj = (x, z) => { let best = null; for (let i = 0; i < n - 1; i++) { const a = w.pts[i], b = w.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)), px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz); if (!best || d < best.d) { const l = Math.sqrt(l2); best = { d, s: S[i] + t * l, off: ((x - px) * -dz + (z - pz) * dx) / l }; } } return best; };
    return { w, at, sAtV: sAtVw, idx, proj };
  };
  const pose = (T, s, off, ang = 0) => { const p = T.at(s), rx = -p.tz, rz = p.tx, c = Math.cos(ang), sn = Math.sin(ang); return { p: [p.x + rx * off, p.z + rz * off], t: [p.tx * c + rx * sn, p.tz * c + rz * sn] }; };
  const chainPoses = (poses) => { let pts = []; for (let k = 0; k < poses.length - 1; k++) { const c = bestCurve(poses[k].p, poses[k].t, poses[k + 1].p, poses[k + 1].t); pts = pts.length ? pts.concat(c.pts.slice(1)) : c.pts; } return pts; };
  const lenOf = (smp) => smp[smp.length - 1].s;
  // obstacole (drumuri existente la sol): segmente cu semilatime si cota
  const obstacles = [];
  const addObs = (id, A, B, hw, y) => obstacles.push({ id, ax: A[0], az: A[1], bx: B[0], bz: B[1], hw, y });
  for (const w of ways) if (w.smp) for (let i = 0; i < w.pts.length - 1; i++) addObs('w' + w.id, w.pts[i], w.pts[i + 1], w.width / 2, Math.max(w.Y[i], w.Y[i + 1]));
  for (const r of ctx.city?.roads || []) if (r.k !== 'construction' && r.pts) for (let i = 0; i < r.pts.length - 1; i++) addObs('oras', r.pts[i], r.pts[i + 1], (r.width || 6) / 2, Math.max(H(...r.pts[i]), H(...r.pts[i + 1])) + 0.15);
  {
    const rt = ctx.transit?.route || shared?.route, v3 = new THREE.Vector3();
    if (rt?.pos) for (let s = 0; s < rt.length - 5; s += 5) { const a = rt.pos(s, v3.clone()), b = rt.pos(s + 5, v3.clone()); addObs('T1', [a.x, a.z], [b.x, b.z], 4.0, Math.max(a.y, b.y) + 0.6); }
  }
  const addObsSmp = (id, smp, hw) => { for (let i = 0; i < smp.length - 1; i++) addObs(id, [smp[i].x, smp[i].z], [smp[i + 1].x, smp[i + 1].z], (smp[i].w ?? hw) / 2, Math.max(smp[i].y, smp[i + 1].y)); };
  const addObsLane = (id, L) => addObsSmp(id, L.map((p) => ({ x: p.x + p.rx * (p.a + p.b) / 2, z: p.z + p.rz * (p.a + p.b) / 2, y: p.y, w: Math.max(0.5, p.b - p.a) })), 4);
  addObsSmp('colector', col, COL_W); addObsSmp('iesire104', offRamp, RAMP_W); addObsSmp('intrare104', onRamp, RAMP_W);
  addObsLane('decel104', decel); addObsLane('accel104', accel);
  const CLEAR = 5.0 + 1.2 + 0.2, G_MAX = 0.049;
  // cota unei bretele noi: >= teren, >= obstacol + gabarit (unde trece peste el), panta <= 4,9 %, capetele fixe
  function clearProfile(smp, y0, y1, skip) {
    const n = smp.length, Ln = smp[n - 1].s;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of smp) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const obs = obstacles.filter((o) => Math.max(o.ax, o.bx) > x0 - 30 && Math.min(o.ax, o.bx) < x1 + 30 && Math.max(o.az, o.bz) > z0 - 30 && Math.min(o.az, o.bz) < z1 + 30);
    const f = smp.map((p, i) => {
      // langa capete, cota poate urma drumul la care se leaga (A8 in debleu / rambleu), apoi revine treptat la teren
      let m = Math.min(H(p.x, p.z) + 0.22, y0 + 0.03 * p.s + 0.02, y1 + 0.03 * (Ln - p.s) + 0.02);
      if (p.s > 120 && Ln - p.s > 120) m = H(p.x, p.z) + 0.22;
      p.fo = null;
      for (const o of obs) if (!skip(i, o) && segDist(p.x, p.z, [o.ax, o.az], [o.bx, o.bz]) < o.hw + RAMP_W / 2 + 2.0 && o.y + CLEAR > m) { m = o.y + CLEAR; p.fo = o.id; }
      return m;
    });
    f[0] = y0; f[n - 1] = y1;
    const y = f.slice();
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < n; i++) y[i] = Math.max(y[i], y[i - 1] - G_MAX * (smp[i].s - smp[i - 1].s));
      for (let i = n - 2; i >= 0; i--) y[i] = Math.max(y[i], y[i + 1] - G_MAX * (smp[i + 1].s - smp[i].s));
    }
    // netezire usoara (nu coboara sub plafonul minim)
    for (let it = 0; it < 4; it++) for (let i = 1; i < n - 1; i++) y[i] = Math.max(f[i], (y[i - 1] + 2 * y[i] + y[i + 1]) / 4);
    smp.forEach((p, i) => { p.y = y[i]; p.t = H(p.x, p.z); });
    return { start: Math.abs(y[0] - y0), end: Math.abs(y[n - 1] - y1) };
  }
  let iasRamp = null, accel122 = null, retRamp = null, decel122 = null, kJ = 0, sA0 = 0, sA2 = 0, sR0 = 0, sR1 = 0, prIas = null, prRet = null;
  const L122_IN = w122 ? w122.width / 2 - 0.2 : 4.8, L122_OUT = L122_IN + 3.8, L122_OFF = (L122_IN + L122_OUT) / 2;
  if (w122) {
    const T = tools(w122);
    const sX = T.sAtV(400) ?? w122.len * 0.45;
    // --- IAS dus ---
    const pm = T.at(sX), rmx = -pm.tz, rmz = pm.tx, ANG = 0.70;
    const cx = pm.tx * Math.cos(ANG) + rmx * Math.sin(ANG), cz = pm.tz * Math.cos(ANG) + rmz * Math.sin(ANG);
    const st = L2W(COL_U - COL_W / 2, STUB_V), stT = [-hub.X.x, -hub.X.z];
    sA0 = sX + 460; const sA1 = sA0 + 180; sA2 = sA1 + 60;
    accel122 = sideLaneOn(T.at, sA0, sA2, (s) => Math.min(1, Math.max(0, (sA2 - s) / (sA2 - sA1))), L122_IN, L122_OUT);
    const iasXZ = chainPoses([
      { p: st, t: stT },
      { p: [pm.x - cx * 60, pm.z - cz * 60], t: [cx, cz] },
      { p: [pm.x + cx * 60, pm.z + cz * 60], t: [cx, cz] },
      pose(T, sX + 120, 62),
      pose(T, sA0, L122_OFF),
    ]);
    iasRamp = samplesXZ(resample(iasXZ, 3));
    const LI = lenOf(iasRamp);
    prIas = clearProfile(iasRamp, yB, accel122[0].y, (i, o) => (o.id === 'colector' && i < 6) || (o.id === 'w' + w122.id && iasRamp[i].s > LI - 120) || (o.id === 'oras' && false));
    iasRamp.r = minRadius(resample(iasXZ, 6));
    // --- intoarcere: banda de decelerare pe A8 Est, bucla, pod, colector-distribuitor, unire cu breteaua de iesire 104 ---
    sR0 = sA2 + 50; sR1 = sR0 + 220;
    const sR0b = sR0 + 60;
    decel122 = sideLaneOn(T.at, sR0, sR1, (s) => Math.min(1, Math.max(0, (s - sR0) / (sR0b - sR0))), L122_IN, L122_OUT);
    const D = pose(T, sR1, L122_OFF), E = pose(T, sR1 + 70, L122_OFF + 15, 0.35);
    const lead = chainPoses([D, E]);
    const R = 70, rt = [-E.t[1], E.t[0]], Cc = [E.p[0] + rt[0] * R, E.p[1] + rt[1] * R];
    const loop = [];
    for (let th = 3 / R; th <= 4.363; th += 3 / R) {
      const tt = [E.t[0] * Math.cos(th) + rt[0] * Math.sin(th), E.t[1] * Math.cos(th) + rt[1] * Math.sin(th)];
      loop.push([Cc[0] - R * -tt[1], Cc[1] - R * tt[0]]);
    }
    const Fp = loop[loop.length - 1], Ft = [-rt[0], -rt[1]];
    const FT = [E.t[0] * Math.cos(4.363) + rt[0] * Math.sin(4.363), E.t[1] * Math.cos(4.363) + rt[1] * Math.sin(4.363)];
    const pF = T.proj(Fp[0], Fp[1]);
    // unirea: banda din dreapta a colectorului (7 m = 2 benzi), la v ≈ 146, langa breteaua de iesire 104 (banda stanga)
    kJ = Math.max(2, Math.min(iStub - 4, Math.round((V_TOP - 146) / 3)));
    const cJ = col[kJ], J = { x: cJ.x + cJ.rx * 1.75, y: cJ.y, z: cJ.z + cJ.rz * 1.75 }, Jt = colT;
    // colectorul-distribuitor urmareste A8 (care e curba) la 100 m pe latura hub-ului, apoi coteste spre colector pe la
    // est de breteaua de iesire 104 si pe la vest de parcarea P+R (u < -60), paralel cu colectorul in ultimii ~90 m
    const back9 = (s, off) => { const q = T.at(s); return { p: pose(T, s, off).p, t: [-q.tx, -q.tz] }; };
    const CDO = -100, K = { p: L2W(-67.5, 236), t: colT };
    const hK = [-hub.Z.x - pm.tx, -hub.Z.z - pm.tz]; // directia medie intre -t (A8) si -v (colector)
    { const l = Math.hypot(...hK); hK[0] /= l; hK[1] /= l; }
    const M2 = { p: [K.p[0] - hK[0] * 170, K.p[1] - hK[1] * 170], t: [-pm.tx, -pm.tz] };
    const vM2 = W2L(...M2.p)[1];
    const bp = [{ p: Fp, t: FT }, { p: pose(T, pF.s, -22).p, t: FT }];
    for (let s = pF.s - 110; ; s -= 170) { const q = back9(s, CDO); if (W2L(...q.p)[1] < vM2 + 150) break; bp.push(q); }
    bp.push(M2, K, { p: [J.x, J.z], t: Jt });
    const back = chainPoses(bp);
    void Ft;
    const retXZ = lead.concat(loop, back.slice(1));
    retRamp = samplesXZ(resample(retXZ, 3));
    const LR = lenOf(retRamp);
    prRet = clearProfile(retRamp, decel122[decel122.length - 1].y, J.y, (i, o) => (o.id === 'w' + w122.id && retRamp[i].s < 100) || ((o.id === 'iesire104' || o.id === 'colector') && retRamp[i].s > LR - 70));
    retRamp.r = minRadius(resample(retXZ, 6));
    // IAS: obstacolele includ si drumurile noi de intoarcere -> refacem cota cu ele
    addObsSmp('retur', retRamp, RAMP_W); addObsLane('decel122', decel122);
    prIas = clearProfile(iasRamp, yB, accel122[0].y, (i, o) => (o.id === 'colector' && i < 6) || (o.id === 'w' + w122.id && iasRamp[i].s > LI - 120));
  }

  // ---- geometrie ----
  const asph = { two: [], one: [], lane: [] }, kerbs = [], skirts = [], paint = [];
  const P = (s, off, dy = 0) => [s.x + s.rx * off, s.y + dy, s.z + s.rz * off];
  // fasie cu deplasari variabile (a < b, spre dreapta); normala in sus
  function strip(out, smp, A, B, dy = 0, uv = null) {
    let d = 0;
    for (let i = 0; i < smp.length - 1; i++) {
      const p = smp[i], q = smp[i + 1], seg = Math.hypot(q.x - p.x, q.z - p.z);
      const pa = P(p, A(p), dy), pb = P(p, B(p), dy), qa = P(q, A(q), dy), qb = P(q, B(q), dy);
      out.pos.push(...pb, ...qb, ...pa, ...pa, ...qb, ...qa);
      if (uv) { const d0 = d / 9, d1 = (d + seg) / 9; out.uv.push(1, d0, 1, d1, 0, d0, 0, d0, 1, d1, 0, d1); }
      d += seg;
    }
  }
  const G = () => ({ pos: [], uv: [] });
  const gTwo = G(), gOne = G(), gLane = G(), gKerb = G(), gSkirt = G();
  function addRoad(smp, g, A, B, { kerbL = true, kerbR = true, skirt = true } = {}) {
    strip(g, smp, A, B, 0, true);
    for (const [on, E, sd] of [[kerbL, A, -1], [kerbR, B, 1]]) {
      if (on) {
        const e0 = (p) => E(p) + (sd > 0 ? 0 : -0.3), e1 = (p) => E(p) + (sd > 0 ? 0.3 : 0);
        strip(gKerb, smp, e0, e1, 0.15);
        // fetele verticale ale bordurii (ambele sensuri de parcurgere)
        for (let i = 0; i < smp.length - 1; i++) for (const off of [e0, e1]) {
          const p = smp[i], q = smp[i + 1], a0 = P(p, off(p)), a1 = P(p, off(p), 0.15), b0 = P(q, off(q)), b1 = P(q, off(q), 0.15);
          gKerb.pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1, ...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
        }
      }
      if (skirt) for (let i = 0; i < smp.length - 1; i++) {
        const p = smp[i], q = smp[i + 1], ep = E(p) + sd * 0.3, eq = E(q) + sd * 0.3;
        if (typeof skirt === 'function' && !skirt(p, q)) continue;
        const hp = Math.max(0.25, p.y - (p.t ?? p.y)), hq = Math.max(0.25, q.y - (q.t ?? q.y));
        const a = P(p, ep), b = P(p, ep + sd * hp * 1.6, -(hp + 0.6)), c = P(q, eq), d = P(q, eq + sd * hq * 1.6, -(hq + 0.6));
        gSkirt.pos.push(...a, ...b, ...c, ...c, ...b, ...d);
      }
    }
  }
  const half = (w) => [(p) => -(p.w ?? w) / 2, (p) => (p.w ?? w) / 2];
  addRoad(col, gTwo, ...half(COL_W));
  addRoad(stub, gTwo, ...half(STUB_W), { kerbL: true, kerbR: true, skirt: false });
  addRoad(offRamp, gOne, ...half(RAMP_W));
  addRoad(onRamp, gOne, ...half(RAMP_W));
  // benzile paralele: bordura numai pe marginea exterioara (marginea interioara = asfaltul lui 104)
  addRoad(decel, gLane, (p) => p.a, (p) => p.b, { kerbL: false, kerbR: true });
  addRoad(accel, gLane, (p) => p.a, (p) => p.b, { kerbL: false, kerbR: true });
  // bretelele noi: rambleu unde sunt joase, pod (tablier 1,2 m + pile in afara carosabilelor) unde sunt sus
  const BR_H = 2.2, high = (p) => p.y - (p.t ?? p.y) > BR_H;
  const piers = [];
  let nPiers = 0;
  function addBridge(smp, w) {
    const hw = w / 2 + 0.3;
    for (let i = 0; i < smp.length - 1; i++) {
      const p = smp[i], q = smp[i + 1];
      if (!high(p) && !high(q)) continue;
      // intradosul si fetele laterale ale tablierului
      const pa = P(p, -hw, -1.2), pb = P(p, hw, -1.2), qa = P(q, -hw, -1.2), qb = P(q, hw, -1.2);
      gKerb.pos.push(...pa, ...qa, ...pb, ...pb, ...qa, ...qb);
      for (const off of [-hw, hw]) { const a0 = P(p, off, -1.2), a1 = P(p, off, 0.15), b0 = P(q, off, -1.2), b1 = P(q, off, 0.15); gKerb.pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1, ...a0, ...a1, ...b0, ...b0, ...a1, ...b1); }
      // parapet 0,9 m
      for (const off of [-hw, hw]) { const a0 = P(p, off, 0.15), a1 = P(p, off, 0.9), b0 = P(q, off, 0.15), b1 = P(q, off, 0.9); gKerb.pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1, ...a0, ...a1, ...b0, ...b0, ...a1, ...b1); }
    }
    // pile la ~27 m, numai unde nu cad pe un carosabil (drumuri existente / noi)
    let last = -1e9;
    for (const p of smp) {
      if (!high(p) || p.s - last < 27) continue;
      const free = !obstacles.some((o) => segDist(p.x, p.z, [o.ax, o.az], [o.bx, o.bz]) < o.hw + 1.6 && o.y < p.y - 2);
      if (!free) continue;
      const h = p.y - 1.2 - p.t;
      piers.push(box(1.3, h + 0.5, 1.3, p.x, p.t + h / 2 - 0.25, p.z, 0xb9b9b4));
      last = p.s; nPiers++;
    }
  }
  if (iasRamp) {
    addRoad(iasRamp, gOne, ...half(RAMP_W), { skirt: (p, q) => !high(p) && !high(q) });
    addRoad(accel122, gLane, (p) => p.a, (p) => p.b, { kerbL: false, kerbR: true });
    addBridge(iasRamp, RAMP_W);
  }
  if (retRamp) {
    addRoad(retRamp, gOne, ...half(RAMP_W), { skirt: (p, q) => !high(p) && !high(q) });
    addRoad(decel122, gLane, (p) => p.a, (p) => p.b, { kerbL: false, kerbR: true });
    addBridge(retRamp, RAMP_W);
  }
  // marcaje: sageti de sens pe colector (dreptunghiuri scurte orientate) + linie de cedare la intrarea in 104
  const yaw = (p) => Math.atan2(p.rx, p.rz);
  for (let i = 4; i < col.length - 2; i += 10) for (const off of [-1.75, 1.75]) paint.push(box(0.15, 0.02, 3.0, 0, 0, 0, 0xf2f2ee).rotateY(yaw(col[i]) + Math.PI / 2).translate(...P(col[i], off, 0.025)));

  // ---- asamblare ----
  const group = new THREE.Group();
  group.name = 'hub-bretele-104';
  const geo = (g, uv = true) => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3)); if (uv && g.uv.length) b.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); b.computeVertexNormals(); return b; };
  const matOf = (k) => new THREE.MeshStandardMaterial({ map: markTex(k), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const mkMesh = (g, mat, name) => { const m = new THREE.Mesh(g, mat); m.name = name; m.receiveShadow = true; group.add(m); return m; };
  const roadMeshes = [
    mkMesh(geo(gTwo), matOf('lane'), 'hub-colector-asfalt'),
    mkMesh(geo(gOne), matOf('one'), 'hub-bretele-asfalt'),
    mkMesh(geo(gLane), matOf('one'), 'hub-benzi-104-asfalt'),
  ];
  mkMesh(geo(gSkirt, false), new THREE.MeshStandardMaterial({ color: 0x6f8a4a, roughness: 1, side: THREE.DoubleSide }), 'hub-bretele-taluz');
  const kg = geo(gKerb, false); tint(kg, 0xc9c9c4);
  mkMesh(merge([kg, ...paint, ...piers]), shared.concreteMat, 'hub-bretele-borduri').castShadow = true;
  ctx.scene.add(group);
  for (const m of roadMeshes) ctx.walkables.push(m);

  // ---- rosturi (cota): benzile paralele vs 104, curbele vs benzi / colector ----
  const dh = (a, b) => Math.abs(a.y - b.y);
  const joints = {
    decel104: Math.max(...decel.map((p) => Math.abs(p.y - 0.02 - at104(p.s104).y))),
    accel104: Math.max(...accel.map((p) => Math.abs(p.y - 0.02 - at104(p.s104).y))),
    offRampStart: dh(offRamp[0], decel[decel.length - 1]), offRampEnd: dh(offRamp[offRamp.length - 1], col[0]),
    onRampStart: dh(onRamp[0], colEnd), onRampEnd: dh(onRamp[onRamp.length - 1], accel[0]),
  };
  if (iasRamp) {
    const at122 = tools(w122).at;
    Object.assign(joints, {
      accel122: Math.max(...accel122.map((p) => Math.abs(p.y - 0.02 - at122(p.s104).y))),
      decel122: Math.max(...decel122.map((p) => Math.abs(p.y - 0.02 - at122(p.s104).y))),
      iasStart: Math.abs(iasRamp[0].y - yB), iasEnd: dh(iasRamp[iasRamp.length - 1], accel122[0]),
      returStart: dh(retRamp[0], decel122[decel122.length - 1]), returEnd: dh(retRamp[retRamp.length - 1], col[kJ]),
    });
  }

  // ---- autocarele spre aeroporturi: graf de rutare (motorway.ways + drumurile existente ale orasului) ----
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
  const back = {
    IAS: (w) => /A8/.test(w.ref) && w.pts[0][0] > N.x + 1200 && w.pts[0][0] > end(w)[0],
    SCV: (w) => /A7/.test(w.ref) && w.pts[0][1] < N.z - 1200 && w.pts[0][1] < end(w)[1],
    BCM: (w) => /A7/.test(w.ref) && w.pts[0][1] > N.z + 1200 && w.pts[0][1] > end(w)[1],
  };
  const isMwGoal = (code) => (u) => NI[u] >= 0 && NW[u].type === 'mw' && goal[code](NW[u]) && NW[u].len - NW[u].S[NI[u]] > 200;
  const ids104 = wayNodes.get(W);
  const iExit = Math.min(WN - 1, idxAt(sAcc2)), iEntry = Math.max(0, idxAt(sOff0) - 1);
  const exitNode = ids104[iExit], entryNode = ids104[iEntry];
  // drumurile noi in graf (dupa reparare => fara legaturi automate): noduri virtuale „hub, plecare” (capatul colectorului)
  // si „hub, sosire” (capatul de nord al colectorului) + bretelele noi spre / dinspre A8 Est
  const HUBW = { id: 'hub', type: 'hub', width: COL_W };
  const chainIds = (smp, wObj) => { const ids = smp.map((p) => node(p.x, p.y, p.z, wObj, -2)); for (let i = 0; i < ids.length - 1; i++) edge(ids[i], ids[i + 1], smp[i + 1].s - smp[i].s); return ids; };
  const hubOut = node(colEnd.x, yB, colEnd.z, HUBW, -2), hubIn = node(col[0].x, yB, col[0].z, HUBW, -2);
  edge(hubOut, exitNode, lenOf(onRamp) + 240);
  edge(entryNode, hubIn, 220 + lenOf(offRamp));
  let iasIds = null, retIds = null, n122acc = -1, n122dec = -1;
  if (iasRamp && wayNodes.get(w122)) {
    const ids122 = wayNodes.get(w122), T = tools(w122);
    iasIds = chainIds(iasRamp, { id: 'bretea hub-A8 Est', type: 'link', width: RAMP_W });
    retIds = chainIds(retRamp, { id: 'bretea A8 Est-hub', type: 'link', width: RAMP_W });
    n122acc = ids122[Math.min(ids122.length - 1, T.idx(sA2))];
    n122dec = ids122[Math.max(0, T.idx(sR0) - 1)];
    edge(hubOut, iasIds[0], 0);
    edge(iasIds[iasIds.length - 1], n122acc, sA2 - sA0);
    edge(n122dec, retIds[0], sR1 - sR0 + 5);
    edge(retIds[retIds.length - 1], hubIn, 1);
  }
  function routeOut(code) {
    const r = dijkstra([[hubOut, 0]], isMwGoal(code));
    if (!r) return null;
    const u = r.path[r.path.length - 1], w = NW[u], ids = wayNodes.get(w);
    for (let i = NI[u] + 1; i < ids.length; i++) r.path.push(ids[i]);
    const ias = !!iasIds && r.path[1] === iasIds[0];
    // traseul incepe la nodul de pe 104 (capatul benzii de accelerare) sau pe A8 Est (capatul benzii noi)
    r.path = ias ? r.path.slice(r.path.indexOf(n122acc)) : r.path.slice(1);
    return { ...r, last: w, ias };
  }
  function routeIn(code) {
    const src = [];
    for (const [w, ids] of wayNodes) if (w.type === 'mw' && back[code](w) && Math.hypot(w.pts[0][0] - N.x, w.pts[0][1] - N.z) < 4000) src.push([ids[0], 0]);
    const r = dijkstra(src, (v) => v === hubIn);
    if (!r) return null;
    const k = retIds ? r.path.indexOf(retIds[0]) : -1;
    const ret = k > 0;
    r.path = r.path.slice(0, ret ? k : r.path.indexOf(entryNode) + 1);
    return { ...r, ret };
  }
  // benzile de asfalt desenate (verificare: autocarele nu ies de pe asfalt)
  const BC = 40, bgrid = new Map();
  const addBand = (ax, az, bx, bz, hw) => {
    const s = { ax, az, bx, bz, hw };
    for (let gx = Math.floor((Math.min(ax, bx) - hw) / BC); gx <= Math.floor((Math.max(ax, bx) + hw) / BC); gx++)
      for (let gz = Math.floor((Math.min(az, bz) - hw) / BC); gz <= Math.floor((Math.max(az, bz) + hw) / BC); gz++) { const k = gx + ',' + gz; if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(s); }
  };
  for (const w of ways) if (w.smp) for (let i = 0; i < w.pts.length - 1; i++) addBand(w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1], w.width / 2);
  for (const r of ctx.city?.roads || []) if (r.k !== 'construction' && r.pts) for (let i = 0; i < r.pts.length - 1; i++) addBand(r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], (r.width || 6) / 2);
  // drumurile noi (axa + latime); benzile paralele ca fasii la deplasarea (a + b) / 2
  const laneAxis = (L) => L.map((p) => ({ x: p.x + p.rx * (p.a + p.b) / 2, y: p.y, z: p.z + p.rz * (p.a + p.b) / 2, w: p.b - p.a }));
  const roads = [
    { n: 'drum colector hub', smp: col, width: COL_W },
    { n: 'racord banda autocare', smp: stub, width: STUB_W },
    { n: 'bretea iesire 104 -> hub', smp: offRamp, width: RAMP_W },
    { n: 'bretea intrare hub -> 104', smp: onRamp, width: RAMP_W },
    { n: 'banda decelerare 104', smp: laneAxis(decel), width: LANE_OUT - LANE_IN, adj: 'w' + W.id },
    { n: 'banda accelerare 104', smp: laneAxis(accel), width: LANE_OUT - LANE_IN, adj: 'w' + W.id },
  ];
  if (iasRamp) roads.push(
    { n: 'bretea hub -> A8 Est (IAS)', smp: iasRamp, width: RAMP_W },
    { n: 'banda accelerare A8 Est', smp: laneAxis(accel122), width: L122_OUT - L122_IN, adj: 'w' + w122.id },
    { n: 'bretea intoarcere A8 Est -> hub', smp: retRamp, width: RAMP_W },
    { n: 'banda decelerare A8 Est', smp: laneAxis(decel122), width: L122_OUT - L122_IN, adj: 'w' + w122.id },
  );
  for (const R of roads) for (let i = 0; i < R.smp.length - 1; i++) { const a = R.smp[i], b = R.smp[i + 1]; addBand(a.x, a.z, b.x, b.z, Math.max(a.w ?? R.width, b.w ?? R.width) / 2); }
  // stalpii de iluminat ai nodului (motorway.js, la 1,7 m de marginea lui 104) care cad pe benzile / bretelele noi:
  // ii mutam in spatele bordurii exterioare (1,7 m de margine, aceeasi cota); daca nici acolo nu e loc, ii scoatem
  const lampsMoved = { moved: 0, removed: 0 };
  {
    const poles = motorway.group?.getObjectByName('iluminat-nod'), heads = motorway.group?.getObjectByName('iluminat-led');
    const CLR = 1.7;
    const dAdj = (x, z, id) => { let b = 1e9; for (const o of obstacles) if (o.id === id) b = Math.min(b, segDist(x, z, [o.ax, o.az], [o.bx, o.bz])); return b; };
    const dMw = (x, z) => { let b = 1e9; for (const o of obstacles) if (o.id[0] === 'w' && Math.abs(o.ax - x) < 60 && Math.abs(o.az - z) < 60) b = Math.min(b, segDist(x, z, [o.ax, o.az], [o.bx, o.bz]) - o.hw); return b; };
    const d104 = (x, z) => { let b = 1e9; for (let j = 0; j < W.pts.length - 1; j++) b = Math.min(b, segDist(x, z, W.pts[j], W.pts[j + 1])); return b; };
    const nearest = (x, z) => { // cea mai apropiata axa de drum nou: distanta, semilatimea, normala spre punct, cota
      let best = null;
      for (const R of roads) for (let i = 0; i < R.smp.length - 1; i++) {
        const a = R.smp[i], b = R.smp[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), px = a.x + dx * t, pz = a.z + dz * t;
        const d = Math.hypot(x - px, z - pz), hw = Math.max(a.w ?? R.width, b.w ?? R.width) / 2;
        if (!best || d - hw < best.d - best.hw) {
          const ln = Math.hypot(dx, dz) || 1;
          let sd = Math.sign((x - px) * -dz + (z - pz) * dx) || 1; // dreapta/stanga axei
          if (R.adj) sd = dAdj(px - dz / ln, pz + dx / ln, R.adj) > dAdj(px + dz / ln, pz - dx / ln, R.adj) ? 1 : -1; // benzile paralele: spre exterior, departe de calea lor
          best = { d, hw, nx: (-dz / ln) * sd, nz: (dx / ln) * sd, px, pz, y: a.y + (b.y - a.y) * t };
        }
      }
      return best;
    };
    if (poles && heads) {
      const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      for (let i = 0; i < poles.count; i++) {
        poles.getMatrixAt(i, m); m.decompose(pos, q, sc);
        let n = nearest(pos.x, pos.z);
        if (!n || n.d >= n.hw + CLR) continue;
        let x = n.px + n.nx * (n.hw + CLR + 0.3), z = n.pz + n.nz * (n.hw + CLR + 0.3), ok = false;
        for (let k = 0; k < 4; k++) { const n2 = nearest(x, z); if (n2.d >= n2.hw + CLR) { ok = true; break; } x = n2.px + n2.nx * (n2.hw + CLR + 0.3); z = n2.pz + n2.nz * (n2.hw + CLR + 0.3); }
        // langa 104 (fata de noua banda, stalpul ramane si in afara lui 104, care e chiar in stanga benzii)
        if (ok && (d104(x, z) < W.width / 2 + CLR || dMw(x, z) < CLR)) ok = false;
        if (!ok) { // scoatem instanta (ultima ia locul ei)
          const last = poles.count - 1;
          poles.getMatrixAt(last, m); poles.setMatrixAt(i, m); heads.setMatrixAt(i, m);
          poles.count = heads.count = last; i--; lampsMoved.removed++; continue;
        }
        m.compose(pos.set(x, n.y, z), q, sc); poles.setMatrixAt(i, m); heads.setMatrixAt(i, m); lampsMoved.moved++;
      }
      poles.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    }
  }
  const offAsphalt = (x, z) => {
    let best = Infinity;
    for (const s of bgrid.get(Math.floor(x / BC) + ',' + Math.floor(z / BC)) || []) {
      best = Math.min(best, segDist(x, z, [s.ax, s.az], [s.bx, s.bz]) - s.hw);
      if (best <= 0) return 0;
    }
    return best;
  };
  const LANE = (u) => { const w = NW[u]; if (NI[u] === -2) return 0; if (NI[u] < 0) return Math.max(1.6, (w.width || 6) / 4); return w.type === 'mw' ? 0.95 : w.type === 'link' || w.k0 === w.k1 ? 0 : w.width / 4; };
  // autocarul: caroseria (podea inalta, ferestre reale prin care se vad pasagerii asezati), 10 randuri x 4 scaune
  const SEAT_X = [-0.85, 0.85, -0.42, 0.42], SEAT_ROWS = 10, SEATS = SEAT_X.length * SEAT_ROWS, SEAT_Y = 1.6;
  const seatZ = (r) => -4.2 + r * 0.98;
  const coachGeo = (hex) => {
    const parts = [
      box(2.5, 1.45, 12.2, 0, 1.125, 0, 0xffffff), box(2.5, 0.55, 12.2, 0, 3.125, 0, 0xffffff),
      box(2.5, 1.0, 0.5, 0, 2.35, -5.85, 0xffffff), box(2.5, 1.0, 0.1, 0, 2.35, 6.05, 0xffffff),
      box(2.53, 0.4, 12.22, 0, 1.0, 0, hex), box(2.4, 1.2, 0.05, 0, 2.35, -6.11, 0x1e293b),
      box(2.0, 0.25, 0.05, 0, 3.15, -6.12, hex), ...wheelSet(0.5, 0.3, 1.05, [-4.1, 3.6, 4.9]),
    ];
    for (let r = 0; r < SEAT_ROWS; r++) for (const x of SEAT_X) parts.push(box(0.42, 0.8, 0.1, x, SEAT_Y + 0.42, seatZ(r) + 0.3, 0x1e3a8a));
    return merge(parts);
  };
  const glassGeo = box(2.52, 0.98, 11.6, 0, 2.35, 0.2, 0xffffff);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, transparent: true, opacity: 0.42, roughness: 0.08, metalness: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const cMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
  // polilinie [x,y,z] cu lungimi cumulate + verificari
  function track(pts, nSkip) {
    const S = [0];
    for (let k = 1; k < pts.length; k++) S.push(S[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]));
    let jump = 0, off = 0, offN = 0, nS = 0;
    for (let k = 1; k < pts.length; k++) jump = Math.max(jump, Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]));
    for (let k = 1; k < pts.length; k++) {
      if (k <= nSkip.a || k > pts.length - 1 - nSkip.b) continue; // peronul (pe platforma hub-ului)
      const [x0, , z0] = pts[k - 1], [x1, , z1] = pts[k], m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
      for (let j = 0; j < m; j++) { const e = offAsphalt(x0 + (x1 - x0) * j / m, z0 + (z1 - z0) * j / m); nS++; if (e > 0.05) { offN++; off = Math.max(off, e); } }
    }
    return { pts, S, len: S[S.length - 1], jump, off, offN, samples: nS };
  }
  const pathPts = (Pth, push) => Pth.forEach((u, k) => {
    const a = Pth[Math.max(0, k - 1)], b = Pth[Math.min(Pth.length - 1, k + 1)];
    const tx = NX[b] - NX[a], tz = NZ[b] - NZ[a], tl = Math.hypot(tx, tz) || 1, l = LANE(u);
    push(NX[u] - tz / tl * l, NY[u], NZ[u] + tx / tl * l);
  });
  const chainOf = (Pth) => { const ids = []; for (const u of Pth) { const w = NW[u], id = NI[u] === -1 ? 'oras ' + (w.ref || w.name || w.id) : String(w.id); if (ids[ids.length - 1] !== id) ids.push(id); } return ids; };
  const lines = [];
  COACH_DEST.forEach((d, i) => {
    if (!goal[d.code]) return;
    const uBay = -40 + i * 24 + 1;
    // ---- dus: peron -> racord -> colector -> bretea de intrare -> banda de accelerare -> 104 -> ... -> autostrada ----
    const ro = routeOut(d.code);
    let out = null;
    if (ro) {
      const pts = [];
      const push = (x, y, z) => { const p = pts[pts.length - 1]; if (!p || Math.hypot(p[0] - x, p[2] - z) > 0.5) pts.push([x, y, z]); };
      for (let u = uBay; u > -58; u -= 3) { const w = hub.toWorld(u, yB, STUB_V + 2); push(w.x, w.y, w.z); }
      const nPlaza = pts.length;
      if (ro.ias) { // peste colector, pe breteaua noua (pod peste A8), banda de accelerare pe A8 Est
        for (let u = -58; u > COL_U - COL_W / 2; u -= 3) { const w = hub.toWorld(u, yB, STUB_V + 2); push(w.x, w.y, w.z); }
        for (const p of iasRamp) push(p.x, p.y, p.z);
        for (const p of accel122) push(...P(p, p.lane));
      } else {
        for (let u = -58; u > COL_U + 2; u -= 3) { const w = hub.toWorld(u, yB, STUB_V + 2); push(w.x, w.y, w.z); }
        for (let k = iStub + 1; k < col.length; k++) push(...P(col[k], 1.75));
        for (const p of onRamp) push(p.x, p.y, p.z);
        for (const p of accel) push(...P(p, p.lane));
      }
      const nHub = pts.length;
      pathPts(ro.path, push);
      const T = track(pts, { a: nPlaza, b: 0 });
      let sHub = 0; for (let k = 1; k < nHub; k++) sHub += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]);
      out = { ...T, sHub, chain: [ro.ias ? 'bretea hub-A8 Est' : 'bretea hub-104', ...chainOf(ro.path)], via: ro.last.ref, gap: ro.gap, ias: ro.ias };
    }
    // ---- intors: autostrada -> ... -> 104 -> banda de decelerare -> bretea de iesire -> colector -> racord -> peron ----
    const ri = routeIn(d.code);
    let inn = null;
    if (ri) {
      const pts = [];
      const push = (x, y, z) => { const p = pts[pts.length - 1]; if (!p || Math.hypot(p[0] - x, p[2] - z) > 0.5) pts.push([x, y, z]); };
      pathPts(ri.path, push);
      const nMw = pts.length;
      if (ri.ret) { // banda de decelerare pe A8 Est, bucla, pod peste A8, colector-distribuitor, breteaua de iesire 104
        for (const p of decel122) push(...P(p, p.lane));
        for (const p of retRamp) push(p.x, p.y, p.z);
        for (let k = kJ + 1; k < iStub; k++) push(...P(col[k], 1.75));
      } else {
        for (const p of decel) push(...P(p, p.lane));
        for (const p of offRamp) push(p.x, p.y, p.z);
        for (let k = 0; k < iStub; k++) push(...P(col[k], 1.75));
      }
      for (let u = COL_U + 3; u < -58; u += 3) { const w = hub.toWorld(u, yB, STUB_V - 2); push(w.x, w.y, w.z); }
      const nStub = pts.length;
      for (let u = -58; u <= uBay; u += 3) { const w = hub.toWorld(u, yB, STUB_V - 2); push(w.x, w.y, w.z); }
      const T = track(pts, { a: 0, b: pts.length - nStub });
      let sMw = 0; for (let k = 1; k < nMw; k++) sMw += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]);
      inn = { ...T, sMw, chain: [...chainOf(ri.path), ri.ret ? 'bretea A8 Est-hub' : 'bretea 104-hub'], gap: ri.gap, ret: ri.ret };
    }
    if (!out && !inn) return;
    const mesh = new THREE.InstancedMesh(coachGeo(d.hex), cMat, 2);
    mesh.name = 'autocar-' + d.code; mesh.castShadow = true; mesh.frustumCulled = false;
    const glass = new THREE.InstancedMesh(glassGeo, glassMat, 2);
    glass.name = 'autocar-geamuri-' + d.code; glass.frustumCulled = false; glass.renderOrder = 2;
    group.add(mesh, glass);
    // compatibilitate (pts / S / len = cursa de dus)
    const base = out || inn;
    lines.push({ d, qi: i, mesh, glass, out, inn, pts: base.pts, S: base.S, len: base.len, reached: !!out, back: inn ? { len: inn.len, gap: inn.gap } : null, chain: out?.chain || [], via: out?.via, jump: Math.max(out?.jump || 0, inn?.jump || 0), gap: Math.max(out?.gap || 0, inn?.gap || 0), off: Math.max(out?.off || 0, inn?.off || 0), offN: (out?.offN || 0) + (inn?.offN || 0), samples: (out?.samples || 0) + (inn?.samples || 0), exit: 'bretea intrare hub -> 104', partial: false });
  });
  const pAt = (L, s, o) => {
    s = Math.min(Math.max(s, 0), L.len);
    let lo = 0, hi = L.S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.S[m] <= s) lo = m; else hi = m; }
    const f = L.S[hi] > L.S[lo] ? (s - L.S[lo]) / (L.S[hi] - L.S[lo]) : 0;
    const A = L.pts[lo], B = L.pts[hi];
    return o.set(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f);
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  // ciclu: 60 s la peron, dus (~12 m/s pe drumurile hub-ului, ~24 m/s pe bretele / autostrada), 30 s „la aeroport”
  // (ascuns), intors (24 m/s, apoi 12 m/s de la banda de decelerare), oprire la peron
  const WAIT = 60, AWAY = 30;
  const tOut = (T) => (T ? T.sHub / 12 + (T.len - T.sHub) / 24 : 0);
  const tIn = (T) => (T ? T.sMw / 24 + (T.len - T.sMw) / 12 : 0);
  function put(L, k, T, s) {
    pAt(T, s + 4.9, a); pAt(T, s - 4.9, b);
    p.addVectors(a, b).multiplyScalar(0.5);
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    e.set(Math.atan2(dy, Math.hypot(dx, dz) || 1), Math.atan2(-dx, -dz), 0);
    q.setFromEuler(e);
    m4.compose(p, q, one);
    L.mesh.setMatrixAt(k, m4);
    return true;
  }
  function place(L, k, tt) {
    const O = L.out, I = L.inn;
    if (tt < WAIT) return O ? put(L, k, O, 0) : I ? put(L, k, I, I.len) : false;
    tt -= WAIT;
    if (O) { const to = tOut(O); if (tt < to) { const s = tt * 12 < O.sHub ? tt * 12 : O.sHub + (tt - O.sHub / 12) * 24; return put(L, k, O, s); } tt -= to; }
    if (tt < AWAY) return false;
    tt -= AWAY;
    if (I) {
      const ti = tIn(I);
      if (tt < ti) { const s = tt * 24 < I.sMw ? tt * 24 : I.sMw + (tt - I.sMw / 24) * 12; return put(L, k, I, s); }
      if (tt < ti + 5) return put(L, k, I, I.len); // sosit la peron: coboara pasagerii
    }
    return false;
  }
  // faza unui autocar: 0 = la peron (imbarcare), 1 = dus, 2 = ascuns („la aeroport”), 3 = intors, 4 = sosit la peron
  function phaseOf(L, tt) {
    if (tt < WAIT) return L.out || L.inn ? 0 : 2;
    tt -= WAIT;
    if (L.out) { const to = tOut(L.out); if (tt < to) return 1; tt -= to; }
    if (tt < AWAY) return 2;
    tt -= AWAY;
    if (L.inn) { const ti = tIn(L.inn); if (tt < ti) return 3; if (tt < ti + 5) return 4; }
    return 2;
  }
  for (const L of lines) L.cycle = WAIT + tOut(L.out) + AWAY + tIn(L.inn) + 5;

  // ---------------- calatori (TO-DO 7): cozi la peroanele autocarelor, imbarcare, pasageri in autocare ----------------
  // Pasagerii din autocare: un singur InstancedMesh (toate autocarele), matricile = matricea autocarului × locul pe scaun,
  // rescrise in fiecare cadru fara alocari. Cozile / pietonii folosesc ctx.people (epoca „future” => ascunsi in „Azi”).
  const NCO = lines.length * 2;
  const paxGeo = merge([
    box(0.4, 0.15, 0.42, 0, 0.07, -0.16, 0xffffff), box(0.4, 0.56, 0.24, 0, 0.36, 0.06, 0xffffff),
    box(0.1, 0.36, 0.1, -0.24, 0.42, -0.02, 0xffffff), box(0.1, 0.36, 0.1, 0.24, 0.42, -0.02, 0xffffff),
    tint(new THREE.SphereGeometry(0.11, 8, 6).scale(1, 1.12, 1).translate(0, 0.77, 0.02), 0xc8906c),
    tint(new THREE.SphereGeometry(0.115, 8, 4, 0, Math.PI * 2, 0, 1.3).translate(0, 0.785, 0.035), 0x2a1d14),
  ]);
  const paxMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  paxMat.name = 'pasageri-autocar';
  // culoarea instantei (tinuta) se aplica doar pe partile albe (haine), nu pe fata / par
  paxMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>',
      '#ifdef USE_COLOR\nvColor = vec3(1.0) * color;\n#ifdef USE_INSTANCING_COLOR\nif (color.g > 0.99 && color.r > 0.99) vColor *= instanceColor.rgb;\n#endif\n#endif');
  };
  paxMat.customProgramCacheKey = () => 'pasageri-autocar-v1';
  const pax = new THREE.InstancedMesh(paxGeo, paxMat, Math.max(1, NCO * SEATS));
  pax.name = 'pasageri-autocare'; pax.frustumCulled = false; pax.castShadow = false;
  pax.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  {
    const SHIRTS = [0x2f4b7c, 0xb23a48, 0x3f7d5a, 0xe0a526, 0xd9d4c7, 0x5b5f97, 0x0f766e, 0x7c2d12, 0x334155];
    const c = new THREE.Color();
    for (let i = 0; i < pax.count; i++) { pax.setMatrixAt(i, ZERO); pax.setColorAt(i, c.setHex(SHIRTS[(i * 7 + (i >> 3)) % SHIRTS.length])); }
  }
  group.add(pax);
  // locurile: intai la geam (se vad din afara), apoi pe culoar; ordinea randurilor amestecata
  const seatM = [];
  for (let r = 0; r < SEAT_ROWS; r++) for (const x of SEAT_X) seatM.push(new THREE.Matrix4().makeTranslation(x + ((r * 13 + seatM.length) % 5 - 2) * 0.01, SEAT_Y, seatZ(r)));
  seatM.sort((A, B) => (Math.abs(A.elements[12]) > 0.6 ? 0 : 1) - (Math.abs(B.elements[12]) > 0.6 ? 0 : 1) || ((A.elements[14] * 7.3) % 3) - ((B.elements[14] * 7.3) % 3));
  let seedK = 9137;
  const rnd = () => { seedK = (seedK * 16807) % 2147483647; return (seedK - 1) / 2147483646; };
  const coaches = [];
  lines.forEach((L, li) => { L.coaches = [0, 1].map((k) => { const C = { L, li, k, base: (li * 2 + k) * SEATS, onboard: 0, ph: -1, nextBoard: 0, visible: false, boarded: 0, unloaded: 0 }; coaches.push(C); return C; }); });

  // ---- trasee pietonale (sistem local u, y, v al hub-ului) ----
  const LB = hub.levelB, LBP = LB + 0.255, LBL = LB + 0.06, yP = hub.walkStart.position.y - 1, bayV = 66;
  const Wp = (u, y, v) => { const p = hub.toWorld(u, y, v); return [p.x, p.y, p.z]; };
  // peronul T1 (latura holului) -> usa de est a holului -> hol -> usa de nord -> peste spatiul verde -> piata autocarelor
  const TRUNK = [[11.5, yP, 4.6], [11.5, LB, 5.8], [13, LB, 10], [16.5, LB, 13.5], [16.5, LB, 18], [15, LB, 27], [15, LB, 33], [12.6, LB, 44], [13, LB, 47.2],
    [11.2, LB, 48.2], [11.2, LB, 51.7], [11.2, LB + 0.3, 52.3], [11.2, LB + 0.3, 55.7], [11.2, LB, 56.3], [11.2, LB, 58.5]];
  const HALL_I = 4; // TRUNK[4] = in hol, sub ecranul de plecari
  const QN = 12;
  const queues = COACH_DEST.map((d, i) => {
    const ub = -40 + i * 24;
    const slot = (j) => [ub - 6.0 + j * 0.85, LBP, 65.2];
    // intrarea pe peron (capatul de vest, pe langa stalpul copertinei) si usa autocarului (fata spre peron)
    const access = [[ub - 8.6, LB, 59.5], [ub - 8.6, LB, 62.6], [ub - 8.6, LBP, 63.4], [ub - 8.6, LBP, 64.5]];
    return { i, ub, slot, access, count: 0, pending: 0, slots: [], lines: lines.filter((L) => L.qi === i) };
  }).filter((Q) => Q.lines.length);
  const syncQ = (Q) => { for (let j = 0; j < Q.slots.length; j++) Q.slots[j].setVisible(j < Q.count); };
  const doorOut = (Q) => [Q.ub - 6.7, LBL, 76.3];   // autocarul de plecare (v 78, usa pe dreapta = spre peron)
  const doorIn = (Q) => [Q.ub - 6.7, LBL, 72.4];    // autocarul sosit (v 74, usa din spate spre peron)
  const toQueue = (Q, j) => [...Q.access, Q.slot(j)];
  const fromT1 = (uT) => [[uT, yP, 3.0], ...TRUNK];
  const world = (pts) => pts.map((p) => Wp(p[0], p[1], p[2]));
  const MAXW = 22;
  let activeW = 0;
  const canWalk = () => activeW < MAXW && (ctx.people?.banks?.future?.freeWalk?.length ?? 0) > 3;
  function walk(path, speed, done) {
    if (!ctx.people || !canWalk()) { done(); return false; }
    activeW++;
    let h = null, ended = false;
    h = ctx.people.addWalker({ path: world(path), speed, loop: false, era: 'future', seed: Math.floor(rnd() * 1e6), luggage: 0.7,
      onEnd: () => { ended = true; activeW--; h?.remove(); done(); } });
    if (!h) { activeW--; done(); return false; }
    if (ended) h.remove();
    return true;
  }
  // planificator de evenimente (doar la evenimente, nu in fiecare cadru)
  const sched = [];
  let now = 0;
  const later = (dt, f) => sched.push({ t: now + dt, f });
  const stats = { boarded: 0, unloaded: 0, arrivedT1: 0, fromHall: 0, tramEvents: 0 };
  function joinQueue(Q, path0) {
    if (Q.count + Q.pending >= QN) return false;
    const j = Q.count + Q.pending;
    Q.pending++;
    walk([...path0, ...toQueue(Q, j)], 1.25 + rnd() * 0.25, () => { Q.pending--; Q.count = Math.min(QN, Q.count + 1); syncQ(Q); });
    return true;
  }
  const emptiest = () => { let best = null; for (const Q of queues) if (!best || Q.count + Q.pending < best.count + best.pending) best = Q; return best; };
  function boardOne(C) {
    const Q = queues.find((q) => q.i === C.L.qi);
    if (!Q || Q.count <= 0) return;
    Q.count--; syncQ(Q);
    const s0 = Q.slot(0);
    walk([s0, [Q.ub - 6.2, LBP, 66.4], [Q.ub - 6.4, LBL, 67.4], doorOut(Q)], 1.3, () => { C.onboard = Math.min(SEATS, C.onboard + 1); C.boarded++; stats.boarded++; });
  }
  function unload(C) {
    const Q = queues.find((q) => q.i === C.L.qi);
    const n = C.onboard;
    if (!Q || !n) return;
    for (let j = 0; j < n; j++) {
      later(0.3 + j * 0.8, () => {
        if (C.onboard > 0) C.onboard--;
        C.unloaded++; stats.unloaded++;
        const toT1 = rnd() < 0.5;
        const back = TRUNK.slice(toT1 ? 0 : HALL_I).reverse();
        const path = [doorIn(Q), [Q.ub - 6.4, LBL, 67.4], [Q.ub - 6.2, LBP, 66.4], ...Q.access.slice().reverse(), ...back];
        if (toT1) path.push([7.5 + rnd() * 11, yP, 2.6 + rnd() * 0.8]);
        else path.push([13 + rnd() * 4, LB, 19.5 + rnd() * 2]);
        walk(path, 1.3 + rnd() * 0.2, () => {});
      });
    }
  }
  function coachTick(C, ph, tt) {
    if (ph !== C.ph) {
      if (ph === 3) C.onboard = 8 + Math.floor(rnd() * 11);                 // pleaca de la aeroport cu pasageri
      else if ((ph === 4 || ph === 0) && C.ph === 3) unload(C);              // a sosit la peron
      else if (ph === 2 || (ph === 0 && C.ph !== 4)) C.onboard = 0;          // la aeroport / reapare gol
      if (ph === 0) C.nextBoard = 0;
      C.ph = ph;
    }
    if (ph === 0 && tt > 4 && tt < WAIT - 14 && tt >= C.nextBoard) { C.nextBoard = tt + 1.1; boardOne(C); }
  }
  const _cm = new THREE.Matrix4(), _pm = new THREE.Matrix4();
  let tg = 0, hallT = 0;
  ctx.addUpdate((dt) => {
    tg += dt; now += dt;
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      for (let k = 0; k < 2; k++) {
        const tt = (tg + k * L.cycle / 2 + li * 17) % L.cycle;
        const C = L.coaches[k];
        C.visible = place(L, k, tt);
        if (C.visible) L.mesh.getMatrixAt(k, _cm); else { _cm.copy(ZERO); L.mesh.setMatrixAt(k, ZERO); }
        L.glass.setMatrixAt(k, _cm);
        coachTick(C, phaseOf(L, tt), tt);
        for (let j = 0; j < SEATS; j++) {
          if (C.visible && j < C.onboard) { _pm.multiplyMatrices(_cm, seatM[j]); pax.setMatrixAt(C.base + j, _pm); }
          else pax.setMatrixAt(C.base + j, ZERO);
        }
      }
      L.mesh.instanceMatrix.needsUpdate = true;
      L.glass.instanceMatrix.needsUpdate = true;
    }
    pax.instanceMatrix.needsUpdate = true;
    for (let i = sched.length - 1; i >= 0; i--) if (now >= sched[i].t) { const f = sched[i].f; sched.splice(i, 1); f(); }
    // din hol pleaca din cand in cand cate un calator spre coada cea mai scurta
    hallT += dt;
    if (hallT > 7 && queues.length) {
      hallT = 0;
      const Q = emptiest();
      if (Q && Q.count + Q.pending < 7 && joinQueue(Q, TRUNK.slice(HALL_I))) stats.fromHall++;
    }
  });

  // ---- populare (dupa constructia transportului: flota, mobilierul statiei T1 de la hub) ----
  ctx.people?.defer(() => {
    const P = ctx.people, tr = ctx.transit, route = tr?.route;
    const fwd = new THREE.Vector3(), yawOf = (du, dv) => { const p = hub.toWorld(du, 0, dv).sub(hub.toWorld(0, 0, 0)); return Math.atan2(p.x, p.z); };
    const pt = (u, y, v, yaw) => { const p = hub.toWorld(u, y, v); return { x: p.x, y: p.y, z: p.z, yaw }; };
    const faceMinusV = yawOf(0, -1), facePlusV = yawOf(0, 1), faceMinusU = yawOf(-1, 0);
    // cozile de la peroanele autocarelor (6–12 persoane, multe bagaje), cu fata spre capul cozii / spre banda autocarelor
    for (const Q of queues) {
      for (let j = 0; j < QN; j++) {
        const s = Q.slot(j), yaw = j === 0 ? facePlusV : faceMinusU + (rnd() - 0.5) * 0.5;
        Q.slots.push(P.addGroup({ points: [pt(s[0], s[1], s[2] + (rnd() - 0.5) * 0.3, yaw)], kind: 'stand', era: 'future', seed: 700 + Q.i * 31 + j, luggage: 0.75, children: 0.05, phone: 0.3 }));
      }
      Q.count = 6 + Math.floor(rnd() * 7);
      syncQ(Q);
    }
    // holul: banci (parter + etaj), automatele de bilete, ecranele de plecari
    const sit = [];
    for (let u = -30; u <= 20; u += 6) for (const o of [-1.05, 0, 1.05]) if (rnd() < 0.5) sit.push(pt(u + o, LB, 29.9, faceMinusV + (rnd() - 0.5) * 0.3));
    for (let u = -24; u <= 6; u += 6) for (const o of [-1.05, 0, 1.05]) if (rnd() < 0.4) sit.push(pt(u + o, LB + 5.2, 27.9, faceMinusV + (rnd() - 0.5) * 0.3));
    const hallSit = P.addGroup({ points: sit, kind: 'sit', era: 'future', seed: 811 });
    const stand = [[-9, 13.6], [7, 13.6], [11, 13.6], [7, 14.6]].map(([u, v]) => pt(u, LB, v, faceMinusV));
    const tgt = (u, v) => { const p = hub.toWorld(u, LB, v); return [p.x, p.z]; };
    const scatterLocal = (u0, u1, v0, v1, count, target, seed) => P.scatter({ polygon: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => tgt(u, v)), y: LB, count, target, seed, minDist: 0.9 });
    stand.push(...scatterLocal(-19.5, -14.5, 16.5, 19, 4, tgt(-17, 15), 821), ...scatterLocal(-1, 7, 41.2, 43.6, 5, tgt(3, 45.8), 822));
    const hallStand = P.addGroup({ points: stand, kind: 'stand', era: 'future', seed: 823, luggage: 0.4, phone: 0.3 });
    // peronul T1 al hub-ului (ambele laturi), cu fata spre linie, ocolind adapostul si mobilierul
    let t1 = [];
    const st = route?.stops?.[route.stops.length - 1];
    if (st) {
      const tg2 = new THREE.Vector3(), c = new THREE.Vector3();
      route.tangent(st.s, tg2); tg2.y = 0; tg2.normalize();
      const right = [-tg2.z, tg2.x];
      const avoid = (tr.stops?.props || []).filter((q) => q.stop === st.id).map((q) => ({ x: q.x, z: q.z, r: q.r + 0.45 }));
      for (const side of [-1, 1]) {
        route.offsetPoint(st.s, side * 3.325, c);
        const y = route.pos(st.s, fwd).y + 0.42;
        t1.push(P.populateStop({ center: [c.x, c.z], y, along: [tg2.x, tg2.z], length: 40, width: 3.75, toward: [-side * right[0], -side * right[1]], count: side < 0 ? 10 : 6, avoid, era: 'future', seed: 900 + side, clearAlong: 5.4 }));
      }
    }
    // pornire: cate un calator pe drum de la peronul T1 spre fiecare coada (traseele exista de la inceput => verificate de audit)
    for (const Q of queues) joinQueue(Q, fromT1(8 + Q.i * 3.5));
    // sosirea unui tramvai T1 la hub => 4–8 calatori pornesc spre cozile autocarelor
    const fleet = tr?.fleet;
    if (fleet?.onArrive && route) {
      const last = route.stops.length - 1;
      fleet.onArrive((v, idx) => {
        if (idx !== last) return;
        stats.tramEvents++;
        const n = 4 + Math.floor(rnd() * 5);
        for (let j = 0; j < n; j++) later(3 + j * 1.3, () => { const Q = emptiest(); if (Q && joinQueue(Q, fromT1(7.5 + rnd() * 11))) stats.arrivedT1++; });
      });
    }
    hubPeople.counts = { hallSeated: hallSit.count, hallStanding: hallStand.count, t1: t1.reduce((a, h) => a + h.count, 0) };
    console.info(`Hub: calatori – cozi ${queues.map((Q) => `${COACH_DEST[Q.i].code} ${Q.count}`).join(', ')}; hol ${hallSit.count} asezati + ${hallStand.count} in picioare; peron T1 ${hubPeople.counts.t1}; ${SEATS} locuri / autocar`);
  });
  const hubPeople = { queues, coaches, stats, pax, seats: SEATS, paths: { trunk: TRUNK, fromT1, toQueue, doorOut, doorIn }, get active() { return activeW; }, counts: null };

  const f2 = (x) => (x * 100).toFixed(1);
  const uvOf = (s) => W2L(at104(s).x, at104(s).z).map((x) => Math.round(x)).join(', ');
  const km = (T) => (T ? (T.len / 1000).toFixed(2) + ' km' : 'NU');
  console.info(`Hub: bretele directe pe 104 (cale ${W.id}); colector ${Math.round(col[col.length - 1].s)} m (u ${COL_U}, v ${V_TOP}…${V_BOT}), panta max ${(maxGradeOf(col) * 100).toFixed(2)} %; `
    + `iesire: pana+paralela s ${Math.round(sOff0)}…${Math.round(sDiv)} (uv ${uvOf(sOff0)} -> ${uvOf(sDiv)}), curba ${Math.round(cOff.len)} m R min ${cOff.r.toFixed(0)} m, panta max ${(maxGradeOf(offRamp) * 100).toFixed(2)} %; `
    + `intrare: curba ${Math.round(cOn.len)} m R min ${cOn.r.toFixed(0)} m, panta max ${(maxGradeOf(onRamp) * 100).toFixed(2)} %, paralela+pana s ${Math.round(sAcc0)}…${Math.round(sAcc2)} (uv ${uvOf(sAcc0)} -> ${uvOf(sAcc2)}); `
    + (iasRamp ? `bretea hub -> A8 Est ${Math.round(lenOf(iasRamp))} m R min ${iasRamp.r.toFixed(0)} m panta max ${(maxGradeOf(iasRamp) * 100).toFixed(2)} % (pod max ${Math.max(...iasRamp.map((p) => p.y - p.t)).toFixed(1)} m); intoarcere A8 Est -> hub ${Math.round(lenOf(retRamp))} m R min ${retRamp.r.toFixed(0)} m panta max ${(maxGradeOf(retRamp) * 100).toFixed(2)} % (pod max ${Math.max(...retRamp.map((p) => p.y - p.t)).toFixed(1)} m), pile ${nPiers}; ` : '')
    + `stalpi iluminat mutati ${lampsMoved.moved}, scosi ${lampsMoved.removed}; Δh: ${Object.entries(joints).map(([k, v]) => `${k} ${f2(v)} cm`).join(', ')}; graf: ${repaired} legaturi reparate (< ${GAP} m); `
    + `autocare: ${lines.map((L) => `${L.d.code} dus ${km(L.out)} -> ${L.out?.via || '?'} (lant ${L.out?.chain.slice(0, 14).join('>')}, ${L.out?.offN}/${L.out?.samples} in afara asfaltului, max ${L.out?.off.toFixed(2)} m, salt ${L.out?.jump.toFixed(1)} m, gol ${L.out?.gap.toFixed(1)} m) · intors ${km(L.inn)} (lant ${L.inn?.chain.slice(0, 14).join('>')}, ${L.inn?.offN}/${L.inn?.samples} in afara asfaltului, max ${L.inn?.off.toFixed(2)} m, salt ${L.inn?.jump.toFixed(1)} m, gol ${L.inn?.gap.toFixed(1)} m)`).join(' | ')}`);
  return {
    group, center: new THREE.Vector3(col[iStub].x, yB, col[iStub].z), access: col, roads, lines, joints, repaired, way104: W.id, people: hubPeople,
    arms: [
      { kind: 'bretea iesire 104 -> hub', smp: offRamp, width: RAMP_W, joint: { x: offRamp[0].x, y: offRamp[0].y, z: offRamp[0].z } },
      { kind: 'bretea intrare hub -> 104', smp: onRamp, width: RAMP_W, joint: { x: onRamp[onRamp.length - 1].x, y: onRamp[onRamp.length - 1].y, z: onRamp[onRamp.length - 1].z } },
      ...(iasRamp ? [
        { kind: 'bretea hub -> A8 Est', smp: iasRamp, width: RAMP_W, joint: { x: iasRamp[iasRamp.length - 1].x, y: iasRamp[iasRamp.length - 1].y, z: iasRamp[iasRamp.length - 1].z } },
        { kind: 'bretea A8 Est -> hub', smp: retRamp, width: RAMP_W, joint: { x: retRamp[0].x, y: retRamp[0].y, z: retRamp[0].z } },
      ] : []),
    ],
    newRamps: iasRamp ? { ias: { len: lenOf(iasRamp), r: iasRamp.r, grade: maxGradeOf(iasRamp), top: Math.max(...iasRamp.map((p) => p.y - p.t)) }, ret: { len: lenOf(retRamp), r: retRamp.r, grade: maxGradeOf(retRamp), top: Math.max(...retRamp.map((p) => p.y - p.t)) }, piers: nPiers, prIas, prRet } : null,
  };
}
