import * as THREE from 'three';

// Sistemul de persoane (TO-DO 7): siluete low-poly stilizate (cap, trunchi, picioare, brate), totul in InstancedMesh.
// Draw calls: 2 per epoca (corpuri + accesorii: valiza / rucsac / scaun rulant) => 4 in total, oricate persoane.
// Animatia (greutatea mutata de pe un picior pe altul, privitul in jur, telefonul, mersul) se face in vertex shader,
// cu faza proprie fiecarei instante; doar pietonii in miscare isi rescriu matricea (un interval contiguu, fara alocari).
//
// API (ctx.people):
//   addGroup({ points:[{x,y,z,yaw}], kind:'stand'|'sit', era:'future'|'today'|'both', seed, phone, children, luggage, wheelchair })
//       -> { count, setVisible(on), remove() }
//   addWalker({ path:[[x,y,z],...], speed, loop, onEnd, pause, era, seed }) -> { remove(), setVisible(on) }
//   scatter({ polygon:[[x,z]] | rect:{x0,z0,x1,z1}, y | yFn(x,z), count, yaw | target:[x,z], seed, avoid:[{x,z,r}], minDist, inside(x,z) })
//       -> [{x,y,z,yaw}]  (doar puncte; se dau apoi la addGroup)
//   populateStop({ center:[x,z], y | yFn, along:[ux,uz], length, width, toward:[nx,nz], count, seated, avoid, era, seed })
//   populateRouteStops(route, { props, trackHalf, height, era })  – oamenii de la statiile intermediare T1
//   defer(fn) / runDeferred()  – populari dupa constructia transportului (mobilierul T1 de pe peronul 1)

const WALK_MAX = 48; // locuri rezervate pietonilor (la inceputul bufferului => upload partial ieftin)
const ERAS = ['future', 'today'];
// 6 tinute (sus / jos), sRGB
const OUTFITS = [
  [0x2f4b7c, 0x1f2937], [0xb23a48, 0x2b2b2b], [0x3f7d5a, 0x4b5563],
  [0xe0a526, 0x223355], [0xd9d4c7, 0x6b4f3a], [0x5b5f97, 0x8a8f99],
];
const LUGGAGE = [0x334155, 0x7f1d1d, 0x1e3a8a, 0x0f766e, 0x52525b];
// mod: 0 = in picioare (relaxat), 1 = mers, 2 = la telefon, 3 = asezat
const MODE = { stand: 0, walk: 1, phone: 2, sit: 3 };
const PROP = { none: 0, suitcase: 1, backpack: 2, wheelchair: 3 };

