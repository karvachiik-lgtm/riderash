// RideRash — the roadside world, rebuilt per course.
//
// WHY THIS FILE EXISTS. User report: "the sceneries look empty and not perfect".
// Measured on the build before this module (screenshots in the scenery job's
// scratch dir, before_r{0,2,4}_*.png), from the chase camera at five points on
// three courses:
//
//   - ONE tree shape everywhere: an icosahedron lollipop on a stick, the same
//     green on the Sierra, in the Napa vineyards and in the Palm Desert.
//   - ~1 tree per 30 m per side, all inside 40 m of the kerb. Past that: a flat
//     verge to 35 m, then the beach plane at a constant y = -6.7 m. The world
//     ended at the verge.
//   - The scenery was built ONCE at load with the spine on 'sierra', so every
//     course got Sierra densities. The career switches map in __START__, after
//     the world already exists -- the desert was dressed as the mountains.
//   - No fences, signs, wires, farms, animals or roadside businesses at all.
//     Road Rash's California is defined by exactly those.
//
// WHAT IT DOES NOW.
//   1. Every prop is a coded asset in assets/*.js (404 contract, path B: three
//      independent attempts per prop, verified, picked by eye; the good losers
//      are kept as `opts.variant`). Twenty types, ~50 variants.
//   2. A THEME per biome decides species, density, buildings, animals, rock
//      tint, terrain relief and far-ridge profile. Placement walks the road
//      spine and reads the biome AT THAT DISTANCE from the WorldSpine, so a
//      course's sectors each dress themselves and transitions blend.
//   3. A terrain skirt from the verge edge (35 m) to 650 m, following the road
//      height, with per-biome relief: Sierra slopes climb 40 m, canyon walls 80,
//      the coast drops into the sea on one side, the valley rolls.
//   4. Far ridges per course: snow-capped granite, red mesas, golden hills.
//   5. Everything is chunked (160 m of road per chunk; see PERFORMANCE) and INSTANCED per
//      (chunk, prop variant, material): one draw per part per visible chunk.
//      Chunks beyond VIS_R of the camera are hidden in a scene.onBeforeRender
//      hook, which runs before three.js culls, so hidden chunks cost nothing.
//      Frustum culling handles the chunks behind the camera -- InstancedMesh
//      carries an instance-aware bounding sphere since r151.
//   6. Rebuilt when the course changes (`setCourse`), deterministic per map id.
import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, centreTangent, roadProfile, cliffDropK } from './level.js';
import { ghatBrokenAt, ghatSection, GHAT_FLOOR } from './ghatdesign.js';
const _cy = new THREE.Vector3();
// 0..1 how deep into a bridge s is (eased ~20 m at each abutment)
const cliffBridgeK = (s) => { let k = 0; for (let i = -2; i <= 2; i++) k += ghatSection(Math.max(0, s + i * 8))[2] === 2 ? 1 : 0; return k / 5; };
import { edgeAt, crossingNear, crossings } from './lanes.js';
import { BIOMES } from './worldspine.js';
import { texMaterial } from './textures.js';
import { ASSET } from '../assetlib.js';
import { enhanceTerrain, TERRAIN_ROCK } from './terrainshader.js';
import { tuftGeometry, tuftMaterial, GRASS_TIME } from './groundcover.js';

// --------------------------------------------------------------------------
// The kit: asset -> number of variants it publishes (see each file's header).
// Buildings take the procedural surfaces (plaster/timber/stone read as flat
// colour otherwise); vegetation stays flat-shaded -- its facets ARE the detail,
// and a texture lookup per leaf fragment across 4,000 trees buys nothing at
// 50 m/s.
// --------------------------------------------------------------------------
const KIT_SPEC = {
  tree_pine: 2, tree_redwood: 2, tree_oak: 2, tree_palm: 2, cactus_saguaro: 1, joshua_tree: 1,
  shrub: 2, rock: 2, fence: 2, utility_pole: 3, road_sign: 5, mailbox: 2,
  barn: 2, farmhouse: 2, gas_station: 3, diner: 2, billboard: 6, cow: 3, horse: 3, storefront: 4,
};
const SURFACED = new Set(['barn', 'farmhouse', 'gas_station', 'diner', 'storefront']);

// PERFORMANCE (perf job, measured in headless SwiftShader at 1280x720, which is
// also the stand-in for a low-end phone): the sierra start frame drew 0.97 M
// triangles in 637 calls, 0.72 M of them scenery -- 2,964 pine parts at
// 150-430 tris a tree, 2,021 shrub parts, 1,055 redwood parts, most of them
// hundreds of metres away where a tree is 20-40 px tall. Shrinking the frame
// to 160x90 barely changed the render time, so this is VERTEX-bound, not
// fill-bound: the cure is fewer triangles, not fewer pixels. Hence:
//   - chunks of 160 m (was 320) so the cull and the LOD switch are finer;
//   - every prop is filed NEAR (|lat| < FAR_LAT) or FAR band; the far band and
//     every chunk beyond `nearR` draw a code-built LOD (a pine is two 6-sided
//     cones and a 4-sided trunk: 20 tris) or, for props under ~2 m that are a
//     few pixels out there, nothing at all;
//   - a quality tier (setQuality) scales draw distance, LOD distance and the
//     density of the small stuff.
const CHUNK = 160;          // metres of road per chunk
const VIS_R = 1250;         // fog at 0.0004 exp2 is ~22% at 1250 m; a 12 m pine there is ~9 px
const FAR_LAT = 80;         // props further than this from the centreline always draw as LOD
// Per tier: draw distance, full-detail distance, density of small props.
export const SCENERY_TIERS = {
  high:   { visR: VIS_R, nearR: 300, density: 1.0,  grass: 1.0 },
  medium: { visR: 950,   nearR: 220, density: 0.75, grass: 0.45 },
  low:    { visR: 700,   nearR: 150, density: 0.5,  grass: 0 },       // mobile: no grass at all
};
const PRE = 800;            // dress this far BEHIND the start line (matches the road's 800 m)
const T0 = 34.5;            // terrain inner edge: the level's verge ends at 35.5 m (level.js)
const KERB = CFG.ROAD_W / 2 + CFG.KERB_W;   // 6.3 m: nothing may stand inside this
// Lateral columns of the terrain skirt. Dense near the road where the relief
// is read, sparse where fog does the work. The last column drops below the
// level's beach plane (y = -6.7) so its outer edge never shows as a lip.
const TCOLS = [34.5, 40, 48, 60, 76, 98, 128, 170, 225, 300, 400, 520, 650];

