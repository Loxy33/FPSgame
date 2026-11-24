import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, damp, lerp } from '../core/utils';
import { assets } from '../render/assets';

/**
 * Enemy mercenaries, allied special-ops squadmates, and unarmed civilian hostages:
 * 7 distinct high-poly (~60k–75k tri, 2K PBR) CC0 24-bone rigged character models with:
 * - Strict 100% disjoint model separation between Allies, Hostages, and Hostiles
 * - Skin-preserving PBR uniform remapping + bone-mounted 3D faction tactical gear
 *   (Allied Quad-NVG + pulsing cyan IR/IFF strobes + role packs vs Hostile crimson optics/armbands/rigs)
 * - Rich AAA procedural animation suite (idle breathing & head scan, patrol walk, tactical sprint,
 *   CQB strafe, kneeling cover crouch, corner lean, 3-stage reload, flashbang stunned, unarmed cowering
 *   hostage, helicopter cabin seated pose, tactical hand signal, bow-finale reach, combat roll & 4-variant death).
 */

export type SoldierKind =
  | 'rifleman' | 'rusher' | 'heavy' | 'sniper' | 'breacher' | 'specops'
  | 'boss_kronos' | 'boss_viper' | 'boss_tyrant';
export type FriendlyKind =
  | 'instructor' | 'medic' | 'guard' | 'shooter' | 'eod'
  | 'marine_lead' | 'marine_heavy' | 'marine_tech' | 'marine_player'
  | 'hostage_crew' | 'hostage_captain';
export type ModelKind = SoldierKind | FriendlyKind | 'friendly';

export function isBossKind(kind: ModelKind): boolean {
  return kind === 'boss_kronos' || kind === 'boss_viper' || kind === 'boss_tyrant';
}

export type SoldierAction =
  | 'combat'
  | 'reload'
  | 'stunned'
  | 'hostage'
  | 'helisit'
  | 'signal'
  | 'reach'
  | 'briefing';

type CharAsset =
  | 'soldier'
  | 'char_officer'
  | 'char_heavy'
  | 'char_breacher'
  | 'char_specops'
  | 'char_medic'
  | 'char_crew'
  | 'hero_gao'
  | 'hero_tiechui'
  | 'hero_linfeng'
  | 'hero_bailing'
  | 'boss_kronos'
  | 'boss_tyrant';

type RemapMode =
  | 'natural'
  | 'pla_marine'
  | 'pla_lead'
  | 'pla_heavy'
  | 'pla_spec'
  | 'pla_tech'
  | 'allied_olive'
  | 'merc_stealth'
  | 'merc_arid'
  | 'merc_pmc'
  | 'merc_juggernaut'
  | 'merc_breacher'
  | 'boss_kronos'
  | 'boss_viper'
  | 'boss_tyrant';

/**
 * STRICT DISJOINT MODEL ASSIGNMENT + BESPOKE HERO & BOSS KITS:
 * - Protagonist Squad (4 distinct heroes): marine_lead, marine_heavy, marine_player, marine_tech
 * - Bosses (3 bespoke sculpted juggernauts): boss_kronos, boss_viper, boss_tyrant
 */
const MODEL_OF_KIND: Record<ModelKind, CharAsset> = {
  // Friendly forces: User-generated custom 3D Hero models (03_高远, 04_周铁, 01_百灵) + 02_林峰
  marine_lead: 'hero_gao',        // 洞幺·老高: 03_高远_参考图_全身.glb
  marine_heavy: 'hero_tiechui',   // 洞二·铁锤: 04_周铁_参考图_全身.glb
  marine_player: 'hero_linfeng',  // 洞三·林峰: 暗夜特战主角
  marine_tech: 'hero_bailing',    // 洞四·百灵: 01_百灵_早期测试_BAILING图.glb
  friendly: 'soldier',
  shooter: 'soldier',
  guard: 'soldier',
  eod: 'soldier',
  instructor: 'char_officer',
  medic: 'char_medic',
  // Unarmed civilian hostages
  hostage_crew: 'char_crew',
  hostage_captain: 'char_officer',
  // Hostile mercenaries & 3 COMPLETELY UNIQUE Boss models (ZERO recolors!)
  rifleman: 'char_specops',
  rusher: 'char_specops',
  sniper: 'char_specops',
  specops: 'char_heavy',
  breacher: 'char_breacher',
  heavy: 'char_heavy',
  boss_kronos: 'boss_kronos',     // 一关 BOSS·铁锚克洛诺斯: 全新巨型战舰重甲处刑机甲
  boss_viper: 'char_heavy',       // 二关 BOSS·指挥官毒蛇: 沙漠碳纤维隐身外骨骼
  boss_tyrant: 'boss_tyrant',     // 海克斯 BOSS·赤沙暴君: 全新黑金猩红重甲双角战神
};

const REMAP_OF_KIND: Record<ModelKind, RemapMode> = {
  marine_lead: 'natural',
  marine_heavy: 'natural',
  marine_player: 'natural',
  marine_tech: 'natural',
  friendly: 'allied_olive',
  shooter: 'allied_olive',
  guard: 'allied_olive',
  eod: 'allied_olive',
  instructor: 'natural',
  medic: 'natural',
  hostage_crew: 'natural',
  hostage_captain: 'natural',
  rifleman: 'merc_arid',
  rusher: 'merc_stealth',
  sniper: 'merc_arid',
  specops: 'merc_pmc',
  breacher: 'merc_breacher',
  heavy: 'merc_juggernaut',
  boss_kronos: 'natural',
  boss_viper: 'boss_viper',
  boss_tyrant: 'natural',
};

export function isHostileKind(kind: ModelKind): boolean {
  return (
    kind === 'rifleman' || kind === 'rusher' || kind === 'heavy' ||
    kind === 'sniper' || kind === 'breacher' || kind === 'specops' ||
    isBossKind(kind)
  );
}

export function isHostageKind(kind: ModelKind): boolean {
  return kind === 'hostage_crew' || kind === 'hostage_captain';
}

const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();

// kinematic segments
const HIPS = 0, TORSO = 1, HEAD = 2, ARM_U = 3, ARM_L = 5, LEG_U = 7, LEG_L = 9, FOOT = 11, SEGS = 13;
const SEG_OF: Record<string, number> = {
  Hips: HIPS, Spine02: TORSO, Spine01: TORSO, Spine: TORSO, LeftShoulder: TORSO, RightShoulder: TORSO, neck: TORSO,
  Head: HEAD, head_end: HEAD, headfront: HEAD,
  RightArm: ARM_U, LeftArm: ARM_U + 1, RightForeArm: ARM_L, RightHand: ARM_L, LeftForeArm: ARM_L + 1, LeftHand: ARM_L + 1,
  RightUpLeg: LEG_U, LeftUpLeg: LEG_U + 1, RightLeg: LEG_L, LeftLeg: LEG_L + 1,
  RightFoot: FOOT, RightToeBase: FOOT, LeftFoot: FOOT + 1, LeftToeBase: FOOT + 1,
};

function segOfBone(name: string): number {
  if (name in SEG_OF) return SEG_OF[name];
  if (/^RightHand|RightThumb|RightIndex|RightMiddle|RightRing|RightPinky/i.test(name)) return ARM_L;
  if (/^LeftHand|LeftThumb|LeftIndex|LeftMiddle|LeftRing|LeftPinky/i.test(name)) return ARM_L + 1;
  if (/^RightToe/i.test(name)) return FOOT;
  if (/^LeftToe/i.test(name)) return FOOT + 1;
  return TORSO;
}

interface ShieldAssets {
  body: THREE.BufferGeometry;
  frame: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  armorMat: THREE.MeshStandardMaterial;
  metalMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshStandardMaterial;
}

interface GearAssets {
  darkMetal: THREE.MeshStandardMaterial;
  tacticalPack: THREE.MeshStandardMaterial;
  allyBand: THREE.MeshStandardMaterial;
  allyGlow: THREE.MeshStandardMaterial;
  allyNvgLens: THREE.MeshStandardMaterial;
  enemyBand: THREE.MeshStandardMaterial;
  enemyVisor: THREE.MeshStandardMaterial;
  enemyPack: THREE.MeshStandardMaterial;
  nvgBridge: THREE.BufferGeometry;
  nvgTube: THREE.BufferGeometry;
  nvgLens: THREE.BufferGeometry;
  strobeHousing: THREE.BufferGeometry;
  strobeLed: THREE.BufferGeometry;
  armBand: THREE.BufferGeometry;
  packStd: THREE.BufferGeometry;
  packHeavy: THREE.BufferGeometry;
  chestPlate: THREE.BufferGeometry;
  antenna: THREE.BufferGeometry;
  chemlight: THREE.BufferGeometry;
  goggleFrame: THREE.BufferGeometry;
  goggleLens: THREE.BufferGeometry;
  curvedVisor: THREE.BufferGeometry;
}

