// RideRash — the ghat's VALLEY: what you see over the edge.
//
// Reference set (Atlas, _refs/ghat/): a turquoise river braided with pale
// sandbanks, bright terraced paddies on its bends, pink and white blossom
// along the banks, a red-tiled hamlet under palms, waterfalls down the cut
// rock, mist lying in the valley, and ridge behind ridge fading blue.
//
// All of it is PROCEDURAL and seeded, and all of it lives on the valley floor
// (ghatdesign.js GHAT_FLOOR: one flat height for the course, which scenery.js's
// cliff relief falls to) on whichever side the road drops. It is laid out along
// a heavily SMOOTHED copy of the road, not the road itself: an offset of a 32 m
// swirl at 200 m folds back on itself, a ±320 m moving average of it does not.
//
// Cost: ~12 draw calls (every repeated thing instanced), one water material
// whose texture scrolls, updated from main.js (update(dt)).
import * as THREE from 'three';
import { centreAt, roadProfile } from './level.js';
import { edgeAt } from './lanes.js';
import { CFG } from './config.js';
import { ghatDesign, ghatSection, GHAT_FLOOR } from './ghatdesign.js';

export const VALLEY = {
  SMOOTH: 320,             // m: half-window of the path the valley follows
  RIVER_OFF: [170, 250],   // m out from the smoothed road, on the drop side
  RIVER_W: [22, 38],
  PAL: {                   // from the Atlas references
    water: 0x3f9a8f, shallows: 0x7cc0b2, sand: 0xd8ccb2,
    paddy: [0x7fa21e, 0x9bc33a, 0x6d9a2a, 0x86a860], bund: 0x6b7a3a,
    blossom: [0xef9cc4, 0xf6d4e4, 0xd8679a, 0xffffff], trunk: 0x4a3a30,
    wall: 0xe6dccb, roof: 0xc4613a, palm: 0x3f6a2a,
    mist: 0xd6dde2, ridge: [0x3f5a4c, 0x5d7474, 0x7d919c],
    fall: 0xe8f4f6,
  },
};

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export class ValleyDress {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'valley';
    scene.add(this.group);
    const P = VALLEY.PAL;
    this.waterTex = waterTexture();
    this.fallTex = fallTexture();
    this.mat = {
      // (double-sided: the ribbons' winding depends on which bank is which)
      water: new THREE.MeshStandardMaterial({ color: P.water, roughness: 0.18, metalness: 0.1, map: this.waterTex, side: THREE.DoubleSide }),
      sand: new THREE.MeshStandardMaterial({ color: P.sand, roughness: 0.95, side: THREE.DoubleSide }),
      paddy: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
      blossom: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }),
      trunk: new THREE.MeshStandardMaterial({ color: P.trunk, roughness: 0.9 }),
      wall: new THREE.MeshStandardMaterial({ color: P.wall, roughness: 0.9 }),
      roof: new THREE.MeshStandardMaterial({ color: P.roof, roughness: 0.75, flatShading: true }),
      palm: new THREE.MeshStandardMaterial({ color: P.palm, roughness: 0.8, flatShading: true }),
      mist: new THREE.MeshBasicMaterial({ color: P.mist, map: mistTexture(), transparent: true, opacity: 0.55, depthWrite: false, fog: true }),
      ridge: P.ridge.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true, fog: true })),
      fall: new THREE.MeshBasicMaterial({ color: P.fall, map: this.fallTex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    };
  }

  _clear() {
    for (const c of [...this.group.children]) { this.group.remove(c); if (c.geometry) c.geometry.dispose(); }
  }

  update(dt) {
    if (!this.group.children.length) return;
    this.waterTex.offset.y -= dt * 0.05;
    this.fallTex.offset.y += dt * 1.4;
  }

  /** Lay the valley for this course (a cliff course only; call per race). */
  build(finishS, seed = 1) {
    this._clear();
    if (!roadProfile().cliff) return 0;
    const D = ghatDesign();
    const r = prng(0x7a11e ^ seed);
    const end = finishS + 500, start = -300;
    const FLOOR = GHAT_FLOOR;

    // ---- the smoothed path: centre and normal every 10 m
    const STEP = 10, raw = [];
    for (let s = start - VALLEY.SMOOTH; s <= end + VALLEY.SMOOTH; s += STEP) raw.push(centreAt(-s));
    const W = Math.round(VALLEY.SMOOTH / STEP), path = [];
    for (let i = W; i < raw.length - W; i++) {
      const c = new THREE.Vector3();
      for (let k = -W; k <= W; k++) c.add(raw[i + k]);
      c.multiplyScalar(1 / (2 * W + 1));
      path.push({ s: start + (i - W) * STEP, c });
    }
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)].c, b = path[Math.min(path.length - 1, i + 1)].c;
      const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();   // toward -z (travel)
      path[i].rn = new THREE.Vector3(-t.z, 0, t.x);                         // the rider's RIGHT
    }
    const P = (i, lat, y = FLOOR) => { const p = path[i]; return new THREE.Vector3(p.c.x + p.rn.x * lat, y, p.c.z + p.rn.z * lat); };
    const dropSide = (s) => { const sd = ghatSection(Math.max(0, s))[2]; return sd === 1 || sd === -1 ? sd : 0; };

    // ---- the river: one continuous ribbon per flank, on the drop side; each
    // bridge gets its own river running under it across the road
    const mats = { blossom: [], trunk: [], paddy: [], wall: [], roof: [], palm: [], ptrunk: [] };
    const cols = { blossom: [], paddy: [] };
    const M = (p, yaw, sx, sy, sz, pitch = 0) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    const C = (hex) => new THREE.Color(hex);
    const riverPos = [], riverIdx = [], riverUV = [], sandPos = [], sandIdx = [];
    const ribbon = (pts, widths, pos, idx, uv, y) => {
      const base = pos.length / 3;
      let acc = 0;
      for (let i = 0; i < pts.length; i++) {
        const [p, n] = pts[i], w = widths[i];
        pos.push(p.x - n.x * w, y, p.z - n.z * w, p.x + n.x * w, y, p.z + n.z * w);
        if (uv) { if (i) acc += pts[i][0].distanceTo(pts[i - 1][0]); uv.push(0, acc / 40, 1, acc / 40); }
        if (i) { const b = base + (i - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
    };
    let run = null;
    const flush = () => {
      if (run && run.length > 3) {
        ribbon(run.map((q) => [q.p, q.n]), run.map((q) => q.w), riverPos, riverIdx, riverUV, FLOOR + 1.3);
        ribbon(run.map((q) => [q.p, q.n]), run.map((q) => q.w + 9 + 6 * Math.sin(q.s * 0.013)), sandPos, sandIdx, null, FLOOR + 1.1);
      }
      run = null;
    };
    const riverAt = [];                                   // for placing things beside it
    const ph = r() * 6.28;
    for (let i = 0; i < path.length; i++) {
      const s = path[i].s, sd = dropSide(s);
      if (!sd) { flush(); continue; }
      const off = sd * (VALLEY.RIVER_OFF[0] + (VALLEY.RIVER_OFF[1] - VALLEY.RIVER_OFF[0]) * (0.5 + 0.5 * Math.sin(s * 0.0035 + ph)));
      const w = (VALLEY.RIVER_W[0] + (VALLEY.RIVER_W[1] - VALLEY.RIVER_W[0]) * (0.5 + 0.5 * Math.sin(s * 0.009 + ph * 2))) / 2;
      const p = P(i, off);
      (run || (run = [])).push({ p, n: path[i].rn.clone(), w, s });
      riverAt.push({ i, s, off, w, sd });
    }
    flush();
    // under each bridge: a river crossing the road, out to both valley sides
    for (const [a, b, side] of D.sections) {
      if (side !== 2 || a > end) continue;
      const sm = (a + b) / 2, c = centreAt(-sm), t = centreAt(-(sm + 1)).sub(c).setY(0).normalize();
      const pts = [], ws = [];
      for (let k = -30; k <= 30; k++) {
        const along = k * 14, wig = Math.sin(k * 0.35) * 18;
        const p = new THREE.Vector3(c.x + (-t.z) * along + t.x * wig, 0, c.z + t.x * along + t.z * wig);
        pts.push([p, t.clone()]); ws.push(16 + 4 * Math.sin(k * 0.5));
      }
      ribbon(pts, ws, riverPos, riverIdx, riverUV, FLOOR + 1.3);
      ribbon(pts, ws.map((w) => w + 10), sandPos, sandIdx, null, FLOOR + 1.1);
    }
    const mesh = (pos, idx, uv, mat) => {
      if (!idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.group.add(m);
    };
    mesh(riverPos, riverIdx, riverUV, this.mat.water);
    mesh(sandPos, sandIdx, null, this.mat.sand);

    // ---- beside the river: paddies on the inside, blossom on the banks,
    // hamlets now and then, palms among them
    const PAL = VALLEY.PAL;
    for (let k = 0; k < riverAt.length; k += 1) {
      const q = riverAt[k];
      // blossom along both banks, every ~20 m, in clumps
      if (r() < 0.55) {
        for (const bank of [-1, 1]) {
          const lat = q.off + bank * q.sd * (q.w + 8 + r() * 14);
          const p = P(q.i, lat, FLOOR);
          const h = 5 + r() * 5, cw = 3 + r() * 3;
          mats.trunk.push(M(p.clone().setY(FLOOR + h * 0.35), 0, 0.45, h * 0.7, 0.45));
          mats.blossom.push(M(p.clone().setY(FLOOR + h * 0.85), r() * 6.28, cw, cw * 0.75, cw));
          cols.blossom.push(C(PAL.blossom[(r() * PAL.blossom.length) | 0]));
        }
      }
      // terraced paddies between the road's foot and the river, every 30 m
      if (k % 3 === 0) {
        const inner = q.off - q.sd * (q.w + 14);
        for (let j = 0; j < 3; j++) {
          const lat = inner - q.sd * (j * 26 + r() * 6);
          const p = P(q.i, lat, FLOOR + 1.0 + j * 0.9);
          const yaw = Math.atan2(path[q.i].rn.x, path[q.i].rn.z);
          mats.paddy.push(M(p, yaw, 22 + r() * 4, 0.5, 24 + r() * 8));
          cols.paddy.push(C(PAL.paddy[(r() * PAL.paddy.length) | 0]));
        }
      }
      // a hamlet on the far bank
      if (k % 45 === 20) {
        const cx = q.off + q.sd * (q.w + 40), n = 5 + ((r() * 6) | 0);
        const yaw0 = Math.atan2(path[q.i].rn.x, path[q.i].rn.z);
        for (let h = 0; h < n; h++) {
          const p = P(Math.min(path.length - 1, q.i + ((r() * 8) | 0) - 4), cx + q.sd * r() * 40, FLOOR);
          const w = 6 + r() * 4, d = 5 + r() * 3, yaw = yaw0 + (r() - 0.5) * 0.5;
          mats.wall.push(M(p.clone().setY(FLOOR + 1.6), yaw, w, 3.2, d));
          mats.roof.push(M(p.clone().setY(FLOOR + 3.9), yaw, w * 1.12, 1.6, d * 1.15));
          if (r() < 0.6) {
            const pp = p.clone().add(new THREE.Vector3(r() * 8 - 4, 0, r() * 8 - 4));
            const ph2 = 9 + r() * 5;
            mats.ptrunk.push(M(pp.clone().setY(FLOOR + ph2 / 2), 0, 0.35, ph2, 0.35));
            mats.palm.push(M(pp.clone().setY(FLOOR + ph2), r() * 6.28, 4.2, 1.2, 4.2));
          }
        }
      }
    }
    const inst = (geo, mat, list, colors, shadow = false) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => { im.setMatrixAt(i, m); if (colors) im.setColorAt(i, colors[i]); });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    };
    inst(new THREE.CylinderGeometry(0.5, 0.7, 1, 6), this.mat.trunk, mats.trunk);
    inst(new THREE.IcosahedronGeometry(1, 0), this.mat.blossom, mats.blossom, cols.blossom);
    inst(new THREE.BoxGeometry(1, 1, 1), this.mat.paddy, mats.paddy, cols.paddy);
    inst(new THREE.BoxGeometry(1, 1, 1), this.mat.wall, mats.wall);
    inst(roofGeo(), this.mat.roof, mats.roof);
    inst(new THREE.CylinderGeometry(0.5, 0.7, 1, 5), this.mat.trunk, mats.ptrunk);
    inst(new THREE.ConeGeometry(1, 1, 7, 1, true), this.mat.palm, mats.palm);

    // ---- blossom on the drop's lip, seen right beside the road
    {
      const lip = [], lipC = [], lipT = [];
      for (let s = 40; s < end; s += 9 + r() * 14) {
        const sd = dropSide(s);
        if (!sd || r() < 0.45) continue;
        const c = centreAt(-s), t = centreAt(-(s + 1)).sub(c).setY(0).normalize();
        const lat = sd * (edgeAt(Math.max(0, s), sd) + CFG.KERB_W + 9 + r() * 10);
        const x = c.x + t.z * lat, z = c.z - t.x * lat;
        // the tree stands on the face, well below the deck: only its crown shows
        const y = c.y - 6 - r() * 8, h = 7 + r() * 4, cw = 3.5 + r() * 2.5;
        lipT.push(M(new THREE.Vector3(x, y + h * 0.4, z), 0, 0.5, h * 0.8, 0.5));
        lip.push(M(new THREE.Vector3(x, y + h, z), r() * 6.28, cw, cw * 0.8, cw));
        lipC.push(C(PAL.blossom[(r() * PAL.blossom.length) | 0]));
      }
      inst(new THREE.CylinderGeometry(0.5, 0.7, 1, 6), this.mat.trunk, lipT);
      inst(new THREE.IcosahedronGeometry(1, 0), this.mat.blossom, lip, lipC);
    }

    // ---- waterfalls down the rock wall, now and then
    {
      const falls = [];
      for (let s = 300 + r() * 300; s < end; s += 450 + r() * 500) {
        const sd = ghatSection(s)[2];
        if (sd !== 1 && sd !== -1) continue;
        const wallSide = -sd;
        const c = centreAt(-s), t = centreAt(-(s + 1)).sub(c).setY(0).normalize();
        const lat = wallSide * (edgeAt(s, wallSide) + CFG.KERB_W + 2.2 + 4.5);
        const x = c.x + t.z * lat, z = c.z - t.x * lat;
        const h = 26 + r() * 10;
        const m = M(new THREE.Vector3(x, c.y + h / 2 - 0.5, z), Math.atan2(t.x, t.z), 3.5 + r() * 3, h, 1, -wallSide * 0.12);
        falls.push(m);
      }
      inst(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), this.mat.fall, falls);
    }

    // ---- mist lying in the valley, and ridge behind ridge
    {
      const mist = [];
      for (let i = 0; i < path.length; i += 14) {
        const sd = dropSide(path[i].s) || (r() < 0.5 ? 1 : -1);
        const p = P(i, sd * (200 + r() * 250), FLOOR + 22 + r() * 18);
        mist.push(M(p, r() * 6.28, 260 + r() * 200, 1, 120 + r() * 80));
      }
      inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.mat.mist, mist);
      // three ridge bands each side, further, higher and bluer out
      const bands = [[650, 90, 0], [1050, 150, 1], [1600, 230, 2]];
      for (const [off, hgt, k] of bands) {
        for (const side of [-1, 1]) {
          const pos = [], idx = [];
          let n = 0;
          for (let i = 0; i < path.length; i += 3) {
            const s = path[i].s;
            // peaks and saddles, not a wall: a sharpened |sin| ridge line plus a ripple
            const pk = Math.pow(Math.abs(Math.sin(s * 0.0042 + off * 0.01 + side)), 0.7);
            const hh = hgt * (0.3 + 0.7 * pk) + hgt * 0.12 * Math.sin(s * 0.019 + k * 2);
            const top = P(i, side * off, FLOOR + hh), foot = P(i, side * (off - 160), FLOOR - 5);
            pos.push(foot.x, foot.y, foot.z, top.x, top.y, top.z);
            if (n) { const b = (n - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
            n++;
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
          const m = new THREE.Mesh(g, this.mat.ridge[k]);
          m.material.side = THREE.DoubleSide;
          this.group.add(m);
        }
      }
    }
    return riverAt.length;
  }
}

// a hip roof: a squashed four-sided pyramid
function roofGeo() {
  const g = new THREE.ConeGeometry(0.72, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  return g;
}
// mist: a soft round bank, fading to nothing at its edge
function mistTexture() {
  const N = 64, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / (N - 1) * 2 - 1, v = y / (N - 1) * 2 - 1, r = Math.hypot(u, v);
    const a = Math.max(0, 1 - r) ** 2 * (0.8 + 0.2 * Math.sin(x * 0.7) * Math.sin(y * 0.5));
    const i = (y * N + x) * 4;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
  }
  const t = new THREE.DataTexture(d, N, N); t.needsUpdate = true;
  return t;
}
// water: soft ripples, tiled along the river
function waterTexture() {
  const N = 64, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = 0.5 + 0.25 * Math.sin((x / N) * 6.28 * 3 + Math.sin((y / N) * 6.28 * 2) * 2) + 0.25 * Math.sin((y / N) * 6.28 * 5 + (x / N) * 3);
    const i = (y * N + x) * 4, c = 200 + v * 55;
    d[i] = c; d[i + 1] = c; d[i + 2] = c; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}
// falling water: vertical streaks with alpha
function fallTexture() {
  const W = 32, H = 64, d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const streak = 0.5 + 0.5 * Math.sin(x * 1.7 + Math.sin(y * 0.3 + x) * 1.5);
    const edge = Math.sin((x / (W - 1)) * Math.PI);
    const i = (y * W + x) * 4;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = Math.min(255, 255 * edge * (0.35 + 0.65 * streak));
  }
  const t = new THREE.DataTexture(d, W, H); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}
