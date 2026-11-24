import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { Quality, settings } from '../core/settings';
import type { SkyMeta } from './assets';
import { setMaxAnisotropy } from './textures';
import { patchFog, rainRippleUniform, stormLightningUniform } from './weather';

// ---------------------------------------------------------------------------
// Sky: analytic dusk gradient + animated fbm clouds
// ---------------------------------------------------------------------------
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uSunDisc;
uniform vec3 uHaze;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.0, 31.0); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float mu = max(dot(d, uSunDir), 0.0);
  float h = d.y;
  vec3 zen = vec3(0.13, 0.25, 0.50);
  vec3 mid = vec3(0.42, 0.52, 0.66);
  vec3 hor = vec3(0.98, 0.74, 0.50);
  float t = clamp(h, 0.0, 1.0);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.28, t));
  col = mix(col, zen, smoothstep(0.15, 0.85, t));
  // forward scattering around the sun
  col += vec3(1.0, 0.52, 0.22) * pow(mu, 6.0) * 0.4 * (1.0 - t * 0.5);
  col += vec3(1.0, 0.78, 0.5) * pow(mu, 90.0) * 1.1;
  if (h > -0.02) {
    vec2 cuv = d.xz / (max(h, 0.0) + 0.14);
    vec2 wind = uTime * vec2(0.006, 0.002);
    float n = fbm(cuv * 0.75 + wind);
    float n2 = fbm(cuv * 2.6 - wind * 1.7 + 7.0);
    float cov = smoothstep(0.46, 0.8, n + n2 * 0.18);
    float lit = fbm(cuv * 0.75 + wind + uSunDir.xz * 0.12);
    float shade = clamp((n - lit) * 3.5 + 0.55, 0.0, 1.0);
    vec3 cl = mix(vec3(0.34, 0.30, 0.34), vec3(1.1, 0.88, 0.7), shade);
    cl += vec3(1.3, 0.72, 0.36) * pow(mu, 8.0) * 0.6;
    col = mix(col, cl, cov * smoothstep(-0.02, 0.14, h) * 0.9);
  }
  col += vec3(1.0, 0.86, 0.62) * smoothstep(0.99955, 0.9998, clamp(mu, 0.0, 1.0)) * 28.0 * uSunDisc;
  col = clamp(col, vec3(0.0), vec3(64.0));
  // ground haze band + below-horizon colour (matters for reflections)
  col = mix(col, uHaze, smoothstep(0.1, 0.0, abs(h)) * 0.92);
  if (h < 0.0) col = mix(uHaze, vec3(0.30, 0.25, 0.19), smoothstep(0.0, -0.3, h));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// Photographic sky: a real HDRI (Poly Haven, CC0). The visible dome samples the
// tonemapped panorama; image-based lighting is prefiltered from the HDR data.
// ---------------------------------------------------------------------------
const SKY_COMMON = /* glsl */ `
precision highp float;
uniform sampler2D uSky;
uniform float uRot;
uniform vec3 uHaze;
varying vec3 vDir;
vec3 skyDir(vec3 d) {
  float c = cos(uRot), s = sin(uRot);
  return vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
}
`;

const SKY_PHOTO_FRAG = SKY_COMMON + /* glsl */ `
uniform float uSkyBottom;
uniform float uGain;
uniform float uSunDisc;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
void main() {
  vec3 d = normalize(vDir);
  vec3 r = skyDir(d);
  float u = atan(r.z, r.x) / 6.28318530718 + 0.5;
  float vt = acos(clamp(r.y, -1.0, 1.0)) / 3.14159265359;
  vec3 col = texture2D(uSky, vec2(u, 1.0 - min(vt / uSkyBottom, 1.0))).rgb;
  // the panorama is tonemapped: re-expand the highlights so clouds and the sun glare bloom
  float peak = clamp(max(col.r, max(col.g, col.b)), 0.0, 4.0);
  col *= uGain * (1.0 + 0.6 * pow(peak, 6.0));
  // the captured sky can carry a burned-out (or masked) sun disc: paint a guaranteed finite core
  float mu = clamp(dot(d, uSunDir), 0.0, 1.0);
  float core = smoothstep(0.9991, 0.9997, mu);
  col = mix(col, uSunColor * 12.0, core * uSunDisc);
  // Wide golden corona bloom around the sun disc (tamed so it doesn't wash out the horizon)
  col += uSunColor * (pow(mu, 480.0) * 0.9 + smoothstep(0.9994, 0.99985, mu) * 4.2) * uSunDisc;
  col = clamp(col, vec3(0.0), vec3(48.0));
  // dusty ground haze at the horizon, ground colour below it (only seen through gaps)
  float h = d.y;
  col = mix(col, uHaze * 1.05, smoothstep(0.06, -0.005, h) * 0.6);
  if (h < 0.0) col = mix(col, uHaze * vec3(0.5, 0.44, 0.36), smoothstep(0.0, -0.2, h));
  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_ENV_FRAG = SKY_COMMON + /* glsl */ `
