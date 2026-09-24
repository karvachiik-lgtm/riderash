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

// THE STARTER'S WARDROBE. She is the first person the player sees in every
// race, so she changes outfit from race to race and each look is styled as a
// whole: silhouette, colour, print, hair, accessories. Same spec + look system
// as every rider (and they are in the showroom, under Looks, to try on).
export const FLAG_OUTFITS = {
  Sundress: { height: 1.7, skin: 0xe0ac87,
    colors: { jacket: 0xf2c94c, pants: 0xf2c94c, accent: 0xf0efe8 },
    look: { top: 'dress', pattern: 'floral', hat: 'sunhat', hair: 'long', hairColor: 0x6b4526, glasses: 'shades',
            earring: true, shoes: 'low', bootColor: 0xc9a06a } },
  'Grid Queen': { height: 1.74, skin: 0xc68e64,
    colors: { jacket: 0xd8262e, pants: 0xd8262e, accent: 0xf0efe8 },
    look: { top: 'dress', pattern: 'plain', hair: 'ponytail', hairColor: 0xe0cc8a, earring: true,
            shoes: 'boots', bootColor: 0xf0efe8, chain: 'silver' } },
  'Summer Denim': { height: 1.68, skin: 0x9c7358,
    colors: { jacket: 0xf0efe8, pants: 0x5a7ab0, accent: 0xd46a9a },
    look: { top: 'crop', bottom: 'shorts', hair: 'bun', hairColor: 0x1a1512, glasses: 'aviator', chain: 'gold',
            shoes: 'sneakers', bootColor: 0xf0efe8, earring: true } },
  'Polka Dot': { height: 1.66, skin: 0xf1c9a5,
    colors: { jacket: 0xb3261e, pants: 0xb3261e, accent: 0x121314 },
    look: { top: 'dress', pattern: 'dots', hair: 'long', hairColor: 0x1a1512, scarf: 'bandana', scarfColor: 0xf0efe8,
            shoes: 'low', bootColor: 0xb3261e, glasses: 'shades' } },
  'Rock Chick': { height: 1.72, skin: 0xe0ac87,
    colors: { jacket: 0x121314, pants: 0x8a1f3a, accent: 0xc4b03a },
    look: { top: 'leather', bottom: 'skirt', hair: 'long', hairColor: 0x2a1512, gloves: 'none', earring: true,
            chain: 'silver', shoes: 'boots', bootColor: 0x121314, glasses: 'shades', tattoo: 'none' } },
  'Riviera': { height: 1.76, skin: 0x7a5236,
    colors: { jacket: 0xf0efe8, pants: 0xf0efe8, accent: 0xc4b03a },
    look: { top: 'dress', pattern: 'stripes', hat: 'sunhat', hair: 'afro', hairColor: 0x1a1512, glasses: 'aviator',
            chain: 'gold', earring: true, shoes: 'low', bootColor: 0xc4b03a } },
};
export const FLAG_OUTFIT_ORDER = Object.keys(FLAG_OUTFITS);

/** A full spec input for an outfit (the showroom uses this too). */
export function flagOutfitSpec(name) {
  const O = FLAG_OUTFITS[name] || FLAG_OUTFITS.Sundress;
  return {
    height: O.height, build: 'lean', shoulderWide: 0.84, limbLong: 1.04,
    colors: { helmet: 0x1a1d20, skin: O.skin, ...O.colors },
    look: { helmet: 'none', gloves: 'none', figure: 'f', headSize: 1.04, ...O.look },
  };
}

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
    this.outfit = null;
    this.dress(FLAG_OUTFIT_ORDER[0]);
    scene.add(this.group);
    this.group.visible = false;
    this.t = 0;
    this.goT = -1;
    this.lateral = FLAGGER.LATERAL;
    this.s = FLAGGER.S_AHEAD;
  }

  /** Put her in an outfit (rebuilds the figure; cheap, once per race). */
  dress(name) {
    if (!FLAG_OUTFITS[name]) name = FLAG_OUTFIT_ORDER[0];
    if (name === this.outfit && this.body) return;
    if (this.body) {
      this.group.remove(this.body);
      this.body.traverse((n) => { if (n.isMesh) { n.geometry.dispose(); } });
    }
    this.outfit = name;
    this.spec = makeSpec(flagOutfitSpec(name));
    this.body = buildRider(THREE, { spec: this.spec });
    this.joints = this.body.userData.joints;
    this.group.add(this.body);
    // merge the body FIRST: the flag's cloth is animated per vertex and must
    // stay its own mesh
    try { mergeJoints(this.body, MERGE_OPTS); } catch (e) { /* unmerged is correct, just more draws */ }
    this._buildFlag();
    this.body.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    this.flagCloth.castShadow = false;
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

  /** New race: a new outfit, back to her spot in front of the grid, flag up. */
  reset(raceNo = 0) {
    this.dress(FLAG_OUTFIT_ORDER[((raceNo % FLAG_OUTFIT_ORDER.length) + FLAG_OUTFIT_ORDER.length) % FLAG_OUTFIT_ORDER.length]);
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

  /**
   * The countdown close-up: a camera in front of her, a little low (a hero
   * angle), drifting round her as she waves. Writes a position and a look
   * target; false when she is not out.
   */
  introPose(pos, look, t) {
    if (!this.group.visible) return false;
    const g = this.group, ry = g.rotation.y;
    const fx = Math.sin(ry), fz = Math.cos(ry);          // where she faces
    const rx = Math.cos(ry), rz = -Math.sin(ry);          // her right-hand side
    const side = 1.2 - t * 0.5, dist = 3.6 + t * 0.35;
    pos.set(g.position.x + fx * dist + rx * side, g.position.y + 1.0, g.position.z + fz * dist + rz * side);
    // aim above the waist: the raised flag and her head both in frame
    look.set(g.position.x, g.position.y + this.spec.height * 0.62, g.position.z);
    return true;
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
