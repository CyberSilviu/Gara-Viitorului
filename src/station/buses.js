import * as THREE from 'three';
import { Batch } from './builder.js';
import { toWorld, toLocal } from './frame.js';
import { PAVE_Y } from './kit.js';
import { addBuses, createBusDisplays, addCars } from './vehicles.js';
import { driveY, LINK_X0, LINK_X1, LINKS, linkSpan, VERGES, VERGE_X, KERB_R, ZONES, TODAY_ALLEYS, TAXI_PARK_X, TAXI_STOP_Z } from './plaza.js';
import { SegmentIndex } from '../core/util.js';

// Autobuzele urbane care pleaca din autogara garii, pe strazi REALE (geometria vine din public/data/osm.json):
//  insula autogarii → breteaua de iesire → Str. Ceferiștilor (spre vest) → Str. Mihai Eminescu (spre sud)
//  → Str. Izvoarelor (spre nord) → Str. Ceferiștilor (spre est) → Str. Gării (spre sud) → breteaua de intrare → insula.
// Azi: autobuze mai vechi (diesel, fara baterii pe acoperis) opresc pe Str. Garii, in fata garii, si intorc prin
// aleile reale ale parcarii; acelasi circuit prin oras. Circulatie pe dreapta, ≈ 30 km/h, incetinire in curbe, oprire 40 s in statie. Coordonatele de mai jos sunt in
// sistemul local al garii (frame.js); traseul se converteste in coordonate lume.
export const BUS_STREETS = ['Strada Ceferiștilor', 'Strada Mihai Eminescu', 'Strada Izvoarelor', 'Strada Gării'];
const V_MAX = 30 / 3.6, A_ACC = 0.9, A_DEC = 1.1, A_LAT = 1.3, DWELL = 40;
const STOP = [-24.8, 30];        // viitor: insula autogarii
const STOP_TODAY = [-42.3, 24];  // azi: statia de pe Str. Garii, pe banda spre nord (partea garii), in fata cladirii