interface WeaponPack {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

interface Rig {
  geo: THREE.BufferGeometry;
  mats: Partial<Record<ModelKind, THREE.Material>>;
  texCache: Partial<Record<RemapMode, THREE.Texture>>;
  baseMat: THREE.MeshStandardMaterial;
  seg: number[];
  restInv: THREE.Matrix4[];
  hipY: number;
  ankleY: number;
  torsoOff: THREE.Vector3;
  headOff: THREE.Vector3;
  shoulders: THREE.Vector3[];
  hipsJ: THREE.Vector3[];
  arm1: number; arm2: number; leg1: number; leg2: number;
}

const RIGS: Partial<Record<CharAsset, Rig>> = {};
let GUNS: Record<string, WeaponPack> | null = null;
let SHIELD: ShieldAssets | null = null;
let GEAR: GearAssets | null = null;

function getShieldAssets(): ShieldAssets {
  if (SHIELD) return SHIELD;
  SHIELD = {
    body: new RoundedBoxGeometry(0.48, 0.88, 0.032, 3, 0.012),
    frame: new RoundedBoxGeometry(0.28, 0.13, 0.042, 2, 0.008),
    glass: new THREE.BoxGeometry(0.24, 0.09, 0.046),
    armorMat: new THREE.MeshStandardMaterial({ color: 0x181a1e, roughness: 0.46, metalness: 0.34 }),
    metalMat: new THREE.MeshStandardMaterial({ color: 0x3b1f22, roughness: 0.38, metalness: 0.72 }),
    visorMat: new THREE.MeshStandardMaterial({ color: 0x301418, roughness: 0.08, metalness: 0.18, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
  };
  return SHIELD;
}

function getGearAssets(): GearAssets {
  if (GEAR) return GEAR;
  GEAR = {
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x191d22, roughness: 0.42, metalness: 0.72 }),
    tacticalPack: new THREE.MeshStandardMaterial({ color: 0x1e2c36, roughness: 0.78, metalness: 0.12 }),
    allyBand: new THREE.MeshStandardMaterial({
      color: 0x1d88b8, emissive: 0x1690d8, emissiveIntensity: 0.85, roughness: 0.4, metalness: 0.1,
    }),
    allyGlow: new THREE.MeshStandardMaterial({
      color: 0x4ee8ff, emissive: 0x38e4ff, emissiveIntensity: 3.2, roughness: 0.15, metalness: 0.1,
    }),
    allyNvgLens: new THREE.MeshStandardMaterial({
      color: 0x22ffaa, emissive: 0x18e89a, emissiveIntensity: 2.2, roughness: 0.08, metalness: 0.2,
    }),
    enemyBand: new THREE.MeshStandardMaterial({
      color: 0xb81814, emissive: 0xc21410, emissiveIntensity: 0.72, roughness: 0.42, metalness: 0.1,
    }),
    enemyVisor: new THREE.MeshStandardMaterial({
      color: 0xd81010, emissive: 0xe61414, emissiveIntensity: 1.55, roughness: 0.12, metalness: 0.2,
    }),
    enemyPack: new THREE.MeshStandardMaterial({ color: 0x1b191a, roughness: 0.82, metalness: 0.14 }),
    nvgBridge: new RoundedBoxGeometry(0.115, 0.03, 0.048, 2, 0.006),
    nvgTube: new THREE.CylinderGeometry(0.0155, 0.014, 0.068, 10),
    nvgLens: new THREE.CylinderGeometry(0.012, 0.012, 0.008, 10),
    strobeHousing: new RoundedBoxGeometry(0.042, 0.02, 0.052, 2, 0.004),
    strobeLed: new THREE.SphereGeometry(0.013, 10, 8),
    armBand: new THREE.CylinderGeometry(0.064, 0.062, 0.062, 12, 1, true),
    packStd: new RoundedBoxGeometry(0.24, 0.32, 0.11, 2, 0.02),
    packHeavy: new RoundedBoxGeometry(0.28, 0.38, 0.15, 2, 0.024),
    chestPlate: new RoundedBoxGeometry(0.24, 0.25, 0.028, 2, 0.01),
    antenna: new THREE.CylinderGeometry(0.0045, 0.006, 0.42, 6),
    chemlight: new THREE.CylinderGeometry(0.009, 0.009, 0.11, 8),
    goggleFrame: new RoundedBoxGeometry(0.132, 0.038, 0.038, 2, 0.007),
    goggleLens: new THREE.BoxGeometry(0.046, 0.022, 0.01),
    curvedVisor: new RoundedBoxGeometry(0.155, 0.042, 0.058, 2, 0.014),
  };
  GEAR.nvgTube.rotateX(Math.PI / 2);
  GEAR.nvgLens.rotateX(Math.PI / 2);
  return GEAR;
}

function mergeWeapon(scene: THREE.Object3D, fix: THREE.Matrix4, baseMat: THREE.Material, filter?: (name: string) => boolean): WeaponPack {
  scene.updateMatrixWorld(true);
  const list: THREE.BufferGeometry[] = [];
  let gunMat: THREE.Material = baseMat;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (filter && !filter(m.name)) return;
    if (m.name === 'FPArms' || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    const g = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'uv']) {
      if (m.geometry.attributes[a]) g.setAttribute(a, m.geometry.attributes[a].clone());
    }
    g.setIndex(m.geometry.index ? m.geometry.index.clone() : null);
    g.applyMatrix4(m.matrixWorld).applyMatrix4(fix);
    list.push(g);
    if (!gunMat || gunMat === baseMat) gunMat = m.material as THREE.Material;
  });
  const geo = list.length > 0 ? mergeGeometries(list, false) : new THREE.BoxGeometry(0.04, 0.1, 0.6);
  for (const g of list) g.dispose();
  return { geo, mat: gunMat };
}

function getGunsPack(fallbackMat: THREE.Material): Record<string, WeaponPack> {
  if (GUNS) return GUNS;
  const fixRifle = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0.005, 0.06);
  const gunRifle = mergeWeapon(assets.gltf.wpn_m4a1.scene, fixRifle, fallbackMat);

  const fixSniper = new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(0, 0.012, -0.15).scale(new THREE.Vector3(0.85, 0.85, 0.85));
  const gunSniper = mergeWeapon(assets.gltf.wpn_boltrifle.scene, fixSniper, fallbackMat, (name) => !/bolt_b|bullet/i.test(name));

  const fixSmg = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0.01, 0.08).scale(new THREE.Vector3(0.85, 0.85, 0.85));
  const gunSmg = mergeWeapon(assets.gltf.fp_mp5a5.scene, fixSmg, fallbackMat, (name) => !/arms/i.test(name));

  const fixHeavy = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0.005, 0.06).scale(new THREE.Vector3(1.16, 1.16, 1.16));
  const gunHeavy = mergeWeapon(assets.gltf.wpn_m4a1.scene, fixHeavy, fallbackMat);

  const fixPistol = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 0, 0.04);
  const gunPistol = mergeWeapon(assets.gltf.wpn_pistol.scene, fixPistol, fallbackMat, (name) => !/_b$|magazine_empty|bullet/i.test(name));

  GUNS = {
    rifle: gunRifle,
    sniper: gunSniper,
    smg: gunSmg,
    heavy: gunHeavy,
    pistol: gunPistol,
  };
  return GUNS;
}

/**
 * Skin-preserving PBR texture remapper:
 * Recolors uniforms/armor per faction in Canvas2D while leaving human skin tones untouched
 * (so soldiers & breachers never get zombie-tinted faces) and converting firefighter/sci-fi
 * palettes into gritty, photorealistic AAA military/PMC uniforms.
 */
