import * as THREE from 'three';
import { nextFrame } from '../core/utils';
import { assets, type ScanTexName } from './assets';
import { TexName, TexSet, buildTexture } from './textures';
import { applyConcretePanels, applyGrime, applySurfacePatina, applyWetness } from './weather';
import { applyDetail } from './detail';
import { applyPom } from './pom';
import { decalTexture } from './decals';

export type MatName =
  | TexName
  | 'glass' | 'rubber' | 'paint' | 'foliage' | 'darkmetal' | 'rock' | 'trunk'
  | 'mud' | 'osb' | 'slab' | 'vpaint' | 'decalOil' | 'decalTag' | 'decalCrack' | 'decalScorch';

/** World-space size (metres) of one texture tile for each material. */
export const TILE: Record<MatName, number> = {
  concrete: 2.8,
  plaster: 3.2,
  cinder: 1.3,
  sand: 3.4,
  asphalt: 3.2,
  corrugated: 2.2,
  metal: 2.2,
  wood: 1.25,
  burlap: 0.6,
  hesco: 1.1,
  camo: 0.9,
  fabric: 1.2,
  glass: 1,
  rubber: 1,
  paint: 1,
  foliage: 1,
  darkmetal: 1,
  rock: 1,
  trunk: 0.8,
  mud: 2.6,
  osb: 1.22,
  slab: 2.4,
  vpaint: 2.2,
  decalOil: 1, decalTag: 1, decalCrack: 1, decalScorch: 1,
};

export type Materials = Record<MatName, THREE.MeshStandardMaterial>;
export const texSets = {} as Record<TexName, TexSet>;

/**
 * Breaks up visible texture tiling by modulating albedo with two extra,
 * much lower-frequency samples of the same texture.
 */
function macroVariation(mat: THREE.MeshStandardMaterial, meanG: number, s1: number, s2: number, amount: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacro = { value: new THREE.Vector4(s1, s2, 1 / Math.max(meanG, 0.01), amount) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uMacro;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          float m1 = texture2D( map, vMapUv * uMacro.x ).g * uMacro.z;
          float m2 = texture2D( map, vMapUv * uMacro.y + vec2( 0.37, 0.61 ) ).g * uMacro.z;
          float mv = clamp( m1 * 0.55 + m2 * 0.45, 0.45, 1.7 );
          diffuseColor.rgb *= mix( 1.0, mv, uMacro.w );
        }
        #endif`,
      );
  };
}

