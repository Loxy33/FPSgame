import * as THREE from 'three';
import { TileNoise } from '../core/utils';
import { TILE, type MatName } from '../render/materials';
import { LevelBuilder, type MatRef } from './build';
import { Frame } from './props';
import * as P from './props';

const FONT = '"Bahnschrift", "DIN Alternate", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const CJK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';

const NOISE = new TileNoise(911);
const jitter = (b: LevelBuilder, hex: number, amt: number) => new THREE.Color(hex).multiplyScalar(1 + b.r(-amt, amt)).getHex();

// ---------------------------------------------------------------------------
// Texture atlas shared by every sign face and stencil in a level
// ---------------------------------------------------------------------------

export type UvRect = [number, number, number, number];

export class Atlas {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  private x = 0;
  private y = 0;
  private rowH = 0;

  constructor(public size = 2048) {
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
  }

  /** Reserve a w x h pixel slot and draw into it (origin at the slot's top-left). */
  add(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): UvRect {
    const pad = 4;
    if (this.x + w + pad > this.size) {
      this.x = 0;
      this.y += this.rowH + pad;
      this.rowH = 0;
    }
    if (this.y + h > this.size) {
      console.warn('atlas full');
      return [0, 0, 0.001, 0.001];
    }
    const g = this.ctx;
    g.save();
    g.translate(this.x, this.y);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    draw(g, w, h);
    g.restore();
    const S = this.size;
    const r: UvRect = [(this.x + 1) / S, 1 - (this.y + h - 1) / S, (this.x + w - 1) / S, 1 - (this.y + 1) / S];
    this.x += w + pad;
    this.rowH = Math.max(this.rowH, h);
    return r;
  }

  finish() {
    this.tex.needsUpdate = true;
  }
}

