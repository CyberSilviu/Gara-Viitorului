// Cotele autostrazilor A7 / A8 si ale bretelelor nodului turbion (logica pura, fara Three.js –
// se poate testa in Node: solveLevels() + verifyLevels()).
//
// Date: caile OSM `highway=construction` (+ `construction=motorway|motorway_link|...`), cu `bridge` (br)
// si `layer` (L). Cote, relativ la terenul netezit:
//  - nivel 0 = sol (rambleu / debleu usor); layer < 0 = tunel / pasaj subteran (A8 vest) => sub teren;
//  - nivel 1 ≈ +7,5 m = orice cale OSM cu bridge=yes / layer=1 (pasaje); layer=2 => +15 m;
//  - acolo unde doua cai se intersecteaza in plan fara diferenta suficienta de cota, calea cu layer mai mare
//    (sau, la egalitate, cea de rang mai mare: bretea > drum > autostrada) urca peste cealalta cu CLEAR
//    (7,5 m cota la cota = 5,6 m gabarit liber + 1,9 m tablier). Doua pasaje de nivel 1 care se intersecteaza
//    => unul urca la nivelul 2 (≈ +15 m). Confluentele / bifurcatiile (varf OSM comun) nu sunt intersectii.
//  - intre doua pasaje apropiate calea ramane sus (fara „montagne russe”); rampe cu panta maxima GRADE;
//  - poduri peste paraie (Zmeul etc.);
//  - `pins`: puncte in care cota unui drum este impusa (ex. traversarea la nivel a liniei T1).

export const LEVEL = 7.5;      // diferenta intre niveluri (m)
export const CLEAR = 7.5;      // diferenta minima de cota intre doua tabliere care se intersecteaza
export const GRADE = 0.045;    // panta maxima a rampelor
export const DECK = 1.9;       // grosimea tablierului
export const TUNNEL = -9;      // cota relativa a tunelurilor (layer < 0)
const SAG = 380;               // o „vale” mai scurta de atat intre doua zone ridicate se umple (rambleu continuu)

const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);

function densify(p, step) {
  const pts = [];
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[i + 1];
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) pts.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
  }
  pts.push(p[p.length - 1]);
  return pts;
}

