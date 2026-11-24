import * as THREE from 'three';
import { audio } from '../core/audio';
import { easeOutCubic } from '../core/utils';
import { texSets } from '../render/materials';
import { makePropObject } from '../render/assets';

/**
 * etype    — olive E-type silhouette on a pop-up lifter (range)
 * hostile  — armed figure on a turning stand (kill house)
 * civilian — hands-up figure on a turning stand (do not shoot)
 * steel    — swinging steel plate (long range)
 * dummy    — melee training dummy
 */
export type TargetKind = 'etype' | 'hostile' | 'civilian' | 'steel' | 'dummy';
export type HitZone = 'head' | 'body';
export type HitHow = 'shot' | 'blast' | 'melee' | 'npc';

export interface TargetSpec {
  id: string;
  kind: TargetKind;
  group: string;
  x: number;
  z: number;
  y?: number;
  /** The printed face looks along this yaw (towards the shooter). */
  yaw: number;
  up?: boolean;
}

export interface TargetHit {
  target: Target;
  t: number;
  zone: HitZone;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

// ---------------------------------------------------------------------------
// Shapes (metres, face plane z = 0, y up from the hinge)
// ---------------------------------------------------------------------------

const ETYPE_Y0 = 0.5;

function etypeShape() {
  const s = new THREE.Shape();
  const y = ETYPE_Y0;
  s.moveTo(-0.25, y);
  s.lineTo(0.25, y);
  s.lineTo(0.25, y + 0.6);
  s.quadraticCurveTo(0.25, y + 0.71, 0.12, y + 0.735);
  s.lineTo(0.06, y + 0.75);
  s.absarc(0, y + 0.865, 0.122, -1.06, Math.PI + 1.06, false);
  s.lineTo(-0.12, y + 0.735);
  s.quadraticCurveTo(-0.25, y + 0.71, -0.25, y + 0.6);
  s.closePath();
  return s;
}

function humanShape(civ: boolean) {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0.04);
  s.lineTo(-0.035, 0.04);
  s.lineTo(-0.02, 0.8);
  s.lineTo(0.02, 0.8);
  s.lineTo(0.035, 0.04);
  s.lineTo(0.2, 0.04);
  s.lineTo(0.215, 0.92);
  if (civ) {
    s.lineTo(0.24, 1.22);
    s.lineTo(0.25, 1.4);
    s.quadraticCurveTo(0.34, 1.5, 0.35, 1.72);
    s.lineTo(0.37, 1.88);
    s.quadraticCurveTo(0.33, 1.95, 0.29, 1.88);
    s.lineTo(0.255, 1.68);
    s.quadraticCurveTo(0.22, 1.55, 0.17, 1.5);
  } else {
    // rifle held at the low ready, muzzle out to the right
    s.lineTo(0.23, 1.1);
    s.lineTo(0.47, 1.18);
    s.lineTo(0.475, 1.215);
    s.lineTo(0.25, 1.24);
    s.lineTo(0.26, 1.4);
    s.quadraticCurveTo(0.25, 1.48, 0.17, 1.5);
  }
  s.lineTo(0.065, 1.525);
  s.absarc(0, 1.635, 0.115, -0.97, Math.PI + 0.97, false);
  s.lineTo(-0.17, 1.5);
  if (civ) {
    s.quadraticCurveTo(-0.22, 1.55, -0.255, 1.68);
    s.lineTo(-0.29, 1.88);
    s.quadraticCurveTo(-0.33, 1.95, -0.37, 1.88);
    s.lineTo(-0.35, 1.72);
    s.quadraticCurveTo(-0.34, 1.5, -0.25, 1.4);
    s.lineTo(-0.24, 1.22);
  } else {
    s.quadraticCurveTo(-0.25, 1.48, -0.26, 1.4);
    s.lineTo(-0.24, 1.2);
  }
  s.lineTo(-0.215, 0.92);
  s.closePath();
  return s;
}

