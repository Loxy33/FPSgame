import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets, makePropObject, type PropName, type RawModelName, type ScanTexName, type ShipTexName } from '../render/assets';
import { texSets, type Materials } from '../render/materials';
import { applyDetail } from '../render/detail';
import { applyPom } from '../render/pom';
import { makeFresnelLensTexture, makeHazardChevronTextures } from '../render/textures';
import { applyGrime, applySurfacePatina, applyWetness, rainRippleUniform, stormLightningUniform } from '../render/weather';
import type { MapInfo } from '../ui/hud';
import type { LevelData } from './level';
import { World, type Collider, type Surface } from './physics';

const H = Math.PI / 2;

export interface ShipBlastGate {
  id: string;
  mesh: THREE.Object3D;
  col: Collider;
  closedX: number;
  closedZ: number;
  openX: number;
  openZ: number;
  openT: number;
  isOpen: boolean;
  beaconMat: THREE.MeshStandardMaterial;
  beaconLight: THREE.PointLight;
}

export interface ShipRemakeDynamic {
  gates: Record<'g12' | 'g23' | 'g34' | 'g45' | 'g56' | 'mess', ShipBlastGate[]>;
  setGateOpen(id: keyof ShipRemakeDynamic['gates'], open: boolean): void;
  aa1Group: THREE.Object3D;
  aa1Light: THREE.PointLight;
  samGroup: THREE.Object3D;
  samLight: THREE.PointLight;
  bridgeLight: THREE.PointLight;
  epsilonLight: THREE.PointLight;
  powerLight: THREE.PointLight;
  valveLight: THREE.PointLight;
  floodWater: THREE.Mesh;
  engineLights: THREE.PointLight[];
  alarmLights: THREE.PointLight[];
  radarBar: THREE.Object3D | null;
  heli: THREE.Group;
  heliRotor: THREE.Object3D | null;
  heliTailRotor: THREE.Object3D | null;
  heliRopes: THREE.Group;
  rain: THREE.Object3D;
  destroyAA1(): void;
  destroySAM(): void;
  setBridgeHacked(): void;
  setEpsilonHacked(progress: number, done: boolean): void;
  setEngineBlackout(blackout: boolean): void;
  setFloodLevel(y: number): void;
  setPowerRestored(): void;
  setValveClosed(): void;
  setAlarm(on: boolean): void;
  setIndoors(inside: boolean): void;
}

/** Authoritative coordinates for Mission 1 Remake: 《深海利刃 · 泰山号万吨货轮重制版 (276m × 40m)》 */
export const TAISHAN = {
  // Zone 1: Stern Helo Drop & 3-Lane Container Maze (Z: -136..-64, Y: 0.0 / +2.8)
  spawn: { x: 0, y: 0.0, z: -124, yaw: Math.PI },
  z1AA: { x: 0, y: 0.0, z: -72.0 },
  z1Gate: { x: 0, y: 0.0, z: -64.0 },
  z1Enemies: [
    { kind: 'specops' as const,  x: -3.0, y: 0.0, z: -102, yaw: 0, stealth: true, pts: [[-3, -104], [-3, -92]] as [number, number][] },
    { kind: 'specops' as const,  x:  3.2, y: 0.0, z: -96,  yaw: 0, stealth: true, pts: [[3.2, -98], [3.2, -86]] as [number, number][] },
    { kind: 'sniper' as const,   x: -13.0, y: 2.82, z: -84, yaw: 0.15, stealth: true },
    { kind: 'rusher' as const,   x:  15.8, y: 0.0, z: -82, yaw: 0, stealth: true },
    { kind: 'rifleman' as const, x: -4.2, y: 0.0, z: -76, yaw: 0, stealth: true },
    { kind: 'heavy' as const,    x:  0.0, y: 0.0, z: -70, yaw: 0, stealth: true },
    { kind: 'rifleman' as const, x:  5.5, y: 0.0, z: -74, yaw: 0, stealth: true },
  ],

  // Zone 2: 4-Level Superstructure (Lower Bilge -6.0, 1F Cabins & Restroom 0.0, 2F Mess & Galley +4.2, 3F Bridge +8.4)
  z2Hostages1F: [
    { x: -14.5, y: 0.0, z: -42.0, yaw: H },
    { x: -12.0, y: -6.0, z: -42.0, yaw: H }, // Lower Bilge Crew Quarters Hostage!
  ],
  z2MessBreach: { x: 6.2, y: 4.2, z: -42.0 },
  z2Captain: { x: -14.8, y: 4.2, z: -44.0, yaw: H },
  z2MessHostages: [
    { x: -13.2, y: 4.2, z: -46.5, yaw: 1.2 },
    { x: -13.2, y: 4.2, z: -41.5, yaw: 1.4 },
    { x: -14.5, y: 4.2, z: -38.5, yaw: 1.8 },
  ],
  z2BridgeConsole: { x: 0.0, y: 8.4, z: -27.0 },
  z2Gate: { x: 0.0, y: 0.0, z: -20.0 },
  z2Enemies1F: [
    { kind: 'specops' as const,  x: -1.5, y: 0.0, z: -52, yaw: 0 },
    { kind: 'rusher' as const,   x:  12.0, y: 0.0, z: -56, yaw: 0 },   // Starboard flanking vestibule guard
    { kind: 'rusher' as const,   x: -10.5, y: 0.0, z: -28, yaw: H },   // Port-Forward Crew Restroom ambush!
    { kind: 'rifleman' as const, x: -11.5, y: 0.0, z: -42, yaw: H },
    { kind: 'breacher' as const, x:  1.8, y: 0.0, z: -34, yaw: 0 },
    // Lower Bilge Crew Cabins & Cold Storage patrol (Y = -6.0)
    { kind: 'specops' as const,  x: -8.0, y: -6.0, z: -46, yaw: 0 },
    { kind: 'rusher' as const,   x:  8.5, y: -6.0, z: -38, yaw: -H },
  ],
  z2MessMilitants: [
    { kind: 'specops' as const,  x: -2.0, y: 4.2, z: -45, yaw: H },
    { kind: 'breacher' as const, x: -6.5, y: 4.2, z: -40, yaw: H },
    { kind: 'rifleman' as const, x: -8.5, y: 4.2, z: -48, yaw: H },
    { kind: 'rusher' as const,   x: -9.0, y: 4.2, z: -28, yaw: 0 }, // Galley kitchen flanker!
  ],
  z2BridgeEnemies: [
    { kind: 'specops' as const,  x: -6.5, y: 8.4, z: -32, yaw: 0 },
    { kind: 'heavy' as const,    x:  0.0, y: 8.4, z: -30, yaw: 0 },
    { kind: 'rifleman' as const, x:  6.5, y: 8.4, z: -34, yaw: 0 },
  ],

  // Zone 3: 14m-Tall Main Cargo Hold #3 (Z: -20..+36, Catwalk Y=0.0, Floor Y=-6.0)
  z3Epsilon: { x: 0.0, y: -6.0, z: 26.8 },
  z3Gate: { x: 0.0, y: -6.0, z: 36.0 },
  z3Enemies: [
    { kind: 'sniper' as const,   x: -17.2, y: 0.0, z: 18, yaw: 0 },
    { kind: 'specops' as const,  x:  17.2, y: 0.0, z: 12, yaw: 0 },
    { kind: 'rifleman' as const, x:   0.0, y: 0.0, z: 33, yaw: 0 },
    { kind: 'breacher' as const, x:  -5.5, y: -6.0, z: 2, yaw: 0 },
    { kind: 'rifleman' as const, x:   5.5, y: -6.0, z: 8, yaw: 0 },
    { kind: 'rusher' as const,   x:  -4.5, y: -6.0, z: 16, yaw: 0 },
    { kind: 'heavy' as const,    x:   0.0, y: -6.0, z: 19, yaw: 0 },
    { kind: 'specops' as const,  x:   5.5, y: -6.0, z: 22, yaw: 0 },
  ],
  z3HackWave: [
    { kind: 'rusher' as const,   x: -12.0, y: -6.0, z: 4, yaw: Math.PI },
    { kind: 'breacher' as const, x:  12.0, y: -6.0, z: 4, yaw: Math.PI },
    { kind: 'specops' as const,  x:  17.2, y: 0.0,  z: 24, yaw: -H },
    { kind: 'specops' as const,  x: -17.2, y: 0.0,  z: 24, yaw: H },
  ],

  // Zone 4: Below-Deck Twin Diesel Engine Room (Z: +36..+82, Y: -6.0 / -1.8)
  z4Power: { x: 16.5, y: -1.8, z: 58.0 },
  z4Valve: { x: -12.5, y: -6.0, z: 76.0 },
  z4Gate: { x: 0.0, y: -6.0, z: 82.0 },
  z4Enemies: [
    { kind: 'specops' as const,  x:   0.0, y: -6.0, z: 50, yaw: 0 },
    { kind: 'breacher' as const, x:  -3.2, y: -6.0, z: 62, yaw: 0 },
    { kind: 'rusher' as const,   x:   3.2, y: -6.0, z: 66, yaw: 0 },
    { kind: 'sniper' as const,   x:  16.5, y: -1.8, z: 54, yaw: -H },
    { kind: 'specops' as const,  x: -16.5, y: -1.8, z: 62, yaw: H },
    { kind: 'heavy' as const,    x:   0.0, y: -1.8, z: 69.8, yaw: 0 },
    { kind: 'rifleman' as const, x: -11.0, y: -6.0, z: 74, yaw: 0 },
  ],

  // Zone 5: Foredeck Twin 18m Gantry Cranes & SAM Battery (Z: +82..+116, Y: 0.0 / +4.2)
  z5SAM: { x: 0.0, y: 0.0, z: 104.0 },
  z5Gate: { x: 0.0, y: 0.0, z: 116.0 },
  z5Enemies: [
    { kind: 'sniper' as const,   x: -13.4, y: 4.2, z: 104, yaw: 0 },
    { kind: 'specops' as const,  x:  13.4, y: 4.2, z: 104, yaw: 0 },
    { kind: 'rifleman' as const, x:  -6.5, y: 0.0, z: 98, yaw: 0 },
    { kind: 'rusher' as const,   x:   6.5, y: 0.0, z: 98, yaw: 0 },
    { kind: 'breacher' as const, x:  -4.5, y: 0.0, z: 108, yaw: 0 },
    { kind: 'heavy' as const,    x:   4.5, y: 0.0, z: 110, yaw: 0 },
    { kind: 'specops' as const,  x:   0.0, y: 0.0, z: 112, yaw: 0 },
  ],

  // Zone 6: Tapered Bow Extraction Helipad Final Stand (Z: +116..+138, Y: 0.0 / +1.2)
  z6Helipad: { x: 0.0, y: 1.2, z: 126.0 },
  z6InitialEnemies: [
    { kind: 'specops' as const,  x: -6.0, y: 0.0, z: 123, yaw: 0 },
    { kind: 'rifleman' as const, x:  6.0, y: 0.0, z: 123, yaw: 0 },
    { kind: 'heavy' as const,    x:  0.0, y: 1.2, z: 129, yaw: 0 },
    { kind: 'breacher' as const, x: -7.5, y: 0.0, z: 130, yaw: 0 },
  ],
  z6Wave1: [
    { kind: 'rusher' as const,   x: -5.0, y: 0.0, z: 113, yaw: Math.PI },
    { kind: 'specops' as const,  x:  5.0, y: 0.0, z: 113, yaw: Math.PI },
    { kind: 'breacher' as const, x:  0.0, y: 0.0, z: 111, yaw: Math.PI },
    { kind: 'sniper' as const,   x: -13.4, y: 4.2, z: 110, yaw: Math.PI },
  ],
  z6Wave2: [
    { kind: 'heavy' as const,    x: -3.5, y: 0.0, z: 112, yaw: Math.PI },
    { kind: 'heavy' as const,    x:  3.5, y: 0.0, z: 112, yaw: Math.PI },
    { kind: 'specops' as const,  x:  13.4, y: 4.2, z: 110, yaw: Math.PI },
    { kind: 'rusher' as const,   x:  0.0, y: 0.0, z: 114, yaw: Math.PI },
  ],
};

// ---------------------------------------------------------------------------
// AAA Naval PBR Shader & Material Pipeline (1024px Naval Scans + 4K Poly Haven + Wetness + Grime + Detail)
// ---------------------------------------------------------------------------
type ShipPbrKey =
  | 'hull' | 'deck' | 'bulkhead' | 'ceiling' | 'cabinFloor' | 'tile' | 'galley'
  | 'steel' | 'grating' | 'rust' | 'wood' | 'hazard' | 'chevron' | 'glass'
  | 'pipeRed' | 'pipeBlue' | 'pipeAmber' | 'epsilonWall';

function applyMacro(mat: THREE.MeshStandardMaterial, meanG: number, s1: number, s2: number, amount: number) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uMacro = { value: new THREE.Vector4(s1, s2, 1 / Math.max(meanG, 0.05), amount) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uMacro;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        {
          float m1 = texture2D( map, vMapUv * uMacro.x ).g * uMacro.z;
          float m2 = texture2D( map, vMapUv * uMacro.y + vec2( 0.37, 0.61 ) ).g * uMacro.z;
          float mv = clamp( m1 * 0.55 + m2 * 0.45, 0.55, 1.5 );
          diffuseColor.rgb *= mix( 1.0, mv, uMacro.w );
        }
        #endif`);
  };
  mat.customProgramCacheKey = () => 'smacro|' + prevKey;
}

function makeNavalMat(
  source: { kind: 'ship'; name: ShipTexName } | { kind: 'scan'; name: ScanTexName | keyof typeof texSets },
  opts: {
    color: number;
    roughness?: number;
    metalness?: number;
    normalScale?: number;
    aoIntensity?: number;
    macro?: [number, number, number];
    grime?: [number, number];
    wet?: [number, number];
    detail?: [number, number];
    pom?: [number, number];
  },
): THREE.MeshStandardMaterial {
  let map: THREE.Texture, normalMap: THREE.Texture, roughMap: THREE.Texture, aoMap: THREE.Texture | undefined, meanG = 0.5;
  let heightMap: THREE.Texture | undefined;
  if (source.kind === 'ship') {
    const s = assets.shipTex[source.name];
    map = s.map; normalMap = s.normalMap; roughMap = s.armMap; aoMap = s.armMap; meanG = s.meanG;
  } else {
    const scan = assets.tex[source.name as ScanTexName];
    if (scan) {
      map = scan.map; normalMap = scan.normalMap; roughMap = scan.armMap; aoMap = scan.armMap; meanG = scan.meanG; heightMap = scan.heightMap;
    } else {
      const t = texSets[source.name as keyof typeof texSets];
      map = t.map; normalMap = t.normalMap; roughMap = t.roughnessMap; aoMap = t.aoMap; meanG = t.meanG ?? 0.5;
    }
  }
  const ns = opts.normalScale ?? 1.25;
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(ns, ns),
    roughnessMap: roughMap,
    aoMap,
    aoMapIntensity: opts.aoIntensity ?? 0.68,
    color: opts.color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.25,
    vertexColors: false,
  });
  if (opts.macro) applyMacro(mat, meanG, opts.macro[0], opts.macro[1], opts.macro[2]);
  if (opts.grime) applyGrime(mat, opts.grime[0], opts.grime[1]);
  if (opts.wet) applyWetness(mat, opts.wet[0], opts.wet[1]);
  if (opts.detail) applyDetail(mat, opts.detail[0], opts.detail[1]);
  if (opts.pom && heightMap) applyPom(mat, heightMap, { depth: opts.pom[0], steps: opts.pom[1] });
  return mat;
}

/** Weathered riveted maritime compartment plaque (physically lit, subtle salt grime). */
/**
 * Authentic IMO riveted naval bulkhead compartment nameplate (compact 3D bolted steel plaque
 * with weathered enamel finish, salt-spray patina & stencil lettering — zero HUD-billboard feel!).
 */
function makeMarineSign(title: string, sub: string, accent = '#c89438', w = 2.65, h = 0.62): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 240;
  const ctx = c.getContext('2d')!;

  // Weathered matte maritime dark-slate enamel backing
  ctx.fillStyle = '#1b232b';
  ctx.fillRect(0, 0, 1024, 240);
  // Subtle vertical salt-spray / rain-streak weathering & brushed steel grain
  for (let i = 0; i < 90; i++) {
    const sx = (i * 47 + 19) % 1024;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(180,196,210,0.032)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(sx, 0, 2 + (i % 5), 240);
  }
  const grime = ctx.createLinearGradient(0, 0, 0, 240);
  grime.addColorStop(0, 'rgba(0,0,0,0.22)');
  grime.addColorStop(0.5, 'rgba(0,0,0,0.0)');
  grime.addColorStop(1, 'rgba(16,12,8,0.28)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, 1024, 240);

  // Recessed painted metal flange border + thin IMO industrial safety stripe
  ctx.strokeStyle = 'rgba(185,196,206,0.28)';
  ctx.lineWidth = 5;
  ctx.strokeRect(14, 14, 996, 212);
  ctx.fillStyle = accent;
  ctx.fillRect(18, 18, 16, 204);
  // Subtle top rule divider between Chinese deck label & English IMO stencil
  ctx.fillStyle = 'rgba(190,204,216,0.18)';
  ctx.fillRect(54, 134, 932, 2);

  // 4 corner hex rivets with subtle drop shadow
  for (const [rx, ry] of [[38, 36], [986, 36], [38, 204], [986, 204]]) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(rx + 2, ry + 2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5c6872';
    ctx.beginPath(); ctx.arc(rx, ry, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b98a4';
    ctx.beginPath(); ctx.arc(rx - 2, ry - 2, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // Crisp stenciled maritime typography (slightly aged off-white paint, never neon!)
  ctx.fillStyle = '#dde3e6';
  ctx.font = '700 54px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(title, 58, 104, 910);
  ctx.fillStyle = '#9aaab6';
  ctx.font = '600 28px Consolas, "Courier New", monospace';
  ctx.fillText(sub, 58, 186, 910);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.owned = true;
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    normalMap: assets.shipTex.hull_plate.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: 0.64,
    metalness: 0.32,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x262e36,
    roughness: 0.68,
    metalness: 0.55,
  });

  const grp = new THREE.Group();
  // Deep physical steel chassis recessed into the bulkhead wall + outer weld collar + 4 physical bolted mounting lugs (ZERO floating gap!)
  const backing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.16), frameMat);
  backing.position.z = -0.05;
  backing.castShadow = true;
  backing.receiveShadow = true;
  grp.add(backing);
  // Top & bottom beveled steel frame rails + rain-drip visor hood
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1d242c, roughness: 0.58, metalness: 0.68 });
  const topHood = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.045, 0.12), railMat);
  topHood.position.set(0, h * 0.5 + 0.04, 0.01);
  grp.add(topHood);
  const botLip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.035, 0.09), railMat);
  botLip.position.set(0, -h * 0.5 - 0.035, 0.0);
  grp.add(botLip);
  // 4 physical bolted mounting ears & protruding hex bolts anchoring the plate solidly to the steel bulkhead
  const lugGeo = new THREE.BoxGeometry(0.11, 0.11, 0.14);
  const boltGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6);
  boltGeo.rotateX(H);
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x7c8a96, roughness: 0.42, metalness: 0.85 });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const lx = sx * (w * 0.5 + 0.05);
      const ly = sy * (h * 0.5 - 0.06);
      const lug = new THREE.Mesh(lugGeo, railMat);
      lug.position.set(lx, ly, -0.045);
      grp.add(lug);
      const bolt = new THREE.Mesh(boltGeo, boltMat);
      bolt.position.set(lx, ly, 0.035);
      grp.add(bolt);
    }
  }
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
  front.position.z = 0.033;
  front.receiveShadow = true;
  grp.add(front);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
  back.position.z = -0.132;
  back.rotation.y = Math.PI;
  back.receiveShadow = true;
  grp.add(back);
  return grp;
}

// ---------------------------------------------------------------------------
// Batched AAA Naval Structural Builder (uv + uv2 for AO + Sloped Steel Stringer Stairs!)
// ---------------------------------------------------------------------------
function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile = 3.2) {
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
  const uvAttr = ni.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(ni.attributes.position.count * 2), 2);
  out.setAttribute('uv', uvAttr);
  out.setAttribute('uv2', uvAttr.clone());
  ni.dispose();
  return out;
}

class ShipBuilder {
  private buckets = new Map<ShipPbrKey, THREE.BufferGeometry[]>();
  roads: [number, number, number, number][] = [];

  constructor(private world: World) {}

  private push(key: ShipPbrKey, geo: THREE.BufferGeometry) {
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(normGeo(geo));
    geo.dispose();
  }