function segX(A, B, C, D) {
  const rx = B[0] - A[0], rz = B[1] - A[1], qx = D[0] - C[0], qz = D[1] - C[1];
  const den = rx * qz - rz * qx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((C[0] - A[0]) * qz - (C[1] - A[1]) * qx) / den;
  const u = ((C[0] - A[0]) * rz - (C[1] - A[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, den, la: Math.hypot(rx, rz), lb: Math.hypot(qx, qz), x: A[0] + rx * t, z: A[1] + rz * t };
}

// indexul segmentului (i, j) si fractia f pentru distanta s de-a lungul caii
export function sAtIdx(w, s) {
  const n = w.S.length;
  if (n < 2) return [0, 0, 0];
  if (s <= 0) return [0, 0, 1];
  if (s >= w.len) return [n - 2, 1, n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w.S[m] <= s) lo = m; else hi = m; }
  return [lo, w.S[hi] > w.S[lo] ? (s - w.S[lo]) / (w.S[hi] - w.S[lo]) : 0, hi];
}
export const Yat = (w, s) => { const [i, f, j] = sAtIdx(w, s); return w.Y[i] * (1 - f) + w.Y[j] * f; };
export const liftAt = (w, s) => { const [i, f, j] = sAtIdx(w, s); return w.lift[i] * (1 - f) + w.lift[j] * f; };

// tipul si latimea (asfalt, fara parapete) unei cai in constructie
export function wayKind(r) {
  const type = r.c === 'motorway' ? 'mw' : r.c === 'motorway_link' ? 'link' : 'road';
  const lanes = r.lanes || (type === 'link' ? 1 : 2);
  // A7 / A8: cale unidirectionala 2 x 3,5 m + banda de urgenta 2,5 m + benzi de incadrare (axele OSM ale celor
  // doua cai sunt la ~11 m => 10 m + parapete, fara suprapuneri in zona mediana)
  const width = type === 'mw' ? (lanes >= 3 ? 13.5 : 10.0) : type === 'link' ? (lanes >= 2 ? 9.0 : 6.5)
    : r.c === 'primary' ? 9.5 : r.c === 'secondary' ? 8 : r.c === 'tertiary' ? 7 : 5;
  return { type, lanes, width };
}

/**
 * roads  = osm.roads (se folosesc doar k === 'construction')
 * rivers = osm.rivers
 * H(x,z) = cota terenului
 * opts.pins = [{ x, z, y, r }] cote impuse pentru drumurile (type 'road') care trec la mai putin de r m
 * returneaza { ways, crossings, maxLift, levelCounts, linkedNear }
 */
export function solveLevels(roads, rivers, H, opts = {}) {
  const step = opts.step || 8;
  const src = roads.filter((r) => r.k === 'construction' && r.p && r.p.length >= 2);
  const ways = src.map((r, id) => {
    const { type, width } = wayKind(r);
    const pts = densify(r.p, step);
    const S = [0];
    for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = S[S.length - 1];
    const L = r.L || 0;
    return {
      id, r, type, ref: r.ref || '', name: r.n || '', width, pts, S, len,
      keys: new Set(r.p.map(key)), k0: key(r.p[0]), k1: key(r.p[r.p.length - 1]),
      br: !!r.br, L, tunnel: L < 0,
      inner: (r.br || L >= 1) ? LEVEL * Math.max(1, L) : L < 0 ? TUNNEL : 0,
      base: null, lift: null, Y: null, reqs: [],
    };
  }).filter((w) => w.len > 2);
  ways.forEach((w, i) => { w.id = i; });

  // ---------------- cota de baza (teren netezit, capete exacte => noduri continue) ----------------
  const pins = opts.pins || [];
  for (const w of ways) {
    const n = w.pts.length;
    const raw = w.pts.map(([x, z]) => H(x, z));
    const win = w.type === 'road' ? 30 : 90;
    const sm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = i; j >= 0 && w.S[i] - w.S[j] <= win; j--) { s += raw[j]; c++; }
      for (let j = i + 1; j < n && w.S[j] - w.S[i] <= win; j++) { s += raw[j]; c++; }
      sm[i] = s / c;
    }
    const d0 = raw[0] - sm[0], d1 = raw[n - 1] - sm[n - 1];
    w.base = new Float64Array(n);
    for (let i = 0; i < n; i++) { const u = w.len ? w.S[i] / w.len : 0; w.base[i] = sm[i] + d0 * (1 - u) + d1 * u + 0.35; }
    // cote impuse (ex. trecerea la nivel cu T1): corectie locala lina a cotei de baza
    if (w.type === 'road') for (const pn of pins) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.hypot(w.pts[i][0] - pn.x, w.pts[i][1] - pn.z); if (d < bd) { bd = d; bi = i; } }
      if (bd > (pn.r || 12)) continue;
      const dy = pn.y - w.base[bi];
      for (let i = 0; i < n; i++) {
        const ds = Math.abs(w.S[i] - w.S[bi]);
        const k = ds < 15 ? 1 : ds > 70 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (ds - 15) / 55);
        w.base[i] += dy * k;
      }
      w.pinned = true;
    }
    w.lift = new Float64Array(n).fill(w.inner);
  }

  // ---------------- noduri (capete comune) ----------------
  const nodeWays = new Map();
  for (const w of ways) for (const k of [w.k0, w.k1]) { if (!nodeWays.has(k)) nodeWays.set(k, []); nodeWays.get(k).push(w); }
  // doua cai legate printr-un varf OSM comun aflat la mai putin de r m de punctul (x, z) => confluenta / bifurcatie
  const linkedNear = (a, b, x, z, r) => {
    for (const k of a.keys) if (b.keys.has(k)) { const [px, pz] = k.split(',').map(Number); if (Math.hypot(px - x, pz - z) < r) return true; }
    return false;
  };

  // ---------------- intersectii in plan ----------------
  const CELL = 120;
  const grid = new Map();
  for (const w of ways) for (let i = 0; i < w.pts.length - 1; i++) {
    for (const [x, z] of [w.pts[i], w.pts[i + 1]]) {
      const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
      if (!grid.has(k)) grid.set(k, new Set());
      grid.get(k).add(w.id * 100000 + i);
    }
  }
  const crossings = [];
  const seen = new Set();
  for (const [, set] of grid) {
    const list = [...set];
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      let wa = ways[Math.floor(list[a] / 100000)], wb = ways[Math.floor(list[b] / 100000)];
      if (wa === wb) continue;
      let ia = list[a] % 100000, ib = list[b] % 100000;
      if (wa.id > wb.id) { [wa, wb] = [wb, wa]; [ia, ib] = [ib, ia]; }
      const X = segX(wa.pts[ia], wa.pts[ia + 1], wb.pts[ib], wb.pts[ib + 1]);
      if (!X) continue;
      const id = wa.id + ':' + wb.id + ':' + Math.round(X.x / 5) + ':' + Math.round(X.z / 5);
      if (seen.has(id)) continue; seen.add(id);
      if (linkedNear(wa, wb, X.x, X.z, 40)) continue; // confluenta / bifurcatie
      const sin = Math.abs(X.den) / (X.la * X.lb);
      crossings.push({ wa, sa: wa.S[ia] + X.t * X.la, wb, sb: wb.S[ib] + X.u * X.lb, x: X.x, z: X.z, sin });
    }
  }
  // paraie (Zmeul etc.) => pod cu gabarit de ~3,5 m
  for (const rv of rivers || []) {
    for (const w of ways) {
      if (w.tunnel) continue;
      for (let i = 0; i < w.pts.length - 1; i++) for (let j = 0; j < rv.p.length - 1; j++) {
        const X = segX(w.pts[i], w.pts[i + 1], rv.p[j], rv.p[j + 1]);
        if (!X) continue;
        w.reqs.push({ s: w.S[i] + X.t * X.la, lift: 4.0, half: 18, stream: rv.n || 'pârâu' });
      }
    }
  }

  const baseAt = (w, s) => { const [i, f, j] = sAtIdx(w, s); return w.base[i] * (1 - f) + w.base[j] * f; };
  const yAt = (w, s) => baseAt(w, s) + liftAt(w, s);
  const endLift = (w, atStart) => w.lift[atStart ? 0 : w.lift.length - 1];

  // jumatatea lungimii pe care tablierul superior ramane la cota maxima ca sa acopere tot tablierul inferior
  const plateau = (c, upper) => {
    const other = upper === c.wa ? c.wb : c.wa;
    const sin = Math.max(0.15, c.sin), cos = Math.sqrt(Math.max(0, 1 - sin * sin));
    return Math.min(90, (other.width / 2 + 1.5) / sin + (upper.width / 2) * cos / sin + 6);
  };

  // umplerea „vailor” scurte dintre doua zone ridicate (inchidere morfologica pe fereastra SAG)
  function fillSags(w, lift) {
    if (w.tunnel) return;
    const n = lift.length;
    const out = Float64Array.from(lift);
    for (let i = 0; i < n; i++) {
      let mL = -Infinity, mR = -Infinity;
      for (let j = i; j >= 0 && w.S[i] - w.S[j] <= SAG; j--) mL = Math.max(mL, lift[j]);
      for (let j = i; j < n && w.S[j] - w.S[i] <= SAG; j++) mR = Math.max(mR, lift[j]);
      out[i] = Math.max(lift[i], Math.min(mL, mR));
    }
    lift.set(out);
  }

  function recompute() {
    for (const w of ways) {
      const n = w.pts.length;
      const lift = new Float64Array(n).fill(w.inner);
      // capete: cota nodului (cea mai mare dintre caile care se intalnesc acolo; tunelurile nu coboara nodul)
      const nodeL = (k) => Math.max(w.tunnel ? 0 : w.inner, ...nodeWays.get(k).filter((o) => o !== w).map((o) => (o.k0 === k ? endLift(o, true) : endLift(o, false))));
      const nl0 = nodeL(w.k0), nl1 = nodeL(w.k1);
      for (let i = 0; i < n; i++) {
        // tunel: coborare / urcare cu panta GRADE / 2 intre portaluri si cota TUNNEL
        const g = w.tunnel ? GRADE * 0.5 : GRADE;
        let v = Math.max(w.inner, nl0 - g * w.S[i], nl1 - g * (w.len - w.S[i]));
        for (const rq of w.reqs) v = Math.max(v, rq.lift - GRADE * Math.max(0, Math.abs(w.S[i] - rq.s) - rq.half));
        lift[i] = v;
      }
      fillSags(w, lift);
      if (w.tunnel) w.lift = lift;
      else for (let i = 0; i < n; i++) w.lift[i] = Math.max(w.lift[i], lift[i]);
    }
  }
  // rang: cine urca peste cine cand OSM nu spune (bretea > drum local > autostrada; pod > sol)
  const rank = (w) => (w.type === 'link' ? 3 : w.type === 'road' ? 2 : 1) + (w.br || w.L >= 1 ? 3 : 0);
  const decided = new Map();
  for (let it = 0; it < 16; it++) {
    recompute();
    let changes = 0;
    for (const c of crossings) {
      const ya = yAt(c.wa, c.sa), yb = yAt(c.wb, c.sb);
      if (Math.abs(ya - yb) >= CLEAR - 0.05) continue;
      // decizia o luam o singura data pe intersectie (stabilitate)
      let up = decided.get(c);
      if (!up) {
        if (c.wa.L !== c.wb.L) up = c.wa.L > c.wb.L ? 'a' : 'b';
        else if (rank(c.wa) !== rank(c.wb)) up = rank(c.wa) > rank(c.wb) ? 'a' : 'b';
        else if (Math.abs(ya - yb) > 0.8) up = ya > yb ? 'a' : 'b';
        else up = c.wa.width < c.wb.width ? 'a' : 'b';
        decided.set(c, up);
      }
      const [wu, su, yl] = up === 'a' ? [c.wa, c.sa, yb] : [c.wb, c.sb, ya];
      if (wu.tunnel) continue;
      wu.reqs.push({ s: su, lift: yl + CLEAR + 0.1 - baseAt(wu, su), half: plateau(c, wu), over: true });
      changes++;
    }
    if (!changes) break;
  }
  recompute();
  // netezire usoara (racordari verticale), fara a cobori sub cerinte cu mai mult de 0,2 m
  for (const w of ways) {
    const n = w.lift.length, sm = Float64Array.from(w.lift);
    for (let i = 1; i < n - 1; i++) {
      let s = 0, c = 0;
      for (let j = i; j >= 0 && w.S[i] - w.S[j] <= 24; j--) { s += w.lift[j]; c++; }
      for (let j = i + 1; j < n && w.S[j] - w.S[i] <= 24; j++) { s += w.lift[j]; c++; }
      const u = Math.min(1, Math.min(w.S[i], w.len - w.S[i]) / 30);
      sm[i] = Math.max(w.lift[i] * (1 - u) + (s / c) * u, w.lift[i] - 0.2);
    }
    w.lift = sm;
    w.Y = Array.from(w.base, (b, i) => b + w.lift[i]);
    // tablier pe pile: pod OSM, zona unei intersectii denivelate (cand trece pe deasupra), parau sau cota mare
    w.deck = Array.from(w.lift, (l, i) => {
      if (w.tunnel) return false;
      if (w.br && l > 2.5) return true;
      if (l > 4.6) return true;
      for (const rq of w.reqs) if ((rq.over || rq.stream) && Math.abs(w.S[i] - rq.s) <= rq.half + 4 && l > 2.5) return true;
      return false;
    });
  }
  harmonize(ways);
  let maxLift = 0;
  const levelCounts = [0, 0, 0, 0];
  for (const w of ways) {
    let m = -Infinity;
    for (const l of w.lift) { maxLift = Math.max(maxLift, l); m = Math.max(m, l); }
    w.maxLift = m;
    w.level = w.tunnel ? -1 : m > LEVEL * 1.5 ? 2 : m > LEVEL * 0.55 ? 1 : 0;
    if (w.level >= 0) levelCounts[w.level]++;
  }
  // diferenta finala de cota la fiecare intersectie
  for (const c of crossings) c.dy = Math.abs(Yat(c.wa, c.sa) - Yat(c.wb, c.sb));
  return { ways, crossings, maxLift, levelCounts, linkedNear };
}

