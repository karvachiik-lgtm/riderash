// RideRash — dismount, crash, walk and remount.
//
// WHAT THIS IS. A real state machine that runs the player between "on the bike"
// and "on foot, walking back to it":
//
//   RIDING -> FALLING -> DOWN -> STANDING -> WALKING -> MOUNTING -> RIDING
//
// It exists because HANDOFF §5.12's lesson is not only about bones: a mechanic
// that "renders perfectly and never moves a limb" is the same class of failure
// as a mechanic that reports success and does nothing. A crash in this game used
// to be a two-second rotation.x on the rider, after which the game snapped him
// back upright on a bike that had never left. The player could not get off, could
// not walk, and the Road Rash beat of limping back to your machine did not exist.
//
// THE THREE HARD PARTS, each of which is a trap already paid for elsewhere:
//
//  1. TWO BODIES, NOT ONE. Once the rider leaves the machine they are independent
//     rigid-ish bodies: the BIKE slides to a stop on its own, the RIDER tumbles
//     and lands separately. One shared transform is what made the old crash read
//     as "the bike and man rotate together", which is not a crash.
//
//  2. THE RIDER IS THE PHYSICS SUBJECT WHILE ON FOOT. `player.phys` is driven at
//     walking speed by this module instead of by `BikePhys.step`, so the existing
//     chase camera keeps looking at the person the player is controlling, with no
//     camera change. Both BODIES become children of the scene while on foot (see
//     Dismount._detach): the thrown rider is a ragdoll (ragdoll.js), and the
//     bike slides, stops and STAYS where it stopped until he walks to it.
//
//  3. REST POSE BEFORE DELTAS. riderpose.clearAxes first, every frame, then the
//     walk's own rest, then the sine gait. Skipping the clear is the measured
//     1.5 -> 7.8 -> 12.3 -> 16.2 rad compounding in riderpose.js.
//
// RESETTABILITY. This project has had three per-race leaks found by one symptom
// (race 0 behaved differently from races 1-3, §5.16). Every field that describes
// an on-foot moment lives in `this.walk` and is rebuilt wholesale by reset();
// nothing here is a hand-picked subset.
import * as THREE from 'three';
import { centreAt, headAt } from './level.js';
import { clearAxes, poseSeated, solveLimbs, restTarget } from './riderpose.js';
import { GAIT } from './motions.js';
import { RIDING } from './reach.js';
import { CFG } from './config.js';
import { Ragdoll, restoreRest, captureLocal, blendFrom } from './ragdoll.js';

// ---------------------------------------------------------------------------
// States. Strings rather than an enum so a log line reads as the state's name.
// ---------------------------------------------------------------------------
export const ST = {
  RIDING: 'RIDING',
  FALLING: 'FALLING',
  DOWN: 'DOWN',
  STANDING: 'STANDING',
  WALKING: 'WALKING',
  MOUNTING: 'MOUNTING',
};

// ---------------------------------------------------------------------------
// Tunables, all in metres and seconds. Grouped here because they only mean
// anything together — these numbers describe one on-foot sequence.
//
// THE WORST-CASE BOUND, which is a requirement and not a hope:
//   FALL_TIME 1.10 + DOWN_TIME 0.80 + STAND_TIME 0.95
//   + walk home (AUTO_HOME_AFTER 3.5 s, then auto-walk at 2.6 m/s over a crash
//     that leaves at most ~55 m of slide -> 22 s)
//   + MOUNT_TIME 0.90
//   = ~29 s, and HARD_FOOT_CAP below force-mounts at 26 s no matter what, so a
//     player can never be stranded on foot for longer than about half a minute.
//   A crash at racing speed with no input at all still ends back on the bike.
// ---------------------------------------------------------------------------
export const DIS = {
  FALL_TIME: 1.10,        // s of tumbling before the body is considered landed
  DOWN_TIME: 0.80,        // s lying still, reading the situation
  STAND_TIME: 0.95,       // s rising to the feet
  // s for the whole remount: step in, heave the bike up, leg over, settle. It
  // was 0.9 s of the body gliding onto the saddle in one blend; a real remount
  // is four beats and reads as one only at ~2 s.
  MOUNT_TIME: 1.80,
  WALK_SPEED: 4.00,       // m/s under the player's own control: a jog back
  WALK_AUTO_SPEED: 3.40,  // m/s the homing assist walks at
  WALK_ACCEL: 9.0,        // m/s^2 toward the target walking speed
  WALK_TURN: 4.2,         // rad/s the walker faces its direction of travel

  // The rider tumbles as a real body: gravity, ground friction, and a spin that
  // damps. It lands where the physics puts it, not at a scripted offset.
  //
  RIDER_FRICTION: 7.5,    // m/s^2 longitudinal, scrubbing on the tarmac
  RIDER_SIDE_FRICTION: 5.0,
  RIDER_GRAVITY: 15.0,    // heavier than real so the tumble is over quickly
  RIDER_SPIN: 3.1,        // rad/s of tumble at the reference crash speed
  //
  // THE LAUNCH WAS A STUMBLE, NOT A THROW, and that is what "the impact is not
  // there" measured as. RIDER_HOP 2.1 against GRAVITY 15 gives an apogee of
  // v^2/2g = 0.147 m and an airtime of 2v/g = 0.28 s: the body is thrown fifteen
  // CENTIMETRES for a quarter of a second, and `airY` already starts at 0.35 so
  // half of even that is spent before the first frame. Measured in _crashsep.mjs
  // at a 43 m/s wreck: riderY went -0.72 -> -1.36 and STAYED there for the whole
  // 2.3 s fall. The horizontal separation was fine (17.3 m) but the body never
  // rose, so the wreck read as a man sliding along the tarmac in a tumble
  // costume -- which is exactly "the body just stays close, the impact is not
  // there".
  //
  // So the hop is now a proper ballistic launch and it SCALES WITH CRASH SPEED:
  // a 43 m/s wreck and a 12 m/s one must not look the same. HOP_MAX is chosen so
  // the apogee at racing speed is ~1.0 m (v = sqrt(2*15*1.0) = 5.5), which is
  // high enough to read as a throw and low enough that GRAVITY 15 still brings
  // the whole sequence in under FALL_TIME -- raising the hop without the gravity
  // would push the wreck past the 3 s the eye tolerates.
  RIDER_HOP_MAX: 5.5,     // m/s upward at full racing speed (~1.0 m apogee)
  RIDER_HOP_MIN: 1.6,     // m/s at a walking-pace knock, so a bump is a bump
  RIDER_HOP_REF: 32.0,    // m/s of crash speed that earns the full launch
  RIDER_AIR_START: 0.30,  // m the body starts clear of the saddle

  // The bike is a separate slider. A crashed bike on its side scrubs hard, which
  // is both correct and what keeps the walk back bounded.
  BIKE_FRICTION: 13.0,    // m/s^2 along the road
  BIKE_SIDE_FRICTION: 9.0,
  BIKE_SPIN_DAMP: 2.6,
  BIKE_STOP: 0.45,        // m/s under which the bike is at rest

  // THE THROWN BODY is now a ragdoll (ragdoll.js), so FALL_TIME is only the
  // fallback for a rig without joints. The fall ends when the body is at rest,
  // or at FALL_CAP whatever it is doing -- past ~3 s a wreck is an interruption.
  FALL_CAP: 3.0,
  GETUP_BLEND: 0.45,      // s to blend out of the ragdoll's last pose on the rise
  BIKE_KEEP: 0.72,        // fraction of crash speed the bike keeps (rider keeps ~0.95)
  BIKE_GRAVITY: 14.0,

  MOUNT_RANGE: 1.45,      // m from the bike at which remount begins
  AUTO_HOME_AFTER: 1.2,   // s of no meaningful approach before the assist walks.
                          // Was 3.5: a player who has just been thrown does not
                          // know he can walk, and 3.5 s standing still reads as stuck.
  HARD_FOOT_CAP: 26.0,    // s on foot before a forced remount. The bound.

  STAND_Y: 0.0,           // the rider's origin IS his feet, so he stands at 0
  // SUPERSEDED. This was "prone, pivoted about the feet, still on the road" and
  // it was wrong on both counts: pivoting about the feet does NOT put a body on
  // the road (see the pronePivotY note in bodyspec.js -- it stands him on his
  // face). Prone placement now comes from the body spec, which derives the pivot
  // and the drop from the figure's own dimensions. Kept at 0 only so nothing
  // that still reads it gets a surprising value.
  DOWN_Y: 0.0,
  DOWN_ROLL: -1.50,       // ~ -pi/2: face-down, pivoted about the feet
};

