import * as THREE from 'three';
import { rng } from './util.js';

// Texturi procedurale (CanvasTexture) pentru oras: fatade, acoperisuri, asfalt cu marcaje, pavaj, sol.
// Toate sunt generate o singura data (cache), putere a lui 2, cu mipmap-uri si anizotropie 8.
// Hartile de culoare sunt sRGB; hartile emisive de noapte au EXACT aceeasi asezare ca ferestrele de zi.
//
// Conventii UV (metri): fatadele au u = distanta pe perimetru, v = inaltimea peste sol;
// `tile` = cati metri acopera textura (texture.repeat = 1 / tile) – vezi FACADE_TILES.

const cache = new Map();
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

function tex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = makeCanvas(w, h);
  if (c) draw(c.getContext('2d'), w, h);
  const t = c ? new THREE.CanvasTexture(c) : new THREE.Texture();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// zgomot fin (pete de luminozitate) peste tot canvasul
function speckle(g, w, h, n, r, lo, hi, alpha = 0.25, size = 2) {
  for (let i = 0; i < n; i++) {
    const l = lo + r() * (hi - lo);
    g.fillStyle = `rgba(${l},${l},${l},${alpha * r()})`;
    const s = size * (0.5 + r());
    g.fillRect(r() * w, r() * h, s, s);
  }
}

// --------------------------------------------------------------------------------------------
// Fatade (1024 px). Fiecare tip: { map, emissive, rough, tile:[m latime, m inaltime] }.
// Baza deschisa (aprox. alba) => culoarea finala vine din culorile varfurilor (nuanta pe cladire, inmultita).
// `rough` = harta roughness (canal G) + metalness (canal B): sticla neteda si usor metalica => reflecta mediul.
// Hartile emisive de noapte folosesc EXACT aceleasi dreptunghiuri de ferestre (lista `lit`).
// --------------------------------------------------------------------------------------------
export const FACADE_TILES = {
  house: [24, 12],   // 8 coloane x 3 m, 4 etaje x 3 m; usa in coloana 0, parter
  block: [28.8, 30], // 8 module x 3,6 m, 10 etaje x 3 m (P+4…P+9), intrari la parter
  ind: [32, 16],     // tabla cutata / beton, ferestre banda sus
};