/** Point-in-silhouette tests matching the shapes above. */
function insideEtype(x: number, y: number) {
  const ly = y - ETYPE_Y0;
  if (ly < 0) return false;
  if (ly <= 0.62) return Math.abs(x) <= 0.25;
  if (ly <= 0.75) return Math.abs(x) <= 0.25 - (ly - 0.62) * 1.2;
  return x * x + (ly - 0.865) ** 2 <= 0.125 * 0.125;
}
function insideHuman(x: number, y: number, civ: boolean) {
  const ax = Math.abs(x);
  if (y < 0.04) return false;
  if (y < 0.8) return ax <= 0.2 && ax >= 0.03 * (1 - y / 0.8);
  if (y < 1.5) {
    if (ax <= 0.215 + (y - 0.8) * 0.06) return true;
    if (!civ && x > 0 && y > 1.1 && y < 1.24 && x < 0.47) return true;
    if (civ && y > 1.38) return ax <= 0.37;
    return false;
  }
  if (civ && y < 1.92 && ax >= 0.24 && ax <= 0.37) return true;
  return x * x + (y - 1.635) ** 2 <= 0.12 * 0.12;
}

// ---------------------------------------------------------------------------
// Printed faces
// ---------------------------------------------------------------------------

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, col: string, r = 2) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    g.globalAlpha = Math.random() * 0.5;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, Math.random() * r + 0.4, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Texture space: u = (x + W/2) / W, v = y / H (canvas y flipped). */
function etypeTexture() {
  const W = 256, H = 512;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#56603a';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 900, '#3d4628', 2.5);
    speckle(g, W, H, 500, '#6e784c', 2);
    // patches of target tape from earlier sessions
    for (let i = 0; i < 9; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(118,128,82,0.95)' : 'rgba(84,92,58,0.95)';
      g.save();
      g.translate(40 + Math.random() * (W - 80), 140 + Math.random() * (H - 220));
      g.rotate((Math.random() - 0.5) * 0.6);
      g.fillRect(-11, -11, 22, 22);
      g.restore();
    }
    // faint scoring outline
    g.strokeStyle = 'rgba(30,34,20,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(W / 2, H * 0.52, W * 0.28, H * 0.16, 0, 0, Math.PI * 2);
    g.stroke();
  });
}

function figureTexture(civ: boolean) {
  const W = 512, H = 1024;
  // figure spans x [-0.4, 0.4], y [0, 2.0] metres
  const X = (x: number) => (x / 0.8 + 0.5) * W, Y = (y: number) => (1 - y / 2.0) * H, S = W / 0.8;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#a68b65';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 1500, '#8a7050', 3);
    const skin = civ ? '#c99a74' : '#9a7258';
    const top = civ ? '#6f98c0' : '#6b2a1c';
    const pants = civ ? '#b6a27a' : '#3a3228';
    // legs
    g.fillStyle = pants;
    g.fillRect(X(-0.22), Y(0.95), 0.44 * S, 0.95 * S);
    g.fillStyle = civ ? '#5a4a36' : '#1e1a16';
    g.fillRect(X(-0.22), Y(0.12), 0.44 * S, 0.1 * S);
    // torso
    g.fillStyle = top;
    g.fillRect(X(-0.27), Y(1.52), 0.54 * S, 0.62 * S);
    if (civ) {
      // raised arms
      g.fillRect(X(-0.38), Y(1.92), 0.15 * S, 0.5 * S);
      g.fillRect(X(0.23), Y(1.92), 0.15 * S, 0.5 * S);
      g.fillStyle = skin;
      g.fillRect(X(-0.38), Y(1.95), 0.15 * S, 0.1 * S);
      g.fillRect(X(0.23), Y(1.95), 0.15 * S, 0.1 * S);
      // collar, buttons
      g.fillStyle = '#e8e4da';
      g.beginPath();
      g.moveTo(X(-0.07), Y(1.52)); g.lineTo(X(0), Y(1.42)); g.lineTo(X(0.07), Y(1.52)); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let k = 0; k < 4; k++) g.fillRect(X(-0.006), Y(1.4 - k * 0.1), 0.012 * S, 0.012 * S);
    } else {
      // chest rig + magazines
      g.fillStyle = '#3e3b2c';
      g.fillRect(X(-0.2), Y(1.42), 0.4 * S, 0.3 * S);
      g.fillStyle = '#2c2a20';
      for (let k = 0; k < 3; k++) g.fillRect(X(-0.17 + k * 0.12), Y(1.32), 0.09 * S, 0.17 * S);
      // rifle across the body
      g.save();
      g.translate(X(0.0), Y(1.18));
      g.rotate(-0.16);
      g.fillStyle = '#161616';
      g.fillRect(-0.24 * S, -0.03 * S, 0.72 * S, 0.06 * S);
      g.fillRect(-0.05 * S, 0.02 * S, 0.06 * S, 0.14 * S);
      g.fillRect(0.12 * S, 0.02 * S, 0.035 * S, 0.1 * S);
      g.restore();
      // hands
      g.fillStyle = skin;
      g.fillRect(X(-0.1), Y(1.2), 0.07 * S, 0.06 * S);
      g.fillRect(X(0.13), Y(1.24), 0.07 * S, 0.06 * S);
    }
    // head
    g.fillStyle = skin;
    g.beginPath();
    g.arc(X(0), Y(1.635), 0.115 * S, 0, Math.PI * 2);
    g.fill();
    if (civ) {
      g.fillStyle = '#2a1e16';
      g.beginPath();
      g.arc(X(0), Y(1.69), 0.1 * S, Math.PI, 0);
      g.fill();
    } else {
      // balaclava with an eye slit
      g.fillStyle = '#1c1916';
      g.beginPath();
      g.arc(X(0), Y(1.635), 0.117 * S, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = skin;
      g.fillRect(X(-0.07), Y(1.665), 0.14 * S, 0.035 * S);
      g.fillStyle = '#111';
      g.fillRect(X(-0.05), Y(1.66), 0.025 * S, 0.02 * S);
      g.fillRect(X(0.025), Y(1.66), 0.025 * S, 0.02 * S);
    }
    // scoring zones on hostiles
    if (!civ) {
      g.strokeStyle = 'rgba(255,214,170,0.35)';
      g.lineWidth = 3;
      g.strokeRect(X(-0.11), Y(1.42), 0.22 * S, 0.34 * S);
      g.strokeRect(X(-0.06), Y(1.7), 0.12 * S, 0.1 * S);
    }
    speckle(g, W, H, 700, 'rgba(40,30,20,1)', 2);
  });
}

function plateTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#e6e3da';
    g.fillRect(0, 0, 256, 256);
    // lead splashes from earlier hits, and chipped paint
    for (let i = 0; i < 16; i++) {
      const x = 128 + (Math.random() - 0.5) * 150, y = 128 + (Math.random() - 0.5) * 150;
      g.fillStyle = 'rgba(70,70,72,0.75)';
      g.beginPath();
      g.arc(x, y, 2 + Math.random() * 4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(90,90,92,0.4)';
      g.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); g.stroke();
      }
    }
    speckle(g, 256, 256, 300, '#9a978e', 1.5);
  });
}

// ---------------------------------------------------------------------------

interface Shared {
  etype: THREE.MeshStandardMaterial;
  hostile: THREE.MeshStandardMaterial;
  civilian: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  burlap: THREE.MeshStandardMaterial;
  geo: Record<string, THREE.BufferGeometry>;
}

function extrude(shape: THREE.Shape, depth: number, x0: number, w: number, y0: number, h: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x0) / w, (pos.getY(i) - y0) / h);
  g.computeVertexNormals();
  return g;
}

function makeShared(): Shared {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const wood = texSets.wood, burl = texSets.burlap;
  const geo: Record<string, THREE.BufferGeometry> = {
    etype: extrude(etypeShape(), 0.01, -0.25, 0.5, 0, 1.0),
    hostile: extrude(humanShape(false), 0.02, -0.4, 0.8, 0, 2.0),
    civilian: extrude(humanShape(true), 0.02, -0.4, 0.8, 0, 2.0),
    plate: new THREE.CylinderGeometry(0.25, 0.25, 0.016, 28).rotateX(Math.PI / 2),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    sack: new THREE.CylinderGeometry(0.2, 0.23, 0.78, 14, 3),
    head: new THREE.SphereGeometry(0.13, 12, 8),
  };
  // E-type: board spans y in [ETYPE_Y0, ETYPE_Y0 + 1]
  const e = geo.etype.attributes;
  for (let i = 0; i < e.position.count; i++) e.uv.setY(i, (e.position.getY(i) - ETYPE_Y0) / 1.0);
  return {
    etype: std({ map: etypeTexture(), roughness: 0.92 }),
    hostile: std({ map: figureTexture(false), roughness: 0.8 }),
    civilian: std({ map: figureTexture(true), roughness: 0.8 }),
    plate: std({ map: plateTexture(), roughness: 0.55, metalness: 0.15 }),
    frame: std({ color: 0x3c4232, roughness: 0.6, metalness: 0.4 }),
    wood: std({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, color: 0xb59a76 }),
    burlap: std({ map: burl.map, normalMap: burl.normalMap, roughnessMap: burl.roughnessMap, color: 0xd8c8a8 }),
    geo,
  };
}

