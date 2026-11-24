import * as THREE from 'three';
import { audio } from './core/audio';
import { clipDuration, speak } from './core/voice';
import { angleDiff, clamp, damp, lerp, rand, randInt } from './core/utils';
import { Enemy, type EnemyEnv } from './entities/enemy';
import { SoldierModel, type ModelKind, type SoldierAction } from './entities/soldier';
import { HIGHSEAS_WEAPONS, WEAPON_ORDER } from './entities/weapons';
import type { Game } from './game';
import type { FriendlyMarker } from './highSeas';
import type { DebriefStats } from './ui/hud';
import { makeHit } from './world/physics';
import { TAISHAN, type ShipRemakeDynamic } from './world/shipRemake';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _hit = makeHit();

interface Waiter {
  gen: number;
  cond: () => boolean;
  resolve: () => void;
}

interface Profile {
  dmg: number;
  rpm: number;
  acc: number;
  burst: [number, number];
  rest: [number, number];
  flankX: number;
  flankBack: number;
}

const PROFILES: Record<string, Profile> = {
  '洞幺·老高': { dmg: 16, rpm: 580, acc: 0.68, burst: [2, 4], rest: [0.60, 1.15], flankX: -2.4, flankBack: 2.3 },
  '洞二·铁锤': { dmg: 14, rpm: 640, acc: 0.60, burst: [4, 6], rest: [0.70, 1.25], flankX:  2.4, flankBack: 2.2 },
  '洞四·百灵': { dmg: 15, rpm: 610, acc: 0.65, burst: [2, 4], rest: [0.65, 1.20], flankX: -0.6, flankBack: 4.1 },
};

/** Autonomous side-by-side PLA Marine squadmate for Mission 1 Remake across all 6 zones & 4 vertical decks. */
class ShipSquadNpc {
  model: SoldierModel;
  pos = new THREE.Vector3();
  goal = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  moving = false;
  speed = 4.4;
  action: SoldierAction = 'combat';
  attend = 0;
  holdScripted = false;
  profile: Profile;
  mag = 30;
  reloadT = 0;
  burstLeft = 0;
  shotT = 0;
  restT = rand(0.25, 0.7);
  senseT = rand(0.05, 0.25);
  target: Enemy | null = null;
  combatCrouch = false;
  private moveCd = 0;
  private stepAcc = 0;
  private talkGestT = 0;
  private lastPlayerX = NaN;
  private lastPlayerZ = NaN;
  private travelDirX = 0;
  private travelDirZ = 1;
  private blockedPlayerX = NaN;
  private blockedPlayerZ = NaN;
  private holdYaw = 0;

  constructor(
    public name: string,
    kind: ModelKind,
    x: number, y: number, z: number,
    yaw: number,
    private scene: THREE.Scene,
  ) {
    this.model = new SoldierModel(kind);
    this.pos.set(x, y, z);
    this.goal.copy(this.pos);
    this.yaw = yaw;
    this.holdYaw = yaw;
    this.profile = PROFILES[name] ?? PROFILES['洞幺·老高'];
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = yaw;
    scene.add(this.model.root);
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.goal.copy(this.pos);
    this.yaw = yaw;
    this.holdYaw = yaw;
    this.moving = false;
    this.holdScripted = false;
    this.blockedPlayerX = NaN;
    this.blockedPlayerZ = NaN;
  }

  walkTo(x: number, y: number, z: number, speed = 4.4, hold = false) {
    this.goal.set(x, y, z);
    this.speed = speed;
    this.moving = true;
    this.holdScripted = hold;
  }

  startTalking(dur = 4.5) {
    this.attend = Math.max(this.attend, dur);
    this.talkGestT = Math.max(this.talkGestT, Math.min(dur, 3.2));
  }

