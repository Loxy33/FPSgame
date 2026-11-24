import { audio } from './audio';

/**
 * Subtitle voice-over. Lines are pre-synthesised neural TTS clips under /assets/voice, keyed by
 * a stable hash of the subtitle text. Anything without a clip (the scripted lines that splice in
 * numbers at runtime) falls back to the browser's speech synthesiser.
 */
interface VoiceEntry {
  file: string;
  who: string;
  text: string;
}

const ROOT = `${import.meta.env.BASE_URL}assets/voice/`;
const enc = new TextEncoder();
let manifest: Record<string, VoiceEntry> = {};
let preloaded = false;
const cache = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
/** Monotonic token so a slow clip cannot talk over a newer line. */
let current = 0;

/** FNV-1a over the UTF-8 bytes: must match assets-src/voice/gen.py. */
export function voiceKey(text: string) {
  let h = 0x811c9dc5;
  for (const b of enc.encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function fetchClip(file: string): Promise<AudioBuffer | null> {
  const hit = cache.get(file);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(file);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetch(ROOT + file);
      if (!res.ok) return null;
      const buf = await audio.ctx.decodeAudioData(await res.arrayBuffer());
      cache.set(file, buf);
      return buf;
    } catch {
      return null;
    } finally {
      loading.delete(file);
    }
  })();
  loading.set(file, p);
  return p;
}

/** Fetches the manifest and decodes every clip in the background (called once the audio engine is up). */
export async function preloadVoice() {
  if (preloaded || !audio.ctx) return;
  preloaded = true;
  try {
    const res = await fetch(ROOT + 'manifest.json');
    if (res.ok) manifest = (await res.json()) as Record<string, VoiceEntry>;
  } catch {
    manifest = {};
  }
  const files = [...new Set(Object.values(manifest).map((e) => e.file))];
  // a few at a time so decoding never stalls a frame for long
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(files.slice(i, i + 4).map((f) => fetchClip(f)));
  }
}

function browserFallback(who: string, text: string) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.pitch = 1.0;
    u.rate = who === '孙班长' ? 1.08 : 1.0;
    u.volume = 0.9;
    const zh = synth.getVoices().find((v) => /zh[-_]CN/i.test(v.lang) && /Online|Natural|Yun|Xiao/i.test(v.name));
    if (zh) u.voice = zh;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* speech synthesis unavailable: subtitles only */
  }
}

/** Length of the generated clip for this line, or 0 when there is none yet. */
export function clipDuration(text: string) {
  const entry = manifest[voiceKey(text)];
  if (!entry) return 0;
  const buf = cache.get(entry.file);
  return buf ? buf.duration : 0;
}

/** Speaks a subtitle line; clips are looked up by the exact text shown on screen (or voiceText override). */
export function speak(who: string, text: string, radio = false) {
  const token = ++current;
  if (!preloaded) {
    void preloadVoice().then(() => {
      if (token === current) playLine(who, text, token, radio);
    });
    return;
  }
  playLine(who, text, token, radio);
}

function playLine(who: string, text: string, token: number, radio: boolean) {
  const entry = manifest[voiceKey(text)];
  if (!entry) {
    browserFallback(who, text);
    return;
  }
  const buf = cache.get(entry.file);
  if (buf) {
    audio.playVoice(buf, { vol: 0.95, radio });
    return;
  }
  void fetchClip(entry.file).then((loaded) => {
    if (!loaded || token !== current) return;
    audio.playVoice(loaded, { vol: 0.95, radio });
  });
}

/** Stops the current line (subtitle cleared, mission ended, pause menu). */
export function stopVoice() {
  current++;
  audio.stopVoice();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}
