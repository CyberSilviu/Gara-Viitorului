// Audit coliziuni intre obiectele generate (TO-DO 5).
// Construieste in Node scena REALA (teren, oras, gara, transport) cu DOM/canvas simulate, apoi verifica in plan (XZ)
// suprapunerile dintre: cladiri, drumuri, CF, linia T1, apa, pile, copaci, mobilier urban si traseele vehiculelor.
// Doua obiecte se ciocnesc doar daca sunt vizibile in acelasi mod (Azi / Viitor) – vizibilitatea se citeste din scena
// dupa apelarea ctx.futureToggles.
// Rulare: npm run audit   (optiuni: --json  => raport JSON;  --max=N exemple pe categorie)
import './audit-stub.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const U = (p) => pathToFileURL(path.join(ROOT, p)).href;
const THREE = await import(U('node_modules/three/build/three.module.js'));
const geo = await import(U('src/core/geo.js'));
const { SegmentIndex } = await import(U('src/core/util.js'));
const { createTerrain } = await import(U('src/core/terrain.js'));
const { createCity } = await import(U('src/core/city.js'));
const { STATION_EXCLUDE } = await import(U('src/config/zones.js'));
const { TRANSIT_EXCLUDE } = await import(U('src/transit/exclude.js'));
const { ROUTE } = await import(U('src/transit/route-data.js'));
const { TRACK_HALF } = await import(U('src/transit/route.js'));
const { DECK } = await import(U('src/transit/mw-levels.js'));

const ARGS = process.argv.slice(2);
const MAX = +(ARGS.find((a) => a.startsWith('--max='))?.slice(6) || 10);
const quiet = console.info;
console.info = () => {}; console.warn = () => {};

// ---------------- construim scena ----------------
const scene = new THREE.Scene();
const updates = [];
const ctx = {
  THREE, scene, camera: new THREE.PerspectiveCamera(), raycaster: new THREE.Raycaster(), geo,
  addUpdate: (f) => updates.push(f), colliders: [], walkables: [], places: [], tourSteps: [], mapLayers: [], mapMarkers: [], mapLive: [], mapFit: [], futureToggles: [], routeToggles: [],
  toast() {}, env: { hour: 11, night: 0, onChange(fn) { fn({ hour: 11, night: 0 }); }, isNight: () => false },
  hotspots: { list: [], add(h) { this.list.push(h); return h; }, open() {} },
  controls: { mode: 'orbit', setMode() {}, flyTo() {}, orbit: { target: new THREE.Vector3(), update() {} } },
};
const t0 = Date.now();
ctx.terrain = await createTerrain(ctx);
ctx.city = await createCity(ctx, { exclude: [...STATION_EXCLUDE, ...TRANSIT_EXCLUDE] });
try { ctx.people = (await import(U('src/core/people.js'))).createPeople(ctx); } catch (e) { console.error('Persoane:', e.message); } // ca in main.js: inainte de gara / transport
try { ctx.station = await (await import(U('src/station/index.js'))).build(ctx); } catch (e) { console.error('Gara:', e.message); }
try { ctx.transit = await (await import(U('src/transit/index.js'))).build(ctx); } catch (e) { console.error('Transport:', e.message); }
if (ctx.people) {
  ctx.people.runDeferred();
  try { if (ctx.transit?.route) ctx.people.populateRouteStops(ctx.transit.route, { props: ctx.transit.stops?.props }); } catch (e) { console.error('Persoane T1:', e.message); }
}
scene.updateMatrixWorld(true);
const buildMs = Date.now() - t0;

// ---------------- vizibilitate Azi / Viitor ----------------
const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const MODES = {};
for (const [mode, on] of [['azi', false], ['viitor', true]]) {
  for (const f of ctx.futureToggles) { try { f(on); } catch (e) { /* */ } }
  const s = new Set();
  scene.traverse((o) => { if (visible(o)) s.add(o); });
  MODES[mode] = s;
}
const modesOf = (o) => (MODES.azi.has(o) ? 1 : 0) | (MODES.viitor.has(o) ? 2 : 0); // bit 1 = Azi, bit 2 = Viitor
const objPath = (o) => { const a = []; for (let p = o; p && p !== scene; p = p.parent) a.unshift(p.name || p.type); return a.join('/'); };
const BOTH = 3;

// ---------------- geometrie 2D ----------------
const d2seg = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
const pip = (x, z, p) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
// distanta cu semn de la punct la poligon (<0 = in interior)
const sdPoly = (x, z, p) => {
  let d = Infinity;
  for (let i = 0; i < p.length - 1; i++) d = Math.min(d, d2seg(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
  return pip(x, z, p) ? -d : d;
};
const segX = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};
// distanta segment–poligon (0 daca se intersecteaza / segmentul e in interior)
const dSegPoly = (ax, az, bx, bz, p) => {
  if (pip(ax, az, p) || pip(bx, bz, p)) return 0;
  let d = Infinity;
  for (let i = 0; i < p.length - 1; i++) {
    const [cx, cz] = p[i], [ex, ez] = p[i + 1];
    if (segX([ax, az], [bx, bz], [cx, cz], [ex, ez])) return 0;
    d = Math.min(d, d2seg(ax, az, cx, cz, ex, ez), d2seg(ex, ez, ax, az, bx, bz), d2seg(cx, cz, ax, az, bx, bz));
  }
  return d;
};
const bbox = (p) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of p) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); } return [a, b, c, d]; };

