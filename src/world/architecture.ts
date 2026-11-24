import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LevelBuilder, type MatRef } from './build';
import * as P from './props';
import { Frame } from './props';

/**
 * AAA modular architectural prefabs shared by both maps (Hadir Citadel & Camp Anvil):
 * monumental desert archways, clocktower/minaret landmark, stepped stone fountain plazas,
 * exposed steel-truss roofs, walkable elevated skybridges, reinforced military bunkers,
 * industrial fuel silo complexes, open-air briefing pavilions, and tactical range facades.
 *
 * Every component uses exact grounded coordinates (y = 0 or explicit deck elevation) and
 * clean collision volumes with zero floating pieces.
 */

const H = Math.PI / 2;

function rbox(
  f: Frame,
  mat: MatRef,
  lx: number,
  y0: number,
  lz: number,
  w: number,
  h: number,
  d: number,
  radius: number,
  color: number,
) {
  const r = Math.min(radius, Math.min(w, Math.min(h, d)) * 0.42);
  const g = new RoundedBoxGeometry(w, h, d, 2, r);
  f.b.geo(mat, g, f.v(lx, y0 + h * 0.5, lz), new THREE.Euler(0, f.rot, 0, 'YXZ'), 1, color, 1);
  g.dispose();
}

/**
 * Monumental 4K-scanned Middle-Eastern sandstone & concrete city gate archway spanning `span`
 * along local X with traffic passing along local Z. Built from real POM masonry, radial stone
 * voussoirs, carved cornices, battle-damaged cinderblock spalls, and sandbagged checkpoint bases.
 */
export function citadelArch(
  b: LevelBuilder,
  x: number,
  z: number,
  rot: number,
  span = 7.4,
  clearH = 4.2,
  depth = 1.45,
  color = 0xd6c5a3,
) {
  const f = new Frame(b, x, z, rot);
  const pierW = 1.65;
  const pierX = span * 0.5 + pierW * 0.5;
  const totalW = span + pierW * 2;
  const archR = span * 0.5;
  const springY = Math.max(2.1, clearH - archR * 0.42);
  const topY = clearH + 1.48;
  const stoneTrim = new THREE.Color(color).multiplyScalar(0.92).getHex();
  const darkStone = new THREE.Color(color).multiplyScalar(0.76).getHex();
  const plasterCol = new THREE.Color(color).lerp(new THREE.Color(0xdccbb0), 0.35).getHex();

  // Heavy twin masonry piers with stone plinth bases, corner quoins & vehicle bumper bollards
  for (const s of [-1, 1]) {
    f.c('cinder', s * pierX, 0, 0, pierW + 0.14, 0.72, depth + 0.16, { color: darkStone, grime: 0.75 });
    f.c('plaster', s * pierX, 0.72, 0, pierW, topY - 0.72, depth, { color: plasterCol, absGrime: true });
    // Projecting stone quoins & capital molding at arch springline
    f.d('concrete', s * pierX, springY - 0.16, 0, pierW + 0.22, 0.22, depth + 0.22, { color: stoneTrim });
    // Exposed battle-scarred cinderblock spall patch on inner face
    f.d('cinder', s * (pierX - pierW * 0.46), 1.35, 0.12, 0.12, 1.15, depth * 0.65, { color: 0x9b9282 });
    // Grounded concrete vehicle bumper bollards flanking the roadway
    for (const sz of [-1, 1]) {
      b.cyl('concrete', f.wx(s * (span * 0.5 - 0.22), sz * (depth * 0.5 + 0.26)), 0, f.wz(s * (span * 0.5 - 0.22), sz * (depth * 0.5 + 0.26)), 0.14, 0.78, 0xbab2a2, { segs: 8, collide: true });
    }
    // Sandbagged guard cover tucked against outer pier face
    P.sandbags(b, f.wx(s * (pierX + pierW * 0.55), 0), f.wz(s * (pierX + pierW * 0.55), 0), rot + H, depth + 0.5, 3, 0, false);
  }

  // Elliptical stone arch ring (13 radial sculpted voussoirs + dark recessed shadow soffit) + masonry spandrel wall
  const segs = 13;
  const rise = clearH - springY;
  const ringThick = 0.42;
  const vGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const tm = (t0 + t1) * 0.5;
    const a0 = Math.PI * (1 - t0), a1 = Math.PI * (1 - t1), am = Math.PI * (1 - tm);
    const x0 = Math.cos(a0) * archR, y0 = springY + Math.sin(a0) * rise;
    const x1 = Math.cos(a1) * archR, y1 = springY + Math.sin(a1) * rise;
    const xm = (x0 + x1) * 0.5, ym = (y0 + y1) * 0.5;
    const segLen = Math.hypot(x1 - x0, y1 - y0) + 0.08;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const isKey = i === Math.floor(segs / 2);
    const vThick = isKey ? ringThick * 1.28 : ringThick;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const cx = xm + nx * (vThick * 0.5), cy = ym + ny * (vThick * 0.5);
    const colV = isKey ? 0xdfd3bc : (i % 2 ? stoneTrim : darkStone);
    b.geo('concrete', vGeo, f.v(cx, cy, 0), new THREE.Euler(0, rot, ang, 'YXZ'), { x: segLen, y: vThick, z: depth + (isKey ? 0.16 : 0.08) }, colV);
    // Vertical spandrel masonry infill from arch extrados up to entablature cornice
    const fillBottom = Math.min(topY - 0.35, ym + Math.max(0.18, ny * vThick * 0.65));
    const fillH = topY - 0.25 - fillBottom;
    if (fillH > 0.06) {
      f.d('plaster', xm, fillBottom, 0, Math.abs(x1 - x0) + 0.14, fillH, depth - 0.04, { color: plasterCol });
    }
  }
  vGeo.dispose();

  // Heavy horizontal masonry entablature, stepped stone cornice & desert citadel battlement merlons
  f.d('plaster', 0, clearH + 0.36, 0, totalW - 0.1, topY - (clearH + 0.36), depth, { color: plasterCol });
  f.d('concrete', 0, topY - 0.16, 0, totalW + 0.32, 0.24, depth + 0.3, { color: stoneTrim });
  f.d('concrete', 0, topY + 0.08, 0, totalW + 0.18, 0.12, depth + 0.18, { color: darkStone });
  // Crenelated parapet merlons with a battle-damaged gap near one side
  const merlonCount = Math.max(5, Math.floor(totalW / 1.35));
  for (let i = 0; i < merlonCount; i++) {
    if (i === 2) continue; // blast-chipped gap with exposed rebar
    const mx = -totalW * 0.5 + 0.55 + (i / (merlonCount - 1)) * (totalW - 1.1);
    f.d('concrete', mx, topY + 0.2, 0, 0.72, 0.52, depth * 0.42, { color: i % 2 ? stoneTrim : plasterCol });
  }
  // Exposed rusted steel rebar rods at the blast-chipped parapet notch
  const gapX = -totalW * 0.5 + 0.55 + (2 / (merlonCount - 1)) * (totalW - 1.1);
  for (const rx of [-0.18, 0.04, 0.2]) {
    b.tube('darkmetal', f.v(gapX + rx, topY + 0.18, 0), f.v(gapX + rx + 0.08, topY + 0.65, 0.06), 0.015, 0x4e3528, 4);
  }

  // Exact pier colliders flanking the open roadway span + upper arch lintel collider
  for (const s of [-1, 1]) {
    f.solid(s * pierX, 0, 0, pierW, topY, depth, 'concrete', true);
  }
  f.solid(0, clearH, 0, span, topY - clearH + 0.5, depth, 'concrete', false);
  b.model('security_light', f.wx(span * 0.5 - 0.04, 0), Math.min(3.1, clearH - 0.8), f.wz(span * 0.5 - 0.04, 0), rot - H, { scale: 0.65 });
  b.model('ph_sec_cam', f.wx(-span * 0.5 + 0.08, depth * 0.52), Math.min(3.4, clearH - 0.5), f.wz(-span * 0.5 + 0.08, depth * 0.52), rot + 0.4, { scale: 0.95 });
}