uniform float uGain;
uniform vec3 uGround;
void main() {
  vec3 d = normalize(vDir);
  vec3 r = skyDir(d);
  float u = atan(r.z, r.x) / 6.28318530718 + 0.5;
  float v = asin(clamp(r.y, -1.0, 1.0)) / 3.14159265359 + 0.5;
  // (the sun itself is a directional light; clamp it out of the prefiltered environment)
  vec3 rawSky = texture2D(uSky, vec2(u, max(v, 0.502))).rgb * uGain;
  rawSky = min(rawSky, vec3(14.0));
  // Warm atmospheric tone-down: blend sky reflection with atmospheric haze so reflections match the scene's ambient light
  float lum = dot(rawSky, vec3(0.2126, 0.7152, 0.0722));
  vec3 tonedSky = mix(rawSky, vec3(lum) * vec3(0.85, 0.92, 1.02), 0.3);
  vec3 sky = mix(tonedSky, uHaze * 1.25, smoothstep(0.35, -0.02, d.y) * 0.7);
  gl_FragColor = vec4(mix(uGround, sky, smoothstep(-0.05, 0.03, d.y)), 1.0);
}`;

// ---------------------------------------------------------------------------
// Midnight tropical storm sky: churning rain clouds + reactive sheet lightning
// ---------------------------------------------------------------------------
const SKY_STORM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLightning;
uniform vec3 uHaze;
varying vec3 vDir;

float shHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float shNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(shHash(i), shHash(i + vec2(1, 0)), f.x), mix(shHash(i + vec2(0, 1)), shHash(i + vec2(1, 1)), f.x), f.y);
}
float shFbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * shNoise(p); p = p * 2.04 + vec2(13.1, 29.7); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zen = vec3(0.015, 0.028, 0.055);
  vec3 hor = vec3(0.055, 0.095, 0.145);
  vec3 col = mix(hor, zen, smoothstep(0.0, 0.65, max(h, 0.0)));
  if (h > -0.04) {
    vec2 cuv = d.xz / (max(h, 0.0) + 0.18);
    vec2 wind = uTime * vec2(0.032, 0.016);
    float n1 = shFbm(cuv * 0.85 + wind);
    float n2 = shFbm(cuv * 2.4 - wind * 1.4 + 4.3);
    float cloud = smoothstep(0.28, 0.78, n1 * 0.72 + n2 * 0.28);
    // Storm cloud underbelly & dramatic blue-white sheet lightning
    vec3 darkCloud = vec3(0.022, 0.036, 0.058);
    vec3 litCloud = vec3(0.09, 0.14, 0.21) + vec3(0.75, 0.90, 1.25) * uLightning * (0.4 + 0.9 * smoothstep(0.45, 0.85, n2));
    col = mix(col, mix(darkCloud, litCloud, smoothstep(0.3, 0.85, n1)), cloud * smoothstep(-0.04, 0.14, h));
    // Distant lightning bolt glow on one side of the horizon
    float flashPatch = pow(max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(0.55, 0.0, 0.83)))), 6.0);
    col += vec3(0.55, 0.76, 1.2) * uLightning * (0.35 + 1.4 * flashPatch) * smoothstep(0.55, 0.02, abs(h));
  }
  col = mix(col, uHaze + vec3(0.18, 0.26, 0.38) * uLightning, smoothstep(0.12, -0.02, h) * 0.88);
  // Below the horizon the dome is only ever seen through the thin gap between the far edge of the
  // ocean plane and the true horizon line. It has to carry the same haze (and the same lightning
  // lift) as the water shader, otherwise that gap reads as a black band across the sea.
  if (h < 0.0) col = mix(uHaze + vec3(0.55, 0.76, 1.2) * uLightning * 0.35, vec3(0.012, 0.024, 0.04), smoothstep(0.0, -0.25, h));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// Final grade: light shafts, chromatic aberration, ACES, split-tone, vignette,
// film grain, damage/flash feedback, sRGB encode.
// ---------------------------------------------------------------------------
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uExposure: { value: 0.95 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.0045 },
    uCA: { value: 0.0005 },
    uDamage: { value: 0 },
    uLowHealth: { value: 0 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
    uSunAmt: { value: 0 },
    uAspect: { value: 1 },
    uRes: { value: new THREE.Vector2(1600, 900) },
    uFocus: { value: 0 },
    uNvg: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uVignette, uGrain, uCA, uDamage, uLowHealth, uFlash, uFade, uSunAmt, uAspect, uFocus, uNvg;
    uniform vec2 uSunPos;
    uniform vec2 uRes;
    varying vec2 vUv;

    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color) {
      // Highlight desaturation protects against ACES blue gamut collapse / electric cyan artifacts
      float peak = max(color.r, max(color.g, color.b));
      if (peak > 1.0) {
        float desat = smoothstep(1.0, 4.5, peak) * 0.42;
        float lum = dot(color, vec3(0.26, 0.64, 0.10));
        color = mix(color, vec3(lum), desat);
      }
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color = inM * (color / 0.6);
      color = RRTAndODTFit(color);
      return clamp(outM * color, 0.0, 1.0);
    }
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    // NaN never compares true: this both detects and clears non-finite taps
    vec3 safe(vec3 c) { return vec3(!(c.r >= 0.0) ? 0.0 : c.r, !(c.g >= 0.0) ? 0.0 : c.g, !(c.b >= 0.0) ? 0.0 : c.b); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // lens chromatic aberration, stronger towards the edges and when hurt
      vec2 off = c * r2 * (uCA + uDamage * 0.012) * 8.0;
      // sample center pixel in HDR
      vec3 rawCenter = safe(texture2D(tDiffuse, uv).rgb);
      vec3 col = rawCenter;

      // Fast path when GPNVG-18 Night Vision is fully active (skips daytime halation/shafts/CA/grade)
      if (uNvg > 0.995) {
        vec3 nvgRaw = rawCenter * uExposure * 3.8;
        float nl = dot(nvgRaw, vec3(0.26, 0.64, 0.10));
        float nv = pow(clamp(nl / (1.0 + nl * 0.75), 0.0, 1.0), 1.28);
        vec3 wpLow = vec3(0.008, 0.045, 0.042);
        vec3 wpMid = vec3(0.14, 0.76, 0.58);
        vec3 wpHi = vec3(0.84, 0.99, 0.95);
        vec3 nvgCol = mix(mix(wpLow, wpMid, smoothstep(0.02, 0.52, nv)), wpHi, smoothstep(0.48, 1.0, nv));
        float nvgNoise = (hash12(gl_FragCoord.xy * 0.85 + fract(uTime * 1.7) * 521.0) - 0.5) * 0.065;
        float scan = 0.97 + 0.03 * sin(gl_FragCoord.y * 1.6);
        nvgCol = clamp((nvgCol + nvgNoise) * scan, 0.0, 1.0);
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
        float d1 = length(p - vec2(-0.34, 0.0));
        float d2 = length(p - vec2(0.34, 0.0));
        float d3 = length(p - vec2(-0.74, 0.0));
        float d4 = length(p - vec2(0.74, 0.0));
        float mask = 1.0 - smoothstep(0.48, 0.57, min(min(d1, d2), min(d3, d4)));
        nvgCol *= (0.08 + 0.92 * mask);
        nvgCol = mix(nvgCol, vec3(1.0, 0.97, 0.9), clamp(uFlash, 0.0, 1.0)) * (1.0 - uFade);
        col = mix(nvgCol * 12.92, 1.055 * pow(max(nvgCol, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, nvgCol));
        gl_FragColor = vec4(col, 1.0);
        return;
      }

      // halation: subtle warm optical bleed on true HDR highlights only (keeps sunlit sand & walls razor-sharp)
      vec2 hp = 2.5 / uRes;
      vec3 halo = safe(texture2D(tDiffuse, uv + vec2(hp.x, 0.0)).rgb)
                + safe(texture2D(tDiffuse, uv - vec2(hp.x, 0.0)).rgb)
                + safe(texture2D(tDiffuse, uv + vec2(0.0, hp.y)).rgb)
                + safe(texture2D(tDiffuse, uv - vec2(0.0, hp.y)).rgb);
      halo *= 0.25;
      col += min(max(halo - vec3(1.38), vec3(0.0)), vec3(3.0)) * vec3(0.22, 0.12, 0.06);

      // screen-space light shafts marching towards the sun
      if (uSunAmt > 0.001) {
        vec2 dir = (uSunPos - uv);
        float jitter = hash12(gl_FragCoord.xy + uTime * 60.0);
        vec3 acc = vec3(0.0);
        float w = 1.0;
        const int N = 12;
        for (int i = 0; i < N; i++) {
          float f = (float(i) + jitter) / float(N);
          vec3 s = safe(texture2D(tDiffuse, uv + dir * f * 0.85).rgb);
          float l = dot(s, vec3(0.3, 0.6, 0.1));
          acc += s * smoothstep(1.3, 2.9, l) * w;
          w *= 0.94;
        }
        vec2 sd = (uSunPos - uv) * vec2(uAspect, 1.0);
        float falloff = exp(-dot(sd, sd) * 3.2);
        col += acc / float(N) * uSunAmt * falloff * vec3(1.0, 0.82, 0.6);
      }

      col *= uExposure;
      col = aces(col);

      // chromatic aberration: only evaluate toward lens periphery where offset is visible
      if (r2 > 0.025 && dot(off, off) > 1e-7) {
        vec3 colR = aces(safe(texture2D(tDiffuse, uv + off).rgb) * uExposure);
        vec3 colB = aces(safe(texture2D(tDiffuse, uv - off).rgb) * uExposure);
        col.r = colR.r;
        col.b = colB.b;
      }

      // grade: gentle contrast, teal shadows / warm highlights, slight desaturation
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float sat = mix(1.02, 0.25, uLowHealth);
      col = mix(vec3(l), col, sat);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.34);
      col += vec3(-0.012, 0.004, 0.02) * (1.0 - smoothstep(0.0, 0.45, l));
      col += vec3(0.02, 0.008, -0.018) * smoothstep(0.45, 1.0, l);
      col = max(col, vec3(0.0));

      // vignette
      vec2 vc = c * vec2(1.0, 0.82);
      float v = smoothstep(0.18, 0.95, dot(vc, vc) * 2.4);
      col *= 1.0 - v * (uVignette + uFocus * 0.35);

      // damage: pulsing blood-red edges
      float edge = smoothstep(0.08, 0.5, r2 + (hash12(floor(uv * 90.0)) - 0.5) * 0.03);
      float dmg = clamp(uDamage + uLowHealth * (0.55 + 0.2 * sin(uTime * 5.0)), 0.0, 1.0);
      col = mix(col, vec3(0.42, 0.01, 0.0) * (0.4 + l), edge * dmg * 0.85);

      // explosion / flash whiteout and fades
      col = mix(col, vec3(1.0, 0.97, 0.9), clamp(uFlash, 0.0, 1.0));
      col *= 1.0 - uFade;

      // subtle micro-contrast sharpening (1 ACES evaluation on averaged 4-tap neighborhood instead of 4 separate ACES calls)
      vec2 px = 1.0 / uRes;
      vec3 nbHdr = (safe(texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb)
                  + safe(texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb)
                  + safe(texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb)
                  + safe(texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb)) * 0.25;
      vec3 nb = aces(nbHdr * uExposure);
      vec3 sharpDiff = clamp(col - nb, vec3(-0.07), vec3(0.11));
      col = clamp(col + sharpDiff * 0.19, vec3(0.0), vec3(1.0));

      // subtle midtone-only film grain (keeps dark night shadows silky-clean with zero static noise)
      float g = hash12(gl_FragCoord.xy + fract(uTime) * 311.0) - 0.5;
      float midMask = smoothstep(0.06, 0.32, l) * (1.0 - smoothstep(0.68, 1.0, l));
      col += g * uGrain * midMask;

      // Quad-tube white-phosphor / cold-emerald tactical Night Vision Goggles (transition blend)
      if (uNvg > 0.005) {
        vec3 nvgRaw = rawCenter * uExposure * 3.8;
        float nl = dot(nvgRaw, vec3(0.26, 0.64, 0.10));
        float nv = pow(clamp(nl / (1.0 + nl * 0.75), 0.0, 1.0), 1.28);
        vec3 wpLow = vec3(0.008, 0.045, 0.042);
        vec3 wpMid = vec3(0.14, 0.76, 0.58);
        vec3 wpHi = vec3(0.84, 0.99, 0.95);
        vec3 nvgCol = mix(mix(wpLow, wpMid, smoothstep(0.02, 0.52, nv)), wpHi, smoothstep(0.48, 1.0, nv));
        float nvgNoise = (hash12(gl_FragCoord.xy * 0.85 + fract(uTime * 1.7) * 521.0) - 0.5) * 0.065;
        float scan = 0.97 + 0.03 * sin(gl_FragCoord.y * 1.6);
        nvgCol = clamp((nvgCol + nvgNoise) * scan, 0.0, 1.0);
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
        float d1 = length(p - vec2(-0.34, 0.0));
        float d2 = length(p - vec2(0.34, 0.0));
        float d3 = length(p - vec2(-0.74, 0.0));
        float d4 = length(p - vec2(0.74, 0.0));
        float tube = min(min(d1, d2), min(d3, d4));
        float mask = 1.0 - smoothstep(0.48, 0.57, tube);
        nvgCol *= (0.08 + 0.92 * mask);
        col = mix(col, nvgCol, uNvg);
      }

      col = mix(col * 12.92, 1.055 * pow(max(col, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Renders an extra scene on top of the current buffer, optionally clearing depth first. */
class OverlayPass extends Pass {
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private clearDepth: boolean) {
    super();
    this.needsSwap = false;
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const old = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    if (this.clearDepth) renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = old;
  }
}

/**
 * Half-resolution bilateral GTAO that multiplies the occlusion straight onto the full-res
 * scene buffer instead of copying to the other composer target. 4x fewer G-buffer/AO/denoise
 * pixels with identical smooth contact shadows via hardware bilinear upsampling, and skips
 * non-AO background geometry (sky dome, distant mountains, ocean) during the normal pass.
 */
class InPlaceGTAOPass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    super(scene, camera, width, height);
    this.needsSwap = false;
  }
  setSize(width: number, height: number) {
    super.setSize(Math.max(2, Math.round(width * 0.5)), Math.max(2, Math.round(height * 0.5)));
  }
  overrideVisibility() {
    const cache = (this as unknown as { _visibilityCache: Map<THREE.Object3D, boolean> })._visibilityCache;
    this.scene.traverse((object) => {
      cache.set(object, object.visible);
      if (
        (object as THREE.Points).isPoints ||
        (object as THREE.Line).isLine ||
        (object as THREE.SkinnedMesh).isSkinnedMesh ||
        object.userData?.noAo
      ) {
        object.visible = false;
      }
    });
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    (GTAOPass.prototype.render as (...args: unknown[]) => void).call(this, renderer, read, read);
  }
  renderPass(renderer: THREE.WebGLRenderer, passMaterial: THREE.Material, renderTarget: THREE.WebGLRenderTarget, clearColor?: THREE.ColorRepresentation, clearAlpha?: number) {
    // skip the read -> write copy (it would be a self-copy here); only the AO blend is wanted
    if (passMaterial === (this as unknown as { copyMaterial: THREE.Material }).copyMaterial) return;
    (GTAOPass.prototype as unknown as { renderPass: (...args: unknown[]) => void }).renderPass.call(this, renderer, passMaterial, renderTarget, clearColor, clearAlpha);
  }
}

/** Quarter-res mip0 UnrealBloomPass (4x faster Gaussian bloom with identical soft HDR glow). */
class HalfResBloomPass extends UnrealBloomPass {
  setSize(width: number, height: number) {
    super.setSize(Math.max(4, Math.round(width * 0.5)), Math.max(4, Math.round(height * 0.5)));
  }
}

interface FlashLight {
  light: THREE.PointLight;
  life: number;
  max: number;
  peak: number;
}

interface VirtualLight {
  src: THREE.PointLight;
  pos: THREE.Vector3;
}

const WORLD_LIGHT_SLOTS = 8;

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  fxScene = new THREE.Scene();
  vmScene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.06, 1600);
  vmCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 8);

  /** Direction of the key light. Slightly higher than the photographed sun so streets aren't all shadow. */
  sunDir = new THREE.Vector3(-0.72, 0, -0.36).normalize().multiplyScalar(Math.cos(0.3)).setY(Math.sin(0.3));
  /** Where the sun is drawn in the sky (disc, glare, light shafts). */
  skySunDir = this.sunDir.clone();
  sunColor = new THREE.Color().setRGB(1.0, 0.74, 0.47);
  haze = new THREE.Color().setRGB(0.76, 0.66, 0.53);
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  vmSun!: THREE.DirectionalLight;
  vmHemi!: THREE.HemisphereLight;
  vmFlash!: THREE.PointLight;
  /** Tactical weapon flashlight attached to camera (used in dark interior/storm missions). */
  flashlight!: THREE.SpotLight;
  /** Parent of all first-person models; follows the main camera transform. */
  vmRoot = new THREE.Group();
  /** 0 = viewmodel in shade, 1 = sunlit. */
  vmSunlit = 1;
  theme: 'desert' | 'storm' = 'desert';

  private sky!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private desertSkyMat!: THREE.ShaderMaterial;
  private stormSkyMat!: THREE.ShaderMaterial;
  private desertEnv: THREE.Texture | null = null;
  private lightningAmt = 0;
  private composer!: EffectComposer;
  private gtao!: GTAOPass;
  private bloom!: UnrealBloomPass;
  private smaa!: SMAAPass;
  final!: ShaderPass;
  private flashes: FlashLight[] = [];
  /** Permanent fixed pool of world PointLights so NUM_POINT_LIGHTS is ALWAYS constant (never 71!) across all maps. */
  private lightPool: THREE.PointLight[] = [];
  private virtualLights: VirtualLight[] = [];
  private topLights: VirtualLight[] = [];
  private topScores: number[] = [];
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private shadowRange = 62;
  private shadowDirty = true;
  private shadowFrame = 0;
  private lastShadowCenter = new THREE.Vector3(1e9, 1e9, 1e9);
  private gpuName = '';
  time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.NoToneMapping;
    r.info.autoReset = false;
    setMaxAnisotropy(Math.min(16, r.capabilities.getMaxAnisotropy()));
    this.gpuName = this.detectGpuName();
    patchFog(this.sunDir);

    this.scene.fog = new THREE.FogExp2(this.haze, 0.0042);
    this.fxScene.fog = this.scene.fog;

    // --- sky dome ---
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uSunDir: { value: this.sunDir }, uTime: { value: 0 }, uSunDisc: { value: 1 }, uHaze: { value: this.haze } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sky.userData.noAo = true;
    this.scene.add(this.sky);

    // --- lights ---
    this.sun = new THREE.DirectionalLight(this.sunColor, 5.8);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.09;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.56, 0.70, 0.94), new THREE.Color().setRGB(0.68, 0.54, 0.38), 1.5);
    this.scene.add(this.hemi);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 40, 2);
      this.scene.add(l);
      this.flashes.push({ light: l, life: 0, max: 1, peak: 0 });
    }
    for (let i = 0; i < WORLD_LIGHT_SLOTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 32, 1.5);
      this.scene.add(l);
      this.lightPool.push(l);
    }

    this.vmSun = new THREE.DirectionalLight(this.sunColor, 5.8);
    this.vmHemi = new THREE.HemisphereLight(this.hemi.color, this.hemi.groundColor, 1.5);
    this.vmFlash = new THREE.PointLight(0xffb060, 0, 3, 2);
    this.vmScene.add(this.vmSun, this.vmSun.target, this.vmHemi, this.vmRoot);
    this.vmRoot.add(this.vmFlash);
    // Tactical weapon flashlight (active during dark storm/interior missions)
    this.flashlight = new THREE.SpotLight(0xeef6ff, 0, 52, Math.PI * 0.23, 0.52, 1.35);
    this.flashlight.castShadow = false;
    this.scene.add(this.flashlight, this.flashlight.target);
    this.stormSkyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_STORM_FRAG,
      uniforms: { uTime: { value: 0 }, uLightning: { value: 0 }, uHaze: { value: new THREE.Color(0x0b1624) } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    // soft camera-relative key from above/behind so the weapon keeps its shape in shade
    const fill = new THREE.DirectionalLight(new THREE.Color().setRGB(0.82, 0.88, 1.0), 1.3);
    fill.position.set(-0.5, 1.0, 0.55);
    fill.target.position.set(0, 0, -0.3);
    this.vmRoot.add(fill, fill.target);

    // light basis for texel snapping
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this.lightUp.crossVectors(this.sunDir, this.lightRight).normalize();

    this.buildEnvironment();
    this.buildComposer();
    this.setQuality(settings.quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildEnvironment() {
    const envScene = new THREE.Scene();
    const mat = this.skyMat.clone();
    mat.uniforms.uSunDir = { value: this.sunDir };
    mat.uniforms.uHaze = { value: this.haze };
    mat.uniforms.uSunDisc = { value: 0 };
    mat.uniforms.uTime = { value: 0 };
    mat.vertexShader = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), mat);
    envScene.add(dome);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.75;
    this.vmScene.environment = rt.texture;
    this.vmScene.environmentIntensity = 0.9;
    pmrem.dispose();
    dome.geometry.dispose();
    mat.dispose();
  }

  /** Switches the sky dome and image-based lighting over to the loaded HDRI. */
  setSky(bg: THREE.Texture, hdr: THREE.Texture, meta: SkyMeta) {
    const az = (x: number, z: number) => Math.atan2(z, x);
    const rot = az(meta.sunDir[0], meta.sunDir[2]) - az(this.sunDir.x, this.sunDir.z);
    // Elevate the sun slightly (at least ~14.5 degrees) so it rises above mountains/fences and remains clearly visible
    const el = Math.max(0.25, Math.asin(meta.sunDir[1]));
    this.skySunDir.set(this.sunDir.x, 0, this.sunDir.z).normalize().multiplyScalar(Math.cos(el)).setY(Math.sin(el));
    const old = this.skyMat;
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_PHOTO_FRAG,
      uniforms: {
        uSky: { value: bg }, uRot: { value: rot }, uHaze: { value: this.haze }, uSkyBottom: { value: meta.skyBottom },
        uGain: { value: 1.05 }, uSunDisc: { value: 1.0 }, uSunDir: { value: this.skySunDir }, uSunColor: { value: this.sunColor },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky.material = this.skyMat;
    this.desertSkyMat = this.skyMat;
    old.dispose();

    // image-based lighting: HDR sky above, sunlit sand below
    const envMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: SKY_ENV_FRAG,
      uniforms: {
        uSky: { value: hdr }, uRot: { value: rot }, uHaze: { value: this.haze }, uGain: { value: 1.4 },
        uGround: { value: new THREE.Color().setRGB(0.36, 0.28, 0.2) },
      },
      side: THREE.BackSide,
    });
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), envMat);
    envScene.add(dome);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    this.scene.environment?.dispose();
    this.desertEnv = rt.texture;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 1.15;
    this.vmScene.environment = rt.texture;
    this.vmScene.environmentIntensity = 1.1;
    pmrem.dispose();
    dome.geometry.dispose();
    envMat.dispose();
    // Warm desert sand ground bounce + cool sky fill so shaded roofs, interiors & alleys stay rich and legible
    this.hemi.intensity = 0.58;
    this.hemi.color.setRGB(0.58, 0.72, 0.94);
    this.hemi.groundColor.setRGB(0.74, 0.58, 0.40);
  }

  /** Lazily baked stormy moonlit PMREM environment so wet steel & guns reflect crisp storm clouds, not desert sand. */
  private stormEnv: THREE.Texture | null = null;
  private getStormEnv(): THREE.Texture {
    if (this.stormEnv) return this.stormEnv;
    const envScene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -1.0, 1.0);
          vec3 ocean = vec3(0.06, 0.11, 0.18);
          vec3 horizon = vec3(0.24, 0.38, 0.56);
          vec3 zenith = vec3(0.12, 0.22, 0.36);
          vec3 col = h < 0.0 ? mix(horizon * 0.55, ocean, clamp(-h * 2.5, 0.0, 1.0)) : mix(horizon, zenith, pow(h, 0.65));
          // Silver-blue moonbreak rim highlight for crisp wet metal speculars
          vec3 moonDir = normalize(vec3(0.45, 0.55, -0.7));
          float m = pow(max(0.0, dot(d, moonDir)), 24.0);
          col += vec3(0.9, 1.15, 1.45) * m * 1.8;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), mat);
    envScene.add(dome);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    this.stormEnv = rt.texture;
    pmrem.dispose();
    dome.geometry.dispose();
    mat.dispose();
    return this.stormEnv;
  }

  /** Switches atmosphere cleanly between sunlit desert maps and midnight storm ocean missions. */
  setTheme(theme: 'desert' | 'storm') {
    this.theme = theme;
    const fog = this.scene.fog as THREE.FogExp2;
    if (theme === 'storm') {
      this.skyMat = this.stormSkyMat;
      this.sky.material = this.stormSkyMat;
      const sEnv = this.getStormEnv();
      this.scene.environment = sEnv;
      this.vmScene.environment = sEnv;
      this.sun.color.setHex(0x94c2f0);
      this.sun.intensity = 2.2;
      this.vmSun.color.setHex(0x9ac8f6);
      this.hemi.color.setHex(0x3a5f8a);
      this.hemi.groundColor.setHex(0x162432);
      this.hemi.intensity = 1.35;
      this.scene.environmentIntensity = 0.78;
      this.vmScene.environmentIntensity = 0.92;
      fog.color.setHex(0x0d1928);
      fog.density = 0.0068;
      this.final.uniforms.uExposure.value = 1.24;
    } else {
      if (this.desertSkyMat) {
        this.skyMat = this.desertSkyMat;
        this.sky.material = this.desertSkyMat;
      }
      if (this.desertEnv) {
        this.scene.environment = this.desertEnv;
        this.vmScene.environment = this.desertEnv;
      }
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = 5.8;
      this.vmSun.color.copy(this.sunColor);
      this.hemi.color.setRGB(0.58, 0.72, 0.94);
      this.hemi.groundColor.setRGB(0.74, 0.58, 0.40);
      this.hemi.intensity = 0.58;
      this.scene.environmentIntensity = 1.15;
      this.vmScene.environmentIntensity = 1.1;
      fog.color.copy(this.haze);
      fog.density = 0.0042;
      this.final.uniforms.uExposure.value = 0.95;
      this.final.uniforms.uNvg.value = 0;
      this.flashlight.intensity = 0;
    }
    this.shadowDirty = true;
  }

  private detectGpuName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : String(gl.getParameter(gl.RENDERER) ?? '');
    // Extract concise GPU hardware model from ANGLE string, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti Laptop GPU ...)"
    const m = raw.match(/(NVIDIA[^,()]+|AMD Radeon[^,()]+|Intel\([^)]*\)[^,()]*|Apple M[0-9][^,()]*)/i);
    if (m) return m[1].replace(/\s*Direct3D11.*$/i, '').replace(/\s*\(0x[0-9a-f]+\)/i, '').trim();
    return raw.slice(0, 48) || 'WebGL2 GPU';
  }

  getGpuInfo(): string {
    return this.gpuName;
  }

  /**
   * Extracts all static/dynamic THREE.PointLight instances inside a level group into the proximity
   * virtual light pool. Keeps the original PointLight objects alive so mission animations (flare,
   * alarms, engine blackout, bridge hack) keep mutating them transparently, while keeping GPU
   * NUM_POINT_LIGHTS permanently locked to WORLD_LIGHT_SLOTS + 4 = 12 across every map!
   */
  virtualizeLevelLights(root: THREE.Object3D) {
    this.clearVirtualLights();
    root.updateMatrixWorld(true);
    const found: THREE.PointLight[] = [];
    root.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) found.push(o as THREE.PointLight);
    });
    for (const l of found) {
      const wp = new THREE.Vector3();
      l.getWorldPosition(wp);
      l.parent?.remove(l);
      this.virtualLights.push({ src: l, pos: wp });
    }
    this.updateLightPool();
  }

  /** Registers an extra dynamic PointLight (e.g. ambient fires) into the proximity virtual pool without altering GPU NUM_POINT_LIGHTS. */
  addVirtualLight(l: THREE.PointLight) {
    l.parent?.remove(l);
    this.virtualLights.push({ src: l, pos: l.position.clone() });
  }

  clearVirtualLights() {
    this.virtualLights.length = 0;
    for (const l of this.lightPool) {
      l.intensity = 0;
      l.position.set(0, -100, 0);
    }
  }

  private updateLightPool() {
    const vls = this.virtualLights;
    if (!vls.length) return;
    const cx = this.camera.position.x;
    const cy = this.camera.position.y;
    const cz = this.camera.position.z;
    const topL = this.topLights;
    const topS = this.topScores;
    topL.length = 0;
    topS.length = 0;

    for (let i = 0; i < vls.length; i++) {
      const vl = vls[i];
      const src = vl.src;
      if (!src.visible || src.intensity <= 0.05) continue;
      const dx = vl.pos.x - cx;
      const dy = vl.pos.y - cy;
      const dz = vl.pos.z - cz;
      const range = src.distance > 0 ? src.distance : 36;
      const maxRange = range + 14;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > maxRange * maxRange) continue;
      // Strongly prefer lights on the player's current vertical deck/floor so unseen decks don't steal light slots
      const floorPenalty = Math.abs(dy) > 4.6 ? (Math.abs(dy) - 4.6) * 24 : 0;
      const score = Math.sqrt(distSq) + floorPenalty - Math.min(8, src.intensity * 0.08);

      // Insertion into sorted top-K (K = WORLD_LIGHT_SLOTS = 8, zero GC allocations)
      if (topL.length < WORLD_LIGHT_SLOTS || score < topS[topS.length - 1]) {
        let pos = topL.length;
        if (pos < WORLD_LIGHT_SLOTS) {
          topL.push(vl);
          topS.push(score);
        } else {
          pos = WORLD_LIGHT_SLOTS - 1;
          topL[pos] = vl;
          topS[pos] = score;
        }
        while (pos > 0 && topS[pos] < topS[pos - 1]) {
          const ts = topS[pos - 1]; topS[pos - 1] = topS[pos]; topS[pos] = ts;
          const tl = topL[pos - 1]; topL[pos - 1] = topL[pos]; topL[pos] = tl;
          pos--;
        }
      }
    }

    for (let i = 0; i < WORLD_LIGHT_SLOTS; i++) {
      const slot = this.lightPool[i];
      if (i < topL.length) {
        const vl = topL[i];
        const src = vl.src;
        const dist = Math.hypot(vl.pos.x - cx, vl.pos.y - cy, vl.pos.z - cz);
        const range = src.distance > 0 ? src.distance : 36;
        // Smooth edge attenuation over the outer 12m so lights fade in/out seamlessly without popping
        const fade = dist <= range ? 1 : Math.max(0, 1 - (dist - range) / 14);
        slot.position.copy(vl.pos);
        slot.color.copy(src.color);
        slot.intensity = src.intensity * fade;
        slot.distance = src.distance;
        slot.decay = src.decay;
      } else {
        slot.intensity = 0;
      }
    }
  }

  /**
   * Async Chunked GPU VRAM & WebGL2 Shader Pre-Warming Pass (executed behind the level loading screen):
   * Yields smoothly between texture batches, shader compile, and multi-zone camera passes so the
   * loading progress bar never freezes and 100% of shaders/textures/VBOs are resident before play starts.
   */
  async prewarmAsync(
    spawnPoints?: { x: number; z: number }[],
    onProgress?: (f: number, detail: string) => Promise<void> | void,
  ) {
    const r = this.renderer;
    const savedCull: Array<{ obj: THREE.Object3D; culled: boolean }> = [];
    const savedVis: Array<{ obj: THREE.Object3D; vis: boolean }> = [];
    const textures: THREE.Texture[] = [];
    const seenTex = new Set<THREE.Texture>();

    const collectMatTextures = (mat: any) => {
      if (!mat) return;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'lightMap']) {
        const t = mat[k];
        if (t && t.isTexture && !seenTex.has(t)) {
          seenTex.add(t);
          textures.push(t);
        }
      }
    };

    const prepareRoot = (root: THREE.Object3D, forceVisible: boolean) => {
      root.traverse((o) => {
        if (forceVisible && !o.visible) {
          savedVis.push({ obj: o, vis: o.visible });
          o.visible = true;
        }
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) {
          savedCull.push({ obj: o, culled: o.frustumCulled });
          o.frustumCulled = false;
          const mat = (o as any).material;
          if (Array.isArray(mat)) mat.forEach(collectMatTextures);
          else collectMatTextures(mat);
        }
      });
    };

    prepareRoot(this.scene, false);
    prepareRoot(this.vmScene, true);
    prepareRoot(this.fxScene, false);

    // 1. Chunked VRAM texture upload (keeps loading UI silky-responsive!)
    const totalTex = Math.max(1, textures.length);
    const BATCH = 36;
    for (let i = 0; i < textures.length; i += BATCH) {
      const end = Math.min(textures.length, i + BATCH);
      for (let j = i; j < end; j++) {
        try { r.initTexture(textures[j]); } catch { /* ignore */ }
      }
      if (onProgress) await onProgress((end / totalTex) * 0.45, `正在上传显存纹理 (${end}/${textures.length})…`);
    }

    // 2. Compile ALL WebGL2 shader programs (main world + viewmodel + fxScene particles/tracers/Boss VFX!)
    if (onProgress) await onProgress(0.55, '正在编译 PBR、特效与战区着色器…');
    r.compile(this.scene, this.camera);
    r.compile(this.fxScene, this.camera);
    r.compile(this.vmScene, this.vmCamera);

    // 3. Render 1 unculled full-scene + shadow pass so every VBO and depth shader across all zones is resident!
    if (onProgress) await onProgress(0.72, '正在烘焙主战区阴影与显存缓冲…');
    const sp0 = spawnPoints && spawnPoints.length ? spawnPoints[0] : { x: 0, z: 0 };
    const prevCamPos = this.camera.position.clone();
    const prevCamQuat = this.camera.quaternion.clone();
    this.camera.position.set(sp0.x, 4.0, sp0.z);
    this.camera.lookAt(0, 1.5, 0);
    this.shadowDirty = true;
    this.render(0.016, new THREE.Vector3(sp0.x, 0, sp0.z));

    for (const item of savedCull) item.obj.frustumCulled = item.culled;
    for (const item of savedVis) item.obj.visible = item.vis;

    // 4. Multi-zone camera sweep yielding smoothly per checkpoint
    if (spawnPoints && spawnPoints.length > 1) {
      for (let i = 1; i < spawnPoints.length; i++) {
        const sp = spawnPoints[i];
        this.camera.position.set(sp.x, 2.2, sp.z);
        this.camera.lookAt(0, 1.5, 0);
        this.updateLightPool();
        r.render(this.scene, this.camera);
        if (onProgress) await onProgress(0.75 + (i / spawnPoints.length) * 0.23, `正在预热战区视角 (${i}/${spawnPoints.length - 1})…`);
      }
    }

    this.camera.position.copy(prevCamPos);
    this.camera.quaternion.copy(prevCamQuat);
    this.shadowDirty = true;
    if (onProgress) await onProgress(1, '战区显存预热完成');
  }

  /** Forces an immediate 4K shadow map refresh on the next frame (e.g. after level/door change). */
  markShadowsDirty() {
    this.shadowDirty = true;
  }

  /** Triggers a sheet-lightning flash across the midnight storm sky & ship deck. */
  triggerLightning(strength = 1.0) {
    this.lightningAmt = Math.max(this.lightningAmt, strength);
  }

  setFlashlight(on: boolean) {
    this.flashlight.intensity = on ? 22 : 0;
  }

  private buildComposer() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new InPlaceGTAOPass(this.scene, this.camera, 4, 4);
    this.gtao.updateGtaoMaterial({ radius: 0.65, distanceExponent: 1.5, thickness: 1.1, scale: 0.95, samples: 8, distanceFallOff: 1, screenSpaceRadius: false });
    // Half-res bilateral Poisson denoise uses radius 3.5px (= 7px in full-res screen space) for identical smooth AO
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 3.5, radiusExponent: 2, rings: 2, samples: 8 });
    this.gtao.blendIntensity = 0.68;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OverlayPass(this.fxScene, this.camera, false));
    this.composer.addPass(new OverlayPass(this.vmScene, this.vmCamera, true));
    this.bloom = new HalfResBloomPass(new THREE.Vector2(4, 4), 0.16, 0.48, 1.9);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.smaa = new SMAAPass(4, 4);
    this.composer.addPass(this.smaa);
  }

  setQuality(q: Quality) {
    const r = this.renderer;
    const dpr = window.devicePixelRatio || 1;
    // Cap DPR at 1.25 on High to keep HiDPI 2K/4K screens locked at high FPS with zero fillrate drops
    const ratio = q === 'high' ? Math.min(dpr, 1.25) : q === 'medium' ? Math.min(dpr, 1.0) : Math.min(dpr, 0.8);
    r.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.gtao.enabled = q === 'high';
    // SMAA runs on the tone-mapped buffer and, on some drivers, turns the clipped sun into a
    // black disc and crushes the whole frame; native DPR render scale already gives clean edges
    this.smaa.enabled = false;
    this.bloom.enabled = true;
    const size = q === 'high' ? 2048 : q === 'medium' ? 1024 : 1024;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      if (sh.map) {
        sh.map.dispose();
        (sh as any).map = null;
      }
    }
    this.shadowRange = q === 'low' ? 42 : q === 'medium' ? 52 : 60;
    const cam = sh.camera;
    cam.left = -this.shadowRange;
    cam.right = this.shadowRange;
    cam.top = this.shadowRange;
    cam.bottom = -this.shadowRange;
    cam.near = 1;
    cam.far = 420;
    cam.updateProjectionMatrix();
    this.shadowDirty = true;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.final.uniforms.uAspect.value = w / h;
    const dpr = this.renderer.getPixelRatio();
    this.final.uniforms.uRes.value.set(Math.max(1, w * dpr), Math.max(1, h * dpr));
  }

  /** Short-lived dynamic light (muzzle flashes, explosions). */
  flash(pos: THREE.Vector3, color: number, intensity: number, duration: number, distance = 30) {
    let best = this.flashes[0];
    for (const f of this.flashes) if (f.life / f.max * f.peak < best.life / best.max * best.peak) best = f;
    best.light.position.copy(pos);
    best.light.color.set(color);
    best.light.distance = distance;
    best.life = duration;
    best.max = duration;
    best.peak = intensity;
  }

  private updateShadowCamera(center: THREE.Vector3) {
    // snap the shadow frustum to shadow-map texels to avoid shimmering
    const texel = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
    const x = Math.round(center.dot(this.lightRight) / texel) * texel;
    const y = Math.round(center.dot(this.lightUp) / texel) * texel;
    const z = center.dot(this.sunDir);
    this.tmp.set(0, 0, 0).addScaledVector(this.lightRight, x).addScaledVector(this.lightUp, y).addScaledVector(this.sunDir, z);
    this.sun.target.position.copy(this.tmp);
    this.sun.position.copy(this.tmp).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }

  render(dt: number, shadowCenter: THREE.Vector3) {
    this.time += dt;
    const u = this.final.uniforms;
    u.uTime.value = this.time;
    this.skyMat.uniforms.uTime.value = this.time;
    this.sky.position.copy(this.camera.position);

    // Midnight storm lightning flash decay, rain ripples & weapon flashlight tracking
    if (this.theme === 'storm') {
      rainRippleUniform.value.set(this.time, 1.0);
      this.lightningAmt = Math.max(0, this.lightningAmt - dt * 3.1);
      // Natural ambient sheet-lightning flicker in the distant typhoon clouds
      const ambientFlash = Math.pow(Math.max(0, Math.sin(this.time * 0.85) * Math.sin(this.time * 2.35 + 1.4)), 10.0) * 0.65;
      const lf = Math.max(this.lightningAmt * this.lightningAmt, ambientFlash);
      this.stormSkyMat.uniforms.uLightning.value = lf;
      stormLightningUniform.value = lf;
      this.sun.intensity = 1.45 + lf * 9.5;
      this.hemi.intensity = 1.05 + lf * 1.4;
    } else {
      rainRippleUniform.value.set(0, 0);
      stormLightningUniform.value = 0;
    }
    if (this.flashlight.intensity > 0) {
      this.camera.updateMatrixWorld();
      this.camera.getWorldDirection(this.tmp);
      this.flashlight.position.copy(this.camera.position).addScaledVector(this.tmp, 0.25);
      this.flashlight.position.y -= 0.12;
      this.flashlight.target.position.copy(this.camera.position).addScaledVector(this.tmp, 18);
      this.flashlight.target.updateMatrixWorld();
    }

    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        const k = Math.max(0, f.life / f.max);
        f.light.intensity = f.peak * k * k;
      } else f.light.intensity = 0;
    }
    this.updateLightPool();

    // The viewmodel lives in world space at the camera transform (rendered by a
    // second camera with its own FOV), so world lighting/reflections stay correct.
    this.camera.updateMatrixWorld();
    this.vmCamera.position.copy(this.camera.position);
    this.vmCamera.quaternion.copy(this.camera.quaternion);
    this.vmRoot.position.copy(this.camera.position);
    this.vmRoot.quaternion.copy(this.camera.quaternion);
    this.vmSun.target.position.copy(this.camera.position);
    this.vmSun.position.copy(this.camera.position).addScaledVector(this.sunDir, 10);
    // dim the sun on the weapon when the player stands in shadow
    this.vmSun.intensity = this.sun.intensity * (0.05 + 0.95 * this.vmSunlit);
    this.vmHemi.intensity = this.hemi.intensity * 2.4 * (0.8 + 0.2 * this.vmSunlit);

    // sun shafts (desert daytime only)
    if (this.theme === 'desert') {
      this.tmp.copy(this.camera.position).addScaledVector(this.skySunDir, 1000).project(this.camera);
      const facing = this.tmp.z < 1 ? 1 : 0;
      u.uSunPos.value.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
      const offscreen = Math.max(Math.abs(this.tmp.x), Math.abs(this.tmp.y));
      u.uSunAmt.value = facing * THREE.MathUtils.clamp(1.6 - offscreen, 0, 1) * 0.075;
    } else {
      u.uSunAmt.value = 0;
    }

    // Event-driven shadow map caching:
    // Refresh only when player moves >= 34m (well inside the 120m shadow frustum) or scene changes,
    // and skip sun shadow map rebuilds completely when deep underground (Engine Room / Server Vault)!
    const underground = shadowCenter.y < -3.0;
    const moved = !underground && this.lastShadowCenter.distanceToSquared(shadowCenter) > 1156.0;
    if (this.shadowDirty || moved) {
      this.updateShadowCamera(shadowCenter);
      this.lastShadowCenter.copy(shadowCenter);
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
