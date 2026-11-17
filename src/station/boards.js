import * as THREE from 'three';

// Afisaje digitale (CanvasTexture): tabela de plecari, ecrane de peron, ceas, semne cu pictograme, harta-totem.
// Mersul trenurilor de mai jos este o SIMULARE plauzibila pentru prezentare (nu orarul oficial CFR Călători).

const T = (t, type, no, dest, track, via = '') => ({ t, m: +t.slice(0, 2) * 60 + +t.slice(3), type, no, dest, track, via });
export const TIMETABLE = [
  T('00:47', 'IR', 1652, 'București Nord', 2, 'Roman · Bacău'),
  T('01:55', 'IR', 1835, 'Cluj-Napoca', 3, 'Suceava · Vatra Dornei'),
  T('03:12', 'IR', 1831, 'Timișoara Nord', 3, 'Suceava · Cluj-Napoca'),
  T('04:40', 'R', 5521, 'Târgu Neamț', 1, 'Topile'),
  T('05:20', 'R', 5602, 'Iași', 4, 'Târgu Frumos'),
  T('05:48', 'IR', 1761, 'Suceava', 3, 'Lunca Siretului'),
  T('06:10', 'R', 5710, 'Bacău', 2, 'Roman'),
  T('06:35', 'R', 5520, 'Iași', 4, 'Târgu Frumos'),
  T('07:05', 'IR', 1662, 'București Nord', 2, 'Roman · Bacău · Adjud'),
  T('07:42', 'R', 5523, 'Târgu Neamț', 1, 'Topile'),
  T('08:15', 'IR', 1661, 'Iași', 4, 'Târgu Frumos'),
  T('08:50', 'R', 5604, 'Suceava', 3, 'Dolhasca'),
  T('09:25', 'IR', 1765, 'Vicșani', 3, 'Suceava'),
  T('10:10', 'R', 5522, 'Iași', 4, 'Târgu Frumos'),
  T('10:40', 'R', 5712, 'Roman', 2, 'Lunca Siretului'),
  T('11:20', 'IR', 1664, 'București Nord', 2, 'Roman · Bacău'),
  T('11:55', 'R', 5525, 'Târgu Neamț', 1, 'Topile'),
  T('12:30', 'IR', 1833, 'Cluj-Napoca', 3, 'Suceava · Vatra Dornei'),
  T('13:05', 'R', 5606, 'Iași', 4, 'Târgu Frumos'),
  T('13:40', 'R', 5714, 'Bacău', 2, 'Roman'),
  T('14:32', 'IR', 1663, 'Iași', 4, 'Târgu Frumos'),
  T('15:10', 'R', 5527, 'Târgu Neamț', 1, 'Topile'),
  T('15:45', 'IR', 1666, 'București Nord', 2, 'Roman · Bacău'),
  T('16:20', 'R', 5608, 'Suceava', 3, 'Dolhasca'),
  T('16:58', 'IR', 1837, 'Timișoara Nord', 3, 'Suceava · Cluj-Napoca'),
  T('17:30', 'R', 5524, 'Iași', 4, 'Târgu Frumos'),
  T('18:05', 'R', 5716, 'Roman', 2, 'Lunca Siretului'),
  T('18:40', 'IR', 1767, 'Vicșani', 3, 'Suceava'),
  T('19:15', 'R', 5529, 'Târgu Neamț', 1, 'Topile'),
  T('19:50', 'IR', 1668, 'București Nord', 2, 'Roman · Bacău'),
  T('20:35', 'R', 5610, 'Iași', 4, 'Târgu Frumos'),
  T('21:20', 'IR', 1665, 'Iași', 4, 'Târgu Frumos'),
  T('22:05', 'R', 5718, 'Bacău', 2, 'Roman'),
  T('22:50', 'IR', 1839, 'Cluj-Napoca', 3, 'Suceava'),
  T('23:30', 'IR', 1654, 'București Nord', 2, 'Roman · Bacău'),
];
// trenul usor T1: la 10 minute (05:00–23:50)
for (let m = 300; m < 1440; m += m < 1200 ? 10 : 20) TIMETABLE.push({ t: hhmm(m), m, type: 'T1', no: '', dest: 'Hub Turbion A7×A8', track: 'T1', via: 'Peron 1 Sud · Vatra · Triaj' });
TIMETABLE.sort((a, b) => a.m - b.m);

