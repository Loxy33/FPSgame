import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RawModelName, assets } from '../render/assets';
import { UVK, chamferBox } from '../render/geo';
import { makeFlashTexture, makeGunTextures, makeReticleTexture } from '../render/textures';
import { HandPose, handPose } from './arms';
import { ATTACHMENTS, loadLoadout } from './attachments';
import { WEAPONS, type SlotName, type WeaponDef, type WeaponId } from './weapons';

// ---------------------------------------------------------------------------
// First-person weapons: parts merged per material, barrel toward -Z.
// Scanned CC0 models for the M4A1 and the service pistol, hard-surface builds for
// the AKM / AUG / AN-94 / Glock, plus detachable attachment meshes per slot.
// ---------------------------------------------------------------------------
const ONE = new THREE.Vector3(1, 1, 1);

class Parts {
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.q.setFromEuler(new THREE.Euler(rx, ry, rz));
    geo.applyMatrix4(this.m.compose(new THREE.Vector3(x, y, z), this.q, ONE));
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(geo);
    return this;
  }
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    return this.add(mat, chamferBox(w, h, d), x, y, z, rx, ry, rz);
  }
  cyl(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z', segs = 14, rx = 0, ry = 0, rz = 0, rTop = r) {
    const g = new THREE.CylinderGeometry(rTop, r, len, segs, 1);
    const uv = g.attributes.uv;
    const ku = Math.max(1, Math.round(Math.PI * 2 * Math.max(r, rTop) * UVK)), kv = len * UVK;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    return this.add(mat, g, x, y, z, rx, ry, rz);
  }
  /** Hollow open-ended tube along Z so reflex optics are genuinely see-through. */
  tube(mat: THREE.Material, innerMat: THREE.Material, rOuter: number, rInner: number, len: number, x: number, y: number, z: number, segs = 22) {
    const outer = new THREE.CylinderGeometry(rOuter, rOuter, len, segs, 1, true);
    outer.rotateX(Math.PI / 2);
    this.add(mat, outer, x, y, z);

    const inner = new THREE.CylinderGeometry(rInner, rInner, len, segs, 1, true);
    inner.rotateX(Math.PI / 2);
    const nor = inner.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
    const idx = inner.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1), c = idx.getX(i + 2);
      idx.setX(i + 1, c);
      idx.setX(i + 2, b);
    }
    this.add(innerMat, inner, x, y, z);

    const frontRing = new THREE.RingGeometry(rInner, rOuter, segs);
    frontRing.rotateY(Math.PI);
    this.add(mat, frontRing, x, y, z - len * 0.5);

    const rearRing = new THREE.RingGeometry(rInner, rOuter, segs);
    this.add(mat, rearRing, x, y, z + len * 0.5);
    return this;
  }
  build() {
    const group = new THREE.Group();
    for (const [mat, list] of this.lists) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      for (const g of list) g.dispose();
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return group;
  }
}

interface Mats {
  gun: THREE.Material;
  steel: THREE.Material;
  poly: THREE.Material;
  bore: THREE.Material;
  brass: THREE.Material;
  lens: THREE.Material;
  reticle: THREE.Material;
  laserDot: THREE.Material;
  laserBeam: THREE.Material;
  flash: THREE.Material;
  wood: THREE.Material;
  tan: THREE.Material;
}

function makeMats(): Mats {
  const det = makeGunTextures();
  const hard = (color: number, metalness: number, roughness: number, normal: number) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, map: det.map, roughnessMap: det.roughnessMap, normalMap: det.normalMap, normalScale: new THREE.Vector2(normal, normal) });
  const plain = (color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, map: det.map, roughnessMap: det.roughnessMap, normalMap: det.normalMap });
  return {
    gun: hard(0x24272b, 0.72, 0.38, 0.45),
    steel: hard(0x3a3f46, 0.86, 0.28, 0.35),
    poly: hard(0x1b1d20, 0.08, 0.74, 0.75),
    bore: new THREE.MeshBasicMaterial({ color: 0x050506 }),
    brass: hard(0xb8924a, 0.85, 0.3, 0.25),
    wood: plain(0x6d4a2a, 0.78),
    tan: plain(0x7c6e54, 0.68, 0.08),
    lens: new THREE.MeshStandardMaterial({ color: 0x5ca8d6, metalness: 0.92, roughness: 0.04, transparent: true, opacity: 0.11, envMapIntensity: 1.5, depthWrite: false }),
    reticle: new THREE.MeshBasicMaterial({ map: makeReticleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color().setRGB(3.0, 0.42, 0.28), fog: false }),
    laserDot: new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.5, 0.3, 0.25), fog: false }),
    laserBeam: new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 0.2, 0.18), transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    flash: new THREE.MeshBasicMaterial({ map: makeFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color().setRGB(3.2, 2.4, 1.4), side: THREE.DoubleSide, fog: false }),
  };
}

export interface GunModel {
  def: WeaponDef;
  group: THREE.Group;
  mag: THREE.Object3D;
  action: THREE.Object3D;
  actionZ: number;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  poseL: HandPose;
  poseR: HandPose;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  flash: THREE.Group;
  /** Mounted attachment meshes by slot. */
  parts: Partial<Record<SlotName, THREE.Group>>;
  /** Rebuilds the mounted meshes from def.fitted and realigns the sights. */
  refit(): void;
}

function makeFlash(M: Mats, size: number) {
  const g = new THREE.Group();
  g.name = 'flash';
  const geo = new THREE.PlaneGeometry(size, size);
  const a = new THREE.Mesh(geo, M.flash);
  a.rotation.y = Math.PI / 2;
  const b = new THREE.Mesh(geo, M.flash);
  b.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.9, size * 0.9), M.flash);
  for (const m of [a, b, c]) {
    m.renderOrder = 10;
    m.frustumCulled = false;
  }
  a.position.z = b.position.z = -size * 0.42;
  g.add(a, b, c);
  g.visible = false;
  return g;
}

function load(name: RawModelName, rotY: number, x: number, y: number, z: number) {
  const group = new THREE.Group();
  const holder = new THREE.Group();
  const body = assets.gltf[name].scene.clone(true);
  holder.rotation.y = rotY;
  holder.position.set(x, y, z);
  holder.add(body);
  group.add(holder);
  group.updateMatrixWorld(true);
  body.traverse((o) => { o.frustumCulled = false; });
  return { group, body };
}

function meshes(body: THREE.Object3D, re: RegExp) {
  const out: THREE.Mesh[] = [];
  body.traverse((o) => {
    // hidden nodes are pack extras (spare magazines, alternate sights) and must not be picked up
    if (!o.visible) return;
    if ((o as THREE.Mesh).isMesh && (re.test(o.name) || (o.parent !== null && re.test(o.parent.name)))) out.push(o as THREE.Mesh);
  });
  return out;
}

function hide(body: THREE.Object3D, re: RegExp) {
  for (const m of meshes(body, re)) m.visible = false;
}

function take(group: THREE.Group, body: THREE.Object3D, re: RegExp, pivot?: THREE.Vector3) {
  const g = new THREE.Group();
  if (pivot) g.position.copy(pivot);
  group.add(g);
  g.updateMatrixWorld(true);
  for (const m of meshes(body, re)) g.attach(m);
  return g;
}