/**
 * Iconic 16.8m Battle-Scarred Middle-Eastern Citadel Watch-Minaret / Municipal Clock Tower.
 * Built from 4K photo-scanned POM concrete/plaster/cinderblock, cantilevered corbel balcony,
 * arched belfry chamber with dark brass clock dials, oxidized dome, and tactical comms mast.
 */
export function clockTowerLandmark(b: LevelBuilder, x: number, z: number, rot = 0) {
  const f = new Frame(b, x, z, rot);
  const plaster = 0xd9cab0;
  const trim = 0xc5b89e;
  const stone = 0xa89f8e;

  // Stepped stone corner plaza plinth + protective sandbagged firing perimeter
  f.c('slab', 0, 0, 0, 5.2, 0.2, 5.2, { color: 0xbdb4a4, grime: 0.85, nav: false });
  f.c('cinder', 0, 0.2, 0, 4.35, 1.35, 4.35, { color: stone, absGrime: true });

  // Main tapered lower masonry shaft (y = 1.55..8.4m) with stone corner pilasters & vertical recessed slit windows
  f.c('plaster', 0, 1.55, 0, 4.05, 6.85, 4.05, { color: plaster, absGrime: true });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      f.d('concrete', sx * 2.02, 1.55, sz * 2.02, 0.42, 6.85, 0.42, { color: trim, absGrime: true });
    }
  }
  // Horizontal stringcourses + dark recessed lancet slit windows on all 4 facades
  for (const sy of [4.6, 8.2]) f.d('concrete', 0, sy, 0, 4.32, 0.2, 4.32, { color: trim });
  for (const wy of [3.2, 6.0]) {
    for (const s of [-1, 1]) {
      f.d('darkmetal', 0, wy, s * 2.04, 0.58, 1.35, 0.08, { color: 0x16181c });
      f.d('concrete', 0, wy - 0.1, s * 2.07, 0.78, 0.12, 0.14, { color: trim });
      f.d('darkmetal', s * 2.04, wy, 0, 0.08, 1.35, 0.58, { color: 0x16181c });
      f.d('concrete', s * 2.07, wy - 0.1, 0, 0.14, 0.12, 0.78, { color: trim });
    }
  }
  // Battle-damaged cinderblock spall patches & rebar on lower walls
  f.d('cinder', 2.03, 2.2, 0.7, 0.08, 1.1, 1.2, { color: 0x8f887a });
  f.d('cinder', -0.6, 5.1, 2.03, 1.1, 0.9, 0.08, { color: 0x8f887a });

  // Cantilevered corbel stone observation gallery at y = 8.4m with wrought-iron railings & sniper sandbags
  for (const s of [-1, 1]) {
    for (const o of [-1.45, -0.5, 0.5, 1.45]) {
      f.d('concrete', o, 7.95, s * 2.18, 0.22, 0.45, 0.42, { color: stone });
      f.d('concrete', s * 2.18, 7.95, o, 0.42, 0.45, 0.22, { color: stone });
    }
  }
  f.d('slab', 0, 8.4, 0, 5.05, 0.26, 5.05, { color: trim });
  b.model('railing', f.wx(0, 2.42), 8.66, f.wz(0, 2.42), rot, { scale: { x: 1.22, y: 0.92, z: 1 } });
  b.model('railing', f.wx(0, -2.42), 8.66, f.wz(0, -2.42), rot, { scale: { x: 1.22, y: 0.92, z: 1 } });
  b.model('railing', f.wx(2.42, 0), 8.66, f.wz(2.42, 0), rot + H, { scale: { x: 1.22, y: 0.92, z: 1 } });
  b.model('railing', f.wx(-2.42, 0), 8.66, f.wz(-2.42, 0), rot + H, { scale: { x: 1.22, y: 0.92, z: 1 } });
  P.sandbags(b, f.wx(0, 2.18), f.wz(0, 2.18), rot, 3.2, 2, 8.66, false);

  // Upper clock & belfry chamber (y = 8.66..13.5m): 4 corner stone piers + dark vaulted recesses + weathered clock faces
  f.d('plaster', 0, 8.66, 0, 3.55, 2.55, 3.55, { color: plaster });
  // Four weathered dark iron/bronze clock dial bezels on cardinal faces (y = 10.1m)
  const dialGeo = new THREE.CylinderGeometry(0.76, 0.78, 0.12, 20);
  const faceGeo = new THREE.CylinderGeometry(0.64, 0.64, 0.14, 20);
  for (let side = 0; side < 4; side++) {
    const a = side * H;
    const dx = Math.sin(a) * 1.8, dz = Math.cos(a) * 1.8;
    b.geo('darkmetal', dialGeo, f.v(dx, 10.1, dz), new THREE.Euler(H, rot + a, 0, 'YXZ'), 1, 0x26282a);
    b.geo('concrete', faceGeo, f.v(dx * 1.01, 10.1, dz * 1.01), new THREE.Euler(H, rot + a, 0, 'YXZ'), 1, 0xbdb49e);
    // Clock hands
    const fh = new Frame(b, f.wx(dx * 1.045, dz * 1.045), f.wz(dx * 1.045, dz * 1.045), rot + a, 10.1);
    fh.d('darkmetal', 0, 0.0, 0.03, 0.06, 0.44, 0.03, { color: 0x151515 });
    fh.d('darkmetal', 0.18, 0.0, 0.03, 0.36, 0.055, 0.03, { color: 0x151515 });
  }
  dialGeo.dispose();
  faceGeo.dispose();

  // Open arched belfry lantern (y = 11.2..13.5m): 4 stone corner columns around a shadowed interior void
  f.d('concrete', 0, 11.2, 0, 3.82, 0.22, 3.82, { color: trim });
  f.d('darkmetal', 0, 11.42, 0, 2.4, 2.0, 2.4, { color: 0x111316 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      f.d('concrete', sx * 1.45, 11.42, sz * 1.45, 0.62, 2.15, 0.62, { color: trim });
    }
  }
  f.d('concrete', 0, 13.55, 0, 4.15, 0.32, 4.15, { color: trim });

  // Octagonal sandstone drum + weathered oxidized dome + tactical military comms mast
  const drum = new THREE.CylinderGeometry(1.48, 1.62, 0.95, 8);
  b.geo('plaster', drum, f.v(0, 14.32, 0), new THREE.Euler(0, rot + Math.PI / 8, 0), 1, plaster);
  drum.dispose();
  const dome = new THREE.SphereGeometry(1.46, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  b.geo('metal', dome, f.v(0, 14.78, 0), null, { x: 1, y: 1.15, z: 1 }, 0x5c685e);
  dome.dispose();
  b.cyl('darkmetal', x, 16.3, z, 0.045, 2.6, 0x2e3236, { segs: 8 });
  b.cyl('darkmetal', x, 17.6, z, 0.26, 0.06, 0x3b3f44, { segs: 8 });

  // Ground-level photogrammetry dressing (AC unit, utility box, security lamp, CCTV)
  b.model('aircon_rust', f.wx(-2.22, 0.6), 3.1, f.wz(-2.22, 0.6), rot - H, { scale: 0.95 });
  b.model('utility_box', f.wx(2.26, -0.9), 0.2, f.wz(2.26, -0.9), rot + H, { scale: 1.0 });
  b.model('security_light', f.wx(0, 2.12), 2.8, f.wz(0, 2.12), rot, { scale: 0.72 });
  b.model('ph_sec_cam', f.wx(2.15, 2.15), 3.6, f.wz(2.15, 2.15), rot + 0.75, { scale: 1.05 });
  b.model('arch_sat_dish', f.wx(-1.6, -1.6), 8.66, f.wz(-1.6, -1.6), rot + 0.5, { scale: 1.35 });
  f.solid(0, 0, 0, 4.35, 16.5, 4.35, 'concrete', true);
}