// ---------------- obstacole „liniare” (benzi) ----------------
// fiecare banda: SegmentIndex cu r = semilatimea desenata; tag = obiect {kind, id, modes}
// SegmentIndex.query primeste {minX,minZ,maxX,maxZ}; aici folosim si [x0,z0,x1,z1] (fara adaptor, interogarile nu gaseau nimic)
const bbq = (idx) => { const q = idx.query.bind(idx); idx.query = (b, fn) => q(Array.isArray(b) ? { minX: b[0], minZ: b[1], maxX: b[2], maxZ: b[3] } : b, fn); return idx; };
function band(name) { return { name, idx: bbq(new SegmentIndex(40)), list: [] }; }
const ROADS = band('drum'); // carosabil (fara poduri)
const DECKS = band('pod');  // tabliere de pod rutier (doar pt copaci/cladiri sub pod)
for (const r of ctx.city.roads) {
  if (r.k === 'construction') continue; // panglicile „in constructie” sunt ascunse de motorway.js si inlocuite de MW (A7/A8 + drumurile noi, cu cota)
  const b = r.bridge ? DECKS : ROADS;
  const tag = { kind: r.bridge ? 'pod' : 'drum', id: r.id, k: r.k, n: r.name || r.ref || '', modes: BOTH };
  for (let i = 0; i < r.pts.length - 1; i++) b.idx.add(r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], r.width / 2, tag);
}
const RAILS = band('cf');
const RAIL_R = 1.6; // jumatate din latimea traverselor + balast
for (const s of ctx.city.railIndex.segs) RAILS.idx.add(s.ax ?? s[0], s.az ?? s[1], s.bx ?? s[2], s.bz ?? s[3], RAIL_R, { kind: 'cf', id: 'cf', modes: BOTH });
const T1 = band('t1');   // platforma desenata (gazon / balast): TRACK_HALF*ramp(s) + 1,75 (track.js)
const T1E = band('t1-gabarit'); // gabaritul vehiculului: TRACK_HALF*ramp(s) + 1,33 + 0,12 garda
const RT = ctx.transit?.route;
if (RT) {
  const ax = RT.samples(0, RT.length, 4);
  for (let i = 0; i < ax.length - 1; i++) {
    const p = ax[i], q = ax[i + 1], s = (p.s + q.s) / 2, rr = TRACK_HALF * RT.laneRamp(s);
    const tag = { kind: 't1', id: 'T1', modes: 2, s, y: (p.y + q.y) / 2 };
    T1.idx.add(p.x, p.z, q.x, q.z, rr + 1.75, tag);
    T1E.idx.add(p.x, p.z, q.x, q.z, rr + 1.45, tag);
  }
} else T1.idx.addPolyline(ROUTE.pts, 3.4, { kind: 't1', id: 'T1', modes: 2 });
const WATER = ctx.city.waterIndex;

// cauta cea mai „adanca” intrare a unui punct (raza rad) intr-o banda: intoarce {pen, tag} sau null
function bandHitPoint(B, x, z, rad, modes, tol = 0) {
  let best = null;
  B.idx.query([x - rad - 20, z - rad - 20, x + rad + 20, z + rad + 20], (s) => {
    if (!(s.tag.modes & modes)) return;
    const pen = s.r + rad - d2seg(x, z, s.ax, s.az, s.bx, s.bz);
    if (pen > tol && (!best || pen > best.pen)) best = { pen, tag: s.tag };
  });
  return best;
}
function bandHitPoly(B, p, modes, tol = 0) {
  const bb = bbox(p);
  let best = null;
  B.idx.query([bb[0] - 20, bb[1] - 20, bb[2] + 20, bb[3] + 20], (s) => {
    if (!(s.tag.modes & modes)) return;
    const pen = s.r - dSegPoly(s.ax, s.az, s.bx, s.bz, p);
    if (pen > tol && (!best || pen > best.pen)) best = { pen, tag: s.tag };
  });
  return best;
}

// ---------------- cladiri ----------------
const BLD = [];
const fpKey = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
const drawn = new Set();
ctx.city.footprints.forEach((f, i) => { BLD.push({ id: 'b' + i, n: f.n || '', p: f.p, cx: f.cx, cz: f.cz, h: f.h, modes: BOTH }); drawn.add(fpKey(f.cx, f.cz)); });
// cladirile inlocuite de proiect (desenate doar in „Azi”): cele care cad in zonele excluse
{
  const ex = [...STATION_EXCLUDE, ...TRANSIT_EXCLUDE].map((e) => (Array.isArray(e) ? e : e.p || e.poly || e)).filter((e) => Array.isArray(e) && e.length >= 3);
  for (const b of ctx.city.osm.buildings || []) {
    const p = b.p; if (!p || p.length < 4) continue;
    let cx = 0, cz = 0; for (const [x, z] of p) { cx += x; cz += z; } cx /= p.length; cz /= p.length;
    if (!ex.some((e) => pip(cx, cz, e) || p.some(([x, z]) => pip(x, z, e)))) continue;
    BLD.push({ id: 'osm' + (b.id ?? ''), n: b.n || '', p, cx, cz, h: b.h, modes: 1, azi: true });
  }
}
const bldGrid = new Map(); const BC = 50;
for (const b of BLD) { const bb = bbox(b.p); b.bb = bb; for (let gx = Math.floor(bb[0] / BC); gx <= Math.floor(bb[2] / BC); gx++) for (let gz = Math.floor(bb[1] / BC); gz <= Math.floor(bb[3] / BC); gz++) { const k = gx + ',' + gz; if (!bldGrid.has(k)) bldGrid.set(k, []); bldGrid.get(k).push(b); } }
function bldAt(x, z, rad, modes) { // cladirea in care intra punctul (raza rad): {pen, b}
  const l = bldGrid.get(Math.floor(x / BC) + ',' + Math.floor(z / BC)) || [];
  let best = null;
  for (const b of l) {
    if (!(b.modes & modes)) continue;
    if (x < b.bb[0] - rad || x > b.bb[2] + rad || z < b.bb[1] - rad || z > b.bb[3] + rad) continue;
    const pen = rad - sdPoly(x, z, b.p);
    if (pen > 0 && (!best || pen > best.pen)) best = { pen, b };
  }
  return best;
}

