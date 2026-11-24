// Downloads the CC0 source assets (Poly Haven, Grab3D, OpenGameArt) into assets-src/ and bakes
// game-ready files into public/assets/. Re-runnable: finished outputs are skipped.
//   node tools/fetch-assets.mjs            -> everything
//   node tools/fetch-assets.mjs models     -> one section (models | textures | sky)
//   node tools/fetch-assets.mjs models barrel  -> only entries whose name matches
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { ROOT, SRC, OUT, download, phModel, phTexture, phHdri } from './ph.mjs';

const section = process.argv[2] || 'all';
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
const force = process.argv.includes('--force');
const BIN = path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

function gt(args) {
  execFileSync(process.execPath, [BIN, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}
const fresh = (out) => !force && fs.existsSync(out) && fs.statSync(out).size > 0;
const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(2) + 'MB';

// ---------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------
/**
 * src: 'ph:<id>' | 'grab:<slug>[/<file>]' | 'url:<http url>' | 'file:<path under assets-src>'
 * res: Poly Haven texture resolution to download; tex: max texture size in the baked GLB
 * ratio/error: simplification (ratio 1 = keep); parts: keep separate nodes (no flatten/join)
 */
const MODELS = [
  // --- weapons ---
  { name: 'wpn_pistol', src: 'ph:service_pistol', res: '2k', tex: 2048, ratio: 1, parts: true },
  { name: 'wpn_boltrifle', src: 'ph:bolt_action_rifle_7_62', res: '2k', tex: 2048, ratio: 1, parts: true },
  { name: 'wpn_grenade', src: 'ph:stick_grenade', res: '1k', tex: 1024, ratio: 1, parts: true },
  // --- characters (high-poly CC0 24-bone rigged characters) ---
  { name: 'soldier', src: 'grab:soldier-rigged/soldier-rigged.glb', tex: 2048, ratio: 0.25, error: 0.002, parts: true },
  { name: 'char_officer', src: 'grab:police-officer-rigged/police-officer-rigged.glb', tex: 2048, ratio: 0.25, error: 0.002, parts: true },
  { name: 'char_heavy', src: 'grab:sci-fi-soldier-rigged/sci-fi-soldier-rigged.glb', tex: 2048, ratio: 0.25, error: 0.002, parts: true },
  { name: 'char_breacher', src: 'grab:firefighter-rigged/firefighter-rigged.glb', tex: 2048, ratio: 0.25, error: 0.002, parts: true },
  { name: 'char_specops', src: 'grab:ninja-rigged/ninja-rigged.glb', tex: 2048, ratio: 0.25, error: 0.002, parts: true },
  { name: 'char_medic', src: 'grab:doctor-rigged/doctor-rigged.glb', tex: 2048, ratio: 0.25, error: 0.002, parts: true },
  { name: 'char_crew', src: 'grab:construction-worker-rigged/construction-worker-rigged.glb', tex: 2048, ratio: 0.25, error: 0.002, parts: true },
  // --- props ---
  { name: 'barrel_a', src: 'ph:Barrel_01', res: '1k', tex: 1024 },
  { name: 'barrel_b', src: 'ph:barrel_03', res: '1k', tex: 1024 },
  { name: 'road_barrier', src: 'ph:concrete_road_barrier', res: '1k', tex: 1024, ratio: 0.028, error: 0.004 },
  { name: 'road_barrier_b', src: 'ph:concrete_road_barrier_02', res: '1k', tex: 1024, ratio: 0.1, error: 0.003 },
  { name: 'tyre', src: 'ph:old_tyre', res: '1k', tex: 1024, ratio: 0.45, error: 0.003 },
  { name: 'jerrycan', src: 'ph:metal_jerrycan_green', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'mil_crate', src: 'ph:wooden_military_crate', res: '1k', tex: 1024, ratio: 0.3 },
  { name: 'mil_crate_b', src: 'ph:old_military_crate', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'ammo_box', src: 'ph:ammo_box', res: '1k', tex: 1024 },
  { name: 'generator', src: 'ph:portable_generator', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'covered_car', src: 'ph:covered_car', res: '1k', tex: 1024 },
  { name: 'cardboard_box', src: 'ph:cardboard_box_01', res: '1k', tex: 1024, ratio: 0.3 },
  { name: 'trash_can', src: 'ph:metal_trash_can', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'propane_tank', src: 'ph:propane_tank', res: '1k', tex: 1024, ratio: 0.4, error: 0.003 },
  { name: 'cement_bag', src: 'ph:cement_bag', res: '1k', tex: 1024 },
  { name: 'aircon', src: 'ph:exterior_aircon_unit', res: '1k', tex: 1024, ratio: 0.12, error: 0.004 },
  { name: 'utility_box', src: 'ph:utility_box_01', res: '1k', tex: 1024 },
  { name: 'boulder_a', src: 'ph:namaqualand_boulder_02', res: '1k', tex: 1024, ratio: 0.03, error: 0.01 },
  { name: 'boulder_b', src: 'ph:namaqualand_boulder_03', res: '1k', tex: 1024, ratio: 0.04, error: 0.01 },
  { name: 'boulder_c', src: 'ph:namaqualand_boulder_05', res: '1k', tex: 1024, ratio: 0.04, error: 0.01 },
  { name: 'rocks_a', src: 'ph:namaqualand_stones_01', res: '1k', tex: 1024, ratio: 0.06, error: 0.01 },
  { name: 'cliff_a', src: 'ph:namaqualand_cliff_01', res: '1k', tex: 1024, ratio: 0.05, error: 0.01 },
  { name: 'bush_a', src: 'ph:wild_rooibos_bush', res: '1k', tex: 1024, ratio: 0.35, error: 0.02 },
  { name: 'wood_crate_a', src: 'ph:wooden_crate_01', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'wood_crate_b', src: 'ph:wooden_crate_02', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'plastic_crate', src: 'ph:plastic_crate_01', res: '1k', tex: 512, ratio: 0.08, error: 0.004 },
  { name: 'shutter_door', src: 'ph:rollershutter_door', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'shutter_window', src: 'ph:rollershutter_window_01', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'chair', src: 'ph:plastic_monobloc_chair_01', res: '1k', tex: 512, ratio: 0.3 },
  { name: 'wheel_rim', src: 'ph:rusted_wheel_rim_01', res: '1k', tex: 512, ratio: 0.1, error: 0.004 },
  { name: 'compressor', src: 'ph:old_military_compressor', res: '1k', tex: 1024, ratio: 0.1, error: 0.003 },
  { name: 'street_lamp', src: 'ph:street_lamp_01', res: '1k', tex: 1024, ratio: 0.14, error: 0.002 },
  { name: 'searchlight', src: 'ph:portable_searchlight', res: '1k', tex: 512, ratio: 0.4 },
  { name: 'table', src: 'ph:wooden_picnic_table', res: '1k', tex: 1024, ratio: 0.5 },
  { name: 'tree_a', src: 'ph:quiver_tree_02', res: '1k', tex: 1024, ratio: 0.07, error: 0.02 },
  { name: 'tree_lo', src: 'ph:quiver_tree_02', res: '1k', tex: 512, ratio: 0.016, error: 0.05 },
  { name: 'dead_trunk', src: 'ph:dead_quiver_trunk', res: '1k', tex: 1024, ratio: 0.2, error: 0.01 },
  { name: 'sandbags', src: 'grab:sandbags/sandbags.glb', tex: 1024, ratio: 0.22, error: 0.004 },
  { name: 'rock_lo', src: 'ph:namaqualand_boulder_05', res: '1k', tex: 512, ratio: 0.0025, error: 0.06 },
  { name: 'jersey_barrier', src: 'grab:jersey-barrier/jersey-barrier.glb', tex: 1024 },
  { name: 'container', src: 'grab:shipping-container-proz/shipping-container-proz.glb', tex: 1024 },
  { name: 'pallet', src: 'grab:wooden-pallet/wooden-pallet.glb', tex: 512 },
  { name: 'utility_pole', src: 'grab:utility-pole/utility-pole.glb', tex: 1024, ratio: 0.25, error: 0.002 },
  { name: 'dumpster', src: 'grab:dumpster/dumpster.glb', tex: 1024, ratio: 0.35, error: 0.003 },
  { name: 'trash_bags', src: 'grab:trash-bag-pile/trash-bag-pile.glb', tex: 512, ratio: 0.25, error: 0.004 },
  { name: 'chainlink', src: 'grab:chain-link-fence/chain-link-fence-light.glb', tex: 1024 },
  { name: 'barbed_wire', src: 'grab:barbed-wire-fence/barbed-wire-fence-light.glb', tex: 512 },
  // training base dressing
  { name: 'flood_lights', src: 'ph:flood_lights', res: '1k', tex: 1024, ratio: 0.12, error: 0.004 },
  { name: 'field_radio', src: 'ph:vintage_radio_transceiver', res: '1k', tex: 512, ratio: 0.15, error: 0.003 },
  { name: 'megaphone', src: 'ph:Megaphone_01', res: '1k', tex: 512, ratio: 0.3 },
  { name: 'clipboard', src: 'ph:clipboard', res: '1k', tex: 512 },
  { name: 'binoculars', src: 'ph:binoculars', res: '1k', tex: 512, ratio: 0.25 },
  { name: 'medical_box', src: 'ph:medical_box', res: '1k', tex: 512 },
  { name: 'office_desk', src: 'ph:metal_office_desk', res: '1k', tex: 1024 },
  { name: 'bench', src: 'ph:painted_wooden_bench', res: '1k', tex: 1024 },
  { name: 'toolbox', src: 'ph:metal_toolbox', res: '1k', tex: 512, ratio: 0.3 },
  { name: 'plastic_bin', src: 'ph:plastic_container', res: '1k', tex: 512 },
  { name: 'stool', src: 'ph:folding_wooden_stool', res: '1k', tex: 512, ratio: 0.5 },
  { name: 'security_light', src: 'ph:security_light', res: '1k', tex: 512 },
  { name: 'hanging_lamp', src: 'ph:hanging_industrial_lamp', res: '1k', tex: 512, ratio: 0.4 },
  { name: 'traffic_cone', src: 'grab:traffic-cone/traffic-cone.glb', tex: 512 },
  { name: 'notice_board', src: 'grab:notice-board/notice-board.glb', tex: 1024 },
  { name: 'railing', src: 'grab:metal-railing/metal-railing.glb', tex: 1024 },
  { name: 'street_light', src: 'grab:street-light/street-light.glb', tex: 1024 },
  { name: 'barricade', src: 'grab:construction-barricade/construction-barricade.glb', tex: 1024 },
  { name: 'cardboard_stack', src: 'grab:cardboard-box-stack/cardboard-box-stack.glb', tex: 1024, ratio: 0.5 },
  // --- AAA Photorealistic Vehicles (Grab3D CC0 high-poly PBR) ---
  { name: 'veh_offroad', src: 'grab:off-road-4x4/off-road-4x4.glb', tex: 1024, ratio: 0.75, error: 0.002 },
  { name: 'veh_armored', src: 'grab:armored-truck/armored-truck.glb', tex: 1024, ratio: 0.75, error: 0.002 },
  { name: 'veh_truck', src: 'grab:delivery-truck/delivery-truck.glb', tex: 1024, ratio: 0.75, error: 0.002 },
  { name: 'veh_tanker', src: 'grab:tanker-truck/tanker-truck.glb', tex: 1024, ratio: 0.55, error: 0.003 },
  { name: 'veh_pickup', src: 'grab:pickup-truck/pickup-truck.glb', tex: 1024, ratio: 0.55, error: 0.003 },
  { name: 'veh_sedan', src: 'grab:sedan/sedan.glb', tex: 1024, ratio: 0.55, error: 0.003 },
  { name: 'veh_heli', src: 'grab:helicopter/helicopter.glb', tex: 1024, ratio: 0.6, error: 0.003 },
  { name: 'veh_forklift', src: 'grab:forklift/forklift.glb', tex: 1024, ratio: 0.65, error: 0.003 },
  // --- AAA Photorealistic Buildings & Landmarks (Grab3D CC0 high-poly PBR) ---
  { name: 'bldg_adobe', src: 'grab:adobe-house/adobe-house.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  { name: 'bldg_villa', src: 'grab:mediterranean-villa/mediterranean-villa.glb', tex: 1024, ratio: 0.5, error: 0.003 },
  { name: 'bldg_hacienda', src: 'grab:hacienda/hacienda.glb', tex: 1024, ratio: 0.5, error: 0.003 },
  { name: 'bldg_shop', src: 'grab:corner-shop/corner-shop.glb', tex: 1024, ratio: 0.5, error: 0.003 },
  { name: 'bldg_apt', src: 'grab:walk-up-apartment/walk-up-apartment.glb', tex: 1024, ratio: 0.5, error: 0.003 },
  { name: 'bldg_warehouse', src: 'grab:warehouse/warehouse.glb', tex: 1024, ratio: 0.5, error: 0.003 },
  { name: 'bldg_hangar', src: 'grab:hangar/hangar.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  { name: 'bldg_site_office', src: 'grab:site-office/site-office.glb', tex: 1024, ratio: 0.8, error: 0.003 },
  { name: 'bldg_chu', src: 'grab:container-home/container-home.glb', tex: 1024, ratio: 0.5, error: 0.003 },
  { name: 'arch_clocktower', src: 'grab:clock-tower/clock-tower.glb', tex: 1024, ratio: 0.55, error: 0.003 },
  { name: 'arch_fountain', src: 'grab:fountain/fountain.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  { name: 'arch_ruin', src: 'grab:ruin-archway/ruin-archway.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  { name: 'arch_stall', src: 'grab:bazaar-awning-stall/bazaar-awning-stall.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  { name: 'arch_gas_station', src: 'grab:gas-station/gas-station.glb', tex: 1024, ratio: 0.6, error: 0.003 },
  { name: 'arch_gas_pump', src: 'grab:gas-pump/gas-pump.glb', tex: 1024, ratio: 0.85, error: 0.003 },
  { name: 'arch_silo', src: 'grab:silo/silo.glb', tex: 1024, ratio: 0.55, error: 0.003 },
  { name: 'arch_watchtower', src: 'grab:guard-tower/guard-tower.glb', tex: 1024, ratio: 0.55, error: 0.003 },
  { name: 'arch_water_tower', src: 'grab:water-tower/water-tower.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  { name: 'arch_radio_tower', src: 'grab:radio-tower/radio-tower.glb', tex: 1024, ratio: 0.55, error: 0.003 },
  { name: 'arch_sat_dish', src: 'grab:satellite-dish/satellite-dish.glb', tex: 1024 },
  { name: 'prop_porta_john', src: 'grab:portable-toilet/portable-toilet.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  { name: 'prop_palm', src: 'grab:palm-tree/palm-tree.glb', tex: 1024, ratio: 0.6, error: 0.004 },
  { name: 'prop_crater', src: 'grab:crater/crater.glb', tex: 1024, ratio: 0.6, error: 0.004 },
  { name: 'prop_scaffolding', src: 'grab:scaffolding/scaffolding.glb', tex: 1024, ratio: 0.75, error: 0.003 },
  // --- Poly Haven Photogrammetry Urban & Tactical Details ---
  { name: 'ph_hydrant', src: 'ph:fire_hydrant', res: '1k', tex: 1024, ratio: 0.35, error: 0.003 },
  { name: 'ph_manhole', src: 'ph:water_manhole_cover', res: '1k', tex: 1024, ratio: 0.4, error: 0.003 },
  { name: 'ph_welder', src: 'ph:portable_welding_cart', res: '1k', tex: 1024, ratio: 0.35, error: 0.003 },
  { name: 'ph_tool_cart', src: 'ph:tool_cart', res: '1k', tex: 1024, ratio: 0.35, error: 0.003 },
  { name: 'ph_shelves', src: 'ph:steel_frame_shelves_01', res: '1k', tex: 1024, ratio: 0.35, error: 0.003 },
  { name: 'ph_sec_cam', src: 'ph:security_camera_01', res: '1k', tex: 512, ratio: 0.35, error: 0.003 },
  { name: 'ph_laptop', src: 'ph:classic_laptop', res: '1k', tex: 512, ratio: 0.5, error: 0.003 },
];

async function resolveModel(m) {
  const [kind, rest] = [m.src.slice(0, m.src.indexOf(':')), m.src.slice(m.src.indexOf(':') + 1)];
  if (kind === 'ph') return phModel(rest, m.res || '1k');
  if (kind === 'grab') return download(`https://grab3d.com/dl/${rest}`, path.join(SRC, 'grab', rest.replace('/', '__')));
  if (kind === 'url') return download(rest, path.join(SRC, 'url', path.basename(rest)));
  if (kind === 'file') return path.join(SRC, rest);
  throw new Error('bad src ' + m.src);
}

/** OpenGameArt CC0 M4A1 (FBX + loose PBR PNGs) -> one textured GLB with its parts kept as separate nodes. */
async function bakeM4(out) {
  const dir = path.join(SRC, 'oga', 'm4a1');
  const fbx = path.join(dir, 'M4A1.fbx');
  if (!fs.existsSync(fbx)) {
    const zip = await download('https://opengameart.org/sites/default/files/m4a1_0.zip', path.join(SRC, 'oga', 'm4a1_0.zip'));
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', dir, '--strip-components', '1']);
  }
  const raw = path.join(dir, 'M4A1_raw.glb');
  if (!fs.existsSync(raw)) {
    const exe = path.join(ROOT, 'node_modules', 'fbx2gltf', 'bin', process.platform === 'win32' ? 'Windows_NT' : process.platform === 'darwin' ? 'Darwin' : 'Linux', process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');
    execFileSync(exe, ['--binary', '--input', fbx, '--output', raw.replace(/\.glb$/, '')], { stdio: 'ignore' });
  }
  const { NodeIO } = await import('@gltf-transform/core');
  const io = new NodeIO();
  const doc = await io.read(raw);
  const S = 2048;
  const png = async (f) => sharp(path.join(dir, f)).resize(S, S).png().toBuffer();
  const rough = await sharp(path.join(dir, 'M4A1_Roughness.png')).resize(S, S).greyscale().raw().toBuffer();
  const metal = await sharp(path.join(dir, 'M4A1_Metallic.png')).resize(S, S).greyscale().raw().toBuffer();
  const orm = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) { orm[i * 3] = 255; orm[i * 3 + 1] = rough[i]; orm[i * 3 + 2] = metal[i]; }
  const tex = (name, buf) => doc.createTexture(name).setImage(buf).setMimeType('image/png');
  const base = tex('m4_base', await png('M4A1_Base_Color.png'));
  const nor = tex('m4_normal', await png('M4A1_Normal.png'));
  const mr = tex('m4_orm', await sharp(orm, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer());
  for (const m of doc.getRoot().listMaterials()) {
    m.setName('m4a1').setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(base).setNormalTexture(nor)
      .setMetallicRoughnessTexture(mr).setMetallicFactor(1).setRoughnessFactor(1);
  }
  const tmp = path.join(dir, 'M4A1_tex.glb');
  await io.write(tmp, doc);
  gt(['optimize', tmp, out, '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '2048', '--palette', 'false', '--instance', 'false', '--simplify', 'false', '--flatten', 'false', '--join', 'false']);
}

/** First-person arms: the arm/hand triangles of the full-detail soldier, still skinned to its skeleton. */
async function bakeArms(out) {
  const src = await resolveModel({ src: 'grab:soldier-rigged/soldier-rigged.glb' });
  const { NodeIO } = await import('@gltf-transform/core');
  const io = new NodeIO();
  const doc = await io.read(src);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const names = skin.listJoints().map((j) => j.getName());
  const keep = new Set(names.map((n, i) => (/(Arm|ForeArm|Hand)$/.test(n) ? i : -1)).filter((i) => i >= 0));
  for (const a of root.listAnimations()) a.dispose();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const n = J.getCount();
  const inArm = new Uint8Array(n);
  const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    J.getElement(i, j); W.getElement(i, w);
    let s = 0;
    for (let k = 0; k < 4; k++) if (keep.has(j[k])) s += w[k];
    inArm[i] = s > 0.5 ? 1 : 0;
  }
  const idx = prim.getIndices().getArray();
  const remap = new Int32Array(n).fill(-1);
  const order = [];
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!(inArm[a] && inArm[b] && inArm[c])) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) { remap[v] = order.length; order.push(v); }
      tris.push(remap[v]);
    }
  }
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    const size = acc.getElementSize();
    const srcArr = acc.getArray();
    const dst = new srcArr.constructor(order.length * size);
    for (let i = 0; i < order.length; i++) for (let k = 0; k < size; k++) dst[i * size + k] = srcArr[order[i] * size + k];
    acc.setArray(dst);
  }
  prim.getIndices().setArray(new Uint32Array(tris));
  const tmp = path.join(SRC, 'grab', 'arms_cut.glb');
  await io.write(tmp, doc);
  gt(['optimize', tmp, out, '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '2048', '--palette', 'false', '--instance', 'false', '--simplify', 'false', '--flatten', 'false', '--join', 'false']);
  console.log('  arms', order.length, 'verts', tris.length / 3, 'tris');
}

async function models() {
  const outDir = path.join(OUT, 'models');
  fs.mkdirSync(outDir, { recursive: true });
  const arms = path.join(outDir, 'arms.glb');
  if ((!only || only.test('arms')) && !fresh(arms)) {
    try { await bakeArms(arms); console.log('model arms', mb(arms)); } catch (e) { console.log('FAILED arms', String(e.stack || e).slice(0, 600)); }
  }
  const m4 = path.join(outDir, 'wpn_m4a1.glb');
  if ((!only || only.test('wpn_m4a1')) && !fresh(m4)) {
    try { await bakeM4(m4); console.log('model wpn_m4a1', mb(m4)); } catch (e) { console.log('FAILED wpn_m4a1', String(e.message || e).slice(0, 300)); }
  }
  for (const m of MODELS) {
    if (only && !only.test(m.name)) continue;
    const out = path.join(outDir, m.name + '.glb');
    if (fresh(out)) continue;
    try {
      const src = await resolveModel(m);
      const ratio = m.ratio ?? 1;
      const args = ['optimize', src, out, '--compress', 'false', '--texture-compress', 'webp', '--texture-size', String(m.tex ?? 1024), '--palette', 'false', '--instance', 'false'];
      if (ratio < 1) args.push('--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', String(m.error ?? 0.002));
      else args.push('--simplify', 'false');
      if (m.parts) args.push('--flatten', 'false', '--join', 'false');
      gt(args);
      console.log('model', m.name, mb(out));
    } catch (e) {
      console.log('FAILED', m.name, String(e.message || e).slice(0, 300));
    }
  }
}

// ---------------------------------------------------------------------------
// tiling PBR textures
// ---------------------------------------------------------------------------
/**
 * The level tints surfaces with vertex colours, so every albedo is normalised to the mean colour the
 * level was authored against: `desat` (0..1) mixes towards grey, then each channel is scaled so the
 * texture's mean sRGB value equals `target`.
 */
const TEXTURES = [
  { name: 'sand', id: 'sandy_gravel_02', size: 2048, res: '2k', desat: 0.35, target: [0.66, 0.56, 0.42] },
  { name: 'concrete', id: 'concrete_wall_008', size: 4096, res: '4k', armSize: 2048, target: [0.56, 0.55, 0.53] },
  { name: 'plaster', id: 'plastered_wall_03', size: 4096, res: '4k', armSize: 2048, desat: 0.55, target: [0.8, 0.79, 0.76] },
  { name: 'cinder', id: 'concrete_block_wall_03', size: 4096, res: '4k', armSize: 2048, desat: 0.6, target: [0.52, 0.51, 0.48] },
  { name: 'asphalt', id: 'asphalt_02', size: 2048, res: '2k', target: [0.25, 0.25, 0.245] },
  { name: 'corrugated', id: 'worn_corrugated_iron', size: 4096, res: '4k', armSize: 2048, desat: 0.4, target: [0.74, 0.73, 0.71] },
  { name: 'wood', id: 'weathered_planks', size: 2048, res: '2k', target: [0.57, 0.46, 0.34] },
  { name: 'burlap', id: 'hessian_230', size: 1024, res: '1k', desat: 0.3, target: [0.66, 0.59, 0.46] },
  { name: 'metal', id: 'blue_metal_plate', size: 1024, res: '2k', desat: 0.92, target: [0.62, 0.62, 0.61] },
  { name: 'mud', id: 'brown_mud_03', size: 2048, res: '2k', desat: 0.2, target: [0.5, 0.42, 0.33] },
  { name: 'osb', id: 'oriented_strand_board', size: 1024, res: '2k', target: [0.68, 0.56, 0.4] },
  { name: 'slab', id: 'concrete_slab_wall_02', size: 1024, res: '2k', desat: 0.5, target: [0.62, 0.61, 0.58] },
];

async function writeAlbedo(src, out, t) {
  const { data, info } = await sharp(src).resize(t.size, t.size, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const d = t.desat ?? 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = r + (l - r) * d;
    data[i + 1] = g + (l - g) * d;
    data[i + 2] = b + (l - b) * d;
    sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2];
  }
  const n = data.length / info.channels;
  const gain = t.target ? t.target.map((v, c) => (v * 255) / (sum[c] / n)) : [1, 1, 1];
  for (let i = 0; i < data.length; i += info.channels) {
    for (let c = 0; c < 3; c++) {
      // soft shoulder so brightened textures keep highlight detail instead of clipping
      let v = (data[i + c] * gain[c]) / 255;
      if (v > 0.8) v = 0.8 + (1 - Math.exp(-(v - 0.8) / 0.2)) * 0.2;
      data[i + c] = Math.round(Math.min(1, v) * 255);
    }
  }
  await sharp(data, { raw: info }).webp({ quality: 88 }).toFile(out);
}

async function textures() {
  const outDir = path.join(OUT, 'tex');
  fs.mkdirSync(outDir, { recursive: true });
  for (const t of TEXTURES) {
    if (only && !only.test(t.name)) continue;
    const outs = { diff: path.join(outDir, `${t.name}_diff.webp`), nor: path.join(outDir, `${t.name}_nor.webp`), arm: path.join(outDir, `${t.name}_arm.webp`) };
    if (fresh(outs.diff) && fresh(outs.nor) && fresh(outs.arm)) continue;
    try {
      const src = await phTexture(t.id, t.res, ['diff', 'nor', 'arm', 'rough', 'ao']);
      await writeAlbedo(src.diff, outs.diff, t);
      await sharp(src.nor).resize(t.size, t.size).webp({ quality: 90 }).toFile(outs.nor);
      const armSize = t.armSize ?? t.size;
      if (src.arm) await sharp(src.arm).resize(armSize, armSize).webp({ quality: 85 }).toFile(outs.arm);
      else {
        // build an AO/Rough/Metal pack from separate maps
        const armSize2 = t.armSize ?? t.size;
        const rough = await sharp(src.rough).resize(armSize2, armSize2).greyscale().raw().toBuffer();
        const ao = src.ao ? await sharp(src.ao).resize(armSize2, armSize2).greyscale().raw().toBuffer() : Buffer.alloc(armSize2 * armSize2, 255);
        const px = Buffer.alloc(armSize2 * armSize2 * 3);
        for (let i = 0; i < armSize2 * armSize2; i++) { px[i * 3] = ao[i]; px[i * 3 + 1] = rough[i]; px[i * 3 + 2] = 0; }
        await sharp(px, { raw: { width: armSize2, height: armSize2, channels: 3 } }).webp({ quality: 85 }).toFile(outs.arm);
      }
      console.log('texture', t.name, mb(outs.diff), mb(outs.nor), mb(outs.arm));
    } catch (e) {
      console.log('FAILED', t.name, String(e.message || e).slice(0, 300));
    }
  }
}

// ---------------------------------------------------------------------------
// 2k variants of the 4k hero textures (low/medium quality loads these)
// ---------------------------------------------------------------------------
const HERO_4K = ['concrete', 'plaster', 'cinder', 'corrugated'];

async function halfTextures() {
  const outDir = path.join(OUT, 'tex');
  for (const name of HERO_4K) {
    for (const kind of ['diff', 'nor']) {
      const src = path.join(outDir, `${name}_${kind}.webp`);
      const dst = path.join(outDir, `${name}_${kind}_2k.webp`);
      if (!fs.existsSync(src)) continue;
      if (fresh(dst)) continue;
      await sharp(src, { limitInputPixels: false }).resize(2048, 2048, { kernel: 'lanczos3' })
        .webp({ quality: kind === 'nor' ? 90 : 86 }).toFile(dst);
      console.log('2k', path.basename(dst), mb(dst));
    }
  }
}

// ---------------------------------------------------------------------------
// height maps for parallax occlusion mapping (POM)
// ---------------------------------------------------------------------------
/** Poly Haven displacement maps, baked to single-channel webp. POM only makes sense on
 *  surfaces whose relief is visible at arm's length: walls, panels, planks. */
const HEIGHTS = [
  { name: 'concrete', size: 2048 }, { name: 'plaster', size: 2048 }, { name: 'cinder', size: 2048 },
  { name: 'slab', size: 2048 }, { name: 'corrugated', size: 1024 }, { name: 'wood', size: 1024 },
  { name: 'osb', size: 1024 }, { name: 'asphalt', size: 1024 }, { name: 'mud', size: 1024 },
  { name: 'sand', size: 1024 },
];

async function heights() {
  const outDir = path.join(OUT, 'tex');
  fs.mkdirSync(outDir, { recursive: true });
  for (const h of HEIGHTS) {
    if (only && !only.test(h.name)) continue;
    const t = TEXTURES.find((x) => x.name === h.name);
    if (!t) continue;
    const out = path.join(outDir, `${h.name}_h.webp`);
    if (fresh(out)) continue;
    try {
      const src = await phTexture(t.id, '2k', ['disp']);
      const { data, info } = await sharp(src.disp, { limitInputPixels: false })
        .resize(h.size, h.size, { kernel: 'lanczos3' }).greyscale().raw()
        .toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      // 1..99 percentile stretch: seams and pitting keep their full depth without blowing out
      const hist = new Uint32Array(256);
      const n = h.size * h.size;
      for (let i = 0; i < n; i++) hist[data[i * ch]]++;
      let lo = 0, hi = 255, acc = 0;
      for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
      acc = 0;
      for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
      const span = Math.max(1, hi - lo);
      const out8 = Buffer.alloc(n);
      for (let i = 0; i < n; i++) {
        const v = ((data[i * ch] - lo) / span) * 255;
        out8[i] = Math.max(0, Math.min(255, Math.round(v)));
      }
      await sharp(out8, { raw: { width: h.size, height: h.size, channels: 1 } })
        .webp({ lossless: true }).toFile(out);
      console.log('height', h.name, mb(out));
    } catch (e) {
      console.log('HEIGHT FAILED', h.name, String(e.message || e).slice(0, 200));
    }
  }
}

// ---------------------------------------------------------------------------
// sky
// ---------------------------------------------------------------------------
const SKY = { id: 'table_mountain_2_puresky' };

/** Minimal Radiance .hdr (RLE RGBE) reader -> Float32 RGB. */
function readHdr(file) {
  const buf = fs.readFileSync(file);
  let pos = 0;
  const line = () => { let s = ''; while (buf[pos] !== 10) s += String.fromCharCode(buf[pos++]); pos++; return s; };
  let l;
  while ((l = line()) !== '') { /* header */ }
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  const h = +m[1], w = +m[2];
  const out = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[pos] !== 2 || buf[pos + 1] !== 2) throw new Error('unsupported hdr encoding');
    pos += 4;
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < w) {
        let n = buf[pos++];
        if (n > 128) { n -= 128; const v = buf[pos++]; while (n--) scan[x++ * 4 + c] = v; }
        else while (n--) scan[x++ * 4 + c] = buf[pos++];
      }
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const o = (y * w + x) * 3;
      out[o] = scan[x * 4] * f; out[o + 1] = scan[x * 4 + 1] * f; out[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { w, h, data: out };
}

async function sky() {
  const outDir = path.join(OUT, 'sky');
  fs.mkdirSync(outDir, { recursive: true });
  const outHdr = path.join(outDir, 'sky_1k.hdr');
  const outJpg = path.join(outDir, 'sky_bg.jpg');
  const outMeta = path.join(outDir, 'sky.json');
  if (fresh(outHdr) && fresh(outJpg) && fresh(outMeta)) return;
  const lo = await phHdri(SKY.id, '1k');
  const hi = await phHdri(SKY.id, '2k');
  fs.copyFileSync(lo.hdr, outHdr);
  // locate the sun: luminance-weighted centroid of the brightest texels
  const { w, h, data } = readHdr(hi.hdr);
  let max = 0;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { lum[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]; if (lum[i] > max) max = lum[i]; }
  let sx = 0, sy = 0, sz = 0, sw = 0, cr = 0, cg = 0, cb = 0;
  for (let y = 0; y < h; y++) {
    const th = ((y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (lum[i] < max * 0.25) continue;
      const ph = ((x + 0.5) / w) * Math.PI * 2;
      // three.js equirect convention: u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5 (v up)
      const a = ph - Math.PI;
      const dx = Math.sin(th) * Math.cos(a), dy = Math.cos(th), dz = Math.sin(th) * Math.sin(a);
      const wgt = lum[i] * Math.sin(th);
      sx += dx * wgt; sy += dy * wgt; sz += dz * wgt; sw += wgt;
      cr += data[i * 3] * wgt; cg += data[i * 3 + 1] * wgt; cb += data[i * 3 + 2] * wgt;
    }
  }
  const len = Math.hypot(sx, sy, sz);
  // average sky colour of the upper hemisphere excluding the sun (for the hemisphere fill light) and of the horizon band (fog)
  const avg = (y0, y1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (lum[i] > max * 0.02) continue;
      r += data[i * 3]; g += data[i * 3 + 1]; b += data[i * 3 + 2]; n++;
    }
    return [r / n, g / n, b / n].map((v) => +v.toFixed(4));
  };
  const meta = {
    id: SKY.id,
    sunDir: [sx / len, sy / len, sz / len].map((v) => +v.toFixed(5)),
    sunColor: [cr / sw, cg / sw, cb / sw].map((v) => +(v / Math.max(cr, cg, cb) * sw).toFixed(4)),
    sunPeak: +max.toFixed(1),
    zenith: avg(0.05, 0.3),
    horizon: avg(0.44, 0.495),
    /** Fraction of the equirect height (from the zenith) stored in sky_bg.jpg. */
    skyBottom: 0.53125,
  };
  fs.writeFileSync(outMeta, JSON.stringify(meta, null, 1));
  // LDR background (the shader re-expands highlights): only the part above `skyBottom` (v from the top) is kept
  const W = 6144, H = 3072, keep = Math.round(H * meta.skyBottom);
  await sharp(hi.jpg, { limitInputPixels: false }).resize(W, H, { kernel: 'lanczos3' }).extract({ left: 0, top: 0, width: W, height: keep }).jpeg({ quality: 90 }).toFile(outJpg);
  console.log('sky', JSON.stringify(meta), mb(outJpg));
}

if (section === 'all' || section === 'models') await models();
if (section === 'all' || section === 'textures') await textures();
if (section === 'all' || section === 'heights') await heights();
if (section === 'all' || section === 'half') await halfTextures();
if (section === 'all' || section === 'sky') await sky();
console.log('done');
