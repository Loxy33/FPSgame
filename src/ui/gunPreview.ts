import * as THREE from 'three';

export type CameraPreset = 'hero' | 'side' | 'rear';

/**
 * Full-screen Tactical Armory 3D Studio Preview:
 * 3-point high-contrast military studio lighting, subtle tactical turntable rings,
 * smoothly damped camera orbit/zoom & preset angles, and real-time 3D anchor projection.
 */
export class GunPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.01, 24);
  private pivot = new THREE.Group();
  private pedestal = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private raf = 0;
  private last = 0;

  private yaw = 0.72;
  private targetYaw = 0.72;
  private pitch = 0.14;
  private targetPitch = 0.14;
  private dist = 1.25;
  private targetDist = 1.25;
  private baseDist = 1.25;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private centre = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.85;
    this.scene.add(this.pivot);

    // High-contrast 3-point military studio lighting (warm studio softbox key + icy tactical cyan rim + crisp bevel fill)
    const key = new THREE.DirectionalLight(0xfff4e0, 4.8);
    key.position.set(2.4, 3.4, 2.5);
    const rim = new THREE.DirectionalLight(0x88ccff, 3.2);
    rim.position.set(-3.2, 2.0, -2.6);
    const edge = new THREE.DirectionalLight(0xf0bc5a, 1.45);
    edge.position.set(2.4, -0.8, -2.2);
    const fill = new THREE.HemisphereLight(0xd4e6ff, 0x323b48, 1.75);
    const front = new THREE.DirectionalLight(0xf2f6ff, 1.45);
    front.position.set(0.3, 0.7, 3.0);
    this.scene.add(key, rim, edge, fill, front);

    // Subtle floating tactical blueprint turntable beneath the firearm
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe8b04a, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
    const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.466, 64), ringMat);
    outerRing.rotation.x = -Math.PI / 2;
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x8bb4d8, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.284, 48), innerMat);
    innerRing.rotation.x = -Math.PI / 2;
    const discMat = new THREE.MeshBasicMaterial({ color: 0x0b1016, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.46, 64), discMat);
    disc.rotation.x = -Math.PI / 2;
    this.pedestal.add(disc, outerRing, innerRing);
    this.pedestal.position.y = -0.22;
    this.scene.add(this.pedestal);

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.targetYaw -= (e.clientX - this.lastX) * 0.0095;
      this.targetPitch = Math.max(-0.45, Math.min(0.85, this.targetPitch + (e.clientY - this.lastY) * 0.006));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = () => {
      this.dragging = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetDist = Math.max(this.baseDist * 0.52, Math.min(this.baseDist * 1.65, this.targetDist + e.deltaY * 0.0008));
    }, { passive: false });
  }

  setPreset(preset: CameraPreset) {
    if (preset === 'hero') {
      this.targetYaw = 0.82;
      this.targetPitch = 0.14;
      this.targetDist = this.baseDist * 0.88;
    } else if (preset === 'side') {
      this.targetYaw = Math.PI * 0.5;
      this.targetPitch = 0.04;
      this.targetDist = this.baseDist * 1.06;
    } else if (preset === 'rear') {
      this.targetYaw = 0.16;
      this.targetPitch = 0.08;
      this.targetDist = this.baseDist * 0.74;
    }
  }

  setModel(src: THREE.Object3D | null, keepView = false) {
    this.pivot.clear();
    this.model = null;
    if (!src) return;
    const clone = src.clone(true);
    clone.visible = true;
    clone.traverse((o) => {
      if (o === clone) return;
      const mesh = o as THREE.Mesh;
      const isArm = (o as THREE.SkinnedMesh).isSkinnedMesh;
      if (
        isArm
        || o.name === 'FPArms'
        || o.name === 'laserBeam'
        || /flash|spare/i.test(o.name)
        || /flash|spare/i.test(o.parent?.name ?? '')
      ) {
        o.visible = false;
      }
      if (mesh.isMesh) mesh.frustumCulled = false;
    });
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);
    clone.updateMatrixWorld(true);
    if (!keepView || this.centre.lengthSq() === 0) {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      clone.traverse((o) => {
        let cur: THREE.Object3D | null = o;
        while (cur) {
          if (!cur.visible) return;
          cur = cur.parent;
        }
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        tmp.setFromObject(mesh);
        box.union(tmp);
      });
      const size = new THREE.Vector3();
      if (box.isEmpty()) return;
      box.getSize(size);
      box.getCenter(this.centre);
      const cw = this.canvas.clientWidth || 960;
      const ch = this.canvas.clientHeight || 760;
      const aspect = Math.max(1.05, cw / Math.max(1, ch));
      const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
      const tanH = tanV * aspect;
      const maxLen = Math.max(size.z, size.x);
      const distH = (maxLen * 0.5) / (tanH * 0.72);
      const distV = (size.y * 0.5) / (tanV * 0.44);
      this.baseDist = Math.max(distH, distV, 0.36);
      this.dist = this.targetDist = this.baseDist * 0.88;
      this.yaw = this.targetYaw = 0.82;
      this.pitch = this.targetPitch = 0.14;
      this.pedestal.position.y = -(size.y * 0.56 + 0.05);
      const ps = Math.max(0.42, Math.min(1.6, maxLen * 1.05));
      this.pedestal.scale.setScalar(ps);
    }
    clone.position.sub(this.centre);
    this.pivot.add(clone);
    this.pivot.updateMatrixWorld(true);
    this.model = clone;
  }

  /** Project a gun-local point (metres) to canvas CSS pixels, or null when behind the camera. */
  project(p: [number, number, number]): { x: number; y: number } | null {
    if (!this.model) return null;
    this.model.updateWorldMatrix(true, false);
    this.v.set(p[0], p[1], p[2]).applyMatrix4(this.model.matrixWorld);
    const cam = this.camera;
    const dist = this.v.distanceTo(cam.position);
    if (dist < 0.05) return null;
    this.v.project(cam);
    if (this.v.z > 1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: (this.v.x * 0.5 + 0.5) * r.width, y: (-this.v.y * 0.5 + 0.5) * r.height };
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
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.last) / 1000 || 0.016);
      this.last = t;
      const dampK = 1 - Math.exp(-9 * dt);
      this.yaw += (this.targetYaw - this.yaw) * dampK;
      this.pitch += (this.targetPitch - this.pitch) * dampK;
      this.dist += (this.targetDist - this.dist) * dampK;
      const d = this.dist;
      const cp = Math.cos(this.pitch);
      this.camera.position.set(Math.sin(this.yaw) * d * cp, Math.sin(this.pitch) * d * 0.85 + d * 0.08, Math.cos(this.yaw) * d * cp);
      this.camera.lookAt(0, 0.01, 0);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    if (!this.raf) this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
  }
}
