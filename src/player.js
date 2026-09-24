// RideRash — the player. Owns a bike, a rider, a fighter, and reads input.
import * as THREE from 'three';
import { BikePhys } from './physics.js';
import { Fighter, ATTACKS } from './combat.js';
import { CFG } from './config.js';
import { cloneWithJoints } from './rigclone.js';
import { mergeJoints } from '../assetlib.js';
// See rivals.js: colour into vertices, the tyre/saddle colour kept separate.
const MERGE_OPTS = { vertexColors: true, allNodes: true, keepColour: (h) => h === 0x1b1b1e };
import { clearAxes, poseSeated, poseCombat, solveSeat } from './riderpose.js';
import { Dismount, ST } from './dismount.js';
import { paintBike } from './kit.js';

// Scratch for the wheelie/stoppie pivot compensation in applyVisual: allocated
// once, because this runs per frame and a Matrix4/Euler per frame is exactly the
// sort of allocation that shows up as GC in a race (see sampleAxles in physics).
const _pivotP = new THREE.Vector3();
const _pivotR = new THREE.Vector3();
const _pivotE = new THREE.Euler();
const _pivotM = new THREE.Matrix4();
const _pivotShift = new THREE.Vector3();

export class Player {
  constructor(scene, assets) {
    this.phys = new BikePhys({ startS: 0, lateral: 0, speed: 8, arcade: true });
    this.fighter = new Fighter(this.phys, { hp: CFG.HP_MAX, hasWeapon: true });

    this.group = new THREE.Group();
    // cloneWithJoints, NOT a bare .clone().
    //
    // THIS LINE IS WHY THE BIKE COULD NOT LEAN, PITCH OR STEER. `Object3D.clone`
    // copies `userData` as plain data, so the asset's joint map -- six live
    // Object3D references -- arrived as six plain Objects with no `.rotation`.
    // `applyVisual` then threw on its FIRST joint write:
    //
    //   TypeError: Cannot set properties of undefined (setting 'y')
    //       at j.frontSteer.rotation.y = p.steer * 0.30
    //
    // and everything after it -- steer, wheel spin, THE LEAN, THE WHEELIE, THE
    // SUSPENSION DIVE -- silently never ran. The rider did exactly this before and
    // was fixed with cloneWithJoints; the bike kept the bare clone, so the bike
    // stayed a rigid statue while the numbers underneath it were perfect. Wheelie
    // was measured at 0.49 rad and lean at -0.72 rad on a machine whose visible
    // attitude never moved. Nothing threw out of the game loop, the bike rendered
    // correctly, and only a still frame of a corner showed it tilting.
    //
    // `cloneWithJoints` re-points the joint map at the CLONE's own nodes by tree
    // path, which is the only way a joint reference survives a clone.
    this.bike = assets.bike ? cloneWithJoints(assets.bike) : null;
    // The BIKE is rigid relative to the group -- no joints, nothing animates
    // within it -- so it can be merged. It is ~30 separate meshes per bike, and
    // with five bikes plus the player that was ~180 draw calls for geometry that
    // never moves relative to itself. The RIDER is NOT merged: it is a jointed
    // skeleton and merging it would collapse the hierarchy and destroy the
    // animation, which is exactly the trap assetlib warns about.
    if (this.bike) {
      // MERGE WITHIN THE JOINTS, NOT ACROSS THEM.
      //
      // This used to call `bakeStatic`, which is `mergeByMaterialValues`: it
      // flattens the whole hierarchy into a handful of meshes and DISCARDS
      // `userData`, so the bike's joints vanished. The consequence was silent and
      // total -- `frontWheel.rotation.x = wheelSpin` and
      // `frontSteer.rotation.y = steer` in applyVisual had been writing to
      // undefined since the project began. The wheels never turned. Nothing
      // threw, and a still frame of a bike at 100 mph looks identical either way.
      //
      // `mergeJoints` merges only the meshes BETWEEN the named joints and leaves
      // the joints themselves intact, which is what the rider already does for
      // the same reason. It costs a few more draws than collapsing everything and
      // it is the difference between a bike that steers and a bike that does not.
      try {
        mergeJoints(this.bike, MERGE_OPTS);
      } catch (e) {
        // non-fatal: unmerged is correct, just slower
      }
      this.group.add(this.bike);
    }
    this.rider = assets.rider ? cloneWithJoints(assets.rider) : null;
    if (this.rider) {
      // THE MOUNT SOCKET -- how the rider is CONNECTED to the bike.
      //
      // This used to be a bare `this.rider.position.set(SEAT_X, SEAT_Y, SEAT_Z)`
      // with the rider added to the GROUP, not the bike. That is the whole reason
      // the rider could separate from the machine: three.js composes a node's
      // local matrix as T * R * S (`Object3D.updateMatrix`), so `position` is
      // applied in the PARENT's space and `rotation` turns the node about its own
      // origin. With the rider parented to the group, its seat offset lived in
      // *road* space while the bike's roll lived on the bike node -- two separate
      // transforms that had to be kept in agreement by hand, and were not. The
      // seat was then "fixed" by rotating the offset by the visual lean in
      // applyVisual, which is a hand-rolled duplicate of what a parent transform
      // does for free and still pivots about the wrong origin.
      //
      // A SOCKET removes the second transform entirely. The socket is an empty
      // node parented to the BIKE at the saddle; the rider is parented to the
      // socket at the origin. Bike lean, wheelie pitch and air offset now carry
      // the rider BY CONSTRUCTION -- there is no offset to rotate, no sign to get
      // wrong, and contact cannot break because both bodies share one chain:
      //
      //   group -> bike -> socket -> rider
      //
      // This is the standard attachment pattern (`Object3D.attach` re-parents
      // while preserving world transform; a socket is the declarative form of the
      // same idea, and is what Unity's Child-of constraint and glTF node
      // parenting express). It is the answer to "why are the objects independent
      // instead of connected".
      this.socket = new THREE.Object3D();
      this.socket.name = 'riderSocket';
      // THE SOCKET CARRIES THE BIKE'S INVERSE SCALE, AND THAT WAS THE BUG.
      //
      // The intent was reasonable and the premise was stale. The comment here
      // used to say the rider is loaded with `height: 1.55` so `ASSET` gives it
      // its own scale that must be protected from the bike's. It is not: the
      // rider is loaded with NO height and sits at scale 1.000 (MEASURED), while
      // the bike is scaled to 0.895 to reach 1.25 m. So there was no second scale
      // to protect, and the counter-scale had nothing to cancel.
      //
      // What it did instead was multiply EVERY internal offset of the rider by
      // 1.117 -- including the pelvis's own height. MEASURED in the bike's frame:
      // the pelvis sat at y 1.193 when the saddle top is at 0.875, and the
      // shoulders at 1.79 when the bars are at 1.04. The rider floated 32 cm
      // above his own saddle and his arms could not reach the grips: the closest
      // the hand could get was 1.06 m, against an arm 0.58 m long, which is why
      // the pose read as wrong no matter what the joint angles were.
      //
      // The fix is to stop counter-scaling and to express the seat offset in the
      // units of the node it is attached to -- the BIKE -- which is what a child
      // position already means. One frame, no conversion, nothing to cancel.
      this._bikeScale = this.bike ? this.bike.scale.x : 1;

      // WHERE THE HIP GOES.
      //
      // The socket is a child of the BIKE, so its position is in BIKE-LOCAL
      // units -- the same frame CFG.SEAT_* were measured in. The saddle's height
      // is fixed by the machine (CFG.SEAT_Y); the rider's pelvis underside is
      // fixed by the body (`seatContactY`, above the rider's own origin). The
      // socket's local Y is the only free number, and it must satisfy
      //
      //     socketY + seatContactY = CFG.SEAT_Y
      //
      // THE RIDER'S ORIGIN IS ITS FEET, NOT ITS PELVIS. assets/rider.js
      // normalises by measuring its own vertex box and shifting so `min.y == 0`,
      // so a bare `position = seat` stands the body ON the saddle with the pelvis
      // `hipY` above it -- MEASURED, 0.84 m clear, and wrong by a different
      // amount for every stature because hipY scales with height. Subtracting the
      // body's own seat contact is what makes the correction follow the body.
      this._seatContactY = (this.rider && this.rider.userData.spec)
        ? this.rider.userData.spec.seatContactY : 0;
      // SOLVED, NOT GUESSED: see spec.seatBob in bodyspec.js for the sweep and
      // the measurement. One shared number, so the pack and the player cannot
      // seat differently.
      this._seatBob = (this.rider.userData.spec && this.rider.userData.spec.seatBob) || 0;
      // BIKE-LOCAL UNITS, NO `inv`. This node is a child of the bike, so its
      // position is already in the bike's own frame -- the same frame CFG.SEAT_*
      // were measured in. The rider's body dimension `seatContactY` is in the
      // rider's own metres, and because the socket no longer counter-scales the
      // rider, those two frames are now the SAME: the bike is uniformly scaled
      // and the rider is at 1.0, so one rider-metre is one bike-local metre.
      //
      // (`seatBob` is the measured correction for the posed pelvis; see
      // spec.seatBob.)
      this.socket.position.set(
        CFG.SEAT_X,
        CFG.SEAT_Y - this._seatContactY + this._seatBob,
        CFG.SEAT_Z,
      );
      this.bike.add(this.socket);
      this.socket.add(this.rider);
      this.rider.position.set(0, 0, 0);
      // Hands to the grips and boots to the pegs for THIS body, not the 1.75 m
      // body the table was solved on -- see riderpose.solveSeat.
      this.seatFit = solveSeat(this.rider, this.bike);

      // MERGE THE RIDER TOO. Measured: one rider is 141 meshes, of which 111 are
      // unmerged primitives -- 59 boxes, 31 cylinders, 13 toruses, 8 spheres, 8
      // capsules -- i.e. every hand, boot, pad, disc and grip. `mergeJoints` was
      // only ever called on the BIKE, so the rider kept all of them, and with the
      // player plus five rivals that is 6 * 141 = ~846 draws, which IS the draw
      // budget. The peak was never about the pack being unculled; it was about
      // every rider being made of 141 separate draw calls.
      //
      // Safe for the same reason it is safe on the bike: it merges only meshes
      // that are DIRECT children of a `__part__` joint and leaves the joints
      // themselves intact, so articulation is preserved. Falling back to unmerged
      // on failure is correct, just slower.
      try {
        mergeJoints(this.rider, MERGE_OPTS);
      } catch (e) {
        // non-fatal: unmerged is correct, just 111 more draws
      }
    }
    // SHADOW BUDGET. This used to set `castShadow = true` on EVERY mesh in the
  // group, which is what made the draw budget unachievable: the measured 971 is a
  // SCENE + SHADOW budget (see `_captureStats` in postfx.js), so every mesh that
  // casts costs TWICE -- once in the scene pass, once in the shadow map. With the
  // player plus five rivals that doubled ~50 material-bucketed meshes each.
  //
  // Casting is now limited to meshes big enough to make a legible shadow. A
  // brake disc, a grip or a footpeg is a few centimetres across and, at race
  // speed, its shadow is a sub-pixel smudge that no one can see -- but it costs a
  // full draw call in the shadow pass, every frame. The bounding-sphere radius is
  // the cheap, geometry-derived test; the threshold is set so the bodywork,
  // wheels and limbs still cast, which is the silhouette that reads.
  //
  // `receiveShadow` stays on everything: receiving is free (it is a shader
  // term), and turning it off would make the rider stop darkening under bridges.
  const SHADOW_CAST_MIN_RADIUS = 0.22;
  this.group.traverse((n) => {
    if (!n.isMesh) return;
    n.receiveShadow = true;
    if (!n.geometry) { n.castShadow = false; return; }
    if (!n.geometry.boundingSphere) n.geometry.computeBoundingSphere();
    const r = n.geometry.boundingSphere ? n.geometry.boundingSphere.radius : 0;
    n.castShadow = r >= SHADOW_CAST_MIN_RADIUS;
  });
    this.group.userData.__isPlayer = true;
    // A handle back to this object, for the harness. The scene exposes the
    // player's GROUP (`__isPlayer`) but nothing that reaches the Player itself —
    // and `_walk.mjs` needs to force a crash and interrogate the state machine.
    // Attaching it here keeps that reachability in the file that owns the object
    // rather than adding another global in main.js.
    this.group.userData.__player = this;
    scene.add(this.group);

    this.bikeLean = 0;
    this.wheelie = 0;
    this.shake = 0;
    this.attackShift = 0;
    this.time = 0;

    // The crash/dismount/walk/remount state machine. It owns the rider and the
    // bike transforms for the whole time the player is off the machine; see
    // dismount.js. Constructed here and reset in reset() so a new race can never
    // start with the previous race's on-foot state still on the clock (§5.16).
    this.dismount = new Dismount(this);
    this._wasDown = false;
    // The punishment meter. Accrued in update() on every fall; read and billed
    // by the race loop at the finish. Reset per race in reset().
    this.damage = 0;
  }

