import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapInfo } from '../ui/hud';
import type { LevelData } from './level';
import { World, type Surface } from './physics';

const H = Math.PI / 2;

export interface ShipWhiteboxZoneInfo {
  id: number;
  code: string;
  name: string;
  estMin: string;
  summary: string;
  spawn: { x: number; y: number; z: number; yaw: number };
  bounds: { x0: number; x1: number; z0: number; z1: number; yMin?: number; yMax?: number };
}

/** 6-Zone ~30-minute Remake Blueprint for Mission 1: 《深海利刃 · 泰山号万吨货轮重制版》 */
export const SHIP_REMAKE_ZONES: ShipWhiteboxZoneInfo[] = [
  {
    id: 1,
    code: 'ZONE 1',
    name: '船尾强降坪与暴雨集装箱迷阵',
    estMin: '约 5 分钟',
    summary: '直-20J 船尾双绳索降 · 三线立体集装箱战术迷宫（左舷箱顶狙击道 / 中路主巷 / 右舷排水潜行道）· 摧毁防空机枪阵地解锁 01 号水密闸门',
    spawn: { x: 0, y: 0.0, z: -124, yaw: Math.PI },
    bounds: { x0: -22, x1: 22, z0: -138, z1: -64 },
  },
  {
    id: 2,
    code: 'ZONE 2',
    name: '三层舰桥上层建筑（宿舍 · 餐厅 · 舰桥）',
    estMin: '约 6 分钟',
    summary: '1F 船员宿舍双廊 CQB 营救人质 → 2F 船员大餐厅双门同步破门营救船长 → 3F 全景舰桥夺取加密货单并解除 02 号主货舱气密锁',
    spawn: { x: 0, y: 0.0, z: -59, yaw: Math.PI },
    bounds: { x0: -23, x1: 23, z0: -64, z1: -20 },
  },
  {
    id: 3,
    code: 'ZONE 3',
    name: '3 号巨型双层主货舱（14 米挑高立体战场）',
    estMin: '约 6 分钟',
    summary: 'Y=0.0 环形钢架走道俯瞰巨型货舱 · 左右双侧连续之字钢梯自然下探至 Y=-6.0 舱底（零瞬移）· 清剿高低立体火力并破译厄普西隆高危集装箱',
    spawn: { x: 0, y: 0.0, z: -16, yaw: Math.PI },
    bounds: { x0: -21, x1: 21, z0: -20, z1: 36 },
  },
  {
    id: 4,
    code: 'ZONE 4',
    name: '深海主轮机舱与双层柴油主机大厅',
    estMin: '约 5 分钟',
    summary: '水线以下 -6.0m 巨型双柴油主机大厅 · -1.8m 双层检修天桥 CQB · 重启应急配电并关闭进水总阀 · 沿抗沉逃生阶梯攀升重返前甲板',
    spawn: { x: 0, y: -6.0, z: 40, yaw: Math.PI },
    bounds: { x0: -21, x1: 21, z0: 36, z1: 82 },
  },
  {
    id: 5,
    code: 'ZONE 5',
    name: '前甲板重型龙门吊与防空导弹驳运区',
    estMin: '约 4 分钟',
    summary: '重返狂风前甲板 · 横跨两座 18m 船用重型龙门吊与 +4.2m 操纵走道 · 炸毁封锁空域的防空导弹发射架 · 开启 05 号船艏防浪闸门',
    spawn: { x: 0, y: 0.0, z: 93, yaw: Math.PI },
    bounds: { x0: -22, x1: 22, z0: 82, z1: 116 },
  },
  {
    id: 6,
    code: 'ZONE 6',
    name: '船艏撤离停机坪 · 终局死守撤离',
    estMin: '约 4 分钟',
    summary: '锐角船艏锚机甲板与 +1.2m 圆形停机坪 · 360° 防浪掩体阵地死守 2 波精锐反扑 · 掩护全员登上"海雕-1"直-20J 升空撤离',
    spawn: { x: 0, y: 0.0, z: 120, yaw: Math.PI },
    bounds: { x0: -22, x1: 22, z0: 116, z1: 140 },
  },
];

export function detectShipRemakeZone(pos: THREE.Vector3): ShipWhiteboxZoneInfo {
  for (const z of SHIP_REMAKE_ZONES) {
    const b = z.bounds;
    if (pos.x >= b.x0 && pos.x <= b.x1 && pos.z >= b.z0 && pos.z <= b.z1) {
      return z;
    }
  }
  return SHIP_REMAKE_ZONES[0];
}

// ---------------------------------------------------------------------------
// Clean Architectural Metric-Grid Whitebox Materials (1m / 4m Scale Ruler!)
// ---------------------------------------------------------------------------
type WbKey = 'deck' | 'hull' | 'wall' | 'stair' | 'container' | 'cover' | 'objective' | 'console' | 'gate' | 'machinery' | 'sea';

function makeGridTex(bg: string, line: string, major: string): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  const step = S / 4; // 4 sub-cells per tile (1m grid at tile=4.0m)
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(S, i * step); ctx.stroke();
  }
  ctx.strokeStyle = major;
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, S - 4, S - 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.owned = true;
  return tex;
}

function makeWhiteboxPalette(): Record<WbKey, THREE.Material> {
  const mk = (bg: string, line: string, major: string, rough = 0.84, metal = 0.05) =>
    new THREE.MeshStandardMaterial({
      map: makeGridTex(bg, line, major),
      roughness: rough,
      metalness: metal,
    });
  return {
    deck:      mk('#b8bec7', 'rgba(40,48,58,0.22)',  'rgba(25,32,42,0.45)', 0.88, 0.08),
    hull:      mk('#88929e', 'rgba(20,28,36,0.25)',  'rgba(14,20,28,0.48)', 0.82, 0.18),
    wall:      mk('#dcdfe4', 'rgba(60,68,78,0.20)',  'rgba(38,46,56,0.40)', 0.86, 0.04),
    stair:     mk('#e2a83b', 'rgba(85,54,10,0.26)',  'rgba(60,36,6,0.50)',  0.76, 0.14),
    container: mk('#5c7894', 'rgba(20,34,48,0.28)',  'rgba(12,24,36,0.52)', 0.78, 0.15),
    cover:     mk('#798694', 'rgba(28,36,44,0.25)',  'rgba(18,24,30,0.48)', 0.82, 0.12),
    objective: mk('#d8564c', 'rgba(90,20,16,0.26)',  'rgba(70,12,10,0.50)', 0.66, 0.12),
    console:   mk('#36b6d4', 'rgba(10,60,76,0.26)',  'rgba(8,44,58,0.50)',  0.58, 0.22),
    gate:      mk('#2f9e66', 'rgba(10,56,32,0.28)',  'rgba(8,42,24,0.52)',  0.65, 0.25),
    machinery: mk('#545d68', 'rgba(22,26,32,0.30)',  'rgba(12,16,20,0.55)', 0.70, 0.30),
    sea:       new THREE.MeshStandardMaterial({ color: 0x1b364d, roughness: 0.35, metalness: 0.25 }),
  };
}

