import * as THREE from 'three';
import { audio } from './core/audio';
import { clipDuration, speak } from './core/voice';
import { angleDiff, clamp, damp, lerp, rand, randInt } from './core/utils';
import { Enemy, type EnemyEnv } from './entities/enemy';
import { SoldierModel, type ModelKind, type SoldierAction } from './entities/soldier';
import { HIGHSEAS_WEAPONS, WEAPONS, WEAPON_ORDER } from './entities/weapons';
import type { Game } from './game';
import type { DebriefStats } from './ui/hud';
import { makeHit } from './world/physics';
import { SHIP, type ShipDynamic } from './world/ship';

const H = Math.PI / 2;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _hit = makeHit();

interface CombatProfile {
  dmg: number;
  rpm: number;
  acc: number;
  burst: [number, number];
  rest: [number, number];
  flankX: number;
  flankBack: number;
}

const SQUAD_PROFILE: Record<string, CombatProfile> = {
  '洞幺·老高': { dmg: 16, rpm: 560, acc: 0.66, burst: [2, 4], rest: [0.65, 1.25], flankX: -2.4, flankBack: 2.3 },
  '洞二·铁锤': { dmg: 14, rpm: 620, acc: 0.58, burst: [4, 6], rest: [0.75, 1.35], flankX: 2.4, flankBack: 2.1 },
  '洞四·百灵': { dmg: 15, rpm: 600, acc: 0.64, burst: [2, 4], rest: [0.7, 1.3], flankX: -0.6, flankBack: 4.1 },
};

interface Waiter {
  gen: number;
  cond: () => boolean;
  resolve: () => void;
}

export interface FriendlyMarker {
  x: number;
  y: number;
  z: number;
  name: string;
  role: 'ally' | 'hostage';
}

/** Allied squadmate / civilian hostage NPC with real tactical combat AI, bounding movement & [E] conversation support. */
class SquadNpc {
  model: SoldierModel;
  pos = new THREE.Vector3();
  goal = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  aim = false;
  crouch = false;
  action: SoldierAction = 'combat';
  moving = false;
  speed = 4.2;
  /** Turns toward player & plays talking gesture while > 0. */
  attend = 0;
  /** When true, holds its scripted breach/cutscene position instead of dynamically following the player. */
  holdScripted = false;
  // Combat AI state
  profile: CombatProfile;
  mag = 30;
  reloadT = 0;
  burstLeft = 0;
  shotT = 0;
  restT = rand(0.25, 0.75);
  senseT = rand(0.05, 0.25);
  target: Enemy | null = null;
  combatCrouch = false;
  private moveCooldown = 0;
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
    x: number,
    y: number,
    z: number,
    yaw: number,
    private scene: THREE.Scene,
    public role: 'ally' | 'hostage' = 'ally',
  ) {
    this.model = new SoldierModel(kind);
    this.pos.set(x, y, z);
    this.goal.copy(this.pos);
    this.yaw = yaw;
    this.holdYaw = yaw;
    this.profile = SQUAD_PROFILE[name] ?? SQUAD_PROFILE['洞幺·老高'];
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

  walkTo(x: number, y: number, z: number, speed = 4.2, hold = false) {
    this.goal.set(x, y, z);
    this.speed = speed;
    this.moving = true;
    this.holdScripted = hold;
  }

  /** Triggers natural talking posture & turns to face player. */
  startTalking(dur = 4.5) {
    this.attend = Math.max(this.attend, dur);
    this.talkGestT = Math.max(this.talkGestT, Math.min(dur, 3.2));
  }

  /** Full autonomous side-by-side combat + bounding movement update for armed squadmates. */
  updateSquadCombat(
    dt: number,
    g: Game,
    peers: SquadNpc[],
    loudMode: boolean,
    suppressed: boolean,
    allowFollow: boolean,
    onKillBark: (who: string, label: string, isHead: boolean) => void,
  ) {
    const p = g.player;
    const world = g.world;
    const env = (g as any).env as EnemyEnv | undefined;
    if (this.attend > 0) this.attend = Math.max(0, this.attend - dt);
    if (this.talkGestT > 0) this.talkGestT = Math.max(0, this.talkGestT - dt);
    this.moveCooldown = Math.max(0, this.moveCooldown - dt);

    // Special scripted animations (helicopter sit / finale hand reach) bypass combat movement
    if (this.action === 'helisit' || this.action === 'reach') {
      this.model.root.position.copy(this.pos);
      this.model.root.rotation.y = this.yaw;
      this.model.update(dt, 0, 0, 1, false, 0, false, 0, this.action);
      return;
    }

    // 1. Target acquisition with real line-of-sight & stealth ROE
    this.senseT -= dt;
    if (this.senseT <= 0 || (this.target && !this.target.alive)) {
      this.senseT = rand(0.14, 0.24);
      let best: Enemy | null = null;
      let bestScore = Infinity;
      _v1.set(this.pos.x, this.pos.y + 1.52, this.pos.z);
      for (const e of g.enemies) {
        if (!e.alive) continue;
        // Strict Stealth ROE: never shoot unalerted sentries during stealth unless they woke up or got flashbanged!
        if (e.stealthIdle && e.stunT <= 0 && !loudMode) continue;
        const dy = Math.abs(e.pos.y - this.pos.y);
        if (dy > 8.5) continue;
        const dist = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (dist > 38) continue;
        _v2.set(e.pos.x, e.pos.y + 1.32, e.pos.z);
        if (!world.lineOfSight(_v1, _v2)) continue;
        let score = dist;
        if (e.sinceShot < 2.2) score -= 5.0; // prioritize active shooters threatening the player
        if (e.stunT > 0) score -= 3.0;
        if (e.kind === 'sniper') score -= 4.0;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      this.target = best;
    }

    // 2. Calm tactical follow (never re-trigger movement when player simply rotates camera in place!)
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
      const cand1X = clamp(p.pos.x - fx * back + rx * side, -12.4, 12.4);
      const cand1Z = clamp(p.pos.z - fz * back + rz * side, -91.5, 91.5);
      const gy1 = world.groundHeight(cand1X, cand1Z, p.pos.y + 0.6, 0.36, 1.4);
      if (Math.abs(gy1 - p.pos.y) < 1.6) return { x: cand1X, y: gy1, z: cand1Z };
      const cand2X = clamp(p.pos.x - fx * 1.8, -12.4, 12.4);
      const cand2Z = clamp(p.pos.z - fz * 1.8, -91.5, 91.5);
      const gy2 = world.groundHeight(cand2X, cand2Z, p.pos.y + 0.6, 0.36, 1.4);
      if (Math.abs(gy2 - p.pos.y) < 1.6) return { x: cand2X, y: gy2, z: cand2Z };
      return null;
    };

    if (allowFollow && !this.holdScripted) {
      // Catch up cleanly across decks/floors if player moved far ahead (e.g. climbed 1F->2F or dropped into hold)
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
      } else if (this.moving && !inCombat && this.moveCooldown <= 0 && dyPlayer < 2.5) {
        const slot = pickFollowSlot(true);
        if (slot && Math.hypot(slot.x - this.goal.x, slot.z - this.goal.z) > 1.8) {
          this.goal.set(slot.x, slot.y, slot.z);
          this.speed = distToPlayer > 8.5 ? 6.2 : distToPlayer > 5.5 ? 5.3 : 4.5;
          this.moveCooldown = 0.45;
        }
      } else if (!this.moving && this.moveCooldown <= 0 && dyPlayer < 2.5) {
        const holdRadius = inCombat ? 12.0 : 4.6;
        const unblockDist = inCombat ? 2.6 : 1.6;
        const playerMovedSinceBlock = Number.isNaN(this.blockedPlayerX)
          || Math.hypot(p.pos.x - this.blockedPlayerX, p.pos.z - this.blockedPlayerZ) > unblockDist;
        if (distToPlayer > holdRadius && playerMovedSinceBlock) {
          const slot = pickFollowSlot(!inCombat);
          if (slot) {
            this.goal.set(slot.x, slot.y, slot.z);
            this.speed = inCombat
              ? (distToPlayer > 12 ? 5.1 : 4.2)
              : (distToPlayer > 8.5 ? 6.2 : distToPlayer > 5.5 ? 5.3 : 4.5);
            this.moving = true;
            this.moveCooldown = inCombat ? rand(2.2, 3.6) : 0.45;
            this.blockedPlayerX = NaN;
            this.blockedPlayerZ = NaN;
          }
        }
      }
    }

    // 3. Movement integration with real world collision + squadmate separation
    let spd = 0;
    let moveX = 0, moveZ = 0;
    if (this.moving) {
      const dx = this.goal.x - this.pos.x;
      const dz = this.goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const settleDist = inCombat ? 4.8 : 3.2;
      const settleGoalD = inCombat ? 2.8 : 1.6;
      if (d < 0.48 || (!this.holdScripted && !playerMoving && distToPlayer < settleDist && d < settleGoalD)) {
        this.moving = false;
        this.holdYaw = this.yaw;
        this.moveCooldown = Math.max(this.moveCooldown, inCombat ? rand(2.4, 3.8) : rand(0.55, 0.9));
      } else {
        const curSpd = this.target ? Math.min(this.speed, 3.6) : this.speed;
        const step = Math.min(d, curSpd * dt);
        const vx = (dx / d) * curSpd;
        const vz = (dz / d) * curSpd;
        const prevX = this.pos.x, prevZ = this.pos.z;
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        // Soft separation from teammates & player so nobody overlaps
        for (const peer of peers) {
          if (peer === this) continue;
          const sx = this.pos.x - peer.pos.x, sz = this.pos.z - peer.pos.z;
          const sd = Math.hypot(sx, sz);
          if (sd > 0.01 && sd < 1.15 && Math.abs(this.pos.y - peer.pos.y) < 1.5) {
            const push = (1.15 - sd) * dt * 3.0;
            this.pos.x += (sx / sd) * push;
            this.pos.z += (sz / sd) * push;
          }
        }
        world.resolveCylinder(this.pos, 0.36, 1.75, 0.55);
        const gy = world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.55, 0.34, 0.85);
        if (Math.abs(gy - this.pos.y) < 1.35) this.pos.y = damp(this.pos.y, gy, 10, dt);
        else this.pos.y = damp(this.pos.y, this.goal.y, 6, dt);
        const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
        spd = moved / Math.max(dt, 1e-4);
        if (spd < 0.35 && d > 0.8) {
          // Blocked by obstacle: stop trying to walk through wall
          this.moving = false;
          this.holdYaw = this.yaw;
          this.moveCooldown = inCombat ? rand(3.5, 5.2) : rand(1.4, 2.2);
          this.blockedPlayerX = p.pos.x;
          this.blockedPlayerZ = p.pos.z;
        }
        const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
        if (spd > 0.1) {
          moveX = (vx * cs - vz * sn) / Math.max(curSpd, 0.1);
          moveZ = (vx * sn + vz * cs) / Math.max(curSpd, 0.1);
        }
        this.stepAcc += moved;
        if (this.stepAcc > 2.0) {
          this.stepAcc = 0;
          if (distToPlayer < 20) audio.playAt('step_metal', this.pos, { vol: 0.22, rateVar: 0.12, refDist: 5 });
        }
      }
    }

    // 4. Aiming, Reloading & Live Firefight Shooting!
    const hasTarget = !!this.target && this.target.alive;
    let aimNow = this.aim || hasTarget;
    let targetYaw = this.yaw;
    let targetPitch = 0;

    if (hasTarget && this.target) {
      const e = this.target;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      const hd = Math.max(0.5, Math.hypot(dx, dz));
      targetYaw = Math.atan2(dx, dz);
      targetPitch = clamp(Math.atan2((e.pos.y + 1.32) - (this.pos.y + 1.44), hd), -0.65, 0.65);
    } else if (this.attend > 0) {
      targetYaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      aimNow = false;
    } else if (this.moving) {
      targetYaw = Math.atan2(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
    } else {
      targetYaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    }

    const turnRate = hasTarget ? 10 : this.moving ? 8 : 5;
    this.yaw += angleDiff(this.yaw, targetYaw) * Math.min(1, dt * turnRate);
    this.pitch = damp(this.pitch, targetPitch, 9, dt);

    // Reloading & Firing State Machine
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      this.burstLeft = 0;
      if (this.reloadT <= 0) {
        this.mag = 30;
        if (distToPlayer < 22) audio.playAt('magin', this.pos, { vol: 0.35, refDist: 6 });
      }
    } else if (this.mag <= 0) {
      this.reloadT = 1.85;
      this.burstLeft = 0;
      if (distToPlayer < 22) audio.playAt('magout', this.pos, { vol: 0.35, refDist: 6 });
    } else if (hasTarget && this.target && env) {
      const facing = Math.abs(angleDiff(this.yaw, targetYaw)) < 0.24;
      if (this.burstLeft > 0) {
        this.shotT -= dt;
        if (!facing) {
          this.burstLeft = 0;
        } else if (this.shotT <= 0) {
          this.shotT += 60 / this.profile.rpm;
          this.burstLeft--;
          this.mag--;
          this.fireAtEnemy(this.target, g, env, suppressed, onKillBark);
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

    // 5. Final Skeletal Animation Sync (reload / combat / crouch / briefing talking gesture / signal)
    const crouchPose = this.crouch || this.reloadT > 0 || (this.combatCrouch && !this.moving && hasTarget);
    let animAction: SoldierAction = this.action;
    let reloadProg = 0;
    if (this.reloadT > 0) {
      animAction = 'reload';
      reloadProg = clamp(1 - this.reloadT / 1.85, 0, 1);
    } else if (this.moving || hasTarget) {
      animAction = 'combat';
    } else if (this.talkGestT > 0 && this.action === 'combat') {
      animAction = 'briefing';
    }

    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.model.update(dt, spd, moveX, moveZ, aimNow && this.reloadT <= 0, this.pitch, crouchPose, 0, animAction, reloadProg);
  }

  private fireAtEnemy(
    e: Enemy,
    g: Game,
    env: EnemyEnv,
    suppressed: boolean,
    onKillBark: (who: string, label: string, isHead: boolean) => void,
  ) {
    this.model.shotKick();
    this.model.root.updateMatrixWorld(true);
    const muzzle = this.model.muzzle(_v1);
    const aimPt = _v2.set(e.pos.x, e.pos.y + 1.32, e.pos.z);
    const dist = muzzle.distanceTo(aimPt);
    const pHit = this.profile.acc * clamp(1.12 - dist / 52, 0.25, 0.85) * (e.stunT > 0 ? 1.25 : 1);
    const hit = Math.random() < pHit;

    if (!hit) {
      const ang = Math.random() * Math.PI * 2;
      const spread = rand(0.32, 0.95) + dist * 0.014;
      aimPt.x += Math.cos(ang) * spread;
      aimPt.y += Math.sin(ang) * spread * 0.55;
      aimPt.z += Math.sin(ang) * spread * 0.5;
    }
    _dir.subVectors(aimPt, muzzle).normalize();

    // Muzzle flash, light pulse & positional gunshot audio
    g.fx.muzzle(muzzle, _dir, suppressed ? 0.34 : 0.78);
    g.r.flash(muzzle, 0xffb868, suppressed ? 5 : 22, 0.045, 11);
    audio.playAt(suppressed ? 'smg' : 'rifle', muzzle, {
      vol: suppressed ? 0.24 : 0.55,
      rate: suppressed ? rand(1.28, 1.42) : rand(0.92, 1.05),
      refDist: suppressed ? 7 : 12,
      reverb: 0.42,
    });

    if (hit && e.alive) {
      const isHead = Math.random() < 0.2;
      const dmg = this.profile.dmg * (isHead ? 1.75 : 1.0);
      if (isHead) aimPt.y = e.pos.y + 1.62;
      g.fx.tracer(muzzle, aimPt);
      g.fx.impact(aimPt, _nrm.copy(_dir).negate(), 'flesh', false);
      e.suppress();
      const killed = e.damage(dmg, _dir, env);
      if (killed) {
        g.kills++;
        g.hud.killFeed(e.stats.label, this.name, isHead);
        onKillBark(this.name, e.stats.label, isHead);
      }
    } else {
      // Trace to real world surface behind the enemy & suppress them!
      const wallHit = g.world.raycast(muzzle.x, muzzle.y, muzzle.z, _dir.x, _dir.y, _dir.z, 55, _hit);
      const endPt = wallHit ? _hit.point : _v3.copy(muzzle).addScaledVector(_dir, 36);
      g.fx.tracer(muzzle, endPt);
      if (wallHit) g.fx.impact(_hit.point, _hit.normal, _hit.surface, false);
      if (dist < 28 && Math.random() < 0.5) e.suppress();
    }
    const noiseR = suppressed ? 10 : 44;
    for (const oe of g.enemies) {
      if (oe.alive) oe.hearShot(muzzle.x, muzzle.y, muzzle.z, noiseR, suppressed, env, 'shot');
    }
  }

  /** Simple update for unarmed civilian hostages & captain. */
  update(dt: number, lookAt?: THREE.Vector3) {
    if (this.attend > 0) this.attend = Math.max(0, this.attend - dt);
    if (this.talkGestT > 0) this.talkGestT = Math.max(0, this.talkGestT - dt);
    let spd = 0;
    if (this.moving) {
      const dx = this.goal.x - this.pos.x;
      const dz = this.goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        this.pos.copy(this.goal);
        this.moving = false;
      } else {
        const step = Math.min(d, this.speed * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.pos.y = damp(this.pos.y, this.goal.y, 6, dt);
        const want = Math.atan2(dx, dz);
        this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * 8);
        spd = this.speed;
      }
    } else if (lookAt || this.attend > 0) {
      const target = lookAt;
      if (target) {
        const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
        this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * 4.8);
      }
    }
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    const animAction: SoldierAction = this.moving
      ? 'combat'
      : this.talkGestT > 0 && this.action !== 'hostage'
        ? 'briefing'
        : this.action;
    this.model.update(dt, spd, 0, 1, this.aim, 0, this.crouch, 0, animAction);
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.model.dispose();
  }
}

