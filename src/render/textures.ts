import * as THREE from 'three';
import { TileNoise, clamp, mulberry32, smoothstep } from '../core/utils';

/**
 * Procedural PBR texture synthesis. Each material is described by a per-texel
 * function that yields albedo, height and roughness; normal maps are derived
 * from the height field. Everything tiles seamlessly.
 */

export interface TexSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Roughness in the green channel (so a packed AO/roughness/metal map works too). */
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
  /** Mean linear-space green of the albedo; used to normalise macro variation. */
  meanG: number;
}

/** out = [r, g, b, height, roughness] (all 0..1, colors in sRGB space) */
type PixelFn = (u: number, v: number, out: Float32Array) => void;

let maxAniso = 16;
export function setMaxAnisotropy(a: number) {
  maxAniso = a;
}

function dataTex(data: Uint8Array, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function generate(size: number, fn: PixelFn, normalStrength: number): TexSet {
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const out = new Float32Array(5);
  let sumG = 0;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      fn(x / size, v, out);
      const i = y * size + x;
      const j = i * 4;
      albedo[j] = clamp(out[0], 0, 1) * 255;
      albedo[j + 1] = clamp(out[1], 0, 1) * 255;
      sumG += Math.pow(clamp(out[1], 0, 1), 2.2);
      albedo[j + 2] = clamp(out[2], 0, 1) * 255;
      albedo[j + 3] = 255;
      height[i] = out[3];
      const r = clamp(out[4], 0, 1) * 255;
      rough[j] = r;
      rough[j + 1] = r;
      rough[j + 2] = 0;
      rough[j + 3] = 255;
    }
  }
  const s = normalStrength * (size / 512);
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const yu = ((y + 1) & mask) * size;
    const yd = ((y - 1) & mask) * size;
    for (let x = 0; x < size; x++) {
      const dx = (height[y * size + ((x + 1) & mask)] - height[y * size + ((x - 1) & mask)]) * s;
      const dy = (height[yu + x] - height[yd + x]) * s;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const j = (y * size + x) * 4;
      normal[j] = (-dx * il * 0.5 + 0.5) * 255;
      normal[j + 1] = (-dy * il * 0.5 + 0.5) * 255;
      normal[j + 2] = (il * 0.5 + 0.5) * 255;
      normal[j + 3] = 255;
    }
  }
  return {
    map: dataTex(albedo, size, true),
    normalMap: dataTex(normal, size, false),
    roughnessMap: dataTex(rough, size, false),
    meanG: sumG / n,
  };
}

/** Neutral hard-surface detail maps for first-person weapons (tinted by material colour). */
export function makeGunTextures(): TexSet {
  const a = new TileNoise(201);
  const b = new TileNoise(202);
  return generate(512, (u, v, o) => {
    const n = a.fbm(u, v, 5, 5);
    const fine = b.fbm(u, v, 128, 2);
    const blot = a.fbm(u + 0.31, v + 0.67, 14, 3);
    // sparse hairline scratches running along the part
    const scr = smoothstep(0.8, 0.83, b.fbm2(u + 0.2, v + 0.7, 3, 128, 2)) * smoothstep(0.5, 0.7, a.fbm(u + 0.5, v + 0.1, 6, 2));
    const c = 0.84 + (n - 0.5) * 0.22 + (fine - 0.5) * 0.1 + scr * 0.3 - smoothstep(0.6, 0.85, blot) * 0.08;
    o[0] = c;
    o[1] = c;
    o[2] = c;
    o[3] = fine * 0.3 - scr * 0.25;
    o[4] = 0.62 + (n - 0.5) * 0.4 + (fine - 0.5) * 0.2 - scr * 0.25 + smoothstep(0.6, 0.85, blot) * 0.15;
  }, 0.7);
}

export type TexName =
  | 'concrete' | 'plaster' | 'cinder' | 'sand' | 'asphalt' | 'corrugated'
  | 'metal' | 'wood' | 'burlap' | 'hesco' | 'camo' | 'fabric';

