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
// For the PLAYER main.js runs it as a cutscene (the camera pulls back and
// orbits; any key skips after a second). The cop can also arrest a RIVAL he
// finds down: the same scene, played in the world while the race goes on --
// that rider is out.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';
import { restoreRest } from './ragdoll.js';
import { armAim } from './riderpose.js';

export const ARREST = {
  STOP_MAX: 3.0,       // s to pull up
  OFF_T: 0.8,          // s stepping off
  WALK_V: 1.7,         // m/s
  WALK_MAX: 5.5,       // s: then he is simply there
  REACH: 1.0,          // m from the body where he stops
  CUFF_T: 2.4,
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
    cop.state = 'arrest';
    cop.active = false;                 // no siren, no radar strobe, not a fighter
    this._detached = false;
  }

  /** Where the target's BODY is (lying rider or seated one). */
  targetPoint(out) {
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
      if ((p.speed < 0.6 && gap < ARREST.STOP_SHORT + 6) || this.t > ARREST.STOP_MAX) { p.speed = 0; this._enter('off'); }
      return;
    }
    const rider = cop.rider, j = rider && rider.userData.joints;
    if (!rider || !j) { this._enter('hold'); }
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
        this._enter('cuff');
        this.opts.onEvent && this.opts.onEvent('cuff');
      }
      return;
    }
    if (this.phase === 'cuff') {
      this._pose(j, dt, 0);
      this._poseCuff(j, Math.min(1, this.t / 0.5), this.t);
      this._place(rider, w.pos, w.facing, 1);
      if (this.t > 1.1 && !this._clicked) { this._clicked = true; this.opts.onEvent && this.opts.onEvent('click'); }
      if (this.t >= ARREST.CUFF_T) this._enter('hold');
      return;
    }
    if (this.phase === 'hold') {
      if (j) { this._pose(j, dt, 0); this._poseCuff(j, Math.max(0, 1 - this.t / 0.6), 0); }
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
  _poseCuff(j, k, t) {
    if (k <= 0) return;
    const L = j.leftLeg, R = j.rightLeg;
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