/** Paint wear: speckles of the background showing through. */
export function wear(g: CanvasRenderingContext2D, w: number, h: number, amount: number, erase = true) {
  g.save();
  g.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  for (let i = 0; i < amount * w * h * 0.0006; i++) {
    g.globalAlpha = Math.random() * 0.7;
    g.fillStyle = erase ? '#000' : 'rgba(60,50,40,1)';
    const r = Math.random() * Math.random() * 7 + 0.6;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Dirt / rain streaks running down a sign face. */
export function grime(g: CanvasRenderingContext2D, w: number, h: number, k = 1) {
  g.save();
  for (let i = 0; i < 26 * k; i++) {
    const x = Math.random() * w;
    const len = h * (0.2 + Math.random() * 0.8);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(50,40,28,0.16)');
    grad.addColorStop(1, 'rgba(50,40,28,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 1 + Math.random() * 5, len);
  }
  const vg = g.createLinearGradient(0, h * 0.6, 0, h);
  vg.addColorStop(0, 'rgba(60,46,30,0)');
  vg.addColorStop(1, `rgba(60,46,30,${0.25 * k})`);
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  g.restore();
}

export interface SignLine {
  text: string;
  size: number;
  color?: string;
  font?: string;
  weight?: number;
  /** Letter spacing in px. */
  ls?: number;
}

/** Draw centred lines of text, scaled down horizontally if they don't fit. */
export function textLines(g: CanvasRenderingContext2D, w: number, h: number, lines: SignLine[], gap = 1.18) {
  const total = lines.reduce((s, l) => s + l.size * gap, 0);
  let y = (h - total) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of lines) {
    g.font = `${l.weight ?? 700} ${l.size}px ${l.font ?? FONT}`;
    (g as any).letterSpacing = `${l.ls ?? 0}px`;
    g.fillStyle = l.color ?? '#111';
    const mw = g.measureText(l.text).width;
    const sx = Math.min(1, (w * 0.92) / Math.max(mw, 1));
    g.save();
    g.translate(w / 2, y + (l.size * gap) / 2);
    g.scale(sx, 1);
    g.fillText(l.text, 0, 0);
    g.restore();
    y += l.size * gap;
  }
  (g as any).letterSpacing = '0px';
}

// ---------------------------------------------------------------------------
// Level-owned materials
// ---------------------------------------------------------------------------

export interface CampMats {
  atlas: Atlas;
  /** Opaque sign faces. */
  sign: THREE.MeshStandardMaterial;
  /** Painted-on stencils (alpha blended, no depth write). */
  decal: THREE.MeshStandardMaterial;
  /** Glowing lamp lenses. */
  lamp: THREE.MeshStandardMaterial;
  /** Camouflage netting (alpha tested). */
  net: THREE.MeshStandardMaterial;
  /** Animated cloth (flags), ticked by the level. */
  time: { value: number };
}

function makeNetTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  // net mesh
  g.strokeStyle = 'rgba(52,48,38,1)';
  g.lineWidth = 2;
  for (let i = -S; i < S * 2; i += 22) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
    g.beginPath(); g.moveTo(i, S); g.lineTo(i + S, 0); g.stroke();
  }
  // garnish: irregular "leaf" cut-outs in a desert palette, tiling seamlessly
  const pal = ['#8c7a58', '#a08a62', '#6e6446', '#7d6b4a', '#5e5a40', '#b19b72', '#4c4a36'];
  for (let i = 0; i < 520; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const r = 7 + Math.random() * 15;
    const col = pal[(Math.random() * pal.length) | 0];
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const cx = x + ox, cy = y + oy;
      if (cx < -30 || cx > S + 30 || cy < -30 || cy > S + 30) continue;
      g.fillStyle = col;
      g.beginPath();
      const n = 5 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + Math.random() * 0.5;
        const rr = r * (0.45 + Math.random() * 0.7);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.75;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    }
  }
  // holes
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 3 + Math.random() * 9, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function makeCampMats(): CampMats {
  const atlas = new Atlas(2048);
  const sign = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, map: atlas.tex, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  sign.userData.surface = 'metal';
  const decal = new THREE.MeshStandardMaterial({ map: atlas.tex, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0x151515, emissive: 0xfff0d6, emissiveIntensity: 7, roughness: 0.3, metalness: 0 });
  const net = new THREE.MeshStandardMaterial({ map: makeNetTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
  net.userData.surface = 'fabric';
  return { atlas, sign, decal, lamp, net, time: { value: 0 } };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Flat rectangle centred on `c`, spanned by unit vectors `right` / `up`, mapped to an atlas rect. */
export function quad(b: LevelBuilder, mat: MatRef, c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, w: number, h: number, uv: UvRect, color = 0xffffff) {
  const g = new THREE.BufferGeometry();
  const r = right.clone().multiplyScalar(w / 2), u = up.clone().multiplyScalar(h / 2);
  const p = [c.clone().sub(r).sub(u), c.clone().add(r).sub(u), c.clone().add(r).add(u), c.clone().sub(r).add(u)];
  const n = new THREE.Vector3().crossVectors(right, up).normalize();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  b.geoM(mat, g, new THREE.Matrix4(), color);
  g.dispose();
}

/** Unit vectors for a vertical face looking along `rot` (local +Z). */
export function faceAxes(rot: number) {
  return {
    right: new THREE.Vector3(Math.cos(rot), 0, -Math.sin(rot)),
    up: new THREE.Vector3(0, 1, 0),
    normal: new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)),
  };
}

/** Stencil painted directly onto a wall face. */
export function stencil(b: LevelBuilder, cm: CampMats, x: number, y: number, z: number, rot: number, w: number, h: number, uv: UvRect, color = 0xffffff) {
  const { right, up, normal } = faceAxes(rot);
  quad(b, cm.decal, new THREE.Vector3(x, y, z).addScaledVector(normal, 0.004), right, up, w, h, uv, color);
}

/** Free-standing sign: board on two posts (or wall-mounted when `posts` = 0). */
export function signBoard(b: LevelBuilder, cm: CampMats, x: number, z: number, rot: number, w: number, h: number, y0: number, uv: UvRect, o: { posts?: number; postCol?: number; back?: number; thick?: number } = {}) {
  const f = new Frame(b, x, z, rot);
  const t = o.thick ?? 0.04;
  const posts = o.posts ?? 2;
  f.c('vpaint', 0, y0, 0, w + 0.04, h + 0.04, t, { color: o.back ?? 0x8a8a84, grime: 0.9, surface: 'metal' });
  if (posts) {
    const px = posts === 1 ? [0] : [-w / 2 + Math.min(0.15, w * 0.15), w / 2 - Math.min(0.15, w * 0.15)];
    for (const lx of px) f.c('vpaint', lx, 0, -t / 2 - 0.035, 0.06, y0 + h, 0.06, { color: o.postCol ?? 0x5d5f5a, grime: 0.7 });
  }
  const { right, up, normal } = faceAxes(rot);
  quad(b, cm.sign, f.v(0, y0 + h / 2, 0).addScaledVector(normal, t / 2 + 0.003), right, up, w, h, uv);
}

/**
 * Earth berm: a ridge along local X with a rounded cross-section, noise on the crest and
 * world-space UVs, so it shares the ground texture scale.
 */
export function berm(b: LevelBuilder, mat: MatName, x: number, z: number, rot: number, len: number, width: number, h: number, o: { color?: number; seed?: number; collide?: boolean; steep?: number } = {}) {
  const noise = NOISE;
  const so = (o.seed ?? 17) * 0.137;
  const nx = Math.max(6, Math.round(len / 0.95)), nz = 14;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const pos: number[] = [], uv: number[] = [];
  const tile = 1 / TILE[mat];
  const steep = o.steep ?? 0.8;
  for (let i = 0; i <= nx; i++) {
    const u = i / nx;
    const lx = (u - 0.5) * len;
    // round off the ends
    const endK = Math.min(1, Math.min(u, 1 - u) * len / Math.max(width * 0.6, 0.5));
    const macro = noise.fbm2(u * len * 0.035 + so, 0.13, 8, 8, 3);
    const crest = h * (0.82 + 0.34 * macro) * Math.sqrt(Math.max(endK, 0));
    for (let j = 0; j <= nz; j++) {
      const v = j / nz;
      const lz = (v - 0.5) * width;
      const s = Math.abs(v - 0.5) * 2;
      // Stepped eroded embankment profile with rain-carved gullies & rocky bumps (never a smooth tube)
      const baseProf = Math.pow(Math.max(0, 1 - Math.pow(s, 2.05 - steep)), 0.72);
      const gully = (noise.fbm2(lx * 0.11 + so, lz * 0.06 + 0.41, 16, 16, 3) - 0.5) * 0.42;
      const rocky = (noise.fbm2(lx * 0.28 + so * 2.1, lz * 0.24 + 0.7, 24, 24, 2) - 0.5) * 0.16;
      const edgeFade = Math.max(0, 1 - s * s);
      const y = Math.max(-0.06, crest * baseProf + (gully * Math.min(1, h * 0.35) + rocky) * edgeFade - 0.04);
      const wx = x + lx * cos + lz * sin, wz = z - lx * sin + lz * cos;
      pos.push(wx, y, wz);
      uv.push(wx * tile, wz * tile + y * tile * 0.65);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = i * (nz + 1) + j, c = a + nz + 1;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orientation of the winding depends on rot; make sure normals point up
  const nor = g.attributes.normal;
  if (nor.getY(Math.floor(nz / 2)) < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  b.geoM(mat, g, new THREE.Matrix4(), o.color ?? 0xffffff);
  g.dispose();
  if (o.collide !== false) b.world.addBox(x, h * 0.32, z, len / 2 * 0.95, h * 0.32, width * 0.3, rot, 'sand', true);
}

// ---------------------------------------------------------------------------
// Fortifications
// ---------------------------------------------------------------------------

/** Row of precast concrete T-walls ("Texas barriers") along local X. */
export function tWalls(b: LevelBuilder, x: number, z: number, rot: number, n: number, o: { h?: number; color?: number } = {}) {
  const f = new Frame(b, x, z, rot);
  const W = 1.52, H = o.h ?? 3.65;
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * W;
    const col = jitter(b, o.color ?? 0xd2cdc2, 0.06);
    const lean = b.r(-0.006, 0.006);
    f.d('slab', lx, 0, 0, W - 0.025, 0.32, 1.25, { color: col, grime: 0.75 });
    f.d('slab', lx, 0.32, 0, W - 0.025, 0.42, 1.25, { color: col, taper: [1, 0.26], grime: 0.85 });
    f.d('slab', lx, 0.74, lean, W - 0.025, H - 0.74, 0.3, { color: col, taper: [1, 0.8], absGrime: true });
    // lifting loops
    for (const s of [-0.38, 0.38]) {
      const a = f.v(lx + s - 0.07, H - 0.02, 0), c = f.v(lx + s + 0.07, H - 0.02, 0), m = f.v(lx + s, H + 0.09, 0);
      b.tube('darkmetal', a, m, 0.014, 0x4a3a2c, 4);
      b.tube('darkmetal', m, c, 0.014, 0x4a3a2c, 4);
    }
  }
  f.solid(0, 0, 0, n * W, 0.74, 1.2, 'concrete');
  f.solid(0, 0.74, 0, n * W, H - 0.74, 0.36, 'concrete');
}

/** HESCO line with a little variation in fill height and a sandbag cap here and there. */
export function hescoLine(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, stack = 2) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.1));
  const rot = -Math.atan2(z1 - z0, x1 - x0);
  P.hesco(b, (x0 + x1) / 2, (z0 + z1) / 2, rot, n, stack);
}

