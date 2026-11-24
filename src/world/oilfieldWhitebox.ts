import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapInfo } from '../ui/hud';
import type { LevelData } from './level';
import { World, type Surface } from './physics';

const H = Math.PI / 2;

export interface WhiteboxZoneInfo {
  id: number;
  code: string;
  name: string;
  estMin: string;
  summary: string;
  spawn: { x: number; y: number; z: number; yaw: number };
  bounds: { x0: number; x1: number; z0: number; z1: number; yMin?: number; yMax?: number };
}

/** 6-Zone ~30-minute Campaign Blueprint for Mission 2: 《戈壁炼狱 · 喀拉干达 7 号油田》 */
export const OILFIELD_ZONES: WhiteboxZoneInfo[] = [
  {
    id: 1,
    code: 'ZONE 1',
    name: '戈壁峡谷空降点与外围暗哨',
    estMin: '约 4 分钟',
    summary: '直-20J 低空机降 · 峡谷三路渗透（西侧高崖狙击 / 中路公路掩体 / 东侧干涸暗渠）· 突破外围哨卡',
    spawn: { x: -80, y: 0.0, z: -104, yaw: Math.PI },
    bounds: { x0: -116, x1: -46, z0: -116, z1: -45 },
  },
  {
    id: 2,
    code: 'ZONE 2',
    name: '荒漠采油区与雇佣兵前哨',
    estMin: '约 5 分钟',
    summary: '4 座磕头机采油井 · 东侧双层雇佣兵营房与哨塔 · 西侧迫击炮沙袋阵地 · 管廊中轴推进',
    spawn: { x: -80, y: 0.0, z: -40, yaw: Math.PI },
    bounds: { x0: -116, x1: -46, z0: -45, z1: 35 },
  },
  {
    id: 3,
    code: 'ZONE 3',
    name: '巨型储油罐阵与装车泵站',
    estMin: '约 6 分钟',
    summary: '6 座巨型原油储罐（R=8.2m）· 罐顶 5.2m 立体连廊天桥 · 东侧油罐车装车棚 · 双入口切入精炼厂',
    spawn: { x: -79, y: 0.0, z: 40, yaw: Math.PI },
    bounds: { x0: -116, x1: 24, z0: 35, z1: 114 },
  },
  {
    id: 4,
    code: 'ZONE 4',
    name: '核心裂解精炼厂区（三层立体主战场）',
    estMin: '约 6 分钟',
    summary: '22m 催化裂解巨塔 + 4.5m/9.0m 双层环形钢架栈道 · 西侧 2F 全景中控室 CQB · 东侧地下斜坡入口',
    spawn: { x: -14, y: 0.0, z: 30, yaw: 0 },
    bounds: { x0: -46, x1: 36, z0: -38, z1: 35, yMin: -2.2 },
  },
  {
    id: 5,
    code: 'ZONE 5',
    name: '厄普西隆地下卫星数据掩体',
    estMin: '约 5 分钟',
    summary: '地下 -6.0m 双层防爆掩体 · 4 排服务器机柜巷战 · 中央核心数据库骇入 · 2F 环绕监视回廊 · 货梯竖井攀升',
    spawn: { x: 40, y: -6.0, z: 10, yaw: -H },
    bounds: { x0: 34, x1: 108, z0: -46, z1: 32, yMax: 2.5 },
  },
  {
    id: 6,
    code: 'ZONE 6',
    name: '悬崖停机坪与高轨中继塔（终局决战）',
    estMin: '约 5 分钟',
    summary: '+12m 高地俯瞰全油田 · 巨型 Ka 波段卫星中继天线爆破 · 圆形悬崖停机坪 360° 防御撤离',
    spawn: { x: 80, y: 12.0, z: -52, yaw: 0 },
    bounds: { x0: 44, x1: 116, z0: -116, z1: -44, yMin: 8.0 },
  },
];

export function detectOilfieldZone(pos: THREE.Vector3): WhiteboxZoneInfo {
  // Check vertical-specific zones first (Zone 5 underground & Zone 6 cliff)
  if (pos.y < -2.2 && pos.x > 28) return OILFIELD_ZONES[4];
  if (pos.y > 7.5 && pos.x > 42 && pos.z < -42) return OILFIELD_ZONES[5];
  for (const z of OILFIELD_ZONES) {
    const b = z.bounds;
    if (pos.x >= b.x0 && pos.x <= b.x1 && pos.z >= b.z0 && pos.z <= b.z1) {
      if (b.yMin !== undefined && pos.y < b.yMin) continue;
      if (b.yMax !== undefined && pos.y > b.yMax) continue;
      return z;
    }
  }
  return OILFIELD_ZONES[0];
}

// ---------------------------------------------------------------------------
// Semantic Metric Dev-Grid Materials (Valve/UE-Style 1m Greybox Readability)
// ---------------------------------------------------------------------------
type WbMatKey = 'ground' | 'road' | 'wall' | 'cliff' | 'cover' | 'traversal' | 'machinery' | 'hazard' | 'bunker' | 'glass';

