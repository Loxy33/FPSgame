import * as THREE from 'three';
import { audio } from './core/audio';
import { Action, Condition, Selector, Sequence } from './ai/bt';
import { hearNoise } from './ai/noise';
import { clipDuration, speak } from './core/voice';
import { angleDiff, clamp, rand } from './core/utils';
import { SoldierModel, type ModelKind } from './entities/soldier';
import type { FriendlyMarker } from './highSeas';
import type { HitHow, HitZone, Target } from './entities/targets';
import { WEAPONS, WEAPON_ORDER } from './entities/weapons';
import type { Game } from './game';
import { TRAIN, inRect, type Spot } from './world/training';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

export type TutorialStart = 'intro' | 'cqb';

/** A stationary instructor (or range shooter) using the friendly soldier model. */
class Npc {
  model: SoldierModel;
  yaw: number;
  aim = false;
  pitch = 0;
  /** Turn towards the player while this is > 0. */
  attend = 0;
  private scanT = Math.random() * 8;
  private flinchT = 0;

  constructor(public name: string, public spot: Spot, private scene: THREE.Scene, y = 0, public kind: ModelKind = 'friendly') {
    this.model = new SoldierModel(kind);
    this.yaw = spot.yaw;
    this.model.root.position.set(spot.x, spot.y ?? y, spot.z);
    this.model.root.rotation.y = spot.yaw;
    scene.add(this.model.root);
  }

  moveTo(s: Spot, y = 0) {
    this.spot = s;
    this.yaw = s.yaw;
    this.model.root.position.set(s.x, s.y ?? y, s.z);
  }

  /** Friendly NPC behaviour: talk to the player, react to gunfire, otherwise scan the post. */
  private readonly brain = new Selector<NpcBB>([
    // 1. being spoken to: face the player
    new Sequence<NpcBB>([
      new Condition<NpcBB>((b) => b.npc.attend > 0),
      new Action<NpcBB>((b) => {
        b.npc.turnTo(b.player.x, b.player.z, 5);
        return 'running';
      }),
    ]),
    // 2. a shot went off nearby: snap towards it, flinch if it was close
    new Action<NpcBB>((b) => {
      const p = b.npc.model.root.position;
      const noise = hearNoise(p.x, p.z, 34, 3.5);
      if (!noise) return 'failure';
      b.npc.turnTo(noise.x, noise.z, 7);
      const d = Math.hypot(noise.x - p.x, noise.z - p.z);
      if (d < 12 && b.npc.flinchT <= 0) {
        b.npc.flinchT = 0.9;
        b.npc.model.flinch(0.45);
        b.npc.aim = true;
      }
      return 'running';
    }),
    // 3. idle: slow scan around the post so the camp feels alive
    new Action<NpcBB>((b) => {
      b.npc.scanT += b.dt;
      const want = b.npc.spot.yaw + Math.sin(b.npc.scanT * 0.42) * 0.5;
      b.npc.turnToYaw(want, 1.6);
      return 'running';
    }),
  ]);

  private turnTo(x: number, z: number, speed: number) {
    const r = this.model.root.position;
    this.turnToYaw(Math.atan2(x - r.x, z - r.z), speed);
  }

  private turnToYaw(want: number, speed: number) {
    this.yaw += angleDiff(this.yaw, want) * Math.min(1, speed * 0.016);
    this.model.root.rotation.y = this.yaw;
  }

  update(dt: number, player: THREE.Vector3) {
    if (this.attend > 0) this.attend -= dt;
    this.flinchT = Math.max(0, this.flinchT - dt);
    this.brain.tick({ npc: this, player, dt }, dt);
    this.model.root.rotation.y = this.yaw;
    const talking = this.attend > 0 && !this.aim && this.kind !== 'shooter';
    this.model.update(dt, 0, 0, 1, this.aim, this.pitch, false, 0, talking ? 'briefing' : 'combat');
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.model.dispose();
  }
}

interface NpcBB {
  npc: Npc;
  player: THREE.Vector3;
  dt: number;
}

interface Shooter {
  npc: Npc;
  targets: Target[];
  cur: Target | null;
  cool: number;
  burst: number;
}

interface Waiter {
  gen: number;
  cond: () => boolean;
  resolve: () => void;
}

const GRADES = ['S', 'A', 'B', 'C', 'D'];

