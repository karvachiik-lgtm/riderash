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
import { restoreRest } from './ragdoll.js';
import { armAim, poseStanding } from './riderpose.js';

export const ARREST = {
  STOP_MAX: 3.0,       // s to pull up
  OFF_T: 0.8,          // s stepping off
  WALK_V: 1.7,         // m/s
  WALK_MAX: 5.5,       // s: then he is simply there
  REACH: 1.0,          // m from the body where he stops
  CUFF_T: 2.4,
  WRITE_T: 3.0,        // s writing the ticket (lecture: shorter, he has already said his piece)
  WAG_T: 2.4,          // s of finger-wagging
  HAND_T: 1.1,         // s holding the ticket out
  HOLD_T: 1.0,
  SIDE_OFF: 2.4,       // m beside the target he parks
  STOP_SHORT: 7,       // m short of them he stops
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _box = new THREE.Box3();
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
  }

  /** Where the target's BODY is (lying rider or seated one). */
  targetPoint(out) {
    if (this.suspect && this.suspect.pos) return out.copy(this.suspect.pos);
    const d = this.target.dismount;
    if (d && d.onFoot && d.rag && d.rag.root) {           // the thrown body
      const r = d.player.rider;
      if (r && r.userData.joints && r.userData.joints.pelvis) return r.userData.joints.pelvis.getWorldPosition(out);
    }
    if (d && d.onFoot && d.walk) return roadPoint(d.walk.s, d.walk.lateral, out);
    return out.copy(this.target.phys.pos);
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
      _a.copy(this.seatAt).lerp(w.pos, k * k * (3 - 2 * k));
      this._place(rider, _a, w.facing, k);
      if (k >= 1) this._enter('walk');
      return;
    }
    if (this.phase === 'walk') {
      const dx = tp.x - w.pos.x, dz = tp.z - w.pos.z, dist = Math.hypot(dx, dz);
      const bearing = Math.atan2(dx, dz);
      let err = bearing - w.facing; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      w.facing += THREE.MathUtils.clamp(err, -3 * dt, 3 * dt);
      const v = Math.min(ARREST.WALK_V, Math.max(0, dist - ARREST.REACH) * 1.5) * (Math.abs(err) < 1.2 ? 1 : 0.3);
      w.pos.x += Math.sin(w.facing) * v * dt; w.pos.z += Math.cos(w.facing) * v * dt;
      if (D) { D.walk.speed = v; D.walk.facing = w.facing; }
      this._pose(j, dt, v);
      this._place(rider, w.pos, w.facing, 1);
      if (dist <= ARREST.REACH + 0.15 || this.t > ARREST.WALK_MAX) {
        if (this.t > ARREST.WALK_MAX) { w.pos.x = tp.x - Math.sin(w.facing) * ARREST.REACH; w.pos.z = tp.z - Math.cos(w.facing) * ARREST.REACH; }
        const first = this.variant === 'lecture' ? 'wag' : this.variant === 'ticket' ? 'write' : 'cuff';
        this._enter(first);
        this.opts.onEvent && this.opts.onEvent(first);
      }
      return;
    }
    if (this.phase === 'wag') {
      this._pose(j, dt, 0);
      this._poseWag(j, Math.min(1, this.t / 0.4), this.t);
      this._place(rider, w.pos, w.facing, 1);
      if (this.t >= ARREST.WAG_T) { this._enter('write'); this.opts.onEvent && this.opts.onEvent('write'); }
      return;
    }
    if (this.phase === 'write') {
      this._pose(j, dt, 0);
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
      this._poseHand(j, Math.min(1, this.t / 0.3));
      this._pad(false, true);
      this._place(rider, w.pos, w.facing, 1);
      if (this.t >= ARREST.HAND_T) this._enter('hold');
      return;
    }
    if (this.phase === 'cuff') {
      this._pose(j, dt, 0);
      this._poseCuff(j, Math.min(1, this.t / 0.5), this.t, this.variant === 'knees');
      this._place(rider, w.pos, w.facing, 1);
      if (this.t > 1.1 && !this._clicked) { this._clicked = true; this.opts.onEvent && this.opts.onEvent('click'); }
      if (this.t >= ARREST.CUFF_T) this._enter('hold');
      return;
    }
    if (this.phase === 'hold') {
      if (j && this.variant !== 'ticket' && this.variant !== 'lecture') { this._pose(j, dt, 0); this._poseCuff(j, Math.max(0, 1 - this.t / 0.6), 0); }
      else if (j) { this._pose(j, dt, 0); this._poseHand(j, Math.max(0, 1 - this.t / 0.5)); this._pad(false, this.t < 0.4); }
      if (rider && w) this._place(rider, w.pos, w.facing, 1);
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
    // from the seat to the spot beside the bike, then down
    _a.copy(S.seat).lerp(S.pos, e);
    rider.position.copy(_a);
    rider.rotation.set(1.5 * lie, S.facing, 0, 'YXZ');         // + x tips the body forward: face down
    rider.updateMatrixWorld(true);
    _box.setFromObject(rider, true);
    if (Number.isFinite(_box.min.y)) rider.position.y += (S.pos.y - _box.min.y) * e;
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
    const ground = pos.y;
    if (Number.isFinite(_box.min.y)) rider.position.y += (ground - _box.min.y) * k;
  }
}