export function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- geometrie ----------------
function mergeParts(parts, extra) {
  // parts: [{ g: BufferGeometry (indexata), attrs: {nume: [valori per varf]} }]
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.g.attributes.position.count; ni += p.g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  const ex = {};
  for (const [k, n] of Object.entries(extra)) ex[k] = new Float32Array(nv * n);
  let v0 = 0, i0 = 0;
  for (const p of parts) {
    const g = p.g, c = g.attributes.position.count;
    pos.set(g.attributes.position.array, v0 * 3);
    nor.set(g.attributes.normal.array, v0 * 3);
    for (let i = 0; i < g.index.count; i++) idx[i0 + i] = g.index.array[i] + v0;
    for (const [k, n] of Object.entries(extra)) for (let i = 0; i < c; i++) for (let j = 0; j < n; j++) ex[k][(v0 + i) * n + j] = p.a[k][j];
    v0 += c; i0 += g.index.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  for (const [k, n] of Object.entries(extra)) out.setAttribute(k, new THREE.BufferAttribute(ex[k], n));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// corp in picioare, fata spre +z, talpile la y = 0 (≈ 1,74 m). aRig = (parte, membru, segment)
// parte: 0 piele, 1 bluza, 2 pantaloni, 3 pantofi, 4 par, 5 telefon; membru: 0 trunchi, 1/2 picior st/dr, 3/4 brat st/dr, 5 cap
function bodyGeometry() {
  const P = [];
  const add = (g, part, limb, seg) => P.push({ g, a: { aRig: [part, limb, seg] } });
  for (const [s, L, A] of [[1, 1, 3], [-1, 2, 4]]) {
    const x = 0.1 * s;
    add(bx(0.11, 0.07, 0.25, x, 0.035, 0.035), 3, L, 1);
    add(bx(0.12, 0.42, 0.13, x, 0.28, 0), 2, L, 1);
    add(bx(0.145, 0.46, 0.16, x, 0.7, 0), 2, L, 0);
    const ax = 0.245 * s;
    add(bx(0.095, 0.32, 0.11, ax, 1.3, 0), 1, A, 0);
    add(bx(0.085, 0.28, 0.095, ax, 1.0, 0), 1, A, 1);
    add(bx(0.075, 0.1, 0.08, ax, 0.81, 0), 0, A, 1);
  }
  add(bx(0.07, 0.15, 0.014, -0.245, 0.8, 0.055), 5, 4, 1); // telefonul (doar in modul „telefon”)
  add(bx(0.34, 0.16, 0.2, 0, 0.95, 0), 2, 0, 0);
  add(bx(0.38, 0.5, 0.21, 0, 1.27, 0), 1, 0, 0);
  add(bx(0.08, 0.07, 0.08, 0, 1.54, 0), 0, 5, 0);
  add(new THREE.SphereGeometry(0.105, 8, 6).scale(1, 1.12, 1).translate(0, 1.64, 0), 0, 5, 0);
  add(new THREE.SphereGeometry(0.113, 8, 4, 0, Math.PI * 2, 0, 1.3).translate(0, 1.652, -0.012), 4, 5, 0);
  return mergeParts(P, { aRig: 3 });
}

// accesorii (aProp = id, aCol = culoare liniara, aTint = 1 => se coloreaza cu nuanta instantei)
function propGeometry() {
  const P = [];
  const c = new THREE.Color();
  const add = (g, id, hex, tint = 0) => { c.setHex(hex); P.push({ g, a: { aProp: [id], aCol: [c.r, c.g, c.b, tint] } }); };
  // valiza cu roti, trasa in dreapta (−x)
  add(bx(0.36, 0.52, 0.22, -0.46, 0.31, -0.04), 1, 0xffffff, 1);
  add(bx(0.03, 0.36, 0.03, -0.39, 0.75, -0.04), 1, 0x9ca3af);
  add(bx(0.03, 0.36, 0.03, -0.53, 0.75, -0.04), 1, 0x9ca3af);
  add(bx(0.17, 0.03, 0.04, -0.46, 0.93, -0.04), 1, 0x111827);
  add(bx(0.32, 0.05, 0.05, -0.46, 0.03, -0.04), 1, 0x111827);
  // rucsac
  add(bx(0.3, 0.42, 0.15, 0, 1.24, -0.18), 2, 0xffffff, 1);
  add(bx(0.24, 0.16, 0.05, 0, 1.12, -0.27), 2, 0xcccccc, 1);
  // scaun rulant (persoana asezata, sezut la 0,5 m)
  add(bx(0.46, 0.05, 0.44, 0, 0.47, -0.02), 3, 0x1f2937);
  add(bx(0.44, 0.46, 0.04, 0, 0.75, -0.25), 3, 0x1f2937);
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 14).rotateZ(Math.PI / 2).translate(s * 0.28, 0.3, -0.08), 3, 0x9ca3af);
    add(bx(0.03, 0.03, 0.42, s * 0.24, 0.66, -0.04), 3, 0x6b7280);
    add(bx(0.04, 0.1, 0.1, s * 0.2, 0.05, 0.3), 3, 0x111827);
    add(bx(0.025, 0.4, 0.025, s * 0.2, 0.28, 0.3), 3, 0x6b7280);
  }
  add(bx(0.36, 0.03, 0.15, 0, 0.1, 0.4), 3, 0x374151);
  return mergeParts(P, { aProp: 1, aCol: 4 });
}