const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Thin crack mask from a ridged noise isoline. */
function crack(n: number, width: number) {
  return 1 - smoothstep(0, width, Math.abs(n - 0.5));
}

export function buildTexture(name: TexName, hi: boolean): TexSet {
  const big = hi ? 1024 : 512;
  switch (name) {
    case 'concrete': {
      const a = new TileNoise(11);
      const b = new TileNoise(12);
      return generate(big, (u, v, o) => {
        const n1 = a.fbm(u, v, 4, 6);
        const n2 = b.fbm(u, v, 48, 3);
        const stain = a.fbm(u + 0.37, v + 0.71, 2, 5);
        const pore = b.fbm(u + 0.2, v + 0.4, 96, 2);
        const p = smoothstep(0.7, 0.8, pore);
        const cr = crack(a.fbm(u + 0.11, v + 0.53, 3, 5), 0.006) * smoothstep(0.45, 0.6, b.fbm(u, v, 3, 2));
        // faint formwork seams
        const seam = 1 - smoothstep(0, 0.004, Math.abs(((v * 2) % 1) - 0.5));
        let c = 0.56 + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.12;
        c -= smoothstep(0.52, 0.8, stain) * 0.2;
        c *= 1 - p * 0.35 - cr * 0.55 - seam * 0.12;
        o[0] = c * 1.0;
        o[1] = c * 0.985;
        o[2] = c * 0.95;
        o[3] = n2 * 0.35 + n1 * 0.4 - p * 0.5 - cr * 0.8 - seam * 0.25;
        o[4] = 0.88 - (n1 - 0.5) * 0.2 + p * 0.1;
      }, 2.2);
    }
    case 'plaster': {
      const a = new TileNoise(21);
      const b = new TileNoise(22);
      return generate(big, (u, v, o) => {
        const blot = a.fbm(u, v, 3, 6);
        const fine = b.fbm(u, v, 64, 3);
        const chipN = a.fbm(u + 0.5, v + 0.25, 5, 5);
        const chip = smoothstep(0.64, 0.67, chipN + (fine - 0.5) * 0.08);
        const cr = crack(b.fbm(u + 0.3, v + 0.6, 4, 5), 0.005) * smoothstep(0.4, 0.62, a.fbm(u + 0.8, v + 0.1, 2, 3));
        const streak = b.fbm2(u, v, 24, 2, 3);
        let c = 0.84 + (blot - 0.5) * 0.22 + (fine - 0.5) * 0.07 - smoothstep(0.55, 0.9, streak) * 0.12;
        c *= 1 - cr * 0.5;
        // chipped plaster exposes darker render underneath
        const under = 0.5 + (fine - 0.5) * 0.25;
        const cc = c + (under - c) * chip;
        o[0] = cc;
        o[1] = cc * (1 - chip * 0.03);
        o[2] = cc * (1 - chip * 0.08);
        o[3] = fine * 0.3 + blot * 0.15 - chip * 0.55 - cr * 0.7 + (chip > 0.5 ? fine * 0.4 : 0);
        o[4] = 0.9 - chip * 0.05;
      }, 2.0);
    }
    case 'cinder': {
      const a = new TileNoise(31);
      const cols = 5;
      const rows = 10;
      return generate(big, (u, v, o) => {
        const ry = v * rows;
        const row = Math.floor(ry);
        const fy = ry - row;
        const rx = u * cols + (row & 1) * 0.5;
        const col = Math.floor(rx);
        const fx = rx - col;
        const mx = Math.min(fx, 1 - fx) * (1 / cols) * 2.0;
        const my = Math.min(fy, 1 - fy) * (1 / rows) * 2.0;
        const edge = Math.min(mx / 0.012, my / 0.012);
        const mortar = 1 - smoothstep(0.6, 1.0, edge);
        const blockTone = hash2(col % cols, row) * 0.16 - 0.08;
        const grain = a.fbm(u, v, 96, 2);
        const blot = a.fbm(u + 0.3, v + 0.1, 6, 4);
        let c = 0.5 + blockTone + (grain - 0.5) * 0.2 + (blot - 0.5) * 0.14;
        c = c + (0.62 + (grain - 0.5) * 0.1 - c) * mortar;
        o[0] = c;
        o[1] = c * 0.98;
        o[2] = c * 0.94;
        o[3] = (1 - mortar) * 0.6 + grain * 0.3 + smoothstep(0, 0.35, edge) * 0.1;
        o[4] = 0.93;
      }, 2.6);
    }
    case 'sand': {
      const a = new TileNoise(41);
      const b = new TileNoise(42);
      const rnd = mulberry32(43);
      const G = 40;
      const peb = new Float32Array(G * G * 4);
      for (let i = 0; i < G * G; i++) {
        peb[i * 4] = rnd();
        peb[i * 4 + 1] = rnd();
        peb[i * 4 + 2] = rnd() < 0.13 ? 0.07 + rnd() * 0.24 : 0;
        peb[i * 4 + 3] = rnd();
      }
      return generate(big, (u, v, o) => {
        const n1 = a.fbm(u, v, 5, 6);
        const n2 = b.fbm(u, v, 80, 3);
        const ripple = b.fbm2(u + n1 * 0.05, v, 6, 40, 3);
        // pebbles
        let ph = 0;
        let pt = 0;
        const gx = u * G;
        const gy = v * G;
        const cx = Math.floor(gx);
        const cy = Math.floor(gy);
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const ix = (cx + i + G) % G;
            const iy = (cy + j + G) % G;
            const k = (iy * G + ix) * 4;
            const r = peb[k + 2];
            if (r === 0) continue;
            const dx = gx - (cx + i + peb[k]);
            const dy = gy - (cy + j + peb[k + 1]);
            const d = Math.sqrt(dx * dx + dy * dy) / r;
            if (d < 1) {
              const h = Math.sqrt(1 - d * d);
              if (h > ph) {
                ph = h;
                pt = peb[k + 3];
              }
            }
          }
        }
        let c = 0.78 + (n1 - 0.5) * 0.36 + (n2 - 0.5) * 0.2 + (ripple - 0.5) * 0.08;
        let r = c * 0.86;
        let g = c * 0.72;
        let bl = c * 0.53;
        if (ph > 0) {
          const pc = 0.36 + pt * 0.3;
          const k = smoothstep(0, 0.45, ph) * 0.85;
          r += (pc - r) * k;
          g += (pc * 0.9 - g) * k;
          bl += (pc * 0.76 - bl) * k;
        }
        o[0] = r;
        o[1] = g;
        o[2] = bl;
        o[3] = n2 * 0.3 + n1 * 0.35 + (ripple - 0.5) * 0.15 + ph * 0.35;
        o[4] = 0.96 - ph * 0.1;
      }, 2.4);
    }
    case 'asphalt': {
      const a = new TileNoise(51);
      const b = new TileNoise(52);
      return generate(big, (u, v, o) => {
        const n1 = a.fbm(u, v, 4, 5);
        const agg = b.fbm(u, v, 128, 2);
        const agg2 = b.fbm(u + 0.5, v + 0.5, 64, 2);
        const cr = crack(a.fbm(u + 0.61, v + 0.17, 4, 5), 0.007) * smoothstep(0.42, 0.6, b.fbm(u, v, 3, 2));
        const dust = smoothstep(0.5, 0.8, a.fbm(u + 0.2, v + 0.9, 3, 4));
        let c = 0.2 + (n1 - 0.5) * 0.1 + smoothstep(0.62, 0.8, agg) * 0.16 + (agg2 - 0.5) * 0.06;
        c *= 1 - cr * 0.6;
        o[0] = c + dust * 0.16;
        o[1] = c + dust * 0.125;
        o[2] = c + dust * 0.07;
        o[3] = agg * 0.5 + agg2 * 0.2 - cr * 0.9;
        o[4] = 0.86 + dust * 0.1;
      }, 2.0);
    }
    case 'corrugated': {
      const a = new TileNoise(61);
      const b = new TileNoise(62);
      return generate(512, (u, v, o) => {
        const w = Math.sin(u * Math.PI * 2 * 12);
        const corr = clamp(w * 1.7, -1, 1);
        const dirt = b.fbm2(u, v, 32, 3, 4);
        const rustN = a.fbm(u, v, 6, 5);
        const rust = smoothstep(0.6, 0.72, rustN + (dirt - 0.5) * 0.2);
        const scr = smoothstep(0.78, 0.8, b.fbm2(u + 0.3, v + 0.1, 4, 96, 2));
        let r = 0.86 + (dirt - 0.5) * 0.22 + corr * 0.04;
        let g = r;
        let bl = r;
        r += (0.5 - r) * rust;
        g += (0.27 - g) * rust;
        bl += (0.14 - bl) * rust;
        r -= scr * 0.2;
        g -= scr * 0.2;
        bl -= scr * 0.2;
        o[0] = r;
        o[1] = g;
        o[2] = bl;
        o[3] = corr * 0.5 + 0.5 + rust * (a.fbm(u, v, 64, 2) - 0.5) * 0.2;
        o[4] = 0.5 + rust * 0.4 + (dirt - 0.5) * 0.25;
      }, 3.2);
    }
    case 'metal': {
      const a = new TileNoise(71);
      const b = new TileNoise(72);
      return generate(512, (u, v, o) => {
        const n = a.fbm(u, v, 4, 5);
        const dust = b.fbm2(u, v, 16, 3, 4);
        const scr = smoothstep(0.74, 0.77, b.fbm2(u + 0.2, v + 0.7, 96, 3, 2)) * 0.6 + smoothstep(0.76, 0.79, b.fbm2(u + 0.6, v + 0.3, 5, 128, 2)) * 0.5;
        const rust = smoothstep(0.66, 0.76, a.fbm(u + 0.4, v + 0.2, 7, 5));
        let r = 0.88 + (n - 0.5) * 0.14 - (dust - 0.5) * 0.12;
        let g = r;
        let bl = r;
        r += (0.47 - r) * rust * 0.8;
        g += (0.26 - g) * rust * 0.8;
        bl += (0.14 - bl) * rust * 0.8;
        r -= scr * 0.18;
        g -= scr * 0.18;
        bl -= scr * 0.18;
        o[0] = r;
        o[1] = g;
        o[2] = bl;
        o[3] = n * 0.2 - scr * 0.3 + rust * 0.15;
        o[4] = 0.46 + (dust - 0.5) * 0.3 + rust * 0.4 + scr * 0.1;
      }, 1.2);
    }
    case 'wood': {
      const a = new TileNoise(81);
      const b = new TileNoise(82);
      const planks = 4;
      return generate(512, (u, v, o) => {
        const px = u * planks;
        const pi = Math.floor(px);
        const fx = px - pi;
        const gap = 1 - smoothstep(0.0, 0.04, Math.min(fx, 1 - fx));
        const off = hash2(pi, 3.7);
        const grain = a.fbm2(u + off * 0.37, v + off, 64, 4, 4);
        const ring = Math.sin((grain * 9 + u * planks * 3) * Math.PI) * 0.5 + 0.5;
        const knot = b.fbm(u + off, v, 6, 3);
        let c = 0.62 + (grain - 0.5) * 0.4 + (ring - 0.5) * 0.12 + (off - 0.5) * 0.18 - smoothstep(0.7, 0.8, knot) * 0.25;
        c *= 1 - gap * 0.75;
        o[0] = c * 0.9;
        o[1] = c * 0.7;
        o[2] = c * 0.47;
        o[3] = grain * 0.35 + ring * 0.12 - gap * 1.0;
        o[4] = 0.8;
      }, 2.2);
    }
    case 'burlap': {
      const a = new TileNoise(91);
      return generate(512, (u, v, o) => {
        const wx = Math.sin(u * Math.PI * 2 * 72);
        const wy = Math.sin(v * Math.PI * 2 * 72);
        const weave = wx * wy * 0.5 + 0.5;
        const n = a.fbm(u, v, 5, 5);
        const fine = a.fbm(u + 0.4, v + 0.2, 96, 2);
        const c = 0.72 + (n - 0.5) * 0.3 + (weave - 0.5) * 0.14 + (fine - 0.5) * 0.12;
        o[0] = c * 0.92;
        o[1] = c * 0.82;
        o[2] = c * 0.62;
        o[3] = weave * 0.5 + n * 0.4;
        o[4] = 0.95;
      }, 2.0);
    }
    case 'hesco': {
      const a = new TileNoise(101);
      const cells = 10;
      return generate(512, (u, v, o) => {
        const gx = u * cells;
        const gy = v * cells;
        const fx = Math.abs(gx - Math.round(gx));
        const fy = Math.abs(gy - Math.round(gy));
        const wire = 1 - smoothstep(0.03, 0.06, Math.min(fx, fy));
        const n = a.fbm(u, v, 4, 5);
        const fine = a.fbm(u + 0.4, v + 0.2, 96, 2);
        const bulge = Math.cos(fx * Math.PI) * Math.cos(fy * Math.PI);
        const sag = a.fbm2(u, v, 3, 12, 3);
        const c = 0.7 + (n - 0.5) * 0.28 + (fine - 0.5) * 0.14 - (sag - 0.5) * 0.12;
        let r = c * 0.9;
        let g = c * 0.82;
        let b = c * 0.66;
        r += (0.34 - r) * wire;
        g += (0.35 - g) * wire;
        b += (0.36 - b) * wire;
        o[0] = r;
        o[1] = g;
        o[2] = b;
        o[3] = bulge * 0.35 + wire * 0.5 + fine * 0.15;
        o[4] = 0.95 - wire * 0.45;
      }, 2.4);
    }
    case 'camo': {
      const a = new TileNoise(111);
      const b = new TileNoise(112);
      const c2 = new TileNoise(113);
      return generate(512, (u, v, o) => {
        const n1 = a.fbm2(u, v, 5, 3, 4);
        const n2 = b.fbm2(u + 0.3, v + 0.6, 6, 4, 4);
        const n3 = c2.fbm2(u + 0.7, v + 0.2, 9, 6, 3);
        const n4 = a.fbm(u + 0.15, v + 0.85, 24, 2);
        const weave = Math.sin(u * Math.PI * 2 * 128) * Math.sin(v * Math.PI * 2 * 128) * 0.5 + 0.5;
        let r = 0.6;
        let g = 0.54;
        let bl = 0.4;
        if (n1 > 0.54) { r = 0.36; g = 0.39; bl = 0.25; }
        if (n2 > 0.6) { r = 0.39; g = 0.3; bl = 0.2; }
        if (n3 > 0.66) { r = 0.75; g = 0.7; bl = 0.57; }
        if (n4 > 0.74) { r = 0.2; g = 0.2; bl = 0.15; }
        const sh = 0.9 + weave * 0.14;
        o[0] = r * sh;
        o[1] = g * sh;
        o[2] = bl * sh;
        o[3] = weave * 0.6 + a.fbm(u, v, 8, 3) * 0.6;
        o[4] = 0.92;
      }, 1.6);
    }
    case 'fabric': {
      const a = new TileNoise(121);
      return generate(256, (u, v, o) => {
        const weave = Math.sin(u * Math.PI * 2 * 48) * Math.sin(v * Math.PI * 2 * 48) * 0.5 + 0.5;
        const n = a.fbm(u, v, 4, 5);
        const fold = a.fbm2(u, v, 2, 8, 3);
        const c = 0.86 + (n - 0.5) * 0.2 + (weave - 0.5) * 0.08 - (fold - 0.5) * 0.14;
        o[0] = c;
        o[1] = c;
        o[2] = c;
        o[3] = weave * 0.3 + fold * 0.8;
        o[4] = 0.93;
      }, 1.8);
    }
  }
}