// Benzile de iesire / intrare (bretele, drumuri) care merg lipite de o autostrada (zona de racordare)
// preiau cota autostrazii, ca sa nu apara trepte sau parapete care se intretaie.
function harmonize(ways) {
  const CELL = 40, grid = new Map();
  for (const w of ways) if (!w.tunnel) w.pts.forEach(([x, z], i) => {
    const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([w, i]);
  });
  const dirOf = (w, i) => {
    const a = w.pts[Math.max(0, i - 1)], b = w.pts[Math.min(w.pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const master = (w, o) => (o.type === 'mw' && w.type !== 'mw') || (o.type === 'link' && w.type === 'road');
  for (const w of ways) {
    if (w.type === 'mw' || w.tunnel) continue;
    const n = w.pts.length;
    const delta = new Float64Array(n), mark = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [x, z] = w.pts[i], da = dirOf(w, i);
      const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
      let best = null, bd = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [o, j] of grid.get((gx + dx) + ',' + (gz + dz)) || []) {
        if (o === w || !master(w, o)) continue;
        const d = Math.hypot(o.pts[j][0] - x, o.pts[j][1] - z);
        if (d > (w.width + o.width) / 2 + 0.9 || d >= bd) continue;
        const db = dirOf(o, j);
        if (Math.abs(da[0] * db[1] - da[1] * db[0]) > 0.3) continue;
        if (Math.abs(o.Y[j] - w.Y[i]) > 2.5) continue;
        bd = d; best = o.Y[j] - w.Y[i];
      }
      if (best !== null) { delta[i] = best; mark[i] = 1; }
    }
    if (!mark.some((m) => m)) continue;
    // racordare lina (60 m) catre zonele nemodificate
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let bestDs = Infinity, val = 0;
      for (let i = 0; i < n; i++) if (mark[i]) { const ds = Math.abs(w.S[k] - w.S[i]); if (ds < bestDs) { bestDs = ds; val = delta[i]; } }
      const t = Math.min(1, bestDs / 60);
      out[k] = val * (0.5 + 0.5 * Math.cos(Math.PI * t));
    }
    for (let k = 0; k < n; k++) w.Y[k] += out[k];
  }
}