// ---------------- shader ----------------
const POSE_GLSL = /* glsl */`
attribute vec3 aRig;
attribute vec4 iData;   // faza, mod, viteza (m/s), vizibil
attribute vec3 iColA;   // bluza
attribute vec3 iColB;   // pantaloni
attribute vec2 iTone;   // piele, par
uniform float uTime;
varying vec3 vPColor;
mat3 pRX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 pRY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
void pPose(in vec3 p, in vec3 n, out vec3 op, out vec3 on) {
  float part = aRig.x, limb = aRig.y, seg = aRig.z, mode = iData.y;
  float tt = uTime + iData.x * 61.0;
  bool leg = limb > 0.5 && limb < 2.5, arm = limb > 2.5 && limb < 4.5, head = limb > 4.5;
  float side = (limb > 0.5 && limb < 1.5) || (limb > 2.5 && limb < 3.5) ? 1.0 : -1.0;
  float th = 0.0, kn = 0.0, ua = 0.0, fa = 0.0, hy = 0.0, hp = 0.0, bob = 0.0, sway = 0.0, down = 0.0;
  if (mode < 0.5 || (mode > 1.5 && mode < 2.5)) {
    // in picioare: greutatea pe un picior, apoi pe celalalt; priveste in jur din cand in cand
    float w = sin(tt * 0.45);
    sway = 0.022 * w;
    if (leg) kn = 0.07 * max(0.0, w * side);
    hy = 0.6 * sin(tt * 0.21) * smoothstep(0.35, 0.95, sin(tt * 0.13 + 1.7));
    ua = 0.05 * sin(tt * 0.5 + side) + 0.03;
    fa = -0.08;
    if (mode > 1.5 && limb > 3.5) { ua = -0.45; fa = -1.85; }
    if (mode > 1.5) { hp = 0.38; hy *= 0.15; }
  } else if (mode < 1.5) {
    // mers: pendularea picioarelor si a bratelor (cadenta legata de viteza)
    float w = tt * 6.2832 * max(0.3, iData.z) / 1.45;
    float s = sin(w) * side;
    th = -0.44 * s;
    kn = 0.75 * max(0.0, cos(w) * side);
    ua = 0.38 * s;
    fa = -0.3 + 0.12 * s;
    bob = 0.03 * abs(cos(w));
    hy = 0.15 * sin(tt * 0.3);
  } else {
    // asezat (banca / scaun rulant)
    th = -1.52; kn = 1.52; ua = -0.25; fa = -1.0; down = 0.39;
    hy = 0.5 * sin(tt * 0.19) * smoothstep(0.4, 0.95, sin(tt * 0.11 + 0.6));
    hp = 0.08;
  }
  mat3 R = mat3(1.0);
  vec3 q = p;
  if (leg) {
    if (seg > 0.5) { mat3 K = pRX(kn); q = K * (q - vec3(0.0, 0.48, 0.0)) + vec3(0.0, 0.48, 0.0); R = K; }
    mat3 T = pRX(th); q = T * (q - vec3(0.0, 0.93, 0.0)) + vec3(0.0, 0.93, 0.0); R = T * R;
  } else if (arm) {
    if (seg > 0.5) { mat3 F = pRX(fa); q = F * (q - vec3(0.0, 1.14, 0.0)) + vec3(0.0, 1.14, 0.0); R = F; }
    mat3 U = pRX(ua); q = U * (q - vec3(0.0, 1.45, 0.0)) + vec3(0.0, 1.45, 0.0); R = U * R;
  } else if (head) {
    mat3 H = pRY(hy) * pRX(hp); q = H * (q - vec3(0.0, 1.53, 0.0)) + vec3(0.0, 1.53, 0.0); R = H;
  }
  if (!leg) q.x += sway;
  q.y += bob - down;
  // telefonul apare doar in modul „telefon”; persoanele ascunse se reduc la un punct (nu se rasterizeaza)
  if ((part > 4.5 && (mode < 1.5 || mode > 2.5)) || iData.w < 0.5) q = vec3(0.0);
  op = q; on = R * n;
  vec3 skin = mix(vec3(0.82, 0.58, 0.45), vec3(0.18, 0.09, 0.05), iTone.x);
  vec3 hair = mix(vec3(0.03, 0.025, 0.02), vec3(0.62, 0.45, 0.22), iTone.y);
  vPColor = part < 0.5 ? skin : part < 1.5 ? iColA : part < 2.5 ? iColB : part < 3.5 ? vec3(0.03) : part < 4.5 ? hair : vec3(0.02, 0.02, 0.025);
}
`;

