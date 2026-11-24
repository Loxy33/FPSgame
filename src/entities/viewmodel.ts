import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Spring, clamp, damp, easeInOut, lerp, rand } from '../core/utils';
import { FpArms, type HandPose } from './arms';
import { GunModel, buildGuns } from './guns';
import { WeaponId } from './weapons';

export type { GunModel } from './guns';

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------
/** Smooth keyframe track: keys = [t0, v0, t1, v1, ...] */
function kf(t: number, keys: number[]) {
  if (t <= keys[0]) return keys[1];
  for (let i = 2; i < keys.length; i += 2) {
    if (t <= keys[i]) {
      const u = (t - keys[i - 2]) / (keys[i] - keys[i - 2]);
      return lerp(keys[i - 1], keys[i + 1], u * u * (3 - 2 * u));
    }
  }
  return keys[keys.length - 1];
}

export interface VMState {
  dt: number;
  ads: number;
  sprint: number;
  /** Walk-cycle phase and amplitude (0..1). */
  bobPhase: number;
  bobAmp: number;
  strafe: number;
  vy: number;
  mouseDX: number;
  mouseDY: number;
  /** -1 when idle, else 0..1 progress. */
  reload: number;
  bolt: number;
  melee: number;
  throwing: number;
  /** 0 = holstered, 1 = ready. */
  equip: number;
  empty: boolean;
  crouch: number;
  /** 0..1 pull during a mantle / vault (weapon dips as the body passes the ledge). */
  mantle: number;
  /** Mantle progress 0..1, or -1 when not climbing. Drives the first-person hand animation. */
  mantleT: number;
  /** C4 planting animation progress 0..1, or -1 when idle. Drives dual-hand keypad arming & forward plant! */
  plantC4T?: number;
  /** 0..1 NVG tactical canted aiming (tilts rifle 38 deg for IR laser sight). */
  canted?: number;
}

interface SharedC4Kit {
  brickGeo: THREE.BufferGeometry;
  strapGeo: THREE.BufferGeometry;
  housingGeo: THREE.BufferGeometry;
  lcdGeo: THREE.BufferGeometry;
  keypadGeo: THREE.BufferGeometry;
  ledGeo: THREE.BufferGeometry;
  haloGeo: THREE.BufferGeometry;
  capGeo: THREE.BufferGeometry;
  wireGeo: THREE.BufferGeometry;
  brickMat: THREE.MeshStandardMaterial;
  strapMat: THREE.MeshStandardMaterial;
  steelMat: THREE.MeshStandardMaterial;
  keyMat: THREE.MeshStandardMaterial;
  wireRedMat: THREE.MeshStandardMaterial;
  wireYelMat: THREE.MeshStandardMaterial;
  brassMat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
}