function makeDevGridTexture(baseHex: string, majorHex: string, minorHex: string, accentLabel?: string): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, S, S);

  // Subtle checker tonal split (1m quadrants across 2m tile)
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.fillRect(0, 0, S / 2, S / 2);
  ctx.fillRect(S / 2, S / 2, S / 2, S / 2);

  // 0.25m sub-grid
  ctx.strokeStyle = minorHex;
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (i * S) / 8 + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }

  // 1.0m major grid
  ctx.strokeStyle = majorHex;
  ctx.lineWidth = 3;
  for (const p of [1.5, S / 2 + 0.5]) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }

  // Metric crosshairs & optional semantic label
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.font = 'bold 20px Consolas, monospace';
  ctx.fillText(accentLabel ?? '1M', 14, 30);
  ctx.fillText(accentLabel ?? '1M', S / 2 + 14, S / 2 + 30);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeWhiteboxMaterials(): Record<WbMatKey, THREE.MeshStandardMaterial> {
  const mk = (base: string, major: string, minor: string, rough: number, metal: number, label: string, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
    new THREE.MeshStandardMaterial({
      map: makeDevGridTexture(base, major, minor, label),
      roughness: rough,
      metalness: metal,
      ...extra,
    });
  return {
    ground:    mk('#736a5b', 'rgba(255,244,224,0.22)', 'rgba(255,244,224,0.08)', 0.92, 0.02, 'GND'),
    road:      mk('#565b63', 'rgba(255,255,255,0.24)', 'rgba(255,255,255,0.08)', 0.84, 0.05, 'ROAD'),
    wall:      mk('#9da4ac', 'rgba(255,255,255,0.34)', 'rgba(255,255,255,0.12)', 0.78, 0.06, 'WALL'),
    cliff:     mk('#8c7154', 'rgba(255,232,200,0.24)', 'rgba(255,232,200,0.09)', 0.94, 0.02, 'ROCK'),
    cover:     mk('#cf7d2e', 'rgba(255,245,220,0.42)', 'rgba(255,245,220,0.16)', 0.72, 0.08, 'COV'),
    traversal: mk('#2b9cad', 'rgba(220,252,255,0.44)', 'rgba(220,252,255,0.16)', 0.62, 0.18, 'NAV'),
    machinery: mk('#c9a22b', 'rgba(255,250,220,0.38)', 'rgba(255,250,220,0.14)', 0.56, 0.35, 'IND'),
    hazard:    mk('#c43c38', 'rgba(255,230,225,0.45)', 'rgba(255,230,225,0.18)', 0.62, 0.15, 'OBJ'),
    bunker:    mk('#3d5469', 'rgba(180,225,255,0.34)', 'rgba(180,225,255,0.12)', 0.68, 0.22, 'SUB'),
    glass:     new THREE.MeshStandardMaterial({
      color: 0x7ad0e6, roughness: 0.15, metalness: 0.25, transparent: true, opacity: 0.34, depthWrite: false,
    }),
  };
}

function makeZoneBanner(title: string, subtitle: string, accent = '#e8b04a'): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#121820';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 236);
  ctx.fillStyle = accent;
  ctx.fillRect(10, 10, 24, 236);
  ctx.fillStyle = '#f2f6fa';
  ctx.font = 'bold 46px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(title, 56, 114, 920);
  ctx.fillStyle = '#a8c2da';
  ctx.font = 'bold 28px "Microsoft YaHei", Consolas, monospace';
  ctx.fillText(subtitle, 56, 186, 920);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.8), mat);
  return mesh;
}

// ---------------------------------------------------------------------------
// Fast Batched Whitebox Builder (Metric World-Space Box UVs + Merged Meshes)
// ---------------------------------------------------------------------------
function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number) {
  const uv = geo.attributes.uv;
  // Three.js BoxGeometry face order: +X(d,h), -X(d,h), +Y(w,d), -Y(w,d), +Z(w,h), -Z(w,h)
  const dims: [number, number][] = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * (su / 2), uv.getY(idx) * (sv / 2));
    }
  }
}

function normalizeForMerge(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ni = g.index ? g.toNonIndexed() : g.clone();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', ni.attributes.position);
  if (ni.attributes.normal) out.setAttribute('normal', ni.attributes.normal);
  else out.computeVertexNormals();
  if (ni.attributes.uv) out.setAttribute('uv', ni.attributes.uv);
  else out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ni.attributes.position.count * 2), 2));
  ni.dispose();
  return out;
}

class WhiteboxBuilder {
  private buckets = new Map<WbMatKey, THREE.BufferGeometry[]>();
  mapBuildings: [number, number, number, number][] = [];
  mapRoads: [number, number, number, number][] = [];
  mapCover: [number, number, number, number][] = [];

  constructor(private world: World) {}