const _inv = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Target {
  root = new THREE.Group();
  /** Hinge (pop-ups), turning post (figures), swing bar (steel) or wobble base (dummy). */
  pivot = new THREE.Group();
  up = 0;
  want = false;
  /** Knocked down since it was last raised. */
  down = false;
  delay = 0;
  hits = 0;
  private swing = 0;
  private swingV = 0;
  private wob = new THREE.Vector2();
  private wobV = new THREE.Vector2();
  lastHitT = -1;

  constructor(public spec: TargetSpec, s: Shared) {
    const k = spec.kind;
    this.root.position.set(spec.x, spec.y ?? 0, spec.z);
    this.root.rotation.y = spec.yaw;
    this.root.add(this.pivot);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    if (k === 'etype') {
      // lifter box on the ground, arm + board on the hinge
      add(this.root, s.geo.box, s.frame, 0, 0.14, -0.12, 0.6, 0.28, 0.42);
      add(this.root, s.geo.box, s.frame, 0, 0.3, -0.12, 0.16, 0.06, 0.16);
      this.pivot.position.set(0, 0.3, -0.05);
      add(this.pivot, s.geo.box, s.frame, 0, ETYPE_Y0 / 2 - 0.05, -0.02, 0.05, ETYPE_Y0 + 0.1, 0.03);
      add(this.pivot, s.geo.etype, s.etype, 0, -0.05, 0);
    } else if (k === 'hostile' || k === 'civilian') {
      // weighted base + turning post
      add(this.root, s.geo.box, s.wood, 0, 0.03, 0, 0.7, 0.06, 0.12);
      add(this.root, s.geo.box, s.wood, 0, 0.03, 0, 0.12, 0.06, 0.6);
      add(this.root, s.geo.cyl, s.frame, 0, 0.12, 0, 0.045, 0.24, 0.045);
      add(this.pivot, s.geo[k], k === 'hostile' ? s.hostile : s.civilian, 0, 0.12, 0);
      add(this.pivot, s.geo.box, s.wood, 0, 0.6, -0.035, 0.05, 1.1, 0.04);
    } else if (k === 'steel') {
      // A-frame stand, plate hanging from the cross bar
      for (const sx of [-1, 1]) {
        add(this.root, s.geo.box, s.frame, sx * 0.42, 0.62, 0.12, 0.05, 1.3, 0.05).rotation.x = 0.18;
        add(this.root, s.geo.box, s.frame, sx * 0.42, 0.62, -0.12, 0.05, 1.3, 0.05).rotation.x = -0.18;
      }
      add(this.root, s.geo.box, s.frame, 0, 1.25, 0, 0.9, 0.05, 0.05);
      this.pivot.position.set(0, 1.24, 0);
      for (const sx of [-0.1, 0.1]) add(this.pivot, s.geo.box, s.frame, sx, -0.12, 0, 0.012, 0.24, 0.012);
      add(this.pivot, s.geo.plate, s.plate, 0, -0.5, 0);
    } else {
      const tyre = makePropObject('tyre', 1.3);
      this.root.add(tyre);
      add(this.pivot, s.geo.cyl, s.wood, 0, 0.75, 0, 0.06, 1.5, 0.06);
      add(this.pivot, s.geo.sack, s.burlap, 0, 1.15, 0);
      add(this.pivot, s.geo.head, s.burlap, 0, 1.72, 0);
      add(this.pivot, s.geo.cyl, s.burlap, 0, 1.4, 0, 0.06, 0.8, 0.06).rotation.z = Math.PI / 2;
      for (const y of [0.92, 1.38, 1.58]) add(this.pivot, s.geo.cyl, s.frame, 0, y, 0, 0.215, 0.025, 0.215);
    }
    this.up = spec.up || k === 'steel' || k === 'dummy' ? 1 : 0;
    this.want = this.up > 0;
    this.apply();
  }

  get kind() {
    return this.spec.kind;
  }
  get raised() {
    return this.up > 0.85 && this.want && !this.down;
  }
  get pos() {
    return this.root.position;
  }

  raise(delay = 0) {
    this.want = true;
    this.down = false;
    this.delay = delay;
  }

  lower() {
    this.want = false;
    this.delay = 0;
  }

  private apply() {
    const k = this.spec.kind;
    const e = easeOutCubic(this.up);
    if (k === 'etype') this.pivot.rotation.x = -(1 - e) * (Math.PI / 2 - 0.05);
    else if (k === 'hostile' || k === 'civilian') {
      this.pivot.rotation.y = (1 - e) * (Math.PI / 2);
      this.pivot.position.y = (1 - e) * -0.02;
    } else if (k === 'steel') this.pivot.rotation.x = this.swing;
    else this.pivot.rotation.set(this.wob.x, 0, this.wob.y);
  }

  update(dt: number) {
    const k = this.spec.kind;
    if (k === 'steel') {
      this.swingV += (-28 * this.swing - 2.2 * this.swingV) * dt;
      this.swing += this.swingV * dt;
    } else if (k === 'dummy') {
      for (const c of ['x', 'y'] as const) {
        this.wobV[c] += (-60 * this.wob[c] - 5 * this.wobV[c]) * dt;
        this.wob[c] += this.wobV[c] * dt;
      }
    } else {
      if (this.delay > 0) this.delay -= dt;
      else {
        const target = this.want && !this.down ? 1 : 0;
        const rising = target > this.up;
        const prev = this.up;
        this.up = rising ? Math.min(1, this.up + dt / 0.32) : Math.max(0, this.up - dt / 0.2);
        if (rising && prev === 0 && this.up > 0) audio.playAt('target_up', this.root.position, { vol: 0.5, refDist: 6 });
      }
    }
    this.apply();
  }

  /** Ray test against the face. Returns the distance or -1. */
  ray(o: THREE.Vector3, d: THREE.Vector3, maxT: number, out: { zone: HitZone; normal: THREE.Vector3 }) {
    const k = this.spec.kind;
    if ((k === 'etype' || k === 'hostile' || k === 'civilian') && (this.up < 0.5 || this.down)) return -1;
    // cheap bounding-sphere reject
    const cx = this.root.position.x, cy = this.root.position.y + 1, cz = this.root.position.z;
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - 1.6;
    if (c > 0 && b > 0) return -1;
    if (b * b - c < 0) return -1;
    if (k === 'dummy') {
      // vertical capsule around the sack
      const t = Math.max(0, -b);
      _p.copy(d).multiplyScalar(t).add(o);
      const dx = _p.x - cx, dz = _p.z - cz;
      if (dx * dx + dz * dz > 0.3 * 0.3 || _p.y < this.root.position.y + 0.7 || _p.y > this.root.position.y + 1.9 || t > maxT) return -1;
      out.zone = _p.y > this.root.position.y + 1.6 ? 'head' : 'body';
      out.normal.set(-d.x, 0, -d.z).normalize();
      return t;
    }
    this.pivot.updateWorldMatrix(true, false);
    _inv.copy(this.pivot.matrixWorld).invert();
    _o.copy(o).applyMatrix4(_inv);
    _d.copy(d).transformDirection(_inv);
    if (Math.abs(_d.z) < 1e-5) return -1;
    let pz = 0, ofsY = 0;
    if (k === 'steel') { pz = 0; ofsY = -0.5; }
    else if (k === 'etype') ofsY = -0.05;
    else ofsY = 0.12;
    const t = (pz - _o.z) / _d.z;
    if (t < 0 || t > maxT) return -1;
    const x = _o.x + _d.x * t, y = _o.y + _d.y * t - ofsY;
    let hit = false;
    if (k === 'etype') hit = insideEtype(x, y);
    else if (k === 'steel') hit = x * x + y * y <= 0.25 * 0.25;
    else hit = insideHuman(x, y, k === 'civilian');
    if (!hit) return -1;
    out.zone = k === 'etype' ? (y - ETYPE_Y0 > 0.75 ? 'head' : 'body') : k === 'steel' ? 'body' : y > 1.52 ? 'head' : 'body';
    out.normal.set(0, 0, _d.z > 0 ? -1 : 1).transformDirection(this.pivot.matrixWorld);
    return t;
  }

  /** Apply a hit. Returns true if it counts (the target reacted). */
  hit(dir: THREE.Vector3, how: HitHow) {
    const k = this.spec.kind;
    this.hits++;
    if (k === 'steel') {
      _d.copy(dir).transformDirection(_inv.copy(this.root.matrixWorld).invert());
      this.swingV -= Math.sign(_d.z || -1) * (how === 'npc' ? 2.5 : 3.6);
      _p.set(0, -0.5, 0).applyMatrix4(this.pivot.matrixWorld);
      audio.playAt('steel', _p, { vol: how === 'npc' ? 0.6 : 1.1, rateVar: 0.04, refDist: 26 });
      return true;
    }
    if (k === 'dummy') {
      _d.copy(dir).transformDirection(_inv.copy(this.root.matrixWorld).invert());
      const kk = how === 'melee' ? 4.5 : 1.2;
      this.wobV.x += _d.z * kk;
      this.wobV.y -= _d.x * kk;
      return true;
    }
    if (this.down || this.up < 0.5) return false;
    this.down = true;
    this.want = false;
    audio.playAt('target_down', this.root.position, { vol: 0.75, rateVar: 0.08, refDist: 8 });
    return true;
  }

  reset() {
    const k = this.spec.kind;
    this.down = false;
    this.hits = 0;
    this.delay = 0;
    if (k === 'steel' || k === 'dummy') {
      this.up = 1;
      this.want = true;
    } else {
      this.up = this.spec.up ? 1 : 0;
      this.want = this.up > 0;
    }
    this.swing = this.swingV = 0;
    this.wob.set(0, 0);
    this.wobV.set(0, 0);
    this.apply();
  }
}

