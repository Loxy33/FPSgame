import * as THREE from 'three';
import { assets } from '../render/assets';

/**
 * First-person arms: the real (scanned-style) arm and glove geometry of the soldier model,
 * re-rigged at load time. The source rig has no finger bones, so each hand is analysed
 * geometrically (fingers are found as the connected pieces beyond the knuckle line) and
 * given three curl joints per finger. Arms are posed per frame from a wrist target, the
 * direction the fingers point, the direction the palm faces and an elbow hint.
 */
export interface HandPose {
  /** Wrist position (gun space). */
  pos: THREE.Vector3;
  /** Direction the straight fingers would point. */
  fwd: THREE.Vector3;
  /** Direction the palm faces. */
  palm: THREE.Vector3;
  /** Point the elbow lies towards. */
  elbow: THREE.Vector3;
  /** Curl of thumb, index, middle, ring, pinky (radians at the first joint). */
  curl: number[];
}

export function handPose(pos: number[], fwd: number[], palm: number[], elbow: number[], curl: number[]): HandPose {
  return {
    pos: new THREE.Vector3().fromArray(pos), fwd: new THREE.Vector3().fromArray(fwd), palm: new THREE.Vector3().fromArray(palm),
    elbow: new THREE.Vector3().fromArray(elbow), curl,
  };
}

const JOINT_K = [1, 1.1, 0.6];
const BONES_PER_ARM = 18;
const H = 0.008;

