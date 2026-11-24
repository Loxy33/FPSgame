import * as THREE from 'three';
import { audio } from '../core/audio';
import { angleDiff, clamp, damp, rand, randInt } from '../core/utils';
import { buildEnemyBrain, makeIntent, type EnemyAgent, type EnemyBB, type EnemyIntent } from '../ai/enemyBrain';
import type { BTNode } from '../ai/bt';
import type { Effects } from '../render/fx';
import type { Renderer } from '../render/renderer';
import type { NavGrid } from '../world/nav';
import { makeHit, rayCapsuleY, raySphere, type World } from '../world/physics';
import { isBossKind, SoldierModel, type SoldierKind } from './soldier';

export interface EnemyStats {
  hp: number; speed: number; dmg: number; rpm: number;
  burst: [number, number]; rest: [number, number];
  /** Preferred engagement band (m). */
  near: number; far: number;
  acc: number; sound: string; rate: number; score: number; label: string;
  isBoss?: boolean;
  bossTitle?: string;
}

export const ENEMY_STATS: Record<SoldierKind, EnemyStats> = {
  rifleman: {
    hp: 75, speed: 3.0, dmg: 5, rpm: 500, burst: [2, 4], rest: [1.1, 2.0],
    near: 8, far: 34, acc: 0.34, sound: 'ak', rate: 1, score: 100, label: '突击步枪兵',
  },
  rusher: {
    hp: 65, speed: 4.1, dmg: 4, rpm: 740, burst: [3, 6], rest: [0.8, 1.4],
    near: 3, far: 14, acc: 0.30, sound: 'smg', rate: 1.1, score: 125, label: '近战突击手',
  },
  heavy: {
    hp: 220, speed: 1.9, dmg: 6, rpm: 560, burst: [6, 10], rest: [1.8, 2.8],
    near: 7, far: 32, acc: 0.28, sound: 'ak', rate: 0.75, score: 350, label: '重装机枪手',
  },
  sniper: {
    hp: 65, speed: 2.8, dmg: 26, rpm: 40, burst: [1, 1], rest: [2.8, 3.8],
    near: 20, far: 65, acc: 0.52, sound: 'ak', rate: 0.6, score: 250, label: '暗哨狙击手',
  },
  breacher: {
    hp: 115, speed: 3.3, dmg: 9, rpm: 240, burst: [2, 3], rest: [1.1, 1.8],
    near: 4, far: 18, acc: 0.38, sound: 'smg', rate: 0.9, score: 220, label: '防暴突破手',
  },
  specops: {
    hp: 95, speed: 3.6, dmg: 6, rpm: 560, burst: [3, 5], rest: [0.95, 1.7],
    near: 6, far: 36, acc: 0.42, sound: 'ak', rate: 1.05, score: 280, label: '特战精锐',
  },
  boss_kronos: {
    hp: 1850, speed: 2.75, dmg: 10, rpm: 860, burst: [10, 18], rest: [0.95, 1.55],
    near: 6, far: 42, acc: 0.42, sound: 'ak', rate: 0.66, score: 2600,
    label: '铁锚·克洛诺斯', isBoss: true, bossTitle: '泰山号船艏重甲处刑者 // 宙斯盾力场与集束迫击炮',
  },
  boss_viper: {
    hp: 1650, speed: 4.35, dmg: 18, rpm: 320, burst: [4, 6], rest: [0.8, 1.3],
    near: 10, far: 52, acc: 0.54, sound: 'ak', rate: 0.85, score: 3000,
    label: '指挥官·毒蛇', isBoss: true, bossTitle: '厄普西隆沙漠猎杀外骨骼 // 幽灵瞬移与电磁轨道炮',
  },
  boss_tyrant: {
    hp: 2100, speed: 3.15, dmg: 12, rpm: 580, burst: [8, 14], rest: [0.95, 1.5],
    near: 6, far: 44, acc: 0.44, sound: 'ak', rate: 0.62, score: 2800,
    label: '赤沙暴君', isBoss: true, bossTitle: '哈迪尔叛军重装霸主 // 太阳神光束炮与焦土火海',
  },
};

/** Everything an enemy needs to know about the outside world. */
export interface EnemyEnv {
  world: World;
  nav: NavGrid;
  fx: Effects;
  r: Renderer;
  enemies: Enemy[];
  /** Player feet position / eye position / velocity. */
  playerPos: THREE.Vector3;
  playerEye: THREE.Vector3;
  playerVel: THREE.Vector3;
  playerAlive: boolean;
  playerCrouch: number;
  /** Global accuracy multiplier (difficulty ramp). */
  accMult: number;
  hurtPlayer(dmg: number, from: THREE.Vector3): void;
}

export type HitPart = 'head' | 'torso' | 'limb';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = makeHit();
const RADIUS = 0.36;
let nextId = 1;

// Shared GPU geometries for 3A volumetric sniper infrared laser beam, optic scope glint, surface dot & Boss hex-shield dome
let sniperBeamGeo: THREE.BufferGeometry | null = null;
let sniperQuadGeo: THREE.BufferGeometry | null = null;
let bossShieldGeo: THREE.SphereGeometry | null = null;
let alertTex: THREE.CanvasTexture | null = null;

function getBossShieldGeo(): THREE.SphereGeometry {
  if (!bossShieldGeo) bossShieldGeo = new THREE.SphereGeometry(1.48, 28, 20);
  return bossShieldGeo;
}

interface BossPendingStrike {
  kind:
    | 'carpet'
    | 'orbital'
    | 'prism_rail'
    | 'mine_det'
    | 'laser_wall'
    | 'magma_geyser'
    | 'meteor'
    | 'supernova';
  pos: THREE.Vector3;
  pos2?: THREE.Vector3;
  t: number;
  radius: number;
  dmg: number;
  color: number;
  scale: number;
  angleOff?: number;
}

interface BossPylon {
  pos: THREE.Vector3;
  t: number;
  zapCd: number;
}

interface BossClone {
  pos: THREE.Vector3;
  t: number;
  fireCd: number;
}

interface BossLavaZone {
  pos: THREE.Vector3;
  radius: number;
  t: number;
  tickCd: number;
}
let suspTex: THREE.CanvasTexture | null = null;
let lastAlertAudioAt = 0;
let pathBudgetUsed = 0;
const MAX_PATHS_PER_FRAME = 2;

/** Reset per-frame A* pathfinding budget once at the start of each simulation tick so mass alerts never spike CPU. */
export function resetEnemyPathBudget() {
  pathBudgetUsed = 0;
}

function getAlertTex(kind: 'alert' | 'suspicious'): THREE.CanvasTexture {
  if (kind === 'alert' && alertTex) return alertTex;
  if (kind === 'suspicious' && suspTex) return suspTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);

  const isAlert = kind === 'alert';
  // Tactical diamond badge with soft outer glow
  ctx.save();
  ctx.translate(64, 64);
  ctx.shadowColor = isAlert ? 'rgba(255, 48, 36, 0.95)' : 'rgba(255, 196, 48, 0.92)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(0, -46);
  ctx.lineTo(40, 0);
  ctx.lineTo(0, 46);
  ctx.lineTo(-40, 0);
  ctx.closePath();
  ctx.fillStyle = isAlert ? 'rgba(185, 22, 18, 0.92)' : 'rgba(180, 118, 12, 0.92)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = isAlert ? '#ff8b7a' : '#ffe388';
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 62px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isAlert ? '!' : '?', 0, 3);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  if (isAlert) alertTex = tex;
  else suspTex = tex;
  return tex;
}

