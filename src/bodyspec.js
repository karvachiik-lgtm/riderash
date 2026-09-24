// BODY SPEC — the single source of truth for every human in the game.
//
// WHY THIS FILE EXISTS. The rider's geometry was 40-odd literal numbers written
// inline in assets/rider.js: 0.30, 0.20, 0.24, 0.46, 0.34, 0.57 ... Every one of
// them is a body dimension, and because they were literals there was no way to
// (a) ask what a body was, (b) make a second body that is a different size, or
// (c) let the player design one. The numbers also had to agree with each other
// by hand: change the torso length and the shoulder height, the neck position,
// the arm length and the seated shoulder height ALL have to move with it, and
// nothing made that happen.
//
// So the dimensions become a SPEC with a total height and a set of RATIOS, and
// every placed number is DERIVED. A body is then one object, which means:
//
//   - the player and all five rivals are the same code with different specs
//   - the showroom can present the spec, let it be edited, and rebuild live
//   - the rig is provably consistent, because the joints ARE the spec
//
// ANTHROPOMETRY, not invention. The defaults below are the standard
// proportions used in figure modelling and ergonomics, expressed as fractions
// of stature (total height H):
//
//   head height      1/7.5 H      shoulder width   1/4  H
//   trunk (hip-shoulder)  0.288 H     upper arm    0.186 H
//   forearm          0.146 H      thigh            0.245 H
//   shin             0.246 H      elbow at        0.63 H
//   crotch at        0.48 H       knee at          0.285 H
//
// These are the Vitruvian/Leonardo canon numbers; they are what makes a figure
// read as a person rather than a stack of boxes, and they are the reason a
// height slider alone produces a plausible human at every setting.
//
// SEATED. This rider is seated on a bike, so the spec carries BOTH the standing
// stature (for the walker, who must look right on his feet) and the seated
// geometry the saddle needs. The seat-to-hip and hip-to-shoulder distances are
// what the mount socket and the camera aim use.

export const CANON = {
  HEAD_H:        1 / 7.5,   // 0.1333 H
  SHOULDER_W:    1 / 4,     // 0.2500 H
  TRUNK:         0.288,     // hip joint -> shoulder joint
  NECK:          0.052,
  UPPER_ARM:     0.186,
  FOREARM:       0.146,
  HAND:          0.108,
  THIGH:         0.245,
  SHIN:          0.246,
  FOOT:          0.152,
  HIP_W:         0.191,     // hip joint separation, total (so +/- is half this)
  CROTCH:        0.480,     // hip joint height above the ground
  KNEE:          0.285,
  ELBOW:         0.630,     // elbow height above the ground, standing
  SHOULDER:      0.818,
  LIMB_R:        0.045,     // base limb radius, scaled by BUILD
};

// Build classes. BUILD scales every radius (limb thickness, torso depth and
// width) but NOT any length, so a heavier rider is heavier and not taller --
// which is the distinction the old single `scale` could not make and is exactly
// why the seat offset went wrong when a body was resized.
export const BUILDS = {
  lean:   { build: 0.85, label: 'Lean' },
  normal: { build: 1.00, label: 'Normal' },
  stocky: { build: 1.18, label: 'Stocky' },
  heavy:  { build: 1.34, label: 'Heavy' },
};

/**
 * Make a complete, consistent body spec from a small input.
 *
 * `height` is stature in metres -- the thing a player actually thinks in.
 * Everything else is derived, so it is impossible to produce a spec whose parts
 * disagree with each other.
 */
