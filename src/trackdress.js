// RideRash — the furniture that makes a road readable at speed.
//
// A bend you cannot read is a bend you find out about in the barrier. With the
// twisty sections in level.js the road needs what real ones have:
//
//   CHEVRONS   black-on-yellow boards on the OUTSIDE of every tight bend,
//              pointing into it -- the corner announces its direction and how
//              long it lasts;
//   RAILS      steel guard rail along that outside edge;
//   WARNINGS   a "winding road" sign before each twisty section;
//   COUNTDOWN  1000 / 500 / 200 m boards before the finish;
//   START      a gantry over the grid (the FINISH one is finishline.js).
//
// Built per course in __START__ (the finish moves with the course), instanced
// per kind, all code-built (HANDOFF §4.2: no imported meshes or textures).
import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, headAt } from './level.js';
import { buildFinish, placeFinish } from './finishline.js';

const TIGHT_R = 700;       // m: bends tighter than this get chevrons and a rail
const CHEV_STEP = 22;      // m between chevrons through a bend
const RAIL_STEP = 6;       // m per rail segment

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();

// Signed curvature at s: + means the inside of the bend is +lateral.
function curvature(s, L = 20) {
  centreAt(-s, _a); centreAt(-(s + L), _b); headAt(-s, _t);
  const nx = -_t.z, nz = _t.x;
  return 2 * ((_b.x - _a.x) * nx + (_b.z - _a.z) * nz) / (L * L);
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function chevronTex(dir) {
  return canvasTex(128, 160, (g, w, h) => {
    g.fillStyle = '#f2c313'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    // a thick chevron pointing +x (dir = 1) or -x (dir = -1)
    const cx = w / 2, cy = h / 2;
    const P = [[-34, -56], [2, -56], [40, 0], [2, 56], [-34, 56], [4, 0]];
    g.fillStyle = '#111';
    g.beginPath();
    P.forEach(([x, y], i) => (i ? g.lineTo(cx + dir * x, cy + y) : g.moveTo(cx + dir * x, cy + y)));
    g.closePath(); g.fill();
  });
}

function textBoard(text, bg = '#1e5aa8', fg = '#fff', w = 256, h = 128, font = 72) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg; g.font = `bold ${font}px Impact, "Arial Black", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3);
  });
}

function windingTex() {
  return canvasTex(128, 128, (g, w, h) => {
    // a diamond warning sign with an S-bend
    g.translate(w / 2, h / 2); g.rotate(Math.PI / 4);
    g.fillStyle = '#f2c313'; g.fillRect(-42, -42, 84, 84);
    g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(-40, -40, 80, 80);
    g.rotate(-Math.PI / 4);
    g.strokeStyle = '#111'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-6, 34); g.bezierCurveTo(28, 10, -28, -8, 6, -34); g.stroke();
  });
}

// Place a matrix at road (s, lateral), height y, facing the approaching rider.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _sc = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
function roadMatrix(s, lateral, y, yawExtra = 0, scale = 1) {
  centreAt(-s, _p); headAt(-s, _t);
  const nx = -_t.z, nz = _t.x;
  _p.x += nx * lateral; _p.z += nz * lateral; _p.y += y;
  // a PlaneGeometry faces +z; the rider comes along +travel (_t), so the board
  // faces back along -_t
  _e.set(0, Math.atan2(-_t.x, -_t.z) + yawExtra, 0);
  _q.setFromEuler(_e);
  _sc.set(scale, scale, scale);
  return _m.compose(_p, _q, _sc);
}

export class TrackDress {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'trackdress';
    scene.add(this.group);
    const post = new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.6, name: 'td_post' });
    this.mats = {
      chevR: new THREE.MeshBasicMaterial({ map: chevronTex(1), name: 'td_chevR' }),
      chevL: new THREE.MeshBasicMaterial({ map: chevronTex(-1), name: 'td_chevL' }),
      wind: new THREE.MeshBasicMaterial({ map: windingTex(), transparent: true, name: 'td_wind' }),
      post,
      rail: new THREE.MeshStandardMaterial({ color: 0xc7ccd1, roughness: 0.35, metalness: 0.75, name: 'td_rail' }),
      back: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.8, name: 'td_back' }),
    };
    this.geos = {
      board: new THREE.PlaneGeometry(1.3, 1.6),
      post: new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6),
      rail: new THREE.BoxGeometry(0.08, 0.32, RAIL_STEP + 0.05),
      railPost: new THREE.BoxGeometry(0.1, 0.8, 0.1),
      sign: new THREE.PlaneGeometry(1.3, 1.3),
      count: new THREE.PlaneGeometry(1.8, 0.9),
    };
    this.start = buildFinish('START');
    this.scene.add(this.start);
  }

  _clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c.isInstancedMesh) c.dispose();
      if (c.userData.ownMat) { c.material.map && c.material.map.dispose(); c.material.dispose(); }
    }
  }

  /** Dress the course from s = 0 to `finishS`. */
  build(finishS) {
    this._clear();
    const half = CFG.ROAD_W / 2 + CFG.KERB_W;
    const chevR = [], chevL = [], posts = [], rails = [], railPosts = [], winds = [];
    let straightRun = 400, lastChev = -1e9;
    for (let s = 40; s < finishS + 200; s += RAIL_STEP) {
      const k = curvature(s);
      const R = 1 / Math.max(1e-6, Math.abs(k));
      const tight = R < TIGHT_R;
      if (!tight) { straightRun += RAIL_STEP; continue; }
      // a twisty section begins after a long straight: warn 180 m before
      if (straightRun > 350 && s > 250) winds.push(s - 180);
      straightRun = 0;
      const outside = -Math.sign(k);                     // the side the bend throws you to
      const lat = outside * (half + 1.3);
      // RAIL, continuous along the outside
      rails.push(roadMatrix(s, outside * (half + 0.9), 0.55).clone());
      if (Math.round(s / RAIL_STEP) % 2 === 0) railPosts.push(roadMatrix(s, outside * (half + 0.9), 0.4).clone());
      // CHEVRONS, pointing INTO the bend: the inside is +lateral when k > 0,
      // which from the rider's seat is to his right -> a right-pointing chevron
      if (s - lastChev >= CHEV_STEP) {
        lastChev = s;
        (k > 0 ? chevR : chevL).push(roadMatrix(s, lat, 1.75).clone());
        posts.push(roadMatrix(s, lat, 0.8).clone());
      }
    }
    const inst = (geo, mat, list) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((x, i) => m.setMatrixAt(i, x));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
    };
    inst(this.geos.board, this.mats.chevR, chevR);
    inst(this.geos.board, this.mats.chevL, chevL);
    inst(this.geos.post, this.mats.post, posts);
    // rails run ALONG the road: the box is long in z, so turn it 90 deg off the
    // board orientation (boards face back down the road, rails lie along it)
    inst(this.geos.rail, this.mats.rail, rails);
    inst(this.geos.railPost, this.mats.post, railPosts);
    // warning signs on the right verge, each on a post
    const signs = winds.map((s) => roadMatrix(s, half + 1.6, 2.1).clone());
    inst(this.geos.sign, this.mats.wind, signs);
    inst(this.geos.post, this.mats.post, winds.map((s) => roadMatrix(s, half + 1.6, 0.8).clone()));
    // countdown boards
    for (const d of [1000, 500, 200]) {
      const s = finishS - d;
      if (s < 100) continue;
      const mat = new THREE.MeshBasicMaterial({ map: textBoard(`${d} m`, '#1d6b3a'), name: 'td_count' });
      for (const side of [-1, 1]) {
        const board = new THREE.Mesh(this.geos.count, mat);
        board.matrixAutoUpdate = false;
        board.matrix.copy(roadMatrix(s, side * (half + 1.8), 2.3));
        board.userData.ownMat = side === 1;
        this.group.add(board);
        const p = new THREE.Mesh(this.geos.post, this.mats.post);
        p.matrixAutoUpdate = false;
        p.matrix.copy(roadMatrix(s, side * (half + 1.8), 0.8));
        this.group.add(p);
      }
    }
    placeFinish(this.start, 12);
    this.stats = { chevrons: chevR.length + chevL.length, railM: rails.length * RAIL_STEP, warnings: winds.length };
    return this.stats;
  }
}