const PROP_GLSL = /* glsl */`
attribute float aProp;
attribute vec4 aCol;
attribute vec4 iProp; // id, nuanta rgb
varying vec3 vPColor;
`;

function bodyMaterial(uTime) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.name = 'persoane';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + POSE_GLSL)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal; vec3 posedP; pPose(position, normal, posedP, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = posedP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPColor;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vPColor, opacity );');
  };
  m.customProgramCacheKey = () => 'persoane-v1';
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + POSE_GLSL)
      .replace('#include <begin_vertex>', 'vec3 posedP, pN; pPose(position, vec3(0.0, 1.0, 0.0), posedP, pN); vec3 transformed = posedP;');
  };
  d.customProgramCacheKey = () => 'persoane-umbra-v1';
  return { m, d };
}

function propMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.name = 'persoane-accesorii';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + PROP_GLSL)
      .replace('#include <begin_vertex>', 'vec3 transformed = abs(aProp - iProp.x) < 0.5 ? position : vec3(0.0);\nvPColor = mix(aCol.rgb, aCol.rgb * iProp.yzw, aCol.w);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPColor;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vPColor, opacity );');
  };
  m.customProgramCacheKey = () => 'persoane-accesorii-v1';
  return m;
}

// ---------------- un „banc” de instante (o epoca) ----------------
function createBank(name, baseBody, baseProp, mats, propMat, cap, propCap) {
  const g = baseBody.clone();
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const iColA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  const iColB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  const iTone = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
  g.setAttribute('iData', iData); g.setAttribute('iColA', iColA); g.setAttribute('iColB', iColB); g.setAttribute('iTone', iTone);
  const body = new THREE.InstancedMesh(g, mats.m, cap);
  body.customDepthMaterial = mats.d;
  body.name = 'persoane-' + name;
  body.castShadow = true; body.receiveShadow = true;
  body.frustumCulled = false;
  body.count = WALK_MAX;
  const pg = baseProp.clone();
  const iProp = new THREE.InstancedBufferAttribute(new Float32Array(propCap * 4), 4);
  pg.setAttribute('iProp', iProp);
  const props = new THREE.InstancedMesh(pg, propMat, propCap);
  props.name = 'persoane-accesorii-' + name;
  props.castShadow = false; props.receiveShadow = true;
  props.frustumCulled = false;
  props.count = WALK_MAX;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < WALK_MAX; i++) { body.setMatrixAt(i, zero); props.setMatrixAt(i, zero); }
  for (const a of [body.instanceMatrix, props.instanceMatrix, iData, iProp]) a.setUsage(THREE.DynamicDrawUsage);
  return { body, props, iData, iColA, iColB, iTone, iProp, cap, propCap, n: WALK_MAX, np: WALK_MAX, freeWalk: Array.from({ length: WALK_MAX }, (_, i) => WALK_MAX - 1 - i) };
}

