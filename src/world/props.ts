import * as THREE from 'three';
import type { PropName } from '../render/assets';
import { BoxOpts, LevelBuilder, type MatRef } from './build';

/** Local frame for composite props rotated around Y. */
export class Frame {
  cos: number;
  sin: number;
  constructor(public b: LevelBuilder, public x: number, public z: number, public rot: number, public y = 0) {
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
  }
  wx(lx: number, lz: number) {
    return this.x + lx * this.cos + lz * this.sin;
  }
  wz(lx: number, lz: number) {
    return this.z - lx * this.sin + lz * this.cos;
  }
  v(lx: number, y: number, lz: number) {
    return new THREE.Vector3(this.wx(lx, lz), this.y + y, this.wz(lx, lz));
  }
  /** Decorative box in local coordinates. */
  d(mat: MatRef, lx: number, y0: number, lz: number, w: number, h: number, d: number, o: BoxOpts = {}) {
    o.rot = this.rot + (o.rot ?? 0);
    o.collide = false;
    this.b.box(mat, this.wx(lx, lz), this.y + y0, this.wz(lx, lz), w, h, d, o);
  }
  /** Colliding box in local coordinates. */
  c(mat: MatRef, lx: number, y0: number, lz: number, w: number, h: number, d: number, o: BoxOpts = {}) {
    o.rot = this.rot + (o.rot ?? 0);
    return this.b.box(mat, this.wx(lx, lz), this.y + y0, this.wz(lx, lz), w, h, d, o);
  }
  solid(lx: number, y0: number, lz: number, w: number, h: number, d: number, surface: any = 'metal', nav = true) {
    return this.b.solid(this.wx(lx, lz), this.y + y0, this.wz(lx, lz), w, h, d, this.rot, surface, nav);
  }
  /** Wheel-like cylinder whose axis lies along local Z. */
  wheel(mat: MatRef, lx: number, y: number, lz: number, r: number, w: number, color: number, segs = 14) {
    const g = new THREE.CylinderGeometry(r, r, w, segs, 1);
    this.b.geo(mat, g, this.v(lx, y, lz), new THREE.Euler(Math.PI / 2, this.rot, 0, 'YXZ'), 1, color);
    g.dispose();
  }
}

const jitterColor = (b: LevelBuilder, hex: number, amt: number) => {
  const c = new THREE.Color(hex);
  const k = 1 + b.r(-amt, amt);
  c.multiplyScalar(k);
  return c.getHex();
};

// ---------------------------------------------------------------------------
// Barriers & fortifications
// ---------------------------------------------------------------------------

export function jersey(b: LevelBuilder, x: number, z: number, rot = 0, len = 3) {
  const f = new Frame(b, x, z, rot);
  // scanned concrete road barriers, two 1.5 m units per 3 m run
  const unit = 1.544;
  const n = Math.max(1, Math.round(len / 1.5));
  const seg = len / n;
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * seg;
    b.model('road_barrier', f.wx(lx, 0), 0, f.wz(lx, 0), rot + (b.rnd() < 0.5 ? Math.PI : 0) + b.r(-0.02, 0.02), {
      scale: { x: (seg / unit) * 0.995, y: 1.04, z: 0.95 },
      color: jitterColor(b, 0xe6e2da, 0.08),
    });
  }
  f.solid(0, 0, 0, len, 0.86, 0.5, 'concrete');
}

export function hesco(b: LevelBuilder, x: number, z: number, rot: number, count: number, stack = 1) {
  const f = new Frame(b, x, z, rot);
  const S = 1.1;
  const H = 1.37;
  for (let s = 0; s < stack; s++) {
    for (let i = 0; i < count; i++) {
      const lx = (i - (count - 1) / 2) * S;
      f.d('hesco', lx, s * H, 0, S - 0.02, H, S - 0.02, { color: jitterColor(b, 0xd8ccb0, 0.07), grime: s === 0 ? 0.8 : 1 });
      if (s === stack - 1) f.d('sand', lx, stack * H, 0, S - 0.12, 0.1, S - 0.12, { taper: [0.6, 0.6], color: 0xd9c9a8 });
    }
  }
  f.solid(0, 0, 0, count * S, stack * H, S, 'sand');
}

export function sandbags(b: LevelBuilder, x: number, z: number, rot: number, len: number, rows = 5, y0 = 0, collide = true) {
  const f = new Frame(b, x, z, rot, y0);
  // modelled sandbag wall sections (1.94 m long, three courses high), stacked and laid end to end
  const UL = 1.939, UH = 0.342;
  const height = rows * 0.175 + 0.06;
  const layers = Math.max(1, Math.round(height / UH));
  const n = Math.max(1, Math.round(len / UL));
  const seg = len / n;
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < n; i++) {
      const lx = (i - (n - 1) / 2) * seg;
      const flip = (l + i) % 2 ? Math.PI : 0;
      b.model('sandbags', f.wx(lx, 0), y0 + l * (height / layers) * 0.985, f.wz(lx, 0), rot + flip + b.r(-0.015, 0.015), {
        scale: { x: (seg / UL) * 1.01, y: height / layers / UH, z: 0.66 },
        color: jitterColor(b, 0xe8e0cf, 0.08),
      });
    }
  }
  if (collide) f.solid(0, 0, 0, len, height, 0.44, 'sand');
}

export function container(b: LevelBuilder, x: number, y0: number, z: number, rot: number, color: number, open = false) {
  const f = new Frame(b, x, z, rot, y0);
  const L = 6.06, H = 2.59, W = 2.44;
  if (!open) {
    // modelled ISO container, repainted through its (greyscale) albedo
    b.model('container', x, y0, z, rot, { color: new THREE.Color(color).multiplyScalar(0.88).lerp(new THREE.Color(0xffffff), 0.04).getHex() });
    f.solid(0, 0, 0, L, H, W, 'metal');
    return;
  }
  const frameCol = new THREE.Color(color).multiplyScalar(0.7).getHex();
  const post = (lx: number, lz: number) => f.d('metal', lx, 0, lz, 0.14, H, 0.14, { color: frameCol, grime: 0.8 });
  post(-L / 2 + 0.07, -W / 2 + 0.07);
  post(L / 2 - 0.07, -W / 2 + 0.07);
  post(-L / 2 + 0.07, W / 2 - 0.07);
  post(L / 2 - 0.07, W / 2 - 0.07);
  for (const lz of [-W / 2 + 0.05, W / 2 - 0.05]) {
    f.d('metal', 0, 0, lz, L, 0.14, 0.1, { color: frameCol });
    f.d('metal', 0, H - 0.12, lz, L, 0.12, 0.1, { color: frameCol });
  }
  if (!open) {
    f.d('corrugated', 0, 0.04, 0, L - 0.1, H - 0.08, W - 0.08, { color, grime: 0.8 });
    // door end (+X)
    for (const lz of [-0.6, 0.6]) {
      f.d('metal', L / 2 + 0.01, 0.12, lz, 0.04, H - 0.24, 1.12, { color, grime: 0.85 });
      for (const o2 of [-0.25, 0.25]) f.d('darkmetal', L / 2 + 0.05, 0.12, lz + o2, 0.035, H - 0.24, 0.035, { color: 0x6a6a68 });
      f.d('darkmetal', L / 2 + 0.07, 1.15, lz, 0.03, 0.06, 0.6, { color: 0x555555 });
    }
    f.solid(0, 0, 0, L, H, W, 'metal');
  } else {
    const t = 0.07;
    f.c('wood', 0, 0, 0, L, 0.14, W, { color: 0x8a7a66, surface: 'wood' });
    f.c('corrugated', 0, 0.14, -W / 2 + t / 2, L - 0.1, H - 0.2, t, { color, grime: 0.8 });
    f.c('corrugated', 0, 0.14, W / 2 - t / 2, L - 0.1, H - 0.2, t, { color, grime: 0.8 });
    f.c('corrugated', -L / 2 + t / 2, 0.14, 0, t, H - 0.2, W - 0.1, { color, grime: 0.8 });
    f.c('corrugated', 0, H - 0.08, 0, L, 0.08, W, { color });
    // doors swung open
    f.c('metal', L / 2 + 0.55, 0.12, -W / 2 - 0.25, 1.16, H - 0.24, 0.05, { color, rot: 0.5, grime: 0.85 });
    f.c('metal', L / 2 + 0.5, 0.12, W / 2 + 0.3, 1.16, H - 0.24, 0.05, { color, rot: -0.6, grime: 0.85 });
  }
}

