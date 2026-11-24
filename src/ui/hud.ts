import * as THREE from 'three';
import { audio } from '../core/audio';
import { saveSettings, settings, type Quality } from '../core/settings';
import { WEAPONS, WEAPON_ORDER, type SlotName, type WeaponDef, type WeaponId } from '../entities/weapons';
import { ATTACHMENTS, SLOT_DEFAULT, SLOT_LABEL, loadLoadout, optionsFor, resetWeaponToDefault, resolveStats, saveLoadout, type AttachmentDef } from '../entities/attachments';
import type { World } from '../world/physics';
import { GunPreview, type CameraPreset } from './gunPreview';
import { EvidencePreview } from './evidencePreview';
import { CharacterPreview } from './characterPreview';
import { HIGHSEAS_COLLECTIBLES, loadCollectedIds, type IntelCategory } from '../world/collectibles';
import { CHARACTER_DOSSIERS, FACTION_DOSSIERS } from '../world/archives';
import type { HexAugment } from '../hextech';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type Screen = 'loading' | 'menu' | 'playing' | 'paused' | 'dead' | 'debrief';

export type UiGameMode = 'survival' | 'training' | 'highseas' | 'oilfield';

export interface DeathStats {
  mode: UiGameMode;
  wave: number; score: number; kills: number; headshots: number; accuracy: number; time: number; record: boolean;
  stageLabel?: string; zone?: number; totalZones?: number; augments?: number;
}

export interface DebriefStats {
  mode?: UiGameMode;
  grade: string; gradeText: string; run: number;
  cqbTime: number; hostiles: number; hostilesTotal: number; civilians: number; accuracy: number; total: number; record: boolean;
  headshots?: number; score?: number;
}

/** Static layout used for the minimap backdrop. */
export interface MapInfo {
  /** Half extent of the drawn area (metres). */
  half: number;
  /** Road / track rectangles [x, z, w, d] (axis aligned). */
  roads: [number, number, number, number][];
  ground?: string;
  road?: string;
}