// ---------------------------------------------------------------------------
// Sprite / decal textures (canvas based)
// ---------------------------------------------------------------------------

function canvasTex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeCanvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 2x2 particle atlas: [smoke, glow] / [flame, debris]. Stored premultiplied-friendly (white rgb + alpha). */
export function makeParticleAtlas() {
  const S = 256;
  const c = makeCanvas(S * 2);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S * 2, S * 2);
  const d = img.data;
  const n = new TileNoise(301);
  const n2 = new TileNoise(302);
  const put = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const i = (y * S * 2 + x) * 4;
    d[i] = r * 255;
    d[i + 1] = g * 255;
    d[i + 2] = b * 255;
    d[i + 3] = clamp(a, 0, 1) * 255;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      // smoke puff
      const f = n.fbm(u, v, 4, 5);
      const f2 = n2.fbm(u, v, 8, 4);
      let a = smoothstep(1.0, 0.25, r + (f - 0.5) * 0.7) * (0.55 + f2 * 0.6);
      a *= smoothstep(1.0, 0.8, r);
      const shade = 0.65 + f2 * 0.35 + dy * -0.3;
      put(x, y, shade, shade, shade, a);
      // glow
      const gl = Math.pow(clamp(1 - r, 0, 1), 2.2);
      put(x + S, y, 1, 1, 1, gl);
      // flame
      const ff = n.fbm(u + 0.3, v + 0.6, 5, 5);
      let fa = smoothstep(1.0, 0.1, r + (ff - 0.5) * 0.9);
      fa *= smoothstep(1.0, 0.75, r);
      const heat = clamp(fa * 1.4 + (ff - 0.5) * 0.5, 0, 1);
      put(x, y + S, 1, 0.35 + heat * 0.6, 0.08 + heat * heat * 0.6, fa);
      // debris chunk (hard-edged irregular shape)
      const ang = Math.atan2(dy, dx);
      const rad = 0.55 + 0.25 * Math.sin(ang * 3 + 1.3) + 0.12 * Math.sin(ang * 7 + 0.4);
      const da = smoothstep(rad, rad - 0.08, r);
      const sh2 = 0.6 + f2 * 0.5;
      put(x + S, y + S, sh2, sh2, sh2, da);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTex(c, false);
  t.premultiplyAlpha = false;
  return t;
}