export async function buildMaterials(hi: boolean, progress: (p: number, label: string) => void): Promise<Materials> {
  const names: [TexName, string][] = [
    ['concrete', '混凝土'], ['plaster', '灰泥墙面'], ['cinder', '空心砖'], ['sand', '沙地'], ['asphalt', '沥青路面'],
    ['corrugated', '波纹钢板'], ['metal', '涂装金属'], ['wood', '木材'], ['burlap', '沙袋织物'], ['hesco', '防爆墙'],
    ['camo', '迷彩织物'], ['fabric', '帆布'],
  ];
  for (let i = 0; i < names.length; i++) {
    const name = names[i][0];
    // photo-scanned sets (loaded beforehand) replace the synthesised ones wherever they exist
    const scan = assets.tex[name as ScanTexName];
    if (scan) {
      texSets[name] = { map: scan.map, normalMap: scan.normalMap, roughnessMap: scan.armMap, aoMap: scan.armMap, meanG: scan.meanG };
      continue;
    }
    progress(i / names.length, `合成材质 · ${names[i][1]}`);
    await nextFrame();
    texSets[name] = buildTexture(name, hi);
  }
  progress(1, '编译材质');

  const std = (name: TexName, o: Partial<THREE.MeshStandardMaterialParameters> = {}, normal = 1) => {
    const t = texSets[name];
    return new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.roughnessMap,
      aoMap: t.aoMap ?? null,
      aoMapIntensity: 0.9,
      normalScale: new THREE.Vector2(normal, normal),
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      ...o,
    });
  };

  // scan-only surfaces fall back to a related synthesised set if the scan is missing
  const scanStd = (name: 'mud' | 'osb' | 'slab', fallback: TexName, o: Partial<THREE.MeshStandardMaterialParameters> = {}, normal = 1) => {
    const s = assets.tex[name];
    const t: TexSet = s ? { map: s.map, normalMap: s.normalMap, roughnessMap: s.armMap, aoMap: s.armMap, meanG: s.meanG } : texSets[fallback];
    const mat = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, aoMap: t.aoMap ?? null, aoMapIntensity: 0.9,
      normalScale: new THREE.Vector2(normal, normal), roughness: 1, metalness: 0, vertexColors: true, ...o,
    });
    return { mat, meanG: t.meanG };
  };

  const m = {} as Materials;
  const mud = scanStd('mud', 'sand', {}, 1.4);
  m.mud = mud.mat;
  macroVariation(m.mud, mud.meanG, 0.15, 0.033, 0.7);
  m.osb = scanStd('osb', 'wood').mat;
  const slab = scanStd('slab', 'concrete');
  m.slab = slab.mat;
  macroVariation(m.slab, slab.meanG, 0.21, 0.05, 0.45);
  m.concrete = std('concrete');
  macroVariation(m.concrete, texSets.concrete.meanG, 0.19, 0.047, 0.55);
  m.plaster = std('plaster');
  macroVariation(m.plaster, texSets.plaster.meanG, 0.23, 0.061, 0.6);
  m.cinder = std('cinder');
  macroVariation(m.cinder, texSets.cinder.meanG, 0.13, 0.037, 0.5);
  m.sand = std('sand', {}, 1.2);
  macroVariation(m.sand, texSets.sand.meanG, 0.17, 0.029, 0.75);
  m.asphalt = std('asphalt');
  macroVariation(m.asphalt, texSets.asphalt.meanG, 0.21, 0.043, 0.6);
  m.corrugated = std('corrugated', { metalness: 0.35 }, 1.3);
  m.metal = std('metal', { metalness: 0.45 });
  // matte vehicle / equipment paint: dielectric and rough, so a low sun leaves a sheen rather than a mirror glint
  m.vpaint = std('metal', { metalness: 0, roughness: 0.74, roughnessMap: null }, 0.7);
  m.wood = std('wood');
  m.burlap = std('burlap');
  m.hesco = std('hesco');
  m.camo = std('camo');
  m.fabric = std('fabric', { side: THREE.DoubleSide });
  m.trunk = std('wood', {}, 1.5);
  m.glass = new THREE.MeshStandardMaterial({ color: 0x0b1118, metalness: 0.92, roughness: 0.07, envMapIntensity: 1.6, vertexColors: true });
  m.rubber = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.92, vertexColors: true });
  m.paint = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.8, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.75, vertexColors: true, side: THREE.DoubleSide });
  m.darkmetal = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.75, roughness: 0.5, vertexColors: true });
  m.rock = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 1, vertexColors: true });
  // decal layer: one material per decal type so the quads can use plain 0..1 UVs
  const decalMat = (kind: 'oil' | 'tag' | 'crack' | 'scorch') => new THREE.MeshStandardMaterial({
    map: decalTexture(kind), transparent: true, depthWrite: false, roughness: 0.92, metalness: 0,
    vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  m.decalOil = decalMat('oil');
  m.decalTag = decalMat('tag');
  m.decalCrack = decalMat('crack');
  m.decalScorch = decalMat('scorch');
  // distant ranges: craggy layered sedimentary desert sandstone cliffs with per-pixel normal relief & depth haze
  m.rock.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <fog_vertex>', 'vRockPos = position;\n#ifdef USE_FOG\n  float rkFogK = mix(0.82, 0.36, smoothstep(2.0, 42.0, position.y));\n  vFogDepth = -mvPosition.z * rkFogK;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRockPos;
float rkHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float rkNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rkHash(i), rkHash(i + vec2(1.0, 0.0)), f.x), mix(rkHash(i + vec2(0.0, 1.0)), rkHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float rkFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * rkNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float rkHeight(vec3 p) {
  float strata = rkFbm(vec2(p.y * 0.26 + rkNoise(p.xz * 0.015) * 2.2, (p.x + p.z) * 0.025));
  float crag = rkFbm(p.xz * 0.065 + vec2(p.y * 0.05));
  float scree = rkNoise(p.xz * 0.24 + p.y * 0.12);
  return strata * 0.55 + crag * 0.35 + scree * 0.1;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float ang = atan(vRockPos.z, vRockPos.x);
  float big = rkFbm(vRockPos.xz * 0.014);
  float fine = rkFbm(vRockPos.xz * 0.12 + vRockPos.y * 0.08);
  float streak = rkFbm(vec2(ang * 320.0, vRockPos.y * 0.045 + big * 2.2));
  float band = smoothstep(0.28, 0.72, rkNoise(vec2(vRockPos.y * 0.55 + big * 6.0, ang * 4.5)));
  vec3 geoN = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));
  float steep = smoothstep(0.06, 0.42, 1.0 - abs(geoN.y));
  // Richer sandstone cliff strata: sun-baked ochre scree vs darker iron-oxide cliff bands
  vec3 cliffTint = mix(vec3(1.08, 0.99, 0.88), vec3(0.76, 0.66, 0.56), band);
  float d = mix(0.82, 1.18, fine) * mix(0.88, 1.12, big);
  d *= mix(1.0, mix(0.55, 1.12, streak), steep);
  diffuseColor.rgb *= d * mix(vec3(1.0), cliffTint, steep);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // Procedural view-space bump perturbation from world-space sandstone strata so cliffs catch crisp sunlight
  float h0 = rkHeight(vRockPos);
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(h0);
  float dhdy = dFdy(h0);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) > 1e-6) {
    vec3 surfGrad = sign(det) * (dhdx * r1 + dhdy * r2);
    vec3 wN = normalize(normal - surfGrad * 1.45);
    normal = normalize(mix(normal, wN, 0.85));
  }
}`);
  };

  // after-the-rain look: damp surfaces everywhere, standing water strictly on low flat ground (mud/asphalt)
  applyWetness(m.asphalt, 0.9, 0.46);
  applyWetness(m.sand, 0.55, 0.28);
  applyWetness(m.concrete, 0.8, 0); // structural concrete: damp sheen only, no floating puddles
  applyWetness(m.mud, 0.95, 0.55);
  applyWetness(m.slab, 0.8, 0);
  for (const k of ['plaster', 'cinder', 'corrugated', 'metal', 'vpaint', 'wood', 'burlap', 'hesco', 'paint', 'rubber', 'darkmetal', 'trunk', 'osb'] as MatName[]) applyWetness(m[k], 0.7, 0);
  // run-off streaks, ground grime and a dust film: the difference between "clean box" and "in use"
  const grime: [MatName, number, number][] = [
    ['plaster', 0.9, 0.35], ['concrete', 0.75, 0.3], ['cinder', 0.85, 0.3], ['slab', 0.4, 0.25],
    ['corrugated', 0.55, 0.45], ['metal', 0.5, 0.4], ['vpaint', 0.45, 0.5], ['wood', 0.55, 0.3],
    ['osb', 0.45, 0.3], ['burlap', 0.3, 0.2], ['hesco', 0.35, 0.25], ['paint', 0.25, 0.2],
  ];
  for (const [k, a, d] of grime) applyGrime(m[k], a, d);
  // Subtle poured-concrete architectural formwork joints on structural concrete walls
  applyConcretePanels(m.concrete, 2.8, 1.6, 0.52);
  // World-space patina, micro-grain normal relief & roughness breakup on untextured shared materials
  applySurfacePatina(m.darkmetal, 0.62, 3.8);
  applySurfacePatina(m.rubber, 0.72, 6.5);
  applySurfacePatina(m.paint, 0.55, 3.0);
  applySurfacePatina(m.foliage, 0.45, 4.5);
  // micro-detail: a shared high-frequency normal layer at ~7x the base tiling. Close-up this is
  // what separates "a texture" from "a material" — grit, pits and grain stay visible at arm's length.
  for (const key of Object.keys(m) as MatName[]) {
    const mat = m[key];
    if (!mat.normalMap) continue;
    if (key === 'sand') applyDetail(mat, 0.55, 11);
    else if (key === 'asphalt' || key === 'mud') applyDetail(mat, 0.6, 9);
    else applyDetail(mat, 0.8, 7);
  }
  // parallax occlusion mapping: displacement-mapped surfaces get real depth. Depth is given in
  // UV units (1 = one tile), so it scales with TILE: e.g. concrete 0.015 * 2.8 m ~ 4 cm of relief.
  const pom: [MatName, number, number][] = [
    ['concrete', 0.015, 12], ['plaster', 0.013, 12], ['cinder', 0.02, 14], ['slab', 0.014, 12],
    ['corrugated', 0.03, 12], ['wood', 0.011, 10], ['osb', 0.009, 10],
    ['asphalt', 0.012, 8], ['mud', 0.016, 8],
  ];
  for (const [key, depth, steps] of pom) {
    const mat = m[key];
    const scan = assets.tex[key as ScanTexName];
    if (mat && scan?.heightMap) applyPom(mat, scan.heightMap, { depth, steps });
  }
  return m;
}