export function hhmm(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function delayOf(tr) {
  const h = (tr.m * 7919 + (tr.no || 3) * 31) % 100;
  if (tr.type === 'T1') return 0;
  return h < 76 ? 0 : h < 94 ? 5 : 10;
}
export function upcoming(nowMin, n, filter = () => true) {
  const out = [];
  for (let k = 0; k < TIMETABLE.length * 2 && out.length < n; k++) {
    const tr = TIMETABLE[k % TIMETABLE.length];
    const day = k >= TIMETABLE.length ? 1440 : 0;
    if (tr.m + day + delayOf(tr) < nowMin - 1) continue;
    if (!filter(tr)) continue;
    out.push({ ...tr, delay: delayOf(tr), eta: tr.m + day + delayOf(tr) - nowMin });
  }
  return out;
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function texOf(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const FONT = '"Segoe UI", "Arial", sans-serif';

// ----------------------------------------------------------------------------------
// Tabela mare de plecari (hol)
export function createDeparturesBoard() {
  const c = mkCanvas(1024, 512);
  const g = c.getContext('2d');
  const texture = texOf(c);
  function draw(nowMin, sec, blink) {
    g.fillStyle = '#05080f'; g.fillRect(0, 0, 1024, 512);
    // antet
    const gr = g.createLinearGradient(0, 0, 1024, 0);
    gr.addColorStop(0, '#0b3a6e'); gr.addColorStop(1, '#0a5c7a');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 62);
    g.fillStyle = '#fff'; g.font = `700 34px ${FONT}`; g.textBaseline = 'middle';
    g.fillText('PLECĂRI', 22, 32);
    g.font = `400 20px ${FONT}`; g.fillStyle = '#9fd3ff';
    g.fillText('Gara Pașcani · nod CFR 500 / 606 / 517 · tren ușor T1', 180, 33);
    g.font = `700 36px ${FONT}`; g.fillStyle = '#ffd34d'; g.textAlign = 'right';
    g.fillText(`${hhmm(nowMin)}:${String(sec).padStart(2, '0')}`, 1004, 33);
    g.textAlign = 'left';
    // coloane
    g.fillStyle = '#7f8ea3'; g.font = `600 17px ${FONT}`;
    const cols = [22, 120, 250, 640, 760];
    ['ORA', 'TREN', 'DESTINAȚIA', 'LINIA', 'OBSERVAȚII'].forEach((s, i) => g.fillText(s, cols[i], 82));
    const rows = upcoming(nowMin, 9);
    rows.forEach((r, i) => {
      const y = 112 + i * 44;
      g.fillStyle = i % 2 ? '#0a1120' : '#0d1628'; g.fillRect(0, y - 20, 1024, 42);
      g.font = `700 28px ${FONT}`; g.fillStyle = '#ffd34d'; g.fillText(r.t, cols[0], y);
      if (r.type === 'T1') {
        g.fillStyle = '#f97316'; roundRect(g, cols[1], y - 15, 64, 30, 6); g.fill();
        g.fillStyle = '#fff'; g.font = `800 22px ${FONT}`; g.fillText('T1', cols[1] + 15, y + 1);
      } else {
        g.fillStyle = r.type === 'IR' ? '#e11d48' : '#2563eb'; roundRect(g, cols[1], y - 15, 44, 30, 6); g.fill();
        g.fillStyle = '#fff'; g.font = `800 18px ${FONT}`; g.fillText(r.type, cols[1] + (r.type === 'IR' ? 10 : 15), y + 1);
        g.fillStyle = '#e6edf6'; g.font = `600 22px ${FONT}`; g.fillText(String(r.no), cols[1] + 52, y + 1);
      }
      g.fillStyle = '#ffffff'; g.font = `600 27px ${FONT}`; g.fillText(r.dest, cols[2], y - 4);
      g.fillStyle = '#7f8ea3'; g.font = `400 15px ${FONT}`; g.fillText(r.via ? 'prin ' + r.via : '', cols[2], y + 15);
      g.fillStyle = '#fff'; g.font = `800 28px ${FONT}`;
      g.fillText(r.type === 'T1' ? '1S' : String(r.track), cols[3] + 22, y);
      let st = 'La timp', col = '#4ade80';
      if (r.delay) { st = `Întârziere ${r.delay} min`; col = '#fbbf24'; }
      if (r.eta <= 3) { st = r.type === 'T1' ? 'Îmbarcare' : 'Îmbarcare · ușile se închid'; col = blink ? '#22d3ee' : '#0e7490'; }
      g.fillStyle = col; g.font = `600 22px ${FONT}`; g.fillText(st, cols[4], y);
    });
    g.fillStyle = '#0b3a6e'; g.fillRect(0, 490, 1024, 22);
    g.fillStyle = '#cfe8ff'; g.font = `500 15px ${FONT}`;
    g.fillText('Urmăriți liniile LED din pardoseală: verde → peroane CFR · portocaliu → tren ușor T1 · albastru → autobuze · mov → pasarelă', 14, 501);
    texture.needsUpdate = true;
  }
  return { texture, draw };
}

// ----------------------------------------------------------------------------------
// Ecrane de peron: o singura textura cu 5 randuri (Linia 1..5); fiecare ecran foloseste UV-ul randului sau.
export function createPlatformDisplays() {
  const W = 1024, RH = 192, N = 5;
  const c = mkCanvas(W, RH * N);
  const g = c.getContext('2d');
  const texture = texOf(c);
  function draw(nowMin, live, blink) {
    for (let i = 0; i < N; i++) {
      const track = i + 1, y0 = i * RH;
      g.fillStyle = '#04070d'; g.fillRect(0, y0, W, RH);
      g.fillStyle = '#0b3a6e'; g.fillRect(0, y0, 150, RH);
      g.fillStyle = '#9fd3ff'; g.font = `600 26px ${FONT}`; g.textBaseline = 'middle';
      g.fillText('LINIA', 34, y0 + 48);
      g.fillStyle = '#fff'; g.font = `800 96px ${FONT}`; g.fillText(String(track), 48, y0 + 122);
      const lv = live && live[track];
      const next = upcoming(nowMin, 1, (tr) => tr.track === track)[0];
      const tr = lv ? lv.train : next;
      if (!tr) continue;
      const time = lv ? hhmm(nowMin) : tr.t;
      g.fillStyle = '#ffd34d'; g.font = `700 54px ${FONT}`; g.fillText(time, 178, y0 + 52);
      g.fillStyle = tr.type === 'IR' ? '#e11d48' : '#2563eb'; roundRect(g, 340, y0 + 30, 70, 44, 8); g.fill();
      g.fillStyle = '#fff'; g.font = `800 28px ${FONT}`; g.fillText(tr.type, 352 + (tr.type === 'R' ? 10 : 0), y0 + 53);
      g.fillStyle = '#e6edf6'; g.font = `600 40px ${FONT}`; g.fillText(String(tr.no), 422, y0 + 54);
      g.fillStyle = '#fff'; g.font = `700 58px ${FONT}`; g.fillText(tr.dest, 178, y0 + 124);
      g.fillStyle = '#7f8ea3'; g.font = `400 24px ${FONT}`; g.fillText(tr.via ? 'prin ' + tr.via : '', 180, y0 + 170);
      let st = next && next.delay ? `+${next.delay} min` : 'La timp', col = next && next.delay ? '#fbbf24' : '#4ade80';
      if (lv) {
        st = lv.phase === 'dwell' ? 'Îmbarcare' : lv.phase === 'approach' ? 'Sosește' : 'Pleacă';
        col = lv.phase === 'dwell' ? (blink ? '#22d3ee' : '#0e7490') : '#fbbf24';
      }
      g.fillStyle = col; g.font = `700 40px ${FONT}`; g.textAlign = 'right'; g.fillText(st, W - 30, y0 + 52);
      g.fillStyle = '#9fb3c8'; g.font = `500 26px ${FONT}`;
      g.fillText(tr.type === 'IR' ? 'clasa 1 · 2 · bicicletă ♿' : 'clasa 2 · ♿ acces la nivel', W - 30, y0 + 170);
      g.textAlign = 'left';
      g.fillStyle = '#16233a'; g.fillRect(0, y0 + RH - 3, W, 3);
    }
    texture.needsUpdate = true;
  }
  return { texture, draw, rows: N, uvRow: (i) => [0, 1 - (i + 1) / N, 1, 1 - i / N] };
}

// ----------------------------------------------------------------------------------
// Ceas de gara (fata) — se redeseneaza cand se schimba minutul scenei
export function createClock() {
  const c = mkCanvas(256, 256);
  const g = c.getContext('2d');
  const texture = texOf(c);
  let last = -1;
  function draw(hour) {
    const m = Math.floor(hour * 60);
    if (m === last) return;
    last = m;
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f8f6ef'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#1f2937'; g.stroke();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, r0 = i % 5 ? 108 : 94;
      g.lineWidth = i % 5 ? 2 : 7;
      g.beginPath(); g.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0); g.lineTo(128 + Math.sin(a) * 116, 128 - Math.cos(a) * 116); g.stroke();
    }
    const hh = (hour % 12) / 12, mm = (hour % 1);
    const hand = (f, len, w, col) => { const a = f * Math.PI * 2; g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(128 - Math.sin(a) * 14, 128 + Math.cos(a) * 14); g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len); g.stroke(); };
    hand(hh, 62, 11, '#111827');
    hand(mm, 96, 7, '#111827');
    g.fillStyle = '#b91c1c'; g.beginPath(); g.arc(128, 128, 7, 0, 7); g.fill();
    texture.needsUpdate = true;
  }
  return { texture, draw };
}