let _sharedC4Kit: SharedC4Kit | null = null;
function getSharedC4Kit(): SharedC4Kit {
  if (_sharedC4Kit) return _sharedC4Kit;
  // Merge all 12 keypad buttons into 1 single BufferGeometry (12 draw calls -> 1!)
  const keyParts: THREE.BufferGeometry[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const kg = new THREE.BoxGeometry(0.015, 0.006, 0.0085);
      kg.translate(-0.032 + c * 0.021, 0.0465, 0.006 + r * 0.013);
      keyParts.push(kg);
    }
  }
  const keypadGeo = mergeGeometries(keyParts, false) ?? new THREE.BoxGeometry(0.08, 0.006, 0.036);
  for (const g of keyParts) g.dispose();

  _sharedC4Kit = {
    brickGeo: new THREE.BoxGeometry(0.165, 0.052, 0.106),
    strapGeo: new THREE.BoxGeometry(0.018, 0.056, 0.111),
    housingGeo: new THREE.BoxGeometry(0.118, 0.022, 0.084),
    lcdGeo: new THREE.PlaneGeometry(0.094, 0.032),
    keypadGeo,
    ledGeo: new THREE.SphereGeometry(0.0065, 10, 8),
    haloGeo: new THREE.SphereGeometry(0.032, 10, 8),
    capGeo: new THREE.CylinderGeometry(0.0055, 0.0055, 0.022, 8),
    wireGeo: new THREE.TorusGeometry(0.016, 0.0024, 6, 12, Math.PI),
    brickMat: new THREE.MeshStandardMaterial({ color: 0x7b7862, roughness: 0.84, metalness: 0.08 }),
    strapMat: new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.72, metalness: 0.2 }),
    steelMat: new THREE.MeshStandardMaterial({ color: 0x2a313a, roughness: 0.48, metalness: 0.72 }),
    keyMat: new THREE.MeshStandardMaterial({ color: 0x454d58, roughness: 0.55, metalness: 0.35 }),
    wireRedMat: new THREE.MeshStandardMaterial({ color: 0xd93024, roughness: 0.45, metalness: 0.15 }),
    wireYelMat: new THREE.MeshStandardMaterial({ color: 0xe6b428, roughness: 0.45, metalness: 0.15 }),
    brassMat: new THREE.MeshStandardMaterial({ color: 0xc99c3c, roughness: 0.38, metalness: 0.85 }),
    haloMat: new THREE.MeshBasicMaterial({
      color: 0xff3020,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
  return _sharedC4Kit;
}

/** Builds a detailed military C4 demolition charge with live backlit LCD screen, keypad, detonator wires & LED (shares static kit geo/mats!). */
export function buildC4Mesh(forWorld = false): {
  group: THREE.Group;
  lcdCanvas: HTMLCanvasElement;
  lcdCtx: CanvasRenderingContext2D;
  lcdTex: THREE.CanvasTexture;
  ledMat: THREE.MeshBasicMaterial;
} {
  const kit = getSharedC4Kit();
  const grp = new THREE.Group();
  const s = forWorld ? 1.65 : 1.0;

  const markShared = (m: THREE.Mesh, sharedMat = true) => {
    m.userData.sharedGeo = true;
    if (sharedMat) m.userData.sharedMat = true;
    return m;
  };

  // Main dual-block C4 brick body
  grp.add(markShared(new THREE.Mesh(kit.brickGeo, kit.brickMat)));
  // Twin black tactical webbing retention straps wrapped around brick
  for (const sx of [-0.048, 0.048]) {
    const strap = markShared(new THREE.Mesh(kit.strapGeo, kit.strapMat));
    strap.position.x = sx;
    grp.add(strap);
  }
  // Top digital detonator housing + beveled frame
  const housing = markShared(new THREE.Mesh(kit.housingGeo, kit.steelMat));
  housing.position.set(0, 0.034, 0.002);
  grp.add(housing);

  // Live backlit LCD screen CanvasTexture (per-instance)
  const lcdCanvas = document.createElement('canvas');
  lcdCanvas.width = 256;
  lcdCanvas.height = 96;
  const lcdCtx = lcdCanvas.getContext('2d')!;
  const lcdTex = new THREE.CanvasTexture(lcdCanvas);
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  const lcdMat = new THREE.MeshBasicMaterial({ map: lcdTex });
  const lcdMesh = markShared(new THREE.Mesh(kit.lcdGeo, lcdMat), false);
  lcdMesh.rotation.x = -Math.PI * 0.5;
  lcdMesh.position.set(-0.006, 0.046, -0.020);
  grp.add(lcdMesh);

  // Merged 3x4 tactile rubber keypad (single draw call!)
  grp.add(markShared(new THREE.Mesh(kit.keypadGeo, kit.keyMat)));

  // Blinking status LED dome (per-instance color) + shared additive glow halo at upper-right corner
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xff9a18 });
  const led = markShared(new THREE.Mesh(kit.ledGeo, ledMat), false);
  led.position.set(0.047, 0.046, -0.024);
  grp.add(led);
  if (forWorld) {
    const halo = markShared(new THREE.Mesh(kit.haloGeo, kit.haloMat));
    halo.name = 'ledHalo';
    halo.position.copy(led.position);
    grp.add(halo);
  }

  // Detonator blasting caps & red/yellow insulated wire leads into right flank
  for (const [wz, wMat] of [[-0.018, kit.wireRedMat], [0.016, kit.wireYelMat]] as [number, THREE.MeshStandardMaterial][]) {
    const cap = markShared(new THREE.Mesh(kit.capGeo, kit.brassMat));
    cap.rotation.z = Math.PI * 0.5;
    cap.position.set(0.072, 0.026, wz);
    grp.add(cap);
    const wire = markShared(new THREE.Mesh(kit.wireGeo, wMat));
    wire.position.set(0.064, 0.036, wz);
    grp.add(wire);
  }

  grp.scale.setScalar(s);
  grp.traverse((o) => {
    o.userData.noAo = true;
  });
  return { group: grp, lcdCanvas, lcdCtx, lcdTex, ledMat };
}

export function drawC4Lcd(
  ctx: CanvasRenderingContext2D,
  tex: THREE.CanvasTexture,
  text: string,
  sub: string,
  armed: boolean,
) {
  ctx.fillStyle = armed ? '#3a0909' : '#0b2216';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = armed ? '#ff3828' : '#32e078';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 90);
  ctx.fillStyle = armed ? '#ff4a38' : '#52ff98';
  ctx.font = 'bold 34px Consolas, "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 46);
  ctx.fillStyle = armed ? '#ffad96' : '#a2f5c4';
  ctx.font = 'bold 20px Consolas, "Courier New", monospace';
  ctx.fillText(sub, 128, 78);
  tex.needsUpdate = true;
}

