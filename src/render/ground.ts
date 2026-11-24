import * as THREE from 'three';
import { mulberry32 } from '../core/utils';
import { assets } from './assets';
import { applyDetail } from './detail';
import { TILE, texSets } from './materials';

/**
 * Painter for the ground splat mask, in world units.
 * R = mud, G = tyre ruts, B = standing water bias.
 */
export class GroundMask {
  private canvases: HTMLCanvasElement[] = [];
  private ctxs: CanvasRenderingContext2D[] = [];
  private rnd = mulberry32(7771);

  constructor(public x0: number, public z0: number, public size: number, public res = 1024) {
    for (let i = 0; i < 3; i++) {
      const c = document.createElement('canvas');
      c.width = c.height = res;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, res, res);
      const k = res / size;
      g.setTransform(k, 0, 0, k, -x0 * k, -z0 * k);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      this.canvases.push(c);
      this.ctxs.push(g);
    }
  }

  private r(a: number, b: number) {
    return a + this.rnd() * (b - a);
  }

  private shade(v: number) {
    const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `rgb(${c},${c},${c})`;
  }

  /** Soft-edged blob; `lighten` keeps the maximum of overlapping strokes. */
  blob(ch: number, x: number, z: number, r: number, v: number) {
    const g = this.ctxs[ch];
    g.globalCompositeOperation = 'lighten';
    const grad = g.createRadialGradient(x, z, 0, x, z, r);
    grad.addColorStop(0, this.shade(v));
    grad.addColorStop(0.55, this.shade(v * 0.8));
    grad.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, z, r, 0, Math.PI * 2);
    g.fill();
  }

  /** Polyline stroke with ragged edges. */
  path(ch: number, pts: [number, number][], width: number, v: number, ragged = 0.35) {
    const g = this.ctxs[ch];
    g.globalCompositeOperation = 'lighten';
    g.strokeStyle = this.shade(v);
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
    if (ragged <= 0) return;
    // ragged verge: stamps along the edges
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let d = 0; d < len; d += width * 0.22) {
        const t = d / len;
        const side = this.rnd() < 0.5 ? -1 : 1;
        const off = side * width * 0.5 * this.r(0.6, 1.0);
        const px = ax + (bx - ax) * t + nx * off, pz = az + (bz - az) * t + nz * off;
        this.blob(ch, px, pz, width * this.r(0.12, 0.35) * (1 + ragged), v * this.r(0.5, 1));
      }
    }
  }

  /** A pair of wheel ruts following a polyline. */
  ruts(pts: [number, number][], gauge = 1.85, width = 0.42, v = 0.9, wander = 0.25) {
    for (const side of [-0.5, 0.5]) {
      const line: [number, number][] = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[Math.min(i, pts.length - 1)], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
        const dx = q[0] - o[0], dz = q[1] - o[1];
        const l = Math.hypot(dx, dz) || 1;
        const w = (this.rnd() - 0.5) * wander;
        line.push([p[0] - (dz / l) * (side * gauge + w), p[1] + (dx / l) * (side * gauge + w)]);
      }
      this.path(1, line, width, v, 0);
      this.path(1, line, width * 2.2, v * 0.35, 0);
    }
  }

  /** Scatter puddles (water channel) along a polyline. */
  puddles(pts: [number, number][], every: number, r0: number, r1: number, spread: number) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = this.r(0, every); d < len; d += every * this.r(0.5, 1.5)) {
        const t = d / len;
        const x = ax + (bx - ax) * t + this.r(-spread, spread), z = az + (bz - az) * t + this.r(-spread, spread);
        const r = this.r(r0, r1);
        // elongated: two or three overlapping lobes
        for (let k = 0; k < 3; k++) this.blob(2, x + this.r(-r, r) * 0.6, z + this.r(-r, r) * 0.6, r * this.r(0.6, 1.0), this.r(0.75, 1));
      }
    }
  }

  build(): THREE.DataTexture {
    const res = this.res;
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = res;
    const tg = tmp.getContext('2d', { willReadFrequently: true })!;
    const data = new Uint8Array(res * res * 4);
    const blur = [3, 1.2, 2];
    for (let ch = 0; ch < 3; ch++) {
      tg.filter = `blur(${blur[ch]}px)`;
      tg.clearRect(0, 0, res, res);
      tg.drawImage(this.canvases[ch], 0, 0);
      const px = tg.getImageData(0, 0, res, res).data;
      for (let i = 0; i < res * res; i++) data[i * 4 + ch] = px[i * 4];
    }
    for (let i = 0; i < res * res; i++) data[i * 4 + 3] = 255;
    const t = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    this.canvases.length = 0;
    this.ctxs.length = 0;
    return t;
  }
}