  updateCombat(
    dt: number,
    g: Game,
    peers: ShipSquadNpc[],
    loudMode: boolean,
    suppressed: boolean,
    onKillBark: (who: string, label: string, isHead: boolean) => void,
  ) {
    const p = g.player;
    const world = g.world;
    const env = (g as any).env as EnemyEnv | undefined;
    if (this.attend > 0) this.attend = Math.max(0, this.attend - dt);
    if (this.talkGestT > 0) this.talkGestT = Math.max(0, this.talkGestT - dt);
    this.moveCd = Math.max(0, this.moveCd - dt);

    // 1. Real Line-of-Sight Target Acquisition (respects Zone 1 stealth ROE!)
    this.senseT -= dt;
    if (this.senseT <= 0 || (this.target && !this.target.alive)) {
      this.senseT = rand(0.14, 0.24);
      let best: Enemy | null = null;
      let bestScore = Infinity;
      _v1.set(this.pos.x, this.pos.y + 1.52, this.pos.z);
      for (const e of g.enemies) {
        if (!e.alive) continue;
        if (e.stealthIdle && e.stunT <= 0 && !loudMode) continue;
        if (Math.abs(e.pos.y - this.pos.y) > 9.5) continue;
        const dist = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (dist > 46) continue;
        _v2.set(e.pos.x, e.pos.y + 1.32, e.pos.z);
        if (!world.lineOfSight(_v1, _v2)) continue;
        let score = dist;
        if (e.sinceShot < 2.2) score -= 5.5;
        if (e.kind === 'sniper') score -= 4.5;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      this.target = best;
    }

    // 2. Calm Tactical Follow across all 6 ship zones & B1/1F/2F/3F elevations
    // Track player's ACTUAL physical movement direction (never re-trigger movement just because the player rotates their camera!)
    if (Number.isNaN(this.lastPlayerX)) {
      this.lastPlayerX = p.pos.x;
      this.lastPlayerZ = p.pos.z;
    }
    const pdx = p.pos.x - this.lastPlayerX;
    const pdz = p.pos.z - this.lastPlayerZ;
    const pMoveDist = Math.hypot(pdx, pdz);
    const playerMoving = pMoveDist > 0.04;
    if (pMoveDist > 0.12) {
      const inv = 1 / pMoveDist;
      this.travelDirX = this.travelDirX * 0.72 + (pdx * inv) * 0.28;
      this.travelDirZ = this.travelDirZ * 0.72 + (pdz * inv) * 0.28;
      const tl = Math.hypot(this.travelDirX, this.travelDirZ) || 1;
      this.travelDirX /= tl;
      this.travelDirZ /= tl;
      this.lastPlayerX = p.pos.x;
      this.lastPlayerZ = p.pos.z;
    }

    const distToPlayer = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const dyPlayer = Math.abs(p.pos.y - this.pos.y);
    let recentGunfire = false;
    for (const e of g.enemies) {
      if (e.alive && e.sinceShot < 3.5) { recentGunfire = true; break; }
    }
    const inCombat = !!this.target || recentGunfire;

    const pickFollowSlot = (tight: boolean): { x: number; y: number; z: number } | null => {
      const fx = this.travelDirX, fz = this.travelDirZ;
      const rx = -fz, rz = fx;
      const back = tight ? Math.min(2.4, this.profile.flankBack * 0.62) : this.profile.flankBack;
      const side = tight ? this.profile.flankX * 0.68 : this.profile.flankX;
      const cand1X = clamp(p.pos.x - fx * back + rx * side, -18.5, 18.5);
      const cand1Z = clamp(p.pos.z - fz * back + rz * side, -134, 136);
      const gy1 = world.groundHeight(cand1X, cand1Z, p.pos.y + 0.7, 0.36, 1.5);
      if (Math.abs(gy1 - p.pos.y) < 1.8) return { x: cand1X, y: gy1, z: cand1Z };
      // Narrow catwalk / stairwell fallback directly behind the player
      const cand2X = clamp(p.pos.x - fx * 1.8, -18.5, 18.5);
      const cand2Z = clamp(p.pos.z - fz * 1.8, -134, 136);
      const gy2 = world.groundHeight(cand2X, cand2Z, p.pos.y + 0.7, 0.36, 1.5);
      if (Math.abs(gy2 - p.pos.y) < 1.8) return { x: cand2X, y: gy2, z: cand2Z };
      return null;
    };

    if (!this.holdScripted) {
      const farDist = inCombat ? 24.0 : 14.5;
      const farDeckDist = inCombat ? 8.5 : 5.8;
      if ((dyPlayer > 2.8 && distToPlayer > farDeckDist) || distToPlayer > farDist) {
        const slot = pickFollowSlot(!inCombat);
        if (slot) {
          this.pos.set(slot.x, slot.y, slot.z);
          world.resolveCylinder(this.pos, 0.38, 1.75, 0.45);
          this.goal.copy(this.pos);
          this.moving = false;
          this.holdYaw = Math.atan2(this.travelDirX, this.travelDirZ);
          this.blockedPlayerX = NaN;
          this.blockedPlayerZ = NaN;
        }
      } else if (this.moving && !inCombat && this.moveCd <= 0 && dyPlayer < 2.4) {
        // Keep updating follow target smoothly while walking out of combat so teammates never lag behind
        const slot = pickFollowSlot(true);
        if (slot && Math.hypot(slot.x - this.goal.x, slot.z - this.goal.z) > 1.8) {
          this.goal.set(slot.x, slot.y, slot.z);
          this.speed = distToPlayer > 8.5 ? 6.2 : distToPlayer > 5.5 ? 5.3 : 4.5;
          this.moveCd = 0.45;
        }
      } else if (!this.moving && this.moveCd <= 0 && dyPlayer < 2.4) {
        // Tight close-formation follow out of combat; relaxed tactical overwatch during combat
        const holdRadius = inCombat ? 12.0 : 4.6;
        const unblockDist = inCombat ? 2.6 : 1.6;
        const playerMovedSinceBlock = Number.isNaN(this.blockedPlayerX)
          || Math.hypot(p.pos.x - this.blockedPlayerX, p.pos.z - this.blockedPlayerZ) > unblockDist;
        if (distToPlayer > holdRadius && playerMovedSinceBlock) {
          const slot = pickFollowSlot(!inCombat);
          if (slot) {
            this.goal.set(slot.x, slot.y, slot.z);
            this.speed = inCombat
              ? (distToPlayer > 12 ? 5.2 : 4.2)
              : (distToPlayer > 8.5 ? 6.2 : distToPlayer > 5.5 ? 5.3 : 4.5);
            this.moving = true;
            this.moveCd = inCombat ? rand(2.2, 3.6) : 0.45;
            this.blockedPlayerX = NaN;
            this.blockedPlayerZ = NaN;
          }
        }
      }
    }

    // 3. Movement Integration + Collision + Squad Separation
    let spd = 0, mx = 0, mz = 0;
    if (this.moving) {
      const dx = this.goal.x - this.pos.x;
      const dz = this.goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      // Settle smoothly once reached goal, OR if the player stopped and we're already close in formation
      const settleDist = inCombat ? 4.8 : 3.2;
      const settleGoalD = inCombat ? 2.8 : 1.6;
      if (d < 0.48 || (!this.holdScripted && !playerMoving && distToPlayer < settleDist && d < settleGoalD)) {
        this.moving = false;
        this.holdYaw = this.yaw;
        this.moveCd = Math.max(this.moveCd, inCombat ? rand(2.4, 3.8) : rand(0.55, 0.9));
      } else {
        const curSpd = this.target ? Math.min(this.speed, 3.6) : this.speed;
        const step = Math.min(d, curSpd * dt);
        const vx = (dx / d) * curSpd, vz = (dz / d) * curSpd;
        const px = this.pos.x, pz = this.pos.z;
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        for (const peer of peers) {
          if (peer === this) continue;
          const sx = this.pos.x - peer.pos.x, sz = this.pos.z - peer.pos.z;
          const sd = Math.hypot(sx, sz);
          if (sd > 0.01 && sd < 1.2 && Math.abs(this.pos.y - peer.pos.y) < 1.5) {
            const push = (1.2 - sd) * dt * 3.0;
            this.pos.x += (sx / sd) * push;
            this.pos.z += (sz / sd) * push;
          }
        }
        world.resolveCylinder(this.pos, 0.36, 1.75, 0.55);
        const gy = world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.55, 0.34, 0.85);
        if (Math.abs(gy - this.pos.y) < 1.4) this.pos.y = damp(this.pos.y, gy, 10, dt);
        else this.pos.y = damp(this.pos.y, this.goal.y, 6, dt);
        const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
        spd = moved / Math.max(dt, 1e-4);
        if (spd < 0.35 && d > 0.85) {
          this.moving = false;
          this.holdYaw = this.yaw;
          this.moveCd = inCombat ? rand(3.5, 5.2) : rand(1.4, 2.2);
          this.blockedPlayerX = p.pos.x;
          this.blockedPlayerZ = p.pos.z;
        }
        const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
        if (spd > 0.1) {
          mx = (vx * cs - vz * sn) / Math.max(curSpd, 0.1);
          mz = (vx * sn + vz * cs) / Math.max(curSpd, 0.1);
        }
        this.stepAcc += moved;
        if (this.stepAcc > 2.0) {
          this.stepAcc = 0;
          if (distToPlayer < 22) audio.playAt('step_metal', this.pos, { vol: 0.24, rateVar: 0.12, refDist: 5 });
        }
      }
    }

    // 4. Aiming, Burst Fire & Real Magazine Reloads
    const hasTarget = !!this.target && this.target.alive;
    let aimNow = hasTarget;
    let targetYaw = this.yaw;
    let targetPitch = 0;
    if (hasTarget && this.target) {
      const e = this.target;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      targetYaw = Math.atan2(dx, dz);
      targetPitch = clamp(Math.atan2((e.pos.y + 1.32) - (this.pos.y + 1.44), Math.max(0.5, Math.hypot(dx, dz))), -0.65, 0.65);
    } else if (this.attend > 0) {
      targetYaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    } else if (this.moving) {
      targetYaw = Math.atan2(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
      this.holdYaw = targetYaw;
    } else {
      // Calmly hold overwatch facing instead of fidgeting; only gently glance if player walks right up
      targetYaw = distToPlayer < 3.0 ? Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) : this.holdYaw;
    }
    this.yaw += angleDiff(this.yaw, targetYaw) * Math.min(1, dt * (hasTarget ? 10 : 6));
    this.pitch = damp(this.pitch, targetPitch, 9, dt);

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      this.burstLeft = 0;
      if (this.reloadT <= 0) {
        this.mag = 30;
        if (distToPlayer < 24) audio.playAt('magin', this.pos, { vol: 0.36, refDist: 6 });
      }
    } else if (this.mag <= 0) {
      this.reloadT = 1.85;
      this.burstLeft = 0;
      if (distToPlayer < 24) audio.playAt('magout', this.pos, { vol: 0.36, refDist: 6 });
    } else if (hasTarget && this.target && env) {
      const facing = Math.abs(angleDiff(this.yaw, targetYaw)) < 0.24;
      if (this.burstLeft > 0) {
        this.shotT -= dt;
        if (!facing) this.burstLeft = 0;
        else if (this.shotT <= 0) {
          this.shotT += 60 / this.profile.rpm;
          this.burstLeft--;
          this.mag--;
          this.fireShot(this.target, g, env, suppressed, onKillBark);
        }
      } else {
        this.restT -= dt;
        if (this.restT <= 0 && facing) {
          this.burstLeft = Math.min(this.mag, randInt(this.profile.burst[0], this.profile.burst[1]));
          this.shotT = 0;
          this.restT = rand(this.profile.rest[0], this.profile.rest[1]);
          this.combatCrouch = Math.random() < 0.42;
        }
      }
    } else {
      this.burstLeft = 0;
      this.combatCrouch = false;
    }