/** Meshes for one attachment option, in gun space (anchor-relative). */
function attachmentMesh(id: string, M: Mats, def: WeaponDef): THREE.Group | null {
  const a = ATTACHMENTS[id];
  if (!a) return null;
  const g = new THREE.Group();
  const p = new Parts();
  const pistol = def.family === 'pistol';
  switch (id) {
    case 'reddot': {
      // Aimpoint Micro T-2 style reflex red-dot on lower-1/3 skeletonized riser (100% unobstructed view)
      const h = a.sightH ?? 0.036;
      const tubeR = 0.0145;
      const baseH = Math.max(0.01, h - tubeR - 0.006);
      // Picatinny rail clamp base + locking bar + brass cross-bolt
      p.box(M.gun, 0.03, 0.008, 0.048, 0, 0.004, 0);
      p.box(M.steel, 0.034, 0.005, 0.042, -0.002, 0.0025, 0);
      p.cyl(M.brass, 0.0032, 0.036, 0, 0.004, 0.008, 'x', 10);
      p.cyl(M.steel, 0.005, 0.004, 0.017, 0.004, -0.008, 'x', 6);
      // Skeletonized riser legs connecting rail clamp to tube saddle (below the open aperture)
      p.box(M.gun, 0.022, baseH, 0.012, 0, 0.007 + baseH * 0.5, -0.013, 0.06);
      p.box(M.gun, 0.022, baseH, 0.012, 0, 0.007 + baseH * 0.5, 0.013, -0.06);
      p.box(M.poly, 0.024, 0.005, 0.044, 0, h - tubeR - 0.001, 0);
      // Hollow see-through cylindrical optic housing + front/rear objective lip rings
      p.tube(M.gun, M.bore, 0.0168, 0.0142, 0.052, 0, h, 0, 24);
      p.tube(M.gun, M.bore, 0.0184, 0.0142, 0.01, 0, h, -0.023, 24);
      p.tube(M.gun, M.bore, 0.018, 0.0142, 0.009, 0, h, 0.023, 24);
      // Top elevation turret, right windage turret & angled rotary brightness rheostat
      p.cyl(M.steel, 0.0055, 0.0055, 0, h + 0.018, -0.002, 'y', 12);
      p.cyl(M.steel, 0.0055, 0.0055, 0.018, h, -0.002, 'x', 12);
      p.cyl(M.gun, 0.0075, 0.0065, 0.015, h + 0.011, 0.008, 'x', 14, 0, 0, -0.6);
      // Single ultra-clear tinted glass lens inside the hollow tube
      p.cyl(M.lens, 0.014, 0.001, 0, h, -0.012, 'z', 20);
      break;
    }
    case 'holo': {
      // EOTech EXPS3 / PLA QMK-152 holographic weapon sight on QD riser (100% open window, ZERO center bar)
      const h = a.sightH ?? 0.038;
      const winY = h;
      const winH = 0.026;
      const baseTop = winY - winH * 0.5 - 0.003;
      // QD Picatinny rail riser base + throw lever on left side + cross-bolt
      p.box(M.gun, 0.034, 0.011, 0.076, 0, 0.0055, 0.002);
      p.box(M.steel, 0.0045, 0.007, 0.038, -0.019, 0.0055, 0.005, 0, 0.08, 0);
      p.cyl(M.brass, 0.003, 0.038, 0, 0.0055, -0.02, 'x', 10);
      // Low-profile electronics housing & front transverse CR123 battery compartment (cleanly below window!)
      const elecH = Math.max(0.008, baseTop - 0.008);
      p.box(M.poly, 0.04, elecH, 0.072, 0, 0.008 + elecH * 0.5, 0.003);
      p.cyl(M.gun, 0.0085, 0.044, 0, baseTop - 0.004, -0.025, 'x', 14);
      p.cyl(M.steel, 0.0095, 0.004, 0.023, baseTop - 0.004, -0.025, 'x', 12);
      // Rugged outer aluminum protective hood (100% hollow open optical window)
      const hoodH = 0.034;
      p.box(M.gun, 0.0045, hoodH, 0.048, -0.0215, winY, 0.006);
      p.box(M.gun, 0.0045, hoodH, 0.048, 0.0215, winY, 0.006);
      p.box(M.gun, 0.0475, 0.0045, 0.048, 0, winY + hoodH * 0.5, 0.006);
      // Exterior side reinforcement lugs (strictly outside the left/right hood walls, never crossing the glass!)
      p.box(M.steel, 0.0035, 0.007, 0.014, -0.0245, winY - 0.004, 0.006);
      p.box(M.steel, 0.0035, 0.007, 0.014, 0.0245, winY - 0.004, 0.006);
      // Slim inner optical bezel frame
      p.box(M.poly, 0.0026, winH + 0.002, 0.034, -0.017, winY, 0.006);
      p.box(M.poly, 0.0026, winH + 0.002, 0.034, 0.017, winY, 0.006);
      p.box(M.poly, 0.036, 0.003, 0.034, 0, winY + winH * 0.5 + 0.001, 0.006);
      p.box(M.poly, 0.036, 0.0035, 0.034, 0, winY - winH * 0.5 - 0.001, 0.006);
      // Rear NV / brightness control buttons below window
      p.box(M.steel, 0.007, 0.0055, 0.0035, -0.007, baseTop - 0.003, 0.04);
      p.box(M.steel, 0.007, 0.0055, 0.0035, 0.007, baseTop - 0.003, 0.04);
      // Ultra-clear tinted glass pane inside the unobstructed hollow window
      p.box(M.lens, 0.031, winH - 0.001, 0.001, 0, winY, 0.002);
      break;
    }
    case 'scope4x': {
      // Tactical 4x prism / LPVO rifle scope with dual cantilever ring mounts & recessed lenses
      const h = a.sightH ?? 0.036;
      const ringBaseH = Math.max(0.008, h - 0.018);
      // Cantilever Picatinny mount rail base + thumb nuts
      p.box(M.gun, 0.03, 0.009, 0.13, 0, 0.0045, 0.005);
      for (const rz of [-0.044, 0.048]) {
        p.cyl(M.brass, 0.0036, 0.038, 0, 0.005, rz, 'x', 10);
        p.box(M.gun, 0.022, ringBaseH, 0.02, 0, 0.008 + ringBaseH * 0.5, rz);
        p.cyl(M.gun, 0.0195, 0.02, 0, h, rz, 'z', 18);
        p.box(M.steel, 0.043, 0.0045, 0.016, 0, h, rz);
      }
      // 30mm main tube
      p.cyl(M.gun, 0.015, 0.18, 0, h, 0, 'z', 20);
      // Flared objective bell (front, -Z) + hollow sunshade bezel
      p.cyl(M.gun, 0.015, 0.034, 0, h, -0.092, 'z', 20, 0, 0, 0, 0.0235);
      p.cyl(M.gun, 0.0235, 0.038, 0, h, -0.126, 'z', 20);
      p.tube(M.steel, M.bore, 0.024, 0.0205, 0.016, 0, h, -0.151, 20);
      // Ocular housing (rear, +Z) + zoom throw lever + hollow diopter ring
      p.cyl(M.gun, 0.0205, 0.03, 0, h, 0.086, 'z', 20, 0, 0, 0, 0.015);
      p.cyl(M.gun, 0.021, 0.036, 0, h, 0.118, 'z', 20);
      p.cyl(M.poly, 0.0225, 0.011, 0, h, 0.096, 'z', 18);
      p.box(M.steel, 0.0055, 0.018, 0.008, -0.021, h + 0.013, 0.096, 0, 0, 0.65);
      p.tube(M.poly, M.bore, 0.0215, 0.018, 0.014, 0, h, 0.141, 20);
      // Center saddle block + elevation (top), windage (right), illumination (left) turrets
      p.cyl(M.gun, 0.0185, 0.03, 0, h, 0.002, 'z', 16);
      p.cyl(M.gun, 0.01, 0.014, 0, h + 0.02, 0.002, 'y', 14);
      p.cyl(M.brass, 0.0106, 0.0035, 0, h + 0.028, 0.002, 'y', 14);
      p.cyl(M.gun, 0.01, 0.014, 0.02, h, 0.002, 'x', 14);
      p.cyl(M.brass, 0.0106, 0.0035, 0.028, h, 0.002, 'x', 14);
      p.cyl(M.gun, 0.009, 0.011, -0.019, h, 0.002, 'x', 14);
      // Dark interior backing + coated objective & ocular lenses (unobstructed)
      p.cyl(M.bore, 0.0202, 0.002, 0, h, -0.145, 'z', 20);
      p.cyl(M.lens, 0.0202, 0.0012, 0, h, -0.147, 'z', 20);
      p.cyl(M.bore, 0.0178, 0.002, 0, h, 0.136, 'z', 20);
      p.cyl(M.lens, 0.0178, 0.0012, 0, h, 0.138, 'z', 20);
      break;
    }
    case 'comp': {
      // Tactical dual-chamber muzzle brake / compensator
      const s = pistol ? 0.78 : 1.0;
      // Threaded barrel adapter collar + wrench flat
      p.cyl(M.steel, 0.011 * s, 0.026 * s, 0, 0, 0.012 * s, 'z', 14);
      p.box(M.steel, 0.024 * s, 0.022 * s, 0.012 * s, 0, 0, -0.003 * s);
      // Main machined brake body + side expansion baffles
      p.box(M.gun, 0.028 * s, 0.025 * s, 0.058 * s, 0, 0, -0.036 * s);
      p.cyl(M.gun, 0.0145 * s, 0.06 * s, 0, 0, -0.036 * s, 'z', 16);
      // Side gas ports & top recoil compensation vents (dark bore interior)
      for (const cz of [-0.024 * s, -0.046 * s]) {
        p.box(M.bore, 0.03 * s, 0.013 * s, 0.013 * s, 0, 0, cz);
        p.box(M.bore, 0.01 * s, 0.027 * s, 0.009 * s, 0, 0.002 * s, cz);
      }
      // Front crown + dark bore exit
      p.cyl(M.steel, 0.0135 * s, 0.006 * s, 0, 0, -0.067 * s, 'z', 16);
      p.cyl(M.bore, 0.0085 * s, 0.072 * s, 0, 0, -0.035 * s, 'z', 12);
      break;
    }
    case 'supp': {
      // Quick-detach tactical suppressor (SureFire SOCOM / Osprey cylindrical style)
      const s = pistol ? 0.8 : 1.0;
      // Barrel thread shoulder + QD locking collar with knurled ring
      p.cyl(M.steel, 0.0115 * s, 0.028 * s, 0, 0, 0.012 * s, 'z', 16);
      p.cyl(M.steel, 0.019 * s, 0.022 * s, 0, 0, -0.008 * s, 'z', 18);
      p.cyl(M.poly, 0.0205 * s, 0.01 * s, 0, 0, -0.014 * s, 'z', 18);
      // Main suppressor tube
      p.cyl(M.gun, 0.0215 * s, 0.155 * s, 0, 0, -0.095 * s, 'z', 20);
      // Heat-dissipation ribs & weld rings along the body
      for (let i = 0; i < 4; i++) {
        p.cyl(M.poly, 0.0226 * s, 0.007 * s, 0, 0, (-0.042 - i * 0.028) * s, 'z', 20);
      }
      // Distal endcap + recessed bore aperture
      p.cyl(M.steel, 0.0205 * s, 0.012 * s, 0, 0, -0.176 * s, 'z', 20);
      p.cyl(M.bore, 0.009 * s, 0.016 * s, 0, 0, -0.176 * s, 'z', 14);
      break;
    }
    case 'angled': {
      // Magpul AFG2 style ergonomic angled foregrip (origin at bottom of handguard rail)
      // Low-profile Picatinny rail channel clamp + cross-bolts
      p.box(M.gun, 0.034, 0.014, 0.11, 0, 0.002, 0);
      p.cyl(M.brass, 0.003, 0.038, 0, 0.001, -0.034, 'x', 10);
      p.cyl(M.brass, 0.003, 0.038, 0, 0.001, 0.034, 'x', 10);
      // Forward index-finger stop hook
      p.box(M.poly, 0.03, 0.026, 0.018, 0, -0.014, -0.046, -0.25);
      // Main angled grip ramp + rear palm swell
      p.box(M.poly, 0.031, 0.024, 0.092, 0, -0.022, 0.004, 0.36);
      p.box(M.poly, 0.029, 0.03, 0.032, 0, -0.026, 0.036, 0.12);
      // Non-slip horizontal grip serrations along the angled ramp
      for (let i = 0; i < 5; i++) {
        const t = i - 2;
        p.box(M.gun, 0.033, 0.004, 0.006, 0, -0.024 - t * 0.0055, 0.002 + t * 0.014, 0.36);
      }
      break;
    }
    case 'vertical': {
      // BCM Gunfighter / TangoDown stubby vertical foregrip (origin at bottom of handguard rail)
      // Picatinny rail locking clamp + thumbscrew
      p.box(M.gun, 0.036, 0.016, 0.052, 0, 0.003, 0);
      p.cyl(M.brass, 0.0038, 0.042, 0, 0.002, 0, 'x', 10);
      // Flared upper transition collar
      p.cyl(M.poly, 0.0165, 0.018, 0, -0.012, 0, 'y', 16, 0.08, 0, 0, 0.021);
      // Slightly forward-canted ergonomic cylindrical grip core
      p.cyl(M.poly, 0.0155, 0.072, 0, -0.052, -0.003, 'y', 16, 0.08, 0, 0, 0.017);
      // Rubberized horizontal grip grooves
      for (let i = 0; i < 4; i++) {
        p.cyl(M.gun, 0.0168, 0.005, 0, -0.03 - i * 0.014, -0.002 - i * 0.001, 'y', 16, 0.08);
      }
      // Waterproof storage endcap at bottom
      p.cyl(M.steel, 0.0145, 0.008, 0, -0.09, -0.006, 'y', 16, 0.08);
      break;
    }
    case 'ext': {
      // Extended magazine sleeve & flared tactical bumper pad (parented to mag node)
      if (pistol) {
        p.box(M.poly, 0.024, 0.036, 0.042, 0, -0.012, 0.004, 0.18);
        p.box(M.gun, 0.027, 0.01, 0.048, 0, -0.031, 0.008, 0.18);
      } else {
        // Upper overlap collar that hugs the bottom of the factory magazine
        p.box(M.poly, 0.03, 0.026, 0.068, 0, 0.006, 0.002, 0.12);
        // Extended body with anti-slip ribs
        p.box(M.poly, 0.031, 0.052, 0.07, 0, -0.026, 0.008, 0.16);
        for (let i = 0; i < 3; i++) {
          p.box(M.gun, 0.0335, 0.005, 0.056, 0, -0.012 - i * 0.014, 0.006 + i * 0.002, 0.16);
        }
        // Flared Ranger floorplate + pull loop base
        p.box(M.gun, 0.034, 0.012, 0.078, 0, -0.054, 0.013, 0.16);
      }
      break;
    }
    case 'long': {
      // Heavy match barrel extension + low-profile gas block & fluted heat sink
      p.cyl(M.gun, 0.0135, 0.035, 0, 0, 0.01, 'z', 16);
      // Low-profile gas block clamping the barrel
      p.box(M.steel, 0.024, 0.034, 0.032, 0, 0.006, -0.015);
      p.cyl(M.steel, 0.0045, 0.045, 0, 0.018, 0.012, 'z', 10);
      // Extended heavy barrel profile
      p.cyl(M.steel, 0.011, 0.155, 0, 0, -0.08, 'z', 16);
      // Barrel harmonic / heat-sink collars
      for (let i = 0; i < 3; i++) {
        p.cyl(M.gun, 0.0125, 0.012, 0, 0, -0.05 - i * 0.032, 'z', 16);
      }
      // Threaded muzzle shoulder + thread protector
      p.cyl(M.gun, 0.013, 0.02, 0, 0, -0.155, 'z', 16);
      p.cyl(M.bore, 0.0075, 0.01, 0, 0, -0.162, 'z', 12);
      break;
    }
    case 'short': {
      // CQB blast-forwarding shroud / compact barrel assembly
      p.cyl(M.steel, 0.014, 0.024, 0, 0, 0.012, 'z', 16);
      p.cyl(M.gun, 0.0185, 0.052, 0, 0, -0.016, 'z', 18);
      for (let i = 0; i < 3; i++) {
        p.cyl(M.poly, 0.0198, 0.005, 0, 0, -0.004 - i * 0.013, 'z', 18);
      }
      p.cyl(M.steel, 0.017, 0.006, 0, 0, -0.043, 'z', 16);
      p.cyl(M.bore, 0.011, 0.012, 0, 0, -0.044, 'z', 14);
      break;
    }
    case 'heavy': {
      // Precision adjustable marksman stock (cheek riser + dual steel guide rods + thick recoil pad)
      // Saddle cheek rest wrapping over the top of the stock comb
      p.box(M.poly, 0.046, 0.028, 0.115, 0, 0.032, -0.055);
      p.box(M.gun, 0.049, 0.018, 0.085, 0, 0.016, -0.055);
      p.cyl(M.brass, 0.0055, 0.054, 0, 0.014, -0.035, 'x', 12);
      p.cyl(M.brass, 0.0055, 0.054, 0, 0.014, -0.075, 'x', 12);
      // Lower stock reinforcement block + monopod rail
      p.box(M.poly, 0.042, 0.075, 0.07, 0, -0.024, -0.035);
      p.box(M.gun, 0.024, 0.01, 0.055, 0, -0.064, -0.038);
      // Dual steel LOP adjustment rods + heavy ribbed rubber buttpad
      p.cyl(M.steel, 0.005, 0.035, 0, 0.012, 0.01, 'z', 10);
      p.cyl(M.steel, 0.005, 0.035, 0, -0.038, 0.01, 'z', 10);
      p.box(M.gun, 0.046, 0.118, 0.014, 0, -0.01, 0.022);
      p.box(M.poly, 0.048, 0.122, 0.018, 0, -0.01, 0.036);
      break;
    }
    case 'light': {
      // Minimalist skeletonized stock frame + slim buttplate
      p.cyl(M.steel, 0.015, 0.07, 0, 0.018, -0.03, 'z', 14);
      // Angled skeleton lower strut connecting to the toe of the buttpad
      p.box(M.gun, 0.016, 0.014, 0.088, 0, -0.02, -0.022, -0.45);
      // Slim skeletonized buttplate + rubberized non-slip toe
      p.box(M.gun, 0.036, 0.105, 0.012, 0, -0.008, 0.014);
      p.box(M.poly, 0.038, 0.108, 0.01, 0, -0.008, 0.023);
      break;
    }
    case 'laser': {
      if (pistol) {
        // Compact under-barrel pistol rail laser (Streamlight TLR / SureFire X400 style)
        p.box(M.gun, 0.026, 0.012, 0.052, 0, 0.006, 0);
        p.cyl(M.brass, 0.0028, 0.03, 0, 0.006, 0.006, 'x', 10);
        p.box(M.poly, 0.028, 0.02, 0.056, 0, -0.008, -0.002);
        // Rear ambidextrous activation switches
        p.box(M.steel, 0.03, 0.012, 0.012, 0, -0.006, 0.028);
        // Laser emitter bezel & lens
        p.cyl(M.steel, 0.0075, 0.012, 0, -0.008, -0.032, 'z', 14);
        p.cyl(M.laserDot, 0.0032, 0.002, 0, -0.008, -0.038, 'z', 10);
      } else {
        // Side-mounted (3 o'clock rail) DBAL-A3 / tactical IR laser + weapon light module
        // Keeps top optical sightline 100% unobstructed on all rifles!
        p.box(M.gun, 0.009, 0.026, 0.056, 0.002, 0, 0);
        p.cyl(M.brass, 0.0032, 0.012, 0.003, 0.013, 0.004, 'y', 10);
        // Sleek low-profile side-rail laser & illuminator body
        p.box(M.gun, 0.022, 0.036, 0.076, 0.016, 0.002, 0);
        p.box(M.poly, 0.018, 0.018, 0.07, 0.018, -0.009, 0.002);
        // Side rotary mode dial & activation pad
        p.cyl(M.poly, 0.0085, 0.005, 0.028, 0.006, 0.012, 'x', 12);
        p.box(M.steel, 0.004, 0.012, 0.016, 0.028, 0.004, -0.014);
        // Dual front bezels: visible/IR laser (upper) + tactical flashlight lens (lower)
        p.cyl(M.steel, 0.0065, 0.014, 0.016, 0.01, -0.042, 'z', 12);
        p.cyl(M.laserDot, 0.003, 0.002, 0.016, 0.01, -0.049, 'z', 10);
        p.cyl(M.gun, 0.009, 0.018, 0.016, -0.008, -0.044, 'z', 14);
        p.cyl(M.lens, 0.0072, 0.002, 0.016, -0.008, -0.053, 'z', 12);
      }
      break;
    }
    default: {
      return null;
    }
  }
  const built = p.build();
  g.add(built);
  // Visible tactical laser beam (crossed additive planes extending forward along -Z)
  if (id === 'laser') {
    const lx = pistol ? 0 : 0.016;
    const ly = pistol ? -0.008 : 0.01;
    const lz = pistol ? -0.04 : -0.05;
    const beamLen = 1.65;
    const beamGeo = new THREE.PlaneGeometry(0.0032, beamLen);
    beamGeo.rotateX(Math.PI / 2);
    const b1 = new THREE.Mesh(beamGeo, M.laserBeam);
    b1.name = 'laserBeam';
    b1.position.set(lx, ly, lz - beamLen * 0.5);
    const b2 = new THREE.Mesh(beamGeo.clone().rotateZ(Math.PI / 2), M.laserBeam);
    b2.name = 'laserBeam';
    b2.position.set(lx, ly, lz - beamLen * 0.5);
    b1.renderOrder = b2.renderOrder = 8;
    b1.frustumCulled = b2.frustumCulled = false;
    g.add(b1, b2);
  }
  // the reticle lives on the optical axis so ADS lines it up with the crosshair
  if (id === 'reddot' || id === 'holo' || id === 'scope4x') {
    const h = a.sightH ?? 0.028;
    const size = id === 'scope4x' ? 0.024 : id === 'holo' ? 0.022 : 0.0068;
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(size, size), M.reticle);
    ret.position.set(0, h, id === 'scope4x' ? 0.139 : 0.004);
    ret.renderOrder = 2;
    ret.frustumCulled = false;
    g.add(ret);
  }
  return g;
}

