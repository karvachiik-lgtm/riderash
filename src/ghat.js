// RideRash — the ghat road's roadside: what stands between the road and the drop.
//
// Road Rash (1994)'s Pacific Coast was a narrow road on a cliff where a crash
// too close to the edge put you out of the race. The layout is ghatdesign.js
// (which flank drops, the swirls, cuttings, the tunnel, bridges, collapsed
// lanes, concrete repairs); this builds the dressing that reads it, from the
// Atlas reference set (docs/refs/ghat/):
//
//   - on the drop side, a W-beam guard rail on the sweepers and a low stone
//     PARAPET painted in black-and-white bands on the swirls
//   - GAPS in it -- a lorry went through, a section never finished -- marked by
//     red-and-white terminal posts. Through a gap there is only air (physics.js
//     turns that into `overEdge`, main.js into a plunge)
//   - where the monsoon took the valley-side lane: no rail at all, a line of
//     orange-and-white barrels along the break, rubble, patched concrete
//   - concrete slab repairs across the whole deck
//   - (the TUNNEL is tunnels.js, shared with the Pacific Coast)
//   - the BRIDGES: concrete parapets both sides, piers down into the gorge and a
//     steel arch under the deck
//   - milestones on the rock side
//
// Everything is placed from the course's own seed, so a course is the same
// every time; seeded gaps favour the tight bends, where a rider runs wide.
import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, centreTangent, roadProfile } from './level.js';
import { edgeAt } from './lanes.js';
import { ghatRanges, ghatDropAt, ghatSection } from './ghatdesign.js';

export const GHAT = {
  POST_EVERY: 2.5,          // m between rail posts
  GAP_EVERY: [300, 520],    // m between seeded gaps
  GAP_LEN: [9, 18],         // m of missing rail
  RAIL_OFF: 0.55,           // m past the kerb: the rail stands on the shoulder
  SWIRL_K: 1 / 70,          // curvature above which the barrier is the stone parapet
};

let gaps = [];              // [[s0, s1, side]], sorted by s0
/** Is the rail missing at s on the rider's `sgn` side (+1 right)? Any side if sgn omitted. */
export function cliffGapAt(s, sgn) {
  for (const g of gaps) {
    if (s < g[0]) return false;
    if (s <= g[1] && (sgn === undefined || g[2] === sgn)) return true;
  }
  return false;
}
export function cliffGaps() { return gaps; }

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const _c = new THREE.Vector3(), _t = new THREE.Vector3();
/** World position at (s, rider-lateral) -- + lateral is the rider's right: (t.z, -t.x). */
function at(s, lat, out, dy = 0) {
  centreAt(-s, _c); centreTangent(-s, _t);
  return out.set(_c.x + _t.z * lat, _c.y + dy, _c.z - _t.x * lat);
}
function yawAt(s) { centreTangent(-s, _t); return Math.atan2(_t.x, _t.z); }
function curvAt(s) {
  const a = centreAt(-(s - 6), new THREE.Vector3()), b = centreAt(-s, new THREE.Vector3()), c = centreAt(-(s + 6), new THREE.Vector3());
  return Math.abs(a.x - 2 * b.x + c.x) / 36;
}

