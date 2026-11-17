# Gara Viitorului – Pașcani 🚆🌿

Aplicație web 3D interactivă pentru **Activitatea 3 – „Gara viitorului”**: gara Pașcani reimaginată ca **gară 3 în 1**
(tren clasic CFR + tren ușor electric + autostrăzile A7 × A8), așezată pe **harta reală** a orașului.

## Pornire

Ai nevoie de [Node.js](https://nodejs.org) (versiunea 18 sau mai nouă).

```bash
npm install
npm run dev
```

Apoi deschide în browser adresa afișată (de obicei http://localhost:5173).

Pentru prezentarea de la gală (fără internet), construiește o versiune finală:

```bash
npm run build
npm run preview
```

## Ce poți face

| Mod | Cum |
|---|---|
| 🛰 **Vedere aeriană** | trage cu mouse-ul (rotire), rotița (zoom), click-dreapta (deplasare) |
| 🚶 **Plimbare în gară** | click pe scenă, apoi `W A S D` + mouse; `Shift` = alergare, `Space` = săritură, `Esc` = eliberează mouse-ul |
| 🚈 **Tren ușor → Nod A7/A8** | T1 pleacă de la Peronul 1 Sud (transfer peron-la-peron din trenul CFR), merge pe linia lui proprie în culoarul căii ferate existente, pe sub podul DN28A, până la Triaj, apoi face dreapta spre hub-ul de la nodul turbion; schimbă camera, viteza |
| 🎤 **Tur ghidat** | prezentarea pas cu pas, cu explicații; săgețile ← → sau redare automată |

- Punctele colorate din scenă = **soluțiile propuse**. Click → *ce este, de ce am ales-o, ce avantaj aduce*.
- Bara „Ora” schimbă ziua/noaptea și arată producția panourilor solare.
- Butonul **Azi / Viitor** (dreapta sus, tasta `V`) compară Pașcaniul de astăzi cu cel propus. În **Azi** dispare tot ce e nou
  (T1, hub, autostrăzile 3D și turbionul – azi sunt încă șantier, vizibil în imaginea satelit –, holul, pasarela, peroanele noi),
  gara apare întreagă, cu parcarea de azi, și reapar clădirile reale pe care proiectul le-ar înlocui.
- Bifa **Satelit** pune pe sol imaginea reală din satelit (sau stilul desenat, dacă o debifezi).
- Taste: `1`–`4` moduri, `H` etichete, `N` zi/noapte, `V` azi / viitor.

> Imaginile de înaltă rezoluție (Esri) se încarcă de pe internet în timpul rulării. Fără internet rămâne
> imaginea Sentinel-2 inclusă în proiect (mai puțin detaliată) – deci la gală merge și offline.

## Date reale folosite

- **Clădiri, străzi, căi ferate, râuri, păduri**: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
  + clădiri suplimentare din Microsoft Global ML Building Footprints (ODbL).
- **Relief**: SRTM 30 m (NASA), prin OpenTopoData.
- **Imagine satelit**: Sentinel-2 cloudless – s2maps.eu, EOX IT Services GmbH (date Copernicus Sentinel 2016 modificate, CC BY 4.0),
  inclusă în `public/data/sat/`; detalii de înaltă rezoluție: Esri, Maxar, Earthstar Geographics, GIS User Community (doar online).
- Amprentele de clădiri care cădeau peste drumuri, linii CF, apă sau traseul T1 (de obicei copertine, vagoane sau camioane
  detectate automat ca „clădiri”) sunt eliminate de `scripts/clean-buildings.mjs`.
- **Gara Pașcani**: clădirea de călători (OSM way 841790852), 116 m × 20 m, axa la 158°, 3 peroane, liniile 500 / 606 / 517.
- **Nodul turbion A7 × A8 Pașcani–Sodomeni**: 47.21388 N, 26.70566 E – primul nod de tip turbină din România
  (8 bretele, 12 pasaje, ~220 ha; Lotul 3 Mircești–Pașcani al A7).
- Toată cercetarea, cu surse: [`docs/cercetare.json`](docs/cercetare.json) și [`docs/BRIEF.md`](docs/BRIEF.md).

## Fișa de prezentare

[`docs/PREZENTARE.md`](docs/PREZENTARE.md) conține toate cele 36 de soluții (*ce este / de ce / ce avantaj*, cu cifre)
și scenariul turului ghidat (38 de pași). Dacă modificați textele în cod, regenerați fișa: porniți `npm run dev`,
deschideți consola browserului (F12) și scrieți `exportaPrezentarea()`.

## Actualizarea datelor

```bash
npm run data       # OpenStreetMap prin Overpass + relief SRTM + curățare clădiri + satelit
npm run data:api   # variantă de rezervă (API-ul OSM), dacă Overpass e aglomerat
npm run data:clean # doar curățarea clădirilor false
npm run data:sat   # doar imaginea Sentinel-2
```

## Structura

- `src/core/` – motorul 3D, relieful, orașul OSM, controalele, interfața, turul ghidat
- `src/station/` – complexul gării (exterior + interior vizitabil, peroane, pasarelă, piață)
- `src/transit/` – trenul ușor T1, nodul turbion A7 × A8, hub-ul de mobilitate, liniile spre aeroporturi
- `docs/ARHITECTURA.md` – cum comunică modulele
