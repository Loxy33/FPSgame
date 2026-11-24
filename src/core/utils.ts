export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Shortest signed difference between two angles (b - a), in [-PI, PI]. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Deterministic PRNG. */
export function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Critically-damped-ish spring for procedural animation. */
export class Spring {
  x = 0;
  v = 0;
  constructor(public k = 150, public c = 16) {}
  update(target: number, dt: number) {
    // semi-implicit euler with substeps for stability at low frame rates
    const steps = dt > 0.012 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  impulse(v: number) {
    this.v += v;
  }
}

/** Tileable value noise + fBm, used for procedural textures. */
export class TileNoise {
  private table: Float32Array;
  constructor(seed: number) {
    const r = mulberry32(seed);
    this.table = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) this.table[i] = r();
  }
  private at(x: number, y: number) {
    return this.table[((y & 255) << 8) | (x & 255)];
  }
  /** x,y in lattice units; lattice wraps every (px,py). */
  sample(x: number, y: number, px: number, py: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = this.at(x0, y0);
    const b = this.at(x1, y0);
    const c = this.at(x0, y1);
    const d = this.at(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /** u,v in [0,1). Returns ~[0,1]. */
  fbm(u: number, v: number, period: number, octaves: number, gain = 0.5) {
    return this.fbm2(u, v, period, period, octaves, gain);
  }
  fbm2(u: number, v: number, px: number, py: number, octaves: number, gain = 0.5) {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample(u * px + o * 17.3, v * py + o * 9.1, px, py);
      norm += amp;
      amp *= gain;
      px *= 2;
      py *= 2;
      if (px > 256 || py > 256) break;
    }
    return sum / norm;
  }
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
