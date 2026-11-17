import * as THREE from 'three';
import { ROUTE } from './route-data.js';
import { smooth } from './util3d.js';
import { analyseRoads } from './road-clear.js';

// Traseul T1: polilinie in plan (din OSM, vezi scripts/build-route.mjs) + profil in lung (relief SRTM,
// panta limitata la 3,5 %, netezit, rambleu / viaduct unde e nevoie, pod peste parau).
// Esantionare uniforma la `step` metri => cautare O(1) dupa distanta s.

export const TRACK_HALF = 1.7;     // jumatate din entraxul liniilor duble (3,4 m)
export const TERM_STUB = 95;       // lungimea capatului cu linie simpla la terminale (s de la capete)

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
  const rampAt = (s) => smooth(TERM_STUB - 60, TERM_STUB, s) * smooth(TERM_STUB - 60, TERM_STUB, L - s);
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
    return smooth(TERM_STUB - 60, TERM_STUB, s) * smooth(TERM_STUB - 60, TERM_STUB, L - s);
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
  // un peron nu are voie sa acopere o trecere la nivel (strada care ar intra pe sub peron):
  // mutam statia cel mult 60 m in lungul liniei, pana unde peronul (± 21 m + 3 m garda) e liber
  const clearAt = (s) => !roads.crossings.some((c) => c.s1 > s - 24 && c.s0 < s + 24);
  for (const st of stops) {
    if (st.term || clearAt(st.s)) continue;
    for (let d = 2; d <= 60; d += 2) {
      const cand = [st.s - d, st.s + d].find((s) => s > 130 && s < L - 130 && clearAt(s));
      if (cand !== undefined) { st.s0 = st.s; st.s = cand; break; }
    }
  }

  return {
    length: L, pts: P, S, y, terrain: t, kind, stops, maxGrade,
    pos, tangent, heightAtS, terrainAtS, kindAt, offsetPoint, samples, laneRamp, onRoadAt, roadSurfAt,
    climb: y[N - 1] - y[0],
    streams,
    corridor: ROUTE.corridor || [0, 0],   // [s0, s1] portiunea in culoarul CF 500 (cale pe balast)
    crossings: roads.crossings,
  };
}
