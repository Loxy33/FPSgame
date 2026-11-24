/**
 * 海克斯模式（哈迪尔镇 · 三选一战术肉鸽强化系统）
 * 每通关一波弹出 3 张海克斯强化卡牌，分为「普通银 / 史诗金 / 棱彩炫」三大稀有度；
 * 每逢第 3/6/9… 波击败「赤沙暴君」BOSS 必定掉落 3 选 1 棱彩核心！
 */

export type HexTier = 'silver' | 'gold' | 'prismatic';

export interface HexMods {
  dmgMult: number;
  headMult: number;
  fireRateMult: number;
  reloadMult: number;
  moveMult: number;
  recoilMult: number;
  spreadMult: number;
  maxHpBonus: number;
  dmgReduce: number;
  killHeal: number;
  headHeal: number;
  magMult: number;
  nadeBonus: number;
  nadePowerMult: number;
  explosiveEveryN: number; // 0 = off, else every Nth shot triggers mini arc blast!
  cheatDeathCharges: number;
  berserkMaxBonus: number;
}

export interface HexAugment {
  id: string;
  name: string;
  en: string;
  tier: HexTier;
  icon: string;
  desc: string;
  statTag: string;
  apply(m: HexMods): void;
}

export function defaultHexMods(): HexMods {
  return {
    dmgMult: 1,
    headMult: 1,
    fireRateMult: 1,
    reloadMult: 1,
    moveMult: 1,
    recoilMult: 1,
    spreadMult: 1,
    maxHpBonus: 0,
    dmgReduce: 0,
    killHeal: 0,
    headHeal: 0,
    magMult: 1,
    nadeBonus: 0,
    nadePowerMult: 1,
    explosiveEveryN: 0,
    cheatDeathCharges: 0,
    berserkMaxBonus: 0,
  };
}