// Inscriptia „PAȘCANI” (litere de bronz pe fond transparent)
export function lettering(text, { color = '#3a3127', font = 'Georgia, "Times New Roman", serif', w = 1024, h = 160, weight = 700 } = {}) {
  const c = mkCanvas(w, h);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.font = `${weight} ${Math.floor(h * 0.72)}px ${font}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillText(text, w / 2 + 3, h / 2 + 4);
  g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  return texOf(c);
}

// ----------------------------------------------------------------------------------
// Pictograme simple desenate pe canvas
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const ICONS = {
  train(g, s) { roundRect(g, -0.32 * s, -0.42 * s, 0.64 * s, 0.7 * s, 0.14 * s); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(-0.24 * s, -0.32 * s, 0.48 * s, 0.24 * s); g.beginPath(); g.arc(-0.17 * s, 0.12 * s, 0.06 * s, 0, 7); g.arc(0.17 * s, 0.12 * s, 0.06 * s, 0, 7); g.fill(); g.restore(); g.fillRect(-0.3 * s, 0.32 * s, 0.12 * s, 0.1 * s); g.fillRect(0.18 * s, 0.32 * s, 0.12 * s, 0.1 * s); },
  tram(g, s) { g.fillRect(-0.03 * s, -0.48 * s, 0.06 * s, 0.12 * s); g.fillRect(-0.18 * s, -0.48 * s, 0.36 * s, 0.04 * s); ICONS.train(g, s * 0.9); },
  bus(g, s) { roundRect(g, -0.36 * s, -0.4 * s, 0.72 * s, 0.68 * s, 0.1 * s); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(-0.28 * s, -0.3 * s, 0.56 * s, 0.26 * s); g.restore(); g.beginPath(); g.arc(-0.2 * s, 0.32 * s, 0.09 * s, 0, 7); g.arc(0.2 * s, 0.32 * s, 0.09 * s, 0, 7); g.fill(); },
  stairs(g, s) { g.beginPath(); g.moveTo(-0.4 * s, 0.4 * s); for (let i = 0; i < 4; i++) { g.lineTo((-0.4 + i * 0.2) * s, (0.2 - i * 0.2) * s); g.lineTo((-0.2 + i * 0.2) * s, (0.2 - i * 0.2) * s); } g.lineTo(0.4 * s, 0.4 * s); g.closePath(); g.fill(); },
  info(g, s) { g.beginPath(); g.arc(0, 0, 0.42 * s, 0, 7); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; g.font = `800 ${0.6 * s}px Georgia`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('i', 0, 0.03 * s); g.restore(); },
  ticket(g, s) { roundRect(g, -0.42 * s, -0.24 * s, 0.84 * s, 0.48 * s, 0.06 * s); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(-0.42 * s, 0, 0.1 * s, 0, 7); g.arc(0.42 * s, 0, 0.1 * s, 0, 7); g.fill(); g.fillRect(-0.18 * s, -0.12 * s, 0.4 * s, 0.05 * s); g.fillRect(-0.18 * s, 0.03 * s, 0.3 * s, 0.05 * s); g.restore(); },
  person(g, s, x = 0) { g.beginPath(); g.arc(x, -0.32 * s, 0.09 * s, 0, 7); g.fill(); g.fillRect(x - 0.1 * s, -0.2 * s, 0.2 * s, 0.34 * s); g.fillRect(x - 0.09 * s, 0.12 * s, 0.07 * s, 0.32 * s); g.fillRect(x + 0.02 * s, 0.12 * s, 0.07 * s, 0.32 * s); },
  wc(g, s) { ICONS.person(g, s, -0.2 * s); g.beginPath(); g.arc(0.2 * s, -0.32 * s, 0.09 * s, 0, 7); g.fill(); g.beginPath(); g.moveTo(0.2 * s, -0.22 * s); g.lineTo(0.36 * s, 0.14 * s); g.lineTo(0.04 * s, 0.14 * s); g.closePath(); g.fill(); g.fillRect(0.12 * s, 0.12 * s, 0.06 * s, 0.32 * s); g.fillRect(0.22 * s, 0.12 * s, 0.06 * s, 0.32 * s); g.fillRect(-0.015 * s, -0.42 * s, 0.03 * s, 0.86 * s); },
  wheelchair(g, s) { g.beginPath(); g.arc(-0.02 * s, -0.36 * s, 0.08 * s, 0, 7); g.fill(); g.lineWidth = 0.07 * s; g.beginPath(); g.moveTo(-0.04 * s, -0.24 * s); g.lineTo(-0.04 * s, 0.02 * s); g.lineTo(0.2 * s, 0.02 * s); g.lineTo(0.3 * s, 0.26 * s); g.stroke(); g.beginPath(); g.arc(-0.06 * s, 0.16 * s, 0.24 * s, -0.6, Math.PI + 0.9); g.stroke(); },
  lift(g, s) { roundRect(g, -0.34 * s, -0.42 * s, 0.68 * s, 0.84 * s, 0.06 * s); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(-0.16 * s, -0.12 * s); g.lineTo(0, -0.3 * s); g.lineTo(0.16 * s, -0.12 * s); g.fill(); g.beginPath(); g.moveTo(-0.16 * s, 0.12 * s); g.lineTo(0, 0.3 * s); g.lineTo(0.16 * s, 0.12 * s); g.fill(); g.restore(); },
  exit(g, s) { g.beginPath(); g.arc(0.05 * s, -0.34 * s, 0.09 * s, 0, 7); g.fill(); g.lineWidth = 0.1 * s; g.lineCap = 'round'; g.beginPath(); g.moveTo(0.02 * s, -0.2 * s); g.lineTo(-0.06 * s, 0.08 * s); g.lineTo(0.14 * s, 0.4 * s); g.moveTo(-0.06 * s, 0.08 * s); g.lineTo(-0.28 * s, 0.36 * s); g.moveTo(-0.24 * s, -0.12 * s); g.lineTo(0.0 * s, -0.16 * s); g.lineTo(0.24 * s, 0.0 * s); g.stroke(); },
  bike(g, s) { g.lineWidth = 0.06 * s; g.beginPath(); g.arc(-0.24 * s, 0.14 * s, 0.17 * s, 0, 7); g.moveTo(0.41 * s, 0.14 * s); g.arc(0.24 * s, 0.14 * s, 0.17 * s, 0, 7); g.stroke(); g.beginPath(); g.moveTo(-0.24 * s, 0.14 * s); g.lineTo(-0.06 * s, -0.16 * s); g.lineTo(0.18 * s, -0.16 * s); g.lineTo(0.24 * s, 0.14 * s); g.moveTo(-0.06 * s, -0.16 * s); g.lineTo(0.02 * s, 0.14 * s); g.lineTo(0.18 * s, -0.16 * s); g.moveTo(-0.12 * s, -0.26 * s); g.lineTo(0.0, -0.26 * s); g.stroke(); },
  plug(g, s) { roundRect(g, -0.22 * s, -0.16 * s, 0.44 * s, 0.38 * s, 0.1 * s); g.fill(); g.fillRect(-0.14 * s, -0.4 * s, 0.07 * s, 0.26 * s); g.fillRect(0.07 * s, -0.4 * s, 0.07 * s, 0.26 * s); g.fillRect(-0.035 * s, 0.2 * s, 0.07 * s, 0.24 * s); },
  recycle(g, s) { g.lineWidth = 0.08 * s; for (let k = 0; k < 3; k++) { g.save(); g.rotate((k * Math.PI * 2) / 3); g.beginPath(); g.moveTo(-0.22 * s, 0.2 * s); g.lineTo(0.16 * s, 0.2 * s); g.stroke(); g.beginPath(); g.moveTo(0.26 * s, 0.2 * s); g.lineTo(0.12 * s, 0.1 * s); g.lineTo(0.12 * s, 0.3 * s); g.fill(); g.restore(); } },
  cam(g, s) { g.save(); g.rotate(0.3); g.fillRect(-0.3 * s, -0.14 * s, 0.5 * s, 0.24 * s); g.beginPath(); g.moveTo(0.2 * s, -0.06 * s); g.lineTo(0.38 * s, -0.16 * s); g.lineTo(0.38 * s, 0.16 * s); g.lineTo(0.2 * s, 0.06 * s); g.fill(); g.restore(); g.fillRect(-0.06 * s, 0.05 * s, 0.06 * s, 0.32 * s); g.fillRect(-0.24 * s, 0.34 * s, 0.4 * s, 0.06 * s); },
  cup(g, s) { roundRect(g, -0.26 * s, -0.16 * s, 0.4 * s, 0.46 * s, 0.08 * s); g.fill(); g.lineWidth = 0.06 * s; g.beginPath(); g.arc(0.18 * s, 0.04 * s, 0.1 * s, -1.4, 1.4); g.stroke(); g.beginPath(); g.moveTo(-0.14 * s, -0.24 * s); g.quadraticCurveTo(-0.06 * s, -0.34 * s, -0.12 * s, -0.44 * s); g.moveTo(0.02 * s, -0.24 * s); g.quadraticCurveTo(0.1 * s, -0.34 * s, 0.04 * s, -0.44 * s); g.stroke(); },
  locker(g, s) { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { roundRect(g, (-0.4 + i * 0.42) * s, (-0.4 + j * 0.42) * s, 0.38 * s, 0.38 * s, 0.04 * s); g.fill(); } g.save(); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.beginPath(); g.arc((-0.12 + i * 0.42) * s, (-0.2 + j * 0.42) * s, 0.04 * s, 0, 7); g.fill(); } g.restore(); },
  taxi(g, s) { g.fillRect(-0.12 * s, -0.42 * s, 0.24 * s, 0.1 * s); roundRect(g, -0.36 * s, -0.12 * s, 0.72 * s, 0.32 * s, 0.08 * s); g.fill(); g.beginPath(); g.moveTo(-0.24 * s, -0.12 * s); g.lineTo(-0.14 * s, -0.3 * s); g.lineTo(0.14 * s, -0.3 * s); g.lineTo(0.24 * s, -0.12 * s); g.fill(); g.beginPath(); g.arc(-0.2 * s, 0.24 * s, 0.09 * s, 0, 7); g.arc(0.2 * s, 0.24 * s, 0.09 * s, 0, 7); g.fill(); },
  sos(g, s) { g.font = `900 ${0.46 * s}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SOS', 0, 0.03 * s); },
  arrowR(g, s) { g.beginPath(); g.moveTo(-0.36 * s, -0.08 * s); g.lineTo(0.08 * s, -0.08 * s); g.lineTo(0.08 * s, -0.26 * s); g.lineTo(0.4 * s, 0); g.lineTo(0.08 * s, 0.26 * s); g.lineTo(0.08 * s, 0.08 * s); g.lineTo(-0.36 * s, 0.08 * s); g.closePath(); g.fill(); },
  bridge(g, s) { g.fillRect(-0.44 * s, -0.12 * s, 0.88 * s, 0.1 * s); g.fillRect(-0.44 * s, -0.36 * s, 0.88 * s, 0.05 * s); for (let i = -2; i <= 2; i++) g.fillRect(i * 0.2 * s - 0.02 * s, -0.36 * s, 0.04 * s, 0.26 * s); g.fillRect(-0.4 * s, -0.02 * s, 0.08 * s, 0.44 * s); g.fillRect(0.32 * s, -0.02 * s, 0.08 * s, 0.44 * s); },
  leaf(g, s) { g.beginPath(); g.moveTo(-0.3 * s, 0.34 * s); g.quadraticCurveTo(-0.36 * s, -0.36 * s, 0.36 * s, -0.36 * s); g.quadraticCurveTo(0.34 * s, 0.3 * s, -0.3 * s, 0.34 * s); g.fill(); },
  bottle(g, s) { roundRect(g, -0.14 * s, -0.12 * s, 0.28 * s, 0.56 * s, 0.06 * s); g.fill(); g.fillRect(-0.06 * s, -0.4 * s, 0.12 * s, 0.3 * s); },
  paper(g, s) { g.fillRect(-0.26 * s, -0.36 * s, 0.52 * s, 0.72 * s); g.save(); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 4; i++) g.fillRect(-0.18 * s, (-0.22 + i * 0.14) * s, 0.36 * s, 0.05 * s); g.restore(); },
  can(g, s) { roundRect(g, -0.18 * s, -0.34 * s, 0.36 * s, 0.68 * s, 0.08 * s); g.fill(); },
};

