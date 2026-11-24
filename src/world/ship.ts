import * as THREE from 'three';
import { makePropObject } from '../render/assets';
import { Materials } from '../render/materials';
import { LevelBuilder } from './build';
import { makeCampMats, signBoard, textLines, FONT, CJK } from './camp';
import type { LevelData } from './level';
import { importShipLayout, mergeExtrasByMaterial, type ShipLayoutJSON, type VirtualLight } from './shipCatalog';
import shipLayoutData from './shipLayout.json';
import { CollectibleManager, HIGHSEAS_COLLECTIBLES } from './collectibles';
import { InteractableSystem } from './interactables';

const H = Math.PI / 2;

export interface ShipDynamic {
  heli: THREE.Group;
  heliRotor: THREE.Object3D;
  heliTailRotor: THREE.Object3D;
  heliRope: THREE.Mesh;
  heliSpot: THREE.SpotLight;
  watertightDoor: THREE.Object3D;
  holdAirlockDoor: THREE.Object3D;
  bowAirlockDoor: THREE.Object3D;
  messMainDoor: THREE.Object3D;
  messSideDoor: THREE.Object3D;
  watertightCollider: { enabled: boolean };
  holdAirlockCollider: { enabled: boolean };
  bowAirlockCollider: { enabled: boolean };
  messMainCollider: { enabled: boolean };
  messSideCollider: { enabled: boolean };
  floodWater: THREE.Mesh;
  thermiteGlow: THREE.PointLight;
  thermiteMesh: THREE.Mesh;
  mainLights: THREE.PointLight[];
  alarmLights: THREE.PointLight[];
  waterJets: THREE.Mesh[];
  intelTablet: THREE.Group;
  slide1: { mesh: THREE.Object3D; col: { enabled: boolean }; t: number; active: boolean };
  slide2: { mesh: THREE.Object3D; t: number; active: boolean };
  slide3: { mesh: THREE.Object3D; t: number; active: boolean };
  rain: THREE.LineSegments;
  destroyerBeam: THREE.Mesh;
  collectibles: CollectibleManager;
  interactables: InteractableSystem;
  setSinking(level: number): void;
  setAlarm(on: boolean): void;
  setBlackout(blackout: boolean): void;
  setThermite(on: boolean): void;
  setIndoors(inside: boolean): void;
  triggerSlide(idx: 1 | 2 | 3): void;
}

/** Authored world coordinates aligned strictly to the 1.0m-grid `shipLayout.json` for M/V Taishan. */
export const SHIP = {
  // Zone A: Stern Drop Apron & 3-Lane Container Maze (z = -96..-42, y = 0.0)
  sternDrop: { x: 0, y: 0.0, z: -90.0, yaw: Math.PI },
  smokeSentries: [
    { x: -2.0, z: -78.0, yaw: 0.2 },
    { x: 2.0, z: -78.5, yaw: -0.3 },
  ],
  patrolPairs: [
    { x: -3.5, z: -69.0, yaw: 0, pts: [[-3.5, -70.0], [-3.5, -54.0]] as [number, number][] },
    { x: 3.5, z: -62.0, yaw: Math.PI, pts: [[3.5, -64.0], [-0.5, -55.0]] as [number, number][] },
    { x: -10.5, z: -57.0, yaw: 0, pts: [[-10.5, -66.0], [-10.5, -48.0]] as [number, number][] },
    { x: 1.5, z: -46.0, yaw: -H, pts: [[-3.5, -46.0], [4.0, -46.0]] as [number, number][] },
  ],
  watertightDoor: { x: 0, y: 0.0, z: -42.0 },

  // Zone B: 3-Story Superstructure (x = -14..+14, z = -42..-18; 1F y=0.0, 2F y=3.6, 3F y=7.2)
  cabinEnemies: [
    { x: -12.0, y: 0.0, z: -28.0, yaw: H },
    { x: 12.0, y: 0.0, z: -20.0, yaw: -H },
  ],
  cabinHostages: [
    { x: 12.0, y: 0.0, z: -28.0, yaw: -H },
    { x: -12.0, y: 0.0, z: -20.0, yaw: H },
  ],
  messBreachSpot: { x: 3.6, y: 3.6, z: -32.0 },
  messSideDoor: { x: -4.0, y: 3.6, z: -26.0 },
  messMilitants: [
    { x: -2.0, y: 3.6, z: -31.0, yaw: 1.4 },
    { x: -6.5, y: 3.6, z: -28.5, yaw: 1.1 },
    { x: -4.5, y: 3.6, z: -32.2, yaw: 2.1 },
    { x: -9.0, y: 3.6, z: -30.0, yaw: 0.9 },
  ],
  messHostages: [
    { x: -6.0, y: 3.6, z: -30.2, yaw: -1.1 },
    { x: -8.0, y: 3.6, z: -29.2, yaw: -1.3 },
    { x: -11.8, y: 3.6, z: -29.8, yaw: -0.8 },
    { x: -8.2, y: 3.6, z: -32.8, yaw: -1.5 },
  ],
  captainPos: { x: -12.0, y: 3.6, z: -30.0, yaw: 1.2 },
  bridgeIntel: { x: 0, y: 8.32, z: -22.2 },
  holdShaft: { x: 0, y: 0.0, z: -20.0 },

  // Zone C: 13.2m-Tall Below-Deck Main Cargo Hold (x = -14..+14, z = -18..+46; Catwalk y=0.0, Floor y=-6.0)
  holdCatwalkEntry: { x: 0, y: 0.0, z: -16.0 },
  holdHeavyPickup: { x: -10.5, y: -6.0, z: 6.0 },
  holdSniper: { x: -11.5, y: 0.0, z: 24.0, yaw: 0.25 },
  holdEnemies: [
    { kind: 'sniper' as const, x: -11.5, y: 0.0, z: 24.0, yaw: Math.PI },
    { kind: 'specops' as const, x: 11.5, y: 0.0, z: 18.0, yaw: Math.PI },
    { kind: 'rifleman' as const, x: 11.5, y: 0.0, z: 34.0, yaw: Math.PI },
    { kind: 'breacher' as const, x: -6.0, y: -6.0, z: 6.0, yaw: Math.PI },
    { kind: 'rifleman' as const, x: 6.0, y: -6.0, z: 10.0, yaw: Math.PI },
    { kind: 'rusher' as const, x: -6.0, y: -6.0, z: 18.0, yaw: Math.PI },
    { kind: 'heavy' as const, x: 0.0, y: -6.0, z: 26.5, yaw: Math.PI },
    { kind: 'specops' as const, x: 6.0, y: -6.0, z: 31.0, yaw: Math.PI },
  ],
  container3Fanatics: [
    { kind: 'specops' as const, x: -2.8, y: -6.0, z: 36.2, yaw: Math.PI },
    { kind: 'rifleman' as const, x: 2.8, y: -6.0, z: 36.2, yaw: Math.PI },
    { kind: 'breacher' as const, x: 0.0, y: -6.0, z: 35.5, yaw: Math.PI },
  ],
  container3Laptop: { x: 0, y: -5.05, z: 41.7 },
  emergencyExit: { x: 12.0, y: -6.0, z: 32.0 },

  // Zone D: Flooded Tilted Forward Escape Deck & Bow Helipad (z = +46..+100)
  escapeCrushEnemies: [
    { kind: 'rifleman' as const, x: -1.4, y: 0.0, z: 58.5, yaw: Math.PI },
    { kind: 'rusher' as const, x: 1.8, y: 0.0, z: 58.5, yaw: Math.PI },
  ],
  escapeBowGuards: [
    { kind: 'specops' as const, x: -9.5, y: 0.0, z: 66.0, yaw: Math.PI },
    { kind: 'rifleman' as const, x: -2.0, y: 2.0, z: 87.5, yaw: Math.PI },
  ],
  bowHelipad: { x: 0, y: 2.0, z: 92.0 },
};