    const crouchNow = this.reloadT > 0 || (hasTarget && !this.moving && this.combatCrouch);
    let anim: SoldierAction = this.action;
    let reloadProg = 0;
    if (this.reloadT > 0) {
      anim = 'reload';
      reloadProg = clamp(1 - this.reloadT / 1.85, 0, 1);
    } else if (this.moving || hasTarget) {
      anim = 'combat';
    } else if (this.talkGestT > 0 && this.action === 'combat') {
      anim = 'briefing';
    }
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.model.update(dt, spd, mx, mz, aimNow && this.reloadT <= 0, this.pitch, crouchNow, 0, anim, reloadProg);
  }

  private fireShot(
    target: Enemy,
    g: Game,
    env: EnemyEnv,
    suppressed: boolean,
    onKillBark: (who: string, label: string, isHead: boolean) => void,
  ) {
    this.model.shotKick();
    this.model.root.updateMatrixWorld(true);
    const muzzle = this.model.muzzle(_v1);
    const dist = Math.max(1, target.pos.distanceTo(this.pos));
    const spread = lerp(0.024, 0.058, 1 - this.profile.acc) * (this.moving ? 1.3 : 1);
    _v2.set(
      target.pos.x + rand(-spread, spread) * dist,
      target.pos.y + 1.32 + rand(-spread, spread) * dist * 0.7,
      target.pos.z + rand(-spread, spread) * dist,
    );
    _dir.subVectors(_v2, muzzle).normalize();
    g.fx.muzzle(muzzle, _dir, suppressed ? 0.34 : 0.78);
    g.r.flash(muzzle, 0xffb868, suppressed ? 5 : 22, 0.045, 11);
    const wHit = g.world.raycast(muzzle.x, muzzle.y, muzzle.z, _dir.x, _dir.y, _dir.z, dist + 3, _hit);
    const wallT = wHit ? _hit.t : dist + 3;
    const hitProb = clamp(this.profile.acc - dist * 0.006, 0.24, 0.84);
    if (wallT >= dist - 0.6 && Math.random() < hitProb) {
      const isHead = Math.random() < 0.16;
      const dmg = this.profile.dmg * (isHead ? 1.8 : 1);
      _v3.set(target.pos.x, target.pos.y + (isHead ? 1.58 : 1.25), target.pos.z);
      const killed = target.damage(dmg, _dir, env);
      g.fx.blood(_v3, _dir, killed || isHead);
      g.fx.tracer(muzzle, _v3, 420, 0.72);
      if (killed) onKillBark(this.name, target.kind === 'sniper' ? '狙击手' : target.kind === 'heavy' ? '重装兵' : '佣兵', isHead);
    } else if (wHit) {
      g.fx.tracer(muzzle, _hit.point, 420, 0.68);
      g.fx.impact(_hit.point, _nrm.copy(_hit.normal), _hit.surface, false);
    } else {
      _v3.copy(muzzle).addScaledVector(_dir, Math.min(dist + 4, 48));
      g.fx.tracer(muzzle, _v3, 420, 0.65);
    }
    const dPlayer = this.pos.distanceTo(g.player.pos);
    if (dPlayer < 46) {
      audio.playAt(suppressed ? 'smg' : 'rifle', muzzle, {
        vol: suppressed ? 0.24 : 0.48,
        rateVar: 0.1,
        refDist: 10,
      });
    }
    const noiseR = suppressed ? 10 : 44;
    for (const oe of g.enemies) {
      if (oe.alive) oe.hearShot(muzzle.x, muzzle.y, muzzle.z, noiseR, suppressed, env, 'shot');
    }
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.model.dispose();
  }
}

/** Civilian hostage / ship captain NPC who kneels in fear before rescue and speaks warmly after rescue! */
class HostageNpc {
  model: SoldierModel;
  pos = new THREE.Vector3();
  yaw: number;
  rescued = false;
  attend = 0;

  constructor(
    public name: string,
    kind: ModelKind,
    x: number, y: number, z: number,
    yaw: number,
    private scene: THREE.Scene,
  ) {
    this.model = new SoldierModel(kind);
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = yaw;
    scene.add(this.model.root);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (this.attend > 0) this.attend = Math.max(0, this.attend - dt);
    if (this.rescued) {
      const targetYaw = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
      this.yaw += angleDiff(this.yaw, targetYaw) * Math.min(1, dt * 4.5);
    }
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.model.update(dt, 0, 0, 0, false, 0, !this.rescued, 0, this.rescued ? (this.attend > 0 ? 'briefing' : 'combat') : 'hostage', 0);
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.model.dispose();
  }
}

type MissionStage =
  | 'zone1_stern'
  | 'zone2_cabins_bilge'
  | 'zone2_mess_breach'
  | 'zone2_bridge'
  | 'zone3_hold'
  | 'zone4_engine'
  | 'zone5_gantry'
  | 'zone6_bow_stand'
  | 'zone6_extract'
  | 'done';

/**
 * 第一关完全重制版 · 《深海利刃 · 泰山号万吨货轮 (276m × 40m · 约 30 分钟六战区实景流程)》
 * - 零空气墙、零瞬间传送：5 道电动水密防爆闸 + 2F 双门同步破门，逐区物理锁定与开启
 * - 四层舰桥上层建筑（B1 地下船舱与冷库 -6.0m / 1F 宿舍与公共卫生间 / 2F 大餐厅与不锈钢后厨 / 3F 全景舰桥）
 * - 三名自主并肩作战队友（老高、铁锤、百灵）+ 可按 [E] 上下文对话 + 获救船长与船员 [E] 对话
 * - 逐句带情感导演的神经网络中文配音
 */
export class HighSeasRemakeMission {
  onFinish: ((s: DebriefStats) => void) | null = null;
  interactPrompt: string | null = null;
  worldPrompt: string | null = null;
  talkPrompt: string | null = null;
  timeScale = 1;

  private stage: MissionStage = 'zone1_stern';
  private gen = 0;
  private waiters: Waiter[] = [];
  private timers: { gen: number; t: number; resolve: () => void }[] = [];
  private squad: ShipSquadNpc[] = [];
  private gao!: ShipSquadNpc;
  private tiechui!: ShipSquadNpc;
  private bailing!: ShipSquadNpc;
  private hostages: HostageNpc[] = [];
  private captain!: HostageNpc;

  private talkIdx = new Map<string, number>();
  private lastTalkT = -10;
  private barkCd = 0;
  private missionT = 0;
  private loudMode = false;
  private suppressed = true;
  private activeInteract: { pos: THREE.Vector3; radius: number; label: string; cb: () => void } | null = null;
  private secondaryInteract: { pos: THREE.Vector3; radius: number; label: string; cb: () => void } | null = null;
  private bulletTimeT = 0;
  private heliMode: 'stern_hover' | 'departing' | 'bow_inbound' | 'bow_landed' = 'stern_hover';
  private heliT = 0;

  constructor(private g: Game, private ship: ShipRemakeDynamic) {}

  /** Current campaign sector progress for tailored Death / Debrief UI. */
  getStageInfo(): { zone: number; totalZones: number; label: string } {
    switch (this.stage) {
      case 'zone1_stern': return { zone: 1, totalZones: 6, label: '战区 01 · 船尾强降坪与集装箱迷阵' };
      case 'zone2_cabins_bilge': return { zone: 2, totalZones: 6, label: '战区 02 · 上层建筑 1F 与 B1 地下船舱' };
      case 'zone2_mess_breach': return { zone: 2, totalZones: 6, label: '战区 02 · 2F 船员餐厅破门营救' };
      case 'zone2_bridge': return { zone: 2, totalZones: 6, label: '战区 02 · 3F 舰桥控制室' };
      case 'zone3_hold': return { zone: 3, totalZones: 6, label: '战区 03 · 14 米挑高 3 号主货舱' };
      case 'zone4_engine': return { zone: 4, totalZones: 6, label: '战区 04 · 深海主轮机舱' };
      case 'zone5_gantry': return { zone: 5, totalZones: 6, label: '战区 05 · 前甲板龙门吊与防空导弹阵地' };
      case 'zone6_bow_stand': return { zone: 6, totalZones: 6, label: '战区 06 · 船艏终局决战（铁锚·克洛诺斯）' };
      default: return { zone: 6, totalZones: 6, label: '战区 06 · 船艏停机坪撤离点' };
    }
  }

  start() {
    this.gen++;
    this.waiters.length = 0;
    this.timers.length = 0;
    this.missionT = 0;
    this.loudMode = false;
    this.suppressed = true;
    this.timeScale = 1;
    this.bulletTimeT = 0;
    this.heliMode = 'stern_hover';
    this.heliT = 0;

    // PLA Marine Spec-Ops Loadout: QBZ-192 + QSZ-193 (4 flashbangs!)
    this.g.player.setWeaponOrder(HIGHSEAS_WEAPONS, false);
    this.g.player.equipImmediate('qbz192');
    this.g.player.refill();
    this.g.player.grenades = 4;

    // Physically lock ALL 5 watertight blast gates & 2F Mess Breach Doors (ZERO invisible walls!)
    for (const k of ['g12', 'g23', 'g34', 'g45', 'g56', 'mess'] as const) {
      this.ship.setGateOpen(k, false);
    }
    this.ship.setAlarm(false);
    this.ship.setEngineBlackout(false);
    this.ship.setFloodLevel(-7.2);
    this.ship.heli.position.set(0, 14.2, -127);
    this.ship.heli.rotation.set(0, Math.PI, 0);
    this.ship.heliRopes.visible = true;

    this.spawnSquadAndHostages();
    void this.runCampaign(this.gen);
  }

