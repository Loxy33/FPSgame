import * as THREE from 'three';
import { TileNoise, clamp } from '../core/utils';
import type { TargetSpec } from '../entities/targets';
import { decorateDecals } from '../render/decals';
import { GroundMask, makeGroundMaterial, makeGroundMesh } from '../render/ground';
import { Materials } from '../render/materials';
import { makeSignTexture } from '../render/textures';
import type { MapInfo } from '../ui/hud';
import * as A from './architecture';
import { LevelBuilder, Opening } from './build';
import { World } from './physics';
import * as P from './props';

export type LevelId = 'survival' | 'training' | 'highseas' | 'oilfield';

export interface LevelData {
  id: LevelId;
  group: THREE.Group;
  playerSpawn: { x: number; z: number; yaw: number };
  spawnPoints: { x: number; z: number }[];
  /** Explosive barrel positions (dynamic objects created by the game). */
  barrels: { x: number; y: number; z: number }[];
  supplies: { x: number; z: number; y?: number }[];
  fires: THREE.Vector3[];
  plumes: THREE.Vector3[];
  bound: number;
  map: MapInfo;
  targets: TargetSpec[];
  /** Places the camera for the main-menu fly-by (t in seconds). */
  menuCamera(t: number, cam: THREE.PerspectiveCamera): void;
  /** Per-frame animation of level dressing (flags...). */
  update?(dt: number, t: number): void;
}

const WALL_T = 0.3;
const win = (at: number, w = 1.5, y0 = 0.95, y1 = 2.25): Opening => ({ at, w, y0, y1 });
const door = (at: number, w = 1.5, h = 2.3): Opening => ({ at, w, y0: 0, y1: h });

/** Wooden lintel / sill trims around wall openings, for depth. */
function trims(b: LevelBuilder, axis: 'x' | 'z', c: number, y0: number, ops: Opening[], t = WALL_T, color = 0x7a6850) {
  for (const o of ops) {
    const lin = (yy: number, h: number, extra: number, w: number) => {
      if (axis === 'x') b.deco('wood', o.at, y0 + yy, c, w, h, t + extra, { color });
      else b.deco('wood', c, y0 + yy, o.at, t + extra, h, w, { color });
    };
    lin(o.y1 - 0.02, 0.12, 0.08, o.w + 0.3);
    if (o.y0 > 0.05) lin(o.y0 - 0.05, 0.06, 0.16, o.w + 0.2);
  }
}

function wallWithTrim(b: LevelBuilder, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, h: number, ops: Opening[], color: number, t = WALL_T) {
  b.wall('plaster', axis, c, a0, a1, y0, h, t, ops, color);
  trims(b, axis, c, y0, ops, t);
}

// ---------------------------------------------------------------------------

function paintUrbanGround(): GroundMask {
  const M = new GroundMask(-160, -160, 320, 1024);
  type Pt = [number, number];
  // Damp roadside verges & grit flanking the four boulevard kerbs
  for (const sx of [-1, 1]) {
    M.path(0, [[sx * 6.8, -72], [sx * 6.8, 72]], 3.6, 0.62, 0.55);
    M.puddles([[sx * 7.2, -64], [sx * 7.2, 64]], 14, 0.7, 1.8, 1.0);
    M.path(0, [[-72, sx * 6.4], [72, sx * 6.4]], 3.6, 0.62, 0.55);
    M.puddles([[-64, sx * 6.8], [64, sx * 6.8]], 14, 0.7, 1.8, 1.0);
  }
  // SE FOB: heavy convoy ruts through North & West gates into motor pool and helipad apron
  const fobN: Pt[] = [[33.8, 5], [33.8, 15], [36, 22], [44.5, 22.5], [46, 33]];
  const fobW: Pt[] = [[5, 37.2], [16, 37.2], [28, 39], [36, 44], [46, 46]];
  for (const pts of [fobN, fobW]) {
    M.path(0, pts, 5.2, 0.88, 0.5);
    M.ruts(pts, 1.9, 0.42, 0.92, 0.3);
    M.puddles(pts, 9, 0.7, 1.9, 1.3);
  }
  M.path(0, [[40, 22], [58, 22], [58, 42], [44, 42]], 6.5, 0.7, 0.45);
  M.puddles([[42, 26], [56, 44]], 10, 0.8, 2.0, 2.2);

  // NE Compound & surrounding Old Town alleys: churned footpaths + damp courtyard well halo
  const compA: Pt[] = [[29, -8], [29, -18], [22, -21], [20, -29]];
  const compB: Pt[] = [[8, -27], [17, -27], [22, -21], [32, -24], [38.5, -34]];
  const neAlley: Pt[] = [[49.5, -8], [49.5, -26], [49.5, -48], [32, -50], [10, -50]];
  for (const pts of [compA, compB, neAlley]) {
    M.path(0, pts, 4.0, 0.78, 0.55);
    M.ruts(pts, 1.6, 0.34, 0.65, 0.35);
    M.puddles(pts, 11, 0.6, 1.6, 1.1);
  }
  M.blob(0, 22, -20, 4.6, 0.85);
  M.blob(2, 22, -20, 3.0, 0.72);

  // NW Grand Souk alleys & rear market service lanes
  const nwAlley: Pt[] = [[-8, -38], [-28, -39], [-44, -39], [-44, -12]];
  M.path(0, nwAlley, 4.8, 0.82, 0.5);
  M.ruts(nwAlley, 1.75, 0.38, 0.78, 0.35);
  M.puddles(nwAlley, 10, 0.7, 1.7, 1.2);

  // SW Petrol Station, Fuel Silos, Workshop Hangar & Scrapyard mud tracks
  const swLoop: Pt[] = [[-8, 18], [-20, 18], [-38, 18], [-38, 28], [-34, 39], [-33, 52], [-46, 54]];
  M.path(0, swLoop, 6.2, 0.92, 0.5);
  M.ruts(swLoop, 1.9, 0.44, 0.95, 0.4);
  M.puddles(swLoop, 8, 0.8, 2.2, 1.6);
  for (let z = 44; z <= 62; z += 6) M.path(0, [[-58, z], [-18, z]], 5.5, 0.82, 0.55);
  M.puddles([[-54, 48], [-22, 58]], 9, 0.9, 2.3, 3.0);

  // Subtle natural damp desert hollows outside the perimeter wall
  for (let i = 0; i < 60; i++) {
    const a = (i * 2.39996) % (Math.PI * 2);
    const d = 80 + ((i * 37) % 68);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x) < 9 || Math.abs(z) < 9) continue;
    M.blob(0, x, z, 3.5 + (i % 5), 0.35 + (i % 3) * 0.12);
    if (i % 3 === 0) M.blob(2, x, z, 1.6 + (i % 3) * 0.5, 0.7);
  }
  return M;
}

function buildGround(b: LevelBuilder) {
  b.region = 'ground';
  const E = 240;
  // Raised asphalt roadbeds sitting cleanly above the y = 0 wet PBR ground mesh
  const road = (x0: number, x1: number, z0: number, z1: number) =>
    b.deco('asphalt', (x0 + x1) / 2, -0.02, (z0 + z1) / 2, x1 - x0, 0.034, z1 - z0, { grime: 1 });
  road(-4.5, 4.5, -E, E);
  road(-E, -4.5, -4, 4);
  road(4.5, E, -4, 4);

  // faded centre-line dashes (y = 0.015 right atop asphalt top y = 0.014)
  for (let d = 9; d < 150; d += 7) {
    for (const s of [-1, 1]) {
      if (b.rnd() < 0.2) continue;
      b.deco('paint', 0, 0.015, s * d, 0.16, 0.004, 3, { color: 0xb8b29e });
      b.deco('paint', s * d, 0.015, 0, 3, 0.004, 0.16, { color: 0xb8b29e });
    }
  }
  // crosswalk stripes at the junction
  for (let i = -3; i <= 3; i++) {
    b.deco('paint', i * 1.1, 0.015, 6.2, 0.5, 0.004, 2.2, { color: 0xb0aa98 });
    b.deco('paint', i * 1.1, 0.015, -6.2, 0.5, 0.004, 2.2, { color: 0xb0aa98 });
  }

  // kerbs / pavements with authentic Middle-Eastern alternating weathered yellow/charcoal kerb stripes near intersections
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const zA = sz * 4, zB = sz * 70.8;
      b.box('concrete', sx * 5.3, 0, (zA + zB) / 2, 1.6, 0.14, Math.abs(zB - zA), { color: 0xc4beae, grime: 1 });
      const xA = sx * 6.1, xB = sx * 70.8;
      b.box('concrete', (xA + xB) / 2, 0, sz * 4.8, Math.abs(xB - xA), 0.14, 1.6, { color: 0xc4beae, grime: 1 });
      // Alternating tactical yellow & charcoal painted kerb edge blocks flanking the main avenues
      for (let d = 5.4; d < 66; d += 2.4) {
        const col = Math.floor(d / 2.4) % 2 === 0 ? 0xb59540 : 0x3a3936;
        b.deco('paint', sx * 4.52, 0.01, sz * d, 0.06, 0.135, 1.8, { color: col });
        b.deco('paint', sx * (d + 1.5), 0.01, sz * 4.02, 1.8, 0.135, 0.06, { color: col });
      }
    }
  }
  // Windblown sand drifts lapping onto the asphalt road margins so kerbs feel organic and war-torn
  const driftGeo = new THREE.BoxGeometry(1, 0.06, 1);
  for (let d = -64; d <= 64; d += 11) {
    if (Math.abs(d) < 9) continue;
    const s = b.rnd() < 0.5 ? -1 : 1;
    b.geo('sand', driftGeo, { x: s * 3.85, y: 0.015, z: d + b.r(-2, 2) }, new THREE.Euler(0, b.r(-0.35, 0.35), 0), { x: b.r(1.2, 2.2), y: 1, z: b.r(2.4, 4.8) }, 0xc8b89a);
    b.geo('sand', driftGeo, { x: d + b.r(-2, 2), y: 0.015, z: s * 3.4 }, new THREE.Euler(0, b.r(-0.35, 0.35), 0), { x: b.r(2.4, 4.8), y: 1, z: b.r(1.1, 2.0) }, 0xc8b89a);
  }
  driftGeo.dispose();
}