/**
 * Battle-scarred octagonal Middle-Eastern stone courtyard fountain & tactical roundabout.
 * Provides authentic waist-high cover right at the Hadir Citadel central crossroads.
 */
export function fountainPlaza(b: LevelBuilder, x: number, z: number, outerR = 4.2) {
  // Walkable two-stepped octagonal stone dais (y = 0..0.18)
  const dais1 = new THREE.CylinderGeometry(outerR, outerR + 0.24, 0.1, 8);
  b.geo('slab', dais1, { x, y: 0.05, z }, new THREE.Euler(0, Math.PI / 8, 0), 1, 0xc0b7a6);
  dais1.dispose();
  const dais2 = new THREE.CylinderGeometry(outerR * 0.78, outerR * 0.82, 0.1, 8);
  b.geo('concrete', dais2, { x, y: 0.14, z }, new THREE.Euler(0, Math.PI / 8, 0), 1, 0xb8af9e);
  dais2.dispose();

  // Octagonal stone basin parapet walls (waist-high crouch cover, dry sandy basin floor inside)
  const basinR = Math.min(2.45, outerR * 0.62);
  const segW = 2 * basinR * Math.tan(Math.PI / 8) + 0.14;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const fx = x + Math.sin(a) * basinR, fz = z + Math.cos(a) * basinR;
    const wall = new Frame(b, fx, fz, a, 0.18);
    // One battle-chipped side (i === 2) is slightly lower with rubble spilling out
    const wh = i === 2 ? 0.52 : 0.74;
    wall.d('cinder', 0, 0, 0, segW, wh, 0.34, { color: 0xbcb3a2, grime: 0.8 });
    wall.d('concrete', 0, wh, 0, segW + 0.06, 0.1, 0.44, { color: 0xcbc2b0 });
  }
  // Dry sandy/muddy basin interior floor
  const floor = new THREE.CylinderGeometry(basinR - 0.14, basinR - 0.14, 0.16, 8);
  b.geo('mud', floor, { x, y: 0.26, z }, new THREE.Euler(0, Math.PI / 8, 0), 1, 0x8a7d6a);
  floor.dispose();

  // Damaged tiered stone fountain spire centerpiece
  const ped = new THREE.CylinderGeometry(0.68, 0.86, 0.92, 8);
  b.geo('concrete', ped, { x, y: 0.76, z }, new THREE.Euler(0, Math.PI / 8, 0), 1, 0xc2b9a8);
  ped.dispose();
  const bowl = new THREE.CylinderGeometry(1.18, 0.58, 0.32, 8);
  b.geo('concrete', bowl, { x, y: 1.34, z }, new THREE.Euler(0, Math.PI / 8, 0), 1, 0xb8af9e);
  bowl.dispose();
  const stem = new THREE.CylinderGeometry(0.32, 0.42, 0.88, 8);
  b.geo('cinder', stem, { x, y: 1.92, z }, new THREE.Euler(0, Math.PI / 8, 0), 1, 0xafa796);
  stem.dispose();
  const cap = new THREE.CylinderGeometry(0.54, 0.26, 0.24, 8);
  b.geo('concrete', cap, { x, y: 2.42, z }, new THREE.Euler(0, Math.PI / 8, 0), 1, 0xc4bca8);
  cap.dispose();

  // Tactical sandbag reinforcement tucked along the west & north basin rims + rubble
  P.sandbags(b, x - basinR * 0.92, z, H, 1.85, 2, 0.94, false);
  P.rubble(b, x + basinR * 0.95, z + 0.5, 0.95, 10);

  // Waist-high basin cover collider + central tiered spire collider
  b.solid(x, 0.18, z, basinR * 1.95, 0.84, basinR * 1.95, 0, 'concrete', true);
  b.solid(x, 1.0, z, 1.35, 1.55, 1.35, 0, 'concrete', false);
}

