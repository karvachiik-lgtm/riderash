// RideRash — posing a rider.
//
// WHY THIS MODULE EXISTS. The bone resolver and the delta applier were written
// twice, once in player.js and once in rivals.js, with the same eleven-case
// switch copied between them. They had already drifted: the player's version
// cleared the motion axes before posing and the rivals' version did not, which
// is the difference between a punch that returns to rest and one that winds up
// over five seconds. Two copies of a switch is one copy too many.
//
// The seam this defines: **a rider is anything with a `userData.joints` map in
// the shape assets/rider.js publishes.** Nothing here knows about bikes,
// physics, combat or the player. A second character — a cop, a pedestrian, a
// different rig — works by publishing the same joint names, and every motion
// table in motions.js applies to it for free.
import * as THREE from 'three';
import { sampleMotion, STRIKES } from './motions.js';
import { RIDING } from './reach.js';
import { makeLimb, solveLimb, effectorWorld } from './limbik.js';
// [chain agent] the chain is a verlet rope now (src/chainweapon.js)
import { driveChain } from './chainweapon.js';

// The canonical bone keys. motions.js writes these, every rig resolves them.
// Anything added here must also be resolvable in `node()` below, or a motion
// referencing it is a silent no-op.
export const BONES = [
  'torso', 'neck', 'head',
  'armR_upper', 'armR_elbow', 'armL_upper', 'armL_elbow',
  'legR_thigh', 'legR_knee', 'legL_thigh', 'legL_knee',
];

/**
 * Resolve one bone key against a rig's joint map.
 *
 * assets/rider.js publishes both spellings -- `arms.right` and `rightArm` (and
 * the same for legs) -- so either resolves. A missing joint returns null rather
 * than throwing: a rig built from a different asset must not take the frame
 * down, it should simply not animate that limb.
 */
export function node(joints, key) {
  if (!joints) return null;
  const arms = joints.arms || {};
  const legs = joints.legs || {};
  switch (key) {
    case 'torso': return joints.torso || null;
    case 'neck':  return joints.neck || null;
    case 'head':  return joints.head || null;
    case 'armR_upper': return (joints.rightArm || arms.right || {}).upper || null;
    case 'armR_elbow': return (joints.rightArm || arms.right || {}).elbow || null;
    case 'armL_upper': return (joints.leftArm  || arms.left  || {}).upper || null;
    case 'armL_elbow': return (joints.leftArm  || arms.left  || {}).elbow || null;
    case 'legR_thigh': return (joints.rightLeg || legs.right || {}).thigh || null;
    case 'legR_knee':  return (joints.rightLeg || legs.right || {}).knee || null;
    case 'legL_thigh': return (joints.leftLeg  || legs.left  || {}).thigh || null;
    case 'legL_knee':  return (joints.leftLeg  || legs.left  || {}).knee || null;
    default: return null;
  }
}

/**
 * Clear the axes a rest pose does not write itself.
 *
 * MUST be called before the rest pose, every frame. The motion tables are
 * DELTAS added on top of whatever is already on the joint, which is only sound
 * if the rest pose wrote that axis -- and the riding pose sets `rotation.x`
 * everywhere but `z` only on the upper arms. Without this, `rotation.z += d`
 * on an elbow compounds: measured 1.5 -> 7.8 -> 12.3 -> 16.2 over ten frames of
 * one punch, and then it stuck there.
 *
 * Zeroing here makes each frame's pose a pure function of (rest, motion) with
 * no memory of the frame before it.
 */
export function clearAxes(joints) {
  if (!joints) return;
  for (const key of BONES) {
    const n = node(joints, key);
    if (n && n.rotation) { n.rotation.y = 0; n.rotation.z = 0; }
  }
  // The leg IK writes a FULL orientation to `hip` (the thigh's swing joint),
  // including a y twist. Nothing else writes hip.y, so a stale twist would
  // survive into dismount.js's standing pose, which only writes hip.x.
  for (const side of ['left', 'right']) {
    const L = joints[side + 'Leg'] || (joints.legs && joints.legs[side]);
    if (L && L.hip && L.hip.rotation) { L.hip.rotation.y = 0; L.hip.rotation.z = 0; }
  }
  // IK targets are bike-relative; they are only valid once poseSeated has put
  // the body on the bike THIS frame. A standing or crashed pose must not be
  // dragged back to the grips by poseCombat.
  joints.__ikOn = false;
}

/** Add a sampled motion's deltas onto the current (rest) pose. */
export function addDeltas(joints, m) {
  if (!m) return;
  for (const key in m) {
    const n = node(joints, key);
    if (!n || !n.rotation) continue;
    const d = m[key];
    if (Number.isFinite(d.x)) n.rotation.x += d.x;
    if (Number.isFinite(d.z)) n.rotation.z += d.z;
  }
}

/**
 * Play a named action at normalised time `t` on a rig.
 *
 * Returns true if a baked table drove the pose, false if the caller should fall
 * back to its own swing -- so adding an attack to combat.js animates *somehow*
 * rather than freezing the rider, and a missing table is visible as a plainer
 * motion rather than as a bug.
 */
export function applyAction(joints, kind, t) {
  const m = sampleMotion(kind, t);
  if (!m) return false;
  addDeltas(joints, m);
  return true;
}

/**
 * THE SEATED REST POSE, for any rider on any bike: hands on the grips, boots on
 * the pegs, torso blended from upright (tuck 0) to racing crouch (tuck 1).
 *
 * WHY IT IS HERE. The player posed from the solved table in reach.js while the
 * rivals kept a stale hand-written copy (upper -1.15, elbow -0.55, torso -0.55
 * RECLINED, legs never re-asserted). MEASURED in the race: the player's fists
 * sat 2-3 mm from the grips and every rival's sat 0.65 m ABOVE the bars. One
 * function, called by the player, every rival and the showroom, is what makes
 * that impossible to reintroduce.
 *
 * HOW. The torso and neck are written as angles. The LIMBS are then placed by
 * two-bone IK (src/limbik.js) onto the bike's own grip and peg contacts, with a
 * pole that puts the elbows out-and-back and the KNEES FORWARD. The angle table
 * below the IK is only the fallback for a rig that has not been through
 * solveSeat (no bike contacts to aim at).
 *
 * Writes absolute angles; call `clearAxes` first, add motion deltas after.
 */