  /**
   * Swap in a newly built rider (the character designer's DONE). main.js always
   * called this, but it did not exist, so a designed rider was saved and then
   * never ridden until the page was reloaded. Only called between races, so the
   * dismount machine is never holding the old rider when it goes.
   */
  setRider(src) {
    if (!src || !this.socket) return;
    this.dismount.reset();          // put the old rider back on the saddle first
    const old = this.rider;
    if (old) {
      old.removeFromParent();
      // The merged geometry is unique to this clone; the source asset's is not.
      old.traverse((n) => { if (n.isMesh && /_merged$/.test(n.name)) n.geometry.dispose(); });
    }
    this.rider = cloneWithJoints(src);
    const spec = this.rider.userData && this.rider.userData.spec;
    this._seatContactY = spec ? spec.seatContactY : 0;
    this._seatBob = (spec && spec.seatBob) || 0;
    this.socket.position.set(CFG.SEAT_X, CFG.SEAT_Y - this._seatContactY + this._seatBob, CFG.SEAT_Z);
    this.socket.add(this.rider);
    this.rider.position.set(0, 0, 0);
    this.seatFit = solveSeat(this.rider, this.bike);
    try { mergeJoints(this.rider, MERGE_OPTS); } catch (e) { /* unmerged is correct, just slower */ }
    this.rider.traverse((n) => {
      if (!n.isMesh) return;
      n.receiveShadow = true;
      if (!n.geometry.boundingSphere) n.geometry.computeBoundingSphere();
      n.castShadow = (n.geometry.boundingSphere ? n.geometry.boundingSphere.radius : 0) >= 0.22;
    });
    this.dismount.reset();
  }

