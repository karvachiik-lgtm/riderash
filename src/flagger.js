// RideRash — the starter: a person in the road with a chequered flag.
//
// Road Rash never started a race under a gantry. A starter stood out in front
// of the grid, flag up, and the pack went when it came down. This is that:
//
//   COUNTDOWN  flag held high, waving side to side over the front row
//   GO         the flag sweeps down toward the pack
//   CLEAR      she jogs back off the tarmac onto the verge, and waves the
//              field through from there
//
// The figure is the same rider builder every human in the game uses
// (assets/rider.js, from a spec with its own look), so she is rigged and
// animated with the same pose code. She stands just outside the grid's
// outermost column, so the pack streams past her rather than through her.
import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, headAt } from './level.js';
import { makeSpec } from './bodyspec.js';
import { poseStanding, armAim } from './riderpose.js';
import { mergeJoints } from '../assetlib.js';
import buildRider from '../assets/rider.js';

const MERGE_OPTS = { vertexColors: true, allNodes: true, keepColour: (h) => h === 0x1b1b1e };

export const FLAGGER = {
  S_AHEAD: 18,          // m from the start line: out in front of the front row (s = 8)
  LATERAL: 0.9,         // in the middle of the road, square in front of the pack
  VERGE: 7.6,           // where she runs to
  // s to get off the road. Timed against the front row: a rider rolling from
  // s = 8 reaches her at about 1.0 s after GO; with the ease-out below she is
  // past the lateral-2.2 column at 0.25 s and the 4.4 column at 0.65 s.
  CLEAR_T: 1.25,
  DROP_T: 0.35,         // s for the flag to sweep down
  HIDE_AFTER: 260,      // m past the start the player has to be before she is culled
};