// Celulele atlasului de semne (4 coloane x 16 randuri, fiecare 512x128)
export const SIGNS = [
  { id: 'peroane', icon: 'train', text: 'Peroane CFR', sub: 'Liniile 1 – 5', bg: '#15803d' },
  { id: 't1', icon: 'tram', text: 'Tren ușor T1', sub: 'Peron 1 Sud · Hub Turbion · 10 min', bg: '#ea580c' },
  { id: 'bus', icon: 'bus', text: 'Autobuze', sub: 'Autogară · Taxi', bg: '#1d4ed8' },
  { id: 'pasarela', icon: 'bridge', text: 'Pasarelă', sub: 'Peroanele 1–3 · Electroputere', bg: '#7e22ce' },
  { id: 'info', icon: 'info', text: 'Informații', sub: 'Asistență PMR', bg: '#0f172a' },
  { id: 'bilete', icon: 'ticket', text: 'Bilete', sub: 'Automate · card · aplicație', bg: '#0f172a' },
  { id: 'wc', icon: 'wc', text: 'Toalete', sub: 'Cabină accesibilă ♿', bg: '#0f172a' },
  { id: 'lift', icon: 'lift', text: 'Lift', sub: 'Acces fără trepte', bg: '#0f172a' },
  { id: 'p1', icon: 'train', text: 'Peronul 1', sub: 'Linia 1 · Târgu Neamț', bg: '#15803d' },
  { id: 'p2', icon: 'train', text: 'Peronul 2', sub: 'Liniile 2 – 3 · Magistrala 500', bg: '#15803d' },
  { id: 'p3', icon: 'train', text: 'Peronul 3', sub: 'Liniile 4 – 5 · Iași (606)', bg: '#15803d' },
  { id: 'iesireE', icon: 'arrowR', text: 'Ieșire est', sub: 'Str. 9 Mai · Electroputere', bg: '#0f172a' },
  { id: 'iesireV', icon: 'arrowR', text: 'Ieșire oraș', sub: 'Piața Gării · Autogară · Taxi', bg: '#0f172a' },
  { id: 'exit', icon: 'exit', text: 'IEȘIRE', sub: 'de urgență', bg: '#15803d' },
  { id: 'sos', icon: 'sos', text: 'Apel de urgență', sub: 'Asistență 24/7 · 112', bg: '#b91c1c' },
  { id: 'cafe', icon: 'cup', text: 'Cafenea', sub: 'Produse locale', bg: '#78350f' },
  { id: 'locker', icon: 'locker', text: 'Dulapuri bagaje', sub: 'Plată cu cardul', bg: '#0f172a' },
  { id: 'hartie', icon: 'paper', text: 'Hârtie', sub: 'și carton', bg: '#1d4ed8' },
  { id: 'plastic', icon: 'can', text: 'Plastic', sub: 'și metal', bg: '#ca8a04' },
  { id: 'sticla', icon: 'bottle', text: 'Sticlă', sub: 'albă și colorată', bg: '#15803d' },
  { id: 'bio', icon: 'leaf', text: 'Bio', sub: 'resturi compostabile', bg: '#78350f' },
  { id: 'bike', icon: 'bike', text: 'Biciclete', sub: 'Închiriere · parcare securizată', bg: '#0e7490' },
  { id: 'ev', icon: 'plug', text: 'Încărcare EV', sub: '4 × 22 kW · 1 × 150 kW', bg: '#047857' },
  { id: 'taxi', icon: 'taxi', text: 'Taxi · Kiss & Ride', sub: 'Oprire max. 5 minute', bg: '#a16207' },
  { id: 'cctv', icon: 'cam', text: 'Zonă supravegheată', sub: 'video 24/7', bg: '#334155' },
  { id: 'access', icon: 'wheelchair', text: 'Acces PMR', sub: 'Rampă 6 % · lift', bg: '#1d4ed8' },
  { id: 'recycle', icon: 'recycle', text: 'Colectare selectivă', sub: 'Sortează – reciclăm 4 fluxuri', bg: '#166534' },
  { id: 'sala', icon: 'info', text: 'Holul Viitorului', sub: 'Sala de așteptare · Wi-Fi', bg: '#0f172a' },
  { id: 'baterie', icon: 'plug', text: 'Stocare energie', sub: 'Baterii LFP · pericol electric', bg: '#047857' },
  { id: 'gara', icon: 'train', text: 'Gara Pașcani', sub: 'Gara Viitorului · 3 în 1', bg: '#0b3a6e' },
];
export function createSignAtlas() {
  const CW = 512, CH = 128, COLS = 4, ROWS = 8;
  const c = mkCanvas(CW * COLS, CH * ROWS);
  const g = c.getContext('2d');
  const uv = {};
  SIGNS.forEach((s, i) => {
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
    g.fillStyle = s.bg; g.fillRect(cx, cy, CW, CH);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(cx, cy, CW, 6);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    g.save(); g.translate(cx + 64, cy + 64); ICONS[s.icon](g, 92); g.restore();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = `700 44px ${FONT}`; g.fillText(s.text, cx + 124, cy + 50, CW - 136);
    g.font = `400 24px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(s.sub, cx + 126, cy + 94, CW - 138);
    uv[s.id] = [cx / c.width, 1 - (cy + CH) / c.height, (cx + CW) / c.width, 1 - cy / c.height];
  });
  const texture = texOf(c);
  return { texture, uv };
}

// Harta-totem (planul garii, „Ești aici”)
export function createTotemMap() {
  const c = mkCanvas(512, 1024);
  const g = c.getContext('2d');
  g.fillStyle = '#0b1220'; g.fillRect(0, 0, 512, 1024);
  g.fillStyle = '#fff'; g.font = `700 40px ${FONT}`; g.fillText('Gara Pașcani', 28, 60);
  g.font = `400 22px ${FONT}`; g.fillStyle = '#9fb3c8'; g.fillText('Planul complexului · gară 3 în 1', 28, 96);
  // plan: axa garii verticala; vest = stanga
  const X = (lx) => 250 + lx * 2.6, Z = (lz) => 520 + lz * 2.3;
  g.fillStyle = '#1e293b'; g.fillRect(X(-64), Z(-130), X(70) - X(-64), Z(190) - Z(-130));
  g.fillStyle = '#334155'; g.fillRect(X(-49), Z(-130), X(-41) - X(-49), Z(190) - Z(-130)); // Str. Garii
  g.fillStyle = '#f97316'; g.fillRect(X(7.2), Z(63), 5, Z(190) - Z(63)); // T1: statia de pe fata de vest a peronului 1 (sud) si linia spre Triaj
  g.fillStyle = '#e5e7eb'; g.fillRect(X(-11.4), Z(-60.6), X(9.8) - X(-11.4), Z(56.2) - Z(-60.6)); // cladire
  g.fillStyle = '#facc15'; g.fillRect(X(-22), Z(-47.9), X(-6.6) - X(-22), Z(-11.8) - Z(-47.9)); // hol
  g.fillStyle = '#94a3b8';
  for (const [a, b] of [[9.8, 18.95], [26.95, 32.55], [39.75, 46.05]]) g.fillRect(X(a), Z(-110), X(b) - X(a), Z(175) - Z(-110));
  g.fillStyle = '#a855f7'; g.fillRect(X(-28), Z(-70.6), X(78) - X(-28), Z(-65.4) - Z(-70.6));
  g.fillStyle = '#3b82f6'; g.fillRect(X(-27), Z(10), X(-20) - X(-27), Z(55) - Z(10));
  g.fillStyle = '#22c55e'; g.fillRect(X(-62), Z(-30), X(-50) - X(-62), Z(62) - Z(-30));
  const lab = (t, x, y, col = '#fff') => { g.fillStyle = col; g.font = `600 19px ${FONT}`; g.fillText(t, x, y); };
  lab('Hol', X(-21), Z(-30)); lab('Peroane', X(12), Z(150)); lab('Pasarelă', X(10), Z(-80), '#e9d5ff');
  lab('T1', X(-14), Z(100), '#fed7aa'); lab('Autobuze', X(-29), Z(64), '#bfdbfe'); lab('Piață', X(-63), Z(75), '#bbf7d0');
  // esti aici
  g.fillStyle = '#ef4444'; g.beginPath(); g.arc(X(-27), Z(-23), 12, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke();
  lab('Ești aici', X(-60), Z(-36), '#fecaca');
  // legenda
  const leg = [['#22c55e', 'Peroane CFR'], ['#f97316', 'Tren ușor T1'], ['#3b82f6', 'Autobuze · autogară'], ['#a855f7', 'Pasarelă · lifturi']];
  leg.forEach(([col, t], i) => { g.fillStyle = col; g.fillRect(28, 900 + i * 30, 40, 10); g.fillStyle = '#e5e7eb'; g.font = `500 20px ${FONT}`; g.fillText(t, 80, 908 + i * 30); });
  g.fillStyle = '#9fb3c8'; g.font = `400 16px ${FONT}`; g.fillText('N ↑ (axa gării, azimut 338°)', 300, 1010);
  return texOf(c);
}
