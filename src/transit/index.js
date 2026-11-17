import * as THREE from 'three';
import { createRoute } from './route.js';
import { buildTrack } from './track.js';
import { createFleet } from './fleet.js';
import { buildStops, pvTexture } from './stops.js';
import { buildMotorways } from './motorway.js';
import { buildHub } from './hub.js';
import { buildAirports } from './airports.js';
import { createRide } from './ride.js';
import { addTransitInfo } from './hotspots.js';
import { buildBridgeAccess } from './bridge-access.js';

// Modulul "Transport": tramvaiul usor T1 Gara Pascani -> Hub Turbion A7xA8, nodul turbion A7 x A8,
// hub-ul de mobilitate si marcarea liniilor spre aeroporturile Iasi / Suceava / Bacau.
// Returneaza { startRide, stopRide, route, fleet, ... } (vezi docs/ARHITECTURA.md).
export async function build(ctx) {
  const t0 = performance.now();
  // Azi / Viitor: tot ce adauga modulul in scena (si in listele ctx) e NOU => ascuns in modul „Azi”
  const sceneBefore = new Set(ctx.scene.children);
  const nColl = ctx.colliders.length, nWalk = ctx.walkables.length;
  const nLayers = ctx.mapLayers.length, nMarkers = ctx.mapMarkers.length, nLive = ctx.mapLive.length;
  const mats = {
    steel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.35 }),
    concrete: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    sleeper: new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.9 }),
  };
  const shared = {
    steelPaint: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45 }),
    pvMat: new THREE.MeshStandardMaterial({ map: pvTexture(), metalness: 0.4, roughness: 0.25 }),
    glassMat: new THREE.MeshStandardMaterial({ color: 0x9fc6d8, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    concreteMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  };

  shared.glassMat.emissive = new THREE.Color(0xffdca8);
  ctx.env.onChange((st) => { shared.glassMat.emissiveIntensity = st.night * 0.45; });

  const route = createRoute(ctx);
  console.info(`T1: ${Math.round(route.length)} m, urcare ${route.climb.toFixed(1)} m, panta max ${(route.maxGrade * 100).toFixed(2)} %`);
  const track = buildTrack(ctx, route, mats);

  // camera in modul "ride": memoram matricea tintei inainte ca vehiculele sa se miste (compensare intarziere)
  let ride = null;
  ctx.addUpdate(() => { if (ride && ride.active) ride.capture(); });
  const fleet = createFleet(ctx, route);
  const stops = buildStops(ctx, route, fleet, shared);
  let bridgeAccess = null;
  try { bridgeAccess = buildBridgeAccess(ctx, route, shared); } catch (e) { console.error('Acces pod DN28A', e); }

  let motorway = null;
  try { motorway = buildMotorways(ctx, shared, route); } catch (e) { console.error('A7/A8', e); }
  const hub = buildHub(ctx, route, shared);
  let airports = null;
  try { airports = buildAirports(ctx, motorway, hub, route); } catch (e) { console.error('Aeroporturi', e); }

  ride = createRide(ctx, route, fleet, {
    onArriveHub: () => { if (ctx.hotspots) ctx.hotspots.open('hub-turbion'); },
  });

  // tabela de plecari din hub: urmatorul T1 spre gara
  let bAcc = 0;
  ctx.addUpdate((dt) => {
    bAcc += dt;
    if (bAcc < 5) return;
    bAcc = 0;
    let best = Infinity;
    for (const v of fleet.vehicles) best = Math.min(best, stops.eta(v, route.stops.length - 1, -1));
    hub.drawBoard(Number.isFinite(best) ? best : null);
  });

  try { addTransitInfo(ctx, { route, fleet, motorway, hub, airports }); } catch (e) { console.error('Puncte de informare transport', e); }

  // ---- Azi / Viitor (ctx.setFuture -> futureToggles) ----
  // In „Azi” dispar: linia T1, statiile, vehiculele, hub-ul, eVTOL, A7/A8 3D + bretele + trafic (azi santier,
  // vizibil pe imaginea satelit), arcele / panglicile / portalele spre aeroporturi; plus colliderele / walkables.
  let futureOn = true;
  const mine = ctx.scene.children.filter((o) => !sceneBefore.has(o));
  const myColl = ctx.colliders.slice(nColl), myWalk = ctx.walkables.slice(nWalk);
  for (const L of ctx.mapLayers.slice(nLayers)) L.future = true;
  for (const M of ctx.mapMarkers.slice(nMarkers)) M.future = true;
  for (let i = nLive; i < ctx.mapLive.length; i++) {
    const fn = ctx.mapLive[i];
    const wrapped = () => (futureOn ? fn() : null);
    wrapped.future = true;
    ctx.mapLive[i] = wrapped;
  }
  const setList = (arr, items, on) => {
    for (const m of items) {
      const i = arr.indexOf(m);
      if (on && i < 0) arr.push(m);
      else if (!on && i >= 0) arr.splice(i, 1);
    }
  };
  ctx.futureToggles.push((on) => {
    on = !!on;
    if (on === futureOn) return;
    futureOn = on;
    if (!on && ride && ride.active) {
      try { ride.stopRide(); } catch (e) { console.error(e); }
      try { ctx.setModeUI?.('orbit'); } catch (e) { console.error(e); }
    }
    for (const o of mine) o.visible = on;
    setList(ctx.colliders, myColl, on);
    setList(ctx.walkables, myWalk, on);
  });

  console.info(`Transport construit in ${Math.round(performance.now() - t0)} ms; cursa T1 ${Math.round(fleet.tripTime / 60)} min`);
  return {
    route, fleet, track, motorway, hub, airports, stops, bridgeAccess,
    startRide: () => ride.startRide(),
    stopRide: () => ride.stopRide(),
    ride,
  };
}
