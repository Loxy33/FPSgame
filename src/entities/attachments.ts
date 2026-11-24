import type { SlotName, WeaponDef, WeaponId } from './weapons';

/** Stat changes an attachment applies on top of the weapon's base numbers. */
export interface AttachMods {
  /** Multiplier on camera recoil (1 = unchanged). */
  recoil?: number;
  /** Multiplier on spread (hip + ADS + movement). */
  spread?: number;
  /** Multiplier on hip-fire spread only. */
  hipSpread?: number;
  /** Multiplier on ADS time. */
  adsTime?: number;
  /** Multiplier on magazine capacity, rounded. */
  mag?: number;
  /** Multiplier on reload time. */
  reload?: number;
  /** Multiplier on muzzle volume / flash. */
  noise?: number;
  /** Multiplier on damage. */
  damage?: number;
  /** Extra ADS field-of-view multiplier (lower = more zoom). */
  adsFov?: number;
  /** Forces scope overlay (4x optic). */
  scope?: boolean;
}

export interface AttachmentDef {
  id: string;
  label: string;
  slot: SlotName;
  mods?: AttachMods;
  /** Height of the aiming axis above the rail, used to line the sight up in ADS. */
  sightH?: number;
  /** One-line trade-off shown in the gunsmith. */
  desc?: string;
}

export const ATTACHMENTS: Record<string, AttachmentDef> = {
  // ---------------------------------------------------------------- optics
  irons: { id: 'irons', label: '机械瞄具', slot: 'optic', desc: '原厂折叠机瞄，抬枪最快、视野开阔' },
  reddot: { id: 'reddot', label: '红点瞄具', slot: 'optic', mods: { adsTime: 0.94, spread: 0.95 }, sightH: 0.036, desc: '开镜快、视野通透无遮挡' },
  holo: { id: 'holo', label: '全息瞄具', slot: 'optic', mods: { adsTime: 0.97, spread: 0.9 }, sightH: 0.038, desc: '宽窗全息视场，精度更高' },
  scope4x: { id: 'scope4x', label: '4 倍瞄准镜', slot: 'optic', mods: { adsTime: 1.22, spread: 0.78, adsFov: 0.45, scope: true }, sightH: 0.038, desc: '4 倍中远距离放大，精确点射' },
  scope8x: { id: 'scope8x', label: '原厂 8 倍高倍镜', slot: 'optic', mods: { adsTime: 1.08, spread: 0.72, adsFov: 0.34, scope: true }, sightH: 0.045, desc: 'AWM 原生 8 倍高精度狙击镜，远距一击必杀' },

  // ---------------------------------------------------------------- muzzles
  none: { id: 'none', label: '无', slot: 'muzzle', desc: '不加装枪口附件' },
  comp: { id: 'comp', label: '制退器', slot: 'muzzle', mods: { recoil: 0.86, noise: 1.12 }, desc: '后坐 -14%，枪声更大' },
  supp: { id: 'supp', label: '消音器', slot: 'muzzle', mods: { recoil: 0.92, noise: 0.45, damage: 0.94, adsTime: 1.05 }, desc: '枪声大幅降低，伤害略降' },

  // ---------------------------------------------------------------- grips
  gnone: { id: 'gnone', label: '无', slot: 'grip', desc: '原厂护木，无额外重量' },
  angled: { id: 'angled', label: '斜角握把', slot: 'grip', mods: { spread: 0.88, adsTime: 0.95 }, desc: '散布 -12%，抬枪更快' },
  vertical: { id: 'vertical', label: '垂直握把', slot: 'grip', mods: { recoil: 0.84, adsTime: 1.06 }, desc: '后坐 -16%，抬枪变慢' },

  // ---------------------------------------------------------------- magazines
  std: { id: 'std', label: '标准弹匣', slot: 'mag', desc: '原厂容量，换弹最快' },
  ext: { id: 'ext', label: '扩容弹匣', slot: 'mag', mods: { mag: 1.5, reload: 1.12 }, desc: '弹容 +50%，换弹变慢' },

  // ---------------------------------------------------------------- barrels
  bstd: { id: 'bstd', label: '标准枪管', slot: 'barrel', desc: '原厂长度，各项均衡' },
  short: { id: 'short', label: '短枪管', slot: 'barrel', mods: { recoil: 1.15, spread: 1.12, adsTime: 0.88, damage: 0.94 }, desc: '抬枪更快、近距离更灵活，散布变大' },
  long: { id: 'long', label: '加长枪管', slot: 'barrel', mods: { recoil: 0.9, spread: 0.86, adsTime: 1.12, damage: 1.05 }, desc: '更稳更准，抬枪变慢' },

  // ---------------------------------------------------------------- stocks
  sstd: { id: 'sstd', label: '标准枪托', slot: 'stock', desc: '原厂枪托，均衡' },
  heavy: { id: 'heavy', label: '重型枪托', slot: 'stock', mods: { recoil: 0.78, spread: 0.92, adsTime: 1.15 }, desc: '大幅压制后坐，开镜更慢' },
  light: { id: 'light', label: '轻量枪托', slot: 'stock', mods: { recoil: 1.12, adsTime: 0.86 }, desc: '机动性优先，后坐更难控' },

  // ---------------------------------------------------------------- lasers
  lnone: { id: 'lnone', label: '无', slot: 'laser', desc: '不装战术附件，保持隐蔽' },
  laser: { id: 'laser', label: '激光指示器', slot: 'laser', mods: { hipSpread: 0.82 }, desc: '腰射散布 -18%，可见战术激光束' },
};