/**
 * Wet desert ground: scanned sand and mud blended through a world-space mask, with tyre ruts
 * pressed into the mud and mirror-smooth standing water in the low spots.
 */
const __gBuild0 = ((globalThis as unknown as { __groundBuild?: number }).__groundBuild = ((globalThis as unknown as { __groundBuild?: number }).__groundBuild ?? 0) + 1);
export const __groundBuildMarker = __gBuild0;
export function makeGroundMaterial(mask: THREE.Texture, x0: number, z0: number, size: number, res: number) {
  const sand = texSets.sand;
  const mud = assets.tex.mud;
  const mat = new THREE.MeshStandardMaterial({
    map: sand.map,
    roughnessMap: sand.roughnessMap,
    normalMap: sand.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    aoMap: sand.aoMap ?? null,
    aoMapIntensity: 0.9,
    roughness: 1,
    metalness: 0,
  });
  mat.userData.surface = 'sand';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = { value: mask };
    shader.uniforms.uMaskBounds = { value: new THREE.Vector3(x0, z0, size) };
    shader.uniforms.uMudMap = { value: mud?.map ?? sand.map };
    shader.uniforms.uMudNormal = { value: mud?.normalMap ?? sand.normalMap };
    shader.uniforms.uMudArm = { value: mud?.armMap ?? sand.roughnessMap };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGroundWorldPos;
varying vec2 vGroundMaskUv;
uniform vec3 uMaskBounds;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vGroundWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGroundMaskUv = (vGroundWorldPos.xz - uMaskBounds.xy) / uMaskBounds.z;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uMask;
uniform sampler2D uMudMap;
uniform sampler2D uMudNormal;
uniform sampler2D uMudArm;
varying vec3 vGroundWorldPos;
varying vec2 vGroundMaskUv;
float grHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float grNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grHash(i), grHash(i + vec2(1.0, 0.0)), f.x), mix(grHash(i + vec2(0.0, 1.0)), grHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float grFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * grNoise(p); p = p * 2.07 + 11.3; a *= 0.5; } return s; }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 maskUv = clamp(vGroundMaskUv, 0.0, 1.0);
  vec4 splat = texture2D(uMask, maskUv);
  float mudAmt = splat.r;
  float rutsAmt = splat.g;
  float pudAmt = splat.b;

  // Macro geological desert sand/gravel/ochre scree breakup across the whole terrain so distant desert blends into foothills
  float geoMacro = grFbm(vGroundWorldPos.xz * 0.018);
  float geoMid = grFbm(vGroundWorldPos.xz * 0.075 + 4.2);
  float rimFactor = smoothstep(55.0, 175.0, length(vGroundWorldPos.xz));
  float duneElev = smoothstep(0.3, 9.0, vGroundWorldPos.y);
  vec3 screeTint = mix(vec3(0.96, 0.91, 0.84), vec3(0.68, 0.57, 0.45), clamp(geoMacro * 0.75 + geoMid * 0.35, 0.0, 1.0));
  diffuseColor.rgb *= mix(vec3(1.0), screeTint, 0.32 + rimFactor * 0.48 + duneElev * 0.35);

  vec2 mudUv = vGroundWorldPos.xz / 3.2;
  vec3 mudCol = texture2D(uMudMap, mudUv).rgb;

  // blend sand to churned wet mud
  float mBlend = clamp(mudAmt * 1.35 + rutsAmt * 0.7, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, mudCol * 0.88, mBlend);

  // tyre ruts indentation darkening
  diffuseColor.rgb *= 1.0 - rutsAmt * 0.22;

  // damp ground darkening around puddle margins
  float damp = smoothstep(0.04, 0.35, pudAmt);
  diffuseColor.rgb *= 1.0 - damp * 0.32;

  // standing water deep absorption
  float pFactor = smoothstep(0.18, 0.55, pudAmt);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.055, 0.048), pFactor * 0.75);
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
{
  vec2 maskUv = clamp(vGroundMaskUv, 0.0, 1.0);
  vec4 splat = texture2D(uMask, maskUv);
  float mudAmt = splat.r;
  float rutsAmt = splat.g;
  float pudAmt = splat.b;

  vec2 mudUv = vGroundWorldPos.xz / 3.2;
  vec4 mudArm = texture2D(uMudArm, mudUv);

  float mBlend = clamp(mudAmt * 1.35 + rutsAmt * 0.7, 0.0, 1.0);
  roughnessFactor = mix(roughnessFactor, mudArm.g * 0.8, mBlend);

  // damp soil is smoother
  float damp = smoothstep(0.04, 0.35, pudAmt);
  roughnessFactor = mix(roughnessFactor, 0.42, damp * 0.6);

  // water puddles reflect sky cleanly while clamping extreme low-sun grazing blowout
  float pFactor = smoothstep(0.22, 0.58, pudAmt);
  vec3 gView = normalize(cameraPosition - vGroundWorldPos);
  float gDist = length(cameraPosition - vGroundWorldPos);
  float gGraze = 1.0 - clamp(gView.y, 0.0, 1.0);
  float pudRough = clamp(0.11 + gGraze * gGraze * 0.16 + smoothstep(14.0, 68.0, gDist) * 0.24, 0.11, 0.48);
  roughnessFactor = mix(roughnessFactor, pudRough, pFactor);
}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 maskUv = clamp(vGroundMaskUv, 0.0, 1.0);
  vec4 splat = texture2D(uMask, maskUv);
  float pudAmt = splat.b;
  float pFactor = smoothstep(0.22, 0.58, pudAmt);

  // water surface flattens the bumpy sand normals with gentle wind micro-ripples
  if (pFactor > 0.01) {
    vec3 flatN = nonPerturbedNormal;
    float rip = sin(vGroundWorldPos.x * 26.0 + vGroundWorldPos.z * 18.0) * cos(vGroundWorldPos.z * 24.0 - vGroundWorldPos.x * 12.0) * 0.014;
    vec3 waterN = normalize(flatN + vec3(rip, 0.0, rip * 0.75));
    normal = normalize(mix(normal, waterN, pFactor * 0.94));
  }
}`
      );
  };
  mat.customProgramCacheKey = () => 'pbr_ground_wet';

  return mat;
}

/**
 * Desert terrain ground mesh: exact flat y = 0 inside the playable safe zone so all colliders,
 * roads and buildings ground cleanly, smoothly rising outside into rolling desert dunes,
 * dry wadis and alluvial foothills that blend organically into the surrounding mountains.
 */
export function makeGroundMesh(
  mat: THREE.Material,
  half: number,
  flatBounds?: { x0: number; x1: number; z0: number; z1: number; roadX?: number; roadZ?: number },
) {
  const segs = flatBounds ? 112 : 8;
  const g = new THREE.PlaneGeometry(half * 2, half * 2, segs, segs);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const hash = (x: number, z: number) => {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const vnoise = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };
  const fbm = (x: number, z: number) =>
    vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 13.7, z * 2.1 - 7.3) * 0.3 + vnoise(x * 4.3 - 5.1, z * 4.3 + 19.2) * 0.15;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = 0;
    if (flatBounds) {
      const dx = Math.max(flatBounds.x0 - x, 0, x - flatBounds.x1);
      const dz = Math.max(flatBounds.z0 - z, 0, z - flatBounds.z1);
      let dOut = Math.hypot(dx, dz);
      // Keep outbound access road corridors level so external roads/poles stay grounded
      if (flatBounds.roadX !== undefined && Math.abs(x - flatBounds.roadX) < 12) {
        dOut = Math.min(dOut, Math.max(0, Math.abs(x - flatBounds.roadX) - 7));
      }
      if (flatBounds.roadZ !== undefined && Math.abs(z - flatBounds.roadZ) < 12) {
        dOut = Math.min(dOut, Math.max(0, Math.abs(z - flatBounds.roadZ) - 7));
      }
      if (dOut > 0.5) {
        const blend = Math.min(1, Math.max(0, (dOut - 2) / 52));
        const s = blend * blend * (3 - 2 * blend);
        const dunes = (fbm(x * 0.016, z * 0.016) - 0.32) * 10.5;
        const ripples = (fbm(x * 0.055 + 3.1, z * 0.055 - 2.4) - 0.5) * 2.2;
        const rimRise = Math.pow(Math.max(0, (Math.hypot(x, z) - 135) / 170), 1.7) * 14.0;
        y = Math.max(-0.4, (dunes + ripples + rimRise) * s);
      }
    }
    pos.setY(i, y);
    uv.setXY(i, x / TILE.sand, z / TILE.sand + y * 0.25);
  }
  if (flatBounds) g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.name = 'ground';
  m.matrixAutoUpdate = false;
  return m;
}