export class ViewModel {
  models = {} as Record<WeaponId, GunModel>;
  current!: GunModel;
  private time = 0;
  private swayX = new Spring(90, 14);
  private swayY = new Spring(90, 14);
  private kickZ = new Spring(260, 22);
  private kickP = new Spring(210, 17);
  private kickR = new Spring(170, 14);
  private kickY = new Spring(170, 14);
  private landY = new Spring(120, 13);
  private flashT = 0;
  private actionT = 0;
  private tilt = 0;
  arms!: FpArms;
  private c4Prop!: ReturnType<typeof buildC4Mesh>;
  private c4LastStage = -1;
  private c4Root = new THREE.Group();
  /** Dev only: fixed [x, y, z, rx, ry, rz] for inspecting the weapon and hands from any side. */
  debug: number[] | null = null;
  /** Dev only: forces the ADS blend (0..1). */
  debugAds: number | null = null;
  /** Dev only: forces the reload progress (0..1). */
  debugReload: number | null = null;
  private mt = new THREE.Matrix4();
  private identity = new THREE.Matrix4();
  private armM = new THREE.Matrix4();
  private armP = new THREE.Vector3();
  private armQ = new THREE.Quaternion();
  private armS = new THREE.Vector3();

  /** Gun transform without its model scale: the arms must not inherit the weapon's size. */
  private armRoot(m: GunModel) {
    m.group.matrix.decompose(this.armP, this.armQ, this.armS);
    return this.armM.compose(this.armP, this.armQ, new THREE.Vector3(1, 1, 1));
  }

  constructor(private root: THREE.Group, private flashLight: THREE.PointLight) {
    this.models = buildGuns();
    this.arms = new FpArms(root);
    for (const id of Object.keys(this.models) as WeaponId[]) {
      const m = this.models[id];
      m.group.visible = false;
      m.group.rotation.order = 'YXZ';
      root.add(m.group);
    }
    this.c4Prop = buildC4Mesh(false);
    drawC4Lcd(this.c4Prop.lcdCtx, this.c4Prop.lcdTex, '------', 'C4 · STANDBY', false);
    this.c4Root.add(this.c4Prop.group);
    this.c4Root.visible = false;
    root.add(this.c4Root);
    this.setWeapon('m4a1');
  }

  /** Debug: where the palm lands relative to the grip, in gun-local millimetres. */
  handReport(id: WeaponId) {
    const m = this.models[id];
    const out: Record<string, unknown> = {};
    for (const [name, side, grip] of [['left', 0, m.def.gripL], ['right', 1, m.def.gripR]] as const) {
      const p = side === 0 ? m.poseL : m.poseR;
      const hl = this.arms.handLen[side] || 0.18;
      const palm = p.pos.clone().addScaledVector(p.fwd.clone().normalize(), hl * 0.45);
      out[name] = {
        wrist: p.pos.toArray().map((v) => +v.toFixed(3)),
        palm: palm.toArray().map((v) => +v.toFixed(3)),
        grip: grip ? grip.map((v) => +v.toFixed(3)) : null,
        errCm: grip ? +(palm.distanceTo(new THREE.Vector3(grip[0], grip[1], grip[2])) * 100).toFixed(1) : null,
      };
    }
    return out;
  }

  setWeapon(id: WeaponId) {
    if (this.current) this.current.group.visible = false;
    this.current = this.models[id];
    this.current.group.visible = true;
    this.arms.mesh.visible = true;
    this.flashT = 0;
    this.current.flash.visible = false;
  }

  setVisible(v: boolean) {
    this.current.group.visible = v;
    this.arms.mesh.visible = v;
    if (!v) this.c4Root.visible = false;
  }

  /** Rebuild the mounted attachment meshes after a loadout change. */
  refit(id: WeaponId) {
    const m = this.models[id];
    if (!m) return;
    m.refit();
    if (this.current === m) {
      m.group.visible = this.current.group.visible;
      this.flashT = 0;
      m.flash.visible = false;
    }
  }

  onFire(adsAmount: number) {
    const d = this.current.def;
    const k = 1 - adsAmount * 0.45;
    this.kickZ.impulse(d.kickBack * 1.25 * k);
    this.kickP.impulse(d.kickPitch * 0.9 * k);
    this.kickR.impulse(rand(-1, 1) * 0.5 * k);
    this.kickY.impulse(rand(-1, 1) * 0.35 * k);
    this.flashT = 0.045;
    this.actionT = 0.07;
    const f = this.current.flash;
    f.visible = true;
    const s = rand(0.8, 1.25) * (1 - adsAmount * 0.35);
    f.scale.setScalar(s);
    f.rotation.z = rand(0, Math.PI * 2);
    this.flashLight.position.copy(this.current.muzzle.position).applyMatrix4(this.current.group.matrix);
  }

  onLand(impact: number) {
    this.landY.impulse(-clamp(impact * 0.06, 0, 0.9));
  }

