import * as THREE from 'three';
import { Batch } from './builder.js';
import { toWorld, toLocal } from './frame.js';
import { PAVE_Y } from './kit.js';
import { addBuses, createBusDisplays } from './vehicles.js';

// Autobuzele urbane care pleaca din autogara garii, pe strazi REALE (geometria vine din public/data/osm.json):
//  insula autogarii → breteaua de iesire → Str. Ceferiștilor (spre vest) → Str. Mihai Eminescu (spre sud)
//  → Str. Izvoarelor (spre nord) → Str. Ceferiștilor (spre est) → Str. Gării (spre sud) → breteaua de intrare → insula.
// Circulatie pe dreapta, ≈ 30 km/h, incetinire in curbe, oprire 40 s in statie. Coordonatele de mai jos sunt in
// sistemul local al garii (frame.js); traseul se converteste in coordonate lume.
export const BUS_STREETS = ['Strada Ceferiștilor', 'Strada Mihai Eminescu', 'Strada Izvoarelor', 'Strada Gării'];
const V_MAX = 30 / 3.6, A_ACC = 0.9, A_DEC = 1.1, A_LAT = 1.3, DWELL = 40;
const STOP = [-24.8, 30];

export function buildBuses(ctx, M) {
  const osm = ctx.city?.osm;
  const route = osm ? makeRoute(osm) : null;
  const group = new THREE.Group();
  group.name = 'autobuze-circuit';
  ctx.scene.add(group);
  const displays = createBusDisplays([['12', 'Centru'], ['3', 'Spital – Policlinică']]);
  const buses = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    g.name = 'autobuz-' + (i ? '3' : '12');
    g.rotation.order = 'YXZ';
    const B = new Batch('autobuz-afisaje-' + i);
    const meshes = addBuses(g, B, M, [{ x: 0, y: 0, z: 0, ry: 0, line: i }], displays);
    B.build(g, { cast: false });
    group.add(g);
    const body = meshes.find((m) => m.name === 'autobuz:body')?.material;
    const accent = meshes.find((m) => m.name === 'autobuz:accent')?.material;
    buses.push({ g, body, accent, y: null });
  }
  // fara date OSM: autobuzele stau in statie
  if (!route) {
    buses.forEach((b, i) => { const [x, z] = toWorld(STOP[0], STOP[1] - i * 16); b.g.position.set(x, PAVE_Y + 0.02, z); b.g.rotation.y = Math.atan2(...dirW(0, -1)); });
    return { update() {}, setFuture(on) { paint(buses, on); }, route: null };
  }
  const { pts, T, cycle, length } = route;
  const N = pts.length;
  const heightAt = (x, z) => {
    const [lx, lz] = toLocal(x, z);
    if (lx > -42.5 && lx < -5 && lz > -112 && lz < 70) return PAVE_Y + 0.02; // pavajul / benzile garii
    const r = ctx.city?.roadHeightAt?.(x, z);
    return r ?? ctx.terrain.heightAt(x, z) + 0.15;
  };
  const sAt = (u) => {
    if (u <= DWELL) return 0;
    const tt = u - DWELL;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= tt) lo = m; else hi = m; }
    const f = THREE.MathUtils.clamp((tt - T[lo]) / Math.max(1e-6, T[hi] - T[lo]), 0, 1);
    return lo + f;
  };
  const at = (s) => {
    const i = ((Math.floor(s) % N) + N) % N, j = (i + 1) % N, f = s - Math.floor(s);
    return [pts[i][0] + (pts[j][0] - pts[i][0]) * f, pts[i][1] + (pts[j][1] - pts[i][1]) * f];
  };
  function update(dt, t) {
    for (let k = 0; k < buses.length; k++) {
      const b = buses[k];
      const u = (((t + k * cycle * 0.5) % cycle) + cycle) % cycle;
      const s = sAt(u);
      const [x, z] = at(s);
      const [xa, za] = at(s - 3), [xb, zb] = at(s + 3);
      const y = heightAt(x, z);
      b.y = b.y == null || Math.abs(b.y - y) > 3 ? y : b.y + (y - b.y) * Math.min(1, dt * 6);
      b.g.position.set(x, b.y, z);
      b.g.rotation.y = Math.atan2(xb - xa, zb - za);
      // inclinare usoara pe panta
      const ya = heightAt(xa, za), yb = heightAt(xb, zb);
      b.g.rotation.x = -Math.atan2(yb - ya, Math.hypot(xb - xa, zb - za)) * 0.8;
    }
  }
  update(0, 0);
  console.info(`Autobuze: circuit ${Math.round(length)} m, tur complet ${Math.round(cycle)} s`);
  ctx.mapLayers?.push({ points: pts.filter((_, i) => i % 6 === 0), color: '#3b82f6', width: 2 });
  return { update, setFuture(on) { paint(buses, on); }, route: pts, length, cycle };
}

function paint(buses, on) {
  for (const b of buses) {
    if (b.body) b.body.color.setHex(on ? 0xf3f5f6 : 0xe9e1c9);   // azi: autobuze mai vechi, crem
    if (b.accent) b.accent.color.setHex(on ? 0x16a34a : 0x9f1d1d); // azi: banda rosie, fara livrea verde
  }
}

function dirW(dx, dz) { const [a, b] = toWorld(dx, dz); return [a, b]; }