/**
 * Hero AAA Modern Military Range Control Tower (used in Camp Anvil).
 * Multi-level sandbagged concrete base bunker, cantilevered steel-braced observation deck,
 * angled recessed ballistic glass cab with steel mullions, caged stairs, rooftop steel-truss
 * camo canopy, realistic PA horn speaker mast, satellite dish, and generator shelter.
 */
export function rangeControlTower(b: LevelBuilder, x: number, z: number) {
  const f = new Frame(b, x, z, 0);
  // Ground level: reinforced cinderblock & concrete bunker base (3.5 x 3.5m, h = 3.05m)
  f.c('slab', 0, 0, 0, 4.1, 0.14, 4.1, { color: 0xb8b2a6, nav: false });
  f.c('cinder', 0, 0.14, 0, 3.4, 2.91, 3.4, { color: 0xbfb8a8, absGrime: true });
  // Concrete corner structural columns & base plinth band
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      f.d('concrete', sx * 1.66, 0.14, sz * 1.66, 0.36, 2.91, 0.36, { color: 0xaead9f, absGrime: true });
    }
  }
  // Armored blast door with protective steel canopy awning on East face (+X)
  f.d('darkmetal', 1.72, 0.14, 0.45, 0.08, 2.1, 1.02, { color: 0x3b3f3c });
  f.d('darkmetal', 1.76, 0.14, 0.45, 0.04, 2.14, 1.08, { color: 0x262928 });
  f.d('corrugated', 2.02, 2.28, 0.45, 0.68, 0.05, 1.4, { color: 0x5d625a });
  b.model('security_light', x + 1.76, 2.48, z + 0.45, H, { scale: 0.68 });
  b.model('utility_box', x + 1.76, 0.4, z - 0.85, H, { scale: 0.95 });
  // Sandbag blast skirt along North & South bunker walls
  P.sandbags(b, x, z + 1.98, 0, 3.5, 3, 0, true);
  P.sandbags(b, x, z - 1.98, 0, 3.5, 3, 0, true);

  // Cantilevered steel-and-concrete observation deck (y = 3.05m, 4.7 x 4.7m) with diagonal steel knee braces
  f.c('slab', 0, 3.05, 0, 4.75, 0.18, 4.75, { color: 0xb6b0a2 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.tube('darkmetal', f.v(sx * 1.65, 2.2, sz * 1.65), f.v(sx * 2.25, 3.05, sz * 2.25), 0.055, 0x383c3e, 6);
    }
  }
  // Safety perimeter railings on the mid observation walkway (leaving west stair landing open)
  b.model('railing', x, 3.23, z + 2.3, 0, { scale: { x: 1.15, y: 0.95, z: 1 } });
  b.model('railing', x, 3.23, z - 2.3, 0, { scale: { x: 1.15, y: 0.95, z: 1 } });
  b.model('railing', x + 2.3, 3.23, z, H, { scale: { x: 1.15, y: 0.95, z: 1 } });
  b.model('railing', x - 2.3, 3.23, z - 1.1, H, { scale: { x: 0.58, y: 0.95, z: 1 } });

  // Upper tactical observation cab (y = 3.23..5.55m, 3.5 x 3.5m): concrete knee wall + dark recessed wraparound windows + mullions
  for (const [lx, lz, w, d] of [[0, -1.7, 3.5, 0.16], [-1.7, 0, 0.16, 3.5]] as [number, number, number, number][]) {
    f.c('concrete', lx, 3.23, lz, w, 2.32, d, { color: 0xc2bbb0, absGrime: true });
  }
  for (const [lx, lz, w, d] of [[0, 1.7, 3.5, 0.16], [1.7, 0, 0.16, 3.5]] as [number, number, number, number][]) {
    f.c('concrete', lx, 3.23, lz, w, 0.98, d, { color: 0xc2bbb0, absGrime: true });
    f.d('darkmetal', lx, 4.21, lz, w * 0.96, 1.06, d * 0.72, { color: 0x0e1318 });
    f.d('glass', lx, 4.22, lz, w * 0.94, 1.02, d * 0.85, {});
    f.c('concrete', lx, 5.27, lz, w, 0.28, d, { color: 0xb8b1a4 });
  }
  // Structural steel window mullions & angled sun-glare brow visors over the glass
  for (const o of [-1.68, -0.58, 0.58, 1.68]) {
    f.d('darkmetal', o, 4.2, 1.73, 0.08, 1.08, 0.1, { color: 0x2d3134 });
    f.d('darkmetal', 1.73, 4.2, o, 0.1, 1.08, 0.08, { color: 0x2d3134 });
  }
  // Sloped steel glare-visor eaves above the observation windows
  const brow = new THREE.BoxGeometry(3.85, 0.04, 0.55);
  b.geo('corrugated', brow, f.v(0, 5.38, 1.98), new THREE.Euler(0.32, 0, 0, 'YXZ'), 1, 0x525750);
  b.geo('corrugated', brow, f.v(1.98, 5.38, 0), new THREE.Euler(0.32, H, 0, 'YXZ'), 1, 0x525750);
  brow.dispose();

  // Reinforced rooftop deck (y = 5.55m) + full safety railing + overhead steel shade pavilion
  f.c('slab', 0, 5.55, 0, 4.5, 0.16, 4.5, { color: 0xb0aa9e });
  b.model('railing', x, 5.71, z + 2.16, 0, { scale: { x: 1.08, y: 0.92, z: 1 } });
  b.model('railing', x, 5.71, z - 2.16, 0, { scale: { x: 1.08, y: 0.92, z: 1 } });
  b.model('railing', x + 2.16, 5.71, z, H, { scale: { x: 1.08, y: 0.92, z: 1 } });
  b.model('railing', x - 2.16, 5.71, z, H, { scale: { x: 1.08, y: 0.92, z: 1 } });

  // Rooftop tactical steel shade frame covering rear half + angled steel comms mast + compact PA horn speakers
  for (const sx of [-1.75, 1.75]) {
    for (const sz of [-1.75, 0.35]) {
      f.d('darkmetal', sx, 5.71, sz, 0.1, 2.25, 0.1, { color: 0x3b3f42 });
    }
  }
  const topRoof = new THREE.BoxGeometry(4.1, 0.06, 2.7);
  b.geo('corrugated', topRoof, f.v(0, 8.0, -0.7), new THREE.Euler(0.12, 0, 0, 'YXZ'), 1, 0x62685a);
  topRoof.dispose();

  // Tactical comms mast with realistic compact PA horn speakers (scale 1.05, NOT giant 2.6!)
  b.cyl('darkmetal', x + 1.65, 5.71, z + 1.65, 0.045, 3.2, 0x323638, { segs: 8 });
  b.model('megaphone', x + 1.72, 7.85, z + 1.82, 0.35, { scale: 1.1 });
  b.model('megaphone', x + 1.82, 7.6, z + 1.55, 1.35, { scale: 1.1 });
  b.model('arch_sat_dish', x - 1.25, 5.71, z + 1.25, 0.55, { scale: 1.4 });
  b.model('searchlight', x + 0.5, 5.71, z + 1.75, 0.25, { scale: 1.15 });
  b.model('ph_sec_cam', x + 1.9, 5.2, z + 1.9, 0.75, { scale: 1.0 });

  // Exterior steel stairs on West side + lean-to metal generator shelter at the base
  b.stairs('metal', x - 2.35, z + 3.2, 0, -1, 0.95, 0, 3.05, 4.4, 0x565a5e, false);
  P.solidProp(b, 'generator', x - 3.65, z + 0.55, 0, 0, 1, { surface: 'metal' });
  b.model('mil_crate', x - 3.0, 0, z + 1.45, 0.2, {});
  b.model('jerrycan', x - 2.75, 0, z + 0.65, 1.4, {});
  b.model('jerrycan', x - 2.45, 0, z + 0.65, 1.2, {});
}