// ---------------- obiecte punctuale din scena (InstancedMesh) ----------------
const CLASS = [
  [/copaci-|\/arbori:a$|hub-turbion\/Mesh$/, 'copac', 0.45],
  [/t1-pile$|pile-pasaje$/, 'pila', null],
  [/banci-peron:a$|banci-piata:a$|scaune-autogara:a$|cosuri-|stalpi-piata:a$|stalpi-azi:a$|stalpi-peron-azi$|statii-ev$|docuri-bike$|coloane-sos:a$|iluminat-nod$|masini-parcate:body$|masini-ev-taxi:body$/, 'mobilier', null],
];
const PTS = [];
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
scene.traverse((o) => {
  if (!o.isInstancedMesh) return;
  const ph = objPath(o);
  const c = CLASS.find(([re]) => re.test(ph));
  if (!c) return;
  const modes = modesOf(o);
  if (!modes) return;
  o.geometry.computeBoundingBox();
  const gb = o.geometry.boundingBox;
  const seen = new Set();
  for (let i = 0; i < o.count; i++) {
    o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld); _m.decompose(_p, _q, _s);
    const key = fpKey(_p.x, _p.z); if (seen.has(key)) continue; seen.add(key);
    const rad = c[2] ?? Math.max(0.2, 0.5 * Math.min((gb.max.x - gb.min.x) * _s.x, (gb.max.z - gb.min.z) * _s.z));
    PTS.push({ kind: c[1], src: ph.replace(/:(a|body)$/, ''), i, x: _p.x, y: _p.y, z: _p.z, top: _p.y + gb.max.y * _s.y, rad, modes });
  }
});
for (const p of ctx.city.bridgePiers || []) PTS.push({ kind: 'pila', src: 'pod-' + p.id, i: p.d, x: p.x, z: p.z, rad: 0.9, modes: BOTH });
const byKind = (k) => PTS.filter((p) => p.kind === k);

// ---------------- verificari ----------------
const R = new Map(); // categorie -> lista {pen, msg}
// date OSM × date OSM (cladire peste un drum OSM a carui latime e estimata): informativ, nu intra in total
const NOTE = new Map();
const note = (cat, pen, msg) => { if (!NOTE.has(cat)) NOTE.set(cat, []); NOTE.get(cat).push({ pen, msg }); };
const hit = (cat, pen, msg) => { if (!R.has(cat)) R.set(cat, []); R.get(cat).push({ pen, msg }); };
const f1 = (v) => v.toFixed(1);
const at = (x, z) => `(${f1(x)}, ${f1(z)})`;
const md = (m) => (m === 1 ? 'Azi' : m === 2 ? 'Viitor' : 'Azi+Viitor');
const TOL = +(ARGS.find((a) => a.startsWith('--tol='))?.slice(6) ?? 0.25); // suprapuneri sub 25 cm sunt ignorate (--tol=-1 => si distante libere sub 1 m)

