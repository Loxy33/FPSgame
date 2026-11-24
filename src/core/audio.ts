import * as THREE from 'three';
import { settings } from './settings';
import { AUDIO_SAMPLES } from './audioSamples';
import { TAU, clamp, pick, rand } from './utils';

/**
 * Audio engine. Every sound effect is a real, freely licensed recording loaded
 * from /assets/audio/<name>/ (see src/core/audioSamples.ts and
 * public/assets/audio/CREDITS.md). The procedural synth below is only used as a
 * fallback when a sample cannot be loaded, so the game never goes silent.
 */

type Gen = (d: Float32Array, sr: number) => void;

class SVF {
  low = 0;
  band = 0;
  high = 0;
  private f = 0.1;
  private q = 1;
  set(fc: number, sr: number, Q: number) {
    this.f = 2 * Math.sin((Math.PI * Math.min(fc, sr / 6.5)) / sr);
    this.q = 1 / Q;
  }
  step(x: number) {
    this.low += this.f * this.band;
    this.high = x - this.low - this.q * this.band;
    this.band += this.f * this.high;
  }
}

const white = () => Math.random() * 2 - 1;

interface BurstP {
  at?: number;
  fc: number;
  fc1?: number;
  q?: number;
  tau: number;
  amp: number;
  type?: 'bp' | 'lp' | 'hp';
  attack?: number;
}
/** Adds a filtered noise burst with exponential decay. */
function burst(d: Float32Array, sr: number, p: BurstP) {
  const s = new SVF();
  const start = Math.floor((p.at ?? 0) * sr);
  const len = Math.min(d.length - start, Math.floor(p.tau * 9 * sr));
  const type = p.type ?? 'bp';
  const fc1 = p.fc1 ?? p.fc;
  const atk = p.attack ?? 0.0005;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if ((i & 15) === 0) s.set(fc1 + (p.fc - fc1) * Math.exp(-t / (p.tau * 0.7)), sr, p.q ?? 1);
    s.step(white());
    const v = type === 'bp' ? s.band : type === 'lp' ? s.low : s.high;
    d[start + i] += v * Math.exp(-t / p.tau) * Math.min(1, t / atk) * p.amp;
  }
}

interface ToneP {
  at?: number;
  f0: number;
  f1?: number;
  sweep?: number;
  tau: number;
  amp: number;
  attack?: number;
  vib?: number;
  vibRate?: number;
}
/** Adds a sine tone with optional pitch sweep. */
function tone(d: Float32Array, sr: number, p: ToneP) {
  const start = Math.floor((p.at ?? 0) * sr);
  const len = Math.min(d.length - start, Math.floor(p.tau * 9 * sr));
  const f1 = p.f1 ?? p.f0;
  const sweep = p.sweep ?? 0.03;
  const atk = p.attack ?? 0.001;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let f = f1 + (p.f0 - f1) * Math.exp(-t / sweep);
    if (p.vib) f *= 1 + p.vib * Math.sin(TAU * (p.vibRate ?? 30) * t);
    ph += (TAU * f) / sr;
    d[start + i] += Math.sin(ph) * Math.exp(-t / p.tau) * Math.min(1, t / atk) * p.amp;
  }
}

function finish(d: Float32Array, sr: number, drive = 1, peak = 0.92) {
  let m = 0;
  for (let i = 0; i < d.length; i++) {
    d[i] = Math.tanh(d[i] * drive);
    const a = Math.abs(d[i]);
    if (a > m) m = a;
  }
  const g = m > 0 ? peak / m : 1;
  const fade = Math.floor(sr * 0.008);
  for (let i = 0; i < d.length; i++) {
    let v = d[i] * g;
    const r = d.length - i;
    if (r < fade) v *= r / fade;
    d[i] = v;
  }
}

interface ShotP {
  dur: number;
  crack: number;
  body: number;
  bodyF0: number;
  bodyF1: number;
  bodyTau: number;
  thump: number;
  thumpF0: number;
  thumpF1: number;
  thumpTau: number;
  tail: number;
  tailTau: number;
  tailFc: number;
  drive: number;
  mech?: number;
}

function genShot(p: ShotP): Gen {
  return (d, sr) => {
    burst(d, sr, { fc: 5200, q: 0.6, tau: 0.0035, amp: p.crack, type: 'hp' });
    burst(d, sr, { fc: p.bodyF0, fc1: p.bodyF1, q: 0.9, tau: p.bodyTau, amp: p.body });
    burst(d, sr, { fc: p.bodyF0 * 0.45, fc1: p.bodyF1 * 0.5, q: 0.7, tau: p.bodyTau * 1.6, amp: p.body * 0.6, type: 'lp' });
    tone(d, sr, { f0: p.thumpF0, f1: p.thumpF1, sweep: 0.028, tau: p.thumpTau, amp: p.thump });
    burst(d, sr, { at: 0.006, fc: p.tailFc, fc1: p.tailFc * 0.35, q: 0.5, tau: p.tailTau, amp: p.tail, type: 'lp', attack: 0.01 });
    if (p.mech) {
      // action cycling: small metallic clacks right after the report
      burst(d, sr, { at: 0.045, fc: 3400, q: 6, tau: 0.008, amp: p.mech });
      burst(d, sr, { at: 0.075, fc: 2300, q: 5, tau: 0.01, amp: p.mech * 0.8 });
    }
    finish(d, sr, p.drive);
  };
}

export interface PlayOpts {
  vol?: number;
  rate?: number;
  rateVar?: number;
  pan?: number;
  reverb?: number;
  delay?: number;
}
export interface PlayAtOpts extends PlayOpts {
  refDist?: number;
  occluded?: boolean;
}

export class AudioEngine {
  /** Global output trim: the sampled mix is mastered hot, so the whole game sits 6 dB lower. */
  private static readonly OUTPUT_TRIM = 0.5;
  /** Global -30% gunfire volume trim applied across all player, ally, enemy, and distant weapon shots. */
  private static readonly GUNSHOT_TRIM = 0.7;
  private static readonly GUNSHOT_SOUNDS = new Set(['rifle', 'ak', 'smg', 'pistol', 'sniper']);
  ctx!: AudioContext;
  private master!: GainNode;
  private sfx!: GainNode;
  private sfxFilter!: BiquadFilterNode;
  private tinnitusOsc: OscillatorNode | null = null;
  private tinnitusGain: GainNode | null = null;
  private reverbIn!: GainNode;
  private droneGain!: GainNode;
  private menuBgmGain!: GainNode;
  private menuBgmSrc: AudioBufferSourceNode | null = null;
  private menuBgmBuffer: AudioBuffer | null = null;
  private menuBgmTarget = 0;
  private combatTrack: 'taishan' | 'oilfield' | 'hadir' | 'training' = 'hadir';
  private activeBossTrack: 'boss_kronos' | 'boss_viper' | 'boss_tyrant' | null = null;
  private activeTrackKey: string | null = null;
  private droneBaseLevel = 0.65;
  private combatBgmSrc: AudioBufferSourceNode | null = null;
  private combatBgmGain: GainNode | null = null;
  private combatBgmBuffers = new Map<string, AudioBuffer>();
  private combatBgmLoading = new Set<string>();
  private pairedBossTimer: ReturnType<typeof setTimeout> | null = null;
  private active3dSfx = 0;
  private windGain!: GainNode;
  private voiceBus!: GainNode;
  private voiceSrc: AudioBufferSourceNode | null = null;
  private buffers = new Map<string, AudioBuffer[]>();
  /** Human readable list of samples that failed to load (diagnostics). */
  readonly loadErrors: string[] = [];
  private listenerPos = new THREE.Vector3();
  private ready = false;
  private ambienceOn = false;
  private windStarted = false;
  /** When set, the synth builder only fills these sound names (used for failed downloads). */
  private onlyNames: Set<string> | null = null;
  /** Distant background: a battle around the town, or a neighbouring firing range. */
  ambience: 'war' | 'range' = 'war';
  private battleTimer = 3;
  private heartTimer = 0;