/**
 * Heavy exposed steel-truss industrial roof canopy supported by grounded I-beam columns.
 * Used for both the Camp Anvil firing pavilion and Hadir Maintenance Hangar.
 */
export function steelTrussRoof(
  b: LevelBuilder,
  x: number,
  z: number,
  rot: number,
  w: number,
  d: number,
  h: number,
  o: { bays?: number; roofColor?: number; steelColor?: number; lamps?: boolean } = {},
) {
  const f = new Frame(b, x, z, rot);
  const bays = o.bays ?? Math.max(2, Math.round(w / 6));
  const steel = o.steelColor ?? 0x454a4e;
  const roofCol = o.roofColor ?? 0x8b8f86;
  const hw = w * 0.5, hd = d * 0.5;
  const peak = 0.85;

  for (let i = 0; i <= bays; i++) {
    const lx = -hw + (i / bays) * w;
    // Grounded steel H-columns with concrete footing pads
    for (const sz of [-1, 1]) {
      f.c('concrete', lx, 0, sz * (hd - 0.18), 0.42, 0.32, 0.42, { color: 0xbcb6aa });
      f.c('darkmetal', lx, 0.32, sz * (hd - 0.18), 0.18, h - 0.32, 0.18, { color: steel });
    }
    // Bottom tie chord
    f.d('darkmetal', lx, h - 0.12, 0, 0.12, 0.14, d - 0.2, { color: steel });
    // Pitched top rafters meeting at central ridge
    const halfSpan = hd + 0.35;
    const rafterLen = Math.hypot(halfSpan, peak);
    const pitch = Math.atan2(peak, halfSpan);
    for (const sz of [-1, 1]) {
      const rGeo = new THREE.BoxGeometry(0.11, 0.13, rafterLen);
      b.geo(
        'darkmetal',
        rGeo,
        f.v(lx, h + peak * 0.5, sz * halfSpan * 0.5),
        new THREE.Euler(sz * pitch, rot, 0, 'YXZ'),
        1,
        steel,
      );
      rGeo.dispose();
    }
    // Central king-post & two diagonal web struts inside the truss
    f.d('darkmetal', lx, h, 0, 0.09, peak, 0.09, { color: steel });
    for (const sz of [-1, 1]) {
      b.tube('darkmetal', f.v(lx, h, 0), f.v(lx, h + peak * 0.5, sz * hd * 0.5), 0.032, steel, 5);
    }
  }

  // Longitudinal purlins & eave fascia beams
  for (const lz of [-hd, -hd * 0.48, 0, hd * 0.48, hd]) {
    const py = h + peak * (1 - Math.abs(lz) / (hd + 0.35)) + 0.04;
    f.d('darkmetal', 0, py, lz, w + 0.5, 0.08, 0.08, { color: steel });
  }

  // Pitched corrugated steel roof sheets (both slopes)
  const slopeSpan = hd + 0.45;
  const slopeLen = Math.hypot(slopeSpan, peak);
  const pitch = Math.atan2(peak, slopeSpan);
  const sheetGeo = new THREE.BoxGeometry(w + 0.8, 0.055, slopeLen + 0.08);
  for (const sz of [-1, 1]) {
    b.geo(
      'corrugated',
      sheetGeo,
      f.v(0, h + peak * 0.5 + 0.1, sz * slopeSpan * 0.5),
      new THREE.Euler(sz * pitch, rot, 0, 'YXZ'),
      1,
      roofCol,
    );
  }
  sheetGeo.dispose();

  // Optional hanging industrial lamps down the center ridge
  if (o.lamps) {
    for (let i = 0; i < bays; i++) {
      const lx = -hw + (i + 0.5) * (w / bays);
      b.model('hanging_lamp', f.wx(lx, 0), h - 0.65, f.wz(lx, 0), rot, { scale: 0.72 });
      b.cyl('darkmetal', f.wx(lx, 0), h - 0.3, f.wz(lx, 0), 0.014, 0.4, 0x2e3032, { segs: 6 });
    }
  }
}