export function poseSeated(joints, tuck = 1) {
  if (!joints) return;
  const t = Math.max(0, Math.min(1, tuck));
  const set = (n, x, z) => {
    if (!n || !n.rotation) return;
    n.rotation.x = x;
    if (z !== undefined) n.rotation.z = z;
  };
  const Q = joints.__seat || null;
  // A little more crouch with speed. The table's tuck and rest leans are equal
  // (the arm solve could not reach the bars from anything else); with IK on the
  // arms that constraint is gone, so a 0.14 rad fold at full speed is free.
  const torso = (Q ? Q.torso : RIDING.torsoRest + t * (RIDING.torsoTuck - RIDING.torsoRest)) + (Q ? 0.14 * t : 0);
  set(joints.torso, torso);
  set(joints.neck, RIDING.neckRest + t * (RIDING.neckTuck - RIDING.neckRest) - (Q ? 0.10 * t : 0));

  // fallback angles (no IK context): the measured table, with the legs on the
  // KNEES-FORWARD branch -- see RIDING.hip in reach.js
  const la = joints.leftArm || (joints.arms && joints.arms.left);
  const ra = joints.rightArm || (joints.arms && joints.arms.right);
  const upper = RIDING.upperArm - t * (RIDING.upperArm - RIDING.upperRest);
  const elbow = RIDING.elbow - t * (RIDING.elbow - RIDING.elbowRest);
  if (la) { set(la.upper, upper, RIDING.upperSplay); set(la.elbow, elbow); }
  if (ra) { set(ra.upper, upper, -RIDING.upperSplay); set(ra.elbow, elbow); }
  for (const side of ['left', 'right']) {
    const L = joints[side + 'Leg'] || (joints.legs && joints.legs[side]);
    if (!L) continue;
    set(L.hip, RIDING.hip, side === 'left' ? RIDING.hipSplay : -RIDING.hipSplay);
    if (L.thigh && L.thigh.rotation) L.thigh.rotation.x = 0;
    set(L.knee, RIDING.knee);
  }

  if (joints.__ik) {
    joints.__ikOn = true;
    solveLimbs(joints, null);
  }
}

// ---------------------------------------------------------------------------
// IK CONTEXT -- built once per body per bike by solveSeat, used every frame.
// ---------------------------------------------------------------------------

const LIMB_KEYS = ['left', 'right', 'leftLeg', 'rightLeg'];
const _w0 = new THREE.Vector3(), _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3();
const _bq = new THREE.Quaternion();

// Pole offsets in the BIKE frame (x outward on the limb's own side, y up, z
// toward the front wheel), in metres from the limb's root joint. Chosen by
// looking, then checked from both sides and above:
//   elbow: out 0.30, down 0.45, back 0.40 -- elbows out and dropped, the way a
//          rider holds bars (an elbow pole straight down reads as chicken wings
//          folded under; straight back folds the arm up over the tank)
//   knee:  out 0.22, up 0.10, forward 1.0 -- knees FORWARD along the tank, a
//          little out. This single number is the fix for "legs backwards".
export const POLES = {
  arm: [0.30, -0.45, -0.40],
  leg: [0.22, 0.10, 1.00],
};

/** A bike-frame DIRECTION offset (x mirrored) added to a world point. */
function offsetFrom(ik, base, v, sx, out) {
  ik.bike.getWorldQuaternion(_bq);
  out.set(v[0] * sx, v[1], v[2]).applyQuaternion(_bq);
  return out.add(base);
}

/** The rest target (grip / peg) of one limb, in world space. */
export function restTarget(ik, key, out) {
  const r = ik.rest[key];
  out.set(r.x, r.y, r.z);
  return ik.bike.localToWorld(out);
}

/**
 * Put every limb on its target. `over` maps a limb key ('left', 'right',
 * 'leftLeg', 'rightLeg') to a world-space target; limbs not in it go to their
 * grip / peg. Called by poseSeated (no overrides) and again by poseCombat after
 * it has moved the torso (so the free hand stays on its grip through a punch).
 */
export function solveLimbs(joints, over) {
  const ik = joints && joints.__ik;
  if (!ik || !joints.__ikOn) return;
  ik.bike.updateWorldMatrix(true, false);
  keepGripsInReach(joints, ik, over);
  for (const key of LIMB_KEYS) {
    const L = ik.limbs[key];
    if (!L) continue;
    const tgt = over && over[key] ? _w0.copy(over[key]) : restTarget(ik, key, _w0);
    L.root.parent.updateWorldMatrix(true, false);
    _w1.copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
    const leg = key.endsWith('Leg');
    offsetFrom(ik, _w1, leg ? POLES.leg : POLES.arm, ik.sx[key], _w2);
    solveLimb(L, tgt, _w2);
  }
}

/**
 * THE HANDS STAY ON THE BARS: if the torso has been thrown back (a recoil, a
 * wrench) so far that a free arm can no longer reach its grip, lean the torso
 * forward again -- by bisection, the least it takes -- until it can. MEASURED
 * before this: a 0.35 rad hit recoil put the shoulder 0.17 m further from the
 * bars than a 0.58 m arm could close, and the fist hung 8 cm off the grip for
 * the whole flash. A rider who is hit keeps hold of the bike; the recoil still
 * reads because the torso goes back as far as the arms allow.
 */