export function makeBulletHoleTexture() {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const n = new TileNoise(311);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const ang = Math.atan2(dy, dx);
      const f = n.fbm(u, v, 8, 4);
      const r = Math.sqrt(dx * dx + dy * dy) * 2 + (f - 0.5) * 0.35 + Math.sin(ang * 5) * 0.05;
      const hole = smoothstep(0.3, 0.2, r);
      const chip = smoothstep(0.85, 0.35, r);
      const i = (y * S + x) * 4;
      // light chipped ring -> dark core
      const shade = 0.75 * (1 - hole) + 0.03 * hole;
      img.data[i] = shade * 255;
      img.data[i + 1] = shade * 255;
      img.data[i + 2] = shade * 255;
      img.data[i + 3] = clamp(Math.max(hole, chip * 0.75), 0, 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTex(c);
}

export function makeScorchTexture() {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const n = new TileNoise(321);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const ang = Math.atan2(dy, dx);
      const f = n.fbm(u, v, 6, 5);
      const streak = n.fbm2((ang / Math.PI) * 0.5 + 0.5, 0.3, 32, 1, 3);
      const r = Math.sqrt(dx * dx + dy * dy) * 2 + (f - 0.5) * 0.5 - streak * 0.25;
      const a = smoothstep(0.85, 0.1, r);
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTex(c);
}

/** Muzzle flash: star-shaped burst. */
export function makeFlashTexture() {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const n = new TileNoise(331);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x / S - 0.5;
      const dy = y / S - 0.5;
      const ang = Math.atan2(dy, dx);
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const spikes = Math.pow(Math.abs(Math.sin(ang * 2.5 + 0.4)), 3) * 0.55 + Math.pow(Math.abs(Math.sin(ang * 4 + 1.1)), 6) * 0.3;
      const f = n.fbm((ang / Math.PI) * 0.5 + 0.5, r * 0.5, 16, 4);
      const reach = 0.3 + spikes * 0.7 + (f - 0.5) * 0.25;
      let a = smoothstep(reach, reach * 0.25, r);
      a = Math.max(a, Math.pow(clamp(1 - r * 2.2, 0, 1), 1.5));
      a *= smoothstep(1, 0.85, r);
      const i = (y * S + x) * 4;
      const core = clamp(1 - r * 2.5, 0, 1);
      img.data[i] = 255;
      img.data[i + 1] = (0.72 + core * 0.28) * 255;
      img.data[i + 2] = (0.38 + core * 0.6) * 255;
      img.data[i + 3] = clamp(a, 0, 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTex(c);
}

/** Holographic sight reticle (ring + dot). */
export function makeReticleTexture() {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#ff2a1a';
  ctx.fillStyle = '#ff2a1a';
  ctx.shadowColor = '#ff2a1a';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * 78, S / 2 + Math.sin(a) * 78);
    ctx.lineTo(S / 2 + Math.cos(a) * 100, S / 2 + Math.sin(a) * 100);
    ctx.stroke();
  }
  return canvasTex(c);
}

