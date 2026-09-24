// RideRash — the physics package.
//
// WHAT THIS REPLACES, AND WHY. The original model integrated everything with the
// frame's dt: acceleration, lateral position and yaw all advanced by whatever
// milliseconds the last frame took. That is fine at 60 fps and wrong everywhere
// else, and it is wrong in a way players feel rather than see:
//
//   - At 144 fps the bike accelerates ~2.4x slower per second than at 60 fps,
//     because acceleration was applied per FRAME, not per second.
//   - A single long frame (a GC pause, a tab switch) teleports the bike through
//     the road.
//   - Handling is not reproducible: the same inputs produce a different race on
//     different hardware, which also makes the gate's measurements meaningless.
//
// The fix is a FIXED-TIMESTEP accumulator: simulate at a constant 1/120 s and let
// rendering run at any rate, interpolating the visual state. This is what every
// racing game does and it is the single change that makes the handling feel like
// a vehicle rather than like a cursor.
//
// ON TOP OF THAT sits a real tyre model: a slip-angle curve with a linear region,
// a peak and a falloff, giving grip that is high when the bike is pointed where
// it is going and progressively lower as it slides. That is what produces the
// behaviour a bike game needs — the rear stepping out under power, the front
// pushing when you turn in too fast, and a real reason to lean before you steer.

import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, centreTangent, headAt } from './level.js';

const CFG_ROAD_W_HALF = CFG.ROAD_W / 2;
// THE EDGE MOVES (lanes.js): the tarmac edge on the side a body is on, at its
// distance. Open at a crossroads, where the cross road's deck is tarmac too.
import { edgeAt, crossingNear } from './lanes.js';
function edgeFor(s, lateral) {
  const e = edgeAt(Math.max(0, s || 0), lateral >= 0 ? 1 : -1);
  // a little extra room at a crossroads (no kerb or rail there), not so much
  // that leaving it snaps a rider back onto the road
  return crossingNear(s, 5.5) ? e + 3 : e;
}
const CFG_KERB_W = CFG.KERB_W;

