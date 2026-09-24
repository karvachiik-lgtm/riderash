// RideRash — the thrown rider: a Verlet ragdoll with pose springs.
//
// WHAT THIS IS. The body that leaves the bike in a crash. Fifteen point masses
// (pelvis, chest, head, shoulders, elbows, hands, hips, knees, feet) joined by
// distance constraints, integrated with Verlet, colliding with the road one
// particle at a time -- and then used to DRIVE the rider's existing joint rig,
// so the same meshes that ride the bike are the ones that tumble.
//
// WHY THIS AND NOT THE OTHER TWO. Games solve "a person is thrown" three ways:
//
//   1. A canned fall clip. Reads consistently, ignores the crash direction, and
//      is identical every time -- which the eye learns in three crashes.
//   2. A pure ragdoll (jointed rigid bodies + a solver). Reacts to anything, but
//      an unsupervised ragdoll has no muscle tone: it lands like dropped laundry
//      in poses no conscious human takes.
//   3. An ACTIVE ragdoll: simulated body, plus springs pulling the limbs toward
//      a target pose. GTA's Euphoria is the famous version. The body obeys its
//      momentum and the ground, but tucks, braces and protects its head while it
//      does. That is the only one of the three that reads as a PERSON.
//
// This is (3) at the cheapest scale that still works. No rigid bodies and no
// solver: Verlet carries momentum implicitly in `pos - prev`, a constraint is
// "move the two ends back to their rest distance", and a pose spring is a small
// nudge toward where the limb would be in the protective pose, expressed in the
// torso's own frame so it never drags the body across the road. The tension
// DECAYS over the tumble -- tense on impact, limp as it slides -- which is the
// whole difference between "a man crashed" and "a mesh fell over".
//
// PER-PARTICLE GROUND CONTACT is what makes the tumble look right: one shoulder
// catches, friction holds it, the rest of the body keeps going and pivots about
// it. A single rigid body cannot do that.
import * as THREE from 'three';
import { centreAt, headAt } from './level.js';
import { CFG } from './config.js';

// ---------------------------------------------------------------------------
// Tunables. Metres, seconds, and the one fixed substep the whole thing runs at.
// ---------------------------------------------------------------------------
export const RAG = {
  H: 1 / 120,             // fixed substep: Verlet is only as stable as its dt is steady
  MAX_STEPS: 8,
  ITER: 4,                // constraint relaxation passes. More is stiffer AND deader.
  GRAVITY: 13.5,          // a touch over 9.81: at game scale real g reads floaty
  AIR_KEEP: 0.9995,       // per-substep velocity kept in the air (drag, barely)
  RESTITUTION: 0.22,      // vertical bounce kept on a hard contact
  BOUNCE_MIN: 1.2,        // m/s: slower impacts do not bounce at all
  SKIN: 0.015,            // m: within this of the road counts as touching
  // Tarmac friction. Leathers on asphalt are ~0.6-0.8; tumbling (limbs digging
  // in, the body rolling over its shoulders) loses a lot more than a clean
  // slide, and a game needs the body to stop inside ~3 s. MEASURED with the
  // contact skin: a 31 m/s wreck comes to rest ~30 m on in ~2.5 s.
  MU: 1.6,
  POSE_GAIN: 5.0,         // 1/s pull toward the protective pose at impact...
  POSE_DECAY: 1.1,        // ...decaying with this time constant (s): tense -> limp
  POSE_FLOOR: 0.35,       // ...to this fraction, so a resting body is not string
  REST_SPEED: 0.45,       // m/s: every particle slower than this = at rest
};

// Particle names, in a fixed order so the index is stable.
const P = ['pelvis', 'chest', 'head', 'lSh', 'rSh', 'lEl', 'rEl', 'lHa', 'rHa',
           'lHip', 'rHip', 'lKn', 'rKn', 'lFt', 'rFt'];
const I = Object.fromEntries(P.map((n, i) => [n, i]));

// Contact radius (m) and inverse mass. The core is heavier than a hand, which is
// what makes a limb whip around the torso rather than the torso around a limb.
const RADIUS = { pelvis: 0.13, chest: 0.15, head: 0.13, lSh: 0.08, rSh: 0.08,
  lEl: 0.06, rEl: 0.06, lHa: 0.05, rHa: 0.05, lHip: 0.09, rHip: 0.09,
  lKn: 0.07, rKn: 0.07, lFt: 0.06, rFt: 0.06 };