/** Posts with sagging ropes (a non-climbable lane boundary). */
export function ropeFence(b: LevelBuilder, pts: [number, number][], h = 1.05, spacing = 2.6) {
  let prev: THREE.Vector3[] | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / spacing));
    for (let k = i > 1 ? 1 : 0; k <= n; k++) {
      const t = k / n;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      b.cyl('wood', px, 0, pz, 0.055, h + 0.1, jitter(b, 0x8a7458, 0.1), { segs: 6 });
      const tops = [new THREE.Vector3(px, h, pz), new THREE.Vector3(px, h * 0.55, pz)];
      if (prev) for (let r = 0; r < 2; r++) P.wire(b, prev[r], tops[r], 0.07);
      prev = tops;
    }
    const c = b.world.addBox((ax + bx) / 2, 1.5, (az + bz) / 2, len / 2, 1.5, 0.1, -Math.atan2(bz - az, bx - ax), 'wood', true);
    c.noRay = true;
  }
}

/** Chain-link fence (5 m modules) between two points, optionally topped with barbed wire. */
export function chainFence(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, wire = true) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 5));
  const rot = -Math.atan2(z1 - z0, x1 - x0);
  const seg = len / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    b.model('chainlink', x, 0, z, rot, { scale: { x: seg / 5, y: 1.1, z: 1 } });
    if (wire) b.model('barbed_wire', x, 2.0, z, rot, { scale: { x: seg / 5, y: 0.32, z: 1 } });
  }
  const c = b.world.addBox((x0 + x1) / 2, 1.5, (z0 + z1) / 2, len / 2, 1.5, 0.06, rot, 'metal', true);
  c.noRay = true;
}

