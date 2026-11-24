import * as THREE from 'three';
import type { TargetSpec } from '../entities/targets';
import { decorateDecals } from '../render/decals';
import { GroundMask, makeGroundMaterial, makeGroundMesh } from '../render/ground';
import type { Materials } from '../render/materials';
import * as A from './architecture';
import { LevelBuilder } from './build';
import {
  CJK, FONT, berm, camoNet, chainFence, chu, faceAxes, flagPole, flagTexture, gpTent, grime, hescoLine, lightTower,
  makeCampMats, quad, ropeFence, signBoard, stencil, tWalls, textLines, wear, type CampMats, type UvRect,
} from './camp';
import { buildMountains, type LevelData } from './level';
import type { World } from './physics';
import * as P from './props';
import { Frame } from './props';

const H = Math.PI / 2;
/** Yaw (model convention: facing (sin, cos)) that looks from a to b. */
const face = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, bz - az);
/** Player yaw (forward = (-sin, -cos)) that looks from a to b. */
const look = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export const inRect = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

export interface CqbRoom { name: string; rect: Rect; targets: string[] }
export interface Spot { x: number; z: number; yaw: number; y?: number }

/** Gameplay coordinates of the training base, shared by the level and the tutorial script. */
export const TRAIN = {
  spawn: { x: 2.4, z: -16.2, yaw: look(2.4, -16.2, -0.6, -15.0) },
  sergeant: { x: -0.6, z: -15.0, yaw: face(-0.6, -15.0, 2.4, -16.2) } as Spot,
  /** Firing point of lane 4. */
  lane: { x: 0, z: 11.6, yaw: Math.PI },
  laneZone: { x0: -1.9, x1: 1.9, z0: 9.8, z1: 13.4 } as Rect,
  rangeOfficer: { x: -2.3, z: 9.4, yaw: face(-2.3, 9.4, 0, 12) } as Spot,
  rangeSupply: { x: 2.1, z: 9.3 },
  shooters: [
    { lane: 0, x: -12, z: 12.15, group: 'npc0' },
    { lane: 1, x: -8, z: 12.15, group: 'npc1' },
    { lane: 6, x: 12, z: 12.15, group: 'npc6' },
    { lane: 7, x: 16, z: 12.15, group: 'npc7' },
  ],
  bay: { x: -28, z: 11.0, yaw: look(-28, 11, -28, 27) },
  bayZone: { x0: -30.2, x1: -25.8, z0: 8.6, z1: 12.5 } as Rect,
  nadeOfficer: { x: -31.6, z: 6.7, yaw: face(-31.6, 6.7, -28, 11) } as Spot,
  pit: { x: -28, z: 27 },
  course: {
    zone: { x0: -52.5, x1: -42.5, z0: -37, z1: 7.5 } as Rect,
    start: { x: -47.5, z: 6.2 },
    startZ: 5.6,
    wall1: -4,
    bars: [-12, -13.6, -15.2],
    tires: -22,
    wall2: -29,
    finish: -33,
  },
  courseOfficer: { x: -41.2, z: 4.6, yaw: face(-41.2, 4.6, -47.5, 2) } as Spot,
  dummy: { x: -47.5, z: -37.6, yaw: 0 },
  cqb: {
    officer: { x: -38.6, z: -33.6, yaw: face(-38.6, -33.6, -36.5, -31) } as Spot,
    catwalk: { x: -27.5, z: -44, y: 3.07, yaw: Math.PI * 0.95 } as Spot,
    entry: { x: -36.5, z: -36 },
    stage: { x: -36.5, z: -32.4 },
    exit: { x: -16, z: -40 },
    house: { x0: -40, x1: -16, z0: -52, z1: -36 } as Rect,
    rooms: [
      { name: 'A', rect: { x0: -40, x1: -31, z0: -44, z1: -36.3 }, targets: ['cqb_a1', 'cqb_a2'] },
      { name: 'B', rect: { x0: -40, x1: -31, z0: -52, z1: -44.25 }, targets: ['cqb_b1', 'cqb_b2'] },
      { name: 'C', rect: { x0: -30.75, x1: -23, z0: -52, z1: -44 }, targets: ['cqb_c1', 'cqb_c2'] },
      { name: 'D', rect: { x0: -22.75, x1: -16, z0: -52, z1: -44 }, targets: ['cqb_d1', 'cqb_d2'] },
      { name: 'E', rect: { x0: -31, x1: -16, z0: -43.75, z1: -36 }, targets: ['cqb_e1', 'cqb_e2', 'cqb_e3'] },
    ] as CqbRoom[],
  },
  debrief: { x: -11.6, z: -39.2, yaw: face(-11.6, -39.2, -15, -40) } as Spot,
};

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

function targetSpecs(): TargetSpec[] {
  const T: TargetSpec[] = [];
  const L = TRAIN.lane;
  const et = (id: string, group: string, x: number, z: number, up = false) =>
    T.push({ id, kind: 'etype', group, x, z, yaw: face(x, z, L.x, L.z), up });
  // lane 4 drills
  et('hip1', 'hip', -2.6, 19.6); et('hip2', 'hip', 0.2, 20.6); et('hip3', 'hip', 2.9, 19.9);
  et('ads1', 'ads', -6.8, 34.5); et('ads2', 'ads', 5.6, 40.5); et('ads3', 'ads', -2.2, 47.5); et('ads4', 'ads', 8.4, 55.5); et('ads5', 'ads', 1.2, 61.5);
  et('pis1', 'pistol', -3.3, 17.4); et('pis2', 'pistol', -1.1, 18.3); et('pis3', 'pistol', 1.4, 17.6); et('pis4', 'pistol', 3.6, 18.4);
  for (const [i, x, z] of [[1, -5.5, 80], [2, 2.5, 92], [3, 9.5, 104]]) {
    T.push({ id: `steel${i}`, kind: 'steel', group: 'steel', x, z, yaw: face(x, z, L.x, L.z) });
  }
  // the other lanes: worked by the NPC shooters, or idle
  for (let k = 0; k < 8; k++) {
    const x = -12 + k * 4;
    if (k >= 2 && k <= 5) {
      if (k !== 3) for (const z of [36.5, 61.5]) T.push({ id: `idle${k}_${z}`, kind: 'etype', group: 'idle', x, z, yaw: Math.PI });
      continue;
    }
    for (const z of [21.5, 36.5, 61.5]) T.push({ id: `npc${k}_${z}`, kind: 'etype', group: `npc${k}`, x, z, yaw: Math.PI });
  }
  // grenade pit
  const B = TRAIN.bay;
  for (const [i, x, z] of [[1, -30.6, 25.4], [2, -27.8, 27.6], [3, -25.2, 25.2]]) {
    T.push({ id: `nade${i}`, kind: 'etype', group: 'nade', x, z, yaw: face(x, z, B.x, B.z) });
  }
  // melee dummy
  T.push({ id: 'dummy', kind: 'dummy', group: 'dummy', x: TRAIN.dummy.x, z: TRAIN.dummy.z, yaw: 0, up: true });
  // kill house: each figure faces the doorway the team comes through
  const cq = (id: string, kind: 'hostile' | 'civilian', x: number, z: number, fx: number, fz: number) =>
    T.push({ id, kind, group: 'cqb', x, z, y: 0.06, yaw: face(x, z, fx, fz) });
  cq('cqb_a1', 'hostile', -38.9, -42.7, -36.5, -36.5);
  cq('cqb_a2', 'hostile', -32.3, -40.4, -36.5, -36.5);
  cq('cqb_b1', 'hostile', -38.9, -50.9, -35.5, -44.5);
  cq('cqb_b2', 'civilian', -32.9, -50.6, -35.5, -44.5);
  cq('cqb_c1', 'hostile', -24.3, -51.0, -30.5, -48);
  cq('cqb_c2', 'hostile', -29.5, -45.2, -30.8, -48.2);
  cq('cqb_d1', 'hostile', -20.0, -45.6, -22.5, -48);
  cq('cqb_d2', 'civilian', -17.2, -51.0, -22.5, -48);
  cq('cqb_e1', 'hostile', -24.6, -42.4, -19.5, -43.5);
  cq('cqb_e2', 'civilian', -27.8, -39.6, -19.5, -43.5);
  cq('cqb_e3', 'hostile', -30.1, -37.3, -19.5, -43.5);
  return T;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

type Pt = [number, number];
const ROAD_MAIN: Pt[] = [[-41, -10.2], [-20, -10.8], [0, -9.7], [20, -10.4], [40, -9.8], [62, -10.1]];
const ROAD_NS: Pt[] = [[8.1, -62], [8.4, -42], [7.8, -24], [8.0, -10]];
const ROAD_RANGE: Pt[] = [[-40, 1.4], [-20, 1.8], [0, 1.2], [20, 1.6], [31, 1.4]];
const ROAD_EAST: Pt[] = [[30.6, -10], [30.1, -3], [30.8, 1.4]];
const TRACK_WEST: Pt[] = [[-38, 1.4], [-38.6, -10], [-37.6, -22], [-37.2, -33.5]];
const TRACK_RANGE: Pt[] = [[-17.2, 15], [-16.8, 40], [-17.4, 70], [-16.6, 112]];

function paintGround(): GroundMask {
  const M = new GroundMask(-130, -130, 260, 1024);
  // everything inside the wire has been churned by boots and wheels
  for (let z = -54; z <= 12; z += 6) M.path(0, [[-54, z], [54, z]], 7, 0.34, 0);
  // roads
  for (const [road, w] of [[ROAD_MAIN, 7.5], [ROAD_NS, 6.8], [ROAD_RANGE, 6], [ROAD_EAST, 6], [TRACK_WEST, 4.4]] as [Pt[], number][]) {
    M.path(0, road, w, 0.96, 0.55);
    M.ruts(road, 1.9, 0.42, 0.95, 0.35);
    M.puddles(road, 8, 0.7, 2.1, w * 0.22);
  }
  // roads leaving through the gates
  M.path(0, [[8, -62], [8.6, -90], [7.4, -128]], 6, 0.75, 0.6);
  M.ruts([[8, -62], [8.6, -90], [7.4, -128]], 1.9, 0.4, 0.8, 0.4);
  M.path(0, [[60, -10], [90, -11], [128, -9]], 6, 0.75, 0.6);
  M.ruts([[60, -10], [90, -11], [128, -9]], 1.9, 0.4, 0.8, 0.4);
  // range: maintenance track and churned target lines
  M.path(0, TRACK_RANGE, 3.6, 0.8, 0.5);
  M.ruts(TRACK_RANGE, 1.7, 0.36, 0.8, 0.25);
  M.puddles(TRACK_RANGE, 12, 0.6, 1.6, 0.6);
  for (const z of [21, 36, 61]) M.path(0, [[-15, z], [19, z]], 2.6, 0.55, 0.8);
  M.path(0, [[-15, 15], [19, 15]], 3, 0.7, 0.5);
  // motor pool: a wide mud lot criss-crossed with ruts
  for (let z = -54; z <= -18; z += 5) M.path(0, [[43, z], [55, z]], 6, 0.95, 0.4);
  for (const pts of [[[44, -16], [46, -30], [44, -48]], [[52, -12], [50, -28], [53, -44]], [[48, -12], [44, -24], [49, -40], [47, -52]]] as Pt[][]) {
    M.ruts(pts, 1.9, 0.42, 1, 0.5);
    M.puddles(pts, 7, 0.8, 2.4, 1.6);
  }
  // supply yard and range parking
  for (let z = -4; z <= 10; z += 5) M.path(0, [[33, z], [54, z]], 6, 0.8, 0.4);
  M.puddles([[34, 0], [54, 6]], 6, 0.8, 2.2, 3);
  // grenade pit: shredded, waterlogged craters
  for (let z = 16; z <= 38; z += 4) M.path(0, [[-37, z], [-21, z]], 5, 0.85, 0.6);
  for (const [x, z, r] of [[-30, 24, 2.2], [-26, 28.5, 1.8], [-24, 22.5, 1.5], [-32.5, 30, 1.9], [-28.5, 19.5, 1.4], [-22.5, 33, 2]]) {
    M.blob(2, x, z, r, 1);
    M.blob(0, x, z, r * 1.8, 1);
  }
  // obstacle course lane, with standing water under the crawl bars and at the landings
  M.path(0, [[-47.5, 8], [-47.5, -38]], 9, 0.95, 0.4);
  M.ruts([[-48.5, 7], [-47, -20], [-48, -36]], 1.2, 0.5, 0.8, 0.9);
  for (const z of [-5.2, -13.6, -14.6, -30.2]) {
    for (let i = 0; i < 4; i++) M.blob(2, -51 + i * 2.6 + Math.random(), z + (Math.random() - 0.5) * 1.6, 1.3 + Math.random(), 0.95);
  }
  // kill house staging area, footpaths between tents and billets
  M.path(0, [[-40, -33], [-30, -33.5], [-12, -38.5]], 4, 0.85, 0.6);
  M.path(0, [[-37, -33.5], [-37, -22], [-38.4, -10]], 2.4, 0.8, 0.6);
  for (const x of [-9, -2]) M.path(0, [[x, -21.5], [x + 0.6, -14], [x + 1.4, -10.5]], 2.2, 0.8, 0.6);
  M.path(0, [[-5.5, -18.5], [4.6, -16]], 4.5, 0.75, 0.6);
  M.path(0, [[11, -38.5], [42, -38.5]], 5, 0.8, 0.4);
  M.path(0, [[-4, -42], [-4, -36], [6, -30]], 3, 0.75, 0.6);
  M.puddles([[-40, -33], [-12, -38.5]], 6, 0.5, 1.4, 1.2);
  M.puddles([[-54, -50], [54, -50]], 9, 0.6, 1.8, 6);
  M.puddles([[-54, -2], [54, -2]], 11, 0.6, 1.8, 7);
  M.puddles([[12, -24], [42, -24]], 8, 0.6, 1.6, 4);
  // outside the wire: dry sand with the odd damp hollow
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, d = 66 + Math.random() * 56;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > 14 && x > -42 && x < 30 && z < 124) continue;
    M.blob(0, x, z, 2 + Math.random() * 6, 0.35 + Math.random() * 0.3);
    if (Math.random() < 0.3) M.blob(2, x, z, 1 + Math.random() * 2, 0.8);
  }
  return M;
}