// ---------------------------------------------------------------------------
// Tunables. Grouped here rather than in config.js because they are only
// meaningful together: these numbers describe one vehicle.
// ---------------------------------------------------------------------------
export const PHYS = {
  FIXED_DT: 1 / 120,          // the simulation timestep
  MAX_SUBSTEPS: 8,            // never simulate more than this per frame
  INTERP: true,               // interpolate visuals between physics states

  MASS: 245,                  // kg, bike + rider
  WHEELBASE: 1.40,            // m
  CG_HEIGHT: 0.62,            // m, centre of mass above the contact patch
  WHEEL_R: 0.31,              // m
  INERTIA_YAW: 62,            // kg m^2, resistance to changing heading

  // Engine: a torque curve, not a constant. Bikes make little torque at the
  // bottom and the most in the midrange, which is why a real one has to be
  // revved. revFrac is 0..1 across the usable band.
  ENGINE_PEAK: 2100,          // N of thrust at peak
  ENGINE_CURVE: [             // [revFrac, multiplier] — piecewise linear
    [0.00, 0.35],
    [0.18, 0.72],
    [0.42, 1.00],
    [0.68, 0.94],
    [0.86, 0.74],
    [1.00, 0.44],
  ],
  REDLINE_FRAC: 1.0,
  DRAG_AREA: 0.62,            // Cd*A, m^2 — with air density gives the top end
  AIR_DENSITY: 1.225,
  ROLL_RESIST: 0.018,         // coefficient, so rolling force = c * mass * g
  GRAVITY: 9.81,
  BRAKE_FORCE: 6200,          // N at full lever

  // Tyres. slipAngle in radians; the curve returns a lateral force multiplier.
  // PEAK SIDE FORCE AS A FRACTION OF VERTICAL LOAD -- i.e. lateral g.
  //
  // This was 9.4, and the units were the problem: `tyreForce` returns
  // `m * loadN`, so at the peak slip angle the tyre was making **9.4 times the
  // weight on it** in side force. A real motorcycle tyre makes about 1.2-1.4x
  // its vertical load; 9.4 is not a grippy tyre, it is a rocket.
  //
  // MEASURED with harness/_trace.mjs, no steering input: any slip angle at all
  // threw the bike sideways at up to 16 m/s, `yawOffset` reached 0.62 rad, and
  // the bike bounced between the two barriers with speed collapsing from 41 m/s
  // to 10. That is the "there is no friction, the motion is all wrong" report:
  // the tyres had far too much grip, not too little, so the bike was never
  // tracking -- it was being flung by its own cornering force.
  TYRE_LAT_PEAK: 1.35,        // D / Fz -- the peak friction coefficient
  // THE MAGIC FORMULA PARAMETERS. See the derivation above `tyreForce()`.
  //
  // The old function was piecewise LINEAR: a straight ramp to the peak and a
  // straight line down after it. It had the right qualitative shape and was wrong
  // at the one place that matters, the PEAK, because a kink there is a
  // discontinuity in CORNERING STIFFNESS -- the derivative of force with respect
  // to slip, which is what the whole lateral dynamics are made of. The bike
  // snapped at the limit instead of going progressively loose, and no tuning
  // could remove it because it was the shape of the curve.
  //
  // Pacejka's Magic Formula is smooth everywhere:
  //
  //     y(x) = D · sin{ C · arctan[ Bx − E·(Bx − arctan(Bx)) ] }
  //
  // Each factor does one job, which is why the formula is used at all:
  //   D  peak value (the friction coefficient), set by TYRE_LAT_PEAK
  //   C  shape factor -- where the peak sits and how the curve leaves the origin
  //   B  stiffness factor -- and CORNERING STIFFNESS AT ZERO SLIP IS EXACTLY B·C·D
  //   E  curvature factor -- just under 1 rounds the peak, so the slide is
  //      progressive rather than arriving all at once
  TYRE_SHAPE_C: 1.60,         // C
  // (E is not a tunable -- it is solved below from the three meaningful numbers,
  //  because choosing it independently is how the parameterisation stops closing.)
  // C IS NOT FREE, and picking it wrong is how this model went wrong the first
  // time. For a given peak slip angle and a given cornering stiffness, the
  // shape only closes for C >= ~1.6. Worked through in harness/_tyreshape.mjs:
  // with C = 1.30 and a 12.6 deg peak, the peak condition forces a cornering
  // stiffness of 224 load/rad -- a knife-edge tyre that saturates at 2 degrees.
  // Real tyre fits put a 12 deg peak with C in the 1.6-1.8 range and a modest
  // E, and that is where this sits. The reference is explicit about the same
  // tradeoff from the other direction: a curve that "stays at the peak very
  // long" needs a large B, and a large B is a stiff tyre.
  //
  // E is then SOLVED, not chosen, for the stiffness in TYRE_SLIP_STIFF:
  //   E = (u* - tan(pi/2C)) / (u* - atan u*),   u* = C_slip * peak / C
  // which reproduces stiffness = C_slip at slip 0 and the peak at TYRE_SLIP_PEAK
  // simultaneously. `_tyreshape.mjs` re-derives it from the file and fails if the
  // two drift apart.
  // PEAK SLIP ANGLE -- where the tyre lets go. This is the INPUT to the shape,
  // the geometrically meaningful quantity, ~12.6 deg for a road tyre and inside
  // the 6-15 deg band the reference gives for real tyres. It is what a rider
  // feels as the limit and it is what B is derived from (see `peakShapeU`).
  TYRE_SLIP_PEAK: 0.22,       // rad, ~12.6 deg -- the limit, and a real input
  // ZERO-SLIP CORNERING STIFFNESS, per unit load, in rad^-1 -- the quantity a
  // tyre rig measures and the one that sets turn-in response. It is DERIVED from
  // the shape (it is `B·C·D` / load once B comes from the peak slip angle), and
  // is carried here for the harness and the HUD. Motorcycle tyres run roughly
  // 8-14 load/rad; assert the derived value stays in that band in
  // harness/_tyreshape.mjs rather than trusting the note.
  TYRE_SLIP_STIFF: 11.5,      // a CHECK value, not a tuning knob
  TYRE_LONG_GRIP: 1.30,       // longitudinal grip multiplier vs lateral
  TYRE_RELAX: 0.55,           // m of travel over which side force builds
  // ---- TYRE DAMPING: THE HALF THAT WAS MISSING --------------------------
  //
  // A tyre is not a spring. It is a spring AND a damper: the carcass is rubber,
  // and rubber dissipates energy as it deforms. In every serious tyre model the
  // damping is what stops the contact patch from oscillating, and here it was
  // simply absent -- the only lateral damping in the whole vehicle was
  // LATERAL_DAMP (0.90/s), which is a *chassis* term, not a tyre one.
  //
  // MEASURED, and this is the number that explains the ice. Linearising the
  // model about zero slip at 30 m/s gave a lateral mode with
  //
  //     wn = 1.78 rad/s,  zeta = 0.25,  settling time 8.9 s
  //
  // -- a lightly-damped oscillator that wallows for nine seconds after every
  // steering input and, on the way, carries several metres per second of pure
  // sideways velocity. That IS ice. A real motorcycle settles a lane change in
  // 0.3-0.5 s, which needs zeta >= 0.7.
  //
  // The force is a damper on the slip RATE, which for this model is the lateral
  // velocity divided by the relaxation length -- the standard formulation. It is
  // scaled by the load on the tyre, because a loaded tyre has more rubber in
  // contact and dissipates more.
  TYRE_LATERAL_DAMP: 0.28,    // x load / relaxation-length, as a slip-rate damper
  // ---- THE TYRE'S YAW MOMENT: what makes a slide recover -----------------
  //
  // The kinematic steering above (`targetYawRate`) does not know the bike is
  // sliding, and the side force in step 3 changes only `lateralV`. Those two
  // facts together meant a slide could never resolve: MEASURED in
  // harness/_lanesettle.mjs, the heading returned to zero in half a second after
  // the bars centred while the bike carried 2.3 m/s of lateral velocity for
  // seconds, tyres upright and capable of 60 m/s^2. The rear tyre's side force
  // acts behind the CG and turns the bike -- that is how a real bike recovers,
  // and it was not in the model.
  //
  // SLIDE_YAW_GAIN: rad/s of yaw per rad of rear slip, i.e. the steady yaw rate
  // the moment drives toward. A real motorcycle recovers a slide in a few tenths
  // of a second, so this wants to be of order 1-3 rad/s per rad of slip.
  SLIDE_YAW_GAIN: 1.6,
  // SLIDE_YAW_RATE: 1/s the yaw rate relaxes toward that target. Not instantaneous
  // because the moment acts through the bike's yaw inertia; ~6/s gives a
  // recovery that is felt rather than snapped.
  SLIDE_YAW_RATE: 6.0,
  // ---- CAMBER THRUST. See the block in step 3 for the mechanism and sources.
  //
  // THE CONSTANT IS DERIVED, NOT TYPED, and that is not fussiness -- typing it is
  // exactly how the first attempt went wrong. `CAMBER_STIFF: 5.0` was picked by
  // eyeballing "a third to a half of the cornering stiffness" (our cornering
  // stiffness is 11.5 load/rad, so 5.0 looked reasonable), and it produced
  // 12017 N of side force per radian of camber. At 0.72 rad (41 deg) of lean the
  // bike's own weight is only 2403 N, so the camber term alone claimed 8652 N --
  // 3.6x the vertical load, and more than 3x the ENTIRE centripetal force the
  // corner needs. It was a real force in the velocity update, so it was not
  // cosmetic: it would have thrown the bike at the inside of every corner.
  //
  // The error was comparing units that are not comparable. Cornering stiffness
  // (N/rad of SLIP angle) and camber stiffness (N/rad of CAMBER angle) share a
  // unit and nothing else. What is true and checkable is the steady-state
  // cornering identity on which the whole thing rests:
  //
  //     tan(lean) = a / g = F_side / (MASS * g)          (steady cornering)
  //
  // so the TOTAL side force a corner at a given lean demands is
  // `MASS * g * tan(lean)`, and camber's job is to supply a FRACTION of it. That
  // fraction is the honest tuning input (`CAMBER_SHARE`), it is dimensionless,
  // and the stiffness falls out of it -- see the derivation at CAMBER_STIFF
  // below, where the mass cancels and no `mu` appears.
  //
  // Sources: camber thrust on a bike "can be the largest contributor" to
  // centripetal force and is the SOLE contributor for a tyre leaned over with the
  // bars straight; it is "approximately linearly proportional to camber angle for
  // small angles"; and it "does not have an associated relaxation length", so it
  // must bypass the slip relaxation lag (see the step-3 block).
  // CAMBER_STIFF is the sole tuning input for camber, and it is honest to say what
// it is: it is a small-angle STIFFNESS, fixed by matching the linear law to the
// cornering requirement at CAMBER_REF_LEAN. It is NOT "the share at REF lean",
// and the difference matters. Because the linear law `STIFF*lean` grows more
// slowly than the true requirement `tan(lean)`, the realised share FALLS as lean
// grows -- about 0.47 at 11 deg, 0.39 at the 29 deg reference, 0.25 at the 45 deg
// fade knee. That decay is physical and desirable: it keeps a bike at full lean
// from getting a linear grip bonus, which is the same reason a real tyre's camber
// thrust curve bends over. What must NOT happen is the force exceeding the
// friction budget, and the realised share is a quarter to a half of the
// requirement -- never a multiplier. harness/_camberverify.mjs asserts both the
// cornering share stays in a sane band AND the force never exceeds `mu * load`.
CAMBER_SHARE: 0.45,         // stiffness-set point: realised share at CAMBER_REF_LEAN
  CAMBER_REF_LEAN: 0.50,      // rad, ~29 deg -- the lean the stiffness is set at
  // Past ~45 deg of lean the contact patch stops rewarding more camber, so the
  // linear law is faded out rather than run to the clamp.
  CAMBER_MAX_LEAN: 0.79,      // rad, ~45 deg -- where the linear law starts fading
  CAMBER_FADE: 0.35,          // fraction of the linear force given up at full lean
  // How much of the camber force is credited to the FRONT tyre. The front
  // initiates the roll, so it runs slightly more camber than the rear; this
  // split is what makes a bike turn IN. Modest, and exposed so it can be measured.
  CAMBER_FRONT_SHARE: 0.55,
  LANE_HOLD: 0.45,            // 1/s pull back toward the centreline
  // 1 = physical: the road turning under the bike changes its road-relative
  // heading (see the end of step()). 0 restores the old auto-follow.
  ROAD_CARRY: 1.0,
  // Gain on the AI's bend feed-forward (step 2). Swept on the twisty road with
  // the pack's lane controller: 0 -> 0.92 m worst tracking error, 0.35 -> 0.14 m
  // (the pre-ROAD_CARRY figure was 0.15), 0.5 -> 0.46 m (it starts to lead).
  AI_FF: 0.35,
  PLAYER_AUTOPILOT: 0.30,     // fraction of SELF_CENTRE / LANE_HOLD the player keeps
  SELF_CENTRE: 1.9,           // 1/s the heading returns to the road's line
  SELF_CENTRE_OFF: 1.1,       // ditto, off the tarmac
  // Fraction of the self-centring that YIELDS while the bars are held over. See
  // the note at the self-centring in step() 2: at 1.0 a held full lock gets no
  // centring at all; at 0 the heading plateaus at ~0.2 rad at race speed.
  CENTRE_YIELD: 0.6,

  // ---- riding verbs. See step() 1c/1d and the airborne block in 4. ----
  // The weight-transfer model already computed everything these need; none of
  // this adds a new force model, it reads the one that was already there.
  // 0.20 put EVERY full-throttle launch -- the race start and every remount --
  // into a 26 deg wheelie held for 3.5 s (front load sat at 0.11-0.14 all the
  // way to 30 m/s; MEASURED). At 0.11 a hard launch lifts the front briefly and
  // sets it down; a sustained wheelie takes a genuinely light front end.
  WHEELIE_LOAD: 0.11,
  WHEELIE_RATE: 3.4,          // rad/s the nose comes up
  WHEELIE_MAX: 0.62,          // rad, ~36 deg -- past this you loop it
  STOPPIE_LOAD: 0.80,         // loadFracFront above this and the rear is light
  STOPPIE_MAX: 0.42,          // rad of nose-down
  WHEELIE_STEER: 0.35,        // steering authority left while the front is up

  BOOST_FORCE: 3400,          // N while boosting
  BOOST_TIME: 1.6,            // s of boost per charge
  BOOST_COOL: 6.0,            // s before it is available again
  BOOST_MIN_SPEED: 9,         // m/s -- not a launch tool

  // Airborne. The road climbs and falls at up to 5.6%; take a crest fast enough
  // and the wheels stop following it, which is a jump rather than a bug.
  AIR_GRAVITY: 22.0,          // m/s^2 -- heavier than real, or hangtime is silly
  AIR_TRIGGER: 1.6,           // m/s of downward road slope needed to launch
  AIR_LAND_HARD: 6.0,         // m/s of impact above which the landing hurts
  AIR_STEER: 0.22,            // steering authority in the air

  SLIP_RANGE: 22,             // m behind a rival where the tow is felt
  SLIP_LATERAL: 2.0,          // m of lateral alignment needed
  SLIP_DRAG: 0.55,            // drag multiplier in clean air behind someone
  // A bike leans to turn; lean is limited by the ground clearance and by grip.
  LEAN_MAX: 0.72,             // rad, ~41 degrees
  // MEASURED in simulated time (harness/_steerfeel.mjs): with the corrected
  // lean->yaw relation, full lock at 48 m/s moved the bike 0.04 m in the first
  // half second and 0.76 m in the first full second -- the lean was still
  // building, and the dead time read as unresponsive bars. 7.0 keeps the same
  // steady-state cornering (that is set by the yaw relation, not by this) and
  // removes most of the lag. Crossing the 7.5 m carriageway takes ~2 s.
  LEAN_RATE: 7.0,             // rad/s toward target lean
  STEER_AUTHORITY: 1.00,      // how much steering actually yaws the bike
  STEER_RATE: 2.30,           // rad/s of steering input at low speed
  STEER_RATE_FAST: 0.72,
  COUNTERSTEER_GAIN: 0.55,    // bikes counter-steer: bar input -> opposite yaw flip
  // Lean -> yaw. See the derivation in step() 2: yawRate = g*tan(lean)/v.
  TURN_GAIN: 1.0,             // 1.0 is the physical value; raise for arcade bite
  TURN_MIN_SPEED: 5.0,        // m/s floor on the divisor, or the relation blows up
  // ---- THE BICYCLE MODEL: A REAL STEER ANGLE AT THE FRONT CONTACT ----------
  //
  // WHY THIS EXISTS, AND WHAT WAS MISSING. Everything above turns the bike by
  // LEAN. A motorcycle does lean, but it leans BECAUSE the rider steers the
  // front wheel: the bar input sets a STEER ANGLE `delta` at the front contact
  // patch, that makes the machine yaw, the yaw makes it lean, and the lean
  // balance is what holds the corner. Lean is the OUTPUT of the steering, not a
  // parallel input path -- and with only the lean relation the bike had no
  // representation of the thing the player is actually holding.
  //
  // The bicycle model is the oldest and most useful result in the field:
  //
  //     yawRate = v * tan(delta) / L
  //
  // with `delta` the steer angle at the contact patch and `L` the wheelbase. It
  // is exact for a bicycle and a very good approximation for a motorcycle below
  // the tyre's limit. This is the relation the old code mis-used by feeding it
  // the LEAN angle (see the note in step() 2); fed the correct quantity it is
  // precisely what was needed.
  //
  // It is the low-speed and steady-state model. At zero speed `yawRate` is zero,
  // which is right: a stationary bike goes nowhere however hard you turn the
  // bars. As speed rises the lean relation above takes over and the steer angle
  // shrinks (STEER_MAX_FAST), which is also right: at 50 m/s a rider is almost
  // not steering at all, the machine is balancing.
  STEER_MAX_SLOW: 0.52,       // rad of front-wheel steer at a walking pace (~30 deg)
  STEER_MAX_FAST: 0.045,      // rad at top speed (~2.6 deg) -- what a real bike uses
  STEER_MAX_REF: 22.0,        // m/s at which the shrinking is half done
  // TRAIL SELF-CENTRING. The front tyre's contact patch sits `trail` behind the
  // steering axis, so a rolling front wheel is a caster: it aligns itself with
  // the direction of travel, and the force doing so grows with speed. That is
  // why a motorcycle straightens up when you let go, and it is a real force, not
  // a helper. Expressed as a rate toward the travel-aligned steer angle.
  TRAIL_ALIGN: 3.4,           // 1/s at reference speed
  TRAIL_REF: 12.0,            // m/s: the alignment scales with speed up to this
  // How much of the bicycle-model yaw is allowed through, given the lean model
  // already carries the fast-corner behaviour.
  //
  // This was 1.0 -- the honest, unattenuated bicycle model -- until camber thrust
  // was added. Camber now supplies a real share of the cornering force, and the
  // kinematic `bicycleYaw` was tuned when it supplied NONE, so the two together
  // over-turn: the machine reaches the target heading and then keeps going, which
  // the combat stage measures as an overshoot (closest approach to a rival went
  // 1.05 m -> 1.71 m and hits fell 4 -> 2). Reducing the gain is the physically
  // correct response, not a fudge: camber thrust is the reason a motorcycle
  // corners with a SMALLER steering angle than the bicycle relation predicts, so
  // the relation must deliver LESS yaw once camber is present. The value is set
  // by the gate, not derivation, and set to satisfy BOTH gate constraints at once:
  // the combat stage needs the pack reachable (hits and a knockdown) and the
  // steering stage needs >= 11.5 deg of heading change in 1.5 s. 1.0 (pre-camber)
  // and 0.75 both over-turn for combat; 0.55 under-turns for the steering check.
  BICYCLE_GAIN: 0.65,
  // Arcade assist. See the note in step() 2 -- adapted from
  // mini-driving-simulator-3d (MIT, Liane Heidemann).
  ARCADE_MIX: 0.55,           // 0 = pure lean physics, 1 = pure arcade response
  ARCADE_LAT_G: 1.15,         // g of cornering the assist is allowed to ask for
  // MEASURED with harness/_recover.mjs. A lateral-g budget is speed-correct at
  // racing speed and absurd at walking pace: g*1.15 / max(5, v) is 2.26 rad/s
  // below 5 m/s, a 2.2 m turning radius. Recovering from the dirt, the bike
  // corrected to the centreline and kept going -- straight across to the
  // opposite rail. A real rider does not pirouette; the budget needs a ceiling.
  ARCADE_YAW_MAX: 0.95,       // rad/s the assist may ever ask for
  // Stranded-rider rescue. See the note in step() 4.
  STRAND_TIME: 0.45,          // s off the tarmac before the rescue engages
  STRAND_RATE: 4.5,           // m/s it walks the rider back toward the road
  BAR_STEER_FADE: 18.0,       // m/s at which direct bar steering has faded to nothing
  STEER_SMOOTH: 14.0,         // 1/s: how fast bar input follows the key.
                            // Was 5.5, a ~0.42 s ramp to 90%. That delay sat
                            // UPSTREAM of the lean spring, so no spring tuning
                            // could make the bike answer quickly -- the target
                            // it was chasing was itself still arriving. 14.0 is
                            // ~0.16 s, which is keyboard-direct without being a
                            // step (a true step rings the lean spring).
  ONROAD_GRIP: 1.0,
  OFROAD_GRIP: 0.54,
  OFROAD_DRAG: 2.60,          // extra rolling resistance off the tarmac

  // ---- getting going again --------------------------------------------
  // A bike cannot pull away from a dead stop on the clutch alone, and it cannot
  // climb back onto the road from deep in the dirt at walking pace. Without a
  // push-start, a rider who was knocked down at zero or who drifted into the
  // verge and stopped was simply STUCK: the race continued without them and the
  // throttle did nothing, which reads as a broken game rather than a penalty.
  PUSH_BELOW: 6.0,            // m/s: under this, the launch assist is available
  PUSH_RELEASE: 11.0,         // m/s: fully gone by here
  PUSH_FORCE: 1500,           // N of launch assist at a standstill
  OFROAD_THROTTLE: 0.72,      // fraction of engine force available off-road

  // ---- weight transfer -------------------------------------------------
  // A bike's load is not fixed: it pitches forward under braking and back under
  // power, and the tyre that carries the load is the tyre that makes the force.
  // Without this, braking is a flat deceleration and there is no way to endo or
  // to spin up the rear. TRANSFER_GAIN converts longitudinal acceleration into
  // load shift; the static split is 45/55 front/rear.
  STATIC_FRONT: 0.45,
  TRANSFER_GAIN: 0.42,        // metres of CG height / wheelbase, plus geometry
  TRANSFER_MAX: 0.42,         // never fully unload a tyre
  // ---- LATERAL load transfer, the half that was missing ------------------
  //
  // The transfer above is LONGITUDINAL ONLY, and that is the root of the
  // "floaty / no weight" feel. A bike at 41 degrees of lean is generating about
  // 0.9 g sideways, and that force has to come from somewhere: the load moves
  // onto the OUTSIDE of the tyre contact patch and the machine is pressed into
  // the road. With no lateral term, a cornering bike loaded exactly as if it
  // were going straight, so there was no sensation of weight in a turn.
  //
  // MEASURED with harness/_feelphysics.mjs, full lock at 32 m/s: `loadFracFront`
  // ended at 0.169 -- the front almost unloaded MID-CORNER, which is the
  // opposite of what a cornering bike does. The number was being set by the
  // throttle's longitudinal term alone, with nothing cornering-shaped in it.
  //
  // LATERAL_TRANSFER_GAIN converts the cornering acceleration `v * yawRate`
  // into the same +/- load-fraction space as the longitudinal term, so the two
  // add and the tyre model reads one honest number.
  LATERAL_TRANSFER_GAIN: 0.30,
  LATERAL_TRANSFER_MAX: 0.30,
  // Suspension: a spring between the wheel and the sprung mass. It exists so the
  // surface can be FELT — the fork compresses on the brakes and the shock squats
  // under power, and over a rough surface the bike rides rather than glides.
  SUSP_K: 165,               // N/mm-ish, spring rate in our mass units
  SUSP_C: 22,                // damping
  SUSP_TRAVEL: 0.13,          // m of usable travel at each end

  // ---- the feel budget ---------------------------------------------------
  // SIX NUMBERS THAT ARE THE WHOLE FEEL OF THE BIKE, grouped where they can be
  // tuned against each other. Everything else is either a real physical constant
  // or structural; these are taste, and they are the ones to move.
  //
  // BRAKE_G: braking is limited by grip, not by lever force. At BRAKE_FORCE
  //   6200 N on 245 kg the model asked for 25 m/s^2 -- MEASURED 42.6 -> 0 m/s in
  //   0.90 s, i.e. **4.82 g**, a brick wall. A motorcycle brakes at about 1.0 g
  //   and the limit is the front tyre's grip. Braking is now clamped to this
  //   many g, so it is hard, short and readable rather than teleporting.
  BRAKE_G: 1.05,
  // LEAN_STIFF / LEAN_DAMP: the lean spring. The lag IS the perceived weight.
  //   MEASURED before: steer reached 90% at 0.417 s but the lean peaked at
  //   1.20 s -- a 0.78 s gap, three to five times what reads as a motorcycle.
  //   These raise the spring rate and trim the damping so the settle is ~0.20 s.
  //   TUNED, not guessed: a second-order solve of `x'' = (T-x)K - x'C` puts
  //   K=300/C=20 at wn=17.3 rad/s, zeta=0.58 -- a 0.133 s settle that peaks 11%
  //   at 0.222 s. That is the "spring with ~0.15-0.25 s settle" that reads as a
  //   motorcycle; the first pass at K=19/C=6 settled in 0.60 s and read as a lag.
  LEAN_STIFF: 300.0,          // 1/s^2 toward target lean
  LEAN_DAMP: 20.0,            // 1/s velocity damping on the lean spring
  // LATERAL_DAMP: how fast sideways velocity bleeds off. This is the "weight"
  //   in a lane change; too low and the bike skates, too high and it is on rails.
  //
  //   IT IS NO LONGER THE ONLY DAMPING. It used to carry the whole job, at 0.90/s,
  //   and that is what produced the measured 8.9 s lateral settle -- see
  //   TYRE_LATERAL_DAMP, which is where a real bike's damping actually comes
  //   from. This stays as a small chassis term (the rider's arms and the frame
  //   absorbing a little sideways motion) and it is deliberately kept low so the
  //   TYRE is what makes the grip feel, rather than a chassis damper papering
  //   over a sliding contact patch.
  LATERAL_DAMP: 0.35,
  // SUSP_STIFF is SUSP_K above; exposed under the feel-budget name too so the
  // six can be found in one place.
  SUSP_STIFF: 165,

  // ---- collision -------------------------------------------------------
  // Bodies are circles in plan. Riders are not solid: they are pushed apart and
  // the push scales with the closing speed, so a gentle brush costs a little
  // line and a hard T-bone puts both riders down.
  BODY_R: 0.50,               // m, the bike's plan radius including the rider
  CONTACT_RESTITUTION: 0.22,  // how bouncy a bike-to-bike hit is
  CONTACT_PUSH: 2.6,          // m/s of separation per m/s of closing speed
  WALL_RESTITUTION: 0.18,
};

function engineCurve(revFrac) {
  const c = PHYS.ENGINE_CURVE;
  const f = Math.min(1, Math.max(0, revFrac));
  for (let i = 1; i < c.length; i++) {
    if (f <= c[i][0]) {
      const [f0, v0] = c[i - 1], [f1, v1] = c[i];
      const t = (f1 === f0) ? 0 : (f - f0) / (f1 - f0);
      return v0 + (v1 - v0) * t;
    }
  }
  return c[c.length - 1][1];
}

