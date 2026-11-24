import * as THREE from 'three';
import { rand } from '../core/utils';
import { Surface } from '../world/physics';
import { makeBulletHoleTexture, makeParticleAtlas, makeScorchTexture } from './textures';

// ---------------------------------------------------------------------------
// GPU-instanced billboard particles (CPU simulated)
// ---------------------------------------------------------------------------
const P_VERT = /* glsl */ `
attribute vec4 iPos;
attribute vec4 iCol;
attribute vec4 iMisc;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;
varying float vFog;
void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  float c = cos(iMisc.x), s = sin(iMisc.x);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iPos.w;
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  float f = iMisc.y;
  vec2 fo = vec2(mod(f, 2.0), 1.0 - floor(f * 0.5)) * 0.5;
  vUv = uv * 0.5 + fo;
  vCol = iCol;
  vAdd = iMisc.z;
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
}`;

const P_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;
varying float vFog;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  vec3 c = t.rgb * vCol.rgb;
  c = mix(c, uFogColor, vFog * (1.0 - vAdd));
  a *= mix(1.0, 1.0 - vFog, vAdd);
  gl_FragColor = vec4(c * a, a * (1.0 - vAdd));
}`;

export const SMOKE = 0, GLOW = 1, FLAME = 2, DEBRIS = 3;

export class Particles {
  readonly max = 7000;
  n = 0;
  mesh: THREE.Mesh;
  private px = new Float32Array(this.max);
  private py = new Float32Array(this.max);
  private pz = new Float32Array(this.max);
  private vx = new Float32Array(this.max);
  private vy = new Float32Array(this.max);
  private vz = new Float32Array(this.max);
  private age = new Float32Array(this.max);
  private life = new Float32Array(this.max);
  private s0 = new Float32Array(this.max);
  private s1 = new Float32Array(this.max);
  private cr = new Float32Array(this.max);
  private cg = new Float32Array(this.max);
  private cb = new Float32Array(this.max);
  private ca = new Float32Array(this.max);
  private rot = new Float32Array(this.max);
  private rotV = new Float32Array(this.max);
  private frame = new Uint8Array(this.max);
  private add = new Float32Array(this.max);
  private drag = new Float32Array(this.max);
  private grav = new Float32Array(this.max);
  private fadeIn = new Float32Array(this.max);
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aMisc: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  wind = new THREE.Vector3(0.9, 0, 0.35);

  constructor(fog: THREE.FogExp2) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.attributes.position);
    this.geo.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iCol', this.aCol);
    this.geo.setAttribute('iMisc', this.aMisc);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      uniforms: { uTex: { value: makeParticleAtlas() }, uFogColor: { value: fog.color }, uFogDensity: { value: fog.density } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number,
    r: number, g: number, b: number, a: number, frame: number, additive: number, drag: number, grav: number, rotV = 0, fadeIn = 0.08) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.ca[i] = a;
    this.rot[i] = Math.random() * 6.283; this.rotV[i] = rotV;
    this.frame[i] = frame; this.add[i] = additive;
    this.drag[i] = drag; this.grav[i] = grav; this.fadeIn[i] = fadeIn;
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }

  /** Briefly expose 1 zero-alpha billboard during loading prewarmAsync so the instanced particle shader & atlas upload upfront. */
  prewarm(): () => void {
    const prevCount = this.geo.instanceCount;
    if (this.n === 0) {
      const pos = this.aPos.array as Float32Array;
      const col = this.aCol.array as Float32Array;
      const misc = this.aMisc.array as Float32Array;
      pos[0] = 0; pos[1] = -45; pos[2] = 0; pos[3] = 0.1;
      col[0] = 1; col[1] = 1; col[2] = 1; col[3] = 0.001;
      misc[0] = 0; misc[1] = 0; misc[2] = 0; misc[3] = 0;
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aMisc.needsUpdate = true;
      this.geo.instanceCount = 1;
    }
    return () => {
      this.geo.instanceCount = this.n > 0 ? this.n : prevCount;
    };
  }

  update(dt: number) {
    const pos = this.aPos.array as Float32Array;
    const col = this.aCol.array as Float32Array;
    const misc = this.aMisc.array as Float32Array;
    const wx = this.wind.x, wz = this.wind.z;
    let i = 0;
    while (i < this.n) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        const l = --this.n;
        if (i !== l) {
          this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
          this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
          this.age[i] = this.age[l]; this.life[i] = this.life[l];
          this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
          this.cr[i] = this.cr[l]; this.cg[i] = this.cg[l]; this.cb[i] = this.cb[l]; this.ca[i] = this.ca[l];
          this.rot[i] = this.rot[l]; this.rotV[i] = this.rotV[l];
          this.frame[i] = this.frame[l]; this.add[i] = this.add[l];
          this.drag[i] = this.drag[l]; this.grav[i] = this.grav[l]; this.fadeIn[i] = this.fadeIn[l];
        }
        continue;
      }
      const t = age / this.life[i];
      const dr = this.drag[i];
      if (dr > 0) {
        const k = Math.exp(-dr * dt);
        // smoke-like particles relax towards the wind velocity rather than rest
        const smoke = this.frame[i] === SMOKE ? 1 : 0;
        this.vx[i] = wx * smoke + (this.vx[i] - wx * smoke) * k;
        this.vy[i] *= k;
        this.vz[i] = wz * smoke + (this.vz[i] - wz * smoke) * k;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.grav[i] > 1 && this.py[i] < 0.02) {
        this.py[i] = 0.02;
        this.vy[i] *= -0.32;
        this.vx[i] *= 0.55;
        this.vz[i] *= 0.55;
        this.rotV[i] *= 0.4;
      }
      this.rot[i] += this.rotV[i] * dt;
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
      const fi = this.fadeIn[i];
      const alpha = this.ca[i] * (t < fi ? t / fi : 1) * (this.add[i] > 0.5 ? (1 - t) * (1 - t) : 1 - t * t);
      const j = i * 4;
      pos[j] = this.px[i]; pos[j + 1] = this.py[i]; pos[j + 2] = this.pz[i]; pos[j + 3] = size;
      col[j] = this.cr[i]; col[j + 1] = this.cg[i]; col[j + 2] = this.cb[i]; col[j + 3] = alpha;
      misc[j] = this.rot[i]; misc[j + 1] = this.frame[i]; misc[j + 2] = this.add[i];
      i++;
    }
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      this.aPos.clearUpdateRanges();
      this.aCol.clearUpdateRanges();
      this.aMisc.clearUpdateRanges();
      this.aPos.addUpdateRange(0, this.n * 4);
      this.aCol.addUpdateRange(0, this.n * 4);
      this.aMisc.addUpdateRange(0, this.n * 4);
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aMisc.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Decals (bullet holes, scorch marks, blood pools) — auto-fading & GPU-compacted
// Active decals live densely in [0..active-1]; expired decals are O(1) swap-removed
// so GPU renders ONLY live decals (mesh.count = active; 0 decals = 0 draw calls!).
// ---------------------------------------------------------------------------
class DecalPool {
  mesh: THREE.InstancedMesh;
  active = 0;
  private life: Float32Array;
  private fadeDur: Float32Array;
  private alphaArr: Float32Array;
  private aAlpha: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(tex: THREE.Texture, private capacity: number, private defaultLife = 16, private defaultFade = 2.5) {
    this.life = new Float32Array(capacity);
    this.fadeDur = new Float32Array(capacity);
    this.alphaArr = new Float32Array(capacity);

    const geo = new THREE.PlaneGeometry(1, 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(this.alphaArr, 1);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.aAlpha);

    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.95, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vDecalAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDecalAlpha = aAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDecalAlpha;')
        .replace('#include <dithering_fragment>', 'gl_FragColor.a *= vDecalAlpha;\n#include <dithering_fragment>');
    };
    mat.customProgramCacheKey = () => 'decal-fade-v1';

    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noAo = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
    }
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  /** Briefly expose 1 transparent instance during loading prewarmAsync so the custom fade shader compiles upfront. */
  prewarm(): () => void {
    const prevCount = this.mesh.count;
    const prevVis = this.mesh.visible;
    if (this.active === 0) {
      this.m.makeTranslation(0, -45, 0);
      this.mesh.setMatrixAt(0, this.m);
      this.alphaArr[0] = 0;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
      this.mesh.count = 1;
      this.mesh.visible = true;
    }
    return () => {
      this.mesh.count = this.active > 0 ? this.active : prevCount;
      this.mesh.visible = this.active > 0 ? true : prevVis;
    };
  }

  add(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    size: number,
    r: number,
    g: number,
    b: number,
    lifeSec = this.defaultLife,
    fadeSec = this.defaultFade,
  ) {
    let slot: number;
    if (this.active < this.capacity) {
      slot = this.active++;
    } else {
      // Pool full: recycle the oldest decal (minimum remaining life)
      slot = 0;
      let minL = this.life[0];
      for (let i = 1; i < this.capacity; i++) {
        if (this.life[i] < minL) {
          minL = this.life[i];
          slot = i;
        }
      }
    }

    this.q.setFromUnitVectors(Z, normal);
    this.q2.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
    this.q.multiply(this.q2);
    this.p.copy(point).addScaledVector(normal, 0.012);
    this.s.set(size, size, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(slot, this.m);
    this.mesh.setColorAt(slot, this.c.setRGB(r, g, b));
    this.life[slot] = lifeSec;
    this.fadeDur[slot] = fadeSec;
    this.alphaArr[slot] = 1;

    this.mesh.count = this.active;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  update(dt: number) {
    if (this.active === 0) return;
    let matDirty = false;
    let colDirty = false;
    let alphaDirty = false;
    const matArr = this.mesh.instanceMatrix.array as Float32Array;
    const colArr = this.mesh.instanceColor!.array as Float32Array;

    let i = 0;
    while (i < this.active) {
      const rem = this.life[i] - dt;
      if (rem <= 0) {
        const last = --this.active;
        if (i !== last) {
          // O(1) swap-remove: pack last live decal into expired slot
          this.life[i] = this.life[last];
          this.fadeDur[i] = this.fadeDur[last];
          this.alphaArr[i] = this.alphaArr[last];
          const dstM = i * 16, srcM = last * 16;
          for (let k = 0; k < 16; k++) matArr[dstM + k] = matArr[srcM + k];
          const dstC = i * 3, srcC = last * 3;
          colArr[dstC] = colArr[srcC];
          colArr[dstC + 1] = colArr[srcC + 1];
          colArr[dstC + 2] = colArr[srcC + 2];
          matDirty = true;
          colDirty = true;
        }
        alphaDirty = true;
        continue;
      }
      this.life[i] = rem;
      const fd = this.fadeDur[i];
      if (rem < fd) {
        this.alphaArr[i] = Math.max(0, rem / fd);
        alphaDirty = true;
      }
      i++;
    }

    this.mesh.count = this.active;
    this.mesh.visible = this.active > 0;
    if (matDirty) this.mesh.instanceMatrix.needsUpdate = true;
    if (colDirty) this.mesh.instanceColor!.needsUpdate = true;
    if (alphaDirty) this.aAlpha.needsUpdate = true;
  }

  clear() {
    this.active = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
const Z = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// Bullet tracers
// ---------------------------------------------------------------------------
interface Tracer {
  mesh: THREE.Mesh;
  active: boolean;
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  dist: number;
  head: number;
  speed: number;
  len: number;
}

class Tracers {
  group = new THREE.Group();
  private pool: Tracer[] = [];
  private bx = new THREE.Vector3();
  private by = new THREE.Vector3();
  private bz = new THREE.Vector3();
  private m = new THREE.Matrix4();
  constructor() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 16);
    const v = ctx.createLinearGradient(0, 0, 0, 16);
    v.addColorStop(0, 'rgba(0,0,0,1)');
    v.addColorStop(0.5, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 64, 16);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color().setRGB(5, 3.2, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.pool.push({ mesh, active: false, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, dist: 0, head: 0, speed: 300, len: 8 });
    }
  }
  /** Briefly expose slot 0 during loading prewarmAsync so the additive bullet tracer shader & texture compile upfront. */
  prewarm(): () => void {
    const t0 = this.pool[0];
    const prevVis = t0.mesh.visible;
    if (!t0.active) {
      this.m.makeTranslation(0, -45, 0);
      t0.mesh.matrix.copy(this.m);
      t0.mesh.matrixWorldNeedsUpdate = true;
      t0.mesh.visible = true;
    }
    return () => {
      if (!t0.active) t0.mesh.visible = prevVis;
    };
  }
  spawn(from: THREE.Vector3, to: THREE.Vector3, speed: number, startOffset = 0) {
    const t = this.pool.find((p) => !p.active);
    if (!t) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 2.5) return;
    t.active = true;
    t.ox = from.x; t.oy = from.y; t.oz = from.z;
    t.dx = dx / d; t.dy = dy / d; t.dz = dz / d;
    t.dist = d;
    t.head = startOffset;
    t.speed = speed;
    t.len = Math.min(9, d * 0.35);
    t.mesh.visible = true;
  }
  update(dt: number, cam: THREE.Camera) {
    for (const t of this.pool) {
      if (!t.active) continue;
      t.head += t.speed * dt;
      const tail = Math.max(0, t.head - t.len);
      if (tail >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      const head = Math.min(t.head, t.dist);
      const len = Math.max(0.05, head - tail);
      const mid = (head + tail) / 2;
      const px = t.ox + t.dx * mid, py = t.oy + t.dy * mid, pz = t.oz + t.dz * mid;
      this.bx.set(t.dx, t.dy, t.dz);
      this.bz.set(cam.position.x - px, cam.position.y - py, cam.position.z - pz);
      // keep a minimum on-screen thickness at range
      const w = 0.03 + this.bz.length() * 0.0012;
      this.by.crossVectors(this.bz, this.bx).normalize();
      this.bz.crossVectors(this.bx, this.by);
      this.m.makeBasis(this.bx, this.by, this.bz);
      this.m.scale(SC.set(len, w, 1));
      this.m.setPosition(px, py, pz);
      t.mesh.matrix.copy(this.m);
      t.mesh.matrixWorldNeedsUpdate = true;
    }
  }
}
const SC = new THREE.Vector3();

// ---------------------------------------------------------------------------
// 3A Boss & Special Combat 3D Volumetric VFX Pools (Telegraph Rings,
// Expanding Plasma Shockwaves, Volumetric Plasma/Railgun Beams)
// ---------------------------------------------------------------------------
interface TelegraphSlot {
  active: boolean;
  t: number;
  dur: number;
  mesh: THREE.Mesh;
  u: {
    uProg: { value: number };
    uTime: { value: number };
    uColor: { value: THREE.Color };
    uAlpha: { value: number };
  };
}

interface ShockwaveSlot {
  active: boolean;
  t: number;
  dur: number;
  maxRadius: number;
  mesh: THREE.Mesh;
  u: {
    uProg: { value: number };
    uTime: { value: number };
    uColor: { value: THREE.Color };
    uAlpha: { value: number };
  };
}

interface PlasmaBeamSlot {
  active: boolean;
  t: number;
  dur: number;
  baseWidth: number;
  mesh: THREE.Mesh;
  u: {
    uStart: { value: THREE.Vector3 };
    uEnd: { value: THREE.Vector3 };
    uWidth: { value: number };
    uTime: { value: number };
    uAlpha: { value: number };
    uColor: { value: THREE.Color };
  };
}

interface PillarSlot {
  active: boolean;
  t: number;
  dur: number;
  baseRadius: number;
  height: number;
  mesh: THREE.Mesh;
  u: {
    uTime: { value: number };
    uProg: { value: number };
    uAlpha: { value: number };
    uColor: { value: THREE.Color };
    uCore: { value: THREE.Color };
  };
}

interface LightningSlot {
  active: boolean;
  t: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  jitter: number;
  line: THREE.Line;
  posAttr: THREE.BufferAttribute;
  mat: THREE.LineBasicMaterial;
}

export type HazardStyle = 'lava' | 'emp' | 'void';
interface HazardSlot {
  active: boolean;
  t: number;
  dur: number;
  mesh: THREE.Mesh;
  u: {
    uTime: { value: number };
    uAlpha: { value: number };
    uStyle: { value: number };
    uColor: { value: THREE.Color };
    uColor2: { value: THREE.Color };
  };
}

export type FloatingOrbStyle = 'sun' | 'mine' | 'pylon' | 'holo';
interface FloatingOrbSlot {
  active: boolean;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  style: FloatingOrbStyle;
  basePos: THREE.Vector3;
  group: THREE.Group;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  coreMat: THREE.ShaderMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

interface LaserWallSlot {
  active: boolean;
  t: number;
  dur: number;
  mesh: THREE.Mesh;
  u: {
    uTime: { value: number };
    uAlpha: { value: number };
    uColor: { value: THREE.Color };
  };
}

function makeBeamQuadGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(4 * 3);
  const corners = new Float32Array([
    -1, 0, 0,
     1, 0, 0,
     1, 1, 0,
    -1, 1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

class BossVfxPool {
  group = new THREE.Group();
  private telegraphs: TelegraphSlot[] = [];
  private shockwaves: ShockwaveSlot[] = [];
  private beams: PlasmaBeamSlot[] = [];
  private pillars: PillarSlot[] = [];
  private lightnings: LightningSlot[] = [];
  private hazards: HazardSlot[] = [];
  private orbs: FloatingOrbSlot[] = [];
  private laserWalls: LaserWallSlot[] = [];
  private elapsed = 0;

  constructor() {
    const planeGeo = new THREE.PlaneGeometry(2, 2);
    planeGeo.rotateX(-Math.PI / 2);
    const beamGeo = makeBeamQuadGeo();

    // 1. Tactical Ground Telegraph Danger Zone Pool (12 slots)
    for (let i = 0; i < 12; i++) {
      const u = {
        uProg: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff3822) },
        uAlpha: { value: 1 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vPos;
          void main() {
            vPos = position.xz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uProg;
          uniform float uTime;
          uniform vec3 uColor;
          uniform float uAlpha;
          varying vec2 vPos;

          void main() {
            float r = length(vPos);
            if (r > 1.0) discard;
            float ang = atan(vPos.y, vPos.x);

            // Crisp outer boundary ring + rotating 8-segment tactical brackets
            float outerRing = smoothstep(0.045, 0.012, abs(r - 0.95));
            float tickAngle = mod(ang + uTime * 1.9 + 6.28318, 0.785398) / 0.785398;
            float ticks = step(0.18, tickAngle) * step(tickAngle, 0.82) * smoothstep(0.055, 0.015, abs(r - 0.84));

            // Sweeping inner countdown fill disc + razor leading wave
            float fillMask = smoothstep(uProg + 0.04, max(0.0, uProg - 0.03), r);
            float wave = smoothstep(0.05, 0.008, abs(r - uProg));
            float centerDot = smoothstep(0.11, 0.03, r) * 0.55;

            // Tactical crosshair spokes
            float crossX = smoothstep(0.024, 0.006, abs(vPos.x)) * step(0.14, r) * step(r, 0.74);
            float crossY = smoothstep(0.024, 0.006, abs(vPos.y)) * step(0.14, r) * step(r, 0.74);
            float spokes = (crossX + crossY) * 0.35;

            // High-urgency final-quarter strobe
            float urgent = uProg > 0.72 ? (0.75 + 0.35 * sin(uTime * 34.0)) : 1.0;
            float edgeFade = smoothstep(1.0, 0.96, r);
            float intensity = (outerRing * 1.15 + ticks * 0.72 + wave * 1.25 + fillMask * (0.22 + 0.34 * uProg) + centerDot + spokes) * urgent * edgeFade;

            vec3 hotCore = vec3(1.0, 0.96, 0.90);
            vec3 col = mix(uColor, hotCore, clamp(wave * 0.7 + outerRing * 0.35, 0.0, 0.85));
            gl_FragColor = vec4(col * 1.45, clamp(intensity * uAlpha, 0.0, 0.95));
          }
        `,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      mesh.userData.noAo = true;
      this.group.add(mesh);
      this.telegraphs.push({ active: false, t: 0, dur: 1, mesh, u });
    }

    // 2. Expanding Plasma Shockwave Ring Pool (10 slots)
    for (let i = 0; i < 10; i++) {
      const u = {
        uProg: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x38d8ff) },
        uAlpha: { value: 1 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vPos;
          void main() {
            vPos = position.xz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uProg;
          uniform float uTime;
          uniform vec3 uColor;
          uniform float uAlpha;
          varying vec2 vPos;

          void main() {
            float r = length(vPos);
            if (r > 1.0) discard;
            float ang = atan(vPos.y, vPos.x);

            // Fast nonlinear expansion front with hot leading edge + plasma energy trail
            float front = 0.08 + 0.88 * (1.0 - pow(1.0 - uProg, 2.2));
            float dist = front - r;
            float lead = exp(-pow(abs(dist) / 0.045, 2.0));
            float trail = step(0.0, dist) * exp(-dist * 7.5);
            float ripple = 0.78 + 0.22 * sin(ang * 12.0 + uTime * 14.0 - r * 18.0);
            float innerEcho = exp(-pow(abs(r - front * 0.68) / 0.032, 2.0)) * 0.42;

            float fade = (1.0 - uProg) * smoothstep(1.0, 0.88, r);
            float a = (lead * 1.35 + trail * 0.68 * ripple + innerEcho) * fade * uAlpha;
            vec3 col = mix(uColor, vec3(1.0, 0.98, 0.94), clamp(lead * 0.75, 0.0, 0.9));
            gl_FragColor = vec4(col * 1.8, clamp(a, 0.0, 1.0));
          }
        `,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      mesh.userData.noAo = true;
      this.group.add(mesh);
      this.shockwaves.push({ active: false, t: 0, dur: 0.65, maxRadius: 8, mesh, u });
    }

    // 3. Camera-Billboarding Volumetric Plasma / Railgun Beam Pool (8 slots)
    for (let i = 0; i < 8; i++) {
      const u = {
        uStart: { value: new THREE.Vector3() },
        uEnd: { value: new THREE.Vector3() },
        uWidth: { value: 0.25 },
        uTime: { value: 0 },
        uAlpha: { value: 1 },
        uColor: { value: new THREE.Color(0x38e0ff) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          precision highp float;
          uniform vec3 uStart;
          uniform vec3 uEnd;
          uniform float uWidth;
          attribute vec3 aCorner;
          varying vec2 vUv;
          varying float vDist;
          varying float vLen;

          void main() {
            float t = aCorner.y;
            vec3 axisP = mix(uStart, uEnd, t);
            vec3 bVec = uEnd - uStart;
            float bLen = max(0.1, length(bVec));
            vec3 bDir = bVec / bLen;
            vec3 toCam = cameraPosition - axisP;
            vec3 side = cross(bDir, toCam);
            float sLen = length(side);
            side = sLen > 1e-4 ? side / sLen : vec3(0.0, 1.0, 0.0);

            float camDist = length(toCam);
            float halfW = uWidth * (1.0 + clamp(camDist * 0.012, 0.0, 0.9));
            vec3 worldP = axisP + side * aCorner.x * halfW;

            vUv = vec2(aCorner.x * 0.5 + 0.5, t);
            vDist = t * bLen;
            vLen = bLen;
            gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform float uAlpha;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying float vDist;
          varying float vLen;

          void main() {
            float r = abs(vUv.x * 2.0 - 1.0);
            float core = exp(-r * r * 26.0);
            float mid = exp(-r * r * 6.5);
            float halo = exp(-r * r * 2.0) * (1.0 - r * r);
            float surge = 0.78 + 0.22 * sin(vDist * 3.8 - uTime * 42.0) * cos(vDist * 1.7 + uTime * 24.0);
            float ends = smoothstep(0.0, 0.25, vDist) * smoothstep(vLen, max(0.0, vLen - 0.15), vDist);

            vec3 col = vec3(1.0, 0.97, 0.94) * core * 2.2 + uColor * (mid * 1.45 + halo * 0.72);
            float a = (core * 1.0 + mid * 0.65 + halo * 0.32) * surge * ends * uAlpha;
            gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
          }
        `,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 13;
      mesh.userData.noAo = true;
      this.group.add(mesh);
      this.beams.push({ active: false, t: 0, dur: 0.45, baseWidth: 0.25, mesh, u });
    }

    // 4. Volumetric Orbital Energy Pillar / Volcanic Flame Geyser Pool (14 slots)
    const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    pillarGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 14; i++) {
      const u = {
        uTime: { value: 0 },
        uProg: { value: 0 },
        uAlpha: { value: 1 },
        uColor: { value: new THREE.Color(0xff5218) },
        uCore: { value: new THREE.Color(0xfff6d8) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormalW;
          varying vec3 vViewDir;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vViewDir = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform float uProg;
          uniform float uAlpha;
          uniform vec3 uColor;
          uniform vec3 uCore;
          varying vec2 vUv;
          varying vec3 vNormalW;
          varying vec3 vViewDir;

          void main() {
            float ndv = abs(dot(normalize(vNormalW), normalize(vViewDir)));
            float core = pow(clamp(ndv, 0.0, 1.0), 1.45);
            float rim = pow(1.0 - clamp(ndv, 0.0, 1.0), 2.1);

            // Twin counter-rotating helical plasma/fire bands racing vertically
            float ang = vUv.x * 6.28318;
            float helix1 = 0.5 + 0.5 * sin(ang * 3.0 - vUv.y * 16.0 + uTime * 16.0);
            float helix2 = 0.5 + 0.5 * sin(ang * 5.0 + vUv.y * 11.0 - uTime * 22.0);
            float surge = 0.55 + 0.45 * pow(helix1 * 0.65 + helix2 * 0.35, 1.4);

            // Soft ground-anchor & sky-tip fade
            float vFade = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
            vec3 col = mix(uColor * 1.05, uCore * 1.45, clamp(core * 0.55 + helix1 * 0.25, 0.0, 0.85));
            float a = (core * 0.58 + rim * 0.52) * surge * vFade * uAlpha;
            gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
          }
        `,
      });
      const mesh = new THREE.Mesh(pillarGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 14;
      mesh.userData.noAo = true;
      this.group.add(mesh);
      this.pillars.push({ active: false, t: 0, dur: 1, baseRadius: 1, height: 12, mesh, u });
    }

    // 5. Jagged 3D Electric Lightning Arc Pool (16 slots)
    const BOLT_SEGS = 14;
    for (let i = 0; i < 16; i++) {
      const g = new THREE.BufferGeometry();
      const arr = new Float32Array((BOLT_SEGS + 1) * 3);
      const posAttr = new THREE.BufferAttribute(arr, 3);
      g.setAttribute('position', posAttr);
      const mat = new THREE.LineBasicMaterial({
        color: 0x62f2ff,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(g, mat);
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 15;
      line.userData.noAo = true;
      this.group.add(line);
      this.lightnings.push({
        active: false, t: 0, dur: 0.25,
        from: new THREE.Vector3(), to: new THREE.Vector3(), jitter: 0.5,
        line, posAttr, mat,
      });
    }

    // 6. Persistent Animated Ground Hazard Pool (Lava / EMP Grid / Cyber Void, 16 slots)
    for (let i = 0; i < 16; i++) {
      const u = {
        uTime: { value: 0 },
        uAlpha: { value: 1 },
        uStyle: { value: 0 },
        uColor: { value: new THREE.Color(0xff5212) },
        uColor2: { value: new THREE.Color(0xffcf38) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vPos;
          void main() {
            vPos = position.xz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform float uAlpha;
          uniform float uStyle;
          uniform vec3 uColor;
          uniform vec3 uColor2;
          varying vec2 vPos;

          float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }

          void main() {
            float r = length(vPos);
            if (r > 1.0) discard;
            float edge = smoothstep(1.0, 0.58, r);
            float ang = atan(vPos.y, vPos.x);

            float pattern = 0.0;
            float hot = 0.0;
            if (uStyle < 0.5) {
              // LAVA: bubbling volcanic magma veins & incandescent cracks
              vec2 p = vPos * 4.5;
              float w1 = sin(p.x * 2.1 + uTime * 2.0 + sin(p.y * 2.4 - uTime * 1.5));
              float w2 = cos(p.y * 2.7 - uTime * 1.8 + cos(p.x * 1.9 + uTime * 1.2));
              float crack = smoothstep(0.32, 0.88, abs(w1 * w2));
              float boil = 0.5 + 0.5 * sin(r * 14.0 - uTime * 5.0 + ang * 3.0);
              pattern = (0.38 + 0.62 * crack) * (0.75 + 0.25 * boil);
              hot = smoothstep(0.68, 0.96, crack);
            } else if (uStyle < 1.5) {
              // EMP: crackling electric concentric arcs & radial spokes
              float grid = max(
                smoothstep(0.08, 0.015, abs(fract(vPos.x * 4.0) - 0.5)),
                smoothstep(0.08, 0.015, abs(fract(vPos.y * 4.0) - 0.5))
              );
              float ring = smoothstep(0.06, 0.01, abs(fract(r * 2.5 - uTime * 1.35) - 0.5));
              float zap = 0.65 + 0.35 * sin(ang * 10.0 + uTime * 28.0);
              pattern = (grid * 0.48 + ring * 0.95) * zap;
              hot = ring * 0.85;
            } else {
              // VOID: holographic neon-violet cyber matrix + glitch scan
              float gX = smoothstep(0.07, 0.015, abs(fract(vPos.x * 5.0 + uTime * 0.4) - 0.5));
              float gY = smoothstep(0.07, 0.015, abs(fract(vPos.y * 5.0 - uTime * 0.4) - 0.5));
              float scan = smoothstep(0.08, 0.01, abs(fract(r * 1.8 + uTime * 1.1) - 0.5));
              float hexRing = smoothstep(0.04, 0.01, abs(r - 0.88));
              pattern = max(gX, gY) * 0.58 + scan * 0.72 + hexRing * 1.1;
              hot = scan * 0.75 + hexRing * 0.5;
            }
            vec3 col = mix(uColor * 1.5, uColor2 * 2.2, clamp(hot, 0.0, 1.0));
            gl_FragColor = vec4(col, clamp(pattern * edge * uAlpha * 0.88, 0.0, 0.96));
          }
        `,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      mesh.userData.noAo = true;
      this.group.add(mesh);
      this.hazards.push({ active: false, t: 0, dur: 4, mesh, u });
    }

    // 7. 3D Volumetric Floating Constructs (Helios Sun / Singularity Mines / EMP Pylons / Holo Clones, 14 slots)
    const octGeo = new THREE.OctahedronGeometry(1, 2);
    const torusGeo = new THREE.TorusGeometry(1.45, 0.06, 8, 28);
    for (let i = 0; i < 14; i++) {
      const grp = new THREE.Group();
      const coreMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(0xffb824) },
          uAlpha: { value: 1 },
          uHolo: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec3 vNormalW;
          varying vec3 vViewDir;
          varying vec3 vLocal;
          void main() {
            vLocal = position;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vViewDir = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform vec3 uColor;
          uniform float uAlpha;
          uniform float uHolo;
          varying vec3 vNormalW;
          varying vec3 vViewDir;
          varying vec3 vLocal;
          void main() {
            float ndv = abs(dot(normalize(vNormalW), normalize(vViewDir)));
            float fres = pow(1.0 - clamp(ndv, 0.0, 1.0), 1.85);
            float pulse = 0.78 + 0.22 * sin(vLocal.y * 12.0 - uTime * 14.0);
            float scan = uHolo > 0.5 ? (0.45 + 0.55 * step(0.35, fract(vLocal.y * 9.0 - uTime * 3.5))) : 1.0;
            vec3 col = mix(uColor * 1.18, vec3(1.0, 0.96, 0.88) * 1.55, clamp(pow(ndv, 2.2) * (1.0 - uHolo * 0.5) + fres * 0.35, 0.0, 0.82));
            float a = (0.38 + fres * 0.72) * pulse * scan * uAlpha;
            gl_FragColor = vec4(col, clamp(a, 0.0, 0.88));
          }
        `,
      });
      const core = new THREE.Mesh(octGeo, coreMat);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(torusGeo, ringMat);
      grp.add(core, ring);
      grp.visible = false;
      grp.frustumCulled = false;
      grp.renderOrder = 15;
      grp.userData.noAo = true;
      core.userData.noAo = true;
      ring.userData.noAo = true;
      this.group.add(grp);
      this.orbs.push({
        active: false, t: 0, dur: 3, r0: 0.5, r1: 0.5, style: 'mine',
        basePos: new THREE.Vector3(), group: grp, core, ring, coreMat, ringMat,
      });
    }

    // 8. Sweeping Holographic Cyber Laser-Grid Curtain Pool (6 slots — Viper Phase 2 Ultimate!)
    const wallGeo = new THREE.PlaneGeometry(1, 1);
    wallGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 6; i++) {
      const u = {
        uTime: { value: 0 },
        uAlpha: { value: 1 },
        uColor: { value: new THREE.Color(0xd938ff) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform float uAlpha;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            // Razor horizontal laser emitter beams + subtle translucent energy curtain
            float beams = smoothstep(0.11, 0.02, abs(fract(vUv.y * 5.0 - uTime * 1.4) - 0.5));
            float edges = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
            float topBot = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
            float shimmer = 0.72 + 0.28 * sin(vUv.x * 28.0 + uTime * 22.0);
            vec3 col = mix(uColor * 1.6, vec3(0.75, 1.0, 1.0) * 2.4, beams);
            float a = (0.18 + beams * 0.95) * shimmer * edges * topBot * uAlpha;
            gl_FragColor = vec4(col, clamp(a, 0.0, 0.96));
          }
        `,
      });
      const mesh = new THREE.Mesh(wallGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 14;
      mesh.userData.noAo = true;
      this.group.add(mesh);
      this.laserWalls.push({ active: false, t: 0, dur: 1.5, mesh, u });
    }
  }

  prewarm(): () => void {
    const t0 = this.telegraphs[0];
    const s0 = this.shockwaves[0];
    const b0 = this.beams[0];
    const p0 = this.pillars[0];
    const l0 = this.lightnings[0];
    const h0 = this.hazards[0];
    const o0 = this.orbs[0];
    const w0 = this.laserWalls[0];
    t0.mesh.position.set(0, -45, 0); t0.mesh.scale.setScalar(1); t0.u.uAlpha.value = 0.001; t0.mesh.visible = true;
    s0.mesh.position.set(0, -45, 0); s0.mesh.scale.setScalar(1); s0.u.uAlpha.value = 0.001; s0.mesh.visible = true;
    b0.u.uStart.value.set(0, -45, 0); b0.u.uEnd.value.set(0, -45, 2); b0.u.uAlpha.value = 0.001; b0.mesh.visible = true;
    p0.mesh.position.set(0, -45, 0); p0.mesh.scale.set(1, 2, 1); p0.u.uAlpha.value = 0.001; p0.mesh.visible = true;
    l0.from.set(0, -45, 0); l0.to.set(1, -45, 0); l0.jitter = 0.1; l0.mat.opacity = 0.001; this.rebuildLightningVerts(l0); l0.line.visible = true;
    h0.mesh.position.set(0, -45, 0); h0.mesh.scale.setScalar(1); h0.u.uAlpha.value = 0.001; h0.mesh.visible = true;
    o0.group.position.set(0, -45, 0); o0.coreMat.uniforms.uAlpha.value = 0.001; o0.group.visible = true;
    w0.mesh.position.set(0, -45, 0); w0.mesh.scale.set(2, 2, 1); w0.u.uAlpha.value = 0.001; w0.mesh.visible = true;

    return () => {
      if (!t0.active) t0.mesh.visible = false;
      if (!s0.active) s0.mesh.visible = false;
      if (!b0.active) b0.mesh.visible = false;
      if (!p0.active) p0.mesh.visible = false;
      if (!l0.active) l0.line.visible = false;
      if (!h0.active) h0.mesh.visible = false;
      if (!o0.active) o0.group.visible = false;
      if (!w0.active) w0.mesh.visible = false;
    };
  }

  spawnTelegraph(pos: THREE.Vector3, radius: number, dur: number, colorHex: number) {
    const slot = this.telegraphs.find((s) => !s.active) ?? this.telegraphs[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.15, dur);
    slot.mesh.position.set(pos.x, pos.y + 0.07, pos.z);
    slot.mesh.scale.setScalar(radius);
    slot.u.uColor.value.setHex(colorHex);
    slot.u.uProg.value = 0;
    slot.u.uAlpha.value = 1;
    slot.mesh.visible = true;
  }

  spawnShockwave(pos: THREE.Vector3, maxRadius: number, dur: number, colorHex: number) {
    const slot = this.shockwaves.find((s) => !s.active) ?? this.shockwaves[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.2, dur);
    slot.maxRadius = maxRadius;
    slot.mesh.position.set(pos.x, pos.y + 0.14, pos.z);
    slot.mesh.scale.setScalar(maxRadius);
    slot.u.uColor.value.setHex(colorHex);
    slot.u.uProg.value = 0;
    slot.u.uAlpha.value = 1;
    slot.mesh.visible = true;
  }

  spawnBeam(from: THREE.Vector3, to: THREE.Vector3, colorHex: number, width: number, dur: number) {
    const slot = this.beams.find((s) => !s.active) ?? this.beams[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.12, dur);
    slot.baseWidth = width;
    slot.u.uStart.value.copy(from);
    slot.u.uEnd.value.copy(to);
    slot.u.uWidth.value = width;
    slot.u.uColor.value.setHex(colorHex);
    slot.u.uAlpha.value = 1;
    slot.mesh.visible = true;
  }

  spawnPillar(pos: THREE.Vector3, radius: number, height: number, dur: number, colorHex: number, coreHex = 0xfff8e6) {
    const slot = this.pillars.find((s) => !s.active) ?? this.pillars[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.2, dur);
    slot.baseRadius = radius;
    slot.height = height;
    slot.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    slot.mesh.scale.set(radius, height, radius);
    slot.u.uColor.value.setHex(colorHex);
    slot.u.uCore.value.setHex(coreHex);
    slot.u.uProg.value = 0;
    slot.u.uAlpha.value = 1;
    slot.mesh.visible = true;
  }

  spawnLightning(from: THREE.Vector3, to: THREE.Vector3, colorHex: number, dur: number, jitter = 0.45) {
    const slot = this.lightnings.find((s) => !s.active) ?? this.lightnings[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.08, dur);
    slot.from.copy(from);
    slot.to.copy(to);
    slot.jitter = jitter;
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 1;
    this.rebuildLightningVerts(slot);
    slot.line.visible = true;
  }

  private rebuildLightningVerts(s: LightningSlot) {
    const arr = s.posAttr.array as Float32Array;
    const count = arr.length / 3;
    for (let i = 0; i < count; i++) {
      const f = i / (count - 1);
      const env = Math.sin(f * Math.PI);
      const j = s.jitter * env;
      arr[i * 3] = s.from.x + (s.to.x - s.from.x) * f + (Math.random() - 0.5) * 2 * j;
      arr[i * 3 + 1] = s.from.y + (s.to.y - s.from.y) * f + (Math.random() - 0.5) * 2 * j;
      arr[i * 3 + 2] = s.from.z + (s.to.z - s.from.z) * f + (Math.random() - 0.5) * 2 * j;
    }
    s.posAttr.needsUpdate = true;
  }

  spawnHazard(pos: THREE.Vector3, radius: number, dur: number, style: HazardStyle) {
    const slot = this.hazards.find((s) => !s.active) ?? this.hazards[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.5, dur);
    slot.mesh.position.set(pos.x, pos.y + 0.08, pos.z);
    slot.mesh.scale.setScalar(radius);
    if (style === 'lava') {
      slot.u.uStyle.value = 0;
      slot.u.uColor.value.setHex(0xff4408);
      slot.u.uColor2.value.setHex(0xffd43b);
    } else if (style === 'emp') {
      slot.u.uStyle.value = 1;
      slot.u.uColor.value.setHex(0x18c4ff);
      slot.u.uColor2.value.setHex(0xd8fbff);
    } else {
      slot.u.uStyle.value = 2;
      slot.u.uColor.value.setHex(0x9e3bff);
      slot.u.uColor2.value.setHex(0x38f2ff);
    }
    slot.u.uAlpha.value = 1;
    slot.mesh.visible = true;
  }

  spawnOrb(pos: THREE.Vector3, radius: number, dur: number, colorHex: number, style: FloatingOrbStyle, growTo?: number) {
    const slot = this.orbs.find((s) => !s.active) ?? this.orbs[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.25, dur);
    slot.r0 = radius;
    slot.r1 = growTo ?? radius;
    slot.style = style;
    slot.basePos.copy(pos);
    slot.group.position.copy(pos);
    slot.coreMat.uniforms.uColor.value.setHex(colorHex);
    slot.coreMat.uniforms.uHolo.value = style === 'holo' ? 1 : 0;
    slot.coreMat.uniforms.uAlpha.value = 1;
    slot.ringMat.color.setHex(style === 'sun' ? 0xffe478 : colorHex);
    slot.ringMat.opacity = 0.85;
    if (style === 'holo') {
      slot.core.scale.set(0.45, 1.35, 0.45);
      slot.ring.scale.set(0.85, 0.85, 0.85);
    } else if (style === 'pylon') {
      slot.core.scale.set(0.52, 1.15, 0.52);
      slot.ring.scale.set(1.0, 1.0, 1.0);
    } else {
      slot.core.scale.set(1, 1, 1);
      slot.ring.scale.set(1, 1, 1);
    }
    slot.group.scale.setScalar(radius);
    slot.group.visible = true;
  }

  spawnLaserWall(from: THREE.Vector3, to: THREE.Vector3, height: number, dur: number, colorHex: number) {
    const slot = this.laserWalls.find((s) => !s.active) ?? this.laserWalls[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = Math.max(0.2, dur);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.max(0.5, Math.hypot(dx, dz));
    slot.mesh.position.set((from.x + to.x) * 0.5, Math.min(from.y, to.y) + 0.06, (from.z + to.z) * 0.5);
    slot.mesh.rotation.set(0, Math.atan2(dx, dz) + Math.PI * 0.5, 0);
    slot.mesh.scale.set(len, height, 1);
    slot.u.uColor.value.setHex(colorHex);
    slot.u.uAlpha.value = 1;
    slot.mesh.visible = true;
  }

  update(dt: number) {
    this.elapsed += dt;
    for (const s of this.telegraphs) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.u.uProg.value = p;
        s.u.uTime.value = this.elapsed;
        s.u.uAlpha.value = Math.min(1, s.t / 0.14);
      }
    }
    for (const s of this.shockwaves) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.u.uProg.value = p;
        s.u.uTime.value = this.elapsed;
        s.mesh.position.y += dt * 0.32;
      }
    }
    for (const s of this.beams) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.u.uTime.value = this.elapsed;
        const fade = Math.pow(1 - p, 1.35);
        s.u.uAlpha.value = fade;
        s.u.uWidth.value = s.baseWidth * (0.42 + 0.58 * fade);
      }
    }
    for (const s of this.pillars) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.u.uTime.value = this.elapsed;
        s.u.uProg.value = p;
        const env = Math.min(1, p / 0.12) * Math.pow(1 - Math.max(0, (p - 0.35) / 0.65), 1.35);
        s.u.uAlpha.value = env;
        const rad = s.baseRadius * (0.72 + 0.45 * Math.sin(Math.min(1, p * 2.4) * Math.PI * 0.5));
        s.mesh.scale.set(rad, s.height, rad);
      }
    }
    for (const s of this.lightnings) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.line.visible = false;
      } else {
        this.rebuildLightningVerts(s);
        s.mat.opacity = Math.pow(1 - p, 0.85);
      }
    }
    for (const s of this.hazards) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.u.uTime.value = this.elapsed;
        const fadeIn = Math.min(1, s.t / 0.35);
        const fadeOut = p > 0.78 ? Math.max(0, 1 - (p - 0.78) / 0.22) : 1;
        s.u.uAlpha.value = fadeIn * fadeOut;
      }
    }
    for (const s of this.orbs) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.group.visible = false;
      } else {
        const rad = s.r0 + (s.r1 - s.r0) * p;
        s.group.scale.setScalar(rad);
        const bob = s.style === 'holo' ? 0 : Math.sin(this.elapsed * 4.5 + s.basePos.x) * 0.14;
        s.group.position.set(s.basePos.x, s.basePos.y + bob, s.basePos.z);
        s.core.rotation.y += dt * (s.style === 'mine' ? 3.2 : 1.6);
        s.ring.rotation.x = this.elapsed * 2.4;
        s.ring.rotation.y = this.elapsed * 3.1;
        s.coreMat.uniforms.uTime.value = this.elapsed;
        const fade = p > 0.85 ? Math.max(0, 1 - (p - 0.85) / 0.15) : Math.min(1, s.t / 0.18);
        s.coreMat.uniforms.uAlpha.value = fade;
        s.ringMat.opacity = fade * 0.88;
      }
    }
    for (const s of this.laserWalls) {
      if (!s.active) continue;
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        s.u.uTime.value = this.elapsed;
        s.u.uAlpha.value = Math.min(1, s.t / 0.12) * Math.pow(1 - Math.max(0, (p - 0.65) / 0.35), 1.4);
      }
    }
  }

  clear() {
    for (const s of this.telegraphs) { s.active = false; s.mesh.visible = false; }
    for (const s of this.shockwaves) { s.active = false; s.mesh.visible = false; }
    for (const s of this.beams) { s.active = false; s.mesh.visible = false; }
    for (const s of this.pillars) { s.active = false; s.mesh.visible = false; }
    for (const s of this.lightnings) { s.active = false; s.line.visible = false; }
    for (const s of this.hazards) { s.active = false; s.mesh.visible = false; }
    for (const s of this.orbs) { s.active = false; s.group.visible = false; }
    for (const s of this.laserWalls) { s.active = false; s.mesh.visible = false; }
  }
}