// ---------------------------------------------------------------------------
// Signs, stencils and flags (one atlas for the whole level)
// ---------------------------------------------------------------------------

interface Signs {
  camp: UvRect; range: UvRect; nade: UvRect; cqb: UvRect; start: UvRect; finish: UvRect; plan: UvRect; toc: UvRect;
  speed: UvRect; fuel: UvRect; lanes: UvRect[]; dist: Record<number, UvRect>; posts: { dir: Pt; front: UvRect; back: UvRect }[];
  letters: Record<string, UvRect>; arrow: UvRect; chu: UvRect[]; inert: UvRect; danger: UvRect; killhouse: UvRect; noEntry: UvRect;
  score: UvRect; heli: UvRect;
}

function anvil(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, col: string) {
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100);
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(-95, -38); g.lineTo(60, -38); g.quadraticCurveTo(100, -36, 112, -18); g.lineTo(52, -12);
  g.lineTo(34, 8); g.lineTo(34, 30); g.lineTo(62, 46); g.lineTo(62, 60); g.lineTo(-62, 60); g.lineTo(-62, 46);
  g.lineTo(-34, 30); g.lineTo(-34, 8); g.lineTo(-56, -10); g.quadraticCurveTo(-92, -14, -95, -38);
  g.closePath();
  g.fill();
  g.restore();
}

function spray(g: CanvasRenderingContext2D, w: number, h: number, text: string, color: string, size: number, font = FONT) {
  g.save();
  g.font = `900 ${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = size * 0.08;
  g.fillText(text, w / 2, h / 2);
  // drips
  g.shadowBlur = 0;
  g.globalAlpha = 0.7;
  for (let i = 0; i < 3; i++) {
    const x = w / 2 + (Math.random() - 0.5) * size * 0.6;
    g.fillRect(x, h / 2 + size * 0.3, 2 + Math.random() * 2, size * (0.1 + Math.random() * 0.3));
  }
  g.restore();
  wear(g, w, h, 0.8);
}

function makeSigns(cm: CampMats): Signs {
  const A = cm.atlas;
  const plate = (g: CanvasRenderingContext2D, w: number, h: number, bg: string, border?: string, bw = 10) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = bw;
      g.strokeRect(bw * 1.4, bw * 1.4, w - bw * 2.8, h - bw * 2.8);
    }
  };
  const chips = (g: CanvasRenderingContext2D, w: number, h: number, k = 1) => {
    wear(g, w, h, 0.5 * k, false);
    grime(g, w, h, k);
  };
  const S = {} as Signs;
  S.camp = A.add(1024, 384, (g, w, h) => {
    plate(g, w, h, '#353d2a', '#d6bf78', 9);
    anvil(g, 180, h / 2 + 6, 120, '#d6bf78');
    g.save();
    g.translate(330, 0);
    textLines(g, w - 360, h, [
      { text: '铁砧营地', size: 118, color: '#e8dcae', font: CJK, weight: 900, ls: 14 },
      { text: 'CAMP ANVIL', size: 54, color: '#d6bf78', ls: 10 },
      { text: '联合特遣队 · 第三训练营', size: 34, color: '#b9b08a', font: CJK },
    ]);
    g.restore();
    chips(g, w, h, 1.2);
  });
  S.range = A.add(768, 384, (g, w, h) => {
    plate(g, w, h, '#f0ece2');
    g.fillStyle = '#b8231c';
    g.fillRect(0, 0, w, 120);
    g.save();
    textLines(g, w, 120, [{ text: '危险 · DANGER', size: 74, color: '#fff', ls: 6 }]);
    g.translate(0, 120);
    textLines(g, w, h - 120, [
      { text: '实弹射击区', size: 84, color: '#181818', font: CJK, weight: 900, ls: 8 },
      { text: 'LIVE FIRE RANGE', size: 44, color: '#181818', ls: 6 },
      { text: '红旗升起时 严禁进入靶区', size: 34, color: '#b8231c', font: CJK },
    ]);
    g.restore();
    chips(g, w, h);
  });
  S.nade = A.add(768, 384, (g, w, h) => {
    plate(g, w, h, '#e8c22a');
    g.save();
    g.beginPath();
    g.rect(0, 0, w, 52);
    g.rect(0, h - 52, w, 52);
    g.clip();
    for (let x = -60; x < w + 60; x += 60) {
      g.fillStyle = '#151515';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 30, 0); g.lineTo(x - 30, h); g.lineTo(x - 60, h); g.closePath(); g.fill();
    }
    g.restore();
    g.save();
    g.translate(0, 52);
    textLines(g, w, h - 104, [
      { text: '手榴弹投掷场', size: 86, color: '#151515', font: CJK, weight: 900, ls: 6 },
      { text: 'GRENADE RANGE', size: 46, color: '#151515', ls: 8 },
      { text: '投掷时 其他人员一律隐蔽', size: 32, color: '#151515', font: CJK },
    ]);
    g.restore();
    chips(g, w, h);
  });
  S.cqb = A.add(768, 384, (g, w, h) => {
    plate(g, w, h, '#2a2c2b', '#e6e1d4', 7);
    textLines(g, w, h, [
      { text: '1号突入训练屋', size: 80, color: '#efe9da', font: CJK, weight: 900, ls: 6 },
      { text: 'KILL HOUSE 01', size: 50, color: '#e8c22a', ls: 10 },
      { text: '进入前检查武器 · 佩戴护目镜', size: 32, color: '#c8c2b4', font: CJK },
    ]);
    chips(g, w, h);
  });
  S.start = A.add(1024, 104, (g, w, h) => {
    plate(g, w, h, '#2f3626');
    textLines(g, w, h, [{ text: '障碍训练场  ·  起点 START  ·  OBSTACLE COURSE', size: 58, color: '#efe6c6', font: CJK, weight: 900, ls: 4 }]);
    chips(g, w, h);
  });
  S.finish = A.add(512, 192, (g, w, h) => {
    plate(g, w, h, '#efe9dc');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) { g.fillStyle = '#161616'; g.fillRect(i * 32, j * 24, 32, 24); }
    g.save();
    g.translate(0, 48);
    textLines(g, w, h - 48, [{ text: '终点 FINISH', size: 70, color: '#161616', font: CJK, weight: 900, ls: 4 }]);
    g.restore();
    chips(g, w, h);
  });
  S.plan = A.add(512, 384, (g, w, h) => {
    plate(g, w, h, '#f4f2ec');
    g.strokeStyle = '#1d3d8a';
    g.lineWidth = 5;
    const X = (x: number) => 40 + ((x + 40) / 24) * 432, Z = (z: number) => 60 + ((z + 52) / 16) * 288;
    g.strokeRect(X(-40), Z(-52), X(-16) - X(-40), Z(-36) - Z(-52));
    g.beginPath();
    g.moveTo(X(-40), Z(-44)); g.lineTo(X(-36.2), Z(-44)); g.moveTo(X(-34.8), Z(-44)); g.lineTo(X(-20.2), Z(-44)); g.moveTo(X(-18.8), Z(-44)); g.lineTo(X(-16), Z(-44));
    g.moveTo(X(-31), Z(-52)); g.lineTo(X(-31), Z(-48.7)); g.moveTo(X(-31), Z(-47.3)); g.lineTo(X(-31), Z(-36));
    g.moveTo(X(-23), Z(-52)); g.lineTo(X(-23), Z(-48.7)); g.moveTo(X(-23), Z(-47.3)); g.lineTo(X(-23), Z(-44));
    g.stroke();
    g.strokeStyle = '#f4f2ec';
    g.lineWidth = 9;
    g.beginPath(); g.moveTo(X(-37.1), Z(-36)); g.lineTo(X(-35.9), Z(-36)); g.moveTo(X(-16), Z(-40.6)); g.lineTo(X(-16), Z(-39.4)); g.stroke();
    // flow arrows
    g.strokeStyle = '#c42a1f';
    g.lineWidth = 4;
    g.setLineDash([10, 8]);
    g.beginPath();
    g.moveTo(X(-36.5), Z(-34)); g.lineTo(X(-36.5), Z(-41)); g.lineTo(X(-35.5), Z(-47.6)); g.lineTo(X(-28), Z(-48)); g.lineTo(X(-19.5), Z(-48));
    g.lineTo(X(-19.5), Z(-41)); g.lineTo(X(-28), Z(-39.5)); g.lineTo(X(-17), Z(-40)); g.lineTo(X(-13), Z(-40));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#1d3d8a';
    g.font = `700 30px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [l, x, z] of [['A', -35.5, -40], ['B', -35.5, -48], ['C', -27, -48], ['D', -19.5, -48], ['E', -23.5, -40]] as [string, number, number][]) g.fillText(l, X(x) + 26, Z(z) - 14);
    textLines(g, w, 60, [{ text: '突入路线 A→B→C→D→E  出口', size: 30, color: '#1d1d1d', font: CJK }]);
    g.fillStyle = '#c42a1f';
    g.font = `700 22px ${CJK}`;
    g.fillText('入口', X(-36.5), Z(-36) + 20);
  });
  S.toc = A.add(768, 256, (g, w, h) => {
    plate(g, w, h, '#30362a', '#cdb878', 6);
    textLines(g, w, h, [
      { text: '战术作战中心 TOC', size: 72, color: '#ece2bc', font: CJK, weight: 900, ls: 4 },
      { text: '未经许可 禁止入内 · AUTHORIZED PERSONNEL ONLY', size: 28, color: '#cdb878', font: CJK },
    ]);
    chips(g, w, h);
  });
  S.speed = A.add(256, 256, (g, w, h) => {
    g.fillStyle = '#d8d6d0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c42a1f';
    g.beginPath(); g.arc(w / 2, h / 2, 126, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f5f3ee';
    g.beginPath(); g.arc(w / 2, h / 2, 96, 0, Math.PI * 2); g.fill();
    textLines(g, w, h, [{ text: '15', size: 110, color: '#111', weight: 800 }, { text: 'km/h', size: 26, color: '#111' }], 1.0);
    chips(g, w, h, 0.6);
  });
  S.fuel = A.add(512, 256, (g, w, h) => {
    plate(g, w, h, '#c42a1f');
    textLines(g, w, h, [
      { text: '油料区 · 严禁烟火', size: 60, color: '#fff', font: CJK, weight: 900 },
      { text: 'FUEL POINT · NO SMOKING', size: 34, color: '#fff', ls: 3 },
    ]);
    chips(g, w, h);
  });
  S.lanes = [];
  for (let i = 1; i <= 8; i++) {
    S.lanes.push(A.add(128, 128, (g, w, h) => {
      plate(g, w, h, '#e8c22a', '#151515', 5);
      textLines(g, w, h, [{ text: String(i), size: 96, color: '#151515', weight: 800 }], 1.0);
      chips(g, w, h, 0.7);
    }));
  }
  S.dist = {};
  for (const d of [10, 25, 50, 75, 100]) {
    S.dist[d] = A.add(192, 96, (g, w, h) => {
      plate(g, w, h, '#f2efe6', '#151515', 4);
      textLines(g, w, h, [{ text: `${d} M`, size: 64, color: '#151515', weight: 800 }], 1.0);
      chips(g, w, h, 0.7);
    });
  }
  // multi-arm junction signpost
  const post = (dir: Pt, cn: string, en: string, col: string, fg = '#f2eee2') => {
    const draw = (left: boolean) => (g: CanvasRenderingContext2D, w: number, h: number) => {
      g.fillStyle = col;
      g.beginPath();
      if (left) { g.moveTo(0, h / 2); g.lineTo(h * 0.5, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(h * 0.5, h); }
      else { g.moveTo(0, 0); g.lineTo(w - h * 0.5, 0); g.lineTo(w, h / 2); g.lineTo(w - h * 0.5, h); g.lineTo(0, h); }
      g.closePath();
      g.fill();
      g.save();
      g.translate(left ? h * 0.4 : 0, 0);
      textLines(g, w - h * 0.4, h, [{ text: `${cn}  ${en}`, size: 46, color: fg, font: CJK, weight: 800 }]);
      g.restore();
      chips(g, w, h, 0.6);
    };
    return { dir, front: A.add(512, 88, draw(false)), back: A.add(512, 88, draw(true)) };
  };
  S.posts = [
    post([0, 1], '靶场', 'RANGE', '#7a2a22'),
    post([-1, -0.05], '障碍场', 'COURSE', '#3d4630'),
    post([-1, -0.62], '突入屋', 'CQB', '#3d4630'),
    post([-0.35, -1], '指挥所', 'TOC', '#28324a'),
    post([1, -1.2], '营房', 'BILLETS', '#5a4a32'),
    post([1, -0.2], '车场', 'MOTOR POOL', '#5a4a32'),
    post([-1, 1.1], '投弹场', 'GRENADES', '#7a2a22'),
  ];
  S.letters = {};
  for (const l of ['A', 'B', 'C', 'D', 'E']) S.letters[l] = A.add(128, 128, (g, w, h) => spray(g, w, h, l, '#f2f0ea', 104));
  S.arrow = A.add(128, 128, (g, w, h) => spray(g, w, h, '➜', '#d63a2a', 100, CJK));
  S.chu = [];
  for (let i = 1; i <= 8; i++) {
    S.chu.push(A.add(160, 80, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = `800 52px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#1e1e1c';
      g.fillText(`B-0${i}`, w / 2, h / 2 + 2);
      wear(g, w, h, 1.2);
    }));
  }
  S.inert = A.add(256, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    textLines(g, w, h, [{ text: '训练弹 INERT', size: 40, color: '#e8c22a', font: CJK, weight: 900 }, { text: 'M67 ×24', size: 28, color: '#efe9da' }], 1.05);
    wear(g, w, h, 1.2);
  });
  S.danger = A.add(256, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    textLines(g, w, h, [{ text: '危险 · DANGER', size: 46, color: '#d63a2a', font: CJK, weight: 900 }]);
    wear(g, w, h, 1.0);
  });
  S.killhouse = A.add(256, 96, (g, w, h) => spray(g, w, h, 'CQB-01', '#f2f0ea', 62));
  S.noEntry = A.add(256, 128, (g, w, h) => {
    plate(g, w, h, '#f0ece2');
    g.fillStyle = '#c42a1f';
    g.fillRect(0, 0, w, 44);
    textLines(g, w, 44, [{ text: '禁止通行', size: 34, color: '#fff', font: CJK, weight: 900 }]);
    g.save();
    g.translate(0, 44);
    textLines(g, w, h - 44, [{ text: '教官通道', size: 40, color: '#151515', font: CJK, weight: 900 }, { text: 'STAFF ONLY', size: 22, color: '#151515' }], 1.05);
    g.restore();
    chips(g, w, h, 0.6);
  });
  S.score = A.add(512, 320, (g, w, h) => {
    plate(g, w, h, '#f4f2ec', '#2a2a2a', 6);
    g.fillStyle = '#1b1b1b';
    textLines(g, w, 80, [{ text: 'CQB 考核成绩 · 本周', size: 38, color: '#1b1b1b', font: CJK, weight: 900 }]);
    g.font = `500 30px ${CJK}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const rows: [string, string, string][] = [['一排二班', '00:23.8', 'S'], ['一排三班', '00:31.2', 'A'], ['二排一班', '00:29.5', 'A'], ['二排四班', '00:44.0', 'B'], ['新兵连', '— —', '?']];
    rows.forEach(([a, t, gr], i) => {
      const y = 104 + i * 42;
      g.fillStyle = '#1b1b1b';
      g.fillText(a, 40, y);
      g.fillText(t, 250, y);
      g.fillStyle = gr === 'S' ? '#c42a1f' : '#1d3d8a';
      g.fillText(gr, 420, y);
    });
    grime(g, w, h, 0.5);
  });
  S.heli = A.add(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(236,230,212,0.9)';
    g.fillStyle = 'rgba(236,230,212,0.9)';
    g.lineWidth = 24;
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.43, 0, Math.PI * 2); g.stroke();
    g.fillRect(w * 0.31, h * 0.27, w * 0.085, h * 0.46);
    g.fillRect(w * 0.605, h * 0.27, w * 0.085, h * 0.46);
    g.fillRect(w * 0.31, h * 0.455, w * 0.38, h * 0.09);
    wear(g, w, h, 2.2);
  });
  return S;
}

