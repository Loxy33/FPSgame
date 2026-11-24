import * as THREE from 'three';
import { makePropObject, type PropName } from '../render/assets';

/**
 * AAA Forensic 3D Evidence Turntable Viewer for the Classified Intel Archive Terminal:
 * Renders the actual CC0 photo-scanned 3D prop on a holographic forensic scanner pedestal
 * with left-drag 360° inspection, scroll zoom, and an encrypted wireframe hologram for locked files.
 */
export class EvidencePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 16 / 10, 0.02, 30);
  private pivot = new THREE.Group();
  private pedestal = new THREE.Group();
  private scanRing: THREE.Mesh;
  private lockMesh: THREE.Group | null = null;
  private raf = 0;
  private last = 0;
  private t = 0;

  private yaw = 0.65;
  private targetYaw = 0.65;
  private pitch = 0.28;
  private targetPitch = 0.28;
  private dist = 1.4;
  private targetDist = 1.4;
  private baseDist = 1.4;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.85;
    this.scene.add(this.pivot);

    // Forensic 3-point studio lighting (cool cyan scanner rim + crisp studio key + warm amber accent)
    const key = new THREE.DirectionalLight(0xfff5e4, 4.4);
    key.position.set(2.2, 3.2, 2.4);
    const rim = new THREE.DirectionalLight(0x38e4ff, 3.4);
    rim.position.set(-2.8, 1.8, -2.2);
    const amber = new THREE.DirectionalLight(0xe8b04a, 1.4);
    amber.position.set(2.0, -0.6, -2.0);
    const fill = new THREE.HemisphereLight(0xcbe2ff, 0x1d2633, 1.7);
    this.scene.add(key, rim, amber, fill);

    // Holographic forensic scanner pedestal rings
    const outerMat = new THREE.MeshBasicMaterial({ color: 0x38e4ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.47, 64), outerMat);
    outer.rotation.x = -Math.PI / 2;
    const midMat = new THREE.MeshBasicMaterial({ color: 0xe8b04a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const mid = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.325, 48), midMat);
    mid.rotation.x = -Math.PI / 2;
    const discMat = new THREE.MeshBasicMaterial({ color: 0x07111a, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.46, 64), discMat);
    disc.rotation.x = -Math.PI / 2;
    this.pedestal.add(disc, outer, mid);
    this.pedestal.position.y = -0.22;
    this.scene.add(this.pedestal);

    // Subtle vertical holographic scan ring sweeping the evidence
    const scanMat = new THREE.MeshBasicMaterial({ color: 0x38e4ff, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false });
    this.scanRing = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.372, 48), scanMat);
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
      this.targetYaw -= (e.clientX - this.lastX) * 0.01;
      this.targetPitch = Math.max(-0.35, Math.min(0.95, this.targetPitch + (e.clientY - this.lastY) * 0.007));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetDist = Math.max(this.baseDist * 0.55, Math.min(this.baseDist * 1.7, this.targetDist + e.deltaY * 0.0008));
    }, { passive: false });
  }

  /** Display either the real photo-scanned 3D prop (unlocked) or an encrypted holographic wireframe cube (locked). */
  setEvidence(prop: PropName, unlocked: boolean) {
    this.pivot.clear();
    this.lockMesh = null;

    if (!unlocked) {
      const grp = new THREE.Group();
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.24, 1)),
        new THREE.LineBasicMaterial({ color: 0x38e4ff, transparent: true, opacity: 0.55 }),
      );
      const inner = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({ color: 0xe8b04a, wireframe: true, transparent: true, opacity: 0.72 }),
      );
      grp.add(wire, inner);
      this.pivot.add(grp);
      this.lockMesh = grp;
      this.baseDist = 1.42;
      this.dist = this.targetDist = 1.42;
      this.yaw = this.targetYaw = 0.6;
      this.pitch = this.targetPitch = 0.25;
      this.pedestal.position.y = -0.3;
      this.pedestal.scale.setScalar(0.85);
      this.scanRing.visible = true;
      return;
    }

    const obj = makePropObject(prop, 1.0);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Normalize every evidence prop to ~0.55m hero scale on the forensic turntable
    const maxDim = Math.max(size.x, size.y, size.z, 0.05);
    const normScale = 0.56 / maxDim;
    obj.scale.multiplyScalar(normScale);
    obj.position.set(-center.x * normScale, -center.y * normScale, -center.z * normScale);
    this.pivot.add(obj);

    const hScaled = size.y * normScale;
    this.pedestal.position.y = -(hScaled * 0.52 + 0.05);
    this.pedestal.scale.setScalar(0.95);
    this.baseDist = 1.54;
    this.dist = this.targetDist = 1.54;
    this.yaw = this.targetYaw = 0.72;
    this.pitch = this.targetPitch = 0.34;
    this.scanRing.visible = false;
  }

  resetView() {
    this.targetYaw = 0.72;
    this.targetPitch = 0.34;
    this.targetDist = this.baseDist;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.resize();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
      this.last = now;
      this.t += dt;
      if (this.lockMesh) {
        this.lockMesh.rotation.y = this.t * 0.45;
        this.lockMesh.rotation.x = Math.sin(this.t * 0.6) * 0.18;
        this.scanRing.position.y = Math.sin(this.t * 1.6) * 0.24;
      }
      const k = 1 - Math.exp(-9 * dt);
      this.yaw += (this.targetYaw - this.yaw) * k;
      this.pitch += (this.targetPitch - this.pitch) * k;
      this.dist += (this.targetDist - this.dist) * k;
      const cp = Math.cos(this.pitch);
      this.camera.position.set(
        Math.sin(this.yaw) * this.dist * cp,
        Math.sin(this.pitch) * this.dist * 0.9 - 0.02,
        Math.cos(this.yaw) * this.dist * cp,
      );
      this.camera.lookAt(0, -0.075, 0);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    if (!this.raf) this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
