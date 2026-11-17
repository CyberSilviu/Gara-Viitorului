import * as THREE from 'three';
import { toWorld, E, A } from './frame.js';

// Textele explicative (ce este / de ce / ce avantaj) — ce vor prezenta elevii — plus turul ghidat si locurile.
// Toate pozitiile sunt date in sistemul LOCAL al garii (x spre linii, z de-a lungul axei spre SSE) si convertite in coordonate lume.

export const W = (lx, y, lz) => { const [x, z] = toWorld(lx, lz); return new THREE.Vector3(x, y, z); };
export const view = (p, t) => ({ position: W(...p), target: W(...t) });
// yaw pentru a privi in directia locala (dlx, dlz)
export const yawLocal = (dlx, dlz) => { const dx = dlx * E.x + dlz * A.x, dz = dlx * E.z + dlz * A.z; return Math.atan2(-dx, -dz); };
export const walk = (lx, y, lz, dlx, dlz) => ({ position: W(lx, y, lz), yaw: yawLocal(dlx, dlz) });

// Vederea de ansamblu a garii: ≈ 280 m de centrul complexului, la 30° deasupra orizontului, dinspre piata (VSV).
export const OVERVIEW = view([-182, 142, 150], [12, 2, 5]);

// Etichetele „minore” se vad din vederea aeriana doar de aproape (sub MINOR_ORBIT_D metri),
// ca de sus sa ramana vizibile doar cele 6 principale.
export const MINOR_ORBIT_D = 210;
const MAIN = new Set(['gara-istorica', 'hol-viitorului', 'pasarela', 'pv-copertine', 'piata-verde', 'autogara']);

const fmt = (n, d = 0) => n.toLocaleString('ro-RO', { maximumFractionDigits: d, minimumFractionDigits: d });

