import * as THREE from 'three';

export type Surface = 'concrete' | 'sand' | 'metal' | 'wood' | 'asphalt' | 'flesh' | 'fabric';

/** Box collider that may be rotated around the Y axis. */
export interface Collider {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  cos: number; sin: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  minY: number; maxY: number;
  surface: Surface;
  enabled: boolean;
  /** Blocks AI navigation. */
  nav: boolean;
  /** Invisible boundary: stops characters but not bullets / sight lines. */
  noRay: boolean;
  /** Arbitrary game object (e.g. explosive barrel). */
  tag: any;
  stamp: number;
}

export interface RayHit {
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: Collider | null;
  surface: Surface;
}

export const makeHit = (): RayHit => ({ t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null, surface: 'sand' });

const GRID_MIN = -112;
const CELL = 4;
const GRID_N = 56;

export class World {
  colliders: Collider[] = [];
  private grid: Collider[][] = [];
  private stamp = 1;
  private tmp: Collider[] = [];
  /** Surface type of the ground plane at a position (roads vs sand). */
  groundSurface: (x: number, z: number) => Surface = () => 'sand';
  /** Elevation of the infinite fallback ground plane (0 on terrain maps, -7 below waterline on ships). */
  baseGroundY = 0;

  constructor() {
    for (let i = 0; i < GRID_N * GRID_N; i++) this.grid.push([]);
  }

