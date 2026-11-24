/** Keyboard / mouse state with pointer-lock handling. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  buttons = [false, false, false];
  buttonPressed = [false, false, false];
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** When true, mouse/keyboard are consumed without pointer lock (automation / debugging). */
  debugNoLock = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.buttonPressed[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.reset();
      this.onLockChange(this.locked);
    });
  }

  get active() {
    return this.locked || this.debugNoLock;
  }

  requestLock() {
    if (this.debugNoLock) {
      this.onLockChange(true);
      return;
    }
    try {
      const p = (this.el as any).requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          try {
            const p2 = this.el.requestPointerLock() as unknown;
            if (p2 && typeof (p2 as Promise<void>).catch === 'function') (p2 as Promise<void>).catch(() => {});
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string) {
    return this.keys.has(code);
  }
  hit(code: string) {
    return this.pressed.has(code);
  }

  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.buttons.fill(false);
    this.buttonPressed.fill(false);
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }

  endFrame() {
    this.pressed.clear();
    this.buttonPressed.fill(false);
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
