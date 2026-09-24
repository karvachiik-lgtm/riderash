// RideRash - baked motion tables for the rider's fighting actions.
//
// WHERE THESE NUMBERS CAME FROM. Generated with Motion Diffusion Model
// (github.com/GuyTevet/motion-diffusion-model, humanml_trans_enc_512) from text
// prompts, retargeted from its 22-joint HumanML3D skeleton onto this rider's
// joints, and baked here as source.
//
// THEY ARE CODE, AND THAT IS THE POINT. The asset contract forbids files and the
// network; a keyframe table is a constant, like a colour or a road wavelength.
// Nothing is fetched at runtime, this survives a copy of the folder, and any
// number below can be edited by hand. MDM was a tool that ran once on a GPU box,
// exactly as an image generator is a tool that makes reference frames.
//
// EVERY VALUE IS A DELTA, IN RADIANS, FROM THE RIDER'S OWN REST POSE. MDM
// animates a STANDING figure; this rider is seated on a bike with a rest pose
// authored in assets/rider.js. Absolute angles would stand him up on the tank.
// The change in each bone's direction is the only part of a standing punch that
// transfers to a seated one, so player.js applies these as `rest + delta`.
//
// `t` is normalised 0..1 across the action, so an attack's own cooldown sets the
// duration and retuning the combat timing does not require rebaking.
//
// Bone keys map to assets/rider.js `userData.joints`:
//   torso neck head | armR/armL _upper _elbow | legR/legL _thigh _knee

// ---------------------------------------------------------------------------
// STRIKES -- the attacks, as HAND / FOOT TRAJECTORIES solved by two-bone IK.
//
// WHY THE MDM TABLES FOR punch / kick / chain WERE REMOVED. They were Euler
// deltas on x AND z of both the shoulder and the ELBOW, lerped per axis between
// 12 keys. The elbow is a hinge: a z delta bends the forearm sideways, which no
// arm can do. And the keys oscillate -- the right elbow's x over the jab ran
// -0.07 -0.28 -0.85 -1.59 -1.53 -0.73 -0.41 -0.86 -0.87 -0.22 0.03 -0.05, two
// full bend/unbend cycles in a 0.3 s punch. That was the "wavy hands". They were
// also a standing figure's motion added to a seated rest pose, and the phase ran
// off `cd * 0.7` while combat.js ends the attack at `wind + 0.22`: MEASURED, the
// kick was cut off at 73% of its clip and the chain at 47%, snapping back to the
// bars from mid-swing.
//
// NOW: each strike is a handful of KEY POSITIONS for the fist (or boot), and
// riderpose.poseCombat runs a C1 spline through them and puts the limb there by
// IK with a pole, so the elbow / knee can only ever bend the anatomical way.
//
// `limb` is 'arm' or 'leg', NOT a side: poseCombat uses the limb on the side
// the target is on (Fighter.active.side, chosen in combat.js), and the offsets
// below mirror automatically because `out` is measured toward that limb's side.
//
// Key format: [u, 'rest'] is the limb's own contact (grip / peg); [u, 'root',
// [out, up, fwd]] is an offset from the limb's root joint (shoulder / hip) in
// the BIKE frame, in units of the limb's full length, `out` toward the limb's
// own side. `u` is normalised over the attack (0 -> wind + 0.22 s). `body` is a
// torso twist / lean and head turn toward the strike side, 0 -> peak -> 0.
export const STRIKES = {
  // PUNCH -- a hook to the rider alongside. combat.js tests the hit at
  // wind = 0.09 s of 0.31 s (u 0.29); the fist arrives at u 0.46 (0.14 s) so
  // the blow reads as landing with the hit flash, not before the arm moves.
  punch: {
    limb: 'arm',
    keys: [
      [0.00, 'rest'],
      [0.22, 'root', [0.10, -0.20, 0.38]],   // cocked: fist in by the chin, elbow up and out
      [0.46, 'root', [0.96, -0.04, 0.22]],   // contact: arm long, out the side at shoulder height
      [0.60, 'root', [0.90, -0.10, 0.20]],   // stays on the target a beat
      [1.00, 'rest'],
    ],
    body: { twist: 0.34, lean: 0.10, head: 0.45, peak: 0.46 },
  },
  // KICK -- a side kick off the peg on the target's side. Hit test at 0.15 s of 0.37 s (u 0.41);
  // the chamber (knee drawn UP and FORWARD) is what makes it read as a kick and
  // not as a leg sliding sideways.
  kick: {
    limb: 'leg',
    keys: [
      [0.00, 'rest'],
      [0.26, 'root', [0.34, -0.30, 0.40]],   // chamber: knee up by the tank, boot tucked
      [0.48, 'root', [0.97, -0.26, 0.10]],   // extension: boot driven straight out the side
      [0.62, 'root', [0.90, -0.32, 0.04]],
      [1.00, 'rest'],
    ],
    // lean AWAY from the kick (negative = toward the other side): the counterweight
    body: { twist: 0.10, lean: -0.16, head: 0.40, peak: 0.48 },
  },
  // CHAIN -- wound back high over the shoulder, cracked forward and across,
  // followed through low. Hit test at 0.22 s of 0.44 s (u 0.50).
  chain: {
    limb: 'arm',
    keys: [
      // [chain agent] the chain is a simulated rope now (chainweapon.js), so
      // the fist path IS the whip. MEASURED with the old 4 keys: the fist rose
      // 1 m and stopped dead at the wound key, and the TIP peaked there (38 m/s
      // at u 0.23) -- the crack happened on the wind-up. Now the wind-up is a
      // lift then a slower circle back (the fist never stops: the loop key keeps
      // it moving), and the fist decelerates hard at the crack key just after
      // the hit test at u 0.50, which is what throws the tip past the hand.
      [0.00, 'rest'],
      [0.26, 'root', [0.28, 0.58, -0.04]],   // lift: fist up past the shoulder
      [0.40, 'root', [0.40, 0.80, -0.32]],   // wound: circling back over the shoulder
      [0.53, 'root', [0.96, 0.16, 0.30]],    // the crack: arm whips out and forward
      [0.72, 'root', [0.58, -0.56, 0.30]],   // follow-through, low and across
      [1.00, 'rest'],
    ],
    body: { twist: 0.42, lean: 0.14, head: 0.40, peak: 0.53 },
  },
};