function makeFlags() {
  const unit = flagTexture((g, w, h) => {
    g.fillStyle = '#4a5233';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#cdb46a';
    g.lineWidth = 10;
    g.strokeRect(16, 16, w - 32, h - 32);
    anvil(g, w / 2, h / 2 - 14, 110, '#cdb46a');
    g.fillStyle = '#cdb46a';
    g.font = `900 46px ${CJK}`;
    g.textAlign = 'center';
    g.fillText('铁 砧', w / 2, h - 46);
  });
  const red = flagTexture((g, w, h) => {
    g.fillStyle = '#b8261d';
    g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(40,10,0,0.3)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, 256, 170);
  const jtf = flagTexture((g, w, h) => {
    g.fillStyle = '#26324a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8e4d8';
    g.translate(w / 2, h / 2);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 26 : 92;
      g.lineTo(Math.cos(a - H) * r, Math.sin(a - H) * r);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = '#e8e4d8';
    g.lineWidth = 6;
    g.beginPath(); g.arc(0, 0, 112, 0, Math.PI * 2); g.stroke();
  });
  return { unit, red, jtf };
}

// ---------------------------------------------------------------------------
// Small composite props
// ---------------------------------------------------------------------------

function portaJohn(b: LevelBuilder, x: number, z: number, rot: number, color: number) {
  const f = new Frame(b, x, z, rot);
  const tint = new THREE.Color(color).lerp(new THREE.Color(0xf4efe4), 0.52).getHex();
  b.model('prop_porta_john', x, 0, z, rot, { scale: 0.96, color: tint });
  f.solid(0, 0, 0, 1.15, 2.25, 1.25, 'metal');
}

/** Rubber fuel bladder: a squat pillow. */
function fuelBladder(b: LevelBuilder, x: number, z: number, rot: number, len = 6.4, wid = 3.4, h = 1.05) {
  const g = new THREE.SphereGeometry(1, 24, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const k = Math.pow(Math.abs(py), 0.6) * Math.sign(py);
    const sq = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.55);
    pos.setXYZ(i, sq(px) * len / 2, (k * 0.5 + 0.5) * h, sq(pz) * wid / 2);
  }
  g.computeVertexNormals();
  b.geo('rubber', g, { x, y: 0, z }, new THREE.Euler(0, rot, 0), 1, 0x2a2a26);
  g.dispose();
  b.solid(x, 0, z, len * 0.92, h, wid * 0.85, rot, 'fabric');
}

/** Sculpted 4.1k-tri parabolic satellite terminal on ground mount. */
function satDish(b: LevelBuilder, x: number, z: number, rot: number) {
  b.model('arch_sat_dish', x, 0, z, rot, { scale: 2.35, color: 0xeee8da });
  b.solid(x, 0, z, 1.75, 1.9, 1.75, rot, 'metal');
}

/** Duckboard walkway: planks on runners, laid over the mud. */
function duckboard(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, w = 1.2) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const rot = -Math.atan2(z1 - z0, x1 - x0);
  const f = new Frame(b, (x0 + x1) / 2, (z0 + z1) / 2, rot);
  for (const s of [-0.4, 0.4]) f.d('wood', 0, 0, s * w, len, 0.06, 0.09, { color: 0x6d5a42 });
  const n = Math.floor(len / 0.19);
  for (let i = 0; i < n; i++) {
    if (b.rnd() < 0.03) continue;
    const lx = -len / 2 + (i + 0.5) * (len / n);
    f.d('wood', lx + b.r(-0.01, 0.01), 0.06, b.r(-0.03, 0.03), 0.14, 0.03, w + b.r(-0.05, 0.05), { color: new THREE.Color(0x8c7656).multiplyScalar(b.r(0.75, 1.1)).getHex(), rot: b.r(-0.02, 0.02) });
  }
}

/** Steel-pipe barrier arm at a gate. */
function gateArm(b: LevelBuilder, x: number, z: number, rot: number, len: number) {
  const f = new Frame(b, x, z, rot);
  f.c('vpaint', 0, 0, 0, 0.36, 1.1, 0.36, { color: 0xd8d4c8, grime: 0.8 });
  f.d('concrete', 0, 0, 0, 0.7, 0.18, 0.7, { color: 0xb8b2a6 });
  const n = Math.ceil(len / 0.5);
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(0.05, 0.05, len / n, 8);
    b.geo('vpaint', g, f.v(0.2 + (i + 0.5) * (len / n), 0.98, 0), new THREE.Euler(0, rot, H), 1, i % 2 ? 0xc42a1f : 0xf0ece4);
    g.dispose();
  }
  f.d('vpaint', len + 0.15, 0, 0, 0.12, 0.98, 0.12, { color: 0xd8d4c8 });
}