// ---------------------------------------------------------------------------
// Camp structures
// ---------------------------------------------------------------------------

/** Containerised housing unit built from the 11.2k-tri sculpted `bldg_site_office` PBR mesh. */
export function chu(b: LevelBuilder, cm: CampMats, x: number, z: number, rot: number, label: UvRect | null, o: { color?: number; ac?: boolean; light?: boolean } = {}) {
  const f = new Frame(b, x, z, rot);
  const L = 6.06, W = 2.44, H = 2.59;
  const col = jitter(b, o.color ?? 0xc8bfab, 0.04);
  // raised on timber sleepers so roofline lands cleanly at y = 2.77 for overhead canopies
  for (const lx of [-2.6, 0, 2.6]) for (const lz of [-0.9, 0.9]) f.d('wood', lx, 0, lz, 0.3, 0.18, 0.3, { color: 0x6d5c45 });
  b.model('bldg_site_office', x, 0.18, z, rot, {
    scale: { x: L / 6.1, y: H / 2.9, z: W / 3.29 },
    color: col,
  });
  f.solid(0, 0.18, 0, L, H, W, 'metal', true);
  const dz = W / 2 + 0.04;
  // steps
  f.c('wood', -1.2, 0, dz + 0.45, 1.1, 0.16, 0.7, { color: 0x8a7458, nav: false });
  f.d('wood', -1.2, 0.16, dz + 0.3, 1.1, 0.12, 0.4, { color: 0x8a7458 });
  if (o.ac !== false) b.model(b.rnd() < 0.5 ? 'aircon' : 'aircon_rust', f.wx(L / 2 + 0.25, 0.3), 0.6, f.wz(L / 2 + 0.25, 0.3), rot + Math.PI / 2, { scale: 0.9 });
  if (o.light !== false) b.model('security_light', f.wx(-1.2, dz + 0.05), 2.35, f.wz(-1.2, dz + 0.05), rot, { scale: 0.7 });
  if (label) stencil(b, cm, f.wx(0.15, dz + 0.04), 2.2, f.wz(0.15, dz + 0.04), rot, 0.8, 0.4, label, 0x2b2b28);
  // cable to the next unit
  P.wire(b, f.v(L / 2 - 0.2, H + 0.1, -0.6), f.v(L / 2 + 0.6, H + 0.15, -0.6), 0.1);
}

