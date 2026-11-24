import * as THREE from 'three';

/** Shared GPU uniform driving real-time concentric raindrop ripple normals on open wet decks (x = time, y = strength 0..1). */
export const rainRippleUniform = { value: new THREE.Vector2(0, 0) };

/** Shared GPU uniform driving sheet-lightning flash intensity (0..1) across storm sky, ocean waves, and rain streaks. */
export const stormLightningUniform = { value: 0 };

/**
 * Weather look, shared by every world material: the level is set just after a rain shower
 * at first light. Surfaces that face the sky are damp (darker, more saturated, glossier),
 * walls carry a wet band where they meet the ground, and low flat ground collects puddles
 * that mirror the sky. Everything is driven by world-space noise, so it never tiles.
 */
export function applyWetness(mat: THREE.MeshStandardMaterial, wet: number, puddle = 0) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    // x: dampness, y: puddle coverage, z: unused, w: highest ground level that holds water (strictly ground level only)
    shader.uniforms.uWet = { value: new THREE.Vector4(wet, puddle, 0, 0.04) };
    shader.uniforms.uRainRipple = rainRippleUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 wtWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wtWp = instanceMatrix * wtWp;
  #endif
  vWetPos = (modelMatrix * wtWp).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec4 uWet;
uniform vec2 uRainRipple;
varying vec3 vWetPos;
float wtHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float wtNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wtHash(i), wtHash(i + vec2(1.0, 0.0)), f.x), mix(wtHash(i + vec2(0.0, 1.0)), wtHash(i + vec2(1.0, 1.0)), f.x), f.y); }
vec2 wtRipple(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = wtHash(cell);
  float phase = fract(t * (1.15 + h * 0.65) + h * 6.2831);
  vec2 center = (vec2(wtHash(cell + 17.3), wtHash(cell + 43.1)) - 0.5) * 0.48;
  vec2 d = f - center;
  float r = length(d);
  float wave = sin((r - phase * 0.45) * 34.0) * exp(-abs(r - phase * 0.45) * 14.0) * (1.0 - phase) * smoothstep(0.45, 0.05, r);
  return (r > 0.001 ? d / r : vec2(0.0)) * wave;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 wtN = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
  float wtUp = smoothstep(0.35, 0.9, wtN.y);
  float wtExpo = smoothstep(-0.5, 0.0, wtN.y);
  float wt1 = wtNoise(vWetPos.xz * 0.09), wt2 = wtNoise(vWetPos.xz * 0.31 + 11.0), wt3 = wtNoise(vWetPos.xz * 1.7 + 3.0);
  float wtDamp = uWet.x * wtExpo * mix(0.3 + 0.3 * wt2, 0.5 + 0.5 * wt1, wtUp);
  // splashed band where walls and objects meet the ground
  wtDamp += uWet.x * (1.0 - wtUp) * wtExpo * smoothstep(0.75, 0.0, vWetPos.y) * 0.4;
  wtDamp = clamp(wtDamp, 0.0, 1.0);
  float wtPud = 0.0;
  if (uWet.y > 0.01) {
    float wtH = wt1 * 0.62 + wt2 * 0.3 + wt3 * 0.08;
    // Puddles strictly pool on the ground plane (y < uWet.w = 0.04), never on elevated stairs, boxes, or roofs
    float groundOnly = smoothstep(uWet.w + 0.015, uWet.w - 0.015, vWetPos.y);
    wtPud = smoothstep(1.0 - uWet.y, 1.06 - uWet.y, wtH) * smoothstep(0.96, 0.998, wtN.y) * groundOnly * uWet.x;
  }
  float wtLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(vec3(wtLum), diffuseColor.rgb, 1.0 + 0.25 * wtDamp) * (1.0 - 0.36 * wtDamp);
  diffuseColor.rgb *= 1.0 - 0.22 * wtPud;
  roughnessFactor = mix(roughnessFactor, max(roughnessFactor * 0.78, 0.52), wtDamp);
  roughnessFactor = mix(roughnessFactor, 0.14, wtPud);
  // Real-time 3-layer concentric raindrop ripples & glossy water film on upward wet steel/deck surfaces during midnight storm missions
  float wtDist = length(vWetPos - cameraPosition);
  if (uRainRipple.y > 0.01 && wtUp > 0.78 && wtDist < 36.0) {
    float ripFade = (1.0 - smoothstep(16.0, 36.0, wtDist)) * uRainRipple.y * wtUp;
    vec2 rGrad = wtRipple(vWetPos.xz * 1.55, uRainRipple.x * 1.15)
               + wtRipple(vWetPos.xz * 2.65 + 19.7, uRainRipple.x * 1.32) * 0.75
               + wtRipple(vWetPos.xz * 4.10 + 41.3, uRainRipple.x * 1.55) * 0.50;
    vec3 ripView = normalize(mat3(viewMatrix) * vec3(rGrad.x * 0.34 * ripFade, 1.0, rGrad.y * 0.34 * ripFade));
    normal = normalize(mix(normal, ripView, 0.58 * ripFade));
    roughnessFactor = mix(roughnessFactor, 0.14, 0.72 * ripFade);
  }
  // specular antialiasing: soften grazing-angle sun glare on wet asphalt/ground so it mirrors sky cleanly without nuclear whiteout
  vec3 wtV = normalize(cameraPosition - vWetPos);
  float wtGraze = 1.0 - clamp(wtV.y, 0.0, 1.0);
  roughnessFactor = max(roughnessFactor, smoothstep(10.0, 62.0, wtDist) * 0.42 + wtGraze * wtGraze * 0.18 * wtPud);
  normal = normalize(mix(normal, nonPerturbedNormal, wtPud * 0.94));
  // specular antialiasing: widen the lobe by how fast the normal changes between pixels, so the
  // wet ground does not sparkle into fireflies at grazing angles
  vec3 wtDnx = dFdx(normal);
  vec3 wtDny = dFdy(normal);
  float wtVar = min(dot(wtDnx, wtDnx), dot(wtDny, wtDny));
  roughnessFactor = clamp(sqrt(roughnessFactor * roughnessFactor + wtVar * 0.45), 0.12, 1.0);
}`);
  };
  mat.customProgramCacheKey = () => 'wet|' + prevKey;
}

/**
 * Dirt dressing shared by every hard surface: run-off streaks down walls, a heavier grime band
 * where objects meet the ground, and a thin dust film on upward faces. Driven by world-space
 * noise so it never repeats with the texture tiling.
 */
export function applyGrime(mat: THREE.MeshStandardMaterial, amount: number, dust = 0.3) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uGrime = { value: new THREE.Vector2(amount, dust) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrimePos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 gmWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    gmWp = instanceMatrix * gmWp;
  #endif
  vGrimePos = (modelMatrix * gmWp).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec2 uGrime;
varying vec3 vGrimePos;
float gmHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float gmNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gmHash(i), gmHash(i + vec2(1.0, 0.0)), f.x), mix(gmHash(i + vec2(0.0, 1.0)), gmHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float gmFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * gmNoise(p); p = p * 2.07 + 13.7; a *= 0.5; } return s; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float gmCachedStreak = 0.5;
{
  // streaks run downwards: sample stretched heavily on Y so the noise smears into run-off
  float gmH = vGrimePos.y;
  gmCachedStreak = gmFbm(vec2(vGrimePos.x * 2.6 + vGrimePos.z * 2.1, gmH * 0.22));
  float gmFine = gmNoise(vec2(vGrimePos.x * 9.0 - vGrimePos.z * 7.0, gmH * 0.9));
  float gmRun = mix(gmCachedStreak, gmFine, 0.35);
  float gmBase = smoothstep(1.6, 0.0, gmH) * (0.55 + 0.45 * gmRun);
  // grime settles under ledges and along the bottom edge of every wall
  float gmBand = smoothstep(0.9, 0.25, gmH) * 0.6;
  float gmDirt = clamp(gmBase + gmBand * 0.7, 0.0, 1.0);
  float gmTone = 1.0 - uGrime.x * (gmDirt * 0.5 + (gmRun - 0.5) * 0.16);
  diffuseColor.rgb *= gmTone;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 0.9, 0.86), gmDirt * uGrime.x * 0.3);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // pale dust film on surfaces that face the sky (reuses cached streak noise: zero extra fBm octaves)
  vec3 gmWn = inverseTransformDirection(normal, viewMatrix);
  float gmUp = smoothstep(0.55, 0.95, gmWn.y);
  float gmDust = gmUp * uGrime.y * smoothstep(0.4, 3.0, vGrimePos.y) * (0.7 + 0.3 * gmCachedStreak);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 1.01, 0.94) + vec3(0.012, 0.008, 0.0), gmDust);
}`);
  };
  mat.customProgramCacheKey = () => 'grime|' + prevKey;
}

