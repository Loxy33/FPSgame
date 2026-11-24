import * as THREE from 'three';

/** UV tiles per metre for hard-surface / cloth detail maps. */
export const UVK = 9;

/**
 * Box with chamfered edges. Chamfer vertices reuse the adjacent face normals
 * (face-weighted normals), so flats stay flat while edges catch a soft highlight.
 * Indexed, with position / normal / uv attributes (box-projected UVs in metres * UVK).
 */
export function chamferBox(w: number, h: number, d: number, chamfer = -1): THREE.BufferGeometry {
  const H = [w / 2, h / 2, d / 2];
  const m = Math.min(w, h, d);
  const c = Math.min(chamfer >= 0 ? chamfer : Math.min(Math.max(m * 0.2, 0.0005), 0.0026), m * 0.42);
  const pos = new Float32Array(72), nor = new Float32Array(72), uv = new Float32Array(48);
  for (let corner = 0; corner < 8; corner++) {
    for (let a = 0; a < 3; a++) {
      const i = corner * 3 + a;
      for (let k = 0; k < 3; k++) {
        const s = corner & (1 << k) ? 1 : -1;
        pos[i * 3 + k] = s * (k === a ? H[k] : H[k] - c);
        nor[i * 3 + k] = k === a ? s : 0;
      }
      uv[i * 2] = pos[i * 3 + ((a + 1) % 3)] * UVK;
      uv[i * 2 + 1] = pos[i * 3 + ((a + 2) % 3)] * UVK;
    }
  }
  const idx: number[] = [];
  const tri = (i0: number, i1: number, i2: number, ox: number, oy: number, oz: number) => {
    const ax = pos[i1 * 3] - pos[i0 * 3], ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
    const bx = pos[i2 * 3] - pos[i0 * 3], by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
    const dot = (ay * bz - az * by) * ox + (az * bx - ax * bz) * oy + (ax * by - ay * bx) * oz;
    if (dot >= 0) idx.push(i0, i1, i2);
    else idx.push(i0, i2, i1);
  };
  const o = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const u1 = (a + 1) % 3, v1 = (a + 2) % 3;
    // faces
    for (let sg = 0; sg < 2; sg++) {
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([su, sv]) => ((sg << a) | (su << u1) | (sv << v1)) * 3 + a);
      o[0] = o[1] = o[2] = 0;
      o[a] = sg ? 1 : -1;
      tri(q[0], q[1], q[2], o[0], o[1], o[2]);
      tri(q[0], q[2], q[3], o[0], o[1], o[2]);
    }
    // edges running along axis `a`, between the faces of the two other axes
    for (let su = 0; su < 2; su++) {
      for (let sv = 0; sv < 2; sv++) {
        const c0 = (su << u1) | (sv << v1), c1 = c0 | (1 << a);
        o[a] = 0;
        o[u1] = su ? 1 : -1;
        o[v1] = sv ? 1 : -1;
        tri(c0 * 3 + u1, c1 * 3 + u1, c1 * 3 + v1, o[0], o[1], o[2]);
        tri(c0 * 3 + u1, c1 * 3 + v1, c0 * 3 + v1, o[0], o[1], o[2]);
      }
    }
  }
  for (let corner = 0; corner < 8; corner++) tri(corner * 3, corner * 3 + 1, corner * 3 + 2, corner & 1 ? 1 : -1, corner & 2 ? 1 : -1, corner & 4 ? 1 : -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
