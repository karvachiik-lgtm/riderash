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
import { poseStanding, armAim, contrapposto, confident } from './riderpose.js';
import { ensureRest, restoreRest } from './ragdoll.js';
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
  'Stars & Stripes': { height: 1.72, skin: 0xe0ac87,
    colors: { jacket: 0x1f3a7a, pants: 0x1f3a7a, accent: 0xd8262e },
    look: { top: 'bikini', pattern: 'stars', hair: 'long', hairColor: 0xe0cc8a, glasses: 'aviator', earring: true,
            shoes: 'low', bootColor: 0xf0efe8, hat: 'cowboy' } },
  'Beach Day': { height: 1.7, skin: 0xc68e64,
    colors: { jacket: 0xd8262e, pants: 0xd8262e, accent: 0xf0efe8 },
    look: { top: 'onepiece', hair: 'long', hairColor: 0x3b2616, hat: 'sunhat', glasses: 'shades', earring: true,
            shoes: 'low', bootColor: 0xf0efe8 } },
  Tropical: { height: 1.68, skin: 0x7a5236,
    colors: { jacket: 0x1f8a8a, pants: 0x1f8a8a, accent: 0xf2c94c },
    look: { top: 'bikini', pattern: 'floral', hair: 'bun', hairColor: 0x1a1512, earring: true, chain: 'gold',
            shoes: 'low', bootColor: 0xf2c94c } },
  Cowgirl: { height: 1.72, skin: 0xf1c9a5,
    colors: { jacket: 0xb3261e, pants: 0x5a7ab0, accent: 0xf0efe8 },
    look: { top: 'flannel', pattern: 'plaid', bottom: 'shorts', hat: 'cowboy', hair: 'long', hairColor: 0x8a3a1a,
            shoes: 'boots', bootColor: 0x6b4a2a, earring: true } },
  'Denim Days': { height: 1.7, skin: 0x9c7358,
    colors: { jacket: 0x4a6a9a, pants: 0xf0efe8, accent: 0xd46a9a },
    look: { top: 'denimjacket', bottom: 'skirt', hair: 'ponytail', hairColor: 0x1a1512, glasses: 'shades', chain: 'gold',
            shoes: 'sneakers', bootColor: 0xf0efe8, earring: true } },
  // ROWDY: no flag. Hand on her hip, a key chain spinning round one finger,
  // and at GO a fist in the air.
  Rowdy: { height: 1.72, skin: 0xe0ac87, pose: 'rowdy', seat: 1.5,
    colors: { jacket: 0x121314, pants: 0x3b4a63, accent: 0xb3261e },
    look: { top: 'vest', bottom: 'shorts', hair: 'long', hairColor: 0x6a1a1a, tattoo: 'sleeve', inkColor: 0x121212,
            glasses: 'shades', scarf: 'bandana', scarfColor: 0xb3261e, chain: 'silver', earring: true,
            gloves: 'fingerless', gloveColor: 0x121314, shoes: 'boots', bootColor: 0x121314 } },
  // the title screen's rider: black leathers, jeans, boots, keys round her finger
  Leathers: { height: 1.74, skin: 0xe0ac87, pose: 'rowdy', seat: 1.5,
    colors: { jacket: 0x151517, pants: 0x2e3b52, accent: 0x9a9ea3 },
    look: { top: 'leather', bottom: 'jeans', hair: 'long', hairColor: 0x2a1a14, glasses: 'shades',
            chain: 'silver', earring: true, gloves: 'fingerless', gloveColor: 0x151517,
            shoes: 'boots', bootColor: 0x151517 } },
};
// Race to race, alternate the looks so two races in a row never feel alike.
export const FLAG_OUTFIT_ORDER = ['Sundress', 'Rowdy', 'Stars & Stripes', 'Grid Queen', 'Cowgirl', 'Summer Denim',
  'Beach Day', 'Polka Dot', 'Tropical', 'Rock Chick', 'Denim Days', 'Riviera'];