export class TargetSet {
  list: Target[] = [];
  root = new THREE.Group();
  private shared: Shared | null = null;
  private byId = new Map<string, Target>();
  onHit: (t: Target, zone: HitZone, how: HitHow) => void = () => {};
  private hitOut = { zone: 'body' as HitZone, normal: new THREE.Vector3() };

  build(specs: TargetSpec[]) {
    this.clear();
    if (!specs.length) return;
    this.shared ??= makeShared();
    for (const s of specs) {
      const t = new Target(s, this.shared);
      this.list.push(t);
      this.byId.set(s.id, t);
      this.root.add(t.root);
    }
  }

  clear() {
    for (const t of this.list) this.root.remove(t.root);
    this.list.length = 0;
    this.byId.clear();
  }

  get(id: string) {
    return this.byId.get(id)!;
  }

  group(name: string) {
    return this.list.filter((t) => t.spec.group === name);
  }

  /** Nearest target face along the ray (closer than maxT), or null. */
  ray(o: THREE.Vector3, d: THREE.Vector3, maxT: number): TargetHit | null {
    let best: Target | null = null;
    let bt = maxT;
    let zone: HitZone = 'body';
    const n = new THREE.Vector3();
    for (const t of this.list) {
      const r = t.ray(o, d, bt, this.hitOut);
      if (r >= 0 && r < bt) {
        bt = r;
        best = t;
        zone = this.hitOut.zone;
        n.copy(this.hitOut.normal);
      }
    }
    if (!best) return null;
    return { target: best, t: bt, zone, point: new THREE.Vector3().copy(d).multiplyScalar(bt).add(o), normal: n };
  }