// The tyre's side-force response to slip angle. Linear near zero, peaks, then
// falls away — which is the shape that makes a slide progressive instead of a
// cliff, and is why a rider can feel the limit approaching.
// ---------------------------------------------------------------------------
// THE MAGIC FORMULA. Pacejka, "Tyre and Vehicle Dynamics", eq. 4.1-4.4, and the
// parameterisation used by every serious tyre model since (MF5.2 / MF6.1):
//
//     y(x) = D · sin{ C · arctan[ B·x − E·(B·x − arctan(B·x)) ] }
//
// WHAT THIS REPLACES, AND WHY IT MATTERED. The previous function was a straight
// line up to the peak and a straight line down after it -- piecewise LINEAR. It
// had the right qualitative shape (rise, peak, fall) and it was wrong in the one
// place that matters: the PEAK. A piecewise-linear curve has a KINK there, and a
// kink is a discontinuity in cornering stiffness. Cornering stiffness is the
// derivative of force with respect to slip, and it is what the vehicle's whole
// lateral dynamics are made of -- so at the exact moment a rider probes the
// limit, the model's stiffness jumps. The bike "snaps" rather than going
// progressively loose, and no amount of tuning removes it because it is the
// shape of the curve, not the numbers.
//
// The Magic Formula is smooth everywhere and C∞, and its three factors each do
// one job (Pacejka's own reading, and the reason the formula is used):
//
//   D  the PEAK VALUE. Force at the peak = D (times load). This is the friction
//      coefficient: `D/load = mu`. Set from TYRE_LAT_PEAK.
//   C  the SHAPE FACTOR. Controls where the peak sits and how the curve leaves
//      the origin. C = 1.30 gives the peak at a realistic slip angle and a
//      forgiving falloff; C = 2 would make the peak a plateau.
//   B  the STIFFNESS FACTOR, and the one that actually sets the feel. The
//      cornering stiffness at zero slip is exactly `B·C·D` (N/rad), which is the
//      quantity a vehicle dynamicist measures on a tyre rig. B is therefore
//      DERIVED from a stiffness in physical units rather than typed in, so the
//      initial turn-in response is a number with a meaning.
//   E  the CURVATURE FACTOR. Slightly less than 1 it rounds the peak and lets
//      the force fall away gently past it -- the progressive slide. E = 1 would
//      give a sharp peak with no warning.
//
// The old code's values are reproduced by this curve rather than assumed: with
// TYRE_LAT_PEAK 1.35, TYRE_SLIP_PEAK 0.22 and the stiffness below, the measured
// peak lands at the same slip angle the old piecewise curve intended, so this is
// a SHAPE change and not a re-tune.
// B is DERIVED, and getting that derivation right is the whole model.
//
// The naive move is to set B from the zero-slip cornering stiffness, because
// `B·C·D` IS that stiffness. It is wrong, and measurably so. B, C, E together
// put the PEAK somewhere, and with C = 1.30, E = 0.97 the peak only lands at a
// realistic slip angle for one particular B. Setting B from stiffness instead
// makes it ~7x too small: the curve is still rising at 52 degrees, there is no
// peak in any usable range, force keeps climbing toward the asymptote `D·sin(Cπ/2)`
// = 1.298·load, and because the peak is off the end of the world the force never
// FALLS -- so past the limit the tyre gets BETTER, which is precisely the
// negative-damping instability this whole rewrite exists to remove. Measured
// with harness/_tyreshape.mjs: peak slip 51.6 deg against a published 12.6.
//
// So B is derived from the PEAK SLIP ANGLE, which is the geometrically
// meaningful quantity -- it is where the tyre lets go, and it is what a rider
// feels -- and the zero-slip cornering stiffness then falls out of the curve as
// `B·C·D`. That is the honest direction of the causality for a game: we choose
// where the limit is, and the initial response follows.
//
// Solving for the B that puts the peak at slip `sp` means solving
//   d/dx [ sin(C·atan(f(x))) ] = 0   with x = B·sp, f = x - E(x - atan x).
// Let u = B·sp. The peak condition depends only on C, E and u -- not on D or the
// load -- so it is solved ONCE, numerically, and reused. The resulting
// dimensionless u* is what makes the parameterisation self-consistent.
// The Magic Formula shape. B and E are BOTH derived from the three meaningful
// numbers -- peak slip angle, peak friction, cornering stiffness -- so there is
// exactly one way the curve can come out and no way to type in a combination
// that does not close. Neither is a tuning knob, and neither is typed.
//
// Working the two relations out carefully matters here, because getting them
// wrong in either direction is exactly what broke this model twice:
//
//   - STIFFNESS. The slope at zero slip of y = D·sin(C·atan(f(B·sl))) is
//     D·C·B (f'(0) = 1), and D = mu·load. So the cornering stiffness per unit
//     load is `mu·C·B`, and
//         B = C_slip / (mu · C).
//     Leaving mu out of that (B = C_slip/C) makes the tyre 35% too stiff, which
//     is a knife-edge; ignoring it entirely and setting B from the stiffness
//     without regard to C is what produced the curve with no peak at all.
//   - PEAK LOCATION. The peak is where the sine's argument reaches pi/2, i.e.
//     f(B·peak) = tan(pi/2C). Solving for E in closed form:
//         E = (u* - tan(pi/2C)) / (u* - atan u*),   u* = B · peak.
//
// E COMES OUT NEGATIVE here, around -1.06, and that is correct rather than a
// bug. For a peak this late (12.6 deg) paired with a stiffness this low
// (11.5/rad) the shoulder is very round, and E < 0 is how the Magic Formula
// expresses a rounder-than-baseline approach to the peak. It sits outside the
// 0..1 band that is often quoted, so the harness asserts the SHAPE that matters
// -- monotone rise, peak at the published slip, gentle falloff -- rather than
// asserting E's sign. Do not "fix" the sign without re-running _tyreshape.mjs:
// flipping it moves the peak and changes the stiffness, which is the whole
// failure mode this rewrite removed.
const TYRE_B = PHYS.TYRE_SLIP_STIFF / (PHYS.TYRE_LAT_PEAK * PHYS.TYRE_SHAPE_C);
const TYRE_E = (() => {
  const C = PHYS.TYRE_SHAPE_C;
  const u = TYRE_B * PHYS.TYRE_SLIP_PEAK;
  return (u - Math.tan(Math.PI / (2 * C))) / (u - Math.atan(u));
})();

// CAMBER STIFFNESS, DERIVED. See the CAMBER_* block in PHYS for the derivation
// and for why typing this number by hand is what broke the first attempt.
//
// The camber force is `CAMBER_STIFF * loadN * grip * lean * fade`, and we want it
// to be `CAMBER_SHARE` of the cornering requirement at `CAMBER_REF_LEAN`. The
// requirement is `MASS * g * tan(lean)`. Setting the two equal at the reference
// lean:
//
//     CAMBER_STIFF * loadN * REF = CAMBER_SHARE * MASS * g * tan(REF)
//
// and since `loadN = MASS * g` at rest, **the mass cancels**:
//
//     CAMBER_STIFF = CAMBER_SHARE * tan(REF) / REF
//
// This is the part the first two attempts both got wrong, in opposite ways: the
// hand-typed 5.0 was a units-blind guess, and the first derivation below kept a
// `MASS * g` that is already cancelled by the `loadN` factor the force term
// applies. The result is dimensionless-ish, order 0.5, and it says exactly what
// it should: "at 40 deg of lean, camber supplies 45% of the cornering force".
// A sanity print of the resulting force at the reference lean is in
// harness/_camberverify.mjs, which fails loudly if this ever drifts back to O(5).
//
// There is deliberately NO `TYRE_LAT_PEAK` factor either. The force term already
// multiplies by `grip`, and the friction circle bounds the total separately, so
// folding mu in as well would apply grip twice.
const CAMBER_STIFF = (() => {
  const ref = PHYS.CAMBER_REF_LEAN;
  return (PHYS.CAMBER_SHARE * Math.tan(ref)) / ref;      // per rad of lean, per N of load
})();

function tyreForce(slipAngle, loadN, gripScale) {
  const D = PHYS.TYRE_LAT_PEAK * loadN * gripScale;      // peak force, N
  const C = PHYS.TYRE_SHAPE_C;
  const x = TYRE_B * slipAngle;
  const y = D * Math.sin(C * Math.atan(x - TYRE_E * (x - Math.atan(x))));
  return y;
}

// ---------------------------------------------------------------------------
// BikePhys — the state and the integrator.
// ---------------------------------------------------------------------------
export class BikePhys {
  constructor(opts = {}) {
    // --- state ---
    this.s = opts.startS ?? 0;              // distance along the road
    this.lateral = opts.lateral ?? 0;       // metres right of centreline
    this.yaw = 0;                           // WORLD heading, radians
    this.yawOffset = opts.yawOffset ?? 0;   // heading relative to the road tangent
    this.speed = opts.speed ?? 0;           // m/s along the heading
    this.lateralV = 0;                      // m/s sideways, in the bike's frame
    this.yawRate = 0;                       // rad/s
    this.lean = 0;                          // visual + physical roll
    this.leanVel = 0;                       // rad/s of the lean spring (see step() 2)
    this.steer = 0;                         // smoothed BAR input, -1..1
    // THE STEER ANGLE AT THE FRONT CONTACT PATCH, in radians. This is the
    // bicycle model's `delta` -- a real angle the machine holds, not an input
    // level. It is what the front wheel is visually turned to and what the
    // bicycle relation turns into yaw. Written every step in step() 2b.
    this.steerAngle = 0;
    this.steerAngleVel = 0;
    // Arcade steering assist: the player gets it, the AI does not. See step() 2.
    this.arcade = !!opts.arcade;
    // THE MACHINE. career.js BIKES carries power / grip / mass multipliers for
    // every bike you can buy, and nothing ever read them: a 52 000 SUPERBIKE was
    // a RAT in a different paint. They are a property of the bike, not of a
    // race, so reset() leaves them alone; see setMachine().
    this.machine = { power: 1, grip: 1, mass: 1 };
    this.revFrac = 0.0;                     // engine revs, drives the audio
    this.wheelSpin = 0;
    this.onRoad = true;
    this.offRoadTimer = 0;
    this.hitWall = false;
    this.slipFront = 0;
    this.slipRear = 0;
    this.grip = 1;
    this.camberForce = 0;                   // N, side force from lean; see step 3
    this.gripDemand = 0;                    // LATERAL g fraction; published for the HUD, not the circle
    this.gripCircleHeadroom = 1;            // sqrt(1 - fxFrac^2); see step() 3

    // --- weight transfer, suspension, contact ---
    this.longAccel = 0;         // m/s^2, longitudinal, drives the load shift
    this.loadFracFront = PHYS.STATIC_FRONT;
    this.loadFracRear = 1 - PHYS.STATIC_FRONT;
    this.suspFront = 0;         // m of travel, + = compressed
    this.suspRear = 0;
    this.suspVelF = 0;
    this.suspVelR = 0;
    this.surfaceInput = 0;      // set by the owner of the road: roughness under the wheel

    // --- riding verbs ---
    this.wheelie = 0;           // rad of nose-up (+) / nose-down stoppie (-)
    this.airY = 0;              // m above the road surface; 0 = wheels down
    this.airVY = 0;             // m/s vertical
    this.airborne = false;
    this.airTime = 0;
    this.lastRoadY = null;      // for measuring how fast the road drops away
    this.boost = 0;             // s of boost remaining
    this.boostCool = 0;         // s until another charge
    this.slipstream = 0;        // 0..1, how much tow is being had
    this.landHit = 0;           // m/s of the last landing, for FX and audio
    this.contactImpulse = 0;    // m/s of push applied this step, for FX
    this.lastContact = null;    // what we hit, for the audio and the sparks

    // --- interpolation buffers (visual state lags the physical state) ---
    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.prevYaw = 0;
    this.currYaw = 0;

    // --- scratch ---
    this.pos = new THREE.Vector3();
    this.tangent = new THREE.Vector3();
    // two-point road pitch, filled by sampleAxles() inside sync()
    this.rearAxleY = 0;
    this.frontAxleY = 0;
    this.roadPitch = 0;          // rad, +ve = nose up
    this.axleGrade = 0;          // rise per metre between the axles
    this.forward = new THREE.Vector3(0, 0, 1);
    this._acc = 0;                          // fixed-step accumulator

    this.sync();
    this.prevPos.copy(this.pos);
    this.currPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.currYaw = this.yaw;
  }

  /**
   * Put the integrator back to a known state for a new race.
   *
   * WHY THIS EXISTS. `resetRace()` used to set `s`, `lateral`, `yawOffset` and
   * `speed` by hand and nothing else -- in particular not **`lateralV`**. A race
   * that ended with the bike sliding sideways handed that sideways velocity to
   * the NEXT race, which threw the rider into the guard rail before the throttle
   * could do anything.
   *
   * MEASURED: `_nondet.mjs` runs four races back to back. Run 0 was clean and
   * runs 1-3 showed 269-281 pinned frames with `maxV` around 12 m/s and 42 m
   * covered -- the signature of a bike that started against the barrier rather
   * than one that drifted there. Zero contacts, so nothing hit it.
   *
   * IT IS NOT AN ELEVATION BUG, though adding real gradients is what exposed it:
   * hillier races end in more varied states, so more of them end mid-slide. The
   * fault was latent from the moment a second race became possible.
   *
   * Reset the WHOLE integrator here rather than a chosen subset. Anything left
   * out is a channel for the previous race to leak into this one, and the
   * symptom will appear somewhere far away.
   */
  reset(opts = {}) {
    this._kappa = 0;
    this.s = opts.s ?? 0;
    this.lateral = opts.lateral ?? 0;
    this.speed = opts.speed ?? 0;
    this.yawOffset = opts.yawOffset ?? 0;
    this.lateralV = 0;
    this.yawRate = 0;
    this.lean = 0;
    this.leanVel = 0;
    this.steer = 0;
    this.steerAngle = 0;
    this.steerAngleVel = 0;
    this.revFrac = 0;
    this.wheelSpin = 0;
    this.onRoad = true;
    this.offRoadTimer = 0;
    this.hitWall = false;
    this.slipFront = 0;
    this.slipRear = 0;
    this.grip = 1;
    this.camberForce = 0;
    this.gripDemand = 0;
    this.gripCircleHeadroom = 1;
    this.longAccel = 0;
    this.loadFracFront = PHYS.STATIC_FRONT;
    this.loadFracRear = 1 - PHYS.STATIC_FRONT;
    this.suspFront = 0;
    this.suspRear = 0;
    this.suspVelF = 0;
    this.suspVelR = 0;
    this.surfaceInput = 0;
    this.contactImpulse = 0;
    this.lastContact = null;
    // riding verbs -- every one of these is per-race state, and §5.16 is the
    // record of what happens when a reset takes a subset.
    this.wheelie = 0;
    this.airY = 0; this.airVY = 0; this.airborne = false; this.airTime = 0;
    this.lastRoadY = null;
    this.boost = 0; this.boostCool = 0;
    this.slipstream = 0; this.landHit = 0;
    this.sync();
    this.prevPos.copy(this.pos);
    this.currPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.currYaw = this.yaw;
    return this;
  }