/** Small text / marking decals painted onto a canvas (signs, helipad, stencils). */
export function makeSignTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 256) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = canvasTex(c);
  t.anisotropy = maxAniso;
  return t;
}

let cachedHazardSet: TexSet | null = null;
/** Weathered diagonal industrial safety hazard chevron PBR texture set (chipped ochre/black steel). */
export function makeHazardChevronTextures(): TexSet {
  if (cachedHazardSet) return cachedHazardSet;
  const a = new TileNoise(411);
  const b = new TileNoise(412);
  cachedHazardSet = generate(512, (u, v, o) => {
    const n1 = a.fbm(u, v, 6, 5);
    const fine = b.fbm(u, v, 56, 3);
    const chipMask = smoothstep(0.66, 0.74, a.fbm(u + 0.27, v + 0.61, 14, 4) + (fine - 0.5) * 0.22);
    const scratch = smoothstep(0.79, 0.84, b.fbm2(u + 0.13, v + 0.44, 4, 96, 2));
    // Crisp 45° diagonal hazard stripes (2 repeats per tile)
    const phase = ((u + v) * 2.0) % 1.0;
    const stripe = smoothstep(0.47, 0.50, phase) * (1 - smoothstep(0.97, 1.0, phase));
    // Weathered industrial safety yellow vs dark charcoal steel
    let r = stripe * 0.74 + (1 - stripe) * 0.14;
    let g = stripe * 0.56 + (1 - stripe) * 0.14;
    let bl = stripe * 0.14 + (1 - stripe) * 0.15;
    // Grime & mineral fade
    const grime = 0.80 + (n1 - 0.5) * 0.26 + (fine - 0.5) * 0.10;
    r *= grime;
    g *= grime;
    bl *= grime;
    // Chipped edges & brushed bare steel scratches
    const bare = Math.max(chipMask * 0.65, scratch * 0.85);
    r = r * (1 - bare) + 0.34 * bare;
    g = g * (1 - bare) + 0.36 * bare;
    bl = bl * (1 - bare) + 0.38 * bare;
    o[0] = r;
    o[1] = g;
    o[2] = bl;
    o[3] = 0.5 + (1 - bare) * 0.18 + (fine - 0.5) * 0.14 - scratch * 0.25;
    o[4] = clamp(0.74 - bare * 0.28 + (n1 - 0.5) * 0.18, 0.32, 0.94);
  }, 1.35);
  return cachedHazardSet;
}

