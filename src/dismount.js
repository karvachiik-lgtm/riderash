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
//     camera change. The BIKE becomes the free body, drawn as a child of the
//     group at its own offset (see Dismount.render).
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
import { clearAxes } from './riderpose.js';
import { GAIT } from './motions.js';
import { RIDING } from './reach.js';
import { CFG } from './config.js';

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
  MOUNT_TIME: 0.90,       // s swinging a leg back over
  WALK_SPEED: 3.20,       // m/s under the player's own control
  WALK_AUTO_SPEED: 2.60,  // m/s the homing assist walks at
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

  MOUNT_RANGE: 1.70,      // m from the bike at which remount is offered
  AUTO_HOME_AFTER: 3.5,   // s of no meaningful approach before the assist walks
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
  constructor(player) {
    // scratch, allocated ONCE: measuring the body every prone frame must not
    // allocate a Box3 at 60 Hz
    this._proneBox = new THREE.Box3();
    this._bikeBox = new THREE.Box3();
    this.player = player;
    this.state = ST.RIDING;
    this.t = 0;               // seconds in the current state
    this.total = 0;           // seconds since the fall started
    this.walk = this._freshWalk();
  }

  // A whole new on-foot record. reset() replaces this object rather than picking
  // fields off it — §5.16 is the record of what a chosen subset costs.
  _freshWalk() {
    return {
      // rider body, in the road frame
      s: 0, lateral: 0, speed: 0, lateralV: 0,
      yawOffset: 0, yawRate: 0,
      airY: 0, airVY: 0, // vertical hop during the tumble
      roll: 0, rollV: 0, // tumble about the travel axis
      pitch: 0,          // face-down / face-up lean of the body
      // bike body, in the road frame
      bikeS: 0, bikeLateral: 0, bikeSpeed: 0, bikeLateralV: 0,
      bikeYawOffset: 0, bikeYawRate: 0, bikeStopped: false,
      // walking bookkeeping
      facing: 0,          // world yaw the walker faces
      gaitPhase: 0,       // the sine gait's clock, advanced by ground speed
      rise: 0,            // 0 = prone, 1 = on the feet; latches during the rise
      homeTimer: 0,       // s spent not approaching the bike
      lastDist: Infinity,
    };
  }

  /** Put the whole state machine back to a known state for a new race. */
  reset() {
    this.state = ST.RIDING;
    this.t = 0;
    this.total = 0;
    this.walk = this._freshWalk();
    const p = this.player && this.player.phys;
    if (p) { p.airY = 0; p.airVY = 0; }
    return this;
  }

  get onFoot() {
    return this.state !== ST.RIDING;
  }

  /** True while the module is posing the rider and the bike itself. */
  get ownsPose() { return this.onFoot; }

  // The world position the camera should be watching. While riding that is the
  // bike (the group); while on foot it is the person, who is the subject.
  get focus() {
    return this.player.phys.pos;
  }

  /**
   * Start a fall. Called by Player the frame `fighter.down` goes true.
   *
   * `source` is free-form: { side, speed } if a caller knows more, ignored
   * otherwise. Everything needed is already on `phys` — knockDown applied the
   * speed loss and the lateral/yaw kick, and this reads that state rather than
   * inventing a second version of it.
   */
  beginFall(source = {}) {
    const p = this.player.phys;
    const w = this.walk = this._freshWalk();
    this.state = ST.FALLING;
    this.t = 0;
    this.total = 0;

    // --- rider: inherits the bike's velocity at the moment of the fall ---
    w.s = Number.isFinite(p.s) ? p.s : 0;
    w.lateral = Number.isFinite(p.lateral) ? p.lateral : 0;
    w.speed = Math.max(0, Number.isFinite(p.speed) ? p.speed : 0);
    w.lateralV = Number.isFinite(p.lateralV) ? p.lateralV : 0;
    // thrown off to one side; `source.side` when a caller knows which side the
    // blow came from, otherwise whichever way the bike was already sliding.
    const side = source.side || (Math.sign(w.lateralV) || (Math.random() < 0.5 ? -1 : 1));
    w.lateralV += side * 1.2;
    w.yawOffset = Number.isFinite(p.yawOffset) ? p.yawOffset : 0;
    w.yawRate = Number.isFinite(p.yawRate) ? p.yawRate : 0;
    w.airY = DIS.RIDER_AIR_START;         // knocked clear of the machine
    // THE LAUNCH SCALES WITH CRASH SPEED. At a 43 m/s wreck this is ~5.5 m/s up
    // (a ~1 m apogee, ~0.73 s of airtime); at a walking-pace bump it is 1.6 m/s
    // (a ~9 cm stumble). Without the scaling every crash looked identical, which
    // is its own tell that nothing physical is happening.
    const speedFrac = clamp(w.speed / DIS.RIDER_HOP_REF, 0, 1);
    w.airVY = DIS.RIDER_HOP_MIN + (DIS.RIDER_HOP_MAX - DIS.RIDER_HOP_MIN) * speedFrac;
    w.roll = 0;
    // The tumble also scales: a body thrown harder turns over more.
    w.rollV = side * DIS.RIDER_SPIN * (0.5 + 0.5 * speedFrac);
    w.pitch = 0;
    w.facing = p.yaw || 0;

    // --- bike: keeps sliding, decoupled from here on ---
    w.bikeS = w.s;
    w.bikeLateral = w.lateral;
    w.bikeSpeed = w.speed;
    w.bikeLateralV = w.lateralV * 0.35;   // only some of the sideways throw
    w.bikeYawOffset = w.yawOffset;
    w.bikeYawRate = w.yawRate;
    w.bikeStopped = false;
  }

  // -------------------------------------------------------------------------
  // Per frame. Returns the current state string.
  //
  // `input` is the game's own input object (throttle/brake/steer). Walking uses
  // the SAME keys as riding, deliberately: W walks forward, A/D steer the walk,
  // and there is no new control to learn for a mechanic the player meets once.
  // -------------------------------------------------------------------------
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

  // ---- FALLING: both bodies are moving, neither is controlled ---------------
  _stepFalling(d) {
    const w = this.walk;
    this._stepBike(d);
    // rider: forward slide scrubbed, sideways scrubbed, a ballistic hop, and a
    // tumble that damps out. All of it clamps, because a non-finite value here
    // reaches phys and then the renderer (§5.6).
    w.speed -= Math.sign(w.speed) * Math.min(Math.abs(w.speed), DIS.RIDER_FRICTION * d);
    w.lateralV -= Math.sign(w.lateralV) * Math.min(Math.abs(w.lateralV), DIS.RIDER_SIDE_FRICTION * d);
    w.airVY -= DIS.RIDER_GRAVITY * d;
    w.airY += w.airVY * d;
    if (w.airY <= 0) {
      w.airY = 0;
      if (Math.abs(w.airVY) > 0.8) w.airVY = -w.airVY * 0.18;   // a small bounce
      else w.airVY = 0;
    }
    w.rollV *= (1 - d * 2.4);
    w.roll += w.rollV * d;
    w.yawRate *= (1 - d * 2.0);
    w.yawOffset += w.yawRate * d;
    w.s += w.speed * d;
    w.lateral += w.lateralV * d;
    this._clampToWorld(w);

    // The body has stopped moving. Down it is.
    const moving = w.speed > 0.9 || Math.abs(w.lateralV) > 0.9 || w.airY > 0.01;
    if ((this.t >= DIS.FALL_TIME && !moving) || this.t >= DIS.FALL_TIME + 1.4) {
      this._enter(ST.DOWN);
      w.pitch = DIS.DOWN_ROLL;             // face-down on the tarmac
      w.airY = 0;
    }
  }

  // ---- DOWN: lying still; the player can see where the bike ended up --------
  _stepDown(d) {
    this._stepBike(d);
    const w = this.walk;
    w.rollV *= (1 - d * 3.0);
    w.roll += w.rollV * d;
    if (this.t >= DIS.DOWN_TIME) {
      this._enter(ST.STANDING);
    }
  }

  // ---- STANDING: a short scripted rise to the feet -------------------------
  _stepStanding(d) {
    this._stepBike(d);
    // ROLL BACK TO ZERO. The tumble leaves the body rolled onto its side
    // (measured: 0.99 rad, 57 degrees, still there when the stand began), and a
    // standing figure leaning permanently at 57 degrees is the same class of
    // "it renders and is wrong" that this module exists to avoid. It unwinds
    // with the rise rather than snapping.
    const w = this.walk;
    w.roll *= (1 - Math.min(1, d * 6.0));
    if (Math.abs(w.roll) < 0.01) w.roll = 0;
    if (this.t >= DIS.STAND_TIME) {
      w.roll = 0;
      this._enter(ST.WALKING);
      // face the bike to start with, which is also the direction the player
      // almost always wants to go.
      w.facing = this._bearingToBike();
    }
  }

  // ---- WALKING: the mechanic. The player drives; an assist bounds it. -------
  _stepWalking(d, input) {
    const w = this.walk;
    this._stepBike(d);

    const dist = this._distToBike();
    // steer: A/D are a turn rate, W/S are forward/back. Same keys as the bike.
    const steer = input && Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    const thr = input ? (input.throttle ? 1 : 0) : 0;
    const brake = input ? (input.brake ? 1 : 0) : 0;

    // THE HOMING ASSIST, and why it is not optional. A player can be knocked
    // down at 30 m/s and the bike can slide 40 m; with no input that is half a
    // minute of walking, and a player who does not realise they can walk reads
    // the game as broken and stuck. After AUTO_HOME_AFTER seconds of not
    // approaching, the walker turns itself toward the bike and walks. It yields
    // the moment the player steers, so it is a floor, not a cutscene.
    if (dist < w.lastDist - 0.05) { w.homeTimer = 0; }
    else { w.homeTimer += d; }
    w.lastDist = dist;
    const assisting = w.homeTimer > DIS.AUTO_HOME_AFTER;

    if (assisting) w.facing = this._bearingToBike();

    // turning
    w.facing -= steer * DIS.WALK_TURN * d * (assisting ? 0.25 : 1);
    if (Number.isFinite(w.facing)) w.yawOffset = 0; // world yaw derived below

    // speed
    let target = 0;
    if (assisting) target = DIS.WALK_AUTO_SPEED;
    else if (thr && !brake) target = DIS.WALK_SPEED;
    else if (brake) target = -DIS.WALK_SPEED * 0.45;
    w.speed += clamp(target - w.speed, -DIS.WALK_ACCEL * d, DIS.WALK_ACCEL * d);
    if (Math.abs(w.speed) < 0.02) w.speed = 0;

    // Move along the world facing, then project back into the road frame. This
    // is what keeps the walker on the road's own elevation: (s, lateral) is the
    // frame the road is defined in.
    const fwdS = -Math.cos(w.facing);
    const fwdL = Math.sin(w.facing);
    w.s += w.speed * fwdS * d;
    w.lateral += w.speed * fwdL * d;
    this._clampToWorld(w);

    if (dist <= DIS.MOUNT_RANGE || this.total >= DIS.HARD_FOOT_CAP) {
      this._enter(ST.MOUNTING);
    }
  }

  // ---- MOUNTING: a short leg-over, then riding ---------------------------------
  _stepMounting(d) {
    this._stepBike(d);
    if (this.t >= DIS.MOUNT_TIME) this._finishMount();
  }

  // -------------------------------------------------------------------------
  // The bike's own slide, in the road frame. It is the whole reason the bike and
  // the rider can separate: this runs whether or not the rider is even upright.
  // -------------------------------------------------------------------------
  _stepBike(d) {
    const w = this.walk;
    if (w.bikeStopped) return;
    w.bikeSpeed -= Math.sign(w.bikeSpeed) * Math.min(Math.abs(w.bikeSpeed), DIS.BIKE_FRICTION * d);
    w.bikeLateralV -= Math.sign(w.bikeLateralV) * Math.min(Math.abs(w.bikeLateralV), DIS.BIKE_SIDE_FRICTION * d);
    w.bikeYawRate *= (1 - d * DIS.BIKE_SPIN_DAMP);
    w.bikeYawOffset += w.bikeYawRate * d;
    w.bikeS += w.bikeSpeed * d;
    w.bikeLateral += w.bikeLateralV * d;
    this._clampToWorld(w);
    if (Math.abs(w.bikeSpeed) < DIS.BIKE_STOP && Math.abs(w.bikeLateralV) < DIS.BIKE_STOP) {
      w.bikeSpeed = 0; w.bikeLateralV = 0; w.bikeStopped = true;
    }
  }

  // Keep both road-frame bodies on the tarmac and inside the rail. The rider can
  // be flung into the verge but is walked back toward the road, because a walker
  // 30 m out in the scrub can never reach the bike and the whole mechanic dies.
  _clampToWorld(w) {
    const half = CFG.ROAD_W / 2;
    const rail = half + CFG.KERB_W + 0.9;
    if (Math.abs(w.lateral) > rail) { w.lateral = Math.sign(w.lateral) * rail; w.lateralV = 0; }
    if (Math.abs(w.bikeLateral) > rail) { w.bikeLateral = Math.sign(w.bikeLateral) * rail; w.bikeLateralV = 0; }
    // A gentle pull from the verge back toward the tarmac. Weak deliberately: it
    // must not fight the player's own steering, only prevent a stranded walk.
    if (Math.abs(w.lateral) > half) w.lateralV -= Math.sign(w.lateral) * 3.2 * 0.016;
    // Nothing may leave here non-finite. §5.6: a NaN in a physics value reaches
    // the audio graph and the renderer and takes the frame down.
    for (const k of ['s', 'lateral', 'speed', 'lateralV', 'bikeS', 'bikeLateral',
                     'bikeSpeed', 'bikeLateralV', 'yawOffset', 'yawRate', 'facing']) {
      const v = w[k];
      if (typeof v === 'number' && !Number.isFinite(v)) w[k] = 0;
    }
  }

  _distToBike() {
    const w = this.walk;
    const ds = w.s - w.bikeS;
    const dl = w.lateral - w.bikeLateral;
    return Math.hypot(ds, dl);
  }

  _bearingToBike() {
    const w = this.walk;
    const ds = w.bikeS - w.s;                 // + = bike is further up the road
    const dl = w.bikeLateral - w.lateral;
    // world direction: forward is -z as s rises, right is +lateral
    return Math.atan2(dl, -ds);
  }

  _enter(state) {
    this.state = state;
    this.t = 0;
  }

  // Hand control back to the bike. The rider is standing at the machine, so the
  // machine's own rest position becomes the new riding position — which is why
  // walking somewhere and remounting actually moves the race along.
  _finishMount() {
    const p = this.player.phys;
    const w = this.walk;
    p.s = w.bikeS;
    p.lateral = w.bikeLateral;
    p.yawOffset = w.bikeYawOffset;
    p.speed = Math.max(2.5, Math.abs(w.bikeSpeed));   // the push-start handles the rest
    p.lateralV = 0;
    p.yawRate = 0;
    p.lean = 0;
    p.steer = 0;
    p.airY = 0; p.airVY = 0;
    p.sync();

    const f = this.player.fighter;
    if (f) { f.down = false; f.downTimer = 0; f.invuln = CFG.INVULN_AFTER; }

    // Back on the machine: hand the rider back to the saddle socket FIRST, so the
    // very frame control returns, the rider is a child of the bike again and
    // Player.applyVisual's riding pose has the chain it expects.
    this._setRidingRig(true);

    // ...the module relinquishes the pose so Player's own riding pose drives
    // again from this frame.
    this.state = ST.RIDING;
    this.t = 0;
    this.total = 0;
  }

  // -------------------------------------------------------------------------
  // RENDERING. Player.applyVisual calls this while onFoot.
  //
  // The group is anchored to the RIDER (player.phys is the walker), so the
  // rider is at the group origin and the BIKE is the child at an offset. The
  // offset is the inverse of the group's own yaw-only transform.
  /**
   * Re-parent the rider between the two rigs it lives in.
   *
   * RIDING:  group -> bike -> socket -> rider   (the saddle is the parent)
   * ON FOOT: group -> rider                     (the rider IS the body)
   *
   * This is the connection fix. The rider used to stay parented to the movable
   * bike group for the whole on-foot sequence, so every write this module makes
   * to `rider.position` -- which it intends as ROAD space, because the walker is
   * the subject -- was actually applied in the BIKE's frame. The bike slides and
   * spins while the player walks, so the walker was carried along by a machine he
   * is supposed to have left behind: that is the "why is the bike moving when he
   * is walking" defect, and it is a parenting bug, not a numbers bug.
   *
   * `attach`-style: the rider's world transform is preserved across the change,
   * so there is no pop at the instant of the swap. three.js expresses this as
   * `Object3D.attach` (re-parent while keeping world transform); the mount
   * direction is a plain `add` because the socket's local seat offset is exactly
   * where the pelvis should be, which is the whole point of having a socket.
   */
  _setRidingRig(riding) {
    const player = this.player;
    const rider = player.rider;
    if (!rider) return;
    const socket = player.socket;
    if (riding) {
      if (socket) {
        socket.add(rider);              // child of the saddle
        rider.position.set(0, 0, 0);
        rider.rotation.set(0, 0, 0);
      }
    } else if (rider.parent !== player.group) {
      // Preserve the world transform on the jump so the first on-foot frame is
      // continuous with the last riding frame.
      player.group.attach(rider);
    }
  }

  // -------------------------------------------------------------------------
  render(dt) {
    if (!this.onFoot) return;   // _finishMount may have run earlier this frame
    const player = this.player;
    const p = player.phys;
    const w = this.walk;
    const bike = player.bike;
    const rider = player.rider;

    // THE RIDER MUST BE ON THE GROUP WHILE ON FOOT, not on the bike's socket.
    // See _setRidingRig: parenting the walker to the bike is why the bike
    // appeared to move him while he walked. Idempotent, so calling it every frame
    // is safe and a missed transition cannot leave the wrong parent.
    this._setRidingRig(false);

    // The group carries the rider. Write the rider body back into phys so the
    // camera, the HUD and the harness all continue to read one source of truth.
    p.s = w.s;
    p.lateral = w.lateral;
    p.yawOffset = (this.state === ST.WALKING)
      ? this._wrap(w.facing - roadYawAt(w.s))
      : (this.state === ST.MOUNTING ? w.bikeYawOffset : w.yawOffset);
    p.speed = this.state === ST.WALKING ? w.speed : 0;
    p.lateralV = 0;
    p.lean = 0;
    p.airY = w.airY;
    p.wheelSpin = 0;
    p.sync();

    // group at the rider. `airY` lifts the whole person during the tumble — the
    // same channel the bike uses for a jump, so it is already understood by
    // everything downstream.
    player.group.position.copy(p.pos);
    player.group.position.y += w.airY;

    if (bike) {
      // --- the bike body, placed in world then expressed in the group's frame ---
      roadToWorld(w.bikeS, w.bikeLateral, _p);
      const yaw = roadYawAt(w.bikeS) + w.bikeYawOffset;
      _c.copy(_p).sub(player.group.position);
      const gy = p.yaw;
      bike.position.set(
        Math.cos(gy) * _c.x - Math.sin(gy) * _c.z,
        _c.y,
        Math.sin(gy) * _c.x + Math.cos(gy) * _c.z);
      // 'YXZ' MANDATORY. A bare rotation.set(0, y, 0) resets the Euler ORDER to
      // the default XYZ, silently undoing the order player.js establishes for the
      // bike. It runs on every remount, so it wiped the fix within seconds of a
      // crash -- the bike would pitch correctly until you fell off, then never
      // again. Always pass the order explicitly when you touch this node.
      bike.rotation.set(0, yaw - gy, 0, 'YXZ');
      // A CRASHED BIKE LIES OVER. The line below used to set `rotation.z = 0`
      // whenever the bike was crashed -- the exact opposite of its own comment --
      // so a fallen machine stood bolt upright on the road and read as riding
      // away from the rider it had just thrown. Measured in the wreck capture:
      // bike upright, rider prone beside it.
      //
      // While it is down it is on its side; once the player is back on his feet
      // and walking to it, it is still down but righting; and only on the mount
      // does it come upright.
      const crashed = this.state === ST.FALLING || this.state === ST.DOWN;
      const walking  = this.state === ST.WALKING || this.state === ST.STANDING;
      const lean = walking ? 1.15 : 1.35;
      if (this.state === ST.MOUNTING) {
        // heaving it upright as he climbs on: the lean goes out as the mount
        // progresses, so the machine meets him already on its wheels
        const k = easeInOut(this.t / DIS.MOUNT_TIME);
        bike.rotation.z = lean * (1 - k);
      } else {
        // FALLING / DOWN / STANDING / WALKING: it is over, and it stays over
        // until he picks it up.
        bike.rotation.z = lean;
      }

      // ---- THE MACHINE MUST NOT SINK INTO THE ROAD -------------------------
      // Its origin is at WHEEL-CONTACT height, so rolling it about that origin
      // swings the low-side wheel BELOW the surface. MEASURED pinned in the DOWN
      // state: the bike's box floor read -0.231 m against the road, i.e. the
      // whole near side was 23 cm under the tarmac.
      //
      // Same treatment as the rider above, for the same reason: measure the real
      // world box and lift by the gap. Only while it is actually over -- upright
      // it sits correctly on its contact plane and measuring would fight the
      // riding pose.
      if (bike.rotation.z > 0.01) {
        player.group.updateMatrixWorld(true);
        this._bikeBox.setFromObject(bike);
        const gap = this._bikeBox.min.y - player.group.position.y;
        if (Number.isFinite(gap) && gap < 0) bike.position.y -= gap;
      }
      const j = bike.userData && bike.userData.joints;
      if (j) {
        if (j.frontSteer) j.frontSteer.rotation.y = 0;
        if (j.frontWheel) j.frontWheel.rotation.x = 0;
        if (j.rearWheel) j.rearWheel.rotation.x = 0;
      }
    }

    if (rider) {
      const j = rider.userData && rider.userData.joints;
      if (this.state === ST.MOUNTING) {
        this._renderMounting(rider, j);
      } else {
        // PRONE PLACEMENT -- MEASURED, NOT PREDICTED.
        //
        // The rider's origin is his FEET, so rotating the body about its feet by
        // a prone angle stands it on its face instead of laying it down. The body
        // has to rotate about a point near its centre and then be lowered until
        // it rests on the road.
        //
        // Computing that in closed form from the spine was tried and is WRONG:
        // it ignores the body's width and depth (a prone 1.75 m figure is ~1.28 m
        // tall, not the 0.12 m a landmarks-only model predicts), and three.js
        // measured that version at -0.202 .. 1.073 -- a fifth of a metre sunk
        // through the tarmac with the rest standing a metre up.
        //
        // So the drop is MEASURED, below, from the body's real world bounding box.
        // Exact for any figure, pose or future limb change, because it reads the
        // geometry rather than predicting it.
        const spec = player.rider && player.rider.userData && player.rider.userData.spec;
        const proneness = this.state === ST.FALLING
          ? easeInOut(this.t / Math.max(0.01, DIS.FALL_TIME))
          : (this.state === ST.DOWN ? 1 : 0);
        const pivotY = spec ? spec.pronePivotY : CFG.SEAT_Y;
        // raise the body so its rotation centre (mid-torso) is at the origin;
        // `_proneFix` below then measures and lowers it onto the road
        rider.position.set(0, pivotY * proneness, 0);
        // Practice the body's pitch through the sequence: upright -> tumbling
        // forward onto the face -> held prone -> rising back to vertical. One
        // value, read by one rotation, so there is no state where two of them
        // disagree about how far over the body is.
        let bodyX;
        if (this.state === ST.FALLING) {
          bodyX = easeInOut(this.t / Math.max(0.01, DIS.FALL_TIME)) * DIS.DOWN_ROLL;
        } else if (this.state === ST.DOWN) {
          bodyX = DIS.DOWN_ROLL;
        } else {
          bodyX = 0;   // STANDING / WALKING: upright
        }
        // EULER ORDER MATTERS, and this is the third place in this project it
        // has bitten. The default is XYZ, which composes R = Rx * Ry * Rz, so
        // the ROLL is applied FIRST in the body's own frame and the PITCH is
        // applied after. The result of stacking a 51-degree tumble roll onto an
        // 86-degree prone pitch that way is a body lying on its BACK with its
        // legs in the air -- which is exactly what the wreck looked like, and it
        // is not a pose any fall produces.
        //
        // YXZ is what a falling body needs: yaw to face the direction of travel,
        // then pitch to go prone, then roll about the now-horizontal axis to
        // tumble onto a shoulder. Verified against the world matrix, not by eye.
        rider.rotation.set(bodyX, w.facing - p.yaw, w.roll, 'YXZ');

        // ---- MEASURE, THEN PLACE ------------------------------------------
        // The pose is now final for this frame, so the body's world bounding box
        // is meaningful. Lower it so its lowest point sits ON the road. This is
        // the step that makes the wreck lie flat instead of hovering or sinking,
        // and it holds for any figure because it reads the geometry.
        //
        // Only while he is actually going over. Standing and walking he is on his
        // feet at the group origin, and measuring there would fight the walk.
        if (proneness > 0) {
          player.group.updateMatrixWorld(true);
          this._proneBox.setFromObject(rider);
          // world Y of the group is the road; the rider's box is in world space,
          // so the correction is the gap between the box floor and the group
          const gap = this._proneBox.min.y - player.group.position.y;
          if (Number.isFinite(gap)) {
            // ease the correction in with `proneness` so the fall does not snap
            rider.position.y -= gap * proneness;
          }
        }

        if (j) this.poseOnFoot(j, dt);
      }
    }
  }

  _renderMounting(rider, j) {
    const w = this.walk;
    const k = easeInOut(this.t / DIS.MOUNT_TIME);
    // Standing beside the machine, rising onto it. The rider's local y goes from
    // the standing offset (its own feet) up to the SOCKET's height, so the rise
    // lands the body's SEAT CONTACT on the saddle the riding rig expects -- the
    // old hard-coded 0.62 was a second, independent seat height that happened to
    // be near SEAT_Y and would silently disagree with it if either changed.
    //
    // The target is the socket's height, NOT SEAT_Y: the rider's origin is its
    // FEET, and the socket carries it `seatContactY` below the saddle so the
    // pelvis underside meets the seat. Ending the rise at SEAT_Y would leave the
    // body standing on the saddle for the last frame before the hand-off.
    const seatY = CFG.SEAT_Y - (this.player._seatContactY || 0);
    rider.position.set(0, DIS.STAND_Y * (1 - k) + seatY * k, 0);
    rider.rotation.set(0, w.bikeYawOffset - this.player.phys.yaw, 0);
    if (j) this.poseMount(j, k);
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

  poseMount(j, k) {
    clearAxes(j);
    const g = GAIT;
    const rot = (n, x, y, z) => {
      if (!n || !n.rotation) return;
      if (x !== undefined) n.rotation.x = x;
      if (y !== undefined) n.rotation.y = y;
      if (z !== undefined) n.rotation.z = z;
    };
    // one leg swings over the saddle, the body drops onto it
    rot(j.torso, -0.55 * k);
    rot(j.neck, 0.32 * k);
    const la = j.leftArm, ra = j.rightArm;
    if (la) { rot(la.upper, -1.12 * k + (1 - k) * g.armDown, undefined, 0.28 * k + (1 - k) * g.armOut); rot(la.elbow, -0.52 * k + (1 - k) * g.elbowBend); }
    if (ra) { rot(ra.upper, -1.12 * k + (1 - k) * g.armDown, undefined, -0.28 * k - (1 - k) * g.armOut); rot(ra.elbow, -0.52 * k + (1 - k) * g.elbowBend); }
    // the swinging leg: right leg goes from standing to on the peg.
    // THE HIP INTERPOLATES, because that is where the difference lives: standing
    // it is `hipStand` (the seated fold undone) and riding it is the rig's own
    // baked `RIDING.hip`. Writing the standing end to `thigh` -- as this did --
    // left the hip folded for the whole mount, so the leg came over the saddle
    // already bent up. `thigh` now carries only the swing-over flourish.
    const ridingHip = RIDING.hip;
    const Ll = j.leftLeg, Lr = j.rightLeg;
    if (Ll) { rot(Ll.hip, g.hipStand * (1 - k) + ridingHip * k); rot(Ll.thigh, 0); rot(Ll.knee, g.kneeStand * (1 - k) + RIDING.knee * k); }
    if (Lr) {
      rot(Lr.hip, g.hipStand * (1 - k) + ridingHip * k);
      rot(Lr.thigh, -Math.sin(k * Math.PI) * g.mountSwing);
      rot(Lr.knee, g.kneeStand * (1 - k) + RIDING.knee * k + Math.sin(k * Math.PI) * 1.1);
    }
    if (j.chain) j.chain.visible = false;
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