  // Place the object in world space from (s, lateral).
  sync() {
    const z = -this.s;
    const c = centreAt(z, this.pos);
    // headAt, not centreTangent: the tangent points toward +z but travel is
    // toward -z, and using the tangent here is what made every bike face
    // backward along the road -- and dragged the chase camera with it.
    headAt(z, this.tangent);
    const nx = -this.tangent.z, nz = this.tangent.x;
    this.pos.x += nx * this.lateral;
    this.pos.z += nz * this.lateral;
    this.roadYaw = Math.atan2(this.tangent.x, this.tangent.z);
    // THE HEADING TURNS THE SAME WAY THE BIKE MOVES. `yawOffset` is positive
    // toward +lateral: the slip model below settles `lateralV` at
    // `v * tan(yawOffset)`, and +lateral is the road normal (-t.z, 0, t.x). A
    // world yaw `y` points the model's nose at (sin y, 0, cos y), so pointing it
    // toward +lateral needs `roadYaw - yawOffset`. It was `+`, which MIRRORED the
    // heading against the motion: press right, the bike moved right while its
    // nose swung LEFT -- the rear wheel appeared to step out into the turn ahead
    // of the front. MEASURED on a fresh BikePhys at 25 m/s, full right: lateral
    // +0.97 m after 1 s while forward.x went -0.10 -> -0.30 (nose to the left).
    this.yaw = this.roadYaw - this.yawOffset;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // ---- ROAD PITCH: the two-point sample -------------------------------
    //
    // ONE POINT IS NOT ENOUGH. Until now `pos.y` was the road height at the
    // bike's CENTRE, so the machine sat dead level while it crossed a crest and
    // dead level again through the dip that followed -- the road changed
    // gradient and the bike did not. The suspension underneath was reading that
    // grade correctly, which is what made it read as wrong rather than absent.
    //
    // A bike pitches to the line between its two contact patches, so that line
    // is what is sampled: the road surface at the front axle and at the rear
    // axle, half a wheelbase either side of `s`. The pitch is one `atan2`.
    //
    // This is a RENDER-side quantity (`roadPitch`), deliberately not folded
    // into `yaw`/`tangent`: the physics resolves along the road and must keep
    // seeing the centre line, or the two-point sample would feed back into the
    // integration and the grade would compound every step.
    //
    // Sampling `centreAt` at both ends also means the bike follows a CREST
    // instead of intersecting it -- the front wheel drops away over the top
    // before the rear arrives, which is exactly the moment the airborne trigger
    // is looking for.
    const half = PHYS.WHEELBASE * 0.5;
    this.sampleAxles(this.s - half, this.s + half);

    return this;
  }

  // Height of the road surface at a distance `s` along the track, at this
  // bike's lateral offset. `centreAt` is a closed-form function of z, so this
  // is two evaluations and no interpolation -- see level.js for the profile.
  axleY(s, out) {
    const z = -s;
    centreAt(z, out);
    // the cross-section is flat (no banking by design), so the lateral offset
    // contributes nothing to height and is not applied here. If banking is ever
    // added to centreAt, this is the one place that must learn about it.
    return out.y;
  }

  sampleAxles(sRear, sFront) {
    // centreAt writes through `out.set(...)`, so these must be Vector3 and NOT
    // plain {x,y,z} objects. Allocated once, reused every frame: sync() runs per
    // bike per frame and 15 allocations a frame is exactly the sort of thing
    // that shows up as GC in a race.
    this._ayR = this._ayR || new THREE.Vector3();
    this._ayF = this._ayF || new THREE.Vector3();
    const yR = this.axleY(sRear, this._ayR);
    const yF = this.axleY(sFront, this._ayF);
    this.rearAxleY = yR;
    this.frontAxleY = yF;
    // Positive rotation.x is nose-down in three.js for a +Z-facing object, so
    // the grade is negated: climbing (yF > yR) must raise the nose.
    this.roadPitch = -Math.atan2(yF - yR, PHYS.WHEELBASE);
    // How steeply the surface is falling away between the axles, as a grade.
    // The airborne test can use this instead of a one-point frame derivative.
    this.axleGrade = (yR - yF) / PHYS.WHEELBASE;
    return this;
  }

  /**
   * Fit a machine: career BIKES multipliers. Engine force scales with `power`,
   * so the drag-limited top speed scales with sqrt(power) -- exactly the
   * relation career.js's LEVELS `reference` speeds were derived from.
   */
  setMachine(m = {}) {
    const f = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
    this.machine = { power: f(m.power), grip: f(m.grip), mass: f(m.mass) };
    return this;
  }

  /** This machine's top speed on the flat, m/s (drag-limited). */
  get topSpeed() { return CFG.MAX_SPEED * Math.sqrt(this.machine.power); }

  /**
   * WHERE THE BIKE PIVOTS WHEN IT TURNS: THE REAR CONTACT, NOT THE MIDDLE.
   *
   * The kinematic bicycle model (the one every vehicle-dynamics text starts
   * from) says the rear tyre rolls WITHOUT sliding sideways: its velocity lies
   * along the bike's heading, and the machine rotates about a point on the line
   * through the rear axle. So when the bars turn in, the FRONT swings into the
   * corner and the rear follows its own track.
   *
   * This integrator tracks the MIDDLE of the wheelbase and moves it along the
   * path angle, with the heading leading it by `headingSlip`. Drawn about the
   * middle, the rear therefore kicks OUT by (L/2)·sin(slip) on every turn-in --
   * a small but visible "the back wheel moves first". Translating the drawn
   * bike by that amount along the road normal puts the rear contact back on the
   * path and lets the front lead, which is what the eye expects.
   *
   * Render-only: the physics state is untouched. Faded out at a crawl, and
   * during a real slide (large slip), where the rear SHOULD step out.
   */
  rearPivotShift(out) {
    out.set(0, 0, 0);
    const slip = this.headingSlip || 0;
    if (!Number.isFinite(slip) || this.speed < 2) return out;
    const fade = Math.min(1, (this.speed - 2) / 6) * Math.max(0, 1 - Math.abs(slip) / 0.35);
    const d = THREE.MathUtils.clamp(PHYS.WHEELBASE * 0.5 * Math.sin(slip), -0.3, 0.3) * fade;
    // +lateral is the road normal (-t.z, 0, t.x); see sync().
    out.set(-this.tangent.z * d, 0, this.tangent.x * d);
    return out;
  }

  // ---------------------------------------------------------------------
  // The fixed-step entry point. Callers pass the frame's dt; this advances
  // the simulation in fixed slices and never lets a long frame teleport the
  // bike. Returns how many substeps ran, which the harness can assert on.
  // ---------------------------------------------------------------------
  advance(frameDt, input, hooks = {}) {
    const dt = Math.min(frameDt, 0.25);          // clamp the pathological case
    this._acc += dt;
    const h = PHYS.FIXED_DT;
    let steps = 0;

    // Snapshot for interpolation BEFORE stepping.
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;

    while (this._acc >= h && steps < PHYS.MAX_SUBSTEPS) {
      this.step(h, input);
      this._acc -= h;
      steps++;
    }
    // If we hit the substep ceiling, drop the backlog rather than spiral: the
    // bike slows briefly instead of the tab freezing.
    if (steps >= PHYS.MAX_SUBSTEPS) this._acc = 0;

    this.currPos.copy(this.pos);
    this.currYaw = this.yaw;
    return steps;
  }