  private push(mat: WbMatKey, geo: THREE.BufferGeometry) {
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = []));
    arr.push(normalizeForMerge(geo));
    geo.dispose();
  }

  /** Solid colliding box (minY = y, maxY = y + h). */
  box(
    mat: WbMatKey,
    cx: number, y: number, cz: number,
    w: number, h: number, d: number,
    opts: { rotY?: number; surf?: Surface; solid?: boolean; map?: 'building' | 'road' | 'cover' } = {},
  ) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, y + h * 0.5, cz);
    this.push(mat, geo);

    if (opts.solid !== false) {
      const surf: Surface = opts.surf
        ?? (mat === 'ground' || mat === 'cliff' ? 'sand'
          : mat === 'machinery' || mat === 'traversal' ? 'metal'
            : 'concrete');
      this.world.addBox(cx, y + h * 0.5, cz, w * 0.5, h * 0.5, d * 0.5, opts.rotY ?? 0, surf);
    }
    if (opts.map === 'building') this.mapBuildings.push([cx, cz, w, d]);
    else if (opts.map === 'road') this.mapRoads.push([cx, cz, w, d]);
    else if (opts.map === 'cover') this.mapCover.push([cx, cz, w, d]);
  }

  /** Vertical cylinder (tanks, towers, pipes) with inscribed octagonal/box collision. */
  cyl(
    mat: WbMatKey,
    cx: number, y: number, cz: number,
    r: number, h: number,
    segs = 20,
    opts: { solid?: boolean; surf?: Surface; map?: 'building' | 'cover' } = {},
  ) {
    const geo = new THREE.CylinderGeometry(r, r, h, segs, 1);
    const uv = geo.attributes.uv;
    const circ = (Math.PI * 2 * r) / 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * (h / 2));
    geo.translate(cx, y + h * 0.5, cz);
    this.push(mat, geo);
    if (opts.solid !== false) {
      const hs = r * 0.83;
      const surf = opts.surf ?? 'metal';
      this.world.addBox(cx, y + h * 0.5, cz, hs, h * 0.5, hs, 0, surf);
      this.world.addBox(cx, y + h * 0.5, cz, hs, h * 0.5, hs, Math.PI / 4, surf);
    }
    if (opts.map === 'building') this.mapBuildings.push([cx, cz, r * 1.9, r * 1.9]);
    else if (opts.map === 'cover') this.mapCover.push([cx, cz, r * 1.9, r * 1.9]);
  }

  /** Horizontal pipe along X or Z axis. */
  pipe(mat: WbMatKey, cx: number, cy: number, cz: number, r: number, len: number, axis: 'x' | 'z', solid = false) {
    const geo = new THREE.CylinderGeometry(r, r, len, 12, 1);
    if (axis === 'z') geo.rotateX(H);
    else geo.rotateZ(H);
    geo.translate(cx, cy, cz);
    this.push(mat, geo);
    if (solid) {
      const w = axis === 'x' ? len : r * 2;
      const d = axis === 'z' ? len : r * 2;
      this.world.addBox(cx, cy, cz, w * 0.5, r, d * 0.5, 0, 'metal');
    }
  }

  /** Smooth walkable staircase / ramp between (x0,y0,z0) and (x1,y1,z1) along X or Z. */
  stairs(
    axis: 'x' | 'z',
    cCross: number,
    a0: number, a1: number,
    y0: number, y1: number,
    width: number,
    mat: WbMatKey = 'traversal',
    rails = true,
  ) {
    const dy = y1 - y0;
    const span = Math.abs(a1 - a0);
    const steps = Math.max(4, Math.ceil(Math.abs(dy) / 0.27));
    const da = (a1 - a0) / steps;
    const stepLen = span / steps + 0.08;
    const thick = 0.28;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const a = a0 + da * (i + 0.5);
      const topY = y0 + dy * ((i + 1) / steps);
      const cx = axis === 'x' ? a : cCross;
      const cz = axis === 'z' ? a : cCross;
      const w = axis === 'x' ? stepLen : width;
      const d = axis === 'z' ? stepLen : width;
      this.box(mat, cx, topY - thick, cz, w, thick, d, { surf: 'metal' });
      // Sleek low industrial side curbs + slender vertical posts (keeps sightlines open!)
      if (rails) {
        for (const side of [-1, 1]) {
          const rx = axis === 'x' ? a : cCross + side * (width * 0.5 - 0.06);
          const rz = axis === 'z' ? a : cCross + side * (width * 0.5 - 0.06);
          const rw = axis === 'x' ? stepLen : 0.12;
          const rd = axis === 'z' ? stepLen : 0.12;
          this.box('wall', rx, topY, rz, rw, 0.28, rd, { surf: 'metal', solid: true });
          if (i % 4 === 0) {
            this.box('wall', rx, topY + 0.28, rz, 0.1, 0.72, 0.1, { surf: 'metal', solid: false });
          }
        }
      }
      void t;
    }
  }

  /** Wall with optional doorway/window openings along X (constant Z) or Z (constant X). */
  wall(
    mat: WbMatKey,
    axis: 'x' | 'z',
    c: number,
    a0: number, a1: number,
    y0: number, h: number,
    t = 0.5,
    gaps: { at: number; w: number; h: number }[] = [],
    mapBuilding = false,
  ) {
    const sorted = [...gaps].sort((p, q) => p.at - q.at);
    let cur = a0;
    const seg = (s0: number, s1: number, yy: number, hh: number) => {
      const len = s1 - s0;
      if (len < 0.05 || hh < 0.05) return;
      const mid = (s0 + s1) * 0.5;
      if (axis === 'x') this.box(mat, mid, yy, c, len, hh, t, { map: mapBuilding ? 'building' : undefined });
      else this.box(mat, c, yy, mid, t, hh, len, { map: mapBuilding ? 'building' : undefined });
    };
    for (const g of sorted) {
      const g0 = g.at - g.w * 0.5;
      const g1 = g.at + g.w * 0.5;
      seg(cur, g0, y0, h);
      // Lintel above opening
      if (g.h < h - 0.05) seg(g0, g1, y0 + g.h, h - g.h);
      cur = g1;
    }
    seg(cur, a1, y0, h);
  }

  /** Waist-high tactical cover block (1.12m crouch cover or 1.48m chest peek). */
  coverBlock(cx: number, y: number, cz: number, w: number, d: number, tall = false, rotY = 0) {
    this.box('cover', cx, y, cz, w, tall ? 1.48 : 1.12, d, { rotY, map: 'cover' });
  }

  /** Elevated catwalk slab with perimeter safety railings (omit open sides where stairs/bridges join). */
  catwalk(
    cx: number, y: number, cz: number, w: number, d: number,
    open: { n?: boolean; s?: boolean; e?: boolean; w?: boolean } = {},
  ) {
    this.box('traversal', cx, y - 0.25, cz, w, 0.25, d, { surf: 'metal' });
    const rh = 0.98, rt = 0.14;
    if (!open.n) this.box('wall', cx, y, cz - d * 0.5 + rt * 0.5, w, rh, rt, { surf: 'metal' });
    if (!open.s) this.box('wall', cx, y, cz + d * 0.5 - rt * 0.5, w, rh, rt, { surf: 'metal' });
    if (!open.w) this.box('wall', cx - w * 0.5 + rt * 0.5, y, cz, rt, rh, d, { surf: 'metal' });
    if (!open.e) this.box('wall', cx + w * 0.5 - rt * 0.5, y, cz, rt, rh, d, { surf: 'metal' });
  }

  finalize(mats: Record<WbMatKey, THREE.MeshStandardMaterial>, group: THREE.Group) {
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[key]);
      mesh.castShadow = key !== 'ground' && key !== 'road' && key !== 'glass';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------
