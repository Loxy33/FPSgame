import * as THREE from 'three';
import type { LevelBuilder } from '../world/build';

/**
 * Decal layer: bullet holes stay in the FX pool, but the world gets its own decal atlas —
 * oil stains, spray-paint tags, cracks and scorch marks — projected onto the geometry as
 * separate quads instead of being painted into the tiling albedo. Because they live on their own
 * layer they can overlap each other and the base material without repeating with it.
 */
export type DecalKind = 'oil' | 'tag' | 'crack' | 'scorch';

const MAT_OF: Record<DecalKind, 'decalOil' | 'decalTag' | 'decalCrack' | 'decalScorch'> = {
  oil: 'decalOil',
  tag: 'decalTag',
  crack: 'decalCrack',
  scorch: 'decalScorch',
};

const textures: Partial<Record<DecalKind, THREE.CanvasTexture>> = {};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawOil(g: CanvasRenderingContext2D, x: number, y: number, S: number) {
  const r = rng(7);
  for (let i = 0; i < 14; i++) {
    const cx = x + S * (0.3 + r() * 0.4), cy = y + S * (0.3 + r() * 0.4);
    const rad = S * (0.12 + r() * 0.3);
    const grad = g.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
    grad.addColorStop(0, 'rgba(12,9,6,0.62)');
    grad.addColorStop(0.55, 'rgba(18,13,8,0.34)');
    grad.addColorStop(1, 'rgba(20,15,10,0)');
    g.fillStyle = grad;
    g.beginPath();
    // lobed blob rather than a perfect circle
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 10) {
      const rr = rad * (0.75 + r() * 0.35);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.8;
      if (a === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }
  // a few drips / tyre smears
  g.strokeStyle = 'rgba(14,10,7,0.4)';
  for (let i = 0; i < 5; i++) {
    g.lineWidth = S * (0.004 + r() * 0.012);
    g.beginPath();
    g.moveTo(x + S * r(), y + S * r());
    g.lineTo(x + S * r(), y + S * r());
    g.stroke();
  }
}

function drawTag(g: CanvasRenderingContext2D, x: number, y: number, S: number) {
  const r = rng(23);
  const cx = x + S * 0.5, cy = y + S * 0.5;
  // subtle dark weathering / water stain patch instead of bright cartoon ZZZZ graffiti
  for (let i = 0; i < 12; i++) {
    const px = cx + (r() - 0.5) * S * 0.35;
    const py = cy + (r() - 0.5) * S * 0.35;
    const rad = S * (0.1 + r() * 0.22);
    const grad = g.createRadialGradient(px, py, rad * 0.1, px, py, rad);
    grad.addColorStop(0, 'rgba(28,24,18,0.32)');
    grad.addColorStop(0.6, 'rgba(36,30,22,0.16)');
    grad.addColorStop(1, 'rgba(36,30,22,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px, py, rad, 0, Math.PI * 2);
    g.fill();
  }
}

function drawCrack(g: CanvasRenderingContext2D, x: number, y: number, S: number) {
  const r = rng(91);
  const branch = (px: number, py: number, ang: number, len: number, depth: number) => {
    if (depth <= 0 || len < S * 0.02) return;
    const nx = px + Math.cos(ang) * len;
    const ny = py + Math.sin(ang) * len;
    g.strokeStyle = `rgba(10,9,7,${0.5 + depth * 0.12})`;
    g.lineWidth = S * 0.004 * depth;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(nx, ny);
    g.stroke();
    // lit lip on one side sells the depth
    g.strokeStyle = 'rgba(220,210,190,0.10)';
    g.lineWidth = S * 0.003 * depth;
    g.beginPath();
    g.moveTo(px + 2, py - 2);
    g.lineTo(nx + 2, ny - 2);
    g.stroke();
    const n = 2 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(nx, ny, ang + (r() - 0.5) * 1.1, len * (0.45 + r() * 0.4), depth - 1);
  };
  branch(x + S * 0.5, y + S * 0.86, -Math.PI / 2 + (r() - 0.5) * 0.4, S * 0.22, 4);
  branch(x + S * 0.3, y + S * 0.7, -Math.PI / 2 - 0.5, S * 0.16, 3);
}

function drawScorch(g: CanvasRenderingContext2D, x: number, y: number, S: number) {
  const r = rng(55);
  const cx = x + S * 0.5, cy = y + S * 0.5;
  for (let i = 0; i < 10; i++) {
    const rad = S * (0.1 + r() * 0.28);
    const grad = g.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad);
    grad.addColorStop(0, 'rgba(8,7,6,0.55)');
    grad.addColorStop(0.6, 'rgba(12,10,8,0.25)');
    grad.addColorStop(1, 'rgba(14,12,9,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx + (r() - 0.5) * S * 0.1, cy + (r() - 0.5) * S * 0.1, rad, 0, Math.PI * 2);
    g.fill();
  }
  // radial soot streaks
  g.strokeStyle = 'rgba(10,9,8,0.3)';
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const l0 = S * 0.08, l1 = S * (0.2 + r() * 0.28);
    g.lineWidth = S * (0.002 + r() * 0.008);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * l0, cy + Math.sin(a) * l0);
    g.lineTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1);
    g.stroke();
  }
}