export class GhatDress {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'ghat';
    scene.add(this.group);
    const M = (color, roughness = 0.7, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    this.mat = {
      steel: M(0xa8adb2, 0.45, 0.8),
      red: M(0xc8342a, 0.6), white: M(0xe8e4da, 0.7), yellow: M(0xe0b62c, 0.6),
      black: M(0x1c1c1e, 0.8), stone: M(0xdedad0, 0.85),
      orange: M(0xf05a14, 0.55), concrete: M(0xa9a59b, 0.9), rock: M(0x6f5a48, 0.95),
      rubble: M(0x7b6a5a, 0.95),
      slab: M(0xb9b4a8, 0.92, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      joint: M(0x3a3834, 0.95, 0, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      patch: M(0x121315, 0.8, 0, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      girder: M(0x8a4a2e, 0.6, 0.4),
    };
  }

  _clear() {
    for (const c of [...this.group.children]) { this.group.remove(c); if (c.geometry) c.geometry.dispose(); }
  }

  _inst(geo, mat, mats, shadow = true) {
    if (!mats.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadow; im.receiveShadow = true;
    im.computeBoundingSphere();
    this.group.add(im);
    return im;
  }

  /** Lay the course's dressing (call per race). Returns the number of gaps. */
  build(finishS, seed = 1) {
    this._clear();
    gaps = [];
    if (!roadProfile().cliff) return 0;
    const r = prng(0x6a7 ^ seed);
    const end = finishS + 160;
    const R = ghatRanges(end + 200);
    const mtx = (p, yaw, sx = 1, sy = 1, sz = 1, pitch = 0) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    const v = () => new THREE.Vector3();

    // ---- the gaps: every broken lane, plus seeded ones on the tightest bends
    for (const [a, b, side] of R.broken) gaps.push([a, b, side]);
    for (let s = 380 + r() * 160; s < finishS - 150; s += GHAT.GAP_EVERY[0] + r() * (GHAT.GAP_EVERY[1] - GHAT.GAP_EVERY[0])) {
      let best = s, bk = -1;
      for (let q = s - 60; q <= s + 60; q += 10) { const k = curvAt(q); if (k > bk) { bk = k; best = q; } }
      const sec = ghatSection(best);
      if (sec[2] !== 1 && sec[2] !== -1) continue;                      // not on a bridge or in a cutting
      const len = GHAT.GAP_LEN[0] + r() * (GHAT.GAP_LEN[1] - GHAT.GAP_LEN[0]);
      if (!ghatDropAt(best - len / 2, sec[2]) || !ghatDropAt(best + len / 2, sec[2])) continue;
      if (gaps.some((g) => Math.abs((g[0] + g[1]) / 2 - best) < 80)) continue;
      gaps.push([best - len / 2, best + len / 2, sec[2]]);
    }
    gaps.sort((a, b) => a[0] - b[0]);

    // ---- barriers along every drop side, in runs between the gaps
    const posts = [], beams = [], terms = [], stonesB = [], stonesW = [], parapet = [];
    for (const side of [1, -1]) {
      let prev = null;
      for (let s = -60; s < end; s += GHAT.POST_EVERY) {
        const sd = Math.max(0, s);
        const bridge = ghatSection(sd)[2] === 2;
        if (!ghatDropAt(sd, side) || cliffGapAt(sd, side)) {
          if (prev && ghatDropAt(sd, side)) terms.push(prev.p.clone());   // a run ends at a gap
          prev = null; continue;
        }
        const lat = side * (edgeAt(sd, side) + CFG.KERB_W + GHAT.RAIL_OFF);
        const p = at(s, lat, v());
        if (!prev && ghatDropAt(sd - GHAT.POST_EVERY, side) && s > -60) terms.push(p.clone());
        const yaw = yawAt(s);
        if (bridge) {
          // concrete parapet, one block per step, the full height of a bridge wall
          parapet.push(mtx(p.clone().setY(p.y + 0.45), yaw, 1, 1, GHAT.POST_EVERY + 0.02));
        } else if (curvAt(s) > GHAT.SWIRL_K) {
          // the swirls: a low stone parapet, black-and-white bands
          const half = GHAT.POST_EVERY / 2;
          for (let k = 0; k < 2; k++) {
            const q = at(s + (k - 0.5) * half, lat, v());
            (((Math.round(s / half) + k) & 1) ? stonesB : stonesW).push(mtx(q.setY(q.y + 0.28), yawAt(s + (k - 0.5) * half)));
          }
        } else {
          posts.push(mtx(p.clone().setY(p.y + 0.4), 0));
          if (prev && !prev.stone) {
            const a = prev.p, len = a.distanceTo(p);
            const e = Math.atan2(p.x - a.x, p.z - a.z);
            beams.push(mtx(v().addVectors(a, p).multiplyScalar(0.5).setY((a.y + p.y) / 2 + 0.58), e, 1, 1, len + 0.05));
          }
        }
        prev = { s, p, stone: bridge || curvAt(s) > GHAT.SWIRL_K };
      }
    }
    this._inst(new THREE.BoxGeometry(0.12, 0.8, 0.12), this.mat.steel, posts);
    this._inst(new THREE.BoxGeometry(0.06, 0.32, 1), this.mat.steel, beams);
    const stoneGeo = new THREE.BoxGeometry(0.3, 0.56, GHAT.POST_EVERY / 2 - 0.08);
    this._inst(stoneGeo, this.mat.black, stonesB);
    this._inst(stoneGeo, this.mat.stone, stonesW);
    this._inst(new THREE.BoxGeometry(0.35, 0.9, 1), this.mat.concrete, parapet);
    // terminal posts at every gap: red and white bands
    const bandGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.26, 10);
    for (const [k, mat] of [[0, this.mat.red], [1, this.mat.white], [2, this.mat.red], [3, this.mat.white]]) {
      this._inst(bandGeo, mat, terms.map((p) => mtx(v().copy(p).setY(p.y + 0.13 + k * 0.26), 0)));
    }

    // ---- the collapsed lanes: barrels along the break, rubble, patched concrete
    {
      const barrelsO = [], barrelsW = [], rubble = [], slabs = [];
      for (const [a, b, side] of R.broken) {
        for (let s = a - 14; s <= b + 14; s += 3.2) {
          const lat = side * (edgeAt(s, side) - 0.35);
          const p = at(s, lat, v());
          barrelsO.push(mtx(p.clone().setY(p.y + 0.45), 0, 1, 1.0, 1));
          barrelsW.push(mtx(p.clone().setY(p.y + 0.45), 0, 1.02, 0.22, 1.02));
        }
        for (let s = a; s <= b; s += 1.6) {
          for (let k = 0; k < 2; k++) {
            const lat = side * (edgeAt(s, side) + 0.4 + r() * 1.6);
            const p = at(s + r() * 1.5, lat, v());
            const sz = 0.25 + r() * 0.55;
            rubble.push(mtx(p.setY(p.y - 0.05 - r() * 0.3), r() * 6.28, sz, sz * (0.5 + r() * 0.6), sz * (0.8 + r() * 0.8), r() * 0.8));
          }
          // broken slabs tipped toward the drop on the old lane line
          if (r() < 0.5) {
            const p = at(s, side * (edgeAt(s, side) + 1.0 + r() * 0.8), v());
            slabs.push(mtx(p.setY(p.y - 0.25 - r() * 0.4), yawAt(s) + (r() - 0.5) * 0.5, 1.4 + r() * 0.8, 0.2, 1.1 + r(), side * (0.3 + r() * 0.5)));
          }
        }
      }
      const barrelGeo = new THREE.CylinderGeometry(0.3, 0.33, 0.9, 12);
      this._inst(barrelGeo, this.mat.orange, barrelsO);
      this._inst(new THREE.CylinderGeometry(0.335, 0.335, 0.9, 12), this.mat.white, barrelsW, false);
      this._inst(new THREE.DodecahedronGeometry(1, 0), this.mat.rubble, rubble);
      this._inst(new THREE.BoxGeometry(1, 1, 1), this.mat.concrete, slabs);
    }

    // ---- concrete slab repairs (and the patched deck at each break)
    {
      const strip = (s0, s1, latL, latR, dy, step = 2) => {
        const pos = [], idx = [], p = v();
        let n = 0;
        for (let s = s0; s <= s1 + 1e-6; s += step) {
          at(s, latL(s), p, dy); pos.push(p.x, p.y, p.z);
          at(s, latR(s), p, dy); pos.push(p.x, p.y, p.z);
          if (n > 0) { const b = (n - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
          n++;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx); g.computeVertexNormals();
        return g;
      };
      const joints = [];
      for (const [a, b] of R.slabs) {
        if (a > end) continue;
        const g = strip(a, Math.min(b, end), (s) => -edgeAt(s, -1) + 0.15, (s) => edgeAt(s, 1) - 0.15, 0.012);
        const m = new THREE.Mesh(g, this.mat.slab); m.receiveShadow = true; this.group.add(m);
        for (let s = a; s <= b; s += 4.5) {
          const p = at(s, 0, v(), 0.02);
          joints.push(mtx(p, yawAt(s), edgeAt(s, 1) + edgeAt(s, -1) - 0.3, 1, 0.07));
        }
        // the lengthwise joint down the middle
        for (let s = a; s < b; s += 4.5) joints.push(mtx(at(s + 2.25, 0, v(), 0.02), yawAt(s + 2.25), 0.07, 1, 4.5));
      }
      this._inst(new THREE.BoxGeometry(1, 0.004, 1), this.mat.joint, joints, false);
      // patches and potholes through each break
      const patches = [];
      for (const [a, b, side] of R.broken) {
        for (let s = a - 30; s < b + 30; s += 5 + r() * 6) {
          const lat = (r() * 2 - 1) * 3.2 - side * 0.8;
          const sz = 0.7 + r() * 1.6;
          patches.push(mtx(at(s, lat, v(), 0.018), r() * 6.28, sz * (1 + r()), 1, sz));
        }
      }
      this._inst(new THREE.CylinderGeometry(0.5, 0.5, 0.004, 9), this.mat.patch, patches, false);
    }

    // (the tunnel is tunnels.js's: the same bore serves the coast)

    // ---- bridges: piers into the gorge and a steel arch under the deck
    for (const [a, b, side] of R.sections) {
      if (side !== 2 || a > end) continue;
      const piers = [], girders = [];
      const L = b - a;
      for (const f of [0.02, 0.98]) {
        const s = a + L * f, p = at(s, 0, v());
        piers.push(mtx(p.setY(p.y - 36), yawAt(s), 9, 72, 3.5));
      }
      // the arch: springs from the gorge walls, crowns just under the deck
      const W = edgeAt(a, 1) + CFG.KERB_W;
      for (const lat of [-W + 0.6, W - 0.6]) {
        const N = 28;
        for (let i = 0; i < N; i++) {
          const u0 = i / N, u1 = (i + 1) / N;
          const y0 = -2.2 - 34 * (2 * u0 - 1) ** 2, y1 = -2.2 - 34 * (2 * u1 - 1) ** 2;
          const p0 = at(a + L * u0, lat, v(), y0), p1 = at(a + L * u1, lat, v(), y1);
          const len = p0.distanceTo(p1);
          const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
          const pitch = -Math.atan2(p1.y - p0.y, Math.hypot(p1.x - p0.x, p1.z - p0.z));
          girders.push(mtx(v().addVectors(p0, p1).multiplyScalar(0.5), yaw, 0.7, 0.9, len + 0.1, pitch));
          // hangers up to the deck every other segment
          if (i % 2 === 0 && y0 < -3) { const q = at(a + L * u0, lat, v(), y0 / 2 - 0.4); girders.push(mtx(q, yawAt(a + L * u0), 0.25, -y0 - 0.8, 0.25)); }
        }
      }
      // the deck's underside, so the bridge has depth from the side
      const deck = [];
      for (let s = a; s < b; s += 4) deck.push(mtx(at(s + 2, 0, v(), -0.75), yawAt(s + 2), 2 * W + 1.2, 1.3, 4.05));
      this._inst(new THREE.BoxGeometry(1, 1, 1), this.mat.concrete, piers.concat(deck));
      this._inst(new THREE.BoxGeometry(1, 1, 1), this.mat.girder, girders);
    }

    // ---- milestones on the rock side: white stones with a yellow cap, every 100 m
    const stones = [], caps = [];
    for (let s = 50; s < finishS; s += 100) {
      const sec = ghatSection(s)[2];
      if (sec !== 1 && sec !== -1) continue;
      const p = at(s, -sec * (edgeAt(s, -sec) + CFG.KERB_W + 1.3), v());
      const yaw = yawAt(s);
      stones.push(mtx(p.clone().setY(p.y + 0.25), yaw));
      caps.push(new THREE.Matrix4().compose(p.clone().setY(p.y + 0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
    }
    this._inst(new THREE.BoxGeometry(0.34, 0.5, 0.16), this.mat.white, stones);
    this._inst(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 12, 1, false, 0, Math.PI), this.mat.yellow, caps);
    return gaps.length;
  }
}