function buildPerimeter(b: LevelBuilder) {
  b.region = 'perimeter';
  const B = 71;
  const H = 3.4;
  const gapN: Opening[] = [{ at: 0, w: 11, y0: 0, y1: H }];
  const gapE: Opening[] = [{ at: 0, w: 10, y0: 0, y1: H }];
  b.wall('cinder', 'x', -B, -B - 0.2, B + 0.2, 0, H, 0.4, gapN, 0xd6cfbf);
  b.wall('cinder', 'x', B, -B - 0.2, B + 0.2, 0, H, 0.4, gapN, 0xd6cfbf);
  b.wall('cinder', 'z', -B, -B + 0.2, B - 0.2, 0, H, 0.4, gapE, 0xd6cfbf);
  b.wall('cinder', 'z', B, -B + 0.2, B - 0.2, 0, H, 0.4, gapE, 0xd6cfbf);
  // caps
  for (const s of [-1, 1]) {
    for (const h of [-1, 1]) {
      b.deco('concrete', h * 38.3, H, s * B, 65.6, 0.1, 0.52, { color: 0xbdb7a8 });
      b.deco('concrete', s * B, H, h * 38, 0.52, 0.1, 66, { color: 0xbdb7a8 });
    }
  }
  // invisible boundary (characters only)
  for (const s of [-1, 1]) {
    b.solid(0, 0, s * (B + 0.8), 150, 40, 1).noRay = true;
    b.solid(s * (B + 0.8), 0, 0, 1, 40, 150).noRay = true;
  }

  // road blocks at the four exits
  P.jersey(b, -2.6, -68.5, 0.06);
  P.jersey(b, 2.7, -67.2, -0.05);
  P.cargoTruck(b, 0.8, -75.5, 0.35);
  P.hesco(b, -7.3, -69.6, Math.PI / 2, 2, 1);

  P.jersey(b, 2.4, 68.6, 0.04);
  P.jersey(b, -2.8, 67.4, -0.07);
  P.hesco(b, 0, 73.5, 0, 9, 2);

  P.jersey(b, -68.4, -2.2, Math.PI / 2 + 0.05);
  P.jersey(b, -67.2, 2.4, Math.PI / 2 - 0.04);
  P.pickup(b, -75, 0.5, 1.3, 0x8a8f96, true);
  P.rubble(b, -72.5, -3, 1.6, 14);

  P.jersey(b, 68.4, 2.2, Math.PI / 2 + 0.03);
  P.jersey(b, 67.3, -2.3, Math.PI / 2 - 0.06);
  P.hesco(b, 73.5, 0, Math.PI / 2, 8, 2);
}

function buildCenter(b: LevelBuilder, lvl: LevelData) {
  b.region = 'center';
  // --- Central Hadir Citadel Landmark Hub ---
  // Battle-damaged stepped stone fountain roundabout (usable crouch cover right at the crossroads)
  A.fountainPlaza(b, 0, 0, 3.6);
  // Iconic 15m sandstone clocktower / watch-minaret on the NW corner plaza (clear of kerbs & souk stalls)
  A.clockTowerLandmark(b, -9.6, -9.6, 0);
  // Two monumental stone archways framing the North and West Old Town boulevards
  A.citadelArch(b, 0, -13.2, 0, 9.2, 4.4, 1.45, 0xd8c6a2);
  A.citadelArch(b, -13.2, 0, Math.PI / 2, 8.2, 4.4, 1.45, 0xd8c6a2);

  // burning wreck hero-framed between the fountain roundabout and North Citadel Arch + 3D blast crater
  P.pickup(b, -2.1, -9.2, 0.32, 0x777777, true);
  b.model('prop_crater', -2.0, -0.02, -9.0, 0.4, { scale: { x: 0.42, y: 0.16, z: 0.42 }, color: 0x6e665c });
  lvl.fires.push(new THREE.Vector3(-1.8, 1.25, -9.1));
  P.sedan(b, -2.6, 7.4, 2.25, 0x8a8a84, true);
  // Photogrammetry cast-iron road manholes & sidewalk fire hydrants
  for (const [mx, mz] of [[2.2, 11.5], [-2.2, -16.5], [14.5, 1.8], [-18.5, -1.8]] as [number, number][]) {
    b.model('ph_manhole', mx, 0.014, mz, b.r(0, 6.28), { scale: 1.15 });
  }
  for (const [hx, hz, hr] of [[5.4, 9.2, -Math.PI / 2], [-5.4, -17.5, Math.PI / 2], [16.2, -5.0, 0], [-19.5, 5.0, Math.PI]] as [number, number, number][]) {
    P.solidProp(b, 'ph_hydrant', hx, hz, hr, 0.14, 0.9, { surface: 'metal', maxH: 0.78 });
  }
  P.rubble(b, 6.6, -6.4, 1.5, 18);
  P.rubble(b, -6.8, 6.6, 1.2, 12);
  P.jersey(b, -2.4, 14.5, 0.04);
  P.jersey(b, 2.5, 19.5, -0.03);
  P.jersey(b, 2.6, -15, 0.05);
  P.jersey(b, -2.3, -21, -0.02);
  P.jersey(b, -16, 2.2, Math.PI / 2 + 0.04);
  P.jersey(b, 18, -2.0, Math.PI / 2);
  P.tires(b, 4.0, 4.9, 3);
  P.sedan(b, 2.4, -34, Math.PI / 2 + 0.1, 0xa8a49a);
  P.pickup(b, -2.3, 36, Math.PI / 2 - 0.06, 0xd8d4c8);
  P.sedan(b, -24, -2.1, 0.05, 0x5a2f2a, true);
  P.pickup(b, 34, 2.0, Math.PI + 0.08, 0x44505a);
  lvl.barrels.push({ x: 4.6, y: 0, z: -3.4 }, { x: -24.5, y: 0, z: 0.4 });

  // utility poles + wires (pole at (-6.6, -6.6) clears the 15m Clocktower plinth cleanly)
  const lineA: THREE.Vector3[][] = [];
  for (const z of [-62, -42, -22, -8.2, 9, 30, 50, 66]) lineA.push(P.utilityPole(b, 7.3, z, Math.PI / 2));
  for (let i = 0; i < lineA.length - 1; i++) for (let k = 0; k < 3; k++) P.wire(b, lineA[i][k], lineA[i + 1][k], 0.8);
  const lineB: THREE.Vector3[][] = [];
  for (const x of [-64, -44, -24, -6.6, 26, 46, 64]) lineB.push(P.utilityPole(b, x, x === -6.6 ? -6.6 : -7.4, 0));
  for (let i = 0; i < lineB.length - 1; i++) for (let k = 0; k < 3; k++) P.wire(b, lineB[i][k], lineB[i + 1][k], 0.8);
  P.wire(b, lineA[3][1], lineB[3][1], 0.5);
  // service drops to buildings
  P.wire(b, lineA[2][0], new THREE.Vector3(12.2, 2.6, -24), 0.4);
  P.wire(b, lineB[2][2], new THREE.Vector3(-24, 6.2, -43), 1.0);

  // roadside palms — crossroads & boulevard trees framed in stone curb planters
  const planterPalms: [number, number, number][] = [
    [-7.6, -15.2, 7.5], [-7.8, 12.5, 8], [8.4, 26, 6.5], [-30, 7.4, 7], [22, 7.5, 7.6], [-36, -7.6, 8],
  ];
  for (const [x, z, h] of planterPalms) P.treePlanter(b, x, z, h, 1.15);
  const wildPalms: [number, number, number][] = [
    [-7.4, -33, 8.5], [8.6, -52, 7], [-7.5, 44, 7.5], [-52, 7.6, 8.2], [52, -7.9, 7],
  ];
  for (const [x, z, h] of wildPalms) P.tree(b, x, z, h);
}

// ---------------------------------------------------------------------------
// SE: forward operating base (player start)
// ---------------------------------------------------------------------------
function buildFOB(b: LevelBuilder, lvl: LevelData) {
  b.region = 'se';
  const R = Math.PI / 2;
  P.hesco(b, 21, 12, 0, 16, 2);
  P.hesco(b, 54.5, 12, 0, 30, 2);
  P.hesco(b, 12, 23.0, R, 19, 2);
  P.hesco(b, 12, 55.85, R, 27, 2);

  // gates
  P.sandbags(b, 27.6, 14.5, 0, 3.6, 5);
  P.sandbags(b, 40.2, 14.5, 0, 3.6, 5);
  P.sandbags(b, 14.5, 31.2, R, 3.6, 5);
  P.sandbags(b, 14.5, 43.2, R, 3.6, 5);
  P.jersey(b, 31.6, 9.3, 0.02);
  P.jersey(b, 36.4, 7.2, -0.03);
  P.jersey(b, 9.4, 35.4, R);
  P.jersey(b, 7.4, 39.8, R + 0.04);
  // boom gate
  b.box('metal', 29.4, 0, 12.9, 0.25, 1.1, 0.25, { color: 0xc9b23a });
  b.tube('metal', new THREE.Vector3(29.4, 1.05, 12.9), new THREE.Vector3(33.8, 2.9, 12.9), 0.045, 0xd8d4c8, 6);

  P.guardTower(b, 16.8, 16.8, Math.PI);
  // Reinforced concrete north-gate firing bunker with sandbag roof & interior field radio
  A.tacticalBunker(b, 23.0, 15.8, Math.PI, 4.2, 3.2);

  // helipad + 23k-tri Military Helicopter + perimeter beacon lights + windsock mast
  b.box('concrete', 52, 0, 34, 13, 0.06, 13, { color: 0xbab4a6, grime: 1, nav: false });
  P.helicopter(b, 52.0, 34.0, -Math.PI * 0.72, 0xc8c4b4);
  for (const [dx, dz] of [[-6.2, -6.2], [6.2, -6.2], [-6.2, 6.2], [6.2, 6.2], [0, -6.4], [0, 6.4], [-6.4, 0], [6.4, 0]]) {
    b.deco('darkmetal', 52 + dx, 0.06, 34 + dz, 0.24, 0.1, 0.24, { color: 0x303234 });
    b.deco('paint', 52 + dx, 0.16, 34 + dz, 0.14, 0.06, 0.14, { color: 0xe8a832 });
  }
  b.cyl('darkmetal', 59.2, 0, 39.2, 0.055, 5.2, 0x45484a, { segs: 8, collide: true });
  const sock = new THREE.CylinderGeometry(0.11, 0.28, 1.35, 10, 1, true);
  b.geo('fabric', sock, { x: 59.95, y: 4.9, z: 39.2 }, new THREE.Euler(0, 0, -Math.PI * 0.44), 1, 0xc84e24);
  sock.dispose();

  // command post: 4K-scanned concrete military HQ (exact 1:1 collider, zero air-walls!) + rooftop satellite dish flush on y=3.6 roof
  P.closedBuilding(b, 21, 51, 9, 7, 3.6, { color: 0xb9b3a4, doors: ['e'] });
  P.sandbags(b, 21, 46.9, 0, 5, 3);
  b.model('arch_sat_dish', 22.6, 3.60, 51.8, -0.7, { scale: 1.4 });

  P.tent(b, 44, 57, 0, 5, 7.5, 0x6a6f4c);
  P.tent(b, 51, 57, 0, 5, 7.5, 0x71765a);
  P.tent(b, 58, 57, 0, 5, 7.5, 0x666b48);
  P.container(b, 27, 0, 62.5, R, 0x55654a, true);
  P.container(b, 63, 0, 20.5, R, 0xa8946a);
  P.container(b, 66, 0, 20.5, R, 0x4f6a7a);
  P.container(b, 64.5, 2.59, 20.8, R + 0.04, 0x8a4a36);
  P.container(b, 66.4, 0, 46, 0, 0x6a705a);
  // Exposed steel-truss motor pool hangar shading a tactical 4x4 Humvee & Heavy Armored Truck
  A.steelTrussRoof(b, 45.2, 22.4, 0, 8.6, 9.8, 3.45, { bays: 2, roofColor: 0x6c7258, lamps: true });
  P.humvee(b, 45, 19.6, 0.1);
  P.armoredTruck(b, 45.4, 25.2, -0.07, 0xa99a78);
  P.forklift(b, 42.0, 42.6, 0.75);
  P.cargoTruck(b, 31.5, 52, 0.28);
  P.radioMast(b, 65.5, 65.5, 26);

  // supply point (flanking wooden crates offset 1.8m clear of the supply pallet & yellow ring!)
  lvl.supplies.push({ x: 38.6, z: 46.2, y: 0 });
  P.crate(b, 36.5, 0, 45.8, 0.9, 0.14, true);
  P.crate(b, 36.5, 0.54, 45.8, 0.78, -0.18, true);
  P.crate(b, 40.6, 0, 46.8, 0.9, 0.48, true);
  P.pallet(b, 39.4, 0, 48.2, 0.2);
  P.crate(b, 39.4, 0.12, 48.2, 0.8, 0.2);

  // FOB tactical staging enrichment: field-radio command desk outside HQ, motor-pool safety cones & medical staging
  P.solidProp(b, 'table', 26.8, 51.0, Math.PI / 2, 0, 0.82, { surface: 'wood', maxH: 0.78 });
  P.clutter(b, 'field_radio', 26.8, 50.7, 1.3, 0.78);
  P.clutter(b, 'clipboard', 26.8, 51.35, 1.8, 0.78);
  P.clutter(b, 'medical_box', 44.2, 52.8, 0.25, 0);
  P.clutter(b, 'ammo_box', 43.2, 52.6, 0.55, 0, 1.25);
  P.clutter(b, 'traffic_cone', 40.6, 17.6, 0.3);
  P.clutter(b, 'traffic_cone', 40.6, 27.2, 1.2);
  P.clutter(b, 'toolbox', 41.4, 22.4, 0.4);

  // generators + clutter
  P.solidProp(b, 'generator', 60, 44.5, 0.1, 0, 1.7);
  P.solidProp(b, 'compressor', 62.2, 44.2, 1.5, 0, 1.0);
  P.clutter(b, 'jerrycan', 59.1, 43.4, 0.6);
  P.clutter(b, 'jerrycan', 59.0, 43.9, 1.1);
  P.clutter(b, 'propane_tank', 61.2, 45.6, 0.3);
  P.barrel(b, 58.2, 30.2, 0x4a5a3a);
  P.barrel(b, 58.9, 30.6, 0x4a5a3a);
  P.barrel(b, 58.4, 31.0, 0x3f5d78);
  P.crate(b, 61.5, 0, 26, 1.0, 0.3);
  P.crate(b, 61.4, 1.0, 26.1, 0.8, 0.1);
  P.crate(b, 60.2, 0, 26.6, 0.9, -0.2);
  P.pallet(b, 61, 0, 28.5, 0.1);
  P.sandbags(b, 34, 30, 0.3, 4, 4);
  P.sandbags(b, 24.5, 36.5, -0.4, 3.4, 4);
  P.jersey(b, 30, 22, 0.5);
  P.tires(b, 47.5, 46, 2);
  for (const [x, z, r] of [[20, 62, 0.4], [56, 63, -0.4], [62.5, 38, -R]] as [number, number, number][]) {
    P.solidProp(b, 'street_light', x, z, r, 0, 1, { shrink: 0.4, maxH: 4 });
  }
  // Barbed wire flush along FOB perimeter HESCO tops (y = 2.74, exact non-gate spans)
  for (const x of [15.5, 21.0, 26.5]) b.model('barbed_wire', x, 2.74, 12, 0, { scale: { x: 1.1, y: 0.34, z: 1 } });
  for (const x of [41.5, 48.0, 54.5, 61.0, 67.5]) b.model('barbed_wire', x, 2.74, 12, 0, { scale: { x: 1.28, y: 0.34, z: 1 } });
  for (const z of [15.5, 20.5, 25.5, 30.5]) b.model('barbed_wire', 12, 2.74, z, R, { scale: { x: 1.0, y: 0.34, z: 1 } });
  for (const z of [44.0, 50.0, 56.0, 62.0, 68.0]) b.model('barbed_wire', 12, 2.74, z, R, { scale: { x: 1.18, y: 0.34, z: 1 } });
  b.model('security_light', 25.55, 2.6, 51, R, { scale: 0.72 });
  P.treePlanter(b, 22, 26, 7.2, 1.25);
  lvl.barrels.push({ x: 41.6, y: 0, z: 16.2 }, { x: 19.4, y: 0, z: 41 }, { x: 59.6, y: 0, z: 40.2 });
}

