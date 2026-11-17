import * as THREE from 'three';
import { merge, box, cyl, tint, makeCanvas, canvasTex, roundRect } from './util3d.js';

// Tramvaiul usor T1: vehicul cu podea joasa 100 %, 3 sectiuni (cabina A – mijloc B – cabina C), ~32,6 m,
// pe baterii (fara pantograf de catenara; colector de incarcare pe acoperis, ridicat doar la terminale).
// Sistem local al unei sectiuni: inainte = -z, dreapta = +x, sus = +y, y = 0 la nivelul sinei.

export const CAB_LEN = 11.6, MID_LEN = 8.6, GAP = 0.4;
export const SECTION_OFFSETS = [CAB_LEN / 2 + GAP + MID_LEN / 2, 0, -(CAB_LEN / 2 + GAP + MID_LEN / 2)]; // A, B, C fata de centru
export const TRAM_LENGTH = CAB_LEN * 2 + MID_LEN + GAP * 2;

const WHITE = 0xf4f6f8, ORANGE = 0xf97316, SKIRT = 0x2a3038, ROOF = 0xd5dade, DARK = 0x1c2229;

// inel transversal (sens: varf -> partea dreapta in jos -> fund -> partea stanga in sus)
const RIGHT = [
  [0, 3.47, 'roof'], [0.85, 3.42, 'roof'], [1.18, 3.28, 'roof'], [1.30, 2.95, 'upper'], [1.325, 2.55, 'window'],
  [1.325, 1.02, 'stripe'], [1.325, 0.92, 'wall'], [1.32, 0.45, 'skirt'], [1.25, 0.30, 'bottom'],
];
function makeRing() {
  // fiecare punct are eticheta segmentului care pleaca din el
  const ring = RIGHT.map(([x, y, l]) => ({ x, y, l }));
  ring.push({ x: 0, y: 0.30, l: 'bottom' });
  const left = RIGHT.slice(1).reverse().map(([x, y], i, arr) => {
    // eticheta segmentului de la acest punct spre urmatorul (in sus pe stanga) = eticheta segmentului oglindit
    const idxR = RIGHT.length - 1 - i; // punctul RIGHT[idxR]
    const lab = RIGHT[idxR - 1][2];
    return { x: -x, y, l: lab };
  });
  return ring.concat(left); // inchis implicit (ultimul -> primul)
}
const RING = makeRing();
const SEG_COLORS = { roof: ROOF, upper: WHITE, window: WHITE, stripe: ORANGE, wall: WHITE, skirt: SKIRT, bottom: DARK };

function noseXform(u) {
  // u = 0 (inceputul botului) .. 1 (varf)
  const xs = 1 - 0.36 * Math.pow(u, 2.2);
  const ytop = 3.47 - 2.1 * Math.pow(u, 1.25);
  const ybot = 0.30 + 0.25 * Math.pow(u, 3);
  return { xs, ytop, ybot };
}
function xformPoint(p, tf) {
  let y = p.y;
  if (y > 1.02) y = 1.02 + (y - 1.02) * (tf.ytop - 1.02) / (3.47 - 1.02);
  if (y < tf.ybot) y = tf.ybot;
  return [p.x * tf.xs, y];
}

// zone in lungul sectiunii: p = stalp (plin), w = fereastra, d = usa, n = bot (parbriz)
const CAB_ZONES = [['n', -5.8, -3.9], ['w', -3.9, -2.95], ['p', -2.95, -2.8], ['d', -2.8, -1.5], ['p', -1.5, -1.35], ['w', -1.35, 0.25], ['p', 0.25, 0.4],
  ['w', 0.4, 1.85], ['p', 1.85, 2.0], ['d', 2.0, 3.3], ['p', 3.3, 3.45], ['w', 3.45, 5.55], ['p', 5.55, 5.8]];
const MID_ZONES = [['p', -4.3, -4.15], ['w', -4.15, -0.8], ['p', -0.8, -0.65], ['d', -0.65, 0.65], ['p', 0.65, 0.8], ['w', 0.8, 4.15], ['p', 4.15, 4.3]];

