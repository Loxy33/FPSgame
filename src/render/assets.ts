import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { settings } from '../core/settings';
import { applyGrime, applySurfacePatina, applyWetness } from './weather';
import { applyDetail } from './detail';

/**
 * Runtime loader for the baked CC0 assets in public/assets (see tools/fetch-assets.mjs):
 * photo-scanned tiling PBR textures, the HDRI sky, static prop models (flattened into
 * batch-friendly parts) and the raw glTF scenes for weapons and characters.
 */

export interface ScanTex {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** R = ambient occlusion, G = roughness, B = metalness. */
  armMap: THREE.Texture;
  /** Displacement height field (grayscale), when the source had one. Drives POM. */
  heightMap?: THREE.Texture;
  /** Mean linear-space green of the albedo. */
  meanG: number;
}

export interface SkyMeta {
  sunDir: [number, number, number];
  sunColor: [number, number, number];
  sunPeak: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  skyBottom: number;
}

export interface PropPart {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
}

/** A static model normalised so it rests on y = 0 and is centred on the origin in XZ. */
export interface PropModel {
  parts: PropPart[];
  size: THREE.Vector3;
  tris: number;
}

interface PropSpec {
  file: string;
  /** Pre-rotation (radians, XYZ order) applied before the model is grounded / centred. */
  rot?: [number, number, number];
  /** Only keep meshes whose node name matches. */
  only?: RegExp;
  /** Replace the albedo with a brightness-normalised greyscale copy so vertex colours can repaint it. */
  grey?: number;
  /** Desaturates bright/stylized source albedos (0..1) into gritty photorealistic desert tones. */
  desat?: number;
  /** Multiplies the albedo (darken clean-looking models). */
  tint?: number;
  /** Only keep triangles whose centroid X (source space) lies in this range — splits "set" models. */
  clipX?: [number, number];
  /** Only keep triangles whose centroid Z (source space) lies in this range — splits multi-row "set" models. */
  clipZ?: [number, number];
  /** Albedo multiplier (may exceed 1) for assets that read too dark in this lighting. */
  gain?: number;
  /** Keep this XZ point of the source model at the origin instead of the bbox centre. */
  pivot?: [number, number];
  scale?: number;
  /** Lamp lenses (glass / lens / LED materials) become emissive at this intensity instead of being dropped. */
  glow?: number;
  glowColor?: number;
  /** World-space ground-contact grime & desert dust overlay (0..1) so scanned buildings blend seamlessly. */
  grime?: number;
  /** Enforces gritty matte PBR roughness floor (0.58+) and darkens glossy plastic trims on stylized GLBs. */
  matte?: boolean;
  /** Keep double-sided rendering on open-backed photogrammetry rock/cliff scans. */
  doubleSide?: boolean;
}

const H = Math.PI / 2;