function keepGripsInReach(joints, ik, over) {
  const T = joints.torso;
  if (!T || !T.rotation) return;
  const free = ['left', 'right'].filter((k) => ik.limbs[k] && !(over && over[k]));
  if (!free.length) return;
  const worst = () => {
    let m = 0;
    for (const k of free) {
      const L = ik.limbs[k];
      L.root.parent.updateWorldMatrix(true, false);
      _w1.copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
      restTarget(ik, k, _w2);
      const reach = (L.mid.position.length() + L.endLocal.length()) * L.root.parent.matrixWorld.getMaxScaleOnAxis();
      m = Math.max(m, _w1.distanceTo(_w2) / reach);
    }
    return m;
  };
  const LIMIT = 0.985;
  if (worst() <= LIMIT) return;
  let lo = T.rotation.x, hi = lo + 0.9;
  T.rotation.x = hi;
  if (worst() > LIMIT) return;                 // cannot fix by leaning; leave it
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    T.rotation.x = mid;
    if (worst() > LIMIT) lo = mid; else hi = mid;
  }
  T.rotation.x = hi;
}

function buildLimbs(j, S) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const arm = (A) => A && makeLimb(A.upper, null, A.elbow, A.fore, V(0, -S.forearm - S.hand * 0.5, 0.01), -1);
  const leg = (L) => L && makeLimb(L.hip, L.thigh, L.knee, L.shin, V(0, -S.shin - S.foot * 0.55, S.foot * 0.1), +1);
  return {
    left: arm(j.leftArm), right: arm(j.rightArm),
    leftLeg: leg(j.leftLeg), rightLeg: leg(j.rightLeg),
  };
}

/**
 * SOLVE THE SEAT FOR THIS BODY ON THIS BIKE and store the IK context on the
 * joints for poseSeated / poseCombat.
 *
 * WHY. RIDING was solved once, for a 1.75 m body, and every other body rode
 * with the same angles: MEASURED at 2.00 m the fists missed the grips by 8 cm
 * and the boots the pegs by 9 cm. The previous version of this function ran a
 * coordinate descent over the joint ANGLES with the hip boxed to [0.9, 2.1] --
 * which in this rig is the thigh swung toward the TAIL. It converged every time,
 * on the mirror-image branch: boot on the peg, knee behind the hip. That was the
 * "legs backwards" the player saw. Now the limbs are placed by analytic IK with
 * an explicit knee-forward pole, and the only thing searched is the torso lean,
 * chosen so the arms reach the grips with a relaxed ~0.88 of full extension
 * (a locked-straight arm reads as a mannequin; a folded one as a chimp).
 *
 * The rider must already be mounted (bike -> socket -> rider). Returns the
 * residuals in metres, or null when the bike publishes no contacts.
 */
export function solveSeat(rider, bike) {
  const j = rider && rider.userData && rider.userData.joints;
  const S = rider && rider.userData && rider.userData.spec;
  if (!j || !S || !bike) return null;
  let C = null;
  bike.traverse((n) => { if (!C && n.userData && n.userData.contacts) C = n.userData.contacts; });
  if (!C || !C.grip || !C.peg) return null;
  const g = (v) => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v);
  const grip = g(C.grip), peg = g(C.peg);
  const limbs = buildLimbs(j, S);
  for (const k of LIMB_KEYS) if (!limbs[k]) return null;

  delete j.__seat; delete j.__ik;
  clearAxes(j); poseSeated(j, 1);
  bike.updateWorldMatrix(true, true);
  // which lateral side each limb is on, in the bike frame: the rig's own
  // `left` is not guaranteed to be the bike's -x (see armForSide)
  const sx = {}, rest = {};
  const loc = new THREE.Vector3();
  for (const k of LIMB_KEYS) {
    const L = limbs[k];
    L.root.parent.updateWorldMatrix(true, false);
    loc.copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
    bike.worldToLocal(loc);
    sx[k] = loc.x >= 0 ? 1 : -1;
    const c = k.endsWith('Leg') ? peg : grip;
    rest[k] = { x: sx[k] * Math.abs(c.x), y: c.y, z: c.z };
  }
  const ik = { bike, limbs, sx, rest };

  // search the torso lean: arms at ~0.88 of full reach, averaged over both
  const reachOf = (L) => {
    const a = L.mid.position.length() + L.endLocal.length();
    return a;
  };
  const q = { torso: RIDING.torsoTuck };
  let best = Infinity, bestT = q.torso;
  const sh = new THREE.Vector3(), gp = new THREE.Vector3();
  for (let tq = 0.0; tq <= 0.90001; tq += 0.03) {
    j.torso.rotation.x = tq;
    let e = 0;
    for (const k of ['left', 'right']) {
      const L = limbs[k];
      L.root.parent.updateWorldMatrix(true, false);
      sh.copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
      gp.set(rest[k].x, rest[k].y, rest[k].z); bike.localToWorld(gp);
      const sc = L.root.parent.matrixWorld.getMaxScaleOnAxis();
      const frac = sh.distanceTo(gp) / (reachOf(L) * sc);
      e += (frac - 0.88) ** 2;
    }
    if (e < best) { best = e; bestT = tq; }
  }
  q.torso = bestT;
  j.__seat = q;
  j.__ik = ik;
  clearAxes(j); poseSeated(j, 1);
  // residuals, measured by forward kinematics on the posed rig
  bike.updateWorldMatrix(true, true);
  const res = (k) => {
    const e = effectorWorld(limbs[k], new THREE.Vector3());
    return e.distanceTo(restTarget(ik, k, new THREE.Vector3()));
  };
  return {
    hand: Math.max(res('left'), res('right')),
    foot: Math.max(res('leftLeg'), res('rightLeg')),
    seat: { ...q },
  };
}

/**
 * STANDING, off the bike: legs straight under the hips (the rig's zero, which
 * is the pose assets/rider.js measures its own height in), torso upright, arms
 * hanging a little out from the body. `phase` (radians) and `amt` (0..1) add a
 * walking gait on top, so the same function drives an idle stand and a walk.
 */