// tencuiala: pete mari (umezeala, reparatii) + granulatie fina
function stucco(g, w, h, r, base, blotch = 60, grain = 26000) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < blotch; i++) {
    const x = r() * w, y = r() * h, rad = 30 + r() * 140, d = r() < 0.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, d ? `rgba(90,80,60,${0.05 + r() * 0.06})` : `rgba(255,255,250,${0.06 + r() * 0.08})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(g, w, h, grain, r, 120, 255, 0.16, 1.6);
}
// prelingeri de murdarie sub glafuri / din cornisa
function streak(g, x, y, w, len, a = 0.12) {
  const gr = g.createLinearGradient(0, y, 0, y + len);
  gr.addColorStop(0, `rgba(70,62,50,${a})`); gr.addColorStop(1, 'rgba(70,62,50,0)');
  g.fillStyle = gr; g.fillRect(x, y, w, len);
}
// geam: reflexie de cer (sus deschis, jos inchis) + o diagonala de lumina (+ uneori perdea)
function glass(g, x, y, w, h, r, tint = [44, 58, 70]) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  const [a, b, c] = tint, k = 0.85 + r() * 0.3;
  gr.addColorStop(0, `rgb(${(a + 70) * k | 0},${(b + 80) * k | 0},${(c + 85) * k | 0})`);
  gr.addColorStop(0.45, `rgb(${a * k | 0},${b * k | 0},${c * k | 0})`);
  gr.addColorStop(1, `rgb(${a * 0.6 | 0},${b * 0.6 | 0},${c * 0.6 | 0})`);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.beginPath(); g.moveTo(x + w * 0.2, y); g.lineTo(x + w * 0.45, y); g.lineTo(x + w * 0.05, y + h); g.lineTo(x - w * 0.2, y + h); g.fill();
  if (r() < 0.35) {
    g.fillStyle = r() < 0.5 ? 'rgba(235,228,210,0.55)' : 'rgba(200,190,170,0.5)';
    g.fillRect(x, y, w, h * (0.15 + r() * 0.5));
  }
  g.restore();
}
// toc + cercevele in jurul unui geam
function frame(g, x, y, w, h, c, p) {
  g.fillStyle = c; g.fillRect(x - p, y - p, w + 2 * p, p); g.fillRect(x - p, y + h, w + 2 * p, p);
  g.fillRect(x - p, y, p, h); g.fillRect(x + w, y, p, h);
}

function facade(kind) {
  return memo('facade2-' + kind, () => {
    const [TW, TH] = FACADE_TILES[kind];
    const W = 1024, H = kind === 'ind' ? 512 : 1024;
    const sx = W / TW, sy = H / TH; // px pe metru
    const lit = [];    // dreptunghiuri de ferestre (px) – aceleasi pe harta de zi si pe cea de noapte
    const glassR = []; // dreptunghiuri cu sticla (roughness mic)
    const r = rng(kind === 'house' ? 101 : kind === 'block' ? 202 : 303);
    const Y = (v) => H - v * sy; // v = inaltimea peste sol
    const fr = 0.07 * sx;
    const map = tex(W, H, (g) => {
      if (kind === 'house') {
        stucco(g, W, H, r, '#f3efe8');
        for (let f = 0; f < 4; f++) {
          g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, Y(f * 3 + 3) - 2, W, 0.12 * sy); // brau
          g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(0, Y(f * 3 + 3) + 0.12 * sy - 2, W, 0.05 * sy);
          for (let c = 0; c < 8; c++) {
            const x0 = c * 3 * sx;
            if (f === 0 && c === 0) { // usa
              const dx = x0 + 0.9 * sx, dw = 1.1 * sx, dh = 2.15 * sy;
              g.fillStyle = r() < 0.5 ? '#5b3d2a' : '#3f4448'; g.fillRect(dx, Y(2.25), dw, dh);
              g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(dx + dw * 0.08, Y(2.25) + dh * 0.55, dw * 0.84, 3);
              glass(g, dx + dw * 0.18, Y(2.05), dw * 0.64, dh * 0.35, r);
              glassR.push([dx + dw * 0.18, Y(2.05), dw * 0.64, dh * 0.35]);
              lit.push([dx + dw * 0.18, Y(2.05), dw * 0.64, dh * 0.35, 0.5]);
              g.fillStyle = '#9d978d'; g.fillRect(dx - 0.25 * sx, Y(0.1), dw + 0.5 * sx, 0.1 * sy); // treapta
              continue;
            }
            // ferestre de marimi diferite: duble, normale, inguste (baie)
            const t = r();
            const ww = (t < 0.2 ? 1.9 : t < 0.85 ? 1.3 : 0.7) * sx, wh = (t < 0.85 ? 1.45 : 0.75) * sy;
            const wx = x0 + 1.5 * sx - ww / 2, wy = Y(f * 3 + (t < 0.85 ? 2.4 : 2.45));
            g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(wx - 0.1 * sx, wy - 0.1 * sy, ww + 0.2 * sx, wh + 0.2 * sy); // ambrazura
            glass(g, wx, wy, ww, wh, r);
            glassR.push([wx, wy, ww, wh]);
            const fc = r() < 0.75 ? '#f2f2ee' : '#6b4a33';
            frame(g, wx, wy, ww, wh, fc, fr);
            g.fillStyle = fc;
            if (ww > 1.0 * sx) g.fillRect(wx + ww / 2 - 0.035 * sx, wy, 0.07 * sx, wh);
            g.fillRect(wx, wy + wh * 0.32, ww, 0.05 * sy);
            g.fillStyle = '#8f8a82'; g.fillRect(wx - 0.12 * sx, wy + wh + 0.06 * sy, ww + 0.24 * sx, 0.07 * sy); // glaf
            streak(g, wx + ww * 0.1, wy + wh + 0.13 * sy, ww * 0.8, (0.4 + r() * 0.9) * sy, 0.08 + r() * 0.08);
            lit.push([wx, wy, ww, wh, 1]);
          }
        }
        // soclu ~0,6 m (mai inchis) + stropi
        g.fillStyle = '#a9a196'; g.fillRect(0, Y(0.6), W, 0.6 * sy + 2);
        for (let i = 0; i < 1800; i++) { const l = 80 + r() * 90; g.fillStyle = `rgba(${l | 0},${(l - 6) | 0},${(l - 14) | 0},0.35)`; g.fillRect(r() * W, Y(0.6) + r() * 0.6 * sy, 2, 2); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, Y(0.6) - 2, W, 3);
        streak(g, 0, Y(0.95), W, 0.35 * sy, 0.10);
      } else if (kind === 'block') {
        stucco(g, W, H, r, '#e9e7e1', 80, 34000);
        // rosturi de panouri prefabricate + dungi de murdarie pe rosturi
        for (let c = 0; c <= 8; c++) { g.fillStyle = 'rgba(55,55,55,0.3)'; g.fillRect(c * 3.6 * sx - 1.5, 0, 3, H); streak(g, c * 3.6 * sx - 6, 0, 12, H, 0.05); }
        for (let f = 0; f <= 10; f++) { g.fillStyle = 'rgba(55,55,55,0.28)'; g.fillRect(0, Y(f * 3) - 1.5, W, 3); }
        for (let f = 0; f < 10; f++) for (let c = 0; c < 8; c++) {
          const x0 = c * 3.6 * sx;
          if (f === 0) {
            if (c === 3) { // scara blocului: usa + copertina
              g.fillStyle = '#454b52'; g.fillRect(x0 + 1.1 * sx, Y(2.3), 1.4 * sx, 2.3 * sy);
              glass(g, x0 + 1.2 * sx, Y(2.2), 1.2 * sx, 0.9 * sy, r);
              glassR.push([x0 + 1.2 * sx, Y(2.2), 1.2 * sx, 0.9 * sy]);
              g.fillStyle = '#9a9a96'; g.fillRect(x0 + 0.7 * sx, Y(2.65), 2.2 * sx, 0.22 * sy);
              g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0 + 0.7 * sx, Y(2.43), 2.2 * sx, 0.25 * sy);
              lit.push([x0 + 1.2 * sx, Y(2.2), 1.2 * sx, 0.9 * sy, 0.8]);
            } else {
              const wx = x0 + 0.9 * sx, ww = 1.6 * sx, wy = Y(2.3), wh = 1.2 * sy;
              glass(g, wx, wy, ww, wh, r); glassR.push([wx, wy, ww, wh]);
              frame(g, wx, wy, ww, wh, '#efefea', fr);
              lit.push([wx, wy, ww, wh, 1]);
            }
            continue;
          }
          if (c % 2 === 1) {
            // balcon in loggie: nisa umbrita (adancime), usa + fereastra, placa, parapet plin / inchis cu termopan / balustrada
            const bx = x0 + 0.25 * sx, bw = 3.1 * sx, by = Y(f * 3 + 2.85), bh = 2.85 * sy;
            g.fillStyle = 'rgba(40,36,30,0.30)'; g.fillRect(bx, by, bw, bh);
            g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(bx, by, bw, 0.35 * sy);
            const wx = x0 + 0.55 * sx, ww = 2.5 * sx, wy = Y(f * 3 + 2.45), wh = 2.0 * sy;
            glass(g, wx, wy, ww, wh, r); glassR.push([wx, wy, ww, wh]);
            frame(g, wx, wy, ww, wh, '#ecece6', fr);
            g.fillStyle = '#ecece6'; g.fillRect(wx + ww * 0.36, wy, 0.07 * sx, wh);
            lit.push([wx, wy, ww, wh * 0.55, 1]);
            const type = r();
            const py = Y(f * 3 + 1.1), ph = 1.1 * sy;
            if (type < 0.4) {
              const pv = 120 + Math.floor(r() * 70), hue = r();
              g.fillStyle = hue < 0.5 ? `rgb(${pv + 50},${pv + 35},${pv + 15})` : `rgb(${pv + 10},${pv + 25},${pv + 35})`;
              g.fillRect(bx, py, bw, ph);
              g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(bx, py, bw, 0.06 * sy);
            } else if (type < 0.75) {
              const gy = by + 0.35 * sy, gh = bh - 0.35 * sy - ph - 1.1 * sy + ph; // pana la parapet
              glass(g, bx + 0.05 * sx, gy, bw - 0.1 * sx, py - gy, r, [60, 70, 76]);
              glassR.push([bx + 0.05 * sx, gy, bw - 0.1 * sx, py - gy]);
              g.fillStyle = '#f0f0ec';
              for (let k = 0; k <= 4; k++) g.fillRect(bx + (k * (bw - 0.1 * sx)) / 4, gy, 0.06 * sx, py - gy);
              g.fillStyle = '#d8d4c8'; g.fillRect(bx, py, bw, ph);
              void gh;
            } else {
              g.fillStyle = 'rgba(30,30,30,0.85)';
              g.fillRect(bx, py, bw, 0.06 * sy);
              for (let k = 0; k <= 22; k++) g.fillRect(bx + (k * bw) / 22, py, 2, ph);
              g.fillRect(bx, py + ph - 0.05 * sy, bw, 0.05 * sy);
            }
            g.fillStyle = '#c9c6bd'; g.fillRect(bx - 0.05 * sx, py + ph, bw + 0.1 * sx, 0.14 * sy); // placa
            g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(bx - 0.05 * sx, py + ph + 0.14 * sy, bw + 0.1 * sx, 0.12 * sy);
            streak(g, bx + bw * 0.1, py + ph + 0.26 * sy, bw * 0.15, (0.8 + r() * 1.5) * sy, 0.10);
          } else {
            const wx = x0 + 0.95 * sx, ww = 1.7 * sx, wy = Y(f * 3 + 2.35), wh = 1.4 * sy;
            g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(wx - 0.08 * sx, wy - 0.08 * sy, ww + 0.16 * sx, wh + 0.16 * sy);
            glass(g, wx, wy, ww, wh, r); glassR.push([wx, wy, ww, wh]);
            frame(g, wx, wy, ww, wh, '#efefea', fr);
            g.fillStyle = '#efefea'; g.fillRect(wx + ww / 2 - 0.035 * sx, wy, 0.07 * sx, wh);
            g.fillStyle = '#9b978f'; g.fillRect(wx - 0.08 * sx, wy + wh + 0.07 * sy, ww + 0.16 * sx, 0.06 * sy);
            streak(g, wx, wy + wh + 0.13 * sy, ww, (0.3 + r() * 0.8) * sy, 0.08);
            lit.push([wx, wy, ww, wh, 1]);
          }
        }
        // soclu de beton ~0,9 m
        g.fillStyle = '#a3a19a'; g.fillRect(0, Y(0.9), W, 0.9 * sy + 2);
        for (let i = 0; i < 2500; i++) { const l = (90 + r() * 80) | 0; g.fillStyle = `rgba(${l},${l},${l},0.35)`; g.fillRect(r() * W, Y(0.9) + r() * 0.9 * sy, 2, 2); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, Y(0.9) - 2, W, 3);
      } else { // ind
        g.fillStyle = '#e6e6e3'; g.fillRect(0, 0, W, H);
        // tabla cutata: nervuri la ~0,25 m (lumina / umbra)
        const rib = Math.max(4, Math.round(0.25 * sx));
        for (let x = 0; x < W; x += rib) {
          g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, 0, rib * 0.2, H);
          g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + rib * 0.55, 0, rib * 0.25, H);
        }
        speckle(g, W, H, 9000, r, 110, 230, 0.15, 1.6);
        for (let i = 0; i < 40; i++) streak(g, r() * W, 0, 6 + r() * 30, (2 + r() * 8) * sy, 0.06 + r() * 0.06); // rugina
        g.fillStyle = '#b6b2aa'; g.fillRect(0, Y(1.2), W, 1.2 * sy + 2);
        for (let i = 0; i < 2000; i++) { const l = (100 + r() * 90) | 0; g.fillStyle = `rgba(${l},${l},${l},0.35)`; g.fillRect(r() * W, Y(1.2) + r() * 1.2 * sy, 2, 2); }
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, Y(1.2) - 2, W, 3);
        for (let c = 0; c < 4; c++) {
          const x0 = c * 8 * sx;
          const wx = x0 + 0.6 * sx, ww = 6.8 * sx, wh = 1.3 * sy;
          for (const wy of [Y(5.6), Y(13.2)]) {
            glass(g, wx, wy, ww, wh, r, [52, 64, 72]); glassR.push([wx, wy, ww, wh]);
            g.fillStyle = '#8e9599'; for (let k = 0; k <= 6; k++) g.fillRect(wx + (k * ww) / 6 - 2, wy, 4, wh);
            frame(g, wx, wy, ww, wh, '#8e9599', 0.06 * sx);
            lit.push([wx, wy, ww, wh, 1]);
          }
          if (c === 1) { // poarta sectionala
            g.fillStyle = '#8d9296'; g.fillRect(x0 + 2 * sx, Y(4.2), 4 * sx, 4.2 * sy);
            g.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 1; k < 10; k++) g.fillRect(x0 + 2 * sx, Y(4.2) + k * 0.42 * sy, 4 * sx, 3);
            g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0 + 2 * sx - 4, Y(4.2) - 4, 4 * sx + 8, 5);
          }
        }
      }
    });
    // roughness (canal G) + metalness (canal B): perete mat, sticla lucioasa
    const rough = tex(W, H, (g) => {
      g.fillStyle = kind === 'ind' ? 'rgb(0,150,60)' : 'rgb(0,235,0)'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgb(0,22,90)';
      for (const [x, y, w, h] of glassR) g.fillRect(x, y, w, h);
    }, { srgb: false });
    const lr = rng(kind.length * 977);
    const emissive = tex(W, H, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      for (const [x, y, w, h, p] of lit) {
        if (lr() > (kind === 'ind' ? 0.55 : 0.4) * p + (p < 1 ? 0.5 : 0)) continue;
        const warm = lr();
        g.fillStyle = warm > 0.25 ? `hsl(${30 + lr() * 15},90%,${50 + lr() * 25}%)` : `hsl(205,55%,${55 + lr() * 20}%)`;
        g.fillRect(x, y, w, h);
      }
    });
    for (const t of [map, emissive, rough]) t.repeat.set(1 / TW, 1 / TH);
    return { map, emissive, rough, tile: [TW, TH] };
  });
}
export const facadeTextures = facade;

// --------------------------------------------------------------------------------------------
// Acoperisuri: u = metri pe orizontala, v = metri pe panta
// --------------------------------------------------------------------------------------------
export function roofTileTexture() {
  return memo('roof-tile', () => {
    const W = 256, H = 256, TW = 4, TH = 4; // 4 x 4 m
    const r = rng(17);
    const t = tex(W, H, (g) => {
      g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, W, H);
      const cw = W / 12, rh = H / 12; // tigla ~0,33 m
      for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
        const l = 205 + Math.floor(r() * 50);
        g.fillStyle = `rgb(${l},${l},${l})`;
        const x = i * cw + ((j % 2) * cw) / 2;
        g.fillRect(x, j * rh, cw - 1, rh);
        if (x + cw > W) g.fillRect(x - W, j * rh, cw - 1, rh);
        // umbra tiglei de deasupra + ondulatie
        const gr = g.createLinearGradient(0, j * rh, 0, j * rh + rh);
        gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.25, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.08)');
        g.fillStyle = gr; g.fillRect(0, j * rh, W, rh);
      }
      for (let i = 0; i < 24; i++) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(i * cw / 2, 0, 1, H); }
      speckle(g, W, H, 2500, r, 60, 200, 0.2);
    });
    t.repeat.set(1 / TW, 1 / TH);
    return t;
  });
}

export function roofMetalTexture() {
  return memo('roof-metal', () => {
    const W = 256, H = 64, TW = 4, TH = 1;
    const r = rng(19);
    const t = tex(W, H, (g) => {
      g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 32) { // falt la 0,5 m
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x, 0, 3, H);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 3, 0, 2, H);
      }
      speckle(g, W, H, 900, r, 80, 230, 0.15);
    });
    t.repeat.set(1 / TW, 1 / TH);
    return t;
  });
}

export function roofFlatTexture() {
  return memo('roof-flat', () => {
    const W = 256, H = 256, TW = 8, TH = 8;
    const r = rng(23);
    const t = tex(W, H, (g) => {
      g.fillStyle = '#d9d9d6'; g.fillRect(0, 0, W, H);
      speckle(g, W, H, 9000, r, 70, 255, 0.35, 1.6); // pietris
      // fasii de membrana (1 m) + guri de scurgere
      g.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < H; y += 32) g.fillRect(0, y, W, 2);
      g.fillStyle = 'rgba(60,60,60,0.5)'; g.beginPath(); g.arc(W * 0.7, H * 0.3, 4, 0, Math.PI * 2); g.fill();
    });
    t.repeat.set(1 / TW, 1 / TH);
    return t;
  });
}

// --------------------------------------------------------------------------------------------
// Drumuri: u 0..1 de-a curmezisul, v = metri de-a lungul (perioada 9 m: linie 3 m + pauza 6 m)
// marking: 'none' | 'center' (axa intrerupta) | 'major' (axa + linii de margine)
// --------------------------------------------------------------------------------------------
export const ROAD_PERIOD = 9;
export function asphaltTexture(marking = 'none') {
  return memo('asphalt-' + marking, () => {
    const W = 256, H = 512;
    const r = rng(marking.length * 31 + 7);
    const t = tex(W, H, (g) => {
      g.fillStyle = '#56585b'; g.fillRect(0, 0, W, H);
      speckle(g, W, H, 14000, r, 10, 170, 0.35, 1.5);
      // petice / fisuri reparate
      for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`; g.fillRect(r() * W, r() * H, 20 + r() * 60, 30 + r() * 80); }
      // urme de roti (mai inchise)
      g.fillStyle = 'rgba(0,0,0,0.07)';
      for (const u of [0.2, 0.32, 0.68, 0.8]) g.fillRect(u * W - 8, 0, 16, H);
      const paint = 'rgba(255,255,255,0.95)';
      if (marking === 'center' || marking === 'major') {
        g.fillStyle = paint; g.fillRect(W / 2 - 3, 0, 6, H / 3); // 3 m din 9 m
      }
      if (marking === 'major') {
        g.fillStyle = paint; g.fillRect(0.045 * W, 0, 5, H); g.fillRect(0.955 * W - 5, 0, 5, H);
      }
    }, { srgb: true });
    t.repeat.set(1, 1 / ROAD_PERIOD);
    return t;
  });
}