/** Trailer-mounted mobile light tower with four lamp heads aimed along local +Z. */
export function lightTower(b: LevelBuilder, cm: CampMats, x: number, z: number, rot: number, mast = 6.8, tilt = 0.35) {
  const f = new Frame(b, x, z, rot);
  const col = 0xd8c9a2;
  f.c('vpaint', 0, 0.5, 0, 1.3, 1.05, 2.3, { color: col, grime: 0.8, surface: 'metal' });
  f.d('vpaint', 0, 1.55, -0.2, 1.24, 0.1, 1.7, { color: new THREE.Color(col).multiplyScalar(0.85).getHex() });
  for (const sx of [-1, 1]) f.wheel('rubber', sx * 0.72, 0.36, 0.2, 0.34, 0.2, 0x1c1c1c);
  b.tube('darkmetal', f.v(0, 0.55, -1.15), f.v(0, 0.45, -2.1), 0.04, 0x2a2a2a, 5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.tube('darkmetal', f.v(sx * 0.6, 0.7, sz * 0.9), f.v(sx * 1.6, 0.05, sz * 1.1), 0.04, 0x8a7a30, 5);
    f.d('darkmetal', sx * 1.6, 0, sz * 1.1, 0.22, 0.05, 0.22, { color: 0x333333 });
  }
  b.tube('vpaint', f.v(0, 1.5, 0.5), f.v(0, mast, 0.5), 0.075, 0xb9b5aa, 8);
  b.tube('vpaint', f.v(0, 1.5, 0.5), f.v(0, mast * 0.55, 0.5), 0.1, 0xb9b5aa, 8);
  // lamp bar
  const top = f.v(0, mast + 0.1, 0.5);
  b.tube('darkmetal', f.v(-1.0, mast + 0.1, 0.5), f.v(1.0, mast + 0.1, 0.5), 0.05, 0x2a2a2a, 6);
  const fwd = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, rot, 0, 'YXZ'));
  const box = new THREE.BoxGeometry(0.46, 0.4, 0.16);
  const lens = new THREE.PlaneGeometry(0.4, 0.34);
  for (const lx of [-0.75, -0.25, 0.25, 0.75]) {
    const c = f.v(lx, mast + (Math.abs(lx) < 0.5 ? 0.42 : -0.18), 0.62);
    const m = new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1));
    b.geoM('darkmetal', box, m, 0x2e2e2c);
    const lm = new THREE.Matrix4().compose(c.clone().add(new THREE.Vector3(0, 0, 0.081).applyQuaternion(q)), q, new THREE.Vector3(1, 1, 1));
    b.geoM(cm.lamp, lens, lm, 0xffffff);
  }
  box.dispose();
  lens.dispose();
  void top; void fwd;
  f.solid(0, 0, 0, 1.4, 1.6, 2.4, 'metal');
  f.solid(0, 0, 0.5, 0.25, mast, 0.25, 'metal');
}