export const PROP_SPECS = {
  barrel_x: { file: 'barrel_a' },
  barrel: { file: 'barrel_b', grey: 0.8 },
  road_barrier: { file: 'road_barrier' },
  road_barrier_b: { file: 'road_barrier_b' },
  jersey: { file: 'jersey_barrier', tint: 0.8 },
  tyre: { file: 'tyre', rot: [H, 0, 0] },
  jerrycan: { file: 'jerrycan', scale: 0.62 },
  mil_crate: { file: 'mil_crate' },
  mil_crate_open: { file: 'mil_crate_b' },
  wood_crate_a: { file: 'wood_crate_a' },
  wood_crate_b: { file: 'wood_crate_b' },
  plastic_crate: { file: 'plastic_crate' },
  ammo_box: { file: 'ammo_box' },
  generator: { file: 'generator' },
  compressor: { file: 'compressor' },
  covered_car: { file: 'covered_car' },
  cardboard_box: { file: 'cardboard_box' },
  trash_can: { file: 'trash_can', only: /handle/ },
  trash_can_rust: { file: 'trash_can', only: /rust/ },
  propane_tank: { file: 'propane_tank' },
  cement_bag: { file: 'cement_bag' },
  aircon: { file: 'aircon', only: /unit_\d/ },
  aircon_rust: { file: 'aircon', only: /rusted/ },
  utility_box: { file: 'utility_box' },
  shutter_door: { file: 'shutter_door', only: /door$/ },
  shutter_door_tag: { file: 'shutter_door', only: /graffiti/ },
  shutter_window: { file: 'shutter_window', only: /01$/ },
  chair: { file: 'chair' },
  wheel_rim: { file: 'wheel_rim', rot: [H, 0, 0] },
  street_lamp: { file: 'street_lamp' },
  searchlight: { file: 'searchlight' },
  table: { file: 'table' },
  boulder_a: { file: 'boulder_a', tint: 0.72, grime: 0.45 },
  boulder_b: { file: 'boulder_b', tint: 0.72, grime: 0.45 },
  boulder_c: { file: 'boulder_c', tint: 0.72, grime: 0.45 },
  stones: { file: 'rocks_a', tint: 0.76 },
  cliff: { file: 'cliff_a', desat: 0.25, tint: 0.58, grime: 0.55, doubleSide: true },
  bush_s: { file: 'bush_a', clipX: [-0.4, 0.55], gain: 2.6 },
  bush_m: { file: 'bush_a', clipX: [0.55, 1.42], gain: 2.6 },
  bush_l: { file: 'bush_a', clipX: [1.42, 2.0], gain: 2.6 },
  tree_far: { file: 'tree_lo' },
  rock: { file: 'rock_lo' },
  tree: { file: 'tree_a' },
  dead_trunk: { file: 'dead_trunk' },
  sandbags: { file: 'sandbags' },
  container: { file: 'container', grey: 0.8 },
  pallet: { file: 'pallet', tint: 0.62 },
  utility_pole: { file: 'utility_pole', rot: [0, H, 0], pivot: [0, 0.23] },
  dumpster: { file: 'dumpster' },
  trash_bags: { file: 'trash_bags' },
  chainlink: { file: 'chainlink' },
  barbed_wire: { file: 'barbed_wire' },
  // Extract a single tall twin-head yellow tripod floodlight from the multi-variant flood_lights.glb pack
  flood_lights: { file: 'flood_lights', glow: 7, clipX: [-1.45, -0.50], clipZ: [-0.36, 0.36] },
  field_radio: { file: 'field_radio' },
  megaphone: { file: 'megaphone' },
  clipboard: { file: 'clipboard' },
  binoculars: { file: 'binoculars' },
  medical_box: { file: 'medical_box' },
  office_desk: { file: 'office_desk' },
  bench: { file: 'bench' },
  toolbox: { file: 'toolbox' },
  plastic_bin: { file: 'plastic_bin' },
  stool: { file: 'stool' },
  security_light: { file: 'security_light', glow: 8 },
  hanging_lamp: { file: 'hanging_lamp' },
  traffic_cone: { file: 'traffic_cone' },
  notice_board: { file: 'notice_board' },
  railing: { file: 'railing' },
  street_light: { file: 'street_light', glow: 6 },
  barricade: { file: 'barricade', glow: 5, glowColor: 0xff9a20 },
  cardboard_stack: { file: 'cardboard_stack' },
  // --- AAA Photorealistic Vehicles (aligned along local +X, gritty matte weathered military/desert PBR) ---
  veh_offroad: { file: 'veh_offroad', rot: [0, H, 0], grey: 0.56, grime: 0.78, matte: true },
  veh_armored: { file: 'veh_armored', rot: [0, H, 0], grey: 0.54, grime: 0.82, matte: true },
  veh_truck: { file: 'veh_truck', rot: [0, H, 0], grey: 0.54, grime: 0.82, matte: true },
  veh_tanker: { file: 'veh_tanker', rot: [0, H, 0], grey: 0.58, grime: 0.75, matte: true },
  veh_pickup: { file: 'veh_pickup', rot: [0, H, 0], grey: 0.54, grime: 0.8, matte: true },
  veh_sedan: { file: 'veh_sedan', rot: [0, H, 0], grey: 0.52, grime: 0.76, matte: true },
  veh_heli: { file: 'veh_heli', rot: [0, H, 0], grey: 0.46, grime: 0.62, matte: true },
  veh_forklift: { file: 'veh_forklift', rot: [0, H, 0], desat: 0.62, tint: 0.68, grime: 0.7, matte: true },
  // --- AAA Industrial & Tactical Buildings (matte weathered desert grading) ---
  bldg_adobe: { file: 'bldg_adobe', desat: 0.72, tint: 0.74, grime: 0.78, matte: true },
  bldg_villa: { file: 'bldg_villa', desat: 0.82, tint: 0.72, grime: 0.78, matte: true },
  bldg_hacienda: { file: 'bldg_hacienda', desat: 0.82, tint: 0.72, grime: 0.78, matte: true },
  bldg_shop: { file: 'bldg_shop', desat: 0.85, tint: 0.72, grime: 0.78, matte: true },
  bldg_apt: { file: 'bldg_apt', desat: 0.85, tint: 0.72, grime: 0.8, matte: true },
  bldg_warehouse: { file: 'bldg_warehouse', desat: 0.82, tint: 0.76, grime: 0.78, matte: true },
  bldg_hangar: { file: 'bldg_hangar', desat: 0.82, tint: 0.76, grime: 0.78, matte: true },
  bldg_site_office: { file: 'bldg_site_office', desat: 0.82, tint: 0.76, grime: 0.72, matte: true },
  bldg_chu: { file: 'bldg_chu', desat: 0.82, tint: 0.75, grime: 0.74, matte: true },
  arch_clocktower: { file: 'arch_clocktower', desat: 0.78, tint: 0.76, grime: 0.75, matte: true },
  arch_fountain: { file: 'arch_fountain', desat: 0.82, tint: 0.76, grime: 0.75, matte: true },
  arch_ruin: { file: 'arch_ruin', desat: 0.78, tint: 0.76, grime: 0.78, matte: true },
  arch_stall: { file: 'arch_stall', desat: 0.68, tint: 0.74, grime: 0.62, matte: true },
  arch_gas_station: { file: 'arch_gas_station', desat: 0.84, tint: 0.72, grime: 0.76, matte: true },
  arch_gas_pump: { file: 'arch_gas_pump', desat: 0.76, tint: 0.74, grime: 0.58, matte: true },
  arch_silo: { file: 'arch_silo', desat: 0.85, tint: 0.76, grime: 0.76, matte: true },
  arch_watchtower: { file: 'arch_watchtower', desat: 0.85, tint: 0.74, grime: 0.75, matte: true },
  arch_water_tower: { file: 'arch_water_tower', grey: 0.62, grime: 0.72, matte: true },
  arch_radio_tower: { file: 'arch_radio_tower', desat: 0.75, tint: 0.78, grime: 0.55, matte: true },
  arch_sat_dish: { file: 'arch_sat_dish', desat: 0.8, tint: 0.78, grime: 0.48, matte: true },
  prop_porta_john: { file: 'prop_porta_john', desat: 0.72, tint: 0.72, grime: 0.62, matte: true },
  prop_palm: { file: 'prop_palm', desat: 0.52, tint: 0.62, grime: 0.3, matte: true },
  prop_crater: { file: 'prop_crater', desat: 0.7, tint: 0.72, grime: 0.65, matte: true },
  prop_scaffolding: { file: 'prop_scaffolding', desat: 0.78, tint: 0.76, grime: 0.58, matte: true },
  // --- Poly Haven Photogrammetry Urban & Tactical Details ---
  ph_hydrant: { file: 'ph_hydrant', grime: 0.3 },
  ph_manhole: { file: 'ph_manhole', grime: 0.35 },
  ph_welder: { file: 'ph_welder', grime: 0.25 },
  ph_tool_cart: { file: 'ph_tool_cart', grime: 0.25 },
  ph_shelves: { file: 'ph_shelves', scale: 0.1, grime: 0.3 },
  ph_sec_cam: { file: 'ph_sec_cam' },
  ph_laptop: { file: 'ph_laptop', scale: 0.65 },
  ph_extinguisher: { file: 'ph_extinguisher', grime: 0.25 },
  ph_sconce: { file: 'ph_sconce', glow: 6, glowColor: 0xffb84a },
  ph_caged_light: { file: 'ph_caged_light', glow: 6, glowColor: 0x8cc8ff },
  ph_circuit_board: { file: 'ph_circuit_board' },
} satisfies Record<string, PropSpec>;