/**
 * Walkable elevated steel-and-timber tactical skybridge connecting two buildings/rooftops.
 */
export function skybridge(
  b: LevelBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  width = 2.0,
) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const rot = Math.atan2(dx, dz);
  const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
  const f = new Frame(b, mx, mz, rot);
  const hw = width * 0.5;

  // Walkable timber-plank deck on steel underside girders
  f.c('wood', 0, y - 0.1, 0, width, 0.1, len, { color: 0x867052, grime: 0.9, nav: true });
  for (const sx of [-1, 1]) {
    f.d('darkmetal', sx * (hw - 0.06), y - 0.32, 0, 0.1, 0.24, len, { color: 0x3b3f42 });
    // Safety side guardrails (top + mid steel tubes + stanchion posts + waist cover panels)
    b.tube('darkmetal', f.v(sx * (hw - 0.04), y + 0.98, -len * 0.5), f.v(sx * (hw - 0.04), y + 0.98, len * 0.5), 0.028, 0x464a4e, 8);
    b.tube('darkmetal', f.v(sx * (hw - 0.04), y + 0.5, -len * 0.5), f.v(sx * (hw - 0.04), y + 0.5, len * 0.5), 0.02, 0x383b3e, 6);
    // Ballistic corrugated sheet skirt along lower half of railing for tactical crouch cover
    f.c('corrugated', sx * (hw - 0.03), y, 0, 0.05, 0.82, len - 0.2, { color: 0x5c625a, nav: false });
    const posts = Math.max(2, Math.round(len / 1.8));
    for (let i = 0; i <= posts; i++) {
      const lz = -len * 0.5 + (i / posts) * len;
      b.cyl('darkmetal', f.wx(sx * (hw - 0.04), lz), y - 0.1, f.wz(sx * (hw - 0.04), lz), 0.026, 1.1, 0x323538, { segs: 6 });
    }
  }
}

/**
 * Reinforced concrete military bunker / gatehouse with firing embrasures & sandbag roof reinforcement.
 */
export function tacticalBunker(b: LevelBuilder, x: number, z: number, rot: number, w = 4.2, d = 3.2) {
  const f = new Frame(b, x, z, rot);
  const hw = w * 0.5, hd = d * 0.5;
  const h = 2.45;
  // Ground floor slab
  f.c('slab', 0, 0, 0, w + 0.3, 0.14, d + 0.3, { color: 0xbdb7aa, nav: true });
  // Heavy concrete lower walls up to firing slit sill (y = 1.15), open door at rear (-Z)
  f.c('concrete', 0, 0.14, hd - 0.16, w, 1.05, 0.32, { color: 0xc2bcb0, absGrime: true });
  f.c('concrete', -hw + 0.16, 0.14, 0, 0.32, 1.05, d - 0.64, { color: 0xc2bcb0, absGrime: true });
  f.c('concrete', hw - 0.16, 0.14, 0, 0.32, 1.05, d - 0.64, { color: 0xc2bcb0, absGrime: true });
  // Rear wall with doorway opening
  for (const sx of [-1, 1]) {
    f.c('concrete', sx * (hw - 0.65), 0.14, -hd + 0.16, 1.3, h - 0.14, 0.32, { color: 0xc2bcb0, absGrime: true });
  }
  f.c('concrete', 0, 2.08, -hd + 0.16, w - 2.6, h - 2.08, 0.32, { color: 0xc2bcb0 });
  // Corner concrete blast pillars flanking the embrasure slits
  for (const sx of [-1, 1]) {
    f.c('concrete', sx * (hw - 0.3), 1.19, hd - 0.16, 0.6, h - 1.19, 0.34, { color: 0xb6b0a4 });
  }
  // Thick overhanging blast roof slab + top sandbag layer
  f.c('slab', 0, h, 0, w + 0.55, 0.28, d + 0.55, { color: 0xb2aca0 });
  P.sandbags(b, f.wx(0, hd - 0.1), f.wz(0, hd - 0.1), rot, w - 0.3, 2, h + 0.28, false);
  P.sandbags(b, f.wx(-hw + 0.1, 0), f.wz(-hw + 0.1, 0), rot + H, d - 0.3, 2, h + 0.28, false);
  P.sandbags(b, f.wx(hw - 0.1, 0), f.wz(hw - 0.1, 0), rot + H, d - 0.3, 2, h + 0.28, false);
  // Warm interior security light & tactical field radio on firing sill
  b.model('security_light', f.wx(0, -hd + 0.38), h - 0.35, f.wz(0, -hd + 0.38), rot, { scale: 0.68 });
  b.model('field_radio', f.wx(hw - 0.85, hd - 0.2), 1.19, f.wz(hw - 0.85, hd - 0.2), rot + 0.3, {});
}