/** Guard shack: plywood hut with windows and a sandbag skirt. */
function guardShack(b: LevelBuilder, x: number, z: number, rot: number) {
  const f = new Frame(b, x, z, rot);
  f.c('osb', 0, 0.1, 0, 2.4, 2.4, 2.4, { color: 0xc9b08a, grime: 0.8 });
  f.d('corrugated', 0, 2.5, 0, 2.9, 0.06, 2.9, { color: 0x8a8d86 });
  for (const [lx, lz, r] of [[0, 1.215, 0], [1.215, 0, H], [-1.215, 0, -H]] as [number, number, number][]) {
    f.d('glass', lx, 1.2, lz, 1.4, 0.7, 0.03, { rot: r });
  }
  P.sandbags(b, f.wx(0, 1.65), f.wz(0, 1.65), rot, 2.8, 5);
  P.sandbags(b, f.wx(1.65, 0), f.wz(1.65, 0), rot + H, 2.8, 5);
  b.model('security_light', f.wx(0, 1.24), 2.2, f.wz(0, 1.24), rot, { scale: 0.7 });
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

function buildRange(b: LevelBuilder, cm: CampMats, S: Signs, group: THREE.Group, flags: ReturnType<typeof makeFlags>) {
  b.region = 'range';
  // covered firing line: slab floor, steel frame, corrugated roof
  b.box('slab', 2, -0.12, 11, 37, 0.22, 6.4, { color: 0xc9c3b6, grime: 1 });
  for (let k = 0; k <= 8; k++) {
    const x = -14 + k * 4;
    // timber-framed OSB lane dividers
    b.box('osb', x, 0.1, 12.3, 0.04, 1.62, 3.0, { color: 0xd7c09a });
    for (const z of [10.85, 13.75]) b.deco('wood', x, 0.1, z, 0.1, 1.66, 0.1, { color: 0x8a7254 });
    b.deco('wood', x, 1.72, 12.3, 0.1, 0.06, 3.0, { color: 0x8a7254 });
  }
  // baffle wall and benches
  b.box('slab', 2, 0.1, 14.12, 37, 1.02, 0.26, { color: 0xc8c2b4, absGrime: true });
  for (let k = 0; k < 8; k++) {
    const x = -12 + k * 4;
    const f = new Frame(b, x, 13.48, 0, 0.1);
    f.c('wood', 0, 0.86, 0, 2.0, 0.06, 0.66, { color: 0x9a805c, grime: 1 });
    for (const sx of [-0.92, 0.92]) for (const sz of [-0.27, 0.27]) f.d('wood', sx, 0, sz, 0.08, 0.86, 0.08, { color: 0x7a6448 });
    f.d('wood', 0, 0.28, 0, 1.9, 0.03, 0.56, { color: 0x86704f });
    f.solid(0, 0, 0, 2.0, 0.9, 0.66, 'wood');
    P.sandbags(b, f.wx(0.25, 0.08), f.wz(0.25, 0.08), 0, 0.9, 2, 1.02, false);
    if (k !== 3) {
      b.model('ammo_box', f.wx(-0.6, -0.05), 1.02, f.wz(-0.6, -0.05), b.r(-0.3, 0.3), { scale: 1.1 });
      if (b.rnd() < 0.6) b.model('binoculars', f.wx(0.7, -0.1), 1.02, f.wz(0.7, -0.1), b.r(0, 6), {});
    }
    // lane number hanging from the roof beam
    b.deco('metal', x, 2.34, 14.47, 0.56, 0.56, 0.03, { color: 0x3a3a36 });
    for (const s of [-0.2, 0.2]) b.deco('darkmetal', x + s, 2.9, 14.47, 0.02, 0.2, 0.02, { color: 0x3a3a36 });
    quad(b, cm.sign, new THREE.Vector3(x, 2.62, 14.45), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), 0.5, 0.5, S.lanes[k]);
  }
  // lane 4: magazines and the clipboard on the bench
  b.model('clipboard', -0.55, 1.02, 13.4, 0.25, {});
  b.model('ammo_box', 0.75, 1.02, 13.45, -0.1, { scale: 1.1 });
  // Exposed AAA steel-truss firing pavilion (columns aligned exactly on lane dividers x = -14, -6, 2, 10, 18)
  A.steelTrussRoof(b, 2, 11, 0, 32.0, 6.5, 3.02, { bays: 4, roofColor: 0x8f9288, steelColor: 0x474b4e, lamps: true });
  // Extend end eave overhangs to cover outer apron & mount lane number fascia rail cleanly
  b.deco('metal', 2, 2.86, 14.48, 34.0, 0.28, 0.04, { color: 0x7e827a });
  // posters / range rules board at the back of the shed
  b.model('notice_board', -9.5, 0.1, 8.25, 0, { scale: 0.85 });
  b.model('notice_board', 13.5, 0.1, 8.25, 0, { scale: 0.85 });

  // Hero AAA Military Range Control Tower (west end)
  A.rangeControlTower(b, -19.2, 6.2);
  flagPole(b, cm, group, -16.9, 5.3, -0.53, flags.red, 9.6, 1.5, 0.95);

  // range entrance: the "danger" board facing the road, cones, barricades & range safety ammo staging
  signBoard(b, cm, 22.4, 5.6, -2.5, 1.9, 0.95, 1.1, S.range);
  for (const [x, z] of [[20.8, 5.0], [21.6, 5.4], [19.6, 4.8]]) b.model('traffic_cone', x, 0, z, b.r(0, 6), {});
  P.solidProp(b, 'barricade', 24.2, 5.0, 0.4, 0, 1, { surface: 'metal' });
  P.clutter(b, 'medical_box', -5.6, 9.2, 0.35, 0.1);
  P.clutter(b, 'ammo_box', -4.8, 9.1, -0.25, 0.1, 1.2);
  P.clutter(b, 'toolbox', 8.2, 9.2, 0.6, 0.1);

  // downrange: earth berms, target lines, distance markers, backstop
  b.region = 'downrange';
  berm(b, 'sand', -21.5, 66, H, 104, 10, 4.6, { color: 0xd8c6a6, seed: 3 });
  berm(b, 'sand', 25.5, 66, H, 104, 10, 4.6, { color: 0xd8c6a6, seed: 5 });
  berm(b, 'sand', 2, 119, 0, 60, 18, 9.5, { color: 0xd2bea0, seed: 9, steep: 0.6 });
  const T = targetSpecs();
  for (const t of T) {
    if (t.kind !== 'etype' || t.group === 'nade') continue;
    berm(b, 'sand', t.x, t.z - 1.05, t.yaw - Math.PI, 1.9, 1.5, 0.52, { color: 0xc9b597, seed: Math.round(t.x * 7 + t.z), collide: false });
  }
  for (const [d, z] of [[10, 21.6], [25, 36.6], [50, 61.6], [75, 86.6], [100, 111.6]] as [number, number][]) {
    signBoard(b, cm, -16.6, z, Math.PI, 0.72, 0.36, 0.55, S.dist[d], { posts: 1, back: 0xe8e4da });
  }
  for (let k = 0; k < 8; k++) signBoard(b, cm, -12 + k * 4 + 1.3, 20.4, Math.PI, 0.3, 0.3, 0.32, S.lanes[k], { posts: 1, back: 0xe8c22a });
  // scrub and a few old hulks downrange
  for (let i = 0; i < 70; i++) {
    const x = b.r(-15.5, 19.5), z = b.r(18, 108);
    if (T.some((t) => Math.abs(t.x - x) < 1.6 && Math.abs(t.z - z) < 2.2)) continue;
    if (Math.abs(x + 17) < 2.4) continue;
    if (b.rnd() < 0.55) b.model(b.pick(['bush_s', 'bush_m'] as const), x, -0.02, z, b.r(0, 6.28), { scale: b.r(0.8, 1.6), color: 0xc9c4a6 });
    else b.model('rock', x, -0.05, z, b.r(0, 6.28), { scale: b.r(0.12, 0.4), color: 0xd8c8b0 });
  }
  P.pickup(b, 13.5, 82, 0.6, 0x5a5650, true);
  P.tires(b, -9, 74, 3);
  P.tires(b, 16.5, 97, 2);
  b.model('barrel', -1.5, 0, 70.5, 0, { color: 0x6a6458 });
  // Tier-1 tactical downrange urban breach-wall facades (strictly behind NPC lanes & clear of every steel sightline)
  A.urbanFacadeTarget(b, -12.6, 69.5, 0.22, 4.4, 2.75);
  A.urbanFacadeTarget(b, 15.6, 68.5, -0.25, 4.4, 2.75);
  A.urbanFacadeTarget(b, -12.2, 92.5, 0.18, 4.8, 2.9);
  A.urbanFacadeTarget(b, 16.5, 88.0, -0.22, 4.6, 2.85);
  // Rugged photogrammetry rock formations, tire revetments & blast craters embedding the range into a natural desert canyon
  b.model('dead_trunk', -14.2, 0, 88.0, 1.4, { scale: 1.2 });
  b.model('boulder_a', 15.6, -0.05, 86.4, 0.8, { scale: 1.25, color: 0xcabaa2 });
  b.model('boulder_b', -10.8, -0.05, 102.0, 2.1, { scale: 1.35, color: 0xc6b69e });
  b.model('boulder_c', 14.5, -0.05, 107.5, -1.2, { scale: 1.4, color: 0xccbca4 });
  // Stacked rubber-tire ballistic revetments & concrete baffles lining both side berms (clear of lanes)
  for (let z = 24; z <= 104; z += 16) {
    P.tires(b, -17.8, z, 4);
    P.tires(b, 21.6, z + 6, 4);
    b.model(b.pick(['boulder_a', 'boulder_b', 'boulder_c'] as const), -19.2, 0.2, z + 7, b.r(0, 6.28), { scale: b.r(1.3, 2.2), color: 0xc7b69d });
    b.model(b.pick(['boulder_a', 'boulder_b', 'boulder_c'] as const), 23.4, 0.2, z + 2, b.r(0, 6.28), { scale: b.r(1.3, 2.2), color: 0xc7b69d });
  }
  // Dramatic sandstone rock wall embedded into the 100m backstop & side berms (solid 360-degree scanned boulders)
  for (const [cx, cz, sx, sy, rot] of [
    [-22.0, 117.0, 2.8, 2.2, 0.2], [-9.5, 118.5, 3.2, 2.5, -0.15], [3.5, 119.0, 3.4, 2.6, 0.35],
    [15.5, 118.2, 3.1, 2.4, -0.25], [26.0, 117.5, 2.9, 2.3, -0.3],
    [-25.5, 86.0, 2.4, 1.8, 1.4], [29.5, 78.0, 2.5, 1.9, -1.5],
    [-25.0, 48.0, 2.3, 1.7, 1.6], [29.2, 46.0, 2.4, 1.8, -1.4],
  ] as [number, number, number, number, number][]) {
    b.model(b.pick(['boulder_a', 'boulder_b', 'boulder_c'] as const), cx, -0.6, cz, rot, {
      scale: { x: sx * 1.25, y: sy, z: sx * 1.15 },
      color: 0xb69c7e,
    });
  }
  // Shell impact craters downrange (strictly outside target hitboxes)
  b.model('prop_crater', -5.5, -0.02, 49.0, 0.6, { scale: { x: 0.45, y: 0.14, z: 0.45 }, color: 0x7c7060 });
  b.model('prop_crater', 8.5, -0.02, 74.0, 2.1, { scale: { x: 0.52, y: 0.16, z: 0.52 }, color: 0x7a6e5e });
}