/** Camouflage net draped over poles: a sagging, wrinkled sheet. */
export function camoNet(b: LevelBuilder, cm: CampMats, x: number, z: number, rot: number, w: number, d: number, h: number, poles: [number, number][], seed = 3) {
  const noise = NOISE;
  const so = seed * 0.173;
  const nx = Math.max(6, Math.round(w / 0.6)), nz = Math.max(6, Math.round(d / 0.6));
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const lx = (i / nx - 0.5) * w, lz = (j / nz - 0.5) * d;
      let peak = 0;
      for (const [px, pz] of poles) peak = Math.max(peak, Math.exp(-((lx - px) ** 2 + (lz - pz) ** 2) / 5.5));
      const ex = 1 - Math.abs(i / nx - 0.5) * 2, ez = 1 - Math.abs(j / nz - 0.5) * 2;
      const edge = Math.min(ex, ez);
      const drop = (1 - Math.min(1, edge / 0.22)) ** 1.6 * 1.25;
      const y = h - 0.55 + peak * 0.55 - drop + (noise.fbm2(lx * 0.05 + so, lz * 0.05 + 0.1, 8, 8, 2) - 0.5) * 0.32;
      pos.push(x + lx * cos + lz * sin, y, z - lx * sin + lz * cos);
      uv.push(lx / 2.2, lz / 2.2);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = i * (nz + 1) + j, c = a + nz + 1;
    idx.push(a, a + 1, c, a + 1, c + 1, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  b.geoM(cm.net, g, new THREE.Matrix4(), 0xffffff);
  g.dispose();
  const f = new Frame(b, x, z, rot);
  for (const [px, pz] of poles) b.cyl('wood', f.wx(px, pz), 0, f.wz(px, pz), 0.045, h - 0.05, 0x7a6a52, { segs: 6, collide: true, surface: 'wood' });
  // stakes and guy lines at the corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = f.v(sx * w / 2 * 0.98, h - 1.85, sz * d / 2 * 0.98);
    b.tube('darkmetal', c, f.v(sx * (w / 2 + 0.9), 0, sz * (d / 2 + 0.9)), 0.008, 0x6a604a, 3);
  }
}

/** Military GP tent: canvas walls and a sagging roof, long axis along local Z, door at +Z. */
export function gpTent(b: LevelBuilder, x: number, z: number, rot: number, w = 5.6, d = 9.8, color = 0x6a6a4e) {
  const f = new Frame(b, x, z, rot);
  const wall = 1.75, ridge = 3.15;
  const hw = w / 2, hd = d / 2;
  const noise = NOISE;
  const so = ((x * 13 + z * 7) % 97) * 0.01;
  const sheet = (fn: (u: number, v: number) => THREE.Vector3, nu: number, nv: number) => {
    const pos: number[] = [], uv: number[] = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p = fn(i / nu, j / nv);
      const wp = f.v(p.x, p.y, p.z);
      pos.push(wp.x, wp.y, wp.z);
      uv.push((p.x + p.z) / TILE.fabric, p.y / TILE.fabric);
    }
    const idx: number[] = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, c = a + nv + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    b.geoM('fabric', g, new THREE.Matrix4(), jitter(b, color, 0.05));
    g.dispose();
  };
  const sag = (u: number, v: number) => Math.sin(u * Math.PI) * Math.sin(v * Math.PI * 4) ** 2 * 0.07 + (noise.fbm2(u * 0.4 + so, v * 0.4, 8, 8, 2) - 0.5) * 0.05;
  for (const s of [-1, 1]) {
    // roof slope from eave to ridge, sagging between the frame arches (every d/4)
    sheet((u, v) => {
      const lz = (v - 0.5) * d;
      const k = sag(u, v);
      return new THREE.Vector3(s * hw * (1 - u), wall + (ridge - wall) * u - k, lz);
    }, 6, 24);
    // side wall with a slight belly
    sheet((u, v) => new THREE.Vector3(s * (hw + Math.sin(u * Math.PI) * 0.06 * Math.sin(v * Math.PI)), u * wall, (v - 0.5) * d), 3, 20);
    // gable ends
    sheet((u, v) => {
      const lx = (u - 0.5) * w;
      const top = wall + (ridge - wall) * (1 - Math.abs(lx) / hw);
      return new THREE.Vector3(lx, v * top, s * hd + s * Math.sin(v * Math.PI) * 0.04);
    }, 10, 6);
  }
  // rolled-up door at +Z and a dark doorway
  f.d('fabric', 0, 0, hd + 0.03, 1.5, 2.05, 0.02, { color: 0x1a1a14 });
  f.wheel('fabric', 0, 2.1, hd + 0.08, 0.12, 1.55, new THREE.Color(color).multiplyScalar(0.8).getHex(), 8);
  // ridge pole, guy lines and stakes
  for (const sx of [-1, 1]) for (let k = 0; k <= 4; k++) {
    const lz = (k / 4 - 0.5) * d * 0.96;
    const a = f.v(sx * hw, wall + 0.02, lz), c = f.v(sx * (hw + 1.3), 0.02, lz);
    b.tube('darkmetal', a, c, 0.008, 0x8a8468, 3);
    f.d('darkmetal', sx * (hw + 1.3), 0, lz, 0.05, 0.22, 0.05, { color: 0x3c3a34 });
  }
  // sandbags along the sides
  P.sandbags(b, f.wx(-hw - 0.35, 0), f.wz(-hw - 0.35, 0), rot + Math.PI / 2, d - 1, 2, 0, false);
  P.sandbags(b, f.wx(hw + 0.35, 0), f.wz(hw + 0.35, 0), rot + Math.PI / 2, d - 1, 2, 0, false);
  f.solid(0, 0, 0, w + 0.4, ridge + 0.2, d, 'fabric');
}