export function buildBuses(ctx, M) {
  const osm = ctx.city?.osm;
  const routes = osm ? { future: makeRoute(osm, true), today: makeRoute(osm, false) } : null;
  if (routes && (!routes.future || !routes.today)) routes.future = routes.today = routes.future || routes.today;
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
    const roof = meshes.find((m) => m.name === 'autobuz:roof'); // baterii + pantograf: doar autobuzele electrice
    buses.push({ g, body, accent, roof, y: null });
  }
  let future = true;
  // fara date OSM: autobuzele stau in statie
  if (!routes || !routes.future) {
    const park = () => buses.forEach((b, i) => {
      const [sx, sz] = future ? STOP : STOP_TODAY;
      const [x, z] = toWorld(sx, sz + (future ? 1 : -1) * i * 16 * (future ? -1 : 1));
      b.g.position.set(x, future ? PAVE_Y + 0.02 : (ctx.city?.roadHeightAt?.(x, z) ?? ctx.terrain.heightAt(x, z) + 0.15), z);
      b.g.rotation.y = Math.atan2(...dirW(0, future ? -1 : -1));
    });
    park();
    return { update() {}, setFuture(on) { future = on; paint(buses, on); park(); }, route: null };
  }
  const heightAt = (x, z) => {
    const [lx, lz] = toLocal(x, z);
    const sy = driveY(lx, lz, future); // benzile / bretelele garii (viitor) sau aleile si parcarea (azi)
    if (sy != null && !(!future && lx < LINK_X0 - 3)) return sy;
    const r = ctx.city?.roadHeightAt?.(x, z);
    return r ?? ctx.terrain.heightAt(x, z) + 0.15;
  };
  const sAt = (R, u) => {
    const { T, N } = R;
    if (u <= R.dwell) return 0;
    const tt = u - R.dwell;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= tt) lo = m; else hi = m; }
    const f = THREE.MathUtils.clamp((tt - T[lo]) / Math.max(1e-6, T[hi] - T[lo]), 0, 1);
    return lo + f;
  };
  const at = (R, s) => {
    const { pts, N } = R;
    const i = ((Math.floor(s) % N) + N) % N, j = (i + 1) % N, f = s - Math.floor(s);
    return [pts[i][0] + (pts[j][0] - pts[i][0]) * f, pts[i][1] + (pts[j][1] - pts[i][1]) * f];
  };
  const taxis = buildTaxis(ctx, M, () => future, heightAt, sAt, at);
  taxis?.reset();
  function update(dt, t) {
    taxis?.update(dt, t);
    const R = future ? routes.future : routes.today;
    for (let k = 0; k < buses.length; k++) {
      const b = buses[k];
      const u = (((t + k * R.cycle * 0.5) % R.cycle) + R.cycle) % R.cycle;
      const s = sAt(R, u);
      const [x, z] = at(R, s);
      const [xa, za] = at(R, s - 3), [xb, zb] = at(R, s + 3);
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
  const F = routes.future;
  console.info(`Autobuze: circuit ${Math.round(F.length)} m, tur complet ${Math.round(F.cycle)} s (azi: ${Math.round(routes.today.length)} m)`);
  ctx.mapLayers?.push({ points: F.pts.filter((_, i) => i % 6 === 0), color: '#3b82f6', width: 2 });
  // „Azi”: autobuze mai vechi, oprire pe Str. Garii; „Viitor”: autobuze electrice prin autogara garii
  return {
    update,
    setFuture(on) { future = on; paint(buses, on); for (const b of buses) b.y = null; taxis?.reset(); update(0, ctx.clock?.elapsedTime ?? 0); },
    taxis: taxis && { route: taxis.routes.future.pts, routeToday: taxis.routes.today.pts, check: taxis.check },
    route: F.pts, routeToday: routes.today.pts, length: F.length, cycle: F.cycle,
  };
}

function paint(buses, on) {
  for (const b of buses) {
    if (b.body) b.body.color.setHex(on ? 0xf3f5f6 : 0xe9e1c9);   // azi: autobuze mai vechi, crem
    if (b.accent) b.accent.color.setHex(on ? 0x16a34a : 0x9f1d1d); // azi: banda rosie, fara livrea verde
    if (b.roof) b.roof.visible = on;                               // azi: diesel, fara baterii / pantograf pe acoperis
  }
}

function dirW(dx, dz) { const [a, b] = toWorld(dx, dz); return [a, b]; }

// ---------------------------------------------------------------------------------------------
// Traseul: polilinii OSM (centrul strazii) decalate la dreapta (banda de mers); la fiecare intersectie benzile
// se intersecteaza, iar coltul se racordeaza (Bezier) cu raza aleasa astfel incat toata latimea autobuzului
// (± 1,3 m) sa ramana pe asfalt. La virajele la dreapta autobuzul se apropie de axa strazii (ca in realitate).
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function densify(P, step = 2) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const n = Math.max(1, Math.ceil(dist2(P[i], P[i + 1]) / step));
    for (let k = 0; k < n; k++) out.push([P[i][0] + ((P[i + 1][0] - P[i][0]) * k) / n, P[i][1] + ((P[i + 1][1] - P[i][1]) * k) / n]);
  }
  out.push(P[P.length - 1]);
  return out;
}
const cumLen = (P) => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + dist2(P[i], P[i - 1])); return c; };
// decalaj la dreapta variabil: d la mijloc, dS / dE la capete (racordat pe `taper` metri)
function lane(P, d, dS = d, dE = d, taper = 22) {
  const Q = densify(P), c = cumLen(Q), L = c[c.length - 1];
  const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  return Q.map((p, i) => {
    const a = Q[Math.max(0, i - 2)], b = Q[Math.min(Q.length - 1, i + 2)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const o = dS + (d - dS) * sm(c[i] / taper) + (dE - d) * sm(1 - (L - c[i]) / taper);
    return [p[0] - (dz / l) * o, p[1] + (dx / l) * o]; // dreapta sensului de mers (x est, z sud)
  });
}
function segX(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}
// leaga banda A (se termina in intersectie) de banda B (pleaca din intersectie), racord de raza R
function join(A, B, R) {
  const n = A.length, a1 = A[n - 1], a0 = A[n - 2], la = dist2(a0, a1) || 1, ua = [(a1[0] - a0[0]) / la, (a1[1] - a0[1]) / la];
  const b0 = B[0], b1 = B[1], lb = dist2(b0, b1) || 1, ub = [(b1[0] - b0[0]) / lb, (b1[1] - b0[1]) / lb];
  const Ax = A.concat([[a1[0] + ua[0] * 30, a1[1] + ua[1] * 30]]), Bx = [[b0[0] - ub[0] * 30, b0[1] - ub[1] * 30]].concat(B);
  let hit = null;
  for (let i = Ax.length - 2; i >= Math.max(0, Ax.length - 40) && !hit; i--) {
    for (let j = 0; j <= Math.min(Bx.length - 2, 40); j++) { const X = segX(Ax[i], Ax[i + 1], Bx[j], Bx[j + 1]); if (X) { hit = { X, i, j }; break; } }
  }
  if (!hit) return A.concat(B.filter((p) => (p[0] - a1[0]) * ua[0] + (p[1] - a1[1]) * ua[1] > 0.5)); // in prelungire
  const { X, i, j } = hit;
  const Ac = Ax.slice(0, i + 1).concat([X]), Bc = [X].concat(Bx.slice(j + 1));
  const u1 = [Ac[Ac.length - 1][0] - Ac[Ac.length - 2][0], Ac[Ac.length - 1][1] - Ac[Ac.length - 2][1]];
  const u2 = [Bc[1][0] - Bc[0][0], Bc[1][1] - Bc[0][1]];
  const th = Math.acos(THREE.MathUtils.clamp((u1[0] * u2[0] + u1[1] * u2[1]) / ((Math.hypot(...u1) * Math.hypot(...u2)) || 1), -1, 1));
  const cA = cumLen(Ac), cB = cumLen(Bc);
  const t = Math.min(R * Math.tan(th / 2), cA[cA.length - 1] - 1, cB[cB.length - 1] - 1);
  if (t < 0.5) return Ac.concat(Bc.slice(1));
  const along = (P, c, s) => { let k = 1; while (k < P.length - 1 && c[k] < s) k++; const f = (s - c[k - 1]) / Math.max(1e-6, c[k] - c[k - 1]); return [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * f, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * f]; };
  const LA = cA[cA.length - 1], T1 = along(Ac, cA, LA - t), T2 = along(Bc, cB, t);
  const out = Ac.filter((_, k) => cA[k] < LA - t - 0.3);
  const m = Math.max(4, Math.ceil((2 * t) / 1.5));
  for (let k = 0; k <= m; k++) {
    const s = k / m, w0 = (1 - s) * (1 - s), w1 = 2 * s * (1 - s), w2 = s * s;
    out.push([w0 * T1[0] + w1 * X[0] + w2 * T2[0], w0 * T1[1] + w1 * X[1] + w2 * T2[1]]);
  }
  return out.concat(Bc.filter((_, k) => cB[k] > t + 0.3));
}

// lipeste segmentele unei strazi (nume sau filtru) intre doua puncte (cel mai scurt lant de vertecsi apropiati)
function streetFinder(osm) {
  const roads = osm.roads || [];
  const loc = (r) => r.p.map(([x, z]) => toLocal(x, z));
  return function street(name, from, to) {
    const ways = roads.filter(typeof name === 'function' ? name : (r) => r.n === name).map(loc);
    if (!ways.length) return null;
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
  };
}

function makeRoute(osm, future) {
  const street = streetFinder(osm);
  const cefW = street('Strada Ceferiștilor', [-46, -1], [-484, 4]);
  const emin = street('Strada Mihai Eminescu', [-484, 4], [-283, 328]);
  const izv = street('Strada Izvoarelor', [-283, 328], [-180, 1]);
  const cefE = street('Strada Ceferiștilor', [-180, 1], [-46, -1]);
  const garaS = street('Strada Gării', [-46, -1], [-43, 69]);
  const garaN1 = street('Strada Gării', [-46, -1], [-45, -47]);
  const garaN2 = street('Strada Gării', [-44, 46], [-46, -1]);
  if (!cefW || !emin || !izv || !cefE || !garaS || !garaN1 || !garaN2) return null;
  // circuitul prin oras (comun): Ceferistilor (V) → Eminescu (S) → Izvoarelor (N) → Ceferistilor (E)
  let P = join(lane(cefW, 1.9), lane(emin, 1.5), 9);
  P = join(P, lane(izv, 1.5, 1.5, 0.6), 7);
  if (future) {
    // viraj la dreapta pe Str. Garii (spre sud) → breteaua de intrare → banda autobuzelor → statie → breteaua de iesire
    P = join(P, lane(cefE, 1.9, 0.8, 0.9), 5.5);
    P = join(P, lane(garaS, 1.9, 0.9, 1.9).filter((p) => p[1] < 50), 6);
    P = P.concat(densify([[-46.4, 52], [-44.6, 57.6], [-40, 61], [-33, 62.2], [-28.2, 60.8], [-25.4, 56.5], [-24.8, 50], [-24.8, 40],
      [-24.8, 30], [-24.8, 20], [-24.9, 12], [-25.6, 5.5], [-27.6, 0.6], [-31.2, -2.2], [-36, -3.0], [-42, -3.1]]));
  } else {
    // azi: viraj la stanga pe Str. Garii (spre nord) → aleea de nord a parcarii → culoarul de langa bordura parcarii
    // (spre sud) → aleea de sud → Str. Garii spre nord, statia in fata garii → viraj la stanga pe Ceferistilor
    P = join(P, lane(cefE, 1.9, 0.8, 1.9), 5.5);
    P = join(P, lane(garaN1, 1.9), 9);
    P = join(P, densify([[-47, -46.8], [-29, -46.8]]), 5);
    P = join(P, densify([[-26.4, -52], [-26.4, 50]]), 5);
    P = join(P, densify([[-29, 44.6], [-47, 44.6]]), 5);
    P = join(P, lane(garaN2, 2.3, 2.0, 2.0), 5);
  }
  // inchidem bucla: ultimul tronson → inceputul (Ceferistilor spre vest); copia primelor 40 de puncte se taie la loc
  const K = 40;
  const closed = join(P, P.slice(0, K), future ? 0 : 9);
  const ctrlL = closed.slice(K - 1, closed.length - 1);
  return finishLoop(ctrlL, future ? STOP : STOP_TODAY, DWELL, V_MAX);
}

// bucla inchisa (puncte locale) => puncte la 1 m (lume), rotite astfel incat indexul 0 = oprirea; profil de viteza
function finishLoop(ctrlL, stop, dwell, vMax) {
  const ctrl = ctrlL.filter((p, i) => i === 0 || dist2(p, ctrlL[i - 1]) > 0.4).map(([x, z]) => toWorld(x, z));
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const length = curve.getLength();
  const N = Math.round(length);
  const pts = curve.getSpacedPoints(N).slice(0, N).map((v) => [v.x, v.z]);
  // rotim astfel incat indexul 0 = punctul de oprire
  const [sx, sz] = toWorld(...stop);
  let i0 = 0, bd = 1e9;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - sx, p[1] - sz); if (d < bd) { bd = d; i0 = i; } });
  const Pp = pts.slice(i0).concat(pts.slice(0, i0));
  // profil de viteza: limita in curbe, accelerare / franare, 0 in statie
  const hd = (i) => { const a = Pp[(i - 4 + N) % N], b = Pp[(i + 4) % N]; return Math.atan2(b[0] - a[0], b[1] - a[1]); };
  const v = new Array(N + 1);
  for (let i = 0; i < N; i++) {
    let dh = Math.abs(hd(i + 4) - hd(i - 4)); if (dh > Math.PI) dh = 2 * Math.PI - dh;
    const R = 16 / Math.max(1e-3, dh);
    v[i] = Math.min(vMax, Math.max(2.2, Math.sqrt(A_LAT * R)));
  }
  v[0] = 0; v[N] = 0;
  for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * A_DEC));
  for (let i = 1; i <= N; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * A_ACC));
  const T = [0];
  for (let i = 1; i <= N; i++) T.push(T[i - 1] + 1 / Math.max(0.35, (v[i - 1] + v[i]) / 2));
  const cycle = T[N] + dwell;
  return { pts: Pp, T, N, cycle, length, dwell };
}