function buildShell(zones) {
  // felii (z de la spate +z spre fata -z)
  const slices = [];
  for (const [type, z0, z1] of zones) {
    if (type === 'n') {
      for (const u of [1, 0.96, 0.88, 0.75, 0.6, 0.4, 0.2]) slices.push({ z: z1 + (z0 - z1) * u, u });
    } else slices.push({ z: z0, u: 0 }, { z: z1, u: 0 });
  }
  slices.sort((a, b) => b.z - a.z);
  const uniq = [];
  for (const s of slices) if (!uniq.length || Math.abs(uniq[uniq.length - 1].z - s.z) > 1e-4) uniq.push(s);
  const zoneAt = (z) => { for (const [t, a, b] of zones) if (z >= a - 1e-4 && z <= b + 1e-4 && t !== 'p') return t; return 'p'; };

  const shell = [], shellCol = [], glass = [], screen = [];
  const col = new THREE.Color();
  const pushQuad = (arr, A, B, C, D, colArr, hex) => {
    arr.push(...A, ...B, ...C, ...B, ...D, ...C);
    if (colArr) { col.set(hex); for (let k = 0; k < 6; k++) colArr.push(col.r, col.g, col.b); }
  };
  for (let i = 0; i < uniq.length - 1; i++) {
    const sa = uniq[i], sb = uniq[i + 1]; // sa spate, sb fata
    const zm = (sa.z + sb.z) / 2;
    const zt = zoneAt(zm);
    const ta = noseXform(sa.u), tb = noseXform(sb.u);
    const nose = sa.u > 0 || sb.u > 0 || zt === 'n';
    for (let k = 0; k < RING.length; k++) {
      const p = RING[k], q = RING[(k + 1) % RING.length];
      const lab = p.l;
      const [ax, ay] = xformPoint(p, ta), [bx, by] = xformPoint(q, ta);
      const [cx, cy] = xformPoint(p, tb), [dx, dy] = xformPoint(q, tb);
      const A = [ax, ay, sa.z], B = [bx, by, sa.z], C = [cx, cy, sb.z], D = [dx, dy, sb.z];
      let isGlass = false;
      if (nose) isGlass = (lab === 'window' || lab === 'upper' || lab === 'roof') && Math.max(sa.u, sb.u) < 0.97;
      else if (zt === 'w') isGlass = lab === 'window';
      else if (zt === 'd') isGlass = lab === 'window' || lab === 'stripe' || lab === 'wall';
      if (isGlass) {
        pushQuad(glass, A, B, C, D);
        // la usi: marginea portocalie a usii ramane ca element de shell foarte subtire? (simplificat)
      } else {
        pushQuad(shell, A, B, C, D, shellCol, nose && lab === 'roof' && Math.max(sa.u, sb.u) >= 0.97 ? WHITE : SEG_COLORS[lab]);
      }
    }
  }
  // capac la varful botului (evantai)
  const tip = uniq[uniq.length - 1];
  if (tip.u > 0.9) {
    const tf = noseXform(tip.u);
    const cxy = [0, (tf.ybot + tf.ytop) / 2];
    for (let k = 0; k < RING.length; k++) {
      const [ax, ay] = xformPoint(RING[k], tf), [bx, by] = xformPoint(RING[(k + 1) % RING.length], tf);
      shell.push(ax, ay, tip.z, bx, by, tip.z, cxy[0], cxy[1], tip.z - 0.06);
      col.set(ay > 1.05 ? DARK : RING[k].l === 'stripe' ? ORANGE : WHITE);
      for (let n = 0; n < 3; n++) shellCol.push(col.r, col.g, col.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(shell, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(shellCol, 3));
  g.computeVertexNormals();
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(glass, 3));
  gg.computeVertexNormals();
  return { shell: g, glass: gg, zones };
}

// interior: podea, scaune, bare, lumini, pupitru
function buildInterior(zones, isCab, zMin, zMax) {
  const parts = [];
  const len = zMax - zMin;
  parts.push(box(2.56, 0.1, len - 0.1, 0, 0.33, (zMin + zMax) / 2, 0x6b7280)); // podea
  parts.push(box(1.0, 0.012, len - 0.4, 0, 0.385, (zMin + zMax) / 2, 0x9ca3af)); // banda culoar
  // scaune pe zonele cu ferestre
  for (const [t, z0, z1] of zones) {
    if (t !== 'w' || (isCab && z1 < -2.9)) continue;
    const n = Math.max(1, Math.floor((z1 - z0) / 0.82));
    for (let k = 0; k < n; k++) {
      const z = z0 + (z1 - z0) * (k + 0.5) / n;
      const facing = k % 2 === 0 ? 1 : -1; // perechi fata in fata
      for (const sx of [-1, 1]) {
        for (const xo of [0.62, 1.08]) {
          const x = sx * xo;
          parts.push(box(0.44, 0.1, 0.44, x, 0.78, z, 0x334155));
          parts.push(box(0.44, 0.55, 0.07, x, 1.1, z + facing * 0.21, ORANGE));
          parts.push(box(0.06, 0.4, 0.06, x, 0.56, z, 0x9ca3af));
        }
        // bara verticala la culoar
        if (k % 2 === 0) parts.push(cyl(0.022, 0.022, 2.8, 6, sx * 0.4, 1.8, z, 0xd1d5db));
      }
    }
  }
  // bare orizontale sub plafon
  for (const sx of [-1, 1]) parts.push(cyl(0.02, 0.02, len - 0.6, 6, sx * 0.42, 3.05, (zMin + zMax) / 2, 0xd1d5db, Math.PI / 2));
  // pupitrul de conducere + scaunul vatmanului
  if (isCab) {
    parts.push(box(2.0, 0.55, 0.6, 0, 0.95, -4.75, 0x1f2937));
    parts.push(box(1.6, 0.06, 0.5, 0, 1.25, -4.7, 0x111827));
    parts.push(box(0.5, 0.12, 0.5, 0, 0.85, -3.75, 0x1f2937));
    parts.push(box(0.5, 0.7, 0.08, 0, 1.25, -3.5, 0x1f2937));
    parts.push(box(2.5, 1.7, 0.05, 0, 1.35, -3.15, 0x2f3a46)); // perete cabina (jumatatea de jos)
  }
  return merge(parts);
}

function buildExterior(isCab, zMin, zMax) {
  const parts = [];
  // boghiu cu roti
  const bz = isCab ? 2.2 : 0;
  parts.push(box(2.2, 0.32, 2.6, 0, 0.2, bz, 0x23272d));
  for (const sx of [-1, 1]) for (const dz of [-0.9, 0.9]) parts.push(cyl(0.32, 0.32, 0.12, 14, sx * 0.72, 0.32, bz + dz, 0x3b4048, 0, Math.PI / 2));
  if (isCab) {
    parts.push(box(2.0, 0.32, 2.4, 0, 0.2, -2.8, 0x23272d));
    for (const sx of [-1, 1]) for (const dz of [-0.85, 0.85]) parts.push(cyl(0.32, 0.32, 0.12, 14, sx * 0.72, 0.32, -2.8 + dz, 0x3b4048, 0, Math.PI / 2));
    // pachete de baterii + racire pe acoperis
    parts.push(box(1.9, 0.38, 3.6, 0, 3.62, 1.6, 0xcfd5db));
    parts.push(box(1.7, 0.08, 3.4, 0, 3.84, 1.6, 0x9aa3ab));
    parts.push(box(1.5, 0.3, 1.6, 0, 3.58, -1.6, 0xcfd5db));
    // oglinzi-camera
    for (const sx of [-1, 1]) parts.push(box(0.08, 0.22, 0.3, sx * 1.42, 2.55, -3.75, DARK));
    // logo T1 pe bot
    parts.push(box(0.42, 0.14, 0.02, 0, 1.12, -5.9, ORANGE));
  } else {
    // carenaj aparat de incarcare + convertizor
    parts.push(box(1.8, 0.3, 4.5, 0, 3.6, 0, 0xcfd5db));
  }
  // burduf de intercirculatie (doar sectiunea de mijloc il poarta, la ambele capete)
  if (!isCab) {
    for (const sz of [-1, 1]) {
      const g = new THREE.BoxGeometry(2.4, 3.0, 0.5);
      g.translate(0, 1.85, sz * (zMax + 0.2));
      parts.push(tint(g, 0x30363d));
    }
  }
  return merge(parts);
}

function buildLights(isCab) {
  // faruri (albe) si stopuri (rosii) pe fata botului (z = -5,8), orientate spre -z
  if (!isCab) return { head: null, tail: null };
  const head = [], tail = [];
  const at = (g, x, y) => { g.rotateY(Math.PI); g.translate(x, y, -5.9); return g; };
  for (const sx of [-1, 1]) {
    head.push(at(new THREE.CircleGeometry(0.12, 16), sx * 0.58, 0.72));
    head.push(at(new THREE.PlaneGeometry(0.34, 0.05), sx * 0.36, 0.93));
    tail.push(at(new THREE.PlaneGeometry(0.18, 0.09), sx * 0.7, 0.5));
  }
  return { head: merge(head, { color: false }), tail: merge(tail, { color: false }) };
}

// ------------------------------------------------------------
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const cab = buildShell(CAB_ZONES);
  const mid = buildShell(MID_ZONES);
  SHARED = {
    cabShell: cab.shell, cabGlass: cab.glass, midShell: mid.shell, midGlass: mid.glass,
    cabInt: buildInterior(CAB_ZONES, true, -5.3, 5.8), midInt: buildInterior(MID_ZONES, false, -4.3, 4.3),
    cabExt: buildExterior(true, -5.8, 5.8), midExt: buildExterior(false, -4.3, 4.3),
    cabLights: buildLights(true),
    mats: {
      shell: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({ color: 0x5d7488, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.FrontSide, emissive: 0xffe3b0, emissiveIntensity: 0 }),
      interior: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0x5a4c3a, emissiveIntensity: 0 }),
      ext: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0xfff4dc, emissiveIntensity: 0.6, roughness: 0.4 }),
    },
  };
  // benzi de lumina in plafon
  const strips = [];
  for (const sx of [-1, 1]) {
    const a = new THREE.BoxGeometry(0.16, 0.03, 10.4); a.translate(sx * 0.75, 3.3, 0.3); strips.push(a);
  }
  SHARED.cabCeil = merge(strips, { color: false });
  const strips2 = [];
  for (const sx of [-1, 1]) { const a = new THREE.BoxGeometry(0.16, 0.03, 8.2); a.translate(sx * 0.75, 3.3, 0); strips2.push(a); }
  SHARED.midCeil = merge(strips2, { color: false });
  return SHARED;
}