// Build Complete 6-Zone Mission 2 Whitebox ("喀拉干达 7 号油田与地下中继站")
// ---------------------------------------------------------------------------
export function buildOilfieldWhitebox(world: World): LevelData {
  // Enable subterranean Zone 5 bunker floor at Y = -6.0m!
  world.baseGroundY = -12;
  const group = new THREE.Group();
  const mats = makeWhiteboxMaterials();
  const wb = new WhiteboxBuilder(world);
  const animatedBeams: THREE.Object3D[] = [];
  let satDish: THREE.Object3D | null = null;
  let flareLight: THREE.PointLight | null = null;

  // =========================================================================
  // 0. BASE TERRAIN SLABS (Clean cutaway over Zone 4->5 Ramp [X:18..36, Z:2..18] AND Zone 5 Bunker [X:36..106, Z:-45..30]!)
  // =========================================================================
  // West half: Zones 1, 2, Zone 3 & West Zone 4 (X: -124..+18, Z: -124..+124)
  wb.box('ground', -53, -1.0, 0, 142, 1.0, 248);
  // Central Zone 4 East strip North & South of Ramp (X: +18..+36)
  wb.box('ground', 27, -1.0, -61, 18, 1.0, 126);   // Z: -124..+2
  wb.box('ground', 27, -1.0, 71, 18, 1.0, 106);    // Z: +18..+124
  // East desert South of Zone 5 bunker (X: +36..+124, Z: +30..+124)
  wb.box('ground', 80, -1.0, 77, 88, 1.0, 94);
  // East desert North of Zone 5 bunker under Zone 6 cliff (X: +36..+124, Z: -124..-45)
  wb.box('ground', 80, -1.0, -84.5, 88, 1.0, 79);
  // Far East perimeter strip East of Zone 5 bunker (X: +106..+124, Z: -45..+30)
  wb.box('ground', 115, -1.0, -7.5, 18, 1.0, 75);

  // Outer perimeter containment cliff walls around the 240x240m complex
  wb.box('cliff', 0, 0, -118, 240, 18, 6);
  wb.box('cliff', 0, 0, 116, 240, 14, 6);
  wb.box('cliff', -118, 0, 0, 6, 16, 240);
  wb.box('cliff', 118, 0, 0, 6, 22, 240);

  // Helper to place floating/gantry 3D Zone Signage
  const addBanner = (title: string, sub: string, x: number, y: number, z: number, rotY = 0, color = '#e8b04a') => {
    const b = makeZoneBanner(title, sub, color);
    b.position.set(x, y, z);
    b.rotation.y = rotY;
    group.add(b);
  };

  // =========================================================================
  // ZONE 1: 戈壁峡谷空降点与外围暗哨 (X: -112..-48, Z: -112..-45, Y: 0.0)
  // =========================================================================
  // Main canyon access road
  wb.box('road', -80, 0.01, -78, 13, 0.06, 68, { solid: false, map: 'road' });
  // Helipad rock drop circle + visual LZ pad
  wb.box('traversal', -80, 0.02, -104, 12, 0.1, 12, { surf: 'concrete' });
  // Canyon framing rock walls (East wall separates Zone 1 from Zone 4/6 north cliffs)
  wb.box('cliff', -112, 0, -78, 8, 12, 68);
  wb.box('cliff', -46, 0, -78, 6, 11, 68);
  // West stepped sniper/overwatch rock shelf (Y = +3.2m, climbable from both ends!)
  wb.box('cliff', -101, 0, -72, 12, 3.2, 34, { map: 'building' });
  wb.stairs('z', -101, -95, -89, 0, 3.2, 5.0, 'traversal', false);
  wb.stairs('z', -101, -55, -49, 3.2, 0, 5.0, 'traversal', false);
  wb.coverBlock(-96, 3.2, -78, 1.0, 4.5, false);
  wb.coverBlock(-96, 3.2, -65, 1.0, 4.5, false);

  // Center canyon tactical cover + wrecked convoy truck whitebox
  wb.box('machinery', -79, 0, -83, 3.2, 2.4, 7.6, { rotY: 0.16, map: 'cover' }); // Wrecked supply truck
  wb.coverBlock(-85, 0, -90, 4.2, 1.0, false, 0.15);
  wb.coverBlock(-74, 0, -73, 4.4, 1.0, false, -0.1);
  wb.coverBlock(-84, 0, -64, 3.8, 1.2, true, 0.08);
  wb.coverBlock(-75, 0, -56, 4.0, 1.0, false);

  // East stealth drainage culvert flank lane (X: -64..-52)
  wb.box('wall', -66, 0, -76, 1.2, 1.8, 36); // Berm separating main road & stealth culvert
  wb.pipe('wall', -58, 0.9, -82, 0.9, 6.0, 'z', true);
  wb.pipe('wall', -58, 0.9, -66, 0.9, 6.0, 'z', true);
  wb.coverBlock(-55, 0, -55, 3.0, 1.0, false);

  // Zone 1 -> Zone 2 Armored Checkpoint Wall & Guardhouse (Z = -45)
  wb.wall('wall', 'x', -45, -110, -48, 0, 4.8, 0.8, [
    { at: -80, w: 8.5, h: 4.2 }, // Main security truck gate
    { at: -56, w: 3.6, h: 3.2 }, // East stealth breach gate
  ], true);
  // Guardhouse pillbox overlooking checkpoint gate
  wb.box('wall', -88.5, 0, -48.5, 6.0, 3.8, 5.2, { map: 'building' });
  wb.box('traversal', -80, 4.2, -45, 11, 0.6, 2.2); // Overhead security gantry
  addBanner('ZONE 1 ▶ ZONE 2 · 荒漠采油区', '外围哨卡检查站 · 宽线性潜行/强攻交界', -80, 5.6, -45.6, Math.PI);

  // =========================================================================
  // ZONE 2: 荒漠采油区与雇佣兵前哨 (X: -112..-48, Z: -45..+35, Y: 0.0)
  // =========================================================================
  wb.box('road', -80, 0.01, -5, 12, 0.06, 80, { solid: false, map: 'road' });
  // East boundary wall separating Zone 2 (west oilfield) from Zone 4 (central refinery)
  wb.box('wall', -46.5, 0, -5, 1.5, 6.0, 80, { map: 'building' });

  // 4 Iconic Oilfield Pumpjacks ("磕头机") with animated rocking horsehead beams!
  const addPumpjack = (px: number, pz: number, rotY: number) => {
    wb.box('road', px, 0, pz, 8.0, 0.25, 12.0, { map: 'cover' }); // Concrete well pad
    wb.box('machinery', px, 0.25, pz - 1.2, 2.2, 4.4, 2.2);      // Samson post A-frame
    wb.box('machinery', px, 0.25, pz + 3.4, 2.4, 2.2, 2.8);      // Motor & counterweight housing
    wb.cyl('hazard', px, 0.25, pz - 4.4, 0.55, 2.4, 12);         // Wellhead Christmas-tree valve
    // Animated walking beam (distinct non-merged mesh)
    const pivot = new THREE.Group();
    pivot.position.set(px, 4.85, pz - 1.2);
    pivot.rotation.y = rotY;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.75, 8.6), mats.machinery);
    beam.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 1.4), mats.hazard);
    head.position.set(0, -0.3, -4.1);
    head.castShadow = true;
    pivot.add(beam, head);
    group.add(pivot);
    animatedBeams.push(pivot);
  };
  addPumpjack(-98, -26, 0);
  addPumpjack(-96, 8, 0);
  addPumpjack(-73, -15, 0);
  addPumpjack(-75, 19, 0);

  // East 2-Story Mercenary Barracks & Sniper Watchtower (X: -62..-48, Z: -22..+12)
  // 1F Playable interior (open front & side doorways)
  wb.wall('wall', 'z', -62, -22, 12, 0, 3.8, 0.5, [{ at: -12, w: 3.0, h: 2.8 }, { at: 4, w: 3.0, h: 2.8 }], true);
  wb.wall('wall', 'x', -22, -62, -48, 0, 3.8, 0.5, [{ at: -55, w: 2.8, h: 2.8 }]);
  wb.wall('wall', 'x', 12, -62, -48, 0, 3.8, 0.5, [{ at: -55, w: 2.8, h: 2.8 }]);
  wb.box('wall', -55, 3.8, -5, 14.5, 0.35, 34.5, { map: 'building' }); // 2F roof slab (walkable!)
  // Perimeter waist parapet on 2F roof (open west stair entry)
  wb.wall('cover', 'z', -62, -22, 12, 4.15, 1.05, 0.35, [{ at: -16, w: 3.4, h: 1.05 }]);
  wb.box('cover', -55, 4.15, -22, 14, 1.05, 0.35);
  wb.box('cover', -55, 4.15, 12, 14, 1.05, 0.35);
  // Exterior steel stairs to 2F Barracks Roof
  wb.stairs('z', -64.2, -26, -17, 0, 4.15, 2.8, 'traversal', true);
  // Sniper Watchtower on South-East corner of Barracks (Y = +4.15 -> +7.8m)
  wb.box('traversal', -53, 7.6, 6, 7.5, 0.35, 7.5, { surf: 'metal' });
  wb.box('wall', -56.4, 4.15, 2.6, 0.5, 3.5, 0.5);
  wb.box('wall', -49.6, 4.15, 2.6, 0.5, 3.5, 0.5);
  wb.box('wall', -56.4, 4.15, 9.4, 0.5, 3.5, 0.5);
  wb.box('wall', -49.6, 4.15, 9.4, 0.5, 3.5, 0.5);
  wb.stairs('z', -58.2, -6, 3, 4.15, 7.8, 2.4, 'traversal', true);
  wb.coverBlock(-56.2, 7.95, 6, 0.5, 6.2, false);

  // West Sandbagged Mortar & Fuel Pit (X: -108..-92, Z: -10..+24)
  wb.coverBlock(-92, 0, -6, 1.2, 7.0, false);
  wb.coverBlock(-92, 0, 20, 1.2, 7.0, false);
  wb.coverBlock(-103, 0, -10, 6.5, 1.2, true);
  wb.coverBlock(-103, 0, 24, 6.5, 1.2, false);
  wb.cyl('hazard', -104, 0, -3, 0.7, 1.4, 10);
  wb.cyl('hazard', -102, 0, -3, 0.7, 1.4, 10);

  // Central oilfield pipeline spine & tactical cover blocks
  wb.pipe('machinery', -84.5, 0.75, -6, 0.45, 58, 'z', true);
  wb.coverBlock(-80, 0, -30, 4.5, 1.1, false);
  wb.coverBlock(-80, 0, -6, 4.5, 1.1, false);
  wb.coverBlock(-80, 0, 14, 4.5, 1.1, false);
  wb.coverBlock(-68, 0, 25, 4.2, 1.2, true);

  // Zone 2 -> Zone 3 Armored Tank-Farm Security Wall (Z = +35)
  wb.wall('wall', 'x', 35, -114, -46, 0, 5.2, 0.9, [
    { at: -79, w: 9.0, h: 4.5 }, // Main Tank Farm Truck Gate
    { at: -55, w: 3.8, h: 3.4 }, // East Maintenance Entry
  ], true);
  addBanner('ZONE 2 ▶ ZONE 3 · 巨型储油罐阵', '6 座原油储罐 + 罐顶 5.2m 立体连廊 + 装车泵站', -79, 6.2, 34.3, Math.PI);

  // =========================================================================
  // ZONE 3: 巨型储油罐阵与装车泵站 (X: -110..+20, Z: +35..+108, Y: 0.0 & +5.2)
  // =========================================================================
  wb.box('road', -46, 0.01, 72, 128, 0.06, 12, { solid: false, map: 'road' });
  // East wall closing Zone 3 from empty SE desert
  wb.box('wall', 22, 0, 74, 1.8, 6.5, 80, { map: 'building' });

  // 6 Monumental Crude Storage Tanks (R = 8.2m, H = 9.2m) in 3x2 grid
  const tankXs = [-94, -66, -38];
  const tankZs = [56, 88];
  for (const tx of tankXs) {
    for (const tz of tankZs) {
      wb.cyl('machinery', tx, 0, tz, 8.2, 9.2, 24, { map: 'building' });
      // Crimson hazard band ring around upper tank
      wb.cyl('hazard', tx, 7.6, tz, 8.32, 0.85, 24, { solid: false });
      // Ground-level concrete bund walls (waist cover around tank yards)
      wb.coverBlock(tx, 0, tz - 10.6, 8.0, 0.9, false);
      wb.coverBlock(tx, 0, tz + 10.6, 8.0, 0.9, false);
    }
  }

  // Elevated Tank-Farm Catwalk Network (Y = +5.2m) connecting ALL 6 tanks + Pump Station!
  // Main East-West Steel Bridge Spine at Z = +72 (between North & South tank rows)
  wb.catwalk(-52, 5.2, 72, 102, 3.6, { e: true, w: false, n: true, s: true });
  // Cross-bridges heading North & South between tanks
  for (const bx of [-80, -52, -24]) {
    wb.catwalk(bx, 5.2, 56, 3.4, 28, { n: true, s: true });
    wb.catwalk(bx, 5.2, 88, 3.4, 28, { n: true, s: true });
  }
  // Tactical cover boxes on the 5.2m catwalk intersections
  wb.coverBlock(-80, 5.2, 72, 1.4, 1.4, false);
  wb.coverBlock(-52, 5.2, 72, 1.4, 1.4, false);
  wb.coverBlock(-24, 5.2, 72, 1.4, 1.4, false);

  // 3 Wide Walkable Steel Staircases ascending Y=0 -> Y=+5.2m
  wb.stairs('z', -80, 38, 43, 0, 5.2, 3.0, 'traversal', true);
  wb.stairs('z', -52, 108, 102, 0, 5.2, 3.0, 'traversal', true);
  wb.stairs('x', 72, -16, -3, 0, 5.2, 3.0, 'traversal', true);

  // East Fuel-Truck Loading Pump Station (X: -20..+18, Z: +44..+100)
  // Steel canopy roof overhead (Y = +6.5m) supported by 6 industrial columns
  wb.box('wall', 2, 6.5, 72, 26, 0.45, 52, { map: 'building' });
  for (const cz of [50, 72, 94]) {
    for (const cx of [-9, 13]) wb.box('machinery', cx, 0, cz, 1.1, 6.5, 1.1);
  }
  // 3 Whitebox Fuel Tanker Trucks parked at loading bays (great CQB cover + explosive targets!)
  for (const tz of [54, 72, 90]) {
    wb.box('machinery', 4, 0, tz, 3.4, 2.6, 11.5, { map: 'cover' });
    wb.cyl('hazard', 4, 1.4, tz + 1.2, 1.4, 7.6, 12, { solid: false });
    wb.coverBlock(-4, 0, tz, 1.2, 5.5, false);
  }

  // Zone 3 -> Zone 4 Dual-Level Entry Wall (Z = +35, X: -46..+22)
  wb.wall('wall', 'x', 35, -46, 22, 0, 7.2, 1.0, [
    { at: -14, w: 9.0, h: 4.6 }, // Ground Vehicle Blast Gate into Refinery
    { at: 5, w: 4.5, h: 6.8 },   // Upper Pipe-Bridge Infiltration Portal!
  ], true);
  // Elevated Pipe-Bridge directly linking Zone 3 Catwalk (Y=5.2) -> Zone 4 Mid Catwalk (Y=4.5)!
  wb.catwalk(5, 5.2, 54, 3.8, 34, { n: true, s: true });
  wb.stairs('z', 5, 37, 30, 5.2, 4.5, 3.6, 'traversal', true);
  addBanner('ZONE 3 ▶ ZONE 4 · 核心裂解精炼厂区', '地面重型闸门 + 东侧 5.2m 架空管廊双路突入', -14, 6.0, 34.1, 0, '#e8b04a');

  // =========================================================================
  // ZONE 4: 核心裂解精炼厂区 — 三层立体主战场 (X: -45..+35, Z: -35..+35)
  // =========================================================================
  wb.box('road', -8, 0.01, 0, 56, 0.06, 66, { solid: false, map: 'road' });
  // North boundary wall of Refinery separating from Northern Cliff (Zone 6 towers above to the NE!)
  wb.box('wall', -5, 0, -36, 84, 7.5, 1.5, { map: 'building' });
  // East retaining wall above Zone 5 bunker (leaving wide opening at Z: +2..+18 for Underground Ramp!)
  wb.wall('wall', 'z', 36, -36, 35, 0, 7.5, 1.2, [{ at: 10, w: 14.0, h: 6.2 }], true);

  // Centerpiece Catalytic Cracking Towers (X: -12..+8, Z: -12..+12)
  wb.cyl('machinery', -6, 0, -5, 3.6, 20.0, 20, { map: 'building' });
  wb.cyl('machinery', 4, 0, -5, 2.8, 17.0, 18, { map: 'building' });
  wb.cyl('machinery', -1, 0, 6, 3.2, 18.5, 18, { map: 'building' });
  // Iconic 26m Refinery Flare Stack (visible from Zone 1 spawn as primary landmark!)
  wb.cyl('hazard', 10, 0, -18, 1.35, 26.0, 14, { map: 'building' });
  const flareOrb = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff8828 }),
  );
  flareOrb.position.set(10, 27.0, -18);
  group.add(flareOrb);
  flareLight = new THREE.PointLight(0xff7722, 65, 55, 1.6);
  flareLight.position.set(10, 27.5, -18);
  group.add(flareLight);

  // Mid-Level Refinery Steel Catwalk Ring (Y = +4.5m) encircling Cracking Towers
  wb.catwalk(-1, 4.5, -16, 28, 3.6, { e: true, w: true, n: false, s: true });
  wb.catwalk(-1, 4.5, 16, 28, 3.6, { e: true, w: true, n: true, s: true });
  wb.catwalk(-14, 4.5, 0, 3.6, 32, { n: true, s: true, w: true, e: true });
  wb.catwalk(12, 4.5, 0, 3.6, 32, { n: true, s: true, w: true, e: true });
  // Connect Zone 3 Pipe-Bridge into South Refinery Catwalk
  wb.catwalk(5, 4.5, 23, 3.6, 13, { n: true, s: true });
  // Ground -> 4.5m Catwalk Staircases (South-West & North-East)
  wb.stairs('z', -14, 27, 17, 0, 4.5, 3.0, 'traversal', true);
  wb.stairs('z', 12, -27, -17, 0, 4.5, 3.0, 'traversal', true);

  // Upper Gantry & Sniper Platform (Y = +9.0m) crowning the cracking complex!
  wb.catwalk(-1, 9.0, -14, 24, 3.4, { e: true, w: true });
  wb.catwalk(12, 9.0, -4, 3.4, 22, { n: true, s: true });
  wb.stairs('z', 12, 14, 6, 4.5, 9.0, 2.8, 'traversal', true);
  wb.coverBlock(-1, 9.0, -12.6, 4.5, 0.8, false);
  wb.coverBlock(10.6, 9.0, -4, 0.8, 4.5, false);

  // West 2-Story Refinery Panoramic Control Room (X: -43..-24, Z: -18..+16)
  // 1F Playable Intake Hall
  wb.wall('wall', 'z', -24, -18, 16, 0, 4.5, 0.5, [{ at: -8, w: 3.4, h: 3.0 }, { at: 8, w: 3.4, h: 3.0 }], true);
  wb.wall('wall', 'x', -18, -43, -24, 0, 4.5, 0.5, [{ at: -33, w: 3.2, h: 3.0 }]);
  wb.wall('wall', 'x', 16, -43, -24, 0, 4.5, 0.5, [{ at: -33, w: 3.2, h: 3.0 }]);
  wb.box('wall', -43, 0, -1, 0.7, 9.0, 34);
  // 2F Control Room Floor Slab (Y = +4.5m) + Roof (Y = +9.0m)
  wb.box('wall', -33.5, 4.2, -1, 19.5, 0.35, 34.5, { map: 'building' });
  wb.box('wall', -33.5, 8.8, -1, 19.5, 0.4, 34.5);
  // 2F East Glass Observation Wall overlooking Cracking Towers (low sill + glass + doorway to skybridge!)
  wb.wall('wall', 'z', -24, -18, 16, 4.55, 1.1, 0.4, [{ at: 0, w: 3.6, h: 1.1 }]);
  wb.box('glass', -24, 5.65, -10, 0.14, 3.0, 15, { solid: false });
  wb.box('glass', -24, 5.65, 9, 0.14, 3.0, 13, { solid: false });
  // Console desks inside 2F Control Room (CQB cover!)
  wb.coverBlock(-30, 4.55, -8, 2.2, 6.0, false);
  wb.coverBlock(-30, 4.55, 7, 2.2, 6.0, false);
  wb.coverBlock(-37, 4.55, 0, 3.0, 8.0, true);
  // Direct Skybridge connecting 2F Control Room <-> Central Refinery Catwalk (Y = +4.5m)
  wb.catwalk(-19.5, 4.5, 0, 10, 3.8, { e: true, w: true });
  // Exterior North Staircase into 2F Control Room
  wb.stairs('x', -20, -24, -36, 0, 4.55, 3.0, 'traversal', true);

  // Ground-level refinery tactical cover blocks
  wb.coverBlock(-15, 0, 22, 5.0, 1.2, false);
  wb.coverBlock(4, 0, 22, 5.0, 1.2, false);
  wb.coverBlock(-18, 0, -24, 4.8, 1.2, true);
  wb.coverBlock(2, 0, -24, 5.2, 1.2, false);
  wb.coverBlock(18, 0, -4, 1.4, 6.0, false);

  // Zone 4 -> Zone 5 Underground Ramp Portal (X: +18..+37, Z: +2..+18, descending Y=0.0 -> Y=-6.0!)
  wb.box('bunker', 27.5, -6.5, 1.5, 20, 9.5, 1.0);  // North ramp tunnel wall
  wb.box('bunker', 27.5, -6.5, 18.5, 20, 9.5, 1.0); // South ramp tunnel wall
  wb.box('bunker', 30.5, 2.4, 10, 14, 0.8, 18);     // Reinforced concrete tunnel brow roof
  wb.stairs('x', 10, 19.5, 36.5, 0.0, -6.0, 15.6, 'traversal', false);
  addBanner('ZONE 4 ▶ ZONE 5 · 厄普西隆地下卫星数据掩体', '防爆车辆斜坡下行（海拔 -6.0m）· 服务器机房巷战', 24, 4.6, 10, -H, '#58d6f0');

  // =========================================================================
  // ZONE 5: 厄普西隆地下卫星数据掩体 (X: +36..+106, Z: -45..+30, Y: -6.0 & -1.5)
  // =========================================================================
  // Subterranean Bunker Floor (Y = -6.0) & Ceiling Roof (Y = +2.6)
  wb.box('bunker', 71, -7.0, -7.5, 72, 1.0, 78); // Main underground floor slab
  wb.box('bunker', 71, 2.6, -7.5, 72, 1.0, 78);  // Heavy blast ceiling sealing out desert above
  // Outer bunker blast walls
  wb.box('bunker', 106, -6.0, -7.5, 1.4, 8.8, 78);
  wb.box('bunker', 71, -6.0, 30, 72, 8.8, 1.4);
  wb.wall('bunker', 'z', 36, -45, 30, -6.0, 8.8, 1.2, [{ at: 10, w: 14.0, h: 6.2 }]); // West ramp entry
  wb.wall('bunker', 'x', -45, 36, 106, -6.0, 8.8, 1.2, [{ at: 92, w: 12.0, h: 8.5 }]); // North exit into Zone 5->6 Ascent Shaft

  // West Decontamination Blast Airlock Partition (X = +48)
  wb.wall('bunker', 'z', 48, -18, 28, -6.0, 8.6, 1.2, [
    { at: 10, w: 7.0, h: 4.5 },  // Main blast door
    { at: -8, w: 4.2, h: 3.8 },  // Side security door
  ]);
  wb.coverBlock(43, -6.0, 10, 1.2, 4.2, false);

  // Main Server Vault Hall (X: +48..+98, Z: -18..+26, Y = -6.0)
  // Central Holographic Core Server Pillar (Objective!) at (+73, -6.0, +4)
  wb.cyl('hazard', 73, -6.0, 4, 2.6, 8.6, 16, { map: 'building' });
  wb.coverBlock(73, -6.0, -1.8, 6.2, 1.0, false);
  wb.coverBlock(73, -6.0, 9.8, 6.2, 1.0, false);
  wb.coverBlock(67.2, -6.0, 4, 1.0, 6.2, false);
  wb.coverBlock(78.8, -6.0, 4, 1.0, 6.2, false);

  // 4 Rows of Tall Server Rack Aisles (intense close-quarters corridor combat!)
  for (const sx of [56, 64, 82, 90]) {
    wb.box('bunker', sx, -6.0, -9, 2.2, 3.0, 10.0, { map: 'cover' });
    wb.box('bunker', sx, -6.0, 17, 2.2, 3.0, 10.0, { map: 'cover' });
    wb.coverBlock(sx, -6.0, 4, 2.2, 2.6, false);
  }

  // 2F Underground Overhead Security Mezzanine (Y = -1.5m) around the Server Vault!
  wb.catwalk(73, -1.5, 25, 48, 3.6, { w: true, e: true });
  wb.catwalk(73, -1.5, -16, 48, 3.6, { w: true, e: true });
  wb.catwalk(51, -1.5, 4.5, 3.6, 42, { n: true, s: true });
  wb.catwalk(95, -1.5, 4.5, 3.6, 42, { n: true, s: true });
  // Dual staircases ascending Y = -6.0 -> Y = -1.5 inside Server Vault
  wb.stairs('z', 51, 20, 10, -6.0, -1.5, 2.8, 'traversal', true);
  wb.stairs('z', 95, -11, -1, -6.0, -1.5, 2.8, 'traversal', true);

  // Partition separating Server Vault & North Cooling Turbine Hall (Z = -19)
  wb.wall('bunker', 'x', -19, 48, 105, -6.0, 8.6, 1.0, [
    { at: 60, w: 5.0, h: 4.0 },
    { at: 86, w: 5.0, h: 4.0 },
  ]);

  // North Cooling Turbine Corridor (X: +48..+105, Z: -44..-19, Y = -6.0)
  for (const tx of [56, 68, 80]) {
    wb.cyl('machinery', tx, -6.0, -32, 2.4, 7.6, 16, { map: 'cover' });
    wb.coverBlock(tx, -6.0, -25, 3.8, 1.0, false);
  }
  // Subterranean Bunker Cool Tactical Lighting
  for (const [lx, lz] of [[42, 10], [62, 4], [84, 4], [73, -10], [73, 18], [68, -32], [92, -36]]) {
    const pt = new THREE.PointLight(0x7acbff, 28, 34, 1.5);
    pt.position.set(lx, 1.4, lz);
    group.add(pt);
  }
  const coreLight = new THREE.PointLight(0xff5238, 32, 22, 1.6);
  coreLight.position.set(73, -2.5, 4);
  group.add(coreLight);

  addBanner('ZONE 5 ▶ ZONE 6 · 悬崖停机坪与中继塔', '工业货梯竖井折返梯（-6.0m 攀升至 +12.0m 悬崖高地）', 92, -1.2, -43.5, 0, '#e8b04a');

  // =========================================================================
  // ZONE 5 -> ZONE 6 CONTINUOUS VERTICAL ASCENT SHAFT (X: +84..+104, Z: -56..-45, Y: -6.0 -> +12.0)
  // =========================================================================
  // Enclosed reinforced cliff elevator/stair shaft with 3 smooth landings (0.0m, +6.0m, +12.0m)
  wb.box('cliff', 83, -6.0, -50.5, 1.2, 18.5, 13);
  wb.box('cliff', 105, -6.0, -50.5, 1.2, 18.5, 13);
  wb.box('cliff', 94, -6.0, -57, 22, 12.2, 1.2); // North shaft wall up to Zone 6 deck (+12.0 open!)
  // Flight 1: Y = -6.0 -> 0.0 along West-East (Z = -47.5)
  wb.stairs('x', -47.5, 86, 100, -6.0, 0.0, 3.4, 'traversal', true);
  wb.box('traversal', 102, -0.3, -50.5, 4.5, 0.3, 9.6, { surf: 'metal' }); // Landing 1 (Y = 0.0)
  // Flight 2: Y = 0.0 -> +6.0 along East-West (Z = -53.2)
  wb.stairs('x', -53.2, 100, 86, 0.0, 6.0, 3.4, 'traversal', true);
  wb.box('traversal', 86, 5.7, -50.5, 4.5, 0.3, 9.6, { surf: 'metal' }); // Landing 2 (Y = +6.0)
  // Flight 3: Y = +6.0 -> +12.0 along West-East (Z = -47.5) emerging onto Zone 6 Cliff Deck!
  wb.stairs('x', -47.5, 88, 102, 6.0, 12.0, 3.4, 'traversal', true);
  // Shaft stairwell guide light
  for (const ly of [-1.5, 4.5, 10.5]) {
    const sl = new THREE.PointLight(0xffd28a, 22, 22, 1.5);
    sl.position.set(94, ly, -50.5);
    group.add(sl);
  }

  // =========================================================================
  // ZONE 6: 悬崖停机坪与高轨中继塔 — 终局决战 (X: +44..+114, Z: -114..-45, Y: +12.0)
  // =========================================================================
  // Elevated +12m Cliff Plateau Deck (leave opening at X: +84..+104, Z: -56..-45 for ascent stairwell!)
  wb.box('cliff', 64, 0, -79.5, 40, 12.0, 69, { map: 'building' });    // West cliff plateau (X: 44..84)
  wb.box('cliff', 99, 0, -85.5, 30, 12.0, 57, { map: 'building' });    // North-East helipad plateau (X: 84..114, Z: -114..-57)
  wb.box('cliff', 109.5, 0, -51, 9, 12.0, 12);                         // East shaft shoulder (X: 105..114, Z: -57..-45)
  // Walkable surface finish pad on +12.0m plateau
  wb.box('road', 79, 12.01, -84, 64, 0.06, 56, { solid: false, map: 'road' });

  // Panoramic West & South Cliff Overlook Parapet (waist-high so player sees ALL of Zones 1–4 below!)
  wb.box('cover', 44.5, 12.0, -79.5, 0.8, 1.15, 68);
  wb.box('cover', 64, 12.0, -45.5, 39, 1.15, 0.8);

  // Epsilon Giant Ka-Band Satellite Uplink Command Tower (X: +56..+72, Z: -86..-68)
  wb.box('wall', 64, 12.0, -77, 15, 4.4, 15, { map: 'building' });     // Reinforced Radar Command Bunker
  wb.stairs('z', 54.5, -66, -77, 12.0, 16.4, 2.8, 'traversal', true);  // Climbable Roof Access
  wb.box('cover', 64, 16.4, -69.8, 14.5, 1.0, 0.4);
  wb.box('cover', 64, 16.4, -84.2, 14.5, 1.0, 0.4);
  // Rotating Giant Whitebox Satellite Dish (rises to Y = +29m — iconic skyline silhouette!)
  wb.cyl('machinery', 64, 16.4, -77, 2.4, 5.2, 16);
  const dishPivot = new THREE.Group();
  dishPivot.position.set(64, 22.4, -77);
  const dishBowl = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 1.8, 2.2, 24), mats.hazard);
  dishBowl.rotation.x = 0.82;
  dishBowl.castShadow = true;
  const feedHorn = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 5.2, 10), mats.machinery);
  feedHorn.position.set(0, 2.8, 2.8);
  feedHorn.rotation.x = 0.82;
  dishPivot.add(dishBowl, feedHorn);
  group.add(dishPivot);
  satDish = dishPivot;

  // Elevated Circular Extraction Helipad (X: +94, Z: -92, Y: +12.4, R = 10.5m)
  wb.cyl('traversal', 94, 12.0, -92, 10.8, 0.42, 24, { surf: 'concrete' });
  // Bold whitebox 'H' helipad decal
  wb.box('machinery', 90.5, 12.43, -92, 1.2, 0.04, 8.2, { solid: false });
  wb.box('machinery', 97.5, 12.43, -92, 1.2, 0.04, 8.2, { solid: false });
  wb.box('machinery', 94.0, 12.43, -92, 7.0, 0.04, 1.2, { solid: false });

  // 360° Finale Defense Sandbag Rings & Twin MG Pillboxes around Helipad
  wb.coverBlock(80, 12.0, -92, 1.2, 8.0, false);
  wb.coverBlock(94, 12.0, -76, 9.0, 1.2, false);
  wb.coverBlock(94, 12.0, -106, 9.0, 1.2, false);
  wb.coverBlock(107, 12.0, -92, 1.2, 8.0, false);
  wb.box('wall', 75, 12.0, -104, 6.5, 3.2, 5.5, { map: 'building' }); // North-West MG Pillbox
  wb.box('wall', 105, 12.0, -72, 5.5, 3.2, 6.5, { map: 'building' }); // South-East MG Pillbox
  wb.coverBlock(76, 12.0, -58, 5.5, 1.2, false);
  wb.coverBlock(54, 12.0, -56, 5.0, 1.2, true);
  addBanner('ZONE 6 · 悬崖停机坪与高轨中继塔（终局）', '海拔 +12.0m · 爆破中继天线 + 360° 停机坪守卫撤离', 86, 16.5, -75, 0, '#e8584a');

  // Finalize all batched whitebox meshes into the scene!
  wb.finalize(mats, group);

  // Minimap architectural blueprint
  const map: MapInfo = {
    half: 122,
    roads: wb.mapRoads,
    ground: '#595247',
    road: '#3d424a',
  };

  return {
    id: 'oilfield',
    group,
    playerSpawn: { x: -80, z: -104, yaw: Math.PI },
    spawnPoints: [
      { x: -80, z: -60 }, { x: -80, z: 0 }, { x: -66, z: 72 },
      { x: -1, z: 0 }, { x: 73, z: 4 }, { x: 94, z: -92 },
    ],
    barrels: [],
    supplies: [
      { x: -86, z: -96 },
      { x: -66, z: -18 },
      { x: -20, z: 72 },
      { x: -20, z: 10 },
    ],
    fires: [new THREE.Vector3(10, 26.5, -18)],
    plumes: [new THREE.Vector3(10, 28.0, -18)],
    bound: 120,
    map,
    targets: [],
    menuCamera(t, cam) {
      const a = t * 0.08;
      cam.position.set(Math.sin(a) * 90, 48, Math.cos(a) * 90);
      cam.lookAt(0, 6, 0);
    },
    update(dt, t) {
      for (let i = 0; i < animatedBeams.length; i++) {
        animatedBeams[i].rotation.x = Math.sin(t * 1.15 + i * 1.4) * 0.24;
      }
      if (satDish) satDish.rotation.y = Math.sin(t * 0.22) * 0.65;
      if (flareLight) flareLight.intensity = 60 + Math.sin(t * 9.5) * 10 + Math.cos(t * 15.2) * 6;
      void dt;
    },
  };
}
