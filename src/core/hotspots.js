import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Puncte de informare (cerinta 49: fiecare solutie trebuie explicata).
// add({ id, category, title, position: Vector3, what, why, benefit, data?: [[eticheta, valoare]], view?: {position, target}, walk?: {position, yaw} })
export const CATEGORIES = {
  info: { label: 'Informare', color: '#38bdf8', icon: 'ℹ' },
  access: { label: 'Accesibilitate', color: '#a78bfa', icon: '♿' },
  energy: { label: 'Energie', color: '#facc15', icon: '⚡' },
  eco: { label: 'Ecologie', color: '#4ade80', icon: '🌿' },
  safety: { label: 'Siguranță', color: '#f87171', icon: '🛡' },
  mobility: { label: 'Mobilitate', color: '#fb923c', icon: '🚆' },
  heritage: { label: 'Patrimoniu', color: '#e7c08a', icon: '🏛' },
};

export function createHotspots(ctx) {
  const list = [];
  const filters = new Set(Object.keys(CATEGORIES));
  let visible = true;
  const listeners = [];
  let future = true; // in modul „Azi” raman doar punctele de patrimoniu (sau cele marcate era: 'azi')
  const eraOk = (h) => future || h.category === 'heritage' || h.era === 'azi';

  function add(h) {
    const cat = CATEGORIES[h.category] || CATEGORIES.info;
    const el = document.createElement('button');
    el.className = 'hotspot';
    el.style.setProperty('--c', cat.color);
    el.innerHTML = `<span class="hs-dot">${cat.icon}</span><span class="hs-label">${h.title}</span>`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); open(h.id); });
    const obj = new CSS2DObject(el);
    obj.position.copy(h.position);
    obj.center.set(0.5, 1);
    ctx.scene.add(obj);
    const entry = { ...h, obj, el, index: list.length + 1 };
    list.push(entry);
    applyVisibility();
    return entry;
  }

  function applyVisibility() {
    const cam = ctx.camera.position;
    for (const h of list) {
      const show = visible && filters.has(h.category) && eraOk(h);
      h.obj.visible = show;
    }
  }

  // ascunde etichetele departate / ascunse (distanta maxima in functie de mod)
  const tmp = new THREE.Vector3();
  ctx.addUpdate(() => {
    if (!visible) return;
    const cam = ctx.camera.position;
    const maxD = ctx.controls && ctx.controls.mode !== 'orbit' ? 60 : 2600;
    for (const h of list) {
      if (!filters.has(h.category)) continue;
      if (!eraOk(h)) { h.obj.visible = false; continue; }
      const d = tmp.copy(h.position).distanceTo(cam);
      // maxDistance poate doar scurta raza (niciodata nu o lungeste in modul plimbare)
      const on = d < Math.min(h.maxDistance || Infinity, maxD);
      h.obj.visible = on;
      h.el.classList.toggle('far', d > 900);
    }
  });

  function open(id) {
    const h = list.find((x) => x.id === id);
    if (!h) return;
    for (const fn of listeners) fn(h);
  }

  return {
    list, add, open, CATEGORIES,
    onOpen(fn) { listeners.push(fn); },
    setVisible(v) { visible = v; applyVisibility(); if (!v) list.forEach((h) => (h.obj.visible = false)); },
    setFuture(on) { future = on; applyVisibility(); },
    toggleCategory(c, on) { on ? filters.add(c) : filters.delete(c); applyVisibility(); },
    get filters() { return filters; },
  };
}