  shoot(h: TargetHit, dir: THREE.Vector3, how: HitHow = 'shot') {
    if (h.target.hit(dir, how)) this.onHit(h.target, h.zone, how);
  }

  /** Grenade blast: knocks down exposed targets within the radius. */
  blast(c: THREE.Vector3, radius: number, los: (a: THREE.Vector3, b: THREE.Vector3) => boolean) {
    const p = new THREE.Vector3();
    for (const t of this.list) {
      if (t.kind === 'dummy') continue;
      p.copy(t.pos);
      p.y += t.kind === 'steel' ? 0.75 : 1.0;
      const d = p.distanceTo(c);
      if (d > radius) continue;
      if (d > 1.5 && !los(c, p)) continue;
      const dir = p.clone().sub(c).normalize();
      if (t.hit(dir, 'blast')) this.onHit(t, 'body', 'blast');
    }
  }

  /** Closest meleeable target in front of the player. */
  melee(origin: THREE.Vector3, dir: THREE.Vector3, range = 2.2) {
    let best: Target | null = null;
    let bd = range;
    const p = new THREE.Vector3();
    for (const t of this.list) {
      if (t.kind !== 'dummy' && (!t.raised || t.kind === 'steel')) continue;
      p.copy(t.pos);
      p.y = origin.y;
      p.sub(origin);
      const d = p.length();
      if (d < bd && p.dot(dir) / Math.max(d, 1e-3) > 0.45) {
        bd = d;
        best = t;
      }
    }
    if (best && best.hit(dir, 'melee')) this.onHit(best, 'body', 'melee');
    return best;
  }

  update(dt: number) {
    for (const t of this.list) t.update(dt);
  }

  reset() {
    for (const t of this.list) t.reset();
  }

  /** How many of the given targets are still up (or on their way up). */
  standing(list: Target[]) {
    let n = 0;
    for (const t of list) if (t.want && !t.down) n++;
    return n;
  }
}