function makeZoneSign(title: string, sub: string, accent = '#e2a83b', w = 7.4, h = 1.85): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#182028';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 1008, 240);
  ctx.fillStyle = accent;
  ctx.fillRect(8, 8, 26, 240);
  ctx.fillStyle = '#f2f6fa';
  ctx.font = 'bold 46px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(title, 54, 110, 930);
  ctx.fillStyle = '#b4c6d8';
  ctx.font = 'bold 26px "Microsoft YaHei", Consolas, monospace';
  ctx.fillText(sub, 54, 182, 930);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.owned = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

// ---------------------------------------------------------------------------
// Batched Zero-Bloat Whitebox Structural Builder
// ---------------------------------------------------------------------------
function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile = 4.0) {
  const uv = geo.attributes.uv;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * (su / tile), uv.getY(idx) * (sv / tile));
    }
  }
}

function normGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
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

class ShipWhiteboxBuilder {
  private buckets = new Map<WbKey, THREE.BufferGeometry[]>();
  roads: [number, number, number, number][] = [];

  constructor(private world: World) {}

  private push(key: WbKey, geo: THREE.BufferGeometry) {
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(normGeo(geo));
    geo.dispose();
  }

  box(
    key: WbKey,
    cx: number, y: number, cz: number,
    w: number, h: number, d: number,
    opts: { rotY?: number; surf?: Surface; solid?: boolean; road?: boolean; tile?: number } = {},
  ) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d, opts.tile ?? 4.0);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, y + h * 0.5, cz);
    this.push(key, geo);
    if (opts.solid !== false) {
      const surf: Surface = opts.surf ?? (key === 'deck' || key === 'stair' || key === 'container' ? 'metal' : 'concrete');
      this.world.addBox(cx, y + h * 0.5, cz, w * 0.5, h * 0.5, d * 0.5, opts.rotY ?? 0, surf);
    }
    if (opts.road) this.roads.push([cx, cz, w, d]);
  }

  cyl(key: WbKey, cx: number, y: number, cz: number, r: number, h: number, segs = 24, solid = true, surf: Surface = 'metal') {
    const geo = new THREE.CylinderGeometry(r, r, h, segs, 1);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r / 4.0), uv.getY(i) * (h / 4.0));
    geo.translate(cx, y + h * 0.5, cz);
    this.push(key, geo);
    if (solid) {
      const hs = r * 0.84;
      this.world.addBox(cx, y + h * 0.5, cz, hs, h * 0.5, hs, 0, surf);
      this.world.addBox(cx, y + h * 0.5, cz, hs, h * 0.5, hs, Math.PI / 4, surf);
    }
  }

  pipe(key: WbKey, cx: number, cy: number, cz: number, r: number, len: number, axis: 'x' | 'z', solid = false) {
    const geo = new THREE.CylinderGeometry(r, r, len, 12, 1);
    if (axis === 'z') geo.rotateX(H);
    else geo.rotateZ(H);
    geo.translate(cx, cy, cz);
    this.push(key, geo);
    if (solid) {
      const w = axis === 'x' ? len : r * 2;
      const d = axis === 'z' ? len : r * 2;
      this.world.addBox(cx, cy, cz, w * 0.5, r, d * 0.5, 0, 'metal');
    }
  }

  /** Standard 20ft/40ft shipping container whitebox (W=2.6m, H=2.8m, L=6.4m or 12.2m). */
  container(cx: number, y: number, cz: number, len = 6.4, rotY = 0, stacks = 1, key: WbKey = 'container') {
    for (let i = 0; i < stacks; i++) {
      this.box(key, cx, y + i * 2.8, cz, 2.6, 2.8, len, { rotY, surf: 'metal', tile: 3.2 });
    }
  }

  /** Waist-high (1.12m) or chest-high (1.48m) tactical cover block. */
  cover(cx: number, y: number, cz: number, w: number, d: number, tall = false, rotY = 0) {
    this.box('cover', cx, y, cz, w, tall ? 1.48 : 1.12, d, { rotY, surf: 'metal', tile: 2.0 });
  }

  /** Continuous walkable staircase (<= 0.26m step rise for effortless player & AI traversal). */
  stairs(axis: 'x' | 'z', cCross: number, a0: number, a1: number, y0: number, y1: number, width: number, rails = true) {
    const dy = y1 - y0;
    const span = Math.abs(a1 - a0);
    const steps = Math.max(5, Math.ceil(Math.abs(dy) / 0.25));
    const da = (a1 - a0) / steps;
    const stepLen = span / steps + 0.10;
    const thick = 0.24;
    for (let i = 0; i < steps; i++) {
      const a = a0 + da * (i + 0.5);
      const topY = y0 + dy * ((i + 1) / steps);
      const cx = axis === 'x' ? a : cCross;
      const cz = axis === 'z' ? a : cCross;
      const w = axis === 'x' ? stepLen : width;
      const d = axis === 'z' ? stepLen : width;
      this.box('stair', cx, topY - thick, cz, w, thick, d, { surf: 'metal', tile: 2.0 });
      if (rails) {
        for (const side of [-1, 1]) {
          const rx = axis === 'x' ? a : cCross + side * (width * 0.5 - 0.06);
          const rz = axis === 'z' ? a : cCross + side * (width * 0.5 - 0.06);
          this.box('machinery', rx, topY, rz, axis === 'x' ? stepLen : 0.12, 0.20, axis === 'z' ? stepLen : 0.12, { surf: 'metal' });
          if (i % 4 === 0) this.box('machinery', rx, topY + 0.20, rz, 0.08, 0.80, 0.08, { solid: false });
        }
      }
    }
  }

  /** Elevated steel catwalk deck with optional open sides and solid chest railings. */
  catwalk(cx: number, y: number, cz: number, w: number, d: number, open: { n?: boolean; s?: boolean; e?: boolean; w?: boolean } = {}) {
    this.box('stair', cx, y - 0.24, cz, w, 0.24, d, { surf: 'metal', tile: 2.4 });
    const rh = 1.0, rt = 0.12;
    const rail = (rx: number, rz: number, rw: number, rd: number) => {
      this.box('machinery', rx, y, rz, rw, 0.18, rd, { surf: 'metal' });
      this.box('machinery', rx, y + rh - 0.10, rz, rw, 0.10, rd, { surf: 'metal' });
      this.world.addBox(rx, y + rh * 0.5, rz, rw * 0.5, rh * 0.5, rd * 0.5, 0, 'metal');
      const span = Math.max(rw, rd);
      const alongX = rw >= rd;
      const cnt = Math.max(2, Math.round(span / 3.4));
      for (let i = 0; i <= cnt; i++) {
        const off = -span * 0.5 + (i / cnt) * span;
        this.box('machinery', alongX ? rx + off : rx, y + 0.18, alongX ? rz : rz + off, 0.08, rh - 0.28, 0.08, { solid: false });
      }
    };
    if (!open.n) rail(cx, cz - d * 0.5 + rt * 0.5, w, rt);
    if (!open.s) rail(cx, cz + d * 0.5 - rt * 0.5, w, rt);
    if (!open.w) rail(cx - w * 0.5 + rt * 0.5, cz, rt, d);
    if (!open.e) rail(cx + w * 0.5 - rt * 0.5, cz, rt, d);
  }

  /** Wall segment along X or Z with doorway / window gaps. */
  wall(
    key: WbKey, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, h: number,
    t = 0.5, gaps: { at: number; w: number; h: number; sill?: number }[] = [],
  ) {
    const sorted = [...gaps].sort((p, q) => p.at - q.at);
    let cur = a0;
    const seg = (s0: number, s1: number, yy: number, hh: number) => {
      const len = s1 - s0;
      if (len < 0.05 || hh < 0.05) return;
      const mid = (s0 + s1) * 0.5;
      if (axis === 'x') this.box(key, mid, yy, c, len, hh, t);
      else this.box(key, c, yy, mid, t, hh, len);
    };
    for (const g of sorted) {
      const g0 = g.at - g.w * 0.5;
      const g1 = g.at + g.w * 0.5;
      seg(cur, g0, y0, h);
      const sill = g.sill ?? 0;
      if (sill > 0.05) seg(g0, g1, y0, sill);
      if (sill + g.h < h - 0.05) seg(g0, g1, y0 + sill + g.h, h - (sill + g.h));
      cur = g1;
    }
    seg(cur, a1, y0, h);
  }

  /** Raised physical blast-gate door frame (open during whitebox walkthrough so reviewer can explore all 6 zones freely!). */
  gateFrame(cx: number, y: number, cz: number, w: number, h: number, axis: 'x' | 'z' = 'x') {
    const t = 0.7;
    if (axis === 'x') {
      this.box('gate', cx - w * 0.5 - 0.35, y, cz, 0.7, h + 0.8, t + 0.3);
      this.box('gate', cx + w * 0.5 + 0.35, y, cz, 0.7, h + 0.8, t + 0.3);
      this.box('gate', cx, y + h, cz, w + 1.4, 0.9, t + 0.4); // Raised motorized door header
    } else {
      this.box('gate', cx, y, cz - w * 0.5 - 0.35, t + 0.3, h + 0.8, 0.7);
      this.box('gate', cx, y, cz + w * 0.5 + 0.35, t + 0.3, h + 0.8, 0.7);
      this.box('gate', cx, y + h, cz, t + 0.4, 0.9, w + 1.4);
    }
  }

  finalize(mats: Record<WbKey, THREE.Material>, group: THREE.Group) {
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[key]);
      mesh.castShadow = key !== 'deck' && key !== 'sea';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------
