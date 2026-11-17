import * as THREE from 'three';
import { DWELL } from './fleet.js';

// Modul "Tren usor": calatoria cu T1 de la Gara Pascani la Hub Turbion A7×A8.
// Camere: cabina (vatman), lateral dreapta / stanga (loc la fereastra), drona (urmarire din spate-sus).
const $ = (id) => document.getElementById(id);
const CAMS = [
  { id: 'cab', label: 'cabină' },
  { id: 'right', label: 'lateral dreapta' },
  { id: 'left', label: 'lateral stânga' },
  { id: 'drone', label: 'dronă' },
];
const SPEEDS = [1, 2, 4, 8];

export function createRide(ctx, route, fleet, opts = {}) {
  const stops = route.stops;
  const v1 = fleet.vehicles[0], v2 = fleet.vehicles[1];
  const secA = v1.tram.sections[0], secB = v1.tram.sections[1];

  // tinte pentru camera (Object3D cu userData.seat / seatYaw)
  const cabT = new THREE.Object3D(); cabT.userData.seat = new THREE.Vector3(0, 2.25, -4.05); cabT.userData.seatYaw = 0; secA.add(cabT);
  const rightT = new THREE.Object3D(); rightT.userData.seat = new THREE.Vector3(0.75, 1.75, 1.2); rightT.userData.seatYaw = -Math.PI / 2; secB.add(rightT);
  const leftT = new THREE.Object3D(); leftT.userData.seat = new THREE.Vector3(-0.75, 1.75, -1.2); leftT.userData.seatYaw = Math.PI / 2; secB.add(leftT);
  const droneT = new THREE.Object3D(); droneT.userData.seat = new THREE.Vector3(0, 0, 0); droneT.userData.seatYaw = 0; ctx.scene.add(droneT);
  const targets = { cab: cabT, right: rightT, left: leftT, drone: droneT };

  const state = { active: false, cam: 0, speed: 0, arrived: false, startS: stops[0].s, endS: stops[stops.length - 1].s, wired: false };

  // --- bara cu statii ---
  function buildStopsBar() {
    const el = $('ride-stops');
    if (!el) return;
    el.innerHTML = '';
    const span = state.endS - state.startS;
    // etichetele alterneaza sub / deasupra barei, ca statiile apropiate sa nu se suprapuna;
    // la capete textul e aliniat spre interior, ca sa nu iasa din bara
    stops.forEach((st, i) => {
      const s = document.createElement('span');
      s.style.left = `${((st.s - state.startS) / span) * 100}%`;
      s.title = st.name;
      const em = document.createElement('em');
      em.textContent = st.name;
      if (i % 2 === 1) { s.style.setProperty('--up', '1'); em.style.top = '-15px'; }
      if (i === 0) { em.style.left = '0'; em.style.transform = 'none'; }
      else if (i === stops.length - 1) { em.style.left = 'auto'; em.style.right = '0'; em.style.transform = 'none'; }
      s.appendChild(em);
      el.appendChild(s);
    });
  }

  function setCam(i) {
    state.cam = (i + CAMS.length) % CAMS.length;
    const c = CAMS[state.cam];
    ctx.rideTarget = targets[c.id];
    if (ctx.controls.mode === 'ride') ctx.controls.setMode('ride', { target: ctx.rideTarget });
    const b = $('ride-cam'); if (b) b.textContent = `🎥 Cameră: ${c.label}`;
    if (c.id === 'drone') updateDrone(1, true);
  }
  function setSpeed(i) {
    state.speed = (i + SPEEDS.length) % SPEEDS.length;
    fleet.setScale(state.active ? SPEEDS[state.speed] : 1);
    const b = $('ride-speed'); if (b) b.textContent = `⏩ Viteză x${SPEEDS[state.speed]}`;
  }
  function setPaused(p) {
    fleet.setPaused(p);
    const b = $('ride-pause'); if (b) { b.textContent = p ? '▶' : '⏸'; b.title = p ? 'Continuă' : 'Pauză'; }
  }
  function wire() {
    if (state.wired) return;
    state.wired = true;
    const bc = $('ride-cam'), bs = $('ride-speed'), bp = $('ride-pause');
    if (bc) bc.onclick = () => setCam(state.cam + 1);
    if (bs) bs.onclick = () => setSpeed(state.speed + 1);
    if (bp) bp.onclick = () => setPaused(!fleet.paused);
    window.addEventListener('keydown', (e) => {
      if (!state.active || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.code === 'KeyC') setCam(state.cam + 1);
      if (e.code === 'KeyP') setPaused(!fleet.paused);
      if (e.code === 'BracketRight' || e.code === 'Equal') setSpeed(state.speed + 1);
    });
  }

  // --- drona: urmareste vehiculul din spate-sus, cu intarziere lina ---
  const dPos = new THREE.Vector3(), dTmp = new THREE.Vector3(), fwd = new THREE.Vector3();
  let dYaw = 0;
  // camera din cabina sta mereu in cabina din fata (A la dus, C la intoarcere)
  let cabDir = 1;
  function followLeadingCab() {
    if (v1.dir === cabDir) return;
    cabDir = v1.dir;
    v1.tram.sections[cabDir > 0 ? 0 : 2].add(cabT);
  }
  function updateDrone(dt, snap = false) {
    const c = secB.position;
    fwd.subVectors(secA.position, v1.tram.sections[2].position).normalize().multiplyScalar(v1.dir);
    if (fwd.lengthSq() < 0.1) fwd.set(0, 0, -1);
    dTmp.copy(c).addScaledVector(fwd, -46);
    dTmp.y += 24;
    // drona nu coboara sub teren / cladiri joase
    dTmp.y = Math.max(dTmp.y, ctx.terrain.heightAt(dTmp.x, dTmp.z) + 14);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    if (snap) { dPos.copy(dTmp); dYaw = yaw; }
    const k = 1 - Math.exp(-dt * 2.2);
    dPos.lerp(dTmp, k);
    let dy = yaw - dYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    dYaw += dy * k;
    droneT.position.copy(dPos);
    droneT.rotation.set(0, dYaw, 0);
  }

  // --- stare / bara de progres ---
  let uiAcc = 0;
  function eta() {
    // timp pana la urmatoarea statie si pana la hub (sensul de mers al vehiculului 1)
    const info = fleet.infoFor(v1);
    const nextS = stops[THREE.MathUtils.clamp(v1.target, 0, stops.length - 1)].s;
    let tNext = v1.mode === 'dwell' ? Math.max(0, v1.timer) : 0;
    tNext += fleet.runTime(v1.s, nextS);
    let tHub = null;
    if (v1.dir > 0) {
      tHub = tNext;
      for (let k = v1.target; k < stops.length - 1; k++) tHub += fleet.legTimes[k] + DWELL;
    }
    return { info, tNext, tHub };
  }
  const fmt = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`; };
  function updateUI(dt) {
    uiAcc += dt;
    if (uiAcc < 0.2) return;
    uiAcc = 0;
    const { info, tNext, tHub } = eta();
    const kmh = Math.round(v1.v * 3.6);
    const st = $('ride-status');
    if (st) {
      const where = v1.mode === 'dwell'
        ? `în stația <b>${info.next}</b> · plecare în ${fmt(v1.timer)}`
        : `următoarea stație: <b>${info.next}</b> · ${fmt(tNext)}`;
      st.innerHTML = `<b>${kmh} km/h</b> · ${where}${tHub != null ? ` · Hub în ${fmt(tHub)}` : ' · cursă de întoarcere spre gară'}`;
    }
    const pr = $('ride-progress');
    if (pr) pr.style.width = `${THREE.MathUtils.clamp((v1.s - state.startS) / (state.endS - state.startS), 0, 1) * 100}%`;
  }

  // compensare: controalele au pozitionat camera inainte ca vehiculul sa se miste in acest cadru
  const prevM = new THREE.Matrix4(), q = new THREE.Quaternion(), e1 = new THREE.Euler(0, 0, 0, 'YXZ'), e2 = new THREE.Euler(0, 0, 0, 'YXZ'), sv = new THREE.Vector3();
  function syncCamera(prevMatrix) {
    const t = ctx.rideTarget;
    if (!t || ctx.controls.mode !== 'ride') return;
    t.updateWorldMatrix(true, false);
    e1.setFromQuaternion(q.setFromRotationMatrix(prevMatrix), 'YXZ');
    e2.setFromQuaternion(q.setFromRotationMatrix(t.matrixWorld), 'YXZ');
    let dy = e2.y - e1.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    ctx.camera.position.copy(sv.copy(t.userData.seat || sv.set(0, 2.4, 0)).applyMatrix4(t.matrixWorld));
    ctx.camera.rotation.y += dy;
    // drona: privire usor in jos spre tramvai (controalele refac pitch-ul in fiecare cadru)
    if (t === droneT) ctx.camera.rotation.x -= 0.3;
  }

  fleet.onArrive((v, idx) => {
    if (!state.active || v !== v1) return;
    const st = stops[idx];
    if (idx === stops.length - 1 && !state.arrived) {
      state.arrived = true;
      ctx.toast('🎉 Ați ajuns la Hub Turbion A7 × A8 – autocare spre aeroporturile Iași, Suceava și Bacău', 5200);
      if (opts.onArriveHub) opts.onArriveHub();
    } else if (idx > 0 && idx < stops.length - 1) {
      ctx.toast(`Stația ${st.name}`, 1800);
    }
  });

  // inregistrat dupa flota => ruleaza dupa miscarea vehiculelor in acelasi cadru
  ctx.addUpdate((dt) => {
    if (!state.active) return;
    followLeadingCab();
    if (CAMS[state.cam].id === 'drone') updateDrone(dt);
    syncCamera(prevM);
    updateUI(dt);
  });

  return {
    get active() { return state.active; },
    // apelat de modulul index inainte de miscarea flotei (pentru compensarea camerei)
    capture() { const t = ctx.rideTarget; if (t) { t.updateWorldMatrix(true, false); prevM.copy(t.matrixWorld); } },
    sync() { if (state.active) syncCamera(prevM); },
    startRide() {
      wire();
      state.active = true;
      state.arrived = false;
      fleet.resetVehicle(v1, false, 8);
      fleet.resetVehicle(v2, true, 8);
      fleet.place(v1); fleet.place(v2);
      followLeadingCab();
      setPaused(false);
      setSpeed(0);
      buildStopsBar();
      const title = $('ride-title'); if (title) title.textContent = 'Tren ușor T1 · Gara Pașcani → Hub Turbion A7×A8';
      state.cam = 0;
      ctx.rideTarget = cabT;
      v1.tram.root.updateMatrixWorld(true);
      ctx.controls.setMode('ride', { target: cabT });
      setCam(0);
      ctx.toast('Urcați în T1 · plecare în 8 s · C = cameră, P = pauză', 3200);
    },
    stopRide() {
      if (!state.active) return;
      state.active = false;
      fleet.setScale(1);
      setPaused(false);
    },
    setCam, setSpeed,
  };
}