// ---------------------------------------------------------------------------
// NE: walled residential compound
// ---------------------------------------------------------------------------
function buildCompound(b: LevelBuilder, lvl: LevelData) {
  b.region = 'ne';
  const wc = 0xd2cbb9;
  const WH = 2.5;
  b.wall('cinder', 'x', -12, 12, 46, 0, WH, 0.3, [door(29, 4.2, WH)], wc);
  b.wall('cinder', 'x', -46, 12, 46, 0, WH, 0.3, [door(38, 2.2, WH)], wc);
  b.wall('cinder', 'z', 12, -45.85, -12.15, 0, WH, 0.3, [door(-27, 3.6, WH)], wc);
  b.wall('cinder', 'z', 46, -45.85, -12.15, 0, WH, 0.3, [], wc);
  // Monumental Kasbah archway framing the main south compound entrance + west gate posts
  A.citadelArch(b, 29, -12, 0, 4.4, 3.4, 1.1, 0xd4c8ae);
  for (const [x, z] of [[12, -25.05], [12, -28.95]] as [number, number][]) {
    b.box('concrete', x, 0, z, 0.5, WH + 0.35, 0.5, { color: 0xcfc8b8 });
  }
  // broken section of wall + rubble
  P.rubble(b, 46, -30, 1.4, 16);

  // --- House A: enterable, roof access by exterior stairs + walkable skybridge to East Watch-Terrace ---
  const col = 0xdccfb0;
  const x0 = 16, x1 = 28, z0 = -40, z1 = -30;
  const fy = 0.15, wh = 3.2;
  b.slab('concrete', x0, x1, z0, z1, 0, fy, 0xbdb6a6);
  const south = [door(20, 1.5, 2.3), win(25, 1.7)];
  const eastW = [win(-35, 1.7)];
  const westW = [win(-35, 1.7)];
  wallWithTrim(b, 'x', z1 - WALL_T / 2, x0, x1, fy, wh, south, col);
  wallWithTrim(b, 'x', z0 + WALL_T / 2, x0, x1, fy, wh, [], col);
  wallWithTrim(b, 'z', x0 + WALL_T / 2, z0 + WALL_T, z1 - WALL_T, fy, wh, westW, col);
  wallWithTrim(b, 'z', x1 - WALL_T / 2, z0 + WALL_T, z1 - WALL_T, fy, wh, eastW, col);
  A.dressBuildingFacade(b, x0, x1, z0, z1, fy + wh + 0.2, { crenellations: false });
  // interior partition
  b.wall('plaster', 'z', 22.6, z0 + WALL_T, z1 - WALL_T, fy, wh, 0.16, [door(-33, 1.3, 2.2)], 0xe3dac6);
  // roof + parapet (east parapet opened at z = -35 for the walkable skybridge)
  const ry = fy + wh;
  b.slab('concrete', x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2, ry, 0.2, 0xc4bdad);
  const rt = ry + 0.2;
  b.wall('plaster', 'x', z1 - 0.12, x0, x1, rt, 0.9, 0.24, [], col);
  b.wall('plaster', 'x', z0 + 0.12, x0, x1, rt, 0.9, 0.24, [{ at: 22.1, w: 2.4, y0: 0, y1: 0.9 }], col);
  b.wall('plaster', 'z', x0 + 0.12, z0 + 0.24, z1 - 0.24, rt, 0.9, 0.24, [], col);
  b.wall('plaster', 'z', x1 - 0.12, z0 + 0.24, z1 - 0.24, rt, 0.9, 0.24, [{ at: -35, w: 2.1, y0: 0, y1: 0.9 }], col);

  // Walkable ballistic-skirted tactical Skybridge linking House A roof to the East Watch-Terrace Bastion
  A.skybridge(b, x1, -35.0, 34.5, -35.0, rt, 2.0);
  // East Watch-Terrace Bastion: open stone arched carport on ground floor + fortified rooftop overlook
  const tx0 = 34.5, tx1 = 42.5, tz0 = -39.0, tz1 = -31.0;
  for (const px of [tx0 + 0.45, tx1 - 0.45]) {
    for (const pz of [tz0 + 0.45, tz1 - 0.45]) {
      b.box('cinder', px, 0, pz, 0.9, 0.95, 0.9, { color: 0xbfb49c, grime: 0.8 });
      b.box('plaster', px, 0.95, pz, 0.82, ry - 0.95, 0.82, { color: 0xd8cbb0, absGrime: true });
    }
  }
  b.slab('concrete', tx0 - 0.15, tx1 + 0.15, tz0 - 0.15, tz1 + 0.15, ry, 0.2, 0xc4bdad);
  A.dressBuildingFacade(b, tx0, tx1, tz0, tz1, rt, { crenellations: false });
  b.wall('plaster', 'x', tz1 - 0.12, tx0, tx1, rt, 0.9, 0.24, [], col);
  b.wall('plaster', 'x', tz0 + 0.12, tx0, tx1, rt, 0.9, 0.24, [], col);
  b.wall('plaster', 'z', tx0 + 0.12, tz0 + 0.24, tz1 - 0.24, rt, 0.9, 0.24, [{ at: -35, w: 2.1, y0: 0, y1: 0.9 }], col);
  b.wall('plaster', 'z', tx1 - 0.12, tz0 + 0.24, tz1 - 0.24, rt, 0.9, 0.24, [{ at: -32.2, w: 1.6, y0: 0, y1: 0.9 }], col);
  // Exterior stairs climbing up the east face of the Watch-Terrace (completing a full vertical flank loop)
  b.stairs('concrete', tx1 + 0.65, tz0 + 0.4, 0, 1, 1.2, 0, rt, 5.6, 0xc4bdad);
  b.box('concrete', tx1 + 0.65, 0, tz1 - 1.2, 1.2, rt, 1.6, { color: 0xc4bdad });
  b.box('concrete', tx1 + 1.2, rt, tz1 - 1.2, 0.12, 0.9, 1.6, { color: 0xc4bdad, nav: false });
  P.sandbags(b, 38.5, tz1 - 0.85, 0, 3.4, 3, rt, true);
  P.crate(b, 39.8, rt, -37.2, 0.85, 0.25, true);
  b.model('ammo_box', 37.2, rt, -32.4, 0.4, { scale: 1.15 });
  b.model('security_light', tx0 + 0.05, 2.7, -35.0, -Math.PI / 2, { scale: 0.68 });
  // exterior stairs along the north wall, climbing west
  b.stairs('concrete', 28.6, z0 - 0.65, -1, 0, 1.3, 0, rt, 6.0, 0xc4bdad);
  b.box('concrete', 21.75, 0, z0 - 0.65, 1.7, rt, 1.3, { color: 0xc4bdad });
  b.box('concrete', 21.75, rt, z0 - 1.24, 1.7, 0.9, 0.12, { color: 0xc4bdad, nav: false });
  b.box('concrete', 20.96, rt, z0 - 0.65, 0.12, 0.9, 1.3, { color: 0xc4bdad, nav: false });
  // furnishings
  b.box('wood', 25.6, fy, -37.2, 1.7, 0.76, 0.9, { color: 0x9a8262, nav: false });
  b.model('ph_shelves', 26.9, fy, -31.2, Math.PI / 2, {});
  b.box('fabric', 18.2, fy, -38.6, 2.0, 0.28, 1.0, { color: 0x8a8f96, nav: false, surface: 'fabric' });
  b.deco('fabric', 19.4, fy, -34.2, 3.2, 0.015, 2.2, { color: 0x9a3a2e });
  b.deco('fabric', 25.4, fy, -33, 2.4, 0.015, 1.8, { color: 0x3e5a6a });
  P.crate(b, 17.2, fy, -31.4, 0.8, 0.2);
  P.crate(b, 24.2, rt, -31.6, 0.9, 0.3);
  P.sandbags(b, 18.6, -30.9, 0, 3, 3, rt, true);
  b.model('arch_sat_dish', 26.5, rt, -38, 0.8, { scale: 1.5 });

  // --- House B: 29.6k-tri Mediterranean / Kasbah courtyard villa ---
  P.closedBuilding(b, 38.5, -22, 10, 12, 6.6, { color: 0xe0d6c0, doors: ['w'], balcony: ['w'], model: 'bldg_villa' });
  P.solidProp(b, 'prop_scaffolding', 44.6, -26.5, Math.PI / 2, 0, 0.8, { surface: 'metal' });

  // courtyard
  P.treePlanter(b, 15, -16, 8, 1.2);
  P.tree(b, 43, -42.5, 7);
  P.tree(b, 31.5, -17, 6.5);
  // Covered car parked cleanly beneath the East Watch-Terrace stone carport
  P.coveredCar(b, 38.5, -35.0, 0.05);
  // well on a raised flagstone courtyard patio
  b.box('concrete', 22, 0, -20, 6.2, 0.06, 6.2, { color: 0xc8c0ae, grime: 0.9, nav: false });
  b.cyl('cinder', 22, 0.06, -20, 1.0, 0.8, 0xd0c9b8, { segs: 14, collide: true, uv: 3 });
  b.cyl('darkmetal', 22, 0.66, -20, 0.8, 0.22, 0x1a2228, { segs: 14 });
  for (const s of [-1, 1]) b.deco('wood', 22 + s * 0.95, 0.06, -20, 0.1, 2.0, 0.1, { color: 0x6a5a44 });
  b.deco('wood', 22, 2.06, -20, 2.1, 0.1, 0.1, { color: 0x6a5a44 });
  // washing line
  b.deco('wood', 14.5, 0, -41, 0.08, 2.1, 0.08, { color: 0x6a5a44 });
  b.deco('wood', 14.5, 0, -32, 0.08, 2.1, 0.08, { color: 0x6a5a44 });
  P.wire(b, new THREE.Vector3(14.5, 2.05, -41), new THREE.Vector3(14.5, 2.05, -32), 0.15);
  for (const [z, c, w] of [[-39.5, 0xd9d2c0, 0.9], [-37.6, 0x7a8a9a, 0.7], [-35.4, 0xa8452f, 1.1], [-33.5, 0xd9d2c0, 0.8]] as [number, number, number][]) {
    b.deco('fabric', 14.5, 1.15, z, 0.015, 0.8, w, { color: c });
  }
  P.crate(b, 44, 0, -15, 0.9, 0.2);
  P.crate(b, 44.2, 0, -16.2, 0.7, -0.3);
  P.barrel(b, 13.6, -44.4, 0x6a4a3a);
  P.tires(b, 44.8, -40.5, 3);
  lvl.barrels.push({ x: 30.4, y: 0, z: -43.6 }, { x: 43.8, y: 0, z: -29 });

  // --- surrounding blocks ---
  P.closedBuilding(b, 59, -17, 13, 12, 6.6, { color: 0xd6c4a2, shop: ['w'], doors: ['s'] });
  P.closedBuilding(b, 60, -35, 12, 14, 9.9, { color: 0xcdbfa6, doors: ['w'], balcony: ['w'] });
  P.closedBuilding(b, 59, -57, 14, 14, 6.6, { color: 0xe0d2b4, doors: ['w', 's'] });
  P.closedBuilding(b, 22, -59, 16, 12, 6.6, { color: 0xd4c6a8, doors: ['s'], balcony: ['s'] });
  P.closedBuilding(b, 41, -60, 10, 10, 3.4, { color: 0xddd3be, shop: ['s'] });
  // alley dressing
  P.dumpster(b, 49.4, -40, Math.PI / 2);
  P.dumpster(b, 30.5, -50.4, 0.05, 0x5a5f66);
  P.barrel(b, 51.2, -26, 0x3f5d78);
  P.barrel(b, 51.6, -26.8, 0x6a4a3a);
  P.pallet(b, 50.6, 0, -47, 0.3);
  P.pallet(b, 50.6, 0.13, -47, 0.5);
  P.sedan(b, 49.6, -10.4, 0.04, 0xb9b4a6);
  P.rubble(b, 34, -52, 1.3, 14);
  P.crate(b, 10, 0, -50, 1.0, 0.4);
  P.crate(b, 10.2, 1.0, -50.1, 0.8, 0.1);
  P.crate(b, 9.6, 0, -51.3, 0.9, -0.2);
  P.tree(b, 50, -52, 7.5);
  P.tree(b, 68, -46, 8);
  lvl.barrels.push({ x: 52.4, y: 0, z: -45 });
}

