import * as THREE from 'three';
import { TileNoise } from '../core/utils';

/**
 * Detail layer shared by every surface: a tileable high-frequency normal map sampled several
 * times finer than the base texture and blended into it. This is what gives scanned 1k/2k sets
 * their close-range crispness without paying for 4k textures everywhere.
 */
let detailTex: THREE.Texture | null = null;

export function detailNormalTexture(): THREE.Texture {
  if (detailTex) return detailTex;
  const S = 512;
  const n1 = new TileNoise(9137);
  const n2 = new TileNoise(4241);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      // coarse grit + fine sand grain, both tileable
      h[y * S + x] = n1.fbm(u, v, 12, 4) * 0.55 + n2.fbm(u, v, 48, 3) * 0.45;
    }
  }
  const data = new Uint8Array(S * S * 4);
  const strength = 2.6;
  const at = (x: number, y: number) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 16;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  detailTex = t;
  return t;
}

const DETAIL_ANCHOR = 'normal = normalize( tbn * mapN );';

/**
 * Blends the detail normal into a standard material's normal map at `tiling` times the base UV,
 * with a second, differently scaled/offset sample to hide the repeat. Also breaks up roughness
 * slightly so the micro-relief reads in the specular.
 *
 * The insertion point lives inside the `normal_fragment_maps` chunk, so that chunk is expanded
 * here — patching the raw shader text would never match.
 */
export function applyDetail(mat: THREE.MeshStandardMaterial, amount = 0.7, tiling = 7) {
  if (!mat.normalMap) return;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uDetailN = { value: detailNormalTexture() };
    shader.uniforms.uDetail = { value: new THREE.Vector4(amount, tiling, tiling * 0.37, tiling * 1.93) };
    const chunk = THREE.ShaderChunk.normal_fragment_maps.replace(
      DETAIL_ANCHOR,
      `{
  // fade the high-frequency detail out with distance: at range its two scales beat against each
  // other into moire, which turns into specular fireflies
  float dFade = 1.0 - smoothstep(5.0, 26.0, length(vViewPosition));
  vec3 dA = texture2D( uDetailN, vNormalMapUv * uDetail.y ).xyz * 2.0 - 1.0;
  vec3 dB = texture2D( uDetailN, vNormalMapUv * uDetail.w + 0.37 ).xyz * 2.0 - 1.0;
  vec2 dxy = ( dA.xy + dB.xy ) * 0.5;
  mapN.xy += dxy * uDetail.x * dFade;
  mapN = normalize( mapN );
  roughnessFactor = clamp( roughnessFactor * ( 1.0 + ( 1.0 - dA.z ) * 0.6 * uDetail.x * dFade ), 0.02, 1.0 );
}
${DETAIL_ANCHOR}`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetailN;\nuniform vec4 uDetail;')
      .replace('#include <normal_fragment_maps>', chunk);
  };
  mat.customProgramCacheKey = () => 'detail|' + prevKey;
}