// ---------------------------------------------------------------------------
// Small props
// ---------------------------------------------------------------------------

export function barrel(b: LevelBuilder, x: number, z: number, color = 0x3f5d78, y0 = 0) {
  // scanned steel drum; its albedo is greyscale so the vertex colour repaints it
  b.model('barrel', x, y0, z, b.r(0, 6.28), { scale: 0.95, color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.1).getHex() });
  b.world.addBox(x, y0 + 0.44, z, 0.26, 0.44, 0.26, 0, 'metal', true);
}

/** Small loose props that only dress the scene (no collision). */
export function clutter(b: LevelBuilder, name: PropName, x: number, z: number, rot = 0, y0 = 0, scale = 1, color = 0xffffff) {
  b.model(name, x, y0, z, rot, { scale, color });
}

/** Model with a box collider derived from its bounds. */
export function solidProp(b: LevelBuilder, name: PropName, x: number, z: number, rot = 0, y0 = 0, scale = 1, o: { surface?: any; shrink?: number; maxH?: number; color?: number; nav?: boolean } = {}) {
  const p = b.model(name, x, y0, z, rot, { scale, color: o.color });
  const k = o.shrink ?? 0.92;
  const h = Math.min(p.size.y * scale, o.maxH ?? 99);
  b.solid(x, y0, z, p.size.x * scale * k, h, p.size.z * scale * k, rot, o.surface ?? 'metal', o.nav ?? true);
  return p;
}

export function crate(b: LevelBuilder, x: number, y0: number, z: number, s: number, rot = 0, mil = false) {
  const f = new Frame(b, x, z, rot, y0);
  if (mil) {
    // scanned wooden military crate (1.24 x 0.465 x 0.52 m), fitted to the gameplay footprint
    const w = s * 1.6, d = s * 0.8, h = s * 0.6;
    b.model('mil_crate', x, y0, z, rot, { scale: { x: w / 1.242, y: h / 0.465, z: d / 0.52 } });
    f.solid(0, 0, 0, w, h, d, 'wood');
  } else {
    f.c('wood', 0, 0, 0, s, s, s, { color: jitterColor(b, 0xd8c8a8, 0.12), grime: 0.85 });
    const e = 0.07;
    for (const y of [0, s - e]) {
      f.d('wood', 0, y, s / 2 + 0.012, s + 0.03, e, 0.024, { color: 0xb09a78 });
      f.d('wood', 0, y, -s / 2 - 0.012, s + 0.03, e, 0.024, { color: 0xb09a78 });
      f.d('wood', s / 2 + 0.012, y, 0, 0.024, e, s + 0.03, { color: 0xb09a78 });
      f.d('wood', -s / 2 - 0.012, y, 0, 0.024, e, s + 0.03, { color: 0xb09a78 });
    }
  }
}

export function pallet(b: LevelBuilder, x: number, y0: number, z: number, rot = 0) {
  const f = new Frame(b, x, z, rot, y0);
  b.model('pallet', x, y0, z, rot, { scale: { x: 1, y: 0.9, z: 1.25 }, color: jitterColor(b, 0xf0e6d6, 0.1) });
  f.solid(0, 0, 0, 1.2, 0.12, 1.0, 'wood', false);
}

export function tires(b: LevelBuilder, x: number, z: number, count: number) {
  // scanned worn tyre, laid flat and stacked
  for (let i = 0; i < count; i++) {
    b.model('tyre', x + b.r(-0.05, 0.05), i * 0.235, z + b.r(-0.05, 0.05), b.r(0, 6.28), { scale: 1.42, tilt: [b.r(-0.03, 0.03), b.r(-0.03, 0.03)] });
  }
  b.solid(x, 0, z, 0.8, count * 0.235 + 0.02, 0.8, 0, 'fabric');
}

export function dumpster(b: LevelBuilder, x: number, z: number, rot = 0, color = 0xffffff) {
  const f = new Frame(b, x, z, rot);
  const tint = color === 0xffffff ? 0xffffff : new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.6).getHex();
  const p = b.model('dumpster', x, 0, z, rot, { scale: 1.08, color: tint });
  f.solid(0, 0, 0, p.size.x * 1.04, p.size.y * 1.06, p.size.z * 1.02, 'metal');
  if (b.rnd() < 0.7) b.model('trash_bags', f.wx(p.size.x * 0.5 + 0.75, 0.1), 0, f.wz(p.size.x * 0.5 + 0.75, 0.1), b.r(0, 6.28), { scale: 0.85 });
}

export function rubble(b: LevelBuilder, x: number, z: number, r: number, n: number, color = 0xb5aea0) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  b.deco('concrete', x, 0, z, r * 1.5, 0.28, r * 1.5, { taper: [0.5, 0.5], color: 0x9c958a, rot: b.r(0, 3) });
  for (let i = 0; i < n; i++) {
    const a = b.r(0, Math.PI * 2);
    const d = Math.sqrt(b.rnd()) * r;
    const s = b.r(0.12, 0.55) * (1 - (d / r) * 0.5);
    b.geo('concrete', g, { x: x + Math.cos(a) * d, y: s * 0.25 + b.r(0, 0.22) * (1 - d / r), z: z + Math.sin(a) * d },
      new THREE.Euler(b.r(0, 3), b.r(0, 3), b.r(0, 3)), { x: s * b.r(0.6, 1.5), y: s * b.r(0.4, 0.9), z: s * b.r(0.6, 1.3) }, jitterColor(b, color, 0.18), 0.4);
  }
  for (let i = 0; i < Math.min(4, n / 6); i++) {
    const a = b.r(0, Math.PI * 2);
    const p = new THREE.Vector3(x + Math.cos(a) * r * 0.4, 0.1, z + Math.sin(a) * r * 0.4);
    b.tube('darkmetal', p, p.clone().add(new THREE.Vector3(b.r(-0.5, 0.5), b.r(0.5, 1.1), b.r(-0.5, 0.5))), 0.012, 0x5a3a28, 4);
  }
  g.dispose();
  b.solid(x, 0, z, r * 1.1, 0.4, r * 1.1, 0, 'concrete');
}

// ---------------------------------------------------------------------------
// Vehicles (high-poly PBR GLB models with gritty matte military/desert weathering)
// ---------------------------------------------------------------------------

