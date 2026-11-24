import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { audio } from '../core/audio';
import { rand } from '../core/utils';
import { assets, makePropObject } from '../render/assets';
import { makeHit, type Collider, type World } from '../world/physics';

function tinted(g: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ---------------------------------------------------------------------------
// Explosive barrels
// ---------------------------------------------------------------------------
let barrelMat: THREE.MeshStandardMaterial | null = null;
let barrelDeadMat: THREE.MeshStandardMaterial | null = null;

export class Barrel {
  mesh: THREE.Mesh;
  collider: Collider;
  hp = 55;
  alive = true;
  /** Counts down to detonation once the barrel is breached. */
  fuse = -1;
  pos = new THREE.Vector3();

  constructor(world: World, x: number, y: number, z: number) {
    // scanned red hazard drum (Poly Haven "Barrel_01")
    const part = assets.props.barrel_x.parts[0];
    if (!barrelMat) {
      barrelMat = part.mat.clone();
      barrelMat.vertexColors = false;
      barrelDeadMat = barrelMat.clone();
      barrelDeadMat.color.set(0x1c1815);
      barrelDeadMat.roughness = 1;
      barrelDeadMat.metalness = 0.2;
    }
    this.mesh = new THREE.Mesh(part.geo, barrelMat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.pos.set(x, y, z);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = rand(0, 6.28);
    this.collider = world.addBox(x, y + 0.45, z, 0.27, 0.45, 0.27, 0, 'metal', false, this);
  }

  reset() {
    this.hp = 55;
    this.alive = true;
    this.fuse = -1;
    this.collider.enabled = true;
    this.mesh.material = barrelMat!;
    this.mesh.rotation.set(0, this.mesh.rotation.y, 0);
    this.mesh.scale.set(1, 1, 1);
    this.mesh.position.copy(this.pos);
  }

  /** Returns true when the barrel has just been breached. */
  damage(amount: number) {
    if (!this.alive || this.fuse >= 0) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.fuse = rand(0.06, 0.22);
      return true;
    }
    return false;
  }

  /** Called when it actually explodes. */
  destroy() {
    this.alive = false;
    this.fuse = -1;
    this.collider.enabled = false;
    this.mesh.material = barrelDeadMat!;
    this.mesh.rotation.z = rand(1.2, 1.57);
    this.mesh.rotation.x = rand(-0.3, 0.3);
    this.mesh.scale.set(1.05, 0.72, 0.95);
    this.mesh.position.set(this.pos.x + rand(-0.5, 0.5), this.pos.y + 0.24, this.pos.z + rand(-0.5, 0.5));
  }
}

// ---------------------------------------------------------------------------
// Fragmentation grenade
// ---------------------------------------------------------------------------
let grenadeGeo: THREE.BufferGeometry | null = null;
let grenadeMat: THREE.MeshStandardMaterial | null = null;
const _hit = makeHit();

export class Grenade {
  mesh: THREE.Mesh;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  fuse = 2.6;
  done = false;
  private spin = new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9));
  private bounces = 0;

  constructor(pos: THREE.Vector3, vel: THREE.Vector3) {
    if (!grenadeGeo) {
      const parts = [
        tinted(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.15, 1), 0x39402a),
        tinted(new THREE.CylinderGeometry(0.018, 0.02, 0.03, 8).translate(0, 0.06, 0), 0x2a2a2a),
        tinted(new THREE.BoxGeometry(0.014, 0.075, 0.006).translate(0.028, 0.03, 0).rotateZ(-0.25), 0x444444),
      ];
      grenadeGeo = mergeGeometries(parts, false);
      grenadeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
    }
    this.mesh = new THREE.Mesh(grenadeGeo, grenadeMat!);
    this.mesh.castShadow = true;
    this.pos.copy(pos);
    this.vel.copy(vel);
    this.mesh.position.copy(pos);
  }

  /** Returns true when the fuse runs out. */
  update(dt: number, world: World) {
    this.fuse -= dt;
    if (this.fuse <= 0) {
      this.done = true;
      return true;
    }
    this.vel.y -= 13 * dt;
    let remaining = dt;
    for (let iter = 0; iter < 3 && remaining > 1e-5; iter++) {
      const speed = this.vel.length();
      if (speed < 1e-3) break;
      const dx = this.vel.x / speed, dy = this.vel.y / speed, dz = this.vel.z / speed;
      const travel = speed * remaining;
      if (world.raycast(this.pos.x, this.pos.y, this.pos.z, dx, dy, dz, travel + 0.05, _hit)) {
        const t = Math.max(0, _hit.t - 0.05);
        this.pos.x += dx * t;
        this.pos.y += dy * t;
        this.pos.z += dz * t;
        remaining -= t / speed;
        // reflect with energy loss
        const n = _hit.normal;
        const vn = this.vel.dot(n);
        if (vn < 0) {
          this.vel.addScaledVector(n, -vn * 1.38);
          this.vel.multiplyScalar(0.72);
          if (-vn > 1.2 && this.bounces < 6) {
            audio.playAt('bounce', this.pos, { vol: Math.min(1, -vn / 6), rateVar: 0.12, refDist: 5 });
            this.bounces++;
          }
          this.spin.multiplyScalar(0.6);
          // come to rest on the floor
          if (n.y > 0.7 && Math.abs(this.vel.y) < 0.9) {
            this.vel.y = 0;
            this.vel.x *= 0.85;
            this.vel.z *= 0.85;
          }
        } else break;
      } else {
        this.pos.x += dx * travel;
        this.pos.y += dy * travel;
        this.pos.z += dz * travel;
        remaining = 0;
      }
    }
    if (this.pos.y < 0.05) {
      this.pos.y = 0.05;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    this.mesh.position.copy(this.pos);
    const sp = Math.min(1, this.vel.length() / 3);
    this.mesh.rotation.x += this.spin.x * dt * sp;
    this.mesh.rotation.y += this.spin.y * dt * sp;
    this.mesh.rotation.z += this.spin.z * dt * sp;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dropped ammunition
// ---------------------------------------------------------------------------
let glowMat: THREE.MeshBasicMaterial | null = null;
let glowGeo: THREE.BufferGeometry | null = null;

export class AmmoBox {
  group = new THREE.Group();
  pos = new THREE.Vector3();
  life = 45;
  private glow: THREE.Mesh;
  private t = rand(0, 6);

  constructor(x: number, y: number, z: number) {
    if (!glowGeo) {
      glowGeo = new THREE.CylinderGeometry(0.3, 0.42, 1.5, 16, 1, true).translate(0, 0.75, 0);
      // fade the beacon out towards the top
      const n = glowGeo.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const k = Math.pow(1 - glowGeo.attributes.position.getY(i) / 1.5, 2);
        col[i * 3] = 1.0 * k;
        col[i * 3 + 1] = 0.72 * k;
        col[i * 3 + 2] = 0.25 * k;
      }
      glowGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.22, fog: false });
    }
    // scanned steel ammunition can, slightly oversized so it reads from a distance
    const box = makePropObject('ammo_box', 1.5);
    this.glow = new THREE.Mesh(glowGeo!, glowMat!);
    this.group.add(box);
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = rand(0, 6.28);
  }

  /** The beacon is drawn in the fx scene so it is not affected by ambient occlusion. */
  get beacon() {
    this.glow.position.copy(this.pos);
    return this.glow;
  }

  update(dt: number) {
    this.life -= dt;
    this.t += dt;
    const s = 0.85 + Math.sin(this.t * 3) * 0.15;
    this.glow.scale.set(s, this.life < 6 ? (Math.sin(this.t * 14) > 0 ? 1 : 0.35) : 1, s);
    return this.life <= 0;
  }
}

/**
 * Resupply station: a stack of scanned steel ammunition cans on a pallet, with a soft ground ring
 * marking the interaction radius. The old additive light column read like a mobile-game pickup and
 * washed out the scene, so the crate itself is now the marker.
 */
export function makeSupplyCrate(x: number, z: number, y = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rand(0, 6.28);
  // pallet base
  const pallet = makePropObject('pallet', 1.3);
  pallet.position.y = 0.015;
  g.add(pallet);
  // ammunition cans, stacked and offset so it reads as a stash rather than a single box
  const a = makePropObject('ammo_box', 1.9);
  a.position.set(-0.2, 0.14, 0.05);
  a.rotation.y = 0.12;
  const b = makePropObject('ammo_box', 1.7);
  b.position.set(0.26, 0.14, -0.12);
  b.rotation.y = -0.35;
  const c = makePropObject('ammo_box', 1.6);
  c.position.set(0.02, 0.42, 0.02);
  c.rotation.y = 0.6;
  g.add(a, b, c);

  // ground ring: pulsing while the station is ready, dim while it re-arms
  // Placed cleanly 2.6cm above the true floor elevation `y` with polygonOffset — zero Z-fighting & zero floating!
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.25, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffc36a,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.026;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}