const INV_MASS = { pelvis: 0.35, chest: 0.4, head: 0.9, lSh: 0.7, rSh: 0.7,
  lEl: 1, rEl: 1, lHa: 1.3, rHa: 1.3, lHip: 0.6, rHip: 0.6,
  lKn: 0.9, rKn: 0.9, lFt: 1.1, rFt: 1.1 };

// [a, b, stiffness]. The torso is a braced box (both diagonals) so it cannot
// shear flat; the neck is braced to both shoulders so the head does not dangle;
// pelvis-head is soft, which is the spine's one allowed bend.
const LINKS = [
  ['pelvis', 'chest', 1], ['lSh', 'rSh', 1], ['lHip', 'rHip', 1],
  ['lSh', 'chest', 1], ['rSh', 'chest', 1], ['lHip', 'pelvis', 1], ['rHip', 'pelvis', 1],
  ['lSh', 'lHip', 1], ['rSh', 'rHip', 1], ['lSh', 'rHip', 0.8], ['rSh', 'lHip', 0.8],
  ['chest', 'head', 1], ['lSh', 'head', 0.6], ['rSh', 'head', 0.6], ['pelvis', 'head', 0.25],
  ['lSh', 'lEl', 1], ['lEl', 'lHa', 1], ['rSh', 'rEl', 1], ['rEl', 'rHa', 1],
  ['lHip', 'lKn', 1], ['lKn', 'lFt', 1], ['rHip', 'rKn', 1], ['rKn', 'rFt', 1],
];
// Joint range, cheaply: a MINIMUM distance across the elbow and knee, so a limb
// cannot fold through itself. [a, b, fraction of the straight-limb length].
const MINS = [['lSh', 'lHa', 0.35], ['rSh', 'rHa', 0.35], ['lHip', 'lFt', 0.42], ['rHip', 'rFt', 0.42]];

// Which particles the pose springs act on (the core is held by the braces).
const POSED = ['head', 'lEl', 'rEl', 'lHa', 'rHa', 'lKn', 'rKn', 'lFt', 'rFt'];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _d = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();

// Road height and frame at a world point. The road is a function of z (see
// level.js centreAt); its cross-section is flat, so height does not depend on x.
function groundAt(x, z) { return centreAt(z, _t).y; }

/** Every node a ragdoll writes, per rig. Order = parents before children. */
function drivenNodes(j) {
  const out = [j.pelvis, j.torso, j.neck, j.head];
  for (const side of ['left', 'right']) {
    const A = j[side + 'Arm'] || (j.arms && j.arms[side]);
    if (A) out.push(A.shoulder, A.upper, A.elbow, A.fore);
    const L = j[side + 'Leg'] || (j.legs && j.legs[side]);
    if (L) out.push(L.hip, L.thigh, L.knee, L.shin);
  }
  return out.filter((n) => n && n.isObject3D);
}

/**
 * Snapshot the rig's local transforms at the moment of the crash, and restore
 * them on the way out. The pose code writes only some axes of some joints (see
 * riderpose.clearAxes); a ragdoll writes full orientations to all of them, so
 * without a restore the pelvis, head, shoulders and shins would keep their last
 * crash orientation forever -- the rider would ride away folded.
 *
 * Taken FRESH at every crash (`refresh`), from the pose the rider was riding
 * in: that is exactly the state the riding pose code expects to find again, and
 * it is also what the particles were measured from, so the joints the ragdoll
 * does not aim (shoulder, forearm, thigh, shin, head) agree with them.
 */
export function ensureRest(rider, refresh = false) {
  const j = rider && rider.userData && rider.userData.joints;
  if (!j) return null;
  if (refresh || !rider.userData.__ragRest) {
    rider.userData.__ragRest = drivenNodes(j).map((n) => ({
      n, p: n.position.clone(), q: n.quaternion.clone() }));
  }
  return rider.userData.__ragRest;
}

export function restoreRest(rider) {
  const rest = rider && rider.userData && rider.userData.__ragRest;
  if (!rest) return;
  for (const r of rest) { r.n.position.copy(r.p); r.n.quaternion.copy(r.q); }
}