  /** Remove every collider (level switch). */
  clear() {
    this.colliders.length = 0;
    for (const cell of this.grid) cell.length = 0;
    this.groundSurface = () => 'sand';
    this.baseGroundY = 0;
  }

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rot = 0, surface: Surface = 'concrete', nav = true, tag: any = null): Collider {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const ex = Math.abs(hx * cos) + Math.abs(hz * sin);
    const ez = Math.abs(hx * sin) + Math.abs(hz * cos);
    const c: Collider = {
      cx, cy, cz, hx, hy, hz, cos, sin,
      minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
      minY: cy - hy, maxY: cy + hy,
      surface, enabled: true, nav, noRay: false, tag, stamp: 0,
    };
    this.colliders.push(c);
    const x0 = this.cell(c.minX), x1 = this.cell(c.maxX), z0 = this.cell(c.minZ), z1 = this.cell(c.maxZ);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid[z * GRID_N + x].push(c);
    return c;
  }

  private cell(v: number) {
    const c = Math.floor((v - GRID_MIN) / CELL);
    return c < 0 ? 0 : c >= GRID_N ? GRID_N - 1 : c;
  }

  /** Collect enabled colliders whose bounds overlap the XZ rectangle. */
  query(minX: number, maxX: number, minZ: number, maxZ: number, out: Collider[]) {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = this.cell(minX), x1 = this.cell(maxX), z0 = this.cell(minZ), z1 = this.cell(maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.grid[z * GRID_N + x];
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.stamp === s || !c.enabled) continue;
          c.stamp = s;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Ray vs. static world (boxes + ground plane). Direction must be normalised.
   * Returns true and fills `hit` with the closest intersection.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, hit?: RayHit): boolean {
    let best = maxDist;
    let bestC: Collider | null = null;
    let bnx = 0, bny = 0, bnz = 0;
    let found = false;

    // ground plane
    if (dy < -1e-6 && oy > this.baseGroundY) {
      const t = (this.baseGroundY - oy) / dy;
      if (t < best) {
        best = t;
        bnx = 0; bny = 1; bnz = 0;
        found = true;
      }
    }

    let ex = ox + dx * best, ez = oz + dz * best, ey = oy + dy * best;
    let sMinX = Math.min(ox, ex), sMaxX = Math.max(ox, ex);
    let sMinZ = Math.min(oz, ez), sMaxZ = Math.max(oz, ez);
    let sMinY = Math.min(oy, ey), sMaxY = Math.max(oy, ey);

    const cols = this.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c.enabled || c.noRay) continue;
      if (c.maxX < sMinX || c.minX > sMaxX || c.maxZ < sMinZ || c.minZ > sMaxZ || c.maxY < sMinY || c.minY > sMaxY) continue;
      const rx = ox - c.cx, ry = oy - c.cy, rz = oz - c.cz;
      const lx = rx * c.cos - rz * c.sin;
      const lz = rx * c.sin + rz * c.cos;
      const ldx = dx * c.cos - dz * c.sin;
      const ldz = dx * c.sin + dz * c.cos;
      let tmin = 0, tmax = best;
      let axis = -1, sign = 0;
      // X slab
      if (Math.abs(ldx) < 1e-9) {
        if (lx < -c.hx || lx > c.hx) continue;
      } else {
        const inv = 1 / ldx;
        let t1 = (-c.hx - lx) * inv, t2 = (c.hx - lx) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-9) {
        if (ry < -c.hy || ry > c.hy) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (-c.hy - ry) * inv, t2 = (c.hy - ry) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(ldz) < 1e-9) {
        if (lz < -c.hz || lz > c.hz) continue;
      } else {
        const inv = 1 / ldz;
        let t1 = (-c.hz - lz) * inv, t2 = (c.hz - lz) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (axis < 0) continue; // origin inside the box
      best = tmin;
      bestC = c;
      found = true;
      if (axis === 0) { bnx = sign * c.cos; bny = 0; bnz = -sign * c.sin; }
      else if (axis === 1) { bnx = 0; bny = sign; bnz = 0; }
      else { bnx = sign * c.sin; bny = 0; bnz = sign * c.cos; }
      ex = ox + dx * best; ez = oz + dz * best; ey = oy + dy * best;
      sMinX = Math.min(ox, ex); sMaxX = Math.max(ox, ex);
      sMinZ = Math.min(oz, ez); sMaxZ = Math.max(oz, ez);
      sMinY = Math.min(oy, ey); sMaxY = Math.max(oy, ey);
    }

    if (found && hit) {
      hit.t = best;
      hit.point.set(ox + dx * best, oy + dy * best, oz + dz * best);
      hit.normal.set(bnx, bny, bnz);
      hit.collider = bestC;
      hit.surface = bestC ? bestC.surface : this.groundSurface(hit.point.x, hit.point.z);
    }
    return found;
  }

  /** True if the straight segment between two points is unobstructed. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-4) return true;
    return !this.raycast(a.x, a.y, a.z, dx / d, dy / d, dz / d, d - 0.05);
  }

  /**
   * Push a vertical cylinder (feet at pos.y) out of all solid boxes in XZ.
   * Boxes whose top is within `step` of the feet are treated as walkable.
   */
  resolveCylinder(pos: THREE.Vector3, radius: number, height: number, step: number) {
    const list = this.query(pos.x - radius - 0.1, pos.x + radius + 0.1, pos.z - radius - 0.1, pos.z + radius + 0.1, this.tmp);
    let hitAny = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (pos.y + height <= c.minY + 0.01 || pos.y >= c.maxY - 0.01) continue;
        if (c.maxY - pos.y <= step) continue;
        const rx = pos.x - c.cx, rz = pos.z - c.cz;
        let lx = rx * c.cos - rz * c.sin;
        let lz = rx * c.sin + rz * c.cos;
        const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
        const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
        const ddx = lx - qx, ddz = lz - qz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          lx += (ddx / d) * push;
          lz += (ddz / d) * push;
        } else {
          // centre is inside the box: exit through the nearest face
          const px = c.hx - Math.abs(lx);
          const pz = c.hz - Math.abs(lz);
          if (px < pz) lx = (lx >= 0 ? 1 : -1) * (c.hx + radius);
          else lz = (lz >= 0 ? 1 : -1) * (c.hz + radius);
        }
        pos.x = c.cx + lx * c.cos + lz * c.sin;
        pos.z = c.cz - lx * c.sin + lz * c.cos;
        moved = true;
        hitAny = true;
      }
      if (!moved) break;
    }
    return hitAny;
  }

  private overlapsCircle(c: Collider, x: number, z: number, r: number) {
    const rx = x - c.cx, rz = z - c.cz;
    const lx = rx * c.cos - rz * c.sin;
    const lz = rx * c.sin + rz * c.cos;
    const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
    const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
    const ddx = lx - qx, ddz = lz - qz;
    return ddx * ddx + ddz * ddz < r * r;
  }

  private groundCollider: Collider | null = null;
  /** Highest walkable surface under a footprint that is no higher than feetY + step. */
  groundHeight(x: number, z: number, feetY: number, radius: number, step: number) {
    const list = this.query(x - radius, x + radius, z - radius, z + radius, this.tmp);
    let g = this.baseGroundY;
    this.groundCollider = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxY > feetY + step || c.maxY <= g) continue;
      if (!this.overlapsCircle(c, x, z, radius)) continue;
      g = c.maxY;
      this.groundCollider = c;
    }
    return g;
  }

  /** Surface under the last groundHeight() query. */
  lastGroundSurface(x: number, z: number): Surface {
    return this.groundCollider ? this.groundCollider.surface : this.groundSurface(x, z);
  }

  /** Lowest ceiling above headY (Infinity if open sky) within the footprint. */
  ceilingHeight(x: number, z: number, fromY: number, radius: number) {
    const list = this.query(x - radius, x + radius, z - radius, z + radius, this.tmp);
    let c0 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.minY < fromY - 0.05 || c.minY >= c0) continue;
      if (!this.overlapsCircle(c, x, z, radius)) continue;
      c0 = c.minY;
    }
    return c0;
  }
}

// ---------------------------------------------------------------------------
// Analytic ray tests against character hit volumes
// ---------------------------------------------------------------------------

export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Ray vs. vertical capsule between (cx,y0,cz) and (cx,y1,cz). Returns t or -1. */
export function rayCapsuleY(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, y0: number, y1: number, r: number) {
  const baY = y1 - y0;
  const oax = ox - cx, oay = oy - y0, oaz = oz - cz;
  const baba = baY * baY;
  const bard = baY * dy;
  const baoa = baY * oay;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-9) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    const ocx = oax, ocy = y <= 0 ? oay : oy - y1, ocz = oaz;
    b = dx * ocx + dy * ocy + dz * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = b * b - c;
    if (h > 0) {
      const t2 = -b - Math.sqrt(h);
      return t2 >= 0 ? t2 : -1;
    }
  } else if (a <= 1e-9) {
    // ray parallel to the capsule axis: test both cap spheres
    const t1 = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r);
    const t2 = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r);
    if (t1 >= 0 && t2 >= 0) return Math.min(t1, t2);
    return t1 >= 0 ? t1 : t2;
  }
  return -1;
}