export class Tutorial {
  /** Game time since the tutorial started (s). */
  t = 0;
  stage = '';
  /** Dynamic [E] conversation prompt when player stands near a camp NPC. */
  talkPrompt: string | null = null;
  private gen = 0;
  private waits: Waiter[] = [];
  private npcs: Npc[] = [];
  private byName = new Map<string, Npc>();
  private talkTarget: Npc | null = null;
  private talkIdx = new Map<string, number>();
  private talkSubTimer = 0;
  private talkCooldown = 0;
  private shooters: Shooter[] = [];
  private rangeHot = false;
  private rangeT = 4;
  private lineT = 0;
  private remindT = 0;
  private resupplied = false;
  private nadeOnly = false;
  private nadeGift = 0;
  /** Range lessons in progress: wandering off the firing point brings up a reminder. */
  private atLane = false;
  private lastMelee = -9;
  // obstacle course
  private course = { state: 'idle' as 'idle' | 'armed' | 'running' | 'done', t: 0, prompt: 0 };
  // kill house
  private cqb = {
    state: 'idle' as 'idle' | 'armed' | 'running' | 'done',
    t: 0, triggered: new Set<string>(), civ: 0, run: 0, shots: 0, hits: 0,
  };
  onFinish: (s: import('./ui/hud').DebriefStats) => void = () => {};

  constructor(private g: Game) {}

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------
  start(from: TutorialStart = 'intro') {
    this.dispose();
    const g = this.g, scene = g.r.scene;
    this.gen++;
    this.t = 0;
    const add = (name: string, s: Spot, y = 0, kind: ModelKind = 'friendly') => {
      const n = new Npc(name, s, scene, y, kind);
      this.npcs.push(n);
      this.byName.set(name, n);
      return n;
    };
    add('韩军士长', TRAIN.sergeant, 0, 'instructor');
    add('刘上士', TRAIN.rangeOfficer, 0.1, 'guard');
    add('王中士', TRAIN.nadeOfficer, 0, 'eod');
    add('李教官', TRAIN.courseOfficer, 0, 'instructor');
    add('赵教官', TRAIN.cqb.officer, 0, 'marine_lead');
    add('孙班长', TRAIN.cqb.catwalk, 0, 'guard');
    add('周军医', { x: 26.0, z: 6.4, yaw: -2.2 }, 0, 'medic');
    for (const s of TRAIN.shooters) {
      const n = add(`射手${s.lane}`, { x: s.x + rand(-0.15, 0.15), z: s.z, yaw: rand(-0.06, 0.06) }, 0.1, 'shooter');
      n.aim = true;
      this.shooters.push({ npc: n, targets: g.targets.group(s.group), cur: null, cool: rand(0.5, 3), burst: 0 });
    }
    for (const t of g.targets.list) if (t.spec.group.startsWith('npc')) t.raise(rand(0, 2));
    this.course = { state: 'idle', t: 0, prompt: 0 };
    this.cqb = { state: 'idle', t: 0, triggered: new Set(), civ: 0, run: this.cqb.run, shots: 0, hits: 0 };
    this.rangeHot = false;
    this.rangeT = 3;
    this.atLane = this.nadeOnly = this.resupplied = false;
    this.remindT = 0;
    this.lastMelee = -9;
    const run = from === 'cqb' ? this.cqbStage(true) : this.script();
    run.catch((e) => console.error(e));
  }

  dispose() {
    this.gen++;
    this.waits.length = 0;
    for (const n of this.npcs) n.dispose();
    this.npcs.length = 0;
    this.byName.clear();
    this.shooters.length = 0;
    this.talkTarget = null;
    this.talkPrompt = null;
    this.talkSubTimer = 0;
  }