// The remaining clips are WHOLE-BODY reactions (knockdown, tuck) where no limb
// has a target to reach, so per-joint deltas are the right representation.
export const MOTIONS = {
  // knockdown - hit hard, thrown backwards  (MDM clip 4, sustained, kept 4-79 of 80)
  knockdown: {
    armL_upper: { x: [0.031, 0.122, 0.293, 0.457, 0.162, -0.209, -0.013, 0.384, 0.535, 0.232, 0.002, -0.121],
                 z: [-0.040, -0.254, -0.457, -0.509, -0.323, 0.042, -0.077, -0.365, -0.450, -0.370, -0.162, 0.049] },
    armR_elbow: { x: [0.034, -0.306, -0.610, -0.548, -0.663, -0.279, -0.108, -0.517, -0.478, -0.666, -0.640, -0.390],
                 z: [-0.042, -0.284, -0.281, -0.297, -0.178, 0.016, -0.087, -0.294, -0.223, -0.083, 0.052, 0.112] },
    armR_upper: { x: [0.011, -0.097, -0.146, 0.238, 0.011, -0.158, -0.095, 0.025, 0.307, -0.101, -0.331, -0.296],
                 z: [0.083, 0.557, 0.861, 0.986, 0.776, 0.083, 0.153, 0.832, 0.993, 0.820, 0.504, 0.138] },
    head: { x: [-0.059, 0.027, 0.190, 0.283, 0.037, -0.184, -0.396, -0.016, 0.203, 0.088, -0.043, -0.121],
           z: [0.016, 0.033, 0.072, 0.088, 0.048, 0.059, 0.090, 0.082, 0.107, 0.074, 0.047, 0.058] },
    legL_knee: { x: [-0.029, -0.083, -0.233, -0.362, -0.236, -0.072, -0.136, -0.138, -0.212, -0.221, -0.159, -0.106],
                z: [0.003, 0.028, 0.074, 0.056, 0.039, 0.026, 0.028, 0.055, 0.099, 0.108, 0.065, 0.004] },
    legR_knee: { x: [-0.083, -0.213, -0.344, -0.416, -0.185, 0.002, -0.171, -0.309, -0.349, -0.276, -0.162, -0.106],
                z: [-0.026, -0.158, -0.270, -0.265, -0.148, -0.014, -0.025, -0.223, -0.303, -0.245, -0.189, -0.149] },
    torso: { x: [-0.124, -0.527, -0.970, -1.180, -0.613, 0.134, -0.078, -0.878, -1.251, -0.827, -0.358, -0.092],
            z: [0.019, 0.049, 0.055, 0.067, 0.006, -0.038, 0.016, 0.052, 0.052, 0.010, -0.028, -0.024] },
  },
  // tuck - fold down onto the tank  (MDM clip 5, sustained, kept 5-79 of 80)
  tuck: {
    armL_elbow: { x: [0.001, 0.103, 0.488, 0.749, 0.697, 0.637, 0.631, 0.545, 0.458, 0.375, 0.330, 0.363],
                 z: [0.041, 0.013, -0.160, -0.309, -0.359, -0.359, -0.371, -0.407, -0.416, -0.393, -0.396, -0.403] },
    armL_upper: { x: [0.017, 0.123, 0.377, 0.525, 0.524, 0.541, 0.571, 0.528, 0.476, 0.420, 0.378, 0.383],
                 z: [0.037, 0.079, 0.072, -0.030, -0.019, 0.078, 0.140, 0.198, 0.232, 0.235, 0.226, 0.226] },
    armR_elbow: { x: [0.038, 0.060, 0.118, 0.140, 0.188, 0.253, 0.336, 0.451, 0.550, 0.555, 0.551, 0.554],
                 z: [0.005, 0.009, 0.084, 0.161, 0.218, 0.305, 0.408, 0.459, 0.445, 0.427, 0.400, 0.384] },
    armR_upper: { x: [0.036, 0.059, 0.067, 0.057, 0.083, 0.130, 0.170, 0.161, 0.168, 0.215, 0.203, 0.189],
                 z: [0.012, 0.043, 0.154, 0.248, 0.281, 0.300, 0.343, 0.349, 0.341, 0.361, 0.352, 0.337] },
    legL_knee: { x: [-0.010, -0.090, -0.283, -0.358, -0.397, -0.524, -0.619, -0.676, -0.665, -0.634, -0.601, -0.607],
                z: [-0.007, 0.001, 0.028, 0.028, 0.055, 0.113, 0.170, 0.233, 0.232, 0.211, 0.199, 0.196] },
    legL_thigh: { x: [0.058, 0.213, 0.513, 0.601, 0.601, 0.712, 0.837, 0.910, 0.881, 0.801, 0.757, 0.753],
                 z: [-0.022, -0.086, -0.236, -0.281, -0.306, -0.402, -0.500, -0.557, -0.538, -0.482, -0.465, -0.461] },
    legR_knee: { x: [-0.021, -0.167, -0.518, -0.690, -0.769, -0.957, -1.123, -1.228, -1.207, -1.126, -1.072, -1.054],
                z: [-0.025, -0.108, -0.254, -0.265, -0.260, -0.288, -0.312, -0.301, -0.276, -0.258, -0.255, -0.256] },
    legR_thigh: { x: [-0.001, 0.149, 0.470, 0.565, 0.610, 0.707, 0.764, 0.770, 0.744, 0.706, 0.685, 0.689] },
    torso: { x: [0.007, -0.096, -0.308, -0.418, -0.447, -0.483, -0.512, -0.524, -0.520, -0.481, -0.458, -0.465],
            z: [-0.021, -0.017, -0.025, -0.064, -0.054, 0.017, 0.077, 0.095, 0.079, 0.060, 0.043, 0.033] },
  },
};

