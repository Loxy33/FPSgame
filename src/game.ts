import * as THREE from 'three';
import { audio } from './core/audio';
import { Input } from './core/input';
import { reportNoise } from './ai/noise';
import { settings } from './core/settings';
import { preloadVoice, stopVoice } from './core/voice';
import { clamp, damp, nextFrame, rand } from './core/utils';
import { Enemy, ENEMY_STATS, resetEnemyPathBudget, type EnemyEnv } from './entities/enemy';
import { AmmoBox, Barrel, Grenade, makeSupplyCrate } from './entities/items';
import { Player } from './entities/player';
import { prewarmSoldiersForLevel, SoldierModel, type ModelKind, type SoldierKind } from './entities/soldier';
import { TargetSet } from './entities/targets';
import { buildC4Mesh, drawC4Lcd, ViewModel } from './entities/viewmodel';
import { WEAPONS, type WeaponDef } from './entities/weapons';
import { assets, loadAssets } from './render/assets';
import { Effects } from './render/fx';
import { buildMaterials, type Materials } from './render/materials';
import { Renderer } from './render/renderer';
import { type FriendlyMarker } from './highSeas';
import { HighSeasRemakeMission } from './highSeasRemake';
import { rollHexChoices, type HexAugment } from './hextech';
import { OilfieldMission } from './oilfieldMission';
import { Tutorial, type TutorialStart } from './tutorial';
import { Hud, type DebriefStats, type MapBlip, type Screen } from './ui/hud';
import { buildLevel, type LevelData, type LevelId } from './world/level';
import { NavGrid } from './world/nav';
import { makeHit, World, type Surface } from './world/physics';
import { buildOilfield, type OilfieldDynamic } from './world/oilfield';
import { buildShipRemake, type ShipRemakeDynamic } from './world/shipRemake';
import { buildTraining, TRAIN } from './world/training';

interface Supply {
  x: number; z: number; ready: boolean; cooldown: number; beacon: THREE.Object3D;
}

interface PlantedC4 {
  group: THREE.Group;
  ledHalo: THREE.Object3D | null;
  lcdCtx: CanvasRenderingContext2D;
  lcdTex: THREE.CanvasTexture;
  ledMat: THREE.MeshBasicMaterial;
  pos: THREE.Vector3;
  rem: number;
  dur: number;
  beepCd: number;
  blinkT: number;
  lastHalfSec: number;
}

export type GameMode = 'survival' | 'training' | 'highseas' | 'oilfield';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _hit = makeHit();

function impactSound(s: Surface) {
  return s === 'metal' ? 'imp_metal' : s === 'sand' ? 'imp_dirt' : s === 'wood' ? 'imp_wood' : s === 'flesh' ? 'imp_flesh' : 'imp_conc';
}

export class Game {
  r!: Renderer;
  input!: Input;
  world = new World();
  nav = new NavGrid();
  fx!: Effects;
  vm!: ViewModel;
  hud = new Hud();
  player!: Player;
  lvl!: LevelData;
  levelId: LevelId | null = null;
  mode: GameMode = 'survival';
  targets = new TargetSet();
  tutorial: Tutorial | null = null;
  highSeas: HighSeasRemakeMission | null = null;
  oilfieldMission: OilfieldMission | null = null;
  private shipRemakeDyn: ShipRemakeDynamic | null = null;
  private oilDyn: OilfieldDynamic | null = null;
  bound = 70;
  state: Screen = 'loading';
  debug = false;
  /** Debug: player takes no damage. */
  god = false;
  /** Debug: enemies are spawned but never think. */
  freezeAI = false;
  /** Debug only: slows the whole simulation so fast effects can be inspected. */
  debugTimeScale = 1;
  debugAim = false;
  debugWalk = 0;
  /** Debug only: detached inspection camera (sx/sz = centre of the shadow cascade). */
  debugCam: { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number; sx?: number; sz?: number } | null = null;

  enemies: Enemy[] = [];
  private plantedC4s: PlantedC4[] = [];
  grenades: Grenade[] = [];
  barrels: Barrel[] = [];
  boxes: AmmoBox[] = [];
  supplies: Supply[] = [];

  wave = 0;
  score = 0;
  kills = 0;
  headshots = 0;
  time = 0;
  hexActive: HexAugment[] = [];
  hexChoosing = false;
  private hexPendingBoss = false;
  private hexShotCounter = 0;
  private hexPickerDelay = 0;
  private hexPickerWave = 0;
  private hexPickerBoss = false;
  private mats!: Materials;
  private sunAz = 0;
  /** Materials and textures shared between levels (never disposed on a level switch). */
  private shared = new Set<THREE.Material>();
  private loadingLevel = false;
  private toSpawn = 0;
  private heaviesLeft = 0;
  private spawnT = 0;
  private intermission = 0;
  private waveActive = false;
  private maxAlive = 6;
  private deathT = 0;
  private menuT = 0;
  private last = 0;
  private env!: EnemyEnv;
  private blips: MapBlip[] = [];
  private iffMarkers: FriendlyMarker[] = [];
  private boxDots: { x: number; z: number }[] = [];
  private fadeIn = 0;
  private multiKillT = 0;
  private multiKill = 0;
  /** Smoothed frame time, exposed for debugging. */
  frameMs = 16;