/**
 * Industrial twin vertical steel fuel storage silos on a concrete containment bund
 * connected by an elevated steel pipe bridge.
 */
export function fuelSiloComplex(b: LevelBuilder, x: number, z: number, rot = 0) {
  const f = new Frame(b, x, z, rot);
  // Concrete containment bund wall & pad (9.4 x 5.2m)
  f.c('slab', 0, 0, 0, 9.4, 0.14, 5.2, { color: 0xb8b2a6 });
  for (const sz of [-2.52, 2.52]) f.c('concrete', 0, 0.14, sz, 9.4, 0.55, 0.22, { color: 0xc2bcb0, grime: 0.85 });
  for (const sx of [-4.6, 4.6]) f.c('concrete', sx, 0.14, 0, 0.22, 0.55, 4.82, { color: 0xc2bcb0, grime: 0.85 });

  // Twin 16.2k-tri sculpted industrial silos (native 5.16 x 12.23 x 4.74 -> scaled 0.68 to 3.5 x 8.3 x 3.2)
  for (const [tx, rOff, col] of [[-2.25, 0, 0xeee8da], [2.25, Math.PI, 0xe2dcd0]] as [number, number, number][]) {
    const wx = f.wx(tx, 0), wz = f.wz(tx, 0);
    b.model('arch_silo', wx, 0.14, wz, rot + rOff, { scale: 0.68, color: col });
    f.solid(tx, 0.14, 0, 3.4, 8.2, 3.2, 'metal', true);
  }
  // Overhead steel transfer pipe bridge & photogrammetry welding cart + propane cylinders
  b.tube('darkmetal', f.v(-2.25, 5.4, 0), f.v(2.25, 5.4, 0), 0.12, 0x52565a, 10);
  b.model('propane_tank', f.wx(-0.4, 1.65), 0.14, f.wz(-0.4, 1.65), rot + 0.4, {});
  b.model('ph_welder', f.wx(0.5, 1.65), 0.14, f.wz(0.5, 1.65), rot - 0.5, { scale: 1.0 });
}

/**
 * Open-air timber & steel military briefing pavilion with concrete pad, pitched roof,
 * illuminated hanging lamps, briefing table, tactical clipboard & notice board.
 */
export function briefingPavilion(b: LevelBuilder, x: number, z: number, rot = 0) {
  const f = new Frame(b, x, z, rot);
  const w = 6.2, d = 4.6, h = 2.85;
  // Raised concrete pad with crisp bevel curb
  f.c('slab', 0, 0, 0, w + 0.5, 0.12, d + 0.5, { color: 0xc2bcb0, grime: 0.9, nav: true });
  // Four corner structural steel posts + knee braces
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (w * 0.5 - 0.18), pz = sz * (d * 0.5 - 0.18);
      f.c('darkmetal', px, 0.12, pz, 0.14, h - 0.12, 0.14, { color: 0x3e4245 });
      b.tube('darkmetal', f.v(px, h - 0.55, pz), f.v(px - sx * 0.55, h - 0.08, pz), 0.025, 0x3e4245, 5);
    }
  }
  // Eave steel beams & pitched corrugated shade roof
  for (const sz of [-1, 1]) f.d('darkmetal', 0, h - 0.1, sz * (d * 0.5 - 0.18), w, 0.12, 0.1, { color: 0x3e4245 });
  for (const sx of [-1, 1]) f.d('darkmetal', sx * (w * 0.5 - 0.18), h - 0.1, 0, 0.1, 0.12, d, { color: 0x3e4245 });
  const peak = 0.62;
  const slopeSpan = d * 0.5 + 0.45;
  const slopeLen = Math.hypot(slopeSpan, peak);
  const pitch = Math.atan2(peak, slopeSpan);
  const sheet = new THREE.BoxGeometry(w + 0.7, 0.05, slopeLen + 0.06);
  for (const sz of [-1, 1]) {
    b.geo('corrugated', sheet, f.v(0, h + peak * 0.5 + 0.05, sz * slopeSpan * 0.5), new THREE.Euler(sz * pitch, rot, 0, 'YXZ'), 1, 0x7b8072);
  }
  sheet.dispose();

  // Warm overhead shop lamps
  for (const lx of [-1.5, 1.5]) {
    b.model('hanging_lamp', f.wx(lx, 0), h - 0.42, f.wz(lx, 0), rot, { scale: 0.65 });
  }
  // Tactical briefing table, rugged field laptop, field radio, clipboard, binoculars, map notice board & bench
  P.solidProp(b, 'table', f.wx(0.2, -0.4), f.wz(0.2, -0.4), rot, 0.12, 0.85, { surface: 'wood', maxH: 0.78 });
  b.model('ph_laptop', f.wx(0.15, -0.45), 0.92, f.wz(0.15, -0.45), rot + Math.PI, {});
  b.model('field_radio', f.wx(-0.45, -0.55), 0.92, f.wz(-0.45, -0.55), rot + 0.3, {});
  b.model('clipboard', f.wx(0.62, -0.22), 0.92, f.wz(0.62, -0.22), rot - 0.2, {});
  b.model('binoculars', f.wx(0.82, -0.52), 0.92, f.wz(0.82, -0.52), rot + 0.8, {});
  P.solidProp(b, 'notice_board', f.wx(0.2, -1.95), f.wz(0.2, -1.95), rot, 0.12, 0.92, { surface: 'wood', shrink: 0.5 });
  P.solidProp(b, 'bench', f.wx(-2.2, 0.9), f.wz(-2.2, 0.9), rot + H, 0.12, 0.95, { surface: 'wood', maxH: 0.5 });
  b.model('ph_shelves', f.wx(2.35, -1.35), 0.12, f.wz(2.35, -1.35), rot - H, {});
  b.model('ammo_box', f.wx(2.15, 0.2), 0.12, f.wz(2.15, 0.2), rot + 0.25, { scale: 1.15 });
  b.model('mil_crate', f.wx(2.0, 1.1), 0.12, f.wz(2.0, 1.1), rot - 0.15, {});
}