/** Weathers requested vehicle paint into gritty, sun-baked desert/urban tones (never glossy plastic white). */
const vehTint = (color: number, wreck: boolean) => {
  if (wreck) return 0x453d36;
  const c = new THREE.Color(color);
  // Desaturate slightly and keep realistic mid-low desert albedo so vehicles ground naturally under HDR sun
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  c.r = (c.r * 0.78 + lum * 0.22) * 0.86;
  c.g = (c.g * 0.78 + lum * 0.22) * 0.84;
  c.b = (c.b * 0.78 + lum * 0.22) * 0.78;
  return c.getHex();
};

export function pickup(b: LevelBuilder, x: number, z: number, rot: number, color: number, wreck = false) {
  const f = new Frame(b, x, z, rot);
  b.model('veh_pickup', x, 0, z, rot, { scale: 0.9, color: vehTint(color, wreck) });
  f.solid(0, 0, 0, 4.7, 1.05, 2.0, 'metal');
  f.solid(0.15, 1.0, 0, 2.1, 0.72, 1.85, 'metal');
}

export function sedan(b: LevelBuilder, x: number, z: number, rot: number, color: number, wreck = false) {
  const f = new Frame(b, x, z, rot);
  b.model('veh_sedan', x, 0, z, rot, { scale: 0.94, color: vehTint(color, wreck) });
  f.solid(0, 0, 0, 4.4, 0.92, 1.76, 'metal');
  f.solid(-0.1, 0.88, 0, 2.2, 0.52, 1.58, 'metal');
}

export function humvee(b: LevelBuilder, x: number, z: number, rot: number, color = 0x9c8b68) {
  const f = new Frame(b, x, z, rot);
  const tint = new THREE.Color(color).lerp(new THREE.Color(0x9a8966), 0.35).multiplyScalar(0.84).getHex();
  b.model('veh_offroad', x, 0, z, rot, { scale: 0.96, color: tint });
  f.solid(0, 0, 0, 4.75, 1.25, 2.1, 'metal');
  f.solid(-0.15, 1.2, 0, 2.8, 1.1, 1.95, 'metal');
}

export function armoredTruck(b: LevelBuilder, x: number, z: number, rot: number, color = 0x867e64) {
  const f = new Frame(b, x, z, rot);
  const tint = new THREE.Color(color).lerp(new THREE.Color(0x7c7660), 0.35).multiplyScalar(0.82).getHex();
  b.model('veh_armored', x, 0, z, rot, { scale: 0.92, color: tint });
  f.solid(0, 0, 0, 5.85, 2.65, 2.45, 'metal');
}

export function cargoTruck(b: LevelBuilder, x: number, z: number, rot: number, color = 0x565e42) {
  const f = new Frame(b, x, z, rot);
  const tint = new THREE.Color(color).lerp(new THREE.Color(0x64684e), 0.3).multiplyScalar(0.84).getHex();
  b.model('veh_truck', x, 0, z, rot, { scale: 1.08, color: tint });
  f.solid(0, 0, 0, 6.85, 3.1, 2.95, 'metal');
}

export function tankerTruck(b: LevelBuilder, x: number, z: number, rot: number, color = 0xa89f8a) {
  const f = new Frame(b, x, z, rot);
  const tint = new THREE.Color(color).multiplyScalar(0.76).getHex();
  b.model('veh_tanker', x, 0, z, rot, { scale: 0.86, color: tint });
  f.solid(0, 0, 0, 7.85, 2.8, 2.38, 'metal');
}

export function helicopter(b: LevelBuilder, x: number, z: number, rot: number, color = 0x525945) {
  const f = new Frame(b, x, z, rot);
  // Matte tactical military olive-drab fuselage (replaces shiny white civilian paint)
  const tint = new THREE.Color(color).lerp(new THREE.Color(0x4b5340), 0.72).multiplyScalar(0.78).getHex();
  b.model('veh_heli', x, 0, z, rot, { scale: 1.02, color: tint });
  // Fuselage & tail boom colliders (keeps rotor clearance realistic so player can walk around the skids)
  f.solid(0.6, 0, 0, 4.8, 2.3, 2.2, 'metal');
  f.solid(-2.6, 0.8, 0, 3.4, 1.2, 0.7, 'metal');
}

export function forklift(b: LevelBuilder, x: number, z: number, rot: number, color = 0xc8b47c) {
  const f = new Frame(b, x, z, rot);
  b.model('veh_forklift', x, 0, z, rot, { scale: 0.86, color: new THREE.Color(color).multiplyScalar(0.82).getHex() });
  f.solid(0, 0, 0, 3.2, 1.95, 1.15, 'metal');
}

// ---------------------------------------------------------------------------
// Vegetation, poles, wires
// ---------------------------------------------------------------------------

let frondGeo: THREE.BufferGeometry | null = null;
function makeFrond() {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const L = 3.3;
  const N = 26;
  const spine = (t: number) => new THREE.Vector3(L * t * (1 - 0.18 * t), 0.75 * t - 1.75 * t * t, 0);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.y < 0) {
      const t = b; b = c; c = t;
      n.negate();
    }
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(0, 0);
    }
  };
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const p0 = spine(t0), p1 = spine(t1);
    // rib
    const w = 0.035 * (1 - t0 * 0.7);
    tri(p0.clone().add(new THREE.Vector3(0, 0, -w)), p0.clone().add(new THREE.Vector3(0, 0, w)), p1.clone().add(new THREE.Vector3(0, 0, w)));
    tri(p0.clone().add(new THREE.Vector3(0, 0, -w)), p1.clone().add(new THREE.Vector3(0, 0, w)), p1.clone().add(new THREE.Vector3(0, 0, -w)));
    if (i < 2) continue;
    const len = 0.2 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, t0 * 1.08)), 0.6);
    for (const s of [-1, 1]) {
      const tip = p0.clone().add(new THREE.Vector3(len * 0.35, -len * 0.42, s * len * 0.85));
      const a = p0.clone();
      const c = p1.clone().lerp(p0, 0.25);
      tri(a, c, tip);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Scanned desert tree (quiver tree), scaled up to street-tree size. */
export function tree(b: LevelBuilder, x: number, z: number, height = 7, collide = true) {
  // (callers pass palm-like heights; this species is stockier)
  const s = (height * 0.68) / 1.468;
  b.model(collide ? 'tree' : 'tree_far', x, -0.06 * s, z, b.r(0, 6.28), { scale: { x: s * b.r(0.82, 0.95), y: s, z: s * b.r(0.82, 0.95) }, tilt: [b.r(-0.05, 0.05), b.r(-0.05, 0.05)] });
  if (collide) b.solid(x, 0, z, 0.2 * s, Math.min(height * 0.6, 4), 0.2 * s, 0, 'wood');
}

export function palm(b: LevelBuilder, x: number, z: number, height = 7, collide = true) {
  if (!frondGeo) frondGeo = makeFrond();
  const lean = new THREE.Vector2(b.r(-1, 1), b.r(-1, 1)).multiplyScalar(0.9);
  const segs = 7;
  let prev = new THREE.Vector3(x, -0.1, z);
  const top = new THREE.Vector3();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = new THREE.Vector3(x + lean.x * t * t, height * t, z + lean.y * t * t);
    const r0 = 0.24 - 0.09 * ((i - 1) / segs), r1 = 0.24 - 0.09 * t;
    const d = new THREE.Vector3().subVectors(p, prev);
    const g = new THREE.CylinderGeometry(r1 * 1.08, r0, d.length() + 0.04, 8, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(p, prev).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    b.geoM('trunk', g, m, i % 2 ? 0x8f7d62 : 0x7d6c54, 2);
    g.dispose();
    prev = p;
    top.copy(p);
  }
  const crown = new THREE.SphereGeometry(0.36, 8, 6);
  b.geo('trunk', crown, top, null, { x: 1, y: 1.2, z: 1 }, 0x6f6248);
  crown.dispose();
  const n = 13;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + b.r(-0.2, 0.2);
    const upper = i % 3 === 0;
    const pitch = upper ? b.r(0.35, 0.7) : b.r(-0.25, 0.25);
    const s = b.r(0.8, 1.1) * (upper ? 0.8 : 1);
    const dry = b.rnd() < 0.2;
    const m = new THREE.Matrix4().compose(
      top.clone().add(new THREE.Vector3(0, 0.15, 0)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(b.r(-0.3, 0.3), yaw, pitch, 'YZX')),
      new THREE.Vector3(s, s, s),
    );
    b.geoM('foliage', frondGeo, m, dry ? 0x8a7a3e : b.pick([0x4f6a2c, 0x5b7532, 0x466026, 0x627a3a]));
  }
  if (collide) b.solid(x, 0, z, 0.42, Math.min(height, 4), 0.42, 0, 'wood');
}