// HOW SHE MOVES. Each outfit is a character, and the character sets the
// motion: how wide and quick the hip sway, how often she shifts her weight,
// how she carries her head, what the free hand does between the waves.
//   sway     unhurried, fluid: the sundress and beachwear looks
//   bold     planted and sharp, points the pack in: the showpiece looks
//   playful  bouncy, all waves and head tilts: the denim and country looks
//   rowdy    slow, hip-cocked, keys going round
const MOODS = {
  sway:    { sway: 0.075, rate: 1.7, bob: 0.010, shiftEvery: [3.5, 6], headTilt: 0.10, flagRate: 0.9,  hop: 0,    nod: false, gestures: ['hip', 'hair', 'hair', 'wave'] },
  bold:    { sway: 0.055, rate: 2.1, bob: 0.014, shiftEvery: [2.5, 4.5], headTilt: 0.05, flagRate: 1.15, hop: 0.05, nod: false, gestures: ['hip', 'point', 'wave', 'hair'] },
  playful: { sway: 0.065, rate: 2.5, bob: 0.020, shiftEvery: [2, 4], headTilt: 0.14, flagRate: 1.05, hop: 0.07, nod: true,  gestures: ['wave', 'hair', 'hat', 'wave'] },
  rowdy:   { sway: 0.050, rate: 1.3, bob: 0.008, shiftEvery: [4, 7], headTilt: 0.12, flagRate: 1.0,  hop: 0,    nod: true,  gestures: ['hip'] },
};
const MOOD_OF = {
  Sundress: 'sway', Riviera: 'sway', 'Beach Day': 'sway', Tropical: 'sway',
  'Grid Queen': 'bold', 'Stars & Stripes': 'bold', 'Rock Chick': 'bold',
  'Summer Denim': 'playful', 'Polka Dot': 'playful', Cowgirl: 'playful', 'Denim Days': 'playful',
  Rowdy: 'rowdy', Leathers: 'rowdy',
};
// Free-hand (left arm) targets, in the torso frame: +x her left, +y up, +z front.
const GESTURES = {
  hip:   { dir: [0.7, -0.62, -0.2], hint: [-0.8, 0.2, 0.3], flex: 1.9, rate: 6 },
  hair:  { dir: [0.6, 0.78, 0.15], hint: [-0.6, 0.3, -0.6], flex: 2.3, rate: 5 },     // elbow out, hand behind the head
  wave:  { dir: [0.85, 0.5, 0.2], hint: [-0.2, 1, 0.3], flex: 1.25, twist: -Math.PI / 2, rate: 6 },
  point: { dir: [0.2, 0.15, 1], hint: [0, 1, 0], flex: 0.08, rate: 10 },
  hat:   { dir: [0.55, 0.45, 0.6], hint: [-0.4, 0.9, 0], flex: 1.95, rate: 6 },     // fingers to the brim
};

const _tv = new THREE.Vector3(), _tl = new THREE.Vector3();

/** An arm that EASES to its target pose instead of snapping (armAim is absolute). */
class ArmEase {
  constructor() { this.cur = null; this.tgt = null; this.rate = 8; }
  to(dir, hint, flex, twist = 0, rate = 8) { this.tgt = { dir, hint, flex, twist }; this.rate = rate; }
  apply(j, side, dt) {
    if (!this.tgt) return;
    if (!this.cur) this.cur = { dir: [...this.tgt.dir], hint: [...this.tgt.hint], flex: this.tgt.flex, twist: this.tgt.twist };
    const k = Math.min(1, dt * this.rate), c = this.cur, g = this.tgt;
    for (let i = 0; i < 3; i++) { c.dir[i] += (g.dir[i] - c.dir[i]) * k; c.hint[i] += (g.hint[i] - c.hint[i]) * k; }
    c.flex += (g.flex - c.flex) * k; c.twist += (g.twist - c.twist) * k;
    armAim(j, side, c.dir, c.hint, c.flex, Math.abs(c.twist) > 1e-3 ? c.twist : undefined);
  }
}

/**
 * A key chain for twirling: a ring on the finger, a short chain, a bottle
 * opener fob and two keys. Returns the pivot group; spin it about its local X.
 */