/**
 * Downrange Tier-1 tactical urban facade training prop (plywood/timber wall mockup with
 * window cutout, roof parapet, timber rear bracing, and sandbag skirt).
 */
export function urbanFacadeTarget(b: LevelBuilder, x: number, z: number, rot = 0, w = 4.6, h = 2.75) {
  const f = new Frame(b, x, z, rot);
  const osb = 0xc8b28c;
  // Wall segments around a central window opening (1.3m wide, y = 1.05..2.05)
  const sideW = (w - 1.3) * 0.5;
  f.c('osb', -(0.65 + sideW * 0.5), 0, 0, sideW, h, 0.14, { color: osb, grime: 0.85 });
  f.c('osb', 0.65 + sideW * 0.5, 0, 0, sideW, h, 0.14, { color: osb, grime: 0.85 });
  f.c('osb', 0, 0, 0, 1.3, 1.05, 0.14, { color: osb, grime: 0.85 });
  f.c('osb', 0, 2.05, 0, 1.3, h - 2.05, 0.14, { color: osb, grime: 0.85 });
  // Timber stud frame & angled rear A-frame support struts
  for (const sx of [-w * 0.5 + 0.1, -0.68, 0.68, w * 0.5 - 0.1]) {
    f.d('wood', sx, 0, 0.08, 0.1, h, 0.1, { color: 0x7a6448 });
    b.tube('wood', f.v(sx, h - 0.3, 0.12), f.v(sx, 0.05, 1.25), 0.045, 0x7a6448, 5);
  }
  f.d('wood', 0, h, 0, w + 0.16, 0.1, 0.22, { color: 0x6e5a40 });
  // Sandbag skirt anchoring the base
  P.sandbags(b, f.wx(0, -0.35), f.wz(0, -0.35), rot, w - 0.4, 2, 0, false);
}

/**
 * Adds AAA architectural cornice band, ground-floor stone plinth, corner pilasters,
 * and rooftop parapet trim to any rectangular building mass.
 */
export function dressBuildingFacade(
  b: LevelBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  h: number,
  o: { trimCol?: number; stoneCol?: number; crenellations?: boolean; floorY?: number } = {},
) {
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
  const trim = o.trimCol ?? 0xe2d6be;
  const stone = o.stoneCol ?? 0xbdb29c;

  // Projecting stone cornice molding band along roofline
  b.deco('concrete', cx, h - 0.16, z0 - 0.07, w + 0.26, 0.18, 0.16, { color: trim });
  b.deco('concrete', cx, h - 0.16, z1 + 0.07, w + 0.26, 0.18, 0.16, { color: trim });
  b.deco('concrete', x0 - 0.07, h - 0.16, cz, 0.16, 0.18, d + 0.26, { color: trim });
  b.deco('concrete', x1 + 0.07, h - 0.16, cz, 0.16, 0.18, d + 0.26, { color: trim });

  // Optional mid-floor horizontal stringcourse belt
  if (o.floorY) {
    b.deco('concrete', cx, o.floorY, z0 - 0.04, w + 0.14, 0.14, 0.1, { color: trim });
    b.deco('concrete', cx, o.floorY, z1 + 0.04, w + 0.14, 0.14, 0.1, { color: trim });
    b.deco('concrete', x0 - 0.04, o.floorY, cz, 0.1, 0.14, d + 0.14, { color: trim });
    b.deco('concrete', x1 + 0.04, o.floorY, cz, 0.1, 0.14, d + 0.14, { color: trim });
  }

  // Four corner stone quoins/pilasters catching raking desert shadows
  for (const sx of [x0, x1]) {
    for (const sz of [z0, z1]) {
      b.deco('cinder', sx, 0, sz, 0.38, h, 0.38, { color: stone, absGrime: true });
    }
  }

  // Optional desert citadel parapet merlons along top edges
  if (o.crenellations) {
    const py = h + 0.55;
    for (let px = x0 + 0.8; px < x1 - 0.5; px += 1.4) {
      b.deco('concrete', px, py, z0 + 0.1, 0.65, 0.32, 0.24, { color: trim });
      b.deco('concrete', px, py, z1 - 0.1, 0.65, 0.32, 0.24, { color: trim });
    }
    for (let pz = z0 + 0.8; pz < z1 - 0.5; pz += 1.4) {
      b.deco('concrete', x0 + 0.1, py, pz, 0.24, 0.32, 0.65, { color: trim });
      b.deco('concrete', x1 - 0.1, py, pz, 0.24, 0.32, 0.65, { color: trim });
    }
  }
}

export { rbox };
