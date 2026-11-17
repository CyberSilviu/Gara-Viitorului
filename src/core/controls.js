import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Moduri de navigare:
//  'orbit' - vedere aeriana (mouse: rotire / zoom / deplasare)
//  'walk'  - plimbare la persoana I (click = blocare mouse, WASD/sageti, Shift = alergare, Space = saritura)
//  'ride'  - camera fixata intr-un vehicul (ctx.rideTarget = Object3D; mouse trage = privire)
// Coliziuni: ctx.colliders (mesh-uri pereti) ; podea: ctx.walkables (mesh-uri) + teren.
export function createControls(ctx) {
  const { camera, renderer } = ctx;
  const dom = renderer.domElement;
  const orbit = new OrbitControls(camera, ctx.labelRenderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.maxDistance = 16000;
  orbit.minDistance = 4;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.target.set(0, 0, 0);
  orbit.screenSpacePanning = false;
  orbit.zoomToCursor = true;

  const state = { mode: 'orbit', listeners: [] };
  const keys = {};
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const vel = new THREE.Vector3();
  let vy = 0, onGround = false;
  const EYE = 1.68;
  let locked = false;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let fly = null; // animatie camera

  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    keys[e.code] = true;
    if (state.mode === 'walk' && e.code === 'Space' && onGround) { vy = 4.2; onGround = false; }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ---- privire cu mouse-ul (walk: pointer lock ; ride: drag) ----
  const look = { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0 };
  const layer = ctx.labelRenderer.domElement;
  layer.addEventListener('click', () => {
    if (state.mode === 'walk' && !locked && !ctx.uiBlocking) layer.requestPointerLock?.();
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === layer;
    for (const fn of state.listeners) fn(state.mode, { locked });
  });
  document.addEventListener('mousemove', (e) => {
    if (state.mode === 'walk' && locked) {
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= e.movementX * 0.0022;
      euler.x -= e.movementY * 0.0022;
      euler.x = THREE.MathUtils.clamp(euler.x, -1.45, 1.45);
      camera.quaternion.setFromEuler(euler);
    }
  });
  layer.addEventListener('pointerdown', (e) => {
    if (state.mode === 'ride' || (state.mode === 'walk' && !locked)) { look.dragging = true; look.lx = e.clientX; look.ly = e.clientY; }
  });
  window.addEventListener('pointerup', () => { look.dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!look.dragging) return;
    const dx = e.clientX - look.lx, dy = e.clientY - look.ly;
    look.lx = e.clientX; look.ly = e.clientY;
    if (state.mode === 'ride') {
      look.yaw -= dx * 0.004; look.pitch = THREE.MathUtils.clamp(look.pitch - dy * 0.004, -0.8, 0.6);
    } else if (state.mode === 'walk') {
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= dx * 0.004; euler.x = THREE.MathUtils.clamp(euler.x - dy * 0.004, -1.45, 1.45);
      camera.quaternion.setFromEuler(euler);
    }
  });

  // ---- butoane tactile pentru tableta (sageti pe ecran) ----
  const touchMove = { f: 0, r: 0 };

  function groundHeight(x, y, z) {
    // cel mai inalt "walkable" sub ochi (cu toleranta de urcare 0.6 m), altfel terenul
    let best = ctx.terrain.heightAt(x, z);
    if (ctx.walkables.length) {
      ray.set(_o.set(x, y + 0.6, z), down);
      ray.far = 60;
      const hits = ray.intersectObjects(ctx.walkables, true);
      if (hits.length) best = Math.max(best, hits[0].point.y);
    }
    return best;
  }

  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  // obiecte refolosite (fara alocari in fiecare cadru)
  const _o = new THREE.Vector3(), _n = new THREE.Vector3(), _d2 = new THREE.Vector3(), _want = new THREE.Vector3(), _move = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function collide(pos, move) {
    if (!ctx.colliders.length || move.lengthSq() === 0) return move;
    const dir = tmp.copy(move).normalize();
    for (const h of [0.35, 1.2]) {
      ray.set(_o.set(pos.x, pos.y - EYE + h, pos.z), dir);
      ray.far = move.length() + 0.35;
      const hits = ray.intersectObjects(ctx.colliders, true);
      if (hits.length) {
        const n = hits[0].face ? _n.copy(hits[0].face.normal).transformDirection(hits[0].object.matrixWorld) : _n.copy(dir).negate();
        n.y = 0; n.normalize();
        // alunecare de-a lungul peretelui
        move.addScaledVector(n, -move.dot(n));
        if (move.length() > 0.001) {
          const d2 = _d2.copy(move).normalize();
          ray.set(_o.set(pos.x, pos.y - EYE + h, pos.z), d2);
          ray.far = move.length() + 0.35;
          if (ray.intersectObjects(ctx.colliders, true).length) move.set(0, 0, 0);
        }
      }
    }
    return move;
  }

  function updateWalk(dt) {
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    const speed = (keys.ShiftLeft || keys.ShiftRight ? 9 : 3.6);
    const want = _want.set(0, 0, 0);
    if (keys.KeyW || keys.ArrowUp) want.add(fwd);
    if (keys.KeyS || keys.ArrowDown) want.sub(fwd);
    if (keys.KeyD || keys.ArrowRight) want.add(right);
    if (keys.KeyA || keys.ArrowLeft) want.sub(right);
    want.addScaledVector(fwd, touchMove.f).addScaledVector(right, touchMove.r);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    vel.lerp(want, Math.min(1, dt * 10));
    const move = _move.copy(vel).multiplyScalar(dt);
    collide(camera.position, move);
    camera.position.add(move);
    // gravitatie & podea
    const g = groundHeight(camera.position.x, camera.position.y - EYE, camera.position.z);
    vy -= 9.8 * dt;
    camera.position.y += vy * dt;
    if (camera.position.y - EYE <= g) { camera.position.y = g + EYE; vy = 0; onGround = true; }
  }

  const rideOffset = new THREE.Vector3();
  function updateRide() {
    const t = ctx.rideTarget;
    if (!t) return;
    t.updateWorldMatrix(true, false);
    const seat = t.userData.seat || new THREE.Vector3(0, 2.4, 0);
    rideOffset.copy(seat).applyMatrix4(t.matrixWorld);
    camera.position.copy(rideOffset);
    const q = _q.setFromRotationMatrix(t.matrixWorld);
    const e = _e.setFromQuaternion(q, 'YXZ');
    camera.rotation.set(look.pitch, e.y + look.yaw + (t.userData.seatYaw || 0), 0, 'YXZ');
  }

  ctx.addUpdate((dt) => {
    if (fly) {
      fly.t += dt / fly.dur;
      const k = fly.t >= 1 ? 1 : 0.5 - Math.cos(Math.PI * fly.t) / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, k);
      // arc in sus pentru zboruri lungi
      camera.position.y += Math.sin(Math.PI * k) * fly.arc;
      orbit.target.lerpVectors(fly.t0, fly.t1, k);
      camera.lookAt(orbit.target);
      if (fly.t >= 1) { const done = fly.done; fly = null; orbit.update(); done && done(); }
      ctx.focusPoint = orbit.target;
      return;
    }
    if (state.mode === 'orbit') {
      orbit.update();
      // nu intra sub teren
      const gh = ctx.terrain.heightAt(camera.position.x, camera.position.z) + 2;
      if (camera.position.y < gh) camera.position.y = gh;
      ctx.focusPoint = orbit.target;
    } else if (state.mode === 'walk') {
      updateWalk(dt);
      ctx.focusPoint = camera.position;
    } else if (state.mode === 'ride') {
      updateRide();
      ctx.focusPoint = camera.position;
    }
    // planul apropiat adaptiv => fara "z-fighting" la distanta
    const above = camera.position.y - ctx.terrain.heightAt(camera.position.x, camera.position.z);
    const near = state.mode === 'orbit' ? THREE.MathUtils.clamp(above * 0.01, 0.2, 25) : state.mode === 'ride' ? 0.3 : 0.2; // >= 0.2 m: precizie buna a adancimii (fara clipiri la distanta)
    if (Math.abs(camera.near - near) > 0.01) { camera.near = near; camera.updateProjectionMatrix(); }
  });

  function setMode(mode, opts = {}) {
    if (document.pointerLockElement) document.exitPointerLock();
    fly = null;
    state.mode = mode;
    orbit.enabled = mode === 'orbit';
    if (mode === 'walk') {
      const p = opts.position || new THREE.Vector3(0, 0, 30);
      camera.position.set(p.x, groundHeight(p.x, (p.y ?? 50), p.z) + EYE, p.z);
      euler.set(0, opts.yaw ?? 0, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
      vel.set(0, 0, 0); vy = 0;
    }
    if (mode === 'ride') { look.yaw = 0; look.pitch = -0.05; ctx.rideTarget = opts.target || ctx.rideTarget; }
    if (mode === 'orbit' && opts.target) {
      orbit.target.copy(opts.target);
      if (opts.position) camera.position.copy(opts.position);
    }
    for (const fn of state.listeners) fn(mode, { locked });
  }

  // zbor lin al camerei (in modul orbit)
  function flyTo(position, target, dur = 2.4, done) {
    if (state.mode !== 'orbit') setMode('orbit');
    const dist = camera.position.distanceTo(position);
    fly = { p0: camera.position.clone(), p1: position.clone(), t0: orbit.target.clone(), t1: target.clone(), t: 0, dur: Math.max(0.6, Math.min(dur, 1 + dist / 900)), arc: Math.min(dist * 0.25, 900), done };
  }

  return {
    orbit, setMode, flyTo, touchMove,
    get mode() { return state.mode; },
    get locked() { return locked; },
    get flying() { return !!fly; },
    onModeChange(fn) { state.listeners.push(fn); },
  };
}
