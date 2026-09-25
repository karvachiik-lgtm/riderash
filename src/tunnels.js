// RideRash — TUNNELS: where the road goes through the hill instead of round it.
//
// Road Rash's Pacific Coast Highway (PC / 3DO, 1994-96) ran periodic
// pitch-black tunnel sections through the headlands; the ghat bores through
// the ridge where the road swaps flanks. One module for both:
//
//   courseTunnels  where they are: the ghat's come from its generated design
//                  (ghatdesign.js 'tunnel' sections); PACIFIC COAST gets 2-3
//                  procedural ones in its coast and forest sectors, clear of the
//                  crossroads and the four-lane stretches, seeded by the level
//   tunnelK(s)     0 outside .. 1 inside (eased over the mouths) -- main.js
//                  darkens the light by it: a tunnel is DARK, lit only by its lamps
//   TunnelDress    the arch rings, lamps, a rock portal at each mouth, and the
//                  hill itself: a height-field mound over the bore, falling away
//                  to the ground around it, so a headland visibly swallows the road
import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, centreTangent } from './level.js';
import { edgeAt, crossingNear, lanesAt } from './lanes.js';
import { ghatDesign } from './ghatdesign.js';

export const TUNNEL = {
  H: 6.8,                 // m: crown height over the deck
  RAMP: 22,               // m: the light fades over this at each mouth
  COAST: { N: [2, 3], LEN: [120, 240], BIOMES: new Set(['coast', 'forest']) },
};

let list = [];            // [[s0, s1]], sorted
export function courseTunnels() { return list; }
/** 0 outside a tunnel .. 1 inside, eased over the mouths. */
export function tunnelK(s) {
  for (const [a, b] of list) {
    if (s < a - TUNNEL.RAMP) return 0;
    if (s <= b + TUNNEL.RAMP) {
      const k = Math.min(1, (s - (a - TUNNEL.RAMP)) / (2 * TUNNEL.RAMP), ((b + TUNNEL.RAMP) - s) / (2 * TUNNEL.RAMP));
      return Math.max(0, Math.min(1, k));
    }
  }
  return 0;
}

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Decide this course's tunnels (call per race, after the road profile and lane plan). */
export function setCourseTunnels(mapId, spine, finishS, seed = 1) {
  list = [];
  if (mapId === 'ghat') {
    for (const [a, b, , kind] of ghatDesign().sections) if (kind === 'tunnel' && a < finishS + 200) list.push([a, b]);
  } else if (mapId === 'coastal' && spine && spine.bounds) {
    const r = prng(0xc0a57 ^ seed);
    const n = TUNNEL.COAST.N[0] + Math.floor(r() * (TUNNEL.COAST.N[1] - TUNNEL.COAST.N[0] + 1));
    const ok = (a, b) => {
      for (let s = a - 40; s <= b + 40; s += 10) {
        const bd = spine.bounds[spine.sectorAt(s)];
        if (!bd || !TUNNEL.COAST.BIOMES.has(bd.biome)) return false;
        if (crossingNear(s, 30)) return false;
        const L = lanesAt(s);
        if (L.r > 1.05 || L.l > 1.05) return false;                 // two-lane road only
      }
      return !list.some(([x, y]) => a < y + 400 && b > x - 400);
    };
    for (let tries = 0; tries < 80 && list.length < n; tries++) {
      const len = TUNNEL.COAST.LEN[0] + r() * (TUNNEL.COAST.LEN[1] - TUNNEL.COAST.LEN[0]);
      const a = 500 + r() * (finishS - 900);
      if (ok(a, a + len)) list.push([a, a + len]);
    }
  }
  list.sort((x, y) => x[0] - y[0]);
  return list;
}

const _c = new THREE.Vector3(), _t = new THREE.Vector3();
function at(s, lat, out, dy = 0) {                      // + lateral = the rider's right
  centreAt(-s, _c); centreTangent(-s, _t);
  return out.set(_c.x + _t.z * lat, _c.y + dy, _c.z - _t.x * lat);
}
const yawAt = (s) => { centreTangent(-s, _t); return Math.atan2(_t.x, _t.z); };

