import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets, type PropName } from '../render/assets';
import type { LevelBuilder } from './build';
import { quad, type CampMats } from './camp';

const DEG = Math.PI / 180;
const H = Math.PI / 2;

export type AssetCategory = 'architecture' | 'tactical_cover' | 'dressing_and_decals' | 'lighting';

export interface AssetSpec {
  category: AssetCategory;
  /** Exact bounding box [width (X), height (Y), depth (Z)] in metres. */
  size: [number, number, number];
  /** Whether the local Y=0 origin sits at the TOP surface (true for floor/catwalk slabs) vs BOTTOM surface. */
  topOrigin?: boolean;
  /** Whether this asset is non-blocking (decals, pipes, overhead lights). */
  nonBlocking?: boolean;
}

/**
 * Modular Maritime Asset Catalog for M/V Taishan ("泰山号")
 * Valve Hammer / CS2 / COD Industrial Standard — every piece declares exact [W, H, D] bounds.
 */
export const ASSET_CATALOG: Record<string, AssetSpec> = {
  // --- Architecture (Strict 1.0m grid, 0/90/180/270 rot) ---
  Deck_Slab_28x54:      { category: 'architecture', size: [28, 0.4, 54], topOrigin: true },
  Deck_Slab_28x24:      { category: 'architecture', size: [28, 0.4, 24], topOrigin: true },
  Deck_Slab_28x16:      { category: 'architecture', size: [28, 0.4, 16], topOrigin: true },
  Deck_Slab_28x8:       { category: 'architecture', size: [28, 0.4, 8], topOrigin: true },
  Deck_Slab_28x64:      { category: 'architecture', size: [28, 0.4, 64], topOrigin: true },
  Deck_Slab_28x38:      { category: 'architecture', size: [28, 0.4, 38], topOrigin: true },
  Helipad_Deck_20x16:   { category: 'architecture', size: [20, 0.4, 16], topOrigin: true },
  Catwalk_Grate_4x28:   { category: 'architecture', size: [4, 0.2, 28], topOrigin: true },
  Catwalk_Grate_4x56:   { category: 'architecture', size: [4, 0.2, 56], topOrigin: true },
  Catwalk_Grate_28x4:   { category: 'architecture', size: [28, 0.2, 4], topOrigin: true },
  Catwalk_Overpass_24x3:{ category: 'architecture', size: [14, 0.22, 3], topOrigin: true },
  Walkway_Plank_2x4:    { category: 'architecture', size: [2, 0.16, 4], topOrigin: true },
  Bulwark_Wall_8m:      { category: 'architecture', size: [0.4, 1.2, 8] },
  Bulwark_Wall_6m:      { category: 'architecture', size: [0.4, 1.2, 6] },
  Wall_Bulkhead_4m:     { category: 'architecture', size: [3.6, 3.6, 0.4] },
  Wall_Hold_4m:         { category: 'architecture', size: [3.6, 6.0, 0.4] },
  Wall_Window_4m:       { category: 'architecture', size: [3.6, 3.6, 0.4] },
  DoorFrame_Watertight: { category: 'architecture', size: [3.6, 3.6, 0.4] },
  DoorFrame_Cabin:      { category: 'architecture', size: [3.6, 3.6, 0.4] },
  Pillar:               { category: 'architecture', size: [0.4, 3.6, 0.4] },
  Pillar_Hold:          { category: 'architecture', size: [0.4, 6.0, 0.4] },
  Pipe_Bundle:          { category: 'architecture', size: [3.6, 0.35, 0.35], nonBlocking: true },
  Stair_Gantry_2x6:     { category: 'architecture', size: [2, 2.6, 6] },
  Stair_Steel_3x6:      { category: 'architecture', size: [3, 3.6, 6] },
  Stair_Hold_3x12:      { category: 'architecture', size: [3, 6.0, 12] },
  Ramp_Helipad_6x8:     { category: 'architecture', size: [6, 2.0, 8] },
  Gantry_Arch_28m:      { category: 'architecture', size: [28, 8.8, 1.2], nonBlocking: true },
  Cargo_Crane_Tower:    { category: 'architecture', size: [3.4, 14.5, 3.4] },
  Hold_Bridge_Crane:    { category: 'architecture', size: [26, 2.2, 2.4], nonBlocking: true },

  // --- Tactical Cover (Crouch = 1.1m, Full Standing >= 2.4m) ---
  Container_20ft:       { category: 'tactical_cover', size: [2.4, 2.6, 6.0] },
  Container_40ft:       { category: 'tactical_cover', size: [2.4, 2.6, 12.0] },
  Container_20ft_Spec:  { category: 'tactical_cover', size: [2.4, 2.6, 6.0] },
  Cover_Crate_Low:      { category: 'tactical_cover', size: [1.6, 1.1, 1.2] },
  Cover_Barricade_Low:  { category: 'tactical_cover', size: [2.0, 1.1, 0.8] },
  Cover_Winch_Low:      { category: 'tactical_cover', size: [2.2, 1.1, 1.6] },
  Cover_Table_Steel:    { category: 'tactical_cover', size: [2.2, 1.1, 1.0] },
  Cover_Console_Bridge: { category: 'tactical_cover', size: [4.0, 1.1, 1.2] },
  Bridge_Helm_Station:  { category: 'tactical_cover', size: [6.0, 1.25, 1.5] },
  Galley_Counter:       { category: 'tactical_cover', size: [4.0, 1.1, 1.0] },
  Bunk_Bed_Marine:      { category: 'tactical_cover', size: [2.0, 2.0, 0.95] },
  Locker_Bank:          { category: 'tactical_cover', size: [2.4, 2.1, 0.6] },
  Server_Rack_Bank:     { category: 'tactical_cover', size: [0.85, 2.1, 0.95] },
  Mooring_Bollard:      { category: 'tactical_cover', size: [1.3, 0.85, 0.65] },
  Cover_CableReel:      { category: 'tactical_cover', size: [1.25, 1.15, 0.9] },
  Cover_Forklift:       { category: 'tactical_cover', size: [1.6, 2.1, 3.0] },

  // --- Dressing & Decals (Clustered 2-3 per group hugging walls/containers, +/-15 deg) ---
  Prop_Barrel:          { category: 'dressing_and_decals', size: [0.65, 0.95, 0.65] },
  Prop_WoodCrate:       { category: 'dressing_and_decals', size: [0.85, 0.8, 0.85] },
  Prop_Toolbox:         { category: 'dressing_and_decals', size: [0.7, 0.6, 0.45] },
  Prop_Jerrycan:        { category: 'dressing_and_decals', size: [0.4, 0.5, 0.25] },
  Prop_Welder:          { category: 'dressing_and_decals', size: [0.75, 0.9, 0.6] },
  Prop_PropaneTank:     { category: 'dressing_and_decals', size: [0.45, 1.1, 0.45] },
  Prop_Lifeboat:        { category: 'dressing_and_decals', size: [2.4, 2.2, 6.0] },
  Decal_HazardStripe:   { category: 'dressing_and_decals', size: [3.0, 0.02, 0.6], nonBlocking: true },
  Decal_OilSpill:       { category: 'dressing_and_decals', size: [2.2, 0.02, 1.8], nonBlocking: true },

  // --- CS:GO Visual Guidance Lighting ---
  Light_Cool:           { category: 'lighting', size: [0.6, 0.25, 0.6], nonBlocking: true },
  Light_Warm:           { category: 'lighting', size: [0.5, 0.3, 0.5], nonBlocking: true },
  Exit_Sign:            { category: 'lighting', size: [0.7, 0.3, 0.12], nonBlocking: true },
};

export interface LayoutItem {
  id: string;
  asset: string;
  zone: 'A' | 'B' | 'C' | 'D';
  pos: [number, number, number];
  /** Yaw rotation in degrees (architecture strictly 0/90/180/270). */
  rot: number;
  color?: string;
  cluster?: string;
  note?: string;
}