  private spawnSquadAndHostages() {
    this.clearNpcs();
    const s = this.g.r.scene;
    this.gao     = new ShipSquadNpc('洞幺·老高', 'marine_lead',  -2.2, 0, -125.5, Math.PI, s);
    this.tiechui = new ShipSquadNpc('洞二·铁锤', 'marine_heavy',  2.2, 0, -125.5, Math.PI, s);
    this.bailing = new ShipSquadNpc('洞四·百灵', 'marine_tech',  -0.4, 0, -127.2, Math.PI, s);
    this.squad = [this.gao, this.tiechui, this.bailing];

    // 1F Cabin & B1 Lower Bilge Crewmen + 2F Mess Hall Old Captain & 3 Crewmen!
    this.hostages.push(new HostageNpc('船员', 'hostage_crew', TAISHAN.z2Hostages1F[0].x, TAISHAN.z2Hostages1F[0].y, TAISHAN.z2Hostages1F[0].z, TAISHAN.z2Hostages1F[0].yaw, s));
    this.hostages.push(new HostageNpc('船员', 'hostage_crew', TAISHAN.z2Hostages1F[1].x, TAISHAN.z2Hostages1F[1].y, TAISHAN.z2Hostages1F[1].z, TAISHAN.z2Hostages1F[1].yaw, s));
    this.captain = new HostageNpc('老船长', 'hostage_captain', TAISHAN.z2Captain.x, TAISHAN.z2Captain.y, TAISHAN.z2Captain.z, TAISHAN.z2Captain.yaw, s);
    this.hostages.push(this.captain);
    for (const h of TAISHAN.z2MessHostages) {
      this.hostages.push(new HostageNpc('船员', 'hostage_crew', h.x, h.y, h.z, h.yaw, s));
    }
  }

  private clearNpcs() {
    for (const n of this.squad) n.dispose();
    this.squad.length = 0;
    for (const h of this.hostages) h.dispose();
    this.hostages.length = 0;
  }

  private aliveEnemies(): number {
    let n = 0;
    for (const e of this.g.enemies) if (e.alive) n++;
    return n;
  }

  private spawnGroup(list: readonly { kind: 'rifleman' | 'rusher' | 'heavy' | 'sniper' | 'breacher' | 'specops'; x: number; y: number; z: number; yaw: number; stealth?: boolean; pts?: [number, number][] }[], hpScale = 1.0) {
    const out: Enemy[] = [];
    for (const d of list) {
      const e = new Enemy(d.kind, d.x, d.z, hpScale);
      e.pos.y = d.y;
      e.yaw = d.yaw;
      e.model.root.position.copy(e.pos);
      e.model.root.rotation.y = d.yaw;
      if (d.stealth) e.stealthIdle = true;
      this.g.enemies.push(e);
      this.g.r.scene.add(e.model.root);
      out.push(e);
    }
    return out;
  }

  private subTimer = 0;

  private say(who: string, text: string, _accent?: 'friendly' | 'enemy' | 'command' | 'hostage') {
    const dur = Math.max(3.2, clipDuration(text) + 0.65);
    this.g.hud.subtitle(who, text);
    this.subTimer = dur;
    speak(who, text);
    return dur;
  }

  private wp(x: number, y: number, z: number, label: string) {
    this.g.hud.setWaypoint(new THREE.Vector3(x, y, z), label);
  }

