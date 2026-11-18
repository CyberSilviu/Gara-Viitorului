import * as THREE from 'three';
import { ROUTE } from './route-data.js';
import { smooth } from './util3d.js';
import { analyseRoads } from './road-clear.js';

// Traseul T1: polilinie in plan (din OSM, vezi scripts/build-route.mjs) + profil in lung (relief SRTM,
// panta limitata la 3,5 %, netezit, rambleu / viaduct unde e nevoie, pod peste parau).
// Esantionare uniforma la `step` metri => cautare O(1) dupa distanta s.

export const TRACK_HALF = 1.7;     // jumatate din entraxul liniilor duble (3,4 m)
export const TERM_STUB = 95;       // lungimea capatului cu linie simpla la terminale (s de la capete)
// la gara, linia ramane simpla pe toata lungimea peronului 1 (pana la s ~ 110), ca linia dubla sa nu intre in peron
export const TERM_STUB_GARA = 180;
export const DECK_DEPTH = 1.6;     // grosimea tablierului sub platforma (fata laterala a podului in track.js)
export const ROAD_CLEARANCE = 5.0; // gabaritul minim sub tablier, peste asfalt
const VIADUCT_JOIN = 300;          // traversari mai apropiate de atat => un singur viaduct continuu
const RAIL_TOP = 0.16;             // ciuperca sinei peste platforma