export type PropName = keyof typeof PROP_SPECS;

const RAW_MODELS = [
  // Core weapons & characters (including custom rigged hero_gao, hero_tiechui, hero_bailing)
  'wpn_m4a1', 'wpn_pistol', 'wpn_boltrifle', 'wpn_grenade',
  'soldier', 'char_officer', 'char_heavy', 'char_breacher', 'char_specops', 'char_medic', 'char_crew',
  'hero_gao', 'hero_tiechui', 'hero_linfeng', 'hero_bailing', 'boss_kronos', 'boss_tyrant',
  'arms',
  'fp_m4a1', 'fp_ak47', 'fp_scarl', 'fp_mp5a5', 'fp_awm', 'fp_m1911',
  'oil_pumpjack', 'oil_tank', 'oil_cracker', 'oil_tanker', 'oil_satdish', 'oil_server_rack', 'oil_blastgate',
  'ship_container', 'ship_gantry_crane', 'ship_diesel_engine', 'ship_radar_mast', 'ship_watertight_door',
  'ship_lifeboat_davit', 'ship_windlass', 'ship_mess_booth', 'ship_galley_unit', 'ship_restroom_unit',
  'ship_bunk_unit', 'ship_aa_battery', 'ship_z20j_heli',
  'hero_gao_kit', 'hero_tiechui_kit', 'hero_player_kit', 'hero_bailing_kit',
  'boss_kronos_kit', 'boss_viper_kit', 'boss_tyrant_kit',
] as const;
export type RawModelName = (typeof RAW_MODELS)[number];

