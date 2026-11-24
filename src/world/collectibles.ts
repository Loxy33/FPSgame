import * as THREE from 'three';
import { makePropObject, type PropName } from '../render/assets';

export type IntelCategory = 'comms' | 'hardware' | 'dossier';

export interface CollectibleDef {
  id: string;
  code: string;
  title: string;
  category: IntelCategory;
  categoryLabel: string;
  clearance: string;
  timestamp: string;
  faction: string;
  zone: string;
  /** Normalized [x%, y%] position on the M/V Taishan SVG deck schematic (stern=left, bow=right). */
  mapPos: [number, number];
  summary: string;
  transcript: string[];
  analystNote: { who: string; text: string };
  pos: [number, number, number];
  rot: number;
  prop: PropName;
  scale?: number;
  score: number;
}

const STORAGE_KEY = 'redsand.collectibles.v1';

/** 6 Hand-Crafted Narrative & Forensic Collectibles across M/V Taishan ("泰山号"). */
export const HIGHSEAS_COLLECTIBLES: CollectibleDef[] = [
  {
    id: 'hs_radio_log',
    code: 'RS-01-COM',
    title: '加密海事电台日志',
    category: 'comms',
    categoryLabel: '通讯截获',
    clearance: '机密 · SECRET',
    timestamp: '202X-10-14 01:40 CST',
    faction: '未知雇佣兵先遣组',
    zone: 'Zone A · 右舷高架走道',
    mapPos: [22, 26],
    summary: '凌晨 01:40 截获的静默指令，证实劫匪提前掌握了“泰山号”航线与应答机关闭窗口。',
    transcript: [
      '[01:38:12] 信道 14-B 突发跳频脉冲，自动覆盖“泰山号”AIS 远洋应答机。',
      '[01:40:05] 截获短报文：“猎物已入风暴边缘，按 B 方案封锁底舱 3 号柜。严禁留下活口知晓芯片去向。”',
      '[01:41:19] 信号终止前曾向北纬 11° 某商用中继卫星握手确认。',
    ],
    analystNote: {
      who: '洞四·百灵',
      text: '普通海盗绝不可能在强热带风暴下同步压制军民双频 AIS——对方背后有国家级或跨国级电子战支持。',
    },
    pos: [10.0, 2.6, -56.0],
    rot: -0.4,
    prop: 'field_radio',
    scale: 1.15,
    score: 350,
  },
  {
    id: 'hs_merc_dogtag',
    code: 'RS-02-TAC',
    title: '无编号雇佣兵军籍箱',
    category: 'hardware',
    categoryLabel: '军械物证',
    clearance: '机密 · SECRET',
    timestamp: '202X-10-14 02:22 CST',
    faction: '大西洋外籍特勤承包商',
    zone: 'Zone A · 左舷集装箱暗道',
    mapPos: [20, 78],
    summary: '钛合金识别牌刻有“GHOST-09”，采用西方军规防腐蚀涂层，所属部队编号被激光彻底抹除。',
    transcript: [
      '物证检视：美标 5.56mm 穿甲弹箱内藏有一组未佩戴的黑色钛合金身份牌与夜视仪备件。',
      '铭文残留：代号“GHOST-09 / BLOOD O+”，原单位钢印经高功率光纤激光打磨消除。',
      '弹壳批号：Lake City 军工厂外贸特供批次，与南海周边武装组织常用弹药完全不符。',
    ],
    analystNote: {
      who: '洞二·铁锤',
      text: '全是清一色的西方特战现役硬货，却偏要在船底贴北方联邦批号的炸药——这帮杂碎摆明了想嫁祸！',
    },
    pos: [-12.2, 0.0, -56.5],
    rot: 0.35,
    prop: 'ammo_box',
    scale: 1.1,
    score: 350,
  },
  {
    id: 'hs_crew_manifest',
    code: 'RS-03-LOG',
    title: '大副加密特种舱单',
    category: 'dossier',
    categoryLabel: '绝密线索',
    clearance: '绝密 · TOP SECRET',
    timestamp: '202X-10-13 23:10 CST',
    faction: '大顺远洋集团 · 西北研究所',
    zone: 'Zone B · 1F 左舷船员宿舍',
    mapPos: [38, 76],
    summary: '记录 3 号特种货柜由西北研究所加封铅印，严禁境外港口开箱扫描，大副因拒交密钥遇害。',
    transcript: [
      '货运单号：TAISHAN-NW-003（最高优先级密押货柜，存放于主货舱北端 3 号加固位）。',
      '承运备注：“经云茹研究员签发紧急召回令，该批次 240 套军用通讯基带模块须原封运回国内拆解复检。”',
      '手写批注（大副遗留）：“新加坡中转站海关曾异常要求开柜查验，已被我以铅封条例拒绝。”',
    ],
    analystNote: {
      who: '洞幺·老高',
      text: '大副是条硬汉。他们在新加坡没能得手，才不得不派雇佣兵在公海强行登船毁尸灭迹。',
    },
    pos: [-12.2, 0.0, -27.2],
    rot: 0.6,
    prop: 'clipboard',
    scale: 1.35,
    score: 400,
  },
  {
    id: 'hs_bridge_freq',
    code: 'RS-04-SIG',
    title: '敌军卫星加密频段表',
    category: 'comms',
    categoryLabel: '通讯截获',
    clearance: '绝密 · TOP SECRET',
    timestamp: '202X-10-14 02:36 CST',
    faction: 'Epsilon（厄普西隆）全球电讯',
    zone: 'Zone B · 3F 全景舰桥海图桌',
    mapPos: [42, 50],
    summary: '指向“Epsilon（厄普西隆）全球电讯”中继频段，证明跨国承包商直接提供卫星下行通道。',
    transcript: [
      '舰桥海图桌缴获军规三防平板，锁屏前仍保持 Ka 波段高轨卫星双向遥测连接。',
      '频段授权签名：EPSILON-GLOBAL-RELAY #07（该公司同时负责我方部分民用与外贸卫星中继业务）。',
      '数据流向显示：敌方正在实时抽取 3 号货柜通讯模块的底层校验密钥并回传中亚地面站。',
    ],
    analystNote: {
      who: '西北通讯所·云茹',
      text: '这份频段表是铁证——厄普西隆并非单纯商业外包商，他们一直在利用供应链后门窃取核心频谱参数。',
    },
    pos: [0.0, 8.32, -22.2],
    rot: 0.0,
    prop: 'ph_laptop',
    scale: 0.95,
    score: 500,
  },
  {
    id: 'hs_chip_sample',
    code: 'RS-05-HW',
    title: '异常军用通讯芯片样本',
    category: 'hardware',
    categoryLabel: '军械物证',
    clearance: '特级物证 · CLASS-A',
    timestamp: '202X-10-14 02:48 CST',
    faction: '西北研究所召回批次',
    zone: 'Zone C · 底层主货舱左舷工位',
    mapPos: [64, 74],
    summary: '从备件箱取出的主控电路板，显微镜可见非原厂硬件级后门触发器，正是此行核心物证。',
    transcript: [
      '硬件检视：7nm 基带主板角落焊接有一枚未登记的微型射频旁路硅片（尺寸仅 1.2mm × 0.8mm）。',
      '触发机制：一旦收到特定 Ka 波段脉冲，旁路芯片将自动静默并泄露跳频种子与实时位置。',
      '铝热剂残迹表明雇佣兵接到死命令——哪怕沉船也不能让任何一片完好样本回到国内实验室。',
    ],
    analystNote: {
      who: '西北通讯所·云茹',
      text: '幸好你们在底层备件箱抢出了这块完好主板！只要带回研究所，我们 48 小时内就能反推出整条供应链黑手。',
    },
    pos: [-10.8, -6.0, 14.0],
    rot: 0.25,
    prop: 'ph_circuit_board',
    scale: 1.4,
    score: 450,
  },
  {
    id: 'hs_epsilon_drive',
    code: 'RS-06-FIN',
    title: '厄普西隆加密黑匣子',
    category: 'dossier',
    categoryLabel: '绝密线索',
    clearance: '绝密 · TOP SECRET',
    timestamp: '202X-10-14 02:57 CST',
    faction: '中亚离岸结算网络',
    zone: 'Zone D · 前甲板左舷逃生通道',
    mapPos: [84, 72],
    summary: '雇佣兵仓促撤离遗落的军规固态阵列，残留资金流向中亚离岸账户的加密结算哈希。',
    transcript: [
      '从倾斜甲板截获防水防震固态记录盒，外壳印有厄普西隆工程部条形码。',
      '残存区块日志：佣金分三笔汇往中亚某油田警备公司的空壳离岸账户，金额高达 480 万美元。',
      '下阶段坐标预警：加密目录末尾标注着中亚边境能源枢纽坐标——下一场风暴已经在那里酝酿。',
    ],
    analystNote: {
      who: '洞幺·老高',
      text: '船沉了，但线索链彻底串起来了。中亚油田——利刃小队，准备好下一场硬仗。',
    },
    pos: [-11.5, 0.0, 65.5],
    rot: -0.3,
    prop: 'medical_box',
    scale: 1.0,
    score: 450,
  },
];