// ---------------------------------------------------------------------------------------------
// Taxiuri (2): intra din Str. Garii pe breteaua de intrare taxi / kiss & ride, asteapta 30 s in statia de taxi
// (locul din spatele taxiului parcat), ies pe breteaua de nord inapoi in Str. Garii si fac o bucla scurta pe strazi
// reale: Str. Garii (sud) → Str. Ceferistilor (vest) → aleea de serviciu OSM spre nord-est → traverseaza Str. Garii
// drept in breteaua de intrare. Azi banda taxi nu exista: taxiurile intra pe aleea reala de sud a parcarii (z -46,8),
// asteapta pe culoarul parcarii si ies pe aleea de nord (z -102,9). Circulatie pe dreapta.
const TAXI_V = 30 / 3.6, TAXI_DWELL = 30, TAXI_HALF = 1.0;
const TAXI_STOP = [TAXI_PARK_X, TAXI_STOP_Z], TAXI_STOP_TODAY = [-25.6, -80];
// polilinie cu colturile racordate (Bezier patratic, raza R pe colt), apoi densificata la ~1 m
function rounded(V, R) {
  const out = [V[0]];
  for (let i = 1; i < V.length - 1; i++) {
    const a = V[i - 1], b = V[i], c = V[i + 1];
    const la = dist2(a, b), lc = dist2(b, c);
    const u1 = [(b[0] - a[0]) / la, (b[1] - a[1]) / la], u2 = [(c[0] - b[0]) / lc, (c[1] - b[1]) / lc];
    const th = Math.acos(THREE.MathUtils.clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1));
    const r = Array.isArray(R) ? R[i - 1] : R;
    const t = Math.min(r * Math.tan(th / 2), la / 2, lc / 2);
    const T1 = [b[0] - u1[0] * t, b[1] - u1[1] * t], T2 = [b[0] + u2[0] * t, b[1] + u2[1] * t];
    const m = Math.max(2, Math.ceil(t * 1.5));
    for (let k = 0; k <= m; k++) {
      const s = k / m, w0 = (1 - s) * (1 - s), w1 = 2 * s * (1 - s), w2 = s * s;
      out.push([w0 * T1[0] + w1 * b[0] + w2 * T2[0], w0 * T1[1] + w1 * b[1] + w2 * T2[1]]);
    }
  }
  out.push(V[V.length - 1]);
  return densify(out, 1);
}
function makeTaxiRoute(osm, future) {
  const street = streetFinder(osm);
  // iesirea din gara: banda din dreapta a bretelei de nord (sens vest) / a aleii de nord a parcarii (azi)
  const exitZ = future ? LINKS.taxiOut[0] + 2 : TODAY_ALLEYS[0][0] - 1.5;
  const gS = street('Strada Gării', [-45.3, exitZ + 1.5], [-45.7, -1.2]);
  const cef = street('Strada Ceferiștilor', [-45.7, -1.2], [-165.7, 0.6]);
  const svc = street((r) => r.k === 'service', [-165.7, 0.6], [-45, -66.1]);
  if (!gS || !cef || !svc) return null;
  // in gara (local): intrarea (traverseaza Str. Garii din aleea de serviciu), oprirea, iesirea spre Str. Garii
  const X0 = -53.5, inZ = LINKS.taxiIn[1] - 2; // banda din dreapta a bretelei de intrare (sens est)
  const station = future
    ? rounded([[X0, -65.5], [-42, inZ], [TAXI_PARK_X, inZ], [TAXI_PARK_X, TAXI_STOP_Z - 2], [-27.8, TAXI_STOP_Z - 8.5], [-27.8, exitZ], [-40.5, exitZ]], [8, 6, 6, 6, 4])
    : rounded([[X0, -65.5], [-47.2, -65.5], [-47.2, -45.3], [-25.6, -45.3], [-25.6, exitZ], [-40.5, exitZ]], [3, 5, 5, 5]);
  let P = join(station, lane(gS, 2.0).filter((p) => p[1] > exitZ + 1), 6);   // viraj la stanga, Str. Garii spre sud
  P = join(P, lane(cef, 1.9), 4.5);                                            // viraj la dreapta, Ceferistilor spre vest
  P = join(P, lane(svc, 0).filter((p) => p[0] < X0 - 0.5), 3); // viraj la dreapta pe aleea de serviciu (o singura banda, 3,5 m)
  return finishLoop(P, future ? TAXI_STOP : TAXI_STOP_TODAY, TAXI_DWELL, TAXI_V);
}