function remapCharTexture(src: THREE.Texture, mode: RemapMode): THREE.Texture {
  if (mode === 'natural' || !src.image) return src;
  const img = src.image as ImageBitmap | HTMLImageElement;
  const w = Math.min(1024, img.width || 1024);
  const h = Math.min(1024, img.height || 1024);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;

  const isSkin = (r: number, g: number, b: number) =>
    r > 108 && g > 68 && b > 44 && r > g + 10 && g > b + 3 && (r - b) < 118 && r < g * 1.72;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;

    if (mode === 'pla_marine' || mode === 'pla_lead' || mode === 'pla_spec') {
      if (!isSkin(r, g, b)) {
        const contrast = (l - 90) * 1.15 + 90;
        const k = clamp(contrast / Math.max(1, l), 0.45, 1.45);
        if (mode === 'pla_lead') {
          // Deep Command Navy Blue & Subtle Steel Slate
          r = clamp(r * 0.46 * k + 10, 0, 255);
          g = clamp(g * 0.72 * k + 16, 0, 255);
          b = clamp(b * 1.16 * k + 24, 0, 255);
        } else if (mode === 'pla_spec') {
          // Protagonist Midnight Spec-Ops Charcoal-Teal Digital
          r = clamp(r * 0.42 * k + 8, 0, 255);
          g = clamp(g * 0.68 * k + 14, 0, 255);
          b = clamp(b * 0.88 * k + 20, 0, 255);
        } else {
          r = clamp(r * 0.50 * k + 8, 0, 255);
          g = clamp(g * 0.80 * k + 14, 0, 255);
          b = clamp(b * 1.14 * k + 20, 0, 255);
        }
      }
    } else if (mode === 'pla_heavy') {
      // Allied Marine Heavy Assault Uniform (Deep Battleship Slate-Navy & Olive-Steel Armor Contrast, Skin Preserved!)
      if (!isSkin(r, g, b)) {
        const contrast = (l - 88) * 1.18 + 88;
        const k = clamp(contrast / Math.max(1, l), 0.45, 1.45);
        r = clamp(r * 0.44 * k + 14, 0, 255);
        g = clamp(g * 0.56 * k + 16, 0, 255);
        b = clamp(b * 0.72 * k + 22, 0, 255);
      }
    } else if (mode === 'pla_tech') {
      // Allied EW Specialist Sleek Tactical Slate-Blue Uniform (Skin Preserved!)
      if (!isSkin(r, g, b)) {
        const contrast = (l - 85) * 1.08 + 85;
        const k = clamp(contrast / Math.max(1, l), 0.45, 1.35);
        r = clamp(r * 0.48 * k + 12, 0, 255);
        g = clamp(g * 0.72 * k + 18, 0, 255);
        b = clamp(b * 1.04 * k + 24, 0, 255);
      }
    } else if (mode === 'boss_kronos' || mode === 'boss_viper' || mode === 'boss_tyrant') {
      // Bespoke High-Contrast Boss Exoskeleton Armor Palettes
      if (b > r * 1.15 && g > r * 1.05 && b > 90) {
        r = 255; g = mode === 'boss_tyrant' ? 112 : 34; b = 20;
      } else if (l > 115) {
        const v = l * 0.24 + 10;
        if (mode === 'boss_viper') {
          // Desert Carbon & Sand Exoskeleton
          r = clamp(v * 1.24 + 16, 0, 255);
          g = clamp(v * 1.04 + 10, 0, 255);
          b = clamp(v * 0.72 + 4, 0, 255);
        } else if (mode === 'boss_tyrant') {
          // Black-Crimson-Gold Warlord Juggernaut
          r = clamp(v * 1.22 + 12, 0, 255);
          g = clamp(v * 0.45 + 4, 0, 255);
          b = clamp(v * 0.42 + 4, 0, 255);
        } else {
          // Kronos Weathered Naval Battleship Gunmetal
          r = clamp(v * 0.88 + 6, 0, 255);
          g = clamp(v * 0.94 + 8, 0, 255);
          b = clamp(v * 1.06 + 10, 0, 255);
        }
      } else {
        r = clamp(r * 0.48 + 6, 0, 255);
        g = clamp(g * 0.44 + 4, 0, 255);
        b = clamp(b * 0.48 + 6, 0, 255);
      }
    } else if (mode === 'allied_olive') {
      if (!isSkin(r, g, b)) {
        r = clamp(r * 0.90, 0, 255);
        g = clamp(g * 0.98, 0, 255);
        b = clamp(b * 0.86, 0, 255);
      }
    } else if (mode === 'merc_stealth') {
      if (!isSkin(r, g, b)) {
        if (r > g * 1.4 && r > b * 1.4 && r > 75) {
          // Boost crimson waist sash for instant hostile silhouette pop
          r = clamp(r * 1.35 + 22, 0, 255);
          g = clamp(g * 0.35, 0, 255);
          b = clamp(b * 0.35, 0, 255);
        } else {
          // Matte obsidian-charcoal covert gear
          r = clamp(l * 0.68 + (r - l) * 0.35, 0, 255);
          g = clamp(l * 0.68 + (g - l) * 0.35, 0, 255);
          b = clamp(l * 0.72 + (b - l) * 0.35, 0, 255);
        }
      }
    } else if (mode === 'merc_arid') {
      if (!isSkin(r, g, b)) {
        if (r > g * 1.4 && r > b * 1.4 && r > 75) {
          r = clamp(r * 1.32 + 18, 0, 255);
          g = clamp(g * 0.38, 0, 255);
          b = clamp(b * 0.36, 0, 255);
        } else {
          // Arid charcoal-tan insurgent/mercenary fatigues
          r = clamp(l * 1.12 + 10, 0, 255);
          g = clamp(l * 0.98 + 6, 0, 255);
          b = clamp(l * 0.80 + 2, 0, 255);
        }
      }
    } else if (mode === 'merc_pmc') {
      // Transform white sci-fi suit -> menacing matte-black & crimson Western PMC tactical armor
      if (b > r * 1.18 && g > r * 1.05 && b > 90) {
        // Cyan visor -> deep glowing crimson
        r = 238; g = 32; b = 24;
      } else if (l > 115) {
        // White armor plates -> dark matte charcoal-gunmetal with cool steel sheen
        const v = l * 0.25 + 8;
        r = clamp(v * 0.94, 0, 255);
        g = clamp(v * 0.96, 0, 255);
        b = clamp(v * 1.05, 0, 255);
      } else {
        // Dark under-suit -> near-black tactical weave with subtle crimson seam tint
        r = clamp(r * 0.58 + 6, 0, 255);
        g = clamp(g * 0.52 + 4, 0, 255);
        b = clamp(b * 0.56 + 5, 0, 255);
      }
    } else if (mode === 'merc_juggernaut') {
      // Transform heavy armor -> dark weathered steel-olive & crimson-trimmed heavy juggernaut
      if (b > r * 1.18 && g > r * 1.05 && b > 90) {
        r = 250; g = 48; b = 22;
      } else if (l > 115) {
        const v = l * 0.31 + 10;
        r = clamp(v * 0.98, 0, 255);
        g = clamp(v * 0.96, 0, 255);
        b = clamp(v * 0.84, 0, 255);
      } else {
        r = clamp(r * 0.65 + 10, 0, 255);
        g = clamp(g * 0.52 + 4, 0, 255);
        b = clamp(b * 0.48 + 4, 0, 255);
      }
    } else if (mode === 'merc_breacher') {
      // Transform firefighter turnout -> matte charcoal-black & dark crimson heavy PMC EOD breacher
      if (!isSkin(r, g, b)) {
        if (r > 125 && g > 125 && b < 115) {
          // Neon yellow reflective bands -> weathered crimson-hazard tactical straps
          r = clamp(l * 0.58 + 20, 0, 255);
          g = clamp(l * 0.18, 0, 255);
          b = clamp(l * 0.17, 0, 255);
        } else if (r > 100 && r > g + 16 && b < 90) {
          // Fire-engine red/copper helmet -> matte gunmetal-obsidian tactical ballistic helmet
          r = clamp(r * 0.28 + 14, 0, 255);
          g = clamp(g * 0.22 + 10, 0, 255);
          b = clamp(b * 0.24 + 12, 0, 255);
        } else {
          // Darken suit slightly to gritty matte tactical charcoal
          r = clamp(r * 0.72, 0, 255);
          g = clamp(g * 0.72, 0, 255);
          b = clamp(b * 0.76, 0, 255);
        }
      }
    }

    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }

  ctx.putImageData(id, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.flipY = src.flipY;
  out.wrapS = src.wrapS;
  out.wrapT = src.wrapT;
  out.colorSpace = THREE.SRGBColorSpace;
  out.anisotropy = src.anisotropy;
  out.needsUpdate = true;
  return out;
}

function getRig(asset: CharAsset): Rig {
  const cached = RIGS[asset];
  if (cached) return cached;
  const src = assets.gltf[asset].scene;
  src.updateMatrixWorld(true);
  let sm!: THREE.SkinnedMesh;
  src.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) sm = o as THREE.SkinnedMesh; });
  const g0 = sm.geometry;
  const bones = sm.skeleton.bones;
  const n = g0.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const preM = new THREE.Matrix4().copy(sm.matrixWorld).multiply(sm.bindMatrixInverse);
  // Precompute composite world-space bone skinning matrices once (24 matrices total instead of 4*N matrix multiplications!)
  const boneMats = bones.map((b, bi) =>
    new THREE.Matrix4()
      .copy(preM)
      .multiply(b.matrixWorld)
      .multiply(sm.skeleton.boneInverses[bi])
      .multiply(sm.bindMatrix),
  );
  const A = boneMats[0];
  const posAttr = g0.attributes.position;
  const norAttr = g0.attributes.normal;
  const siAttr = g0.attributes.skinIndex;
  const swAttr = g0.attributes.skinWeight;
  const v = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const acc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(posAttr, i);
    acc.set(0, 0, 0);
    let wSum = 0;
    for (let k = 0; k < 4; k++) {
      const w = swAttr.getComponent(i, k);
      if (w !== 0) {
        const bi = siAttr.getComponent(i, k);
        const bm = boneMats[bi] ?? A;
        acc.addScaledVector(tmp.copy(v).applyMatrix4(bm), w);
        wSum += w;
      }
    }
    if (wSum === 0) acc.copy(v).applyMatrix4(A);
    pos[i * 3] = acc.x; pos[i * 3 + 1] = acc.y; pos[i * 3 + 2] = acc.z;
    v.fromBufferAttribute(norAttr, i).transformDirection(A);
    nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', g0.attributes.uv);
  geo.setAttribute('skinIndex', g0.attributes.skinIndex);
  geo.setAttribute('skinWeight', g0.attributes.skinWeight);

  // Cleanly strip the protruding ninja katana hilt behind the shoulder of char_specops
  // so it reads 100% as a modern hooded mercenary (covered further by a 3D tactical assault pack)
  if (asset === 'char_specops' && g0.index) {
    const srcIdx = g0.index.array;
    const kept: number[] = [];
    const isBlade = (vi: number) => {
      const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2];
      return z < -0.105 && y > 1.43 && Math.abs(x) > 0.115;
    };
    for (let t = 0; t < srcIdx.length; t += 3) {
      const a = srcIdx[t], b = srcIdx[t + 1], c = srcIdx[t + 2];
      if (isBlade(a) && isBlade(b) && isBlade(c)) continue;
      kept.push(a, b, c);
    }
    geo.setIndex(kept);
  } else {
    geo.setIndex(g0.index);
  }

  const bp = (name: string) => bones.find((b) => b.name === name)!.getWorldPosition(new THREE.Vector3());
  const hipO = new THREE.Vector3(0, bp('Hips').y, 0);
  const torsoO = new THREE.Vector3(0, hipO.y + 0.11, 0);
  const headO = bp('neck').setX(0);
  const rest: THREE.Matrix4[] = [];
  const at = (p: THREE.Vector3, to?: THREE.Vector3) =>
    new THREE.Matrix4().compose(p, to ? new THREE.Quaternion().setFromUnitVectors(DOWN, to.clone().sub(p).normalize()) : new THREE.Quaternion(), ONE);
  rest[HIPS] = at(hipO);
  rest[TORSO] = at(torsoO);
  rest[HEAD] = at(headO);
  const shoulders: THREE.Vector3[] = [], hipsJ: THREE.Vector3[] = [];
  let arm1 = 0, arm2 = 0, leg1 = 0, leg2 = 0, ankleY = 0;
  ['Right', 'Left'].forEach((side, i) => {
    const s = bp(side + 'Arm'), e = bp(side + 'ForeArm'), w = bp(side + 'Hand');
    const h = bp(side + 'UpLeg'), k = bp(side + 'Leg'), a = bp(side + 'Foot');
    rest[ARM_U + i] = at(s, e);
    rest[ARM_L + i] = at(e, w);
    rest[LEG_U + i] = at(h, k);
    rest[LEG_L + i] = at(k, a);
    rest[FOOT + i] = at(a);
    shoulders.push(s.clone().sub(torsoO));
    hipsJ.push(h.clone().sub(hipO));
    arm1 = s.distanceTo(e); arm2 = e.distanceTo(w);
    leg1 = h.distanceTo(k); leg2 = k.distanceTo(a);
    ankleY = a.y;
  });

  const baseMat = sm.material as THREE.MeshStandardMaterial;
  const rig: Rig = {
    geo,
    mats: {},
    texCache: {},
    baseMat,
    seg: bones.map((b) => segOfBone(b.name)),
    restInv: rest.map((m) => m.clone().invert()),
    hipY: hipO.y,
    ankleY,
    torsoOff: torsoO.clone().sub(hipO),
    headOff: headO.clone().sub(torsoO),
    shoulders,
    hipsJ,
    arm1, arm2, leg1, leg2,
  };
  RIGS[asset] = rig;
  return rig;
}