function buildGrenadeBay(b: LevelBuilder, cm: CampMats, S: Signs, lvl: LevelData) {
  b.region = 'pit';
  // two throwing bays; the player uses the east one
  for (const cx of [-28, -34.4]) {
    b.box('slab', cx, -0.1, 10.6, 4.8, 0.2, 4.4, { color: 0xc4beb2 });
    for (const sx of [-2.3, 2.3]) b.box('slab', cx + sx, 0.1, 10.5, 0.24, 1.6, 4.2, { color: 0xccc6b8, absGrime: true });
    b.box('slab', cx, 0.1, 12.7, 4.84, 1.02, 0.3, { color: 0xccc6b8, absGrime: true });
    P.sandbags(b, cx - 2.3, 10.5, H, 4.0, 2, 1.7, false);
    P.sandbags(b, cx + 2.3, 10.5, H, 4.0, 2, 1.7, false);
    stencil(b, cm, cx, 0.65, 12.54, Math.PI, 1.4, 0.52, S.danger, 0xffffff);
  }
  // Overhead steel blast-deflector canopy sheltering the rear staging half (z = 8.2..10.1), leaving z > 10.2 open sky for grenade throwing arcs
  for (const px of [-36.7, -32.1, -30.3, -25.7]) {
    for (const pz of [8.45, 10.05]) b.box('darkmetal', px, 0.1, pz, 0.12, 2.65, 0.12, { color: 0x45494c });
    b.deco('darkmetal', px, 2.65, 9.25, 0.1, 0.12, 2.1, { color: 0x45494c });
  }
  b.deco('corrugated', -31.2, 2.75, 9.25, 11.8, 0.055, 2.25, { color: 0x7f8278 });
  b.model('security_light', -28.0, 2.48, 8.55, 0, { scale: 0.65 });
  b.model('security_light', -34.4, 2.48, 8.55, 0, { scale: 0.65 });
  // grenade crates in the east bay
  P.crate(b, -29.5, 0.1, 9.4, 0.5, 0, true);
  b.model('mil_crate_open', -26.6, 0.1, 9.2, -H + 0.1, {});
  stencil(b, cm, -29.5, 0.25, 9.61, 0, 0.62, 0.23, S.inert, 0xffffff);
  // the instructor's sandbag position behind the bays
  P.sandbags(b, -31.6, 7.7, 0, 3.0, 5);
  P.sandbags(b, -33.3, 6.4, H, 2.0, 5);
  signBoard(b, cm, -37.2, 5.4, 2.5, 1.6, 0.8, 1.0, S.nade);
  b.model('field_radio', -32.4, 0.95, 7.7, 0.4, {});

  // the impact area: sculpted 3D blast craters + charred pickup hulk target
  berm(b, 'sand', -39.5, 29, H, 30, 7, 3.4, { color: 0xd2bfa0, seed: 21 });
  berm(b, 'sand', -30, 42.5, 0, 22, 8, 4.2, { color: 0xd2bfa0, seed: 23 });
  for (const [cx, cz, cr, cs] of [[-30.2, 23.6, 0.4, 0.44], [-25.8, 28.8, 1.9, 0.38], [-32.4, 30.2, 3.2, 0.42]] as [number, number, number, number][]) {
    b.model('prop_crater', cx, -0.02, cz, cr, { scale: { x: cs, y: cs * 0.45, z: cs }, color: 0x746b60 });
  }
  P.pickup(b, -27.6, 31.4, 0.35, 0x3a3632, true);
  P.tires(b, -33.4, 27.6, 2);
  // Placed cleanly on the flat grenade-pit floor (clear of Firing Range West Berm at x=-21.5 & charred pickup at (-27.6, 31.4)!)
  P.tires(b, -25.8, 27.6, 3);
  for (let i = 0; i < 18; i++) {
    const x = b.r(-35.5, -26.5), z = b.r(16, 38);
    b.model('rock', x, -0.05, z, b.r(0, 6.28), { scale: b.r(0.1, 0.35), color: 0x9a8a78 });
  }
  b.model('boulder_a', -35.0, -0.08, 34.8, 1.2, { scale: 1.2, color: 0xd2c2aa });
  b.model('boulder_b', -26.6, -0.08, 35.2, -0.6, { scale: 1.15, color: 0xd0c0a8 });
  b.model('dead_trunk', -35.6, 0, 37.0, 0.8, { scale: 1.1 });
  for (const t of targetSpecs()) if (t.group === 'nade') berm(b, 'sand', t.x, t.z - 0.9, t.yaw - Math.PI, 1.8, 1.3, 0.45, { color: 0xb9a68a, collide: false, seed: 4 });
  lvl.fires.push(new THREE.Vector3(-27.2, 0.9, 31.5));
  lvl.barrels.push({ x: -28.4, y: 0, z: 26.2 });
  P.clutter(b, 'medical_box', -30.5, 7.6, 0.25, 0);
  P.clutter(b, 'ammo_box', -32.9, 5.4, 0.5, 0, 1.2);
}

function buildCourse(b: LevelBuilder, cm: CampMats, S: Signs) {
  b.region = 'course';
  const C = TRAIN.course;
  const x0 = -52.4, x1 = -42.6, xc = (x0 + x1) / 2, W = x1 - x0;
  ropeFence(b, [[-52.7, 8.5], [-52.7, -41]]);
  ropeFence(b, [[-42.3, 8.5], [-42.3, -33.6]]);
  // start banner + structural steel gantry truss spanning the course start
  signBoard(b, cm, xc, 7.4, 0, W, 0.62, 2.35, S.start, { postCol: 0x4a4c46, thick: 0.05 });
  for (const gz of [7.4, C.finish]) {
    for (const gx of [x0 - 0.15, x1 + 0.15]) {
      b.box('concrete', gx, 0, gz, 0.44, 0.28, 0.44, { color: 0xb8b2a6 });
      b.box('darkmetal', gx, 0.28, gz, 0.18, 3.55, 0.18, { color: 0x42464a });
    }
    b.deco('darkmetal', xc, 3.22, gz, W + 0.45, 0.1, 0.14, { color: 0x42464a });
    b.deco('darkmetal', xc, 3.74, gz, W + 0.45, 0.1, 0.14, { color: 0x42464a });
    for (let i = 0; i < 6; i++) {
      const lx0 = x0 + (i / 6) * W, lx1 = x0 + ((i + 1) / 6) * W;
      b.tube('darkmetal', new THREE.Vector3(lx0, i % 2 ? 3.24 : 3.74, gz), new THREE.Vector3(lx1, i % 2 ? 3.74 : 3.24, gz), 0.025, 0x4e5256, 5);
    }
    b.model('security_light', x0 + 0.02, 2.85, gz, H, { scale: 0.62 });
    b.model('security_light', x1 - 0.02, 2.85, gz, -H, { scale: 0.62 });
  }
  b.deco('paint', xc, 0, C.startZ, W - 0.2, 0.01, 0.14, { color: 0xe8e4d6 });
  // 1) log wall (vault)
  const log = (x: number, y: number, z: number, len: number, r: number, rotY = 0) => {
    const g = new THREE.CylinderGeometry(r, r * 1.05, len, 10);
    b.geo('trunk', g, { x, y, z }, new THREE.Euler(0, rotY, H, 'YXZ'), 1, new THREE.Color(0x8a7458).multiplyScalar(b.r(0.85, 1.1)).getHex());
    g.dispose();
  };
  for (let i = 0; i < 3; i++) log(xc, 0.12 + i * 0.235, C.wall1, W, 0.125);
  for (const x of [x0, xc, x1]) {
    b.deco('wood', x, 0, C.wall1 - 0.18, 0.12, 0.85, 0.12, { color: 0x6a5840 });
    b.deco('wood', x, 0, C.wall1 + 0.18, 0.12, 0.85, 0.12, { color: 0x6a5840 });
  }
  b.solid(xc, 0, C.wall1, W, 0.72, 0.36, 0, 'wood');
  // 2) crawl bars
  for (const z of C.bars) {
    for (const x of [x0, xc, x1]) b.box('wood', x, 0, z, 0.16, 1.62, 0.16, { color: 0x6a5840 });
    log(xc, 1.43, z, W, 0.1);
    b.solid(xc, 1.33, z, W, 0.7, 0.24, 0, 'wood');
  }
  // 3) tyre run
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 8; c++) {
      const x = x0 + 0.8 + c * 1.18 + (r % 2) * 0.4, z = C.tires + 2.6 - r * 1.0;
      if (x > x1 - 0.5) continue;
      b.model('tyre', x, 0, z, b.r(0, 6.28), { scale: 1.38, tilt: [b.r(-0.05, 0.05), b.r(-0.05, 0.05)] });
    }
  }
  // 4) sandbag wall (vault)
  P.sandbags(b, xc, C.wall2, 0, W, 4);
  // finish
  b.deco('paint', xc, 0, C.finish, W - 0.2, 0.01, 0.14, { color: 0xe8e4d6 });
  signBoard(b, cm, x1 + 0.9, C.finish + 0.3, -H, 1.3, 0.49, 1.2, S.finish);
  // stopwatch table & bench at the start
  P.solidProp(b, 'table', -40.6, 5.6, 0.2, 0, 0.82, { surface: 'wood', maxH: 0.78 });
  b.model('clipboard', -40.6, 0.8, 5.5, 0.6, {});
  b.model('megaphone', -40.2, 0.8, 5.8, 2.2, {});
  P.solidProp(b, 'bench', -54.6, 4.0, H, 0, 1, { surface: 'wood', maxH: 0.5 });
  b.model('plastic_bin', -54.8, 0, -2.0, H, {});
  // dummy pen
  P.sandbags(b, -47.5, -40.2, 0, 3.6, 3);
  P.tires(b, -51.2, -39.4, 3);
}

