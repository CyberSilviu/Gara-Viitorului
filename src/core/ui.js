import * as THREE from 'three';
import { CATEGORIES } from './hotspots.js';

const $ = (id) => document.getElementById(id);

export function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

export function setLoading(frac, text) {
  $('loader-bar').style.width = Math.round(frac * 100) + '%';
  if (text) $('loader-text').textContent = text;
}
export function hideLoader() { $('loader').classList.add('done'); setTimeout(() => $('loader').remove(), 900); }

// ------------------------------------------------------------------
export function createUI(ctx) {
  const { controls, hotspots, env } = ctx;
  let current = null;

  // ----- Panou informatii -----
  function showPanel(h) {
    current = h;
    const cat = CATEGORIES[h.category] || CATEGORIES.info;
    const panel = $('panel');
    panel.style.setProperty('--c', cat.color);
    $('panel-cat').innerHTML = `<span style="color:${cat.color}">${cat.icon} ${cat.label}</span>`;
    $('panel-title').textContent = h.title;
    const sec = (title, txt) => (txt ? `<section style="--c:${cat.color}"><h4>${title}</h4><p>${txt}</p></section>` : '');
    let html = sec('Ce este', h.what) + sec('De ce am ales-o', h.why) + sec('Ce avantaj aduce', h.benefit);
    if (h.data && h.data.length) html += `<table>${h.data.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
    if (h.source) html += `<p class="credit">Sursă: ${h.source}</p>`;
    $('panel-body').innerHTML = html;
    $('panel-view').classList.toggle('hidden', !h.view);
    $('panel-walk').classList.toggle('hidden', !h.walk);
    panel.classList.remove('hidden');
  }
  hotspots.onOpen((h) => { showPanel(h); });
  $('panel-close').onclick = () => $('panel').classList.add('hidden');
  $('panel-view').onclick = () => { if (current?.view) { setModeUI('orbit'); controls.flyTo(current.view.position, current.view.target); } };
  $('panel-walk').onclick = () => { if (current?.walk) { setModeUI('walk', current.walk); } };

  // ----- Legenda (filtre categorii) -----
  const legend = $('legend');
  for (const [k, c] of Object.entries(CATEGORIES)) {
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${c.color}">${c.icon}</i>${c.label}`;
    b.onclick = () => { const on = b.classList.toggle('off'); hotspots.toggleCategory(k, !on); };
    legend.appendChild(b);
  }

  // ----- Moduri -----
  const modeButtons = [...document.querySelectorAll('#modes button')];
  function setModeUI(mode, opts) {
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('hud').classList.toggle('hidden', mode !== 'walk');
    $('ride-bar').classList.toggle('hidden', mode !== 'ride');
    $('tour-bar').classList.toggle('hidden', mode !== 'tour');
    ctx.tour?.stop?.();
    if ((mode === 'tour' || mode === 'ride') && ctx.future === false) ctx.setFuture?.(true); // turul si T1 sunt despre viitor
    if (mode === 'tour') { ctx.tour?.start?.(); return; }
    if (mode === 'ride') {
      if (ctx.transit?.startRide) ctx.transit.startRide();
      else { toast('Trenul ușor nu este încă disponibil'); return; }
      return;
    }
    ctx.transit?.stopRide?.();
    if (mode === 'walk') {
      controls.setMode('walk', opts || ctx.walkStart || {});
      return;
    }
    controls.setMode('orbit');
  }
  ctx.setModeUI = setModeUI;
  modeButtons.forEach((b) => (b.onclick = () => setModeUI(b.dataset.mode)));
  controls.onModeChange((mode, { locked }) => {
    $('hud-hint').style.opacity = locked ? 0.35 : 1;
  });

  // ----- Taste rapide -----
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.code === 'Digit1') setModeUI('orbit');
    if (e.code === 'Digit2') setModeUI('walk');
    if (e.code === 'Digit3') setModeUI('ride');
    if (e.code === 'Digit4') setModeUI('tour');
    if (e.code === 'KeyH') { $('t-labels').checked = !$('t-labels').checked; $('t-labels').onchange(); }
    if (e.code === 'KeyN') { setHour(env.hour > 7 && env.hour < 19 ? 21.5 : 11); }
    if (e.code === 'Escape') $('panel').classList.add('hidden');
  });

  // ----- Ora zilei -----
  const hourInput = $('hour');
  function setHour(h) {
    env.setHour(h);
    hourInput.value = h;
    const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
    $('hour-label').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  ctx.setHour = setHour;
  hourInput.oninput = () => setHour(+hourInput.value);
  let playing = false;
  $('btn-play-time').onclick = () => { playing = !playing; $('btn-play-time').textContent = playing ? '⏸' : '▶'; };
  ctx.addUpdate((dt) => { if (playing) setHour((env.hour + dt * 0.6) % 24); });

  // ----- Tablou energetic pliabil (implicit pliat pe ecrane mici) -----
  const dash = $('dash');
  if (window.innerWidth < 700) dash.classList.add('collapsed');
  $('dash-toggle').onclick = () => dash.classList.toggle('collapsed');

  // ----- Comutatoare -----
  $('t-labels').onchange = () => hotspots.setVisible($('t-labels').checked);
  // Azi / Viitor: butonul din bara de sus si bifa din tablou fac acelasi lucru
  function setFuture(on, quiet) {
    if (ctx.future === on && !quiet) return;
    ctx.future = on;
    $('t-future').checked = on;
    document.querySelectorAll('#era button').forEach((b) => b.classList.toggle('active', (b.dataset.era === 'viitor') === on));
    document.body.classList.toggle('era-azi', !on);
    // in „Azi” nu exista trenul usor: iesim din calatorie / tur
    if (!on && (controls.mode === 'ride' || ctx.tour?.active)) setModeUI('orbit');
    for (const fn of ctx.futureToggles) fn(on);
    hotspots.setFuture?.(on);
    ctx.redrawMinimap?.();
    if (!quiet) toast(on ? 'Gara viitorului: tren ușor T1, hub la nodul A7 × A8, gară modernizată' : 'Pașcani azi: gara și orașul așa cum sunt acum');
  }
  ctx.future = true;
  ctx.setFuture = setFuture;
  $('t-future').onchange = () => setFuture($('t-future').checked);
  document.querySelectorAll('#era button').forEach((b) => (b.onclick = () => setFuture(b.dataset.era === 'viitor')));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) setFuture(!$('t-future').checked);
  });
  $('t-routes').onchange = () => { for (const fn of ctx.routeToggles) fn($('t-routes').checked); };
  if ($('t-sat')) {
    $('t-sat').checked = ctx.satellite ? ctx.satellite.isOn() : false;
    $('t-sat').disabled = !ctx.setSatellite;
    $('t-sat').onchange = () => ctx.setSatellite?.($('t-sat').checked);
  }

  // ----- Locuri -----
  const places = $('places');
  $('btn-places').onclick = () => {
    places.innerHTML = '';
    for (const p of ctx.places) {
      const b = document.createElement('button');
      b.innerHTML = `<span>${p.icon || '📍'}</span><span>${p.name}<small>${p.sub || ''}</small></span>`;
      b.onclick = () => {
        places.classList.add('hidden');
        if (p.walk) setModeUI('walk', p.walk);
        else { setModeUI('orbit'); controls.flyTo(p.view.position, p.view.target); }
      };
      places.appendChild(b);
    }
    places.classList.toggle('hidden');
  };
  $('btn-help').onclick = () => $('help').classList.remove('hidden');
  $('help-close').onclick = () => $('help').classList.add('hidden');

  // ----- Atingere (tableta) -----
  document.querySelectorAll('#touch-pad button').forEach((b) => {
    const d = b.dataset.dir;
    const set = (v) => {
      if (d === 'f') controls.touchMove.f = v; if (d === 'b') controls.touchMove.f = -v;
      if (d === 'r') controls.touchMove.r = v; if (d === 'l') controls.touchMove.r = -v;
    };
    b.addEventListener('pointerdown', () => set(1));
    b.addEventListener('pointerup', () => set(0));
    b.addEventListener('pointerleave', () => set(0));
  });

  // ----- Energie -----
  setupEnergy(ctx);
  // ----- Minimap -----
  setupMinimap(ctx);

  setHour(env.hour);
  return { showPanel, setModeUI, setHour };
}