// ---------------------------------------------------------------------------
// NW: market square + tea house
// ---------------------------------------------------------------------------
function buildMarket(b: LevelBuilder, lvl: LevelData) {
  b.region = 'nw';
  const cols = [0xa8452f, 0x3f6b66, 0xc9a23a, 0x5a6a8a, 0x8a4a6a, 0x4a7a4a, 0xb9652f, 0x3e5a7a];
  let ci = 0;
  for (const x of [-37, -30.5, -24, -17.5]) {
    P.marketStall(b, x, -29, 0, cols[ci++ % cols.length]);
    P.marketStall(b, x, -18, Math.PI, cols[ci++ % cols.length]);
  }
  P.marketStall(b, -15.6, -11.5, 0, 0xa8452f);
  P.marketStall(b, -41, -12, 0.12, 0x3f6b66);
  // Monumental East Bazaar Gateway framing entry from the main boulevard into the Grand Souk
  A.citadelArch(b, -10.6, -23.5, Math.PI / 2, 5.8, 3.9, 1.2, 0xd9c6a4);
  // paving of the square
  b.box('concrete', -27, 0, -23.5, 31, 0.07, 22, { color: 0xc9c2b2, grime: 1, nav: false });
  P.pickup(b, -13.5, -33, 0.5, 0x777777, true);
  P.crate(b, -40.5, 0, -23.5, 1.0, 0.2);
  P.crate(b, -40.3, 1.0, -23.4, 0.8, 0.5);
  P.crate(b, -39.2, 0, -24.4, 0.8, -0.1);
  P.crate(b, -20.8, 0, -23.6, 0.9, 0.3);
  P.pallet(b, -27.2, 0.07, -34.5, 0.1);
  P.barrel(b, -33.8, -34.6, 0x3f5d78);
  P.barrel(b, -15, -22.6, 0x6a4a3a);
  // Grounded timber-framed bazaar sun canopies & physically anchored bunting across the market square (sun-faded desert textiles)
  const canopyCols = [0x8e563e, 0xa89166, 0x52645c, 0x7d4c3e];
  [-37, -30.5, -24, -17.5].forEach((mx, i) => {
    P.streetCanopy(b, new THREE.Vector3(mx, 3.55, -27.7), new THREE.Vector3(mx, 3.55, -19.3), 2.6, canopyCols[i], 0.45, true);
  });
  // Bunting anchored directly from Tea House balcony rail corners to canopy timber posts, and post-to-post
  P.buntingLine(b, new THREE.Vector3(-44.54, 4.45, -20.0), new THREE.Vector3(-38.3, 3.55, -19.3), 0.35);
  P.buntingLine(b, new THREE.Vector3(-44.54, 4.45, -26.0), new THREE.Vector3(-38.3, 3.55, -27.7), 0.35);
  P.buntingLine(b, new THREE.Vector3(-35.7, 3.55, -27.7), new THREE.Vector3(-31.8, 3.55, -19.3), 0.4);
  P.buntingLine(b, new THREE.Vector3(-29.2, 3.55, -27.7), new THREE.Vector3(-25.3, 3.55, -19.3), 0.4);
  P.buntingLine(b, new THREE.Vector3(-22.7, 3.55, -27.7), new THREE.Vector3(-18.8, 3.55, -19.3), 0.4);
  // Landscaped stone tree planters framing the bazaar plaza
  P.treePlanter(b, -43.5, -36.5, 8.5, 1.35);
  P.treePlanter(b, -10.5, -31.8, 7, 1.25);
  P.treePlanter(b, -27, -11, 7.5, 1.3);
  // Outdoor Tea House seating & warm wall security light (mounted cleanly under balcony & above door)
  P.solidProp(b, 'bench', -44.8, -27.2, Math.PI / 2, 0.07, 1, { surface: 'wood', maxH: 0.5 });
  P.solidProp(b, 'bench', -44.8, -18.8, Math.PI / 2, 0.07, 1, { surface: 'wood', maxH: 0.5 });
  b.model('security_light', -45.95, 2.55, -23.0, Math.PI / 2, { scale: 0.72 });
  // Market Square supply point flush on y=0.07 paving slab; flanking cover crates offset 1.9m west so zero clipping!
  lvl.supplies.push({ x: -27.3, z: -23.6, y: 0.07 });
  P.crate(b, -29.3, 0.07, -23.5, 0.9, 0.12, true);
  P.crate(b, -29.2, 0.61, -23.5, 0.78, -0.18, true);
  // Grand Souk bazaar enrichment: woven goods crates, merchant barrels, folded carpets & overhead hanging lanterns
  P.clutter(b, 'wood_crate_a', -36.5, -27.6, 0.15, 0.07, 1.15);
  P.clutter(b, 'wood_crate_b', -21.2, -27.5, -0.22, 0.07, 1.15);
  P.clutter(b, 'wood_crate_a', -33.4, -19.2, 0.35, 0.07, 1.1);
  P.clutter(b, 'wood_crate_b', -21.5, -19.1, -0.3, 0.07, 1.1);
  P.barrel(b, -38.8, -19.8, 0x7c5a3e, 0.07);
  P.barrel(b, -17.8, -27.4, 0x6a4e3a, 0.07);
  for (const [lx, lz] of [[-35.5, -23.5], [-28.8, -23.5], [-22.2, -23.5]] as [number, number][]) {
    b.model('hanging_lamp', lx, 3.12, lz, 0, { scale: 0.64 });
  }
  lvl.barrels.push({ x: -42.2, y: 0.07, z: -33.6 }, { x: -11.6, y: 0, z: -40.4 }, { x: -34, y: 0.07, z: -12.6 });

  // --- Tea house: enterable, two storeys ---
  const col = 0xd9c7a3;
  const x0 = -58, x1 = -46, z0 = -30, z1 = -16;
  const fy = 0.15, wh = 3.2;
  b.slab('concrete', x0, x1, z0, z1, 0, fy, 0xbdb6a6);
  const e1 = [door(-23, 1.9, 2.4), win(-27.2, 1.6), win(-18.8, 1.6)];
  const w1 = [win(-27, 1.4), win(-19, 1.4, 1.3, 2.3)];
  const n1 = [win(-52, 1.7)];
  const s1 = [door(-49.5, 1.4, 2.3), win(-54.5, 1.4)];
  wallWithTrim(b, 'z', x1 - WALL_T / 2, z0 + WALL_T, z1 - WALL_T, fy, wh, e1, col);
  wallWithTrim(b, 'z', x0 + WALL_T / 2, z0 + WALL_T, z1 - WALL_T, fy, wh, w1, col);
  wallWithTrim(b, 'x', z0 + WALL_T / 2, x0, x1, fy, wh, n1, col);
  wallWithTrim(b, 'x', z1 - WALL_T / 2, x0, x1, fy, wh, s1, col);
  // first-floor slab with stairwell
  const f2 = fy + wh; // 3.35
  const hole = { x0: x0 + WALL_T, x1: x0 + WALL_T + 1.35, z0: -23.2, z1: -18.6 };
  b.slab('concrete', x0, x1, z0, z1, f2, 0.2, 0xc4bdad, hole);
  const t2 = f2 + 0.2; // 3.55
  b.stairs('concrete', x0 + WALL_T + 0.66, -17.4, 0, -1, 1.3, fy, t2, 5.75, 0xc4bdad);
  b.box('wood', hole.x1 + 0.04, t2, (hole.z0 + hole.z1) / 2, 0.07, 0.95, hole.z1 - hole.z0, { color: 0x7a6850, nav: false });
  b.box('wood', (hole.x0 + hole.x1) / 2, t2, hole.z1 + 0.04, 1.4, 0.95, 0.07, { color: 0x7a6850, nav: false });
  // upper walls
  const wh2 = 3.0;
  const e2 = [door(-23, 1.7, 2.3), win(-27.2, 1.6), win(-18.8, 1.6)];
  const w2 = [win(-27, 1.4), win(-21, 1.4)];
  const n2 = [win(-55, 1.5), win(-49, 1.5)];
  const s2 = [win(-55, 1.5), win(-49, 1.5)];
  wallWithTrim(b, 'z', x1 - WALL_T / 2, z0 + WALL_T, z1 - WALL_T, t2, wh2, e2, col);
  wallWithTrim(b, 'z', x0 + WALL_T / 2, z0 + WALL_T, z1 - WALL_T, t2, wh2, w2, col);
  wallWithTrim(b, 'x', z0 + WALL_T / 2, x0, x1, t2, wh2, n2, col);
  wallWithTrim(b, 'x', z1 - WALL_T / 2, x0, x1, t2, wh2, s2, col);
  // balcony
  b.box('concrete', x1 + 0.75, f2, -23, 1.5, 0.2, 6.4, { color: 0xc4bdad, nav: false });
  for (const y of [0.45, 0.95]) {
    b.deco('darkmetal', x1 + 1.46, t2 + y - 0.02, -23, 0.04, 0.04, 6.4, { color: 0x2c2c2c });
    b.deco('darkmetal', x1 + 0.75, t2 + y - 0.02, -26.18, 1.5, 0.04, 0.04, { color: 0x2c2c2c });
    b.deco('darkmetal', x1 + 0.75, t2 + y - 0.02, -19.82, 1.5, 0.04, 0.04, { color: 0x2c2c2c });
  }
  for (let z = -26.1; z <= -19.8; z += 0.45) b.deco('darkmetal', x1 + 1.46, t2, z, 0.025, 0.95, 0.025, { color: 0x2c2c2c });
  b.solid(x1 + 1.46, t2, -23, 0.06, 0.97, 6.4, 0, 'metal', false);
  b.solid(x1 + 0.75, t2, -26.18, 1.5, 0.97, 0.06, 0, 'metal', false);
  b.solid(x1 + 0.75, t2, -19.82, 1.5, 0.97, 0.06, 0, 'metal', false);
  for (const z of [-25.9, -20.1]) b.deco('wood', x1 + 1.3, 0, z, 0.12, f2, 0.12, { color: 0x7a6850 });
  // roof
  const r2 = t2 + wh2;
  b.slab('concrete', x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2, r2, 0.2, 0xc4bdad);
  for (const [ax, c, a0, a1] of [['x', z0 + 0.1, x0, x1], ['x', z1 - 0.1, x0, x1], ['z', x0 + 0.1, z0 + 0.2, z1 - 0.2], ['z', x1 - 0.1, z0 + 0.2, z1 - 0.2]] as ['x' | 'z', number, number, number][]) {
    b.wall('plaster', ax, c, a0, a1, r2 + 0.2, 0.5, 0.22, [], col);
  }
  // AAA stone cornice, mid-floor stringcourse, corner quoins & crenellated rooftop merlons
  A.dressBuildingFacade(b, x0, x1, z0, z1, r2 + 0.2, { floorY: f2, crenellations: true });
  b.cyl('metal', -55, r2 + 0.2, -27, 0.6, 1.2, 0x1e1e1e, { segs: 12 });
  // awning + sign over the entrance
  const aw = new THREE.BoxGeometry(1.6, 0.04, 3.4);
  b.geo('fabric', aw, { x: x1 + 0.78, y: 2.85, z: -23 }, new THREE.Euler(0, 0, -0.3), 1, 0x8a3a2a, 1.2);
  aw.dispose();
  b.deco('wood', x1 + 0.03, 2.95, -23, 0.05, 0.5, 2.6, { color: 0x4a3a2a });
  // ground-floor interior
  b.box('wood', -51.5, fy, -28.6, 5.0, 1.05, 0.7, { color: 0x7d674c });
  b.deco('wood', -51.5, fy + 1.05, -28.55, 5.2, 0.05, 0.9, { color: 0x5e4c38 });
  b.box('wood', -51.5, fy, -29.55, 5.0, 2.2, 0.3, { color: 0x6e5a42 });
  for (const [x, z] of [[-49.5, -24.5], [-52.5, -21], [-49, -19]] as [number, number][]) {
    b.cyl('wood', x, fy + 0.68, z, 0.55, 0.05, 0x8d7656, { segs: 14 });
    b.cyl('darkmetal', x, fy, z, 0.05, 0.68, 0x333333, { segs: 6 });
    b.solid(x, fy, z, 0.8, 0.73, 0.8, 0, 'wood', false);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + x;
      b.cyl('wood', x + Math.cos(a) * 0.95, fy, z + Math.sin(a) * 0.95, 0.17, 0.44, 0x6e5a42, { segs: 8 });
    }
  }
  b.deco('fabric', -50.5, fy, -22, 5.5, 0.015, 4, { color: 0x7a2e26 });
  // upper floor: sniper nest
  P.sandbags(b, x1 - 0.75, -27.2, Math.PI / 2, 2.0, 4, t2, true);
  b.box('fabric', -54.5, t2, -28.2, 2.0, 0.25, 1.0, { color: 0x6a705a, nav: false, surface: 'fabric' });
  P.crate(b, -47.4, t2, -17.4, 0.9, 0.2);
  P.crate(b, -49.5, t2, -28.8, 0.8, 0.4, true);
  b.deco('fabric', -51, t2, -21, 4, 0.015, 3, { color: 0x3e5a6a });

  // --- surrounding blocks (high-poly sculpted bazaar shops, villas & desert adobe) ---
  P.closedBuilding(b, -20, -51, 16, 14, 9.9, { color: 0xd2c2a0, shop: ['s'], balcony: ['s'], model: 'bldg_shop' });
  P.closedBuilding(b, -38, -52, 14, 12, 6.6, { color: 0xe0d4ba, shop: ['s'], model: 'bldg_villa' });
  P.closedBuilding(b, -58, -53, 14, 16, 6.6, { color: 0xcbbd9f, doors: ['e'], model: 'bldg_hacienda' });
  P.closedBuilding(b, -65, -37, 8, 9, 3.4, { color: 0xd8ccb2, doors: ['e'], model: 'bldg_adobe' });
  P.solidProp(b, 'prop_scaffolding', -58.8, -23.0, Math.PI / 2, 0, 0.85, { surface: 'metal' });
  P.dumpster(b, -46.4, -45.5, 0.02);
  P.rubble(b, -62, -22, 1.4, 16);
  P.tires(b, -44.6, -31.5, 2);
  P.coveredCar(b, -52, -11, 0.08, 0xd8d0c4);
  P.crate(b, -9.6, 0, -47, 1.0, 0.1);
  P.crate(b, -9.8, 0, -48.2, 0.8, 0.4);
  P.tree(b, -66, -14, 8);
  P.tree(b, -29.5, -62, 7);
}

