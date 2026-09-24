// RideRash — analytic two-bone IK with a pole vector, for the rider's limbs.
//
// WHY THIS EXISTS. Two defects the player could see came from posing limbs by
// writing Euler angles joint-by-joint:
//
//   1. LEGS BACKWARDS. The seat solve (riderpose.solveSeat) searched hip/knee
//      angles inside hip [0.9, 2.1], knee [-2.8, -1.2]. In this rig +x on the hip
//      swings the thigh toward -Z, i.e. BACKWARDS (the rider faces +Z), so every
//      answer in that box was the mirror-image IK branch: thigh pointing at the
//      tail, knee behind the hip, shin coming FORWARD to the peg. MEASURED on the
//      1.75 m body: hip +1.48 put the knee 0.33 m BEHIND the hip. Both branches
//      put the boot on the peg -- which is why the residual looked fine -- and
//      only the pole (which side the knee bulges to) tells them apart. A
//      coordinate descent has no notion of a pole; this solver does.
//
//   2. WAVY HANDS. Punch/kick/chain were MDM clips baked as per-axis Euler deltas
//      (x and z on the shoulder AND on the elbow), lerped independently between
//      12 keys. The elbow is a hinge, so a z delta on it bends the forearm
//      sideways, and the MDM keys oscillate (right elbow x on the punch:
//      -0.07 -0.28 -0.85 -1.59 -1.53 -0.73 -0.41 -0.86 -0.87 -0.22 ...) -- the
//      hand wobbled twice per jab and wandered 0.4 m off the line of the blow.
//
// THE TECHNIQUE (the standard one: e.g. Unity's TwoBoneIKConstraint, UE's
// TwoBoneIK node, Blender's IK with a pole target):
//
//   * Put the HAND (or foot) on a target point. The distance d from the root
//     joint to the target and the two bone lengths fix the interior angles by the
//     law of cosines; nothing else is free except the rotation of the whole limb
//     about the root->target line.
//   * That last freedom is fixed by a POLE point: the mid joint (elbow / knee)
//     is placed in the plane of (root, target, pole), on the pole's side.
//   * The root gets a full orientation built from two vectors (bone direction +
//     hinge normal), and the mid joint gets a SINGLE rotation about its local X
//     -- a true hinge. It can never bend sideways or backwards, because there is
//     no other axis to put an angle on.
//
// Animation then moves TARGETS along smooth curves (motions.js) instead of
// interpolating joint angles, so the hand travels a clean path and the elbow
// follows from geometry. There is nothing left to wobble.
//
// Frame conventions this assumes (assets/rider.js): every limb segment hangs
// along its parent joint's -Y; the hinge is the joint's local X. The ARM flexes
// toward local +Z (negative elbow angle), the KNEE toward local -Z (positive).
import * as THREE from 'three';

const _a = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
const _dir = new THREE.Vector3(), _pd = new THREE.Vector3(), _b = new THREE.Vector3();
const _d1 = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3();
const _u1 = new THREE.Vector3(), _x0 = new THREE.Vector3(), _z0 = new THREE.Vector3();
const _z1 = new THREE.Vector3(), _e = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _pq = new THREE.Quaternion();
const _q = new THREE.Quaternion(), _ps = new THREE.Vector3(), _pp = new THREE.Vector3();
const _mid = new THREE.Matrix4();

/**
 * Describe a limb once. `root` is the joint the whole limb swings from (the
 * upper arm, or the leg's `hip`), `inter` an optional joint between root and mid
 * that the solver holds at identity (the leg's `thigh`), `mid` the hinge
 * (elbow / knee), `end` the node carrying the effector and `endLocal` the
 * effector point in `end`'s frame (the centre of the fist, the ball of the boot).
 * `flex` is +1 for a knee (bends toward local -Z) and -1 for an elbow.
 */
export function makeLimb(root, inter, mid, end, endLocal, flex) {
  if (!root || !mid || !end) return null;
  return { root, inter: inter || null, mid, end, endLocal: endLocal.clone(), flex };
}

/**
 * Solve one limb so its effector lands on world point `target`, with the mid
 * joint bulging toward world point `pole`. Writes root.quaternion,
 * inter.quaternion (identity) and mid.quaternion (pure hinge about X).
 *
 * Returns the residual (metres, world) between the effector and the target:
 * 0 when reachable, the shortfall when the target is out of reach (the limb is
 * then straight and pointed at it, which is the right failure).
 */