// ---------------------------------------------------------------------------
// High-level effect recipes
// ---------------------------------------------------------------------------
export class Effects {
  particles: Particles;
  private holes: DecalPool;
  private scorch: DecalPool;
  private tracers = new Tracers();
  private bossVfx = new BossVfxPool();
  private fireAcc = 0;
  private plumeAcc = 0;
  private dustAcc = 0;
  fires: THREE.Vector3[] = [];
  plumes: THREE.Vector3[] = [];
  private fireLights: THREE.PointLight[] = [];

  constructor(private worldScene: THREE.Scene, fxScene: THREE.Scene, fog: THREE.FogExp2) {
    this.particles = new Particles(fog);
    fxScene.add(this.particles.mesh);
    fxScene.add(this.tracers.group);
    fxScene.add(this.bossVfx.group);
    this.holes = new DecalPool(makeBulletHoleTexture(), 160, 15, 2.5);
    this.scorch = new DecalPool(makeScorchTexture(), 48, 18, 3.0);
    worldScene.add(this.holes.mesh, this.scorch.mesh);
  }

  /** Pre-compile Boss 3D VFX, Particles, Tracers & Decal fade shaders during level loading so combat causes 0ms hitch. */
  prewarmBossVfx(): () => void {
    const cleanBoss = this.bossVfx.prewarm();
    const cleanHoles = this.holes.prewarm();
    const cleanScorch = this.scorch.prewarm();
    const cleanParticles = this.particles.prewarm();
    const cleanTracers = this.tracers.prewarm();
    return () => {
      cleanBoss();
      cleanHoles();
      cleanScorch();
      cleanParticles();
      cleanTracers();
    };
  }