  // One fixed slice of simulation.
  step(h, input) {
    const { throttle, brake, steer, tuck } = input;

    // ---- 1. engine and longitudinal forces -------------------------------
    // TOP SPEED IS ONE NUMBER, AND IT IS CFG.MAX_SPEED.
    //
    // This was the literal `61` while CFG.MAX_SPEED also said 61 -- two copies
    // that could silently disagree -- AND the actual terminal speed of the
    // engine/drag balance was neither: solving
    // `ENGINE_PEAK*curve(revFrac) = 0.5*rho*CdA*v^2 + cRoll*m*g`
    // gave a measured terminal of **53.9 m/s**. So `revFrac` was computed
    // against a speed the bike could not reach, the drag curve's reference was
    // wrong, and the arcade assist's lateral-g budget was scaled by a fiction.
    //
    // Reading CFG.MAX_SPEED removes the duplicate, and ENGINE_TRIM is chosen so
    // the balance actually converges there rather than merely being asserted.
    const topSpeed = this.topSpeed;
    const frac = Math.max(0, this.speed) / topSpeed;
    this.revFrac = Math.min(1, Math.max(0, frac * 0.94 + (throttle ? 0.12 : 0)));

    let F = 0;
    // FxTyre is the force the TYRE is putting through its contact patch --
    // engine, brake and boost, and deliberately NOT the aero drag or rolling
    // resistance, which act on the body through the air and the bearings rather
    // than through the rubber. It is what the friction circle has to share out
    // with the side force, so it is tracked separately from F (which is the net
    // force on the bike, and includes drag). See the friction circle in step 3.
    let FxTyre = 0;
    if (throttle) {
      const curve = engineCurve(this.revFrac);
      const tuckBonus = tuck ? 1.06 : 1.0;
      // Off the tarmac the engine still drives, just softly. Killing it outright
      // is what strandered a rider in the dirt; damping it means you can always
      // claw your way back.
      const surface = this.onRoad ? 1.0 : PHYS.OFROAD_THROTTLE;
      const Fe = PHYS.ENGINE_PEAK * curve * tuckBonus * surface * this.machine.power;
      F += Fe; FxTyre += Fe;

      // Launch assist: below walking pace, the rider paddles and slips the
      // clutch. It fades to nothing by PUSH_RELEASE so it never touches normal
      // racing, and it exists so a rider who has stopped can always start again.
      if (this.speed < PHYS.PUSH_RELEASE && (this.launchTimer || 0) >= 0) {
        const t = 1 - THREE.MathUtils.clamp(
          (this.speed - PHYS.PUSH_BELOW) / (PHYS.PUSH_RELEASE - PHYS.PUSH_BELOW), 0, 1);
        const Fp = PHYS.PUSH_FORCE * t * t;
        F += Fp; FxTyre += Fp;
      }
    }
    if (brake) {
      // Braking force is limited by grip, and a bike brakes hardest at the
      // front when it is upright. Leaning hard while braking fades it.
      const upright = 1 - Math.min(0.6, Math.abs(this.lean) / PHYS.LEAN_MAX * 0.6);
      // AND IT IS LIMITED BY THE FRONT TYRE. See PHYS.BRAKE_G: the raw
      // BRAKE_FORCE is a lever number, not a road number, and applying it
      // unclamped produced a measured 4.82 g stop. Grip is what actually stops
      // a bike, so the force is capped at the tyre's own limit and the lever
      // only decides how quickly you get there.
      const gripLimit = PHYS.BRAKE_G * PHYS.GRAVITY * PHYS.MASS;
      const Fb = Math.min(PHYS.BRAKE_FORCE * upright, gripLimit) * (this.speed > 1 ? 1 : 0);
      F -= Fb; FxTyre -= Fb;
    }
    if (!throttle && !brake) {
      // engine braking, scaled by revs
      F -= 110 * (0.3 + 0.7 * this.revFrac);
    }

    // BOOST. A short overtake tool, not a second throttle: it costs a charge,
    // it has a cooldown, and it refuses below walking pace so it cannot be used
    // as a launch. Added as a force rather than a speed multiplier so the drag
    // curve still decides the top end and nothing can exceed it.
    if (this.boost > 0) {
      this.boost -= h;
      if (this.speed > PHYS.BOOST_MIN_SPEED) { F += PHYS.BOOST_FORCE; FxTyre += PHYS.BOOST_FORCE; }
      if (this.boost <= 0) { this.boost = 0; this.boostCool = PHYS.BOOST_COOL; }
    } else if (this.boostCool > 0) {
      this.boostCool = Math.max(0, this.boostCool - h);
    }

    // drag: F = 1/2 rho Cd A v^2, opposing motion.
    //
    // SLIPSTREAM is a reduction of exactly this term, which is what it
    // physically is: sitting in a rival's wake means less air to push. The tow
    // is set from outside by whoever knows where the other riders are (main.js
    // owns that), so the integrator stays ignorant of the pack.
    const slipDrag = 1 - this.slipstream * (1 - PHYS.SLIP_DRAG);
    const drag = 0.5 * PHYS.AIR_DENSITY * PHYS.DRAG_AREA * this.speed * this.speed * slipDrag;
    F -= Math.sign(this.speed) * drag;

    // rolling resistance, proportional to load, only meaningful when moving
    const loadN = PHYS.MASS * PHYS.GRAVITY;
    this.loadN = loadN;   // published for the harness (camber share / budget checks)
    if (Math.abs(this.speed) > 0.15) {
      const cRoll = PHYS.ROLL_RESIST * (this.onRoad ? 1 : PHYS.OFROAD_DRAG);
      F -= Math.sign(this.speed) * cRoll * loadN;
    }

    const a = F / (PHYS.MASS * this.machine.mass);
    this.speed += a * h;
    if (this.speed < 0) this.speed = 0;

    // ---- 1b. weight transfer and suspension -------------------------------
    // The longitudinal acceleration computed above is what shifts the load. A
    // bike under braking puts its weight on the front tyre and lifts the rear,
    // which is why it can endo; under power the reverse happens and the rear
    // squats, which is why it can spin up. Both are the SAME mechanism, and the
    // tyre forces below read from the split this produces.
    this.longAccel += (a - this.longAccel) * Math.min(1, h * 12);
    // transfer is negative (weight forward) when accelerating is negative
    const transfer = THREE.MathUtils.clamp(
      -this.longAccel / PHYS.GRAVITY * PHYS.TRANSFER_GAIN, -PHYS.TRANSFER_MAX, PHYS.TRANSFER_MAX);
    // ---- LATERAL: grip demand, NOT a fore/aft load shift -------------------
    //
    // The first version of this SUBTRACTED a cornering term from `loadFracFront`
    // and it was wrong physics, caught by measuring: at full lock and 39 m/s the
    // front load fell to 0.107 (from a 0.45 static split), i.e. the model said
    // the front was almost off the ground in the middle of a corner. A real bike
    // leaned at 41 degrees is doing about 0.88 g and is pressed HARDER into the
    // road, not lifted off it.
    //
    // What cornering actually does is consume the tyre's grip budget. A tyre has
    // one friction circle: force spent turning is force unavailable for braking,
    // which is why you cannot brake as hard mid-corner and why trail-braking is
    // a skill.
    //
    // `v * yawRate` is the centripetal acceleration; divided by g it is the
    // fraction of the circle the corner is using. It is published for the HUD
    // and for the harness, and it is NOT what drives the circle -- the circle is
    // driven by the real longitudinal force at the contact patch (`FxTyre`), see
    // step 3. This was tried as the circle's input once and it was circular: the
    // side force's clamp came out of the side force. An earlier note here claimed
    // it was "read where tyre force is computed", which stopped being true when
    // that was fixed; leaving the claim in place is how a dead variable looks
    // load-bearing.
    const latAccel = Math.abs(this.speed * this.yawRate);
    this.gripDemand = THREE.MathUtils.clamp(latAccel / PHYS.GRAVITY, 0, 1);
    this.loadFracFront = THREE.MathUtils.clamp(PHYS.STATIC_FRONT + transfer, 0.08, 0.92);

    // ---- 1c. WHEELIE AND STOPPIE ------------------------------------------
    //
    // No new force model. The weight transfer above already says how much load
    // is on each tyre -- braking takes the front from 0.42 to 0.87 -- and a
    // wheelie is simply what happens when that number gets small enough that
    // the front tyre is not carrying the bike any more. Reading it rather than
    // adding a separate "wheelie system" is why this is fifteen lines.
    //
    // It is a real handling change, not a pose: with the front wheel off the
    // ground there is nothing to steer with, so authority collapses to
    // WHEELIE_STEER. That is the cost that makes it a decision.
    let wheelieTarget = 0;
    if (this.onRoad && !this.airborne) {
      if (this.loadFracFront < PHYS.WHEELIE_LOAD && this.speed > 4) {
        const over = (PHYS.WHEELIE_LOAD - this.loadFracFront) / PHYS.WHEELIE_LOAD;
        wheelieTarget = Math.min(PHYS.WHEELIE_MAX, over * PHYS.WHEELIE_MAX * 1.6);
      } else if (this.loadFracFront > PHYS.STOPPIE_LOAD && this.speed > 6) {
        const over = (this.loadFracFront - PHYS.STOPPIE_LOAD) / (0.92 - PHYS.STOPPIE_LOAD);
        wheelieTarget = -Math.min(PHYS.STOPPIE_MAX, over * PHYS.STOPPIE_MAX);
      }
    }
    this.wheelie += (wheelieTarget - this.wheelie) * Math.min(1, h * PHYS.WHEELIE_RATE);
    if (Math.abs(this.wheelie) < 1e-4) this.wheelie = 0;
    this.loadFracRear = 1 - this.loadFracFront;

    // Suspension: driven by the same transfer, plus the surface. `surfaceInput`
    // is set by whoever owns the road (the level samples its own height), and it
    // is what makes a rough verge shake the bike while tarmac is smooth.
    const suspTargetFront = THREE.MathUtils.clamp(-transfer * 2.4 * PHYS.SUSP_TRAVEL + this.surfaceInput, -PHYS.SUSP_TRAVEL, PHYS.SUSP_TRAVEL);
    const suspTargetRear = THREE.MathUtils.clamp(transfer * 2.4 * PHYS.SUSP_TRAVEL + this.surfaceInput, -PHYS.SUSP_TRAVEL, PHYS.SUSP_TRAVEL);
    // a damped spring toward the target: this is a real second-order system, so
    // the bike overshoots slightly and settles, rather than snapping
    const springStep = (val, vel, target) => {
      const acc = (target - val) * PHYS.SUSP_K * h - vel * PHYS.SUSP_C * h;
      const nv = vel + acc;
      return [val + nv * h, nv];
    };
    [this.suspFront, this.suspVelF] = springStep(this.suspFront, this.suspVelF, suspTargetFront);
    [this.suspRear, this.suspVelR] = springStep(this.suspRear, this.suspVelR, suspTargetRear);
    // A damped spring integrated at a fixed step is stable, but a large impulse
    // can still push it out of range for a frame. Clamp rather than trust it.
    const TR = PHYS.SUSP_TRAVEL * 1.6;
    this.suspFront = THREE.MathUtils.clamp(this.suspFront, -TR, TR);
    this.suspRear = THREE.MathUtils.clamp(this.suspRear, -TR, TR);
    this.suspVelF = THREE.MathUtils.clamp(this.suspVelF, -TR * 30, TR * 30);
    this.suspVelR = THREE.MathUtils.clamp(this.suspVelR, -TR * 30, TR * 30);

    // ---- 2b. THE STEER ANGLE (the bicycle model's delta) -------------------
    //
    // The bar input above is a LEVEL; what the machine actually holds is an
    // ANGLE at the front contact patch. Two things set it:
    //
    //   1. The rider's bar input, scaled to the angle the tyre can usefully
    //      hold at this speed. A real bike's usable steer angle collapses with
    //      speed -- at 50 m/s the front wheel is turned barely two degrees -- and
    //      that is not a limitation of the rider, it is what the geometry and
    //      the gyroscopic terms allow. It is also exactly why a fast bike feels
    //      reluctant, and it now falls out of the model rather than being
    //      hand-applied.
    //
    //   2. TRAIL. The contact patch trails the steering axis, so the tyre is a
    //      caster and it steers itself toward the direction of travel with a
    //      force that grows with speed. This is the physical self-centring that
    //      every rider relies on, and it is genuinely a force rather than a
    //      convenience: it is why a bike straightens when you relax your grip.
    //
    // The angle is a first-order response toward the input target with the trail
    // term pulling it back. Both are rates, so it is stable at any timestep.
    const steerMax = THREE.MathUtils.lerp(
      PHYS.STEER_MAX_SLOW, PHYS.STEER_MAX_FAST,
      Math.min(1, this.speed / PHYS.STEER_MAX_REF));
    // What the rider is asking the wheel to do. The trail target is the angle
    // that makes the front wheel roll along the path the bike is already taking,
    // which for a bike tracking its heading is zero -- so the trim is simply
    // "align with travel", i.e. reduce the *slip*, not the steer.
    const steerTarget = this.steer * steerMax;
    const trailRate = PHYS.TRAIL_ALIGN * Math.min(1, this.speed / PHYS.TRAIL_REF);
    const trailPull = -this.steerAngle * trailRate;
    // A caster straightens toward zero steer as the wheel rolls; the rider's
    // input fights it. This is a rate, so a stopped bike keeps whatever angle
    // the bars are held at (correct: a stationary bike does not self-centre).
    //
    // FIRST-ORDER, and it must be. An earlier pass added a separate
    // `steerAngleVel` integrated with a `* 40` gain and MEASURED 0.626 rad at
    // 12 m/s against a target of 0.261 -- 2.4x the intended angle, because the
    // gain made the loop overshoot the speed-dependent limit it was meant to
    // respect. The steer angle is a kinematic response to the bars with a
    // first-order lag; it has no momentum of its own and does not need a spring.
    // `h * 16` is a 0.06 s time constant: fast enough that the wheel is where
    // the bars say, slow enough not to ring.
    const K = 16.0;
    this.steerAngle += (steerTarget - this.steerAngle) * Math.min(1, h * K);
    this.steerAngle += trailPull * h;
    this.steerAngle = THREE.MathUtils.clamp(
      this.steerAngle, -PHYS.STEER_MAX_SLOW, PHYS.STEER_MAX_SLOW);
    this.steerAngleVel = 0;

    // THE BICYCLE RELATION: yawRate = v * tan(delta) / L.
    //
    // This is the honest kinematic model, and it is what turns the bars into a
    // turn at low and moderate speed -- the regime where the lean relation is
    // weakest, because a nearly-stationary bike carries almost no lean. At
    // racing speed it grows large on paper (v/L is 35/s), which is exactly why
    // `steerMax` has collapsed the angle to a couple of degrees by then: the two
    // terms trade off and the bike turns by the right amount at every speed.
    //
    // Faded out at walking pace, where `tan` is fine but the rider is balancing
    // with his feet and the model does not apply.
    const bicycleYaw = (this.speed > 0.6)
      ? (this.speed * Math.tan(this.steerAngle) / PHYS.WHEELBASE) * PHYS.BICYCLE_GAIN
      : 0;

    // ---- 2. steering, lean and yaw ---------------------------------------
    // A bike does not steer like a car. Bar input sets a LEAN target, and the
    // lean is what turns it. Steering authority falls with speed, which is why
    // a fast bike feels reluctant to change direction.
    const speedFrac = Math.min(1, this.speed / topSpeed);
    const authority = THREE.MathUtils.lerp(1.0, PHYS.STEER_RATE_FAST / PHYS.STEER_RATE, speedFrac);
    // Bar input ramps rather than snapping. h*10 reached 63% of full lock in a
    // tenth of a second, which on a keyboard is indistinguishable from a step.
    // THE AI READS THE ROAD. Since the road no longer turns the bike for it (see
    // ROAD_CARRY), a rider has to lean into every bend -- a human sees it
    // coming, but the pack's controllers only corrected the lateral ERROR after
    // the bike had already run wide (MEASURED: up to 0.93 m off line in the
    // twisties, and a lot more traffic wrecks). So non-player bikes add the lean
    // the bend needs as a feed-forward: tan(lean) = k v^2 / g, mapped back
    // through the same targetLean = steer * LEAN_MAX * speedLean used below.
    let steerIn = steer;
    if (!this.arcade && this._kappa && this.speed > 4) {
      const sl = 0.30 + 0.70 * Math.min(1, this.speed / 20);
      const leanNeed = Math.atan(this._kappa * this.speed * this.speed / PHYS.GRAVITY) / Math.max(0.2, PHYS.TURN_GAIN);
      steerIn = THREE.MathUtils.clamp(steer + PHYS.AI_FF * leanNeed / (PHYS.LEAN_MAX * sl), -1, 1);
    }
    this.steer += (steerIn - this.steer) * Math.min(1, h * PHYS.STEER_SMOOTH);

    // The lean needed to hold a given corner tightens with speed; at a
    // standstill there is nothing to lean against.
    const speedLean = 0.30 + 0.70 * Math.min(1, this.speed / 20);
    const targetLean = this.steer * PHYS.LEAN_MAX * speedLean;
    // ---- THE LEAN IS A DAMPED SPRING, NOT A LAG ---------------------------
    //
    // This was first-order: `lean += (target - lean) * h * LEAN_RATE`. A
    // first-order response cannot overshoot and has no momentum, so the bike
    // arrived at its lean and stopped dead -- it read as a sticker following the
    // key rather than as a machine with weight.
    //
    // MEASURED with harness/_feelphysics.mjs: the steer reached 90% of its range
    // at 0.417 s, but the lean did not peak until 1.20 s. A 0.78 s gap is three
    // to five times the 0.15-0.25 s that reads as a motorcycle, and that gap IS
    // the "floaty" complaint.
    //
    // A second-order spring fixes both halves at once: it settles faster for a
    // given stiffness AND it carries the small overshoot that the eye reads as
    // momentum. `leanVel` is carried so the system has state; the clamps stop a
    // large impulse from flinging it.
    const leanAcc = (targetLean - this.lean) * PHYS.LEAN_STIFF - this.leanVel * PHYS.LEAN_DAMP;
    this.leanVel = THREE.MathUtils.clamp(this.leanVel + leanAcc * h, -12, 12);
    this.lean = THREE.MathUtils.clamp(this.lean + this.leanVel * h, -PHYS.LEAN_MAX * 1.3, PHYS.LEAN_MAX * 1.3);

    // HOW A LEAN BECOMES A YAW RATE, and this was wrong by a factor of 180.
    //
    // The old line was `tan(lean) * (speed / WHEELBASE)`. That is the bicycle
    // model, `yawRate = v * tan(delta) / L` -- and `delta` in it is the STEER
    // angle at the front contact patch, not the lean angle. Feeding the lean in
    // is a category error, and because the wheelbase is only 1.40 m it divides
    // by a small number as well. MEASURED at 50 m/s and full lean it asked for
    // **31.3 rad/s**, five revolutions per second. `yawOffset`'s self-centring
    // caps it at yawRate/3.4, so the bike pinned against its +/-1.9 rad clamp
    // within a frame or two of any steering input.
    //
    // That is the "the left/right keys turn it far too fast" complaint, and it
    // is very likely also §5.5's silent drift into the rail: a heading 1.9 rad
    // off the road does not read as steering, it reads as a bug.
    //
    // The correct relation for a motorcycle comes from the steady-turn balance,
    // not from the bicycle model. Leaning at `theta`, gravity and centripetal
    // acceleration balance when `tan(theta) = v^2 / (g * R)`, and the yaw rate
    // is `v / R`, so:
    //
    //     yawRate = g * tan(lean) / v
    //
    // which gives 0.172 rad/s in the case above -- a 291 m radius at 112 mph,
    // which is a real motorway sweep. Note it falls with speed on its own, so
    // the "fast bikes feel reluctant" behaviour the old comment wanted is now a
    // property of the physics instead of a hand-applied authority curve.
    //
    // The divisor is floored: below a walking pace the relation goes to
    // infinity, and at those speeds the bars are what turn the bike anyway.
    const leanTurn = PHYS.GRAVITY * Math.tan(this.lean) * PHYS.TURN_GAIN
                     / Math.max(PHYS.TURN_MIN_SPEED, this.speed);
    const counter = (this.speed > 6)
      ? -this.lean * PHYS.COUNTERSTEER_GAIN * 0.0   // lean already encodes the turn
      : 0;
    // Direct bar steering, and it must FADE OUT. It was scaled by
    // `(0.5 + 0.5*min(1, speed/16))`, i.e. it grew with speed and at 50 m/s
    // contributed 0.72 rad/s -- four times the whole lean term, which would put
    // the 180x bug straight back. Above ~18 m/s a motorcycle is steered by lean
    // alone; this is the parking-lot term.
    //
    // `steerAngle` IS THE REAL ONE NOW, so this is a residual only. The bicycle
    // model above (2b) already turns the bars into yaw through `bicycleYaw`, and
    // it is the physically correct path. This term used to be the sole
    // representation of "the bars do something", which is why it had to be
    // hand-faded and hand-scaled. With `delta` modelled it is reduced to a small
    // low-speed trim so the very slow regime -- where `bicycleYaw` fades out --
    // still has bar authority, and so the arcade assist has something to blend
    // with. Keeping both at full strength would double-count the bar.
    const steerYaw = this.steer * PHYS.STEER_RATE * authority * PHYS.STEER_AUTHORITY
                     * Math.max(0, 1 - this.speed / PHYS.BAR_STEER_FADE) * 0.25;
    // ARCADE ASSIST, adapted from mini-driving-simulator-3d (MIT licence,
    // Liane Heidemann) -- github.com/lianeheidemann/mini-driving-simulator-3d.
    //
    // Its whole steering model is one line:
    //
    //   car.rotation.y -= steering * min(|v|/3, 1) * sign(v) * 1.5 * dt
    //
    // The part worth having is the DIRECTNESS: yaw answers the key immediately
    // rather than waiting for a lean to build, which is what an arcade racer
    // feels like and what Road Rash felt like.
    //
    // The part that cannot come across is the constant. `min(|v|/3, 1)`
    // saturates at 3 m/s, so above walking pace it asks for a flat 1.5 rad/s at
    // any speed. At that project's 16.7 m/s top speed this is an 11 m radius --
    // fine. At ours it is a 35 m radius at 52 m/s, which is 7.8 g, and it is
    // precisely the "the keys turn it far too fast" bug that 5.11 removed.
    //
    // So the constant rate becomes a LATERAL ACCELERATION budget. Asking for
    // `ARCADE_LAT_G` g of cornering gives `a/v` rad/s, which is the same idea
    // expressed in a form that survives an eightfold change in top speed: 0.22
    // rad/s at 52 m/s, 1.13 rad/s at 10 m/s. Their low-speed ramp is kept as-is,
    // because that part is speed-independent and correct.
    //
    // PLAYER ONLY, and this cost a run of _nondet.mjs to learn. BikePhys drives
    // the rivals too, so blending the assist in unconditionally made the whole
    // AI pack corner half again as hard. They pushed the player into the rail
    // and the §5.5 pinning came straight back: 143, 255 and 256 pinned frames
    // across four runs, with distance collapsing from ~140 m to 46 m. The gate
    // still passed -- it does not test this -- which is exactly why §7 says to
    // run _nondet after ANY physics change.
    //
    // An assist is an input aid for a human on a keyboard. The AI does not need
    // one and must not have one.
    const arcadeYaw = this.arcade
      ? this.steer * Math.min(this.speed / 3, 1)
        * Math.min(PHYS.ARCADE_YAW_MAX,
                   PHYS.ARCADE_LAT_G * PHYS.GRAVITY / Math.max(PHYS.TURN_MIN_SPEED, this.speed))
      : 0;
    // Blended, not replaced: the lean model is what makes this a motorcycle
    // rather than a car, and it still carries the weight transfer, the slides
    // and the visual lean. The assist only sharpens the response.
    const mix = this.arcade ? PHYS.ARCADE_MIX : 0;
    let targetYawRate = leanTurn * (1 - mix) + arcadeYaw * mix + steerYaw + counter + bicycleYaw;

    // YOU CANNOT STEER WHAT IS NOT TOUCHING THE GROUND. A wheel in the air
    // makes no side force, so the verbs above have to cost authority or they
    // are free: a wheelie that handles normally is a pose, and a jump you can
    // steer through is a ramp. Both now commit you to the line you left on.
    if (this.airborne) targetYawRate *= PHYS.AIR_STEER;
    else if (this.wheelie > 0.05) {
      const up = Math.min(1, this.wheelie / PHYS.WHEELIE_MAX);
      targetYawRate *= (1 - up * (1 - PHYS.WHEELIE_STEER));
    }

    // Yaw inertia: the bike resists a sudden change of direction, and slides
    // (below) reduce the authority available.
    const grip = this.grip;
    const yawAccel = (targetYawRate - this.yawRate) * (PHYS.INERTIA_YAW / 18) * grip;
    this.yawRate += yawAccel * h;

    // ---- THE TYRE'S OWN YAW MOMENT: WHAT MAKES A SLIDE RECOVER ------------
    //
    // Everything above this line is KINEMATIC: `targetYawRate` is a function of
    // the bars, the lean and the speed, and it does not know the bike is sliding.
    // The side force computed in step 3 changes `lateralV` and nothing else. That
    // decoupling is a real hole, and it is why a lane change never settles:
    // MEASURED in harness/_lanesettle.mjs, the bars come back to centre and the
    // heading returns to zero in half a second, but the bike is still carrying
    // 2.3 m/s of lateral velocity several seconds later, with the tyres upright
    // and able to make 60 m/s^2 of force. The force was there; nothing connected
    // it to the heading.
    //
    // On a real motorcycle the rear tyre's side force acts BEHIND the centre of
    // mass, at the wheelbase, so it turns the bike -- this is the mechanism by
    // which a sliding bike recovers and by which it steers at all. The moment is
    // `F_rear_side * a`, with `a` the CG-to-rear distance, giving a yaw
    // acceleration `F_rear_side * a / I_z`. A yaw rate in the direction the
    // VELOCITY is already going rotates the heading toward the velocity vector,
    // which is exactly the restoration the model was missing.
    //
    // Applied as a yaw-rate term (rad/s per rad of slip) rather than as a raw
    // moment so it composes with the existing inertia and cannot fight the
    // kinematic steering: it is a RESTORING term that fades to nothing when the
    // bike is not sliding, so a straight line and a steady corner are unchanged.
    const slideSlip = this.slipRear;                  // rad; zero when not sliding
    // SIGN, derived twice because this is where sign errors live. With the bike
    // x-axis forward and y to its right: a positive rear slip means the tyre is
    // toed right of its path and makes force to the right. That force acts at
    // the rear contact patch, i.e. at r = -a·x̂ from the CG, so the yaw moment is
    // M_z = r_x·F_y = -a·F, which is NEGATIVE -- the nose rotates left, back
    // toward the path the bike was pointing away from. Cross-checked against the
    // existing lateral force, which already treats positive slip as force to the
    // right. So the sign is MINUS.
    const slideYaw = -slideSlip * PHYS.SLIDE_YAW_GAIN;
    this.yawRate += (slideYaw - this.yawRate) * Math.min(1, h * PHYS.SLIDE_YAW_RATE) * grip;

    this.yawOffset += this.yawRate * h;
    // The heading is measured RELATIVE TO THE ROAD, and it must be bounded: a
    // bike that has turned 90 degrees to the tarmac is not cornering, it is
    // crashing. Holding steer used to drive yawOffset without limit (measured
    // 16 rad and still climbing), which pinned the rider against the rail and
    // made steering read as broken. Clamping at just past a right angle lets a
    // rider cross the road and spin out but never face permanently sideways.
    this.yawOffset = THREE.MathUtils.clamp(this.yawOffset, -1.9, 1.9);
    // SELF-CENTRING: THE BIKE RETURNS TO THE ROAD'S LINE WHEN THE RIDER LETS GO
    // -- NOT WHILE HE IS STILL LEANING.
    //
    // This was `yawOffset *= (1 - h*SELF_CENTRE)`, an unconditional decay of the
    // heading toward the road's direction. It is the reason the bike would not
    // turn, and the arithmetic is worth writing down because the symptom looked
    // like anything but a self-centring term.
    //
    // A lean at `lean` asks for a yaw rate `g*tan(lean)/v`. Holding full lean at
    // 18 m/s that is 0.48 rad/s -- a 37 m radius, which is correct. But the decay
    // pulls `yawOffset` back at 1.9/s, so the two reach equilibrium at
    // `0.48/1.9 = 0.25 rad`. At that point d(yawOffset)/dt = 0, and on a straight
    // road `roadYaw` is constant, so the bike's WORLD HEADING stops changing
    // entirely: it travels in a straight line while pointing 15 degrees sideways.
    //
    // MEASURED in the live page at 17.9 m/s and full lean: `yawOffset` settled at
    // 0.301 rad, which would move the bike sideways at `v*sin(0.30) = 5.3 m/s` if
    // it were tracking -- and it actually moved at 0.99 m/s, a factor of 5.4. The
    // bike was crabbing down the road, not cornering. That is "it does not turn".
    //
    // The correct model, and the one every rider already knows: the heading the
    // bike holds in a corner is the one the LEAN implies, and it holds it for as
    // long as the rider keeps leaning. Self-centring is what happens when the
    // lean goes away. So the decay targets the lean's own heading rather than
    // zero:
    //
    //     yawOffset_ss = yawRateFromLean / SELF_CENTRE
    //
    // At full lean that is 0.25 rad, which is the same number as before -- but it
    // is now the value the heading SETTLES ON while cornering instead of the
    // value at which the bike mysteriously stops turning. Release the bars, the
    // lean springs back to zero, the target goes to zero, and the bike straightens
    // exactly as it did. Nothing else about the feel changes.
    //
    // SELF_CENTRE still sets how hard the bike returns to straight running, which
    // is the job it was given.
    //
    // IT MUST YIELD WHILE THE BARS ARE HELD, or it is still a heading CAP. The
    // decay above runs at full rate whatever the rider is doing, so the heading
    // obeys d(yo)/dt = yawRate + leanTurn - SELF_CENTRE*yo and settles at
    // (yawRate + leanTurn)/SELF_CENTRE -- about 0.20 rad (11.4 deg) at 45 m/s.
    // MEASURED on a fresh BikePhys at 45 m/s, full left lock, fixed 1/120 step:
    // 11.4 deg after 1.5 s and only 13.0 deg after 3.0 s. The bike was not
    // turning a 0.2 rad/s corner, it was crabbing at a fixed angle to the road:
    // the same "it does not turn" bug the paragraph above describes, half fixed.
    // Identical at 1/60, 1/30, 1/20 and the 0.05 frame clamp (the fixed-step
    // accumulator makes it framerate-independent), so it is the model, not noise.
    //
    // Self-centring is what the bike does when the rider LETS GO -- trail and
    // the lean spring bringing it upright. So it is scaled back by how hard the
    // bars are being held: released bars get the full rate (straightening is
    // unchanged), held full lock keeps (1 - CENTRE_YIELD) of it so a long hold
    // still converges instead of running to the 1.9 rad clamp. `this.steer` is
    // the smoothed bar, so the rate returns as the bars come back, not in a step.
    // THE PLAYER DOES NOT GET AN AUTOPILOT. This term aligns the heading with the
    // ROAD, and the lane hold below pulls toward the centreline; at full strength
    // the two together rode every bend for a rider with no hands on the bars
    // (MEASURED: a whole race at lateral 0.0 holding only the throttle). The AI
    // keeps them -- it steers itself anyway -- and the player keeps a fraction,
    // enough to stop a slow creep on a straight but not enough to take a bend.
    const autopilot = this.arcade ? PHYS.PLAYER_AUTOPILOT : 1;
    const yawCentreBase = (this.onRoad ? PHYS.SELF_CENTRE : PHYS.SELF_CENTRE_OFF) * autopilot;
    const yawCentre = yawCentreBase * (1 - PHYS.CENTRE_YIELD * Math.min(1, Math.abs(this.steer)));
    const holdHeading = leanTurn / Math.max(0.3, yawCentreBase);
    this.yawOffset += (holdHeading - this.yawOffset) * Math.min(1, h * yawCentre);

    // LANE HOLDING. `lateral` is measured from the road's centreline, and the
    // bike travels along its own heading -- so a heading that differs from the
    // road's direction by even a fraction of a degree drifts the rider sideways
    // without anything appearing to be wrong. On a curving road that is a slow,
    // silent slide into the guard rail: measured lateral 0 -> 5.45 m with ZERO
    // contacts, and the rider pinned there. The counter-steer below is what a
    // real rider does unconsciously, and it makes a straight line actually
    // straight.
    if (this.onRoad) {
      // steer back toward where the rider was pointed, damped by speed so it
      // LANE HOLDING, and it must NOT FIGHT THE BARS.
      //
      // This is the second half of the "will not turn" bug. It pulls `lateralV`
      // toward zero -- the centreline -- at 0.45/s *whatever the rider is doing*,
      // so holding full lean the bike was dragged back toward the middle as fast
      // as it moved off it. MEASURED at 18 m/s full lean: lateral speed 0.99 m/s
      // where tracking the heading would give 5.3 m/s. Along with the unconditional
      // self-centring above, this is what pinned the bike to a straight line.
      //
      // Its real job is the one the comment always gave it: stop a bike with NO
      // steering input from accumulating a slow silent drift into the rail over a
      // long straight (measured 0 -> 5.45 m with zero contacts). That job does not
      // exist while the rider is holding a steering input, so the term is scaled by
      // how much steering is NOT being asked for. Hands off, full strength. Leaning
      // into a corner, it gets out of the way.
      const unsteered = 1 - Math.min(1, Math.abs(this.steer) / 0.25);
      this.lateralV -= this.lateral * h * PHYS.LANE_HOLD * unsteered * (this.arcade ? PHYS.PLAYER_AUTOPILOT : 1);
    } else {
      // OFF THE TARMAC, A RIDER STEERS BACK. The lane hold used to stop dead at
      // the road edge, so anyone knocked onto the verge tracked the barrier for
      // the rest of the race unless the player fought their way off it. That is
      // how a rival's shove turned into 125-280 pinned frames in _nondet, with
      // distance collapsing from ~140 m to 40 m and zero further contacts --
      // nothing was holding the bike there except the absence of this line.
      //
      // Deliberately weaker than the on-road hold and capped, so it reads as a
      // rider correcting rather than as the road magnetising the bike: it will
      // not save you from a bad line, only from being stranded.
      // Strength MEASURED, not guessed. At 1.6 this settled to 0.70 m/s of
      // inward drift, which a rival leaning on the rider once a second simply
      // cancelled -- _nondet still showed 100-180 pinned frames. At 4.2 the
      // rider is back on the tarmac inside a second even while being shoved,
      // which is the behaviour that matters: being knocked off the road should
      // cost you position and speed, never the rest of the race.
      // URGENCY GROWS WITH TIME STRANDED. A fixed pull is a fixed tug-of-war
      // against whatever put the rider there, and _nondet kept finding the
      // cases where the other side won: 115-165 pinned frames while rivals
      // leaned on the bike once a second. Scaling with `offRoadTimer` leaves a
      // brief excursion feeling exactly as it did -- you ran wide, you lost
      // time -- while making a PERMANENT strand impossible, because the
      // correction outgrows anything holding it within about two seconds.
      const urgency = Math.min(3.0, 1 + this.offRoadTimer * 1.1);
      const pull = Math.sign(this.lateral) * Math.min(1.0, Math.abs(this.lateral) * 0.22);
      this.lateralV -= pull * h * 4.2 * urgency;
    }

    // ---- 3. tyres: lateral slip -------------------------------------------
    // The bike's velocity has a sideways component whenever its heading and its
    // path disagree. That disagreement IS the slip angle, and the tyre responds
    // to it — this is the whole reason the handling feels like a vehicle.
    // SLIP IS HEADING MINUS THE DIRECTION OF TRAVEL -- and the direction of
    // travel is not the road.
    //
    // This used to read `slip = this.yaw - (this.yaw - this.yawOffset)`, i.e.
    // slip == yawOffset: it assumed the bike's velocity was ALWAYS along the
    // road, so every degree of heading away from the road counted as sliding.
    // A bike that points 3 degrees off the centreline is not sliding at 3
    // degrees; it is TRACKING, and it arrives 2.5 m over in a second. The model
    // had no way to express that, so lateral motion could only ever come from
    // tyre slide -- which is why steering felt disconnected and why the only
    // way to make it move was to give the tyres 7x too much grip.
    //
    // Now the slip angle is measured against the bike's ACTUAL velocity, which
    // closes the loop: heading off-axis -> slip -> side force -> lateral
    // velocity -> the velocity rotates toward the heading -> slip falls to
    // zero. The bike settles into tracking where it points, and real sliding is
    // what is left over when the tyre cannot supply the force.
    const fwdV = Math.max(1, this.speed * Math.cos(this.yawOffset));
    const pathAngle = Math.atan2(this.lateralV, fwdV);
    const slip = this.yawOffset - pathAngle;
    // Published for the renderer's rear-contact pivot (see rearPivotShift).
    this.headingSlip = slip;
    // The load on each tyre is NOT the static split any more: it is whatever the
    // weight transfer above left there. A tyre carrying its load makes more
    // force, so braking into a corner genuinely tightens the front and loosens
    // the rear, which is the whole feel of riding a motorcycle fast.
    const loadFront = loadN * this.loadFracFront;
    const loadRear = loadN * this.loadFracRear;
    // TYRE RELAXATION LENGTH. A tyre does not make its side force the instant
    // the slip angle appears: the carcass has to distort, and the force builds
    // over a characteristic distance of travel -- about half a metre for a
    // motorcycle tyre. Without it, side force is an algebraic function of the
    // current slip angle and the bike responds to the bars in a single step,
    // which is a large part of what "too sensitive" means.
    //
    // This is the standard first-order lag in travelled DISTANCE rather than in
    // time, which is why it behaves correctly across the speed range: at 52 m/s
    // half a metre is 10 ms, at 5 m/s it is 100 ms, and a bike genuinely is
    // sharper at speed. It is the one piece the Whipple-Carvallo literature and
    // every serious tyre model agree on that this simulation did not have.
    const targetF = slip * 0.6, targetR = slip;
    const relax = Math.min(1, (Math.abs(this.speed) * h) / PHYS.TYRE_RELAX);
    this.slipFront += (targetF - this.slipFront) * relax;
    this.slipRear += (targetR - this.slipRear) * relax;

    this.grip = (this.onRoad ? PHYS.ONROAD_GRIP : PHYS.OFROAD_GRIP) * this.machine.grip;
    // THE FRICTION CIRCLE, NOW APPLIED THE WAY THE REFERENCE DEFINES IT.
    //
    // A tyre has ONE grip budget and it is shared between cornering and braking.
    // The standard (simple) combination, and the one to use when the model does
    // not have full combined-slip coefficients, is the ellipse
    //
    //     Fy = Fy0 · sqrt(1 - (Fx / Fx0)^2)
    //
    // where Fx is the actual LONGITUDINAL force and Fx0 the maximum it could be.
    // What was here multiplied the side force by sqrt(1 - gripDemand^2) instead,
    // and gripDemand is derived FROM the side force -- so the side force's clamp
    // depended on the side force. That is circular. It happened to be stable
    // because gripDemand is read one step stale, but a feedback hack that needs
    // a one-step delay to stay stable is not a physical constraint, and the two
    // quantities are not even the same thing: gripDemand is a lateral-g
    // fraction, while the circle is about longitudinal force.
    //
    // Now the ratio is the real one: how much of the tyre's longitudinal budget
    // (mu · load) is in use. Straight-line braking or full throttle leaves
    // little for the side, which is the trail-braking and power-slide behaviour
    // the game is about; cruising upright leaves nearly all of it.
    const mu = PHYS.TYRE_LAT_PEAK * this.grip;
    const Fx0 = Math.max(1, mu * loadN);                 // max longitudinal force
    const fxFrac = Math.min(0.98, Math.abs(FxTyre) / Fx0);
    this.gripCircleHeadroom = Math.sqrt(Math.max(0, 1 - fxFrac * fxFrac));
    const circle = Math.max(0.15, this.gripCircleHeadroom);
    const Ffront = tyreForce(this.slipFront, loadFront, this.grip) * circle;
    const Frear = tyreForce(this.slipRear, loadRear, this.grip) * circle;

    // ---- CAMBER THRUST: the force a leaning tyre makes with the bars straight
    //
    // This is the biggest single thing a motorcycle tyre does that this model
    // did not have at all, and it is not a refinement -- on a bike it can be the
    // LARGEST contributor to the centripetal force, and in the limit (a tyre
    // leaned over with no steer input) it is the SOLE contributor. It is why a
    // motorcycle can hold an automobile's cornering radius with a much smaller
    // steering angle than the bicycle model `yawRate = v·tan(δ)/L` would predict.
    //
    // Mechanism: a leaned, rolling tyre's tread elements would naturally follow
    // an elliptical path projected on the ground. Forced instead to follow the
    // straight path the contact patch is on, the tread and carcass deform, and
    // the deformation is transmitted as a force in the direction of the lean.
    // On a motorcycle the camber angle IS the lean angle, since the whole
    // vehicle rolls about its contact patch.
    //
    // The measured properties (Cossalter, Pacejka, both cited on the camber-thrust
    // page) that dictate how it must be implemented:
    //   - APPROXIMATELY LINEAR in camber angle for small angles: F = C_camber·γ.
    //     C_camber is the camber stiffness and, as with cornering stiffness, it is
    //     published per unit load, so it survives a load or grip change.
    //   - IT HAS NO RELAXATION LENGTH, and reaches its steady value "nearly
    //     instantaneously" after a camber change. So it must NOT go through the
    //     `slipFront`/`slipRear` relaxation lag that the slip-angle force does --
    //     it is a function of the CURRENT lean, evaluated directly.
    //   - It is subject to the SAME friction circle: it is side force, it comes
    //     out of the same grip budget, and it must be scaled by `circle`.
    //
    // Sign: a positive `lean` tips the bike's top to its RIGHT (see the lean-sign
    // work in player.js), and the force is in the direction of the lean, so a
    // positive lean needs a positive (rightward) force here. The existing lateral
    // force already treats positive as "to the right", so the sign is a plain
    // plus -- but it is asserted, not assumed: `_camberverify.mjs` checks that
    // leaning right produces rightward force.
    // The stiffness is derived from the cornering requirement; see CAMBER_STIFF.
    const camberStiff = CAMBER_STIFF * loadN * this.grip;
    // A tyre leaned past ~45 deg cannot keep gaining force -- the contact patch
    // geometry stops rewarding it -- so the linear law is faded out toward
    // CAMBER_MAX_LEAN rather than run to the LEAN_MAX clamp, which would keep
    // adding force right up to the point the bike is on its side.
    const leanFrac = Math.min(1, Math.abs(this.lean) / PHYS.CAMBER_MAX_LEAN);
    const camberFade = 1 - leanFrac * leanFrac * PHYS.CAMBER_FADE;
    const Fcamber = Math.sign(this.lean) * camberStiff * Math.abs(this.lean) * camberFade * circle;
    // The front tyre carries more camber than the rear when the bike is steered
    // into the lean (the front is what initiates the roll), which is why a bike
    // turns in at all; the rear follows. This split is a small refinement on top
    // of the dominant effect and is exposed so it can be measured.
    const camberFront = Fcamber * PHYS.CAMBER_FRONT_SHARE;
    const camberRear = Fcamber * (1 - PHYS.CAMBER_FRONT_SHARE);

    // ---- TYRE LATERAL DAMPING. See PHYS.TYRE_LATERAL_DAMP. ---------------
    //
    // A damper on the lateral velocity, scaled by load and by grip, and
    // physically it is the carcass hysteresis that every real tyre has and this
    // model did not. It is the term that brings the lateral mode's damping ratio
    // from 0.25 up to about 0.7, which is the difference between a bike that
    // wallows down the road and one that settles in a third of a second.
    //
    // A damper on the lateral velocity. The coefficient is
    // `TYRE_LATERAL_DAMP * load / TYRE_RELAX`: a rate of change of slip angle
    // (slip rate = lateralV / relaxation length) times the tyre's slip
    // stiffness, which is the standard formulation and is why it scales with
    // load rather than being a bare chassis number.
    const dampCoef = PHYS.TYRE_LATERAL_DAMP * loadN / PHYS.TYRE_RELAX;
    const Fdamp = -this.lateralV * dampCoef * this.grip;
    const FdampFront = THREE.MathUtils.clamp(Fdamp * this.loadFracFront, -loadFront * PHYS.TYRE_LAT_PEAK, loadFront * PHYS.TYRE_LAT_PEAK);
    const FdampRear = THREE.MathUtils.clamp(Fdamp * this.loadFracRear, -loadRear * PHYS.TYRE_LAT_PEAK, loadRear * PHYS.TYRE_LAT_PEAK);

    // Side force changes the lateral velocity. Divided by mass this is a real
    // acceleration, so the bike slides rather than stepping. The camber thrust is
    // side force and joins the sum on equal footing -- it is the term that makes
    // a leaned bike turn without the bars, so leaving it out of the velocity
    // update would have been a silent no-op. Published for the harness.
    this.camberForce = Fcamber;
    const sideForce = Ffront + Frear + camberFront + camberRear + FdampFront + FdampRear;
    this.lateralV += (sideForce / PHYS.MASS) * h;
    this.lateral += this.lateralV * h;
    // Only a light damping now. The slip feedback above is what limits lateral
    // velocity -- as `lateralV` rises, `pathAngle` rises, the slip angle falls
    // and the force with it. The old 4.2/s was doing that job artificially,
    // and stacked on top of the new loop it would stop the bike tracking at all.
    //
    // SCALED BY PHYS.LATERAL_DAMP, which is the feel-budget knob for how much
    // "weight" a lane change has. The old hard-coded 0.8 is that knob's default,
    // so this is a no-op at the default and a one-line tuning surface after.
    this.lateralV *= (1 - h * (PHYS.LATERAL_DAMP * grip));

    // ---- 4. surfaces ------------------------------------------------------
    const halfRoad = edgeFor(this.s, this.lateral);
    const wasOnRoad = this.onRoad;
    if (Math.abs(this.lateral) > halfRoad) {
      this.onRoad = false;
      this.offRoadTimer += h;
      // scrub speed in the dirt proportionally, not by a flat multiplier
      this.speed -= Math.min(this.speed, PHYS.MASS * 0.9 * h / PHYS.MASS * 3.0);
    } else {
      this.onRoad = true;
      this.offRoadTimer = 0;
    }

    // LAST-RESORT RESCUE, and it is positional on purpose.
    //
    // Everything above this is a force, and a force is a tug-of-war: every
    // version of the off-road pull was eventually out-muscled by a rival
    // leaning on the bike once a second, and _nondet kept returning 95-198
    // pinned frames with the race distance collapsing from ~140 m to 56 m.
    // Raising the force further starts to make ordinary excursions feel
    // magnetic, which is worse than the bug.
    //
    // So after `STRAND_TIME` seconds still off the tarmac, the rider is walked
    // back toward it directly, at a bounded rate. It cannot fail to converge
    // because nothing opposes a position write. The trigger is deliberately
    // long: a normal run wide is over in well under a second, so this only ever
    // fires on a rider who is genuinely stuck, and by then being returned to
    // the road at a crawl has already cost them the places it should.
    if (this.offRoadTimer > PHYS.STRAND_TIME && Math.abs(this.lateral) > halfRoad - 0.9) {
      // RETURN THEM PROPERLY, not to the white line. Stopping 5 cm inside the
      // edge left the bike balanced on the boundary, flicking in and out of
      // `onRoad` and taking the off-road drag penalty most frames: rescued runs
      // still showed maxV 17.7 against a clean 42. Aim well inside the tarmac.
      const target = halfRoad - 0.9;
      const step = Math.min(PHYS.STRAND_RATE * h, Math.abs(this.lateral) - target);
      this.lateral -= Math.sign(this.lateral) * step;
      if (this.lateralV * Math.sign(this.lateral) > 0) this.lateralV = 0;
    }
    // guard rail: a real impulse response, not a positional clamp. The bike
    // slides along the rail and loses speed proportional to how hard it hit,
    // which is why scraping a wall at a shallow angle is survivable and hitting
    // it square is not.
    const wall = halfRoad + CFG_KERB_W + 0.9;
    const railHit = this.hitRail(wall);
    this.hitWall = railHit > 0.4;

    // ---- 4b. AIRBORNE ------------------------------------------------------
    //
    // The bike used to be welded to `centreAt(z).y`: it tracked the road's
    // surface exactly, however fast the road fell away. Now the road runs to
    // 5.6% gradient with a crest roughly every 75 m (§5.14), and a crest taken
    // at 50 m/s is a jump -- the wheels simply cannot follow the surface down.
    //
    // The test is honest rather than scripted: measure how fast the road is
    // dropping beneath us in metres per second, and if it falls faster than
    // AIR_TRIGGER, stop following it and integrate under gravity instead. So
    // there is no jump list and no trigger volume; ride the same crest slowly
    // and nothing happens, which is exactly right.
    const roadY = this.pos.y;
    if (this.lastRoadY === null) this.lastRoadY = roadY;
    const roadFall = (this.lastRoadY - roadY) / Math.max(1e-4, h);   // +ve = dropping
    this.lastRoadY = roadY;

    if (this.airborne) {
      this.airTime += h;
      this.airVY -= PHYS.AIR_GRAVITY * h;
      this.airY += this.airVY * h;
      if (this.airY <= 0) {
        // Landing. The impact is the vertical speed we arrive with; a heavy one
        // costs grip and speed, which is what makes a crest something to judge
        // rather than something to hold the throttle through.
        this.landHit = Math.abs(this.airVY);
        this.airborne = false;
        this.airY = 0; this.airVY = 0; this.airTime = 0;
        if (this.landHit > PHYS.AIR_LAND_HARD) {
          const over = (this.landHit - PHYS.AIR_LAND_HARD) / PHYS.AIR_LAND_HARD;
          this.speed *= Math.max(0.55, 1 - over * 0.30);
          this.suspFront = Math.min(PHYS.SUSP_TRAVEL, this.suspFront + over * 0.06);
          this.suspRear = Math.min(PHYS.SUSP_TRAVEL, this.suspRear + over * 0.06);
          // a bad landing unsettles the heading, it does not end the race
          this.yawRate += (Math.random() - 0.5) * Math.min(1.2, over) * 0.9;
        }
      }
    } else if (this.onRoad && roadFall > PHYS.AIR_TRIGGER && this.speed > 14) {
      this.airborne = true;
      this.airVY = Math.min(9, roadFall * 0.75);
      this.airY = 0.001;
      this.landHit = 0;
    }

    // ---- 5. integrate along the road --------------------------------------
    // The bike advances by the component of its velocity along the road, which
    // is what makes riding across the road cost you forward progress.
    const along = Math.cos(this.yawOffset);
    this.s += Math.max(0, this.speed * along) * h;
    this.wheelSpin += (this.speed / PHYS.WHEEL_R) * h;

    const roadYawBefore = this.roadYaw;
    this.sync();

    // THE ROAD TURNS; THE BIKE DOES NOT, UNLESS IT IS STEERED.
    //
    // `yawOffset` is measured against the road, so leaving it untouched while
    // the road bends silently turned the bike WITH the road: MEASURED, a whole
    // race holding only the throttle ran at lateral 0.0 through every bend. A
    // machine's world heading only changes when it yaws, so as the road turns
    // under it the heading RELATIVE to the road changes by the same amount.
    // With world yaw = roadYaw - yawOffset, holding the world heading means
    // yawOffset grows by the road's turn. Unsteered, a bike now runs wide in a
    // bend, and the rider has to lean it round -- which is the job.
    if (Number.isFinite(roadYawBefore) && PHYS.ROAD_CARRY > 0) {
      const d = Math.atan2(Math.sin(this.roadYaw - roadYawBefore), Math.cos(this.roadYaw - roadYawBefore));
      if (Math.abs(d) < 0.2) {
        // road curvature, 1/m, signed so that a positive value needs a positive
        // (rightward, +lateral) lean. The sign was MEASURED, not derived: the
        // other one doubled the AI's tracking error (see PHYS.AI_FF).
        const ds = Math.max(0, this.speed * along) * h;
        if (ds > 1e-4) this._kappa = -d / ds;
        this.yawOffset = THREE.MathUtils.clamp(this.yawOffset + d * PHYS.ROAD_CARRY, -1.9, 1.9);
        this.yaw = this.roadYaw - this.yawOffset;
        this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      }
    }
  }

