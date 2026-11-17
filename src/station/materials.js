import * as THREE from 'three';
import { rng } from '../core/util.js';

// Materiale si texturi procedurale (CanvasTexture) — create o singura data si reutilizate.
function tex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function std(name, o) {
  const m = new THREE.MeshStandardMaterial(o);
  m.name = name;
  return m;
}

export function createMaterials() {
  const R = rng(7);

  // ---- texturi ----
  const paving = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, w, h);
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 32;
      for (let c = -1; c < 5; c++) {
        const shade = 168 + Math.floor(R() * 26);
        g.fillStyle = `rgb(${shade},${shade - 3},${shade - 9})`;
        g.fillRect(c * 64 + off + 2, r * 64 + 2, 60, 60);
      }
    }
    for (let i = 0; i < 2500; i++) { const s = 120 + R() * 90; g.fillStyle = `rgba(${s},${s},${s},0.35)`; g.fillRect(R() * w, R() * h, 1.5, 1.5); }
  });
  const platformTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#c9c7c1'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) {
      const s = 190 + Math.floor(R() * 22);
      g.fillStyle = `rgb(${s},${s - 2},${s - 6})`;
      g.fillRect(c * 64 + 1, r * 32 + 1, 62, 30);
    }
    for (let i = 0; i < 1500; i++) { const s = 140 + R() * 80; g.fillStyle = `rgba(${s},${s},${s},0.3)`; g.fillRect(R() * w, R() * h, 1, 1); }
  });
  const oldPlatTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#7a4a3e'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 8; c++) {
      const s = R();
      g.fillStyle = `rgb(${130 + s * 40},${70 + s * 25},${58 + s * 20})`;
      g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(40,30,25,0.35)'; g.fillRect(R() * w, R() * h, 6 + R() * 20, 2 + R() * 6); }
  });
  const asphalt = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#4b4d50'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { const s = 50 + R() * 50; g.fillStyle = `rgb(${s},${s},${s + 2})`; g.fillRect(R() * w, R() * h, 1.5, 1.5); }
  });
  const timber = tex(128, 256, (g, w, h) => {
    g.fillStyle = '#c99a62'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const s = R();
      g.fillStyle = `rgb(${190 + s * 30},${140 + s * 25},${85 + s * 20})`;
      g.fillRect(x + 1, 0, 14, h);
      g.strokeStyle = 'rgba(120,80,40,0.25)';
      for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x + 2 + R() * 12, 0); g.bezierCurveTo(x + R() * 16, h / 3, x + R() * 16, (2 * h) / 3, x + 2 + R() * 12, h); g.stroke(); }
    }
  });
  const pvTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#c8ccd2'; g.fillRect(0, 0, w, h); // rama
    const cw = 256 / 6, ch = 256 / 10;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 10; j++) {
      const gr = g.createLinearGradient(0, j * ch, 0, (j + 1) * ch);
      gr.addColorStop(0, '#1c2f57'); gr.addColorStop(1, '#13213f');
      g.fillStyle = gr;
      g.fillRect(i * cw + 2, j * ch + 2, cw - 3, ch - 3);
      g.fillStyle = 'rgba(160,180,220,0.18)';
      g.fillRect(i * cw + 2, j * ch + ch / 2 - 0.5, cw - 3, 1);
    }
  });
  const sedumTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#6d8a3f'; g.fillRect(0, 0, w, h);
    const cols = ['#86a34a', '#5b7a33', '#a3b257', '#9c5a3c', '#b8743f', '#7c9a45', '#c4b45a'];
    for (let i = 0; i < 3500; i++) { g.fillStyle = cols[Math.floor(R() * cols.length)]; const s = 2 + R() * 4; g.beginPath(); g.arc(R() * w, R() * h, s / 2, 0, 7); g.fill(); }
  });
  const greenWallTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#2f5a2a'; g.fillRect(0, 0, w, h);
    const cols = ['#3f7a33', '#5a9a3f', '#2e6a2a', '#7ab04a', '#4a8a3a', '#9ccf5a', '#d0699a', '#e6c84a'];
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = cols[Math.floor(R() * (i % 40 === 0 ? cols.length : 6))];
      g.beginPath(); g.ellipse(R() * w, R() * h, 2 + R() * 5, 1 + R() * 3, R() * 3, 0, 7); g.fill();
    }
  });
  const ballastTex = tex(128, 128, (g, w, h) => {
    g.fillStyle = '#6f675e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) { const s = 70 + R() * 70; g.fillStyle = `rgb(${s},${s - 6},${s - 12})`; g.fillRect(R() * w, R() * h, 2, 2); }
  });
  const facadeOld = tex(128, 128, (g, w, h) => {
    g.fillStyle = '#bdb6a8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(90,80,70,${0.05 + R() * 0.12})`; g.beginPath(); g.ellipse(R() * w, R() * h, 4 + R() * 16, 3 + R() * 10, 0, 0, 7); g.fill(); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(60,55,50,0.15)'; g.fillRect(R() * w, R() * h * 0.2 + h * 0.8, 2, 10 + R() * 20); }
  });
  const tactileTex = tex(64, 64, (g, w, h) => {
    g.fillStyle = '#e8b800'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd21f';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(8 + i * 16, 8 + j * 16, 5, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(9 + i * 16, 10 + j * 16, 5, 0, 3.1); g.fill(); }
  });
  const guideTex = tex(64, 64, (g, w, h) => { // dungi longitudinale (ghidaj)
    g.fillStyle = '#e8b800'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd21f'; for (let i = 0; i < 4; i++) g.fillRect(4 + i * 16, 0, 8, h);
  });
  const terrazzo = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#d9d4ca'; g.fillRect(0, 0, w, h);
    const cols = ['#bfb7a8', '#e9e5dc', '#a59b8a', '#c9c2b3', '#8f8677'];
    for (let i = 0; i < 2600; i++) { g.fillStyle = cols[Math.floor(R() * cols.length)]; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3); }
    g.strokeStyle = 'rgba(120,110,95,0.4)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
  });
  const windowsTex = tex(64, 64, (g, w, h) => { // ferestre istorice (canaturi)
    g.fillStyle = '#26323d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8e3d6'; g.fillRect(30, 0, 4, h); g.fillRect(0, 22, w, 3);
  });
  const slatsTex = tex(64, 64, (g, w, h) => { // tavan din lamele de lemn
    g.fillStyle = '#3a2a1a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { const s = R(); g.fillStyle = `rgb(${196 + s * 25},${150 + s * 20},${98 + s * 15})`; g.fillRect(i * 16 + 2, 0, 11, h); }
  });
  const matTex = tex(64, 64, (g, w, h) => { // gratar / covor de intrare (nervuri din aluminiu + cauciuc gri)
    g.fillStyle = '#8d9196'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { g.fillStyle = '#5f646a'; g.fillRect(0, i * 8 + 5, w, 3); }
  });

  // ---- materiale ----
  const M = {
    textures: { paving, platformTex, oldPlatTex, asphalt, timber, pvTex, sedumTex, greenWallTex, ballastTex, facadeOld, tactileTex, guideTex, terrazzo, windowsTex, slatsTex, matTex },
    // Scena nu are hartă de mediu (envMap): metalele cu metalness mare ar ieși aproape negre,
    // de aceea otelurile au metalness moderat si culori ceva mai deschise.
    entryMat: std('covor-intrare', { color: 0xffffff, map: matTex, roughness: 0.85 }),
    plaster: std('tencuiala', { color: 0xf3eee3, roughness: 0.88 }),
    plasterTrim: std('ornamente', { color: 0xdccfb4, roughness: 0.8 }),
    plinth: std('soclu', { color: 0x9a948a, roughness: 0.9 }),
    roof: std('acoperis', { color: 0x5c6670, roughness: 0.55, metalness: 0.35 }),
    histWindow: std('ferestre', { color: 0xffffff, map: windowsTex, roughness: 0.3, metalness: 0.2, emissive: 0xffc982, emissiveMap: windowsTex, emissiveIntensity: 0 }),
    glass: std('sticla', { color: 0xbfdcea, roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
    glassTint: std('sticla-fumurie', { color: 0x7fa3b8, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
    timber: std('lemn', { color: 0xffffff, map: timber, roughness: 0.7 }),
    slats: std('lamele', { color: 0xffffff, map: slatsTex, roughness: 0.75, side: THREE.DoubleSide }),
    steel: std('otel', { color: 0x69727d, roughness: 0.5, metalness: 0.3 }),
    steelWhite: std('otel-alb', { color: 0xe4e7ea, roughness: 0.45, metalness: 0.15 }),
    concrete: std('beton', { color: 0xbcb8b0, roughness: 0.92 }),
    platform: std('peron', { color: 0xffffff, map: platformTex, roughness: 0.85 }),
    platformOld: std('peron-vechi', { color: 0xffffff, map: oldPlatTex, roughness: 0.95 }),
    paving: std('pavaj', { color: 0xffffff, map: paving, roughness: 0.9 }),
    asphalt: std('asfalt', { color: 0xffffff, map: asphalt, roughness: 0.95 }),
    terrazzo: std('terrazzo', { color: 0xffffff, map: terrazzo, roughness: 0.35, metalness: 0.05 }),
    tactile: std('tactil', { color: 0xffffff, map: tactileTex, roughness: 0.7 }),
    guide: std('ghidaj', { color: 0xffffff, map: guideTex, roughness: 0.7 }),
    pv: std('fotovoltaic', { color: 0xffffff, map: pvTex, roughness: 0.22, metalness: 0.5 }),
    sedum: std('sedum', { color: 0xffffff, map: sedumTex, roughness: 1 }),
    greenWall: std('perete-verde', { color: 0xffffff, map: greenWallTex, roughness: 0.95 }),
    grass: std('gazon', { color: 0x6f9f4f, roughness: 1 }),
    soil: std('sol', { color: 0x4f4032, roughness: 1 }),
    water: std('apa', { color: 0x4f86a0, roughness: 0.12, metalness: 0.1 }),
    leaf: std('frunze', { color: 0x4a8a3a, roughness: 0.9, flatShading: true }),
    trunk: std('trunchi', { color: 0x5a4030, roughness: 1 }),
    ballast: std('balast', { color: 0xffffff, map: ballastTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }),
    sleeper: std('traverse', { color: 0x8d8a83, roughness: 0.9 }),
    rail: std('sine', { color: 0x9aa0a6, roughness: 0.4, metalness: 0.45 }),
    dark: std('negru', { color: 0x262b31, roughness: 0.6, metalness: 0.1 }),
    rubber: std('cauciuc', { color: 0x2a2d31, roughness: 0.95 }),
    seat: std('scaune', { color: 0x0f766e, roughness: 0.5 }),
    seatWood: std('banca-lemn', { color: 0xb98552, map: timber, roughness: 0.7 }),
    red: std('rosu', { color: 0xd92b2b, roughness: 0.5 }),
    white: std('alb', { color: 0xf4f6f8, roughness: 0.5 }),
    binPaper: std('hartie', { color: 0x2563eb, roughness: 0.6 }),
    binPlastic: std('plastic', { color: 0xf2c200, roughness: 0.6 }),
    binGlass: std('sticla-cos', { color: 0x15803d, roughness: 0.6 }),
    binBio: std('bio', { color: 0x7a4a26, roughness: 0.6 }),
    container: std('container', { color: 0x2f6f5a, roughness: 0.6, metalness: 0.3 }),
    car1: std('auto1', { color: 0x9aa4ae, roughness: 0.35, metalness: 0.5 }),
    bus: std('autobuz', { color: 0x23a36b, roughness: 0.4, metalness: 0.3 }),
    // ---- emisive (lumineaza noaptea) ----
    lamp: std('lampa', { color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.2, roughness: 0.4 }),
    ledCool: std('led-rece', { color: 0xe8f6ff, emissive: 0xcfeaff, emissiveIntensity: 0.4, roughness: 0.4 }),
    ledGreen: std('linie-verde', { color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.6, roughness: 0.4 }),
    ledOrange: std('linie-portocalie', { color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 0.6, roughness: 0.4 }),
    ledBlue: std('linie-albastra', { color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 0.6, roughness: 0.4 }),
    ledPurple: std('linie-mov', { color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.6, roughness: 0.4 }),
    sosGlow: std('sos', { color: 0x16a34a, emissive: 0x22c55e, emissiveIntensity: 0.8 }),
    exitGlow: std('iesire', { color: 0x16a34a, emissive: 0x16a34a, emissiveIntensity: 0.9 }),
    screenOff: std('ecran', { color: 0x0b1220, roughness: 0.25, metalness: 0.3 }),
  };
  for (const k of ['glass', 'glassTint']) M[k].userData.noShadow = true;
  for (const k of ['lamp', 'ledCool', 'ledGreen', 'ledOrange', 'ledBlue', 'ledPurple', 'sosGlow', 'exitGlow']) M[k].userData.noShadow = true;
  M.ballast.userData.noShadow = true;

  // lumini emisive care cresc noaptea
  M.nightGlow = [
    [M.lamp, 0.15, 2.4], [M.ledCool, 0.35, 2.2], [M.ledGreen, 0.5, 1.8], [M.ledOrange, 0.5, 1.8], [M.ledBlue, 0.5, 1.8], [M.ledPurple, 0.5, 1.8],
    [M.histWindow, 0, 0.9], [M.exitGlow, 0.8, 1.6],
  ];
  M.setNight = (n) => {
    for (const [m, day, night] of M.nightGlow) m.emissiveIntensity = day + (night - day) * n;
    M.glass.opacity = 0.26 + n * 0.08;
  };
  // materiale LED de margine de peron — cate unul pe linie (pulseaza la sosirea trenului)
  M.edge = {};
  for (const id of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    M.edge[id] = std('led-margine-' + id, { color: 0xf5f9ff, emissive: 0xdff1ff, emissiveIntensity: 0.4, roughness: 0.3 });
    M.edge[id].userData.noShadow = true;
  }
  return M;
}

// Textura cu un singur desen (fara repetare) — semne, ecrane
export function canvasTex(w, h, draw) {
  return tex(w, h, draw, false);
}