  /** Triggered when player presses [E] near any camp instructor, medic, guard, or shooter. */
  onTalk(): boolean {
    if (!this.talkTarget || this.talkCooldown > 0) return false;
    const npc = this.talkTarget;
    const p = this.p;
    const linesByNpc: Record<string, string[]> = {
      '韩军士长': [
        '动作利落点，铁砧营地不养闲人。按指示完成每一项科目，上战场多一分活命本钱。',
        '记住：按 [B] 可以现场微调枪械配件，按 [N] 切换改装槽位，找到最顺手的搭配再下场。',
        '体能、枪法、冷静的敌我识别——这三样缺一不可。继续推进吧！',
      ],
      '刘上士': [
        '瞄准射击讲究稳住呼吸，点射控枪比一梭子胡扫准得多。右键举枪对准靶心！',
        '后坐力往上跳时顺手往下压一点鼠标，三发短点射最适合中距离交火。',
        '4 号靶道随时为你留着，弹药管够，练出肌肉记忆再往下一关走。',
      ],
      '王中士': [
        '手雷拉环后别傻站着，算好抛物线往掩体后头灌！震撼弹和破片雷都是清房利器。',
        '注意安全距离，别把弹片崩回自己脚边。按 [G] 投掷，顺手还可以反弹墙面拐角。',
      ],
      '李教官': [
        '障碍场讲究节奏：矮墙按 [Space] 直接翻越，低铁丝网按 [C] 滑蹲穿过，全程保持冲刺！',
        '在实战里翻越掩体能救你的命——动作越连贯，暴露在敌方火线上的时间就越短。',
      ],
      '赵教官': [
        '突入屋里节奏要快，但枪口必须听脑子指挥：看清手里拿枪的敌靶再扣扳机，绝不许误伤人质！',
        '进门先切角扫清死角，善用点射和快速换弹。准备好就跨过门槛开始计时！',
      ],
      '孙班长': [
        '我在上方观察台全程记录你的突入路线和命中率。切角干脆点，别在门口犹犹豫豫。',
        '记住每个房间的死角位置，二楼和转角最容易藏靶。',
      ],
      '周军医': [
        '新兵，体能和心率都挺稳。战场急救第一准则：先确保火力压制，再进掩体包扎。',
        '有擦伤随时来医务帐篷找我，我给你随时检查状态，满血上阵！',
      ],
    };
    const pool = linesByNpc[npc.name] ?? [
      '正在进行实弹归零校准，靶场区注意枪口指向和安全线。',
      '风速平稳，50 米立姿胸环靶手感不错，你也去 4 号靶道试试吧。',
    ];
    let line: string;
    if (npc.name === '周军医' && p.health < 100) {
      p.health = 100;
      audio.play('pickup', { vol: 0.55 });
      this.g.hud.popup(0, '周军医医疗补给 · 生命值已恢复满额', false);
      line = '别硬撑，我帮你把擦伤处理好了——生命值已恢复满额，保持警惕！';
    } else if (npc.name === '王中士' && p.grenades < p.maxGrenades) {
      p.grenades = p.maxGrenades;
      audio.play('pickup', { vol: 0.6 });
      this.g.hud.popup(0, '王中士补给 · 手雷已补满', false);
      line = '手雷用完了？接着，再给你补满一袋，投弹注意抛物线和反弹角！';
    } else {
      const idx = this.talkIdx.get(npc.name) ?? 0;
      line = pool[idx % pool.length];
      this.talkIdx.set(npc.name, idx + 1);
    }
    npc.attend = Math.max(npc.attend, 5.2);
    this.talkCooldown = 0.65;
    const dur = Math.max(3.0, line.length * 0.115 + 0.8);
    this.talkSubTimer = dur;
    this.lineT++;
    this.g.hud.subtitle(npc.name, line);
    audio.play('ui_click', { vol: 0.32, rate: 1.15 });
    speak(npc.name, line, false);
    return true;
  }

  /** Friendly camp instructors & guards for clean 3A HUD IFF indicators. */
  getFriendlyMarkers(out: FriendlyMarker[], playerPos: THREE.Vector3) {
    for (const n of this.npcs) {
      if (n.name.startsWith('射手')) continue;
      const p = n.model.root.position;
      if (p.distanceToSquared(playerPos) > 42 * 42) continue;
      out.push({ x: p.x, y: p.y + 1.98 * n.model.scale, z: p.z, name: n.name, role: 'ally' });
    }
  }

  // -------------------------------------------------------------------------
  // scripting primitives
  // -------------------------------------------------------------------------
  private wait(cond: () => boolean) {
    const gen = this.gen;
    return new Promise<void>((resolve) => this.waits.push({ gen, cond, resolve }));
  }

  private sleep(s: number) {
    const end = this.t + s;
    return this.wait(() => this.t >= end);
  }

  /** Show a subtitle line; resolves when it has been on screen long enough to read. */
  private say(who: string, text: string, hold = 0, voiceText?: string) {
    const g = this.g;
    g.hud.subtitle(who, text);
    const n = this.byName.get(who);
    const isRadio = !n || this.p.pos.distanceTo(n.model.root.position) > 14;
    if (isRadio) audio.play('radio', { vol: 0.16 });
    const vText = voiceText ?? text;
    speak(who, vText, isRadio);
    // keep the subtitle up for the whole voice line, even when the read-time estimate is shorter
    const dur = Math.max(1.4 + text.length * 0.115 + hold, clipDuration(vText) + 0.45);
    if (n) n.attend = Math.max(n.attend, dur + 1);
    const id = ++this.lineT;
    const end = this.t + dur;
    return this.wait(() => this.t >= end).then(() => {
      if (this.lineT === id) g.hud.subtitle(null);
    });
  }

  private obj(stage: string, title: string, progress = '') {
    this.stage = stage;
    this.g.hud.setObjective(stage, title, progress);
  }