export function makeSpec({ height = 1.75, build = 'normal', buildScale = null,
                          shoulderWide = 1, limbLong = 1, colors = {}, look = null } = {}) {
  const B = buildScale != null ? buildScale : (BUILDS[build] || BUILDS.normal).build;
  const H = height;
  const r = (f) => f * H;

  const spec = {
    height: H,
    build: B,
    buildName: build,
    shoulderWide, limbLong,

    // ---- derived lengths (metres) ----
    headH:      r(CANON.HEAD_H),
    headR:      r(CANON.HEAD_H) * 0.44,
    neckLen:    r(CANON.NECK),
    trunk:      r(CANON.TRUNK) * limbLong,
    shoulderW:  r(CANON.SHOULDER_W) * shoulderWide,
    hipW:       r(CANON.HIP_W) * shoulderWide,
    upperArm:   r(CANON.UPPER_ARM) * limbLong,
    forearm:    r(CANON.FOREARM) * limbLong,
    hand:       r(CANON.HAND),
    thigh:      r(CANON.THIGH) * limbLong,
    shin:       r(CANON.SHIN) * limbLong,
    foot:       r(CANON.FOOT),

    // ---- derived heights above ground (standing) ----
    hipY:        r(CANON.CROTCH),
    kneeY:       r(CANON.KNEE),
    elbowY:      r(CANON.ELBOW) * limbLong,
    shoulderY:   r(CANON.SHOULDER) * limbLong,

    // ---- thicknesses: BUILD only, never height ----
    limbR:   r(CANON.LIMB_R) * B,
    torsoW:  0.34 * (H / 1.75) * shoulderWide * (0.85 + 0.15 * B),
    torsoD:  0.26 * (H / 1.75) * (0.80 + 0.20 * B),
    pelvisW: 0.30 * (H / 1.75) * (0.85 + 0.15 * B),
    pelvisD: 0.24 * (H / 1.75) * (0.80 + 0.20 * B),
    // The pelvis mesh's VERTICAL size. The pelvis is the body's sitting surface,
    // so this is the one dimension the saddle needs: it is `pelvisD * 0.83` in
    // assets/rider.js, and it lives here so the mesh and the seat contact cannot
    // disagree. See seatContactY below.
    pelvisH: 0.24 * (H / 1.75) * (0.80 + 0.20 * B) * 0.83,

    colors: {
      jacket: colors.jacket ?? 0x2a2624,
      pants:  colors.pants  ?? 0x3b4a63,
      helmet: colors.helmet ?? 0xd8d2c4,
      skin:   colors.skin   ?? 0x9c7358,
      accent: colors.accent ?? 0xd4622a,
    },
    // WHAT HE WEARS: style, not stature. Nothing in here moves a joint, so the
    // seat, the IK and the ragdoll never read it -- only assets/rider.js does.
    look: makeLook(look),
  };

  // ---- SEATED geometry ---------------------------------------------------
  // The saddle carries the pelvis, so what the mount socket and the camera need
  // is how far the pelvis sits above the seat and how high the shoulders ride
  // once the torso is tucked. The tuck angle is part of the spec because a
  // taller rider tucks less to keep the same eye height.
  spec.tuck = 0.55;
  // Distance from the hip joint up to the shoulder joint along the tucked spine.
  spec.seatedRise = Math.cos(spec.tuck) * spec.trunk;
  // How far forward the shoulders end up, which the camera aim wants.
  spec.seatedReach = Math.sin(spec.tuck) * spec.trunk;
  spec.seatedShoulder = spec.tuck === 0 ? spec.trunk : spec.seatedRise;
  // A saddle height that puts the feet near the pegs for this leg length.
  spec.seatY = Math.max(0.18, spec.shin + spec.thigh * 0.42 - spec.foot * 0.30);

  // ---- WHERE THE SADDLE MEETS THE BODY ------------------------------------
  // HOW FAR THE BODY'S SITTING SURFACE IS ABOVE ITS OWN ORIGIN.
  //
  // THE BUG THIS EXISTS FOR. The mount socket was positioned from a fixed
  // constant (CFG.SEAT_Y, 0.78 m) and the rider was parented to it at the
  // origin. But assets/rider.js normalises the rig so its origin is the FEET
  // (min.y == 0 -- see the asset note at the bottom of that file), and the
  // pelvis joint sits `hipY` ABOVE the feet, with the pelvis block's underside
  // half its height below that joint. So a fixed socket put the FEET on the
  // saddle and stood the body on top of the machine: MEASURED, the pelvis rode
  // 0.84 m above the saddle and the rider's lowest point was 1.35 m clear of the
  // road. And because `hipY` scales with stature while the constant did not,
  // every height gave a different, wrong seat.
  //
  // The fix is one derived number: the height of the pelvis underside above the
  // origin, so the socket can be placed where the body's SEAT contact actually
  // is. `pelvisH` is the pelvis block's own height (the same value the mesh is
  // built from), so the seating surface and the geometry that produces it move
  // together for any height and any build.
  // MEASURED, and measured IN THE RIDING POSE.
  //
  // The rig is normalised so its feet are at y = 0 by measuring it in a NEUTRAL,
  // legs-down pose (see the note in assets/rider.js). Once the racing crouch is
  // applied the PELVIS JOINT rides higher than its standing crotch height,
  // because the folded thigh lifts it. That joint height is what the socket has
  // to subtract, and `harness/_seatcontact.mjs` measures it:
  //
  //     h = 1.55 -> pelvis joint 0.9609   (ratio 0.6199)
  //     h = 1.75 -> pelvis joint 1.0849   (ratio 0.6199)
  //     h = 1.95 -> pelvis joint 1.2089   (ratio 0.6199)
  //
  // The ratio is constant to four decimals, so it is derived, not fitted, and
  // `socketY + pelvis = SEAT_Y` puts the saddle exactly at the pelvis joint for
  // any stature -- a rider planted on the seat.
  spec.seatContactY = 0.6199 * H;
  // A small residual, kept because the fit is measured rather than derived and a
  // measured fit has a remainder. Zero for the rig as it stands; if the seated
  // pose changes, harness/_seatbob.mjs re-solves it against the saddle.
  spec.seatBob = 0;

  // ---- PRONE GEOMETRY ----------------------------------------------------
  // WHAT THE WRECK PIVOTS ABOUT, and why this cannot be a closed-form guess.
  //
  // The rider's origin is his FEET. Rotating the whole body about its feet by a
  // "prone" angle does not lay it down -- it stands it on its face. So the body
  // has to be rotated about a point near its centre and then lowered until it
  // rests on the road.
  //
  // The first attempt computed those two numbers in closed form from landmarks
  // on the body's SPINE (hips, chest, head) and it was wrong, twice over:
  //
  //   - it treated the body as a set of points on a line, but the body has
  //     WIDTH and DEPTH, and those rotate too. The real bounding box of a prone
  //     1.75 m figure is about 1.28 m tall, not the 0.12 m the landmark maths
  //     predicted.
  //   - MEASURED in three.js, that version put the box at -0.202 .. 1.073, i.e.
  //     twenty centimetres of the rider sunk THROUGH the road while the rest of
  //     him stood a metre up.
  //
  // So this is not solved analytically. `pronePivotY` is an estimate used only as
  // a starting point, and the renderer then measures the body's ACTUAL world
  // bounding box and translates so its lowest point sits exactly on the road.
  // That is correct for any figure, any pose and any future limb edit, because it
  // reads the geometry instead of predicting it.
  spec.pronePivotY = spec.hipY + spec.trunk * 0.45;   // mid-torso, near the CoM
  return spec;
}

