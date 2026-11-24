import * as THREE from 'three';

/**
 * Parallax occlusion mapping for MeshStandardMaterial.
 *
 * The scanned sets ship a displacement map; marching it in tangent space gives the mortar joints,
 * corrugation and plank gaps real occlusion: they slide over each other with the view instead of
 * reading as a flat normal-map bump. All standard-material texture lookups (albedo, normal,
 * roughness, metalness, AO) are redirected to the parallaxed UV, including lookups injected by
 * the macro-variation / grime / detail passes.
 */
export interface PomOptions {
  /** Parallax depth in UV units (1.0 = one full tile). */
  depth: number;
  /** Marching steps; 8 is cheap, 16 is clean at grazing angles. */
  steps?: number;
}

const PATCHED = ['map_fragment', 'normal_fragment_maps', 'roughnessmap_fragment', 'metalnessmap_fragment', 'aomap_fragment'];

/** Live uPom uniforms, for debug toggles (set .x to 0 to disable parallax). */
export const pomRegistry: THREE.Vector2[] = [];

export function applyPom(mat: THREE.MeshStandardMaterial, heightMap: THREE.Texture, opts: PomOptions) {
  heightMap.wrapS = heightMap.wrapT = THREE.RepeatWrapping;
  heightMap.colorSpace = THREE.NoColorSpace;
  const steps = Math.max(4, Math.round(opts.steps ?? 12));
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();

  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    const pomVec = new THREE.Vector2(opts.depth, steps);
    shader.uniforms.uHeightMap = { value: heightMap };
    shader.uniforms.uPom = { value: pomVec };
    pomRegistry.push(pomVec);

    const chunk = (name: string) =>
      (THREE.ShaderChunk as Record<string, string>)[name]
        .replace(/vAoMapUv/g, 'pomUv')
        .replace(/vRoughnessMapUv/g, 'pomUv')
        .replace(/vMetalnessMapUv/g, 'pomUv')
        .replace(/vNormalMapUv/g, 'pomUv')
        .replace(/vMapUv/g, 'pomUv');

    let f = shader.fragmentShader;
    // code injected by earlier passes (macro variation, grime, detail) is literal text here, so it
    // can be redirected directly; the chunk includes are still unexpanded and are patched below
    f = f
      .replace(/vAoMapUv/g, 'pomUv')
      .replace(/vRoughnessMapUv/g, 'pomUv')
      .replace(/vMetalnessMapUv/g, 'pomUv')
      .replace(/vNormalMapUv/g, 'pomUv')
      .replace(/vMapUv/g, 'pomUv');

    for (const name of PATCHED) {
      if (f.includes(`#include <${name}>`)) f = f.replace(`#include <${name}>`, chunk(name));
    }

    f = f
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uHeightMap;
uniform vec2 uPom;
vec2 pomUv;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  // adaptive distance-LOD parallax: full step depth close up, fewer steps at medium range, zero cost beyond 28m where relief is sub-pixel
  float pomDist = length( vViewPosition );
  float pomFade = 1.0 - smoothstep( 10.0, 28.0, pomDist );
  pomUv = vMapUv;
  if ( pomFade > 0.01 ) {
    vec3 pomV = normalize( vViewPosition );
    vec3 pomN = normalize( vNormal );
    vec3 dpx = dFdx( vViewPosition );
    vec3 dpy = dFdy( vViewPosition );
    vec2 dux = dFdx( vMapUv );
    vec2 duy = dFdy( vMapUv );
    vec3 p2 = cross( dpy, pomN );
    vec3 p1 = cross( pomN, dpx );
    vec3 pomT = p2 * dux.x + p1 * duy.x;
    vec3 pomB = p2 * dux.y + p1 * duy.y;
    float pomInv = inversesqrt( max( dot( pomT, pomT ), dot( pomB, pomB ) ) );
    pomT *= pomInv;
    pomB *= pomInv;
    vec3 vt = vec3( dot( pomV, pomT ), dot( pomV, pomB ), dot( pomV, pomN ) );

    float layers = max( 4.0, floor( uPom.y * ( 0.35 + 0.65 * pomFade ) ) );
    float stepD = 1.0 / layers;
    vec2 delta = ( vt.xy / max( abs( vt.z ), 0.22 ) ) * uPom.x * pomFade * stepD;
    vec2 curUv = vMapUv;
    vec2 prevUv = curUv;
    float depth = 1.0 - texture2D( uHeightMap, curUv ).r;
    float prevDepth = depth;
    float layer = 0.0;
    float prevLayer = 0.0;
    for ( int i = 0; i < 16; i++ ) {
      if ( float( i ) >= layers || layer >= depth ) break;
      prevUv = curUv;
      prevDepth = depth;
      prevLayer = layer;
      layer += stepD;
      curUv -= delta;
      depth = 1.0 - texture2D( uHeightMap, curUv ).r;
    }
    float after = depth - layer;
    float before = prevDepth - prevLayer;
    float w = clamp( after / max( after - before, 1e-4 ), 0.0, 1.0 );
    pomUv = mix( vMapUv, mix( curUv, prevUv, w ), pomFade );
  }
}`,
      );
    shader.fragmentShader = f;
  };

  mat.customProgramCacheKey = () => 'pom|' + prevKey;
}