function finish(M: Mats, def: WeaponDef, group: THREE.Group, mag: THREE.Object3D, action: THREE.Object3D, actionZ: number,
  muzzle: [number, number, number], eject: [number, number, number], flashSize: number, poseR: HandPose, poseL: HandPose): GunModel {
  const mz = new THREE.Object3D();
  mz.position.fromArray(muzzle);
  const ej = new THREE.Object3D();
  ej.position.fromArray(eject);
  const flash = makeFlash(M, flashSize);
  flash.position.copy(mz.position);
  const leftArm = new THREE.Group(), rightArm = new THREE.Group();
  group.add(mz, ej, flash, leftArm, rightArm);
  const parts: Partial<Record<SlotName, THREE.Group>> = {};
  const baseMuzzleZ = def.anchors.muzzle?.[2] ?? muzzle[2];
  const baseAdsZ = def.adsPos[2];
  const baseHipZ = def.hipPos[2];
  const basePoseL = {
    pos: poseL.pos.clone(),
    fwd: poseL.fwd.clone(),
    palm: poseL.palm.clone(),
    elbow: poseL.elbow.clone(),
    curl: [...poseL.curl],
  };
  const model: GunModel = {
    def, group, mag, action, actionZ, leftArm, rightArm, poseL: poseL, poseR: poseR, muzzle: mz, eject: ej, flash, parts,
    refit() {
      // Shift muzzle anchor dynamically when a long or short barrel is fitted so muzzle attachments never clip
      const barrelShift = def.fitted.barrel === 'long' ? -0.15 : def.fitted.barrel === 'short' ? -0.032 : 0;
      if (def.anchors.muzzle) {
        def.anchors.muzzle[2] = baseMuzzleZ + barrelShift;
      }

      for (const slot of def.slots) {
        const old = parts[slot];
        if (old) {
          old.parent?.remove(old);
          old.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) mesh.geometry.dispose();
          });
          delete parts[slot];
        }
        const id = def.fitted[slot];
        if (!id) continue;
        // AWM ships with a high-power built-in 8x sniper scope (Body_1/lambert2 + GlassGeometry):
        // show the native scope ONLY when 'scope8x' is fitted, and hide it completely when swapping
        // to 4x / holo / reddot / flip-up irons so bolt-on optics sit flush on the receiver rail!
        if (slot === 'optic' && def.id === 'awm') {
          const useBuiltInScope = id === 'scope8x';
          group.traverse((o) => {
            if (o.userData?.awmNativeScope) {
              o.visible = useBuiltInScope;
            }
          });
          if (useBuiltInScope) continue;
        }
        const mesh = attachmentMesh(id, M, def);
        if (!mesh) continue;
        const anchor = def.anchors[slot];
        if (anchor) mesh.position.fromArray(anchor);
        if (slot === 'muzzle') mesh.rotation.set(0, 0, 0);
        // Attach extended magazine directly to the animated `mag` group so it drops & hides during reloads
        if (slot === 'mag') {
          mag.add(mesh);
        } else {
          group.add(mesh);
        }
        parts[slot] = mesh;
      }

      // Adjust support-hand pose when a vertical or angled foregrip is fitted
      if (def.family !== 'pistol') {
        const gripId = def.fitted.grip;
        const gripAnchor = def.anchors.grip;
        if (gripId === 'vertical' && gripAnchor) {
          poseL.pos.set(basePoseL.pos.x - 0.01, gripAnchor[1] - 0.052, gripAnchor[2] + 0.015);
          poseL.fwd.set(0.1, 0.18, -0.98).normalize();
          poseL.palm.set(0.85, 0.45, 0.25).normalize();
          poseL.curl = [0.35, 0.75, 0.82, 0.84, 0.84];
        } else if (gripId === 'angled' && gripAnchor) {
          poseL.pos.set(basePoseL.pos.x - 0.01, gripAnchor[1] - 0.024, gripAnchor[2] + 0.015);
          poseL.fwd.set(0.08, 0.32, -0.94).normalize();
          poseL.palm.set(0.24, 0.94, -0.22).normalize();
          poseL.curl = [0.28, 0.68, 0.74, 0.76, 0.76];
        } else {
          poseL.pos.copy(basePoseL.pos);
          poseL.fwd.copy(basePoseL.fwd);
          poseL.palm.copy(basePoseL.palm);
          poseL.elbow.copy(basePoseL.elbow);
          poseL.curl = [...basePoseL.curl];
        }
      }

      // Line up whatever sight is fitted: irons use the weapon's measured iron-sight elevation,
      // AWM's native 8x scope uses its authored sightY, and bolt-on optics sit on the rail + sightH.
      const optId = def.slots.includes('optic')
        ? (def.fitted.optic || (def.id === 'awm' ? 'scope8x' : 'irons'))
        : 'irons';
      const opt = ATTACHMENTS[optId];
      const railY = def.anchors.optic?.[1] ?? def.sightY;
      const aimY = (def.id === 'awm' && optId === 'scope8x')
        ? def.sightY
        : optId === 'irons'
          ? (def.id === 'awm' ? railY + 0.022 : def.sightY)
          : railY + (opt?.sightH ?? 0.036);
      // Fold or hide iron sights (both rear and front!) when a bolt-on optic is fitted so nothing obstructs the glass,
      // and show AK's rail adapter only with optics.
      const hideIrons = optId !== 'irons';
      group.traverse((o) => {
        if (/RearIronSight|FrontIronSight|(rear|front).*(iron|sight)/i.test(o.name)) o.visible = !hideIrons;
        if (/opticrailadapter/i.test(o.name)) o.visible = hideIrons;
      });
      def.adsPos[1] = -aimY + 0.002;
      // Consistent AAA cheek-weld eye relief for every mounted optic (keeps optic window close & readable across all rifles/SMGs)
      const railZ = def.anchors.optic?.[2];
      if (railZ !== undefined && optId !== 'irons' && !(def.id === 'awm' && optId === 'scope8x')) {
        const eyeRelief = optId === 'holo' ? 0.185 : optId === 'reddot' ? 0.175 : 0.24;
        def.adsPos[2] = -eyeRelief - railZ;
      } else {
        def.adsPos[2] = baseAdsZ;
      }
      const ho = def.hipOffset ?? (def.family === 'pistol' ? [0.11, -0.075, -0.14] : [0.125, -0.065, -0.18]);
      def.hipPos = [
        def.adsPos[0] + ho[0],
        Math.min(-0.04, Math.max(-0.24, -def.sightY + ho[1])),
        baseHipZ,
      ];
      // Update muzzle flash position for barrel + muzzle combinations
      const mzAnchor = def.anchors.muzzle;
      const mzExtra = def.fitted.muzzle === 'supp' ? -0.18 : def.fitted.muzzle === 'comp' ? -0.068 : -0.015;
      mz.position.set(mzAnchor?.[0] ?? 0, mzAnchor?.[1] ?? muzzle[1], (mzAnchor?.[2] ?? muzzle[2]) + mzExtra);
      flash.position.copy(mz.position);
      def.scope = !!opt?.mods?.scope;
    },
  };
  model.refit();
  return model;
}