  /**
   * Swap the machine under the rider -- the career garage's bike class (src/kit.js
   * BIKE_FOR_TIER) and its colour. Every bike class shares the joint map, the
   * contacts and the hero's scale, so the socket (and the rider on it) moves across
   * unchanged and only the seat IK is re-solved. Between races only, like setRider.
   */
  setBike(src, body, accent) {
    if (!src || !this.bike) return;
    const key = `${src.uuid}:${body}:${accent}`;
    if (this._bikeKey === key) return;
    this.dismount.reset();          // the old bike must be back under the group
    const old = this.bike;
    const bike = cloneWithJoints(src);
    if (body != null) paintBike(bike, body, accent ?? 0xd8d2c4);
    try { mergeJoints(bike, MERGE_OPTS); } catch (e) { /* unmerged is correct, just slower */ }
    bike.position.copy(old.position);
    bike.rotation.copy(old.rotation);
    bike.scale.copy(old.scale);
    if (this.socket) bike.add(this.socket);
    old.removeFromParent();
    old.traverse((n) => { if (n.isMesh && /_merged$/.test(n.name)) n.geometry.dispose(); });
    this.group.add(bike);
    this.bike = bike;
    this._bikeScale = bike.scale.x;
    // same shadow rule as the constructor: only parts big enough to read cast
    bike.traverse((n) => {
      if (!n.isMesh || n === this.rider) return;
      n.receiveShadow = true;
      if (!n.geometry.boundingSphere) n.geometry.computeBoundingSphere();
      n.castShadow = (n.geometry.boundingSphere ? n.geometry.boundingSphere.radius : 0) >= 0.22;
    });
    if (this.rider) this.seatFit = solveSeat(this.rider, this.bike);
    this._bikeKey = key;
    this.group.userData.bikeClass = (src.userData && src.userData.bike && src.userData.bike.kind) || null;
    this.dismount.reset();
  }