export function addStationInfo(ctx, info) {
  const { pvArea, pvKWp, batteryKWh, deckY, platY, counts } = info;
  const pvMWh = (pvKWp * 1150) / 1000; // ~1150 kWh/kWp/an in Moldova
  const co2 = pvMWh * 0.27;
  const H = [
    // ---------------- patrimoniu ----------------
    {
      id: 'gara-istorica', category: 'heritage', title: 'Clădirea istorică restaurată',
      position: W(-10.5, 17, -2.6),
      what: 'Clădirea de călători, lungă de circa 116 m, își păstrează forma reală din OpenStreetMap: corpul central cu etaj și acoperiș în patru ape, două aripi retrase, două pavilioane de capăt și porticul cu stâlpi pătrați de pe peronul 1. Fațadele sunt restaurate în culori deschise, iar ceasul și inscripția „PAȘCANI” revin pe ambele laturi.',
      why: 'Gara este simbolul nodului feroviar Pașcani, unde trenurile opresc din 1869–1870, de la deschiderea liniei Roman – Pașcani – Iași. În loc să o demolăm, o consolidăm și o refolosim, așa cum prevedea și proiectul CFR din 2023 pentru corpul central și cele două corpuri laterale, rămas blocat după anularea licitației.',
      benefit: 'Orașul își păstrează identitatea, iar construcțiile noi din lemn și sticlă se alătură discret, fără să ascundă fațada veche. Reabilitarea unei clădiri existente produce mult mai puțin CO₂ decât demolarea și construirea uneia noi.',
      data: [['Lungime fațadă', '≈ 116 m'], ['Adâncime', '15,5 – 20 m'], ['Orientare ax', '158° / 338° (paralel cu liniile)'], ['Proiect CFR 2023', '33,98 mil. lei (licitație anulată)']],
      view: view([-75, 22, 30], [0, 6, -5]),
    },
    {
      id: 'electroputere', category: 'heritage', title: 'Atelierele CFR (Electroputere VFU), 1876',
      position: W(115, 16, 0),
      what: 'La est de linii se află fostele Ateliere CFR Pașcani, înființate în 1876 și declarate monument istoric. În 1925 lucrau aici peste 1.000 de oameni, iar astăzi Electroputere VFU modernizează aici vagoane pentru CFR Călători.',
      why: 'Calea ferată a despărțit mereu orașul de acest cartier și de istoria lui industrială. Pasarela leagă pentru prima dată direct gara de ateliere și de strada din est.',
      benefit: 'Locuitorii din est ajung în câteva minute la gară și la trenul ușor T1. O parte din atelierele vechi ar putea găzdui un muzeu al căii ferate, o atracție nouă pentru turiști.',
      data: [['Înființare', '1876'], ['Angajați în 1925', '> 1.000'], ['Azi', 'Electroputere VFU Pașcani'], ['Acces din gară', 'prin pasarelă (≈ 100 m)']],
      view: view([40, 40, -150], [110, 4, -10]),
    },

    // ---------------- informare ----------------
    {
      id: 'hol-viitorului', category: 'info', title: 'Holul Viitorului (lemn și sticlă)',
      position: W(-17, 12.6, -37),
      what: 'Un hol nou și luminos, de circa 550 m², lipit de fațada vestică a aripii de nord. Structura este din grinzi curbe de lemn lamelar, pereții sunt din sticlă, iar acoperișul ondulat coboară spre clădirea veche, astfel încât fațada istorică devine peretele interior al holului.',
      why: 'Gara de azi nu are un spațiu de așteptare modern, încălzit și accesibil. Am ales lemnul pentru că stochează carbon și se montează repede din elemente prefabricate, iar sticla aduce lumină naturală și lasă la vedere clădirea istorică.',
      benefit: 'Într-un singur loc călătorii găsesc bilete, informații, cafenea, toalete, dulapuri pentru bagaje și sală de așteptare. Holul leagă direct piața, trenul ușor T1 și autobuzele de peroane, printr-un pasaj în rampă de 4 % prin aripa istorică.',
      data: [['Suprafață', '≈ 550 m²'], ['Înălțime liberă', '6 – 9,6 m'], ['Structură', 'lemn lamelar încleiat (GL24)'], ['Locuri de așteptare', '≈ 60']],
      view: view([-48, 14, -60], [-14, 4, -28]),
      walk: walk(-20.5, 0.42, -29.5, 1, 0),
    },
    {
      id: 'tabela-digitala', category: 'info', title: 'Peretele digital de informare',
      position: W(-17.4, 7.9, -47.3),
      what: 'Un ecran LED de 8 × 4 m afișează în timp real plecările trenurilor CFR – InterRegio și Regio spre București Nord, Suceava, Iași, Cluj-Napoca, Timișoara Nord, Târgu Neamț, Bacău, Roman și Vicșani – și ale trenului ușor T1 spre Hub-ul Turbion A7 × A8. Pentru fiecare tren apar ora, linia și eventuala întârziere, iar un al doilea ecran repetă informația deasupra pasajului spre peroane.',
      why: 'Pașcani este nod feroviar: aici se schimbă trenul între magistrala 500 și liniile spre Iași (606) și Târgu Neamț (517). Călătorul trebuie să afle din prima privire de pe ce linie pleacă și dacă trenul are întârziere.',
      benefit: 'Informația este clară, vizibilă de la intrare și sincronizată cu ecranele de pe peroane și cu aplicația mobilă. În model, orarul este o simulare realistă care urmează ora aleasă în tabloul de bord și se actualizează la fiecare secundă.',
      data: [['Dimensiune', '8 × 4 m, LED'], ['Actualizare', 'la fiecare secundă'], ['Plecări afișate', '9'], ['Consum', '≈ 1,2 kW (luminozitate automată)']],
      view: view([-16, 4.2, -27], [-17.4, 5.2, -47.9]),
      walk: walk(-17, 0.42, -27, 0, -1),
    },
    {
      id: 'orientare-led', category: 'info', title: 'Orientare inteligentă cu linii LED',
      position: W(-12.5, 2.6, -28.6),
      what: 'Patru linii luminoase încastrate în pardoseală pornesc din hol: verde spre peroanele CFR, portocaliu prin pasaj pe Peronul 1 și apoi spre sud, la stația trenului ușor T1 (Peronul 1 Sud), albastru spre autobuze și autogară, mov spre pasarelă. Deasupra lor, panouri suspendate cu pictograme repetă aceleași culori, iar totemurile digitale din piață arată harta gării.',
      why: 'Într-o gară „3 în 1” oamenii trebuie să găsească drumul fără să citească texte lungi – turiști, copii, vârstnici sau străini. Aceleași culori apar pe hartă, pe semne și în aplicație, deci sistemul se învață într-un minut.',
      benefit: 'Transferul dintre tren și T1 durează doar 2–3 minute, sunt mai puține întrebări la ghișeu și mai puțină aglomerație. Noaptea liniile se aprind mai puternic, iar în caz de urgență pot deveni săgeți spre cea mai apropiată ieșire.',
      data: [['Culori / destinații', '4'], ['Lungime linii', '≈ 260 m'], ['Tehnologie', 'LED IP67, ≈ 4 W/m'], ['Transfer tren → T1', '≈ 2–3 min']],
      view: view([-25, 6, -22], [-12, 0.4, -29]),
      walk: walk(-21, 0.42, -28.8, 1, 0),
    },
    {
      id: 'afisaj-peron', category: 'info', title: 'Ecrane de peron',
      position: W(16.6, 5.0, 46),
      what: 'Pe fiecare peron, ecrane cu două fețe arată linia, tipul și numărul trenului, destinația și ora (de exemplu „Linia 4 · IR 1663 · Iași · 14:32”). Când trenul intră în stație ecranul afișează „Sosește”, iar cât timp stă la peron, „Îmbarcare”.',
      why: 'Când se schimbă linia sau apare o întârziere, trebuie anunțați imediat și călătorii care așteaptă deja pe peron, nu doar cei din hol. Ecranele sunt legate de același sistem ca tabela mare.',
      benefit: 'Mai puține alergări de pe un peron pe altul și o îmbarcare mai rapidă. Textul mare se citește de la 30 m, iar informația este repetată prin anunțuri sonore pentru persoanele cu deficiențe de vedere.',
      data: [['Ecrane', `${counts.displays} (cu 2 fețe)`], ['Sursă date', 'sistemul CFR + T1, în timp real'], ['Luminozitate', 'automată zi / noapte']],
      view: view([13, 3.0, 30], [16.6, 4.0, 46]),
      walk: walk(12.5, platY, 32, 0, 1),
    },

    // ---------------- accesibilitate ----------------
    {
      id: 'acces-pmr', category: 'access', title: 'Accesibilitate pentru toți (PMR)',
      position: W(-16.4, 2.7, -37.2),
      what: 'Benzi tactile galbene conduc persoanele nevăzătoare de la intrare la punctul de informare, apoi prin pasaj pe peronul 1 și până la lift. Ghișeul are o porțiune coborâtă la 78 cm, automatele de bilete au ecranul și fanta la înălțime accesibilă, iar pasajul spre peroane este o rampă de 4 %, sub limita de 6 %.',
      why: 'Astăzi peroanele 2 și 3 se ating doar traversând liniile la nivel – imposibil pentru o persoană în scaun rulant sau cu un cărucior. Legea și normativul NP 051 cer acces fără bariere în clădirile publice.',
      benefit: 'Oricine poate călători singur și în siguranță: persoane cu dizabilități, vârstnici, părinți cu cărucioare, călători cu bagaje grele. Peroanele înălțate la 55 cm permit urcarea la nivel în trenurile noi.',
      data: [['Pantă maximă rampe', '6 % (pasajul: 4 %)'], ['Ghișeu coborât', '78 cm'], ['Benzi tactile', '≈ 180 m'], ['Lifturi', '5']],
      view: view([-27, 5, -40], [-16, 0.4, -33]),
      walk: walk(-25, 0.36, -30.6, 1, 0),
    },
    {
      id: 'lifturi', category: 'access', title: 'Lifturi panoramice la fiecare peron',
      position: W(42.9, deckY + 4.6, -71.8),
      what: 'Cinci lifturi cu cabină de sticlă (1000 kg, 13 persoane) leagă pasarela de peroanele 1, 2 și 3, de piața gării și de latura de est. Puțurile sunt vitrate, așa că cabina se vede din toate părțile.',
      why: 'Scările singure nu ajung: un călător în scaun rulant, cu bicicletă, cu cărucior sau cu bagaje mari trebuie să poată schimba peronul fără ajutor. De aceea fiecare peron are propriul lift, chiar lângă scară.',
      benefit: 'Acces fără trepte pe toate peroanele; sticla crește siguranța, pentru că nu există colțuri ascunse, și face lifturile ușor de găsit. Motoarele recuperează energie la coborâre, iar în model cabinele chiar circulă – puteți intra în ele în modul plimbare.',
      data: [['Număr', '5'], ['Capacitate', '1000 kg / 13 pers.'], ['Viteză', '1 m/s'], ['Diferență de nivel', '7,5 – 8,2 m']],
      view: view([30, 6, -92], [42.9, 5, -71.8]),
      walk: walk(42.9, platY, -78, 0, 1),
    },

    // ---------------- siguranta ----------------
    {
      id: 'pasarela', category: 'safety', title: 'Pasarela peste linii',
      position: W(22, deckY + 5.2, -68),
      what: `O pasarelă vitrată de circa 85 m traversează toate cele 6 linii la ${fmt(deckY, 1)} m înălțime, peste catenara de 25 kV. Coboară cu scări și lifturi pe fiecare peron, în piața gării și în cartierul de est (Electroputere), iar acoperișul ei este acoperit cu panouri fotovoltaice.`,
      why: 'Gara Pașcani nu are pasaj subteran: azi călătorii traversează liniile la nivel, printre trenuri, iar singura pasarelă este la 400 m nord. Un pasaj subteran ar fi fost mult mai scump și dificil în lunca Siretului, unde apa freatică este aproape de suprafață.',
      benefit: 'Dispare riscul de accidente pe linii, iar cartierele despărțite de calea ferată sunt legate direct. Reazemele sunt doar pe peroane, fără stâlpi între linii, deci circulația trenurilor nu este încurcată nici în timpul construcției.',
      data: [['Lungime', '≈ 85 m'], ['Cota de mers', `${fmt(deckY, 1)} m`], ['Lățime utilă', '≈ 4,9 m'], ['Acces', '5 scări + 5 lifturi']],
      view: view([-30, 30, -125], [22, 6, -68]),
      walk: walk(5, deckY, -68, 1, 0),
    },
    {
      id: 'peroane-inaltate', category: 'safety', title: 'Peroane înălțate și margini luminoase',
      position: W(42.9, 8.2, 60),
      what: 'Trei peroane noi – unul lateral și două insule – de 246–280 m, înălțate la 55 cm deasupra șinei. Fiecare margine are bordură albă, bandă tactilă galbenă cu buline și o bandă LED care pulsează portocaliu când se apropie un tren și devine albă când trenul a oprit.',
      why: 'Peroanele de azi sunt joase, cu pavele vechi, iar urcarea în vagon se face pe trepte înalte. Lungimea de cel puțin 250 m este cerută de CFR pentru trenurile lungi de pe magistrala 500.',
      benefit: 'Urcarea la nivel este mai rapidă și mai sigură, inclusiv cu bagaje sau cu un cărucior. Călătorii văd de departe zona în care nu au voie să stea când intră trenul, iar nevăzătorii simt marginea peronului cu talpa.',
      data: [['Înălțime', '55 cm peste șină'], ['Lungime', '280 m / 280 m / 246 m'], ['Lățime', '9,1 m / 5,6 m / 6,3 m'], ['Bandă LED', 'pulsează la sosirea trenului']],
      view: view([22, 5, -10], [33, 1, 60]),
      walk: walk(31.0, platY, -14, 0, 1),
    },
    {
      id: 'siguranta-cctv', category: 'safety', title: 'Siguranță: camere video, SOS și evacuare',
      position: W(12, 3.6, -14),
      what: 'Camere video pe copertine, pe pasarelă și pe stâlpii inteligenți, plus coloane SOS cu buton de apel și interfon pe fiecare peron, legate de dispeceratul gării și de 112. Indicatoarele verzi „IEȘIRE” sunt luminoase, iar iluminatul de siguranță este alimentat din baterii.',
      why: 'Gara este deschisă zi și noapte, iar călătorii, mai ales seara, trebuie să se simtă în siguranță și să poată cere ajutor imediat. La un incendiu sau la o pană de curent, oamenii trebuie să găsească ieșirea chiar și prin fum.',
      benefit: 'Intervenția la accidente sau agresiuni este rapidă, iar vandalismul scade. Holul are trei ieșiri plus pasajul spre peroane și se poate goli în mai puțin de 3 minute, iar aceleași camere numără și fluxurile de călători.',
      data: [['Coloane SOS', String(counts.sos)], ['Camere video', `≈ ${counts.cams}`], ['Dispecerat', '24 / 7'], ['Iluminat de siguranță', '≥ 3 h din baterii'], ['Norme', 'P118, SR EN 1838']],
      view: view([5, 4, -30], [12, 1.5, -14]),
      walk: walk(12, platY, -22, 0, 1),
    },

    // ---------------- energie ----------------
    {
      id: 'pv-copertine', category: 'energy', title: 'Copertine fotovoltaice ondulate',
      position: W(29.75, 9.6, 125),
      what: `Copertinele peroanelor au formă de val și sunt acoperite cu panouri fotovoltaice bifaciale, care captează lumina pe ambele fețe. Împreună cu acoperișurile pasarelei, autogării și parcării de biciclete însumează circa ${fmt(pvArea)} m² și ${fmt(pvKWp)} kWp.`,
      why: 'Peroanele au suprafețe mari, neumbrite, care oricum trebuie acoperite contra ploii și a soarelui. Profilul „în fluture” al copertinelor duce apa de ploaie spre jgheaburi și apoi în rezervorul de apă pluvială.',
      benefit: `Producem circa ${fmt(pvMWh)} MWh pe an pentru iluminat, ecrane, lifturi, pompele de căldură și o parte din energia trenului ușor T1. Astfel evităm aproximativ ${fmt(co2)} t de CO₂ pe an.`,
      data: [['Suprafață panouri', `≈ ${fmt(pvArea)} m²`], ['Putere instalată', `≈ ${fmt(pvKWp)} kWp`], ['Producție anuală', `≈ ${fmt(pvMWh)} MWh`], ['CO₂ evitat', `≈ ${fmt(co2)} t/an`]],
      view: view([-15, 28, 185], [30, 4, 100]),
    },
    {
      id: 'baterie', category: 'energy', title: 'Stocarea energiei în baterii',
      position: W(76, 5.4, -54.2),
      what: `Două containere cu baterii LFP (litiu-fier-fosfat), cu o capacitate totală de ${fmt(batteryKWh)} kWh, păstrează energia produsă de panouri la prânz. Ea este folosită seara, la orele de vârf și pentru trenul ușor T1.`,
      why: 'Soarele produce cel mai mult la amiază, dar gara consumă mult dimineața și seara. Fără stocare, energia ar fi vândută ieftin în rețea și cumpărată înapoi la preț mare.',
      benefit: 'Autoconsumul crește, iar vârfurile de putere scad, deci și facturile. La o pană de curent, bateriile alimentează iluminatul de siguranță, lifturile și ecranele.',
      data: [['Capacitate', `${fmt(batteryKWh)} kWh`], ['Putere', '500 kW'], ['Chimie', 'LFP – fără cobalt'], ['Rezervă iluminat de siguranță', '> 8 h']],
      view: view([55, 14, -30], [76, 1.5, -54]),
      walk: walk(66, 0.36, -46, 1, -0.6),
    },
    {
      id: 'geotermal', category: 'energy', title: 'Pompe de căldură geotermale',
      position: W(-13, 4.6, -55),
      what: 'Sub gazonul de lângă hol sunt 9 sonde verticale de circa 120 m adâncime. Pompa de căldură extrage căldura pământului iarna și o descarcă tot acolo vara, pentru răcire; unitatea tehnică se vede lângă rezervorul de apă pluvială.',
      why: 'La câțiva metri sub pământ temperatura este tot anul în jur de 10–12 °C, iar în lunca Siretului apa freatică ajută transferul de căldură. Holul vitrat are nevoie de încălzire în pardoseală iarna și de răcire vara.',
      benefit: 'Fără gaz și fără coș de fum: din 1 kWh de electricitate obținem circa 4 kWh de căldură (COP ≈ 4). Electricitatea vine în mare parte de la panourile solare ale gării, deci emisiile locale sunt zero.',
      data: [['Sonde', '9 × 120 m'], ['Putere termică', '≈ 90 kW'], ['Eficiență (COP)', '≈ 4'], ['Emisii locale', '0']],
      view: view([-36, 9, -72], [-16, 1, -55]),
      walk: walk(-24, 0.36, -66, 1, 0.8),
    },
    {
      id: 'iluminat-led', category: 'energy', title: 'Iluminat LED inteligent',
      position: W(-29.2, 7.4, -14),
      what: `Holul, peroanele, pasarela și piața sunt iluminate cu LED. Cei ${counts.lamps} de stâlpi inteligenți din piață au senzori de prezență și de lumină, cameră video și Wi-Fi și pot fi comandați de la distanță.`,
      why: 'Iluminatul unei gări funcționează toată noaptea, iar vechile lămpi-glob consumă mult și luminează mai mult cerul decât peronul. Lumina trebuie să fie bună și pentru camerele video, nu doar pentru ochi.',
      benefit: 'Consumul scade cu circa 65 %, iar noaptea lumina crește doar unde trec oameni. Lumina albă și uniformă nu se mai împrăștie spre cer – încercați ora 21:30 din tabloul de bord!',
      data: [['Economie', '≈ 65 %'], ['Stâlpi inteligenți', String(counts.lamps)], ['Culoarea luminii', '3000 – 4000 K'], ['Durată de viață', '> 50 000 h']],
      view: view([-55, 10, 5], [-29, 3, -20]),
    },

    // ---------------- ecologie ----------------
    {
      id: 'acoperis-verde', category: 'eco', title: 'Acoperiș verde și apă de ploaie',
      position: W(-20.5, 12.2, -16),
      what: 'Acoperișul holului este verde: plante suculente (sedum) pe un strat de 8–10 cm de substrat. Apa de ploaie de pe acoperișuri și copertine ajunge printr-un burlan într-un rezervor de 15 m³ și este folosită la toalete și la udatul plantelor.',
      why: 'Verile sunt tot mai calde, iar un acoperiș verde nu se încinge ca tabla. El reține apa ploilor torențiale, care altfel ar inunda piața și ar suprasolicita canalizarea.',
      benefit: 'Holul rămâne mai răcoros vara și consumă cu circa 40 % mai puțină apă potabilă. În plus, acoperișul devine un mic habitat pentru albine și fluturi chiar în mijlocul orașului.',
      data: [['Suprafață verde', '≈ 580 m²'], ['Rezervor', '15 m³'], ['Apă recuperată', '≈ 450 m³ / an'], ['Plante', 'sedum, cimbrișor, garofițe']],
      view: view([-45, 26, -8], [-14, 8, -30]),
    },
    {
      id: 'piata-verde', category: 'eco', title: 'Piața verde și grădinile de ploaie',
      position: W(-56.5, 6.5, 22),
      what: `Fosta parcare asfaltată devine o piață cu ${counts.trees} de arbori, bănci, gazon și „grădini de ploaie” – albii plantate, ușor coborâte, în care se adună apa de pe pavaj. Pavajul este parțial permeabil, iar o stație de bike-sharing și un totem cu harta gării completează piața.`,
      why: 'Piața gării este prima imagine a orașului pentru cine sosește cu trenul. Asfaltul încinge aerul vara și trimite toată apa de ploaie direct în canalizare.',
      benefit: 'Umbră și răcoare, aer mai curat, mai puține bălți și inundații. Piața devine un loc plăcut de așteptare pentru trenul ușor și autobuz, nu doar un loc de trecere.',
      data: [['Arbori noi', String(counts.trees)], ['Grădini de ploaie', '5 (≈ 180 m²)'], ['Bănci în piață', String(counts.benches)], ['Pavaj permeabil', '≈ 60 %']],
      view: view([-95, 22, 55], [-55, 0, 15]),
      walk: walk(-56.5, 0.36, -2, 0, 1),
    },
    {
      id: 'colectare-selectiva', category: 'eco', title: 'Colectare selectivă a deșeurilor',
      position: W(-27.4, 4.4, -40.5),
      what: 'Stații cu patru compartimente colorate: albastru pentru hârtie și carton, galben pentru plastic și metal, verde pentru sticlă și maro pentru deșeuri biodegradabile. Le găsiți în piață, la ieșirea de est și pe fiecare peron.',
      why: 'Într-o gară se aruncă zilnic multe ambalaje: pahare de cafea, sticle de apă, ambalaje de la gustări. Nesortate, toate ajung la groapa de gunoi.',
      benefit: 'Se reciclează mai mult material, iar gara rămâne curată. Senzorii de umplere anunță echipa de curățenie doar când coșurile sunt pline, deci sunt mai puține curse și costuri mai mici.',
      data: [['Fluxuri', '4 culori'], ['Stații', '3 + coșuri pe fiecare peron'], ['Senzori de umplere', 'da'], ['Țintă de reciclare', '≥ 60 %']],
      view: view([-34, 3.2, -46], [-27.4, 1, -40.5]),
      walk: walk(-30.5, 0.36, -44, 1, 1),
    },

    // ---------------- mobilitate ----------------
    {
      id: 'autogara', category: 'mobility', title: 'Autogara integrată',
      position: W(-17.9, 6.6, 32),
      what: 'Peronul pentru autobuze din fața aripii de sud – unde este și azi autogara – are o insulă acoperită cu panouri solare, bănci, ecran de plecări și bordură înaltă pentru urcarea la nivel în autobuzele electrice. Banda de autobuze este separată de piață și de Strada Gării. Autobuzele ies pe o bretea spre Str. Gării, merg pe Str. Ceferiștilor spre vest, apoi pe Str. Mihai Eminescu și Str. Izvoarelor și revin pe Str. Ceferiștilor și Str. Gării în autogară (circuit ≈ 1,5 km).',
      why: 'Gara „3 în 1” înseamnă că trenul, trenul ușor T1 și autobuzele locale și județene opresc la câțiva pași unele de altele. Azi autobuzele opresc printre mașinile parcate, fără adăpost pentru călători.',
      benefit: 'Schimbi mijlocul de transport în mai puțin de 2 minute, cu un singur bilet integrat și o singură hartă. Autobuzele electrice sunt silențioase și nu poluează piața.',
      data: [['Locuri de oprire', '3 × autobuz de 12 m'], ['Distanță până la hol', '≈ 30 m'], ['Distanță până la T1', '≈ 150 m (Peronul 1 Sud)'], ['Străzi', 'Gării · Ceferiștilor · M. Eminescu · Izvoarelor'], ['Autobuze', 'electrice']],
      view: view([-50, 12, 60], [-20, 1, 30]),
      walk: walk(-17.9, 0.52, 14, 0, 1),
    },
    {
      id: 'mobilitate-verde', category: 'mobility', title: 'Biciclete și încărcare pentru mașini electrice',
      position: W(-15, 5.0, -100),
      what: 'Lângă capătul de nord al pieței sunt o parcare securizată pentru biciclete, cu acoperiș fotovoltaic și acces cu cardul, și 4 stații de încărcare pentru mașini electrice, lângă banda Kiss & Ride și locurile de taxi. În piață există și o stație de bike-sharing cu 14 biciclete.',
      why: 'Mulți navetiști locuiesc în cartierele apropiate de gară. Dacă pot veni sigur cu bicicleta sau pot fi lăsați rapid cu mașina, nu mai ocupă un loc de parcare toată ziua.',
      benefit: 'Mai puține mașini și mai puțin trafic în jurul gării, deci aer mai curat. Bicicletele închiriate fac legătura cu centrul vechi de pe terasă (Scările mari) în câteva minute.',
      data: [['Locuri biciclete', '≈ 30 + 14 bike-sharing'], ['Stații EV', '4 × 22 kW'], ['Kiss & Ride', 'max. 5 minute'], ['Taxi', '4 locuri']],
      view: view([-45, 14, -125], [-18, 1, -98]),
    },
  ];
  const entries = [];
  for (const h of H) {
    if (!MAIN.has(h.id)) h.maxDistance = MINOR_ORBIT_D;
    entries.push(ctx.hotspots.add(h) || h);
  }

  // ---------------- tur ghidat (ordinele 10–49) ----------------
  const steps = [
    [10, 'Gara Pașcani: azi și mâine', 'Privim complexul gării de sus: clădirea istorică restaurată, Holul Viitorului din lemn și sticlă, pasarela peste linii, peroanele înălțate cu copertine solare și piața verde. Folosiți comutatorul „Gara viitorului” din tabloul de bord pentru a compara cu gara de azi.', OVERVIEW, null],
    [12, 'Clădirea istorică restaurată', 'Corpul central cu etaj, aripile și pavilioanele de capăt își păstrează forma reală, după amprenta din OpenStreetMap. Ceasul și inscripția „PAȘCANI” revin pe fațade, iar porticul de pe peronul 1 este restaurat.', null, 'gara-istorica'],
    [14, 'Holul Viitorului', 'Un atrium de lemn și sticlă lipit de aripa de nord: bilete, informații, cafenea, dulapuri și sală de așteptare. Din hol, un pasaj în rampă prin clădirea veche duce direct pe peronul 1.', null, 'hol-viitorului'],
    [16, 'Peretele digital de informare', 'Toate plecările – trenurile CFR și trenul ușor T1 spre Hub-ul Turbion A7 × A8 – apar pe un ecran LED de 8 × 4 m. Ora aleasă în tabloul de bord schimbă și orarul afișat.', null, 'tabela-digitala'],
    [18, 'Orientare prin culori', 'Liniile LED din pardoseală duc fiecare călător unde are nevoie: verde spre peroane, portocaliu spre T1, albastru spre autobuze, mov spre pasarelă. Semnele suspendate repetă aceleași culori.', null, 'orientare-led'],
    [20, 'Accesibil pentru toți', 'Benzi tactile, ghișeu coborât, automate la înălțime accesibilă și o rampă de 4 % spre peroane. Nimeni nu are nevoie de ajutor pentru a ajunge la tren.', null, 'acces-pmr'],
    [22, 'Pasarela peste linii', `Gata cu traversările la nivel printre trenuri: o pasarelă vitrată la ${fmt(deckY, 1)} m, peste catenara de 25 kV, leagă piața, toate cele trei peroane și cartierul de est.`, null, 'pasarela'],
    [24, 'Lifturi panoramice', 'Cinci lifturi de sticlă duc de pe pasarelă pe fiecare peron, fără nicio treaptă. În modul plimbare puteți intra în cabină și urca până pe pasarelă.', null, 'lifturi'],
    [26, 'Peroane înălțate și sigure', 'Peroanele de 55 cm permit urcarea la nivel în tren. Banda LED de pe margine pulsează portocaliu când se apropie trenul și devine albă când acesta a oprit.', null, 'peroane-inaltate'],
    [28, 'Ecrane de peron', 'Fiecare linie are ecranul ei: trenul, destinația, ora și starea – „Sosește”, „Îmbarcare” – actualizate în timp real, la fel ca tabela din hol.', null, 'afisaj-peron'],
    [30, 'Energie din soare', `Copertinele ondulate ale peroanelor, pasarela și autogara formează o centrală solară de circa ${fmt(pvKWp)} kWp. Energia acoperă iluminatul, ecranele, lifturile și o parte din trenul ușor.`, null, 'pv-copertine'],
    [32, 'Baterii pentru seară', 'Energia produsă la prânz este păstrată în baterii și folosită seara, la orele de vârf. La o pană de curent, tot bateriile țin aprinse luminile de siguranță.', null, 'baterie'],
    [34, 'Căldură din pământ', 'Nouă sonde geotermale și o pompă de căldură încălzesc holul iarna și îl răcoresc vara, fără gaz și fără coș de fum.', null, 'geotermal'],
    [36, 'Acoperiș verde și apă de ploaie', 'Sedumul de pe acoperiș ține holul răcoros, iar apa de ploaie strânsă într-un rezervor de 15 m³ este folosită la toalete și la udat.', null, 'acoperis-verde'],
    [38, 'Piața verde', 'În locul parcării asfaltate: arbori, bănci, gazon și grădini de ploaie care absorb apa de pe pavaj. Fâșia de lângă Strada Gării devine gazon cu arbori și bretelele autobuzelor; trenul ușor T1 pleacă de pe Peronul 1 Sud.', null, 'piata-verde'],
    [40, 'Colectare selectivă', 'Patru culori ușor de recunoscut: hârtie, plastic și metal, sticlă, bio. Stațiile sunt în piață, la ieșirea de est și pe fiecare peron.', null, 'colectare-selectiva'],
    [42, 'Autogara integrată', 'Autobuzele electrice opresc la câțiva pași de hol. Ies pe Strada Gării și Strada Ceferiștilor, fac bucla pe Mihai Eminescu și Izvoarelor și revin în autogară. Trenul ușor T1 pleacă de pe Peronul 1 Sud.', null, 'autogara'],
    [44, 'Biciclete și mașini electrice', 'Parcare securizată pentru biciclete, bike-sharing și stații de încărcare pentru mașini electrice, lângă banda Kiss & Ride.', null, 'mobilitate-verde'],
    [46, 'Gara noaptea', 'Seara se aprind iluminatul LED inteligent, liniile de orientare și ferestrele trenurilor. Camerele video, coloanele SOS și semnele de evacuare luminoase păstrează gara sigură la orice oră.', null, 'siguranta-cctv', (c) => c.setHour?.(21.5)],
    [48, 'Atelierele CFR din 1876', 'De pe pasarelă se văd fostele Ateliere CFR, monument istoric, legate acum direct de gară. Revenim la lumina zilei pentru restul prezentării.', null, 'electroputere', (c) => c.setHour?.(11)],
  ];
  const byId = Object.fromEntries(H.map((h) => [h.id, h]));
  for (const [order, title, text, v, hs, onEnter] of steps) {
    const step = { order, title, text, view: v || byId[hs].view, onEnter };
    if (hs) step.hotspot = hs;
    ctx.tourSteps.push(step);
  }

  // In plimbare / calatorie etichetele minore revin la raza obisnuita (60 m) — vezi CORE REQUEST din raport.
  let lastMode = null;
  ctx.addUpdate(() => {
    const mode = ctx.controls?.mode || 'orbit';
    if (mode === lastMode) return;
    lastMode = mode;
    for (const e of entries) if (!MAIN.has(e.id)) e.maxDistance = mode === 'orbit' ? MINOR_ORBIT_D : 60;
  });
  return H;
}