// ---------------------------------------------------------------------------
// M4A1 — scanned CC0 model, factory optic stripped (attachments provide sights)
// ---------------------------------------------------------------------------
function buildM4(M: Mats, def: WeaponDef): GunModel {
  const { group, body } = load('wpn_m4a1', 0, 0, 0.003, -0.012);
  hide(body, /^(Sight|Switch)/);
  const mag = take(group, body, /^Magazine/);
  const action = take(group, body, /^Ejector_2/);
  const g = new Parts();
  // top rail so bolt-on optics have something to sit on
  g.box(M.gun, 0.04, 0.012, 0.3, 0, 0.066, -0.075);
  for (let i = 0; i < 12; i++) g.box(M.poly, 0.036, 0.004, 0.008, 0, 0.072, -0.2 + i * 0.022);
  // rear irons (folded flat when an optic is fitted, kept for irons-only builds)
  g.box(M.gun, 0.03, 0.014, 0.02, 0, 0.078, 0.05);
  const rail = g.build();
  group.add(rail);
  return finish(M, def, group, mag, action, 0, [0, 0.028, -0.555], [0.03, 0.028, -0.045], 0.26,
    handPose([0.03, -0.11, 0.135], [-0.1, 0.3, -1], [-0.85, 0, -0.5], [0.125, -0.31, 0.44], [0.35, 0.55, 1.15, 1.2, 1.25]),
    handPose([-0.075, -0.05, -0.2], [1, 0.2, -0.35], [0.1, 1, 0], [-0.29, -0.3, 0.1], [0.2, 0.9, 0.95, 1.0, 1.0]));
}

// ---------------------------------------------------------------------------
// Scanned service pistol (USP)
// ---------------------------------------------------------------------------
function buildPistolScan(M: Mats, def: WeaponDef): GunModel {
  const { group, body } = load('wpn_pistol', Math.PI / 2, 0, -0.05, 0);
  hide(body, /_b$|magazine_empty|bullet/);
  const action = take(group, body, /slide_a/);
  const mag = take(group, body, /magazine_loaded/);
  for (const c of mag.children) c.position.z -= 0.085;
  const top = new THREE.Box3().setFromObject(action).max.y;
  def.adsPos[0] = 0;
  void top;
  return finish(M, def, group, mag, action, 0, [0, 0.018, -0.175], [0.02, 0.025, -0.03], 0.17,
    handPose([0.028, -0.07, 0.085], [-0.1, 0.3, -1], [-0.85, 0, -0.5], [0.14, -0.26, 0.42], [0.35, 0.5, 1.15, 1.2, 1.25]),
    handPose([-0.05, -0.085, 0.07], [0.3, 0.3, -1], [1, 0, -0.25], [-0.26, -0.27, 0.4], [0.3, 1.0, 1.05, 1.1, 1.1]));
}

// ---------------------------------------------------------------------------
// AKM
// ---------------------------------------------------------------------------
function buildAkm(M: Mats, def: WeaponDef): GunModel {
  const g = new Parts();
  const group = new THREE.Group();
  // receiver + dust cover
  g.box(M.gun, 0.05, 0.075, 0.3, 0, 0, -0.06);
  g.cyl(M.gun, 0.025, 0.22, 0, 0.045, -0.06, 'z', 12);
  // barrel, gas tube, gas block, front sight
  g.cyl(M.gun, 0.011, 0.3, 0, 0.02, -0.33, 'z', 12);
  g.cyl(M.gun, 0.008, 0.2, 0, 0.048, -0.3, 'z', 10);
  g.box(M.gun, 0.028, 0.05, 0.05, 0, 0.032, -0.42);
  g.box(M.gun, 0.018, 0.05, 0.016, 0, 0.05, -0.46);
  g.box(M.gun, 0.006, 0.02, 0.006, 0, 0.078, -0.46);
  g.box(M.gun, 0.03, 0.012, 0.03, 0, 0.062, -0.15);
  // wood: lower + upper handguard, stock, grip
  g.box(M.wood, 0.052, 0.05, 0.2, 0, 0.026, -0.25);
  g.box(M.wood, 0.04, 0.03, 0.16, 0, 0.064, -0.25);
  g.box(M.wood, 0.044, 0.07, 0.26, 0, 0.018, 0.2, -0.06);
  g.box(M.poly, 0.034, 0.095, 0.05, 0, -0.07, 0.055, 0.3);
  // trigger guard + trigger
  g.box(M.gun, 0.01, 0.006, 0.07, 0, -0.045, 0.0);
  g.box(M.gun, 0.006, 0.03, 0.008, 0, -0.03, 0.01);
  // curved magazine (segmented)
  for (let i = 0; i < 4; i++) g.box(M.poly, 0.028, 0.045, 0.055, 0, -0.075 - i * 0.04, -0.02 + i * 0.012, 0.22 + i * 0.08);
  // muzzle nut
  g.cyl(M.gun, 0.014, 0.05, 0, 0.02, -0.5, 'z', 12);
  group.add(g.build());
  return finish(M, def, group, new THREE.Group(), new THREE.Group(), 0, [0, 0.02, -0.53], [0.03, 0.03, -0.03], 0.3,
    handPose([0.03, -0.11, 0.13], [-0.1, 0.3, -1], [-0.85, 0, -0.5], [0.125, -0.31, 0.44], [0.35, 0.55, 1.15, 1.2, 1.25]),
    handPose([-0.07, -0.055, -0.2], [1, 0.2, -0.3], [0.1, 1, 0], [-0.29, -0.3, 0.1], [0.25, 0.95, 1.0, 1.05, 1.05]));
}

