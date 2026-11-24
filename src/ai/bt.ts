/**
 * Minimal behaviour-tree runtime. Nodes are typed over a blackboard `B` and ticked once per frame.
 * Stateful composites remember which child was running, so a tree can yield across frames.
 */
export type Status = 'success' | 'failure' | 'running';

export abstract class BTNode<B> {
  abstract tick(b: B, dt: number): Status;
  reset(): void {}
}

export class Sequence<B> extends BTNode<B> {
  constructor(private kids: BTNode<B>[]) {
    super();
  }
  /** Reactive: conditions are re-evaluated every tick, actions are cheap and restartable. */
  tick(b: B, dt: number): Status {
    for (let i = 0; i < this.kids.length; i++) {
      const s = this.kids[i].tick(b, dt);
      if (s !== 'success') return s;
    }
    return 'success';
  }
  reset() {
    for (const k of this.kids) k.reset();
  }
}

/** Tries children in order until one does not fail (re-evaluated every tick). */
export class Selector<B> extends BTNode<B> {
  constructor(private kids: BTNode<B>[]) {
    super();
  }
  tick(b: B, dt: number): Status {
    for (const k of this.kids) {
      const s = k.tick(b, dt);
      if (s !== 'failure') return s;
    }
    return 'failure';
  }
  reset() {
    for (const k of this.kids) k.reset();
  }
}

/** Runs every child each tick. `all` (default) succeeds only if all succeed. */
export class Parallel<B> extends BTNode<B> {
  constructor(private kids: BTNode<B>[], private policy: 'all' | 'any' = 'all') {
    super();
  }
  tick(b: B, dt: number): Status {
    let anyRunning = false;
    let ok = 0;
    let fail = 0;
    for (const k of this.kids) {
      const s = k.tick(b, dt);
      if (s === 'running') anyRunning = true;
      else if (s === 'success') ok++;
      else fail++;
    }
    if (this.policy === 'any' ? ok > 0 : fail === 0 && !anyRunning) return 'success';
    if (this.policy === 'any' ? fail === this.kids.length : ok === 0 && fail > 0) return 'failure';
    return anyRunning ? 'running' : fail > 0 ? 'failure' : 'success';
  }
  reset() {
    for (const k of this.kids) k.reset();
  }
}

/** Wraps a predicate as a leaf. */
export class Condition<B> extends BTNode<B> {
  constructor(private fn: (b: B) => boolean) {
    super();
  }
  tick(b: B): Status {
    return this.fn(b) ? 'success' : 'failure';
  }
}

/** Wraps a function returning a status; runs every tick (no memory). */
export class Action<B> extends BTNode<B> {
  constructor(private fn: (b: B, dt: number) => Status) {
    super();
  }
  tick(b: B, dt: number): Status {
    return this.fn(b, dt);
  }
}

export class Inverter<B> extends BTNode<B> {
  constructor(private kid: BTNode<B>) {
    super();
  }
  tick(b: B, dt: number): Status {
    const s = this.kid.tick(b, dt);
    return s === 'running' ? 'running' : s === 'success' ? 'failure' : 'success';
  }
  reset() {
    this.kid.reset();
  }
}

/** Succeeds while the child runs, but only re-arms after `sec` since the last success. */
export class Cooldown<B> extends BTNode<B> {
  private t = 0;
  constructor(private sec: number, private kid: BTNode<B>) {
    super();
  }
  tick(b: B, dt: number): Status {
    this.t -= dt;
    if (this.t > 0) return 'failure';
    const s = this.kid.tick(b, dt);
    if (s === 'success') this.t = this.sec;
    return s;
  }
  reset() {
    this.t = 0;
    this.kid.reset();
  }
}

/** Fails while `sec` has not elapsed since the wrapper was last reset; used to hold a behaviour. */
export class Timeout<B> extends BTNode<B> {
  private t = 0;
  constructor(private sec: number, private kid: BTNode<B>) {
    super();
  }
  tick(b: B, dt: number): Status {
    this.t += dt;
    const s = this.kid.tick(b, dt);
    if (this.t >= this.sec && s === 'running') return 'success';
    return s;
  }
  reset() {
    this.t = 0;
    this.kid.reset();
  }
}

export const succeed: Status = 'success';
export const failure: Status = 'failure';
export const running: Status = 'running';