// ecran de informare (interior) – desenat pe canvas
function drawScreen(g, W, H, info) {
  g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f97316'; roundRect(g, 10, 12, 74, H - 24, 10); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 46px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('T1', 47, H / 2 + 2);
  g.textAlign = 'left';
  g.fillStyle = '#93a4ba'; g.font = '22px Segoe UI, Arial';
  g.fillText(info.arriving ? 'Stația:' : 'Următoarea stație:', 100, 30);
  g.fillStyle = '#fff'; g.font = 'bold 38px Segoe UI, Arial';
  g.fillText(info.next || '', 100, 76, W - 300);
  g.textAlign = 'right';
  g.fillStyle = '#22d3ee'; g.font = 'bold 40px Segoe UI, Arial';
  g.fillText(`${Math.round(info.kmh)} km/h`, W - 16, 42);
  g.fillStyle = '#facc15'; g.font = '24px Segoe UI, Arial';
  g.fillText(info.dest ? '→ ' + info.dest : '', W - 16, 92, 260);
  g.textAlign = 'left';
}
function drawDest(g, W, H, text) {
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffb347'; g.font = 'bold 30px Consolas, monospace'; g.textBaseline = 'middle';
  g.fillText('T1', 10, H / 2 + 1);
  g.font = 'bold 26px Segoe UI, Arial';
  g.fillText(text, 62, H / 2 + 1, W - 70);
}