  setAmbient(fires: THREE.Vector3[], plumes: THREE.Vector3[], addVirtualLight?: (l: THREE.PointLight) => void) {
    this.fires = fires;
    this.plumes = plumes;
    for (const f of fires) {
      const l = new THREE.PointLight(0xff8a3a, 30, 16, 2);
      l.position.copy(f).setY(f.y + 0.6);
      if (addVirtualLight) addVirtualLight(l);
      else this.worldScene.add(l);
      this.fireLights.push(l);
    }
    // pre-warm the long-lived smoke columns
    for (let i = 0; i < 45; i++) {
      this.emitPlumes(0.7);
      this.emitFires(0.25);
      this.particles.update(0.7);
    }
  }

  /** Drop the previous level's fires / plumes (level switch). */
  clearAmbient() {
    for (const l of this.fireLights) this.worldScene.remove(l);
    this.fireLights.length = 0;
    this.fires = [];
    this.plumes = [];
    this.particles.clear();
    this.bossVfx.clear();
  }

  reset() {
    this.holes.clear();
    this.scorch.clear();
    this.bossVfx.clear();
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, speed = 320, startOffset = 0) {
    this.tracers.spawn(from, to, speed, startOffset);
  }

  private emitFires(dt: number) {
    const p = this.particles;
    this.fireAcc += dt;
    const n = Math.floor(this.fireAcc / 0.03);
    this.fireAcc -= n * 0.03;
    for (const f of this.fires) {
      for (let i = 0; i < Math.min(n, 12); i++) {
        p.emit(f.x + rand(-0.55, 0.55), f.y + rand(-0.2, 0.2), f.z + rand(-0.45, 0.45), rand(-0.3, 0.3), rand(1.4, 3.2), rand(-0.3, 0.3),
          rand(0.45, 0.9), rand(0.6, 1.0), 0.2, 2.6, 1.7, 1.0, 0.9, FLAME, 0.8, 0.4, 0, rand(-2, 2), 0.15);
        if (Math.random() < 0.3) {
          p.emit(f.x + rand(-0.4, 0.4), f.y + 0.9, f.z + rand(-0.4, 0.4), rand(-0.2, 0.6), rand(1.8, 3.0), rand(-0.2, 0.4),
            rand(6, 10), 0.9, rand(5, 8), 0.12, 0.108, 0.1, 0.46, SMOKE, 0, 0.25, -0.25, rand(-0.4, 0.4), 0.12);
        }
        if (Math.random() < 0.18) {
          p.emit(f.x + rand(-0.4, 0.4), f.y + 0.4, f.z + rand(-0.4, 0.4), rand(-1, 1.5), rand(2, 5), rand(-1, 1),
            rand(0.8, 1.8), 0.05, 0.02, 8, 3.5, 1.0, 1, GLOW, 1, 0.6, -0.6);
        }
      }
    }
  }