function getMat(rig: Rig, kind: ModelKind, asset: CharAsset): THREE.Material {
  const cached = rig.mats[kind];
  if (cached) return cached;
  const mode = REMAP_OF_KIND[kind] ?? 'natural';
  const m = rig.baseMat.clone();
  m.color.setRGB(1, 1, 1);
  if (m.map && mode !== 'natural') {
    let tex = rig.texCache[mode];
    if (!tex) {
      tex = remapCharTexture(m.map, mode);
      rig.texCache[mode] = tex;
    }
    m.map = tex;
  }
  // Matte tactical roughness calibration: bespoke forged GLBs preserve their baked 2K PBR metalness/roughness/emissive maps!
  const isBespoke = asset === 'hero_gao' || asset === 'hero_tiechui' || asset === 'hero_linfeng' || asset === 'hero_bailing' || asset === 'boss_kronos' || asset === 'boss_tyrant';
  if (isBespoke) {
    // Keep baked PBR maps intact (metalnessMap / roughnessMap / emissiveMap)
    m.envMapIntensity = 1.15;
  } else if (asset === 'char_heavy') {
    m.metalness = 0.34;
    m.roughness = Math.max(m.roughness, 0.46);
  } else if (asset === 'char_breacher') {
    m.metalness = 0.14;
    m.roughness = Math.max(m.roughness, 0.56);
  } else {
    m.metalness = 0.04;
    m.roughness = Math.max(m.roughness, 0.62);
  }
  m.side = THREE.FrontSide;
  if (!isBespoke) m.envMapIntensity = isHostageKind(kind) ? 1.0 : 0.85;
  rig.mats[kind] = m;
  return m;
}

function solveLimb(upper: THREE.Object3D, lower: THREE.Object3D, joint: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
  _d.subVectors(target, joint);
  let dist = _d.length();
  const max = (l1 + l2) * 0.999;
  if (dist > max) {
    _d.multiplyScalar(max / dist);
    dist = max;
  }
  if (dist < 0.05) dist = 0.05;
  _d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1);
  _p.normalize();
  _e.copy(joint).addScaledVector(_d, a).addScaledVector(_p, hgt);
  upper.position.copy(joint);
  upper.quaternion.setFromUnitVectors(DOWN, _p.subVectors(_e, joint).normalize());
  lower.position.copy(_e);
  _p.copy(joint).addScaledVector(_d, dist).sub(_e).normalize();
  lower.quaternion.setFromUnitVectors(DOWN, _p);
}

export class SoldierModel {
  root = new THREE.Group();
  private rig: Rig;
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private gun: THREE.Object3D;
  private bossGlowMats: THREE.MeshStandardMaterial[] = [];
  private overdrive = false;
  shieldMesh: THREE.Mesh | null = null;
  private strobeLed: THREE.Mesh | null = null;
  private armU = [new THREE.Object3D(), new THREE.Object3D()];
  private armL = [new THREE.Object3D(), new THREE.Object3D()];
  private legU = [new THREE.Object3D(), new THREE.Object3D()];
  private legL = [new THREE.Object3D(), new THREE.Object3D()];
  private foot = [new THREE.Object3D(), new THREE.Object3D()];
  private bones: THREE.Bone[] = [];
  private skeleton: THREE.Skeleton;
  private segM: THREE.Matrix4[] = [];
  private mHips = new THREE.Matrix4();
  private mTorso = new THREE.Matrix4();
  scale = 1;
  readonly armed: boolean;

  // animation state
  private idleT = Math.random() * 12;
  private phase = Math.random() * 6;
  private aimBlend = 0;
  private crouchBlend = 0;
  private leanBlend = 0;
  private sprintBlend = 0;
  private gunPos = new THREE.Vector3();
  private gunQuat = new THREE.Quaternion();
  private flinchX = 0;
  private flinchY = 0;
  private recoil = 0;
  private handT = [new THREE.Vector3(), new THREE.Vector3()];
  private footT = [new THREE.Vector3(), new THREE.Vector3()];
  private deathT = -1;
  private deathType = 0;
  private deathSeed = Math.random();
  private moveLocal = new THREE.Vector2();
  private speedSm = 0;

  // tactical roll state
  private rollT = -1;
  private rollDur = 0.52;
  private rollDir = new THREE.Vector2(0, 1);