  /**
   * World-space point that appears, through the main camera, where a gun-local
   * point appears through the viewmodel camera. Used to start tracers / smoke at the muzzle.
   */
  worldPoint(obj: THREE.Object3D, mainCam: THREE.PerspectiveCamera, vmFov: number, out: THREE.Vector3) {
    obj.getWorldPosition(out);
    mainCam.worldToLocal(out);
    const k = Math.tan((mainCam.fov * Math.PI) / 360) / Math.tan((vmFov * Math.PI) / 360);
    out.x *= k;
    out.y *= k;
    return mainCam.localToWorld(out);
  }

  update(s: VMState) {
    const dt = s.dt;
    this.time += dt;
    const m = this.current;
    const d = m.def;
    const ads = easeInOut(this.debugAds ?? s.ads);
    const sprint = easeInOut(s.sprint) * (1 - ads);
    const calm = 1 - ads * 0.85;

    let px = lerp(d.hipPos[0], d.adsPos[0], ads);
    let py = lerp(d.hipPos[1], d.adsPos[1], ads);
    let pz = lerp(d.hipPos[2], d.adsPos[2], ads);
    let rx = d.hipRot[0] * (1 - ads);
    let ry = d.hipRot[1] * (1 - ads);
    let rz = d.hipRot[2] * (1 - ads);

    // crouch: slight cant
    px -= s.crouch * 0.008 * (1 - ads);
    rz += s.crouch * 0.05 * (1 - ads);

    // NVG tactical canted IR laser stance when aiming down sights with night vision active
    const cant = (s.canted ?? 0) * ads;
    if (cant > 0.001) {
      px += cant * 0.042;
      py -= cant * 0.022;
      pz += cant * 0.03;
      rz += cant * 0.62;
    }

    // sprint carry
    const pistol = d.family === 'pistol';
    if (pistol) {
      py += sprint * -0.05;
      rx += sprint * -0.5;
      pz += sprint * 0.04;
    } else {
      px += sprint * -0.045;
      py += sprint * -0.035;
      pz += sprint * 0.05;
      rx += sprint * -0.12;
      ry += sprint * 0.62;
      rz += sprint * 0.22;
    }

    // breathing
    py += Math.sin(this.time * 1.25) * 0.0016 * (1 - ads * 0.6);
    rx += Math.sin(this.time * 1.05 + 1) * 0.004 * (1 - ads * 0.7);
    ry += Math.sin(this.time * 0.7) * 0.003 * (1 - ads * 0.7);

    // locomotion bob
    const amp = s.bobAmp * calm * (1 + sprint * 1.6);
    px += Math.cos(s.bobPhase) * 0.0075 * amp;
    py += -Math.abs(Math.sin(s.bobPhase)) * 0.009 * amp + 0.004 * amp;
    rz += Math.cos(s.bobPhase) * 0.014 * amp;
    rx += Math.sin(s.bobPhase * 2) * 0.008 * amp;

    // look sway + strafe tilt
    const sx = this.swayX.update(clamp(-s.mouseDX * 0.0011, -0.07, 0.07), dt);
    const sy = this.swayY.update(clamp(-s.mouseDY * 0.0011, -0.07, 0.07), dt);
    px += sx * 0.25 * calm;
    py -= sy * 0.2 * calm;
    ry += sx * 0.9 * calm;
    rx += sy * 0.9 * calm;
    this.tilt = damp(this.tilt, s.strafe, 8, dt);
    rz -= this.tilt * 0.045 * (1 - ads * 0.5);
    px += this.tilt * 0.006 * calm;

    // jump / land inertia
    py += clamp(-s.vy * 0.0035, -0.03, 0.03) * calm;
    py += this.landY.update(0, dt) * 0.05;

    // mantle / vault: the weapon is pulled in and down while the body clears the ledge
    const mt = s.mantle;
    if (mt > 0.001) {
      py -= mt * 0.2;
      pz += mt * 0.02;
      px += mt * 0.05;
      rx -= mt * 0.85;
      rz += mt * 0.3;
    }

    // C4 Planting: smoothly stow weapon down out of view while both hands arm & plant the C4 charge!
    const c4T = s.plantC4T ?? -1;
    if (c4T >= 0) {
      const stow = kf(c4T, [0, 0, 0.14, 1, 0.86, 1, 1, 0]);
      py -= stow * 0.36;
      pz += stow * 0.08;
      rx -= stow * 0.92;
      rz += stow * 0.32;
    }

    // recoil
    pz += this.kickZ.update(0, dt) * 0.0105;
    const kp = this.kickP.update(0, dt);
    rx += kp * 0.011;
    py += kp * 0.0012;
    rz += this.kickR.update(0, dt) * 0.012;
    ry += this.kickY.update(0, dt) * 0.008;

    // equip / holster
    const eq = easeInOut(s.equip);
    py -= (1 - eq) * 0.26;
    rx -= (1 - eq) * 0.7;
    rz += (1 - eq) * 0.25;

    // --- per-weapon action animation ---
    let magY = 0, magRot = 0, magVisible = true;
    let lx = 0, ly = 0, lz = 0, lr = 0;
    let ax = 0, ay = 0, az = 0;
    this.actionT = Math.max(0, this.actionT - dt);
    const cyc = this.actionT > 0 ? Math.sin((1 - this.actionT / 0.07) * Math.PI) : 0;

    const reloadT = this.debugReload ?? s.reload;
    if (reloadT >= 0) {
      const t = reloadT;
      if (d.family === 'rifle') {
        // cant the rifle so the magazine well turns in towards the support hand
        rz += kf(t, [0, 0, 0.11, -0.52, 0.68, -0.52, 0.78, -0.28, 0.86, -0.08, 1, 0]);
        rx += kf(t, [0, 0, 0.11, 0.18, 0.68, 0.2, 0.76, 0.28, 0.86, 0.08, 1, 0]);
        ry += kf(t, [0, 0, 0.11, 0.16, 0.68, 0.16, 0.78, 0.05, 1, 0]);
        px += kf(t, [0, 0, 0.11, -0.015, 0.68, -0.015, 1, 0]);
        // weapon dips slightly when mag is dropped, kicks up on snap insertion, then settles
        py += kf(t, [0, 0, 0.11, 0.045, 0.22, 0.035, 0.58, 0.045, 0.62, 0.075, 0.68, 0.052, 0.78, 0.065, 0.86, 0.03, 1, 0]);
        magY = kf(t, [0, 0, 0.12, 0, 0.22, -0.22, 0.42, -0.22, 0.58, 0]);
        magRot = kf(t, [0, 0, 0.12, 0, 0.22, 0.32, 0.42, 0.25, 0.58, 0]);
        magVisible = !(t > 0.24 && t < 0.40);
        lz = kf(t, [0, 0, 0.11, 0.22, 0.60, 0.22, 0.72, 0.26, 0.84, 0.26, 1, 0]);
        ly = kf(t, [0, 0, 0.11, -0.08, 0.22, -0.42, 0.40, -0.42, 0.58, -0.04, 0.64, 0.04, 0.74, 0.06, 0.84, 0.03, 1, 0]);
        lx = kf(t, [0, 0, 0.58, 0, 0.72, -0.03, 0.84, -0.02, 1, 0]);
      } else if (d.family === 'pistol') {
        rz += kf(t, [0, 0, 0.08, -0.38, 0.58, -0.38, 0.68, -0.15, 0.88, -0.06, 1, 0]);
        rx += kf(t, [0, 0, 0.08, 0.16, 0.58, 0.18, 0.68, 0.08, 0.88, 0.04, 1, 0]);
        ry += kf(t, [0, 0, 0.08, 0.14, 0.58, 0.14, 0.68, 0.02, 1, 0]);
        px += kf(t, [0, 0, 0.08, -0.012, 0.58, -0.012, 0.68, 0.0, 1, 0]);
        py += kf(t, [0, 0, 0.08, 0.05, 0.48, 0.05, 0.52, 0.078, 0.58, 0.05, 0.68, 0.02, 1, 0]);
        magY = kf(t, [0, 0, 0.1, 0, 0.18, -0.3, 0.38, -0.3, 0.52, 0]);
        magRot = kf(t, [0, 0, 0.1, 0, 0.18, 0.38, 0.38, 0.28, 0.52, 0]);
        magVisible = !(t > 0.19 && t < 0.36);
        lz = kf(t, [0, 0, 0.08, 0.18, 0.52, 0.18, 0.68, 0, 1, 0]);
        ly = kf(t, [0, 0, 0.08, -0.05, 0.18, -0.38, 0.38, -0.38, 0.52, 0.03, 0.58, -0.04, 0.68, 0, 1, 0]);
        // cycle the bolt/slide at the end of the reload
        const bt = clamp((t - 0.68) / 0.24, 0, 1);
        if (t > 0.68) { ay = this.boltLift(bt); az = this.boltPull(bt); }
      } else {
        rz += kf(t, [0, 0, 0.12, -0.42, 0.64, -0.42, 0.82, -0.1, 1, 0]);
        rx += kf(t, [0, 0, 0.12, 0.28, 0.64, 0.28, 0.78, 0.36, 0.86, 0.08, 1, 0]);
        py += kf(t, [0, 0, 0.12, 0.03, 0.52, 0.03, 0.56, 0.055, 0.64, 0.03, 1, 0]);
        magY = kf(t, [0, 0, 0.12, 0, 0.24, -0.28, 0.40, -0.28, 0.56, 0]);
        magVisible = !(t > 0.25 && t < 0.38);
        ly = kf(t, [0, 0, 0.12, -0.05, 0.24, -0.36, 0.40, -0.36, 0.56, 0.02, 0.7, -0.03, 0.84, 0, 1, 0]);
        lz = kf(t, [0, 0, 0.12, 0.02, 0.84, 0.02, 1, 0]);
        lx = kf(t, [0, 0, 0.12, -0.03, 0.56, -0.01, 0.84, 0, 1, 0]);
      }
    }
    if (s.bolt >= 0 && d.family === 'dmr' && d.boltTime > 0) {
      const t = s.bolt;
      ay = this.boltLift(t);
      az = this.boltPull(t);
      rz += kf(t, [0, 0, 0.2, -0.16, 0.8, -0.16, 1, 0]);
      rx += kf(t, [0, 0, 0.2, 0.05, 0.45, 0.09, 0.8, 0.04, 1, 0]);
      px += kf(t, [0, 0, 0.2, 0.012, 0.8, 0.012, 1, 0]);
    }
    if (s.melee >= 0) {
      const t = s.melee;
      pz += kf(t, [0, 0, 0.25, -0.2, 0.5, -0.12, 1, 0]);
      px += kf(t, [0, 0, 0.25, -0.1, 0.5, -0.06, 1, 0]);
      py += kf(t, [0, 0, 0.25, 0.05, 1, 0]);
      rz += kf(t, [0, 0, 0.25, 1.1, 0.5, 0.9, 1, 0]);
      ry += kf(t, [0, 0, 0.25, 0.5, 0.5, 0.35, 1, 0]);
    }
    if (s.throwing >= 0) {
      const t = s.throwing;
      py += kf(t, [0, 0, 0.25, -0.12, 0.7, -0.1, 1, 0]);
      rx += kf(t, [0, 0, 0.25, -0.3, 0.7, -0.22, 1, 0]);
      rz += kf(t, [0, 0, 0.25, 0.3, 0.7, 0.24, 1, 0]);
      ly += kf(t, [0, 0, 0.2, -0.3, 0.38, 0.1, 0.5, -0.1, 0.75, -0.3, 1, 0]);
      lz += kf(t, [0, 0, 0.2, 0.25, 0.38, -0.05, 0.5, -0.2, 0.75, 0.2, 1, 0]);
      lx += kf(t, [0, 0, 0.2, -0.08, 0.5, 0.05, 1, 0]);
    }

    if (this.debug) [px, py, pz, rx, ry, rz] = this.debug;
    m.group.position.set(px, py, pz);
    m.group.rotation.set(rx, ry, rz);
    m.mag.position.set(0, magY, magY * -0.15);
    m.mag.rotation.x = magRot;
    m.mag.visible = magVisible;
    m.leftArm.position.set(lx, ly, lz);
    m.leftArm.rotation.z = lr;

    // reciprocating action
    if (d.family === 'rifle') {
      m.action.position.z = cyc * 0.05;
    } else if (d.family === 'pistol') {
      m.action.position.z = s.empty && s.reload < 0.8 ? 0.032 : cyc * 0.036;
    } else {
      m.action.rotation.z = ay * 1.5;
      m.action.position.z = m.actionZ + az;
      // right hand follows the bolt knob while cycling
      const follow = Math.min(1, Math.abs(ay) * 1.4 + az * 30);
      m.rightArm.position.set(0.03 * follow, 0.07 * follow + ay * 0.02, -0.035 * follow + az);
      m.rightArm.rotation.z = -0.2 * follow;
    }
    void ax;

    // hands follow their anchors on the weapon — except while climbing, when both hands leave
    // the weapon and grab the ledge in front of the camera
    m.group.updateMatrix();
    m.rightArm.updateMatrix();
    m.leftArm.updateMatrix();
    if (c4T >= 0) {
      this.updateC4Plant(c4T);
    } else {
      this.c4Root.visible = false;
      this.c4LastStage = -1;
      if (s.mantleT >= 0) {
        // both hands plant on the lip, close to the body with bent elbows and staggered timing:
        // the old version reached straight out at arm's length and read as zombie arms
        this.arms.pose(0, this.identity, this.mantleHand(s.mantleT, 0));
        this.arms.pose(1, this.identity, this.mantleHand(s.mantleT, 1));
      } else {
        this.arms.pose(1, this.mt.multiplyMatrices(this.armRoot(m), m.rightArm.matrix), m.poseR);
        this.arms.pose(0, this.mt.multiplyMatrices(this.armRoot(m), m.leftArm.matrix), m.poseL);
      }
    }

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = 9 * d.flashScale;
      if (this.flashT <= 0) m.flash.visible = false;
    } else {
      this.flashLight.intensity = 0;
    }
  }

  /**
   * First-person climb pose, in camera space: both hands reach for the ledge, plant on it,
   * then push down as the body rises past the edge and finally drop back to the weapon.
   * `t` is the mantle progress (0..1).
   */
  private mantleHand(t: number, side: 0 | 1): HandPose {
    const s = side === 0 ? -1 : 1;
    const ease = (x: number) => {
      const c = Math.max(0, Math.min(1, x));
      return c * c * (3 - 2 * c);
    };
    // Asymmetric mantle: left hand catches ledge first, right follows
    const tt = Math.max(0, Math.min(1, t + (side === 0 ? 0.025 : -0.02)));
    const reach = ease(tt / 0.22);            // hands reach up to grasp ledge
    const plant = ease((tt - 0.22) / 0.24);   // weight settles onto palms/fingers
    const push = ease((tt - 0.46) / 0.34);   // torso pulls up, palms push down
    const release = ease((tt - 0.80) / 0.20); // hands disengage and blend back to weapon

    // Ergonomic shoulder width (approx 0.18 - 0.22m from center, avoids wide zombie-arm look)
    const x = s * (0.19 + 0.015 * Math.sin(tt * Math.PI));

    // Vertical arc: reach up, press down, then tuck into chest before returning
    let y = -0.45;
    y = lerp(y, -0.08, reach);
    y = lerp(y, -0.82, push);
    // Weight settle dip when hands contact ledge
    y -= Math.sin(Math.min(1, plant) * Math.PI) * 0.025;
    // Release tuck
    y += release * 0.32;

    // Depth: reaches out forward to ledge edge, then passes under torso
    let z = -0.48;
    z = lerp(z, -0.62, reach);
    z = lerp(z, -0.42, push);
    z += release * 0.08;

    // Fingers firmly grip lip: curled during reach and plant, opening as body clears
    const curl = Math.max(0.2, 0.45 + 0.65 * reach + 0.2 * plant - 0.95 * release);

    return {
      pos: new THREE.Vector3(x, y, z),
      fwd: new THREE.Vector3(-s * 0.08, -0.28, -0.92).normalize(),
      palm: new THREE.Vector3(0, -1, 0.18).normalize(),
      elbow: new THREE.Vector3(x * 1.5, y - 0.42, z + 0.26),
      curl: [curl * 0.72, curl * 0.95, curl * 1.05, curl * 1.0, curl * 0.88],
    };
  }

  private c4LeftPose: HandPose = {
    pos: new THREE.Vector3(),
    fwd: new THREE.Vector3(0.45, 0.25, -0.85).normalize(),
    palm: new THREE.Vector3(0.45, 0.85, 0.15).normalize(),
    elbow: new THREE.Vector3(),
    curl: [0.55, 0.75, 0.8, 0.82, 0.85],
  };
  private c4RightPose: HandPose = {
    pos: new THREE.Vector3(),
    fwd: new THREE.Vector3(-0.32, -0.28, -0.90).normalize(),
    palm: new THREE.Vector3(-0.22, -0.92, 0.25).normalize(),
    elbow: new THREE.Vector3(),
    curl: [0.45, 0.55, 0.58, 0.60, 0.62],
  };

  /**
   * First-person AAA C4 arming & planting animation (`t` in 0..1):
   *  - 0.00..0.18: Left hand raises C4 brick up in front of camera
   *  - 0.18..0.68: Right hand taps 6-digit arming code onto the keypad (LCD updates live!)
   *  - 0.68..0.85: Both hands thrust armed C4 firmly forward onto the target (LED turns rapid-blink red!)
   *  - 0.85..1.00: C4 detaches to world space; hands retract cleanly back to weapon
   */
  private updateC4Plant(t: number) {
    const showProp = t < 0.855;
    this.c4Root.visible = showProp;

    // Update LCD display & LED color cleanly as digits are typed
    const code = '735560';
    let stage = 0;
    if (t >= 0.70) stage = 7;
    else if (t >= 0.20) stage = Math.min(6, 1 + Math.floor(((t - 0.20) / 0.48) * 6));
    if (stage !== this.c4LastStage) {
      this.c4LastStage = stage;
      if (stage === 0) {
        drawC4Lcd(this.c4Prop.lcdCtx, this.c4Prop.lcdTex, '------', 'C4 · STANDBY', false);
      } else if (stage <= 6) {
        const entered = code.slice(0, stage).padEnd(6, '-');
        drawC4Lcd(this.c4Prop.lcdCtx, this.c4Prop.lcdTex, entered, 'ARMING CODE', false);
      } else {
        drawC4Lcd(this.c4Prop.lcdCtx, this.c4Prop.lcdTex, 'ARMED!', 'DET: 03.0s', true);
      }
    }
    if (stage >= 7) {
      const blink = Math.sin(this.time * 28) > 0;
      this.c4Prop.ledMat.color.setHex(blink ? 0xff2818 : 0x550808);
    } else if (stage >= 1) {
      this.c4Prop.ledMat.color.setHex(0x38ff88);
    } else {
      this.c4Prop.ledMat.color.setHex(0xffaa18);
    }

    // C4 satchel trajectory in camera space
    const c4X = kf(t, [0, -0.14, 0.18, -0.02, 0.68, -0.015, 0.78, 0.0, 0.86, 0.0, 1, 0.0]);
    const c4Y = kf(t, [0, -0.34, 0.18, -0.115, 0.68, -0.11, 0.78, -0.075, 0.86, -0.08, 1, -0.08]);
    const c4Z = kf(t, [0, -0.24, 0.18, -0.34, 0.68, -0.34, 0.79, -0.56, 0.86, -0.58, 1, -0.58]);
    const c4RX = kf(t, [0, 0.45, 0.18, 0.82, 0.68, 0.82, 0.79, 1.38, 0.86, 1.42, 1, 1.42]);
    const c4RY = kf(t, [0, 0.25, 0.18, 0.06, 0.68, 0.04, 0.79, 0.0, 1, 0.0]);
    const c4RZ = kf(t, [0, -0.15, 0.18, -0.04, 0.68, -0.03, 0.79, 0.0, 1, 0.0]);
    // Subtle recoil bump on each keypad press
    let tapDip = 0;
    let rTapX = 0, rTapY = 0, rTapZ = 0;
    if (t >= 0.20 && t < 0.68) {
      const u = ((t - 0.20) / 0.48) * 6;
      const idx = Math.floor(u);
      const frac = u - idx;
      const press = Math.sin(frac * Math.PI);
      tapDip = press * 0.0055;
      // Right fingertip hops across the 4 keypad columns
      const col = idx % 4;
      const row = Math.floor(idx / 3) % 2;
      rTapX = -0.026 + col * 0.018;
      rTapY = -press * 0.026 + 0.028 - row * 0.012;
      rTapZ = -press * 0.018;
    }

    this.c4Root.position.set(c4X, c4Y - tapDip, c4Z);
    this.c4Root.rotation.set(c4RX, c4RY, c4RZ, 'YXZ');

    // Left hand cradles the C4 from the left underside, then helps press it forward onto target, then retracts
    const lx = kf(t, [0, -0.26, 0.18, -0.125, 0.68, -0.12, 0.79, -0.11, 0.86, -0.13, 1, -0.24]);
    const ly = kf(t, [0, -0.44, 0.18, -0.185, 0.68, -0.18, 0.79, -0.12, 0.86, -0.16, 1, -0.42]);
    const lz = kf(t, [0, -0.28, 0.18, -0.33, 0.68, -0.33, 0.79, -0.51, 0.86, -0.46, 1, -0.28]);
    this.c4LeftPose.pos.set(lx, ly - tapDip, lz);
    this.c4LeftPose.elbow.set(lx - 0.18, ly - 0.34, lz + 0.24);

    // Right hand rises to type 6-digit keypad, presses forward on the C4 clamp, then retracts cleanly
    const rx = kf(t, [0, 0.26, 0.18, 0.11, 0.68, 0.10, 0.79, 0.11, 0.86, 0.14, 1, 0.24]) + rTapX;
    const ry = kf(t, [0, -0.42, 0.18, -0.11, 0.68, -0.11, 0.79, -0.11, 0.86, -0.16, 1, -0.40]) + rTapY;
    const rz = kf(t, [0, -0.26, 0.18, -0.27, 0.68, -0.27, 0.79, -0.50, 0.86, -0.44, 1, -0.26]) + rTapZ;
    const typing = t >= 0.18 && t < 0.68;
    this.c4RightPose.pos.set(rx, ry, rz);
    this.c4RightPose.elbow.set(rx + 0.18, ry - 0.32, rz + 0.22);
    // Extended index finger while tapping keypad; flat palm press when planting!
    const rc = this.c4RightPose.curl;
    if (typing) { rc[0] = 0.65; rc[1] = 0.15; rc[2] = 0.95; rc[3] = 0.98; rc[4] = 0.98; }
    else { rc[0] = 0.45; rc[1] = 0.55; rc[2] = 0.58; rc[3] = 0.60; rc[4] = 0.62; }

    this.arms.pose(0, this.identity, this.c4LeftPose);
    this.arms.pose(1, this.identity, this.c4RightPose);
  }

  private boltLift(t: number) {
    return kf(t, [0, 0, 0.14, 0, 0.3, 1.0, 0.72, 1.0, 0.9, 0, 1, 0]);
  }
  private boltPull(t: number) {
    return kf(t, [0, 0, 0.3, 0, 0.46, 0.075, 0.56, 0.075, 0.72, 0, 1, 0]);
  }
}