export function decalTexture(kind: DecalKind): THREE.CanvasTexture {
  const cached = textures[kind];
  if (cached) return cached;
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  if (kind === 'oil') drawOil(g, 0, 0, S);
  else if (kind === 'tag') drawTag(g, 0, 0, S);
  else if (kind === 'crack') drawCrack(g, 0, 0, S);
  else drawScorch(g, 0, 0, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  textures[kind] = t;
  return t;
}

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _e = new THREE.Euler();
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Project one decal quad onto a surface. `n` is the outward surface normal. */
export function addDecal(
  b: LevelBuilder, kind: DecalKind, p: THREE.Vector3, n: THREE.Vector3, size: number, rot: number, tint = 0xffffff,
) {
  const [u0, v0] = [0.004, 0.004];
  const s = 0.992;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u0 + s, v0, u0 + s, v0 + s, u0, v0 + s], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  _n.copy(n).normalize();
  _q.setFromUnitVectors(FORWARD, _n);
  _roll.setFromAxisAngle(_n, rot);
  _q.premultiply(_roll);
  _e.setFromQuaternion(_q);
  b.geo(MAT_OF[kind], geo, p, _e, size, tint);
  geo.dispose();
}

/**
 * Scatters the decal layer over the finished level: tags and cracks on wall faces, oil under the
 * vehicles and scorch near the burn pits.
 */
const DEFAULT_OIL: [number, number][] = [
  [49.2, -42.6], [43.6, -50.4], [47.4, -50.6], [12.6, 5.9], [-6.2, 5.8], [-2.2, -12.3],
  [53.2, -30.6], [30, 10], [-30, 42], [8, -34], [45, -18], [25.5, 60], [2.1, 9.3], [-39.8, -33.2],
];
const DEFAULT_SCORCH: [number, number][] = [[-190, -230], [260, -60]];

export function decorateDecals(
  b: LevelBuilder,
  oil: [number, number][] = DEFAULT_OIL,
  scorch: [number, number][] = DEFAULT_SCORCH,
) {
  const r = rng(2024);
  const cols = b.world.colliders;
  let placed = 0;
  const place = (c: typeof cols[number]) => {
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    const alongX = w >= d;
    const sign = r() < 0.5 ? -1 : 1;
    const y = c.minY + 0.8 + r() * Math.min(1.8, Math.max(0.4, c.maxY - c.minY - 0.9));
    // colliders can be rotated: build the face from the local axes, not from the AABB
    const ax = c.cos, az = -c.sin;
    const bx = c.sin, bz = c.cos;
    let px = c.cx, pz = c.cz;
    let nx = 0, nz = 0;
    if (alongX) {
      const t = (r() - 0.5) * Math.max(0.2, d - 0.3);
      nx = ax * sign;
      nz = az * sign;
      px = c.cx + ax * sign * c.hx + bx * t;
      pz = c.cz + az * sign * c.hx + bz * t;
    } else {
      const t = (r() - 0.5) * Math.max(0.2, w - 0.3);
      nx = bx * sign;
      nz = bz * sign;
      px = c.cx + bx * sign * c.hz + ax * t;
      pz = c.cz + bz * sign * c.hz + az * t;
    }
    const kind: DecalKind = r() < 0.58 ? 'tag' : 'crack';
    const size = kind === 'tag' ? 0.9 + r() * 1.0 : 0.7 + r() * 0.8;
    _p.set(px + nx * 0.07, y, pz + nz * 0.07);
    _n.set(nx, 0, nz);
    addDecal(b, kind, _p, _n, size, kind === 'tag' ? (r() - 0.5) * 0.4 : r() * Math.PI * 2, 0xffffff);
    placed++;
  };
  for (const c of cols) {
    if (placed >= 160) break;
    // Only project wall cracks/stains onto solid concrete walls — never onto vehicles, tents, or sandbags
    if (!c.enabled || c.noRay || c.surface !== 'concrete' || c.maxY - c.minY < 1.8 || c.maxY < 2.0) continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    if (w < 1.4 && d < 1.4) continue;
    if (r() > 0.8) continue;
    const n = 1 + Math.floor(r() * 2);
    for (let k = 0; k < n && placed < 160; k++) place(c);
  }
  // oil and scorch on the ground where vehicles and burn pits live
  for (const [x, z] of oil) {
    addDecal(b, 'oil', new THREE.Vector3(x + (r() - 0.5) * 1.6, 0.045, z + (r() - 0.5) * 1.6), new THREE.Vector3(0, 1, 0), 1.6 + r() * 1.4, r() * 6.28, 0xffffff);
    addDecal(b, 'oil', new THREE.Vector3(x + (r() - 0.5) * 2.4, 0.045, z + (r() - 0.5) * 2.4), new THREE.Vector3(0, 1, 0), 0.9 + r() * 0.9, r() * 6.28, 0xffffff);
  }
  for (const [x, z] of scorch) {
    addDecal(b, 'scorch', new THREE.Vector3(x, 0.05, z), new THREE.Vector3(0, 1, 0), 3.6 + r() * 2.6, r() * 6.28, 0xffffff);
  }
}