export function utilityPole(b: LevelBuilder, x: number, z: number, rot = 0, h = 8.5): THREE.Vector3[] {
  // modelled timber pole (10 m) with its cross-arm along local Z; wires hang from the insulators
  const s = h / 10;
  b.model('utility_pole', x, 0, z, rot, { scale: s });
  b.solid(x, 0, z, 0.3, 4, 0.3, 0, 'wood');
  const f = new Frame(b, x, z, rot);
  const pts: THREE.Vector3[] = [];
  for (const lz of [-1.08, 0, 1.08]) pts.push(f.v(0.14 * s, 9.68 * s, lz * s));
  // transformer on some poles
  if (b.rnd() < 0.4) {
    const g = new THREE.CylinderGeometry(0.26, 0.26, 0.7, 10);
    b.geo('metal', g, f.v(-0.42, h - 2.6, 0), null, 1, 0x8a8f8c);
    g.dispose();
  }
  return pts;
}

/** Car left under a tarpaulin (scanned). Long axis along local X, like the other vehicles. */
export function coveredCar(b: LevelBuilder, x: number, z: number, rot: number, color = 0xffffff) {
  const f = new Frame(b, x, z, rot);
  b.model('covered_car', x, 0, z, rot + Math.PI / 2, { scale: 1.03, color });
  f.solid(0, 0, 0, 4.3, 0.95, 1.75, 'fabric');
  f.solid(-0.1, 0.9, 0, 2.2, 0.5, 1.5, 'fabric');
}

export function wire(b: LevelBuilder, a: THREE.Vector3, c: THREE.Vector3, sag = 0.7) {
  const N = 8;
  let prev = a.clone();
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const p = new THREE.Vector3().lerpVectors(a, c, t);
    p.y -= sag * 4 * t * (1 - t);
    b.tube('darkmetal', prev, p, 0.012, 0x151515, 4);
    prev = p;
  }
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export function marketStall(b: LevelBuilder, x: number, z: number, rot: number, color: number) {
  const f = new Frame(b, x, z, rot);
  const tint = new THREE.Color(color).lerp(new THREE.Color(0xc2b298), 0.58).multiplyScalar(0.84).getHex();
  b.model('arch_stall', x, 0, z, rot, { scale: { x: 0.94, y: 0.96, z: 0.94 }, color: tint });
  f.solid(0, 0, 0.15, 3.1, 0.92, 1.25, 'wood');
}

export function tent(b: LevelBuilder, x: number, z: number, rot: number, w = 5, d = 7.5, color = 0x6a6f4c) {
  const f = new Frame(b, x, z, rot);
  const wall = 1.7, ridge = 2.9;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const quad = (a: number[], b2: number[], c: number[], d2: number[]) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b2), vc = new THREE.Vector3(...c), vd = new THREE.Vector3(...d2);
    const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
    for (const p of [va, vb, vc, va, vc, vd]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push((p.x + p.z) * 0.5, p.y * 0.5 + p.z * 0.3);
    }
  };
  const hw = w / 2, hd = d / 2;
  // side walls
  quad([hw, 0, hd], [hw, 0, -hd], [hw, wall, -hd], [hw, wall, hd]);
  quad([-hw, 0, -hd], [-hw, 0, hd], [-hw, wall, hd], [-hw, wall, -hd]);
  // roof slopes
  quad([hw, wall, hd], [hw, wall, -hd], [0, ridge, -hd], [0, ridge, hd]);
  quad([-hw, wall, -hd], [-hw, wall, hd], [0, ridge, hd], [0, ridge, -hd]);
  // gables
  quad([-hw, 0, hd], [hw, 0, hd], [hw, wall, hd], [-hw, wall, hd]);
  quad([-hw, wall, hd], [hw, wall, hd], [0, ridge, hd], [0, ridge, hd]);
  quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, wall, -hd], [hw, wall, -hd]);
  quad([hw, wall, -hd], [-hw, wall, -hd], [0, ridge, -hd], [0, ridge, -hd]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  b.geo('fabric', g, f.v(0, 0, 0), new THREE.Euler(0, rot, 0), 1, color, 1);
  g.dispose();
  // door flap + ridge pole + guy ropes
  f.d('fabric', 0, 0, hd + 0.02, 1.3, 2.0, 0.02, { color: new THREE.Color(color).multiplyScalar(0.55).getHex() });
  f.d('wood', 0, ridge - 0.02, 0, 0.08, 0.08, d + 0.3, { color: 0x6a5a44 });
  for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) b.tube('darkmetal', f.v(sx * hw, wall, sz * hd * 0.9), f.v(sx * (hw + 1.1), 0, sz * hd * 0.95), 0.01, 0x8a8468, 4);
  f.solid(0, 0, 0, w, wall + 0.6, d, 'fabric');
}

/**
 * Modern AAA Tactical Military Watchtower: concrete footing pads, cross-braced structural
 * steel frame, HESCO/sandbagged lower skirt, elevated armored observation deck with 360-degree
 * sandbag firing parapet, corrugated pitched steel canopy, caged steel ladder, and comms mast.
 */