/** Current local transforms of every driven node: the start of a get-up blend. */
export function captureLocal(rider) {
  const j = rider && rider.userData && rider.userData.joints;
  if (!j) return null;
  return drivenNodes(j).map((n) => ({ n, p: n.position.clone(), q: n.quaternion.clone() }));
}

/**
 * Blend the rig from a captured pose toward whatever pose is on it now, by k.
 * k = 0 is the capture, k = 1 leaves the current pose untouched. This is the
 * "ragdoll to animation" hand-off every engine does on a get-up.
 */
export function blendFrom(saved, k) {
  if (!saved || k >= 1) return;
  for (const r of saved) {
    r.n.quaternion.slerpQuaternions(r.q, _q.copy(r.n.quaternion), k);
    r.n.position.lerpVectors(r.p, _a.copy(r.n.position), k);
  }
}

// Build an orthonormal frame from a right-ish vector and an up vector.
function frameQuat(right, up, out) {
  _up.copy(up).normalize();
  _right.copy(right).addScaledVector(_up, -right.dot(_up)).normalize();
  _fwd.crossVectors(_right, _up);
  _m.makeBasis(_right, _up, _fwd);
  return out.setFromRotationMatrix(_m);
}

export class Ragdoll {
  /**
   * Build from the rider AS IT IS NOW. The rider must already be a child of the
   * scene (world-space); see Dismount._detach. The particles are measured off
   * the posed rig, so the body starts exactly where the rider was sitting.
   */
  constructor(rider) {
    this.rider = rider;
    this.ok = false;
    const j = rider && rider.userData && rider.userData.joints;
    const S = (rider && rider.userData && rider.userData.spec) || {};
    if (!j || !j.pelvis || !j.torso || !j.neck) return;
    ensureRest(rider, true);
    this.j = j;
    const A = { left: j.leftArm || (j.arms && j.arms.left), right: j.rightArm || (j.arms && j.arms.right) };
    const L = { left: j.leftLeg || (j.legs && j.legs.left), right: j.rightLeg || (j.legs && j.legs.right) };
    if (!A.left || !A.right || !L.left || !L.right) return;
    this.A = A; this.L = L;

    rider.updateMatrixWorld(true);
    const wp = (n, x = 0, y = 0, z = 0) => n.localToWorld(new THREE.Vector3(x, y, z));
    const forearm = S.forearm || 0.26, shin = S.shin || 0.43, headH = S.headH || 0.24;
    const at = {
      pelvis: wp(j.pelvis), chest: wp(j.neck), head: wp(j.head, 0, headH * 0.5, 0),
      lSh: wp(A.left.upper), rSh: wp(A.right.upper),
      lEl: wp(A.left.elbow), rEl: wp(A.right.elbow),
      lHa: wp(A.left.fore, 0, -forearm, 0), rHa: wp(A.right.fore, 0, -forearm, 0),
      lHip: wp(L.left.thigh), rHip: wp(L.right.thigh),
      lKn: wp(L.left.knee), rKn: wp(L.right.knee),
      lFt: wp(L.left.shin, 0, -shin, 0), rFt: wp(L.right.shin, 0, -shin, 0),
    };
    this.pos = P.map((n) => at[n].clone());
    this.prev = P.map((n) => at[n].clone());
    this.r = P.map((n) => RADIUS[n] * rider.scale.y);
    this.w = P.map((n) => INV_MASS[n]);
    this.links = LINKS.map(([a, b, k]) => ({ a: I[a], b: I[b], k, rest: at[a].distanceTo(at[b]) }));
    this.mins = MINS.map(([a, b, f]) => {
      const mid = a[0] + (a.endsWith('Sh') ? 'El' : 'Kn');
      const full = at[a].distanceTo(at[mid]) + at[mid].distanceTo(at[b]);
      return { a: I[a], b: I[b], min: full * f };
    });

    // ---- the protective pose, in the torso's own frame -------------------
    // Captured from the riding crouch (already knees-up, arms-forward -- a
    // decent tuck), then the hands are pulled in to guard the head and the
    // elbows tucked. Stored as offsets in the torso frame so the springs only
    // shape the body, they never drag it across the road.
    const R = this._torsoFrame(_q);
    const inv = _q2.copy(R).invert();
    const off = (i) => this.pos[i].clone().sub(this.pos[I.pelvis]).applyQuaternion(inv);
    this.target = P.map((_, i) => off(i));
    const head = this.target[I.head];
    for (const [ha, el, s] of [['lHa', 'lEl', 1], ['rHa', 'rEl', -1]]) {
      // local frame: x = right (rSh - lSh), y = up, z = forward
      this.target[I[ha]].set(head.x - s * 0.16 * rider.scale.y, head.y - 0.10, head.z + 0.18);
      const sh = this.target[I[ha[0] + 'Sh']];
      this.target[I[el]].copy(sh).lerp(this.target[I[ha]], 0.5).add(_a.set(-s * 0.06, -0.12, 0.14));
    }

    // ---- the bone map: which particle each joint aims at -----------------
    // childLocal is the aimed particle expressed in the node's own frame at
    // capture, so "aim" means "rotate the node until that point lands on it".
    const aim = (node, pi) => ({ node, pi, local: node.worldToLocal(this.pos[pi].clone()) });
    this.aims = [
      aim(j.neck, I.head),
      aim(A.left.upper, I.lEl), aim(A.left.elbow, I.lHa),
      aim(A.right.upper, I.rEl), aim(A.right.elbow, I.rHa),
      aim(L.left.hip, I.lKn), aim(L.left.knee, I.lFt),
      aim(L.right.hip, I.rKn), aim(L.right.knee, I.rFt),
    ];
    // Pelvis and torso take a FULL frame (they have width, not just a direction).
    const pq = new THREE.Quaternion(), tq = new THREE.Quaternion();
    j.pelvis.matrixWorld.decompose(_s, pq, _c);
    j.torso.matrixWorld.decompose(_s, tq, _c);
    this.pelvisOff = frameQuat(_a.subVectors(at.rHip, at.lHip), _b.subVectors(at.chest, at.pelvis), new THREE.Quaternion()).invert().multiply(pq);
    this.torsoOff = frameQuat(_a.subVectors(at.rSh, at.lSh), _b.subVectors(at.chest, at.pelvis), new THREE.Quaternion()).invert().multiply(tq);

    this.age = 0;
    this._acc = 0;
    this.contact = 0;         // fraction of particles on the ground, last step
    this.maxSpeed = 0;        // fastest particle, m/s, last step
    this.ok = true;
  }