let cachedFresnelTex: THREE.Texture | null = null;
/** Ribbed optical Fresnel diffuser & dark steel cage grid texture for lamps, light bars & helipad beacons. */
export function makeFresnelLensTexture(): THREE.Texture {
  if (cachedFresnelTex) return cachedFresnelTex;
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d')!;
  // Warm optical gradient core
  const grad = ctx.createRadialGradient(S * 0.5, S * 0.5, S * 0.04, S * 0.5, S * 0.5, S * 0.62);
  grad.addColorStop(0.0, '#ffffff');
  grad.addColorStop(0.55, '#d8dde2');
  grad.addColorStop(0.85, '#7e8690');
  grad.addColorStop(1.0, '#2c3138');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // Crisp parallel Fresnel prism grooves
  for (let y = 0; y < S; y += 8) {
    ctx.fillStyle = 'rgba(18, 22, 28, 0.26)';
    ctx.fillRect(0, y, S, 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(0, y + 2, S, 2);
  }
  // Protective industrial cage bars & outer steel bezel
  ctx.strokeStyle = 'rgba(20, 24, 30, 0.72)';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, S - 10, S - 10);
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(S * 0.33, 6); ctx.lineTo(S * 0.33, S - 6);
  ctx.moveTo(S * 0.67, 6); ctx.lineTo(S * 0.67, S - 6);
  ctx.moveTo(6, S * 0.5); ctx.lineTo(S - 6, S * 0.5);
  ctx.stroke();
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = maxAniso;
  cachedFresnelTex = t;
  return t;
}