export function poseStanding(joints, phase = 0, amt = 0) {
  if (!joints) return;
  clearAxes(joints);
  const set = (n, x, z) => {
    if (!n || !n.rotation) return;
    n.rotation.x = x;
    if (z !== undefined) n.rotation.z = z;
  };
  const sw = Math.sin(phase) * 0.42 * amt;
  set(joints.torso, 0.04 + 0.06 * amt);
  set(joints.neck, -0.04);
  const la = joints.leftArm || (joints.arms && joints.arms.left);
  const ra = joints.rightArm || (joints.arms && joints.arms.right);
  if (la) { set(la.upper, -sw * 0.8, 0.12); set(la.elbow, -0.18 - 0.2 * amt); }
  if (ra) { set(ra.upper, sw * 0.8, -0.12); set(ra.elbow, -0.18 - 0.2 * amt); }
  for (const side of ['left', 'right']) {
    const L = joints[side + 'Leg'] || (joints.legs && joints.legs[side]);
    if (!L) continue;
    const s = side === 'left' ? 1 : -1;
    const ph = phase + (s > 0 ? 0 : Math.PI);
    const swing = Math.sin(ph) * 0.42 * amt;
    const lift = Math.max(0, Math.cos(ph)) * 0.55 * amt;
    set(L.hip, 0, s * 0.03);
    if (L.thigh && L.thigh.rotation) L.thigh.rotation.x = swing;   // + swings forward, as RIDING.hip does
    // POSITIVE knee x folds the shin BACK (toward -Z; the rider faces +Z). This
    // was -lift, which bent every lifted knee the wrong way, like a bird's.
    set(L.knee, lift * 1.1);
  }
}

// ---------------------------------------------------------------------------
// COMBAT LAYER -- shared by the player, the pack and the showroom.
//
// The chain articulation used to live in player.js only, so every rival's
// chain hung dead straight from the fist no matter what the rival did with it.
// ---------------------------------------------------------------------------

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

function armOf(joints, side) {
  return side === 'left'
    ? (joints.leftArm || (joints.arms && joints.arms.left))
    : (joints.rightArm || (joints.arms && joints.arms.right));
}

/**
 * Which arm is on a given LATERAL side of the bike (+1 or -1)? Measured once
 * per rig from the live shoulders against the road normal, then cached: the
 * rig's own `left` is not guaranteed to be the road's +lateral, and guessing
 * the mirror is how a grab reaches away from the victim.
 */
export function armForSide(joints, phys, side) {
  if (!joints) return 'right';
  if (joints.__plusArm === undefined && phys && phys.tangent) {
    const la = armOf(joints, 'left'), ra = armOf(joints, 'right');
    const ls = la && (la.shoulder || la.upper), rs = ra && (ra.shoulder || ra.upper);
    if (ls && rs) {
      ls.updateWorldMatrix(true, false); rs.updateWorldMatrix(true, false);
      ls.getWorldPosition(_v0); rs.getWorldPosition(_v1);
      const nx = -phys.tangent.z, nz = phys.tangent.x;
      _v2.subVectors(_v0, _v1);
      joints.__plusArm = (_v2.x * nx + _v2.z * nz) > 0 ? 'left' : 'right';
    }
  }
  const plus = joints.__plusArm || 'left';
  return side >= 0 ? plus : (plus === 'left' ? 'right' : 'left');
}

/**
 * A reaching, gripping arm. `k` 0..1 is how far out it is; `yank` adds the
 * pull-and-shake of an arm that is holding something that fights back.
 *
 * With an IK context (a seated rider) this returns a WORLD TARGET for the hand
 * and poseCombat solves the arm onto it; the elbow follows from the pole, so a
 * yank shortens the reach instead of bending the elbow sideways. Without one it
 * falls back to the old angle blend.
 */
export function poseReach(joints, side, k, yank = 0, extend = 0, over = null) {
  const A = armOf(joints, side);
  if (!A || k <= 0) return;
  // `left` is +X (anatomical, see assets/rider.js). Outward splay on the upper
  // arm is +z for left; LEANING the torso toward +X is -z (z turns +Y to -X).
  const out = side === 'left' ? 1 : -1;
  const ik = joints.__ikOn && joints.__ik;
  if (joints.torso && joints.torso.rotation) joints.torso.rotation.z -= out * 0.16 * k;
  if (joints.neck && joints.neck.rotation) joints.neck.rotation.z -= out * 0.12 * k;
  if (ik && over) {
    const L = ik.limbs[side], sx = ik.sx[side];
    const root = rootOf(L, _v0);
    const reach = limbReach(L);
    // the hand out over the other rider's bars: shoulder height, out ~0.85-1.0
    // of the arm, a little forward; a yank hauls it back in toward the chest
    const o = [(0.84 + 0.12 * extend - 0.16 * Math.max(0, yank)) * reach,
               (-0.10 + 0.06 * yank) * reach,
               (0.18 - 0.10 * Math.max(0, yank)) * reach];
    const grip = restTargetW(ik, side, _v1);
    const reachPt = offsetFrom(ik, root, o, sx, _v2);
    over[side] = grip.lerp(reachPt, smooth(k)).clone();
    return;
  }
  if (A.upper && A.upper.rotation) {
    A.upper.rotation.x = lerp(A.upper.rotation.x, -1.30 + yank * 0.18, k);
    A.upper.rotation.z = lerp(A.upper.rotation.z, out * (1.05 + extend * 0.35), k);
  }
  if (A.elbow && A.elbow.rotation) {
    A.elbow.rotation.x = lerp(A.elbow.rotation.x, -0.62 + extend * 0.62 - yank * 0.25, k);
  }
}

function limbReach(L) {
  const sc = L.root.parent.matrixWorld.getMaxScaleOnAxis();
  return (L.mid.position.length() + L.endLocal.length()) * sc;
}
function rootOf(L, out) {
  L.root.parent.updateWorldMatrix(true, false);
  return out.copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
}
function restTargetW(ik, key, out) { return restTarget(ik, key, out); }