  private waypoint(x: number, z: number, label: string, y = 1.2) {
    this.g.hud.setWaypoint({ x, y, z }, label);
  }

  private done() {
    audio.play('objective', { vol: 0.55 });
  }

  private get p() {
    return this.g.player;
  }

  private near(x: number, z: number, r: number) {
    return Math.hypot(this.p.pos.x - x, this.p.pos.z - z) < r;
  }

  private standing(list: Target[]) {
    return this.g.targets.standing(list);
  }

  // -------------------------------------------------------------------------
  // the course of fire
  // -------------------------------------------------------------------------
  private async script() {
    const g = this.g, hud = g.hud, T = g.targets;
    const L = TRAIN.lane;
    hud.announce('序章 · 铁砧营地', '0600 时 · 雨后 · 新兵最终考核');
    this.obj('序章', '听从韩军士长的指示');
    await this.sleep(2.2);
    await this.say('韩军士长', '醒了？动作快点。开赴哈迪尔之前，这是你最后一次考核。');
    await this.say('韩军士长', '先活动活动——[W][A][S][D] 移动，鼠标观察四周。');
    this.obj('基础', '移动并观察四周');
    const start = this.p.pos.clone(), yaw0 = this.p.yaw;
    let turned = 0, lastYaw = yaw0;
    await this.wait(() => {
      turned += Math.abs(this.p.yaw - lastYaw);
      lastYaw = this.p.yaw;
      return (this.p.pos.distanceTo(start) > 2.5 && turned > 1.2) || this.t > 30;
    });
    this.done();

    await this.say('韩军士长', '行，腿脚还利索。靶场在南边，跟着标记走——按住 [Shift] 冲刺。');
    this.obj('射击训练', '前往 4 号靶道');
    this.waypoint(L.x, L.z, '4号靶道');
    hud.hint('按住 [Shift] 冲刺 · [C] 蹲下 · [Space] 跳跃', 6);
    await this.wait(() => inRect(TRAIN.laneZone, this.p.pos.x, this.p.pos.z));
    hud.setWaypoint(null);
    this.done();
    this.atLane = true;

    // --- hip fire ---
    const hip = T.group('hip');
    await this.say('刘上士', '4 号靶道，就是你。先练腰射——前面 8 米三个靶，不用开镜，直接打。');
    this.obj('第一课 · 腰射', '击倒 3 个近距离靶', '0/3');
    hip.forEach((t, i) => t.raise(0.2 + i * 0.25));
    await this.waitTargets(hip, '第一课 · 腰射', '击倒 3 个近距离靶');
    this.done();

    // --- aim down sights ---
    const ads = shuffle(T.group('ads'));
    await this.say('刘上士', '近的靠手感，远的靠瞄准。按住 [鼠标右键] 开镜，靶子一个一个起来。');
    this.obj('第二课 · 瞄准射击', '开镜击倒远距离靶', '0/5');
    for (let i = 0; i < ads.length; i++) {
      ads[i].raise(i === 0 ? 0.3 : 0.8);
      await this.wait(() => ads[i].down);
      this.obj('第二课 · 瞄准射击', '开镜击倒远距离靶', `${i + 1}/5`);
    }
    this.done();

    // --- reload ---
    await this.say('刘上士', '别等弹匣打空——有空档就按 [R] 换弹。现在换一个。');
    this.obj('第三课 · 换弹', '按 R 战术换弹');
    if (this.p.ammo[this.p.weapon].mag >= this.p.def.mag) hud.hint('弹匣是满的——先朝靶堤打几发，再按 [R]', 5);
    await this.wait(() => this.p.reloading);
    this.done();

    // --- marksman rifle ---
    const steel = T.group('steel');
    await this.sleep(1.2);
    await this.say('刘上士', '按 [2] 换 MK13 狙击步枪。七十到一百米，三块钢板。开镜，屏住气，一发一块。');
    this.obj('第四课 · 精确射击', '切换狙击步枪 [2]');
    await this.wait(() => this.p.weapon === 'awm');
    this.obj('第四课 · 精确射击', '击中 3 块钢板', '0/3');
    await this.wait(() => {
      const n = steel.filter((t) => t.hits > 0).length;
      this.obj('第四课 · 精确射击', '击中 3 块钢板', `${n}/3`);
      return n >= 3;
    });
    this.done();
    await this.say('刘上士', '叮——听见没？这就是命中的声音。');

    // --- pistol ---
    const pis = T.group('pistol');
    await this.say('刘上士', '主武器出故障的时候，别修，换枪。按 [3] 切手枪，快速击倒近处四个靶。');
    this.obj('第五课 · 副武器', '切换手枪 [3]');
    await this.wait(() => this.p.weapon === 'm1911');
    this.obj('第五课 · 副武器', '击倒 4 个近距离靶', '0/4');
    pis.forEach((t, i) => t.raise(0.15 + i * 0.12));
    await this.waitTargets(pis, '第五课 · 副武器', '击倒 4 个近距离靶');
    this.done();

    // --- resupply ---
    this.atLane = false;
    if (this.remindT > 0) hud.setWaypoint(null);
    await this.say('刘上士', '打空了就去补给箱补。走过去按 [F]。');
    this.obj('第六课 · 补给', '在补给箱处按 F 补充弹药');
    this.waypoint(TRAIN.rangeSupply.x, TRAIN.rangeSupply.z, '补给箱', 0.8);
    this.resupplied = false;
    await this.wait(() => this.resupplied);
    hud.setWaypoint(null);
    this.done();
    await this.say('刘上士', '射击课目合格。去西边投弹场，王中士在那等你。');

    // --- grenades ---
    const B = TRAIN.bay;
    this.obj('第七课 · 手榴弹', '前往投弹场');
    this.waypoint(B.x, B.z, '投弹场');
    await this.wait(() => inRect(TRAIN.bayZone, this.p.pos.x, this.p.pos.z));
    hud.setWaypoint(null);
    const nade = T.group('nade');
    await this.say('王中士', '看见坑里那三个靶了吗？按 [G] 投弹。抬高一点，让它飞过去——一颗手雷能放倒一片。');
    if (this.p.grenades < 2) this.p.grenades = this.p.maxGrenades;
    this.obj('第七课 · 手榴弹', '用手榴弹击倒 3 个靶', '0/3');
    this.nadeOnly = true;
    nade.forEach((t, i) => t.raise(0.2 + i * 0.2));
    await this.waitTargets(nade, '第七课 · 手榴弹', '用手榴弹击倒 3 个靶');
    this.nadeOnly = false;
    this.done();
    await this.say('王中士', '漂亮。下一项：障碍场，往北走到起点线。');

    // --- obstacle course ---
    const C = TRAIN.course;
    this.obj('第八课 · 障碍训练', '前往障碍场起点');
    this.waypoint(C.start.x, C.start.z, '起点');
    await this.wait(() => this.near(C.start.x, C.start.z, 4) || inRect(C.zone, this.p.pos.x, this.p.pos.z));
    hud.setWaypoint(null);
    await this.say('李教官', '冲刺、跳跃、钻杆、翻墙，全程计时。过了起点线就开始！');
    this.obj('第八课 · 障碍训练', '冲过起点线');
    this.course.state = 'armed';
    await this.wait(() => this.course.state === 'done');
    this.done();
    const ct = this.course.t;
    hud.setTimer(ct, true, '障碍计时');
    await this.say(
      '李教官',
      ct < 13 ? `${ct.toFixed(1)} 秒！可以啊，新兵。` : ct < 20 ? `${ct.toFixed(1)} 秒，还行。` : `${ct.toFixed(1)} 秒……到了前线你就是活靶子。`,
      0,
      ct < 13 ? '可以啊，新兵，这速度够快的！' : ct < 20 ? '时间还行，稳稳当当的。' : '太慢了……到了前线你就是活靶子。',
    );
    hud.setTimer(null);

    // --- melee ---
    const dummy = T.get('dummy');
    const d0 = dummy.hits;
    await this.say('李教官', '前面那个假人，近身了就别开枪——按 [V] 给它来一下。');
    this.obj('近战', '用 V 攻击假人');
    this.waypoint(TRAIN.dummy.x, TRAIN.dummy.z, '假人', 1.4);
    await this.wait(() => dummy.hits > d0 && this.lastMelee > this.t - 0.5);
    hud.setWaypoint(null);
    this.done();
    await this.say('李教官', '有那么点意思了。最后一项，突入屋。赵教官在门口等你。');

    await this.cqbStage(false);
  }