const scadaCache = new Map<string, THREE.Texture>();
/** High-resolution industrial SCADA refinery/bunker telemetry screen texture. */
export function makeScadaScreenTexture(kind: 'refinery' | 'bunker' = 'refinery'): THREE.Texture {
  const cached = scadaCache.get(kind);
  if (cached) return cached;
  const W = 512, H = 320;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  // Deep CRT glass slate background
  ctx.fillStyle = kind === 'refinery' ? '#07131a' : '#09101a';
  ctx.fillRect(0, 0, W, H);
  // Subtle blueprint telemetry grid
  ctx.strokeStyle = 'rgba(42, 165, 210, 0.14)';
  ctx.lineWidth = 1;
  for (let x = 20; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 20; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // Top status header bar
  ctx.fillStyle = kind === 'refinery' ? 'rgba(26, 118, 152, 0.38)' : 'rgba(156, 52, 34, 0.38)';
  ctx.fillRect(10, 10, W - 20, 34);
  ctx.fillStyle = kind === 'refinery' ? '#6ce4ff' : '#ff9868';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(kind === 'refinery' ? 'KARAGANDA SCADA // CRACKING UNIT 04' : 'EPSILON RELAY // UPLINK CORE 05', 22, 33);

  // Left: Live Pipeline Schematic / Core Nodes
  ctx.strokeStyle = '#38c8ee';
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 62, 236, 148);
  ctx.strokeStyle = '#ff9c3a';
  ctx.beginPath();
  ctx.moveTo(42, 175); ctx.lineTo(92, 175); ctx.lineTo(92, 112); ctx.lineTo(162, 112); ctx.lineTo(162, 154); ctx.lineTo(236, 154);
  ctx.stroke();
  for (const [nx, ny, col] of [[92, 112, '#4eff9c'], [162, 112, '#ff5840'], [162, 154, '#ffd24c'], [218, 154, '#4eff9c']] as const) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(nx, ny, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#9adff2';
  ctx.font = '13px monospace';
  ctx.fillText('V-01: 4.82 MPa   TEMP: 418 C', 32, 86);
  ctx.fillStyle = '#ff7258';
  ctx.fillText('ALERT: PRESSURE SURGE SEC-4', 32, 198);

  // Right: Pressure & Power Telemetry Bar Graphs
  const bars = [0.76, 0.54, 0.89, 0.62, 0.93, 0.48, 0.71];
  for (let i = 0; i < bars.length; i++) {
    const bx = 278 + i * 30;
    const bh = Math.round(bars[i] * 124);
    ctx.fillStyle = 'rgba(40, 120, 150, 0.25)';
    ctx.fillRect(bx, 66, 20, 136);
    ctx.fillStyle = bars[i] > 0.85 ? '#ff6446' : '#3ad6ff';
    ctx.fillRect(bx, 202 - bh, 20, bh);
  }
  // Bottom waveform readout
  ctx.strokeStyle = '#52f2b0';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let x = 24; x < W - 24; x += 6) {
    const wy = 264 + Math.sin(x * 0.065) * 18 + Math.cos(x * 0.17) * 9;
    if (x === 24) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
  }
  ctx.stroke();
  // Subtle CRT scanlines + dark bezel
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.strokeStyle = '#18242e';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = maxAniso;
  scadaCache.set(kind, t);
  return t;
}

