import * as THREE from 'three';

// Puncte de informare (ce este / de ce am ales-o / ce avantaj aduce), pasii turului ghidat (50–89)
// si intrarile din meniul "Locuri" pentru modulul de transport.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const nf = (x, d = 1) => x.toFixed(d).replace('.', ',');

export function addTransitInfo(ctx, { route, fleet, motorway, hub, airports }) {
  const H = ctx.terrain.heightAt;
  const stops = route.stops;
  const stopPos = (id) => route.pos(stops.find((s) => s.id === id).s);
  const at = (s, up = 6) => route.pos(s).add(V(0, up, 0));
  // vedere "de aproape": camera la `dist` m, din lateral-dreapta-spate fata de directia liniei
  const viewAt = (s, dist = 70, h = 35, side = 1) => {
    const p = route.pos(s), t = route.tangent(s);
    const r = V(-t.z, 0, t.x);
    return { position: p.clone().addScaledVector(t, -dist * 0.6).addScaledVector(r, side * dist).add(V(0, h, 0)), target: p.clone().add(V(0, 2, 0)) };
  };
  const L = route.length;
  const tripMin = Math.round(fleet.tripTime / 60);
  const add = (h) => ctx.hotspots.add(h);

  // ---------------- linia T1 ----------------
  add({
    id: 't1-linia', category: 'mobility', title: 'Tramvaiul ușor T1: Gara → Nodul A7×A8',
    position: at(stops[0].s - 20, 9),
    what: `O linie nouă de tren ușor (tramvai modern) lungă de ${nf(L / 1000, 1)} km, cu ${stops.length} stații. Pleacă de lângă Peronul 1 Sud al Gării Pașcani, merge spre sud pe linie proprie, în culoarul existent al căii ferate CF 500, trece pe sub podul rutier DN28A, iar la Pașcani Triaj virează la dreapta, pe o curbă de 500 m, spre Hub Turbion, lângă nodul autostrăzilor A7 × A8.`,
    why: 'Autostrăzile ocolesc orașul prin vest, la 4–5 km de gară. Fără o legătură rapidă, cine vine cu trenul nu poate ajunge la autocarele de pe autostradă. Am ales culoarul căii ferate, care există deja: tramvaiul nu ocupă nicio stradă din oraș, Str. Gării rămâne în întregime pentru autobuze și mașini, iar în oraș nu apare nicio trecere la nivel cu o stradă aglomerată.',
    benefit: `Gara clasică, tramvaiul și autostrada devin o singură rețea: cobori din trenul CFR, treci peste peron direct în tramvai și ajungi la hub în aproximativ ${tripMin} minute, fără mașină personală. Pe linie proprie, tramvaiul nu stă la semafoare și nu încurcă traficul, deci orarul se respectă.`,
    data: [['Lungime', `${nf(L / 1000, 2)} km`], ['Stații', String(stops.length)], ['Timp de parcurs', `≈ ${tripMin} min`], ['Frecvență', 'la 10 min (2 vehicule) · la 5 min la vârf (4 vehicule)'], ['Capacitate la vârf', '≈ 2.600 călători / oră / sens'], ['Viteză maximă', '70 km/h'], ['Traseu', 'culoarul CF 500 (≈ 2,1 km) + linie nouă spre hub'], ['Treceri la nivel în oraș', 'niciuna cu străzi aglomerate']],
    view: viewAt(260, 220, 140),
  });
  const corr = route.corridor || [0, 2100];
  add({
    id: 't1-culoar-cf', category: 'mobility', title: 'Pe calea ferată existentă, nu pe străzi',
    position: at(Math.min(corr[1] - 200, 900), 7),
    what: `Primii ${nf(corr[1] / 1000, 1)} km ai liniei T1 sunt în culoarul căii ferate CF 500, pe marginea lui de vest: între liniile CFR și Str. Gării, la circa 6–7 m de cea mai apropiată linie de tren. Tramvaiul are două linii proprii, pe prismă de piatră spartă cu traverse de beton, la fel ca liniile CFR vecine.`,
    why: 'Culoarul feroviar este deja teren al căii ferate, plan, fără case și fără intersecții. Așa nu ocupăm nicio bandă de circulație: Str. Gării rămâne pentru autobuze, mașini și biciclete. Între stradă și linii este loc destul (circa 25 m), deci tramvaiul nu se apropie de carosabil.',
    benefit: 'Tramvaiul merge repede și sigur, fără ambuteiaje și fără treceri la nivel cu străzile aglomerate din oraș. Lucrarea e mai ieftină decât o linie pe stradă, iar vecinii au mai puțin zgomot, pentru că linia stă lângă calea ferată, nu sub ferestrele lor.',
    data: [['Lungime în culoarul CF', `≈ ${nf(corr[1] / 1000, 1)} km`], ['Distanță față de liniile CFR', '≥ 6 m (ax la ax)'], ['Distanță față de Str. Gării', '≥ 15 m de axul străzii'], ['Cale', 'balast + traverse de beton la 0,6 m'], ['Străzi ocupate', 'niciuna']],
    view: viewAt(Math.min(corr[1] - 200, 900), 90, 45, -1),
  });
  add({
    id: 't1-transfer', category: 'access', title: 'Transfer peron la peron cu trenul CFR',
    position: at(stops[0].s + 10, 7),
    what: 'Capătul T1 din gară este chiar pe fața de vest a Peronului 1 Sud: pe o parte a peronului oprește trenul CFR, pe cealaltă tramvaiul. Treci de la un tren la altul în câțiva pași, pe același peron, fără scări și fără să traversezi linii.',
    why: 'Cei mai mulți călători ai liniei T1 vin cu trenul și merg spre autocarele de pe autostradă. Un transfer cât mai scurt este cel mai important lucru pentru ei, mai ales cu bagaje, cu copii sau în scaun cu rotile.',
    benefit: 'Transferul durează sub un minut, iar orarul T1 este corelat cu sosirile trenurilor. Gara istorică rămâne centrul rețelei, iar autostrada devine „următorul peron”.',
    data: [['Loc', 'Peronul 1 Sud, fața de vest'], ['Transfer CFR → T1', '< 1 min, la același nivel'], ['Opritor', 'capătul nordic al peronului']],
    view: viewAt(stops[0].s + 10, 45, 22, -1),
  });
  add({
    id: 't1-baterii', category: 'energy', title: 'Tramvai pe baterii, fără catenară',
    position: at(stops[0].s, 8.5),
    what: 'Vehiculele T1 au 3 secțiuni (32,6 m), podea joasă pe toată lungimea și baterii pe acoperiș. Nu au fir aerian: la capete de linie, un colector mic de pe acoperiș se ridică sub o șină de încărcare montată pe un portal și reîncarcă bateriile cât timp tramvaiul stă în stație.',
    why: 'Fără o a doua rețea de fire lângă catenara CFR și fără stâlpi noi pe drumul spre hub, instalarea e mai ieftină și mai rapidă, iar vederea spre gara istorică rămâne liberă. Cursa dus are doar 5 km, deci o încărcare de câteva minute la fiecare capăt ajunge.',
    benefit: 'Energia vine în mare parte din panourile fotovoltaice ale gării și ale hub-ului. La frânare, motoarele recuperează energie în baterii. Nu există zgomot de pantograf și nici întreținere de catenară.',
    data: [['Lungime vehicul', '32,6 m (3 secțiuni)'], ['Capacitate', '≈ 220 locuri (60 pe scaune)'], ['Baterie', '≈ 260 kWh (LTO, încărcare rapidă)'], ['Consum', '≈ 4 kWh/km'], ['Încărcare la capăt', '5–6 min la 400 kW'], ['Recuperare la frânare', 'până la 30 %']],
    view: { position: at(stops[0].s + 30, 14).add(V(-25, 0, 0)), target: at(stops[0].s, 2) },
  });
  add({
    id: 't1-cale-inierbata', category: 'eco', title: 'Cale pe balast în culoarul CF, înierbată spre hub',
    position: at(Math.max(corr[1] + 400, L * 0.6), 3),
    what: 'În culoarul căii ferate, T1 are o cale clasică: prismă de piatră spartă, traverse de beton la 0,6 m și șine sudate, ca liniile CFR vecine. După Triaj, pe linia nouă spre hub, între șine crește gazon („cale înierbată”), iar platforma este mărginită de o bordură joasă cu bandă LED, care marchează noaptea culoarul tramvaiului.',
    why: 'Lângă liniile de tren, balastul este soluția standard: drenează apa, se întreține cu aceleași utilaje ca restul căii ferate și nu trebuie cosit. Pe linia nouă dintre câmpuri și cartiere, gazonul absoarbe zgomotul și apa de ploaie și arată ca un parc liniar. Banda LED avertizează pietonii fără să orbească.',
    benefit: 'Zgomotul de rulare scade cu 3–5 dB, iar o mare parte din apa de ploaie rămâne pe loc. Vara suprafața e mai răcoroasă decât asfaltul. Culoarul se vede ușor ziua și noaptea, deci trecerile sunt mai sigure.',
    data: [['Cale pe balast', `≈ ${nf(corr[1] / 1000, 1)} km (culoarul CF)`], ['Suprafață verde', `≈ ${nf(((L - corr[1]) * 6.9) / 10000, 1)} ha`], ['Reducere zgomot', '3–5 dB'], ['Apă de ploaie reținută', 'până la 60 %'], ['Bordură LED', 'consum ≈ 1 W/m, se aprinde automat']],
    view: viewAt(Math.max(corr[1] + 400, L * 0.6), 26, 12, -1),
  });
  add({
    id: 't1-statii', category: 'access', title: 'Stații accesibile cu acoperiș solar',
    position: stopPos('electroputere').add(V(0, 6, 0)),
    what: 'Fiecare stație are peroane joase la nivelul podelei tramvaiului, bandă tactilă galbenă, adăpost cu acoperiș fotovoltaic și sticlă, bancă, validator de bilete și coșuri pentru colectare selectivă. Afișajul arată în timp real în câte minute vine următorul tramvai, în ambele sensuri.',
    why: 'Am vrut ca o persoană în scaun cu rotile, un părinte cu cărucior sau un călător cu bagaj să urce fără nicio treaptă. Informarea în timp real reduce stresul așteptării și ajută călătorii să-și prindă legătura cu trenul.',
    benefit: 'Urcarea la nivel scurtează timpul de oprire la circa 20 de secunde. Panourile solare alimentează afișajele și iluminatul stației. Pubelele separate pentru hârtie, plastic, sticlă și deșeuri reziduale păstrează stațiile curate.',
    data: [['Lungime peron', '42 m (46 m la capete)'], ['Înălțime peron', '≈ 35 cm, la nivelul podelei'], ['Acoperiș PV / stație', '≈ 2 × 1,6 kWp'], ['Afișaj', 'timp real, ambele sensuri'], ['Oprire în stație', '20 s (40 s la capete)']],
    view: viewAt(stops[1].s, 30, 12),
  });
  add({
    id: 't1-statie-centru', category: 'mobility', title: 'Stația Centru – Spital (DN28A)',
    position: stopPos('centru').add(V(0, 7, 0)),
    what: 'Stația este în culoarul căii ferate, chiar înainte ca linia să treacă pe sub podul rutier DN28A (Str. Grădiniței). Pe partea de vest a peronului este un turn cu scări și un lift panoramic de sticlă, legat printr-o pasarelă scurtă de trotuarul podului. De pe pod se ajunge pe jos la Spitalul Municipal, la Primărie și în centrul vechi.',
    why: 'DN28A este principala stradă care leagă gara de centrul orașului și de spital, dar trece pe pod, la circa 7 m deasupra liniilor. Liftul și scările fac legătura între peron și pod fără ca tramvaiul să iasă din culoarul CF și fără nicio trecere la nivel cu drumul național.',
    benefit: 'Bolnavii, vârstnicii și părinții cu cărucior urcă pe pod cu liftul, iar ceilalți pe scări. Tramvaiul trece pe sub DN28A fără semafor și fără să oprească mașinile, deci respectă orarul chiar și la ore de vârf.',
    data: [['Distanță până la spital', '≈ 450 m'], ['Distanță până la Primărie', '≈ 550 m'], ['Acces la pod', 'turn de scări + lift panoramic + pasarelă'], ['Intersecție cu DN28A', 'denivelată (pe sub pod)'], ['Timp de la gară', `≈ ${Math.round(fleet.runTime(stops[0].s, stops[2].s) / 60 + 0.7)} min`]],
    view: viewAt(stops[2].s, 60, 30),
  });
  add({
    id: 't1-triaj', category: 'info', title: 'Stația Triaj – cartierul Vatra',
    position: stopPos('triaj').add(V(0, 7, 0)),
    what: 'Stația Triaj este lângă stația CFR Pașcani Triaj, la marginea de vest a grupei de linii. Imediat după ea, linia T1 părăsește culoarul căii ferate și virează la dreapta, pe o curbă largă cu raza de 500 m, spre nodul A7 × A8.',
    why: 'Mulți locuitori ai cartierului Vatra lucrează în zona gării și a triajului. Triajul este și locul firesc în care linia se desparte de calea ferată: liniile CFR merg mai departe spre sud, iar tramvaiul pornește spre vest, spre autostradă.',
    benefit: 'Angajații în ture ajung la lucru fără mașină. Curba mare permite trecerea fără frânări bruște, iar cartierul Vatra primește legătură directă cu gara, cu hub-ul și cu aeroporturile.',
    data: [['Lângă', 'stația CFR Pașcani Triaj'], ['Viraj spre hub', 'la dreapta, rază 500 m'], ['Locuitori în raza de 500 m', '≈ 2.000']],
    view: viewAt(stops[3].s, 60, 30),
  });
  const sStream = (route.streams && route.streams[0] && route.streams[0].s) || 2893;
  add({
    id: 't1-pod-panta', category: 'safety', title: 'Pod peste pârâu și urcarea spre nod',
    position: at(sStream, 7),
    what: `După curba de la Triaj, linia trece pe un pod scurt peste pârâul care curge spre Siret, apoi traversează DJ208 și urcă pe lângă DJ208L până la nod. Diferența de nivel este de ${Math.round(route.climb)} m, iar panta maximă este de ${nf(route.maxGrade * 100, 1)} %, cu racordări line și rambleuri acolo unde terenul coboară.`,
    why: 'Nodul A7 × A8 este pe terasa de vest, la aproape 45–50 m deasupra gării. Am limitat panta la 3,5 %, sub valoarea pe care tramvaiele moderne o urcă fără probleme. Podul lasă loc apei la viituri.',
    benefit: 'Urcarea este confortabilă și sigură și iarna. Profilul neted economisește energie, pentru că tramvaiul recuperează la coborâre o parte din energia folosită la urcare. Podul nu blochează curgerea apei și protejează linia la inundații.',
    data: [['Urcare totală', `${nf(route.climb, 1)} m`], ['Panta maximă', `${nf(route.maxGrade * 100, 1)} %`], ['Lungime pod', '≈ 30 m'], ['Gabarit peste apă', '≈ 3 m']],
    view: viewAt(sStream, 70, 30),
  });

  // culoarul comun T1 + drumul nou (DJ208L relocat), calculat de modulul autostrazilor (road-clear.js / t1Pins)
  if (motorway && motorway.pins && motorway.pins.length) {
    const ss = motorway.pins.map((p) => p.s);
    const sA = Math.min(...ss), sB = Math.max(...ss), sM = (sA + sB) / 2;
    const lenC = Math.max(10, Math.round((sB - sA) / 10) * 10);
    add({
      id: 't1-trecere', category: 'safety', title: 'T1 pe platformă proprie lângă DJ208L (relocat)',
      position: at(sM, 6),
      what: `Înainte de hub, linia T1 și drumul județean DJ208L, mutat pe un traseu nou odată cu construcția nodului, folosesc același culoar pe circa ${lenC} m. Tramvaiul are aici o platformă proprie, înierbată, ridicată cu o bordură față de carosabil, iar mașinile circulă pe lângă ea. Locul unde drumul trece de pe o parte pe cealaltă a liniei este o trecere la nivel semnalizată.`,
      why: 'Un pod sau un pasaj pentru un drum județean cu trafic mic ar costa mult și ar lungi urcarea tramvaiului. Platforma separată prin bordură împiedică mașinile să intre pe linie, iar trecerea semnalizată este soluția folosită de rețelele moderne de tramvai.',
      benefit: 'Tramvaiul nu stă în coloană cu mașinile și primește prioritate la semafor: culoarea roșie pentru mașini apare cu câteva secunde înainte de sosirea lui. Lumini intermitente și marcaje tactile pentru pietoni fac traversarea sigură.',
      data: [['Poziție pe linie', `km ${nf(sA / 1000, 2)} – ${nf(sB / 1000, 2)}`], ['Tip', 'platformă proprie + trecere cu prioritate T1'], ['Detecție tramvai', 'automată, cu ≈ 20 s înainte'], ['Semnalizare', 'semafor + lumini intermitente']],
      view: viewAt(sM, 45, 20),
    });
  }

  // ---------------- nodul turbion ----------------
  const nx = motorway ? motorway.nodeXZ.x : ctx.geo.project(47.21388, 26.70568).x;
  const nz = motorway ? motorway.nodeXZ.z : ctx.geo.project(47.21388, 26.70568).z;
  const ny = H(nx, nz);
  add({
    id: 'nod-turbion', category: 'mobility', title: 'Nodul turbion A7 × A8',
    position: V(nx, ny + 30, nz),
    what: 'Este primul nod rutier de tip „turbină” din România. Autostrada Moldovei A7 (Bacău – Pașcani – Suceava) se intersectează cu Autostrada Unirii A8 (Târgu Neamț – Iași – Ungheni). Opt bretele curbe trec pe pasaje, una peste alta, astfel încât fiecare direcție are drumul ei, fără semafoare și fără intersecții la același nivel.',
    why: 'Prin acest nod trec traficul de pe axa nord–sud a Moldovei și cel de pe axa vest–est spre Iași și Republica Moldova. Forma de turbină permite viteze mari pe bretele, de 80 km/h, și ocupă mai puțin teren decât alte noduri complet direcționale.',
    benefit: 'Nodul are trafic fluent și sigur, cu mai puține frânări bruște și accidente. Este exact locul în care autocarele spre aeroporturile Iași, Suceava și Bacău pot prelua călătorii aduși de tramvaiul T1.',
    data: [['Amplasare', 'A7 km 71+374, Pașcani – Sodomeni'], ['Bretele', '8 (80 km/h, raze 400–600 m)'], ['Pasaje', '12 (8 pe A7, 4 pe A8)'], ['Podețe', '5'], ['Suprafață', '≈ 220 ha, ≈ 2 km lungime'],
      ['Niveluri de circulație', motorway ? `sol + pasaje la ≈ +${nf(Math.min(motorway.maxLift, 99), 1)} m (din OSM)` : 'sol + pasaje'],
      ['Contract', 'A7 Lot 3 Mircești – Pașcani (UMB, PNRR)'], ['Deschidere', 'țintă: sfârșitul lui 2026']],
    source: 'CNAIR / DRDP Iași, presa (2025–2026), OpenStreetMap',
    view: { position: V(nx + 1100, ny + 750, nz - 900), target: V(nx, ny, nz) },
  });
  if (motorway) {
    add({
      id: 'a7-a8-pasaje', category: 'safety', title: 'Pasaje, pile și poduri peste Zmeul',
      position: V(nx + 120, ny + 18, nz - 60),
      what: `Modelul este construit din datele OpenStreetMap ale șantierului: ${motorway.ways.length} tronsoane de autostradă, bretele și drumuri relocate, dintre care ${motorway.bridges} sunt marcate ca poduri. Cele ${motorway.crossings.length} locuri în care două drumuri se încrucișează în plan sunt toate pasaje: A7 rămâne la sol, iar A8 și bretelele trec peste ea pe poduri, la circa +7,5 m, sprijinite pe ${motorway.piers} de pile.`,
      why: 'Într-un nod de autostradă nu are voie să existe nicio intersecție la același nivel, pentru că mașinile circulă cu 80–130 km/h. Cotele au fost calculate din etichetele „pod” și „nivel” din OpenStreetMap, cu rampe de cel mult 4,5 %. Pârâul Zmeul, care curge chiar la sud de nod, trece pe sub drumuri prin poduri.',
      benefit: `Circulația curge fără opriri și fără conflicte, iar între două tabliere suprapuse rămân cel puțin ${nf(Math.max(0, motorway.minDy - 1.9), 1)} m de gabarit liber pentru camioane. Parapetele New Jersey și iluminatul LED cresc siguranța noaptea, iar apa trece pe sub terasamente fără să le inunde.`,
      data: [['Tronsoane modelate', String(motorway.ways.length)], ['Intersecții în plan', `${motorway.crossings.length}, toate denivelate`], ['Diferență minimă de cotă', `${nf(motorway.minDy, 1)} m (tablier 1,9 m)`], ['Cotă maximă', `+${nf(motorway.maxLift, 1)} m față de teren`], ['Pile', String(motorway.piers)], ['Iluminat', 'LED, stâlpi de 11 m']],
      view: { position: V(nx + 260, ny + 90, nz - 220), target: V(nx, ny + 5, nz) },
    });
  }

  // ---------------- hub ----------------
  const hc = hub.center;
  add({
    id: 'hub-turbion', category: 'mobility', title: 'Hub Turbion A7×A8 – gara „3 în 1”',
    position: hc.clone().add(V(0, hub.roofY - hc.y + 6, 0)),
    what: 'Hub Turbion A7×A8 este un terminal intermodal aflat la capătul liniei T1, lângă nodul turbion. Sub un acoperiș mare cu panouri solare găsești peronul tramvaiului, o sală de așteptare vitrată, peroane pentru autocarele spre aeroporturi, parcare Park & Ride, încărcătoare pentru mașini electrice, biciclete la închiriere și un vertiport pentru taxiuri aeriene electrice.',
    why: 'Tema cere o gară „3 în 1”: tren clasic (CFR) + tren ușor + autostradă. Gara istorică nu poate ajunge la autostradă, așa că am adus autostrada „lângă gară” printr-un tramvai rapid și un terminal unde schimbi mijlocul de transport în câțiva pași, sub același acoperiș.',
    benefit: 'Cu un singur bilet integrat ajungi din trenul CFR, prin T1, în autocarul spre aeroport. Pașcaniul devine poarta de intrare în Moldova pentru turiștii care aterizează la Iași, Suceava sau Bacău, și invers.',
    data: [['Acoperiș fotovoltaic', '≈ 7.200 m² · ≈ 1,4 MWp'], ['Peroane autocare', '4 (3 spre aeroporturi)'], ['Park & Ride', '≈ 180 locuri'], ['Transfer T1 → autocar', 'sub 3 minute pe jos'], ['Bilet integrat', 'CFR + T1 + autocar']],
    view: { position: hub.toWorld(110, hub.levelB + 70, -90), target: hub.toWorld(-4, hub.levelB, 40) },
    walk: { position: hub.walkStart.position.clone(), yaw: hub.walkStart.yaw },
  });
  add({
    id: 'hub-aeroporturi', category: 'mobility', title: 'Autocare directe spre 3 aeroporturi',
    position: hub.coachBay.clone().add(V(0, 9, 0)),
    what: 'De pe peroanele hub-ului pleacă autocare electrice direct pe autostradă: spre Aeroportul Iași (IAS) pe A8 Est, spre Suceava (SCV) pe A7 Nord și spre Bacău (BCM) pe A7 Sud. Fiecare linie are culoarea ei pe indicatoare, pe afișaje, pe benzile luminoase de pe autostradă și pe harta din aplicație. Autocarele au bretele proprii: spre Suceava și Bacău ies pe breteaua 104 a nodului, iar spre Iași urcă pe un pod nou peste A8 și intră pe A8 Est pe o bandă de accelerare. La întoarcere, autocarele din Suceava și Bacău ies de pe A8 Est pe o buclă, trec înapoi peste autostradă și ajung pe drumul colector al hub-ului.',
    why: 'Pașcaniul este aproape la egală distanță de cele trei aeroporturi ale Moldovei. Nodul turbion este singurul punct din care toate trei se pot atinge direct pe autostradă, fără să treci prin centrul vreunui oraș.',
    benefit: 'Un călător din Pașcani, Târgu Neamț sau Fălticeni ajunge la avion în mai puțin de o oră, la un preț mic și fără să lase mașina zile întregi în parcarea aeroportului. Codurile de culoare fac orientarea simplă și pentru turiștii străini.',
    data: [['Iași IAS', '81 km · ≈ 55 min · A8 Est'], ['Suceava SCV', '62 km · ≈ 45 min · A7 Nord'], ['Bacău BCM', '91 km · ≈ 60 min · A7 Sud'], ['Frecvență', 'la 30 min (vârf), la 60 min (rest)'], ['Autocare', 'electrice, 50 locuri, Wi-Fi'], ['Bretele hub', 'colector + 4 bretele, 2 poduri peste A8, raze ≥ 60 m, pante ≤ 5 %']],
    view: { position: hub.toWorld(-20, hub.levelB + 22, 115), target: hub.toWorld(-4, hub.levelB + 2, 66) },
  });
  add({
    id: 'hub-park-ride', category: 'eco', title: 'Park & Ride cu încărcare rapidă',
    position: hub.parking.clone().add(V(0, 8, 0)),
    what: 'Este o parcare de tip „parchează și călătorește” cu aproximativ 180 de locuri, acoperită parțial cu copertine fotovoltaice. Pe primul rând sunt 22 de încărcătoare rapide pentru mașini electrice, iar la intrarea în hub se află o stație de biciclete la închiriere.',
    why: 'Locuitorii din satele din jur (Sodomeni, Boșteni, Stolniceni-Prăjescu) vin cu mașina până la hub și continuă cu T1 spre oraș sau cu autocarul spre aeroport. Astfel nu mai intră cu mașina în centrul Pașcaniului.',
    benefit: 'Centrul orașului are mai puțin trafic și mai puțină poluare. Energia solară produsă chiar deasupra mașinilor le încarcă bateriile, iar o mașină electrică se încarcă cât timp proprietarul ei e la Iași.',
    data: [['Locuri parcare', '≈ 180'], ['Încărcătoare rapide', '22 × 150 kW'], ['Copertine PV', '≈ 2.600 m² · ≈ 0,5 MWp'], ['Biciclete la închiriere', '14 + stație de încărcare']],
    view: { position: hub.toWorld(60, hub.levelP + 35, 175), target: hub.parking },
  });
  add({
    id: 'hub-vertiport', category: 'mobility', title: 'Vertiport eVTOL (viitor)',
    position: hub.vertiport.clone().add(V(0, 8, 0)),
    what: 'Pe acoperișul hub-ului este amenajată o platformă de aterizare pentru taxiuri aeriene electrice, aeronave eVTOL care decolează și aterizează vertical. În model, un eVTOL de test decolează și aterizează cam o dată la două minute.',
    why: 'Până în 2040 se așteaptă ca primele rute regionale cu eVTOL să lege orașele de aeroporturi. Hub-ul are deja energie solară, acces rapid și spațiu liber, deci acoperișul pregătit acum evită costuri mai târziu.',
    benefit: 'Pentru urgențe medicale sau zboruri de afaceri, Iașiul ar fi la circa 20 de minute. Pașcaniul ar fi pregătit pentru mobilitatea aeriană a viitorului, fără zgomotul și emisiile unui elicopter clasic.',
    data: [['Diametru platformă', '24 m'], ['Zbor Pașcani → Iași', '≈ 20 min (≈ 75 km)'], ['Alimentare', '100 % electrică, din PV + baterii'], ['Stadiu', 'pregătit pentru viitor (2035+)']],
    view: { position: hub.vertiport.clone().add(V(50, 35, -40)), target: hub.vertiport },
  });
  add({
    id: 'hub-energie', category: 'energy', title: 'Acoperiș solar și baterii la hub',
    position: hub.toWorld(-40, hub.roofY + 4, 10),
    what: 'Acoperișul mare al hub-ului, de aproximativ 104 × 69 m, este acoperit cu panouri fotovoltaice și are fâșii vitrate pentru lumină naturală. Copertinele peroanelor și ale parcării au și ele panouri solare. Energia produsă este stocată în baterii staționare de 2 MWh.',
    why: 'Un terminal care încarcă tramvaie, autocare electrice și mașini are nevoie de multă energie. Dacă o produce chiar pe acoperiș, rețeaua orașului nu este suprasolicitată și costurile scad.',
    benefit: 'Hub-ul produce anual circa 2,3 GWh, cât consumă aproximativ 900 de locuințe. Ziua tramvaiele și autocarele merg cu energie solară, iar seara bateriile preiau vârful de consum.',
    data: [['Putere PV totală', '≈ 1,9 MWp'], ['Producție anuală', '≈ 2,3 GWh'], ['Baterii staționare', '2 MWh'], ['CO₂ evitat', '≈ 600 t / an']],
    view: { position: hub.toWorld(80, hub.roofY + 60, -70), target: hub.toWorld(-6, hub.roofY, 25) },
  });
  if (airports && airports.signs.length) {
    const s0 = airports.signs[0].position;
    add({
      id: 'a7-indicatoare', category: 'info', title: 'Indicatoare și benzi spre aeroporturi',
      position: s0.clone().add(V(0, 6, 0)),
      what: 'Înainte de nod, pe A7 și A8, portalurile au indicatoare albastre de autostradă cu pictograma avionului, direcția și distanța: Iași IAS 81 km (A8 Est), Suceava SCV 62 km (A7 Nord), Bacău BCM 91 km (A7 Sud). Pe benzi, linii luminoase colorate arată drumul spre fiecare aeroport.',
      why: 'Șoferii străini și cei care trec pentru prima dată printr-un nod turbion trebuie să aleagă banda corectă din timp. Culorile sunt aceleași ca pe biletele, afișajele și harta hub-ului, deci recunoști ușor linia ta.',
      benefit: 'Schimbările bruște de bandă, una dintre principalele cauze de accidente în noduri, devin mai rare. Orientarea este intuitivă și noaptea, pentru că marcajele luminoase se văd mai bine decât vopseaua obișnuită.',
      data: [['Portaluri', `${airports.gantries} (pe fiecare direcție de intrare)`], ['Distanță față de nod', '≈ 1 km'], ['Culori linii', 'IAS albastru · SCV mov · BCM portocaliu']],
      view: { position: s0.clone().add(V(60, 25, 60)), target: s0.clone() },
    });
  }

  // ---------------- tur ghidat ----------------
  const T = ctx.tourSteps;
  const vp = (h) => h.view;
  const get = (id) => ctx.hotspots.list.find((h) => h.id === id);
  const step = (order, title, text, id, extra = {}) => { const h = get(id); if (h) T.push({ order, title, text, view: vp(h), hotspot: id, ...extra }); };
  step(50, 'Tramvaiul ușor T1', `De lângă Peronul 1 Sud al Gării Pașcani pleacă tramvaiul ușor T1, o linie nouă de ${nf(L / 1000, 1)} km cu ${stops.length} stații. În aproximativ ${tripMin} minute ajunge la Hub Turbion, lângă nodul autostrăzilor A7 × A8. Așa, trenul CFR, tramvaiul și autostrada devin o singură rețea.`, 't1-linia', { hold: 13 });
  step(51, 'Peron la peron', 'Trenul CFR oprește pe o parte a Peronului 1 Sud, tramvaiul pe cealaltă. Treci dintr-unul în altul în câțiva pași, la același nivel, fără scări și fără să traversezi linii.', 't1-transfer', { hold: 11 });
  step(53, 'Pe calea ferată, nu pe străzi', 'Tramvaiul merge pe linie proprie în culoarul căii ferate existente, între liniile CFR și Str. Gării. Nu ocupă nicio stradă, Str. Gării rămâne pentru autobuze și mașini, iar în oraș nu are treceri la nivel cu străzi aglomerate.', 't1-culoar-cf', { hold: 13 });
  step(54, 'Fără fire, pe baterii', 'T1 nu are catenară proprie, deci nu apar stâlpi și fire noi. La capete de linie, un colector de pe acoperiș se ridică sub o șină de încărcare și reîncarcă bateriile în câteva minute, cât timp călătorii urcă.', 't1-baterii', { hold: 12 });
  step(56, 'Stații accesibile', 'Peronul este la nivelul podelei tramvaiului, deci se urcă fără nicio treaptă, inclusiv cu scaun cu rotile sau cu cărucior. Fiecare stație are bandă tactilă, afișaj în timp real, acoperiș solar și coșuri pentru colectare selectivă.', 't1-statii', { hold: 12 });
  step(58, 'Balast și gazon', 'Lângă liniile CFR, calea tramvaiului este pe piatră spartă și traverse de beton, ca restul căii ferate. Pe linia nouă spre hub, între șine crește gazon, iar noaptea o bordură cu LED marchează culoarul tramvaiului.', 't1-cale-inierbata', { hold: 11 });
  step(61, 'Stația Centru – Spital', 'Tramvaiul trece pe sub podul rutier DN28A, fără semafor. Din stația de lângă pod urci cu liftul panoramic sau pe scări direct pe trotuarul podului, spre Spitalul Municipal, Primărie și centrul vechi.', 't1-statie-centru', { hold: 12 });
  step(64, 'La Triaj, la dreapta', 'Stația Triaj servește cartierul Vatra și pe cei care lucrează la calea ferată. Aici tramvaiul părăsește culoarul CF și virează la dreapta, pe o curbă largă de 500 m, spre nodul autostrăzilor.', 't1-triaj', { hold: 11 });
  step(67, 'Urcarea spre nod', `După curbă, linia trece pe un pod peste pârâu, apoi urcă ${Math.round(route.climb)} m până pe terasa nodului. Panta este de cel mult ${nf(route.maxGrade * 100, 1)} %, deci urcarea e lină și sigură și iarna.`, 't1-pod-panta', { hold: 11 });
  step(69, 'Trecerea peste DJ208L', 'Înainte de hub, tramvaiul traversează la nivel drumul județean mutat pentru nod. Semaforul îi dă prioritate tramvaiului, iar luminile intermitente avertizează șoferii.', 't1-trecere', { hold: 10 });
  step(70, 'Nodul turbion A7 × A8', 'Aici se întâlnesc Autostrada Moldovei A7 și Autostrada Unirii A8, în primul nod de tip turbină din România. Opt bretele curbe, 12 pasaje și circa 220 ha permit fiecărei direcții să-și aibă drumul ei, fără semafoare.', 'nod-turbion', { dur: 4, hold: 13 });
  step(73, 'Pasaje și poduri', 'Toate locurile în care drumurile se încrucișează sunt pasaje: A7 rămâne la sol, iar A8 și bretelele trec pe poduri, deasupra ei. Pârâul Zmeul curge pe sub autostradă prin poduri, fără să inunde terasamentele.', 'a7-a8-pasaje', { hold: 12 });
  step(76, 'Hub Turbion – gara „3 în 1”', 'Hub-ul este a doua jumătate a gării: aici cobori din tramvai și urci în autocar sau în mașină, sub același acoperiș solar. Tren clasic, tren ușor și autostradă sunt legate cu un singur bilet.', 'hub-turbion', { hold: 13 });
  step(79, 'Spre aeroporturi', 'Din hub pleacă autocare electrice direct spre aeroporturile din Iași, Suceava și Bacău. Fiecare linie are culoarea ei: albastru pentru Iași, mov pentru Suceava și portocaliu pentru Bacău.', 'hub-aeroporturi', { hold: 12 });
  step(82, 'Indicatoare pe autostradă', 'Înainte de nod, portalurile cu indicatoare albastre arată pictograma avionului, direcția și distanța până la fiecare aeroport. Benzi luminoase în aceleași culori îi ghidează pe șoferi pe banda corectă.', 'a7-indicatoare', { hold: 12 });
  step(85, 'Park & Ride și încărcare', 'Cine vine din satele din jur își lasă mașina la hub, o încarcă de la soare și continuă cu T1 spre oraș sau cu autocarul spre aeroport. Astfel, centrul Pașcaniului are mai puțin trafic.', 'hub-park-ride', { hold: 11 });
  step(87, 'Energie solară la hub', 'Acoperișul și copertinele hub-ului au panouri fotovoltaice care produc circa 2,3 GWh pe an. Bateriile staționare păstrează energia pentru seară, când tramvaiele și autocarele se încarcă.', 'hub-energie', { hold: 11 });
  step(89, 'Vertiportul viitorului', 'Pe acoperiș am pregătit o platformă pentru taxiuri aeriene electrice (eVTOL), care decolează vertical. În viitor, Iașiul ar putea fi la 20 de minute de zbor, fără zgomotul unui elicopter.', 'hub-vertiport', { hold: 11 });

  // ---------------- Locuri ----------------
  const mid = route.pos(L * 0.45);
  ctx.places.push(
    { name: 'Traseul T1', sub: `Gara → Hub Turbion · ${nf(L / 1000, 1)} km`, icon: '🚊', view: { position: mid.clone().add(V(-1800, 2300, -600)), target: mid.clone() } },
    { name: 'Hub Turbion (plimbare)', sub: 'Peronul T1 → hol, etaj, acoperiș, autocare, parcare', icon: '🚶', walk: { position: hub.walkStart.position.clone(), yaw: hub.walkStart.yaw } },
    { name: 'Nodul turbion (vedere)', sub: 'A7 × A8 · Pașcani – Sodomeni', icon: '🌀', view: { position: V(nx + 1100, ny + 750, nz - 900), target: V(nx, ny, nz) } },
    { name: 'Stația Centru – Spital', sub: 'T1 · lift și scări spre podul DN28A', icon: '🏥', view: viewAt(stops[2].s, 60, 28) },
    { name: 'T1 în culoarul CF', sub: 'linie proprie lângă calea ferată', icon: '🛤️', view: viewAt(900, 90, 45, -1) },
  );
}
