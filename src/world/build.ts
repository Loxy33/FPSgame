import * as THREE from 'three';
import { mulberry32 } from '../core/utils';
import { assets, type PropName } from '../render/assets';
import { MatName, Materials, TILE } from '../render/materials';
import { Collider, Surface, World } from './physics';

/** Accumulates many primitives into one merged mesh per material. */
export class Batch {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  constructor(public material: THREE.Material, public shadows: boolean) {}

  get vertCount() {
    return this.pos.length / 3;
  }

  addGeo(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, uvScale = 1) {
    const base = this.vertCount;
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      if (uv) this.uv.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale);
      else this.uv.push(0, 0);
      this.col.push(color.r, color.g, color.b);
    }
    if (geo.index) {
      const ix = geo.index;
      for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface BoxOpts {
  rot?: number;
  color?: number;
  collide?: boolean;
  surface?: Surface;
  nav?: boolean;
  /** Scale of the top face relative to the base (x, z). */
  taper?: [number, number];
  /** Brightness multiplier applied to bottom vertices (dirt gradient). */
  grime?: number;
  /** Dirt gradient as a function of absolute height, so adjacent wall pieces match. */
  absGrime?: boolean;
  tile?: number;
  tag?: any;
}

const SURF: Record<MatName, Surface> = {
  concrete: 'concrete', plaster: 'concrete', cinder: 'concrete', sand: 'sand', asphalt: 'asphalt',
  corrugated: 'metal', metal: 'metal', wood: 'wood', burlap: 'sand', hesco: 'sand', camo: 'fabric',
  fabric: 'fabric', glass: 'metal', rubber: 'fabric', paint: 'asphalt', foliage: 'wood', darkmetal: 'metal',
  rock: 'concrete', trunk: 'wood', mud: 'sand', osb: 'wood', slab: 'concrete', vpaint: 'metal', decalOil: 'concrete', decalTag: 'concrete', decalCrack: 'concrete', decalScorch: 'concrete',
};

/** A shared level material, or a one-off material owned by the level (signs, lamps, nets). */
export type MatRef = MatName | THREE.Material;
const surfOf = (m: MatRef): Surface => (typeof m === 'string' ? SURF[m] : ((m.userData.surface as Surface) ?? 'metal'));
const tileOf = (m: MatRef) => (typeof m === 'string' ? TILE[m] : ((m.userData.tile as number) ?? 1));

const FACES = [
  [5, 1, 3, 7, 0], // +X
  [0, 4, 6, 2, 0], // -X
  [4, 5, 7, 6, 2], // +Z
  [1, 0, 2, 3, 2], // -Z
  [6, 7, 3, 2, 1], // +Y
  [0, 1, 5, 4, 1], // -Y
];

export interface Opening {
  /** Centre coordinate along the wall axis (world units). */
  at: number;
  w: number;
  /** Bottom / top of the opening, relative to the wall base. */
  y0: number;
  y1: number;
}

export class LevelBuilder {
  batches = new Map<string, Batch>();
  /** GPU Hardware Instancing queues for static props: key = "propName|shadows". */
  private instProps = new Map<string, { name: PropName; shadows: boolean; mats: THREE.Matrix4[]; cols: THREE.Color[] }>();
  region = 'main';
  shadows = true;
  rnd = mulberry32(20261116);
  private color = new THREE.Color();
  private mtx = new THREE.Matrix4();
  private cx = new Float32Array(8);
  private cy = new Float32Array(8);
  private cz = new Float32Array(8);
  private lx = new Float32Array(8);
  private lz = new Float32Array(8);

  constructor(public world: World, public mats: Materials) {}

  r(a = 0, b = 1) {
    return a + this.rnd() * (b - a);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rnd() * arr.length)];
  }

  /** Coarser spatial batch group: cuts draw calls while keeping background/quadrant frustum culling. */
  private batchGroup() {
    if (this.region === 'bg' || this.region === 'scatter') return 'bg';
    if (this.region === 'se' || this.region === 'ne' || this.region === 'nw' || this.region === 'sw') return this.region;
    return 'main';
  }

  batch(mat: MatRef) {
    if (typeof mat !== 'string') return this.modelBatch(mat);
    const key = `${mat}|${this.batchGroup()}|${this.shadows ? 1 : 0}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(this.mats[mat], this.shadows);
      this.batches.set(key, b);
    }
    return b;
  }

  modelBatch(mat: THREE.Material) {
    const key = `@${mat.uuid}|${this.batchGroup()}|${this.shadows ? 1 : 0}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(mat, this.shadows);
      this.batches.set(key, b);
    }
    return b;
  }

  /**
   * Places a scanned / modelled prop (see assets.PROP_SPECS) resting on y0 at (x, z)
   * using GPU Hardware Instancing (zero CPU vertex duplication, single drawElementsInstanced per prop part).
   */
  model(name: PropName, x: number, y0: number, z: number, rot = 0, o: { scale?: number | THREE.Vector3Like; color?: number; tilt?: [number, number] } = {}) {
    const prop = assets.props[name];
    const s = o.scale ?? 1;
    const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s.x, s.y, s.z);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tilt?.[0] ?? 0, rot, o.tilt?.[1] ?? 0, 'YXZ'));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y0, z), q, sv);
    const col = new THREE.Color(o.color ?? 0xffffff);
    const key = `${name}|${this.shadows ? 1 : 0}`;
    let qEntry = this.instProps.get(key);
    if (!qEntry) {
      qEntry = { name, shadows: this.shadows, mats: [], cols: [] };
      this.instProps.set(key, qEntry);
    }
    qEntry.mats.push(m);
    qEntry.cols.push(col);
    return prop;
  }

  /** Solid box sitting on y0, centred on (x, z). Adds a collider by default. */
  box(mat: MatRef, x: number, y0: number, z: number, w: number, h: number, d: number, o: BoxOpts = {}): Collider | null {
    const b = this.batch(mat);
    const tile = o.tile ?? tileOf(mat);
    const rot = o.rot ?? 0;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const tx = o.taper ? o.taper[0] : 1;
    const tz = o.taper ? o.taper[1] : 1;
    const { cx, cy, cz, lx, lz } = this;
    for (let i = 0; i < 8; i++) {
      const top = (i >> 1) & 1;
      const px = ((i & 1) ? 0.5 : -0.5) * w * (top ? tx : 1);
      const pz = ((i >> 2) & 1 ? 0.5 : -0.5) * d * (top ? tz : 1);
      lx[i] = px;
      lz[i] = pz;
      cx[i] = x + px * cos + pz * sin;
      cz[i] = z - px * sin + pz * cos;
      cy[i] = y0 + (top ? h : 0);
    }
    this.color.set(o.color ?? 0xffffff);
    const cr = this.color.r, cg = this.color.g, cb = this.color.b;
    let grime = o.grime ?? (h > 2.2 && y0 < 0.4 ? 0.7 : 1);
    let grimeTop = 1;
    if (o.absGrime) {
      const gm = (y: number) => 0.68 + 0.32 * Math.min(1, Math.max(0, y / 3.2));
      grime = gm(y0);
      grimeTop = gm(y0 + h);
    }
    const rotated = rot !== 0;
    const it = 1 / tile;
    for (let f = 0; f < 6; f++) {
      if (f === 5 && y0 <= 0.02) continue; // bottom face resting on the ground is never visible
      const F = FACES[f];
      const a = F[0], bb = F[1], c = F[2];
      const e1x = cx[bb] - cx[a], e1y = cy[bb] - cy[a], e1z = cz[bb] - cz[a];
      const e2x = cx[c] - cx[a], e2y = cy[c] - cy[a], e2z = cz[c] - cz[a];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const base = b.vertCount;
      for (let k = 0; k < 4; k++) {
        const i = F[k];
        b.pos.push(cx[i], cy[i], cz[i]);
        b.nor.push(nx, ny, nz);
        let u: number, v: number;
        if (F[4] === 0) { u = rotated ? lz[i] + z : cz[i]; v = cy[i]; }
        else if (F[4] === 2) { u = rotated ? lx[i] + x : cx[i]; v = cy[i]; }
        else { u = rotated ? lx[i] + x : cx[i]; v = rotated ? lz[i] + z : cz[i]; }
        b.uv.push(u * it, v * it);
        const gm = (i >> 1) & 1 ? grimeTop : grime;
        b.col.push(cr * gm, cg * gm, cb * gm);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (o.collide === false) return null;
    const sx = tx < 1 ? (1 + tx) / 2 : 1;
    const sz = tz < 1 ? (1 + tz) / 2 : 1;
    return this.world.addBox(x, y0 + h / 2, z, (w / 2) * sx, h / 2, (d / 2) * sz, rot, o.surface ?? surfOf(mat), o.nav ?? true, o.tag ?? null);
  }

  /** Decorative box without collision. */
  deco(mat: MatRef, x: number, y0: number, z: number, w: number, h: number, d: number, o: BoxOpts = {}) {
    o.collide = false;
    this.box(mat, x, y0, z, w, h, d, o);
  }

  /** Invisible collider. */
  solid(x: number, y0: number, z: number, w: number, h: number, d: number, rot = 0, surface: Surface = 'concrete', nav = true) {
    return this.world.addBox(x, y0 + h / 2, z, w / 2, h / 2, d / 2, rot, surface, nav);
  }

  /** Blocks AI navigation without affecting physics or bullets. */
  navBlock(x: number, z: number, w: number, d: number, rot = 0) {
    const c = this.world.addBox(x, 1, z, w / 2, 1, d / 2, rot, 'concrete', true);
    c.enabled = false;
    return c;
  }

  /** Add an arbitrary geometry with a full transform. */
  geo(mat: MatRef, g: THREE.BufferGeometry, pos: THREE.Vector3Like, rot: THREE.Euler | null, scale: THREE.Vector3Like | number, color: number, uvScale = 1) {
    const q = new THREE.Quaternion();
    if (rot) q.setFromEuler(rot);
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale.x, scale.y, scale.z);
    this.mtx.compose(new THREE.Vector3(pos.x, pos.y, pos.z), q, s);
    this.color.set(color);
    this.batch(mat).addGeo(g, this.mtx, this.color, uvScale);
  }

  geoM(mat: MatRef, g: THREE.BufferGeometry, m: THREE.Matrix4, color: number, uvScale = 1) {
    this.color.set(color);
    this.batch(mat).addGeo(g, m, this.color, uvScale);
  }

  /** Vertical cylinder standing on y0. */
  cyl(mat: MatRef, x: number, y0: number, z: number, r: number, h: number, color = 0xffffff, o: { rTop?: number; segs?: number; collide?: boolean; uv?: number; nav?: boolean; surface?: Surface } = {}) {
    const g = new THREE.CylinderGeometry(o.rTop ?? r, r, h, o.segs ?? 12, 1);
    this.geo(mat, g, { x, y: y0 + h / 2, z }, null, 1, color, o.uv ?? 1);
    g.dispose();
    if (o.collide) this.world.addBox(x, y0 + h / 2, z, r * 0.85, h / 2, r * 0.85, 0, o.surface ?? surfOf(mat), o.nav ?? true);
  }

  /** Cylinder between two arbitrary points (pipes, wires, rails). */
  tube(mat: MatRef, a: THREE.Vector3, b: THREE.Vector3, r: number, color = 0xffffff, segs = 6) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, len, segs, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.mtx.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.color.set(color);
    this.batch(mat).addGeo(g, this.mtx, this.color, 1);
    g.dispose();
  }

  // -------------------------------------------------------------------------
  // Architecture helpers
  // -------------------------------------------------------------------------

  /**
   * Axis-aligned wall with door / window openings.
   * axis 'x': runs from a0..a1 along X at depth `c` (z). axis 'z': runs along Z at x = c.
   */
  wall(mat: MatRef, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, h: number, t: number, openings: Opening[] = [], color = 0xffffff) {
    const seg = (s0: number, s1: number, b0: number, b1: number) => {
      const len = s1 - s0;
      const hh = b1 - b0;
      if (len < 0.02 || hh < 0.02) return;
      const mid = (s0 + s1) / 2;
      if (axis === 'x') this.box(mat, mid, y0 + b0, c, len, hh, t, { color, absGrime: true });
      else this.box(mat, c, y0 + b0, mid, t, hh, len, { color, absGrime: true });
    };
    const ops = [...openings].sort((p, q) => p.at - q.at);
    let cur = a0;
    for (const op of ops) {
      const o0 = Math.max(a0, op.at - op.w / 2);
      const o1 = Math.min(a1, op.at + op.w / 2);
      seg(cur, o0, 0, h);
      if (op.y0 > 0.01) seg(o0, o1, 0, op.y0);
      if (op.y1 < h - 0.01) seg(o0, o1, op.y1, h);
      cur = o1;
    }
    seg(cur, a1, 0, h);
  }

  /** Floor / roof slab with an optional rectangular hole (stairwell). */
  slab(mat: MatRef, x0: number, x1: number, z0: number, z1: number, y0: number, t: number, color = 0xffffff, hole?: { x0: number; x1: number; z0: number; z1: number }) {
    const piece = (ax0: number, ax1: number, az0: number, az1: number) => {
      if (ax1 - ax0 < 0.02 || az1 - az0 < 0.02) return;
      this.box(mat, (ax0 + ax1) / 2, y0, (az0 + az1) / 2, ax1 - ax0, t, az1 - az0, { color, grime: 1 });
    };
    if (!hole) {
      piece(x0, x1, z0, z1);
      return;
    }
    piece(x0, x1, z0, hole.z0);
    piece(x0, x1, hole.z1, z1);
    piece(x0, hole.x0, hole.z0, hole.z1);
    piece(hole.x1, x1, hole.z0, hole.z1);
  }

  /** Staircase rising from (x,z) in direction (dx,dz) (unit, axis-aligned). */
  stairs(mat: MatRef, x: number, z: number, dx: number, dz: number, width: number, y0: number, y1: number, run: number, color = 0xffffff, solidUnder = true) {
    const n = Math.max(1, Math.round((y1 - y0) / 0.19));
    const rise = (y1 - y0) / n;
    const tread = run / n;
    const pxPerp = -dz;
    const pzPerp = dx;
    const sideOff = width * 0.5 - 0.035;

    for (let i = 0; i < n; i++) {
      const px = x + dx * (i + 0.5) * tread;
      const pz = z + dz * (i + 0.5) * tread;
      const top = y0 + rise * (i + 1);

      if (solidUnder) {
        const bottom = y0;
        const w = dx !== 0 ? tread : width;
        const d = dx !== 0 ? width : tread;
        this.box(mat, px, bottom, pz, w, top - bottom, d, { color, grime: 1, nav: true });
      } else {
        // Open-tread industrial staircase with crisp metal treads
        const treadH = Math.min(0.055, rise * 0.32);
        const w = dx !== 0 ? tread * 0.96 : width - 0.08;
        const d = dx !== 0 ? width - 0.08 : tread * 0.96;
        this.box(mat, px, top - treadH, pz, w, treadH, d, { color, grime: 1, nav: true });
      }
    }

    if (!solidUnder) {
      // Continuous slanted structural steel side stringers on both flanks
      const riseTotal = y1 - y0;
      const diagLen = Math.hypot(run, riseTotal);
      const slope = Math.atan2(riseTotal, run);
      const yaw = Math.atan2(dx, dz);
      const midX = x + dx * run * 0.5;
      const midZ = z + dz * run * 0.5;
      const midY = (y0 + y1) * 0.5 - 0.04;
      const stringerGeo = new THREE.BoxGeometry(0.06, 0.22, diagLen);
      const euler = new THREE.Euler(-slope, yaw, 0, 'YXZ');
      for (const side of [-1, 1]) {
        const sx = midX + pxPerp * side * sideOff;
        const sz = midZ + pzPerp * side * sideOff;
        this.geo('darkmetal', stringerGeo, { x: sx, y: midY, z: sz }, euler, 1, 0x3b3f42);
      }
      stringerGeo.dispose();

      // Ground support steel stanchions under midpoint and top of stringers
      for (const idx of [Math.floor(n * 0.5), n - 1]) {
        const px = x + dx * (idx + 0.5) * tread;
        const pz = z + dz * (idx + 0.5) * tread;
        const top = y0 + rise * (idx + 1) - 0.08;
        if (top - y0 > 0.25) {
          for (const side of [-1, 1]) {
            const sx = px + pxPerp * side * sideOff;
            const sz = pz + pzPerp * side * sideOff;
            this.box('darkmetal', sx, y0, sz, 0.075, top - y0, 0.075, { color: 0x303336, grime: 0.9 });
          }
        }
      }

      // Continuous sloped tubular steel handrail & mid knee-rail on the outside flank
      const railSide = -1;
      const rOffX = pxPerp * railSide * sideOff;
      const rOffZ = pzPerp * railSide * sideOff;
      const p0X = x + dx * 0.5 * tread + rOffX;
      const p0Z = z + dz * 0.5 * tread + rOffZ;
      const p1X = x + dx * (n - 0.5) * tread + rOffX;
      const p1Z = z + dz * (n - 0.5) * tread + rOffZ;
      const yStart = y0 + rise;
      const yEnd = y1;
      this.tube('darkmetal', new THREE.Vector3(p0X, yStart + 0.94, p0Z), new THREE.Vector3(p1X, yEnd + 0.94, p1Z), 0.026, 0x464a4e, 8);
      this.tube('darkmetal', new THREE.Vector3(p0X, yStart + 0.48, p0Z), new THREE.Vector3(p1X, yEnd + 0.48, p1Z), 0.018, 0x383b3e, 8);

      // Vertical tubular stanchions anchored cleanly from stringer to top handrail
      for (let i = 0; i < n; i++) {
        if (i === 0 || i === n - 1 || (i % 4 === 0 && n - 1 - i >= 2)) {
          const rx = x + dx * (i + 0.5) * tread + rOffX;
          const rz = z + dz * (i + 0.5) * tread + rOffZ;
          const top = y0 + rise * (i + 1);
          this.cyl('darkmetal', rx, top - 0.08, rz, 0.022, 1.02, 0x333639, { segs: 8 });
        }
      }
    }
  }

  finish(): THREE.Group {
    const group = new THREE.Group();
    for (const [key, b] of this.batches) {
      if (b.vertCount === 0) continue;
      const mesh = new THREE.Mesh(b.build(), b.material);
      // transparent batches (decals) would cast a solid rectangular shadow onto the wall
      mesh.castShadow = b.shadows && !b.material.transparent;
      mesh.receiveShadow = true;
      mesh.name = key;
      if (key.includes('|bg|')) mesh.userData.noAo = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.batches.clear();

    // Small clutter, foliage & razor-wire props skip expensive shadow-map & GTAO normal passes (saves >1.2M tris/frame!)
    const NO_SHADOW_AO_PROPS = new Set([
      'barbed_wire', 'bush_s', 'bush_m', 'bush_l', 'rock', 'stones', 'plastic_crate',
      'cardboard_box', 'cardboard_stack', 'chair', 'stool', 'ammo_box', 'jerrycan',
      'traffic_cone', 'trash_can', 'trash_can_rust', 'trash_bags', 'clipboard',
      'binoculars', 'toolbox', 'medical_box', 'hanging_lamp', 'security_light',
      'ph_sec_cam', 'ph_manhole', 'ph_laptop', 'ph_extinguisher', 'ph_sconce',
      'ph_caged_light', 'ph_circuit_board',
    ]);

    // Emit GPU Hardware-Instanced meshes for every placed prop (shares static GPU vertex buffers!)
    for (const [key, entry] of this.instProps) {
      const count = entry.mats.length;
      if (count === 0) continue;
      const prop = assets.props[entry.name];
      const lightProp = NO_SHADOW_AO_PROPS.has(entry.name);
      for (const p of prop.parts) {
        if (!p.geo.boundingSphere) p.geo.computeBoundingSphere();
        if (!p.geo.boundingBox) p.geo.computeBoundingBox();
        const im = new THREE.InstancedMesh(p.geo, p.mat, count);
        for (let i = 0; i < count; i++) {
          im.setMatrixAt(i, entry.mats[i]);
          im.setColorAt(i, entry.cols[i]);
        }
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = !lightProp && entry.shadows && !p.mat.transparent;
        im.receiveShadow = true;
        im.name = `inst:${key}`;
        im.userData.sharedGeo = true;
        if (!entry.shadows || lightProp) im.userData.noAo = true;
        im.matrixAutoUpdate = false;
        im.updateMatrix();
        group.add(im);
      }
    }
    this.instProps.clear();
    return group;
  }
}