/**
 * World-space procedural micro-patina, grain bump & roughness breakup for untextured/flat
 * GLB props (vehicles, trim, railings, rubber, paint) so they read as weathered real materials
 * instead of smooth uniform plastic. Instancing-safe and zero extra texture lookups.
 */
export function applySurfacePatina(mat: THREE.MeshStandardMaterial, strength = 0.55, scale = 3.2) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uPatina = { value: new THREE.Vector2(strength, scale) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPatPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 ptWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    ptWp = instanceMatrix * ptWp;
  #endif
  vPatPos = (modelMatrix * ptWp).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec2 uPatina;
varying vec3 vPatPos;
float ptHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float ptNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ptHash(i), ptHash(i + vec2(1.0, 0.0)), f.x), mix(ptHash(i + vec2(0.0, 1.0)), ptHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float ptTri(vec3 p, vec3 an) {
  return ptNoise(p.yz) * an.x + ptNoise(p.xz) * an.y + ptNoise(p.xy) * an.z;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 ptWn = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
  vec3 ptAn = abs(ptWn);
  ptAn /= max(ptAn.x + ptAn.y + ptAn.z, 1e-4);
  float ptMacro = ptTri(vPatPos * (uPatina.y * 0.28), ptAn);
  float ptMed = ptTri(vPatPos * uPatina.y + vec3(4.3, 1.7, 7.1), ptAn);
  float ptFine = ptTri(vPatPos * (uPatina.y * 3.8) + vec3(11.2, 5.4, 2.9), ptAn);
  float ptMix = ptMacro * 0.48 + ptMed * 0.34 + ptFine * 0.18;
  // Organic painted-metal / stone mottling & subtle upward dust film
  float ptTone = mix(1.0 - 0.14 * uPatina.x, 1.0 + 0.10 * uPatina.x, ptMix);
  diffuseColor.rgb *= ptTone;
  float ptDust = smoothstep(0.55, 0.92, ptWn.y) * uPatina.x * (0.28 + 0.45 * ptMacro) * 0.16;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.02, 0.92) + vec3(0.025, 0.020, 0.014), ptDust);
  // Specular roughness breakup so flat surfaces never read as uniform plastic
  roughnessFactor = clamp(roughnessFactor * mix(0.76, 1.24, mix(0.5, ptMix, uPatina.x)), 0.18, 0.98);
  // Subtle view-space micro-grain bump relief
  float ptH = ptMed * 0.55 + ptFine * 0.45;
  vec3 ptDpx = dFdx(-vViewPosition);
  vec3 ptDpy = dFdy(-vViewPosition);
  vec3 ptR1 = cross(ptDpy, normal);
  vec3 ptR2 = cross(normal, ptDpx);
  float ptDet = dot(ptDpx, ptR1);
  if (abs(ptDet) > 1e-6) {
    vec3 ptGrad = sign(ptDet) * (dFdx(ptH) * ptR1 + dFdy(ptH) * ptR2);
    normal = normalize(mix(normal, normalize(normal - ptGrad * (0.42 * uPatina.x)), 0.72));
  }
}`);
  };
  mat.customProgramCacheKey = () => `patina|${strength.toFixed(2)}|${scale.toFixed(1)}|` + prevKey;
}

/**
 * Architectural poured-concrete formwork panel shader: adds recessed expansion seams,
 * tie-rod bolt dimples, per-panel batch tone variation, and vertical runoff streaks on walls.
 */
export function applyConcretePanels(mat: THREE.MeshStandardMaterial, panelW = 2.6, panelH = 1.55, strength = 0.85) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uPanels = { value: new THREE.Vector3(panelW, panelH, strength) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPanPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 pnWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    pnWp = instanceMatrix * pnWp;
  #endif
  vPanPos = (modelMatrix * pnWp).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uPanels;
varying vec3 vPanPos;
float pnHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float pnNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pnHash(i), pnHash(i + vec2(1.0, 0.0)), f.x), mix(pnHash(i + vec2(0.0, 1.0)), pnHash(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 pnWn = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
  float pnWall = 1.0 - smoothstep(0.42, 0.72, abs(pnWn.y));
  if (pnWall > 0.01) {
    float pnAlong = abs(pnWn.x) > abs(pnWn.z) ? vPanPos.z : vPanPos.x;
    vec2 pnCoord = vec2(pnAlong / uPanels.x, vPanPos.y / uPanels.y);
    vec2 pnId = floor(pnCoord);
    vec2 pnUv = fract(pnCoord);
    // Crisp recessed formwork joint seams
    float edgeX = min(pnUv.x, 1.0 - pnUv.x) * uPanels.x;
    float edgeY = min(pnUv.y, 1.0 - pnUv.y) * uPanels.y;
    float seamX = 1.0 - smoothstep(0.008, 0.026, edgeX);
    float seamY = 1.0 - smoothstep(0.008, 0.026, edgeY);
    float seam = max(seamX, seamY);
    // Recessed tie-rod bolt dimples (2x2 per poured panel)
    vec2 tieCell = abs(fract(pnUv * 2.0) - 0.5) * vec2(uPanels.x, uPanels.y) * 0.5;
    float tieD = length(tieCell);
    float tieHole = 1.0 - smoothstep(0.022, 0.044, tieD);
    // Per-panel poured concrete batch tint variation + vertical rain drip streaks
    float batch = pnHash(pnId + 17.3);
    float drip = pnNoise(vec2(pnAlong * 3.2, vPanPos.y * 0.35)) * smoothstep(0.35, 1.0, pnUv.y);
    float groove = clamp(seam + tieHole * 0.85, 0.0, 1.0) * pnWall * uPanels.z;
    float tint = mix(0.93, 1.06, batch);
    diffuseColor.rgb *= mix(1.0, tint, pnWall * uPanels.z * 0.75);
    diffuseColor.rgb *= 1.0 - groove * 0.38 - drip * pnWall * uPanels.z * 0.14;
    roughnessFactor = clamp(roughnessFactor + groove * 0.12, 0.25, 0.98);
    // Bevel normal relief along panel seams & tie holes
    float pnH = -(seam * 0.8 + tieHole * 0.65) * pnWall;
    vec3 pnDpx = dFdx(-vViewPosition);
    vec3 pnDpy = dFdy(-vViewPosition);
    vec3 pnR1 = cross(pnDpy, normal);
    vec3 pnR2 = cross(normal, pnDpx);
    float pnDet = dot(pnDpx, pnR1);
    if (abs(pnDet) > 1e-6) {
      vec3 pnGrad = sign(pnDet) * (dFdx(pnH) * pnR1 + dFdy(pnH) * pnR2);
      normal = normalize(mix(normal, normalize(normal - pnGrad * (0.85 * uPanels.z)), 0.78));
    }
  }
}`);
  };
  mat.customProgramCacheKey = () => `panels|${panelW}|${panelH}|${strength.toFixed(2)}|` + prevKey;
}

/**
 * Directional fog: haze glows warm towards the low sun and stays darker and cooler away from
 * it, which is what gives backlit scenes their depth. Patches the shared fog shader chunks,
 * so it must run before any material is compiled.
 */
export function patchFog(sunDir: THREE.Vector3) {
  const C = THREE.ShaderChunk;
  const sun = `vec3(${sunDir.x.toFixed(5)}, ${sunDir.y.toFixed(5)}, ${sunDir.z.toFixed(5)})`;
  C.fog_pars_vertex = `#ifdef USE_FOG\n  varying float vFogDepth;\n  varying vec3 vFogView;\n#endif`;
  C.fog_vertex = `#ifdef USE_FOG\n  vFogDepth = - mvPosition.z;\n  vFogView = mvPosition.xyz;\n#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogSun = normalize( ( viewMatrix * vec4( ${sun}, 0.0 ) ).xyz );
  float fogMu = max( dot( normalize( vFogView ), fogSun ), 0.0 );
  vec3 fogCol = fogColor * ( 0.55 + 0.75 * pow( fogMu, 5.0 ) ) + vec3( 1.0, 0.6, 0.28 ) * pow( fogMu, 28.0 ) * 0.55;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
}
