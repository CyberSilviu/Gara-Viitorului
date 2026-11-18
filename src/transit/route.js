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

  // ---- T1 × drumuri (TO-DO 2): fiecare loc unde axa taie / calca un drum desenat de oras primeste un tratament ----
  //  - „pasaj”: profilul (dictat de relief + panta max 3,5 %) trece > 2 m peste drum => pod T1 cu gabarit 4,7 m
  //    (cota sinei >= asfalt + 5,6 m); pilele nu se pun pe carosabil (track.js);
  //  - „nivel”: trecere la nivel => profilul T1 e FIXAT la cota asfaltului (ctx.city.roadHeightAt): ciuperca sinei
  //    la +1 cm peste asfalt, dala de cale inglobata (track.js) continua suprafata drumului; rampe <= 3,5 %;
  //  - „inglobat”: axa calca pe drum fara sa-l taie (DJ208L relocat, ~6°) => cale inglobata in carosabil, la fel.
  const RH = ctx.city?.roadHeightAt;
  const RAIL_TOP = 0.16, FLUSH = 0.01, PASAJ = 5.6;
  const roadY = (x, z, hint) => { const v = RH ? RH(x, z, hint) : null; return v == null ? NaN : v; };
  const yAt = (s) => { const [i, f] = idx(s); return y[i] + (y[i + 1] - y[i]) * f; };
  const tAtS = (s) => { const [i, f] = idx(s); return t[i] + (t[i + 1] - t[i]) * f; };
  const xing = roads.crossings.filter((c) => !c.pinned);
  for (const c of xing) {
    const r = roadY(c.x, c.z, tAtS(c.s));
    c.road = r === r ? r : c.y;
    c.ang = Math.round((Math.asin(Math.min(1, c.sin)) * 180) / Math.PI);
    c.dhBefore = yAt(c.s) + RAIL_TOP - c.road;
    c.type = c.dhBefore > 2 ? 'pasaj' : 'nivel';
    if (c.type === 'pasaj') {
      for (let i = 0; i < N; i++) if (S[i] > c.s0 - 4 && S[i] < c.s1 + 4) {
        const ri = roadY(P[i][0], P[i][1], t[i]);
        y[i] = Math.max(y[i], Math.max(c.road, ri === ri ? ri : -Infinity) + PASAJ - RAIL_TOP);
      }
    }
  }
  grade(y);
  // esantioane pe asfalt in afara trecerilor (si departe de podul DN28A) => cale inglobata
  const inX = (s, pad = 2) => xing.some((c) => s > c.s0 - pad && s < c.s1 + pad);
  const dnS = ROUTE.dn28a ?? -1e9;
  const pin = new Float32Array(N).fill(NaN);
  const zones = [];
  for (const c of xing) if (c.type === 'nivel') zones.push({ ...c, type: 'nivel' });
  {
    let cur = null;
    for (let i = 0; i < N; i++) {
      const on = !inX(S[i]) && Math.abs(S[i] - dnS) > 60 && roadY(P[i][0], P[i][1], t[i]) === roadY(P[i][0], P[i][1], t[i]);
      if (on && !cur) cur = { i0: i, i1: i };
      else if (on) cur.i1 = i;
      if ((!on || i === N - 1) && cur) {
        if (S[cur.i1] - S[cur.i0] >= 8) {
          const m = Math.round((cur.i0 + cur.i1) / 2);
          const ri = roadY(P[m][0], P[m][1], t[m]);
          zones.push({ type: 'inglobat', s: S[m], s0: S[cur.i0] - 2, s1: S[cur.i1] + 2, x: P[m][0], z: P[m][1], road: ri, n: '', k: '', ang: 0, dhBefore: y[m] + RAIL_TOP - ri });
        }
        cur = null;
      }
    }
  }
  // numele drumului pentru zonele inglobate (cel mai apropiat segment OSM)
  for (const z of zones) if (z.type === 'inglobat' && osm0) {
    let bd = Infinity;
    for (const w of osm0.roads || []) for (let j = 0; j < (w.p || []).length - 1; j++) {
      const a = w.p[j], b = w.p[j + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((z.x - a[0]) * dx + (z.z - a[1]) * dz) / l2));
      const d = Math.hypot(a[0] + dx * u - z.x, a[1] + dz * u - z.z);
      if (d < bd) { bd = d; z.n = w.n || ''; z.ref = w.ref || ''; z.k = w.k; const ta = P[Math.min(N - 1, Math.round(z.s / step) + 1)], tb = P[Math.max(0, Math.round(z.s / step) - 1)]; const tl = Math.hypot(ta[0] - tb[0], ta[1] - tb[1]) || 1, ql = Math.sqrt(l2); z.ang = Math.round(Math.asin(Math.min(1, Math.abs(((ta[0] - tb[0]) * dz - (ta[1] - tb[1]) * dx) / (tl * ql)))) * 180 / Math.PI); z.dx = dx / ql; z.dz = dz / ql; }
    }
  }
  zones.sort((a, b) => a.s - b.s);
  // cota impusa in zona: asfaltul de sub axa (interpolat unde axa iese de pe asfalt)
  for (const z of zones) {
    const ids = [];
    for (let i = 0; i < N; i++) if (S[i] >= z.s0 && S[i] <= z.s1) ids.push(i);
    const v = ids.map((i) => roadY(P[i][0], P[i][1], t[i]));
    const known = ids.map((_, k) => k).filter((k) => v[k] === v[k]);
    ids.forEach((i, k) => {
      let r = v[k];
      if (!(r === r)) {
        if (!known.length) r = z.road;
        else {
          let a = -1, b = -1;
          for (const kk of known) { if (kk < k) a = kk; if (kk > k && b < 0) b = kk; }
          r = a < 0 ? v[b] : b < 0 ? v[a] : v[a] + ((v[b] - v[a]) * (k - a)) / (b - a);
        }
      }
      pin[i] = r - RAIL_TOP + FLUSH;
    });
  }
  // con de panta +-3,5 % in jurul cotelor impuse (rampele de racordare)
  {
    const hi = new Float32Array(N).fill(Infinity), lo = new Float32Array(N).fill(-Infinity);
    for (let i = 0; i < N; i++) if (pin[i] === pin[i]) { hi[i] = lo[i] = pin[i]; }
    for (let i = 1; i < N; i++) { const d = G * (S[i] - S[i - 1]); hi[i] = Math.min(hi[i], hi[i - 1] + d); lo[i] = Math.max(lo[i], lo[i - 1] - d); }
    for (let i = N - 2; i >= 0; i--) { const d = G * (S[i + 1] - S[i]); hi[i] = Math.min(hi[i], hi[i + 1] + d); lo[i] = Math.max(lo[i], lo[i + 1] - d); }
    for (let i = 0; i < N; i++) {
      if (pin[i] === pin[i]) y[i] = pin[i];
      else y[i] = lo[i] > hi[i] ? (lo[i] + hi[i]) / 2 : Math.min(hi[i], Math.max(lo[i], y[i]));
    }
  }
  // tabel de control
  for (const c of [...xing.filter((c) => c.type === 'pasaj'), ...zones]) c.dhAfter = yAt(c.s) + RAIL_TOP - c.road;
  const xTable = [...xing.filter((c) => c.type === 'pasaj'), ...zones].sort((a, b) => a.s - b.s);
  if (xTable.length) {
    const rows = xTable.map((c) => `  s ${String(Math.round(c.s)).padStart(4)} | ${((c.ref ? c.ref + ' ' : '') + (c.n && c.n !== c.ref ? c.n : '') || c.k).padEnd(32).slice(0, 32)} | ${String(c.ang).padStart(2)}° | Δh ${c.dhBefore >= 0 ? '+' : ''}${c.dhBefore.toFixed(2)} -> ${c.dhAfter >= 0 ? '+' : ''}${c.dhAfter.toFixed(2)} m | ${c.type}`);
    console.info(`T1 × drumuri (${xTable.length}; Δh = ciuperca sinei – asfalt):\n${rows.join('\n')}`);
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
    // treceri (cu type 'nivel' / 'pasaj') si zonele cu cale inglobata la cota asfaltului (treceri la nivel + 'inglobat')
    crossings: roads.crossings,
    levelZones: zones,
  };
}