  /** Per-race reset: the whole on-foot machine, not a chosen subset. */
  reset() {
    this.dismount.reset();
    this._wasDown = false;
    this.damage = 0;
    this.bikeLean = 0;
    this.wheelie = 0;
    this.shake = 0;
    this.attackShift = 0;
    this.time = 0;
    if (this.bike) {
      this.bike.position.set(0, 0, 0);
      // YXZ, NOT the default XYZ. The bike carries THREE simultaneous rotations:
      // yaw (heading), pitch (wheelie/stoppie) and roll (lean). Euler order is
      // not cosmetic -- it decides which frame the later rotations act in, and
      // XYZ is wrong for a vehicle. XYZ applies roll FIRST, in world axes, so at
      // lean the pitch axis has already been thrown off the bike's own centre
      // line: the machine tips sideways but never noses up or down correctly.
      // MEASURED live: bike.rotation.order was 'XYZ' while the group that
      // contains it was correctly 'YXZ'. YXZ applies yaw, then pitch about the
      // bike's already-turned lateral axis, then roll about its own longitudinal
      // axis, which is the order a real machine's attitudes compose in.
      this.bike.rotation.set(0, 0, 0, 'YXZ');
    }
    // The rider's own local position is the ORIGIN: the seat offset lives on the
    // socket (which is a child of the bike), so restoring the rider to 0 here is
    // what puts it back on the saddle. Writing CFG.SEAT_* into `rider.position`
    // would now DOUBLE the offset -- the exact class of bug the socket removes.
    if (this.rider) { this.rider.position.set(0, 0, 0); this.rider.rotation.set(0, 0, 0); }
  }