  // The torso's frame: x = shoulder line, y = spine. Same formula at capture and
  // at runtime, so its handedness cannot disagree with itself.
  _torsoFrame(out) {
    const p = this.pos;
    _c.subVectors(p[I.rSh], p[I.lSh]).add(_d.subVectors(p[I.rHip], p[I.lHip]));
    _b.subVectors(p[I.chest], p[I.pelvis]);
    return frameQuat(_c, _b, out);
  }

  /**
   * THE LAUNCH. `vel` is the body's linear velocity (m/s, world), `spin` its
   * angular velocity (rad/s, world) about the centre of mass. A body that
   * translates without spinning looks weightless, so every throw has both.
   */
  launch(vel, spin) {
    if (!this.ok) return this;
    const com = this.centre(new THREE.Vector3());
    for (let i = 0; i < this.pos.length; i++) {
      _a.subVectors(this.pos[i], com);
      _b.crossVectors(spin, _a).add(vel).multiplyScalar(RAG.H);
      this.prev[i].copy(this.pos[i]).sub(_b);
    }
    return this;
  }

  /** Mass-weighted centre. */
  centre(out) {
    out.set(0, 0, 0);
    let m = 0;
    for (let i = 0; i < this.pos.length; i++) { const k = 1 / this.w[i]; out.addScaledVector(this.pos[i], k); m += k; }
    return out.multiplyScalar(1 / m);
  }

  /** Velocity of the centre, m/s. */
  velocity(out) {
    out.set(0, 0, 0);
    let m = 0;
    for (let i = 0; i < this.pos.length; i++) {
      const k = 1 / this.w[i];
      out.addScaledVector(_a.subVectors(this.pos[i], this.prev[i]), k); m += k;
    }
    return out.multiplyScalar(1 / (m * RAG.H));
  }