// --------------------------------------------------------------------------
// THEMES. One per biome in worldspine.BIOMES. Numbers are per side unless noted.
//   trees    weighted species list [kitKey, weight]
//   near     probability of a tree per 6 m slot in the 10-45 m band
//   far      trees per 100 m of road in the 45-farMax band (clustered)
//   ground   far/high terrain colour (near colour is the biome's verge tint)
//   terrain  ampL/ampR relief in metres at ~200 m out (negative = drops away)
//   ridge    far mountains: colour, height range, snow, mesa (flat-topped)
// --------------------------------------------------------------------------
const THEMES = {
  sierra: {
    trees: [['tree_pine:0', 6], ['tree_pine:1', 3], ['tree_redwood:1', 0.6], ['tree_oak:1', 0.5]],
    near: 0.42, far: 30, farMax: 300, shrubs: 0.8, shrubKeys: [['shrub:0', 2], ['shrub:1', 1]],
    rocks: 0.35, rockTint: [1.0, 1.0, 1.04], boulder: [0.6, 2.2],
    fence: ['fence:1', 0.3], pole: 0, farms: 0.6, biz: 0.15, billboards: 0.4, animals: ['horse', 0.5], vines: 0,
    ground: 0x55653f, terrain: { ampL: 42, ampR: 34, bump: 3 },
    ridge: { col: 0x6e7888, h: [260, 620], snow: true, mesa: false },
  },
  forest: {
    trees: [['tree_redwood:0', 5], ['tree_redwood:1', 2], ['tree_pine:1', 2], ['tree_pine:0', 1]],
    near: 0.7, far: 55, farMax: 320, shrubs: 1.3, shrubKeys: [['shrub:0', 3], ['shrub:1', 1]],
    rocks: 0.12, rockTint: [0.85, 0.92, 0.85], boulder: [0.5, 1.5],
    fence: null, pole: 0, farms: 0.15, biz: 0.1, billboards: 0.15, animals: null, vines: 0,
    ground: 0x2f4526, terrain: { ampL: 30, ampR: 26, bump: 4 },
    ridge: { col: 0x3f5244, h: [200, 420], snow: false, mesa: false },
  },
  coast: {
    trees: [['tree_oak:1', 4], ['tree_palm:0', 2], ['tree_pine:0', 1], ['tree_palm:1', 1]],
    near: 0.22, far: 12, farMax: 220, shrubs: 1.0, shrubKeys: [['shrub:1', 3], ['shrub:0', 1]],
    rocks: 0.25, rockTint: [0.95, 0.93, 0.9], boulder: [0.8, 2.6],
    fence: ['fence:0', 0.35], pole: 0, farms: 0.5, biz: 0.5, billboards: 0.9, animals: ['cow', 0.4], vines: 0,
    ground: 0x7a7a4a, terrain: { ampL: -34, ampR: 26, bump: 2 },   // the Pacific is on the left
    ridge: { col: 0x5c6a66, h: [140, 320], snow: false, mesa: false },
  },
  scrub: {
    trees: [['joshua_tree:0', 4], ['tree_oak:1', 1], ['cactus_saguaro:0', 1]],
    near: 0.2, far: 10, farMax: 260, shrubs: 1.6, shrubKeys: [['shrub:1', 3], ['shrub:0', 1]],
    rocks: 0.5, rockTint: [1.02, 0.9, 0.78], boulder: [0.6, 2.4],
    fence: ['fence:1', 0.4], pole: 2, farms: 0.2, biz: 0.6, billboards: 1.2, animals: ['cow', 0.3], vines: 0,
    ground: 0x8c7a4a, terrain: { ampL: 14, ampR: 10, bump: 3 },
    ridge: { col: 0x8a7a66, h: [160, 360], snow: false, mesa: false },
  },
  town: {
    trees: [['tree_oak:1', 3], ['tree_palm:0', 2], ['tree_palm:1', 1]],
    near: 0.12, far: 6, farMax: 200, shrubs: 0.5, shrubKeys: [['shrub:0', 1]],
    rocks: 0.02, rockTint: [1, 1, 1], boulder: [0.4, 0.9],
    fence: null, pole: 0, farms: 0, biz: 0, billboards: 1.6, animals: null, vines: 0, street: true,
    ground: 0x5f6a4a, terrain: { ampL: 6, ampR: 6, bump: 1 },
    ridge: { col: 0x6a7280, h: [140, 300], snow: false, mesa: false },
  },
  // the ghat: the terrain here is the cliff itself (see reliefAt's cliff mode);
  // trees cling to the wall side, nothing stands on the drop side
  ghat: {
    trees: [['tree_oak:1', 3], ['tree_pine:1', 2], ['tree_redwood:1', 1]],
    near: 0.5, far: 36, farMax: 300, shrubs: 1.4, shrubKeys: [['shrub:0', 3], ['shrub:1', 1]],
    rocks: 0.9, rockTint: [0.82, 0.62, 0.52], boulder: [0.8, 3.2],
    fence: null, pole: 0, farms: 0, biz: 0, billboards: 0.05, animals: null, vines: 0.3,
    ground: 0x4f6a3a, terrain: { ampL: 60, ampR: 60, bump: 5, steep: true },
    ridge: { col: 0x5f7a6a, h: [300, 700], snow: false, mesa: false },
  },
  canyon: {
    trees: [['cactus_saguaro:0', 2], ['joshua_tree:0', 1]],
    near: 0.1, far: 5, farMax: 200, shrubs: 0.8, shrubKeys: [['shrub:1', 1]],
    rocks: 1.2, rockTint: [0.78, 0.5, 0.4], boulder: [1.0, 4.5],
    fence: null, pole: 2, farms: 0, biz: 0.2, billboards: 0.4, animals: null, vines: 0,
    ground: 0x9a5a36, terrain: { ampL: 80, ampR: 70, bump: 8, steep: true },
    ridge: { col: 0x9a5a3e, h: [200, 420], snow: false, mesa: true },
  },
  night: {
    trees: [['tree_oak:1', 2], ['tree_palm:0', 2]],
    near: 0.14, far: 8, farMax: 200, shrubs: 0.5, shrubKeys: [['shrub:0', 1]],
    rocks: 0.05, rockTint: [0.9, 0.9, 1], boulder: [0.5, 1.2],
    fence: null, pole: 1, farms: 0, biz: 0.3, billboards: 1.8, animals: null, vines: 0, street: true,
    ground: 0x2a3a4a, terrain: { ampL: 12, ampR: 10, bump: 2 },
    ridge: { col: 0x2e3848, h: [160, 320], snow: false, mesa: false },
  },
  valley: {
    trees: [['tree_oak:0', 6], ['tree_oak:1', 2], ['tree_palm:1', 0.4], ['tree_pine:0', 0.4]],
    near: 0.2, far: 12, farMax: 260, shrubs: 0.8, shrubKeys: [['shrub:1', 2], ['shrub:0', 1]],
    rocks: 0.08, rockTint: [1.05, 1.0, 0.92], boulder: [0.5, 1.4],
    fence: ['fence:0', 0.7], pole: 1, farms: 1.3, biz: 0.35, billboards: 0.8, animals: ['cow', 1.4], vines: 0.6,
    ground: 0x8a8a44, terrain: { ampL: 16, ampR: 22, bump: 5 },
    ridge: { col: 0x8a8660, h: [150, 330], snow: false, mesa: false },
  },
  desert: {
    trees: [['cactus_saguaro:0', 5], ['joshua_tree:0', 3], ['tree_palm:1', 0.5]],
    near: 0.2, far: 9, farMax: 280, shrubs: 1.2, shrubKeys: [['shrub:1', 3], ['shrub:0', 1]],
    rocks: 0.7, rockTint: [0.86, 0.62, 0.5], boulder: [0.6, 3.0],
    fence: ['fence:1', 0.25], pole: 2, farms: 0.1, biz: 0.8, billboards: 1.4, animals: null, vines: 0,
    ground: 0xa88a52, terrain: { ampL: 8, ampR: 12, bump: 3 },
    ridge: { col: 0xa06a48, h: [180, 400], snow: false, mesa: true },
  },
};

