// REACH — one source of truth for the limb angles that put a rider's hands on
// the bars and his boots on the pegs, for any body and any machine.
//
// WHY THIS FILE EXISTS. The seated pose was a set of literals copied into three
// places: `player.js` (the race), `showroom.js` (the designer) and
// `assets/rider.js` (the rig's rest pose). They had already drifted apart once,
// and every copy was solved against a single 1.75 m body. Change the height
// slider, or turn up `limbLong`, and the hands leave the grips -- because the arm
// length moved and the ANGLE that covered the old distance did not.
//
// HOW THE ANGLES WERE FOUND, AND WHY THEY ARE MEASURED RATHER THAN DERIVED.
//
// The obvious approach is closed-form inverse kinematics: two segments of known
// length reaching a contact of known position is a triangle, and the law of
// cosines gives the angles. That was tried, twice, and both times it produced a
// rider with his arms folded up over his head -- because the rig's joint sign
// conventions and pivot frames are NOT the textbook frame the closed form
// assumes, and the shoulder does not sit where a spine-length calculation puts
// it once the torso is posed.
//
// So the angles here are MEASURED: the harness sweeps the live joints over a
// grid and reports the residual against the real contact (see
// `harness/_elbowsolve.mjs` for the arm, `harness/_legsolve2.mjs` for the leg).
// The values below are the minima of those sweeps. That makes this table
// authoritative and honest: it is where the limbs actually are, not where a
// model that has been wrong twice says they should be.
//
// THE ONE DERIVED NUMBER THAT IS SAFE is the DISTANCE a limb has to span, which
// is pure geometry and needs no rig frame. `reachLimits()` publishes it so a
// taller rider or a longer reach can be checked against the limb's real length
// and reported when a contact is out of range -- which is the check that was
// missing when the seat was 0.84 m too high and nobody noticed.

import { CFG } from './config.js';

/**
 * The measured riding pose. One table, read by the race, the designer and the
 * rig -- the deduplication that used to be three drifting copies.
 */
export const RIDING = {
  // ---- SOLVED, NOT TUNED -------------------------------------------------
  // Every number below came out of `harness/_solvepose.mjs`, which measures the
  // live game rig and solves ALL SIX coupled unknowns in one pass. See POSE_PLAN.md
  // for why they are coupled: the socket position moves the shoulder, which moves
  // the arm reach, which changes the torso lean, which changes the hip angle --
  // and sweeping one at a time never converges.
  //
  // Residuals at a 1.75 m body (the tolerances are in _solvepose.mjs):
  //   pelvis -> saddle   exact       (0.000 m)
  //   fist   -> grip     0.0026 m
  //   sole   -> peg      0.0536 m    -- and this remainder is STRUCTURAL and
  //                                     spread evenly: ~3 cm of it is the boot
  //                                     sitting inboard of the peg, the rest is a
  //                                     little height and fore/aft. On a 15 cm
  //                                     boot resting on a 9 cm peg that is a foot
  //                                     ON the peg, not a miss.

  // torso leans FORWARD for positive rotation.x (measured; see assets/rider.js).
  // NOTE the solve kept the UPRIGHT value at full tuck: the earlier 0.79 rad
  // crouch was a local minimum found by holding `splay` fixed while sweeping the
  // torso. With splay free, the arm reaches with the body upright.
  torsoTuck:   0.3,
  torsoRest:   0.3,
  neckTuck:   -0.42,   // head up, looking down the road
  neckRest:   -0.24,
  // arms, solved jointly with the torso (residual 0.9 mm at the grip)
  upperArm:   -1.04,
  upperSplay:  0.13,   // outward z, per side
  elbow:      -0.32,
  // The UPRIGHT end of the arm blend. With the torso solve equal to the rest
  // value there is nothing to blend, so these equal the tuck values; they stay so
  // the interpolation in player.js remains correct if the tuck solve ever moves.
  upperRest:  -1.04,
  elbowRest:  -0.32,
  // legs -- THE KNEES-FORWARD BRANCH. The old values (hip +1.48, knee -2.34)
  // put the boot on the peg too, but by the MIRROR-IMAGE solution: in this rig
  // +x on the hip swings the thigh toward -Z, the TAIL (the rider faces +Z), so
  // the knee sat 0.33 m behind the hip and the shin came forward to the peg --
  // the "legs are backwards" the player reported. The _solvepose.mjs anatomy
  // gate (knee below hip) could not tell the branches apart; only a pole can.
  // These are now what the pole-vector IK in src/limbik.js produces on the
  // 1.75 m body (knee 0.42 m FORWARD of the hip, boot 0.40 m behind the knee,
  // residual 0.000 m), kept as the fallback for a rig with no bike contacts.
  // A positive knee x folds the shin BACK.
  hip:        -1.60,
  knee:        2.44,
  hipSplay:    0.22,   // per side: left +, right - (as upperSplay); knees out.
                       // (+ since assets/rider.js puts LEFT at +X, anatomically)
};