  get pelvis() { return this.pos[I.pelvis]; }
  get chest() { return this.pos[I.chest]; }
  get head() { return this.pos[I.head]; }

  /** True once every particle has (nearly) stopped. */
  get atRest() {
    return this.ok && this.age > 0.6 && this.maxSpeed < RAG.REST_SPEED * 3
      && this.velocity(_d).length() < RAG.REST_SPEED;
  }

  /** Current pose-spring gain: tense on impact, limp as it slides. */
  get tension() {
    return RAG.POSE_FLOOR + (1 - RAG.POSE_FLOOR) * Math.exp(-this.age / RAG.POSE_DECAY);
  }

  step(dt) {
    if (!this.ok) return;
    this._acc += Math.min(0.1, Math.max(0, dt));
    let n = 0;
    while (this._acc >= RAG.H && n < RAG.MAX_STEPS) { this._sub(RAG.H); this._acc -= RAG.H; n++; }
    if (n >= RAG.MAX_STEPS) this._acc = 0;
  }

  _sub(h) {
    this.age += h;
    const pos = this.pos, prev = this.prev, N = pos.length;

    // ---- integrate: x' = x + (x - x_prev)*keep + g*h^2 ---------------------
    for (let i = 0; i < N; i++) {
      _a.subVectors(pos[i], prev[i]).multiplyScalar(RAG.AIR_KEEP);
      prev[i].copy(pos[i]);
      pos[i].add(_a);
      pos[i].y -= RAG.GRAVITY * h * h;
    }

    // ---- pose springs, in the torso frame ----------------------------------
    // MOMENTUM-NEUTRAL. A spring is an INTERNAL force: it may reshape the body
    // but must not move its centre of mass. Nudging only the limbs does move it
    // -- MEASURED: the thrown body kept its launch vy of 5.4 m/s for 0.2 s
    // against gravity and rose to 3.5 m instead of ~2 m, because the tuck was
    // pulling the whole body up. So the mass-weighted mean of the nudges is
    // taken back off every particle, which is exactly Newton's third law.
    const gain = Math.min(1, RAG.POSE_GAIN * this.tension * h);
    if (gain > 0) {
      this._torsoFrame(_q);
      const root = pos[I.pelvis];
      _c.set(0, 0, 0);
      let mSum = 0;
      for (let i = 0; i < N; i++) mSum += 1 / this.w[i];
      for (const name of POSED) {
        const i = I[name];
        _a.copy(this.target[i]).applyQuaternion(_q).add(root).sub(pos[i]).multiplyScalar(gain);
        pos[i].add(_a);
        _c.addScaledVector(_a, 1 / this.w[i]);
      }
      _c.multiplyScalar(1 / mSum);
      for (let i = 0; i < N; i++) pos[i].sub(_c);
    }

    // ---- constraints ---------------------------------------------------------
    for (let it = 0; it < RAG.ITER; it++) {
      for (const c of this.links) this._solve(c.a, c.b, c.rest, c.k, false);
      for (const c of this.mins) this._solve(c.a, c.b, c.min, 1, true);
    }

    // ---- the ground, the rail, and friction, one particle at a time --------
    const rail = CFG.ROAD_W / 2 + CFG.KERB_W + 0.9;
    // Coulomb: a fixed decel per step. The body's WEIGHT rests on whichever
    // particles are touching, so the normal force (and the friction) on each of
    // them is the body's share divided among them: with 40% of the particles
    // down, each carries 2.5x. Using last step's count keeps it one pass.
    const share = 1 / Math.max(0.2, this.contact || 1);
    const scrub = RAG.MU * RAG.GRAVITY * h * h * share;
    let touching = 0, vmax = 0;
    for (let i = 0; i < N; i++) {
      const p = pos[i], q = prev[i];
      const g = groundAt(p.x, p.z) + this.r[i];
      _b.subVectors(p, q);                          // per-step velocity
      // A CONTACT SKIN. Resting particles sit a hair above the road after the
      // constraint pass lifts them, so a strict `p.y < g` test saw contact on
      // only 7-30% of steps and friction almost never acted: MEASURED, a body
      // slid 80 m at a near-constant 21 m/s. Anything within the skin is
      // touching, and friction applies to it.
      if (p.y < g + RAG.SKIN) {
        if (p.y < g) p.y = g;
        touching++;
        // bounce: reflect a fraction of a real impact; kill the micro-bounce
        // that would otherwise lift a resting particle off the road every step
        if (_b.y < 0) _b.y = (-_b.y / h > RAG.BOUNCE_MIN) ? -_b.y * RAG.RESTITUTION : 0;
        // scrub: remove a fixed amount of horizontal speed, never reverse it
        const hs = Math.hypot(_b.x, _b.z);
        if (hs > 1e-9) {
          const k = Math.max(0, hs - scrub) / hs;
          _b.x *= k; _b.z *= k;
        }
        q.copy(p).sub(_b);
      }
      // The guard rail. A body flung into the scrub is a body the player walks
      // thirty metres to fetch; the rail stops it the way a rail would.
      headAt(p.z, _d);
      centreAt(p.z, _c);
      const nx = -_d.z, nz = _d.x;
      const lat = (p.x - _c.x) * nx + (p.z - _c.z) * nz;
      if (Math.abs(lat) > rail) {
        const push = (Math.abs(lat) - rail) * Math.sign(lat);
        p.x -= nx * push; p.z -= nz * push;
        _b.subVectors(p, q);
        const vn = _b.x * nx + _b.z * nz;
        if (vn * Math.sign(lat) > 0) { _b.x -= nx * vn * 1.3; _b.z -= nz * vn * 1.3; }
        q.copy(p).sub(_b);
      }
      const v = _b.length() / h;
      if (v > vmax) vmax = v;
      if (!Number.isFinite(p.x + p.y + p.z)) { p.copy(q); }   // §5.6: never emit NaN
    }
    this.contact = touching / N;
    this.maxSpeed = vmax;
  }

