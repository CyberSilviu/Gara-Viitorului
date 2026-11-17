// Sistem local de coordonate: 1 unitate = 1 metru, originea = Gara Pascani.
// x = est, z = sud (deci -z = nord), y = altitudine relativa la cota garii.
export const ORIGIN = { lat: 47.25689, lon: 26.72403 };

const R = 6378137;
const lat0 = (ORIGIN.lat * Math.PI) / 180;

export function project(lat, lon) {
  const x = ((lon - ORIGIN.lon) * Math.PI) / 180 * R * Math.cos(lat0);
  const z = -((lat - ORIGIN.lat) * Math.PI) / 180 * R;
  return { x, z };
}

export function unproject(x, z) {
  const lat = ORIGIN.lat + (-z / R) * (180 / Math.PI);
  const lon = ORIGIN.lon + (x / (R * Math.cos(lat0))) * (180 / Math.PI);
  return { lat, lon };
}

// Locuri reale (completate din cercetare; vezi docs/CERCETARE.md)
export const PLACES = {
  station: { name: 'Gara Pașcani', lat: 47.25689, lon: 26.72403 },          // OSM way 841790852
  stationNode: { name: 'Stația CFR Pașcani (linii)', lat: 47.25691, lon: 26.72454 },
  busStation: { name: 'Autogara (piața gării)', lat: 47.25668, lon: 26.72384 },
  footbridge: { name: 'Pasarela pietonală existentă', lat: 47.26085, lon: 26.72222 },
  turntable: { name: 'Placa turnantă / depou', lat: 47.25237, lon: 26.7293 },
  triaj: { name: 'Pașcani Triaj', lat: 47.23834, lon: 26.73565 },
  electroputere: { name: 'Electroputere VFU (Atelierele CFR 1876)', lat: 47.2569, lon: 26.72778 },
  cityHall: { name: 'Primăria Pașcani', lat: 47.24512, lon: 26.72405 },
  palace: { name: 'Palatul Cantacuzino-Pașcanu', lat: 47.24519, lon: 26.72785 },
  cathedral: { name: 'Catedrala Pogorârea Sf. Duh', lat: 47.24591, lon: 26.72448 },
  hospital: { name: 'Spitalul Municipal', lat: 47.24369, lon: 26.72556 },
  dn28aBridge: { name: 'Pod DN28A peste CF 500', lat: 47.24479, lon: 26.7313 },
  turbine: { name: 'Nodul turbion A7 × A8 Pașcani–Sodomeni', lat: 47.214, lon: 26.7055 },
  sodomeni: { name: 'Sodomeni', lat: 47.22233, lon: 26.68448 },
  stolniceni: { name: 'Stolniceni-Prăjescu', lat: 47.20389, lon: 26.73951 },
  a8OverRail: { name: 'A8 peste CF 500', lat: 47.2121, lon: 26.741 },
  siret: { name: 'Râul Siret (în dreptul gării)', lat: 47.2544, lon: 26.7601 },
};

// Aeroporturi (coordonate Wikipedia; distante rutiere OSRM, nov. 2026)
export const AIRPORTS = [
  { code: 'IAS', name: 'Aeroportul Internațional Iași', lat: 47.17889, lon: 27.62, km: 81, via: 'A8 → est (Târgu Frumos – Iași)', color: '#38bdf8' },
  { code: 'SCV', name: 'Aeroportul „Ștefan cel Mare” Suceava', lat: 47.6875, lon: 26.35417, km: 62, via: 'A7 → nord (Pașcani – Suceava)', color: '#a78bfa' },
  { code: 'BCM', name: 'Aeroportul „George Enescu” Bacău', lat: 46.52194, lon: 26.91028, km: 91, via: 'A7 → sud (Pașcani – Bacău)', color: '#fb923c' },
];

export function place(key) {
  const p = PLACES[key];
  return p ? project(p.lat, p.lon) : null;
}
