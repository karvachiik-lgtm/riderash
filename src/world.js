// RideRash — the roadside world. Mid-ground mass, which is the thing the first
// frames were missing entirely: buildings, hills, hoardings, trees, traffic,
// crowds. All of it instanced or baked, because traps.md is explicit that a
// town of a few hundred props placed individually is a few hundred draw calls
// and the cost is per object, not per triangle.
import * as THREE from 'three';
import { CFG, PAL } from './config.js';
import { centreAt, centreTangent, headAt } from './level.js';
import { texMaterial } from './textures.js';
import { bakeStatic } from '../assetlib.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
// Cached by value for the same reason as level.js: an uncached factory here was
// producing hundreds of identical `plaster`, `metal` and `fabric` materials, and
// bakeStatic buckets by material identity, so none of them could merge. The town
// alone was 277 draws.
const _matCache = new Map();
const mat = (c, r, m, n) => {
  const key = `${c}|${r ?? 0.82}|${m ?? 0.1}|${n || ''}`;
  const hit = _matCache.get(key);
  if (hit) return hit;
  const x = new THREE.MeshStandardMaterial({ color: c, roughness: r ?? 0.82, metalness: m ?? 0.1 });
  if (n) x.name = n;
  _matCache.set(key, x);
  return x;
};

// Turn (z, lateralOffset) into a world position on the road's frame.
function place(z, off, yUp = 0, out = new THREE.Vector3()) {
  const c = centreAt(z);
  const t = centreTangent(z);
  const nx = -t.z, nz = t.x;
  return out.set(c.x + nx * off, c.y + yUp, c.z + nz * off);
}
// Facing along the direction of TRAVEL, not the geometric tangent. `place()`
// above only uses the tangent for its normal, so it is unaffected, but anything
// that must FACE down the road (buildings, hoardings, traffic) needs this or it
// faces backward.
const yawAt = (z) => { const t = headAt(z); return Math.atan2(t.x, t.z); };