  /** What the camera should watch: the bike while riding, the person on foot. */
  get focus() { return this.dismount.onFoot ? this.dismount.focus : this.phys.pos; }

  get onFoot() { return this.dismount.onFoot; }

  get pos() { return this.phys.pos; }
  get speed() { return this.phys.speed; }
  get lateral() { return this.phys.lateral; }

  update(dt, input, world, hooks) {
    const p = this.phys, f = this.fighter;

    // ---- the crash / dismount / walk / remount machine ----------------
    //
    // DETECT THE FALL. `fighter.down` is set by Fighter.knockDown — a punch, a
    // kick, a chain, a hard bike-to-bike contact or a car, all of which go
    // through the same path. The machine starts from that state rather than
    // inventing its own trigger, so every crash in the game leads here.
    if (f.down && !this._wasDown) {
      this.dismount.beginFall({ side: Math.sign(p.lateralV || 0) || 0 });
      // THE PUNISHMENT METER ACCRUES HERE, and only here. Every fall in the game
      // funnels through this transition -- a punch, a car, a wall, a hard
      // bike-to-bike hit -- so one line catches them all rather than four call
      // sites that can drift apart. `state.damage` is what the results screen
      // bills; see career.REPAIR and the HUD meter.
      this.damage = (this.damage || 0) + CFG.CRASH_DAMAGE;
      if (hooks && hooks.onDamage) hooks.onDamage(CFG.CRASH_DAMAGE, 'wreck');
    }
    this._wasDown = f.down;

    // SELF-HEAL AGAINST A MISSING RESET WIRING. `resetRace()` clears
    // `fighter.down` directly. If a race ends while the player was on foot, the
    // machine would otherwise still be mid-walk for the next race and the bike
    // would never move — the §5.16 leak exactly. Rather than depend on the reset
    // call being wired, notice that the fighter is no longer down and stand the
    // machine down. Correct either way, and it costs one comparison.
    if (this.dismount.onFoot && !f.down) {
      this.dismount.reset();        // re-parents, rescales and re-poses the rig
    }

    // WHILE ON FOOT THE MACHINE DRIVES, not the bike integrator.
    //
    // The rider is the physics subject for the whole on-foot sequence: walking
    // writes `phys.s/lateral` directly, so the existing chase camera keeps
    // looking at the person the player is controlling without a camera change.
    // `BikePhys.step` must not run here — its engine and tyres are meaningless
    // for a man on foot, and running both would have two systems writing s.
    if (this.dismount.onFoot) {
      // Hold the fighter down for the whole sequence. Fighter.update would
      // otherwise fire `onRemount` at WRECK_TIME and pop the rider back on the
      // bike in the middle of the walk. The state machine is the only thing that
      // ends a crash now; it clears `f.down` itself in _finishMount.
      if (f.down) f.downTimer = Math.max(f.downTimer, 0.5);
      f.update(dt, world.fightersExcept(this), hooks);
      this.dismount.update(dt, input);
      this.dismount.render(dt);
      this.time += dt;
      return;
    }

    // ---- input to control ----
    // `advance` runs the FIXED-STEP integrator and returns how many substeps ran.
    // The old code called step(dt) with the frame's dt, which made acceleration
    // frame-rate dependent and let a long frame teleport the bike.
    if (!f.down) {
      p.advance(dt, {
        throttle: input.throttle,
        brake: input.brake,
        steer: input.steer,
        tuck: input.tuck,
      });
    } else {
      // no control while down; the bike slides
      p.advance(dt, { throttle: false, brake: false, steer: 0, tuck: false });
    }

    // ---- attacks from real input ----
    // Boost is an input, not an attack: the charge and cooldown live in the
    // integrator, so holding the key does nothing once it is spent.
    if (input.attackPressed('boost')) p.tryBoost();
    if (input.attackPressed('punch')) f.commit('punch');
    if (input.attackPressed('kick')) f.commit('kick');
    if (input.attackPressed('chain')) f.commit('chain');
    // G grabs; G again mid-hold throws. While HELD, every attack key struggles
    // (Fighter.commit routes them), so mashing is the counter.
    if (input.attackPressed('grapple')) f.commit('grapple');

    f.update(dt, world.fightersExcept(this), hooks);

    this.applyVisual(dt);
    this.time += dt;
  }