// Deterministic PRNG (mulberry32): same map id, same world, every machine.
function prng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pickW = (list, r) => { let tot = 0; for (const [, w] of list) tot += w; let x = r * tot; for (const [k, w] of list) { x -= w; if (x <= 0) return k; } return list[list.length - 1][0]; };
// MEMORY: a per-course buffer (terrain skirt, instance matrices and colours)
// is read once, when it is uploaded to the GPU, and never again -- nothing
// raycasts the scenery and its bounds are computed at build. Keeping the JS
// copy doubled its cost; drop it on upload. (NOT for shared kit geometry.)
function freeAfterUpload(attr) {
  if (!attr || !attr.onUpload) return;
  attr.onUpload(function () { this.array = null; });
}
// seeded 2D value noise (0..1), for terrain displacement
const _vh = (x, y) => { let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = _vh(ix, iy), b = _vh(ix + 1, iy), c = _vh(ix, iy + 1), d = _vh(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// --------------------------------------------------------------------------
// Kit loading. Each asset variant is loaded once through ASSET (which merges it
// by material and grounds it), then flattened to [{geo, mat}] parts with the
// wrapper transform baked in, ready to instance.
// --------------------------------------------------------------------------
export async function loadSceneryKit() {
  const kit = new Map();
  const jobs = [];
  for (const [name, n] of Object.entries(KIT_SPEC)) {
    for (let v = 0; v < n; v++) {
      jobs.push((async () => {
        const root = await ASSET(`assets/${name}.js`, { variant: v, surfaces: SURFACED.has(name) });
        root.updateMatrixWorld(true);
        const parts = [];
        const box = new THREE.Box3();
        root.traverse((o) => {
          if (!o.isMesh) return;
          const geo = o.geometry.clone();
          geo.applyMatrix4(o.matrixWorld);
          geo.computeBoundingBox(); geo.computeBoundingSphere();
          box.union(geo.boundingBox);
          parts.push({ geo, mat: o.material });
        });
        const lodKind = LOD_KIND[name];
        kit.set(`${name}:${v}`, { parts, size: box.getSize(new THREE.Vector3()), lodKind, lod: lodKind && lodKind !== 'full' ? buildLod(lodKind, parts) : null });
      })());
    }
  }
  await Promise.all(jobs);
  return kit;
}

// --------------------------------------------------------------------------
// LOD. What each prop becomes past the full-detail distance:
//   'full'  keep the real thing (buildings, billboards: few, large, and the
//           eye checks them; they are ~100-2000 tris and a handful per chunk)
//   kind    a code-built stand-in fitted to the real parts' bounding boxes,
//           in the real parts' colours (baked as vertex colour, so one draw)
//   absent  not drawn at all (shrubs, fences, signs, animals, mailboxes: all
//           under ~2 m, i.e. 2-4 px tall at 300 m)
// --------------------------------------------------------------------------
const LOD_KIND = {
  tree_pine: 'cone2', tree_redwood: 'cone2', tree_oak: 'ball', joshua_tree: 'ball', tree_palm: 'palm',
  cactus_saguaro: 'column', rock: 'rock', utility_pole: 'pole',
  barn: 'full', farmhouse: 'full', gas_station: 'full', diner: 'full', storefront: 'full', billboard: 'full',
};
function buildLod(kind, parts) {
  // Group the parts' boxes by role; the colour of each role is the colour of
  // its biggest part (averaging a palm's green fronds with its brown dead ones
  // gives mud).
  const role = (m) => (m.name === 'timber' ? 'trunk' : m.name === 'foliage' ? 'leaf' : m.name === 'stone' ? 'stone' : 'other');
  const R = {};
  for (const p of parts) {
    const k = role(p.mat); const n = p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    const r = R[k] || (R[k] = { box: new THREE.Box3(), col: p.mat.color.clone(), n: 0 });
    r.box.union(p.geo.boundingBox);
    if (n > r.n) { r.n = n; r.col.copy(p.mat.color); }
  }
  const all = new THREE.Box3(); for (const k in R) all.union(R[k].box);
  const pieces = [];
  const add = (geo, col) => { const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv'); const n = g.attributes.position.count; const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); pieces.push(g); };
  const cyl = (rt, rb, y0, y1, seg, x = 0, z = 0) => { const g = new THREE.CylinderGeometry(rt, rb, y1 - y0, seg, 1, true); g.translate(x, (y0 + y1) / 2, z); return g; };
  const blob = (box, geo) => { const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()); geo.scale(s.x / 2, s.y / 2, s.z / 2); geo.translate(c.x, c.y, c.z); return geo; };
  const leaf = R.leaf || R.other || R.trunk || R.stone;
  const trunkCol = (R.trunk || leaf).col;
  const lb = leaf.box, ls = lb.getSize(new THREE.Vector3()), lc = lb.getCenter(new THREE.Vector3());
  const trunkTop = (top) => { const tb = R.trunk ? R.trunk.box : all; return Math.min(tb.max.y, top); };
  if (kind === 'cone2') {
    // two stacked open cones over a 4-sided trunk: the pine silhouette in 20 tris
    const r = Math.max(ls.x, ls.z) * 0.46, y0 = Math.max(lb.min.y, 0.5), h = lb.max.y - y0;
    add(cyl(0.12, 0.38, 0, trunkTop(y0 + h * 0.5), 4), trunkCol);
    add(cyl(0, r, y0, y0 + h * 0.62, 6, lc.x, lc.z), leaf.col);
    add(cyl(0, r * 0.66, y0 + h * 0.38, lb.max.y, 6, lc.x, lc.z), leaf.col);
  } else if (kind === 'ball') {
    add(cyl(0.18, 0.3, 0, trunkTop(lb.min.y + ls.y * 0.35), 4), trunkCol);
    add(blob(lb, new THREE.IcosahedronGeometry(1, 0)), leaf.col);
  } else if (kind === 'palm') {
    add(cyl(0.16, 0.24, 0, lb.min.y + ls.y * 0.5, 4, lc.x, lc.z), trunkCol);
    const crown = lb.clone(); crown.min.y = lb.min.y + ls.y * 0.35;
    add(blob(crown, new THREE.OctahedronGeometry(1, 0)), leaf.col);
  } else if (kind === 'column') {
    const s = all.getSize(new THREE.Vector3());
    add(cyl(Math.min(s.x, s.z) * 0.3, Math.min(s.x, s.z) * 0.34, 0, all.max.y, 6), leaf.col);
    add(cyl(s.x * 0.12, s.x * 0.12, all.max.y * 0.45, all.max.y * 0.75, 4, s.x * 0.36, 0), leaf.col);   // one arm
  } else if (kind === 'rock') {
    add(blob(all, new THREE.IcosahedronGeometry(1, 0)), (R.stone || leaf).col);
  } else if (kind === 'pole') {
    const s = all.getSize(new THREE.Vector3());
    const p = new THREE.BoxGeometry(0.3, all.max.y, 0.3); p.translate(0, all.max.y / 2, 0); add(p, trunkCol);
    const a = new THREE.BoxGeometry(s.x, 0.18, 0.18); a.translate(0, all.max.y - 0.9, 0); add(a, trunkCol);
  }
  const geo = mergeSimple(pieces);
  geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}
// Concatenate non-indexed position/normal/color geometries (no addon import
// needed for three attributes).
function mergeSimple(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const a of ['position', 'color']) {
    const arr = new Float32Array(n * 3); let o = 0;
    for (const g of list) { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; }
    out.setAttribute(a, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

// --------------------------------------------------------------------------
// The world for one course.
// --------------------------------------------------------------------------
export class Scenery {
  constructor(scene, camera, kit) {
    this.scene = scene; this.camera = camera; this.kit = kit;
    this.root = new THREE.Group(); this.root.name = 'scenery';
    scene.add(this.root);
    this.chunks = [];
    this.mapKey = null;
    // Shared, course-independent materials.
    this.terrainMat = texMaterial('dry_scrub', { repeat: 1, color: 0xffffff, roughness: 0.97, metalness: 0.0 });
    this.terrainMat.vertexColors = true;
    this.terrainMat.name = 'ground';
    this.ridgeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0, flatShading: false });
    this.ridgeMat.name = 'stone';
    this.ridgeMat.side = THREE.DoubleSide;         // (both flanks of a ridge can face the road)
    // procedural detail per pixel (terrainshader.js): noise, rock on the steep,
    // strata, bump -- the skirt is big triangles, this is what makes it ground
    enhanceTerrain(this.terrainMat, { bump: 1.0 });
    enhanceTerrain(this.ridgeMat, { bump: 2.2, detail: 0.8, strata: 0.25, rockAmt: 0.55 });
    this.wireMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.6, metalness: 0.4 });
    this.wireMat.name = 'metal';
    this.vineMat = new THREE.MeshStandardMaterial({ color: 0x4a5e2c, roughness: 0.95, metalness: 0, flatShading: true });
    this.vineMat.name = 'foliage';
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    // One material for every LOD stand-in: its colours are baked per vertex
    // and tinted per instance, so a far chunk is one draw per prop variant.
    this.lodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true });
    this.lodMat.name = 'foliage';
    this.tier = SCENERY_TIERS.high;
    // Chunk visibility runs BEFORE three.js culls (scene.onBeforeRender fires
    // at the top of renderer.render), so a hidden chunk is never even tested.
    // Chained, so whatever else hooks the scene keeps working. Only the game
    // camera drives it: the sky's env capture renders the scene with its own
    // cube camera and must not hide the world from the player's view.
    const prev = scene.onBeforeRender;
    const self = this;
    scene.onBeforeRender = function (r, s, cam, ...rest) {
      if (cam === self.camera) { self._cull(cam.position); GRASS_TIME.value = performance.now() / 1000; }
      if (prev) prev.call(this, r, s, cam, ...rest);
    };
  }

  /** Rebuild for the spine's current map (no-op if it is already dressed). */
  setCourse(spine) {
    const key = `${spine.mapId}|${spine.lenMul || 1}|${this.tier.density}|${this.tier.grass}`;
    if (key === this.mapKey) return;
    this.mapKey = key;
    this.spine = spine;
    const TR = TERRAIN_ROCK[spine.mapId] || TERRAIN_ROCK.valley;
    for (const m of [this.terrainMat, this.ridgeMat]) {
      const U = m.userData.terrainUniforms;
      if (U) { U.uRock.value.setHex(TR.rock); U.uDirt.value.setHex(TR.dirt); }
    }
    const t0 = performance.now();
    this._clear();
    this._build(spine);
    this.buildMs = performance.now() - t0;
    console.log(`[scenery] ${spine.mapId}: ${this.stats.instances} props, ${this.chunks.length} chunks, ${this.stats.meshes} meshes, built in ${this.buildMs.toFixed(0)} ms`);
  }

  _clear() {
    for (const c of this.chunks) {
      this.root.remove(c.group);
      c.group.traverse((o) => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    }
    this.chunks = [];
    if (this.ridges) { this.root.remove(this.ridges); this.ridges.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); this.ridges = null; }
  }

  /** Quality tier (SCENERY_TIERS key). Distances apply next frame; a density
   *  change re-dresses the current course (~50-100 ms) unless `rebuild` is
   *  false, in which case it waits for the next setCourse. */
  setQuality(name, rebuild = true) {
    const t = SCENERY_TIERS[name] || SCENERY_TIERS.high;
    if (t === this.tier) return;
    this.tier = t;
    // Mid-race (the adaptive stepper) only the distances change; the density
    // is picked up by the next setCourse, so a struggling device never takes
    // a 100 ms rebuild hitch in the middle of a pack.
    if (rebuild && this.spine) this.setCourse(this.spine);
  }

  // Distance from the camera to the chunk's nearest edge (along its centre
  // chord; chunks are 160 m, the road bends gently): hidden past visR, LOD
  // past nearR, full detail inside.
  _cull(p) {
    const { visR, nearR } = this.tier;
    for (const c of this.chunks) {
      const dx = c.centre.x - p.x, dz = c.centre.z - p.z;
      const d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - CHUNK / 2);
      // The terrain skirt is cheap (~1.3 k tris a chunk) and a hole in it
      // shows the beach plane, so it keeps the full distance on every tier;
      // only the props shrink back.
      c.group.visible = d < VIS_R;
      const vis = d < visR;
      c.props.visible = vis;
      if (!vis) continue;
      const near = d < nearR;
      c.near.visible = near;
      c.far.visible = !near;
    }
  }

  // ------------------------------------------------------------------------
  _build(spine) {
    const rnd = prng(hashStr(spine.mapId) ^ 0x9e3779b9);
    // Dress THIS course to its finish (plus the look-ahead), not the whole
    // physical road: the road is sized to the longest race in the career, and
    // dressing 20 km for the 4.8 km opener would be four times the props.
    const roadEnd = Math.min(CFG.ROAD_SEGS * CFG.SEG,
      (spine.totalLength || CFG.ROAD_SEGS * CFG.SEG) + (CFG.ROAD_PAST_FINISH || 500));
    const sEnd = roadEnd + 60;
    const nChunks = Math.ceil((sEnd + PRE) / CHUNK);
    const buckets = [];                                    // per chunk: Map key -> {m:[], c:[]}
    for (let i = 0; i < nChunks; i++) buckets.push(new Map());
    const stats = { instances: 0, meshes: 0 };

    // Theme blend at distance s: the spine's biome weights, so a treeline thins
    // over the same 170 m the road surface and fog blend over.
    const themeAt = (s) => {
      const st = spine.stateAt(Math.max(0, Math.min(spine.totalLength - 1, s)));
      const [p, c, n] = st.biomes.map((l) => Object.keys(BIOMES).find((k) => BIOMES[k].label === l) || 'sierra');
      return { cur: THEMES[c] || THEMES.sierra, prev: THEMES[p] || THEMES.sierra, next: THEMES[n] || THEMES.sierra, wp: st.blend.prev, wn: st.blend.next, verge: st.vergeTint, curKey: c };
    };
    // Stochastic blend for categorical choices: pick the neighbour's theme
    // with probability equal to its blend weight.
    const themeFor = (tb, r) => (r < tb.wp ? tb.prev : r < tb.wp + tb.wn ? tb.next : tb.cur);
    const mixNum = (tb, f) => f(tb.cur) * (1 - tb.wp - tb.wn) + f(tb.prev) * tb.wp + f(tb.next) * tb.wn;

    // Terrain relief relative to the road deck at this z. Analytic, so props
    // beyond the verge can be seated on exactly the surface the skirt draws.
    // A CLIFF COURSE (level.js road profile): the terrain starts at the
    // shoulder, not 35 m out -- it IS the cliff face on one side and the rock
    // wall on the other. Scenery lat + is the rider's LEFT, the profile's
    // cliff.side + is the rider's RIGHT.
    const CL = roadProfile().cliff;
    const CT0 = CL ? edgeAt(0, 1) + CFG.KERB_W + 2.2 : T0;
    // Which side drops changes along the course (ghatdesign.js): the terrain
    // morphs between the drop and the wall through each change (cliffDropK),
    // and where a lane has collapsed the drop starts at the broken edge.
    const riderSide = (lat) => -(Math.sign(lat) || 1);           // scenery lat + = rider's LEFT
    const isDrop = (s, lat) => CL && cliffDropK(s, riderSide(lat)) > 0.5;
    const cliffRelief = (s, lat) => {
      const a = Math.abs(lat);
      if (a < CT0) return 0;
      // the innermost column (a = CT0) stays at the deck -- except where there is
      // no ground there at all: under a bridge, and past a collapsed lane
      if (a === CT0 && !(cliffBridgeK(s) > 0 || ghatBrokenAt(Math.max(0, s), riderSide(lat)))) return 0;
      const ph = lat > 0 ? 1.7 : 4.1;
      const n = Math.sin(s * 0.0093 + a * 0.011 + ph) * 0.5 + Math.sin(s * 0.023 - a * 0.031 + ph * 2) * 0.3 + Math.sin(s * 0.0041 + ph * 3) * 0.4;
      const ledge = Math.sin(s * 0.061 + a * 0.4) * 0.8 + Math.sin(s * 0.17) * 0.5;       // broken rock, not a smooth fillet
      const k = cliffDropK(s, riderSide(lat));
      let hd = 0, hw = 0;
      if (k > 0) {
        // sheer within ~16 m, then the scree runs out to the valley floor --
        // from the broken edge itself where the lane has gone
        // (a bridge: the gorge is already below the deck edge -- nothing holds the road up but the piers)
        const bridgeK = cliffBridgeK(s);
        const c0 = bridgeK > 0 ? CT0 - 24 * bridgeK : ghatBrokenAt(Math.max(0, s), riderSide(lat)) ? Math.min(CT0, edgeAt(Math.max(0, s), riderSide(lat)) + CFG.KERB_W + 0.2) : CT0;
        // ...down to the valley floor, which is FLAT and one height for the
        // whole course (valley.js lays the river and the paddies on it)
        const u = Math.pow(smooth(c0, c0 + 16, a), 0.5);
        const floor = GHAT_FLOOR - centreAt(-s, _cy).y + 0.5 * n * smooth(CT0 + 60, CT0 + 140, a);
        hd = floor * u + ledge * (1 - u) * 2;
      }
      // the wall: up at once, then the mountainside keeps climbing
      // ...and a MOUNTAINSIDE beyond it, not a plateau: it keeps climbing out to
      // the skirt's edge, carved by ridged noise into spurs and gullies
      if (k < 1) {
        let rn = 0, amp = 0.5, fr = 1;
        for (let o = 0; o < 3; o++) { rn += amp * (1 - Math.abs(2 * vnoise2(s * 0.004 * fr + o * 7.1, a * 0.006 * fr + o * 3.3) - 1)); fr *= 2.2; amp *= 0.5; }
        hw = CL.wall * Math.pow(smooth(CT0, CT0 + 7, a), 0.6) * (0.85 + 0.25 * n) + 90 * smooth(CT0 + 15, 260, a)
           + 260 * smooth(120, 650, a) * (0.35 + 0.8 * rn) + 40 * rn * smooth(CT0 + 20, 120, a) + ledge * 1.5;
      }
      return hd * k + hw * (1 - k);
    };
    const reliefAt = (s, lat, tb) => {
      if (CL) return cliffRelief(s, lat);
      const a = Math.abs(lat);
      if (a <= T0) return 0;
      const L = lat > 0;
      const amp = mixNum(tb, (t) => (L ? t.terrain.ampL : t.terrain.ampR));
      const bump = mixNum(tb, (t) => t.terrain.bump);
      const steep = mixNum(tb, (t) => (t.terrain.steep ? 1 : 0));
      const span = 220 - steep * 140;                     // canyon walls rise within 80 m
      const u = Math.pow(smooth(T0, T0 + span, a), 1.3);
      const ph = L ? 1.7 : 4.1;
      const n = Math.sin(s * 0.0093 + a * 0.011 + ph) * 0.5 + Math.sin(s * 0.023 - a * 0.031 + ph * 2) * 0.3 + Math.sin(s * 0.0041 + ph * 3) * 0.4;
      let h = amp * u * (0.72 + 0.38 * n);
      h += bump * smooth(T0, T0 + 30, a) * (Math.sin(s * 0.051 + a * 0.13 + ph) * 0.6 + Math.sin(s * 0.13 - a * 0.07) * 0.4);
      if (a > 560) h = Math.min(h, -10);                   // tuck the outer lip under the beach plane
      // a crossroads runs out through a flat cutting, not into a hillside
      let cw = 0;
      for (const cs of crossings()) cw = Math.max(cw, 1 - smooth(8, 45, Math.abs(s - cs)));
      return h * (1 - cw);
    };
    this.reliefAt = reliefAt;

    const _c = new THREE.Vector3(), _t = new THREE.Vector3();
    const frame = (s) => { centreAt(-s, _c); centreTangent(-s, _t); return { cx: _c.x, cy: _c.y, cz: _c.z, tx: _t.x, tz: _t.z, nx: -_t.z, nz: _t.x }; };
    // FAR FIELD, CLIFF COURSES: the ghat's swirls are ~32 m in radius, and an
    // offset of the road's own frame further out than that on the inside of a
    // bend FOLDS BACK over the road (MEASURED: a wall-side slab of terrain
    // standing beside a bridge 60 m away). So beyond ~12 m everything is laid
    // along a SMOOTHED copy of the road (a +/-120 m moving average), blending
    // into it by 45 m -- the near field still hugs every bend, the far field
    // cannot fold. Terrain and props both go through placeXZ, so they agree.
    let SMF = null;
    if (CL) {
      const ST = 4, HW = 30, s0 = -PRE - 200, n = Math.ceil((sEnd + 400 - s0) / ST);
      const cx = new Float64Array(n), cz = new Float64Array(n);
      for (let i = 0; i < n; i++) { centreAt(-(s0 + i * ST), _c); cx[i] = _c.x; cz[i] = _c.z; }
      const mx = new Float64Array(n), mz = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let ax = 0, az = 0, k = 0;
        for (let j = Math.max(0, i - HW); j <= Math.min(n - 1, i + HW); j++) { ax += cx[j]; az += cz[j]; k++; }
        mx[i] = ax / k; mz[i] = az / k;
      }
      SMF = { s0, ST, n, mx, mz };
    }
    const _sm = { x: 0, z: 0, nx: 0, nz: 0 };
    const smoothAt = (s) => {
      const u = Math.max(0, Math.min(SMF.n - 2.001, (s - SMF.s0) / SMF.ST)), i = Math.floor(u), t = u - i;
      _sm.x = SMF.mx[i] + (SMF.mx[i + 1] - SMF.mx[i]) * t; _sm.z = SMF.mz[i] + (SMF.mz[i + 1] - SMF.mz[i]) * t;
      // geometric tangent (+z = decreasing s), normal as frame() builds it
      const a = Math.max(0, i - 2), b = Math.min(SMF.n - 1, i + 3);
      let tx = SMF.mx[a] - SMF.mx[b], tz = SMF.mz[a] - SMF.mz[b];
      const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      _sm.nx = -tz; _sm.nz = tx;
      return _sm;
    };
    // DISPLACEMENT (seeded value-noise fBm in world space): the skirt was smooth
    // between its rows and columns. Out in the fields a rolling bump; on a cliff
    // course's faces buttresses and gullies -- the face is pushed in and out
    // ALONG the road normal, so a 150 m drop is not one flat sheet. Zero at the
    // inner column: the road edge never moves. Props use it too (groundY, put).
    const _D = { dh: 0, dl: 0 };
    const disp = (x, z, a) => {
      _D.dh = 0; _D.dl = 0;
      const wn = vnoise2(x * 0.045, z * 0.045) * 0.65 + vnoise2(x * 0.13, z * 0.13) * 0.35;
      if (CL) {
        const face = smooth(CT0 + 1.2, CT0 + 6, a) * (1 - smooth(CT0 + 40, CT0 + 90, a));
        _D.dl = (wn - 0.5) * 11 * face;
        _D.dh = (vnoise2(x * 0.08 + 9, z * 0.08) - 0.5) * 6 * smooth(CT0 + 1.2, CT0 + 12, a);
      } else {
        _D.dh = (wn - 0.5) * 5 * smooth(T0 + 2, T0 + 40, a);
      }
      return _D;
    };
    const _xz = { x: 0, z: 0 };
    const placeXZ = (s, lat, f) => {
      _xz.x = f.cx + f.nx * lat; _xz.z = f.cz + f.nz * lat;
      if (SMF) {
        const w = smooth(12, 45, Math.abs(lat));
        if (w > 0) { const g = smoothAt(s); _xz.x += (g.x + g.nx * lat - _xz.x) * w; _xz.z += (g.z + g.nz * lat - _xz.z) * w; }
      }
      return _xz;
    };
    const groundY = (s, lat, tb, f) => {
      if (Math.abs(lat) <= CT0) return f.cy - 0.06;
      const xz = placeXZ(s, lat, f);
      return f.cy - 0.06 + reliefAt(s, lat, tb) - 0.04 + disp(xz.x, xz.z, Math.abs(lat)).dh;
    };

    // Occupancy: building footprints, so trees do not grow through barns.
    const reserved = [];
    const isFree = (s, lat, pad = 0) => { for (const r of reserved) if (s > r.s0 - pad && s < r.s1 + pad && lat > r.l0 - pad && lat < r.l1 + pad) return false; return true; };

    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _sc = new THREE.Vector3(), _e = new THREE.Euler();
    const chunkOf = (s) => Math.max(0, Math.min(nChunks - 1, Math.floor((s + PRE) / CHUNK)));
    const thin = prng(hashStr(spine.mapId) ^ 0x51ed27);
    const density = this.tier.density;
    // exponent per kind: shrubs and rocks take the full cut, trees half of it
    const THIN = { shrub: 1, rock: 1, tree_pine: 0.5, tree_redwood: 0.5, tree_oak: 0.5, tree_palm: 0.5, joshua_tree: 0.5, cactus_saguaro: 0.5 };
    // WIDER ROADS PUSH THE SCENERY OUT (lanes.js). Everything below is laid out
    // relative to the one-lane kerb; `widen` moves a lateral out by however
    // much the road is wider there, so a four-lane stretch is not lined with
    // trees standing in its outer lanes.
    const widen = (s, lat) => {
      const side = lat >= 0 ? 1 : -1;
      // (this frame's normal is the rider's LEFT: see traffic.js on the sign)
      return lat + side * (edgeAt(Math.max(0, s), -side) - CFG.ROAD_W / 2);
    };
    const put = (key, s, lat, o = {}) => {
      if (!this.kit.has(key)) return;
      if (!o.raw) lat = widen(s, lat);
      // the cross road at a crossroads stays clear for its length
      if (Math.abs(lat) < 230 && crossingNear(s, 24)) return;
      if (Math.abs(lat) < KERB + 2.2 && !o.allowNear) return;    // never on the road or shoulder
      if (isDrop(s, lat)) return;                                   // nothing stands over the drop
      const tb = o.tb || themeAt(s);
      const f = frame(s);
      const y = (o.y !== undefined ? o.y : groundY(s, lat, tb, f)) - (o.sink || 0);
      const xz = placeXZ(s, lat, f);
      _p.set(xz.x, y, xz.z);
      _e.set(o.tilt || 0, o.yaw || 0, o.roll || 0, 'YXZ'); _q.setFromEuler(_e);
      const sc = o.scale || 1; _sc.set(sc * (o.sx || 1), sc * (o.sy || 1), sc * (o.sz || 1));
      _m.compose(_p, _q, _sc);
      // Quality thinning, from its own stream so the layout of everything
      // that survives is identical on every tier.
      const th = thin();
      if (THIN[key.split(':')[0]] && th > Math.pow(density, THIN[key.split(':')[0]])) return;
      const bk = `${key}|${Math.abs(lat) > FAR_LAT ? 'f' : 'n'}`;
      const b = buckets[chunkOf(s)];
      let e = b.get(bk); if (!e) { e = { key, farBand: Math.abs(lat) > FAR_LAT, m: [], c: [] }; b.set(bk, e); }
      e.m.push(_m.clone());
      e.c.push(o.col || new THREE.Color(1, 1, 1));
      stats.instances++;
    };
    // yaw that points an asset's +Z (its front) along world direction (dx, dz)
    const yawTo = (dx, dz) => Math.atan2(dx, dz);
    const faceRoad = (s, lat) => { const f = frame(s); const d = lat > 0 ? -1 : 1; return yawTo(f.nx * d, f.nz * d); };
    const alongRoad = (s) => { const f = frame(s); return Math.atan2(-f.tz, f.tx); };   // asset +X along the road
    const jitterCol = (r, amt = 1, tint = null) => {
      const l = 0.84 + r() * 0.3 * amt;
      const c = new THREE.Color(l * (0.94 + r() * 0.12 * amt), l * (0.96 + r() * 0.08 * amt), l * (0.92 + r() * 0.12 * amt));
      if (tint) { c.r *= tint[0]; c.g *= tint[1]; c.b *= tint[2]; }
      return c;
    };

    // ---- 1. Buildings first, so everything else can respect their footprints.
    // Farms (farmhouse + barn + paddock fence + animals + mailbox) and roadside
    // businesses (gas station, diner) arrive as CLUSTERS, which is how a rural
    // road actually reads: long empty stretches, then a place.
    // ONE gas brand and one diner finish per course. Each variant is ~8
    // materials, i.e. ~8 draws per chunk it appears in; three brands in one
    // chunk measured 136 meshes on the Peninsula. A single brand per road is
    // also simply what a stretch of California highway looks like.
    const gasV = hashStr(spine.mapId) % 3, dinerV = (hashStr(spine.mapId) >> 3) % 2;
    const bizList = [[`gas_station:${gasV}`, 3], [`diner:${dinerV}`, 2]];
    // Wall colour variety comes from the instance tint, not from more variants.
    const WALL_TINTS = [[1, 1, 1], [1.1, 1.36, 1.42], [0.86, 1.06, 1.2], [1.06, 1.12, 0.96]];
    const wallTint = (r) => WALL_TINTS[Math.floor(r() * WALL_TINTS.length)];
    let nextFarm = 120 + rnd() * 300, nextBiz = 200 + rnd() * 500;
    for (let s = -PRE + 40; s < sEnd; s += 20) {
      const tb = themeAt(s); const th = tb.cur;
      if (th.street) continue;                              // towns are dressed as streets below
      if (s >= nextFarm && th.farms > 0) {
        nextFarm = s + (1000 / th.farms) * (0.6 + rnd() * 0.8);
        if (s < -PRE + 80) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const house = pickW([['farmhouse:0', 3], ['farmhouse:1', 2]], rnd());
        const barn = pickW([['barn:0', 3], ['barn:1', 2]], rnd());
        const hz = this.kit.get(house).size, bz = this.kit.get(barn).size;
        const latH = side * (KERB + 18 + hz.z / 2 + rnd() * 10);
        const latB = side * (KERB + 34 + bz.z / 2 + rnd() * 14);
        const sB = s + (rnd() < 0.5 ? -1 : 1) * (hz.x / 2 + bz.x / 2 + 8 + rnd() * 10);
        put(house, s, latH, { yaw: faceRoad(s, latH) + (rnd() - 0.5) * 0.12, tb, col: jitterCol(rnd, 0.6, wallTint(rnd)) });
        put(barn, sB, latB, { yaw: faceRoad(sB, latB) + (rnd() - 0.5) * 0.2, tb, col: jitterCol(rnd, 0.6, rnd() < 0.3 ? [0.8, 0.95, 1.0] : null) });
        reserved.push({ s0: s - hz.x / 2 - 3, s1: s + hz.x / 2 + 3, l0: latH - hz.z / 2 - 3, l1: latH + hz.z / 2 + 3 });
        reserved.push({ s0: sB - bz.x / 2 - 3, s1: sB + bz.x / 2 + 3, l0: latB - bz.z / 2 - 3, l1: latB + bz.z / 2 + 3 });
        put(pickW([['mailbox:0', 3], ['mailbox:1', 1]], rnd()), s + hz.x / 2 + 3, side * (KERB + 3.2), { yaw: faceRoad(s, side), tb, allowNear: true });
        // paddock: a fence line along the road either side of the drive, then animals inside
        const fk = (th.fence && th.fence[0]) || 'fence:0';
        const fenceLat = side * (KERB + 10.5);
        for (let fs = s - 70; fs < s + 70; fs += 4.15) { if (Math.abs(fs - (s + hz.x / 2 + 3)) < 5) continue; put(fk, fs, fenceLat, { yaw: alongRoad(fs), tb, col: jitterCol(rnd, 0.5) }); }
        if (th.animals) {
          const n = 2 + Math.floor(rnd() * 5);
          for (let k = 0; k < n; k++) {
            const as = s + (rnd() - 0.5) * 110, al = side * (KERB + 14 + rnd() * 26);
            if (!isFree(as, al, 2)) continue;
            put(`${th.animals[0]}:${Math.floor(rnd() * 3)}`, as, al, { yaw: rnd() * 6.28, tb });
          }
        }
        reserved.push({ s0: s - 70, s1: s + 70, l0: side > 0 ? KERB + 8 : -(KERB + 42), l1: side > 0 ? KERB + 42 : -(KERB + 8), soft: true });
      }
      if (s >= nextBiz && th.biz > 0) {
        nextBiz = s + (1000 / th.biz) * (0.6 + rnd() * 0.8);
        if (s < -PRE + 80) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const key = pickW(bizList, rnd());
        const sz = this.kit.get(key).size;
        const lat = side * (KERB + 7 + sz.z / 2);
        if (!isFree(s, lat, 10)) continue;
        put(key, s, lat, { yaw: faceRoad(s, lat), tb, col: jitterCol(rnd, 0.4) });
        reserved.push({ s0: s - sz.x / 2 - 4, s1: s + sz.x / 2 + 4, l0: lat - sz.z / 2 - 4, l1: lat + sz.z / 2 + 4 });
        // a billboard or two always hangs around a roadside business
        const bs = s + (rnd() < 0.5 ? -1 : 1) * (sz.x / 2 + 14);
        put(`billboard:${Math.floor(rnd() * 6)}`, bs, side * (KERB + 12), { yaw: faceRoad(bs, side) + side * 0.35, tb });
      }
    }

    // ---- 2. Town streets: shop rows close to the kerb, street trees, lamps
    // (poles). Density follows the town biome's blend weight so a town
    // gathers and thins rather than starting at a line.
    for (const side of [-1, 1]) {
      let s = -PRE + 20;
      while (s < sEnd) {
        const tb = themeAt(s);
        const w = (tb.cur.street ? 1 - tb.wp - tb.wn : 0) + (tb.prev.street ? tb.wp : 0) + (tb.next.street ? tb.wn : 0);
        if (w < 0.05) { s += 20; continue; }
        if (rnd() > w * 0.9) { s += 8 + rnd() * 10; continue; }
        const key = rnd() < (tb.curKey === 'night' ? 0.15 : 0.8) ? 'storefront:0' : pickW([['storefront:3', 3], [`gas_station:${gasV}`, 1], [`diner:${dinerV}`, 1]], rnd());
        const sz = this.kit.get(key).size;
        const lat = side * (KERB + 6.5 + sz.z / 2 + rnd() * 2);
        s += sz.x / 2;
        put(key, s, lat, { yaw: faceRoad(s, lat), tb, col: jitterCol(rnd, 0.9, wallTint(rnd)) });
        reserved.push({ s0: s - sz.x / 2 - 1, s1: s + sz.x / 2 + 1, l0: lat - sz.z / 2 - 2, l1: lat + sz.z / 2 + 2 });
        if (rnd() < 0.45) put(pickW(tb.cur.trees, rnd()), s + sz.x / 2 + 1.2, side * (KERB + 3.6), { yaw: rnd() * 6.28, scale: 0.7 + rnd() * 0.3, tb, col: jitterCol(rnd) });
        s += sz.x / 2 + 1 + rnd() * 5;
      }
    }

    // ---- 3. Trees, shrubs, rocks: near band slots, then clustered far band.
    for (const side of [-1, 1]) {
      for (let s = -PRE; s < sEnd; s += 6) {
        const tb = themeAt(s);
        const th = themeFor(tb, rnd());
        // near band: 10-45 m, one slot per 6 m
        if (rnd() < th.near) {
          const lat = side * (KERB + 4 + Math.pow(rnd(), 0.8) * 36);
          if (isFree(s, lat, 1.5)) {
            const key = pickW(th.trees, rnd());
            put(key, s + (rnd() - 0.5) * 5, lat, { yaw: rnd() * 6.28, scale: 0.72 + rnd() * 0.6, sy: 0.9 + rnd() * 0.25, sink: 0.3, tb, col: jitterCol(rnd), tilt: (rnd() - 0.5) * 0.06 });
          }
        }
        // shrubs and grass tufts, right up to the shoulder
        const ns = th.shrubs * (0.6 + rnd());
        for (let k = 0; k < ns; k++) {
          const lat = side * (KERB + 2.6 + Math.pow(rnd(), 1.4) * 50);
          if (!isFree(s, lat, 0.5)) continue;
          put(pickW(th.shrubKeys, rnd()), s + rnd() * 6, lat, { yaw: rnd() * 6.28, scale: 0.55 + rnd() * 0.9, sy: 0.7 + rnd() * 0.6, sink: 0.08, tb, col: jitterCol(rnd, 1.3) });
        }
        // rocks: small ones near, the occasional big boulder further out
        if (rnd() < th.rocks * 0.5) {
          const lat = side * (KERB + 3 + rnd() * 60);
          if (isFree(s, lat, 1)) {
            const big = Math.abs(lat) > 20 && rnd() < 0.35;
            const sc = th.boulder[0] + rnd() * (big ? th.boulder[1] * 1.6 : th.boulder[1] - th.boulder[0]);
            put(`rock:${rnd() < 0.6 ? 0 : 1}`, s + rnd() * 6, lat, { yaw: rnd() * 6.28, scale: sc, sy: 0.7 + rnd() * 0.5, sink: 0.2 * sc, tb, col: jitterCol(rnd, 0.8, th.rockTint), roll: (rnd() - 0.5) * 0.3 });
          }
        }
      }
      // far band, in clusters (a copse every so often rather than a lawn of
      // evenly spaced trees, which is what reads as procedural)
      for (let s = -PRE; s < sEnd; s += 25) {
        const tb = themeAt(s);
        const th = themeFor(tb, rnd());
        const n = th.far * 0.25 * (0.3 + rnd() * 1.4);
        const cl = { lat: 45 + Math.pow(rnd(), 0.9) * (th.farMax - 45), s: s + rnd() * 25 };
        for (let k = 0; k < n; k++) {
          if (rnd() < 0.3) { cl.lat = 45 + Math.pow(rnd(), 0.9) * (th.farMax - 45); cl.s = s + rnd() * 25; }
          const lat = side * Math.max(45, cl.lat + (rnd() - 0.5) * 34);
          const ss = cl.s + (rnd() - 0.5) * 30;
          if (!isFree(ss, lat, 2)) continue;
          put(pickW(th.trees, rnd()), ss, lat, { yaw: rnd() * 6.28, scale: 0.8 + rnd() * 0.7, sy: 0.9 + rnd() * 0.3, sink: 0.5, tb, col: jitterCol(rnd) });
        }
        // canyon/desert: big rock outcrops on the slopes
        if (th.rocks > 0.5 && rnd() < th.rocks * 0.5) {
          const lat = side * (50 + rnd() * 160);
          const sc = 3 + rnd() * 7;
          put(`rock:${rnd() < 0.5 ? 0 : 1}`, s + rnd() * 25, lat, { yaw: rnd() * 6.28, scale: sc, sy: 0.6 + rnd() * 0.8, sink: 0.7 * sc, tb, col: jitterCol(rnd, 0.6, th.rockTint) });
        }
      }
    }

    // ---- 4. Vineyard rows (valley): long low hedges running parallel to the
    // road on the uphill side, in blocks, following the terrain.
    const vines = [];     // per chunk list of matrices
    for (let i = 0; i < nChunks; i++) vines.push([]);
    for (let s = -PRE; s < sEnd; s += 90) {
      const tb = themeAt(s); if (!(tb.cur.vines > 0) || rnd() > tb.cur.vines) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      const l0 = KERB + 16 + rnd() * 20, rows = 8 + Math.floor(rnd() * 10);
      if (!isFree(s + 40, side * (l0 + rows * 1.5), 30)) continue;
      for (let r = 0; r < rows; r++) {
        const lat = side * (l0 + r * 3.0);
        for (let ss = s; ss < s + 80; ss += 10) {
          const f = frame(ss + 5), y = groundY(ss + 5, lat, tb, f);
          _p.set(f.cx + f.nx * lat, y + 0.55, f.cz + f.nz * lat);
          _q.setFromEuler(_e.set(0, Math.atan2(f.tx, f.tz), 0)); _sc.set(0.7, 1.1, 10.2);
          vines[chunkOf(ss)].push(new THREE.Matrix4().compose(_p, _q, _sc));
          stats.instances++;
        }
      }
      reserved.push({ s0: s - 2, s1: s + 82, l0: side > 0 ? l0 - 2 : -(l0 + rows * 3 + 2), l1: side > 0 ? l0 + rows * 3 + 2 : -(l0 - 2) });
    }

    // ---- 5. Fences: long runs along the verge on the rider's right.
    for (const side of [-1, 1]) {
      let s = -PRE;
      while (s < sEnd) {
        const tb = themeAt(s); const th = tb.cur;
        if (!th.fence || rnd() > th.fence[1]) { s += 60 + rnd() * 120; continue; }
        const len = 80 + rnd() * 300, lat = side * (KERB + 7.5 + rnd() * 3);
        for (let fs = s; fs < s + len && fs < sEnd; fs += 4.15) { if (!isFree(fs, lat, 1)) continue; put(th.fence[0], fs, lat, { yaw: alongRoad(fs), tb, col: jitterCol(rnd, 0.5) }); }
        s += len + 40 + rnd() * 160;
      }
    }

    // ---- 6. Billboards: faced toward oncoming traffic, angled 20 degrees
    // off the road so the art is read on approach.
    for (let s = -PRE + 60; s < sEnd; s += 40) {
      const tb = themeAt(s);
      if (rnd() > tb.cur.billboards * 0.04) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (KERB + 10 + rnd() * 8);
      if (!isFree(s, lat, 6)) continue;
      const f = frame(s);
      put(`billboard:${Math.floor(rnd() * 6)}`, s, lat, { yaw: yawTo(f.tx, f.tz) - side * 0.35, tb, col: jitterCol(rnd, 0.3) });
      reserved.push({ s0: s - 6, s1: s + 6, l0: lat - 3, l1: lat + 3 });
    }

    // ---- 7. Telephone line on the rider's LEFT (+lat), with sagging wires.
    // The level already has an unwired pole line on the right (level.js
    // buildRoadside: every 46 m from z = -30 at 11.8 m out, arm at +4.7 m);
    // it gets wires too, computed from that same recipe.
    const wires = [];
    for (let i = 0; i < nChunks; i++) wires.push([]);
    const wire = (a, b, sag) => {
      // two straight spans with a mid sag: at 5 m on screen a catenary and a
      // V are indistinguishable, and it is 2 instances instead of 8
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5); mid.y -= sag;
      for (const [p0, p1] of [[a, mid], [mid, b]]) {
        const len = p0.distanceTo(p1); const c = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
        _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().subVectors(p1, p0).normalize());
        _sc.set(0.025, 0.025, len);
        wires[chunkOf(-c.z)].push(new THREE.Matrix4().compose(c, _q, _sc));
      }
    };
    const POLE_ATTACH = { 0: { y: 9.0, xs: [-1.1, -0.5, 0.5, 1.1] }, 1: { y: 9.0, xs: [-1.1, -0.5, 0.5, 1.1] }, 2: { y: 9.6, xs: [-1.4, 0, 1.4] } };
    let prevPole = null;
    for (let s = -PRE; s < (CL ? -PRE : sEnd); s += 42) {        // (none on a cliff course)
      const tb = themeAt(s);
      const v = tb.cur.pole === 0 ? (rnd() < 0.25 ? 1 : 0) : tb.cur.pole;
      const lat = widen(s, KERB + 7.2);
      if (!isFree(s, KERB + 7.2, 1) || crossingNear(s, 9)) { prevPole = null; continue; }
      const f = frame(s);
      // Crossarm ACROSS the road, wires along it. yaw = atan2(-n.z, n.x) maps the
      // asset's X (the arm) onto the road normal n; its front then faces along
      // the direction of travel.
      const yaw = Math.atan2(-f.nz, f.nx);
      const y0 = groundY(s, lat, tb, f);
      put(`utility_pole:${v}`, s, lat, { yaw, tb, col: jitterCol(rnd, 0.4), raw: true });
      const at = POLE_ATTACH[v];
      const pts = at.xs.map((x) => new THREE.Vector3(f.cx + f.nx * (lat + x), y0 + at.y, f.cz + f.nz * (lat + x)));
      if (prevPole && prevPole.v === v) for (let k = 0; k < pts.length; k++) wire(prevPole.pts[k], pts[k], 0.6);
      prevPole = { v, pts };
    }
    let prevL = null;
    for (let z = -30; z > (CL ? 0 : -roadEnd); z -= 46) {
      const s = -z, f = frame(s);
      const lat = widen(s, -(CFG.ROAD_W / 2 + CFG.KERB_W + 5.5));
      // that arm is yawed atan2(t)+pi/2, which lays it ALONG the road, so its
      // ends are offset along the tangent, not the normal
      const pts = [-0.85, 0.85].map((x) => new THREE.Vector3(f.cx + f.nx * lat + f.tx * x, f.cy + 4.76, f.cz + f.nz * lat + f.tz * x));
      if (prevL) for (let k = 0; k < 2; k++) wire(prevL[k], pts[k], 0.45);
      prevL = pts;
    }

    // ---- 8. Road signs: curve warnings before each bend, on the rider's
    // right, facing the rider; the arrow points into the bend. The occasional
    // speed-zone panel, and stop signs where farm lanes join.
    let lastSign = -1e9;
    for (let s = 40; s < sEnd - 120; s += 20) {
      const f0 = frame(s + 60), f1 = frame(s + 160);
      const turn = f0.tx * f1.tz - f0.tz * f1.tx;             // sign of heading change over 100 m
      const k = Math.abs(Math.asin(Math.max(-1, Math.min(1, turn)))) / 100;
      if (k > 0.00075 && s - lastSign > 260) {
        lastSign = s;
        const f = frame(s);
        const right = turn > 0 ? 0 : 4;                        // v0 arrow right, v4 arrow left
        put(`road_sign:${right}`, s, -(KERB + 2.6), { yaw: yawTo(f.tx, f.tz), allowNear: true, col: jitterCol(rnd, 0.3) });
      } else if (rnd() < 0.02 && s - lastSign > 200) {
        lastSign = s;
        const f = frame(s);
        put(`road_sign:${rnd() < 0.7 ? 3 : 2}`, s, -(KERB + 2.6), { yaw: yawTo(f.tx, f.tz), allowNear: true, col: jitterCol(rnd, 0.3) });
      }
    }

    // ---- 9. Terrain skirt, per chunk. (A cliff course packs its columns at the
    // road, where the face and the wall are.)
    const COLS = CL ? [CT0, CT0 + 1.5, CT0 + 3.5, CT0 + 6, CT0 + 9, CT0 + 13, CT0 + 18, CT0 + 26, 40, 60, 90, 140, 220, 330, 480, 650] : TCOLS;
    const ROCK = new THREE.Color(0x76695c), ROCK2 = new THREE.Color(0x5f5a52);   // grey-brown basalt (Atlas refs, _refs/ghat)
    const terrainGeos = [];
    for (let ci = 0; ci < nChunks; ci++) {
      const s0 = -PRE + ci * CHUNK, s1 = Math.min(sEnd + 40, s0 + CHUNK);
      if (s0 >= s1) { terrainGeos.push(null); continue; }
      const pos = [], col = [], uv = [], idx = [];
      const rows = Math.ceil((s1 - s0) / (CL ? 4 : 6));     // finer rows: the displacement below needs them
      const cc = new THREE.Color(), cg = new THREE.Color(), cv = new THREE.Color();
      for (const side of [-1, 1]) {
        const base = pos.length / 3;
        for (let r = 0; r <= rows; r++) {
          const s = s0 + (r / rows) * (s1 - s0);
          const tb = themeAt(s), f = frame(s);
          cv.copy(tb.verge);
          cg.setHex(tb.cur.ground).multiplyScalar(1 - tb.wp - tb.wn).add(new THREE.Color(tb.prev.ground).multiplyScalar(tb.wp)).add(new THREE.Color(tb.next.ground).multiplyScalar(tb.wn));
          // Before the road exists (s < -165: the level lays deck from about
          // -150 m) there is no verge either, so the skirt's inner column runs
          // to the centreline and the look-back camera sees ground, not the
          // beach plane.
          for (const a0 of COLS) {
            const a = (a0 === CT0 && s < -165) ? 0.01 : a0;
            const lat = side * a;
            const h = reliefAt(s, lat, tb);
            const xz = placeXZ(s, lat, f);
            // DISPLACEMENT (seeded value-noise fBm in world space): the skirt was
            // smooth between its rows and columns. Out in the fields a rolling
            // bump; on a cliff course's faces buttresses and gullies -- the face
            // is pushed in and out ALONG the road normal, so a 150 m drop is not
            // one flat sheet. Zero at the inner column: the road edge never moves.
            const D = disp(xz.x, xz.z, a);
            const px = xz.x + (D.dl ? f.nx * side * D.dl : 0), pz = xz.z + (D.dl ? f.nz * side * D.dl : 0);
            pos.push(px, f.cy - 0.1 + h + D.dh, pz);
            const u = smooth(CT0, 160, a);
            const n = 0.5 + 0.5 * Math.sin(s * 0.017 + a * 0.05) * Math.sin(s * 0.0061 - a * 0.013 + side);
            cc.copy(cv).lerp(cg, u).multiplyScalar(0.88 + n * 0.22);
            if (tb.cur.ridge.snow && h > 34) cc.lerp(new THREE.Color(0xd8dde2), smooth(34, 48, h));
            if (CL) {
              // bare rock where it is steep: the drop's face and the cut wall
              const dk = cliffDropK(s, riderSide(lat));
              const face = dk * 0.85 * (1 - smooth(CT0 + 18, CT0 + 60, a)) + (1 - dk) * 0.8 * (1 - smooth(CT0 + 8, CT0 + 30, a));
              cc.lerp(dk > 0.5 ? ROCK2 : ROCK, face);
              // strata: horizontal bands down the face, not vertical streaks
              cc.multiplyScalar(1 - face * (0.12 + 0.1 * Math.sin(h * 0.45 + s * 0.004)));
            }
            col.push(cc.r, cc.g, cc.b);
            // on a cliff face the lateral barely changes while the height does:
            // tile by the distance down the face, or the texture streaks
            uv.push((CL ? side * (a + Math.abs(h)) : lat) * 0.037, -s * 0.018);
          }
        }
        const W = COLS.length;
        for (let r = 0; r < rows; r++) for (let k = 0; k < W - 1; k++) {
          const a = base + r * W + k, b = a + 1, c2 = a + W, d = c2 + 1;
          // winding so the upward face is front-facing on both sides
          if (side > 0) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
      terrainGeos.push(geo);
    }

    // ---- 9b. Ground cover (groundcover.js): tufts of grass along both verges,
    // from just off the shoulder out to ~28 m, seated on the displaced ground,
    // tinted by the biome's verge colour with a little per-tuft variation. Its
    // own random stream, so the rest of the layout is untouched; thinned by the
    // tier's density. On a cliff course only the wall-side shoulder has any.
    const grass = [];
    for (let i = 0; i < nChunks; i++) grass.push({ m: [], c: [], n: 0 });     // flat number arrays, not objects
    {
      const gr = prng(hashStr(spine.mapId + 'grass'));
      const per = Math.round(14 * (this.tier.grass ?? 1));       // tufts per metre of road, both sides
      const gc = new THREE.Color(), g2 = new THREE.Color();
      const gm = new THREE.Matrix4(), gq = new THREE.Quaternion(), gs = new THREE.Vector3(), gp = new THREE.Vector3(), ge = new THREE.Euler();
      for (let s = Math.max(-150, -PRE); s < sEnd; s += 1) {
        if (crossingNear(s, 12)) continue;
        const tb = themeAt(s);
        if (tb.cur.street) continue;                                  // town: pavements, not meadow
        const f = frame(s);
        for (let k = 0; k < per; k++) {
          const side = gr() < 0.5 ? -1 : 1;
          let lat;
          if (CL) {
            if (isDrop(s, side)) continue;
            const e = edgeAt(Math.max(0, s), -side) + CFG.KERB_W;     // (scenery lat + is the rider's left)
            lat = side * (e + 0.4 + gr() * Math.max(0.2, CT0 - e - 0.6));     // the flat shoulder only
          } else {
            const a0 = KERB + 2.6 + Math.pow(gr(), 1.6) * 25;        // denser near the road
            lat = widen(s, side * a0);
          }
          // (no isFree test: it scans every reservation, per tuft, and a tuft
          // under a footprint is hidden by the building anyway; towns are skipped)
          const y = groundY(s, lat, tb, f);
          const xz = placeXZ(s, lat, f);
          const hgt = 0.35 + gr() * 0.55 * (tb.cur.street ? 0.5 : 1);
          gp.set(xz.x, y - 0.03, xz.z);
          ge.set((gr() - 0.5) * 0.25, gr() * 6.28, (gr() - 0.5) * 0.25); gq.setFromEuler(ge);
          const w = 1.1 + gr() * 1.0; gs.set(w, hgt, w);
          const G = grass[chunkOf(s)];
          gm.compose(gp, gq, gs);
          for (let e = 0; e < 16; e++) G.m.push(gm.elements[e]);
          G.n++;
          // the biome's ground colour, a little of its verge, and brighter: grass
          // catches the light that bare ground does not
          gc.setHex(tb.cur.ground).lerp(tb.verge, 0.25).multiplyScalar(1.15 + gr() * 0.4);
          // a few dry stalks and the odd flower head in the mix
          const rr = gr();
          if (rr < 0.12) gc.lerp(g2.setHex(0xc8b27a), 0.6);
          else if (rr < 0.15) gc.lerp(g2.setHex(gr() < 0.5 ? 0xf2e6f0 : 0xe8c64a), 0.7);
          G.c.push(gc.r, gc.g, gc.b);
        }
      }
    }

    // ---- 10. Assemble chunks.
    //   group       terrain skirt (always, to VIS_R)
    //     props     everything else, to the tier's visR
    //       (direct) buildings/billboards at full detail, wires, vines, and
    //                the far band's LOD stand-ins
    //       near    near-band props at full detail   (chunk within nearR)
    //       far     near-band props as LOD stand-ins (chunk beyond nearR)
    const inst = (geo, mat, e, parent) => {
      const im = new THREE.InstancedMesh(geo, mat, e.m.length);
      im.name = e.key;
      for (let i = 0; i < e.m.length; i++) { im.setMatrixAt(i, e.m[i]); im.setColorAt(i, e.c[i]); }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = true;
      im.computeBoundingSphere();
      freeAfterUpload(im.instanceMatrix); freeAfterUpload(im.instanceColor);
      parent.add(im); stats.meshes++;
    };
    for (let ci = 0; ci < nChunks; ci++) {
      const g = new THREE.Group(); g.name = `scenery-chunk-${ci}`;
      const props = new THREE.Group(); props.name = 'props';
      const near = new THREE.Group(); near.name = 'near';
      const far = new THREE.Group(); far.name = 'far';
      g.add(props); props.add(near, far);
      if (grass[ci] && grass[ci].n) {
        const G = grass[ci];
        const gi = new THREE.InstancedMesh(tuftGeometry(), tuftMaterial(), G.n);
        gi.name = 'grass';
        gi.instanceMatrix.array.set(G.m);
        gi.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(G.c), 3);
        grass[ci] = null;
        gi.instanceMatrix.needsUpdate = true;
        gi.castShadow = false; gi.receiveShadow = true;
        gi.computeBoundingSphere();
        freeAfterUpload(gi.instanceMatrix); freeAfterUpload(gi.instanceColor);
        near.add(gi); stats.meshes++;
      }
      const sMid = -PRE + (ci + 0.5) * CHUNK;
      const fc = frame(Math.min(sMid, sEnd));
      if (terrainGeos[ci]) {
        for (const k in terrainGeos[ci].attributes) freeAfterUpload(terrainGeos[ci].attributes[k]);
        freeAfterUpload(terrainGeos[ci].index);
        const tm = new THREE.Mesh(terrainGeos[ci], this.terrainMat);
        tm.receiveShadow = true; tm.userData.ownGeo = true; g.add(tm); stats.meshes++;
      }
      for (const [, e] of buckets[ci]) {
        const item = this.kit.get(e.key);
        if (item.lodKind === 'full') { for (const part of item.parts) inst(part.geo, part.mat, e, props); continue; }
        if (e.farBand && item.lod) { inst(item.lod, this.lodMat, e, props); continue; }
        for (const part of item.parts) inst(part.geo, part.mat, e, near);
        if (item.lod) inst(item.lod, this.lodMat, e, far);
      }
      for (const [list, mat] of [[vines[ci], this.vineMat], [wires[ci], this.wireMat]]) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(this.unitBox, mat, list.length);
        list.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.receiveShadow = true;
        props.add(im); stats.meshes++;
      }
      this.root.add(g);
      this.chunks.push({ group: g, props, near, far, centre: new THREE.Vector3(fc.cx, fc.cy, fc.cz) });
    }

    // ---- 11. Far ridges: two layers a side, parallel to the course's overall
    // line (the road's x never strays more than ~76 m from 0, so straight
    // ridges read as following it). Coloured and shaped by the biome they
    // stand beside; mesas for the desert and canyon, snow for the Sierra.
    this.ridges = new THREE.Group(); this.ridges.name = 'scenery-ridges';
    const ridgeRnd = prng(hashStr(spine.mapId + 'ridge'));
    for (const side of [-1, 1]) {
      for (const layer of [0, 1]) {
        const L = layer ? 1900 + ridgeRnd() * 300 : 820 + ridgeRnd() * 200;
        const pos = [], col = [], idx = [];
        // A HEIGHT FIELD, not a tent. Each row across the ridge is K samples
        // from the inner foot to the outer one; the height is a bell profile
        // shaped by RIDGED fBm in world space (peaks, saddles, spurs running
        // down the flanks, gullies between them) plus finer noise, and each
        // vertex is coloured by its height -- dark forest at the foot, the
        // course's rock above, snow over the snowline -- then hazed with
        // distance. Step 25 m along the course.
        const zA = 1800, zB = -(sEnd + 2200), step = 25, K = 11, CREST = 0.42;
        const phase = ridgeRnd() * 100;
        const ridged = (x, z) => {
          let a = 0.5, t = 0, f = 1;
          for (let o = 0; o < 4; o++) { const n = vnoise2(x * f + o * 31.7, z * f - o * 17.3); t += a * (1 - Math.abs(2 * n - 1)); f *= 2.1; a *= 0.5; }
          return t / 0.9375;
        };
        const fogC = new THREE.Color(0x9fb0c0), cF = new THREE.Color(), cM = new THREE.Color(), cT = new THREE.Color(), cc = new THREE.Color();
        const snowC = new THREE.Color(0xe8ecf0);
        let row = 0;
        for (let z = zA; z >= zB; z -= step, row++) {
          const s = -z;
          const tb = themeAt(s); const rg = tb.cur.ridge;
          const n = 0.5 + 0.3 * Math.sin(z * 0.0021 + phase) + 0.15 * Math.sin(z * 0.0067 + phase * 2) + 0.08 * Math.sin(z * 0.019 + phase * 3);
          // Height per theme, then BLENDED across the biome transition. It used
          // to take the current sector's height outright, so where a town met
          // the Sierra one 50 m row stood 170 m tall and the next 500 m.
          const hOf = (t) => {
            const [h0, h1] = t.ridge.h;
            let h = (h0 + (h1 - h0) * n) * (layer ? 1.25 : 0.8);
            // The Pacific: on a coast sector the rider's LEFT (lat > 0, which is
            // world -x because the road runs down -z) is ocean, so that side's
            // ridge is sunk below the sea plane instead of walling off the view.
            if (side < 0 && t.terrain.ampL < 0) h = -120;
            return h;
          };
          const h = mixNum(tb, hOf);
          const mesa = rg.mesa;
          // BUG FIX (the "white slabs across the sky" in town, sierra ~3700 m):
          // the ridge's inner foot is `h*1.4 + 200` inside its crest, so a 500 m
          // Sierra ridge on the 820 m layer put its foot at x ~ -100 -- ACROSS
          // the road. The crest is pushed out until the inner foot stays beyond
          // the terrain skirt (650 m) plus the road's own x wander.
          const Lmin = 740 + Math.max(0, h) * 1.4 + 200;
          // (a cliff course: the ridges stand on the valley floor, and follow the
          // road's own wander -- the ghat's x drifts much further than a coast road's)
          const xc = (CL ? centreAt(z, _cy).x : 0) + side * Math.max(Lmin, L + Math.sin(z * 0.0013 + phase) * 160);
          const ybase = CL ? GHAT_FLOOR - 10 : -60;
          const hScale = CL ? 0.85 : 1;
          const inner = h * 1.4 + 200, outer = h * 1.6 + 300;
          // colours for this row: foot (forest / scrub), flank (the ridge's rock), top
          cF.setHex(tb.cur.ground).multiplyScalar(0.5);
          cM.setHex(rg.col);
          cT.setHex(rg.col).multiplyScalar(1.12);
          const far = layer ? 0.16 : 0.04;               // (the scene fog does the rest)
          for (let k = 0; k < K; k++) {
            const u = k / (K - 1);
            const x = xc + side * (u < CREST ? -inner * (1 - u / CREST) : outer * ((u - CREST) / (1 - CREST)));
            // bell across the ridge, peaks and saddles along it, spurs down it
            const across = u < CREST ? u / CREST : 1 - (u - CREST) / (1 - CREST);
            const bell = Math.pow(Math.sin(across * Math.PI / 2), 1.6);
            const rn = ridged(x * 0.0021 + phase, z * 0.0021);
            let hh = h > 0 ? h * bell * (0.55 + 0.7 * rn) + h * 0.08 * (vnoise2(x * 0.011, z * 0.011) - 0.5) * bell : h * bell;
            if (mesa && hh > h * 0.62) hh = h * 0.62 + (hh - h * 0.62) * 0.08;          // flat-topped
            pos.push(x, CL ? ybase + hh * hScale : Math.max(ybase, hh), z);
            // height colouring, then haze
            const t = Math.max(0, Math.min(1, hh / Math.max(1, Math.abs(h))));
            cc.copy(cF).lerp(cM, Math.min(1, t * 1.6)).lerp(cT, Math.max(0, t - 0.6) * 1.5);
            if (rg.snow && hh > 300 * (layer ? 1.2 : 0.8)) cc.lerp(snowC, Math.min(0.9, (hh - 300) / 120));
            cc.lerp(fogC, far + 0.06 * t);
            col.push(cc.r, cc.g, cc.b);
          }
          if (row > 0) {
            for (let k = 0; k < K - 1; k++) {
              const a = (row - 1) * K + k, b = row * K + k;
              if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
              else idx.push(a, b, a + 1, a + 1, b, b + 1);
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, this.ridgeMat); m.name = `ridge-${side}-${layer}`;
        this.ridges.add(m); stats.meshes++;
      }
    }
    this.root.add(this.ridges);
    this.stats = stats;
  }
}