function buildKillHouse(b: LevelBuilder, cm: CampMats, S: Signs) {
  b.region = 'cqb';
  const Q = TRAIN.cqb;
  const WH = 2.5, WT = 0.12, osb = 0xd8c39e;
  // concrete pad
  b.box('slab', -28, -0.1, -44, 25, 0.16, 17, { color: 0xbdb7ab, grime: 1 });
  const y0 = 0.06;
  const door = (at: number) => ({ at, w: 1.15, y0: 0, y1: 2.1 });
  b.wall('osb', 'x', -36, -40, -16, y0, WH, WT, [door(Q.entry.x)], osb);
  b.wall('osb', 'x', -52, -40, -16, y0, WH, WT, [], osb);
  b.wall('osb', 'z', -40, -52, -36, y0, WH, WT, [], osb);
  b.wall('osb', 'z', -16, -52, -36, y0, WH, WT, [door(Q.exit.z)], osb);
  b.wall('osb', 'x', -44, -40, -16, y0, WH, WT, [door(-35.5), door(-19.5)], osb);
  b.wall('osb', 'z', -31, -52, -36, y0, WH, WT, [door(-48)], osb);
  b.wall('osb', 'z', -23, -52, -44, y0, WH, WT, [door(-48)], osb);
  // studs and top plates on the faces, door casings
  const studs = (axis: 'x' | 'z', c: number, a0: number, a1: number, side: number, skip: number[]) => {
    for (let a = a0 + 0.6; a < a1 - 0.3; a += 1.2) {
      if (skip.some((s) => Math.abs(s - a) < 0.85)) continue;
      if (axis === 'x') b.deco('wood', a, y0, c + side * (WT / 2 + 0.02), 0.045, WH, 0.04, { color: 0x9c8460 });
      else b.deco('wood', c + side * (WT / 2 + 0.02), y0, a, 0.04, WH, 0.045, { color: 0x9c8460 });
    }
    if (axis === 'x') b.deco('wood', (a0 + a1) / 2, y0 + WH, c, a1 - a0, 0.05, WT + 0.1, { color: 0x8c7454 });
    else b.deco('wood', c, y0 + WH, (a0 + a1) / 2, WT + 0.1, 0.05, a1 - a0, { color: 0x8c7454 });
  };
  studs('x', -36, -40, -16, 1, [Q.entry.x]);
  studs('x', -52, -40, -16, -1, []);
  studs('z', -40, -52, -36, -1, []);
  studs('z', -16, -52, -36, 1, [Q.exit.z]);
  studs('x', -44, -40, -16, 1, [-35.5, -19.5]);
  studs('z', -31, -52, -36, 1, [-48]);
  studs('z', -23, -52, -44, 1, [-48]);
  const casing = (axis: 'x' | 'z', c: number, at: number) => {
    for (const s of [-0.6, 0.6]) {
      if (axis === 'x') b.deco('wood', at + s, y0, c, 0.07, 2.12, WT + 0.06, { color: 0x8c7454 });
      else b.deco('wood', c, y0, at + s, WT + 0.06, 2.12, 0.07, { color: 0x8c7454 });
    }
    if (axis === 'x') b.deco('wood', at, y0 + 2.1, c, 1.3, 0.08, WT + 0.06, { color: 0x8c7454 });
    else b.deco('wood', c, y0 + 2.1, at, WT + 0.06, 0.08, 1.3, { color: 0x8c7454 });
  };
  casing('x', -36, Q.entry.x); casing('z', -16, Q.exit.z); casing('x', -44, -35.5); casing('x', -44, -19.5); casing('z', -31, -48); casing('z', -23, -48);
  // Structural steel H-beam corner/junction posts, concrete exterior buttresses & ballistic tire bullet-trap walls
  for (const [px, pz] of [[-40, -36], [-40, -52], [-16, -36], [-16, -52], [-40, -44], [-16, -44], [-31, -36], [-31, -52], [-23, -52]] as [number, number][]) {
    b.deco('darkmetal', px, y0, pz, 0.22, WH + 0.14, 0.22, { color: 0x3b3f42 });
    b.deco('concrete', px, y0, pz, 0.42, 0.42, 0.42, { color: 0xb6b0a4 });
  }
  // Tactical sandbagged base skirts & stacked tire ballistic revetments along the exterior Killhouse walls (leaving entry & exit doors clear)
  P.sandbags(b, -26.5, -35.65, 0, 14.2, 3, 0, false);
  P.sandbags(b, -28.0, -52.35, 0, 22.0, 3, 0, false);
  P.sandbags(b, -40.35, -44.0, H, 14.5, 3, 0, false);
  for (const tx of [-33.0, -29.5, -24.0, -20.5, -17.5]) P.tires(b, tx, -35.4, 3);
  for (const tz of [-38.5, -42.5, -46.5, -50.2]) P.tires(b, -40.6, tz, 4);
  // Overhead tactical steel gantry beams spanning rooms A–E (authentic SAS/Delta shoot-house architecture)
  for (const [lx, lz] of [[-35.5, -40.0], [-35.5, -48.0], [-27.0, -48.0], [-19.5, -48.0], [-23.5, -40.0]] as [number, number][]) {
    b.deco('darkmetal', lx, y0 + WH + 0.04, lz, 0.1, 0.12, 7.8, { color: 0x383c3f });
    b.model('hanging_lamp', lx, y0 + WH - 0.36, lz, 0, { scale: 0.56 });
  }
  // room letters + flow arrows
  const L = S.letters;
  stencil(b, cm, -37.6, 1.75, -35.93, 0, 0.5, 0.5, L.A);
  stencil(b, cm, -36.75, 1.75, -44.07, Math.PI, 0.5, 0.5, L.B);
  stencil(b, cm, -36.75, 1.75, -43.93, 0, 0.5, 0.5, L.B);
  stencil(b, cm, -31.07, 1.75, -46.6, -H, 0.5, 0.5, L.C);
  stencil(b, cm, -23.07, 1.75, -46.6, -H, 0.5, 0.5, L.D);
  stencil(b, cm, -20.75, 1.75, -44.07, Math.PI, 0.5, 0.5, L.E);
  stencil(b, cm, -38.3, 1.0, -35.93, 0, 0.42, 0.42, S.arrow, 0xffffff);
  stencil(b, cm, -15.93, 1.75, -41.4, H, 0.5, 0.5, S.arrow, 0xffffff);
  stencil(b, cm, -28, 1.6, -35.93, 0, 1.3, 0.48, S.killhouse);
  // furniture and cover
  const C = P.clutter;
  P.solidProp(b, 'table', -37.6, -38.2, 0.1, y0, 0.82, { surface: 'wood', maxH: 0.78 });
  C(b, 'chair', -38.6, -37.4, 2.4, y0);
  C(b, 'chair', -36.6, -39.2, -0.4, y0);
  b.box('wood', -39.35, y0, -40.6, 0.9, 0.45, 2.0, { color: 0x6a5a48 });
  b.deco('fabric', -39.35, y0 + 0.45, -40.6, 0.84, 0.14, 1.9, { color: 0x5a5e48 });
  P.crate(b, -31.75, y0, -38.6, 0.85, 0.1);
  P.crate(b, -31.75, y0 + 0.85, -38.6, 0.6, 0.5);
  P.solidProp(b, 'office_desk', -36, -51.35, Math.PI, y0, 1, { surface: 'metal', maxH: 0.8 });
  C(b, 'field_radio', -36.4, -51.4, 0.2, y0 + 0.79);
  C(b, 'ph_laptop', -35.65, -51.3, 0.15, y0 + 0.79);
  C(b, 'cardboard_stack', -39.2, -45.4, H, y0);
  P.solidProp(b, 'plastic_bin', -33.8, -45.0, 0.1, y0, 1, { maxH: 0.45, surface: 'fabric' });
  P.solidProp(b, 'table', -25.6, -46.9, 0.3, y0, 0.82, { surface: 'wood', maxH: 0.78 });
  C(b, 'chair', -26.6, -47.8, 0.8, y0);
  P.barrel(b, -26.5, -51.3, 0x4a5a3a, y0);
  P.barrel(b, -27.2, -51.4, 0x5a5040, y0);
  b.box('wood', -17.0, y0, -47.6, 1.9, 0.45, 0.9, { color: 0x6a5a48 });
  b.deco('fabric', -17.0, y0 + 0.45, -47.6, 1.8, 0.14, 0.84, { color: 0x5a5e48 });
  P.crate(b, -17.3, y0, -45.0, 0.9, 0.2);
  C(b, 'stool', -21.5, -50.8, 0.6, y0);
  P.pallet(b, -26.6, y0, -36.9, 0.2);
  P.pallet(b, -26.6, y0 + 0.12, -36.9, 0.35);
  b.model('ph_shelves', -22.3, y0, -37.0, 0, {});
  P.barrel(b, -17.0, -36.9, 0x3f4a3a, y0);
  b.model('ph_sec_cam', -35.6, y0 + WH - 0.15, -35.82, 0.3, { scale: 1.0 });
  // observation catwalk over the B/C/D wall, stairs outside the east wall
  const cy = 3.0;
  for (const x of [-39.8, -37.2, -33.2, -29.0, -25.0, -21.4, -17.2]) b.deco('darkmetal', x, 0, -44, 0.1, cy, 0.1, { color: 0x4a4c48 });
  b.box('metal', -27, cy, -44, 27.4, 0.07, 1.2, { color: 0x6c6e68 });
  const RN = 7, RL = 27.4 / RN;
  for (const s of [-0.6, 0.6]) {
    for (let i = 0; i < RN; i++) {
      if (s < 0 && i === RN - 1) continue; // gap for the stairs
      b.model('railing', -40.7 + RL * (i + 0.5), cy + 0.07, -44 + s, 0, { scale: { x: RL / 4, y: 1, z: 1 } });
    }
  }
  b.stairs('metal', -14.4, -50.2, 0, 1, 1.0, 0, cy, 4.8, 0x6c6e68, false);
  b.box('metal', -14.4, cy - 0.07, -44.7, 1.2, 0.07, 1.8, { color: 0x6c6e68 });
  b.solid(-14.4, 0, -48.2, 1.4, 2.6, 6.2);
  b.model('barricade', -14.4, 0, -51.4, 0, {});
  signBoard(b, cm, -13.3, -51.2, 0.3, 0.7, 0.35, 0.9, S.noEntry, { posts: 1 });
  // staging area: plan board, benches, cones
  {
    const rot = face(-33.2, -33.2, -36.5, -31);
    b.model('notice_board', -33.2, 0, -33.2, rot, {});
    b.solid(-33.2, 0, -33.2, 1.8, 2.0, 0.3, rot, 'wood');
    const f = new Frame(b, -33.2, -33.2, rot);
    const { right, up } = faceAxes(rot);
    quad(b, cm.sign, f.v(0, 1.35, 0.008), right, up, 1.08, 0.8, S.plan);
  }
  signBoard(b, cm, -24, -34.6, 0, 1.8, 0.9, 1.0, S.cqb);
  P.solidProp(b, 'bench', -38.8, -31.4, 0, 0, 1, { surface: 'wood', maxH: 0.5 });
  C(b, 'ammo_box', -37.4, -31.6, 0.3, 0, 1.2);
  C(b, 'toolbox', -39.6, -31.2, 1.2, 0.45);
  for (const [x, z] of [[-35.4, -34.6], [-37.6, -34.6], [-15, -38.6], [-15, -41.4]]) C(b, 'traffic_cone', x, z, b.r(0, 6));
  // debrief point on a crisp concrete pad beneath the shaded camo net
  b.box('slab', -11.8, -0.06, -40.6, 5.4, 0.12, 4.6, { color: 0xbcb6aa, grime: 0.9, nav: false });
  P.solidProp(b, 'table', -11.8, -41.0, 0, 0.06, 0.82, { surface: 'wood', maxH: 0.78 });
  C(b, 'ph_laptop', -11.85, -40.95, 0.2, 0.84);
  C(b, 'field_radio', -12.35, -41.0, 0.4, 0.84);
  C(b, 'clipboard', -11.4, -40.8, -0.3, 0.84);
  C(b, 'binoculars', -11.5, -41.2, 0.5, 0.84);
  C(b, 'medical_box', -12.3, -41.4, 0.1, 0.84);
  C(b, 'chair', -11.8, -41.8, 0, 0.06);
  C(b, 'chair', -12.6, -40.4, 1.2, 0.06);
  b.model('mil_crate', -13.2, 0, -42.2, 0.2, {});
  b.model('jerrycan', -13.6, 0, -39.8, 0.8, {});
  b.model('ammo_box', -15.2, 0, -49.2, 0.4, {});
  P.sandbags(b, -15.4, -50.8, 0, 1.2, 2, 0.8, false);
  signBoard(b, cm, -8.6, -38.6, -H + 0.3, 1.3, 0.81, 0.9, S.score);
  camoNet(b, cm, -11.5, -40.5, 0, 6, 5, 3.2, [[2.2, -1.5]], 41);
}