  applyVisual(dt) {
    const p = this.phys, f = this.fighter;
    this.group.position.copy(p.pos);
    // Turn about the REAR contact, not the middle: see BikePhys.rearPivotShift.
    this.group.position.add(p.rearPivotShift(_pivotShift));
    // YXZ: yaw first, then pitch about the already-yawed axis, then roll. The
    // default XYZ order would apply the road pitch in world X, so on any road
    // that is not pointing down Z the bike would tip sideways instead of
    // nodding over a crest. `roadPitch` is the two-point sample from
    // BikePhys.sampleAxles -- see physics.js for why it is not folded into yaw.
    this.group.rotation.set(p.roadPitch || 0, p.yaw, 0, 'YXZ');

    if (this.bike) {
      const j = this.bike.userData.joints;
      if (j) {
        // TEST `.rotation`, NOT JUST THE JOINT. A joint whose map survived but
        // whose node did not is a plain Object with no `.rotation`, and writing
        // through it THROWS -- which killed every line of pose code below this
        // block, silently, for the whole project. Guarding on the property that
        // is about to be written is the difference between a missing wheel spin
        // and a machine that cannot lean. See the cloneWithJoints note above.
        // THE FRONT WHEEL IS TURNED TO THE REAL STEER ANGLE, not to a fraction of
        // the bar level. `p.steerAngle` is the bicycle model's `delta` in radians
        // -- the angle the front contact patch actually holds -- so the wheel's
        // visual yaw IS the physical steering, at every speed. It used to be
        // `p.steer * 0.30`: a fixed fraction of the input, which over-turned at
        // speed (where the real angle is 2 degrees) and under-turned at a crawl.
        if (j.frontSteer && j.frontSteer.rotation) j.frontSteer.rotation.y = p.steerAngle || 0;
        if (j.frontWheel && j.frontWheel.rotation) j.frontWheel.rotation.x = p.wheelSpin;
        if (j.rearWheel && j.rearWheel.rotation) j.rearWheel.rotation.x = p.wheelSpin;
      }
// lean: the bike leans with the steer. The visual roll is DAMPED relative to
  // the physics lean and follows a curve, so a gentle steering input reads as
  // leaning and only a hard corner commits the bike.
  //
  // THE SIGN IS POSITIVE, AND IT WAS NEGATIVE. The bike's MODEL FACES +Z locally
  // (physics.js `forward = (sin yaw, 0, cos yaw)`; the road is traversed toward
  // -Z, but the model's nose is +Z). For a +Z-facing object under three.js's
  // right-handed X rotation, a POSITIVE `rotation.z` tips local +Y toward local
  // +X -- which is the rider's RIGHT, because the chase camera looks down -Z and
  // screen-right is world +X.
  //
  // MEASURED in the live scene, camera fixed: `rotation.z = -0.4` tips the bike's
  // up-vector to `(-0.39, 0.92, 0.03)` -> SCREEN LEFT; `rotation.z = +0.4` tips it
  // to `(+0.39, 0.92, 0.03)` -> SCREEN RIGHT. And steering RIGHT produced
  // `rotation.z ≈ -0.37`, i.e. the bike moved right and banked LEFT: the machine
  // fell toward the outside of every corner. The translation was always correct;
  // only the roll was mirrored.
  //
  // So this is the physics lean used directly, with only the damping and the
  // speed curve applied -- no sign flip. `p.lean` is already positive for a
  // right-hand turn (physics.js: `targetLean = steer * LEAN_MAX`, and `steer` is
  // +1 when the right key is down).
  const leanVis = Math.tanh(p.lean * 1.25) * 0.72;
  const targetLean = leanVis * (0.55 + 0.45 * Math.min(1, p.speed / 28));
  this.bikeLean += (targetLean - this.bikeLean) * Math.min(1, dt * 8);
  this.bike.rotation.z = this.bikeLean;
      // AIRBORNE AND WHEELIE POSE. `airY` lifts the whole rider+bike group off
      // the road surface; `wheelie` pitches the bike (positive = nose up,
      // negative = stoppie). Both come straight off the integrator -- the
      // renderer invents neither.
      //
      // THE PITCH PIVOT IS THE CONTACT PATCH, NOT THE BIKE'S ORIGIN.
      //
      // The bike's origin is the MIDDLE of the wheelbase, at road level, so
      // rotating it there swings BOTH ends: MEASURED at wheelie 0.41 rad the rear
      // wheel went 0.271 m UNDER the tarmac while the nose lifted by the same.
      // A wheelie lifts the front about the REAR contact and a stoppie drops the
      // nose about the FRONT contact; the planted wheel must not move. That is
      // the same "rotate about the wrong origin" trap as the socket and the
      // prone pose, and this is its fourth appearance.
      //
      // Compensate by translating the bike so the chosen pivot maps to where it
      // sat before the rotation. The TRS order is T*R*S, so a pivot P maps to
      // `pos + R*S*P`; keeping that equal to `S*P` gives `pos = S*P - R*S*P`.
      // Done against the bike's REAL quaternion (lean is in there too, and the
      // contact line is invariant under lean, so any point on it is a valid
      // pivot for the pair of rotations).
      this.group.position.y += p.airY || 0;
      // NO ALWAYS-ON ACCELERATION PITCH. This used to add a constant -0.03 rad
      // (1.7 degrees) of nose-up whenever `inputHardish()` was true -- and that
      // helper returns true unconditionally, so the bike was permanently tipped.
      // A pitch is a rigid rotation of a machine whose two wheels must both stay
      // on the road, so any constant tilt lifts one wheel: MEASURED, a permanent
      // 0.04 m of daylight under the front tyre. A real acceleration squat
      // compresses the rear shock with the wheel still planted, which a rigid
      // body cannot express, so the honest choice for road contact is not to
      // tilt the machine at all when there is no wheelie or stoppie.
      // PITCH IS THREE REAL EFFECTS, NOT ONE POSE.
      //
      // `roadPitch` on the group is the machine following the road (a two-point
      // sample, done in physics.js). The two terms below are the machine's own
      // attitude relative to that surface, and both come from state the
      // integrator already maintains -- nothing here is invented for looks:
      //
      //   1. WHEELIE / STOPPIE -- the weight-transfer pitch. Already real: it
      //      falls out of `loadFracFront`, and while the front is light there is
      //      nothing to steer with, so it changes handling.
      //   2. SUSPENSION SQUAT AND DIVE -- `suspFront` and `suspRear` are metres
      //      of compression, integrated as a damped spring every step. They were
      //      COMPUTED AND NEVER DRAWN: the bike was a rigid slab that ignored its
      //      own suspension. A bike that accelerates without its rear squatting
      //      and brakes without its nose diving reads as a sliding model, which
      //      is exactly the complaint. The difference between the two ends is a
      //      real pitch angle: atan2(delta, wheelbase).
      //
      // The two are added, not blended: suspension acts about the contact
      // patches below the wheelie, so they compose. Order matters and is handled
      // by the pivot compensation below.
      const suspPitch = Math.atan2((p.suspRear || 0) - (p.suspFront || 0), CFG.WHEELBASE);
      const pitchX = Math.sin(p.wheelSpin * 0.5) * 0.001 - (p.wheelie || 0) + suspPitch;
      this.bike.rotation.x = pitchX;
      {
        // wheelie (+ve nose up -> rotation.x negative) plants the REAR contact;
        // a stoppie plants the FRONT. Local +z is forward (the asset faces +z).
        const halfWB = CFG.WHEELBASE * 0.5;
        const pz = (pitchX <= 0 ? -halfWB : halfWB) * this._bikeScale;
        _pivotP.set(0, 0, pz);
        // Use the NODE'S OWN Euler order, so the compensation matches the matrix
        // the renderer will actually build for the bike.
        _pivotE.set(this.bike.rotation.x, this.bike.rotation.y, this.bike.rotation.z,
                    this.bike.rotation.order);
        _pivotM.makeRotationFromEuler(_pivotE);
        _pivotR.copy(_pivotP).applyMatrix4(_pivotM);
        this.bike.position.copy(_pivotP).sub(_pivotR);
      }
    }

    if (this.rider) {
      const j = this.rider.userData.joints;
      if (j) {
        if (f.down) {
          // The one frame between the knockdown and the dismount taking over.
          // Hold the riding pose: the ragdoll is measured off this rig next
          // frame, and a scripted slump here (it was a -1.45 rad pitch in the
          // socket) would launch a body already folded backwards.
          this.rider.position.set(0, 0, 0);
        } else {
          // THE RIDER LEANS WITH THE BIKE, BY CONSTRUCTION.
          //
          // There is no rotated seat offset here any more. Parented to the socket
          // on the bike, the rider already inherits the bike's roll, pitch and
          // rise exactly; this line adds only the small extra BODY lean a rider
          // puts in on top of the machine. Because the socket sits at the saddle
          // and the rider's origin is the pelvis, that lean turns the torso about
          // the contact patch -- the hips stay planted on the seat no matter how
          // far over the bike is, which is the "humans sitting in contact with the
          // bike when the bike tilts" bar.
          this.rider.position.set(0, 0, 0);
          this.rider.rotation.set(0, 0, this.bikeLean * 0.18);
          this.poseRider(j, f);
        }
      }
    }
  }