  // Visual state, interpolated between the last two physics states. Rendering
  // never sees the raw simulation state, so visuals stay smooth at any frame
  // rate even though the physics is fixed-step.
  sample(alpha, outPos, outYawObj) {
    const a = PHYS.INTERP ? THREE.MathUtils.clamp(alpha, 0, 1) : 1;
    outPos.lerpVectors(this.prevPos, this.currPos, a);
    // shortest-arc yaw interpolation, or the bike spins the wrong way past +-pi
    let d = this.currYaw - this.prevYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const yaw = this.prevYaw + d * a;
    if (outYawObj) outYawObj.y = yaw;
    return { pos: outPos, yaw };
  }

  // The visual pose: everything the renderer needs that is not just position and
  // heading. Kept separate from sample() so a caller that only wants the
  // transform does not pay for the rest.
  pose() {
    return {
      lean: this.lean,
      // the bar input level AND the real front-wheel steer angle it produces.
      // The renderer wants the ANGLE for the front wheel and the fork; the HUD
      // wants the level.
      steer: this.steer,
      steerAngle: this.steerAngle,
      // suspension travel, in metres; the renderer pitches the bike by these
      suspFront: this.suspFront,
      suspRear: this.suspRear,
      // pitch from the difference between the two ends, which is what the eye
      // actually reads as "the bike braked"
      pitch: (this.suspRear - this.suspFront) * 0.9,
      loadFront: this.loadFracFront,
      loadRear: this.loadFracRear,
      contact: this.contactImpulse,
      // riding verbs, for the renderer and the HUD
      wheelie: this.wheelie,
      airY: this.airY,
      airborne: this.airborne,
      airTime: this.airTime,
      landHit: this.landHit,
      boost: this.boost,
      boostCool: this.boostCool,
      slipstream: this.slipstream,
    };
  }