/**
 * THE STRIKE TRAJECTORY for one attack at normalised time u, as a world target
 * for the striking limb. Keys come from motions.js STRIKES: each is either the
 * limb's rest contact (grip / peg) or an offset from the limb's ROOT (shoulder /
 * hip) in units of the limb's own length, in the bike frame with x outward.
 *
 * The keys are joined by a non-uniform Catmull-Rom spline (C1: continuous
 * velocity, so the fist never stops dead mid-flight or jerks at a key), with
 * zero velocity at the two rest ends so it leaves and lands on the grip softly.
 * Interpolating POSITIONS rather than joint angles is the whole cure for the
 * wobble: a straight line in hand space is a straight line on screen, while a
 * straight line in (x,z)-Euler space on two joints is a loop.
 */
const _k = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function isAncestor(a, n) {
  for (let p = n; p; p = p.parent) if (p === a) return true;
  return false;
}
function strikeTarget(ik, S, limb, u, out, cross = 1) {
  const L = ik.limbs[limb], sx = ik.sx[limb];
  const root = rootOf(L, _v0);          // refreshes the world matrices limbReach reads
  const reach = limbReach(L);
  const keyPos = (i, o) => {
    const K = S.keys[Math.max(0, Math.min(S.keys.length - 1, i))];
    if (K[1] === 'rest') return restTarget(ik, limb, o);
    const v = K[2];
    return offsetFrom(ik, root, [v[0] * reach * cross, v[1] * reach, v[2] * reach], sx, o);
  };
  const keys = S.keys, n = keys.length;
  let i = 0;
  while (i < n - 2 && u > keys[i + 1][0]) i++;
  const u0 = keys[i][0], u1 = keys[i + 1][0];
  const h = Math.max(1e-4, u1 - u0);
  const s = Math.max(0, Math.min(1, (u - u0) / h));
  const P0 = keyPos(i - 1, _k[0]), P1 = keyPos(i, _k[1]), P2 = keyPos(i + 1, _k[2]), P3 = keyPos(i + 2, _k[3]);
  // tangents (per unit u), zero at the first and last key
  const tan = (Pa, Pb, ua, ub, isEnd, o) => (isEnd ? o.set(0, 0, 0) : o.subVectors(Pb, Pa).multiplyScalar(1 / Math.max(1e-4, ub - ua)));
  const m1 = tan(P0, P2, keys[Math.max(0, i - 1)][0], keys[i + 1][0], i === 0, _w1.clone());
  const m2 = tan(P1, P3, keys[i][0], keys[Math.min(n - 1, i + 2)][0], i + 1 === n - 1, _w2.clone());
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  out.set(0, 0, 0)
    .addScaledVector(P1, h00).addScaledVector(m1, h10 * h)
    .addScaledVector(P2, h01).addScaledVector(m2, h11 * h);
  return out;
}

/**
 * Road lateral side (+1 / -1, Fighter convention: + is the road normal
 * (-tangent.z, tangent.x), see physics.sync) -> the sign of the bike-local x on
 * that side. Measured from the live bike each call rather than assumed, because
 * the bike yaws, leans and may be mirrored; with no road frame (the showroom)
 * + lateral is taken as + bike x.
 */
const _qi = new THREE.Quaternion(), _nl = new THREE.Vector3();
function lateralToBikeX(ik, phys, side) {
  if (!phys || !phys.tangent) return side >= 0 ? 1 : -1;
  ik.bike.getWorldQuaternion(_qi).invert();
  _nl.set(-phys.tangent.z, 0, phys.tangent.x).applyQuaternion(_qi);
  return (_nl.x >= 0 ? 1 : -1) * (side >= 0 ? 1 : -1);
}

/** How long an attack's pose plays: combat.js clears `active` at wind + 0.22 s. */
export function actionDuration(spec) {
  return spec ? spec.wind + 0.22 : 0.3;
}

/** 0 -> 1 -> 0 envelope peaking at `peak`, smooth at both ends. */
function bump(u, peak) {
  return u < peak ? smooth(u / peak) : 1 - smooth((u - peak) / Math.max(1e-3, 1 - peak));
}

/**
 * The chain as a TRAVELLING WAVE. Each link's orientation is a delayed copy of
 * the one above it, so the swing starts at the fist and runs down to the tip:
 * that lag IS the whip. `A(u)` is the absolute angle profile of the swing at
 * normalised time u; link i samples it at u - i*LAG and is written RELATIVE to
 * its parent (links are nested), so the tip ends up where the wave put it.
 *
 * `ph` is the attack phase 0..1, or < 0 when the chain is just being carried
 * (then it trails in the airflow and sways with the road).
 */
export function animateChain(joints, speed, ph, time, seed = 0) {
  const links = joints && joints.chainJoints;
  if (!links || !links.length) return;
  const N = links.length;
  const v = Math.max(0, speed || 0);
  const air = Math.min(1.25, (v / 42) * (v / 42));
  let prevX = 0, prevZ = 0;
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    let ax, az;
    if (ph >= 0) {
      const u = ph - f * 0.18;                           // lag down the chain
      // timed to STRIKES.chain: the fist is wound back at 0.38 and cracks
      // through at 0.56, so the links trail the wind-up and whip after the crack
      const back = smooth(u / 0.38), strike = smooth((u - 0.38) / 0.24), settle = smooth((u - 0.66) / 0.34);
      // + trails BACK (the link's -y turned toward -z, behind a +Z-facing rider)
      ax = lerp(lerp(lerp(0, 1.9, back), -1.6, strike), 0.2 + air * 0.5, settle) * (0.55 + f * 0.9);
      az = Math.sin(Math.max(0, u) * Math.PI * 2) * 1.1 * (0.4 + f);
    } else {
      // carried: trailing back in the wind, a lazy sway that grows to the tip
      ax = (-0.05 + air * 0.85) * (0.3 + f * 0.9) + Math.sin(time * 3.1 + i * 0.55 + seed) * 0.05 * f;
      az = Math.sin(time * 4.3 + i * 0.8 + seed) * (0.05 + air * 0.08) * f;
    }
    const rx = Math.max(-1.3, Math.min(1.3, ax - prevX));
    const rz = Math.max(-1.3, Math.min(1.3, az - prevZ));
    links[i].rotation.x = rx;
    links[i].rotation.z = rz;
    prevX += rx; prevZ += rz;
  }
}