// ------------------------------------------------------------
export function createTram(ctx, id) {
  const S = shared();
  const root = new THREE.Group();
  root.name = 'tramvai-' + id;

  // materiale proprii (lumini, ecrane, destinatie) – depind de sensul de mers
  const headA = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const tailA = new THREE.MeshBasicMaterial({ color: 0x400000, side: THREE.DoubleSide });
  const headC = headA.clone(), tailC = tailA.clone();

  const scrCanvas = makeCanvas(512, 128);
  const scrTex = canvasTex(scrCanvas);
  const scrMat = new THREE.MeshBasicMaterial({ map: scrTex, side: THREE.DoubleSide, toneMapped: false });
  const dstCanvas = makeCanvas(256, 40);
  const dstTex = canvasTex(dstCanvas);
  const dstMat = new THREE.MeshBasicMaterial({ map: dstTex, toneMapped: false });

  const sections = [];
  for (const [k, isCab] of [['A', true], ['B', false], ['C', true]]) {
    const sec = new THREE.Group();
    sec.name = 'sectiune-' + k;
    const shellM = new THREE.Mesh(isCab ? S.cabShell : S.midShell, S.mats.shell);
    shellM.castShadow = true; shellM.receiveShadow = true;
    const glassM = new THREE.Mesh(isCab ? S.cabGlass : S.midGlass, S.mats.glass);
    glassM.renderOrder = 2;
    const intM = new THREE.Mesh(isCab ? S.cabInt : S.midInt, S.mats.interior);
    const extM = new THREE.Mesh(isCab ? S.cabExt : S.midExt, S.mats.ext);
    extM.castShadow = true;
    const ceil = new THREE.Mesh(isCab ? S.cabCeil : S.midCeil, S.mats.ceiling);
    sec.add(shellM, glassM, intM, extM, ceil);
    // ecrane de informare (2 per sectiune, fata-spate)
    const scr = [];
    for (const z of isCab ? [-2.1, 2.6] : [-2.5, 2.5]) {
      for (const rot of [0, Math.PI]) {
        const p = new THREE.PlaneGeometry(1.0, 0.25);
        p.rotateY(rot);
        p.translate(0, 2.85, z + (rot ? 0.01 : -0.01));
        scr.push(p);
      }
    }
    const scrM = new THREE.Mesh(merge(scr, { uv: true, color: false }), scrMat);
    sec.add(scrM);
    if (isCab) {
      const hm = new THREE.Mesh(S.cabLights.head, k === 'A' ? headA : headC);
      const tm = new THREE.Mesh(S.cabLights.tail, k === 'A' ? tailA : tailC);
      sec.add(hm, tm);
      // afisaj destinatie (sus, in spatele parbrizului)
      const d = new THREE.PlaneGeometry(1.5, 0.24);
      d.rotateY(Math.PI);
      d.rotateX(0.5);
      const dm = new THREE.Mesh(d, dstMat);
      dm.position.set(0, 3.0, -4.32);
      dm.rotation.set(0, 0, 0);
      sec.add(dm);
    }
    if (k === 'C') sec.userData.flip = true;
    root.add(sec);
    sections.push(sec);
  }
  // colectorul de incarcare (pantograf mic) pe sectiunea B
  const pant = new THREE.Group();
  const pantMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.6, roughness: 0.4 });
  const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), pantMat); arm1.position.set(0, 0.55, 0.25); arm1.rotation.x = 0.5;
  const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), pantMat); arm2.position.set(0, 0.55, -0.25); arm2.rotation.x = -0.5;
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.25), new THREE.MeshStandardMaterial({ color: 0x8b8f94, metalness: 0.8, roughness: 0.3 }));
  shoe.position.y = 1.1;
  pant.add(arm1, arm2, shoe);
  pant.position.set(0, 3.75, 0);
  pant.scale.y = 0.15;
  sections[1].add(pant);

  // lumina reala (far) – doar pentru noapte, fara umbre
  const spot = new THREE.SpotLight(0xfff1d6, 0, 90, 0.42, 0.6, 1.2);
  spot.position.set(0, 1.2, -5.4);
  spot.target.position.set(0, 0, -40);
  sections[0].add(spot, spot.target);

  ctx.scene.add(root);

  const state = { dir: 1, info: { next: '', kmh: 0, dest: '' }, lastDraw: -1, dest: '' };
  function setDirection(dir) {
    state.dir = dir;
    const aLead = dir > 0;
    headA.color.setHex(aLead ? 0xffffff : 0x222222);
    tailA.color.setHex(aLead ? 0x330000 : 0xff2a2a);
    headC.color.setHex(aLead ? 0x222222 : 0xffffff);
    tailC.color.setHex(aLead ? 0xff2a2a : 0x330000);
    // spotul pe cabina din fata
    (aLead ? sections[0] : sections[2]).add(spot, spot.target);
  }
  function setDestination(text) {
    if (state.dest === text) return;
    state.dest = text;
    drawDest(dstCanvas.getContext('2d'), dstCanvas.width, dstCanvas.height, text);
    dstTex.needsUpdate = true;
  }
  function updateScreen(t, info) {
    if (t - state.lastDraw < 0.5) return;
    state.lastDraw = t;
    drawScreen(scrCanvas.getContext('2d'), scrCanvas.width, scrCanvas.height, info);
    scrTex.needsUpdate = true;
  }
  function setNight(n) {
    spot.intensity = n * 60;
  }
  function setCharging(v) { pant.scale.y = 0.15 + 0.85 * v; }

  setDirection(1);
  return { root, sections, setDirection, setDestination, updateScreen, setNight, setCharging, pant, spot };
}

// iluminarea interiorului pe timp de noapte (materiale comune)
export function setTramNight(n) {
  const S = shared();
  S.mats.interior.emissiveIntensity = n * 0.55;
  S.mats.ceiling.emissiveIntensity = 0.6 + n * 1.6;
  S.mats.glass.emissiveIntensity = n * 0.22;
}
