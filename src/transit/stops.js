import * as THREE from 'three';
import { merge, box, cyl, tint, sweepProfile, sweepStrip, makeCanvas, canvasTex, roundRect } from './util3d.js';
import { TRACK_HALF } from './route.js';
import { DWELL, TERM_DWELL } from './fleet.js';

// Statiile T1: peroane joase (acces la nivel cu podeaua tramvaiului), benzi tactile, adaposturi cu
// acoperis fotovoltaic, afisaj cu urmatorul tramvai (timp real), banca, validator, cosuri selective.

export function pvTexture() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#c9d2dc'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const gr = g.createLinearGradient(x * 64, y * 64, x * 64 + 64, y * 64 + 64);
    gr.addColorStop(0, '#1b2f5a'); gr.addColorStop(1, '#0d1a36');
    g.fillStyle = gr; g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    g.strokeStyle = 'rgba(160,190,230,.35)'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x * 64 + 2 + k * 15, y * 64 + 2); g.lineTo(x * 64 + 2 + k * 15, y * 64 + 62); g.stroke(); }
  }
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildStops(ctx, route, fleet, shared) {
  const group = new THREE.Group();
  group.name = 't1-statii';
  const stops = route.stops;
  const plat = [], tactile = [], steel = [], wood = [], pv = [], glass = [], glow = [], bins = [];
  const walk = [], coll = []; // modul plimbare: peroane (walkables) + obstacole (colliders), invizibile
  const displays = [];
  // amprentele mobilierului (pentru verificari: nimic in apa / pe carosabil / in cladiri) – {stop, kind, x, y, z, r}
  const props = [];
  const tg = new THREE.Vector3(), p = new THREE.Vector3(), _sp = new THREE.Vector3();

  const platProfile = (a, b, h) => [[a, -0.9], [a, h], [b, h], [b, -0.9]];
  const H = 0.42; // inaltimea peronului peste gazon (podeaua tramvaiului ~0,49)

  stops.forEach((st, si) => {
    const term = !!st.term;
    if (term) {
      // portal de incarcare: stalpi + grinda + sina de incarcare scurta (doar deasupra opririi)
      route.tangent(st.s, tg); tg.y = 0; tg.normalize();
      const rr = new THREE.Vector3(-tg.z, 0, tg.x);
      const c0 = route.pos(st.s, new THREE.Vector3());
      const Mc = new THREE.Matrix4().makeBasis(rr, new THREE.Vector3(0, 1, 0), rr.clone().cross(new THREE.Vector3(0, 1, 0))).setPosition(c0.x, c0.y, c0.z);
      // stalpii stau pe peroane (± 4,9 m), nu pe carosabilul strazii de langa terminal
      for (const dz of [-8, 8]) {
        for (const sx of [-1, 1]) {
          steel.push(box(0.3, 7.4, 0.3, sx * 4.9, 2.5, dz, 0x475569).applyMatrix4(Mc)); // fundatie in peron
          coll.push(box(0.45, 7.4, 0.45, sx * 4.9, 2.5, dz).applyMatrix4(Mc));
        }
        steel.push(box(10.2, 0.35, 0.35, 0, 6.05, dz, 0x475569).applyMatrix4(Mc));
        steel.push(box(0.12, 1.05, 0.12, 0, 5.4, dz, 0x475569).applyMatrix4(Mc));
      }
      steel.push(box(0.5, 0.12, 18, 0, 4.86, 0, 0xb87333).applyMatrix4(Mc)); // sina de incarcare (cupru)
      for (const dz of [-8, 8]) for (const sx of [-1, 1]) { const q = new THREE.Vector3(sx * 4.9, H, dz).applyMatrix4(Mc); props.push({ stop: st.id, kind: 'stalp-portal', x: q.x, y: q.y, z: q.z, r: 0.2 }); }
      glow.push(box(0.2, 0.05, 17.6, 0, 4.78, 0, 0x22d3ee).applyMatrix4(Mc));
    }
    const half = term ? 23 : 21;
    const s0 = st.s - half, s1 = st.s + half;
    const ranges = term ? [[1.45, 5.2], [-5.2, -1.45]] : [[TRACK_HALF + 1.45, TRACK_HALF + 4.45], [-(TRACK_HALF + 4.45), -(TRACK_HALF + 1.45)]];
    const smp = route.samples(s0, s1, 2);
    for (const [a, b] of ranges) {
      plat.push(sweepProfile(smp, platProfile(a, b, H), { color: 0xb9bdc2 }));
      const inner = Math.abs(a) < Math.abs(b) ? a : b;
      const sg = Math.sign(a);
      const t0 = inner + sg * 0.25, t1 = inner + sg * 0.85;
      tactile.push(sweepStrip(smp, Math.min(t0, t1), Math.max(t0, t1), H + 0.012, { color: 0xf5c518 }));
      // margine alba de siguranta
      tactile.push(sweepStrip(smp, Math.min(inner, inner + sg * 0.12), Math.max(inner, inner + sg * 0.12), H + 0.012, { color: 0xffffff }));

      // ----- adapost (sistem local: x spre exterior, z in lungul liniei, y = sus de la peron) -----
      const side = sg;
      const latStart = Math.abs(inner);
      const width = Math.abs(b - a);
      route.tangent(st.s, tg);
      tg.y = 0; tg.normalize();
      const r = new THREE.Vector3(-tg.z, 0, tg.x);
      const X = r.clone().multiplyScalar(side), Y = new THREE.Vector3(0, 1, 0), Z = tg.clone().multiplyScalar(-side);
      route.offsetPoint(st.s, side * latStart, p);
      const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p.x, p.y + H, p.z);
      const add = (arr, g) => { g.applyMatrix4(M); arr.push(g); };
      const spot = (kind, lx, lz, r) => { _sp.set(lx, 0, lz).applyMatrix4(M); props.push({ stop: st.id, kind, x: _sp.x, y: _sp.y, z: _sp.z, r }); };
      const W = width;
      spot('adapost', W / 2, -4.2, 0.5); spot('adapost', W / 2, 0, 0.5); spot('adapost', W / 2, 4.2, 0.5);
      spot('adapost', W - 0.35, -4.2, 0.2); spot('adapost', W - 0.35, 4.2, 0.2);
      spot('banca', W - 0.85, -2.6, 0.3); spot('banca', W - 0.85, 0.2, 0.3);
      spot('validator', 1.35, -3.7, 0.2); spot('afisaj', 1.25, 3.7, 0.8);
      for (let k = 0; k < 4; k++) spot('cos', W - 0.45, -4.9 - k * 0.5, 0.22);
      for (const z of [-4.2, 0, 4.2]) add(steel, box(0.14, 2.75, 0.14, W - 0.35, 1.375, z, 0x5b6470));
      add(steel, box(W - 0.15, 0.12, 9.4, W / 2 - 0.05, 2.78, 0, 0x5b6470));
      add(glow, box(0.25, 0.04, 8.6, W / 2, 2.7, 0, 0xfff1d0)); // banda LED sub acoperis
      const pvg = new THREE.PlaneGeometry(W + 0.2, 9.6);
      pvg.rotateX(-Math.PI / 2); pvg.rotateZ(-0.07);
      pvg.translate(W / 2, 2.9, 0);
      add(pv, pvg);
      const gw = new THREE.PlaneGeometry(8.4, 2.3); gw.rotateY(Math.PI / 2); gw.translate(W - 0.3, 1.25, 0);
      add(glass, gw);
      add(wood, box(0.45, 0.07, 3.2, W - 0.85, 0.47, -1.2, 0xb07a45));
      add(wood, box(0.06, 0.45, 3.2, W - 0.6, 0.72, -1.2, 0xb07a45));
      add(steel, box(0.3, 0.45, 0.08, W - 0.85, 0.22, -2.6, 0x5b6470));
      add(steel, box(0.3, 0.45, 0.08, W - 0.85, 0.22, 0.2, 0x5b6470));
      // validator
      add(steel, box(0.12, 1.1, 0.12, 1.35, 0.55, -3.7, 0x374151));
      add(steel, box(0.3, 0.4, 0.22, 1.35, 1.25, -3.7, 0x1f2937));
      add(glow, box(0.2, 0.14, 0.01, 1.35, 1.3, -3.81, 0x22c55e));
      // cosuri pentru colectare selectiva (hartie / plastic+metal / sticla / rezidual)
      [0x2563eb, 0xfacc15, 0x16a34a, 0x6b7280].forEach((c, k) => add(bins, cyl(0.22, 0.2, 0.85, 10, W - 0.45, 0.43, -4.9 - k * 0.5, c)));
      // stalp + afisaj
      add(steel, box(0.12, 2.3, 0.12, 1.25, 1.15, 3.7, 0x374151));
      const disp = new THREE.PlaneGeometry(1.5, 0.82);
      const dispB = disp.clone();
      disp.translate(0, 2.35, 0); dispB.rotateY(Math.PI); dispB.translate(0, 2.35, 0);
      const dm = new THREE.Matrix4().makeTranslation(1.25, 0, 3.7 + 0.065);
      const dmB = new THREE.Matrix4().makeTranslation(1.25, 0, 3.7 - 0.065);
      disp.applyMatrix4(dm); dispB.applyMatrix4(dmB);
      add(steel, box(1.6, 0.92, 0.12, 1.25, 2.35, 3.7, 0x111827));
      // plimbare: peronul (suprafata invizibila) + coliziuni pentru adapost / banca / validator / afisaj / cosuri
      walk.push(sweepStrip(smp, Math.min(a, b), Math.max(a, b), H));
      add(coll, box(0.95, 2.4, 8.7, W - 0.64, 1.2, 0));
      add(coll, box(0.35, 1.5, 0.3, 1.35, 0.75, -3.7));
      add(coll, box(0.25, 2.0, 0.25, 1.25, 1.0, 3.7));
      add(coll, box(0.5, 0.9, 2.1, W - 0.45, 0.45, -5.65));
      if (!displays[si]) displays[si] = { geos: [], st };
      displays[si].geos.push(disp.applyMatrix4(M), dispB.applyMatrix4(M));
    }
  });

  const addMesh = (geos, mat, name, opts) => {
    const g = merge(geos, opts);
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const platMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  addMesh(plat, platMat, 't1-peroane');
  addMesh(tactile, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 't1-benzi-tactile');
  const st = addMesh(steel, shared.steelPaint, 't1-adaposturi');
  st.castShadow = true;
  addMesh(wood, platMat, 't1-banci');
  addMesh(bins, platMat, 't1-cosuri');
  addMesh(pv, shared.pvMat, 't1-pv', { uv: true, color: false }).castShadow = true;
  addMesh(glass, shared.glassMat, 't1-sticla', { color: false });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  addMesh(glow, glowMat, 't1-validatoare');
  // plimbare: mesh-uri vizibile (visible = true) cu material invizibil => raycast-ul le gaseste
  const wk = addMesh(walk, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }), 't1-peroane-plimbare', { color: false });
  if (wk) ctx.walkables.push(wk);
  const cl = addMesh(coll, new THREE.MeshBasicMaterial({ visible: false }), 't1-coliziuni', { color: false });
  if (cl) ctx.colliders.push(cl);

  // ----- afisaje dinamice -----
  const dispList = [];
  for (const d of displays) {
    if (!d) continue;
    const c = makeCanvas(384, 208);
    const tex = canvasTex(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.FrontSide });
    const m = new THREE.Mesh(merge(d.geos, { uv: true, color: false }), mat);
    m.name = 't1-afisaj-' + d.st.id;
    group.add(m);
    dispList.push({ st: d.st, c, tex, idx: stops.indexOf(d.st) });
  }

  // timp pana la sosirea urmatorului tramvai in statia k, plecand in sensul d
  function eta(v, k, d) {
    const N = stops.length;
    let T = 0, s = v.s, dir = v.dir, target = v.target;
    if (v.mode === 'dwell') {
      const cur = target - dir;
      if (cur === k && dir === d) return 0;
      T += Math.max(0, v.timer);
    }
    for (let it = 0; it < 2 * N + 2; it++) {
      T += fleet.runTime(s, stops[target].s);
      s = stops[target].s;
      const last = target === N - 1 || target === 0;
      if (last) dir = -dir;
      if (target === k && dir === d) return T;
      T += last ? TERM_DWELL : DWELL;
      target += dir;
    }
    return Infinity;
  }
  const fmt = (T) => (T < 25 ? 'în stație' : T < 60 ? '< 1 min' : `${Math.round(T / 60)} min`);
  function draw(dsp) {
    const g = dsp.c.getContext('2d'), W = dsp.c.width, Hh = dsp.c.height;
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#f97316'; g.fillRect(0, 0, W, 54);
    g.fillStyle = '#fff'; g.font = 'bold 30px Segoe UI, Arial'; g.textBaseline = 'middle';
    g.fillText('T1', 12, 28);
    g.font = 'bold 24px Segoe UI, Arial';
    g.fillText(dsp.st.name, 62, 28, W - 74);
    const k = dsp.idx, N = stops.length;
    const rows = [];
    if (k < N - 1) rows.push(['Hub Turbion A7×A8', 1]);
    if (k > 0) rows.push(['Gara Pașcani', -1]);
    rows.forEach(([name, d], i) => {
      let best = Infinity;
      for (const v of fleet.vehicles) best = Math.min(best, eta(v, k, d));
      const y = 86 + i * 50;
      g.fillStyle = '#93a4ba'; g.font = '20px Segoe UI, Arial';
      g.fillText('→ ' + name, 12, y, 230);
      g.fillStyle = best < 60 ? '#4ade80' : '#facc15'; g.font = 'bold 28px Segoe UI, Arial';
      g.textAlign = 'right'; g.fillText(fmt(best), W - 12, y); g.textAlign = 'left';
    });
    g.fillStyle = '#64748b'; g.font = '16px Segoe UI, Arial';
    g.fillText(dsp.st.term ? '⚡ încărcare baterii la capăt de linie' : '♿ acces la nivel · ✈ legătură aeroporturi', 12, Hh - 16, W - 24);
    dsp.tex.needsUpdate = true;
  }
  let acc = 0, rr = 0;
  ctx.addUpdate((dt) => {
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    // un afisaj pe rand (cost mic pe cadru)
    draw(dispList[rr % dispList.length]);
    rr++;
  });
  dispList.forEach(draw);

  ctx.scene.add(group);
  return { group, eta, props };
}
