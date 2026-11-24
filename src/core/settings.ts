export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  fov: number;
  volume: number;
  quality: Quality;
}

const KEY = 'redsand.settings.v1';

export const settings: Settings = {
  sensitivity: 1,
  fov: 78,
  volume: 0.8,
  quality: 'high',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<Settings>;
    if (typeof s.sensitivity === 'number') settings.sensitivity = Math.min(3, Math.max(0.2, s.sensitivity));
    if (typeof s.fov === 'number') settings.fov = Math.min(100, Math.max(60, s.fov));
    if (typeof s.volume === 'number') settings.volume = Math.min(1, Math.max(0, s.volume));
    if (s.quality === 'low' || s.quality === 'medium' || s.quality === 'high') settings.quality = s.quality;
  } catch {
    /* ignore corrupted settings */
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable */
  }
}