  /** Kill house: brief, run, debrief. */
  private async cqbStage(retry: boolean) {
    const g = this.g, hud = g.hud;
    const Q = TRAIN.cqb;
    this.obj('最终考核 · 突入屋', '前往 1 号突入屋');
    if (!retry) {
      this.waypoint(Q.stage.x, Q.stage.z, '突入屋');
      await this.wait(() => this.near(Q.stage.x, Q.stage.z, 3.5));
      hud.setWaypoint(null);
      await this.say('赵教官', '规矩很简单：红色持枪的是敌人，蓝色举手的是平民。');
      await this.say('赵教官', '漏一个敌人罚 5 秒，打错一个平民罚 10 秒。');
    } else {
      await this.sleep(0.6);
      await this.say('赵教官', '再来一次？靶子已经复位了。');
    }
    // fresh magazines for the run
    for (const id of WEAPON_ORDER) {
      this.p.ammo[id].mag = WEAPONS[id].mag;
      this.p.ammo[id].reserve = WEAPONS[id].reserve;
    }
    this.resetCqb();
    this.cqb.state = 'armed';
    this.obj('最终考核 · 突入屋', '清除所有敌方目标', '计时从跨过门槛开始');
    this.waypoint(Q.entry.x, Q.entry.z, '入口', 1.4);
    this.say('赵教官', '准备好了就进门。计时从你跨过门槛开始。');
    await this.wait(() => this.cqb.state === 'running');
    hud.setWaypoint(null);
    await this.wait(() => this.cqb.state === 'done');
    await this.finishCqb();
  }