// ---------------------------------------------------------------------------
// AUG — bullpup with an integrated optic
// ---------------------------------------------------------------------------
function buildAug(M: Mats, def: WeaponDef): GunModel {
  const g = new Parts();
  const group = new THREE.Group();
  g.box(M.tan, 0.055, 0.085, 0.44, 0, -0.005, -0.06);
  g.box(M.tan, 0.048, 0.06, 0.12, 0, -0.02, 0.2);
  // barrel + flash hider
  g.cyl(M.gun, 0.012, 0.3, 0, 0.022, -0.36, 'z', 12);
  g.cyl(M.gun, 0.015, 0.05, 0, 0.022, -0.52, 'z', 12);
  // integrated optic housing
  g.box(M.gun, 0.044, 0.03, 0.16, 0, 0.06, -0.05);
  g.cyl(M.gun, 0.026, 0.13, 0, 0.062, -0.05, 'z', 16);
  // grip, trigger guard, magazine behind the grip
  g.box(M.poly, 0.036, 0.1, 0.05, 0, -0.085, 0.0, 0.12);
  g.box(M.gun, 0.01, 0.006, 0.07, 0, -0.05, 0.03);
  g.box(M.poly, 0.03, 0.11, 0.055, 0, -0.09, 0.12, -0.1);
  // forward grip
  g.box(M.poly, 0.026, 0.07, 0.035, 0, -0.07, -0.26);
  g.box(M.gun, 0.03, 0.012, 0.04, 0, 0.052, -0.36);
  group.add(g.build());
  return finish(M, def, group, new THREE.Group(), new THREE.Group(), 0, [0, 0.022, -0.55], [0.03, 0.04, -0.03], 0.24,
    handPose([0.03, -0.11, 0.13], [-0.1, 0.3, -1], [-0.85, 0, -0.5], [0.125, -0.31, 0.44], [0.35, 0.55, 1.15, 1.2, 1.25]),
    handPose([-0.06, -0.06, -0.26], [1, 0.15, -0.3], [0.1, 1, 0], [-0.26, -0.32, 0.02], [0.25, 0.95, 1.0, 1.05, 1.05]));
}

// ---------------------------------------------------------------------------
// AN-94
// ---------------------------------------------------------------------------
function buildAn94(M: Mats, def: WeaponDef): GunModel {
  const g = new Parts();
  const group = new THREE.Group();
  g.box(M.gun, 0.05, 0.08, 0.34, 0, 0, -0.04);
  g.box(M.poly, 0.046, 0.05, 0.1, 0, -0.01, 0.14);
  g.cyl(M.gun, 0.011, 0.34, 0, 0.022, -0.38, 'z', 12);
  g.box(M.gun, 0.05, 0.05, 0.2, 0, 0.02, -0.26);
  g.box(M.gun, 0.03, 0.03, 0.07, 0, 0.024, -0.56);
  // distinctive muzzle brake + angled recoil spring housing
  g.box(M.gun, 0.026, 0.026, 0.06, 0, 0.024, -0.6);
  g.box(M.poly, 0.044, 0.07, 0.26, 0, 0.01, 0.22, -0.05);
  g.box(M.poly, 0.034, 0.095, 0.05, 0, -0.075, 0.06, 0.28);
  g.box(M.gun, 0.01, 0.006, 0.07, 0, -0.05, 0.0);
  // magazine forward of the grip
  g.box(M.poly, 0.03, 0.11, 0.06, 0, -0.085, -0.08, 0.18);
  // carry handle
  g.box(M.gun, 0.018, 0.014, 0.2, 0, 0.085, -0.1);
  g.box(M.gun, 0.016, 0.03, 0.02, 0, 0.07, -0.01);
  g.box(M.gun, 0.016, 0.03, 0.02, 0, 0.07, -0.19);
  group.add(g.build());
  return finish(M, def, group, new THREE.Group(), new THREE.Group(), 0, [0, 0.024, -0.62], [0.03, 0.03, -0.03], 0.26,
    handPose([0.03, -0.11, 0.13], [-0.1, 0.3, -1], [-0.85, 0, -0.5], [0.125, -0.31, 0.44], [0.35, 0.55, 1.15, 1.2, 1.25]),
    handPose([-0.07, -0.05, -0.22], [1, 0.2, -0.3], [0.1, 1, 0], [-0.29, -0.3, 0.1], [0.25, 0.95, 1.0, 1.05, 1.05]));
}

// ---------------------------------------------------------------------------
// Glock 18 — polymer frame, squared slide
// ---------------------------------------------------------------------------
function buildGlock(M: Mats, def: WeaponDef): GunModel {
  const g = new Parts();
  const group = new THREE.Group();
  g.box(M.gun, 0.028, 0.038, 0.19, 0, 0.014, -0.06);
  g.box(M.poly, 0.026, 0.03, 0.15, 0, -0.012, -0.045);
  g.box(M.poly, 0.028, 0.1, 0.048, 0, -0.07, 0.028, 0.22);
  g.cyl(M.gun, 0.009, 0.03, 0, 0.016, -0.16, 'z', 10);
  g.box(M.gun, 0.01, 0.006, 0.06, 0, -0.035, 0.0);
  g.box(M.gun, 0.006, 0.026, 0.008, 0, -0.022, 0.008);
  // sights
  g.box(M.gun, 0.006, 0.008, 0.008, 0, 0.038, -0.15);
  g.box(M.gun, 0.02, 0.008, 0.008, 0, 0.038, 0.03);
  group.add(g.build());
  return finish(M, def, group, new THREE.Group(), new THREE.Group(), 0, [0, 0.016, -0.175], [0.02, 0.03, -0.04], 0.16,
    handPose([0.028, -0.07, 0.085], [-0.1, 0.3, -1], [-0.85, 0, -0.5], [0.14, -0.26, 0.42], [0.35, 0.5, 1.15, 1.2, 1.25]),
    handPose([-0.05, -0.085, 0.07], [0.3, 0.3, -1], [1, 0, -0.25], [-0.26, -0.27, 0.4], [0.3, 1.0, 1.05, 1.1, 1.1]));
}

/** Authored first-person weapon packs (CC BY, see CREDITS.md): one GLB per platform. */
const MODEL_FILE: Partial<Record<WeaponId, string>> = {
  m4a1: 'fp_m4a1', ak47: 'fp_ak47', scarl: 'fp_scarl', mp5a5: 'fp_mp5a5', awm: 'fp_awm', m1911: 'fp_m1911',
};

const RIFLE_R = handPose([0.028, -0.13, 0.16], [-0.1, 0.3, -1], [-0.85, 0, -0.5], [0.13, -0.32, 0.46], [0.32, 0.45, 0.74, 0.78, 0.80]);
const RIFLE_L = handPose([-0.06, -0.02, -0.42], [1, 0.2, -0.3], [0.1, 1, 0], [-0.28, -0.32, 0.05], [0.25, 0.62, 0.68, 0.72, 0.74]);
const PISTOL_R = handPose([0.032, -0.082, 0.105], [-0.08, 0.28, -1], [-0.86, 0.04, -0.5], [0.14, -0.26, 0.42], [0.28, 0.35, 0.76, 0.78, 0.82]);
const PISTOL_L = handPose([-0.045, -0.095, 0.09], [0.28, 0.28, -1], [0.90, 0.26, -0.26], [-0.26, -0.27, 0.4], [0.25, 0.68, 0.72, 0.75, 0.78]);

/**
 * Authored first-person weapon data, ported from the IRONLINE FP rig: models are authored at
 * 2x real size (FP_K = 2) with the muzzle along -Z, and the sight/grip markers are in that
 * K-space. Field values: rear/front sight, right/left grip.
 */
interface FpData {
  k?: number;
  rear: [number, number, number];
  front: [number, number, number];
  primary: [number, number, number];
  support: [number, number, number];
  rail?: [number, number, number];
  scope?: boolean;
}
const FP_DATA: Partial<Record<WeaponId, FpData>> = {
  m4a1: { k: 0.55, rear: [0, 0.2498, 0.255], front: [0, 0.2404, -0.505], primary: [0, -0.17, 0.215], support: [0, 0, -0.58], rail: [0, 0.1786, 0.06] },
  ak47: { k: 0.62, rear: [0, 0.1005, -0.645], front: [0, 0.1005, -1.375], primary: [0, -0.0731, -0.12176], support: [-0.00107, 0.00898, -0.53758], rail: [0, 0.0956, -0.492] },
  scarl: { k: 0.55, rear: [0, 0.2655, 0.2311], front: [0, 0.2777, -0.514], primary: [-0.0084, -0.1625, -0.1552], support: [-0.0093, 0.1027, -0.6419], rail: [0, 0.1879, -0.058] },
  mp5a5: { k: 0.56, rear: [0, 0.238, 0.0978], front: [0, 0.254, -0.5722], primary: [0, -0.0977, -0.1029], support: [-0.0414, 0.0338, -0.3866], rail: [0, 0.2286, -0.21] },
  m1911: { k: 0.64, rear: [0, 0.1372, 0.1299], front: [0, 0.1368, -0.1954], primary: [-0.0113, -0.03, 0.245], support: [-0.1072, -0.04, 0.24], rail: [0, 0.1281, 0.045] },
  awm: { k: 0.54, rear: [0, 0.2, 0.1], front: [0, 0.2, -1.3], primary: [0, -0.0696, -0.0612], support: [-0.0098, 0.1337, -0.6538], scope: true },
};