function buildCamp(b: LevelBuilder, cm: CampMats, S: Signs, group: THREE.Group, flags: ReturnType<typeof makeFlags>, lvl: LevelData) {
  b.region = 'camp';
  // living area: GP tents under a big camo net, smoke pit
  gpTent(b, -9, -27.5, 0);
  gpTent(b, -2, -27.5, 0, 5.6, 9.8, 0x6e6a50);
  camoNet(b, cm, -5.5, -27.5, 0, 17, 13, 4.6, [[-3.5, -2.5], [-3.5, 2.5], [3.5, 0]], 7);
  duckboard(b, -9, -22.2, -8.4, -14.6);
  duckboard(b, -2, -22.2, -1.4, -14.6);
  const C = P.clutter;
  b.model('barrel_x', -5.6, 0, -18.4, 0.3, { color: 0x6a5a48 });
  b.world.addBox(-5.6, 0.44, -18.4, 0.28, 0.44, 0.28, 0, 'metal', true);
  lvl.fires.push(new THREE.Vector3(-5.6, 0.95, -18.4));
  for (const [x, z, r] of [[-7.4, -18.0, H + 0.2], [-5.4, -16.4, 0.1], [-3.8, -18.9, -H + 0.3]] as [number, number, number][]) P.solidProp(b, 'bench', x, z, r, 0, 1, { surface: 'wood', maxH: 0.5 });
  P.solidProp(b, 'notice_board', -12.2, -20.4, H - 0.2, 0, 0.9, { surface: 'wood', shrink: 0.5 });
  C(b, 'trash_can', -11.6, -23.4, 0.3);
  C(b, 'cardboard_stack', -12.4, -31.8, H);
  P.solidProp(b, 'plastic_bin', -12.6, -34.0, H, 0, 1, { maxH: 0.45, surface: 'fabric' });
  for (let i = 0; i < 4; i++) portaJohn(b, -15.2, -24 - i * 1.25, H, i % 2 ? 0x2a5a8a : 0x3a6a4a);
  // sergeant's humvee at the junction
  P.humvee(b, -2.2, -12.3, 0.03, 0xa89a72);
  P.solidProp(b, 'jerrycan', 0.4, -13.6, 0.4, 0, 1);

  // signpost at the junction
  {
    const x = 4.3, z = -14.6;
    b.cyl('wood', x, 0, z, 0.07, 3.4, 0x7a6448, { segs: 8, collide: true, surface: 'wood' });
    S.posts.forEach((p, i) => {
      const rot = Math.atan2(-p.dir[1], p.dir[0]);
      const y = 3.0 - i * 0.3;
      const f = new Frame(b, x, z, rot);
      f.d('wood', 0.62, y - 0.12, 0, 1.3, 0.24, 0.035, { color: 0x6a5a44 });
      const { right, up, normal } = faceAxes(rot);
      quad(b, cm.sign, f.v(0.62, y, 0).addScaledVector(normal, 0.02), right, up, 1.3, 0.22, p.front);
      quad(b, cm.sign, f.v(0.62, y, 0).addScaledVector(normal, -0.02), right.clone().negate(), up, 1.3, 0.22, p.back);
    });
  }
  signBoard(b, cm, 12.6, -21.6, -H + 0.25, 3.2, 1.2, 1.3, S.camp, { postCol: 0x4a4c46, thick: 0.06 });
  signBoard(b, cm, 11.8, -2.0, -H, 0.6, 0.6, 1.5, S.speed, { posts: 1 });
  signBoard(b, cm, 4.4, -50, H, 0.6, 0.6, 1.5, S.speed, { posts: 1 });

  // Open-air tactical briefing pavilions: field CQB staging briefing + main parade-road command briefing
  A.briefingPavilion(b, -25.5, -20.5, 0);
  A.briefingPavilion(b, 16.2, -25.8, -H);

  // TOC compound: 26.4k-tri sculpted two-story military container HQ (`bldg_chu`, true roof height = 4.88m) + sat dish flush on roof
  P.closedBuilding(b, -3.5, -49.6, 13, 7.4, 4.6, { color: 0xc9bea6, doors: ['s'], detail: 1, model: 'bldg_chu' });
  b.model('arch_sat_dish', -7.2, 4.88, -48.6, 0.4, { scale: 1.65 });
  tWalls(b, -8.6, -43.4, 0, 4);
  tWalls(b, 2.2, -43.4, 0, 4);
  tWalls(b, -3.4, -41.2, 0, 3);
  signBoard(b, cm, -3.4, -40.92, 0, 2.6, 0.87, 1.6, S.toc, { posts: 0 });
  for (const [x, z] of [[-8, -51.5], [-0.5, -52.3], [2.5, -48]]) b.cyl('darkmetal', x, 4.88, z, 0.02, b.r(3, 5), 0x2a2a2a, { segs: 4 });
  P.radioMast(b, -13.6, -52.6, 17);
  satDish(b, -8.6, -55.4, 0.6);
  P.solidProp(b, 'generator', 4.4, -51, H, 0, 1, { surface: 'metal' });
  P.wire(b, new THREE.Vector3(4.0, 0.9, -51), new THREE.Vector3(3, 3.1, -49.6), 0.25);
  flagPole(b, cm, group, -7.6, -40.6, -0.53, flags.unit, 8.5);
  flagPole(b, cm, group, 0.8, -40.6, -0.53, flags.jtf, 8.5);
  // Landscaped stone tree planters framing the TOC plaza & camp welcome junction (verified clear of roads/NPCs)
  P.treePlanter(b, 3.1, -39.2, 7.6, 1.0);
  P.treePlanter(b, 15.6, -17.4, 8.0, 1.15);
  b.model('security_light', -3.5, 2.65, -45.85, 0, { scale: 0.72 });
  // Offset 0.8m west cleanly clear of T-Wall foot at (-8.6, -43.4)
  P.sandbags(b, -13.4, -42.6, 0.2, 3, 5);
  C(b, 'mil_crate_open', -5.4, -44.8, 0.25);
  C(b, 'ammo_box', -1.8, -44.6, -0.3, 0, 1.2);
  // billets: two facing rows of CHUs with a duckboard walk between them
  let n = 0;
  for (const [z, rot] of [[-33.6, Math.PI], [-43.4, 0]] as [number, number][]) {
    for (const x of [17, 24.6, 32.2, 39.8]) chu(b, cm, x, z, rot, S.chu[n++], { light: true });
  }
  // Overhead camo sun-shades anchored directly to the facing CHU container roof edges (y = 2.77)
  P.streetCanopy(b, new THREE.Vector3(24.6, 2.77, -34.82), new THREE.Vector3(24.6, 2.77, -42.18), 3.4, 0x6c6e52, 0.26, false);
  P.streetCanopy(b, new THREE.Vector3(36.0, 2.77, -34.82), new THREE.Vector3(36.0, 2.77, -42.18), 3.4, 0x7a7054, 0.26, false);
  // Terminated cleanly at x=41.2 / x=39.8 so zero overlap with Motor Pool fuel bund & steel-truss hangar column!
  hescoLine(b, 13.2, -30.3, 41.2, -30.3, 1);
  hescoLine(b, 13.2, -46.6, 39.8, -46.6, 1);
  duckboard(b, 12.4, -38.5, 43.4, -38.5, 1.4);
  P.solidProp(b, 'generator', 45.2, -38.5, 0, 0, 1, { surface: 'metal' });
  for (const x of [20.8, 28.4, 36]) P.wire(b, new THREE.Vector3(x, 2.8, -34.8), new THREE.Vector3(x, 2.8, -42.2), 0.4);
  C(b, 'stool', 18.2, -36.8, 0.3);
  C(b, 'stool', 25.4, -40.4, 1.4);
  P.solidProp(b, 'bench', 31, -36.6, 0, 0, 1, { surface: 'wood', maxH: 0.5 });
  C(b, 'trash_can', 42.6, -36.4, 0.2);
  C(b, 'plastic_bin', 14.2, -40.6, 0.3);
  // helipad: weathered concrete tarmac slab + painted tactical "H" circle + perimeter lights + dark olive military helicopter
  {
    b.box('concrete', 27, -0.02, -19.5, 13.4, 0.06, 13.4, { color: 0xb2aca0, grime: 0.9, nav: false });
    const g = new THREE.PlaneGeometry(11, 11);
    g.rotateX(-H);
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const [u0, v0, u1, v1] = S.heli;
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = u0 + (pos.getX(i) / 11 + 0.5) * (u1 - u0);
      uv[i * 2 + 1] = v0 + (0.5 - pos.getZ(i) / 11) * (v1 - v0);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    b.geo(cm.decal, g, { x: 27, y: 0.045, z: -19.5 }, null, 1, 0xffffff);
    g.dispose();
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, -6.5], [0, 6.5], [-6.5, 0], [6.5, 0]]) {
      b.deco('darkmetal', 27 + dx, 0.04, -19.5 + dz, 0.22, 0.12, 0.22, { color: 0x333333 });
      const lamp = new THREE.BoxGeometry(0.14, 0.05, 0.14);
      b.geo(cm.lamp, lamp, { x: 27 + dx, y: 0.18, z: -19.5 + dz }, null, 1, 0xffffff);
      lamp.dispose();
    }
    // Camp Anvil 23k-tri tactical military helicopter parked heroically on the helipad + windsock
    P.helicopter(b, 27.0, -19.5, -Math.PI * 0.24, 0x4f5642);
    b.cyl('darkmetal', 34.4, 0, -14.2, 0.055, 5.2, 0x45484a, { segs: 8, collide: true });
    const sock = new THREE.CylinderGeometry(0.11, 0.28, 1.35, 10, 1, true);
    b.geo('fabric', sock, { x: 35.15, y: 4.9, z: -14.2 }, new THREE.Euler(0, 0, -Math.PI * 0.44), 1, 0xc84e24);
    sock.dispose();
  }
  // street lights along the roads
  for (const x of [-30, -10, 14, 34, 50]) P.solidProp(b, 'street_light', x, -14.4, Math.PI, 0, 1, { shrink: 0.4, maxH: 4 });
  for (const z of [-24, -46]) P.solidProp(b, 'street_light', 12.2, z, -H, 0, 1, { shrink: 0.4, maxH: 4 });
  for (const x of [-12, 8]) P.solidProp(b, 'street_light', x, -2.4, 0, 0, 1, { shrink: 0.4, maxH: 4 });
  // vehicles parked behind the firing line
  P.cargoTruck(b, 12.6, 5.9, 0, 0x5c6344);
  P.humvee(b, -6.2, 5.8, Math.PI, 0xb2a27a);
  // ammo point by the range entrance
  P.tent(b, 26.6, 9.8, 0.1, 4, 5, 0x6a6f4c);
  for (let i = 0; i < 4; i++) P.crate(b, 23.4, i < 2 ? 0 : 0.48, 8.8 + (i % 2) * 0.9, 0.6, H, true);
  C(b, 'ammo_box', 24.0, 10.6, 0.2, 0, 1.3);
  C(b, 'ammo_box', 24.2, 10.9, 1.2, 0, 1.3);
  C(b, 'medical_box', 27.4, 7.0, 0.3, 0);
  P.dumpster(b, 29.8, 7.4, -0.2);
}

function buildMotorPool(b: LevelBuilder, cm: CampMats, S: Signs) {
  b.region = 'motor';
  // Crisp painted parking stall markings for the motor pool bays
  for (const bx of [41.7, 45.5, 49.3]) b.deco('paint', bx, 0.005, -50.5, 0.14, 0.006, 5.8, { color: 0xdcc050 });
  b.deco('paint', 45.5, 0.005, -53.4, 7.8, 0.006, 0.14, { color: 0xdcc050 });
  // Scenic desert palm clusters framing the camp perimeter & entrance approach (clear of roads)
  P.treePlanter(b, 15.2, -3.6, 7.4, 1.1);
  P.treePlanter(b, -18.5, -16.8, 8.2, 1.15);
  P.tree(b, -32.5, -17.2, 7.8);
  P.humvee(b, 43.6, -50.4, H, 0xa89a72);
  P.armoredTruck(b, 47.4, -50.6, H + 0.04, 0x8a8c72);
  // Heavy exposed steel-truss motor pool maintenance hangar shading both tactical vehicle bays
  A.steelTrussRoof(b, 45.5, -50.5, 0, 9.6, 7.6, 3.85, { bays: 2, roofColor: 0x6c7258, lamps: true });
  P.cargoTruck(b, 49.2, -42.6, Math.PI, 0x5c6344);
  // 16.5k-tri Fuel Tanker Truck staged cleanly beside the concrete-bunded fuel depot
  P.tankerTruck(b, 53.8, -33.2, H, 0xd4ccb8);
  // Concrete secondary containment bund enclosing the rubber fuel bladder (cleanly clear of billets HESCO wall at x=41.2!)
  b.box('slab', 46.8, -0.04, -31.0, 7.6, 0.1, 4.6, { color: 0xb6b0a4, nav: false });
  for (const sz of [-2.22, 2.22]) b.box('concrete', 46.8, 0.06, -31.0 + sz, 7.6, 0.42, 0.18, { color: 0xc2bcb0, grime: 0.85 });
  for (const sx of [-3.72, 3.72]) b.box('concrete', 46.8 + sx, 0.06, -31.0, 0.18, 0.42, 4.28, { color: 0xc2bcb0, grime: 0.85 });
  fuelBladder(b, 46.8, -31, 0.05);
  signBoard(b, cm, 43.6, -27.8, 0.4, 1.4, 0.7, 1.1, S.fuel);
  // Yellow steel fuel-depot safety bollards & hangar maintenance staging
  for (const bx of [43.0, 50.6]) b.cyl('paint', bx, 0, -28.2, 0.09, 0.9, 0xd4a428, { segs: 8, collide: true });
  P.container(b, 53.8, 0, -24.4, H, 0x7a6a4a);
  P.container(b, 53.8, 2.59, -24.4, H, 0x4a5a6a);
  P.container(b, 48.0, 0, -17.2, 0, 0x6a7a5a, true);
  lightTower(b, cm, 44.6, -21.2, Math.PI + 0.3);
  const C = P.clutter;
  P.solidProp(b, 'ph_tool_cart', 50.6, -24.8, 0.2, 0, 1, { surface: 'metal' });
  P.solidProp(b, 'ph_welder', 49.4, -22.2, -0.5, 0, 1, { surface: 'metal' });
  for (const [x, z, r] of [[47.6, -24.6, 0.3], [47.9, -24.1, 1.1], [48.3, -24.7, 2.4]] as [number, number, number][]) C(b, 'jerrycan', x, z, r);
  C(b, 'toolbox', 41.2, -48.6, 0.5);
  P.barrel(b, 41.0, -52.4, 0x4a5a3a);
  P.barrel(b, 41.7, -52.8, 0x3f5d78);
  // Tires offset cleanly clear of container west wall at x=52.58!
  P.tires(b, 51.1, -26.6, 3);
  P.tires(b, 51.8, -25.8, 2);
  C(b, 'wheel_rim', 49.4, -26.6, 0.6);
  C(b, 'compressor', 48.6, -22.8, 0.4);
  P.barrel(b, 55.2, -44, 0x4a5a3a);
  P.barrel(b, 55.4, -43.2, 0x4a5a3a);
  P.barrel(b, 54.6, -43.5, 0x5a4a3a);
}