  box(
    key: ShipPbrKey,
    cx: number, y: number, cz: number,
    w: number, h: number, d: number,
    opts: { rotY?: number; surf?: Surface; solid?: boolean; road?: boolean; tile?: number } = {},
  ) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const defTile = key === 'tile' ? 1.8 : key === 'bulkhead' ? 3.8 : key === 'hull' ? 4.4 : key === 'deck' ? 2.6 : 3.0;
    scaleBoxUVs(geo, w, h, d, opts.tile ?? defTile);
    if (opts.rotY) geo.rotateY(opts.rotY);
    geo.translate(cx, y + h * 0.5, cz);
    this.push(key, geo);
    if (opts.solid !== false) {
      const surf: Surface = opts.surf ?? (key === 'wood' ? 'wood' : key === 'tile' || key === 'cabinFloor' ? 'concrete' : 'metal');
      this.world.addBox(cx, y + h * 0.5, cz, w * 0.5, h * 0.5, d * 0.5, opts.rotY ?? 0, surf);
    }
    if (opts.road) this.roads.push([cx, cz, w, d]);
  }

  cyl(key: ShipPbrKey, cx: number, y: number, cz: number, r: number, h: number, segs = 24, solid = true, surf: Surface = 'metal') {
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

  pipe(key: ShipPbrKey, cx: number, cy: number, cz: number, r: number, len: number, axis: 'x' | 'z', solid = false) {
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

  /** Color-coded overhead maritime triple pipe bundle (fire red + cooling blue + fuel amber) + steel hangers! */
  pipeBundle(axis: 'x' | 'z', cx: number, cy: number, cz: number, len: number) {
    const off = 0.22;
    if (axis === 'z') {
      this.pipe('pipeRed',   cx - off, cy, cz, 0.08, len, 'z', false);
      this.pipe('pipeBlue',  cx,       cy, cz, 0.08, len, 'z', false);
      this.pipe('pipeAmber', cx + off, cy, cz, 0.07, len, 'z', false);
      for (let p = -len * 0.45; p <= len * 0.45; p += 6.0) {
        this.box('steel', cx, cy - 0.10, cz + p, 0.72, 0.06, 0.12, { solid: false });
      }
    } else {
      this.pipe('pipeRed',   cx, cy, cz - off, 0.08, len, 'x', false);
      this.pipe('pipeBlue',  cx, cy, cz,       0.08, len, 'x', false);
      this.pipe('pipeAmber', cx, cy, cz + off, 0.07, len, 'x', false);
      for (let p = -len * 0.45; p <= len * 0.45; p += 6.0) {
        this.box('steel', cx + p, cy - 0.10, cz, 0.12, 0.06, 0.72, { solid: false });
      }
    }
  }

  /** Industrial marine staircase with continuous sloped steel side stringers, solid underside soffit & flush handrails (ZERO floating steps or gaps!). */
  stairs(axis: 'x' | 'z', cCross: number, a0: number, a1: number, y0: number, y1: number, width: number, rails = true) {
    const dy = y1 - y0;
    const dir = Math.sign(a1 - a0) || 1;
    const span = Math.abs(a1 - a0);
    const steps = Math.max(5, Math.ceil(Math.abs(dy) / 0.24));
    const da = (a1 - a0) / steps;
    const stepLen = span / steps + 0.06;
    const thick = 0.24;
    for (let i = 0; i < steps; i++) {
      const a = a0 + da * (i + 0.5);
      const topY = y0 + dy * ((i + 1) / steps);
      const cx = axis === 'x' ? a : cCross;
      const cz = axis === 'z' ? a : cCross;
      const w = axis === 'x' ? stepLen : width;
      const d = axis === 'z' ? stepLen : width;
      this.box('grating', cx, topY - thick, cz, w, thick, d, { surf: 'metal', tile: 1.8 });
    }
    const slopeLen = Math.hypot(span, dy);
    const pitch = Math.atan2(dy, span);
    const midA = (a0 + a1) * 0.5;
    const midY = (y0 + y1) * 0.5;
    const addSlopedBeam = (k: ShipPbrKey, crossOff: number, yOff: number, bw: number, bh: number, lenPad = 0) => {
      const geo = axis === 'x'
        ? new THREE.BoxGeometry(slopeLen + lenPad, bh, bw)
        : new THREE.BoxGeometry(bw, bh, slopeLen + lenPad);
      scaleBoxUVs(geo, axis === 'x' ? slopeLen : bw, bh, axis === 'z' ? slopeLen : bw, 2.2);
      if (axis === 'x') geo.rotateZ(dir * pitch);
      else geo.rotateX(-dir * pitch);
      geo.translate(axis === 'x' ? midA : cCross + crossOff, midY + yOff, axis === 'z' ? midA : cCross + crossOff);
      this.push(k, geo);
    };
    // Solid underside steel soffit slab (never see thin gaps from below or behind!)
    addSlopedBeam('steel', 0, -0.24, width - 0.04, 0.22, 0);
    for (const side of [-1, 1]) {
      const off = side * (width * 0.5 - 0.07);
      addSlopedBeam('steel', off, -0.14, 0.14, 0.34, 0);
      if (rails) {
        // Exact end-to-end sloped handrails (no awkward overhang past top/bottom posts!)
        addSlopedBeam('steel', off, 0.96, 0.08, 0.07, 0);
        addSlopedBeam('steel', off, 0.50, 0.06, 0.06, 0);
        const posts = Math.max(2, Math.round(span / 2.6) + 1);
        for (let p = 0; p < posts; p++) {
          const frac = p / (posts - 1);
          const pa = a0 + (a1 - a0) * frac;
          const py = y0 + dy * frac;
          const rx = axis === 'x' ? pa : cCross + off;
          const rz = axis === 'z' ? pa : cCross + off;
          this.box('steel', rx, py, rz, 0.08, 0.98, 0.08, { solid: false });
        }
      }
    }
  }

  /** Elevated naval steel catwalk with rusted kick-curb, mid-bar, top handrail & stanchion posts. */
  catwalk(cx: number, y: number, cz: number, w: number, d: number, open: { n?: boolean; s?: boolean; e?: boolean; w?: boolean } = {}) {
    this.box('grating', cx, y - 0.22, cz, w, 0.22, d, { surf: 'metal', tile: 2.0 });
    const rh = 0.98, rt = 0.11;
    const rail = (rx: number, rz: number, rw: number, rd: number) => {
      this.box('rust', rx, y, rz, rw, 0.15, rd, { surf: 'metal' });
      this.box('steel', rx, y + 0.48, rz, rw, 0.07, rd, { surf: 'metal' });
      this.box('steel', rx, y + rh - 0.09, rz, rw, 0.09, rd, { surf: 'metal' });
      this.world.addBox(rx, y + rh * 0.5, rz, rw * 0.5, rh * 0.5, rd * 0.5, 0, 'metal');
      const span = Math.max(rw, rd);
      const alongX = rw >= rd;
      const cnt = Math.max(2, Math.round(span / 3.2));
      for (let i = 0; i <= cnt; i++) {
        const off = -span * 0.5 + (i / cnt) * span;
        this.box('steel', alongX ? rx + off : rx, y + 0.15, alongX ? rz : rz + off, 0.08, rh - 0.24, 0.08, { solid: false });
      }
    };
    if (!open.n) rail(cx, cz - d * 0.5 + rt * 0.5, w, rt);
    if (!open.s) rail(cx, cz + d * 0.5 - rt * 0.5, w, rt);
    if (!open.w) rail(cx - w * 0.5 + rt * 0.5, cz, rt, d);
    if (!open.e) rail(cx + w * 0.5 - rt * 0.5, cz, rt, d);
  }

  wall(
    key: ShipPbrKey, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, h: number,
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

  /** Steel safety handrail along an axis (used around stairwell cutouts & deck drops). */
  railing(axis: 'x' | 'z', c: number, a0: number, a1: number, y: number) {
    const len = Math.abs(a1 - a0);
    const mid = (a0 + a1) * 0.5;
    if (axis === 'x') {
      this.box('steel', mid, y + 1.02, c, len, 0.08, 0.08, { solid: false });
      this.box('steel', mid, y + 0.52, c, len, 0.06, 0.06, { solid: false });
      this.world.addBox(mid, y + 0.55, c, len * 0.5, 0.55, 0.08, 0, 'metal');
      const posts = Math.max(2, Math.round(len / 2.2) + 1);
      for (let i = 0; i < posts; i++) this.box('steel', a0 + (len * i) / (posts - 1), y, c, 0.07, 1.06, 0.07, { solid: false });
    } else {
      this.box('steel', c, y + 1.02, mid, 0.08, 0.08, len, { solid: false });
      this.box('steel', c, y + 0.52, mid, 0.06, 0.06, len, { solid: false });
      this.world.addBox(c, y + 0.55, mid, 0.08, 0.55, len * 0.5, 0, 'metal');
      const posts = Math.max(2, Math.round(len / 2.2) + 1);
      for (let i = 0; i < posts; i++) this.box('steel', c, y, a0 + (len * i) / (posts - 1), 0.07, 1.06, 0.07, { solid: false });
    }
  }

  /** Waist-high armored deck/bulkhead cover with steel top coping trim (never a plain whitebox block!). */
  cover(cx: number, y: number, cz: number, w: number, d: number, tall = false, rotY = 0, key: ShipPbrKey = 'hull') {
    const h = tall ? 1.48 : 1.12;
    this.box(key, cx, y, cz, w, h, d, { rotY, surf: 'metal', tile: 2.0 });
    this.box('steel', cx, y + h - 0.07, cz, w + 0.08, 0.09, d + 0.08, { rotY, solid: false });
  }

  finalize(pbr: Record<ShipPbrKey, THREE.Material>, group: THREE.Group) {
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, pbr[key]);
      mesh.castShadow = key !== 'deck' && key !== 'cabinFloor' && key !== 'glass';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------
// Build Full AAA 276m × 40m M/V Taishan Remake ("深海利刃 · 泰山号万吨货轮")
// ---------------------------------------------------------------------------
export function buildShipRemake(world: World, mats: Materials): LevelData & { ship: ShipRemakeDynamic } {
  world.baseGroundY = -14;
  const group = new THREE.Group();
  const staticPropsRoot = new THREE.Group();
  const b = new ShipBuilder(world);

  // =========================================================================
  // 1. AAA Naval PBR Material Palette (1024px Naval Scans + 4K Poly Haven + Wetness + Grime)
  // =========================================================================
  const pbr: Record<ShipPbrKey, THREE.Material> = {
    hull: makeNavalMat({ kind: 'ship', name: 'hull_plate' }, {
      color: 0xaab4be, roughness: 0.72, metalness: 0.52, normalScale: 1.45, aoIntensity: 0.75,
      macro: [0.22, 0.07, 0.40], grime: [0.68, 0.16], wet: [0.65, 0], detail: [0.75, 8],
    }),
    deck: makeNavalMat({ kind: 'ship', name: 'deck_tread' }, {
      color: 0x9aa4ae, roughness: 0.62, metalness: 0.58, normalScale: 1.50, aoIntensity: 0.72,
      macro: [0.24, 0.08, 0.45], wet: [0.95, 0.46], detail: [0.78, 9],
    }),
    bulkhead: makeNavalMat({ kind: 'ship', name: 'bulkhead_panel' }, {
      color: 0xc8ced2, roughness: 0.60, metalness: 0.22, normalScale: 1.25, aoIntensity: 0.72,
      macro: [0.25, 0.08, 0.28], grime: [0.42, 0.06], detail: [0.62, 7],
    }),
    ceiling: makeNavalMat({ kind: 'scan', name: 'concrete' }, {
      color: 0x5d6874, roughness: 0.78, metalness: 0.28, normalScale: 1.15, aoIntensity: 0.72,
      grime: [0.45, 0.05], detail: [0.70, 7],
    }),
    cabinFloor: makeNavalMat({ kind: 'scan', name: 'slab' }, {
      color: 0x5c6876, roughness: 0.62, metalness: 0.18, normalScale: 1.20, aoIntensity: 0.68,
      macro: [0.25, 0.09, 0.35], grime: [0.45, 0.06], detail: [0.72, 8], pom: [0.012, 8],
    }),
    tile: makeNavalMat({ kind: 'ship', name: 'ceramic_tile' }, {
      color: 0xd4dcd8, roughness: 0.36, metalness: 0.05, normalScale: 1.45, aoIntensity: 0.78,
      wet: [0.55, 0.18], detail: [0.48, 8],
    }),
    galley: makeNavalMat({ kind: 'ship', name: 'galley_steel' }, {
      color: 0xcfd6dc, roughness: 0.34, metalness: 0.82, normalScale: 1.15, aoIntensity: 0.65,
      detail: [0.55, 8],
    }),
    steel: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0x444c55, roughness: 0.56, metalness: 0.72, normalScale: 1.20, aoIntensity: 0.68,
      grime: [0.52, 0.18], wet: [0.55, 0], detail: [0.78, 7],
    }),
    grating: makeNavalMat({ kind: 'ship', name: 'deck_tread' }, {
      color: 0x8a949e, roughness: 0.54, metalness: 0.68, normalScale: 1.40, aoIntensity: 0.70,
      wet: [0.65, 0], detail: [0.80, 9],
    }),
    rust: makeNavalMat({ kind: 'scan', name: 'corrugated' }, {
      color: 0x7c4f3b, roughness: 0.78, metalness: 0.44, normalScale: 1.35, aoIntensity: 0.72,
      grime: [0.68, 0.20], detail: [0.82, 8], pom: [0.020, 10],
    }),
    wood: makeNavalMat({ kind: 'scan', name: 'wood' }, {
      color: 0x9c724c, roughness: 0.58, metalness: 0.05, normalScale: 1.20, aoIntensity: 0.68,
      detail: [0.65, 8],
    }),
    hazard: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0xa68436, roughness: 0.64, metalness: 0.28, normalScale: 1.20, aoIntensity: 0.68,
      grime: [0.58, 0.20], detail: [0.78, 8],
    }),
    chevron: (() => {
      const ch = makeHazardChevronTextures();
      const mat = new THREE.MeshStandardMaterial({
        map: ch.map, normalMap: ch.normalMap, normalScale: new THREE.Vector2(1.25, 1.25),
        roughnessMap: ch.roughnessMap, color: 0xffffff, roughness: 0.78, metalness: 0.28, vertexColors: false,
      });
      applyGrime(mat, 0.58, 0.16);
      applyWetness(mat, 0.65, 0);
      return mat;
    })(),
    pipeRed: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0x8c3028, roughness: 0.52, metalness: 0.42, normalScale: 1.0, detail: [0.65, 7],
    }),
    pipeBlue: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0x305d82, roughness: 0.52, metalness: 0.42, normalScale: 1.0, detail: [0.65, 7],
    }),
    pipeAmber: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0xa4782e, roughness: 0.54, metalness: 0.40, normalScale: 1.0, detail: [0.65, 7],
    }),
    epsilonWall: makeNavalMat({ kind: 'ship', name: 'container_corrug' }, {
      color: 0x82322c, roughness: 0.62, metalness: 0.46, normalScale: 1.55, aoIntensity: 0.78,
      grime: [0.65, 0.15], detail: [0.78, 8],
    }),
    glass: mats.glass,
  };

  // Multi-Color Corrugated Shipping Container PBR Variants (Maersk Blue / COSCO Red / Evergreen Green / Ochre)
  const contMats = [0x4c7498, 0x924036, 0x42705a, 0xa88442].map((hex) =>
    makeNavalMat({ kind: 'ship', name: 'container_corrug' }, {
      color: hex, roughness: 0.62, metalness: 0.42, normalScale: 1.55, aoIntensity: 0.72,
      grime: [0.64, 0.20], wet: [0.75, 0], detail: [0.78, 8],
    }),
  );

  // Semantic Blender SMAT_* PBR Map for ALL 13 Naval Hero GLBs!
  const glbPbr: Record<string, THREE.Material> = {
    SMAT_CONT_BODY: contMats[0],
    SMAT_STEEL_DARK: pbr.steel,
    SMAT_RUST_STEEL: pbr.rust,
    SMAT_STAINLESS: pbr.galley,
    SMAT_PIPE_RED: pbr.pipeRed,
    SMAT_WOOD_WARM: pbr.wood,
    SMAT_CRANE_OCHRE: makeNavalMat({ kind: 'ship', name: 'hull_plate' }, {
      color: 0xc29238, roughness: 0.64, metalness: 0.34, normalScale: 1.35, aoIntensity: 0.72,
      grime: [0.72, 0.22], wet: [0.65, 0], detail: [0.75, 8],
    }),
    SMAT_ENGINE_TEAL: makeNavalMat({ kind: 'ship', name: 'hull_plate' }, {
      color: 0x3e6268, roughness: 0.50, metalness: 0.62, normalScale: 1.30, aoIntensity: 0.75,
      grime: [0.65, 0.10], detail: [0.75, 8],
    }),
    SMAT_BRIDGE_WHITE: makeNavalMat({ kind: 'ship', name: 'bulkhead_panel' }, {
      color: 0xd0d6da, roughness: 0.56, metalness: 0.24, normalScale: 1.15, aoIntensity: 0.68,
      grime: [0.55, 0.18], wet: [0.65, 0], detail: [0.65, 7],
    }),
    SMAT_DOOR_STEEL: makeNavalMat({ kind: 'ship', name: 'hull_plate' }, {
      color: 0x62707e, roughness: 0.56, metalness: 0.62, normalScale: 1.35, aoIntensity: 0.75,
      grime: [0.68, 0.15], detail: [0.78, 8],
    }),
    SMAT_LIFEBOAT_ORG: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0xb84624, roughness: 0.48, metalness: 0.18, normalScale: 1.0, aoIntensity: 0.65,
      grime: [0.55, 0.22], wet: [0.75, 0], detail: [0.68, 7],
    }),
    SMAT_MIL_OLIVE: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0x48543c, roughness: 0.64, metalness: 0.36, normalScale: 1.25, aoIntensity: 0.72,
      grime: [0.68, 0.20], wet: [0.70, 0], detail: [0.78, 8],
    }),
    SMAT_HELI_NAVY: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0x3a444e, roughness: 0.48, metalness: 0.52, normalScale: 1.10, aoIntensity: 0.68,
      wet: [0.75, 0], detail: [0.72, 8],
    }),
    SMAT_NAVY_FABRIC: makeNavalMat({ kind: 'scan', name: 'burlap' }, {
      color: 0x324864, roughness: 0.88, metalness: 0.02, normalScale: 1.25, aoIntensity: 0.68,
    }),
    SMAT_STALL_BLUE: makeNavalMat({ kind: 'scan', name: 'metal' }, {
      color: 0x4c6272, roughness: 0.50, metalness: 0.38, normalScale: 1.0, aoIntensity: 0.65,
      detail: [0.60, 7],
    }),
    SMAT_PORCELAIN: new THREE.MeshStandardMaterial({ color: 0xe2e6e4, roughness: 0.16, metalness: 0.06, envMapIntensity: 1.25 }),
    SMAT_MIRROR: new THREE.MeshStandardMaterial({ color: 0xdcf0fa, emissive: 0x38586c, emissiveIntensity: 0.45, roughness: 0.04, metalness: 0.96, envMapIntensity: 1.6 }),
    SMAT_GLASS_DARK: new THREE.MeshStandardMaterial({ color: 0x0c1a24, roughness: 0.10, metalness: 0.84, envMapIntensity: 1.55 }),
    SMAT_LAMP_WARM: new THREE.MeshStandardMaterial({ map: makeFresnelLensTexture(), emissiveMap: makeFresnelLensTexture(), color: 0xffe4b0, emissive: 0xffc870, emissiveIntensity: 3.0, roughness: 0.2 }),
    SMAT_BEACON_RED: new THREE.MeshStandardMaterial({ map: makeFresnelLensTexture(), emissiveMap: makeFresnelLensTexture(), color: 0xff2818, emissive: 0xff2414, emissiveIntensity: 4.2, roughness: 0.2 }),
  };

  // Midnight Storm Moonlight + Ocean Sky Bounce Fill (dramatic Battlefield 4 South China Sea contrast without crushing black!)
  const stormHemi = new THREE.HemisphereLight(0x7ca6dc, 0x2e4054, 0.92);
  group.add(stormHemi);

  /** High-detail procedural naval telemetry/radar/ECDIS/menu screen texture helper. */
  const screenMats = new Map<string, THREE.MeshStandardMaterial>();
  const makeScreenMat = (kind: 'radar' | 'ecdis' | 'engine' | 'menu' | 'temp') => {
    let m = screenMats.get(kind);
    if (m) return m;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 320;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = kind === 'menu' ? '#16202a' : kind === 'temp' ? '#101418' : '#07131c';
    ctx.fillRect(0, 0, 512, 320);
    if (kind === 'radar') {
      const cx = 190, cy = 160, R = 132;
      ctx.strokeStyle = 'rgba(56,238,144,0.35)'; ctx.lineWidth = 2;
      for (const r of [35, 70, 102, R]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
      grad.addColorStop(0, 'rgba(60,255,150,0.42)'); grad.addColorStop(1, 'rgba(20,160,90,0.0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -1.1, -0.35); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#60ff9e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(-0.35) * R, cy + Math.sin(-0.35) * R); ctx.stroke();
      for (const [bx, by, col] of [[cx + 42, cy - 55, '#ff4838'], [cx - 60, cy + 28, '#58ff9a'], [cx + 84, cy + 44, '#ffbd44']] as const) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#66f5a4'; ctx.font = 'bold 20px monospace';
      ctx.fillText('RADAR X-BAND', 344, 52);
      ctx.font = '15px monospace'; ctx.fillStyle = '#a8f8c8';
      ctx.fillText('RNG  12.0 NM', 344, 92);
      ctx.fillText('HDG  042.5°T', 344, 122);
      ctx.fillText('SPD  14.2 KT', 344, 152);
      ctx.fillStyle = '#ff6858'; ctx.fillText('TGT  HOSTILE', 344, 198);
      ctx.fillStyle = '#48d8ff'; ctx.fillText('DDG-173  7NM', 344, 232);
    } else if (kind === 'ecdis') {
      ctx.strokeStyle = 'rgba(56,196,245,0.22)'; ctx.lineWidth = 1.5;
      for (let x = 0; x < 512; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 320); ctx.stroke(); }
      for (let y = 0; y < 320; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
      ctx.fillStyle = 'rgba(28,82,92,0.55)'; ctx.beginPath();
      ctx.moveTo(0, 260); ctx.lineTo(130, 220); ctx.lineTo(220, 245); ctx.lineTo(310, 170); ctx.lineTo(420, 200); ctx.lineTo(512, 130); ctx.lineTo(512, 320); ctx.lineTo(0, 320); ctx.fill();
      ctx.strokeStyle = '#ff6644'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(60, 230); ctx.lineTo(180, 160); ctx.lineTo(340, 110); ctx.lineTo(465, 65); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#48e8ff'; ctx.font = 'bold 20px monospace'; ctx.fillText('SOUTH CHINA SEA · ECDIS NAV', 20, 34);
      ctx.fillStyle = '#ffcf58'; ctx.font = '16px monospace'; ctx.fillText('MV TAISHAN · 18°42.6N 114°19.3E', 20, 62);
    } else if (kind === 'engine') {
      ctx.fillStyle = '#ffbe48'; ctx.font = 'bold 22px monospace'; ctx.fillText('MAIN DIESEL TELEMETRY · 12V-480', 22, 38);
      for (let i = 0; i < 6; i++) {
        const bx = 34 + i * 76, h = 95 + (i % 3) * 32;
        ctx.fillStyle = '#182a38'; ctx.fillRect(bx, 72, 46, 170);
        ctx.fillStyle = i === 4 ? '#ff5438' : '#3ee69a'; ctx.fillRect(bx, 242 - h, 46, h);
        ctx.fillStyle = '#c8dde8'; ctx.font = '14px monospace'; ctx.fillText(`CYL${i + 1}`, bx + 4, 266);
      }
      ctx.fillStyle = '#ff7252'; ctx.font = 'bold 18px monospace'; ctx.fillText('RPM: 112 | OIL: 5.4 BAR | BILGE: WARN', 22, 302);
    } else if (kind === 'menu') {
      ctx.fillStyle = '#243446'; ctx.fillRect(10, 10, 492, 300);
      ctx.strokeStyle = '#d49830'; ctx.lineWidth = 4; ctx.strokeRect(12, 12, 488, 296);
      ctx.fillStyle = '#f2c15a'; ctx.font = 'bold 28px "Microsoft YaHei", sans-serif'; ctx.fillText('泰山号远洋船员餐厅 · 今日伙食', 36, 56);
      ctx.fillStyle = '#dde6ee'; ctx.font = '20px "Microsoft YaHei", sans-serif';
      ctx.fillText('07:00 早餐 · 豆浆油条 / 海鲜粥 / 水煮蛋', 36, 108);
      ctx.fillText('12:00 午餐 · 红烧海鱼 / 土豆炖牛腩 / 时蔬', 36, 152);
      ctx.fillText('18:00 晚餐 · 椒盐大虾 / 蒜蓉油麦菜 / 紫菜汤', 36, 196);
      ctx.fillStyle = '#68d4e8'; ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
      ctx.fillText('值班夜宵 23:30 供应 · 严禁浪费淡水与冷库食材', 36, 256);
    } else {
      ctx.strokeStyle = '#384654'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 496, 304);
      ctx.fillStyle = '#ff3824'; ctx.font = 'bold 116px monospace'; ctx.fillText('-18.4°C', 28, 196);
      ctx.fillStyle = '#68d8ff'; ctx.font = 'bold 26px monospace'; ctx.fillText('COLD STORAGE · NORMAL', 56, 266);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.owned = true;
    m = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff,
      emissiveIntensity: kind === 'menu' ? 0.55 : 1.35, roughness: 0.25, metalness: 0.15,
    });
    screenMats.set(kind, m);
    return m;
  };

  const sharedGlbMat = new Map<string, THREE.Material>();
  const resolveMat = (mat: THREE.Material, contVariant?: number): THREE.Material => {
    const key = mat.name || mat.uuid;
    const base = key.split('.')[0];
    if (base === 'SMAT_CONT_BODY' && contVariant !== undefined) return contMats[contVariant % contMats.length];
    if (glbPbr[key]) return glbPbr[key];
    if (glbPbr[base]) return glbPbr[base];
    let cached = sharedGlbMat.get(key);
    if (!cached) { cached = mat; sharedGlbMat.set(key, cached); }
    return cached;
  };

  /** Collapse local static sub-meshes of animated GLBs by material to keep draw calls super low! */
  const collapseLocalByMat = (node: THREE.Object3D, skipPivotNames: string[] = []) => {
    node.updateMatrixWorld(true);
    const invRoot = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const skipNodes = skipPivotNames.map((n) => node.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    const isUnderSkip = (o: THREE.Object3D) => {
      let cur: THREE.Object3D | null = o;
      while (cur) { if (skipNodes.includes(cur)) return true; cur = cur.parent; }
      return false;
    };
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const toRemove: THREE.Object3D[] = [];
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || Array.isArray(m.material) || isUnderSkip(m)) return;
      const mat = resolveMat(m.material);
      const g = normGeo(m.geometry);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld));
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
    for (const sn of skipNodes) collapseLocalByMat(sn);
  };

  const cloneRaw = (
    name: RawModelName, x: number, y: number, z: number,
    rotY = 0, scale = 1, mergeStatic = true, opts: { contVariant?: number; skipPivots?: string[] } = {},
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
        if (!Array.isArray(m.material)) m.material = resolveMat(m.material, opts.contVariant);
      }
    });
    if (mergeStatic) {
      staticPropsRoot.add(inst);
    } else {
      collapseLocalByMat(inst, opts.skipPivots ?? []);
      group.add(inst);
    }
    return inst;
  };

  /** Place a realistic 3D Blender corrugated ISO shipping container stack + exact physics collider! */
  let contCounter = 0;
  const addContainer = (cx: number, y: number, cz: number, rotY = 0, stacks = 1, variant?: number) => {
    for (let i = 0; i < stacks; i++) {
      const v = variant ?? (contCounter++ % 4);
      cloneRaw('ship_container', cx, y + i * 2.8, cz, rotY, 1.0, true, { contVariant: v });
      world.addBox(cx, y + i * 2.8 + 1.4, cz, 1.28, 1.4, 3.16, rotY, 'metal');
    }
  };

  // Weathered maritime prop tinting so no clinical white barrels/containers pop in night lighting
  const propMatCache = new Map<string, THREE.Material>();
  const PROP_TINTS: Partial<Record<PropName, number>> = {
    barrel: 0x5d4c42, container: 0x425666, dumpster: 0x485650,
  };
  const addProp = (name: PropName, x: number, y: number, z: number, rotY = 0, scale = 1) => {
    const obj = makePropObject(name, scale);
    if (!obj) return;
    const tint = PROP_TINTS[name];
    if (tint) {
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material)) {
          const k = `${m.material.uuid}_${tint}`;
          let c = propMatCache.get(k);
          if (!c) {
            const cl = m.material.clone() as THREE.MeshStandardMaterial;
            cl.name = k;
            if (cl.color) cl.color.multiply(new THREE.Color(tint));
            c = cl;
            propMatCache.set(k, c);
          }
          m.material = c;
        }
      });
    }
    obj.position.set(x, y, z);
    obj.rotation.y = rotY;
    staticPropsRoot.add(obj);
  };

  const addSign = (title: string, sub: string, x: number, y: number, z: number, rotY = 0, accent = '#c89438', w = 2.65, h = 0.62) => {
    const s = makeMarineSign(title, sub, accent, w, h);
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    group.add(s);
  };

  /** Physical glowing ceiling fluorescent / caged marine Fresnel light trough paired with a real PointLight. */
  const marineLensTex = makeFresnelLensTexture();
  const lampWarmMat = new THREE.MeshStandardMaterial({ map: marineLensTex, emissiveMap: marineLensTex, color: 0xffefc8, emissive: 0xffca74, emissiveIntensity: 3.1, roughness: 0.22 });
  const lampCoolMat = new THREE.MeshStandardMaterial({ map: marineLensTex, emissiveMap: marineLensTex, color: 0xd0ecff, emissive: 0x7ec8ff, emissiveIntensity: 2.9, roughness: 0.22 });
  const lampRedMat  = new THREE.MeshStandardMaterial({ map: marineLensTex, emissiveMap: marineLensTex, color: 0xff5a48, emissive: 0xff2818, emissiveIntensity: 3.5, roughness: 0.22 });
  const alarmLights: THREE.PointLight[] = [];
  const engineLights: THREE.PointLight[] = [];

  const addCeilingLamp = (
    x: number, y: number, z: number,
    style: 'warm' | 'cool' | 'sodium',
    intensity = 28, dist = 28,
    trackEngine = false,
  ) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.34), style === 'cool' ? lampCoolMat : lampWarmMat);
    bar.position.set(x, y, z);
    group.add(bar);
    const col = style === 'cool' ? 0x84ccff : style === 'sodium' ? 0xffb252 : 0xffe0a8;
    const pt = new THREE.PointLight(col, intensity, dist, 1.45);
    pt.position.set(x, y - 0.35, z);
    group.add(pt);
    if (trackEngine) engineLights.push(pt);
    return pt;
  };

  // Physical Motorized Watertight Blast Gate Builder (ZERO INVISIBLE WALLS!)
  const gates: ShipRemakeDynamic['gates'] = { g12: [], g23: [], g34: [], g45: [], g56: [], mess: [] };
  const addBlastGate = (
    key: keyof ShipRemakeDynamic['gates'],
    cx: number, y: number, cz: number,
    width: number, height: number,
    rotY = 0,
  ) => {
    const door = assets.gltf.ship_watertight_door.scene.clone(true);
    door.position.set(cx, y, cz);
    door.rotation.y = rotY;
    door.scale.set(width / 4.4, height / 3.38, 1.0);
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

    const col = world.addBox(cx, y + height * 0.5, cz, width * 0.5, height * 0.5, 0.42, rotY, 'metal');
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff2818, emissive: 0xff2818, emissiveIntensity: 3.6, roughness: 0.2,
    });
    const beaconMesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.24, 0.30), beaconMat);
    beaconMesh.position.set(cx, y + height + 0.32, cz);
    beaconMesh.rotation.y = rotY;
    group.add(beaconMesh);
    const beaconLight = new THREE.PointLight(0xff3020, 12, 12, 1.6);
    beaconLight.position.set(cx, y + height + 0.12, cz);
    group.add(beaconLight);

    // Slide horizontally along the wall plane into its steel pocket (NEVER pokes through upper deck floors!)
    const slideDist = width + 0.35;
    const openX = cx + Math.cos(rotY) * slideDist;
    const openZ = cz - Math.sin(rotY) * slideDist;
    gates[key].push({
      id: key, mesh: door, col, closedX: cx, closedZ: cz, openX, openZ, openT: 0, isOpen: false, beaconMat, beaconLight,
    });
  };

  // =========================================================================
  // 0. 3A GERSTNER STORMY SOUTH CHINA SEA OCEAN + FOAM WAKE + 276m HULL SHELL
  // =========================================================================
  const seaUniforms = {
    uTime: { value: 0 },
    uLightning: stormLightningUniform,
    uFogColor: { value: new THREE.Color(0x0b1624) },
    uFogDensity: { value: 0.0042 },
  };
  const seaMat = new THREE.ShaderMaterial({
    uniforms: seaUniforms,
    side: THREE.FrontSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vWaveNormal;
      varying float vWaveH;
      varying float vCrest;
      varying float vHullProx;

      // Exact 2D signed distance to M/V Taishan's 275m × 40m hull footprint (negative inside hull, positive outside)
      float shipSignedDist(vec2 xz) {
        float halfW = 19.95;
        if (xz.y > 115.8) {
          float tBow = clamp((xz.y - 115.8) / 22.4, 0.0, 1.0);
          halfW = mix(19.95, 3.8, tBow);
        }
        vec2 d = vec2(abs(xz.x) - halfW, abs(xz.y - 0.9) - 137.3);
        return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
      }

      // Single directional Gerstner wave train accumulating displacement & analytic partial derivatives
      void addGerstner(vec2 xz, vec2 dir, float steep, float amp, float wl, float spd, float t, inout vec3 disp, inout vec3 dPdx, inout vec3 dPdz, inout float crestAcc) {
        float k = 6.2831853 / wl;
        float ph = k * dot(dir, xz) - spd * t;
        float s = sin(ph), c = cos(ph);
        float qa = steep * amp;
        disp.x += dir.x * qa * c;
        disp.z += dir.y * qa * c;
        disp.y += amp * s;
        dPdx += vec3(-dir.x * dir.x * k * qa * s, dir.x * k * amp * c, -dir.x * dir.y * k * qa * s);
        dPdz += vec3(-dir.x * dir.y * k * qa * s, dir.y * k * amp * c, -dir.y * dir.y * k * qa * s);
        crestAcc += max(0.0, s) * steep;
      }

      void main() {
        vec4 wp0 = modelMatrix * vec4(position, 1.0);
        vec2 xz = wp0.xz;
        float sDist = shipSignedDist(xz);
        // Zero wave displacement inside the hull footprint (sDist <= 0.4m), ramping smoothly to full storm swells outside!
        float hullMask = smoothstep(0.4, 3.2, sDist);
        float distAtten = 1.0 - smoothstep(260.0, 1150.0, length(xz));
        float ampScale = hullMask * (0.25 + 0.75 * distAtten);

        vec3 disp = vec3(0.0);
        vec3 dPdx = vec3(1.0, 0.0, 0.0);
        vec3 dPdz = vec3(0.0, 0.0, 1.0);
        float crest = 0.0;

        addGerstner(xz, normalize(vec2(-0.82, -0.57)), 0.34, 1.45 * ampScale, 54.0, 1.95, uTime, disp, dPdx, dPdz, crest);
        addGerstner(xz, normalize(vec2(-0.42,  0.91)), 0.30, 0.98 * ampScale, 36.0, 2.35, uTime, disp, dPdx, dPdz, crest);
        addGerstner(xz, normalize(vec2(-0.94,  0.34)), 0.28, 0.64 * ampScale, 21.0, 3.05, uTime, disp, dPdx, dPdz, crest);
        addGerstner(xz, normalize(vec2( 0.28, -0.96)), 0.25, 0.42 * ampScale, 13.5, 3.65, uTime, disp, dPdx, dPdz, crest);
        addGerstner(xz, normalize(vec2(-0.67, -0.74)), 0.22, 0.24 * ampScale,  7.8, 4.45, uTime, disp, dPdx, dPdz, crest);
        addGerstner(xz, normalize(vec2(-0.18,  0.98)), 0.20, 0.15 * ampScale,  4.6, 5.30, uTime, disp, dPdx, dPdz, crest);

        vec3 worldP = wp0.xyz + disp;
        vWorldPos = worldP;
        vWaveNormal = normalize(cross(dPdz, dPdx));
        vWaveH = disp.y;
        vCrest = crest * hullMask;
        vHullProx = sDist;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uLightning;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec3 vWorldPos;
      varying vec3 vWaveNormal;
      varying float vWaveH;
      varying float vCrest;
      varying float vHullProx;

      float ocHash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float ocNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(ocHash(i), ocHash(i + vec2(1.0, 0.0)), f.x),
          mix(ocHash(i + vec2(0.0, 1.0)), ocHash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float ocFbm(vec2 p) {
        float a = 0.5, s = 0.0;
        for (int i = 0; i < 4; i++) {
          s += a * ocNoise(p);
          p = p * 2.06 + vec2(17.3, 29.1);
          a *= 0.5;
        }
        return s;
      }

      void main() {
        vec2 xz = vWorldPos.xz;
        // Hard per-pixel hull interior clip: guarantees zero ocean waves or foam ever intrude into B1 bilge, cargo hold, or engine room!
        float halfW = 19.95;
        if (xz.y > 115.8) {
          halfW = mix(19.95, 3.8, clamp((xz.y - 115.8) / 22.4, 0.0, 1.0));
        }
        vec2 hd = vec2(abs(xz.x) - halfW, abs(xz.y - 0.9) - 137.3);
        if (min(max(hd.x, hd.y), 0.0) + length(max(hd, 0.0)) < 0.05) discard;
        vec3 V = normalize(cameraPosition - vWorldPos);
        float dist = length(cameraPosition - vWorldPos);

        // Multi-octave capillary micro-ripple normal perturbation
        vec2 wFlow1 = xz * 0.34 + vec2(-uTime * 0.72, -uTime * 0.48);
        vec2 wFlow2 = xz * 1.15 + vec2(-uTime * 1.15,  uTime * 0.84);
        float nA = ocFbm(wFlow1);
        float nB = ocFbm(wFlow2);
        float nAx = ocFbm(wFlow1 + vec2(0.18, 0.0)) - nA;
        float nAz = ocFbm(wFlow1 + vec2(0.0, 0.18)) - nA;
        float nBx = ocFbm(wFlow2 + vec2(0.12, 0.0)) - nB;
        float nBz = ocFbm(wFlow2 + vec2(0.0, 0.12)) - nB;
        float microFade = 1.0 - smoothstep(45.0, 320.0, dist);
        vec3 N = normalize(vWaveNormal + vec3((nAx * 2.4 + nBx * 1.6) * microFade, 0.0, (nAz * 2.4 + nBz * 1.6) * microFade));

        // 1. Deep Abyssal Navy Troughs + Subsurface Emerald-Teal Backlit Wave Crests
        vec3 deepCol = vec3(0.012, 0.032, 0.058);
        vec3 midCol  = vec3(0.032, 0.095, 0.145);
        vec3 sssCol  = vec3(0.075, 0.320, 0.395) * (1.0 + uLightning * 1.35);
        float hNorm = clamp((vWaveH + 2.2) / 4.8, 0.0, 1.0);
        vec3 waterCol = mix(deepCol, midCol, smoothstep(0.15, 0.78, hNorm));
        float sssFactor = pow(clamp(vWaveH * 0.42 + vCrest * 0.45, 0.0, 1.0), 1.6) * (0.45 + 0.55 * pow(1.0 - max(0.0, N.y), 0.8));
        waterCol = mix(waterCol, sssCol, clamp(sssFactor, 0.0, 0.78));

        // 2. Schlick Fresnel Storm-Sky & Sheet-Lightning Reflection
        float NoV = max(0.001, dot(N, V));
        float fresnel = 0.03 + 0.97 * pow(1.0 - NoV, 4.6);
        vec3 R = reflect(-V, N);
        float skyGrad = smoothstep(-0.05, 0.55, max(R.y, 0.0));
        vec3 skyRefl = mix(vec3(0.075, 0.135, 0.215), vec3(0.16, 0.26, 0.39), skyGrad);
        skyRefl += vec3(0.68, 0.86, 1.25) * uLightning * (0.45 + 0.55 * skyGrad);
        // Storm moon & lightning directional specular highlight
        vec3 L = normalize(vec3(0.42, 0.52, -0.74));
        vec3 Hvec = normalize(L + V);
        float spec = pow(max(0.0, dot(N, Hvec)), 96.0) * (1.35 + uLightning * 3.8);
        skyRefl += vec3(0.82, 1.05, 1.35) * spec;

        // Warm amber sodium floodlight reflections on water alongside M/V Taishan's hull
        float hullBand = smoothstep(38.0, 1.5, vHullProx) * smoothstep(-2.0, 0.2, vHullProx);
        float deckGlow = (0.4 + 0.6 * pow(max(0.0, N.x * sign(xz.x)), 2.0)) * hullBand;
        skyRefl += vec3(1.15, 0.64, 0.24) * deckGlow * (0.45 + 0.55 * nB);

        vec3 col = mix(waterCol, skyRefl, clamp(fresnel, 0.0, 0.92));

        // 3. Lacy Storm Whitecap Foam on Breaking Crests + Wind-Driven Foam Streaks + Frothy Hull-Wake Spray
        float foamNoise = nA * 0.55 + nB * 0.45;
        float fineCell1 = ocNoise(xz * 2.1 + vec2(-uTime * 0.9, uTime * 0.7));
        float fineCell2 = ocNoise(xz * 5.4 + vec2(uTime * 1.3, -uTime * 1.1));
        float lacyMask = clamp(foamNoise * 0.55 + fineCell1 * 0.30 + fineCell2 * 0.25, 0.0, 1.0);
        // Breaking wave-crest whitecaps (frothy lacy cellular pattern)
        float crestDriver = vCrest * 0.65 + foamNoise * 0.48;
        float crestFoam = smoothstep(0.58, 0.92, crestDriver) * smoothstep(0.32, 0.76, lacyMask) * smoothstep(0.05, 1.5, vWaveH);
        // Wind-blown parallel langmuir foam streaks across wave slopes
        float windLane = ocNoise(vec2(xz.x * 0.28 - xz.y * 0.19 + nA * 1.5, xz.y * 0.06 + uTime * 0.35));
        float streakFoam = smoothstep(0.72, 0.92, windLane * lacyMask * 1.38) * 0.42 * microFade;
        // Frothy churning hull-wake & bow-spray foam crashing against M/V Taishan's 276m hull & distant destroyer
        float bowBoost = smoothstep(75.0, 136.0, xz.y) * 3.5;
        float wakeWidth = 4.2 + bowBoost + (nA - 0.5) * 3.2;
        float hullWake = smoothstep(wakeWidth, 0.1, vHullProx) * smoothstep(-0.75, 0.15, vHullProx);
        float hullFoam = hullWake * smoothstep(0.36, 0.74, lacyMask + hullWake * 0.28) * 0.82;
        // Secondary outer wave-wash ring around the hull
        float outerRing = smoothstep(1.4, 0.0, abs(vHullProx - (3.4 + (nA - 0.5) * 2.4))) * hullBand * smoothstep(0.42, 0.78, lacyMask) * 0.55;
        // Distant destroyer hull wake (at X = 165, Z = -35)
        vec2 dRel = abs(xz - vec2(165.0, -35.0)) - vec2(8.5, 60.5);
        float destDist = length(max(dRel, 0.0));
        float destFoam = smoothstep(5.0, 0.2, destDist) * smoothstep(0.40, 0.75, lacyMask) * 0.75;

        float totalFoam = clamp(max(max(crestFoam, streakFoam), max(hullFoam + outerRing, destFoam)), 0.0, 1.0);
        vec3 foamAlbedo = vec3(0.74, 0.85, 0.96) * (0.48 + 0.52 * max(0.25, N.y) + uLightning * 0.65) + vec3(0.42, 0.24, 0.09) * hullBand * 0.30;
        col = mix(col, foamAlbedo, totalFoam * 0.82);

        // Exponential storm horizon fog blend (seamless transition into SKY_STORM_FRAG horizon)
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        vec3 fogTarget = uFogColor + vec3(0.18, 0.26, 0.38) * uLightning;
        col = mix(col, fogTarget, clamp(fogF, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  // Radially concentrated 240x240 ocean geometry: ~2.4m dense wave triangles near the ship, stretching smoothly to 1400m horizon!
  const seaGeo = new THREE.PlaneGeometry(2400, 2400, 240, 240);
  const seaPosAttr = seaGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < seaPosAttr.count; i++) {
    const px = seaPosAttr.getX(i);
    const py = seaPosAttr.getY(i);
    const r = Math.hypot(px, py);
    if (r > 0.001) {
      const tR = Math.min(1, r / 1200);
      const scale = 0.32 + 0.68 * (tR * tR);
      seaPosAttr.setXY(i, px * scale, py * scale);
    }
  }
  const seaMesh = new THREE.Mesh(seaGeo, seaMat);
  seaMesh.rotation.x = -H;
  seaMesh.position.y = -7.6;
  seaMesh.frustumCulled = false;
  seaMesh.userData.noAo = true;
  group.add(seaMesh);

  // Distant PLA Navy Destroyer Silhouette + Soft Fresnel-Faded Volumetric Searchlight Beam off Port Horizon
  const dest = new THREE.Group();
  dest.position.set(165, -8.5, -35);
  const dHull = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 120), pbr.steel);
  dHull.position.y = 4;
  const dBridge = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 30), pbr.steel);
  dBridge.position.set(0, 13, 8);
  const dMast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 18, 8), pbr.steel);
  dMast.position.set(0, 26, 10);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0x98ceff) } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        float fresnel = pow(abs(dot(normalize(vNormalV), normalize(vViewPos))), 2.6);
        float lenFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.15, vUv.y);
        float alpha = fresnel * lenFade * 0.14;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 13, 140, 20, 1, true), beamMat);
  beam.position.set(-55, 42, -10);
  beam.rotation.z = H - 0.35;
  dest.add(dHull, dBridge, dMast, beam);
  group.add(dest);

  // Continuous Welded Ship Hull Outer Plating + 1.45m Raised Steel Bulwarks + Rib Stanchions Every 6m (ZERO INVISIBLE WALLS!)
  b.box('hull', -20.4, -8.5, -10, 0.9, 9.95, 252);
  b.box('hull',  20.4, -8.5, -10, 0.9, 9.95, 252);
  b.box('steel', -20.4, 1.45, -10, 1.05, 0.16, 252, { solid: false }); // Top gunwale rail cap
  b.box('steel',  20.4, 1.45, -10, 1.05, 0.16, 252, { solid: false });
  for (let rz = -132; rz <= 112; rz += 6) {
    b.box('steel', -19.8, 0.0, rz, 0.28, 1.45, 0.28, { solid: false });
    b.box('steel',  19.8, 0.0, rz, 0.28, 1.45, 0.28, { solid: false });
  }
  b.box('hull', 0, -8.5, -136.4, 41.6, 10.1, 0.9);
  for (const s of [-1, 1]) {
    b.box('hull', s * 11.9, -8.5, 127.0, 0.9, 10.1, 27.4, { rotY: -s * 0.635 });
  }
  b.box('hull', 0, -8.5, 138.2, 8.2, 10.2, 0.9);

  // =========================================================================
  // 0.5 EXTERIOR MARITIME BEAUTIFICATION (Waterline Boot-Top, Hull Lettering,
  //     Illuminated White Superstructure Windows, Red/Green Nav Lights,
  //     Deck Floodlight Fixtures & Helipad Perimeter Beacons — 100% Exterior!)
  // =========================================================================
  {
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x6c2420, roughness: 0.62, metalness: 0.24 });
    applySurfacePatina(bootMat, 0.65, 6.0);
    const sheerMat = new THREE.MeshStandardMaterial({ color: 0xd2dae0, roughness: 0.52, metalness: 0.18 });
    const winWarmMat = new THREE.MeshStandardMaterial({
      color: 0xffe4ad, emissive: 0xffb04c, emissiveIntensity: 3.0, roughness: 0.18, metalness: 0.25,
    });
    const winBridgeMat = new THREE.MeshStandardMaterial({
      color: 0xd0f4ff, emissive: 0x4cc8ff, emissiveIntensity: 2.3, roughness: 0.15, metalness: 0.3,
    });
    const navRedMat = new THREE.MeshStandardMaterial({ color: 0xff3424, emissive: 0xff2214, emissiveIntensity: 5.5, roughness: 0.2 });
    const navGreenMat = new THREE.MeshStandardMaterial({ color: 0x24ff78, emissive: 0x16e864, emissiveIntensity: 5.5, roughness: 0.2 });
    const navAmberMat = new THREE.MeshStandardMaterial({ color: 0xffc858, emissive: 0xffa024, emissiveIntensity: 4.5, roughness: 0.2 });
    const whiteTrimMat = glbPbr.SMAT_BRIDGE_WHITE;

    const addExt = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.userData.noAo = true;
      group.add(m);
      return m;
    };

    // 1. Oxide-Red Anti-Fouling Waterline Boot-Top + Crisp White Upper Sheer Stripe along both hull flanks & bow!
    for (const s of [-1, 1]) {
      addExt(new THREE.BoxGeometry(0.14, 3.8, 252.4), bootMat, s * 20.90, -5.8, -10);
      addExt(new THREE.BoxGeometry(0.14, 0.36, 252.4), sheerMat, s * 20.91, 0.96, -10);
      // Tapered bow boot-top & sheer stripe + circular steel anchor hawsepipe
      addExt(new THREE.BoxGeometry(0.16, 3.8, 27.6), bootMat, s * 12.22, -5.8, 127.1, -s * 0.635);
      addExt(new THREE.BoxGeometry(0.16, 0.36, 27.6), sheerMat, s * 12.23, 0.96, 127.1, -s * 0.635);
      const hawse = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.16, 10, 18), pbr.steel);
      hawse.position.set(s * 12.6, -0.6, 126.4);
      hawse.rotation.y = H - s * 0.635;
      group.add(hawse);
    }
    // Stern transom red boot-top & white sheer line
    addExt(new THREE.BoxGeometry(41.8, 3.8, 0.16), bootMat, 0, -5.8, -136.92);
    addExt(new THREE.BoxGeometry(41.8, 0.36, 0.16), sheerMat, 0, 0.96, -136.93);

    // 2. Crisp Maritime Hull Lettering ("M/V TAISHAN · 泰山号 // IMO 9482716") on Port & Starboard Outer Flanks!
    const hullC = document.createElement('canvas');
    hullC.width = 1024; hullC.height = 192;
    const hctx = hullC.getContext('2d')!;
    hctx.clearRect(0, 0, 1024, 192);
    hctx.fillStyle = 'rgba(232, 240, 246, 0.92)';
    hctx.font = '800 84px "Microsoft YaHei", "Segoe UI", sans-serif';
    hctx.fillText('泰山号 · M/V TAISHAN', 24, 96);
    hctx.fillStyle = 'rgba(210, 224, 236, 0.78)';
    hctx.font = '700 34px Consolas, monospace';
    hctx.fillText('IMO 9482716  //  SHANGHAI  //  DWT 48,500T', 28, 154);
    const hullTex = new THREE.CanvasTexture(hullC);
    hullTex.colorSpace = THREE.SRGBColorSpace;
    hullTex.anisotropy = 8;
    hullTex.userData.owned = true;
    const hullTextMat = new THREE.MeshStandardMaterial({ map: hullTex, transparent: true, roughness: 0.55, metalness: 0.12, depthWrite: false });
    for (const s of [-1, 1]) {
      for (const lz of [86, -98]) {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(18.5, 3.4), hullTextMat);
        pl.position.set(s * 20.96, -1.35, lz);
        pl.rotation.y = s * H;
        pl.userData.noAo = true;
        group.add(pl);
      }
    }

    // 3. Classic Maritime White Superstructure Facade Trim + Glowing Warm Cabin Windows (Port, Starboard, Aft & Forward!)
    // White architectural cladding bands along upper superstructure tiers (2F Y=4.2..8.4, 3F Y=8.4..12.8) — sits strictly OUTSIDE outer wall!
    for (const s of [-1, 1]) {
      addExt(new THREE.BoxGeometry(0.18, 8.5, 44.4), whiteTrimMat, s * 19.78, 8.45, -42.0);
      addExt(new THREE.BoxGeometry(0.24, 0.34, 44.8), pbr.steel, s * 19.86, 4.25, -42.0);
      addExt(new THREE.BoxGeometry(0.24, 0.34, 44.8), pbr.steel, s * 19.86, 8.40, -42.0);
      addExt(new THREE.BoxGeometry(0.26, 0.42, 44.8), pbr.steel, s * 19.86, 12.65, -42.0);
      // Warm illuminated accommodation cabin windows on 1F (Y=2.1), 2F (Y=6.3) & 3F (Y=10.3)
      for (const [wy, mat] of [[2.1, winWarmMat], [6.3, winWarmMat], [10.3, winBridgeMat]] as [number, THREE.Material][]) {
        for (let wz = -59; wz <= -25; wz += 4.2) {
          if (wy > 9 && Math.abs(wz + 32) < 2.6) continue; // Keep clear of 3F Bridge Wing doors!
          addExt(new THREE.BoxGeometry(0.08, 1.05, 1.95), pbr.steel, s * 19.90, wy, wz);
          addExt(new THREE.BoxGeometry(0.10, 0.84, 1.72), mat, s * 19.93, wy, wz);
        }
      }
    }
    // White cladding on Upper Forward (Z=-20, Y=4.2..8.4) & Upper Aft (Z=-64, Y=4.2..12.6) Superstructure Faces + Glowing Windows!
    addExt(new THREE.BoxGeometry(39.6, 4.1, 0.16), whiteTrimMat, 0, 6.25, -19.56);
    addExt(new THREE.BoxGeometry(39.6, 8.5, 0.16), whiteTrimMat, 0, 8.45, -64.42);
    // Warm forward 2F Mess/Galley windows & glowing 3F Bridge forward panoramic inner glow
    for (let wx = -15.5; wx <= 15.5; wx += 4.4) {
      addExt(new THREE.BoxGeometry(2.15, 1.0, 0.10), pbr.steel, wx, 6.25, -19.44);
      addExt(new THREE.BoxGeometry(1.90, 0.80, 0.12), winWarmMat, wx, 6.25, -19.41);
      addExt(new THREE.BoxGeometry(2.15, 1.0, 0.10), pbr.steel, wx, 6.3, -64.52);
      addExt(new THREE.BoxGeometry(1.90, 0.80, 0.12), winWarmMat, wx, 6.3, -64.55);
      addExt(new THREE.BoxGeometry(2.15, 1.0, 0.10), pbr.steel, wx, 10.3, -64.52);
      addExt(new THREE.BoxGeometry(1.90, 0.80, 0.12), winBridgeMat, wx, 10.3, -64.55);
    }
    // Glowing Bridge Forward Panoramic Window Glazing (FrontSide facing +Z outward ONLY — 100% transparent from inside 3F bridge!)
    const bridgeExtGlowMat = new THREE.MeshStandardMaterial({
      color: 0xbef2ff, emissive: 0x3ec6ff, emissiveIntensity: 2.1, roughness: 0.12, metalness: 0.35,
      transparent: true, opacity: 0.72, side: THREE.FrontSide,
    });
    for (const [bx, bw] of [[-11, 10.4], [0, 8.4], [11, 10.4]]) {
      addExt(new THREE.PlaneGeometry(bw, 1.95), bridgeExtGlowMat, bx, 10.55, -19.62);
    }

    // 4. Maritime Navigation Sidelights (Port Red / Starboard Green on 3F Bridge Wings) + Masthead & Crane Aviation Strobes!
    const orbGeo = new THREE.SphereGeometry(0.32, 10, 8);
    addExt(orbGeo, navRedMat, -24.5, 10.6, -29.0);
    addExt(orbGeo, navGreenMat, 24.5, 10.6, -29.0);
    const portNavL = new THREE.PointLight(0xff2c1c, 36, 26, 1.4);
    portNavL.position.set(-25.2, 10.8, -29.0);
    const stbdNavL = new THREE.PointLight(0x18f068, 36, 26, 1.4);
    stbdNavL.position.set(25.2, 10.8, -29.0);
    group.add(portNavL, stbdNavL);

    // Aviation obstruction red strobes on twin funnels, radar mast top, and both 18m gantry cranes
    for (const [ax, ay, az] of [
      [-7.8, 22.8, -55], [7.8, 22.8, -55], [0, 26.8, -38],
      [-16.8, 18.8, 94], [16.8, 18.8, 94], [-16.8, 18.8, 112], [16.8, 18.8, 112],
    ]) {
      addExt(orbGeo, navRedMat, ax, ay, az);
    }

    // 5. Warm Sodium Gunwale Deck Stanchion Lamps along the full 250m freighter length + Helipad Amber Ring Beacons!
    const deckPostGeo = new THREE.CylinderGeometry(0.08, 0.11, 4.4, 8);
    const lampHeadGeo = new THREE.BoxGeometry(0.68, 0.24, 0.42);
    for (const lz of [-122, -96, -72, -12, 16, 46, 74, 96, 114]) {
      for (const s of [-1, 1]) {
        addExt(deckPostGeo, pbr.steel, s * 19.65, 3.6, lz);
        addExt(lampHeadGeo, navAmberMat, s * 19.25, 5.85, lz);
      }
    }
    // Helipad glowing amber perimeter markers (Bow Helipad Z=126.0 & Stern Helipad Z=-124)
    const padOrb = new THREE.SphereGeometry(0.18, 8, 6);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      addExt(padOrb, navAmberMat, Math.cos(a) * 6.8, 1.38, 126.0 + Math.sin(a) * 6.8);
      addExt(padOrb, navAmberMat, Math.cos(a) * 7.4, 0.24, -124.0 + Math.sin(a) * 7.4);
    }
    // Hero exterior warm deck illumination pools so the ship gleams dramatically in menu & storm!
    for (const [lx, ly, lz, col, inten, dist] of [
      [24, 14, -40, 0xffb85c, 110, 82],
      [-24, 14, -40, 0xffb85c, 95, 76],
      [0, 18, -50, 0xffc478, 120, 65],    // Uplight on twin crimson-and-white funnels & radar mast!
      [18, 14, 58, 0xffbc62, 130, 88],    // Warm floodlight illuminating midship colorful container bays!
      [-14, 14, 58, 0x7cb8ff, 95, 76],    // Cool storm rim light on midship container stacks
      [16, 18, 102, 0xffb854, 140, 92],   // Warm sodium floodlight bathing towering 18m yellow gantry cranes!
      [8, 11, 128, 0xffae44, 95, 68],     // Bow helipad & pointed bow prow illumination
    ] as [number, number, number, number, number, number][]) {
      const hl = new THREE.PointLight(col, inten, dist, 1.25);
      hl.position.set(lx, ly, lz);
      group.add(hl);
    }

    // 6. Midship Hatch-Cover Container Bays atop sealed Zone 4 Engine Room Roof (Y = 3.30, Z: 40..78 — 100% above-deck visual!)
    // Gives M/V Taishan an unmistakable 50,000-ton ocean container-freighter silhouette from the main menu & exterior decks!
    const roofY = 3.30;
    const roofBays: [number, number, number, number][] = [
      // [x, z, stacks, colorVariant (0=blue, 1=red, 2=green, 3=ochre)]
      [-14.2, 44, 2, 0], [-10.8, 44, 3, 1], [-7.4, 44, 2, 3], [7.4, 44, 2, 2], [10.8, 44, 3, 0], [14.2, 44, 2, 1],
      [-14.2, 54, 3, 2], [-10.8, 54, 2, 0], [-3.2, 54, 2, 1], [3.2, 54, 3, 3], [10.8, 54, 2, 2], [14.2, 54, 3, 0],
      [-14.2, 65, 2, 1], [-10.8, 65, 3, 3], [-7.4, 65, 2, 0], [7.4, 65, 3, 1], [10.8, 65, 2, 0], [14.2, 65, 2, 3],
      [-14.2, 75, 2, 0], [-10.8, 75, 2, 2], [10.8, 75, 2, 1], [14.2, 75, 2, 0],
    ];
    for (const [cx, cz, stacks, v] of roofBays) {
      for (let i = 0; i < stacks; i++) {
        cloneRaw('ship_container', cx, roofY + i * 2.8, cz, 0, 1.0, true, { contVariant: (v + i) % 4 });
      }
    }
    // Foremast / Bow Jackstaff at the pointed prow (Z = 137.4) with glowing white masthead beacon!
    addExt(new THREE.CylinderGeometry(0.10, 0.16, 9.2, 10), pbr.steel, 0, 6.0, 137.4);
    addExt(new THREE.BoxGeometry(3.2, 0.14, 0.14), pbr.steel, 0, 8.6, 137.4);
    addExt(orbGeo, winWarmMat, 0, 10.8, 137.4);
  }

  // =========================================================================
  // ZONE 1: 船尾强降坪与暴雨集装箱迷阵 (Z: -136..-64, X: -20..+20, Y: 0.0 / +2.8)
  // =========================================================================
  b.box('deck', 0, -0.8, -100, 40, 0.8, 72, { road: true });
  // Stern Tactical LZ Circle + Weathered Stencil 'H'
  b.cyl('steel', 0, 0.0, -124, 7.6, 0.10, 32, false);
  b.box('hazard', -2.2, 0.11, -124, 0.65, 0.03, 5.0, { solid: false });
  b.box('hazard',  2.2, 0.11, -124, 0.65, 0.03, 5.0, { solid: false });
  b.box('hazard',  0.0, 0.11, -124, 4.4,  0.03, 0.65, { solid: false });

  // Sculpted Blender Z-20J "HaiDiao-1" Helicopter (hovering at Stern, flies to Bow in Zone 6!)
  const heli = new THREE.Group();
  const heliModel = cloneRaw('ship_z20j_heli', 0, 0, 0, Math.PI, 1.0, false, { skipPivots: ['MainRotor', 'TailRotor'] });
  heli.add(heliModel);
  const heliRotor = heliModel.getObjectByName('MainRotor') ?? null;
  const heliTailRotor = heliModel.getObjectByName('TailRotor') ?? null;
  const heliRopes = new THREE.Group();
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5c4e3a, roughness: 0.92 });
  applySurfacePatina(ropeMat, 0.72, 9.0);
  for (const sx of [-1.45, 1.45]) {
    const rp = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 14.5, 8), ropeMat);
    rp.position.set(sx, -6.2, 0.5);
    heliRopes.add(rp);
  }
  heli.add(heliRopes);
  heli.position.set(0, 14.2, -127);
  group.add(heli);

  // 3-Lane 3D Corrugated ISO Container Maze (Z: -112..-72)
  // Lane A (Port Elevated Overwatch Lane, X = -13.0)
  addContainer(-13.0, 0, -104, 0, 1, 0);
  addContainer(-13.0, 0, -93,  0, 1, 2);
  addContainer(-13.0, 0, -82,  0, 1, 1);
  b.catwalk(-13.0, 2.82, -98.5, 2.8, 4.4, { n: true, s: true });
  b.catwalk(-13.0, 2.82, -87.5, 2.8, 4.4, { n: true, s: true });
  b.stairs('z', -13.0, -114.5, -107.0, 0.0, 2.82, 2.6, true);
  b.stairs('z', -13.0, -79.0, -71.5, 2.82, 0.0, 2.6, true);
  b.cover(-11.8, 2.82, -93, 0.5, 3.8, false);
  b.cover(-11.8, 2.82, -82, 0.5, 3.8, false);

  // Lane B (Center Main Assault Alley)
  addContainer(-5.8, 0, -106,  0.08, 2, 1);
  addContainer( 6.0, 0, -102, -0.06, 2, 0);
  addContainer(-6.5, 0, -92,   0.00, 1, 3);
  addContainer( 5.5, 0, -88,   0.10, 2, 2);
  addContainer(-5.5, 0, -78,  -0.08, 1, 0);
  addContainer( 6.8, 0, -76,   0.00, 1, 3);
  b.cover(0.0, 0, -110, 4.2, 1.0, false, 0.12);
  b.cover(-1.5, 0, -98, 3.8, 1.0, false, -0.1);
  b.cover(1.8, 0, -86, 4.0, 1.0, true, 0.08);
  /**
   * Cleanly engineered 3A Naval Twin-30mm Automatic Anti-Air Gun Turret (Zone 1).
   * Zero floating beacons, zero clipping barrels/radar — all components mechanically bolted & clear.
   */
  const buildNavalAAGun = (x: number, y: number, z: number, rotY: number, sc = 1) => {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = rotY;
    root.scale.setScalar(sc);

    const mOlive = glbPbr.SMAT_MIL_OLIVE;
    const mDark = pbr.steel;
    const mGun = glbPbr.SMAT_HELI_NAVY;
    const mTrim = glbPbr.SMAT_DOOR_STEEL;
    const mHaz = pbr.hazard;
    const mRed = glbPbr.SMAT_BEACON_RED;
    const mGlass = glbPbr.SMAT_GLASS_DARK;

    const addPart = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // 1. Bolted Octagonal Naval Deck Base & Rotating Pedestal Ring (y = 0 .. 0.88)
    addPart(root, new THREE.CylinderGeometry(1.72, 1.84, 0.18, 8), mDark, 0, 0.09, 0);
    addPart(root, new THREE.CylinderGeometry(1.52, 1.56, 0.08, 16), mHaz, 0, 0.21, 0);
    addPart(root, new THREE.CylinderGeometry(1.18, 1.36, 0.56, 12), mOlive, 0, 0.52, 0);
    addPart(root, new THREE.CylinderGeometry(1.24, 1.24, 0.10, 16), mTrim, 0, 0.83, 0);
    // 8 deck anchor bolts around flange
    const boltGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.10, 6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      addPart(root, boltGeo, mTrim, Math.cos(a) * 1.62, 0.19, Math.sin(a) * 1.62);
    }

    // 2. Upper Rotating Turret Head (y >= 0.88)
    const head = new THREE.Group();
    head.name = 'TurretHead';
    head.position.set(0, 0.88, 0);
    root.add(head);

    // Main armored turret housing + sloped front cheek plates + rear ammo bustle (all cleanly aligned)
    addPart(head, new THREE.BoxGeometry(1.76, 1.04, 1.84), mOlive, 0, 0.54, -0.06);
    addPart(head, new THREE.BoxGeometry(1.86, 0.22, 1.94), mDark, 0, 0.10, -0.06);
    addPart(head, new THREE.BoxGeometry(1.52, 0.16, 1.56), mTrim, 0, 1.12, -0.10);
    // Rear ammunition feed bustle box & twin ammo chutes
    addPart(head, new THREE.BoxGeometry(1.38, 0.78, 0.62), mDark, 0, 0.54, -1.24);
    addPart(head, new THREE.BoxGeometry(0.28, 0.42, 0.36), mTrim, -0.36, 0.68, -1.04);
    addPart(head, new THREE.BoxGeometry(0.28, 0.42, 0.36), mTrim,  0.36, 0.68, -1.04);
    // Side armored inspection panels
    addPart(head, new THREE.BoxGeometry(0.10, 0.62, 1.16), mDark, -0.90, 0.54, -0.10);
    addPart(head, new THREE.BoxGeometry(0.10, 0.62, 1.16), mDark,  0.90, 0.54, -0.10);

    // 3. Elevated Twin-30mm Autocannon Assembly (pivots cleanly at front face z = +0.74, ZERO protrusion out the rear!)
    const gunMount = new THREE.Group();
    gunMount.position.set(0, 0.66, 0.76);
    gunMount.rotation.x = -0.44; // ~25 deg upward AA elevation
    head.add(gunMount);

    // Armored front mantlet cradle
    addPart(gunMount, new THREE.BoxGeometry(1.22, 0.58, 0.52), mDark, 0, 0, 0.12);
    addPart(gunMount, new THREE.CylinderGeometry(0.28, 0.28, 1.32, 12), mTrim, 0, 0, 0.04, 0, 0, H);

    // Twin stepped autocannon barrels with cooling sleeves & flared muzzle flash suppressors
    for (const bx of [-0.34, 0.34]) {
      // Heavy breech jacket
      addPart(gunMount, new THREE.CylinderGeometry(0.145, 0.165, 0.72, 12), mGun, bx, 0.04, 0.56, H, 0, 0);
      // Ribbed cooling sleeve
      addPart(gunMount, new THREE.CylinderGeometry(0.115, 0.125, 0.92, 12), mDark, bx, 0.04, 1.24, H, 0, 0);
      for (const rz of [0.96, 1.14, 1.32, 1.50]) {
        addPart(gunMount, new THREE.CylinderGeometry(0.135, 0.135, 0.055, 12), mTrim, bx, 0.04, rz, H, 0, 0);
      }
      // Forward main barrel
      addPart(gunMount, new THREE.CylinderGeometry(0.068, 0.088, 1.32, 12), mGun, bx, 0.04, 2.28, H, 0, 0);
      // Flared muzzle brake / flash suppressor
      addPart(gunMount, new THREE.CylinderGeometry(0.105, 0.075, 0.24, 10), mDark, bx, 0.04, 3.00, H, 0, 0);
      // Hydraulic recoil damper tube neatly underneath each barrel
      addPart(gunMount, new THREE.CylinderGeometry(0.055, 0.055, 0.85, 8), mTrim, bx, -0.14, 0.76, H, 0, 0);
    }

    // 4. Side-Mounted Fire-Control Radar & Electro-Optical Sensor Pod (offset cleanly at x = +1.28, 100% clear of barrels!)
    addPart(head, new THREE.BoxGeometry(0.46, 0.18, 0.22), mDark, 1.06, 0.88, -0.22); // Horizontal side bracket arm
    addPart(head, new THREE.CylinderGeometry(0.08, 0.10, 0.56, 10), mDark, 1.26, 1.16, -0.22); // Vertical pedestal post
    const dishGrp = new THREE.Group();
    dishGrp.position.set(1.26, 1.54, -0.20);
    dishGrp.rotation.x = -0.32;
    head.add(dishGrp);
    // Clean parabolic fire-control radar reflector (dark navy backing + metallic inner face + feed horn)
    addPart(dishGrp, new THREE.CylinderGeometry(0.48, 0.34, 0.12, 18), mGun, 0, 0, -0.04, H, 0, 0);
    addPart(dishGrp, new THREE.CylinderGeometry(0.42, 0.42, 0.04, 18), mTrim, 0, 0, 0.03, H, 0, 0);
    addPart(dishGrp, new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), mDark, 0, 0, 0.20, H, 0, 0);
    addPart(dishGrp, new THREE.SphereGeometry(0.075, 10, 8), mTrim, 0, 0, 0.36);

    // Left-side electro-optical target tracker pod (symmetric counterbalance)
    addPart(head, new THREE.BoxGeometry(0.32, 0.36, 0.42), mDark, -1.04, 0.92, 0.12);
    addPart(head, new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), mGlass, -1.04, 0.94, 0.34, H, 0, 0);

    // 5. Roof-Mounted Warning Beacon on Solid Steel Mast (bolted firmly to roof y = 1.20 — ZERO floating!)
    addPart(head, new THREE.CylinderGeometry(0.11, 0.14, 0.08, 10), mDark, -0.32, 1.22, -0.48);
    addPart(head, new THREE.CylinderGeometry(0.045, 0.055, 0.62, 8), mTrim, -0.32, 1.55, -0.48);
    addPart(head, new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12), mDark, -0.32, 1.88, -0.48);
    addPart(head, new THREE.CylinderGeometry(0.105, 0.115, 0.22, 12), mRed, -0.32, 2.02, -0.48);
    addPart(head, new THREE.CylinderGeometry(0.125, 0.125, 0.04, 12), mDark, -0.32, 2.15, -0.48);

    group.add(root);
    return root;
  };

  /**
   * Cleanly engineered 3A Naval Quad-Tube SAM Air-Defense Missile Launcher (Zone 5).
   */
  const buildNavalSAMBattery = (x: number, y: number, z: number, rotY: number, sc = 1) => {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = rotY;
    root.scale.setScalar(sc);

    const mOlive = glbPbr.SMAT_MIL_OLIVE;
    const mDark = pbr.steel;
    const mTrim = glbPbr.SMAT_DOOR_STEEL;
    const mHaz = pbr.hazard;
    const mRedCap = pbr.pipeRed;
    const mBeacon = glbPbr.SMAT_BEACON_RED;

    const addPart = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // 1. Bolted Heavy Deck Base & Azimuth Pedestal
    addPart(root, new THREE.CylinderGeometry(1.92, 2.08, 0.22, 8), mDark, 0, 0.11, 0);
    addPart(root, new THREE.CylinderGeometry(1.68, 1.72, 0.09, 16), mHaz, 0, 0.25, 0);
    addPart(root, new THREE.CylinderGeometry(1.18, 1.38, 0.68, 12), mOlive, 0, 0.62, 0);

    // 2. Rotating Launcher Yoke + Twin Hydraulic Elevating Struts
    const head = new THREE.Group();
    head.name = 'TurretHead';
    head.position.set(0, 0.96, 0);
    root.add(head);

    addPart(head, new THREE.BoxGeometry(2.15, 0.24, 1.85), mDark, 0, 0.12, 0);
    addPart(head, new THREE.BoxGeometry(0.28, 1.05, 0.72), mOlive, -0.94, 0.72, -0.18);
    addPart(head, new THREE.BoxGeometry(0.28, 1.05, 0.72), mOlive,  0.94, 0.72, -0.18);
    // Hydraulic elevation rams supporting the canister cradle
    for (const sx of [-0.62, 0.62]) {
      addPart(head, new THREE.CylinderGeometry(0.085, 0.095, 0.96, 10), mTrim, sx, 0.62, 0.42, -0.35, 0, 0);
    }

    // 3. Quad-Tube 2x2 Armored SAM Launch Canisters (elevated cleanly at ~32 deg)
    const rack = new THREE.Group();
    rack.position.set(0, 1.18, -0.12);
    rack.rotation.x = -0.54;
    head.add(rack);

    addPart(rack, new THREE.BoxGeometry(1.62, 1.38, 1.15), mDark, 0, 0, 0); // Central armored cradle frame
    for (const cx of [-0.46, 0.46]) {
      for (const cy of [-0.42, 0.42]) {
        // Armored canister body
        addPart(rack, new THREE.BoxGeometry(0.68, 0.64, 3.05), mOlive, cx, cy, 0.15);
        // Steel reinforcement bands
        for (const bz of [-0.95, 0.0, 0.95]) {
          addPart(rack, new THREE.BoxGeometry(0.73, 0.69, 0.12), mTrim, cx, cy, bz + 0.15);
        }
        // Forward frangible crimson missile cap + hazard rim
        addPart(rack, new THREE.BoxGeometry(0.62, 0.58, 0.14), mHaz, cx, cy, 1.70);
        addPart(rack, new THREE.CylinderGeometry(0.24, 0.27, 0.18, 12), mRedCap, cx, cy, 1.80, H, 0, 0);
        // Rear exhaust blast-deflector shroud
        addPart(rack, new THREE.BoxGeometry(0.58, 0.54, 0.24), mDark, cx, cy, -1.44);
      }
    }

    // 4. Side Phased-Array Fire-Control Mast + Bolted Red Warning Beacon
    addPart(head, new THREE.CylinderGeometry(0.065, 0.08, 1.95, 8), mDark, -1.04, 1.20, -0.68);
    addPart(head, new THREE.BoxGeometry(0.68, 0.46, 0.14), mTrim, -1.04, 1.82, -0.58, -0.22, 0, 0);
    addPart(head, new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12), mDark, -1.04, 2.20, -0.68);
    addPart(head, new THREE.CylinderGeometry(0.11, 0.12, 0.24, 12), mBeacon, -1.04, 2.35, -0.68);
    addPart(head, new THREE.CylinderGeometry(0.13, 0.13, 0.04, 12), mDark, -1.04, 2.49, -0.68);

    group.add(root);
    return root;
  };

  // Objective #1: Deck Anti-Air Turret Sandbag Nest defending Gate #1!
  b.cover(0, 0, -75.8, 6.2, 1.0, false);
  addProp('sandbags', -1.8, 0, -76.85, 0, 1.15);
  addProp('sandbags',  1.8, 0, -76.85, 0, 1.15);
  const aa1Group = buildNavalAAGun(TAISHAN.z1AA.x, 0, TAISHAN.z1AA.z, Math.PI, 0.96);
  world.addBox(TAISHAN.z1AA.x, 1.2, TAISHAN.z1AA.z, 1.6, 1.2, 1.6, 0, 'metal');
  const aa1Light = new THREE.PointLight(0xff3c28, 20, 18, 1.5);
  aa1Light.position.set(TAISHAN.z1AA.x, 3.2, TAISHAN.z1AA.z);
  group.add(aa1Light);

  // Lane C (Starboard Stealth Flank Lane + Deck Pipelines + Photogrammetry Gear)
  addContainer(13.2, 0, -104, 0, 2, 0);
  addContainer(13.2, 0, -86,  0, 2, 1);
  b.pipe('rust', 18.6, 0.72, -96, 0.42, 58, 'z', true);
  b.pipe('pipeRed', 18.6, 1.25, -96, 0.14, 58, 'z', false);
  b.cover(16.2, 0, -96, 2.4, 1.0, false);
  b.cover(16.2, 0, -78, 2.4, 1.0, false);
  // Rich Deck Props & Sodium Storm Floodlights
  addProp('flood_lights', -18.2, 0, -116, 0.6, 1.25);
  addProp('flood_lights',  17.0, 0, -116, -0.6, 1.25);
  addProp('flood_lights', -18.2, 0, -72, 0.8, 1.25);
  addProp('flood_lights',  17.0, 0, -72, -0.8, 1.25);
  addProp('mil_crate', -9.2, 0, -115, 0.3, 1.15);
  addProp('ammo_box', -8.0, 0, -114, -0.2, 1.1);
  addProp('barrel', 10.2, 0, -112, 0.2, 1.05);
  addProp('barrel', 11.1, 0, -111, 1.4, 1.05);
  addProp('pallet', 2.4, 0, -104, 0.4, 1.1);
  addProp('generator', -16.8, 0, -68, 0.2, 1.15);
  addProp('barbed_wire', -8.5, 0, -68, 0, 1.15);
  // Maritime Stern Deck Enrichment: Heavy twin-bitt steel mooring bollards along both gunwales, SOLAS orange lifebuoys & Gate #1 yellow safety apron
  for (const mz of [-126, -108, -86]) {
    for (const sx of [-1, 1]) {
      const mx = sx * 18.4;
      b.box('steel', mx, 0, mz, 0.9, 0.14, 1.6, { solid: false });
      b.cyl('steel', mx, 0.14, mz - 0.42, 0.18, 0.62, 10, false);
      b.cyl('steel', mx, 0.14, mz + 0.42, 0.18, 0.62, 10, false);
      b.cyl('hazard', mx, 0.74, mz - 0.42, 0.21, 0.08, 10, false);
      b.cyl('hazard', mx, 0.74, mz + 0.42, 0.21, 0.08, 10, false);
    }
  }
  const lifebuoyGeo = new THREE.TorusGeometry(0.38, 0.10, 10, 22);
  for (const [lx, ly, lz, rotY] of [
    [-19.25, 1.42, -120, H], [19.25, 1.42, -120, -H],
    [-19.25, 1.42, -80, H], [19.25, 1.42, -80, -H],
    [-4.8, 1.65, -64.45, 0], [4.8, 1.65, -64.45, 0],
  ] as [number, number, number, number][]) {
    const ring = new THREE.Mesh(lifebuoyGeo, pbr.pipeRed);
    ring.position.set(lx, ly, lz);
    ring.rotation.y = rotY;
    group.add(ring);
  }
  b.box('chevron', 0, 0.015, -67.2, 5.4, 0.03, 0.44, { solid: false });
  b.box('chevron', 13.5, 0.015, -66.6, 3.6, 0.03, 0.38, { solid: false });
  for (const [lx, lz] of [[-12, -114], [12, -114], [0, -94], [-10, -70], [10, -70]]) {
    const fl = new THREE.PointLight(0xffb45c, 42, 36, 1.4);
    fl.position.set(lx, 7.5, lz);
    group.add(fl);
  }
  addSign('01 号水密防爆闸 · 上层建筑', 'W.T. DOOR 01 · DECK 1–3 SUPERSTRUCTURE', 0, 4.35, -64.45, Math.PI, '#c89438', 3.4, 0.78);

  // =========================================================================
  // ZONE 2: 四层舰桥上层建筑 (地下船舱 -6.0 | 1F 宿舍与厕所 0.0 | 2F 餐厅与后厨 +4.2 | 3F 舰桥 +8.4)
  // =========================================================================
  // Outer Superstructure Hull & Bulkhead Walls (Z: -64..-20, Y: -6.0 .. +12.6)
  b.wall('hull', 'x', -64, -19.6, 19.6, -6.0, 18.6, 0.7, [
    { at: 0, w: 4.4, h: 3.4, sill: 6.0 },     // 1F Main Gate #1 (Y = 0.0..3.4)
    { at: 13.5, w: 3.0, h: 3.0, sill: 6.0 },  // 1F Starboard Flanking Hatch
  ]);
  addBlastGate('g12', 0, 0, -64, 4.4, 3.38, 0);
  addBlastGate('g12', 13.5, 0, -64, 3.0, 2.98, 0);

  // Forward Superstructure Wall at Z = -20 — split into Lower Bilge (Y=-6..0) & Upper 1F/2F (Y=0..8.4)
  // so BOTH stacked Gate #2 doorways at X=0 open cleanly with ZERO overlapping sill/header geometry!
  b.wall('hull', 'x', -20, -19.6, 19.6, -6.0, 6.0, 0.7, [
    { at: 0, w: 4.4, h: 3.4, sill: 0.0 },     // Lower Bilge Gate #2 -> Zone 3 Cargo Hold Floor (Y=-6.0)!
  ]);
  b.wall('hull', 'x', -20, -19.6, 19.6, 0.0, 8.4, 0.7, [
    { at: 0, w: 5.2, h: 3.5, sill: 0.0 },     // 1F Gate #2 -> Zone 3 Upper Catwalk (Y=0.0)!
  ]);
  addBlastGate('g23', 0, 0.0, -20, 5.2, 3.48, 0);
  addBlastGate('g23', 0, -6.0, -20, 4.4, 3.38, 0);

  // 3F Panoramic Bridge Forward Wall (Z = -20, Y = 8.4..12.6) + Reinforced Glass Panes + Steel Mullions!
  b.wall('hull', 'x', -20, -19.6, 19.6, 8.4, 4.2, 0.6, [
    { at: -11, w: 11.0, h: 2.2, sill: 1.15 },
    { at: 0,   w: 9.0,  h: 2.2, sill: 1.15 },
    { at: 11,  w: 11.0, h: 2.2, sill: 1.15 },
  ]);
  b.box('glass', -11, 9.55, -20, 11.0, 2.2, 0.10, { solid: false });
  b.box('glass',   0, 9.55, -20,  9.0, 2.2, 0.10, { solid: false });
  b.box('glass',  11, 9.55, -20, 11.0, 2.2, 0.10, { solid: false });
  for (const mx of [-14, -8, -3, 3, 8, 14]) b.box('steel', mx, 9.55, -20, 0.18, 2.25, 0.24, { solid: false });

  // Port & Starboard Superstructure Outer Bulkheads (with 3F Bridge Wing doors + SOLAS Lifeboats hung outside!)
  b.wall('hull', 'z', -19.4, -64, -20, -6.0, 18.6, 0.6, [{ at: -32, w: 3.2, h: 3.0, sill: 14.4 }]);
  b.wall('hull', 'z',  19.4, -64, -20, -6.0, 18.6, 0.6, [{ at: -32, w: 3.2, h: 3.0, sill: 14.4 }]);
  // Exterior structural hull ribs & SOLAS Orange Lifeboats in Gravity Davits on Port & Starboard!
  for (let rz = -60; rz <= -24; rz += 6) {
    b.box('steel', -19.8, 0, rz, 0.35, 12.6, 0.35, { solid: false });
    b.box('steel',  19.8, 0, rz, 0.35, 12.6, 0.35, { solid: false });
  }
  cloneRaw('ship_lifeboat_davit', -20.2, 4.2, -48, Math.PI, 1.0);
  cloneRaw('ship_lifeboat_davit',  20.2, 4.2, -48, 0, 1.0);

  // --- NEW! LOWER DECK / UNDERGROUND BILGE CREW CABINS & COLD PROVISION HOLD (Y = -6.0, Z: -64..-20) ---
  b.box('deck', 0, -6.8, -42, 39.2, 0.8, 44, { road: true });
  b.pipeBundle('z', 0, -0.7, -42, 42);
  // Bulkhead steel vertical ribs & overhead structural ceiling cross-beams every 5m!
  for (let rz = -60; rz <= -24; rz += 5) {
    b.box('steel', -4.35, -6.0, rz, 0.22, 5.6, 0.28, { solid: false });
    b.box('steel',  4.35, -6.0, rz, 0.22, 5.6, 0.28, { solid: false });
    b.box('steel',  0.0,  -0.72, rz, 9.2, 0.26, 0.28, { solid: false });
  }
  // Central lower bulkhead corridor walls (X = ±4.6) sealed flush to South (-63.8) & North (-20.2) hull walls — ZERO dead-end cracks!
  b.wall('bulkhead', 'z', -4.6, -63.8, -20.2, -6.0, 5.6, 0.4, [
    { at: -52, w: 3.2, h: 3.0 }, // Stairwell arrival / Port Lower Crew Berthing
    { at: -36, w: 3.0, h: 3.0 }, // Port Lower Bilge Quarters
  ]);
  b.wall('bulkhead', 'z', 4.6, -63.8, -20.2, -6.0, 5.6, 0.4, [
    { at: -48, w: 3.2, h: 3.0 }, // Starboard Cold Storage Provision Room
    { at: -30, w: 3.0, h: 3.0 }, // Starboard Bilge Pump Room
  ]);
  for (const [dx, dz] of [[-4.6, -52], [-4.6, -36], [4.6, -48], [4.6, -30]]) {
    b.box('pipeRed', dx, -6.0, dz, 0.52, 0.14, 3.1, { solid: false }); // Watertight doorway threshold coaming!
    b.box('steel', dx, -3.02, dz, 0.52, 0.18, 3.3, { solid: false }); // Heavy steel lintel header
  }
  b.box('bulkhead', -12.0, -6.0, -45, 15.0, 5.6, 0.4);
  b.box('galley',    12.0, -6.0, -39, 15.0, 5.6, 0.4); // Insulated stainless Cold Storage wall!
  // Lower Deck Crew Bunks (6 two-tier Blender steel bunks + footlockers + warm reading lights!)
  for (const bz of [-56, -49, -41, -33, -26]) {
    cloneRaw('ship_bunk_unit', -17.2, -6.0, bz, 0, 1.0);
    world.addBox(-17.2, -5.0, bz, 0.55, 1.0, 1.5, 0, 'metal');
    b.box('steel', -15.6, -6.0, bz, 0.55, 0.52, 1.1); // Steel crew footlocker beside bunk!
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.75), lampWarmMat);
    rl.position.set(-18.8, -4.65, bz);
    group.add(rl);
  }
  cloneRaw('ship_bunk_unit', -9.2, -6.0, -35, Math.PI, 1.0);
  world.addBox(-9.2, -5.0, -35, 0.55, 1.0, 1.5, 0, 'metal');
  addProp('ph_extinguisher', -4.2, -6.0, -44, 0, 1.15);
  addProp('utility_box',      4.2, -6.0, -38, -H, 1.2);
  addProp('mil_crate',       -8.2, -6.0, -58, 0.2, 1.1);
  // Starboard Cold Storage Provision Hold (Translucent PVC Strip Curtain + Cold-Chain Pallet Racks + Evaporator Blowers + -18°C LED!)
  b.box('galley', 12.0, -6.0, -63.4, 14.4, 5.4, 0.35, { solid: false });
  b.box('galley', 19.0, -6.0, -51.0, 0.22, 5.4, 24.4, { solid: false });
  const pvcMat = new THREE.MeshStandardMaterial({ color: 0xbce6f5, transparent: true, opacity: 0.32, roughness: 0.22, side: THREE.DoubleSide });
  for (let i = 0; i < 8; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.75, 0.34), pvcMat);
    strip.position.set(4.85, -4.55, -49.4 + i * 0.40);
    group.add(strip);
  }
  // 2 Full Rows of Steel Cold-Chain Shelving + Blue/White Insulated Provision Crates!
  for (const sz of [-59, -54, -49, -44]) {
    addProp('ph_shelves', 17.2, -6.0, sz, -H, 1.25);
    b.box('pipeBlue', 16.9, -5.25, sz, 0.8, 0.52, 1.1, { solid: false });
    b.box('bulkhead', 16.9, -4.15, sz, 0.75, 0.48, 0.95, { solid: false });
  }
  for (const sz of [-57, -50, -43]) {
    addProp('pallet',    11.4, -6.0, sz, 0.12, 1.2);
    b.box('pipeBlue',    11.4, -5.82, sz, 1.1, 0.72, 1.1);
    b.box('bulkhead',    11.4, -5.08, sz, 0.92, 0.56, 0.92);
  }
  // Overhead Evaporator Blower Units + Glowing -18.4°C Digital Thermometer Readout!
  for (const ez of [-55, -45]) {
    b.box('galley', 12.0, -1.55, ez, 2.8, 0.72, 0.85, { solid: false });
    b.box('steel',  12.0, -1.52, ez + 0.45, 2.5, 0.52, 0.08, { solid: false });
  }
  const coldTemp = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.65), makeScreenMat('temp'));
  coldTemp.position.set(4.95, -3.5, -44.2);
  coldTemp.rotation.y = H;
  group.add(coldTemp);
  // Starboard Bilge Pump Room: Vertical Pressure Accumulator Tanks + Bilge Pumps + Red Handwheels!
  b.cyl('pipeBlue', 16.5, -6.0, -33.5, 1.05, 3.8, 16, true, 'metal');
  b.cyl('pipeBlue', 16.5, -6.0, -29.0, 1.05, 3.8, 16, true, 'metal');
  b.pipe('pipeRed', 14.5, -4.4, -31.2, 0.16, 12.0, 'z', false);
  b.pipe('pipeAmber', 14.5, -3.8, -31.2, 0.14, 12.0, 'z', false);
  addProp('compressor', 13.0, -6.0, -25.5, -H, 1.25);
  addProp('generator',   9.5, -6.0, -25.5, 0, 1.2);
  addProp('barrel',     16.8, -6.0, -23.5, 0.4, 1.1);
  b.cover(0, -6.0, -42, 3.2, 1.0, false);
  b.cover(0, -6.0, -28, 3.4, 1.0, false);
  // Lower Deck Moody Industrial Lighting (cool bilge blue + frosty cold storage + warm bunk pockets)
  addCeilingLamp(0, -0.55, -54, 'cool', 30, 28);
  addCeilingLamp(0, -0.55, -34, 'cool', 30, 28);
  addCeilingLamp(-8.5, -0.55, -52, 'warm', 26, 22);
  addCeilingLamp(-12, -0.55, -34, 'warm', 26, 22);
  addCeilingLamp(12, -0.55, -52, 'cool', 34, 26); // Cold storage frosty cyan glow!
  addCeilingLamp(12, -0.55, -28, 'warm', 26, 22);
  addSign('B1 下层船员铺位 · 冷库泵舱', 'DECK B1 (-6.0M) · BERTHING & COLD STORAGE', 0, -2.05, -20.42, Math.PI, '#48a4bc', 2.8, 0.62);

  // --- 1F Deck Slab (Y = 0.0) with CLEAN Stairwell Cutout down to Lower Deck at Port-Aft (X: -15.6..-11.4, Z: -60.0..-48.2)! ---
  b.box('cabinFloor', 4.0, -0.45, -42, 30.8, 0.45, 43.2, { road: true }); // Center + East 1F slab (X: -11.4..+19.4)
  b.box('cabinFloor', -17.5, -0.45, -42, 3.8, 0.45, 43.2);               // Far-West strip (X: -19.4..-15.6)
  b.box('cabinFloor', -13.5, -0.45, -34.1, 4.2, 0.45, 28.2);             // North of B1 stair cutout (Z: -48.2..-20.0)
  b.box('cabinFloor', -13.5, -0.45, -61.8, 4.2, 0.45, 3.6);              // Wide 3.6m South top entry landing (Z: -63.6..-60.0)
  // Continuous Marine Staircase descending NORTH from open South landing Z=-60.0 (Y=0.0) -> B1 Lower Deck Z=-49.0 (Y=-6.0)
  // Top entrance at Z=-60.0 is 100% OPEN (zero blocking railing!), with guardrails only on the 3 drop-off sides!
  b.stairs('z', -13.5, -60.0, -49.0, 0.0, -6.0, 4.16, true);
  b.railing('z', -15.55, -60.0, -48.2, 0.0);
  b.railing('z', -11.45, -60.0, -48.2, 0.0);
  b.railing('x', -48.25, -15.55, -11.45, 0.0);
  b.box('chevron', -13.5, 0.015, -60.18, 4.16, 0.025, 0.32, { solid: false });
  addCeilingLamp(-13.5, 3.65, -56.0, 'warm', 28, 22);
  addSign('▼ B1 下层船舱楼梯', 'STAIRWAY TO DECK B1 · BERTHING / PROVISIONS', -13.5, 2.55, -48.24, Math.PI, '#48a4bc', 2.5, 0.56);

  // --- 1F Interior (Y = 0.0): Central Corridor + Port Cabin & Restroom + Starboard Flanking Vestibule & Stairwell ---
  b.pipeBundle('z', 0, 3.55, -42, 42);
  b.wall('bulkhead', 'z', -4.8, -63.8, -20.2, 0, 4.0, 0.4, [
    { at: -54, w: 3.0, h: 2.9 }, // Entry to B1 Lower Deck Stairwell!
    { at: -42, w: 2.8, h: 2.8 }, // Port Crew Cabin #1
    { at: -28, w: 2.8, h: 2.8 }, // Entry to 1F PORT-FORWARD CERAMIC-TILED CREW RESTROOM & SHOWER BAY!
  ]);
  b.wall('bulkhead', 'z', 4.8, -63.8, -20.2, 0, 4.0, 0.4, [
    { at: -56, w: 3.0, h: 2.9 }, // Entry to Starboard Flanking Deck-Entry Vestibule!
    { at: -36, w: 3.6, h: 3.0 }, // Entry to East 1F->2F Stairwell Hall
  ]);
  b.box('bulkhead', -12.1, 0, -48, 14.8, 4.0, 0.4);
  b.box('bulkhead', -12.1, 0, -35, 14.8, 4.0, 0.4);
  // Starboard Vestibule -> Stairwell Hall divider WITH wide doorway aligned to Starboard Flanking Hatch (X = +13.5)!
  b.wall('bulkhead', 'x', -49, 4.8, 19.5, 0, 4.0, 0.4, [{ at: 13.5, w: 3.4, h: 3.0 }]);

  // Port 1F Crew Cabin #1 (Bunk, Desk, Chair)
  cloneRaw('ship_bunk_unit', -17.2, 0, -42, 0, 1.0);
  world.addBox(-17.2, 1.0, -42, 0.55, 1.0, 1.5, 0, 'metal');
  addProp('office_desk', -11.0, 0, -44, 0, 1.05);
  addProp('chair', -11.0, 0, -42.5, Math.PI, 1.05);
  addProp('ph_extinguisher', -4.2, 0, -48, 0, 1.1);
  addProp('utility_box', 4.2, 0, -45, -H, 1.1);
  b.cover(0, 0, -48, 3.0, 1.0, false);
  b.cover(0, 0, -32, 3.0, 1.0, false);

  // Starboard-Aft Deck-Entry Gear Vestibule (X: +5.2..+19.0, Z: -63.4..-49.4) — CLEAR passage from Starboard Flanking Hatch (X=+13.5, Z=-64)!
  b.cover(9.5, 0, -55.5, 2.2, 1.0, false);
  addProp('mil_crate',       17.2, 0, -58.5, -H, 1.15);
  addProp('ammo_box',        17.2, 0, -57.0, -H, 1.1);
  addProp('ph_shelves',      17.4, 0, -53.0, -H, 1.15);
  addProp('ph_extinguisher',  5.5, 0, -51.0,  H, 1.1);
  addProp('utility_box',      8.8, 0, -49.5,  0, 1.1);
  addCeilingLamp(12.2, 3.65, -56.2, 'warm', 28, 22);
  addSign('右舷通道 · 装备库', 'STBD PASSAGE · TO DECK 2 STAIRWELL / CORRIDOR', 13.5, 3.25, -49.24, Math.PI, '#c89438', 2.5, 0.56);

  // 1F PORT-FORWARD CERAMIC-TILED CREW RESTROOM, WASHROOM & SHOWER BAY (X: -19.0..-5.2, Z: -34.8..-20.6, Y: 0.0 — 100% Interior, Zero Exterior Hatch Overlap!)
  b.box('tile', -12.1, 0.02, -27.7, 13.8, 0.06, 13.8, { solid: false }); // Wet glazed ceramic tile floor!
  b.box('tile', -12.1, 0, -34.7, 13.8, 3.8, 0.14, { solid: false });     // South tiled wall
  b.box('tile', -12.1, 0, -20.6, 13.8, 3.8, 0.14, { solid: false });     // North tiled wall
  b.box('tile', -18.9, 0, -27.7, 0.14, 3.8, 13.8, { solid: false });     // West tiled wall
  // Overhead Hot/Cold Water Plumbing Headers + Exhaust Ventilation Duct!
  b.pipe('pipeRed',  -12.1, 3.45, -27.7, 0.07, 13.2, 'x', false);
  b.pipe('pipeBlue', -12.1, 3.45, -27.3, 0.07, 13.2, 'x', false);
  b.box('galley',    -12.1, 3.35, -29.6, 13.2, 0.34, 0.52, { solid: false });
  // Central Double-Sided Tiled Wet Partition Wall (dividing East Toilet/Vanity Zone & West Crew Shower Bay!)
  b.box('tile',   -13.6, 0,    -27.7, 0.32, 2.35, 7.6);
  b.box('galley', -13.6, 2.35, -27.7, 0.38, 0.08, 7.7, { solid: false }); // Brushed steel top trim cap
  // East face of central partition: Stainless Wash Trough + Reflective Mirror + Warm LED Vanity Bar!
  b.box('galley', -13.1, 0.78, -27.7, 0.65, 0.22, 5.4);
  b.box('steel',  -13.2, 0.0,  -27.7, 0.45, 0.78, 5.0);
  const mirrorMat = glbPbr.SMAT_MIRROR;
  const centerMirror = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.92, 5.2), mirrorMat);
  centerMirror.position.set(-13.41, 1.56, -27.7);
  group.add(centerMirror);
  const mirrorBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 5.2), lampWarmMat);
  mirrorBar.position.set(-13.34, 2.12, -27.7);
  group.add(mirrorBar);
  // West face of central partition + West Wall: 3 Crew Shower Stalls with Chrome Risers, Shower Heads, Curbs & Brass Drains!
  for (const sz of [-30.2, -27.7, -25.2]) {
    b.box('tile',   -16.3, 0.04, sz - 1.2, 4.8, 0.14, 0.18, { solid: false }); // Tiled wet curb
    b.box('steel',  -16.3, 0.0,  sz - 1.2, 4.4, 2.15, 0.06, { solid: false }); // Frosted shower stall divider frame
    b.cyl('galley', -18.65, 0.85, sz, 0.035, 1.45, 8, false);                  // Chrome shower riser pipe
    b.cyl('galley', -18.35, 2.22, sz, 0.12,  0.07, 10, false);                 // Chrome shower head rose
    b.box('hazard', -17.4,  0.06, sz, 0.28,  0.02, 0.28, { solid: false });    // Floor brass drain grate
    b.box('wood',   -15.2,  0.05, sz, 0.75,  0.05, 1.15, { solid: false });    // Marine wooden duckboard bath mat
  }
  // Two complete Blender Restroom Cubicle + Porcelain Toilet + Stainless Washbasin Vanity + Mirror Units!
  // (ship_restroom_unit front faces -Z in local space: rotY=Math.PI faces +Z off South wall, rotY=0 faces -Z off North wall)
  cloneRaw('ship_restroom_unit', -10.2, 0, -33.6, Math.PI, 1.0);
  world.addBox(-10.2, 1.0, -33.6, 2.8, 1.0, 0.9, 0, 'concrete');
  cloneRaw('ship_restroom_unit', -10.6, 0, -21.8, 0, 1.0);
  world.addBox(-10.6, 1.0, -21.8, 2.8, 1.0, 0.9, 0, 'concrete');
  // Stainless Waste Bins along the East entry corners
  b.cyl('galley', -6.2, 0, -23.0, 0.24, 0.65, 12, true, 'metal');
  b.cyl('galley', -6.2, 0, -32.4, 0.24, 0.65, 12, true, 'metal');
  addCeilingLamp(-9.5,  3.65, -27.7, 'cool', 28, 20);
  addCeilingLamp(-16.2, 3.65, -27.7, 'warm', 26, 18); // Warm steam-bay contrast light!
  addSign('船员卫生间 · 淋浴区', 'DECK 1F · CREW HEAD & SHOWER BAY', -4.56, 3.22, -28, H, '#4aa8bd', 2.35, 0.54);

  // 1F Ceiling Lamps (placed under solid ceiling slabs — NEVER floating inside open stairwell shaft!)
  addCeilingLamp(0, 3.65, -54, 'warm', 26, 22);
  addCeilingLamp(0, 3.65, -36, 'warm', 26, 22);
  addCeilingLamp(-12, 3.65, -42, 'warm', 22, 18);
  addCeilingLamp(8.2, 3.65, -36, 'warm', 24, 20);

  // 1F -> 2F Wide Continuous Marine Staircase (X = +13.5, Z: -45.0 -> -30.0, Y: 0.0 -> +4.2, 100% FLUSH with 4.2m 2F cutout — ZERO gaps!)
  b.stairs('z', 13.5, -45.0, -30.0, 0.0, 4.2, 4.16, true);

  // --- 2F Deck Slab (Y = +4.2) with CLEAN Stairwell Cutout at X: +11.4..+15.6, Z: -46.0..-30.0 + Perimeter Safety Guardrails! ---
  b.box('cabinFloor', -4.0, 3.82, -42, 30.8, 0.38, 43.2);
  b.box('cabinFloor', 17.5, 3.82, -42, 3.8, 0.38, 43.2);
  b.box('cabinFloor', 13.5, 3.82, -55, 4.2, 0.38, 18.0);
  b.box('cabinFloor', 13.5, 3.82, -25, 4.2, 0.38, 10.0);
  b.railing('z', 11.45, -46.0, -30.0, 4.2);
  b.railing('z', 15.55, -46.0, -30.0, 4.2);
  b.railing('x', -46.0, 11.45, 15.55, 4.2);
  b.pipeBundle('z', 7.8, 7.75, -42, 40);

  // --- EXPANDED 2F CREW MESS HALL + COMMERCIAL STAINLESS GALLEY KITCHEN + 2F WASHROOM (Y = +4.2) ---
  // Mess Hall + Galley perimeter enclosure sealed flush to North hull (-20.2) & West hull (-19.5) — ZERO corner gaps!
  b.wall('bulkhead', 'z', 4.5, -56.2, -20.2, 4.2, 4.0, 0.45, [
    { at: -42, w: 3.4, h: 3.0 }, // East Main Mess Breach Door #1!
    { at: -27, w: 3.0, h: 3.0 }, // East Galley Flank Breach Door #2!
  ]);
  addBlastGate('mess', 4.5, 4.2, -42, 3.4, 2.98, H);
  addBlastGate('mess', 4.5, 4.2, -27, 3.0, 2.98, H);
  // Divider wall with wide Serving Pass-Through Window between Dining Hall (Z:-56..-33) & Galley Kitchen (Z:-33..-20.2)!
  b.wall('galley', 'x', -33, -19.5, 4.7, 4.2, 4.0, 0.4, [
    { at: -10.5, w: 7.5, h: 1.5, sill: 1.05 }, // Stainless kitchen serving pass-through counter window!
    { at: -1.5,  w: 3.0, h: 2.9, sill: 0.0 },  // Open kitchen swinging door passage!
  ]);
  b.box('galley', -10.5, 5.18, -33, 7.8, 0.12, 0.85); // Stainless serving counter ledge
  b.wall('bulkhead', 'x', -56, -19.5, 4.7, 4.2, 4.0, 0.45, [{ at: -13.5, w: 2.6, h: 2.8 }]); // Door to 2F Washroom!

  // 2F Crew Mess Dining Hall: 9 Bolted Blender Mess Booths (3 Full Rows!) + Trays, Mugs, Menu Board & Overhead HVAC/Pendants!
  for (const [bx, bz] of [
    [-2.5, -52], [-2.5, -45], [-2.5, -38],
    [-9.2, -52], [-9.2, -45], [-9.2, -38],
    [-15.6, -52], [-15.6, -45], [-15.6, -38],
  ]) {
    cloneRaw('ship_mess_booth', bx, 4.2, bz, H, 1.0);
    world.addBox(bx, 4.65, bz, 1.3, 0.48, 0.9, 0, 'wood');
    // Lived-in Table Props: Stainless cafeteria trays, porcelain mugs & red condiment bottles!
    b.box('galley',  bx - 0.35, 5.00, bz - 0.14, 0.44, 0.03, 0.30, { solid: false });
    b.box('galley',  bx + 0.32, 5.00, bz + 0.14, 0.44, 0.03, 0.30, { solid: false });
    b.cyl('pipeRed', bx + 0.02, 5.00, bz,        0.04, 0.18, 8, false);
    b.cyl('hazard',  bx - 0.09, 5.00, bz + 0.06, 0.038, 0.15, 8, false);
  }
  // Overhead Steel Ceiling I-Beams + Galvanized HVAC Air Duct + 6 Hanging Warm Pendant Lamps!
  for (const rz of [-52, -45, -38]) {
    b.box('steel', -7.2, 7.82, rz, 23.0, 0.24, 0.26, { solid: false });
  }
  b.box('galley', -9.2, 7.62, -45, 0.65, 0.38, 21.0, { solid: false });
  for (const [px, pz] of [[-2.5, -50], [-2.5, -40], [-9.2, -50], [-9.2, -40], [-15.6, -50], [-15.6, -40]]) {
    b.cyl('steel', px, 7.15, pz, 0.03, 0.85, 6, false);
    b.cyl('steel', px, 6.95, pz, 0.28, 0.18, 12, false);
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), lampWarmMat);
    bulb.position.set(px, 6.92, pz);
    group.add(bulb);
  }
  // Serving Pass-Through Stainless Cafeteria Tray Rail + Coffee/Beverage Urns + Glowing Chinese Menu Board!
  b.box('galley', -10.5, 4.2, -33.7, 7.8, 0.94, 0.62);
  b.cyl('galley', -13.6, 5.15, -33.55, 0.18, 0.48, 12, false);
  b.cyl('galley', -12.9, 5.15, -33.55, 0.18, 0.48, 12, false);
  b.box('hazard', -7.5,  5.15, -33.55, 0.55, 0.22, 0.38, { solid: false }); // Stacked meal trays!
  const menuBoard = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.45), makeScreenMat('menu'));
  menuBoard.position.set(-10.5, 7.05, -33.24);
  menuBoard.rotation.y = Math.PI;
  group.add(menuBoard);
  // Storm-Glass Illuminated Porthole Windows along Port Exterior Wall (X = -19.0)
  for (const wz of [-51, -45, -39]) {
    b.box('steel', -19.0, 5.55, wz, 0.16, 1.35, 2.8, { solid: false });
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 2.55), new THREE.MeshStandardMaterial({
      color: 0x16344c, emissive: 0x1d4b6e, emissiveIntensity: 0.75, roughness: 0.1, metalness: 0.85,
    }));
    pane.position.set(-18.92, 6.22, wz);
    group.add(pane);
  }
  addCeilingLamp(-3.5, 7.85, -45, 'warm', 32, 26);
  addCeilingLamp(-13.5, 7.85, -45, 'warm', 34, 26);

  // 2F Commercial Stainless Steel Galley Kitchen (Z: -33..-21): 3 Stainless Range/Hood Units + Flanged Exhaust Ducts + Walk-in Freezers + Prep Island Pots & Mats!
  b.box('tile', -7.2, 4.22, -27, 23.0, 0.05, 11.6, { solid: false }); // Commercial anti-slip tiled kitchen floor!
  b.box('galley', -19.0, 4.2, -27, 0.14, 3.8, 11.6, { solid: false }); // Stainless West wall cladding
  b.box('galley', -7.2,  4.2, -21.1, 23.0, 3.8, 0.14, { solid: false }); // Stainless North wall cladding
  cloneRaw('ship_galley_unit', -18.2, 4.2, -27, 0, 1.0);
  world.addBox(-18.2, 4.7, -27, 0.65, 0.55, 2.15, 0, 'metal');
  cloneRaw('ship_galley_unit', -11.5, 4.2, -21.8, -H, 1.0);
  world.addBox(-11.5, 4.7, -21.8, 2.15, 0.55, 0.65, 0, 'metal');
  cloneRaw('ship_galley_unit', -5.0, 4.2, -21.8, -H, 1.0);
  world.addBox(-5.0, 4.7, -21.8, 2.15, 0.55, 0.65, 0, 'metal');
  // Flanged Stainless Exhaust Ducts connecting every range hood straight into the ceiling + Warm Under-Hood Task Light Strips!
  for (const [dx, dz] of [[-18.2, -27], [-11.5, -21.8], [-5.0, -21.8]]) {
    b.box('galley', dx, 6.85, dz, 0.95, 1.15, 0.95, { solid: false });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(dx < -15 ? 0.18 : 2.8, 0.06, dx < -15 ? 2.8 : 0.18), lampWarmMat);
    strip.position.set(dx, 6.32, dz);
    group.add(strip);
  }
  // Walk-In Commercial Stainless Freezer Doors along North-East Kitchen Wall (X: +0.8..+3.8, Z: -21.2) + Red -18.4°C LED!
  b.box('steel',  1.6, 4.2, -21.35, 2.4, 2.65, 0.24, { solid: false });
  b.box('galley', 1.6, 4.28, -21.48, 2.05, 2.48, 0.08, { solid: false });
  b.box('steel',  2.35, 5.25, -21.56, 0.12, 0.45, 0.14, { solid: false }); // Heavy chrome freezer latch handle
  const galleyTemp = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.42), makeScreenMat('temp'));
  galleyTemp.position.set(1.6, 7.12, -21.48);
  galleyTemp.rotation.y = Math.PI;
  group.add(galleyTemp);
  // Central Stainless Galley Prep Island Loaded with Cutting Boards, Stock Pots, Gastro-Trays & Overhead Hanging Pot-Rack!
  b.box('galley', -10.5, 4.2, -27.5, 6.4, 0.94, 1.55);
  b.box('wood',   -12.4, 5.15, -27.5, 0.85, 0.06, 0.58, { solid: false }); // Butcher block chopping board
  b.cyl('galley', -10.6, 5.15, -27.3, 0.24, 0.36, 12, false);              // Large stainless stock pot
  b.cyl('galley',  -9.6, 5.15, -27.7, 0.20, 0.28, 12, false);              // Saucepan
  b.box('galley',  -8.2, 5.15, -27.5, 0.68, 0.18, 0.48, { solid: false }); // Stacked gastro-trays
  // Hanging Overhead Steel Pot-Rack Bar above Prep Island!
  b.box('steel',  -10.5, 6.72, -27.5, 5.6, 0.08, 0.72, { solid: false });
  b.cyl('steel',  -13.0, 6.76, -27.5, 0.03, 1.25, 6, false);
  b.cyl('steel',   -8.0, 6.76, -27.5, 0.03, 1.25, 6, false);
  for (const px of [-12.2, -11.2, -10.2, -9.2, -8.5]) {
    b.cyl('galley', px, 6.28, -27.5, 0.18, 0.05, 10, false); // Hanging skillets/lids
  }
  // Black Rubber Anti-Fatigue Kitchen Floor Mats around Ranges & Prep Island!
  b.box('steel', -10.5, 4.25, -25.8, 5.8, 0.03, 0.95, { solid: false });
  b.box('steel', -10.5, 4.25, -29.2, 5.8, 0.03, 0.95, { solid: false });
  b.box('steel', -16.6, 4.25, -27.0, 1.0, 0.03, 4.2,  { solid: false });
  addProp('ph_shelves', -16.0, 4.2, -22.2, 0, 1.15);
  addProp('pallet',     -16.2, 4.2, -31.0, 0.1, 1.05);
  addProp('mil_crate',  -16.2, 4.4, -31.0, 0.1, 0.95);
  addProp('ph_extinguisher', 3.6, 4.2, -32.2, 0, 1.1);
  addCeilingLamp(-11, 7.85, -27, 'warm', 36, 24);
  addCeilingLamp(-2,  7.85, -27, 'cool', 30, 22);

  // 2F Aft Ceramic-Tiled Crew Restroom (Z: -63..-56, X: -19..-4)
  b.box('tile', -11.5, 4.22, -59.5, 14.8, 0.05, 6.8, { solid: false });
  b.box('tile', -11.5, 4.2, -63.0, 14.8, 3.8, 0.14, { solid: false });
  cloneRaw('ship_restroom_unit', -11.5, 4.2, -61.9, Math.PI, 1.0);
  world.addBox(-11.5, 5.2, -61.9, 2.8, 1.0, 0.9, 0, 'concrete');
  addCeilingLamp(-11.5, 7.85, -59.5, 'cool', 26, 18);

  addSign('2F 船员餐厅 · 后厨', 'DECK 2F · CREW MESS HALL & GALLEY', 4.725, 7.52, -42, H, '#c89438', 2.45, 0.56);
  addCeilingLamp(9.5, 7.85, -42, 'warm', 26, 22);

  // 2F -> 3F Wide Continuous Marine Staircase (X = +13.5, Z: -49.0 -> -61.2, Y: +4.2 -> +8.4, 100% FLUSH with 4.2m 3F cutout — ZERO gaps!)
  b.stairs('z', 13.5, -49.0, -61.2, 4.2, 8.4, 4.16, true);

  // --- 3F Panoramic Navigation Bridge (Y = +8.4, Z: -64..-20) + Perimeter Stairwell Guardrails! ---
  b.box('cabinFloor', -4.0, 8.02, -42, 30.8, 0.38, 43.2);
  b.box('cabinFloor', 17.5, 8.02, -42, 3.8, 0.38, 43.2);
  b.box('cabinFloor', 13.5, 8.02, -34, 4.2, 0.38, 28.0);
  b.box('cabinFloor', 13.5, 8.02, -62.6, 4.2, 0.38, 2.8);
  b.railing('z', 11.45, -61.2, -48.0, 8.4);
  b.railing('z', 15.55, -61.2, -48.0, 8.4);
  b.railing('x', -48.0, 11.45, 15.55, 8.4);
  // 3F Exterior Bridge Wings (Port & Starboard out to X = ±24.5m!)
  b.catwalk(-22.0, 8.4, -32, 5.2, 9.0, { e: true });
  b.catwalk( 22.0, 8.4, -32, 5.2, 9.0, { w: true });
  addProp('searchlight', -23.5, 8.4, -29, 0.3, 1.25);
  addProp('searchlight',  23.5, 8.4, -29, -0.3, 1.25);
  // Bridge Helm Consoles, Sculpted Ship's Wheel, Twin Engine Telegraphs, Illuminated Radar/ECDIS Monitors & Tactical Chart Table!
  b.cover(-8.2, 8.4, -26.2, 6.2, 1.35, false, 0.08, 'steel');
  b.cover( 8.2, 8.4, -26.2, 6.2, 1.35, false, -0.08, 'steel');
  b.cover( 0.0, 8.4, -25.8, 4.8, 1.45, false, 0, 'steel');
  // Sloped Upper Console Cowlings & 6 Glowing Tactical Displays (Radar PPI, ECDIS Chart, Engine RPM Telemetry!)
  const bridgeScreens: [number, number, number, number, 'radar' | 'ecdis' | 'engine'][] = [
    [-9.8, 10.12, -26.2, Math.PI + 0.08, 'engine'],
    [-6.6, 10.12, -26.0, Math.PI + 0.08, 'radar'],
    [-1.4, 10.12, -25.8, Math.PI,        'radar'],
    [ 1.4, 10.12, -25.8, Math.PI,        'ecdis'],
    [ 6.6, 10.12, -26.0, Math.PI - 0.08, 'ecdis'],
    [ 9.8, 10.12, -26.2, Math.PI - 0.08, 'engine'],
  ];
  for (const [sx, sy, sz, srot, kind] of bridgeScreens) {
    b.box('steel', sx, sy - 0.56, sz, 1.48, 0.96, 0.16, { rotY: srot, solid: false });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.82), makeScreenMat(kind));
    scr.position.set(sx, sy - 0.08, sz - 0.10);
    scr.rotation.set(-0.18, srot, 0, 'YXZ');
    group.add(scr);
  }
  // Sculpted Central Ship's Helm Wheel & Twin Brass Engine-Order Telegraphs!
  const helmWheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 8, 20), pbr.wood);
  helmWheel.position.set(0.0, 9.75, -26.68);
  group.add(helmWheel);
  b.cyl('hazard', 0.0, 9.75, -26.68, 0.07, 0.14, 10, false);
  for (const tx of [1.85, 2.08]) {
    b.cyl('steel',  tx, 9.55, -26.3, 0.03, 0.42, 8, false);
    b.cyl('hazard', tx, 9.96, -26.3, 0.07, 0.07, 8, false); // Brass throttle knob
  }
  // Overhead Illuminated Rudder Angle Indicator Bar + Red Night-Ops Bridge Strip Lights + Ceiling Cable Trays!
  b.box('steel', 0, 11.72, -21.2, 5.4, 0.42, 0.36, { solid: false });
  const rudderBar = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 0.24), makeScreenMat('engine'));
  rudderBar.position.set(0, 11.92, -21.40);
  rudderBar.rotation.y = Math.PI;
  group.add(rudderBar);
  b.box('steel', -6.0, 12.05, -34.0, 0.65, 0.18, 24.0, { solid: false });
  b.box('steel',  6.0, 12.05, -34.0, 0.65, 0.18, 24.0, { solid: false });
  // Central Glowing Naval Chart Table (Z = -35.5) with South China Sea ECDIS Overlay & Elevated Captain's Command Chair!
  b.cover(0, 8.4, -35.5, 5.6, 1.8, false, 0, 'wood');
  const chartMap = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.35), makeScreenMat('ecdis'));
  chartMap.position.set(0, 9.56, -35.5);
  chartMap.rotation.x = -H;
  group.add(chartMap);
  // Elevated Captain's Swivel Command Chair on Raised Brass-Trimmed Plinth!
  b.box('steel', -3.6, 8.4, -31.5, 1.5, 0.28, 1.5);
  b.cyl('steel', -3.6, 8.68, -31.5, 0.10, 0.55, 10, false);
  b.box('steel', -3.6, 9.20, -31.5, 0.72, 0.14, 0.72, { solid: false });
  b.box('steel', -3.6, 9.32, -31.85, 0.70, 0.85, 0.14, { solid: false });
  addProp('ph_laptop', TAISHAN.z2BridgeConsole.x, 9.56, TAISHAN.z2BridgeConsole.z, Math.PI, 1.25);
  addProp('field_radio', -1.8, 9.56, -26.0, Math.PI, 1.15);
  addProp('office_desk', -11.5, 8.4, -44, H, 1.1);
  addProp('chair', -10.2, 8.4, -44, -H, 1.1);
  addProp('office_desk',  10.5, 8.4, -44, -H, 1.1);
  addProp('chair',         9.2, 8.4, -44, H, 1.1);
  addProp('ph_sec_cam', -18.2, 11.6, -24, 0.8, 1.2);
  addProp('ph_extinguisher', 18.2, 8.4, -28, -H, 1.1);
  const bridgeLight = new THREE.PointLight(0x38d8ff, 34, 24, 1.4);
  bridgeLight.position.set(0, 11.2, -26.5);
  group.add(bridgeLight);
  const chartLight = new THREE.PointLight(0xff5238, 18, 16, 1.6); // Subtle red naval night-ops chart glow!
  chartLight.position.set(0, 11.4, -35.5);
  group.add(chartLight);
  addCeilingLamp(-10, 12.1, -34, 'cool', 28, 26);
  addCeilingLamp( 10, 12.1, -34, 'cool', 28, 26);
  addCeilingLamp(  0, 12.1, -48, 'warm', 26, 26);

  // Sealed 3F Bridge Roof (Y = +12.6) + Rotating Blender Naval Radar Mast + Twin Ship Funnels!
  b.box('hull', 0, 12.6, -42, 39.8, 0.5, 44.6);
  const mastInst = cloneRaw('ship_radar_mast', 0, 13.1, -38, 0, 1.0, false, { skipPivots: ['RadarBar'] });
  const radarBar = mastInst.getObjectByName('RadarBar') ?? null;
  // Twin Iconic Maritime Red-and-Navy Exhaust Funnels with white company stripe, exhaust uptakes & steel shrouds!
  for (const fx of [-7.8, 7.8]) {
    b.box('pipeRed', fx, 13.1, -55, 4.2, 6.2, 6.2);
    b.box('bulkhead', fx, 15.6, -55, 4.32, 0.85, 6.32, { solid: false }); // Classic white maritime funnel band
    b.box('steel', fx, 19.3, -55, 4.5, 1.4, 6.5, { solid: false });
    b.cyl('steel', fx, 20.6, -55, 1.15, 2.0, 16, false);
  }

  addSign('02 号气密闸门 · 3 号主货舱', 'W.T. DOOR 02 · MAIN CARGO HOLD NO.3', 0, 4.15, -20.42, Math.PI, '#48a4bc', 3.2, 0.72);

  // =========================================================================
  // ZONE 3: 3 号巨型双层主货舱 (14m 挑高垂直战场, Z: -20..+36, Y: -6.0 Floor / 0.0 Catwalk)
  // =========================================================================
  b.box('deck', 0, -6.8, 8, 40.0, 0.8, 56, { road: true });
  b.box('hull', -19.8, -6.0, 8, 0.9, 13.0, 56);
  b.box('hull',  19.8, -6.0, 8, 0.9, 13.0, 56);
  // Structural vertical cargo-hold steel ribs every 8m + overhead traveling crane girder!
  for (let hz = -16; hz <= 32; hz += 8) {
    b.box('steel', -19.2, -6.0, hz, 0.55, 13.0, 0.65, { solid: false });
    b.box('steel',  19.2, -6.0, hz, 0.55, 13.0, 0.65, { solid: false });
  }
  b.box('chevron', 0, 6.4, 8, 39.2, 1.15, 2.8, { solid: false, tile: 1.6 }); // Overhead hold bridge crane beam
  b.box('steel', -3.5, 5.2, 8, 3.4, 1.2, 2.4, { solid: false });
  // Suspended Overhead Cargo-Hold Hoist Cables, Sheave Block & Yellow Container Spreader Frame!
  for (const cx of [-4.4, -2.6]) {
    b.cyl('steel', cx, 1.65, 8.0, 0.04, 3.6, 8, false);
  }
  b.box('hazard', -3.5, 1.35, 8.0, 2.5, 0.32, 1.25, { solid: false });
  b.box('steel',  -3.5, 1.05, 8.0, 0.45, 0.36, 0.45, { solid: false });
  b.pipeBundle('z', -18.5, 4.8, 8, 52);
  b.pipeBundle('z',  18.5, 4.8, 8, 52);

  // Upper Perimeter Steel Catwalk Ring at Y = 0.0m — 360° UNOBSTRUCTED LOOP (removed blocking side-catwalk railings at Z=-14.35 & Z=+31.0!)
  b.catwalk(0, 0.0, -17.0, 38.0, 5.4, { n: true, s: true, e: true, w: true });
  b.railing('x', -14.35, -11.8, 11.8, 0.0); // Center safety rail only; X=±13.6 (stairs) & X=±17.2 (side catwalks) 100% OPEN!
  b.catwalk(-17.2, 0.0, 8.35, 3.6, 45.3, { n: true, s: true }); // Flush between Z=-14.3 and Z=+31.0!
  b.catwalk( 17.2, 0.0, 8.35, 3.6, 45.3, { n: true, s: true });
  b.catwalk(0, 0.0, 33.2, 38.0, 4.4, { n: true, e: true, w: true }); // Open -Z side onto both side catwalks, center guardrail below!
  b.railing('x', 31.05, -15.35, 15.35, 0.0);
  // Structural Vertical Steel H-Beam Support Stanchions under Upper Perimeter Catwalks
  for (const cz of [-14.0, -4.0, 8.0, 20.0, 31.2]) {
    b.box('steel', -15.6, -6.0, cz, 0.32, 6.0, 0.32, { solid: false });
    b.box('steel',  15.6, -6.0, cz, 0.32, 6.0, 0.32, { solid: false });
  }

  // Twin Continuous Industrial Steel Staircases (Y=0.0 -> -3.0 -> -6.0, FLUSH landings + sturdy support pillars!)
  for (const sx of [-13.6, 13.6]) {
    b.stairs('z', sx, -14.3, -2.0, 0.0, -3.0, 3.4, true);
    b.catwalk(sx, -3.0, 0.2, 3.6, 4.4, { n: true, s: true });
    b.box('steel', sx - 1.55, -6.0, 0.2, 0.26, 3.0, 0.26, { solid: false });
    b.box('steel', sx + 1.55, -6.0, 0.2, 0.26, 3.0, 0.26, { solid: false });
    b.stairs('z', sx, 2.4, 14.4, -3.0, -6.0, 3.4, true);
  }

  // Lower Hold Floor (Y = -6.0) 3D Corrugated Container Combat Arena
  addContainer(-7.5, -6.0, -6.0,  0.00, 2, 0);
  addContainer( 7.5, -6.0, -4.0,  0.00, 2, 2);
  addContainer(-8.0, -6.0,  8.0,  0.08, 2, 3);
  addContainer( 8.0, -6.0, 10.0, -0.06, 2, 0);
  addContainer(-9.0, -6.0, 22.0,  0.00, 1, 2);
  addContainer( 9.0, -6.0, 22.0,  0.00, 1, 3);
  b.cover(0, -6.0, -4.0, 4.5, 1.1, false);
  b.cover(0, -6.0,  8.0, 5.0, 1.2, true);
  b.cover(-4.5, -6.0, 16.5, 3.8, 1.1, false, 0.2);
  b.cover( 4.5, -6.0, 16.5, 3.8, 1.1, false, -0.2);
  addProp('veh_forklift', -3.5, -6.0, 0.5, 0.5, 1.05);
  addProp('pallet', 3.8, -6.0, 1.5, 0.2, 1.15);
  addProp('mil_crate', -15.5, -6.0, 24, 0.3, 1.15);
  addProp('barrel', 15.2, -6.0, 22, 0.6, 1.05);
  // Cargo Hold #3 Enrichment: Yellow forklift lane stripes, heavy timber cable drums & bulkhead fire-hose stations
  b.box('hazard', -4.2, -5.98, 6.0, 0.24, 0.03, 38.0, { solid: false });
  b.box('hazard',  4.2, -5.98, 6.0, 0.24, 0.03, 38.0, { solid: false });
  for (const [rx, rz] of [[-16.4, -12.0], [16.4, -12.0], [-16.4, 30.2], [16.4, 30.2]] as [number, number][]) {
    b.cyl('wood', rx, -6.0, rz, 0.68, 0.92, 14, false);
    b.cyl('steel', rx, -5.95, rz, 0.72, 0.08, 14, false);
    b.cyl('steel', rx, -5.12, rz, 0.72, 0.08, 14, false);
  }
  addProp('ph_extinguisher', -18.8, -6.0, 8.0, H, 1.15);
  addProp('ph_extinguisher',  18.8, -6.0, 8.0, -H, 1.15);
  addProp('flood_lights', -8.5, 0.0, -15.2, 0.3, 1.15);
  addProp('flood_lights',  8.5, 0.0, -15.2, -0.3, 1.15);
  // Extra Cargo Hold #3 Storytelling: Strapped Supply Pallets, Oil-Drum Clusters, Upper Catwalk Crate Stashes & Emergency Lifebuoys!
  addProp('pallet', -16.2, -6.0, 4.5, 0.15, 1.15);
  addProp('mil_crate', -16.2, -5.8, 4.5, 0.15, 1.05);
  addProp('barrel', 16.0, -6.0, 5.2, 0.4, 1.05);
  addProp('barrel', 16.9, -6.0, 6.2, -0.2, 1.05);
  addProp('ammo_box', -17.2, 0.0, 12.0, H, 1.15);
  addProp('mil_crate', 17.2, 0.0, 18.0, -H, 1.1);
  for (const sx of [-1, 1]) {
    const hRing = new THREE.Mesh(lifebuoyGeo, pbr.pipeRed);
    hRing.position.set(sx * 19.1, 1.35, 8.0);
    hRing.rotation.y = H;
    group.add(hRing);
  }

  // Objective #3: Open-Backed High-Value "Epsilon" Special Hazmat Container at (0, -6.0, +25.5)
  b.box('epsilonWall', -2.4, -6.0, 25.5, 0.36, 3.2, 8.2);
  b.box('epsilonWall',  2.4, -6.0, 25.5, 0.36, 3.2, 8.2);
  b.box('epsilonWall',  0.0, -2.8, 25.5, 5.2,  0.36, 8.2);
  b.box('epsilonWall',  0.0, -6.0, 29.4, 5.2,  3.2, 0.36);
  b.cover(0.0, -6.0, 27.6, 2.2, 1.0, false, 0, 'steel');
  addProp('ph_laptop', TAISHAN.z3Epsilon.x, -4.85, TAISHAN.z3Epsilon.z + 0.8, 0, 1.25);
  const epsilonLight = new THREE.PointLight(0xff3828, 32, 22, 1.45);
  epsilonLight.position.set(0, -3.6, 26.5);
  group.add(epsilonLight);

  // Hold Atmospheric Overhead Sodium + Blue Industrial Floodlights
  for (const [lx, lz] of [[-10, -8], [10, -8], [0, 8], [-10, 26], [10, 26]]) {
    const hl = new THREE.PointLight(0xffbe68, 44, 38, 1.4);
    hl.position.set(lx, 5.2, lz);
    group.add(hl);
  }

  // Zone 3 -> Zone 4 Engine Room Forward Bulkhead Wall & Physical Blast Gate #3 (Z = +36, Y = -6.0)
  b.wall('hull', 'x', 36, -19.8, 19.8, -6.0, 12.8, 0.9, [
    { at: 0, w: 4.8, h: 3.6 },
    { at: -12.5, w: 3.0, h: 3.0 },
  ]);
  addBlastGate('g34', 0, -6.0, 36, 4.8, 3.58, 0);
  addBlastGate('g34', -12.5, -6.0, 36, 3.0, 2.98, 0);
  addSign('03 号水密闸门 · 主轮机舱', 'W.T. DOOR 03 · MAIN ENGINE ROOM (-6.0M)', 0, -1.75, 35.48, Math.PI, '#c89438', 3.2, 0.72);

  // =========================================================================
  // ZONE 4: 深海主轮机舱与双柴油主机大厅 (Z: +36..+82, X: -19.8..+19.8, Y: -6.0 / -1.8)
  // =========================================================================
  b.box('deck', 0, -6.8, 59, 40.0, 0.8, 46, { road: true });
  b.box('ceiling', 0, 2.6, 59, 40.4, 0.7, 46.6);
  b.box('hull', -19.8, -6.0, 59, 0.9, 9.0, 46);
  b.box('hull',  19.8, -6.0, 59, 0.9, 9.0, 46);
  // Structural Engine-Room Ceiling Steel I-Beams & Color-Coded Marine Piping!
  for (let ez = 40; ez <= 78; ez += 8) {
    b.box('steel', 0, 2.1, ez, 39.2, 0.5, 0.55, { solid: false });
    b.box('steel', -19.2, -6.0, ez, 0.5, 8.6, 0.55, { solid: false });
    b.box('steel',  19.2, -6.0, ez, 0.5, 8.6, 0.55, { solid: false });
  }
  b.pipeBundle('z', -14.5, 1.55, 59, 44);
  b.pipeBundle('z',  14.5, 1.55, 59, 44);

  // Twin Monumental Blender 18m 12-Cylinder Marine Diesel Main Engines!
  cloneRaw('ship_diesel_engine', -8.8, -6.0, 58, 0, 1.0);
  world.addBox(-8.8, -3.2, 58, 2.7, 2.8, 9.9, 0, 'metal');
  cloneRaw('ship_diesel_engine',  8.8, -6.0, 58, Math.PI, 1.0);
  world.addBox( 8.8, -3.2, 58, 2.7, 2.8, 9.9, 0, 'metal');

  // Central Turbine Spine Cover + Engine Room Photogrammetry Tools
  b.cover(0, -6.0, 46, 3.6, 1.1, false, 0, 'steel');
  b.cover(0, -6.0, 58, 4.0, 1.2, true,  0, 'steel');
  b.cover(0, -6.0, 70, 3.6, 1.1, false, 0, 'steel');
  addProp('ph_tool_cart', -3.2, -6.0, 43, 0.4, 1.15);
  addProp('ph_welder',     3.4, -6.0, 43, -0.3, 1.15);
  addProp('generator',   15.2, -6.0, 43, -H, 1.15);
  addProp('ph_extinguisher', -4.2, -6.0, 76, 0, 1.15);
  // Engine Room Enrichment: Twin banks of crimson CO2 fire-suppression cylinders & central floor safety walkways
  for (let i = 0; i < 4; i++) {
    b.cyl('pipeRed', -18.6, -6.0, 48.0 + i * 0.72, 0.16, 1.65, 10, false);
    b.cyl('pipeRed',  18.6, -6.0, 48.0 + i * 0.72, 0.16, 1.65, 10, false);
  }
  b.box('hazard', -2.6, -5.98, 58.0, 0.18, 0.03, 36.0, { solid: false });
  b.box('hazard',  2.6, -5.98, 58.0, 0.18, 0.03, 36.0, { solid: false });

  // Mid-Level Engine Inspection Mezzanine Catwalks (Y = -1.8m) — Note: catwalk open.n = -Z edge, open.s = +Z edge!
  // Cross-catwalks at Z=46.2 & Z=69.8 sit 100% CLEAR of the twin 18m diesel engines (Z: 48.1..67.9)!
  b.catwalk(-16.5, -1.8, 60.2, 5.2, 29.6, { n: true, e: true }); // Z: 45.4..75.0 (-Z edge open for Port stair, +Z guarded!)
  b.catwalk( 16.5, -1.8, 55.8, 5.2, 29.6, { s: true, w: true }); // Z: 41.0..70.6 (+Z edge open for Starboard stair, -Z guarded!)
  b.catwalk(0, -1.8, 46.2, 27.8, 3.2, { e: true, w: true });     // Z: 44.6..47.8, flush inner edge X: -13.9..+13.9 (ZERO engine overlap!)
  b.catwalk(0, -1.8, 69.8, 27.8, 3.2, { e: true, w: true });     // Z: 68.2..71.4, flush inner edge X: -13.9..+13.9 (ZERO engine overlap!)
  b.catwalk(0, -1.8, 58.0, 10.6, 3.2, { e: true, w: true });
  // Structural Support Columns under Engine Room Mezzanine Corners
  for (const [cx, cz] of [[-14.2, 46.2], [-14.2, 58.0], [-14.2, 69.8], [14.2, 46.2], [14.2, 58.0], [14.2, 69.8]] as [number, number][]) {
    b.box('steel', cx, -6.0, cz, 0.32, 4.2, 0.32, { solid: false });
  }
  // Gentle 30° Marine Staircases up to -1.8m Mezzanine (7.2m span, open landings at both ends, ZERO wall/railing collisions!)
  b.stairs('z', -16.5, 38.2, 45.4, -6.0, -1.8, 3.2, true);
  b.stairs('z',  16.5, 77.8, 70.6, -6.0, -1.8, 3.2, true);

  // Engine Room Maritime Enrichment: Twin Pressure-Vessel Expansion Boilers, Pipe Valve Manifolds & Mezzanine Telemetry Control Desk!
  for (const [bx, bz] of [[-16.8, 78.2], [16.8, 39.2]] as [number, number][]) {
    b.cyl('bulkhead', bx, -6.0, bz, 1.05, 3.6, 16, true, 'metal');
    b.cyl('pipeRed',  bx, -5.2, bz, 1.12, 0.18, 16, false);
    b.cyl('hazard',   bx, -3.2, bz, 1.12, 0.18, 16, false);
    b.cyl('steel',    bx, -2.4, bz, 0.35, 0.6, 12, false);
  }
  // Mezzanine Overlook Engine Control Console on South Cross-Catwalk (Z=46.2, Y=-1.8)
  b.cover(0, -1.8, 47.2, 3.4, 0.72, false, 0, 'steel');
  const mezzScr = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.72), makeScreenMat('engine'));
  mezzScr.position.set(0, -0.58, 47.15);
  mezzScr.rotation.x = -0.32;
  group.add(mezzScr);
  addProp('pallet', -3.6, -6.0, 64.5, 0.12, 1.1);
  addProp('mil_crate', -3.6, -5.8, 64.5, 0.12, 1.0);
  addProp('barrel', 3.8, -6.0, 52.0, 0.5, 1.05);
  addProp('ph_tool_cart', 16.5, -1.8, 44.0, -H, 1.1);

  // Zone 4 Dual Objectives: Emergency Power Switchgear (East Mezzanine) & Bilge Flood Valve (NW Bilge)
  b.cover(18.0, -1.8, 58, 1.4, 4.2, false, 0, 'steel');
  addProp('utility_box', 18.8, -1.8, 58, -H, 1.25);
  const powerLight = new THREE.PointLight(0xff8c24, 24, 18, 1.5);
  powerLight.position.set(16.8, 0.8, 58);
  group.add(powerLight);

  b.cyl('pipeRed', -12.5, -6.0, 76, 0.55, 1.6, 14, true, 'metal');
  const valveWheel = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.08, 8, 18), pbr.hazard);
  valveWheel.position.set(-12.5, -4.35, 76);
  valveWheel.rotation.x = H;
  group.add(valveWheel);
  const valveLight = new THREE.PointLight(0xff3828, 22, 16, 1.5);
  valveLight.position.set(-12.5, -3.5, 76);
  group.add(valveLight);

  // Rising Bilge Floodwater Plane (hidden below floor until Zone 4 hull-breach crisis!)
  const floodWater = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 46),
    new THREE.MeshStandardMaterial({ color: 0x0b2538, roughness: 0.14, metalness: 0.35, transparent: true, opacity: 0.82 }),
  );
  floodWater.rotation.x = -H;
  floodWater.position.set(0, -7.2, 59);
  group.add(floodWater);

  // Engine Room Lighting + Overhead Yellow Bridge Crane + Warm Engine Inspection Lamps + Telemetry Screens + Emergency Red Alarm Strobe Lights!
  // Yellow Overhead Marine Engine-Room Bridge Crane Beam & Chain Hoist Trolley!
  b.box('hazard', 0, 1.25, 56.0, 36.0, 0.55, 0.72, { solid: false });
  b.box('steel',  0, 0.65, 56.0, 2.2,  0.60, 1.15, { solid: false });
  b.cyl('steel',  0, -1.65, 56.0, 0.04, 2.3, 8, false);
  b.box('hazard', 0, -1.85, 56.0, 0.42, 0.36, 0.36, { solid: false });
  // Warm Amber Engine-Side Inspection Lamps & Illuminated Engine Telemetry Monitors along both 18m Diesel Blocks!
  for (const ez of [51, 61, 71]) {
    for (const ex of [-5.8, 5.8]) {
      const el = new THREE.PointLight(0xffa042, 26, 18, 1.5);
      el.position.set(ex, -2.4, ez);
      group.add(el);
      engineLights.push(el);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.65), lampWarmMat);
      bulb.position.set(ex + (ex < 0 ? -0.45 : 0.45), -2.2, ez);
      group.add(bulb);
    }
  }
  const engMon1 = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.05), makeScreenMat('engine'));
  engMon1.position.set(12.2, -4.15, 46.8);
  engMon1.rotation.y = Math.PI;
  group.add(engMon1);
  const engMon2 = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.05), makeScreenMat('engine'));
  engMon2.position.set(-12.2, -4.15, 46.8);
  engMon2.rotation.y = Math.PI;
  group.add(engMon2);
  for (const [lx, lz] of [[-12, 44], [12, 44], [0, 58], [-12, 74], [12, 74]]) {
    addCeilingLamp(lx, 2.05, lz, 'cool', 38, 36, true);
  }
  for (const [ax, az] of [[0, 44], [0, 72], [0, 8]]) {
    const ab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.4), lampRedMat);
    ab.position.set(ax, 1.9, az);
    group.add(ab);
    const al = new THREE.PointLight(0xff2018, 0, 28, 1.4);
    al.position.set(ax, 1.6, az);
    group.add(al);
    alarmLights.push(al);
  }

  // Zone 4 -> Zone 5 Forward Bulkhead Wall & Physical Blast Gate #4 (Z = +82, Y = -6.0)
  b.wall('hull', 'x', 82, -19.8, 19.8, -6.0, 9.0, 0.9, [{ at: 0, w: 5.2, h: 3.8 }]);
  addBlastGate('g45', 0, -6.0, 82, 5.2, 3.78, 0);
  addSign('04 号抗沉逃生通道 · 前甲板', 'EMERGENCY ESCAPE SHAFT · TO FOREDECK (0.0M)', 0, -1.55, 81.48, Math.PI, '#48a4bc', 3.2, 0.72);

  // Continuous 4.8m-Wide Grand Marine Ascent Staircase (-6.0m -> 0.0m, ZERO TELEPORTS!) + Companionway Hatch Coaming!
  b.box('deck', 0, -6.8, 87, 6.2, 0.8, 10.6);
  b.box('hull', -2.9, -6.0, 87, 0.6, 9.2, 10.4);
  b.box('hull',  2.9, -6.0, 87, 0.6, 9.2, 10.4);
  b.box('hull',  0.0,  3.1, 85.8, 6.4, 0.45, 7.6);
  b.box('hazard', 0.0, 3.05, 89.65, 6.42, 0.24, 0.16, { solid: false }); // Companionway yellow warning brow
  b.stairs('z', 0.0, 82.2, 92.0, -6.0, 0.0, 5.16, true);
  addCeilingLamp(0, 2.9, 86, 'warm', 32, 22);

  // =========================================================================
  // ZONE 5: 前甲板重型龙门吊与防空导弹驳运区 (Z: +82..+116, Y: 0.0 / +4.2 / +18m)
  // =========================================================================
  b.box('deck', -11.4, -0.8, 87, 17.2, 0.8, 10.2, { road: true });
  b.box('deck',  11.4, -0.8, 87, 17.2, 0.8, 10.2, { road: true });
  b.box('deck',   0.0, -0.8, 104, 40.0, 0.8, 24.0, { road: true });

  // Twin Monumental 18m Blender Portal Gantry Cranes (Z = +98 & Z = +109)!
  for (const gz of [98, 109]) {
    cloneRaw('ship_gantry_crane', 0, 0, gz, 0, 1.0);
    world.addBox(-16.8, 8.5, gz, 1.4, 8.5, 2.2, 0, 'metal');
    world.addBox( 16.8, 8.5, gz, 1.4, 8.5, 2.2, 0, 'metal');
    const crLight = new THREE.PointLight(0xffb458, 48, 44, 1.35);
    crLight.position.set(0, 14.5, gz);
    group.add(crLight);
  }
  // Walkable +4.2m Gantry Operator Catwalks (open.n = -Z edge open for stairs; +Z cliff end guarded; ZERO crane-leg clipping!)
  b.catwalk(-13.4, 4.2, 103.5, 3.2, 16.5, { n: true });
  b.catwalk( 13.4, 4.2, 103.5, 3.2, 16.5, { n: true });
  b.stairs('z', -13.4, 87.8, 95.25, 0.0, 4.2, 3.0, true);
  b.stairs('z',  13.4, 87.8, 95.25, 0.0, 4.2, 3.0, true);
  for (const cx of [-13.4, 13.4]) {
    for (const cz of [96.0, 103.5, 111.0]) {
      b.box('steel', cx - 1.35, 0.0, cz, 0.28, 4.2, 0.28, { solid: false });
      b.box('steel', cx + 1.35, 0.0, cz, 0.28, 4.2, 0.28, { solid: false });
    }
  }
  b.cover(-12.2, 4.2, 103.5, 0.55, 5.0, false);
  b.cover( 12.2, 4.2, 103.5, 0.55, 5.0, false);

  // Foredeck 3D Containers, Tactical Cover, SOLAS Life-Raft Canisters, Deck Ventilation Cowls & Objective #5 Quad-Tube SAM Battery!
  addContainer(-8.5, 0, 96,  0.06, 1, 1);
  addContainer( 8.5, 0, 96, -0.06, 1, 0);
  addContainer(-9.0, 0, 108, 0.00, 2, 3);
  addContainer( 9.0, 0, 108, 0.00, 2, 2);
  b.cover(0, 0, 96.5, 5.2, 1.1, false);
  b.cover(-4.5, 0, 104, 1.2, 4.5, false);
  b.cover( 4.5, 0, 104, 1.2, 4.5, false);
  // Hijacker Sandbag Barricades, Marine Deck Mushroom Vent Cowls & White Cylindrical SOLAS Inflatable Life-Raft Racks!
  addProp('sandbags', -3.6, 0, 107.8, 0.35, 1.1);
  addProp('sandbags',  3.6, 0, 107.8, -0.35, 1.1);
  for (const sx of [-1, 1]) {
    // Classic SOLAS White Inflatable Life-Raft Canister in Steel Cradle along Port/Starboard gunwales
    for (const rz of [86.0, 88.2]) {
      b.box('steel', sx * 18.2, 0.0, rz, 0.72, 0.65, 1.45, { solid: false });
      const raft = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.25, 12), pbr.bulkhead);
      raft.rotation.x = H;
      raft.position.set(sx * 18.2, 0.88, rz);
      group.add(raft);
    }
    // Iconic Marine Deck Ventilation Mushroom Cowls
    for (const vz of [92.5, 113.5]) {
      b.cyl('steel', sx * 17.8, 0.0, vz, 0.32, 1.35, 12, false);
      b.cyl('pipeRed', sx * 17.8, 1.32, vz, 0.54, 0.28, 14, false);
    }
    // High-Visibility Yellow Crane Rail Safety Lines on Foredeck
    b.box('hazard', sx * 15.8, 0.03, 103.5, 0.22, 0.03, 24.0, { solid: false });
  }
  const samGroup = buildNavalSAMBattery(TAISHAN.z5SAM.x, 0, TAISHAN.z5SAM.z, Math.PI, 1.05);
  world.addBox(TAISHAN.z5SAM.x, 1.5, TAISHAN.z5SAM.z, 1.8, 1.5, 2.0, 0, 'metal');
  const samLight = new THREE.PointLight(0xff3824, 28, 24, 1.4);
  samLight.position.set(TAISHAN.z5SAM.x, 3.8, TAISHAN.z5SAM.z);
  group.add(samLight);
  addProp('flood_lights', -17.5, 0, 92, 0.6, 1.25);
  addProp('flood_lights',  17.5, 0, 92, -0.6, 1.25);
  addProp('mil_crate', -4.2, 0, 94, 0.3, 1.15);
  addProp('ammo_box', -3.0, 0, 94.5, -0.2, 1.1);
  addProp('barrel', 4.6, 0, 94.2, 0.4, 1.05);
  addProp('pallet', 5.2, 0, 113.0, 0.1, 1.15);

  // Zone 5 -> Zone 6 Bow Wave-Breaker Bulkhead & Physical Blast Gate #5 (Z = +116)
  b.wall('hull', 'x', 116, -20.0, 20.0, 0, 4.8, 0.9, [{ at: 0, w: 6.4, h: 3.8 }]);
  addBlastGate('g56', 0, 0, 116, 6.4, 3.78, 0);
  addSign('05 号船艏防浪闸 · 船艏甲板', 'BOW BULKHEAD GATE 05 · HELIDECK ACCESS', 0, 4.45, 115.48, Math.PI, '#c25248', 3.4, 0.76);

  // =========================================================================
  // ZONE 6: 船艏撤离停机坪 · 终局死守 (Z: +116..+138, Tapered Forecastle, Y: 0.0 / +1.2)
  // =========================================================================
  b.box('deck', 0, -0.8, 121.0, 36.0, 0.8, 10.0, { road: true });
  b.box('deck', 0, -0.8, 129.0, 24.0, 0.8, 8.0,  { road: true });
  b.box('deck', 0, -0.8, 135.2, 13.0, 0.8, 5.4,  { road: true });

  // Raised Circular Extraction Helipad (R=7.0m, Y=+1.2m at Z=126.0) + 3-Way Gentle Access Stairs (South + Port + Starboard) + Beacons!
  b.cyl('deck', 0, 0.0, 126.0, 7.0, 1.2, 32, true, 'metal');
  b.stairs('z', 0, 117.4, 119.8, 0.0, 1.2, 4.8, false);      // Gentle 2.4m South Main Ramp (1.0m clear vestibule from Gate #5!)
  b.stairs('x', 126.0, -9.2, -6.7, 0.0, 1.2, 3.4, false);    // Port Flanking Helipad Ramp
  b.stairs('x', 126.0,  9.2,  6.7, 0.0, 1.2, 3.4, false);    // Starboard Flanking Helipad Ramp
  b.box('hazard', -2.1, 1.21, 126.0, 0.72, 0.03, 5.2, { solid: false });
  b.box('hazard',  2.1, 1.21, 126.0, 0.72, 0.03, 5.2, { solid: false });
  b.box('hazard',  0.0, 1.21, 126.0, 4.4,  0.03, 0.72, { solid: false });
  for (let i = 0; i < 8; i++) {
    const a = i * (Math.PI * 2 / 8);
    const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.14, 10), lampWarmMat);
    bm.position.set(Math.cos(a) * 6.6, 1.28, 126.0 + Math.sin(a) * 6.6);
    group.add(bm);
  }
  const padLight = new THREE.PointLight(0xffcc72, 46, 38, 1.35);
  padLight.position.set(0, 7.5, 126.0);
  group.add(padLight);

  // 360° Defense Ring Cover (wide clearance outside Port/Starboard helipad stairs!), Aviation Refueling Skid, Anchor Chains & Windlasses!
  b.cover(-11.2, 0, 120.8, 1.0, 4.2, false, 0.16);
  b.cover( 11.2, 0, 120.8, 1.0, 4.2, false, -0.16);
  b.cover(-10.8, 0, 129.2, 3.0, 1.0, true, 0.42);
  b.cover( 10.8, 0, 129.2, 3.0, 1.0, true, -0.42);
  addProp('sandbags', -9.8, 0, 120.8, H + 0.16, 1.1);
  addProp('sandbags',  9.8, 0, 120.8, H - 0.16, 1.1);
  addProp('searchlight', -12.6, 0, 119.5, 0.5, 1.25);
  addProp('searchlight',  12.6, 0, 119.5, -0.5, 1.25);
  addProp('mil_crate', -7.2, 0, 118.2, 0.2, 1.15);
  addProp('ammo_box',   7.2, 0, 118.2, -0.2, 1.15);
  // Starboard Helideck Aviation Jet-A1 Fuel Skid + Fire-Fighting Foam Monitor Turret!
  b.box('steel', 13.6, 0.0, 123.5, 2.2, 0.22, 3.8, { solid: false });
  const fuelTank = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.8, 14), pbr.hazard);
  fuelTank.rotation.x = H;
  fuelTank.position.set(13.6, 0.92, 123.5);
  group.add(fuelTank);
  b.cyl('pipeRed', 12.2, 0.0, 125.2, 0.16, 1.15, 10, false); // Foam fire monitor pedestal
  b.cyl('steel',   12.2, 1.15, 125.2, 0.08, 0.7, 8, false);
  // Port Helideck Illuminated Windsock Mast & Weather Sensor Tower!
  b.cyl('steel', -13.6, 0.0, 123.8, 0.09, 4.6, 8, false);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.45, 10, 1, true), pbr.pipeRed);
  sock.rotation.z = H;
  sock.position.set(-12.9, 4.35, 123.8);
  group.add(sock);
  // Bow Forecastle Mooring Bollards, Heavy Anchor Chains & Wave-Breaker SOLAS Lifebuoys
  for (const sx of [-1, 1]) {
    b.cyl('steel', sx * 8.2, 0, 130.6, 0.22, 0.68, 10, false);
    b.cyl('hazard', sx * 8.2, 0.66, 130.6, 0.25, 0.08, 10, false);
    const bowRing = new THREE.Mesh(lifebuoyGeo, pbr.pipeRed);
    bowRing.position.set(sx * 6.0, 1.6, 116.52);
    group.add(bowRing);
    // Heavy steel anchor chain running from windlass forward to bow hawsepipe
    for (let k = 0; k < 6; k++) {
      b.box('steel', sx * (3.6 - k * 0.22), 0.12, 135.2 + k * 0.36, 0.24, 0.14, 0.34, { solid: false });
    }
  }
  cloneRaw('ship_windlass', -3.6, 0, 134.8, 0, 0.85);
  cloneRaw('ship_windlass',  3.6, 0, 134.8, 0, 0.85);
  world.addBox(-3.6, 0.8, 134.8, 1.6, 0.8, 1.2, 0, 'metal');
  world.addBox( 3.6, 0.8, 134.8, 1.6, 0.8, 1.2, 0, 'metal');
  b.cyl('steel', 0, 0, 137.0, 0.16, 7.5, 10, false);
  // Sign gantry stanchions cleanly outside the twin anchor windlasses (±3.6 ± 1.6 -> clear at ±5.8!)
  b.box('steel', -5.8, 0, 132.4, 0.24, 4.6, 0.24);
  b.box('steel',  5.8, 0, 132.4, 0.24, 4.6, 0.24);
  b.box('steel',  0.0, 4.45, 132.4, 11.8, 0.22, 0.24, { solid: false });
  addSign('泰山号 · 船艏 H-06 起降平台', 'M/V TAISHAN · BOW HELIDECK · MAX 14T', 0, 4.1, 132.4, Math.PI, '#c25248', 3.2, 0.72);

  // =========================================================================
  // 2. 3A CAMERA-WRAPPED GPU TYPHOON RAIN + DECK SPLASH CROWNS + SQUALL MIST
  // =========================================================================
  const rain = new THREE.Group();
  const rainUniforms = {
    uTime: { value: 0 },
    uLightning: stormLightningUniform,
  };

  // --- Layer A: 3,800 Camera-Billboarding Velocity-Stretched Specular Rain Ribbon Quads ---
  // Wraps in a 48m × 24m × 48m box around cameraPosition on the GPU so rain is always dense everywhere along the 276m ship!
  const RAIN_N = 3800;
  const rSeeds = new Float32Array(RAIN_N * 4 * 3);
  const rCorners = new Float32Array(RAIN_N * 4 * 3); // (u in -1..1, v in 0..1, speedFactor)
  const rIdx = new Uint32Array(RAIN_N * 6);
  for (let i = 0; i < RAIN_N; i++) {
    const sx = (Math.random() - 0.5) * 48.0;
    const sy = (Math.random() - 0.5) * 24.0;
    const sz = (Math.random() - 0.5) * 48.0;
    const spd = 0.78 + Math.random() * 0.52;
    const v0 = i * 4;
    for (let c = 0; c < 4; c++) {
      rSeeds[(v0 + c) * 3] = sx;
      rSeeds[(v0 + c) * 3 + 1] = sy;
      rSeeds[(v0 + c) * 3 + 2] = sz;
    }
    rCorners[v0 * 3] = -1; rCorners[v0 * 3 + 1] = 0; rCorners[v0 * 3 + 2] = spd;
    rCorners[(v0 + 1) * 3] = 1; rCorners[(v0 + 1) * 3 + 1] = 0; rCorners[(v0 + 1) * 3 + 2] = spd;
    rCorners[(v0 + 2) * 3] = 1; rCorners[(v0 + 2) * 3 + 1] = 1; rCorners[(v0 + 2) * 3 + 2] = spd;
    rCorners[(v0 + 3) * 3] = -1; rCorners[(v0 + 3) * 3 + 1] = 1; rCorners[(v0 + 3) * 3 + 2] = spd;
    const ii = i * 6;
    rIdx[ii] = v0; rIdx[ii + 1] = v0 + 1; rIdx[ii + 2] = v0 + 2;
    rIdx[ii + 3] = v0; rIdx[ii + 4] = v0 + 2; rIdx[ii + 5] = v0 + 3;
  }
  const rainStreakGeo = new THREE.BufferGeometry();
  rainStreakGeo.setAttribute('position', new THREE.BufferAttribute(rSeeds, 3));
  rainStreakGeo.setAttribute('aCorner', new THREE.BufferAttribute(rCorners, 3));
  rainStreakGeo.setIndex(new THREE.BufferAttribute(rIdx, 1));
  const rainStreakMat = new THREE.ShaderMaterial({
    uniforms: rainUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      attribute vec3 aCorner;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vWarmth;

      void main() {
        float spd = aCorner.z;
        vec3 box = vec3(48.0, 24.0, 48.0);
        // Wind-driven typhoon rain fall vector (-6.5, -31.0, -4.2) m/s
        vec3 fallVel = vec3(-6.4, -31.0, -4.2) * spd;
        vec3 rel = mod(position + fallVel * uTime - cameraPosition + 0.5 * box, box) - 0.5 * box;
        vec3 dropCenter = cameraPosition + rel;

        // Cull drops that fall inside sealed Superstructure (Z: -64..-20, |X| < 19.3, Y < 12.2) or Engine Room (Z: 36..82, Y < 0.0)
        bool inSuper = (dropCenter.z > -63.8 && dropCenter.z < -20.2 && abs(dropCenter.x) < 19.3 && dropCenter.y < 12.2);
        bool inEngine = (dropCenter.z > 36.0 && dropCenter.z < 82.0 && dropCenter.y < 0.0);
        if (inSuper || inEngine || dropCenter.y < -6.2) {
          vAlpha = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        vec3 fallDir = normalize(fallVel);
        vec3 toCam = normalize(cameraPosition - dropCenter);
        vec3 side = normalize(cross(fallDir, toCam));
        float streakLen = 1.65 * spd;
        float halfW = 0.015 * (0.7 + 0.3 * spd);
        vec3 worldP = dropCenter + fallDir * (aCorner.y - 0.5) * streakLen + side * aCorner.x * halfW;

        float dist = length(rel);
        float edgeFade = smoothstep(23.5, 11.0, max(abs(rel.x), abs(rel.z))) * smoothstep(11.8, 6.0, abs(rel.y));
        float nearFade = smoothstep(0.65, 2.2, dist);
        // Warm sodium floodlight illumination near ship deck (|X| < 19.5, Y in 0..8m)
        vWarmth = smoothstep(22.0, 4.0, abs(worldP.x)) * smoothstep(11.0, 1.5, abs(worldP.y - 3.5));
        vUv = vec2(aCorner.x * 0.5 + 0.5, aCorner.y);
        vAlpha = edgeFade * nearFade * (0.36 + 0.24 * spd);
        gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uLightning;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vWarmth;

      void main() {
        if (vAlpha <= 0.002) discard;
        // Tapered raindrop streak profile: bright leading droplet head (vUv.y -> 1.0) + soft motion-blurred tail
        float radial = 1.0 - abs(vUv.x * 2.0 - 1.0);
        radial = pow(max(0.0, radial), 1.45);
        float axial = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.72, vUv.y) * (0.45 + 0.85 * vUv.y);
        vec3 coolRain = vec3(0.62, 0.80, 0.98) + vec3(0.55, 0.72, 1.10) * uLightning;
        vec3 warmRain = vec3(1.05, 0.82, 0.55);
        vec3 col = mix(coolRain, warmRain, vWarmth * 0.48);
        float a = radial * axial * vAlpha * (1.0 + uLightning * 0.55);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const rainStreaksMesh = new THREE.Mesh(rainStreakGeo, rainStreakMat);
  rainStreaksMesh.frustumCulled = false;
  rain.add(rainStreaksMesh);

  // --- Layer B: 1,500 Fine Deck Impact Micro-Splashes (Strictly on Ground Deck Y=0.015m, Never Floating in Air!) ---
  const SPLASH_N = 1500;
  const sSeeds = new Float32Array(SPLASH_N * 4 * 3);
  const sCorners = new Float32Array(SPLASH_N * 4 * 3); // (u in -1..1, v in 0..1, phaseSeed)
  const sIdx = new Uint32Array(SPLASH_N * 6);
  for (let i = 0; i < SPLASH_N; i++) {
    const sx = (Math.random() - 0.5) * 26.0;
    const sy = 0.012;
    const sz = (Math.random() - 0.5) * 26.0;
    const phase = Math.random();
    const v0 = i * 4;
    for (let c = 0; c < 4; c++) {
      sSeeds[(v0 + c) * 3] = sx;
      sSeeds[(v0 + c) * 3 + 1] = sy;
      sSeeds[(v0 + c) * 3 + 2] = sz;
    }
    sCorners[v0 * 3] = -1; sCorners[v0 * 3 + 1] = 0; sCorners[v0 * 3 + 2] = phase;
    sCorners[(v0 + 1) * 3] = 1; sCorners[(v0 + 1) * 3 + 1] = 0; sCorners[(v0 + 1) * 3 + 2] = phase;
    sCorners[(v0 + 2) * 3] = 1; sCorners[(v0 + 2) * 3 + 1] = 1; sCorners[(v0 + 2) * 3 + 2] = phase;
    sCorners[(v0 + 3) * 3] = -1; sCorners[(v0 + 3) * 3 + 1] = 1; sCorners[(v0 + 3) * 3 + 2] = phase;
    const ii = i * 6;
    sIdx[ii] = v0; sIdx[ii + 1] = v0 + 1; sIdx[ii + 2] = v0 + 2;
    sIdx[ii + 3] = v0; sIdx[ii + 4] = v0 + 2; sIdx[ii + 5] = v0 + 3;
  }
  const splashGeo = new THREE.BufferGeometry();
  splashGeo.setAttribute('position', new THREE.BufferAttribute(sSeeds, 3));
  splashGeo.setAttribute('aCorner', new THREE.BufferAttribute(sCorners, 3));
  splashGeo.setIndex(new THREE.BufferAttribute(sIdx, 1));
  const splashMat = new THREE.ShaderMaterial({
    uniforms: rainUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      attribute vec3 aCorner;
      varying vec2 vUv;
      varying float vLife;
      varying float vAlpha;

      void main() {
        float seed = aCorner.z;
        float rate = 3.8 + seed * 2.2;
        float life = fract(uTime * rate + seed * 17.3);
        vec2 boxXZ = vec2(26.0, 26.0);
        float cycle = floor(uTime * rate + seed * 17.3);
        vec2 cycleOff = vec2(fract(sin(cycle * 12.9898 + seed * 78.233) * 43758.5453), fract(cos(cycle * 39.346 + seed * 19.17) * 23421.631)) - 0.5;
        vec2 relXZ = mod(position.xz + cycleOff * 2.4 - cameraPosition.xz + 0.5 * boxXZ, boxXZ) - 0.5 * boxXZ;
        vec3 baseP = vec3(cameraPosition.x + relXZ.x, position.y, cameraPosition.z + relXZ.y);

        // Only splash on open exterior ship decks (|X| < 19.0, and either Stern Z: -135..-64.4 or Foredeck/Bow Z: 82.4..135.5)
        bool onOpenDeck = abs(baseP.x) < 19.0 && ((baseP.z > -135.0 && baseP.z < -64.4) || (baseP.z > 82.4 && baseP.z < 135.5));
        if (!onOpenDeck || abs(cameraPosition.y) > 4.5) {
          vAlpha = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        vec3 toCam = cameraPosition - baseP;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        // Realistic fine 3.5cm-5.5cm water micro-splash burst
        float sz = (0.022 + 0.036 * sin(life * 3.14159)) * (0.8 + 0.4 * seed);
        vec3 worldP = baseP + right * aCorner.x * sz + vec3(0.0, aCorner.y * sz * 0.95, 0.0);

        vUv = vec2(aCorner.x * 0.5 + 0.5, aCorner.y);
        vLife = life;
        vAlpha = (1.0 - smoothstep(8.0, 13.0, max(abs(relXZ.x), abs(relXZ.y)))) * (1.0 - life) * smoothstep(0.0, 0.15, life) * 0.34;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uLightning;
      varying vec2 vUv;
      varying float vLife;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.002) discard;
        vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
        float d = length(vec2(p.x * 0.85, p.y - 0.35 * vLife));
        float mist = exp(-d * d * 7.5) * smoothstep(0.0, 0.25, vUv.y);
        vec3 col = vec3(0.72, 0.86, 1.0) + vec3(0.45, 0.60, 0.90) * uLightning;
        gl_FragColor = vec4(col, mist * vAlpha);
      }
    `,
  });
  const splashCrownsMesh = new THREE.Mesh(splashGeo, splashMat);
  splashCrownsMesh.frustumCulled = false;
  rain.add(splashCrownsMesh);

  // --- Layer C: 140 Wind-Whipped Typhoon Squall Spray Sheets Drifting Across Deck ---
  const MIST_N = 140;
  const mSeeds = new Float32Array(MIST_N * 4 * 3);
  const mCorners = new Float32Array(MIST_N * 4 * 3);
  const mIdx = new Uint32Array(MIST_N * 6);
  for (let i = 0; i < MIST_N; i++) {
    const sx = (Math.random() - 0.5) * 56.0;
    const sy = 0.8 + Math.random() * 7.5;
    const sz = (Math.random() - 0.5) * 56.0;
    const spd = 0.75 + Math.random() * 0.55;
    const v0 = i * 4;
    for (let c = 0; c < 4; c++) {
      mSeeds[(v0 + c) * 3] = sx;
      mSeeds[(v0 + c) * 3 + 1] = sy;
      mSeeds[(v0 + c) * 3 + 2] = sz;
    }
    mCorners[v0 * 3] = -1; mCorners[v0 * 3 + 1] = -1; mCorners[v0 * 3 + 2] = spd;
    mCorners[(v0 + 1) * 3] = 1; mCorners[(v0 + 1) * 3 + 1] = -1; mCorners[(v0 + 1) * 3 + 2] = spd;
    mCorners[(v0 + 2) * 3] = 1; mCorners[(v0 + 2) * 3 + 1] = 1; mCorners[(v0 + 2) * 3 + 2] = spd;
    mCorners[(v0 + 3) * 3] = -1; mCorners[(v0 + 3) * 3 + 1] = 1; mCorners[(v0 + 3) * 3 + 2] = spd;
    const ii = i * 6;
    mIdx[ii] = v0; mIdx[ii + 1] = v0 + 1; mIdx[ii + 2] = v0 + 2;
    mIdx[ii + 3] = v0; mIdx[ii + 4] = v0 + 2; mIdx[ii + 5] = v0 + 3;
  }
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mSeeds, 3));
  mistGeo.setAttribute('aCorner', new THREE.BufferAttribute(mCorners, 3));
  mistGeo.setIndex(new THREE.BufferAttribute(mIdx, 1));
  const mistMat = new THREE.ShaderMaterial({
    uniforms: rainUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      attribute vec3 aCorner;
      varying vec2 vUv;
      varying float vAlpha;

      void main() {
        float spd = aCorner.z;
        vec2 boxXZ = vec2(56.0, 56.0);
        vec2 windVel = vec2(-11.5, -7.2) * spd;
        vec2 relXZ = mod(position.xz + windVel * uTime - cameraPosition.xz + 0.5 * boxXZ, boxXZ) - 0.5 * boxXZ;
        vec3 center = vec3(cameraPosition.x + relXZ.x, position.y + sin(uTime * 1.4 + spd * 6.0) * 0.35, cameraPosition.z + relXZ.y);

        bool inSuper = (center.z > -64.5 && center.z < -19.5 && abs(center.x) < 20.0 && center.y < 12.6);
        if (inSuper || cameraPosition.y < -0.5) {
          vAlpha = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        vec3 toCam = normalize(cameraPosition - center);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 worldP = center + right * aCorner.x * 3.8 + vec3(0.0, aCorner.y * 1.4, 0.0);
        float dist = length(cameraPosition - center);
        vUv = aCorner.xy;
        vAlpha = smoothstep(27.0, 12.0, max(abs(relXZ.x), abs(relXZ.y))) * smoothstep(2.5, 7.5, dist) * 0.042;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uLightning;
      varying vec2 vUv;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.001) discard;
        float r2 = dot(vUv, vUv);
        float mask = exp(-r2 * 2.4) * smoothstep(1.0, 0.2, r2);
        vec3 col = vec3(0.55, 0.72, 0.90) + vec3(0.55, 0.75, 1.15) * uLightning;
        gl_FragColor = vec4(col, mask * vAlpha);
      }
    `,
  });
  const squallMistMesh = new THREE.Mesh(mistGeo, mistMat);
  squallMistMesh.frustumCulled = false;
  rain.add(squallMistMesh);
  rain.traverse((o) => { o.userData.noAo = true; });

  group.add(rain);

  // Merge all batched static architecture + recursively merge ALL static Blender & Photogrammetry props by material!
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

  let alarmOn = false;
  let floodTargetY = -7.2;

  const ship: ShipRemakeDynamic = {
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
    aa1Group, aa1Light,
    samGroup, samLight,
    bridgeLight, epsilonLight, powerLight, valveLight,
    floodWater, engineLights, alarmLights,
    radarBar, heli, heliRotor, heliTailRotor, heliRopes, rain,
    destroyAA1() { aa1Group.visible = false; aa1Light.intensity = 0; },
    destroySAM() { samGroup.visible = false; samLight.intensity = 0; },
    setBridgeHacked() { bridgeLight.color.setHex(0x2ee880); },
    setEpsilonHacked(progress, done) {
      epsilonLight.color.setHex(done ? 0x2ee880 : progress > 0 ? 0x38d8ff : 0xff3828);
    },
    setEngineBlackout(blackout) {
      for (const l of engineLights) l.intensity = blackout ? 4 : 34;
    },
    setFloodLevel(y) { floodTargetY = y; },
    setPowerRestored() {
      powerLight.color.setHex(0x2ee880);
      for (const l of engineLights) l.intensity = 34;
    },
    setValveClosed() {
      valveLight.color.setHex(0x2ee880);
      valveWheel.rotation.z = 2.6;
      floodTargetY = -7.0;
    },
    setAlarm(on) {
      alarmOn = on;
      if (!on) for (const al of alarmLights) al.intensity = 0;
    },
    setIndoors(inside) {
      rain.visible = !inside;
    },
  };

  const map: MapInfo = {
    half: 146,
    roads: b.roads,
    ground: '#0c1e30',
    road: '#3d4a58',
  };

  return {
    id: 'highseas',
    group,
    ship,
    playerSpawn: { x: TAISHAN.spawn.x, z: TAISHAN.spawn.z, yaw: TAISHAN.spawn.yaw },
    spawnPoints: [
      { x: 0, z: -124 }, { x: 0, z: -56 }, { x: 0, z: -16 },
      { x: 0, z: 40 }, { x: 0, z: 93 }, { x: 0, z: 120 },
    ],
    barrels: [
      { x: -3.5, y: 0, z: -90 }, { x: 4.0, y: 0, z: -78 },
      { x: -5.0, y: -6, z: 12 }, { x: 5.0, y: -6, z: 18 },
      { x: -5.8, y: 0, z: 100.8 }, { x: 5.8, y: 0, z: 106.8 },
      { x: -7.5, y: 0, z: 119.4 }, { x: 7.5, y: 0, z: 119.4 },
    ],
    supplies: [
      { x: -6.5, z: -118 }, { x: 8.5, z: -42 }, { x: 0, z: -15 }, { x: -6.2, z: 92.5 },
    ],
    fires: [],
    plumes: [],
    bound: 142,
    map,
    targets: [],
    menuCamera(t, cam) {
      // Iconic 3/4 Starboard-Bow Hero Cinematography:
      // Frames the pointed prow & red boot-top slicing through storm waves, towering 18m ochre gantry cranes,
      // colorful stacked container bays, glowing white 4-deck superstructure, and lit crimson-and-white funnels!
      const sway = Math.sin(t * 0.12);
      const cx = 74 + sway * 10;
      const cy = 18.5 + Math.sin(t * 0.20) * 2.2;
      const cz = 114 + Math.cos(t * 0.10) * 26;
      cam.position.set(cx, cy, cz);
      cam.lookAt(-10, 7.5, 18);
    },
    update(dt, t) {
      // Drive live GPU concentric raindrop ripples on all wet exterior steel decks!
      rainRippleUniform.value.set(t, 1.0);
      // Drive 3A Gerstner Storm Ocean & 3-Layer GPU Camera-Wrapped Typhoon Rain / Deck Splashes / Squall Mist
      seaUniforms.uTime.value = t;
      rainUniforms.uTime.value = t;
      // Spin radar scanner bar, helicopter rotors & gentle AA/SAM fire-control tracking sweep
      if (radarBar) radarBar.rotation.y += dt * 1.6;
      if (heliRotor) heliRotor.rotation.y += dt * 28;
      if (heliTailRotor) heliTailRotor.rotation.x += dt * 44;
      const aaHead = aa1Group.getObjectByName('TurretHead');
      if (aaHead && aa1Group.visible) aaHead.rotation.y = Math.sin(t * 0.45) * 0.24;
      const samHead = samGroup.getObjectByName('TurretHead');
      if (samHead && samGroup.visible) samHead.rotation.y = Math.sin(t * 0.38 + 1.2) * 0.22;
      // Smooth motorized physical watertight blast gates (horizontal pocket slide!)
      for (const list of Object.values(gates)) {
        for (const gt of list) {
          const target = gt.isOpen ? 1 : 0;
          if (Math.abs(gt.openT - target) > 0.002) {
            gt.openT += Math.sign(target - gt.openT) * Math.min(Math.abs(target - gt.openT), dt * 0.68);
            const e = gt.openT * gt.openT * (3 - 2 * gt.openT);
            gt.mesh.position.x = gt.closedX + (gt.openX - gt.closedX) * e;
            gt.mesh.position.z = gt.closedZ + (gt.openZ - gt.closedZ) * e;
          }
        }
      }
      // Rising/draining Engine Room floodwater
      if (Math.abs(floodWater.position.y - floodTargetY) > 0.01) {
        floodWater.position.y += Math.sign(floodTargetY - floodWater.position.y) * Math.min(Math.abs(floodTargetY - floodWater.position.y), dt * 0.35);
      }
      // Pulsing emergency red alarms during Zone 4 crisis
      if (alarmOn) {
        const pulse = 18 + Math.sin(t * 7.5) * 16;
        for (const al of alarmLights) al.intensity = Math.max(0, pulse);
      }
      // Sweep distant destroyer searchlight across the stormy sky
      beam.rotation.y = Math.sin(t * 0.35) * 0.45;
    },
  };
}
