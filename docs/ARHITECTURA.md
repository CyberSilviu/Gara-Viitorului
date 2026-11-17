# Arhitectura aplicației „Gara Viitorului – Pașcani”

Vite + Three.js r170 (`npm run dev`). Fără alte biblioteci.

## Coordonate
- 1 unitate = 1 metru. Origine = clădirea Gării Pașcani (47.25689 N, 26.72403 E).
- `x` = est, `z` = sud (deci **nord = −z**), `y` = altitudine **relativă la cota gării** (gara = 0).
- `ctx.geo.project(lat, lon) → {x, z}`; `ctx.terrain.heightAt(x, z) → y` (relief SRTM real, netezit în jurul gării pe r≈380–700 m).

## Obiectul comun `ctx` (creat în `src/main.js`)
| câmp | ce este |
|---|---|
| `THREE, scene, camera, renderer, raycaster` | Three.js |
| `addUpdate(fn(dt, t))` | apelat în fiecare cadru |
| `env` | `{ hour, night (0..1), isNight(), onChange(fn(state)), setHour(h), sun }` |
| `terrain` | `{ heightAt(x,z), mesh, flattenZones }` |
| `city` | `{ osm, footprints, group }` – date OSM proiectate (vezi mai jos) |
| `controls` | `{ mode, setMode('orbit'|'walk'|'ride', opts), flyTo(posV3, targetV3, dur, done), orbit }` |
| `hotspots.add({...})` | punct de informare (vezi mai jos) |
| `colliders` | array de `Mesh` – pereți/obstacole pentru modul plimbare (raycast orizontal) |
| `walkables` | array de `Mesh` – podele/scări/rampe/peroane (raycast vertical) |
| `places` | `{ name, sub, icon, view:{position,target} }` sau `{..., walk:{position:V3, yaw}}` – meniul „Locuri” |
| `tourSteps` | `{ order, title, text, view:{position,target}, hotspot?, hold?, onEnter? }` |
| `mapLayers / mapMarkers / mapLive / mapFit` | harta mică |
| `futureToggles / routeToggles` | `fn(bool)` – comutatoarele din tabloul de bord |
| `energyConfig` | `{ pvKWp, batteryKWh, baseKW, lightKW, tramKW }` (opțional, setat înainte de UI) |
| `walkStart` | `{ position: V3, yaw }` – unde începe „Plimbare în gară” |
| `startView` | `{ position, target }` – vederea inițială |
| `rideTarget` | `Object3D` urmărit în modul `ride` (`userData.seat` = V3 local al ochilor, `userData.seatYaw`) |
| `transit.startRide() / stopRide()` | chemate de UI la intrarea/ieșirea din modul „Tren ușor” |
| `toast(msg)` | mesaj scurt |
| `setFuture(on)` | Azi / Viitor (butonul din bara de sus, tasta V) – apelează toate `futureToggles` |
| `satellite` / `setSatellite(on)` | imaginea satelit pe teren (`src/core/satellite.js`): Sentinel-2 offline + Esri la rulare |
| `terrain.setSatelliteMaterials(map)` / `terrain.setLanduse()` | materialul satelit / pictura stilizată a terenului |
| `city.setSatelliteMode(on)` | ascunde drumurile mici / trotuarele când solul e imagine satelit |

Texturile procedurale (fațade, acoperișuri, asfalt cu marcaje, pavele, iarbă) sunt în `src/core/textures.js`;
acoperișurile în pantă (în 4 ape sau în 2 ape) sunt generate pe dreptunghiul orientat al amprentei, pentru case mici aproape dreptunghiulare.

## Hotspot (cerința 49 – fiecare soluție explicată)
```js
ctx.hotspots.add({
  id: 'pv-copertine', category: 'energy', // info|access|energy|eco|safety|mobility|heritage
  title: 'Copertine fotovoltaice', position: new THREE.Vector3(x, y, z),
  what: 'Ce este…', why: 'De ce am ales-o…', benefit: 'Ce avantaj aduce…',
  data: [['Putere instalată', '1,45 MWp']],
  view: { position: V3, target: V3 },   // „Vezi de aproape”
  walk: { position: V3, yaw: 0 },        // „Mergi acolo” (opțional)
});
```

## Module
- `src/station/index.js` → `export async function build(ctx)` – complexul gării (exterior + interior vizitabil).
- `src/transit/index.js` → `export async function build(ctx)` – trenul ușor, traseul, nodul A7×A8, hub-ul, indicatoarele spre aeroporturi. Returnează `{ startRide, stopRide }`.

## Date
- `public/data/osm.json` – `{ buildings:[{p:[[x,z]...], h, t, n}], roads:[{p,k,ref,n,c}], rails:[{p,k,svc}], rivers:[{p,k,n}], areas:[{p,k}] }` (generate de `scripts/fetch-osm.mjs`).
- `public/data/dem.json` – grilă SRTM (generată de `scripts/fetch-dem.mjs`).
