import { ROUTE } from './route-data.js';

// Poligoane [x, z] (metri, coordonate lume) in care orasul NU trebuie sa deseneze cladirile din osm.json,
// pentru ca acolo trece linia T1 (verificat cu scripts/build-route.mjs fata de TOATE cladirile, inclusiv
// amprentele Microsoft ML adaugate ulterior, t: 'ms').
// Se folosesc la fel ca STATION_EXCLUDE (testul din city.js se face pe centroidul cladirii):
//   createCity(ctx, { exclude: [...STATION_EXCLUDE, ...TRANSIT_EXCLUDE] })
//
// Dreptunghiuri definite in sistemul local al garii (x spre linii, z de-a lungul axei 158,3°), ca in config/zones.js.
const B = (158.3 * Math.PI) / 180;
const A = { x: Math.sin(B), z: -Math.cos(B) };
const E = { x: A.z, z: -A.x };
const toWorld = (lx, lz) => [lx * E.x + lz * A.x, lx * E.z + lz * A.z];
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => toWorld(x, z).map((v) => Math.round(v * 10) / 10));

export const TRANSIT_EXCLUDE = [];

// Cladirile de pe platforma T1 (calculate de scripts/build-route.mjs, ROUTE.demolish = centroizi):
// in culoarul CF – magazii / anexe CFR dezafectate si amprente ML false (vagoane parcate detectate drept cladiri);
// pe camp, spre hub – cateva anexe gospodaresti (expropriere). Un patrat de 2 × 2 m in jurul centroidului ajunge.
// TRANSIT_DEMOLISH: centroizii [x, z] ai cladirilor demolate pentru T1 (orasul le arata doar in modul „Azi”).
export const TRANSIT_DEMOLISH = (ROUTE.demolish || []).map(([x, z]) => [x, z]);
for (const [cx, cz] of ROUTE.demolish || []) TRANSIT_EXCLUDE.push([[cx - 1, cz - 1], [cx + 1, cz - 1], [cx + 1, cz + 1], [cx - 1, cz + 1], [cx - 1, cz - 1]]);

// Hub Turbion A7×A8 (piata, cladirea, peroanele autocarelor, parcarea P+R si drumul de acces):
// dreptunghiul din hub.js (u -71…62 inapoi pe linie, v -19…161 spre stanga liniei), calculat din traseu.
{
  const P = ROUTE.pts;
  const hub = ROUTE.stops.find((s) => s.id === 'hub');
  if (hub) {
    const S = [0];
    for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const at = (s) => {
      let i = 0;
      while (i < P.length - 2 && S[i + 1] < s) i++;
      const f = Math.min(1, Math.max(0, (s - S[i]) / (S[i + 1] - S[i] || 1)));
      return [P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f];
    };
    const O = at(hub.s), a = at(hub.s - 3), b = at(hub.s + 3);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    // X = -tangenta, Z = -(dreapta) = (tz, -tx)  (ca in hub.js)
    const W = (u, v) => [O[0] - tx * u + tz * v, O[1] - tz * u - tx * v].map((c) => Math.round(c * 10) / 10);
    TRANSIT_EXCLUDE.push([W(-71, -19), W(62, -19), W(62, 161), W(-71, 161), W(-71, -19)]);
  }
}