export function guardTower(b: LevelBuilder, x: number, z: number, rot: number) {
  const f = new Frame(b, x, z, rot);
  const deckY = 4.6;
  const roofY = 7.05;
  const steel = 0x42474a;
  const hw = 1.55;

  // Concrete base pad + 4 reinforced concrete column footings + lower HESCO blast skirt
  f.c('slab', 0, 0, 0, 3.8, 0.14, 3.8, { color: 0xb6b0a4, nav: false });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      f.d('concrete', sx * hw, 0.14, sz * hw, 0.46, 0.45, 0.46, { color: 0xbcb5a6 });
      // Main structural steel H-column legs rising to roof eaves
      f.d('darkmetal', sx * hw, 0.59, sz * hw, 0.16, roofY - 0.59, 0.16, { color: steel });
    }
  }
  // Cross-braced steel lattice bays on all 4 sides (two vertical tiers)
  for (const [y0, y1] of [[0.6, 2.6], [2.6, deckY]] as [number, number][]) {
    for (const sz of [-1, 1]) {
      b.tube('darkmetal', f.v(-hw, y0, sz * hw), f.v(hw, y1, sz * hw), 0.036, steel, 5);
      b.tube('darkmetal', f.v(hw, y0, sz * hw), f.v(-hw, y1, sz * hw), 0.036, steel, 5);
      f.d('darkmetal', 0, y1 - 0.06, sz * hw, hw * 2, 0.1, 0.1, { color: steel });
    }
    for (const sx of [-1, 1]) {
      b.tube('darkmetal', f.v(sx * hw, y0, -hw), f.v(sx * hw, y1, hw), 0.036, steel, 5);
      b.tube('darkmetal', f.v(sx * hw, y0, hw), f.v(sx * hw, y1, -hw), 0.036, steel, 5);
      f.d('darkmetal', sx * hw, y1 - 0.06, 0, 0.1, 0.1, hw * 2, { color: steel });
    }
  }
  // Sandbagged ground defense ring around base legs
  sandbags(b, f.wx(0, hw + 0.1), f.wz(0, hw + 0.1), rot, 3.2, 4, 0, false);
  sandbags(b, f.wx(hw + 0.1, 0), f.wz(hw + 0.1, 0), rot + Math.PI / 2, 3.2, 4, 0, false);

  // Elevated observation deck floor (timber planks over heavy steel I-beam frame)
  f.d('darkmetal', 0, deckY - 0.14, 0, 3.65, 0.16, 3.65, { color: 0x363a3d });
  f.d('wood', 0, deckY, 0, 3.55, 0.1, 3.55, { color: 0x7e6a4e });
  // Waist-high corrugated ballistic armor skirt + sandbagged firing rim on all 4 sides
  for (const sz of [-1, 1]) {
    f.d('corrugated', 0, deckY + 0.1, sz * 1.72, 3.52, 1.05, 0.08, { color: 0x626856 });
    sandbags(b, f.wx(0, sz * 1.48), f.wz(0, sz * 1.48), rot, 2.9, 2, deckY + 0.1, false);
  }
  for (const sx of [-1, 1]) {
    f.d('corrugated', sx * 1.72, deckY + 0.1, 0, 0.08, 1.05, 3.52, { color: 0x626856 });
    sandbags(b, f.wx(sx * 1.48, 0), f.wz(sx * 1.48, 0), rot + Math.PI / 2, 2.9, 2, deckY + 0.1, false);
  }
  // Overhead steel roof frame + pitched corrugated steel shade canopy
  for (const sz of [-1, 1]) f.d('darkmetal', 0, roofY, sz * hw, 3.5, 0.1, 0.1, { color: steel });
  for (const sx of [-1, 1]) f.d('darkmetal', sx * hw, roofY, 0, 0.1, 0.1, 3.5, { color: steel });
  const peak = 0.58;
  const slopeSpan = 2.15;
  const slopeLen = Math.hypot(slopeSpan, peak);
  const pitch = Math.atan2(peak, slopeSpan);
  const roofSheet = new THREE.BoxGeometry(4.25, 0.055, slopeLen);
  for (const sz of [-1, 1]) {
    b.geo('corrugated', roofSheet, f.v(0, roofY + peak * 0.5 + 0.08, sz * slopeSpan * 0.5), new THREE.Euler(sz * pitch, rot, 0, 'YXZ'), 1, 0x676d5b);
  }
  roofSheet.dispose();

  // Exterior vertical steel ladder on rear face (-Z) + tactical rooftop comms mast & searchlight
  for (const lx of [-0.24, 0.24]) f.d('darkmetal', lx, 0.14, -hw - 0.18, 0.04, deckY + 0.6, 0.04, { color: 0x2f3336 });
  for (let ry = 0.5; ry <= deckY + 0.4; ry += 0.38) f.d('darkmetal', 0, ry, -hw - 0.18, 0.5, 0.025, 0.025, { color: 0x2f3336 });
  b.model('security_light', f.wx(0, 1.65), roofY - 0.2, f.wz(0, 1.65), rot, { scale: 0.72 });
  b.model('searchlight', f.wx(1.15, 1.3), deckY + 1.16, f.wz(1.15, 1.3), rot + 0.3, { scale: 1.05 });
  b.model('field_radio', f.wx(-1.0, 1.15), deckY + 0.1, f.wz(-1.0, 1.15), rot, {});
  b.cyl('darkmetal', f.wx(-1.35, -1.35), roofY + 0.1, f.wz(-1.35, -1.35), 0.035, 2.3, 0x2c3032, { segs: 6 });

  f.solid(0, 0, 0, 3.55, 8.0, 3.55, 'metal');
}

export function waterTower(b: LevelBuilder, x: number, z: number) {
  // 11.6k-tri sculpted industrial water tower (native 7.96 x 18.34 x 7.96 -> scaled 0.72 to 5.73 x 13.2 x 5.73)
  b.model('arch_water_tower', x, 0, z, 0.35, { scale: 0.72, color: 0xe6dfd0 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4 + 0.35;
    b.solid(x + Math.cos(a) * 2.2, 0, z + Math.sin(a) * 2.2, 0.5, 3.5, 0.5, 0, 'metal');
  }
}

export function radioMast(b: LevelBuilder, x: number, z: number, h = 24) {
  // 23k-tri sculpted steel lattice radio mast (native 12.5 x 37.95 x 10.5)
  const s = h / 37.95;
  b.model('arch_radio_tower', x, 0, z, 0, { scale: s, color: 0xeae4d8 });
  b.solid(x, 0, z, Math.max(1.8, 6.2 * s), 6, Math.max(1.8, 5.4 * s), 0, 'metal');
}

export function corrugatedFence(b: LevelBuilder, axis: 'x' | 'z', c: number, a0: number, a1: number, h = 2.3) {
  const tints = [0x9a9d96, 0x8a7a66, 0xa3a59c, 0x7d8a8c, 0x94826a, 0xa89a84];
  const panel = 2.0;
  const n = Math.max(1, Math.round((a1 - a0) / panel));
  const step = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    const mid = a0 + (i + 0.5) * step;
    const hh = h + b.r(-0.12, 0.12);
    if (axis === 'x') {
      b.box('corrugated', mid, 0, c, step, hh, 0.05, { color: b.pick(tints), grime: 0.7 });
      b.deco('wood', a0 + i * step, 0, c + 0.06, 0.09, h + 0.1, 0.09, { color: 0x6a5a44 });
    } else {
      b.box('corrugated', c, 0, mid, 0.05, hh, step, { color: b.pick(tints), grime: 0.7 });
      b.deco('wood', c + 0.06, 0, a0 + i * step, 0.09, h + 0.1, 0.09, { color: 0x6a5a44 });
    }
  }
}

// ---------------------------------------------------------------------------
// Closed (non-enterable) buildings with detailed facades
// ---------------------------------------------------------------------------

type Side = 'n' | 's' | 'e' | 'w';

export interface BuildingOpts {
  color?: number;
  doors?: Side[];
  shop?: Side[];
  balcony?: Side[];
  /** 0 = background skyline, 1 = full hero architectural model. */
  detail?: number;
  collide?: boolean;
  roof?: boolean;
  /** Optional explicit high-poly architectural GLB override. */
  model?: PropName;
}

/** Industrial/military GLB models that retain photorealistic grounded proportions. */
const KEEP_GLB_MODELS = new Set<PropName>(['bldg_chu', 'bldg_site_office', 'bldg_hangar', 'bldg_warehouse']);

const BLDG_META: Record<string, [number, number, number]> = {
  bldg_warehouse: [44.0, 9.54, 39.3],
  bldg_hangar: [20.9, 8.81, 20.5],
  bldg_site_office: [6.1, 2.9, 3.29],
  bldg_chu: [15.99, 6.01, 4.7],
};