export const SLOT_DEFAULT: Partial<Record<SlotName, string>> = {
  optic: 'irons',
  muzzle: 'none',
  grip: 'gnone',
  mag: 'std',
  barrel: 'bstd',
  stock: 'sstd',
  laser: 'lnone',
};

/** Resolved numbers the player and HUD actually use. */
export interface WeaponStats {
  damage: number;
  rpm: number;
  mag: number;
  reserve: number;
  reloadTime: number;
  hipSpread: number;
  adsSpread: number;
  moveSpread: number;
  recoilPitch: number;
  recoilYaw: number;
  adsTime: number;
  adsFovMult: number;
  scope: boolean;
  soundVol: number;
  flashScale: number;
}

export function resolveStats(def: WeaponDef): WeaponStats {
  const m: AttachMods = {};
  for (const slot of def.slots) {
    const id = def.fitted[slot] ?? SLOT_DEFAULT[slot];
    const a = id ? ATTACHMENTS[id] : undefined;
    if (!a?.mods) continue;
    for (const [k, v] of Object.entries(a.mods) as [keyof AttachMods, number | boolean | undefined][]) {
      if (k === 'scope') continue;
      const cur = (m as Record<string, number>)[k];
      (m as Record<string, number>)[k] = cur === undefined ? (v as number) : k === 'adsFov' ? cur * (v as number) : cur * (v as number);
    }
    if (a.mods.scope) m.scope = true;
  }
  return {
    damage: def.damage * (m.damage ?? 1),
    rpm: def.rpm,
    mag: Math.round(def.mag * (m.mag ?? 1)),
    reserve: def.reserve,
    reloadTime: def.reloadTime * (m.reload ?? 1),
    hipSpread: def.hipSpread * (m.spread ?? 1) * (m.hipSpread ?? 1),
    adsSpread: def.adsSpread * (m.spread ?? 1),
    moveSpread: def.moveSpread * (m.spread ?? 1),
    recoilPitch: def.recoilPitch * (m.recoil ?? 1),
    recoilYaw: def.recoilYaw * (m.recoil ?? 1),
    adsTime: def.adsTime * (m.adsTime ?? 1),
    adsFovMult: def.adsFovMult * (m.adsFov ?? 1),
    scope: !!m.scope,
    soundVol: def.soundVol * (m.noise ?? 1),
    flashScale: def.flashScale * (m.noise ?? 1),
  };
}

