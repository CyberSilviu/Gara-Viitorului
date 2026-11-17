import * as THREE from 'three';
import { Batch, Phys, hipRoofGeo, triGeo, panelGeo } from './builder.js';
import { PLAT_Y } from './frame.js';
import { lettering, createClock } from './boards.js';

// Cladirea istorica de calatori (amprenta reala OSM way 841790852, in trepte):
// pavilion N · aripa N (retrasa 4.6 m) · corp central (cu etaj, acoperis in 4 ape) · aripa S · pavilion S.
// Fatada EST (spre linii) e un perete drept de 116 m cu portic pe stalpi patrati.
export const PARTS = [
  { id: 'pavN', x0: -11.4, x1: 9.8, z0: -60.6, z1: -47.9, h: 9.6, roofH: 3.0, floors: 2 },
  { id: 'wingN', x0: -6.6, x1: 9.8, z0: -47.9, z1: -11.8, h: 6.4, roofH: 1.7, floors: 1 },
  { id: 'central', x0: -10.5, x1: 9.8, z0: -11.8, z1: 6.5, h: 11.2, roofH: 4.0, floors: 2 },
  { id: 'wingS', x0: -5.6, x1: 9.8, z0: 6.5, z1: 43, h: 6.4, roofH: 1.7, floors: 1 },
  { id: 'pavS', x0: -10.5, x1: 9.8, z0: 43, z1: 56.2, h: 9.6, roofH: 3.0, floors: 2 },
];
// Pasajul pietonal prin aripa nord (holul nou -> peronul 1), rampa 4 %
export const PASSAGE = { z0: -32, z1: -26, x0: -6.6, x1: 9.8, yIn: 0.42, yOut: PLAT_Y, hClear: 4.2 };