/** Flag on a pole, flying along local +X. The cloth is a separate animated mesh. */
export function flagPole(b: LevelBuilder, cm: CampMats, group: THREE.Group, x: number, z: number, windRot: number, tex: THREE.Texture, h = 8, fw = 1.8, fh = 1.15) {
  b.cyl('metal', x, 0, z, 0.06, h, 0xc8c4b8, { rTop: 0.035, segs: 8, collide: true, surface: 'metal' });
  b.cyl('concrete', x, 0, z, 0.32, 0.25, 0xb8b2a6, { segs: 10 });
  const ball = new THREE.SphereGeometry(0.07, 8, 6);
  b.geo('metal', ball, { x, y: h + 0.05, z }, null, 1, 0xd4b060);
  ball.dispose();
  // halyard
  b.tube('darkmetal', new THREE.Vector3(x + 0.05, 1.2, z), new THREE.Vector3(x + 0.05, h - 0.1, z), 0.005, 0xd0d0c8, 3);
  const g = new THREE.PlaneGeometry(fw, fh, 24, 12);
  g.translate(fw / 2, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  mat.userData.fw = fw;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cm.time;
    shader.uniforms.uFW = { value: fw };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uFW;')
      .replace('#include <beginnormal_vertex>', `
float fx = clamp(position.x / uFW, 0.0, 1.0);
float ph = fx * 7.5 - uTime * 5.4 + position.y * 1.4;
float ph2 = fx * 15.0 - uTime * 8.3 + position.y * 2.0;
float fz = (sin(ph) * 0.13 + sin(ph2) * 0.035) * fx;
float dzdx = ((cos(ph) * 7.5 * 0.13 + cos(ph2) * 15.0 * 0.035) * fx + sin(ph) * 0.13 + sin(ph2) * 0.035) / uFW;
vec3 objectNormal = normalize(vec3(-dzdx, 0.0, 1.0));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`)
      .replace('#include <begin_vertex>', `
vec3 transformed = vec3(position);
transformed.z += fz;
transformed.y -= fx * fx * 0.1;
transformed.x -= abs(fz) * 0.25;`);
  };
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, h - 0.15 - fh / 2, z);
  m.rotation.y = windRot;
  m.castShadow = false;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** Canvas texture for a flag. */
export function flagTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 330) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  // weave + dirt
  g.globalAlpha = 0.06;
  for (let y = 0; y < h; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, w, 1); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export { CJK, FONT };
