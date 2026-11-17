// Completeaza cladirile lipsa din OSM cu amprentele "Microsoft Global ML Building Footprints"
// (detectate automat din imagini satelitare, licenta ODbL). Se adauga doar cladirile care NU se
// suprapun peste o cladire OSM. Utilizare: node scripts/add-ms-buildings.mjs <fisier1.csv.gz> [fisier2...]
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';
import { ORIGIN } from './geo-config.mjs';

const BBOX = { s: 47.195, w: 26.655, n: 47.278, e: 26.775 };
const R = 6378137, lat0 = (ORIGIN.lat * Math.PI) / 180;
const project = (lat, lon) => [Math.round(((lon - ORIGIN.lon) * Math.PI) / 180 * R * Math.cos(lat0) * 10) / 10, Math.round(-((lat - ORIGIN.lat) * Math.PI) / 180 * R * 10) / 10];

function pip(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };

const osmPath = path.resolve('public/data/osm.json');
const osm = JSON.parse(fs.readFileSync(osmPath, 'utf8'));
const osmB = osm.buildings.filter((b) => b.t !== 'ms');
// grila spatiala pentru test rapid de suprapunere
const CELL = 50, grid = new Map();
const keyOf = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
for (const b of osmB) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of b.p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
    for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
      const k = `${gx},${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b.p);
    }
}
const overlapsOsm = (p) => {
  const pts = [...p, [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]];
  for (const [x, z] of pts) for (const poly of grid.get(keyOf(x, z)) || []) if (pip(x, z, poly)) return true;
  // si invers: un colt OSM in interiorul poligonului MS
  for (const [x, z] of p) for (const poly of grid.get(keyOf(x, z)) || []) for (const q of poly) if (pip(q[0], q[1], p)) return true;
  return false;
};

const added = [];
for (const file of process.argv.slice(2)) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let f; try { f = JSON.parse(line); } catch { continue; }
    const g = f.geometry; if (!g || g.type !== 'Polygon') continue;
    const ring = g.coordinates[0];
    const [lon0, lat0_] = ring[0];
    if (lat0_ < BBOX.s || lat0_ > BBOX.n || lon0 < BBOX.w || lon0 > BBOX.e) continue;
    const p = ring.map(([lon, lat]) => project(lat, lon));
    const a = area(p);
    if (a < 12 || a > 20000) continue;
    if (overlapsOsm(p)) continue;
    let h = f.properties && typeof f.properties.height === 'number' && f.properties.height > 0 ? f.properties.height : -1;
    if (h <= 0) h = a > 900 ? 9 : a > 350 ? 7.5 : a < 40 ? 3.2 : 5.5; // estimare dupa suprafata
    added.push({ p, h: Math.round(h * 10) / 10, t: 'ms' });
  }
}
osm.buildings = [...osmB, ...added];
osm.attribution = 'Date © OpenStreetMap contributors (ODbL); amprente clădiri suplimentare: Microsoft Global ML Building Footprints (ODbL)';
const tmp = osmPath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(osm));
fs.renameSync(tmp, osmPath);
console.log(`OSM: ${osmB.length} cladiri, adaugate din Microsoft: ${added.length}, total ${osm.buildings.length}`);