// 1) cladiri
for (const b of BLD) {
  const name = `${b.id}${b.n ? ' „' + b.n + '”' : ''}${b.azi ? ' [Azi]' : ''}`;
  let h;
  if ((h = bandHitPoly(ROADS, b.p, b.modes, TOL))) note('cladire OSM × drum OSM', h.pen, `${name} @${at(b.cx, b.cz)} intra ${f1(h.pen)} m in drumul ${h.tag.id} ${h.tag.k} ${h.tag.n}`);
  if ((h = bandHitPoly(DECKS, b.p, b.modes, TOL))) hit('cladire × pod rutier', h.pen, `${name} @${at(b.cx, b.cz)} sub podul ${h.tag.id} ${h.tag.n} (${f1(h.pen)} m)`);
  if ((h = bandHitPoly(RAILS, b.p, b.modes, TOL))) hit('cladire × CF', h.pen, `${name} @${at(b.cx, b.cz)} pe calea ferata (${f1(h.pen)} m)`);
  if ((h = bandHitPoly(T1, b.p, b.modes, TOL))) hit('cladire × T1', h.pen, `${name} @${at(b.cx, b.cz)} pe platforma T1 (${f1(h.pen)} m)`);
}
// 2) copaci, mobilier, pile
const checkPoint = (p, label) => {
  const tgt = p.kind;
  let h;
  const tag = `${label} ${p.src}#${p.i} @${at(p.x, p.z)} [${md(p.modes)}]`;
  if ((h = bandHitPoint(ROADS, p.x, p.z, p.rad, p.modes, TOL))) hit(`${tgt} × drum`, h.pen, `${tag} pe drumul ${h.tag.id} ${h.tag.k} ${h.tag.n} (${f1(h.pen)} m)`);
  if ((h = bandHitPoint(RAILS, p.x, p.z, p.rad, p.modes, TOL))) hit(`${tgt} × CF`, h.pen, `${tag} pe calea ferata (${f1(h.pen)} m)`);
  if (!/t1-pile/.test(p.src) && (h = bandHitPoint(T1, p.x, p.z, p.rad, p.modes, TOL))) hit(`${tgt} × T1`, h.pen, `${tag} pe platforma T1 (${f1(h.pen)} m)`);
  if (WATER.nearest(p.x, p.z, p.rad + 30)?.d < p.rad) hit(`${tgt} × apa`, p.rad, `${tag} in rau`);
  if (tgt !== 'pila' && (h = bldAt(p.x, p.z, p.rad, p.modes)) && h.pen > TOL) hit(`${tgt} × cladire`, h.pen, `${tag} in cladirea ${h.b.id} ${h.b.n} (${f1(h.pen)} m)`);
  if (tgt === 'copac' && (h = bandHitPoint(DECKS, p.x, p.z, 2.5, p.modes, TOL))) hit('copac × pod rutier', h.pen, `${tag} sub/prin podul ${h.tag.id} ${h.tag.n}`);
  if (tgt === 'pila' && (h = bldAt(p.x, p.z, p.rad, p.modes)) && h.pen > TOL) hit('pila × cladire', h.pen, `${tag} in cladirea ${h.b.id} ${h.b.n} (${f1(h.pen)} m)`);
};
for (const p of PTS) checkPoint(p, p.kind);
// pile de pod: pe drum e normal doar daca e pila podului ce trece peste acel drum — raportam doar adancimea > 1 m
// 3) mobilier/copaci × alte obiecte punctuale (copac prin banca etc.)
{
  const grid = new Map(); const C = 6;
  for (const p of PTS) { const k = Math.floor(p.x / C) + ',' + Math.floor(p.z / C); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  for (const a of PTS) {
    if (a.kind === 'copac' && a.src.startsWith('oras-osm')) continue; // copacii de padure intre ei: nu conteaza
    const gx = Math.floor(a.x / C), gz = Math.floor(a.z / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of grid.get(gx + i + ',' + (gz + j)) || []) {
      if (b === a || b.src === a.src || !(a.modes & b.modes)) continue;
      if (a.kind > b.kind || (a.kind === b.kind && (a.src > b.src || (a.src === b.src && a.i > b.i)))) continue;
      const pen = a.rad + b.rad - Math.hypot(a.x - b.x, a.z - b.z);
      if (pen > TOL) hit(`${a.kind} × ${b.kind}`, pen, `${a.src}#${a.i} @${at(a.x, a.z)} × ${b.src}#${b.i} @${at(b.x, b.z)} (${f1(pen)} m)`);
    }
  }
}
// 3b) obiecte construite ale proiectului (TO-DO 5, trecerea finala):
//   - cutiile de coliziune ale garii (Phys din src/station/builder.js) si ale hub-ului / statiilor T1
//   - placile / cladirea / acoperisul hub-ului
//   - A7/A8 + bretele (motorway.ways, cota Y reala) si drumurile din hub-link.js (acces, brate, inel), ca benzi
const H = (x, z) => ctx.terrain.heightAt(x, z);
const hull = (pts) => { // infasuratoare convexa (monotone chain), inchisa
  const p = [...new Map(pts.map((q) => [Math.round(q[0] * 100) + ',' + Math.round(q[1] * 100), q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return null;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  return h.length >= 3 ? [...h, h[0]] : null;
};
// adancimea suprapunerii a doua poligoane (aprox.: cel mai adanc varf al unuia in celalalt; muchii care se taie => 0,3)
const polyPen = (a, b) => {
  let pen = 0;
  for (const [x, z] of a) pen = Math.max(pen, -sdPoly(x, z, b));
  for (const [x, z] of b) pen = Math.max(pen, -sdPoly(x, z, a));
  if (pen > 0) return pen;
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) if (segX(a[i], a[i + 1], b[j], b[j + 1])) return 0.3;
  return 0;
};
const BOX = [];
{
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const ph = objPath(o);
    // cutiile de coliziune (Phys, invisibleBox) si cutiile vizibile ale garii / hub-ului (Batch: pereti, copertine, sticla)
    const col = /coliziuni/.test(ph) || o.material?.name === 'coliziune';
    const vis = !col && /^(gara-viitorului|hub-turbion)\//.test(ph) && !/:podele$|semne|litere|ceas|vagon|usi[+-]|autobuz/.test(ph);
    if (!col && !vis) return;
    const modes = modesOf(o) || (col && ctx.colliders.includes(o) ? 2 : 0);
    if (!modes) return;
    const pos = o.geometry.attributes.position, ix = o.geometry.index;
    const per = ix ? 24 : 36, n = pos.count; // BoxGeometry indexata: 24 varfuri; normalizata (Batch / Phys): 36
    const chunks = [];
    for (let k = 0; k + per <= n && n % per === 0; k += per) {
      const xz = []; let y0 = Infinity, y1 = -Infinity;
      for (let i = k; i < k + per; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); xz.push([v.x, v.z]); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      if (vis && (new Set(Array.from({ length: per }, (_, q) => { v.fromBufferAttribute(pos, k + q); return `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`; })).size !== 8)) { chunks.length = 0; break; } // nu e (numai) cutii
      chunks.push({ xz, y0, y1, k: k / per });
    }
    if (ARGS.includes('--debug')) quiet(`${col ? 'coliziuni' : 'vizibil'}: ${ph} ${n} varfuri -> ${chunks.length} cutii [${md(modes)}]`);
    for (const { xz, y0, y1, k } of chunks) {
      if (vis && y1 - y0 < 0.25) continue; // placi / dale subtiri la sol: nu sunt obstacole
      const p = hull(xz); if (!p) continue;
      const bb = bbox(p); let cx = 0, cz = 0; for (const q of p.slice(0, -1)) { cx += q[0]; cz += q[1]; } cx /= p.length - 1; cz /= p.length - 1;
      BOX.push({ src: ph.replace(/^gara-viitorului\//, 'gara/'), i: k, p, bb, cx, cz, y0, y1, modes, hub: /hub/.test(ph), vis });
    }
  });
}
const HUBP = [];
const hub = ctx.transit?.hub;
if (hub) {
  const q = (u0, u1, v0, v1, y0, y1, n) => { const c = [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]].map(([u, w]) => { const t = hub.toWorld(u, 0, w); return [t.x, t.z]; }); HUBP.push({ n, p: c, bb: bbox(c), y0, y1 }); };
  const yb = hub.levelB, yp = hub.levelP;
  q(-62, 62, 5.2, 93, yb - 6, yb, 'placa piata hub'); // placile hub-ului sunt pline pana la teren (rambleu / structura)
  q(-62, 62, 93, 160, yp - 6, yp, 'placa parcare P+R');
  q(-42, 34, 12, 46, yb, yb + 10.5, 'cladirea hub');
  q(-58, 46, -9, 60, hub.roofY - 0.7, hub.roofY, 'acoperis solar hub');
}
// benzi cu cota: drumuri noi (A7/A8, bretele, hub-link)
const MW = band('a7a8'), HL = band('hub-link');
const mw = ctx.transit?.motorway;
for (const w of mw?.ways || []) {
  if (w.tunnel) continue;
  for (let i = 0; i < w.pts.length - 1; i++) {
    const y = Math.max(w.Y[i], w.Y[i + 1]), yl = Math.min(w.Y[i], w.Y[i + 1]);
    const g = Math.min(H(w.pts[i][0], w.pts[i][1]), H(w.pts[i + 1][0], w.pts[i + 1][1]));
    MW.idx.add(w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1], w.width / 2 + 0.6, { kind: 'mw', id: 'w' + w.id, n: `${w.type} ${w.ref || w.name || ''}`.trim(), modes: 2, y, yb: yl - DECK, elev: yl - DECK - g > 1.0 });
  }
}
const hl = ctx.transit?.hubLink;
if (hl) {
  const addSmp = (smp, width, n) => { for (let i = 0; i < smp.length - 1; i++) { const a = smp[i], b = smp[i + 1]; const g = Math.min(H(a.x, a.z), H(b.x, b.z)); const yl = Math.min(a.y, b.y); HL.idx.add(a.x, a.z, b.x, b.z, width / 2 + 0.45, { kind: 'hl', id: n, n, modes: 2, y: Math.max(a.y, b.y), yb: yl - 1.2, elev: yl - 1.2 - g > 1.0 }); } };
  const addSmp2 = (smp, width, n, adj) => { for (let i = 0; i < smp.length - 1; i++) { const a = smp[i], b = smp[i + 1]; const g = Math.min(H(a.x, a.z), H(b.x, b.z)); const yl = Math.min(a.y, b.y); HL.idx.add(a.x, a.z, b.x, b.z, Math.max(a.w ?? width, b.w ?? width) / 2 + 0.45, { kind: 'hl', id: n, n, adj, modes: 2, y: Math.max(a.y, b.y), yb: yl - 1.2, elev: yl - 1.2 - g > 1.0 }); } };
  if (hl.roads) for (const r of hl.roads) addSmp2(r.smp, r.width, r.n, r.adj);
  else {
    if (hl.access) addSmp(hl.access, 9, 'drum acces hub');
    for (const a of hl.arms || []) addSmp(a.smp, a.width, 'brat ' + a.kind);
  }
  if (hl.ring) {
    const { C, yC, R_OUT, R_IN } = hl.ring;
    const rm = (R_OUT + R_IN) / 2, N = 48;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 2 * Math.PI, a1 = ((i + 1) / N) * 2 * Math.PI;
      HL.idx.add(C[0] + rm * Math.cos(a0), C[1] + rm * Math.sin(a0), C[0] + rm * Math.cos(a1), C[1] + rm * Math.sin(a1), (R_OUT - R_IN) / 2 + 0.3, { kind: 'hl', id: 'giratoriu', n: 'giratoriu DJ208L', modes: 2, y: yC, yb: yC - 1.2, elev: false });
    }
  }
}
// banda × obiect cu cota: lovire doar daca obiectul [y0,y1] intra in gabaritul drumului [yb, y+4,8] (sau drumul e la sol)
const inGauge = (tag, y0, y1) => y1 > tag.yb - 0.3 && y0 < tag.y + 4.8;
function bandHit3(B, x, z, rad, modes, y0, y1, tol = TOL) {
  let best = null;
  B.idx.query([x - rad - 30, z - rad - 30, x + rad + 30, z + rad + 30], (s) => {
    if (!(s.tag.modes & modes)) return;
    if (s.tag.elev && !inGauge(s.tag, y0, y1)) return;
    const pen = s.r + rad - d2seg(x, z, s.ax, s.az, s.bx, s.bz);
    if (pen > tol && (!best || pen > best.pen)) best = { pen, tag: s.tag };
  });
  return best;
}
function bandHitPoly3(B, p, modes, y0, y1, tol = TOL) {
  const bb = bbox(p); let best = null;
  B.idx.query([bb[0] - 30, bb[1] - 30, bb[2] + 30, bb[3] + 30], (s) => {
    if (!(s.tag.modes & modes)) return;
    if ((s.tag.elev || s.tag.kind === 't1') && !inGauge(s.tag.kind === 't1' ? { y: s.tag.y, yb: s.tag.y - 0.5 } : s.tag, y0, y1)) return;
    const pen = s.r - dSegPoly(s.ax, s.az, s.bx, s.bz, p);
    if (pen > tol && (!best || pen > best.pen)) best = { pen, tag: s.tag };
  });
  return best;
}
// cutii de coliziune
const treesG = new Map(); const TC = 10;
for (const t of PTS) if (t.kind === 'copac') { const k = Math.floor(t.x / TC) + ',' + Math.floor(t.z / TC); if (!treesG.has(k)) treesG.set(k, []); treesG.get(k).push(t); }
const treesIn = (bb, r = 1) => { const out = []; for (let gx = Math.floor((bb[0] - r) / TC); gx <= Math.floor((bb[2] + r) / TC); gx++) for (let gz = Math.floor((bb[1] - r) / TC); gz <= Math.floor((bb[3] + r) / TC); gz++) for (const t of treesG.get(gx + ',' + gz) || []) out.push(t); return out; };
const bldIn = (bb) => { const s = new Set(); for (let gx = Math.floor(bb[0] / BC); gx <= Math.floor(bb[2] / BC); gx++) for (let gz = Math.floor(bb[1] / BC); gz <= Math.floor(bb[3] / BC); gz++) for (const b of bldGrid.get(gx + ',' + gz) || []) s.add(b); return [...s]; };
const seenBox = new Set();
for (const b of BOX) {
  const who = (b.hub ? 'hub' : 'gara') + (b.vis ? '-vizibil' : '-cutie');
  const tag = `${b.src}#${b.i} @${at(b.cx, b.cz)} y ${f1(b.y0)}..${f1(b.y1)} [${md(b.modes)}]`;
  const gy = H(b.cx, b.cz);
  const once = (cat, key, pen, msg) => { const k = cat + key; if (seenBox.has(k)) return; seenBox.add(k); hit(cat, pen, msg); };
  for (const o of bldIn(b.bb)) {
    if (!b.hub && /^Gara Pa[sș]cani/.test(o.n) && /cladire-istorica/.test(b.src)) continue; // cladirea istorica = amprenta OSM a garii
    if (!(o.modes & b.modes) || o.bb[0] > b.bb[2] || o.bb[2] < b.bb[0] || o.bb[1] > b.bb[3] || o.bb[3] < b.bb[1]) continue;
    const pen = polyPen(b.p, o.p); if (pen > TOL) once(`${who} × cladire`, b.src + o.id, pen, `${tag} in cladirea ${o.id} ${o.n} (${f1(pen)} m)`);
  }
  let h;
  if (b.y0 < gy + 4.5 && b.y1 > gy - 1 && (h = bandHitPoly(ROADS, b.p, b.modes, TOL))) once(`${who} × drum`, b.src + h.tag.id, h.pen, `${tag} pe drumul ${h.tag.id} ${h.tag.k} ${h.tag.n} (${f1(h.pen)} m)`);
  if ((h = bandHitPoly3(T1E, b.p, b.modes, b.y0, b.y1))) once(`${who} × T1`, b.src + Math.round(h.tag.s / 50), h.pen, `${tag} in gabaritul T1 la s=${Math.round(h.tag.s)} (${f1(h.pen)} m)`);
  if ((h = bandHitPoly3(MW, b.p, b.modes, b.y0, b.y1))) once(`${who} × A7/A8`, b.src + h.tag.id, h.pen, `${tag} pe ${h.tag.id} ${h.tag.n} (${f1(h.pen)} m)`);
  if (!b.hub && (h = bandHitPoly3(HL, b.p, b.modes, b.y0, b.y1))) once(`${who} × hub-link`, b.src + h.tag.id, h.pen, `${tag} pe ${h.tag.n} (${f1(h.pen)} m)`);
  for (const t of treesIn(b.bb)) {
    if (!(t.modes & b.modes) || t.y > b.y1 - 0.3 || (t.top ?? t.y + 8) < b.y0) continue; // copac plantat pe placa = OK
    if (Math.hypot(t.x - b.cx, t.z - b.cz) < 0.3 && b.bb[2] - b.bb[0] < 2) continue; // cutia-trunchi a copacului insusi
    const pen = t.rad - sdPoly(t.x, t.z, b.p);
    if (pen > TOL + 0.1) once(`${who} × copac`, b.src + t.src + t.i, pen, `${tag} × ${t.src}#${t.i} @${at(t.x, t.z)} (${f1(pen)} m)`);
  }
}
// placile / cladirea / acoperisul hub-ului
for (const s of HUBP) {
  let h;
  const slab = s.y0 < s.y1 - 3; // placa plina
  if (slab && (h = bandHitPoly(ROADS, s.p, 2, TOL))) hit('hub × drum', h.pen, `${s.n} peste drumul ${h.tag.id} ${h.tag.k} ${h.tag.n} (${f1(h.pen)} m)`);
  if ((h = bandHitPoly3(T1E, s.p, 2, s.y0, s.y1))) hit('hub × T1', h.pen, `${s.n} in gabaritul T1 la s=${Math.round(h.tag.s)} (${f1(h.pen)} m)`);
  if ((h = bandHitPoly3(MW, s.p, 2, s.y0, s.y1))) hit('hub × A7/A8/bretele', h.pen, `${s.n} (y ${f1(s.y0)}..${f1(s.y1)}) × ${h.tag.id} ${h.tag.n} y ${f1(h.tag.y)} (${f1(h.pen)} m)`);
  for (const o of bldIn(s.bb)) { if (!(o.modes & 2)) continue; const pen = polyPen(s.p, o.p); if (pen > TOL) hit('hub × cladire', pen, `${s.n} × cladirea ${o.id} ${o.n} (${f1(pen)} m)`); }
}
// A7/A8 + bretele si hub-link ca benzi × cladiri / copaci / mobilier / pile
for (const [B, nm] of [[MW, 'A7/A8'], [HL, 'hub-link']]) {
  const seen = new Set();
  for (const o of BLD) {
    if (!(o.modes & 2)) continue;
    const g = H(o.cx, o.cz), bh = o.h || 8;
    const h = bandHitPoly3(B, o.p, 2, g - 1, g + bh);
    if (h && !seen.has(o.id + h.tag.id)) { seen.add(o.id + h.tag.id); hit(`${nm} × cladire`, h.pen, `${o.id} ${o.n} @${at(o.cx, o.cz)} sub/pe ${h.tag.id} ${h.tag.n} (${f1(h.pen)} m)`); }
  }
  for (const p of PTS) {
    if (!(p.modes & 2)) continue;
    if (p.kind === 'pila' && B === MW) continue; // pilele podurilor A7/A8 stau sub tabliere
    const y = p.y ?? H(p.x, p.z), top = p.top ?? y + 8;
    const h = bandHit3(B, p.x, p.z, p.rad, 2, y, top);
    if (h) hit(`${nm} × ${p.kind}`, h.pen, `${p.src}#${p.i} @${at(p.x, p.z)} pe/sub ${h.tag.id} ${h.tag.n} (${f1(h.pen)} m)`);
  }
}
// 4) traseele vehiculelor: rulam animatia reala si esantionam pozitiile
const VEH = [];
const TRAIN_GROUPS = new Set((scene.getObjectByName('gara-linii-trenuri')?.children || []).filter((g) => g.isGroup && g.children.length && /EMU|DMU/.test(g.name)));
scene.traverse((o) => {
  const ph = objPath(o);
  if (/^autobuze-circuit\/autobuz-[^/]+$/.test(ph) || /^tramvai-\d$/.test(ph)) VEH.push({ o, name: ph, inst: false, w: 1.3 });
  if (o.isInstancedMesh && /(\/trafic$|autocare|coach|\/autocar-[A-Z]+$)/i.test(ph)) VEH.push({ o, name: ph, inst: true, w: 1.2 });
  // trenurile CFR din gara (src/station/trains.js): fiecare vagon, copil al grupului trenului
  if (TRAIN_GROUPS.has(o.parent)) VEH.push({ o, name: 'tren ' + o.parent.name.split(' ')[1] + '#' + o.parent.children.indexOf(o), inst: false, w: 1.45, train: true });
});
const pathHits = new Map();
{
  const trees = byKind('copac').filter((p) => !p.src.startsWith('oras-osm/copaci') || true);
  const solid = PTS.filter((p) => p.kind !== 'copac' || p.rad);
  const g = new Map(); const C = 8;
  for (const p of solid) { const k = Math.floor(p.x / C) + ',' + Math.floor(p.z / C); if (!g.has(k)) g.set(k, []); g.get(k).push(p); }
  const v = new THREE.Vector3();
  const sample = (veh, x, z, y) => {
    const modes = modesOf(veh.o) || 2;
    const key = veh.name;
    const rec = (cat, pen, msg) => { const k = cat + '|' + msg.split(' (')[0]; if (pathHits.has(k)) return; pathHits.set(k, 1); hit(cat, pen, `${key} @${at(x, z)} ${msg}`); };
    let h;
    if ((h = bldAt(x, z, veh.w, modes)) && h.pen > 0.4) rec('traseu × cladire', h.pen, `prin cladirea ${h.b.id} ${h.b.n} (${f1(h.pen)} m)`);
    const gx = Math.floor(x / C), gz = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of g.get(gx + i + ',' + (gz + j)) || []) {
      if (!(p.modes & modes)) continue;
      if (p.top !== undefined && y !== undefined && (y > p.top - 0.3 || y < p.y - 4)) continue; // vehiculul trece pe deasupra (pod) sau pe dedesubt
      const pen = veh.w + p.rad - Math.hypot(p.x - x, p.z - z);
      if (pen > 0.3) rec(`traseu × ${p.kind}`, pen, `prin ${p.src}#${p.i} @${at(p.x, p.z)} (${f1(pen)} m)`);
    }
  };
  let t = 0; const dt = 0.5;
  for (let step = 0; step < 900; step++) {
    t += dt;
    for (const f of updates) { try { f(dt, t); } catch (e) { /* */ } }
    if (step % 2) continue;
    for (const veh of VEH) {
      if (veh.inst) {
        veh.o.updateMatrixWorld(true);
        for (let i = 0; i < veh.o.count; i++) { veh.o.getMatrixAt(i, _m); _m.premultiply(veh.o.matrixWorld); _m.decompose(_p, _q, _s); if (_s.x < 0.01) continue; sample(veh, _p.x, _p.z, _p.y); }
      } else {
        if (!visible(veh.o) && !MODES.viitor.has(veh.o)) continue;
        veh.o.updateMatrixWorld(true); veh.o.getWorldPosition(v); sample(veh, v.x, v.z, v.y);
      }
    }
  }
}

// 5) persoane (TO-DO 7): grupurile statice (sloturile >= 48 ale fiecarei banci) + traseele pietonilor, esantionate la 1 m
//    × drumuri / CF / T1 / apa / cladiri (cu inaltime) / cutii de coliziune / A7-A8 + hub-link (cu cota) / copaci, mobilier, pile
const PPL = [], PPL_R = 0.28, PPL_H = 1.75;
if (ctx.people) {
  for (const era of ['future', 'today']) {
    const B = ctx.people.banks[era], a = B.body.instanceMatrix.array, modes = modesOf(B.body) || (era === 'future' ? 2 : 1);
    for (let i = 48; i < B.n; i++) {
      if (B.iData.getW(i) < 0.5) continue;
      const o = i * 16;
      PPL.push({ src: 'persoane-' + era, i, x: a[o + 12], y: a[o + 13], z: a[o + 14], modes, sit: B.iData.getY(i) === 3 });
    }
  }
  ctx.people.paths().forEach((w, k) => {
    const modes = w.era === 'both' ? BOTH : w.era === 'today' ? 1 : 2;
    for (let j = 0; j < w.pts.length - 1; j++) {
      const a = w.pts[j], b = w.pts[j + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2])));
      for (let q = 0; q <= n; q++) { const t = q / n; PPL.push({ src: 'pieton-' + k, i: j, x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, modes, walk: true }); }
    }
  });
}
const NPPL = { static: PPL.filter((p) => !p.walk).length, walk: ctx.people ? ctx.people.paths().length : 0, samples: PPL.filter((p) => p.walk).length };
{
  const C = 6, ptsG = new Map(), boxG = new Map(), BG = 20;
  for (const p of PTS) { const k = Math.floor(p.x / C) + ',' + Math.floor(p.z / C); if (!ptsG.has(k)) ptsG.set(k, []); ptsG.get(k).push(p); }
  for (const b of BOX) for (let gx = Math.floor(b.bb[0] / BG); gx <= Math.floor(b.bb[2] / BG); gx++) for (let gz = Math.floor(b.bb[1] / BG); gz <= Math.floor(b.bb[3] / BG); gz++) { const k = gx + ',' + gz; if (!boxG.has(k)) boxG.set(k, []); boxG.get(k).push(b); }
  const seen = new Set();
  const once = (cat, key, pen, msg) => { if (seen.has(cat + key)) return; seen.add(cat + key); hit(cat, pen, msg); };
  for (const p of PPL) {
    const g = H(p.x, p.z), low = p.y - g < 2.5; // la nivelul terenului (nu pe pasarela / pod / peron suspendat)
    const key = p.walk ? p.src : p.src + '#' + p.i;
    const tag = `${p.walk ? 'traseu ' + p.src + ' seg ' + p.i : p.src + '#' + p.i} @${at(p.x, p.z)} y ${f1(p.y)} [${md(p.modes)}]`;
    let h;
    if (low && (h = bandHitPoint(ROADS, p.x, p.z, PPL_R, p.modes, TOL))) once('persoana × drum', key + h.tag.id, h.pen, `${tag} pe drumul ${h.tag.id} ${h.tag.k} ${h.tag.n} (${f1(h.pen)} m)`);
    // Azi: pietonii traverseaza liniile pe dulapii de lemn (voit, ca in realitate)
    if (low && !(p.walk && p.modes === 1) && (h = bandHitPoint(RAILS, p.x, p.z, PPL_R, p.modes, TOL))) once('persoana × CF', key, h.pen, `${tag} pe calea ferata (${f1(h.pen)} m)`);
    let t1 = null;
    T1.idx.query([p.x - 12, p.z - 12, p.x + 12, p.z + 12], (s) => {
      if (!(s.tag.modes & p.modes) || p.y > s.tag.y + 2.5 || p.y + PPL_H < s.tag.y - 0.5) return; // T1 pe viaduct deasupra / persoana pe pod peste T1
      const pen = s.r + PPL_R - d2seg(p.x, p.z, s.ax, s.az, s.bx, s.bz);
      if (pen > TOL && (!t1 || pen > t1.pen)) t1 = { pen, tag: s.tag };
    });
    if (t1) once('persoana × T1', key + Math.round(t1.tag.s / 50), t1.pen, `${tag} pe platforma T1 la s=${Math.round(t1.tag.s)} (${f1(t1.pen)} m)`);
    if (low && WATER.nearest(p.x, p.z, 30)?.d < PPL_R) once('persoana × apa', key, PPL_R, `${tag} in rau`);
    if ((h = bldAt(p.x, p.z, PPL_R, p.modes)) && h.pen > TOL && p.y < g + (h.b.h || 8)) once('persoana × cladire', key + h.b.id, h.pen, `${tag} in cladirea ${h.b.id} ${h.b.n} (${f1(h.pen)} m)`);
    for (const b of boxG.get(Math.floor(p.x / BG) + ',' + Math.floor(p.z / BG)) || []) {
      if (!(b.modes & p.modes) || p.y + 0.15 >= b.y1 || p.y + PPL_H <= b.y0) continue; // sta pe cutie / trece pe sub ea
      if (p.sit && b.y1 - b.y0 < 0.9) continue; // asezat pe banca (cutie joasa)
      if (p.x < b.bb[0] - 1 || p.x > b.bb[2] + 1 || p.z < b.bb[1] - 1 || p.z > b.bb[3] + 1) continue;
      const pen = PPL_R - sdPoly(p.x, p.z, b.p);
      if (pen > TOL) once('persoana × cutie coliziune', key + b.src + b.i, pen, `${tag} in ${b.src}#${b.i} y ${f1(b.y0)}..${f1(b.y1)} (${f1(pen)} m)`);
    }
    if ((h = bandHit3(MW, p.x, p.z, PPL_R, p.modes, p.y, p.y + PPL_H))) once('persoana × A7/A8', key + h.tag.id, h.pen, `${tag} pe ${h.tag.id} ${h.tag.n} (${f1(h.pen)} m)`);
    if ((h = bandHit3(HL, p.x, p.z, PPL_R, p.modes, p.y, p.y + PPL_H))) once('persoana × hub-link', key + h.tag.id, h.pen, `${tag} pe ${h.tag.n} (${f1(h.pen)} m)`);
    const gx = Math.floor(p.x / C), gz = Math.floor(p.z / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of ptsG.get(gx + i + ',' + (gz + j)) || []) {
      if (!(o.modes & p.modes) || (p.sit && o.kind === 'mobilier')) continue; // cei asezati stau pe banci
      if (o.top !== undefined && o.y !== undefined && (p.y > o.top - 0.2 || p.y + PPL_H < o.y)) continue;
      const pen = PPL_R + o.rad - Math.hypot(o.x - p.x, o.z - p.z);
      if (pen > TOL) once(`persoana × ${o.kind}`, key + o.src + o.i, pen, `${tag} × ${o.src}#${o.i} @${at(o.x, o.z)} (${f1(pen)} m)`);
    }
  }
}
// 6) drumurile hub-link (acces, brate, giratoriu) × T1 si × tablierele A7/A8 – cu cota: gabarit vertical < 4,5 m => coliziune
//    (bratele se racordeaza la bretele: ignoram 40 m in jurul racordurilor)
{
  const joints = (hl?.arms || []).map((a) => a.joint).filter(Boolean);
  const nearJoint = (x, z) => joints.some((j) => Math.hypot(j.x - x, j.z - z) < 40);
  const seen = new Set();
  const vgap = (aTop, aBot, bTop, bBot) => Math.max(bBot - aTop, aBot - bTop); // >0 = spatiu liber intre cele doua
  for (const s of HL.idx.segs) {
    const x = (s.ax + s.bx) / 2, z = (s.az + s.bz) / 2, top = s.tag.y, bot = s.tag.yb;
    T1.idx.query([x - s.r - 12, z - s.r - 12, x + s.r + 12, z + s.r + 12], (t) => {
      const pen = s.r + t.r - d2seg(x, z, t.ax, t.az, t.bx, t.bz);
      if (pen <= TOL) return;
      const gap = vgap(top, bot, t.tag.y + 0.1, t.tag.y - 1.6);
      const k = s.tag.n + Math.round(t.tag.s / 50);
      if (gap < 4.5 && !seen.has(k)) { seen.add(k); hit('hub-link × T1', pen, `${s.tag.n} @${at(x, z)} y ${f1(top)} × T1 s=${Math.round(t.tag.s)} y ${f1(t.tag.y)} (gabarit ${f1(gap)} m)`); }
    });
    if (nearJoint(x, z)) continue;
    MW.idx.query([x - s.r - 20, z - s.r - 20, x + s.r + 20, z + s.r + 20], (m) => {
      const pen = s.r + m.r - d2seg(x, z, m.ax, m.az, m.bx, m.bz);
      if (pen <= TOL + 0.45) return;
      if (s.tag.adj && s.tag.adj === m.tag.id) return; // banda paralela lipita de breteaua ei
      const gap = vgap(top, bot, m.tag.y, m.tag.yb);
      const k = s.tag.n + m.tag.id;
      if (gap < 4.5 && !seen.has(k)) { seen.add(k); hit('hub-link × A7/A8', pen, `${s.tag.n} @${at(x, z)} y ${f1(top)} × ${m.tag.id} ${m.tag.n} y ${f1(m.tag.y)} (gabarit ${f1(gap)} m, ${f1(pen)} m)`); }
    });
  }
}