const SCAN_TEXTURES = ['sand', 'concrete', 'plaster', 'cinder', 'asphalt', 'corrugated', 'wood', 'burlap', 'metal', 'mud', 'osb', 'slab'] as const;
export type ScanTexName = (typeof SCAN_TEXTURES)[number];

const SHIP_TEXTURES = ['hull_plate', 'deck_tread', 'bulkhead_panel', 'ceramic_tile', 'galley_steel', 'container_corrug'] as const;
export type ShipTexName = (typeof SHIP_TEXTURES)[number];

export const assets = {
  tex: {} as Record<ScanTexName, ScanTex>,
  shipTex: {} as Record<ShipTexName, ScanTex>,
  props: {} as Record<PropName, PropModel>,
  gltf: {} as Record<RawModelName, GLTF>,
  sky: null as null | { bg: THREE.Texture; hdr: THREE.DataTexture; meta: SkyMeta },
};

const BASE = `${import.meta.env.BASE_URL}assets/`;

function meanGreen(img: CanvasImageSource): number {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += Math.pow(d[i + 1] / 255, 2.2);
  return s / (d.length / 4);
}

/** Greyscale, desaturated, or darkened copy of an albedo texture. */
function remapAlbedo(
  src: THREE.Texture,
  greyMean: number | undefined,
  tint: number | undefined,
  desat: number | undefined,
): THREE.Texture {
  const img = src.image as ImageBitmap | HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  if (greyMean !== undefined) {
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const k = (greyMean * 255) / (sum / (d.length / 4));
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // keep a subtle hint of original hue so rust/glass/tires keep realistic contrast
      const g = Math.min(255, l * k);
      d[i] = Math.min(255, g + (d[i] - l) * 0.14 * k);
      d[i + 1] = Math.min(255, g + (d[i + 1] - l) * 0.14 * k);
      d[i + 2] = Math.min(255, g + (d[i + 2] - l) * 0.14 * k);
    }
  } else {
    const t = tint ?? 1;
    const ds = desat ?? 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = Math.min(255, (d[i] + (l - d[i]) * ds) * t);
      d[i + 1] = Math.min(255, (d[i + 1] + (l - d[i + 1]) * ds) * t);
      d[i + 2] = Math.min(255, (d[i + 2] + (l - d[i + 2]) * ds) * t);
    }
  }
  ctx.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = src.flipY;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = src.anisotropy;
  t.channel = src.channel;
  return t;
}