/**
 * AAA 4K-Scanned Middle-Eastern Urban Architecture Generator.
 * Replaces cartoon pastel buildings with gritty, authentic Insurgency/COD-grade desert
 * concrete-and-plaster multi-story blocks: exposed concrete structural columns & floor slabs,
 * 4K POM sun-baked plaster + exposed cinderblock battle damage, deeply recessed windows with
 * lintels/grilles & Poly Haven rolling shutters, ground-floor shopfront shutters & corrugated
 * awnings, cantilevered balconies with iron railings, AC condensers, rooftop stairwell
 * penthouses, protruding vertical rebar rods, rooftop water tanks, and satellite dishes.
 */
export function closedBuilding(b: LevelBuilder, cx: number, cz: number, w: number, d: number, h: number, o: BuildingOpts = {}) {
  const collide = o.collide !== false;
  const detail = o.detail ?? 1;

  // Keep authentic industrial / military container GLB structures when explicitly requested
  if (o.model && KEEP_GLB_MODELS.has(o.model)) {
    const [nx, ny, nz] = BLDG_META[o.model] ?? [10, 6, 10];
    const frontSide = o.shop?.[0] ?? o.doors?.[0] ?? o.balcony?.[0];
    let rot = 0;
    if (frontSide === 'n') rot = Math.PI;
    else if (frontSide === 'e') rot = Math.PI / 2;
    else if (frontSide === 'w') rot = -Math.PI / 2;
    else if ((w < d) !== (nx < nz)) rot = Math.PI / 2;
    const swapped = Math.abs(Math.sin(rot)) > 0.5;
    const sx = (swapped ? d : w) / nx;
    const sz = (swapped ? w : d) / nz;
    const avgXZ = (sx + sz) * 0.5;
    const sy = Math.min(avgXZ * 1.38, Math.max(avgXZ * 0.68, h / ny));
    const warmTint = o.color
      ? new THREE.Color(o.color).lerp(new THREE.Color(0xc8bfa8), 0.35).multiplyScalar(0.86).getHex()
      : 0xc2b8a4;
    b.model(o.model, cx, 0, cz, rot, { scale: { x: sx, y: sy, z: sz }, color: warmTint });
    const actualH = ny * sy;
    if (collide) b.solid(cx, 0, cz, w, actualH, d, 0, 'concrete');
    return;
  }

  // --- Gritty 4K Photo-Scanned Middle-Eastern Urban Architecture ---
  const baseCol = o.color ?? b.pick([0xd6c6a6, 0xcabca0, 0xddd0b4, 0xc4b598, 0xd1c2a4, 0xbfb49e]);
  const wallCol = new THREE.Color(baseCol).lerp(new THREE.Color(0xc8b99e), 0.28).getHex();
  const trimCol = new THREE.Color(wallCol).multiplyScalar(0.87).getHex();
  const darkTrim = new THREE.Color(wallCol).multiplyScalar(0.74).getHex();
  const cinderCol = new THREE.Color(wallCol).lerp(new THREE.Color(0x9a9386), 0.55).getHex();
  const floors = Math.max(1, Math.round(h / 3.3));
  const floorH = h / floors;
  const hw = w * 0.5, hd = d * 0.5;
  const shops = new Set(o.shop ?? []);
  const doors = new Set(o.doors ?? []);
  const balconies = new Set(o.balcony ?? []);

  // 1) Stepped concrete plinth foundation + main 4K POM plaster mass
  b.deco('cinder', cx, 0, cz, w + 0.14, 0.55, d + 0.14, { color: darkTrim, grime: 0.72 });
  b.box('plaster', cx, 0.55, cz, w, h - 0.55, d, { color: wallCol, absGrime: true, collide: false });
  // Full-envelope building collider covering plinth (y=0..0.55), corner pilasters (+0.18m), and rooftop parapet (+0.45m) so lasers/bullets never clip building edges!
  if (collide) b.solid(cx, 0, cz, w + 0.18, h + 0.45, d + 0.18, 0, 'concrete');

  // 2) Exposed concrete structural frame: corner columns, floor slab stringcourses, roofline cornice
  const colW = detail >= 0.5 ? 0.38 : 0.45;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.deco('concrete', cx + sx * (hw - colW * 0.35), 0, cz + sz * (hd - colW * 0.35), colW, h + 0.08, colW, { color: trimCol, absGrime: true });
    }
  }
  for (let fl = 1; fl <= floors; fl++) {
    const sy = fl * floorH;
    const thick = fl === floors ? 0.24 : 0.16;
    const over = fl === floors ? 0.24 : 0.12;
    b.deco('concrete', cx, sy - thick * 0.5, cz, w + over, thick, d + over, { color: fl === floors ? trimCol : darkTrim });
  }

  // 3) Rooftop perimeter parapet wall (stepped desert skyline) + rooftop stairwell penthouse + water tank + rebar
  const paraH = 0.72 + (b.rnd() < 0.4 ? 0.25 : 0);
  const pt = 0.24;
  b.deco('plaster', cx, h, cz - hd + pt * 0.5, w, paraH, pt, { color: wallCol });
  b.deco('plaster', cx, h, cz + hd - pt * 0.5, w, paraH, pt, { color: wallCol });
  b.deco('plaster', cx - hw + pt * 0.5, h, cz, pt, paraH, d - pt * 2, { color: wallCol });
  b.deco('plaster', cx + hw - pt * 0.5, h, cz, pt, paraH, d - pt * 2, { color: wallCol });
  // Coping stones on parapet
  b.deco('concrete', cx, h + paraH, cz - hd + pt * 0.5, w + 0.08, 0.08, pt + 0.08, { color: trimCol });
  b.deco('concrete', cx, h + paraH, cz + hd - pt * 0.5, w + 0.08, 0.08, pt + 0.08, { color: trimCol });
  b.deco('concrete', cx - hw + pt * 0.5, h + paraH, cz, pt + 0.08, 0.08, d, { color: trimCol });
  b.deco('concrete', cx + hw - pt * 0.5, h + paraH, cz, pt + 0.08, 0.08, d, { color: trimCol });

  // Offset rooftop stairwell access block / partial upper floor (breaks boxy rectangular roofs!)
  if (w >= 7 && d >= 7) {
    const pw = Math.min(w * 0.42, 4.4), pd = Math.min(d * 0.4, 3.8), ph = 2.35;
    const px = cx + (b.rnd() < 0.5 ? -1 : 1) * (hw - pw * 0.5 - 0.85);
    const pz = cz + (b.rnd() < 0.5 ? -1 : 1) * (hd - pd * 0.5 - 0.85);
    b.deco('cinder', px, h, pz, pw, ph, pd, { color: cinderCol });
    b.deco('concrete', px, h + ph, pz, pw + 0.2, 0.16, pd + 0.2, { color: trimCol });
    // Rooftop water tank on dark steel stand
    const tx = cx - (px - cx) * 0.7, tz = cz - (pz - cz) * 0.7;
    b.deco('darkmetal', tx, h, tz, 1.15, 0.55, 1.15, { color: 0x35383a });
    b.cyl('metal', tx, h + 0.55, tz, 0.62, 1.25, b.pick([0x2e3236, 0x8b867a, 0x3c4a46]), { segs: 10 });
  }

  // Signature Middle-Eastern unfinished corner rebar rods + rooftop comms/dish
  if (detail >= 0.4 || b.rnd() < 0.55) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (b.rnd() < 0.45) continue;
        const rx = cx + sx * (hw - 0.18), rz = cz + sz * (hd - 0.18);
        b.cyl('darkmetal', rx, h + paraH, rz, 0.018, b.r(0.55, 1.1), 0x4e3729, { segs: 4 });
        b.cyl('darkmetal', rx + 0.08, h + paraH, rz + 0.06, 0.015, b.r(0.4, 0.85), 0x4e3729, { segs: 4 });
      }
    }
  }

  // 4) Per-facade architectural fenestration: recessed windows, shutters, shopfronts, awnings, balconies & AC units
  const sides: { side: Side; nx: number; nz: number; span: number; rot: number; bx: number; bz: number }[] = [
    { side: 's', nx: 0, nz: 1, span: w, rot: 0, bx: cx, bz: cz + hd },
    { side: 'n', nx: 0, nz: -1, span: w, rot: Math.PI, bx: cx, bz: cz - hd },
    { side: 'e', nx: 1, nz: 0, span: d, rot: Math.PI / 2, bx: cx + hw, bz: cz },
    { side: 'w', nx: -1, nz: 0, span: d, rot: -Math.PI / 2, bx: cx - hw, bz: cz },
  ];

  for (const s of sides) {
    const f = new Frame(b, s.bx, s.bz, s.rot);
    const bays = Math.max(1, Math.floor((s.span - 1.6) / 3.1));
    const step = (s.span - 1.8) / Math.max(1, bays);
    const isShop = shops.has(s.side);
    const isDoor = doors.has(s.side);
    const isBalc = balconies.has(s.side);

    // Mid-wall vertical concrete structural pilasters on long facades
    if (s.span >= 10) {
      for (let i = 1; i < bays; i++) {
        const lx = -s.span * 0.5 + 0.9 + i * step;
        f.d('concrete', lx, 0, 0.03, 0.28, h, 0.1, { color: trimCol, absGrime: true });
      }
    }

    // Exposed cinderblock spall patch on weathered foreground facades
    if (detail >= 0.7 && b.rnd() < 0.55) {
      const px = b.r(-s.span * 0.28, s.span * 0.28);
      const py = b.r(1.1, Math.max(1.5, h - 1.6));
      f.d('cinder', px, py, 0.02, b.r(1.2, 2.2), b.r(0.7, 1.3), 0.06, { color: cinderCol });
    }

    for (let fl = 0; fl < floors; fl++) {
      const fy = fl * floorH;
      for (let i = 0; i < bays; i++) {
        const lx = -s.span * 0.5 + 0.9 + (i + 0.5) * step;

        // Ground floor: Poly Haven roller-shutter shopfront or recessed armored entry door
        if (fl === 0 && (isShop || (isDoor && i === Math.floor(bays / 2)))) {
          if (isShop && detail >= 0.6) {
            const shutterName = b.rnd() < 0.45 ? 'shutter_door_tag' : 'shutter_door';
            b.model(shutterName, f.wx(lx, 0.05), 0.06, f.wz(lx, 0.05), s.rot, { scale: { x: Math.min(1.05, (step - 0.5) / 2.6), y: 0.96, z: 0.9 } });
            // Sloped corrugated metal shop awning with steel brackets
            const awW = Math.min(step - 0.25, 2.85);
            const awGeo = new THREE.BoxGeometry(awW, 0.045, 1.15);
            b.geo('corrugated', awGeo, f.v(lx, 2.75, 0.54), new THREE.Euler(0.28, s.rot, 0, 'YXZ'), 1, b.pick([0x6c7268, 0x86745a, 0x5c666a, 0x7c5848]));
            awGeo.dispose();
            for (const bx of [-awW * 0.42, awW * 0.42]) {
              b.tube('darkmetal', f.v(lx + bx, 2.25, 0.02), f.v(lx + bx, 2.62, 0.98), 0.022, 0x35383a, 4);
            }
          } else {
            // Recessed timber/steel doorway with stone stoop & concrete lintel
            f.d('darkmetal', lx, 0.14, 0.02, 1.18, 2.18, 0.08, { color: 0x262420 });
            f.d('wood', lx, 0.14, 0.05, 1.04, 2.08, 0.05, { color: 0x5c4836 });
            f.d('concrete', lx, 2.32, 0.08, 1.42, 0.16, 0.18, { color: trimCol });
            f.d('slab', lx, 0, 0.35, 1.5, 0.14, 0.65, { color: trimCol });
          }
          continue;
        }

        // Upper floors & non-door bays: deeply recessed dark window openings with stone lintels, sills & grilles
        const wy = fy + 1.05;
        const winW = Math.min(1.38, step * 0.52);
        const winH = 1.38;
        if (detail >= 0.7 && b.rnd() < 0.35) {
          // Real Poly Haven rolling shutter window
          b.model('shutter_window', f.wx(lx, 0.05), wy, f.wz(lx, 0.05), s.rot, { scale: { x: winW / 1.35, y: winH / 1.4, z: 0.9 } });
        } else {
          // Deep recessed dark window cavity + tinted reflective glass + stone sill & projecting concrete lintel
          f.d('darkmetal', lx, wy, 0.02, winW, winH, 0.07, { color: 0x101318 });
          if (detail >= 0.4) f.d('glass', lx, wy + 0.06, 0.05, winW - 0.14, winH - 0.14, 0.03, {});
          f.d('concrete', lx, wy - 0.11, 0.08, winW + 0.24, 0.12, 0.18, { color: trimCol });
          f.d('concrete', lx, wy + winH, 0.08, winW + 0.28, 0.15, 0.18, { color: trimCol });
          // Steel mullion & security grille bars on ground/second floor
          if (detail >= 0.6) {
            f.d('darkmetal', lx, wy + 0.04, 0.07, 0.04, winH - 0.08, 0.04, { color: 0x26292c });
            f.d('darkmetal', lx, wy + winH * 0.5, 0.07, winW - 0.08, 0.04, 0.04, { color: 0x26292c });
          }
        }

        // Wall-mounted photogrammetry AC condenser unit next to some upper windows
        if (detail >= 0.7 && fl >= 1 && b.rnd() < 0.28) {
          b.model(b.rnd() < 0.5 ? 'aircon' : 'aircon_rust', f.wx(lx + winW * 0.5 + 0.42, 0.22), fy + 0.55, f.wz(lx + winW * 0.5 + 0.42, 0.22), s.rot, { scale: 0.85 });
        }
      }

      // Cantilevered concrete balcony with real Poly Haven iron railing on upper stories
      if (detail >= 0.7 && isBalc && fl >= 1 && fl < floors) {
        const bw = Math.min(s.span - 1.6, 5.2);
        f.d('concrete', 0, fy - 0.14, 0.65, bw, 0.18, 1.3, { color: trimCol });
        if (collide) f.solid(0, fy - 0.14, 0.65, bw, 0.22, 1.3, 'concrete', false);
        b.model('railing', f.wx(0, 1.24), fy + 0.04, f.wz(0, 1.24), s.rot, { scale: { x: bw / 4.0, y: 0.92, z: 1 } });
        for (const sx of [-1, 1]) {
          b.model('railing', f.wx(sx * (bw * 0.5 - 0.04), 0.62), fy + 0.04, f.wz(sx * (bw * 0.5 - 0.04), 0.62), s.rot + Math.PI / 2, { scale: { x: 1.22 / 4.0, y: 0.92, z: 1 } });
        }
      }
    }
  }

  // Rooftop satellite dish & foreground security light / CCTV
  if (detail >= 0.7) {
    if (b.rnd() < 0.6) b.model('arch_sat_dish', cx + b.r(-hw * 0.4, hw * 0.4), h, cz + b.r(-hd * 0.4, hd * 0.4), b.r(0, 6.28), { scale: 1.3 });
    const frontSide = o.shop?.[0] ?? o.doors?.[0] ?? o.balcony?.[0] ?? 's';
    const fx = frontSide === 'e' ? cx + hw + 0.14 : frontSide === 'w' ? cx - hw - 0.14 : cx + hw * 0.25;
    const fz = frontSide === 's' ? cz + hd + 0.14 : frontSide === 'n' ? cz - hd - 0.14 : cz + hd * 0.25;
    const frot = frontSide === 'n' ? Math.PI : frontSide === 'e' ? Math.PI / 2 : frontSide === 'w' ? -Math.PI / 2 : 0;
    if (b.rnd() < 0.55) b.model('ph_sec_cam', fx, Math.min(3.5, h * 0.6), fz, frot, { scale: 0.95 });
    if (b.rnd() < 0.45) b.model('security_light', fx, Math.min(2.9, h * 0.55), fz, frot, { scale: 0.68 });
  }
}

