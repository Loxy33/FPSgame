import * as THREE from 'three';
import { Action, Condition, Selector, Sequence, type BTNode } from './bt';
import type { EnemyEnv } from '../entities/enemy';

/** What the behaviour tree asks the body to do this frame. */
export interface EnemyIntent {
  /** Desired world-space movement direction (XZ, normalised or zero). */
  moveX: number;
  moveZ: number;
  speedMul: number;
  /** Aim the weapon at the target. */
  aim: boolean;
  /** Fire when the burst timer allows it. */
  fire: boolean;
  crouch: boolean;
  /** Where to look when not aiming at the player. */
  faceX: number;
  faceZ: number;
  hasFace: boolean;
}

export function makeIntent(): EnemyIntent {
  return { moveX: 0, moveZ: 0, speedMul: 1, aim: false, fire: false, crouch: false, faceX: 0, faceZ: 1, hasFace: false };
}

/** The slice of Enemy the tree needs, so the behaviour reads on its own. */
export interface EnemyAgent {
  readonly kind: string;
  readonly pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  canSee: boolean;
  seenFor: number;
  lostFor: number;
  reaction: number;
  distToTarget: number;
  readonly intent: EnemyIntent;
  /** True while bullets are snapping past. */
  suppressed: boolean;
  /** Seconds since the player was last seen. */
  lastSeenT: number;
  lastSeenX: number;
  lastSeenZ: number;
  inCover: boolean;
  needsReload: boolean;
  /** Move to a point using the nav mesh; returns false when no path exists. */
  travelTo(x: number, z: number, speedMul: number): boolean;
  /** Continue the current advance path toward the player. */
  advance(env: EnemyEnv): void;
  /** Pick a strafing spot and move there; returns false if none found. */
  combatMove(env: EnemyEnv, urgent: boolean): boolean;
  /** Find cover from the player and move to it; returns false if none found. */
  seekCover(env: EnemyEnv): boolean;
  /** Stop moving. */
  hold(): void;
}

export interface EnemyBB {
  a: EnemyAgent;
  env: EnemyEnv;
}

/** Health fraction below this makes a soldier look for cover instead of trading shots. */
const LOW_HP = 0.45;

export function buildEnemyBrain(): BTNode<EnemyBB> {
  const sees = new Condition<EnemyBB>((b) => b.a.canSee);
  const inCover = new Condition<EnemyBB>((b) => b.a.inCover);

  return new Selector<EnemyBB>([
    // --- react to near misses: break off and get behind something ---
    new Sequence<EnemyBB>([
      new Condition<EnemyBB>((b) => b.a.suppressed && !b.a.inCover),
      new Action<EnemyBB>((b) => (b.a.seekCover(b.env) ? 'running' : 'failure')),
    ]),

    // --- fight: only while the player is visible ---
    new Sequence<EnemyBB>([
      sees,
      new Selector<EnemyBB>([
        // badly hurt: fall back rather than keep trading shots
        new Sequence<EnemyBB>([
          new Condition<EnemyBB>((b) => b.a.hp / b.a.maxHp < LOW_HP && !b.a.inCover),
          new Action<EnemyBB>((b) => (b.a.seekCover(b.env) ? 'running' : 'failure')),
        ]),
        // reloading: get behind cover if possible, otherwise at least stop exposing
        new Sequence<EnemyBB>([
          new Condition<EnemyBB>((b) => b.a.needsReload),
          new Selector<EnemyBB>([
            new Sequence<EnemyBB>([
              new Condition<EnemyBB>((b) => b.a.inCover),
              new Action<EnemyBB>((b) => {
                b.a.hold();
                b.a.intent.crouch = true;
                b.a.intent.fire = false;
                b.a.intent.aim = false;
                return 'running';
              }),
            ]),
            new Action<EnemyBB>((b) => (b.a.seekCover(b.env) ? 'running' : 'failure')),
            new Action<EnemyBB>((b) => {
              b.a.hold();
              b.a.intent.fire = false;
              b.a.intent.aim = false;
              return 'running';
            }),
          ]),
        ]),
        // holding cover: peek and shoot once the burst timer is ready
        new Sequence<EnemyBB>([
          inCover,
          new Action<EnemyBB>((b) => {
            b.a.hold();
            b.a.intent.aim = true;
            b.a.intent.fire = true;
            b.a.intent.crouch = b.a.suppressed;
            return 'running';
          }),
        ]),
        // open ground: fire and strafe between bursts
        new Action<EnemyBB>((b) => {
          b.a.intent.aim = true;
          b.a.intent.fire = true;
          if (!b.a.combatMove(b.env, false)) b.a.hold();
          return 'running';
        }),
      ]),
    ]),

    // --- lost contact / heard gunshot: actively investigate & sweep toward last known / heard position ---
    new Sequence<EnemyBB>([
      new Condition<EnemyBB>((b) => b.a.lastSeenT < 10.5),
      new Action<EnemyBB>((b) => {
        const distToHeard = Math.hypot(b.a.pos.x - b.a.lastSeenX, b.a.pos.z - b.a.lastSeenZ);
        b.a.intent.aim = distToHeard < 20;
        b.a.intent.fire = false;
        b.a.intent.speedMul = 1;
        b.a.intent.hasFace = true;
        b.a.intent.faceX = b.a.lastSeenX;
        b.a.intent.faceZ = b.a.lastSeenZ;
        if (distToHeard < 2.6) {
          b.a.hold();
          return 'running';
        }
        b.a.travelTo(b.a.lastSeenX, b.a.lastSeenZ, 1);
        return 'running';
      }),
    ]),

    // --- idle: patrol toward the objective at a walk ---
    new Action<EnemyBB>((b) => {
      b.a.intent.aim = false;
      b.a.intent.fire = false;
      b.a.intent.speedMul = 0.45;
      b.a.advance(b.env);
      return 'running';
    }),
  ]);
}