function buildFP(M: Mats, def: WeaponDef): GunModel {
  const src = assets.gltf[MODEL_FILE[def.id] as keyof typeof assets.gltf].scene;
  const root = src.clone(true);
  const group = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(root);
  group.add(holder);
  // the packs ship their own skinned arms; we pose our own rig instead
  root.traverse((o) => {
    if (o.name === 'FPArms' || (o as THREE.SkinnedMesh).isSkinnedMesh) o.visible = false;
    // the packs ship spare magazines lying next to the gun: they inflate the bounding box and
    // float in mid air once the weapon is parented to the viewmodel
    if (/spare/i.test(o.name)) o.visible = false;
    // Tag AWM's native built-in high-power 8x sniper scope (Body prim1 mat 'lambert2' + GlassGeometry)
    // so the Gunsmith can cleanly hide/show it when swapping optics, and rail measurements hit the real receiver!
    if (def.id === 'awm' && (o as THREE.Mesh).isMesh) {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const matName = Array.isArray(mat) ? mat.map((m) => m.name).join(',') : (mat?.name ?? '');
      if (matName === 'lambert2' || matName === 'glass_lambert1' || /scope|optic|lens|glass/i.test(o.name)) {
        o.userData.awmNativeScope = true;
      }
    }
    o.frustumCulled = false;
  });

  const d = FP_DATA[def.id]!;
  const k = d.k ?? def.modelScale ?? 0.58; // realistic proportional scaling against hands
  holder.scale.setScalar(k);
  group.updateMatrixWorld(true);

  const rifle = def.family !== 'pistol';
  const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

  // Detach animated magazine and bolt/slide nodes first so we can measure body vs mag separately
  const mag = take(group, root, /magazin/i);
  const action = take(group, root, /charging|bolt|slide/i);
  group.updateMatrixWorld(true);

  const invGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const vtx = new THREE.Vector3();
  const toGroup = new THREE.Matrix4();

  /** Compute bounding box in `group` space for visible vertices within optional Z/Y slices. */
  const sliceBox = (
    target: THREE.Object3D,
    zMin = -Infinity,
    zMax = Infinity,
    yMin = -Infinity,
    yMax = Infinity,
    skipSightOrScope = false,
  ) => {
    const out = new THREE.Box3();
    target.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      if (/flash/i.test(o.name) || /flash/i.test(o.parent?.name ?? '')) return;
      if (skipSightOrScope && (o.userData?.awmNativeScope || /scope|optic|lens|glass|rear.*(iron|sight)|front.*(iron|sight)/i.test(o.name))) return;
      const posAttr = mesh.geometry?.attributes?.position;
      if (!posAttr) return;
      toGroup.multiplyMatrices(invGroup, mesh.matrixWorld);
      for (let i = 0; i < posAttr.count; i++) {
        vtx.fromBufferAttribute(posAttr, i).applyMatrix4(toGroup);
        if (vtx.z >= zMin && vtx.z <= zMax && vtx.y >= yMin && vtx.y <= yMax) {
          out.expandByPoint(vtx);
        }
      }
    });
    return out;
  };

  /** Helper to read an authored socket node's position in `group` space, or null if absent. */
  const socketPos = (re: RegExp): THREE.Vector3 | null => {
    let found: THREE.Object3D | null = null;
    root.traverse((o) => { if (!found && re.test(o.name)) found = o; });
    if (!found) return null;
    return (found as THREE.Object3D).getWorldPosition(new THREE.Vector3()).applyMatrix4(invGroup);
  };

  // Full weapon body bounds (excluding magazine & built-in scope) and magazine bounds in group space
  const bodyBB = sliceBox(holder, -Infinity, Infinity, -Infinity, Infinity, true);
  const actionBB = sliceBox(action, -Infinity, Infinity, -Infinity, Infinity, true);
  bodyBB.union(actionBB);
  const magBB = sliceBox(mag);

  // Eye-relative placements in gun-local metres (K-space * k)
  const kx = k * d.rear[0], ky = k * d.rear[1], kz = k * d.rear[2];
  const sightY = ky;
  def.sightY = sightY;

  const adsZ = def.family === 'pistol' ? -0.275 : def.id === 'awm' ? -0.26 : -0.22;
  const ads: [number, number, number] = [-kx, -ky + 0.002, adsZ - kz];
  const hipOffset: [number, number, number] = def.family === 'pistol'
    ? [0.095, -0.052, -0.055]
    : def.id === 'awm'
      ? [0.088, -0.046, -0.09]
      : [0.084, -0.046, -0.15];
  def.adsPos = ads;
  def.hipOffset = hipOffset;
  def.hipCenter = [0, 0, 0];
  def.hipPos = [
    ads[0] + hipOffset[0],
    Math.min(-0.02, Math.max(-0.18, -sightY + hipOffset[1])),
    ads[2] + hipOffset[2],
  ];
  // Natural shouldered rifle / pistol posture (slight inward yaw and ergonomic cant)
  def.hipRot = def.family === 'pistol' ? [0.015, 0.032, -0.035] : [0.014, 0.038, -0.055];

  // 1. Muzzle & Barrel anchor: use authored MuzzleSocket / MuzzleDeviceTip for bore Y, and tipZ for Z
  const tipZ = bodyBB.min.z;
  const mzSock = socketPos(/^(MuzzleSocket|MuzzleDeviceTip)$/i);
  const tipSlice = sliceBox(holder, tipZ, tipZ + 0.035, -Infinity, Infinity, true);
  const boreY = mzSock
    ? mzSock.y
    : !tipSlice.isEmpty()
      ? (tipSlice.min.y + tipSlice.max.y) * 0.5
      : k * d.front[1] * 0.72;
  const muzzle: [number, number, number] = [0, boreY, tipZ - 0.006];
  def.muzzle = muzzle;

  // 2. Magazine bounds & anchor: bottom of the magazine so extended mag sleeves sit flush
  const magC = new THREE.Vector3();
  if (!magBB.isEmpty()) {
    magBB.getCenter(magC);
  } else {
    magC.set(k * d.primary[0], k * d.primary[1] - 0.04, k * d.primary[2] - 0.08);
  }
  const magAnchor: [number, number, number] = !magBB.isEmpty()
    ? [0, magBB.min.y + 0.008, (magBB.min.z + magBB.max.z) * 0.5]
    : [0, magC.y - 0.05, magC.z];

  // 3. Top optic rail anchor: use OpticRailContact if present, or flat receiver rail top (excluding iron sights)
  const railSock = socketPos(/^OpticRailContact$/i);
  const railZ = railSock
    ? railSock.z
    : cl(d.rail ? k * d.rail[2] : magC.z + 0.02, bodyBB.min.z * 0.45, bodyBB.max.z * 0.55);
  const railSlice = sliceBox(holder, railZ - 0.045, railZ + 0.045, boreY, Infinity, true);
  const railY = railSock
    ? railSock.y
    : d.rail
      ? k * d.rail[1]
      : !railSlice.isEmpty()
        ? railSlice.max.y - 0.002
        : sightY - 0.015;

  // For weapons whose GLB bakes flip-up/fixed iron sights into the single Body mesh (SCAR-L, MP5A5, M4A1 front post),
  // split triangles rising above the flat top Picatinny rail into a toggleable `RearIronSight_Baked` mesh
  // so iron sights remain 100% intact when optic==='irons' and fold cleanly out of the sight picture when an optic is fitted!
  if (def.id === 'scarl' || def.id === 'mp5a5' || def.id === 'm4a1') {
    const cutY = railY + 0.0045;
    const isIronTri = (cy: number, cz: number) => {
      if (cy <= cutY) return false;
      if (def.id === 'm4a1') return cz < -0.18; // M4A1 rear sight is already a separate node; split only fixed A2 front post
      return true; // SCAR-L & MP5A5 monolithic top rail: anything above railY is rear/front flip-up iron sights
    };
    const toSplit: THREE.Mesh[] = [];
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && /^Body/i.test(m.name) && m.geometry?.attributes?.position) toSplit.push(m);
    });
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (const mesh of toSplit) {
      const srcGeo = mesh.geometry;
      const pos = srcGeo.attributes.position;
      toGroup.multiplyMatrices(invGroup, mesh.matrixWorld);
      const idx = srcGeo.index;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      const bodyIdx: number[] = [];
      const ironIdx: number[] = [];
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        va.fromBufferAttribute(pos, i0).applyMatrix4(toGroup);
        vb.fromBufferAttribute(pos, i1).applyMatrix4(toGroup);
        vc.fromBufferAttribute(pos, i2).applyMatrix4(toGroup);
        const cy = (va.y + vb.y + vc.y) / 3;
        const cz = (va.z + vb.z + vc.z) / 3;
        const maxY = Math.max(va.y, vb.y, vc.y);
        if (isIronTri(cy, cz) || (maxY > cutY + 0.012 && isIronTri(maxY, cz))) {
          ironIdx.push(i0, i1, i2);
        } else {
          bodyIdx.push(i0, i1, i2);
        }
      }
      if (ironIdx.length > 0 && bodyIdx.length > 0) {
        const bodyGeo = srcGeo.clone();
        bodyGeo.setIndex(bodyIdx);
        mesh.geometry = bodyGeo;
        const ironGeo = srcGeo.clone();
        ironGeo.setIndex(ironIdx);
        const ironMesh = new THREE.Mesh(ironGeo, mesh.material);
        ironMesh.name = 'RearIronSight_Baked';
        ironMesh.position.copy(mesh.position);
        ironMesh.quaternion.copy(mesh.quaternion);
        ironMesh.scale.copy(mesh.scale);
        ironMesh.frustumCulled = false;
        mesh.parent?.add(ironMesh);
      }
    }
  }

  // 4. Handguard slice (forward of magwell) for support hand, under-barrel grip & laser
  const vgripSock = socketPos(/^VGripMount$/i);
  const hgZ = vgripSock
    ? cl(vgripSock.z, tipZ * 0.68, magC.z - 0.09)
    : rifle
      ? cl(magC.z - 0.17, tipZ * 0.62, magC.z - 0.1)
      : cl(tipZ + 0.045, tipZ + 0.02, magC.z - 0.04);
  const hgSlice = sliceBox(holder, hgZ - 0.045, hgZ + 0.045, boreY - 0.08, boreY + 0.07, true);
  const hgBottomY = !hgSlice.isEmpty() ? hgSlice.min.y + 0.003 : (vgripSock ? vgripSock.y : boreY - 0.026);
  const hgTopY = !hgSlice.isEmpty() ? hgSlice.max.y - 0.002 : railY;

  // 5. Buttstock slice (rear of receiver) so stock attachments hug the stock comb & buttpad
  const stockZ = bodyBB.max.z - 0.025;
  const stockSlice = sliceBox(holder, bodyBB.max.z - 0.1, bodyBB.max.z, -Infinity, Infinity, true);
  const stockY = !stockSlice.isEmpty()
    ? stockSlice.max.y - 0.032
    : boreY - 0.01;

  // 6. Laser anchor: right-side 3-o'clock rail on rifles/SMGs (never blocks optics!), under-barrel rail on pistols
  const laserZ = rifle ? cl(hgZ - 0.05, tipZ * 0.72, hgZ) : cl(tipZ + 0.042, tipZ + 0.02, magC.z - 0.03);
  const laserSlice = sliceBox(holder, laserZ - 0.03, laserZ + 0.03, boreY - 0.07, boreY + 0.07, true);
  const laserX = rifle ? (!laserSlice.isEmpty() ? laserSlice.max.x + 0.002 : 0.024) : 0;
  const laserY = rifle
    ? boreY + 0.002
    : (!laserSlice.isEmpty() ? laserSlice.min.y + 0.002 : hgBottomY);

  def.anchors = {
    optic: [0, railY, railZ],
    muzzle: [0, boreY, tipZ + 0.008],
    barrel: [0, boreY, tipZ + 0.012],
    grip: [0, hgBottomY, hgZ],
    mag: magAnchor,
    stock: [0, stockY, stockZ],
    laser: [laserX, laserY, laserZ],
  };

  // 7. Pistol grip & support hand placements measured from authored sockets (rifles) or actual grip geometry (pistols)
  const gripSockR = socketPos(/^GripR$/i);
  const gripSockL = socketPos(/^GripL$/i);

  const gripZSearch = rifle ? cl(magC.z + 0.11, 0.01, bodyBB.max.z - 0.05) : magC.z;
  const pistolGripSlice = rifle
    ? sliceBox(holder, gripZSearch - 0.045, gripZSearch + 0.055, -Infinity, boreY - 0.02, true)
    : magBB;
  const magGripSock = socketPos(/^MagazineGripSocket$/i);
  const fallbackGR: [number, number, number] = rifle
    ? [
        0,
        !pistolGripSlice.isEmpty() ? cl((pistolGripSlice.min.y + pistolGripSlice.max.y) * 0.5, -0.11, -0.035) : cl(magC.y - 0.035, -0.1, -0.04),
        !pistolGripSlice.isEmpty() ? cl((pistolGripSlice.min.z + pistolGripSlice.max.z) * 0.5, 0.01, 0.16) : cl(magC.z + 0.105, 0.01, 0.15),
      ]
    : magGripSock
      ? [0, magGripSock.y - 0.012, magGripSock.z + 0.004]
      : [0, cl(magC.y, -0.05, 0.005), cl(magC.z + 0.004, 0.04, 0.12)];
  // For pistols, seat the primary hand firmly on the wooden grip panels snugly below the beavertail tang
  const gR: [number, number, number] = (rifle && gripSockR) ? [gripSockR.x, gripSockR.y, gripSockR.z] : fallbackGR;

  const fallbackGL: [number, number, number] = rifle
    ? [0, cl((hgBottomY + boreY) * 0.5, -0.045, 0.025), hgZ]
    : [gR[0] - 0.020, gR[1] - 0.012, gR[2] - 0.012];
  const gL: [number, number, number] = (rifle && gripSockL) ? [gripSockL.x, gripSockL.y, gripSockL.z] : fallbackGL;
  def.gripR = gR;
  def.gripL = gL;

  // Back the wrist off along each hand's forward axis by half a palm length so the palm wraps the grip
  const PALM_R = rifle ? 0.08 : 0.072;
  const PALM_L = rifle ? 0.07 : 0.070;
  const fwdR = (rifle ? new THREE.Vector3(-0.08, 0.28, -1) : new THREE.Vector3(-0.06, 0.22, -0.97)).normalize();
  const fwdL = (rifle ? new THREE.Vector3(0.06, 0.26, -0.96) : new THREE.Vector3(0.24, 0.18, -0.95)).normalize();
  const palmR = (rifle ? new THREE.Vector3(-0.88, 0.08, -0.46) : new THREE.Vector3(-0.95, 0.05, -0.30)).normalize();
  const palmL = (rifle ? new THREE.Vector3(0.18, 0.95, -0.2) : new THREE.Vector3(0.88, 0.36, -0.28)).normalize();
  const wr: [number, number, number] = rifle
    ? [
        gR[0] - fwdR.x * PALM_R + 0.012,
        gR[1] - fwdR.y * PALM_R,
        gR[2] - fwdR.z * PALM_R,
      ]
    : [
        gR[0] - fwdR.x * PALM_R + 0.016,
        gR[1] - fwdR.y * PALM_R - 0.008,
        gR[2] - fwdR.z * PALM_R + 0.006,
      ];
  const wl: [number, number, number] = rifle
    ? [gL[0] - 0.016, gL[1] - 0.035, gL[2] + 0.03]
    : [
        gL[0] - fwdL.x * PALM_L - 0.006,
        gL[1] - fwdL.y * PALM_L - 0.008,
        gL[2] - fwdL.z * PALM_L + 0.006,
      ];
  const poseR = handPose(
    wr,
    [fwdR.x, fwdR.y, fwdR.z],
    [palmR.x, palmR.y, palmR.z],
    [wr[0] + 0.14, wr[1] - 0.24, wr[2] + 0.32],
    rifle ? [0.32, 0.45, 0.74, 0.78, 0.80] : [0.62, 0.38, 0.96, 1.00, 1.02],
  );
  const poseL = handPose(
    wl,
    [fwdL.x, fwdL.y, fwdL.z],
    [palmL.x, palmL.y, palmL.z],
    [wl[0] - 0.15, wl[1] - 0.26, wl[2] + 0.34],
    rifle ? [0.52, 0.68, 0.76, 0.80, 0.80] : [0.58, 0.86, 0.92, 0.96, 1.00],
  );
  const ejSock = socketPos(/^EjectionPort$/i);
  const eject: [number, number, number] = ejSock
    ? [ejSock.x, ejSock.y, ejSock.z]
    : [0.022, boreY + 0.01, railZ];
  // For AWM, add low-profile flip-up backup iron sights (auto-hidden whenever 8x / 4x / holo / reddot is fitted!)
  if (def.id === 'awm') {
    const awmRear = new Parts();
    awmRear.box(M.gun, 0.022, 0.008, 0.024, 0, railY + 0.004, railZ + 0.075);
    awmRear.box(M.steel, 0.004, 0.02, 0.008, -0.008, railY + 0.018, railZ + 0.075);
    awmRear.box(M.steel, 0.004, 0.02, 0.008, 0.008, railY + 0.018, railZ + 0.075);
    awmRear.box(M.gun, 0.016, 0.012, 0.004, 0, railY + 0.015, railZ + 0.075);
    const rg = awmRear.build();
    rg.name = 'RearIronSight';
    group.add(rg);

    const awmFront = new Parts();
    const fz = tipZ + 0.085;
    awmFront.box(M.gun, 0.02, 0.014, 0.02, 0, boreY + 0.012, fz);
    awmFront.box(M.steel, 0.0035, 0.022, 0.008, -0.007, railY + 0.018, fz);
    awmFront.box(M.steel, 0.0035, 0.022, 0.008, 0.007, railY + 0.018, fz);
    awmFront.box(M.steel, 0.0028, 0.017, 0.004, 0, railY + 0.019, fz);
    const fg = awmFront.build();
    fg.name = 'FrontIronSight';
    group.add(fg);
  }

  // Add crisp 3-dot luminous combat tritium iron sights onto M1911's reciprocating slide so ADS aiming is razor-sharp!
  if (def.id === 'm1911') {
    const dotRear = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.8, 1.9, 1.8), fog: false });
    const dotFront = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.35, 3.0, 0.65), fog: false });
    const dp = new Parts();
    const sy = k * 0.1322;
    dp.box(dotRear, 0.0018, 0.0018, 0.0012, -k * 0.0072, sy, k * 0.133);
    dp.box(dotRear, 0.0018, 0.0018, 0.0012,  k * 0.0072, sy, k * 0.133);
    dp.box(dotFront, 0.0020, 0.0022, 0.0012, 0, k * 0.1335, k * -0.188);
    action.add(dp.build());
  }

  return finish(M, def, group, mag, action, 0, muzzle, eject, 0.2 * def.flashScale, poseR, poseL);
}