// Sample one baked action at normalised time t. Uniform Catmull-Rom between
// keyframes rather than a straight lerp: a lerp has a velocity step at every
// key (12 kinks per clip, each a visible twitch at 60 fps); Catmull-Rom passes
// through the same keys with continuous velocity.
// Returns { boneKey: {x, z} } of DELTAS to add to the rider's rest pose.
function cr(arr, a, f) {
  const n = arr.length;
  const p0 = arr[Math.max(0, a - 1)], p1 = arr[a], p2 = arr[Math.min(n - 1, a + 1)], p3 = arr[Math.min(n - 1, a + 2)];
  const f2 = f * f, f3 = f2 * f;
  return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}
export function sampleMotion(name, t) {
  const m = MOTIONS[name];
  if (!m) return null;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const out = {};
  for (const bone in m) {
    const tr = m[bone];
    const n = tr.x.length;
    const p = u * (n - 1);
    const a = Math.min(n - 1, Math.floor(p)), f = p - a;
    out[bone] = { x: cr(tr.x, a, f), z: tr.z ? cr(tr.z, a, f) : 0 };
  }
  return out;
}

// ---------------------------------------------------------------------------
// ON-FOOT constants, appended for the dismount/walk system (dismount.js).
//
// These are NOT MDM clips and they are NOT deltas on a riding pose: walking is a
// PROCEDURAL SINE GAIT, driven directly in dismount.js, because a gait has to
// close a loop with the walker's own ground speed (feet must not slide and must
// not march on the spot) and a fixed keyframe table cannot. They are constants,
// though, in exactly the sense §11 allows — numbers in source, no file, no
// fetch — and they are here rather than in dismount.js so that retuning the walk
// is a table edit, which is the whole point of this file existing.
//
// ANGLE CONVENTIONS. All radians, ASSIGNED (not added) by dismount.js. The
// rig's zero is a straight standing leg. On the hip, +x swings the thigh toward
// the tail; on the knee, +x folds the shin back (the anatomical way). The seated
// fold lives in src/reach.js RIDING (hip -1.60, knee +2.44) and, in the race,
// is placed by IK (src/limbik.js) rather than read from the table. `thigh`
// carries only the gait swing.
export const GAIT = {
  // STANDING IS ZERO. dismount.js ASSIGNS these (rot(L.hip, hipStand)), it
  // does not add them to the seated fold, so "undo RIDING.hip" was the wrong
  // model: -1.48 assigned swung the thigh 85 deg forward -- with RIDING's old
  // backwards legs that happened to be the knees-forward SEATED pose, so the
  // rider walked sitting. The rig's zero is the straight standing leg (it is
  // the pose assets/rider.js measures its height in). A 0.20 knee flex reads as
  // standing at ease rather than locked; the prone pose's -0.22 then lands at a
  // straight leg instead of a hyperextended one.
  hipStand: 0,
  kneeStand: 0.20,

  // stride: the sine the legs swing on. phase is per-leg, offset by PI so the
  // legs are always opposite, which is what makes it read as walking rather than
  // as bobbing.
  cadence: 5.4,         // rad/s of gait phase at full walking speed
  stride: 0.42,         // rad of thigh swing at full stride
  thighSwing: 1.0,      // multiplier on that swing
  lift: 0.55,           // rad the knee folds as the foot comes up
  // NEGATIVE because dismount.js SUBTRACTS lift * kneeBend and a knee folds the
  // shin back with POSITIVE x in this rig (see RIDING.knee); +1.15 bent every
  // stepping knee forward, like a bird's.
  kneeBend: -1.15,

  // upper body: what separates a walk from a shuffle
  torsoLean: -0.10,     // slight forward lean while upright (rest is -0.55)
  armDown: 0.15,        // arms hang and swing
  armOut: 0.22,         // a little out from the body
  elbowBend: -0.35,

  mountSwing: 0.85,     // rad the right leg swings over the saddle
};

// The prone pose used between the tumble and the stand. Kept beside GAIT so the
// two ends of the rise are tuned together.
export const FALLPOSE = {
  torsoProne: -1.05,    // folded on the tarmac
  neckProne: 0.45,
  armProne: 0.9,        // arms forward, breaking the fall
  rollRest: -1.35,      // the face-down roll the group carries while DOWN
};
