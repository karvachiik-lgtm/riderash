// RideRash — THE ARREST: the cop pulls over, gets off, walks up and cuffs you.
//
// A bust used to cut straight to the results card the frame it happened. Road
// Rash showed you the arrest; so does this. A short scripted scene run on the
// real rigs, in the real world:
//
//   STOP     he brakes and pulls up alongside whoever went down
//   OFF      he steps off; the bike stays on its stand with the lights going
//   WALK     he walks over (the on-foot gait every rider uses: dismount.js)
//   CUFF     he crouches over them, a knee down, and cuffs their wrists
//   HOLD     a beat, then `onDone` (main.js shows BUSTED)
//
// NOT ALWAYS CUFFS. `opts.variant` picks the scene, so a bust is not the same
// thirty seconds every time:
//   cuff      down on one knee, the cuffs, the click
//   ticket    stands over you writing it up on his pad, tears it off, holds it out
//   lecture   a finger wagged in your face and a slow shake of the head, THEN
//             the ticket
//   knees     (a rider still on the bike) made to step off and kneel, hands
//             behind the head; cuffed from behind
//   ground    (a rider still on the bike) made to lie face down, hands behind
//             the back; he kneels on them to cuff
//
// For the PLAYER main.js runs it as a cutscene (the camera pulls back and
// orbits; any key skips after a second). The cop can also arrest a RIVAL he
// finds down: the same scene, played in the world while the race goes on --
// that rider is out.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';
import { ensureRest, restoreRest, captureLocal, blendFrom } from './ragdoll.js';
import { armAim, poseStanding } from './riderpose.js';
import { solveLimb, effectorWorld, rootWorld } from './limbik.js';