// ---------------------------------------------------------------------------
// Real-time animated midnight tropical storm ocean shader (discards inside dry hull!)
//
// Three things this surface has to get right, and the previous version got all of them wrong:
//   1. Shading that matches the geometry. The old vertex stage summed 4 sines for the height but
//      then rebuilt the normal from a hand-typed constant per axis, dropping the wave direction,
//      so the swells never actually caught the light. Here every wave contributes its own analytic
//      gradient (dir * amp * k * cos(phase)) and the normal is the vector sum.
//   2. A horizon that dissolves. The old fog was 5x brighter than the scene's FogExp2 and denser,
//      so the sea ended in a bright band with a hard edge against the sky. It now uses the exact
//      storm numbers from renderer.setTheme('storm') (colour 0x0d1928 -> linear, density 0.0068).
//   3. Foam that follows the water. The old foam was a per-vertex flag (a 10 m grid) multiplied by
//      a per-pixel noise, which produced static white "cotton wool" patches. Now crest foam is
//      driven by wave steepness and is wind-streaked, and the hull gets an animated lapping collar.
// ---------------------------------------------------------------------------
function makeOcean(): {
  mesh: THREE.Mesh;
  uniforms: { uTime: { value: number }; uLightning: { value: number }; uMoonDir: { value: THREE.Vector3 } };
} {
  const uniforms = {
    uTime: { value: 0 },
    uLightning: { value: 0 },
    // Key light direction, overwritten every frame from the renderer (see lvl.update) so the
    // glitter path on the water matches the light that shades the hull.
    uMoonDir: { value: new THREE.Vector3(-0.58, 0.20, -0.79).normalize() },
  };
  // 1200 m sheet at 6 m cells. The storm fog swallows the horizon around 450 m, so the old
  // 1400 m plane just spent vertices on water that can never be seen.
  const geo = new THREE.PlaneGeometry(1200, 1200, 200, 200);
  geo.rotateX(-H);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWPos;
      varying vec2 vGrad;
      varying float vCrest;
      varying float vSteep;
      varying float vDist;

      /** One directional swell: height on the mesh plus its analytic surface gradient. */
      void swell(inout float h, inout vec2 grad, vec2 p, vec2 dir, float k, float amp, float spd, float t) {
        float ph = dot(p, dir) * k + t * spd;
        h += amp * sin(ph);
        grad += dir * (amp * k * cos(ph));
      }

      void main() {
        vec3 pos = position;
        vec2 p = pos.xz;
        float t = uTime;
        vDist = length(cameraPosition - (modelMatrix * vec4(pos, 1.0)).xyz);

        // Four swells carry the mesh (wavelengths 26-108 m). Everything shorter than that is
        // rebuilt per pixel in the fragment stage: a 6 m grid cannot represent a 2 m ripple.
        float h = 0.0;
        vec2 grad = vec2(0.0);
        swell(h, grad, p, normalize(vec2( 0.86,  0.51)), 0.058, 1.10, 1.05, t);
        swell(h, grad, p, normalize(vec2(-0.44,  0.90)), 0.101, 0.62, 1.55, t);
        swell(h, grad, p, normalize(vec2( 0.94, -0.34)), 0.168, 0.34, 2.25, t);
        swell(h, grad, p, normalize(vec2(-0.72, -0.69)), 0.281, 0.17, 3.05, t);

        // The hull sits in a slick: damp swell and slope near the plating so the ship reads as a
        // body in the water instead of a box parked on a rolling plane.
        float open = max(smoothstep(14.0, 34.0, abs(p.x)), smoothstep(92.0, 118.0, abs(p.y)));
        h *= 0.25 + 0.75 * open;
        grad *= 0.30 + 0.70 * open;

        pos.y += h;
        vCrest = clamp(0.5 + h * 0.224, 0.0, 1.0);
        vSteep = length(grad);
        vGrad = grad;

        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uLightning;
      uniform vec3 uMoonDir;
      varying vec3 vWPos;
      varying vec2 vGrad;
      varying float vCrest;
      varying float vSteep;
      varying float vDist;

      // Storm palette, kept identical to renderer.ts SKY_STORM_FRAG / setTheme('storm').
      const vec3 SKY_ZEN = vec3(0.015, 0.028, 0.055);
      const vec3 SKY_HOR = vec3(0.055, 0.095, 0.145);
      const vec3 FOG_COL = vec3(0.0040, 0.0097, 0.0212);
      const float FOG_DENS = 0.0068;
      const vec3 FLASH = vec3(0.55, 0.76, 1.20);

      float oHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float oNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(oHash(i), oHash(i + vec2(1, 0)), f.x), mix(oHash(i + vec2(0, 1)), oHash(i + vec2(1, 1)), f.x), f.y);
      }
      /** Analytic gradient of a directional wavelet: no texture fetch, no aliasing pattern. */
      vec2 wgrad(vec2 p, vec2 dir, float k, float amp, float spd, float t) {
        return dir * (amp * k * cos(dot(p, dir) * k + t * spd));
      }

      void main() {
        // Keep the below-waterline interior Cargo Hold (y = -6.0) completely dry until keel detonation!
        if (abs(vWPos.x) < 14.5 && vWPos.z > -97.5 && vWPos.z < 98.5) discard;

        vec3 V = normalize(cameraPosition - vWPos);
        vec2 p = vWPos.xz;
        // Horizon haze, lifted by the flash exactly like the sky shader does. Using a fixed value
        // here left a hard dark band across the horizon during a strike.
        vec3 HAZE = FOG_COL + FLASH * uLightning * 0.35;

        // Past ~250 m the surface is 98% fog, so the whole shading chain below would be wasted
        // work on the biggest band of the screen. This early out is the single biggest saving in
        // this shader.
        float fog = 1.0 - exp(-FOG_DENS * FOG_DENS * vDist * vDist);
        if (fog > 0.985) {
          gl_FragColor = vec4(HAZE, 1.0);
          return;
        }

        // Detail LOD: two tiers. The mid tier survives to ~165 m, the sub-metre ripple tier is
        // only worth computing close to the camera where it has more than one pixel per period.
        float near = 1.0 - smoothstep(30.0, 165.0, vDist);
        float near2 = 1.0 - smoothstep(12.0, 85.0, vDist);
        float near3 = 1.0 - smoothstep(4.0, 28.0, vDist);

        // --- surface normal: swell gradient + two wavelets + two tiers of chop ---
        vec2 g = vGrad;
        g += wgrad(p, normalize(vec2( 0.92,  0.39)), 0.62, 0.070, 2.60, uTime) * near;
        g += wgrad(p, normalize(vec2(-0.55,  0.84)), 1.35, 0.042, 3.40, uTime) * near;

        // Medium chop: 11 m / 4 m cells, slow drift. Kept small on purpose - a strong low-frequency
        // tilt field is what made the old surface read as frosted glass instead of water.
        vec2 nuv = p * 0.09 + vec2(uTime * 0.03, uTime * -0.025);
        float chopA = oNoise(nuv);
        float chopB = oNoise(nuv * 2.7 + 19.3);
        g += (vec2(chopA, chopB) - 0.5) * 0.22 * near;

        // Fine ripples: 1.2 m cells, domain-warped by the medium chop so the lattice never shows
        // up as a visible grid, and fast enough to break the specular into glints.
        vec2 fuv = p * 0.85 + vec2(chopA * 1.8, chopB * 1.8) + vec2(uTime * 0.10, uTime * 0.06);
        float fineA = oNoise(fuv);
        float fineB = oNoise(fuv + vec2(5.3, 9.1));
        g += (vec2(fineA, fineB) - 0.5) * 0.62 * near2;

        // Third tier: 35 cm capillary ripples. This is the "wet" scale - without it the specular
        // returns big smooth pools instead of the scattered glints water actually throws back.
        if (near3 > 0.003) {
          vec2 tuv = p * 2.9 + vec2(uTime * 0.34, uTime * 0.21);
          g += (vec2(oNoise(tuv), oNoise(tuv + 3.7)) - 0.5) * 0.80 * near3;
        }

        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        float ndv = max(dot(N, V), 0.0);

        // --- reflection: the actual storm sky, cloud layer included ---
        // A bare gradient reflects into a flat sheet at grazing angles - which is exactly what made
        // the previous version read as smeared metal. Ringing the real cloud pattern into the
        // reflection (same projection and drift as SKY_STORM_FRAG) is what makes the surface read.
        vec3 R = reflect(-V, N);
        float rh = max(R.y, 0.02);
        vec2 cuv = R.xz / (rh + 0.18);
        float cl1 = oNoise(cuv * 0.85 + uTime * vec2(0.032, 0.016));
        float cl2 = oNoise(cuv * 2.40 - uTime * vec2(0.045, 0.022) + 4.3);
        float cl = smoothstep(0.30, 0.78, cl1 * 0.72 + cl2 * 0.28);
        vec3 refl = mix(SKY_HOR, SKY_ZEN, smoothstep(0.0, 0.70, rh));
        vec3 cloudCol = mix(vec3(0.020, 0.033, 0.054), vec3(0.085, 0.125, 0.180), smoothstep(0.30, 0.85, cl1));
        refl = mix(refl, cloudCol, cl * smoothstep(-0.04, 0.14, rh) * 0.90);
        refl = mix(refl, HAZE * 1.25, smoothstep(0.09, -0.04, rh));
        // Grazing water reflects the sky *at the horizon*, which in this storm is the dark haze
        // band. Without this the sea ends in a bright ribbon that does not match the sky above it.
        refl = mix(refl, HAZE, smoothstep(0.18, 0.0, rh));
        refl += FLASH * uLightning * 0.16 * smoothstep(0.55, 0.0, abs(rh));
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

        // --- water body: deep tone, teal upwelling and backlit crests ---
        float crest = vCrest;
        vec3 body = mix(vec3(0.0030, 0.0085, 0.0165), vec3(0.0062, 0.0170, 0.0250), crest * 0.85);
        vec3 L = uMoonDir;
        float sss = pow(max(dot(V, -L), 0.0), 3.0) * crest;
        body += vec3(0.014, 0.036, 0.038) * sss;
        // A strike is an area light: it has to reveal the crests, not wash the surface flat.
        body += FLASH * uLightning * 0.055 * (0.35 + 0.65 * crest);
        vec3 col = mix(body, refl, fres);

        // --- specular: soft moon band plus granular glitter ---
        // A single tight power lobe produced smooth mercury-like pools; the sparkle mask is what
        // turns it into the scattered glints a real choppy surface returns.
        vec3 Hv = normalize(L + V);
        float ndh = max(dot(N, Hv), 0.0);
        float spark = smoothstep(0.58, 0.93, oNoise(p * 2.3 + vec2(uTime * 0.42, uTime * 0.31)));
        float glint = pow(ndh, 520.0) * 1.7 + pow(ndh, 38.0) * 0.09;
        col += vec3(0.74, 0.87, 1.00) * glint * (0.22 + 1.35 * spark) * (1.0 + uLightning * 2.4);

        // --- foam ---
        // One continuous whitewater field, stretched along the wind and drifting aft. Foam, its
        // torn edges and the hull collar all read from it, so the patches stay coherent.
        vec2 wuv = vec2(p.x * 0.95, p.y * 0.42) + vec2(0.0, uTime * -0.38);
        float white = oNoise(wuv) * 0.60 + oNoise(wuv * 2.4 + 7.1) * 0.40;

        // Only breaking crests produce white water. The previous mask added noise to a base that
        // was already non-zero, which laid a permanent 25% milky film over the entire surface.
        // The crest field only *modulates the threshold*: if it drove the coverage directly, the
        // foam boundary inherited the 6 m vertex interpolation and every patch looked like smoke.
        float breakMask = smoothstep(0.52, 0.86, crest) * smoothstep(0.045, 0.120, vSteep);
        // Sparse and crisp: a storm covers ~5% of the surface with whitecaps, and a wide soft
        // transition here is what turns them into grey smears.
        float thresh = 0.70 - 0.36 * breakMask;
        float foam = smoothstep(thresh - 0.08, thresh + 0.12, white) * smoothstep(0.02, 0.18, breakMask);
        // Bubble breakup: crisp torn edges close in, soft speckle far out where it would alias.
        if (near2 > 0.003) {
          float grain = oNoise(p * 4.2 + vec2(uTime * 0.15, uTime * -0.52));
          foam *= mix(1.0, 0.35 + 1.15 * grain, near2 * 0.8);
        }

        // Hull collar: churning white water that boils against the plating and streams aft.
        float dHull = length(max(abs(p - vec2(0.0, 0.5)) - vec2(14.0, 98.5), 0.0));
        float spray = smoothstep(0.50, 0.92, oNoise(vec2(p.x * 2.1, p.y * 0.8) + vec2(0.0, uTime * 0.9)));
        // Patchy on purpose: a continuous band along the hull reads as a concrete ledge, not water.
        float collar = exp(-dHull * 0.55) * smoothstep(0.40, 0.92, white) * (0.45 + 1.05 * spray);
        collar *= 0.7 + 0.3 * sin(dHull * 2.6 - uTime * 3.2);
        foam = clamp(foam + collar * 0.9, 0.0, 1.0);

        vec3 foamCol = vec3(0.150, 0.175, 0.198) * (1.0 + uLightning * 2.6);
        foamCol += vec3(0.045, 0.058, 0.070) * pow(max(dot(N, Hv), 0.0), 8.0);
        col = mix(col, foamCol, foam * 0.92);

        // The hull shades and reflects its own deck lights onto the water beside it.
        col *= 1.0 - 0.42 * exp(-dHull * 0.85);
        col += vec3(0.060, 0.042, 0.022) * exp(-dHull * 0.085) * (0.7 + 0.3 * uLightning);

        // Broad flash response so a lightning strike lifts the whole surface, not just the glints.
        col += FLASH * uLightning * (0.012 + 0.032 * fres);

        // --- atmosphere: match the scene's FogExp2 instead of overriding it ---
        col = mix(col, HAZE, clamp(fog, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -3.4;
  mesh.frustumCulled = false;
  mesh.userData.noAo = true;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// 3D Wind-Slanted Tropical Storm Rain Curtain (100% GPU Vertex Shader, 16m radius around camera)
// ---------------------------------------------------------------------------
function makeRain(): { lines: THREE.LineSegments; update: (t: number, cx: number, cy: number, cz: number) => void } {
  const N = 2200;
  const spanX = 32, spanY = 20, spanZ = 32;
  const pos = new Float32Array(N * 6);
  const drop = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const ox = Math.random() * spanX;
    const oy = Math.random() * spanY;
    const oz = Math.random() * spanZ;
    const spd = 22 + Math.random() * 10;
    const k = i * 6;
    pos[k] = ox; pos[k + 1] = oy; pos[k + 2] = oz;
    pos[k + 3] = ox; pos[k + 4] = oy; pos[k + 5] = oz;
    const d = i * 4;
    drop[d] = spd; drop[d + 1] = 0;
    drop[d + 2] = spd; drop[d + 3] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aDrop', new THREE.BufferAttribute(drop, 2));
  const uniforms = {
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec2 aDrop;
      uniform float uTime;
      uniform vec3 uCamPos;
      varying float vFade;
      void main() {
        const vec3 span = vec3(32.0, 20.0, 32.0);
        vec3 vel = vec3(5.5, -aDrop.x, -3.2);
        vec3 local = mod(position + vel * uTime - uCamPos, span) - span * 0.5;
        local.y += 3.8;
        vec3 wp = uCamPos + local + aDrop.y * vec3(-0.176, 0.72, 0.1024);
        float dist = length(local);
        vFade = (1.0 - smoothstep(9.0, 16.5, dist)) * (0.65 + 0.35 * aDrop.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying float vFade;
      void main() {
        gl_FragColor = vec4(0.62, 0.75, 0.88, 0.34 * vFade);
      }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  const update = (t: number, cx: number, cy: number, cz: number) => {
    if (!lines.visible) return;
    uniforms.uTime.value = t;
    uniforms.uCamPos.value.set(cx, cy, cz);
  };
  return { lines, update };
}

// ---------------------------------------------------------------------------
// Z-20J "HaiDiao-1" Open-Cabin Naval Assault Helicopter Rig (Authentic PLA Marine)
// ---------------------------------------------------------------------------
function makeHelicopterRig() {
  const root = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x202730, roughness: 0.56, metalness: 0.42 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x151a20, roughness: 0.44, metalness: 0.68 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x242a32, roughness: 0.72, metalness: 0.35 });
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.78, metalness: 0.25 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0x262c28, roughness: 0.9, metalness: 0.04 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x122230, roughness: 0.08, metalness: 0.85, transparent: true, opacity: 0.48, side: THREE.DoubleSide,
  });

  const mfdCanvas = document.createElement('canvas');
  mfdCanvas.width = 256;
  mfdCanvas.height = 128;
  const mg = mfdCanvas.getContext('2d')!;
  mg.fillStyle = '#06120c';
  mg.fillRect(0, 0, 256, 128);
  mg.strokeStyle = '#1e8a52';
  mg.lineWidth = 2;
  mg.strokeRect(4, 4, 118, 120);
  mg.strokeRect(134, 4, 118, 120);
  mg.strokeStyle = '#2ee880';
  mg.beginPath(); mg.moveTo(22, 64); mg.lineTo(104, 64); mg.stroke();
  for (let y = 28; y <= 100; y += 18) {
    mg.beginPath(); mg.moveTo(46, y); mg.lineTo(80, y); mg.stroke();
  }
  mg.beginPath(); mg.arc(193, 64, 44, 0, Math.PI * 2); mg.stroke();
  mg.beginPath(); mg.arc(193, 64, 24, 0, Math.PI * 2); mg.stroke();
  mg.beginPath(); mg.moveTo(193, 64); mg.lineTo(224, 34); mg.stroke();
  mg.fillStyle = '#ff6b35';
  mg.fillRect(189, 44, 6, 6);
  const mfdTex = new THREE.CanvasTexture(mfdCanvas);
  mfdTex.colorSpace = THREE.SRGBColorSpace;
  const mfdMat = new THREE.MeshBasicMaterial({ map: mfdTex });
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xb82418 });
  const navGrnMat = new THREE.MeshBasicMaterial({ color: 0x20a858 });

  const addBox = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    root.add(m);
    return m;
  };
  const addCyl = (mat: THREE.Material, rTop: number, rBot: number, len: number, segs: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, segs), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    root.add(m);
    return m;
  };

  addBox(hullMat, 2.52, 0.26, 4.4, 0, -0.18, 0.15);
  addBox(deckMat, 2.46, 0.06, 3.85, 0, -0.02, -0.05);
  for (let i = -3; i <= 3; i++) addBox(darkMetal, 0.07, 0.015, 3.45, i * 0.34, 0.015, -0.05);
  for (const sx of [-1, 1]) {
    addBox(darkMetal, 0.18, 0.05, 2.4, sx * 1.32, -0.06, 0.05);
    addBox(hullMat, 0.16, 1.88, 0.26, sx * 1.24, 0.88, 1.46);
    addBox(hullMat, 0.16, 1.88, 0.28, sx * 1.24, 0.88, -1.38);
    addCyl(darkMetal, 0.022, 0.022, 1.1, 8, sx * 1.33, 0.92, 1.36);
    addCyl(darkMetal, 0.022, 0.022, 1.1, 8, sx * 1.33, 0.92, -1.28);
    addBox(hullMat, 0.1, 1.66, 2.25, sx * 1.34, 0.86, -2.55);
    addBox(glassMat, 0.12, 0.56, 0.92, sx * 1.35, 1.12, -2.35);
    addBox(darkMetal, 0.06, 0.06, 2.6, sx * 1.3, 1.72, -1.15);
    addBox(darkMetal, 0.06, 0.06, 2.6, sx * 1.3, 0.04, -1.15);
  }
  addBox(interiorMat, 2.44, 1.84, 0.14, 0, 0.88, -1.86);
  for (let i = -3; i <= 3; i++) addBox(darkMetal, 0.06, 1.76, 0.06, i * 0.34, 0.88, -1.78);
  addBox(canvasMat, 0.52, 0.09, 2.55, -0.92, 0.44, -0.15);
  addBox(canvasMat, 0.08, 0.65, 2.55, -1.16, 0.82, -0.15);
  for (const bz of [-1.25, -0.15, 0.95]) addCyl(darkMetal, 0.02, 0.02, 0.44, 6, -0.72, 0.22, bz);
  addBox(canvasMat, 1.65, 0.09, 0.48, 0.05, 0.44, -1.52);

  addBox(hullMat, 2.56, 0.16, 4.1, 0, 1.86, -0.05);
  for (const rz of [-1.45, -0.65, 0.15, 0.95, 1.55]) addBox(darkMetal, 2.38, 0.08, 0.09, 0, 1.76, rz);
  addCyl(darkMetal, 0.025, 0.025, 3.2, 8, -0.45, 1.72, -0.1, H);
  addCyl(darkMetal, 0.025, 0.025, 3.2, 8, 0.45, 1.72, -0.1, H);
  addBox(warnMat, 0.24, 0.04, 0.12, 0, 1.74, 0.05);

  addBox(interiorMat, 0.65, 1.82, 0.14, -0.88, 0.88, 1.56);
  addBox(interiorMat, 0.65, 1.82, 0.14, 0.88, 0.88, 1.56);
  addBox(interiorMat, 2.4, 0.44, 0.18, 0, 1.58, 1.56);
  for (const sx of [-0.56, 0.56]) {
    addBox(canvasMat, 0.48, 0.78, 0.12, sx, 0.76, 1.86);
    addBox(canvasMat, 0.48, 0.12, 0.48, sx, 0.36, 2.1);
  }
  addBox(darkMetal, 1.95, 0.58, 0.68, 0, 0.52, 2.65);
  addBox(mfdMat, 0.46, 0.24, 0.02, -0.52, 0.62, 2.3);
  addBox(mfdMat, 0.46, 0.24, 0.02, 0.52, 0.62, 2.3);
  addBox(darkMetal, 0.34, 0.22, 0.03, 0, 0.62, 2.3);
  addBox(hullMat, 2.05, 0.72, 1.55, 0, 0.18, 3.25, 0.18);
  addBox(hullMat, 1.55, 0.52, 0.95, 0, 0.05, 4.15, 0.28);
  addBox(glassMat, 1.85, 1.15, 0.05, 0, 1.24, 2.68, -0.68);
  addBox(darkMetal, 0.09, 1.22, 0.09, 0, 1.24, 2.68, -0.68);
  addBox(darkMetal, 0.11, 1.22, 0.11, -0.94, 1.24, 2.64, -0.68, -0.18);
  addBox(darkMetal, 0.11, 1.22, 0.11, 0.94, 1.24, 2.64, -0.68, 0.18);
  addCyl(darkMetal, 0.22, 0.22, 0.24, 14, 0, -0.26, 3.85);
  const flirBall = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 10), darkMetal);
  flirBall.position.set(0, -0.42, 3.85);
  root.add(flirBall);

  addBox(hullMat, 1.65, 0.66, 3.6, 0, 2.24, -0.35);
  for (const sx of [-1, 1]) {
    addBox(hullMat, 0.58, 0.56, 2.85, sx * 0.86, 2.18, -0.45);
    addCyl(darkMetal, 0.24, 0.26, 0.55, 12, sx * 0.86, 2.18, 1.1, H);
    addCyl(darkMetal, 0.22, 0.28, 0.72, 12, sx * 0.96, 2.18, -2.05, H, sx * 0.34);
    addBox(darkMetal, 0.14, 0.85, 0.22, sx * 1.38, -0.38, 1.12, 0, 0, sx * 0.42);
    addCyl(darkMetal, 0.34, 0.34, 0.22, 16, sx * 1.56, -0.78, 1.12, 0, 0, H);
    addBox(sx < 0 ? warnMat : navGrnMat, 0.12, 0.1, 0.18, sx * 1.34, 1.72, 1.55);
  }
  addCyl(darkMetal, 0.18, 0.24, 0.56, 12, 0, 2.74, 0.1);
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.04, 0.1);
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.18, 14), darkMetal));
  const disc = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 6.4, 36),
    new THREE.MeshBasicMaterial({ color: 0x182028, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.rotation.x = -H;
  rotor.add(disc);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 6.2), darkMetal);
    blade.rotation.y = a;
    blade.position.set(Math.sin(a) * 3.15, 0.03, Math.cos(a) * 3.15);
    rotor.add(blade);
  }
  root.add(rotor);

  addBox(hullMat, 1.38, 1.12, 2.6, 0, 0.72, -3.2);
  addBox(hullMat, 0.88, 0.76, 3.4, 0, 0.92, -5.95, 0.08);
  addBox(hullMat, 0.54, 0.56, 3.2, 0, 1.18, -8.85, 0.06);
  addBox(hullMat, 0.24, 2.35, 1.25, 0, 2.15, -10.35, -0.32);
  addBox(hullMat, 3.4, 0.12, 0.78, 0, 1.05, -9.95);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.28, 2.75, -10.55);
  tailRotor.rotation.z = -0.25;
  for (let i = 0; i < 4; i++) {
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 1.55), darkMetal);
    tb.rotation.x = (i / 4) * Math.PI * 2;
    tailRotor.add(tb);
  }
  root.add(tailRotor);

  addBox(darkMetal, 0.65, 0.08, 0.1, 1.48, 1.72, 0.28);
  addCyl(darkMetal, 0.04, 0.04, 0.35, 8, 1.74, 1.58, 0.28);
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.042, 10.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x453e34, roughness: 0.96 }),
  );
  rope.position.set(1.74, -3.72, 0.28);
  root.add(rope);

  const cabinLight = new THREE.PointLight(0xff281c, 6.2, 7.5, 1.8);
  cabinLight.position.set(0, 1.52, 0.0);
  root.add(cabinLight);

  const spot = new THREE.SpotLight(0xe4f2ff, 46, 85, Math.PI * 0.26, 0.45, 1.1);
  spot.position.set(0, -0.25, 3.4);
  spot.target.position.set(0, -10, 15);
  root.add(spot, spot.target);

  const coneGeo = new THREE.ConeGeometry(4.2, 16.5, 18, 1, true);
  coneGeo.translate(0, -8.25, 0);
  const cone = new THREE.Mesh(
    coneGeo,
    new THREE.MeshBasicMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.065, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  cone.position.set(0, -0.25, 3.4);
  cone.rotation.x = -0.58;
  root.add(cone);

  return { root, rotor, tailRotor, rope, spot };
}

