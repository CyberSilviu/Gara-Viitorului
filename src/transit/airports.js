import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { merge, box, tint, makeCanvas, canvasTex, roundRect, drawPlane, sweepStrip } from './util3d.js';

// Marcarea liniilor spre aeroporturi:
//  (a) portaluri cu indicatoare de autostrada (albastre) inainte de nod, cu pictograma avion, directie si distanta;
//  (b) panglici luminoase pe benzile A7 / A8 spre fiecare aeroport + arce 3D pe cer, din hub spre directia reala;
//  (c) linii pe harta mica + traseul T1.

const SIGN_BLUE = '#1f4fa3';

function drawShield(g, x, y, text, h = 52) {
  g.fillStyle = '#d0021b'; roundRect(g, x, y, h * 1.5, h, 8); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 3; roundRect(g, x + 4, y + 4, h * 1.5 - 8, h - 8, 6); g.stroke();
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(h * 0.62)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x + h * 0.75, y + h / 2 + 1); g.textAlign = 'left';
}

function arrow(g, x, y, s, angle) {
  g.save(); g.translate(x, y); g.rotate(angle); g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.7, -s * 0.2); g.lineTo(s * 0.25, -s * 0.2); g.lineTo(s * 0.25, s);
  g.lineTo(-s * 0.25, s); g.lineTo(-s * 0.25, -s * 0.2); g.lineTo(-s * 0.7, -s * 0.2); g.closePath(); g.fill(); g.restore();
}

// panou: { shield:'A8', arrowAngle, lines:[[text, color?]], airport:{code, km, color} }
function signTexture(panel) {
  const c = makeCanvas(640, 330), g = c.getContext('2d');
  g.fillStyle = SIGN_BLUE; roundRect(g, 0, 0, 640, 330, 22); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 8; roundRect(g, 10, 10, 620, 310, 16); g.stroke();
  drawShield(g, 30, 30, panel.shield);
  arrow(g, 590, 68, 34, panel.arrowAngle);
  g.fillStyle = '#fff'; g.font = 'bold 50px Arial'; g.textBaseline = 'middle';
  g.fillText(panel.city, 120, 58, 420);
  // linia aeroportului: pictograma + cod + km (fond in culoarea liniei)
  const a = panel.airport;
  g.fillStyle = a.color; roundRect(g, 30, 118, 580, 92, 14); g.fill();
  drawPlane(g, 82, 164, 64, '#0b1220', -Math.PI / 4);
  g.fillStyle = '#0b1220'; g.font = 'bold 44px Arial';
  g.fillText(`Aeroport ${a.code}`, 128, 166, 300);
  g.textAlign = 'right'; g.fillText(`${a.km} km`, 594, 166); g.textAlign = 'left';
  g.fillStyle = '#fff'; g.font = '34px Arial';
  g.fillText(panel.sub, 32, 262, 580);
  return canvasTex(c);
}

