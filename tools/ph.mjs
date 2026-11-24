// Poly Haven (CC0) download helpers with an on-disk cache under assets-src/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'assets-src');
export const OUT = path.join(ROOT, 'public', 'assets');

export async function download(url, dest, tries = 4) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'greatfps-asset-fetch' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest + '.part', buf);
      fs.renameSync(dest + '.part', dest);
      return dest;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

const filesCache = new Map();
export async function phFiles(id) {
  if (filesCache.has(id)) return filesCache.get(id);
  const cache = path.join(SRC, 'ph', 'api', `${id}.json`);
  await download(`https://api.polyhaven.com/files/${id}`, cache);
  const j = JSON.parse(fs.readFileSync(cache, 'utf8'));
  filesCache.set(id, j);
  return j;
}

/** Download a Poly Haven model as .gltf + .bin + textures. Returns the local .gltf path. */
export async function phModel(id, res = '1k') {
  const files = await phFiles(id);
  const g = files.gltf?.[res]?.gltf;
  if (!g) throw new Error(`no gltf ${res} for ${id}`);
  const dir = path.join(SRC, 'ph', 'models', `${id}_${res}`);
  const main = path.join(dir, path.basename(g.url));
  await download(g.url, main);
  await Promise.all(Object.entries(g.include || {}).map(([rel, f]) => download(f.url, path.join(dir, rel))));
  return main;
}

const MAP_KEYS = { diff: ['Diffuse', 'diff', 'col_1', 'col_01'], nor: ['nor_gl'], arm: ['arm'], rough: ['Rough', 'rough'], disp: ['Displacement', 'disp'], ao: ['AO', 'ao'] };

/** Download texture maps (jpg). Returns { diff, nor, arm, ... } local paths. */
export async function phTexture(id, res = '1k', maps = ['diff', 'nor', 'arm']) {
  const files = await phFiles(id);
  const out = {};
  for (const m of maps) {
    const key = MAP_KEYS[m].find((k) => files[k]?.[res]?.jpg || files[k]?.[res]?.png);
    if (!key) {
      if (m === 'diff' || m === 'nor') throw new Error(`no ${m} ${res} jpg for ${id}: ${Object.keys(files).join(',')}`);
      continue;
    }
    const entry = files[key][res];
    const f = entry.jpg || entry.png;
    const ext = entry.jpg ? 'jpg' : 'png';
    out[m] = await download(f.url, path.join(SRC, 'ph', 'tex', `${id}_${m}_${res}.${ext}`));
  }
  return out;
}

/** Download an HDRI: { hdr, jpg } (jpg = tonemapped preview at full width, if present). */
export async function phHdri(id, res = '2k') {
  const files = await phFiles(id);
  const out = {};
  out.hdr = await download(files.hdri[res].hdr.url, path.join(SRC, 'ph', 'hdri', `${id}_${res}.hdr`));
  if (files.tonemapped?.url) out.jpg = await download(files.tonemapped.url, path.join(SRC, 'ph', 'hdri', `${id}_tonemapped.jpg`));
  return out;
}