export interface LightItem extends LayoutItem {
  intensity?: number;
  distance?: number;
}

export interface ShipLayoutJSON {
  meta: {
    level: string;
    grid: number;
    floors: Record<string, number>;
  };
  architecture: LayoutItem[];
  tactical_cover: LayoutItem[];
  dressing_and_decals: LayoutItem[];
  lighting: LightItem[];
}

function parseHex(c: string | undefined, fallback: number): number {
  if (!c) return fallback;
  return parseInt(c.replace('#', ''), 16);
}

/** Place a baked photo-scanned GLB prop scaled to exact catalog [w, h, d] bounds. */
function placeFitGLB(
  b: LevelBuilder,
  propName: PropName,
  x: number,
  y: number,
  z: number,
  rotRad: number,
  size: [number, number, number],
  color: number,
  collide = true,
  surface: 'metal' | 'wood' | 'concrete' = 'metal',
) {
  const prop = assets.props[propName];
  if (prop) {
    const sx = size[0] / Math.max(0.05, prop.size.x);
    const sy = size[1] / Math.max(0.05, prop.size.y);
    const sz = size[2] / Math.max(0.05, prop.size.z);
    b.model(propName, x, y, z, rotRad, { scale: { x: sx, y: sy, z: sz }, color });
  } else {
    b.box('metal', x, y, z, size[0], size[1], size[2], { rot: rotRad, color, collide: false });
  }
  if (collide) {
    b.solid(x, y, z, size[0], size[1], size[2], rotRad, surface, true);
  }
}

/** Helper to transform local offsets (lx, ly, lz) around (x, y, z) by yaw rotRad. */
function xf(x: number, y: number, z: number, rotRad: number, lx: number, ly: number, lz: number): [number, number, number] {
  const c = Math.cos(rotRad), s = Math.sin(rotRad);
  return [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
}

/** Build a 3-tier industrial maritime bulkhead panel (baseboard + main corrugated/ribbed wall + top cornice). */
function buildTieredWall(
  b: LevelBuilder,
  x: number,
  y: number,
  z: number,
  rotRad: number,
  w: number,
  h: number,
  t: number,
  baseCol: number,
  mat: 'plaster' | 'metal' | 'corrugated' = 'plaster',
) {
  // Tier 1: Heavy bolted dark steel kickplate baseboard (0..0.42m)
  b.box('darkmetal', x, y, z, w, 0.42, t + 0.04, { rot: rotRad, color: 0x2a333d, collide: false });
  // Tier 2: Main bulkhead body (0.42..h-0.42)
  b.box(mat, x, y + 0.42, z, w, h - 0.84, t, { rot: rotRad, color: baseCol, collide: false, absGrime: true });
  // Tier 3: Upper structural frieze header & horizontal steel rub-rail
  b.box('darkmetal', x, y + h - 0.42, z, w, 0.42, t + 0.04, { rot: rotRad, color: 0x323d49, collide: false });
  b.box('metal', x, y + 1.15, z, w, 0.08, t + 0.06, { rot: rotRad, color: 0x46525e, collide: false });
  // Single clean physics collider for the full wall panel
  b.solid(x, y, z, w, h, t, rotRad, 'metal', true);
}

/** Build a detailed flanged structural steel H-beam Pillar with baseplate & hazard collar. */
function buildPillar(b: LevelBuilder, x: number, y: number, z: number, rotRad: number, w: number, h: number) {
  // Bolted steel floor baseplate
  b.box('darkmetal', x, y, z, w + 0.14, 0.1, w + 0.14, { rot: rotRad, color: 0x202830, collide: false });
  // Hazard yellow-amber base collar (0.1..0.38m)
  b.box('metal', x, y + 0.1, z, w + 0.03, 0.28, w + 0.03, { rot: rotRad, color: 0xc28a24, collide: false });
  // Two flanged faces + recessed inner web (true H-section profile)
  const [f1x, f1y, f1z] = xf(x, y, z, rotRad, 0, 0.38, w * 0.38);
  const [f2x, f2y, f2z] = xf(x, y, z, rotRad, 0, 0.38, -w * 0.38);
  b.box('darkmetal', f1x, f1y, f1z, w, h - 0.48, w * 0.24, { rot: rotRad, color: 0x34404d, collide: false });
  b.box('darkmetal', f2x, f2y, f2z, w, h - 0.48, w * 0.24, { rot: rotRad, color: 0x34404d, collide: false });
  b.box('metal', x, y + 0.38, z, w * 0.26, h - 0.48, w * 0.62, { rot: rotRad, color: 0x27313b, collide: false });
  // Top gusset cap
  b.box('darkmetal', x, y + h - 0.12, z, w + 0.12, 0.12, w + 0.12, { rot: rotRad, color: 0x222a33, collide: false });
  b.solid(x, y, z, w, h, w, rotRad, 'metal', true);
}

/** Build a 3-conduit flanged marine Pipe_Bundle (fire-main red, brass hydraulic, galvanized steam + wall clamps). */
function buildPipeBundle(b: LevelBuilder, x: number, y: number, z: number, rotRad: number, len: number) {
  const half = len * 0.5;
  // Offset +0.28m along local +Z so the bundle hugs the interior bulkhead face cleanly without wall clipping
  const zOff = 0.28;
  const pipes: [number, number, number, number][] = [
    [0.11, zOff, 0.055, 0x9e342a],        // Top red fire-main pipe
    [0.0,  zOff + 0.03, 0.04, 0xa88a46],  // Mid brass hydraulic conduit
    [-0.1, zOff, 0.048, 0x62707c],        // Bottom galvanized steam pipe
  ];
  for (const [py, pz, r, col] of pipes) {
    const [ax, ay, az] = xf(x, y, z, rotRad, -half, py, pz);
    const [bx, by, bz] = xf(x, y, z, rotRad, half, py, pz);
    b.tube('metal', new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), r, col, 8);
  }
  // Steel pipe-clamp brackets every 2m anchoring back to the bulkhead
  const clamps = Math.max(2, Math.round(len / 2));
  for (let i = 0; i < clamps; i++) {
    const lx = -half + (i + 0.5) * (len / clamps);
    const [cx, cy, cz] = xf(x, y, z, rotRad, lx, -0.15, zOff - 0.06);
    b.box('darkmetal', cx, cy, cz, 0.09, 0.34, 0.22, { rot: rotRad, color: 0x242c34, collide: false });
  }
}

/** Build a 4m-bay (3.6m infill) bulkhead module with either a clear doorway or viewing window cutout. */
function buildPortalModule(
  b: LevelBuilder,
  x: number,
  y: number,
  z: number,
  rotRad: number,
  openW: number,
  openY0: number,
  openY1: number,
  col: number,
  heavyWatertight: boolean,
) {
  const totalW = 3.6;
  const h = 3.6;
  const t = 0.4;
  const sideW = (totalW - openW) * 0.5;
  // Left & right structural jamb pillars + protruding 0.12m recessed frame casing
  for (const s of [-1, 1]) {
    const lx = s * (openW * 0.5 + sideW * 0.5);
    const [px, py, pz] = xf(x, y, z, rotRad, lx, 0, 0);
    buildTieredWall(b, px, py, pz, rotRad, sideW, h, t, col, 'plaster');
    // Protruding 0.12m heavy steel frame jamb casing (front & back bevel collar)
    const [jx, jy, jz] = xf(x, y, z, rotRad, s * (openW * 0.5 + 0.06), openY0, 0);
    b.box('darkmetal', jx, jy, jz, 0.14, openY1 - openY0, t + 0.24, { rot: rotRad, color: heavyWatertight ? 0x263340 : 0x364452, collide: false });
  }
  // Overhead lintel header + protruding 0.12m structural steel header beam
  const headH = h - openY1;
  if (headH > 0.05) {
    b.box('plaster', x, y + openY1, z, openW, headH, t, { rot: rotRad, color: col, absGrime: true });
    b.box('darkmetal', x, y + openY1, z, openW + 0.26, 0.16, t + 0.24, { rot: rotRad, color: 0x25303b, collide: false });
  }
  // Bottom sill (for windows) or protruding marine threshold coaming lip (for doorways)
  if (openY0 > 0.05) {
    b.box('plaster', x, y, z, openW, openY0, t, { rot: rotRad, color: col, absGrime: true });
    b.box('darkmetal', x, y + openY0 - 0.1, z, openW + 0.24, 0.12, t + 0.24, { rot: rotRad, color: 0x313e4b, collide: false });
  } else {
    b.box('darkmetal', x, y, z, openW + 0.22, heavyWatertight ? 0.1 : 0.05, t + 0.22, { rot: rotRad, color: heavyWatertight ? 0xc2922a : 0x3b4754, collide: false });
  }
}

