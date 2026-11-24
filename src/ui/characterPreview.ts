import * as THREE from 'three';
import { SoldierModel, isBossKind, type ModelKind } from '../entities/soldier';

/**
 * 3A Interactive Full-Body 3D Character & Boss Turntable Viewer for the Archives ("档案 · 人物档案").
 * Renders the live 24-bone rigged SoldierModel (complete with bespoke Blender 4.2 Hero & Boss kits!)
 * on a sleek illuminated tactical pedestal with mouse left-drag 360° orbit, scroll zoom, and smooth idle animation.
 */
export class CharacterPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 16 / 10, 0.05, 40);
  private pivot = new THREE.Group();
  private pedestal = new THREE.Group();
  private rimLight: THREE.DirectionalLight;
  private scanRing: THREE.Mesh;
  private model: SoldierModel | null = null;
  private raf = 0;
  private last = 0;
  private t = 0;

  private yaw = 0.35;
  private targetYaw = 0.35;
  private pitch = 0.08;
  private targetPitch = 0.08;
  private dist = 3.5;
  private targetDist = 3.5;
  private baseDist = 3.5;
  private lookY = 0.96;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private poseMode: 'combat' | 'briefing' = 'combat';

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.65;
    this.scene.add(this.pivot);

    // 3-Point Hero Studio Lighting (crisp warm key + cool/crimson rim + soft sky bounce!)
    const key = new THREE.DirectionalLight(0xfff4e2, 4.0);
    key.position.set(2.8, 4.2, 3.6);
    this.rimLight = new THREE.DirectionalLight(0x38d8ff, 3.4);
    this.rimLight.position.set(-3.2, 2.4, -2.8);
    const backAmber = new THREE.DirectionalLight(0xe8b04a, 1.5);
    backAmber.position.set(2.6, 1.2, -2.6);
    const fill = new THREE.HemisphereLight(0xd4e6ff, 0x1d2633, 1.85);
    this.scene.add(key, this.rimLight, backAmber, fill);

    // Sleek Tactical Holographic Pedestal
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.92, 1.02, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c141d, roughness: 0.42, metalness: 0.72 }),
    );
    disc.position.y = -0.06;
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 0.98, 64),
      new THREE.MeshBasicMaterial({ color: 0x38d8ff, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }),
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = 0.004;
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.64, 48),
      new THREE.MeshBasicMaterial({ color: 0xe8b04a, transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false }),
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.005;
    this.pedestal.add(disc, outerRing, innerRing);
    this.scene.add(this.pedestal);

    this.scanRing = new THREE.Mesh(
      new THREE.RingGeometry(0.76, 0.785, 48),
      new THREE.MeshBasicMaterial({ color: 0x38d8ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scanRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.scanRing);

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.targetYaw += (e.clientX - this.lastX) * 0.011;
      this.targetPitch = Math.max(-0.22, Math.min(0.55, this.targetPitch + (e.clientY - this.lastY) * 0.006));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetDist = Math.max(this.baseDist * 0.48, Math.min(this.baseDist * 1.55, this.targetDist + e.deltaY * 0.0018));
    }, { passive: false });
  }

  setCharacter(kind: ModelKind, factionTag: 'ally' | 'hostile' | 'civilian') {
    if (this.model) {
      this.pivot.remove(this.model.root);
      this.model.dispose();
      this.model = null;
    }
    const m = new SoldierModel(kind);
    if (isBossKind(kind)) m.setOverdrive(true);
    this.model = m;
    this.pivot.add(m.root);

    const isBoss = isBossKind(kind);
    this.baseDist = isBoss ? 4.35 : 3.45;
    this.dist = this.targetDist = this.baseDist;
    this.lookY = isBoss ? 1.24 : 0.98;
    this.yaw = this.targetYaw = 0.36;
    this.pitch = this.targetPitch = 0.08;

    const accent = factionTag === 'hostile' ? 0xff4230 : factionTag === 'civilian' ? 0xf0b848 : 0x38d8ff;
    this.rimLight.color.setHex(accent);
    (this.scanRing.material as THREE.MeshBasicMaterial).color.setHex(accent);
  }

  togglePose(): 'combat' | 'briefing' {
    this.poseMode = this.poseMode === 'combat' ? 'briefing' : 'combat';
    return this.poseMode;
  }

  resetView() {
    this.targetYaw = 0.36;
    this.targetPitch = 0.08;
    this.targetDist = this.baseDist;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(2, Math.floor(r.width));
    const h = Math.max(2, Math.floor(r.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.resize();
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
      this.last = now;
      this.t += dt;

      if (!this.dragging) this.targetYaw += dt * 0.22;
      const k = 1 - Math.exp(-8 * dt);
      this.yaw += (this.targetYaw - this.yaw) * k;
      this.pitch += (this.targetPitch - this.pitch) * k;
      this.dist += (this.targetDist - this.dist) * k;

      this.pivot.rotation.y = this.yaw;
      this.pedestal.rotation.y = this.t * 0.16;
      this.scanRing.position.y = 0.1 + ((this.t * 0.45) % 1.9);

      if (this.model) {
        const aiming = this.poseMode === 'combat' && this.model.armed;
        const act = this.poseMode === 'briefing' ? 'briefing' : 'combat';
        this.model.update(dt, 0, 0, 0, aiming, 0, false, 0, act, 0);
      }

      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      this.camera.position.set(0, this.lookY + sp * this.dist, cp * this.dist);
      this.camera.lookAt(0, this.lookY, 0);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }
}