// ---------------- raport ----------------
console.info = quiet;
const cats = [...R.keys()].sort();
const total = cats.reduce((a, c) => a + R.get(c).length, 0);
if (ARGS.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries(cats.map((c) => [c, { n: R.get(c).length, worst: R.get(c).sort((a, b) => b.pen - a.pen).slice(0, MAX).map((h) => h.msg) }])), null, 1));
} else {
  console.log(`\nAudit coliziuni – scena construita in ${buildMs} ms: ${BLD.length} cladiri, ${ctx.city.roads.length} tronsoane de drum, ${PTS.length} obiecte punctuale (` +
    ['copac', 'mobilier', 'pila'].map((k) => `${byKind(k).length} ${k}`).join(', ') + `), ${VEH.length} grupuri de vehicule.`);
  console.log(`Verificari noi: ${BOX.length} cutii de coliziune (gara + hub + statii), ${HUBP.length} placi hub, ${MW.idx.segs.length} segmente A7/A8+bretele, ${HL.idx.segs.length} segmente hub-link, T1 cu latimea reala din track.js (TRACK_HALF ${TRACK_HALF} m); ${VEH.filter((v) => v.train).length} vagoane CFR + ${VEH.filter((v) => /autocar-/.test(v.name)).length} linii de autocar hub-link esantionate.`);
  console.log(`Persoane: ${NPPL.static} statice + ${NPPL.walk} pietoni (${NPPL.samples} puncte de traseu); T1: ${PTS.filter((p) => /t1-pile/.test(p.src)).length} pile verificate × drum / CF / cladire.`);
  console.log(`Total suprapuneri: ${total}\n`);
  for (const c of cats) {
    const l = R.get(c).sort((a, b) => b.pen - a.pen);
    console.log(`== ${c}: ${l.length}`);
    for (const h of l.slice(0, MAX)) console.log('   ' + h.msg);
  }
  for (const [c, l] of NOTE) {
    l.sort((a, b) => b.pen - a.pen);
    console.log(`-- informativ (date OSM, nu intra in total) ${c}: ${l.length}, max ${f1(l[0].pen)} m`);
    for (const h of l.slice(0, Math.min(3, MAX))) console.log('   ' + h.msg);
  }
}