// pavele (trotuar) – u si v in metri, placa 0,5 x 0,5 m, cu bordura nu se ocupa textura
export function paverTexture() {
  return memo('pavers', () => {
    const W = 256, H = 256, TW = 2, TH = 2;
    const r = rng(29);
    const t = tex(W, H, (g) => {
      g.fillStyle = '#cfcdc8'; g.fillRect(0, 0, W, H);
      const s = W / 4;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const l = 200 + Math.floor(r() * 40);
        g.fillStyle = `rgb(${l},${l - 2},${l - 6})`;
        g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
      speckle(g, W, H, 3000, r, 90, 240, 0.2);
    });
    t.repeat.set(1 / TW, 1 / TH);
    return t;
  });
}

// --------------------------------------------------------------------------------------------
// Sol stilizat: modele (CanvasPattern) pentru pictarea hartii de utilizare a terenului.
// Fiecare model este un canvas mic, cu zgomot in jurul culorii date (folosit cu g.createPattern).
// --------------------------------------------------------------------------------------------
export function groundPatternCanvas(kind, hex) {
  return memo('ground-' + kind + hex, () => {
    const S = 64;
    const c = makeCanvas(S, S);
    if (!c) return null;
    const g = c.getContext('2d');
    const col = new THREE.Color(hex);
    const r = rng(hex & 0xffff);
    const css = (k) => col.clone().multiplyScalar(k).getStyle();
    g.fillStyle = '#' + col.getHexString(); g.fillRect(0, 0, S, S);
    if (kind === 'field') { // brazde (benzi) – fiecare parcela are oricum nuanta ei
      for (let y = 0; y < S; y += 2) { g.fillStyle = css(y % 4 ? 0.94 : 1.06); g.fillRect(0, y, S, 1); }
      for (let i = 0; i < 200; i++) { g.fillStyle = css(0.85 + r() * 0.3); g.fillRect(r() * S, r() * S, 1, 1); }
    } else if (kind === 'forest') { // coronamente si umbre
      for (let i = 0; i < 260; i++) { g.fillStyle = css(0.7 + r() * 0.5); g.beginPath(); g.arc(r() * S, r() * S, 0.8 + r() * 2.2, 0, Math.PI * 2); g.fill(); }
    } else { // iarba
      for (let i = 0; i < 700; i++) { g.fillStyle = css(0.88 + r() * 0.24); g.fillRect(r() * S, r() * S, 1, 1); }
    }
    return c;
  });
}