export function solveLimb(L, target, pole) {
  if (!L) return 0;
  const { root, inter, mid, end, endLocal, flex } = L;
  if (inter) inter.quaternion.identity();
  // bone 1, in ROOT-local space: root -> (inter) -> mid
  _u1.copy(mid.position);
  if (inter) { inter.updateMatrix(); _u1.applyMatrix4(inter.matrix); }
  // bone 2, in MID-local space: mid -> ... -> effector (end is a descendant)
  _e.copy(endLocal);
  for (let n = end; n && n !== mid; n = n.parent) { n.updateMatrix(); _e.applyMatrix4(n.matrix); }

  // world frame of the root's parent; lengths are measured in WORLD units so a
  // scaled rider (stature) solves with no special case
  root.parent.updateWorldMatrix(true, false);
  root.parent.matrixWorld.decompose(_pp, _pq, _ps);
  const sc = _ps.x;
  _a.copy(root.position).applyMatrix4(root.parent.matrixWorld);
  const L1 = _u1.length() * sc, L2 = _e.length() * sc;
  _t.copy(target);
  _dir.subVectors(_t, _a);
  let d = _dir.length();
  if (d < 1e-6) { _dir.set(0, -1, 0); d = 1e-6; } else _dir.multiplyScalar(1 / d);
  const reach = L1 + L2;
  const dc = Math.max(Math.abs(L1 - L2) + 1e-4, Math.min(reach * 0.9995, d));

  // pole direction: the pole's offset from the root, with the along-limb part removed
  _pd.subVectors(pole, _a);
  _pd.addScaledVector(_dir, -_pd.dot(_dir));
  if (_pd.lengthSq() < 1e-10) {
    _pd.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
    if (_pd.lengthSq() < 1e-10) _pd.set(1, 0, 0).addScaledVector(_dir, -_dir.x);
  }
  _pd.normalize();

  // law of cosines: the angle at the root between the root->target line and bone 1
  const cosA = THREE.MathUtils.clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  // desired mid joint (world)
  _b.copy(_a).addScaledVector(_dir, L1 * cosA).addScaledVector(_pd, L1 * sinA);
  _d1.subVectors(_b, _a).normalize();

  // the side the distal bone swings toward, perpendicular to bone 1
  _w.copy(_dir).addScaledVector(_d1, -_dir.dot(_d1));
  if (_w.lengthSq() < 1e-10) _w.copy(_pd).negate();
  _w.normalize();
  // local +Z (the arm's flex side / the knee's extensor side) in world
  _z1.copy(_w).multiplyScalar(flex < 0 ? 1 : -1);
  // hinge axis n = z1 x d1 so that (d1, n, z1) mirrors the rest (u1, x0, z0)
  _n.crossVectors(_z1, _d1).normalize();

  // rest basis in root-local space: u1 along the bone, x0 = local X made
  // perpendicular to it, z0 completing it the same way
  const u1n = _tmp.copy(_u1).normalize();
  _x0.set(1, 0, 0).addScaledVector(u1n, -u1n.x).normalize();
  _z0.crossVectors(u1n, _x0);
  _m0.makeBasis(u1n, _x0, _z0);
  // match handedness: z1 must equal d1 x n for the same construction
  _z1.crossVectors(_d1, _n);
  _m1.makeBasis(_d1, _n, _z1);
  // world rotation R with R * m0 = m1  ->  R = m1 * m0^T
  _m0.transpose();
  _m1.multiply(_m0);
  _q.setFromRotationMatrix(_m1);
  // local = parentWorld^-1 * world
  root.quaternion.copy(_pq).invert().multiply(_q);

  // the hinge: bend angle between bone 1 and bone 2, signed by flex, minus the
  // effector's own rest angle about X in the mid frame (the fist sits 1 cm
  // forward of the forearm line, the ball of the boot ahead of the shin)
  const cosB = THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - dc * dc) / (2 * L1 * L2), -1, 1);
  const bend = Math.PI - Math.acos(cosB);
  // rest angle of the effector about X, measured the way the bone is: from the
  // mid joint's own bone axis (u1 direction continued) toward local -Z
  const u1Ang = Math.atan2(-u1n.z, -u1n.y);
  const e0 = Math.atan2(-_e.z, -_e.y) - u1Ang;
  // arm flexes toward +Z = negative angle; knee toward -Z = positive angle
  const theta = (flex < 0 ? -bend : bend) - e0;
  mid.quaternion.setFromAxisAngle(_x0.set(1, 0, 0), theta);
  return Math.max(0, d - reach * 0.9995);
}

/** World position of a limb's effector right now (for measuring residuals). */
export function effectorWorld(L, out = new THREE.Vector3()) {
  L.end.updateWorldMatrix(true, false);
  return out.copy(L.endLocal).applyMatrix4(L.end.matrixWorld);
}

/** World position of a limb's root joint right now. */
export function rootWorld(L, out = new THREE.Vector3()) {
  L.root.parent.updateWorldMatrix(true, false);
  return out.copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
}