// NOTE: buildTown / buildHills / buildClutter are no longer called. The
// roadside world is src/scenery.js (per-course, coded assets, chunked
// instancing); these are kept only as reference for the old density maths.
// ---------------------------------------------------------------------------
// A town: low buildings either side, near enough to frame the road, far enough
// not to block it. Props are instanced by type so a hundred shops cost a few
// calls, not a few hundred.
// ---------------------------------------------------------------------------
export function buildTown(seed = 41, spine = null) {
  const r = rng(seed);
  const g = new THREE.Group();
  // Walls and roofs now carry the Atlas plaster and concrete maps. Each building
// body is a unit box scaled per instance, so the box's per-face UVs run 0-1 and
// the map tiles exactly once across each face — the same repeat then gives a
// small building fine grain and a large one broader grain, which is what real
// stucco does.
  const walls = [0xd8cdb8, 0xc8b9a4, 0xe4dccc, 0xb0a48e, 0xc8ac8c].map((c) => {
    const m = texMaterial('plaster', { repeat: 1, color: c, roughness: 0.90, metalness: 0.02 });
    m.name = 'plaster';
    return m;
  });
  const roofs = [0x8a5a44, 0x6a5a52, 0x96664c].map((c) => {
    const m = texMaterial('concrete', { repeat: 2, color: c, roughness: 0.88, metalness: 0.04 });
    m.name = 'tile';
    return m;
  });
  const awnings = [0xd4622a, 0x2f6f8f, 0xb8912e, 0x6a4a7a].map((c) => mat(c, 0.78, 0.03, 'fabric'));
  const win = mat(0x2a333c, 0.28, 0.30, 'tile');
  const stone = texMaterial('concrete', { repeat: 2, color: 0x9a9488, roughness: 0.92, metalness: 0.0 });
  stone.name = 'stone';

  // one mesh per (material) bucket, merged via instancing per building type
  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.BoxGeometry(1, 1, 1);
  const winGeo = new THREE.BoxGeometry(0.9, 1.4, 0.12);
  const awnGeo = new THREE.BoxGeometry(1, 0.14, 1.6);

  const bodies = [], roofsL = [], wins = [], awns = [];

  for (let z = -30; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 22 + r() * 26) {
    // SCENERY AS A FUNCTION OF DISTANCE. The town's placement probability is no
    // longer the constant 0.72 — it is the town density at this distance along
    // the spine. That single change is what makes a coastal sector open and
    // clear while the outskirts sector is built up, on the SAME map, with the
    // same geometry — the buildings thin out over the transition instead of
    // stopping at a line.
    const s = -z;
    const density = spine ? spine.stateAt(s).scenery.town : 0.72;
    for (const side of [-1, 1]) {
      if (r() > density) continue;                    // gaps between buildings
      const w = 6 + r() * 9;                          // along the road
      const d = 7 + r() * 8;                           // away from the road
      const h = 3.2 + r() * 6.5;                       // ground to parapet
      const inset = 11 + r() * 9;
      const off = side * (CFG.ROAD_W / 2 + CFG.KERB_W + inset + d / 2);
      const p = place(z, off, h / 2);
      const yaw = yawAt(z) + (r() - 0.5) * 0.06;
      bodies.push({ p: p.clone(), yaw, s: [d, h, w], ci: Math.floor(r() * walls.length) });

      // roof slab, slightly oversized
      roofsL.push({ p: place(z, off, h + 0.18), yaw, s: [d + 0.6, 0.36, w + 0.6], ci: Math.floor(r() * roofs.length) });

      // windows: a row facing the road, at two storeys
      const rows = Math.min(3, Math.floor(h / 2.2));
      for (let ry = 0; ry < rows; ry++) {
        const wy = 1.5 + ry * 2.2;
        if (wy > h - 0.8) break;
        for (let k = 0; k < Math.max(2, Math.floor(w / 2.4)); k++) {
          const along = (k - (Math.max(2, Math.floor(w / 2.4)) - 1) / 2) * 2.4;
          // window sits on the road-facing wall
          const faceOff = off - side * (d / 2 + 0.06);
          const wp = place(z + along, faceOff, wy);
          wp.y += 0;
          wins.push({ p: wp, yaw: yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2) });
        }
      }
      // awning over the ground floor, on some buildings
      if (r() > 0.55 && h > 3.4) {
        const faceOff = off - side * (d / 2 + 0.9);
        awns.push({ p: place(z, faceOff, 2.85), yaw: yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2), s: [w * 0.8, 1, 1], ci: Math.floor(r() * awnings.length) });
      }
    }
  }

  const addInst = (geo, entry) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const list = entry.list;
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, entry.mats[0], list.length);
    inst.castShadow = true; inst.receiveShadow = true;
    // instanced meshes take ONE material, so group by material index instead
    // of setting per-instance colours (which would need baking, per traps.md)
    let n = 0;
    for (const b of list) {
      q.setFromEuler(new THREE.Euler(0, b.yaw, 0));
      sc.set(b.s ? b.s[0] : 1, b.s ? b.s[1] : 1, b.s ? b.s[2] : 1);
      m.compose(b.p, q, sc);
      inst.setMatrixAt(n++, m);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  };

  // group by material so each material is one instanced draw
  const groupBy = (list, mats, geo) => {
    mats.forEach((mm, i) => {
      const sub = list.filter((b) => b.ci === i);
      if (!sub.length) return;
      const inst = new THREE.InstancedMesh(geo, mm, sub.length);
      inst.castShadow = true; inst.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      sub.forEach((b, n) => {
        q.setFromEuler(new THREE.Euler(0, b.yaw, 0));
        sc.set(b.s[0], b.s[1], b.s[2]);
        m.compose(b.p, q, sc);
        inst.setMatrixAt(n, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
    });
  };

  groupBy(bodies, walls, bodyGeo);
  groupBy(roofsL, roofs, roofGeo);
  groupBy(awns, awnings, awnGeo);

  // windows: one instanced mesh, single material
  if (wins.length) {
    const inst = new THREE.InstancedMesh(winGeo, win, wins.length);
    inst.castShadow = false; inst.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    wins.forEach((b, n) => {
      q.setFromEuler(new THREE.Euler(0, b.yaw, 0));
      m.compose(b.p, q, sc);
      inst.setMatrixAt(n, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Hills: the mid-ground mass that gives the world a horizon and depth. Placed
// beyond the town, low and overlapping.
// ---------------------------------------------------------------------------
export function buildHills(seed = 53) {
  const r = rng(seed);
  const g = new THREE.Group();
  const near = mat(0x5c6046, 0.97, 0.0, 'foliage');
  const mid = mat(0x646c58, 0.99, 0.0, 'foliage');
  const far = mat(0x76808c, 1.0, 0.0, 'stone');
  const layers = [
    { m: near, dist: 160, h: [18, 40], w: [90, 180] },
    { m: mid, dist: 320, h: [26, 60], w: [160, 300] },
    { m: far, dist: 620, h: [30, 70], w: [280, 520] },
  ];
  // INSTANCED, one mesh per layer -- not one mesh per hill.
  //
  // This built every hill as its own `new THREE.Mesh(new THREE.SphereGeometry(…))`
  // with a fresh geometry each time: measured 126 individual meshes on one map,
  // each a separate draw call, each with its own GPU buffer for the same sphere.
  // Hills never move and only differ by a transform, which is precisely what
  // InstancedMesh exists for, so all three layers are now three draws total.
  //
  // The geometry is shared across the whole function (one sphere, reused for
  // near/mid/far) because scale is carried per instance -- building a second
  // identical sphere would be the same waste in a smaller form.
  const hillGeo = new THREE.SphereGeometry(1, 14, 8);
  const bucket = new Map();   // material -> list of {pos, scale, ry}
  for (const L of layers) {
    const list = [];
    for (let z = 80; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 150 + r() * 130) {
      for (const side of [-1, 1]) {
        if (r() > 0.80) continue;
        const h = L.h[0] + r() * (L.h[1] - L.h[0]);
        const w = L.w[0] + r() * (L.w[1] - L.w[0]);
        const off = side * (L.dist + r() * 140);
        const c = centreAt(z);
        const t = centreTangent(z);
        const nx = -t.z, nz = t.x;
        list.push({
          x: c.x + nx * off, y: -h * 0.35 + r() * 6, z: c.z + nz * off + (r() - 0.5) * 120,
          sx: w, sy: h, sz: w * (0.6 + r() * 0.7), ry: r() * 6.28,
        });
      }
    }
    bucket.set(L.m, list);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3();
  for (const [material, list] of bucket) {
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(hillGeo, material, list.length);
    inst.castShadow = false; inst.receiveShadow = false;
    list.forEach((o, i) => {
      q.setFromEuler(new THREE.Euler(0, o.ry, 0));
      v.set(o.x, o.y, o.z);
      sv.set(o.sx, o.sy, o.sz);
      m4.compose(v, q, sv);
      inst.setMatrixAt(i, m4);
    });
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Trees, poles, hoardings, roadside clutter: the near-field rhythm.
// ---------------------------------------------------------------------------
export function buildClutter(seed = 67, spine = null) {
  const r = rng(seed);
  const g = new THREE.Group();
  const trunkM = mat(0x4a3a2c, 0.94, 0.02, 'timber');
  const leafM = mat(0x3f5230, 0.95, 0.0, 'foliage');
  const leafM2 = mat(0x4d5f38, 0.95, 0.0, 'foliage');
  const boardM = mat(0x8f8878, 0.9, 0.02, 'plaster');
  const steelM = mat(PAL.frameSteel, 0.42, 0.8, 'metal');

  // Trees and rocks share the clutter pass and are gated by the spine's local
  // density, so a forest sector is genuinely wooded and a canyon sector is
  // genuinely rocky — on the same road, from the same geometry.
  const rockM = mat(0x8a7a68, 0.96, 0.02, 'stone');
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);

  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.20, 3.2, 6);
  const canopyGeo = new THREE.IcosahedronGeometry(1, 0);

  const trunks = [], canopiesA = [], canopiesB = [], rocks = [];
  for (let z = -20; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 13 + r() * 22) {
    const s = -z;
    const den = spine ? spine.stateAt(s).scenery : { trees: 0.48, rocks: 0.0, hoardings: 0.2 };
    for (const side of [-1, 1]) {
      // --- trees ---
      if (r() < den.trees) {
        const off = side * (CFG.ROAD_W / 2 + CFG.KERB_W + 7 + r() * 22);
        const c = centreAt(z), t = centreTangent(z);
        const nx = -t.z, nz = t.x;
        const px = c.x + nx * off, pz = c.z + nz * off;
        const sc = 0.8 + r() * 0.9;
        trunks.push({ x: px, y: c.y + 1.6 * sc, z: pz, s: sc });
        const list = r() > 0.5 ? canopiesA : canopiesB;
        list.push({ x: px, y: c.y + (3.2 + 1.1) * sc, z: pz, s: sc * (1.6 + r() * 0.9), ry: r() * 6.28 });
      }
      // --- rocks: out past the trees, sitting on the verge, scattered in size ---
      if (r() < den.rocks) {
        const off = side * (CFG.ROAD_W / 2 + CFG.KERB_W + 5 + r() * 30);
        const c = centreAt(z), t = centreTangent(z);
        const nx = -t.z, nz = t.x;
        const sc = 0.5 + r() * 2.6;
        rocks.push({
          x: c.x + nx * off, y: c.y + sc * 0.30 - 0.1, z: c.z + nz * off,
          s: sc, ry: r() * 6.28, rz: (r() - 0.5) * 0.5,
        });
      }
    }
  }
  const mkInst = (geo, material, list, shape) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, material, list.length);
    inst.castShadow = true; inst.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    list.forEach((o, i) => {
      q.setFromEuler(new THREE.Euler(0, o.ry || 0, 0));
      shape(s, o);
      m.compose(new THREE.Vector3(o.x, o.y, o.z), q, s);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  };
  mkInst(trunkGeo, trunkM, trunks, (s, o) => s.set(o.s, o.s, o.s));
  mkInst(canopyGeo, leafM, canopiesA, (s, o) => s.set(o.s, o.s * 0.85, o.s));
  mkInst(canopyGeo, leafM2, canopiesB, (s, o) => s.set(o.s, o.s * 0.8, o.s));
  mkInst(rockGeo, rockM, rocks, (s, o) => s.set(o.s, o.s * 0.75, o.s * (0.85 + (o.rz || 0) * 0.3)));

  // hoardings: big flat boards at the roadside, shape and colour only, no glyphs
  const hoardColors = [0xd4622a, 0x2f6f8f, 0xb8912e, 0xc4442a, 0x6a4a7a];
  const hoardMats = hoardColors.map((c) => mat(c, 0.72, 0.05, 'plaster'));
  const hoardGeo = new THREE.BoxGeometry(4.4, 2.4, 0.16);
  const legsGeo = new THREE.BoxGeometry(0.14, 3.0, 0.14);
  const legs = [];
  // Boards are grouped BY COLOUR and instanced. They used to be one Mesh each
  // added straight to the group -- around two hundred individual draw calls for
  // the single most repeated prop in the game. `groupBy` + mkInst is the pattern
  // the trees and bollards below already use; the hoardings were simply missed.
  const hoardList = hoardMats.map(() => []);
  for (let z = -70; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 210 + r() * 200) {
    const side = r() > 0.5 ? -1 : 1;
    const off = side * (CFG.ROAD_W / 2 + CFG.KERB_W + 6.5 + r() * 4);
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x;
    const px = c.x + nx * off, pz = c.z + nz * off;
    const yaw = Math.atan2(t.x, t.z) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const ci = Math.floor(r() * hoardMats.length);
    hoardList[ci].push({ x: px, y: c.y + 2.7, z: pz, ry: yaw });
    for (const k of [-1, 1]) {
      legs.push({ x: px + Math.cos(yaw) * k * 1.7, y: c.y + 1.4, z: pz - Math.sin(yaw) * k * 1.7, ry: yaw });
    }
  }
  hoardMats.forEach((m, i) => mkInst(hoardGeo, m, hoardList[i], (s) => s.set(1, 1, 1)));
  mkInst(legsGeo, steelM, legs, (s) => s.set(1, 1, 1));

  // bollards along the verge, a hard near-field rhythm at speed
  const bolGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.85, 6);
  const bolWhite = mat(0xd8d2c4, 0.7, 0.05, 'plaster');
  const bols = [];
  for (let z = -8; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 16) {
    for (const side of [-1, 1]) {
      const off = side * (CFG.ROAD_W / 2 + CFG.KERB_W + 0.35);
      const c = centreAt(z), t = centreTangent(z);
      const nx = -t.z, nz = t.x;
      bols.push({ x: c.x + nx * off, y: c.y + 0.42, z: c.z + nz * off });
    }
  }
  mkInst(bolGeo, bolWhite, bols, (s) => s.set(1, 1, 1));

  return g;
}

// ---------------------------------------------------------------------------
// Traffic lives in traffic.js now: six vehicle types (sedan, pickup, van, box
// truck, city bus, semi) from assets/, car-following, and the swept contact
// test that rivals and the player share. Re-exported here so every existing
// `import { buildTraffic, ... } from './world.js'` keeps working.
// ---------------------------------------------------------------------------
export { buildTraffic, updateTraffic, resetTraffic, trafficHit } from './traffic.js';