const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wc = new THREE.Vector3(), _wt = new THREE.Vector3();

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The inverse of roadToWorld: a world point to (s, lateral), returned as
// out.x = s, out.z = lateral. The road is a function of z, so two fixed-point
// passes are exact to well under a millimetre.
function worldToRoad(pos, out) {
  let s = -pos.z, lateral = 0;
  for (let i = 0; i < 3; i++) {
    centreAt(-s, _wc);
    headAt(-s, _wt);
    const dx = pos.x - _wc.x, dz = pos.z - _wc.z;
    lateral = dx * -_wt.z + dz * _wt.x;
    s += dx * _wt.x + dz * _wt.z;
  }
  return out.set(s, 0, lateral);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeInOut = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

// Place a road-frame (s, lateral) point in world space. This mirrors
// BikePhys.sync deliberately: the walker and the sliding bike must live in the
// same frame the bikes do, or the walker steps off the tarmac onto nothing.
function roadToWorld(s, lateral, out) {
  const z = -s;
  centreAt(z, out);
  headAt(z, _t);
  const nx = -_t.z, nz = _t.x;
  out.x += nx * lateral;
  out.z += nz * lateral;
  return out;
}

export class Dismount {
  /**
   * `owner` is anything with the rider rig shape: { phys, rider, bike, group,
   * socket, fighter }. The player and every rival have it.
   *
   * `opts.auto`: an AI walker. It gets up and walks straight back to its bike
   * with no homing delay (the assist delay exists for a human who may not know
   * they can walk).
   */
  constructor(owner, opts = {}) {
    this._proneBox = new THREE.Box3();
    this._bikeBox = new THREE.Box3();
    this.player = owner;
    this.auto = !!opts.auto;
    this.state = ST.RIDING;
    this.t = 0;               // seconds in the current state
    this.total = 0;           // seconds since the fall started
    this.rag = null;          // the thrown body (ragdoll.js) while FALLING / DOWN
    this.getUp = null;        // captured ragdoll pose, blended out on the rise
    this.walk = this._freshWalk();
  }

  _freshWalk() {
    return {
      // rider body, in the road frame (derived from the ragdoll while it flies)
      s: 0, lateral: 0, speed: 0, lateralV: 0,
      yawOffset: 0, yawRate: 0,
      airY: 0, airVY: 0,
      roll: 0, rollV: 0,
      pitch: 0,
      // bike body, in the road frame, plus its own hop and roll
      bikeS: 0, bikeLateral: 0, bikeSpeed: 0, bikeLateralV: 0,
      bikeYawOffset: 0, bikeYawRate: 0, bikeStopped: false,
      bikeY: 0, bikeVY: 0, bikeRoll: 0, bikeRollV: 0, bikeRollTarget: 1.35,
      // walking bookkeeping
      facing: 0,
      gaitPhase: 0,
      rise: 0,
      homeTimer: 0,
      assist: false,      // the homing assist, latched until the player acts
      lastDist: Infinity,
      // harness: the two numbers that say whether a crash reads as a crash
      peakSep: 0,         // m, largest rider-bike separation during the fall
      restAt: -1,         // s from impact to the body coming to rest
    };
  }

  /** Put the whole state machine back to a known state for a new race. */
  reset() {
    this._reattach();
    this.state = ST.RIDING;
    this.t = 0;
    this.total = 0;
    this.rag = null;
    this.getUp = null;
    this.walk = this._freshWalk();
    const p = this.player && this.player.phys;
    if (p) { p.airY = 0; p.airVY = 0; }
    return this;
  }

  get onFoot() { return this.state !== ST.RIDING; }
  get ownsPose() { return this.onFoot; }
  get focus() { return this.player.phys.pos; }

  /** Harness: rider-bike separation right now, metres. */
  get separation() { return this._distToBike(); }

  /**
   * Start a fall. Called the frame `fighter.down` goes true.
   *
   * `source.side` is the side the blow came from if known; `source.kind` may be
   * 'head' (hit something ahead), 'side' (a swipe) or 'rear' -- the crash type
   * picks the launch, so a head-on and a swipe do not look the same.
   */
  beginFall(source = {}) {
    const player = this.player;
    const p = player.phys;
    const w = this.walk = this._freshWalk();
    this.state = ST.FALLING;
    this.t = 0;
    this.total = 0;
    this.getUp = null;

    w.s = Number.isFinite(p.s) ? p.s : 0;
    w.lateral = Number.isFinite(p.lateral) ? p.lateral : 0;
    w.speed = Math.max(0, Number.isFinite(p.speed) ? p.speed : 0);
    w.lateralV = Number.isFinite(p.lateralV) ? p.lateralV : 0;
    w.yawOffset = Number.isFinite(p.yawOffset) ? p.yawOffset : 0;
    w.facing = p.yaw || 0;
    const side = source.side || (Math.sign(w.lateralV) || (Math.random() < 0.5 ? -1 : 1));
    const kind = source.kind || (Math.abs(w.lateralV) > 3 ? 'side' : 'head');
    const speedFrac = clamp(w.speed / DIS.RIDER_HOP_REF, 0, 1);

    // ---- world-frame directions at the crash ----
    headAt(-w.s, _t);                                  // travel direction
    const tangent = new THREE.Vector3(_t.x, 0, _t.z).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);   // +lateral
    const heading = new THREE.Vector3(Math.sin(w.facing), 0, Math.cos(w.facing));
    const vel = tangent.clone().multiplyScalar(w.speed * Math.cos(w.yawOffset))
      .addScaledVector(normal, w.lateralV);

    // ---- CUT THE STRINGS: both bodies become children of the scene ----
    this._detach();

    // ---- THE LAUNCH: rider and bike DIVERGE from the first frame ----------
    // Rider keeps most of the forward momentum, gains lift and a sideways kick;
    // the bike loses more speed, stays low and spins. The separation in the
    // first 300 ms is what the eye reads as the impact.
    const L = kind === 'head' ? { keep: 0.95, lift: 1.0, kick: 0.6, pitch: 1.0 }
            : kind === 'rear' ? { keep: 0.80, lift: 0.45, kick: 0.5, pitch: 0.5 }
            :                   { keep: 0.90, lift: 0.55, kick: 1.4, pitch: 0.45 };
    const lift = (DIS.RIDER_HOP_MIN + (DIS.RIDER_HOP_MAX - DIS.RIDER_HOP_MIN) * speedFrac) * L.lift;
    const kick = (1.2 + 2.6 * speedFrac) * L.kick;
    const rVel = vel.clone().multiplyScalar(L.keep)
      .add(new THREE.Vector3(0, lift, 0))
      .addScaledVector(normal, side * kick);
    // Over the bars: rotation about the axis (up x heading) pitches the head
    // forward and down; a roll about the heading tumbles him onto a shoulder.
    const up = new THREE.Vector3(0, 1, 0);
    const spin = new THREE.Vector3().crossVectors(up, heading)
      .multiplyScalar((2.0 + 5.0 * speedFrac) * L.pitch)
      .addScaledVector(heading, side * (1.0 + 2.5 * speedFrac) * (kind === 'side' ? 1.4 : 0.6))
      .addScaledVector(up, (Math.random() - 0.5) * 2.0);
    this.rag = player.rider ? new Ragdoll(player.rider) : null;
    if (this.rag && this.rag.ok) this.rag.launch(rVel, spin);
    else this.rag = null;

    // ---- the bike: keeps sliding low, decoupled from here on ----
    w.bikeS = w.s;
    w.bikeLateral = w.lateral;
    w.bikeSpeed = w.speed * DIS.BIKE_KEEP;
    w.bikeLateralV = w.lateralV * 0.5 - side * 0.8;     // it goes the other way
    w.bikeYawOffset = w.yawOffset;
    w.bikeYawRate = (Math.random() < 0.5 ? -1 : 1) * (1.5 + 3.5 * speedFrac);
    w.bikeStopped = false;
    w.bikeY = 0;
    w.bikeVY = 0.6 + 2.2 * speedFrac;
    w.bikeRoll = player.bikeLean || p.lean || 0;
    w.bikeRollTarget = (Math.sign(w.bikeRoll) || -side) * 1.35;
    w.bikeRollV = w.bikeRollTarget * 3.0;
  }

  update(dt, input) {
    const d = Math.min(0.05, Math.max(0, dt));
    this.t += d;
    if (this.state !== ST.RIDING) this.total += d;
    switch (this.state) {
      case ST.FALLING:  this._stepFalling(d); break;
      case ST.DOWN:     this._stepDown(d); break;
      case ST.STANDING: this._stepStanding(d); break;
      case ST.WALKING:  this._stepWalking(d, input); break;
      case ST.MOUNTING: this._stepMounting(d); break;
      default: break;
    }
    return this.state;
  }

  // Project the ragdoll's pelvis into the road frame, so the camera, the HUD,
  // the standings and the harness keep reading one (s, lateral).
  _followBody() {
    const w = this.walk;
    if (!this.rag) return;
    worldToRoad(this.rag.pelvis, _p);
    w.s = _p.x; w.lateral = _p.z;
    const sep = this._distToBike();
    if (sep > w.peakSep) w.peakSep = sep;
  }

  // ---- FALLING: both bodies are moving, neither is controlled ---------------
  _stepFalling(d) {
    const w = this.walk;
    this._stepBike(d);
    if (this.rag) {
      this.rag.step(d);
      this._followBody();
      if (this.rag.atRest || this.t > DIS.FALL_CAP) {
        if (w.restAt < 0) w.restAt = this.total;
        this._enter(ST.DOWN);
      }
    } else if (this.t >= DIS.FALL_TIME) {
      this._enter(ST.DOWN);
    }
  }

  // ---- DOWN: lying still, limp; the player can see where the bike ended up --
  _stepDown(d) {
    this._stepBike(d);
    if (this.rag) { this.rag.step(d); this._followBody(); }
    if (this.t >= DIS.DOWN_TIME) this._beginGetUp();
  }

  // Hand the body from the ragdoll to the procedural rise. The walker starts
  // where the pelvis lies, facing so the procedural prone pose puts the head
  // where the ragdoll's head is, and the ragdoll's joint pose is captured so the
  // rise can blend OUT of it instead of popping.
  _beginGetUp() {
    const w = this.walk;
    const rider = this.player.rider;
    if (this.rag && rider) {
      this._followBody();
      _c.subVectors(this.rag.head, this.rag.pelvis); _c.y = 0;
      // the prone pose lies head toward the walker's -forward (bodyX < 0)
      if (_c.lengthSq() > 1e-4) w.facing = Math.atan2(-_c.x, -_c.z);
      const j = rider.userData.joints;
      rider.updateMatrixWorld(true);
      const pw = new THREE.Vector3(), pq = new THREE.Quaternion();
      j.pelvis.matrixWorld.decompose(pw, pq, _c);
      this.getUp = { pose: captureLocal(rider), pelvisPos: pw, pelvisQ: pq };
    }
    this.rag = null;
    w.rise = 0;
    // HE STANDS UP STILL. `speed` still held the crash speed the fall began
    // with, so the first walking frame set off at 30 m/s -- MEASURED in the crash
    // lab, the walker shot 50 m back up the road in a second and a half.
    w.speed = 0; w.lateralV = 0; w.yawRate = 0;
    w.lastDist = this._distToBike(); w.homeTimer = 0;
    this._enter(ST.STANDING);
  }

  // ---- STANDING: the rise, blended out of the ragdoll's final pose --------
  _stepStanding(d) {
    this._stepBike(d);
    const w = this.walk;
    w.roll *= (1 - Math.min(1, d * 6.0));
    if (this.t >= DIS.STAND_TIME) {
      w.roll = 0;
      w.rise = 1;
      this.getUp = null;
      this._enter(ST.WALKING);
    }
  }

  // ---- WALKING: the mechanic. The player drives; an assist bounds it. -------
  _stepWalking(d, input) {
    const w = this.walk;
    this._stepBike(d);

    const dist = this._distToBike();
    const steer = input && Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    const thr = input ? (input.throttle ? 1 : 0) : 0;
    const brake = input ? (input.brake ? 1 : 0) : 0;

    // "Approaching" is a RATE, not a per-frame step: 0.05 m a frame is 3 m/s,
    // faster than the auto-walk itself, so the old test never saw the assist
    // making progress and it switched itself off and on -- MEASURED in the
    // crash lab as a walker crawling at ~0.7 m/s into the 26 s force-mount.
    const closing = (w.lastDist - dist) / Math.max(1e-3, d);
    if (closing > 0.8) { w.homeTimer = 0; }
    else { w.homeTimer += d; }
    w.lastDist = dist;
    // The assist LATCHES once it engages and lets go only when the player
    // touches a key. An AI walker is always assisted. The first moments after
    // standing are an assisted turn toward the bike: he gets up and LOOKS for it.
    const playerInput = Math.abs(steer) > 0.1 || thr || brake;
    if (playerInput) w.assist = false;
    else if (w.homeTimer > DIS.AUTO_HOME_AFTER) w.assist = true;
    const assisting = this.auto || w.assist || (this.t < 0.8 && !playerInput);

    // TURN, never snap. The walker rotates toward the bike at a body's turning
    // rate; the old code set `facing` to the bearing outright, so the figure
    // spun on the spot in one frame.
    if (assisting) {
      const err = wrapPi(this._bearingToBike() - w.facing);
      w.facing += clamp(err, -DIS.WALK_TURN * 1.4 * d, DIS.WALK_TURN * 1.4 * d);
    }
    w.facing -= steer * DIS.WALK_TURN * d * (assisting ? 0.25 : 1);

    let target = 0;
    const facingErr = Math.abs(wrapPi(this._bearingToBike() - w.facing));
    if (assisting && this.t > 0.25) target = DIS.WALK_AUTO_SPEED * (this.auto ? 1.35 : 1) * (facingErr < 1.2 ? 1 : 0.3);
    else if (thr && !brake) target = DIS.WALK_SPEED;
    else if (brake) target = -DIS.WALK_SPEED * 0.45;
    // slow down to step up to the machine rather than walking into it
    if (assisting) target = Math.min(target, 0.6 + dist * 1.2);
    w.speed += clamp(target - w.speed, -DIS.WALK_ACCEL * d, DIS.WALK_ACCEL * d);
    if (Math.abs(w.speed) < 0.02) w.speed = 0;

    // Move along the world facing, then project back into the road frame.
    // facing is a WORLD yaw; forward is (sin f, 0, cos f).
    roadToWorld(w.s, w.lateral, _p);
    _p.x += Math.sin(w.facing) * w.speed * d;
    _p.z += Math.cos(w.facing) * w.speed * d;
    worldToRoad(_p, _c);
    w.s = _c.x; w.lateral = _c.z;
    this._clampToWorld(w);

    if (dist <= DIS.MOUNT_RANGE || this.total >= DIS.HARD_FOOT_CAP) {
      this._beginMount();
    }
  }

  // ---- MOUNTING: the machine comes up, the rider swings a leg over ----------
  //
  // THE BIKE DOES NOT MOVE TO THE MAN. The phys body is put at the BIKE (where
  // it lies), the group goes with it, and the bike is handed back to the group
  // exactly where it is; only its roll comes out as he heaves it upright. The
  // rider goes to the group at his current world transform and is carried from
  // there to the saddle.
  _beginMount() {
    const player = this.player, p = player.phys, w = this.walk;
    this._placeBike();          // where it LIES, before its heading is changed below
    p.s = w.bikeS;
    p.lateral = w.bikeLateral;
    // HE POINTS IT DOWN THE ROAD. The machine lies at whatever angle it slid to
    // (up to 90 degrees across the carriageway); remounting at that heading
    // push-started the rider straight across the road, into the oncoming lane
    // or a stopped car. Picking the bike up, a rider turns it to face the way
    // he is going -- the mount blend rotates it round as he climbs on.
    p.yawOffset = THREE.MathUtils.clamp(this._wrap(w.bikeYawOffset), -0.25, 0.25);
    w.bikeYawOffset = p.yawOffset;
    p.speed = 0; p.lateralV = 0; p.lean = 0; p.airY = 0;
    p.sync();
    player.group.position.copy(p.pos);
    player.group.rotation.set(p.roadPitch || 0, p.yaw, 0, 'YXZ');
    player.group.updateMatrixWorld(true);
    const bike = player.bike, rider = player.rider;
    if (bike) {
      player.group.attach(bike);
      this._mBikeP = bike.position.clone();
      this._mBikeQ = bike.quaternion.clone();
    }
    if (rider) {
      player.group.attach(rider);
      this._mRiderP = rider.position.clone();
      this._mRiderQ = rider.quaternion.clone();
      this._mRiderS = rider.scale.x;
      // MOUNT FROM THE SIDE HE WALKED UP ON. +x in the bike's frame is the
      // rider's left; the FAR leg is the one that swings over.
      this._mSide = rider.position.x >= 0 ? 1 : -1;
    }
    this._enter(ST.MOUNTING);
  }

  _stepMounting(d) {
    if (this.t >= DIS.MOUNT_TIME) this._finishMount();
  }

  // -------------------------------------------------------------------------
  // The bike's own slide, in the road frame, plus its hop and its fall onto its
  // side. Runs whether or not the rider is even upright -- the whole reason the
  // two can separate. Once it stops it STAYS where it stopped.
  // -------------------------------------------------------------------------
  _stepBike(d) {
    const w = this.walk;
    // hop and roll settle even after the slide has stopped
    w.bikeVY -= DIS.BIKE_GRAVITY * d;
    w.bikeY += w.bikeVY * d;
    if (w.bikeY <= 0) { w.bikeY = 0; w.bikeVY = w.bikeVY < -1.2 ? -w.bikeVY * 0.25 : 0; }
    // roll: a damped spring onto its side, with a bounce as the bar end hits
    const ra = (w.bikeRollTarget - w.bikeRoll) * 60 - w.bikeRollV * 7;
    w.bikeRollV += ra * d;
    w.bikeRoll += w.bikeRollV * d;
    if (Math.abs(w.bikeRoll) > 1.45) { w.bikeRoll = Math.sign(w.bikeRoll) * 1.45; w.bikeRollV *= -0.3; }
    if (w.bikeStopped) return;
    w.bikeSpeed -= Math.sign(w.bikeSpeed) * Math.min(Math.abs(w.bikeSpeed), DIS.BIKE_FRICTION * d);
    w.bikeLateralV -= Math.sign(w.bikeLateralV) * Math.min(Math.abs(w.bikeLateralV), DIS.BIKE_SIDE_FRICTION * d);
    w.bikeYawRate *= (1 - d * DIS.BIKE_SPIN_DAMP);
    w.bikeYawOffset += w.bikeYawRate * d;
    w.bikeS += w.bikeSpeed * d;
    w.bikeLateral += w.bikeLateralV * d;
    this._clampToWorld(w);
    if (Math.abs(w.bikeSpeed) < DIS.BIKE_STOP && Math.abs(w.bikeLateralV) < DIS.BIKE_STOP) {
      w.bikeSpeed = 0; w.bikeLateralV = 0; w.bikeYawRate = 0; w.bikeStopped = true;
    }
  }

  _clampToWorld(w) {
    const half = CFG.ROAD_W / 2;
    const rail = half + CFG.KERB_W + 0.9;
    if (Math.abs(w.lateral) > rail) { w.lateral = Math.sign(w.lateral) * rail; }
    if (Math.abs(w.bikeLateral) > rail) { w.bikeLateral = Math.sign(w.bikeLateral) * rail; w.bikeLateralV = 0; }
    for (const k of ['s', 'lateral', 'speed', 'lateralV', 'bikeS', 'bikeLateral',
                     'bikeSpeed', 'bikeLateralV', 'yawOffset', 'yawRate', 'facing',
                     'bikeYawOffset', 'bikeYawRate', 'bikeY', 'bikeVY', 'bikeRoll', 'bikeRollV']) {
      const v = w[k];
      if (typeof v === 'number' && !Number.isFinite(v)) w[k] = 0;
    }
  }

  _distToBike() {
    const w = this.walk;
    return Math.hypot(w.s - w.bikeS, w.lateral - w.bikeLateral);
  }

  // WORLD yaw from the walker to the bike, in the (sin f, 0, cos f) convention.
  _bearingToBike() {
    const w = this.walk;
    roadToWorld(w.s, w.lateral, _p);
    roadToWorld(w.bikeS, w.bikeLateral, _c);
    return Math.atan2(_c.x - _p.x, _c.z - _p.z);
  }

  _enter(state) {
    this.state = state;
    this.t = 0;
  }

  // Hand control back to the bike, which is where it lay -- walking to it and
  // remounting is what moves the race along.
  _finishMount() {
    const p = this.player.phys;
    const w = this.walk;
    p.s = w.bikeS;
    p.lateral = w.bikeLateral;
    p.yawOffset = w.bikeYawOffset;
    p.speed = 2.5;                  // the push-start handles the rest
    p.lateralV = 0;
    p.yawRate = 0;
    p.lean = 0;
    p.steer = 0;
    p.airY = 0; p.airVY = 0;
    p.sync();

    // BACK ON WITH SOMETHING LEFT. The fighter's own onRemount hook restores HP,
    // but this walk-back path ends the crash itself and never called it, so a
    // rider knocked to 0 HP remounted at 0 -- and the first scrape afterwards was
    // an `hp <= 0` wreck. MEASURED: ten wrecks in a row at a standstill against
    // the car that had stopped for him. Same restore as onRemount.
    const f = this.player.fighter;
    if (f) {
      f.down = false; f.downTimer = 0; f.invuln = CFG.INVULN_AFTER;
      f.hp = Math.max(f.hp || 0, 20, (f.maxHp || 100) * 0.55);
    }

    this._reattach();
    if (this.player.bikeLean !== undefined) this.player.bikeLean = 0;
    this.state = ST.RIDING;
    this.t = 0;
    this.total = 0;
  }

  // -------------------------------------------------------------------------
  // PARENTING.
  //
  // RIDING:  group -> bike -> socket -> rider
  // ON FOOT: scene -> bike,  scene -> rider   (two free bodies)
  //
  // Detaching uses `Object3D.attach`, which re-parents while preserving the
  // world transform, so there is no pop. The old on-foot rig kept the BIKE as a
  // child of the group and anchored the group to the WALKER, computing the
  // bike's offset with the walker's current yaw while the group kept its last
  // riding yaw -- so every step the walker turned, the parked bike swung around
  // him. That is "the bike moves toward me while I walk", and it is gone by
  // construction: nothing about the bike is expressed relative to the man.
  // -------------------------------------------------------------------------
  _scene() {
    let n = this.player.group;
    return (n && n.parent) || null;
  }

  _detach() {
    const scene = this._scene();
    const { bike, rider } = this.player;
    if (!scene) return;
    this.player.group.updateMatrixWorld(true);
    // Remember the RIDING local scales before attach() folds the parents' scale
    // into them; _reattach puts exactly these back.
    if (bike && bike.parent === this.player.group) this._bikeLocalScale = bike.scale.x;
    if (rider && rider.parent === this.player.socket) this._riderLocalScale = rider.scale.x;
    if (bike && bike.parent !== scene) scene.attach(bike);
    if (rider && rider.parent !== scene) scene.attach(rider);
    if (bike) bike.rotation.reorder('YXZ');
    if (rider) rider.rotation.reorder('YXZ');
  }

  // Back on the machine. Every local transform the riding code assumes is put
  // back explicitly -- including SCALE. `attach` preserves WORLD scale, and the
  // rider sits under a bike scaled ~0.9, so a detached rider carries 0.9 as its
  // own local scale; re-parenting under the socket without resetting it made the
  // rider ~10% smaller after EVERY crash (0.9, 0.81, 0.73...) and sunk into the
  // saddle, with hands short of the bars. That is the "sits sunken after the
  // walk" bug. The joint rest pose is restored the same way (ragdoll.js).
  _reattach() {
    const player = this.player;
    if (!player) return;
    const { bike, rider, socket, group } = player;
    if (bike && group && bike.parent !== group) group.add(bike);
    if (bike) {
      bike.position.set(0, 0, 0);
      bike.rotation.set(0, 0, 0, 'YXZ');
      if (this._bikeLocalScale) bike.scale.setScalar(this._bikeLocalScale);
    }
    if (rider) {
      if (socket && rider.parent !== socket) socket.add(rider);
      rider.position.set(0, 0, 0);
      rider.rotation.set(0, 0, 0);
      if (this._riderLocalScale) rider.scale.setScalar(this._riderLocalScale);
      restoreRest(rider);
      rider.visible = true;
    }
    if (bike) bike.visible = true;
  }

  // Place the free bike in WORLD space from its road-frame state.
  _placeBike() {
    const bike = this.player.bike;
    const w = this.walk;
    if (!bike) return;
    roadToWorld(w.bikeS, w.bikeLateral, _p);
    const yaw = roadYawAt(w.bikeS) - w.bikeYawOffset;
    bike.position.set(_p.x, _p.y + w.bikeY, _p.z);
    bike.rotation.set(0, yaw, w.bikeRoll, 'YXZ');
    // Its origin is at wheel-contact height, so rolling it swings the low side
    // under the road: measure the real box and lift by the gap.
    bike.updateMatrixWorld(true);
    this._bikeBox.setFromObject(bike);
    const gap = this._bikeBox.min.y - _p.y;
    if (Number.isFinite(gap) && gap < 0) bike.position.y -= gap;
    const j = bike.userData && bike.userData.joints;
    if (j) {
      if (j.frontSteer && j.frontSteer.rotation) j.frontSteer.rotation.y = 0.35 * Math.sign(w.bikeRoll || 1);
    }
  }

  // -------------------------------------------------------------------------
  // RENDERING. Called every frame while on foot.
  // -------------------------------------------------------------------------
  render(dt) {
    if (!this.onFoot) return;
    const player = this.player;
    const p = player.phys;
    const w = this.walk;
    const rider = player.rider;

    if (this.state !== ST.MOUNTING) this._detach();

    // phys follows the PERSON, so the camera and HUD keep one source of truth
    p.s = w.s;
    p.lateral = w.lateral;
    p.yawOffset = (this.state === ST.WALKING || this.state === ST.STANDING)
      ? this._wrap(roadYawAt(w.s) - w.facing)
      : (this.state === ST.MOUNTING ? w.bikeYawOffset : this._wrap(w.yawOffset));
    p.speed = this.state === ST.WALKING ? Math.abs(w.speed) : 0;
    p.lateralV = 0;
    p.lean = 0;
    p.airY = 0;
    p.wheelSpin = 0;
    if (this.state === ST.MOUNTING) { p.s = w.bikeS; p.lateral = w.bikeLateral; }
    p.sync();
    player.group.position.copy(p.pos);

    if (this.state === ST.MOUNTING) { this._renderMounting(); return; }

    this._placeBike();
    if (!rider) return;
    rider.visible = true;
    const j = rider.userData && rider.userData.joints;

    if (this.rag) {                    // FALLING / DOWN: the ragdoll IS the pose
      if (j && j.chain) j.chain.visible = false;
      this.rag.apply();
      return;
    }

    // STANDING / WALKING: procedural, in WORLD space at the walker.
    restoreRest(rider);
    const rise = this.state === ST.STANDING ? easeInOut(this.walk.rise) : 1;
    const proneness = 1 - rise;
    const spec = rider.userData && rider.userData.spec;
    const sc = rider.scale.y;
    const pivotY = (spec ? spec.pronePivotY : CFG.SEAT_Y) * sc;
    roadToWorld(w.s, w.lateral, _p);
    rider.position.set(_p.x, _p.y + pivotY * proneness, _p.z);
    rider.rotation.set(DIS.DOWN_ROLL * proneness, w.facing, w.roll * proneness, 'YXZ');
    if (j) this.poseOnFoot(j, dt);
    if (proneness > 0) {
      rider.updateMatrixWorld(true);
      this._proneBox.setFromObject(rider);
      const gap = this._proneBox.min.y - _p.y;
      if (Number.isFinite(gap)) rider.position.y -= gap * proneness;
    }

    // THE GET-UP BLEND. Engines never cut from a ragdoll to an animation: they
    // capture the ragdoll's last pose and blend out of it. Joints blend in their
    // local frames; the pelvis, whose parent frame just moved from the crash
    // spot to the walker, blends in WORLD space.
    if (this.getUp && j) {
      const k = easeInOut(this.t / DIS.GETUP_BLEND);
      if (k < 1) {
        rider.updateMatrixWorld(true);
        const pw = new THREE.Vector3(), pq = new THREE.Quaternion();
        j.pelvis.matrixWorld.decompose(pw, pq, _c);
        blendFrom(this.getUp.pose, k);
        pw.lerpVectors(this.getUp.pelvisPos, pw, k);
        pq.slerpQuaternions(this.getUp.pelvisQ, pq, k);
        const par = j.pelvis.parent;
        par.updateWorldMatrix(true, false);
        const parQ = new THREE.Quaternion();
        par.matrixWorld.decompose(_c, parQ, _t);
        j.pelvis.quaternion.copy(parQ.invert().multiply(pq));
        j.pelvis.position.copy(par.worldToLocal(pw));
      }
    }
  }

  // THE REMOUNT, IN FOUR BEATS (k = 0..1 over MOUNT_TIME):
  //
  //   0.00-0.25  STEP IN   -- walk to the bike's side by the saddle, turn to face
  //                           along it; hands come up to the bars.
  //   0.25-0.55  HEAVE     -- the machine comes up off its side; he bends into it,
  //                           hands locked on the grips by IK as they rise.
  //   0.55-0.85  LEG OVER  -- the pelvis rises over the saddle on an arc and the
  //                           FAR leg swings high over the seat to its peg; the
  //                           near foot stays planted.
  //   0.85-1.00  SETTLE    -- down onto the seat, near foot to its peg, blending
  //                           into the exact riding pose (poseSeated) so the
  //                           hand-off to the riding rig is seamless.
  //
  // It used to be one 0.9 s blend: the body glided from wherever it stood onto
  // the saddle while the bike righted itself with nobody holding it.
  _renderMounting() {
    const player = this.player;
    const k = clamp(this.t / DIS.MOUNT_TIME, 0, 1);
    const bike = player.bike, rider = player.rider;
    const seg = (a, b) => easeInOut((k - a) / (b - a));
    const kStep = seg(0.0, 0.25), kLift = seg(0.25, 0.55), kOver = seg(0.55, 0.85), kSettle = seg(0.85, 1.0);
    const side = this._mSide || 1;

    if (bike && this._mBikeQ) {
      bike.position.lerpVectors(this._mBikeP, _c.set(0, 0, 0), kLift);
      bike.quaternion.slerpQuaternions(this._mBikeQ, _q.identity(), kLift);
      if (kLift < 1) {
        bike.updateMatrixWorld(true);
        this._bikeBox.setFromObject(bike);
        const gap = this._bikeBox.min.y - player.group.position.y;
        if (Number.isFinite(gap) && gap < 0) bike.position.y -= gap;
      }
      const bj = bike.userData && bike.userData.joints;
      if (bj && bj.frontSteer && bj.frontSteer.rotation) bj.frontSteer.rotation.y = 0.35 * (1 - kLift) * side;
    }
    if (!rider || !this._mRiderQ) return;
    const bs = bike ? bike.scale.x : 1;
    // the saddle, in the group frame (bike upright at the origin)
    const seat = _p.copy(player.socket ? player.socket.position : _c.set(0, CFG.SEAT_Y, 0)).multiplyScalar(bs);
    // standing spot: beside the saddle on the mount side, a little forward
    const standX = side * 0.62, standZ = seat.z + 0.10;
    const rx = THREE.MathUtils.lerp(standX, seat.x, kOver);
    const rz = THREE.MathUtils.lerp(standZ, seat.z, kOver);
    const ry = THREE.MathUtils.lerp(0, seat.y, kOver) + Math.sin(kOver * Math.PI) * 0.28 - 0.08 * kLift * (1 - kOver);
    // step in from wherever the walk ended
    rider.position.set(
      THREE.MathUtils.lerp(this._mRiderP.x, rx, kStep),
      THREE.MathUtils.lerp(this._mRiderP.y, ry, kStep),
      THREE.MathUtils.lerp(this._mRiderP.z, rz, kStep));
    rider.quaternion.slerpQuaternions(this._mRiderQ, _q.identity(), kStep);
    restoreRest(rider);
    const j = rider.userData && rider.userData.joints;
    if (j) this.poseMount(j, { kStep, kLift, kOver, kSettle, side });
  }

  // -------------------------------------------------------------------------
  // POSES. Every one starts with clearAxes — see riderpose.js for the measured
  // 1.5 -> 7.8 -> 12.3 -> 16.2 compounding that comes of skipping it.
  //
  // The on-foot rest pose is NOT the riding pose. On the bike the legs are
  // folded and the torso is over the tank; standing, the legs must be under the
  // body and the torso upright, and the asset's own baked hip/knee angles
  // (-1.16 / 1.55) are countered rather than composed with.
  // -------------------------------------------------------------------------
  poseOnFoot(j, dt) {
    clearAxes(j);
    const w = this.walk;
    const standing = this.state === ST.STANDING || this.state === ST.WALKING;

    // ---- THE RISE IS LATCHED, NOT READ FROM `this.t` ----
    //
    // This was `easeInOut(this.t / STAND_TIME)`, and `this.t` RESETS TO ZERO the
    // instant the state machine enters WALKING. So the blend computed 0 for the
    // entire walk: the torso stayed at its -1.05 prone fold, the arms stayed
    // splayed, and the legs stayed in the trailing prone pose. The rider walked
    // the whole way home FACE-DOWN, floating, feet off the ground -- measured in
    // the filmstrip as frame 16 (WALKING t=0.25) already horizontal. The rise
    // only ever animated during the 0.95 s STANDING beat and was then thrown away.
    //
    // The rise belongs to the BODY, not to the state's clock, so it is stored on
    // the walk record and RATCHETS: it ramps to 1 over STAND_TIME while standing
    // and stays at 1 for the rest of the sequence. Any later transition that
    // wants the body down again sets it explicitly.
    if (standing) {
      w.rise = Math.min(1, (w.rise || 0) + (dt || 0.016) / DIS.STAND_TIME);
    }
    const rise = standing ? (w.rise || 0) : 0;

    const rot = (n, x, y, z) => {
      if (!n || !n.rotation) return;
      if (x !== undefined) n.rotation.x = x;
      if (y !== undefined) n.rotation.y = y;
      if (z !== undefined) n.rotation.z = z;
    };

    // torso: folded on the ground, straightening to a slight lean as he stands
    const g = GAIT;
    const torsoPitch = -1.05 * (1 - rise) + g.torsoLean * rise;
    rot(j.torso, torsoPitch);
    rot(j.neck, 0.45 * (1 - rise) + 0.06);

    // arms: down and out while prone, swinging with the gait while walking
    const la = j.leftArm, ra = j.rightArm;
    if (la) {
      rot(la.upper, g.armDown + (1 - rise) * 0.9, undefined, g.armOut + (1 - rise) * 0.35);
      rot(la.elbow, g.elbowBend + (1 - rise) * 0.5);
    }
    if (ra) {
      rot(ra.upper, g.armDown + (1 - rise) * 0.9, undefined, -g.armOut - (1 - rise) * 0.35);
      rot(ra.elbow, g.elbowBend + (1 - rise) * 0.5);
    }
    if (j.chain) j.chain.visible = false;

    // ---- legs: straightened under the body, plus the sine gait ----
    // THE COUNTERS GO ON THE JOINTS THE RIG BAKED THEM INTO.
    //
    // assets/rider.js bakes the seated fold into `hip` (+1.48, from RIDING.hip)
    // and `knee` (-2.34, from RIDING.knee). `thigh` is a CHILD of `hip` and
    // carries none of it. This code used to write the standing counters to
    // `thigh` and to `knee`, so the hip kept its full seated fold and the rider
    // WALKED SITTING -- hips folded, legs up on phantom pegs. MEASURED: the hip
    // was still at +1.48 rad through the whole walk. `clearAxes` does not help:
    // it zeroes only y and z, and the seated fold is on x.
    //
    // So the counter is applied where the fold is (hip, knee), and the gait swing
    // is applied on top of the straightened hip via `thigh` -- a child, so the
    // swing composes with the now-neutral hip instead of fighting the fold.
    for (const side of ['left', 'right']) {
      const L = j[side + 'Leg'] || (j.legs && j.legs[side]);
      if (!L) continue;
      const sgn = side === 'left' ? 1 : -1;
      if (standing) {
        const phase = w.gaitPhase + (sgn > 0 ? 0 : Math.PI);
        const swing = Math.sin(phase) * g.stride;
        const lift = Math.max(0, Math.cos(phase)) * g.lift;
        // the hip is STRAIGHTENED (undo the seated fold), then the stride swings
        // on `thigh`; the knee undoes its own seated bend and folds for the lift.
        rot(L.hip, g.hipStand);
        rot(L.thigh, swing * g.thighSwing);
        rot(L.knee, g.kneeStand - lift * g.kneeBend - Math.max(0, -swing) * g.kneeBend * 0.4);
      } else {
        // prone: legs not folded up -- the hip straightens and the leg trails
        rot(L.hip, g.hipStand + 0.18);
        rot(L.thigh, 0);
        rot(L.knee, g.kneeStand - 0.22);
      }
    }

    // ---- the gait clock ----
    // Advanced HERE, off the walker's actual ground speed, so the feet do not
    // slide when the walker is moving slowly and do not march on the spot when
    // the player is idle.
    const cadence = g.cadence * Math.max(0.35, Math.abs(w.speed) / DIS.WALK_SPEED);
    if (standing) w.gaitPhase = (w.gaitPhase || 0) + cadence * Math.min(0.05, dt || 0.016);
  }

  poseMount(j, m) {
    const { kStep, kLift, kOver, kSettle, side } = m;
    const player = this.player;
    const rider = player.rider, group = player.group;
    clearAxes(j);
    const g = GAIT;
    const rot = (n, x, y, z) => {
      if (!n || !n.rotation) return;
      if (x !== undefined) n.rotation.x = x;
      if (y !== undefined) n.rotation.y = y;
      if (z !== undefined) n.rotation.z = z;
    };
    // THE BASE: standing, bending into the heave, then the seated pose, all as
    // one blend so the settle ends exactly on what the riding rig will draw.
    const bend = kLift * (1 - kOver);                   // stoop over the bars while lifting
    rot(j.torso, g.torsoLean + 0.55 * bend);
    rot(j.neck, 0.1 + 0.2 * bend);
    for (const s2 of ['left', 'right']) {
      const L = j[s2 + 'Leg'] || (j.legs && j.legs[s2]);
      if (!L) continue;
      rot(L.hip, g.hipStand - 0.35 * bend);
      rot(L.thigh, 0);
      rot(L.knee, g.kneeStand + 0.5 * bend);
    }
    if (j.chain) j.chain.visible = false;

    const ik = j.__ik;
    if (!ik) return;
    // Feet on the road beside the bike, in WORLD space, from the rider's own
    // root (his origin is his feet). The far foot arcs over the saddle.
    group.updateMatrixWorld(true);
    rider.updateMatrixWorld(true);
    const near = side > 0 ? 'leftLeg' : 'rightLeg';
    const far = side > 0 ? 'rightLeg' : 'leftLeg';
    const sc = rider.scale.x;
    const foot = (dx) => _wt.set(dx * 0.11 * sc, 0.02, 0.06).applyMatrix4(rider.matrixWorld);
    const ground = (key) => {
      const v = foot(key === 'leftLeg' ? 1 : -1).clone();
      v.y = group.position.y + 0.04;                     // on the road, whatever the pelvis does
      return v;
    };
    const peg = (key) => restTarget(ik, key, new THREE.Vector3());
    const over = {};
    // near leg: planted until the settle, then onto its peg
    over[near] = ground(near).lerp(peg(near), kSettle);
    // far leg: planted, then up and over the saddle (a high arc behind the
    // rider's hip, above the seat), then down onto its peg
    const gf = ground(far), pf = peg(far);
    if (kOver <= 0) over[far] = gf;
    else {
      const top = _wc.set(0, 0.62, -0.30);               // above and behind the saddle, bike frame
      const topW = player.socket ? player.socket.localToWorld(top.clone()) : pf.clone().setY(pf.y + 0.6);
      const u = kOver;
      // quadratic Bezier ground -> over the seat -> peg
      over[far] = gf.clone().multiplyScalar((1 - u) * (1 - u))
        .add(topW.multiplyScalar(2 * u * (1 - u)))
        .add(pf.clone().multiplyScalar(u * u));
    }
    // hands: hanging at his sides while he walks in, reaching for the grips
    // only over the last part of the step (reaching from 1.5 m away stretched
    // both arms out level like a mannequin -- seen in the lab filmstrip), then
    // locked on them.
    const reach = easeInOut((kStep - 0.55) / 0.45);
    if (reach < 1) {
      for (const key of ['left', 'right']) {
        const L = ik.limbs[key];
        if (!L) continue;
        L.root.parent.updateWorldMatrix(true, false);
        const sh = new THREE.Vector3().copy(L.root.position).applyMatrix4(L.root.parent.matrixWorld);
        const hang = sh.clone().add(new THREE.Vector3(0, -0.55 * sc, 0));
        over[key] = hang.lerp(restTarget(ik, key, new THREE.Vector3()), reach);
      }
    }
    j.__ikOn = true;
    solveLimbs(j, over);

    // SETTLE: the last beat blends every joint into the riding pose itself, so
    // the frame the riding rig takes over is the frame this one ended on.
    if (kSettle > 0) {
      const from = j.__mountSnap || (j.__mountSnap = new Map());
      from.clear();
      const nodes = [j.torso, j.neck];
      for (const s2 of ['left', 'right']) {
        const A = j[s2 + 'Arm'] || (j.arms && j.arms[s2]);
        const L = j[s2 + 'Leg'] || (j.legs && j.legs[s2]);
        if (A) nodes.push(A.upper, A.elbow);
        if (L) nodes.push(L.hip, L.thigh, L.knee);
      }
      for (const n of nodes) if (n) from.set(n, n.quaternion.clone());
      clearAxes(j);
      poseSeated(j, 0);
      for (const [n, q] of from) n.quaternion.slerpQuaternions(q, n.quaternion.clone(), kSettle);
    }
  }

  _wrap(a) {
    let x = a;
    while (x > Math.PI) x -= Math.PI * 2;
    while (x < -Math.PI) x += Math.PI * 2;
    return clamp(x, -1.9, 1.9);   // the same bound BikePhys keeps on yawOffset
  }
}

// The road's own heading at a given distance, so a world-facing walk direction
// can be expressed as a yawOffset against it. headAt is the +z-facing tangent;
// travel is -z, so the road heading the bikes use is atan2(t.x, t.z).
function roadYawAt(s) {
  headAt(-s, _t);
  return Math.atan2(_t.x, _t.z);
}