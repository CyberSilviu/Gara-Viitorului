# Brief proiect – „Gara Viitorului” Pașcani (pentru constructori)

Proiect școlar (Activitatea 3, prezentat la gală, Actul III). Cerințe din temă:
- elementele unei gări moderne: clădire, peroane, spații pentru călători, accesibilitate, informare, siguranță;
- soluții: panouri digitale de informare, orientare inteligentă (wayfinding), spații accesibile PMR, iluminat modern,
  eficiență energetică, panouri fotovoltaice, spații verzi, colectare selectivă a deșeurilor;
- **fiecare soluție trebuie explicată**: ce este, de ce am ales-o, ce avantaj aduce (→ `ctx.hotspots.add`);
- **gară 3 în 1**: tren clasic (CFR) + **tren ușor** din gara mare până la **nodul turbion A7×A8**, unde călătorul urcă
  pe autostradă (autocare / shuttle), cu **marcarea liniilor spre aeroporturile Iași / Suceava / Bacău**;
- model 3D avansat în care **se poate intra în interior**, perspectivă de viitor, **simularea trenului spre turbion**,
  respectând clădirile și geografia reale.

Toate textele vizibile: **limba română cu diacritice** (ă â î ș ț).

## Date reale (vezi `docs/cercetare.json` pentru tot)
### Gara Pașcani
- Clădirea de călători (OSM way 841790852): centru 47.25689 N, 26.72403 E = **originea (0,0,0)**. Cota ~213 m.
- ~116 m lungime × ~20 m adâncime, axa lungă pe azimut **158.3° / 338.3°** (NNV–SSE), paralelă cu liniile.
- Fațada EST (spre linii) = un perete drept de 116 m. Fațada VEST (spre oraș / piață) în trepte, de la N la S:
  pavilion de capăt 12.6 m (adânc 20 m) · aripă 36 m retrasă 4.6 m (adâncime 15.5 m) · corp central 18.3 m (20 m, iese spre piață)
  · aripă 36 m retrasă · pavilion de capăt 13.2 m. Mai ales parter, cu un corp cu etaj și acoperiș în 4 ape, portic cu stâlpi pătrați
  spre peron, tencuială gri-deschis/alb. Ceas + inscripția „PAȘCANI”.
- Liniile sunt la **EST** de clădire. Secțiune transversală (offset spre est, azimut 68°, de la axa clădirii):
  +10 perete est · +17 peron 1 (lateral, ~313 m) · +21 linia 517 (Tg. Neamț) · +25 linia 500 · +26.5…+32 peron 2 (insulă, 5.7 m)
  · +34 linia 500 · +38 linia 606 (Iași) · +40…+46 peron 3 (insulă, 6.5 m) · +48, +51 linii de garare electrificate · +57, +62 linii de triaj.
  Catenară 25 kV. **Nu există pasaj subteran**; peroanele se accesează la nivel. Pasarelă pietonală existentă la ~400 m N.
- Est de linii: Electroputere VFU Pașcani (fostele Ateliere CFR, 1876, monument).
- Vest: piața gării (parcare OSM lat 47.25636–47.25782, lon 26.72318–26.72414 ⇒ ~64 m lățime la vest de clădire),
  autogara (47.25668, 26.72384), Str. Gării (NNV–SSE, în fața clădirii), Str. Ceferiștilor (spre VSV), blocuri P+4.
- Plan CFR 2023 (blocat): consolidare clădire, peron 250 m × 6 m, copertine, rampe, benzi tactile, informare modernă.
- Linii: 500 București – Bacău – Roman – Pașcani – Suceava; 606 Pașcani – Târgu Frumos – Iași; 517 Pașcani – Târgu Neamț.
- Populație 30.766 (2021). Centrul vechi e pe o terasă cu ~25–30 m mai sus, ~1 km la sud (scări „Scările mari”).
- Siretul curge N–S la 2.5–4 km EST de gară.

### Nodul turbion A7 × A8 (Pașcani–Sodomeni)
- Intersecția axelor: **47.21388 N, 26.70568 E** (~5.0 km SSV de gară, azimut 197°, cota ~250–265 m, ~45–50 m peste gară).
- Primul nod de tip turbină din România: A7 km 71+374, ~220 ha, ~2 km, **8 bretele** (80 km/h, raze 400–600 m),
  **12 pasaje** (8 pe A7, 4 pe A8), 5 podețe, „3 etaje”. Lot 3 Mircești–Pașcani (UMB), asfaltare din iulie 2026, deschidere țintă sfârșit 2026.
- OSM: 32 de căi `construction=motorway_link` (multe `bridge=yes`, `layer=1`); bbox bretele lat 47.20591–47.22180, lon 26.69051–26.72323.
- A7 ocolește Pașcaniul pe vest (N–S); A8 merge aproape V–E la lat 47.20–47.22 (spre Tg. Neamț la V, Tg. Frumos/Iași la E).
- Puncte A7: 47.26325,26.68984 · 47.2553,26.6905 (nod Pașcani vest) · 47.24830,26.70159 · 47.23648,26.70256 · 47.22334,26.69717 ·
  nod · 47.20041,26.72005 · 47.18758,26.72710 · 47.17409,26.73047.
- Puncte A8: 47.20353,26.67792 · 47.20930,26.69051 · nod · 47.21457,26.70974 · 47.21435,26.73001 · 47.20991,26.75071 · 47.20563,26.77060.
- Pârâul Zmeul curge spre ESE chiar la sud de nod (47.20790,26.69890 → 47.19900,26.72430).

### Coridor recomandat pentru trenul ușor (≈5.5–6 km)
Piața gării (terminal lângă autogară) → spre sud de-a lungul culoarului CF 500 / Str. Gării, pe lângă Electroputere →
pe sub / pe lângă podul DN28A (47.24479, 26.73130 – stație „Centru / Spital”) → marginea Triajului (47.23834, 26.73565) →
spre SV prin zona industrială → DJ208 Str. Ștefan cel Mare lângă podețul 47.23370, 26.72561 → bifurcația DJ208 / DJ208L (47.22920, 26.72850)
→ de-a lungul DJ208L spre SV (47.22520,26.72290 → 47.21900,26.71650) urcând ~2.5–3 % → **terminal „Hub Turbion”** în afara buclelor
de bretele, pe latura NE a nodului (~47.2160–47.2190, 26.7120–26.7165). Nu traversează Siretul.

### Aeroporturi
- IAS Iași 47.17889 N 27.62 E – ~81 km pe drum, viitor: A8 spre est.
- SCV Suceava (Salcea) 47.6875 N 26.35417 E – ~62 km, viitor: A7 spre nord.
- BCM Bacău 46.52194 N 26.91028 E – ~91 km, viitor: A7 spre sud.
(`ctx.geo.AIRPORTS` le conține deja, cu culori: IAS #38bdf8, SCV #a78bfa, BCM #fb923c.)