// ---------------------------------------------------------------------------
// SW: petrol station, workshop, scrapyard
// ---------------------------------------------------------------------------
function buildIndustrial(b: LevelBuilder, lvl: LevelData, extras: THREE.Object3D[]) {
  b.region = 'sw';
  // --- petrol station: 17.2k-tri sculpted `arch_gas_station` + 4 high-poly `arch_gas_pump` dispensers ---
  const cx = -20, cz = 18;
  b.model('arch_gas_station', cx, 0, cz, 0, { scale: { x: 0.82, y: 0.76, z: 0.56 }, color: 0xf0e8d8 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.solid(cx + sx * 4.6, 0, cz + sz * 2.6, 0.55, 4.6, 0.55, 0, 'concrete');
  b.solid(cx, 4.4, cz, 13.0, 0.65, 8.6, 0, 'metal', false);
  for (const px of [-23.2, -16.8]) {
    b.box('concrete', px, 0, cz, 1.2, 0.16, 3.4, { color: 0xc9c3b6, nav: false });
    for (const pz of [-0.95, 0.95]) {
      b.model('arch_gas_pump', px, 0.16, cz + pz, Math.PI / 2, { scale: 0.9, color: 0xf4eee2 });
      b.solid(px, 0.16, cz + pz, 0.72, 1.62, 0.65, 0, 'metal', false);
    }
  }
  // 16.5k-tri Fuel Tanker Truck parked in the service apron between petrol pumps & industrial fuel silos
  P.tankerTruck(b, -34.5, 22.8, Math.PI / 2 + 0.08, 0xd8d0be);
  // sign
  b.box('darkmetal', -10.5, 0, 11, 0.3, 7, 0.3, { color: 0x77746a });
  const signTex = makeSignTexture((ctx, w, h) => {
    ctx.fillStyle = '#7e362a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#cfc5b0';
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.fillStyle = '#dcd4c2';
    ctx.font = 'bold 120px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PETROL', w / 2, h * 0.33);
    ctx.fillStyle = '#26231f';
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.fillText('DIESEL · 24H', w / 2, h * 0.82);
    // heavy sun-fade & desert dust weathering
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#483b2c';
    for (let i = 0; i < 95; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 4 + Math.random() * 34, 20 + Math.random() * 90);
  });
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, metalness: 0.2 });
  const signGeo = new THREE.BoxGeometry(3.6, 1.8, 0.2);
  const sign = new THREE.Mesh(signGeo, [new THREE.MeshStandardMaterial({ color: 0x55524a, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x55524a, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x55524a }), new THREE.MeshStandardMaterial({ color: 0x55524a }), signMat, signMat]);
  sign.position.set(-10.5, 7.2, 11);
  sign.rotation.y = 0.5;
  sign.castShadow = true;
  extras.push(sign);
  // kiosk + industrial twin fuel silo storage complex (1:1 exact walls/collider, zero air-walls)
  P.closedBuilding(b, -22, 31, 11, 7, 3.4, { color: 0xe6e2d6, shop: ['n'], doors: ['e'] });
  A.fuelSiloComplex(b, -33.2, 33.4, 0);
  // Pickup parked parallel in the outer fuel lane cleanly clear of the SW canopy column (-24.6, 20.6)!
  P.pickup(b, -26.6, 18.0, 0.06, 0x8a2f26);
  // Yellow steel pump-island safety bollards & service apron clutter
  for (const px of [-23.2, -16.8]) {
    for (const pz of [-2.05, 2.05]) b.cyl('paint', px, 0, cz + pz, 0.09, 0.88, 0xd4a428, { segs: 8, collide: true });
  }
  P.clutter(b, 'traffic_cone', -15.4, 15.2, 0.4);
  P.clutter(b, 'jerrycan', -18.2, 27.1, 0.35);
  P.clutter(b, 'toolbox', -19.2, 27.0, 1.1);
  P.tires(b, -28.5, 26.6, 2);
  P.barrel(b, -15.4, 27.2, 0x3f5d78);
  P.crate(b, -28.4, 0, 38.2, 0.9, 0.3);
  lvl.barrels.push({ x: -27.6, y: 0, z: 14.2 }, { x: -13.4, y: 0, z: 21.6 }, { x: -14.4, y: 0, z: 27.6 });
  P.waterTower(b, -12, 38.5);

  // --- workshop (enterable, with interior walkable steel mezzanine catwalk) ---
  const col = 0xc9c0ac;
  const x0 = -58, x1 = -42, z0 = 14, z1 = 28;
  const fy = 0.1, wh = 4.6;
  b.slab('concrete', x0, x1 + 1.5, z0, z1, 0, fy, 0xb5afa0);
  const bays = [door(18, 3.9, 3.5), door(24, 3.9, 3.5)];
  wallWithTrim(b, 'z', x1 - WALL_T / 2, z0 + WALL_T, z1 - WALL_T, fy, wh, bays, col);
  wallWithTrim(b, 'z', x0 + WALL_T / 2, z0 + WALL_T, z1 - WALL_T, fy, wh, [door(21, 1.4, 2.3)], col);
  wallWithTrim(b, 'x', z0 + WALL_T / 2, x0, x1, fy, wh, [win(-54, 2.2, 2.3, 3.5), win(-46.5, 2.2, 2.3, 3.5)], col);
  wallWithTrim(b, 'x', z1 - WALL_T / 2, x0, x1, fy, wh, [win(-54, 2.2, 2.3, 3.5), win(-46.5, 2.2, 2.3, 3.5)], col);
  b.slab('concrete', x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2, fy + wh, 0.22, 0xc4bdad);
  for (const [ax, c, a0, a1] of [['x', z0 + 0.1, x0, x1], ['x', z1 - 0.1, x0, x1], ['z', x0 + 0.1, z0 + 0.2, z1 - 0.2], ['z', x1 - 0.1, z0 + 0.2, z1 - 0.2]] as ['x' | 'z', number, number, number][]) {
    b.wall('plaster', ax, c, a0, a1, fy + wh + 0.22, 0.45, 0.22, [], col);
  }
  A.dressBuildingFacade(b, x0, x1, z0, z1, fy + wh + 0.22, { crenellations: false });
  // Walkable interior steel mezzanine catwalk along the north wall (overlooks bays & north clerestory windows)
  const mezY = 2.35;
  b.box('metal', -52.1, mezY - 0.1, 15.15, 11.0, 0.1, 1.7, { color: 0x5c6064, grime: 0.9 });
  b.stairs('metal', -43.0, 15.15, -1, 0, 1.1, fy, mezY, 3.6, 0x565a5e, false);
  for (const mx of [-57.4, -53.8, -50.2, -46.7]) {
    b.box('darkmetal', mx, fy, 15.94, 0.12, mezY - fy, 0.12, { color: 0x3b3f42 });
    b.cyl('darkmetal', mx, mezY, 15.96, 0.025, 0.96, 0x3b3f42, { segs: 6 });
  }
  b.tube('darkmetal', new THREE.Vector3(-57.6, mezY + 0.94, 15.96), new THREE.Vector3(-46.6, mezY + 0.94, 15.96), 0.026, 0x484c50, 8);
  b.tube('darkmetal', new THREE.Vector3(-57.6, mezY + 0.48, 15.96), new THREE.Vector3(-46.6, mezY + 0.48, 15.96), 0.02, 0x3b3f42, 6);
  b.solid(-52.1, mezY, 15.96, 11.0, 0.95, 0.06, 0, 'metal', false);
  b.model('ammo_box', -56.4, mezY, 14.9, 0.2, { scale: 1.15 });
  // Overhead industrial workshop lamps hanging from the roof slab
  for (const [lx, lz] of [[-53, 20.5], [-47, 18.2], [-47, 24.0]] as [number, number][]) {
    b.model('hanging_lamp', lx, fy + wh - 0.65, lz, 0, { scale: 0.72 });
    b.cyl('darkmetal', lx, fy + wh - 0.3, lz, 0.014, 0.32, 0x2e3032, { segs: 6 });
  }
  // half-raised roller shutter + fascia
  b.deco('corrugated', x1 - 0.1, 2.5, 18, 0.06, 1.1, 3.9, { color: 0x8a8d86, tile: 0.5 });
  b.deco('corrugated', x1 + 0.2, 3.75, 21, 0.1, 0.7, 13, { color: 0x5f7f8f });
  // interior: photogrammetry industrial shelving, welding cart, mechanic tool cart & forklift outside bay
  P.sedan(b, -48.2, 24.2, 0.03, 0x8a8a84, true);
  for (const z of [16.2, 19.8]) b.box('darkmetal', -49.6, fy, z, 0.25, 2.3, 0.3, { color: 0xb5402e, nav: false });
  b.box('wood', -51.5, fy, 14.85, 4.2, 0.9, 0.75, { color: 0x7d674c });
  b.deco('darkmetal', -51.5, fy + 0.9, 14.85, 4.3, 0.04, 0.8, { color: 0x4a4a48 });
  b.model('ph_shelves', -57.1, fy, 17.2, Math.PI / 2, {});
  b.model('ph_tool_cart', -52.6, fy, 27.1, 0, {});
  b.model('ph_welder', -46.2, fy, 26.8, -0.4, {});
  P.forklift(b, -38.8, 17.8, -0.35);
  P.tires(b, -56.8, 26.9, 4);
  P.tires(b, -55.8, 27.0, 2);
  P.barrel(b, -43.4, 27.0, 0x3f5d78, fy);
  // Offset static green barrel 1.25m south of explosive barrel (-43.6, 20.8) so zero clipping!
  P.barrel(b, -43.3, 22.0, 0x4a5a3a, fy);
  P.pallet(b, -55, fy, 22.5, 0.4);
  P.crate(b, -55, fy + 0.12, 22.5, 0.8, 0.4);
  // Workshop supply point flush on y=fy slab; flanking crates offset 1.9m west clear of supply ring!
  lvl.supplies.push({ x: -53.2, z: 17.8, y: fy });
  P.crate(b, -55.2, fy, 17.9, 0.9, 0.25, true);
  P.crate(b, -55.1, fy + 0.54, 17.9, 0.78, 0.12, true);
  P.clutter(b, 'toolbox', -51.5, 14.85, 0.4, fy + 0.94);
  P.clutter(b, 'ammo_box', -53.2, 14.85, -0.2, fy + 0.94, 1.15);
  lvl.barrels.push({ x: -43.6, y: fy, z: 20.8 }, { x: -39, y: 0, z: 29.6 });
  P.dumpster(b, -39.6, 14.6, 0.03, 0x4a5a6a);
  P.pallet(b, -38.5, 0, 22, 0.2);

  // --- scrapyard ---
  P.corrugatedFence(b, 'x', 42, -62, -36);
  P.corrugatedFence(b, 'x', 42, -30, -14);
  P.corrugatedFence(b, 'z', -14, 42, 66);
  P.corrugatedFence(b, 'z', -62, 42, 66);
  P.corrugatedFence(b, 'x', 66, -62, -14);
  P.container(b, -55, 0, 60, 0.05, 0x7a4636);
  P.container(b, -55.2, 2.59, 60.2, 0.0, 0x4a5f6a);
  P.container(b, -24, 0, 61, Math.PI / 2 + 0.1, 0x8a8468, true);
  P.sedan(b, -44, 49, 0.4, 0x777777, true);
  P.pickup(b, -36, 57, 1.9, 0x777777, true);
  P.coveredCar(b, -47, 57.5, -0.3, 0xc9c2b4);
  P.sedan(b, -29, 48, 2.8, 0x777777, true);
  P.pickup(b, -19.5, 50, 0.1, 0x4a5f4a);
  P.tires(b, -40, 44.2, 4);
  P.tires(b, -39, 44.4, 3);
  P.tires(b, -16.2, 44.6, 4);
  P.tires(b, -51.5, 44.6, 2);
  P.rubble(b, -33, 62.5, 1.6, 20, 0x8a8478);
  P.barrel(b, -60, 45, 0x6a4a3a);
  P.barrel(b, -59.2, 45.4, 0x3f5d78);
  P.crate(b, -17, 0, 63, 1.0, 0.2);
  lvl.barrels.push({ x: -50.6, y: 0, z: 52 }, { x: -26, y: 0, z: 54.6 });

  P.closedBuilding(b, -65.5, 34.5, 8, 10, 6.6, { color: 0xd0c4aa, doors: ['e'] });
  P.tree(b, -63, 11, 8);
  P.tree(b, -38.8, 38.6, 7);
  P.tree(b, -9.6, 62, 7.5);
  P.tree(b, -9.4, 50, 6.5);
}

