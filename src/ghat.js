// RideRash — the ghat road's roadside: the rail at the drop, its gaps, milestones.
//
// Road Rash (1994)'s Pacific Coast was a narrow road on a cliff where a crash
// too close to the edge put you out of the race. On a cliff course (level.js
// road profile with a `cliff`) this builds what stands between the road and the
// drop: a W-beam guard rail on the shoulder, BROKEN in places -- a gap where a
// lorry went through, a section never finished -- marked by red-and-white
// terminal posts. Through a gap there is nothing but air (physics.js turns that
// into `overEdge`, main.js into a plunge). Small milestones line the rock side.
//
// Everything is placed from the course's own seed, so a course is the same
// every time; gaps favour the tight bends, where a rider runs wide.
import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, centreTangent, roadProfile } from './level.js';
import { edgeAt } from './lanes.js';

export const GHAT = {
  POST_EVERY: 2.5,          // m between rail posts
  GAP_EVERY: [260, 480],    // m between gaps
  GAP_LEN: [9, 20],         // m of missing rail
  RAIL_OFF: 0.55,           // m past the kerb: the rail stands on the shoulder
};

let gaps = [];              // [[s0, s1]], sorted
/** Is the rail missing at s? (only meaningful on a cliff course) */
export function cliffGapAt(s) {
  for (const [a, b] of gaps) { if (s < a) return false; if (s <= b) return true; }
  return false;
}
export function cliffGaps() { return gaps; }

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export class GhatDress {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'ghat';
    scene.add(this.group);
    this.steel = new THREE.MeshStandardMaterial({ color: 0xa8adb2, roughness: 0.45, metalness: 0.8 });
    this.red = new THREE.MeshStandardMaterial({ color: 0xc8342a, roughness: 0.6 });
    this.white = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 });
    this.yellow = new THREE.MeshStandardMaterial({ color: 0xe0b62c, roughness: 0.6 });
  }

  _clear() {
    for (const c of [...this.group.children]) { this.group.remove(c); if (c.geometry) c.geometry.dispose(); }
  }

  /** Lay the rail, gaps and milestones for this course (call per race). */
  build(finishS, seed = 1) {
    this._clear();
    gaps = [];
    const CL = roadProfile().cliff;
    if (!CL) return 0;
    const side = CL.side;                                    // + = the rider's right
    const r = prng(0x6a7 ^ seed);
    // ---- the gaps: every 260-480 m, placed on the tightest bend nearby
    const curv = (s) => {
      const a = centreAt(-(s - 6)), b = centreAt(-s), c = centreAt(-(s + 6));
      return Math.abs(a.x - 2 * b.x + c.x) / 36;
    };
    for (let s = 350 + r() * 150; s < finishS - 150; s += GHAT.GAP_EVERY[0] + r() * (GHAT.GAP_EVERY[1] - GHAT.GAP_EVERY[0])) {
      let best = s, bk = -1;
      for (let q = s - 60; q <= s + 60; q += 10) { const k = curv(q); if (k > bk) { bk = k; best = q; } }
      const len = GHAT.GAP_LEN[0] + r() * (GHAT.GAP_LEN[1] - GHAT.GAP_LEN[0]);
      gaps.push([best - len / 2, best + len / 2]);
    }
    gaps.sort((a, b) => a[0] - b[0]);

    // ---- rail posts and beams, in runs between the gaps
    const c = new THREE.Vector3(), t = new THREE.Vector3();
    const at = (s, lat, out) => {
      centreAt(-s, c); centreTangent(-s, t);
      return out.set(c.x + t.z * lat, c.y, c.z - t.x * lat);    // (t.z, -t.x): + lateral = the rider's right
    };
    const posts = [], beams = [], terms = [];
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    let prev = null;
    for (let s = -60; s < finishS + 120; s += GHAT.POST_EVERY) {
      const lat = side * (edgeAt(Math.max(0, s), side) + CFG.KERB_W + GHAT.RAIL_OFF);
      if (cliffGapAt(s)) { if (prev) terms.push(prev.p.clone()); prev = null; continue; }
      at(s, lat, pa);
      if (!prev && s > -60) terms.push(pa.clone());           // a run starts after a gap
      posts.push(pa.clone());
      if (prev) beams.push([prev.p.clone(), pa.clone()]);
      prev = { s, p: pa.clone() };
    }
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), e = new THREE.Euler();
    const postGeo = new THREE.BoxGeometry(0.12, 0.8, 0.12);
    const postInst = new THREE.InstancedMesh(postGeo, this.steel, posts.length);
    posts.forEach((p, i) => { m.compose(pv.set(p.x, p.y + 0.4, p.z), qq.identity(), sc.set(1, 1, 1)); postInst.setMatrixAt(i, m); });
    postInst.castShadow = true;
    this.group.add(postInst);
    // the W-beam: one box per span, at bumper height
    const beamGeo = new THREE.BoxGeometry(0.06, 0.32, 1);
    const beamInst = new THREE.InstancedMesh(beamGeo, this.steel, beams.length);
    beams.forEach(([a, b], i) => {
      const len = a.distanceTo(b);
      e.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
      m.compose(pv.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.58, (a.z + b.z) / 2), qq.setFromEuler(e), sc.set(1, 1, len + 0.05));
      beamInst.setMatrixAt(i, m);
    });
    beamInst.castShadow = true;
    this.group.add(beamInst);
    // terminal posts at every gap: red and white bands
    const bandGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.26, 10);
    for (const [k, mat] of [[0, this.red], [1, this.white], [2, this.red], [3, this.white]]) {
      const inst = new THREE.InstancedMesh(bandGeo, mat, terms.length);
      terms.forEach((p, i) => { m.compose(pv.set(p.x, p.y + 0.13 + k * 0.26, p.z), qq.identity(), sc.set(1, 1, 1)); inst.setMatrixAt(i, m); });
      this.group.add(inst);
    }
    // ---- milestones on the rock side: white stones with a yellow cap, every 100 m
    const stones = [];
    for (let s = 50; s < finishS; s += 100) stones.push(at(s, -side * (edgeAt(Math.max(0, s), -side) + CFG.KERB_W + 1.3), new THREE.Vector3()));
    const stoneGeo = new THREE.BoxGeometry(0.34, 0.5, 0.16), capGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.16, 12, 1, false, 0, Math.PI);
    const sInst = new THREE.InstancedMesh(stoneGeo, this.white, stones.length);
    const cInst = new THREE.InstancedMesh(capGeo, this.yellow, stones.length);
    stones.forEach((p, i) => {
      const s = 50 + i * 100;
      centreTangent(-s, t);
      e.set(0, Math.atan2(t.x, t.z), 0); qq.setFromEuler(e);
      m.compose(pv.set(p.x, p.y + 0.25, p.z), qq, sc.set(1, 1, 1)); sInst.setMatrixAt(i, m);
      e.set(Math.PI / 2, Math.atan2(t.x, t.z), 0, 'YXZ'); qq.setFromEuler(e);
      m.compose(pv.set(p.x, p.y + 0.5, p.z), qq, sc.set(1, 1, 1)); cInst.setMatrixAt(i, m);
    });
    this.group.add(sInst, cInst);
    return gaps.length;
  }
}