/** Every attachment id available for a slot on this weapon. */
export function optionsFor(def: WeaponDef, slot: SlotName): string[] {
  if (slot === 'optic' && def.id === 'awm') {
    // AWM ships natively with its built-in 8x sniper scope, and can swap to 4x / holo / reddot / flip-up irons
    return ['scope8x', 'scope4x', 'holo', 'reddot', 'irons'];
  }
  const all = Object.values(ATTACHMENTS).filter((a) => a.slot === slot);
  return all.map((a) => a.id).filter((id) => {
    if (id === 'scope8x') return false; // native AWM high-power sniper optic only
    if (id === 'scope4x') return def.family !== 'pistol';
    return true;
  });
}

/** Copy of a weapon definition with the fitted attachments folded into its numbers. */
export function applyAttachments(def: WeaponDef): WeaponDef {
  const s = resolveStats(def);
  return {
    ...def,
    damage: s.damage,
    mag: s.mag,
    reloadTime: s.reloadTime,
    hipSpread: s.hipSpread,
    adsSpread: s.adsSpread,
    moveSpread: s.moveSpread,
    recoilPitch: s.recoilPitch,
    recoilYaw: s.recoilYaw,
    adsTime: s.adsTime,
    adsFovMult: s.adsFovMult,
    scope: s.scope,
    soundVol: s.soundVol,
    flashScale: s.flashScale,
    fitted: { ...def.fitted },
  };
}

const LOADOUT_KEY = 'redsand.loadout';
const FACTORY_DEFAULTS: Record<string, Partial<Record<SlotName, string>>> = {};

/** Captures each weapon's authored factory loadout once before saved overrides are applied. */
export function captureFactoryDefaults(defs: Record<string, WeaponDef>) {
  for (const [id, def] of Object.entries(defs)) {
    if (!FACTORY_DEFAULTS[id]) FACTORY_DEFAULTS[id] = { ...def.fitted };
  }
}

/** Restores a weapon to its true factory configuration (e.g. AWM -> native 8x scope). */
export function resetWeaponToDefault(def: WeaponDef) {
  const factory = FACTORY_DEFAULTS[def.id];
  for (const slot of def.slots) {
    def.fitted[slot] = factory?.[slot] ?? SLOT_DEFAULT[slot] ?? (slot === 'optic' ? 'irons' : slot === 'grip' ? 'gnone' : 'none');
  }
}

/** Applies the saved loadout over the weapon defaults (called before models are built). */
export function loadLoadout(defs: Record<string, WeaponDef>) {
  captureFactoryDefaults(defs);
  try {
    const raw = JSON.parse(localStorage.getItem(LOADOUT_KEY) || '{}') as Record<string, Partial<Record<SlotName, string>>>;
    for (const [id, fitted] of Object.entries(raw)) {
      const def = defs[id as WeaponId];
      if (!def || !fitted) continue;
      if (fitted.grip === 'none') fitted.grip = 'gnone';
      for (const slot of def.slots) {
        const val = fitted[slot];
        if (val && ATTACHMENTS[val]?.slot === slot && optionsFor(def, slot).includes(val)) {
          def.fitted[slot] = val;
        }
      }
    }
  } catch {
    /* corrupted save: keep the defaults */
  }
}

/** Stores every weapon's current fit. */
export function saveLoadout(defs: Record<string, WeaponDef>, order: WeaponId[]) {
  const out: Record<string, Partial<Record<SlotName, string>>> = {};
  for (const id of order) out[id] = { ...defs[id].fitted };
  localStorage.setItem(LOADOUT_KEY, JSON.stringify(out));
}

export const SLOT_LABEL: Record<SlotName, string> = {
  optic: '瞄具',
  muzzle: '枪口',
  grip: '握把',
  mag: '弹匣',
  barrel: '枪管',
  stock: '枪托',
  laser: '战术',
};