  private emitPlumes(dt: number) {
    const p = this.particles;
    this.plumeAcc += dt;
    while (this.plumeAcc > 0.9) {
      this.plumeAcc -= 0.9;
      for (const f of this.plumes) {
        p.emit(f.x + rand(-2.5, 2.5), 3, f.z + rand(-2.5, 2.5), rand(-0.8, 0.8), rand(3.5, 5.5), rand(-0.8, 0.8), rand(18, 24), 7, rand(26, 40),
          0.07, 0.065, 0.06, 0.34, SMOKE, 0, 0.04, 0, rand(-0.05, 0.05), 0.08);
      }
    }
  }

  update(dt: number, cam: THREE.Camera) {
    this.emitFires(dt);
    this.emitPlumes(dt);
    // ambient dust motes + drifting ground haze near the camera
    const p = this.particles;
    this.dustAcc += dt;
    while (this.dustAcc > 0.045) {
      this.dustAcc -= 0.045;
      const a = Math.random() * Math.PI * 2;
      const d = 1.5 + Math.random() * 11;
      p.emit(cam.position.x + Math.cos(a) * d, Math.max(0.2, cam.position.y + rand(-1.6, 2.2)), cam.position.z + Math.sin(a) * d,
        rand(0.2, 0.9), rand(-0.1, 0.15), rand(0, 0.5), rand(3, 6), 0.022, 0.03, 1.6, 1.25, 0.85, 0.5, GLOW, 1, 0, 0, 0, 0.3);
      if (Math.random() < 0.1) {
        p.emit(cam.position.x + Math.cos(a) * (d + 6), rand(0.3, 1.2), cam.position.z + Math.sin(a) * (d + 6),
          rand(1.2, 2.2), 0.05, rand(0.3, 0.9), rand(5, 8), 3, rand(6, 9), 0.85, 0.72, 0.54, 0.05, SMOKE, 0, 0, 0, rand(-0.1, 0.1), 0.35);
      }
    }
    for (const l of this.fireLights) l.intensity = 26 + Math.sin(performance.now() * 0.021) * 6 + Math.random() * 8;
    p.update(dt);
    this.tracers.update(dt, cam);
    this.bossVfx.update(dt);
    this.holes.update(dt);
    this.scorch.update(dt);
  }

  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1) {
    const p = this.particles;
    p.emit(pos.x, pos.y, pos.z, dir.x * 2, dir.y * 2, dir.z * 2, 0.05, 0.5 * scale, 0.9 * scale, 7, 4.2, 1.6, 1, GLOW, 1, 0, 0);
    p.emit(pos.x + dir.x * 0.15, pos.y + dir.y * 0.15, pos.z + dir.z * 0.15, dir.x * 6, dir.y * 6, dir.z * 6, 0.045, 0.3 * scale, 0.7 * scale, 5, 3, 1.2, 1, FLAME, 1, 0, 0);
    for (let i = 0; i < 2; i++) {
      p.emit(pos.x, pos.y, pos.z, dir.x * rand(1.5, 4) + rand(-0.3, 0.3), dir.y * rand(1.5, 4) + rand(0, 0.5), dir.z * rand(1.5, 4) + rand(-0.3, 0.3),
        rand(0.5, 1.0), 0.12, rand(0.5, 0.8) * scale, 0.5, 0.48, 0.45, 0.22, SMOKE, 0, 3, -0.3, rand(-1, 1), 0.1);
    }
  }

  /** Lingering smoke wisp from the player's barrel (very subtle). */
  barrelSmoke(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.particles.emit(pos.x, pos.y, pos.z, dir.x * rand(1, 3), dir.y * rand(1, 3) + 0.3, dir.z * rand(1, 3), rand(0.5, 0.9), 0.06, rand(0.35, 0.6), 0.55, 0.53, 0.5, 0.14, SMOKE, 0, 3.5, -0.5, rand(-1, 1), 0.1);
  }

  casing(pos: THREE.Vector3, vel: THREE.Vector3) {
    this.particles.emit(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, 1.6, 0.028, 0.028, 1.1, 0.78, 0.3, 1, DEBRIS, 0, 0.1, 9.8, rand(-25, 25), 0.01);
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, decal = true) {
    const p = this.particles;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const x = point.x + nx * 0.03, y = point.y + ny * 0.03, z = point.z + nz * 0.03;
    let dr = 0.6, dg = 0.57, db = 0.52, puffs = 4, chips = 6, sparks = 0;
    let cr = 0.5, cg = 0.48, cb = 0.45;
    switch (surface) {
      case 'sand': dr = 0.78; dg = 0.64; db = 0.46; puffs = 6; chips = 3; cr = 0.6; cg = 0.5; cb = 0.36; break;
      case 'asphalt': dr = 0.34; dg = 0.33; db = 0.32; cr = 0.16; cg = 0.16; cb = 0.16; break;
      case 'metal': puffs = 1; chips = 0; sparks = 9; dr = 0.4; dg = 0.4; db = 0.4; break;
      case 'wood': dr = 0.62; dg = 0.52; db = 0.38; puffs = 2; chips = 7; cr = 0.6; cg = 0.46; cb = 0.28; break;
      case 'fabric': dr = 0.6; dg = 0.58; db = 0.5; puffs = 2; chips = 1; break;
      default: sparks = Math.random() < 0.3 ? 2 : 0;
    }
    for (let i = 0; i < puffs; i++) {
      const s = rand(1, 3.4);
      p.emit(x, y, z, nx * s + rand(-0.8, 0.8), ny * s + rand(-0.4, 1.0), nz * s + rand(-0.8, 0.8), rand(0.5, 1.1), 0.1, rand(0.5, 1.0), dr, dg, db, 0.42, SMOKE, 0, 3.2, -0.2, rand(-1, 1), 0.06);
    }
    for (let i = 0; i < chips; i++) {
      const s = rand(1.5, 6);
      p.emit(x, y, z, nx * s + rand(-2, 2), ny * s + rand(-1, 3), nz * s + rand(-2, 2), rand(0.5, 1.0), rand(0.018, 0.05), 0.015, cr, cg, cb, 1, DEBRIS, 0, 0.3, 9.8, rand(-20, 20), 0.01);
    }
    for (let i = 0; i < sparks; i++) {
      const s = rand(3, 11);
      p.emit(x, y, z, nx * s + rand(-4, 4), ny * s + rand(-3, 4), nz * s + rand(-4, 4), rand(0.12, 0.4), 0.035, 0.012, 9, 5, 1.6, 1, GLOW, 1, 1.5, 7);
    }
    if (surface === 'metal') p.emit(x, y, z, 0, 0, 0, 0.06, 0.25, 0.4, 6, 4, 2, 1, GLOW, 1, 0, 0);
    if (decal) {
      if (surface === 'metal') this.holes.add(point, normal, rand(0.07, 0.1), 0.35, 0.35, 0.36);
      else if (surface === 'sand') this.holes.add(point, normal, rand(0.12, 0.18), 0.5, 0.42, 0.3);
      else if (surface === 'wood') this.holes.add(point, normal, rand(0.07, 0.1), 0.75, 0.6, 0.42);
      else if (surface !== 'fabric') this.holes.add(point, normal, rand(0.11, 0.17), 0.95, 0.93, 0.9);
    }
  }

  blood(point: THREE.Vector3, dir: THREE.Vector3, heavy = false) {
    const p = this.particles;
    const n = heavy ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const s = rand(0.5, 3);
      p.emit(point.x, point.y, point.z, dir.x * s + rand(-1, 1), dir.y * s + rand(-0.5, 1.2), dir.z * s + rand(-1, 1), rand(0.25, 0.5), 0.06, rand(0.3, 0.6) * (heavy ? 1.4 : 1), 0.3, 0.012, 0.01, 0.75, SMOKE, 0, 4, 1.5, rand(-2, 2), 0.05);
    }
    for (let i = 0; i < n; i++) {
      const s = rand(1, 5);
      p.emit(point.x, point.y, point.z, dir.x * s + rand(-1.5, 1.5), dir.y * s + rand(0, 2.5), dir.z * s + rand(-1.5, 1.5), rand(0.4, 0.8), rand(0.015, 0.04), 0.01, 0.28, 0.01, 0.008, 1, DEBRIS, 0, 0.5, 9.8, rand(-10, 10), 0.01);
    }
  }

  bloodPool(point: THREE.Vector3) {
    UP.set(0, 1, 0);
    this.scorch.add(TMP.set(point.x, Math.max(0.0, point.y), point.z), UP, rand(0.7, 1.2), 0.16, 0.008, 0.006, 18, 3.0);
  }

  explosion(pos: THREE.Vector3, scale = 1) {
    const p = this.particles;
    const x = pos.x, y = pos.y + 0.3, z = pos.z;
    p.emit(x, y + 0.5, z, 0, 0, 0, 0.2, 6 * scale, 14 * scale, 9, 6.5, 3.2, 1, GLOW, 1, 0, 0);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3;
      const s = rand(2, 9) * scale;
      p.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1.5, Math.sin(a) * Math.cos(e) * s, rand(0.45, 1.0), 1.3 * scale, rand(3, 5) * scale, 3.6, 2.1, 1.0, 1, FLAME, 0.75, 2.2, -1.2, rand(-2, 2), 0.04);
    }
    // column of thrown dirt
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.5, 2.5) * scale;
      p.emit(x, y, z, Math.cos(a) * s, rand(7, 15) * scale, Math.sin(a) * s, rand(1.6, 2.8), 1.0 * scale, rand(3, 4.5) * scale, 0.5, 0.41, 0.3, 0.6, SMOKE, 0, 2.4, 3.5, rand(-0.6, 0.6), 0.05);
    }
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.4;
      const s = rand(1.5, 6) * scale;
      p.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1, Math.sin(a) * Math.cos(e) * s, rand(2.6, 5), 1.4 * scale, rand(4.5, 7) * scale, 0.1, 0.092, 0.085, 0.85, SMOKE, 0, 1.4, -0.5, rand(-0.6, 0.6), 0.05);
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand(-0.2, 0.2);
      const s = rand(7, 11) * scale;
      p.emit(x, 0.3, z, Math.cos(a) * s, rand(0.2, 1.2), Math.sin(a) * s, rand(1.2, 2.2), 0.8, rand(3.5, 5) * scale, 0.74, 0.62, 0.46, 0.45, SMOKE, 0, 3, 0, rand(-0.5, 0.5), 0.08);
    }
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.5;
      const s = rand(6, 20) * scale;
      p.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, rand(0.5, 1.5), 0.07, 0.02, 9, 4.5, 1.2, 1, GLOW, 1, 0.6, 9.8);
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.4;
      const s = rand(4, 13) * scale;
      p.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 3, Math.sin(a) * Math.cos(e) * s, rand(1.4, 2.6), rand(0.06, 0.2), 0.05, 0.12, 0.11, 0.1, 1, DEBRIS, 0, 0.2, 9.8, rand(-12, 12), 0.01);
    }
    UP.set(0, 1, 0);
    this.scorch.add(TMP.set(x, Math.max(0, pos.y), z), UP, rand(4.5, 6) * scale, 0.02, 0.018, 0.016, 24, 3.5);
  }

  /** Glowing 3D tactical ground telegraph ring so players can read & dodge Boss AoE strikes. */
  telegraphRing(pos: THREE.Vector3, radius: number, dur = 1.15, colorHex = 0xff3b24) {
    this.bossVfx.spawnTelegraph(pos, radius, dur, colorHex);
  }

  /** Expanding 3D plasma shockwave ring across the floor + luminous rising energy sparks. */
  shockwaveRing(pos: THREE.Vector3, maxRadius = 10, dur = 0.72, colorHex = 0x38d8ff) {
    this.bossVfx.spawnShockwave(pos, maxRadius, dur, colorHex);
    TMP_COL.setHex(colorHex);
    const cr = TMP_COL.r * 5.5 + 1.5;
    const cg = TMP_COL.g * 5.5 + 1.5;
    const cb = TMP_COL.b * 5.5 + 1.5;
    const p = this.particles;
    const ringSparks = Math.min(28, Math.max(14, Math.round(maxRadius * 2.2)));
    for (let i = 0; i < ringSparks; i++) {
      const a = (i / ringSparks) * Math.PI * 2 + rand(-0.12, 0.12);
      const spd = (maxRadius / Math.max(0.35, dur)) * rand(0.55, 0.92);
      p.emit(
        pos.x + Math.cos(a) * 0.6,
        pos.y + 0.25,
        pos.z + Math.sin(a) * 0.6,
        Math.cos(a) * spd,
        rand(1.4, 4.2),
        Math.sin(a) * spd,
        rand(0.45, 0.95),
        rand(0.08, 0.14),
        0.02,
        cr, cg, cb, 1,
        GLOW, 1, 1.4, 3.5,
      );
    }
  }

  /** Dazzling volumetric plasma / railgun lance with ionized trail particles + impact flare. */
  plasmaBeam(from: THREE.Vector3, to: THREE.Vector3, colorHex = 0x38e0ff, width = 0.28, dur = 0.48) {
    this.bossVfx.spawnBeam(from, to, colorHex, width, dur);
    TMP_COL.setHex(colorHex);
    const cr = TMP_COL.r * 7 + 2.2;
    const cg = TMP_COL.g * 7 + 2.2;
    const cb = TMP_COL.b * 7 + 2.2;
    const p = this.particles;
    const dist = from.distanceTo(to);
    const steps = Math.min(22, Math.max(6, Math.floor(dist / 2.2)));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const bx = from.x + (to.x - from.x) * f + rand(-0.18, 0.18);
      const by = from.y + (to.y - from.y) * f + rand(-0.18, 0.18);
      const bz = from.z + (to.z - from.z) * f + rand(-0.18, 0.18);
      p.emit(
        bx, by, bz,
        rand(-1.8, 1.8), rand(0.4, 2.6), rand(-1.8, 1.8),
        rand(0.28, 0.65), rand(0.07, 0.14), 0.015,
        cr, cg, cb, 1,
        GLOW, 1, 2.2, 0.8,
      );
    }
    // Blinding muzzle + impact ionized cores
    p.emit(from.x, from.y, from.z, 0, 0, 0, 0.18, 1.2, 2.4, cr, cg, cb, 1, GLOW, 1, 0, 0);
    p.emit(to.x, to.y, to.z, 0, 0, 0, 0.26, 1.8, 4.2, cr, cg, cb, 1, GLOW, 1, 0, 0);
  }

  /** Vivid colored energy burst for shield shatter, blink-dash, and Phase II overdrive ignition. */
  energyBurst(pos: THREE.Vector3, colorHex = 0x38d8ff, scale = 1) {
    TMP_COL.setHex(colorHex);
    const cr = TMP_COL.r * 7.5 + 1.8;
    const cg = TMP_COL.g * 7.5 + 1.8;
    const cb = TMP_COL.b * 7.5 + 1.8;
    const p = this.particles;
    const x = pos.x, y = pos.y + 0.9, z = pos.z;
    p.emit(x, y, z, 0, 0, 0, 0.24, 2.4 * scale, 6.2 * scale, cr, cg, cb, 1, GLOW, 1, 0, 0);
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = rand(-0.3, 1.15);
      const s = rand(3.5, 12.5) * scale;
      p.emit(
        x, y, z,
        Math.cos(a) * Math.cos(e) * s,
        Math.sin(e) * s + 1.5,
        Math.sin(a) * Math.cos(e) * s,
        rand(0.35, 0.95),
        rand(0.06, 0.14) * scale,
        0.015,
        cr, cg, cb, 1,
        GLOW, 1, 1.5, 4.2,
      );
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2);
      const s = rand(2.5, 5.5) * scale;
      p.emit(
        x, y, z,
        Math.cos(a) * s, rand(0.6, 2.4), Math.sin(a) * s,
        rand(0.4, 0.75), 0.45 * scale, 1.8 * scale,
        TMP_COL.r * 2.5 + 0.5, TMP_COL.g * 2.5 + 0.5, TMP_COL.b * 2.5 + 0.5, 0.85,
        FLAME, 0.8, 2.4, -0.8, rand(-2, 2), 0.1,
      );
    }
  }

  /** Towering sky-to-deck volumetric orbital plasma lance OR volcanic magma geyser pillar. */
  orbitalPillar(pos: THREE.Vector3, radius = 1.6, height = 22, dur = 1.25, colorHex = 0xff3b24, coreHex = 0xfff8e6) {
    this.bossVfx.spawnPillar(pos, radius, height, dur, colorHex, coreHex);
    TMP_COL.setHex(colorHex);
    const cr = TMP_COL.r * 6.5 + 1.8;
    const cg = TMP_COL.g * 6.5 + 1.8;
    const cb = TMP_COL.b * 6.5 + 1.8;
    const p = this.particles;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.2, radius * 1.15);
      p.emit(
        pos.x + Math.cos(a) * r,
        pos.y + rand(0.2, Math.min(height * 0.4, 5.5)),
        pos.z + Math.sin(a) * r,
        Math.cos(a) * rand(1.5, 5.5),
        rand(4.5, 11.5),
        Math.sin(a) * rand(1.5, 5.5),
        rand(0.45, 0.95),
        rand(0.08, 0.16),
        0.02,
        cr, cg, cb, 1,
        GLOW, 1, 1.1, 1.5,
      );
    }
  }

  /** Jagged 3D electric lightning bolt between two world points (EMP Tesla storm & Phase II arcs). */
  lightningArc(from: THREE.Vector3, to: THREE.Vector3, colorHex = 0x52f2ff, dur = 0.24, jitter = 0.45) {
    this.bossVfx.spawnLightning(from, to, colorHex, dur, jitter);
    // Secondary faint companion fork for high-voltage visual density
    this.bossVfx.spawnLightning(from, to, 0xe8ffff, dur * 0.72, jitter * 1.35);
  }

  /** Persistent animated ground hazard zone ('lava' | 'emp' | 'void'). */
  hazardZone(pos: THREE.Vector3, radius = 3.2, dur = 5.5, style: HazardStyle = 'lava') {
    this.bossVfx.spawnHazard(pos, radius, dur, style);
  }

  /** 3D hovering glowing construct ('sun' | 'mine' | 'pylon' | 'holo'). */
  floatingOrb(pos: THREE.Vector3, radius = 0.55, dur = 4.0, colorHex = 0x38e8ff, style: FloatingOrbStyle = 'mine', growTo?: number) {
    this.bossVfx.spawnOrb(pos, radius, dur, colorHex, style, growTo);
  }

  /** Translucent sweeping neon holographic cyber laser-grid wall (Viper Phase II Ultimate). */
  laserWall(from: THREE.Vector3, to: THREE.Vector3, height = 2.6, dur = 1.6, colorHex = 0xd938ff) {
    this.bossVfx.spawnLaserWall(from, to, height, dur, colorHex);
  }

  /** Continuous ambient plasma/ember aura rising around active Bosses (intensifies in Phase II). */
  bossAura(pos: THREE.Vector3, colorHex: number, phase2: boolean) {
    TMP_COL.setHex(colorHex);
    const cr = TMP_COL.r * 5.8 + 1.4;
    const cg = TMP_COL.g * 5.8 + 1.4;
    const cb = TMP_COL.b * 5.8 + 1.4;
    const p = this.particles;
    const count = phase2 ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.45, phase2 ? 1.35 : 0.95);
      p.emit(
        pos.x + Math.cos(a) * r,
        pos.y + rand(0.15, 1.85),
        pos.z + Math.sin(a) * r,
        Math.cos(a + 1.4) * rand(0.4, 1.4),
        rand(1.4, phase2 ? 3.8 : 2.5),
        Math.sin(a + 1.4) * rand(0.4, 1.4),
        rand(0.45, 0.95),
        rand(0.055, phase2 ? 0.115 : 0.085),
        0.015,
        cr, cg, cb, 0.95,
        GLOW, 1, 0.8, -0.6,
      );
    }
    if (phase2 && Math.random() < 0.45) {
      const a = Math.random() * Math.PI * 2;
      p.emit(
        pos.x + Math.cos(a) * rand(0.2, 0.8),
        pos.y + rand(0.8, 1.7),
        pos.z + Math.sin(a) * rand(0.2, 0.8),
        rand(-0.5, 0.5), rand(1.6, 3.0), rand(-0.5, 0.5),
        rand(0.35, 0.65), 0.35, 0.95,
        TMP_COL.r * 2.4 + 0.4, TMP_COL.g * 2.4 + 0.4, TMP_COL.b * 2.4 + 0.4, 0.65,
        FLAME, 0.75, 1.8, -0.9, rand(-2, 2), 0.12,
      );
    }
  }
}
const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const TMP_COL = new THREE.Color();