  private wait(sec: number, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (gen !== this.gen) return;
      this.timers.push({ gen, t: sec, resolve });
    });
  }

  private waitUntil(cond: () => boolean, gen: number): Promise<void> {
    if (cond()) return Promise.resolve();
    return new Promise((resolve) => {
      if (gen !== this.gen) return;
      this.waiters.push({ gen, cond, resolve });
    });
  }

  private setInteract(pos: { x: number; y: number; z: number }, radius: number, label: string, cb: () => void) {
    this.activeInteract = { pos: new THREE.Vector3(pos.x, pos.y, pos.z), radius, label, cb };
  }

  // =========================================================================
  // FULL 6-ZONE ~30-MINUTE CAMPAIGN SCRIPT (EMOTIONALLY DIRECTED STORYLINE!)
  // =========================================================================
  private async runCampaign(gen: number) {
    const ok = () => gen === this.gen;

    // -----------------------------------------------------------------------
    // ZONE 1: 船尾强降坪与暴雨集装箱迷阵 (Z: -136..-64)
    // -----------------------------------------------------------------------
    this.stage = 'zone1_stern';
    this.g.hud.announce('第一关 · 深海利刃', '南海暴雨夜 · 突袭被劫万吨货轮“泰山号”');
    this.g.hud.setObjective('战区 01 · 船尾强降坪', '清除集装箱迷阵敌军，爆破防空炮解锁 01 号水密防爆闸');
    this.wp(TAISHAN.z1AA.x, TAISHAN.z1AA.y + 1.8, TAISHAN.z1AA.z, '防空火力点');
    const z1 = this.spawnGroup(TAISHAN.z1Enemies, 1.0);

    await this.wait(1.0, gen); if (!ok()) return;
    this.say('海雕-1', '已抵近泰山号船尾上空！暴雨风切变太强，所有人员抓紧索降绳——祝你们好运，利刃一分队！', 'command');
    await this.wait(4.6, gen); if (!ok()) return;
    this.heliMode = 'departing';
    this.ship.heliRopes.visible = false;
    this.say('洞幺·老高', '全队落地安全！压低声音——前面集装箱区有三股巡逻队，左舷高架还有狙击手。按 [E] 随时和我们沟通战术！');
    await this.wait(4.8, gen); if (!ok()) return;
    this.say('洞四·百灵', '我截获了船内监控频道，01 号水密防爆闸被甲板那门防空炮联动锁死了。先拆了它，咱们再杀进上层建筑！');

    // Wait until Zone 1 enemies cleared (or loud shootout ends)
    await this.waitUntil(() => z1.every((e) => !e.alive), gen); if (!ok()) return;
    this.loudMode = true;
    this.suppressed = false;
    this.say('洞二·铁锤', '痛快！甲板上的杂碎全清光了！队长，快去给那门防空炮贴上 C4，我掩护你！');
    this.g.hud.setObjective('爆破甲板防空火力', '靠近防空炮阵地按 [F] 安放 C4 炸药');

    let aaPlanted = false;
    this.setInteract(TAISHAN.z1AA, 3.8, '安放 C4 炸毁防空炮', () => { aaPlanted = true; });
    await this.waitUntil(() => aaPlanted, gen); if (!ok()) return;
    this.activeInteract = null;
    this.g.hud.setObjective('正在输入起爆密码 · 安放 C4…', '保持警戒，正在安装定时炸药');
    this.g.plantC4Charge(new THREE.Vector3(TAISHAN.z1AA.x, 1.32, TAISHAN.z1AA.z - 1.48), Math.PI, 3.0, 2.15, true);
    await this.wait(2.15, gen); if (!ok()) return;
    this.say('洞幺·老高', 'C4 已就位，三秒后起爆——全体往集装箱后面卧倒！');
    this.g.hud.setObjective('撤离爆破半径', 'C4 倒计时 3 秒！');
    await this.wait(3.0, gen); if (!ok()) return;

    this.ship.destroyAA1();
    this.g.explode(new THREE.Vector3(TAISHAN.z1AA.x, 1.0, TAISHAN.z1AA.z), 8.5, 160);
    this.ship.setGateOpen('g12', true);
    audio.play('waveclear', { vol: 0.7 });
    this.say('洞四·百灵', '漂亮！01 号水密防爆闸的液压联锁断开了，主闸门和右舷侧门已经滑开！');
    this.g.hud.announce('战区 02 解锁', '四层舰桥上层建筑 · 地下船舱 · 公共卫生间 · 船员餐厅');

    // -----------------------------------------------------------------------
    // ZONE 2A: 1F 宿舍与陶瓷公共卫生间 + B1 地下船舱与冷库 (-6.0m)
    // -----------------------------------------------------------------------
    this.stage = 'zone2_cabins_bilge';
    this.g.hud.setObjective('战区 02 · 肃清 1F 与 B1 地下船舱', '排查左舷公共卫生间与右舷前厅伏兵，下至 B1 地下船舱与冷库营救船员');
    this.wp(0, 1.6, -50, '上层建筑 1F');
    const z2a = this.spawnGroup(TAISHAN.z2Enemies1F, 1.04);

    await this.waitUntil(() => this.g.player.pos.z > -62, gen); if (!ok()) return;
    this.say('洞幺·老高', '进舱了！走廊灯光很暗，小心左手边前段的公共卫生间隔间，左后楼梯通往 B1 地下船舱和冷库，里面关着两名中国船员！');
    await this.wait(4.4, gen); if (!ok()) return;
    this.say('雇佣兵指挥官·毒蛇', '（全船广播）呵……没想到中国海军陆战队真的敢冒着十二级台风登船。去吧，把他们全埋在船舱铁皮里！', 'enemy');

    await this.waitUntil(() => z2a.every((e) => !e.alive), gen); if (!ok()) return;
    this.hostages[0].rescued = true;
    this.hostages[1].rescued = true;
    audio.play('waveclear', { vol: 0.65 });
    this.say('船员', '太好了……是解放军同志来了！他们把老船长和大伙儿全押在二楼大餐厅和后厨里，还架着机枪，求求你们快去救船长！', 'hostage');
    await this.wait(5.0, gen); if (!ok()) return;
    this.say('洞幺·老高', '老乡别怕，待在安全隔舱！全队走东侧宽楼梯上二楼——咱们给餐厅里的雇佣兵来一场双门同步闪光破门！');

    // -----------------------------------------------------------------------
    // ZONE 2B: 2F 船员大餐厅与商用不锈钢后厨 · 双门同步子弹时间破门!
    // -----------------------------------------------------------------------
    this.stage = 'zone2_mess_breach';
    this.g.hud.setObjective('2F 船员大餐厅 · 同步闪光破门', '沿东侧楼梯上至 2F (+4.2m)，抵达餐厅破门点按 [F] 协同突入');
    this.wp(TAISHAN.z2MessBreach.x, TAISHAN.z2MessBreach.y + 1.6, TAISHAN.z2MessBreach.z, '2F 餐厅破门点');

    await this.waitUntil(() => this.g.player.pos.y > 3.2 && this.g.player.pos.z > -60 && this.g.player.pos.z < -20, gen); if (!ok()) return;
    this.gao.walkTo(5.8, 4.2, -39.5, 4.8, true);
    this.tiechui.walkTo(5.8, 4.2, -27.5, 4.8, true);
    this.say('洞二·铁锤', '我已经卡住后厨侧门了！老高守主门，队长你发令——按 [F] 咱们同时丢闪光弹破门！');

    let breached = false;
    this.setInteract(TAISHAN.z2MessBreach, 4.2, '安放破门 C4 · 双门同步闪光破门', () => { breached = true; });
    await this.waitUntil(() => breached, gen); if (!ok()) return;
    this.activeInteract = null;
    this.g.hud.setObjective('正在门框安放定向破门 C4…', '老高与铁锤就位，准备同步破门突入！');
    this.g.plantC4Charge(new THREE.Vector3(4.82, 5.45, -42.0), Math.PI * 0.5, 1.15, 1.65, true);
    await this.wait(2.75, gen); if (!ok()) return;

    // Dramatic Synchronized C4 Door Breach + Flashbang + 2.6s Bullet-Time Entry!
    const z2m = this.spawnGroup(TAISHAN.z2MessMilitants, 1.0);
    this.ship.setGateOpen('mess', true);
    audio.play('explosion', { vol: 0.75, rateVar: 0.15 });
    this.g.r.final.uniforms.uFlash.value = 0.55;
    for (const e of z2m) e.stun(3.2);
    this.bulletTimeT = 2.6;
    this.gao.holdScripted = false;
    this.tiechui.holdScripted = false;
    this.say('洞幺·老高', '闪光弹生效——突入！保护人质，干掉餐厅和后厨所有武装分子！');
    this.g.hud.setObjective('营救老船长与船员', '清除 2F 大餐厅与不锈钢后厨全部劫匪，注意人质安全');
    this.wp(TAISHAN.z2Captain.x, TAISHAN.z2Captain.y + 1.6, TAISHAN.z2Captain.z, '营救老船长');

    await this.waitUntil(() => z2m.every((e) => !e.alive), gen); if (!ok()) return;
    for (const h of this.hostages) h.rescued = true;
    audio.play('waveclear', { vol: 0.7 });
    this.say('老船长', '谢谢你们……真是好样的！那帮人不是普通海盗，他们在三楼舰桥改了航向，还往三号主货舱塞了个标着“厄普西隆”的红色危险集装箱！', 'hostage');
    await this.wait(5.8, gen); if (!ok()) return;
    this.say('洞四·百灵', '“厄普西隆”？！队长，必须立刻冲上三楼全景舰桥，调出真实舱单并解锁通往主货舱的 02 号防爆闸！');

    // -----------------------------------------------------------------------
    // ZONE 2C: 3F 全景海图舰桥 (+8.4m)
    // -----------------------------------------------------------------------
    this.stage = 'zone2_bridge';
    this.g.hud.setObjective('战区 02 · 夺回 3F 全景海图舰桥', '沿楼梯登上三楼舰桥，肃清卫兵并按 [F] 破解航运主机');
    this.wp(TAISHAN.z2BridgeConsole.x, TAISHAN.z2BridgeConsole.y + 1.6, TAISHAN.z2BridgeConsole.z, '舰桥主机终端');
    const z2b = this.spawnGroup(TAISHAN.z2BridgeEnemies, 1.06);

    await this.waitUntil(() => z2b.every((e) => !e.alive), gen); if (!ok()) return;
    this.say('洞幺·老高', '舰桥拿下了！队长，快去主舵台按 [F] 导出舱单，顺便把 02 号防爆闸打开！');

    let bridgeDone = false;
    this.setInteract(TAISHAN.z2BridgeConsole, 3.6, '读取真实舱单并开启 02 号防爆闸', () => { bridgeDone = true; });
    await this.waitUntil(() => bridgeDone, gen); if (!ok()) return;
    this.activeInteract = null;
    audio.play('pickup', { vol: 0.7 });
    this.ship.setBridgeHacked();
    this.ship.setGateOpen('g23', true);
    this.say('洞四·百灵', '数据到手了！那个红色厄普西隆箱里装着军用级干扰载荷，就藏在前方三号主货舱底层！02 号防爆闸和地下船舱直通门已全部打开！');
    this.g.hud.announce('战区 03 解锁', '14 米双层主货舱 · 夺取厄普西隆加密载荷');

    // -----------------------------------------------------------------------
    // ZONE 3: 14 米双层主货舱 (Z: -20..+36, Catwalk 0.0m / Floor -6.0m)
    // -----------------------------------------------------------------------
    this.stage = 'zone3_hold';
    this.g.hud.setObjective('战区 03 · 突入 14 米双层主货舱', '经 1F 或 B1 前门进入主货舱，推进至底层红色厄普西隆货柜');
    this.wp(TAISHAN.z3Epsilon.x, TAISHAN.z3Epsilon.y + 1.8, TAISHAN.z3Epsilon.z, '厄普西隆货柜');
    const z3 = this.spawnGroup(TAISHAN.z3Enemies, 1.08);

    await this.waitUntil(() => this.g.player.pos.z > -18, gen); if (!ok()) return;
    this.say('洞二·铁锤', '好家伙，这十四米深的主货舱简直就是立体火力网！上面栈桥有狙击手，先清高处，别闷头往下冲！');

    await this.waitUntil(() => z3.every((e) => !e.alive), gen); if (!ok()) return;
    this.say('洞四·百灵', '货舱清空！队长，快去那个亮红灯的厄普西隆集装箱按 [F] 接入我的破解仪，我需要十八秒完成解密！');

    let hackStarted = false;
    this.setInteract(TAISHAN.z3Epsilon, 4.0, '接入解密仪破解厄普西隆货柜', () => { hackStarted = true; });
    await this.waitUntil(() => hackStarted, gen); if (!ok()) return;
    this.activeInteract = null;
    audio.play('pickup', { vol: 0.7 });
    this.ship.setEpsilonHacked(0.1, false);
    this.say('雇佣兵指挥官·毒蛇', '（无线电怒吼）你们敢动厄普西隆？！所有预备队压进三号货舱——格杀勿论，绝不能让他们带走数据！', 'enemy');
    this.g.hud.setObjective('死守厄普西隆货柜 (解密中)', '击退货舱反扑雇佣兵，掩护百灵完成解密！');
    const z3w = this.spawnGroup(TAISHAN.z3HackWave, 1.1);

    for (let sec = 1; sec <= 16; sec++) {
      await this.wait(1.0, gen); if (!ok()) return;
      this.ship.setEpsilonHacked(sec / 16, false);
      this.g.hud.setObjective(`死守厄普西隆货柜 · 解密 ${Math.round((sec / 16) * 100)}%`, '击退反扑佣兵，守住三号货舱底层');
    }
    await this.waitUntil(() => z3w.every((e) => !e.alive), gen); if (!ok()) return;
    this.ship.setEpsilonHacked(1, true);
    this.ship.setGateOpen('g34', true);
    audio.play('waveclear', { vol: 0.75 });
    this.say('洞四·百灵', '解密完成！证据和密钥全锁进加密盘了！03 号轮机舱防爆闸已开启，向前推进就能穿过轮机舱抵达前甲板！');
    this.g.hud.announce('战区 04 解锁', '双机 18 米轮机舱 · 注意断电与进水危机');

    // -----------------------------------------------------------------------
    // ZONE 4: 双机 18 米轮机舱断电进水危机 (Z: +36..+82, Floor -6.0m / Catwalk -1.8m)
    // -----------------------------------------------------------------------
    this.stage = 'zone4_engine';
    this.g.hud.setObjective('战区 04 · 穿越双机 18 米轮机舱', '进入轮机舱大厅，警惕毒蛇破坏船体动力');
    this.wp(0, -4.2, 56, '轮机舱核心');
    const z4 = this.spawnGroup(TAISHAN.z4Enemies, 1.12);

    await this.waitUntil(() => this.g.player.pos.z > 39, gen); if (!ok()) return;
    // DRAMATIC BLACKOUT + RISING FLOODWATER CRISIS!
    audio.play('horn', { vol: 0.85, reverb: 0.7 });
    this.ship.setEngineBlackout(true);
    this.ship.setAlarm(true);
    this.ship.setFloodLevel(-4.95);
    this.say('雇佣兵指挥官·毒蛇', '既然带不走货，那就连人带船一起沉进南海海底吧！我已经切断主配电并打开了海底进水阀——哈哈哈哈！', 'enemy');
    await this.wait(4.8, gen); if (!ok()) return;
    this.say('洞幺·老高', '全舱断电进水了！按 [N] 开启夜视仪！必须同时去右舷二层栈桥重启备用配电箱，并拧死左舷红色进水阀门，否则 04 号逃生闸打不开！');

    let powerDone = false;
    let valveDone = false;
    const refreshZ4Prompt = () => {
      if (!powerDone && !valveDone) {
        this.g.hud.setObjective('轮机舱抢险（0/2）', '① 右舷栈桥重启配电箱 [F] · ② 左舷关闭海底进水阀 [F]');
        this.wp(TAISHAN.z4Power.x, TAISHAN.z4Power.y + 1.4, TAISHAN.z4Power.z, '备用配电箱');
      } else if (!powerDone) {
        this.g.hud.setObjective('轮机舱抢险（1/2）', '前往右舷二层栈桥重启备用配电箱 [F]');
        this.wp(TAISHAN.z4Power.x, TAISHAN.z4Power.y + 1.4, TAISHAN.z4Power.z, '备用配电箱');
      } else if (!valveDone) {
        this.g.hud.setObjective('轮机舱抢险（1/2）', '前往左舷底层拧死红色海底进水阀 [F]');
        this.wp(TAISHAN.z4Valve.x, TAISHAN.z4Valve.y + 1.5, TAISHAN.z4Valve.z, '海底进水阀');
      }
    };
    refreshZ4Prompt();

    this.activeInteract = {
      pos: new THREE.Vector3(TAISHAN.z4Power.x, TAISHAN.z4Power.y, TAISHAN.z4Power.z),
      radius: 3.6,
      label: '合闸重启应急配电箱',
      cb: () => {
        if (powerDone) return;
        powerDone = true;
        this.activeInteract = null;
        audio.play('pickup', { vol: 0.8 });
        this.ship.setPowerRestored();
        this.say('洞四·百灵', '太棒了，应急配电合闸成功！轮机舱照明恢复，抽水泵已经开始运转！');
        refreshZ4Prompt();
      },
    };
    this.secondaryInteract = {
      pos: new THREE.Vector3(TAISHAN.z4Valve.x, TAISHAN.z4Valve.y, TAISHAN.z4Valve.z),
      radius: 3.8,
      label: '拧死海底进水主阀',
      cb: () => {
        if (valveDone) return;
        valveDone = true;
        this.secondaryInteract = null;
        audio.play('imp_metal', { vol: 0.85 });
        this.ship.setValveClosed();
        this.say('洞二·铁锤', '好样的！海底进水阀彻底封死了，海水退下去了，老子可不想在这儿喂鲨鱼！');
        refreshZ4Prompt();
      },
    };

    await this.waitUntil(() => powerDone && valveDone && z4.every((e) => !e.alive), gen); if (!ok()) return;
    this.ship.setAlarm(false);
    this.ship.setGateOpen('g45', true);
    audio.play('waveclear', { vol: 0.75 });
    this.say('洞幺·老高', '泰山号稳住了！04 号抗沉逃生闸已开启，顺着正前方那座宽楼梯冲回露天前甲板！');
    this.g.hud.announce('战区 05 解锁', '前甲板双 18 米龙门吊 · 爆破防空导弹阵地');

    // -----------------------------------------------------------------------
    // ZONE 5: 前甲板双 18 米龙门吊与防空导弹驳运区 (Z: +82..+116)
    // -----------------------------------------------------------------------
    this.stage = 'zone5_gantry';
    this.g.hud.setObjective('战区 05 · 前甲板龙门吊区', '登上前甲板，肃清守军并爆破四联装防空导弹阵地');
    this.wp(TAISHAN.z5SAM.x, TAISHAN.z5SAM.y + 2.0, TAISHAN.z5SAM.z, '防空导弹阵地');
    const z5 = this.spawnGroup(TAISHAN.z5Enemies, 1.15);

    await this.waitUntil(() => this.g.player.pos.z > 88, gen); if (!ok()) return;
    this.say('海雕-1', '利刃一分队！前甲板双龙门吊下面架着四联装防空导弹，雷达已经锁死我的航线了！不拆掉它我没法降落接你们！', 'command');
    await this.wait(4.8, gen); if (!ok()) return;
    this.say('洞二·铁锤', '交给我们！左右龙门吊栈桥上都有狙击手，我压正面火力，队长你找机会摸上去把导弹炸上天！');

    await this.waitUntil(() => z5.every((e) => !e.alive), gen); if (!ok()) return;
    this.say('洞幺·老高', '前甲板敌军肃清！队长，快去那台防空导弹车按 [F] 安放高爆 C4！');

    let samPlanted = false;
    this.setInteract(TAISHAN.z5SAM, 4.2, '安放 C4 炸毁防空导弹阵地', () => { samPlanted = true; });
    await this.waitUntil(() => samPlanted, gen); if (!ok()) return;
    this.activeInteract = null;
    this.g.hud.setObjective('正在输入起爆密码 · 安放高爆 C4…', '保持警戒，正在向导弹发射架安装炸药');
    this.g.plantC4Charge(new THREE.Vector3(TAISHAN.z5SAM.x, 1.45, TAISHAN.z5SAM.z - 1.72), Math.PI, 3.0, 2.15, true);
    await this.wait(2.15, gen); if (!ok()) return;
    this.say('洞幺·老高', 'C4 启动，全体退到集装箱掩体后面——准备听响！');
    this.g.hud.setObjective('撤离爆破半径', '高爆 C4 倒计时 3 秒！');
    await this.wait(3.0, gen); if (!ok()) return;

    this.ship.destroySAM();
    this.g.explode(new THREE.Vector3(TAISHAN.z5SAM.x, 1.2, TAISHAN.z5SAM.z), 10.0, 180);
    this.ship.setGateOpen('g56', true);
    audio.play('waveclear', { vol: 0.8 });
    this.say('海雕-1', '防空雷达信号消失了！漂亮！我正从右舷切入，全速飞往船艏撤离停机坪，三分钟内落地！', 'command');
    this.g.hud.announce('最终战区 06 · 船艏停机坪', '突破防浪闸 · 死守停机坪迎接海雕-1 撤离');

    // -----------------------------------------------------------------------
    // ZONE 6: 船艏撤离停机坪 · 两波终局死守 & 海雕-1 登机撤离 (Z: +116..+138)
    // -----------------------------------------------------------------------
    this.stage = 'zone6_bow_stand';
    this.g.hud.setObjective('战区 06 · 夺取船艏撤离停机坪', '穿过 05 号船艏防浪闸，清除停机坪守敌');
    this.wp(TAISHAN.z6Helipad.x, TAISHAN.z6Helipad.y + 1.8, TAISHAN.z6Helipad.z, '船艏撤离停机坪');
    const z6init = this.spawnGroup(TAISHAN.z6InitialEnemies, 1.15);

    await this.waitUntil(() => this.g.player.pos.z > 117 && z6init.every((e) => !e.alive), gen); if (!ok()) return;
    this.heliMode = 'bow_inbound';
    this.heliT = 0;
    this.say('洞幺·老高', '停机坪占领！所有人依托沙袋和锚机建立环形防线——毒蛇的残部正从前甲板疯狂反扑！顶住两波，绝不能退半步！');

    // Wave 1 Final Stand
    this.g.hud.setObjective('终局死守 · 第 1/2 波反扑', '守住船艏停机坪，掩护海雕-1 降落');
    const w1 = this.spawnGroup(TAISHAN.z6Wave1, 1.15);
    await this.waitUntil(() => w1.every((e) => !e.alive), gen); if (!ok()) return;

    this.say('雇佣兵指挥官·毒蛇', '（嘶吼）不……不可能！我筹备了三年的行动绝不能毁在这里！放铁锚克洛诺斯出去——把他们连同停机坪一起撕成碎片！', 'enemy');
    this.g.hud.announce('终局 BOSS 战 · 铁锚·克洛诺斯', '重甲外骨骼处刑者登场 · 注意规避四管加特林与高爆榴弹齐射！');
    this.g.hud.setObjective('终局 BOSS 战 · 击毙铁锚·克洛诺斯', '摧毁重甲 BOSS 并清剿残余重装突击队！');
    const w2 = this.spawnGroup(TAISHAN.z6Wave2, 1.1);
    const kronos = new Enemy('boss_kronos', 0, 114.5, 1.0);
    kronos.pos.y = 0.0;
    kronos.yaw = Math.PI;
    kronos.model.root.position.copy(kronos.pos);
    kronos.model.root.rotation.y = Math.PI;
    kronos.onBossPhase2 = () => {
      this.g.hud.announce('铁锚·克洛诺斯 · 第二阶段【铁幕过载】！', '解锁终极技「轨道离子卫星打击」· 警惕天柱红光与特斯拉电弧阵！');
      this.say('洞幺·老高', '小心！克洛诺斯启动二阶段铁幕过载，接通轨道卫星打击了！全员散开躲避红光天柱与电弧塔！');
    };
    this.g.enemies.push(kronos);
    this.g.r.scene.add(kronos.model.root);
    w2.push(kronos);
    await this.waitUntil(() => w2.every((e) => !e.alive), gen); if (!ok()) return;

    // Extraction Ready!
    this.stage = 'zone6_extract';
    this.heliMode = 'bow_landed';
    audio.play('waveclear', { vol: 0.9 });
    this.say('海雕-1', '海雕-1 已稳稳落在船艏停机坪！风浪越来越大，快跑，别回头，全队立刻登机！', 'command');
    await this.wait(3.8, gen); if (!ok()) return;
    this.say('远洋编队指挥室', '利刃一分队，干得漂亮……全船六名中国船员平安获救，厄普西隆阴谋彻底粉碎。全体官兵以你们为荣，欢迎回家！', 'command');
    this.g.hud.setObjective('登机撤离 · 行动胜利', '踏上船艏停机坪按 [F] 登上“海雕-1”返航');
    this.wp(TAISHAN.z6Helipad.x, TAISHAN.z6Helipad.y + 1.8, TAISHAN.z6Helipad.z, '登机撤离');

    let boarded = false;
    this.setInteract(TAISHAN.z6Helipad, 6.2, '登上“海雕-1”直升机返航', () => { boarded = true; });
    await this.waitUntil(() => boarded, gen); if (!ok()) return;
    this.activeInteract = null;
    this.stage = 'done';
    this.finish();
  }

  private finish() {
    const p = this.g.player;
    const acc = p.shots > 0 ? Math.min(1, p.hits / p.shots) : 0;
    const grade = acc >= 0.34 ? 'S' : acc >= 0.20 ? 'A' : 'B';
    this.onFinish?.({
      mode: 'highseas',
      grade,
      gradeText: grade === 'S' ? '深海利刃 · 泰山号完美完胜（6 名船员全员获救）' : grade === 'A' ? '高效突击 · 泰山号全船肃清' : '行动完成 · 6 名船员平安撤离',
      run: 1,
      cqbTime: this.missionT,
      hostiles: this.g.kills,
      hostilesTotal: Math.max(this.g.kills, 46),
      civilians: 0,
      headshots: this.g.headshots,
      score: this.g.score + 2000,
      accuracy: acc,
      total: this.missionT,
      record: true,
    });
  }

  // =========================================================================
  // INTERACTIONS: [F] WORLD OBJECTIVES, [E] CONTEXTUAL NPC DIALOGUE, [G] FLASHBANG, [N] NVG
  // =========================================================================
  onInteract(): boolean {
    const p = this.g.player.pos;
    for (const item of [this.activeInteract, this.secondaryInteract]) {
      if (!item) continue;
      if (p.distanceTo(item.pos) <= item.radius) {
        item.cb();
        return true;
      }
    }
    return false;
  }

  onToggleNvg(on: boolean) {
    if (on && this.stage === 'zone4_engine') {
      this.g.hud.hint('夜视仪已开启 · 右舷栈桥重启配电箱，左舷关闭进水阀', 3);
    }
  }

  onFlashbangDetonate(pos: THREE.Vector3) {
    audio.playAt('explosion', pos, { vol: 0.8, rateVar: 0.25, refDist: 16 });
    this.g.r.flash(pos, 0xe8f4ff, 1200, 0.28, 30);
    if (pos.distanceTo(this.g.player.eye) < 9) {
      this.g.r.final.uniforms.uFlash.value = Math.max(this.g.r.final.uniforms.uFlash.value, 0.35);
    }
    for (const e of this.g.enemies) {
      if (e.alive && e.pos.distanceTo(pos) < 13) e.stun(4.5);
    }
    this.loudMode = true;
    this.suppressed = false;
  }

  private findNearestTalkable(): ShipSquadNpc | HostageNpc | null {
    const p = this.g.player.pos;
    let best: ShipSquadNpc | HostageNpc | null = null;
    let bestD = 3.8;
    for (const n of this.squad) {
      const d = p.distanceTo(n.pos);
      if (d < bestD) { bestD = d; best = n; }
    }
    for (const h of this.hostages) {
      if (!h.rescued) continue;
      const d = p.distanceTo(h.pos);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  onTalk(): boolean {
    if (this.missionT - this.lastTalkT < 1.2) return false;
    const npc = this.findNearestTalkable();
    if (!npc) return false;
    this.lastTalkT = this.missionT;

    const liveNearby = this.aliveEnemies();
    let pool: string[];
    if (npc === this.gao) {
      if (liveNearby > 0) {
        pool = [
          '火力别停！我盯住左侧掩体，你找角度点射，咱们稳步往前压！',
          '这帮雇佣兵装备精良，但阵型太散——配合我的压制火力逐个吃掉他们！',
        ];
      } else if (this.stage === 'zone1_stern') {
        pool = [
          '甲板风浪大，钢板特别滑。趁着暴雨声掩护，咱们沿着左舷集装箱高架或者右舷管廊摸过去！',
          '前面那门防空炮把 01 号防爆闸锁死了，清完巡逻队就用 C4 送它上天。',
        ];
      } else if (this.stage === 'zone2_cabins_bilge' || this.stage === 'zone2_mess_breach') {
        pool = [
          '船舱隔间又多又窄，一楼卫生间和 B1 地下船舱冷库都仔细搜一遍，绝不漏掉一名兄弟！',
          '待会儿二楼大餐厅同步破门，闪光弹一响就果断清场，千万留神别误伤老船长！',
        ];
      } else if (this.stage === 'zone4_engine') {
        pool = [
          '轮机舱两台十八米柴油机后面全是盲区，稳住呼吸——重启配电箱再拧死进水阀，泰山号沉不了！',
        ];
      } else {
        pool = [
          '一路打到这儿全队一个没掉队！坚持住，马上就能带着船员和情报回家了！',
          '状态怎么样？弹药不够就找补给箱，有我老高在侧翼顶着，放心往前冲！',
        ];
      }
    } else if (npc === this.tiechui) {
      if (liveNearby > 0) {
        pool = [
          '哈哈，来得正好！我把他们全压在掩体后面不敢露头，队长你快收人头！',
          '别躲了杂碎们，吃铁锤爷爷一梭子！队长小心右翼绕后！',
        ];
      } else if (this.stage === 'zone2_cabins_bilge' || this.stage === 'zone2_mess_breach') {
        pool = [
          '刚才路过二楼大餐厅闻到炖牛腩味儿都饿了！等打完这仗，回基地我请大伙儿吃顿狠的！',
          '那帮混蛋居然在公共卫生间和冷库里藏人，真够阴的，待会儿让我一脚踹开餐厅大门！',
        ];
      } else {
        pool = [
          '这艘万吨巨轮修得跟钢铁迷宫似的，不过再厚的铁皮也挡不住咱们利刃一分队！',
          '龙门吊底下那台防空导弹看着挺唬人，一颗 C4 下去照样变废铁，痛快！',
        ];
      }
    } else if (npc === this.bailing) {
      if (liveNearby > 0) {
        pool = [
          '敌方无线电频率已经全被我监听了，正前方还有活跃目标，我掩护你侧翼！',
        ];
      } else if (this.stage === 'zone3_hold' || this.stage === 'zone2_bridge') {
        pool = [
          '舰桥和主货舱的数据链我已经接通了，厄普西隆货柜里的加密固件非常关键，一定要完整带回去！',
        ];
      } else if (this.stage === 'zone4_engine') {
        pool = [
          '轮机舱水位传感器在报警，不过只要拉起右舷应急开关、关死左舷红阀门，排涝泵三秒就能压住水位！',
        ];
      } else {
        pool = [
          '海雕-1 一直在外海盘旋待命，全船通信畅通。队长你放心推进，后勤与破译交给我！',
        ];
      }
    } else if (npc === this.captain) {
      pool = [
        '真的太感谢你们了……我们泰山号跑了二十年远洋，从没见过这么狠的武装分子。你们一定要活着回来啊！',
        '三楼舰桥的主舵台里锁着完整航运清单，你们把厄普西隆的证据拿走，别让这帮恶徒害了更多人！',
      ];
    } else {
      // Civilian crew hostage
      pool = [
        '解放军同志，真是救命大恩！我们就在这儿听您指挥，绝不乱跑，您千万注意安全！',
        '刚才在 B1 地下船舱冷库冻得直哆嗦，看见你们冲进来的那一刻，我悬着的心终于落地了！',
      ];
    }

    const idx = this.talkIdx.get(npc.name) ?? 0;
    const line = pool[idx % pool.length];
    this.talkIdx.set(npc.name, idx + 1);
    const dur = this.say(npc.name, line);
    if (npc instanceof ShipSquadNpc) npc.startTalking(dur);
    else npc.attend = dur;
    return true;
  }

  getFriendlyMarkers(out: FriendlyMarker[], playerPos: THREE.Vector3) {
    for (const n of this.squad) {
      out.push({ x: n.pos.x, y: n.pos.y + 1.95, z: n.pos.z, name: n.name, role: 'ally' });
    }
    for (const h of this.hostages) {
      if (h.pos.distanceTo(playerPos) < 42) {
        out.push({ x: h.pos.x, y: h.pos.y + 1.85, z: h.pos.z, name: h.rescued ? `${h.name} (安全)` : `${h.name} (人质)`, role: 'hostage' });
      }
    }
  }

  // =========================================================================
  // PER-FRAME UPDATE
  // =========================================================================
  update(dt: number) {
    this.missionT += dt;
    this.barkCd = Math.max(0, this.barkCd - dt);
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.g.hud.subtitle(null);
    }

    // Bullet-time slow-mo decay after 2F Mess Breach!
    if (this.bulletTimeT > 0) {
      this.bulletTimeT = Math.max(0, this.bulletTimeT - dt / Math.max(0.1, this.timeScale));
      this.timeScale = this.bulletTimeT > 0 ? 0.28 : 1;
    } else {
      this.timeScale = damp(this.timeScale, 1, 8, dt);
    }

    // Automatically hide rain streaks when inside sealed decks (Zone 2 Superstructure or Zone 4 Engine Room)
    const pp = this.g.player.pos;
    const insideSuper = pp.z > -64 && pp.z < -20 && pp.x > -19.4 && pp.x < 19.4 && pp.y < 12.2;
    const insideEngine = pp.z > 36 && pp.z < 82 && pp.y < 2.2;
    this.ship.setIndoors(insideSuper || insideEngine);

    // Detect if stealth broke in Zone 1 (e.g. loud gunfire or visual contact)
    if (!this.loudMode && this.stage === 'zone1_stern') {
      for (const e of this.g.enemies) {
        if (e.alive && !e.stealthIdle) {
          this.loudMode = true;
          this.suppressed = false;
          this.g.hud.hint('敌军已进入警戒！甲板哨兵正在集结', 3.5);
          break;
        }
      }
    }

    // Animate Z-20J "HaiDiao-1" Helicopter across Stern Drop -> Departure -> Bow Extraction Touchdown!
    this.heliT += dt;
    if (this.heliMode === 'stern_hover') {
      this.ship.heli.position.set(Math.sin(this.heliT * 0.9) * 0.6, 14.2 + Math.sin(this.heliT * 1.8) * 0.35, -127);
    } else if (this.heliMode === 'departing') {
      this.ship.heli.position.x = damp(this.ship.heli.position.x, -95, 0.35, dt);
      this.ship.heli.position.y = damp(this.ship.heli.position.y, 38, 0.35, dt);
      this.ship.heli.position.z = damp(this.ship.heli.position.z, -160, 0.25, dt);
    } else if (this.heliMode === 'bow_inbound') {
      this.ship.heli.position.x = damp(this.ship.heli.position.x, 0, 0.5, dt);
      this.ship.heli.position.y = damp(this.ship.heli.position.y, 11.5 + Math.sin(this.heliT * 1.7) * 0.4, 0.5, dt);
      this.ship.heli.position.z = damp(this.ship.heli.position.z, TAISHAN.z6Helipad.z, 0.5, dt);
      this.ship.heli.rotation.y = Math.PI;
    } else if (this.heliMode === 'bow_landed') {
      this.ship.heli.position.x = damp(this.ship.heli.position.x, 0, 1.5, dt);
      this.ship.heli.position.y = damp(this.ship.heli.position.y, 1.25, 1.4, dt);
      this.ship.heli.position.z = damp(this.ship.heli.position.z, TAISHAN.z6Helipad.z, 1.5, dt);
      this.ship.heli.rotation.y = Math.PI;
    }

    // Update autonomous side-by-side squadmates & hostages
    for (const n of this.squad) {
      n.updateCombat(dt, this.g, this.squad, this.loudMode, this.suppressed, (who, label, isHead) => {
        if (this.barkCd > 0) return;
        this.barkCd = 4.2;
        this.g.hud.killFeed(`${who} 击毙 ${label}`, isHead ? '爆头' : '掩护射击', isHead);
      });
    }
    for (const h of this.hostages) h.update(dt, pp);

    // Compute [F] world prompt & [E] talk prompt
    this.interactPrompt = null;
    this.worldPrompt = null;
    for (const item of [this.activeInteract, this.secondaryInteract]) {
      if (item && pp.distanceTo(item.pos) <= item.radius) {
        this.interactPrompt = item.label;
        break;
      }
    }
    const nearTalk = this.findNearestTalkable();
    this.talkPrompt = nearTalk ? `与 ${nearTalk.name} 对话` : null;

    // Resolve timers & waiters
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      if (tm.gen !== this.gen) { this.timers.splice(i, 1); continue; }
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.resolve();
      }
    }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.gen !== this.gen) { this.waiters.splice(i, 1); continue; }
      if (w.cond()) {
        this.waiters.splice(i, 1);
        w.resolve();
      }
    }
  }

  dispose() {
    this.gen++;
    this.waiters.length = 0;
    this.timers.length = 0;
    this.timeScale = 1;
    this.g.player.setWeaponOrder(WEAPON_ORDER);
    this.g.hud.setWaypoint(null);
    this.g.hud.subtitle(null);
    this.clearNpcs();
  }
}
