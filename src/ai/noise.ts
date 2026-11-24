/**
 * World-wide noise events: gunshots and explosions are heard by NPCs even when they cannot see
 * the shooter, which is what makes them turn, shout and take cover instead of standing still.
 */
export interface NoiseEvent {
  x: number;
  z: number;
  /** performance.now() seconds. */
  t: number;
  /** 0..1: how far it carries. */
  loud: number;
}

const events: NoiseEvent[] = [];
const MAX = 32;

export function reportNoise(x: number, z: number, loud = 1) {
  events.push({ x, z, t: performance.now() / 1000, loud });
  if (events.length > MAX) events.shift();
}

/** Most recent noise within `age` seconds and `range` metres of a point, or null. */
export function hearNoise(x: number, z: number, range: number, age: number): NoiseEvent | null {
  const now = performance.now() / 1000;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (now - e.t > age) return null;
    if (Math.hypot(e.x - x, e.z - z) <= range * e.loud) return e;
  }
  return null;
}
