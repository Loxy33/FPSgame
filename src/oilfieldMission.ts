import * as THREE from 'three';
import { audio } from './core/audio';
import { clipDuration, speak } from './core/voice';
import { angleDiff, clamp, damp, lerp, rand, randInt } from './core/utils';
import { Enemy, type EnemyEnv } from './entities/enemy';
import { SoldierModel, type ModelKind, type SoldierAction } from './entities/soldier';
import { WEAPON_ORDER, WEAPONS } from './entities/weapons';
import type { Game } from './game';
import type { FriendlyMarker } from './highSeas';
import type { DebriefStats } from './ui/hud';
import { makeHit } from './world/physics';
import { OILFIELD, type OilfieldDynamic } from './world/oilfield';

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
  '洞幺·老高': { dmg: 16, rpm: 560, acc: 0.66, burst: [2, 4], rest: [0.65, 1.2], flankX: -2.6, flankBack: 2.4 },
  '洞二·铁锤': { dmg: 14, rpm: 620, acc: 0.58, burst: [4, 6], rest: [0.75, 1.3], flankX: 2.6, flankBack: 2.2 },
  '洞四·百灵': { dmg: 15, rpm: 600, acc: 0.64, burst: [2, 4], rest: [0.7, 1.25], flankX: -0.7, flankBack: 4.3 },
};