// ---------------------------------------------------------------------------
// Environmental beautification: overhead canopies, street bunting & planters
// ---------------------------------------------------------------------------

/** Draped cloth sun-shade spanning between two elevated points (bazaar / alley canopy). */
export function streetCanopy(
  b: LevelBuilder,
  a: THREE.Vector3,
  c: THREE.Vector3,
  width = 2.6,
  color = 0xb85234,
  sag = 0.55,
  posts = false,
) {
  const dx = c.x - a.x, dz = c.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const rot = Math.atan2(dx, dz);
  const midX = (a.x + c.x) * 0.5;
  const midZ = (a.z + c.z) * 0.5;

  // Support cables along both long edges (plus grounded timber posts when freestanding)
  const nx = Math.cos(rot) * (width * 0.5);
  const nz = -Math.sin(rot) * (width * 0.5);
  for (const s of [-1, 1]) {
    const pA = new THREE.Vector3(a.x + nx * s, a.y, a.z + nz * s);
    const pC = new THREE.Vector3(c.x + nx * s, c.y, c.z + nz * s);
    wire(b, pA, pC, sag * 0.72);
    if (posts) {
      b.cyl('wood', pA.x, 0, pA.z, 0.055, pA.y + 0.12, 0x6c5840, { segs: 7, collide: true, surface: 'wood' });
      b.cyl('wood', pC.x, 0, pC.z, 0.055, pC.y + 0.12, 0x6c5840, { segs: 7, collide: true, surface: 'wood' });
    }
  }
  if (posts) {
    // End crossbars connecting each pair of posts so the cloth edge is anchored rigidly
    b.tube('wood', new THREE.Vector3(a.x - nx, a.y, a.z - nz), new THREE.Vector3(a.x + nx, a.y, a.z + nz), 0.038, 0x6c5840, 6);
    b.tube('wood', new THREE.Vector3(c.x - nx, c.y, c.z - nz), new THREE.Vector3(c.x + nx, c.y, c.z + nz), 0.038, 0x6c5840, 6);
  }

  // Draped cloth mesh with gentle catenary sag and natural wind ripples
  const segL = Math.max(6, Math.round(len / 1.1));
  const segW = 4;
  const g = new THREE.PlaneGeometry(width, len, segW, segL);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const t = lz / len + 0.5; // 0..1 along span
    const u = lx / (width * 0.5); // -1..1 across width
    const yLine = a.y + (c.y - a.y) * t;
    const catenary = sag * 4 * t * (1 - t);
    const belly = 0.12 * (1 - u * u) * (0.4 + 0.6 * Math.sin(t * Math.PI));
    const ripple = Math.sin(t * Math.PI * 5 + u * 1.4) * 0.028;
    pos.setY(i, yLine - catenary - belly + ripple);
  }
  g.computeVertexNormals();
  b.geo('fabric', g, { x: midX, y: 0, z: midZ }, new THREE.Euler(0, rot, 0), 1, color, 1.8);
  g.dispose();
}