  private static poleArm = [new THREE.Vector3(-0.8, -1, -0.5), new THREE.Vector3(0.9, -1, -0.2)];
  private static poleArmUp = [new THREE.Vector3(-0.9, -0.2, 0.3), new THREE.Vector3(0.9, -0.2, 0.3)];
  private static poleLeg = [new THREE.Vector3(-0.12, 0, 1), new THREE.Vector3(0.12, 0, 1)];
  private static qAim = new THREE.Quaternion();
  private static qLow = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.62, 0.48, 0.24, 'YXZ'));
  private static qSprint = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, 0.92, 0.38, 'YXZ'));
  private static qReload = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0.42, -0.58, 'YXZ'));
  private static qStun = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.92, 0.28, 0.12, 'YXZ'));
  private static qDead = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.2, 1.4, 'YXZ'));
  private static qWork = new THREE.Quaternion();

  constructor(public kind: ModelKind) {
    const asset = MODEL_OF_KIND[kind] ?? 'soldier';
    const rig = (this.rig = getRig(asset));
    const guns = getGunsPack(rig.baseMat);
    this.armed = !isHostageKind(kind) && kind !== 'medic';
    this.scale =
      kind === 'boss_kronos' ? 0.78
      : kind === 'boss_tyrant' ? 1.24
      : kind === 'boss_viper' ? 1.22
      : kind === 'heavy' ? 1.13
      : kind === 'marine_heavy' ? 1.06
      : kind === 'breacher' ? 1.05
      : kind === 'marine_tech' ? 0.96
      : (kind === 'rusher' || kind === 'sniper' || kind === 'specops') ? 0.99
      : 1.0;

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.add(this.torso);
    this.torso.position.copy(rig.torsoOff);
    this.torso.add(this.head);
    this.head.position.copy(rig.headOff);

    // Pick class-appropriate scanned weapon mesh OR bespoke sculpted Blender Boss heavy weapon!
    const bossKitName =
      kind === 'boss_kronos' ? 'boss_kronos_kit'
      : kind === 'boss_viper' ? 'boss_viper_kit'
      : kind === 'boss_tyrant' ? 'boss_tyrant_kit'
      : null;
    const bossGunSrc = bossKitName && assets.gltf[bossKitName]?.scene.getObjectByName('BossGun');
    if (bossGunSrc) {
      const bg = bossGunSrc.clone(true);
      bg.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.frustumCulled = false;
          if (!Array.isArray(m.material) && (m.material as THREE.MeshStandardMaterial).emissiveIntensity > 1) {
            const cl = (m.material as THREE.MeshStandardMaterial).clone();
            m.material = cl;
            this.bossGlowMats.push(cl);
          }
        }
      });
      this.gun = bg;
      this.gun.visible = this.armed;
      this.torso.add(this.gun);
    } else {
      const gunPack = kind === 'sniper'
        ? guns.sniper
        : kind === 'rusher'
          ? guns.smg
          : kind === 'heavy' || kind === 'marine_heavy'
            ? guns.heavy
            : kind === 'instructor'
              ? guns.pistol
              : guns.rifle;
      this.gun = new THREE.Mesh(gunPack.geo, gunPack.mat);
      this.gun.castShadow = false;
      this.gun.frustumCulled = false;
      this.gun.visible = this.armed;
      this.torso.add(this.gun);
    }

    for (let i = 0; i < 2; i++) {
      this.torso.add(this.armU[i], this.armL[i]);
      this.hips.add(this.legU[i], this.legL[i], this.foot[i]);
    }
    for (let i = 0; i < SEGS; i++) this.segM.push(new THREE.Matrix4());

    // Attach beveled ballistic riot shield exclusively for enemy breacher
    if (kind === 'breacher') {
      const S = getShieldAssets();
      const shield = new THREE.Mesh(S.body, S.armorMat);
      shield.position.set(-0.16, 0.02, 0.22);
      shield.rotation.y = 0.25;
      shield.castShadow = true;
      shield.receiveShadow = true;
      const frame = new THREE.Mesh(S.frame, S.metalMat);
      frame.position.set(0, 0.2, 0);
      const glass = new THREE.Mesh(S.glass, S.visorMat);
      glass.position.set(0, 0.2, 0);
      shield.add(frame, glass);
      this.armL[1].add(shield);
      this.shieldMesh = shield;
    }

    // Attach crisp 3D faction tactical kit (NVG, IFF helmet strobes, armbands, backpacks, crimson visors)
    this.attachFactionGear(asset);

    const inverses: THREE.Matrix4[] = [];
    for (let i = 0; i < rig.seg.length; i++) {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      this.root.add(b);
      this.bones.push(b);
      inverses.push(new THREE.Matrix4());
    }
    this.skeleton = new THREE.Skeleton(this.bones, inverses);
    let charMat = getMat(rig, kind, asset);
    if (kind === 'boss_kronos' && (charMat as THREE.MeshStandardMaterial).emissiveMap) {
      const cl = (charMat as THREE.MeshStandardMaterial).clone();
      charMat = cl;
      this.bossGlowMats.push(cl);
    }
    const mesh = new THREE.SkinnedMesh(rig.geo, charMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.bind(this.skeleton, new THREE.Matrix4());
    this.root.add(mesh);

    this.root.scale.setScalar(this.scale);
    this.hips.position.y = rig.hipY;
    this.sync();
  }

  /** Mounts complementary tactical kits onto our 7 completely unique high-poly Hero & Boss character models. */
  private attachFactionGear(asset: CharAsset) {
    const G = getGearAssets();
    const k = this.kind;
    const isMarine = k === 'marine_lead' || k === 'marine_heavy' || k === 'marine_tech' || k === 'marine_player';
    const isCampAlly = k === 'friendly' || k === 'guard' || k === 'shooter' || k === 'eod';

    const mountBlenderKit = (
      kitName: 'hero_gao_kit' | 'hero_tiechui_kit' | 'hero_player_kit' | 'hero_bailing_kit' | 'boss_kronos_kit' | 'boss_viper_kit' | 'boss_tyrant_kit',
      useHead: boolean,
      useTorso: boolean,
      headY = 0.088,
      torsoY = 0.165,
    ) => {
      const gltf = assets.gltf[kitName];
      if (!gltf) return false;
      const mountNode = (nodeName: string, targetBone: THREE.Object3D, yOffset: number) => {
        const src = gltf.scene.getObjectByName(nodeName);
        if (!src) return;
        const clone = src.clone(true);
        clone.position.y += yOffset;
        clone.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
          if (!Array.isArray(m.material) && isBossKind(k)) {
            const sm = m.material as THREE.MeshStandardMaterial;
            if (sm.emissiveIntensity > 1) {
              const cl = sm.clone();
              m.material = cl;
              this.bossGlowMats.push(cl);
            }
          }
        });
        targetBone.add(clone);
      };
      if (useHead) mountNode('HeadGear', this.head, headY);
      if (useTorso) mountNode('TorsoGear', this.torso, torsoY);
      return true;
    };

    // 1. Protagonist Squad — User's custom generated 3D models (hero_gao, hero_tiechui, hero_bailing) already have
    //    complete sculpted helmets, headsets, goggles, vests, C4 charges, and backpacks baked into their mesh!
    if (isMarine) {
      if (k === 'marine_player') {
        const pack = new THREE.Mesh(G.packStd, G.tacticalPack);
        pack.position.set(0, 0.25, -0.155);
        pack.scale.set(0.84, 0.85, 0.72);
        this.torso.add(pack);
        const chem = new THREE.Mesh(G.chemlight, G.allyGlow);
        chem.position.set(0, 0.30, -0.205);
        chem.rotation.z = Math.PI / 2;
        this.torso.add(chem);
      }
      return;
    }

    // 2. Three COMPLETELY UNIQUE High-Poly Multi-Phase Boss Models!
    if (isBossKind(k)) {
      if (k === 'boss_viper') {
        // Sleek desert-carbon stealth exoskeleton + dual 6-tube shoulder missile pods + twin-rail railgun
        mountBlenderKit('boss_viper_kit', true, true, 0.055, 0.175);
      }
      // boss_kronos (178k Battleship Dreadnought Mech + 4-barrel Gatling) & boss_tyrant (174k Crimson-Gold Warlord + Heavy Siege Autocannon)
      // showcase their full brand-new sculpted bodies unobstructed (weapons already mounted via BossGun)!
      return;
    }

    const bakeParts = (parts: { geo: THREE.BufferGeometry; pos: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] }[]) => {
      const list: THREE.BufferGeometry[] = [];
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      for (const item of parts) {
        const raw = item.geo.index ? item.geo.toNonIndexed() : item.geo.clone();
        p.set(...item.pos);
        if (item.rot) q.setFromEuler(new THREE.Euler(...item.rot)); else q.identity();
        if (item.scale) s.set(...item.scale); else s.set(1, 1, 1);
        m4.compose(p, q, s);
        raw.applyMatrix4(m4);
        if (!raw.attributes.normal) raw.computeVertexNormals();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', raw.attributes.position);
        g.setAttribute('normal', raw.attributes.normal);
        g.setAttribute('uv', raw.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(raw.attributes.position.count * 2), 2));
        raw.dispose();
        list.push(g);
      }
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      return merged;
    };

    if (isMarine || isCampAlly) {
      // 1. Top-of-helmet pulsing cyan-blue IR/IFF strobe LED + merged dark-metal head kit (strobe housing + quad/dual NVG)
      const headMetalParts: { geo: THREE.BufferGeometry; pos: [number, number, number] }[] = [
        { geo: G.strobeHousing, pos: [0, 0.275, -0.015] },
      ];
      const headLensParts: { geo: THREE.BufferGeometry; pos: [number, number, number] }[] = [];

      if (isMarine) {
        headMetalParts.push({ geo: G.nvgBridge, pos: [0, 0.175, 0.135] });
        const xs = k === 'marine_heavy' ? [-0.032, 0.032] : [-0.052, -0.018, 0.018, 0.052];
        for (const ox of xs) {
          headMetalParts.push({ geo: G.nvgTube, pos: [ox, 0.167, 0.159] });
          headLensParts.push({ geo: G.nvgLens, pos: [ox, 0.167, 0.193] });
        }
      }
      this.head.add(new THREE.Mesh(bakeParts(headMetalParts), G.darkMetal));
      if (headLensParts.length) this.head.add(new THREE.Mesh(bakeParts(headLensParts), G.allyNvgLens));

      const led = new THREE.Mesh(G.strobeLed, G.allyGlow);
      led.position.set(0, 0.289, -0.015);
      this.head.add(led);
      this.strobeLed = led;

      // 2. Cyan-blue Allied IFF tactical armbands on both upper arms
      for (let i = 0; i < 2; i++) {
        const band = new THREE.Mesh(G.armBand, G.allyBand);
        band.position.set(0, -this.rig.arm1 * 0.42, 0);
        this.armU[i].add(band);
      }

      // 3. Role-specific merged backpack + whip antennas + glowing cyan rear chemlight
      if (isMarine) {
        const pack = new THREE.Mesh(k === 'marine_heavy' ? G.packHeavy : G.packStd, G.tacticalPack);
        pack.position.set(0, 0.24, -0.175);
        this.torso.add(pack);

        const chem = new THREE.Mesh(G.chemlight, G.allyGlow);
        chem.position.set(k === 'marine_heavy' ? 0.1 : -0.08, 0.27, -0.235);
        chem.rotation.z = 0.28;
        this.torso.add(chem);

        if (k === 'marine_lead' || k === 'marine_tech') {
          const antParts: { geo: THREE.BufferGeometry; pos: [number, number, number]; rot: [number, number, number] }[] = [
            { geo: G.antenna, pos: [0.095, 0.56, -0.17], rot: [0, 0, -0.12] },
          ];
          if (k === 'marine_tech') antParts.push({ geo: G.antenna, pos: [-0.095, 0.52, -0.17], rot: [0, 0, 0.14] });
          this.torso.add(new THREE.Mesh(bakeParts(antParts), G.darkMetal));
        }
      }
      return;
    }

    if (isHostileKind(k)) {
      // 1. High-contrast crimson mercenary armbands on both upper arms
      for (let i = 0; i < 2; i++) {
        const band = new THREE.Mesh(G.armBand, G.enemyBand);
        band.position.set(0, -this.rig.arm1 * 0.42, 0);
        this.armU[i].add(band);
      }

      // 2. Merged glowing crimson-red hostile tactical optics / ballistic visor & chest/back kit
      if (asset === 'char_specops') {
        const frame = new THREE.Mesh(G.goggleFrame, G.darkMetal);
        frame.position.set(0, 0.165, 0.095);
        const lenses = new THREE.Mesh(
          bakeParts([
            { geo: G.goggleLens, pos: [-0.03, 0.165, 0.113] },
            { geo: G.goggleLens, pos: [0.03, 0.165, 0.113] },
          ]),
          G.enemyVisor,
        );
        this.head.add(frame, lenses);

        const torsoRig = new THREE.Mesh(
          bakeParts([
            { geo: G.chestPlate, pos: [0, 0.24, 0.105] },
            { geo: G.packStd, pos: [0, 0.24, -0.16] },
          ]),
          G.enemyPack,
        );
        this.torso.add(torsoRig);
      } else if (asset === 'char_heavy') {
        const visor = new THREE.Mesh(G.curvedVisor, G.enemyVisor);
        visor.position.set(0, 0.175, 0.108);
        this.head.add(visor);
        if (k === 'heavy') {
          const ammoPack = new THREE.Mesh(G.packHeavy, G.enemyPack);
          ammoPack.position.set(0, 0.25, -0.19);
          this.torso.add(ammoPack);
        }
      } else if (asset === 'char_breacher') {
        const visor = new THREE.Mesh(G.curvedVisor, G.enemyVisor);
        visor.position.set(0, 0.175, 0.118);
        visor.scale.set(1.06, 0.85, 0.9);
        this.head.add(visor);
      }
    }
  }

  dispose() {
    this.skeleton.dispose();
  }

  get dying() {
    return this.deathT >= 0;
  }

  get isRolling() {
    return this.rollT >= 0;
  }

  /** Trigger a rapid 360-degree tactical combat roll in a given world direction. */
  roll(dirX: number, dirZ: number, duration = 0.52) {
    if (this.deathT >= 0 || this.rollT >= 0) return;
    this.rollT = 0;
    this.rollDur = duration;
    const len = Math.hypot(dirX, dirZ) || 1;
    this.rollDir.set(dirX / len, dirZ / len);
  }

  /** Toggle Boss Phase-2 Overdrive visual aura (blazing pulsing core & visor glow!). */
  setOverdrive(on: boolean) {
    this.overdrive = on;
  }

  /** World position of the weapon muzzle. */
  muzzle(out: THREE.Vector3) {
    const fwd = this.kind === 'sniper' || this.kind === 'boss_viper' || this.kind === 'boss_tyrant'
      ? 0.84
      : this.kind === 'boss_kronos'
        ? 0.80
        : this.kind === 'rusher'
          ? 0.42
          : 0.6;
    return this.gun.localToWorld(out.set(0, 0.035, fwd));
  }

  flinch(strength: number) {
    this.flinchX += (Math.random() - 0.25) * strength;
    this.flinchY += (Math.random() - 0.5) * strength * 1.45;
  }

  shotKick() {
    this.recoil = 1;
  }

  die(forward: boolean) {
    this.deathT = 0;
    const r = Math.random();
    this.deathType = forward ? 1 : r < 0.34 ? 2 : r < 0.65 ? 3 : 0;
  }

  /** Writes the kinematic pose into the skinned model's bones. */
  private sync() {
    const { rig, segM } = this;
    this.body.updateMatrix();
    this.hips.updateMatrix();
    this.torso.updateMatrix();
    this.head.updateMatrix();
    this.mHips.multiplyMatrices(this.body.matrix, this.hips.matrix);
    this.mTorso.multiplyMatrices(this.mHips, this.torso.matrix);
    segM[HIPS].copy(this.mHips);
    segM[TORSO].copy(this.mTorso);
    segM[HEAD].multiplyMatrices(this.mTorso, this.head.matrix);
    for (let i = 0; i < 2; i++) {
      for (const o of [this.armU[i], this.armL[i], this.legU[i], this.legL[i], this.foot[i]]) o.updateMatrix();
      segM[ARM_U + i].multiplyMatrices(this.mTorso, this.armU[i].matrix);
      segM[ARM_L + i].multiplyMatrices(this.mTorso, this.armL[i].matrix);
      segM[LEG_U + i].multiplyMatrices(this.mHips, this.legU[i].matrix);
      segM[LEG_L + i].multiplyMatrices(this.mHips, this.legL[i].matrix);
      segM[FOOT + i].multiplyMatrices(this.mHips, this.foot[i].matrix);
    }
    for (let s = 0; s < SEGS; s++) segM[s].multiply(rig.restInv[s]);
    for (let b = 0; b < this.bones.length; b++) this.bones[b].matrix.copy(segM[rig.seg[b]]);
  }

  private solveLimbs(footPitch: number[], armsUp = false) {
    const S = SoldierModel, rig = this.rig;
    const armPole = armsUp ? S.poleArmUp : S.poleArm;
    for (let i = 0; i < 2; i++) {
      solveLimb(this.armU[i], this.armL[i], rig.shoulders[i], this.handT[i], rig.arm1, rig.arm2, armPole[i]);
      solveLimb(this.legU[i], this.legL[i], rig.hipsJ[i], this.footT[i], rig.leg1, rig.leg2, S.poleLeg[i]);
      this.foot[i].position.copy(DOWN).applyQuaternion(this.legL[i].quaternion).multiplyScalar(rig.leg2).add(this.legL[i].position);
      this.foot[i].rotation.x = footPitch[i];
    }
  }

  /**
   * @param speed          horizontal speed (m/s)
   * @param moveX/Z        movement direction in the soldier's local frame
   * @param aiming         weapon shouldered
   * @param pitch          aim elevation (radians, + = up)
   * @param crouch         tactical crouch behind cover / low stance
   * @param lean           lateral corner lean (-1 left .. +1 right)
   * @param action         specialized AAA action pose ('combat' | 'reload' | 'stunned' | 'hostage' | 'helisit' | 'signal' | 'reach' | 'briefing')
   * @param actionProgress normalized 0..1 progress for timed actions like reload
   */
  update(
    dt: number,
    speed: number,
    moveX: number,
    moveZ: number,
    aiming: boolean,
    pitch: number,
    crouch = false,
    lean = 0,
    action: SoldierAction = 'combat',
    actionProgress = 0,
  ) {
    const S = SoldierModel, rig = this.rig;
    this.idleT += dt;

    // Gentle real-world military IR/IFF helmet strobe pulse for allied operators
    if (this.strobeLed) {
      const pulse = (this.idleT * 0.82 + this.deathSeed) % 1;
      const on = pulse < 0.16 || (pulse > 0.24 && pulse < 0.34);
      this.strobeLed.scale.setScalar(on ? 1.22 : 0.72);
    }
    if (this.bossGlowMats.length) {
      const target = this.overdrive ? 9.5 + Math.sin(this.idleT * 11.0) * 3.5 : 5.5 + Math.sin(this.idleT * 3.2) * 1.0;
      for (const gm of this.bossGlowMats) gm.emissiveIntensity = target;
    }

    if (this.deathT >= 0) {
      this.updateDeath(dt);
      this.sync();
      return;
    }
    if (this.rollT >= 0) {
      this.updateRoll(dt);
      this.sync();
      return;
    }

    // Specialized non-standard full-body animations
    if (action === 'hostage') {
      this.updateHostage(dt);
      this.sync();
      return;
    }
    if (action === 'helisit') {
      this.updateHeliSit(dt);
      this.sync();
      return;
    }

    this.speedSm = damp(this.speedSm, speed, 10, dt);
    const sp = this.speedSm;
    const moving = clamp(sp / 1.05, 0, 1);
    const hasDir = Math.hypot(moveX, moveZ) > 0.05;
    this.moveLocal.x = damp(this.moveLocal.x, hasDir ? moveX : 0, 10, dt);
    this.moveLocal.y = damp(this.moveLocal.y, hasDir ? moveZ : 1, 10, dt);
    this.crouchBlend = damp(this.crouchBlend, crouch ? 1 : 0, 11, dt);
    const cb = this.crouchBlend;
    this.leanBlend = damp(this.leanBlend, lean, 10, dt);
    const lb = this.leanBlend;

    const wantSprint = !aiming && !crouch && action === 'combat' && sp > 3.1;
    this.sprintBlend = damp(this.sprintBlend, wantSprint ? 1 : 0, 9, dt);
    const sb = this.sprintBlend;

    this.phase += dt * (3.1 + sp * 1.92) * moving;
    const ph = this.phase;
    const run = clamp((sp - 2.2) / 2.4, 0, 1);
    const breath = Math.sin(this.idleT * 2.05) * (1 - moving * 0.7);

    // Hips: grounded breathing, energetic sprint bounce, or stable kneeling crouch drop
    const stride = 0.16 + Math.min(sp, 6.2) * 0.062;
    const bob = Math.abs(Math.sin(ph)) * (0.028 + run * 0.036) * moving * (1 - cb * 0.45) * (aiming ? 0.55 : 1);
    this.hips.position.y = rig.hipY - 0.042 - bob - (aiming ? 0.032 : 0) - 0.37 * cb + breath * 0.006;
    this.hips.position.x = lb * 0.12 + Math.sin(ph) * 0.022 * moving;
    this.hips.rotation.x = (run * 0.16 + sb * 0.12) * this.moveLocal.y + cb * 0.14;
    this.hips.rotation.y = Math.sin(ph) * (0.09 + sb * 0.07) * moving;
    this.hips.rotation.z = -lb * 0.08 + Math.cos(ph) * 0.025 * moving;

    const effectiveAim = aiming && action === 'combat' && this.armed;
    this.aimBlend = damp(this.aimBlend, effectiveAim ? 1 : 0, 9, dt);
    this.flinchX = damp(this.flinchX, 0, 7, dt);
    this.flinchY = damp(this.flinchY, 0, 7, dt);
    this.recoil = damp(this.recoil, 0, 18, dt);
    const ab = this.aimBlend;

    // Natural head sector scan when idle/patrolling (never frozen statue!)
    const scanYaw = (1 - ab) * (1 - sb * 0.7) * Math.sin(this.idleT * 0.65 + this.deathSeed * 6) * 0.24;
    const scanPitch = (1 - ab) * Math.sin(this.idleT * 0.42 + this.deathSeed * 3) * 0.06;

    // Torso & Head base posture
    let torsoRx = -pitch * ab * 0.85 + run * 0.11 + sb * 0.14 + this.flinchX - this.hips.rotation.x * 0.45 + cb * 0.16 + breath * 0.018;
    let torsoRy = -this.hips.rotation.y * 1.15 + this.flinchY + ab * 0.28 + Math.sin(ph) * 0.08 * sb;
    let torsoRz = -lb * 0.26;
    let headRx = -pitch * 0.16 * ab - run * 0.1 - sb * 0.12 - cb * 0.08 + scanPitch;
    let headRy = -ab * 0.26 - this.flinchY * 0.5 + scanYaw;
    let headRz = -lb * 0.14;

    // Weapon & Hand IK targets by Action State
    const sway = Math.sin(ph * 2) * (0.014 + sb * 0.024) * moving + breath * 0.008;
    let armsUp = false;

    if (action === 'stunned') {
      // FLASHBANG BLINDED: stagger backward, drop rifle in right hand, raise left arm shielding eyes!
      const stagger = Math.sin(this.idleT * 4.8);
      const swayZ = Math.cos(this.idleT * 3.1);
      torsoRx = -0.14 + stagger * 0.11;
      torsoRy = swayZ * 0.28;
      torsoRz = swayZ * 0.14;
      headRx = -0.22 + stagger * 0.1;
      headRy = Math.sin(this.idleT * 6.5) * 0.42;
      this.gunPos.set(-0.14, 0.02 + stagger * 0.02, 0.14);
      this.gunQuat.copy(S.qStun);
      this.handT[0].set(-0.14, 0.01, 0.12);
      // Left hand raised directly across forehead/eyes shielding from flashbang!
      this.handT[1].set(0.03 + swayZ * 0.04, 0.46 + stagger * 0.02, 0.19);
      armsUp = true;
    } else if (action === 'reload' && this.armed) {
      // 3-STAGE VISIBLE TACTICAL RELOAD: cant weapon -> pull mag -> insert fresh mag -> rack bolt
      const p = clamp(actionProgress, 0, 1);
      const tilt = Math.sin(p * Math.PI);
      torsoRx += 0.12 * tilt;
      headRx += 0.18 * tilt;
      this.gunPos.set(-0.04, 0.22 - tilt * 0.04, 0.21);
      this.gunQuat.copy(S.qLow).slerp(S.qReload, tilt);
      this.handT[0].set(-0.02, -0.1, -0.075).applyQuaternion(this.gunQuat).add(this.gunPos);
      if (p < 0.34) {
        // Pull empty mag down toward chest pouch
        const k = p / 0.34;
        this.handT[1].set(lerp(0.04, 0.12, k), lerp(0.16, 0.01, k), lerp(0.24, 0.12, k));
      } else if (p < 0.72) {
        // Seat fresh magazine upward into receiver
        const k = (p - 0.34) / 0.38;
        this.handT[1].set(lerp(0.12, 0.02, k), lerp(0.01, 0.17, k), lerp(0.12, 0.23, k));
      } else {
        // Rack charging handle / slap bolt catch
        const k = (p - 0.72) / 0.28;
        const pop = Math.sin(k * Math.PI);
        this.handT[1].set(0.03, 0.22 + pop * 0.03, 0.19 - pop * 0.07);
      }
    } else if (action === 'reach') {
      // BOW FINALE: braced athletic stance, left arm extended far forward to grab player!
      const reachWave = Math.sin(this.idleT * 4.2) * 0.035;
      torsoRx = 0.28;
      torsoRy = -0.22;
      headRx = -0.14;
      headRy = 0.18;
      this.gunPos.set(-0.18, 0.04, 0.08);
      this.gunQuat.copy(S.qStun);
      this.handT[0].set(-0.18, 0.02, 0.06);
      this.handT[1].set(0.08, 0.30 + reachWave, 0.56);
      armsUp = true;
    } else if (action === 'signal') {
      // TACTICAL HAND SIGNAL: fist-up / wave forward advance gesture with left arm!
      const wave = Math.sin(this.idleT * 5.2);
      torsoRy = -0.12;
      this.gunPos.set(-0.14, 0.08, 0.16);
      this.gunQuat.copy(S.qLow);
      this.handT[0].set(-0.02, -0.1, -0.075).applyQuaternion(this.gunQuat).add(this.gunPos);
      this.handT[1].set(0.24, 0.44 + wave * 0.08, 0.22 + Math.max(0, wave) * 0.14);
      armsUp = true;
    } else if (action === 'briefing' || !this.armed) {
      // EXPRESSIVE UNARMED BRIEFING / CAMP MEDIC / RESCUED CAPTAIN GESTURES
      const g1 = Math.sin(this.idleT * 2.8);
      const g2 = Math.cos(this.idleT * 1.9);
      torsoRx = 0.04 + breath * 0.02;
      torsoRy = g2 * 0.12;
      headRx = -0.04 + g1 * 0.05;
      headRy = g2 * 0.16;
      this.handT[0].set(-0.22, -0.02 + Math.max(0, g1) * 0.14, 0.12 + Math.max(0, g1) * 0.12);
      this.handT[1].set(0.22, 0.02 + Math.max(0, -g1) * 0.16, 0.14 + Math.max(0, -g1) * 0.14);
    } else {
      // STANDARD COMBAT: seamless blend across idle low-ready, tactical sprint across chest, and shouldered ADS aim
      const sprintSwing = Math.sin(ph) * 0.05 * sb;
      this.gunPos.set(
        lerp(lerp(-0.03, 0.02, sb), -0.085, ab) + lb * 0.14 + sprintSwing,
        lerp(lerp(0.14, 0.19, sb), 0.31, ab) + sway - cb * 0.04 + this.recoil * 0.022,
        lerp(lerp(0.22, 0.24, sb), 0.18, ab) - this.recoil * 0.042,
      );
      S.qWork.copy(S.qLow).slerp(S.qSprint, sb);
      this.gunQuat.copy(S.qWork).slerp(S.qAim, ab);
      // Crisp muzzle kick upward during firing bursts
      if (this.recoil > 0.01) {
        S.qWork.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.recoil * 0.14);
        this.gunQuat.multiply(S.qWork);
      }
      this.handT[0].set(-0.02, -0.1, -0.075).applyQuaternion(this.gunQuat).add(this.gunPos);
      if (this.kind === 'breacher') {
        // Breacher braces beveled ballistic riot shield forward with left arm
        this.handT[1].set(-0.16, 0.06, 0.24).applyQuaternion(this.gunQuat).add(this.gunPos);
      } else {
        this.handT[1].set(0.035, -0.075, 0.2).applyQuaternion(this.gunQuat).add(this.gunPos);
      }
    }

    this.torso.rotation.set(torsoRx, torsoRy, torsoRz);
    this.head.rotation.set(headRx, headRy, headRz);
    this.gun.position.copy(this.gunPos);
    this.gun.quaternion.copy(this.gunQuat);

    // Legs: grounded locomotion stride, wide tactical sprint, or stable kneeling cover stance
    const hipY = this.hips.position.y;
    const pitchF = [0, 0];
    for (let i = 0; i < 2; i++) {
      const f = ph + i * Math.PI;
      const s = Math.sin(f) * stride * moving;
      const lift = Math.max(0, Math.cos(f)) * (0.075 + run * 0.145 + sb * 0.05) * moving * (1 - cb * 0.4);
      // Authentic asymmetric tactical stance (front foot forward, rear foot braced back — especially when crouching!)
      const stanceZ = i === 0 ? (-0.07 - cb * 0.22) : (0.10 + cb * 0.22);
      const stanceX = rig.hipsJ[i].x * (1.32 + cb * 0.36);
      this.footT[i].set(
        stanceX + this.moveLocal.x * s,
        -hipY + rig.ankleY + lift,
        this.moveLocal.y * s + stanceZ * (1 - moving * 0.85) * (effectiveAim ? 1.45 : 1) - 0.02,
      );
      pitchF[i] = lift * 2.1 - this.hips.rotation.x + cb * (i === 0 ? 0.55 : 0.12);
    }
    this.solveLimbs(pitchF, armsUp);
    this.sync();
  }

  /** Unarmed terrified/surrendering hostage kneeling low with hands shielding head/chest. */
  private updateHostage(_dt: number) {
    const rig = this.rig;
    const t = this.idleT + this.deathSeed * 9;
    const tremor = Math.sin(t * 7.5) * 0.008;
    const breath = Math.sin(t * 3.1) * 0.012;
    const glance = Math.sin(t * 0.85) * 0.38;

    this.hips.position.set(0, rig.hipY - 0.44 + breath, 0);
    this.hips.rotation.set(0.18, 0, 0);
    this.torso.rotation.set(0.32 + breath * 1.4, glance * 0.22, tremor * 2.0);
    this.head.rotation.set(0.16 + Math.sin(t * 1.6) * 0.08, glance, tremor * 1.5);

    // Both hands raised cleanly beside head/ears ("hands up, unarmed!" unmistakable silhouette)
    this.handT[0].set(-0.24 + tremor, 0.44 + breath, 0.14);
    this.handT[1].set(0.24 - tremor, 0.45 + breath, 0.14);

    // Kneeling low on deck
    const hipY = this.hips.position.y;
    this.footT[0].set(rig.hipsJ[0].x * 1.45, -hipY + rig.ankleY, -0.24);
    this.footT[1].set(rig.hipsJ[1].x * 1.45, -hipY + rig.ankleY, 0.22);
    this.solveLimbs([0.75, 0.12], true);
  }

  /** Seated helicopter-bench tactical posture inside Z-20J cabin during intro insertion. */
  private updateHeliSit(_dt: number) {
    const S = SoldierModel, rig = this.rig;
    const t = this.idleT + this.deathSeed * 7;
    const vib = Math.sin(t * 14.0) * 0.004;
    const sway = Math.sin(t * 1.7) * 0.04;

    this.hips.position.set(0, rig.hipY - 0.34 + vib, 0);
    this.hips.rotation.set(-0.08, 0, sway * 0.4);
    this.torso.rotation.set(0.14 + vib * 2, Math.sin(t * 0.7) * 0.08, sway * 0.5);
    this.head.rotation.set(-0.08, Math.sin(t * 0.55) * 0.28, 0);

    // Rifle braced upright across thighs/chest
    this.gunPos.set(-0.02, 0.12 + vib, 0.24);
    this.gunQuat.copy(S.qLow);
    this.gun.position.copy(this.gunPos);
    this.gun.quaternion.copy(this.gunQuat);
    this.handT[0].set(-0.02, -0.1, -0.075).applyQuaternion(this.gunQuat).add(this.gunPos);
    this.handT[1].set(0.04, -0.06, 0.2).applyQuaternion(this.gunQuat).add(this.gunPos);

    // Seated knees bent 90° forward, boots planted on cabin deck
    const hipY = this.hips.position.y;
    this.footT[0].set(rig.hipsJ[0].x * 1.5, -hipY + rig.ankleY, 0.34);
    this.footT[1].set(rig.hipsJ[1].x * 1.5, -hipY + rig.ankleY, 0.38);
    this.solveLimbs([0.08, 0.08], false);
  }

  /** Tactical 360-degree somersault roll underneath enemy fire. */
  private updateRoll(dt: number) {
    this.rollT += dt;
    const rig = this.rig;
    const p = clamp(this.rollT / this.rollDur, 0, 1);
    if (p >= 1) {
      this.rollT = -1;
      this.body.quaternion.identity();
      this.hips.position.y = rig.hipY;
      return;
    }

    // Smooth forward roll rotation
    const rollAngle = p * Math.PI * 2;
    this.body.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rollAngle);

    // Hips drop to ground level during mid-roll tuck (low profile)
    const tuck = Math.sin(p * Math.PI);
    this.hips.position.y = lerp(rig.hipY, 0.30, tuck);
    this.torso.rotation.set(tuck * 0.95, 0, 0);
    this.head.rotation.set(tuck * 0.7, 0, 0);

    // Arms tuck weapon tight against chest
    this.gunPos.set(-0.04, 0.18 + tuck * 0.05, 0.12 - tuck * 0.06);
    this.gun.position.copy(this.gunPos);
    this.gun.quaternion.copy(SoldierModel.qLow);
    this.handT[0].set(-0.02, 0.08, 0.08);
    this.handT[1].set(0.04, 0.10, 0.14);

    // Feet curl up in tuck
    for (let i = 0; i < 2; i++) {
      this.footT[i].set(
        rig.hipsJ[i].x * 1.1,
        -this.hips.position.y + rig.ankleY + tuck * 0.45,
        (i === 0 ? -0.1 : 0.1) * (1 - tuck) + tuck * 0.2,
      );
    }
    this.solveLimbs([0.6 * tuck, 0.6 * tuck]);
  }

  /** 4-variant grounded death physics (back fall, forward pitch, side crumple, knee-drop spin). */
  private updateDeath(dt: number) {
    const S = SoldierModel, rig = this.rig;
    this.deathT += dt;
    const t = this.deathT;
    const fall = clamp(t / 0.62, 0, 1);
    const e = fall * fall;
    const settle = clamp((t - 0.62) / 0.25, 0, 1);
    const bounce = Math.sin(settle * Math.PI) * 0.04 * (1 - settle);
    const dir = this.deathType === 1 ? 1 : -1;
    const sideSign = this.deathSeed > 0.5 ? 1 : -1;

    if (this.deathType === 2) {
      // Sideways knee-buckle collapse
      const k = clamp(t / 0.35, 0, 1);
      this.hips.position.y = lerp(this.hips.position.y, 0.46, k * k);
      this.body.rotation.z = e * 1.48 * sideSign;
      this.body.rotation.x = e * -0.28;
      this.body.position.y = e * 0.12 + bounce;
    } else if (this.deathType === 3) {
      // Dramatic spin-and-drop collapse
      const k = clamp(t / 0.42, 0, 1);
      this.hips.position.y = lerp(this.hips.position.y, 0.42, k * k);
      this.body.rotation.y = e * 1.15 * sideSign;
      this.body.rotation.x = -(e * (Math.PI / 2 - 0.08) + bounce);
      this.body.position.y = e * 0.14;
    } else {
      // Classic backward or forward kinetic collapse
      this.body.rotation.x = dir * (e * (Math.PI / 2 - 0.06) + bounce);
      this.body.position.y = e * 0.16;
      this.hips.position.y = lerp(this.hips.position.y, rig.hipY - 0.1, 0.1);
    }

    this.torso.rotation.x = damp(this.torso.rotation.x, dir * -0.15, 6, dt);
    this.torso.rotation.y = damp(this.torso.rotation.y, (this.deathSeed - 0.5) * 0.85, 6, dt);
    this.head.rotation.x = damp(this.head.rotation.x, dir * 0.32, 6, dt);
    this.head.rotation.y = damp(this.head.rotation.y, (this.deathSeed - 0.5) * 1.6, 6, dt);

    const k = 1 - Math.exp(-7 * dt);
    const spread = 0.25 + this.deathSeed * 0.2;
    _d.set(-spread - 0.2, 0.12 + this.deathSeed * 0.2, 0.1 * dir);
    this.handT[0].lerp(_d, k);
    _d.set(spread + 0.25, 0.3 - this.deathSeed * 0.25, 0.16 * dir);
    this.handT[1].lerp(_d, k);
    this.gunPos.lerp(_d.set(-spread - 0.3, -0.1, 0.25 * dir), k);
    this.gunQuat.slerp(S.qDead, k);
    this.gun.position.copy(this.gunPos);
    this.gun.quaternion.copy(this.gunQuat);
    const hipY = this.hips.position.y;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      _d.set(side * (0.14 + this.deathSeed * 0.1), -Math.min(hipY, 0.9) + rig.ankleY * 0.6, (i === 0 ? 0.12 : -0.05) * (0.5 + this.deathSeed));
      this.footT[i].lerp(_d, k);
    }
    this.solveLimbs([0.5, 0.5]);
  }
}