/** Autonomous side-by-side combat squadmate for Mission 2 with LOS shooting, reloads, bounding follow & [E] talk. */
class OilSquadNpc {
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
    peers: OilSquadNpc[],
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
        if (Math.abs(e.pos.y - this.pos.y) > 10.5) continue;
        const dist = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (dist > 44) continue;
        _v2.set(e.pos.x, e.pos.y + 1.32, e.pos.z);
        if (!world.lineOfSight(_v1, _v2)) continue;
        let score = dist;
        if (e.sinceShot < 2.2) score -= 5.5;
        if (e.kind === 'sniper') score -= 4.5;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      this.target = best;
    }

    // 2. Calm Tactical Follow across all 6 zones & vertical elevations
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
      const cand1X = clamp(p.pos.x - fx * back + rx * side, -112, 112);
      const cand1Z = clamp(p.pos.z - fz * back + rz * side, -112, 112);
      const gy1 = world.groundHeight(cand1X, cand1Z, p.pos.y + 0.7, 0.36, 1.5);
      if (Math.abs(gy1 - p.pos.y) < 1.8) return { x: cand1X, y: gy1, z: cand1Z };
      // Narrow catwalk / stairwell fallback directly behind the player
      const cand2X = clamp(p.pos.x - fx * 1.8, -112, 112);
      const cand2Z = clamp(p.pos.z - fz * 1.8, -112, 112);
      const gy2 = world.groundHeight(cand2X, cand2Z, p.pos.y + 0.7, 0.36, 1.5);
      if (Math.abs(gy2 - p.pos.y) < 1.8) return { x: cand2X, y: gy2, z: cand2Z };
      return null;
    };

    if (!this.holdScripted) {
      const farDist = inCombat ? 26.0 : 15.0;
      const farDeckDist = inCombat ? 8.5 : 5.8;
      if ((dyPlayer > 3.0 && distToPlayer > farDeckDist) || distToPlayer > farDist) {
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
      } else if (this.moving && !inCombat && this.moveCd <= 0 && dyPlayer < 2.6) {
        // Keep updating follow target smoothly while walking out of combat so teammates never lag behind
        const slot = pickFollowSlot(true);
        if (slot && Math.hypot(slot.x - this.goal.x, slot.z - this.goal.z) > 1.8) {
          this.goal.set(slot.x, slot.y, slot.z);
          this.speed = distToPlayer > 8.5 ? 6.2 : distToPlayer > 5.5 ? 5.3 : 4.5;
          this.moveCd = 0.45;
        }
      } else if (!this.moving && this.moveCd <= 0 && dyPlayer < 2.6) {
        // Tight close-formation follow out of combat; relaxed tactical overwatch during combat
        const holdRadius = inCombat ? 12.5 : 4.8;
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
        if (this.stepAcc > 2.1) {
          this.stepAcc = 0;
          if (distToPlayer < 22) audio.playAt('step_dirt', this.pos, { vol: 0.24, rateVar: 0.12, refDist: 5 });
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
          this.fire(this.target, g, env, suppressed, onKillBark);
          if (this.burstLeft === 0) {
            this.restT = rand(this.profile.rest[0], this.profile.rest[1]);
            this.combatCrouch = !this.moving && Math.random() < 0.45;
          }
        }
      } else {
        this.restT -= dt;
        if (facing && this.restT <= 0) {
          this.burstLeft = randInt(this.profile.burst[0], this.profile.burst[1]);
          this.shotT = 0;
        }
      }
    } else {
      this.burstLeft = 0;
      this.combatCrouch = false;
    }

    const crouch = this.reloadT > 0 || (this.combatCrouch && !this.moving && hasTarget);
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
    this.model.update(dt, spd, mx, mz, aimNow && this.reloadT <= 0, this.pitch, crouch, 0, anim, reloadProg);
  }

  private fire(
    e: Enemy, g: Game, env: EnemyEnv, suppressed: boolean,
    onKillBark: (who: string, label: string, isHead: boolean) => void,
  ) {
    this.model.shotKick();
    this.model.root.updateMatrixWorld(true);
    const muzzle = this.model.muzzle(_v1);
    const aimPt = _v2.set(e.pos.x, e.pos.y + 1.32, e.pos.z);
    const dist = muzzle.distanceTo(aimPt);
    const hit = Math.random() < this.profile.acc * clamp(1.12 - dist / 55, 0.24, 0.84);
    if (!hit) {
      const ang = Math.random() * Math.PI * 2;
      const spread = rand(0.32, 0.95) + dist * 0.014;
      aimPt.x += Math.cos(ang) * spread;
      aimPt.y += Math.sin(ang) * spread * 0.55;
      aimPt.z += Math.sin(ang) * spread * 0.5;
    }
    _dir.subVectors(aimPt, muzzle).normalize();
    g.fx.muzzle(muzzle, _dir, suppressed ? 0.34 : 0.78);
    g.r.flash(muzzle, 0xffb868, suppressed ? 5 : 22, 0.045, 11);
    audio.playAt(suppressed ? 'smg' : 'rifle', muzzle, {
      vol: suppressed ? 0.24 : 0.54,
      rate: suppressed ? rand(1.28, 1.42) : rand(0.92, 1.05),
      refDist: suppressed ? 7 : 12,
      reverb: 0.42,
    });
    if (hit && e.alive) {
      const isHead = Math.random() < 0.2;
      if (isHead) aimPt.y = e.pos.y + 1.62;
      g.fx.tracer(muzzle, aimPt);
      g.fx.impact(aimPt, _nrm.copy(_dir).negate(), 'flesh', false);
      e.suppress();
      if (e.damage(this.profile.dmg * (isHead ? 1.75 : 1.0), _dir, env)) {
        g.kills++;
        g.hud.killFeed(e.stats.label, this.name, isHead);
        onKillBark(this.name, e.stats.label, isHead);
      }
    } else {
      const wh = g.world.raycast(muzzle.x, muzzle.y, muzzle.z, _dir.x, _dir.y, _dir.z, 55, _hit);
      const endPt = wh ? _hit.point : _v3.copy(muzzle).addScaledVector(_dir, 36);
      g.fx.tracer(muzzle, endPt);
      if (wh) g.fx.impact(_hit.point, _hit.normal, _hit.surface, false);
      if (dist < 30 && Math.random() < 0.45) e.suppress();
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

/**
 * Campaign Mission 2: 《戈壁炼狱 · 喀拉干达 7 号油田与厄普西隆地下中继站》
 * Full 6-Zone ~30-Minute AAA Campaign with Zero Invisible Walls, Physical Blast Gates,
 * Expressive Emotional Voice Acting, Side-by-Side Squad Combat AI & [E] Interactive Dialogue.
 */
export class OilfieldMission {
  t = 0;
  stage: 'zone1' | 'zone2' | 'zone3' | 'zone4' | 'zone5' | 'zone6' | 'epilogue' = 'zone1';
  interactPrompt: string | null = null;
  talkPrompt: string | null = null;
  onFinish: (stats: DebriefStats) => void = () => {};

  private gen = 0;
  private waits: Waiter[] = [];
  private squad: OilSquadNpc[] = [];
  private gao!: OilSquadNpc;
  private tiechui!: OilSquadNpc;
  private bailing!: OilSquadNpc;
  private interactPressed = false;
  private talkTarget: OilSquadNpc | null = null;
  private talkIdx = new Map<string, number>();
  private talkSubTimer = 0;
  private talkCooldown = 0;
  private scriptedSpeaking = false;
  private combatBarkCd = 3.5;
  private tiechuiGiftZone = '';
  private heliMode: 'depart' | 'hidden' | 'approach' | 'hover' | 'extract' = 'depart';
  private heliT = 0;
  private valve1Done = false;
  private valve2Done = false;
  private loudMode = false;
  private activeTimer = -1;
  private activeTimerLabel = '';

  constructor(private g: Game, private oil: OilfieldDynamic) {}

  /** Current oilfield campaign sector progress for tailored Death / Debrief UI. */
  getStageInfo(): { zone: number; totalZones: number; label: string } {
    switch (this.stage) {
      case 'zone1': return { zone: 1, totalZones: 6, label: '战区 01 · 油田外围检查站' };
      case 'zone2': return { zone: 2, totalZones: 6, label: '战区 02 · 荒漠采油区与雷达干扰塔' };
      case 'zone3': return { zone: 3, totalZones: 6, label: '战区 03 · 巨型储油罐阵' };
      case 'zone4': return { zone: 4, totalZones: 6, label: '战区 04 · 催化裂解核心精炼厂' };
      case 'zone5': return { zone: 5, totalZones: 6, label: '战区 05 · 厄普西隆地下卫星数据掩体' };
      default: return { zone: 6, totalZones: 6, label: '战区 06 · 悬崖停机坪决战（指挥官·毒蛇）' };
    }
  }

  start() {
    this.dispose();
    this.gen++;
    this.t = 0;
    this.stage = 'zone1';
    this.interactPrompt = null;
    this.talkPrompt = null;
    this.interactPressed = false;
    this.valve1Done = false;
    this.valve2Done = false;
    this.loudMode = false;
    this.activeTimer = -1;
    this.heliMode = 'depart';
    this.heliT = 0;
    this.tiechuiGiftZone = '';

    // Lock all 5 physical zone blast gates at mission start (ZERO invisible walls — real steel doors!)
    this.oil.setGateOpen('g12', false);
    this.oil.setGateOpen('g23', false);
    this.oil.setGateOpen('g34', false);
    this.oil.setGateOpen('g45', false);
    this.oil.setGateOpen('g56', false);

    // Full tactical arsenal for 30-min desert + sniper + CQB campaign
    this.g.player.setWeaponOrder(WEAPON_ORDER, false);
    this.g.player.equipImmediate('qbz192');
    this.g.player.refill();
    this.g.player.grenades = 4;

    // Spawn "利刃"一分队 right beside the player in Zone 1 canyon!
    const sc = this.g.r.scene;
    this.gao = new OilSquadNpc('洞幺·老高', 'marine_lead', -82.5, 0, -101.5, Math.PI, sc);
    this.tiechui = new OilSquadNpc('洞二·铁锤', 'marine_heavy', -77.5, 0, -101.5, Math.PI, sc);
    this.bailing = new OilSquadNpc('洞四·百灵', 'marine_tech', -80.2, 0, -106.0, Math.PI, sc);
    this.squad.push(this.gao, this.tiechui, this.bailing);

    void this.run(this.gen);
  }

  dispose() {
    this.gen++;
    this.waits.length = 0;
    for (const s of this.squad) s.dispose();
    this.squad.length = 0;
    this.talkTarget = null;
    this.talkPrompt = null;
    this.interactPrompt = null;
    this.g.hud.setWaypoint(null);
    this.g.hud.setTimer(null);
    this.g.hud.subtitle(null);
    this.g.player.scriptedLock = false;
  }

  onInteract(): boolean {
    if (!this.interactPrompt) return false;
    this.interactPressed = true;
    return true;
  }

  onTalk(): boolean {
    if (!this.talkTarget || this.talkCooldown > 0 || this.stage === 'epilogue') return false;
    const npc = this.talkTarget;
    const p = this.g.player;
    const g = this.g;
    const engaged = this.squad.some((s) => !!s.target?.alive);
    let line = '';

    if (npc === this.gao) {
      const pool = engaged
        ? [
            '洞三，找掩体稳住呼吸！我和铁锤给你按住正面火力，抓紧侧翼点射！',
            '别硬顶机枪火线！跟着我的手势交替掩护推进！',
          ]
        : this.stage === 'zone1'
          ? [
              '西边那道岩台视野极佳，适合先敲掉哨卡狙击手；东边干涸暗渠能摸到他们屁股后头！',
              '咱们这一趟深入中亚腹地没有后援，每一步都得稳准狠，跟紧了！',
            ]
          : this.stage === 'zone2' || this.stage === 'zone3'
            ? [
                '油田里到处是输油管道和油罐车，利用地形高低差打交叉火力，别站在空地上挨枪子！',
                '记住，先清掉高处狙击手和干扰源，我们全队步步紧跟掩护你！',
              ]
            : this.stage === 'zone4' || this.stage === 'zone5'
              ? [
                  '越靠近厄普西隆的核心机房，敌人反扑越疯！进掩体前先补满弹匣！',
                  '百灵解密需要时间，无论发生什么，咱们兄弟三个拼死也得守住这道防线！',
                ]
              : [
                  '悬崖上面视野全开！炸掉那座巨型卫星天线，咱们坐海雕一号回家！',
                ];
      const i = this.talkIdx.get(npc.name) ?? 0;
      line = pool[i % pool.length];
      this.talkIdx.set(npc.name, i + 1);
      for (const s of this.squad) if (!s.holdScripted) s.moving = false;
      npc.action = engaged ? 'combat' : 'signal';
      setTimeout(() => { if (npc.action === 'signal') npc.action = 'combat'; }, 1800);
    } else if (npc === this.tiechui) {
      const a = p.ammo[p.weapon];
      const def = p.def;
      const needSupply = this.tiechuiGiftZone !== this.stage && ((a && a.reserve < def.reserve * 0.65) || p.grenades < 2);
      if (needSupply) {
        this.tiechuiGiftZone = this.stage;
        if (a) a.reserve = Math.min(def.reserve, a.reserve + def.mag * 2);
        p.grenades = Math.min(p.maxGrenades, p.grenades + 2);
        audio.play('pickup', { vol: 0.72 });
        audio.play('magin', { vol: 0.48, delay: 0.14 });
        g.hud.popup(0, '洞二·铁锤战场补给 · 弹药与手雷已补充', false);
        line = '哟，弹药告急了吧？接着！我背囊里还富余两个满匣和两颗雷，拿去轰他丫的！';
      } else {
        const pool = [
          '毒蛇那孙子嘴上狂得很，待会儿我亲手把他的卫星大锅盖给掀了！',
          '放心往前冲洞三！重火力压制交给我，哪个雇佣兵敢露头我就给他剃个光头！',
          '这戈壁滩风沙真大，不过打完这一仗，回去我请全队吃涮羊肉！',
        ];
        const i = this.talkIdx.get(npc.name) ?? 0;
        line = pool[i % pool.length];
        this.talkIdx.set(npc.name, i + 1);
      }
    } else {
      const liveNearby = g.enemies.filter((e) => e.alive).length;
      const i = this.talkIdx.get(npc.name) ?? 0;
      this.talkIdx.set(npc.name, i + 1);
      if (i % 2 === 0 && liveNearby > 0) {
        audio.play('radio', { vol: 0.25 });
        line = `热成像扫描完毕：前方战区还剩 ${liveNearby} 名敌方武装目标，我已经把威胁方向标给老高和铁锤了！`;
      } else {
        const pool = [
          '云茹姐的加密链路已经接通，只要咱们把地下核心库的数据拷出来，厄普西隆的阴谋就彻底捂不住了！',
          '放心交火吧洞三，我会盯着侧翼和二层高台，绝不让敌人摸到你背后！',
        ];
        line = pool[i % pool.length];
      }
    }

    npc.startTalking(4.6);
    this.talkCooldown = 0.65;
    const dur = Math.max(3.2, line.length * 0.115 + 0.7);
    this.talkSubTimer = dur;
    g.hud.subtitle(npc.name, line);
    audio.play('ui_click', { vol: 0.3, rate: 1.15 });
    speak(npc.name, line, false);
    return true;
  }

  private wait(cond: () => boolean, gen: number) {
    return new Promise<void>((resolve) => {
      if (gen !== this.gen) return;
      if (cond()) { resolve(); return; }
      this.waits.push({ gen, cond, resolve });
    });
  }

  private sleep(sec: number, gen: number) {
    const end = this.t + sec;
    return this.wait(() => this.t >= end, gen);
  }

  private async say(who: string, text: string, gen: number, radio = false, extra = 0.45) {
    if (gen !== this.gen) return;
    this.scriptedSpeaking = true;
    this.talkSubTimer = 0;
    this.g.hud.subtitle(who, text);
    speak(who, text, radio);
    const clip = clipDuration(text);
    const dur = clip > 0 ? clip + extra : Math.max(2.4, text.length * 0.12 + extra);
    await this.sleep(dur, gen);
    if (gen === this.gen) {
      this.scriptedSpeaking = false;
      if (this.talkSubTimer <= 0) this.g.hud.subtitle(null);
    }
  }

  private spawn(kind: Enemy['kind'], x: number, y: number, z: number, yaw: number, tag: string, stealth = false, pts?: [number, number][]) {
    const e = new Enemy(kind, x, z, kind === 'heavy' ? 0.92 : 0.82);
    e.pos.set(x, y, z);
    e.yaw = yaw;
    e.tag = tag;
    e.stealthIdle = stealth;
    if (pts) e.patrolPts = pts;
    e.model.root.position.copy(e.pos);
    e.model.root.rotation.y = yaw;
    this.g.enemies.push(e);
    this.g.r.scene.add(e.model.root);
    return e;
  }

  private aliveCount(tag?: string) {
    let n = 0;
    for (const e of this.g.enemies) if (e.alive && (!tag || e.tag === tag)) n++;
    return n;
  }

  private openGateCinematic(id: 'g12' | 'g23' | 'g34' | 'g45' | 'g56', label: string) {
    this.oil.setGateOpen(id, true);
    audio.play('imp_metal', { vol: 0.9, rate: 0.72 });
    audio.play('objective', { vol: 0.65 });
    this.g.hud.popup(250, `闸门解锁 · ${label}`, false);
    this.g.score += 250;
    this.g.hud.setScore(this.g.score);
  }

  // -------------------------------------------------------------------------
  // Full 6-Zone ~30-Minute Campaign Script
  // -------------------------------------------------------------------------
  private async run(gen: number) {
    const g = this.g;
    const p = g.player;
    const hud = g.hud;

    // =======================================================================
    // ZONE 1: 戈壁峡谷空降点与外围暗哨 (~4 min)
    // =======================================================================
    this.stage = 'zone1';
    hud.announce('第二关 · 戈壁炼狱', '202X年10月16日 17:40 · 中亚戈壁 · 喀拉干达 7 号油田');
    hud.setObjective('Zone 1 · 戈壁峡谷渗透', '肃清峡谷外围暗哨并抵达 01 号安全检查站', '西侧岩台 / 中路公路 / 东侧暗渠');

    for (const e of OILFIELD.z1Enemies) this.spawn(e.kind, e.x, e.y, e.z, e.yaw, 'z1', e.stealth, e.pts);
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z1Gate.x, 2.4, OILFIELD.z1Gate.z - 1.5), '01 号检查站闸门');

    void this.say('海雕-1', '利刃小队已落地！防空雷达扫过来了，我必须立刻拉升撤出峡谷，等你们摧毁高轨天线再回来接应！', gen, true, 0.35)
      .then(() => this.say('西北通讯所 · 云茹', '老高，听到吗？泰山号抢回来的芯片密钥，全部汇进了这座假借采油厂伪装的厄普西隆地下中继站……你们只有一次机会，一定要活着回来！', gen, true, 0.4))
      .then(() => this.say('洞幺·老高', '放心吧云茹，利刃从不掉链子！兄弟们听着——西边岩台可以架狙，东边暗渠能绕后，先拔掉前方 01 号检查站！', gen, false, 0.35));

    await this.wait(() => {
      const left = this.aliveCount('z1');
      hud.setObjective('Zone 1 · 突破外围哨卡', left > 0 ? `肃清峡谷哨兵与重机枪守卫（剩余 ${left}）` : '前往 01 号闸门控制箱解锁', '物理闸门封锁中');
      return left === 0;
    }, gen);

    hud.setWaypoint(new THREE.Vector3(OILFIELD.z1Gate.x, 1.8, OILFIELD.z1Gate.z - 2.2), '解锁 01 号检查站闸门');
    hud.hint('外围哨卡已清空！靠近 01 号防爆闸门按 [F] 解除封锁进入采油区', 6);
    await this.wait(() => Math.hypot(p.pos.x - OILFIELD.z1Gate.x, p.pos.z - OILFIELD.z1Gate.z) < 6.0, gen);
    this.interactPrompt = '强行切开 01 号检查站防爆闸门';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;
    this.openGateCinematic('g12', '01 号检查站闸门已升起');

    // =======================================================================
    // ZONE 2: 荒漠采油区与雇佣兵前哨 (~5 min)
    // =======================================================================
    this.stage = 'zone2';
    for (const e of OILFIELD.z2Enemies) this.spawn(e.kind, e.x, e.y, e.z, e.yaw, 'z2', false);
    hud.announce('Zone 2 · 荒漠采油区与前哨', '肃清磕头机采油区雇佣兵，并炸毁西侧电子干扰塔！');
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z2Jammer.x, 3.2, OILFIELD.z2Jammer.z), '摧毁西侧雷达干扰塔');

    void this.say('雇佣兵指挥官·毒蛇', '呵……还真让你们顺着网线摸到中亚来了？可惜啊，进了喀拉干达油田，你们连一块全尸都留不下！全员开火，碾碎他们！', gen, true, 0.4)
      .then(() => this.say('洞二·铁锤', '少他妈在电台里放狠话！洞三，东边二楼哨塔上有狙击手，西边沙袋坑里架着干扰塔，咱们端了他的老窝！', gen, false, 0.35));

    // Wait for player to reach West Radar Jammer & plant C4
    await this.wait(() => {
      const left = this.aliveCount('z2');
      hud.setObjective('Zone 2 · 荒漠采油区', `前往西侧沙袋阵地爆破干扰塔（区域敌军 ${left}）`, '注意东侧 7.9m 岗楼狙击手');
      return Math.hypot(p.pos.x - OILFIELD.z2Jammer.x, p.pos.z - OILFIELD.z2Jammer.z) < 4.2;
    }, gen);

    this.interactPrompt = '在雷达干扰塔基座安放 C4 炸药';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;
    hud.hint('正在输入起爆密码 · 安放 C4 炸药…', 2.2);
    g.plantC4Charge(new THREE.Vector3(OILFIELD.z2Jammer.x, 1.15, OILFIELD.z2Jammer.z + 0.86), 0, 2.8, 2.15, true);
    await this.sleep(2.15, gen);
    hud.hint('C4 已引信启动！立刻后撤躲避冲击波（3 秒）！', 3.0);
    await this.sleep(2.8, gen);
    const jPos = new THREE.Vector3(OILFIELD.z2Jammer.x, 1.8, OILFIELD.z2Jammer.z);
    g.fx.explosion(jPos, 1.5);
    audio.play('explosion', { vol: 1.0, rate: 0.78 });
    p.addShake(0.85);
    this.oil.destroyJammer();
    g.score += 400;
    hud.setScore(g.score);
    hud.popup(400, '雷达干扰塔已摧毁 · 通讯链路恢复', false);

    // Wait until remaining Zone 2 threats <= 2 so player can push cleanly to Gate 2->3
    await this.wait(() => {
      const left = this.aliveCount('z2');
      hud.setObjective('Zone 2 · 推进至储油罐区', left > 2 ? `压制残余雇佣兵（剩余 ${left}）` : '前往南侧 02 号储罐区闸门', '干扰已清除');
      return left <= 2;
    }, gen);

    this.openGateCinematic('g23', '02 号储罐区防爆闸门已开启');
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z2Gate.x, 2.5, OILFIELD.z2Gate.z), '进入 Zone 3 · 巨型储油罐阵');
    await this.say('洞四·百灵', '干扰塔一炸，我立马扫到了储罐区控制信号！02 号防爆门已经被我远程撬开，全队切入储油罐阵！', gen, false, 0.3);

    await this.wait(() => p.pos.z > 36.5, gen);

    // =======================================================================
    // ZONE 3: 巨型储油罐阵与装车泵站 (~6 min)
    // =======================================================================
    this.stage = 'zone3';
    for (const e of OILFIELD.z3Enemies) this.spawn(e.kind, e.x, e.y, e.z, e.yaw, 'z3', false);
    hud.announce('Zone 3 · 巨型储油罐阵与装车泵站', '关闭 2 处高压原油阀门（5.2m 罐顶连廊 + 东侧装车棚），切断精炼厂封锁！');

    void this.say('洞幺·老高', '好大的储油罐阵！楼上五米高的钢铁连廊四通八达，既能抢占制高点，也要提防头顶的黑枪！先关掉两处高压油阀！', gen, false, 0.35);

    // Dual-objective loop: player can close Valve 1 (5.2m catwalk) and Valve 2 (Loading Bay) in EITHER order!
    while (!this.valve1Done || !this.valve2Done) {
      const targetV = !this.valve1Done ? OILFIELD.z3Valve1 : OILFIELD.z3Valve2;
      const vLabel = !this.valve1Done ? '关闭 1 号高压油阀（5.2m 罐顶连廊）' : '关闭 2 号高压油阀（东侧装车棚）';
      hud.setWaypoint(new THREE.Vector3(targetV.x, targetV.y + 1.5, targetV.z), vLabel);
      const doneCnt = (this.valve1Done ? 1 : 0) + (this.valve2Done ? 1 : 0);
      hud.setObjective('Zone 3 · 巨型储油罐阵', `关闭高压原油阀门（${doneCnt}/2）`, `区域敌军 ${this.aliveCount('z3')}`);

      const d1 = !this.valve1Done ? Math.hypot(p.pos.x - OILFIELD.z3Valve1.x, p.pos.z - OILFIELD.z3Valve1.z) + Math.abs(p.pos.y - OILFIELD.z3Valve1.y) : 99;
      const d2 = !this.valve2Done ? Math.hypot(p.pos.x - OILFIELD.z3Valve2.x, p.pos.z - OILFIELD.z3Valve2.z) + Math.abs(p.pos.y - OILFIELD.z3Valve2.y) : 99;
      if (d1 < 3.4) {
        this.interactPrompt = '转动 1 号罐顶高压油阀';
        if (this.interactPressed) {
          this.interactPressed = false;
          this.interactPrompt = null;
          this.valve1Done = true;
          this.oil.closeValve(1);
          audio.play('imp_metal', { vol: 0.82, rate: 0.9 });
          audio.play('objective', { vol: 0.6 });
          g.score += 300; hud.setScore(g.score);
          hud.popup(300, '1 号罐顶高压油阀已切断', false);
        }
      } else if (d2 < 3.4) {
        this.interactPrompt = '转动 2 号装车泵站高压油阀';
        if (this.interactPressed) {
          this.interactPressed = false;
          this.interactPrompt = null;
          this.valve2Done = true;
          this.oil.closeValve(2);
          audio.play('imp_metal', { vol: 0.82, rate: 0.9 });
          audio.play('objective', { vol: 0.6 });
          g.score += 300; hud.setScore(g.score);
          hud.popup(300, '2 号装车泵站油阀已切断', false);
        }
      } else {
        this.interactPrompt = null;
        this.interactPressed = false;
      }
      await this.sleep(0.08, gen);
    }

    this.openGateCinematic('g34', '精炼厂地面闸门与 5.2m 架空管廊双入口已开启');
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z3Gate.x, 2.2, OILFIELD.z3Gate.z), '突入 Zone 4 · 核心精炼厂区');
    await this.say('洞二·铁锤', '漂亮！油压全泄了，精炼厂地面大门和东边高架连廊全解锁了！挑一条痛快的路杀进去！', gen, false, 0.3);

    await this.wait(() => p.pos.z < 33.5 && p.pos.x > -45, gen);

    // =======================================================================
    // ZONE 4: 核心裂解精炼厂区 — 三层立体主战场 (~6 min)
    // =======================================================================
    this.stage = 'zone4';
    for (const e of OILFIELD.z4Enemies) this.spawn(e.kind, e.x, e.y, e.z, e.yaw, 'z4', false);
    hud.announce('Zone 4 · 核心裂解精炼厂区', '三层立体钢架主战场 · 攻占西侧 2F 全景中控室解除地下掩体封锁！');
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z4Console.x, OILFIELD.z4Console.y + 1.6, OILFIELD.z4Console.z), '西侧 2F 全景中控室终端');

    void this.say('洞幺·老高', '抬头看！九米高架上有狙击手，西边二楼玻璃房就是炼油厂中控室！占领中控室，把通往地下掩体的防爆大门打开！', gen, false, 0.35);

    await this.wait(() => {
      const left = this.aliveCount('z4');
      hud.setObjective('Zone 4 · 攻占 2F 中控室', `强攻西侧 2F 玻璃中控室终端（区域敌军 ${left}）`, '4.5m/9.0m 立体交火');
      return Math.hypot(p.pos.x - OILFIELD.z4Console.x, p.pos.z - OILFIELD.z4Console.z) < 3.6 && p.pos.y > 3.5;
    }, gen);

    this.interactPrompt = '操作中控终端 · 解除地下掩体防爆闸封锁';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;
    this.oil.activateControlRoom();
    audio.play('radio', { vol: 0.6 });
    this.openGateCinematic('g45', '04 号地下防爆闸门已解除封锁');

    // Ambush squad rushing out of the opened underground ramp!
    for (const ae of OILFIELD.z4Ambush) this.spawn(ae.kind, ae.x, ae.y, ae.z, ae.yaw, 'z4a', false);
    hud.setWaypoint(new THREE.Vector3(24, 1.5, 10), '下探东侧地下防爆斜坡 ▶ Zone 5');
    void this.say('雇佣兵指挥官·毒蛇', '他们打开了地堡闸门！绝不能让他们碰核心服务器——增援小队立刻堵住斜坡，格杀勿论！', gen, true, 0.35)
      .then(() => this.say('洞四·百灵', '地下掩体大门已经升起来了，但门口冲出一波拦截小队！打穿他们，顺着东侧大斜坡下地堡！', gen, false, 0.3));

    await this.wait(() => p.pos.x > 36.5 && p.pos.y < -3.0, gen);

    // =======================================================================
    // ZONE 5: 厄普西隆地下卫星数据掩体 (~5 min)
    // =======================================================================
    this.stage = 'zone5';
    for (const e of OILFIELD.z5Enemies) this.spawn(e.kind, e.x, e.y, e.z, e.yaw, 'z5', false);
    hud.announce('Zone 5 · 厄普西隆地下卫星数据掩体', '海拔 -6.0m · 肃清服务器机房并掩护百灵完成核心数据解密！');
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z5Core.x, OILFIELD.z5Core.y + 2.2, OILFIELD.z5Core.z), '中央核心数据库立柱');

    void this.say('洞四·百灵', '我的天……整整四排军用超算机柜！泰山号那批芯片的底层校验码全在正中央的红光核心柱里！帮我清开一条路！', gen, false, 0.35);

    await this.wait(() => {
      const left = this.aliveCount('z5');
      hud.setObjective('Zone 5 · 机房巷战', left > 1 ? `清除机房与 -1.5m 夹层守军（剩余 ${left}）` : '前往中央核心柱启动解密', '注意头顶回廊火力');
      return Math.hypot(p.pos.x - OILFIELD.z5Core.x, p.pos.z - OILFIELD.z5Core.z) < 5.0 && p.pos.y < -3.0 && left <= 2;
    }, gen);

    this.interactPrompt = '接入百灵解密终端 · 抽取厄普西隆机密账本（45秒防御）';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;

    // 45-second High-Intensity 2-Wave Subterranean Defense!
    this.bailing.walkTo(71.5, -6.0, 1.5, 4.8, true);
    audio.play('horn', { vol: 0.65, reverb: 0.5 });
    void this.say('洞四·百灵', '解密程序已启动，需要四十五秒！他们肯定会从北侧冷却大厅和二层回廊疯狂反扑，老高、铁锤、洞三，拜托你们守住！', gen, false, 0.35);

    for (const w1 of OILFIELD.z5HackWave1) this.spawn(w1.kind, w1.x, w1.y, w1.z, w1.yaw, 'z5w', false);
    let wave2Spawned = false;
    const hackDur = 45.0;
    const hackT0 = this.t;
    this.activeTimerLabel = '核心数据解密进度';
    await this.wait(() => {
      const el = this.t - hackT0;
      const prog = clamp(el / hackDur, 0, 1);
      this.activeTimer = Math.max(0, hackDur - el);
      this.oil.setCoreHacking(prog, false);
      hud.setObjective('Zone 5 · 守卫核心服务器', `掩护百灵解密核心数据（${Math.round(prog * 100)}%）`, `防守剩余 ${Math.ceil(this.activeTimer)}s`);
      if (!wave2Spawned && el > 21.0) {
        wave2Spawned = true;
        for (const w2 of OILFIELD.z5HackWave2) this.spawn(w2.kind, w2.x, w2.y, w2.z, w2.yaw, 'z5w', false);
        void this.say('洞二·铁锤', '第二波重装混蛋冲进来了！二层回廊也有人探头，全给我压住！', gen, false, 0.25);
      }
      return prog >= 1;
    }, gen);

    this.activeTimer = -1;
    hud.setTimer(null);
    this.oil.setCoreHacking(1, true);
    this.bailing.holdScripted = false;
    this.openGateCinematic('g56', '05 号悬崖攀升竖井防爆门已开启');
    g.score += 600; hud.setScore(g.score);
    hud.popup(600, '核心机密全部拷贝完毕', false);
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z5Gate.x, -3.2, OILFIELD.z5Gate.z), '北侧攀升竖井 ▲ 前往 +12m 悬崖');

    await this.say('西北通讯所 · 云茹', '数据收到了！老高，百灵……你们立了大功！里面不仅有厄普西隆高层洗钱链路，还有他们正在启动高轨卫星反制指令的铁证！快上悬崖炸掉那座巨型中继天线！', gen, true, 0.45);

    await this.wait(() => p.pos.y > 10.5 && p.pos.z < -44, gen);

    // =======================================================================
    // ZONE 6: 悬崖停机坪与高轨中继塔 — 终局决战 (~5 min)
    // =======================================================================
    this.stage = 'zone6';
    for (const e of OILFIELD.z6InitialEnemies) this.spawn(e.kind, e.x, e.y, e.z, e.yaw, 'z6', false);
    hud.announce('Zone 6 · 悬崖停机坪与高轨中继塔', '最终阶段 · 登上雷达掩体炸毁巨型 Ka 波段中继天线，坚守停机坪撤离！');
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z6DishC4.x, OILFIELD.z6DishC4.y + 2.5, OILFIELD.z6DishC4.z), '高轨卫星中继天线（安放 C4）');

    void this.say('洞幺·老高', '终于重见天日了！看前头那座转着的巨型卫星大锅——冲上雷达楼顶安放炸药，彻底掐断厄普西隆的卫星指令！', gen, false, 0.35);

    await this.wait(() => {
      const left = this.aliveCount('z6');
      hud.setObjective('Zone 6 · 摧毁高轨中继天线', `攻上雷达掩体屋顶安放 C4（守军 ${left}）`, '海拔 +12m 悬崖决战');
      return Math.hypot(p.pos.x - OILFIELD.z6DishC4.x, p.pos.z - OILFIELD.z6DishC4.z) < 5.5 && p.pos.y > 15.2;
    }, gen);

    this.interactPrompt = '在高轨卫星天线基座安放重型 C4 炸药';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;
    hud.hint('正在输入起爆密码 · 安放重型 C4 炸药…', 2.2);
    g.plantC4Charge(new THREE.Vector3(OILFIELD.z6DishC4.x, OILFIELD.z6DishC4.y + 1.15, OILFIELD.z6DishC4.z + 1.15), 0, 3.2, 2.15, true);
    await this.sleep(2.15, gen);
    hud.hint('重型 C4 已启动！立刻撤离屋顶奔向圆形停机坪（3.2 秒后引爆）！', 3.5);
    await this.sleep(3.2, gen);

    // Monumental Satellite Dish Explosion!
    const dPos = new THREE.Vector3(64, 21.5, -77);
    g.fx.explosion(dPos, 2.4);
    audio.play('explosion', { vol: 1.0, rate: 0.52 });
    p.addShake(1.25);
    this.oil.destroySatDish();
    g.score += 800; hud.setScore(g.score);
    hud.popup(800, '厄普西隆高轨卫星中继天线已彻底摧毁！', false);

    // 55-Second 360° Cliffside Helipad Extraction Holdout!
    this.heliMode = 'approach';
    this.heliT = 0;
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z6Helipad.x, OILFIELD.z6Helipad.y + 1.8, OILFIELD.z6Helipad.z), '坚守悬崖停机坪 · 等待海雕-1');
    void this.say('雇佣兵指挥官·毒蛇', '不……不可能！我的中继站！全部预备队给我压上悬崖，谁也别想活着坐上那架直升机！', gen, true, 0.35)
      .then(() => this.say('海雕-1', '看到火光了！防空干扰已消失，海雕一号全速低空切入，五十五秒后降落悬崖停机坪，兄弟们顶住！', gen, true, 0.35));

    for (const h1 of OILFIELD.z6HoldoutWave1) this.spawn(h1.kind, h1.x, h1.y, h1.z, h1.yaw, 'z6h', false);
    let hw2 = false;
    let viperBoss: Enemy | null = null;
    const holdDur = 55.0;
    const holdT0 = this.t;
    this.activeTimerLabel = '海雕-1 抵达倒计时';
    await this.wait(() => {
      const el = this.t - holdT0;
      this.activeTimer = Math.max(0, holdDur - el);
      const bossAlive = !!viperBoss?.alive;
      hud.setObjective(
        bossAlive ? '终局 BOSS 战 · 指挥官·毒蛇' : 'Zone 6 · 坚守悬崖停机坪',
        bossAlive ? '击毙穿戴重装外骨骼的毒蛇，掩护海雕-1 降落！' : `击退毒蛇精锐反扑（敌军 ${this.aliveCount('z6h') + this.aliveCount('z6')}）`,
        bossAlive ? '躲避双肩微型导弹齐射' : `海雕-1 抵达倒计时 ${Math.ceil(this.activeTimer)}s`,
      );
      if (!hw2 && el > 20.0) {
        hw2 = true;
        for (const h2 of OILFIELD.z6HoldoutWave2) this.spawn(h2.kind, h2.x, h2.y, h2.z, h2.yaw, 'z6h', false);
        // Summon Mission 2 Final Boss: Commander Viper in Desert Stealth Exoskeleton!
        viperBoss = this.spawn('boss_viper', 78.0, 12.0, -76.0, Math.PI * 0.75, 'z6boss', false);
        viperBoss.onBossPhase2 = () => {
          hud.announce('指挥官·毒蛇 · 第二阶段【量子超频】！', '全息光翼展开 · 解锁终极技「厄普西隆光栅切割」与幻影分身！');
          void this.say('洞二·铁锤', '毒蛇展开全息光翼进入二阶段量子超频了！小心他甩出来的全息激光墙和浮游奇点雷！', gen, false, 0.2);
        };
        hud.announce('终局 BOSS 战 · 指挥官·毒蛇', '厄普西隆战区总指挥亲自参战 · 警惕战术翻滚与双肩微型导弹！');
        void this.say('雇佣兵指挥官·毒蛇', '一群阴魂不散的利刃杂兵！就让我亲自穿戴外骨骼把你们全部埋葬在戈壁悬崖！', gen, true, 0.25);
      }
      return el >= holdDur && !bossAlive;
    }, gen);

    this.activeTimer = -1;
    hud.setTimer(null);
    this.heliMode = 'hover';
    this.heliT = 0;
    hud.setWaypoint(new THREE.Vector3(OILFIELD.z6Helipad.x, OILFIELD.z6Helipad.y + 1.5, OILFIELD.z6Helipad.z), '登上“海雕-1”撤离！');
    void this.say('海雕-1', '已稳稳落在停机坪！利刃全员快登机，咱们马上起飞！', gen, true, 0.3);

    await this.wait(() => Math.hypot(p.pos.x - OILFIELD.z6Helipad.x, p.pos.z - OILFIELD.z6Helipad.z) < 7.0 && p.pos.y > 11.2, gen);
    this.interactPrompt = '跃入直-20J“海雕-1”机舱 · 撤离喀拉干达油田！';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;
    hud.setWaypoint(null);

    // =======================================================================
    // EPILOGUE: Sunset Desert Extraction over Burning Oilfield!
    // =======================================================================
    this.stage = 'epilogue';
    p.scriptedLock = true;
    this.heliMode = 'extract';
    this.heliT = 0;
    hud.setObjective('任务完成', '直-20J“海雕-1”正在拉升撤离', '全员生还');

    await this.say('洞二·铁锤', '哈哈哈哈！毒蛇那孙子气得电台都摔了吧！看下面整个油田浓烟滚滚的，这一仗打得真痛快！', gen, false, 0.45);
    await this.say('洞幺·老高', '别大意，这只是厄普西隆在海外的一颗棋子。云茹，拿回来的加密账本够不够掀翻背后那帮人？', gen, false, 0.45);
    await this.say('西北通讯所 · 云茹', '足够了……而且比我们预想的更触目惊心。归队休整吧，利刃一分队，祖国以你们为荣。', gen, true, 0.65);

    hud.announce('任 务 完 成', '第二关《戈壁炼狱》全战区通关 · 厄普西隆中亚中继网彻底瘫痪');
    await this.sleep(4.2, gen);

    const acc = p.shots > 0 ? Math.min(1, p.hits / p.shots) : 1;
    const grade = acc > 0.34 ? 'S' : acc > 0.22 ? 'A' : 'B';
    this.onFinish({
      mode: 'oilfield',
      grade,
      gradeText: grade === 'S' ? '戈壁利刃 · 完美歼敌并摧毁中继网' : grade === 'A' ? '钢铁洪流 · 高效破局' : '任务完成 · 成功撤离中亚油田',
      run: 1,
      cqbTime: this.t,
      hostiles: g.kills,
      hostilesTotal: Math.max(g.kills, 45),
      civilians: 0,
      headshots: g.headshots,
      score: g.score + 2500,
      accuracy: acc,
      total: this.t,
      record: true,
    });
  }

  // -------------------------------------------------------------------------
  // Per-frame Simulation Update
  // -------------------------------------------------------------------------
  update(dt: number) {
    this.t += dt;
    const g = this.g;
    const p = g.player;

    if (this.activeTimer >= 0) {
      g.hud.setTimer(this.activeTimer, false, this.activeTimerLabel);
    }

    // 1. Z-20J Helicopter choreography (Zone 1 departure -> Zone 6 approach -> hover -> extract!)
    this.heliT += dt;
    const h = this.oil.heli;
    if (this.heliMode === 'depart') {
      const k = clamp(this.heliT / 10, 0, 1);
      h.position.set(-80 - k * 140, 16 + k * 42, -108 - k * 90);
      h.rotation.set(-0.2, -0.75, 0.18);
      if (k >= 1) this.heliMode = 'hidden';
    } else if (this.heliMode === 'hidden') {
      h.position.set(220, 80, -220);
    } else if (this.heliMode === 'approach') {
      const k = clamp(this.heliT / 52, 0, 1);
      const e = k * k * (3 - 2 * k);
      h.position.set(lerp(185, 94, e), lerp(48, 12.6, e), lerp(-180, -92, e));
      h.rotation.set(-0.1 * (1 - e), Math.PI * 0.72, 0.14 * (1 - e));
    } else if (this.heliMode === 'hover') {
      h.position.set(94, 12.6 + Math.sin(this.t * 2.2) * 0.08, -92);
      h.rotation.set(0, Math.PI * 0.72, 0);
    } else if (this.heliMode === 'extract') {
      const k = clamp(this.heliT / 14, 0, 1);
      const ex = lerp(94, -10, k * k);
      const ey = lerp(12.6, 56, k);
      const ez = lerp(-92, 10, k);
      h.position.set(ex, ey, ez);
      h.rotation.set(-0.16, -0.85, 0.12);
      p.pos.set(ex + 0.9, ey + 0.8, ez + 0.4);
      p.yaw = damp(p.yaw, Math.atan2(-(0 - p.pos.x), -(0 - p.pos.z)), 2.2, dt);
      p.pitch = damp(p.pitch, -0.42, 2.2, dt);
    }

    // 2. Autonomous Side-by-Side Squad Combat AI + [E] Conversation Scanner
    this.talkCooldown = Math.max(0, this.talkCooldown - dt);
    this.combatBarkCd = Math.max(0, this.combatBarkCd - dt);
    if (this.talkSubTimer > 0) {
      this.talkSubTimer -= dt;
      if (this.talkSubTimer <= 0 && !this.scriptedSpeaking) g.hud.subtitle(null);
    }
    if (!this.loudMode && this.stage === 'zone1') {
      for (const e of g.enemies) {
        if (e.alive && !e.stealthIdle) {
          this.loudMode = true;
          g.hud.hint('敌军已进入警戒！哨兵正在向枪声位置集结', 3.5);
          break;
        }
      }
    }
    const loudMode = this.stage !== 'zone1' || this.loudMode;
    const suppressed = !loudMode;
    const onKillBark = (who: string, label: string, isHead: boolean) => {
      if (this.combatBarkCd > 0 || this.scriptedSpeaking || this.talkSubTimer > 0) return;
      this.combatBarkCd = rand(9.0, 14.0);
      const msg = isHead ? `${label}精准爆头！继续推进！` : `干掉一个${label}！洞三小心侧翼！`;
      g.hud.subtitle(who, msg);
      this.talkSubTimer = 2.6;
    };
    if (this.stage !== 'epilogue') {
      for (const s of this.squad) s.updateCombat(dt, g, this.squad, loudMode, suppressed, onKillBark);
    }

    // Nearest squadmate within 4.4m for [E] interactive conversation
    let bestNpc: OilSquadNpc | null = null;
    if (this.stage !== 'epilogue') {
      let bestScore = Infinity;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      for (const s of this.squad) {
        const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z, dy = Math.abs(s.pos.y - p.pos.y);
        const dist = Math.hypot(dx, dz);
        if (dist > 4.4 || dy > 2.2) continue;
        const dot = dist > 0.05 ? (dx * fx + dz * fz) / dist : 1;
        if (dot < -0.15 && dist > 1.8) continue;
        const score = dist - dot * 2.2;
        if (score < bestScore) { bestScore = score; bestNpc = s; }
      }
    }
    this.talkTarget = bestNpc;
    this.talkPrompt = bestNpc ? `与 ${bestNpc.name} 对话交流` : null;

    // 3. Resolve mission coroutine waiters
    for (let i = this.waits.length - 1; i >= 0; i--) {
      const w = this.waits[i];
      if (w.gen !== this.gen) { this.waits.splice(i, 1); continue; }
      if (w.cond()) {
        this.waits.splice(i, 1);
        w.resolve();
      }
    }
  }

  getFriendlyMarkers(out: FriendlyMarker[]) {
    for (const s of this.squad) {
      out.push({ x: s.pos.x, y: s.pos.y + 1.98 * s.model.scale, z: s.pos.z, name: s.name, role: 'ally' });
    }
  }
}