export function buildAirports(ctx, motorway, hub, route) {
  const group = new THREE.Group();
  group.name = 'linii-aeroporturi';
  const AIR = ctx.geo.AIRPORTS;
  const byCode = Object.fromEntries(AIR.map((a) => [a.code, a]));
  const node = motorway ? motorway.nodeXZ : ctx.geo.project(47.21388, 26.70568);
  const hubC = hub.center;
  const toggles = [];

  // ---------------- (a) portaluri cu indicatoare ----------------
  const gantryParts = [];
  const signs = [];
  if (motorway) {
    const quads = {};
    for (const w of motorway.ways) {
      if (w.type !== 'mw' || !/A[78]/.test(w.ref)) continue;
      for (let i = 1; i < w.smp.length - 1; i++) {
        const p = w.smp[i];
        const d = Math.hypot(p.x - node.x, p.z - node.z);
        if (Math.abs(d - 1050) > 260) continue;
        const tx = p.rz, tz = -p.rx; // tangenta (r = (-tz, tx))
        const inx = (node.x - p.x) / d, inz = (node.z - p.z) / d;
        if (tx * inx + tz * inz < 0.5) continue; // circulatia merge spre nod
        if (p.deck) continue; // nu pe tablierul unui pod
        const ang = Math.atan2(p.x - node.x, -(p.z - node.z)) * 180 / Math.PI; // azimut fata de nod
        const q = w.ref.includes('A7') ? (Math.abs(ang) < 90 ? 'A7N' : 'A7S') : (ang < 0 ? 'A8W' : 'A8E');
        // cat mai aproape de 1 km inainte de nod, de preferat pe sol (nu pe rampa unui pasaj)
        const err = Math.abs(d - 1050) + 30 * Math.max(0, p.lift - 0.5);
        if (!quads[q] || err < quads[q].err) quads[q] = { w, p, err };
      }
    }
    const IAS = byCode.IAS, SCV = byCode.SCV, BCM = byCode.BCM;
    const ap = (a) => ({ code: a.code, km: a.km, color: a.color });
    const SETS = {
      // venind dinspre nord pe A7 (spre sud)
      A7N: [{ shield: 'A7', city: 'Bacău', arrowAngle: 0, airport: ap(BCM), sub: 'înainte · A7 Sud' },
        { shield: 'A8', city: 'Iași', arrowAngle: Math.PI / 4, airport: ap(IAS), sub: 'ieșire 1,5 km · Hub Turbion T1' }],
      A7S: [{ shield: 'A7', city: 'Suceava', arrowAngle: 0, airport: ap(SCV), sub: 'înainte · A7 Nord' },
        { shield: 'A8', city: 'Iași', arrowAngle: Math.PI / 4, airport: ap(IAS), sub: 'ieșire 1,5 km · Hub Turbion T1' }],
      A8W: [{ shield: 'A8', city: 'Iași', arrowAngle: 0, airport: ap(IAS), sub: 'înainte · A8 Est' },
        { shield: 'A7', city: 'Suceava', arrowAngle: -Math.PI / 4, airport: ap(SCV), sub: 'A7 Nord · Bacău ✈ BCM 91 km' }],
      A8E: [{ shield: 'A7', city: 'Suceava', arrowAngle: -Math.PI / 4, airport: ap(SCV), sub: 'A7 Nord · Hub Turbion T1' },
        { shield: 'A7', city: 'Bacău', arrowAngle: Math.PI / 4, airport: ap(BCM), sub: 'A7 Sud · ieșire 1,5 km' }],
    };
    for (const [q, { w, p }] of Object.entries(quads)) {
      const hw = w.width / 2;
      const r = new THREE.Vector3(p.rx, 0, p.rz), t = new THREE.Vector3(p.rz, 0, -p.rx);
      const base = new THREE.Vector3(p.x, p.y, p.z);
      // stalpi + grinda cu zabrele (simplificat)
      const M = new THREE.Matrix4().makeBasis(r, new THREE.Vector3(0, 1, 0), r.clone().cross(new THREE.Vector3(0, 1, 0))).setPosition(base); // Z = -t (sistem drept)
      const parts = [];
      for (const s of [-1, 1]) parts.push(box(0.5, 8.4, 0.5, s * (hw + 1.6), 4.2, 0, 0x9aa3ab));
      parts.push(box(2 * hw + 3.6, 0.35, 0.35, 0, 7.6, 0.3, 0x9aa3ab));
      parts.push(box(2 * hw + 3.6, 0.35, 0.35, 0, 8.4, 0.3, 0x9aa3ab));
      for (const pp of parts) gantryParts.push(pp.applyMatrix4(M));
      (SETS[q] || []).forEach((panel, k) => {
        const tex = signTexture(panel);
        const pg = new THREE.PlaneGeometry(6.6, 3.4);
        // panoul priveste spre soferii care vin (opus directiei de mers)
        const mesh = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }));
        const lat = k === 0 ? -hw * 0.45 : hw * 0.55;
        mesh.position.copy(base).addScaledVector(r, lat).add(new THREE.Vector3(0, 8.0, 0)).addScaledVector(t, -0.65);
        mesh.lookAt(mesh.position.clone().addScaledVector(t, -10));
        group.add(mesh);
        signs.push(mesh);
      });
    }
  }
  if (gantryParts.length) {
    const gm = new THREE.Mesh(merge(gantryParts), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.4 }));
    gm.name = 'portaluri-indicatoare'; gm.castShadow = true;
    group.add(gm);
  }

  // ---------------- (b1) panglici luminoase pe benzi ----------------
  const flowTex = (() => {
    const c = makeCanvas(32, 128), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.9, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(4, 0, 24, 128);
    const t = canvasTex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const ribbons = [];
  function chain(ref, heading) {
    if (!motorway) return [];
    let best = null, bd = Infinity;
    for (const w of motorway.mwWays) {
      if (w.type !== 'mw' || !w.ref.includes(ref)) continue;
      const p = w.smp[0], q = w.smp[Math.min(w.smp.length - 1, 6)];
      const d = Math.hypot(p.x - node.x, p.z - node.z);
      const hx = q.x - p.x, hz = q.z - p.z, hl = Math.hypot(hx, hz) || 1;
      if ((hx * heading[0] + hz * heading[1]) / hl < 0.6) continue;
      if (d < bd) { bd = d; best = w; }
    }
    const out = [];
    let w = best, total = 0;
    const seenW = new Set();
    while (w && total < 4200 && !seenW.has(w)) {
      seenW.add(w); out.push(w); total += w.len;
      const nx = (motorway.succ.get(w) || []).filter((o) => o.type === 'mw' && o.ref.includes(ref));
      w = nx[0];
    }
    return out;
  }
  const routesDef = [
    { code: 'IAS', ref: 'A8', heading: [1, 0] },
    { code: 'SCV', ref: 'A7', heading: [-0.3, -1] },
    { code: 'BCM', ref: 'A7', heading: [0.5, 1] },
  ];
  for (const rd of routesDef) {
    const a = byCode[rd.code];
    const ws = chain(rd.ref, rd.heading.map((v) => v / Math.hypot(...rd.heading)));
    if (!ws.length) continue;
    const geos = ws.map((w) => sweepStrip(w.smp.map((p) => ({ ...p, y: p.y + 0.09 })), -0.05, 1.95, 0, { uvScale: 1 / 60 })); // banda din dreapta (a autocarelor), calea de 10 m
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(a.color), map: flowTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    const m = new THREE.Mesh(merge(geos, { uv: true, color: false }), mat);
    m.name = 'panglica-' + rd.code;
    m.renderOrder = 3;
    group.add(m);
    ribbons.push({ m, mat });
  }

  // ---------------- (b2) arce pe cer din hub spre aeroporturi ----------------
  const arcs = [];
  const start = hubC.clone().setY(hub.roofY + 4);
  const pulseGeo = new THREE.SphereGeometry(5, 12, 8);
  for (const a of AIR) {
    const p = ctx.geo.project(a.lat, a.lon);
    const dir = new THREE.Vector3(p.x - hubC.x, 0, p.z - hubC.z).normalize();
    const end = start.clone().addScaledVector(dir, 9000).setY(start.y + 120);
    const mid = start.clone().lerp(end, 0.5).setY(start.y + 1500);
    const curve = new THREE.QuadraticBezierCurve3(start.clone(), mid, end);
    const col = new THREE.Color(a.color);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 4, 8, false), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 1.2, 6, false), new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.5), toneMapped: false, fog: false }));
    tube.name = core.name = 'arc-' + a.code;
    group.add(tube, core);
    const pulses = [];
    for (let k = 0; k < 3; k++) {
      const pm = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.7), toneMapped: false, fog: false }));
      group.add(pm); pulses.push(pm);
    }
    // eticheta CSS2D
    const el = document.createElement('div');
    el.textContent = `✈ ${a.name.includes('Iași') ? 'Iași' : a.name.includes('Suceava') ? 'Suceava' : 'Bacău'} ${a.code} · ${a.km} km`;
    el.style.cssText = `padding:6px 12px;border-radius:999px;background:rgba(11,18,32,.82);border:2px solid ${a.color};color:#fff;font:600 14px Segoe UI,Arial,sans-serif;white-space:nowrap;box-shadow:0 0 18px ${a.color}88;pointer-events:none`;
    const label = new CSS2DObject(el);
    label.position.copy(curve.getPoint(0.42));
    label.center.set(0.5, 1.2);
    group.add(label);
    arcs.push({ a, curve, tube, core, pulses, label, el, dir });
  }

  // ---------------- (c) harta mica ----------------
  const T1pts = [];
  for (let s = 0; s <= route.length; s += 25) { const p = route.pos(s); T1pts.push([p.x, p.z]); }
  const pe = route.pos(route.length); T1pts.push([pe.x, pe.z]);
  ctx.mapLayers.push({ points: T1pts, color: '#f97316', width: 3 });
  for (const st of route.stops) { const p = route.pos(st.s); ctx.mapMarkers.push({ x: p.x, z: p.z, color: '#f97316', r: st.term ? 4.5 : 3, label: st.term ? (st.id === 'hub' ? 'Hub A7×A8' : '') : '' }); }
  for (const arc of arcs) {
    const pts = [];
    for (let d = 0; d <= 3200; d += 400) pts.push([hubC.x + arc.dir.x * d, hubC.z + arc.dir.z * d]);
    ctx.mapLayers.push({ points: pts, color: arc.a.color, width: 2.5, dash: [6, 4] });
    const e = pts[pts.length - 1];
    ctx.mapMarkers.push({ x: e[0], z: e[1], color: arc.a.color, r: 3, label: '✈ ' + arc.a.code });
  }
  ctx.mapFit.push([hubC.x, hubC.z]);

  ctx.scene.add(group);

  let visible = true;
  ctx.routeToggles.push((on) => {
    visible = on;
    for (const r of ribbons) r.m.visible = on;
    for (const a of arcs) { a.tube.visible = a.core.visible = on; a.pulses.forEach((p) => (p.visible = on)); }
  });

  // etichetele aeroporturilor: doar in vederea aeriana (orbit) si doar de departe (> 400 m de eticheta),
  // altfel ar pluti peste gara / strazi in modurile plimbare si tren usor
  const LABEL_MIN_D2 = 400 * 400;
  const cam = ctx.camera.position;
  let t = 0;
  ctx.addUpdate((dt) => {
    t += dt;
    flowTex.offset.y = -t * 0.6;
    const orbit = visible && (!ctx.controls || ctx.controls.mode === 'orbit');
    for (const a of arcs) {
      const want = orbit && cam.distanceToSquared(a.label.position) > LABEL_MIN_D2;
      if (a.label.visible !== want) a.label.visible = want;
    }
    if (!visible) return;
    for (const a of arcs) a.pulses.forEach((p, k) => { const u = 0.04 + 0.96 * ((t * 0.05 + k / 3) % 1); a.curve.getPoint(u, p.position); });
  });
  ctx.env.onChange((st) => {
    for (const r of ribbons) r.mat.opacity = 0.55 + 0.4 * st.night;
    for (const a of arcs) a.tube.material.opacity = 0.35 + 0.35 * st.night;
    for (const s of signs) s.material.emissiveIntensity = 0.15 + st.night * 0.55;
  });

  return { group, arcs, ribbons, signs, gantries: signs.length / 2 };
}
