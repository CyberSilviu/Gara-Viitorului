// Zonele complexului garii, ca poligoane [x, z] in coordonate LUME (metri). Dreptunghiurile sunt definite in
// sistemul local al garii (x spre linii, z de-a lungul axei 158,3°, vezi src/station/frame.js) si convertite.
//
// STATION_EXCLUDE      – amprenta INTREAGA a complexului: aici NU se deseneaza nicio cladire din osm.json
//                        (nici OSM, nici amprentele Microsoft ML „t: 'ms'” – copertine, vagoane, camioane).
//                        Poligoanele ocolesc cladirile reale pastrate (anexele CFR de la N si S de gara, blocurile
//                        de pe Str. Garii), deci pot fi folosite si cu un test de INTERSECTIE, nu doar pe centroid.
// STATION_ROAD_EXCLUDE – unde NU se deseneaza drumuri OSM (holul, curtea garii, piata verde, peroanele, piateta de est).
//                        Nu acopera Str. Garii, Str. Ceferistilor si fasia tramvaiului T1.
// STATION_ROAD_DROP    – id-urile OSM ale aleilor parcarii de azi, inlocuite de piata garii (se pot sari cu totul).
import { toWorld } from '../station/frame.js';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => toWorld(x, z).map((v) => Math.round(v * 10) / 10));

// dreptunghiurile locale [x0, z0, x1, z1] (exportate pentru verificari)
export const STATION_RECTS = {
  // curtea garii + Holul Viitorului + fasia T1 din dreptul garii (pana la marginea Str. Garii, x ≈ -42)
  forecourt: [-42, -112, -5, 60],
  // cladirea istorica (amprenta in trepte, cu porticul spre peronul 1)
  building: [-11.6, -61, 14.5, 57],
  // peroanele 1–3 cu rampele de capat, campul de linii dintre ele si linia de garaj de la x ≈ 56
  tracks: [9.8, -122, 59, 182],
  // campul de linii de garaj din fata Electroputere (amprentele ML de aici sunt vagoane, nu cladiri)
  yard: [59, -84, 76, 100],
  // pasarela: capetele de vest si de est (scari + lifturi) sunt in curte, respectiv in piateta de est
  footbridge: [-19.6, -73.5, 65.4, -49.5],
  // piateta de est (stocarea energiei, scara de est a pasarelei, legatura spre Electroputere)
  east: [57.5, -84, 87.5, -40],
  // anexa de la sud de cladire (OSM 1354181185), in calea autogarii; se opreste inainte de anexa reala OSM 1354181186
  annexS: [-36.5, 66.5, -16, 82.5],
  // piata verde de la vest de Str. Garii (nord si sud de Str. Ceferistilor)
  westN: [-63, -30.5, -49.4, -5.3],
  westS: [-63, 3.3, -49.4, 47.8],
};

export const STATION_EXCLUDE = Object.values(STATION_RECTS).map((r) => rect(...r));

export const STATION_ROAD_EXCLUDE = [
  rect(-29.9, -112, -5, 60),             // curtea garii + holul (fara fasia T1 si fara Str. Garii)
  rect(...STATION_RECTS.building),
  rect(...STATION_RECTS.tracks),
  rect(...STATION_RECTS.east),
  rect(-63, -30.5, -49.6, -5.4),         // piata verde nord (Str. Ceferistilor ramane: z -5 … 3)
  rect(-63, 3.4, -49.6, 47.8),           // piata verde sud
];

// alei de serviciu ale parcarii de azi din fata garii (curtea devine piata pietonala + benzi bus/taxi proprii)
export const STATION_ROAD_DROP = [876279681, 876279682, 1392353509];