  get mph() { return this.speed * 2.23694; }
  get maxSpeed() { return 61; }
  get slip() { return Math.abs(this.slipRear); }

  // A punch, a kick or a chain swing, as a real impulse.
  //
  // The old version took a single scalar and added it to `lateralV`, so every
  // attack did the same thing with a different magnitude: push the bike
  // sideways. That is why the combat had no weight — a chain to the back of the
  // head and a jab to the shoulder were the same event.
  //
  // An impulse has a DIRECTION. `along` is the component along the road (+ = the
  // target is shoved up the road, - = back down it) and `side` is across the
  // road. A chain swung at a rider ahead of you drags them BACKWARD; a kick
  // delivered from alongside shoves them ACROSS; a punch landed at the moment
  // they are turning unsettles the bike in yaw.
  //
  // `dir` is +1 if the target is ahead of the attacker, -1 if behind.
  /** Fire a boost charge. Returns true if it actually engaged. */
  tryBoost() {
    if (this.boost > 0 || this.boostCool > 0) return false;
    if (this.speed < PHYS.BOOST_MIN_SPEED) return false;
    this.boost = PHYS.BOOST_TIME;
    return true;
  }

  applyHit(push, opts = {}) {
    const along = (opts.along ?? 0) * (opts.dir ?? 1);
    const side = (opts.side ?? (opts.sign ?? 1)) * push;

    // Lateral: the shove across the road. This is what makes a rider run wide.
    // If we are already against the guard rail and the blow would drive us INTO
    // it, the lateral impulse is diverted into a forward one instead, so a rider
    // pinned on the barrier can still be pushed off it rather than being held
    // there forever.
    const half = edgeFor(this.s, this.lateral) + CFG_KERB_W + 0.9;
    const myRailSide = Math.abs(this.lateral) > half - 0.35 ? Math.sign(this.lateral) : 0;
    if (myRailSide !== 0 && side * myRailSide > 0) {
      this.speed += Math.abs(push) * 1.5;
      this.yawRate += myRailSide * Math.abs(push) * 0.30;
      this.lateralV -= myRailSide * Math.abs(push) * 0.55;
    } else {
      this.lateralV += side * 1.35;
    }

    // Longitudinal: a shove along the road changes SPEED, not position, so a
    // rider knocked from behind actually gets accelerated and one hit head-on
    // gets slowed. Multiplying speed here would scale with how fast they are
    // already going, so it is an additive impulse divided by mass.
    this.speed += along * push * 2.4;
    if (this.speed < 0) this.speed = 0;

    // Yaw: an off-centre hit spins the bike. The direction depends on which side
    // the blow landed, which is why a punch to the left shoulder turns you right.
    this.yawRate += (side >= 0 ? -1 : 1) * push * (opts.yaw ?? 0.85);

    // Being hit costs you a little of your own forward drive: neither rider
    // comes out of a scrap at full speed.
    this.speed *= (1 - Math.min(0.30, Math.abs(push) * 0.06 * (opts.scrub ?? 1)));

    // And it unsettles the suspension, which the renderer reads as a jolt.
    this.suspVelR += along * push * 0.9;
    this.suspVelF -= along * push * 0.5;
    this.contactImpulse = Math.max(this.contactImpulse, Math.abs(push) * 1.6);
    this.lastContact = null;

    // Nothing may leave applyHit non-finite: this is called from the combat
    // system every time a blow lands, and a NaN here reaches the renderer and
    // the Web Audio graph, where setTargetAtTime throws and takes the frame down.
    if (!Number.isFinite(this.speed)) this.speed = 0;
    if (!Number.isFinite(this.lateralV)) this.lateralV = 0;
    if (!Number.isFinite(this.yawRate)) this.yawRate = 0;
  }