export const HEX_AUGMENTS: HexAugment[] = [
  // ---- SILVER (普通银 · 战术基础强化) ----
  {
    id: 'hex_ap_rounds', name: '穿甲钨芯弹', en: 'TUNGSTEN AP', tier: 'silver', icon: '◈',
    desc: '所有枪械基础伤害提升 24%，更容易击穿重甲单位。', statTag: '+24% 枪械伤害',
    apply: (m) => { m.dmgMult *= 1.24; },
  },
  {
    id: 'hex_quick_mag', name: '快拔战术弹匣', en: 'SLEIGHT OF HAND', tier: 'silver', icon: '↻',
    desc: '换弹速度加快 38%，并立即补满所有备用弹药。', statTag: '+38% 换弹速度',
    apply: (m) => { m.reloadMult *= 1.38; },
  },
  {
    id: 'hex_kevlar', name: '复合陶瓷插板', en: 'CERAMIC PLATE', tier: 'silver', icon: '⛨',
    desc: '最大生命值 +35，并立即恢复至满血。', statTag: '+35 生命上限',
    apply: (m) => { m.maxHpBonus += 35; },
  },
  {
    id: 'hex_sprint_rig', name: '轻量化突击装具', en: 'ASSAULT RIG', tier: 'silver', icon: '»',
    desc: '移动与冲刺速度 +18%，开镜移速更灵活。', statTag: '+18% 移动速度',
    apply: (m) => { m.moveMult *= 1.18; },
  },
  {
    id: 'hex_comp', name: '精密枪口制退器', en: 'PRECISION BRAKE', tier: 'silver', icon: '⊕',
    desc: '武器后坐力降低 32%，腰射与连射散布降低 28%。', statTag: '-32% 后坐力',
    apply: (m) => { m.recoilMult *= 0.68; m.spreadMult *= 0.72; },
  },

  // ---- GOLD (史诗金 · 高阶核心强化) ----
  {
    id: 'hex_overclock', name: '超频击发机构', en: 'OVERCLOCK BOLT', tier: 'gold', icon: '⚡',
    desc: '射速提升 26%，枪械伤害额外提升 15%。', statTag: '+26% 射速 · +15% 伤害',
    apply: (m) => { m.fireRateMult *= 1.26; m.dmgMult *= 1.15; },
  },
  {
    id: 'hex_vamp', name: '纳米战地吸血', en: 'NANO SIPHON', tier: 'gold', icon: '✚',
    desc: '每次击杀敌人立即回复 18 点生命值，极大增强持久续航。', statTag: '击杀回血 +18',
    apply: (m) => { m.killHeal += 18; },
  },
  {
    id: 'hex_headhunter', name: '致命弱点锁头', en: 'HEADHUNTER', tier: 'gold', icon: '⌖',
    desc: '爆头伤害倍率提升 45%，每次爆头额外回复 12 点生命。', statTag: '+45% 爆头伤害 · 回血',
    apply: (m) => { m.headMult *= 1.45; m.headHeal += 12; },
  },
  {
    id: 'hex_cluster_nade', name: '集束高爆手雷', en: 'CLUSTER ORDNANCE', tier: 'gold', icon: '✹',
    desc: '手雷携带上限 +2，爆炸伤害与冲击半径 +42%，每波自动补满。', statTag: '+2 手雷 · +42% 爆炸',
    apply: (m) => { m.nadeBonus += 2; m.nadePowerMult *= 1.42; },
  },
  {
    id: 'hex_ext_drum', name: '模块化扩容弹鼓', en: 'DRUM OVERLOAD', tier: 'gold', icon: '▤',
    desc: '所有主副武器弹匣容量 +45%，换弹速度 +20%。', statTag: '+45% 弹匣容量',
    apply: (m) => { m.magMult *= 1.45; m.reloadMult *= 1.20; },
  },
  {
    id: 'hex_exo_guard', name: '反应式外骨骼护盾', en: 'REACTIVE EXO', tier: 'gold', icon: '❖',
    desc: '所有所受伤害降低 22%，最大生命值 +25。', statTag: '22% 全伤害减免',
    apply: (m) => { m.dmgReduce = Math.min(0.65, m.dmgReduce + 0.22); m.maxHpBonus += 25; },
  },

  // ---- PRISMATIC (棱彩炫 · 终极蜕变强化) ----
  {
    id: 'hex_arc_core', name: '高能电磁爆裂弹药', en: 'EMP ARC ROUNDS', tier: 'prismatic', icon: '✦',
    desc: '每第 4 发命中触发高频电磁爆裂冲击波（范围高伤），且基础伤害 +38%！', statTag: '4发爆裂冲击 · +38% 伤害',
    apply: (m) => { m.explosiveEveryN = m.explosiveEveryN ? Math.min(m.explosiveEveryN, 3) : 4; m.dmgMult *= 1.38; },
  },
  {
    id: 'hex_berserk', name: '不屈赤沙狂战士', en: 'UNDYING BERSERKER', tier: 'prismatic', icon: '☠',
    desc: '生命越低枪械伤害越高（最高 +65%）；且获得 1 次免死复活（濒死瞬间回满血并震飞敌人）！', statTag: '最高 +65% 伤害 · 1次免死',
    apply: (m) => { m.berserkMaxBonus += 0.65; m.cheatDeathCharges += 1; m.killHeal += 10; },
  },
  {
    id: 'hex_rail_kit', name: '零后坐磁轨导引套件', en: 'MAG-RAIL MATRIX', tier: 'prismatic', icon: '✧',
    desc: '后坐力 -60%、散布 -55%、射速 +24%、枪械伤害 +35%——化身绝对激光炮台！', statTag: '极稳磁轨 · +35% 伤害',
    apply: (m) => { m.recoilMult *= 0.40; m.spreadMult *= 0.45; m.fireRateMult *= 1.24; m.dmgMult *= 1.35; },
  },
  {
    id: 'hex_juggernaut', name: '赤沙泰坦外骨骼', en: 'TITAN EXOSUIT', tier: 'prismatic', icon: '⬡',
    desc: '最大生命值 +80、全伤害减免 +25%、击杀回血 +20、移速 +15%，正面硬刚 BOSS！', statTag: '+80 生命 · 25% 减伤 · 吸血',
    apply: (m) => { m.maxHpBonus += 80; m.dmgReduce = Math.min(0.68, m.dmgReduce + 0.25); m.killHeal += 20; m.moveMult *= 1.15; },
  },
];

/** Roll 3 distinct augments for a wave clear (guaranteed 3 Prismatic options after defeating a Boss!). */
export function rollHexChoices(wave: number, bossKilled: boolean): HexAugment[] {
  const pool = [...HEX_AUGMENTS];
  const byTier = (t: HexTier) => pool.filter((a) => a.tier === t);
  const pickFrom = (arr: HexAugment[], used: Set<string>) => {
    const avail = arr.filter((a) => !used.has(a.id));
    const src = avail.length ? avail : pool.filter((a) => !used.has(a.id));
    const pick = src[Math.floor(Math.random() * src.length)];
    if (pick) used.add(pick.id);
    return pick;
  };

  const used = new Set<string>();
  const out: HexAugment[] = [];

  if (bossKilled) {
    // Guaranteed Prismatic triple choice after slaying a Boss!
    for (let i = 0; i < 3; i++) {
      const a = pickFrom(byTier('prismatic'), used);
      if (a) out.push(a);
    }
    return out;
  }

  // Dynamic rarity curve by wave number
  const prismChance = wave >= 4 ? 0.34 : wave >= 2 ? 0.16 : 0.08;
  const goldChance = wave >= 2 ? 0.56 : 0.35;
  for (let i = 0; i < 3; i++) {
    const r = Math.random();
    const tier: HexTier = r < prismChance ? 'prismatic' : r < prismChance + goldChance ? 'gold' : 'silver';
    const a = pickFrom(byTier(tier), used);
    if (a) out.push(a);
  }
  return out;
}