export function buildKeys() {
  const pivot = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.25, metalness: 0.95 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a04a, roughness: 0.3, metalness: 0.9 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0035, 6, 16), steel);
  ring.rotation.y = Math.PI / 2;
  pivot.add(ring);
  const arm = new THREE.Group();       // the part that swings round
  pivot.add(arm);
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.0022, 4, 8), steel);
    l.position.set(0, -0.022 - k * 0.012, 0);
    l.rotation.y = (k % 2) * Math.PI / 2;
    arm.add(l);
  }
  const fob = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.022), red);
  fob.position.set(0, -0.1, 0.006); arm.add(fob);
  for (const [dz, m] of [[-0.01, brass], [0.012, steel]]) {
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.012), m);
    key.position.set(0, -0.105, dz); key.rotation.x = dz * 12; arm.add(key);
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 10), m);
    bow.rotation.z = Math.PI / 2; bow.position.set(0, -0.078, dz); arm.add(bow);
  }
  pivot.userData.arm = arm;
  pivot.scale.setScalar(1.7);   // readable from the chase camera
  return pivot;
}

/** A full spec input for an outfit (the showroom uses this too). */
export function flagOutfitSpec(name) {
  const O = FLAG_OUTFITS[name] || FLAG_OUTFITS.Sundress;
  return {
    height: O.height, build: 'lean', shoulderWide: 0.84, limbLong: 1.04,
    colors: { helmet: 0x1a1d20, skin: O.skin, ...O.colors },
    look: { helmet: 'none', gloves: 'none', figure: 'f', headSize: 1.15, bust: O.bust ?? 1.45, seat: O.seat ?? 1.4, ...O.look },
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
    this._initMotion();
  }

  _initMotion() {
    this.body.rotation.y = 0;
    this._arm = { left: new ArmEase(), right: new ArmEase() };
    this._w = 0.8; this._wTarget = 0.8; this._shiftT = 1.5 + Math.random() * 2;
    this._g = 'hip'; this._gT = 1 + Math.random() * 2;
    this._lookT = 0; this._lookY = 0; this._lookX = 0; this._ly = 0; this._lx = 0;
    this._swayPh = Math.random() * 6; this._flagPh = 0;
  }

  /** Put her in an outfit (rebuilds the figure; cheap, once per race). */
  dress(name) {
    if (!FLAG_OUTFITS[name]) name = FLAG_OUTFIT_ORDER[0];
    if (name === this.outfit && this.body) return;
    if (this.body) {
      this.group.remove(this.body);
      // free the old outfit on the GPU too: its materials and their textures
      // (the flag's checker is a fresh texture per outfit) leaked one per race
      this.body.traverse((n) => {
        if (!n.isMesh) return;
        n.geometry.dispose();
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          if (!m) continue;
          for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (m[k]) m[k].dispose();
          m.dispose();
        }
      });
    }
    this.outfit = name;
    this.spec = makeSpec(flagOutfitSpec(name));
    this.body = buildRider(THREE, { spec: this.spec });
    this.joints = this.body.userData.joints;
    this.group.add(this.body);
    // merge the body FIRST: the flag's cloth is animated per vertex and must
    // stay its own mesh
    try { mergeJoints(this.body, MERGE_OPTS); } catch (e) { /* unmerged is correct, just more draws */ }
    ensureRest(this.body, true);          // the pose is rebuilt from this every frame
    this.mood = MOODS[MOOD_OF[name] || 'sway'];
    this.hasHat = !!(FLAG_OUTFITS[name].look && FLAG_OUTFITS[name].look.hat && FLAG_OUTFITS[name].look.hat !== 'none');
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
    // the rowdy starter swaps the flag for keys on her finger
    this.rowdy = (FLAG_OUTFITS[this.outfit] || {}).pose === 'rowdy';
    pole.visible = cloth.visible = !this.rowdy;
    this.keys = null;
    if (this.rowdy) {
      this.keys = buildKeys();
      this.keys.position.set(0, -S.hand * 0.1, S.hand * 0.35);   // at the index finger
      hand.add(this.keys);
    }
  }

  /** New race: a new outfit, back to her spot in front of the grid, flag up. */
  reset(raceNo = 0) {
    this.dress(FLAG_OUTFIT_ORDER[((raceNo % FLAG_OUTFIT_ORDER.length) + FLAG_OUTFIT_ORDER.length) % FLAG_OUTFIT_ORDER.length]);
    this.t = 0;
    this.goT = -1;
    this.lateral = FLAGGER.LATERAL;
    this.s = FLAGGER.S_AHEAD;
    this.group.visible = true;
    this._initMotion();
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
   *
   * THE POSE IS REBUILT FROM REST EVERY FRAME. contrapposto() and the sway
   * layers ADD to the pelvis, which poseStanding does not zero: without the
   * restore the tilt summed frame on frame and she rolled right over (a full
   * turn in about a second).
   */
  update(dt, countdown, playerS) {
    if (!this.group.visible && playerS < FLAGGER.HIDE_AFTER) return;
    if (playerS > FLAGGER.HIDE_AFTER) { this.group.visible = false; return; }
    this.t += dt;
    const racing = countdown <= 0;
    if (racing && this.goT < 0) this.goT = this.t;
    const since = this.goT < 0 ? -1 : this.t - this.goT;
    const j = this.joints, b = this.body, M = this.mood, t = this.t;
    restoreRest(b);
    b.position.set(0, 0, 0);

    // legs: standing, or a jog while she clears the road
    const clearing = since >= FLAGGER.DROP_T * 0.6 && since < FLAGGER.DROP_T * 0.6 + FLAGGER.CLEAR_T;
    poseStanding(j, clearing ? since * 14 : 0, clearing ? 1 : 0);
    if (clearing) {
      b.position.y = Math.abs(Math.sin(since * 14)) * 0.04;
      // run side-on, toward the verge (+lateral is her left as she faces the grid)
      b.rotation.y = Math.PI / 2 * Math.min(1, (since - FLAGGER.DROP_T * 0.6) / 0.15);
      if (j.torso) j.torso.rotation.x += 0.18;             // leaning into the run
      const k = (since - FLAGGER.DROP_T * 0.6) / FLAGGER.CLEAR_T;
      // EASE-OUT: she bolts, then slows onto the verge
      this.lateral = FLAGGER.LATERAL + (FLAGGER.VERGE - FLAGGER.LATERAL) * (1 - (1 - k) * (1 - k));
      this._place();
    } else {
      // turn back to face the road smoothly once she has stopped
      b.rotation.y *= Math.max(0, 1 - dt * 6);
      this._body(dt, countdown, since);
    }

    // ---- the arms ----------------------------------------------------------
    let wave = 0;
    const R = this._arm.right, L = this._arm.left;
    if (this.rowdy) {
      // forearm up in front, the chain whirling round her finger; at GO a
      // fist punched up at the pack, then back to twirling on the verge
      if (since >= 0 && since < 0.9) R.to([-0.25, 0.9, 0.3], [0, 0, 1], 0.35, 0);
      else R.to([-0.3, -0.9, 0.3], [0, 0.2, 1], 1.35 + 0.08 * Math.sin(t * 13), 0);
      if (this.keys) this.keys.userData.arm.rotation.x = -t * 13;
    } else if (clearing) {
      R.to([-0.3, 0.6 + 0.2 * Math.sin(since * 14), 0.2], [0, 0, 1], 0.4, 0);
    } else if (since < 0) {
      // THE HOLD: the flag high, carried through a figure-eight over the front
      // row, quicker and bigger as the count runs down; the body answers it
      const left = Math.max(0, countdown), urgency = 1 - Math.min(1, left / CFG.COUNTDOWN);
      const ph = this._flagPh = (this._flagPh || 0) + dt * (4.2 + urgency * 3.2) * M.flagRate;
      const sw = Math.sin(ph), up = Math.sin(ph * 2);
      if (left < 0.45) {
        // THE BEAT BEFORE GO: flag straight up, still, up on her toes
        R.to([-0.1, 1, 0.02], [0, 0, 1], 0.05, 0, 14);
        b.position.y += 0.025 * (1 - left / 0.45);
      } else {
        R.to([-0.25 + (0.32 + 0.1 * urgency) * sw, 0.9 + 0.08 * up, 0.14 + 0.1 * Math.cos(ph)], [0, 0, 1], 0.15 + 0.1 * Math.max(0, -sw), 0, 16);
        if (j.torso) { j.torso.rotation.z -= 0.05 * sw; j.torso.rotation.y -= 0.07 * sw; }
      }
      wave = sw;
    } else if (since < FLAGGER.DROP_T) {
      // GO: the sweep, overhead to forward-down, at the pack, and she lunges into it
      const k = since / FLAGGER.DROP_T, e = k * k;
      R.to([-0.25 - 0.1 * e, 0.95 - 1.5 * e, 0.12 + 0.8 * e], [0, 1 - e, 1], 0.1, 0, 60);
      if (j.torso) j.torso.rotation.x += 0.35 * e;
      const RL = j.rightLeg;
      if (RL && RL.knee) RL.knee.rotation.x += 0.35 * e;
      b.position.y -= 0.04 * e;
      wave = 1;
    } else {
      // off the road: cheering them through, the flag circled overhead
      const ph = t * 3.4 * M.flagRate;
      R.to([-0.35 + 0.28 * Math.sin(ph), 0.88, 0.15 + 0.22 * Math.cos(ph)], [0, 0, 1], 0.2, 0, 10);
      wave = Math.sin(ph) * 0.7;
    }
    if (!clearing) this._gesture(dt, since);
    else L.to([0.3, 0.55 - 0.3 * Math.sin(since * 14), 0.3], [0, 0, 1], 1.4, 0);
    R.apply(j, 'right', dt);
    L.apply(j, 'left', dt);
    this._look(dt, since);
    if (!this.rowdy) this._ripple(wave);
  }

  /**
   * THE BODY: breathing, weight moving from leg to leg, a hip sway, a bob.
   * Every layer is small and slow, and none repeats on a fixed loop, which is
   * what separates a person standing from a mannequin on a turntable.
   */
  _body(dt, countdown, since) {
    const j = this.joints, b = this.body, M = this.mood, t = this.t;
    // WEIGHT: which leg she stands on, changed every few seconds (never on a
    // metronome), eased like a real transfer: ~0.6 s, hips first
    this._shiftT -= dt;
    if (this._shiftT <= 0) {
      this._wTarget = -Math.sign(this._wTarget || 1) * (0.7 + Math.random() * 0.3);
      this._shiftT = M.shiftEvery[0] + Math.random() * (M.shiftEvery[1] - M.shiftEvery[0]);
    }
    this._w += (this._wTarget - this._w) * Math.min(1, dt * 3.2);
    const w = this._w;                                  // + stands on the right leg
    contrapposto(j, Math.abs(w), w > 0 ? 'left' : 'right');
    b.position.x = -w * 0.03;                           // hips over the standing foot
    confident(j);

    // SWAY: a slow figure-eight of the hips (roll + yaw a quarter out of phase),
    // the shoulders counter it so the head stays over the feet. Excitement
    // builds it through the count; on the verge she moves to the crowd.
    const excite = since >= 0 ? 1 : 1 - Math.min(1, Math.max(0, countdown) / CFG.COUNTDOWN) * 0.6;
    const ph = this._swayPh = (this._swayPh || 0) + dt * M.rate * (0.8 + 0.4 * excite);
    const amp = M.sway * (0.6 + 0.4 * excite);
    const roll = amp * Math.sin(ph), yaw = amp * 0.8 * Math.sin(ph + Math.PI / 2);
    if (j.pelvis) { j.pelvis.rotation.z += roll; j.pelvis.rotation.y += yaw; }
    for (const side of ['left', 'right']) {
      const Lg = j[side + 'Leg'];
      if (Lg && Lg.hip) { Lg.hip.rotation.z -= roll; Lg.hip.rotation.y -= yaw; }   // feet stay planted
    }
    if (j.torso) { j.torso.rotation.z -= roll * 0.8; j.torso.rotation.y -= yaw * 0.9; }
    // the knee on the dropping hip softens with it, and the body dips
    const dip = Math.max(0, Math.sin(ph));
    const soft = j[(roll > 0 ? 'right' : 'left') + 'Leg'];
    if (soft && soft.knee) soft.knee.rotation.x += 0.1 * dip * excite;
    b.position.y += -M.bob * Math.abs(Math.sin(ph)) * excite;
    // BREATH: ~15 a minute, chest and shoulders
    const br = Math.sin(t * 1.6);
    if (j.torso) j.torso.rotation.x -= 0.012 * br;
    // a little hop when the field goes by (the bold and the playful)
    if (since > 1.5 && M.hop) {
      const hp = (since * 1.3) % 3.2;
      if (hp < 0.35) b.position.y += Math.sin(hp / 0.35 * Math.PI) * M.hop;
    }
  }

  /**
   * THE FREE HAND. Mostly on her hip; every few seconds a gesture from her
   * character's repertoire -- a hand through her hair, a wave to the crowd, a
   * point at the pack, a touch of the hat brim -- eased in and out.
   */
  _gesture(dt, since) {
    const L = this._arm.left, t = this.t;
    this._gT -= dt;
    if (this._gT <= 0) {
      const list = this.mood.gestures;
      const pick = this._g === 'hip' ? list[Math.floor(Math.random() * list.length)] : 'hip';
      this._g = pick === 'hat' && !this.hasHat ? 'hair' : pick;
      this._gT = this._g === 'hip' ? 2.2 + Math.random() * 3 : 1.4 + Math.random() * 0.8;
    }
    const g = since >= 0 && since < 1.2 && !this.rowdy ? 'point' : this._g;
    const G = GESTURES[g];
    let flex = G.flex, dir = G.dir;
    if (g === 'wave') flex += 0.4 * Math.sin(t * 9);
    if (g === 'hair') dir = [dir[0], dir[1] + 0.05 * Math.sin(t * 2.5), dir[2]];
    L.to(dir, G.hint, flex, G.twist || 0, G.rate || 7);
  }

  /** THE HEAD: watches the grid, glances to the crowd, tilts with her mood. */
  _look(dt, since) {
    const j = this.joints, M = this.mood;
    this._lookT -= dt;
    if (this._lookT <= 0) {
      const r = Math.random();
      this._lookY = r < 0.55 ? 0 : r < 0.8 ? 0.45 : -0.35;   // the grid, the crowd, the other verge
      this._lookX = -0.05 + Math.random() * 0.1;
      this._lookT = 1.2 + Math.random() * 2.4;
    }
    if (since >= 0 && since < 1.5) this._lookY = 0;          // eyes on the pack at GO
    this._ly += (this._lookY - this._ly) * Math.min(1, dt * 5);
    this._lx += (this._lookX - this._lx) * Math.min(1, dt * 4);
    if (j.neck) {
      j.neck.rotation.y += this._ly;
      j.neck.rotation.x += this._lx;
      j.neck.rotation.z += M.headTilt * (this._g === 'hair' ? 1.8 : 1) * Math.sign(this._w || 1);
    }
    if (M.nod && j.head) j.head.rotation.x += 0.05 * Math.sin(this._swayPh * 2);
  }

  /**
   * THE TITLE SCREEN: she stands on the road in the left foreground of the
   * menu shot, facing the lens, hip cocked, keys going round her finger.
   * `at` is where her feet are (main.js picks it per shot, from the camera);
   * `on` false hides her (racing, the intro, a portrait phone).
   */
  titleUpdate(dt, on, at, eye) {
    if (!on || !at) { if (this._title) { this._title = false; this.group.visible = false; } return; }
    if (!this._title) {
      this.dress('Leathers');
      this._initMotion();
      this.body.traverse((n) => { if (n.isMesh) n.castShadow = false; });
      this._title = true;
    }
    this.group.visible = true;
    this.t += dt;
    const j = this.joints, b = this.body, t = this.t;
    restoreRest(b);
    b.position.set(0, 0, 0);
    poseStanding(j, 0, 0);
    this._body(dt, 1, -1);
    // elbow at her side, forearm up by the shoulder, the chain whirling
    // round her finger where the camera can see it
    this._arm.right.to([-0.25, -0.8, 0.35], [0.3, -0.2, 1], 2.05 + 0.06 * Math.sin(t * 13), 0);
    if (this.keys) this.keys.userData.arm.rotation.x = -t * 13;
    this._g = 'hip';                                   // the free hand stays on the hip
    this._gesture(dt, -1);
    this._arm.right.apply(j, 'right', dt);
    this._arm.left.apply(j, 'left', dt);
    this._look(dt, -1);
    // facing the lens, turned a touch towards the middle of the frame
    const g = this.group;
    g.position.copy(at);
    _tl.set(eye.x, at.y, eye.z);
    g.lookAt(_tl);
    g.rotateY(0.45);
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