/**
 * Campaign Mission 1: 《深海截击》 (High Seas Interception)
 * Full 4-Zone S-Curve Vertical Mission aboard M/V Taishan:
 *   Zone A (Stern 3-Lane Stealth) -> Zone B (3F Superstructure CQB & Optional Bridge Intel)
 *   -> Zone C (14m Below-Deck Cargo Hold) -> Zone D (22° Tilted Sliding-Container Escape & Bow Helipad)
 */
export class HighSeasMission {
  t = 0;
  stage = 'intro';
  onFinish: (stats: DebriefStats) => void = () => {};
  /** Bullet-time multiplier (1.0 normal, 0.24 during Mess Hall breach slow-mo). */
  timeScale = 1;
  /** Custom interact prompt override when player stands near a mission trigger. */
  interactPrompt: string | null = null;
  /** Dynamic [E] conversation prompt when player stands near a squadmate, captain, or rescued crew member. */
  talkPrompt: string | null = null;

  private gen = 0;
  private waits: Waiter[] = [];
  private squad: SquadNpc[] = [];
  private hostages: SquadNpc[] = [];
  private gao!: SquadNpc;
  private tiechui!: SquadNpc;
  private bailing!: SquadNpc;
  private captain!: SquadNpc;
  private ship: ShipDynamic;
  private talkTarget: SquadNpc | null = null;
  private talkIdx = new Map<string, number>();
  private talkSubTimer = 0;
  private talkCooldown = 0;
  private scriptedSpeaking = false;
  private combatBarkCd = 3.0;
  private tiechuiGiftZone = '';
  private reassuredCivs = new Set<SquadNpc>();

  // Dynamic mission flags
  private stormTimer = 4.5;
  private nvgBlend = 0;
  private sinkLevel = 0;
  private sinkTarget = 0;
  private escapeTimer = -1;
  private ecmTimer = -1;
  private ecmActive = false;
  private stealthBroken = false;
  private slowMoT = 0;
  private wtDoorOpen = 0;
  private holdDoorOpen = 0;
  private bowDoorOpen = 0;
  private messDoorOpen = 0;
  private wtOpened = false;
  private holdOpened = false;
  private bowOpened = false;
  private messBreached = false;
  private interactPressed = false;
  private flashThrown = false;
  private heliMode: 'stern' | 'depart' | 'bow' | 'extract' = 'stern';
  private heliTime = 0;
  private heavyPicked = false;
  private inHeliCabin = false;
  private intelCollected = false;
  private disciplinePraised = false;
  worldPrompt: string | null = null;
  private slide1Done = false;
  private slide2Done = false;
  private slide3Done = false;
  private bowSlipDone = false;
  private sniperLaser: THREE.Line | null = null;
  private sniperEnemy: Enemy | null = null;
  private crushTargets: Enemy[] = [];
  private savedQbz: Partial<Record<string, string>> = {};
  private savedQsz: Partial<Record<string, string>> = {};

  constructor(private g: Game, ship: ShipDynamic) {
    this.ship = ship;
  }