  private resetCqb() {
    for (const t of this.g.targets.group('cqb')) t.reset();
    this.cqb.triggered.clear();
    this.cqb.t = 0;
    this.cqb.civ = 0;
  }

  private async finishCqb() {
    const g = this.g, hud = g.hud;
    const all = g.targets.group('cqb');
    const hostiles = all.filter((t) => t.kind === 'hostile');
    const killed = hostiles.filter((t) => t.down).length;
    const civ = all.filter((t) => t.kind === 'civilian' && t.hits > 0).length;
    const missed = hostiles.length - killed;
    const final = this.cqb.t + missed * 5 + civ * 10;
    const grade = civ === 0 && missed === 0 && final <= 24 ? 'S' : civ === 0 && final <= 32 ? 'A' : final <= 45 ? 'B' : final <= 65 ? 'C' : 'D';
    const gradeText = { S: '王牌突击手', A: '优秀', B: '合格', C: '勉强合格', D: '不合格 · 重新训练' }[grade]!;
    const shots = this.p.shots - this.cqb.shots, hits = this.p.hits - this.cqb.hits;
    hud.setTimer(final, true, missed || civ ? `含罚时 +${missed * 5 + civ * 10}s` : '突入计时');
    this.obj('最终考核 · 突入屋', '考核完成', `${grade} 级`);
    this.done();
    const lines: Record<string, string> = {
      S: '……我带过的新兵里，你是最快的一个。',
      A: '干净利落。到了哈迪尔也给我这么打。',
      B: '合格。但到了前线，敌人可不会站着等你。',
      C: '勉强过关。路上多琢磨琢磨。',
      D: '你这样上去就是送死。再来！',
    };
    if (civ > 0) await this.say('赵教官', `打中了 ${civ} 个平民。记住，真到了村子里，那是人命。`);
    else if (missed > 0) await this.say('赵教官', `漏了 ${missed} 个敌人——他们会从背后打你。`);
    await this.say('赵教官', lines[grade]);
    // records
    const bestT = Number(localStorage.getItem('redsand.best.cqb') || 0);
    const record = !bestT || final < bestT;
    if (record) localStorage.setItem('redsand.best.cqb', final.toFixed(2));
    const bestG = localStorage.getItem('redsand.best.grade');
    if (!bestG || GRADES.indexOf(grade) < GRADES.indexOf(bestG)) localStorage.setItem('redsand.best.grade', grade);
    this.cqb.run++;
    await this.sleep(0.6);
    this.onFinish({
      grade, gradeText, run: this.cqb.run, cqbTime: final, hostiles: killed, hostilesTotal: hostiles.length, civilians: civ,
      accuracy: shots > 0 ? clamp(hits / shots, 0, 1) : 0, total: this.t, record,
    });
  }

  /** Wait until every target in the list is down, keeping the objective's counter up to date. */
  private waitTargets(list: Target[], stage: string, title: string) {
    return this.wait(() => {
      const left = this.standing(list);
      this.obj(stage, title, `${list.length - left}/${list.length}`);
      return left === 0;
    });
  }

  // -------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------
  onTargetHit(t: Target, _zone: HitZone, how: HitHow) {
    if (how === 'npc') return;
    const g = this.g;
    if (how === 'melee') this.lastMelee = this.t;
    if (t.spec.group === 'nade' && this.nadeOnly && how !== 'blast') {
      t.raise(1.4);
      g.hud.hint('别用枪——用 [G] 手榴弹', 2.5);
      return;
    }
    if (t.spec.group === 'cqb' && this.cqb.state === 'running') {
      if (t.kind === 'civilian') {
        this.cqb.civ++;
        g.hud.popup(0, '误伤平民 +10 秒', true);
        this.say('孙班长', '平民！');
      }
    }
  }

  onResupply() {
    this.resupplied = true;
  }