export class TunnelDress {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'tunnels';
    scene.add(this.group);
    this.mat = {
      lining: new THREE.MeshStandardMaterial({ color: 0x55534d, roughness: 0.95 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0xffe7a8, roughness: 0.5, emissive: 0xffc860, emissiveIntensity: 2.2 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x584d43, roughness: 0.95, flatShading: true }),
      hill: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
      band: new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.6 }),
    };
  }
  _clear() { for (const c of [...this.group.children]) { this.group.remove(c); if (c.geometry) c.geometry.dispose(); } }

  build() {
    this._clear();
    const H = TUNNEL.H;
    const M = (p, yaw, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(sx, sy, sz));
    const v = () => new THREE.Vector3();
    for (const [a, b] of list) {
      let W = 0;
      for (let s = a; s <= b; s += 10) W = Math.max(W, edgeAt(s, 1), edgeAt(s, -1));
      W += CFG.KERB_W + 1.6;
      // ---- the bore: arch rings every 3 m, lamps in the crown every 12 m
      const arch = new THREE.Shape();
      arch.moveTo(-W - 0.8, -0.3); arch.lineTo(-W - 0.8, H * 0.6); arch.quadraticCurveTo(-W - 0.8, H + 0.8, 0, H + 0.8);
      arch.quadraticCurveTo(W + 0.8, H + 0.8, W + 0.8, H * 0.6); arch.lineTo(W + 0.8, -0.3);
      arch.lineTo(W, -0.3); arch.lineTo(W, H * 0.6); arch.quadraticCurveTo(W, H, 0, H);
      arch.quadraticCurveTo(-W, H, -W, H * 0.6); arch.lineTo(-W, -0.3); arch.closePath();
      const ringGeo = new THREE.ExtrudeGeometry(arch, { depth: 3.05, bevelEnabled: false, curveSegments: 6 });
      ringGeo.translate(0, 0, -1.5);
      const rings = [], lamps = [], bands = [];
      for (let s = a; s < b; s += 3) {
        rings.push(M(at(s + 1.5, 0, v()), yawAt(s + 1.5)));
        if (Math.round((s - a) / 3) % 4 === 0) {
          lamps.push(M(at(s + 1.5, -W * 0.45, v(), H * 0.93), yawAt(s + 1.5), 0.35, 0.14, 1.4));
          lamps.push(M(at(s + 1.5, W * 0.45, v(), H * 0.93), yawAt(s + 1.5), 0.35, 0.14, 1.4));
        }
        // a yellow reflective band along each wall, the way the eye finds the edge in the dark
        for (const sd of [-1, 1]) bands.push(M(at(s + 1.5, sd * (W - 0.05), v(), 1.0), yawAt(s + 1.5), 0.08, 0.22, 3.02));
      }
      this._inst(ringGeo, this.mat.lining, rings, true);
      this._inst(new THREE.BoxGeometry(1, 1, 1), this.mat.lamp, lamps, false);
      this._inst(new THREE.BoxGeometry(1, 1, 1), this.mat.band, bands, false);
      // ---- portals: a rock face with the arch cut through it, at each mouth
      const face = new THREE.Shape();
      face.moveTo(-40, -6); face.lineTo(40, -6); face.lineTo(34, 24); face.lineTo(-34, 24); face.closePath();
      const hole = new THREE.Path();
      hole.moveTo(-W, -0.3); hole.lineTo(-W, H * 0.6); hole.quadraticCurveTo(-W, H, 0, H); hole.quadraticCurveTo(W, H, W, H * 0.6); hole.lineTo(W, -0.3); hole.closePath();
      face.holes.push(hole);
      const faceGeo = new THREE.ExtrudeGeometry(face, { depth: 4, bevelEnabled: false, curveSegments: 6 });
      faceGeo.translate(0, 0, -2);
      this._inst(faceGeo, this.mat.rock, [M(at(a, 0, v()), yawAt(a)), M(at(b, 0, v()), yawAt(b))], true);
      // ---- the hill over the bore: a height field in the road's frame
      this._hill(a, b, W, H);
    }
  }

  _hill(a, b, W, H) {
    const S0 = a - 70, S1 = b + 70, DS = 6, LATS = [];
    for (let l = -90; l <= 90; l += 6) LATS.push(l);
    const pos = [], col = [], idx = [], p = new THREE.Vector3(), c = new THREE.Color();
    const green = new THREE.Color(0x4f6a34), rock = new THREE.Color(0x6f6254);
    let rows = 0;
    for (let s = S0; s <= S1 + 1e-6; s += DS, rows++) {
      const inside = s >= a && s <= b;
      const dOut = inside ? 0 : Math.min(Math.abs(s - a), Math.abs(s - b));
      for (const l of LATS) {
        const al = Math.abs(l);
        // the crown sits well over the arch; the hill rolls off to the sides and ends
        const ridge = (H + 6 + 16 * Math.cos(Math.min(1, al / 90) * Math.PI / 2)) * Math.max(0, 1 - dOut / 70);
        const n = Math.sin(s * 0.08 + l * 0.13) * 1.6 + Math.sin(s * 0.023 - l * 0.05) * 2.4;
        let h = ridge + n * (ridge > 1 ? 1 : 0);
        // outside the bore the road stays open: the hill is cut away over the deck
        if (!inside && al < W + 2) h = Math.min(h, -2);
        if (inside && al < W + 1) h = Math.max(h, H + 1.5);
        at(s, l, p, h - 0.5);
        pos.push(p.x, p.y, p.z);
        c.copy(green).lerp(rock, Math.min(1, Math.max(0, 1 - ridge / 14) * 0.2 + (al < W + 6 ? 0.5 : 0.15)));
        col.push(c.r, c.g, c.b);
      }
    }
    const C = LATS.length;
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < C - 1; k++) {
      // no cell over the open road outside the bore: it would be a wall across
      // the carriageway in front of the mouth (the portal face closes the notch)
      const sA = S0 + r * DS, sB = sA + DS;
      const overRoad = Math.max(Math.abs(LATS[k]), Math.abs(LATS[k + 1])) <= W + 2 + 6 && Math.min(Math.abs(LATS[k]), Math.abs(LATS[k + 1])) < W + 2;
      if (overRoad && (sA < a || sB > b)) continue;
      const i0 = r * C + k, i1 = i0 + 1, i2 = i0 + C, i3 = i2 + 1;
      idx.push(i0, i1, i2, i1, i3, i2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat.hill);
    m.material.side = THREE.DoubleSide;
    m.receiveShadow = true; m.castShadow = true;
    this.group.add(m);
  }

  _inst(geo, mat, mats, shadow) {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadow; im.receiveShadow = true; im.computeBoundingSphere();
    this.group.add(im);
  }
}
