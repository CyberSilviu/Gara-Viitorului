import * as THREE from 'three';
import { ROT_Y, PLAT_Y, toWorld, toLocal } from './frame.js';
import { STATION_RECTS } from '../config/zones.js';
import { createMaterials } from './materials.js';
import { createSignAtlas, createDeparturesBoard, createPlatformDisplays, createTotemMap } from './boards.js';
import { buildBuilding } from './building.js';
import { buildHall } from './hall.js';
import { buildFootbridge, DECK } from './footbridge.js';
import { buildTracks, buildPlatforms, buildTodayPlatforms } from './platforms.js';
import { buildPlaza } from './plaza.js';
import { buildTrains } from './trains.js';
import { buildBuses } from './buses.js';
import { addStationInfo, view, walk, OVERVIEW } from './hotspots.js';

// Complexul „Gara Viitorului 3 în 1” – Pașcani.
// Grupul local `root` are originea in centrul cladirii de calatori, +X spre linii (est) si +Z de-a lungul axei (spre SSE).
export async function build(ctx) {
  const M = createMaterials();
  const atlas = createSignAtlas();
  M.signs = new THREE.MeshBasicMaterial({ map: atlas.texture, toneMapped: false });
  M.signs.name = 'semne';
  M.signs.userData.noShadow = true;
  const board = createDeparturesBoard();
  const displays = createPlatformDisplays();
  const totemTex = createTotemMap();

  const root = new THREE.Group();
  root.name = 'gara-viitorului';
  root.rotation.y = ROT_Y;
  ctx.scene.add(root);
  const futureRoot = new THREE.Group(); futureRoot.name = 'viitor';
  const todayRoot = new THREE.Group(); todayRoot.name = 'azi';
  root.add(futureRoot, todayRoot);
  const worldGroup = new THREE.Group(); worldGroup.name = 'gara-linii-trenuri';
  ctx.scene.add(worldGroup);

  // ---------------- constructie ----------------
  const building = buildBuilding(ctx, M, root);
  const hall = buildHall(ctx, M, futureRoot, atlas, board);
  const bridge = buildFootbridge(ctx, M, futureRoot, atlas);
  const plats = buildPlatforms(ctx, M, futureRoot, atlas, displays);
  const oldPlats = buildTodayPlatforms(ctx, M, todayRoot);
  const { tracks } = buildTracks(ctx, M, worldGroup);
  const plaza = buildPlaza(ctx, M, root, atlas, totemTex, board.texture);
  const trains = buildTrains(ctx, M, worldGroup, tracks);
  const buses = buildBuses(ctx, M);
  addTodayMassing(ctx, M, todayRoot);
  root.updateMatrixWorld(true);

  // ---------------- coliziuni & podele ----------------
  const shared = { col: [...building.phys.colliders, ...plaza.physS.colliders], walk: [...building.phys.walkables, ...plaza.physS.walkables] };
  const fut = {
    col: [...building.physF.colliders, ...hall.phys.colliders, ...bridge.phys.colliders, ...plats.phys.colliders, ...plaza.physF.colliders, ...bridge.dynamicColliders],
    walk: [...building.physF.walkables, ...hall.phys.walkables, ...bridge.phys.walkables, ...plats.phys.walkables, ...plaza.physF.walkables, ...bridge.dynamicWalkables],
  };
  const tod = { col: [...oldPlats.phys.colliders, ...building.physT.colliders], walk: [...oldPlats.phys.walkables, ...building.physT.walkables] };
  ctx.colliders.push(...shared.col);
  ctx.walkables.push(...shared.walk);
  const add = (arr, list) => { for (const m of list) if (!arr.includes(m)) arr.push(m); };
  const remove = (arr, list) => { for (const m of list) { const i = arr.indexOf(m); if (i >= 0) arr.splice(i, 1); } };

  let futureOn = true;
  function setFuture(on) {
    futureOn = on;
    futureRoot.visible = on;
    todayRoot.visible = !on;
    plaza.future.visible = on;
    plaza.today.visible = !on;
    building.setFuture(on);
    buses.setFuture(on);
    if (on) { add(ctx.colliders, fut.col); add(ctx.walkables, fut.walk); remove(ctx.colliders, tod.col); remove(ctx.walkables, tod.walk); }
    else { remove(ctx.colliders, fut.col); remove(ctx.walkables, fut.walk); add(ctx.colliders, tod.col); add(ctx.walkables, tod.walk); }
  }
  setFuture(true);
  ctx.futureToggles.push(setFuture);

  // ---------------- noapte / zi ----------------
  let night = 0;
  ctx.env.onChange((st) => {
    night = st.night;
    M.setNight(st.night);
    hall.setNight(st.night);
  });

  // ---------------- animatii: lifturi, trenuri, benzi LED de peron, afisaje ----------------
  const EDGE_IDS = ['L1', 'L2', 'L3', 'L4', 'L5'];
  const edgeIdle = new THREE.Color(0xdff1ff), edgeWarn = new THREE.Color(0xff9a1f), edgeDwell = new THREE.Color(0xffffff);
  let lastSec = -1, baseHour = ctx.env.hour, baseT = 0;
  ctx.addUpdate((dt, t) => {
    bridge.update(dt, t);
    trains.update(dt, t);
    buses.update(dt, t);
    const live = trains.live;
    for (let k = 0; k < EDGE_IDS.length; k++) {
      const m = M.edge[EDGE_IDS[k]];
      const lv = live[k + 1];
      if (!lv) { m.emissive.copy(edgeIdle); m.emissiveIntensity = 0.35 + night * 1.4; continue; }
      if (lv.phase === 'dwell') { m.emissive.copy(edgeDwell); m.emissiveIntensity = 1.2 + night * 1.2; }
      else { m.emissive.copy(edgeWarn); m.emissiveIntensity = 0.6 + 2.2 * (0.5 + 0.5 * Math.sin(t * 7)); }
    }
    // ceasul garii avanseaza in timp real de la ora aleasa
    if (ctx.env.hour !== baseHour) { baseHour = ctx.env.hour; baseT = t; }
    const sec = Math.floor(t);
    if (sec !== lastSec) {
      lastSec = sec;
      const simMin = baseHour * 60 + (t - baseT) / 60;
      const s = Math.floor(((t - baseT) % 60 + 60) % 60);
      const blink = sec % 2 === 0;
      board.draw(simMin, s, blink);
      displays.draw(simMin, live, blink);
      building.update(simMin / 60, night);
    }
  });

  // ---------------- energie ----------------
  const deckPV = (DECK.x1 - DECK.x0 + 0.6) * (DECK.z1 - DECK.z0 + 1.0);
  const pvArea = Math.round(plats.pvArea + plaza.pvArea + deckPV);
  const pvKWp = Math.round((pvArea * 0.2) / 5) * 5;
  const batteryKWh = 1600;
  ctx.energyConfig = { pvKWp, batteryKWh, baseKW: 140, lightKW: 70, tramKW: 160 };

  // ---------------- puncte de informare, tur, locuri ----------------
  // numaratori reale din model (ecrane cu 2 fete, stalpi din piata, arbori, banci din piata, coloane SOS, camere)
  const counts = { displays: 15, sos: 6, cams: 48, ...plaza.counts };
  addStationInfo(ctx, { pvArea, pvKWp, batteryKWh, deckY: DECK.y, platY: PLAT_Y, counts });

  // plimbarea incepe in piata, in fata usii de vest a holului, cu privirea spre peroane
  ctx.walkStart = walk(-28.5, 0.36, -29.2, 1, 0);
  // vederea initiala: tot complexul, ≈ 280 m, la 30° (dinspre piata)
  ctx.startView = OVERVIEW;
  ctx.places.push(
    { name: 'Gara – vedere', sub: 'Complexul gării de sus', icon: '🚉', view: OVERVIEW },
    { name: 'Holul gării', sub: 'Plimbare în Holul Viitorului', icon: '🏛', walk: walk(-20.5, 0.42, -29.5, 1, 0) },
    { name: 'Pasarela', sub: 'Plimbare pe pasarelă, peste linii', icon: '🌉', walk: walk(-6, DECK.y, -68, 1, 0) },
    { name: 'Stația T1', sub: 'Peronul 1 Sud – tren ușor spre Hub Turbion', icon: '🚊', walk: walk(12.5, PLAT_Y, 70, 0, 1) },
    { name: 'Peronul 2', sub: 'Plimbare pe peron (liniile 2–3)', icon: '🚆', walk: walk(31.0, PLAT_Y, -14, 0, 1) },
    { name: 'Piața gării', sub: 'Piața verde și autogara', icon: '🌳', view: view([-120, 45, 10], [-35, 0, -10]) },
  );
  const [mx, mz] = toWorld(0, 0);
  ctx.mapMarkers.push({ x: mx, z: mz, color: '#facc15', label: 'Gara Pașcani', r: 4.5 });
  const fb0 = toWorld(DECK.x0, -68), fb1 = toWorld(DECK.x1, -68);
  ctx.mapLayers.push({ points: [fb0, fb1], color: '#a855f7', width: 3 });

  console.info(`Gara: PV ${pvArea} m² ≈ ${pvKWp} kWp; trenuri ${trains.trains.length}`);
  return { root, worldGroup, setFuture, trains, tracks, materials: M, plaza: { props: plaza.props, structures: plaza.structures }, get future() { return futureOn; } };
}

// „Azi”: anexele CFR reale care dispar in proiect (anexa de la sud de cladire, in calea autogarii) –
// volume simple din amprenta OSM, vizibile doar in modul „Azi” (orasul nu le deseneaza, sunt in STATION_EXCLUDE).
function addTodayMassing(ctx, M, group) {
  const list = ctx.city?.osm?.buildings || [];
  const [a, b, c, d] = STATION_RECTS.annexS;
  for (const bl of list) {
    if (!bl.p || bl.p.length < 4 || bl.t === 'ms' || bl.t === 'train_station') continue;
    const L = bl.p.map(([x, z]) => toLocal(x, z));
    const cx = L.reduce((s, q) => s + q[0], 0) / L.length, cz = L.reduce((s, q) => s + q[1], 0) / L.length;
    if (!(cx > a && cx < c && cz > b && cz < d)) continue;
    const h = bl.h || 5.5;
    const shape = new THREE.Shape(L.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h + 0.3, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const base = Math.min(...bl.p.map(([x, z]) => ctx.terrain.heightAt(x, z))) - 0.3;
    geo.translate(0, base, 0);
    const mesh = new THREE.Mesh(geo, [M.roof, M.plaster]);
    mesh.name = 'anexa-cfr-azi';
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
}