/**
 * Everything a fighter's state does to a seated body: attacks, the grab, the
 * hold, being held, the throw, and the chain. Call after `poseSeated`.
 *
 * ORDER MATTERS: the body layer (torso twist / lean, head turn) goes first,
 * because it moves the shoulders; then every limb is re-solved by IK, the
 * striking one onto its trajectory and the rest back onto grips and pegs. So a
 * punch that twists the chest no longer drags the other hand off the bars.
 */
/**
 * RIDING DYNAMICS -- what a rider's body does on a moving machine, layered on
 * the solved seat (after poseSeated, BEFORE poseCombat, which re-solves the
 * hands onto the grips from wherever the torso ends up).
 *
 *   cornering   the torso hangs off INTO the lean, the head counter-rolls to
 *               keep the eyes level and turns to look through the bend;
 *   braking     weight thrown forward over the tank; hard throttle presses the
 *               body back;
 *   bumps       the suspension's travel bobs the torso;
 *   speed       head down behind the screen at racing speed; slow, the body
 *               sits up and breathes.
 *
 * Signs follow the rig: +x on the torso leans FORWARD, +z rolls toward the
 * rider's right, +y on the neck turns the head left. `phys.lean` is + for a
 * right-hand bend.
 */
export function poseRideDynamics(joints, phys, time = 0, seed = 0) {
  if (!joints || !phys) return;
  const v = Math.max(0, phys.speed || 0);
  const lean = phys.lean || 0;
  const steer = phys.steer || 0;
  const aL = phys.longAccel || 0;
  const bump = (phys.suspFront || 0) + (phys.suspRear || 0);
  const T = joints.torso, N = joints.neck, H = joints.head;
  const fast = Math.min(1, v / 40);
  if (T && T.rotation) {
    T.rotation.z += lean * 0.42;                              // hang off into the bend
    T.rotation.y += -steer * 0.10 * (1 - fast * 0.5);         // shoulders open into the turn
    T.rotation.x += THREE.MathUtils.clamp(-aL * 0.018, -0.10, 0.16);   // brake: forward, throttle: back
    T.rotation.x += bump * 0.9;                               // compressions push the chest down
    if (v < 6) T.rotation.x += Math.sin(time * 2.1 + seed) * 0.015;    // breathing at a standstill
  }
  if (N && N.rotation) {
    N.rotation.z += -lean * 0.55;                             // eyes level through the lean
    N.rotation.y += -steer * 0.28 - lean * 0.18;              // look where you are going
    N.rotation.x += fast * 0.12;                              // head down behind the screen
  }
  if (H && H.rotation) {
    H.rotation.z += -lean * 0.15;
    H.rotation.x += Math.sin(time * 9.5 + seed * 3) * 0.006 * fast;   // buffeting at speed
  }
  // the torso moved: hands back onto the grips (poseCombat re-solves again if
  // it runs; a rider who is not fighting still needs his hands on the bars)
  if (joints.__ik && joints.__ikOn) solveLimbs(joints, null);
}