// ---------------------------------------------------------------------------
// Distant Da Shun Navy Destroyer Silhouette + Sweeping Searchlight
// ---------------------------------------------------------------------------
function makeDestroyer(): { group: THREE.Group; beam: THREE.Mesh } {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e2834, roughness: 0.72, metalness: 0.35 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(11, 6.5, 86), hullMat);
  hull.position.set(0, 2.2, 0);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, 9.5, 22), hullMat);
  bridge.position.set(0, 9.5, -8);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.75, 14, 6), hullMat);
  mast.position.set(0, 19.5, -10);
  const redNav = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2820 }));
  redNav.position.set(-4.5, 14.5, -12);
  const grnNav = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 6), new THREE.MeshBasicMaterial({ color: 0x24ff66 }));
  grnNav.position.set(4.5, 14.5, -12);
  const bGeo = new THREE.ConeGeometry(16, 155, 18, 1, true);
  bGeo.translate(0, -77.5, 0);
  bGeo.rotateX(-H);
  const beam = new THREE.Mesh(
    bGeo,
    new THREE.MeshBasicMaterial({ color: 0xcce4ff, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  beam.position.set(4.5, 13.5, -14);
  g.add(hull, bridge, mast, redNav, grnNav, beam);
  g.position.set(-148, -1.8, 42);
  g.rotation.y = 0.28;
  return { group: g, beam };
}

// ---------------------------------------------------------------------------
// Build the Complete 4-Zone Modular M/V Taishan ("泰山号") Container Ship
// Directly driven by `src/world/shipLayout.json` & `src/world/shipCatalog.ts`
// ---------------------------------------------------------------------------
export function buildHighSeas(world: any, mats: Materials, _sunAz: number): LevelData & { ship: ShipDynamic } {
  const b = new LevelBuilder(world, mats);
  const cm = makeCampMats();

  // Marine signage atlas
  const shipNameUv = cm.atlas.add(768, 160, (g, w, h) => {
    g.fillStyle = '#182432';
    g.fillRect(0, 0, w, h);
    textLines(g, w, h, [
      { text: '大顺远洋 · 泰山号', size: 62, color: '#f2eee0', weight: 800, font: CJK },
      { text: 'M/V TAISHAN · IMO 9842107', size: 28, color: '#9ab4cc', weight: 700, font: FONT },
    ], 1.15);
  });
  const c3Uv = cm.atlas.add(512, 192, (g, w, h) => {
    g.fillStyle = '#32422d';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e0b238';
    g.lineWidth = 10;
    g.strokeRect(8, 8, w - 16, h - 16);
    textLines(g, w, h, [
      { text: 'NO.03 特种货柜', size: 54, color: '#f4cc4e', weight: 800, font: CJK },
      { text: 'RESTRICTED · NW-INSTITUTE', size: 24, color: '#e2ded0', weight: 700, font: FONT },
    ], 1.15);
  });
  const messUv = cm.atlas.add(384, 144, (g, w, h) => {
    g.fillStyle = '#1a2c3d';
    g.fillRect(0, 0, w, h);
    textLines(g, w, h, [
      { text: '2F 船员餐厅', size: 50, color: '#eef0e6', weight: 800, font: CJK },
      { text: 'CREW MESS HALL', size: 22, color: '#a8c2da', weight: 700, font: FONT },
    ], 1.1);
  });
  const exitUv = cm.atlas.add(512, 144, (g, w, h) => {
    g.fillStyle = '#0e4c2c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3ef28c';
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    textLines(g, w, h, [
      { text: '紧急逃生梯 ▲', size: 50, color: '#6effad', weight: 800, font: CJK },
      { text: 'EMERGENCY EXIT · BOW DECK', size: 22, color: '#d8ffea', weight: 700, font: FONT },
    ], 1.1);
  });
  const shaftUv = cm.atlas.add(480, 144, (g, w, h) => {
    g.fillStyle = '#5c1f16';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f0ba38';
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    textLines(g, w, h, [
      { text: '3号主货舱气密闸门 ▶', size: 42, color: '#f8eed8', weight: 800, font: CJK },
      { text: 'SECTOR C · CARGO HOLD AIRLOCK', size: 20, color: '#f5cb54', weight: 700, font: FONT },
    ], 1.1);
  });
  cm.atlas.finish();

  const lvl: LevelData & { ship: ShipDynamic } = {
    id: 'highseas',
    group: new THREE.Group(),
    map: {
      half: 102,
      ground: '#0a1522',
      road: '#1f2c3a',
      roads: [
        [0, -68, 30, 56], // Zone A
        [0, -29, 26, 24], // Zone B
        [0, 15, 24, 65],  // Zone C
        [0, 73, 28, 50],  // Zone D
      ],
    },
    targets: [],
    menuCamera(t, cam) {
      const a = Math.sin(t * 0.14) * 0.4;
      cam.position.set(Math.sin(a) * 34 - 16, 15 + Math.sin(t * 0.25) * 1.4, -84 + Math.cos(a) * 12);
      cam.lookAt(0, 5.0, -34);
    },
    playerSpawn: { x: 0, z: -89.5, yaw: Math.PI },
    spawnPoints: [],
    barrels: [
      { x: -3.5, y: -6.0, z: 7.5 },
      { x: 4.4, y: -6.0, z: 16.5 },
      { x: -4.2, y: -6.0, z: 26.5 },
      { x: 3.8, y: -6.0, z: 33.0 },
    ],
    supplies: [
      { x: SHIP.holdHeavyPickup.x, z: SHIP.holdHeavyPickup.z },
    ],
    fires: [],
    plumes: [],
    bound: 99,
    ship: null as unknown as ShipDynamic,
  };

  world.groundSurface = () => 'metal';
  world.baseGroundY = -7.0;
  const extras: THREE.Object3D[] = [];

  // =========================================================================
  // 0. MASSIVE 196m SHIP HULL, FREEBOARD & POINTED BOW (z = -97..+105)
  // =========================================================================
  b.region = 'hull';
  // Exterior hull plates enclosing Zone A/B/C/D down below waterline (-8.2m)
  b.deco('metal', 0, -8.2, 0, 30.6, 2.6, 194, { color: 0x5c221c }); // anti-fouling rust-red keel
  for (const sx of [-1, 1]) {
    b.deco('metal', sx * 14.9, -5.8, 0, 0.6, 5.9, 194, { color: 0x202b38 }); // outer steel side shell
  }
  b.deco('metal', 0, -5.8, -96.8, 30.2, 5.9, 0.8, { color: 0x202b38 }); // transom stern
  // Pointed triangular bow prow (z = +97..+110)
  b.deco('metal', 0, -5.6, 100.5, 27.0, 7.8, 8, { color: 0x202b38, taper: [0.65, 0.85] });
  b.deco('metal', 0, -5.2, 107.5, 16.0, 7.5, 7, { color: 0x1e2835, taper: [0.16, 0.55] });

  // =========================================================================
  // 1. IMPORT MODULAR 4-ZONE LEVEL STRICTLY FROM `shipLayout.json`
  // =========================================================================
  const virtualLights: VirtualLight[] = [];
  importShipLayout(b, cm, shipLayoutData as unknown as ShipLayoutJSON, extras, { virtualLights });

  // Superstructure Hero Maritime Landmarks (Nameplate, Twin Exhaust Funnels, Bridge Wings, Radar Mast & Signage)
  b.region = 'ne';
  signBoard(b, cm, 0, -42.3, Math.PI, 10.5, 2.2, 7.8, shipNameUv, { posts: 0 });
  signBoard(b, cm, 2.3, -32.0, H, 1.65, 0.62, 6.0, messUv, { posts: 0 });
  signBoard(b, cm, 0, -18.52, Math.PI, 2.4, 0.62, 3.08, shaftUv, { posts: 0 });
  // Port & Starboard cantilevered 3F Navigation Bridge Wings overhanging the hull (classic ocean vessel silhouette!)
  b.shadows = false;
  for (const sx of [-1, 1]) {
    b.box('plaster', sx * 15.8, 7.0, -21.5, 4.0, 0.35, 4.2, { color: 0xbcc4cc, collide: false });
    b.box('darkmetal', sx * 15.8, 7.35, -23.5, 4.0, 1.05, 0.16, { color: 0x2a3540, collide: false });
    b.box('darkmetal', sx * 15.8, 7.35, -19.5, 4.0, 1.05, 0.16, { color: 0x2a3540, collide: false });
    b.box('darkmetal', sx * 17.7, 7.35, -21.5, 0.16, 1.05, 4.2, { color: 0x2a3540, collide: false });
    // Port RED & Starboard GREEN maritime navigation side-lights on bridge wings!
    const navCol = sx < 0 ? 0xff2820 : 0x22ff66;
    const navLight = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), new THREE.MeshBasicMaterial({ color: navCol }));
    navLight.position.set(sx * 17.85, 8.6, -21.5);
    extras.push(navLight);
  }
  b.shadows = true;
  // Massive Da Shun Ocean red-and-black twin exhaust funnel casing & radar mast
  b.box('metal', -6.8, 10.8, -31.5, 3.6, 5.2, 4.8, { color: 0x942d22, surface: 'metal' });
  b.box('darkmetal', -6.8, 16.0, -31.5, 3.7, 1.2, 4.9, { color: 0x191e24, collide: false });
  b.box('metal', 6.8, 10.8, -32.2, 2.4, 3.2, 3.2, { color: 0x2b3642, surface: 'metal' }); // auxiliary radar dome house
  b.cyl('darkmetal', 0, 10.8, -24.5, 0.28, 10.2, 0xc8ccd0, { segs: 8 });
  b.deco('darkmetal', 0, 16.5, -24.5, 6.8, 0.16, 0.18, { color: 0xc8ccd0 });
  b.deco('darkmetal', 0, 19.8, -24.5, 4.0, 0.24, 0.28, { color: 0xdadce0 });
  const mastBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2c20 }));
  mastBeacon.position.set(0, 21.1, -24.5);
  extras.push(mastBeacon);

  // Bridge collectible intel tablet placeholder (actual glowing collectible managed by CollectibleManager)
  const intelTablet = new THREE.Group();
  intelTablet.visible = false;

  // Zone C Objective Container #3 & Emergency Exit Signs
  b.region = 'nw';
  signBoard(b, cm, 0, 37.3, Math.PI, 2.3, 0.85, -3.55, c3Uv, { posts: 0 });
  signBoard(b, cm, 12.0, 30.2, Math.PI, 2.4, 0.74, -2.95, exitUv, { posts: 0 });

  // Stage 2/3 Compound Industrial Finishing Pass (non-shadow-casting details for rock-solid frametimes):
  b.shadows = false;
  // 1. Overhead galvanized HVAC ventilation ducts & ceiling cable trays (Zone B 1F/2F & Zone C Hold — clear of stairwells!)
  b.region = 'ne';
  b.deco('metal', -8.0, 3.05, -30.0, 0.56, 0.36, 22.0, { color: 0x4c5864 });
  b.deco('darkmetal', -7.45, 3.18, -30.0, 0.24, 0.08, 22.0, { color: 0x262f38 });
  // Starboard 1F duct stops cleanly at z=-26 so it NEVER cuts across the open 1F->2F stairwell at z=-25..-19!
  b.deco('metal', 8.0, 3.05, -33.0, 0.56, 0.36, 14.0, { color: 0x4c5864 });
  b.deco('darkmetal', 7.45, 3.18, -33.0, 0.24, 0.08, 14.0, { color: 0x262f38 });
  b.deco('metal', 0, 3.05, -37.2, 16.5, 0.36, 0.56, { color: 0x4c5864 });
  b.deco('metal', 0, 3.05, -22.2, 11.5, 0.36, 0.56, { color: 0x4c5864 });
  b.deco('metal', 6.5, 6.65, -30.0, 0.58, 0.36, 22.0, { color: 0x4a5662 });
  // Zone C Cargo Hold massive ceiling steel I-beam trusses & ventilation trunking
  b.region = 'nw';
  for (let z = -14; z <= 42; z += 8) {
    b.deco('darkmetal', 0, 6.45, z, 27.2, 0.52, 0.42, { color: 0x1e2832 });
  }
  for (const dx of [-10.5, 10.5]) {
    b.deco('metal', dx, 6.15, 14.0, 0.72, 0.52, 60.0, { color: 0x3b4855 });
  }

  // 2. Poly Haven CC0 Wall-Mounted Fire Extinguisher Safety Stations (bolted flush to real bulkheads!)
  b.region = 'ne';
  for (const [fx, fy, fz, frot] of [
    [-5.55, 0.0, -34.28, Math.PI],
    [5.55, 0.0, -34.28, Math.PI],
    [13.4, 0.0, -24.0, -H],
    [2.45, 3.6, -29.8, H],
    [-13.4, -6.0, 4.0, H],
    [13.4, -6.0, 26.0, -H],
  ] as [number, number, number, number][]) {
    b.model('ph_extinguisher', fx, fy, fz, frot, { scale: 1.0 });
  }

  // 3. Soft Radial-Feathered Rainwater Specular Deck Puddles across Storm-Swept Zone A & Zone D Decks
  const puddleCanvas = document.createElement('canvas');
  puddleCanvas.width = puddleCanvas.height = 128;
  const pctx = puddleCanvas.getContext('2d')!;
  const grad = pctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.52, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, 128, 128);
  const puddleAlpha = new THREE.CanvasTexture(puddleCanvas);
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x121e2b,
    roughness: 0.05,
    metalness: 0.85,
    alphaMap: puddleAlpha,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  for (const [px, py, pz, rx, rz] of [
    [-1.2, 0.02, -82.0, 3.6, 2.5],
    [2.6, 0.02, -62.0, 3.1, 4.0],
    [-10.4, 0.02, -65.0, 2.2, 3.2],
    [-0.5, 0.02, -47.0, 3.8, 2.8],
    [0.8, 0.02, 53.0, 3.4, 2.9],
    [-9.5, 0.02, 62.5, 2.6, 3.8],
    [0.0, 0.02, 72.0, 3.8, 3.0],
  ] as [number, number, number, number, number][]) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2), puddleMat);
    pm.rotation.x = -H;
    pm.position.set(px, py, pz);
    extras.push(pm);
  }

  lvl.group = b.finish();
  // Merge all static extras (decals, puddles, light lenses, beacons, volumetric cones) by shared material -> collapses 180+ draw calls into ~9!
  for (const e of mergeExtrasByMaterial(extras)) lvl.group.add(e);

  // =========================================================================
  // 2. COLLECTIBLES & PHYSICAL SCENE INTERACTABLES (Doors, Breakers, Valves, Crates)
  // =========================================================================
  const collectibles = new CollectibleManager(HIGHSEAS_COLLECTIBLES);
  lvl.group.add(collectibles.group);
  // Hide legacy dummy intelTablet when the unified collectible handles Bridge Intel!
  intelTablet.visible = false;

  const interactables = new InteractableSystem();
  // 4 Interactive Hinged Armored Cabin Doors in Zone B 1F Crew Dormitories (CQB room clearing!)
  interactables.addDoor(world, 'door_b1_w1', '1F 左舷2号船员宿舍门', -10.0, 0.0, -28.0, H, 1.94, 2.32, 1, false);
  interactables.addDoor(world, 'door_b1_w2', '1F 左舷3号船员宿舍门', -10.0, 0.0, -20.0, H, 1.94, 2.32, 1, true);
  interactables.addDoor(world, 'door_b1_e1', '1F 右舷2号船员宿舍门', 10.0, 0.0, -28.0, H, 1.94, 2.32, -1, false);
  interactables.addDoor(world, 'door_b1_e2', '1F 右舷3号船员宿舍门', 10.0, 0.0, -20.0, H, 1.94, 2.32, -1, false);

  // 2 Interactive Industrial Electrical Circuit Breakers (bolted FLUSH onto real bulkhead walls!)
  const zoneBLights = virtualLights.filter((l) => l.kind === 'main' && l.pos.z >= -42 && l.pos.z <= -18 && l.pos.y < 3.5);
  const zoneCLights = virtualLights.filter((l) => l.kind === 'main' && l.pos.z > -18 && l.pos.z <= 46);
  interactables.addBreaker('brk_b1_corr', '1F 生活区照明配电箱', -3.6, 1.45, -34.24, Math.PI, zoneBLights, true);
  interactables.addBreaker('brk_c_hold', '3号主货舱顶灯配电箱', -13.65, 1.45, -15.5, H, zoneCLights, true);

  // 2 Interactive High-Pressure Fire-Main Steam Valves (create tactical steam concealment clouds!)
  interactables.addValve('valve_a_deck', '右舷高压消防蒸汽阀', 5.2, 1.35, -55.0, -H);
  interactables.addValve('valve_c_hold', '底舱主管道消防蒸汽阀', -13.55, -4.65, 18.0, H);

  // 2 Interactive Hinged Tactical Supply Crates (refill ammo + stun grenades on [F])
  interactables.addSupplyCrate(world, 'crate_a_stern', '特种战术弹药补给箱', 3.4, 0.0, -86.5, -0.2);
  interactables.addSupplyCrate(world, 'crate_c_hold', '底舱重火力弹药补给箱', -10.5, -6.0, 2.0, H);
  lvl.group.add(interactables.group);

  // =========================================================================
  // DYNAMIC ENTITIES: OCEAN, RAIN, Z-20J HELICOPTER, DOORS, PIPES, 3 SLIDERS
  // =========================================================================
  const ocean = makeOcean();
  lvl.group.add(ocean.mesh);

  const rain = makeRain();
  lvl.group.add(rain.lines);

  const heliRig = makeHelicopterRig();
  heliRig.root.position.set(0, 8.4, -89.8);
  lvl.group.add(heliRig.root);

  const destroyer = makeDestroyer();
  lvl.group.add(destroyer.group);

  // Interactive Armored Bulkhead Airlock Doors aligned to `shipLayout.json` DoorFrames:
  //   1. Zone A -> Zone B Watertight Airlock (0, 0, -42)
  //   2. Zone B -> Zone C Cargo Hold Airlock (0, 0, -18)
  //   3. Zone C -> Zone D Bow Emergency Airlock (12, 0, 46)
  //   4. 2F Mess Main Door (2, 3.6, -32) & Mess Side Door (-4, 3.6, -26)
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x32404d, roughness: 0.44, metalness: 0.72 });
  const doorTrimMat = new THREE.MeshStandardMaterial({ color: 0xc2922a, roughness: 0.5, metalness: 0.35 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0xc83a28, roughness: 0.38, metalness: 0.65 });
  const portGlassMat = new THREE.MeshStandardMaterial({ color: 0x102230, emissive: 0x16445e, emissiveIntensity: 0.7, roughness: 0.12, metalness: 0.25 });

  const makeAirlockDoor = (x: number, y: number, z: number, statusHex: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x - 1.2, y, z);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.5, 0.18), doorMat);
    slab.position.set(1.2, 1.25, 0);
    // Steel reinforcement ribs & bottom/top hazard accent strips
    const topStrip = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.11, 0.21), doorTrimMat);
    topStrip.position.set(1.2, 2.34, 0);
    const botStrip = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.11, 0.21), doorTrimMat);
    botStrip.position.set(1.2, 0.16, 0);
    // Recessed circular marine porthole window
    const porthole = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.22, 14), portGlassMat);
    porthole.rotation.x = H;
    porthole.position.set(1.2, 1.78, 0);
    // 3D naval locking handwheel on both front & back faces
    const wheelGeo = new THREE.TorusGeometry(0.24, 0.032, 8, 16);
    const spokeGeo = new THREE.BoxGeometry(0.46, 0.036, 0.036);
    for (const sideZ of [-0.14, 0.14]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(1.62, 1.15, sideZ);
      const sp1 = new THREE.Mesh(spokeGeo, wheelMat);
      sp1.position.set(1.62, 1.15, sideZ);
      const sp2 = new THREE.Mesh(spokeGeo, wheelMat);
      sp2.rotation.z = H;
      sp2.position.set(1.62, 1.15, sideZ);
      pivot.add(wheel, sp1, sp2);
    }
    // Glowing airlock status indicator beacon
    const statusMat = new THREE.MeshBasicMaterial({ color: statusHex });
    for (const sideZ of [-0.12, 0.12]) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.04), statusMat);
      led.position.set(0.42, 1.82, sideZ);
      pivot.add(led);
    }
    pivot.add(slab, topStrip, botStrip, porthole);
    lvl.group.add(pivot);
    const col = world.addBox(x, y + 1.25, z, 1.2, 1.25, 0.22, 0, 'metal', true);
    return { pivot, col };
  };

  const wt = makeAirlockDoor(0, 0.0, -42.0, 0xffb838);
  const wtPivot = wt.pivot;
  const wtCol = wt.col;

  const holdAir = makeAirlockDoor(0, 0.0, -18.0, 0x38e4ff);
  const holdAirlockDoor = holdAir.pivot;
  const holdAirlockCollider = holdAir.col;

  const bowAir = makeAirlockDoor(12.0, 0.0, 46.0, 0x32ff88);
  const bowAirlockDoor = bowAir.pivot;
  const bowAirlockCollider = bowAir.col;

  const messMainPivot = new THREE.Group();
  messMainPivot.position.set(2.0, 3.6, -33.0);
  const messMainMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.35, 2.0), doorMat);
  messMainMesh.position.set(0, 1.18, 1.0);
  messMainPivot.add(messMainMesh);
  lvl.group.add(messMainPivot);
  const messMainCol = world.addBox(2.0, 4.78, -32.0, 0.16, 1.18, 1.0, 0, 'metal', true);

  const messSidePivot = new THREE.Group();
  messSidePivot.position.set(-5.0, 3.6, -26.0);
  const messSideMesh = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.35, 0.14), doorMat);
  messSideMesh.position.set(1.0, 1.18, 0);
  messSidePivot.add(messSideMesh);
  lvl.group.add(messSidePivot);
  const messSideCol = world.addBox(-4.0, 4.78, -26.0, 1.0, 1.18, 0.16, 0, 'metal', true);

  // Burst High-Pressure Seawater Pipes inside Escape Hatch & Forward Corridor
  const waterJets: THREE.Mesh[] = [];
  const jetMat = new THREE.MeshBasicMaterial({
    color: 0xaad8f4, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  for (const [jx, jy, jz, rotZ] of [
    [11.4, 1.8, 49.5, 0.65],
    [8.2, 2.1, 52.8, -0.58],
    [-12.2, 1.9, 60.5, -0.72],
  ] as [number, number, number, number][]) {
    const jGeo = new THREE.ConeGeometry(0.65, 4.2, 10, 1, true);
    jGeo.translate(0, -2.1, 0);
    const jet = new THREE.Mesh(jGeo, jetMat);
    jet.position.set(jx, jy, jz);
    jet.rotation.z = rotZ;
    jet.visible = false;
    lvl.group.add(jet);
    waterJets.push(jet);
  }

  // Rising Seawater inside Cargo Hold (Stage 4 Sinking Escape)
  const floodWater = new THREE.Mesh(
    new THREE.PlaneGeometry(27.6, 63.6),
    new THREE.MeshStandardMaterial({ color: 0x0a2234, roughness: 0.16, metalness: 0.28, transparent: true, opacity: 0.86 }),
  );
  floodWater.rotation.x = -H;
  floodWater.position.set(0, -6.8, 14.0);
  floodWater.visible = false;
  lvl.group.add(floodWater);

  // Thermite molten slag glow inside Container #3
  const thermiteGlow = new THREE.PointLight(0xff6218, 0, 14, 1.6);
  thermiteGlow.position.set(0, -4.6, 41.5);
  const thermiteMesh = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffa438 }));
  thermiteMesh.position.set(0, -5.0, 41.8);
  thermiteMesh.visible = false;
  lvl.group.add(thermiteGlow, thermiteMesh);

  // 3 Scripted Spline-Driven Sliding Giant Containers on Zone D Forward Deck!
  const makeSlider = (x: number, y: number, z: number, rotY: number, tintHex: number) => {
    const cObj = makePropObject('container', 0.9);
    cObj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.setHex(tintHex);
        m.material = mat;
      }
    });
    cObj.position.set(x, y, z);
    cObj.rotation.y = rotY;
    lvl.group.add(cObj);
    return cObj;
  };
  const s1Mesh = makeSlider(-9.5, 0.0, 58.5, H, 0x8e3226);
  const s1Col = world.addBox(1.5, 1.3, 58.5, 3.0, 1.3, 1.25, 0, 'metal', true);
  s1Col.enabled = false;
  const slide1 = { mesh: s1Mesh, col: s1Col, t: 0, active: false };

  const s2Mesh = makeSlider(-6.5, 2.6, 65.0, 0, 0x264b6b);
  const slide2 = { mesh: s2Mesh, t: 0, active: false };

  const s3Mesh = makeSlider(-10.5, 0.0, 77.5, H, 0x8c6828);
  const slide3 = { mesh: s3Mesh, t: 0, active: false };

  // Fixed 10-Slot Dynamic PointLight Pool:
  // Keeps WebGL NUM_POINT_LIGHTS strictly constant = 10 (down from 49!) -> 5x faster PBR shaders & zero stutter!
  const LIGHT_POOL_SIZE = 10;
  const lightPool: THREE.PointLight[] = [];
  for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
    const pl = new THREE.PointLight(0xffffff, 0, 26, 1.7);
    pl.position.set(0, -100, 0);
    lvl.group.add(pl);
    lightPool.push(pl);
  }
  const mainLights: THREE.PointLight[] = lightPool;
  const alarmLights: THREE.PointLight[] = [];

  // Gently swaying watertight beacon reference (virtual light over Zone A watertight door)
  const wtLamp = virtualLights.find((l) => Math.abs(l.pos.z + 43) < 1.5 && Math.abs(l.pos.x) < 1) ?? virtualLights[0];

  // Crimson Emergency Strobe Strip virtual lights (automatically enter the 10-slot pool when active!)
  const alarmVirtuals: VirtualLight[] = [];
  for (let i = 0; i < 7; i++) {
    const [ax, ay, az] = [
      [0, -2.2, 32.0], [12.0, -2.5, 38.0], [12.0, 1.8, 49.0],
      [-8.5, 2.4, 56.0], [-8.5, 2.4, 66.0], [-5.5, 2.6, 76.0], [0, 4.2, 86.0],
    ][i];
    const vl: VirtualLight = {
      id: `alarm_${i}`,
      pos: new THREE.Vector3(ax, ay, az),
      color: 0xff1e14,
      intensity: 0,
      baseIntensity: 0,
      distance: 28,
      decay: 1.35,
      kind: 'alarm',
    };
    virtualLights.push(vl);
    alarmVirtuals.push(vl);
  }

  let sinkLevel = 0;
  let alarmOn = false;
  let thermiteOn = false;
  let blackoutOn = false;

  const ship: ShipDynamic = {
    heli: heliRig.root,
    heliRotor: heliRig.rotor,
    heliTailRotor: heliRig.tailRotor,
    heliRope: heliRig.rope,
    heliSpot: heliRig.spot,
    watertightDoor: wtPivot,
    holdAirlockDoor,
    bowAirlockDoor,
    messMainDoor: messMainPivot,
    messSideDoor: messSidePivot,
    watertightCollider: wtCol,
    holdAirlockCollider,
    bowAirlockCollider,
    messMainCollider: messMainCol,
    messSideCollider: messSideCol,
    floodWater,
    thermiteGlow,
    thermiteMesh,
    mainLights,
    alarmLights,
    waterJets,
    intelTablet,
    slide1,
    slide2,
    slide3,
    rain: rain.lines,
    destroyerBeam: destroyer.beam,
    collectibles,
    interactables,
    setSinking(level: number) {
      sinkLevel = level;
      floodWater.visible = level > 0.01;
      for (const j of waterJets) j.visible = level > 0.01;
    },
    setAlarm(on: boolean) {
      alarmOn = on;
      if (!on) for (const l of alarmVirtuals) l.intensity = 0;
    },
    setBlackout(blackout: boolean) {
      blackoutOn = blackout;
      for (const vl of virtualLights) {
        if (vl.kind === 'main') {
          vl.intensity = blackout ? vl.baseIntensity * 0.08 : vl.baseIntensity;
        }
      }
    },
    setThermite(on: boolean) {
      thermiteOn = on;
      thermiteMesh.visible = on;
      if (!on) thermiteGlow.intensity = 0;
    },
    setIndoors(inside: boolean) {
      rain.lines.visible = !inside;
    },
    triggerSlide(idx: 1 | 2 | 3) {
      if (idx === 1 && !slide1.active) { slide1.active = true; slide1.col.enabled = true; }
      if (idx === 2 && !slide2.active) slide2.active = true;
      if (idx === 3 && !slide3.active) slide3.active = true;
    },
  };

  lvl.ship = ship;

  // Scratch array for sorting active virtual lights by squared distance to camera
  const scored = virtualLights.map((vl) => ({ vl, d2: 0 }));

  // Per-frame maritime storm, spline sliding containers & 10-slot pooled dynamic lighting
  lvl.update = (dt: number, t: number) => {
    ocean.uniforms.uTime.value = t;
    heliRig.rotor.rotation.y += dt * 28;
    heliRig.tailRotor.rotation.x += dt * 44;
    destroyer.beam.rotation.y = Math.sin(t * 0.45) * 0.52;

    // Gentle sway on Zone A watertight door amber tungsten lamp
    if (wtLamp) wtLamp.pos.x = Math.sin(t * 2.6) * 0.35;

    // Pulsing crimson emergency strobe strip (traveling wave toward bow!)
    if (alarmOn || sinkLevel > 0) {
      for (let i = 0; i < alarmVirtuals.length; i++) {
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 7.2 - i * 0.9), 2);
        alarmVirtuals[i].intensity = pulse * (sinkLevel > 0 ? 24 : 14);
      }
    }
    if (thermiteOn) thermiteGlow.intensity = 10 + Math.sin(t * 32) * 4;
    if (sinkLevel > 0.01) {
      floodWater.position.y = THREE.MathUtils.lerp(-6.8, -4.3, Math.min(1, sinkLevel)) + Math.sin(t * 2.4) * 0.09;
      for (let i = 0; i < waterJets.length; i++) {
        waterJets[i].scale.set(0.85 + Math.sin(t * 18 + i) * 0.2, 0.9 + Math.cos(t * 22 + i) * 0.15, 0.85 + Math.sin(t * 15 + i) * 0.2);
      }
    }

    // Assign the 10 nearest active virtual lights around the camera into our fixed WebGL PointLight pool
    const camPos = lvl.group.userData.camPos as THREE.Vector3 | undefined;
    const cx = camPos ? camPos.x : 0;
    const cy = camPos ? camPos.y : 2;
    const cz = camPos ? camPos.z : -86;
    for (let i = 0; i < scored.length; i++) {
      const vl = scored[i].vl;
      if (vl.intensity <= 0.05) {
        scored[i].d2 = 1e9;
      } else {
        const dx = vl.pos.x - cx, dy = (vl.pos.y - cy) * 1.4, dz = vl.pos.z - cz;
        scored[i].d2 = dx * dx + dy * dy + dz * dz;
      }
    }
    scored.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const pl = lightPool[i];
      const s = scored[i];
      if (!s || s.d2 > 2200 || s.vl.intensity <= 0.05) {
        pl.intensity = 0;
      } else {
        const vl = s.vl;
        pl.position.copy(vl.pos);
        pl.color.setHex(vl.color);
        pl.intensity = vl.intensity;
        pl.distance = vl.distance;
        pl.decay = vl.decay;
      }
    }
    void blackoutOn;

    // Spline-driven sliding giant containers (100% deterministic, zero physics explosion!)
    if (slide1.active && slide1.t < 1) {
      slide1.t = Math.min(1, slide1.t + dt * 1.15);
      const e = 1 - Math.pow(1 - slide1.t, 3);
      slide1.mesh.position.x = THREE.MathUtils.lerp(-9.5, 1.5, e);
      slide1.mesh.rotation.y = H + Math.sin(slide1.t * Math.PI) * 0.14;
    }
    if (slide2.active && slide2.t < 1) {
      slide2.t = Math.min(1, slide2.t + dt * 0.72);
      const k = slide2.t;
      slide2.mesh.position.set(THREE.MathUtils.lerp(-6.5, 22.0, k), 2.6 - k * k * 8.5, 65.0);
      slide2.mesh.rotation.z = -k * 0.55;
    }
    if (slide3.active && slide3.t < 1) {
      slide3.t = Math.min(1, slide3.t + dt * 1.05);
      const e = 1 - Math.pow(1 - slide3.t, 2.5);
      slide3.mesh.position.set(THREE.MathUtils.lerp(-10.5, 1.8, e), 0.1, 78.8);
      slide3.mesh.rotation.y = H - 0.18 * e;
    }

    if (camPos) rain.update(t, camPos.x, camPos.y, camPos.z);
    const lAmt = (lvl.group.userData.lightning as number | undefined) ?? 0;
    ocean.uniforms.uLightning.value = lAmt;
    const sunDir = lvl.group.userData.sunDir as THREE.Vector3 | undefined;
    if (sunDir) ocean.uniforms.uMoonDir.value.copy(sunDir);
  };

  return lvl;
}