// verificarea „pe asfalt”: fiecare punct al traseului (la 1 m) si punctele de la ±TAXI_HALF lateral trebuie sa fie pe
// carosabilul orasului (latimea reala a drumului desenat) sau pe carosabilul garii (banda taxi + bretelele; azi parcarea + aleile)
function asphaltCheck(ctx, R, future) {
  const idx = new SegmentIndex(30);
  for (const r of ctx.city?.roads || []) if (!r.bridge) idx.addPolyline(r.pts, r.width / 2, r);
  const onCity = (x, z) => idx.query({ minX: x - 12, maxX: x + 12, minZ: z - 12, maxZ: z + 12 }, (s) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
    return Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) <= s.r;
  });
  const inR = (x, z, [a, b, c, d]) => x >= a && x <= c && z >= b && z <= d;
  // insula verde cu colturi rotunjite (aceleasi raze ca vergeMesh din plaza.js)
  const linkEdge = (z) => Object.values(LINKS).some(([a, b]) => Math.abs(z - a) < 0.01 || Math.abs(z - b) < 0.01);
  const inVerge = (x, z) => VERGES.some(([z0, z1]) => {
    const [x0, x1] = VERGE_X;
    if (!inR(x, z, [x0, z0, x1, z1])) return false;
    const rN = linkEdge(z0) ? KERB_R : 0, rS = linkEdge(z1) ? KERB_R : 0;
    for (const [cx, cz, r] of [[x0 + rN, z0 + rN, rN], [x1 - rN * 0.6, z0 + rN * 0.6, rN * 0.6], [x1 - rS * 0.6, z1 - rS * 0.6, rS * 0.6], [x0 + rS, z1 - rS, rS]]) {
      if (r && (x - cx) * Math.sign(cx - (x0 + x1) / 2) > 0 && (z - cz) * Math.sign(cz - (z0 + z1) / 2) > 0 && Math.hypot(x - cx, z - cz) > r) return false;
    }
    return true;
  });
  const onStation = (lx, lz) => {
    if (future) {
      if (inR(lx, lz, ZONES.taxiLane) || inR(lx, lz, ZONES.busLane)) return true;
      return Object.keys(LINKS).some((k) => { const [a, b] = linkSpan(k); return inR(lx, lz, [LINK_X0, a, LINK_X1 + 0.01, b]); }) && !inVerge(lx, lz);
    }
    if (inR(lx, lz, [ZONES.forecourt[0], ZONES.forecourt[1], ZONES.forecourt[2], 60])) return true;
    return TODAY_ALLEYS.some(([zc, w]) => inR(lx, lz, [LINK_X0, zc - w / 2, -29.9, zc + w / 2]));
  };
  const { pts, N } = R;
  let bad = 0, onSt = 0; const where = [];
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    let ok = true, st = false;
    for (const o of [-TAXI_HALF, 0, TAXI_HALF]) {
      const x = pts[i][0] + nx * o, z = pts[i][1] + nz * o, [lx, lz] = toLocal(x, z);
      const s = onStation(lx, lz); st ||= s;
      if (!s && !onCity(x, z)) ok = false;
    }
    if (st) onSt++;
    if (!ok) { bad++; if (where.length < 6) where.push(toLocal(...pts[i]).map((v) => +v.toFixed(1)).join(', ')); }
  }
  return { n: N, bad, onStation: onSt, where };
}