export function createRoute(ctx) {
  const H = ctx.terrain.heightAt;
  const step = ROUTE.step;
  const P = ROUTE.pts;
  const N = P.length;
  const length = (N - 1) * step; // reesantionat uniform in script (ultimul segment poate fi mai scurt)
  // lungimi reale cumulate
  const S = new Float32Array(N);
  for (let i = 1; i < N; i++) S[i] = S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const L = S[N - 1];

  // ---- profil in lung ----
  const t = new Float32Array(N);
  for (let i = 0; i < N; i++) t[i] = H(P[i][0], P[i][1]);
  const avg = (arr, w) => {
    const out = new Float32Array(arr.length);
    const k = Math.round(w / step);
    for (let i = 0; i < arr.length; i++) {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(arr.length - 1, i + k); j++) { s += arr[j]; n++; }
      out[i] = s / n;
    }
    return out;
  };
  let y = avg(t, 40);
  // drumurile / CF ale orasului peste care trece platforma (vezi road-clear.js): cota minima a platformei
  const rampAt = (s) => smooth(TERM_STUB_GARA - 60, TERM_STUB_GARA, s) * smooth(TERM_STUB - 60, TERM_STUB, L - s);
  // podul rutier DN28A (Vatra) trece PESTE linia T1 (puntea ~7 m peste sine e a modulului orasului):
  // drumul de deasupra nu ridica platforma T1 => o scoatem din analiza pe +-60 m in jurul podului
  const osm0 = ctx.city?.osm;
  let osmClear = osm0;
  if (osm0 && ROUTE.dn28a != null) {
    const [bi] = [Math.min(N - 1, Math.round(ROUTE.dn28a / step))];
    const bx = P[bi][0], bz = P[bi][1];
    osmClear = { ...osm0, roads: (osm0.roads || []).filter((w) => !(w.p || []).some(([x, z]) => Math.hypot(x - bx, z - bz) < 60) || !/DN28A/.test(w.ref || '')) };
  }
  const roads = analyseRoads(P, S, osmClear, H, (s) => TRACK_HALF * rampAt(s) + 1.97, ctx.city?.surfaceInfo || {});
  // minim: deasupra terenului; la parau: pod cu gabarit
  const minY = new Float32Array(N);
  const streams = ROUTE.streams || [];
  for (let i = 0; i < N; i++) {
    let m = t[i] + 0.25;
    for (const st of streams) {
      const d = Math.abs(S[i] - st.s);
      if (d < 14) m = Math.max(m, t[i] + 3.2);
    }
    minY[i] = m;
    y[i] = Math.max(y[i], m);
  }
  const G = 0.035;
  const grade = (arr) => {
    for (let i = 1; i < N; i++) arr[i] = Math.max(arr[i], arr[i - 1] - G * (S[i] - S[i - 1]));
    for (let i = N - 2; i >= 0; i--) arr[i] = Math.max(arr[i], arr[i + 1] - G * (S[i + 1] - S[i]));
  };
  // capete orizontale (peroanele terminalelor)
  const flatEnd = (i0, i1) => {
    let m = -Infinity;
    for (let i = i0; i <= i1; i++) m = Math.max(m, minY[i]);
    for (let i = i0; i <= i1; i++) y[i] = m;
  };
  const nEnd = Math.round(85 / step);
  flatEnd(0, nEnd);
  flatEnd(N - 1 - nEnd, N - 1);
  grade(y);
  y = avg(y, 24);
  for (let i = 0; i < N; i++) y[i] = Math.max(y[i], minY[i] - 0.1);
  flatEnd(0, nEnd);
  flatEnd(N - 1 - nEnd, N - 1);
  grade(y);
  y = avg(y, 6);
  grade(y);
  // garda fata de asfalt / CF, impusa la final (grade() doar ridica => rampe line de max 3,5 %,
  // iar peroanele terminalelor raman orizontale daca nu calca pe un drum)
  // (dilatat cu un esantion: marginea unei strazi cade oriunde intre doua esantioane de 4 m)
  const need = roads.need;
  for (let i = 0; i < N; i++) y[i] = Math.max(y[i], minY[i], need[i], need[Math.max(0, i - 1)], need[Math.min(N - 1, i + 1)]);
  grade(y);

  // ---- T1 × drumuri (TO-DO 9): TOATE traversarile sunt DENIVELATE (fara treceri la nivel / cale inglobata) ----
  // Fiecare loc unde platforma T1 taie sau calca un drum desenat de oras (inclusiv drumurile noi „in constructie”)
  // devine pod T1: tablierul (grosime DECK_DEPTH sub platforma) are gabarit >= ROAD_CLEARANCE peste asfaltul de
  // dedesubt pe toata latimea platformei (+-4 m in lungul liniei); rampele raman <= 3,5 % (grade() doar ridica).
  // Pilele nu se pun pe carosabil (track.js). Traversarile apropiate (< VIADUCT_JOIN m) => UN viaduct continuu.
  // Exceptie: podul rutier DN28A trece PESTE T1 (scos din analiza mai sus).
  const RH = ctx.city?.roadHeightAt;
  const roadY = (x, z, hint) => { const v = RH ? RH(x, z, hint) : null; return v == null ? NaN : v; };
  const yAt = (s) => { const [i, f] = idx(s); return y[i] + (y[i + 1] - y[i]) * f; };
  const edgeAt = (s) => TRACK_HALF * rampAt(s) + 1.97;
  // cota maxima a asfaltului de sub platforma (axa + margini) la esantionul i (NaN = nu e drum dedesubt)
  const roadUnder = (i) => {
    const A = P[Math.max(0, i - 1)], B = P[Math.min(N - 1, i + 1)];
    const tl = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, rx = -(B[1] - A[1]) / tl, rz = (B[0] - A[0]) / tl, e = edgeAt(S[i]);
    let m = NaN;
    for (const f of [-1, -0.5, 0, 0.5, 1]) { const v = roadY(P[i][0] + rx * e * f, P[i][1] + rz * e * f, t[i]); if (v === v && !(m >= v)) m = v; }
    return m;
  };
  const dnS = ROUTE.dn28a ?? -1e9;
  const nameAt = (x, z) => {
    let bd = Infinity, r = { n: '', ref: '', k: '' };
    for (const w of osm0?.roads || []) for (let j = 0; j < (w.p || []).length - 1; j++) {
      const a = w.p[j], b = w.p[j + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z);
      if (d < bd) { bd = d; r = { n: w.n || '', ref: w.ref || '', k: w.k }; }
    }
    return r;
  };
  const xing = roads.crossings.map((c) => ({ ...c }));
  // portiuni in care platforma calca pe asfalt in afara unei traversari (drum aproape paralel) => tot pod
  {
    const inX = (s) => xing.some((c) => s > c.s0 - 2 && s < c.s1 + 2);
    let cur = null;
    for (let i = 0; i <= N; i++) {
      const ru = i < N ? roadUnder(i) : NaN;
      const on = i < N && !inX(S[i]) && Math.abs(S[i] - dnS) > 60 && ru === ru;
      if (on && !cur) cur = { i0: i, i1: i };
      else if (on) cur.i1 = i;
      if (!on && cur) {
        const m = Math.round((cur.i0 + cur.i1) / 2), nm = nameAt(P[m][0], P[m][1]);
        // lipit de o traversare (ex. restul amprentei unui drum oblic) => o extindem pe aceea
        const adj = xing.find((c) => !c.paralel && S[cur.i0] - 10 < c.s1 && S[cur.i1] + 10 > c.s0);
        if (adj) { adj.s0 = Math.min(adj.s0, S[cur.i0] - 2); adj.s1 = Math.max(adj.s1, S[cur.i1] + 2); if (nm.n && !(adj.n || '').includes(nm.n)) adj.n = adj.n ? adj.n + ' + ' + nm.n : nm.n; cur = null; continue; }
        xing.push({ s: S[m], s0: S[cur.i0] - 2, s1: S[cur.i1] + 2, x: P[m][0], z: P[m][1], y: roadUnder(m), sin: 0, n: nm.n || nm.ref, ref: nm.ref, k: nm.k, paralel: true });
        cur = null;
      }
    }
  }
  xing.sort((a, b) => a.s - b.s);
  for (const c of xing) {
    const r = roadY(c.x, c.z, t[Math.min(N - 1, Math.round(c.s / step))]);
    c.road = r === r ? r : c.y;
    c.ang = Math.round((Math.asin(Math.min(1, c.sin)) * 180) / Math.PI);
    c.dhBefore = yAt(c.s) + RAIL_TOP - c.road;
    c.type = 'pod';
    for (let i = 0; i < N; i++) if (S[i] > c.s0 - 4 && S[i] < c.s1 + 4) {
      const ru = roadUnder(i);
      y[i] = Math.max(y[i], Math.max(c.road, ru === ru ? ru : -Infinity) + DECK_DEPTH + ROAD_CLEARANCE + 0.05);
    }
  }
  grade(y);
  // gabaritul obtinut (minimul pe portiunea de drum de sub tablier)
  for (const c of xing) {
    let m = Infinity;
    for (let i = 0; i < N; i++) if (S[i] >= c.s0 - 1 && S[i] <= c.s1 + 1) { const ru = roadUnder(i); m = Math.min(m, y[i] - DECK_DEPTH - (ru === ru ? Math.max(ru, c.road) : c.road)); }
    c.clearance = m;
  }

  let maxGrade = 0;
  for (let i = 1; i < N; i++) maxGrade = Math.max(maxGrade, Math.abs(y[i] - y[i - 1]) / (S[i] - S[i - 1]));

  // structura: 0 = la sol, 1 = rambleu, 2 = viaduct / pod
  const kind = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const h = y[i] - t[i];
    let k = h > 4.5 ? 2 : h > 0.7 ? 1 : 0;
    for (const st of streams) if (Math.abs(S[i] - st.s) < 16) k = 2;
    kind[i] = k;
  }
  // pod peste fiecare drum (tablier + parapet pe toata zona, nicio bordura / taluz pe asfalt)
  for (const c of xing) for (let i = 0; i < N; i++) if (S[i] > c.s0 - 6 && S[i] < c.s1 + 6) kind[i] = 2;
  // traversari apropiate (ex. Prisacii – DJ208 – Varful Dealului): un singur viaduct continuu, fara rambleu intre ele
  const viaducts = [];
  for (const c of xing) {
    const v = viaducts[viaducts.length - 1];
    if (v && c.s0 - v.s1 < VIADUCT_JOIN) { v.s1 = Math.max(v.s1, c.s1); v.list.push(c); } else viaducts.push({ s0: c.s0, s1: c.s1, list: [c] });
  }
  for (const v of viaducts) {
    let ok = v.list.length > 1;
    for (let i = 0; i < N && ok; i++) if (S[i] > v.s0 && S[i] < v.s1 && y[i] - t[i] < 1.5) ok = false;
    if (ok) for (let i = 0; i < N; i++) if (S[i] > v.s0 - 6 && S[i] < v.s1 + 6) kind[i] = 2;
    v.continuous = ok;
  }
  // capetele viaductelor: prelungite cat timp platforma e la > 4,5 m (fara rambleu inalt lipit de culee)
  for (let i = 1; i < N; i++) if (kind[i] !== 2 && kind[i - 1] === 2 && y[i] - t[i] > 4.5) kind[i] = 2;
  for (let i = N - 2; i >= 0; i--) if (kind[i] !== 2 && kind[i + 1] === 2 && y[i] - t[i] > 4.5) kind[i] = 2;

  // tabel de control: s, drum, unghi, tratament, gabarit
  {
    const rows = xing.map((c) => ({
      s: c.s, label: ((c.ref ? c.ref + ' ' : '') + (c.n && c.n !== c.ref ? c.n : '')) || c.k, ang: c.paralel ? 'par' : c.ang + '°',
      tr: viaducts.some((v) => v.continuous && v.list.includes(c)) ? 'viaduct T1' : 'pod T1',
      cl: `gabarit ${c.clearance.toFixed(2)} m | șină–asfalt ${c.dhBefore >= 0 ? '+' : ''}${c.dhBefore.toFixed(2)} -> +${(yAt(c.s) + RAIL_TOP - c.road).toFixed(2)} m`,
    }));
    if (ROUTE.dn28a != null) {
      const p = P[Math.min(N - 1, Math.round(ROUTE.dn28a / step))], yr = yAt(ROUTE.dn28a) + RAIL_TOP, deck = roadY(p[0], p[1], yr + 8);
      rows.push({ s: ROUTE.dn28a, label: 'DN28A (pod rutier)', ang: '78°', tr: 'drum PESTE T1', cl: deck === deck && deck > yr + 2 ? `cale pod +${(deck - yr).toFixed(2)} m peste șină` : 'pod al orașului' });
    }
    rows.sort((a, b) => a.s - b.s);
    console.info(`T1 × drumuri (${rows.length}, toate denivelate; panta max ${(maxGrade * 100).toFixed(2)} %):\n` + rows.map((r) => `  s ${String(Math.round(r.s)).padStart(4)} | ${r.label.padEnd(30).slice(0, 30)} | ${String(r.ang).padStart(3)} | ${r.tr.padEnd(13)} | ${r.cl}`).join('\n'));
  }

  // ---- interogare dupa s ----
  function idx(s) {
    // S nu e perfect uniform (ultimul segment) -> cautare binara
    let lo = 0, hi = N - 1;
    if (s <= 0) return [0, 0];
    if (s >= L) return [N - 2, 1];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    return [lo, (s - S[lo]) / (S[lo + 1] - S[lo])];
  }
  function pos(s, out = new THREE.Vector3()) {
    const [i, f] = idx(s);
    const a = P[i], b = P[i + 1];
    return out.set(a[0] + (b[0] - a[0]) * f, y[i] + (y[i + 1] - y[i]) * f, a[1] + (b[1] - a[1]) * f);
  }
  function tangent(s, out = new THREE.Vector3()) {
    const d = 3;
    const a = pos(Math.max(0, s - d), _a), b = pos(Math.min(L, s + d), _b);
    return out.subVectors(b, a).normalize();
  }
  function heightAtS(s) { const [i, f] = idx(s); return y[i] + (y[i + 1] - y[i]) * f; }
  function terrainAtS(s) { const [i, f] = idx(s); return t[i] + (t[i + 1] - t[i]) * f; }
  function kindAt(s) { const [i, f] = idx(s); return kind[f < 0.5 ? i : i + 1]; }
  // platforma calca pe un drum al orasului? (cel mai apropiat esantion) / cota asfaltului de dedesubt (NaN = nu)
  function onRoadAt(s) { const [i, f] = idx(s); return roads.onRoad[f < 0.5 ? i : i + 1] === 1; }
  function roadSurfAt(s) {
    const [i, f] = idx(s);
    const a = roads.surf[i], b = roads.surf[i + 1];
    if (a === a && b === b) return a + (b - a) * f;
    return f < 0.5 ? (a === a ? a : b) : (b === b ? b : a);
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  // deplasarea laterala a liniei unui sens (0 la capete = linie simpla, +-1.7 pe linia dubla)
  function laneRamp(s) {
    return smooth(TERM_STUB_GARA - 60, TERM_STUB_GARA, s) * smooth(TERM_STUB - 60, TERM_STUB, L - s);
  }

  // punct cu deplasare laterala (dreapta = +) fata de axa; dreapta orizontala = (-tz, tx)
  const _t = new THREE.Vector3();
  function offsetPoint(s, lat, out = new THREE.Vector3()) {
    pos(s, out);
    tangent(s, _t);
    const l = Math.hypot(_t.x, _t.z) || 1;
    out.x += (-_t.z / l) * lat;
    out.z += (_t.x / l) * lat;
    return out;
  }

  // esantioane pentru geometrie: [{x,y,z,rx,rz,s,t(teren),k, road (calca pe drum), rs (cota asfaltului sau NaN)}]
  function samples(s0, s1, ds = 4, latFn = null) {
    const out = [];
    const n = Math.max(1, Math.ceil((s1 - s0) / ds));
    const p = new THREE.Vector3(), tg = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      pos(s, p); tangent(s, tg);
      const l = Math.hypot(tg.x, tg.z) || 1;
      const rx = -tg.z / l, rz = tg.x / l;
      const lat = latFn ? latFn(s) : 0;
      out.push({ x: p.x + rx * lat, y: p.y, z: p.z + rz * lat, rx, rz, s, t: terrainAtS(s), k: kindAt(s), road: onRoadAt(s), rs: roadSurfAt(s) });
    }
    return out;
  }

  const stops = ROUTE.stops.map((st) => ({ ...st }));
  // un peron (± 21 m + 3 m garda) nu acopera o traversare si nu sta pe viaduct (fara scari / lift): mutam statia
  // in lungul liniei (cel mult 60 m, respectiv 400 m daca era pe viaduct) pana unde peronul e liber si nu e pe pod
  const clearAt = (s) => !xing.some((c) => c.s1 > s - 24 && c.s0 < s + 24);
  const gradeAt = (s) => { for (let q = s - 24; q <= s + 24; q += 2) if (kindAt(q) === 2) return false; return true; };
  for (const st of stops) {
    if (st.term || (clearAt(st.s) && gradeAt(st.s))) continue;
    const far = gradeAt(st.s) ? 60 : 400;
    for (let d = 2; d <= far; d += 2) {
      const cand = [st.s + d, st.s - d].find((s) => s > 130 && s < L - 130 && clearAt(s) && gradeAt(s));
      if (cand !== undefined) { st.s0 = st.s; st.s = cand; break; }
    }
  }

  return {
    length: L, pts: P, S, y, terrain: t, kind, stops, maxGrade,
    pos, tangent, heightAtS, terrainAtS, kindAt, offsetPoint, samples, laneRamp, onRoadAt, roadSurfAt,
    climb: y[N - 1] - y[0],
    streams,
    corridor: ROUTE.corridor || [0, 0],   // [s0, s1] portiunea in culoarul CF 500 (cale pe balast)
    // traversarile drum × T1 (toate denivelate: type 'pod', cu gabaritul obtinut) si viaductele rezultate
    crossings: xing, viaducts,
  };
}