function flattenProp(gltf: GLTF, spec: PropSpec, anisotropy: number): PropModel {
  const parts: PropPart[] = [];
  const pre = new THREE.Matrix4();
  if (spec.rot) pre.makeRotationFromEuler(new THREE.Euler(spec.rot[0], spec.rot[1], spec.rot[2]));
  if (spec.scale) pre.scale(new THREE.Vector3(spec.scale, spec.scale, spec.scale));
  const pivot = new THREE.Vector3(spec.pivot?.[0] ?? 0, 0, spec.pivot?.[1] ?? 0).applyMatrix4(pre);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const mats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  let tris = 0;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (spec.only && !spec.only.test(mesh.name)) return;
    const src = mesh.material as THREE.MeshStandardMaterial & { transmission?: number };
    const glowing = !!spec.glow && /glass|lens|led|panel/i.test(src.name);
    const keepTintedGlass = !!spec.matte && /window_glass|shop_glass/i.test(src.name);
    if ((src.transparent || (src.transmission ?? 0) > 0) && /glass/i.test(src.name) && !glowing && !keepTintedGlass) return;
    let mat = mats.get(src);
    if (!mat) {
      mat = src.clone();
      if (keepTintedGlass) {
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
      }
      if (glowing) {
        mat.transparent = false;
        mat.opacity = 1;
        mat.map = null;
        mat.color.setRGB(0.08, 0.08, 0.08);
        mat.emissive = new THREE.Color(spec.glowColor ?? 0xffe9c8);
        mat.emissiveIntensity = spec.glow!;
        mat.emissiveMap = null;
        mat.metalness = 0;
        mat.roughness = 0.25;
      }
      // tangents are dropped when props are merged, so use the derivative-tangent convention
      if (mesh.geometry.attributes.tangent && mat.normalScale) mat.normalScale.y *= -1;
      if (mat.transparent) {
        mat.transparent = false;
        mat.alphaTest = 0.5;
        mat.depthWrite = true;
      }
      if (!mat.alphaTest) mat.side = spec.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
      // Props render via GPU Hardware Instancing (instanceColor), so vertexColors stays off
      mat.vertexColors = false;
      mat.envMapIntensity = 1;
      if (mat.map && (spec.grey !== undefined || spec.tint !== undefined || spec.desat !== undefined)) {
        mat.map = remapAlbedo(mat.map, spec.grey, spec.tint, spec.desat);
      } else if (!mat.map && !glowing && (spec.grey !== undefined || spec.tint !== undefined || spec.desat !== undefined || spec.matte)) {
        // Untextured sub-materials (window glass, hubcaps, trim, shutters, beacons, tires) get gritty photorealistic grading
        const mname = (src.name || '').toLowerCase();
        if (/glass|window|glint/.test(mname)) {
          mat.color.setHex(0x0c1319);
          mat.roughness = 0.14;
          mat.metalness = 0.82;
          mat.envMapIntensity = 1.35;
        } else if (/tire|tyre|rubber|blade/.test(mname)) {
          mat.color.setHex(0x1f1e1c);
          mat.roughness = 0.92;
          mat.metalness = 0.0;
        } else if (/hubcap|rim|chrome/.test(mname)) {
          mat.color.setHex(0x46484a);
          mat.roughness = 0.48;
          mat.metalness = 0.65;
        } else {
          const r = mat.color.r, g = mat.color.g, b = mat.color.b;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const ds = spec.grey !== undefined ? 0.88 : (spec.desat ?? 0.75);
          const t = spec.tint ?? (spec.grey !== undefined ? 0.68 : 0.76);
          // Clamp bright cartoon plastic white down into realistic dusty stone/metal range
          const scale = lum > 0.65 ? (0.58 / lum) * t : t;
          mat.color.setRGB(
            Math.min(0.68, (r + (lum - r) * ds) * scale),
            Math.min(0.66, (g + (lum - g) * ds) * scale),
            Math.min(0.62, (b + (lum - b) * ds) * scale),
          );
        }
      }
      if (spec.matte && !glowing && !/glass|window|glint/i.test(src.name || '')) {
        mat.roughness = Math.max(mat.roughness ?? 0.5, mat.metalness > 0.4 ? 0.48 : 0.72);
        mat.metalness = Math.min(mat.metalness ?? 0, 0.35);
      }
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap]) if (t) t.anisotropy = anisotropy;
      if (spec.gain) mat.color.multiplyScalar(spec.gain);
      if (!mat.alphaTest) applyWetness(mat, spec.matte ? 0.55 : 0.7);
      if (!mat.alphaTest && spec.grime) applyGrime(mat, spec.grime, spec.grime * 0.55);
      // props and weapons are seen at arm's length in first person: give them micro detail too;
      // untextured GLBs (vehicles, trim, structures) get world-space patina + micro-grain bump + roughness breakup!
      if (mat.normalMap) {
        applyDetail(mat, 0.55, 5);
      } else if (!mat.map && !glowing && !mat.alphaTest && !/glass|window|glint/i.test(src.name || '')) {
        applySurfacePatina(mat, spec.matte ? 0.68 : 0.52, 3.4);
      }
      mats.set(src, mat);
    }
    const g = new THREE.BufferGeometry();
    const sg = mesh.geometry;
    g.setAttribute('position', sg.attributes.position.clone());
    if (sg.attributes.normal) g.setAttribute('normal', sg.attributes.normal.clone());
    if (sg.attributes.uv) g.setAttribute('uv', sg.attributes.uv.clone());
    if (sg.index) g.setIndex(sg.index.clone());
    if (spec.clipX || spec.clipZ) {
      g.applyMatrix4(mesh.matrixWorld);
      const pos = g.attributes.position;
      const src = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
      const keep: number[] = [];
      for (let i = 0; i < src.length; i += 3) {
        const cx = (pos.getX(src[i]) + pos.getX(src[i + 1]) + pos.getX(src[i + 2])) / 3;
        const cz = (pos.getZ(src[i]) + pos.getZ(src[i + 1]) + pos.getZ(src[i + 2])) / 3;
        if (spec.clipX && (cx < spec.clipX[0] || cx >= spec.clipX[1])) continue;
        if (spec.clipZ && (cz < spec.clipZ[0] || cz >= spec.clipZ[1])) continue;
        keep.push(src[i], src[i + 1], src[i + 2]);
      }
      if (!keep.length) return;
      // compact: only the vertices the kept triangles reference
      const remap = new Map<number, number>();
      const order: number[] = [];
      const idx = keep.map((i) => {
        let j = remap.get(i);
        if (j === undefined) {
          j = order.length;
          remap.set(i, j);
          order.push(i);
        }
        return j;
      });
      for (const key of Object.keys(g.attributes)) {
        const a = g.attributes[key] as THREE.BufferAttribute;
        const out = new Float32Array(order.length * a.itemSize);
        for (let k = 0; k < order.length; k++) for (let c = 0; c < a.itemSize; c++) out[k * a.itemSize + c] = a.getComponent(order[k], c);
        g.setAttribute(key, new THREE.BufferAttribute(out, a.itemSize));
      }
      g.setIndex(idx);
      g.applyMatrix4(pre);
    } else g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(pre, mesh.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    // bounds of the triangles actually used (clipped sets keep unused vertices around)
    const used = g.index ? g.index.array : null;
    const v = new THREE.Vector3();
    const n = used ? used.length : g.attributes.position.count;
    for (let i = 0; i < n; i++) box.expandByPoint(v.fromBufferAttribute(g.attributes.position, used ? used[i] : i));
    tris += n / 3;
    parts.push({ geo: g, mat });
  });
  const c = box.getCenter(new THREE.Vector3());
  const off = spec.pivot ? new THREE.Vector3(-pivot.x, -box.min.y, -pivot.z) : new THREE.Vector3(-c.x, -box.min.y, -c.z);
  for (const p of parts) p.geo.translate(off.x, off.y, off.z);
  // Foliage cards: shade them as one soft volume (normals fan out from the plant's core and
  // lean towards the sky) so leaves facing away from the sun do not turn into black cut-outs.
  const core = new THREE.Vector3(0, (box.max.y - box.min.y) * 0.3, 0);
  const fn = new THREE.Vector3();
  for (const p of parts) {
    if (!p.mat.alphaTest) continue;
    const pos = p.geo.attributes.position;
    const nor = p.geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      fn.fromBufferAttribute(pos, i).sub(core).normalize().multiplyScalar(0.55);
      fn.y += 0.75;
      fn.normalize();
      nor.setXYZ(i, fn.x, fn.y, fn.z);
    }
  }
  return { parts, size: box.getSize(new THREE.Vector3()), tris };
}

