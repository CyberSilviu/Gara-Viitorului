// Descarca altitudinile reale (SRTM 30 m) pe o grila peste coridorul gara -> nod A7/A8
// prin OpenTopoData (https://www.opentopodata.org), apoi salveaza public/data/dem.json.
// Utilizare: node scripts/fetch-dem.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN, BBOX_CORRIDOR } from './geo-config.mjs';

const NX = 72, NZ = 72; // grila
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6378137, lat0 = (ORIGIN.lat * Math.PI) / 180;
const project = (lat, lon) => [((lon - ORIGIN.lon) * Math.PI) / 180 * R * Math.cos(lat0), -((lat - ORIGIN.lat) * Math.PI) / 180 * R];

async function main() {
  const b = BBOX_CORRIDOR;
  const pts = [];
  for (let j = 0; j < NZ; j++) {
    const lat = b.n - ((b.n - b.s) * j) / (NZ - 1); // j=0 nord (z minim)
    for (let i = 0; i < NX; i++) {
      const lon = b.w + ((b.e - b.w) * i) / (NX - 1);
      pts.push([lat, lon]);
    }
  }
  const heights = new Array(pts.length).fill(0);
  for (let k = 0; k < pts.length; k += 100) {
    const chunk = pts.slice(k, k + 100);
    const loc = chunk.map(([a, o]) => `${a.toFixed(5)},${o.toFixed(5)}`).join('|');
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${loc}`, { headers: { 'User-Agent': 'gara-viitorului-school-project/1.0' } });
        if (r.ok) {
          const j = await r.json();
          j.results.forEach((res, idx) => { heights[k + idx] = res.elevation ?? 0; });
          break;
        }
        console.log('HTTP', r.status, 'reincerc');
      } catch (e) { console.log('eroare', e.message); }
      await sleep(2500 * (attempt + 1));
    }
    process.stdout.write(`\r${Math.min(k + 100, pts.length)}/${pts.length}`);
    await sleep(1100);
  }
  const [x0, z0] = project(b.n, b.w);
  const [x1, z1] = project(b.s, b.e);
  const out = {
    source: 'SRTM 30m via OpenTopoData',
    nx: NX, nz: NZ, minX: x0, minZ: z0, maxX: x1, maxZ: z1,
    // altitudinea originii (gara) pentru referinta
    heights: heights.map((h) => Math.round(h * 10) / 10),
  };
  fs.mkdirSync('public/data', { recursive: true });
  fs.writeFileSync(path.resolve('public/data/dem.json'), JSON.stringify(out));
  console.log('\nSalvat DEM', NX, 'x', NZ, 'min', Math.min(...heights), 'max', Math.max(...heights));
}
main();