  // -------------------------------------------------------------------------
  // per frame
  // -------------------------------------------------------------------------
  update(dt: number) {
    const g = this.g, p = this.p;
    this.t += dt;
    for (let i = this.waits.length - 1; i >= 0; i--) {
      const w = this.waits[i];
      if (w.gen !== this.gen) {
        this.waits.splice(i, 1);
        continue;
      }
      if (w.cond()) {
        this.waits.splice(i, 1);
        w.resolve();
      }
    }
    for (const n of this.npcs) n.update(dt, p.pos);
    this.talkCooldown = Math.max(0, this.talkCooldown - dt);
    if (this.talkSubTimer > 0) {
      this.talkSubTimer -= dt;
      if (this.talkSubTimer <= 0) g.hud.subtitle(null);
    }
    // Nearest talkable camp NPC within 4.4m for [E] conversation
    let bestNpc: Npc | null = null;
    let bestScore = Infinity;
    const camFwd = _d.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    for (const n of this.npcs) {
      const np = n.model.root.position;
      const dx = np.x - p.pos.x, dz = np.z - p.pos.z, dy = Math.abs(np.y - p.pos.y);
      const dist = Math.hypot(dx, dz);
      if (dist > 4.4 || dy > 2.2) continue;
      const dot = dist > 0.05 ? (dx * camFwd.x + dz * camFwd.z) / dist : 1;
      if (dot < -0.15 && dist > 1.8) continue;
      const score = dist - dot * 2.2;
      if (score < bestScore) { bestScore = score; bestNpc = n; }
    }
    this.talkTarget = bestNpc;
    this.talkPrompt = bestNpc ? `与 ${bestNpc.name} 对话交流` : null;
    this.updateRange(dt);
    this.updateCourse(dt);
    this.updateCqb(dt);

    // training rules: endless reserve ammo, a grenade top-up during the grenade lesson
    for (const id of WEAPON_ORDER) {
      const a = p.ammo[id];
      if (a.reserve < WEAPONS[id].mag) a.reserve = WEAPONS[id].reserve;
    }
    if (this.nadeOnly && p.grenades === 0) {
      this.nadeGift += dt;
      if (this.nadeGift > 1.5) {
        this.nadeGift = 0;
        p.grenades = 2;
        g.hud.hint('王中士又递给你两颗手雷', 2.5);
      }
    }
    // wandering off during a range lesson: point back to the lane
    const off = this.atLane && !inRect(TRAIN.laneZone, p.pos.x, p.pos.z);
    if (off) {
      this.remindT += dt;
      if (this.remindT > 5 && !g.hud.waypoint) g.hud.setWaypoint({ x: TRAIN.lane.x, y: 1.2, z: TRAIN.lane.z }, '回到 4号靶道');
    } else if (this.remindT > 0) {
      this.remindT = 0;
      if (this.atLane) g.hud.setWaypoint(null);
    }
  }

  /** NPC shooters on the outer lanes: fire in strings, with cease-fire breaks. */
  private updateRange(dt: number) {
    const g = this.g;
    this.rangeT -= dt;
    if (this.rangeT <= 0) {
      this.rangeHot = !this.rangeHot;
      this.rangeT = this.rangeHot ? rand(14, 24) : rand(5, 9);
    }
    for (const s of this.shooters) {
      const m = s.npc.model;
      // keep the lane busy: knocked-down targets come back up after a while
      for (const t of s.targets) if (!t.want && t.delay <= 0) t.raise(rand(1.5, 4));
      if (!s.cur || !s.cur.raised) {
        const up = s.targets.filter((t) => t.raised);
        s.cur = up.length ? up[(Math.random() * up.length) | 0] : null;
        s.cool = Math.max(s.cool, rand(0.5, 1.3));
        s.burst = (Math.random() * 3) | 0;
      }
      s.npc.aim = this.rangeHot || s.cool < 1.5;
      if (s.cur) {
        const r = m.root.position;
        const tp = _p.copy(s.cur.pos);
        tp.y += 1.2;
        const dx = tp.x - r.x, dz = tp.z - r.z;
        s.npc.spot.yaw = Math.atan2(dx, dz);
        s.npc.pitch = Math.atan2(tp.y - (r.y + 1.45), Math.hypot(dx, dz));
      }
      s.cool -= dt;
      if (!this.rangeHot || !s.cur || s.cool > 0) continue;
      if (Math.abs(angleDiff(s.npc.yaw, s.npc.spot.yaw)) > 0.08) continue;
      // fire
      const muzzle = m.muzzle(_v);
      const tp = _p.copy(s.cur.pos);
      tp.y += rand(0.9, 1.5);
      _d.subVectors(tp, muzzle).normalize();
      g.fx.muzzle(muzzle, _d, 0.7);
      m.shotKick();
      audio.playAt('rifle', muzzle, { vol: 0.5, rateVar: 0.05, refDist: 9, reverb: 0.5 });
      if (Math.random() < 0.62) {
        if (s.cur.hit(_d, 'npc')) s.cur = null;
      } else {
        _v.set(s.cur.pos.x + rand(-0.8, 0.8), 0.05, s.cur.pos.z - rand(0.6, 1.4));
        g.fx.impact(_v, _p.set(0, 1, 0), 'sand', false);
      }
      if (s.burst > 0) {
        s.burst--;
        s.cool = rand(0.28, 0.5);
      } else {
        s.burst = (Math.random() * 3) | 0;
        s.cool = rand(0.9, 2.4);
      }
    }
  }