  start() {
    this.gen++;
    this.waits.length = 0;
    this.t = 0;
    this.timeScale = 1;
    this.sinkLevel = 0;
    this.sinkTarget = 0;
    this.escapeTimer = -1;
    this.ecmTimer = -1;
    this.ecmActive = false;
    this.stealthBroken = false;
    this.slowMoT = 0;
    this.wtDoorOpen = 0;
    this.holdDoorOpen = 0;
    this.bowDoorOpen = 0;
    this.messDoorOpen = 0;
    this.wtOpened = false;
    this.holdOpened = false;
    this.bowOpened = false;
    this.messBreached = false;
    this.heliMode = 'stern';
    this.heliTime = 0;
    this.heavyPicked = false;
    this.inHeliCabin = false;
    this.intelCollected = this.ship.collectibles.has('hs_bridge_freq');
    this.worldPrompt = null;
    this.talkPrompt = null;
    this.talkTarget = null;
    this.talkIdx.clear();
    this.talkSubTimer = 0;
    this.talkCooldown = 0;
    this.scriptedSpeaking = false;
    this.combatBarkCd = 3.0;
    this.tiechuiGiftZone = '';
    this.reassuredCivs.clear();
    this.g.hud.setIntelProgress(this.ship.collectibles.count, this.ship.collectibles.total);
    this.disciplinePraised = false;
    this.slide1Done = false;
    this.slide2Done = false;
    this.slide3Done = false;
    this.bowSlipDone = false;
    this.crushTargets = [];

    // Authentic PLA Marine "Blade-1" loadout: QBZ-192 + QSZ-193 + 4x Flashbangs
    this.savedQbz = { ...WEAPONS.qbz192.fitted };
    this.savedQsz = { ...WEAPONS.qsz193.fitted };
    WEAPONS.qbz192.fitted = { optic: 'holo', muzzle: 'supp', barrel: 'bstd', grip: 'angled', stock: 'sstd', mag: 'std', laser: 'laser' };
    WEAPONS.qsz193.fitted = { muzzle: 'supp', mag: 'std', laser: 'laser' };
    this.g.player.refreshWeapons();
    this.g.vm.refit('qbz192');
    this.g.vm.refit('qsz193');
    this.g.player.setWeaponOrder(HIGHSEAS_WEAPONS, true);
    this.g.player.ammo.qbz192.mag = this.g.player.def.mag;
    this.g.player.ammo.qbz192.reserve = 180;
    this.g.player.ammo.qsz193.mag = 15;
    this.g.player.ammo.qsz193.reserve = 75;
    this.g.player.grenades = 4;

    // Spawn "利刃"一分队 PLA Marine Special Ops teammates
    const sc = this.g.r.scene;
    this.gao = new SquadNpc('洞幺·老高', 'marine_lead', -1.8, 0.1, -88.0, 0, sc);
    this.tiechui = new SquadNpc('洞二·铁锤', 'marine_heavy', 1.8, 0.1, -88.5, 0, sc);
    this.bailing = new SquadNpc('洞四·百灵', 'marine_tech', 0.4, 0.1, -90.5, 0, sc);
    this.squad.push(this.gao, this.tiechui, this.bailing);

    // Spawn Chinese civilian crew hostages in 1F dorms & 2F Mess Hall (100% unarmed high-vis crew & captain!)
    for (const h of SHIP.cabinHostages) {
      const npc = new SquadNpc('船员', 'hostage_crew', h.x, h.y, h.z, h.yaw, sc, 'hostage');
      npc.action = 'hostage';
      this.hostages.push(npc);
    }
    for (const h of SHIP.messHostages) {
      const npc = new SquadNpc('船员', 'hostage_crew', h.x, h.y, h.z, h.yaw, sc, 'hostage');
      npc.action = 'hostage';
      this.hostages.push(npc);
    }
    const cap = new SquadNpc('老船长', 'hostage_captain', SHIP.captainPos.x, SHIP.captainPos.y, SHIP.captainPos.z, SHIP.captainPos.yaw, sc, 'hostage');
    cap.action = 'hostage';
    this.captain = cap;
    this.hostages.push(cap);

    // Enemy Sniper warning laser line in Zone C Cargo Hold
    const lGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const lMat = new THREE.LineBasicMaterial({ color: 0xff2218, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending });
    this.sniperLaser = new THREE.Line(lGeo, lMat);
    this.sniperLaser.visible = false;
    this.sniperLaser.frustumCulled = false;
    sc.add(this.sniperLaser);

    void this.run(this.gen);
  }

  dispose() {
    this.gen++;
    this.waits.length = 0;
    for (const s of this.squad) s.dispose();
    this.squad.length = 0;
    for (const h of this.hostages) h.dispose();
    this.hostages.length = 0;
    if (this.sniperLaser) {
      this.g.r.scene.remove(this.sniperLaser);
      this.sniperLaser.geometry.dispose();
      (this.sniperLaser.material as THREE.Material).dispose();
      this.sniperLaser = null;
    }
    this.g.hud.setWaypoint(null);
    this.g.hud.setTimer(null);
    this.g.hud.subtitle(null);
    this.g.hud.setZoneTransition(null);
    this.g.r.setFlashlight(false);
    this.g.r.final.uniforms.uNvg.value = 0;
    this.g.player.shipRoll = 0;
    this.g.player.shipSlideX = 0;
    this.g.player.scriptedLock = false;
    this.inHeliCabin = false;
    this.talkPrompt = null;
    this.talkTarget = null;
    this.talkSubTimer = 0;
    this.scriptedSpeaking = false;
    if (Object.keys(this.savedQbz).length) {
      WEAPONS.qbz192.fitted = this.savedQbz as typeof WEAPONS.qbz192.fitted;
      WEAPONS.qsz193.fitted = this.savedQsz as typeof WEAPONS.qsz193.fitted;
      this.g.player.refreshWeapons();
      this.g.vm.refit('qbz192');
      this.g.vm.refit('qsz193');
    }
    this.g.player.setWeaponOrder(WEAPON_ORDER, false);
  }