// ---------------------------------------------------------------------------
// PLA QBZ-192 (192式短突击步枪) — Authentic 5.8mm Modular Carbine Hard-Surface Build
// ---------------------------------------------------------------------------
function buildQbz192(M: Mats, def: WeaponDef): GunModel {
  const det = makeGunTextures();
  const qbzUpper = new THREE.MeshStandardMaterial({
    color: 0x252a2e, metalness: 0.78, roughness: 0.34,
    map: det.map, roughnessMap: det.roughnessMap, normalMap: det.normalMap, normalScale: new THREE.Vector2(0.45, 0.45),
  });
  const qbzHandguard = new THREE.MeshStandardMaterial({
    color: 0x242926, metalness: 0.14, roughness: 0.68,
    map: det.map, roughnessMap: det.roughnessMap, normalMap: det.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
  });
  const qbzPoly = new THREE.MeshStandardMaterial({
    color: 0x1b1e20, metalness: 0.08, roughness: 0.74,
    map: det.map, roughnessMap: det.roughnessMap, normalMap: det.normalMap, normalScale: new THREE.Vector2(0.75, 0.75),
  });

  const group = new THREE.Group();
  const g = new Parts();

  // 1. Signature QBZ-191/192 Monolithic Faceted Upper Receiver (no M4 carry handle / forward assist!)
  g.box(qbzUpper, 0.044, 0.042, 0.235, 0, 0.036, -0.025);
  // Chamfered 45-deg upper shoulder bevels along the entire receiver
  g.box(qbzUpper, 0.014, 0.014, 0.232, -0.017, 0.056, -0.025, 0, 0, 0.78);
  g.box(qbzUpper, 0.014, 0.014, 0.232, 0.017, 0.056, -0.025, 0, 0, -0.78);
  // Continuous full-length monolithic Picatinny top rail (receiver + handguard, 22 machined slots)
  g.box(M.gun, 0.026, 0.008, 0.44, 0, 0.064, -0.14);
  for (let i = 0; i < 22; i++) {
    g.box(M.steel, 0.024, 0.0035, 0.009, 0, 0.0685, 0.068 - i * 0.0195);
  }
  // Ejection port recess + distinctive angular QBZ-192 brass deflector
  g.box(M.bore, 0.006, 0.018, 0.062, 0.021, 0.036, -0.052);
  g.box(qbzUpper, 0.012, 0.018, 0.016, 0.024, 0.036, -0.014, 0, 0.45, 0);

  // 2. Lower Polymer Receiver, Flared Magwell, Trigger Guard & Ambidextrous Controls
  g.box(qbzPoly, 0.041, 0.044, 0.21, 0, 0.0, -0.015);
  // Flared beveled 5.8mm magwell housing
  g.box(qbzPoly, 0.044, 0.048, 0.088, 0, -0.024, -0.082);
  g.box(qbzHandguard, 0.047, 0.012, 0.094, 0, -0.046, -0.082);
  // Ambidextrous selector switches & takedown pins
  g.cyl(M.steel, 0.0045, 0.048, 0, 0.014, -0.105, 'x', 10);
  g.cyl(M.steel, 0.0045, 0.048, 0, 0.014, 0.065, 'x', 10);
  g.box(M.steel, 0.005, 0.006, 0.018, -0.023, 0.004, 0.032, 0.35);
  g.box(M.steel, 0.005, 0.006, 0.018, 0.023, 0.004, 0.032, 0.35);
  // Integrated winter trigger guard + curved steel trigger
  g.box(qbzPoly, 0.016, 0.006, 0.064, 0, -0.046, 0.008);
  g.box(qbzPoly, 0.016, 0.026, 0.008, 0, -0.034, -0.022);
  g.box(M.steel, 0.005, 0.025, 0.007, 0, -0.03, 0.012, 0.28);
  // Ergonomic contoured QBZ-192 pistol grip with anti-slip ribs
  g.box(qbzPoly, 0.032, 0.105, 0.048, 0, -0.068, 0.066, 0.28);
  g.box(qbzHandguard, 0.034, 0.072, 0.028, 0, -0.07, 0.068, 0.28);
  g.box(M.gun, 0.034, 0.012, 0.052, 0, -0.118, 0.08, 0.28);

  // 3. Signature QBZ-192 Polymer-Clad Free-Float Handguard (rounded trapezoid, slanted cooling vents, NO M4 delta ring!)
  g.box(qbzHandguard, 0.046, 0.058, 0.235, 0, 0.024, -0.258);
  // Sleek upper heat-shield bevels + 5 signature slanted cooling vent cutouts per side
  g.box(qbzPoly, 0.049, 0.022, 0.225, 0, 0.004, -0.258);
  for (let i = 0; i < 5; i++) {
    const vz = -0.18 - i * 0.038;
    g.box(M.bore, 0.004, 0.01, 0.022, -0.023, 0.038, vz, 0.22);
    g.box(M.bore, 0.004, 0.01, 0.022, 0.023, 0.038, vz, 0.22);
    // Horizontal ergonomic grip ribs on lower handguard flanks
    g.box(M.gun, 0.051, 0.004, 0.024, 0, 0.006, vz);
  }
  // Right-side 3-o'clock accessory rail + bottom 6-o'clock foregrip rail
  g.box(M.gun, 0.006, 0.014, 0.11, 0.025, 0.024, -0.305);
  g.box(M.gun, 0.02, 0.007, 0.12, 0, -0.018, -0.265);

  // 4. Short 10.5" Cold-Hammer-Forged Carbine Barrel + Exposed QBZ-192 Gas Regulator Knob + Flash Hider
  g.box(M.steel, 0.022, 0.032, 0.032, 0, 0.032, -0.382);
  g.cyl(M.steel, 0.0075, 0.028, 0, 0.048, -0.392, 'z', 10);
  g.cyl(M.gun, 0.0105, 0.11, 0, 0.024, -0.415, 'z', 14);
  g.cyl(M.steel, 0.013, 0.032, 0, 0.024, -0.462, 'z', 14);
  g.cyl(M.bore, 0.0065, 0.035, 0, 0.024, -0.464, 'z', 10);

  // 5. Signature QBZ-192 Straight-Line Telescoping Polymer Buttstock
  g.cyl(qbzUpper, 0.018, 0.16, 0, 0.026, 0.165, 'z', 16);
  g.box(qbzHandguard, 0.042, 0.036, 0.14, 0, 0.022, 0.21);
  g.box(qbzPoly, 0.038, 0.068, 0.105, 0, -0.012, 0.228, -0.14);
  g.box(M.gun, 0.032, 0.012, 0.085, 0, -0.044, 0.212, -0.22);
  // Ribbed rubberized buttpad + QD sling socket
  g.box(qbzPoly, 0.042, 0.112, 0.018, 0, -0.004, 0.282);
  g.cyl(M.steel, 0.006, 0.044, 0, 0.018, 0.245, 'x', 10);

  group.add(g.build());

  // 6. Low-profile Folding Iron Sights (automatically hidden when optic is mounted!)
  const rearSight = new Parts();
  rearSight.box(M.gun, 0.024, 0.012, 0.026, 0, 0.074, 0.042);
  rearSight.box(M.steel, 0.005, 0.02, 0.012, -0.009, 0.088, 0.042);
  rearSight.box(M.steel, 0.005, 0.02, 0.012, 0.009, 0.088, 0.042);
  rearSight.box(M.gun, 0.018, 0.014, 0.004, 0, 0.086, 0.042);
  const rearGroup = rearSight.build();
  rearGroup.name = 'RearIronSight';
  group.add(rearGroup);

  const frontSight = new Parts();
  frontSight.box(M.gun, 0.022, 0.01, 0.022, 0, 0.073, -0.352);
  frontSight.box(M.steel, 0.004, 0.022, 0.01, -0.008, 0.088, -0.352);
  frontSight.box(M.steel, 0.004, 0.022, 0.01, 0.008, 0.088, -0.352);
  frontSight.box(M.steel, 0.003, 0.016, 0.004, 0, 0.088, -0.352);
  const frontGroup = frontSight.build();
  frontGroup.name = 'FrontIronSight';
  group.add(frontGroup);

  // 7. Animated Reciprocating Right-Side Charging Handle & Steel Bolt Carrier
  const actP = new Parts();
  actP.box(M.steel, 0.012, 0.014, 0.058, 0.018, 0.036, -0.052);
  actP.cyl(M.gun, 0.0045, 0.026, 0.032, 0.036, -0.038, 'x', 10);
  actP.cyl(qbzPoly, 0.0065, 0.012, 0.043, 0.036, -0.038, 'x', 10);
  const action = actP.build();
  group.add(action);

  // 8. Animated Signature Curved Ribbed 5.8×42mm Polymer Magazine
  const magP = new Parts();
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    magP.box(qbzPoly, 0.026, 0.038, 0.062, 0, -0.048 - i * 0.032, -0.082 - i * 0.006, 0.08 + t * 0.14);
    // Signature horizontal traction ribs along QBZ-192 polymer mag
    magP.box(qbzHandguard, 0.0285, 0.0045, 0.056, 0, -0.058 - i * 0.028, -0.083 - i * 0.006, 0.08 + t * 0.14);
  }
  // Witness window showing brass 5.8mm cartridges + textured floorplate
  magP.box(M.brass, 0.0275, 0.042, 0.014, 0, -0.105, -0.094, 0.16);
  magP.box(M.gun, 0.03, 0.012, 0.07, 0, -0.162, -0.102, 0.22);
  const mag = magP.build();
  group.add(mag);

  def.gripR = [0, -0.068, 0.066];
  def.gripL = [0, -0.012, -0.26];
  const poseR = handPose(
    [0.02, -0.09, 0.145], [-0.08, 0.28, -1], [-0.88, 0.08, -0.46],
    [0.16, -0.31, 0.44], [0.32, 0.45, 0.74, 0.78, 0.80],
  );
  const poseL = handPose(
    [-0.018, -0.048, -0.228], [0.06, 0.26, -0.96], [0.18, 0.95, -0.2],
    [-0.17, -0.29, 0.09], [0.52, 0.68, 0.76, 0.80, 0.80],
  );
  return finish(M, def, group, mag, action, 0, [0, 0.024, -0.475], [0.026, 0.038, -0.052], 0.2, poseR, poseL);
}