function getSniperBeamGeo(): THREE.BufferGeometry {
  if (sniperBeamGeo) return sniperBeamGeo;
  const g = new THREE.BufferGeometry();
  // 4 corners: aCorner.x = side (-1..+1), aCorner.y = axial t (0 = origin, 1 = hit end)
  const pos = new Float32Array(4 * 3);
  const corners = new Float32Array([
    -1, 0, 0,
     1, 0, 0,
     1, 1, 0,
    -1, 1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  sniperBeamGeo = g;
  return g;
}

function getSniperQuadGeo(): THREE.BufferGeometry {
  if (sniperQuadGeo) return sniperQuadGeo;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(4 * 3);
  const corners = new Float32Array([
    -1, -1, 0,
     1, -1, 0,
     1,  1, 0,
    -1,  1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  sniperQuadGeo = g;
  return g;
}

export class Enemy implements EnemyAgent {
  id = nextId++;
  model: SoldierModel;
  stats: EnemyStats;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  alive = true;
  /** Seconds since death (corpse lifetime). */
  deadT = 0;
  removed = false;
  hitPart: HitPart = 'torso';
  hitShield = false;
  /** Time since this enemy last fired (for the minimap). */
  sinceShot = 99;

  /** Behaviour-tree output for this frame. */
  readonly intent: EnemyIntent = makeIntent();
  private brain: BTNode<EnemyBB>;
  private envRef!: EnemyEnv;
  private brainBB: EnemyBB = { a: this, env: undefined as unknown as EnemyEnv };

  // perception
  canSee = false;
  seenFor = 0;
  lostFor = 0;
  reaction = 0;
  distToTarget = 999;
  lastSeenT = 99;
  lastSeenX = 0;
  lastSeenZ = 0;

  // combat state
  suppressed = false;
  private suppressT = 0;
  inCover = false;
  coverX = 0;
  coverZ = 0;
  private coverT = 0;
  private mag = 30;
  private reloadT = 0;
  private coverHold = 0;

  // tactical roll state (grounded, readable human dive-roll — never teleporting!)
  private rollT = -1;
  private rollDur = 0.68;
  private rollDir = new THREE.Vector2(0, 1);
  private rollCooldown = rand(5.0, 9.0);
  private lastDt = 1 / 60;

  // 3A sniper volumetric IR laser beam, scope glint & raycasted surface dot
  private laserGroup: THREE.Group | null = null;
  private laserUniforms: {
    uStart: { value: THREE.Vector3 };
    uEnd: { value: THREE.Vector3 };
    uDotPos: { value: THREE.Vector3 };
    uTime: { value: number };
    uLock: { value: number };
    uAimAtCam: { value: number };
    uShowDot: { value: number };
  } | null = null;
  private laserAimPt = new THREE.Vector3();
  private laserAimInit = false;
  private laserChargeT = 0;

  private path: number[] = [];
  private pathI = 0;
  private repathT = 0;
  private navGoalX = Infinity;
  private navGoalZ = Infinity;
  private senseT = Math.random() * 0.2;
  private burstLeft = 0;
  private shotT = 0;
  private restT = rand(0.2, 0.8);
  private moveGoal = new THREE.Vector2();
  private hasGoal = false;
  private goalT = 0;
  private pitch = 0;
  private stuckT = 0;
  private lastX = 0;
  private lastZ = 0;
  private prefDist: number;
  private strafeDir = Math.random() < 0.5 ? -1 : 1;
  private stepAcc = 0;
  private fallSoundDone = false;
  private poolDone = false;
  private alerted = false;
  /** Acoustic suspicion timer (seconds): stealth sentry turns & cautiously checks heard noise. */
  suspicionT = 0;
  private suspicionX = 0;
  private suspicionZ = 0;
  /** Overhead tactical alert/suspicion icon state (`!` / `?`). */
  alertIconT = 0;
  alertIconKind: 'none' | 'suspicious' | 'alert' = 'none';
  private alertCd = 0;
  private shotAlertCd = 0;
  private alertSprite: THREE.Sprite | null = null;
  /** Flashbang stun timer (seconds): enemy flinches and cannot shoot. */
  stunT = 0;
  /** Stealth sentry mode: holds position/patrol quietly until alerted by sight or sound. */
  stealthIdle = false;
  /** Optional squad tag for campaign mission triggers. */
  tag = '';
  /** Optional patrol waypoints for stealth sentries. */
  patrolPts: [number, number][] | null = null;
  private patrolIdx = 0;
  private patrolWait = 0;

  /** Boss 2-phase overdrive, bespoke Phase 2 3D rig, unique archetype constructs & signature ultimates. */
  bossPhase: 1 | 2 = 1;
  bossShield = 0;
  bossMaxShield = 0;
  bossSkillLabel = '';
  bossSkillLabelT = 0;
  private bossShieldHitT = 0;
  private bossShieldMesh: THREE.Mesh | null = null;
  private bossShieldUniforms: {
    uTime: { value: number };
    uColor: { value: THREE.Color };
    uHit: { value: number };
    uRatio: { value: number };
    uAlpha: { value: number };
  } | null = null;
  private bossPhase2Rig: THREE.Group | null = null;
  private bossPhase2Spinners: THREE.Object3D[] = [];
  private bossAwakeningT = 0;
  private bossSpecialCd = 3.2;
  private bossSkillIdx = 0;
  private bossAuraAcc = 0;
  private bossOverdriveGunT = 0;
  private bossCycloneT = 0;
  private bossCycloneDropCd = 0;
  private bossPendingStrikes: BossPendingStrike[] = [];
  private bossPylons: BossPylon[] = [];
  private bossClones: BossClone[] = [];
  private bossLavaZones: BossLavaZone[] = [];
  onBossPhase2: (() => void) | null = null;

  get isBoss() {
    return isBossKind(this.kind);
  }

  stun(seconds: number) {
    if (!this.alive) return;
    // Bosses resist full flashbang stun (brief stagger only)
    this.stunT = Math.max(this.stunT, this.isBoss ? Math.min(seconds, 1.1) : seconds);
    this.model.flinch(this.isBoss ? 0.6 : 1.4);
  }

  wake() {
    this.stealthIdle = false;
    this.alerted = true;
    this.suspicionT = 0;
    this.reaction = Math.min(this.reaction, 0.35);
  }

  showAlertIcon(kind: 'suspicious' | 'alert', dur = 2.3) {
    if (!this.alive) return;
    if (this.alertIconKind === 'alert' && kind === 'suspicious' && this.alertIconT > 0.3) return;
    this.alertIconKind = kind;
    this.alertIconT = Math.max(this.alertIconT, dur);
    if (!this.alertSprite) {
      const mat = new THREE.SpriteMaterial({
        map: getAlertTex(kind),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.renderOrder = 22;
      sp.userData.noAo = true;
      sp.position.set(0, 2.18 * this.model.scale, 0);
      sp.scale.setScalar(0.56);
      this.model.root.add(sp);
      this.alertSprite = sp;
    } else {
      const mat = this.alertSprite.material as THREE.SpriteMaterial;
      const tex = getAlertTex(kind);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
    this.alertSprite.visible = true;
  }

  private updateAlertSprite(dt: number, distToPlayer: number) {
    if (this.alertCd > 0) this.alertCd = Math.max(0, this.alertCd - dt);
    if (this.shotAlertCd > 0) this.shotAlertCd = Math.max(0, this.shotAlertCd - dt);
    if (this.alertIconT > 0) {
      this.alertIconT = Math.max(0, this.alertIconT - dt);
      if (this.alertSprite) {
        const show = this.alive && this.alertIconT > 0 && distToPlayer < 52;
        this.alertSprite.visible = show;
        if (show) {
          const fade = clamp(this.alertIconT / 0.55, 0, 1);
          const pop = this.alertIconT > 1.9 ? 1.18 : 1.0;
          const sc = (0.48 + clamp(distToPlayer * 0.012, 0, 0.42)) * pop;
          this.alertSprite.scale.setScalar(sc);
          this.alertSprite.position.y = (2.16 + Math.sin(this.alertIconT * 6.5) * 0.04) * this.model.scale;
          (this.alertSprite.material as THREE.SpriteMaterial).opacity = fade;
        }
      }
      if (this.alertIconT <= 0) this.alertIconKind = 'none';
    } else if (this.alertSprite && this.alertSprite.visible) {
      this.alertSprite.visible = false;
    }
  }

  private cleanupAlertSprite() {
    if (!this.alertSprite) return;
    this.alertSprite.removeFromParent();
    (this.alertSprite.material as THREE.SpriteMaterial).dispose();
    this.alertSprite = null;
  }

  constructor(public kind: SoldierKind, x: number, z: number, hpMult = 1) {
    this.stats = ENEMY_STATS[kind] || ENEMY_STATS.rifleman;
    this.hp = this.stats.hp * hpMult;
    this.maxHp = this.hp;
    this.model = new SoldierModel(kind);
    this.pos.set(x, 0, z);
    this.lastX = x;
    this.lastZ = z;
    this.lastSeenX = x;
    this.lastSeenZ = z;
    this.prefDist = rand(this.stats.near + 2, this.stats.far * 0.75);
    this.model.root.position.copy(this.pos);
    this.brain = buildEnemyBrain();
    const origDispose = this.model.dispose.bind(this.model);
    this.model.dispose = () => {
      this.cleanupLaser();
      this.cleanupAlertSprite();
      this.cleanupBossShield();
      this.cleanupBossPhase2Rig();
      this.bossPendingStrikes.length = 0;
      this.bossPylons.length = 0;
      this.bossClones.length = 0;
      this.bossLavaZones.length = 0;
      origDispose();
    };
  }

  get height() {
    return 1.78 * this.model.scale;
  }

  /** Chest position, used for explosions / line-of-sight. */
  chest(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + 1.2 * this.model.scale, this.pos.z);
  }

  /** Trigger a grounded, readable tactical combat roll (strictly rate-limited). */
  triggerRoll(dirX: number, dirZ: number) {
    if (!this.alive || this.model.isRolling || this.stunT > 0 || this.kind === 'heavy' || this.kind === 'boss_kronos' || this.kind === 'boss_tyrant' || this.rollCooldown > 0) return;
    this.rollT = 0;
    this.rollCooldown = rand(8.5, 13.5);
    this.burstLeft = 0;
    this.restT = Math.max(this.restT, this.rollDur + 0.45);
    const len = Math.hypot(dirX, dirZ) || 1;
    this.rollDir.set(dirX / len, dirZ / len);
    this.model.roll(dirX, dirZ, this.rollDur);
  }

  /** Ray vs. hit volumes. Returns distance or -1; sets `hitPart`. */
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number) {
    if (!this.alive) return -1;
    const s = this.model.scale;
    const px = this.pos.x, py = this.pos.y, pz = this.pos.z;

    // Tactical Roll: realistic crouching/rolling volume (still cleanly hittable, not invincible!)
    if (this.model.isRolling) {
      const tRoll = rayCapsuleY(ox, oy, oz, dx, dy, dz, px, pz, py + 0.12 * s, py + 0.95 * s, 0.42 * s);
      if (tRoll >= 0 && tRoll < maxT) {
        this.hitPart = 'torso';
        return tRoll;
      }
      return -1;
    }

    // Quick reject against bounding sphere (expanded while Boss hex-shield dome is active)
    const cullRad = this.isBoss && this.bossShield > 0 ? 1.62 * s : 1.15 * s;
    if (raySphere(ox, oy, oz, dx, dy, dz, px, py + 0.98 * s, pz, cullRad) < 0) return -1;

    // Breacher riot shield deflection: intercepts frontal shots
    this.hitShield = false;
    if (this.kind === 'breacher' && this.model.shieldMesh) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const dot = dx * fx + dz * fz;
      if (dot < -0.15) {
        const shPos = this.model.shieldMesh.getWorldPosition(_c);
        const tShield = raySphere(ox, oy, oz, dx, dy, dz, shPos.x, shPos.y, shPos.z, 0.45 * s);
        if (tShield >= 0 && tShield < maxT) {
          this.hitShield = true;
          this.hitPart = 'torso';
          return tShield;
        }
      }
    }

    let best = -1;
    let t = raySphere(ox, oy, oz, dx, dy, dz, px, py + 1.645 * s, pz, 0.155 * s);
    if (t >= 0 && t < maxT) {
      best = t;
      this.hitPart = 'head';
    }
    t = rayCapsuleY(ox, oy, oz, dx, dy, dz, px, pz, py + 1.0 * s, py + 1.38 * s, 0.25 * s);
    if (t >= 0 && t < maxT && (best < 0 || t < best - 0.02)) {
      best = t;
      this.hitPart = 'torso';
    }
    t = rayCapsuleY(ox, oy, oz, dx, dy, dz, px, pz, py + 0.2 * s, py + 0.8 * s, 0.2 * s);
    if (t >= 0 && t < maxT && (best < 0 || t < best)) {
      best = t;
      this.hitPart = 'limb';
    }
    if (best < 0 && this.isBoss && this.bossShield > 0) {
      const tDome = raySphere(ox, oy, oz, dx, dy, dz, px, py + 1.08 * s, pz, 1.48 * s);
      if (tDome >= 0 && tDome < maxT) {
        best = tDome;
        this.hitPart = 'torso';
      }
    }
    return best;
  }

  /** Apply damage. Returns true if this killed the enemy. */
  damage(amount: number, dir: THREE.Vector3, env: EnemyEnv) {
    if (!this.alive) return false;

    // Breacher riot shield blocks 60% of frontal damage
    if (this.hitShield) {
      this.hitShield = false;
      amount *= 0.4;
      const shPos = this.model.shieldMesh?.getWorldPosition(_c) || this.pos;
      env.fx.impact(shPos, new THREE.Vector3(0, 0, 1), 'metal', true);
      audio.playAt('imp_metal', this.pos, { vol: 0.85, rateVar: 0.2, refDist: 6 });
      this.model.flinch(0.22);
    }

    // Boss Hexagonal Energy Shield Dome absorbs damage first (headshots shred 1.25x faster!)
    if (this.isBoss && this.bossShield > 0) {
      const shieldDmg = this.hitPart === 'head' ? amount * 1.25 : amount;
      this.bossShield = Math.max(0, this.bossShield - shieldDmg);
      this.bossShieldHitT = 1.0;
      this.stealthIdle = false;
      this.suspicionT = 0;
      this.alert(env);
      const hitCenter = _c.set(this.pos.x - dir.x * 1.1, this.pos.y + 1.35 * this.model.scale, this.pos.z - dir.z * 1.1);
      env.fx.impact(hitCenter, _b.copy(dir).negate(), 'metal', false);
      audio.playAt('imp_metal', this.pos, { vol: 0.9, rate: 1.32, rateVar: 0.14, refDist: 10 });
      if (this.bossShield <= 0) {
        // Shield shatter! Big energy burst + shockwave + 1.1s tactical stagger punish window!
        const shCol = this.bossThemeColor(true);
        const burstPos = _c.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
        env.fx.energyBurst(burstPos, shCol, 1.35);
        env.fx.shockwaveRing(burstPos, 9.5, 0.72, shCol);
        env.r.flash(_b.set(this.pos.x, this.pos.y + 1.6, this.pos.z), shCol, 680, 0.48, 30);
        audio.playAt('explosion', this.pos, { vol: 0.95, rate: 1.25, refDist: 22, reverb: 0.55 });
        this.stun(1.1);
        this.bossSkillLabel = '⚡ 能量护盾击破 · 装甲硬直！';
        this.bossSkillLabelT = 2.0;
        if (this.bossShieldMesh) this.bossShieldMesh.visible = false;
      }
      return false;
    }

    // Brief 80% armor hardening during dramatic 1.6s Phase II Awakening transformation!
    if (this.isBoss && this.bossAwakeningT > 0) {
      amount *= 0.2;
    }

    const wasStealth = this.stealthIdle;
    this.hp -= amount;
    this.model.flinch(clamp(amount / 75, 0.2, 0.7));
    this.stealthIdle = false;
    this.suspicionT = 0;
    this.alert(env);

    // Nearby teammates within 8.5m hear/notice a buddy getting hit or dropping!
    for (const peer of env.enemies) {
      if (peer === this || !peer.alive) continue;
      peer.hearShot(this.pos.x, this.pos.y, this.pos.z, 8.5, true, env, 'impact');
    }

    if (this.hp <= 0) {
      this.alive = false;
      this.cleanupLaser();
      this.cleanupAlertSprite();
      this.cleanupBossShield();
      this.cleanupBossPhase2Rig();
      this.bossPendingStrikes.length = 0;
      this.bossPylons.length = 0;
      this.bossClones.length = 0;
      this.bossLavaZones.length = 0;
      if (this.isBoss) {
        const col = this.bossThemeColor(false);
        const dPos = _c.set(this.pos.x, this.pos.y + 0.2, this.pos.z);
        env.fx.energyBurst(dPos, col, 1.6);
        env.fx.shockwaveRing(dPos, 13, 0.9, col);
        env.r.flash(_b.set(this.pos.x, this.pos.y + 1.8, this.pos.z), col, 820, 0.65, 36);
      }
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const fromBehind = dir.x * fx + dir.z * fz > 0.2;
      this.model.die(fromBehind);
      this.vel.set(dir.x * 1.2, 0, dir.z * 1.2);
      return true;
    }

    // Surviving a hit immediately focuses attention back toward the shooter
    this.lastSeenX = env.playerPos.x;
    this.lastSeenZ = env.playerPos.z;
    this.lastSeenT = 0.2;
    if (wasStealth) this.showAlertIcon('alert', 2.2);

    // Occasional grounded tactical dodge roll ONLY for elite/agile troops on long cooldown (never spam!)
    if ((this.kind === 'specops' || this.kind === 'rusher') && this.rollCooldown <= 0 && Math.random() < 0.18) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.triggerRoll(-dir.z * side, dir.x * side);
    }

    // Getting shot staggers burst and disrupts enemy aim (Heavy & Boss exosuits shrug off light hit-flinch!)
    if (this.kind !== 'heavy' && !this.isBoss) {
      this.burstLeft = 0;
      this.restT = Math.max(this.restT, rand(0.45, 0.85));
      if (this.canSee && Math.random() < 0.45) this.pickCombatMove(env, true);
    }
    return false;
  }

  /** Bullets snapping past: realistic suppression (duck/seek cover, no ninja-rolling). */
  suppress() {
    if (this.isBoss) return;
    this.suppressed = true;
    this.suppressT = 2.6;
    this.burstLeft = 0;
    this.restT = Math.max(this.restT, 0.55);
  }

  /**
   * Acoustic perception for gunshots, bullet impacts, and explosions.
   * Unsuppressed gunshots & explosions break stealth and draw nearby enemies to investigate/engage;
   * suppressed shots & near-impacts trigger cautious `?` investigation (escalating to `!` on repeat).
   */
  hearShot(
    x: number,
    y: number,
    z: number,
    radius = 48,
    suppressed = false,
    env?: EnemyEnv,
    kind: 'shot' | 'impact' = 'shot',
  ) {
    if (!this.alive || this.stunT > 0) return;
    const horiz = Math.hypot(x - this.pos.x, z - this.pos.z);
    // Compare against enemy ear height (~1.45m) with 0.85m same-floor tolerance so level-ground shots get zero vertical penalty
    const dy = Math.max(0, Math.abs(y - (this.pos.y + 1.45)) - 0.85);
    // Floor/deck separation dampens acoustics naturally so multi-deck ships feel realistic
    let effDist = horiz + dy * 2.2;
    if (effDist > radius) return;
    if (env && horiz > 3.0) {
      _a.set(this.pos.x, this.pos.y + 1.5 * this.model.scale, this.pos.z);
      _b.set(x, y + 0.35, z);
      if (!env.world.lineOfSight(_a, _b)) effDist *= 1.25;
      if (effDist > radius) return;
    }

    if (this.stealthIdle) {
      // Unsuppressed gunfire, close-range suppressed fire, or a second sound while already suspicious => FULL ALERT!
      const escalate = (!suppressed && kind === 'shot')
        || (kind === 'shot' && effDist <= radius * 0.52)
        || this.suspicionT > 0.15;
      if (escalate) {
        this.wake();
        this.lastSeenX = x;
        this.lastSeenZ = z;
        this.lastSeenT = 0.2;
        this.repathT = Math.min(this.repathT, rand(0.04, 0.34));
        // Immediate head/body turn reflex toward the gunshot
        const toSound = Math.atan2(x - this.pos.x, z - this.pos.z);
        this.yaw += angleDiff(this.yaw, toSound) * 0.65;
        this.showAlertIcon('alert', 2.4);
        this.alertCd = 4.5;
        const now = performance.now();
        if (now - lastAlertAudioAt > 650 && horiz < 42) {
          lastAlertAudioAt = now;
          audio.playAt('radio', this.pos, { vol: 0.28, rate: rand(0.96, 1.14), refDist: 10 });
        }
      } else {
        // Single distant suppressed shot or nearby bullet impact => cautious '?' investigation
        this.suspicionT = Math.max(this.suspicionT, 6.5);
        this.suspicionX = x;
        this.suspicionZ = z;
        this.showAlertIcon('suspicious', 2.8);
      }
      return;
    }

    // Already awake: update acoustic tracking when we don't currently have direct LOS
    if (!this.canSee) {
      const freshlyAlerted = !this.alerted || this.lastSeenT > 5.0;
      this.alerted = true;
      if (this.reaction > 0.45) this.reaction = 0.45;
      this.lastSeenX = x;
      this.lastSeenZ = z;
      this.lastSeenT = Math.min(this.lastSeenT, 0.35);
      this.repathT = Math.min(this.repathT, rand(0.05, 0.34));
      if (freshlyAlerted && this.alertCd <= 0) {
        this.showAlertIcon('alert', 2.0);
        this.alertCd = 5.0;
      }
    }
  }

  alert(env: EnemyEnv) {
    if (!this.alerted) {
      this.alerted = true;
      this.reaction = Math.min(this.reaction, 0.55);
    }
    this.repathT = Math.min(this.repathT, rand(0.05, 0.32));
    void env;
  }

  private repath(env: EnemyEnv, tx: number, tz: number) {
    // Respect per-frame A* budget so alerting 6-12 enemies in one gunshot spreads smoothly over 2-3 frames with 0ms hitch!
    if (pathBudgetUsed >= MAX_PATHS_PER_FRAME) {
      this.repathT = rand(0.04, 0.12);
      return this.path.length > 0;
    }
    pathBudgetUsed++;
    this.navGoalX = tx;
    this.navGoalZ = tz;
    const ok = env.nav.findPath(this.pos.x, this.pos.z, tx, tz, this.path);
    this.pathI = 0;
    if (!ok) {
      this.path.length = 0;
      // Back off on unreachable elevated/gated targets so snipers on cliffs never spam A*
      this.repathT = rand(2.2, 3.6);
    } else {
      this.repathT = rand(0.75, 1.25) + (Math.hypot(tx - this.pos.x, tz - this.pos.z) > 40 ? 0.8 : 0);
    }
    return ok;
  }

  private followPath(): boolean {
    if (this.pathI >= this.path.length) return false;
    let tx = this.path[this.pathI], tz = this.path[this.pathI + 1];
    let ddx = tx - this.pos.x, ddz = tz - this.pos.z;
    let d = Math.hypot(ddx, ddz);
    if (d < 0.45) {
      this.pathI += 2;
      if (this.pathI < this.path.length) {
        tx = this.path[this.pathI];
        tz = this.path[this.pathI + 1];
        ddx = tx - this.pos.x;
        ddz = tz - this.pos.z;
        d = Math.hypot(ddx, ddz);
      }
    }
    if (d <= 0.01 || this.pathI >= this.path.length) return false;
    this.intent.moveX = ddx / d;
    this.intent.moveZ = ddz / d;
    return true;
  }

  travelTo(x: number, z: number, speedMul = 1) {
    const env = this.envRef;
    this.repathT -= this.lastDt;
    if (this.repathT <= 0 || (this.repathT < 0.2 && Math.hypot(this.navGoalX - x, this.navGoalZ - z) > 2.4)) {
      this.repath(env, x, z);
    }
    this.intent.speedMul = speedMul;
    return this.followPath();
  }

  advance(env: EnemyEnv) {
    this.intent.speedMul *= 0.9;
    if (this.repathT <= 0 || this.pathI >= this.path.length) {
      this.repath(env, env.playerPos.x, env.playerPos.z);
    }
    this.followPath();
  }

  hold() {
    this.intent.moveX = 0;
    this.intent.moveZ = 0;
    this.path.length = 0;
    this.pathI = 0;
  }

  combatMove(env: EnemyEnv, urgent: boolean) {
    this.goalT -= this.lastDt;
    const reached = !this.hasGoal || Math.hypot(this.moveGoal.x - this.pos.x, this.moveGoal.y - this.pos.z) < 0.45;
    if (reached || this.goalT <= 0) {
      if (!this.pickCombatMove(env, urgent)) return false;
    }
    this.travelTo(this.moveGoal.x, this.moveGoal.y, this.kind === 'rusher' ? 0.95 : 0.75);
    return true;
  }

  seekCover(env: EnemyEnv) {
    this.coverT -= this.lastDt;
    if (this.coverT <= 0 || (this.coverX === 0 && this.coverZ === 0)) {
      if (!this.findCover(env)) return false;
    }
    const d = Math.hypot(this.coverX - this.pos.x, this.coverZ - this.pos.z);
    this.inCover = d < 1.5;
    if (this.inCover) {
      this.hold();
      this.intent.speedMul = 0;
    } else {
      this.travelTo(this.coverX, this.coverZ, 1.2);
    }
    return true;
  }

  private findCover(env: EnemyEnv): boolean {
    const px = env.playerPos.x, pz = env.playerPos.z;
    let best = -1;
    let bx = 0, bz = 0;
    for (const c of env.world.colliders) {
      if (!c.enabled || c.noRay) continue;
      if (c.maxY < 1.05 || c.maxY - c.minY < 0.9) continue;
      const cx = c.cx, cz = c.cz;
      const toSelf = Math.hypot(cx - this.pos.x, cz - this.pos.z);
      if (toSelf > 16) continue;
      const dx = cx - px, dz = cz - pz;
      const len = Math.hypot(dx, dz) || 1;
      const reach = Math.max(c.hx, c.hz) + 0.85;
      const gx = cx + (dx / len) * reach;
      const gz = cz + (dz / len) * reach;
      if (!env.nav.isFree(gx, gz)) continue;
      let taken = false;
      for (const o of env.enemies) {
        if (o === this || !o.alive) continue;
        if (Math.hypot(o.coverX - gx, o.coverZ - gz) < 1.6) {
          taken = true;
          break;
        }
      }
      if (taken) continue;
      _a.set(gx, this.pos.y + 1.2, gz);
      if (env.world.lineOfSight(env.playerEye, _a)) continue;
      const score = toSelf + Math.hypot(gx - px, gz - pz) * 0.35;
      if (best < 0 || score < best) {
        best = score;
        bx = gx;
        bz = gz;
      }
    }
    if (best < 0) return false;
    this.coverX = bx;
    this.coverZ = bz;
    this.coverT = rand(4, 6);
    return true;
  }

  get needsReload() {
    return this.reloadT > 0 || this.mag <= 0;
  }

  private pickCombatMove(env: EnemyEnv, urgent: boolean) {
    const p = env.playerPos;
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist, nz = dz / dist;
    for (let tries = 0; tries < 6; tries++) {
      const side = (Math.random() < 0.75 ? this.strafeDir : -this.strafeDir) * rand(2.5, urgent ? 7 : 5.5);
      let radial = clamp(this.prefDist - dist, -5, 5) * rand(0.4, 1);
      if (this.kind === 'rusher') radial = -rand(0, 3);
      const gx = this.pos.x + -nz * side + nx * radial;
      const gz = this.pos.z + nx * side + nz * radial;
      if (!env.nav.isFree(gx, gz) || !env.nav.lineFree(this.pos.x, this.pos.z, gx, gz)) {
        if (tries === 2) this.strafeDir = -this.strafeDir;
        continue;
      }
      _a.set(gx, 1.5, gz);
      if (tries < 4 && !env.world.lineOfSight(_a, env.playerEye)) continue;
      this.moveGoal.set(gx, gz);
      this.hasGoal = true;
      this.goalT = rand(1.6, 3.0);
      this.inCover = false;
      if (Math.random() < 0.35) this.strafeDir = -this.strafeDir;
      return true;
    }
    return false;
  }

  /**
   * Pre-builds alert/suspicion icon textures and mounts temporary dummy alert sprites + sniper IR laser
   * meshes into `scene` during the loading screen so WebGL compiles all SpriteMaterial & sniper ShaderMaterials
   * upfront — eliminating any first-alert / first-sniper frame hitch during gameplay!
   */
  static prewarmVisuals(scene: THREE.Scene): () => void {
    const tAlert = getAlertTex('alert');
    const tSusp = getAlertTex('suspicious');
    const sMat1 = new THREE.SpriteMaterial({ map: tAlert, transparent: true, depthTest: false, depthWrite: false });
    const sMat2 = new THREE.SpriteMaterial({ map: tSusp, transparent: true, depthTest: false, depthWrite: false });
    const sp1 = new THREE.Sprite(sMat1);
    const sp2 = new THREE.Sprite(sMat2);
    // frustumCulled=false guarantees Three.js compiles SpriteMaterial & uploads alert/suspicion textures during prewarmAsync!
    sp1.frustumCulled = false;
    sp2.frustumCulled = false;
    sp1.userData.noAo = true;
    sp2.userData.noAo = true;
    sp1.position.set(0, -45, 0);
    sp2.position.set(1, -45, 0);
    scene.add(sp1, sp2);

    // Pre-compile all 3 custom sniper IR laser GLSL ShaderMaterials (beam, optic glint, surface dot)
    const dummy = new Enemy('sniper', 0, -45);
    dummy.ensureSniperLaser({ r: { scene } } as unknown as EnemyEnv);
    if (dummy.laserUniforms) {
      dummy.laserUniforms.uStart.value.set(0, -45, 0);
      dummy.laserUniforms.uEnd.value.set(0, -45, 2);
      dummy.laserUniforms.uDotPos.value.set(0, -45, 2);
    }

    // Pre-compile Boss 3D Fresnel Hexagonal Energy Shield Dome ShaderMaterial + Phase II Additive Rig upfront
    const dummyBoss = new Enemy('boss_kronos', 0, -45);
    dummyBoss.ensureBossShieldMesh();
    const shieldDome = dummyBoss.bossShieldMesh!;
    shieldDome.position.set(0, -45, 0);
    shieldDome.visible = true;
    if (dummyBoss.bossShieldUniforms) dummyBoss.bossShieldUniforms.uAlpha.value = 0.001;
    scene.add(shieldDome);

    dummyBoss.ensureBossPhase2Rig();
    const p2Rig = dummyBoss.bossPhase2Rig!;
    p2Rig.position.set(0, -45, 0);
    scene.add(p2Rig);

    return () => {
      scene.remove(sp1, sp2, shieldDome, p2Rig);
      sMat1.dispose();
      sMat2.dispose();
      dummy.cleanupLaser();
      dummyBoss.cleanupBossShield();
      dummyBoss.cleanupBossPhase2Rig();
      dummy.model.dispose();
      dummyBoss.model.dispose();
    };
  }

  private bossThemeColor(forShield = false): number {
    if (this.kind === 'boss_viper') return forShield ? 0x9e5bff : 0x38e8ff;
    if (this.kind === 'boss_tyrant') return forShield ? 0xffb824 : 0xff7b18;
    return forShield ? 0x38d8ff : 0xff3b24;
  }

  private ensureBossShieldMesh() {
    if (this.bossShieldMesh && this.bossShieldUniforms) return;
    const u = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(this.bossThemeColor(true)) },
      uHit: { value: 0 },
      uRatio: { value: 1 },
      uAlpha: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uHit;
        uniform float uRatio;
        uniform float uAlpha;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;

        // Procedural 2D hexagonal honeycomb edge distance
        float hexEdge(vec2 p) {
          p *= 1.1547;
          vec2 r = vec2(1.0, 1.73205);
          vec2 h = r * 0.5;
          vec2 a = mod(p, r) - h;
          vec2 b = mod(p - h, r) - h;
          vec2 gv = dot(a, a) < dot(b, b) ? a : b;
          float d = max(abs(gv.x), dot(abs(gv), normalize(r)));
          return smoothstep(0.41, 0.49, d);
        }

        void main() {
          // Soft bottom skirt fade so the dome anchors cleanly onto the deck/sand
          float bottomFade = smoothstep(-1.18, -0.58, vLocalPos.y);
          if (bottomFade < 0.01) discard;

          float ndotv = abs(dot(normalize(vNormalW), normalize(vViewDir)));
          float fresnel = pow(1.0 - clamp(ndotv, 0.0, 1.0), 2.35);

          // Spherical hex projection + upward plasma scan wave
          float ang = atan(vLocalPos.z, vLocalPos.x);
          vec2 hexUv = vec2(ang * 2.55, vLocalPos.y * 2.85 - uTime * 0.25);
          float hex = hexEdge(hexUv);
          float scan = exp(-pow(sin(vLocalPos.y * 2.4 - uTime * 3.1), 2.0) * 18.0) * 0.48;
          float lowFlicker = uRatio < 0.28 ? (0.62 + 0.38 * sin(uTime * 36.0)) : 1.0;

          float energy = (fresnel * 1.18 + hex * (0.28 + 0.55 * fresnel) + scan + uHit * 0.95) * bottomFade * lowFlicker;
          vec3 col = mix(uColor, vec3(1.0, 0.98, 0.96), clamp(uHit * 0.72 + fresnel * 0.35 + hex * 0.22, 0.0, 0.9));
          gl_FragColor = vec4(col * (1.35 + uHit * 1.15), clamp(energy * 0.72 * uAlpha, 0.0, 0.92));
        }
      `,
    });
    const mesh = new THREE.Mesh(getBossShieldGeo(), mat);
    mesh.position.set(0, 1.08, 0);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 14;
    mesh.userData.noAo = true;
    this.model.root.add(mesh);
    this.bossShieldMesh = mesh;
    this.bossShieldUniforms = u;
  }

  private cleanupBossShield() {
    if (!this.bossShieldMesh) return;
    this.bossShieldMesh.removeFromParent();
    (this.bossShieldMesh.material as THREE.Material).dispose();
    this.bossShieldMesh = null;
    this.bossShieldUniforms = null;
  }

  /** Mounts permanent Boss-specific 3D Phase II visual transformation rig onto model.root! */
  private ensureBossPhase2Rig() {
    if (this.bossPhase2Rig) return;
    const rig = new THREE.Group();
    this.bossPhase2Spinners = [];

    const addAdditiveMat = (hex: number, opacity = 0.88) =>
      new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    if (this.kind === 'boss_kronos') {
      // PHASE II 「深海铁幕 · 过载形态」: Twin shoulder EMP Tesla rings + crimson-cyan reactor halo!
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.048, 8, 32), addAdditiveMat(0xff3824, 0.9));
      halo.position.set(0, 1.82, -0.34);
      rig.add(halo);
      this.bossPhase2Spinners.push(halo);

      const innerHalo = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.032, 8, 24), addAdditiveMat(0x38e8ff, 0.85));
      innerHalo.position.set(0, 1.82, -0.36);
      rig.add(innerHalo);
      this.bossPhase2Spinners.push(innerHalo);

      for (const sx of [-0.72, 0.72]) {
        const pod = new THREE.Group();
        pod.position.set(sx, 1.98, -0.14);
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 1), addAdditiveMat(0x52f2ff, 0.95));
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 6, 20), addAdditiveMat(0x38d8ff, 0.88));
        r1.rotation.x = Math.PI * 0.5;
        pod.add(core, r1);
        rig.add(pod);
        this.bossPhase2Spinners.push(pod);
      }
    } else if (this.kind === 'boss_viper') {
      // PHASE II 「厄普西隆 · 量子超频形态」: 6 blazing neon cyan-magenta holographic Cyber-Wings + twin data rings!
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const len = 1.35 - i * 0.24;
          const blade = new THREE.Mesh(
            new THREE.BoxGeometry(len, 0.14 - i * 0.02, 0.03),
            addAdditiveMat(i === 1 ? 0x38f2ff : 0xc942ff, 0.92),
          );
          blade.position.set(side * (0.48 + len * 0.42), 1.72 - i * 0.22, -0.34 - i * 0.05);
          blade.rotation.z = side * (0.42 - i * 0.24);
          blade.rotation.y = -side * 0.34;
          rig.add(blade);
        }
      }
      for (const [ry, col, tilt] of [[1.12, 0x38f2ff, 0.24], [1.46, 0xd848ff, -0.28]] as [number, number, number][]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.028, 6, 32), addAdditiveMat(col, 0.86));
        ring.position.set(0, ry, 0);
        ring.rotation.x = Math.PI * 0.5 + tilt;
        rig.add(ring);
        this.bossPhase2Spinners.push(ring);
      }
    } else {
      // PHASE II 「太阳神 · 熔炉觉醒形态」: Blazing molten-gold Solar Crown Halo + twin orbiting volcanic ember rings!
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.055, 8, 32), addAdditiveMat(0xffb824, 0.95));
      crown.position.set(0, 2.08, -0.28);
      rig.add(crown);
      this.bossPhase2Spinners.push(crown);

      // 8 radiating golden solar spikes around the crown
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.44, 5), addAdditiveMat(0xffe066, 0.92));
        spike.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0);
        spike.rotation.z = a - Math.PI * 0.5;
        crown.add(spike);
      }
      for (const [ry, rad, tilt] of [[1.05, 1.05, 0.32], [1.48, 0.94, -0.36]] as [number, number, number][]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.036, 6, 32), addAdditiveMat(0xff5e14, 0.88));
        ring.position.set(0, ry, 0);
        ring.rotation.x = Math.PI * 0.5 + tilt;
        rig.add(ring);
        this.bossPhase2Spinners.push(ring);
      }
    }

    rig.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 14;
      o.userData.noAo = true;
    });
    this.model.root.add(rig);
    this.bossPhase2Rig = rig;
  }

  private cleanupBossPhase2Rig() {
    if (!this.bossPhase2Rig) return;
    this.bossPhase2Rig.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
        else m.material?.dispose();
      }
    });
    this.bossPhase2Rig.removeFromParent();
    this.bossPhase2Rig = null;
    this.bossPhase2Spinners = [];
  }

  private activateBossShield(amount: number, env: EnemyEnv, label: string) {
    this.ensureBossShieldMesh();
    this.bossShield = amount;
    this.bossMaxShield = amount;
    this.bossShieldHitT = 0.85;
    this.bossSkillLabel = label;
    this.bossSkillLabelT = 3.2;
    const shCol = this.bossThemeColor(true);
    if (this.bossShieldMesh && this.bossShieldUniforms) {
      this.bossShieldUniforms.uColor.value.setHex(shCol);
      this.bossShieldUniforms.uAlpha.value = 1;
      this.bossShieldMesh.visible = true;
    }
    const base = _a.set(this.pos.x, this.pos.y, this.pos.z);
    env.fx.energyBurst(base, shCol, 1.15);
    env.fx.shockwaveRing(base, 8.8, 0.72, shCol);
    env.r.flash(_b.set(this.pos.x, this.pos.y + 1.6, this.pos.z), shCol, 560, 0.45, 28);
    audio.playAt('horn', base, { vol: 0.72, rate: 1.25, refDist: 22, reverb: 0.5 });
  }

  /** Dramatic Phase II Awakening (<50% HP, also callable in debug tests): 3D rig evolution + awakening pillar + unlocks Ultimate! */
  enterPhase2(env: EnemyEnv) {
    if (this.bossPhase === 2) return;
    this.bossPhase = 2;
    this.bossAwakeningT = 1.6;
    this.model.setOverdrive(true);
    this.ensureBossPhase2Rig();
    this.bossSpecialCd = 1.9;
    this.bossSkillIdx = 3; // Immediately unleash Phase II Signature Ultimate right after Awakening!

    const p2Col = this.bossThemeColor(false);
    const shCol = this.bossThemeColor(true);
    const origin = this.pos.clone();
    _a.set(origin.x, origin.y + 1.6, origin.z);
    env.r.flash(_a, p2Col, 900, 0.75, 42);
    env.fx.orbitalPillar(origin, 2.2, 24, 1.45, p2Col, 0xffffff);
    env.fx.energyBurst(origin, p2Col, 1.65);
    env.fx.shockwaveRing(origin, 14.0, 0.95, p2Col);
    env.fx.shockwaveRing(origin, 9.5, 0.72, shCol);
    audio.playAt('horn', _a, { vol: 1.0, rate: 0.88, reverb: 0.72, refDist: 32 });

    if (this.kind === 'boss_kronos') {
      // Only Kronos (heavy fortress tank) gains an emergency Aegis Shield on Phase II Awakening
      this.activateBossShield(360, env, '⚡ 二阶段觉醒【铁幕过载】· 轨道离子卫星已就绪！');
    } else if (this.kind === 'boss_viper') {
      env.fx.hazardZone(origin, 5.2, 4.0, 'void');
      this.bossSkillLabel = '⚡ 二阶段觉醒【量子超频】· 全息光翼与光栅矩阵解锁！';
      this.bossSkillLabelT = 3.8;
    } else {
      env.fx.hazardZone(origin, 5.8, 5.5, 'lava');
      this.bossLavaZones.push({ pos: origin.clone(), radius: 5.2, t: 5.5, tickCd: 0.5 });
      this.bossSkillLabel = '🔥 二阶段觉醒【太阳神熔炉】· 焦土超新星已就绪！';
      this.bossSkillLabelT = 3.8;
    }
    this.onBossPhase2?.();
  }

  /**
   * Executes completely distinct signature skills for each Boss (ZERO cross-Boss homogeneity!):
   * - boss_kronos (Naval Artillery & EMP Fortress):
   *     0 = 舰炮饱和弹幕 (sweeping linear bombardment runway)
   *     1 = 宙斯盾特斯拉电弧阵 (3 floating EMP pylons tethering crackling 3D lightning arcs)
   *     2 = 四管加特林超载扫射 (high-RPM rotary overdrive + crimson surge)
   *     3 = [二阶段终极技] 轨道离子卫星打击 (3 colossal sky-to-deck 28m ion pillars + EMP zones)
   * - boss_viper (Cyber-Holo High-Speed Assassin):
   *     0 = 全息幻影三连分身 (lateral blink + 2 translucent neon holo-clones firing flanking beams)
   *     1 = 棱镜三联轨道炮 (3-way fan volumetric violet-cyan railgun lances)
   *     2 = 量子奇点浮游雷 (5 floating wireframe octahedron stasis mines + void grids)
   *     3 = [二阶段终极技] 厄普西隆光栅切割 (sweeping neon holographic laser-grid walls)
   * - boss_tyrant (Infernal Volcanic Warlord):
   *     0 = 炼狱熔岩裂隙 (3 radiating lines of erupting 9m volcanic flame geysers + lava DoT pools)
   *     1 = 太阳神陨石天降 (5 sky-falling blazing meteor streaks + burning lava craters)
   *     2 = 烈焰旋风冲锋 (fire-tornado cyclone dash dropping blazing magma trail)
   *     3 = [二阶段终极技] 焦土超新星 (growing miniature blazing Sun orb -> radial 8-pillar firestorm)
   */
  triggerBossSkill(skillIdx: number, env: EnemyEnv) {
    if (!this.alive || !this.isBoss) return;
    const p = env.playerPos;
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;
    const p2 = this.bossPhase === 2;
    const idx = ((skillIdx % 4) + 4) % 4;
    this.model.root.updateMatrixWorld(true);
    const mz = this.model.muzzle(_a).clone();

    // ==================== BOSS 1: 克洛诺斯 (重炮 × 电磁堡垒流) ====================
    if (this.kind === 'boss_kronos') {
      if (idx === 0) {
        // 1. 舰炮饱和弹幕 — 沿玩家推进线拉出 5~7 发线性饱和炮火走廊！
        const count = p2 ? 7 : 5;
        this.bossSkillLabel = '☄ 舰炮饱和弹幕 · 横向切出红色弹道带！';
        this.bossSkillLabelT = 3.0;
        const startD = Math.max(4.0, dist - (count - 1) * 1.9);
        for (let i = 0; i < count; i++) {
          const dAlong = startD + i * 3.5;
          const tx = this.pos.x + nx * dAlong + rand(-0.9, 0.9);
          const tz = this.pos.z + nz * dAlong + rand(-0.9, 0.9);
          const ty = env.world.groundHeight(tx, tz, p.y + 1.5, 0.5, 3.0);
          const pt = new THREE.Vector3(tx, ty, tz);
          const dur = 1.05 + i * 0.22;
          env.fx.telegraphRing(pt, 3.8, dur, 0xff3020);
          env.fx.tracer(mz, pt, 75, 0.85 + i * 0.12);
          this.bossPendingStrikes.push({
            kind: 'carpet', pos: pt, t: dur, radius: 4.1, dmg: p2 ? 26 : 19, color: 0xff3b20, scale: 0.82,
          });
        }
        env.fx.muzzle(mz, _dir.subVectors(p, mz).normalize(), 2.0);
        env.r.flash(mz, 0xff4218, 420, 0.35, 24);
        audio.playAt('explosion', mz, { vol: 0.78, rate: 1.32, refDist: 22 });
      } else if (idx === 1) {
        // 2. 宙斯盾特斯拉电弧阵 — 部署 3~4 座悬浮电磁塔，释放 3D 锯齿雷电链！
        const nPylons = p2 ? 4 : 3;
        this.bossSkillLabel = '⚡ 宙斯盾特斯拉电弧阵 · 远离高频雷电塔！';
        this.bossSkillLabelT = 3.4;
        const baseAng = Math.atan2(dz, dx);
        for (let i = 0; i < nPylons; i++) {
          const a = baseAng + (i / nPylons) * Math.PI * 2;
          const px = this.pos.x + Math.cos(a) * 6.4;
          const pz = this.pos.z + Math.sin(a) * 6.4;
          const py = env.world.groundHeight(px, pz, this.pos.y + 1.4, 0.5, 2.5);
          const floorPt = new THREE.Vector3(px, py, pz);
          const orbPt = new THREE.Vector3(px, py + 1.65, pz);
          env.fx.floatingOrb(orbPt, 0.52, 5.8, 0x38e8ff, 'pylon');
          env.fx.hazardZone(floorPt, 3.4, 5.8, 'emp');
          env.fx.lightningArc(
            new THREE.Vector3(this.pos.x, this.pos.y + 1.85, this.pos.z),
            orbPt,
            0x48f0ff,
            0.36,
            0.48,
          );
          this.bossPylons.push({ pos: orbPt, t: 5.8, zapCd: 0.35 + i * 0.14 });
        }
        env.r.flash(new THREE.Vector3(this.pos.x, this.pos.y + 2.0, this.pos.z), 0x38e8ff, 620, 0.45, 30);
        audio.playAt('horn', this.pos, { vol: 0.78, rate: 1.35, refDist: 24, reverb: 0.55 });
      } else if (idx === 2) {
        // 3. 四管加特林超载扫射 — 炮管过热喷射高密弹幕压制！
        this.bossSkillLabel = '🔥 四管加特林过载扫射 · 立刻寻找掩体！';
        this.bossSkillLabelT = 3.0;
        this.bossOverdriveGunT = p2 ? 3.5 : 2.6;
        this.mag = Math.max(this.mag, 44);
        this.reloadT = 0;
        this.burstLeft = p2 ? 28 : 18;
        this.restT = 0;
        this.shotT = 0.05;
        env.fx.energyBurst(this.pos, 0xff4818, 1.15);
        env.fx.shockwaveRing(this.pos, 6.5, 0.55, 0xff5a18);
        env.r.flash(mz, 0xff5a18, 460, 0.34, 24);
        audio.playAt('horn', mz, { vol: 0.7, rate: 1.12, refDist: 22 });
      } else {
        // 4. [PHASE II 终极技] 轨道离子卫星打击 — 3 道贯穿云层的 28 米猩红白光离子天柱！
        this.bossSkillLabel = '🛰 终极技·轨道离子卫星打击 · 闪避天柱落点！';
        this.bossSkillLabelT = 3.5;
        const count = 3;
        for (let i = 0; i < count; i++) {
          const lead = 0.45 + i * 0.35;
          const ox = i === 0 ? 0 : (i === 1 ? -4.2 : 4.2);
          const oz = i === 0 ? 0 : rand(-2.5, 2.5);
          const tx = p.x + env.playerVel.x * lead * 0.5 + ox;
          const tz = p.z + env.playerVel.z * lead * 0.5 + oz;
          const ty = env.world.groundHeight(tx, tz, p.y + 1.5, 0.5, 3.0);
          const pt = new THREE.Vector3(tx, ty, tz);
          const dur = 1.35 + i * 0.42;
          env.fx.telegraphRing(pt, 4.4, dur, 0xff2238);
          // Thin laser targeting guide dropping down from the storm sky!
          env.fx.plasmaBeam(new THREE.Vector3(tx, ty + 28, tz), pt, 0xff3048, 0.12, dur);
          this.bossPendingStrikes.push({
            kind: 'orbital', pos: pt, t: dur, radius: 4.6, dmg: 38, color: 0xff2838, scale: 1.35,
          });
        }
        audio.playAt('horn', this.pos, { vol: 0.92, rate: 0.72, refDist: 30, reverb: 0.7 });
      }
      return;
    }

    // ==================== BOSS 2: 毒蛇 (高速赛博刺客 × 全息幻影流) ====================
    if (this.kind === 'boss_viper') {
      if (idx === 0) {
        // 1. 全息幻影三连分身 — 侧向量子闪现 + 在玩家左右侧翼投影 2 具赛博全息分身同步激光齐射！
        this.bossSkillLabel = '🌀 全息幻影三连分身 · 辨别真身躲避侧翼激光！';
        this.bossSkillLabelT = 3.2;
        const startPos = this.pos.clone();
        const startChest = new THREE.Vector3(startPos.x, startPos.y + 1.35, startPos.z);
        env.fx.energyBurst(startPos, 0xb848ff, 1.2);
        env.fx.hazardZone(startPos, 3.4, 2.4, 'void');

        const side = Math.random() < 0.5 ? 1 : -1;
        const perpX = (-dz / dist) * side;
        const perpZ = (dx / dist) * side;
        let destX = this.pos.x;
        let destZ = this.pos.z;
        for (const dTry of [11.5, 8.5, 6.0]) {
          const cx = this.pos.x + perpX * dTry + nx * rand(-2.0, 2.5);
          const cz = this.pos.z + perpZ * dTry + nz * rand(-2.0, 2.5);
          if (env.nav.isFree(cx, cz)) { destX = cx; destZ = cz; break; }
        }
        const destY = env.world.groundHeight(destX, destZ, this.pos.y + 1.2, RADIUS, 2.2);
        this.pos.set(destX, destY, destZ);
        env.world.resolveCylinder(this.pos, RADIUS, this.height, 0.45);
        this.yaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
        this.model.root.position.copy(this.pos);
        this.model.root.rotation.y = this.yaw;

        const endChest = new THREE.Vector3(this.pos.x, this.pos.y + 1.35, this.pos.z);
        env.fx.plasmaBeam(startChest, endChest, 0xc848ff, 0.38, 0.52);
        env.fx.energyBurst(this.pos, 0x38f2ff, 1.15);

        // Spawn 2 translucent holographic decoys flanking the player!
        for (const cSide of [-1, 1]) {
          const cx = p.x + (-nz * cSide) * 7.8 - nx * 4.2;
          const cz = p.z + ( nx * cSide) * 7.8 - nz * 4.2;
          const cy = env.world.groundHeight(cx, cz, p.y + 1.2, 0.5, 2.5);
          const cPos = new THREE.Vector3(cx, cy + 1.15, cz);
          env.fx.floatingOrb(cPos, 0.85, 5.2, 0x38f2ff, 'holo');
          env.fx.hazardZone(new THREE.Vector3(cx, cy, cz), 2.2, 5.2, 'void');
          env.fx.plasmaBeam(endChest, cPos, 0x9e3bff, 0.16, 0.35);
          this.bossClones.push({ pos: cPos, t: 5.2, fireCd: 1.05 + (cSide > 0 ? 0.5 : 0) });
        }
        env.r.flash(endChest, 0xb848ff, 560, 0.4, 28);
        audio.playAt('radio', endChest, { vol: 0.78, rate: 1.65, refDist: 22 });
      } else if (idx === 1) {
        // 2. 棱镜三联轨道炮 — 扇形 3 道贯穿电浆轨道光束（-14° / 0° / +14°）！
        this.bossSkillLabel = '⚡ 棱镜三联轨道炮充能 · 切入光束夹角或躲掩体！';
        this.bossSkillLabelT = 2.8;
        const dur = p2 ? 1.05 : 1.22;
        const spread = p2 ? [-0.26, -0.11, 0.11, 0.26] : [-0.22, 0, 0.22];
        const baseAng = Math.atan2(dz, dx);
        for (const aOff of spread) {
          const ang = baseAng + aOff;
          const tx = this.pos.x + Math.cos(ang) * Math.max(dist, 12);
          const tz = this.pos.z + Math.sin(ang) * Math.max(dist, 12);
          const ty = env.world.groundHeight(tx, tz, p.y + 1.2, 0.5, 2.5);
          const pt = new THREE.Vector3(tx, ty, tz);
          env.fx.telegraphRing(pt, 2.3, dur, 0x38f2ff);
          this.bossPendingStrikes.push({
            kind: 'prism_rail', pos: pt, t: dur, radius: 2.3, dmg: p2 ? 32 : 26, color: 0x38f2ff, scale: 0.95, angleOff: aOff,
          });
        }
        env.fx.energyBurst(mz, 0x38f2ff, 0.9);
        env.r.flash(mz, 0x38f2ff, 500, 0.45, 26);
        audio.playAt('radio', mz, { vol: 0.82, rate: 1.52, refDist: 24 });
      } else if (idx === 2) {
        // 3. 量子奇点浮游雷 — 投放 5~6 枚旋转八面体悬浮奇点地雷，靠近即触发紫光坍缩！
        const count = p2 ? 6 : 5;
        this.bossSkillLabel = '💎 量子奇点浮游雷部署 · 远离紫光几何力场！';
        this.bossSkillLabelT = 3.2;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rand(-0.25, 0.25);
          const r = rand(3.2, 7.6);
          const tx = p.x + Math.cos(a) * r;
          const tz = p.z + Math.sin(a) * r;
          const ty = env.world.groundHeight(tx, tz, p.y + 1.5, 0.5, 3.0);
          const floorPt = new THREE.Vector3(tx, ty, tz);
          const orbPt = new THREE.Vector3(tx, ty + 1.15, tz);
          const fuse = 4.6 + i * 0.25;
          env.fx.floatingOrb(orbPt, 0.46, fuse, 0xc942ff, 'mine');
          env.fx.hazardZone(floorPt, 3.5, fuse, 'void');
          env.fx.plasmaBeam(mz, orbPt, 0xb848ff, 0.14, 0.28);
          this.bossPendingStrikes.push({
            kind: 'mine_det', pos: floorPt, t: fuse, radius: 3.9, dmg: p2 ? 26 : 20, color: 0xc942ff, scale: 0.9,
          });
        }
        this.rollCooldown = 0;
        const side = Math.random() < 0.5 ? 1 : -1;
        this.triggerRoll(-dz * side, dx * side);
        audio.playAt('explosion', mz, { vol: 0.65, rate: 1.72, refDist: 20 });
      } else {
        // 4. [PHASE II 终极技] 厄普西隆光栅切割 — 3 道推进式全息激光栅格墙横扫战场！
        this.bossSkillLabel = '🔺 终极技·厄普西隆光栅切割 · 躲避全息激光矩阵！';
        this.bossSkillLabelT = 3.5;
        const perpX = -nz;
        const perpZ = nx;
        const waves = 3;
        for (let i = 0; i < waves; i++) {
          const dCenter = Math.max(4.0, dist - 3.5) + i * 4.4;
          const cx = this.pos.x + nx * dCenter;
          const cz = this.pos.z + nz * dCenter;
          const cy = env.world.groundHeight(cx, cz, p.y + 1.4, 0.5, 3.0);
          const halfW = 7.5;
          const pA = new THREE.Vector3(cx - perpX * halfW, cy, cz - perpZ * halfW);
          const pB = new THREE.Vector3(cx + perpX * halfW, cy, cz + perpZ * halfW);
          const delay = 0.72 + i * 0.52;
          env.fx.telegraphRing(new THREE.Vector3(cx, cy, cz), 3.6, delay, 0xd938ff);
          this.bossPendingStrikes.push({
            kind: 'laser_wall', pos: pA, pos2: pB, t: delay, radius: 2.2, dmg: 30, color: 0xd938ff, scale: 1.0,
          });
        }
        env.fx.energyBurst(this.pos, 0xd938ff, 1.35);
        audio.playAt('horn', this.pos, { vol: 0.85, rate: 1.45, refDist: 28 });
      }
      return;
    }

    // ==================== BOSS 3: 赤沙暴君 (烈焰熔岩 × 太阳神毁灭流) ====================
    if (idx === 0) {
      // 1. 炼狱熔岩裂隙 — 3 条扇形火山熔岩地裂沿地面炸开，接连喷发 9 米熔岩火柱并留下持续岩浆池！
      this.bossSkillLabel = '🌋 炼狱熔岩裂隙 · 躲避三路火山火柱与岩浆池！';
      this.bossSkillLabelT = 3.2;
      const baseAng = Math.atan2(dz, dx);
      const fan = [-0.42, 0, 0.42];
      const steps = p2 ? 4 : 3;
      for (const aOff of fan) {
        const ang = baseAng + aOff;
        for (let k = 1; k <= steps; k++) {
          const d = 4.2 + k * 4.1;
          const tx = this.pos.x + Math.cos(ang) * d;
          const tz = this.pos.z + Math.sin(ang) * d;
          const ty = env.world.groundHeight(tx, tz, p.y + 1.5, 0.5, 3.0);
          const pt = new THREE.Vector3(tx, ty, tz);
          const dur = 0.72 + k * 0.26;
          env.fx.telegraphRing(pt, 3.1, dur, 0xff7014);
          this.bossPendingStrikes.push({
            kind: 'magma_geyser', pos: pt, t: dur, radius: 3.4, dmg: p2 ? 26 : 20, color: 0xff6210, scale: 0.9,
          });
        }
      }
      env.fx.shockwaveRing(this.pos, 7.5, 0.58, 0xff7814);
      audio.playAt('explosion', this.pos, { vol: 0.85, rate: 0.92, refDist: 26 });
    } else if (idx === 1) {
      // 2. 太阳神陨石天降 — 5~7 颗高空斜坠燃烧陨石，砸出持续燃烧岩浆弹坑！
      const count = p2 ? 7 : 5;
      this.bossSkillLabel = '☄ 太阳神陨石天降 · 机动撤离灼热陨石区！';
      this.bossSkillLabelT = 3.2;
      for (let i = 0; i < count; i++) {
        const tx = p.x + env.playerVel.x * (0.35 + i * 0.16) + (i === 0 ? 0 : rand(-6.5, 6.5));
        const tz = p.z + env.playerVel.z * (0.35 + i * 0.16) + (i === 0 ? 0 : rand(-6.5, 6.5));
        const ty = env.world.groundHeight(tx, tz, p.y + 1.5, 0.5, 3.0);
        const pt = new THREE.Vector3(tx, ty, tz);
        const dur = 1.05 + i * 0.26;
        env.fx.telegraphRing(pt, 4.0, dur, 0xffaa1c);
        this.bossPendingStrikes.push({
          kind: 'meteor', pos: pt, t: dur, radius: 4.3, dmg: p2 ? 30 : 22, color: 0xff8c18, scale: 0.95,
        });
      }
      env.fx.energyBurst(new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z), 0xffb824, 1.2);
      audio.playAt('horn', this.pos, { vol: 0.82, rate: 1.08, refDist: 26 });
    } else if (idx === 2) {
      // 3. 烈焰旋风冲锋 — 暴君周身燃起炽金火焰龙卷，高速突进并沿途播撒岩浆火海！
      this.bossSkillLabel = '🔥 烈焰旋风冲锋 · 拉开距离避开火海轨迹！';
      this.bossSkillLabelT = 2.8;
      this.bossCycloneT = p2 ? 2.15 : 1.75;
      this.bossCycloneDropCd = 0.05;
      env.fx.orbitalPillar(this.pos, 1.9, 7.5, 0.9, 0xff6a14, 0xfff0a8);
      env.fx.shockwaveRing(this.pos, 8.2, 0.62, 0xff8818);
      audio.playAt('horn', this.pos, { vol: 0.88, rate: 0.84, refDist: 26, reverb: 0.6 });
    } else {
      // 4. [PHASE II 终极技] 焦土超新星 — 暴君头顶凝聚不断膨胀的微型烈日，2.1s 后引爆全屏日冕火海！
      this.bossSkillLabel = '☀ 终极技·焦土超新星蓄能中 · 立刻寻找建筑掩体！';
      this.bossSkillLabelT = 3.8;
      const dur = 2.1;
      const sunPos = new THREE.Vector3(this.pos.x, this.pos.y + 3.8, this.pos.z);
      env.fx.floatingOrb(sunPos, 0.45, dur, 0xff9a18, 'sun', 2.35);
      env.fx.telegraphRing(this.pos, 14.5, dur, 0xffb824);
      env.fx.energyBurst(sunPos, 0xffd044, 1.35);
      env.r.flash(sunPos, 0xffb824, 720, 0.65, 38);
      this.bossPendingStrikes.push({
        kind: 'supernova', pos: this.pos.clone(), t: dur, radius: 15.0, dmg: 44, color: 0xff9c18, scale: 1.5,
      });
      audio.playAt('horn', sunPos, { vol: 1.0, rate: 0.68, refDist: 34, reverb: 0.78 });
    }
  }

  private updateBossSystems(dt: number, env: EnemyEnv, dist: number) {
    // 1. Continuous ambient plasma/ember aura + Phase II permanent 3D rig animation
    this.bossAuraAcc += dt;
    const auraStep = this.bossPhase === 2 ? 0.08 : 0.18;
    if (this.bossAuraAcc >= auraStep) {
      this.bossAuraAcc = 0;
      if (dist < 65) env.fx.bossAura(this.pos, this.bossThemeColor(false), this.bossPhase === 2);
    }
    if (this.bossAwakeningT > 0) this.bossAwakeningT = Math.max(0, this.bossAwakeningT - dt);
    if (this.bossPhase2Spinners.length) {
      for (let i = 0; i < this.bossPhase2Spinners.length; i++) {
        const sp = this.bossPhase2Spinners[i];
        const dirSign = i % 2 === 0 ? 1 : -1;
        sp.rotation.z += dt * (2.2 + i * 0.45) * dirSign;
        if (this.kind === 'boss_kronos' && i >= 2) sp.rotation.y += dt * 3.8 * dirSign;
      }
      if (this.kind === 'boss_kronos' && Math.random() < dt * 2.8) {
        const pL = new THREE.Vector3(this.pos.x - 0.75, this.pos.y + 2.05, this.pos.z);
        const pR = new THREE.Vector3(this.pos.x + 0.75, this.pos.y + 2.05, this.pos.z);
        env.fx.lightningArc(pL, pR, 0x48f2ff, 0.14, 0.25);
      }
    }

    // 2. Update 3D Hexagonal Energy Shield Dome shader uniforms (Kronos Phase II shield)
    if (this.bossShieldHitT > 0) this.bossShieldHitT = Math.max(0, this.bossShieldHitT - dt * 3.8);
    if (this.bossShieldMesh && this.bossShieldUniforms) {
      const show = this.alive && this.bossShield > 0;
      this.bossShieldMesh.visible = show;
      if (show) {
        this.bossShieldUniforms.uTime.value = env.r.time;
        this.bossShieldUniforms.uHit.value = this.bossShieldHitT;
        this.bossShieldUniforms.uRatio.value = this.bossShield / Math.max(1, this.bossMaxShield);
      }
    }

    if (this.bossSkillLabelT > 0) {
      this.bossSkillLabelT = Math.max(0, this.bossSkillLabelT - dt);
      if (this.bossSkillLabelT <= 0) this.bossSkillLabel = '';
    }
    if (this.bossOverdriveGunT > 0) this.bossOverdriveGunT = Math.max(0, this.bossOverdriveGunT - dt);

    // 3. Dramatic Phase II Awakening Transition at 50% HP!
    if (this.bossPhase === 1 && this.hp <= this.maxHp * 0.5) {
      this.enterPhase2(env);
    }

    // 4. Update Kronos EMP Tesla Pylons (tethering crackling 3D lightning arcs!)
    const bossChest = _a.set(this.pos.x, this.pos.y + 1.85, this.pos.z);
    for (let i = this.bossPylons.length - 1; i >= 0; i--) {
      const py = this.bossPylons[i];
      py.t -= dt;
      if (py.t <= 0) {
        this.bossPylons.splice(i, 1);
        continue;
      }
      py.zapCd -= dt;
      if (py.zapCd <= 0) {
        py.zapCd = 0.52;
        env.fx.lightningArc(bossChest, py.pos, 0x38e8ff, 0.26, 0.45);
        const dp = py.pos.distanceTo(env.playerEye);
        if (dp < 8.5 && env.playerAlive) {
          env.fx.lightningArc(py.pos, env.playerEye, 0x72f8ff, 0.28, 0.35);
          env.hurtPlayer(this.bossPhase === 2 ? 9 : 6, py.pos);
          audio.playAt('ricochet', py.pos, { vol: 0.55, rate: 1.65, refDist: 16 });
        }
      }
    }

    // 5. Update Viper Holographic Decoy Clones (firing neon cyan-violet flanking beams!)
    for (let i = this.bossClones.length - 1; i >= 0; i--) {
      const cl = this.bossClones[i];
      cl.t -= dt;
      if (cl.t <= 0) {
        env.fx.energyBurst(cl.pos, 0xb848ff, 0.65);
        this.bossClones.splice(i, 1);
        continue;
      }
      cl.fireCd -= dt;
      if (cl.fireCd <= 0 && env.playerAlive) {
        cl.fireCd = 1.45;
        const aim = env.playerEye.clone().add(new THREE.Vector3(rand(-1.1, 1.1), rand(-0.3, 0.3), rand(-1.1, 1.1)));
        env.fx.plasmaBeam(cl.pos, aim, 0x38f2ff, 0.16, 0.32);
        audio.playAt('pistol', cl.pos, { vol: 0.48, rate: 1.55, refDist: 18 });
        if (aim.distanceTo(env.playerEye) < 1.15) {
          env.hurtPlayer(8, cl.pos);
        }
      }
    }

    // 6. Update Tyrant Inferno Cyclone Charge + Persistent Burning Lava Pools!
    if (this.bossCycloneT > 0) {
      this.bossCycloneT = Math.max(0, this.bossCycloneT - dt);
      const toPx = env.playerPos.x - this.pos.x;
      const toPz = env.playerPos.z - this.pos.z;
      const d = Math.hypot(toPx, toPz) || 1;
      const rushSpd = this.bossPhase === 2 ? 9.2 : 7.6;
      this.pos.x += (toPx / d) * rushSpd * dt;
      this.pos.z += (toPz / d) * rushSpd * dt;
      this.pos.y = env.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.0, RADIUS, 1.8);
      env.world.resolveCylinder(this.pos, RADIUS, this.height, 0.45);
      this.yaw += dt * 14.0;
      this.bossCycloneDropCd -= dt;
      if (this.bossCycloneDropCd <= 0) {
        this.bossCycloneDropCd = 0.34;
        const lp = this.pos.clone();
        env.fx.orbitalPillar(lp, 1.5, 5.5, 0.48, 0xff6210, 0xfff2a8);
        env.fx.hazardZone(lp, 2.9, 5.2, 'lava');
        this.bossLavaZones.push({ pos: lp, radius: 2.8, t: 5.2, tickCd: 0.4 });
        if (d < 3.6 && env.playerAlive) env.hurtPlayer(10, lp);
      }
      if (this.bossCycloneT <= 0) {
        env.fx.shockwaveRing(this.pos, 7.5, 0.6, 0xff8818);
        env.fx.energyBurst(this.pos, 0xffa824, 1.2);
      }
    }
    for (let i = this.bossLavaZones.length - 1; i >= 0; i--) {
      const lz = this.bossLavaZones[i];
      lz.t -= dt;
      if (lz.t <= 0) {
        this.bossLavaZones.splice(i, 1);
        continue;
      }
      lz.tickCd -= dt;
      if (lz.tickCd <= 0) {
        lz.tickCd = 0.55;
        if (env.playerAlive && Math.hypot(env.playerPos.x - lz.pos.x, env.playerPos.z - lz.pos.z) < lz.radius && Math.abs(env.playerPos.y - lz.pos.y) < 1.8) {
          env.hurtPlayer(6, lz.pos);
        }
      }
    }

    // 7. Resolve queued telegraphed Boss strikes (each Boss has unique VFX & mechanics!)
    for (let i = this.bossPendingStrikes.length - 1; i >= 0; i--) {
      const s = this.bossPendingStrikes[i];
      s.t -= dt;
      // Viper Quantum Singularity Mines trigger EARLY if player steps within 3.6m!
      if (s.kind === 'mine_det' && s.t > 0 && s.t < 4.1 && env.playerAlive && s.pos.distanceTo(env.playerPos) < 3.6) {
        s.t = 0;
      }
      if (s.t > 0) continue;
      this.bossPendingStrikes.splice(i, 1);

      if (s.kind === 'carpet') {
        env.fx.explosion(s.pos, s.scale);
        env.fx.shockwaveRing(s.pos, s.radius * 1.15, 0.52, s.color);
        env.r.flash(s.pos, s.color, 580, 0.36, 30);
        audio.playAt('explosion', s.pos, { vol: 1.0, rateVar: 0.12, refDist: 22, reverb: 0.65 });
        const dp = s.pos.distanceTo(env.playerPos);
        if (dp < s.radius && env.playerAlive) env.hurtPlayer(Math.round(s.dmg * (1 - dp / s.radius)), s.pos);
      } else if (s.kind === 'orbital') {
        // Kronos Phase II Ultimate: Colossal 28m Sky-to-Deck Satellite Ion Beam Pillar!
        env.fx.orbitalPillar(s.pos, 2.35, 28, 1.35, 0xff2238, 0xffffff);
        env.fx.shockwaveRing(s.pos, s.radius * 1.35, 0.72, 0xff3048);
        env.fx.hazardZone(s.pos, 4.2, 5.5, 'emp');
        env.fx.explosion(s.pos, 0.92);
        env.r.flash(new THREE.Vector3(s.pos.x, s.pos.y + 3.0, s.pos.z), 0xff3048, 880, 0.58, 38);
        audio.playAt('explosion', s.pos, { vol: 1.1, rate: 0.78, refDist: 28, reverb: 0.75 });
        const dp = s.pos.distanceTo(env.playerPos);
        if (dp < s.radius && env.playerAlive) env.hurtPlayer(Math.round(s.dmg * (1 - (dp / s.radius) * 0.6)), s.pos);
      } else if (s.kind === 'prism_rail') {
        this.model.root.updateMatrixWorld(true);
        const mz = this.model.muzzle(_a).clone();
        const aimEnd = s.pos.clone();
        aimEnd.y += 1.05;
        _dir.subVectors(aimEnd, mz).normalize();
        const beamEnd = aimEnd.clone();
        if (env.world.raycast(mz.x, mz.y, mz.z, _dir.x, _dir.y, _dir.z, 90, _hit)) beamEnd.copy(_hit.point);
        else beamEnd.copy(mz).addScaledVector(_dir, 55);
        env.fx.plasmaBeam(mz, beamEnd, s.color, 0.34, 0.58);
        env.fx.energyBurst(beamEnd, 0xc942ff, 0.9);
        env.r.flash(beamEnd, s.color, 580, 0.38, 28);
        audio.playAt('explosion', beamEnd, { vol: 0.85, rate: 1.48, refDist: 24 });
        if (env.playerAlive) {
          const tLine = clamp(_dir.dot(_b.subVectors(env.playerEye, mz)), 0, mz.distanceTo(beamEnd));
          const closest = _c.copy(mz).addScaledVector(_dir, tLine);
          if (closest.distanceTo(env.playerEye) < 1.35 || s.pos.distanceTo(env.playerPos) < s.radius) {
            env.hurtPlayer(s.dmg, mz);
          }
        }
      } else if (s.kind === 'mine_det') {
        env.fx.energyBurst(s.pos, 0xc942ff, 1.25);
        env.fx.shockwaveRing(s.pos, s.radius * 1.15, 0.58, 0x38f2ff);
        env.r.flash(s.pos, 0xc942ff, 580, 0.36, 26);
        audio.playAt('explosion', s.pos, { vol: 0.88, rate: 1.55, refDist: 20 });
        const dp = s.pos.distanceTo(env.playerPos);
        if (dp < s.radius && env.playerAlive) env.hurtPlayer(Math.round(s.dmg * (1 - (dp / s.radius) * 0.65)), s.pos);
      } else if (s.kind === 'laser_wall' && s.pos2) {
        // Viper Phase II Ultimate: Towering Sweeping Holographic Cyber Laser-Grid Curtain!
        env.fx.laserWall(s.pos, s.pos2, 2.75, 1.35, 0xd938ff);
        env.fx.plasmaBeam(s.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), s.pos2.clone().add(new THREE.Vector3(0, 1.2, 0)), 0x38f2ff, 0.22, 0.95);
        const mid = _b.addVectors(s.pos, s.pos2).multiplyScalar(0.5);
        env.r.flash(mid, 0xd938ff, 620, 0.42, 30);
        audio.playAt('radio', mid, { vol: 0.85, rate: 1.38, refDist: 26 });
        if (env.playerAlive) {
          // Point-to-segment distance on XZ plane
          const abx = s.pos2.x - s.pos.x, abz = s.pos2.z - s.pos.z;
          const ab2 = abx * abx + abz * abz || 1;
          const tSeg = clamp(((env.playerPos.x - s.pos.x) * abx + (env.playerPos.z - s.pos.z) * abz) / ab2, 0, 1);
          const cx = s.pos.x + abx * tSeg, cz = s.pos.z + abz * tSeg;
          if (Math.hypot(env.playerPos.x - cx, env.playerPos.z - cz) < 1.55 && Math.abs(env.playerPos.y - s.pos.y) < 2.6) {
            env.hurtPlayer(s.dmg, mid);
          }
        }
      } else if (s.kind === 'magma_geyser') {
        // Tyrant Skill 0: Erupting 9m Volcanic Magma Geyser Pillar + Persistent Lava Pool!
        env.fx.orbitalPillar(s.pos, 1.45, 9.5, 0.95, 0xff5a10, 0xfff0a0);
        env.fx.hazardZone(s.pos, 3.2, 6.0, 'lava');
        env.fx.explosion(s.pos, 0.55);
        this.bossLavaZones.push({ pos: s.pos.clone(), radius: 3.1, t: 6.0, tickCd: 0.5 });
        env.r.flash(s.pos, 0xff7014, 540, 0.38, 28);
        audio.playAt('explosion', s.pos, { vol: 0.92, rate: 0.95, refDist: 22 });
        const dp = s.pos.distanceTo(env.playerPos);
        if (dp < s.radius && env.playerAlive) env.hurtPlayer(Math.round(s.dmg * (1 - (dp / s.radius) * 0.6)), s.pos);
      } else if (s.kind === 'meteor') {
        // Tyrant Skill 1: Angled Sky-Falling Helios Meteor Streak + Burning Lava Crater!
        const skyFrom = new THREE.Vector3(s.pos.x - 9.0, s.pos.y + 26.0, s.pos.z - 6.0);
        env.fx.plasmaBeam(skyFrom, s.pos, 0xff9418, 0.48, 0.45);
        env.fx.explosion(s.pos, 0.88);
        env.fx.shockwaveRing(s.pos, s.radius * 1.2, 0.6, 0xffaa1c);
        env.fx.hazardZone(s.pos, 3.6, 6.2, 'lava');
        this.bossLavaZones.push({ pos: s.pos.clone(), radius: 3.5, t: 6.2, tickCd: 0.5 });
        env.r.flash(s.pos, 0xffaa1c, 680, 0.46, 32);
        audio.playAt('explosion', s.pos, { vol: 1.05, rate: 0.86, refDist: 26, reverb: 0.68 });
        const dp = s.pos.distanceTo(env.playerPos);
        if (dp < s.radius && env.playerAlive) env.hurtPlayer(Math.round(s.dmg * (1 - (dp / s.radius) * 0.65)), s.pos);
      } else if (s.kind === 'supernova') {
        // Tyrant Phase II Ultimate: Cataclysmic Solar Supernova + 8 Radial Volcanic Pillars!
        const origin = this.pos.clone();
        env.fx.shockwaveRing(origin, 15.5, 0.95, 0xff8814);
        env.fx.shockwaveRing(origin, 11.5, 1.15, 0xffe468);
        env.fx.energyBurst(new THREE.Vector3(origin.x, origin.y + 2.5, origin.z), 0xffb824, 1.85);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const fp = new THREE.Vector3(origin.x + Math.cos(a) * 5.6, origin.y, origin.z + Math.sin(a) * 5.6);
          env.fx.orbitalPillar(fp, 1.35, 11.5, 1.15, 0xff5a10, 0xfff4b0);
          env.fx.hazardZone(fp, 3.0, 6.0, 'lava');
          this.bossLavaZones.push({ pos: fp, radius: 2.9, t: 6.0, tickCd: 0.6 });
        }
        env.r.flash(new THREE.Vector3(origin.x, origin.y + 3.2, origin.z), 0xffc838, 1050, 0.72, 46);
        audio.playAt('explosion', origin, { vol: 1.2, rate: 0.72, refDist: 34, reverb: 0.8 });
        const dp = origin.distanceTo(env.playerPos);
        if (dp < s.radius && env.playerAlive) {
          // Tactical counterplay: taking cover behind walls/buildings cuts supernova damage by 70%!
          const originEye = _a.set(origin.x, origin.y + 2.2, origin.z);
          _dir.subVectors(env.playerEye, originEye);
          const dEye = _dir.length() || 1;
          _dir.divideScalar(dEye);
          const blocked = env.world.raycast(originEye.x, originEye.y, originEye.z, _dir.x, _dir.y, _dir.z, dEye - 0.3, _hit);
          const mult = (blocked ? 0.3 : 1.0) * (1 - (dp / s.radius) * 0.55);
          env.hurtPlayer(Math.round(s.dmg * mult), origin);
        }
      }
    }

    // 8. Boss Active Skill Rotation (Phase I cycles 3 unique skills 0..2; Phase II unlocks Ultimate skill 3!)
    if (this.stunT <= 0 && this.bossAwakeningT <= 0 && !this.stealthIdle && env.playerAlive && dist < 58 && (this.canSee || this.lastSeenT < 2.2)) {
      this.bossSpecialCd -= dt;
      if (this.bossSpecialCd <= 0) {
        const poolCount = this.bossPhase === 2 ? 4 : 3;
        const pick = this.bossSkillIdx % poolCount;
        this.bossSkillIdx++;
        this.bossSpecialCd = this.bossPhase === 2 ? rand(3.8, 5.2) : rand(5.2, 6.8);
        this.triggerBossSkill(pick, env);
      }
    }
  }

  private ensureSniperLaser(env: EnemyEnv) {
    if (this.laserGroup && this.laserUniforms) return;
    const u = {
      uStart: { value: new THREE.Vector3() },
      uEnd: { value: new THREE.Vector3() },
      uDotPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uLock: { value: 0 },
      uAimAtCam: { value: 0 },
      uShowDot: { value: 1 },
    };
    this.laserUniforms = u;
    const grp = new THREE.Group();

    // 1. Camera-billboarding volumetric dual-core IR laser beam (hot ruby-white core + soft atmospheric scatter halo + dust shimmer)
    const beamMat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        precision highp float;
        uniform vec3 uStart;
        uniform vec3 uEnd;
        uniform float uLock;
        attribute vec3 aCorner;
        varying vec2 vUv;
        varying float vDist;
        varying float vTotalLen;

        void main() {
          float t = aCorner.y;
          vec3 axisP = mix(uStart, uEnd, t);
          vec3 beamVec = uEnd - uStart;
          float totalLen = max(0.05, length(beamVec));
          vec3 beamDir = beamVec / totalLen;
          vec3 toCam = cameraPosition - axisP;
          vec3 side = cross(beamDir, toCam);
          float sideLen = length(side);
          side = sideLen > 1e-4 ? side / sideLen : vec3(0.0, 1.0, 0.0);

          // Subtle perspective compensation so beam reads crisply from 4m out to 75m
          float camDist = length(toCam);
          float halfW = (0.032 + 0.018 * uLock) * (1.0 + clamp(camDist * 0.018, 0.0, 1.4));
          vec3 worldP = axisP + side * aCorner.x * halfW;

          vUv = vec2(aCorner.x * 0.5 + 0.5, t);
          vDist = t * totalLen;
          vTotalLen = totalLen;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform float uLock;
        varying vec2 vUv;
        varying float vDist;
        varying float vTotalLen;

        void main() {
          float r = abs(vUv.x * 2.0 - 1.0);
          // Razor-sharp coherent laser core + soft Gaussian infrared atmospheric scatter halo
          float core = exp(-r * r * 54.0);
          float innerHalo = exp(-r * r * 11.0);
          float outerHalo = exp(-r * r * 3.2) * (1.0 - r * r);

          // Airborne dust-mote scintillation along the beam + extra scattering near the emitter lens
          float dust1 = sin(vDist * 4.6 - uTime * 3.2) * cos(vDist * 11.3 + uTime * 4.7);
          float dust2 = sin(vDist * 19.5 + uTime * 7.8);
          float dust = 0.78 + 0.22 * (dust1 * 0.7 + dust2 * 0.3);
          float emitterBoost = 1.0 + 0.55 * exp(-vDist * 0.45);
          float endFade = smoothstep(0.0, 0.14, vDist) * smoothstep(vTotalLen, max(0.0, vTotalLen - 0.08), vDist);

          // High-urgency lock warning pulse in the final 0.35s before shot release
          float pulse = uLock > 0.76 ? (0.78 + 0.22 * sin(uTime * 38.0)) : 1.0;

          vec3 colCore = vec3(1.0, 0.86, 0.88);
          vec3 colHalo = mix(vec3(0.95, 0.06, 0.12), vec3(1.0, 0.14, 0.18), uLock);
          vec3 col = colCore * core * (0.95 + 0.55 * uLock) + colHalo * (innerHalo * 0.75 + outerHalo * 0.36);

          float alpha = (core * 0.92 + innerHalo * 0.42 + outerHalo * 0.18) * dust * emitterBoost * endFade * (0.52 + 0.48 * uLock) * pulse;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }
      `,
    });
    const beamMesh = new THREE.Mesh(getSniperBeamGeo(), beamMat);
    beamMesh.frustumCulled = false;
    beamMesh.renderOrder = 12;
    grp.add(beamMesh);

    // 2. 3A Sniper Scope Optic Lens Glint & 4-Point Cross-Star Flare at rifle optics
    const glintMat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        precision highp float;
        uniform vec3 uStart;
        uniform float uLock;
        uniform float uAimAtCam;
        attribute vec3 aCorner;
        varying vec2 vUv;

        void main() {
          vec3 toCam = cameraPosition - uStart;
          float dist = max(0.1, length(toCam));
          vec3 fwd = toCam / dist;
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
          vec3 up = cross(fwd, right);
          // Pull 8cm toward camera so optic glint never clips into rifle receiver or hands
          vec3 center = uStart + fwd * 0.08;
          float sz = (0.16 + 0.16 * uLock + 0.14 * uAimAtCam) * (1.0 + clamp(dist * 0.015, 0.0, 1.1));
          vec3 worldP = center + (right * aCorner.x + up * aCorner.y) * sz;
          vUv = aCorner.xy;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform float uLock;
        uniform float uAimAtCam;
        varying vec2 vUv;

        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float core = exp(-r * r * 28.0);
          float glow = exp(-r * r * 4.8) * (1.0 - r);
          // 4-point optical anamorphic cross-star spikes
          float spH = exp(-abs(vUv.y) * 26.0) * exp(-abs(vUv.x) * 3.0);
          float spV = exp(-abs(vUv.x) * 28.0) * exp(-abs(vUv.y) * 3.6);
          float star = (spH + spV) * (0.45 + 0.55 * uAimAtCam);
          float pulse = uLock > 0.76 ? (0.75 + 0.25 * sin(uTime * 38.0)) : 1.0;

          vec3 col = vec3(1.0, 0.90, 0.92) * (core + star * 0.85) + vec3(1.0, 0.10, 0.18) * (glow + star * 0.5);
          float a = clamp((core * 0.95 + glow * 0.55 + star * 0.85) * (0.55 + 0.45 * uLock) * pulse, 0.0, 1.0);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const glintMesh = new THREE.Mesh(getSniperQuadGeo(), glintMat);
    glintMesh.frustumCulled = false;
    glintMesh.renderOrder = 13;
    grp.add(glintMesh);

    // 3. Raycasted Surface Impact Red Laser Dot (projected onto walls, cover, floors when occluded or sweeping)
    const dotMat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        precision highp float;
        uniform vec3 uDotPos;
        uniform float uLock;
        uniform float uShowDot;
        attribute vec3 aCorner;
        varying vec2 vUv;

        void main() {
          if (uShowDot < 0.01) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vec3 toCam = cameraPosition - uDotPos;
          float dist = max(0.1, length(toCam));
          vec3 fwd = toCam / dist;
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
          vec3 up = cross(fwd, right);
          float sz = (0.065 + 0.035 * uLock) * (1.0 + clamp(dist * 0.012, 0.0, 0.85));
          vec3 worldP = uDotPos + fwd * 0.02 + (right * aCorner.x + up * aCorner.y) * sz;
          vUv = aCorner.xy;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uLock;
        varying vec2 vUv;

        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float core = exp(-r * r * 32.0);
          float halo = exp(-r * r * 5.2) * (1.0 - r);
          vec3 col = vec3(1.0, 0.92, 0.92) * core + vec3(1.0, 0.08, 0.16) * halo;
          float a = clamp(core * 0.98 + halo * (0.55 + 0.35 * uLock), 0.0, 1.0);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const dotMesh = new THREE.Mesh(getSniperQuadGeo(), dotMat);
    dotMesh.frustumCulled = false;
    dotMesh.renderOrder = 13;
    grp.add(dotMesh);

    this.laserGroup = grp;
    env.r.scene.add(grp);
  }

  private updateSniperLaser(dt: number, env: EnemyEnv, aiming: boolean, dist: number) {
    const active =
      this.alive &&
      !this.stealthIdle &&
      aiming &&
      env.playerAlive &&
      (this.canSee || this.lostFor < 1.35) &&
      this.reaction <= 0.25 &&
      dist < this.stats.far + 18 &&
      !this.needsReload;

    if (!active) {
      this.laserChargeT = 0;
      this.laserAimInit = false;
      if (this.laserGroup) this.laserGroup.visible = false;
      return;
    }

    this.ensureSniperLaser(env);
    this.laserGroup!.visible = true;
    const u = this.laserUniforms!;
    u.uTime.value = env.r.time;

    // 1. Laser emitter origin at rifle top PEQ-15 rail / scope mount (updated AFTER m.update!)
    this.model.root.updateMatrixWorld(true);
    const origin = this.model.muzzle(_a);
    origin.y += 0.055;

    // 2. Smoothly track player upper chest with realistic searching micro-sway that tightens to dead-center lock
    const desired = _b.copy(env.playerEye);
    desired.y -= 0.22;
    if (!this.laserAimInit) {
      this.laserAimPt.copy(desired);
      this.laserAimInit = true;
    } else {
      const trackRate = this.canSee ? 11.5 : 3.5;
      this.laserAimPt.x = damp(this.laserAimPt.x, desired.x, trackRate, dt);
      this.laserAimPt.y = damp(this.laserAimPt.y, desired.y, trackRate, dt);
      this.laserAimPt.z = damp(this.laserAimPt.z, desired.z, trackRate, dt);
    }

    const preLock = clamp(this.laserChargeT / 1.6, 0, 1);
    const swayAmp = (1 - preLock * 0.88) * 0.18;
    const tSway = env.r.time * 3.4 + this.id * 2.1;
    const aimPt = _c.set(
      this.laserAimPt.x + Math.sin(tSway) * swayAmp,
      this.laserAimPt.y + Math.cos(tSway * 1.35) * swayAmp * 0.65,
      this.laserAimPt.z + Math.cos(tSway * 0.85) * swayAmp,
    );

    _dir.subVectors(aimPt, origin);
    const aimDist = _dir.length() || 1;
    _dir.multiplyScalar(1 / aimDist);

    // 3. Strict per-frame raycast against all world colliders & buildings so the beam NEVER penetrates any structure!
    const maxBeamDist = Math.min(this.stats.far + 24, 92);
    let hitDist = maxBeamDist;
    let hasWorldHit = false;
    let hitNx = -_dir.x, hitNy = -_dir.y, hitNz = -_dir.z;

    if (env.world.raycast(origin.x, origin.y, origin.z, _dir.x, _dir.y, _dir.z, maxBeamDist, _hit)) {
      hitDist = _hit.t;
      hasWorldHit = true;
      hitNx = _hit.normal.x;
      hitNy = _hit.normal.y;
      hitNz = _hit.normal.z;
    }

    // Also test against the player's body capsule so the beam stops on the player's chest rather than piercing through them
    const p = env.playerPos;
    const tPlayer = rayCapsuleY(
      origin.x, origin.y, origin.z,
      _dir.x, _dir.y, _dir.z,
      p.x, p.z,
      p.y + 0.1,
      env.playerEye.y + 0.08,
      0.28,
    );
    let hitsPlayer = false;
    if (tPlayer > 0 && tPlayer < hitDist) {
      hitDist = tPlayer;
      hitsPlayer = true;
    } else if (this.canSee && hitDist >= aimDist - 0.35) {
      hitDist = Math.min(hitDist, aimDist);
      hitsPlayer = true;
    }

    // Only charge lock-on timer while the laser has an unobstructed path to the player!
    if (hitsPlayer && this.canSee && this.reaction <= 0) {
      this.laserChargeT += dt;
    } else {
      this.laserChargeT = Math.max(0, this.laserChargeT - dt * 1.6);
    }

    const lock = clamp(this.laserChargeT / 1.5, 0, 1);
    u.uStart.value.copy(origin);
    u.uEnd.value.copy(origin).addScaledVector(_dir, hitDist);
    u.uDotPos.value.copy(u.uEnd.value).addScaledVector(_b.set(hitNx, hitNy, hitNz), 0.022);
    u.uLock.value = lock;

    // Scope glint intensifies when sniper is aiming directly toward the player's camera
    const toCam = _b.subVectors(env.playerEye, origin).normalize();
    u.uAimAtCam.value = Math.pow(clamp(_dir.dot(toCam), 0, 1), 4.0);
    // Show impact laser dot on walls/cover/ground (hide only when laser hits within 0.35m of player's eye camera)
    const distEndToEye = u.uEnd.value.distanceTo(env.playerEye);
    u.uShowDot.value = distEndToEye > 0.38 ? 1.0 : 0.0;
  }

  private cleanupLaser() {
    if (this.laserGroup) {
      this.laserGroup.parent?.remove(this.laserGroup);
      this.laserGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material) {
          (m.material as THREE.Material).dispose();
        }
      });
      this.laserGroup = null;
      this.laserUniforms = null;
    }
  }

  update(dt: number, env: EnemyEnv) {
    this.lastDt = dt;
    const m = this.model;
    if (!this.alive) {
      this.updateDead(dt, env);
      return;
    }
    const st = this.stats;
    this.sinceShot += dt;
    const p = env.playerPos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const eyeY = this.pos.y + 1.6 * m.scale;

    // --- Boss 2-Phase Overdrive, Hex-Shield Dome & 4-Skill Combat Rotation ---
    if (this.isBoss) {
      this.updateBossSystems(dt, env, dist);
    }

    // Flashbang stun: enemy staggers, drops rifle barrel, and shields eyes with left arm
    this.updateAlertSprite(dt, dist);
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.vel.multiplyScalar(0.85);
      m.root.position.copy(this.pos);
      m.root.rotation.y = this.yaw + Math.sin(this.stunT * 10) * 0.14;
      m.update(dt, 0, 0, 1, false, 0, false, 0, 'stunned');
      return;
    }

    // Stealth sentry / patrol mode: walks waypoints quietly; investigates heard suppressed shots/impacts ('?')
    // and breaks stealth into full combat ('!') on unsuppressed gunfire, repeated noise, or visual contact
    if (this.stealthIdle) {
      let spd = 0;
      let suspAim = false;
      if (this.suspicionT > 0) {
        this.suspicionT = Math.max(0, this.suspicionT - dt);
        suspAim = true;
        const sdx = this.suspicionX - this.pos.x;
        const sdz = this.suspicionZ - this.pos.z;
        const sd = Math.hypot(sdx, sdz);
        if (sd > 0.25) {
          const want = Math.atan2(sdx, sdz);
          this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * 6.5);
        }
        if (sd > 3.2) {
          const prevX = this.pos.x, prevZ = this.pos.z;
          const step = Math.min(sd - 2.6, 1.85 * dt);
          this.pos.x += (sdx / sd) * step;
          this.pos.z += (sdz / sd) * step;
          env.world.resolveCylinder(this.pos, RADIUS, this.height, 0.45);
          const gy = env.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.55, RADIUS, 0.85);
          if (Math.abs(gy - this.pos.y) < 1.2) this.pos.y = damp(this.pos.y, gy, 10, dt);
          spd = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ) / Math.max(dt, 1e-4);
        }
      } else if (this.patrolPts && this.patrolPts.length >= 2) {
        const [gx, gz] = this.patrolPts[this.patrolIdx];
        const pdx = gx - this.pos.x, pdz = gz - this.pos.z;
        const pd = Math.hypot(pdx, pdz);
        if (pd < 0.45) {
          this.patrolWait += dt;
          if (this.patrolWait > 1.6) {
            this.patrolWait = 0;
            this.patrolIdx = (this.patrolIdx + 1) % this.patrolPts.length;
          }
        } else {
          const want = Math.atan2(pdx, pdz);
          this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * 4);
          const step = Math.min(pd, 1.35 * dt);
          this.pos.x += (pdx / pd) * step;
          this.pos.z += (pdz / pd) * step;
          spd = 1.35;
        }
      }
      // Front cone detection (widens & extends while suspicious and checking heard noise!)
      const visionRange = this.suspicionT > 0 ? 24 : 16;
      const visionCone = this.suspicionT > 0 ? 1.15 : 0.72;
      const closeDetect = this.suspicionT > 0 ? 4.5 : 3.0;
      this.senseT -= dt;
      if (this.senseT <= 0 && env.playerAlive && dist < visionRange) {
        this.senseT = 0.18;
        const toPlayer = Math.atan2(dx, dz);
        if (Math.abs(angleDiff(this.yaw, toPlayer)) < visionCone || dist < closeDetect) {
          _a.set(this.pos.x, eyeY, this.pos.z);
          if (env.world.lineOfSight(_a, env.playerEye)) {
            this.wake();
            this.lastSeenX = p.x;
            this.lastSeenZ = p.z;
            this.lastSeenT = 0;
            this.showAlertIcon('alert', 2.4);
          }
        }
      }
      m.root.position.copy(this.pos);
      m.root.rotation.y = this.yaw;
      m.update(dt, spd, 0, 1, suspAim, 0, false, 0, 'combat');
      return;
    }

    // --- perception ---
    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = rand(0.12, 0.22);
      _a.set(this.pos.x, eyeY, this.pos.z);
      const was = this.canSee;
      this.canSee = env.playerAlive && dist < 75 && env.world.lineOfSight(_a, env.playerEye);
      if (this.canSee && !was) {
        if (this.lostFor > 1.5 || !this.alerted) this.reaction = rand(0.65, 1.15) * (this.kind === 'heavy' ? 1.3 : 1);
        this.alerted = true;
      }
    }
    if (this.canSee) {
      this.seenFor += dt;
      this.lostFor = 0;
      this.lastSeenX = p.x;
      this.lastSeenZ = p.z;
      this.lastSeenT = 0;
    } else {
      this.lostFor += dt;
      this.seenFor = 0;
      this.lastSeenT += dt;
    }
    this.reaction = Math.max(0, this.reaction - dt);
    if (this.suppressT > 0) {
      this.suppressT -= dt;
      if (this.suppressT <= 0) this.suppressed = false;
    }

    // --- tactical roll updates (grounded ease-out speed, single integration, frame-rate independent!) ---
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    const rolling = this.rollT >= 0;
    if (rolling) {
      this.rollT += dt;
      const prog = clamp(this.rollT / this.rollDur, 0, 1);
      // Realistic ~1.6m human dive-roll (~2.8-3.8 m/s peak easing down smoothly to 0.9 m/s)
      const rollSpeed = Math.min(3.9, st.speed * 1.05) * (1 - 0.65 * prog);
      this.vel.x = this.rollDir.x * rollSpeed;
      this.vel.z = this.rollDir.y * rollSpeed;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      env.world.resolveCylinder(this.pos, RADIUS, 1.2, 0.45);
      if (this.rollT >= this.rollDur) {
        this.rollT = -1;
        this.vel.multiplyScalar(0.35);
      }
    }

    // Rare dt-scaled tactical breach roll while closing distance (never frame-rate-dependent spam!)
    if (!rolling && this.alive && (this.kind === 'rusher' || this.kind === 'specops')) {
      if (this.rollCooldown <= 0 && this.canSee && dist > 9 && dist < 20 && Math.random() < 0.08 * dt) {
        const side = (Math.random() - 0.5) * 0.7;
        const fwdX = dx / dist + -dz / dist * side;
        const fwdZ = dz / dist + dx / dist * side;
        this.triggerRoll(fwdX, fwdZ);
      }
    }

    // --- behaviour tree ---
    const it = this.intent;
    it.moveX = 0;
    it.moveZ = 0;
    it.speedMul = 1;
    it.aim = false;
    it.fire = false;
    it.crouch = false;
    it.hasFace = false;
    this.envRef = env;
    this.brainBB.env = env;
    this.brainBB.a = this;
    this.distToTarget = dist;
    this.brain.tick(this.brainBB, dt);

    if (this.inCover) {
      this.coverHold += dt;
      if (this.coverHold > 4.2) {
        this.inCover = false;
        this.coverHold = 0;
        this.coverT = 0;
      }
    } else this.coverHold = 0;

    let wantX = it.moveX, wantZ = it.moveZ;
    if (dist < 1.6) {
      wantX = 0;
      wantZ = 0;
    }
    const speedMul = (this.kind === 'sniper' && this.lostFor < 2.2 && this.alerted) ? 0 : it.speedMul;
    const aiming = it.aim || ((this.kind === 'sniper' || this.kind === 'boss_viper') && this.alerted && this.lostFor < 1.8 && !this.needsReload);

    // Separation from squad mates
    let sepX = 0, sepZ = 0;
    for (const o of env.enemies) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 1.3 * 1.3 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const k = (1.3 - d) / 1.3;
        sepX += (ox / d) * k;
        sepZ += (oz / d) * k;
      }
    }
    const moving = !rolling && (wantX !== 0 || wantZ !== 0);
    if (!rolling) {
      const speed = st.speed * speedMul;
      const tvx = wantX * speed + sepX * 2.2;
      const tvz = wantZ * speed + sepZ * 2.2;
      this.vel.x = damp(this.vel.x, tvx, 9, dt);
      this.vel.z = damp(this.vel.z, tvz, 9, dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      env.world.resolveCylinder(this.pos, RADIUS, 1.7, 0.45);
    }

    if (dist < 0.85 && dist > 1e-3 && Math.abs(p.y - this.pos.y) < 1.6) {
      this.pos.x -= (dx / dist) * (0.85 - dist);
      this.pos.z -= (dz / dist) * (0.85 - dist);
    }
    const gy = env.world.groundHeight(this.pos.x, this.pos.z, this.pos.y, RADIUS * 0.7, 0.5);
    this.pos.y = gy > this.pos.y ? damp(this.pos.y, gy, 18, dt) : Math.max(gy, this.pos.y - 9 * dt);

    if (moving) {
      this.stuckT += dt;
      if (this.stuckT > 0.8) {
        const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
        if (moved < 0.25) {
          this.repathT = 0;
          this.strafeDir = -this.strafeDir;
          this.hasGoal = false;
          this.inCover = false;
          this.coverT = 0;
        }
        this.lastX = this.pos.x;
        this.lastZ = this.pos.z;
        this.stuckT = 0;
      }
    } else this.stuckT = 0;

    // --- facing ---
    const hs = Math.hypot(this.vel.x, this.vel.z);
    let targetYaw = this.yaw;
    if (aiming && (this.canSee || this.lostFor < 2)) targetYaw = Math.atan2(dx, dz);
    else if (it.hasFace) targetYaw = Math.atan2(it.faceX - this.pos.x, it.faceZ - this.pos.z);
    else if (hs > 0.4) targetYaw = Math.atan2(this.vel.x, this.vel.z);
    const dy = angleDiff(this.yaw, targetYaw);
    this.yaw += clamp(dy, -7 * dt, 7 * dt);
    const aimY = env.playerEye.y - 0.32 - (this.pos.y + 1.42 * m.scale);
    this.pitch = damp(this.pitch, aiming ? clamp(Math.atan2(aimY, Math.max(1, dist)), -0.7, 0.7) : 0, 8, dt);

    // --- shooting ---
    const facing = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) < 0.22;
    const mayShoot = !rolling && it.fire && aiming && this.canSee && env.playerAlive && this.reaction <= 0 && facing && dist < st.far + 14 && !this.needsReload;

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = 30;
      this.burstLeft = 0;
    } else if (this.mag <= 0) {
      this.reloadT = 1.9;
      this.burstLeft = 0;
    } else if (this.burstLeft > 0) {
      this.shotT -= dt;
      if (!mayShoot) {
        this.burstLeft = 0;
        this.restT = rand(st.rest[0], st.rest[1]) * 0.6;
      } else if (this.shotT <= 0) {
        const rpmBoost = (this.bossOverdriveGunT > 0 ? 1.55 : 1.0) * (this.isBoss && this.bossPhase === 2 ? 1.22 : 1.0);
        this.shotT += 60 / (st.rpm * rpmBoost);
        this.burstLeft--;
        this.mag--;
        this.fire(env, dist, hs);
        if (this.burstLeft === 0) this.restT = rand(st.rest[0], st.rest[1]) * (this.isBoss && this.bossPhase === 2 ? 0.78 : 1);
      }
    } else {
      this.restT -= dt;
      if (mayShoot && this.restT <= 0) {
        // Sniper requires 1.8s laser warning charge before firing
        if (this.kind !== 'sniper' || this.laserChargeT > 1.8) {
          this.burstLeft = randInt(st.burst[0], st.burst[1]);
          this.shotT = 0;
        }
      }
    }

    // Footsteps
    this.stepAcc += hs * dt;
    if (this.stepAcc > 1.9) {
      this.stepAcc = 0;
      if (dist < 28) {
        const surf = env.world.groundSurface(this.pos.x, this.pos.z);
        audio.playAt(surf === 'sand' ? 'step_dirt' : 'step_conc', this.pos, { vol: 0.5, rateVar: 0.1, refDist: 4 });
      }
    }

    // --- pose & cover tactics ---
    let crouchPose = it.crouch;
    let leanPose = 0;
    if (this.inCover) {
      if (this.needsReload || this.suppressed || this.burstLeft <= 0) {
        // Safe duck down behind cover
        crouchPose = true;
      } else if (mayShoot) {
        // Peek up or lean out past corner to fire
        crouchPose = false;
        leanPose = (this.strafeDir || 1) * 0.7;
      }
    }

    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const lx = hs > 0.05 ? (this.vel.x * cs - this.vel.z * sn) / hs : 0;
    const lz = hs > 0.05 ? (this.vel.x * sn + this.vel.z * cs) / hs : 1;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    const action = this.reloadT > 0 ? 'reload' : 'combat';
    const reloadProg = this.reloadT > 0 ? clamp(1 - this.reloadT / 1.9, 0, 1) : 0;
    m.update(dt, hs, lx, lz, aiming, this.pitch, crouchPose, leanPose, action, reloadProg);

    // 3A Sniper & Boss Viper Volumetric IR Laser Sight, Scope Optic Glint & Raycasted Surface Dot (updated after pose & world matrices!)
    if (this.kind === 'sniper' || this.kind === 'boss_viper') {
      this.updateSniperLaser(dt, env, aiming, dist);
    }
  }

  private fire(env: EnemyEnv, dist: number, mySpeed: number) {
    const st = this.stats;
    const m = this.model;
    this.sinceShot = 0;
    m.shotKick();
    m.root.updateMatrixWorld(true);
    const muzzle = m.muzzle(_a);
    const target = _b.copy(env.playerEye);
    target.y -= 0.3;
    const pSpeed = Math.hypot(env.playerVel.x, env.playerVel.z);
    let pHit = st.acc * env.accMult * clamp(1.05 - dist / 46, 0.1, 0.85);
    if (pSpeed > 4.5) pHit *= 0.48;
    else if (pSpeed > 2.0) pHit *= 0.72;
    pHit *= 1 - env.playerCrouch * 0.25;
    if (mySpeed > 1) pHit *= 0.52;
    if (this.seenFor < 1.8) pHit *= 0.45;
    const hit = Math.random() < pHit;
    if (!hit) {
      const a = Math.random() * Math.PI * 2;
      const off = rand(0.5, 1.5) + dist * 0.012;
      target.x += Math.cos(a) * off;
      target.y += Math.sin(a) * off * 0.6 + 0.1;
      target.z += Math.sin(a * 1.7) * off;
    }
    _dir.subVectors(target, muzzle);
    const len = _dir.length();
    _dir.multiplyScalar(1 / len);
    const end = _c;
    const blocked = env.world.raycast(muzzle.x, muzzle.y, muzzle.z, _dir.x, _dir.y, _dir.z, hit ? len - 0.1 : 160, _hit);
    if (blocked) {
      end.copy(_hit.point);
      env.fx.impact(_hit.point, _hit.normal, _hit.surface, Math.random() < 0.6);
      if (_hit.t < 30 || Math.random() < 0.4) {
        const snd = _hit.surface === 'metal' ? 'imp_metal' : _hit.surface === 'sand' ? 'imp_dirt' : _hit.surface === 'wood' ? 'imp_wood' : 'imp_conc';
        audio.playAt(snd, _hit.point, { vol: 0.5, rateVar: 0.15, refDist: 5 });
      }
    } else if (hit) {
      end.copy(target);
      env.hurtPlayer(st.dmg, this.pos);
    } else {
      end.copy(muzzle).addScaledVector(_dir, 160);
    }
    if (!hit || blocked) {
      const t = clamp(_dir.dot(_b.copy(env.playerEye).sub(muzzle)), 0, blocked ? _hit.t : 160);
      const cx = muzzle.x + _dir.x * t - env.playerEye.x;
      const cy = muzzle.y + _dir.y * t - env.playerEye.y;
      const cz = muzzle.z + _dir.z * t - env.playerEye.z;
      const miss = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (miss < 2.2 && Math.random() < 0.75) {
        _b.set(env.playerEye.x + cx, env.playerEye.y + cy, env.playerEye.z + cz);
        audio.playAt('whiz', _b, { vol: 0.75, rateVar: 0.25, refDist: 1.5 });
      }
    }
    env.fx.tracer(muzzle, end, this.isBoss ? 290 : 260, 0.4);
    env.fx.muzzle(muzzle, _dir, this.isBoss ? (this.bossOverdriveGunT > 0 ? 1.85 : 1.45) : this.kind === 'heavy' ? 1.1 : this.kind === 'sniper' ? 1.25 : 0.85);
    if (this.isBoss || Math.random() < 0.5) {
      env.r.flash(muzzle, this.isBoss ? this.bossThemeColor(false) : 0xffa050, this.isBoss ? 140 : 26, 0.08, this.isBoss ? 18 : 14);
    }
    const occluded = !env.world.lineOfSight(muzzle, env.playerEye);
    audio.playAt(st.sound, muzzle, { vol: this.kind === 'rusher' ? 0.7 : this.kind === 'sniper' ? 1.1 : 0.9, rate: st.rate, rateVar: 0.04, refDist: 9, reverb: 0.55, occluded });

    // Enemy gunfire also alerts nearby peer guards to the firefight (rate-limited per burst)
    if (this.shotAlertCd <= 0) {
      this.shotAlertCd = 0.75;
      const peerRadius = this.kind === 'sniper' ? 58 : 44;
      const tx = this.canSee ? env.playerPos.x : this.pos.x;
      const ty = this.canSee ? env.playerPos.y : this.pos.y;
      const tz = this.canSee ? env.playerPos.z : this.pos.z;
      for (const peer of env.enemies) {
        if (peer === this || !peer.alive) continue;
        peer.hearShot(tx, ty, tz, peerRadius, false, env, 'shot');
      }
    }
  }

  private updateDead(dt: number, env: EnemyEnv) {
    this.deadT += dt;
    this.cleanupLaser();
    if (this.deadT < 0.6) {
      this.pos.x += this.vel.x * dt * (1 - this.deadT / 0.6);
      this.pos.z += this.vel.z * dt * (1 - this.deadT / 0.6);
      env.world.resolveCylinder(this.pos, RADIUS, 1.0, 0.45);
    }
    if (!this.fallSoundDone && this.deadT > 0.5) {
      this.fallSoundDone = true;
      audio.playAt('bodyfall', this.pos, { vol: 0.8, rateVar: 0.1, refDist: 5 });
    }
    if (!this.poolDone && this.deadT > 1.1) {
      this.poolDone = true;
      if (this.pos.y < 0.1) env.fx.bloodPool(_a.set(this.pos.x + rand(-0.3, 0.3), 0, this.pos.z + rand(-0.3, 0.3)));
    }
    if (this.deadT > 16) {
      this.pos.y -= dt * 0.25;
      if (this.deadT > 20) {
        this.removed = true;
      }
    }
    this.model.root.position.copy(this.pos);
    this.model.update(dt, 0, 0, 1, false, 0);
  }
}