  private updateCourse(dt: number) {
    const c = this.course, C = TRAIN.course, hud = this.g.hud, p = this.p.pos;
    if (c.state === 'idle' || c.state === 'done') return;
    const inLane = p.x > C.zone.x0 && p.x < C.zone.x1;
    if (c.state === 'armed') {
      if (inLane && p.z < C.startZ && p.z > C.wall1) {
        c.state = 'running';
        c.t = 0;
        c.prompt = 0;
        audio.play('buzzer', { vol: 0.5 });
        this.obj('第八课 · 障碍训练', '冲刺通过所有障碍');
      } else return;
    }
    c.t += dt;
    hud.setTimer(c.t, false, '障碍计时');
    const prompts: [number, string][] = [
      [C.wall1 + 3.5, '矮墙 — 按 [Space] 跳过去'],
      [C.bars[0] + 3, '低杆 — 按 [C] 或 [Ctrl] 蹲下钻过去'],
      [C.tires + 4, '轮胎阵 — 冲过去！'],
      [C.wall2 + 3, '沙袋墙 — [Space] 翻越'],
    ];
    if (c.prompt < prompts.length && p.z < prompts[c.prompt][0]) {
      hud.hint(prompts[c.prompt][1], 2.5);
      c.prompt++;
    }
    if (p.z < C.finish && inLane) {
      c.state = 'done';
      audio.play('buzzer', { vol: 0.5, rate: 1.25 });
    }
    // went back out of the start: re-arm
    if (p.z > C.startZ + 1.5) {
      c.state = 'armed';
      hud.setTimer(null);
      hud.hint('回到起点线重新开始', 2);
    }
  }

  private updateCqb(dt: number) {
    const q = this.cqb, Q = TRAIN.cqb, g = this.g, p = this.p.pos;
    if (q.state === 'armed') {
      if (inRect(Q.house, p.x, p.z) && p.z < Q.entry.z - 0.2) {
        q.state = 'running';
        q.t = 0;
        q.shots = this.p.shots;
        q.hits = this.p.hits;
        audio.play('buzzer', { vol: 0.55 });
        this.obj('最终考核 · 突入屋', '清除所有敌方目标', '敌 0/8');
        // the CQB officer walks round to the exit while the trainee is inside
        this.byName.get('赵教官')?.moveTo(TRAIN.debrief);
      }
      return;
    }
    if (q.state !== 'running') return;
    q.t += dt;
    g.hud.setTimer(q.t, false, '突入计时');
    for (const room of Q.rooms) {
      if (q.triggered.has(room.name) || !inRect(room.rect, p.x, p.z)) continue;
      q.triggered.add(room.name);
      room.targets.forEach((id, i) => g.targets.get(id).raise(0.12 + i * 0.16 + Math.random() * 0.1));
    }
    const all = g.targets.group('cqb');
    const killed = all.filter((t) => t.kind === 'hostile' && t.down).length;
    this.obj('最终考核 · 突入屋', '清除所有敌方目标', `敌 ${killed}/8${q.civ ? ` · 误伤 ${q.civ}` : ''}`);
    // exit through the east door ends the run; backing out of the entry aborts it
    if (p.x > Q.exit.x + 0.35 && Math.abs(p.z - Q.exit.z) < 2) {
      q.state = 'done';
      audio.play('buzzer', { vol: 0.55, rate: 1.25 });
    } else if (p.z > Q.entry.z + 0.4) {
      q.state = 'armed';
      this.resetCqb();
      g.hud.setTimer(null);
      g.hud.hint('退出突入屋 — 靶子已复位，重新进门开始计时', 3);
      this.obj('最终考核 · 突入屋', '清除所有敌方目标', '计时从跨过门槛开始');
      this.byName.get('赵教官')?.moveTo(TRAIN.cqb.officer);
    }
  }
}

function shuffle<T>(a: T[]) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