function loadTex(loader: THREE.TextureLoader, url: string, srgb: boolean, anisotropy: number) {
  return loader.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export async function loadAssets(anisotropy: number, progress: (p: number, label: string) => void) {
  const texLoader = new THREE.TextureLoader();
  // the FP weapon packs ship meshopt-compressed buffers and WebP textures
  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = new Set<string>(RAW_MODELS);
  for (const s of Object.values(PROP_SPECS)) files.add(s.file);
  const total = SCAN_TEXTURES.length + SHIP_TEXTURES.length + files.size + 1;
  let done = 0;
  const tick = (label: string) => progress(++done / total, label);

  const jobs: Promise<unknown>[] = [];

  // --- sky ---
  jobs.push((async () => {
    const [bg, hdr, meta] = await Promise.all([
      texLoader.loadAsync(`${BASE}sky/sky_bg.jpg`),
      new RGBELoader().setDataType(THREE.HalfFloatType).loadAsync(`${BASE}sky/sky_1k.hdr`),
      fetch(`${BASE}sky/sky.json`).then((r) => r.json() as Promise<SkyMeta>),
    ]);
    bg.colorSpace = THREE.SRGBColorSpace;
    bg.wrapS = THREE.RepeatWrapping;
    bg.wrapT = THREE.ClampToEdgeWrapping;
    bg.generateMipmaps = false;
    bg.minFilter = THREE.LinearFilter;
    hdr.wrapS = THREE.RepeatWrapping;
    hdr.minFilter = THREE.LinearFilter;
    hdr.magFilter = THREE.LinearFilter;
    assets.sky = { bg, hdr, meta };
    tick('天空 HDRI');
  })());

  // --- scanned surface textures ---
  // the 4k hero sets ship a 2k variant so medium/low quality keeps VRAM in check
  const HERO4K = new Set(['concrete', 'plaster', 'cinder', 'corrugated']);
  for (const name of SCAN_TEXTURES) {
    const suffix = HERO4K.has(name) && settings.quality !== 'high' ? '_2k' : '';
    jobs.push((async () => {
      const [map, normalMap, armMap, heightMap] = await Promise.all([
        loadTex(texLoader, `${BASE}tex/${name}_diff${suffix}.webp`, true, anisotropy),
        loadTex(texLoader, `${BASE}tex/${name}_nor${suffix}.webp`, false, anisotropy),
        loadTex(texLoader, `${BASE}tex/${name}_arm.webp`, false, anisotropy),
        // not every material has a displacement map: missing files are simply skipped
        loadTex(texLoader, `${BASE}tex/${name}_h.webp`, false, anisotropy).catch(() => undefined),
      ]);
      assets.tex[name] = { map, normalMap, armMap, heightMap, meanG: meanGreen(map.image as HTMLImageElement) };
      tick('扫描材质');
    })());
  }

  // --- bespoke 1024x1024 naval PBR texture sets (Blender/NumPy baked) ---
  for (const name of SHIP_TEXTURES) {
    jobs.push((async () => {
      const [map, normalMap, armMap] = await Promise.all([
        loadTex(texLoader, `${BASE}tex/ship/${name}_diff.jpg`, true, anisotropy),
        loadTex(texLoader, `${BASE}tex/ship/${name}_nor.png`, false, anisotropy),
        loadTex(texLoader, `${BASE}tex/ship/${name}_arm.png`, false, anisotropy),
      ]);
      assets.shipTex[name] = { map, normalMap, armMap, meanG: meanGreen(map.image as HTMLImageElement) };
      tick('航海材质');
    })());
  }

  // --- models ---
  const loaded = new Map<string, GLTF>();
  for (const f of files) {
    jobs.push(gltfLoader.loadAsync(`${BASE}models/${f}.glb`).then((g) => {
      loaded.set(f, g);
      tick('模型');
    }));
  }
  await Promise.all(jobs);

  for (const n of RAW_MODELS) assets.gltf[n] = loaded.get(n)!;
  for (const [name, spec] of Object.entries(PROP_SPECS) as [PropName, PropSpec][]) {
    assets.props[name] = flattenProp(loaded.get(spec.file)!, spec, anisotropy);
  }
}

/** Standalone (non-batched) instance of a prop, for dynamic objects. */
export function makePropObject(name: PropName, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const white = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  for (const p of assets.props[name].parts) {
    let m = white.get(p.mat);
    if (!m) {
      m = p.mat.clone();
      m.vertexColors = false;
      white.set(p.mat, m);
    }
    const mesh = new THREE.Mesh(p.geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.scale.setScalar(scale);
  return g;
}
