import * as THREE from 'three';
import type { Collider, World } from './physics';

export type InteractKind = 'door' | 'breaker' | 'valve' | 'crate';

export interface InteractableResult {
  kind: InteractKind;
  label: string;
  opened?: boolean;
  refillAmmo?: boolean;
}

interface DoorItem {
  kind: 'door';
  id: string;
  label: string;
  center: THREE.Vector3;
  pivot: THREE.Group;
  collider: Collider;
  open: boolean;
  angle: number;
  targetAngle: number;
  openDir: number;
}

export interface ToggleableLight {
  intensity: number;
  baseIntensity?: number;
}

interface BreakerItem {
  kind: 'breaker';
  id: string;
  label: string;
  center: THREE.Vector3;
  lever: THREE.Object3D;
  ledMat: THREE.MeshBasicMaterial;
  lights: ToggleableLight[];
  savedIntensity: number[];
  on: boolean;
}

interface ValveItem {
  kind: 'valve';
  id: string;
  label: string;
  center: THREE.Vector3;
  wheel: THREE.Object3D;
  steamMesh: THREE.Mesh;
  spinT: number;
  steamT: number;
}

interface CrateItem {
  kind: 'crate';
  id: string;
  label: string;
  center: THREE.Vector3;
  lidPivot: THREE.Group;
  opened: boolean;
  lidAngle: number;
}

type AnyInteract = DoorItem | BreakerItem | ValveItem | CrateItem;

/**
 * Physical Scene Interaction System:
 * Supports hinged armored marine doors (with dynamic collider toggling),
 * electrical circuit breakers (toggling zone lights), high-pressure steam valves
 * (creating tactical steam concealment clouds), and hinged tactical supply crates.
 */
export class InteractableSystem {
  readonly group = new THREE.Group();
  private items: AnyInteract[] = [];

  private doorMat = new THREE.MeshStandardMaterial({ color: 0x3a4a58, roughness: 0.44, metalness: 0.72 });
  private trimMat = new THREE.MeshStandardMaterial({ color: 0x242e38, roughness: 0.52, metalness: 0.8 });
  private handleMat = new THREE.MeshStandardMaterial({ color: 0xdca428, roughness: 0.35, metalness: 0.65 });
  private redMetalMat = new THREE.MeshStandardMaterial({ color: 0xb63226, roughness: 0.42, metalness: 0.62 });
  private crateMat = new THREE.MeshStandardMaterial({ color: 0x42503e, roughness: 0.72, metalness: 0.18 });
  private steamMat = new THREE.MeshBasicMaterial({
    color: 0xd8e8f5,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  /** Add an interactive hinged armored marine cabin door with dynamic physics collider. */
  addDoor(
    world: World,
    id: string,
    label: string,
    x: number,
    y: number,
    z: number,
    rotY: number,
    width = 1.96,
    height = 2.32,
    openDir = 1,
    startOpen = false,
  ) {
    const pivot = new THREE.Group();
    // Place hinge at local -width/2 along door span
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const hx = x - (width * 0.5) * c;
    const hz = z + (width * 0.5) * s;
    pivot.position.set(hx, y, hz);
    pivot.rotation.y = rotY;

    // Armored steel door slab + reinforced porthole frame + yellow dogging lever handle
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.1), this.doorMat);
    slab.position.set(width * 0.5, height * 0.5, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    pivot.add(slab);

    // Upper & lower reinforcement kickplates
    const kick = new THREE.Mesh(new THREE.BoxGeometry(width - 0.08, 0.32, 0.12), this.trimMat);
    kick.position.set(width * 0.5, 0.2, 0);
    pivot.add(kick);

    // Porthole viewport ring
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.13, 14), this.trimMat);
    port.rotation.x = Math.PI / 2;
    port.position.set(width * 0.5, height * 0.68, 0);
    pivot.add(port);

    // Double-sided dogging lever handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.22), this.handleMat);
    handle.position.set(width - 0.22, 1.05, 0);
    pivot.add(handle);

    this.group.add(pivot);

    // Exact world collider centered in doorway (disabled when door is opened)
    const collider = world.addBox(x, y + height * 0.5, z, width * 0.5, height * 0.5, 0.12, rotY, 'metal', true);
    collider.enabled = !startOpen;