interface Finger { p: THREE.Vector3[]; axis: THREE.Vector3 }
interface Arm {
  base: number;
  pE: THREE.Vector3; pW: THREE.Vector3;
  f0: THREE.Vector3;
  q0inv: THREE.Quaternion;
  /** thumb, index, middle, ring, pinky */
  fingers: Finger[];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class FpArms {
  mesh: THREE.SkinnedMesh;
  /** Diagnostics from the hand analysis (finger count, lengths). */
  info: string[] = [];
  /** Last wrist position (viewmodel root space) and hand length per side, for pose debugging. */
  lastWrist: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
  handLen: number[] = [0, 0];
  private bones: THREE.Bone[] = [];
  private arms: Arm[] = [];
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private F = new THREE.Vector3();
  private N = new THREE.Vector3();
  private L = new THREE.Vector3();
  private wrist = new THREE.Vector3();
  private m1 = new THREE.Matrix4();
  private mh = new THREE.Matrix4();
  private mc = new THREE.Matrix4();
  private qh = new THREE.Quaternion();
  private qf = new THREE.Quaternion();
  private qt = new THREE.Quaternion();

  constructor(root: THREE.Group) {
    const src = assets.gltf.arms.scene;
    src.updateMatrixWorld(true);
    let sm!: THREE.SkinnedMesh;
    src.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) sm = o as THREE.SkinnedMesh; });
    const g0 = sm.geometry;
    const n = g0.attributes.position.count;
    const old = sm.skeleton.bones;

    // --- bake the geometry into rest (model) space, in metres ---
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const A = new THREE.Matrix4().copy(sm.matrixWorld).multiply(sm.bindMatrixInverse).multiply(old[0].matrixWorld).multiply(sm.skeleton.boneInverses[0]).multiply(sm.bindMatrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g0.attributes.position, i);
      sm.applyBoneTransform(i, v);
      v.applyMatrix4(sm.matrixWorld);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      v.fromBufferAttribute(g0.attributes.normal, i).transformDirection(A);
      nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
    }
    const P = (i: number, out: THREE.Vector3) => out.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);

    // --- collapse the original weights onto upper arm / forearm / hand per side ---
    const role = old.map((b) => {
      const m = /^(Left|Right)(.*)$/.exec(b.name);
      if (!m) return [-1, 0];
      return [m[1] === 'Left' ? 0 : 1, m[2] === 'ForeArm' ? 1 : m[2] === 'Hand' ? 2 : 0];
    });
    const side = new Uint8Array(n);
    const w3 = new Float32Array(n * 3);
    const si = g0.attributes.skinIndex, sw = g0.attributes.skinWeight;
    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (let k = 0; k < 4; k++) {
        const [s] = role[si.getComponent(i, k)];
        if (s === 0) l += sw.getComponent(i, k); else if (s === 1) r += sw.getComponent(i, k);
      }
      const s = r > l ? 1 : 0;
      side[i] = s;
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const [bs, br] = role[si.getComponent(i, k)];
        const wt = sw.getComponent(i, k);
        w3[i * 3 + (bs === s ? br : 0)] += wt;
        sum += wt;
      }
      if (sum > 0) for (let k = 0; k < 3; k++) w3[i * 3 + k] /= sum; else w3[i * 3] = 1;
    }

    // welded vertex ids (the mesh is split along UV seams)
    const wid = new Int32Array(n);
    const keys = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
      let id = keys.get(k);
      if (id === undefined) keys.set(k, (id = keys.size));
      wid[i] = id;
    }
    const parent = new Int32Array(keys.size);
    const find = (a: number): number => {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    const index = g0.index!;

    const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
    /** finger slot (0 thumb .. 4 pinky) + axial coordinate per vertex */
    const slot = new Int8Array(n).fill(-1);
    const tAx = new Float32Array(n);
    const fLen = [new Float32Array(5), new Float32Array(5)];

    const bonePos = (name: string) => old.find((b) => b.name === name)!.getWorldPosition(new THREE.Vector3());
    for (let s = 0; s < 2; s++) {
      const pre = s === 0 ? 'Left' : 'Right';
      const pE = bonePos(pre + 'ForeArm'), pW = bonePos(pre + 'Hand');
      const inHand = new Uint8Array(n);
      const hv: number[] = [];
      let far = 0, tipI = -1;
      for (let i = 0; i < n; i++) {
        if (side[i] !== s || w3[i * 3 + 2] < 0.5) continue;
        inHand[i] = 1;
        hv.push(i);
        const d = P(i, v).distanceTo(pW);
        if (d > far) { far = d; tipI = i; }
      }
      const f = P(tipI, new THREE.Vector3()).sub(pW).normalize();
      const sv = new Float32Array(n);
      let Lh = 0;
      for (const i of hv) { sv[i] = P(i, v).sub(pW).dot(f); Lh = Math.max(Lh, sv[i]); }
      const tris: number[] = [];
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
        if (inHand[a] && inHand[b] && inHand[c]) tris.push(a, b, c);
      }
      const comps = (ok: (i: number) => boolean) => {
        for (const i of hv) parent[wid[i]] = wid[i];
        for (let t = 0; t < tris.length; t += 3) {
          const a = tris[t], b = tris[t + 1], c = tris[t + 2];
          if (!(ok(a) && ok(b) && ok(c))) continue;
          const ra = find(wid[a]), rb = find(wid[b]);
          if (ra !== rb) parent[ra] = rb;
          const rc = find(wid[c]), rb2 = find(wid[b]);
          if (rc !== rb2) parent[rc] = rb2;
        }
        const map = new Map<number, { verts: number[]; maxS: number }>();
        for (const i of hv) {
          if (!ok(i)) continue;
          const r = find(wid[i]);
          let c = map.get(r);
          if (!c) map.set(r, (c = { verts: [], maxS: -1 }));
          c.verts.push(i);
          c.maxS = Math.max(c.maxS, sv[i]);
        }
        return [...map.values()].filter((c) => c.verts.length >= 60);
      };
      // sweep the knuckle line down the hand until fingers start merging at the webs
      let best: { verts: number[]; maxS: number }[] = [];
      let sk = 0, prevK = 0;
      for (let q = 0.78; q >= 0.3; q -= 0.01) {
        const cs = comps((i) => sv[i] > q * Lh);
        if (cs.length < prevK) break;
        if (cs.length > 0) { best = cs; sk = q * Lh; }
        prevK = cs.length;
      }
      best.sort((a, b) => b.maxS - a.maxS);
      const fingerComps = best.slice(0, 4);
      const centroid = (list: number[], ok: (i: number) => boolean) => {
        const c = new THREE.Vector3();
        let k = 0;
        for (const i of list) if (ok(i)) { c.add(P(i, v)); k++; }
        return c.multiplyScalar(1 / Math.max(1, k));
      };
      const frames = fingerComps.map((c) => {
        const root = centroid(c.verts, (i) => sv[i] < sk + 0.008);
        const tip = centroid(c.verts, (i) => sv[i] > c.maxS - 0.008);
        return { c, root, axis: tip.clone().sub(root).normalize() };
      });
      // lateral axis across the knuckles
      const l = new THREE.Vector3(1, 0, 0);
      let dmax = 0;
      for (const a of frames) for (const b of frames) {
        const d = a.root.distanceTo(b.root);
        if (d > dmax) { dmax = d; l.subVectors(a.root, b.root); }
      }
      l.addScaledVector(f, -l.dot(f)).normalize();
      const lam = (p: THREE.Vector3) => p.clone().sub(pW).dot(l);
      const inFinger = new Uint8Array(n);
      for (const fr of frames) for (const i of fr.c.verts) inFinger[i] = 1;
      let lo = Infinity, hi = -Infinity, flo = Infinity, fhi = -Infinity;
      for (const i of hv) {
        const x = lam(P(i, v));
        if (inFinger[i]) { flo = Math.min(flo, x); fhi = Math.max(fhi, x); }
        else if (sv[i] > 0.1 * Lh) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      }
      const ts = hi - fhi > flo - lo ? 1 : -1;
      const T = l.clone().multiplyScalar(ts);
      frames.sort((a, b) => ts * (lam(b.root) - lam(a.root)));
      const Nin = (s === 1 ? new THREE.Vector3().crossVectors(T, f) : new THREE.Vector3().crossVectors(f, T)).normalize();

      // thumb: the piece that sticks out beyond the index finger
      const edge = ts > 0 ? fhi : -flo;
      const tc = comps((i) => !inFinger[i] && ts * lam(P(i, v)) > edge + 0.004).sort((a, b) => b.verts.length - a.verts.length)[0];
      // The glove's fingers are fused below that line: extend each finger down to the anatomical
      // web by handing the remaining band to the nearest finger axis.
      const web = 0.54 * Lh;
      if (sk > web) {
        const mean = new THREE.Vector3();
        for (const fr of frames) if (fr.c.maxS - sk > 0.03) mean.add(fr.axis);
        if (mean.lengthSq() < 1e-6) mean.copy(f);
        mean.normalize();
        for (const fr of frames) {
          if (fr.c.maxS - sk <= 0.03) fr.axis.copy(mean);
          fr.root.addScaledVector(fr.axis, -(sk - web) / Math.max(0.5, fr.axis.dot(f)));
        }
        const inThumb = new Uint8Array(n);
        if (tc) for (const i of tc.verts) inThumb[i] = 1;
        const rel = new THREE.Vector3();
        for (const i of hv) {
          if (inFinger[i] || inThumb[i] || sv[i] < web - 0.004 || sv[i] > sk + 0.002) continue;
          let bd = 0.017, bf = -1;
          for (let k = 0; k < frames.length; k++) {
            rel.copy(P(i, v)).sub(frames[k].root);
            const d = rel.addScaledVector(frames[k].axis, -rel.dot(frames[k].axis)).length();
            if (d < bd) { bd = d; bf = k; }
          }
          if (bf >= 0) { frames[bf].c.verts.push(i); inFinger[i] = 1; }
        }
      }
      const fingers: Finger[] = [];
      const assign = (k: number, verts: number[], root: THREE.Vector3, axis: THREE.Vector3, curlAxis: THREE.Vector3, cuts: number[]) => {
        let len = 0;
        for (const i of verts) { tAx[i] = P(i, v).sub(root).dot(axis); len = Math.max(len, tAx[i]); slot[i] = k; }
        fLen[s][k] = len;
        fingers[k] = { p: cuts.map((c, j) => root.clone().addScaledVector(axis, j === 0 ? H : c * len)), axis: curlAxis };
      };
      if (tc) {
        const c0 = centroid(tc.verts, () => true);
        let fd = 0, ti = tc.verts[0];
        for (const i of tc.verts) { const d = P(i, v).distanceTo(pW); if (d > fd) { fd = d; ti = i; } }
        const a0 = P(ti, new THREE.Vector3()).sub(c0).normalize();
        let pmin = Infinity, pmax = -Infinity;
        const pr = (i: number) => P(i, v).sub(c0).dot(a0);
        for (const i of tc.verts) { const x = pr(i); pmin = Math.min(pmin, x); pmax = Math.max(pmax, x); }
        const root = centroid(tc.verts, (i) => pr(i) < pmin + 0.008);
        const tip = centroid(tc.verts, (i) => pr(i) > pmax - 0.006);
        const axis = tip.sub(root).normalize();
        const g = Nin.clone().multiplyScalar(0.6).addScaledVector(T, -0.8).normalize();
        assign(0, tc.verts, root, axis, new THREE.Vector3().crossVectors(axis, g).normalize(), [0, 0.5, 0.8]);
      } else {
        fingers[0] = { p: [pW.clone(), pW.clone(), pW.clone()], axis: new THREE.Vector3(1, 0, 0) };
      }
      for (let k = 0; k < 4; k++) {
        const fr = frames[Math.min(k, frames.length - 1)];
        if (k < frames.length) assign(k + 1, fr.c.verts, fr.root, fr.axis, new THREE.Vector3().crossVectors(fr.axis, Nin).normalize(), [0, 0.42, 0.72]);
        else fingers[k + 1] = fingers[k];
      }
      this.info.push(`${pre}: hand ${hv.length}v len ${Lh.toFixed(3)} knuckle ${(sk / Lh).toFixed(2)} fingers ${frames.length} [${frames.map((fr, k) => fLen[s][k + 1].toFixed(3)).join(',')}] thumb ${tc ? tc.verts.length + 'v ' + fLen[s][0].toFixed(3) : 'none'} side ${ts}`);

      this.handLen[s] = Lh;
      const m0 = new THREE.Matrix4().makeBasis(f, Nin, new THREE.Vector3().crossVectors(f, Nin));
      this.arms.push({
        base: s * BONES_PER_ARM, pE, pW,
        f0: pW.clone().sub(pE).normalize(),
        q0inv: new THREE.Quaternion().setFromRotationMatrix(m0).invert(),
        fingers,
      });
    }

    // --- final weights: upper / fore / hand + finger joints ---
    const inf: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const base = side[i] * BONES_PER_ARM;
      inf.length = 0;
      let wh = w3[i * 3 + 2];
      inf.push([base, w3[i * 3]], [base + 1, w3[i * 3 + 1]]);
      const k = slot[i];
      if (k >= 0 && wh > 0) {
        const len = fLen[side[i]][k], t = tAx[i];
        const cuts = k === 0 ? [0, 0.5, 0.8] : [0, 0.42, 0.72];
        const b1 = smooth(0, 2 * H, t), b2 = smooth(cuts[1] * len - H, cuts[1] * len + H, t), b3 = smooth(cuts[2] * len - H, cuts[2] * len + H, t);
        const jb = base + 3 + k * 3;
        inf.push([jb, wh * b1 * (1 - b2)], [jb + 1, wh * b1 * b2 * (1 - b3)], [jb + 2, wh * b1 * b2 * b3]);
        wh *= 1 - b1;
      }
      inf.push([base + 2, wh], [base + 2, 0]);
      inf.sort((a, b) => b[1] - a[1]);
      let sum = 0;
      for (let q = 0; q < 4; q++) sum += inf[q][1];
      for (let q = 0; q < 4; q++) { skinIndex[i * 4 + q] = inf[q][0]; skinWeight[i * 4 + q] = inf[q][1] / sum; }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', g0.attributes.uv);
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    geo.setIndex(index);

    const rig = new THREE.Group();
    const inverses: THREE.Matrix4[] = [];
    for (let i = 0; i < BONES_PER_ARM * 2; i++) {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      rig.add(b);
      this.bones.push(b);
      inverses.push(new THREE.Matrix4());
    }
    const mat = (sm.material as THREE.MeshStandardMaterial).clone();
    mat.metalness = 0;
    mat.side = THREE.FrontSide;
    mat.envMapIntensity = 0.8;
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.bind(new THREE.Skeleton(this.bones, inverses), new THREE.Matrix4());
    root.add(rig, this.mesh);
  }

  /** out = T(target) · R(q) · T(-pivot) */
  private setD(out: THREE.Matrix4, target: THREE.Vector3, q: THREE.Quaternion, pivot: THREE.Vector3) {
    out.makeRotationFromQuaternion(q);
    this.v3.copy(pivot).applyQuaternion(q);
    return out.setPosition(target.x - this.v3.x, target.y - this.v3.y, target.z - this.v3.z);
  }

  /** Pose one arm (0 = left, 1 = right). `toRoot` maps the pose's space into the viewmodel root. */
  pose(side: number, toRoot: THREE.Matrix4, p: HandPose, curlScale = 1) {
    const A = this.arms[side];
    const { F, N, L, wrist } = this;
    wrist.copy(p.pos).applyMatrix4(toRoot);
    this.lastWrist[side].copy(wrist);
    F.copy(p.fwd).transformDirection(toRoot);
    N.copy(p.palm).transformDirection(toRoot);
    N.addScaledVector(F, -N.dot(F)).normalize();
    L.crossVectors(F, N);
    this.qh.setFromRotationMatrix(this.m1.makeBasis(F, N, L)).multiply(A.q0inv);
    const hand = this.setD(this.mh, wrist, this.qh, A.pW);
    this.bones[A.base + 2].matrix.copy(hand);

    // forearm: carries the hand's twist, swings to point at the elbow hint
    const dh = this.v1.copy(A.f0).applyQuaternion(this.qh);
    const d = this.v2.copy(p.elbow).applyMatrix4(toRoot).subVectors(wrist, this.v2).normalize();
    this.qf.setFromUnitVectors(dh, d).multiply(this.qh);
    const fore = this.bones[A.base + 1].matrix;
    this.setD(fore, wrist, this.qf, A.pW);
    // the upper arm stays off screen: it rigidly continues the forearm so the elbow never shears
    this.bones[A.base].matrix.copy(fore);

    for (let k = 0; k < 5; k++) {
      const fg = A.fingers[k];
      const c = (p.curl[k] ?? 0) * curlScale;
      this.m1.copy(hand);
      for (let j = 0; j < 3; j++) {
        this.qt.setFromAxisAngle(fg.axis, c * JOINT_K[j]);
        this.m1.multiply(this.setD(this.mc, fg.p[j], this.qt, fg.p[j]));
        this.bones[A.base + 3 + k * 3 + j].matrix.copy(this.m1);
      }
    }
  }
}