export function poseCombat(joints, f, phys, time, attacksTable) {
  if (!joints || !f) return;
  const speed = phys ? phys.speed : 0;
  const ik = joints.__ikOn && joints.__ik;
  const over = ik ? {} : null;
  let chainPh = -1;
  let strike = null, strikeU = 0;
  if (f.active) {
    const a = f.active, k = a.kind;
    const spec = attacksTable && attacksTable[k];
    // [chain agent] `a.dur` is the fighter's OWN attack length (combat.js: a
    // long / heavy chain swings slower), so the pose stretches with it
    const ph = Math.min(1, a.t / (a.dur || actionDuration(spec)));
    const S = STRIKES[k];
    if (k === 'grapple') {
      // reach out on the wind-up, snap the hand shut at the arc test
      const reach = smooth(a.t / Math.max(0.05, spec ? spec.wind : 0.16));
      poseReach(joints, armForSide(joints, phys, f.aimSide || 1), reach, 0, 1 - reach * 0.4, over);
    } else if (ik && S) {
      // THE LIMB ON THE TARGET'S SIDE. combat.js locks `active.side` (road
      // lateral, +1/-1) on the attack's first frame; turn it into the bike's
      // own x and take whichever arm / leg sits there.
      const sxWant = lateralToBikeX(ik, phys, a.side || f.aimSide || 1);
      const keys = S.limb === 'leg' ? ['leftLeg', 'rightLeg'] : ['left', 'right'];
      let limb = ik.sx[keys[0]] === sxWant ? keys[0] : keys[1];
      // THE CHAIN IS DRAWN WITH THE HAND ON THE TARGET'S SIDE. It is stowed
      // between swings, so at the start of a swing it comes out in whichever
      // fist faces the target -- a rider (or cop) on your left gets a forehand
      // from the left hand, not a weak backhand across the tank. Only once the
      // swing is under way does it stay in the hand that holds it (a backhand
      // at 0.6 reach, as before, if the target switches sides mid-swing).
      let cross = 1;
      if (k === 'chain' && joints.chain) {
        let holder = ['left', 'right'].find((kk) => ik.limbs[kk] && isAncestor(ik.limbs[kk].end, joints.chain));
        const want = ['left', 'right'].find((kk) => ik.limbs[kk] && ik.sx[kk] === sxWant);
        if (holder && want && holder !== want && ph < 0.12) {
          const to = ik.limbs[want].end;
          const pos = joints.chain.position.clone();
          pos.x = -pos.x;                                  // the same grip, mirrored
          to.add(joints.chain);
          joints.chain.position.copy(pos);
          if (joints.__chainSim) joints.__chainSim.ready = false;   // re-hang from the new fist
          holder = want;
        }
        if (holder) { limb = holder; cross = ik.sx[holder] === sxWant ? 1 : -0.6; }
      }
      // body layer first: it moves the shoulder the arm is solved from
      const sx = sxWant, env = bump(ph, S.body.peak);
      if (joints.torso) {
        joints.torso.rotation.y += sx * S.body.twist * env;
        joints.torso.rotation.z += -sx * S.body.lean * env;
      }
      if (joints.neck) joints.neck.rotation.y += sx * S.body.head * env;
      strike = { S, limb, cross }; strikeU = ph;
    } else if (STAND_STRIKES[k]) {
      // ON FOOT (no bike to solve against): keyframed aims, the limb on the
      // target's side. This used to fall through to a fallback that added +1.6
      // to the right upper arm -- and +x swings an arm BACKWARD on this rig, so
      // every standing punch, kick and chain threw the arm behind the body.
      poseStandStrike(joints, k, ph, armForSide(joints, phys, a.side || f.aimSide || 1));
    } else applyAction(joints, k, ph);
    if (k === 'chain') chainPh = ph;
  }
  if (f.hold) {
    // gripping and hauling: the arm stays out and yanks in time with the pull
    const t = f.hold.t;
    poseReach(joints, armForSide(joints, phys, f.hold.side), 1, Math.sin(t * 11) * 0.6, 0, over);
  } else if (f.heldBy) {
    // held: dragged sideways, the near arm fighting the grip, torso wrenched
    const side = -Math.sign((f.heldBy.owner.lateral - (phys ? phys.lateral : 0)) || 1);
    const near = armForSide(joints, phys, -side);
    if (joints.torso) joints.torso.rotation.z += -(near === 'left' ? 1 : -1) * 0.22;
    if (joints.torso) joints.torso.rotation.x -= 0.25;
    poseReach(joints, near, 0.7, Math.sin(time * 17) * 0.9, 0.3, over);
  } else if (f.holdEnd) {
    const e = f.holdEnd, u = e.t / 0.6;
    if (e.kind === 'throw') {
      // the shove: arm snaps straight out, then recovers to the bars
      const k = u < 0.2 ? smooth(u / 0.2) : 1 - smooth((u - 0.2) / 0.8);
      poseReach(joints, armForSide(joints, phys, e.side), k, 0, 1, over);
    } else if (e.kind === 'thrown') {
      if (joints.torso) joints.torso.rotation.x -= 0.5 * (1 - u);
      if (joints.torso) joints.torso.rotation.z += 0.35 * (1 - u) * (e.side >= 0 ? 1 : -1);
    }
  }
  if (ik) {
    // the strike target is read AFTER the body layer, from the moved shoulder
    if (strike) over[strike.limb] = strikeTarget(ik, strike.S, strike.limb, strikeU, new THREE.Vector3(), strike.cross);
    solveLimbs(joints, over);
  }
  if (joints.chain) {
    // CARRIED WRAPPED. It used to be stowed between swings (a loose chain
    // streaming at 40 m/s read as noise); now a rider who has it keeps it
    // coiled round the fist (chainweapon.js) with a short tail, so it is on
    // show the whole race -- the player sees they are armed -- and it only
    // leaves the fist to strike.
    const show = chainPh >= 0 || !!f.hasWeapon;
    joints.chain.visible = show;
    // [chain agent] simulated rope pinned to the fist; animateChain (the old
    // travelling-wave formula) is kept exported but no longer drives it
    if (show) driveChain(joints, f, chainPh, time);
  }
}

// ---------------------------------------------------------------------------
// ARM AIMING, for gestures (the showroom's emotes, the race starter's flag):
// point the upper arm along `dir` in the torso's frame (+x the body's left, +y
// up, +z forward) and bend the elbow toward `hint` by `flex` radians.
const _aX = new THREE.Vector3(), _aY = new THREE.Vector3(), _aZ = new THREE.Vector3(), _aB = new THREE.Matrix4();
export function armAim(j, side, dir, hint, flex, twist) {
  const A = j[side + 'Arm'] || (j.arms && j.arms[side]);
  if (!A || !A.upper) return;
  _aY.set(-dir[0], -dir[1], -dir[2]).normalize();          // the segment hangs down its local -Y
  _aZ.set(hint[0], hint[1], hint[2]);
  _aZ.addScaledVector(_aY, -_aZ.dot(_aY));
  if (_aZ.lengthSq() < 1e-6) _aZ.set(0, 0, 1).addScaledVector(_aY, -_aY.z);
  _aZ.normalize();
  _aX.crossVectors(_aY, _aZ);
  A.upper.quaternion.setFromRotationMatrix(_aB.makeBasis(_aX, _aY, _aZ));
  if (A.elbow) A.elbow.rotation.set(-flex, 0, 0);          // - flexes toward local +Z
  // TWIST the forearm about its own length: turns the palm without moving the
  // arm (a wave wants the palm to the front, not to the side)
  if (twist !== undefined && A.fore) A.fore.rotation.set(0, twist, 0);
}

/**
 * CONTRAPPOSTO: weight on one leg. The pelvis drops on the relaxed side, that
 * knee bends and the foot rests forward, the shoulders tilt the other way and
 * the head levels against them. Rated more attractive than a square stance in
 * perception studies of 3D figures (Archives of Sexual Behavior, 2019), and it
 * is the classic figure-drawing pose for the same reason. Layer it on after
 * poseStanding. `relaxed` is the side that does NOT carry the weight.
 */