  poseRider(j, f) {
    if (!j) return;
    // Rest pose first, and COMPLETE -- see clearMotionAxes.
    clearAxes(j);
    const spd = this.phys.speed;
    const tuck = Math.min(1, spd / 45);
    const rot = (node, x, y, z) => {
      if (!node || !node.rotation) return;
      if (x !== undefined) node.rotation.x = x;
      if (y !== undefined) node.rotation.y = y;
      if (z !== undefined) node.rotation.z = z;
    };

    // THE POSE IS ONE SOLVED SET, BLENDED BY SPEED -- src/reach.js.
    //
    // Torso, shoulders and elbows are solved TOGETHER against the bars
    // (harness/_torsoarm.mjs): the reach is a property of all three, and solving
    // the arm alone against a fixed torso is exactly how the hand ends up 20 cm
    // short of the grip. So they are all interpolated between the UPRIGHT rest
    // lean and the full racing crouch by the same `tuck`, which keeps the fit at
    // every speed instead of only at the one the solver ran at.
    // The solved seat -- torso, arms to the grips, legs to the pegs -- blended
    // by speed. ONE implementation for the player, the pack and the showroom:
    // see riderpose.poseSeated for the rival hand drift this closed.
    poseSeated(j, tuck);

    // ---- attack poses ----
    //
    // These were three hand-written sine curves. They are now sampled from the
    // baked tables in motions.js, which came out of Motion Diffusion Model and
    // were retargeted onto this rider's joints. See that file's header for why
    // a keyframe table is code and not a forbidden data file.
    //
    // THE REST POSE IS SET ABOVE AND THE MOTION IS ADDED TO IT. Every number in
    // the table is a DELTA, because MDM animates a standing figure and this
    // rider is seated: `arms to the bars` above puts him on the bike, and the
    // punch is the CHANGE a punch makes to that. Assigning absolute angles here
    // would stand him up on the tank.
    // Attacks, the grab, the hold and the chain: one layer shared with the
    // pack and the showroom (riderpose.poseCombat). The chain's travelling-wave
    // whip used to be written here only, so no rival's chain ever moved.
    //
    // RECOIL AND SWAY GO FIRST. poseCombat re-solves every limb by IK from the
    // torso as it stands, so anything that moves the torso must happen BEFORE
    // it. They used to be written after, which moved the shoulders after the
    // hands had been put on the grips: MEASURED 1-3 cm of fist drift off the
    // bars on every frame of idle sway and more through a recoil.
    if (f.hitFlash > 0 && j.torso) {
      const r = f.hitFlash / 0.22;
      // a lean BACK from the seated rest (positive x leans forward); the old
      // absolute -0.55 threw the rider 0.85 rad off the bars on every hit
      rot(j.torso, j.torso.rotation.x - r * 0.35, undefined, j.torso.rotation.z + Math.sin(this.time * 60) * r * 0.06);
    } else if (j.torso) {
      rot(j.torso, undefined, undefined, j.torso.rotation.z + Math.sin(this.time * 2.6) * 0.015 * (1 - tuck * 0.7));
    }
    poseCombat(j, f, this.phys, this.time, ATTACKS);
  }
}