  init() {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume * AudioEngine.OUTPUT_TRIM;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.16;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfxFilter = ctx.createBiquadFilter();
    this.sfxFilter.type = 'lowpass';
    this.sfxFilter.frequency.value = 22000;
    this.sfx.connect(this.sfxFilter).connect(this.master);

    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse();
    this.reverbIn = ctx.createGain();
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.reverbIn.connect(conv).connect(revOut).connect(this.master);

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.master);
    this.menuBgmGain = ctx.createGain();
    this.menuBgmGain.gain.value = 0;
    this.menuBgmGain.connect(this.master);
    // voice-over bus: goes through the master gain so the volume slider and pause mute apply
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1;
    this.voiceBus.connect(this.master);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);

    // Samples & main menu theme stream in while the menu is up; per-map & per-boss themes load
    // on-demand when entering a map (with its paired Boss theme preloaded in the background).
    void this.loadSamples();
    void this.loadMenuBgm();
    this.ready = true;
  }

  /** Loads every manifest sample in parallel, then synthesises whatever is missing. */
  private async loadSamples() {
    const ctx = this.ctx;
    const root = `${import.meta.env.BASE_URL}assets/audio/`;
    const entries = Object.entries(AUDIO_SAMPLES);
    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const [name, files] = entries[next++];
        const list: AudioBuffer[] = [];
        for (const file of files) {
          try {
            const res = await fetch(`${root}${name}/${file}`);
            if (!res.ok) {
              this.loadErrors.push(`${name}/${file}: HTTP ${res.status}`);
              continue;
            }
            list.push(await ctx.decodeAudioData(await res.arrayBuffer()));
          } catch (e) {
            this.loadErrors.push(`${name}/${file}: ${(e as Error).message}`);
          }
        }
        if (list.length) this.buffers.set(name, list);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const missing = entries.map(([name]) => name).filter((name) => !this.buffers.has(name));
    if (missing.length) {
      this.onlyNames = new Set(missing);
      this.generateAll();
      this.onlyNames = null;
    }
    this.ready = true;
    if (this.ambienceOn) this.startAmbienceNodes();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().then(() => {
        if (this.menuBgmTarget > 0) this.ensureMenuBgmStarted();
        if (this.ambienceOn && !this.combatBgmSrc) this.startCombatTrackSource();
      }).catch(() => {});
    } else {
      if (this.menuBgmTarget > 0) this.ensureMenuBgmStarted();
      if (this.ambienceOn && !this.combatBgmSrc) this.startCombatTrackSource();
    }
  }

  /** Loads the main menu cinematic soundtrack asynchronously (separate from SFX manifest). */
  private async loadMenuBgm() {
    try {
      const url = `${import.meta.env.BASE_URL}assets/audio/menu_bgm/01.mp3`;
      const res = await fetch(url);
      if (!res.ok) return;
      this.menuBgmBuffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      if (this.menuBgmTarget > 0) this.ensureMenuBgmStarted();
    } catch {
      /* non-fatal */
    }
  }

  private static readonly COMBAT_TRACK_PATHS: Record<string, string> = {
    training: 'bgm_training/01.mp3',
    taishan: 'bgm_taishan/01.mp3',
    oilfield: 'bgm_oilfield/01.mp3',
    hadir: 'bgm_hadir/01.mp3',
    boss_kronos: 'bgm_boss_kronos/01.mp3',
    boss_viper: 'bgm_boss_viper/01.mp3',
    boss_tyrant: 'bgm_boss_tyrant/01.mp3',
  };

  private static readonly MAP_PAIRED_BOSS: Partial<Record<'taishan' | 'oilfield' | 'hadir' | 'training', 'boss_kronos' | 'boss_viper' | 'boss_tyrant'>> = {
    taishan: 'boss_kronos',
    oilfield: 'boss_viper',
    hadir: 'boss_tyrant',
  };

  /** Streams & decodes a single map or Boss soundtrack on demand, starting playback if currently wanted. */
  private async ensureCombatTrackLoaded(key: string) {
    if (!this.ctx || this.combatBgmBuffers.has(key) || this.combatBgmLoading.has(key)) return;
    const relPath = AudioEngine.COMBAT_TRACK_PATHS[key];
    if (!relPath) return;
    this.combatBgmLoading.add(key);
    try {
      const url = `${import.meta.env.BASE_URL}assets/audio/${relPath}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.combatBgmBuffers.set(key, buf);
      const wanted = this.activeBossTrack ?? this.combatTrack;
      if (this.ambienceOn && wanted === key && this.activeTrackKey !== key) {
        this.startCombatTrackSource();
      }
    } catch {
      /* non-fatal */
    } finally {
      this.combatBgmLoading.delete(key);
    }
  }

  /** Switches the active in-game map soundtrack ('taishan' | 'oilfield' | 'hadir' | 'training') & staggers its paired Boss theme preload. */
  setCombatTrack(track: 'taishan' | 'oilfield' | 'hadir' | 'training') {
    const changed = this.combatTrack !== track || this.activeBossTrack !== null;
    this.combatTrack = track;
    this.activeBossTrack = null;
    if (this.pairedBossTimer !== null) {
      clearTimeout(this.pairedBossTimer);
      this.pairedBossTimer = null;
    }
    void this.ensureCombatTrackLoaded(track);
    const pairedBoss = AudioEngine.MAP_PAIRED_BOSS[track];
    if (pairedBoss && !this.combatBgmBuffers.has(pairedBoss)) {
      // Stagger Boss MP3 decode by 4.5s so two 10-16MB tracks never compete on mission start!
      this.pairedBossTimer = setTimeout(() => {
        this.pairedBossTimer = null;
        if (this.combatTrack === track) void this.ensureCombatTrackLoaded(pairedBoss);
      }, 4500);
    }
    if (!this.ready || !this.ambienceOn) return;
    if (changed || !this.combatBgmSrc) {
      this.startCombatTrackSource();
    }
  }

  /** Smoothly engages or releases the dedicated per-Boss signature soundtrack ('boss_kronos' | 'boss_viper' | 'boss_tyrant' | null). */
  setBossMusic(bossKind: 'boss_kronos' | 'boss_viper' | 'boss_tyrant' | null) {
    if (this.activeBossTrack === bossKind) return;
    this.activeBossTrack = bossKind;
    if (bossKind) void this.ensureCombatTrackLoaded(bossKind);
    if (!this.ready || !this.ambienceOn) return;
    // Boost Boss BGM gain clearly above combat SFX during Boss encounters; restore base level once defeated!
    const targetGain = bossKind ? 0.56 : clamp(this.droneBaseLevel, 0, 1.2) * 0.42;
    this.droneGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.8);
    this.startCombatTrackSource();
  }

  /** Diagnostics helper to inspect active BGM playback state in debug verification. */
  getBgmDebugState() {
    const activeBuf = this.activeTrackKey ? this.combatBgmBuffers.get(this.activeTrackKey) : null;
    return {
      ready: this.ready,
      ctxState: this.ctx?.state ?? 'uninit',
      ambienceOn: this.ambienceOn,
      combatTrack: this.combatTrack,
      activeBossTrack: this.activeBossTrack,
      activeTrackKey: this.activeTrackKey,
      playing: Boolean(this.combatBgmSrc),
      activeDurationSec: activeBuf ? +activeBuf.duration.toFixed(1) : 0,
      loadedKeys: Array.from(this.combatBgmBuffers.keys()),
      droneGain: +(this.droneGain?.gain.value ?? 0).toFixed(3),
    };
  }

  private startCombatTrackSource() {
    if (!this.ready) return;
    const key = this.activeBossTrack ?? this.combatTrack;
    const buf = this.combatBgmBuffers.get(key);
    if (!buf) {
      void this.ensureCombatTrackLoaded(key);
      return;
    }
    if (this.combatBgmSrc && this.activeTrackKey === key) return;
    const now = this.ctx.currentTime;
    if (this.combatBgmSrc) {
      const oldSrc = this.combatBgmSrc;
      const oldGain = this.combatBgmGain;
      this.combatBgmSrc = null;
      this.combatBgmGain = null;
      if (oldGain) {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.linearRampToValueAtTime(0.0001, now + 0.55);
        setTimeout(() => {
          try { oldSrc.stop(); oldSrc.disconnect(); oldGain.disconnect(); } catch { /* ignore */ }
        }, 650);
      } else {
        try { oldSrc.stop(); oldSrc.disconnect(); } catch { /* ignore */ }
      }
    }
    const fadeGain = this.ctx.createGain();
    fadeGain.gain.setValueAtTime(0.001, now);
    fadeGain.gain.linearRampToValueAtTime(1.0, now + 0.85);
    fadeGain.connect(this.droneGain);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(fadeGain);
    src.start();
    this.combatBgmSrc = src;
    this.combatBgmGain = fadeGain;
    this.activeTrackKey = key;
  }

  private ensureMenuBgmStarted() {
    if (!this.ready || this.menuBgmSrc || !this.menuBgmBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.menuBgmBuffer;
    src.loop = true;
    src.connect(this.menuBgmGain);
    src.start();
    this.menuBgmSrc = src;
    this.menuBgmGain.gain.setTargetAtTime(this.menuBgmTarget * 0.56, this.ctx.currentTime, 1.2);
  }

  /** 0..1 level of the main menu cinematic orchestral theme ("Deep Sea Intercept"). */
  setMenuMusic(level: number, time = 1.4) {
    this.menuBgmTarget = clamp(level, 0, 1);
    if (!this.ready) return;
    if (this.menuBgmTarget > 0) this.ensureMenuBgmStarted();
    this.menuBgmGain.gain.setTargetAtTime(this.menuBgmTarget * 0.56, this.ctx.currentTime, time);
    if (this.windStarted) {
      this.windGain.gain.setTargetAtTime(this.menuBgmTarget > 0.1 ? 0.16 : 0.55, this.ctx.currentTime, time);
    }
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.setTargetAtTime(v * AudioEngine.OUTPUT_TRIM, this.ctx.currentTime, 0.05);
  }

  /** Mutes game sfx (not UI) smoothly, e.g. when paused. */
  setSfxLevel(v: number) {
    if (this.sfx) this.sfx.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  private makeImpulse() {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 2.4);
    const b = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const a = 0.5 * Math.exp(-t / 0.5) + 0.06;
        lp += a * (white() - lp);
        d[i] = lp * Math.exp(-t / 0.55) * (t < 0.012 ? t / 0.012 : 1);
      }
      // discrete slap-back echoes from surrounding buildings
      const echoes = ch === 0 ? [0.071, 0.153, 0.262, 0.41] : [0.089, 0.171, 0.305, 0.47];
      echoes.forEach((et, k) => {
        const s = Math.floor(et * sr);
        let l2 = 0;
        for (let i = 0; i < sr * 0.03; i++) {
          l2 += 0.3 * (white() - l2);
          d[s + i] += l2 * Math.exp(-i / (sr * 0.008)) * (0.9 - k * 0.17);
        }
      });
    }
    return b;
  }

  private add(name: string, dur: number, gen: Gen, variants = 1) {
    if (this.onlyNames && !this.onlyNames.has(name)) return;
    const sr = this.ctx.sampleRate;
    const list: AudioBuffer[] = [];
    for (let v = 0; v < variants; v++) {
      const b = this.ctx.createBuffer(1, Math.floor(dur * sr), sr);
      gen(b.getChannelData(0), sr);
      list.push(b);
    }
    this.buffers.set(name, list);
  }

  private generateAll() {
    // ---------- weapons ----------
    this.add('rifle', 0.7, genShot({ dur: 0.7, crack: 1.0, body: 1.5, bodyF0: 2400, bodyF1: 520, bodyTau: 0.045, thump: 1.2, thumpF0: 190, thumpF1: 52, thumpTau: 0.075, tail: 1.3, tailTau: 0.16, tailFc: 1500, drive: 2.2, mech: 0.25 }), 4);
    this.add('sniper', 1.6, genShot({ dur: 1.6, crack: 1.3, body: 1.7, bodyF0: 1700, bodyF1: 300, bodyTau: 0.09, thump: 2.0, thumpF0: 150, thumpF1: 34, thumpTau: 0.19, tail: 2.2, tailTau: 0.42, tailFc: 1000, drive: 2.8 }), 2);
    this.add('pistol', 0.5, genShot({ dur: 0.5, crack: 1.1, body: 1.2, bodyF0: 3000, bodyF1: 800, bodyTau: 0.028, thump: 0.8, thumpF0: 230, thumpF1: 75, thumpTau: 0.05, tail: 0.9, tailTau: 0.1, tailFc: 2000, drive: 1.9, mech: 0.3 }), 3);
    this.add('ak', 0.8, genShot({ dur: 0.8, crack: 0.8, body: 1.6, bodyF0: 1900, bodyF1: 380, bodyTau: 0.06, thump: 1.5, thumpF0: 170, thumpF1: 45, thumpTau: 0.09, tail: 1.6, tailTau: 0.22, tailFc: 1100, drive: 2.3 }), 4);
    this.add('smg', 0.45, genShot({ dur: 0.45, crack: 0.9, body: 1.2, bodyF0: 3200, bodyF1: 900, bodyTau: 0.025, thump: 0.7, thumpF0: 240, thumpF1: 80, thumpTau: 0.045, tail: 0.8, tailTau: 0.09, tailFc: 2200, drive: 1.8 }), 3);

    this.add('explosion', 3.2, (d, sr) => {
      burst(d, sr, { fc: 4000, q: 0.5, tau: 0.012, amp: 1.5, type: 'hp' });
      burst(d, sr, { fc: 2600, fc1: 160, q: 0.6, tau: 0.32, amp: 2.4, type: 'lp' });
      tone(d, sr, { f0: 120, f1: 26, sweep: 0.12, tau: 0.5, amp: 2.6 });
      tone(d, sr, { f0: 62, f1: 31, sweep: 0.3, tau: 0.7, amp: 1.2 });
      burst(d, sr, { at: 0.05, fc: 520, fc1: 90, q: 0.5, tau: 0.9, amp: 1.6, type: 'lp', attack: 0.04 });
      // falling debris crackle
      for (let k = 0; k < 26; k++) burst(d, sr, { at: 0.25 + Math.random() * 1.6, fc: rand(900, 4200), q: 3, tau: rand(0.006, 0.02), amp: rand(0.03, 0.14) });
      finish(d, sr, 3);
    }, 2);

    this.add('dry', 0.12, (d, sr) => {
      burst(d, sr, { fc: 3800, q: 7, tau: 0.006, amp: 1 });
      burst(d, sr, { at: 0.012, fc: 1900, q: 4, tau: 0.012, amp: 0.6 });
      finish(d, sr, 1, 0.5);
    });
    this.add('magout', 0.3, (d, sr) => {
      burst(d, sr, { fc: 2700, q: 6, tau: 0.008, amp: 1 });
      burst(d, sr, { at: 0.035, fc: 900, q: 2, tau: 0.03, amp: 0.8 });
      burst(d, sr, { at: 0.06, fc: 5200, q: 1, tau: 0.05, amp: 0.15, type: 'hp', attack: 0.02 });
      finish(d, sr, 1.2, 0.6);
    });
    this.add('magin', 0.35, (d, sr) => {
      burst(d, sr, { fc: 1300, q: 2.5, tau: 0.02, amp: 0.7 });
      burst(d, sr, { at: 0.07, fc: 3100, q: 7, tau: 0.007, amp: 1.1 });
      burst(d, sr, { at: 0.075, fc: 600, q: 1.2, tau: 0.035, amp: 1.0, type: 'lp' });
      finish(d, sr, 1.3, 0.7);
    });
    this.add('bolt', 0.4, (d, sr) => {
      burst(d, sr, { fc: 2500, q: 5, tau: 0.012, amp: 0.9 });
      burst(d, sr, { at: 0.04, fc: 4200, q: 1, tau: 0.04, amp: 0.2, type: 'hp', attack: 0.02 });
      burst(d, sr, { at: 0.13, fc: 3300, q: 8, tau: 0.009, amp: 1.2 });
      burst(d, sr, { at: 0.135, fc: 800, q: 1.5, tau: 0.03, amp: 0.9, type: 'lp' });
      tone(d, sr, { at: 0.135, f0: 3900, tau: 0.03, amp: 0.12 });
      finish(d, sr, 1.4, 0.75);
    });
    this.add('boltaction', 0.9, (d, sr) => {
      const clack = (at: number, fc: number, a: number) => {
        burst(d, sr, { at, fc, q: 7, tau: 0.009, amp: a });
        burst(d, sr, { at, fc: fc * 0.3, q: 1.5, tau: 0.025, amp: a * 0.7, type: 'lp' });
      };
      clack(0.0, 2900, 0.8);
      burst(d, sr, { at: 0.06, fc: 3600, q: 1, tau: 0.07, amp: 0.2, type: 'hp', attack: 0.03 });
      clack(0.2, 2300, 1.0);
      burst(d, sr, { at: 0.36, fc: 3600, q: 1, tau: 0.07, amp: 0.2, type: 'hp', attack: 0.03 });
      clack(0.5, 2700, 1.0);
      clack(0.62, 3400, 0.9);
      finish(d, sr, 1.3, 0.7);
    });
    this.add('equip', 0.35, (d, sr) => {
      burst(d, sr, { fc: 1800, fc1: 700, q: 0.7, tau: 0.08, amp: 0.5, attack: 0.03 });
      burst(d, sr, { at: 0.15, fc: 2800, q: 6, tau: 0.008, amp: 0.8 });
      burst(d, sr, { at: 0.19, fc: 1500, q: 3, tau: 0.015, amp: 0.5 });
      finish(d, sr, 1.1, 0.45);
    });
    this.add('shell', 0.3, (d, sr) => {
      const f = rand(4200, 6200);
      tone(d, sr, { f0: f, tau: 0.03, amp: 0.6 });
      tone(d, sr, { f0: f * 1.47, tau: 0.02, amp: 0.3 });
      tone(d, sr, { at: 0.09, f0: f * 1.05, tau: 0.025, amp: 0.35 });
      tone(d, sr, { at: 0.15, f0: f * 0.97, tau: 0.02, amp: 0.2 });
      finish(d, sr, 1, 0.25);
    }, 4);

    // ---------- movement ----------
    this.add('step_dirt', 0.22, (d, sr) => {
      burst(d, sr, { fc: rand(260, 420), q: 0.8, tau: 0.03, amp: 1, type: 'lp' });
      burst(d, sr, { at: 0.004, fc: rand(1800, 3200), q: 0.8, tau: 0.035, amp: 0.35, attack: 0.008 });
      finish(d, sr, 1.2, 0.5);
    }, 5);
    this.add('step_conc', 0.2, (d, sr) => {
      burst(d, sr, { fc: rand(500, 800), q: 1.2, tau: 0.018, amp: 1, type: 'lp' });
      burst(d, sr, { fc: rand(1500, 2400), q: 2.5, tau: 0.012, amp: 0.5 });
      finish(d, sr, 1.2, 0.5);
    }, 5);
    this.add('step_metal', 0.3, (d, sr) => {
      burst(d, sr, { fc: 600, q: 1.2, tau: 0.02, amp: 1, type: 'lp' });
      tone(d, sr, { f0: rand(380, 460), tau: 0.07, amp: 0.3 });
      tone(d, sr, { f0: rand(900, 1100), tau: 0.04, amp: 0.2 });
      finish(d, sr, 1.2, 0.5);
    }, 4);
    this.add('jump', 0.25, (d, sr) => {
      burst(d, sr, { fc: 1450, q: 0.9, tau: 0.035, amp: 0.75, attack: 0.005 });
      tone(d, sr, { f0: 75, f1: 120, sweep: 0.04, tau: 0.03, amp: 0.55 });
      finish(d, sr, 1.2, 0.5);
    }, 3);
    this.add('land', 0.35, (d, sr) => {
      burst(d, sr, { fc: 220, q: 0.8, tau: 0.055, amp: 1.2, type: 'lp' });
      burst(d, sr, { at: 0.022, fc: 1800, q: 0.8, tau: 0.045, amp: 0.45, attack: 0.005 });
      tone(d, sr, { f0: 112, f1: 44, tau: 0.055, amp: 0.85 });
      finish(d, sr, 1.4, 0.75);
    }, 3);
    this.add('land_conc', 0.35, (d, sr) => {
      burst(d, sr, { fc: 260, q: 0.8, tau: 0.05, amp: 1.2, type: 'lp' });
      burst(d, sr, { at: 0.022, fc: 2100, q: 1.0, tau: 0.035, amp: 0.45 });
      tone(d, sr, { f0: 118, f1: 42, tau: 0.05, amp: 0.85 });
      finish(d, sr, 1.4, 0.75);
    }, 3);
    this.add('land_dirt', 0.4, (d, sr) => {
      burst(d, sr, { fc: 190, q: 0.8, tau: 0.06, amp: 1.15, type: 'lp' });
      burst(d, sr, { at: 0.018, fc: 2400, q: 0.7, tau: 0.07, amp: 0.55, attack: 0.008 });
      tone(d, sr, { f0: 98, f1: 38, tau: 0.055, amp: 0.8 });
      finish(d, sr, 1.35, 0.75);
    }, 3);
    this.add('land_metal', 0.4, (d, sr) => {
      burst(d, sr, { fc: 420, q: 1.1, tau: 0.045, amp: 1.1, type: 'lp' });
      tone(d, sr, { f0: 96, f1: 48, tau: 0.06, amp: 0.85 });
      tone(d, sr, { at: 0.005, f0: 230, f1: 205, tau: 0.055, amp: 0.35 });
      finish(d, sr, 1.4, 0.75);
    }, 3);
    this.add('cloth', 0.3, (d, sr) => {
      burst(d, sr, { fc: 2400, fc1: 900, q: 0.6, tau: 0.07, amp: 0.6, attack: 0.04 });
      finish(d, sr, 1, 0.3);
    }, 2);

    // ---------- impacts ----------
    this.add('imp_conc', 0.3, (d, sr) => {
      burst(d, sr, { fc: rand(700, 1100), q: 1, tau: 0.025, amp: 1, type: 'lp' });
      burst(d, sr, { fc: rand(2600, 4200), q: 1.5, tau: 0.02, amp: 0.8 });
      for (let k = 0; k < 5; k++) burst(d, sr, { at: 0.03 + Math.random() * 0.15, fc: rand(2500, 6000), q: 4, tau: 0.006, amp: rand(0.05, 0.2) });
      finish(d, sr, 1.5, 0.7);
    }, 4);
    this.add('imp_dirt', 0.25, (d, sr) => {
      burst(d, sr, { fc: rand(300, 480), q: 0.8, tau: 0.035, amp: 1.1, type: 'lp' });
      burst(d, sr, { fc: 1700, q: 0.6, tau: 0.05, amp: 0.4, attack: 0.01 });
      finish(d, sr, 1.3, 0.6);
    }, 3);
    this.add('imp_metal', 0.4, (d, sr) => {
      const f = rand(1100, 2100);
      burst(d, sr, { fc: 3500, q: 1.2, tau: 0.012, amp: 1 });
      tone(d, sr, { f0: f, tau: 0.06, amp: 0.5 });
      tone(d, sr, { f0: f * 2.31, tau: 0.045, amp: 0.35 });
      tone(d, sr, { f0: f * 3.87, tau: 0.03, amp: 0.2 });
      finish(d, sr, 1.5, 0.7);
    }, 4);
    this.add('imp_wood', 0.25, (d, sr) => {
      burst(d, sr, { fc: rand(500, 700), q: 3, tau: 0.02, amp: 1 });
      burst(d, sr, { fc: 2200, q: 1.2, tau: 0.015, amp: 0.5 });
      finish(d, sr, 1.4, 0.65);
    }, 3);
    this.add('imp_flesh', 0.2, (d, sr) => {
      burst(d, sr, { fc: rand(350, 520), q: 1.2, tau: 0.03, amp: 1.2, type: 'lp' });
      burst(d, sr, { fc: 1400, q: 1, tau: 0.02, amp: 0.4 });
      finish(d, sr, 1.6, 0.7);
    }, 3);
    this.add('ricochet', 0.5, (d, sr) => {
      const f = rand(2600, 4200);
      tone(d, sr, { f0: f, f1: f * rand(0.35, 0.55), sweep: 0.16, tau: 0.13, amp: 0.6, vib: 0.02, vibRate: rand(30, 60) });
      burst(d, sr, { fc: 4500, q: 2, tau: 0.008, amp: 0.7 });
      finish(d, sr, 1.2, 0.45);
    }, 3);
    this.add('whiz', 0.3, (d, sr) => {
      burst(d, sr, { fc: 6000, q: 0.7, tau: 0.002, amp: 1.2, type: 'hp' });
      burst(d, sr, { at: 0.005, fc: rand(2600, 3800), fc1: rand(700, 1100), q: 4, tau: 0.06, amp: 0.9, attack: 0.02 });
      finish(d, sr, 1.3, 0.6);
    }, 4);
    this.add('bodyfall', 0.4, (d, sr) => {
      burst(d, sr, { fc: 200, q: 0.8, tau: 0.06, amp: 1.2, type: 'lp' });
      burst(d, sr, { at: 0.02, fc: 1500, q: 0.6, tau: 0.06, amp: 0.3, attack: 0.02 });
      burst(d, sr, { at: 0.11, fc: 2600, q: 4, tau: 0.01, amp: 0.2 });
      finish(d, sr, 1.3, 0.6);
    }, 2);

    // ---------- feedback ----------
    this.add('hit', 0.12, (d, sr) => {
      // Modern punchy kinetic hitmarker tick
      burst(d, sr, { fc: 3800, q: 2.8, tau: 0.008, amp: 1.0 });
      tone(d, sr, { f0: 2400, f1: 1700, sweep: 0.008, tau: 0.016, amp: 0.85 });
      burst(d, sr, { fc: 240, q: 1.2, tau: 0.02, amp: 0.7, type: 'lp' });
      finish(d, sr, 1.15, 0.55);
    });
    this.add('headshot', 0.38, (d, sr) => {
      // Crisp metallic helmet ping + heavy kinetic crunch
      tone(d, sr, { f0: 3800, f1: 2900, sweep: 0.014, tau: 0.045, amp: 1.15 });
      tone(d, sr, { at: 0.004, f0: 1720, tau: 0.11, amp: 0.85 });
      burst(d, sr, { fc: 4800, q: 4.5, tau: 0.014, amp: 1.0, type: 'hp' });
      burst(d, sr, { fc: 420, q: 1.4, tau: 0.04, amp: 1.25, type: 'lp' });
      finish(d, sr, 1.35, 0.7);
    });
    this.add('kill', 0.35, (d, sr) => {
      tone(d, sr, { f0: 880, tau: 0.05, amp: 0.6 });
      tone(d, sr, { at: 0.07, f0: 1320, tau: 0.09, amp: 0.6 });
      burst(d, sr, { fc: 500, q: 1.5, tau: 0.03, amp: 0.7, type: 'lp' });
      finish(d, sr, 1.1, 0.5);
    });
    this.add('hurt', 0.3, (d, sr) => {
      burst(d, sr, { fc: 260, q: 1, tau: 0.05, amp: 1.3, type: 'lp' });
      tone(d, sr, { f0: 110, f1: 55, tau: 0.07, amp: 1 });
      burst(d, sr, { fc: 1300, q: 1, tau: 0.02, amp: 0.5 });
      finish(d, sr, 1.8, 0.8);
    }, 3);
    this.add('heartbeat', 0.6, (d, sr) => {
      tone(d, sr, { f0: 75, f1: 42, sweep: 0.04, tau: 0.07, amp: 1 });
      tone(d, sr, { at: 0.2, f0: 68, f1: 40, sweep: 0.04, tau: 0.06, amp: 0.7 });
      finish(d, sr, 1.2, 0.8);
    });
    this.add('ui_hover', 0.06, (d, sr) => {
      tone(d, sr, { f0: 1700, tau: 0.008, amp: 0.5 });
      finish(d, sr, 1, 0.18);
    });
    this.add('ui_click', 0.2, (d, sr) => {
      tone(d, sr, { f0: 620, tau: 0.03, amp: 0.7 });
      tone(d, sr, { at: 0.03, f0: 930, tau: 0.05, amp: 0.6 });
      burst(d, sr, { fc: 2500, q: 3, tau: 0.006, amp: 0.5 });
      finish(d, sr, 1, 0.35);
    });
    this.add('pickup', 0.3, (d, sr) => {
      burst(d, sr, { fc: 2600, q: 5, tau: 0.01, amp: 0.8 });
      burst(d, sr, { at: 0.06, fc: 1700, q: 4, tau: 0.014, amp: 0.7 });
      tone(d, sr, { at: 0.06, f0: 1040, tau: 0.08, amp: 0.3 });
      finish(d, sr, 1.1, 0.5);
    });
    this.add('horn', 4.2, (d, sr) => {
      const voices = [55 * 0.994, 55, 55 * 1.006, 82.41, 110.3, 27.5];
      const amps = [0.5, 0.6, 0.5, 0.3, 0.22, 0.6];
      const ph = voices.map(() => Math.random());
      let lp = 0;
      let lp2 = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let s = 0;
        for (let v = 0; v < voices.length; v++) {
          ph[v] += voices[v] / sr;
          if (ph[v] >= 1) ph[v] -= 1;
          s += (ph[v] * 2 - 1) * amps[v];
        }
        const env = Math.min(1, t / 0.07) * (t < 1.3 ? 1 : Math.exp(-(t - 1.3) / 0.8));
        const fc = 180 + 1900 * Math.min(1, t / 0.25) * (t < 1.1 ? 1 : Math.exp(-(t - 1.1) / 0.6));
        const a = 1 - Math.exp((-TAU * fc) / sr);
        lp += a * (s - lp);
        lp2 += a * (lp - lp2);
        d[i] = lp2 * env;
      }
      tone(d, sr, { f0: 70, f1: 30, sweep: 0.1, tau: 0.4, amp: 0.9 });
      burst(d, sr, { fc: 300, q: 0.6, tau: 0.3, amp: 0.8, type: 'lp' });
      finish(d, sr, 2.2, 0.85);
    });
    this.add('waveclear', 2.2, (d, sr) => {
      [220, 277.2, 329.6, 440, 659.3].forEach((f, k) => {
        tone(d, sr, { at: k * 0.07, f0: f, tau: 0.5, amp: 0.4, attack: 0.02 });
        tone(d, sr, { at: k * 0.07, f0: f * 2.003, tau: 0.3, amp: 0.1, attack: 0.02 });
      });
      finish(d, sr, 1, 0.45);
    });
    this.add('pin', 0.2, (d, sr) => {
      burst(d, sr, { fc: 4600, q: 8, tau: 0.006, amp: 1 });
      tone(d, sr, { at: 0.02, f0: 5200, tau: 0.03, amp: 0.3 });
      burst(d, sr, { at: 0.05, fc: 3000, q: 5, tau: 0.01, amp: 0.5 });
      finish(d, sr, 1, 0.4);
    });
    this.add('throw', 0.3, (d, sr) => {
      burst(d, sr, { fc: 900, fc1: 2600, q: 1.4, tau: 0.07, amp: 1, attack: 0.05 });
      finish(d, sr, 1, 0.4);
    });
    this.add('bounce', 0.2, (d, sr) => {
      burst(d, sr, { fc: 1900, q: 5, tau: 0.012, amp: 1 });
      tone(d, sr, { f0: 2700, tau: 0.02, amp: 0.3 });
      burst(d, sr, { fc: 500, q: 1, tau: 0.02, amp: 0.6, type: 'lp' });
      finish(d, sr, 1.1, 0.5);
    }, 2);
    this.add('melee', 0.3, (d, sr) => {
      burst(d, sr, { fc: 700, fc1: 2200, q: 1.2, tau: 0.06, amp: 1, attack: 0.04 });
      finish(d, sr, 1, 0.45);
    });
    this.add('meleehit', 0.3, (d, sr) => {
      burst(d, sr, { fc: 300, q: 1, tau: 0.04, amp: 1.3, type: 'lp' });
      burst(d, sr, { fc: 1800, q: 2, tau: 0.012, amp: 0.8 });
      tone(d, sr, { f0: 130, f1: 60, tau: 0.05, amp: 0.8 });
      finish(d, sr, 1.8, 0.8);
    });
    // --- training range ---
    this.add('steel', 2.2, (d, sr) => {
      // struck steel plate: inharmonic partials, long ring
      const f = rand(560, 760);
      burst(d, sr, { fc: 4200, q: 1.5, tau: 0.004, amp: 1.2 });
      tone(d, sr, { f0: f, tau: 0.42, amp: 0.7, vib: 0.002, vibRate: 5 });
      tone(d, sr, { f0: f * 2.76, tau: 0.26, amp: 0.45 });
      tone(d, sr, { f0: f * 5.4, tau: 0.12, amp: 0.3 });
      tone(d, sr, { f0: f * 8.93, tau: 0.06, amp: 0.2 });
      tone(d, sr, { f0: f * 1.53, tau: 0.3, amp: 0.25 });
      finish(d, sr, 1.1, 0.8);
    }, 3);
    this.add('target_down', 0.4, (d, sr) => {
      burst(d, sr, { fc: rand(800, 1100), q: 2.2, tau: 0.018, amp: 1 });
      burst(d, sr, { fc: 160, q: 1, tau: 0.05, amp: 1.1, type: 'lp' });
      burst(d, sr, { at: 0.09, fc: 1300, q: 3, tau: 0.01, amp: 0.35 });
      finish(d, sr, 1.4, 0.7);
    }, 3);
    this.add('target_up', 0.55, (d, sr) => {
      tone(d, sr, { f0: 150, f1: 320, sweep: 0.15, tau: 0.08, amp: 0.25, attack: 0.05, vib: 0.08, vibRate: 42 });
      burst(d, sr, { fc: 700, q: 1.5, tau: 0.06, amp: 0.3, attack: 0.04 });
      burst(d, sr, { at: 0.3, fc: 1500, q: 3, tau: 0.012, amp: 0.9 });
      burst(d, sr, { at: 0.3, fc: 220, q: 1, tau: 0.03, amp: 0.6, type: 'lp' });
      finish(d, sr, 1.2, 0.6);
    }, 2);
    this.add('buzzer', 0.75, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.008) * (t < 0.6 ? 1 : Math.exp(-(t - 0.6) / 0.03));
        const s = Math.sign(Math.sin(TAU * 392 * t)) * 0.6 + Math.sign(Math.sin(TAU * 196.5 * t)) * 0.4;
        lp += 0.25 * (s - lp);
        d[i] = lp * env;
      }
      finish(d, sr, 1, 0.55);
    });
    this.add('radio', 0.22, (d, sr) => {
      burst(d, sr, { fc: 2800, q: 0.7, tau: 0.035, amp: 0.8, type: 'hp' });
      burst(d, sr, { fc: 1200, q: 4, tau: 0.004, amp: 1 });
      tone(d, sr, { at: 0.005, f0: 1850, tau: 0.02, amp: 0.25 });
      finish(d, sr, 1.2, 0.5);
    });
    this.add('objective', 1.0, (d, sr) => {
      tone(d, sr, { f0: 659.3, tau: 0.12, amp: 0.5, attack: 0.004 });
      tone(d, sr, { at: 0.09, f0: 987.8, tau: 0.22, amp: 0.45, attack: 0.004 });
      tone(d, sr, { at: 0.09, f0: 1975.5, tau: 0.08, amp: 0.08 });
      finish(d, sr, 1, 0.4);
    });
    // looped wind bed
    this.add('wind', 8, (d, sr) => {
      let l1 = 0;
      let l2 = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = white();
        const m = 0.5 + 0.5 * Math.sin(TAU * t * 0.125) * Math.sin(TAU * t * 0.375 + 1);
        const a = 0.012 + 0.03 * m;
        l1 += a * (n - l1);
        l2 += a * (l1 - l2);
        d[i] = l2 * (0.6 + 0.4 * m) * 6;
      }
      // crossfade ends to loop seamlessly
      const x = Math.floor(sr * 0.5);
      for (let i = 0; i < x; i++) {
        const k = i / x;
        d[i] = d[i] * k + d[d.length - x + i] * (1 - k);
      }
    });
  }

  private makeSource(name: string, o: PlayOpts) {
    const list = this.buffers.get(name);
    if (!list) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = pick(list);
    const rv = o.rateVar ?? 0.04;
    src.playbackRate.value = (o.rate ?? 1) * (1 + rand(-rv, rv));
    return src;
  }

  /** Non-positional sound (player weapon, UI, feedback). */  play(name: string, o: PlayOpts = {}) {
    if (!this.ready) return;
    const src = this.makeSource(name, o);
    if (!src) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    const gunMul = AudioEngine.GUNSHOT_SOUNDS.has(name) ? AudioEngine.GUNSHOT_TRIM : 1.0;
    g.gain.value = (o.vol ?? 1) * gunMul;
    let out: AudioNode = g;
    src.connect(g);
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p);
      out = p;
    }
    out.connect(name.startsWith('ui_') ? this.master : this.sfx);
    if (o.reverb) {
      const rg = ctx.createGain();
      rg.gain.value = o.reverb;
      out.connect(rg).connect(this.reverbIn);
    }
    src.start(ctx.currentTime + (o.delay ?? 0));
  }

  /** Positional sound with lightweight equalpower 3D spatial panning, distance attenuation, acoustic obstacle occlusion, and air absorption. */
  playAt(name: string, pos: THREE.Vector3, o: PlayAtOpts = {}) {
    if (!this.ready) return;
    const dist = pos.distanceTo(this.listenerPos);
    if (dist > 280) return;
    // Cap concurrent 3D spatial voices so massive firefights/explosions never saturate WebAudio CPU
    const isPriority = name === 'explosion' || name === 'objective' || name === 'buzzer';
    if (this.active3dSfx >= (isPriority ? 36 : 26)) return;
    const src = this.makeSource(name, o);
    if (!src) return;
    const ctx = this.ctx;
    const g = ctx.createGain();

    // equalpower 3D spatial panner preserves crisp azimuth + inverse distance rolloff at <5% of HRTF CPU cost
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = o.refDist ?? 7;
    pan.rolloffFactor = 1;
    pan.maxDistance = 400;
    pan.positionX.value = pos.x;
    pan.positionY.value = pos.y;
    pan.positionZ.value = pos.z;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    let baseFreq = clamp(20000 * Math.exp(-dist / 50), 750, 20000);
    let volMul = 1.0;
    let revMul = 1.0;

    // Acoustic obstacle occlusion (walls / covers / terrain blocking direct line-of-sight)
    if (o.occluded) {
      baseFreq = Math.min(baseFreq, 650);
      volMul = 0.58;
      revMul = 1.6;
    }
    lp.frequency.value = baseFreq;
    const gunMul = AudioEngine.GUNSHOT_SOUNDS.has(name) ? AudioEngine.GUNSHOT_TRIM : 1.0;
    g.gain.value = (o.vol ?? 1) * volMul * gunMul;

    src.connect(g).connect(lp).connect(pan).connect(this.sfx);
    let rg: GainNode | null = null;
    if (o.reverb) {
      rg = ctx.createGain();
      rg.gain.value = o.reverb * revMul * clamp(1.4 - dist / 120, 0.25, 1);
      pan.connect(rg).connect(this.reverbIn);
    }
    this.active3dSfx++;
    src.onended = () => {
      this.active3dSfx = Math.max(0, this.active3dSfx - 1);
      try {
        src.disconnect();
        g.disconnect();
        lp.disconnect();
        pan.disconnect();
        rg?.disconnect();
      } catch { /* ignore */ }
    };
    src.start(ctx.currentTime + (o.delay ?? 0) + Math.min(dist / 343, 0.45));
  }

  /**
   * Generates a sub-harmonic transient thump for player gunshots and heavy explosions,
   * providing visceral chest-thumping tactile physical recoil feel.
   */
  playSubBass(freq = 52, dur = 0.14, vol = 0.85) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.45, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(25, freq * 0.65), t + dur);

    g.gain.setValueAtTime(vol * 0.88, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);

    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /**
   * Shell-shock & tinnitus effect: close explosions heavily muffle ambient SFX with a low-pass filter
   * and engage a high-pitched ear ringing tone that fades out naturally over duration.
   */
  triggerTinnitus(intensity = 1.0, duration = 3.0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const clampInt = clamp(intensity, 0.1, 1.0);

    // 1. SFX lowpass muffling (dampens gunfire and world noise down to ~340Hz)
    this.sfxFilter.frequency.cancelScheduledValues(t);
    this.sfxFilter.frequency.setValueAtTime(this.sfxFilter.frequency.value, t);
    this.sfxFilter.frequency.exponentialRampToValueAtTime(Math.max(220, 22000 - clampInt * 21650), t + 0.04);
    this.sfxFilter.frequency.setTargetAtTime(22000, t + duration * 0.45, duration * 0.35);

    // 2. High-frequency tinnitus ringing sine tone (~4150 Hz with subtle binaural frequency variation)
    if (this.tinnitusOsc) {
      try { this.tinnitusOsc.stop(); } catch {}
      this.tinnitusOsc = null;
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(4150 + rand(-40, 40), t);

    const targetVol = clampInt * 0.28;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(targetVol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
    this.tinnitusOsc = osc;
    this.tinnitusGain = g;
    osc.onended = () => {
      if (this.tinnitusOsc === osc) {
        this.tinnitusOsc = null;
        this.tinnitusGain = null;
      }
    };
  }

  /**
   * Plays a decoded voice-over clip. Nearby NPCs speak with natural full-bandwidth human warmth;
   * distant radio comms use a clean modern wideband tactical headset contour (170Hz–6.2kHz) instead
   * of harsh narrowband telephone filtering. Only one line plays at a time.
   */
  playVoice(buffer: AudioBuffer, o: { vol?: number; radio?: boolean; rate?: number } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    this.stopVoice();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 0.92;
    let node: AudioNode = src;
    if (o.radio) {
      // Modern digital tactical headset comms: clear and intelligible without tinny robotic buzz
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 170;
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 2400;
      peak.Q.value = 0.75;
      peak.gain.value = 1.4;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6200;
      src.connect(hp).connect(peak).connect(lp);
      node = lp;
    } else {
      // Natural face-to-face human speech: keep full chest warmth & crisp vocal breath/air
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 75;
      const warm = ctx.createBiquadFilter();
      warm.type = 'lowshelf';
      warm.frequency.value = 165;
      warm.gain.value = 1.5;
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 6500;
      air.gain.value = 1.0;
      src.connect(hp).connect(warm).connect(air);
      node = air;
    }
    node.connect(g).connect(this.voiceBus);
    this.voiceSrc = src;
    src.onended = () => {
      if (this.voiceSrc === src) this.voiceSrc = null;
    };
    src.start();
  }

  stopVoice() {
    if (!this.voiceSrc) return;
    try {
      this.voiceSrc.stop();
    } catch {
      /* already stopped */
    }
    this.voiceSrc = null;
  }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3) {
    if (!this.ready) return;
    this.listenerPos.copy(pos);
    const l = this.ctx.listener as any;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  startAmbience() {
    if (!this.ready || this.ambienceOn) return;
    this.ambienceOn = true;
    this.startAmbienceNodes();
    this.startDrone();
  }

  /** Starts the wind bed once the looped sample is decoded. */
  private startAmbienceNodes() {
    if (this.windStarted) return;
    const wind = this.buffers.get('wind');
    if (!wind || !wind.length) return;
    this.windStarted = true;
    const ctx = this.ctx;
    const w = ctx.createBufferSource();
    w.buffer = wind[0];
    w.loop = true;
    w.connect(this.windGain);
    w.start();
    this.windGain.gain.setTargetAtTime(0.55, ctx.currentTime, 2.5);
  }

  private startDrone() {
    this.startCombatTrackSource();
  }

  /** 0..1 level of the active tactical combat soundtrack composition. */
  setDrone(level: number, time = 1.5) {
    this.droneBaseLevel = level;
    if (!this.ready) return;
    if (level > 0 && this.ambienceOn && !this.combatBgmSrc) {
      this.startCombatTrackSource();
    }
    const target = this.activeBossTrack && level > 0 ? 0.56 : clamp(level, 0, 1.2) * 0.42;
    this.droneGain.gain.setTargetAtTime(target, this.ctx.currentTime, time);
  }

  /** Background battlefield ambience + low-health heartbeat. */
  update(dt: number, inGame: boolean, lowHealth: number) {
    if (!this.ready || !this.ambienceOn || !inGame) return;
    this.battleTimer -= dt;
    if (this.battleTimer <= 0 && this.ambience === 'range') {
      // a neighbouring range: paced single shots and pairs, the odd grenade far off
      this.battleTimer = rand(1.6, 5.5);
      const pan = rand(-0.8, 0.8);
      if (Math.random() < 0.08) this.distant('explosion', 0.06, pan, 0, rand(0.75, 0.9));
      else {
        const n = Math.random() < 0.6 ? 1 : randInt2(2, 3);
        for (let i = 0; i < n; i++) this.distant('rifle', rand(0.035, 0.06), pan, i * rand(0.28, 0.5), rand(0.85, 0.95));
      }
    } else if (this.battleTimer <= 0) {
      this.battleTimer = rand(3.5, 11);
      const pan = rand(-0.9, 0.9);
      const r = Math.random();
      if (r < 0.25) {
        this.distant('explosion', 0.1, pan, 0, rand(0.6, 0.85));
      } else {
        const n = randInt2(2, 7);
        const name = Math.random() < 0.5 ? 'ak' : 'rifle';
        const gap = rand(0.085, 0.13);
        for (let i = 0; i < n; i++) this.distant(name, rand(0.05, 0.09), pan, i * gap, rand(0.8, 0.9));
      }
    }
    if (inGame && lowHealth > 0.01) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 0.85 - lowHealth * 0.2;
        this.play('heartbeat', { vol: 0.5 + lowHealth * 0.7, rateVar: 0 });
      }
    }
  }

  private distant(name: string, vol: number, pan: number, delay: number, rate: number) {
    const src = this.makeSource(name, { rate, rateVar: 0.03 });
    if (!src) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    const gunMul = AudioEngine.GUNSHOT_SOUNDS.has(name) ? AudioEngine.GUNSHOT_TRIM : 1.0;
    g.gain.value = vol * gunMul;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = rand(450, 800);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(lp).connect(p).connect(this.sfx);
    const rg = ctx.createGain();
    rg.gain.value = 1.2;
    p.connect(rg).connect(this.reverbIn);
    src.start(ctx.currentTime + delay);
  }
}

function randInt2(a: number, b: number) {
  return Math.floor(rand(a, b + 1));
}

export const audio = new AudioEngine();