export function contrapposto(j, amt = 1, relaxed = 'right') {
  if (!j || amt <= 0) return;
  const s = relaxed === 'right' ? 1 : -1;   // + tilts the rig's left (+x) hip UP
  const a = 0.085 * amt * s;
  if (j.pelvis) j.pelvis.rotation.z += a;
  for (const side of ['left', 'right']) {
    const L = j[side + 'Leg'] || (j.legs && j.legs[side]);
    if (!L) continue;
    if (L.hip) L.hip.rotation.z -= a;        // legs stay plumb under the tilt
    if (side === relaxed) {
      if (L.thigh) L.thigh.rotation.x -= 0.14 * amt;   // knee a little forward
      if (L.knee) L.knee.rotation.x += 0.32 * amt;     // and bent
      if (L.hip) L.hip.rotation.y += 0.12 * amt * (side === 'left' ? 1 : -1);   // toe turned out
    }
  }
  if (j.torso) j.torso.rotation.z -= a * 1.3;          // shoulders tilt the other way
  if (j.neck) j.neck.rotation.z += a * 0.7;            // head levels against them
}

/**
 * A CONFIDENT STANCE: chest up, shoulders back, chin lifted, arms a touch
 * behind the body line -- the opposite of a slouch. Layer after poseStanding
 * (and contrapposto).
 */
export function confident(j, amt = 1) {
  if (!j || amt <= 0) return;
  if (j.torso) j.torso.rotation.x -= 0.11 * amt;      // (+x leans forward)
  if (j.neck) j.neck.rotation.x -= 0.1 * amt;         // chin up
  for (const side of ['left', 'right']) {
    const A = j[side + 'Arm'] || (j.arms && j.arms[side]);
    if (A && A.upper) A.upper.rotation.x += 0.1 * amt;   // arms back with the shoulders
  }
}

// ---------------------------------------------------------------------------
// STANDING STRIKES -- keyframes of [u, upper-arm direction, bend hint, elbow
// flex] in the torso frame (+x the body's left, +y up, +z forward), `x` given
// for the LEFT arm and mirrored for the right. A kick drives the leg instead.
// The off arm holds a guard; the body turns the striking shoulder in.
const STAND_STRIKES = {
  punch: {
    keys: [
      [0.00, [0.25, -0.85, 0.35], [0, 1, 0.3], 1.9],   // guard: fist up by the chin
      [0.22, [0.38, -0.55, 0.45], [0, 1, 0.2], 2.3],   // load: elbow back, fist cocked
      [0.46, [0.08, 0.06, 1.0], [0, 1, 0], 0.08],      // contact: arm long, straight out front
      [0.62, [0.1, 0.02, 1.0], [0, 1, 0], 0.2],
      [1.00, [0.25, -0.85, 0.35], [0, 1, 0.3], 1.9],
    ],
    body: { twist: 0.45, lean: 0.12, peak: 0.46 },
  },
  chain: {
    keys: [
      [0.00, [0.3, -0.9, 0.2], [0, 0.3, 1], 0.5],
      [0.26, [0.3, 0.75, 0.05], [0, 0, 1], 0.6],       // lift over the shoulder
      [0.40, [0.25, 0.8, -0.45], [0, 0.2, -1], 0.9],   // wound back behind the head
      [0.53, [0.3, 0.12, 1.0], [0, 1, 0], 0.06],       // crack: whipped forward
      [0.72, [-0.3, -0.6, 0.65], [0, 1, 0], 0.35],     // follow-through, low and across
      [1.00, [0.3, -0.9, 0.2], [0, 0.3, 1], 0.5],
    ],
    body: { twist: 0.55, lean: 0.18, peak: 0.53 },
  },
  kick: { leg: true, body: { twist: 0.1, lean: -0.22, peak: 0.48 } },
};
const GUARD = [[0.25, -0.85, 0.35], [0, 1, 0.3], 1.9];
function sampleKeys(keys, u) {
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const [u0, d0, h0, f0] = keys[i], [u1, d1, h1, f1] = keys[i + 1];
  const e = smooth((u - u0) / Math.max(1e-4, u1 - u0));
  const L3 = (a, b) => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
  return [L3(d0, d1), L3(h0, h1), f0 + (f1 - f0) * e];
}
const mir = (v, s) => [v[0] * s, v[1], v[2]];
export function poseStandStrike(j, kind, u, side = 'right') {
  const S = STAND_STRIKES[kind];
  if (!S || !j) return false;
  const s = side === 'left' ? 1 : -1, other = side === 'left' ? 'right' : 'left';
  const env = bump(u, S.body.peak);
  // turn the striking shoulder toward the target (in front)
  if (j.torso) {
    j.torso.rotation.y += -s * S.body.twist * env;
    j.torso.rotation.x += S.body.lean * env;
  }
  if (j.neck) j.neck.rotation.y += s * S.body.twist * 0.6 * env;   // eyes stay on the target
  // the off hand keeps its guard
  armAim(j, other, mir(GUARD[0], -s), mir(GUARD[1], -s), GUARD[2]);
  if (S.leg) {
    // front kick on the target's side: chamber (knee up), snap out, recoil
    armAim(j, side, mir(GUARD[0], s), mir(GUARD[1], s), GUARD[2]);
    const L = j[side + 'Leg'] || (j.legs && j.legs[side]);
    if (L) {
      const chamber = u < 0.26 ? smooth(u / 0.26) : u < 0.62 ? 1 : 1 - smooth((u - 0.62) / 0.38);
      const snap = u < 0.3 ? 0 : u < 0.48 ? smooth((u - 0.3) / 0.18) : u < 0.62 ? 1 : 1 - smooth((u - 0.62) / 0.2);
      if (L.thigh) L.thigh.rotation.x = -1.45 * chamber;              // thigh up in front
      if (L.knee) L.knee.rotation.x = 2.0 * chamber * (1 - snap) + 0.08 * snap;   // folded, then straight
    }
    return true;
  }
  const [d, h, fl] = sampleKeys(S.keys, u);
  armAim(j, side, mir(d, s), mir(h, s), fl);
  return true;
}