// ------------------------------------------------------------------
// Simulare energetica a garii (valori ilustrative, explicate in panoul "Energie")
function setupEnergy(ctx) {
  const cfg = Object.assign({ pvKWp: 1450, batteryKWh: 2400, baseKW: 260, lightKW: 120, tramKW: 180 }, ctx.energyConfig || {});
  const sunFactor = (h) => {
    const d = (h - 6) / 12;
    if (d <= 0 || d >= 1) return 0;
    return Math.pow(Math.sin(d * Math.PI), 1.3) * 0.82;
  };
  const load = (h) => {
    const traffic = 0.55 + 0.45 * (Math.exp(-((h - 7.5) ** 2) / 3) + Math.exp(-((h - 17) ** 2) / 4));
    const night = h < 6.5 || h > 19.5 ? 1 : 0.15;
    return cfg.baseKW * traffic + cfg.lightKW * night * 0.6 + cfg.tramKW * (h > 5 && h < 23.5 ? 0.7 : 0.1);
  };
  ctx.energyModel = { cfg, pv: (h) => cfg.pvKWp * sunFactor(h), load };
  // integrare pe zi pentru baterie & CO2
  const day = [];
  let soc = 0.45 * cfg.batteryKWh, pvSum = 0;
  for (let i = 0; i <= 96; i++) {
    const h = i / 4;
    const p = cfg.pvKWp * sunFactor(h), l = load(h);
    soc = THREE.MathUtils.clamp(soc + (p - l) * 0.25 * 0.92, 0.1 * cfg.batteryKWh, cfg.batteryKWh);
    pvSum += p * 0.25;
    day.push({ h, p, l, soc, pvSum });
  }
  const canvas = $('energy-chart');
  const g = canvas.getContext('2d');
  const maxV = Math.max(...day.map((d) => Math.max(d.p, d.l))) * 1.1;
  function draw(hour) {
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const X = (h) => (h / 24) * W, Y = (v) => H - 4 - (v / maxV) * (H - 10);
    g.beginPath(); g.moveTo(0, H);
    day.forEach((d) => g.lineTo(X(d.h), Y(d.p)));
    g.lineTo(W, H); g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(250,204,21,.65)'); gr.addColorStop(1, 'rgba(250,204,21,.05)');
    g.fillStyle = gr; g.fill();
    g.beginPath(); day.forEach((d, i) => (i ? g.lineTo(X(d.h), Y(d.l)) : g.moveTo(X(d.h), Y(d.l))));
    g.strokeStyle = '#22d3ee'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(hour), 0); g.lineTo(X(hour), H); g.stroke();
    g.fillStyle = '#93a4ba'; g.font = '10px Segoe UI';
    g.fillText('— solar', W - 112, 11); g.fillStyle = '#22d3ee'; g.fillText('— consum', W - 62, 11);
  }
  const $k = (id, v) => ($(id).textContent = v);
  ctx.env.onChange((st) => {
    const h = st.hour;
    const d = day[Math.round(h * 4) % 97];
    $k('k-pv', `${Math.round(ctx.energyModel.pv(h))} kW`);
    $k('k-load', `${Math.round(load(h))} kW`);
    $k('k-bat', `${Math.round((d.soc / cfg.batteryKWh) * 100)} %`);
    $k('k-co2', `${(d.pvSum * 0.27 / 1000).toFixed(2)} t`); // ~0.27 kg CO2/kWh (mix RO)
    draw(h);
  });
}

