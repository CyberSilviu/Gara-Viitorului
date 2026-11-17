// Varianta de rezerva (cand Overpass e supraincarcat): descarca date din API-ul OSM 0.6 (/map) pe placi mici,
// le reasambleaza si scrie public/data/osm.json in acelasi format ca fetch-osm.mjs.
// Utilizare: node scripts/fetch-osm-api.mjs      Date © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN } from './geo-config.mjs';

const BBOX = { s: 47.19, w: 26.65, n: 47.28, e: 26.78 };
const STEP = 0.0225;
const CACHE = path.resolve('scripts/.osm-cache');
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tile(w, s, e, n) {
  const key = `${w.toFixed(4)}_${s.toFixed(4)}.json`;
  const f = path.join(CACHE, key);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'gara-viitorului-school-project/1.0' }, signal: AbortSignal.timeout(120000) });
      if (r.ok) { const t = await r.text(); fs.writeFileSync(f, t); return JSON.parse(t); }
      console.log('HTTP', r.status, key);
      if (r.status === 400) return null; // prea multe noduri
    } catch (err) { console.log('eroare', err.message); }
    await sleep(3000 * (i + 1));
  }
  return null;
}

const R = 6378137, lat0 = (ORIGIN.lat * Math.PI) / 180;
const project = (lat, lon) => [Math.round(((lon - ORIGIN.lon) * Math.PI) / 180 * R * Math.cos(lat0) * 10) / 10, Math.round(-((lat - ORIGIN.lat) * Math.PI) / 180 * R * 10) / 10];

function parseHeight(tags) {
  const h = parseFloat(tags.height); if (!Number.isNaN(h)) return h;
  const l = parseFloat(tags['building:levels']); if (!Number.isNaN(l)) return l * 3.1 + 1;
  const t = tags.building;
  if (['apartments', 'block'].includes(t)) return 13;
  if (['industrial', 'warehouse'].includes(t)) return 8;
  if (['church', 'cathedral'].includes(t)) return 16;
  if (['garage', 'garages', 'shed', 'roof', 'hut'].includes(t)) return 3;
  if (['commercial', 'retail', 'office', 'public', 'school', 'hospital', 'train_station'].includes(t)) return 9;
  return 5.5;
}

async function main() {
  const nodes = new Map(), ways = new Map(), rels = new Map();
  const tiles = [];
  for (let s = BBOX.s; s < BBOX.n - 1e-9; s += STEP) for (let w = BBOX.w; w < BBOX.e - 1e-9; w += STEP) tiles.push([w, s, Math.min(w + STEP, BBOX.e), Math.min(s + STEP, BBOX.n)]);
  let k = 0;
  for (const t of tiles) {
    let j = await tile(...t);
    if (!j) { // imparte in 4
      const [w, s, e, n] = t, mw = (w + e) / 2, ms = (s + n) / 2;
      for (const q of [[w, s, mw, ms], [mw, s, e, ms], [w, ms, mw, n], [mw, ms, e, n]]) {
        const jq = await tile(...q); if (jq) for (const el of jq.elements) add(el);
        await sleep(400);
      }
    } else for (const el of j.elements) add(el);
    process.stdout.write(`\rplaci ${++k}/${tiles.length} · noduri ${nodes.size} · cai ${ways.size}`);
    await sleep(500);
  }
  function add(el) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'way') ways.set(el.id, el);
    else if (el.type === 'relation') rels.set(el.id, el);
  }
  console.log();
  const geom = (w) => { const p = []; for (const id of w.nodes) { const n = nodes.get(id); if (!n) return null; p.push(project(n.lat, n.lon)); } return p; };

  const buildings = [], roads = [], rails = [], rivers = [], areas = [];
  const HW = /^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|service|living_street|pedestrian|construction|track|footway|steps)$/;
  const AREAS = /^(forest|grass|meadow|farmland|orchard|vineyard|residential|industrial|railway|cemetery|allotments|park|garden|pitch|stadium|wood|scrub|wetland)$/;
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (!w.tags) continue;
    const p = geom(w); if (!p || p.length < 2) continue;
    if (t.building) { if (p.length >= 4) buildings.push({ id: w.id, p, h: Math.round(parseHeight(t) * 10) / 10, t: t.building, n: t.name || undefined }); continue; }
    if (t.highway && HW.test(t.highway) && !['footway', 'steps', 'track'].includes(t.highway)) {
      roads.push({ id: w.id, p, k: t.highway, c: t.construction, ref: t.ref, n: t.name, lanes: t.lanes ? +t.lanes : undefined, br: t.bridge === 'yes' || undefined, L: t.layer ? +t.layer : undefined });
      continue;
    }
    if (t.railway && /^(rail|construction|proposed|platform)$/.test(t.railway)) { rails.push({ id: w.id, p, k: t.railway, svc: t.service, n: t.name, br: t.bridge === 'yes' || undefined, L: t.layer ? +t.layer : undefined }); continue; }
    if (t.waterway && /^(river|stream|canal)$/.test(t.waterway)) { rivers.push({ id: w.id, p, k: t.waterway, n: t.name }); continue; }
    if (p.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1]) {
      if (t.natural === 'water') areas.push({ p, k: 'water' });
      else { const kk = t.landuse || t.natural || t.leisure; if (kk && AREAS.test(kk)) areas.push({ p, k: kk === 'wood' ? 'forest' : kk }); }
    }
  }
  // multipoligoane: inele exterioare (cai inchise sau inlantuite simplu)
  for (const r of rels.values()) {
    const t = r.tags || {};
    if (t.type !== 'multipolygon') continue;
    const kind = t.building ? 'building' : t.natural === 'water' ? 'water' : t.landuse || t.natural || t.leisure;
    if (!kind) continue;
    for (const m of r.members) {
      if (m.type !== 'way' || m.role !== 'outer') continue;
      const w = ways.get(m.ref); if (!w) continue;
      if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
      const p = geom(w); if (!p || p.length < 4) continue;
      if (kind === 'building') buildings.push({ p, h: parseHeight(t), t: t.building });
      else if (kind === 'water' || AREAS.test(kind)) areas.push({ p, k: kind === 'wood' ? 'forest' : kind });
    }
  }
  const out = { attribution: 'Date © OpenStreetMap contributors (ODbL)', origin: ORIGIN, generated: new Date().toISOString(), source: 'OSM API 0.6 /map', bbox: BBOX, buildings, roads, rails, rivers, areas };
  fs.mkdirSync('public/data', { recursive: true });
  const tmp = path.resolve('public/data/osm.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, path.resolve('public/data/osm.json'));
  console.log(`Salvat: ${buildings.length} cladiri, ${roads.length} drumuri, ${rails.length} CF, ${rivers.length} rauri, ${areas.length} zone`);
}
main().catch((e) => { console.error(e); process.exit(1); });
