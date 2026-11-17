// Sistemul local al garii: originea = centrul cladirii de calatori, axa lunga pe azimut 158.3°.
//  local +X = "est" (spre linii, perpendicular pe axa)   local +Z = de-a lungul axei, spre SSE.
// world = (x est, z sud). Grupul radacina al garii are rotation.y = ROT_Y.
const B = (158.3 * Math.PI) / 180;
export const A = { x: Math.sin(B), z: -Math.cos(B) }; // (0.370, 0.929) de-a lungul axei
export const E = { x: A.z, z: -A.x };                  // (0.929, -0.370) spre linii
export const ROT_Y = Math.atan2(A.x, A.z);              // ~21.7°

export function toWorld(lx, lz) { return [lx * E.x + lz * A.x, lx * E.z + lz * A.z]; }
export function toLocal(x, z) { return [x * E.x + z * E.z, x * A.x + z * A.z]; }

// ---------------- Liniile CF (date OSM) ----------------
// Liniile proiectate in zona peroanelor (offset local x constant). Valorile vin din osm.json (medie pe zona peroanelor).
export const TRACKS = [
  { id: 'L1', no: 1, x: 20.6, z0: -140, z1: 190, osm: 696406973, label: 'Linia 1', line: '517' },
  { id: 'L2', no: 2, x: 25.3, z0: -140, z1: 190, osm: 807803275, label: 'Linia 2', line: '500' },
  { id: 'L3', no: 3, x: 34.2, z0: -110, z1: 160, osm: 481440027, label: 'Linia 3', line: '500' },
  { id: 'L4', no: 4, x: 38.1, z0: -110, z1: 170, osm: 940006947, label: 'Linia 4', line: '606' },
  { id: 'L5', no: 5, x: 47.7, z0: -80, z1: 175, osm: 481440032, label: 'Linia 5', line: 'garare' },
  { id: 'L6', no: 6, x: 51.4, z0: -80, z1: 175, osm: 841790845, label: 'Linia 6', line: 'garare' },
];
export const RAIL_TOP = 0.5;      // cota ciupercii sinei
export const PLAT_Y = 1.05;       // peron inaltat 550 mm peste sina
export const PLATFORMS = [
  { id: 'P1', name: 'Peronul 1', x0: 9.8, x1: 18.95, z0: -110, z1: 170, tracks: ['L1'] },
  { id: 'P2', name: 'Peronul 2', x0: 26.95, x1: 32.55, z0: -100, z1: 180, tracks: ['L2', 'L3'] },
  { id: 'P3', name: 'Peronul 3', x0: 39.75, x1: 46.05, z0: -80, z1: 166, tracks: ['L4', 'L5'] },
];

export const lxAt = (L, lz) => {
  for (let i = 0; i < L.length - 1; i++) {
    const [x0, z0] = L[i], [x1, z1] = L[i + 1];
    if ((z0 - lz) * (z1 - lz) <= 0 && z0 !== z1) return x0 + ((x1 - x0) * (lz - z0)) / (z1 - z0);
  }
  return null;
};

// Aliniaza o polilinie (world) la offsetul proiectat in zona peroanelor, cu racordare lina.
export function snapToDesign(worldPts, track, blend = 70) {
  return worldPts.map(([x, z]) => {
    const [lx, lz] = toLocal(x, z);
    let w = 0;
    if (lz >= track.z0 && lz <= track.z1) w = 1;
    else {
      const d = lz < track.z0 ? track.z0 - lz : lz - track.z1;
      if (d < blend) w = 0.5 + 0.5 * Math.cos((Math.PI * d) / blend);
    }
    const nx = lx + (track.x - lx) * w;
    return toWorld(nx, lz);
  });
}

// Lipeste caile OSM conectate intr-un traseu continuu, pornind de la calea cea mai apropiata de offsetul dorit.
// Returneaza puncte world [[x,z],...] ordonate de la N la S (lz crescator), +-maxLen m fata de statie.
export function stitchRoute(rails, { x, lz = 20, maxLen = 1500, prefer = null }) {
  const ways = rails.filter((r) => r.k === 'rail' || r.k === 'light_rail');
  let seed = null, best = 1e9;
  for (const w of ways) {
    const L = w.p.map(([a, b]) => toLocal(a, b));
    const v = lxAt(L, lz);
    if (v == null) continue;
    const d = Math.abs(v - x) + (w.svc ? 0.8 : 0);
    if (d < best) { best = d; seed = w; }
  }
  if (!seed || best > 3) return null;
  const used = new Set([seed]);
  let pts = seed.p.map((p) => [p[0], p[1]]);
  // orientare N -> S
  if (toLocal(...pts[0])[1] > toLocal(...pts[pts.length - 1])[1]) pts.reverse();
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5;
  const dirOf = (p, q) => { const dx = q[0] - p[0], dz = q[1] - p[1]; const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const station = toWorld(x, lz);
  const distFromStation = (p) => Math.hypot(p[0] - station[0], p[1] - station[1]);

  function extend(atEnd) {
    for (let guard = 0; guard < 60; guard++) {
      const end = atEnd ? pts[pts.length - 1] : pts[0];
      const prev = atEnd ? pts[pts.length - 2] : pts[1];
      if (distFromStation(end) > maxLen) return;
      const d0 = dirOf(prev, end);
      let pick = null, pickScore = -1e9, pickPts = null;
      for (const w of ways) {
        if (used.has(w)) continue;
        let q = null;
        if (near(w.p[0], end)) q = w.p.map((p) => [p[0], p[1]]);
        else if (near(w.p[w.p.length - 1], end)) q = w.p.map((p) => [p[0], p[1]]).reverse();
        if (!q || q.length < 2) continue;
        const d1 = dirOf(q[0], q[1]);
        const cos = d0[0] * d1[0] + d0[1] * d1[1];
        if (cos < 0.9) continue;
        let score = cos * 10 - (w.svc ? 3 : 0) + (prefer && w.n === prefer ? 2 : 0);
        if (score > pickScore) { pickScore = score; pick = w; pickPts = q; }
      }
      if (!pick) return;
      used.add(pick);
      if (atEnd) pts = pts.concat(pickPts.slice(1));
      else pts = pickPts.slice(1).reverse().concat(pts);
    }
  }
  extend(true);
  extend(false);
  // taiem la +-maxLen (dupa distanta pe traseu)
  const out = [];
  for (const p of pts) if (distFromStation(p) <= maxLen + 200) out.push(p);
  return out.length > 1 ? out : null;
}