  _solve(a, b, rest, k, minOnly) {
    const pa = this.pos[a], pb = this.pos[b];
    _d.subVectors(pb, pa);
    const len = _d.length();
    if (len < 1e-6) return;
    if (minOnly && len >= rest) return;
    const wa = this.w[a], wb = this.w[b], ws = wa + wb;
    const diff = ((len - rest) / len) * k;
    pa.addScaledVector(_d, diff * (wa / ws));
    pb.addScaledVector(_d, -diff * (wb / ws));
  }

  /**
   * DRIVE THE RIG FROM THE PARTICLES. Pelvis and torso take a full frame; every
   * other joint is rotated (shortest arc) until its child point lands on its
   * particle. Parents first, so each child is aimed from where its parent now is.
   */
  apply() {
    if (!this.ok) return;
    const j = this.j;
    restoreRest(this.rider);
    this.rider.updateMatrixWorld(true);

    // pelvis: position AND orientation
    frameQuat(_a.subVectors(this.pos[I.rHip], this.pos[I.lHip]),
              _b.subVectors(this.pos[I.chest], this.pos[I.pelvis]), _q).multiply(this.pelvisOff);
    this._setWorld(j.pelvis, _q, this.pos[I.pelvis]);
    // torso: orientation only (its position is the pelvis's child offset)
    j.torso.updateMatrixWorld(true);
    this._torsoFrame(_q).multiply(this.torsoOff);
    this._setWorld(j.torso, _q, null);
    for (const a of this.aims) this._aim(a);
  }

  _setWorld(node, worldQ, worldPos) {
    const parent = node.parent;
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld.decompose(_s, _q2, _c);
    node.quaternion.copy(_q2.invert().multiply(worldQ));
    if (worldPos) node.position.copy(parent.worldToLocal(_a.copy(worldPos)));
    node.updateMatrixWorld(true);
  }

  _aim(a) {
    const n = a.node;
    n.updateWorldMatrix(true, false);
    n.matrixWorld.decompose(_s, _q3, _c);      // _s = node world pos, _q3 = world quat
    _a.copy(a.local).applyMatrix4(n.matrixWorld).sub(_s);   // where the child is now
    _b.copy(this.pos[a.pi]).sub(_s);                          // where it should be
    if (_a.lengthSq() < 1e-8 || _b.lengthSq() < 1e-8) return;
    _q.setFromUnitVectors(_a.normalize(), _b.normalize());
    this._setWorld(n, _q.multiply(_q3), null);
  }
}