export const ARREST = {
  STOP_MAX: 3.0,       // s to pull up
  OFF_T: 0.8,          // s stepping off
  WALK_V: 1.7,         // m/s
  WALK_MAX: 9.0,       // s: then he starts where he is. 5.5 ran out on the 7 m walk
                       // before he had turned to face them (measured)
  REACH: 0.75,         // m from the suspect's body (pelvis) where he stands to write / lecture
  CUFF_REACH: 0.32,    // m from the suspect's WRISTS where he stands (or kneels) to cuff
  CUFF_LOW: 0.2,       // ...and when those wrists are down on the road
  CUFF_T: 2.4,
  WRITE_T: 3.0,        // s writing the ticket (lecture: shorter, he has already said his piece)
  WAG_T: 2.4,          // s of finger-wagging
  HAND_T: 1.1,         // s holding the ticket out
  HOLD_T: 1.0,
  SIDE_OFF: 2.4,       // m beside the target he parks
  STOP_SHORT: 7,       // m short of them he stops
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _box = new THREE.Box3();
const _c = new THREE.Vector3(), _h = new THREE.Vector3(), _pole = new THREE.Vector3();
/** The road's height under world (x, z): the flat cross-section at the nearest
 *  centreline point. A walker's height used to be frozen where he stepped off,
 *  so on a hill he sank into the rise or walked on air (measured: 5-8 cm). */
function roadY(x, z) {
  let zc = z;
  for (let i = 0; i < 3; i++) {
    centreAt(zc, _c); centreTangent(zc, _t);
    zc += ((x - _c.x) * _t.x + (z - _c.z) * _t.z) * _t.z;
  }
  return centreAt(zc, _c).y;
}
function roadPoint(s, lat, out) {                        // + lat = the rider's right
  centreAt(-s, _a); centreTangent(-s, _t);
  return out.set(_a.x + _t.z * lat, _a.y, _a.z - _t.x * lat);
}

export class Arrest {
  /**
   * `cop` is cops.js's Cop; `target` is { phys, fighter, dismount?, name }.
   * opts: { onDone(), onEvent(name), scene }
   */
  constructor(cop, target, opts = {}) {
    this.cop = cop; this.target = target; this.opts = opts;
    this.phase = 'stop'; this.t = 0; this.total = 0; this.done = false;
    this.side = Math.sign((cop.phys.lateral - target.phys.lateral) || 1) || 1;
    this.walker = null;
    this.variant = ['cuff', 'ticket', 'lecture', 'knees', 'ground'].includes(opts.variant) ? opts.variant : 'cuff';
    // THE SUSPECT is made to get down only if still seated (a thrown body is
    // already on the road); otherwise knees / ground fall back to the cuffs
    const d = target.dismount, seated = !(d && d.onFoot);
    if ((this.variant === 'knees' || this.variant === 'ground') && !seated) this.variant = 'cuff';
    this.suspect = (this.variant === 'knees' || this.variant === 'ground') && d && d.player && d.player.rider ? { owner: d.player, t: 0, pos: null } : null;
    cop.state = 'arrest';
    cop.active = false;                 // no siren, no radar strobe, not a fighter
    this._detached = false;
    // REST POSES before anything is posed: the on-foot gait adds its pelvis sway
    // with `+=` and restoreRest() is what takes it off again each frame. A rig
    // that had never been through a ragdoll had no snapshot, so that was a no-op
    // and the sway piled up into an upside-down cop (tools/arrestcheck.mjs).
    if (cop.rider) ensureRest(cop.rider);
    if (this.suspect) ensureRest(this.suspect.owner.rider);
    // CUFFED STANDING: behind a kneeling suspect, or beside one still in the
    // saddle (their wrists are at the bars, a metre up: kneeling, he cuffed
    // the road). Kneeling only for a body on the ground.
    this.standCuff = this.variant === 'knees' || (seated && !this.suspect);
  }

  /** The suspect's rig, whatever it is doing (seated, thrown, made to kneel). */
  suspectRig() {
    const d = this.target.dismount, r = d && d.player && d.player.rider;
    return r && r.userData && r.userData.joints && r.userData.joints.pelvis ? r : null;
  }

  /** Where the target's BODY is: the suspect's pelvis (seated, lying or
   *  kneeling). It used to be the bike's ground point for a seated rider and the
   *  feet for one made to lie down, so he cuffed the air 1-2 m off (measured). */
  targetPoint(out) {
    const r = this.suspectRig();
    if (r && (!this.suspect || this.suspect.pos)) { r.updateWorldMatrix(true, false); return r.userData.joints.pelvis.getWorldPosition(out); }
    if (this.suspect && this.suspect.pos) return out.copy(this.suspect.pos);
    const d = this.target.dismount;
    if (d && d.onFoot && d.walk) return roadPoint(d.walk.s, d.walk.lateral, out);
    return out.copy(this.target.phys.pos);
  }

  /** Where he cuffs: the midpoint of the wrists when the scene has put them
   *  together (knees, ground); otherwise -- still in the saddle, or thrown and
   *  sprawled -- the wrist on HIS side, which he takes in both hands. (Reaching
   *  for a far wrist across a sprawled body folded him on top of it.) */
  wristPoint(out) {
    const r = this.suspectRig();
    if (!r || (this.suspect && !this.suspect.pos)) return null;
    const sj = r.userData.joints, sp = r.userData.spec || { forearm: 0.27 };
    r.updateWorldMatrix(true, true);
    const a = sj.leftArm.fore.localToWorld(new THREE.Vector3(0, -sp.forearm, 0));
    const b = sj.rightArm.fore.localToWorld(new THREE.Vector3(0, -sp.forearm, 0));
    if (this.suspect) return out.addVectors(a, b).multiplyScalar(0.5);
    centreTangent(-this.target.phys.s, _t);                  // + lateral = (t.z, -t.x)
    const nx = _t.z * this.side, nz = -_t.x * this.side;     // toward his side
    return out.copy(a.x * nx + a.z * nz >= b.x * nx + b.z * nz ? a : b);
  }

  /** Where he stands to do the business, on the ground: behind a kneeling
   *  suspect (cuffed from behind), otherwise at arm's length on his own side. */
  standPoint(tp, from, out) {
    const S = this.suspect;
    // cuffing, he works at the WRISTS and stands close enough to reach them
    // (an arm is ~0.6 m: at the ticket's arm's length he cuffed 0.3-0.7 m of
    // air, measured); writing or lecturing, at arm's length from the body
    const cuffing = this.variant !== 'ticket' && this.variant !== 'lecture';
    const wp = cuffing ? this.wristPoint(_pole) || tp : tp;
    // wrists down on the road: he kneels in close over them (from 0.32 m he
    // had to fold 65 deg at the waist and still came up short: measured)
    const low = cuffing && wp !== tp && wp.y - roadY(wp.x, wp.z) < 0.35;
    const r = cuffing ? (low ? ARREST.CUFF_LOW : ARREST.CUFF_REACH) : ARREST.REACH;
    // A FIXED SPOT, not one measured from wherever he is: that slid along with
    // him as he came up the bike, and he spiralled in onto the seat (measured:
    // 0.08 m from a seated rider's pelvis). Behind a kneeling suspect; else
    // square across the road from the work, on his own side.
    if (S && S.pos && this.variant === 'knees') {
      out.set(wp.x - Math.sin(S.facing) * r, 0, wp.z - Math.cos(S.facing) * r);
    } else {
      centreTangent(-this.target.phys.s, _t);             // + lateral = (t.z, -t.x)
      out.set(wp.x + _t.z * this.side * r, 0, wp.z - _t.x * this.side * r);
    }
    out.y = roadY(out.x, out.z);
    return out;
  }

  update(dt) {
    if (this.done) return;
    this.t += dt; this.total += dt;
    const cop = this.cop, p = cop.phys;
    cop.t += dt;
    const tp = this.targetPoint(_b);
    if (this.phase === 'stop') {
      // pull up alongside, a couple of metres out, braking hard
      const tgt = this.target.phys;
      const want = tgt.lateral + this.side * ARREST.SIDE_OFF;
      const gap = tgt.s - p.s;
      const steer = THREE.MathUtils.clamp((want - p.lateral) * 0.35 - (p.lateralV || 0) * 0.25, -1, 1);
      // a braking curve that ends STOP_SHORT metres short of them, so he walks the rest
      const vWant = Math.sqrt(2 * 5.5 * Math.max(0, gap - ARREST.STOP_SHORT));
      p.advance(dt, { throttle: p.speed < vWant - 1.5, brake: p.speed > vWant + 0.5, steer, tuck: false });
      cop._visual(dt);
      if ((p.speed < 0.6 && gap < ARREST.STOP_SHORT + 6) || this.t > ARREST.STOP_MAX) { p.speed = 0; this._enter('off'); this.opts.onEvent && this.opts.onEvent('off'); }
      return;
    }
    const rider = cop.rider, j = rider && rider.userData.joints;
    if (!rider || !j) { this._enter('hold'); }
    if (this.suspect) this._stepSuspect(dt);
    if (!this._detached && rider) {
      // the bike stays where it stopped, on its stand, lights going
      cop.state = 'parked';
      cop._visual(0);
      cop.state = 'arrest';
      cop.group.updateMatrixWorld(true);
      const scene = this.opts.scene || cop.scene;
      rider.getWorldPosition(_a);
      this.seatAt = _a.clone();
      cop._riderScale = cop._riderScale || rider.scale.x;       // attach() folds the bike's scale in
      // the riding pose as it was, to blend the step-off out of (a cut from
      // seated to standing turned the torso 2.2 rad in one frame: measured)
      this._offPose = captureLocal(rider);
      scene.attach(rider);
      rider.rotation.reorder('YXZ');
      // the stepping-off point: beside the bike, on the target's side
      this.walker = { pos: roadPoint(p.s, p.lateral - this.side * 0.9, new THREE.Vector3()), facing: p.yaw };
      this._detached = true;
    }
    // the light bar keeps flashing on the stand
    if (cop.lampR) { const on = Math.floor(cop.t * 6) % 2 === 0; cop.lampR.visible = on; cop.lampB.visible = !on; }
    if (cop.bike) cop.bike.rotation.z = -0.10;
    const w = this.walker;
    const D = cop.dismount;
    if (this.phase === 'off') {
      const k = Math.min(1, this.t / ARREST.OFF_T);
      this._pose(j, dt, 0);
      blendFrom(this._offPose, k * k * (3 - 2 * k));
      _a.copy(this.seatAt).lerp(w.pos, k * k * (3 - 2 * k));
      this._place(rider, _a, w.facing, k);
      if (k >= 1) this._enter('walk');
      return;
    }
    if (this.phase === 'walk') {
      // to the spot he works from, then square up to the body. (He used to walk
      // at the body until within reach, whichever way he happened to arrive,
      // and could end the walk facing away from them: measured 114-176 deg.)
      const sp = this.standPoint(tp, w.pos, _h);
      const dx = sp.x - w.pos.x, dz = sp.z - w.pos.z, dist = Math.hypot(dx, dz);
      const arrived = dist < 0.05;
      const bearing = arrived ? Math.atan2(tp.x - w.pos.x, tp.z - w.pos.z) : Math.atan2(dx, dz);
      let err = bearing - w.facing; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      w.facing += THREE.MathUtils.clamp(err, -3 * dt, 3 * dt);
      const v = arrived ? 0 : Math.min(ARREST.WALK_V, dist * 2.5) * (Math.abs(err) < 1.2 ? 1 : 0.3);
      const step = Math.min(v * dt, dist);
      if (dist > 1e-6) { w.pos.x += dx / dist * step; w.pos.z += dz / dist * step; }
      w.pos.y = roadY(w.pos.x, w.pos.z);
      if (D) { D.walk.speed = v; D.walk.facing = w.facing; }
      this._pose(j, dt, v);
      this._place(rider, w.pos, w.facing, 1);
      if ((arrived && Math.abs(err) < 0.1) || this.t > ARREST.WALK_MAX) {
        const first = this.variant === 'lecture' ? 'wag' : this.variant === 'ticket' ? 'write' : 'cuff';
        this._enter(first);
        this.opts.onEvent && this.opts.onEvent(first);
      }
      return;
    }
    if (this.phase === 'wag') {
      this._pose(j, dt, 0);
      this._faceBody(dt, tp);
      this._poseWag(j, Math.min(1, this.t / 0.4), this.t);
      this._place(rider, w.pos, w.facing, 1);
      if (this.t >= ARREST.WAG_T) { this._enter('write'); this.opts.onEvent && this.opts.onEvent('write'); }
      return;
    }
    if (this.phase === 'write') {
      this._pose(j, dt, 0);
      this._faceBody(dt, tp);
      this._poseWrite(j, Math.min(1, this.t / 0.4), this.t);
      this._pad(true);
      this._place(rider, w.pos, w.facing, 1);
      if (this.t >= ARREST.WRITE_T * (this.variant === 'lecture' ? 0.65 : 1)) {
        this._enter('hand');
        this.opts.onEvent && this.opts.onEvent('ticket');
      }
      return;
    }
    if (this.phase === 'hand') {
      this._pose(j, dt, 0);
      this._faceBody(dt, tp);
      this._poseHand(j, Math.min(1, this.t / 0.3));
      this._pad(false, true);
      this._place(rider, w.pos, w.facing, 1);
      if (this.t >= ARREST.HAND_T) this._enter('hold');
      return;
    }
    if (this.phase === 'cuff') {
      this._pose(j, dt, 0);
      const k = Math.min(1, this.t / 0.5);
      this._faceBody(dt, this.wristPoint(_c) || tp);
      this._poseCuff(j, k, this.t, this.standCuff);
      this._place(rider, w.pos, w.facing, 1);
      this._cuffHands(j, k);
      if (this.t > 1.1 && !this._clicked) { this._clicked = true; this.opts.onEvent && this.opts.onEvent('click'); }
      if (this.t >= ARREST.CUFF_T) this._enter('hold');
      return;
    }
    if (this.phase === 'hold') {
      const cuffed = this.variant !== 'ticket' && this.variant !== 'lecture';
      if (j && cuffed) { this._pose(j, dt, 0); this._poseCuff(j, Math.max(0, 1 - this.t / 0.6), 0, this.standCuff); }
      else if (j) { this._pose(j, dt, 0); this._poseHand(j, Math.max(0, 1 - this.t / 0.5)); this._pad(false, this.t < 0.4); }
      if (rider && w) this._place(rider, w.pos, w.facing, 1);
      if (j && cuffed) this._cuffHands(j, Math.max(0, 1 - this.t / 0.6));
      if (this.t >= ARREST.HOLD_T) { this.done = true; this.opts.onDone && this.opts.onDone(); }
    }
  }

  /** Skip to the end (the player pressed a key). */
  finish() {
    if (this.done) return;
    this.done = true;
    this.opts.onDone && this.opts.onDone();
  }

  /** The cop, back on his bike and out of the scene (race reset). */
  release() {
    const cop = this.cop;
    for (const m of [this._padMesh, this._slipMesh]) if (m) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
    this._releaseSuspect();
    this._padMesh = this._slipMesh = null;
    if (cop.rider && cop.socket && cop.rider.parent !== cop.socket) {
      cop.socket.add(cop.rider);
      cop.rider.position.set(0, 0, 0); cop.rider.rotation.set(0, 0, 0);
      if (cop._riderScale) cop.rider.scale.setScalar(cop._riderScale);
      restoreRest(cop.rider);
    }
  }

  get focus() { return this.walker ? this.walker.pos : this.cop.phys.pos; }

  _enter(ph) { this.phase = ph; this.t = 0; }

  // standing / walking legs from the shared on-foot gait
  _pose(j, dt, speed) {
    const D = this.cop.dismount;
    if (!j) return;
    restoreRest(this.cop.rider);
    if (D && D.poseOnFoot) {
      D.state = 'WALKING'; D.walk.rise = 1; D.walk.onFootT = 30;
      D.walk.speed = speed;
      D.poseOnFoot(j, dt);
    }
  }

  // keep squared up to the body through the business (a seated suspect's bike
  // may still be rolling to a stop)
  _faceBody(dt, tp) {
    const w = this.walker;
    let err = Math.atan2(tp.x - w.pos.x, tp.z - w.pos.z) - w.facing;
    while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    w.facing += THREE.MathUtils.clamp(err, -2 * dt, 2 * dt);
  }

  // THE CUFFS GO ON THE WRISTS: both hands by two-bone IK onto the suspect's
  // wrists (wherever the variant has put them: behind the head, behind the
  // back, on the bars, flung out on the road), weighted in by k from the pose.
  // Called after _place, so every world matrix is this frame's.
  _cuffHands(j, k) {
    const ik = j.__ik, sr = this.suspectRig();
    if (!ik || !sr || k <= 0) return;
    this._haulArm(sr, k);
    const sj = sr.userData.joints, sp = sr.userData.spec || { forearm: 0.27, hand: 0.09 };
    sr.updateWorldMatrix(true, true);
    const wrist = (A) => A.fore.localToWorld(new THREE.Vector3(0, -sp.forearm, 0));
    const w = this.walker, rx = Math.cos(w.facing), rz = -Math.sin(w.facing);   // his LEFT (+x of the rig), in world
    // EACH HAND ON A WRIST: his left hand takes the wrist on his left. (Both
    // went to the midpoint; wrists behind a head are half a metre apart, so
    // each hand closed on air 0.25 m off: measured.)
    let wl = wrist(sj.leftArm), wr = wrist(sj.rightArm);
    if (wl.x * rx + wl.z * rz < wr.x * rx + wr.z * rz) [wl, wr] = [wr, wl];
    // still in the saddle (the far hand is on the far grip) or sprawled on the
    // road: he takes the wrist on his side in both hands
    if (!this.suspect) {
      const near = this.wristPoint(new THREE.Vector3());
      wl = near.clone().addScaledVector(_t.set(rx, 0, rz), 0.05); wr = near.clone().addScaledVector(_t.set(rx, 0, rz), -0.05);
    }
    const onto = { left: wl, right: wr };
    // REACH: bend at the waist just as far as it takes for both hands to get
    // there (bisection, like riderpose.keepGripsInReach). A wrist out at the
    // bars or down on the road was 0.15-0.35 m past a straight arm (measured).
    this.cop.rider.updateWorldMatrix(true, true);
    const from = { left: ik.limbs.left && effectorWorld(ik.limbs.left), right: ik.limbs.right && effectorWorld(ik.limbs.right) };
    const solve = () => {
      this.cop.rider.updateWorldMatrix(true, true);
      let res = 0;
      for (const side of ['left', 'right']) if (from[side]) res = Math.max(res, this._cuffArm(ik.limbs[side], side === 'left' ? 1 : -1, onto[side], from[side], rx, rz, k));
      return res;
    };
    const T = j.torso;
    let res = solve();
    if (res > 0.01 && T) {
      const x0 = T.rotation.x;
      let lo = 0, hi = 0.9;
      for (let i = 0; i < 6; i++) {
        const m = (lo + hi) / 2;
        T.rotation.x = x0 + m;
        if (solve() > 0.01) lo = m; else hi = m;
      }
      T.rotation.x = x0 + hi;
      res = solve();
    }
    this._ikRes = res;                                   // the harness reads the shortfall
  }

  // HAULING THE ARM UP. A thrown rider's wrist lies on the road; kneeling, his
  // shoulders are ~1 m up and an arm is 0.6 m, so reaching it folded him 75 deg
  // over the body (measured, and it read as a heap). He does what an officer
  // does: takes the arm on his side and draws it up off the road toward
  // himself. The suspect's own arm IK, weighted by k, after the body's pose
  // for the frame (so nothing accumulates).
  _haulArm(sr, k) {
    const d = this.target.dismount;
    // face down with the hands behind the back ('ground'): both wrists drawn
    // up off the small of the back, as an officer lifts cuffed hands (resting
    // on the back they left him folded 63 deg over the body: measured)
    if (this.suspect && this.variant === 'ground') {
      const sik = sr.userData.joints.__ik;
      if (!sik) return;
      sr.updateWorldMatrix(true, true);
      for (const side of ['left', 'right']) {
        const L = sik.limbs[side];
        if (!L) continue;
        const sh = rootWorld(L, new THREE.Vector3());
        const tgt = effectorWorld(L, new THREE.Vector3());
        tgt.y += 0.15 * k;
        solveLimb(L, tgt, _pole.set(sh.x, sh.y + 0.5, sh.z));
      }
      sr.updateWorldMatrix(true, true);
      return;
    }
    if (this.suspect || !(d && d.onFoot)) return;
    const sik = sr.userData.joints.__ik;
    if (!sik) return;
    const sj = sr.userData.joints, sp = sr.userData.spec || { forearm: 0.27 };
    sr.updateWorldMatrix(true, true);
    const a = sj.leftArm.fore.localToWorld(new THREE.Vector3(0, -sp.forearm, 0));
    const b = sj.rightArm.fore.localToWorld(new THREE.Vector3(0, -sp.forearm, 0));
    centreTangent(-this.target.phys.s, _t);
    const nx = _t.z * this.side, nz = -_t.x * this.side;     // toward his side
    const L = sik.limbs[a.x * nx + a.z * nz >= b.x * nx + b.z * nz ? 'left' : 'right'];
    if (!L) return;
    const sh = rootWorld(L, new THREE.Vector3());
    const me = this.walker.pos, dx = me.x - sh.x, dz = me.z - sh.z, dl = Math.hypot(dx, dz) || 1;
    const goal = new THREE.Vector3(sh.x + dx / dl * 0.3, roadY(sh.x, sh.z) + 0.45, sh.z + dz / dl * 0.3);
    const tgt = effectorWorld(L, new THREE.Vector3()).lerp(goal, k);
    solveLimb(L, tgt, _pole.set(sh.x, sh.y + 0.4, sh.z));
    sr.updateWorldMatrix(true, true);
  }

  // one arm onto its wrist: `from` is where the pose put the hand, blended
  // toward the wrist by k; the elbow is pushed out to the side and down, like
  // a man working at something low
  _cuffArm(L, sx, wrist, from, rx, rz, k) {
    if (!L) return 0;
    const tgt = _h.copy(wrist).lerp(from, 1 - k);
    L.root.parent.updateWorldMatrix(true, false);
    _pole.copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
    _pole.x += rx * sx * 0.45; _pole.z += rz * sx * 0.45; _pole.y -= 0.35;
    return solveLimb(L, tgt, _pole);
  }

  // THE CUFF: down on one knee beside them, leaning in, hands together low
  // in front working the cuffs.
  _poseCuff(j, k, t, standing = false) {
    if (k <= 0) return;
    const L = j.leftLeg, R = j.rightLeg;
    if (standing) {
      // behind a kneeling suspect: standing, bent over their wrists
      if (j.torso) j.torso.rotation.x += 0.45 * k;
      if (j.neck) j.neck.rotation.x += 0.3 * k;
      const wk = 0.05 * Math.sin(t * 9);
      armAim(j, 'left', [0.12 + wk, -0.55, 0.8], [0, 0.3, 1], 0.8 * k + 0.3);
      armAim(j, 'right', [-0.12 - wk, -0.55, 0.8], [0, 0.3, 1], 0.8 * k + 0.3);
      return;
    }
    // (thigh + swings BACK in this rig; knee + folds the shin back: measured)
    if (R) { R.thigh.rotation.x += (-1.35) * k; R.knee.rotation.x += 1.9 * k; }      // the planted foot, knee up
    if (L) { L.thigh.rotation.x += (-0.2) * k; L.knee.rotation.x += 2.3 * k; }       // the kneeling leg
    if (j.torso) j.torso.rotation.x += 0.55 * k;
    if (j.neck) j.neck.rotation.x += 0.35 * k;
    const work = 0.06 * Math.sin(t * 9);
    armAim(j, 'left', [0.1 + work, -0.75, 0.65], [0, 0.3, 1], 0.9 * k + 0.25);
    armAim(j, 'right', [-0.1 - work, -0.75, 0.65], [0, 0.3, 1], 0.9 * k + 0.25);
    this._crouch = k;
  }

  // THE TICKET BOOK: standing square, the pad held up in the left hand at
  // chest height, head down, the right hand scribbling across it
  _poseWrite(j, k, t) {
    const scrib = 0.05 * Math.sin(t * 15) + 0.03 * Math.sin(t * 6.3);
    armAim(j, 'left', [0.18, -0.62, 0.75], [0, 1, 0.3], 1.55 * k + 0.2);
    armAim(j, 'right', [-0.12 + scrib, -0.66, 0.74], [0, 1, 0.3], 1.45 * k + 0.2 + scrib);
    if (j.neck) j.neck.rotation.x += 0.4 * k;
    if (j.torso) j.torso.rotation.x += 0.06 * k;
  }
  // holding the torn-off ticket out at arm's length
  _poseHand(j, k) {
    armAim(j, 'right', [-0.08, -0.3 + 0.1 * (1 - k), 0.95], [0, 1, 0], 0.2 + 1.2 * (1 - k));
    armAim(j, 'left', [0.35, -0.9, 0.1], [0, 0.3, 1], 0.4);
  }
  // THE LECTURE: hand on the hip, a finger wagged at them, head shaking slowly
  _poseWag(j, k, t) {
    armAim(j, 'right', [-0.32, -0.45, 0.6], [0, 1, 0.4], 1.9 * k + 0.25 * Math.sin(t * 11) * k);
    armAim(j, 'left', [0.7, -0.62, -0.2], [-0.8, 0.2, 0.3], 1.9);
    if (j.neck) { j.neck.rotation.y += 0.28 * Math.sin(t * 4.2) * k; j.neck.rotation.x += 0.12 * k; }
    if (j.torso) j.torso.rotation.x += 0.14 * k;
  }
  // the pad in his left hand (writing) and the slip in his right (handing it over)
  _pad(pad, slip) {
    const j = this.cop.rider && this.cop.rider.userData.joints;
    if (!j) return;
    if (!this._padMesh) {
      const S = this.cop.rider.userData.spec || { forearm: 0.27, hand: 0.09 };
      const mk = (w, h, col) => new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.008), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }));
      this._padMesh = mk(0.1, 0.14, 0xf1ead2);
      this._padMesh.position.set(0, -S.forearm - S.hand * 0.4, 0.05);
      this._slipMesh = mk(0.075, 0.12, 0xf6e7a8);
      this._slipMesh.position.set(0, -S.forearm - S.hand * 0.9, 0.02);
      if (j.leftArm && j.leftArm.fore) j.leftArm.fore.add(this._padMesh);
      if (j.rightArm && j.rightArm.fore) j.rightArm.fore.add(this._slipMesh);
    }
    this._padMesh.visible = !!pad;
    this._slipMesh.visible = !!slip;
  }

  // THE SUSPECT: off the bike on the cop's side, then down -- on the knees
  // with hands behind the head, or flat on the face with hands behind the back.
  // Their rider rig is lifted off its bike for the scene and given back by
  // release() (or the race reset re-seats it: dismount._reattach).
  _stepSuspect(dt) {
    const S = this.suspect, o = S.owner, rider = o.rider, j = rider.userData.joints;
    if (!rider || !j) return;
    S.t += dt;
    const tp = this.target.phys;
    if (!S.pos) {
      o.group.updateMatrixWorld(true);
      S.seat = rider.getWorldPosition(new THREE.Vector3());
      S.scale = rider.scale.x;
      S.from = captureLocal(rider);                           // the seated pose, blended out of
      (this.opts.scene || this.cop.scene).attach(rider);
      rider.rotation.reorder('YXZ');
      S.pos = roadPoint(tp.s, tp.lateral + this.side * 1.1, new THREE.Vector3());
      // facing away from where the cop parked, down the road
      S.facing = tp.yaw;
      S.detached = true;
    }
    restoreRest(rider);
    poseStanding(j, 0, 0);
    const step = Math.min(1, S.t / 0.9), e = step * step * (3 - 2 * step);
    const down = Math.min(1, Math.max(0, (S.t - 1.0) / 0.9));
    const lie = this.variant === 'ground' ? Math.min(1, Math.max(0, (S.t - 1.7) / 1.0)) : 0;
    // hands: up behind the head (knees), behind the back (ground)
    if (this.variant === 'knees' || lie < 0.5) {
      armAim(j, 'left', [0.55, 0.55 * down, -0.35 * down], [0, 0.2, -1], 0.4 + 2.0 * down);
      armAim(j, 'right', [-0.55, 0.55 * down, -0.35 * down], [0, 0.2, -1], 0.4 + 2.0 * down);
    } else {
      // upper arms down the sides and back, forearms folded in across the
      // small of the back: hands together, waiting for the cuffs
      armAim(j, 'left', [0.28, -0.8, -0.5], [-1, 0, -0.4], 1.7);
      armAim(j, 'right', [-0.28, -0.8, -0.5], [1, 0, -0.4], 1.7);
    }
    // legs: kneeling (thighs upright, shins folded back onto the road)
    for (const L of [j.leftLeg, j.rightLeg]) {
      if (!L) continue;
      if (L.thigh) L.thigh.rotation.x += -0.1 * down * (1 - lie);
      if (L.knee) L.knee.rotation.x += 2.2 * down * (1 - lie);
    }
    if (j.neck) { j.neck.rotation.x += 0.25 * down * (1 - lie); j.neck.rotation.y += 1.1 * lie; }
    // out of the saddle pose over the step, not in one frame (the legs
    // straightened at once and lifted the body 0.22 m: measured)
    blendFrom(S.from, e);
    // from the seat to the spot beside the bike, then down
    _a.copy(S.seat).lerp(S.pos, e);
    rider.position.copy(_a);
    rider.rotation.set(1.5 * lie, S.facing, 0, 'YXZ');         // + x tips the body forward: face down
    rider.updateMatrixWorld(true);
    _box.setFromObject(rider, true);
    const gap = S.pos.y - _box.min.y, under = roadY(_a.x, _a.z) - _box.min.y;   // eased down, never through the road
    if (Number.isFinite(gap)) rider.position.y += Math.max(gap * e, under);
  }

  _releaseSuspect() {
    const S = this.suspect;
    if (!S || !S.detached) return;
    const o = S.owner, rider = o.rider;
    if (rider && o.socket && rider.parent !== o.socket) {
      o.socket.add(rider);
      rider.position.set(0, 0, 0); rider.rotation.set(0, 0, 0);
      if (S.scale) rider.scale.setScalar(S.scale);
      restoreRest(rider);
    }
    S.detached = false;
  }

  // put the figure on the ground at `pos`, facing `yaw`
  _place(rider, pos, yaw, k) {
    rider.position.copy(pos);
    rider.rotation.set(0, yaw, 0, 'YXZ');
    rider.updateMatrixWorld(true);
    _box.setFromObject(rider, true);
    // eased onto the road by k, but NEVER below it: legs straightening under a
    // body still at seat height went 0.18 m through the road (measured)
    const gap = pos.y - _box.min.y, under = roadY(pos.x, pos.z) - _box.min.y;
    if (Number.isFinite(gap)) rider.position.y += Math.max(gap * k, under);
  }
}