    const initAngle = startOpen ? openDir * 1.65 : 0;
    pivot.rotation.y = rotY + initAngle;

    this.items.push({
      kind: 'door',
      id,
      label,
      center: new THREE.Vector3(x, y + 1.1, z),
      pivot,
      collider,
      open: startOpen,
      angle: initAngle,
      targetAngle: initAngle,
      openDir,
    });
    // Store base yaw on pivot.userData so animation stays exact
    pivot.userData.baseRot = rotY;
  }

  /** Add a wall-mounted electrical circuit breaker cabinet that toggles nearby zone lights. */
  addBreaker(
    id: string,
    label: string,
    x: number,
    y: number,
    z: number,
    rotY: number,
    lights: ToggleableLight[],
    startOn = true,
  ) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = rotY;

    const box = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.76, 0.2), this.trimMat);
    box.castShadow = true;
    root.add(box);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.22), this.doorMat);
    root.add(panel);

    const ledMat = new THREE.MeshBasicMaterial({ color: startOn ? 0x32f584 : 0xff3b30 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), ledMat);
    led.position.set(0.14, 0.22, 0.12);
    root.add(led);

    const lever = new THREE.Group();
    lever.position.set(-0.08, 0.0, 0.11);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), this.handleMat);
    arm.position.set(0, 0.08, 0.04);
    lever.add(arm);
    lever.rotation.x = startOn ? -0.55 : 0.65;
    root.add(lever);

    this.group.add(root);
    const savedIntensity = lights.map((l) => l.intensity);
    if (!startOn) for (const l of lights) l.intensity = 0;

    this.items.push({
      kind: 'breaker',
      id,
      label,
      center: new THREE.Vector3(x, y, z),
      lever,
      ledMat,
      lights,
      savedIntensity,
      on: startOn,
    });
  }

  /** Add a red industrial high-pressure fire-main steam valve creating temporary steam concealment. */
  addValve(id: string, label: string, x: number, y: number, z: number, rotY: number) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = rotY;

    // Pipe collar + vertical valve stem
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.72, 10), this.trimMat);
    root.add(pipe);

    const wheel = new THREE.Group();
    wheel.position.set(0, 0, 0.18);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.032, 8, 18), this.redMetalMat);
    wheel.add(rim);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6), this.redMetalMat);
      sp.rotation.z = (i * Math.PI) / 4;
      wheel.add(sp);
    }
    root.add(wheel);

    // Expanding steam plume cone projecting out into the corridor
    const steamGeo = new THREE.ConeGeometry(2.1, 4.6, 12, 1, true);
    steamGeo.rotateX(Math.PI / 2);
    steamGeo.translate(0, 0, 2.4);
    const steamMesh = new THREE.Mesh(steamGeo, this.steamMat.clone());
    steamMesh.position.set(0, 0.15, 0.25);
    steamMesh.visible = false;
    root.add(steamMesh);

    this.group.add(root);
    this.items.push({
      kind: 'valve',
      id,
      label,
      center: new THREE.Vector3(x, y, z),
      wheel,
      steamMesh,
      spinT: 0,
      steamT: 0,
    });
  }

  /** Add a hinged military tactical supply crate that opens on [F] to refill ammo & grenades. */
  addSupplyCrate(world: World, id: string, label: string, x: number, y: number, z: number, rotY: number) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = rotY;

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.56, 0.68), this.crateMat);
    base.position.y = 0.28;
    base.castShadow = true;
    base.receiveShadow = true;
    root.add(base);

    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), this.handleMat);
    latch.position.set(0, 0.52, 0.35);
    root.add(latch);

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.56, -0.34);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.12, 0.72), this.crateMat);
    lid.position.set(0, 0.06, 0.34);
    lid.castShadow = true;
    lidPivot.add(lid);
    root.add(lidPivot);

    this.group.add(root);
    world.addBox(x, y + 0.34, z, 0.6, 0.34, 0.35, rotY, 'metal', true);

    this.items.push({
      kind: 'crate',
      id,
      label,
      center: new THREE.Vector3(x, y + 0.5, z),
      lidPivot,
      opened: false,
      lidAngle: 0,
    });
  }

  /** Animate doors, valves, steam plumes, crate lids & return the nearest interaction prompt. */
  update(dt: number, t: number, playerPos: THREE.Vector3): string | null {
    for (const it of this.items) {
      if (it.kind === 'door') {
        const diff = it.targetAngle - it.angle;
        if (Math.abs(diff) > 0.002) {
          it.angle += diff * Math.min(1, dt * 7.5);
          it.pivot.rotation.y = (it.pivot.userData.baseRot as number) + it.angle;
        }
      } else if (it.kind === 'valve') {
        if (it.spinT > 0) {
          it.spinT = Math.max(0, it.spinT - dt);
          it.wheel.rotation.z += dt * 7.5;
        }
        if (it.steamT > 0) {
          it.steamT = Math.max(0, it.steamT - dt);
          it.steamMesh.visible = true;
          const fade = Math.min(1, it.steamT / 1.8);
          (it.steamMesh.material as THREE.MeshBasicMaterial).opacity = 0.28 * fade;
          const pulse = 0.92 + Math.sin(t * 16) * 0.1;
          it.steamMesh.scale.set(pulse, pulse, 0.96 + Math.cos(t * 12) * 0.08);
        } else {
          it.steamMesh.visible = false;
        }
      } else if (it.kind === 'crate') {
        const want = it.opened ? -1.55 : 0;
        if (Math.abs(want - it.lidAngle) > 0.004) {
          it.lidAngle += (want - it.lidAngle) * Math.min(1, dt * 8.0);
          it.lidPivot.rotation.x = it.lidAngle;
        }
      }
    }

    const near = this.findNearest(playerPos);
    if (!near) return null;
    if (near.kind === 'door') return near.open ? `关闭${near.label}` : `开启${near.label}`;
    if (near.kind === 'breaker') return near.on ? `切断${near.label}` : `合闸开启${near.label}`;
    if (near.kind === 'valve') return near.steamT > 1 ? '蒸汽排放中…' : `拧开${near.label}（释放蒸汽掩护）`;
    if (near.kind === 'crate') return near.opened ? null : `打开${near.label}（补充弹药/震撼弹）`;
    return null;
  }

  private findNearest(playerPos: THREE.Vector3): AnyInteract | null {
    let best: AnyInteract | null = null;
    let bestD = 2.65;
    for (const it of this.items) {
      if (it.kind === 'crate' && it.opened) continue;
      const dy = Math.abs(playerPos.y + 1.0 - it.center.y);
      if (dy > 2.0) continue;
      const d = Math.hypot(playerPos.x - it.center.x, playerPos.z - it.center.z);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  /** Trigger interaction on the nearest world prop within reach. */
  interact(playerPos: THREE.Vector3): InteractableResult | null {
    const it = this.findNearest(playerPos);
    if (!it) return null;

    if (it.kind === 'door') {
      it.open = !it.open;
      it.targetAngle = it.open ? it.openDir * 1.68 : 0;
      it.collider.enabled = !it.open;
      return { kind: 'door', label: it.label, opened: it.open };
    }
    if (it.kind === 'breaker') {
      it.on = !it.on;
      it.lever.rotation.x = it.on ? -0.55 : 0.65;
      it.ledMat.color.setHex(it.on ? 0x32f584 : 0xff3b30);
      for (let i = 0; i < it.lights.length; i++) {
        const val = it.on ? it.savedIntensity[i] : 0.4;
        it.lights[i].intensity = val;
        if (it.lights[i].baseIntensity !== undefined) it.lights[i].baseIntensity = val;
      }
      return { kind: 'breaker', label: it.label, opened: it.on };
    }
    if (it.kind === 'valve') {
      if (it.steamT > 1.0) return null;
      it.spinT = 1.2;
      it.steamT = 9.5;
      return { kind: 'valve', label: it.label, opened: true };
    }
    if (it.kind === 'crate') {
      if (it.opened) return null;
      it.opened = true;
      return { kind: 'crate', label: it.label, opened: true, refillAmmo: true };
    }
    return null;
  }
}