function buildYard(b: LevelBuilder) {
  b.region = 'yard';
  P.container(b, 37.8, 0, 10.4, 0, 0xa08a62);
  P.container(b, 37.8, 2.59, 10.4, 0.02, 0x4a5a6a);
  P.container(b, 44.6, 0, 10.6, 0, 0x5c6a4a);
  P.container(b, 43.8, 0, 2.2, H, 0x8a4a32);
  P.waterTower(b, 49.6, -3.6);
  P.forklift(b, 39.5, 2.2, 0.42);
  for (let i = 0; i < 6; i++) {
    const x = 34.4 + (i % 3) * 1.4, z = -1.6 + Math.floor(i / 3) * 1.25;
    P.pallet(b, x, 0, z, 0);
    b.model('cardboard_stack', x, 0.12, z, b.r(-0.1, 0.1), { scale: { x: 1.05, y: 0.9, z: 2.1 } });
    b.solid(x, 0.12, z, 1.15, 1.0, 0.95, 0, 'fabric');
  }
  for (let i = 0; i < 4; i++) P.crate(b, 40.4 + (i % 2) * 1.7, i < 2 ? 0 : 0.48, 6.0, 0.6, 0, true);
  P.crate(b, 47.6, 0, 5.8, 1.0, 0.2);
  P.crate(b, 48.8, 0, 6.2, 0.9, 0.6);
  P.solidProp(b, 'propane_tank', 36.4, 5.6, 0.2, 0, 1);
  P.solidProp(b, 'cement_bag', 46.2, 0, 0.3, 0, 1);
}

function buildPerimeter(b: LevelBuilder, group: THREE.Group) {
  b.region = 'perim';
  // HESCO walls with the north and east gates
  hescoLine(b, -57.5, -57.5, 3.6, -57.5);
  hescoLine(b, 12.4, -57.5, 57.5, -57.5);
  hescoLine(b, -57.5, -56.4, -57.5, 14.4);
  hescoLine(b, 57.5, -56.4, 57.5, -14.6);
  hescoLine(b, 57.5, -5.4, 57.5, 14.4);
  chainFence(b, 20.6, 14.8, 57, 14.8);
  chainFence(b, -57, 14.8, -36.8, 14.8);
  P.guardTower(b, -53.2, -53.2, Math.PI);
  P.guardTower(b, 53.2, -53.2, Math.PI);
  P.guardTower(b, 53.6, 10.4, 0);
  // gates
  gateArm(b, 3.6, -55.6, 0, 8.2);
  guardShack(b, 14.6, -54.4, 0);
  gateArm(b, 55.6, -5.6, H, 8.4);
  guardShack(b, 54.2, -17.4, -H);
  for (const [x, z, r] of [[5.2, -60.5, 0], [10.8, -63.5, 0], [5.6, -66.5, 0]] as [number, number, number][]) P.jersey(b, x, z, r, 4.5);
  for (const [x, z] of [[60.5, -12.4], [63.5, -7.6], [66.5, -12]] as Pt[]) P.jersey(b, x, z, H, 4.5);
  // invisible boundary
  for (const c of [
    b.solid(0, 0, 14.95, 120, 6, 0.3),
    b.solid(0, 0, -58.6, 120, 6, 0.3),
    b.solid(-58.6, 0, -22, 0.3, 6, 80),
    b.solid(58.6, 0, -22, 0.3, 6, 80),
  ]) c.noRay = true;
  void group;
}

function buildOutside(b: LevelBuilder, world: World) {
  b.region = 'bg';
  b.shadows = false;
  // power line marching away from the north gate, a farm compound or two, the old checkpoint
  let prev: THREE.Vector3[] | null = null;
  for (let z = -66; z > -240; z -= 26) {
    const pts = P.utilityPole(b, 13.5, z, 0);
    if (prev) for (let k = 0; k < 3; k++) P.wire(b, prev[k], pts[k], 0.9);
    prev = pts;
  }
  prev = null;
  for (let x = 70; x < 240; x += 26) {
    const pts = P.utilityPole(b, x, -15.5, H);
    if (prev) for (let k = 0; k < 3; k++) P.wire(b, prev[k], pts[k], 0.9);
    prev = pts;
  }
  const cols = [0xd4c4a2, 0xcabca0, 0xc4b598, 0xc9b99a];
  // Nearby desert villages, forward outposts & military radar compound outside the perimeter wire
  for (const [x, z, w, d, h] of [
    [-112, -138, 14, 10, 6.6], [-98, -146, 10, 9, 3.6], [-126, -124, 11, 12, 6.6],
    [122, -88, 13, 10, 6.6], [136, -98, 10, 12, 3.6], [116, -108, 12, 9, 6.6],
    [-142, 34, 12, 14, 6.6], [-128, 48, 10, 10, 3.6],
    [114, 138, 16, 10, 6.6], [128, 124, 11, 11, 3.6],
    [-116, -78, 12, 10, 6.6], [108, 22, 14, 11, 6.6],
  ] as [number, number, number, number, number][]) {
    P.closedBuilding(b, x, z, w, d, h, { color: b.pick(cols), collide: false, detail: 0.35, roof: true });
  }
  P.radioMast(b, -152, -108, 32);
  P.waterTower(b, 140, -102);
  P.radioMast(b, 136, 108, 28);
  // Dramatic desert canyon boulder outcrops ringing the base valley (solid 360-degree scans, zero hollow backfaces)
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + b.r(-0.06, 0.06);
    const d = i < 28 ? b.r(92, 148) : b.r(152, 224);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    // Keep camp perimeter, downrange corridor & access roads strictly clear
    if (x > -66 && x < 66 && z > -66 && z < 22) continue;
    if (x > -48 && x < 34 && z > 12 && z < 134) continue;
    if (Math.abs(x - 8) < 12 && z < -58) continue;
    if (Math.abs(z + 10) < 12 && x > 58) continue;
    const s = i < 28 ? b.r(1.8, 3.6) : b.r(2.8, 5.8);
    b.model(b.pick(['boulder_a', 'boulder_b', 'boulder_c'] as const), x, -0.45 * s, z, b.r(0, 6.28), {
      scale: { x: s * b.r(1.0, 1.45), y: s * b.r(0.7, 1.25), z: s * b.r(1.0, 1.45) },
      color: 0xb69c7e,
    });
  }
  for (let i = 0; i < 520; i++) {
    const x = b.r(-170, 170), z = b.r(-170, 170);
    if (x > -62 && x < 62 && z > -62 && z < 18) continue;
    if (x > -44 && x < 30 && z > 14 && z < 128) continue;
    if (Math.abs(x - 8) < 6 && z < -58) continue;
    if (Math.abs(z + 10) < 6 && x > 58) continue;
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m > 110 || b.rnd() < 0.45) b.model('rock', x, -0.05, z, b.r(0, 6.28), { scale: b.r(0.2, 0.9), color: 0xe2d2bb });
    else b.model(b.pick(['bush_l', 'bush_m', 'bush_l'] as const), x, -0.02, z, b.r(0, 6.28), { scale: b.r(1.3, 2.4), color: 0xd0c8a8 });
  }
  b.shadows = true;
  // inside the wire: a little scrub on undisturbed patches
  b.region = 'scatter';
  const blocked = (x: number, z: number, m: number) => {
    for (const c of world.colliders) {
      if (c.minY > 0.6) continue;
      if (x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m) return true;
    }
    return false;
  };
  let placed = 0;
  for (let i = 0; i < 1600 && placed < 160; i++) {
    const x = b.r(-56, 56), z = b.r(-56, 13.5);
    if (Math.abs(z + 10) < 5 || Math.abs(x - 8) < 4.5 || Math.abs(z - 3.5) < 4.5) continue;
    if (x > -53 && x < -42 && z > -41 && z < 8) continue;
    if (x > -41 && x < -12 && z > -53 && z < -30) continue;
    if (blocked(x, z, 0.4)) continue;
    placed++;
    const t = b.rnd();
    if (t < 0.25) b.model(b.rnd() < 0.5 ? 'bush_m' : 'bush_s', x, -0.02, z, b.r(0, 6.28), { scale: b.r(0.9, 1.5), color: 0xcfc8aa });
    else {
      const s = t < 0.4 ? b.r(0.15, 0.35) : b.r(0.05, 0.14);
      b.model('rock', x, -0.03 * s, z, b.r(0, 6.28), { scale: { x: s, y: s * b.r(0.7, 1.2), z: s * b.r(0.7, 1.1) }, color: 0xb8a690 });
    }
  }
}

// ---------------------------------------------------------------------------

export function buildTraining(world: World, mats: Materials, sunAz: number): LevelData {
  const b = new LevelBuilder(world, mats);
  const cm = makeCampMats();
  const S = makeSigns(cm);
  const flags = makeFlags();
  const dyn = new THREE.Group();
  const T = TRAIN;

  const lvl: LevelData = {
    id: 'training',
    group: new THREE.Group(),
    playerSpawn: { x: T.spawn.x, z: T.spawn.z, yaw: T.spawn.yaw },
    spawnPoints: [],
    barrels: [],
    supplies: [{ x: T.rangeSupply.x, z: T.rangeSupply.z }, { x: -39.8, z: -33.2 }],
    fires: [],
    plumes: [new THREE.Vector3(-190, 0, -230), new THREE.Vector3(260, 0, -60)],
    bound: 60,
    map: {
      half: 62,
      roads: [[0, -10, 98, 7], [8, -34, 6.5, 48], [-4, 1.5, 70, 6], [30.5, -4, 6, 12], [-38, -16, 4.4, 35]],
      ground: '#2e2a22',
      road: '#4a4334',
    },
    targets: targetSpecs(),
    menuCamera(t, cam) {
      // slow crane move along the firing line, looking across the camp into the low sun
      const k = (Math.sin(t * 0.045) + 1) / 2;
      cam.position.set(30 - k * 46, 4.6 + Math.sin(t * 0.07) * 0.6, 22 + Math.sin(t * 0.031) * 3);
      cam.lookAt(-8 - k * 14, 2.4, -14 + k * 4);
    },
    update(_dt, t) {
      cm.time.value = t;
    },
  };
  world.groundSurface = () => 'sand';

  buildPerimeter(b, dyn);
  buildRange(b, cm, S, dyn, flags);
  buildGrenadeBay(b, cm, S, lvl);
  buildCourse(b, cm, S);
  buildKillHouse(b, cm, S);
  buildCamp(b, cm, S, dyn, flags, lvl);
  buildMotorPool(b, cm, S);
  buildYard(b);
  buildOutside(b, world);
  cm.atlas.finish();

  decorateDecals(b, undefined, [[-30.0, 24.0], [-26.0, 28.5], [-27.6, 31.4], [-32.5, 30.0], [-190, -230], [260, -60]]);

  const mask = paintGround();
  const maskTex = mask.build();
  const groundMat = makeGroundMaterial(maskTex, mask.x0, mask.z0, mask.size, mask.res);
  lvl.group = b.finish();
  lvl.group.add(makeGroundMesh(groundMat, 320, { x0: -68, x1: 68, z0: -68, z1: 128, roadX: 8, roadZ: -10 }));
  lvl.group.add(buildMountains(mats, sunAz));
  lvl.group.add(dyn);
  return lvl;
}