function buildBackground(b: LevelBuilder) {
  b.region = 'bg';
  b.shadows = false;
  const placed: { x: number; z: number; w: number; d: number }[] = [];
  const cols = [0xc8b492, 0xb9a88c, 0xa89b86, 0xd1bfa0, 0x9f9584, 0xc2aa86, 0xb0a594, 0xc6ae8a];

  // Dense inner urban sprawl ring (76m..158m): 86 stepped Middle-Eastern concrete/plaster apartment blocks
  let tries = 0;
  while (placed.length < 86 && tries++ < 2200) {
    const nearRing = placed.length < 44;
    const range = nearRing ? 124 : 162;
    const x = b.r(-range, range), z = b.r(-range, range);
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m < 78 || Math.abs(x) < 11.5 || Math.abs(z) < 11.5) continue;
    const w = b.r(10, 18), d = b.r(10, 18);
    if (placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 2.8 && Math.abs(p.z - z) < (p.d + d) / 2 + 2.8)) continue;
    placed.push({ x, z, w, d });
    const h = b.pick([4.6, 6.8, 9.8, 12.6, 15.4]);
    P.closedBuilding(b, x, z, w, d, h, { color: b.pick(cols), collide: false, detail: 0.25, roof: false });
  }
  // Distant skyline landmarks: desert minarets, water towers & radio masts breaking the horizon silhouette
  for (const [mx, mz, mh] of [[-96, -112, 23], [116, -98, 25], [-118, 96, 21], [108, 114, 24]] as [number, number, number][]) {
    b.deco('plaster', mx, 0, mz, 3.8, mh * 0.72, 3.8, { color: 0xcabca0 });
    b.deco('concrete', mx, mh * 0.72, mz, 4.6, 0.35, 4.6, { color: 0xb8ae9a });
    const dome = new THREE.SphereGeometry(1.7, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    b.geo('metal', dome, { x: mx, y: mh * 0.72 + 0.35, z: mz }, null, { x: 1, y: 1.4, z: 1 }, 0x626c62);
    dome.dispose();
    b.cyl('darkmetal', mx, mh * 0.72 + 2.4, mz, 0.06, 3.2, 0x35383a, { segs: 5 });
  }
  P.waterTower(b, -94, -84);
  P.waterTower(b, 106, -86);
  P.radioMast(b, -138, 126, 34);
  P.radioMast(b, 148, -132, 38);

  // Photogrammetry sandstone outcrops & boulders ringing the city outskirts into the foothills
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2 + b.r(-0.08, 0.08);
    const dist = b.r(156, 215);
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    if (Math.abs(x) < 16 || Math.abs(z) < 16) continue;
    const s = b.r(2.2, 4.8);
    const kind = b.pick(['boulder_a', 'boulder_b', 'boulder_c'] as const);
    b.model(kind, x, -0.45 * s, z, Math.atan2(-x, -z) + b.r(-0.6, 0.6), {
      scale: { x: s * b.r(1.0, 1.4), y: s * b.r(0.75, 1.3), z: s * b.r(1.0, 1.4) },
      color: 0xb89e7e,
    });
  }

  for (let i = 0; i < 58; i++) {
    const x = b.r(-162, 162), z = b.r(-162, 162);
    if (Math.max(Math.abs(x), Math.abs(z)) < 76 || Math.abs(x) < 7 || Math.abs(z) < 7) continue;
    if (placed.some((p) => Math.abs(p.x - x) < p.w / 2 + 1.5 && Math.abs(p.z - z) < p.d / 2 + 1.5)) continue;
    P.tree(b, x, z, b.r(6, 10), false);
  }
  // poles marching off down the roads
  for (const d of [86, 106, 126, 146]) {
    for (const s of [-1, 1]) {
      P.utilityPole(b, 7.3, s * d, Math.PI / 2);
      P.utilityPole(b, s * d, -7.4, 0);
    }
  }
  b.shadows = true;
}