export function buildBuilding(ctx, M, root) {
  const group = new THREE.Group();
  group.name = 'cladire-istorica';
  root.add(group);
  let B = new Batch('cladire');
  const P = new Phys('cladire');
  // Pasajul prin aripa nord exista doar in „Viitor”; in „Azi” cladirea e intreaga (un „dop” de zidarie umple golul).
  const passGroup = new THREE.Group(); passGroup.name = 'pasaj-viitor';
  const plugGroup = new THREE.Group(); plugGroup.name = 'aripa-nord-azi';
  group.add(passGroup, plugGroup);
  const BF = new Batch('pasaj');
  const PF = new Phys('pasaj');
  const BT = new Batch('aripa-azi');
  const PT = new Phys('aripa-azi');

  const addWindowsAlongZ = (x, side, z0, z1, floors, h, skip) => {
    // fatada paralela cu axa (vest/est). side = -1 (vest) / +1 (est)
    const n = Math.max(1, Math.round((z1 - z0) / 3.6));
    const step = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      const z = z0 + step * (i + 0.5);
      if (skip && skip(z)) continue;
      for (let f = 0; f < floors; f++) {
        const y0 = f === 0 ? 1.1 : 5.9, wh = f === 0 ? (floors === 1 ? 3.3 : 2.9) : 2.3;
        B.box(M.plasterTrim, x + side * 0.05, y0 + wh / 2, z, 0.14, wh + 0.5, 1.75);
        B.add(M.histWindow, panelGeo(1.3, wh), x + side * 0.16, y0 + wh / 2, z, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  };
  const addWindowsAlongX = (z, side, x0, x1, floors) => {
    const n = Math.max(1, Math.round((x1 - x0) / 3.8));
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const x = x0 + step * (i + 0.5);
      for (let f = 0; f < floors; f++) {
        const y0 = f === 0 ? 1.1 : 5.9, wh = f === 0 ? 2.9 : 2.3;
        B.box(M.plasterTrim, x, y0 + wh / 2, z + side * 0.05, 1.75, wh + 0.5, 0.14);
        B.add(M.histWindow, panelGeo(1.3, wh), x, y0 + wh / 2, z + side * 0.16, side > 0 ? 0 : Math.PI);
      }
    }
  };

  for (const p of PARTS) {
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    if (p.id === 'wingN') {
      // aripa nord, impartita de pasaj
      B.aabb(M.plaster, p.x0, 0, p.z0, p.x1, p.h, PASSAGE.z0);
      B.aabb(M.plaster, p.x0, 0, PASSAGE.z1, p.x1, p.h, p.z1);
      B.aabb(M.plaster, p.x0, PASSAGE.hClear + 0.6, PASSAGE.z0, p.x1, p.h, PASSAGE.z1);
      P.wallAabb(p.x0, 0, p.z0, p.x1, p.h, PASSAGE.z0);
      P.wallAabb(p.x0, 0, PASSAGE.z1, p.x1, p.h, p.z1);
      BT.aabb(M.plaster, p.x0, 0, PASSAGE.z0, p.x1, PASSAGE.hClear + 0.6, PASSAGE.z1);
      BT.aabb(M.plinth, p.x0 - 0.08, 0, PASSAGE.z0, p.x1 + 0.08, 1.2, PASSAGE.z1);
      PT.wallAabb(p.x0, 0, PASSAGE.z0, p.x1, PASSAGE.hClear + 0.6, PASSAGE.z1);
    } else {
      B.box(M.plaster, cx, p.h / 2, cz, w, p.h, d);
      P.wall(cx, p.h / 2, cz, w, p.h, d);
    }
    // soclu, cornisa, brau
    if (p.id === 'wingN') {
      B.aabb(M.plinth, p.x0 - 0.08, 0, p.z0, p.x1 + 0.08, 1.2, PASSAGE.z0);
      B.aabb(M.plinth, p.x0 - 0.08, 0, PASSAGE.z1, p.x1 + 0.08, 1.2, p.z1);
    } else B.box(M.plinth, cx, 0.6, cz, w + 0.16, 1.2, d + 0.16);
    B.box(M.plasterTrim, cx, p.h - 0.3, cz, w + 0.5, 0.6, d + 0.5);
    if (p.floors > 1) B.box(M.plasterTrim, cx, 5.1, cz, w + 0.2, 0.35, d + 0.2);
    // acoperis in patru ape
    B.add(M.roof, hipRoofGeo(p.x0, p.z0, p.x1, p.z1, p.h, p.roofH, p.floors > 1 ? 0.55 : 0.3));
    // ferestre (vest + est); pe aripa nord fara fereastra in dreptul pasajului
    const skip = p.id === 'wingN' ? (z) => z > PASSAGE.z0 - 1.2 && z < PASSAGE.z1 + 1.2 : null;
    addWindowsAlongZ(p.x0, -1, p.z0 + 0.6, p.z1 - 0.6, p.floors, p.h, skip);
    addWindowsAlongZ(p.x1, +1, p.z0 + 0.6, p.z1 - 0.6, p.floors, p.h, skip);
    if (skip) {
      // „Azi”: ferestrele din dreptul pasajului (aripa intreaga)
      const keep = B;
      B = BT;
      addWindowsAlongZ(p.x0, -1, p.z0 + 0.6, p.z1 - 0.6, p.floors, p.h, (z) => !skip(z));
      addWindowsAlongZ(p.x1, +1, p.z0 + 0.6, p.z1 - 0.6, p.floors, p.h, (z) => !skip(z));
      B = keep;
    }
    if (p.id === 'pavN') addWindowsAlongX(p.z0, -1, p.x0 + 0.5, p.x1 - 0.5, 2);
    if (p.id === 'pavS') addWindowsAlongX(p.z1, +1, p.x0 + 0.5, p.x1 - 0.5, 2);
    if (p.id.startsWith('pav')) {
      // lucarne pe acoperis
      for (const s of [-1, 1]) {
        const x = s < 0 ? p.x0 - 0.3 : p.x1 + 0.3;
        B.box(M.plasterTrim, x + s * 0.6, p.h + 0.8, cz, 1.4, 1.4, 1.6);
        B.add(M.histWindow, panelGeo(0.9, 0.9), x + s * 1.32, p.h + 0.75, cz, s > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  }

  // Frontoane pe corpul central (vest si est) cu ceas
  const C = PARTS[2];
  const ccz = (C.z0 + C.z1) / 2;
  for (const s of [-1, 1]) {
    const x = s < 0 ? C.x0 - 0.12 : C.x1 + 0.12;
    const yb = C.h, hw = 5.2, ht = 2.6;
    const tri = [[x, yb, ccz - hw], [x, yb + ht, ccz], [x, yb, ccz + hw]];
    const geo = triGeo(s < 0 ? [tri[0], tri[2], tri[1]] : [tri[0], tri[1], tri[2]]);
    B.add(M.plaster, geo);
    B.add(M.plaster, triGeo(s < 0 ? [tri[0], tri[1], tri[2]] : [tri[0], tri[2], tri[1]]).translate(-s * 2.0, 0, 0));
    // grosimea frontonului: doua fete + acoperis
    B.box(M.plasterTrim, x, yb + 0.12, ccz, 0.5, 0.25, hw * 2 + 0.4);
    const L = Math.hypot(hw, ht), a = Math.atan2(ht, hw);
    B.box(M.plasterTrim, x - s * 1.0, yb + ht / 2 + 0.15, ccz - hw / 2, 2.4, 0.3, L + 0.3, 0, 0, -a);
    B.box(M.plasterTrim, x - s * 1.0, yb + ht / 2 + 0.15, ccz + hw / 2, 2.4, 0.3, L + 0.3, 0, 0, a);
    // usi / ferestre inalte la parter
    for (const dz of [-5.2, 0, 5.2]) {
      B.box(M.plasterTrim, x + s * 0.02, 2.4, ccz + dz, 0.16, 4.2, 2.6);
      B.add(M.histWindow, panelGeo(2.0, 3.6), x + s * 0.12, 2.2, ccz + dz, s > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  // Porticul de pe peron (stalpi patrati + copertina plana)
  const PX = 13.7;
  for (let z = -46.5; z <= 42.5; z += 4.0) {
    const T = Math.abs(z - (PASSAGE.z0 + PASSAGE.z1) / 2) < 3.4 ? BT : B; // in dreptul pasajului: stalpi doar azi
    T.box(M.plasterTrim, PX, 2.25, z, 0.55, 4.5, 0.55);
    T.box(M.plinth, PX, (PLAT_Y + 0.5) / 2, z, 0.7, PLAT_Y + 0.5, 0.7);
  }
  B.aabb(M.plaster, 9.8, 4.45, -47.2, 14.25, 4.85, 43.2);
  B.aabb(M.plasterTrim, 14.0, 4.3, -47.2, 14.35, 5.0, 43.2);

  // Pasaj: pardoseala in panta + tavan luminos
  const ramp = triGeo([
    [PASSAGE.x0, PASSAGE.yIn + 0.01, PASSAGE.z0], [PASSAGE.x1, PASSAGE.yOut + 0.01, PASSAGE.z1], [PASSAGE.x1, PASSAGE.yOut + 0.01, PASSAGE.z0],
    [PASSAGE.x0, PASSAGE.yIn + 0.01, PASSAGE.z0], [PASSAGE.x0, PASSAGE.yIn + 0.01, PASSAGE.z1], [PASSAGE.x1, PASSAGE.yOut + 0.01, PASSAGE.z1],
  ], [[0, 0], [8, 3], [8, 0], [0, 0], [0, 3], [8, 3]]);
  BF.add(M.terrazzo, ramp);
  BF.aabb(M.ledCool, PASSAGE.x0 + 0.5, PASSAGE.hClear + 0.5, -29.15, PASSAGE.x1 - 0.5, PASSAGE.hClear + 0.58, -28.85);
  PF.ramp(PASSAGE.x0 - 0.2, -29, PASSAGE.yIn, PASSAGE.x1 + 0.2, -29, PASSAGE.yOut, 6);

  const meshes = B.build(group);
  const phys = P.build(group);
  BF.build(passGroup); BT.build(plugGroup);
  const physF = PF.build(passGroup), physT = PT.build(plugGroup);

  // Inscriptii „PAȘCANI” + ceasuri
  const letTex = lettering('PAȘCANI', { color: '#2f3a4a' });
  const letMat = new THREE.MeshStandardMaterial({ map: letTex, transparent: true, alphaTest: 0.35, roughness: 0.5, metalness: 0.4 });
  const L = new Batch('litere');
  L.add(letMat, panelGeo(9, 1.4), C.x0 - 0.2, 9.3, ccz, -Math.PI / 2);
  L.add(letMat, panelGeo(9, 1.4), C.x1 + 0.2, 9.3, ccz, Math.PI / 2);
  L.build(group, { cast: false });
  const clock = createClock();
  const clockMat = new THREE.MeshStandardMaterial({ map: clock.texture, emissive: 0xffffff, emissiveMap: clock.texture, emissiveIntensity: 0.1, roughness: 0.4 });
  const K = new Batch('ceas');
  const cg = () => new THREE.CircleGeometry(0.85, 32);
  K.add(clockMat, cg(), C.x0 - 0.35, C.h + 0.95, ccz, -Math.PI / 2);
  K.add(clockMat, cg(), C.x1 + 0.35, C.h + 0.95, ccz, Math.PI / 2);
  K.add(M.dark, new THREE.CylinderGeometry(0.95, 0.95, 0.12, 32), C.x0 - 0.26, C.h + 0.95, ccz, 0, 0, Math.PI / 2);
  K.add(M.dark, new THREE.CylinderGeometry(0.95, 0.95, 0.12, 32), C.x1 + 0.26, C.h + 0.95, ccz, 0, 0, Math.PI / 2);
  K.build(group, { cast: false });

  const fresh = { plaster: 0xf3eee3, trim: 0xdccfb4, roof: 0x5c6670 };
  const old = { plaster: 0xc4bcae, trim: 0xb5ab98, roof: 0x6e6a63 };
  function setFuture(on) {
    passGroup.visible = on;
    plugGroup.visible = !on;
    const c = on ? fresh : old;
    M.plaster.color.setHex(c.plaster);
    M.plaster.map = on ? null : M.textures.facadeOld;
    M.plaster.needsUpdate = true;
    M.plasterTrim.color.setHex(c.trim);
    M.roof.color.setHex(c.roof);
    M.roof.roughness = on ? 0.55 : 0.85;
  }
  return {
    group, meshes, phys, physF, physT,
    update(hour, night) { clock.draw(hour); clockMat.emissiveIntensity = 0.1 + night * 1.2; },
    setFuture,
  };
}