// Verificare: tabliere care se suprapun in plan (fara un varf comun la < 150 m) si au diferenta de cota prea mica.
//  - kind 'cross': cai care se intersecteaza sub un unghi > ~17° => trebuie denivelate (dy >= minDy);
//  - kind 'side' : cai aproape paralele care se suprapun lateral la cote diferite (parapete care se intersecteaza).
export function verifyLevels({ ways, linkedNear }, minDy = CLEAR - 0.6) {
  const CELL = 40, grid = new Map();
  for (const w of ways) w.pts.forEach(([x, z], i) => {
    const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([w, i]);
  });
  const dirOf = (w, i) => {
    const a = w.pts[Math.max(0, i - 1)], b = w.pts[Math.min(w.pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const bad = new Map();
  for (const w of ways) w.pts.forEach(([x, z], i) => {
    if (w.tunnel) return;
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    const da = dirOf(w, i);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [o, j] of grid.get((gx + dx) + ',' + (gz + dz)) || []) {
      if (o.id <= w.id || o.tunnel) continue;
      const d = Math.hypot(o.pts[j][0] - x, o.pts[j][1] - z);
      const db = dirOf(o, j);
      const sin = Math.abs(da[0] * db[1] - da[1] * db[0]);
      const reach = sin > 0.3 ? (w.width + o.width) / 2 + 1 : (w.width + o.width) / 2 + 0.9;
      if (d > reach) continue;
      if (linkedNear(w, o, x, z, 150)) continue;
      // intersectie la nivel intre drumuri locale / capat de bretea pe drum local = permisa
      if ((w.type === 'road' || o.type === 'road') && w.type !== 'mw' && o.type !== 'mw' && Math.abs(w.Y[i] - o.Y[j]) < 1) continue;
      const dy = Math.abs(w.Y[i] - o.Y[j]);
      const kind = sin > 0.3 ? 'cross' : 'side';
      if ((kind === 'cross' && dy < minDy) || (kind === 'side' && dy > 0.6 && dy < minDy)) {
        const id = w.id + ':' + o.id + ':' + kind;
        const prev = bad.get(id);
        if (!prev || dy < prev.dy) bad.set(id, { a: w, b: o, x, z, dy, d, kind });
      }
    }
  });
  return [...bad.values()];
}