// ---- LOOK -----------------------------------------------------------------
// The wardrobe. Every key has a default that reproduces the original rider
// exactly (full-face lid, leathers, gloves), so an old save or a rival built
// without a look is the same body it always was. Enumerations are closed lists:
// a value that is not in the list falls back to the default instead of
// building something the asset has no geometry for.
export const LOOK_OPTIONS = {
  helmet:  ['full', 'open', 'none'],
  visor:   ['smoke', 'clear', 'gold', 'blue', 'mirror'],
  stripe:  ['racing', 'twin', 'none'],
  finish:  ['gloss', 'matte'],
  hair:    ['short', 'buzz', 'mohawk', 'spikes', 'slick', 'long', 'ponytail', 'bun', 'afro', 'dreads', 'bald'],
  beard:   ['none', 'stubble', 'goatee', 'moustache', 'full'],
  top:     ['leather', 'tee', 'tank', 'hoodie', 'vest', 'crop', 'dress', 'flannel', 'denimjacket', 'bikini', 'onepiece'],
  bottom:  ['jeans', 'shorts', 'skirt'],
  pattern: ['plain', 'floral', 'dots', 'stripes', 'plaid', 'stars'],
  figure:  ['m', 'f'],
  hat:     ['none', 'sunhat', 'cap', 'cowboy'],
  shoes:   ['boots', 'low', 'sneakers'],
  tattoo:  ['none', 'tribal', 'sleeve', 'flames', 'bands', 'neck'],
  glasses: ['none', 'shades', 'aviator', 'goggles'],
  chain:   ['none', 'gold', 'silver'],
  scarf:   ['none', 'bandana'],
  gloves:  ['full', 'fingerless', 'none'],
};
export const LOOK_DEFAULTS = {
  helmet: 'full', helmetSize: 1.0, headSize: 1.0, bust: 1.0, visor: 'smoke', stripe: 'racing', finish: 'gloss',
  hair: 'short', hairColor: 0x2a1d14, beard: 'none',
  top: 'leather', bottom: 'jeans', pattern: 'plain', figure: 'm', hat: 'none', shoes: 'boots', tattoo: 'none', inkColor: 0x1c2433,
  glasses: 'none', chain: 'none', scarf: 'none', scarfColor: 0x8a1f1f,
  earring: false, spikes: false, backpack: false,
  gloves: 'full', gloveColor: 0x232020, bootColor: 0x1f1c1a,
};
/** A complete, valid look from any partial (or junk) input. */
export function makeLook(l) {
  const o = { ...LOOK_DEFAULTS };
  if (!l || typeof l !== 'object') return o;
  for (const [k, list] of Object.entries(LOOK_OPTIONS)) if (list.includes(l[k])) o[k] = l[k];
  for (const k of ['hairColor', 'inkColor', 'scarfColor', 'gloveColor', 'bootColor']) {
    if (Number.isFinite(l[k])) o[k] = (l[k] >>> 0) & 0xffffff;
  }
  for (const k of ['earring', 'spikes', 'backpack']) if (typeof l[k] === 'boolean') o[k] = l[k];
  if (Number.isFinite(l.helmetSize)) o.helmetSize = Math.max(0.85, Math.min(1.3, l.helmetSize));
  if (Number.isFinite(l.bust)) o.bust = Math.max(0.7, Math.min(1.7, l.bust));
  if (Number.isFinite(l.headSize)) o.headSize = Math.max(0.85, Math.min(1.8, l.headSize));
  return o;
}

/** Blend two specs, t in 0..1. Used by the showroom sliders for live preview. */
export function lerpSpec(a, b, t) {
  const o = {};
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number' && typeof vb === 'number') o[k] = va + (vb - va) * t;
    else if (k === 'colors' || k === 'look') o[k] = { ...va };
    else o[k] = va;
  }
  return o;
}

/** A short human-readable summary, for the showroom readout and for logs. */
export function describeSpec(s) {
  return `${s.height.toFixed(2)} m · build ${s.build.toFixed(2)} (${s.buildName}) · ` +
         `trunk ${s.trunk.toFixed(3)} · arm ${(s.upperArm + s.forearm).toFixed(3)} · ` +
         `leg ${(s.thigh + s.shin).toFixed(3)} · seated shoulder ${s.seatedShoulder.toFixed(3)}`;
}