/** Distant ridgelines: high-res multi-tiered desert sandstone canyons, mesa plateaus & sharp craggy peaks. */
export function buildMountains(mats: Materials, sunAz: number) {
  const noise = new TileNoise(907);
  const N = 520, M = 48;
  const R0 = 178, R1 = 780;
  const pos = new Float32Array((N + 1) * (M + 1) * 3);
  const col = new Float32Array((N + 1) * (M + 1) * 3);
  const height = (u: number, v: number) => (heightRaw(u, v) + 6) * pass(u) - 6;
  /** A broad pass in the range where the low sun sits, so it is never hidden behind a ridge. */
  const pass = (u: number) => {
    let d = Math.abs(u * Math.PI * 2 - sunAz) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return 1 - 0.84 * Math.exp(-(d * d) / (0.28 * 0.28));
  };
  const heightRaw = (u: number, v: number) => {
    // 3 geological tiers: rugged rocky foothills -> stepped sandstone canyon mesas -> jagged high peaks
    const n = noise.fbm2(u, v, 26, 4, 5, 0.54);
    const fine = noise.fbm2(u + 0.19, v + 0.63, 52, 9, 3, 0.5);
    const ridge = 1 - Math.abs(noise.fbm2(u + 0.37, v + 0.11, 11, 3, 5, 0.52) * 2 - 1);
    const ridge2 = 1 - Math.abs(noise.fbm2(u + 0.61, v + 0.29, 24, 5, 4, 0.5) * 2 - 1);
    const big = noise.fbm2(u + 0.71, v + 0.53, 5, 1, 2);
    // Foothill rocky spurs starting close at R0
    const near = Math.pow(Math.sin(Math.PI * clamp(v / 0.36, 0, 1)), 1.1) * (6 + Math.pow(ridge2, 1.5) * 18 + n * 16);
    // Dramatic mid-distance stratified mesa terraces
    const rawMid = Math.pow(Math.sin(Math.PI * clamp((v - 0.12) / 0.62, 0, 1)), 0.95) * (12 + Math.pow(ridge, 1.8) * 58 * (0.45 + big * 0.85));
    const terrace = Math.floor(rawMid / 11) * 11 + Math.pow((rawMid % 11) / 11, 0.45) * 11;
    const mid = rawMid * 0.65 + terrace * 0.35;
    // Far towering jagged alpine desert ridgeline
    const far = Math.pow(Math.sin(Math.PI * clamp((v - 0.24) / 0.76, 0, 1)), 0.85) * (18 + Math.pow(ridge, 2.0) * 108 * (0.4 + big * 1.0) + ridge2 * 18 + (fine - 0.5) * 10);
    return Math.max(near, mid, far) - 6;
  };
  for (let j = 0; j <= M; j++) {
    const v = j / M;
    const r = R0 + (R1 - R0) * Math.pow(v, 1.25);
    for (let i = 0; i <= N; i++) {
      const u = (i % N) / N;
      const a = u * Math.PI * 2;
      const k = (j * (N + 1) + i) * 3;
      pos[k] = Math.cos(a) * r;
      pos[k + 1] = height(u, v);
      pos[k + 2] = Math.sin(a) * r;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let j = 0; j <= M; j++) {
    const a = j * (N + 1), b = a + N;
    const nx = nor.getX(a) + nor.getX(b), ny = nor.getY(a) + nor.getY(b), nz = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l);
    nor.setXYZ(b, nx / l, ny / l, nz / l);
  }
  // make sure the surface faces up (winding depends on the polar direction)
  if (nor.getY(Math.floor(M / 2) * (N + 1) + 7) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.setIndex(idx);
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  }
  for (let j = 0; j <= M; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const u = (i % N) / N, v = j / M;
      const slope = 1 - nor.getY(k);
      const strata = noise.fbm2(u, pos[k * 3 + 1] / 260, 40, 24, 3);
      const dust = noise.fbm2(u + 0.2, v + 0.6, 60, 8, 3);
      // sandy talus on gentle slopes, darker banded rock on steep faces
      const t = clamp(slope * 2.4 + (strata - 0.5) * 0.5, 0, 1);
      const s = 0.82 + dust * 0.3;
      // (linear albedo — kept low so the low sun doesn't bleach sun-facing slopes)
      col[k * 3] = (0.215 - t * 0.095) * s;
      col[k * 3 + 1] = (0.142 - t * 0.066) * s;
      col[k * 3 + 2] = (0.086 - t * 0.04) * s;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, mats.rock);
  m.name = 'mountains';
  m.userData.noAo = true;
  m.matrixAutoUpdate = false;
  m.frustumCulled = false;
  return m;
}

