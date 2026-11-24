import { World } from './physics';

/** Uniform-grid A* navigation for ground AI. */
export class NavGrid {
  readonly size = 0.5;
  readonly min = -128;
  readonly n = 512;
  blocked: Uint8Array;
  private g: Float32Array;
  private parent: Int32Array;
  private visit: Uint32Array;
  private closed: Uint32Array;
  private stamp = 0;
  private heapIdx: Int32Array;
  private heapF: Float32Array;
  private heapN = 0;

  constructor() {
    const t = this.n * this.n;
    this.blocked = new Uint8Array(t);
    this.g = new Float32Array(t);
    this.parent = new Int32Array(t);
    this.visit = new Uint32Array(t);
    this.closed = new Uint32Array(t);
    this.heapIdx = new Int32Array(t);
    this.heapF = new Float32Array(t);
  }

  build(world: World, agentR: number, bound: number) {
    const n = this.n;
    this.blocked.fill(0);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const wx = this.min + (x + 0.5) * this.size;
        const wz = this.min + (z + 0.5) * this.size;
        if (Math.abs(wx) > bound || Math.abs(wz) > bound) this.blocked[z * n + x] = 1;
      }
    }
    for (const c of world.colliders) {
      if (!c.nav || c.maxY < 0.4 || c.minY > 1.7) continue;
      const x0 = Math.max(0, Math.floor((c.minX - agentR - this.min) / this.size));
      const x1 = Math.min(n - 1, Math.floor((c.maxX + agentR - this.min) / this.size));
      const z0 = Math.max(0, Math.floor((c.minZ - agentR - this.min) / this.size));
      const z1 = Math.min(n - 1, Math.floor((c.maxZ + agentR - this.min) / this.size));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const rx = this.min + (x + 0.5) * this.size - c.cx;
          const rz = this.min + (z + 0.5) * this.size - c.cz;
          const lx = rx * c.cos - rz * c.sin;
          const lz = rx * c.sin + rz * c.cos;
          if (Math.abs(lx) <= c.hx + agentR && Math.abs(lz) <= c.hz + agentR) this.blocked[z * n + x] = 1;
        }
      }
    }
  }

  cx(x: number) {
    const c = Math.floor((x - this.min) / this.size);
    return c < 0 ? 0 : c >= this.n ? this.n - 1 : c;
  }
  wx(c: number) {
    return this.min + (c + 0.5) * this.size;
  }

  isFree(x: number, z: number) {
    return this.blocked[this.cx(z) * this.n + this.cx(x)] === 0;
  }

  /** Nearest unblocked cell index to a world position (spiral search), or -1. */
  nearestFree(x: number, z: number, maxR = 10): number {
    const n = this.n;
    const cx = this.cx(x), cz = this.cx(z);
    if (!this.blocked[cz * n + cx]) return cz * n + cx;
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x2 = cx + dx, z2 = cz + dz;
          if (x2 < 0 || z2 < 0 || x2 >= n || z2 >= n) continue;
          if (this.blocked[z2 * n + x2]) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = z2 * n + x2; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Grid walkability test along a straight segment. */
  lineFree(x0: number, z0: number, x1: number, z1: number) {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(d / (this.size * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      if (!this.isFree(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  private push(idx: number, f: number) {
    let i = this.heapN++;
    const hi = this.heapIdx, hf = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hi[i] = hi[p];
      hf[i] = hf[p];
      i = p;
    }
    hi[i] = idx;
    hf[i] = f;
  }

  private pop() {
    const hi = this.heapIdx, hf = this.heapF;
    const top = hi[0];
    const n = --this.heapN;
    if (n > 0) {
      const idx = hi[n], f = hf[n];
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hi[i] = hi[c];
        hf[i] = hf[c];
        i = c;
      }
      hi[i] = idx;
      hf[i] = f;
    }
    return top;
  }

  /**
   * A* from (sx,sz) to (tx,tz). Writes a smoothed list of waypoints
   * [x0,z0,x1,z1,...] (excluding the start) into `out`. Returns false if unreachable.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, out: number[]): boolean {
    out.length = 0;
    // Fast direct-line shortcut: skip full A* completely when the corridor is unobstructed!
    const directDist = Math.hypot(tx - sx, tz - sz);
    if (directDist < 42 && this.lineFree(sx, sz, tx, tz)) {
      out.push(tx, tz);
      return true;
    }
    const n = this.n;
    const start = this.nearestFree(sx, sz);
    const goal = this.nearestFree(tx, tz);
    if (start < 0 || goal < 0) return false;
    if (start === goal) {
      out.push(tx, tz);
      return true;
    }
    const s = ++this.stamp;
    const gx = goal % n, gz = (goal / n) | 0;
    this.heapN = 0;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.visit[start] = s;
    this.push(start, 0);
    let found = false;
    let expansions = 0;
    const blocked = this.blocked;
    // Weighted A* (1.18x heuristic) + 6000-node cap: routes smoothly across the entire map while
    // guaranteeing unreachable elevated/gated targets NEVER stall the main thread!
    while (this.heapN > 0 && expansions < 6000) {
      const cur = this.pop();
      if (this.closed[cur] === s) continue;
      this.closed[cur] = s;
      if (cur === goal) { found = true; break; }
      expansions++;
      const cxi = cur % n, czi = (cur / n) | 0;
      const cg = this.g[cur];
      for (let dz = -1; dz <= 1; dz++) {
        const nz = czi + dz;
        if (nz < 0 || nz >= n) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cxi + dx;
          if (nx < 0 || nx >= n) continue;
          const ni = nz * n + nx;
          if (blocked[ni] || this.closed[ni] === s) continue;
          const diag = dx !== 0 && dz !== 0;
          if (diag && (blocked[czi * n + nx] || blocked[nz * n + cxi])) continue;
          const ng = cg + (diag ? 1.4142 : 1);
          if (this.visit[ni] === s && this.g[ni] <= ng) continue;
          this.visit[ni] = s;
          this.g[ni] = ng;
          this.parent[ni] = cur;
          const hx = Math.abs(nx - gx), hz = Math.abs(nz - gz);
          const h = (hx + hz) + (1.4142 - 2) * Math.min(hx, hz);
          this.push(ni, ng + h * 1.18);
        }
      }
    }
    if (!found) return false;

    // reconstruct
    const raw: number[] = [];
    for (let c = goal; c !== -1; c = this.parent[c]) raw.push(c);
    raw.reverse();
    // string pulling
    let ax = sx, az = sz;
    let i = 1;
    while (i < raw.length) {
      let j = Math.min(raw.length - 1, i + 60);
      // find the farthest visible node
      for (; j > i; j--) {
        const c = raw[j];
        if (this.lineFree(ax, az, this.wx(c % n), this.wx((c / n) | 0))) break;
      }
      const c = raw[j];
      ax = this.wx(c % n);
      az = this.wx((c / n) | 0);
      out.push(ax, az);
      i = j + 1;
    }
    return true;
  }
}