  // -------------------------------------------------------------------
  // Bike-to-bike contact.
  //
  // Five riders share one road and, before this, passed straight through each
  // other — the single biggest reason the pack did not read as physical. This
  // resolves an overlap between two bikes as an IMPULSE: the relative velocity
  // along the contact normal is what determines how hard they are pushed and how
  // much speed is lost, so a gentle brush costs a little line while a hard
  // T-bone at ninety puts both riders down.
  //
  // `other` needs only { s, lateral, speed, lateralV } — this does not care
  // whether the other body is a BikePhys, a rival, or a wall proxy.
  // Returns the closing speed if contact happened, else 0.
  // -------------------------------------------------------------------
  contact(other) {
    // Guard the inputs. `other` is a BikePhys in practice, but this method is
    // written to accept any body-like object, and an undefined field here
    // propagates NaN through speed and lateral into the renderer and the audio
    // graph (which throws on a non-finite AudioParam and takes the frame down
    // with it). Failing closed is cheap; failing open is a black screen.
    const oS = Number.isFinite(other.s) ? other.s : 0;
    const oL = Number.isFinite(other.lateral) ? other.lateral : 0;
    const oV = Number.isFinite(other.speed) ? other.speed : 0;
    const oLv = Number.isFinite(other.lateralV) ? other.lateralV : 0;

    // Work in the road frame: `s` runs along the road, `lateral` across it.
    const ds = this.s - oS;
    const dl = this.lateral - oL;
    const r = PHYS.BODY_R * 2;
    const d2 = ds * ds + dl * dl;
    // MIN_SEP: never divide by a near-zero distance. Two bodies at the same
    // point produced an unbounded normal and flung each other at enormous
    // speed. Below this separation the normal is arbitrary, so pick the road
    // lateral axis as a stable fallback direction.
    const MIN_SEP = 1e-3;
    if (d2 > r * r) return 0;

    let nx, nl, d;
    if (d2 < MIN_SEP * MIN_SEP) {
      nx = 0; nl = 1; d = MIN_SEP;      // stack them across the road
    } else {
      d = Math.sqrt(d2);
      nx = ds / d; nl = dl / d;
    }
    const overlap = Math.max(0, r - d);

    // Relative velocity along the normal. This is the heart of it: two bikes
    // side by side with no closing speed barely interact, whereas a rear wheel
    // driving into a front wheel has a large closing component.
    const closing = (this.speed - oV) * nx + (this.lateralV - oLv) * nl;
    // If they are separating already, let them: one-sided contact.
    const approach = Math.max(0, -closing);

    // Push out of the overlap. Immediate positional separation prevents the
    // jitter you get from trying to fix interpenetration over several frames.
    // Split evenly so neither body teleports.
    this.lateral += nl * overlap * 0.5;
    this.s += nx * overlap * 0.5;
    if (other.lateral !== undefined) other.lateral -= nl * overlap * 0.5;
    if (other.s !== undefined) other.s -= nx * overlap * 0.5;

    // Impulse: reflect the closing velocity, scaled by restitution, plus a push
    // so riders are flung apart rather than gently nudged. CAPPED, because an
    // uncapped impulse at a 60 m/s closing speed would launch a rider across the
    // map, and because the whole point is that contact should cost you position,
    // not delete you.
    // MEASURED with harness/_trace.mjs on a straight, zero steering input:
    // `lateralV` swung between -8.3 and +15.6 m/s, `yawOffset` reached 0.57 rad
    // (33 degrees off the road), and the bike was against the barrier by t=5s
    // and off the tarmac for the rest of the run -- grip 1.00 -> 0.54, speed
    // 41 m/s -> 10. That is not a race, it is being shoved off the road by the
    // pack, and it is what "there is no friction, the motion is all wrong"
    // actually was.
    //
    // The cap was 9 m/s of SIDEWAYS velocity from a single contact. A bike and
    // rider are ~220 kg; nothing a rival can do at a few m/s of closing speed
    // moves that sideways at 9 m/s. Capped to 3.0 and split: contact should
    // cost you a line and a place, not the race.
    const j = Math.min(3.0, approach * (1 + PHYS.CONTACT_RESTITUTION) + approach * PHYS.CONTACT_PUSH * 0.12);

    // A SHOVE THAT WOULD DRIVE A RIDER THROUGH THE RAIL GOES ALONG IT INSTEAD.
    //
    // §5.5 fixed exactly this and fixed it in `applyHit`, which is the COMBAT
    // path. Bike-to-bike contact is a different function and never got the
    // guard, so a rival leaning on someone already against the barrier added
    // lateral velocity straight into it, `hitRail` cancelled it, and the next
    // frame added it again. MEASURED in _nondet: 125-195 pinned frames with 4-7
    // contacts and distance collapsing from ~140 m to 46 m.
    //
    // Being pushed into a wall has to be survivable. The impulse is not thrown
    // away -- it is turned into forward speed along the wall, which is what a
    // real scrape does.
    // A shove that would drive a rider through the rail is ABSORBED, not
    // redirected. An earlier version of this turned the blocked impulse into
    // forward speed (`speed += |j| * 0.8`, up to +7 m/s at the cap) on the
    // theory that a scrape converts sideways motion into sliding along the
    // wall. It does -- but it also ADDS ENERGY to a pack that is already in a
    // scrum, and measured contacts per five-second run went up rather than
    // down. Bleeding the impulse away is the conservative choice and the
    // correct one: the rider still loses the place, nothing gets launched.
    const blocked = (body, push) => {
      const railAt = edgeFor(body.s, body.lateral) + CFG_KERB_W + 0.9;
      const at = Math.abs(body.lateral) > railAt - 0.35 ? Math.sign(body.lateral) : 0;
      return at !== 0 && Math.sign(push) === at;
    };

    if (blocked(this, nl * j)) this.speed *= 0.97; else this.lateralV += nl * j;
    this.speed += nx * j * 0.55;
    if (other.lateralV !== undefined) {
      if (blocked(other, -nl * j)) other.speed *= 0.97; else other.lateralV -= nl * j;
    }
    if (other.speed !== undefined) other.speed -= nx * j * 0.55;

    // Contact unsettles the bike: a shove at the bars yaws it, and the yaw
    // scales with how hard the hit was.
    const yawKick = Math.min(1.2, approach * 0.16);
    this.yawRate += (dl >= 0 ? -1 : 1) * yawKick;
    if (other.yawRate !== undefined) other.yawRate -= (dl >= 0 ? -1 : 1) * yawKick;

    // Speed is scrubbed by the collision: hitting someone costs you both.
    const loss = Math.min(0.10, approach * 0.012);
    this.speed *= (1 - loss);
    if (other.speed !== undefined) other.speed *= (1 - loss);

    // Final guard: nothing leaves this method non-finite.
    if (!Number.isFinite(this.speed)) this.speed = 0;
    if (!Number.isFinite(this.lateral)) this.lateral = 0;
    if (!Number.isFinite(this.lateralV)) this.lateralV = 0;
    if (!Number.isFinite(this.yawRate)) this.yawRate = 0;

    this.contactImpulse = approach;
    this.lastContact = other;
    return approach;
  }

  // Hitting the guard rail: the lateral component is absorbed and a little of
  // the speed is scrubbed, but the bike slides along rather than stopping dead.
  hitRail(railLateral) {
    const pen = Math.abs(this.lateral) - railLateral;
    if (pen <= 0) return 0;
    const side = Math.sign(this.lateral);
    this.lateral = side * railLateral;
    const vn = this.lateralV * side;
    if (vn > 0) {
      this.lateralV -= side * vn * (1 + PHYS.WALL_RESTITUTION);
      this.speed *= (1 - Math.min(0.35, vn * 0.02));
      this.yawRate += side * vn * 0.05;
      this.contactImpulse = vn;
      return vn;
    }
    return 0;
  }

  // -------------------------------------------------------------------
  // A shove that would drive the bike THROUGH the rail.
  //
  // Without this, a hit taken while already against the barrier added lateral
  // velocity straight into the wall: hitRail zeroed it, the next contact added
  // it again, and the rider was pinned against the rail permanently. Measured:
  // 69 consecutive frames pinned at lateral -5.45 m with speed collapsing to
  // 19 m/s, then distance-per-5s falling from 366 m to 84 m. Being knocked into
  // a wall has to be survivable, so a blow that cannot be absorbed sideways is
  // DIVERTED ALONG the wall instead -- which is also what actually happens when
  // a bike is forced against a barrier at speed.
  // -------------------------------------------------------------------
  applyHitAgainstRail(push, side, railLateral, railSide) {
    // If the blow would push us further into a rail we are already touching,
    // convert the blocked lateral impulse into a forward one.
    const intoRail = (railSide !== 0) && (side * railSide > 0)
      && Math.abs(this.lateral) > railLateral - 0.35;
    if (!intoRail) return false;
    // most of the blocked energy becomes a forward shove; a little is lost
    this.speed += Math.abs(push) * 1.5;
    this.yawRate += railSide * Math.abs(push) * 0.30;
    // and nudge us off the wall so the next frame is not also a contact
    this.lateralV -= railSide * Math.abs(push) * 0.55;
    return true;
  }
}