const fmtTime = (t: number, tenths = false) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${m}:${ss}`;
};

export interface MapBlip {
  x: number; z: number;
  /** 0 = faint (known), 1 = bright (firing). */
  hot: number;
  /** True for allied squadmates / camp friendlies (drawn as cyan-blue dots). */
  friendly?: boolean;
  /** Enemy alertness: 0 = unalerted stealth sentry, 1 = suspicious ('?'), 2 = alerted combat ('!'). */
  alert?: 0 | 1 | 2;
  /** 0..1 decaying pulse when newly alerted by gunfire or sound. */
  alertPulse?: number;
}

export interface IffMarker {
  x: number; y: number; z: number;
  name: string;
  role: 'ally' | 'hostage';
}

const TIPS = [
  '提示：按住右键举枪瞄准，可大幅提高射击精度。',
  '提示：爆头能造成数倍伤害 —— 瞄准头部。',
  '提示：红色油桶一打就炸，把敌人引过去。',
  '提示：脱离战斗数秒后生命值会自动恢复，善用掩体。',
  '提示：走到弹药箱旁按 F，补满弹药与手雷。',
  '提示：短点射比长扫射更准，蹲下也能压枪。',
];

export class Hud {
  onStart = () => {};
  onTrain = () => {};
  onHighSeas = () => {};
  onOilfield = () => {};
  onResume = () => {};
  onRestart = () => {};
  onQuit = () => {};
  onSettings = () => {};
  onRetryCqb = () => {};
  onDebriefPrimary = () => {};
  onDebriefRetry = () => {};
  /** Called after a gunsmith change so the viewmodel / ammo can refresh. */
  onLoadoutChange: (id: WeaponId) => void = () => {};
  /** Supplies the live viewmodel group so the gunsmith can show a 3D preview. */
  gunModelProvider: (id: WeaponId) => THREE.Object3D | null = () => null;
  private gsWeapon: WeaponId = 'qbz192';
  private preview: GunPreview | null = null;
  private gsAnchors: Record<string, [number, number, number]> = {};
  private gsLabels: HTMLElement[] = [];
  private gsLines: SVGPolylineElement[] = [];
  private gsDots: SVGCircleElement[] = [];
  private gsRings: SVGCircleElement[] = [];
  private gsRaf = 0;
  private gsActiveSlot: SlotName | null = null;
  private gsBound = false;
  private evPreview: EvidencePreview | null = null;
  private charPreview: CharacterPreview | null = null;
  private intelCat: 'all' | IntelCategory = 'all';
  private intelSelectedId: string = HIGHSEAS_COLLECTIBLES[0].id;
  private intelBound = false;
  private arTab: 'chars' | 'factions' = 'chars';
  private arCharId: string = CHARACTER_DOSSIERS[0].id;
  private arFacId: string = FACTION_DOSSIERS[0].id;
  private arBound = false;
  private hexKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  private el = {
    hud: $('hud'), loading: $('loading'), menu: $('menu'), campaign: $('campaign-panel'), archives: $('archives-panel'), hexModal: $('hex-modal'),
    bossHud: $('boss-hud'), bossPhase: $('boss-phase'), bossName: $('boss-name'), bossTitle: $('boss-title'), bossHpNum: $('boss-hp-num'), bossHpFill: $('boss-hp-fill'),
    bossShieldBar: $('boss-shield-bar'), bossShieldFill: $('boss-shield-fill'), bossSkill: $('boss-skill'),
    hexStrip: $('hex-strip'), hxKicker: $('hx-kicker'), hxTitle: $('hx-title'), hxSub: $('hx-sub'), hxCards: $('hx-cards'),
    settings: $('settings'), help: $('help'), gunsmith: $('gunsmith'), intel: $('intel'), pause: $('pause'), dead: $('dead'), debrief: $('debrief'), scope: $('scope'),
    sub: $('subtitle'), subWho: $('sub-who'), subText: $('sub-text'), wpt: $('wpt'), wptLabel: $('wpt-label'), wptDist: $('wpt-dist'), iff: $('iff-layer'),
    timer: $('timer'), timerVal: $('timer-val'), timerLabel: $('timer-label'), fade: $('fade'),
    zoneLoader: $('zone-loader'), zlTitle: $('zl-title'), zlSub: $('zl-sub'), zlTrack: $('zl-track'), zlFill: $('zl-fill'), zlStatus: $('zl-status'), zlPct: $('zl-pct'),
    cross: $('crosshair'), hit: $('hitmarker'), ring: $('dmg-ring'), popups: $('popups'), feed: $('killfeed'),
    anBox: $('announce'), anTitle: $('an-title'), anSub: $('an-sub'), hint: $('hint'), interact: $('interact'), interactKey: $('interact-key'), interactText: $('interact-text'),
    hpNum: $('hp-num'), hpFill: $('hp-fill'), vitals: $('vitals'),
    mag: $('ammo-mag'), res: $('ammo-res'), ammoBox: document.querySelector('.wp-ammo') as HTMLElement, wpName: $('wp-name'), wpMode: $('wp-mode'), slots: $('wp-slots'), nades: $('nades'),
    wave: $('obj-wave'), left: $('obj-left'), objTitle: $('obj-title'), objIntel: $('obj-intel'), objIntelVal: $('obj-intel-val'), score: $('score'),
    ldFill: $('ld-fill'), ldLabel: $('ld-label'), ldPct: $('ld-pct'), ldMission: $('ld-mission'), ldStages: $('ld-stages'),
  };
  private compass = ($('compass') as HTMLCanvasElement).getContext('2d')!;
  private mini = ($('minimap') as HTMLCanvasElement).getContext('2d')!;
  private lastCompassYaw = NaN;
  private mapImg: HTMLCanvasElement | null = null;
  private mapHalf = 76;
  private returnTo: 'menu' | 'pause' = 'menu';
  private wptPos: THREE.Vector3 | null = null;
  private wptV = new THREE.Vector3();
  private hintT = 0;
  private scopeOn = false;
  private cache: Record<string, string | number | boolean> = {};
  private loadingT = 0;
  private scoreShown = 0;
  private scoreTarget = 0;
  private hudDrawT = 1;
  private perfEl = $('perf-hud');
  private perfOn = true;
  private perfT = 1;

  constructor() {
    $('ld-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    const click = (id: string, fn: () => void) => {
      const b = $(id);
      b.addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.6 });
        fn();
      });
    };
    document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => audio.play('ui_hover', { vol: 0.25 })));
    click('btn-start', () => this.onStart());
    click('btn-campaign', () => this.openPanel('campaign', 'menu'));
    click('btn-campaign-back', () => this.closePanel());
    click('btn-archives', () => this.openPanel('archives', 'menu'));
    click('btn-archives-back', () => this.closePanel());
    click('btn-train', () => { this.closePanel(); this.onTrain(); });
    click('btn-highseas', () => { this.closePanel(); this.onHighSeas(); });
    click('btn-oilfield', () => { this.closePanel(); this.onOilfield(); });
    click('btn-resume', () => this.onResume());
    click('btn-restart', () => this.onRestart());
    click('btn-retry', () => this.onRestart());
    click('btn-quit', () => this.onQuit());
    click('btn-dead-quit', () => this.onQuit());
    click('btn-db-deploy', () => this.onDebriefPrimary());
    click('btn-db-retry', () => this.onDebriefRetry());
    click('btn-db-quit', () => this.onQuit());
    click('btn-gunsmith', () => this.openPanel('gunsmith', 'menu'));
    click('btn-intel', () => this.openPanel('intel', 'menu'));
    click('btn-settings', () => this.openPanel('settings', 'menu'));
    click('btn-help', () => this.openPanel('help', 'menu'));
    click('btn-pause-gunsmith', () => this.openPanel('gunsmith', 'pause'));
    click('btn-pause-intel', () => this.openPanel('intel', 'pause'));
    click('btn-pause-settings', () => this.openPanel('settings', 'pause'));
    click('btn-pause-help', () => this.openPanel('help', 'pause'));
    click('btn-gunsmith-back', () => this.closePanel());
    click('btn-intel-back', () => this.closePanel());
    click('btn-gunsmith-reset', () => {
      const def = WEAPONS[this.gsWeapon];
      resetWeaponToDefault(def);
      saveLoadout(WEAPONS, WEAPON_ORDER);
      this.onLoadoutChange(def.id);
      this.renderGunsmith(true);
    });
    click('btn-settings-back', () => this.closePanel());
    click('btn-help-back', () => this.closePanel());

    // settings bindings
    const sens = $<HTMLInputElement>('set-sens'), fov = $<HTMLInputElement>('set-fov'), vol = $<HTMLInputElement>('set-vol');
    const sync = () => {
      sens.value = String(settings.sensitivity);
      fov.value = String(settings.fov);
      vol.value = String(settings.volume);
      $('val-sens').textContent = settings.sensitivity.toFixed(2);
      $('val-fov').textContent = String(settings.fov);
      $('val-vol').textContent = Math.round(settings.volume * 100) + '%';
      document.querySelectorAll<HTMLElement>('#set-quality button').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
    };
    const changed = () => {
      sync();
      saveSettings();
      this.onSettings();
    };
    sens.addEventListener('input', () => { settings.sensitivity = parseFloat(sens.value); changed(); });
    fov.addEventListener('input', () => { settings.fov = parseInt(fov.value, 10); changed(); });
    vol.addEventListener('input', () => { settings.volume = parseFloat(vol.value); changed(); });
    document.querySelectorAll<HTMLElement>('#set-quality button').forEach((b) =>
      b.addEventListener('click', () => {
        settings.quality = b.dataset.q as Quality;
        audio.play('ui_click', { vol: 0.6 });
        changed();
      }),
    );
    sync();

    // weapon slots
    this.el.slots.innerHTML = WEAPON_ORDER.map((id, i) => `<div class="wp-slot" data-w="${id}"><b>${i + 1}</b>${WEAPONS[id].name}</div>`).join('');
  }

  get panelOpen() {
    return (
      !this.el.settings.classList.contains('hidden') ||
      !this.el.help.classList.contains('hidden') ||
      !this.el.gunsmith.classList.contains('hidden') ||
      !this.el.intel.classList.contains('hidden') ||
      !this.el.campaign.classList.contains('hidden') ||
      !this.el.archives.classList.contains('hidden')
    );
  }

  private openPanel(which: 'settings' | 'help' | 'gunsmith' | 'intel' | 'campaign' | 'archives', from: 'menu' | 'pause') {
    this.returnTo = from;
    this.el[which].classList.remove('hidden');
    if (from === 'pause') this.el.pause.classList.add('hidden');
    if (which === 'gunsmith') this.renderGunsmith(false);
    if (which === 'intel') this.renderIntel();
    if (which === 'archives') this.renderArchives();
  }

  private renderArchives() {
    if (!this.charPreview) this.charPreview = new CharacterPreview($<HTMLCanvasElement>('ar-preview'));
    if (!this.arBound) {
      this.arBound = true;
      const setTab = (t: 'chars' | 'factions') => {
        audio.play('ui_click', { vol: 0.45 });
        this.arTab = t;
        $('tab-ar-chars').classList.toggle('on', t === 'chars');
        $('tab-ar-factions').classList.toggle('on', t === 'factions');
        $('ar-chars-view').classList.toggle('hidden', t !== 'chars');
        $('ar-factions-view').classList.toggle('hidden', t !== 'factions');
        if (t === 'chars') {
          this.charPreview?.start();
          this.charPreview?.resize();
        } else {
          this.charPreview?.stop();
        }
      };
      $('tab-ar-chars').addEventListener('click', () => setTab('chars'));
      $('tab-ar-factions').addEventListener('click', () => setTab('factions'));
      $('btn-ar-pose').addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.4 });
        const mode = this.charPreview?.togglePose() ?? 'combat';
        $('btn-ar-pose').textContent = mode === 'combat' ? '切换姿态：战术持枪' : '切换姿态：简报待命';
      });
      $('btn-ar-reset').addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.4 });
        this.charPreview?.resetView();
      });
      window.addEventListener('resize', () => {
        if (!this.el.archives.classList.contains('hidden') && this.arTab === 'chars') this.charPreview?.resize();
      });
    }

    // Character list
    const charList = $('ar-char-list');
    charList.innerHTML = CHARACTER_DOSSIERS.map((c) => {
      const on = c.id === this.arCharId;
      return `<button class="ar-item ${c.factionTag}${on ? ' on' : ''}" data-cid="${c.id}">` +
        `<div class="ar-item-top"><span class="ar-item-code">${c.callsign}</span><i class="ar-dot ${c.factionTag}"></i></div>` +
        `<div class="ar-item-name">${c.name}</div>` +
        `<div class="ar-item-sub">${c.role}</div></button>`;
    }).join('');
    charList.querySelectorAll<HTMLElement>('.ar-item').forEach((b) =>
      b.addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.45 });
        this.arCharId = b.dataset.cid!;
        this.renderArchives();
      }),
    );

    const selChar = CHARACTER_DOSSIERS.find((c) => c.id === this.arCharId) ?? CHARACTER_DOSSIERS[0];
    $('ar-callsign').textContent = `${selChar.callsign} // ${selChar.en}`;
    $('ar-cname').textContent = selChar.name;
    $('ar-status').textContent = selChar.status;
    $('ar-status').className = `ar-status ${selChar.factionTag}`;
    $('ar-char-detail').innerHTML =
      `<div class="ar-sec-tag ${selChar.factionTag}">${selChar.faction}</div>` +
      `<div class="ar-role">${selChar.role}</div>` +
      `<blockquote class="ar-quote">${selChar.quote}</blockquote>` +
      `<div class="ar-kv"><span>制式主武装</span><b>${selChar.weapon}</b></div>` +
      `<div class="ar-kv"><span>战术专长</span><b>${selChar.specialty}</b></div>` +
      `<div class="ar-block-h">人物履历</div><p class="ar-bio">${selChar.bio}</p>` +
      `<div class="ar-block-h">专属 3D 装备配置</div><ul class="ar-gear">${selChar.gearNotes.map((g) => `<li>${g}</li>`).join('')}</ul>`;

    if (this.arTab === 'chars') {
      this.charPreview.setCharacter(selChar.modelKind, selChar.factionTag);
      this.charPreview.start();
    }

    // Faction list & detail
    const facList = $('ar-fac-list');
    facList.innerHTML = FACTION_DOSSIERS.map((f) => {
      const on = f.id === this.arFacId;
      return `<button class="ar-item ${f.alignKey}${on ? ' on' : ''}" data-fid="${f.id}">` +
        `<div class="ar-item-top"><span class="ar-item-code">${f.code}</span><i class="ar-dot ${f.alignKey}"></i></div>` +
        `<div class="ar-item-name">${f.emblem} ${f.name}</div>` +
        `<div class="ar-item-sub">${f.alignment}</div></button>`;
    }).join('');
    facList.querySelectorAll<HTMLElement>('.ar-item').forEach((b) =>
      b.addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.45 });
        this.arFacId = b.dataset.fid!;
        this.renderArchives();
      }),
    );

    const selFac = FACTION_DOSSIERS.find((f) => f.id === this.arFacId) ?? FACTION_DOSSIERS[0];
    $('ar-fac-detail').innerHTML =
      `<div class="ar-fac-head ${selFac.alignKey}">` +
        `<div class="ar-fac-emblem">${selFac.emblem}</div>` +
        `<div><div class="ar-fac-code">${selFac.code} · ${selFac.alignment}</div><h2>${selFac.name}</h2><div class="ar-fac-en">${selFac.en}</div></div>` +
      `</div>` +
      `<div class="ar-fac-grid">` +
        `<div class="ar-kv"><span>总部 / 活动区域</span><b>${selFac.hq}</b></div>` +
        `<div class="ar-kv"><span>核心编制实力</span><b>${selFac.strength}</b></div>` +
        `<div class="ar-kv"><span>作战教条与风格</span><b>${selFac.doctrine}</b></div>` +
      `</div>` +
      `<div class="ar-block-h">组织概览</div><p class="ar-bio">${selFac.summary}</p>` +
      `<div class="ar-fac-cols">` +
        `<div><div class="ar-block-h">关键战役与行动记录</div><ul class="ar-gear">${selFac.keyOps.map((o) => `<li>${o}</li>`).join('')}</ul></div>` +
        `<div><div class="ar-block-h">标志性装备与资产</div><ul class="ar-gear">${selFac.assets.map((a) => `<li>${a}</li>`).join('')}</ul></div>` +
      `</div>`;
  }

  setIntelProgress(count: number, total: number) {
    this.el.objIntel.classList.toggle('hidden', total <= 0);
    this.el.objIntelVal.textContent = `${count}/${total}`;
  }

  private renderIntel() {
    const got = loadCollectedIds();
    const total = HIGHSEAS_COLLECTIBLES.length;
    $('intel-count').textContent = `${got.size} / ${total}`;
    $('in-prog-fill').style.width = `${Math.round((got.size / Math.max(1, total)) * 100)}%`;

    if (!this.evPreview) this.evPreview = new EvidencePreview($<HTMLCanvasElement>('in-preview'));
    this.evPreview.start();

    if (!this.intelBound) {
      this.intelBound = true;
      document.querySelectorAll<HTMLElement>('.in-filter[data-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          audio.play('ui_click', { vol: 0.45 });
          this.intelCat = btn.dataset.cat as 'all' | IntelCategory;
          document.querySelectorAll('.in-filter').forEach((b) => b.classList.remove('on'));
          btn.classList.add('on');
          this.renderIntel();
        });
      });
      $('btn-in-reset').addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.4 });
        this.evPreview?.resetView();
      });
      window.addEventListener('resize', () => {
        if (!this.el.intel.classList.contains('hidden')) this.evPreview?.resize();
      });
    }

    const filtered = this.intelCat === 'all'
      ? HIGHSEAS_COLLECTIBLES
      : HIGHSEAS_COLLECTIBLES.filter((c) => c.category === this.intelCat);

    if (!filtered.some((c) => c.id === this.intelSelectedId)) {
      this.intelSelectedId = (filtered.find((c) => got.has(c.id)) ?? filtered[0] ?? HIGHSEAS_COLLECTIBLES[0]).id;
    }

    const listEl = $('intel-list');
    listEl.innerHTML = filtered.map((c) => {
      const ok = got.has(c.id);
      const on = c.id === this.intelSelectedId;
      return `<button class="in-file${ok ? ' unlocked' : ''}${on ? ' on' : ''}" data-id="${c.id}">` +
        `<div class="in-file-row"><span class="in-file-code">${c.code}</span><span class="in-file-state">${ok ? '已解密' : '未收录'}</span></div>` +
        `<div class="in-file-title">${ok ? c.title : '加密物证 · 未解密'}</div>` +
        `<div class="in-file-zone">${c.zone}</div>` +
        `</button>`;
    }).join('');
    listEl.querySelectorAll<HTMLElement>('.in-file').forEach((btn) => {
      btn.addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.45 });
        this.intelSelectedId = btn.dataset.id!;
        this.renderIntel();
      });
    });

    const sel = HIGHSEAS_COLLECTIBLES.find((c) => c.id === this.intelSelectedId) ?? HIGHSEAS_COLLECTIBLES[0];
    const unlocked = got.has(sel.id);

    // Update Center 3D Forensic Stage + SVG M/V Taishan Locator Pins
    $('in-stage-code').textContent = sel.code;
    $('in-clearance').textContent = sel.clearance;
    $('in-zone-tag').textContent = sel.zone.split('·')[0].trim();
    this.evPreview.setEvidence(sel.prop, unlocked);

    const pinsSvg = $('in-ship-pins');
    pinsSvg.innerHTML = HIGHSEAS_COLLECTIBLES.map((c) => {
      const px = 14 + (c.mapPos[0] / 100) * 288;
      const py = 14 + (c.mapPos[1] / 100) * 48;
      const isSel = c.id === sel.id;
      const isOk = got.has(c.id);
      const col = isSel ? '#38e4ff' : isOk ? '#e8b04a' : 'rgba(255,255,255,0.28)';
      return (isSel
        ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="8" fill="none" stroke="#38e4ff" stroke-opacity="0.45" stroke-width="1.2" />`
        : '') +
        `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${isSel ? 3.8 : 2.5}" fill="${col}" />`;
    }).join('');

    // Update Right Classified Dossier Reader
    const reader = $('in-reader');
    if (unlocked) {
      reader.innerHTML =
        `<div class="in-doc-head">` +
          `<span class="in-stamp">DECRYPTED // 档案已解密 · +${sel.score} PTS</span>` +
          `<div class="in-doc-title">${sel.title}</div>` +
          `<div class="in-doc-sum">${sel.summary}</div>` +
        `</div>` +
        `<div class="in-meta-grid">` +
          `<div class="in-meta-cell"><span>档案编号</span><b>${sel.code}</b></div>` +
          `<div class="in-meta-cell"><span>档案分类</span><b>${sel.categoryLabel}</b></div>` +
          `<div class="in-meta-cell"><span>截获时间</span><b>${sel.timestamp}</b></div>` +
          `<div class="in-meta-cell"><span>关联势力</span><b>${sel.faction}</b></div>` +
        `</div>` +
        `<div>` +
          `<div class="in-section-label">解密情报正文 · TRANSCRIPT</div>` +
          `<div class="in-transcript">${sel.transcript.map((line) => `<p>${line}</p>`).join('')}</div>` +
        `</div>` +
        `<div class="in-analyst">` +
          `<div class="in-analyst-who">战术研判批注 · ${sel.analystNote.who}</div>` +
          `<div class="in-analyst-txt">“${sel.analystNote.text}”</div>` +
        `</div>`;
    } else {
      reader.innerHTML =
        `<div class="in-doc-head">` +
          `<span class="in-stamp locked">ENCRYPTED // 密钥缺失 · 未收录</span>` +
          `<div class="in-doc-title">绝密档案 [${sel.code}]</div>` +
          `<div class="in-doc-sum">该战地物证尚未在行动中采集，三维模型与情报原文处于 AES-256 加密锁定状态。</div>` +
        `</div>` +
        `<div class="in-meta-grid">` +
          `<div class="in-meta-cell"><span>档案编号</span><b>${sel.code}</b></div>` +
          `<div class="in-meta-cell"><span>档案分类</span><b>${sel.categoryLabel}</b></div>` +
          `<div class="in-meta-cell"><span>预测区域</span><b>${sel.zone}</b></div>` +
          `<div class="in-meta-cell"><span>收集奖励</span><b>+${sel.score} 战地积分</b></div>` +
        `</div>` +
        `<div class="in-locked-box">` +
          `<b>采集指引 · RECOVERY DIRECTIVE</b>` +
          `<p>前往第一关《深海截击 · 泰山号》<b>${sel.zone}</b>，搜寻青色全息扫描光柱信标并按 <b>[F]</b> 键收取物证，即可永久解锁三维检视模型、解密原文及专项战术研判。</p>` +
        `</div>`;
    }
  }

  /** Full-screen AAA Tactical Armory Gunsmith V2: categorized rack, 3D schematic callouts, live delta bars & attachment drawer. */
  private renderGunsmith(keepView = false) {
    loadLoadout(WEAPONS);
    const def = WEAPONS[this.gsWeapon];
    if (!this.gsActiveSlot || !def.slots.includes(this.gsActiveSlot)) {
      this.gsActiveSlot = def.slots[0] ?? null;
    }

    // 1. Categorized Left Weapon Armory Rack
    const groups: { title: string; ids: WeaponId[] }[] = [
      { title: '突击步枪 · RIFLES', ids: ['qbz192', 'm4a1', 'scarl', 'ak47'] },
      { title: '冲锋枪 · SMG', ids: ['mp5a5'] },
      { title: '狙击步枪 · SNIPER', ids: ['awm'] },
      { title: '战术手枪 · SIDEARM', ids: ['qsz193', 'm1911'] },
    ];
    const countMods = (w: WeaponDef) =>
      w.slots.filter((s) => {
        const cur = w.fitted[s];
        return cur && cur !== 'none' && cur !== 'gnone' && cur !== 'lnone' && cur !== 'irons' && cur !== 'bstd' && cur !== 'sstd' && cur !== 'std';
      }).length;
    const list = $('gs-list');
    list.innerHTML = groups.map((grp) => {
      const items = grp.ids
        .filter((id) => WEAPONS[id])
        .map((id) => {
          const w = WEAPONS[id];
          const mods = countMods(w);
          return `<button class="gs-item${id === this.gsWeapon ? ' on' : ''}" data-w="${id}">` +
            `<div class="gs-item-main"><b>${w.name}</b><span>${w.label} · ${w.modeLabel}</span></div>` +
            `<span class="gs-item-meta">${mods}/${w.slots.length}</span></button>`;
        })
        .join('');
      return `<div class="gs-cat-head">${grp.title}</div>${items}`;
    }).join('');
    list.querySelectorAll<HTMLElement>('.gs-item').forEach((b) => {
      b.addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.5 });
        this.gsWeapon = b.dataset.w as WeaponId;
        this.gsActiveSlot = null;
        this.renderGunsmith(false);
      });
    });

    // 2. Top Weapon Designation + 3D Studio Preview
    $('gs-name').textContent = def.name;
    $('gs-class').textContent = `${def.label} · ${def.modeLabel}`;
    if (!this.preview) this.preview = new GunPreview($<HTMLCanvasElement>('gs-preview'));
    this.preview.setModel(this.gunModelProvider(def.id), keepView);
    this.preview.start();

    // 3. Bind Camera Preset Toolbar & Resize once
    if (!this.gsBound) {
      this.gsBound = true;
      document.querySelectorAll<HTMLElement>('.gs-cam-btn[data-cam]').forEach((btn) => {
        btn.addEventListener('click', () => {
          audio.play('ui_click', { vol: 0.45 });
          document.querySelectorAll('.gs-cam-btn[data-cam]').forEach((b) => b.classList.remove('on'));
          btn.classList.add('on');
          this.preview?.setPreset(btn.dataset.cam as CameraPreset);
        });
      });
      window.addEventListener('resize', () => {
        if (!this.el.gunsmith.classList.contains('hidden')) this.preview?.resize();
      });
    }

    // 4. 3D Schematic Callout Nodes + Elbowed SVG Leader Lines
    this.gsAnchors = (def.anchors ?? {}) as Record<string, [number, number, number]>;
    const labels = $('gs-labels');
    const lines = $('gs-lines');
    labels.innerHTML = '';
    lines.innerHTML = '';
    const SVG = 'http://www.w3.org/2000/svg';
    for (const slot of def.slots) {
      const cur = def.fitted[slot];
      const curDef = cur ? ATTACHMENTS[cur] : undefined;
      const el = document.createElement('div');
      el.className = 'gs-node' + (slot === this.gsActiveSlot ? ' on' : '');
      el.dataset.slot = slot;
      el.innerHTML = `<b>${SLOT_LABEL[slot]}</b><span>${curDef?.label ?? '无'}</span>`;
      el.addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.45 });
        this.selectGsSlot(slot);
      });
      labels.appendChild(el);
      const ring = document.createElementNS(SVG, 'circle');
      ring.setAttribute('r', '5.5');
      ring.setAttribute('class', 'ring');
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('r', '2.8');
      const poly = document.createElementNS(SVG, 'polyline');
      if (slot === this.gsActiveSlot) {
        dot.classList.add('on');
        poly.classList.add('on');
      }
      lines.append(poly, ring, dot);
    }
    this.gsLabels = [...labels.querySelectorAll<HTMLElement>('.gs-node')];
    this.gsLines = [...lines.querySelectorAll('polyline')];
    this.gsRings = [...lines.querySelectorAll<SVGCircleElement>('circle.ring')];
    this.gsDots = [...lines.querySelectorAll<SVGCircleElement>('circle:not(.ring)')];

    if (!this.gsRaf) this.gsRaf = requestAnimationFrame(this.gsTick);
    this.renderPresets(def);
    this.renderStats(def, null);
    this.renderSlotDrawer(def);
  }

  /** Selects an attachment slot and syncs 3D callout highlight + right-hand attachment cards. */
  private selectGsSlot(slot: SlotName) {
    this.gsActiveSlot = slot;
    const def = WEAPONS[this.gsWeapon];
    this.gsLabels.forEach((l, i) => {
      const active = l.dataset.slot === slot;
      l.classList.toggle('on', active);
      this.gsLines[i]?.classList.toggle('on', active);
      this.gsDots[i]?.classList.toggle('on', active);
    });
    this.renderSlotDrawer(def);
  }

  /** Right-hand attachment drawer: slot tabs + rich attachment cards with badges & hover live diff preview. */
  private renderSlotDrawer(def: WeaponDef) {
    const active = this.gsActiveSlot ?? def.slots[0];
    const mods = def.slots.filter((s) => {
      const cur = def.fitted[s];
      return cur && cur !== 'none' && cur !== 'gnone' && cur !== 'lnone' && cur !== 'irons' && cur !== 'bstd' && cur !== 'sstd' && cur !== 'std';
    }).length;
    $('gs-slot-heading').textContent = active ? `配件选择 · ${SLOT_LABEL[active]}` : '配件槽位';
    $('gs-slot-count').textContent = `已改 ${mods}/${def.slots.length}`;

    const tabs = $('gs-slot-tabs');
    tabs.innerHTML = def.slots
      .map((s) => `<button class="gs-slot-tab${s === active ? ' on' : ''}" data-slot="${s}">${SLOT_LABEL[s]}</button>`)
      .join('');
    tabs.querySelectorAll<HTMLElement>('.gs-slot-tab').forEach((b) => {
      b.addEventListener('click', () => {
        audio.play('ui_click', { vol: 0.45 });
        this.selectGsSlot(b.dataset.slot as SlotName);
      });
    });

    const listEl = $('gs-att-list');
    if (!active) { listEl.innerHTML = ''; return; }
    const optIds = optionsFor(def, active);
    const curId = def.fitted[active] ?? SLOT_DEFAULT[active];
    listEl.innerHTML = optIds
      .map((id) => {
        const att = ATTACHMENTS[id];
        if (!att) return '';
        const eq = id === curId;
        return `<button class="gs-att-card${eq ? ' on' : ''}" data-opt="${id}">` +
          `<div class="gs-att-head"><b>${att.label}</b>${eq ? '<span class="gs-att-eq">已装配</span>' : ''}</div>` +
          `<div class="gs-att-desc">${att.desc ?? ''}</div>` +
          this.formatAttachBadges(att) +
          `</button>`;
      })
      .join('');

    listEl.querySelectorAll<HTMLElement>('.gs-att-card').forEach((card) => {
      const optId = card.dataset.opt!;
      card.addEventListener('mouseenter', () => {
        this.renderStats(def, { ...def, fitted: { ...def.fitted, [active]: optId } });
      });
      card.addEventListener('mouseleave', () => {
        this.renderStats(def, null);
      });
      card.addEventListener('click', () => {
        if (def.fitted[active] === optId) return;
        audio.play('equip', { vol: 0.45, rate: 1.15 });
        def.fitted[active] = optId;
        saveLoadout(WEAPONS, WEAPON_ORDER);
        this.onLoadoutChange(def.id);
        this.renderGunsmith(true);
      });
    });
  }

  /** Dual-layer live ballistic stat bars with emerald gain / coral loss delta overlays. */
  private renderStats(def: WeaponDef, preview: WeaponDef | null) {
    const st = resolveStats(def);
    const pv = preview ? resolveStats(preview) : null;
    const row = (label: string, base: number, next: number | null, txt: string, nextTxt: string) => {
      const bPct = Math.max(2, Math.min(100, Math.round(base * 100)));
      const nPct = next !== null ? Math.max(2, Math.min(100, Math.round(next * 100))) : bPct;
      const better = next !== null && next > base + 0.002;
      const worse = next !== null && next < base - 0.002;
      const cls = better ? ' up' : worse ? ' down' : '';
      const shown = next !== null && (better || worse) ? `<em class="gs-delta${cls}">${nextTxt}</em>` : txt;
      const baseW = worse ? nPct : bPct;
      const gainBar = better ? `<i class="gs-bar-gain" style="left:${bPct}%;width:${nPct - bPct}%"></i>` : '';
      const lossBar = worse ? `<i class="gs-bar-loss" style="left:${nPct}%;width:${bPct - nPct}%"></i>` : '';
      return `<div class="gs-stat"><span>${label}</span><div class="gs-bar"><i class="gs-bar-base" style="width:${baseW}%"></i>${gainBar}${lossBar}</div><b>${shown}</b></div>`;
    };
    const n = (v: number) => Math.min(1, v / 130);
    const accScore = (s: ReturnType<typeof resolveStats>) => Math.max(0.05, 1 - (s.adsSpread * 0.6 + s.hipSpread * 0.4) / 3.2);
    const rows = [
      row('单发威力', n(st.damage), pv ? n(pv.damage) : null, String(Math.round(st.damage)), String(Math.round(pv?.damage ?? 0))),
      row('射击速率', Math.min(1, st.rpm / 1050), pv ? Math.min(1, pv.rpm / 1050) : null, `${Math.round(st.rpm)} RPM`, `${Math.round(pv?.rpm ?? 0)} RPM`),
      row('后坐控制', Math.max(0.08, 1 - st.recoilPitch / 3.6), pv ? Math.max(0.08, 1 - pv.recoilPitch / 3.6) : null, st.recoilPitch.toFixed(2), pv ? pv.recoilPitch.toFixed(2) : ''),
      row('射击精度', accScore(st), pv ? accScore(pv) : null, `${st.adsSpread.toFixed(2)}/${st.hipSpread.toFixed(1)}`, pv ? `${pv.adsSpread.toFixed(2)}/${pv.hipSpread.toFixed(1)}` : ''),
      row('开镜机动', Math.max(0.1, 1 - st.adsTime / 0.38), pv ? Math.max(0.1, 1 - pv.adsTime / 0.38) : null, `${(st.adsTime * 1000).toFixed(0)} ms`, pv ? `${(pv.adsTime * 1000).toFixed(0)} ms` : ''),
      row('弹匣容量', Math.min(1, st.mag / 45), pv ? Math.min(1, pv.mag / 45) : null, `${st.mag} 发`, `${pv?.mag ?? 0} 发`),
    ];
    $('gs-stats').innerHTML = rows.join('');
  }

  /** Three save/load preset schemes in the top bar (clean flexbox, zero overlap). */
  private renderPresets(def: WeaponDef) {
    const all = this.readPresets();
    const mine = all[def.id] ?? {};
    const box = $('gs-presets');
    box.innerHTML = '<span class="gs-preset-tag">改装方案</span>' +
      [0, 1, 2].map((i) => {
        const has = !!mine[i];
        const ch = String.fromCharCode(65 + i);
        return `<div class="gs-preset-pair">` +
          `<button class="gs-preset-load" data-preset="${i}"${has ? '' : ' disabled'}>方案 ${ch}</button>` +
          `<button class="gs-preset-save" data-save="${i}" title="保存当前配置到方案 ${ch}">存</button>` +
          `</div>`;
      }).join('');
    box.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.preset);
        const fit = mine[i];
        if (!fit) return;
        audio.play('equip', { vol: 0.5 });
        Object.assign(def.fitted, fit);
        saveLoadout(WEAPONS, WEAPON_ORDER);
        this.onLoadoutChange(def.id);
        this.renderGunsmith(true);
      });
    });
    box.querySelectorAll<HTMLElement>('[data-save]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.save);
        audio.play('ui_click', { vol: 0.5 });
        const all2 = this.readPresets();
        all2[def.id] = { ...(all2[def.id] ?? {}), [i]: { ...def.fitted } };
        localStorage.setItem('redsand.presets', JSON.stringify(all2));
        this.renderPresets(def);
      });
    });
  }

  private readPresets(): Record<string, Record<number, Partial<Record<SlotName, string>>>> {
    try {
      return JSON.parse(localStorage.getItem('redsand.presets') || '{}');
    } catch {
      return {};
    }
  }

  /** Elbowed SVG leader lines: project each slot's 3D anchor onto the stage every frame. */
  private gsTick = () => {
    this.gsRaf = 0;
    if (!this.el.gunsmith.classList.contains('hidden') && this.preview) {
      this.gsRaf = requestAnimationFrame(this.gsTick);
    }
    const stage = $('gs-stage');
    const rect = stage.getBoundingClientRect();
    const placedRects: { x: number; y: number }[] = [];
    const BIAS: Record<string, [number, number]> = {
      muzzle: [12, -52], barrel: [20, 44], optic: [-24, -44], stock: [28, -32],
      grip: [18, 42], mag: [-12, 46], laser: [-24, 38],
    };
    this.gsLabels.forEach((label, i) => {
      const slot = label.dataset.slot as SlotName;
      const anchor = this.gsAnchors[slot];
      const p = anchor && this.preview ? this.preview.project(anchor) : null;
      if (!p) return;
      const dx = p.x - rect.width * 0.5;
      const dy = p.y - rect.height * 0.46;
      const len = Math.hypot(dx, dy) || 1;
      const R = Math.min(138, Math.max(96, rect.width * 0.14));
      const bias = BIAS[slot] ?? [0, 0];
      let x = Math.min(rect.width - 78, Math.max(78, p.x + (dx / len) * R + bias[0]));
      let y = Math.min(rect.height - 76, Math.max(38, p.y + (dy / len) * R + bias[1]));
      for (let guard = 0; guard < 10; guard++) {
        const hit = placedRects.some((q) => Math.abs(q.x - x) < 126 && Math.abs(q.y - y) < 42);
        if (!hit) break;
        y = Math.min(rect.height - 76, y + 44);
        if (y >= rect.height - 76) { y = Math.max(38, y - 44 * 7); break; }
      }
      placedRects.push({ x, y });
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
      const poly = this.gsLines[i];
      const dot = this.gsDots[i];
      const ring = this.gsRings[i];
      if (poly) {
        // Crisp 2-segment angled tactical callout elbow
        const midX = p.x + (x - p.x) * 0.55;
        poly.setAttribute('points', `${p.x.toFixed(1)},${p.y.toFixed(1)} ${midX.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`);
      }
      if (dot) {
        dot.setAttribute('cx', String(p.x));
        dot.setAttribute('cy', String(p.y));
      }
      if (ring) {
        ring.setAttribute('cx', String(p.x));
        ring.setAttribute('cy', String(p.y));
      }
    });
  };

  private formatAttachBadges(att?: AttachmentDef): string {
    if (!att || !att.mods) return '';
    const m = att.mods;
    const badges: string[] = [];
    if (m.recoil && m.recoil < 1) badges.push(`<span class="gs-badge pos">后坐力 -${Math.round((1 - m.recoil) * 100)}%</span>`);
    if (m.recoil && m.recoil > 1) badges.push(`<span class="gs-badge neg">后坐力 +${Math.round((m.recoil - 1) * 100)}%</span>`);
    if (m.spread && m.spread < 1) badges.push(`<span class="gs-badge pos">散布 -${Math.round((1 - m.spread) * 100)}%</span>`);
    if (m.spread && m.spread > 1) badges.push(`<span class="gs-badge neg">散布 +${Math.round((m.spread - 1) * 100)}%</span>`);
    if (m.hipSpread && m.hipSpread < 1) badges.push(`<span class="gs-badge pos">腰射散布 -${Math.round((1 - m.hipSpread) * 100)}%</span>`);
    if (m.adsTime && m.adsTime < 1) badges.push(`<span class="gs-badge pos">开镜速度 +${Math.round((1 - m.adsTime) * 100)}%</span>`);
    if (m.adsTime && m.adsTime > 1) badges.push(`<span class="gs-badge neg">开镜时间 +${Math.round((m.adsTime - 1) * 100)}%</span>`);
    if (m.noise && m.noise < 0.6) badges.push(`<span class="gs-badge pos">微声隐蔽</span>`);
    if (m.noise && m.noise > 1) badges.push(`<span class="gs-badge neg">枪声增大</span>`);
    if (m.damage && m.damage > 1) badges.push(`<span class="gs-badge pos">威力 +${Math.round((m.damage - 1) * 100)}%</span>`);
    if (m.damage && m.damage < 1) badges.push(`<span class="gs-badge neg">威力 -${Math.round((1 - m.damage) * 100)}%</span>`);
    if (m.mag && m.mag > 1) badges.push(`<span class="gs-badge pos">弹容 +${Math.round((m.mag - 1) * 100)}%</span>`);
    if (m.reload && m.reload > 1) badges.push(`<span class="gs-badge neg">换弹 +${Math.round((m.reload - 1) * 100)}%</span>`);
    if (m.scope) badges.push(`<span class="gs-badge pos">${att.id === 'scope8x' ? '8× 原厂高倍狙击镜' : '4× 中远距光学瞄具'}</span>`);
    return badges.length ? `<div class="gs-badges">${badges.join('')}</div>` : '';
  }

  closePanel() {
    this.preview?.stop();
    this.evPreview?.stop();
    this.charPreview?.stop();
    this.el.settings.classList.add('hidden');
    this.el.help.classList.add('hidden');
    this.el.gunsmith.classList.add('hidden');
    this.el.intel.classList.add('hidden');
    this.el.campaign.classList.add('hidden');
    this.el.archives.classList.add('hidden');
    if (this.returnTo === 'pause') this.el.pause.classList.remove('hidden');
  }

  setLoadingMission(title: string) {
    this.el.ldMission.textContent = title;
    $('ld-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  setLoading(p: number, label: string, stageIdx?: number) {
    const clamped = Math.max(0, Math.min(1, p));
    const pct = Math.round(clamped * 100);
    this.el.ldFill.style.width = pct + '%';
    this.el.ldPct.textContent = pct + '%';
    this.el.ldLabel.textContent = label;
    // Highlight 5 deployment milestones sequentially based on stageIdx or progress %
    const active = stageIdx ?? (pct >= 100 ? 5 : pct >= 88 ? 4 : pct >= 72 ? 3 : pct >= 54 ? 2 : pct >= 36 ? 1 : 0);
    const pills = this.el.ldStages.children;
    for (let i = 0; i < pills.length; i++) {
      const el = pills[i];
      el.classList.toggle('done', i < active);
      el.classList.toggle('active', i === active && pct < 100);
    }
  }

  show(s: Screen) {
    const e = this.el;
    clearTimeout(this.loadingT);
    if (s !== 'loading') {
      e.loading.classList.add('out');
      this.loadingT = window.setTimeout(() => e.loading.classList.add('hidden'), 800);
    } else e.loading.classList.remove('hidden', 'out');
    e.menu.classList.toggle('hidden', s !== 'menu');
    e.hud.classList.toggle('hidden', s !== 'playing' && s !== 'paused');
    e.pause.classList.toggle('hidden', s !== 'paused');
    e.dead.classList.toggle('hidden', s !== 'dead');
    e.debrief.classList.toggle('hidden', s !== 'debrief');
    e.settings.classList.add('hidden');
    e.help.classList.add('hidden');
    e.gunsmith.classList.add('hidden');
    e.intel.classList.add('hidden');
    e.campaign.classList.add('hidden');
    e.archives.classList.add('hidden');
    this.hideHexPicker();
    this.preview?.stop();
    this.evPreview?.stop();
    this.charPreview?.stop();
    if (s !== 'playing') this.setScope(false);
    if (s === 'menu') {
      $('best-score').textContent = String(Number(localStorage.getItem('redsand.best.score') || 0));
      $('best-wave').textContent = String(Number(localStorage.getItem('redsand.best.wave') || 0));
      $('best-grade').textContent = localStorage.getItem('redsand.best.grade') || '—';
    }
  }

  private campaignAlias = false;

  /** Training / campaign mode uses the objective box for mission steps. */
  setMode(training: boolean, campaign = false) {
    this.campaignAlias = campaign;
    this.el.hud.classList.toggle('training', training && !campaign);
    this.el.left.style.display = '';
    this.subtitle(null);
    this.setWaypoint(null);
    this.setTimer(null);
    this.fade(false);
    this.cache = {};
  }

  setObjective(stage: string, title: string, progress = '') {
    if (this.set('objs', stage)) this.el.wave.textContent = stage;
    if (this.set('objt', title)) this.el.objTitle.textContent = title;
    if (this.set('left', progress)) this.el.left.textContent = progress;
    this.el.left.style.display = progress ? '' : 'none';
  }

  subtitle(who: string | null, text = '') {
    if (!who && !text) {
      this.el.sub.classList.remove('show');
      return;
    }
    this.el.subWho.textContent = who ? `${who}：` : '';
    this.el.subText.textContent = text;
    this.el.sub.classList.add('show');
  }

  setWaypoint(pos: THREE.Vector3Like | null, label = '') {
    if (!pos) {
      this.wptPos = null;
      this.el.wpt.classList.remove('show');
      return;
    }
    this.wptPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.el.wptLabel.textContent = label;
    this.el.wpt.classList.add('show');
  }

  get waypoint() {
    return this.wptPos;
  }

  /** Projects the waypoint marker; clamps it to the screen edge when off-screen or behind. */
  updateWaypoint(cam: THREE.PerspectiveCamera, eye: THREE.Vector3) {
    if (!this.wptPos) return;
    const W = window.innerWidth, H = window.innerHeight;
    const v = this.wptV.copy(this.wptPos).project(cam);
    const behind = v.z > 1;
    let x = v.x, y = v.y;
    if (behind) { x = -x; y = -y; }
    const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.82);
    const edge = behind || m > 1;
    if (edge) {
      if (behind && m < 1) { const k = 1 / Math.max(m, 1e-3); x *= k; y *= k; }
      else { x /= m; y /= m; }
    }
    const sx = (x * 0.5 + 0.5) * W, sy = (-y * 0.5 + 0.5) * H;
    this.el.wpt.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
    this.el.wpt.classList.toggle('edge', edge);
    const d = Math.round(eye.distanceTo(this.wptPos));
    if (this.set('wptd', d)) this.el.wptDist.textContent = `${d} 米`;
  }

  private iffPool: HTMLElement[] = [];
  private iffV = new THREE.Vector3();

  /** Projects clean 3A allied squad & nearby civilian hostage IFF tags (hostiles are NEVER tagged!). */
  updateFriendlies(cam: THREE.PerspectiveCamera, eye: THREE.Vector3, markers: IffMarker[]) {
    const W = window.innerWidth, H = window.innerHeight;
    let used = 0;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const v = this.iffV.set(m.x, m.y, m.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.04 || Math.abs(v.y) > 1.04) continue;
      const dist = Math.hypot(m.x - eye.x, m.y - eye.y, m.z - eye.z);
      if (dist > 48) continue;
      let node = this.iffPool[used];
      if (!node) {
        node = document.createElement('div');
        node.className = 'iff-tag';
        node.innerHTML = '<span class="iff-name"></span><i class="iff-chev"></i>';
        this.el.iff.appendChild(node);
        this.iffPool.push(node);
      }
      const isHostage = m.role === 'hostage';
      node.className = isHostage ? 'iff-tag hostage' : 'iff-tag';
      const label = isHostage ? `✦ ${m.name}` : m.name;
      const nameEl = node.firstChild as HTMLElement;
      if (nameEl.textContent !== label) nameEl.textContent = label;
      const sx = (v.x * 0.5 + 0.5) * W;
      const sy = (-v.y * 0.5 + 0.5) * H;
      const alpha = dist < 4 ? 0.92 : Math.max(0.32, 1 - dist / 52);
      node.style.display = '';
      node.style.opacity = alpha.toFixed(2);
      node.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      used++;
    }
    for (let i = used; i < this.iffPool.length; i++) {
      this.iffPool[i].style.display = 'none';
    }
  }

  setTimer(t: number | null, stopped = false, label = '突入计时') {
    if (t === null) {
      this.el.timer.classList.remove('show');
      return;
    }
    this.el.timer.classList.add('show');
    this.el.timer.classList.toggle('stopped', stopped);
    const txt = fmtTime(t, true);
    if (this.set('timer', txt)) this.el.timerVal.textContent = txt;
    if (this.set('timerl', label)) this.el.timerLabel.textContent = label;
  }

  fade(on: boolean) {
    this.el.fade.classList.toggle('on', on);
  }

  /** Half-Life / 3A Tactical Airlock Zone Transition Loading UI (progress 0..1, or null to hide). */
  setZoneTransition(zone: 'A' | 'B' | 'C' | 'D' | null, title = '', sub = '', progress = 0, status = 'LOADING SECTOR…') {
    const zl = this.el.zoneLoader;
    if (!zone) {
      zl.classList.remove('show');
      setTimeout(() => { if (!zl.classList.contains('show')) zl.classList.add('hidden'); }, 240);
      return;
    }
    zl.classList.remove('hidden');
    void zl.offsetWidth;
    zl.classList.add('show');
    this.el.zlTitle.textContent = title;
    this.el.zlSub.textContent = sub;
    this.el.zlStatus.textContent = status;
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    this.el.zlFill.style.width = pct + '%';
    this.el.zlPct.textContent = pct + '%';
    const order = ['A', 'B', 'C', 'D'];
    const curIdx = order.indexOf(zone);
    this.el.zlTrack.querySelectorAll<HTMLElement>('span[data-z]').forEach((sp) => {
      const idx = order.indexOf(sp.dataset.z || '');
      sp.classList.toggle('done', idx < curIdx);
      sp.classList.toggle('active', idx === curIdx);
    });
  }

  showDebrief(s: DebriefStats) {
    const mode: UiGameMode = s.mode ?? 'training';
    const el = this.el.debrief;
    el.classList.remove('mode-training', 'mode-highseas', 'mode-oilfield', 'mode-survival');
    el.classList.add(`mode-${mode}`);

    $('db-grade').textContent = s.grade;
    $('db-grade-text').textContent = s.gradeText;

    if (mode === 'highseas') {
      $('db-kicker').textContent = 'MISSION ACCOMPLISHED · OPERATION DEEP BLADE';
      $('db-title').textContent = '行动圆满完成';
      $('db-sub').textContent = '第一关《深海利刃 · 泰山号》全战区肃清 · 6 名中国船员平安获救';
      $('db-time').textContent = fmtTime(s.cqbTime);
      $('db-time-lbl').textContent = '行动总用时';
      $('db-hostile').textContent = String(s.hostiles);
      $('db-hostile-lbl').textContent = '歼灭敌军';
      $('db-civ').textContent = String(s.headshots ?? 0);
      $('db-civ-lbl').textContent = '精准爆头';
      $('db-acc').textContent = Math.round(s.accuracy * 100) + '%';
      $('db-acc-lbl').textContent = '射击命中率';
      $('db-total').textContent = String(s.score ?? 0);
      $('db-total-lbl').textContent = '行动总分';
      $('db-new').textContent = '第一关已通关 · 可出征第二关《戈壁炼狱》';
      $('db-new').classList.remove('hidden');
      $('btn-db-deploy-txt').textContent = '出征第二关：戈壁炼狱';
      $('btn-db-deploy-en').textContent = 'NEXT MISSION';
      $('btn-db-retry-txt').textContent = '重玩深海利刃';
      $('btn-db-retry-en').textContent = 'REPLAY MISSION';
    } else if (mode === 'oilfield') {
      $('db-kicker').textContent = 'CAMPAIGN COMPLETE · OPERATION GOBI INFERNO';
      $('db-title').textContent = '战役全线告捷';
      $('db-sub').textContent = '第二关《戈壁炼狱 · 喀拉干达 7 号油田》全战区通关 · 厄普西隆中继网瘫痪';
      $('db-time').textContent = fmtTime(s.cqbTime);
      $('db-time-lbl').textContent = '行动总用时';
      $('db-hostile').textContent = String(s.hostiles);
      $('db-hostile-lbl').textContent = '歼灭敌军';
      $('db-civ').textContent = String(s.headshots ?? 0);
      $('db-civ-lbl').textContent = '精准爆头';
      $('db-acc').textContent = Math.round(s.accuracy * 100) + '%';
      $('db-acc-lbl').textContent = '射击命中率';
      $('db-total').textContent = String(s.score ?? 0);
      $('db-total-lbl').textContent = '行动总分';
      $('db-new').textContent = '战役全通关 · 利刃一分队凯旋';
      $('db-new').classList.remove('hidden');
      $('btn-db-deploy-txt').textContent = '挑战哈迪尔防线';
      $('btn-db-deploy-en').textContent = 'SURVIVAL MODE';
      $('btn-db-retry-txt').textContent = '重玩戈壁炼狱';
      $('btn-db-retry-en').textContent = 'REPLAY MISSION';
    } else {
      $('db-kicker').textContent = 'TRAINING COMPLETE · CAMP ANVIL';
      $('db-title').textContent = '考核结束';
      $('db-sub').textContent = `突入屋 · 第 ${s.run} 次`;
      $('db-time').textContent = fmtTime(s.cqbTime, true);
      $('db-time-lbl').textContent = '突入用时';
      $('db-hostile').textContent = `${s.hostiles}/${s.hostilesTotal}`;
      $('db-hostile-lbl').textContent = '敌靶命中';
      $('db-civ').textContent = String(s.civilians);
      $('db-civ-lbl').textContent = '误伤平民';
      $('db-acc').textContent = Math.round(s.accuracy * 100) + '%';
      $('db-acc-lbl').textContent = '命中率';
      $('db-total').textContent = fmtTime(s.total);
      $('db-total-lbl').textContent = '训练用时';
      $('db-new').textContent = '新纪录';
      $('db-new').classList.toggle('hidden', !s.record);
      $('btn-db-deploy-txt').textContent = '开赴哈迪尔防线';
      $('btn-db-deploy-en').textContent = 'DEPLOY';
      $('btn-db-retry-txt').textContent = '再跑一次突入屋';
      $('btn-db-retry-en').textContent = 'RETRY CQB';
    }
  }

  resetGame() {
    this.el.feed.innerHTML = '';
    this.el.popups.innerHTML = '';
    this.el.ring.innerHTML = '';
    this.el.hint.classList.remove('show');
    this.el.interact.classList.remove('show');
    this.el.anBox.classList.remove('show');
    this.setZoneTransition(null);
    for (const n of this.iffPool) n.style.display = 'none';
    this.scoreShown = this.scoreTarget = 0;
    this.el.score.textContent = '0';
    this.cache = {};
  }

  private set(key: string, v: string | number | boolean) {
    if (this.cache[key] === v) return false;
    this.cache[key] = v;
    return true;
  }

  setWeaponSlots(order: WeaponId[]) {
    this.el.slots.innerHTML = order.map((id, i) => `<div class="wp-slot" data-w="${id}"><b>${i + 1}</b>${WEAPONS[id].name}</div>`).join('');
    delete this.cache.wp;
  }

  setWeapon(id: WeaponId, mag: number, reserve: number) {
    const d = WEAPONS[id];
    if (this.set('wp', id)) {
      this.el.wpName.textContent = d.name;
      this.el.wpMode.textContent = `${d.label} · ${d.modeLabel}`;
      this.el.slots.querySelectorAll<HTMLElement>('.wp-slot').forEach((s) => s.classList.toggle('on', s.dataset.w === id));
    }
    if (this.set('mag', mag)) {
      this.el.mag.textContent = String(mag);
      this.el.ammoBox.classList.toggle('low', mag <= Math.ceil(d.mag * 0.25));
    }
    if (this.set('res', reserve)) this.el.res.textContent = String(reserve);
  }

  setGrenades(n: number, max: number) {
    if (!this.set('nades', n)) return;
    let h = '';
    for (let i = 0; i < max; i++) h += `<i class="${i < n ? '' : 'off'}"></i>`;
    this.el.nades.innerHTML = h;
  }

  setHealth(hp: number, maxHp = 100) {
    const v = Math.ceil(hp);
    const pct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
    if (this.set('hp', v)) this.el.hpNum.textContent = String(v);
    const pctKey = Math.round(pct);
    if (this.set('hppct', pctKey)) this.el.hpFill.style.width = pct.toFixed(1) + '%';
    this.el.vitals.classList.toggle('low', pct <= 35);
  }

  /** Top-Center 3A Boss Health, Energy Shield & Skill Telegraph Bar HUD. */
  setBoss(
    boss: {
      name: string;
      title: string;
      hp: number;
      maxHp: number;
      phase: 1 | 2;
      shield?: number;
      maxShield?: number;
      skill?: string;
      kind?: string;
    } | null,
  ) {
    if (!boss) {
      if (!this.el.bossHud.classList.contains('hidden')) this.el.bossHud.classList.add('hidden');
      return;
    }
    this.el.bossHud.classList.remove('hidden');
    this.el.bossHud.classList.toggle('phase2', boss.phase === 2);
    this.el.bossHud.classList.toggle('theme-viper', boss.kind === 'boss_viper');
    this.el.bossHud.classList.toggle('theme-tyrant', boss.kind === 'boss_tyrant');
    if (this.set('bname', boss.name)) this.el.bossName.textContent = boss.name;
    if (this.set('btitle', boss.title)) this.el.bossTitle.textContent = boss.title;
    const p2Name =
      boss.kind === 'boss_viper'
        ? 'PHASE II · 量子超频'
        : boss.kind === 'boss_tyrant'
          ? 'PHASE II · 熔炉觉醒'
          : 'PHASE II · 铁幕过载';
    const pTxt = boss.phase === 2 ? p2Name : 'PHASE I';
    if (this.set('bphase', pTxt)) this.el.bossPhase.textContent = pTxt;
    const hpInt = Math.max(0, Math.ceil(boss.hp));
    const maxInt = Math.max(1, Math.ceil(boss.maxHp));
    const shInt = Math.max(0, Math.ceil(boss.shield ?? 0));
    const shMax = Math.max(1, Math.ceil(boss.maxShield ?? 0));
    const numTxt = shInt > 0 ? `${hpInt} / ${maxInt} · 🛡 ${shInt}` : `${hpInt} / ${maxInt}`;
    if (this.set('bhp', numTxt)) {
      this.el.bossHpNum.textContent = numTxt;
      this.el.bossHpFill.style.width = `${Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100)).toFixed(1)}%`;
    }
    const hasShield = shInt > 0;
    this.el.bossShieldBar.classList.toggle('hidden', !hasShield);
    if (hasShield) {
      const shPct = Math.max(0, Math.min(100, (shInt / shMax) * 100));
      if (this.set('bshpct', Math.round(shPct))) {
        this.el.bossShieldFill.style.width = `${shPct.toFixed(1)}%`;
      }
    }
    const skillTxt = (boss.skill ?? '').trim();
    this.el.bossSkill.classList.toggle('hidden', !skillTxt);
    if (skillTxt && this.set('bskill', skillTxt)) {
      this.el.bossSkill.textContent = skillTxt;
    }
  }

  /** Active Hextech Augments HUD strip during Hadir Hextech Mode. */
  setHexAugments(list: HexAugment[]) {
    if (!list.length) {
      this.el.hexStrip.innerHTML = '';
      return;
    }
    this.el.hexStrip.innerHTML = list
      .map((a) => `<span class="hx-pill ${a.tier}" title="${a.desc}"><i>${a.icon}</i>${a.name}</span>`)
      .join('');
  }

  /** Show the 3A HQ Tactical Support 3-Choose-1 Card Selection Modal. */
  showHexPicker(choices: HexAugment[], wave: number, bossCleared: boolean, onPick: (aug: HexAugment) => void) {
    this.hideHexPicker();
    if (wave <= 0) {
      this.el.hxKicker.textContent = 'HQ TACTICAL SUPPORT // 开局战区支援空投';
      this.el.hxTitle.textContent = '选择开局总部战术支援';
      this.el.hxSub.textContent = '战区指挥部已就绪！点击任意支援包或按键盘 [1] [2] [3] 立即装配，随后打响第 1 波守卫战';
    } else if (bossCleared) {
      this.el.hxKicker.textContent = `BOSS SLAIN // 第 ${wave} 波「赤沙暴君」已击溃 · 总部特级支援空投`;
      this.el.hxTitle.textContent = '选择一项特级司令部支援';
      this.el.hxSub.textContent = '点击任意特级支援包或按键盘 [1] [2] [3] 立即装配，随后自动开启下一波';
    } else {
      this.el.hxKicker.textContent = `HQ TACTICAL SUPPORT // 第 ${wave} 波肃清 · 总部支援抵达`;
      this.el.hxTitle.textContent = '选择一项总部战术支援';
      this.el.hxSub.textContent = '点击任意支援方案或按键盘 [1] [2] [3] 立即空投装配，随后自动开启下一波';
    }
    const tierLabel = { silver: '常规支援 · STANDARD', gold: '精锐支援 · ELITE', prismatic: '特级空投 · COMMANDER' };
    this.el.hxCards.innerHTML = choices
      .map(
        (c, i) =>
          `<button class="hx-card ${c.tier}" data-hi="${i}">` +
            `<div class="hx-card-top"><span class="hx-tier">${tierLabel[c.tier]}</span><span class="hx-hotkey">[${i + 1}]</span></div>` +
            `<div class="hx-icon">${c.icon}</div>` +
            `<div class="hx-name">${c.name}</div>` +
            `<div class="hx-en">${c.en}</div>` +
            `<p class="hx-desc">${c.desc}</p>` +
            `<div class="hx-stat">${c.statTag}</div>` +
          `</button>`,
      )
      .join('');

    const pickIdx = (idx: number) => {
      const aug = choices[idx];
      if (!aug) return;
      audio.play('ui_click', { vol: 0.75 });
      this.hideHexPicker();
      onPick(aug);
    };
    this.el.hxCards.querySelectorAll<HTMLElement>('.hx-card').forEach((btn) => {
      btn.addEventListener('mouseenter', () => audio.play('ui_hover', { vol: 0.3 }));
      btn.addEventListener('click', () => pickIdx(Number(btn.dataset.hi)));
    });
    this.hexKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Digit1') pickIdx(0);
      else if (e.code === 'Digit2') pickIdx(1);
      else if (e.code === 'Digit3') pickIdx(2);
    };
    window.addEventListener('keydown', this.hexKeyHandler);
    this.el.hexModal.classList.remove('hidden');
  }

  hideHexPicker() {
    this.el.hexModal.classList.add('hidden');
    if (this.hexKeyHandler) {
      window.removeEventListener('keydown', this.hexKeyHandler);
      this.hexKeyHandler = null;
    }
  }

  setWave(wave: number, left: number, intermission: number) {
    if (this.set('wave', wave)) this.el.wave.textContent = `第 ${wave} 波`;
    const txt = intermission > 0 ? `下一波 ${Math.ceil(intermission)} 秒` : `敌军剩余 ${left}`;
    if (this.set('left', txt)) this.el.left.textContent = txt;
    const title = intermission > 0 ? '整备 · 补充弹药' : '坚守阵地';
    if (this.set('objt', title)) this.el.objTitle.textContent = title;
  }

  setScore(s: number) {
    this.scoreTarget = s;
  }

  /** gap in pixels; visible 0..1 */
  setCrosshair(gap: number, visible: number) {
    const g = Math.round(gap);
    if (this.set('gap', g)) this.el.cross.style.setProperty('--gap', g + 'px');
    const o = Math.round(visible * 10) / 10;
    if (this.set('chv', o)) this.el.cross.style.opacity = String(o);
  }

  setScope(on: boolean) {
    if (this.scopeOn === on) return;
    this.scopeOn = on;
    this.el.scope.classList.toggle('hidden', !on);
  }

  hitmarker(kill: boolean, head: boolean) {
    const h = this.el.hit;
    h.className = '';
    void h.offsetWidth;
    h.className = 'show' + (kill ? ' kill' : head ? ' head' : '');
  }

  /** angle: 0 = ahead, +PI/2 = right. */
  damageFrom(angle: number) {
    const d = document.createElement('div');
    d.className = 'dmg-arc';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.ring.appendChild(d);
    setTimeout(() => d.remove(), 1400);
    while (this.el.ring.children.length > 6) this.el.ring.firstChild!.remove();
  }

  popup(points: number, text: string, red = false) {
    const d = document.createElement('div');
    d.className = 'popup' + (red ? ' red' : '');
    d.innerHTML = points > 0 ? `<b>+${points}</b>${text}` : text;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1500);
    while (this.el.popups.children.length > 4) this.el.popups.firstChild!.remove();
  }

  killFeed(label: string, how: string, head: boolean) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.innerHTML = `<b>${how}</b> ${label}${head ? '<span class="hs">爆头</span>' : ''}`;
    this.el.feed.appendChild(d);
    setTimeout(() => d.remove(), 5000);
    while (this.el.feed.children.length > 5) this.el.feed.firstChild!.remove();
  }

  announce(title: string, sub: string) {
    const a = this.el.anBox;
    this.el.anTitle.textContent = title;
    this.el.anSub.textContent = sub;
    a.classList.remove('show');
    void a.offsetWidth;
    a.classList.add('show');
  }

  /** `text` may contain `[KEY]` tokens, rendered as key caps. */
  hint(text: string, seconds = 3) {
    const esc = text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
    this.el.hint.innerHTML = esc.replace(/\[([^\]]+)\]/g, '<span class="key">$1</span>');
    this.el.hint.classList.add('show');
    this.hintT = seconds;
  }

  clearHint() {
    this.hintT = 0;
    this.el.hint.classList.remove('show');
  }

  setInteract(text: string | null, key = 'F') {
    const token = text ? `${key}:${text}` : '';
    if (!this.set('interact', token)) return;
    this.el.interact.classList.toggle('show', !!text);
    this.el.interact.classList.toggle('npc-talk', key === 'E');
    if (text) {
      this.el.interactKey.textContent = key;
      this.el.interactText.textContent = text;
    }
  }

  showDeath(s: DeathStats) {
    const el = this.el.dead;
    el.classList.remove('mode-training', 'mode-highseas', 'mode-oilfield', 'mode-survival');
    el.classList.add(`mode-${s.mode}`);

    const m = Math.floor(s.time / 60), sec = Math.floor(s.time % 60);
    const timeTxt = `${m}:${sec < 10 ? '0' : ''}${sec}`;
    const accTxt = Math.round(s.accuracy * 100) + '%';

    if (s.mode === 'highseas') {
      $('dd-kicker').textContent = 'MISSION FAILED · M/V TAISHAN // 第一关 · 深海利刃';
      $('dd-title').textContent = '行动失败';
      $('dd-sub').textContent = `阵亡于 ${s.stageLabel || '泰山号战区'}`;
      $('st-score').textContent = `${s.zone ?? 1} / ${s.totalZones ?? 6} 区`;
      $('st-score-lbl').textContent = '已推进战区';
      $('st-kills').textContent = String(s.kills);
      $('st-kills-lbl').textContent = '歼灭敌军';
      $('st-head').textContent = String(s.headshots);
      $('st-head-lbl').textContent = '精准爆头';
      $('st-acc').textContent = accTxt;
      $('st-acc-lbl').textContent = '射击命中率';
      $('st-time').textContent = timeTxt;
      $('st-time-lbl').textContent = '作战时长';
      $('dd-new').classList.add('hidden');
      $('btn-retry-txt').textContent = '重新突入泰山号';
      $('btn-retry-en').textContent = 'RETRY MISSION';
    } else if (s.mode === 'oilfield') {
      $('dd-kicker').textContent = 'MISSION FAILED · KARAGANDA FIELD // 第二关 · 戈壁炼狱';
      $('dd-title').textContent = '行动失败';
      $('dd-sub').textContent = `阵亡于 ${s.stageLabel || '喀拉干达 7 号油田'}`;
      $('st-score').textContent = `${s.zone ?? 1} / ${s.totalZones ?? 6} 区`;
      $('st-score-lbl').textContent = '已推进战区';
      $('st-kills').textContent = String(s.kills);
      $('st-kills-lbl').textContent = '歼灭敌军';
      $('st-head').textContent = String(s.headshots);
      $('st-head-lbl').textContent = '精准爆头';
      $('st-acc').textContent = accTxt;
      $('st-acc-lbl').textContent = '射击命中率';
      $('st-time').textContent = timeTxt;
      $('st-time-lbl').textContent = '作战时长';
      $('dd-new').classList.add('hidden');
      $('btn-retry-txt').textContent = '重新突入油田';
      $('btn-retry-en').textContent = 'RETRY MISSION';
    } else if (s.mode === 'training') {
      $('dd-kicker').textContent = 'EXERCISE INTERRUPTED · CAMP ANVIL';
      $('dd-title').textContent = '演习中止';
      $('dd-sub').textContent = '铁砧营地实弹演习意外中断';
      $('st-score').textContent = String(s.score);
      $('st-score-lbl').textContent = '演习得分';
      $('st-kills').textContent = String(s.kills);
      $('st-kills-lbl').textContent = '命中目标';
      $('st-head').textContent = String(s.headshots);
      $('st-head-lbl').textContent = '精准爆头';
      $('st-acc').textContent = accTxt;
      $('st-acc-lbl').textContent = '射击命中率';
      $('st-time').textContent = timeTxt;
      $('st-time-lbl').textContent = '演习用时';
      $('dd-new').classList.add('hidden');
      $('btn-retry-txt').textContent = '重新开始训练';
      $('btn-retry-en').textContent = 'RESTART';
    } else {
      $('dd-kicker').textContent = 'K.I.A. · HADIR FRONTLINE // 哈迪尔防线';
      $('dd-title').textContent = '防线失守';
      $('dd-sub').textContent = s.augments && s.augments > 0
        ? `你坚守到了第 ${s.wave} 波 · 装配 ${s.augments} 项总部支援`
        : `你坚守到了第 ${s.wave} 波`;
      $('st-score').textContent = String(s.score);
      $('st-score-lbl').textContent = '总得分';
      $('st-kills').textContent = String(s.kills);
      $('st-kills-lbl').textContent = '击杀敌军';
      $('st-head').textContent = String(s.headshots);
      $('st-head-lbl').textContent = '精准爆头';
      $('st-acc').textContent = accTxt;
      $('st-acc-lbl').textContent = '命中率';
      $('st-time').textContent = timeTxt;
      $('st-time-lbl').textContent = '坚守时长';
      $('dd-new').classList.toggle('hidden', !s.record);
      $('btn-retry-txt').textContent = '重新坚守防线';
      $('btn-retry-en').textContent = 'REDEPLOY';
    }
  }

  fatal(msg: string) {
    const f = $('fatal');
    f.textContent = msg;
    f.classList.remove('hidden');
  }

  /** Pre-render the static top-down map from the collision world. */
  buildMap(world: World, info: MapInfo) {
    const half = info.half;
    const S = Math.min(6, 2048 / (half * 2)); // px per metre
    const size = Math.ceil(half * 2 * S);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = info.ground ?? 'rgba(58,52,42,0.9)';
    g.fillRect(0, 0, size, size);
    g.setTransform(S, 0, 0, S, size / 2, size / 2);
    g.fillStyle = info.road ?? 'rgba(30,30,30,0.9)';
    for (const [x, z, w, d] of info.roads) g.fillRect(x - w / 2, z - d / 2, w, d);
    // low cover first, then tall structures on top
    for (let pass = 0; pass < 2; pass++) {
      for (const col of world.colliders) {
        if (col.noRay || !col.enabled || col.tag) continue;
        const h = col.maxY;
        const tall = h > 2.2;
        if ((pass === 1) !== tall) continue;
        if (h < 0.7 || col.minY > 2.5) continue;
        if (Math.abs(col.cx) > half - 1 || Math.abs(col.cz) > half - 1) continue;
        g.save();
        g.translate(col.cx, col.cz);
        g.rotate(-Math.atan2(col.sin, col.cos));
        g.fillStyle = tall ? 'rgba(168,158,138,0.95)' : 'rgba(112,104,88,0.9)';
        g.fillRect(-col.hx, -col.hz, col.hx * 2, col.hz * 2);
        g.restore();
      }
    }
    this.mapImg = c;
    this.mapHalf = half;
    this.hudDrawT = 1;
  }

  togglePerf() {
    this.perfOn = !this.perfOn;
    this.perfEl.classList.toggle('hidden', !this.perfOn);
  }

  setPerf(dt: number, frameMs: number, calls: number, gpu: string) {
    if (!this.perfOn) return;
    this.perfT += dt;
    if (this.perfT < 0.25) return;
    this.perfT = 0;
    const fps = frameMs > 0.01 ? Math.round(1000 / frameMs) : 0;
    this.perfEl.innerHTML = `<b>${fps} FPS</b> · ${frameMs.toFixed(1)}ms · ${calls} DC · <em>${gpu}</em> [F3]`;
  }

  update(dt: number, yaw: number, px: number, pz: number, blips: MapBlip[], supplies: { x: number; z: number; ready: boolean }[], boxes: { x: number; z: number }[]) {
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.el.hint.classList.remove('show');
    }
    if (this.scoreShown !== this.scoreTarget) {
      const d = this.scoreTarget - this.scoreShown;
      this.scoreShown += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * Math.min(1, dt * 10)));
      if (Math.sign(this.scoreTarget - this.scoreShown) !== Math.sign(d)) this.scoreShown = this.scoreTarget;
      this.el.score.textContent = String(this.scoreShown);
    }
    this.hudDrawT += dt;
    if (this.hudDrawT >= 0.033) {
      this.hudDrawT = 0;
      if (Number.isNaN(this.lastCompassYaw) || Math.abs(yaw - this.lastCompassYaw) > 0.0015) {
        this.lastCompassYaw = yaw;
        this.drawCompass(yaw);
      }
      this.drawMinimap(yaw, px, pz, blips, supplies, boxes);
    }
  }

  private drawCompass(yaw: number) {
    const g = this.compass;
    const W = 720, H = 46;
    g.clearRect(0, 0, W, H);
    let bearing = ((-yaw * 180) / Math.PI) % 360;
    if (bearing < 0) bearing += 360;
    const pxPerDeg = 4.4;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 4;
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const start = Math.floor((bearing - 85) / 5) * 5;
    for (let d = start; d <= bearing + 85; d += 5) {
      const x = W / 2 + (d - bearing) * pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 45 === 0;
      const mid = dd % 15 === 0;
      g.fillStyle = major ? '#fff' : 'rgba(255,255,255,0.6)';
      g.fillRect(Math.round(x) - 1, 0, major ? 2 : 1, major ? 12 : mid ? 9 : 5);
      if (major) {
        g.font = '600 17px Bahnschrift, "Segoe UI", sans-serif';
        g.fillStyle = dd === 0 ? '#e8b04a' : '#fff';
        g.fillText(names[dd], x, 17);
      } else if (mid) {
        g.font = '12px Bahnschrift, "Segoe UI", sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillText(String(dd), x, 19);
      }
    }
    // centre marker
    g.shadowBlur = 0;
    g.fillStyle = '#e8b04a';
    g.beginPath();
    g.moveTo(W / 2 - 6, H);
    g.lineTo(W / 2 + 6, H);
    g.lineTo(W / 2, H - 8);
    g.fill();
  }

  private drawMinimap(yaw: number, px: number, pz: number, blips: MapBlip[], supplies: { x: number; z: number; ready: boolean }[], boxes: { x: number; z: number }[]) {
    const g = this.mini;
    const W = 220;
    const scale = W / 84; // show ~42 m radius
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(yaw);
    g.scale(scale, scale);
    g.translate(-px, -pz);
    if (this.mapImg) {
      const h = this.mapHalf;
      g.globalAlpha = 0.82;
      g.drawImage(this.mapImg, -h, -h, h * 2, h * 2);
      g.globalAlpha = 1;
    }
    if (this.wptPos) {
      // objective diamond, pinned to the rim when far away
      let dx = this.wptPos.x - px, dz = this.wptPos.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > 38) { dx = (dx / d) * 38; dz = (dz / d) * 38; }
      g.save();
      g.translate(px + dx, pz + dz);
      g.rotate(-yaw + Math.PI / 4);
      g.fillStyle = '#e8b04a';
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 0.4;
      g.fillRect(-1.5, -1.5, 3, 3);
      g.strokeRect(-1.5, -1.5, 3, 3);
      g.restore();
    }
    for (const s of supplies) {
      g.fillStyle = s.ready ? '#5cc8ff' : 'rgba(92,200,255,0.35)';
      g.fillRect(s.x - 1.5, s.z - 1.5, 3, 3);
      g.fillStyle = '#06202c';
      g.fillRect(s.x - 1, s.z - 0.3, 2, 0.6);
      g.fillRect(s.x - 0.3, s.z - 1, 0.6, 2);
    }
    g.fillStyle = '#e8b04a';
    for (const b of boxes) {
      g.beginPath();
      g.arc(b.x, b.z, 0.9, 0, 6.283);
      g.fill();
    }
    for (const b of blips) {
      // clamp far contacts to the rim
      let dx = b.x - px, dz = b.z - pz;
      const d = Math.hypot(dx, dz);
      const rim = d > 40;
      if (rim) {
        dx = (dx / d) * 40;
        dz = (dz / d) * 40;
      }
      if (b.friendly) {
        g.fillStyle = rim ? 'rgba(56,228,255,0.55)' : '#38e4ff';
        g.strokeStyle = 'rgba(4,16,24,0.85)';
        g.lineWidth = 0.45;
        g.beginPath();
        g.arc(px + dx, pz + dz, rim ? 1.2 : 1.55, 0, 6.283);
        g.fill();
        g.stroke();
      } else {
        const al = b.alert ?? 2;
        if (al === 0) {
          g.fillStyle = rim ? 'rgba(220,145,85,0.42)' : 'rgba(232,162,92,0.72)';
        } else if (al === 1) {
          g.fillStyle = rim ? 'rgba(255,204,56,0.68)' : '#ffd24c';
        } else {
          g.fillStyle = rim ? 'rgba(255,70,50,0.60)' : `rgba(255,${Math.round(70 - b.hot * 30)},${Math.round(50 - b.hot * 20)},${0.65 + b.hot * 0.35})`;
        }
        g.beginPath();
        g.arc(px + dx, pz + dz, rim ? 1.1 : (al === 0 ? 1.15 : 1.35) + b.hot * 0.45, 0, 6.283);
        g.fill();
        if (!rim && b.alertPulse && b.alertPulse > 0.05) {
          const prog = 1 - b.alertPulse;
          g.strokeStyle = al === 1
            ? `rgba(255,212,76,${(b.alertPulse * 0.9).toFixed(2)})`
            : `rgba(255,68,48,${(b.alertPulse * 0.95).toFixed(2)})`;
          g.lineWidth = 0.42;
          g.beginPath();
          g.arc(px + dx, pz + dz, 1.8 + prog * 3.4, 0, 6.283);
          g.stroke();
        }
      }
    }
    // player arrow (always pointing up)
    g.setTransform(1, 0, 0, 1, W / 2, W / 2);
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(6, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6, 7);
    g.closePath();
    g.stroke();
    g.fill();
    // view cone
    const grad = g.createRadialGradient(0, 0, 4, 0, 0, 70);
    grad.addColorStop(0, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 70, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath();
    g.fill();
  }
}