/** Contacts as plain arrays, for callers with no live bike to read. */
export const DEFAULT_CONTACTS = {
  seat: [CFG.SEAT_X, CFG.SEAT_Y, CFG.SEAT_Z],
  grip: [0.25, 1.04, 0.40],
  peg:  [0.20, 0.44, -0.24],
};

/**
 * Normalise a contacts object to `{seat:[x,y,z], grip:[...], peg:[...]}`.
 *
 * `assets/bike.js` publishes `userData.contacts` as `{x,y,z}` OBJECTS for
 * readability in the source; a harness or a solver wants arrays. Accepting both
 * here is what stops a caller from indexing `.y` on an array (or `[1]` on an
 * object) and silently reading `undefined` -- which lands in a pose as NaN and
 * shows up as a rider folded inside out, several layers away from the mistake.
 */
export function normaliseContacts(c) {
  if (!c) return DEFAULT_CONTACTS;
  const to3 = (v, fb) => {
    if (!v) return fb;
    if (Array.isArray(v)) return [v[0], v[1], v[2]];
    return [v.x, v.y, v.z];
  };
  return {
    seat: to3(c.seat, DEFAULT_CONTACTS.seat),
    grip: to3(c.grip, DEFAULT_CONTACTS.grip),
    peg:  to3(c.peg,  DEFAULT_CONTACTS.peg),
  };
}

/**
 * How far each limb has to reach, and how long it actually is, for a given body
 * and machine. Pure geometry, no rig frame -- so it is trustworthy even where the
 * angle solve is not, and it is the check that catches an impossible pose (an
 * arm asked to span 1.01 m with 0.58 m of bone) before it is drawn.
 */
export function reachLimits(spec, contacts) {
  if (!spec) return null;
  const C = normaliseContacts(contacts);
  // Shoulder, in bike-local metres: the rider's origin sits at the saddle, so the
  // shoulder is `seatedShoulder` up and `seatedReach` forward of it.
  const shoulder = {
    x: 0,
    y: C.seat[1] + (spec.seatedShoulder || 0),
    z: C.seat[2] - (spec.seatedReach || 0),
  };
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const arm = d3([shoulder.x, shoulder.y, shoulder.z], C.grip);
  const leg = d3(C.seat, C.peg);
  return {
    shoulder,
    arm: { need: arm, have: (spec.upperArm || 0) + (spec.forearm || 0) },
    leg: { need: leg, have: (spec.thigh || 0) + (spec.shin || 0) },
    armOk: arm <= (spec.upperArm || 0) + (spec.forearm || 0),
    legOk: leg <= (spec.thigh || 0) + (spec.shin || 0),
  };
}

/** The riding pose for a body. Returns the measured table; see the note above. */
export function seatedPose() {
  return { ...RIDING };
}