// ------------------------------------------------------------------
// Harta mica: drumuri, CF, Siret, traseul trenului usor, pozitia camerei. Click = zbor acolo.
function setupMinimap(ctx) {
  const canvas = $('minimap');
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  let view = { cx: 0, cz: 0, span: 9000 };
  // incadrare: gara + nodul (daca exista)
  function fit() {
    const pts = [[0, 0], ...(ctx.mapFit || [])];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    view.cx = (minX + maxX) / 2; view.cz = (minZ + maxZ) / 2;
    view.span = Math.max(3000, (Math.max(maxX - minX, maxZ - minZ)) * 1.35);
  }
  const toPx = (x, z) => [((x - view.cx) / view.span + 0.5) * W, ((z - view.cz) / view.span + 0.5) * H];
  function drawBase() {
    fit();
    const b = base.getContext('2d');
    b.fillStyle = '#0d1a14'; b.fillRect(0, 0, W, H);
    const osm = ctx.city?.osm;
    const line = (pts, color, w, dash) => {
      b.beginPath();
      pts.forEach(([x, z], i) => { const [px, pz] = toPx(x, z); i ? b.lineTo(px, pz) : b.moveTo(px, pz); });
      b.strokeStyle = color; b.lineWidth = w; b.setLineDash(dash || []); b.stroke(); b.setLineDash([]);
    };
    if (osm) {
      for (const a of osm.areas) if (a.k === 'forest' || a.k === 'wood') {
        b.beginPath(); a.p.forEach(([x, z], i) => { const [px, pz] = toPx(x, z); i ? b.lineTo(px, pz) : b.moveTo(px, pz); });
        b.fillStyle = '#16301f'; b.fill();
      }
      b.fillStyle = 'rgba(160,170,180,.35)';
      for (const f of ctx.city.footprints) { const [px, pz] = toPx(f.cx, f.cz); b.fillRect(px, pz, 1, 1); }
      for (const w of osm.rivers) line(w.p, '#2b6a8a', w.k === 'river' ? 2.5 : 0.8);
      for (const w of osm.roads) {
        const major = /motorway|trunk|primary|secondary/.test(w.k) || w.k === 'construction';
        if (!major && view.span > 6000) continue;
        line(w.p, w.k === 'construction' ? '#a78457' : major ? '#cbd5e1' : '#475569', w.k.startsWith('motorway') ? 2.2 : major ? 1.2 : 0.5, w.k === 'construction' ? [3, 2] : null);
      }
      for (const w of osm.rails) if (w.k !== 'platform') line(w.p, '#e7c08a', 1, [2, 2]);
    }
    const eraOk = (o) => ctx.future !== false || !o.future;
    for (const l of ctx.mapLayers) if (eraOk(l)) line(l.points, l.color, l.width || 2, l.dash);
    for (const m of ctx.mapMarkers) {
      if (!eraOk(m)) continue;
      const [px, pz] = toPx(m.x, m.z);
      b.fillStyle = m.color || '#fff'; b.beginPath(); b.arc(px, pz, m.r || 3.5, 0, Math.PI * 2); b.fill();
      if (m.label) { b.font = '600 10px Segoe UI'; b.fillStyle = '#fff'; b.fillText(m.label, px + 6, pz + 3); }
    }
    // scara
    const km = 1000 / view.span * W;
    $('mm-scale').textContent = `▬ ${km > 30 ? '1 km' : '5 km'}`;
  }
  ctx.redrawMinimap = drawBase;
  const dir = new THREE.Vector3();
  ctx.addUpdate(() => {
    g.drawImage(base, 0, 0);
    const c = ctx.camera.position;
    const [px, pz] = toPx(c.x, c.z);
    ctx.camera.getWorldDirection(dir);
    const ang = Math.atan2(dir.z, dir.x);
    g.save(); g.translate(px, pz); g.rotate(ang);
    g.fillStyle = '#22d3ee'; g.beginPath(); g.moveTo(9, 0); g.lineTo(-5, 5); g.lineTo(-5, -5); g.closePath(); g.fill();
    g.restore();
    for (const m of ctx.mapLive) {
      const p = m(); if (!p || (ctx.future === false && (p.future || m.future))) continue;
      const [mx, mz] = toPx(p.x, p.z);
      g.fillStyle = p.color || '#4ade80'; g.beginPath(); g.arc(mx, mz, 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    }
  });
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fz = (e.clientY - r.top) / r.height;
    const x = view.cx + (fx - 0.5) * view.span, z = view.cz + (fz - 0.5) * view.span;
    const y = ctx.terrain.heightAt(x, z);
    ctx.setModeUI('orbit');
    ctx.controls.flyTo(new THREE.Vector3(x - 250, y + 260, z + 350), new THREE.Vector3(x, y, z));
  });
  drawBase();
}