// ---------------------------------------------------------------------------------------------
// Traseul: polilinii OSM (centrul strazii) decalate la dreapta (banda de mers), racordate cu Catmull-Rom.
function makeRoute(osm) {
  const roads = osm.roads || [];
  const loc = (r) => r.p.map(([x, z]) => toLocal(x, z));
  const byName = (n) => roads.filter((r) => r.n === n).map(loc);
  // lipeste segmentele unei strazi intre doua puncte (cel mai scurt lant de vertecsi apropiati)
  function street(name, from, to) {
    const ways = byName(name);
    if (!ways.length) return null;
    // graf de noduri
    const nodes = [], key = (p) => nodes.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.2);
    const adj = [];
    const id = (p) => { let k = key(p); if (k < 0) { k = nodes.length; nodes.push(p); adj.push([]); } return k; };
    for (const w of ways) for (let i = 0; i < w.length - 1; i++) {
      const a = id(w[i]), b = id(w[i + 1]), d = Math.hypot(w[i][0] - w[i + 1][0], w[i][1] - w[i + 1][1]);
      adj[a].push([b, d]); adj[b].push([a, d]);
    }
    const near = (p) => { let k = 0, bd = 1e9; nodes.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; k = i; } }); return k; };
    const s = near(from), e = near(to);
    const dist = new Array(nodes.length).fill(1e12), prev = new Array(nodes.length).fill(-1), done = new Array(nodes.length).fill(false);
    dist[s] = 0;
    for (;;) {
      let u = -1, bd = 1e12;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0 || u === e) break;
      done[u] = true;
      for (const [v, d] of adj[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; }
    }
    if (dist[e] > 1e11) return null;
    const out = [];
    for (let k = e; k >= 0; k = prev[k]) out.push(nodes[k]);
    return out.reverse();
  }
  const offsetRight = (P, d) => P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * d, p[1] + (dx / l) * d]; // dreapta sensului de mers (x est, z sud)
  });
  const trim = (P, d0, d1) => {
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = cum[cum.length - 1];
    return P.filter((_, i) => cum[i] >= d0 && cum[i] <= L - d1);
  };
  const densify = (P, step = 12) => {
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) / step));
      for (let k = 0; k < n; k++) out.push([P[i][0] + ((P[i + 1][0] - P[i][0]) * k) / n, P[i][1] + ((P[i + 1][1] - P[i][1]) * k) / n]);
    }
    out.push(P[P.length - 1]);
    return out;
  };

  const cefW = street('Strada Ceferiștilor', [-46, -1], [-484, 4]);
  const emin = street('Strada Mihai Eminescu', [-484, 4], [-283, 328]);
  const izv = street('Strada Izvoarelor', [-283, 328], [-180, 1]);
  const cefE = street('Strada Ceferiștilor', [-180, 1], [-46, -1]);
  const gara = street('Strada Gării', [-46, -1], [-43, 69]);
  if (!cefW || !emin || !izv || !cefE || !gara) return null;
  const lane = (P, d, t0, t1) => trim(offsetRight(densify(P), d), t0, t1);
  const keep = (P, f) => P.filter(f);
  const ctrl = [
    // insula -> breteaua de iesire (la nord de insula, inainte de gradina de ploaie) -> Str. Garii
    [-24.8, 30], [-24.8, 20], [-25.4, 14.5], [-28.2, 10.2], [-33, 7.6], [-38.5, 6.0], [-43, 3.4],
    ...lane(cefW, 1.8, 10, 9),
    ...lane(emin, 1.6, 9, 9),
    ...lane(izv, 1.6, 9, 9),
    ...lane(cefE, 1.8, 9, 9),
    ...keep(lane(gara, 1.8, 9, 0), (p) => p[1] < 50),
    // breteaua de intrare dinspre Str. Garii -> banda autobuzelor -> statie
    [-46.4, 52], [-44.6, 57.6], [-40, 61], [-33, 62.2], [-28.2, 60.8], [-25.4, 56.5], [-24.8, 50], [-24.8, 40],
  ].map(([x, z]) => toWorld(x, z));
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const length = curve.getLength();
  const N = Math.round(length);
  const pts = curve.getSpacedPoints(N).slice(0, N).map((v) => [v.x, v.z]);
  // rotim astfel incat indexul 0 = punctul de oprire
  const [sx, sz] = toWorld(...STOP);
  let i0 = 0, bd = 1e9;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - sx, p[1] - sz); if (d < bd) { bd = d; i0 = i; } });
  const P = pts.slice(i0).concat(pts.slice(0, i0));
  // profil de viteza: limita in curbe, accelerare / franare, 0 in statie
  const hd = (i) => { const a = P[(i - 4 + N) % N], b = P[(i + 4) % N]; return Math.atan2(b[0] - a[0], b[1] - a[1]); };
  const v = new Array(N + 1);
  for (let i = 0; i < N; i++) {
    let dh = Math.abs(hd(i + 4) - hd(i - 4)); if (dh > Math.PI) dh = 2 * Math.PI - dh;
    const R = 16 / Math.max(1e-3, dh);
    v[i] = Math.min(V_MAX, Math.max(2.2, Math.sqrt(A_LAT * R)));
  }
  v[0] = 0; v[N] = 0;
  for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * A_DEC));
  for (let i = 1; i <= N; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * A_ACC));
  const T = [0];
  for (let i = 1; i <= N; i++) T.push(T[i - 1] + 1 / Math.max(0.35, (v[i - 1] + v[i]) / 2));
  const cycle = T[N] + DWELL;
  return { pts: P, T, cycle, length };
}