  async init(canvas: HTMLCanvasElement, debug: boolean, firstLevel: LevelId = 'training') {
    this.debug = debug;
    const hud = this.hud;
    hud.setLoadingMission('系统初始化 · 铁砧战术训练基地');
    hud.setLoading(0.03, '正在初始化 WebGL2 渲染管线…', 0);
    await nextFrame();
    this.r = new Renderer(canvas);
    this.input = new Input(canvas);
    this.input.debugNoLock = debug;

    const hi = settings.quality !== 'low';
    await loadAssets(Math.min(16, this.r.renderer.capabilities.getMaxAnisotropy()), (p, label) => hud.setLoading(0.05 + p * 0.42, `正在载入 3A 资源 · ${label}`, 0));
    const sky = assets.sky!;
    this.r.setSky(sky.bg, sky.hdr, sky.meta);
    this.mats = await buildMaterials(hi, (p, label) => hud.setLoading(0.47 + p * 0.08, `正在生成扫描材质 · ${label}`, 0));
    for (const v of Object.values(this.mats)) if (v instanceof THREE.Material) this.shared.add(v);
    for (const p of Object.values(assets.props)) for (const part of p.parts) this.shared.add(part.mat);
    this.sunAz = Math.atan2(this.r.sunDir.z, this.r.sunDir.x);

    this.fx = new Effects(this.r.scene, this.r.fxScene, this.r.scene.fog as THREE.FogExp2);
    this.vm = new ViewModel(this.r.vmRoot, this.r.vmFlash);
    this.player = new Player(this);
    this.hud.onLoadoutChange = (id) => {
      this.player.refreshWeapons();
      this.vm.refit(id);
    };
    this.hud.gunModelProvider = (id) => this.vm.models[id]?.group ?? null;
    this.r.scene.add(this.targets.root);
    this.targets.onHit = (t, zone, how) => this.tutorial?.onTargetHit(t, zone, how);
    await this.loadLevel(firstLevel, (p, label, st) => hud.setLoading(0.55 + p * 0.36, label, st));

    hud.setLoading(0.93, '正在加载立体声战区音效与语音…', 4);
    await nextFrame();
    audio.init();
    void preloadVoice();

    hud.setLoading(0.97, '正在校验首帧渲染管线…', 4);
    await nextFrame();
    this.placeMenuCamera(0);
    this.vm.setVisible(true);
    this.r.render(0.016, _a.set(0, 0, 0));
    this.vm.setVisible(false);

    this.env = {
      world: this.world, nav: this.nav, fx: this.fx, r: this.r, enemies: this.enemies,
      playerPos: this.player.pos, playerEye: this.player.eye, playerVel: this.player.vel,
      playerAlive: true, playerCrouch: 0, accMult: 1,
      hurtPlayer: (dmg, from) => this.player.damage(dmg, from),
    };

    // --- UI wiring ---
    hud.onStart = () => this.start('survival');
    hud.onTrain = () => this.start('training');
    hud.onHighSeas = () => this.start('highseas');
    hud.onOilfield = () => this.start('oilfield');
    hud.onRestart = () => this.start(this.mode);
    hud.onRetryCqb = () => this.start('training', 'cqb');
    hud.onDebriefPrimary = () => {
      if (this.mode === 'highseas') this.start('oilfield');
      else this.start('survival');
    };
    hud.onDebriefRetry = () => {
      if (this.mode === 'training') this.start('training', 'cqb');
      else this.start(this.mode);
    };
    hud.onResume = () => this.resume();
    hud.onQuit = () => this.toMenu();
    hud.onSettings = () => {
      audio.setVolume(settings.volume);
      this.r.setQuality(settings.quality);
    };
    this.input.onLockChange = (locked) => {
      if (locked) {
        if (this.state === 'paused') this.setState('playing');
      } else if (this.state === 'playing' && !this.hexChoosing) this.pause();
    };
    // a pointer-lock request can be refused once the click that started a level load is too old
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.hexChoosing && !this.input.active) this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        hud.togglePerf();
        return;
      }
      if (e.code !== 'Escape') return;
      if (hud.panelOpen) hud.closePanel();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'playing' && this.debug) this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    // Unlock WebAudio & start main menu soundtrack on the very first user gesture
    const unlockMenuAudio = () => {
      audio.resume();
      if (this.state === 'menu') audio.setMenuMusic(1, 1.2);
    };
    window.addEventListener('pointerdown', unlockMenuAudio, { once: true });
    window.addEventListener('keydown', unlockMenuAudio, { once: true });

    hud.setLoading(1, '就绪');
    await nextFrame();
    this.setState('menu');
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private setState(s: Screen) {
    this.state = s;
    this.hud.show(s);
    if (s !== 'playing') stopVoice();
    audio.setSfxLevel(s === 'paused' ? 0.15 : s === 'debrief' ? 0.4 : 1);
    if (s === 'menu') {
      audio.setDrone(0, 1.0);
      audio.setMenuMusic(1, 1.4);
    } else if (s === 'playing') {
      audio.setMenuMusic(0, 1.1);
    } else if (s === 'dead') {
      audio.setMenuMusic(0, 0.8);
      audio.setDrone(0.85, 1.2);
    } else if (s === 'debrief') {
      audio.setDrone(0.15, 1.8);
      audio.setMenuMusic(0.58, 2.0);
    }
  }

  // -------------------------------------------------------------------------
  // levels
  // -------------------------------------------------------------------------
  private async loadLevel(id: LevelId, progress: (p: number, label: string, stageIdx?: number) => void) {
    const missionBanner = id === 'training' ? 'PROLOGUE // 铁砧战术训练基地'
      : id === 'highseas' ? 'MISSION 01 // 南海暴雨夜 · 泰山号远洋货轮'
        : id === 'oilfield' ? 'MISSION 02 // 中亚戈壁 · 卡拉干达 7 号油田'
          : 'SURVIVAL // 哈迪尔防线 · 总部战术支援';
    this.hud.setLoadingMission(missionBanner);
    progress(0.04, '正在清理上一战区缓存…', 0);
    await nextFrame();
    this.unloadLevel();

    progress(
      0.12,
      id === 'training' ? '正在构建铁砧营地靶场与 CQB 突入屋…'
        : id === 'highseas' ? '正在构建泰山号 6 大战区与暴雨海面…'
          : id === 'oilfield' ? '正在构建卡拉干达油田与地下超算掩体…'
            : '正在构建哈迪尔城镇、大巴扎与前进基地…',
      0,
    );
    await nextFrame();
    if (id === 'highseas') {
      const built = buildShipRemake(this.world, this.mats);
      this.lvl = built;
      this.shipRemakeDyn = built.ship;
      this.oilDyn = null;
      this.r.setTheme('storm');
    } else if (id === 'oilfield') {
      const built = buildOilfield(this.world, this.mats);
      this.lvl = built;
      this.oilDyn = built.oilfield;
      this.shipRemakeDyn = null;
      this.r.setTheme('desert');
    } else {
      this.shipRemakeDyn = null;
      this.oilDyn = null;
      this.lvl = id === 'training' ? buildTraining(this.world, this.mats, this.sunAz) : buildLevel(this.world, this.mats, this.sunAz);
      this.r.setTheme('desert');
    }
    this.levelId = id;
    this.bound = this.lvl.bound;
    this.r.scene.add(this.lvl.group);
    // Virtualize all static/dynamic level PointLights into Renderer's fixed 8-slot proximity pool!
    // Keeps GPU NUM_POINT_LIGHTS permanently locked to 12 across all 4 maps (cuts shader cost & compile time by 5-6x!).
    this.r.virtualizeLevelLights(this.lvl.group);
    this.hud.buildMap(this.world, this.lvl.map);

    progress(0.36, '正在烘焙战区寻路网格与掩体拓扑…', 1);
    await nextFrame();
    this.nav.build(this.world, 0.42, this.lvl.bound);

    progress(0.48, '正在部署可引爆油桶、补给点与靶标设施…', 1);
    await nextFrame();
    this.fx.setAmbient(this.lvl.fires, this.lvl.plumes, (l) => this.r.addVirtualLight(l));
    for (const b of this.lvl.barrels) {
      const barrel = new Barrel(this.world, b.x, b.y, b.z);
      this.barrels.push(barrel);
      this.r.scene.add(barrel.mesh);
    }
    for (const s of this.lvl.supplies) {
      const sy = s.y ?? this.world.groundHeight(s.x, s.z, 0.35, 0.25, 0.35);
      const beacon = makeSupplyCrate(s.x, s.z, sy);
      this.r.scene.add(beacon);
      this.supplies.push({ x: s.x, z: s.z, ready: true, cooldown: 0, beacon });
    }
    this.targets.build(this.lvl.targets);

    // Pre-bake & mount all level character skeletons, 2K remapped textures, Boss models, and dynamic items
    // behind the loading screen so zero CPU/GPU hitches ever occur when entering new zones or spawning waves!
    progress(0.54, '正在预加载全图角色骨骼、BOSS 装甲与武器材质…', 2);
    await nextFrame();
    const dummySoldiers = await prewarmSoldiersForLevel(id, this.r.scene, async (f) => {
      progress(0.54 + f * 0.18, `正在预加载角色骨骼与 2K 材质 (${Math.round(f * 100)}%)…`, 2);
      await nextFrame();
    });
    const dummyAmmo = new AmmoBox(0, -45, 0);
    const dummyGren = new Grenade(new THREE.Vector3(0, -45, 0), new THREE.Vector3());
    const dummyC4 = buildC4Mesh(true);
    dummyC4.group.position.set(0, -45, 0);
    const disposeEnemyPrewarm = Enemy.prewarmVisuals(this.r.scene);
    const disposeBossFxPrewarm = this.fx.prewarmBossVfx();
    this.r.scene.add(dummyAmmo.group, dummyGren.mesh, dummyC4.group);
    this.r.fxScene.add(dummyAmmo.beacon);

    progress(0.72, '正在分批上传显存纹理与预编译着色器…', 3);
    await nextFrame();
    this.r.markShadowsDirty();
    await this.r.prewarmAsync(this.lvl.spawnPoints, async (f, detail) => {
      const st = f < 0.5 ? 3 : 4;
      progress(0.72 + f * 0.27, detail, st);
      await nextFrame();
    });

    for (const dm of dummySoldiers) {
      this.r.scene.remove(dm.root);
      dm.dispose();
    }
    disposeEnemyPrewarm();
    disposeBossFxPrewarm();
    this.r.scene.remove(dummyAmmo.group, dummyGren.mesh, dummyC4.group);
    dummyC4.lcdTex.dispose();
    dummyC4.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.userData.sharedGeo) m.geometry?.dispose();
      if (!m.userData.sharedMat) {
        if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
        else m.material?.dispose();
      }
    });
    this.r.fxScene.remove(dummyAmmo.beacon);

    this.menuT = 0;
    progress(1, '战区部署完毕 · 准备投入战斗', 5);
    await nextFrame();
  }

  private unloadLevel() {
    this.r.clearVirtualLights();
    if (!this.lvl) return;
    this.tutorial?.dispose();
    this.tutorial = null;
    this.highSeas?.dispose();
    this.highSeas = null;
    this.oilfieldMission?.dispose();
    this.oilfieldMission = null;
    this.shipRemakeDyn = null;
    this.oilDyn = null;
    this.clearDynamic();
    for (const b of this.barrels) this.r.scene.remove(b.mesh);
    this.barrels.length = 0;
    for (const s of this.supplies) this.r.scene.remove(s.beacon);
    this.supplies.length = 0;
    this.targets.clear();
    this.r.scene.remove(this.lvl.group);
    this.lvl.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.userData.sharedGeo) m.geometry.dispose();
      if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (this.shared.has(mat)) continue;
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v.userData.owned) v.dispose();
        mat.dispose();
      }
    });
    this.world.clear();
    this.fx.clearAmbient();
    this.fx.reset();
    this.levelId = null;
  }

  /** Removes enemies, grenades and dropped ammo. */
  private clearDynamic() {
    for (const e of this.enemies) { this.r.scene.remove(e.model.root); e.model.dispose(); }
    this.enemies.length = 0;
    for (const g of this.grenades) this.r.scene.remove(g.mesh);
    this.grenades.length = 0;
    for (const b of this.boxes) this.removeBox(b);
    this.boxes.length = 0;
    for (const c of this.plantedC4s) this.disposePlantedC4(c);
    this.plantedC4s.length = 0;
  }

  /** Plays the first-person dual-hand C4 arming & planting animation and spawns a live blinking/beeping 3D C4 charge in the world. */
  plantC4Charge(pos: THREE.Vector3, rotY = 0, countdown = 3.0, animDur = 2.15, verticalMount = false) {
    const p = pos.clone();
    this.player.startPlantC4(animDur, () => {
      this.spawnWorldC4(p, rotY, countdown, verticalMount);
    });
  }

  spawnWorldC4(pos: THREE.Vector3, rotY = 0, countdown = 3.0, verticalMount = false) {
    const c4 = buildC4Mesh(true);
    drawC4Lcd(c4.lcdCtx, c4.lcdTex, 'ARMED!', `DET ${countdown.toFixed(1)}s`, true);
    c4.ledMat.color.setHex(0xff2818);
    c4.group.position.copy(pos);
    c4.group.rotation.order = 'YXZ';
    c4.group.rotation.y = rotY;
    if (verticalMount) c4.group.rotation.x = Math.PI * 0.5;
    // IMPORTANT: Never add a new THREE.PointLight to scene at runtime (would change NUM_POINT_LIGHTS
    // and trigger a full-scene shader recompile stall!). Use Renderer's pre-allocated pooled flash() instead!
    const ledHalo = c4.group.getObjectByName('ledHalo') ?? null;
    this.r.scene.add(c4.group);
    this.r.flash(pos, 0xff2818, 38, 0.16, 10);
    this.plantedC4s.push({
      group: c4.group,
      ledHalo,
      lcdCtx: c4.lcdCtx,
      lcdTex: c4.lcdTex,
      ledMat: c4.ledMat,
      pos: pos.clone(),
      rem: countdown,
      dur: countdown,
      beepCd: 0.05,
      blinkT: 0.14,
      lastHalfSec: -1,
    });
  }

  private disposePlantedC4(c: PlantedC4) {
    this.r.scene.remove(c.group);
    c.lcdTex.dispose();
    c.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (!m.userData.sharedGeo) m.geometry?.dispose();
        if (!m.userData.sharedMat) {
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
          else m.material?.dispose();
        }
      }
    });
  }

  private updatePlantedC4s(dt: number) {
    for (let i = this.plantedC4s.length - 1; i >= 0; i--) {
      const c = this.plantedC4s[i];
      c.rem -= dt;
      if (c.rem <= 0) {
        this.disposePlantedC4(c);
        this.plantedC4s.splice(i, 1);
        continue;
      }
      const prog = 1 - clamp(c.rem / Math.max(0.1, c.dur), 0, 1);
      // Accelerating countdown beep cadence: 0.46s -> 0.24s -> 0.11s!
      c.beepCd -= dt;
      if (c.beepCd <= 0) {
        c.beepCd = prog > 0.72 ? 0.11 : prog > 0.42 ? 0.24 : 0.46;
        c.blinkT = Math.min(0.12, c.beepCd * 0.55);
        // Zero-recompile pooled dynamic flash pulse on the C4 surface!
        this.r.flash(c.pos, 0xff2818, 34, c.blinkT + 0.04, 10);
        audio.playAt('ui_click', c.pos, { vol: 0.72, rate: 1.72 + prog * 0.52, rateVar: 0.01, refDist: 18 });
      }
      c.blinkT = Math.max(0, c.blinkT - dt);
      const lit = c.blinkT > 0;
      c.ledMat.color.setHex(lit ? 0xff2c1a : 0x380808);
      if (c.ledHalo) c.ledHalo.visible = lit;
      // Refresh LCD texture at 2 Hz instead of 10 Hz to avoid unnecessary GPU texture uploads
      const halfSec = Math.ceil(c.rem * 2);
      if (halfSec !== c.lastHalfSec) {
        c.lastHalfSec = halfSec;
        drawC4Lcd(c.lcdCtx, c.lcdTex, 'ARMED!', `DET ${(halfSec / 2).toFixed(1)}s`, true);
      }
    }
  }

  // -------------------------------------------------------------------------
  // flow
  // -------------------------------------------------------------------------
  async start(mode: GameMode, from: TutorialStart = 'intro') {
    if (this.loadingLevel) return;
    audio.resume();
    // ask for the pointer while we still hold the click's user activation
    this.input.requestLock();
    const id: LevelId = mode === 'training' ? 'training' : mode === 'highseas' ? 'highseas' : mode === 'oilfield' ? 'oilfield' : 'survival';
    if (this.levelId !== id) {
      this.loadingLevel = true;
      this.setState('loading');
      await this.loadLevel(id, (p, label, st) => this.hud.setLoading(p, label, st));
      const sp = this.lvl.playerSpawn;
      this.r.camera.position.set(sp.x, 1.6, sp.z);
      this.r.camera.rotation.set(0, sp.yaw, 0, 'YXZ');
      this.r.render(0.016, _a.set(sp.x, 0, sp.z));
      this.loadingLevel = false;
    }
    this.beginRun(mode, from);
  }

  private beginRun(mode: GameMode, from: TutorialStart) {
    this.mode = mode;
    audio.startAmbience();
    audio.ambience = mode === 'training' ? 'range' : 'war';
    audio.setCombatTrack(
      mode === 'highseas' ? 'taishan' : mode === 'oilfield' ? 'oilfield' : mode === 'survival' ? 'hadir' : 'training',
    );
    audio.setDrone(mode === 'training' ? 0.35 : 0.65, 2);
    this.clearDynamic();
    for (const b of this.barrels) b.reset();
    for (const s of this.supplies) {
      s.ready = true;
      s.cooldown = 0;
    }
    this.fx.reset();
    this.targets.reset();
    const sp = this.lvl.playerSpawn;
    // a kill-house retry starts at the door, facing in
    if (mode === 'training' && from === 'cqb') this.player.reset(TRAIN.cqb.stage.x, TRAIN.cqb.stage.z, 0);
    else this.player.reset(sp.x, sp.z, sp.yaw);
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.time = 0;
    this.hexActive = [];
    this.hexChoosing = false;
    this.hexPendingBoss = false;
    this.hexShotCounter = 0;
    this.hexPickerDelay = 0;
    this.hexPickerWave = 0;
    this.hexPickerBoss = false;
    this.hud.setHexAugments([]);
    this.hud.hideHexPicker();
    this.hud.setBoss(null);
    this.toSpawn = 0;
    this.waveActive = false;
    this.intermission = 5;
    this.deathT = 0;
    this.fadeIn = 1;
    const u = this.r.final.uniforms;
    u.uDamage.value = 0;
    u.uFlash.value = 0;
    u.uLowHealth.value = 0;
    this.hud.resetGame();
    this.hud.setScore(0);
    this.hud.setMode(mode === 'training' || mode === 'highseas' || mode === 'oilfield', mode === 'highseas');
    this.tutorial?.dispose();
    this.tutorial = null;
    this.highSeas?.dispose();
    this.highSeas = null;
    this.oilfieldMission?.dispose();
    this.oilfieldMission = null;
    this.setState('playing');
    if (mode === 'training') {
      this.tutorial = new Tutorial(this);
      this.tutorial.onFinish = (s) => this.finishTraining(s);
      this.tutorial.start(from);
    } else if (mode === 'highseas' && this.shipRemakeDyn) {
      this.highSeas = new HighSeasRemakeMission(this, this.shipRemakeDyn);
      this.highSeas.onFinish = (s) => this.finishTraining(s);
      this.highSeas.start();
    } else if (mode === 'oilfield' && this.oilDyn) {
      this.oilfieldMission = new OilfieldMission(this, this.oilDyn);
      this.oilfieldMission.onFinish = (s) => this.finishTraining(s);
      this.oilfieldMission.start();
    } else {
      this.hud.announce('哈迪尔防线', '坚守前进基地 · 每波召唤总部战术支援 · 每 3 波迎战首领「赤沙暴君」');
      this.hud.hint('战区总部已空投开局战术支援，请选择一项立即装配！', 5);
      this.input.reset();
      // Give 1 free HQ Tactical Support immediately on match start!
      this.openHexPicker(0, false);
      return;
    }
    this.input.reset();
    this.input.requestLock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.exitLock();
    this.input.reset();
  }

  resume() {
    if (this.state !== 'paused') return;
    audio.resume();
    this.input.requestLock();
    // state flips back to 'playing' once the pointer lock is granted
  }

  toMenu() {
    this.input.exitLock();
    this.vm.setVisible(false);
    this.tutorial?.dispose();
    this.tutorial = null;
    this.highSeas?.dispose();
    this.highSeas = null;
    this.oilfieldMission?.dispose();
    this.oilfieldMission = null;
    this.shipRemakeDyn = null;
    this.oilDyn = null;
    this.clearDynamic();
    this.targets.reset();
    this.hud.setMode(false);
    this.hexChoosing = false;
    this.hexPickerDelay = 0;
    this.hud.hideHexPicker();
    this.hud.setHexAugments([]);
    this.hud.setBoss(null);
    audio.setBossMusic(null);
    audio.ambience = 'war';
    const u = this.r.final.uniforms;
    u.uDamage.value = 0;
    u.uLowHealth.value = 0;
    u.uFade.value = 0;
    this.r.camera.fov = 55;
    this.r.camera.updateProjectionMatrix();
    this.setState('menu');
  }

  private finishTraining(s: DebriefStats) {
    if (this.state !== 'playing') return;
    this.hud.showDebrief({ ...s, mode: s.mode ?? this.mode });
    this.setState('debrief');
    this.input.exitLock();
    this.input.reset();
  }

  onPlayerDeath() {
    this.deathT = 0;
    this.hexPickerDelay = 0;
    audio.play('bodyfall', { vol: 0.9 });
    this.input.exitLock();
  }

  private finishDeath() {
    const p = this.player;
    const acc = p.shots > 0 ? Math.min(1, p.hits / p.shots) : 0;
    let record = false;
    if (this.mode === 'survival') {
      const bestScore = Number(localStorage.getItem('redsand.best.score') || 0);
      const bestWave = Number(localStorage.getItem('redsand.best.wave') || 0);
      record = this.score > bestScore && this.score > 0;
      if (record) localStorage.setItem('redsand.best.score', String(this.score));
      if (this.wave > bestWave) localStorage.setItem('redsand.best.wave', String(this.wave));
    }
    const stageInfo =
      this.mode === 'highseas'
        ? this.highSeas?.getStageInfo()
        : this.mode === 'oilfield'
          ? this.oilfieldMission?.getStageInfo()
          : undefined;
    this.hud.showDeath({
      mode: this.mode,
      wave: Math.max(1, this.wave),
      score: this.score,
      kills: this.kills,
      headshots: this.headshots,
      accuracy: acc,
      time: this.time,
      record,
      stageLabel: stageInfo?.label,
      zone: stageInfo?.zone,
      totalZones: stageInfo?.totalZones,
      augments: this.hexActive.length,
    });
    this.setState('dead');
  }

  // -------------------------------------------------------------------------
  // waves
  // -------------------------------------------------------------------------
  private startWave(n: number) {
    this.wave = n;
    const isBossWave = n % 3 === 0;
    this.hexPendingBoss = isBossWave;
    this.toSpawn = Math.min(4 + n * 2, 34);
    this.heaviesLeft = Math.min(4, Math.floor((n - 1) / 2));
    this.maxAlive = Math.min(5 + n, 14);
    this.spawnT = 1.4;
    this.waveActive = true;
    this.env.accMult = Math.min(1.3, 0.62 + n * 0.06);
    if (isBossWave) {
      this.spawnBossTyrant(n);
      this.hud.announce(`第 ${n} 波 · BOSS 降临`, '哈迪尔重甲首领「赤沙暴君」登场！击溃必获总部特级支援空投');
    } else {
      this.hud.announce(`第 ${n} 波 · 叛军攻势`, n === 1 ? '清剿本波即可召唤下一轮总部战术支援' : '敌军增援抵达 · 坚守哈迪尔镇');
    }
    audio.play('horn', { vol: isBossWave ? 0.85 : 0.5, reverb: 0.6 });
    audio.setDrone(isBossWave ? 0.9 : 0.75, 3);
  }

  private spawnBossTyrant(waveN: number) {
    const p = this.player;
    let best = this.lvl.spawnPoints[0];
    let bestD = -1;
    for (const s of this.lvl.spawnPoints) {
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d > bestD) { bestD = d; best = s; }
    }
    const boss = new Enemy('boss_tyrant', best.x, best.z, 1 + Math.floor((waveN - 1) / 3) * 0.35);
    boss.yaw = Math.atan2(p.pos.x - best.x, p.pos.z - best.z);
    boss.onBossPhase2 = () => {
      this.hud.announce('赤沙暴君 · 第二阶段【熔炉觉醒】！', '解锁终极技「焦土超新星」· 警惕头顶烈日蓄能，及时躲入掩体！');
    };
    this.enemies.push(boss);
    this.r.scene.add(boss.model.root);
  }

  /** Trigger Hextech 3-Choose-1 Upgrade Modal (also callable from debug tests). */
  openHexPicker(waveN = Math.max(1, this.wave), bossCleared = false) {
    const choices = rollHexChoices(waveN, bossCleared);
    this.hexChoosing = true;
    this.input.exitLock();
    this.input.reset();
    this.hud.showHexPicker(choices, waveN, bossCleared, (aug) => {
      this.applyHexAugment(aug);
    });
  }

  private applyHexAugment(aug: HexAugment) {
    aug.apply(this.player.hexMods);
    this.hexActive.push(aug);
    const p = this.player;
    // Instant gratification perks: top up HP if maxHp increased & refill grenades/magazines!
    if (aug.id === 'hex_kevlar' || aug.id === 'hex_exo_guard' || aug.id === 'hex_juggernaut') {
      p.health = p.maxHealth;
    } else {
      p.health = Math.min(p.maxHealth, p.health + 25);
    }
    if (aug.id === 'hex_quick_mag' || aug.id === 'hex_ext_drum') {
      for (const id of p.weaponOrder) {
        p.ammo[id].mag = p.magCap(id);
        p.ammo[id].reserve = Math.max(p.ammo[id].reserve, WEAPONS[id].reserve);
      }
    }
    p.grenades = p.maxGrenades;
    this.hexChoosing = false;
    this.hexPickerDelay = 0;
    this.hud.hideHexPicker();
    this.hud.setHexAugments(this.hexActive);
    this.hud.popup(0, `总部支援已装配 · ${aug.name}`, aug.tier === 'prismatic');
    audio.play('waveclear', { vol: 0.75 });
    this.intermission = this.wave === 0 ? 2.5 : 4.0;
    if (this.state === 'playing') this.input.requestLock();
  }

  private pickKind(): SoldierKind {
    const n = this.wave;
    if (this.heaviesLeft > 0 && Math.random() < 0.28) {
      this.heaviesLeft--;
      return 'heavy';
    }
    // wave 1: standard riflemen
    if (n === 1) return 'rifleman';
    // wave 2: fast rushers begin closing in
    if (n === 2) return Math.random() < 0.4 ? 'rusher' : 'rifleman';
    // wave 3: snipers deploy on the perimeter
    if (n === 3) {
      const r = Math.random();
      if (r < 0.25) return 'sniper';
      if (r < 0.6) return 'rusher';
      return 'rifleman';
    }
    // wave 4: riot breachers push with shields
    if (n === 4) {
      const r = Math.random();
      if (r < 0.24) return 'breacher';
      if (r < 0.45) return 'sniper';
      if (r < 0.7) return 'rusher';
      return 'rifleman';
    }
    // wave 5+: all 6 classes including elite specops
    const r = Math.random();
    if (r < 0.18) return 'specops';
    if (r < 0.36) return 'breacher';
    if (r < 0.52) return 'sniper';
    if (r < 0.72) return 'rusher';
    if (r < 0.86) return 'heavy';
    return 'rifleman';
  }

  private spawnEnemy() {
    const p = this.player;
    // choose a spawn point away from, and preferably hidden from, the player
    let best: { x: number; z: number } | null = null;
    let bestScore = -1e9;
    for (const s of this.lvl.spawnPoints) {
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d < 26) continue;
      let sc = Math.random() * 30 - Math.abs(d - 55) * 0.25;
      _a.set(s.x, 1.6, s.z);
      if (this.world.lineOfSight(_a, p.eye)) sc -= 40;
      for (const e of this.enemies) if (e.alive && Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < 3) sc -= 15;
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    if (!best) best = this.lvl.spawnPoints[0];
    let x = best.x + rand(-1.5, 1.5), z = best.z + rand(-1.5, 1.5);
    const cell = this.nav.nearestFree(x, z, 12);
    if (cell >= 0) {
      x = this.nav.wx(cell % this.nav.n);
      z = this.nav.wx((cell / this.nav.n) | 0);
    }
    const kind = this.pickKind();
    const e = new Enemy(kind, x, z, Math.min(1.5, 1 + (this.wave - 1) * 0.04));
    e.yaw = Math.atan2(p.pos.x - x, p.pos.z - z);
    this.enemies.push(e);
    this.r.scene.add(e.model.root);
  }

  /** Debug helper: place an enemy of a given kind. */
  debugSpawn(kind: SoldierKind, x: number, z: number, yaw = 0) {
    const e = new Enemy(kind, x, z);
    e.yaw = yaw;
    this.enemies.push(e);
    this.r.scene.add(e.model.root);
    return e;
  }

  private updateWaves(dt: number) {
    let alive = 0;
    for (const e of this.enemies) if (e.alive) alive++;
    if (!this.waveActive) {
      if (this.hexPickerDelay > 0) {
        this.hexPickerDelay -= dt;
        if (this.hexPickerDelay <= 0) {
          this.hexPickerDelay = 0;
          if (this.player.alive && this.state === 'playing') {
            this.openHexPicker(this.hexPickerWave, this.hexPickerBoss);
          }
        }
      } else {
        this.intermission -= dt;
        if (this.intermission <= 0) this.startWave(this.wave + 1);
      }
    } else {
      this.spawnT -= dt;
      if (this.toSpawn > 0 && alive < this.maxAlive && this.spawnT <= 0) {
        this.spawnEnemy();
        this.toSpawn--;
        alive++;
        this.spawnT = rand(0.5, 1.7);
      }
      if (this.toSpawn === 0 && alive === 0) {
        this.waveActive = false;
        this.intermission = 5;
        const bonus = (this.hexPendingBoss ? 600 : 250) * this.wave;
        this.score += bonus;
        this.hud.setScore(this.score);
        this.hud.announce(
          this.hexPendingBoss ? 'BOSS 已被击溃！' : '波次肃清',
          this.hexPendingBoss ? `总部特级空投正在抵达 · 奖励 +${bonus}` : `第 ${this.wave} 波完成 · 总部战术支援即将空投`,
        );
        this.hud.hint('波次已肃清，4 秒后弹出总部战术支援三选一…', 3.6);
        audio.play('waveclear', { vol: 0.7, reverb: 0.4 });
        audio.setDrone(0.4, 4);
        // Smooth 3.8s celebration & reload breathing transition before popping up the 3-choose-1 modal
        this.hexPickerDelay = 3.8;
        this.hexPickerWave = this.wave;
        this.hexPickerBoss = this.hexPendingBoss;
      }
    }
    this.hud.setWave(
      Math.max(1, this.wave),
      alive + this.toSpawn,
      this.waveActive ? 0 : Math.max(0.01, this.hexPickerDelay > 0 ? this.hexPickerDelay : this.intermission),
    );
  }

  // -------------------------------------------------------------------------
  // combat
  // -------------------------------------------------------------------------
  private onKill(e: Enemy, head: boolean, how: string) {
    this.kills++;
    if (head) this.headshots++;
    const st = ENEMY_STATS[e.kind];
    let pts = st.score;
    this.hud.popup(pts, how === '爆炸' ? '爆炸击杀' : how === '近战' ? '近战击杀' : '击杀', false);
    if (head) {
      pts += 50;
      this.hud.popup(50, '爆头', true);
    }
    // multi-kill streak
    if (this.multiKillT > 0) {
      this.multiKill++;
      const bonus = 25 * this.multiKill;
      pts += bonus;
      this.hud.popup(bonus, this.multiKill === 1 ? '双杀' : this.multiKill === 2 ? '三杀' : '连杀', false);
    } else this.multiKill = 0;
    this.multiKillT = 2.2;
    this.score += pts;
    this.hud.setScore(this.score);
    this.hud.killFeed(st.label, how, head);
    audio.play('kill', { vol: 0.5 });
    // Hextech kill & headshot heal augments!
    const hm = this.player.hexMods;
    const heal = hm.killHeal + (head ? hm.headHeal : 0);
    if (heal > 0 && this.player.alive) {
      this.player.health = Math.min(this.player.maxHealth, this.player.health + heal);
    }
    // drops
    const a = this.player.ammo[this.player.weapon];
    const needy = a.reserve < this.player.def.mag * 2;
    if (Math.random() < (needy ? 0.6 : 0.24) && e.pos.y < 0.3) {
      const box = new AmmoBox(e.pos.x + rand(-0.4, 0.4), e.pos.y, e.pos.z + rand(-0.4, 0.4));
      this.boxes.push(box);
      this.r.scene.add(box.group);
      this.r.fxScene.add(box.beacon);
    }
  }

  private removeBox(b: AmmoBox) {
    this.r.scene.remove(b.group);
    this.r.fxScene.remove(b.beacon);
  }

  /** Acoustic alert radius for player gunfire (respects weapon class & fitted suppressor/compensator). */
  private gunshotNoise(def: WeaponDef): { radius: number; suppressed: boolean } {
    const suppressed = def.fitted.muzzle === 'supp';
    if (suppressed) {
      return { radius: def.family === 'dmr' ? 14 : 11, suppressed: true };
    }
    const base = def.family === 'dmr' ? 72
      : def.id === 'ak47' ? 56
      : def.family === 'rifle' && def.id !== 'mp5a5' ? 52
      : 42;
    const compMul = def.fitted.muzzle === 'comp' ? 1.12 : 1.0;
    return { radius: base * compMul, suppressed: false };
  }

  /** Hitscan from the player's weapon. */
  playerBullet(origin: THREE.Vector3, dir: THREE.Vector3, def: WeaponDef, muzzle: THREE.Vector3) {
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const maxD = 400;
    // Gunfire alerts enemies within acoustic range (suppressed weapons drastically cut range, loud guns draw nearby guards!)
    const { radius: shotRadius, suppressed } = this.gunshotNoise(def);
    reportNoise(ox, oz, suppressed ? 0.35 : clamp(shotRadius / 50, 0.85, 1.5));
    for (const e of this.enemies) {
      if (e.alive) e.hearShot(ox, oy, oz, shotRadius, suppressed, this.env, 'shot');
    }
    const worldHit = this.world.raycast(ox, oy, oz, dir.x, dir.y, dir.z, maxD, _hit);
    let wallT = worldHit ? _hit.t : maxD;
    // training targets stop the bullet like a wall
    const tHit = this.targets.list.length ? this.targets.ray(origin, dir, wallT) : null;
    if (tHit) wallT = tHit.t;
    const pierce = def.family === 'dmr' ? 3 : 1;
    let power = 1;
    let endT = wallT;
    let anyHit = false, anyKill = false, anyHead = false;
    const done: Enemy[] = [];
    for (let n = 0; n < pierce; n++) {
      let best: Enemy | null = null;
      let bt = wallT;
      for (const e of this.enemies) {
        if (!e.alive || done.includes(e)) continue;
        const t = e.rayHit(ox, oy, oz, dir.x, dir.y, dir.z, bt);
        if (t >= 0 && t < bt) {
          bt = t;
          best = e;
        }
      }
      if (!best) break;
      // rayHit() overwrote hitPart on every tested enemy; re-evaluate the winner
      best.rayHit(ox, oy, oz, dir.x, dir.y, dir.z, wallT);
      done.push(best);
      const part = best.hitPart;
      const hm = this.player.hexMods;
      const berserk = hm.berserkMaxBonus > 0 ? 1 + (1 - clamp(this.player.health / this.player.maxHealth, 0, 1)) * hm.berserkMaxBonus : 1;
      const fall = bt <= def.falloffStart ? 1 : bt >= def.falloffEnd ? def.falloffMin : 1 - ((bt - def.falloffStart) / (def.falloffEnd - def.falloffStart)) * (1 - def.falloffMin);
      const mult = part === 'head' ? def.headMult * hm.headMult : part === 'limb' ? def.limbMult : 1;
      const dmg = def.damage * fall * mult * power * hm.dmgMult * berserk;
      _a.set(ox + dir.x * bt, oy + dir.y * bt, oz + dir.z * bt);
      const killed = best.damage(dmg, dir, this.env);
      this.fx.blood(_a, dir, killed || part === 'head');
      audio.playAt('imp_flesh', _a, { vol: part === 'head' ? 0.88 : 0.78, rateVar: 0.1, refDist: 14 });
      // Hextech Prismatic Arc Core: every Nth hit triggers mini electric shockwave blast!
      if (hm.explosiveEveryN > 0 && ++this.hexShotCounter >= hm.explosiveEveryN) {
        this.hexShotCounter = 0;
        this.fx.explosion(_a, 0.45);
        this.r.flash(_a, 0x38e4ff, 260, 0.18, 18);
        audio.playAt('explosion', _a, { vol: 0.55, rate: 1.5, refDist: 14 });
        for (const oe of this.enemies) {
          if (!oe.alive || oe === best) continue;
          if (oe.pos.distanceTo(_a) < 4.8) {
            if (oe.damage(58 * hm.dmgMult, dir, this.env)) this.onKill(oe, false, '电磁爆裂');
          }
        }
      }
      anyHit = true;
      if (part === 'head') anyHead = true;
      if (killed) {
        anyKill = true;
        this.onKill(best, part === 'head', '击毙');
      }
      power *= 0.6;
      if (n === pierce - 1) endT = bt;
    }
    // rounds cracking past the squad pin them behind cover & snap unalerted sentries into combat alert!
    for (const e of this.enemies) {
      if (!e.alive || done.includes(e)) continue;
      e.chest(_a).sub(origin);
      const along = _a.dot(dir);
      if (along <= 0 || along >= Math.min(wallT, endT + 0.5)) continue;
      const perp = Math.sqrt(Math.max(0, _a.lengthSq() - along * along));
      if (perp < 2.2) {
        e.hearShot(ox, oy, oz, 999, false, this.env, 'shot');
        if (perp < 1.7) e.suppress();
      }
    }
    if (endT === wallT && tHit) {      const t = tHit.target;
      const wasUp = t.raised;
      this.targets.shoot(tHit, dir);
      const steel = t.kind === 'steel';
      this.fx.impact(tHit.point, tHit.normal, steel ? 'metal' : t.kind === 'dummy' ? 'fabric' : 'wood', false);
      if (!steel) audio.playAt(t.kind === 'dummy' ? 'imp_dirt' : 'imp_wood', tHit.point, { vol: 0.6, rateVar: 0.15, refDist: 6 });
      anyHit = true;
      anyKill = wasUp && t.down;
      anyHead = tHit.zone === 'head' && t.kind !== 'steel';
    }
    if (anyHit) {
      this.player.hits++;
      this.hud.hitmarker(anyKill, anyHead);
      if (!tHit || endT !== wallT) {
        if (anyHead) {
          audio.play('headshot', { vol: 0.82, rateVar: 0.04 });
        } else {
          audio.play('hit', { vol: anyKill ? 0.80 : 0.68, rate: anyKill ? 0.94 : 1.0, rateVar: 0.06 });
        }
      }
    }
    if (worldHit && endT === wallT && !tHit) {
      const tag = _hit.collider ? _hit.collider.tag : null;
      if (tag instanceof Barrel) {
        this.fx.impact(_hit.point, _hit.normal, 'metal', false);
        tag.damage(def.damage);
      } else {
        this.fx.impact(_hit.point, _hit.normal, _hit.surface, true);
      }
      audio.playAt(impactSound(_hit.surface), _hit.point, { vol: 0.65, rateVar: 0.15, refDist: 6 });
      if (_hit.surface === 'metal' && Math.random() < 0.3) audio.playAt('ricochet', _hit.point, { vol: 0.5, rateVar: 0.2, refDist: 8 });
      // Bullet impact/ricochet near a guard triggers cautious '?' investigation (or '!' if repeated)
      const impRadius = suppressed ? 7.5 : 14.0;
      for (const e of this.enemies) {
        if (e.alive && !done.includes(e)) {
          e.hearShot(_hit.point.x, _hit.point.y, _hit.point.z, impRadius, true, this.env, 'impact');
        }
      }
    }
    _b.set(ox + dir.x * endT, oy + dir.y * endT, oz + dir.z * endT);
    if (endT > 1.2) this.fx.tracer(muzzle, _b, 450, 1.0);
  }

  playerMelee(origin: THREE.Vector3, dir: THREE.Vector3) {
    let best: Enemy | null = null;
    let bd = 2.4;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.chest(_a).sub(origin);
      const d = _a.length();
      if (d < bd && _a.dot(dir) / d > 0.55) {
        bd = d;
        best = e;
      }
    }
    if (best) {
      best.chest(_a);
      this.fx.blood(_a, dir, true);
      this.player.hits++;
      this.player.shots++;
      const killed = best.damage(220, dir, this.env);
      this.hud.hitmarker(killed, false);
      if (killed) this.onKill(best, false, '近战');
      return true;
    }
    const tm = this.targets.list.length ? this.targets.melee(origin, dir) : null;
    if (tm) {
      _a.copy(tm.pos);
      _a.y = origin.y - 0.25;
      _b.copy(dir).negate().setY(0).normalize();
      _a.addScaledVector(_b, 0.25);
      this.fx.impact(_a, _b, tm.kind === 'dummy' ? 'fabric' : 'wood', false);
      this.hud.hitmarker(tm.down, false);
      return true;
    }
    // hit a wall?
    if (this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 1.6, _hit)) {
      this.fx.impact(_hit.point, _hit.normal, _hit.surface, false);
      audio.playAt(impactSound(_hit.surface), _hit.point, { vol: 0.5, refDist: 4 });
      const tag = _hit.collider ? _hit.collider.tag : null;
      if (tag instanceof Barrel) tag.damage(20);
    }
    return false;
  }

  throwGrenade(pos: THREE.Vector3, vel: THREE.Vector3) {
    const g = new Grenade(pos, vel);
    this.grenades.push(g);
    this.r.scene.add(g.mesh);
  }

  explode(pos: THREE.Vector3, radius: number, damage: number) {
    const p = this.player;
    this.fx.explosion(pos, radius / 7.5);
    _a.copy(pos);
    _a.y += 0.7;
    this.r.flash(_a, 0xffa040, 900, 0.4, 50);
    const centre = _c.copy(_a);
    const dp = centre.distanceTo(p.eye);
    const occluded = !this.world.lineOfSight(centre, p.eye);

    audio.playAt('explosion', _a, { vol: 1.35, rateVar: 0.08, refDist: 22, reverb: 0.85, occluded });
    // Visceral sub-bass thump on detonation
    audio.playSubBass(45, 0.32, clamp(1.2 - dp / 28, 0.2, 1.0));
    // Explosions broadcast a massive acoustic alert across the combat area!
    reportNoise(pos.x, pos.z, 1.5);
    for (const e of this.enemies) {
      if (e.alive) e.hearShot(pos.x, pos.y, pos.z, 76, false, this.env, 'shot');
    }

    p.addShake(clamp(1.5 - dp / 26, 0, 1.3));
    if (dp < 14) {
      const u = this.r.final.uniforms;
      u.uFlash.value = Math.max(u.uFlash.value, clamp(0.55 - dp / 26, 0, 0.5));
    }
    // Shell-shock / ear tinnitus if explosion occurred in close proximity (< 10m)
    if (dp < 10 && !occluded) {
      audio.triggerTinnitus(clamp(1.0 - dp / 10, 0.3, 1.0), 3.2);
    }
    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.chest(_a);
      const d = _a.distanceTo(centre);
      if (d > radius) continue;
      if (d > 1.5 && !this.world.lineOfSight(centre, _a)) continue;
      const dmg = damage * Math.pow(1 - d / radius, 0.7);
      _b.subVectors(_a, centre).normalize();
      if (e.damage(dmg, _b, this.env)) {
        this.onKill(e, false, '爆炸');
        this.hud.hitmarker(true, false);
      } else this.hud.hitmarker(false, false);
    }
    if (this.targets.list.length) this.targets.blast(centre, radius, (a, b) => this.world.lineOfSight(a, b));
    // player
    if (p.alive) {
      _a.set(p.pos.x, p.pos.y + 1, p.pos.z);
      const d = _a.distanceTo(centre);
      if (d < radius && (d < 1.5 || this.world.lineOfSight(centre, _a))) p.damage(damage * 0.5 * Math.pow(1 - d / radius, 1.2), centre);
    }
    // chain reaction
    for (const b of this.barrels) {
      if (!b.alive || b.fuse >= 0) continue;
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d < radius * 0.85) {
        b.damage(999);
        b.fuse = rand(0.12, 0.4);
      }
    }
  }

  onToggleNvg(on: boolean) {
    this.highSeas?.onToggleNvg(on);
  }

  talkToNpc() {
    if (this.highSeas?.onTalk()) return;
    if (this.oilfieldMission?.onTalk()) return;
    if (this.tutorial?.onTalk()) return;
  }

  interact() {
    if (this.highSeas?.onInteract()) return;
    if (this.oilfieldMission?.onInteract()) return;
    const p = this.player;
    for (const s of this.supplies) {
      if (Math.hypot(s.x - p.pos.x, s.z - p.pos.z) > 2.6) continue;
      if (!s.ready) {
        this.hud.hint(`补给箱整备中 · ${Math.ceil(s.cooldown)} 秒`, 1.5);
        return;
      }
      p.refill();
      s.ready = false;
      s.cooldown = this.mode === 'training' ? 4 : 40;
      audio.play('pickup', { vol: 0.7 });
      audio.play('magin', { vol: 0.5, delay: 0.15 });
      this.hud.hint('弹药与手雷已补满', 2);
      this.tutorial?.onResupply();
      return;
    }
  }

  // -------------------------------------------------------------------------
  // frame
  // -------------------------------------------------------------------------
  private placeMenuCamera(dt: number) {
    this.menuT += dt;
    const cam = this.r.camera;
    this.lvl.menuCamera(this.menuT, cam);
    if (cam.fov !== 55) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
  }

  private updatePlaying(dt: number) {
    const p = this.player;
    const u = this.r.final.uniforms;
    const training = this.mode === 'training';
    this.time += dt;
    p.update(dt);

    this.env.playerAlive = p.alive;
    this.env.playerCrouch = p.crouch;
    resetEnemyPathBudget();
    for (const e of this.enemies) {
      if (!this.freezeAI || !e.alive) e.update(dt, this.env);
      else {
        // debug: hold a pose so models can be inspected
        e.model.root.position.copy(e.pos);
        e.model.root.rotation.y = e.yaw;
        e.model.update(dt, this.debugWalk, 0, 1, this.debugAim, 0);
      }
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].removed) {
        this.r.scene.remove(this.enemies[i].model.root);
        this.enemies[i].model.dispose();
        this.enemies.splice(i, 1);
      }
    }
    // cap the number of corpses
    let corpses = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive && ++corpses > 10 && e.deadT < 16) e.deadT = 16;
    }

    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g.update(dt, this.world)) {
        this.r.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        if (this.mode === 'highseas' && this.highSeas) this.highSeas.onFlashbangDetonate(g.pos);
        else this.explode(g.pos, 8 * Math.sqrt(this.player.hexMods.nadePowerMult), 260 * this.player.hexMods.nadePowerMult);
      }
    }
    for (const b of this.barrels) {
      if (b.fuse >= 0) {
        b.fuse -= dt;
        if (b.fuse < 0) {
          b.destroy();
          this.explode(b.pos, 7, 230);
        } else if (Math.random() < dt * 40) {
          // jet of flame from the breach
          this.fx.particles.emit(b.pos.x, b.pos.y + 0.7, b.pos.z, rand(-1, 1), rand(2, 5), rand(-1, 1), 0.25, 0.2, 0.6, 5, 3, 1.2, 1, 2, 1, 0.5, 0);
        }
      }
    }
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      const gone = b.update(dt);
      const near = p.alive && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 1.3 && Math.abs(b.pos.y - p.pos.y) < 1.5;
      if (near && p.giveAmmo()) {
        audio.play('pickup', { vol: 0.7 });
        this.hud.popup(0, '获得弹药', false);
        this.removeBox(b);
        this.boxes.splice(i, 1);
      } else if (gone) {
        this.removeBox(b);
        this.boxes.splice(i, 1);
      }
    }
    let prompt: string | null = null;
    for (const s of this.supplies) {
      if (!s.ready) {
        s.cooldown -= dt;
        if (s.cooldown <= 0) s.ready = true;
      }
      const ring = s.beacon.userData.ring as THREE.Mesh | undefined;
      if (ring) {
        const rm = ring.material as THREE.MeshBasicMaterial;
        rm.opacity = damp(rm.opacity, s.ready ? 0.5 : 0.07, 3, dt);
        const k = s.ready ? 1 + Math.sin(this.time * 2.6) * 0.05 : 0.9;
        ring.scale.setScalar(k);
      }
      if (p.alive && Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 2.6) prompt = s.ready ? '补给弹药' : `整备中 ${Math.ceil(s.cooldown)} 秒`;
    }
    const fPrompt = this.highSeas?.interactPrompt ?? this.highSeas?.worldPrompt ?? this.oilfieldMission?.interactPrompt ?? prompt;
    const ePrompt = this.highSeas?.talkPrompt ?? this.oilfieldMission?.talkPrompt ?? this.tutorial?.talkPrompt ?? null;
    if (fPrompt) this.hud.setInteract(fPrompt, 'F');
    else if (ePrompt) this.hud.setInteract(ePrompt, 'E');
    else this.hud.setInteract(null);
    this.multiKillT -= dt;
    this.updatePlantedC4s(dt);
    this.targets.update(dt);
    this.lvl.update?.(dt, this.time);

    if (training) this.tutorial?.update(dt);
    else if (this.mode === 'highseas') this.highSeas?.update(dt);
    else if (this.mode === 'oilfield') this.oilfieldMission?.update(dt);
    else if (p.alive) this.updateWaves(dt);
    if (!p.alive) {
      this.deathT += dt;
      u.uFade.value = clamp((this.deathT - 1.6) / 1.6, 0, 0.85);
      if (this.deathT > 3.2 && this.state === 'playing') this.finishDeath();
    }

    // screen feedback
    u.uDamage.value = damp(u.uDamage.value, 0, 2.2, dt);
    u.uFlash.value = damp(u.uFlash.value, 0, 3.5, dt);
    const low = p.alive ? clamp(1 - p.health / 45, 0, 1) : 1;
    u.uLowHealth.value = damp(u.uLowHealth.value, low, 5, dt);
    u.uFocus.value = p.ads;
    if (p.alive) {
      this.fadeIn = Math.max(0, this.fadeIn - dt * (training ? 0.45 : 0.9));
      u.uFade.value = this.fadeIn;
    }

    // HUD
    const hud = this.hud;
    const a = p.ammo[p.weapon];
    hud.setWeapon(p.weapon, a.mag, a.reserve);
    hud.setGrenades(p.grenades, p.maxGrenades);
    hud.setHealth(p.health, p.maxHealth);
    const activeBoss = this.enemies.find((e) => e.alive && e.isBoss) ?? null;
    const bossTrack =
      activeBoss && (activeBoss.kind === 'boss_kronos' || activeBoss.kind === 'boss_viper' || activeBoss.kind === 'boss_tyrant')
        ? activeBoss.kind
        : null;
    audio.setBossMusic(bossTrack);
    hud.setBoss(
      activeBoss
        ? {
            name: activeBoss.stats.label,
            title: activeBoss.stats.bossTitle ?? '',
            hp: activeBoss.hp,
            maxHp: activeBoss.maxHp,
            phase: activeBoss.bossPhase,
            shield: activeBoss.bossShield,
            maxShield: activeBoss.bossMaxShield,
            skill: activeBoss.bossSkillLabel,
            kind: activeBoss.kind,
          }
        : null,
    );
    const pxPerRad = window.innerHeight / 2 / Math.tan((this.r.camera.fov * Math.PI) / 360);
    hud.setCrosshair(4 + Math.tan((p.spread * Math.PI) / 180) * pxPerRad, p.alive ? clamp(1 - p.ads * 2.2, 0, 1) * (1 - p.sprint * 0.7) : 0);
    this.blips.length = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const alert: 0 | 1 | 2 = e.stealthIdle ? (e.suspicionT > 0 ? 1 : 0) : 2;
      const alertPulse = e.alertIconT > 0 ? clamp(e.alertIconT / 2.2, 0, 1) : 0;
      this.blips.push({ x: e.pos.x, z: e.pos.z, hot: clamp(1 - e.sinceShot / 1.5, 0, 1), alert, alertPulse });
    }
    this.iffMarkers.length = 0;
    if (this.highSeas) this.highSeas.getFriendlyMarkers(this.iffMarkers, p.pos);
    else if (this.oilfieldMission) this.oilfieldMission.getFriendlyMarkers(this.iffMarkers);
    else if (this.tutorial) this.tutorial.getFriendlyMarkers(this.iffMarkers, p.pos);
    for (const f of this.iffMarkers) {
      if (f.role === 'ally') this.blips.push({ x: f.x, z: f.z, hot: 0, friendly: true });
    }
    this.boxDots.length = 0;
    for (const b of this.boxes) this.boxDots.push({ x: b.pos.x, z: b.pos.z });
    hud.update(dt, p.yaw, p.pos.x, p.pos.z, this.blips, this.supplies, this.boxDots);
    hud.updateWaypoint(this.r.camera, p.eye);
    hud.updateFriendlies(this.r.camera, p.eye, this.iffMarkers);
    audio.update(dt, true, p.alive ? low : 0);
  }

  /** Debug only: advance the simulation synchronously by `seconds` in fixed 60 Hz steps. */
  debugStep(seconds: number) {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) {
      this.updatePlaying(1 / 60);
      this.fx.update(1 / 60, this.r.camera);
      this.input.endFrame();
    }
  }

  debugAudioState() {
    return audio.getBgmDebugState();
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = clamp(raw, 0.0005, 0.05) * this.debugTimeScale * (this.highSeas?.timeScale ?? 1);
    this.frameMs += (raw * 1000 - this.frameMs) * 0.05;
    const cam = this.r.camera;

    if (this.state === 'loading') {
      this.input.endFrame();
      return;
    }
    if (this.state === 'paused' || this.hexChoosing) {
      // keep presenting the frozen scene (cheap) so resizes still work while picking Hextech cards
      this.r.render(0, this.player.pos);
      this.input.endFrame();
      return;
    }
    if (this.state === 'debrief') {
      // the world keeps breathing behind the results card
      this.lvl.update?.(dt, (this.time += dt));
      this.targets.update(dt);
      this.fx.update(dt, cam);
      const u = this.r.final.uniforms;
      u.uFocus.value = damp(u.uFocus.value, 0.8, 3, dt);
      audio.update(dt, false, 0);
      this.r.render(dt, this.player.pos);
      this.input.endFrame();
      return;
    }
    if (this.state === 'menu') {
      this.placeMenuCamera(dt);
      this.vm.setVisible(false);
      this.lvl.update?.(dt, this.menuT);
      this.targets.update(dt);
      this.fx.update(dt, cam);
      const u = this.r.final.uniforms;
      u.uFade.value = damp(u.uFade.value, 0, 2, dt);
      u.uFocus.value = 0.6;
      audio.update(dt, false, 0);
      _a.set(cam.position.x * 0.5, 0, cam.position.z * 0.5);
      this.setListener();
      this.r.render(dt, _a);
    } else {
      // 'playing' and the death camera
      this.updatePlaying(dt);
      this.fx.update(dt, cam);
      this.setListener();
      if (this.debugCam) {
        const c = this.debugCam;
        cam.position.set(c.x, c.y, c.z);
        cam.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
        cam.fov = c.fov ?? 70;
        cam.updateProjectionMatrix();
        this.vm.setVisible(false);
        this.r.final.uniforms.uFade.value = 0;
        this.r.render(dt, _a.set(c.sx ?? c.x, 0, c.sz ?? c.z));
      } else this.r.render(dt, this.player.pos);
    }
    this.hud.setPerf(raw, this.frameMs, this.r.renderer.info.render.calls, this.r.getGpuInfo());
    this.input.endFrame();
  };

  private setListener() {
    const cam = this.r.camera;
    cam.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, _fwd, _up);
  }
}