// ---------------------------------------------------------------------------
// PLA QSZ-193 (193式微声战术手枪) — Authentic 9mm Tactical Service Pistol
// ---------------------------------------------------------------------------
function buildQsz193(M: Mats, def: WeaponDef): GunModel {
  const det = makeGunTextures();
  const slideMat = new THREE.MeshStandardMaterial({
    color: 0x22262b, metalness: 0.82, roughness: 0.3,
    map: det.map, roughnessMap: det.roughnessMap, normalMap: det.normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1a1d20, metalness: 0.08, roughness: 0.74,
    map: det.map, roughnessMap: det.roughnessMap, normalMap: det.normalMap, normalScale: new THREE.Vector2(0.75, 0.75),
  });
  const tritiumMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.35, 3.2, 0.65), fog: false });

  const group = new THREE.Group();
  const g = new Parts();

  // Lower polymer frame + dust cover + under-barrel Picatinny rail
  g.box(frameMat, 0.027, 0.02, 0.185, 0, -0.002, -0.048);
  g.box(M.gun, 0.023, 0.006, 0.056, 0, -0.012, -0.112);
  // Squared combat trigger guard + curved trigger + beaver-tail tang
  g.box(frameMat, 0.013, 0.005, 0.056, 0, -0.034, -0.028);
  g.box(frameMat, 0.013, 0.024, 0.006, 0, -0.022, -0.054);
  g.box(M.steel, 0.0045, 0.021, 0.006, 0, -0.02, -0.024, 0.25);
  g.box(frameMat, 0.024, 0.01, 0.026, 0, 0.004, 0.052);
  // Ergonomic contoured grip with stippled side panels
  g.box(frameMat, 0.027, 0.105, 0.046, 0, -0.06, 0.025, 0.24);
  g.box(M.gun, 0.029, 0.072, 0.032, 0, -0.062, 0.026, 0.24);
  // Extended threaded stainless match barrel for suppressor mounting
  g.cyl(M.steel, 0.0085, 0.18, 0, 0.022, -0.088, 'z', 14);
  g.cyl(M.bore, 0.0052, 0.016, 0, 0.022, -0.175, 'z', 10);
  group.add(g.build());

  // Reciprocating tactical slide + front/rear angled serrations + suppressor-height tritium 3-dot sights
  const sP = new Parts();
  sP.box(slideMat, 0.028, 0.032, 0.195, 0, 0.023, -0.052);
  sP.box(slideMat, 0.022, 0.008, 0.192, 0, 0.04, -0.052);
  // Ejection port + exposed steel chamber hood
  sP.box(M.steel, 0.014, 0.012, 0.042, 0.009, 0.034, -0.042);
  // Front & rear angled cocking serrations
  for (let i = 0; i < 5; i++) {
    sP.box(M.bore, 0.0295, 0.022, 0.0025, 0, 0.023, 0.032 - i * 0.007, 0.16);
    sP.box(M.bore, 0.0295, 0.018, 0.0025, 0, 0.023, -0.11 - i * 0.007, 0.16);
  }
  // Suppressor-height tritium 3-dot sights (clear above micro-suppressor!)
  sP.box(M.gun, 0.005, 0.011, 0.01, -0.0075, 0.049, 0.036);
  sP.box(M.gun, 0.005, 0.011, 0.01, 0.0075, 0.049, 0.036);
  sP.box(tritiumMat, 0.0028, 0.0028, 0.002, -0.0075, 0.051, 0.0415);
  sP.box(tritiumMat, 0.0028, 0.0028, 0.002, 0.0075, 0.051, 0.0415);
  sP.box(M.gun, 0.0045, 0.012, 0.012, 0, 0.05, -0.138);
  sP.box(tritiumMat, 0.0028, 0.0028, 0.002, 0, 0.052, -0.1315);
  const action = sP.build();
  group.add(action);

  // Detachable 15-round steel/polymer magazine
  const mP = new Parts();
  mP.box(M.steel, 0.022, 0.095, 0.038, 0, -0.068, 0.026, 0.24);
  mP.box(frameMat, 0.028, 0.012, 0.048, 0, -0.114, 0.036, 0.24);
  const mag = mP.build();
  group.add(mag);

  def.gripR = [0, -0.058, 0.026];
  def.gripL = [-0.026, -0.074, 0.012];
  const poseR = handPose(
    [0.024, -0.086, 0.102], [-0.08, 0.24, -0.97], [-0.94, 0.08, -0.32],
    [0.16, -0.3, 0.4], [0.65, 0.38, 0.96, 1.0, 1.02],
  );
  const poseL = handPose(
    [-0.052, -0.098, 0.086], [0.26, 0.18, -0.95], [0.86, 0.42, -0.28],
    [-0.2, -0.33, 0.39], [0.62, 0.88, 0.94, 0.98, 1.0],
  );
  return finish(M, def, group, mag, action, 0, [0, 0.022, -0.18], [0.022, 0.034, -0.042], 0.15, poseR, poseL);
}

export function buildGuns(): Record<WeaponId, GunModel> {
  loadLoadout(WEAPONS);
  const M = makeMats();
  return {
    m4a1: buildFP(M, WEAPONS.m4a1),
    scarl: buildFP(M, WEAPONS.scarl),
    ak47: buildFP(M, WEAPONS.ak47),
    mp5a5: buildFP(M, WEAPONS.mp5a5),
    awm: buildFP(M, WEAPONS.awm),
    m1911: buildFP(M, WEAPONS.m1911),
    qbz192: buildQbz192(M, WEAPONS.qbz192),
    qsz193: buildQsz193(M, WEAPONS.qsz193),
  };
}