export interface VirtualLight {
  id: string;
  pos: THREE.Vector3;
  color: number;
  intensity: number;
  baseIntensity: number;
  distance: number;
  decay: number;
  kind: 'main' | 'exit' | 'alarm';
}

export interface ImportedLights {
  virtualLights: VirtualLight[];
}

/**
 * AAA Fresnel + Vertical-Feathered Volumetric Light Cone Shader:
 * Softly fades grazing cone edges AND top/bottom ends to 0 alpha so light shafts read as
 * silky atmospheric mist with ZERO hard polygonal triangle edges.
 */
function makeVolumetricConeMat(hex: number, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(hex) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        // Soft Fresnel falloff at silhouette edges + smooth vertical mist feather at top & bottom
        float edge = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.35);
        float vert = smoothstep(0.0, 0.58, vUv.y) * smoothstep(1.0, 0.84, vUv.y);
        float a = edge * vert * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Direct Engine Importer for `shipLayout.json`.
 * Instantiates every modular architecture piece, tactical cover, clustered dressing prop,
 * decal, and CS:GO guidance light strictly from `ASSET_CATALOG`.
 */
export function importShipLayout(
  b: LevelBuilder,
  cm: CampMats,
  layout: ShipLayoutJSON,
  extras: THREE.Object3D[],
  lightsOut: ImportedLights,
) {
  const zoneRegion = (z: LayoutItem['zone']) => (z === 'A' ? 'se' : z === 'B' ? 'ne' : z === 'C' ? 'nw' : 'sw');

  // Shared emissive & Fresnel-feathered volumetric cone materials for CS:GO guidance fixtures
  const coolLensMat = new THREE.MeshBasicMaterial({ color: 0x9ed2ff });
  const warmLensMat = new THREE.MeshBasicMaterial({ color: 0xffcf78 });
  const exitFaceMat = new THREE.MeshBasicMaterial({ color: 0x32ff88 });
  const hazardMat = new THREE.MeshBasicMaterial({ color: 0xe0aa2c });
  const oilMat = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.1, metalness: 0.58, transparent: true, opacity: 0.78 });
  const warmConeMat = makeVolumetricConeMat(0xffb44c, 0.15);
  const coolConeMat = makeVolumetricConeMat(0x7cb8f0, 0.095);
  const beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xff2c20 });
  const screenCyanMat = new THREE.MeshBasicMaterial({ color: 0x38e4ff });
  const serverAmberMat = new THREE.MeshBasicMaterial({ color: 0xffaa28 });

  // -------------------------------------------------------------------------
  // 1. ARCHITECTURE
  // -------------------------------------------------------------------------
  for (const item of layout.architecture) {
    const spec = ASSET_CATALOG[item.asset];
    if (!spec) continue;
    b.region = zoneRegion(item.zone);
    const [x, y, z] = item.pos;
    const rotRad = item.rot * DEG;
    const [w, h, d] = spec.size;
    const col = parseHex(item.color, 0x303a44);

    switch (item.asset) {
      case 'Deck_Slab_28x54':
      case 'Deck_Slab_28x24':
      case 'Deck_Slab_28x16':
      case 'Deck_Slab_28x8':
      case 'Deck_Slab_28x64':
      case 'Deck_Slab_28x38': {
        // Special cutout handling + 3-sided industrial safety stair railings for Zone B 2F & 3F stairwells!
        if (item.id === 'b_2f_deck') {
          b.slab('concrete', x - w / 2, x + w / 2, z - d / 2, z + d / 2, y - h, h, col, { x0: 6.4, x1: 9.6, z0: -25.1, z1: -19.1 });
          b.shadows = false;
          // 3-sided safety stair guardrails & yellow toe-boards (West x=6.4, East x=9.6, South z=-25.1; North z=-19.1 open landing!)
          b.deco('metal', 6.36, y, -22.1, 0.08, 0.14, 6.08, { color: 0xc89626 });
          b.deco('metal', 9.64, y, -22.1, 0.08, 0.14, 6.08, { color: 0xc89626 });
          b.deco('metal', 8.0,  y, -25.14, 3.36, 0.14, 0.08, { color: 0xc89626 });
          for (const rz of [-23.6, -20.6]) {
            b.model('railing', 6.36, y, rz, H, { scale: { x: 0.74, y: 0.88, z: 1 } });
            b.model('railing', 9.64, y, rz, H, { scale: { x: 0.74, y: 0.88, z: 1 } });
          }
          b.model('railing', 8.0, y, -25.14, 0, { scale: { x: 0.82, y: 0.88, z: 1 } });
          b.shadows = true;
        } else if (item.id === 'b_3f_deck') {
          b.slab('concrete', x - w / 2, x + w / 2, z - d / 2, z + d / 2, y - h, h, col, { x0: 9.4, x1: 12.6, z0: -34.1, z1: -28.1 });
          b.shadows = false;
          b.deco('metal', 9.36, y, -31.1, 0.08, 0.14, 6.08, { color: 0xc89626 });
          b.deco('metal', 12.64, y, -31.1, 0.08, 0.14, 6.08, { color: 0xc89626 });
          b.deco('metal', 11.0, y, -34.14, 3.36, 0.14, 0.08, { color: 0xc89626 });
          for (const rz of [-32.6, -29.6]) {
            b.model('railing', 9.36, y, rz, H, { scale: { x: 0.74, y: 0.88, z: 1 } });
            b.model('railing', 12.64, y, rz, H, { scale: { x: 0.74, y: 0.88, z: 1 } });
          }
          b.model('railing', 11.0, y, -34.14, 0, { scale: { x: 0.82, y: 0.88, z: 1 } });
          b.shadows = true;
        } else {
          b.box('asphalt', x, y - h, z, w, h, d, { rot: rotRad, color: col, surface: 'metal', grime: 0.88 });
        }
        break;
      }
      case 'Helipad_Deck_20x16': {
        b.box('asphalt', x, y - h, z, w, h, d, { rot: rotRad, color: 0x26303a, surface: 'metal' });
        // Crisp painted yellow H landing circle + perimeter LED deck markers
        const ringGeo = new THREE.RingGeometry(5.1, 5.45, 48);
        ringGeo.rotateX(-H);
        const ring = new THREE.Mesh(ringGeo, hazardMat);
        ring.position.set(x, y + 0.025, z);
        extras.push(ring);
        const hParts: [number, number, number, number][] = [
          [-1.5, 0, 0.52, 4.4],
          [1.5, 0, 0.52, 4.4],
          [0, 0, 3.0, 0.52],
        ];
        for (const [hx, hz, hw, hd] of hParts) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(hw, hd), hazardMat);
          m.rotation.x = -H;
          m.position.set(x + hx, y + 0.028, z + hz);
          extras.push(m);
        }
        for (const lx of [-8.8, -3, 3, 8.8]) {
          for (const lz of [-6.8, 6.8]) {
            const led = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 8), exitFaceMat);
            led.position.set(x + lx, y + 0.04, z + lz);
            extras.push(led);
          }
        }
        break;
      }
      case 'Catwalk_Grate_4x28':
      case 'Catwalk_Grate_4x56':
      case 'Catwalk_Grate_28x4': {
        // Leave an open 12m stairwell cutout (z = 30..42) on Zone C starboard catwalk for `c_stair_exit`!
        const effD = item.id === 'c_cat_e' ? 44 : d;
        const effZ = item.id === 'c_cat_e' ? 8 : z;
        b.box('metal', x, y - h, effZ, w, h, effD, { rot: rotRad, color: 0x323f4c, surface: 'metal' });
        // Railings receive shadows cleanly without burning 160k shadow-map triangles
        b.shadows = false;
        const isLongZ = effD >= w && (item.rot === 0 || item.rot === 180);
        if (isLongZ) {
          const railSide = x < 0 ? w * 0.5 - 0.1 : -(w * 0.5 - 0.1);
          b.deco('metal', x + railSide, y, effZ, 0.08, 0.14, effD, { color: 0xc2922a });
          for (let rz = effZ - effD * 0.5 + 2.2; rz <= effZ + effD * 0.5 - 2.0; rz += 4.2) {
            if (item.id === 'a_catwalk_fix' && Math.abs(rz + 64) < 2.2) continue; // open access onto Zone A cross-deck skybridge!
            b.model('railing', x + railSide, y, rz, H, { scale: { x: 1.0, y: 0.85, z: 1 } });
          }
        } else {
          const railSide = z < 0 ? d * 0.5 - 0.1 : -(d * 0.5 - 0.1);
          b.deco('metal', x, y, z + railSide, w, 0.14, 0.08, { color: 0xc2922a });
          for (let rx = x - w * 0.5 + 3.0; rx <= x + w * 0.5 - 3.0; rx += 4.8) {
            if (Math.abs(rx) > 5.5 && Math.abs(rx) < 10.0 && z < 0) continue; // clear dual descending stairs at x = +/-8!
            if (rx > 9.5 && z > 0) continue; // clear emergency exit stair arrival at x = +12!
            b.model('railing', rx, y, z + railSide, 0, { scale: { x: 1.05, y: 0.85, z: 1 } });
          }
        }
        b.shadows = true;
        break;
      }
      case 'Catwalk_Overpass_24x3': {
        // Elevated cross-deck steel skybridge overpass spanning the container canyon!
        b.box('metal', x, y - h, z, w, h, d, { rot: rotRad, color: 0x323f4c, surface: 'metal' });
        b.shadows = false;
        // Yellow safety toe-boards + twin side handrails along the bridge span
        for (const sz of [-d * 0.5 + 0.08, d * 0.5 - 0.08]) {
          b.deco('metal', x, y, z + sz, w - 0.6, 0.14, 0.08, { color: 0xc2922a });
          for (let rx = x - w * 0.5 + 2.4; rx <= x + w * 0.5 - 2.4; rx += 4.2) {
            b.model('railing', rx, y, z + sz, 0, { scale: { x: 1.0, y: 0.84, z: 1 } });
          }
        }
        // Under-bridge steel truss girders + diagonal bracing struts
        for (const sz of [-d * 0.42, d * 0.42]) {
          b.deco('darkmetal', x, y - 0.58, z + sz, w - 0.4, 0.32, 0.16, { color: 0x222c36 });
        }
        b.shadows = true;
        break;
      }
      case 'Walkway_Plank_2x4': {
        // Grated steel cargo gangplank linking elevated container tops
        b.box('metal', x, y - h, z, w, h, d, { rot: rotRad, color: 0x3c4a58, surface: 'metal' });
        b.shadows = false;
        for (const sx of [-w * 0.46, w * 0.46]) {
          const [kx, ky, kz] = xf(x, y, z, rotRad, sx, 0, 0);
          b.box('metal', kx, ky, kz, 0.09, 0.12, d, { rot: rotRad, color: 0xd09a26, collide: false });
        }
        b.shadows = true;
        break;
      }
      case 'Cargo_Crane_Tower': {
        // Towering AAA Maritime Pedestal Deck Crane: octagonal steel column, turret cabin, angled lattice boom & hanging hook!
        b.cyl('metal', x, y, z, 1.35, 6.2, col, { segs: 10 });
        b.box('darkmetal', x, y, z, 3.2, 0.45, 3.2, { color: 0x222b34, surface: 'metal' });
        // Rotating crane machinery house & glazed operator cab
        const [cx, cy, cz] = xf(x, y, z, rotRad, 0, 6.2, 0.35);
        b.box('metal', cx, cy, cz, 2.8, 2.6, 3.8, { rot: rotRad, color: col, collide: false });
        const [cabx, caby, cabz] = xf(x, y, z, rotRad, 1.55, 6.4, 1.0);
        b.box('darkmetal', cabx, caby, cabz, 0.95, 1.85, 1.6, { rot: rotRad, color: 0x1c252e, collide: false });
        b.shadows = false;
        // 16m angled steel lattice jib boom reaching boldly out across the ship deck!
        const [b0x, b0y, b0z] = xf(x, y, z, rotRad, 0, 8.2, 1.8);
        const [b1x, b1y, b1z] = xf(x, y, z, rotRad, 0, 15.6, 15.2);
        for (const side of [-0.55, 0.55]) {
          const [s0x, s0y, s0z] = xf(x, y, z, rotRad, side, 8.0, 1.8);
          const [s1x, s1y, s1z] = xf(x, y, z, rotRad, side * 0.5, 15.4, 15.2);
          b.tube('metal', new THREE.Vector3(s0x, s0y, s0z), new THREE.Vector3(s1x, s1y, s1z), 0.14, col, 6);
        }
        b.tube('darkmetal', new THREE.Vector3(b0x, b0y + 0.8, b0z), new THREE.Vector3(b1x, b1y + 0.5, b1z), 0.12, 0x262e36, 6);
        // Tension cables from turret mast to boom tip + hanging cargo hoist cable
        const [mx, my, mz] = xf(x, y, z, rotRad, 0, 11.4, -0.8);
        b.tube('darkmetal', new THREE.Vector3(x, y + 8.6, z), new THREE.Vector3(mx, my, mz), 0.24, 0x2a333d, 6);
        b.tube('darkmetal', new THREE.Vector3(mx, my, mz), new THREE.Vector3(b1x, b1y + 0.4, b1z), 0.045, 0x1c2228, 5);
        b.tube('darkmetal', new THREE.Vector3(b1x, b1y, b1z), new THREE.Vector3(b1x, b1y - 5.2, b1z), 0.045, 0x1c2228, 5);
        b.box('metal', b1x, b1y - 5.6, b1z, 0.72, 0.65, 0.48, { color: 0xdca428, collide: false });
        // Red aviation obstruction beacon on mast peak + boom floodlight
        const bcn = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), beaconRedMat);
        bcn.position.set(b1x, b1y + 0.8, b1z);
        extras.push(bcn);
        const coneGeo = new THREE.ConeGeometry(4.4, 9.5, 12, 1, true);
        coneGeo.translate(0, -4.75, 0);
        const cone = new THREE.Mesh(coneGeo, coolConeMat);
        cone.position.set(b1x, b1y - 0.4, b1z);
        extras.push(cone);
        b.shadows = true;
        break;
      }
      case 'Hold_Bridge_Crane': {
        // Massive Yellow Industrial Overhead Traveling Bridge Crane inside Zone C 14m Cargo Hold + Suspended Mid-Air Container!
        b.shadows = false;
        for (const sz of [-0.95, 0.95]) {
          b.deco('metal', x, y, z + sz, w, 1.05, 0.46, { color: 0xc89220 });
          b.deco('darkmetal', x, y + 0.92, z + sz, w, 0.16, 0.56, { color: 0x262e36 });
        }
        // Central crane hoist trolley + yellow spreader bar + 4 steel cables holding a suspended container in mid-air!
        b.deco('darkmetal', x - 1.5, y - 0.55, z, 3.4, 0.85, 2.5, { color: 0x242c34 });
        b.deco('metal', x - 1.5, y - 3.65, z, 2.5, 0.28, 6.1, { color: 0xdca428 });
        for (const ox of [-1.1, 1.1]) {
          for (const oz of [-2.4, 2.4]) {
            b.tube('darkmetal', new THREE.Vector3(x - 1.5 + ox * 0.7, y - 0.5, z + oz * 0.4), new THREE.Vector3(x - 1.5 + ox, y - 3.6, z + oz), 0.04, 0x1d2329, 5);
          }
        }
        // Dangling mid-air ocean freight container (high above player heads at y = -1.75..+0.85 -> pure 3A spatial drama!)
        placeFitGLB(b, 'container', x - 1.5, y - 6.25, z, 0, [2.4, 2.6, 6.0], 0x9b3a24, false, 'metal');
        // Twin downward industrial sodium worklight cones under crane bridge
        const hCone = new THREE.ConeGeometry(4.6, 9.8, 12, 1, true);
        hCone.translate(0, -4.9, 0);
        for (const fx of [-6.5, 5.5]) {
          const c = new THREE.Mesh(hCone, warmConeMat);
          c.position.set(x + fx, y - 0.1, z);
          extras.push(c);
        }
        b.shadows = true;
        break;
      }
      case 'Bulwark_Wall_8m':
      case 'Bulwark_Wall_6m': {
        b.box('metal', x, y, z, w, h, d, { rot: rotRad, color: 0x2c3845, surface: 'metal' });
        b.box('darkmetal', x, y + h, z, w + 0.08, 0.08, d, { rot: rotRad, color: 0x455362, collide: false });
        b.shadows = false;
        const railYaw = item.rot === 90 || item.rot === 270 ? 0 : H;
        b.model('railing', x, y + h, z, railYaw, { scale: { x: d / 4.0, y: 0.72, z: 1 } });
        b.shadows = true;
        break;
      }
      case 'Wall_Bulkhead_4m': {
        buildTieredWall(b, x, y, z, rotRad, w, h, d, col, 'plaster');
        break;
      }
      case 'Wall_Hold_4m': {
        buildTieredWall(b, x, y, z, rotRad, w, h, d, col, 'corrugated');
        break;
      }
      case 'Wall_Window_4m': {
        buildPortalModule(b, x, y, z, rotRad, 2.4, 1.1, 2.75, col, false);
        break;
      }
      case 'DoorFrame_Watertight': {
        buildPortalModule(b, x, y, z, rotRad, 2.4, 0, 2.5, col, true);
        break;
      }
      case 'DoorFrame_Cabin': {
        buildPortalModule(b, x, y, z, rotRad, 2.0, 0, 2.35, col, false);
        break;
      }
      case 'Pillar':
      case 'Pillar_Hold': {
        buildPillar(b, x, y, z, rotRad, w, h);
        break;
      }
      case 'Pipe_Bundle': {
        b.shadows = false;
        buildPipeBundle(b, x, y, z, rotRad, w);
        b.shadows = true;
        break;
      }
      case 'Stair_Gantry_2x6':
      case 'Stair_Steel_3x6':
      case 'Stair_Hold_3x12': {
        // Local +Z is climb direction; compute start edge from box center
        const dx = Math.round(Math.sin(rotRad));
        const dz = Math.round(Math.cos(rotRad));
        const startX = x - dx * (d * 0.5);
        const startZ = z - dz * (d * 0.5);
        b.stairs('darkmetal', startX, startZ, dx, dz, w, y, y + h, d, 0x394552, false);
        break;
      }
      case 'Ramp_Helipad_6x8': {
        const dx = Math.round(Math.sin(rotRad));
        const dz = Math.round(Math.cos(rotRad));
        const startX = x - dx * (d * 0.5);
        const startZ = z - dz * (d * 0.5);
        b.stairs('metal', startX, startZ, dx, dz, w, y, y + h, d, 0x3b4856, true);
        break;
      }
      case 'Gantry_Arch_28m': {
        // High-detail industrial maritime lattice container gantry crane (A-frame legs, X-truss bridge, trolley cab & beacons)
        for (const sx of [-13.2, 13.2]) {
          // Twin A-frame slanted steel legs + bolted bogie base
          b.box('darkmetal', x + sx, y, z, 1.15, 0.65, 3.2, { color: 0x2a333d, surface: 'metal' });
          b.tube('metal', new THREE.Vector3(x + sx, y + 0.5, z - 1.3), new THREE.Vector3(x + sx, y + h - 0.5, z - 0.35), 0.24, 0x9b3e26, 8);
          b.tube('metal', new THREE.Vector3(x + sx, y + 0.5, z + 1.3), new THREE.Vector3(x + sx, y + h - 0.5, z + 0.35), 0.24, 0x9b3e26, 8);
          for (let hy = 1.6; hy < h - 1.0; hy += 2.2) {
            const k = hy / h;
            const spread = 1.25 * (1 - k * 0.72);
            b.tube('darkmetal', new THREE.Vector3(x + sx, y + hy, z - spread), new THREE.Vector3(x + sx, y + hy, z + spread), 0.09, 0x72301e, 6);
          }
          // Twin red aviation obstruction beacons atop crane towers
          const bcn = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), beaconRedMat);
          bcn.position.set(x + sx, y + h + 0.35, z);
          extras.push(bcn);
        }
        // Upper & lower bridge box girders + diagonal X-bracing steel lattice trusses across the 28m span
        b.deco('metal', x, y + h - 0.45, z, w, 0.42, 1.15, { color: 0x9b3e26 });
        b.deco('darkmetal', x, y + h - 1.75, z, w - 0.8, 0.34, 1.05, { color: 0x863620 });
        b.deco('metal', x, y + h - 1.98, z, w - 1.4, 0.16, 0.32, { color: 0xdca428 }); // yellow hazard rail
        b.shadows = false;
        for (let bx = -12; bx < 12; bx += 3) {
          for (const fz of [-0.46, 0.46]) {
            b.tube('darkmetal', new THREE.Vector3(x + bx, y + h - 1.58, z + fz), new THREE.Vector3(x + bx + 3, y + h - 0.45, z + fz), 0.075, 0x78321f, 6);
            b.tube('darkmetal', new THREE.Vector3(x + bx + 3, y + h - 1.58, z + fz), new THREE.Vector3(x + bx, y + h - 0.45, z + fz), 0.075, 0x78321f, 6);
          }
        }
        // Suspended operator trolley cab + yellow spreader beams
        b.deco('metal', x - 3.5, y + h - 3.05, z, 2.8, 1.15, 1.9, { color: 0x2f3b47 });
        b.deco('metal', x - 3.5, y + h - 2.1, z, 3.0, 0.25, 2.0, { color: 0xdca428 });
        // Subtle downward volumetric floodlight beams illuminating the container lanes below
        const coneGeo = new THREE.ConeGeometry(4.2, 7.2, 14, 1, true);
        coneGeo.translate(0, -3.6, 0);
        for (const fx of [-5.5, 5.5]) {
          const cone = new THREE.Mesh(coneGeo, coolConeMat);
          cone.position.set(x + fx, y + h - 1.9, z);
          extras.push(cone);
        }
        b.shadows = true;
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. TACTICAL COVER (Strictly GLB + Multi-Part Naval Fixtures, Exact Bounds)
  // -------------------------------------------------------------------------
  for (const item of layout.tactical_cover) {
    const spec = ASSET_CATALOG[item.asset];
    if (!spec) continue;
    b.region = zoneRegion(item.zone);
    const [x, y, z] = item.pos;
    const rotRad = item.rot * DEG;
    const [w, h, d] = spec.size;
    const col = parseHex(item.color, 0x3a5268);

    switch (item.asset) {
      case 'Container_20ft': {
        placeFitGLB(b, 'container', x, y, z, rotRad, [w, h, d], col, true, 'metal');
        break;
      }
      case 'Container_40ft': {
        // Authentic 40ft ocean container composed of two seamlessly flush 20ft scanned GLBs + single unified collider
        const [aX, aY, aZ] = xf(x, y, z, rotRad, 0, 0, -3.0);
        const [bX, bY, bZ] = xf(x, y, z, rotRad, 0, 0, 3.0);
        placeFitGLB(b, 'container', aX, aY, aZ, rotRad, [w, h, 6.02], col, false, 'metal');
        placeFitGLB(b, 'container', bX, bY, bZ, rotRad, [w, h, 6.02], col, false, 'metal');
        b.solid(x, y, z, w, h, d, rotRad, 'metal', true);
        break;
      }
      case 'Container_20ft_Spec': {
        // Armored Special Objective #3 Container: open south end, lined with glowing server racks & laptop table!
        const t = 0.16;
        for (const s of [-1, 1]) {
          b.box('corrugated', x + s * (w * 0.5 - t * 0.5), y, z, t, h, d, { color: 0x3b4642, surface: 'metal' });
        }
        b.box('corrugated', x, y, z + d * 0.5 - t * 0.5, w, h, t, { color: 0x3b4642, surface: 'metal' });
        b.box('metal', x, y + h - t, z, w, t, d, { color: 0x343e3a, surface: 'metal' });
        // Yellow/amber hazard portal frame + internal server racks + laptop table
        b.deco('metal', x, y + h - 0.22, z - d * 0.5 + 0.08, w + 0.08, 0.18, 0.12, { color: 0xdca428 });
        b.box('darkmetal', x, y, z + 1.2, 1.4, 0.92, 0.72, { color: 0x262e36, surface: 'metal' });
        placeFitGLB(b, 'ph_laptop', x, y + 0.92, z + 1.2, Math.PI, [0.45, 0.3, 0.35], 0xffffff, false);
        // Internal illuminated tactical server cabinets lining left & right walls
        b.shadows = false;
        for (const sx of [-0.78, 0.78]) {
          for (const sz of [-1.2, 0.0]) {
            b.box('darkmetal', x + sx, y, z + sz, 0.45, 2.05, 0.92, { color: 0x1b222a, collide: false });
            const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.45, 0.08), sx < 0 ? screenCyanMat : serverAmberMat);
            led.position.set(x + sx + (sx < 0 ? 0.24 : -0.24), y + 1.15, z + sz);
            extras.push(led);
          }
        }
        b.shadows = true;
        break;
      }
      case 'Cover_Crate_Low': {
        placeFitGLB(b, 'pallet', x, y, z, rotRad, [w, 0.16, d], 0x8e7c62, false);
        const [c1x, c1y, c1z] = xf(x, y, z, rotRad, -0.35, 0.16, 0);
        const [c2x, c2y, c2z] = xf(x, y, z, rotRad, 0.38, 0.16, 0.05);
        placeFitGLB(b, 'mil_crate', c1x, c1y, c1z, rotRad + 0.04, [0.85, 0.92, 0.95], 0x4f5a46, false);
        placeFitGLB(b, 'wood_crate_a', c2x, c2y, c2z, rotRad - 0.05, [0.78, 0.88, 0.86], 0x9c8668, false);
        b.solid(x, y, z, w, h, d, rotRad, 'wood', true);
        break;
      }
      case 'Cover_Barricade_Low': {
        placeFitGLB(b, 'jersey', x, y, z, rotRad, [w, h, d], 0x707880, true, 'concrete');
        break;
      }
      case 'Cover_Winch_Low': {
        // Marine mooring winch: steel bedplate + twin side cheek plates + horizontal hawser drum
        b.box('darkmetal', x, y, z, w, 0.22, d, { rot: rotRad, color: 0x2a333c, collide: false });
        for (const sx of [-w * 0.38, w * 0.38]) {
          const [px, py, pz] = xf(x, y, z, rotRad, sx, 0.22, 0);
          b.box('metal', px, py, pz, 0.26, 0.88, d * 0.82, { rot: rotRad, color: 0x3b4855, collide: false });
        }
        const [ax, ay, az] = xf(x, y, z, rotRad, -w * 0.35, 0.66, 0);
        const [bx, by, bz] = xf(x, y, z, rotRad, w * 0.35, 0.66, 0);
        b.tube('metal', new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), 0.36, 0x5c6874, 14);
        b.solid(x, y, z, w, h, d, rotRad, 'metal', true);
        break;
      }
      case 'Cover_Table_Steel': {
        const useDesk = item.id === 'b_3f_chart';
        placeFitGLB(b, useDesk ? 'office_desk' : 'table', x, y, z, rotRad, [w, h, d], useDesk ? 0x3b4855 : 0x8d9aa6, true, 'metal');
        break;
      }
      case 'Cover_Console_Bridge': {
        b.box('darkmetal', x, y, z, w, h, d, { rot: rotRad, color: 0x26303a, surface: 'metal' });
        for (const ox of [-1.2, 0, 1.2]) {
          const [sx, sy, sz] = xf(x, y, z, rotRad, ox, h + 0.24, 0.12);
          const scr = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.44, 0.06), screenCyanMat);
          scr.position.set(sx, sy, sz);
          scr.rotation.set(-0.32, rotRad, 0);
          extras.push(scr);
        }
        break;
      }
      case 'Bridge_Helm_Station': {
        // Panoramic 3F Navigation Bridge Helm Console: angled pedestal, brass engine telegraph, 5 glowing ECDIS/radar screens!
        b.box('darkmetal', x, y, z, w, 1.05, d, { rot: rotRad, color: 0x232d37, surface: 'metal' });
        b.shadows = false;
        // Center helm pedestal & steering wheel column
        const [hx, hy, hz] = xf(x, y, z, rotRad, 0, 1.05, -0.35);
        b.box('metal', hx, hy, hz, 0.55, 0.42, 0.45, { rot: rotRad, color: 0x35424f, collide: false });
        // Twin brass engine-order telegraph levers
        for (const tx of [-0.72, 0.72]) {
          const [lx, ly, lz] = xf(x, y, z, rotRad, tx, 1.05, -0.15);
          b.cyl('metal', lx, ly, lz, 0.05, 0.36, 0xc8a042, { segs: 6 });
        }
        // 5 glowing ECDIS/Radar bridge screens angled toward the navigator
        for (const ox of [-2.2, -1.1, 0, 1.1, 2.2]) {
          const [sx, sy, sz] = xf(x, y, z, rotRad, ox, 1.28, 0.22);
          const scr = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.46, 0.06), Math.abs(ox) === 1.1 ? exitFaceMat : screenCyanMat);
          scr.position.set(sx, sy, sz);
          scr.rotation.set(-0.34, rotRad, 0);
          extras.push(scr);
        }
        b.shadows = true;
        break;
      }
      case 'Galley_Counter': {
        // Stainless-steel 2F Crew Mess Hall Galley Serving Counter + Overhead Exhaust Hood!
        b.box('metal', x, y, z, w, h, d, { rot: rotRad, color: 0x7b8996, surface: 'metal' });
        b.shadows = false;
        b.box('darkmetal', x, y + h, z, w + 0.06, 0.08, d + 0.08, { rot: rotRad, color: 0x9aa8b4, collide: false });
        // Overhead stainless galley exhaust canopy hood
        const [hx, hy, hz] = xf(x, y, z, rotRad, 0, 2.35, -0.08);
        b.box('metal', hx, hy, hz, w, 0.65, d * 0.9, { rot: rotRad, color: 0x62707d, collide: false });
        // Glowing under-hood kitchen strip light
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, 0.05, 0.14), warmLensMat);
        const [lx, ly, lz] = xf(x, y, z, rotRad, 0, 2.32, 0.05);
        strip.position.set(lx, ly, lz);
        strip.rotation.y = rotRad;
        extras.push(strip);
        b.shadows = true;
        break;
      }
      case 'Bunk_Bed_Marine': {
        // Authentic Double-Tier Ship Crew Bunk Bed (frame posts, twin mattresses, steel ladder)
        b.shadows = false;
        for (const sx of [-w * 0.46, w * 0.46]) {
          for (const sz of [-d * 0.44, d * 0.44]) {
            const [px, py, pz] = xf(x, y, z, rotRad, sx, 0, sz);
            b.box('darkmetal', px, py, pz, 0.07, h, 0.07, { rot: rotRad, color: 0x33404c, collide: false });
          }
        }
        // Lower & upper bunks with naval blue blankets & white pillows
        for (const by of [0.42, 1.38]) {
          b.box('darkmetal', x, y + by, z, w, 0.1, d, { rot: rotRad, color: 0x2d3a46, collide: false });
          b.box('burlap', x, y + by + 0.1, z, w - 0.12, 0.16, d - 0.1, { rot: rotRad, color: 0x2f4b68, collide: false });
          const [plx, ply, plz] = xf(x, y, z, rotRad, -w * 0.34, by + 0.25, 0);
          b.box('plaster', plx, ply, plz, 0.36, 0.1, d - 0.24, { rot: rotRad, color: 0xd8dce0, collide: false });
        }
        b.shadows = true;
        b.solid(x, y, z, w, h, d, rotRad, 'metal', true);
        break;
      }
      case 'Locker_Bank': {
        // Multi-door steel ship crew locker bank with recessed vent slots
        b.box('metal', x, y, z, w, h, d, { rot: rotRad, color: parseHex(item.color, 0x3b4e5e), surface: 'metal' });
        b.shadows = false;
        for (const ox of [-w * 0.32, 0, w * 0.32]) {
          const [vx, vy, vz] = xf(x, y, z, rotRad, ox, h * 0.78, d * 0.5 + 0.015);
          b.box('darkmetal', vx, vy, vz, 0.46, 0.18, 0.02, { rot: rotRad, color: 0x1c252e, collide: false });
        }
        b.shadows = true;
        break;
      }
      case 'Server_Rack_Bank': {
        b.box('darkmetal', x, y, z, w, h, d, { rot: rotRad, color: 0x1c232c, surface: 'metal' });
        const [lx, ly, lz] = xf(x, y, z, rotRad, 0, 1.15, d * 0.5 + 0.02);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.65, 1.4, 0.04), screenCyanMat);
        strip.position.set(lx, ly, lz);
        strip.rotation.y = rotRad;
        extras.push(strip);
        break;
      }
      case 'Mooring_Bollard': {
        // Heavy cast-iron twin-post ship mooring bitts + coiled yellow hawser base
        b.box('darkmetal', x, y, z, w, 0.18, d, { rot: rotRad, color: 0x222a32, surface: 'metal' });
        b.shadows = false;
        for (const ox of [-0.34, 0.34]) {
          const [bx, by, bz] = xf(x, y, z, rotRad, ox, 0.18, 0);
          b.cyl('darkmetal', bx, by, bz, 0.17, 0.62, 0x2d3742, { segs: 8 });
          b.cyl('metal', bx, by + 0.58, bz, 0.22, 0.09, 0xdca428, { segs: 8 });
        }
        b.shadows = true;
        b.solid(x, y, z, w, h, d, rotRad, 'metal', true);
        break;
      }
      case 'Cover_CableReel': {
        // Heavy shipboard timber & steel cable spool (waist-high crouch cover!)
        b.shadows = false;
        for (const ox of [-w * 0.42, w * 0.42]) {
          const [fx, fy, fz] = xf(x, y, z, rotRad, ox, 0, 0);
          b.box('wood', fx, fy, fz, 0.14, h, d, { rot: rotRad, color: 0x8e7250, collide: false });
        }
        const [ax, ay, az] = xf(x, y, z, rotRad, -w * 0.36, h * 0.5, 0);
        const [bx, by, bz] = xf(x, y, z, rotRad, w * 0.36, h * 0.5, 0);
        b.tube('darkmetal', new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), h * 0.42, 0x2a3138, 12);
        b.shadows = true;
        b.solid(x, y, z, w, h, d, rotRad, 'wood', true);
        break;
      }
      case 'Cover_Forklift': {
        placeFitGLB(b, 'veh_forklift', x, y, z, rotRad, [w, h, d], 0xdca428, true, 'metal');
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. DRESSING & DECALS (Clustered 2-3 per group — receive shadows, zero shadow-map bloat)
  // -------------------------------------------------------------------------
  b.shadows = false;
  for (const item of layout.dressing_and_decals) {
    const spec = ASSET_CATALOG[item.asset];
    if (!spec) continue;
    b.region = zoneRegion(item.zone);
    const [x, y, z] = item.pos;
    const rotRad = item.rot * DEG;
    const [w, h, d] = spec.size;
    const col = parseHex(item.color, 0xffffff);

    switch (item.asset) {
      case 'Prop_Barrel':
        placeFitGLB(b, 'barrel', x, y, z, rotRad, [w, h, d], parseHex(item.color, 0x3b5978), true, 'metal');
        break;
      case 'Prop_WoodCrate':
        placeFitGLB(b, 'wood_crate_b', x, y, z, rotRad, [w, h, d], parseHex(item.color, 0x9c8260), true, 'wood');
        break;
      case 'Prop_Toolbox':
        placeFitGLB(b, 'toolbox', x, y, z, rotRad, [w, h, d], parseHex(item.color, 0xa8382c), false, 'metal');
        break;
      case 'Prop_Jerrycan':
        placeFitGLB(b, 'jerrycan', x, y, z, rotRad, [w, h, d], parseHex(item.color, 0x8e3026), false, 'metal');
        break;
      case 'Prop_Welder':
        placeFitGLB(b, 'ph_welder', x, y, z, rotRad, [w, h, d], col, true, 'metal');
        break;
      case 'Prop_PropaneTank':
        placeFitGLB(b, 'propane_tank', x, y, z, rotRad, [w, h, d], col, true, 'metal');
        break;
      case 'Prop_Lifeboat': {
        // Steel stern davit cradle + orange enclosed lifeboat hull
        b.box('darkmetal', x, y, z, w, 0.9, d * 0.88, { rot: rotRad, color: 0x2c343e, collide: false });
        b.box('metal', x, y + 0.9, z, w * 0.92, h - 0.9, d, { rot: rotRad, color: 0xc84c20, taper: [0.68, 0.84], collide: false });
        b.solid(x, y, z, w, h, d, rotRad, 'metal', true);
        break;
      }
      case 'Decal_HazardStripe': {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), hazardMat);
        m.rotation.set(-H, 0, -rotRad);
        m.position.set(x, y + 0.018, z);
        extras.push(m);
        break;
      }
      case 'Decal_OilSpill': {
        const m = new THREE.Mesh(new THREE.CircleGeometry(w * 0.45, 16), oilMat);
        m.rotation.x = -H;
        m.scale.set(1, d / w, 1);
        m.position.set(x, y + 0.016, z);
        extras.push(m);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. CS:GO VISUAL GUIDANCE LIGHTING (Pooled Virtual Lights + Volumetric Cones)
  // -------------------------------------------------------------------------
  b.shadows = false;
  const warmConeGeo = new THREE.ConeGeometry(2.6, 4.4, 12, 1, true);
  warmConeGeo.translate(0, -2.2, 0);
  const holdConeGeo = new THREE.ConeGeometry(4.8, 8.6, 14, 1, true);
  holdConeGeo.translate(0, -4.3, 0);

  for (const item of layout.lighting) {
    const spec = ASSET_CATALOG[item.asset];
    if (!spec) continue;
    b.region = zoneRegion(item.zone);
    const [x, y, z] = item.pos;
    const rotRad = item.rot * DEG;

    if (item.asset === 'Light_Cool') {
      if ((item.zone === 'A' || item.zone === 'D') && y > 3.5 && Math.abs(x) >= 10) {
        b.cyl('darkmetal', x, 0, z, 0.08, y, 0x2a333d, { segs: 8 });
        b.box('darkmetal', x, y, z, 0.56, 0.1, 0.24, { rot: rotRad, color: 0x252d36, collide: false });
      } else if (assets.props.ph_caged_light) {
        b.model('ph_caged_light', x, y - 0.35, z, rotRad, { scale: 0.65 });
      } else {
        b.box('darkmetal', x, y, z, 0.56, 0.1, 0.24, { rot: rotRad, color: 0x252d36, collide: false });
      }
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.16), coolLensMat);
      lens.position.set(x, y - 0.06, z);
      lens.rotation.y = rotRad;
      extras.push(lens);
      if (item.zone === 'C') {
        const cone = new THREE.Mesh(holdConeGeo, coolConeMat);
        cone.position.set(x, y - 0.15, z);
        extras.push(cone);
      }
      const inten = item.intensity ?? 12;
      lightsOut.virtualLights.push({
        id: item.id,
        pos: new THREE.Vector3(x, y - 0.42, z),
        color: 0x7cb8f0,
        intensity: inten,
        baseIntensity: inten,
        distance: item.distance ?? 24,
        decay: 1.75,
        kind: 'main',
      });
    } else if (item.asset === 'Light_Warm') {
      // Crisp single-unit industrial caged marine pendant/stanchion fixture (replaces multi-part ph_sconce kit!)
      const isOutdoorDeck = (item.zone === 'A' || item.zone === 'D');
      const underGantry = (item.zone === 'A' && (Math.abs(z + 62) < 1.2 || Math.abs(z + 49) < 1.2) && y > 6.0);
      const onBulkhead = (item.zone === 'A' && Math.abs(z + 42.3) < 1.0);

      if (isOutdoorDeck && !underGantry && !onBulkhead) {
        // Grounded steel marine deck stanchion pole with overhanging horizontal gooseneck arm
        const baseY = item.zone === 'D' && z >= 82 ? 2.0 : 0.0;
        const postX = x + (x >= 0 ? 0.55 : -0.55);
        b.cyl('darkmetal', postX, baseY, z, 0.065, Math.max(0.4, y + 0.25 - baseY), 0x26303a, { segs: 8 });
        b.box('darkmetal', (x + postX) * 0.5, y + 0.16, z, Math.abs(postX - x) + 0.12, 0.07, 0.08, { color: 0x2a343f, collide: false });
      } else if (onBulkhead) {
        // Horizontal steel wall-mount sconce arm bolted solidly into the z=-42 superstructure bulkhead
        b.box('darkmetal', x, y + 0.12, z + 0.22, 0.12, 0.1, 0.44, { color: 0x26303a, collide: false });
        b.box('darkmetal', x, y + 0.12, z + 0.42, 0.28, 0.28, 0.06, { color: 0x1e262f, collide: false });
      } else {
        // Indoor ceiling / gantry / crane pendant conduit stem connecting solidly up to ceiling slab or beam!
        const ceilY =
          item.zone === 'B' ? (y < 3.6 ? 3.5 : y < 7.2 ? 7.1 : 10.7)
          : item.zone === 'C' ? (y < -0.1 ? -0.05 : y < 4.2 ? 4.6 : 7.0)
          : y + 0.45;
        const stemH = Math.max(0.2, ceilY - y);
        b.cyl('darkmetal', x, y + 0.06, z, 0.035, stemH, 0x242e38, { segs: 6 });
        b.cyl('darkmetal', x, ceilY - 0.06, z, 0.12, 0.06, 0x1d252e, { segs: 8 });
      }
      // Single-unit dark-metal industrial dome hood + ribbed bulb guard
      b.cyl('darkmetal', x, y - 0.02, z, 0.24, 0.11, 0x252e38, { segs: 10 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), warmLensMat);
      bulb.position.set(x, y - 0.1, z);
      extras.push(bulb);
      const cone = new THREE.Mesh(warmConeGeo, warmConeMat);
      cone.position.set(x, y - 0.12, z);
      extras.push(cone);
      const inten = item.intensity ?? 24;
      lightsOut.virtualLights.push({
        id: item.id,
        pos: new THREE.Vector3(x, y - 0.35, z),
        color: 0xffb244,
        intensity: inten,
        baseIntensity: inten,
        distance: item.distance ?? 20,
        decay: 1.65,
        kind: 'main',
      });
    } else if (item.asset === 'Exit_Sign') {
      // If placed outdoors (Zone D bow helipad entrance), root onto twin grounded steel stanchion posts!
      if (item.zone === 'D') {
        const baseY = z >= 82 ? 2.0 : 0.0;
        for (const sx of [-0.32, 0.32]) {
          b.cyl('darkmetal', x + sx, baseY, z, 0.035, Math.max(0.2, y - baseY), 0x242e38, { segs: 6 });
        }
      }
      b.box('darkmetal', x, y, z, 0.74, 0.32, 0.12, { rot: rotRad, color: 0x1c242c, collide: false });
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.22, 0.14), exitFaceMat);
      face.position.set(x, y + 0.16, z);
      face.rotation.y = rotRad;
      extras.push(face);
      const inten = item.intensity ?? 14;
      lightsOut.virtualLights.push({
        id: item.id,
        pos: new THREE.Vector3(x, y + 0.1, z),
        color: 0x32ff88,
        intensity: inten,
        baseIntensity: inten,
        distance: item.distance ?? 14,
        decay: 1.75,
        kind: 'exit',
      });
    }
  }
  b.shadows = true;

  // Keep reference to cm for optional signage extension
  void cm;
  void quad;
}

