// Descarca imaginile satelitare Sentinel-2 cloudless (EOX, stratul 2016 = CC BY 4.0) peste intinderea DEM.
// node scripts/fetch-satellite.mjs
// Rezultat: public/data/sat/{z}/{x}/{y}.jpg + public/data/sat/manifest.json
// Atribuire: "Sentinel-2 cloudless – s2maps.eu, EOX IT Services GmbH (date Copernicus Sentinel 2016 modificate)"
// (Imaginile Esri de inalta rezolutie NU se descarca aici – se incarca doar la rulare, conform termenilor Esri.)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'sat');
const URL_T = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
const UA = 'gara-viitorului-school-project/1.0';
const MAX_TILES = 250;

// aceeasi proiectie ca src/core/geo.js
const ORIGIN = { lat: 47.25689, lon: 26.72403 };
const R = 6378137, lat0 = (ORIGIN.lat * Math.PI) / 180;
const unproject = (x, z) => ({
  lat: ORIGIN.lat + (-z / R) * (180 / Math.PI),
  lon: ORIGIN.lon + (x / (R * Math.cos(lat0))) * (180 / Math.PI),
});
const lon2tx = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2ty = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };

const dem = JSON.parse(await fs.readFile(path.join(ROOT, 'public', 'data', 'dem.json'), 'utf8'));
const nw = unproject(dem.minX, dem.minZ), se = unproject(dem.maxX, dem.maxZ);
const bbox = { west: nw.lon, east: se.lon, north: nw.lat, south: se.lat };

function range(z) {
  const x0 = Math.floor(lon2tx(bbox.west, z)), x1 = Math.floor(lon2tx(bbox.east, z));
  const y0 = Math.floor(lat2ty(bbox.north, z)), y1 = Math.floor(lat2ty(bbox.south, z));
  return { z, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

const levels = [range(13)];
const r14 = range(14);
if (levels[0].count + r14.count <= MAX_TILES) levels.push(r14);
console.log('bbox', bbox, levels.map((l) => `z${l.z}: ${l.count} dale`).join(', '));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      console.warn('HTTP', r.status, url);
    } catch (e) { console.warn('eroare', e.message); }
    await sleep(1000 * (a + 1));
  }
  throw new Error('nu pot descarca ' + url);
}

let n = 0;
for (const L of levels) {
  for (let x = L.x0; x <= L.x1; x++) for (let y = L.y0; y <= L.y1; y++) {
    const f = path.join(OUT, String(L.z), String(x), `${y}.jpg`);
    try { await fs.access(f); continue; } catch { /* lipseste */ }
    await fs.mkdir(path.dirname(f), { recursive: true });
    const t0 = Date.now();
    await fs.writeFile(f, await get(URL_T.replace('{z}', L.z).replace('{x}', x).replace('{y}', y)));
    n++;
    await sleep(Math.max(0, 220 - (Date.now() - t0))); // < 5 cereri / s
  }
}

const manifest = {
  source: 'Sentinel-2 cloudless 2016 (EOX, s2cloudless_3857)',
  license: 'CC BY 4.0',
  attribution: 'Sentinel-2 cloudless – s2maps.eu, EOX IT Services GmbH (date Copernicus Sentinel 2016 modificate)',
  tileSize: 256,
  bbox,
  levels: levels.map(({ z, x0, x1, y0, y1 }) => ({ z, x0, x1, y0, y1 })),
};
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`gata: ${n} dale noi`, manifest.levels);
