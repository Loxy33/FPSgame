/** Attachment slot ids. Each weapon declares which slots it accepts. */
export type SlotName = 'optic' | 'muzzle' | 'grip' | 'mag' | 'barrel' | 'stock' | 'laser';

export type WeaponId = 'm4a1' | 'ak47' | 'scarl' | 'mp5a5' | 'awm' | 'm1911' | 'qbz192' | 'qsz193';
/** Animation family: every weapon reuses one of the three established viewmodel rigs. */
export type WeaponFamily = 'rifle' | 'dmr' | 'pistol';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Chinese class label shown in the HUD. */
  label: string;
  family: WeaponFamily;
  mode: 'auto' | 'semi' | 'bolt';
  modeLabel: string;
  damage: number;
  headMult: number;
  limbMult: number;
  rpm: number;
  mag: number;
  reserve: number;
  reloadTime: number;
  reloadSounds: [number, string][];
  reloadCommit: number;
  boltTime: number;
  hipSpread: number;
  adsSpread: number;
  moveSpread: number;
  bloomPerShot: number;
  bloomMax: number;
  recoilPitch: number;
  recoilYaw: number;
  kickBack: number;
  kickPitch: number;
  adsFovMult: number;
  adsTime: number;
  scope: boolean;
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  sound: string;
  soundVol: number;
  moveMult: number;
  shake: number;
  flashScale: number;
  hipPos: [number, number, number];
  hipRot: [number, number, number];
  adsPos: [number, number, number];
  /** hip = ads + hipOffset - hipCenter (per-model recentring, filled at build time) */
  hipOffset?: [number, number, number];
  hipCenter?: [number, number, number];
  /** grip points in gun-local metres, used to check hand placement */
  gripR?: [number, number, number];
  gripL?: [number, number, number];
  /** Uniform scale applied to the authored model. */
  modelScale: number;
  slots: SlotName[];
  fitted: Partial<Record<SlotName, string>>;
  /** Slot anchor points in model-local space (barrel toward -Z). */
  anchors: Partial<Record<SlotName, [number, number, number]>>;
  /** Muzzle position in model-local space. */
  muzzle: [number, number, number];
  /** Height of the sight line above the model origin, in model-local units. */
  sightY: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // --------------------------------------------------------------- 5.56 rifles
  m4a1: {
    id: 'm4a1', name: 'M4A1', label: '突击步枪', family: 'rifle',
    mode: 'auto', modeLabel: '全自动',
    damage: 34, headMult: 3.2, limbMult: 0.8, rpm: 800, mag: 30, reserve: 180,
    reloadTime: 2.15, reloadSounds: [[0.13, 'magout'], [0.34, 'cloth'], [0.6, 'magin'], [0.78, 'bolt']], reloadCommit: 0.66, boltTime: 0,
    hipSpread: 1.7, adsSpread: 0.1, moveSpread: 1.4, bloomPerShot: 0.32, bloomMax: 2.6,
    recoilPitch: 0.62, recoilYaw: 0.3, kickBack: 0.9, kickPitch: 1.0,
    adsFovMult: 0.74, adsTime: 0.2, scope: false,
    falloffStart: 35, falloffEnd: 90, falloffMin: 0.65,
    sound: 'rifle', soundVol: 0.75, moveMult: 1, shake: 0.5, flashScale: 1,
    hipPos: [0.1, -0.13, -0.46], hipRot: [0.03, 0.33, -0.1],
    adsPos: [0, -0.055, -0.24],
    modelScale: 0.55, slots: ['optic', 'muzzle', 'barrel', 'grip', 'stock', 'mag', 'laser'],
    fitted: { optic: 'reddot', muzzle: 'comp', barrel: 'bstd', grip: 'angled', stock: 'sstd', mag: 'std', laser: 'lnone' },
    anchors: { optic: [0, 0.13, -0.16], muzzle: [0, 0.05, -1.15], grip: [0, -0.12, -0.42], mag: [0, -0.05, -0.02] },
    muzzle: [0, 0.05, -1.15], sightY: 0.095,
  },
  scarl: {
    id: 'scarl', name: 'SCAR-L', label: '突击步枪', family: 'rifle',
    mode: 'auto', modeLabel: '全自动',
    damage: 36, headMult: 3.1, limbMult: 0.8, rpm: 650, mag: 30, reserve: 150,
    reloadTime: 2.25, reloadSounds: [[0.14, 'magout'], [0.36, 'cloth'], [0.62, 'magin'], [0.8, 'bolt']], reloadCommit: 0.67, boltTime: 0,
    hipSpread: 1.8, adsSpread: 0.1, moveSpread: 1.45, bloomPerShot: 0.35, bloomMax: 2.7,
    recoilPitch: 0.72, recoilYaw: 0.34, kickBack: 1.0, kickPitch: 1.1,
    adsFovMult: 0.74, adsTime: 0.21, scope: false,
    falloffStart: 38, falloffEnd: 95, falloffMin: 0.68,
    sound: 'rifle', soundVol: 0.78, moveMult: 0.99, shake: 0.54, flashScale: 1.05,
    hipPos: [0.1, -0.14, -0.47], hipRot: [0.03, 0.33, -0.1],
    adsPos: [0, -0.06, -0.24],
    modelScale: 0.55, slots: ['optic', 'muzzle', 'barrel', 'grip', 'stock', 'mag', 'laser'],
    fitted: { optic: 'holo', muzzle: 'comp', barrel: 'bstd', grip: 'vertical', stock: 'sstd', mag: 'std', laser: 'lnone' },
    anchors: { optic: [0, 0.14, -0.2], muzzle: [0, 0.05, -1.2], grip: [0, -0.12, -0.45], mag: [0, -0.05, -0.02] },
    muzzle: [0, 0.05, -1.2], sightY: 0.1,
  },
  ak47: {
    id: 'ak47', name: 'AK-47', label: '突击步枪', family: 'rifle',
    mode: 'auto', modeLabel: '全自动',
    damage: 40, headMult: 3.1, limbMult: 0.82, rpm: 600, mag: 30, reserve: 150,
    reloadTime: 2.35, reloadSounds: [[0.14, 'magout'], [0.36, 'cloth'], [0.62, 'magin'], [0.82, 'boltaction']], reloadCommit: 0.68, boltTime: 0,
    hipSpread: 2.1, adsSpread: 0.12, moveSpread: 1.6, bloomPerShot: 0.4, bloomMax: 3.2,
    recoilPitch: 0.92, recoilYaw: 0.42, kickBack: 1.15, kickPitch: 1.25,
    adsFovMult: 0.74, adsTime: 0.23, scope: false,
    falloffStart: 32, falloffEnd: 85, falloffMin: 0.6,
    sound: 'ak', soundVol: 0.8, moveMult: 0.97, shake: 0.62, flashScale: 1.1,
    hipPos: [0.1, -0.13, -0.46], hipRot: [0.03, 0.33, -0.1],
    adsPos: [0, -0.05, -0.24],
    modelScale: 0.62, slots: ['optic', 'muzzle', 'barrel', 'grip', 'stock', 'mag', 'laser'],
    fitted: { optic: 'irons', muzzle: 'none', barrel: 'bstd', grip: 'gnone', stock: 'sstd', mag: 'std', laser: 'lnone' },
    anchors: { optic: [0, 0.12, -0.18], muzzle: [0, 0.06, -1.1], grip: [0, -0.1, -0.4], mag: [0, -0.05, -0.02] },
    muzzle: [0, 0.06, -1.1], sightY: 0.088,
  },
  // --------------------------------------------------------------- SMG
  mp5a5: {
    id: 'mp5a5', name: 'MP5A5', label: '冲锋枪', family: 'rifle',
    mode: 'auto', modeLabel: '全自动',
    damage: 24, headMult: 2.8, limbMult: 0.8, rpm: 900, mag: 30, reserve: 180,
    reloadTime: 1.95, reloadSounds: [[0.15, 'magout'], [0.35, 'cloth'], [0.6, 'magin'], [0.78, 'bolt']], reloadCommit: 0.64, boltTime: 0,
    hipSpread: 1.5, adsSpread: 0.12, moveSpread: 1.1, bloomPerShot: 0.26, bloomMax: 2.2,
    recoilPitch: 0.42, recoilYaw: 0.24, kickBack: 0.68, kickPitch: 0.8,
    adsFovMult: 0.8, adsTime: 0.17, scope: false,
    falloffStart: 18, falloffEnd: 55, falloffMin: 0.5,
    sound: 'smg', soundVol: 0.68, moveMult: 1.06, shake: 0.36, flashScale: 0.85,
    hipPos: [0.1, -0.13, -0.45], hipRot: [0.03, 0.33, -0.1],
    adsPos: [0, -0.05, -0.22],
    modelScale: 0.56, slots: ['optic', 'muzzle', 'grip', 'stock', 'mag', 'laser'],
    fitted: { optic: 'reddot', muzzle: 'supp', grip: 'angled', stock: 'sstd', mag: 'std', laser: 'lnone' },
    anchors: { optic: [0, 0.115, -0.14], muzzle: [0, 0.05, -0.9], grip: [0, -0.1, -0.32], mag: [0, -0.05, -0.02] },
    muzzle: [0, 0.05, -0.9], sightY: 0.08,
  },
  // --------------------------------------------------------------- bolt-action
  awm: {
    id: 'awm', name: 'AWM', label: '狙击步枪', family: 'dmr',
    mode: 'bolt', modeLabel: '栓动',
    damage: 125, headMult: 3.4, limbMult: 0.85, rpm: 45, mag: 5, reserve: 25,
    reloadTime: 3.4, reloadSounds: [[0.14, 'magout'], [0.45, 'cloth'], [0.72, 'magin'], [0.9, 'bolt']], reloadCommit: 0.75, boltTime: 0.75,
    hipSpread: 4.2, adsSpread: 0.02, moveSpread: 3.2, bloomPerShot: 1.2, bloomMax: 4,
    recoilPitch: 3.4, recoilYaw: 0.5, kickBack: 2.6, kickPitch: 3.0,
    adsFovMult: 0.74, adsTime: 0.28, scope: true,
    falloffStart: 90, falloffEnd: 240, falloffMin: 0.95,
    sound: 'sniper', soundVol: 0.95, moveMult: 0.9, shake: 1.1, flashScale: 1.5,
    hipPos: [0.11, -0.14, -0.5], hipRot: [0.03, 0.33, -0.1],
    adsPos: [0, -0.12, -0.28],
    modelScale: 0.54, slots: ['optic', 'muzzle', 'barrel', 'stock', 'mag'],
    fitted: { optic: 'scope8x', muzzle: 'none', barrel: 'bstd', stock: 'sstd', mag: 'std' },
    anchors: { optic: [0, 0.2, -0.1], muzzle: [0, 0.165, -1.68], mag: [0, -0.05, -0.02] },
    muzzle: [0, 0.165, -1.68], sightY: 0.2,
  },
  // --------------------------------------------------------------- pistols
  m1911: {
    id: 'm1911', name: 'M1911', label: '手枪', family: 'pistol',
    mode: 'semi', modeLabel: '半自动',
    damage: 36, headMult: 2.8, limbMult: 0.8, rpm: 420, mag: 7, reserve: 49,
    reloadTime: 1.8, reloadSounds: [[0.16, 'magout'], [0.58, 'magin'], [0.82, 'bolt']], reloadCommit: 0.64, boltTime: 0,
    hipSpread: 1.3, adsSpread: 0.22, moveSpread: 0.9, bloomPerShot: 0.6, bloomMax: 2.8,
    recoilPitch: 1.25, recoilYaw: 0.32, kickBack: 1.1, kickPitch: 2.4,
    adsFovMult: 0.84, adsTime: 0.15, scope: false,
    falloffStart: 22, falloffEnd: 60, falloffMin: 0.5,
    sound: 'pistol', soundVol: 0.74, moveMult: 1.06, shake: 0.44, flashScale: 0.8,
    hipPos: [0.12, -0.12, -0.44], hipRot: [0.08, 0.1, -0.15],
    adsPos: [0, -0.06, -0.3],
    modelScale: 0.64, slots: ['muzzle', 'mag', 'laser'],
    fitted: { muzzle: 'none', mag: 'std', laser: 'lnone' },
    anchors: { muzzle: [0, 0.09, -0.35], mag: [0, -0.05, -0.02] },
    muzzle: [0, 0.09, -0.35], sightY: 0.13,
  },
  // --------------------------------------------------------------- PLA 191/192 Modular Family
  qbz192: {
    id: 'qbz192', name: 'QBZ-192', label: '短突击步枪', family: 'rifle',
    mode: 'auto', modeLabel: '5.8mm · 全自动',
    damage: 35, headMult: 3.3, limbMult: 0.82, rpm: 760, mag: 30, reserve: 180,
    reloadTime: 2.05, reloadSounds: [[0.13, 'magout'], [0.34, 'cloth'], [0.6, 'magin'], [0.78, 'bolt']], reloadCommit: 0.65, boltTime: 0,
    hipSpread: 1.5, adsSpread: 0.085, moveSpread: 1.2, bloomPerShot: 0.28, bloomMax: 2.3,
    recoilPitch: 0.56, recoilYaw: 0.24, kickBack: 0.82, kickPitch: 0.9,
    adsFovMult: 0.74, adsTime: 0.18, scope: false,
    falloffStart: 38, falloffEnd: 95, falloffMin: 0.68,
    sound: 'rifle', soundVol: 0.74, moveMult: 1.02, shake: 0.44, flashScale: 0.9,
    hipPos: [0.09, -0.105, -0.36], hipRot: [0.015, 0.04, -0.05],
    adsPos: [0, -0.095, -0.25],
    hipOffset: [0.085, -0.046, -0.085],
    modelScale: 1, slots: ['optic', 'muzzle', 'barrel', 'grip', 'stock', 'mag', 'laser'],
    fitted: { optic: 'holo', muzzle: 'supp', barrel: 'bstd', grip: 'angled', stock: 'sstd', mag: 'std', laser: 'laser' },
    anchors: {
      optic: [0, 0.068, -0.055],
      muzzle: [0, 0.024, -0.455],
      barrel: [0, 0.024, -0.445],
      grip: [0, -0.022, -0.26],
      mag: [0, -0.155, -0.085],
      stock: [0, 0.008, 0.245],
      laser: [0.026, 0.024, -0.31],
    },
    muzzle: [0, 0.024, -0.455], sightY: 0.096,
  },
  qsz193: {
    id: 'qsz193', name: 'QSZ-193', label: '微声手枪', family: 'pistol',
    mode: 'semi', modeLabel: '9mm · 半自动',
    damage: 34, headMult: 3.1, limbMult: 0.82, rpm: 460, mag: 15, reserve: 75,
    reloadTime: 1.65, reloadSounds: [[0.15, 'magout'], [0.54, 'magin'], [0.8, 'bolt']], reloadCommit: 0.62, boltTime: 0,
    hipSpread: 1.15, adsSpread: 0.16, moveSpread: 0.8, bloomPerShot: 0.48, bloomMax: 2.3,
    recoilPitch: 0.98, recoilYaw: 0.24, kickBack: 0.88, kickPitch: 1.9,
    adsFovMult: 0.84, adsTime: 0.14, scope: false,
    falloffStart: 25, falloffEnd: 65, falloffMin: 0.55,
    sound: 'pistol', soundVol: 0.68, moveMult: 1.07, shake: 0.36, flashScale: 0.72,
    hipPos: [0.088, -0.085, -0.36], hipRot: [0.015, 0.032, -0.035],
    adsPos: [0, -0.056, -0.31],
    hipOffset: [0.082, -0.044, -0.06],
    modelScale: 1, slots: ['muzzle', 'mag', 'laser'],
    fitted: { muzzle: 'supp', mag: 'std', laser: 'laser' },
    anchors: {
      muzzle: [0, 0.022, -0.175],
      mag: [0, -0.118, 0.028],
      laser: [0, -0.008, -0.115],
    },
    muzzle: [0, 0.022, -0.175], sightY: 0.054,
  },
};

/** Slot 2 is the scoped rifle and slot 3 the pistol, which the tutorial script expects. */
export const WEAPON_ORDER: WeaponId[] = ['m4a1', 'awm', 'm1911', 'ak47', 'scarl', 'mp5a5', 'qbz192', 'qsz193'];
/** Mission-specific authentic PLA Marine loadout for Mission 1: High Seas Interception. */
export const HIGHSEAS_WEAPONS: WeaponId[] = ['qbz192', 'qsz193'];