const LEVEL_ROSTERS: Record<string, ModelKind[]> = {
  highseas: [
    'marine_lead', 'marine_heavy', 'marine_tech',
    'rifleman', 'rusher', 'sniper', 'specops', 'breacher', 'heavy',
    'hostage_crew', 'hostage_captain', 'boss_kronos',
  ],
  oilfield: [
    'marine_lead', 'marine_heavy', 'marine_tech',
    'rifleman', 'rusher', 'sniper', 'specops', 'breacher', 'heavy',
    'boss_viper',
  ],
  survival: [
    'rifleman', 'rusher', 'sniper', 'specops', 'breacher', 'heavy',
    'boss_tyrant',
  ],
  training: [
    'instructor', 'medic', 'guard', 'shooter', 'eod', 'friendly',
    'rifleman', 'rusher', 'breacher', 'heavy',
  ],
};

/**
 * Pre-bakes all character skeletons, 2K remapped uniform textures, tactical kits, and Boss models
 * for the given level during the loading screen, and temporarily mounts them into `scene` so
 * `Renderer.prewarmLevel` uploads their VBOs, textures, and SkinnedMesh shaders before gameplay begins.
 */
export async function prewarmSoldiersForLevel(
  levelId: string,
  scene: THREE.Scene,
  onStep: (frac: number) => Promise<void>,
): Promise<SoldierModel[]> {
  const roster = LEVEL_ROSTERS[levelId] ?? LEVEL_ROSTERS.survival;
  const dummyModels: SoldierModel[] = [];
  for (let i = 0; i < roster.length; i++) {
    const kind = roster[i];
    const asset = MODEL_OF_KIND[kind] ?? 'soldier';
    const needsBake = !RIGS[asset] || !RIGS[asset]?.mats[kind];
    const m = new SoldierModel(kind);
    m.root.position.set(i * 1.5 - 10, -45, 0);
    m.root.updateMatrixWorld(true);
    m.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
    });
    scene.add(m.root);
    dummyModels.push(m);
    if (needsBake) {
      await onStep((i + 1) / roster.length);
    }
  }
  return dummyModels;
}
