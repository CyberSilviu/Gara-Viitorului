// Descarca date OpenStreetMap (cladiri, drumuri, cai ferate, ape, vegetatie)
// pentru zona Pascani + nodul A7/A8 si le converteste in coordonate locale (metri).
// Utilizare: node scripts/fetch-osm.mjs
// Date © OpenStreetMap contributors, licenta ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN, BBOX_CITY, BBOX_CORRIDOR } from './geo-config.mjs';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  let wait = 4000;
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'gara-viitorului-school-project/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(200000),
      });
      if (res.ok) {
        const j = await res.json();
        console.log(`[${label}] ${j.elements.length} elemente de la ${url}`);
        return j;
      }
      console.log(`[${label}] HTTP ${res.status} de la ${url}, reincerc in ${wait / 1000}s`);
    } catch (e) {
      console.log(`[${label}] eroare ${e.message} de la ${url}`);
    }
    await sleep(wait);
    wait = Math.min(wait * 1.6, 40000);
  }
  throw new Error('Overpass indisponibil pentru ' + label);
}

const R = 6378137;
const lat0 = (ORIGIN.lat * Math.PI) / 180;
function project(lat, lon) {
  const x = ((lon - ORIGIN.lon) * Math.PI) / 180 * R * Math.cos(lat0);
  const n = ((lat - ORIGIN.lat) * Math.PI) / 180 * R;
  return [Math.round(x * 10) / 10, Math.round(-n * 10) / 10]; // [x, z] three.js (-z = nord)
}

const bb = (b) => `${b.s},${b.w},${b.n},${b.e}`;

function parseHeight(tags) {
  const h = parseFloat(tags.height);
  if (!Number.isNaN(h)) return h;
  const l = parseFloat(tags['building:levels']);
  if (!Number.isNaN(l)) return l * 3.1 + 1;
  const t = tags.building;
  if (['apartments', 'block'].includes(t)) return 13;
  if (['industrial', 'warehouse'].includes(t)) return 8;
  if (['church', 'cathedral'].includes(t)) return 16;
  if (['garage', 'garages', 'shed', 'roof', 'hut'].includes(t)) return 3;
  if (['commercial', 'retail', 'office', 'public', 'school', 'hospital', 'train_station'].includes(t)) return 9;
  return 5.5;
}

function waysWithGeom(json) {
  return json.elements.filter((e) => e.type === 'way' && e.geometry);
}

function relOuterRings(json) {
  const rings = [];
  for (const e of json.elements) {
    if (e.type !== 'relation' || !e.members) continue;
    for (const m of e.members) {
      if (m.role === 'outer' && m.geometry) rings.push({ tags: e.tags || {}, geometry: m.geometry });
    }
  }
  return rings;
}

const pts = (geom) => geom.map((g) => project(g.lat, g.lon));

async function main() {
  const city = bb(BBOX_CITY);
  const corr = bb(BBOX_CORRIDOR);

  const qBuild = `[out:json][timeout:180];(way["building"](${city});relation["building"](${city}););out geom tags;`;
  const qLines = `[out:json][timeout:180];(
    way["highway"~"motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|tertiary|residential|unclassified|service|living_street|pedestrian"](${city});
    way["highway"~"motorway|motorway_link|trunk|primary|secondary|tertiary"](${corr});
    way["highway"="construction"](${corr});
    way["construction"~"motorway|motorway_link"](${corr});
    way["railway"~"rail|construction|proposed|platform"](${corr});
    way["waterway"~"river|stream|canal"](${corr});
  );out geom tags;`;
  const qAreas = `[out:json][timeout:180];(
    way["natural"="water"](${corr});relation["natural"="water"](${corr});
    way["landuse"~"forest|grass|meadow|farmland|orchard|vineyard|residential|industrial|railway|cemetery|allotments"](${city});
    way["natural"~"wood|scrub|wetland"](${corr});
    way["leisure"~"park|garden|pitch|stadium"](${city});
    way["landuse"="forest"](${corr});
  );out geom tags;`;

  const jb = await overpass(qBuild, 'cladiri');
  await sleep(3000);
  const jl = await overpass(qLines, 'linii');
  await sleep(3000);
  const ja = await overpass(qAreas, 'zone');

  const buildings = [];
  for (const w of waysWithGeom(jb)) {
    const p = pts(w.geometry);
    if (p.length < 4) continue;
    buildings.push({ id: w.id, p, h: Math.round(parseHeight(w.tags || {}) * 10) / 10, t: w.tags.building, n: w.tags.name || undefined });
  }
  for (const r of relOuterRings(jb)) {
    const p = pts(r.geometry);
    if (p.length < 4) continue;
    buildings.push({ p, h: parseHeight(r.tags), t: r.tags.building, n: r.tags.name || undefined });
  }

  const roads = [], rails = [], rivers = [];
  for (const w of waysWithGeom(jl)) {
    const t = w.tags || {};
    const p = pts(w.geometry);
    if (t.highway) roads.push({ id: w.id, p, k: t.highway, c: t.construction, ref: t.ref, n: t.name, lanes: t.lanes ? +t.lanes : undefined, br: t.bridge === 'yes' || undefined, L: t.layer ? +t.layer : undefined });
    else if (t.railway) rails.push({ id: w.id, p, k: t.railway, svc: t.service, n: t.name, br: t.bridge === 'yes' || undefined, L: t.layer ? +t.layer : undefined });
    else if (t.waterway) rivers.push({ id: w.id, p, k: t.waterway, n: t.name });
  }

  const areas = [];
  for (const w of waysWithGeom(ja)) {
    const t = w.tags || {};
    const k = t.natural === 'water' ? 'water' : t.landuse || t.natural || t.leisure;
    areas.push({ p: pts(w.geometry), k });
  }
  for (const r of relOuterRings(ja)) {
    const k = r.tags.natural === 'water' ? 'water' : r.tags.landuse || r.tags.natural || r.tags.leisure;
    areas.push({ p: pts(r.geometry), k });
  }

  const out = {
    attribution: 'Date © OpenStreetMap contributors (ODbL)',
    origin: ORIGIN,
    generated: new Date().toISOString(),
    buildings, roads, rails, rivers, areas,
  };
  const dir = path.resolve('public/data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'osm.json'), JSON.stringify(out));
  console.log(`Salvat: ${buildings.length} cladiri, ${roads.length} drumuri, ${rails.length} linii CF, ${rivers.length} rauri, ${areas.length} zone`);
}

main().catch((e) => { console.error(e); process.exit(1); });