function checker() {
  const W = 16, H = 12, d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const on = (((x >> 2) + (y >> 2)) & 1) === 1, i = (y * W + x) * 4, v = on ? 18 : 238;
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W, H);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export class Flagger {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'flagger';
    this.spec = makeSpec({
      height: 1.68, build: 'lean', shoulderWide: 0.88, limbLong: 1.03,
      colors: { jacket: 0xf0efe8, pants: 0x1a1d20, helmet: 0x1a1d20, accent: 0xb3261e, skin: 0xc68e64 },
      look: { helmet: 'none', hair: 'long', hairColor: 0x3b2616, top: 'tank', gloves: 'none',
              glasses: 'shades', earring: true, bootColor: 0xb3261e, headSize: 1.04 },
    });
    this.body = buildRider(THREE, { spec: this.spec });
    this.joints = this.body.userData.joints;
    this.group.add(this.body);
    // merge the body FIRST: the flag's cloth is animated per vertex and must
    // stay its own mesh
    try { mergeJoints(this.body, MERGE_OPTS); } catch (e) { /* unmerged is correct, just more draws */ }
    this._buildFlag();
    this.body.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    this.flagCloth.castShadow = false;
    scene.add(this.group);
    this.group.visible = false;
    this.t = 0;
    this.goT = -1;
    this.lateral = FLAGGER.LATERAL;
    this.s = FLAGGER.S_AHEAD;
  }

  /** The flag: a pole out of the right fist, and a cloth that ripples. */
  _buildFlag() {
    const S = this.spec, fore = this.joints.rightArm.fore;
    const hand = new THREE.Group();
    hand.position.set(0, -S.forearm - S.hand * 0.5, 0.01);
    fore.add(hand);
    // the pole runs across the fist, out past the thumb (+x in the fist frame is
    // toward the body for the right hand), pointing on along the arm's line
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.95, 6),
      new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.5, metalness: 0.4 }));
    pole.position.set(0, -0.4, 0);
    hand.add(pole);
    const geo = new THREE.PlaneGeometry(0.62, 0.44, 10, 4);
    geo.translate(0.31, 0, 0);                         // hinge on the pole
    this.flagBase = geo.attributes.position.array.slice();
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.85, side: THREE.DoubleSide }));
    cloth.position.set(0, -0.85 + 0.22, 0);
    cloth.rotation.z = Math.PI / 2;                    // the cloth hangs off the pole's far end
    hand.add(cloth);
    this.flagHand = hand;
    this.flagCloth = cloth;
  }

  /** New race: back to her spot in front of the grid, flag up. */
  reset() {
    this.t = 0;
    this.goT = -1;
    this.lateral = FLAGGER.LATERAL;
    this.s = FLAGGER.S_AHEAD;
    this.group.visible = true;
    this._place();
  }

  _place() {
    const p = this.group.position, t = new THREE.Vector3();
    centreAt(-this.s, p);
    headAt(-this.s, t);
    const nx = -t.z, nz = t.x;                          // +lateral, as everywhere in the road frame
    p.x += nx * this.lateral; p.z += nz * this.lateral;
    // FACE THE GRID: the rig looks down its +Z, the pack comes along +travel,
    // so she looks back down -travel, turned a little toward the road's centre
    // (once she is on the verge she turns in to watch them go)
    const off = this.lateral > FLAGGER.LATERAL + 0.5 ? -0.6 * Math.min(1, (this.lateral - FLAGGER.LATERAL) / 4) : 0;
    this.group.rotation.set(0, Math.atan2(-t.x, -t.z) + off, 0);
  }

  /**
   * `countdown` is the grid hold left (0 = racing), `playerS` the player's
   * distance, for culling once the start is behind everyone.
   */
  update(dt, countdown, playerS) {
    if (!this.group.visible && playerS < FLAGGER.HIDE_AFTER) return;
    if (playerS > FLAGGER.HIDE_AFTER) { this.group.visible = false; return; }
    this.t += dt;
    const racing = countdown <= 0;
    if (racing && this.goT < 0) this.goT = this.t;
    const since = this.goT < 0 ? -1 : this.t - this.goT;
    const j = this.joints, b = this.body;

    // legs: standing, or a jog while she clears the road
    const clearing = since >= FLAGGER.DROP_T * 0.6 && since < FLAGGER.DROP_T * 0.6 + FLAGGER.CLEAR_T;
    poseStanding(j, clearing ? since * 14 : 0, clearing ? 1 : 0);
    b.position.y = clearing ? Math.abs(Math.sin(since * 14)) * 0.04 : 0;
    if (clearing) {
      // run side-on, toward the verge (+lateral is her left as she faces the grid)
      this.body.rotation.y = Math.PI / 2 * Math.min(1, (since - FLAGGER.DROP_T * 0.6) / 0.15);
      const k = (since - FLAGGER.DROP_T * 0.6) / FLAGGER.CLEAR_T;
      // EASE-OUT: she bolts, then slows onto the verge
      this.lateral = FLAGGER.LATERAL + (FLAGGER.VERGE - FLAGGER.LATERAL) * (1 - (1 - k) * (1 - k));
      this._place();
    }

    if (!clearing) this.body.rotation.y = 0;
    // the flag arm
    let wave = 0;
    if (since < 0) {
      // the hold: flag high, swung side to side, faster as the count runs out
      const rate = 5 + (CFG.COUNTDOWN - Math.max(0, countdown)) * 1.2;
      const sw = Math.sin(this.t * rate);
      armAim(j, 'right', [-0.25 + 0.3 * sw, 0.95, 0.12], [0, 0, 1], 0.15);
      if (j.torso) { j.torso.rotation.z = -0.05 * sw; j.torso.rotation.x = -0.04; }
      wave = sw;
    } else if (since < FLAGGER.DROP_T) {
      // GO: the sweep, overhead to forward-down, at the pack
      const k = since / FLAGGER.DROP_T, e = k * k;
      armAim(j, 'right', [-0.25 - 0.1 * e, 0.95 - 1.5 * e, 0.12 + 0.8 * e], [0, 1 - e, 1], 0.1);
      if (j.torso) j.torso.rotation.x = 0.35 * e;
      wave = 1;
    } else {
      // off the road: a lazy wave as they go by
      const sw = Math.sin(this.t * 4);
      armAim(j, 'right', [-0.6 + 0.2 * sw, 0.7, 0.2], [0, 0, 1], 0.3);
      wave = sw * 0.6;
    }
    // the free hand on her hip
    armAim(j, 'left', [0.7, -0.62, -0.2], [-0.8, 0.2, 0.3], 1.9);
    if (j.neck) j.neck.rotation.x = since < 0 ? -0.1 : 0.05;
    this._ripple(wave);
  }

  /** Cloth: a travelling wave down the fly, growing away from the pole. */
  _ripple(wave) {
    const pos = this.flagCloth.geometry.attributes.position, a = pos.array, B = this.flagBase;
    for (let i = 0; i < pos.count; i++) {
      const x = B[i * 3], y = B[i * 3 + 1];
      const k = x / 0.62;
      a[i * 3 + 2] = Math.sin(this.t * 11 - x * 9 + y * 2) * 0.07 * k + wave * 0.05 * k * k;
    }
    pos.needsUpdate = true;
    this.flagCloth.geometry.computeVertexNormals();
  }
}
