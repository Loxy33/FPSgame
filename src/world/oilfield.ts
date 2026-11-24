import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets, makePropObject, type PropName, type RawModelName, type ScanTexName } from '../render/assets';
import { texSets, type Materials } from '../render/materials';
import { applyDetail } from '../render/detail';
import { applyPom } from '../render/pom';
import { makeFresnelLensTexture, makeHazardChevronTextures, makeScadaScreenTexture } from '../render/textures';
import { applyConcretePanels, applyGrime, applySurfacePatina } from '../render/weather';
import type { MapInfo } from '../ui/hud';
import type { LevelData } from './level';
import { World, type Collider, type Surface } from './physics';

const H = Math.PI / 2;

export interface BlastGateHandle {
  id: string;
  mesh: THREE.Object3D;
  col: Collider;
  closedY: number;
  openY: number;
  openT: number;
  isOpen: boolean;
  beaconMat: THREE.MeshStandardMaterial;
  beaconLight: THREE.PointLight;
}

export interface OilfieldDynamic {
  gates: Record<'g12' | 'g23' | 'g34' | 'g45' | 'g56', BlastGateHandle[]>;
  setGateOpen(id: 'g12' | 'g23' | 'g34' | 'g45' | 'g56', open: boolean): void;
  jammerGroup: THREE.Group;
  jammerLight: THREE.PointLight;
  valve1Wheel: THREE.Object3D;
  valve2Wheel: THREE.Object3D;
  valve1Light: THREE.PointLight;
  valve2Light: THREE.PointLight;
  ctrlLight: THREE.PointLight;
  corePillar: THREE.Object3D;
  coreRing: THREE.Mesh;
  coreLight: THREE.PointLight;
  satDishHead: THREE.Object3D | null;
  satDestroyed: boolean;
  satBeaconLight: THREE.PointLight;
  heli: THREE.Group;
  heliRotor: THREE.Object3D;
  heliTailRotor: THREE.Object3D;
  destroyJammer(): void;
  closeValve(idx: 1 | 2): void;
  activateControlRoom(): void;
  setCoreHacking(progress: number, done: boolean): void;
  destroySatDish(): void;
}

/** Authoritative coordinates for Mission 2: 《戈壁炼狱 · 喀拉干达 7 号油田与厄普西隆地下中继站》 */
export const OILFIELD = {
  // Zone 1: Gobi Canyon Drop & Checkpoint (X: -112..-48, Z: -112..-45)
  spawn: { x: -80, y: 0.0, z: -104, yaw: Math.PI },
  z1Gate: { x: -80, y: 0.0, z: -45.0 },
  z1Enemies: [
    { kind: 'specops' as const, x: -83, y: 0.0, z: -76, yaw: 0, stealth: true, pts: [[-83, -78], [-83, -64]] as [number, number][] },
    { kind: 'specops' as const, x: -75, y: 0.0, z: -68, yaw: 0, stealth: true, pts: [[-75, -70], [-75, -56]] as [number, number][] },
    { kind: 'sniper' as const,  x: -97, y: 3.2, z: -64, yaw: 0.2, stealth: true },
    { kind: 'rusher' as const,  x: -57, y: 0.0, z: -60, yaw: 0, stealth: true },
    { kind: 'rifleman' as const,x: -84, y: 0.0, z: -50, yaw: 0, stealth: true },
    { kind: 'heavy' as const,   x: -76, y: 0.0, z: -49, yaw: 0, stealth: true },
  ],

  // Zone 2: Desert Pumpjacks & Mercenary Outpost (X: -112..-48, Z: -45..+35)
  z2Jammer: { x: -101, y: 0.0, z: 8.0 },
  z2Gate: { x: -79, y: 0.0, z: 35.0 },
  z2Enemies: [
    { kind: 'rifleman' as const, x: -94, y: 0.0, z: -20, yaw: 0, stealth: false },
    { kind: 'specops' as const,  x: -74, y: 0.0, z: -10, yaw: 0, stealth: false },
    { kind: 'sniper' as const,   x: -53, y: 7.95, z: 6, yaw: -H, stealth: false },
    { kind: 'specops' as const,  x: -56, y: 4.15, z: -8, yaw: -H, stealth: false },
    { kind: 'rusher' as const,   x: -66, y: 0.0, z: 4, yaw: 0, stealth: false },
    { kind: 'breacher' as const, x: -92, y: 0.0, z: 12, yaw: 0.4, stealth: false },
    { kind: 'rifleman' as const, x: -102, y: 0.0, z: 16, yaw: 0.2, stealth: false },
    { kind: 'heavy' as const,    x: -78, y: 0.0, z: 24, yaw: 0, stealth: false },
    { kind: 'specops' as const,  x: -64, y: 0.0, z: 27, yaw: 0, stealth: false },
  ],

  // Zone 3: Giant Crude Storage Tanks & Fuel Truck Loading Bay (X: -110..+20, Z: +35..+108)
  z3Valve1: { x: -52, y: 5.2, z: 72.0 },
  z3Valve2: { x: -2.0, y: 0.0, z: 72.0 },
  z3Gate: { x: -14, y: 0.0, z: 35.0 },
  z3Enemies: [
    { kind: 'specops' as const,  x: -80, y: 5.2, z: 70, yaw: 0, stealth: false },
    { kind: 'sniper' as const,   x: -24, y: 5.2, z: 72, yaw: -H, stealth: false },
    { kind: 'rifleman' as const, x: -66, y: 0.0, z: 68, yaw: 0, stealth: false },
    { kind: 'rusher' as const,   x: -78, y: 0.0, z: 74, yaw: 0, stealth: false },
    { kind: 'breacher' as const, x: -50, y: 0.0, z: 72, yaw: -H, stealth: false },
    { kind: 'specops' as const,  x: -52, y: 5.2, z: 86, yaw: 0, stealth: false },
    { kind: 'rifleman' as const, x: -24, y: 0.0, z: 58, yaw: -H, stealth: false },
    { kind: 'heavy' as const,    x: -4,  y: 0.0, z: 66, yaw: -H, stealth: false },
    { kind: 'specops' as const,  x: 8,   y: 0.0, z: 78, yaw: -H, stealth: false },
    { kind: 'rusher' as const,   x: -14, y: 0.0, z: 46, yaw: Math.PI, stealth: false },
  ],

  // Zone 4: 3-Tier Catalytic Cracking Refinery (X: -45..+35, Z: -35..+35)
  z4Console: { x: -27.5, y: 4.55, z: 0.0 },
  z4Gate: { x: 35.5, y: -6.0, z: 10.0 },
  z4Enemies: [
    { kind: 'specops' as const,  x: -12, y: 0.0, z: 14, yaw: Math.PI, stealth: false },
    { kind: 'rifleman' as const, x: 6,   y: 0.0, z: 12, yaw: Math.PI, stealth: false },
    { kind: 'sniper' as const,   x: -1,  y: 9.0, z: -13, yaw: Math.PI, stealth: false },
    { kind: 'specops' as const,  x: 12,  y: 4.5, z: 4, yaw: -H, stealth: false },
    { kind: 'breacher' as const, x: -14, y: 4.5, z: -8, yaw: Math.PI, stealth: false },
    { kind: 'rusher' as const,   x: -32, y: 0.0, z: 8, yaw: H, stealth: false },
    { kind: 'specops' as const,  x: -32, y: 4.55, z: -6, yaw: H, stealth: false },
    { kind: 'heavy' as const,    x: -34, y: 4.55, z: 6, yaw: H, stealth: false },
    { kind: 'rifleman' as const, x: 2,   y: 0.0, z: -18, yaw: Math.PI, stealth: false },
    { kind: 'specops' as const,  x: 16,  y: 0.0, z: -4, yaw: -H, stealth: false },
  ],
  z4Ambush: [
    { kind: 'rusher' as const,   x: 14,  y: 0.0, z: 10, yaw: -H },
    { kind: 'breacher' as const, x: 18,  y: 0.0, z: 6, yaw: -H },
    { kind: 'specops' as const,  x: 12,  y: 4.5, z: 14, yaw: -H },
  ],

  // Zone 5: Epsilon Subterranean Data Vault (X: +36..+106, Z: -45..+30, Y: -6.0 / -1.5)
  z5Core: { x: 73.0, y: -6.0, z: 4.0 },
  z5Gate: { x: 92.0, y: -6.0, z: -45.0 },
  z5Enemies: [
    { kind: 'specops' as const,  x: 56, y: -6.0, z: 8, yaw: -H },
    { kind: 'rusher' as const,   x: 64, y: -6.0, z: -2, yaw: -H },
    { kind: 'breacher' as const, x: 74, y: -6.0, z: 12, yaw: -H },
    { kind: 'specops' as const,  x: 82, y: -6.0, z: 2, yaw: -H },
    { kind: 'sniper' as const,   x: 95, y: -1.5, z: 4, yaw: -H },
    { kind: 'specops' as const,  x: 72, y: -1.5, z: 25, yaw: 0 },
  ],
  z5HackWave1: [
    { kind: 'rusher' as const,   x: 58, y: -6.0, z: -26, yaw: 0 },
    { kind: 'specops' as const,  x: 86, y: -6.0, z: -26, yaw: 0 },
    { kind: 'breacher' as const, x: 64, y: -6.0, z: 20, yaw: Math.PI },
    { kind: 'specops' as const,  x: 95, y: -1.5, z: -12, yaw: -H },
  ],
  z5HackWave2: [
    { kind: 'heavy' as const,    x: 86, y: -6.0, z: -28, yaw: 0 },
    { kind: 'specops' as const,  x: 60, y: -6.0, z: -28, yaw: 0 },
    { kind: 'rusher' as const,   x: 88, y: -6.0, z: 18, yaw: Math.PI },
    { kind: 'sniper' as const,   x: 51, y: -1.5, z: -14, yaw: H },
  ],

  // Zone 6: +12m Cliffside Satellite Dish & Extraction Helipad (X: +44..+114, Z: -114..-45)
  z6DishC4: { x: 64.0, y: 16.4, z: -72.0 },
  z6Helipad: { x: 94.0, y: 12.42, z: -92.0 },
  z6InitialEnemies: [
    { kind: 'specops' as const,  x: 74, y: 12.0, z: -64, yaw: 0 },
    { kind: 'rifleman' as const, x: 56, y: 12.0, z: -62, yaw: H },
    { kind: 'sniper' as const,   x: 64, y: 16.4, z: -71, yaw: 0 },
    { kind: 'heavy' as const,    x: 82, y: 12.0, z: -84, yaw: 0 },
    { kind: 'breacher' as const, x: 102, y: 12.0, z: -76, yaw: -H },
    { kind: 'specops' as const,  x: 76, y: 12.0, z: -98, yaw: 0 },
  ],
  z6HoldoutWave1: [
    { kind: 'rusher' as const,   x: 56, y: 12.0, z: -56, yaw: 0.4 },
    { kind: 'specops' as const,  x: 70, y: 12.0, z: -54, yaw: 0 },
    { kind: 'breacher' as const, x: 54, y: 12.0, z: -82, yaw: H },
    { kind: 'specops' as const,  x: 68, y: 12.0, z: -104, yaw: H },
  ],
  z6HoldoutWave2: [
    { kind: 'heavy' as const,    x: 58, y: 12.0, z: -62, yaw: 0.5 },
    { kind: 'specops' as const,  x: 72, y: 12.0, z: -56, yaw: 0.2 },
    { kind: 'rusher' as const,   x: 54, y: 12.0, z: -96, yaw: H },
    { kind: 'heavy' as const,    x: 74, y: 12.0, z: -104, yaw: H },
  ],
};

// ---------------------------------------------------------------------------
// AAA Photorealistic Shader & Material Pipeline (4K Poly Haven Scans + POM + Grime + Micro-Detail)
// Zero vertexColors trap, zero flat cartoon canvas stripes!
// ---------------------------------------------------------------------------
type PbrKey =
  | 'sand' | 'asphalt' | 'concrete' | 'cliff' | 'cinder' | 'steel'
  | 'catwalk' | 'tread' | 'hazard' | 'chevron' | 'bunker' | 'bunkerFloor' | 'rust' | 'glass' | 'hesco';

function applyMacro(mat: THREE.MeshStandardMaterial, meanG: number, s1: number, s2: number, amount: number) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uMacro = { value: new THREE.Vector4(s1, s2, 1 / Math.max(meanG, 0.05), amount) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uMacro;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          float m1 = texture2D( map, vMapUv * uMacro.x ).g * uMacro.z;
          float m2 = texture2D( map, vMapUv * uMacro.y + vec2( 0.37, 0.61 ) ).g * uMacro.z;
          float mv = clamp( m1 * 0.55 + m2 * 0.45, 0.52, 1.55 );
          diffuseColor.rgb *= mix( 1.0, mv, uMacro.w );
        }
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'macro|' + prevKey;
}

/** World-space craggy sedimentary Gobi sandstone strata & view-space normal bump shader for close/mid-range cliffs. */
function applyGobiCliffShader(mat: THREE.MeshStandardMaterial) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCliffWp;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 cw = vec4(transformed, 1.0);
  vCliffWp = (modelMatrix * cw).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCliffWp;
float cfHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float cfNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cfHash(i), cfHash(i + vec2(1.0, 0.0)), f.x), mix(cfHash(i + vec2(0.0, 1.0)), cfHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float cfFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * cfNoise(p); p = p * 2.04 + 13.7; a *= 0.5; } return s; }
float cfHeight(vec3 p) {
  float warp = cfFbm(p.xz * 0.055) * 3.4;
  float strata = cfFbm(vec2(p.y * 0.62 + warp, (p.x - p.z) * 0.06));
  float ledge = smoothstep(0.35, 0.65, fract(p.y * 0.42 + warp * 0.35));
  float crack = cfFbm(vec2((p.x + p.z) * 0.34, p.y * 0.11));
  float grit = cfNoise(p.xz * 1.15 + p.y * 0.65);
  return strata * 0.44 + ledge * 0.22 + crack * 0.22 + grit * 0.12;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 geoN = normalize(cross(dFdx(vCliffWp), dFdy(vCliffWp)));
  float steep = smoothstep(0.08, 0.45, 1.0 - abs(geoN.y));
  float warp = cfFbm(vCliffWp.xz * 0.048) * 3.6;
  float strata = cfNoise(vec2(vCliffWp.y * 0.72 + warp, (vCliffWp.x + vCliffWp.z) * 0.045));
  float band = smoothstep(0.24, 0.76, strata);
  float ledgeLine = 1.0 - smoothstep(0.0, 0.14, abs(fract(vCliffWp.y * 0.48 + warp * 0.35) - 0.5));
  float fissure = smoothstep(0.32, 0.72, cfFbm(vec2((vCliffWp.x * 0.46 - vCliffWp.z * 0.42), vCliffWp.y * 0.11 + warp * 0.35)));
  float fine = cfFbm(vCliffWp.xz * 0.28 + vCliffWp.y * 0.22);
  // Natural desaturated Gobi desert shale, limestone dust & weathered umber rock strata (zero cartoon orange!)
  vec3 paleLimestone = vec3(1.06, 1.01, 0.93);
  vec3 weatheredShale = vec3(0.68, 0.60, 0.52);
  vec3 cliffTint = mix(paleLimestone, weatheredShale, band);
  float baseDust = smoothstep(3.4, 0.0, vCliffWp.y) * 0.34;
  float shade = mix(0.70, 1.18, fine) * mix(1.0, mix(0.50, 1.14, fissure) * (1.0 - ledgeLine * 0.26), steep);
  diffuseColor.rgb *= shade * mix(vec3(1.02, 0.98, 0.92), cliffTint, steep);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.53, 0.45), baseDust);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float h0 = cfHeight(vCliffWp);
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(h0);
  float dhdy = dFdy(h0);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) > 1e-6) {
    vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
    normal = normalize(mix(normal, normalize(normal - grad * 2.15), 0.88));
  }
}`);
  };
  mat.customProgramCacheKey = () => 'gobicliff|' + prevKey;
}

/** Build a true 4K/2K scanned PBR MeshStandardMaterial (vertexColors: false, full ARM + Normal + AO + Grime + Detail + POM). */
function makeScannedMat(
  source: keyof typeof texSets | 'slab' | 'mud',
  opts: {
    color: number;
    roughness?: number;
    metalness?: number;
    normalScale?: number;
    aoIntensity?: number;
    macro?: [number, number, number];
    grime?: [number, number];
    detail?: [number, number];
    pom?: [number, number];
  },
): THREE.MeshStandardMaterial {
  const scan = assets.tex[source as ScanTexName];
  const t = source === 'slab' || source === 'mud'
    ? (scan ? { map: scan.map, normalMap: scan.normalMap, roughnessMap: scan.armMap, aoMap: scan.armMap, meanG: scan.meanG } : texSets.concrete)
    : texSets[source];
  const ns = opts.normalScale ?? 1.2;
  const mat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(ns, ns),
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    aoMapIntensity: opts.aoIntensity ?? 0.65,
    color: opts.color,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.04,
    vertexColors: false,
  });
  if (opts.macro) applyMacro(mat, t.meanG ?? 0.5, opts.macro[0], opts.macro[1], opts.macro[2]);
  if (opts.grime) applyGrime(mat, opts.grime[0], opts.grime[1]);
  if (opts.detail) applyDetail(mat, opts.detail[0], opts.detail[1]);
  if (opts.pom && scan?.heightMap) applyPom(mat, scan.heightMap, { depth: opts.pom[0], steps: opts.pom[1] });
  return mat;
}

/** Weathered riveted steel industrial signage (physically lit, subtle desert grime — zero flat neon signs). */
/**
 * Authentic Karaganda Petrochemical riveted weathered steel sector plaque (compact 3D bolted sign,
 * desert dust grime, industrial stencil — zero fourth-wall game instructions!).
 */
function makeIndustrialSign(title: string, sub: string, accent = '#c48f36', w = 4.2, h = 0.96): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 240;
  const ctx = c.getContext('2d')!;
  // Sun-baked dark slate painted steel background
  ctx.fillStyle = '#1f2326';
  ctx.fillRect(0, 0, 1024, 240);
  // Subtle brushed metal grain & Gobi desert dust accumulation near bottom edge
  for (let i = 0; i < 120; i++) {
    const y = (i * 19) % 240;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, y, 1024, 2);
  }
  const dust = ctx.createLinearGradient(0, 120, 0, 240);
  dust.addColorStop(0, 'rgba(154,122,84,0)');
  dust.addColorStop(1, 'rgba(148,114,76,0.34)');
  ctx.fillStyle = dust;
  ctx.fillRect(0, 0, 1024, 240);
  // Recessed steel flange border + muted sector stripe + top divider
  ctx.strokeStyle = 'rgba(210,198,180,0.26)';
  ctx.lineWidth = 5;
  ctx.strokeRect(14, 14, 996, 212);
  ctx.fillStyle = accent;
  ctx.fillRect(18, 18, 16, 204);
  ctx.fillStyle = 'rgba(210,200,185,0.16)';
  ctx.fillRect(54, 134, 932, 2);
  // 4 corner hex bolts
  for (const [bx, by] of [[38, 36], [986, 36], [38, 204], [986, 204]]) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(bx + 2, by + 2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5c6268';
    ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#e0dcd2';
  ctx.font = '700 54px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(title, 58, 104, 910);
  ctx.fillStyle = '#a0a9b0';
  ctx.font = '600 28px Consolas, "Courier New", monospace';
  ctx.fillText(sub, 58, 186, 910);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.owned = true;
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    normalMap: texSets.metal.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.68,
    metalness: 0.32,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.72, metalness: 0.52 });

  const grp = new THREE.Group();
  const backing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.10, h + 0.10, 0.18), frameMat);
  backing.position.z = -0.055;
  backing.castShadow = true;
  backing.receiveShadow = true;
  grp.add(backing);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.65, metalness: 0.62 });
  const topHood = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.055, 0.14), railMat);
  topHood.position.set(0, h * 0.5 + 0.045, 0.015);
  grp.add(topHood);
  const lugGeo = new THREE.BoxGeometry(0.14, 0.14, 0.16);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const lug = new THREE.Mesh(lugGeo, railMat);
      lug.position.set(sx * (w * 0.5 + 0.06), sy * (h * 0.5 - 0.08), -0.05);
      grp.add(lug);
    }
  }
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
  front.position.z = 0.038;
  front.receiveShadow = true;
  grp.add(front);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
  back.position.z = -0.148;
  back.rotation.y = Math.PI;
  back.receiveShadow = true;
  grp.add(back);
  return grp;
}

// ---------------------------------------------------------------------------
// Batched AAA PBR Structural Builder (uv + uv2 for AO + Organic Sculpted Cliffs!)
// ---------------------------------------------------------------------------
function scaleUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile = 3.2) {
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  // Works for both single-segment and subdivided BoxGeometries!
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, (px + w * 0.5) / tile, (pz + d * 0.5) / tile);
    else if (nx >= ny && nx >= nz) uv.setXY(i, (pz + d * 0.5) / tile, (py + h * 0.5) / tile);
    else uv.setXY(i, (px + w * 0.5) / tile, (py + h * 0.5) / tile);
  }
}

function normGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ni = g.index ? g.toNonIndexed() : g.clone();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', ni.attributes.position);
  if (ni.attributes.normal) out.setAttribute('normal', ni.attributes.normal);
  else out.computeVertexNormals();
  const uvAttr = ni.attributes.uv
    ?? new THREE.BufferAttribute(new Float32Array(ni.attributes.position.count * 2), 2);
  out.setAttribute('uv', uvAttr);
  // Populate uv2 so Three.js aoMap works on EVERY structural & Blender hero surface!
  out.setAttribute('uv2', uvAttr.clone());
  ni.dispose();
  return out;
}

/** Deterministic world-space craggy rock displacement for organic Gobi cliffs (never boxy!). */
function cliffNoise3(x: number, y: number, z: number): number {
  const a = Math.sin(x * 0.14 + z * 0.11 + y * 0.22) * Math.cos(z * 0.17 - x * 0.09);
  const b = Math.sin(x * 0.34 - y * 0.41 + z * 0.27) * 0.5;
  const c = Math.cos(y * 0.85 + x * 0.19 + z * 0.23) * 0.25;
  return a + b + c;
}

class OilfieldBuilder {
  private buckets = new Map<PbrKey, THREE.BufferGeometry[]>();
  roads: [number, number, number, number][] = [];

  constructor(private world: World) {}

  private push(key: PbrKey, geo: THREE.BufferGeometry) {
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(normGeo(geo));
    geo.dispose();
  }

  box(
    key: PbrKey,
    cx: number, y: number, cz: number,
    w: number, h: number, d: number,
    opts: { rotY?: number; surf?: Surface; solid?: boolean; road?: boolean; tile?: number } = {},
  ) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const defaultTile = key === 'sand' ? 4.2 : key === 'cliff' ? 5.0 : key === 'hesco' ? 1.5 : key === 'chevron' ? 1.2 : key === 'cinder' ? 1.8 : 2.8;
    scaleUVs(geo, w, h, d, opts.tile ?? defaultTile);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, y + h * 0.5, cz);
    this.push(key, geo);
    if (opts.solid !== false) {
      const surf: Surface = opts.surf
        ?? (key === 'sand' || key === 'cliff' ? 'sand'
          : key === 'steel' || key === 'catwalk' || key === 'rust' || key === 'hazard' || key === 'chevron' ? 'metal'
            : 'concrete');
      this.world.addBox(cx, y + h * 0.5, cz, w * 0.5, h * 0.5, d * 0.5, opts.rotY ?? 0, surf);
    }
    if (opts.road) this.roads.push([cx, cz, w, d]);
  }

  /** Sculpted craggy Gobi sandstone cliff volume with stepped mesa batter & jagged ridgeline (keeps top walkable if flatTop=true). */
  cliffBox(
    cx: number, y: number, cz: number,
    w: number, h: number, d: number,
    opts: { rotY?: number; flatTop?: boolean; amp?: number } = {},
  ) {
    const sx = Math.max(3, Math.min(20, Math.round(w / 4.8)));
    const sy = Math.max(3, Math.min(8, Math.round(h / 2.2)));
    const sz = Math.max(3, Math.min(20, Math.round(d / 4.8)));
    const geo = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
    const pos = geo.attributes.position;
    const amp = opts.amp ?? 1.05;
    const halfH = h * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
      const wx = cx + lx, wy = y + halfH + ly, wz = cz + lz;
      const isTop = ly > halfH - 0.15;
      const isBot = ly < -halfH + 0.15;
      if (isBot) continue;
      // Stepped natural mesa batter + organic horizontal sandstone shelf ledges
      const heightFrac = (ly + halfH) / Math.max(h, 0.1);
      const shelf = Math.sin(heightFrac * Math.PI * 3.0) * 0.32;
      const n = cliffNoise3(wx, wy, wz) + shelf;
      const ridge = cliffNoise3(wx * 0.55, 1.0, wz * 0.55) * 1.45;
      const dx = (Math.abs(lx) > w * 0.45 ? Math.sign(lx) : 0) * (n * amp - heightFrac * amp * 0.65);
      const dz = (Math.abs(lz) > d * 0.45 ? Math.sign(lz) : 0) * (n * amp - heightFrac * amp * 0.65);
      const dy = isTop && opts.flatTop ? 0 : (isTop ? ridge * amp * 0.95 : 0);
      pos.setXYZ(i, lx + dx, ly + dy, lz + dz);
    }
    geo.computeVertexNormals();
    scaleUVs(geo, w, h, d, 4.0);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, y + halfH, cz);
    this.push('cliff', geo);
    this.world.addBox(cx, y + halfH, cz, w * 0.5, halfH, d * 0.5, opts.rotY ?? 0, 'sand');
  }

  cyl(key: PbrKey, cx: number, y: number, cz: number, r: number, h: number, segs = 20, solid = true, surf: Surface = 'metal') {
    const geo = new THREE.CylinderGeometry(r, r, h, segs, 1);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r / 2.6), uv.getY(i) * (h / 2.6));
    geo.translate(cx, y + h * 0.5, cz);
    this.push(key, geo);
    if (solid) {
      // Inscribed 12-gon collider (3 rotated squares with hs = r * 0.7071 so corners NEVER protrude beyond visual cylinder radius r!)
      const hs = r * 0.7071;
      this.world.addBox(cx, y + h * 0.5, cz, hs, h * 0.5, hs, 0, surf);
      this.world.addBox(cx, y + h * 0.5, cz, hs, h * 0.5, hs, Math.PI / 6, surf);
      this.world.addBox(cx, y + h * 0.5, cz, hs, h * 0.5, hs, Math.PI / 3, surf);
    }
  }

  pipe(key: PbrKey, cx: number, cy: number, cz: number, r: number, len: number, axis: 'x' | 'z', solid = false) {
    const geo = new THREE.CylinderGeometry(r, r, len, 14, 1);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r / 2.0), uv.getY(i) * (len / 2.0));
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

  stairs(axis: 'x' | 'z', cCross: number, a0: number, a1: number, y0: number, y1: number, width: number, key: PbrKey = 'tread', rails = true) {
    const stepKey: PbrKey = key === 'catwalk' ? 'tread' : key;
    const dy = y1 - y0;
    const dir = Math.sign(a1 - a0) || 1;
    const span = Math.abs(a1 - a0);
    const steps = Math.max(4, Math.ceil(Math.abs(dy) / 0.27));
    const da = (a1 - a0) / steps;
    const stepLen = span / steps + 0.08;
    const thick = Math.max(0.26, Math.abs(dy) / steps + 0.08);
    for (let i = 0; i < steps; i++) {
      const a = a0 + da * (i + 0.5);
      const topY = y0 + dy * ((i + 1) / steps);
      const cx = axis === 'x' ? a : cCross;
      const cz = axis === 'z' ? a : cCross;
      const w = axis === 'x' ? stepLen : width;
      const d = axis === 'z' ? stepLen : width;
      this.box(stepKey, cx, topY - thick, cz, w, thick, d, { surf: 'metal', tile: 1.8 });
      if (rails && (i === 0 || i === steps - 1 || i % 4 === 0)) {
        for (const side of [-1, 1]) {
          const rx = axis === 'x' ? a : cCross + side * (width * 0.5 - 0.06);
          const rz = axis === 'z' ? a : cCross + side * (width * 0.5 - 0.06);
          this.box('steel', rx, topY, rz, 0.08, 0.96, 0.08, { solid: false });
        }
      }
    }
    // Continuous sloped structural steel stringer beams underneath both stair edges + sloped top handrails (ZERO floating steps/posts!)
    const slopeLen = Math.hypot(span, dy);
    const pitch = Math.atan2(dy, span); // positive when ascending along dir
    const midA = (a0 + a1) * 0.5;
    const midY = (y0 + y1) * 0.5;
    const addSlopedBeam = (k: PbrKey, crossOff: number, yOff: number, bw: number, bh: number) => {
      const geo = axis === 'x'
        ? new THREE.BoxGeometry(slopeLen + 0.2, bh, bw)
        : new THREE.BoxGeometry(bw, bh, slopeLen + 0.2);
      scaleUVs(geo, axis === 'x' ? slopeLen : bw, bh, axis === 'z' ? slopeLen : bw, 2.2);
      if (axis === 'x') geo.rotateZ(dir * pitch);
      else geo.rotateX(-dir * pitch);
      geo.translate(axis === 'x' ? midA : cCross + crossOff, midY + yOff, axis === 'z' ? midA : cCross + crossOff);
      this.push(k, geo);
    };
    if (stepKey !== 'cliff' && stepKey !== 'asphalt') {
      for (const side of [-1, 1]) {
        const off = side * (width * 0.5 - 0.07);
        // Deep steel side stringer beam tying every step into one solid truss
        addSlopedBeam('steel', off, -0.18, 0.14, 0.34);
        if (rails) {
          // Continuous sloped top handrail & mid-rail connecting every vertical post cleanly
          addSlopedBeam('steel', off, 0.96, 0.09, 0.08);
          addSlopedBeam('steel', off, 0.50, 0.07, 0.06);
        }
      }
    }
  }

  wall(
    key: PbrKey, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, h: number,
    t = 0.5, gaps: { at: number; w: number; h: number }[] = [],
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
      if (g.h < h - 0.05) seg(g0, g1, y0 + g.h, h - g.h);
      cur = g1;
    }
    seg(cur, a1, y0, h);
  }

  /** Grounded industrial Steel H-Column with concrete pier footing & top capital plate (eliminates floating catwalks!). */
  column(cx: number, y0: number, y1: number, cz: number, size = 0.42) {
    const h = y1 - y0;
    if (h < 0.4) return;
    // Stepped concrete pier footing at ground level
    const footH = Math.min(0.45, h * 0.25);
    this.box('concrete', cx, y0, cz, size + 0.34, footH, size + 0.34, { solid: false });
    // Main steel H-column shaft (solid so players & bullets interact cleanly)
    this.box('steel', cx, y0, cz, size, h, size, { surf: 'metal' });
    // Flanged steel capital bracket plate under deck/beam
    this.box('rust', cx, y1 - 0.16, cz, size + 0.24, 0.16, size + 0.24, { solid: false });
  }

  /** Heavy recessed dark-steel doorway jambs & overhead I-beam lintel framing bare wall cutouts. */
  doorFrame(axis: 'x' | 'z', c: number, at: number, y0: number, w: number, h: number, wallT = 0.5) {
    const jt = 0.20;
    const d = wallT + 0.16;
    if (axis === 'x') {
      this.box('steel', at - w * 0.5 + jt * 0.5, y0, c, jt, h, d, { solid: false });
      this.box('steel', at + w * 0.5 - jt * 0.5, y0, c, jt, h, d, { solid: false });
      this.box('steel', at, y0 + h - 0.04, c, w + 0.36, 0.26, d + 0.08, { solid: false });
    } else {
      this.box('steel', c, y0, at - w * 0.5 + jt * 0.5, d, h, jt, { solid: false });
      this.box('steel', c, y0, at + w * 0.5 - jt * 0.5, d, h, jt, { solid: false });
      this.box('steel', c, y0 + h - 0.04, at, d + 0.08, 0.26, w + 0.36, { solid: false });
    }
  }

  /** Waist-high HESCO / Jersey-profile concrete / armored bunker tactical cover with multi-part architectural trim! */
  cover(cx: number, y: number, cz: number, w: number, d: number, tall = false, rotY = 0, mat: PbrKey = 'hesco') {
    const h = tall ? 1.48 : 1.12;
    this.box(mat, cx, y, cz, w, h, d, { rotY, tile: mat === 'hesco' ? 1.35 : 2.2 });
    if (mat === 'concrete') {
      // Stepped Jersey-style wide concrete base plinth + dark steel anti-chip top coping cap
      this.box('concrete', cx, y, cz, w + 0.24, 0.24, d + 0.24, { rotY, solid: false, tile: 2.2 });
      this.box('steel', cx, y + h - 0.06, cz, w + 0.06, 0.08, d + 0.06, { rotY, solid: false });
    } else if (mat === 'hesco') {
      // HESCO galvanized steel wire-basket top rim & corner frame uprights
      this.box('steel', cx, y + h - 0.04, cz, w + 0.04, 0.06, d + 0.04, { rotY, solid: false });
      this.box('rust', cx, y, cz, w + 0.06, 0.10, d + 0.06, { rotY, solid: false });
    } else if (mat === 'bunker') {
      this.box('steel', cx, y, cz, w + 0.14, 0.14, d + 0.14, { rotY, solid: false });
      this.box('steel', cx, y + h - 0.08, cz, w + 0.10, 0.10, d + 0.10, { rotY, solid: false });
    }
  }

  catwalk(cx: number, y: number, cz: number, w: number, d: number, open: { n?: boolean; s?: boolean; e?: boolean; w?: boolean } = {}) {
    this.box('catwalk', cx, y - 0.22, cz, w, 0.22, d, { surf: 'metal', tile: 2.0 });
    const rh = 0.98, rt = 0.11;
    const rail = (rx: number, rz: number, rw: number, rd: number) => {
      // Realistic industrial weathered steel toe-kick + mid-bar + top handrail (ZERO arcade stripes!)
      this.box('rust', rx, y, rz, rw, 0.15, rd, { surf: 'metal' });
      this.box('steel', rx, y + 0.48, rz, rw, 0.07, rd, { surf: 'metal' });
      this.box('steel', rx, y + rh - 0.09, rz, rw, 0.09, rd, { surf: 'metal' });
      // Invisible solid chest-height containment collider along open railing span
      this.world.addBox(rx, y + rh * 0.5, rz, rw * 0.5, rh * 0.5, rd * 0.5, 0, 'metal');
      // Vertical stanchion posts every ~3.2m
      const span = Math.max(rw, rd);
      const alongX = rw >= rd;
      const count = Math.max(2, Math.round(span / 3.2));
      for (let i = 0; i <= count; i++) {
        const off = -span * 0.5 + (i / count) * span;
        this.box('steel', alongX ? rx + off : rx, y + 0.15, alongX ? rz : rz + off, 0.08, rh - 0.24, 0.08, { solid: false });
      }
    };
    if (!open.n) rail(cx, cz - d * 0.5 + rt * 0.5, w, rt);
    if (!open.s) rail(cx, cz + d * 0.5 - rt * 0.5, w, rt);
    if (!open.w) rail(cx - w * 0.5 + rt * 0.5, cz, rt, d);
    if (!open.e) rail(cx + w * 0.5 - rt * 0.5, cz, rt, d);
  }

  finalize(pbr: Record<PbrKey, THREE.Material>, group: THREE.Group) {
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, pbr[key]);
      mesh.castShadow = key !== 'sand' && key !== 'asphalt' && key !== 'glass';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------
// Z-20J "HaiDiao-1" Tactical Helicopter (Full 4K Matte Gunmetal PBR Materials)
// ---------------------------------------------------------------------------
function makeHeli(
  hullMat: THREE.Material,
  darkMat: THREE.Material,
  glassMat: THREE.Material,
  stripeMat: THREE.Material,
): { heli: THREE.Group; rotor: THREE.Object3D; tail: THREE.Object3D } {
  const heli = new THREE.Group();
  const mkBox = (w: number, h: number, d: number, m: THREE.Material) => {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleUVs(g, w, h, d, 2.0);
    g.setAttribute('uv2', g.attributes.uv.clone());
    return new THREE.Mesh(g, m);
  };
  const body = mkBox(2.6, 2.1, 8.8, hullMat);
  body.position.set(0, 1.35, 0);
  const nose = mkBox(2.3, 1.45, 2.6, hullMat);
  nose.position.set(0, 1.05, 5.2); nose.rotation.x = 0.22;
  const cockpit = mkBox(2.1, 0.9, 1.9, glassMat);
  cockpit.position.set(0, 1.65, 4.4); cockpit.rotation.x = 0.45;
  const boom = mkBox(0.85, 0.95, 7.6, hullMat);
  boom.position.set(0, 1.65, -7.8);
  const fin = mkBox(0.28, 2.5, 1.6, hullMat);
  fin.position.set(0, 2.65, -11.4); fin.rotation.x = -0.35;
  const stripe = mkBox(2.66, 0.20, 5.4, stripeMat);
  stripe.position.set(0, 1.2, 0.2);
  const skidL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.2, 8), darkMat);
  skidL.rotation.x = H; skidL.position.set(-1.35, 0.14, 0.4);
  const skidR = skidL.clone(); skidR.position.x = 1.35;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.0, 10), darkMat);
  mast.position.set(0, 2.75, 0.3);

  const rotor = new THREE.Group();
  rotor.position.set(0, 3.25, 0.3);
  for (let i = 0; i < 5; i++) {
    const blade = mkBox(0.26, 0.04, 6.8, darkMat);
    blade.position.set(0, 0, 3.4);
    const arm = new THREE.Group();
    arm.rotation.y = (i * Math.PI * 2) / 5;
    arm.add(blade);
    rotor.add(arm);
  }
  const tail = new THREE.Group();
  tail.position.set(0.32, 3.4, -11.6);
  for (let i = 0; i < 4; i++) {
    const b = mkBox(0.04, 1.25, 0.14, darkMat);
    b.rotation.x = (i * Math.PI) / 2;
    tail.add(b);
  }
  heli.add(body, nose, cockpit, boom, fin, stripe, skidL, skidR, mast, rotor, tail);
  heli.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { heli, rotor, tail };
}

// ---------------------------------------------------------------------------
// Build Full AAA Photorealistic Mission 2 Level ("喀拉干达 7 号油田与厄普西隆地下中继站")
// ---------------------------------------------------------------------------
export function buildOilfield(world: World, mats: Materials): LevelData & { oilfield: OilfieldDynamic } {
  world.baseGroundY = -12;
  const group = new THREE.Group();
  const staticPropsRoot = new THREE.Group();
  const b = new OilfieldBuilder(world);

  // =========================================================================
  // AAA 4K Poly Haven Scanned PBR Palette (Modern Warfare / Battlefield 4 Color Grading)
  // Zero vertexColors trap, full Normal + ARM + AO + MacroVariation + Grime + Micro-Detail + POM!
  // =========================================================================
  const cliffMat = makeScannedMat('concrete', {
    color: 0xa69480,
    roughness: 0.95,
    metalness: 0.02,
    normalScale: 2.0,
    aoIntensity: 0.78,
    detail: [0.92, 11],
  });
  applyGobiCliffShader(cliffMat);

  const concreteWallMat = makeScannedMat('concrete', {
    color: 0xc2b9ad, roughness: 0.88, metalness: 0.04, normalScale: 1.38, aoIntensity: 0.72,
    macro: [0.26, 0.08, 0.48], grime: [0.85, 0.38], detail: [0.84, 7], pom: [0.016, 10],
  });
  applyConcretePanels(concreteWallMat, 2.6, 1.55, 0.88);

  const bunkerWallMat = makeScannedMat('concrete', {
    color: 0x62707e, roughness: 0.74, metalness: 0.18, normalScale: 1.38, aoIntensity: 0.76,
    macro: [0.24, 0.07, 0.44], grime: [0.78, 0.12], detail: [0.84, 7], pom: [0.015, 10],
  });
  applyConcretePanels(bunkerWallMat, 2.4, 1.45, 0.82);

  // Industrial diamond-plate anti-slip steel tread & catwalk grating (uses baked 1K PBR deck_tread!)
  const dtTex = assets.shipTex.deck_tread;
  const makeTreadMat = (hex: number, rough: number, metal: number) => {
    const mat = dtTex
      ? new THREE.MeshStandardMaterial({
          map: dtTex.map, normalMap: dtTex.normalMap, normalScale: new THREE.Vector2(1.45, 1.45),
          roughnessMap: dtTex.armMap, aoMap: dtTex.armMap, aoMapIntensity: 0.74,
          color: hex, roughness: rough, metalness: metal, vertexColors: false,
        })
      : makeScannedMat('metal', { color: hex, roughness: rough, metalness: metal, normalScale: 1.3, aoIntensity: 0.68 });
    applyGrime(mat, 0.56, 0.34);
    applyDetail(mat, 0.82, 9);
    return mat;
  };

  // Weathered industrial black-and-yellow safety hazard chevron PBR material
  const chevTex = makeHazardChevronTextures();
  const chevronMat = new THREE.MeshStandardMaterial({
    map: chevTex.map, normalMap: chevTex.normalMap, normalScale: new THREE.Vector2(1.25, 1.25),
    roughnessMap: chevTex.roughnessMap, color: 0xffffff, roughness: 0.82, metalness: 0.24, vertexColors: false,
  });
  applyGrime(chevronMat, 0.62, 0.32);

  const hazardMat = makeScannedMat('metal', {
    color: 0xa28238, roughness: 0.66, metalness: 0.28, normalScale: 1.22, aoIntensity: 0.68,
    grime: [0.68, 0.38], detail: [0.82, 8],
  });
  applySurfacePatina(hazardMat, 0.42, 3.6);

  const pbr: Record<PbrKey, THREE.Material> = {
    sand: makeScannedMat('sand', {
      color: 0xdcc6a2, roughness: 0.94, metalness: 0.02, normalScale: 1.35, aoIntensity: 0.52,
      macro: [0.24, 0.06, 0.55], detail: [0.65, 11],
    }),
    asphalt: makeScannedMat('asphalt', {
      color: 0xc8c4bc, roughness: 0.90, metalness: 0.03, normalScale: 1.35, aoIntensity: 0.45,
      macro: [0.26, 0.08, 0.52], grime: [0.35, 0.42], detail: [0.68, 9], pom: [0.012, 8],
    }),
    concrete: concreteWallMat,
    cinder: makeScannedMat('cinder', {
      color: 0xbeb2a0, roughness: 0.90, metalness: 0.03, normalScale: 1.35, aoIntensity: 0.70,
      macro: [0.30, 0.10, 0.45], grime: [0.82, 0.32], detail: [0.80, 7], pom: [0.018, 12],
    }),
    hesco: makeScannedMat('hesco', {
      color: 0xc8b79a, roughness: 0.92, metalness: 0.02, normalScale: 1.25, aoIntensity: 0.62,
      grime: [0.45, 0.28], detail: [0.75, 7],
    }),
    steel: makeScannedMat('metal', {
      color: 0x565d65, roughness: 0.58, metalness: 0.70, normalScale: 1.22, aoIntensity: 0.66,
      grime: [0.58, 0.36], detail: [0.84, 7],
    }),
    catwalk: makeTreadMat(0x889098, 0.56, 0.66),
    tread: makeTreadMat(0x747c84, 0.58, 0.64),
    rust: makeScannedMat('corrugated', {
      color: 0x865742, roughness: 0.78, metalness: 0.44, normalScale: 1.35, aoIntensity: 0.70,
      grime: [0.72, 0.38], detail: [0.85, 8], pom: [0.022, 10],
    }),
    hazard: hazardMat,
    chevron: chevronMat,
    bunker: bunkerWallMat,
    bunkerFloor: makeScannedMat('slab', {
      color: 0x525d68, roughness: 0.66, metalness: 0.16, normalScale: 1.25, aoIntensity: 0.70,
      macro: [0.25, 0.08, 0.44], grime: [0.52, 0.08], detail: [0.80, 8], pom: [0.014, 10],
    }),
    cliff: cliffMat,
    glass: mats.glass,
  };

  // Semantic 4K PBR Material Map for ALL 7 Blender Hero GLBs (replaces untextured Principled BSDFs!)
  const glbPbr: Record<string, THREE.Material> = {
    MAT_CONC_BASE: pbr.concrete,
    MAT_STEEL_DARK: pbr.steel,
    MAT_RUST_IRON: pbr.rust,
    MAT_HAZARD_WARN: pbr.hazard,
    MAT_STEEL_BRUSHED: makeScannedMat('metal', {
      color: 0x767d84, roughness: 0.50, metalness: 0.68, normalScale: 1.15, aoIntensity: 0.65,
      grime: [0.58, 0.34], detail: [0.82, 7],
    }),
    MAT_STEEL_ARMOR: makeScannedMat('metal', {
      color: 0x596068, roughness: 0.58, metalness: 0.62, normalScale: 1.25, aoIntensity: 0.72,
      grime: [0.75, 0.32], detail: [0.85, 8],
    }),
    MAT_PAINT_OCHRE: makeScannedMat('metal', {
      color: 0x8e7442, roughness: 0.72, metalness: 0.28, normalScale: 1.20, aoIntensity: 0.68,
      grime: [0.72, 0.42], detail: [0.82, 7],
    }),
    MAT_PAINT_TANK: makeScannedMat('metal', {
      color: 0xa29b8e, roughness: 0.70, metalness: 0.26, normalScale: 1.20, aoIntensity: 0.68,
      macro: [0.25, 0.09, 0.38], grime: [0.88, 0.44], detail: [0.82, 7],
    }),
    MAT_PAINT_CAB: makeScannedMat('metal', {
      color: 0x7d6e52, roughness: 0.70, metalness: 0.24, normalScale: 1.15, aoIntensity: 0.65,
      grime: [0.76, 0.44], detail: [0.80, 7],
    }),
    MAT_PAINT_CRIMSON: makeScannedMat('metal', {
      color: 0x72362d, roughness: 0.68, metalness: 0.24, normalScale: 1.18, aoIntensity: 0.68,
      grime: [0.74, 0.38], detail: [0.82, 7],
    }),
    MAT_TANKER_CHROME: makeScannedMat('metal', {
      color: 0x868b90, roughness: 0.46, metalness: 0.68, normalScale: 1.10, aoIntensity: 0.65,
      grime: [0.68, 0.36], detail: [0.82, 7],
    }),
    MAT_DISH_PANEL: makeScannedMat('metal', {
      color: 0x90928f, roughness: 0.66, metalness: 0.28, normalScale: 1.15, aoIntensity: 0.65,
      grime: [0.65, 0.42], detail: [0.80, 7],
    }),
    MAT_TIRE_RUBBER: makeScannedMat('asphalt', {
      color: 0x262628, roughness: 0.92, metalness: 0.02, normalScale: 1.30, aoIntensity: 0.75,
      detail: [0.75, 10],
    }),
    MAT_GLASS_TINT: new THREE.MeshStandardMaterial({
      color: 0x101c24, metalness: 0.84, roughness: 0.10, envMapIntensity: 1.55,
    }),
    MAT_SERVER_CHASSIS: makeScannedMat('metal', {
      color: 0x2c323a, roughness: 0.50, metalness: 0.66, normalScale: 1.05, aoIntensity: 0.68,
      detail: [0.75, 8],
    }),
    MAT_SERVER_FACE: makeScannedMat('metal', {
      color: 0x464e58, roughness: 0.42, metalness: 0.74, normalScale: 1.05, aoIntensity: 0.68,
      detail: [0.75, 8],
    }),
    MAT_LED_CYAN: new THREE.MeshStandardMaterial({
      color: 0x28d4f0, emissive: 0x22c8ee, emissiveIntensity: 3.4, roughness: 0.2,
    }),
    MAT_LED_AMBER: new THREE.MeshStandardMaterial({
      color: 0xf08c24, emissive: 0xe6821c, emissiveIntensity: 3.0, roughness: 0.2,
    }),
    MAT_BEACON_RED: new THREE.MeshStandardMaterial({
      color: 0xff2818, emissive: 0xff2414, emissiveIntensity: 4.5, roughness: 0.2,
    }),
  };

  // Balanced cinematic Gobi desert sky-bounce fill (keeps warm sunlight contrast without crushing shadows!)
  const gobiHemi = new THREE.HemisphereLight(0xfbe6c4, 0x9a7f60, 0.72);
  group.add(gobiHemi);

  // Deduplicate & bind semantic 4K PBR materials onto every Blender GLB mesh!
  const sharedGlbMat = new Map<string, THREE.Material>();
  const resolveMat = (mat: THREE.Material): THREE.Material => {
    const key = mat.name || mat.uuid;
    if (glbPbr[key]) return glbPbr[key];
    // Handle Blender duplicate suffix like MAT_STEEL_DARK.001
    const base = key.split('.')[0];
    if (glbPbr[base]) return glbPbr[base];
    let cached = sharedGlbMat.get(key);
    if (!cached) { cached = mat; sharedGlbMat.set(key, cached); }
    return cached;
  };

  /** Collapse all static child meshes of a local subtree by material (cuts animated GLB draw calls by 15x!). */
  const collapseLocalByMat = (node: THREE.Object3D, skipPivotName?: string) => {
    node.updateMatrixWorld(true);
    const invRoot = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const skipNode = skipPivotName ? node.getObjectByName(skipPivotName) : null;
    const isUnderSkip = (o: THREE.Object3D): boolean => {
      if (!skipNode) return false;
      let cur: THREE.Object3D | null = o;
      while (cur) { if (cur === skipNode) return true; cur = cur.parent; }
      return false;
    };
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const toRemove: THREE.Object3D[] = [];
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || Array.isArray(m.material) || isUnderSkip(m)) return;
      const mat = resolveMat(m.material);
      const g = normGeo(m.geometry);
      const rel = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(rel);
      let list = buckets.get(mat);
      if (!list) buckets.set(mat, (list = []));
      list.push(g);
      toRemove.push(m);
    });
    for (const r of toRemove) r.parent?.remove(r);
    for (const [mat, list] of buckets) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      node.add(mesh);
    }
    // Also collapse inside the animated pivot itself so each animated head is ~3 draw calls instead of 20!
    if (skipNode) collapseLocalByMat(skipNode);
  };

  const cloneRaw = (
    name: RawModelName, x: number, y: number, z: number, rotY = 0, scale = 1, mergeStatic = true, pivotName?: string,
  ) => {
    const inst = assets.gltf[name].scene.clone(true);
    inst.position.set(x, y, z);
    inst.rotation.y = rotY;
    inst.scale.setScalar(scale);
    inst.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (m.geometry && m.geometry.attributes.uv && !m.geometry.attributes.uv2) {
          m.geometry.setAttribute('uv2', m.geometry.attributes.uv.clone());
        }
        if (!Array.isArray(m.material)) m.material = resolveMat(m.material);
      }
    });
    if (mergeStatic) {
      staticPropsRoot.add(inst);
    } else {
      collapseLocalByMat(inst, pivotName);
      group.add(inst);
    }
    return inst;
  };

  // Weathered desert material overrides for props whose default grey:0.8 reads clinical white in bright Gobi sun
  const propMatCache = new Map<string, THREE.Material>();
  const tintPropMat = (mat: THREE.Material, hex: number): THREE.Material => {
    const k = `${mat.uuid}_${hex}`;
    let c = propMatCache.get(k);
    if (!c) {
      const cl = mat.clone() as THREE.MeshStandardMaterial;
      cl.name = k;
      if (cl.color) cl.color.multiply(new THREE.Color(hex));
      c = cl;
      propMatCache.set(k, c);
    }
    return c;
  };
  const PROP_TINTS: Partial<Record<PropName, number>> = {
    barrel: 0x6b5646,
    container: 0x5c6458,
    veh_offroad: 0x726a5a,
    veh_truck: 0x786e5c,
    veh_forklift: 0x826c48,
    dumpster: 0x586258,
  };

  const addProp = (name: PropName, x: number, y: number, z: number, rotY = 0, scale = 1) => {
    const obj = makePropObject(name, scale);
    if (!obj) return;
    const tint = PROP_TINTS[name];
    if (tint) {
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material)) m.material = tintPropMat(m.material, tint);
      });
    }
    obj.position.set(x, y, z);
    obj.rotation.y = rotY;
    staticPropsRoot.add(obj);
  };

  const addSign = (title: string, sub: string, x: number, y: number, z: number, rotY = 0, accent = '#c48f36') => {
    const s = makeIndustrialSign(title, sub, accent);
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    group.add(s);
  };

  // =========================================================================
  // 0. BASE DESERT TERRAIN SLABS (Recessed cleanly outside all Ramp, Bunker & Ascent-Shaft walls — ZERO Z-fighting!)
  // =========================================================================
  b.box('sand', -53.3, -1.0, 0, 141.4, 1.0, 248);       // West main desert: X = -124 .. +17.4 (0.6m West of ramp walls)
  b.box('sand', 26.4, -1.0, -61.5, 18.0, 1.0, 125.0);   // North of ramp:   X = +17.4 .. +35.4, Z = -124 .. +1.0 (flush with outer ramp face, 1.0m clear of inner face Z=2.0!)
  b.box('sand', 26.4, -1.0, 71.5, 18.0, 1.0, 105.0);    // South of ramp:   X = +17.4 .. +35.4, Z = +19.0 .. +124 (flush with outer ramp face, 1.0m clear of inner face Z=18.0!)
  b.box('sand', 79.7, -1.0, 77.35, 88.6, 1.0, 93.3);    // South of bunker: X = +35.4 .. +124,  Z = +30.7 .. +124 (outside bunker South wall Z=29.3..30.7)
  b.box('sand', 58.85, -1.0, -84.8, 46.9, 1.0, 78.4);   // North of bunker (West of ascent shaft): X = +35.4 .. +82.3, Z = -124 .. -45.6
  b.box('sand', 103.15, -1.0, -90.85, 41.7, 1.0, 66.3); // North of ascent shaft: X = +82.3 .. +124, Z = -124 .. -57.7 (100% clear of shaft X:83..105, Z:-57..-45!)
  b.box('sand', 115.35, -1.0, -13.5, 17.3, 1.0, 88.4);  // East of bunker:  X = +106.7 .. +124, Z = -57.7 .. +30.7 (outside bunker East wall X=105.3..106.7)

  // Monumental Sculpted Gobi Sandstone Perimeter Canyon Walls (ZERO INVISIBLE WALLS!)
  b.cliffBox(0, 0, -118, 244, 18, 9, { amp: 1.1 });
  b.cliffBox(0, 0, 116, 244, 16, 9, { amp: 1.1 });
  b.cliffBox(-118, 0, 0, 9, 17, 244, { amp: 1.1 });
  b.cliffBox(118, 0, 0, 9, 24, 244, { amp: 1.1 });
  // Natural stepped sandstone buttresses + real Poly Haven photogrammetry cliff scans around perimeter!
  for (let z = -102; z <= 102; z += 26) {
    b.cliffBox(-113, 0, z, 6, 7 + ((Math.abs(z) * 3) % 6), 16, { rotY: 0.10, amp: 0.85 });
    b.cliffBox(113, 0, z, 6, 10 + ((Math.abs(z) * 5) % 8), 16, { rotY: -0.09, amp: 0.85 });
    addProp('cliff', -111, -0.5, z + 6, H + ((z % 7) * 0.05), 1.9);
    addProp('cliff', 111, -0.5, z - 6, -H + ((z % 5) * 0.05), 2.1);
  }
  for (let x = -98; x <= 98; x += 28) {
    b.cliffBox(x, 0, -113, 20, 8 + ((Math.abs(x) * 3) % 6), 6, { rotY: -0.07, amp: 0.85 });
    // South perimeter buttress set back 2.5m to z=113.5 so the Zone 3 South Staircase foot at z=109.8 has clean open clearance!
    b.cliffBox(x, 0, 113.5, 20, 7 + ((Math.abs(x) * 5) % 5), 6, { rotY: 0.07, amp: 0.85 });
    addProp('cliff', x, -0.5, -111, 0, 1.9);
    addProp('cliff', x, -0.5, 111.5, Math.PI, 1.8);
  }

  // Physical Motorized Blast Gate Builder (Full 4K Armored Steel PBR, ZERO Invisible Walls!)
  const gates: OilfieldDynamic['gates'] = { g12: [], g23: [], g34: [], g45: [], g56: [] };
  const addBlastGate = (
    key: keyof OilfieldDynamic['gates'],
    cx: number, y: number, cz: number,
    width: number, height: number,
    rotY = 0,
  ) => {
    const scaleX = width / 8.4;
    const scaleY = height / 4.05;
    const door = assets.gltf.oil_blastgate.scene.clone(true);
    door.position.set(cx, y, cz);
    door.rotation.y = rotY;
    door.scale.set(scaleX, scaleY, 1.0);
    door.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (m.geometry && m.geometry.attributes.uv && !m.geometry.attributes.uv2) {
          m.geometry.setAttribute('uv2', m.geometry.attributes.uv.clone());
        }
        if (!Array.isArray(m.material)) m.material = resolveMat(m.material);
      }
    });
    collapseLocalByMat(door);
    group.add(door);

    const col = world.addBox(cx, y + height * 0.5, cz, width * 0.5, height * 0.5, 0.5, rotY, 'metal');
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff2818, emissive: 0xff2818, emissiveIntensity: 3.5, roughness: 0.25,
    });
    const beaconMesh = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.26, 0.34), beaconMat);
    beaconMesh.position.set(cx, y + height + 0.36, cz);
    beaconMesh.rotation.y = rotY;
    group.add(beaconMesh);
    const beaconLight = new THREE.PointLight(0xff3020, 14, 14, 1.6);
    beaconLight.position.set(cx, y + height + 0.15, cz);
    group.add(beaconLight);

    gates[key].push({
      id: key, mesh: door, col, closedY: y, openY: y + height + 0.25, openT: 0, isOpen: false, beaconMat, beaconLight,
    });
  };

  // =========================================================================
  // ZONE 1: 戈壁峡谷空降点与外围暗哨 (X: -112..-48, Z: -112..-45, Y: 0.0)
  // =========================================================================
  b.box('asphalt', -80, 0.01, -78, 13, 0.06, 68, { solid: false, road: true });
  b.box('concrete', -80, 0.02, -104, 12, 0.10, 12, { surf: 'concrete' });
  // Subtle weathered road center stripe (low-contrast desert ochre, NOT bright neon!)
  b.box('hazard', -80, 0.08, -76, 0.28, 0.02, 48, { solid: false });
  // Sculpted Gobi sandstone cliffs flanking Zone 1 + dense Poly Haven photogrammetry rocks & scrub
  b.cliffBox(-112, 0, -78, 8, 13, 68, { amp: 0.95 });
  b.cliffBox(-46, 0, -78, 6, 12, 68, { amp: 0.90 });
  addProp('cliff', -108.5, -0.3, -94, H + 0.1, 1.75);
  addProp('cliff', -108.5, -0.3, -60, H - 0.12, 1.7);
  addProp('cliff', -49.5, -0.3, -92, -H + 0.08, 1.65);
  addProp('cliff', -49.5, -0.3, -64, -H - 0.1, 1.65);

  // West stepped sniper/overwatch rock shelf (Y = +3.2m, flat walkable top!)
  b.cliffBox(-101, 0, -72, 12, 3.2, 34, { flatTop: true, amp: 0.55 });
  b.stairs('z', -101, -95, -89, 0, 3.2, 5.0, 'cliff', false);
  b.stairs('z', -101, -55, -49, 3.2, 0, 5.0, 'cliff', false);
  b.cover(-96, 3.2, -78, 1.0, 4.5, false, 0, 'hesco');
  b.cover(-96, 3.2, -65, 1.0, 4.5, false, 0, 'hesco');
  addProp('sandbags', -95.2, 3.2, -71.5, H, 1.15);
  addProp('boulder_a', -106, 3.2, -72, 0.4, 1.45);
  addProp('boulder_b', -94, 0, -98, 1.2, 1.6);
  addProp('boulder_c', -64, 0, -101, -0.5, 1.5);
  addProp('boulder_a', -91, 0, -61, 0.8, 1.25);
  addProp('stones', -89, 0, -97, 0.3, 1.4);
  addProp('stones', -68, 0, -92, 1.8, 1.5);
  addProp('bush_m', -92, 0, -102, 0.4, 1.4);
  addProp('bush_s', -66, 0, -96, 2.1, 1.3);
  addProp('bush_m', -52, 0, -86, 1.2, 1.5);

  // Wrecked Blender Oil Tanker Truck angled across center canyon road + military barriers
  cloneRaw('oil_tanker', -79, 0, -83, 0.22, 0.95);
  world.addBox(-79, 1.5, -83, 1.7, 1.5, 5.1, 0.22, 'metal');
  b.cover(-85, 0, -90, 4.2, 1.0, false, 0.15, 'concrete');
  b.cover(-74, 0, -73, 4.4, 1.0, false, -0.1, 'hesco');
  b.cover(-84, 0, -64, 3.8, 1.2, true, 0.08, 'hesco');
  b.cover(-75, 0, -56, 4.0, 1.0, false, 0, 'concrete');
  addProp('jersey', -73.5, 0, -93, 0.1, 1.05);
  addProp('jersey', -86.5, 0, -76, -0.15, 1.05);
  addProp('sandbags', -85, 0, -88.8, 0.15, 1.15);
  addProp('sandbags', -74, 0, -71.8, -0.1, 1.15);
  addProp('mil_crate', -88, 0, -94, 0.3, 1.15);
  addProp('ammo_box', -87.2, 0, -92.5, 0.6, 1.1);
  addProp('barrel', -71.5, 0, -80, 0.4, 1.05);
  addProp('barrel', -70.6, 0, -79.2, 1.1, 1.05);
  addProp('barbed_wire', -92, 0, -52, 0, 1.15);
  addProp('flood_lights', -71.5, 0, -49.5, -2.5, 1.1);
  addProp('street_lamp', -72.5, 0, -52, -H, 1.1);
  // Parked tactical SUV cleanly on east road shoulder (>2m clear of x=-66 concrete culvert wall) + matching physical cover collider
  addProp('veh_offroad', -70.2, 0, -61.5, 1.82, 1.0);
  world.addBox(-70.2, 1.25, -61.5, 2.45, 1.25, 1.05, 1.82, 'metal');

  // East stealth drainage culvert flank lane (X: -64..-52) + reinforced concrete wall pilasters
  b.box('concrete', -66, 0, -76, 1.2, 1.85, 36);
  for (let cz = -92; cz <= -60; cz += 8) {
    b.box('steel', -66, 0, cz, 1.44, 1.95, 0.36, { solid: false });
  }
  b.box('steel', -66, 1.85, -76, 1.38, 0.12, 36.2, { solid: false });
  b.pipe('rust', -58, 0.9, -82, 0.9, 6.0, 'z', true);
  b.pipe('rust', -58, 0.9, -66, 0.9, 6.0, 'z', true);
  b.cover(-55, 0, -55, 3.0, 1.0, false, 0, 'hesco');
  addProp('pallet', -62, 0, -70, 0.3, 1.1);

  // Zone 1 -> Zone 2 Armored Checkpoint Wall, Fortified Guardhouse Canopy & Physical Blast Gates (Z = -45)
  b.wall('concrete', 'x', -45, -110, -48, 0, 5.2, 0.9, [
    { at: -80, w: 8.5, h: 4.2 },
    { at: -56, w: 3.6, h: 3.2 },
  ]);
  b.box('steel', -79, 5.2, -45, 62, 0.35, 1.05, { solid: true }); // Heavy weathered steel coping beam
  // Structural vertical blast-wall buttress pilasters along Zone 1 security wall
  for (const px of [-104, -95, -70, -62, -50]) b.box('steel', px, 0, -45.55, 0.55, 5.2, 0.42, { solid: false });
  // Fortified Checkpoint Guardhouse with recessed observation windows, steel sills & cantilevered road inspection canopy!
  b.box('cinder', -88.5, 0, -48.5, 6.0, 3.8, 5.2);
  b.box('steel', -88.5, 3.8, -48.5, 6.5, 0.32, 5.7); // Overhanging guardhouse steel roof slab
  for (const [gx, gz] of [[-91.4, -51.0], [-85.6, -51.0], [-91.4, -46.0], [-85.6, -46.0]]) {
    b.box('steel', gx, 0, gz, 0.36, 3.8, 0.36, { solid: false });
  }
  // Recessed armored glass observation windows facing south road & east inspection lane
  b.box('glass', -88.5, 1.65, -51.14, 3.6, 1.35, 0.12, { solid: false });
  b.box('steel', -88.5, 1.50, -51.20, 3.9, 0.16, 0.28, { solid: false });
  b.box('steel', -88.5, 3.00, -51.20, 3.9, 0.16, 0.28, { solid: false });
  b.box('glass', -85.46, 1.65, -48.5, 0.12, 1.35, 2.8, { solid: false });
  b.box('steel', -85.40, 1.50, -48.5, 0.28, 0.16, 3.1, { solid: false });
  // Overhanging steel vehicle-inspection checkpoint canopy spanning over the main road gate (x=-80)
  b.box('steel', -80, 4.75, -48.2, 12.6, 0.38, 4.8, { solid: false });
  b.box('chevron', -80, 4.58, -50.56, 12.2, 0.24, 0.12, { solid: false, tile: 1.4 });
  b.column(-74.2, 0, 4.75, -50.1, 0.34);
  b.column(-85.4, 0, 4.75, -50.1, 0.34);
  addProp('aircon_rust', -85.4, 2.4, -46.2, H, 1.05);
  addProp('utility_box', -85.4, 0, -46.8, H, 1.05);
  b.box('steel', -80, 4.2, -45, 11.4, 0.62, 2.2);
  // Yellow steel checkpoint bollards & weathered diagonal chevron warning apron striping
  for (const bx of [-84.6, -75.4]) b.cyl('hazard', bx, 0, -47.2, 0.12, 0.95, 10, true, 'metal');
  b.box('chevron', -80, 0.03, -47.8, 8.6, 0.03, 0.48, { solid: false });
  addBlastGate('g12', -80, 0, -45, 8.4, 4.15, 0);
  addBlastGate('g12', -56, 0, -45, 3.55, 3.15, 0);
  // Twin steel sign stanchion posts anchoring Checkpoint 01 sign cleanly into wall coping
  for (const sx of [-83.2, -76.8]) b.box('steel', sx, 5.2, -45.55, 0.22, 1.4, 0.22, { solid: false });
  addSign('01 号安全检查站 · 采油区', 'CHECKPOINT 01 · KARAGANDA FIELD SEC-02', -80, 5.65, -45.55, Math.PI);

  // =========================================================================
  // ZONE 2: 荒漠采油区与雇佣兵前哨 (X: -112..-48, Z: -45..+35, Y: 0.0)
  // =========================================================================
  b.box('asphalt', -80, 0.01, -5, 12, 0.06, 80, { solid: false, road: true });
  b.box('concrete', -46.5, 0, -5, 1.5, 6.4, 80); // Physical blast wall separating Zone 2 & Zone 4
  b.box('steel', -46.5, 6.4, -5, 1.7, 0.35, 80);
  // Heavy architectural blast-wall buttress ribs along Zone 2 / Zone 4 dividing wall
  for (let wz = -38; wz <= 28; wz += 11) b.box('steel', -47.35, 0, wz, 0.42, 6.4, 0.56, { solid: false });

  // 4 Detailed 4K PBR Blender 4.2 Oil Pumpjacks ("磕头机") with live animated WalkingBeam pivots!
  const animatedBeams: THREE.Object3D[] = [];
  for (const [px, pz, ry] of [[-98, -26, 0], [-96, 8, Math.PI], [-73, -15, 0], [-75, 19, Math.PI]]) {
    const pj = cloneRaw('oil_pumpjack', px, 0, pz, ry, 1.0, false, 'WalkingBeam');
    const beam = pj.getObjectByName('WalkingBeam');
    if (beam) animatedBeams.push(beam);
    world.addBox(px, 2.4, pz, 2.1, 2.4, 4.8, ry, 'metal');
  }

  // East 2-Story Mercenary Barracks & Fortified Sniper Watchtower (X: -62..-48, Z: -22..+12)
  b.wall('cinder', 'z', -62, -22, 12, 0, 3.8, 0.5, [{ at: -12, w: 3.0, h: 2.8 }, { at: 4, w: 3.0, h: 2.8 }]);
  b.wall('cinder', 'x', -22, -62, -48, 0, 3.8, 0.5, [{ at: -55, w: 2.8, h: 2.8 }]);
  b.wall('cinder', 'x', 12, -62, -48, 0, 3.8, 0.5, [{ at: -55, w: 2.8, h: 2.8 }]);
  // Steel doorway frames & lintels on all 4 ground-floor barracks portals + structural corner & bay pilasters!
  b.doorFrame('z', -62, -12, 0, 3.0, 2.8, 0.5);
  b.doorFrame('z', -62, 4, 0, 3.0, 2.8, 0.5);
  b.doorFrame('x', -22, -55, 0, 2.8, 2.8, 0.5);
  b.doorFrame('x', 12, -55, 0, 2.8, 2.8, 0.5);
  for (const bz of [-22, -16, -4, 9, 12]) b.box('steel', -62.2, 0, bz, 0.42, 4.15, 0.42, { solid: false });
  // Armored recessed tactical firing-slit windows along West barracks facade
  for (const wz of [-19, -4, 9]) {
    b.box('glass', -62.28, 1.85, wz, 0.12, 0.95, 2.4, { solid: false });
    b.box('steel', -62.30, 1.72, wz, 0.24, 0.14, 2.7, { solid: false });
    b.box('steel', -62.30, 2.80, wz, 0.24, 0.14, 2.7, { solid: false });
  }
  b.box('concrete', -55, 3.8, -5, 14.5, 0.35, 34.5);
  b.box('steel', -62.25, 3.82, -5, 0.28, 0.38, 34.8, { solid: false }); // West slab edge steel fascia
  b.wall('hesco', 'z', -62, -22, 12, 4.15, 1.05, 0.38, [{ at: -16, w: 3.4, h: 1.05 }]);
  b.box('hesco', -55, 4.15, -22, 14, 1.05, 0.38);
  b.box('hesco', -55, 4.15, 12, 14, 1.05, 0.38);
  b.stairs('z', -64.2, -26, -17, 0, 4.15, 2.8, 'tread', true);
  b.box('catwalk', -63.4, 3.93, -15.6, 3.4, 0.22, 3.0, { surf: 'metal' });
  b.column(-64.8, 0, 3.93, -14.4, 0.32); // Grounded column under 2F stair landing
  // Sniper Watchtower on SE corner (Y = +4.15 -> +7.8m) + Corrugated Steel Roof Canopy!
  b.box('catwalk', -53, 7.6, 6, 7.5, 0.35, 7.5, { surf: 'metal' });
  for (const [sx, sz] of [[-56.4, 2.6], [-49.6, 2.6], [-56.4, 9.4], [-49.6, 9.4]]) {
    b.box('steel', sx, 4.15, sz, 0.45, 6.45, 0.45);
  }
  b.box('rust', -53, 10.6, 6, 8.2, 0.24, 8.2, { solid: false }); // Watchtower shaded steel canopy roof
  b.box('steel', -53, 10.45, 6, 8.4, 0.18, 8.4, { solid: false });
  b.stairs('z', -58.2, -6, 2.8, 4.15, 7.95, 2.4, 'tread', true);
  b.box('catwalk', -57.6, 7.6, 4.3, 2.8, 0.35, 3.0, { surf: 'metal' });
  b.column(-58.7, 4.15, 7.6, 5.5, 0.26);
  // Open 3.2m walk-in entrance at stair landing (Z: 2.8..6.0); HESCO firing parapets on West-South & North overlook edges!
  b.cover(-56.2, 7.95, 7.8, 0.5, 3.2, false, 0, 'hesco');
  b.cover(-53.0, 7.95, 2.6, 5.6, 0.45, false, 0, 'hesco');
  b.box('steel', -53.0, 8.92, 9.5, 6.6, 0.08, 0.08, { solid: false });
  b.box('steel', -53.0, 8.45, 9.5, 6.6, 0.06, 0.06, { solid: false });
  addProp('searchlight', -55.6, 7.95, 8.3, -H, 1.2);
  addProp('generator', -59, 0, -24, 0.2, 1.15);
  addProp('aircon_rust', -62.4, 2.4, -3, -H, 1.1);
  addProp('utility_box', -62.4, 0, -6, -H, 1.05);
  addProp('dumpster', -64, 0, 15, 0.15, 1.1);
  addProp('veh_truck', -55, 0, -34, 0.2, 1.0);
  addProp('container', -105, 0, -14.8, 0.05 + H, 1.0);
  world.addBox(-105, 1.3, -14.8, 1.25, 1.3, 3.08, 0.05, 'metal');

  // West Sandbagged Mortar & Radar Jammer Pit (Objective C4 Target!)
  b.cover(-92, 0, -6, 1.2, 7.0, false, 0, 'hesco');
  b.cover(-92, 0, 20, 1.2, 7.0, false, 0, 'hesco');
  b.cover(-103, 0, -10, 6.5, 1.2, true, 0, 'hesco');
  b.cover(-103, 0, 24, 6.5, 1.2, false, 0, 'hesco');
  addProp('sandbags', -91.5, 0, 6.5, H, 1.25);
  addProp('mil_crate', -96, 0, 14, 0.4, 1.1);
  addProp('ammo_box', -95, 0, 15.5, -0.3, 1.1);
  addProp('barbed_wire', -106, 0, 26, 0.2, 1.1);
  const jammerGroup = new THREE.Group();
  jammerGroup.position.set(OILFIELD.z2Jammer.x, 0, OILFIELD.z2Jammer.z);
  const jBaseGeo = new THREE.BoxGeometry(2.2, 1.6, 1.6);
  scaleUVs(jBaseGeo, 2.2, 1.6, 1.6, 1.8); jBaseGeo.setAttribute('uv2', jBaseGeo.attributes.uv.clone());
  const jBase = new THREE.Mesh(jBaseGeo, glbPbr.MAT_STEEL_ARMOR);
  jBase.position.y = 0.8;
  const jMast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 4.8, 12), glbPbr.MAT_PAINT_OCHRE);
  jMast.position.y = 3.2;
  const jDish = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.3, 0.5, 18), glbPbr.MAT_DISH_PANEL);
  jDish.position.set(0, 5.3, 0); jDish.rotation.x = 0.6;
  jammerGroup.add(jBase, jMast, jDish);
  jammerGroup.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(jammerGroup);
  world.addBox(OILFIELD.z2Jammer.x, 0.8, OILFIELD.z2Jammer.z, 1.1, 0.8, 0.8, 0, 'metal');
  const jammerLight = new THREE.PointLight(0xff3822, 22, 20, 1.5);
  jammerLight.position.set(OILFIELD.z2Jammer.x, 5.5, OILFIELD.z2Jammer.z);
  group.add(jammerLight);

  // Central Oilfield Pipeline Spine with Grounded Concrete Pipe Cradles, Cover & Desert Dressing
  b.pipe('rust', -84.5, 0.75, -6, 0.46, 58, 'z', true);
  for (let pz = -32; pz <= 20; pz += 8) b.box('concrete', -84.5, 0, pz, 1.15, 0.58, 0.52, { solid: false });
  b.cover(-80, 0, -30, 4.5, 1.1, false, 0, 'concrete');
  b.cover(-80, 0, -6, 4.5, 1.1, false, 0, 'hesco');
  b.cover(-80, 0, 14, 4.5, 1.1, false, 0, 'concrete');
  b.cover(-68, 0, 25, 4.2, 1.2, true, 0, 'hesco');
  addProp('jersey', -81.6, 0, -34.2, 0.2, 1.05);
  addProp('barrel', -83.5, 0, 10, 0.3, 1.05);
  addProp('barrel', -82.6, 0, 10.9, 1.4, 1.05);
  addProp('pallet', -71, 0, -4, 0.6, 1.1);
  addProp('street_lamp', -73.4, 0, -25.5, 0, 1.1);
  addProp('street_lamp', -73.4, 0, 4.0, 0, 1.1);
  addProp('flood_lights', -71, 0, 28, -2.6, 1.1);
  addProp('boulder_b', -107, 0, -36, 0.7, 1.5);
  addProp('boulder_c', -108, 0, 28, 1.9, 1.4);
  addProp('bush_m', -104, 0, -39, 0.5, 1.4);
  addProp('bush_s', -88, 0, -38, 1.2, 1.3);

  // Zone 2 -> Zone 3 Tank-Farm Security Wall, Buttress Ribs & Physical Blast Gates (Z = +35)
  b.wall('concrete', 'x', 35, -114, -46, 0, 5.6, 0.9, [
    { at: -79, w: 9.0, h: 4.5 },
    { at: -55, w: 3.8, h: 3.4 },
  ]);
  b.box('steel', -80, 5.6, 35, 68, 0.35, 1.05);
  for (const px of [-106, -94, -68, -48]) b.box('steel', px, 0, 34.45, 0.55, 5.6, 0.42, { solid: false });
  b.box('chevron', -79, 0.03, 33.4, 9.2, 0.03, 0.48, { solid: false });
  addBlastGate('g23', -79, 0, 35, 8.9, 4.45, 0);
  addBlastGate('g23', -55, 0, 35, 3.75, 3.35, 0);
  for (const sx of [-82.2, -75.8]) b.box('steel', sx, 5.6, 34.5, 0.22, 1.4, 0.22, { solid: false });
  addSign('02 号储油罐区闸门', 'GATE 02 · CRUDE OIL TANK FARM SEC-03', -79, 5.95, 34.45, Math.PI);

  // =========================================================================
  // ZONE 3: 巨型储油罐阵与装车泵站 (X: -110..+20, Z: +35..+108, Y: 0.0 & +5.2)
  // =========================================================================
  b.box('asphalt', -46, 0.01, 72, 128, 0.06, 12, { solid: false, road: true });
  b.box('concrete', 22, 0, 74, 1.8, 7.2, 80); // Solid SE perimeter blast wall
  b.box('steel', 22, 7.2, 74, 2.0, 0.35, 80);

  // 6 Monumental 4K PBR Blender 4.2 Riveted Crude Storage Tanks (R = 8.2m, H = 9.4m)
  for (const tx of [-94, -66, -38]) {
    for (const tz of [56, 88]) {
      cloneRaw('oil_tank', tx, 0, tz, 0, 1.0);
      const hs = 8.2 * 0.84;
      world.addBox(tx, 4.6, tz, hs, 4.6, hs, 0, 'metal');
      world.addBox(tx, 4.6, tz, hs, 4.6, hs, Math.PI / 4, 'metal');
      b.cover(tx, 0, tz - 10.6, 8.0, 0.9, false, 0, 'concrete');
      b.cover(tx, 0, tz + 10.6, 8.0, 0.9, false, 0, 'concrete');
    }
  }
  // Overhead crude manifold pipes linking the tank farm + concrete pipe-support cradles & foam fire monitors!
  b.pipe('rust', -66, 1.4, 67.2, 0.42, 78, 'x', false);
  b.pipe('steel', -66, 1.4, 76.8, 0.38, 78, 'x', false);
  for (const cx of [-96, -80, -64, -48, -32]) {
    b.box('concrete', cx, 0, 67.2, 0.55, 1.05, 1.15, { solid: false });
    b.box('concrete', cx, 0, 76.8, 0.55, 1.05, 1.15, { solid: false });
  }
  for (const [fx, fz] of [[-82, 62.5], [-54, 62.5], [-82, 81.5], [-54, 81.5]] as [number, number][]) {
    b.cyl('hazard', fx, 0, fz, 0.16, 1.15, 10, false);
    b.box('hazard', fx, 1.12, fz, 0.46, 0.16, 0.18, { solid: false });
  }

  // Elevated 5.2m Tank-Farm Steel Catwalk Network + Grounded Structural H-Columns (ZERO floating walkways!)
  b.catwalk(-59.5, 5.2, 72, 87, 3.6, { e: true, w: false, n: true, s: true });
  for (const bx of [-80, -52, -24]) {
    b.catwalk(bx, 5.2, 57, 3.4, 26, { n: true, s: true });
    b.catwalk(bx, 5.2, 88, 3.4, 28, { n: true, s: true });
    // Paired structural steel H-columns with concrete footings supporting each catwalk spine cleanly outside road & stairs
    for (const cz of [45.5, 64.5, 79.5, 99.5]) {
      b.column(bx - 1.45, 0, 4.98, cz, 0.34);
      b.column(bx + 1.45, 0, 4.98, cz, 0.34);
    }
  }
  b.column(-98.0, 0, 4.98, 70.4, 0.36);
  b.column(-98.0, 0, 4.98, 73.6, 0.36);
  b.cover(-80, 5.2, 72, 1.4, 1.4, false, 0, 'steel');
  b.cover(-24, 5.2, 72, 1.4, 1.4, false, 0, 'steel');
  // 3 Wide Steel Staircases ascending Y=0 -> Y=+5.2m (100% unobstructed overhead & flush landings!)
  b.stairs('z', -80, 36.2, 44.0, 0, 5.2, 3.0, 'tread', true);
  b.stairs('z', -52, 109.8, 102.0, 0, 5.2, 3.0, 'tread', true);
  b.stairs('x', 72, -5.5, -16.0, 0, 5.2, 3.0, 'tread', true);

  // Objective Valves #1 (Catwalk) & #2 (Pump Bay) — PBR textured iron + crimson handwheel
  const makeValve = (x: number, y: number, z: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.2, 14), pbr.rust);
    body.position.y = 0.6;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.08, 8, 18), glbPbr.MAT_PAINT_CRIMSON);
    wheel.position.set(0, 1.25, 0);
    wheel.rotation.x = H;
    const light = new THREE.PointLight(0xff4228, 16, 15, 1.6);
    light.position.set(0, 1.9, 0);
    g.add(body, wheel, light);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(g);
    return { wheel, light };
  };
  const v1 = makeValve(OILFIELD.z3Valve1.x, OILFIELD.z3Valve1.y, OILFIELD.z3Valve1.z);
  const v2 = makeValve(OILFIELD.z3Valve2.x, OILFIELD.z3Valve2.y, OILFIELD.z3Valve2.z);

  // East Fuel-Truck Loading Pump Station Canopy (raised to Y=8.8..9.6m for 3.6m clear headroom over Y=5.2m catwalk & stairs!)
  b.box('rust', 2, 9.15, 72, 26, 0.45, 52);
  b.box('steel', 2, 8.8, 72, 26.2, 0.35, 52.2, { solid: false });
  for (const cz of [50, 72, 94]) {
    // At cz=72, offset West canopy columns to Z=68.2 & Z=75.8 so the Z=72 staircase passes cleanly between them!
    if (cz === 72) {
      b.box('steel', -9, 0, 68.2, 1.1, 9.15, 1.1);
      b.box('steel', -9, 0, 75.8, 1.1, 9.15, 1.1);
      b.box('steel', 13, 0, 72, 1.1, 9.15, 1.1);
    } else {
      for (const cx of [-9, 13]) b.box('steel', cx, 0, cz, 1.1, 9.15, 1.1);
    }
    const pt = new THREE.PointLight(0xffb862, 34, 34, 1.5);
    pt.position.set(2, 8.35, cz);
    group.add(pt);
  }
  // High-clearance cross-bridge linking Tank Catwalk (X=-24) to East Upper Gate Catwalk (X=5) cleanly at Z=64.5 (3.6m below canopy!)
  b.catwalk(-9.5, 5.2, 64.5, 25.6, 3.2, { e: true, w: true });
  for (const tz of [54, 72, 90]) {
    cloneRaw('oil_tanker', 5.5, 0, tz, 0, 1.0);
    world.addBox(5.5, 1.6, tz, 1.6, 1.6, 5.4, 0, 'metal');
    if (tz !== 72) b.cover(-4, 0, tz, 1.2, 5.5, false, 0, 'concrete');
  }
  addProp('compressor', -6, 0, 62, 0.5, 1.15);
  addProp('mil_crate', -8, 0, 82, 0.2, 1.15);
  addProp('pallet', -10, 0, 64, 0.4, 1.15);
  addProp('barrel', -7, 0, 50, 0.2, 1.05);
  addProp('barrel', -6, 0, 50.8, 1.1, 1.05);
  addProp('veh_forklift', 16, 0, 64, -1.3, 1.05);
  addProp('dumpster', 16, 0, 86, -H, 1.1);
  addProp('jersey', -20, 0, 66, 0.2, 1.05);
  addProp('flood_lights', -22, 0, 46, 0.6, 1.1);
  addProp('ph_extinguisher', -9, 0, 72.8, 0, 1.1);

  // Zone 3 -> Zone 4 Dual-Level Entry Wall, Steel Buttresses & Physical Blast Gates (Z = +35, X: -46..+22)
  // Upper catwalk opening at x=5 spans full wall height (h=8.2) so the y=5.2..8.2m blast gate & player have unobstructed headroom!
  b.wall('concrete', 'x', 35, -46, 22, 0, 7.6, 1.0, [
    { at: -14, w: 9.0, h: 4.6 },
    { at: 5, w: 4.5, h: 8.2 },
  ]);
  b.box('steel', -12, 7.6, 35, 68, 0.35, 1.15, { solid: false });
  for (const px of [-38, -26, -4, 14]) b.box('steel', px, 0, 35.58, 0.56, 7.6, 0.44, { solid: false });
  b.box('chevron', -14, 0.03, 36.8, 9.2, 0.03, 0.48, { solid: false });
  b.catwalk(5, 5.2, 54, 3.8, 34, { n: true, s: true });
  b.column(3.3, 0, 4.98, 46, 0.34);
  b.column(6.7, 0, 4.98, 46, 0.34);
  b.column(3.3, 0, 4.98, 62, 0.34);
  b.column(6.7, 0, 4.98, 62, 0.34);
  b.stairs('z', 5, 37, 30, 5.2, 4.5, 3.6, 'catwalk', true);
  addBlastGate('g34', -14, 0, 35, 8.9, 4.55, 0);
  addBlastGate('g34', 5, 5.2, 35, 4.4, 3.0, 0);
  addSign('03 号催化裂解精炼区', 'GATE 03 · CATALYTIC REFINERY SEC-04', -14, 5.85, 34.35, 0);

  // =========================================================================
  // ZONE 4: 核心裂解精炼厂区 — 三层立体主战场 (X: -45..+35, Z: -35..+35)
  // =========================================================================
  b.box('asphalt', -8, 0.01, 0, 56, 0.06, 66, { solid: false, road: true });
  b.box('concrete', -5, 0, -36, 84, 8.0, 1.5);
  b.box('steel', -5, 8.0, -36, 84, 0.35, 1.7);
  for (let bx = -38; bx <= 30; bx += 14) b.box('steel', bx, 0, -35.15, 0.56, 8.0, 0.46, { solid: false });
  b.wall('concrete', 'z', 36, -36, 35, 0, 8.0, 1.2, [{ at: 10, w: 14.0, h: 6.2 }]);

  // 3 Towering 4K PBR Blender 4.2 Catalytic Cracking Columns (21m tall!)
  for (const [cx, cz, sc] of [[-6, -5, 1.05], [4, -5, 0.88], [-1, 6, 0.96]]) {
    cloneRaw('oil_cracker', cx, 0, cz, cx * 0.3, sc);
    const hs = 3.2 * sc * 0.84;
    world.addBox(cx, 10, cz, hs, 10, hs, 0, 'metal');
  }
  // Overhead industrial pipe bridges tying cracking columns into the refinery (offset cleanly clear of X=12 catwalk & stairs!)
  b.pipe('rust', -1, 7.2, -19.2, 0.36, 26, 'x', false);
  b.pipe('steel', -1, 7.9, -19.2, 0.28, 26, 'x', false);
  b.pipe('rust', 15.6, 7.2, 0, 0.34, 30, 'z', false);

  // Iconic 26m Refinery Burning Flare Stack (Concrete Plinth + Stabilizer Rings + Steel Crown Shroud + Layered Flame!)
  b.box('concrete', 19.5, 0, -16, 4.0, 1.4, 4.0, { surf: 'concrete' });
  b.box('steel', 19.5, 1.4, -16, 3.4, 0.28, 3.4, { solid: false });
  b.cyl('rust', 19.5, 1.4, -16, 1.15, 24.6, 16, true, 'metal');
  for (const ry of [6.5, 12.5, 18.5, 24.2]) {
    b.cyl('steel', 19.5, ry, -16, 1.42, 0.36, 16, false);
  }
  b.cyl('steel', 19.5, 25.8, -16, 1.55, 0.85, 16, false); // Flared steel burner crown shroud
  const flareOrb = new THREE.Group();
  flareOrb.position.set(19.5, 27.1, -16);
  const outerFlame = new THREE.Mesh(
    new THREE.ConeGeometry(1.45, 3.6, 12),
    new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: 0.88 }),
  );
  outerFlame.position.y = 1.1;
  const innerFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.82, 2.3, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd864 }),
  );
  innerFlame.position.y = 0.6;
  flareOrb.add(outerFlame, innerFlame);
  group.add(flareOrb);
  const flareLight = new THREE.PointLight(0xff7824, 75, 65, 1.5);
  flareLight.position.set(19.5, 27.8, -16);
  group.add(flareLight);

  // Mid-Level Steel Catwalk Ring (Y = +4.5m) & Upper Sniper Gantry (Y = +9.0m) + Grounded Support H-Columns!
  b.catwalk(-1, 4.5, -16, 28, 3.6, { e: true, w: true, n: false, s: true });
  b.catwalk(-1, 4.5, 16, 28, 3.6, { e: true, w: true, n: true, s: true });
  b.catwalk(-14, 4.5, 0, 3.6, 32, { n: true, s: true, w: true, e: true });
  b.catwalk(12, 4.5, 0, 3.6, 32, { n: true, s: true, w: true, e: true });
  b.catwalk(5, 4.5, 23, 3.6, 13, { n: true, s: true });
  for (const [cx, cz] of [
    [-15.5, -15.5], [-15.5, 0], [-15.5, 15.5],
    [-12.5, -15.5], [-12.5, 15.5],
    [10.5, -15.5], [10.5, 15.5],
    [13.5, -15.5], [13.5, 0], [13.5, 15.5],
    [3.4, 27.5], [6.6, 27.5],
    [-19.5, -1.6], [-19.5, 1.6],
  ]) b.column(cx, 0, 4.28, cz, 0.34);
  b.stairs('z', -14, 27, 17, 0, 4.5, 3.0, 'catwalk', true);
  b.stairs('z', 12, -27, -17, 0, 4.5, 3.0, 'catwalk', true);
  b.catwalk(-1, 9.0, -14, 24, 3.4, { e: true, w: true });
  b.catwalk(12, 9.0, -4, 3.4, 22, { n: true, s: true });
  // Structural steel riser columns carrying the 9.0m Sniper Gantry up from the 4.5m catwalk deck!
  for (const [cx, cz] of [[-12.5, -15.4], [0, -15.4], [10.5, -15.4], [13.5, -14.2], [13.5, -4], [13.5, 6.2]]) {
    b.box('steel', cx, 4.5, cz, 0.32, 4.28, 0.32, { solid: false });
  }
  b.stairs('z', 12, 15.2, 7.0, 4.5, 9.0, 2.8, 'tread', true);
  b.cover(-1, 9.0, -12.6, 4.5, 0.8, false, 0, 'steel');
  b.cover(10.6, 9.0, -4, 0.8, 4.5, false, 0, 'steel');

  // West 2-Story Refinery Panoramic Control Room (X: -43..-24, Z: -18..+16) — FULLY ENCLOSED 2F ARCHITECTURE + ROOF HVAC!
  b.wall('concrete', 'z', -24, -18, 16, 0, 4.5, 0.5, [{ at: -8, w: 3.4, h: 3.0 }, { at: 8, w: 3.4, h: 3.0 }]);
  b.wall('concrete', 'x', -18, -43, -24, 0, 4.5, 0.5, [{ at: -33, w: 3.2, h: 3.0 }]);
  b.wall('concrete', 'x', 16, -43, -24, 0, 4.5, 0.5, [{ at: -33, w: 3.2, h: 3.0 }]);
  // Steel doorway frames & lintels on all 4 1F Control Room entrances!
  b.doorFrame('z', -24, -8, 0, 3.4, 3.0, 0.5);
  b.doorFrame('z', -24, 8, 0, 3.4, 3.0, 0.5);
  b.doorFrame('x', -18, -33, 0, 3.2, 3.0, 0.5);
  b.doorFrame('x', 16, -33, 0, 3.2, 3.0, 0.5);
  b.box('concrete', -43, 0, -1, 0.7, 9.0, 34);
  b.box('concrete', -33.5, 4.2, -1, 19.5, 0.35, 34.5);
  b.box('concrete', -33.5, 8.8, -1, 19.5, 0.4, 34.5);
  // Complete 2F South Wall (Z=+16) & 2F North Wall (Z=-18, with stair entry gap at X=-37.5) + Panoramic Windows!
  b.box('concrete', -33.5, 4.55, 16, 19.2, 1.15, 0.48); // 2F South parapet spandrel
  b.box('concrete', -33.5, 8.15, 16, 19.2, 0.65, 0.48); // 2F South header spandrel
  b.box('glass', -33.5, 5.70, 16, 17.6, 2.45, 0.14, { solid: false });
  for (const mx of [-42.6, -38.0, -33.5, -29.0, -24.0]) b.box('steel', mx, 0, 16.05, 0.42, 9.2, 0.58, { solid: false });
  b.wall('concrete', 'x', -18, -43, -24, 4.55, 4.25, 0.48, [{ at: -37.5, w: 3.6, h: 3.1 }]);
  b.doorFrame('x', -18, -37.5, 4.55, 3.6, 3.1, 0.48);
  b.box('glass', -28.8, 5.70, -18.06, 8.2, 2.45, 0.14, { solid: false });
  for (const mx of [-42.6, -33.5, -24.0]) b.box('steel', mx, 0, -18.05, 0.42, 9.2, 0.58, { solid: false });
  // East panoramic observation window wall + overhanging steel cornice fascia + rooftop HVAC equipment!
  b.wall('concrete', 'z', -24, -18, 16, 4.55, 1.1, 0.4, [{ at: 0, w: 3.6, h: 1.1 }]);
  b.doorFrame('z', -24, 0, 4.55, 3.6, 3.1, 0.42);
  b.box('glass', -24, 5.65, -10, 0.14, 3.0, 15, { solid: false });
  b.box('glass', -24, 5.65, 9, 0.14, 3.0, 13, { solid: false });
  for (const mz of [-17, -11, -5, 4, 10, 15]) b.box('steel', -24, 5.65, mz, 0.28, 3.15, 0.28, { solid: false });
  // Projecting steel mid-band fascia (Y=4.2) & heavy steel roof cornice overhang (Y=9.05) + Rooftop HVAC & Antenna!
  b.box('steel', -33.5, 4.18, -1, 20.1, 0.36, 35.1, { solid: false });
  b.box('steel', -33.5, 9.05, -1, 20.6, 0.42, 35.6, { solid: false });
  b.box('steel', -34, 9.45, -8, 4.2, 1.45, 6.2, { solid: false });
  b.box('rust', -34, 9.45, 7, 3.6, 1.25, 4.8, { solid: false });
  b.cyl('steel', -36, 9.45, 0, 0.45, 2.4, 10, false);
  b.pipe('steel', -34, 10.1, -1, 0.28, 12, 'z', false);
  b.cover(-30, 4.55, -8, 2.2, 6.0, false, 0, 'bunker');
  b.cover(-30, 4.55, 7, 2.2, 6.0, false, 0, 'bunker');
  b.cover(-37, 4.55, 0, 3.0, 8.0, true, 0, 'bunker');
  b.catwalk(-19.5, 4.5, 0, 10, 3.8, { e: true, w: true });
  b.stairs('x', -20, -24, -36, 0, 4.55, 3.0, 'tread', true);
  b.box('catwalk', -37.6, 4.33, -19.2, 3.6, 0.22, 3.2, { surf: 'metal' });
  b.column(-39.1, 0, 4.33, -20.5, 0.32); // Grounded column under Control Room external stair landing!
  // Control Room Override Terminal + Authentic Interior Props + Lighting
  addProp('ph_laptop', OILFIELD.z4Console.x, OILFIELD.z4Console.y + 1.12, OILFIELD.z4Console.z, H, 1.2);
  addProp('field_radio', OILFIELD.z4Console.x, OILFIELD.z4Console.y + 1.12, OILFIELD.z4Console.z + 0.75, H, 1.1);
  addProp('office_desk', -35, 4.55, -10, H, 1.1);
  addProp('chair', -33.6, 4.55, -10, -H, 1.1);
  addProp('utility_box', -42.3, 4.55, 6, H, 1.1);
  addProp('ph_sec_cam', -24.5, 8.2, -14, -0.6, 1.2);
  addProp('ph_extinguisher', -26, 4.55, -14, 0, 1.1);
  b.cover(OILFIELD.z4Console.x, 4.55, OILFIELD.z4Console.z, 1.2, 2.4, false, 0, 'bunker');
  // 2F Control Room SCADA Telemetry Monitors along the main observation consoles (crisp industrial schematic displays!)
  const scadaTex = makeScadaScreenTexture('refinery');
  const scadaMat = new THREE.MeshStandardMaterial({
    map: scadaTex, emissiveMap: scadaTex, color: 0x1c323c, emissive: 0xffffff, emissiveIntensity: 1.35, roughness: 0.16, metalness: 0.12,
  });
  for (const sz of [-10.0, -6.2, 5.2, 9.0]) {
    b.box('steel', -29.2, 5.65, sz, 0.14, 0.85, 1.45, { solid: false });
    const mon = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.68), scadaMat);
    mon.position.set(-29.11, 6.08, sz);
    mon.rotation.y = H;
    group.add(mon);
  }
  const ctrlLight = new THREE.PointLight(0xff8c28, 24, 22, 1.5);
  ctrlLight.position.set(OILFIELD.z4Console.x - 1.5, 7.6, OILFIELD.z4Console.z);
  group.add(ctrlLight);
  const refLight = new THREE.PointLight(0xffb45c, 40, 48, 1.5);
  refLight.position.set(-2, 12.5, 0);
  group.add(refLight);

  // Refinery Yard Cover & Photogrammetry Industrial Dressing
  b.cover(-15, 0, 22, 5.0, 1.2, false, 0, 'concrete');
  b.cover(4, 0, 22, 5.0, 1.2, false, 0, 'hesco');
  b.cover(-18, 0, -24, 4.8, 1.2, true, 0, 'hesco');
  b.cover(2, 0, -24, 5.2, 1.2, false, 0, 'concrete');
  b.cover(18, 0, -4, 1.4, 6.0, false, 0, 'concrete');
  addProp('container', -28, 0, -28, 0.12 + H, 1.0);
  world.addBox(-28, 1.3, -28, 1.25, 1.3, 3.08, 0.12, 'metal');
  addProp('generator', 16, 0, -24, -0.4, 1.15);
  addProp('compressor', -20, 0, 18, 0.8, 1.1);
  addProp('flood_lights', 18, 0, 20, -2.2, 1.15);
  addProp('flood_lights', -18, 0, -28, 0.5, 1.15);
  addProp('barrel', 14, 0, -10, 0.2, 1.05);
  addProp('barrel', 14.9, 0, -9.2, 1.5, 1.05);
  addProp('pallet', -8, 0, 24, 0.3, 1.1);
  addProp('jersey', 15, 0, 15, 0.4, 1.05);

  // Zone 4 -> Zone 5 Underground Ramp Portal & Physical Blast Gate (X: +18..+37, Z: +2..+18)
  b.box('bunker', 26.4, -6.5, 1.5, 18.0, 9.5, 1.0);
  b.box('bunker', 26.4, -6.5, 18.5, 18.0, 9.5, 1.0);
  // Fill gap at top of ramp (X: 17.4..19.5, Z: 2.0..18.0) with clean asphalt threshold slab
  b.box('asphalt', 18.45, -1.0, 10, 2.1, 1.0, 16.0);
  b.box('concrete', 29.65, 2.4, 10, 11.5, 0.85, 16.0);
  // Concrete portal frame beams
  b.box('steel', 23.5, 2.0, 10, 0.8, 0.9, 16.0);
  b.stairs('x', 10, 19.5, 36.5, 0.0, -6.0, 16.0, 'asphalt', false);
  addBlastGate('g45', 36.0, -6.0, 10.0, 13.8, 6.1, H);
  addSign('04 号防爆气密闸 · 地下设施 B1', 'BLAST GATE 04 · SUBTERRANEAN DATA VAULT', 24, 4.6, 10, -H, '#48a4bc');

  // =========================================================================
  // ZONE 5: 厄普西隆地下卫星数据掩体 (X: +36..+106, Z: -45..+30, Y: -6.0 & -1.5)
  // =========================================================================
  b.box('bunkerFloor', 71, -7.0, -7.5, 72, 1.0, 78);
  b.box('bunker', 71.3, 2.6, -7.5, 69.4, 1.0, 75.0);
  b.box('bunker', 106, -6.0, -7.5, 1.4, 8.8, 75.0);
  b.box('bunker', 71.05, -6.0, 30, 71.3, 8.8, 1.4);
  b.wall('bunker', 'z', 36, -45, 30, -6.0, 6.0, 1.2, [{ at: 10, w: 14.0, h: 6.0 }]);
  b.wall('bunker', 'x', -45, 36.6, 106.7, -6.0, 8.8, 1.2, [{ at: 92, w: 12.0, h: 8.5 }]);
  b.wall('bunker', 'z', 48, -18, 28, -6.0, 8.6, 1.2, [{ at: 10, w: 7.0, h: 4.5 }, { at: -8, w: 4.2, h: 3.8 }]);
  b.cover(43, -6.0, 10, 1.2, 4.2, false, 0, 'steel');

  // AAA Subterranean Bunker Architectural Detailing: Structural Ceiling I-Beams, Wall Pilasters & Conduit Pipes!
  for (let bz = -36; bz <= 24; bz += 12) {
    b.box('steel', 71, 2.05, bz, 70, 0.55, 0.65, { solid: false });
    b.box('steel', 105.1, -6.0, bz, 0.55, 8.4, 0.72, { solid: false });
    b.box('steel', 36.9, -6.0, bz, 0.55, 8.4, 0.72, { solid: false });
  }
  for (let bx = 46; bx <= 98; bx += 13) {
    b.box('steel', bx, 2.15, -7.5, 0.5, 0.45, 74, { solid: false });
    b.box('steel', bx, -6.0, 29.4, 0.72, 8.4, 0.50, { solid: false });
  }
  // Overhead ventilation & cooling conduits inside the bunker
  b.pipe('steel', 71, 1.65, -14, 0.32, 66, 'x', false);
  b.pipe('rust', 71, 1.65, 22, 0.28, 66, 'x', false);

  // Central Armored Data Core Pillar (Objective!) at (73, -6.0, 4) — Multi-part PBR engineering + Overhead Conduit Struts & 4 Telemetry Screens!
  const corePillar = new THREE.Group();
  corePillar.position.set(73, -6.0, 4);
  const coreCol = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.25, 8.6, 24), glbPbr.MAT_SERVER_CHASSIS);
  coreCol.position.y = 4.3;
  corePillar.add(coreCol);
  for (const ry of [0.45, 2.1, 4.2, 6.4, 8.1]) {
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(2.38, 2.38, 0.34, 24), glbPbr.MAT_SERVER_FACE);
    collar.position.y = ry;
    corePillar.add(collar);
  }
  const coreRingMat = new THREE.MeshStandardMaterial({
    color: 0xff3b28, emissive: 0xff3b28, emissiveIntensity: 3.4, roughness: 0.2,
  });
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(2.58, 0.12, 10, 32), coreRingMat);
  coreRing.position.y = 2.6;
  coreRing.rotation.x = H;
  corePillar.add(coreRing);
  // 4 Armored Diagonal Power-Conduit Struts anchoring Core Pillar into overhead ceiling I-beams + 4 Bunker SCADA Diagnostic Screens!
  const bunkerScadaTex = makeScadaScreenTexture('bunker');
  const bunkerScadaMat = new THREE.MeshStandardMaterial({
    map: bunkerScadaTex, emissiveMap: bunkerScadaTex, color: 0x1a2834, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.18,
  });
  for (let i = 0; i < 4; i++) {
    const ang = i * H;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.42, 4.6, 0.42), glbPbr.MAT_STEEL_ARMOR);
    strut.position.set(Math.sin(ang) * 3.1, 6.6, Math.cos(ang) * 3.1);
    strut.rotation.z = -Math.sin(ang) * 0.62;
    strut.rotation.x = Math.cos(ang) * 0.62;
    corePillar.add(strut);
    const scrFrame = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.96, 0.14), glbPbr.MAT_SERVER_FACE);
    scrFrame.position.set(Math.sin(ang) * 2.28, 3.35, Math.cos(ang) * 2.28);
    scrFrame.rotation.y = ang;
    corePillar.add(scrFrame);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.80), bunkerScadaMat);
    scr.position.set(Math.sin(ang) * 2.36, 3.35, Math.cos(ang) * 2.36);
    scr.rotation.y = ang;
    corePillar.add(scr);
  }
  corePillar.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(corePillar);
  // Overhead steel fiber-optic cable trays fanning out from Data Core to the 4 server rack aisles!
  b.box('steel', 73, 1.35, 4, 38, 0.18, 1.2, { solid: false });
  b.box('steel', 73, 1.35, 4, 1.2, 0.18, 36, { solid: false });
  b.box('chevron', 37.8, -5.97, 10.0, 0.65, 0.03, 13.8, { solid: false });
  b.box('chevron', 92.0, -5.97, -43.4, 11.8, 0.03, 0.65, { solid: false });
  world.addBox(73, -1.75, 4, 2.1, 4.25, 2.1, 0, 'metal');
  b.cover(73, -6.0, -1.8, 6.2, 1.0, false, 0, 'bunker');
  b.cover(73, -6.0, 9.8, 6.2, 1.0, false, 0, 'bunker');
  b.cover(67.2, -6.0, 4, 1.0, 6.2, false, 0, 'bunker');
  b.cover(78.8, -6.0, 4, 1.0, 6.2, false, 0, 'bunker');

  // 16 Detailed 4K PBR Blender 4.2 Epsilon Server Rack Cabinets lining 4 CQB aisles!
  for (const sx of [56, 64, 82, 90]) {
    for (const sz of [-12.5, -5.5, 13.5, 20.5]) {
      cloneRaw('oil_server_rack', sx, -6.0, sz, H, 1.0);
    }
    world.addBox(sx, -4.5, -9, 1.05, 1.5, 5.2, 0, 'metal');
    world.addBox(sx, -4.5, 17, 1.05, 1.5, 5.2, 0, 'metal');
    b.cover(sx, -6.0, 4, 2.2, 2.6, false, 0, 'bunker');
  }

  // 2F Overhead Security Mezzanine (Y = -1.5m) + 12 Grounded Structural Steel H-Columns (ZERO floating shelf!)
  b.catwalk(73, -1.5, 24.4, 48, 3.6, { w: true, e: true, s: true });
  b.catwalk(73, -1.5, -16, 48, 3.6, { w: true, e: true });
  b.catwalk(51, -1.5, 4.2, 3.6, 42, { n: true, s: true });
  b.catwalk(95, -1.5, 4.2, 3.6, 42, { n: true, s: true, e: true });
  for (const [cx, cz] of [
    [49.5, -15.6], [49.5, 4.0], [49.5, 24.4],
    [96.5, -15.6], [96.5, 4.0], [96.5, 24.4],
    [61.5, -15.6], [84.5, -15.6],
    [61.5, 24.4], [84.5, 24.4],
    [52.5, -6.5], [93.5, 14.5],
  ]) b.column(cx, -6.0, -1.72, cz, 0.34);
  // South-side stair ascending alongside Z=24.4 catwalk (X: 59 -> 70 at Z=27.7, completely clear overhead!)
  b.stairs('x', 27.7, 59, 70, -6.0, -1.5, 2.6, 'tread', true);
  b.catwalk(71.5, -1.5, 27.4, 3.2, 2.8, { n: true, w: true });
  // East-side stair ascending alongside X=95 catwalk in open East corridor (Z: -11 -> -1 at X=98.4, completely clear overhead!)
  b.stairs('z', 98.4, -11, -1, -6.0, -1.5, 2.8, 'tread', true);
  b.catwalk(98.4, -1.5, 0.6, 3.2, 3.2, { s: true, w: true });

  b.wall('bunker', 'x', -19, 48, 105, -6.0, 8.6, 1.0, [{ at: 60, w: 5.0, h: 4.0 }, { at: 86, w: 5.0, h: 4.0 }]);
  for (const tx of [56, 68, 80]) {
    b.cyl('steel', tx, -6.0, -32, 2.3, 7.6, 18, true, 'metal');
    b.cover(tx, -6.0, -25, 3.8, 1.0, false, 0, 'bunker');
  }
  // Subterranean Bunker Props
  addProp('utility_box', 48.8, -6.0, 2, H, 1.1);
  addProp('utility_box', 104.8, -6.0, 14, -H, 1.1);
  addProp('mil_crate', 42, -6.0, 15, 0.3, 1.1);
  addProp('ammo_box', 43.2, -6.0, 16, -0.2, 1.1);
  addProp('ph_extinguisher', 49, -6.0, 14, 0, 1.1);
  addProp('ph_sec_cam', 49, 1.2, 6, 0.4, 1.2);
  addProp('table', 73, -6.0, -24, 0, 1.1);
  addProp('ph_laptop', 73, -5.22, -24, 0, 1.15);
  // Subterranean Server Vault Enrichment: Glowing cyan floor fiber-optic conduit strips & Halon suppression cylinder banks
  const cyanStripMat = new THREE.MeshStandardMaterial({ color: 0x4ad8ff, emissive: 0x28b8ff, emissiveIntensity: 2.2, roughness: 0.25 });
  for (const [sx, sz, sw, sd] of [[73, -4.4, 14.5, 0.18], [73, 12.4, 14.5, 0.18], [64.6, 4.0, 0.18, 16.8], [81.4, 4.0, 0.18, 16.8]] as [number, number, number, number][]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.03, sd), cyanStripMat);
    strip.position.set(sx, -5.98, sz);
    group.add(strip);
  }
  for (let i = 0; i < 4; i++) {
    b.cyl('hazard', 104.2, -6.0, -4.0 + i * 0.72, 0.16, 1.65, 10, false);
  }

  // Subterranean Bunker Cold-Blue Tactical Lighting + Ribbed Fresnel Caged Ceiling Light Bars!
  const fresnelTex = makeFresnelLensTexture();
  const lampBarMat = new THREE.MeshStandardMaterial({
    map: fresnelTex, emissiveMap: fresnelTex, color: 0xbce6ff, emissive: 0x70c4ff, emissiveIntensity: 2.8, roughness: 0.22,
  });
  for (const [lx, lz] of [[42, 10], [62, 4], [84, 4], [73, -10], [73, 18], [68, -32], [92, -36]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.45), lampBarMat);
    bar.position.set(lx, 2.0, lz);
    group.add(bar);
    const pt = new THREE.PointLight(0x74c6ff, 34, 38, 1.45);
    pt.position.set(lx, 1.5, lz);
    group.add(pt);
  }
  const coreLight = new THREE.PointLight(0xff4230, 38, 26, 1.5);
  coreLight.position.set(73, -2.2, 4);
  group.add(coreLight);

  // Zone 5 -> Zone 6 Physical Blast Gate & Continuous 3-Flight Ascent Shaft (-6.0m -> +12.0m)
  addBlastGate('g56', 92, -6.0, -45.0, 11.8, 5.2, 0);
  addSign('05 号垂直货梯井 · 北侧悬崖高台', 'LIFT SHAFT 05 · CLIFFSIDE PLATEAU (+12.0M)', 92, -0.4, -44.2, 0, '#c48f36');

  b.cliffBox(83, -6.0, -50.5, 1.4, 18.5, 13, { amp: 0.35 });
  b.cliffBox(105, -6.0, -50.5, 1.4, 18.5, 13, { amp: 0.35 });
  b.cliffBox(94, -6.0, -57, 22, 12.2, 1.4, { amp: 0.35 });
  b.stairs('x', -47.5, 86, 100, -6.0, 0.0, 3.4, 'catwalk', true);
  b.box('catwalk', 102, -0.3, -50.5, 4.5, 0.3, 9.6, { surf: 'metal' });
  b.stairs('x', -53.2, 100, 86, 0.0, 6.0, 3.4, 'catwalk', true);
  b.box('catwalk', 86, 5.7, -50.5, 4.5, 0.3, 9.6, { surf: 'metal' });
  b.stairs('x', -47.5, 88, 102, 6.0, 12.0, 3.4, 'tread', true);
  b.box('catwalk', 103.6, 11.7, -47.5, 4.0, 0.3, 4.2, { surf: 'metal' });
  for (const ly of [-1.5, 4.5, 10.5]) {
    const sl = new THREE.PointLight(0xffc978, 24, 24, 1.5);
    sl.position.set(94, ly, -50.5);
    group.add(sl);
  }

  // =========================================================================
  // ZONE 6: 悬崖停机坪与高轨中继塔 — 终局决战 (X: +44..+114, Z: -114..-45, Y: +12.0)
  // =========================================================================
  b.cliffBox(64, 0, -79.5, 40, 12.0, 69, { flatTop: true, amp: 0.95 });
  b.cliffBox(99, 0, -85.5, 30, 12.0, 57, { flatTop: true, amp: 0.95 });
  b.cliffBox(109.5, 0, -51, 9, 12.0, 12, { flatTop: true, amp: 0.65 });
  // Dress the 12m Zone 6 cliff escarpment with monumental Poly Haven photogrammetry cliff slabs!
  addProp('cliff', 43, -0.5, -96, -H, 2.2);
  addProp('cliff', 43, -0.5, -66, -H + 0.1, 2.2);
  addProp('cliff', 60, -0.5, -44, Math.PI, 2.1);

  b.box('asphalt', 79, 12.01, -84, 64, 0.06, 56, { solid: false, road: true });
  // Waist-high Cliff Overlook Parapet with Reinforced Buttress Piers & Top Safety Guardrail!
  b.box('concrete', 44.5, 12.0, -79.5, 0.8, 1.25, 68);
  b.box('steel', 44.5, 13.25, -79.5, 0.92, 0.10, 68.2, { solid: false });
  for (let pz = -110; pz <= -46; pz += 8) b.box('steel', 44.5, 12.0, pz, 1.12, 1.40, 0.42, { solid: false });
  b.box('concrete', 64, 12.0, -45.5, 39, 1.25, 0.8);
  b.box('steel', 64, 13.25, -45.5, 39.2, 0.10, 0.92, { solid: false });
  for (let px = 46; px <= 82; px += 9) b.box('steel', px, 12.0, -45.5, 0.42, 1.40, 1.12, { solid: false });

  // Epsilon Command Bunker + Fortified Structural Ribs, Armored Door Visor & Waveguide Conduits + Monumental Ka-Band Satellite Dish!
  b.box('concrete', 64, 12.0, -77, 15, 4.4, 15);
  b.box('steel', 64, 16.25, -77, 15.6, 0.30, 15.6, { solid: false });
  // Vertical armored steel corner pilasters & structural wall ribs around command bunker
  for (const dx of [-7.4, -2.5, 2.5, 7.4]) {
    b.box('steel', 64 + dx, 12.0, -69.4, 0.55, 4.4, 0.45, { solid: false });
    b.box('steel', 64 + dx, 12.0, -84.6, 0.55, 4.4, 0.45, { solid: false });
  }
  for (const dz of [-7.4, -2.5, 2.5, 7.4]) {
    b.box('steel', 71.6, 12.0, -77 + dz, 0.45, 4.4, 0.55, { solid: false });
    b.box('steel', 56.4, 12.0, -77 + dz, 0.45, 4.4, 0.55, { solid: false });
  }
  // Recessed armored bunker blast door + overhanging steel blast visor + satellite waveguide feed conduits!
  b.box('steel', 71.55, 12.0, -77, 0.25, 3.0, 2.6, { solid: false });
  b.box('steel', 72.35, 15.05, -77, 1.65, 0.26, 3.4, { solid: false });
  b.box('chevron', 72.25, 12.03, -77, 1.15, 0.03, 2.8, { solid: false });
  b.box('rust', 71.68, 13.4, -77, 0.14, 0.35, 2.4, { solid: false });
  b.pipe('steel', 67.2, 16.65, -77, 0.22, 7.5, 'x', false);
  b.box('steel', 71.3, 12.0, -74.6, 0.36, 4.6, 0.36, { solid: false });
  b.box('steel', 59.5, 16.4, -73.0, 2.4, 1.35, 2.2, { solid: false }); // Rooftop radar power cabinet
  addProp('aircon_rust', 71.8, 14.2, -72, H, 1.1);
  addProp('utility_box', 71.8, 12.0, -81.5, H, 1.1);
  b.stairs('z', 54.5, -66, -77, 12.0, 16.4, 2.8, 'tread', true);
  b.box('hesco', 64, 16.4, -69.8, 14.5, 1.0, 0.4);
  b.box('hesco', 64, 16.4, -84.2, 14.5, 1.0, 0.4);
  const satInst = cloneRaw('oil_satdish', 64, 16.4, -77, 0, 1.0, false, 'DishHead');
  const satDishHead = satInst.getObjectByName('DishHead') ?? null;
  world.addBox(64, 19.0, -77, 2.2, 2.6, 2.2, 0, 'metal');
  const satBeaconLight = new THREE.PointLight(0xff3020, 32, 32, 1.4);
  satBeaconLight.position.set(64, 27.5, -77);
  group.add(satBeaconLight);

  // Elevated Circular Extraction Helipad (X: +94, Z: -92, Y: +12.42) — Weathered Tactical Stencil + 8 Fresnel Beacons + 4 Perimeter Flood Masts!
  b.cyl('concrete', 94, 12.0, -92, 10.8, 0.42, 32, true, 'concrete');
  b.box('hazard', 90.5, 12.43, -92, 1.1, 0.03, 7.8, { solid: false });
  b.box('hazard', 97.5, 12.43, -92, 1.1, 0.03, 7.8, { solid: false });
  b.box('hazard', 94.0, 12.43, -92, 6.8, 0.03, 1.1, { solid: false });
  b.box('chevron', 82.6, 12.03, -92, 1.1, 0.03, 7.4, { solid: false }); // West helipad approach apron
  const padBeaconMat = new THREE.MeshStandardMaterial({
    map: fresnelTex, emissiveMap: fresnelTex, color: 0xffd27a, emissive: 0xff9e2c, emissiveIntensity: 2.9, roughness: 0.22,
  });
  for (let i = 0; i < 8; i++) {
    const a = i * (Math.PI * 2 / 8);
    const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.16, 10), padBeaconMat);
    bm.position.set(94 + Math.cos(a) * 10.2, 12.50, -92 + Math.sin(a) * 10.2);
    group.add(bm);
  }
  // 4 Steel Perimeter Helipad Floodlight Masts framing the extraction arena
  for (const [mx, mz] of [[81.5, -104.5], [106.5, -104.5], [81.5, -79.5], [106.5, -79.5]]) {
    b.column(mx, 12.0, 16.4, mz, 0.26);
    b.box('steel', mx, 16.35, mz, 0.95, 0.22, 0.35, { solid: false });
  }
  // Foreground Tactical Defense Checkpoint Nest on open South-Central Plateau Plaza (adds silhouette & tactical cover!)
  b.cover(77.5, 12.0, -61.0, 5.2, 1.1, false, 0.12, 'concrete');
  b.cover(81.5, 12.0, -56.5, 1.1, 4.6, false, -0.08, 'hesco');
  b.box('steel', 77.5, 12.0, -57.2, 2.4, 2.2, 1.8, { surf: 'metal' }); // Armored field comms cabinet
  b.box('rust', 77.5, 14.2, -57.2, 2.6, 0.18, 2.0, { solid: false });
  b.cyl('steel', 76.6, 14.3, -57.2, 0.06, 3.2, 8, false); // Tactical whip comms mast

  // 360° Defense Sandbag Rings, Pillboxes & Photogrammetry Tactical Gear around Helipad
  b.cover(80, 12.0, -92, 1.2, 8.0, false, 0, 'hesco');
  b.cover(94, 12.0, -76, 9.0, 1.2, false, 0, 'hesco');
  b.cover(94, 12.0, -106, 9.0, 1.2, false, 0, 'hesco');
  b.cover(107, 12.0, -92, 1.2, 8.0, false, 0, 'hesco');
  b.box('cinder', 75, 12.0, -104, 6.5, 3.2, 5.5);
  b.box('steel', 75, 15.2, -104, 6.8, 0.25, 5.8);
  b.box('cinder', 105, 12.0, -72, 5.5, 3.2, 6.5);
  b.box('steel', 105, 15.2, -72, 5.8, 0.25, 6.8);
  b.cover(76, 12.0, -58, 5.5, 1.2, false, 0, 'concrete');
  b.cover(54, 12.0, -56, 5.0, 1.2, true, 0, 'hesco');
  addProp('sandbags', 81.2, 12.0, -92, H, 1.2);
  addProp('sandbags', 94, 12.0, -77.2, 0, 1.2);
  addProp('jersey', 68, 12.0, -54, 0.15, 1.05);
  addProp('mil_crate', 83, 12.0, -79, 0.4, 1.15);
  addProp('ammo_box', 84.4, 12.0, -78.5, -0.3, 1.15);
  addProp('generator', 71, 12.0, -86, 0.3, 1.15);
  addProp('flood_lights', 81, 12.0, -103, 0.7, 1.15);
  addProp('barbed_wire', 50, 12.0, -68, H, 1.15);
  addProp('searchlight', 82, 12.0, -82, -0.5, 1.2);
  addProp('searchlight', 104, 12.0, -102, 2.4, 1.2);
  addProp('boulder_a', 52, 12.0, -104, 0.5, 1.4);
  addProp('boulder_b', 109, 12.0, -106, 1.2, 1.6);
  // Grounded twin steel gantry stanchions supporting the Zone 6 Extraction Helipad sign!
  b.box('steel', 82.8, 12.0, -75, 0.28, 4.6, 0.28);
  b.box('steel', 89.2, 12.0, -75, 0.28, 4.6, 0.28);
  addSign('06 号悬崖起降坪 · 通讯中继站', 'HELIPAD H-06 · COMMS RELAY PLATEAU', 86, 16.0, -75, 0, '#b84b3e');

  // Z-20J "HaiDiao-1" Helicopter (Full 4K PBR Gunmetal + Armored Glass!)
  const { heli, rotor: heliRotor, tail: heliTailRotor } = makeHeli(
    glbPbr.MAT_STEEL_ARMOR,
    glbPbr.MAT_STEEL_DARK,
    glbPbr.MAT_GLASS_TINT,
    pbr.hazard,
  );
  heli.position.set(-80, 22, -110);
  group.add(heli);

  // Merge all batched static architecture + recursively merge ALL static Blender & Photogrammetry sub-meshes by material!
  b.finalize(pbr, group);
  staticPropsRoot.updateMatrixWorld(true);
  const propBuckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  staticPropsRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || Array.isArray(m.material)) return;
    const mat = resolveMat(m.material);
    const g = normGeo(m.geometry);
    g.applyMatrix4(m.matrixWorld);
    let list = propBuckets.get(mat);
    if (!list) propBuckets.set(mat, (list = []));
    list.push(g);
  });
  for (const [mat, list] of propBuckets) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const oilfield: OilfieldDynamic = {
    gates,
    setGateOpen(id, open) {
      for (const gt of gates[id]) {
        gt.isOpen = open;
        gt.col.enabled = !open;
        const col = open ? 0x2ee880 : 0xff2818;
        gt.beaconMat.color.setHex(col);
        gt.beaconMat.emissive.setHex(col);
        gt.beaconLight.color.setHex(col);
      }
    },
    jammerGroup,
    jammerLight,
    valve1Wheel: v1.wheel,
    valve2Wheel: v2.wheel,
    valve1Light: v1.light,
    valve2Light: v2.light,
    ctrlLight,
    corePillar,
    coreRing,
    coreLight,
    satDishHead,
    satDestroyed: false,
    satBeaconLight,
    heli,
    heliRotor,
    heliTailRotor,
    destroyJammer() {
      jammerGroup.visible = false;
      jammerLight.intensity = 0;
    },
    closeValve(idx) {
      if (idx === 1) { v1.light.color.setHex(0x2ee880); v1.wheel.rotation.z = 2.4; }
      else { v2.light.color.setHex(0x2ee880); v2.wheel.rotation.z = 2.4; }
    },
    activateControlRoom() {
      ctrlLight.color.setHex(0x38e4ff);
    },
    setCoreHacking(progress, done) {
      const mat = coreRing.material as THREE.MeshStandardMaterial;
      const col = done ? 0x2ee880 : progress > 0 ? 0x38d8ff : 0xff3b28;
      mat.color.setHex(col);
      mat.emissive.setHex(col);
      coreLight.color.setHex(col);
    },
    destroySatDish() {
      this.satDestroyed = true;
      if (satDishHead) satDishHead.rotation.z = 0.65;
      satBeaconLight.color.setHex(0xff7220);
    },
  };

  const map: MapInfo = {
    half: 122,
    roads: b.roads,
    ground: '#6a5844',
    road: '#3d4147',
  };

  return {
    id: 'oilfield',
    group,
    oilfield,
    playerSpawn: { x: OILFIELD.spawn.x, z: OILFIELD.spawn.z, yaw: OILFIELD.spawn.yaw },
    spawnPoints: [
      { x: -80, z: -60 }, { x: -80, z: 0 }, { x: -66, z: 72 },
      { x: -1, z: 0 }, { x: 73, z: 4 }, { x: 94, z: -92 },
    ],
    barrels: [
      { x: -82, y: 0, z: -68 },
      { x: -75, y: 0, z: -52 },
      { x: -94, y: 0, z: -12 },
      { x: -68, y: 0, z: 18 },
      { x: -58, y: 0, z: 70 },
      { x: 1,   y: 0, z: 62 },
      { x: 1,   y: 0, z: 84 },
      { x: -10, y: 0, z: 14 },
      { x: 4,   y: 0, z: -16 },
      { x: 70,  y: 12, z: -62 },
      { x: 81.5, y: 12, z: -80.5 },
    ],
    supplies: [
      { x: -86, z: -96 },
      { x: -66, z: -18 },
      { x: -20, z: 72 },
      { x: -20, z: 10 },
    ],
    fires: [
      new THREE.Vector3(19.5, 26.8, -16),
      new THREE.Vector3(-79, 2.2, -83),
    ],
    plumes: [
      new THREE.Vector3(19.5, 28.0, -16),
      new THREE.Vector3(-79, 3.0, -83),
      new THREE.Vector3(-96, 9.0, 56),
    ],
    bound: 120,
    map,
    targets: [],
    menuCamera(t, cam) {
      const a = t * 0.08;
      cam.position.set(Math.sin(a) * 90, 48, Math.cos(a) * 90);
      cam.lookAt(0, 6, 0);
    },
    update(dt, t) {
      // Animate Blender pumpjack walking beams
      for (let i = 0; i < animatedBeams.length; i++) {
        animatedBeams[i].rotation.x = Math.sin(t * 1.15 + i * 1.45) * 0.25;
      }
      // Animate Ka-Band satellite dish unless destroyed by C4
      if (satDishHead && !oilfield.satDestroyed) {
        satDishHead.rotation.y = Math.sin(t * 0.24) * 0.72;
      }
      // Animate core holographic data ring
      coreRing.rotation.z = t * 1.4;
      coreRing.position.y = 2.6 + Math.sin(t * 2.2) * 0.28;
      flareLight.intensity = 70 + Math.sin(t * 9.5) * 12 + Math.cos(t * 15.2) * 8;
      // Smooth motorized physical Blast Gate lifting animation
      for (const list of Object.values(gates)) {
        for (const gt of list) {
          const target = gt.isOpen ? 1 : 0;
          if (Math.abs(gt.openT - target) > 0.002) {
            gt.openT += Math.sign(target - gt.openT) * Math.min(Math.abs(target - gt.openT), dt * 0.65);
            const e = gt.openT * gt.openT * (3 - 2 * gt.openT);
            gt.mesh.position.y = gt.closedY + (gt.openY - gt.closedY) * e;
          }
        }
      }
      // Spin helicopter rotors
      heliRotor.rotation.y += dt * 26;
      heliTailRotor.rotation.x += dt * 42;
    },
  };
}