  /** Triggered when player presses [E] near any squadmate, ship captain, or civilian crew hostage. */
  onTalk(): boolean {
    if (!this.talkTarget || this.talkCooldown > 0 || this.inHeliCabin) return false;
    const npc = this.talkTarget;
    const p = this.g.player;
    const g = this.g;
    const engaged = this.squad.some((s) => !!s.target?.alive) || g.enemies.some((e) => e.alive && !e.stealthIdle && e.pos.distanceToSquared(p.pos) < 30 * 30);

    let line = '';
    if (npc === this.gao) {
      const pool = engaged
        ? [
            '洞三注意掩护！我正在给你压制正面火力，找掩体侧翼点射！',
            '跟紧队形！交替掩护推进，把这帮雇佣兵全按在甲板上！',
            '发现露头目标就打，我和铁锤给你架住交叉火力！',
          ]
        : this.stage === 'deck_stealth'
          ? [
              '压低枪口，保持无线电静默。右舷有检修梯可以占领高架，我带铁锤走中路替你架枪。',
              '发现异常先别急着盲射，利用雷声和消音器逐个清掉巡逻哨，咱们直插水密门。',
              '队形收拢，洞三你在前锋，我和百灵随时准备补枪掩护。',
            ]
          : this.stage === 'cqb_interior'
            ? [
                '上层建筑走廊窄，用战术枪灯看清敌我再扣扳机——绝不能误伤船员。',
                '清完 2F 餐厅如果有空可以顺路上 3F 舰桥，看看敌方有没有留下加密通讯记录。',
                '小队全员紧跟你行动，进门随时可以呼应交叉火力！',
              ]
            : this.stage === 'cargo_hold'
              ? [
                  '压住二层狙击手的红点激光！我们三人展开火力压制，你借集装箱掩体强攻 3 号货柜！',
                  '底舱雇佣兵装备精良，弹药吃紧就去左下角拿那把重型压制步枪！',
                ]
              : [
                  '船体右倾越来越大，别回头恋战！紧贴左舷高位全速冲向船头停机坪！',
                ];
      const idx = this.talkIdx.get(npc.name) ?? 0;
      line = pool[idx % pool.length];
      this.talkIdx.set(npc.name, idx + 1);
      // Rally squad tighter onto player flanks when talking to squad leader!
      for (const s of this.squad) {
        if (!s.holdScripted) s.moving = false;
      }
      npc.action = engaged ? 'combat' : 'signal';
      setTimeout(() => { if (npc.action === 'signal') npc.action = 'combat'; }, 1900);
    } else if (npc === this.tiechui) {
      const a = p.ammo[p.weapon];
      const def = p.def;
      const needSupply = this.tiechuiGiftZone !== this.stage && ((a && a.reserve < def.reserve * 0.6) || p.grenades < 2);
      if (needSupply) {
        this.tiechuiGiftZone = this.stage;
        if (a) a.reserve = Math.min(def.reserve, a.reserve + def.mag * 2);
        p.grenades = Math.min(p.maxGrenades, p.grenades + 2);
        audio.play('pickup', { vol: 0.72 });
        audio.play('magin', { vol: 0.48, delay: 0.14 });
        g.hud.popup(0, '洞二·铁锤战场补给 · 弹药与震撼弹已补充', false);
        line = '弹药快见底了吧？接着！把我的备用弹匣和两颗震撼弹分你，咱们接着干他们！';
      } else {
        const pool = engaged
          ? [
              '火力压制包在我身上！洞三你放心侧翼包抄，哪个敢露头我直接给他点名！',
              '这帮雇佣兵护甲挺厚，我用连发按住他们脑袋，你找准机会爆头！',
            ]
          : this.stage === 'deck_stealth'
            ? [
                '液压钳就挂在我腰上，清完甲板巡逻到了水密门喊我一声，三秒给它剪开。',
                '这帮家伙穿得跟正规军一样，待会儿真交火你躲掩体后头，重火力交给我顶着！',
              ]
            : this.stage === 'cqb_interior'
              ? [
                  '室内 CQB 最怕转角阴人，进门前甩颗震撼弹最省事，我就在你身侧补枪。',
                  '船员都吓坏了，咱们打准一点，把这帮杂碎全收拾干净！',
                ]
              : [
                  '底舱这阵仗明显是奔着灭口来的，跟紧点洞三，咱们杀出一条血路！',
                ];
        const idx = this.talkIdx.get(npc.name) ?? 0;
        line = pool[idx % pool.length];
        this.talkIdx.set(npc.name, idx + 1);
      }
    } else if (npc === this.bailing) {
      const liveNearby = g.enemies.filter((e) => e.alive && e.pos.distanceToSquared(p.pos) < 55 * 55).length;
      const idx = this.talkIdx.get(npc.name) ?? 0;
      this.talkIdx.set(npc.name, idx + 1);
      if (idx % 2 === 0 && liveNearby > 0) {
        audio.play('radio', { vol: 0.25 });
        line = `热源扫描完成：周边战区还有 ${liveNearby} 名敌方武装热源活动，我会帮你盯紧侧翼并实时压制！`;
      } else {
        const pool = [
          '我的便携电子干扰器全程待命，万一潜行暴露能帮你争取三秒缓冲窗口，别慌！',
          '我刚刚截获到货轮内部的异常加密跳频，3F 舰桥终端和底舱货柜一定藏着幕后线索。',
          '放心往前推进，洞三，你的背后和侧翼交给我照看！',
        ];
        line = pool[idx % pool.length];
      }
    } else if (npc === this.captain) {
      if (this.aliveCount('mess') > 0) {
        line = '（压低声音）解放军同志……快找掩体！餐厅里还有端着步枪的劫匪盯着门口！';
      } else {
        const pool = [
          '谢谢你们及时赶到！那伙雇佣兵逼我交出底舱 3 号特种货柜的钥匙，他们带了重型铝热剂下去！',
          '全船二十二名弟兄的命都靠你们了！请一定保住 3 号货柜，也千万注意自身安全！',
        ];
        const idx = this.talkIdx.get(npc.name) ?? 0;
        line = pool[idx % pool.length];
        this.talkIdx.set(npc.name, idx + 1);
      }
    } else {
      // Civilian crew hostage
      const pool = [
        '谢谢解放军同志！外面全是说外语的武装匪徒，我们一直躲在舱里不敢发出一点声音！',
        '他们一登船就砸了电台室，还往底舱搬了好几箱军用炸药……你们一定要小心啊！',
        '放心吧同志，我们就待在安全角落等援军气垫船来，绝不乱跑添乱！',
      ];
      const idx = this.talkIdx.get(npc.name) ?? 0;
      line = pool[idx % pool.length];
      this.talkIdx.set(npc.name, idx + 1);
      if (!this.reassuredCivs.has(npc)) {
        this.reassuredCivs.add(npc);
        g.score += 50;
        g.hud.setScore(g.score);
        g.hud.popup(50, '安抚受困船员 · 秩序稳定', false);
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

  onInteract(): boolean {
    const p = this.g.player;
    // 1. Mission scripted prompt takes priority when standing at an active objective gate
    if (this.interactPrompt) {
      this.interactPressed = true;
      return true;
    }
    // 2. Collectibles (6 High-Seas Intel & Black-Box Dossiers across all 4 zones)
    const got = this.ship.collectibles.tryCollect(p.pos);
    if (got) {
      this.g.score += got.score;
      this.g.hud.setScore(this.g.score);
      const cnt = this.ship.collectibles.count;
      const tot = this.ship.collectibles.total;
      this.g.hud.setIntelProgress(cnt, tot);
      this.g.hud.popup(got.score, `情报已收录 (${cnt}/${tot}) · ${got.title}`, false);
      this.g.hud.hint(`【${got.title}】${got.summary}`, 6.5);
      audio.play('pickup', { vol: 0.78 });
      if (got.id === 'hs_bridge_freq') {
        this.intelCollected = true;
        speak('洞四·百灵', '漂亮！这是雇佣兵的卫星加密频段表，我已同步传回远洋编队指挥室！', true);
      }
      return true;
    }
    // 3. Physical Scene Interactables (armored doors, lighting breakers, steam valves, supply crates)
    const res = this.ship.interactables.interact(p.pos);
    if (res) {
      if (res.kind === 'door') {
        audio.play('imp_metal', { vol: 0.52, rate: res.opened ? 1.18 : 0.84 });
      } else if (res.kind === 'breaker') {
        audio.play('click', { vol: 0.75, rate: res.opened ? 1.1 : 0.78 });
        this.g.hud.hint(res.opened ? `已合闸开启：${res.label}` : `已切断电源：${res.label}`, 3.0);
      } else if (res.kind === 'valve') {
        audio.play('cloth', { vol: 0.85, rate: 0.45 });
        this.g.hud.hint(`高压消防蒸汽释放！利用蒸汽墙掩护推进（10 秒）`, 4.0);
      } else if (res.kind === 'crate' && res.refillAmmo) {
        audio.play('pickup', { vol: 0.78 });
        for (const id of p.weaponOrder) {
          const st = p.ammo[id];
          if (st) {
            st.mag = WEAPONS[id].mag;
            st.reserve = Math.max(st.reserve, WEAPONS[id].reserve);
          }
        }
        p.grenades = Math.max(p.grenades, 4);
        this.g.score += 100;
        this.g.hud.setScore(this.g.score);
        this.g.hud.popup(100, '补给箱开启 · 弹药与震撼弹满额补给', false);
      }
      return true;
    }
    return false;
  }

  onToggleNvg(on: boolean) {
    if (!on && this.g.player.pos.z > -41 && this.g.player.pos.z < 48) {
      this.g.player.flashlightOn = true;
      this.g.r.setFlashlight(true);
    } else if (on && this.g.player.flashlightOn) {
      this.g.player.flashlightOn = false;
      this.g.r.setFlashlight(false);
    }
  }

  onFlashbangDetonate(pos: THREE.Vector3) {
    this.flashThrown = true;
    this.g.r.flash(pos, 0xeef8ff, 120, 0.32, 34);
    audio.play('explosion', { vol: 0.72, rate: 1.55 });
    for (const e of this.g.enemies) {
      if (!e.alive) continue;
      if (e.pos.distanceTo(pos) < 12.5) e.stun(5.5);
    }
    const d = this.g.player.eye.distanceTo(pos);
    if (d < 8) this.g.r.final.uniforms.uFlash.value = Math.max(this.g.r.final.uniforms.uFlash.value, clamp(1 - d / 9, 0.15, 0.55));
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

  /** Half-Life / 3A seamless physical airlock zone transition with animated tactical loading UI. */
  private async playZoneTransition(
    zone: 'A' | 'B' | 'C' | 'D',
    title: string,
    sub: string,
    duration: number,
    gen: number,
    onMidpoint: () => void,
  ) {
    if (gen !== this.gen) return;
    const hud = this.g.hud;
    const p = this.g.player;
    p.scriptedLock = true;
    p.vel.set(0, 0, 0);
    audio.play('imp_metal', { vol: 0.72, rate: 0.78 });
    const t0 = this.t;
    let swapped = false;
    await this.wait(() => {
      const k = clamp((this.t - t0) / duration, 0, 1);
      const status = k < 0.45 ? 'AIRLOCK SEALING // 正在开启气密隔离闸…'
        : k < 0.85 ? 'SYNCING SECTOR // 正在同步目标战区光照与导航网格…'
        : 'SECTOR READY // 气密对接完成';
      hud.setZoneTransition(zone, title, sub, k, status);
      if (!swapped && k >= 0.52) {
        swapped = true;
        onMidpoint();
        this.g.r.markShadowsDirty();
      }
      return k >= 1;
    }, gen);
    if (gen === this.gen) {
      hud.setZoneTransition(null);
      p.scriptedLock = false;
    }
  }

  private async say(who: string, text: string, gen: number, radio = false, extra = 0.45) {
    if (gen !== this.gen) return;
    this.scriptedSpeaking = true;
    this.talkSubTimer = 0;
    this.g.hud.subtitle(who, text);
    speak(who, text, radio);
    const clip = clipDuration(text);
    const dur = clip > 0 ? clip + extra : Math.max(2.3, text.length * 0.115 + extra);
    await this.sleep(dur, gen);
    if (gen === this.gen) {
      this.scriptedSpeaking = false;
      if (this.talkSubTimer <= 0) this.g.hud.subtitle(null);
    }
  }

  private spawnTagged(kind: Enemy['kind'], x: number, y: number, z: number, yaw: number, tag: string, stealth = false, pts?: [number, number][]) {
    const e = new Enemy(kind, x, z, kind === 'heavy' ? 0.85 : 0.75);
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

  // -------------------------------------------------------------------------
  // Main 4-Zone S-Curve Campaign Script
  // -------------------------------------------------------------------------
  private async run(gen: number) {
    const g = this.g;
    const p = g.player;
    const hud = g.hud;

    // =======================================================================
    // 【开场：直-20J“海雕-1”低空渗透（侧舷悬停于船尾索降区）】
    // =======================================================================
    this.stage = 'intro';
    this.inHeliCabin = true;
    p.scriptedLock = true;
    p.pos.set(0.15, 7.98, -88.8);
    p.yaw = Math.PI;
    p.pitch = -0.24;
    this.gao.action = 'helisit';
    this.tiechui.action = 'helisit';
    this.bailing.action = 'helisit';
    this.gao.teleport(-0.68, 8.42, -90.48, 0.35);
    this.tiechui.teleport(0.42, 8.42, -90.52, -0.15);
    this.bailing.teleport(1.18, 8.42, -89.75, -0.95);

    hud.setObjective('深海截击 · 低空渗透', '南海南部公海 · 泰山号货轮', '02:15 热带风暴');
    hud.announce('第一关 · 深海截击', '202X年10月14日 02:15 · 南海公海 · 大顺远洋“泰山号”');
    this.g.r.triggerLightning(1.1);
    audio.play('explosion', { vol: 0.32, rate: 0.42 });

    await this.say('远洋编队指挥室', '授权使用致命武力。首要目标：解救22名大顺船员，确保底舱3号特种集装箱完好。', gen, true, 0.5);
    await this.say('海雕-1', '距离目标船尾300米，风速22节，悬停窗口只有15秒！', gen, true, 0.3);
    await this.say('洞幺·老高', '检查气密和消音器！百灵，甲板热源？', gen, false, 0.3);
    await this.say('洞四·百灵', '小型侦察机被风吹偏了，只扫到船尾有两个落单哨兵。但奇怪……整艘船的无线电静默得像鬼船，不像海盗的作风。', gen, true, 0.3);
    await this.say('洞幺·老高', '管他什么路数，按预案打！挂索！', gen, false, 0.25);

    this.interactPrompt = '抓紧索降绳 · 滑降登船';
    hud.hint('按 [F] 抓紧绳索，索降登上“泰山号”船尾索降坪', 6);
    this.interactPressed = false;
    await this.wait(() => this.interactPressed || this.t > 32, gen);
    this.interactPrompt = null;
    this.inHeliCabin = false;
    audio.play('cloth', { vol: 0.85, rate: 0.78 });

    const ropeT0 = this.t;
    const ropeX = this.ship.heli.position.x - 0.28;
    const ropeZ = this.ship.heli.position.z + 1.74;
    await this.wait(() => {
      const k = clamp((this.t - ropeT0) / 1.75, 0, 1);
      p.pos.set(ropeX, lerp(8.35, 0.1, k * k * (3 - 2 * k)), ropeZ);
      return k >= 1;
    }, gen);
    p.pos.set(0, 0.1, -89.5);
    p.vel.set(0, 0, 0);
    p.scriptedLock = false;
    audio.play('land', { vol: 0.9 });
    p.addShake(0.35);

    this.gao.crouch = false;
    this.tiechui.crouch = false;
    this.bailing.crouch = false;
    this.gao.action = 'combat';
    this.tiechui.action = 'combat';
    this.bailing.action = 'combat';
    this.gao.teleport(-2.4, 0.1, -87.5, 0);
    this.tiechui.teleport(2.4, 0.1, -88.0, 0);
    this.bailing.teleport(0.8, 0.1, -90.5, 0);
    this.heliMode = 'depart';
    this.heliTime = 0;

    // =======================================================================
    // 【Zone A：船尾索降区 & 后甲板集装箱阵（三路宽线性潜行区）】
    // =======================================================================
    this.stage = 'deck_stealth';
    hud.setObjective('Zone A · 甲板幽灵', '按 [N] 启用四目夜视仪', '中路 / 左舷潜行 / 右舷高架三路渗透');
    hud.hint('按 [N] 放下四目夜视仪（右键倾侧 QBZ-192 使用红外激光）；右舷可登高架绕后，左舷可低位潜行', 8);
    await this.wait(() => p.nvgOn || p.pos.z > -82.0, gen);
    if (!p.nvgOn) {
      p.nvgOn = true;
      audio.play('equip', { vol: 0.55, rate: 1.25 });
    }

    const sLeft = this.spawnTagged('specops', SHIP.smokeSentries[0].x, 0.1, SHIP.smokeSentries[0].z, SHIP.smokeSentries[0].yaw, 'smoke', true);
    const sRight = this.spawnTagged('specops', SHIP.smokeSentries[1].x, 0.1, SHIP.smokeSentries[1].z, SHIP.smokeSentries[1].yaw, 'smoke', true);

    this.gao.walkTo(-2.6, 0.1, -82.5, 3.6);
    this.tiechui.walkTo(2.6, 0.1, -82.8, 3.6);
    this.bailing.walkTo(0.2, 0.1, -84.2, 3.4);
    hud.setObjective('甲板幽灵 · 同步射击', '锁定左侧哨兵', '等待雷声掩护');
    hud.setWaypoint(new THREE.Vector3(sLeft.pos.x, 1.8, sLeft.pos.z), '左侧哨兵');
    await this.wait(() => p.pos.z > -83.5 || !sLeft.alive || !sRight.alive, gen);

    this.gao.aim = true;
    await this.say('洞幺·老高', '洞三，左边那个归你，右边归我。等雷声掩护……三、二、一，打！', gen, false, 0.1);
    this.g.r.triggerLightning(1.35);
    audio.play('explosion', { vol: 0.45, rate: 0.36 });
    if (sRight.alive) {
      audio.play('rifle', { vol: 0.35, rate: 1.15 });
      sRight.damage(500, new THREE.Vector3(0, 0, 1), (this.g as any).env);
    }
    hud.hint('趁雷声击倒左侧哨兵！', 5);
    await this.wait(() => !sLeft.alive && !sRight.alive, gen);
    hud.setWaypoint(null);

    this.tiechui.walkTo(sRight.pos.x + 0.8, 0.1, sRight.pos.z - 0.8, 4.2);
    await this.sleep(0.7, gen);
    this.tiechui.crouch = true;
    await this.say('洞二·铁锤', '头儿，不对劲！这帮孙子穿的是全套军规防弹插板和夜视头盔，手里拿的是改装过的西方制式卡宾枪——南海哪有这种装备的海盗？', gen, false, 0.4);
    this.tiechui.crouch = false;
    this.gao.action = 'signal';
    await this.say('洞幺·老高', '提高警惕，可能是境外雇佣兵！右舷有检修梯能上集装箱顶架枪，左舷货道可低位包抄，向白色上层建筑水密门推进！', gen, false, 0.3);
    this.gao.action = 'combat';

    for (const pp of SHIP.patrolPairs) {
      this.spawnTagged('specops', pp.x, 0.1, pp.z, pp.yaw, 'deck', true, pp.pts);
    }
    // Tactical Node advancement along center lane
    this.gao.walkTo(-1.8, 0.1, -63.0, 3.8);
    this.tiechui.walkTo(2.0, 0.1, -63.5, 3.8);
    this.bailing.walkTo(-0.4, 0.1, -66.0, 3.6);
    hud.setWaypoint(new THREE.Vector3(SHIP.watertightDoor.x, 2.2, SHIP.watertightDoor.z - 1.0), '暖黄钨丝灯 · 水密门');

    await this.wait(() => {
      const left = this.aliveCount('deck');
      hud.setObjective('Zone A · 集装箱阵渗透', left > 0 ? `肃清甲板巡逻哨（剩余 ${left}）` : '前往暖黄灯水密门', this.ecmActive ? `干扰倒计时 ${this.ecmTimer.toFixed(1)}s` : '三路宽线性推进');
      if (p.pos.z > -60 && this.gao.goal.z < -56) {
        this.gao.walkTo(-2.0, 0.1, -46.0, 4.2);
        this.tiechui.walkTo(1.8, 0.1, -45.5, 4.2);
      }
      return left === 0 || (p.pos.z > -45.0 && Math.abs(p.pos.x) < 7 && left <= 1);
    }, gen);

    this.gao.walkTo(-2.0, 0.1, -42.6, 4.5);
    this.tiechui.walkTo(1.4, 0.1, -42.2, 4.5);
    this.bailing.walkTo(-3.6, 0.1, -43.5, 4.3);
    hud.setWaypoint(new THREE.Vector3(SHIP.watertightDoor.x, 1.6, SHIP.watertightDoor.z - 0.5), '重型水密门');

    // =======================================================================
    // 【Zone B：3层上层建筑（1F回字形搜房 ➔ 2F双门破门救人 ➔ 3F舰桥支线情报）】
    // =======================================================================
    this.stage = 'cqb_interior';
    await this.wait(() => Math.hypot(p.pos.x - SHIP.watertightDoor.x, p.pos.z - SHIP.watertightDoor.z) < 4.5 && p.pos.y < 1.2, gen);
    this.interactPrompt = '示意铁锤用液压钳破拆水密门（3秒）';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;

    // 3-second hydraulic cutter breach sequence -> Physical Airlock opens -> Seamless Half-Life Zone B Transition!
    audio.play('imp_metal', { vol: 0.85, rate: 0.65 });
    hud.hint('铁锤正在用液压钳剪断气密水密门锁链……', 2.4);
    await this.sleep(1.8, gen);
    audio.play('imp_metal', { vol: 1.0, rate: 0.95 });
    this.wtOpened = true;
    this.ship.watertightCollider.enabled = false;
    await this.sleep(0.45, gen);

    await this.playZoneTransition(
      'B',
      'ZONE B · 三层上层建筑生活区',
      '1F 回字形船员宿舍清剿 · 2F 船员餐厅双门破入 · 3F 全景舰桥支线情报',
      0.95,
      gen,
      () => {
        p.pos.set(0, 0.05, -40.4);
        p.yaw = Math.PI;
        p.pitch = 0;
        if (p.nvgOn) {
          p.nvgOn = false;
          p.flashlightOn = true;
          g.r.setFlashlight(true);
        }
        this.ship.setIndoors(true);
        // Bring squad cleanly through the opened watertight airlock right beside the player
        this.gao.teleport(-2.4, 0.05, -39.4, Math.PI);
        this.tiechui.teleport(2.4, 0.05, -39.4, Math.PI);
        this.bailing.teleport(0.0, 0.05, -41.0, Math.PI);
      },
    );
    hud.announce('Zone B · 上层建筑生活区', '1F 回字走廊搜房 · 2F 船员餐厅破门 · 3F 舰桥可选支线情报');
    hud.hint('已通过气密闸门进入室内：已切换战术枪灯，搜查 1F 宿舍后沿右舷楼梯上 2F 餐厅！', 6);

    for (const ce of SHIP.cabinEnemies) {
      this.spawnTagged('rusher', ce.x, ce.y, ce.z, ce.yaw, 'cabin', true);
    }
    for (const me of SHIP.messMilitants) {
      this.spawnTagged('specops', me.x, me.y, me.z, me.yaw, 'mess', true);
    }

    // Tactical Node stack inside 1F 4m loop corridors (aligned to unified 28m ship layout)
    this.gao.walkTo(-8.0, 0.0, -37.5, 3.8);
    this.tiechui.walkTo(8.0, 0.0, -37.5, 3.8);
    this.bailing.walkTo(0, 0.0, -39.0, 3.6);
    hud.setObjective('1F 船员居住区清剿', '搜查两侧船员宿舍后沿右舷楼梯上 2F 餐厅', '严守停火纪律');
    hud.setWaypoint(new THREE.Vector3(SHIP.messBreachSpot.x, 4.6, SHIP.messBreachSpot.z), '2F 船员餐厅破门点');

    await this.say('洞幺·老高', '收起夜视仪，开枪灯！1F 两侧宿舍躲着受惊的船员，看清目标再开火，清完上 2F 餐厅！', gen, false, 0.3);

    // Wait for player to climb 1F -> 2F stairs and arrive right outside 2F Mess Hall main door (y ~ 3.6, z > -33.6)
    await this.wait(() => p.pos.y > 2.8 && p.pos.z > -33.6 && Math.hypot(p.pos.x - SHIP.messBreachSpot.x, p.pos.z - SHIP.messBreachSpot.z) < 3.4, gen);

    // Squad splits for DUAL-DOOR CROSSFIRE BREACH! Ironhammer at East Main Door (2, -32), Gao + Bailing at North Side Door (-4, -26)!
    this.tiechui.teleport(3.0, 3.6, -30.5, -H);
    this.gao.teleport(-3.5, 3.6, -24.5, Math.PI);
    this.bailing.teleport(-4.8, 3.6, -24.5, Math.PI);
    this.tiechui.holdScripted = true;
    this.gao.holdScripted = true;
    this.bailing.holdScripted = true;
    await this.say('洞幺·老高', '透过圆窗看到4名劫匪！我和百灵在北侧门同步切入，铁锤爆破主门，洞三投掷震撼弹——注意别伤着自己人！', gen, false, 0.25);

    this.interactPrompt = '双门同步破门 · 投掷震撼弹（2.5秒子弹时间）';
    hud.hint('按 [F] 或 [G] 投掷震撼弹双门破入，触发 2.5 秒肾上腺素慢动作！', 7);
    this.interactPressed = false;
    this.flashThrown = false;
    await this.wait(() => this.interactPressed || this.flashThrown, gen);
    this.interactPrompt = null;

    // DUAL-DOOR BREACH + FLASHBANG + 2.5s CINEMATIC BULLET TIME!
    this.messBreached = true;
    this.ship.messMainCollider.enabled = false;
    this.ship.messSideCollider.enabled = false;
    audio.play('explosion', { vol: 0.9, rate: 1.4 });
    g.r.flash(new THREE.Vector3(-4.5, 4.8, -29.0), 0xeef8ff, 150, 0.35, 28);
    g.r.final.uniforms.uFlash.value = 0.45;
    p.addShake(0.45);
    for (const e of g.enemies) {
      if (e.tag === 'mess' && e.alive) {
        e.wake();
        e.stun(3.4);
      }
    }
    this.gao.walkTo(-4.0, 3.6, -28.2, 5.2, false);
    this.bailing.walkTo(-6.2, 3.6, -28.2, 5.0, false);
    this.tiechui.walkTo(0.4, 3.6, -30.5, 5.0, false);
    this.slowMoT = 2.6;
    hud.setObjective('2F 船员餐厅破门解救', '慢动作精准击毙 4 名劫匪', '交叉火力 · 保护人质');
    hud.setWaypoint(new THREE.Vector3(-5.5, 4.6, -29.5), '肃清劫匪');

    await this.wait(() => this.aliveCount('mess') === 0, gen);
    this.slowMoT = 0;
    hud.setWaypoint(null);

    this.gao.walkTo(SHIP.captainPos.x + 1.4, 3.6, SHIP.captainPos.z, 4.6);
    this.tiechui.walkTo(-2.5, 3.6, -29.5, 4.2);
    if (this.captain) this.captain.action = 'briefing';
    await this.sleep(0.7, gen);
    await this.say('老船长', '解放军同志……别管我们！他们不是冲船来的！一上船就把大副杀了，逼我交出底舱3号特种货柜的钥匙，他们带了重型铝热剂和炸药下去了！', gen, false, 0.4);
    await this.say('洞四·百灵', '洞幺！底舱监测到高强度数据传输信号，他们在往卫星上传货柜里芯片的底层数据，传完就要毁尸灭迹！', gen, true, 0.4);
    await this.say('洞幺·老高', '全员摘掉消音器！下回 1F 前端检修竖井速降进底舱！（想拿支线情报可顺路上 3F 舰桥拿加密频段表）', gen, false, 0.35);

    // =======================================================================
    // 【Zone C：内部大型主货舱（14米挑高双层钢架 ➔ 3号特种货柜）】
    // =======================================================================
    this.stage = 'cargo_hold';
    WEAPONS.qbz192.fitted.muzzle = 'comp';
    WEAPONS.qbz192.fitted.mag = 'ext';
    p.refreshWeapons();
    g.vm.refit('qbz192');
    p.ammo.qbz192.mag = p.def.mag;
    p.ammo.qbz192.reserve = 240;

    hud.setObjective('前往 3 号主货舱气密闸门', '回到 1F 前端气密闸门进入主货舱（可选：先上 3F 舰桥取情报）', '已卸除消音器');
    hud.setWaypoint(new THREE.Vector3(SHIP.holdShaft.x, 1.5, -18.4), '3号主货舱气密闸门 ▶');

    // Wait for player to return to 1F real physical Cargo Hold Airlock Door at (0, 0, -18)
    await this.wait(() => p.pos.y < 1.5 && Math.hypot(p.pos.x - SHIP.holdShaft.x, p.pos.z - (-19.2)) < 3.4, gen);
    this.interactPrompt = '转动气密门手轮 · 开启 3 号主货舱闸门';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;

    // Physical Cargo Hold Airlock Door swings open -> Half-Life Tactical Sector Transition into Zone C!
    this.holdOpened = true;
    this.ship.holdAirlockCollider.enabled = false;
    audio.play('imp_metal', { vol: 0.92, rate: 0.88 });
    await this.sleep(0.45, gen);

    await this.playZoneTransition(
      'C',
      'ZONE C · 3 号内部大型主货舱',
      '14 米挑高双层工业底舱 · 压制高台狙击手 · 强攻 3 号特种货柜',
      1.05,
      gen,
      () => {
        p.pos.set(SHIP.holdCatwalkEntry.x, SHIP.holdCatwalkEntry.y, SHIP.holdCatwalkEntry.z);
        p.yaw = Math.PI;
        p.pitch = -0.18;
        p.vel.set(0, 0, 0);
        this.ship.setAlarm(true);
      },
    );
    audio.play('horn', { vol: 0.72, reverb: 0.55 });
    hud.announce('Zone C · 内部大型主货舱', '挑高14米双层工业货舱 · 火力全开强攻尽头亮灯的 3 号特种货柜！');
    hud.hint('注意十一点钟二层平台敌方狙击手红色激光预警！左下方角落可拾取重型压制步枪', 7);

    // Spawn Cargo Hold heavy defense force (including upper catwalk laser sniper!)
    this.sniperEnemy = null;
    for (const he of SHIP.holdEnemies) {
      const e = this.spawnTagged(he.kind, he.x, he.y, he.z, he.yaw, 'hold', false);
      if (he.kind === 'sniper' && !this.sniperEnemy) this.sniperEnemy = e;
    }
    this.gao.teleport(-3.2, 0.0, -16.0, 0);
    this.tiechui.teleport(3.2, 0.0, -16.0, 0);
    this.bailing.teleport(0, 0.0, -16.8, 0);
    this.gao.aim = true;
    this.tiechui.aim = true;
    void this.say('洞幺·老高', '十一点钟二层平台有狙击激光！全员利用钢架栏杆压制，往下层货舱包抄推进！', gen, false, 0.25);

    await this.wait(() => {
      const left = this.aliveCount('hold');
      hud.setObjective('Zone C · 主货舱激战', `肃清货舱雇佣兵（剩余 ${left}）`, '强攻尽头白光 3 号货柜');
      // Squad pushes down into the lower hold floor (y = -6.0) as player descends
      if ((p.pos.y < -2.5 || left <= 4) && this.gao.pos.y > -2.0) {
        this.gao.teleport(-5.6, -6.0, 2.5, 0);
        this.tiechui.teleport(5.6, -6.0, 3.0, 0);
        this.bailing.teleport(0, -6.0, -1.5, 0);
      }
      return left === 0;
    }, gen);

    // 3 Fanatic Mercenaries defending Container #3
    for (const fe of SHIP.container3Fanatics) {
      this.spawnTagged(fe.kind, fe.x, fe.y, fe.z, fe.yaw, 'c3', false);
    }
    this.gao.walkTo(-4.0, -6.0, 33.5, 4.6);
    this.tiechui.walkTo(4.0, -6.0, 33.5, 4.6);
    this.bailing.walkTo(0, -6.0, 31.0, 4.4);
    hud.setObjective('夺取 3 号特种货柜', '击毙最后 3 名死士', '阻止销毁服务器');
    hud.setWaypoint(new THREE.Vector3(0, -4.4, 39.5), '3号特种货柜');

    await this.say('洞幺·老高', '放下武器！双手抱头！……不好，他手里有引爆器！洞三开火！', gen, false, 0.25);
    await this.wait(() => this.aliveCount('c3') === 0, gen);

    this.ship.setThermite(true);
    audio.play('explosion', { vol: 0.8, rate: 0.72 });
    p.addShake(0.45);
    g.fx.explosion(new THREE.Vector3(0, -4.8, 42.8), 0.7);
    this.gao.walkTo(-2.2, -6.0, 39.5, 4.8);
    this.tiechui.walkTo(2.2, -6.0, 39.5, 4.8);
    this.bailing.walkTo(-0.8, -6.0, 40.8, 4.8);

    hud.setObjective('检查 3 号特种货柜', '进入货柜查验加密笔记本与龙骨炸药', '发现嫁祸铁证');
    hud.setWaypoint(new THREE.Vector3(SHIP.container3Laptop.x, -4.6, SHIP.container3Laptop.z), '查验加密笔记本');
    await this.wait(() => Math.hypot(p.pos.x - SHIP.container3Laptop.x, p.pos.z - SHIP.container3Laptop.z) < 3.6 && p.pos.y < -3.0, gen);
    this.interactPrompt = '检查加密笔记本与北方联邦塑性炸药';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed, gen);
    this.interactPrompt = null;
    hud.setWaypoint(null);

    await this.say('洞四·百灵', '服务器全毁了，但我在他们没来得及拔掉的加密笔记本上截获了一个商标残影——“Epsilon（厄普西隆）全球电讯”……这不是给我们做卫星中继的跨国承包商吗？他们为什么要毁掉自己公司经手的零件？', gen, false, 0.4);
    await this.say('洞二·铁锤', '更邪门儿的在这儿！西方雇佣兵的装备，但船壳龙骨上贴的塑性炸药和军用雷管，全是北方联邦特种部队现役的批号！这帮杂碎想把船炸沉在南海，栽赃给北边！', gen, false, 0.4);

    // =======================================================================
    // 【Zone D：龙骨起爆断电 ➔ 22°倾斜滑动集装箱逃生 ➔ 船头停机坪】
    // =======================================================================
    this.stage = 'sinking_escape';
    // Keel explosions + 1.5s blackout/smoke shockwave -> ALL main lights shut off, only crimson emergency strobes!
    audio.play('explosion', { vol: 1.0, rate: 0.42 });
    p.addShake(1.4);
    g.r.triggerLightning(1.4);
    g.r.final.uniforms.uFade.value = 0.92;
    this.ship.setBlackout(true);
    await this.sleep(0.75, gen);
    audio.play('explosion', { vol: 1.0, rate: 0.36 });
    p.addShake(1.4);

    this.sinkTarget = 1.0;
    this.escapeTimer = 180;
    this.heliMode = 'bow';
    this.heliTime = 0;

    hud.announce('Zone D · 沉船逃生！', '龙骨起爆断电！右倾 22° 进水，沿右侧绿色荧光应急梯冲向船头停机坪！');
    hud.setObjective('沉船逃生！', '冲上右侧绿色荧光应急梯 ➔ 穿越前甲板登机', '船体倾覆倒计时');
    hud.setWaypoint(new THREE.Vector3(SHIP.emergencyExit.x, -4.0, SHIP.emergencyExit.z), '绿色应急逃生梯 ▲');

    // Spawn 2 forward-deck mercenaries who will be CRUSHED by Sliding Container #1 + 2 bow guards!
    this.crushTargets = [];
    for (const ee of SHIP.escapeCrushEnemies) {
      this.crushTargets.push(this.spawnTagged(ee.kind, ee.x, ee.y, ee.z, ee.yaw, 'crush', false));
    }
    for (const be of SHIP.escapeBowGuards) {
      this.spawnTagged(be.kind, be.x, be.y, be.z, be.yaw, 'escape', false);
    }

    this.gao.teleport(12.0, 0.0, 49.5, 0);
    this.tiechui.teleport(-9.0, 0.0, 61.5, 0);
    this.bailing.teleport(-1.5, 2.0, 88.0, Math.PI);

    void this.say('海雕-1', '利刃小队！货轮右倾进水速度太快，最多撑三分钟！大部队气垫船已经在接应船员了，你们立刻沿前甲板冲向船头停机坪！', gen, true, 0.25)
      .then(() => this.say('洞幺·老高', '百灵带上那台笔记本！全员冲上绿色应急梯，走左舷高位躲开滑落的集装箱！', gen, false, 0.3));

    // Wait for player to rush up the green Emergency Stair to the real physical Bow Emergency Airlock Door (12, 0, 46)
    await this.wait(() => p.pos.z > 43.2 && p.pos.x > 8.5 && p.pos.y > -1.2, gen);
    this.interactPrompt = '撞开前甲板应急逃生闸门 · 突入风暴甲板';
    this.interactPressed = false;
    await this.wait(() => this.interactPressed || p.pos.z > 45.2, gen);
    this.interactPrompt = null;

    this.bowOpened = true;
    this.ship.bowAirlockCollider.enabled = false;
    audio.play('imp_metal', { vol: 1.0, rate: 0.85 });
    await this.sleep(0.32, gen);

    await this.playZoneTransition(
      'D',
      'ZONE D · 倾斜前甲板逃生道',
      '右倾 22° 进水倒计时 · 躲避滑动集装箱 · 冲向船头停机坪登机',
      0.85,
      gen,
      () => {
        p.pos.set(12.0, 0.1, 47.8);
        p.yaw = Math.PI;
        p.pitch = -0.04;
        this.ship.setIndoors(false);
      },
    );
    hud.setWaypoint(new THREE.Vector3(SHIP.bowHelipad.x, 4.5, SHIP.bowHelipad.z), '船头停机坪 · 海雕-1');
    hud.setObjective('Zone D · 倾斜前甲板冲刺', '切向左舷高位躲避滑动集装箱，冲向船头停机坪！', '全速逃生');

    // Wait for player to sprint up the wedged container ramp onto the elevated Bow Helipad (y > 1.5, z > 82)
    await this.wait(() => p.pos.z > 82.0 && p.pos.y > 1.4, gen);

    // Final 10m Dramatic Slip-and-Grab Finale!
    if (!this.bowSlipDone) {
      this.bowSlipDone = true;
      p.addShake(0.85);
      audio.play('land', { vol: 0.9, rate: 0.7 });
      this.gao.teleport(0.0, 2.1, 87.5, Math.PI);
      this.gao.aim = false;
      this.gao.action = 'reach';
      void this.say('洞幺·老高', '洞三！抓紧我的手！跳上来！', gen, false, 0.2);
    }
    await this.wait(() => Math.hypot(p.pos.x - SHIP.bowHelipad.x, p.pos.z - SHIP.bowHelipad.z) < 6.2, gen);

    this.interactPrompt = '抓住老高的手 · 跃入“海雕-1”机舱！';
    hud.hint('按 [F] 抓住老高的手跃入直-20J机舱撤离！', 6);
    this.interactPressed = false;
    await this.wait(() => this.interactPressed || Math.hypot(p.pos.x - SHIP.bowHelipad.x, p.pos.z - SHIP.bowHelipad.z) < 3.0, gen);
    this.interactPrompt = null;
    this.escapeTimer = -1;
    hud.setTimer(null);
    hud.setWaypoint(null);

    // =======================================================================
    // 【关卡结尾过场：暴雨升空与云茹首次献声】
    // =======================================================================
    this.stage = 'epilogue';
    p.scriptedLock = true;
    p.nvgOn = false;
    p.flashlightOn = false;
    g.r.setFlashlight(false);
    this.heliMode = 'extract';
    this.heliTime = 0;
    audio.play('explosion', { vol: 0.85, rate: 0.5 });
    g.r.triggerLightning(1.2);
    hud.setObjective('撤离成功', '直-20J“海雕-1”正在拉升', '任务完成');

    await this.say('洞幺·老高', '抓紧了！……装备是大西洋那边的，炸药是北方联邦的，目标是咱们运往西北基地的芯片……有人在南海底下憋着坏水啊。', gen, false, 0.5);
    await this.say('西北通讯所 · 云茹', '利刃洞幺，我是西北通讯所的云茹。你们抢回来的笔记本残存日志我看过了……情况比你们想的严重得多。那批雇佣兵的资金流向中亚，你们恐怕没时间休整了。', gen, true, 0.7);

    hud.announce('全 面 戒 备', '第一关《深海截击》完成 · 即将前往第二关：中亚油田');
    await this.sleep(4.2, gen);

    const acc = p.shots > 0 ? Math.min(1, p.hits / p.shots) : 1;
    const bonus = this.intelCollected ? 500 : 0;
    const grade = !this.stealthBroken && acc > 0.35 ? 'S' : acc > 0.2 ? 'A' : 'B';
    this.onFinish({
      grade,
      gradeText: grade === 'S' ? '完美渗透 · 利刃出鞘' : grade === 'A' ? '高效突击 · 船员全员获救' : '任务完成 · 成功撤离泰山号',
      run: 1,
      cqbTime: this.t,
      hostiles: g.kills,
      hostilesTotal: Math.max(g.kills, 18),
      civilians: 0,
      accuracy: acc,
      total: g.score + 1500 + bonus,
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
    const ship = this.ship;

    // 1. Slow-mo adrenaline decay (2F Mess Hall dual-door breach)
    if (this.slowMoT > 0) {
      this.slowMoT = Math.max(0, this.slowMoT - dt / Math.max(0.24, this.timeScale));
      this.timeScale = damp(this.timeScale, 0.24, 14, dt);
    } else {
      this.timeScale = damp(this.timeScale, 1.0, 7, dt);
    }

    // 2. Smooth NVG transition & watertight-door indoor rain performance culling
    this.nvgBlend = damp(this.nvgBlend, p.nvgOn ? 1 : 0, 12, dt);
    g.r.final.uniforms.uNvg.value = this.nvgBlend;
    const indoors = p.pos.z > -42.0 && p.pos.z < 46.0 && Math.abs(p.pos.x) < 14.0;
    ship.setIndoors(indoors);

    // 3. Ambient midnight storm lightning (every 15-20s) + thunder
    this.stormTimer -= dt;
    if (this.stormTimer <= 0) {
      this.stormTimer = rand(14.5, 19.5);
      g.r.triggerLightning(rand(0.8, 1.25));
      audio.play('explosion', { vol: 0.25, rate: rand(0.32, 0.45), delay: rand(0.25, 0.8) });
    }
    g.lvl.group.userData.camPos = g.r.camera.position;
    g.lvl.group.userData.lightning = (g.r as any).lightningAmt ?? 0;
    // The ocean needs the real key-light direction so its moon glitter lines up with the hull lighting.
    g.lvl.group.userData.sunDir = g.r.sunDir;

    // 4. Physical Armored Airlock & Breach Door animations
    if (this.wtOpened && this.wtDoorOpen < 1) {
      this.wtDoorOpen = Math.min(1, this.wtDoorOpen + dt * 2.4);
      ship.watertightDoor.rotation.y = -this.wtDoorOpen * 1.85;
    }
    if (this.holdOpened && this.holdDoorOpen < 1) {
      this.holdDoorOpen = Math.min(1, this.holdDoorOpen + dt * 2.6);
      ship.holdAirlockDoor.rotation.y = -this.holdDoorOpen * 1.85;
    }
    if (this.bowOpened && this.bowDoorOpen < 1) {
      this.bowDoorOpen = Math.min(1, this.bowDoorOpen + dt * 3.8);
      ship.bowAirlockDoor.rotation.y = -this.bowDoorOpen * 1.9;
    }
    if (this.messBreached && this.messDoorOpen < 1) {
      this.messDoorOpen = Math.min(1, this.messDoorOpen + dt * 6.5);
      ship.messMainDoor.rotation.y = this.messDoorOpen * 1.95;
      ship.messSideDoor.rotation.y = -this.messDoorOpen * 1.95;
    }

    // 5. Zone B Trigger-Discipline Praise & Optional 3F Bridge Intel Prompt
    if (this.stage === 'cqb_interior' && !this.disciplinePraised && p.pos.y < 1.5) {
      for (const h of SHIP.cabinHostages) {
        if (Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < 4.5) {
          this.disciplinePraised = true;
          g.score += 200;
          g.hud.setScore(g.score);
          g.hud.popup(200, '停火纪律优异 · 零误伤船员', false);
          speak('洞幺·老高', '干得漂亮洞三，冷静克制，没有误伤船员！', false);
          break;
        }
      }
    }
    // 5b. Collectibles & Physical Scene Interactables update
    const nearIntel = ship.collectibles.update(this.t, p.pos);
    const nearProp = ship.interactables.update(dt, this.t, p.pos);
    this.worldPrompt = nearIntel ? `收集情报 · ${nearIntel.title}` : nearProp;

    // 6. Zone A Stealth ECM Jammer (3s grace window!)
    if (this.stage === 'deck_stealth') {
      let alertedEnemy: Enemy | null = null;
      for (const e of g.enemies) {
        if (e.alive && e.tag === 'deck' && !e.stealthIdle) { alertedEnemy = e; break; }
      }
      if (alertedEnemy && !this.ecmActive && !this.stealthBroken) {
        this.ecmActive = true;
        this.ecmTimer = 3.2;
        g.hud.hint('百灵已启动便携电子干扰器！3 秒内解决暴露目标防止拉响全船警报！', 3.2);
        speak('洞四·百灵', '目标警觉！已开启便携干扰器，洞三你有三秒补枪时间！', true);
      }
      if (this.ecmActive) {
        if (!alertedEnemy) {
          this.ecmActive = false;
          g.hud.hint('威胁清除 · 无线电静默得以保持', 2.2);
        } else {
          this.ecmTimer -= dt;
          if (this.ecmTimer <= 0) {
            this.ecmActive = false;
            this.stealthBroken = true;
            ship.setAlarm(true);
            for (const e of g.enemies) if (e.tag === 'deck' && e.alive) e.wake();
            g.hud.hint('潜行暴露！敌军已全面警觉，强行突破！', 3.5);
          }
        }
      }
    }

    // 7. Zone C Enemy Sniper Red Laser Warning Sightline
    if (this.sniperLaser) {
      if (this.stage === 'cargo_hold' && this.sniperEnemy && this.sniperEnemy.alive) {
        this.sniperLaser.visible = true;
        const pos = this.sniperLaser.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, this.sniperEnemy.pos.x, this.sniperEnemy.pos.y + 1.48, this.sniperEnemy.pos.z);
        pos.setXYZ(1, p.eye.x + Math.sin(this.t * 2.2) * 0.65, p.eye.y - 0.15, p.eye.z);
        pos.needsUpdate = true;
      } else {
        this.sniperLaser.visible = false;
      }
    }

    // 8. Zone D 22° Sinking Hull Tilt + 3 Scripted Spline Sliding Giant Container Set-Pieces!
    if (this.sinkTarget > 0) {
      this.sinkLevel = damp(this.sinkLevel, this.sinkTarget, 0.25, dt);
      ship.setSinking(this.sinkLevel);
      const listRad = lerp(0.28, 0.39, this.sinkLevel); // authentic ~22° starboard list!
      p.shipRoll = listRad + Math.sin(this.t * 1.8) * 0.032;
      p.shipSlideX = Math.sin(listRad) * 2.15;
      if (Math.random() < dt * 1.8) p.addShake(0.14);

      // Scripted Container #1: snaps chains & crushes the 2 blocking mercenaries at z = 58.5!
      if (!this.slide1Done && p.pos.z > 51.0 && p.pos.y > -1.0) {
        this.slide1Done = true;
        ship.triggerSlide(1);
        audio.play('imp_metal', { vol: 1.0, rate: 0.52 });
        p.addShake(0.75);
        g.hud.hint('集装箱锁链崩断！中路被砸死，切向左舷高位通道跑酷前进！', 4.5);
      }
      if (this.slide1Done && ship.slide1.t > 0.55) {
        for (const ce of this.crushTargets) {
          if (ce.alive) {
            ce.damage(999, new THREE.Vector3(1, 0, 0), (g as any).env);
            g.fx.explosion(ce.pos.clone().setY(1.0), 0.35);
          }
        }
      }
      // Scripted Container #2: hurtles off the overhead gantry right over the player's head into the sea!
      if (!this.slide2Done && p.pos.z > 61.5 && p.pos.y > -1.0) {
        this.slide2Done = true;
        ship.triggerSlide(2);
        audio.play('explosion', { vol: 0.85, rate: 0.55 });
        p.addShake(0.9);
      }
      // Scripted Container #3: slides & wedges cleanly by the bow ramp!
      if (!this.slide3Done && p.pos.z > 69.5 && p.pos.y > -1.0) {
        this.slide3Done = true;
        ship.triggerSlide(3);
        audio.play('imp_metal', { vol: 0.95, rate: 0.62 });
        p.addShake(0.65);
      }

      if (this.escapeTimer > 0) {
        this.escapeTimer -= dt;
        g.hud.setTimer(Math.max(0, this.escapeTimer), false, '船体倾覆倒计时');
        if (this.escapeTimer <= 0 && p.alive) p.damage(999, null);
      }
    } else {
      p.shipRoll = Math.sin(this.t * 0.85) * 0.025;
      p.shipSlideX = 0;
    }

    // 9. Z-20J "HaiDiao-1" Helicopter Animation across Stern Broadside / Depart / Bow Hover / Extraction
    this.heliTime += dt;
    const h = ship.heli;
    if (this.heliMode === 'stern') {
      const hx = 0.0 + Math.sin(this.t * 1.3) * 0.22;
      const hy = 8.4 + Math.sin(this.t * 2.1) * 0.16;
      const hz = -89.8;
      h.position.set(hx, hy, hz);
      h.rotation.set(Math.sin(this.t * 1.5) * 0.022, -Math.PI * 0.5, Math.cos(this.t * 1.3) * 0.025);
      ship.heliRope.visible = true;
      if (this.inHeliCabin) {
        p.pos.set(hx + 0.15, hy - 0.42, hz + 0.96);
        this.gao.pos.set(hx - 0.68, hy + 0.02, hz - 0.68);
        this.tiechui.pos.set(hx + 0.42, hy + 0.02, hz - 0.72);
        this.bailing.pos.set(hx + 1.18, hy + 0.02, hz + 0.05);
      }
    } else if (this.heliMode === 'depart') {
      ship.heliRope.visible = false;
      const k = Math.min(1, this.heliTime / 8);
      h.position.set(-k * 95, 8.4 + k * 28, -89.8 - k * 40);
      h.rotation.set(-0.22, -0.7, 0.25);
    } else if (this.heliMode === 'bow') {
      ship.heliRope.visible = false;
      h.position.set(Math.sin(this.t * 1.7) * 0.4, 3.55 + Math.sin(this.t * 2.3) * 0.2, 93.5);
      h.rotation.set(-0.08, Math.PI + 0.08, 0.22);
    } else if (this.heliMode === 'extract') {
      const k = clamp(this.heliTime / 14, 0, 1);
      const ex = lerp(0, -38, k * k);
      const ey = lerp(3.8, 38, k);
      const ez = lerp(93.5, 42.0, k);
      h.position.set(ex, ey, ez);
      h.rotation.set(-0.18, Math.PI * 0.72, 0.14);
      p.pos.set(ex + 0.82, ey - 0.38, ez + 0.28);
      p.yaw = damp(p.yaw, Math.atan2(-(0 - p.pos.x), -(30 - p.pos.z)), 2.2, dt);
      p.pitch = damp(p.pitch, -0.46, 2.2, dt);
      p.shipRoll = Math.sin(this.t * 1.5) * 0.04;
    }

    // 10. Zone C Corner Heavy Firepower Pickup (unlocks SCAR-L heavy suppression rifle + full ammo!)
    if (!this.heavyPicked && this.stage === 'cargo_hold' && Math.hypot(p.pos.x - SHIP.holdHeavyPickup.x, p.pos.z - SHIP.holdHeavyPickup.z) < 3.0 && p.pos.y < -3.0) {
      this.heavyPicked = true;
      p.refill();
      p.equipImmediate('scarl');
      g.hud.hint('已拾取货舱重型压制步枪并补满弹药与 4 枚震撼弹！', 3.0);
      audio.play('pickup', { vol: 0.75 });
    }

    // 11. Autonomous Side-by-Side Squad Combat AI, Distance-Culled Hostages & [E] Talk Scanner
    this.talkCooldown = Math.max(0, this.talkCooldown - dt);
    this.combatBarkCd = Math.max(0, this.combatBarkCd - dt);
    if (this.talkSubTimer > 0) {
      this.talkSubTimer -= dt;
      if (this.talkSubTimer <= 0 && !this.scriptedSpeaking) g.hud.subtitle(null);
    }

    const loudMode = this.stage === 'cargo_hold' || this.stage === 'sinking_escape' || this.stealthBroken || this.messBreached;
    const suppressed = this.stage === 'deck_stealth' || (this.stage === 'cqb_interior' && !this.messBreached);
    const allowFollow = !this.inHeliCabin && this.stage !== 'intro' && this.stage !== 'epilogue' && !this.bowSlipDone;
    const onKillBark = (who: string, label: string, isHead: boolean) => {
      if (this.combatBarkCd > 0 || this.scriptedSpeaking || this.talkSubTimer > 0) return;
      this.combatBarkCd = rand(8.5, 13.5);
      const barks = isHead
        ? [`${label}精准击毙，继续推进！`, `干掉一个，视野清空！`]
        : [`目标倒地！${label}已清除！`, `搞定一个，洞三注意侧翼掩护！`];
      const msg = barks[(Math.random() * barks.length) | 0];
      g.hud.subtitle(who, msg);
      this.talkSubTimer = 2.6;
    };

    for (const s of this.squad) {
      s.updateSquadCombat(dt, g, this.squad, loudMode, suppressed, allowFollow, onKillBark);
    }
    for (const hs of this.hostages) {
      const near = hs.pos.distanceToSquared(p.pos) < 34 * 34;
      hs.model.root.visible = near;
      if (near) hs.update(dt, hs.action === 'briefing' || hs.attend > 0 ? p.pos : undefined);
    }

    // Nearest talkable NPC within 4.4m for [E] interactive conversation prompt
    let bestNpc: SquadNpc | null = null;
    if (!this.inHeliCabin && this.stage !== 'intro' && this.stage !== 'epilogue') {
      let bestScore = Infinity;
      const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
      const checkNpc = (n: SquadNpc) => {
        if (!n.model.root.visible) return;
        const dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z, dy = Math.abs(n.pos.y - p.pos.y);
        const dist = Math.hypot(dx, dz);
        if (dist > 4.4 || dy > 2.2) return;
        const dot = dist > 0.05 ? (dx * fwdX + dz * fwdZ) / dist : 1;
        if (dot < -0.15 && dist > 1.8) return;
        const score = dist - dot * 2.2;
        if (score < bestScore) { bestScore = score; bestNpc = n; }
      };
      for (const s of this.squad) checkNpc(s);
      for (const hs of this.hostages) checkNpc(hs);
    }
    this.talkTarget = bestNpc;
    this.talkPrompt = bestNpc
      ? (bestNpc as SquadNpc).role === 'hostage'
        ? `与 ${(bestNpc as SquadNpc).name} 安抚对话`
        : `与 ${(bestNpc as SquadNpc).name} 对话交流`
      : null;

    // 12. Resolve coroutine waiters
    for (let i = this.waits.length - 1; i >= 0; i--) {
      const w = this.waits[i];
      if (w.gen !== this.gen) { this.waits.splice(i, 1); continue; }
      if (w.cond()) {
        this.waits.splice(i, 1);
        w.resolve();
      }
    }
  }

  /** Friendly & nearby civilian hostage positions for clean 3A HUD IFF indicators (enemies are NEVER marked!). */
  getFriendlyMarkers(out: FriendlyMarker[], playerPos: THREE.Vector3) {
    for (const s of this.squad) {
      out.push({ x: s.pos.x, y: s.pos.y + 1.98 * s.model.scale, z: s.pos.z, name: s.name, role: 'ally' });
    }
    for (const h of this.hostages) {
      if (!h.model.root.visible) continue;
      if (h.pos.distanceToSquared(playerPos) > 11.5 * 11.5) continue;
      out.push({ x: h.pos.x, y: h.pos.y + (h.action === 'hostage' ? 1.38 : 1.94), z: h.pos.z, name: h.name, role: 'hostage' });
    }
  }
}
