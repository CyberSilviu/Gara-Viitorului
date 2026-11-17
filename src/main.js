import * as THREE from 'three';
import { createEngine } from './core/engine.js';
import { createEnvironment } from './core/environment.js';
import { createTerrain } from './core/terrain.js';
import { createCity } from './core/city.js';
import { createSatellite } from './core/satellite.js';
import { createControls } from './core/controls.js';
import { createHotspots } from './core/hotspots.js';
import { createUI, setLoading, hideLoader, toast } from './core/ui.js';
import { createTour } from './core/tour.js';
import { installPresentationExport } from './core/presentation.js';
import * as geo from './core/geo.js';
import { STATION_EXCLUDE } from './config/zones.js';
import { TRANSIT_EXCLUDE } from './transit/exclude.js';

// ctx = obiectul comun pe care il primesc toate modulele (vezi docs/ARHITECTURA.md)
async function boot() {
  const engine = createEngine(document.getElementById('app'));
  const ctx = Object.assign(engine, {
    geo,
    colliders: [],      // pereti pentru coliziuni (modul plimbare)
    walkables: [],      // podele / scari / rampe pe care se poate merge
    places: [],         // meniul "Locuri"
    tourSteps: [],      // pasii turului ghidat
    mapLayers: [],      // linii pe harta mica {points:[[x,z]], color, width, dash}
    mapMarkers: [],     // puncte pe harta mica {x,z,color,label}
    mapLive: [],        // functii () => {x,z,color} (vehicule in miscare)
    mapFit: [],         // puncte [x,z] pe care harta mica trebuie sa le cuprinda
    futureToggles: [],  // fn(bool) — comutator "Gara viitorului"
    routeToggles: [],   // fn(bool) — comutator "Trasee"
    toast,
  });
  window.__ctx = ctx; // depanare

  setLoading(0.05, 'Cer, soare și lumini…');
  ctx.env = createEnvironment(ctx);

  setLoading(0.12, 'Relieful real al Văii Siretului (SRTM)…');
  ctx.terrain = await createTerrain(ctx);

  setLoading(0.3, 'Orașul Pașcani din OpenStreetMap…');
  try {
    ctx.city = await createCity(ctx, { exclude: [...STATION_EXCLUDE, ...TRANSIT_EXCLUDE] });
  } catch (e) {
    console.error('Oras', e);
    toast('Datele OSM lipsesc – rulează: npm run data');
  }

  setLoading(0.42, 'Imagini satelitare (Sentinel-2, Esri)…');
  try { ctx.satellite = await createSatellite(ctx); } catch (e) { console.error('Satelit', e); }

  ctx.hotspots = createHotspots(ctx);
  ctx.controls = createControls(ctx);

  setLoading(0.5, 'Construim Gara Viitorului…');
  try {
    const station = await import('./station/index.js');
    ctx.station = await station.build(ctx);
  } catch (e) { console.error('Gara', e); }

  setLoading(0.72, 'Trenul ușor și nodul autostrăzilor A7 × A8…');
  try {
    const transit = await import('./transit/index.js');
    ctx.transit = await transit.build(ctx);
  } catch (e) { console.error('Transport', e); }

  // Pasii de inceput si de final ai turului (ceilalti vin din module)
  const turb = geo.place('turbine');
  ctx.tourSteps.push(
    {
      order: 0, title: 'Gara Viitorului – Pașcani, „gară 3 în 1”',
      text: 'Pașcani este unul dintre cele mai importante noduri feroviare din Moldova: aici se întâlnesc magistrala 500 (București – Suceava), linia 606 spre Iași și linia 517 spre Târgu Neamț. Proiectul nostru unește trei moduri de transport: trenul clasic, un tren ușor electric și autostrăzile A7 × A8.',
      view: { position: new THREE.Vector3(-1900, 1500, 2300), target: new THREE.Vector3(turb.x * 0.45, 0, turb.z * 0.45) }, hold: 13,
    },
    {
      order: 95, title: 'De ce această gară?',
      text: 'Gara viitorului pornește de la nevoile călătorilor: informare clară, acces pentru toți, siguranță, energie curată și legături rapide spre autostradă și cele trei aeroporturi (Iași, Suceava, Bacău). Totul este așezat pe harta reală a Pașcaniului, respectând clădirile și relieful existente.',
      view: { position: new THREE.Vector3(-420, 260, 520), target: new THREE.Vector3(0, 0, 0) }, hold: 14,
    },
  );
  ctx.places.unshift({ name: 'Vedere de ansamblu', sub: 'Gara + traseul spre nodul A7 × A8', icon: '🛰', view: ctx.tourSteps[ctx.tourSteps.length - 2].view });

  setLoading(0.9, 'Interfața…');
  ctx.tour = createTour(ctx);
  ctx.ui = createUI(ctx);
  installPresentationExport(ctx);

  // vedere initiala
  const start = ctx.startView || { position: new THREE.Vector3(-320, 210, 380), target: new THREE.Vector3(0, 0, 0) };
  ctx.camera.position.copy(start.position);
  ctx.controls.orbit.target.copy(start.target);
  ctx.controls.orbit.update();

  ctx.start();
  setLoading(1, 'Gata!');
  setTimeout(hideLoader, 350);
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loader-text').textContent = 'Eroare la încărcare: ' + e.message;
});
