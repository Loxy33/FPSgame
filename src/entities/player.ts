import * as THREE from 'three';
import { audio } from '../core/audio';
import { settings } from '../core/settings';
import { DEG, clamp, damp, lerp, rand, Spring } from '../core/utils';
import type { Game } from '../game';
import type { Surface } from '../world/physics';
import { makeHit } from '../world/physics';
import type { VMState } from './viewmodel';
import { WEAPONS, WEAPON_ORDER, type SlotName, type WeaponDef, type WeaponId } from './weapons';
import { ATTACHMENTS, SLOT_LABEL, applyAttachments, optionsFor, saveLoadout } from './attachments';
import { defaultHexMods, type HexMods } from '../hextech';

const RADIUS = 0.35;
const H_STAND = 1.8, H_CROUCH = 1.2;
const EYE_STAND = 1.62, EYE_CROUCH = 1.05;
const STEP = 0.45;
const GRAVITY = 15;
const VM_FOV = 55;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _hit = makeHit();

function stepSound(s: Surface) {
  return s === 'sand' ? 'step_dirt' : s === 'metal' ? 'step_metal' : 'step_conc';
}

function landSound(s: Surface) {
  return s === 'sand' ? 'land_dirt' : s === 'metal' ? 'land_metal' : 'land_conc';
}

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  eye = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 100;
  hexMods: HexMods = defaultHexMods();
  private cheatDeathInvulnT = 0;
  alive = true;
  onGround = true;
  crouch = 0;
  ads = 0;
  sprint = 0;
  grenades = 3;
  get maxHealth() {
    return 100 + this.hexMods.maxHpBonus;
  }
  get maxGrenades() {
    return 4 + this.hexMods.nadeBonus;
  }
  magCap(id: WeaponId = this.weapon) {
    return Math.max(1, Math.round(this.defFor(id).mag * this.hexMods.magMult));
  }

  weapon: WeaponId = 'm4a1';
  private lastWeapon: WeaponId = 'm1911';
  weaponOrder: WeaponId[] = WEAPON_ORDER;
  ammo: Record<WeaponId, { mag: number; reserve: number }> = {
    m4a1: { mag: 0, reserve: 0 }, ak47: { mag: 0, reserve: 0 }, scarl: { mag: 0, reserve: 0 },
    mp5a5: { mag: 0, reserve: 0 }, awm: { mag: 0, reserve: 0 }, m1911: { mag: 0, reserve: 0 },
    qbz192: { mag: 0, reserve: 0 }, qsz193: { mag: 0, reserve: 0 },
  };

  // weapon handling timers
  private fireT = 0;
  private reloadT = -1;
  private reloadSndI = 0;
  private reloadDone = false;
  private boltT = -1;
  private boltPending = false;
  private meleeT = -1;
  private meleeHit = false;
  private throwT = -1;
  private thrown = false;
  private equip = 1;
  private pending: WeaponId | null = null;
  private semiLatch = false;
  private sprintLock = 0;
  bloom = 0;
  /** Current total spread half-angle in degrees (for the crosshair). */
  spread = 0;

  // camera feel
  private recP = 0;
  private recY = 0;
  private recTP = 0;
  private recTY = 0;
  private sinceShot = 9;
  private bobPhase = 0;
  private bobAmp = 0;
  private stepAcc = 0;
  private eyeY = EYE_STAND;
  private camY = 0;
  private shake = 0;
  private punchP = new Spring(120, 12);
  private punchR = new Spring(120, 12);
  private landDip = new Spring(90, 11);
  private crouchToggle = false;
  private sunT = 0;
  private sunlit = 1;
  private sinceDamage = 99;
  private deadT = 0;
  private fov = 78;
  private airT = 0;
  private fallStartY = 0;
  private smokeT = 0;

  // mantle / vault (COD-style ledge climb)
  /** -1 idle, otherwise 0..1 progress through the climb. */
  private mantleT = -1;
  private mantleDur = 0.5;
  private mantleFrom = new THREE.Vector3();
  private mantleTo = new THREE.Vector3();
  private mantleCool = 0;
  private mantleKind: 'mantle' | 'vault' = 'mantle';
  /** 0..1 easing of the weapon dip while climbing. */
  private mantleVis = 0;
  /** Dev diagnostics for the last mantle probe. */
  readonly mantleLog: string[] = [];
  /** External ship/environment camera roll (radians) for storm swell & sinking hull list. */
  shipRoll = 0;
  /** Lateral gravity pull (m/s^2 along +X) when the hull tilts during sinking escape. */
  shipSlideX = 0;
  /** Tactical gear state for dark storm/CQB campaign missions. */
  nvgOn = false;
  flashlightOn = false;
  /** Lock player movement during scripted heli insertion / extraction cutscenes. */
  scriptedLock = false;
  /** First-person C4 arming & planting animation (-1 idle, else 0..1). */
  plantC4T = -1;
  private plantC4Dur = 2.15;
  private plantC4BeepIdx = -1;
  private plantC4ArmedPlayed = false;
  private plantC4Detached = false;
  private plantC4OnPlanted: (() => void) | null = null;
  private vmState: VMState = { dt: 0, ads: 0, sprint: 0, bobPhase: 0, bobAmp: 0, strafe: 0, vy: 0, mouseDX: 0, mouseDY: 0, reload: -1, bolt: -1, melee: -1, throwing: -1, equip: 1, empty: false, crouch: 0, mantle: 0, mantleT: -1, plantC4T: -1, canted: 0 };

  // stats
  shots = 0;
  hits = 0;

  constructor(private g: Game) {}

  /** Resolved weapon definition (base stats + fitted attachments), cached per weapon. */
  private defs: Partial<Record<WeaponId, WeaponDef>> = {};
  /** Triggers the first-person dual-hand C4 keypad arming & forward planting animation. */
  startPlantC4(dur = 2.15, onPlanted?: () => void) {
    this.plantC4T = 0;
    this.plantC4Dur = Math.max(1.2, dur);
    this.plantC4BeepIdx = -1;
    this.plantC4ArmedPlayed = false;
    this.plantC4Detached = false;
    this.plantC4OnPlanted = onPlanted ?? null;
    this.reloadT = -1;
    this.boltT = -1;
    this.meleeT = -1;
    this.throwT = -1;
    this.ads = 0;
    audio.play('cloth', { vol: 0.45, rate: 1.05 });
  }

  private defFor(id: WeaponId): WeaponDef {
    let d = this.defs[id];
    if (!d) d = this.defs[id] = applyAttachments(WEAPONS[id]);
    return d;
  }
  get def(): WeaponDef {
    return this.defFor(this.weapon);
  }

  /** Which slot the modify key edits. */
  private attachSlotI = 0;

  /** Re-resolves weapon stats and attachment-driven ammo caps after a gunsmith change. */
  refreshWeapons() {
    this.defs = {};
    for (const id of WEAPON_ORDER) {
      const d = this.defFor(id);
      const a = this.ammo[id];
      a.mag = Math.min(a.mag, d.mag);
      a.reserve = Math.min(a.reserve, d.reserve);
    }
  }

  /** Cycles the slot being modified and reports it. */
  cycleAttachSlot() {
    const d = WEAPONS[this.weapon];
    if (!d.slots.length) return;
    this.attachSlotI = (this.attachSlotI + 1) % d.slots.length;
    const slot = d.slots[this.attachSlotI];
    const cur = d.fitted[slot] ?? optionsFor(d, slot)[0];
    this.g.hud.hint(`改装槽位：${SLOT_LABEL[slot]}（当前 ${ATTACHMENTS[cur]?.label ?? cur}）`, 2.2);
  }

  /** Cycles the attachment in the active slot (visual + stats). */
  cycleAttachment() {
    const d = WEAPONS[this.weapon];
    if (!d.slots.length) return;
    const slot = d.slots[this.attachSlotI] as SlotName;
    const opts = optionsFor(d, slot);
    const cur = d.fitted[slot] ?? opts[0];
    const i = Math.max(0, opts.indexOf(cur));
    const next = opts[(i + 1) % opts.length];
    d.fitted[slot] = next;
    saveLoadout(WEAPONS, WEAPON_ORDER);
    this.defs[this.weapon] = undefined;
    this.g.vm.refit(this.weapon);
    const nd = this.defFor(this.weapon);
    const a = this.ammo[this.weapon];
    a.mag = Math.min(a.mag, nd.mag);
    this.g.hud.hint(`${d.name} · ${SLOT_LABEL[slot]}：${ATTACHMENTS[next].label}`, 2.2);
    audio.play('cloth', { vol: 0.35, rateVar: 0.1 });
  }
  get reloading() {
    return this.reloadT >= 0;
  }
  get scoped() {
    return this.def.scope && this.ads > 0.82 && this.reloadT < 0;
  }
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  reset(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.hexMods = defaultHexMods();
    this.cheatDeathInvulnT = 0;
    this.alive = true;
    this.onGround = true;
    this.crouch = 0;
    this.crouchToggle = false;
    this.ads = 0;
    this.sprint = 0;
    this.grenades = 3;
    for (const id of WEAPON_ORDER) {
      this.ammo[id].mag = this.defFor(id).mag;
      this.ammo[id].reserve = WEAPONS[id].reserve;
    }
    this.weaponOrder = WEAPON_ORDER;
    this.weapon = 'm4a1';
    this.lastWeapon = 'm1911';
    this.g.vm.setWeapon('m4a1');
    this.g.hud.setWeaponSlots(WEAPON_ORDER);
    this.fireT = 0;
    this.reloadT = this.boltT = this.meleeT = this.throwT = -1;
    this.boltPending = false;
    this.pending = null;
    this.equip = 0;
    this.bloom = 0;
    this.recP = this.recY = this.recTP = this.recTY = 0;
    this.shake = 0;
    this.deadT = 0;
    this.sinceDamage = 99;
    this.eyeY = EYE_STAND;
    this.camY = EYE_STAND;
    this.shots = this.hits = 0;
    this.fov = settings.fov;
    this.mantleT = -1;
    this.mantleCool = 0;
    this.mantleVis = 0;
    this.shipRoll = 0;
    this.shipSlideX = 0;
    this.nvgOn = false;
    this.flashlightOn = false;
    this.scriptedLock = false;
    this.plantC4T = -1;
    this.plantC4OnPlanted = null;
    this.g.r.setFlashlight(false);
    audio.play('equip', { vol: 0.5 });
  }

  /** Restricts or switches active weapon slots (e.g. authentic PLA QBZ-192 + QSZ-193 for Campaign). */
  setWeaponOrder(order: WeaponId[], equipFirst = true) {
    this.weaponOrder = order;
    this.g.hud.setWeaponSlots(order);
    if (equipFirst && order.length > 0) {
      this.weapon = order[0];
      this.lastWeapon = order[1] ?? order[0];
      this.pending = null;
      this.equip = 1;
      this.g.vm.setWeapon(this.weapon);
    }
  }

  /** Instant weapon switch (for scripted pickups). */
  equipImmediate(id: WeaponId) {
    if (!this.weaponOrder.includes(id)) {
      this.weaponOrder = [...this.weaponOrder, id];
      this.g.hud.setWeaponSlots(this.weaponOrder);
    }
    this.lastWeapon = this.weapon;
    this.weapon = id;
    this.pending = null;
    this.equip = 1;
    this.g.vm.setWeapon(id);
  }

  addShake(a: number) {
    this.shake = Math.min(1.4, this.shake + a);
  }

  refill() {
    for (const id of WEAPON_ORDER) this.ammo[id].reserve = WEAPONS[id].reserve;
    this.grenades = this.maxGrenades;
  }

  /** Ammo box: tops up the reserve of every weapon by roughly one magazine. Returns false if nothing was needed. */
  giveAmmo() {
    let any = false;
    for (const id of WEAPON_ORDER) {
      const d = this.defFor(id);
      const a = this.ammo[id];
      if (a.reserve < d.reserve) {
        a.reserve = Math.min(d.reserve, a.reserve + (id === this.weapon ? d.mag * 2 : d.mag));
        any = true;
      }
    }
    return any;
  }

  damage(amount: number, from: THREE.Vector3 | null) {
    if (!this.alive || this.g.god || this.g.mode === 'training' || this.cheatDeathInvulnT > 0) return;
    const eff = amount * (1 - clamp(this.hexMods.dmgReduce, 0, 0.72));
    this.health -= eff;
    this.sinceDamage = 0;
    const u = this.g.r.final.uniforms;
    u.uDamage.value = Math.min(1, u.uDamage.value + 0.3 + eff / 60);
    this.punchP.impulse(rand(0.8, 1.6) * Math.min(2, eff / 10));
    this.punchR.impulse(rand(-2, 2) * Math.min(2, eff / 10));
    audio.play('hurt', { vol: 0.6, rateVar: 0.12 });
    if (from) {
      const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
      const a = Math.atan2(dx, -dz) + this.yaw;
      this.g.hud.damageFrom(a);
    }
    if (this.health <= 0) {
      // Hextech Prismatic "Undying Berserker" Cheat-Death!
      if (this.hexMods.cheatDeathCharges > 0) {
        this.hexMods.cheatDeathCharges--;
        this.health = this.maxHealth;
        this.cheatDeathInvulnT = 3.0;
        u.uFlash.value = 0.45;
        audio.play('waveclear', { vol: 0.9 });
        this.g.hud.announce('不屈狂战士触发！', '免死护盾生效 · 生命值回满 · 3 秒无敌');
        return;
      }
      this.health = 0;
      this.alive = false;
      this.deadT = 0;
      this.g.onPlayerDeath();
    }
  }

  private startSwitch(id: WeaponId) {
    if (id === this.weapon && this.pending === null) return;
    if (this.pending === id) return;
    if (this.throwT >= 0 || this.meleeT >= 0) return;
    this.pending = id;
    this.reloadT = -1;
    this.boltT = -1;
  }

  private startReload() {
    const a = this.ammo[this.weapon];
    if (this.reloadT >= 0 || a.reserve <= 0 || a.mag >= this.magCap() || this.pending || this.throwT >= 0 || this.meleeT >= 0) return;
    this.reloadT = 0;
    this.reloadSndI = 0;
    this.reloadDone = false;
    this.boltT = -1;
  }

  private fire() {
    const g = this.g;
    const d = this.def;
    const a = this.ammo[this.weapon];
    a.mag--;
    this.shots++;
    const berserk = this.hexMods.berserkMaxBonus > 0 ? 1 + (1 - clamp(this.health / this.maxHealth, 0, 1)) * this.hexMods.berserkMaxBonus * 0.5 : 1;
    this.fireT = 60 / (d.rpm * this.hexMods.fireRateMult * berserk);
    this.sinceShot = 0;
    const cam = g.r.camera;

    // direction with spread
    cam.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, cam.up).normalize();
    _up.crossVectors(_right, _fwd);
    const sp = this.spread * DEG;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.tan(sp) * Math.sqrt(Math.random());
    _dir.copy(_fwd).addScaledVector(_right, Math.cos(ang) * rad).addScaledVector(_up, Math.sin(ang) * rad).normalize();

    // muzzle point in world space (matches the viewmodel as seen on screen)
    const scoped = this.scoped;
    if (scoped) _m.copy(cam.position).addScaledVector(_fwd, 1.2).addScaledVector(_up, -0.12);
    else {
      g.r.vmRoot.position.copy(cam.position);
      g.r.vmRoot.quaternion.copy(cam.quaternion);
      g.r.vmRoot.updateMatrixWorld(true);
      g.vm.worldPoint(g.vm.current.muzzle, cam, VM_FOV, _m);
    }
    g.playerBullet(cam.position, _dir, d, _m);

    // feedback
    g.vm.onFire(this.ads);
    if (!scoped) {
      g.fx.muzzle(_m, _fwd, 0.5 * d.flashScale * (1 - this.ads * 0.4));
      // brass
      g.vm.worldPoint(g.vm.current.eject, cam, VM_FOV, _v);
      if (d.mode !== 'bolt') {
        const ev = _dir.copy(_right).multiplyScalar(rand(1.6, 2.6)).addScaledVector(_up, rand(1.2, 2.2)).addScaledVector(_fwd, rand(-0.5, 0.4)).add(this.vel);
        g.fx.casing(_v, ev);
        audio.play('shell', { vol: 0.16, rateVar: 0.25, delay: rand(0.35, 0.55), pan: 0.4 });
      }
    }
    g.r.flash(_m, 0xffb060, 30 * d.flashScale, 0.06, 16);
    audio.play(d.sound, { vol: d.soundVol, rateVar: 0.035, reverb: 0.6 });
    // Deep tactile sub-bass transient punch on every weapon discharge
    const subFreq = this.weapon === 'm1911' ? 62 : this.weapon === 'awm' ? 42 : this.weapon === 'ak47' ? 48 : 54;
    audio.playSubBass(subFreq, 0.13, 0.85 * 0.7);
    const k = (1 - this.ads * 0.3) * (1 - this.crouch * 0.15) * this.hexMods.recoilMult;
    this.recTP += d.recoilPitch * DEG * k * (1 + Math.min(1, this.bloom) * 0.25);
    this.recTY += rand(-1, 1) * d.recoilYaw * DEG * k;
    this.bloom = Math.min(d.bloomMax, this.bloom + d.bloomPerShot);
    this.addShake(d.shake * 0.16);
    this.smokeT = 0.35;
    if (d.mode === 'bolt' && a.mag > 0) this.boltPending = true;
    if (a.mag === 0 && a.reserve === 0) g.hud.hint('弹药耗尽 — 切换武器或前往补给点', 3);
  }

  update(dt: number) {
    const g = this.g;
    const inp = g.input;
    const cam = g.r.camera;
    if (!this.alive) {
      this.updateDead(dt);
      return;
    }
    const d = this.def;
    const a = this.ammo[this.weapon];

    // ---------- look ----------
    const sens = 0.0021 * settings.sensitivity * (this.fov / settings.fov);
    this.yaw -= inp.mouseDX * sens;
    this.pitch = clamp(this.pitch - inp.mouseDY * sens, -1.5, 1.5);

    // ---------- stance ----------
    if (inp.hit('KeyC')) this.crouchToggle = !this.crouchToggle;
    let wantCrouch = this.crouchToggle || inp.down('ControlLeft');
    const height = lerp(H_STAND, H_CROUCH, this.crouch);
    if (!wantCrouch && this.crouch > 0.05) {
      // only stand up if there is headroom
      const ceil = g.world.ceilingHeight(this.pos.x, this.pos.z, this.pos.y + H_CROUCH - 0.1, RADIUS * 0.9);
      if (ceil - this.pos.y < H_STAND + 0.05) wantCrouch = true;
    }
    this.crouch = clamp(this.crouch + (wantCrouch ? 1 : -1) * dt * 6.5, 0, 1);

    // ---------- movement input ----------
    let mx = 0, mz = 0;
    if (!this.scriptedLock) {
      if (inp.down('KeyW')) mz += 1;
      if (inp.down('KeyS')) mz -= 1;
      if (inp.down('KeyD')) mx += 1;
      if (inp.down('KeyA')) mx -= 1;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 0) {
      mx /= ml;
      mz /= ml;
    }

    // ---------- mantle / vault ----------
    this.mantleCool = Math.max(0, this.mantleCool - dt);
    if (!this.scriptedLock && this.mantleT < 0 && this.mantleCool <= 0) {
      const wantsClimb = inp.hit('Space') || (!this.onGround && mz > 0.2 && this.speed > 0.9);
      if (wantsClimb) this.tryStartMantle(height);
    }
    const mantling = this.mantleT >= 0 || this.scriptedLock;
    if (this.mantleT >= 0) {
      this.mantleT = Math.min(1, this.mantleT + dt / this.mantleDur);
      const k = this.mantleT;
      const up = clamp(k / 0.6, 0, 1);
      const upE = up * up * (3 - 2 * up);
      const fw = clamp((k - 0.26) / 0.74, 0, 1);
      const fwE = fw * fw * (3 - 2 * fw);
      this.pos.y = lerp(this.mantleFrom.y, this.mantleTo.y, upE);
      this.pos.x = lerp(this.mantleFrom.x, this.mantleTo.x, fwE);
      this.pos.z = lerp(this.mantleFrom.z, this.mantleTo.z, fwE);
      this.vel.set(0, 0, 0);
      this.mantleVis = Math.sin(Math.PI * clamp(k, 0, 1));
      if (k >= 1) {
        this.pos.copy(this.mantleTo);
        this.vel.set(0, 0, 0);
        this.onGround = true;
        this.airT = 0;
        this.mantleT = -1;
        this.mantleCool = 0.22;
        audio.play(this.mantleKind === 'vault' ? 'step_conc' : 'cloth', { vol: 0.42, rateVar: 0.06 });
      }
    } else {
      this.mantleVis = Math.max(0, this.mantleVis - dt * 5);
    }

    const wantADS = inp.buttons[2] && this.reloadT < 0 && this.equip > 0.6 && !this.pending && this.meleeT < 0 && this.throwT < 0;
    this.sprintLock = Math.max(0, this.sprintLock - dt);
    const sprinting = inp.down('ShiftLeft') && mz > 0.5 && this.crouch < 0.3 && !wantADS && this.onGround && this.sprintLock <= 0;
    if (sprinting && this.crouchToggle) this.crouchToggle = false;
    this.sprint = clamp(this.sprint + (sprinting ? 1 : -1) * dt * 5.5, 0, 1);
    this.ads = clamp(this.ads + (wantADS ? 1 : -1) * dt / d.adsTime, 0, 1);

    let maxSpeed = (sprinting ? 6.7 : 4.3) * d.moveMult * this.hexMods.moveMult;
    maxSpeed = lerp(maxSpeed, 2.2, this.crouch);
    maxSpeed *= 1 - this.ads * 0.42;
    if (mz < 0) maxSpeed *= 0.82;
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const wx = (-sn * mz + cs * mx) * maxSpeed;
    const wz = (-cs * mz - sn * mx) * maxSpeed;
    const accel = this.onGround ? (ml > 0 ? 11 : 13) : 2.2;
    const hs = this.speed;
    if (!mantling) {
      this.vel.x = damp(this.vel.x, wx, accel, dt);
      this.vel.z = damp(this.vel.z, wz, accel, dt);
    }

    if (!mantling) {
      // jump (high enough to reach sandbag / hesco tops; ledges above that need a mantle)
      if (inp.hit('Space') && this.onGround) {
        const ceil = g.world.ceilingHeight(this.pos.x, this.pos.z, this.pos.y + height - 0.1, RADIUS * 0.9);
        if (ceil - this.pos.y > height + 0.25) {
          this.vel.y = 5.6;
          this.onGround = false;
          this.crouchToggle = false;
          this.fallStartY = this.pos.y;
          const pushSurf = g.world.lastGroundSurface(this.pos.x, this.pos.z);
          audio.play('jump', { vol: 0.65, rateVar: 0.07 });
          audio.play(stepSound(pushSurf), { vol: 0.22, rate: 1.24, rateVar: 0.08 });
        }
      }

      // integrate horizontal, with sub-steps so fast movement can't tunnel through thin walls
      const dist = Math.hypot(this.vel.x, this.vel.z) * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.15));
      for (let i = 0; i < steps; i++) {
        this.pos.x += (this.vel.x * dt) / steps;
        this.pos.z += (this.vel.z * dt) / steps;
        g.world.resolveCylinder(this.pos, RADIUS, height, this.onGround ? STEP : 0.24);
      }
      const b = g.bound;
      this.pos.x = clamp(this.pos.x, -b, b);
      this.pos.z = clamp(this.pos.z, -b, b);

      // vertical
      const ground = g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y, RADIUS * 0.75, this.onGround ? STEP : 0.28);
      const surf = g.world.lastGroundSurface(this.pos.x, this.pos.z);
      if (this.onGround) {
        if (ground >= this.pos.y - STEP - 0.02) {
          this.pos.y = ground;
          this.vel.y = 0;
        } else {
          this.onGround = false;
          this.fallStartY = this.pos.y;
          this.vel.y = 0;
        }
      }
      if (!this.onGround) {
        this.airT += dt;
        this.vel.y -= GRAVITY * dt;
        this.pos.y += this.vel.y * dt;
        if (this.vel.y > 0) {
          const ceil = g.world.ceilingHeight(this.pos.x, this.pos.z, this.pos.y + height - 0.3, RADIUS * 0.8);
          if (this.pos.y + height > ceil - 0.02) {
            this.pos.y = ceil - height - 0.02;
            this.vel.y = 0;
          }
        }
        if (this.vel.y <= 0 && this.pos.y <= ground) {
          const impact = -this.vel.y;
          this.pos.y = ground;
          this.vel.y = 0;
          this.onGround = true;
          this.airT = 0;
          if (impact > 2.2) {
            const landVol = clamp(impact / 8.2, 0.34, 1.0);
            const landRate = clamp(1.06 - impact * 0.02, 0.84, 1.04);
            audio.play(landSound(surf), { vol: landVol, rate: landRate, rateVar: 0.05 });
            if (impact > 4.2) {
              audio.playSubBass(surf === 'metal' ? 62 : 50, 0.12, clamp((impact - 3.5) / 8, 0.25, 0.85));
            }
            g.vm.onLand(impact);
            this.landDip.impulse(-clamp(impact * 0.22, 0, 3.2));
          }
          if (impact > 12.5) this.damage((impact - 12.5) * 9, null);
        }
      } else this.airT = 0;

      // ---------- footsteps / bob ----------
      const moveFrac = clamp(hs / 4.3, 0, 1.6);
      this.bobAmp = damp(this.bobAmp, this.onGround ? Math.min(1, moveFrac) : 0, 9, dt);
      if (this.onGround && hs > 0.6) {
        this.bobPhase += dt * (4.6 + hs * 1.25);
        this.stepAcc += hs * dt;
        const stride = sprinting ? 2.5 : this.crouch > 0.5 ? 1.5 : 2.0;
        if (this.stepAcc > stride) {
          this.stepAcc = 0;
          audio.play(stepSound(surf), { vol: (sprinting ? 0.5 : 0.34) * (1 - this.crouch * 0.6), rateVar: 0.1, pan: Math.sin(this.bobPhase) > 0 ? 0.15 : -0.15 });
          if (sprinting && Math.random() < 0.5) audio.play('cloth', { vol: 0.14, rateVar: 0.2 });
        }
      }
    } else {
      this.bobAmp = damp(this.bobAmp, 0, 9, dt);
    }

    // ---------- weapon selection ----------
    const ord = this.weaponOrder;
    for (let i = 0; i < ord.length && i < 9; i++) {
      if (inp.hit(`Digit${i + 1}`)) this.startSwitch(ord[i]);
    }
    if (inp.hit('KeyQ') && ord.includes(this.lastWeapon)) this.startSwitch(this.lastWeapon);
    if (inp.hit('KeyB')) this.cycleAttachment();
    if (inp.hit('KeyN')) {
      if (g.mode === 'highseas') {
        this.nvgOn = !this.nvgOn;
        audio.play('equip', { vol: 0.55, rate: this.nvgOn ? 1.25 : 0.85 });
        g.hud.hint(this.nvgOn ? '四目夜视仪：开启 · 右键倾侧红外激光瞄准' : '四目夜视仪：关闭', 2.0);
        g.onToggleNvg?.(this.nvgOn);
      } else this.cycleAttachSlot();
    }
    if (inp.hit('KeyT') && (g.mode === 'highseas' || g.mode === 'oilfield')) {
      this.flashlightOn = !this.flashlightOn;
      g.r.setFlashlight(this.flashlightOn);
      audio.play('ui_click', { vol: 0.65 });
      g.hud.hint(this.flashlightOn ? '枪口战术灯：开启' : '枪口战术灯：关闭', 1.5);
    }
    if (inp.wheel !== 0 && !this.pending && ord.length > 1) {
      const i = Math.max(0, ord.indexOf(this.weapon));
      this.startSwitch(ord[(i + (inp.wheel > 0 ? 1 : ord.length - 1)) % ord.length]);
    }
    if (this.pending) {
      this.equip -= dt / 0.2;
      if (this.equip <= 0) {
        this.equip = 0;
        this.lastWeapon = this.weapon;
        this.weapon = this.pending;
        this.pending = null;
        g.vm.setWeapon(this.weapon);
        this.bloom = 0;
        this.boltPending = false;
        this.fireT = 0;
        audio.play('equip', { vol: 0.5, rateVar: 0.06 });
      }
    } else if (this.equip < 1) this.equip = Math.min(1, this.equip + dt / (WEAPONS[this.weapon].family === 'pistol' ? 0.24 : 0.36));

    // ---------- actions ----------
    if (this.plantC4T >= 0) {
      this.plantC4T += dt / this.plantC4Dur;
      // 6 crisp ascending keypad press beeps during 0.20..0.68
      if (this.plantC4T >= 0.20 && this.plantC4T < 0.70) {
        const idx = Math.min(5, Math.floor(((this.plantC4T - 0.20) / 0.48) * 6));
        if (idx > this.plantC4BeepIdx) {
          this.plantC4BeepIdx = idx;
          audio.play('ui_click', { vol: 0.52, rate: 1.08 + idx * 0.09, rateVar: 0.01 });
        }
      }
      // Armed confirmation chime + magnetic clamp thud as both hands press C4 onto target!
      if (!this.plantC4ArmedPlayed && this.plantC4T >= 0.72) {
        this.plantC4ArmedPlayed = true;
        audio.play('radio', { vol: 0.65, rate: 1.58, rateVar: 0.01 });
        audio.play('magin', { vol: 0.78, rate: 0.85 });
        this.punchP.impulse(0.65);
      }
      // Handoff to physical 3D world-space C4 charge right when hands release at t=0.85
      if (!this.plantC4Detached && this.plantC4T >= 0.85) {
        this.plantC4Detached = true;
        const cb = this.plantC4OnPlanted;
        this.plantC4OnPlanted = null;
        cb?.();
      }
      if (this.plantC4T >= 1) {
        this.plantC4T = -1;
        audio.play('equip', { vol: 0.42, rate: 1.06 });
      }
    }
    const busy = this.pending !== null || this.equip < 0.85 || this.meleeT >= 0 || this.throwT >= 0 || this.plantC4T >= 0;
    this.fireT = Math.max(0, this.fireT - dt);
    this.sinceShot += dt;
    if (inp.hit('KeyR')) this.startReload();
    if (inp.hit('KeyF')) g.interact();
    if (inp.hit('KeyE')) g.talkToNpc();

    // melee
    if (inp.hit('KeyV') && !busy && this.reloadT < 0) {
      this.meleeT = 0;
      this.meleeHit = false;
      this.sprintLock = 0.4;
      audio.play('melee', { vol: 0.6, rateVar: 0.08 });
    }
    if (this.meleeT >= 0) {
      this.meleeT += dt / 0.5;
      if (!this.meleeHit && this.meleeT > 0.24) {
        this.meleeHit = true;
        cam.getWorldDirection(_fwd);
        if (g.playerMelee(cam.position, _fwd)) {
          audio.play('meleehit', { vol: 0.8 });
          this.addShake(0.3);
        }
      }
      if (this.meleeT >= 1) this.meleeT = -1;
    }

    // grenade
    if (inp.hit('KeyG') && !busy && this.reloadT < 0) {
      if (this.grenades > 0) {
        this.throwT = 0;
        this.thrown = false;
        this.sprintLock = 0.5;
        audio.play('pin', { vol: 0.6 });
      } else g.hud.hint('没有手雷了', 1.5);
    }
    if (this.throwT >= 0) {
      this.throwT += dt / 0.8;
      if (!this.thrown && this.throwT > 0.42) {
        this.thrown = true;
        this.grenades--;
        cam.getWorldDirection(_fwd);
        _right.crossVectors(_fwd, cam.up).normalize();
        _v.copy(cam.position).addScaledVector(_fwd, 0.35).addScaledVector(_right, -0.18);
        _v.y -= 0.1;
        _dir.copy(_fwd).multiplyScalar(17);
        _dir.y += 3.6;
        _dir.x += this.vel.x * 0.6;
        _dir.z += this.vel.z * 0.6;
        g.throwGrenade(_v, _dir);
        audio.play('throw', { vol: 0.6 });
      }
      if (this.throwT >= 1) this.throwT = -1;
    }

    // reload
    if (this.reloadT >= 0) {
      this.reloadT += (dt / d.reloadTime) * this.hexMods.reloadMult;
      while (this.reloadSndI < d.reloadSounds.length && this.reloadT >= d.reloadSounds[this.reloadSndI][0]) {
        audio.play(d.reloadSounds[this.reloadSndI][1], { vol: 0.6, rateVar: 0.04 });
        this.reloadSndI++;
      }
      if (!this.reloadDone && this.reloadT >= d.reloadCommit) {
        this.reloadDone = true;
        const need = this.magCap() - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
        this.boltPending = false;
      }
      if (this.reloadT >= 1) this.reloadT = -1;
    }

    // bolt cycle
    if (this.boltPending && this.boltT < 0 && this.fireT <= 60 / d.rpm - 0.22 && this.reloadT < 0 && !busy) {
      this.boltPending = false;
      this.boltT = 0;
      audio.play('boltaction', { vol: 0.65 });
    }
    if (this.boltT >= 0) {
      const before = this.boltT;
      this.boltT += dt / d.boltTime;
      if (before < 0.5 && this.boltT >= 0.5) {
        g.r.vmRoot.updateMatrixWorld(true);
        g.vm.worldPoint(g.vm.current.eject, cam, VM_FOV, _v);
        cam.getWorldDirection(_fwd);
        _right.crossVectors(_fwd, cam.up).normalize();
        g.fx.casing(_v, _dir.copy(_right).multiplyScalar(1.8).setY(1.6).add(this.vel));
        audio.play('shell', { vol: 0.2, delay: 0.45, rate: 0.85 });
      }
      if (this.boltT >= 1) this.boltT = -1;
    }

    // spread
    const moveSp = clamp(hs / 4.3, 0, 1.4);
    this.bloom = Math.max(0, this.bloom - dt * (this.sinceShot > 0.12 ? 5.5 : 1.2));
    this.spread = lerp(d.hipSpread, d.adsSpread, this.ads) + d.moveSpread * moveSp * (1 - this.ads * 0.75) + this.bloom * (1 - this.ads * 0.8) + (this.onGround ? 0 : 3.2) - this.crouch * 0.3 * (1 - this.ads);
    this.spread = Math.max(0, this.spread * this.hexMods.spreadMult);

    // trigger
    const trigger = !this.scriptedLock && inp.buttons[0];
    if (!trigger) this.semiLatch = false;
    const canFire = !busy && this.reloadT < 0 && this.boltT < 0 && !this.boltPending && this.fireT <= 0 && this.sprint < 0.35;
    if (trigger && this.sprint >= 0.35) this.sprintLock = 0.25;
    if (trigger && canFire) {
      if (a.mag > 0) {
        if (d.mode === 'auto' || !this.semiLatch) {
          this.semiLatch = true;
          this.fire();
        }
      } else if (!this.semiLatch) {
        this.semiLatch = true;
        if (a.reserve > 0) this.startReload();
        else audio.play('dry', { vol: 0.5 });
      }
    }
    // auto reload on empty
    if (a.mag === 0 && a.reserve > 0 && this.reloadT < 0 && this.sinceShot > 0.3 && !busy && this.boltT < 0) this.startReload();

    // wisp of smoke after sustained fire
    if (this.smokeT > 0 && this.sinceShot > 0.1 && !this.scoped) {
      this.smokeT -= dt;
      if (Math.random() < dt * 30) {
        g.r.vmRoot.updateMatrixWorld(true);
        g.vm.worldPoint(g.vm.current.muzzle, cam, VM_FOV, _m);
        cam.getWorldDirection(_fwd);
        g.fx.barrelSmoke(_m, _fwd);
      }
    }

    // ---------- health ----------
    if (this.cheatDeathInvulnT > 0) this.cheatDeathInvulnT = Math.max(0, this.cheatDeathInvulnT - dt);
    this.sinceDamage += dt;
    if (this.sinceDamage > 4.5 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 24 * dt);

    // ---------- camera ----------
    this.recP = damp(this.recP, this.recTP, 28, dt);
    this.recY = damp(this.recY, this.recTY, 28, dt);
    if (this.sinceShot > 0.09) {
      // partial recovery: the sight settles back, the rest is permanent climb
      const k = 1 - Math.exp(-6.5 * dt);
      const rp = this.recTP * k, ry = this.recTY * k;
      this.recTP -= rp;
      this.recTY -= ry;
      this.pitch = clamp(this.pitch + rp * 0.3, -1.5, 1.5);
      this.yaw += ry * 0.5;
    }
    const eyeTarget = lerp(EYE_STAND, EYE_CROUCH, this.crouch);
    this.eyeY = eyeTarget;
    // smooth out stair steps
    const camTarget = this.pos.y + this.eyeY;
    if (this.onGround) this.camY = Math.abs(camTarget - this.camY) > 1 ? camTarget : damp(this.camY, camTarget, 22, dt);
    else this.camY = camTarget;

    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sh = this.shake * this.shake;
    const t = g.r.time;
    const bobK = this.bobAmp * (1 - this.ads * 0.8) * (1 + this.sprint * 0.9);
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.028 * bobK + 0.014 * bobK;
    const bobX = Math.cos(this.bobPhase) * 0.014 * bobK;
    const dip = this.landDip.update(0, dt) * 0.03;
    const pP = this.punchP.update(0, dt) * 0.012;
    const pR = this.punchR.update(0, dt) * 0.012;

    // Apply lateral pull on listing sinking ship deck
    if (this.onGround && Math.abs(this.shipSlideX) > 0.01 && !this.scriptedLock) {
      this.pos.x += this.shipSlideX * dt;
      g.world.resolveCylinder(this.pos, RADIUS, EYE_STAND + 0.15, 0.45);
    }

    this.eye.set(this.pos.x, this.camY + bobY + dip, this.pos.z);
    cam.position.set(this.eye.x + cs * bobX, this.eye.y, this.eye.z - sn * bobX);
    _e.set(
      clamp(this.pitch + this.recP + pP + Math.sin(t * 47) * sh * 0.022 - this.mantleVis * 0.06, -1.55, 1.55),
      this.yaw + this.recY + Math.sin(t * 39 + 2) * sh * 0.02,
      this.shipRoll + pR + Math.cos(this.bobPhase) * 0.0035 * bobK - mx * 0.006 * Math.min(1, hs / 4) + Math.sin(t * 53 + 1) * sh * 0.018
        + (this.mantleT >= 0 ? Math.sin(Math.min(1, this.mantleT) * Math.PI) * 0.06 : 0),
    );
    cam.quaternion.setFromEuler(_e);

    const targetFov = settings.fov * lerp(1, d.adsFovMult, this.ads * this.ads * (3 - 2 * this.ads)) + this.sprint * 4;
    this.fov = targetFov;
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov = targetFov;
      cam.updateProjectionMatrix();
    }

    // is the weapon in sunlight?
    this.sunT -= dt;
    if (this.sunT <= 0) {
      this.sunT = 0.12;
      const s = g.r.sunDir;
      this.sunlit = g.world.raycast(this.eye.x, this.eye.y - 0.15, this.eye.z, s.x, s.y, s.z, 80) ? 0 : 1;
    }
    g.r.vmSunlit = damp(g.r.vmSunlit, this.sunlit, 7, dt);

    // ---------- viewmodel ----------
    const scoped = this.scoped;
    g.vm.setVisible(!scoped);
    g.hud.setScope(scoped);
    const s = this.vmState;
    s.dt = dt;
    s.ads = this.ads;
    s.sprint = this.sprint;
    s.bobPhase = this.bobPhase;
    s.bobAmp = this.bobAmp;
    s.strafe = mx * Math.min(1, hs / 4);
    s.vy = this.vel.y;
    s.mouseDX = inp.mouseDX;
    s.mouseDY = inp.mouseDY;
    s.reload = this.reloadT;
    s.bolt = this.boltT;
    s.melee = this.meleeT;
    s.throwing = this.throwT;
    s.equip = this.equip;
    s.empty = a.mag === 0;
    s.crouch = this.crouch;
    s.mantle = this.mantleVis;
    s.mantleT = this.mantleT >= 0 ? this.mantleT : -1;
    s.plantC4T = this.plantC4T >= 0 ? this.plantC4T : -1;
    s.canted = this.nvgOn && this.def.family !== 'pistol' ? 1 : 0;
    g.vm.update(s);
  }

  /**
   * COD-style ledge climb: probe the wall in front of the player and, if its top is between
   * knee and chest-and-a-half height with room to stand, start a scripted mantle (or a quick
   * vault for low obstacles). Returns true when a climb was started.
   */
  private tryStartMantle(height: number): boolean {
    const g = this.g;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const probeY = [this.pos.y + 0.85, this.pos.y + 1.35];
    this.mantleLog.length = 0;
    for (const oy of probeY) {
      if (!g.world.raycast(this.pos.x, oy, this.pos.z, fx, 0, fz, RADIUS + 0.7, _hit)) {
        this.mantleLog.push(`no wall @${oy.toFixed(2)}`);
        continue;
      }
      const c = _hit.collider;
      if (!c || Math.abs(_hit.normal.y) > 0.4) {
        this.mantleLog.push(`bad face n.y=${_hit.normal.y.toFixed(2)}`);
        continue;
      }
      if (_hit.t > RADIUS + 0.5) {
        this.mantleLog.push(`too far t=${_hit.t.toFixed(2)}`);
        continue;
      }
      const top = c.maxY;
      const rise = top - this.pos.y;
      if (rise < 0.5 || rise > 2.05) {
        this.mantleLog.push(`bad rise=${rise.toFixed(2)}`);
        continue;
      }
      // there must be solid footing beyond the edge and headroom above it
      const dx = this.pos.x + fx * (_hit.t + 0.5);
      const dz = this.pos.z + fz * (_hit.t + 0.5);
      const support = g.world.groundHeight(dx, dz, top + 0.3, RADIUS * 0.55, 0.08);
      if (support < top - 0.3) {
        this.mantleLog.push(`no footing (${support.toFixed(2)} < ${top.toFixed(2)})`);
        continue;
      }
      const ceil = g.world.ceilingHeight(dx, dz, top + 0.1, RADIUS * 0.7);
      if (ceil < top + height * 0.85) {
        this.mantleLog.push(`no headroom ${ceil.toFixed(2)}`);
        continue;
      }
      this.mantleFrom.copy(this.pos);
      this.mantleTo.set(dx, support, dz);
      this.mantleKind = rise < 0.95 ? 'vault' : 'mantle';
      this.mantleDur = this.mantleKind === 'vault' ? 0.3 : 0.36 + Math.min(0.3, rise * 0.14);
      this.mantleT = 0;
      this.mantleVis = 0;
      this.onGround = false;
      this.vel.set(0, 0, 0);
      this.crouchToggle = false;
      audio.play('cloth', { vol: 0.42, rate: 1.05 });
      return true;
    }
    return false;
  }

  private updateDead(dt: number) {
    const g = this.g;
    const cam = g.r.camera;
    this.deadT += dt;
    // collapse to the ground and roll over
    const k = clamp(this.deadT / 0.9, 0, 1);
    const e = k * k * (3 - 2 * k);
    this.vel.x = damp(this.vel.x, 0, 4, dt);
    this.vel.z = damp(this.vel.z, 0, 4, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    g.world.resolveCylinder(this.pos, RADIUS, 1, STEP);
    const ground = g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y, RADIUS * 0.75, STEP);
    this.pos.y = Math.max(ground, this.pos.y - 8 * dt);
    this.eye.set(this.pos.x, this.pos.y + lerp(this.eyeY, 0.28, e), this.pos.z);
    cam.position.copy(this.eye);
    _e.set(lerp(this.pitch, 0.25, e), this.yaw, e * 1.15);
    cam.quaternion.setFromEuler(_e);
    g.vm.setVisible(false);
    g.hud.setScope(false);
    if (cam.fov !== settings.fov) {
      cam.fov = settings.fov;
      cam.updateProjectionMatrix();
    }
  }
}