// Build Full 6-Zone 276m × 40m M/V Taishan Remake Whitebox (~30-Min Flow)
// ---------------------------------------------------------------------------
export function buildShipWhitebox(world: World): LevelData {
  // Enable below-deck Cargo Hold & Engine Room at Y = -6.0m!
  world.baseGroundY = -14;
  const group = new THREE.Group();
  const b = new ShipWhiteboxBuilder(world);
  const mats = makeWhiteboxPalette();

  // Bright clear architectural studio hemisphere fill so EVERY interior & below-deck space is crystal clear for review!
  const reviewHemi = new THREE.HemisphereLight(0xf6f9ff, 0x8ea0b5, 0.92);
  group.add(reviewHemi);

  const addSign = (title: string, sub: string, x: number, y: number, z: number, rotY = 0, accent = '#e2a83b') => {
    const s = makeZoneSign(title, sub, accent);
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    group.add(s);
  };

  // =========================================================================
  // 0. SOUTH CHINA SEA OCEAN PLANE & CONTINUOUS 276m SHIP HULL SHELL (ZERO INVISIBLE WALLS!)
  // =========================================================================
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), mats.sea);
  seaMesh.rotation.x = -H;
  seaMesh.position.y = -8.5;
  seaMesh.receiveShadow = true;
  group.add(seaMesh);

  // Port (X=-20.4) & Starboard (X=+20.4) Outer Hull Plating + 1.45m Raised Steel Bulwarks (Z: -136..+116)
  b.box('hull', -20.4, -8.5, -10, 0.9, 9.95, 252);
  b.box('hull',  20.4, -8.5, -10, 0.9, 9.95, 252);
  // Stern Transom Hull Wall (Z = -136.4)
  b.box('hull', 0, -8.5, -136.4, 41.6, 10.1, 0.9);
  // Tapered Ocean-Liner Bow Prow Hull Flanks (Z: +116..+138, converging sharply from X=±20 -> X=±3.8!)
  for (const s of [-1, 1]) {
    b.box('hull', s * 11.9, -8.5, 127.0, 0.9, 10.1, 27.4, { rotY: -s * 0.635 });
  }
  b.box('hull', 0, -8.5, 138.2, 8.2, 10.2, 0.9); // Flat bow stem cap

  // =========================================================================
  // ZONE 1: 船尾强降坪与暴雨集装箱迷阵 (Z: -136..-64, X: -20..+20, Y: 0.0 / +2.8)
  // =========================================================================
  b.box('deck', 0, -0.8, -100, 40, 0.8, 72, { road: true });
  // Stern Helo Drop Pad 'H' & Hovering Whitebox Z-20J Fast-Rope Silhouette
  b.cyl('cover', 0, 0.0, -124, 7.6, 0.14, 28, false);
  b.box('stair', -2.2, 0.15, -124, 0.7, 0.04, 5.2, { solid: false });
  b.box('stair',  2.2, 0.15, -124, 0.7, 0.04, 5.2, { solid: false });
  b.box('stair',  0.0, 0.15, -124, 4.4, 0.04, 0.7, { solid: false });
  // Hovering Z-20J insertion helicopter silhouette + twin fast-ropes
  b.box('machinery', 0, 13.5, -130, 2.8, 2.2, 10.5, { solid: false });
  b.box('machinery', 0, 14.1, -137.5, 0.9, 1.0, 6.2, { solid: false });
  b.box('stair', 0, 16.0, -130, 12.8, 0.12, 0.45, { solid: false });
  b.box('stair', 0, 16.0, -130, 0.45, 0.12, 12.8, { solid: false });
  b.cyl('stair', -1.8, 0.2, -127, 0.08, 13.4, 8, false);
  b.cyl('stair',  1.8, 0.2, -127, 0.08, 13.4, 8, false);

  // 3-Lane Tactical Container Maze (Z: -112..-72)
  // Lane A (Port High Lane, X: -16..-10): Walkable container-top overwatch route!
  b.container(-13.0, 0, -104, 7.0, 0, 1);
  b.container(-13.0, 0, -93,  7.0, 0, 1);
  b.container(-13.0, 0, -82,  7.0, 0, 1);
  b.catwalk(-13.0, 2.82, -98.5, 2.8, 4.4, { n: true, s: true });
  b.catwalk(-13.0, 2.82, -87.5, 2.8, 4.4, { n: true, s: true });
  b.stairs('z', -13.0, -114.5, -107.5, 0.0, 2.82, 2.6, true);
  b.stairs('z', -13.0, -78.5, -71.5, 2.82, 0.0, 2.6, true);
  b.cover(-11.8, 2.82, -93, 0.5, 3.8, false);
  b.cover(-11.8, 2.82, -82, 0.5, 3.8, false);

  // Lane B (Center Main Assault Alley, X: -8..+8): Staggered 1-high & 2-high containers + waist cover
  b.container(-5.8, 0, -106, 6.4, 0.08, 2);
  b.container( 6.0, 0, -102, 6.4, -0.06, 2);
  b.container(-6.5, 0, -92,  6.4, 0, 1);
  b.container( 5.5, 0, -88,  6.4, 0.1, 2);
  b.container(-5.5, 0, -78,  6.4, -0.08, 1);
  b.container( 6.8, 0, -76,  6.4, 0, 1);
  b.cover(0.0, 0, -110, 4.2, 1.0, false, 0.12);
  b.cover(-1.5, 0, -98, 3.8, 1.0, false, -0.1);
  b.cover(1.8, 0, -86, 4.0, 1.0, true, 0.08);
  // Objective #1: Heavy AA Machine-Gun Sandbag Nest defending Gate #1!
  b.cover(0, 0, -73.5, 6.5, 1.1, false);
  b.box('objective', 0, 0, -71.5, 2.4, 1.6, 2.4);

  // Lane C (Starboard Stealth Flank Lane, X: +11..+18.5): Pipe conduits + flanking cover
  b.container(13.2, 0, -104, 8.0, 0, 2);
  b.container(13.2, 0, -86,  8.0, 0, 2);
  b.pipe('machinery', 18.6, 0.7, -96, 0.45, 58, 'z', true);
  b.cover(16.2, 0, -96, 2.4, 1.0, false);
  b.cover(16.2, 0, -78, 2.4, 1.0, false);

  addSign('ZONE 1 · 船尾强降坪与集装箱迷阵（约 5 分钟）', '三路立体渗透：左舷箱顶狙击 / 中路突击 / 右舷潜行 ▶ 突破 01 号水密闸门', 0, 5.4, -65.2, Math.PI, '#e2a83b');

  // =========================================================================
  // ZONE 2: 三层舰桥上层建筑（1F 宿舍 · 2F 大餐厅 · 3F 全景舰桥）(Z: -64..-20)
  // =========================================================================
  // 1F Deck Slab (Y = 0.0, full 39m x 44m)
  b.box('deck', 0, -0.8, -42, 39.2, 0.8, 44, { road: true });
  // Outer Superstructure Bulkheads (1F + 2F + 3F = Y: 0.0..12.6)
  b.wall('wall', 'x', -64, -19.6, 19.6, 0, 12.6, 0.7, [
    { at: 0, w: 4.4, h: 3.4 },     // Main Gate #1
    { at: 13.5, w: 3.0, h: 3.0 },  // Starboard Flanking Hatch
  ]);
  b.gateFrame(0, 0, -64, 4.4, 3.4, 'x');
  b.gateFrame(13.5, 0, -64, 3.0, 3.0, 'x');

  // Forward Superstructure Wall at Z = -20 (Doorway into Zone 3 Catwalk at Y=0.0, panoramic Bridge windows on 3F!)
  b.wall('wall', 'x', -20, -19.6, 19.6, 0, 8.4, 0.7, [
    { at: 0, w: 5.2, h: 3.5 },     // Gate #2 -> Zone 3 Cargo Hold Catwalk!
  ]);
  b.gateFrame(0, 0, -20, 5.2, 3.5, 'x');
  // 3F Panoramic Bridge Forward Wall (Z = -20, Y = 8.4..12.6) with huge open panoramic windows!
  b.wall('wall', 'x', -20, -19.6, 19.6, 8.4, 4.2, 0.6, [
    { at: -11, w: 11.0, h: 2.2, sill: 1.15 },
    { at: 0,   w: 9.0,  h: 2.2, sill: 1.15 },
    { at: 11,  w: 11.0, h: 2.2, sill: 1.15 },
  ]);
  // Port & Starboard Superstructure Side Walls (X = ±19.4, with 3F Bridge Wing doorways!)
  b.wall('wall', 'z', -19.4, -64, -20, 0, 12.6, 0.6, [{ at: -32, w: 3.2, h: 3.0, sill: 8.4 }]);
  b.wall('wall', 'z',  19.4, -64, -20, 0, 12.6, 0.6, [{ at: -32, w: 3.2, h: 3.0, sill: 8.4 }]);

  // --- 1F Interior (Y = 0.0): Central Spine Corridor + Port/Starboard Crew Cabins ---
  b.wall('wall', 'z', -4.8, -63, -21, 0, 4.0, 0.4, [
    { at: -54, w: 2.8, h: 2.8 },
    { at: -42, w: 2.8, h: 2.8 },
    { at: -30, w: 2.8, h: 2.8 },
  ]);
  b.wall('wall', 'z', 4.8, -63, -21, 0, 4.0, 0.4, [
    { at: -54, w: 2.8, h: 2.8 },
    { at: -36, w: 3.6, h: 3.0 }, // Entry into East Stairwell Hall
  ]);
  // Cabin cross dividers (Port & Starboard)
  b.box('wall', -12.1, 0, -48, 14.2, 4.0, 0.4);
  b.box('wall', -12.1, 0, -36, 14.2, 4.0, 0.4);
  b.box('wall',  12.1, 0, -48, 14.2, 4.0, 0.4);
  // Cabin tactical cover & Hostage Rescue #1/#2 markers
  b.cover(-12, 0, -56, 3.2, 1.2, false);
  b.box('console', -15.5, 0, -42, 1.6, 1.6, 1.6); // Hostage Rescue #1
  b.box('console',  15.5, 0, -56, 1.6, 1.6, 1.6); // Hostage Rescue #2
  b.cover(0, 0, -46, 3.2, 1.0, false);

  // 1F -> 2F Wide Continuous Marine Staircase (X = +13.5, Z: -45 -> -31, Y: 0.0 -> +4.2)
  b.stairs('z', 13.5, -45, -31, 0.0, 4.2, 3.4, true);

  // --- 2F Deck Slab (Y = +4.2) with CLEAN Stairwell Cutout at X: +11.4..+15.6, Z: -46..-30 ---
  b.box('deck', -4.0, 3.85, -42, 30.8, 0.35, 43.2);          // West + Center 2F slab (X: -19.4..+11.4)
  b.box('deck', 17.5, 3.85, -42, 3.8, 0.35, 43.2);           // Far-East strip (X: +15.6..+19.4)
  b.box('deck', 13.5, 3.85, -55, 4.2, 0.35, 18.0);           // South of stair hole (Z: -64..-46)
  b.box('deck', 13.5, 3.85, -25, 4.2, 0.35, 10.0);           // North of stair hole (Z: -30..-20)

  // 2F Crew Mess Hall & Galley (Dual-Door Breach Arena! X: -19..+4.5, Z: -58..-26)
  b.wall('wall', 'z', 4.5, -58, -26, 4.2, 4.0, 0.45, [{ at: -42, w: 3.4, h: 3.0 }]); // Breach Door #1 (East)
  b.wall('wall', 'x', -26, -19, 4.5, 4.2, 4.0, 0.45, [{ at: -7.5, w: 3.4, h: 3.0 }]); // Breach Door #2 (North)
  b.box('wall', -7.2, 4.2, -58, 23.6, 4.0, 0.45);
  // Mess Hall Tables & Galley Island Cover + Captain/Hostage Rescue Zone
  for (const [tx, tz] of [[-4, -48], [-4, -36], [-12, -48], [-12, -36]]) b.cover(tx, 4.2, tz, 4.2, 1.4, false);
  b.box('console', -15.5, 4.2, -42, 2.2, 1.8, 3.0); // Captain & 4 Hostages Rescue Objective!
  addSign('2F 船员大餐厅 · 双门同步破门营救点', 'MESS HALL BREACH · 东门与北门协同突入营救船长', 4.1, 7.1, -42, H, '#36b6d4');

  // 2F -> 3F Wide Continuous Marine Staircase (X = +13.5, Z: -49 -> -61, Y: +4.2 -> +8.4)
  b.stairs('z', 13.5, -49, -61, 4.2, 8.4, 3.4, true);

  // --- 3F Bridge Deck Slab (Y = +8.4) with CLEAN Stairwell Cutout at X: +11.4..+15.6, Z: -61.2..-48 ---
  b.box('deck', -4.0, 8.05, -42, 30.8, 0.35, 43.2);          // West + Center 3F Bridge slab
  b.box('deck', 17.5, 8.05, -42, 3.8, 0.35, 43.2);           // Far-East strip
  b.box('deck', 13.5, 8.05, -34, 4.2, 0.35, 28.0);           // North of stair hole (Z: -48..-20)
  b.box('deck', 13.5, 8.05, -62.6, 4.2, 0.35, 2.8);          // Top stair landing (Z: -64..-61.2)
  // 3F Exterior Port & Starboard Bridge Wings (Scenic Overlook Wings jutting out to X = ±24m!)
  b.catwalk(-22.0, 8.4, -32, 5.2, 9.0, { e: true });
  b.catwalk( 22.0, 8.4, -32, 5.2, 9.0, { w: true });
  // 3F Bridge Helm Consoles & Encrypted Manifest Objective
  b.cover(-8, 8.4, -27, 5.0, 1.2, false);
  b.cover( 8, 8.4, -27, 5.0, 1.2, false);
  b.box('objective', 0, 8.4, -27, 3.4, 1.3, 1.8); // Bridge Helm & Encrypted Manifest Terminal!
  b.cover(0, 8.4, -38, 6.0, 1.2, false);
  // Sealed 3F Bridge Roof (Y = +12.6) + Iconic 24m Naval Radar & Comms Mast!
  b.box('wall', 0, 12.6, -42, 39.8, 0.45, 44.6);
  b.box('machinery', 0, 13.05, -42, 5.2, 5.0, 5.2, { solid: false });
  b.cyl('machinery', 0, 18.0, -42, 0.55, 6.8, 12, false);
  b.box('stair', 0, 22.8, -42, 8.8, 0.65, 0.55, { solid: false }); // Spinning radar bar silhouette
  // Twin iconic ship exhaust funnels behind bridge
  b.box('objective', -7.5, 13.05, -55, 4.2, 6.8, 6.2, { solid: false });
  b.box('objective',  7.5, 13.05, -55, 4.2, 6.8, 6.2, { solid: false });

  addSign('ZONE 2 ▶ ZONE 3 · 3 号巨型双层主货舱（约 6 分钟）', 'MAIN CARGO HOLD #3 · 穿出气密闸门沿双侧钢梯下探 14m 挑高舱底', 0, 4.9, -21.2, Math.PI, '#2f9e66');

  // =========================================================================
  // ZONE 3: 3 号巨型双层主货舱（14 米挑高垂直战场）(Z: -20..+36, Y: -6.0 Floor / 0.0 Catwalk)
  // =========================================================================
  // Deep Cargo Hold Floor at Y = -6.0m (full 40m x 56m)
  b.box('deck', 0, -6.8, 8, 40.0, 0.8, 56, { road: true });
  // Port & Starboard Upper Hold Coaming Walls (Y = 0.0..+6.8, open cargo hatch roof skyward!)
  b.box('hull', -19.8, -6.0, 8, 0.9, 13.0, 56);
  b.box('hull',  19.8, -6.0, 8, 0.9, 13.0, 56);
  // Overhead traveling Cargo Hold Bridge Crane spanning the 14m-tall hold at Y = +6.6m!
  b.box('stair', 0, 6.4, 8, 39.2, 1.2, 3.2, { solid: false });
  b.box('machinery', -3.5, 5.2, 8, 3.2, 1.2, 2.4, { solid: false });

  // Upper Perimeter Steel Catwalk Ring at Y = 0.0m (directly flush with Zone 2 Gate #2!)
  b.catwalk(0, 0.0, -17.0, 38.0, 5.4, { s: true, e: true, w: true });  // Aft entry balcony
  b.catwalk(-17.2, 0.0, 8.0, 3.6, 46.0, { n: true, s: true });          // Port sniper catwalk
  b.catwalk( 17.2, 0.0, 8.0, 3.6, 46.0, { n: true, s: true });          // Starboard sniper catwalk
  b.catwalk(0, 0.0, 33.2, 38.0, 4.4, { e: true, w: true });             // Forward crossover bridge

  // Twin Continuous Zig-Zag Industrial Staircases descending Y=0.0 -> -3.0 -> -6.0 (ZERO TELEPORTS!)
  // Port Descent (X = -13.6)
  b.stairs('z', -13.6, -14.0, -2.0, 0.0, -3.0, 3.2, true);
  b.catwalk(-13.6, -3.0, 0.2, 3.6, 4.4, { n: true, s: true });
  b.stairs('z', -13.6, 2.4, 14.4, -3.0, -6.0, 3.2, true);
  // Starboard Descent (X = +13.6)
  b.stairs('z',  13.6, -14.0, -2.0, 0.0, -3.0, 3.2, true);
  b.catwalk( 13.6, -3.0, 0.2, 3.6, 4.4, { n: true, s: true });
  b.stairs('z',  13.6, 2.4, 14.4, -3.0, -6.0, 3.2, true);

  // Lower Hold Floor (Y = -6.0) Multi-Lane Container Combat Arena
  b.container(-7.5, -6.0, -6.0,  7.0, 0, 2);
  b.container( 7.5, -6.0, -4.0,  7.0, 0, 2);
  b.container(-8.0, -6.0,  8.0,  7.0, 0.08, 2);
  b.container( 8.0, -6.0, 10.0,  7.0, -0.06, 2);
  b.container(-9.0, -6.0, 22.0,  6.5, 0, 1);
  b.container( 9.0, -6.0, 22.0,  6.5, 0, 1);
  b.cover(0, -6.0, -4.0, 4.5, 1.1, false);
  b.cover(0, -6.0,  8.0, 5.0, 1.2, true);
  b.cover(-4.5, -6.0, 16.5, 3.8, 1.1, false, 0.2);
  b.cover( 4.5, -6.0, 16.5, 3.8, 1.1, false, -0.2);

  // Objective #3: High-Value "Epsilon" Special Hazmat Container at (0, -6.0, +25)
  b.box('objective', -2.4, -6.0, 25.0, 0.4, 3.2, 8.4);
  b.box('objective',  2.4, -6.0, 25.0, 0.4, 3.2, 8.4);
  b.box('objective',  0.0, -2.8, 25.0, 5.2, 0.4, 8.4);
  b.box('objective',  0.0, -6.0, 29.0, 5.2, 3.2, 0.4);
  b.box('console',    0.0, -6.0, 27.6, 2.0, 1.2, 1.0); // Decryption laptop terminal inside container!

  // Zone 3 -> Zone 4 Forward Engine-Room Bulkhead Wall (Z = +36, Y = -6.0..+6.8)
  b.wall('wall', 'x', 36, -19.8, 19.8, -6.0, 12.8, 0.9, [
    { at: 0, w: 4.8, h: 3.6 },      // Gate #3 Main Engine-Room Door
    { at: -12.5, w: 3.0, h: 3.0 },  // Port Service Hatch
  ]);
  b.gateFrame(0, -6.0, 36, 4.8, 3.6, 'x');
  b.gateFrame(-12.5, -6.0, 36, 3.0, 3.0, 'x');
  addSign('ZONE 3 ▶ ZONE 4 · 深海主轮机舱（约 5 分钟）', 'MAIN ENGINE ROOM (-6.0m) · 双柴油主机大厅与抗沉阀门控制', 0, -1.2, 34.8, Math.PI, '#2f9e66');

  // =========================================================================
  // ZONE 4: 深海主轮机舱与双层柴油主机大厅 (Z: +36..+82, X: -19.8..+19.8, Y: -6.0 / -1.8)
  // =========================================================================
  b.box('deck', 0, -6.8, 59, 40.0, 0.8, 46, { road: true });
  b.box('wall', 0, 2.6, 59, 40.4, 0.7, 46.6); // Heavy enclosed engine-room deckhead ceiling (8.6m ceiling height!)
  b.box('hull', -19.8, -6.0, 59, 0.9, 9.0, 46);
  b.box('hull',  19.8, -6.0, 59, 0.9, 9.0, 46);

  // Twin Monumental 18m-Long Marine Diesel Engines (X = -8.8 and X = +8.8, Z: +48..+68)
  for (const sx of [-8.8, 8.8]) {
    b.box('machinery', sx, -6.0, 58, 5.4, 3.6, 20.0);          // Lower crankcase block
    b.box('machinery', sx, -2.4, 58, 3.8, 2.4, 18.0);          // Upper cylinder head bank
    for (let cz = 50; cz <= 66; cz += 4) {
      b.cyl('cover', sx, 0.0, cz, 0.72, 2.5, 12, false);       // Vertical exhaust risers up to deckhead
    }
    b.pipe('objective', sx * 0.67, -4.2, 58, 0.34, 19.6, 'z', false); // Fuel / cooling manifolds bolted flush along engine block
    for (const pz of [49, 58, 67]) b.box('machinery', sx * 0.67, -6.0, pz, 0.45, 1.8, 0.45, { solid: false }); // Grounded pipe saddles
  }
  // Central Turbine Spine Cover
  b.cover(0, -6.0, 46, 3.6, 1.1, false);
  b.cover(0, -6.0, 58, 4.0, 1.2, true);
  b.cover(0, -6.0, 70, 3.6, 1.1, false);

  // Mid-Level Engine Inspection Mezzanine Catwalks (Y = -1.8m)
  b.catwalk(-16.5, -1.8, 58, 5.2, 34, { n: true, s: true, e: true });
  b.catwalk( 16.5, -1.8, 58, 5.2, 34, { n: true, s: true, w: true });
  b.catwalk(0, -1.8, 42.5, 34.0, 3.6, { e: true, w: true });
  b.catwalk(0, -1.8, 73.5, 34.0, 3.6, { e: true, w: true });
  b.catwalk(0, -1.8, 58.0, 10.6, 3.2, { e: true, w: true }); // Mid-hall turbine bridge
  // Stairs up to -1.8m mezzanine on Aft & Forward sides
  b.stairs('z', -16.5, 37.5, 42.0, -6.0, -1.8, 3.0, true);
  b.stairs('z',  16.5, 79.5, 75.0, -6.0, -1.8, 3.0, true);

  // Zone 4 Dual Objectives: Emergency Power Control Room (East Mezzanine) & Bilge Flood Valve (NW Bilge)
  b.box('console',   17.4, -1.8, 58, 1.8, 1.6, 4.6); // Emergency Power Switchgear Console
  b.box('objective', -11.5, -6.0, 76, 2.4, 1.8, 2.4); // Bilge Hull-Breach Flood Valve Manifold
  // Engine Room Warm/Cool Tactical Interior Lighting so whitebox readability is crisp
  for (const [lx, lz] of [[-12, 44], [12, 44], [0, 58], [-12, 74], [12, 74]]) {
    const pt = new THREE.PointLight(0xd8ecff, 34, 42, 1.4);
    pt.position.set(lx, 1.4, lz);
    group.add(pt);
  }

  // Zone 4 -> Zone 5 Forward Bulkhead Wall & Gate #4 (Z = +82, Y = -6.0)
  b.wall('wall', 'x', 82, -19.8, 19.8, -6.0, 9.0, 0.9, [
    { at: 0, w: 5.2, h: 3.8 }, // Gate #4 -> Continuous Marine Ascent Shaft to Foredeck!
  ]);
  b.gateFrame(0, -6.0, 82, 5.2, 3.8, 'x');
  addSign('ZONE 4 ▶ ZONE 5 · 抗沉逃生阶梯 → 前甲板龙门吊区', 'ASCENT SHAFT (-6.0m → 0.0m) · 连续攀升重返前甲板（零瞬移）', 0, -1.0, 80.8, Math.PI, '#e2a83b');

  // =========================================================================
  // ZONE 4 -> ZONE 5 CONTINUOUS STRAIGHT MARINE ASCENT SHAFT (Z: +82..+92, X: -2.8..+2.8, Y: -6.0 -> 0.0)
  // =========================================================================
  b.box('deck', 0, -6.8, 87, 6.2, 0.8, 10.6); // Shaft bottom floor
  b.box('wall', -2.9, -6.0, 87, 0.6, 9.2, 10.4); // West companionway wall (rises to +3.2m weather hatch!)
  b.box('wall',  2.9, -6.0, 87, 0.6, 9.2, 10.4); // East companionway wall
  b.box('wall',  0.0,  3.1, 85.8, 6.4, 0.45, 7.6); // Weatherproof deck hatch roof above lower stair run
  // Straight continuous 4.8m-wide grand marine companionway staircase (-6.0 -> 0.0) emerging directly onto Zone 5 Foredeck!
  b.stairs('z', 0.0, 82.2, 92.2, -6.0, 0.0, 4.8, true);
  const shaftLight = new THREE.PointLight(0xffe0a8, 30, 22, 1.5);
  shaftLight.position.set(0, 1.8, 87);
  group.add(shaftLight);

  // =========================================================================
  // ZONE 5: 前甲板重型龙门吊与防空导弹驳运区 (Z: +82..+116, X: -20..+20, Y: 0.0 / +4.2 / +16.5)
  // =========================================================================
  // Foredeck Weather Floor (Y = 0.0) cleanly cut around the Ascent Shaft hatch (X: -2.8..+2.8, Z: +82..+92)!
  b.box('deck', -11.4, -0.8, 87, 17.2, 0.8, 10.2, { road: true }); // West of hatch
  b.box('deck',  11.4, -0.8, 87, 17.2, 0.8, 10.2, { road: true }); // East of hatch
  b.box('deck',   0.0, -0.8, 104, 40.0, 0.8, 24.0, { road: true }); // Main Foredeck (Z: +92..+116)

  // Twin Towering 18m Shipboard Heavy Gantry Cranes (Z = +98 and Z = +109)
  for (const gz of [98, 109]) {
    // Port & Starboard massive steel A-frame crane towers
    b.box('machinery', -16.8, 0, gz, 2.6, 17.5, 3.2);
    b.box('machinery',  16.8, 0, gz, 2.6, 17.5, 3.2);
    // Overhead 38m crane bridge girder spanning the full ship beam!
    b.box('stair', 0, 15.8, gz, 38.0, 2.2, 2.8, { solid: false });
    b.box('objective', gz === 98 ? -5.0 : 6.0, 13.5, gz, 4.2, 1.8, 3.2, { solid: false }); // Crane trolley cab
  }
  // Walkable +4.2m Gantry Operator Catwalk connecting both cranes on Port & Starboard
  b.catwalk(-14.0, 4.2, 103.5, 3.4, 16.5, { n: true, s: true });
  b.catwalk( 14.0, 4.2, 103.5, 3.4, 16.5, { n: true, s: true });
  b.stairs('z', -14.0, 88.5, 95.5, 0.0, 4.2, 2.8, true);
  b.stairs('z',  14.0, 88.5, 95.5, 0.0, 4.2, 2.8, true);
  b.cover(-12.6, 4.2, 103.5, 0.6, 5.0, false);
  b.cover( 12.6, 4.2, 103.5, 0.6, 5.0, false);

  // Foredeck Tactical Containers, Deck Cover & SAM Anti-Air Missile Battery Objective!
  b.container(-8.5, 0, 96, 6.4, 0.06, 1);
  b.container( 8.5, 0, 96, 6.4, -0.06, 1);
  b.container(-9.0, 0, 108, 6.4, 0, 2);
  b.container( 9.0, 0, 108, 6.4, 0, 2);
  b.cover(0, 0, 96.5, 5.2, 1.1, false);
  b.cover(-4.5, 0, 104, 1.2, 4.5, false);
  b.cover( 4.5, 0, 104, 1.2, 4.5, false);
  // Objective #5: Enemy SAM Launcher Battery blocking Z-20J extraction airspace!
  b.box('objective', 0, 0, 104, 3.4, 2.4, 3.8);
  b.box('objective', 0, 2.2, 105, 2.2, 1.2, 3.6, { rotY: 0.25 });

  // Zone 5 -> Zone 6 Bow Wave-Breaker Bulkhead & Blast Gate #5 (Z = +116)
  b.wall('wall', 'x', 116, -20.0, 20.0, 0, 4.8, 0.9, [
    { at: 0, w: 6.4, h: 3.8 }, // Gate #5 -> Bow Extraction Helipad!
  ]);
  b.gateFrame(0, 0, 116, 6.4, 3.8, 'x');
  addSign('ZONE 5 ▶ ZONE 6 · 船艏紧急撤离停机坪（约 4 分钟）', 'BOW EXTRACTION HELIPAD · 摧毁防空阵地后开启船艏闸门 · 终局死守', 0, 5.8, 114.8, Math.PI, '#d8564c');

  // =========================================================================
  // ZONE 6: 船艏撤离停机坪 · 终局死守 (Z: +116..+138, Tapered Forecastle Deck, Y: 0.0 / +1.2)
  // =========================================================================
  // Tapered Forecastle Deck slabs fitting cleanly inside the angled bow prow hull!
  b.box('deck', 0, -0.8, 121.0, 36.0, 0.8, 10.0, { road: true });
  b.box('deck', 0, -0.8, 129.0, 24.0, 0.8, 8.0,  { road: true });
  b.box('deck', 0, -0.8, 135.2, 13.0, 0.8, 5.4,  { road: true });

  // Raised Circular Bow Extraction Helipad (R=8.2m, Y=+1.2m at (0, 0, +125.5)) + Wide Access Ramp!
  b.cyl('cover', 0, 0.0, 125.5, 8.2, 1.2, 32, true, 'metal');
  b.stairs('z', 0, 115.6, 117.6, 0.0, 1.2, 5.4, false);
  b.box('stair', -2.4, 1.21, 125.5, 0.85, 0.04, 6.0, { solid: false });
  b.box('stair',  2.4, 1.21, 125.5, 0.85, 0.04, 6.0, { solid: false });
  b.box('stair',  0.0, 1.21, 125.5, 5.2,  0.04, 0.85, { solid: false });

  // 360° Defense Ring Cover, Anchor Windlasses & Forward Bow Jackstaff Mast
  b.cover(-8.8, 0, 121.5, 1.2, 6.5, false, 0.25);
  b.cover( 8.8, 0, 121.5, 1.2, 6.5, false, -0.25);
  b.cover(-10.5, 0, 126.5, 4.5, 1.2, true, 0.45);
  b.cover( 10.5, 0, 126.5, 4.5, 1.2, true, -0.45);
  b.box('machinery', -3.6, 0, 134.8, 2.2, 1.5, 2.4); // Port anchor windlass
  b.box('machinery',  3.6, 0, 134.8, 2.2, 1.5, 2.4); // Starboard anchor windlass
  b.cyl('stair', 0, 0, 137.0, 0.16, 7.5, 10, false); // Bow jackstaff mast
  b.box('machinery', -3.2, 0, 134.0, 0.26, 4.6, 0.26); // Grounded left sign stanchion
  b.box('machinery',  3.2, 0, 134.0, 0.26, 4.6, 0.26); // Grounded right sign stanchion
  addSign('ZONE 6 · 船艏 06 号撤离停机坪（海雕-1 接应点）', 'EXTRACTION ZONE · 360° 防浪掩体坚守 2 波反扑后登机撤离', 0, 4.6, 134.0, Math.PI, '#d8564c');

  // Finalize all batched whitebox meshes!
  b.finalize(mats, group);

  const map: MapInfo = {
    half: 146,
    roads: b.roads,
    ground: '#1b364d',
    road: '#7d8a98',
  };

  return {
    id: 'highseas',
    group,
    playerSpawn: { x: 0, z: -124, yaw: Math.PI },
    spawnPoints: [
      { x: 0, z: -124 }, { x: 0, z: -59 }, { x: 0, z: -16 },
      { x: 0, z: 40 }, { x: 0, z: 93 }, { x: 0, z: 120 },
    ],
    barrels: [],
    supplies: [],
    fires: [],
    plumes: [],
    bound: 142,
    map,
    targets: [],
    menuCamera(t, cam) {
      const a = t * 0.07;
      cam.position.set(Math.sin(a) * 115, 52, Math.cos(a) * 135);
      cam.lookAt(0, 4, 0);
    },
    update() {},
  };
}