export function createPeople(ctx) {
  const uTime = { value: 0 };
  const baseBody = bodyGeometry(), baseProp = propGeometry();
  const mats = bodyMaterial(uTime), propMat = propMaterial();
  const root = new THREE.Group();
  root.name = 'persoane';
  ctx.scene.add(root);
  const banks = {
    future: createBank('viitor', baseBody, baseProp, mats, propMat, 1800, 500),
    today: createBank('azi', baseBody, baseProp, mats, propMat, 700, 200),
  };
  for (const k of ERAS) root.add(banks[k].body, banks[k].props);
  banks.today.body.visible = banks.today.props.visible = false;
  ctx.futureToggles.push((on) => {
    banks.future.body.visible = banks.future.props.visible = !!on;
    banks.today.body.visible = banks.today.props.visible = !on;
  });
  const erasOf = (era) => (era === 'both' ? ERAS : [era === 'today' ? 'today' : 'future']);

  const _c = new THREE.Color();
  const _m = new THREE.Matrix4();
  function writeMatrix(arr, slot, x, y, z, yaw, s) {
    const c = Math.cos(yaw) * s, n = Math.sin(yaw) * s, o = slot * 16;
    arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -n; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = n; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }
  // aspectul unei persoane (tinuta, piele, par, accesoriu) dintr-un generator determinist
  function look(rnd) {
    const o = OUTFITS[Math.floor(rnd() * OUTFITS.length)];
    const j = 0.85 + rnd() * 0.3;
    _c.setHex(o[0]); const a = [_c.r * j, _c.g * j, _c.b * j];
    _c.setHex(o[1]); const b = [_c.r * j, _c.g * j, _c.b * j];
    return { a, b, skin: Math.pow(rnd(), 1.6), hair: rnd() < 0.25 ? 0.6 + rnd() * 0.4 : rnd() * 0.35 };
  }
  function setPerson(B, slot, p, lk, mode, speed, scale) {
    B.iData.setXYZW(slot, p.phase, mode, speed, 1);
    B.iColA.setXYZ(slot, ...lk.a); B.iColB.setXYZ(slot, ...lk.b); B.iTone.setXY(slot, lk.skin, lk.hair);
    writeMatrix(B.body.instanceMatrix.array, slot, p.x, p.y, p.z, p.yaw, scale);
  }
  function setProp(B, slot, p, id, tint, scale) {
    _c.setHex(tint);
    B.iProp.setXYZW(slot, id, _c.r, _c.g, _c.b);
    writeMatrix(B.props.instanceMatrix.array, slot, p.x, p.y, p.z, p.yaw, scale);
  }
  // modificari statice: upload complet la urmatorul cadru (pietonii: doar intervalul lor, vezi ctx.addUpdate)
  const touch = (B) => { B.fullDirty = true; };

  // ---------------- grupuri statice ----------------
  let total = 0;
  function addGroup({ points = [], kind = 'stand', era = 'future', seed = 1, phone = 0.2, children = 0.07, luggage = 0.22, wheelchair = 0 } = {}) {
    const rnd = mulberry(seed * 7919 + points.length);
    const slots = []; // [bank, slot, propSlot, propId]
    let wcLeft = wheelchair;
    // alegem dinainte cine e in scaun rulant (deterministic, raspandit)
    const wcSet = new Set();
    if (kind === 'stand' && wheelchair > 0) for (let k = 0; k < wheelchair && k < points.length; k++) wcSet.add(Math.floor(((k + 0.5) / wheelchair) * points.length));
    points.forEach((p, i) => {
      const lk = look(rnd);
      const phase = rnd();
      let mode = p.mode ?? (kind === 'sit' ? MODE.sit : rnd() < phone ? MODE.phone : MODE.stand);
      let prop = p.prop ?? PROP.none, scale = 1;
      const wc = p.wheelchair || (wcSet.has(i) && wcLeft-- > 0);
      if (wc) { mode = MODE.sit; prop = PROP.wheelchair; }
      else if (kind !== 'sit' && p.child !== false && (p.child || rnd() < children)) { scale = 0.6 + rnd() * 0.08; mode = MODE.stand; }
      else if (kind !== 'sit' && p.prop == null) { const r = rnd(); prop = r < luggage * 0.55 ? PROP.suitcase : r < luggage ? PROP.backpack : PROP.none; }
      else if (p.prop == null) rnd();
      if (kind === 'sit' && prop !== PROP.wheelchair) prop = PROP.none;
      if (scale === 1) scale = 0.94 + rnd() * 0.12;
      const tint = LUGGAGE[Math.floor(rnd() * LUGGAGE.length)];
      for (const e of erasOf(era)) {
        const B = banks[e];
        if (B.n >= B.cap) { console.warn('Persoane: capacitate depasita', e); continue; }
        const slot = B.n++;
        setPerson(B, slot, { ...p, phase }, lk, mode, 0, scale);
        let ps = -1;
        if (prop && B.np < B.propCap) { ps = B.np++; setProp(B, ps, p, prop, tint, prop === PROP.wheelchair ? 1 : scale); }
        slots.push([B, slot, ps, prop]);
        B.body.count = B.n; B.props.count = B.np;
        touch(B);
      }
      total++;
    });
    const handle = {
      count: points.length,
      setVisible(on) {
        const bs = new Set();
        for (const [B, s, ps, id] of slots) { B.iData.setW(s, on ? 1 : 0); if (ps >= 0) B.iProp.setX(ps, on ? id : 0); bs.add(B); }
        for (const B of bs) touch(B);
      },
      remove() { handle.setVisible(false); },
    };
    return handle;
  }

  // ---------------- pietoni ----------------
  const walkers = [];
  function addWalker({ path, speed = 1.3, loop = true, onEnd = null, pause = 0, era = 'future', seed = 1, luggage = 0.25 } = {}) {
    if (!path || path.length < 2) return null;
    const rnd = mulberry(seed * 104729 + path.length);
    const pts = path.map((q) => (Array.isArray(q) ? q : [q.x, q.y, q.z]));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    const L = cum[cum.length - 1];
    const closed = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][2] - pts.at(-1)[2]) < 0.5;
    const lk = look(rnd);
    const r = rnd();
    const prop = r < luggage * 0.6 ? PROP.suitcase : r < luggage ? PROP.backpack : PROP.none;
    const tint = LUGGAGE[Math.floor(rnd() * LUGGAGE.length)];
    const scale = 0.94 + rnd() * 0.12;
    const phase = rnd();
    const w = { era, pts, cum, L, closed, speed, loop, onEnd, pause, s: 0, dir: 1, wait: 0, yaw: Math.atan2(pts[1][0] - pts[0][0], pts[1][2] - pts[0][2]), mode: MODE.walk, seg: 0, slots: [], prop, scale, alive: true, hidden: false };
    for (const e of erasOf(era)) {
      const B = banks[e];
      const slot = B.freeWalk.pop();
      if (slot === undefined) { console.warn('Persoane: prea multi pietoni', e); continue; }
      setPerson(B, slot, { x: pts[0][0], y: pts[0][1], z: pts[0][2], yaw: w.yaw, phase }, lk, MODE.walk, speed, scale);
      if (prop) setProp(B, slot, { x: pts[0][0], y: pts[0][1], z: pts[0][2], yaw: w.yaw }, prop, tint, scale);
      else B.iProp.setX(slot, 0);
      w.slots.push([B, slot]);
      touch(B);
    }
    walkers.push(w);
    const setMode = (m) => { w.mode = m; for (const [B, s] of w.slots) { B.iData.setY(s, m); B.walkDirty = true; } };
    w.setMode = setMode;
    return {
      remove() {
        if (!w.alive) return;
        w.alive = false;
        for (const [B, s] of w.slots) { B.iData.setW(s, 0); B.iProp.setX(s, 0); writeMatrix(B.body.instanceMatrix.array, s, 0, -1000, 0, 0, 0); writeMatrix(B.props.instanceMatrix.array, s, 0, -1000, 0, 0, 0); B.freeWalk.push(s); B.walkDirty = true; }
        const i = walkers.indexOf(w); if (i >= 0) walkers.splice(i, 1);
      },
      setVisible(on) { w.hidden = !on; for (const [B, s] of w.slots) { B.iData.setW(s, on ? 1 : 0); B.walkDirty = true; } },
    };
  }

  function stepWalker(w, dt) {
    if (w.wait > 0) {
      w.wait -= dt;
      if (w.wait <= 0) w.setMode(MODE.walk);
      return;
    }
    if (w.mode !== MODE.walk && w.done) return;
    w.s += w.speed * dt * w.dir;
    if (w.s >= w.L || w.s <= 0) {
      if (!w.loop) {
        w.s = Math.max(0, Math.min(w.L, w.s)); w.done = true; w.setMode(MODE.stand);
        if (w.onEnd) { const f = w.onEnd; w.onEnd = null; f(); }
      } else if (w.closed) { w.s = ((w.s % w.L) + w.L) % w.L; w.seg = 0; }
      else {
        w.s = Math.max(0, Math.min(w.L, w.s)); w.dir = -w.dir;
        if (w.pause > 0) { w.wait = w.pause * (0.6 + 0.8 * ((w.L * 13.7) % 1)); w.setMode(MODE.stand); }
      }
    }
    // segmentul curent (cautare locala de la ultimul segment)
    const c = w.cum;
    let i = Math.min(w.seg, c.length - 2);
    while (i < c.length - 2 && w.s > c[i + 1]) i++;
    while (i > 0 && w.s < c[i]) i--;
    w.seg = i;
    const a = w.pts[i], b = w.pts[i + 1];
    const t = (w.s - c[i]) / ((c[i + 1] - c[i]) || 1);
    w.x = a[0] + (b[0] - a[0]) * t; w.y = a[1] + (b[1] - a[1]) * t; w.z = a[2] + (b[2] - a[2]) * t;
    const ty = Math.atan2((b[0] - a[0]) * w.dir, (b[2] - a[2]) * w.dir);
    let d = ty - w.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    w.yaw += d * Math.min(1, dt * 5);
    for (const [B, s] of w.slots) {
      writeMatrix(B.body.instanceMatrix.array, s, w.x, w.y, w.z, w.yaw, w.scale);
      if (w.prop) writeMatrix(B.props.instanceMatrix.array, s, w.x, w.y, w.z, w.yaw, w.scale);
      B.walkMoved = true;
    }
  }

  ctx.addUpdate((dt, t) => {
    uTime.value = t;
    const h = Math.min(dt, 0.1);
    for (let i = 0; i < walkers.length; i++) stepWalker(walkers[i], h);
    for (const k of ERAS) {
      const B = banks[k];
      if (B.fullDirty) {
        for (const a of [B.iData, B.iColA, B.iColB, B.iTone, B.iProp, B.body.instanceMatrix, B.props.instanceMatrix]) { a.clearUpdateRanges(); a.needsUpdate = true; }
        B.fullDirty = B.walkMoved = B.walkDirty = false;
        continue;
      }
      if (B.walkMoved || B.walkDirty) {
        for (const a of [B.body.instanceMatrix, B.props.instanceMatrix]) { a.clearUpdateRanges(); a.addUpdateRange(0, WALK_MAX * 16); a.needsUpdate = true; }
      }
      if (B.walkDirty) for (const a of [B.iData, B.iProp]) { a.clearUpdateRanges(); a.addUpdateRange(0, WALK_MAX * 4); a.needsUpdate = true; }
      B.walkMoved = B.walkDirty = false;
    }
  });

  // ---------------- imprastiere ----------------
  function scatter({ polygon = null, rect = null, y = 0, yFn = null, count = 10, yaw = 0, target = null, seed = 1, avoid = [], minDist = 0.75, jitterYaw = 0.35, inside = null, weight = null, tries = 40 } = {}) {
    const rnd = mulberry(seed * 2654435761);
    let poly = polygon;
    if (!poly && rect) poly = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1]];
    if (!poly || poly.length < 3) return [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const out = [];
    const md2 = minDist * minDist;
    for (let k = 0; k < count * tries && out.length < count; k++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (!pip(x, z, poly)) continue;
      if (weight && rnd() > weight(x, z)) continue;
      let ok = true;
      for (const o of avoid) { const dx = x - o.x, dz = z - o.z; if (dx * dx + dz * dz < o.r * o.r) { ok = false; break; } }
      if (!ok) continue;
      for (const q of out) { const dx = x - q.x, dz = z - q.z; if (dx * dx + dz * dz < md2) { ok = false; break; } }
      if (!ok || (inside && !inside(x, z))) continue;
      const tx = Array.isArray(target) ? target[0] : target?.x, tz = Array.isArray(target) ? target[1] : target?.z;
      const base = target ? Math.atan2(tx - x, tz - z) : (typeof yaw === 'function' ? yaw(x, z) : yaw);
      out.push({ x, y: yFn ? yFn(x, z) : y, z, yaw: base + (rnd() - 0.5) * 2 * jitterYaw });
    }
    return out;
  }

  // ---------------- statii T1 ----------------
  // rect: center [x,z], along [ux,uz] (unitar, in lungul peronului), toward [nx,nz] (unitar, spre linie),
  // length, width, y sau yFn(x,z). Oamenii stau in jumatatea dinspre linie (in spatele benzii tactile), cu fata spre linie.
  function populateStop({ center, y = 0, yFn = null, along, length = 40, width = 3, toward, count = 7, seated = 0, seats = [], avoid = [], era = 'future', seed = 1, edgeGap = 1.0, clearAlong = 0 } = {}) {
    const [cx, cz] = Array.isArray(center) ? center : [center.x, center.z];
    const [ux, uz] = along, [nx, nz] = toward;
    const halfL = length / 2 - 2, edge = width / 2 - edgeGap, back = Math.max(edge - 1.3, -width / 2 + 0.5);
    const poly = [[-halfL, back], [halfL, back], [halfL, edge], [-halfL, edge]].map(([a, b]) => [cx + ux * a + nx * b, cz + uz * a + nz * b]);
    const faceYaw = Math.atan2(nx, nz);
    // clearAlong: fara oameni in dreptul adapostului (|in lungul peronului| < clearAlong)
    const inside = clearAlong > 0 ? (x, z) => Math.abs((x - cx) * ux + (z - cz) * uz) > clearAlong : null;
    const pts = scatter({ polygon: poly, y, yFn, count, yaw: faceYaw, seed, avoid, jitterYaw: 0.5, minDist: 0.8, inside });
    // cativa se uita in lungul peronului, dupa tramvai
    const alongYaw = Math.atan2(ux, uz);
    pts.forEach((p, i) => { if (i % 4 === 1) p.yaw = alongYaw + (i % 8 === 1 ? 0 : Math.PI) + 0.25; });
    const hs = [addGroup({ points: pts, kind: 'stand', era, seed, children: 0.08, luggage: 0.3, wheelchair: count >= 8 ? 1 : 0 })];
    const sp = seats.slice(0, seated);
    if (sp.length) hs.push(addGroup({ points: sp, kind: 'sit', era, seed: seed + 1 }));
    return { count: pts.length + sp.length, setVisible(on) { hs.forEach((h) => h.setVisible(on)); }, remove() { hs.forEach((h) => h.remove()); } };
  }

  // statiile intermediare ale unui traseu T1 (route din src/transit/route.js; props = amprentele mobilierului din stops.js)
  function populateRouteStops(route, { props = [], trackHalf = 1.7, height = 0.42, era = 'future', perSide = [3, 7] } = {}) {
    if (!route?.stops) return [];
    const p = new THREE.Vector3(), tg = new THREE.Vector3();
    const out = [];
    route.stops.forEach((st, si) => {
      if (st.term) return;
      route.tangent(st.s, tg); tg.y = 0; tg.normalize();
      const right = [-tg.z, tg.x];
      const avoid = props.filter((q) => q.stop === st.id).map((q) => ({ x: q.x, z: q.z, r: q.r + 0.45 }));
      for (const side of [-1, 1]) {
        const inner = trackHalf + 1.45, outer = trackHalf + 4.45, mid = (inner + outer) / 2;
        route.offsetPoint(st.s, side * mid, p);
        const c = [p.x, p.z];
        const yFn = (x, z) => {
          const ds = (x - c[0]) * tg.x + (z - c[1]) * tg.z;
          return route.pos(st.s + ds, p).y + height;
        };
        const rnd = mulberry(si * 31 + side + 5);
        const n = perSide[0] + Math.floor(rnd() * (perSide[1] - perSide[0] + 1));
        out.push(populateStop({ center: c, yFn, along: [tg.x, tg.z], length: 40, width: outer - inner, toward: [-side * right[0], -side * right[1]], count: n, avoid, era, seed: si * 17 + (side > 0 ? 3 : 7), clearAlong: 5.4 }));
      }
    });
    return out;
  }

  // populari care depind de module construite mai tarziu (ex.: mobilierul statiei T1 din gara) – main.js apeleaza runDeferred()
  const deferred = [];
  const defer = (fn) => { deferred.push(fn); };
  const runDeferred = () => { while (deferred.length) { const f = deferred.shift(); try { f(); } catch (e) { console.error('Persoane', e); } } };

  const api = { addGroup, defer, runDeferred, addWalker, scatter, populateStop, populateRouteStops, banks, paths: () => walkers.map((w) => ({ era: w.era, pts: w.pts })), get total() { return total; }, get walkers() { return walkers.length; }, MODE, PROP };
  return api;
}

function pip(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