export function loadCollectedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveCollectedIds(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore storage quota */
  }
}

interface ActiveItem {
  def: CollectibleDef;
  root: THREE.Group;
  ring: THREE.Mesh;
  diamond: THREE.Mesh;
  collected: boolean;
}

/**
 * Manages 3D physical collectibles, pulsing tactical holo-rings, proximity prompts,
 * and persistent dossier collection progress.
 */
export class CollectibleManager {
  readonly group = new THREE.Group();
  private items: ActiveItem[] = [];
  private collectedIds: Set<string>;

  constructor(defs: CollectibleDef[]) {
    this.collectedIds = loadCollectedIds();

    const ringGeo = new THREE.RingGeometry(0.28, 0.35, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38e4ff,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const diaGeo = new THREE.OctahedronGeometry(0.1, 0);
    const diaMat = new THREE.MeshBasicMaterial({ color: 0x56f0ff });

    for (const def of defs) {
      const done = this.collectedIds.has(def.id);
      const root = new THREE.Group();
      root.position.set(def.pos[0], def.pos[1], def.pos[2]);

      const obj = makePropObject(def.prop, def.scale ?? 1.0);
      obj.rotation.y = def.rot;
      root.add(obj);

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.04;
      root.add(ring);

      const diamond = new THREE.Mesh(diaGeo, diaMat);
      diamond.position.y = 0.58;
      root.add(diamond);

      // Zero-light-cost additive volumetric holo-beam marker (replaces per-item PointLight!)
      const beamGeo = new THREE.ConeGeometry(0.32, 0.95, 12, 1, true);
      beamGeo.translate(0, 0.48, 0);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x38e4ff,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      root.add(new THREE.Mesh(beamGeo, beamMat));

      root.visible = !done;
      this.group.add(root);
      this.items.push({ def, root, ring, diamond, collected: done });
    }
  }

  get total() {
    return this.items.length;
  }

  get count() {
    let n = 0;
    for (const it of this.items) if (it.collected) n++;
    return n;
  }

  has(id: string) {
    return this.collectedIds.has(id);
  }

  /** Animate uncollected beacons and return the nearest collectible prompt within 2.8m. */
  update(t: number, playerPos: THREE.Vector3): CollectibleDef | null {
    let best: CollectibleDef | null = null;
    let bestD = 2.8;

    for (const it of this.items) {
      if (it.collected) continue;
      it.ring.rotation.z = t * 1.4;
      const pulse = 0.92 + Math.sin(t * 3.8) * 0.14;
      it.ring.scale.setScalar(pulse);
      it.diamond.rotation.y = t * 2.2;
      it.diamond.position.y = 0.56 + Math.sin(t * 3.0) * 0.07;

      const dx = playerPos.x - it.def.pos[0];
      const dz = playerPos.z - it.def.pos[2];
      const dy = Math.abs(playerPos.y - it.def.pos[1]);
      if (dy > 1.8) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        best = it.def;
      }
    }
    return best;
  }

  /** Collect the nearest collectible within reach, persisting to localStorage. */
  tryCollect(playerPos: THREE.Vector3): CollectibleDef | null {
    let best: ActiveItem | null = null;
    let bestD = 2.8;
    for (const it of this.items) {
      if (it.collected) continue;
      const dy = Math.abs(playerPos.y - it.def.pos[1]);
      if (dy > 1.8) continue;
      const d = Math.hypot(playerPos.x - it.def.pos[0], playerPos.z - it.def.pos[2]);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    if (!best) return null;
    best.collected = true;
    best.root.visible = false;
    this.collectedIds.add(best.def.id);
    saveCollectedIds(this.collectedIds);
    return best.def;
  }
}