/**
 * Batches all static Mesh objects in `extras` by shared Material into ONE single merged Mesh
 * per material — collapsing 180+ individual decals, puddles, light lenses, beacons, and
 * volumetric cones into ~9 GPU draw calls for locked high FPS with zero frame drops!
 */
export function mergeExtrasByMaterial(extras: THREE.Object3D[]): THREE.Object3D[] {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const passthrough: THREE.Object3D[] = [];

  for (const obj of extras) {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.geometry || Array.isArray(m.material) || m.children.length > 0) {
      passthrough.push(obj);
      continue;
    }
    m.updateMatrix();
    const raw = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    raw.applyMatrix4(m.matrix);
    if (!raw.attributes.normal) raw.computeVertexNormals();
    // Normalize attribute set so every geometry in the material bucket merges cleanly
    const clean = new THREE.BufferGeometry();
    clean.setAttribute('position', raw.attributes.position);
    clean.setAttribute('normal', raw.attributes.normal);
    if (raw.attributes.uv) clean.setAttribute('uv', raw.attributes.uv);
    else {
      const count = raw.attributes.position.count;
      clean.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    raw.dispose();
    let list = byMat.get(m.material);
    if (!list) {
      list = [];
      byMat.set(m.material, list);
    }
    list.push(clean);
  }

  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    passthrough.push(mesh);
  }
  return passthrough;
}