/** Overhead bazaar pennant bunting line draped strictly between two physical anchor points. */
export function buntingLine(
  b: LevelBuilder,
  a: THREE.Vector3,
  c: THREE.Vector3,
  sag = 0.5,
  colors = [0xa8452f, 0xc99a38, 0x3f6b66, 0xd8ccb4, 0x7c3c48],
) {
  wire(b, a, c, sag);
  const dist = a.distanceTo(c);
  const count = Math.max(6, Math.floor(dist / 0.42));
  const rot = Math.atan2(c.x - a.x, c.z - a.z);
  const flagGeo = new THREE.BufferGeometry();
  // Compact cloth pennant aligned along span Z
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.14,
    0, 0, 0.14,
    0, -0.25, 0,
  ], 3));
  flagGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  flagGeo.computeVertexNormals();

  const p = new THREE.Vector3();
  for (let i = 1; i < count; i++) {
    const t = i / count;
    p.lerpVectors(a, c, t);
    p.y -= sag * 4 * t * (1 - t);
    const col = colors[i % colors.length];
    b.geo('fabric', flagGeo, p, new THREE.Euler(0, rot, (i % 2 ? 1 : -1) * 0.06), 1, col, 1);
  }
  flagGeo.dispose();
}

/** Landscaped stone-curbed tree planter with palm/tree and desert shrubs at its base. */
export function treePlanter(b: LevelBuilder, x: number, z: number, treeH = 7.5, radius = 1.35) {
  const s = radius * 2;
  const curbT = 0.22;
  const curbH = 0.36;
  // Four stone curb walls forming a neat square planter bed
  b.box('concrete', x, 0, z - radius + curbT * 0.5, s, curbH, curbT, { color: 0xc9c0ae, grime: 0.85, nav: false });
  b.box('concrete', x, 0, z + radius - curbT * 0.5, s, curbH, curbT, { color: 0xc9c0ae, grime: 0.85, nav: false });
  b.box('concrete', x - radius + curbT * 0.5, 0, z, curbT, curbH, s - curbT * 2, { color: 0xc9c0ae, grime: 0.85, nav: false });
  b.box('concrete', x + radius - curbT * 0.5, 0, z, curbT, curbH, s - curbT * 2, { color: 0xc9c0ae, grime: 0.85, nav: false });
  // Soil bed inside the planter
  b.deco('mud', x, 0, z, s - curbT * 1.9, curbH - 0.08, s - curbT * 1.9, { color: 0x8a765c });
  // Main sculpted high-poly desert date palm (13.6k tris, native height 5.09m) + lush shrubs
  const ps = treeH / 5.09;
  b.model('prop_palm', x, curbH - 0.12, z, b.r(0, 6.28), { scale: ps, color: 0xf4eee2 });
  b.solid(x, 0, z, 0.45, Math.min(treeH * 0.6, 4), 0.45, 0, 'wood');
  for (let i = 0; i < 3; i++) {
    const ang = b.r(0, Math.PI * 2);
    const dist = b.r(0.42, radius - 0.36);
    b.model(b.rnd() < 0.5 ? 'bush_s' : 'bush_m', x + Math.cos(ang) * dist, curbH - 0.12, z + Math.sin(ang) * dist, b.r(0, 6.28), {
      scale: b.r(0.75, 1.15),
      color: 0xbcc49a,
    });
  }
}