/** Scanned set dressing: street furniture, supplies, rubbish, rocks and scrub. */
function buildDressing(b: LevelBuilder, world: World) {
  const C = P.clutter;
  const S = P.solidProp;

  // --- FOB ---
  b.region = 'se';
  S(b, 'table', 47.5, 49.6, 0.12, 0, 0.82, { surface: 'wood', maxH: 0.78 });
  C(b, 'ph_laptop', 47.5, 49.5, 0.3, 0.78);
  C(b, 'chair', 45.2, 48.2, 2.2);
  C(b, 'chair', 50.0, 51.6, -0.9);
  C(b, 'ammo_box', 37.5, 47.4, 0.4, 0, 1.3);
  C(b, 'ammo_box', 37.9, 47.7, 1.3, 0, 1.3);
  C(b, 'ammo_box', 37.6, 47.8, -0.3, 0.24, 1.3);
  C(b, 'mil_crate_open', 41.8, 48.2, 0.5);
  C(b, 'jerrycan', 43.2, 20.6, 0.2);
  C(b, 'jerrycan', 43.3, 21.1, 0.9);
  C(b, 'wood_crate_b', 25.6, 47.6, 1.4, 0, 1.25);
  C(b, 'wood_crate_a', 24.0, 55.4, 0.1, 0, 1.3);
  S(b, 'utility_box', 25.2, 54.75, Math.PI, 0, 1.15);
  C(b, 'cement_bag', 15.2, 26.5, 0.3);
  C(b, 'cement_bag', 15.4, 27.3, 1.2);
  C(b, 'cement_bag', 15.25, 26.9, 0.7, 0.18);
  C(b, 'cardboard_box', 56.2, 51.6, 0.4);
  C(b, 'cardboard_box', 56.9, 51.9, 1.3, 0, 0.8);
  C(b, 'plastic_crate', 49.2, 52.4, 0.2, 0, 1.2);
  C(b, 'wheel_rim', 47.9, 22.8, 0.5);
  C(b, 'trash_can', 26.8, 46.6, 0.9);

  // --- compound ---
  b.region = 'ne';
  C(b, 'chair', 17.4, -33.2, 0.8, 0.15);
  C(b, 'chair', 26.6, -34.6, -2.2, 0.15);
  C(b, 'plastic_crate', 23.5, -38.9, 0.3, 0.15, 1.2);
  C(b, 'cardboard_box', 17.0, -39.0, 0.6, 0.15);
  C(b, 'trash_can_rust', 29.2, -29.2, 0.2);
  C(b, 'propane_tank', 28.7, -36.6, 1.0);
  C(b, 'jerrycan', 20.4, -19.2, 0.4);
  C(b, 'wheel_rim', 34.0, -31.8, 1.1);
  C(b, 'trash_bags', 44.6, -44.4, 0.8, 0, 0.9);
  C(b, 'cement_bag', 45.0, -31.4, 0.5);
  C(b, 'cement_bag', 44.6, -32.2, 2.0);
  C(b, 'trash_bags', 52.2, -52.8, 2.1, 0, 0.9);
  C(b, 'cardboard_box', 51.4, -31.5, 0.3);
  C(b, 'cardboard_box', 51.9, -32.1, 1.2, 0, 0.85);
  C(b, 'trash_can', 51.3, -20.5, 0.4);
  S(b, 'utility_box', 52.25, -12.4, Math.PI / 2, 0, 1.15);

  // --- market ---
  b.region = 'nw';
  for (const [x, z, r] of [[-35.2, -24.6, 0.3], [-33.9, -22.8, 1.8], [-22.4, -24.8, 2.9], [-30.6, -21.9, 4.1]] as [number, number, number][]) C(b, 'chair', x, z, r, 0.07);
  for (const [x, z, r] of [[-38.6, -27.4, 0.2], [-38.0, -27.3, 1.1], [-25.4, -19.6, 0.5], [-18.9, -27.5, 2.2], [-31.8, -19.7, 0.9]] as [number, number, number][]) C(b, 'plastic_crate', x, z, r, 0.07, 1.25);
  C(b, 'plastic_crate', -38.3, -27.35, 0.6, 0.07 + 0.33, 1.25);
  C(b, 'cardboard_box', -24.6, -27.6, 0.7, 0.07);
  C(b, 'cardboard_box', -16.2, -19.4, 1.5, 0.07, 0.85);
  C(b, 'trash_can_rust', -43.0, -21.5, 0.3);
  C(b, 'trash_bags', -44.2, -40.2, 1.0, 0, 0.9);
  C(b, 'chair', -48.2, -20.4, 0.4, 0.15);
  C(b, 'chair', -53.6, -22.3, 2.6, 0.15);
  C(b, 'wood_crate_a', -47.3, -29.0, 0.1, 0.15, 1.2);
  C(b, 'propane_tank', -57.0, -29.2, 0.3, 0.15);
  C(b, 'jerrycan', -13.9, -34.6, 0.4);
  S(b, 'utility_box', -44.75, -45.6, -Math.PI / 2, 0, 1.15);

  // --- industrial ---
  b.region = 'sw';
  C(b, 'wheel_rim', -56.1, 25.6, 0.3, 0.1);
  C(b, 'wheel_rim', -55.4, 26.3, 1.4, 0.1);
  C(b, 'jerrycan', -50.2, 15.6, 0.2, 0.1);
  C(b, 'jerrycan', -50.7, 15.5, 1.0, 0.1);
  C(b, 'propane_tank', -57.0, 19.8, 0.6, 0.1);
  C(b, 'propane_tank', -57.0, 20.5, 2.1, 0.1);
  S(b, 'compressor', -45.2, 16.2, 0.4, 0.1, 1.0);
  C(b, 'plastic_crate', -52.2, 26.4, 0.4, 0.1, 1.2);
  C(b, 'cardboard_box', -44.2, 27.1, 0.2, 0.1);
  C(b, 'trash_can_rust', -41.2, 12.9, 0.5);
  C(b, 'wheel_rim', -41.8, 46.0, 0.9);
  C(b, 'wheel_rim', -30.4, 51.6, 2.2);
  C(b, 'wheel_rim', -18.4, 53.8, 0.1);
  C(b, 'trash_bags', -20.4, 44.6, 0.3, 0, 0.9);
  C(b, 'trash_bags', -58.6, 49.0, 1.7, 0, 1.0);
  C(b, 'jerrycan', -26.6, 21.6, 0.7);
  C(b, 'propane_tank', -27.2, 27.3, 0.2);
  C(b, 'propane_tank', -27.8, 27.4, 1.2);
  C(b, 'trash_can', -16.6, 30.2, 0.3);
  S(b, 'utility_box', -16.2, 34.8, 0, 0, 1.15);

  // --- street lamps along both roads ---
  b.region = 'center';
  for (const z of [-56, -31, 17, 41, 61]) S(b, 'street_lamp', z % 2 ? -5.6 : 5.6, z, 0, 0, 1.3, { shrink: 0.3, maxH: 4 });
  for (const x of [-57, -33, -15, 15, 39, 59]) S(b, 'street_lamp', x, x % 2 ? 5.1 : -5.1, Math.PI / 2, 0, 1.3, { shrink: 0.3, maxH: 4 });

  // Tactical urban dressing: scanned barriers, dumpsters, industrial compressors, generators & debris (verified clear of kerbs & planters)
  P.dumpster(b, -7.4, -17.2, 0.05);
  P.dumpster(b, 7.2, 16.5, Math.PI - 0.1);
  P.dumpster(b, -18.5, 6.8, Math.PI / 2);
  P.dumpster(b, 22.4, -6.8, -Math.PI / 2);
  // Road barrier shifted to eastbound chicane lane (2.8, 10.6) cleanly clear of burned sedan at (-2.6, 7.4)!
  S(b, 'road_barrier_b', 2.8, 10.6, -0.14, 0, 1.0, { surface: 'concrete' });
  S(b, 'road_barrier', 3.2, -8.6, -0.1, 0, 1.0, { surface: 'concrete' });
  C(b, 'traffic_cone', 1.4, 10.4, 0.4);
  C(b, 'traffic_cone', 1.8, -8.8, 1.2);
  // Crossroads & avenue storytelling clutter (cleanly on sidewalks clear of kerbs & vehicles)
  C(b, 'cardboard_box', 6.8, 12.6, 0.3);
  C(b, 'plastic_crate', 6.9, 13.4, 1.1, 0, 1.15);
  C(b, 'trash_can_rust', -6.8, -12.6, 0.5);
  C(b, 'traffic_cone', -6.2, 8.8, 0.9);
  C(b, 'jerrycan', 7.1, 20.2, 0.7);
  P.pallet(b, 7.2, 0, -22.4, 0.25);
  P.pallet(b, 7.2, 0.12, -22.4, 0.4);
  C(b, 'cement_bag', 7.3, -22.3, -0.2, 0.26);
  S(b, 'generator', -7.2, 24.5, Math.PI / 2, 0, 1.1, { surface: 'metal' });
  S(b, 'compressor', 7.2, -38.2, -Math.PI / 2, 0, 1.0, { surface: 'metal' });
  C(b, 'cardboard_stack', -7.2, -28.4, 0.1);
  S(b, 'plastic_bin', 7.2, 32.5, -0.4, 0, 1.0, { maxH: 0.45, surface: 'fabric' });

  // --- boulders, outcrops and scrub ---
  b.region = 'scatter';
  const boulders: [string, number, number, number, number][] = [
    ['boulder_a', 10.2, -67.2, 0.4, 1.0], ['boulder_c', -12.0, 62.6, 2.0, 1.3], ['boulder_a', -67.0, 64.6, 3.0, 1.0],
    ['boulder_c', -59.6, -10.0, 1.0, 1.1], ['boulder_c', 63.6, 8.0, 5.2, 1.0],
  ];
  for (const [n, x, z, r, s] of boulders) S(b, n as 'boulder_a', x, z, r, -0.05 * s, s, { surface: 'concrete', shrink: 0.7, maxH: 1.4 });
  // outside the walls: big outcrops between the town and the foothills (decor only)
  b.shadows = false;
  for (let i = 0; i < 26; i++) {
    const a = b.r(0, Math.PI * 2);
    const d = b.r(180, 232);
    const s = b.r(1.6, 4.2);
    b.model(b.pick(['cliff', 'cliff', 'boulder_a', 'boulder_b'] as const), Math.cos(a) * d, -0.4 * s, Math.sin(a) * d, b.r(0, 6.28), { scale: { x: s, y: s * b.r(0.7, 1.3), z: s }, color: 0xd9c6ad });
  }
  for (let i = 0; i < 40; i++) {
    const x = b.r(-170, 170), z = b.r(-170, 170);
    if (Math.max(Math.abs(x), Math.abs(z)) < 74 || Math.abs(x) < 8 || Math.abs(z) < 8) continue;
    b.model('rock', x, -0.1, z, b.r(0, 6.28), { scale: b.r(0.8, 2.2), color: 0xe2d2bb });
  }
  b.shadows = true;

  // scrub, stones and small rocks on open sand inside the walls
  const blocked = (x: number, z: number, m: number) => {
    if (Math.abs(x) < 6.6 + m || Math.abs(z) < 6.0 + m) return true;
    for (const c of world.colliders) {
      if (c.minY > 0.6) continue;
      if (x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m) return true;
    }
    return false;
  };
  let placed = 0;
  for (let i = 0; i < 2600 && placed < 420; i++) {
    const x = b.r(-70, 70), z = b.r(-70, 70);
    const t = b.rnd();
    if (blocked(x, z, t < 0.3 ? 0.5 : 0.25)) continue;
    placed++;
    if (t < 0.12) b.model('bush_l', x, -0.02, z, b.r(0, 6.28), { scale: b.r(1.1, 1.9), color: 0xd8d2b4 });
    else if (t < 0.3) b.model(b.rnd() < 0.5 ? 'bush_m' : 'bush_s', x, -0.02, z, b.r(0, 6.28), { scale: b.r(1.0, 1.8), color: 0xd8d2b4 });
    else {
      // loose rocks, from pebbles to shin-high stones
      const s = t < 0.4 ? b.r(0.2, 0.42) : b.r(0.05, 0.16);
      b.model('rock', x, -0.03 * s, z, b.r(0, 6.28), { scale: { x: s, y: s * b.r(0.7, 1.2), z: s * b.r(0.7, 1.1) }, color: 0xe6d8c2 });
    }
  }
  // scrub outside the walls, thinning out with distance
  b.shadows = false;
  for (let i = 0; i < 420; i++) {
    const x = b.r(-150, 150), z = b.r(-150, 150);
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m < 72.5 || Math.abs(x) < 6 || Math.abs(z) < 6) continue;
    if (m > 100 || b.rnd() < 0.5) b.model('rock', x, -0.05, z, b.r(0, 6.28), { scale: b.r(0.2, 0.9), color: 0xe2d2bb });
    else b.model(b.pick(['bush_l', 'bush_m', 'bush_l'] as const), x, -0.02, z, b.r(0, 6.28), { scale: b.r(1.4, 2.6), color: 0xd0c8a8 });
  }
  b.shadows = true;
}

function helipadMarking() {
  const tex = makeSignTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(232,226,208,0.85)';
    ctx.fillStyle = 'rgba(232,226,208,0.85)';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(w * 0.3, h * 0.26, w * 0.09, h * 0.48);
    ctx.fillRect(w * 0.61, h * 0.26, w * 0.09, h * 0.48);
    ctx.fillRect(w * 0.3, h * 0.455, w * 0.4, h * 0.09);
    // wear
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 500; i++) {
      ctx.globalAlpha = Math.random() * 0.6;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 512, 512);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(52, 0.065, 34);
  m.receiveShadow = true;
  return m;
}

export function buildLevel(world: World, mats: Materials, sunAz: number): LevelData {
  const b = new LevelBuilder(world, mats);
  const extras: THREE.Object3D[] = [];
  const lvl: LevelData = {
    id: 'survival',
    group: new THREE.Group(),
    map: { half: 76, roads: [[0, 0, 152, 8], [0, 0, 9, 152]] },
    targets: [],
    menuCamera(t, cam) {
      const a = t * 0.038 + 0.55;
      const R = 32 + Math.sin(t * 0.05) * 4;
      cam.position.set(Math.cos(a) * R + 2, 7.4 + Math.sin(t * 0.08) * 1.4, Math.sin(a) * R + 2);
      cam.lookAt(-2.5, 3.6, -3.0);
    },
    playerSpawn: { x: 36, z: 42, yaw: Math.PI / 4 },
    spawnPoints: [
      { x: 0, z: -62 }, { x: -62, z: -1 }, { x: 62, z: 1 }, { x: 1, z: 62 },
      { x: -67.5, z: -44 }, { x: -44, z: -67 }, { x: 33, z: -67.5 }, { x: 68, z: -46.5 },
      { x: -40, z: 68.5 }, { x: -66.5, z: 26 }, { x: 68, z: -8.6 }, { x: -8.5, z: 68 },
    ],
    barrels: [],
    supplies: [],
    fires: [],
    plumes: [new THREE.Vector3(-170, 0, -210), new THREE.Vector3(230, 0, -120), new THREE.Vector3(90, 0, 250), new THREE.Vector3(-260, 0, 90)],
    bound: 70.4,
  };
  world.groundSurface = (x, z) => (Math.abs(x) < 4.5 || Math.abs(z) < 4 ? 'asphalt' : 'sand');

  buildGround(b);
  buildPerimeter(b);
  buildCenter(b, lvl);
  buildFOB(b, lvl);
  buildCompound(b, lvl);
  buildMarket(b, lvl);
  buildIndustrial(b, lvl, extras);
  buildBackground(b);
  buildDressing(b, world);

  const hadirOil: [number, number][] = [
    [-2.1, -9.2], [-2.6, 7.4], [45.0, 19.6], [45.4, 25.2], [31.5, 52.0],
    [-23.2, 18.0], [-16.8, 18.0], [-48.2, 24.2], [-33.2, 35.6], [-44.0, 49.0],
    [-36.0, 57.0], [-13.5, -33.0], [38.5, -35.0],
  ];
  const hadirScorch: [number, number][] = [[-2.1, -9.2], [-24.0, -2.1], [-44.0, 49.0], [2.4, -0.4]];
  decorateDecals(b, hadirOil, hadirScorch);

  const mask = paintUrbanGround();
  const maskTex = mask.build();
  const groundMat = makeGroundMaterial(maskTex, mask.x0, mask.z0, mask.size, mask.res);
  lvl.group = b.finish();
  lvl.group.add(makeGroundMesh(groundMat, 320, { x0: -145, x1: 145, z0: -145, z1: 145, roadX: 0, roadZ: 0 }));
  lvl.group.add(buildMountains(mats, sunAz));
  lvl.group.add(helipadMarking());
  for (const e of extras) lvl.group.add(e);
  return lvl;
}