function buildTaxis(ctx, M, isFuture, heightAt, sAt, at) {
  const osm = ctx.city?.osm;
  if (!osm) return null;
  const routes = { future: makeTaxiRoute(osm, true), today: makeTaxiRoute(osm, false) };
  if (!routes.future || !routes.today) return null;
  const group = new THREE.Group();
  group.name = 'taxiuri-gara';
  ctx.scene.add(group);
  // cate doua taxiuri pe mod (viitor: banda taxi; azi: aleile parcarii) => fiecare e vizibil doar in modul lui
  const cars = { future: [], today: [] };
  for (const mode of ['future', 'today']) for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    g.name = (mode === 'future' ? 'taxi-' : 'taxi-azi-') + (i + 1);
    g.rotation.order = 'YXZ';
    addCars(g, M, [{ x: 0, y: 0, z: 0, ry: 0, color: mode === 'future' ? 0xfacc15 : 0xf5c518, taxi: true }], g.name);
    group.add(g);
    cars[mode].push({ g, y: null });
  }
  const check = { future: asphaltCheck(ctx, routes.future, true), today: asphaltCheck(ctx, routes.today, false) };
  const F = routes.future, Tt = routes.today;
  console.info(`Taxiuri: bucla ${Math.round(F.length)} m, tur ${Math.round(F.cycle)} s, oprire ${TAXI_DWELL} s (azi: ${Math.round(Tt.length)} m); ` +
    `pe asfalt (±${TAXI_HALF} m): viitor ${F.N - check.future.bad}/${F.N} puncte, azi ${Tt.N - check.today.bad}/${Tt.N}` +
    (check.future.bad + check.today.bad ? ` – in afara: ${[...check.future.where, ...check.today.where].join(' | ')}` : ''));
  ctx.mapLayers?.push({ points: F.pts.filter((_, i) => i % 6 === 0), color: '#facc15', width: 1.5 });
  return {
    routes, check, group, cars,
    reset() {
      const f = isFuture();
      for (const c of cars.future) { c.y = null; c.g.visible = f; }
      for (const c of cars.today) { c.y = null; c.g.visible = !f; }
    },
    update(dt, t) {
      const mode = isFuture() ? 'future' : 'today', R = routes[mode];
      for (let k = 0; k < cars[mode].length; k++) {
        const c = cars[mode][k];
        const u = (((t + 7 + k * R.cycle * 0.5) % R.cycle) + R.cycle) % R.cycle;
        const s = sAt(R, u);
        const [x, z] = at(R, s), [xa, za] = at(R, s - 1.5), [xb, zb] = at(R, s + 1.5);
        const y = heightAt(x, z);
        c.y = c.y == null || Math.abs(c.y - y) > 3 ? y : c.y + (y - c.y) * Math.min(1, dt * 8);
        c.g.position.set(x, c.y, z);
        c.g.rotation.y = Math.atan2(xb - xa, zb - za);
        c.g.rotation.x = -Math.atan2(heightAt(xb, zb) - heightAt(xa, za), Math.hypot(xb - xa, zb - za)) * 0.8;
      }
    },
  };
}
