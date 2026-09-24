// RideRash — NPC behaviour engine.
//
// WHAT THIS IS. Every non-player rider in the game (rivals today, cops later)
// runs one of these. It is an explicit finite state machine that reads the world
// and outputs a CONTROL INTENT — a plain object of {steer, throttle, brake,
// attack, tuck} — once per frame. The caller applies that intent to the rider's
// BikePhys.
//
// THE SEAM, AND WHY IT MATTERS. A brain NEVER writes to BikePhys. Not `speed`,
// not `lateral`, not `lateralV`, not `yawOffset`. The previous rival code did
// (`p.speed += (target - p.speed) * ...`, `p.lateral += ...`), which meant the
// AI and the integrator were one object and neither could be tested or replaced
// alone. Rivals and cops now share one engine because the engine's only output
// is intent; the machine that consumes the intent is somebody else's problem.
//
//   const brain = new NpcBrain({ kind: 'rival', index, persona, seed });
//   const intent = brain.think(ctx);      // pure-ish: reads ctx, writes nothing
//   rider.phys.advance(dt, intent);       // the caller owns this line
//
// DETERMINISM. The project has a `_nondet.mjs` harness that runs four identical
// races and requires identical results, so a brain may not call Math.random().
// Every random draw goes through `this.rand()`, a seeded mulberry32 whose seed
// is derived from (seed ?? index) and the race number. Two brains created with
// the same arguments draw the same numbers in the same order.
//
// WHAT THE PREVIOUS AI GOT WRONG, preserved here as constraints:
//   §5.19  `laneHome` was assigned the whole table `[0,0,0,0,0]`, and
//          `lane + (rand-0.5)*3` then made a STRING, whose clamp is NaN. Every
//          numeric field this file assigns is run through `num()` first: a
//          non-finite value falls back to a declared default rather than
//          reaching the physics. This is not paranoia, it is the specific bug.
//   §5.20  P-only steering saturated at full lock (lean 0.719 vs a LEAN_MAX of
//          0.72 while going straight). The lane controller is PD with the
//          measured gains kept verbatim: P 0.22, D 0.16.
//   §5.21  A strong lane hold fought deliberate steering. The brain does not
//          hold a lane with force; it chooses a target line and lets the
//          physics' own weak LANE_HOLD be the insurance.

import { ATTACKS } from './combat.js';
// [traffic-agent] rivals-vs-traffic hook; see _avoidTraffic. Owned by the traffic pass.
import { trafficEscape } from './trafficavoid.js';

// ---------------------------------------------------------------------------
// A deterministic PRNG. mulberry32: tiny, fast, good enough for behaviour, and
// reproducible from a 32-bit seed. This is the ONLY source of randomness in the
// engine; `Math.random` appears nowhere in this file.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Coerce anything to a finite number, or to `fallback` if it is not.
 *
 * This one function is the answer to HANDOFF §5.19. The old bug was an array
 * reaching a numeric field and string-concatenating its way to NaN, where the
 * physics' NaN guards quietly turned the bikes into statues. Guarding at the
 * point of ASSIGNMENT is cheaper and finds the fault here rather than three
 * subsystems away.
 */
export function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A clamped, finite number. The shape every control channel wants. */
function clampNum(v, lo, hi, fallback = 0) {
  return Math.max(lo, Math.min(hi, num(v, fallback)));
}

// ---------------------------------------------------------------------------
// PERSONAS. Each biases state selection and the thresholds that decide when a
// state fires. They are deliberately small and explicable: a persona is a
// handful of multipliers and a preferred lane behaviour, not a second AI.
//
// `cop` is a persona for a rider that does not race to win — it picks a target
// and stays on it, which is why its persistence is high and its lane wander is
// near zero. The engine has no cop-specific code; only these numbers.
// ---------------------------------------------------------------------------
// BEHAVIOUR KNOBS (added with the named-character pass). Every persona gets
// these; the defaults are "an ordinary racer" so the old four are unchanged
// except where noted. NONE of them touches the machine -- top speed, power and
// grip are BikePhys/CFG and are the same for every rider including the player.
//
//   reaction     s of lag on tracking another rider's line (a low-pass time
//                constant). Low = twitchy and hard to shake, high = readable.
//   fixate       m. Within this of the PLAYER (along the road) the rider stops
//                racing and brawls: victim forced to the player, HUNT does not
//                give up, and between swings he shadows you (RACE -> _shadow).
//   matchSpeed   while hunting, hold the VICTIM's speed (plus a closing term)
//                instead of the rider's own pace. "Eases off to match you."
//   ram          m of periodic swerve INTO the victim while hunting; the contact
//                solver turns it into a shove.
//   dwellMul     scales the commit-window dwell (floor 0.35 s -- still a tell).
//   cooldownMul  scales the per-rider cooldown after a swing (floor 0.9 s).
//   flee         hp fraction below which the rider RUNS from anyone within 10 m.
//   grudge       s he remembers who last hit him; while remembered that rider is
//                his victim wherever he is in the standings (within GRUDGE_RANGE).
//   draft        sits in the tow of the rider ahead, then slingshots past.
//   block        mirrors the line of the rider on his tail.
//   avoid        side-steps a rider who draws alongside instead of fighting.
const BEHAVIOUR_DEFAULTS = {
  reaction: 0.35, fixate: 0, matchSpeed: false, ram: 0, dwellMul: 1, cooldownMul: 1,
  flee: 0, grudge: 8, draft: false, block: false, avoid: false,
  trafficLook: 1,   // x traffic look-ahead (npc.js _avoidTraffic): reckless < 1 < careful
};
const persona = (o) => ({ ...BEHAVIOUR_DEFAULTS, ...o });

export const PERSONAS = {
  aggressive: persona({
    // Seeks contact. Attacks early, evades late, and will chase a wounded
    // rider across the road to finish it.
    aggression: 1.45,      // scales attack commit chance
    patience: 0.55,        // how long it will sit behind before attacking
    persistence: 0.9,      // how hard it holds a chosen victim
    evasion: 0.6,          // how readily it breaks off when hurt
    laneWander: 1.0,       // metres of wander around the lane home
    standoff: 1.55,        // metres to the side it prefers when attacking
    speedBias: 1.02,       // PREFERRED pace trim (machine-capped; see assignPace)
    preferredRange: [2.2, 4.6],
    reaction: 0.3, grudge: 15, trafficLook: 0.75,
  }),
  clean: persona({
    // Races. Avoids fights: side-steps anybody who comes alongside, only swings
    // at a rider already hurt and directly in his way.
    aggression: 0.45,
    patience: 1.35,
    persistence: 0.5,
    evasion: 1.25,
    laneWander: 0.7,
    standoff: 1.9,
    speedBias: 1.0,
    preferredRange: [2.6, 5.2],
    avoid: true, grudge: 4, trafficLook: 1.15,
  }),
  blocker: persona({
    // Does not want a place, it wants YOURS. Sits in front, on your line, and
    // refuses to be passed. Attacks less but holds station harder.
    aggression: 0.9,
    patience: 2.0,
    persistence: 1.2,
    evasion: 0.7,
    laneWander: 0.35,
    standoff: 2.2,
    speedBias: 1.04,
    preferredRange: [1.8, 4.0],
    block: true, reaction: 0.45, trafficLook: 0.9,
  }),
  rowdy: persona({
    // VIPER. Would rather fight than race. Inside `fixate` metres of the player
    // he eases off (or on) to sit level with you, swerves in, and swings again
    // after a short cooldown -- repeatedly. Uses the chain whenever it reaches.
    aggression: 1.8,
    patience: 0.3,
    persistence: 1.6,
    evasion: 0.3,
    laneWander: 1.3,
    standoff: 1.15,
    speedBias: 1.0,
    preferredRange: [1.4, 3.0],
    reaction: 0.2, fixate: 15, matchSpeed: true, ram: 0.75,
    dwellMul: 0.6, cooldownMul: 0.55, grudge: 30, trafficLook: 0.45,
  }),
  coward: persona({
    // Races fine while healthy. Hurt below `flee`, he runs from anyone near:
    // brakes to let a rider ahead/level go by, flat out if the threat is behind,
    // and always to the far side of the road.
    aggression: 0.35,
    patience: 1.8,
    persistence: 0.3,
    evasion: 2.2,
    laneWander: 0.8,
    standoff: 2.4,
    speedBias: 1.0,
    preferredRange: [3.0, 5.5],
    flee: 0.7, avoid: true, grudge: 0, reaction: 0.25, trafficLook: 1.1,
  }),
  grudge: persona({
    // Races until somebody hits him. Then that rider is the only one in the race.
    aggression: 0.8,
    patience: 1.0,
    persistence: 1.4,
    evasion: 0.5,
    laneWander: 0.8,
    standoff: 1.6,
    speedBias: 1.0,
    preferredRange: [2.0, 4.2],
    grudge: 60, matchSpeed: true, ram: 0.35, cooldownMul: 0.7, trafficLook: 0.7,
  }),
  drafter: persona({
    // Wheelsucker. Gets in the tow of the rider ahead, holds ~6 m for a few
    // seconds, then pulls out and slingshots past. Rarely fights.
    aggression: 0.6,
    patience: 1.5,
    persistence: 0.6,
    evasion: 1.0,
    laneWander: 0.5,
    standoff: 2.0,
    speedBias: 1.0,
    preferredRange: [2.4, 4.8],
    draft: true, reaction: 0.3,
  }),
  cop: persona({
    // Reserved for `cops.js`. Picks a target and stays glued to it; near-zero
    // wander, very high persistence, no interest in the racing line.
    aggression: 1.15,
    patience: 0.8,
    persistence: 1.6,
    evasion: 0.35,
    laneWander: 0.15,
    standoff: 1.7,
    speedBias: 1.06,
    preferredRange: [2.0, 3.6],
    grudge: 0,
  }),
};

// The persona a rider of each kind falls back to. `kind` is the only thing a
// caller has to say; everything else has a sensible default.
const DEFAULT_PERSONA = { rival: 'clean', cop: 'aggressive' };

// ---------------------------------------------------------------------------
// STATES. The transition table is data, so the machine can be read without
// tracing the code, and a cop can be given a different table without editing
// the states.
//
// Transitions are ordered; the FIRST satisfied rule wins. Each rule is a
// function of (brain, ctx, world-facts) returning a state name or null.
// ---------------------------------------------------------------------------
export const STATES = ['RACE', 'HUNT', 'ATTACK', 'EVADE', 'RECOVER'];

/** Tuning for the machine. Kept together so a cop can be given a variant. */
export const NPC = {
  // --- state timers, seconds ---
  RACE_DECIDE: [0.9, 1.6],     // how long RACE holds a line before reconsidering
  HUNT_GIVE_UP: 6.0,           // s without a viable victim before returning to RACE
  // ATTACK_DURATION is gone: the length of the ATTACK state is now
// NPC.SWING_ANIM, because the decision was made during the dwell. A long
// "attack pass" was a rival that stopped racing.
  EVADE_TIME: 2.4,             // s of taking evasive action
  RECOVER_TIME: 1.6,           // s of gathering the bike after a knock

  // --- trigger thresholds ---
  HP_HURT: 0.34,               // fraction of max HP below which EVADE is likely
  HP_FLEE: 0.16,               // below this, always evade when hurt
  ATTACK_RANGE: ATTACKS.kick.range + 0.9,
  HUNT_RANGE: 12,              // m along the road within which a victim exists

  // --- THE COMMIT WINDOW (user, this session) ------------------------------
  //
  // A rival must HOLD the alongside condition for DWELL seconds before the
  // swing commits. This is not a dice roll at contact -- it is a telegraph the
  // player can read and beat.
  //
  //   SEEKING -> ALONGSIDE (in arc, |dlong| < ALONGSIDE_LONG)
  //          -> hold DWELL s continuously -> SWING -> COOLDOWN
  //   abandon ALONGSIDE before DWELL completes -> no hit, REARM only
  //
  // The counterplay is emergent: brake, accelerate or drift a lane and the
  // wind-up aborts. The rival visibly leans during the dwell, which is the tell.
  //
  // REARM is short and COOLDOWN is long and PER RIVAL, so a three-rider pack is
  // a gauntlet while one rider is survivable -- emergent difficulty with no
  // difficulty scalar.
  ALONGSIDE_LONG: 2.2,         // m of |dleLong| that counts as "side by side" (~1 bike)
  ALONGSIDE_LAT: 3.2,          // m of |dlateral| that counts as reach
  DWELL: 1.0,                  // s alongside before the swing commits
  REARM: 1.0,                  // s after an ABORTED wind-up before re-seeking
  COOLDOWN: [3.0, 5.0],        // s per rider after a SWUNG attack, any outcome
  SWING_ANIM: 0.4,             // s of committed swing animation before breaking off
  // 30 m was the old value and it is most of the "they just hover around the
  // player" bug on its own: at 30 m a rider will commit to a fight with somebody
  // a second and a half up the road, then spend that time alongside instead of
  // racing. A place is contested at wheel-to-wheel distance. 12 m is roughly
  // three bike lengths -- far enough that a rival closing on you commits before
  // contact, near enough that the fight is about the position you can actually
  // take or lose right now.
  VICTIM_HP_MAX: 0.9,          // do not bother hunting the barely-wounded healthy
  CONTACT_COOLDOWN: 1.1,       // s after being hit before attacking again

  // --- lane control (the measured PD, kept verbatim from §5.20) ---
  PHYS_RIVAL_P: 0.22,          // steer per metre of lateral error
  PHYS_RIVAL_D: 0.16,          // steer per m/s of lateral velocity
  LANE_CLAMP_MARGIN: 1.6,      // keep target lines this far inside the kerb

  // --- pace control ---
  // There is NO positional leash. `PACE_GAIN`, `AHEAD_LIMIT` and `BEHIND_LIMIT`
  // used to live here and together they were the "rivals hover around the
  // player" bug: they converted a player-relative speed error into throttle and
  // hard-clamped every rival to ±9/12 m of its home near the player. Pace is now
  // absolute and assigned per level; see NpcBrain.assignPace.
  CORNER_CUT: 0.010,           // curvature above which a rider lifts
  CORNER_THROTTLE: 0.55,       // throttle cap while cornering that hard
  SAFE_GAP: 6.0,               // m to the rider ahead at which throttle is cut
  NEAR_GAP: 10.0,              // m at which throttle is trimmed
  LANE_CLEAR: 1.2,             // m of lateral separation that counts as "same lane"

  // --- character behaviours (see BEHAVIOUR_DEFAULTS) ---
  GRUDGE_RANGE: 60,            // m: a remembered enemy this close is hunted
  GRUDGE_CHASE: 90,            // m: ...and one this far up the road is chased
  CHASE_TRIM: 1.05,            // preferred-pace trim while chasing a grudge (machine-capped)
  FLEE_RADIUS: 10,             // m: a coward runs from anybody this close
  DRAFT_RANGE: 22,             // m: a drafter tucks in behind a rider this close ahead
  DRAFT_GAP: 6,                // m held in the tow
  DRAFT_HOLD: [3.0, 6.0],      // s in the tow before the slingshot
  SLING_TIME: 3.0,             // s of the slingshot pass
  BLOCK_RANGE: 30,             // m: a blocker mirrors a rider this close behind
  AVOID_LONG: 4.0,             // m along / ...
  AVOID_LAT: 2.6,              // m across: "alongside" for a clean side-step
  MOOD_EVERY: [14, 30],        // s between mid-race mood rolls
};

/**
 * The lane home for a rider index. A NUMBER, per §5.19 — this used to be
 * assigned the entire table. Keeping it a function makes it impossible to get
 * the plural wrong again.
 */
export function laneHomeFor(index, roadHalf) {
  // LANE HOMES ARE A FRACTION OF THE ROAD, not metres fixed to the old width.
  //
  // They were the absolute table [-3.1, 2.9, -1.8, 2.1, -2.4], authored when the
  // carriageway was 7.5 m (roadHalf 3.75). Widening the road to 11 m (half 5.5)
  // would have left that table untouched, so every rival would still have fought
  // inside a 6 m band in the middle of an 11 m road -- the outer 2.5 m unused,
  // and the pack MORE congested relative to the tarmac than before, which is the
  // exact opposite of what the wider road is for.
  //
  // Expressed as fractions of the half-width instead, the table keeps its SHAPE
  // at any width: the same five relative positions, scaled to the road. The
  // values are the old metres divided by 3.75, so at the old width this is
  // identical to the old behaviour and the change is provably neutral there.
  const homes = [-0.83, 0.77, -0.48, 0.56, -0.64];
  const i = Math.abs(Math.trunc(num(index, 0)));
  const half = Math.max(0, num(roadHalf, 3.75));
  const raw = num(homes[i % homes.length], 0) * half;
  const margin = NPC.LANE_CLAMP_MARGIN;
  const lim = Math.max(0, half - margin);
  return Math.max(-lim, Math.min(lim, raw));
}

// ---------------------------------------------------------------------------
// NpcBrain
// ---------------------------------------------------------------------------
export class NpcBrain {
  /**
   * @param {object} opts
   * @param {'rival'|'cop'} [opts.kind='rival']   which default persona/table
   * @param {number} [opts.index=0]               grid slot; drives lane/pace home
   * @param {string} [opts.persona]               explicit persona name
   * @param {number} [opts.seed]                  PRNG seed (defaults to index)
   * @param {number} [opts.skill=0.5..1]          0..1 competence
   * @param {number} [opts.roadHalf=3.75]         half the carriageway
   */
  constructor(opts = {}) {
    this.kind = opts.kind === 'cop' ? 'cop' : 'rival';
    this.index = Math.abs(Math.trunc(num(opts.index, 0)));
    this.roadHalf = num(opts.roadHalf, 3.75);

    const personaName = PERSONAS[opts.persona]
      ? opts.persona
      : (DEFAULT_PERSONA[this.kind] || 'clean');
    this.personaName = personaName;
    this.persona = PERSONAS[personaName];
    // An UNSCALED copy of the persona, kept so a per-race aggression scale can
    // be re-applied from a clean base each time. Without this, scaling mutates
    // the shared PERSONAS table and compounds: race 2 would multiply the
    // already-multiplied race 1 values, and the pack would escalate on its own
    // with nobody editing anything. This is the same class of shared-table
    // mutation that `_nondet` exists to catch.
    this.personaBase = this.persona;

    this.skill = clampNum(opts.skill, 0, 1, 0.6);
    // THE MACHINE LIMIT. Every rider's PREFERRED pace is capped at the same
    // number the player's bike tops out at (CFG.MAX_SPEED, passed in by the
    // caller -- npc.js imports no config). Personality lives in how a rider
    // uses the bike, never in a faster bike. Infinity = uncapped (harnesses).
    this.maxSpeed = num(opts.maxSpeed, Infinity);
    // Per-race personality, set by applyMood (roster gridFor): mood -1..1 and a
    // +-2% preferred-pace trim.
    this.mood = 0;
    this.paceTrim = 1;

    // Deterministic PRNG. Seed is a function of the caller's seed (or the grid
    // slot) and the kind, so a cop and a rival at the same index do not draw the
    // same sequence.
    this.seed = (num(opts.seed, this.index) >>> 0) ^ (this.kind === 'cop' ? 0x5f3759df : 0);
    this.rand = mulberry32(this.seed);

    this.laneHome = laneHomeFor(this.index, this.roadHalf);

    // --- FSM state ---
    this.state = 'RACE';
    this.stateTime = 0;
    this.statePrev = null;
    // A transition log, bounded, for the harness: it is how a test can assert
    // "this rider hunted, then attacked" without screenshotting anything.
    this.log = [];
    this.logLimit = 64;

    // --- per-state scratch, all reset by reset() ---
    this.targetLateral = this.laneHome;
    this.targetSpeed = 0;
    // ABSOLUTE target pace for the race, assigned by assignPace() from the
    // level's reference. NEVER derived from the player -- see _paceIntent.
    this.paceSpeed = 0;
    this.paceRank = 0.5;
    this.dwell = 0;
    this.cooldown = 0;
    this.rearm = 0;
    this.alongside = false;
    // THE COMMIT WINDOW. `dwell` accumulates while ALONGSIDE and resets the
    // moment the condition breaks; `cooldown` blocks re-entry to SEEKING after a
    // swing; `rearm` blocks it briefly after an aborted wind-up.
    this.dwell = 0;
    this.cooldown = 0;
    this.rearm = 0;
    this.alongside = false;
    this.attack = null;         // attack kind to commit this frame, or null
    this.victim = null;         // entity being hunted/attacked
    this.decideTimer = 0;
    this.attackTimer = 0;
    this.evadeTimer = 0;
    this.recoverTimer = 0;
    this.contactTimer = 0;      // s since this rider was last hit
    this.lastHitS = 0;
    this.wander = 0;            // current lane wander offset
    this.hurt = false;          // HP below the hurt threshold
    this.dwell = 0;             // s held ALONGSIDE (the commit window)
    this.cooldown = 0;          // s blocked from seeking after a swing
    this.rearm = 0;             // s blocked after an aborted wind-up
    this.alongside = false;
    this.lastIntent = { steer: 0, throttle: 0, brake: 0, attack: null, tuck: false };
    this.transitions = 0;
    this._resetCharacter();
  }

  /** The lane the rider actually wants, including wander, clamped to the road. */
  get lineTarget() {
    const margin = NPC.LANE_CLAMP_MARGIN;
    const lim = Math.max(0, this.roadHalf - margin);
    return Math.max(-lim, Math.min(lim, num(this.targetLateral, this.laneHome)));
  }

  /** Put the machine back to a known state for a new race. */
  reset() {
    // RESEED. Determinism across races depends on this: a race that draws a
    // different number of random values than the last one would otherwise start
    // the next race mid-sequence, and _nondet would see race 1 differ from
    // race 0 for no reason anyone could find.
    this.rand = mulberry32(this.seed);
    this.state = 'RACE';
    this.stateTime = 0;
    this.statePrev = null;
    this.log.length = 0;
    this.targetLateral = this.laneHome;
    this.targetSpeed = 0;
    this.attack = null;
    this.victim = null;
    this.decideTimer = 0;
    this.attackTimer = 0;
    this.evadeTimer = 0;
    this.recoverTimer = 0;
    this.contactTimer = 0;
    this.lastHitS = 0;
    this.wander = 0;
    this.hurt = false;
    this.dwell = 0; this.cooldown = 0; this.rearm = 0; this.alongside = false;
    this.transitions = 0;
    this.lastIntent = { steer: 0, throttle: 0, brake: 0, attack: null, tuck: false };
    this._resetCharacter();
    return this;
  }

  /**
   * Swap temperament for a new race (the roster deals a different character to
   * this grid slot each race). Re-derives the base table the aggro scale is
   * applied to, so nothing compounds.
   */
  setPersona(name) {
    if (!PERSONAS[name] || name === this.personaName) return this;
    this.personaName = name;
    this.persona = PERSONAS[name];
    this.personaBase = this.persona;
    return this;
  }

  /** Per-race mood from the roster draw; see roster.js PER-RACE RANDOMNESS. */
  applyMood(mood, paceTrim) {
    this.mood = clampNum(mood, -1, 1, 0);
    this.paceTrim = clampNum(paceTrim, 0.9, 1.1, 1);
    return this;
  }

  /** Character scratch state: grudges, tow, mood swings, tracked lines. */
  _resetCharacter() {
    this.grudgeKey = null;      // key of the rider this one is after
    this.grudgeT = 0;           // s of memory left
    this.draftT = 0;            // s spent in a tow
    this.draftHold = 0;         // s to hold the tow before slinging
    this.slingT = 0;            // s of slingshot left
    this.slingSide = 1;
    this.moodT = 0;             // s until the next mood roll
    this.boostT = 0;            // s of a mid-race "push" left
    this.redMistT = 0;          // s of a mid-race "red mist" left
    this.liftT = 0;             // s of a mid-race "lift" (backing off) left
    this.blindT = 0;            // s of eyes-off-the-road left (trafficAttention)
    this._moodStarted = false;
    this.clock = 0;
    this.events = [];           // mid-race decisions, for the harness / card
    this._trk = {};             // low-pass tracked values (reaction time)
    this.fixated = false;
    this.fleeing = false;
    this.ramPhase = 0;
    // Measured by the harness: what this character actually DID this race.
    this.metrics = { fixateT: 0, draftT: 0, blockT: 0, fleeT: 0, grudgeT: 0, avoidT: 0, huntT: 0, attacks: 0, slings: 0 };
  }

  /** Low-pass a tracked quantity with the persona's reaction time. */
  _track(key, value, dt) {
    const v = num(value, 0);
    const prev = this._trk[key];
    if (prev === undefined || !Number.isFinite(prev)) { this._trk[key] = v; return v; }
    const k = 1 - Math.exp(-num(dt, 0.016) / Math.max(0.05, this.persona.reaction || 0.35));
    const out = prev + (v - prev) * k;
    this._trk[key] = out;
    return out;
  }

  /** The state name, for the harness and the HUD. */
  get stateName() { return this.state; }

  // -------------------------------------------------------------------------
  // think(ctx) -> intent
  //
  // ctx is built by the caller each frame and is the ONLY thing the brain reads:
  //
  //   {
  //     dt,                    frame seconds (already clamped by the caller)
  //     self: {                this rider's own state, read-only
  //       s, lateral, speed, lateralV, lean, yawOffset, hp, maxHp,
  //       down, busy, canChain, onRoad,
  //     },
  //     road: {                the road, so no NPC has to import level.js
  //       halfWidth,           metres, carriageway half-width
  //       curvature,           signed, + = bending right ahead
  //     },
  //     player: {              may be null in principle; guard anyway
  //       s, lateral, speed, hp, maxHp,
  //     },
  //     others: [ { s, lateral, speed, hp, maxHp, down, index } ],  // rivals+cops
  //     ahead: { s, lateral, speed } | null,   // nearest rider ahead, or null
  //     lead: number,          self.s - player.s (+ = this rider is ahead)
  //     contact: boolean,      hit since the last frame
  //   }
  //
  // Returns { steer, throttle, brake, attack, tuck } — every field a finite
  // number (attack is a string or null). It never touches ctx or any physics.
  // -------------------------------------------------------------------------
  think(ctx) {
    // The brain must not be able to throw out of the frame loop (§4.4: every
    // frame completes). Anything malformed falls back to a safe cruise.
    try {
      return this._think(ctx);
    } catch (e) {
      this.state = 'RACE';
      this.attack = null;
      return { steer: 0, throttle: 0.6, brake: 0, attack: null, tuck: false };
    }
  }

  _think(ctx) {
    const dt = clampNum(ctx && ctx.dt, 0, 0.25, 1 / 60);
    const self = (ctx && ctx.self) || {};
    const others = (ctx && Array.isArray(ctx.others)) ? ctx.others : [];
    const player = (ctx && ctx.player) || null;
    const road = (ctx && ctx.road) || {};

    const hp = num(self.hp, 100);
    const maxHp = Math.max(1, num(self.maxHp, 100));
    const hpFrac = hp / maxHp;
    this.hurt = hpFrac < NPC.HP_HURT;
    this.down = !!self.down;
    this.contactTimer += dt;
    if (ctx && ctx.contact) { this.contactTimer = 0; this.lastHitS = num(self.s, 0); }

    // The commit-window timers tick every frame. They are per-rider and survive
    // state changes, which is what makes COOLDOWN actually hold a rider off.
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.rearm > 0) this.rearm = Math.max(0, this.rearm - dt);

    // --- CHARACTER: grudges and mid-race mood swings ------------------------
    // GRUDGE MEMORY. `self.lastHitBy` is the key of whoever landed the last
    // blow ('player' or 'r<id>', supplied by the caller). A persona with
    // `grudge` > 0 remembers it that many seconds (scaled by mood); while it is
    // remembered, that rider outranks the race (see _facts).
    this.clock = (this.clock || 0) + dt;
    // STRUCK is a landed blow (hitFlash), not the bike-to-bike rub that `contact`
    // also counts: a brawler leaning on you is in contact every frame, and
    // letting that reset his timers kept VIPER shadowing you without swinging.
    const struck = ctx && (ctx.self && ctx.self.struck !== undefined ? !!ctx.self.struck : !!ctx.contact);
    this.struckTimer = struck ? 0 : (this.struckTimer || 0) + dt;
    if (struck && self.lastHitBy && this.persona.grudge > 0) {
      if (this.grudgeKey !== self.lastHitBy) this._event('grudge:' + self.lastHitBy);
      this.grudgeKey = String(self.lastHitBy);
      this.grudgeT = this.persona.grudge * (1 + 0.3 * this.mood);
    }
    if (this.grudgeT > 0) { this.grudgeT -= dt; if (this.grudgeT <= 0) { this.grudgeKey = null; this.grudgeT = 0; } }
    this._moodTick(dt);

    // --- world facts, computed once and shared by every state ---
    const facts = this._facts(ctx, self, others, player, road, dt);
    this.fixated = !!facts.fixated;
    this.fleeing = !!facts.flee;
    const m = this.metrics;
    if (facts.fixated) m.fixateT += dt;
    if (facts.grudgeTarget) m.grudgeT += dt;
    if (this.state === 'HUNT' || this.state === 'ATTACK') m.huntT += dt;
    if (facts.flee) m.fleeT += dt;

    // --- run the transition table, then update whichever state we are in ---
    this.stateTime += dt;
    const next = this._transition(facts);
    if (next && next !== this.state) this._enter(next, facts);

    let res = this._update(dt, facts);
    // A state may end itself on a timer. Apply that through _enter so exit
    // hooks and the transition log stay correct, then spend one frame in the
    // new state so the returned intent belongs to the state we are actually in.
    if (res.next && res.next !== this.state) {
      this._enter(res.next, facts);
      res = this._update(dt, facts);
    }
    let intent = res.intent || res;
    // ==== [traffic-agent] BEGIN rivals-vs-traffic (keep minimal; logic in trafficavoid.js)
    // TRAFFIC OVERRIDES THE STATE MACHINE. Whatever the rider was doing --
    // racing a line, hunting, winding up a punch -- a bus in the way wins.
    // Applied after the state update so no state has to know about it.
    if (!this.down && ctx && Array.isArray(ctx.traffic) && ctx.traffic.length) {
      intent = this._avoidTraffic(intent, ctx.traffic, facts);
    }
    // ==== [traffic-agent] END

    // --- the guard, and the reason this file exists (§5.19) ---
    const out = {
      steer: clampNum(intent && intent.steer, -1, 1, 0),
      throttle: clampNum(intent && intent.throttle, 0, 1, 0.5),
      brake: clampNum(intent && intent.brake, 0, 1, 0),
      attack: (intent && typeof intent.attack === 'string' && ATTACKS[intent.attack]) ? intent.attack : null,
      tuck: !!(intent && intent.tuck),
    };
    this.lastIntent = out;
    return out;
  }

  // --- gathered facts: what every transition and every state needs to know ---
  _facts(ctx, self, others, player, road, dt) {
    const s = num(self.s, 0);
    const lateral = num(self.lateral, 0);

    // The nearest other rider, and the nearest one ahead, both in the road
    // frame. `others` is expected to exclude this rider, but filter anyway.
    let nearest = null, nearestD = Infinity;
    let ahead = null, aheadD = Infinity;
    for (const o of others) {
      if (!o) continue;
      const os = num(o.s, 0);
      const d = os - s;
      const ad = Math.abs(d);
      if (ad < nearestD) { nearestD = ad; nearest = o; }
      if (d > 0.5 && d < aheadD) { aheadD = d; ahead = o; }
    }

    const p = player || null;
    const lead = p ? (s - num(p.s, 0)) : 0;

    // ---- A VIABLE VICTIM, CHOSEN BY RACE POSITION ------------------------
    //
    // THE BUG THIS REPLACES. The old score was
    //     -ad * 0.06 + wounded * 1.6
    // i.e. "whoever is nearest and most hurt". Race position did not enter into
    // it at all. A rider two places back and one place ahead scored the same as
    // the man directly in front, so the pack picked fights with no reason and
    // orbited the player -- exactly the complaint: "they just hover around the
    // player, but that's not how Road Rash logic works".
    //
    // In Road Rash the opponents are RACERS. They attack to take or hold a
    // PLACE. The rules that follow (ROADRASH.md §3):
    //
    //   * the rider DIRECTLY AHEAD is the one worth attacking, because passing
    //     him gains a place. That is the base of the score.
    //   * the rider DIRECTLY BEHIND matters defensively -- he is trying to take
    //     YOUR place, so he is the next most interesting target.
    //   * anyone else (a rider 4 places up the road, or 3 back) is not worth
    //     leaving the racing line for.
    //   * a wounded rider is worth MORE, not because he is close, but because
    //     he is a place about to be available cheaply.
    //
    // `self.place` and `o.place` are 1-based race positions, supplied by the
    // caller. When they are absent the score falls back to the old
    // distance-only behaviour, so a caller that cannot supply places still
    // works (the harnesses do exactly this).
    let victim = null, victimScore = -Infinity;
    for (const o of others) {
      if (!o || o.down) continue;
      const ds = num(o.s, 0) - s;
      const ad = Math.abs(ds);
      if (ad > NPC.HUNT_RANGE) continue;
      const oHp = num(o.hp, num(o.maxHp, 100));
      const oMax = Math.max(1, num(o.maxHp, 100));
      const wounded = 1 - oHp / oMax;

      // Places gained by beating this rider. +1 means "passing him is worth a
      // place"; 0 or negative means he is behind us and only matters as a
      // threat to the place we already hold.
      const myPlace = num(self.place, 0);
      const hisPlace = num(o.place, 0);
      const placeGain = (myPlace > 0 && hisPlace > 0) ? (myPlace - hisPlace) : (ds > 0 ? 1 : 0);

      let score;
      if (placeGain > 0) {
        // Ahead of us on the road and ahead in the standings: the pass target.
        score = 2.0 + placeGain * 0.9;
      } else if (placeGain === 0 && ds > 0) {
        // Level or unplaced but up the road: still a pass.
        score = 1.4;
      } else {
        // Behind us. Only worth a backward glance if he is right on our wheel,
        // because that is the rider who can take our place back.
        score = -1.2 - Math.abs(placeGain) * 0.4;
      }
      // Proximity decides between two otherwise equal candidates.
      score -= ad * 0.055;
      // A wounded rider is a place about to be cheap.
      score += wounded * 0.9;
      if (score > victimScore) { victimScore = score; victim = o; }
    }

    // ---- CHARACTER OVERRIDES ------------------------------------------------
    // The player as a rider entry (others carries `key`), falling back to ctx.player.
    const P = this.persona;
    let pl = null;
    for (const o of others) if (o && o.key === 'player') { pl = o; break; }
    if (!pl && p) pl = p;
    const plDown = pl ? !!pl.down : true;

    // COWARD: hurt and somebody close -> run. Beats everything but being down.
    let flee = false, threat = null;
    const hpF = num(self.hp, 100) / Math.max(1, num(self.maxHp, 100));
    if (P.flee > 0 && hpF < P.flee) {
      let best = Infinity;
      for (const o of others) {
        if (!o || o.down) continue;
        const d = Math.hypot(num(o.s, 0) - s, (num(o.lateral, 0) - lateral) * 0.6);
        if (d < NPC.FLEE_RADIUS && d < best) { best = d; threat = o; }
      }
      flee = !!threat;
    }

    // ROWDY: inside `fixate` metres of the player, the player IS the race.
    // Red mist (a mid-race mood swing) widens the radius.
    let fixated = false;
    // HYSTERESIS: once he has you, he chases you out to 2.3x the radius before
    // letting go -- a rowdy does not give up because you twisted the throttle.
    const fixR = P.fixate > 0 ? (P.fixate + (this.redMistT > 0 ? 8 : 0)) * (this.fixated ? 2.3 : 1) : 0;
    if (!flee && fixR > 0 && pl && !plDown && Math.abs(num(pl.s, 0) - s) < fixR) {
      fixated = true;
      victim = pl;
    }

    // GRUDGE: the remembered enemy outranks the standings.
    let grudgeTarget = null, chase = null;
    if (!flee && !fixated && this.grudgeKey) {
      for (const o of others) {
        if (!o || o.down || o.key !== this.grudgeKey) continue;
        const ds = num(o.s, 0) - s;
        if (Math.abs(ds) < NPC.GRUDGE_RANGE) { grudgeTarget = o; victim = o; }
        else if (ds > 0 && ds < NPC.GRUDGE_CHASE) chase = o;
        break;
      }
    }

    return {
      fixated, grudgeTarget, chase, flee, threat, playerEnt: pl,
      dt, self, others, player: p, road,
      s, lateral,
      speed: num(self.speed, 0),
      lateralV: num(self.lateralV, 0),
      lead,
      halfWidth: num(road.halfWidth, this.roadHalf),
      curvature: num(road.curvature, 0),
      ahead, aheadD: Number.isFinite(aheadD) ? aheadD : Infinity,
      nearest, nearestD: Number.isFinite(nearestD) ? nearestD : Infinity,
      victim,
      hpFrac: num(self.hp, 100) / Math.max(1, num(self.maxHp, 100)),
      down: !!self.down,
      busy: !!self.busy,
      canChain: !!self.canChain,
      onRoad: self.onRoad !== false,
      // THE COMMIT WINDOW, published so the feel harness can measure the tell
      // rather than infer it: `dwell` is how long the wind-up has been held,
      // `armed` is whether a swing is available at all. The three-series harness
      // reads these to prove a hit was EARNED (dwell reached) rather than rolled.
      dwell: this.dwell,
      alongside: this.alongside,
      cooldown: this.cooldown,
      rearm: this.rearm,
    };
  }

  // -------------------------------------------------------------------------
  // THE TRANSITION TABLE. Data, not control flow: the first row whose
  // `when(facts)` is truthy wins. Order matters and reads top to bottom as
  // priority.
  // -------------------------------------------------------------------------
  get table() {
    const P = this.persona;
    const hurtBias = P.evasion / Math.max(0.01, P.aggression);
    return [
      // A rider who is down cannot do anything but sit. The caller stops
      // applying intent for a downed rider, but the state machine should still
      // say so rather than pretending to race.
      { when: (f) => f.down, go: 'RECOVER' },

      // EVADE: hurt enough that a fight is a bad idea, or a persona that breaks
      // off early. Scales with the persona's evasion bias so a `clean` rider
      // peels away long before an `aggressive` one will.
      { when: (f) => f.hpFrac < NPC.HP_FLEE, go: 'EVADE' },
      // COWARD: hurt with somebody near -> run (persona.flee).
      { when: (f) => f.flee, go: 'EVADE' },
      { when: (f) => f.hpFrac < NPC.HP_HURT * (1 + hurtBias * 0.5) && this.contactTimer < NPC.CONTACT_COOLDOWN * 2, go: 'EVADE' },

      // RECOVER: recently hit, or off the tarmac. Gather the bike before
      // thinking about anything else. This is deliberately short — it is not a
      // retreat, it is a straighten-up.
      { when: (f) => !f.onRoad && Math.abs(f.lateral) > f.halfWidth + 0.4, go: 'RECOVER' },
      { when: (f) => this.state === 'RECOVER' && this.recoverTimer > 0, go: 'RECOVER' },

      // ATTACK: already committed to a pass. Hold it until the pass ends.
      { when: () => this.state === 'ATTACK' && this.attackTimer > 0, go: 'ATTACK' },

      // HUNT: a viable victim exists and this persona wants one.
      //
      // COOLDOWN AND REARM GATE THIS. A rider that has just swung sits out the
      // cooldown in RACE -- that is what makes the pack survivable one-on-one and
      // punishing three-on-one, and it is why the cooldown is per-rider rather
      // than global. REARM is the shorter block after an aborted wind-up.
      { when: (f) => this.state === 'HUNT' && this.cooldown > 0, go: 'RACE' },
      // A FIXATED rowdy or a grudge-holder on his man never gives up the hunt.
      { when: (f) => this.state === 'HUNT' && (f.fixated || f.grudgeTarget), go: 'HUNT' },
      { when: (f) => (f.fixated || f.grudgeTarget) && this.cooldown <= 0 && this.rearm <= 0
          && this.struckTimer > this.persona.reaction && !(this.hurt && !f.fixated), go: 'HUNT' },
      { when: (f) => this.state === 'HUNT' && this.stateTime < NPC.HUNT_GIVE_UP && f.victim, go: 'HUNT' },
      { when: (f) => this.cooldown <= 0 && this.rearm <= 0 && !!f.victim && this._wantsToHunt(f), go: 'HUNT' },

      // Otherwise race.
      { when: () => true, go: 'RACE' },
    ];
  }

  _transition(facts) {
    const t = this.table;
    for (let i = 0; i < t.length; i++) {
      let ok = false;
      try { ok = !!t[i].when(facts); } catch (e) { ok = false; }
      if (ok) return t[i].go;
    }
    return 'RACE';
  }

  /**
   * Does this rider want to pick a fight right now?
   *
   * RACERS FIRST. In Road Rash the opponents are racing; the fighting serves the
   * race. `_wantsToHunt` therefore requires a PLACE to fight over -- the victim
   * scoring in `_facts` returns null when nobody is worth attacking, and this
   * returns false when there is no victim. The old code could enter HUNT on a
   * per-decision coin flip alone, with no victim at all, which is how the pack
   * came to wander the road looking for someone to lean on.
   */
  _wantsToHunt(facts) {
    const P = this.persona;
    if (this.stateTime < 0.4) return false;             // do not thrash
    if (this.contactTimer < NPC.CONTACT_COOLDOWN) return false;  // just got hit
    if (this.hurt && P.evasion > P.aggression) return false;     // wants none of it
    // NO VICTIM, NO FIGHT. `_facts` already decided whether anybody is worth
    // attacking (a place to gain or a place to defend). Without this line a
    // rider with nobody near would still pick fights with the scenery.
    if (!facts || !facts.victim) return false;
    // AVOIDERS (clean, coward) do not start fights: they only swing at a rider
    // who is already hurt (< 60%) and in their way up the road.
    if (P.avoid) {
      const v = facts.victim;
      const vHp = num(v.hp, 100) / Math.max(1, num(v.maxHp, 100));
      if (!(vHp < 0.6 && num(v.s, 0) > facts.s)) return false;
    }
    // Aggression is the bias; skill makes the decision land more often.
    const want = P.aggression * (this.redMistT > 0 ? 1.5 : 1) * (0.55 + this.skill * 0.75);
    // How likely per decision window. The window is the RACE decide timer, so
    // this is a per-second-ish probability, not per frame — that is what keeps
    // it stable under the harness' low frame rate.
    return this.rand() < Math.min(0.85, want * 0.5);
  }

  // -------------------------------------------------------------------------
  // ENTER / UPDATE / EXIT, one trio per state.
  //   enter(state, facts)  — one-off setup, called on the transition frame
  //   update(state, dt, facts) -> intent — called every frame in that state
  //   exit(state)          — cleanup, called on the way out
  // -------------------------------------------------------------------------
  _enter(state, facts) {
    if (this.statePrev === state) return;
    if (this.statePrev) this._exit(this.statePrev);
    this.statePrev = state;
    this.state = state;
    this.stateTime = 0;
    this.transitions++;
    this.log.push({ state, t: 0 });                    // t filled by the caller's clock
    if (this.log.length > this.logLimit) this.log.shift();
    this['_enter' + state]?.(facts);
  }

  _update(dt, facts) {
    const fn = this['_update' + this.state];
    if (typeof fn !== 'function') return { intent: this._updateRACE(dt, facts), next: null };
    const r = fn.call(this, dt, facts);
    // An update may either return a bare intent or {intent, next}; the second
    // form is how a state ends itself on a timer (ATTACK, EVADE, RECOVER). The
    // transition still goes through _enter, so exit hooks and the log stay
    // correct no matter which path changed the state.
    if (r && r.intent) return r;
    return { intent: r, next: null };
  }

  _exit(state) {
    this['_exit' + state]?.();
  }

  // --- shared helpers ------------------------------------------------------

  /** The measured PD lane controller, verbatim from §5.20. */
  _steerTo(targetLateral, facts) {
    const err = num(targetLateral, this.laneHome) - facts.lateral;
    const gain = 0.8 + this.skill * 0.4;
    return clampNum((err * NPC.PHYS_RIVAL_P - facts.lateralV * NPC.PHYS_RIVAL_D) * gain, -1, 1, 0);
  }

  /**
   * Pace control, expressed as a TARGET SPEED rather than a direct write. The
   * caller applies the difference through the throttle; the brain never sets
   * `speed`.
   */
  /**
   * PACE CONTROL — ABSOLUTE, PER RIDER, SET BY THE LEVEL. NO LEASH.
   *
   * THIS USED TO BE A LEASH AND IT WAS THE WHOLE "THEY JUST HOVER AROUND ME"
   * BUG. The old target was:
   *
   *     target = facts.player.speed * speedBias + (home - lead) * gain
   *
   * i.e. every rival's desired speed was the PLAYER'S INSTANTANEOUS SPEED times
   * a multiplier near 1.0, plus a spring pulling it back toward a position
   * `home` metres from the player, clamped inside ±9/12 m. Measured consequence:
   * all fourteen rivals sat inside ±10 m of the player for an entire race, every
   * one of them doing 33-38 m/s while the player did 24. It was not a race, it
   * was a swarm, and no purchase could ever change the outcome because the field
   * matched whatever the player did.
   *
   * WHAT REPLACES IT (user, this session): each rider has a FIXED target speed,
   * assigned per level and modulated by roster identity, and never reads the
   * player's speed at all. The field strings out over miles exactly as Road Rash
   * did, because nobody is watching the player. Your placement changes across the
   * career because the FIELD'S ABSOLUTE PACE changes, not because the rivals
   * adapt to you -- so buying the superbike is a genuine step change.
   *
   * `this.paceSpeed` is that absolute target, assigned once per race by
   * `assignPace()` from the level's reference pace. `speedBias` becomes a small
   * INTRINSIC trim (how hard this rider pushes) rather than a multiplier on the
   * player.
   */
  _paceIntent(facts, bias) {
    // The rider's own targeted pace. Falls back to the persona's own speed only
    // if assignPace never ran (bare-constructed brains in harnesses), so this is
    // never a hidden reference to the player.
    const base = num(this.paceSpeed, num(facts.speed, 0));
    // PREFERRED pace x per-race mood trim x mid-race push/lift x grudge chase,
    // then CAPPED AT THE MACHINE LIMIT (same as the player's). The trims are a
    // rider choosing how hard to push; none of them can buy speed the bike
    // does not have.
    const moodMul = this.paceTrim * (this.boostT > 0 ? 1.03 : 1) * (this.liftT > 0 ? 0.97 : 1)
      * (facts.chase ? NPC.CHASE_TRIM : 1);
    const target = Math.min(this.maxSpeed, base * num(bias, 1) * moodMul);

    // Throttle/brake to HOLD that pace. This is the entire control law: no
    // player term, no positional spring.
    let throttle, brake = 0;
    const err = target - facts.speed;
    if (err > 1.5) throttle = 1;
    else if (err < -3.0) { throttle = 0.30; brake = 0.12; }
    else throttle = clampNum(0.45 + err * 0.25, 0.2, 1, 0.6);

    // A rider still slows for a bend it cannot hold, and still will not ride
    // through the rider in front of it -- those are competence, not a leash.
    if (facts.curvature && Math.abs(facts.curvature) > NPC.CORNER_CUT) {
      throttle = Math.min(throttle, NPC.CORNER_THROTTLE);
    }

    return { throttle, brake, target };
  }

  /**
   * Assign this rider's ABSOLUTE target pace for the race.
   *
   * `reference` is the level's reference pace (the top speed of the bike tier
   * expected at that level, from career's BIKES). `rank` is where this rider
   * sits among the field, 0 (slowest) .. 1 (fastest), derived from roster skill.
   *
   * The field is DISTRIBUTED AROUND THE REFERENCE, not randomly placed:
   *   rank < 0.21  -> well below reference   (the backmarkers)
   *   rank < 0.57  -> clustered at reference (the pack you contest)
   *   rank < 0.86  -> above reference
   *   else         -> clearly above          (the level's contenders)
   * so 2-4 riders are always in contention near the player's likely pace, and a
   * genuinely slow player falls back to fighting the three slowest.
   */
  assignPace(reference, rank) {
    // THE BAND IS CENTRED SO THE FIELD IS BEATABLE. An earlier pass let the fastest
    // rider target 1.14x the reference, which put SLATER at 52.5 m/s in Level 1
    // where the RAT tops out at 46.1 -- half the field riding at speeds no bike
    // in the game could reach, so the race could not be won at any tier. The
    // reference is the EXPECTED BIKE'S TOP SPEED, and the band must sit around
    // it: the pace setter is at the reference (so the expected bike can just beat
    // him), the contenders are a touch above (so you need the faster bike to take
    // them), and the backmarkers are clearly below.
    const r = clampNum(num(rank, 0.5), 0, 1, 0.5);
    let mul;
    if (r < 0.21)      mul = 0.80 + r * 0.33;          // 0.80 .. 0.87  backmarkers
    else if (r < 0.57) mul = 0.90 + (r - 0.21) * 0.16; // 0.90 .. 0.96  the pack
    else if (r < 0.86) mul = 0.97 + (r - 0.57) * 0.14; // 0.97 .. 1.01  fast
    // THE CONTENDERS OUT-RUN A THROTTLE-ONLY RIDER. At 1.00-1.01 x the expected
    // bike's top speed nobody in the field could pass a player who simply held
    // the throttle (MEASURED: first from the start, every race). At 1.02-1.045
    // the top one or two riders are faster on a straight than the expected
    // bike flat out; you beat them by tucking, the boost, the tow, a punch, the
    // cleaner line -- or a better bike. Their machines are fitted to reach it
    // (see Rival.fitMachine).
    else               mul = 1.02 + (r - 0.86) * 0.18; // 1.02 .. 1.045 contenders
    this.paceRank = r;
    // Capped at the machine: at levels 3-5 the career's `reference` (52-58 m/s)
    // is above CFG.MAX_SPEED (48.16), so without the cap the "preferred" pace
    // would be a number no bike in the game can reach. With it the fast half of
    // a late field all want the machine's limit -- and are separated by how
    // they ride, not by a faster engine.
    this.paceSpeed = Math.min(this.maxSpeed, num(reference, 45) * mul);
    return this.paceSpeed;
  }

  // ==== [traffic-agent] BEGIN _avoidTraffic -- rivals-vs-traffic only
  /**
   * Steer round (or brake for) the vehicle this rider would hit soonest.
   *
   * Look-ahead scales with skill: 1.4 s for a 0-skill backmarker up to 3.0 s
   * for the best. At 25 m/s closing that is 35 m vs 75 m of warning. The move
   * round a semi is ~2.2 m and a bike at racing speed builds lateral speed
   * slowly (trafficavoid.js: ~1.5 m/s sustained), so a backmarker who spots it
   * late has to brake as well and sometimes still clips it -- a Road Rash pack
   * that never hits traffic is as wrong as one that always does.
   *
   * The steer is a firm PD on the escape line (gain 1.5/m, damping 0.25),
   * NOT _steerTo's race-line gains: MEASURED, _steerTo x1.25 asked for -0.54
   * falling to -0.2 as the error shrank, and the rival reached 0.9 m/s across,
   * too late.
   */
  _avoidTraffic(intent, cars, facts) {
    // [npc-persona] PERSONALITY IN TRAFFIC. `trafficLook` scales the look-ahead:
    // a clean racer reads the road (x1.15), VIPER barely does (x0.45). And a
    // rider whose eyes are on a VICTIM (hunting, swinging, fixated on you) sees
    // traffic late (x0.6) -- so brawlers clip cars and get taken out mid-fight,
    // which is Road Rash, while the clean half of the pack threads through.
    const distracted = (facts.fixated || this.state === 'HUNT' || this.state === 'ATTACK') ? 0.6 : 1;
    if (this.trafficAttention(facts.dt || 0.016, distracted < 1) <= 0) { this.trafficThreat = null; return intent; }
    const look = (1.4 + clampNum(this.skill, 0, 1, 0.5) * 1.6) * (this.persona.trafficLook || 1) * distracted;
    this.metrics.trafficLook = look;
    const lim = facts.halfWidth - 0.9;
    const esc = trafficEscape(cars, facts.s, facts.lateral, facts.speed, look, lim, 0.9);
    this.trafficThreat = esc ? esc.ttc : null;          // for the harness / HUD
    if (!esc) return intent;
    return {
      ...intent,
      steer: clampNum((esc.target - facts.lateral) * 1.5 - facts.lateralV * 0.25, -1, 1, 0),
      throttle: esc.brake ? 0 : Math.min(intent.throttle ?? 0.6, 0.7),
      brake: esc.brake ? 1 : (intent.brake || 0),
      // no punch mid-swerve: both hands are busy
      attack: esc.ttc < 1.0 ? null : intent.attack,
    };
  }
  // ==== [traffic-agent] END _avoidTraffic


  /** Traffic and pack awareness: do not ride through the rider in front. */
  _gapThrottle(throttle, facts) {
    const a = facts.ahead;
    if (!a) return throttle;
    const gap = num(a.s, 0) - facts.s;
    const dl = Math.abs(num(a.lateral, 0) - facts.lateral);
    if (gap < NPC.SAFE_GAP && dl < NPC.LANE_CLEAR) return Math.min(throttle, 0.15);
    if (gap < NPC.NEAR_GAP && dl < NPC.LANE_CLEAR) return Math.min(throttle, 0.6);
    return throttle;
  }

  /** The racing line: hug the inside of the bend, per persona. */
  _racingLine(facts) {
    const inside = Math.sign(facts.curvature) || 1;
    return inside * facts.halfWidth * 0.28;
  }

  /** A fresh wander offset around the lane home, drawn from the seeded PRNG. */
  _drawWander() {
    const w = this.persona.laneWander;
    return (this.rand() - 0.5) * 3.0 * w;
  }

  // --- CHARACTER HELPERS -----------------------------------------------------

  /**
   * EYES OFF THE ROAD. Returns 0 while the rider is not looking (a "blind"
   * window: traffic avoidance is skipped entirely), else 1. Windows open at a
   * per-second chance of (1 - trafficLook) * 0.3, doubled while he is busy with
   * a victim, and last 0.8 s. So VIPER (0.45) mid-brawl is blind ~1 s in 3 --
   * he WILL clip the odd car -- while a clean racer (>= 1) never is. Also
   * called by rivals.js for the far (LOD) path, so the pack wrecks off-screen
   * too. Seeded: part of the race's reproducible draw.
   */
  trafficAttention(dt, busy) {
    if (this.blindT > 0) { this.blindT -= dt; return 0; }
    const care = this.persona.trafficLook || 1;
    if (care >= 1) return 1;
    const p = (1 - care) * 0.3 * (busy ? 2 : 1) * dt;
    if (this.rand() < p) { this.blindT = 0.8; this.metrics.blinds = (this.metrics.blinds || 0) + 1; return 0; }
    return 1;
  }

  /** A mid-race decision, logged for the harness and the card. */
  _event(kind) {
    this.events.push({ t: Math.round((this.clock || 0) * 10) / 10, kind });
    if (this.events.length > 24) this.events.shift();
  }

  /**
   * MID-RACE MOOD SWINGS. Every 14-30 s (seeded), roll: a PUSH (preferred pace
   * +3% for 10 s -- still machine-capped), a LIFT (-3% for 8 s), or RED MIST
   * (aggression x1.5 for 8 s; a rowdy's fixation radius +8 m). Mood biases
   * which: a fired-up rider sees more red mist, a sulking one more lifts. This
   * is what makes two races with the same field play differently.
   */
  _moodTick(dt) {
    if (this.boostT > 0) this.boostT -= dt;
    if (this.liftT > 0) this.liftT -= dt;
    if (this.redMistT > 0) this.redMistT -= dt;
    this.moodT -= dt;
    if (this.moodT > 0) return;
    const [lo, hi] = NPC.MOOD_EVERY;
    const first = !this._moodStarted;
    this._moodStarted = true;
    this.moodT = lo + this.rand() * (hi - lo);
    if (first) return;                       // no swing at the start line
    const r = this.rand();
    const mist = 0.12 + 0.10 * Math.max(0, this.mood) + 0.05 * (this.persona.aggression - 1);
    if (r < mist) { this.redMistT = 8; this._event('red mist'); }
    else if (r < mist + 0.2) { this.boostT = 10; this._event('push'); }
    else if (r < mist + 0.2 + 0.1 - 0.06 * this.mood) { this.liftT = 8; this._event('lift'); }
  }

  /** Throttle/brake to hold `desired` m/s. Brakes harder than _paceIntent. */
  _matchIntent(desired, facts) {
    const err = Math.min(this.maxSpeed, desired) - facts.speed;
    if (err > 1.0) return { throttle: 1, brake: 0 };
    if (err < -1.5) return { throttle: 0, brake: clampNum(-err * 0.14, 0.12, 0.7, 0.2) };
    return { throttle: clampNum(0.5 + err * 0.35, 0, 1, 0.5), brake: 0 };
  }

  /** Lateral limit of a target line. */
  _lim(facts) { return Math.max(0, facts.halfWidth - NPC.LANE_CLAMP_MARGIN); }

  /**
   * ROWDY between swings: SHADOW the player. Ease off (or on) to sit level,
   * a little wider than the swing standoff, so the next swing is always one
   * short dwell away. This is VIPER's "eases off to match your speed".
   */
  _shadow(dt, facts) {
    const v = facts.playerEnt;
    if (!v) return null;
    const vl = this._track('shadowLat', num(v.lateral, 0), dt);
    const side = Math.sign(facts.lateral - vl) || this.huntSide || 1;
    const lim = this._lim(facts);
    this.targetLateral = clampNum(vl + side * (this.persona.standoff + 0.6), -lim, lim, this.laneHome);
    const ds = num(v.s, 0) - facts.s;
    const ctl = this._matchIntent(num(v.speed, facts.speed) + clampNum(ds * 0.6, -5, 5, 0), facts);
    return { steer: this._steerTo(this.targetLateral, facts), throttle: ctl.throttle, brake: ctl.brake, attack: null, tuck: false };
  }

  /**
   * DRAFTER: tuck in behind the rider ahead (the player first), hold ~6 m for a
   * few seconds, then pull out and slingshot. Returns null when there is no tow.
   */
  _draft(dt, facts) {
    const lim = this._lim(facts);
    let a = null;
    const pl = facts.playerEnt;
    if (pl && !pl.down) { const d = num(pl.s, 0) - facts.s; if (d > 1.5 && d < NPC.DRAFT_RANGE) a = pl; }
    if (!a && facts.ahead && facts.aheadD < NPC.DRAFT_RANGE) a = facts.ahead;
    if (this.slingT > 0) {
      this.slingT -= dt;
      const base = a ? num(a.lateral, 0) : facts.lateral;
      this.targetLateral = clampNum(base + this.slingSide * 2.4, -lim, lim, this.laneHome);
      return { steer: this._steerTo(this.targetLateral, facts), throttle: 1, brake: 0, attack: null, tuck: true };
    }
    if (!a) { this.draftT = 0; return null; }
    const gap = num(a.s, 0) - facts.s;
    this.targetLateral = clampNum(this._track('towLat', num(a.lateral, 0), dt), -lim, lim, this.laneHome);
    this.draftT += dt;
    this.metrics.draftT += dt;
    if (!this.draftHold) { const [lo, hi] = NPC.DRAFT_HOLD; this.draftHold = lo + this.rand() * (hi - lo); }
    if (this.draftT > this.draftHold) {
      this.slingT = NPC.SLING_TIME;
      this.slingSide = (num(a.lateral, 0) > 0) ? -1 : 1;     // the side with more road
      this.draftT = 0; this.draftHold = 0;
      this.metrics.slings++;
      this._event('slingshot');
    }
    const ctl = this._matchIntent(num(a.speed, facts.speed) + (gap - NPC.DRAFT_GAP) * 0.5, facts);
    return { steer: this._steerTo(this.targetLateral, facts), throttle: ctl.throttle, brake: ctl.brake, attack: null, tuck: true };
  }

  /** BLOCKER: the line of the rider on my tail (the player first), lagged. */
  _blockLine(dt, facts) {
    let b = null;
    const pl = facts.playerEnt;
    if (pl && !pl.down) { const d = facts.s - num(pl.s, 0); if (d > 1.5 && d < NPC.BLOCK_RANGE) b = pl; }
    if (!b) {
      let best = Infinity;
      for (const o of facts.others) {
        if (!o || o.down) continue;
        const d = facts.s - num(o.s, 0);
        if (d > 1.5 && d < Math.min(best, NPC.BLOCK_RANGE * 0.6)) { best = d; b = o; }
      }
    }
    if (!b) return null;
    this.metrics.blockT += dt;
    return this._track('blockLat', num(b.lateral, 0), dt);
  }

  /** CLEAN / COWARD: a rider alongside -> step a lane away instead of fighting. */
  _avoidLine(facts) {
    const n = facts.nearest;
    if (!n || n.down) return null;
    const ds = num(n.s, 0) - facts.s, dl = facts.lateral - num(n.lateral, 0);
    if (Math.abs(ds) > NPC.AVOID_LONG || Math.abs(dl) > NPC.AVOID_LAT) return null;
    const away = Math.sign(dl) || (facts.lateral > 0 ? 1 : -1);
    let t = facts.lateral + away * 2.2;
    const lim = this._lim(facts);
    // Against the kerb: go the other way round rather than into the grass.
    if (Math.abs(t) > lim) t = num(n.lateral, 0) - away * 2.4;
    return clampNum(t, -lim, lim, this.laneHome);
  }

  // --- RACE ----------------------------------------------------------------
  _enterRACE() {
    this.decideTimer = 0;
    this.wander = this._drawWander();
  }

  _updateRACE(dt, facts) {
    const P = this.persona;
    // CHARACTER FIRST. Each returns a full intent or null (= race normally).
    if (facts.fixated) { const r = this._shadow(dt, facts); if (r) return r; }
    if (P.draft && !facts.flee) { const r = this._draft(dt, facts); if (r) return r; }
    this.decideTimer -= dt;
    if (this.decideTimer <= 0) {
      const [lo, hi] = NPC.RACE_DECIDE;
      this.decideTimer = lo + this.rand() * (hi - lo);
      // One draw: wander around the lane home, or take the racing line.
      if (this.rand() < 0.2) {
        this.targetLateral = this._racingLine(facts);
      } else {
        this.wander = this._drawWander();
        const lim = facts.halfWidth - NPC.LANE_CLAMP_MARGIN;
        this.targetLateral = clampNum(this.laneHome + this.wander, -lim, lim, this.laneHome);
      }
    }

    // Line overrides, in priority: side-step a rider alongside (clean/coward),
    // mirror the rider on my tail (blocker), close on a grudge up the road.
    let line = this.targetLateral;
    if (P.avoid) { const a = this._avoidLine(facts); if (a !== null) { line = a; this.metrics.avoidT += dt; } }
    if (P.block && line === this.targetLateral) { const b = this._blockLine(dt, facts); if (b !== null) line = clampNum(b, -this._lim(facts), this._lim(facts), line); }
    if (facts.chase && line === this.targetLateral && num(facts.chase.s, 0) - facts.s < 30) line = clampNum(num(facts.chase.lateral, 0), -this._lim(facts), this._lim(facts), line);
    const steer = this._steerTo(line, facts);
    const pace = this._paceIntent(facts, this.persona.speedBias);
    let throttle = this._gapThrottle(pace.throttle, facts);
    if (facts.hpFrac < 0.3) throttle = Math.min(throttle, 0.85);
    this.attack = null;
    return {
      steer, throttle, brake: pace.brake, attack: null,
      tuck: facts.speed > 30,
    };
  }

  _exitRACE() { /* nothing to clean */ }

  // --- HUNT ----------------------------------------------------------------
  // Pick a victim and move to the attacking side, staying OFF their exact line
  // (a punch reaches 2.6 m; two bikes need room). §5.19's pile-up was aiming at
  // the victim's own lateral.
  _enterHUNT(facts) {
    this.victim = facts.victim || this.victim;
    const v = this.victim;
    const side = Math.sign(facts.lateral - num(v?.lateral, facts.lateral))
      || (this.rand() < 0.5 ? -1 : 1);
    const standoff = this.persona.standoff + this.rand() * 0.5;
    const raw = num(v?.lateral, facts.lateral) + side * standoff;
    const lim = facts.halfWidth - NPC.LANE_CLAMP_MARGIN;
    this.targetLateral = clampNum(raw, -lim, lim, this.laneHome);
    this.huntSide = side;
  }

  _updateHUNT(dt, facts) {
    const v = facts.victim || this.victim;
    if (!v) {
      // No victim left: go back to racing. The table catches this too, but
      // returning a sane intent here keeps the frame honest.
      this.targetLateral = this.laneHome;
      return this._updateRACE(dt, facts);
    }
    this.victim = v;

    // Re-aim at the victim's flank each frame, but only gently: the standoff
    // line is a target, not a script.
    const side = this.huntSide || 1;
    const P = this.persona;
    // BRAWL = a fixated rowdy on the player, or a grudge-holder on his man.
    const brawl = !!(facts.fixated || (facts.grudgeTarget && v === facts.grudgeTarget));
    let standoff = P.standoff;
    // THE SWERVE: a brawler periodically closes the standoff by `ram` metres --
    // he rides INTO you (the contact solver turns it into a shove) and back out.
    if (brawl && P.ram > 0) {
      this.ramPhase = (this.ramPhase || 0) + dt * (Math.PI * 2 / 1.3);
      standoff = Math.max(0.55, standoff - P.ram * (0.5 + 0.5 * Math.sin(this.ramPhase)));
    }
    const vLat = brawl ? this._track('huntLat', num(v.lateral, facts.lateral), dt) : num(v.lateral, facts.lateral);
    const raw = vLat + side * standoff;
    const lim = facts.halfWidth - NPC.LANE_CLAMP_MARGIN;
    this.targetLateral = clampNum(raw, -lim, lim, this.laneHome);

    const steer = this._steerTo(this.targetLateral, facts);

    // Close the gap if we are behind; hold if alongside.
    const ds = num(v.s, 0) - facts.s;
    const pace = this._paceIntent(facts, this.persona.speedBias);
    let throttle = pace.throttle;
    let brake = pace.brake;
    if (brawl && P.matchSpeed) {
      // EASE OFF TO MATCH: hold the victim's speed plus a closing term that
      // parks him level with you (not the rider's own pace -- he has stopped
      // racing). Brakes if he is overshooting.
      const ctl = this._matchIntent(num(v.speed, facts.speed) + clampNum((ds - 0.3) * 0.8, -6, 6, 0), facts);
      throttle = ctl.throttle; brake = ctl.brake;
    } else {
      if (ds > 2) throttle = Math.max(throttle, 0.9);     // pull alongside
      else if (ds < -2) throttle = Math.min(throttle, 0.7); // do not overshoot
      throttle = this._gapThrottle(throttle, facts);
    }

    // ---- THE COMMIT WINDOW ------------------------------------------------
    //
    // This used to be a per-frame dice roll: `rand() < want * 0.35` while merely
    // within ATTACK_RANGE. That produced rivals who attacked opportunistically in
    // the statistical sense but not in the readable one -- the player could not
    // see a swing coming, and could not do anything about one.
    //
    // Now the rival must HOLD the alongside condition for DWELL seconds. During
    // that time it visibly leans in (the tell). If the player brakes, throttles
    // or drifts out of the window first, the wind-up ABORTS and the rival is only
    // re-armed briefly -- no hit, and no full cooldown either, so pressing the
    // attack is not punished harder than not pressing it.
    const dsAlong = num(v.s, 0) - facts.s;
    const dlAlong = num(v.lateral, 0) - facts.lateral;
    const inWindow = Math.abs(dsAlong) <= NPC.ALONGSIDE_LONG
      && Math.abs(dlAlong) <= NPC.ALONGSIDE_LAT
      && !facts.down && facts.busy === false
      && this.cooldown <= 0 && this.rearm <= 0;

    if (inWindow) {
      this.dwell += dt;
      this.alongside = true;
    } else {
      // ABORT. Leaving the window before the dwell completes throws the wind-up
      // away and re-arms after a short delay rather than a full cooldown.
      if (this.dwell > 0.05 && this.dwell < NPC.DWELL) this.rearm = NPC.REARM;
      this.dwell = 0;
      this.alongside = false;
    }
    // Aggression and skill shorten the dwell: the brawler telegraphs less. The
    // floor keeps it readable for the player at every level.
    const need = Math.max(P.dwellMul < 1 ? 0.35 : 0.45, NPC.DWELL
      * (1.35 - this.persona.aggression * 0.22 - this.skill * 0.22) * P.dwellMul);

    this.attack = null;
    const intent = { steer, throttle, brake, attack: null, tuck: facts.speed > 30 && !brawl };
    // The rival stays in HUNT and simply holds while winding up; the transition
    // only fires on a COMPLETED dwell, which is what makes the tell visible.
    return this.dwell >= need ? { intent, next: 'ATTACK' } : intent;
  }

  _exitHUNT() {
    this.huntSide = 0;
    // Do NOT zero the dwell here. The abort path in _updateHUNT needs to see how
    // far the wind-up had got in order to decide the re-arm; zeroing on exit
    // would make every abandonment look like it never started.
  }

  // --- ATTACK --------------------------------------------------------------
  // A committed pass: line up, swing, break off. The attack KIND is chosen here
  // and handed out as an intent string; the caller calls fighter.commit(kind).
  _enterATTACK(facts) {
    // A COMMITTED swing: the dwell completed, so the rider now swings and
    // breaks off. Short by design -- the decision was already made during the
    // dwell, and a long ATTACK state is just a rival that stops racing.
    this.attackTimer = NPC.SWING_ANIM;
    // The dwell is spent. It restarts from zero after the swing, and the
    // cooldown below is what actually keeps this rider off the player.
    this.dwell = 0;
    this.alongside = false;
    this.swingFired = false;   // one swing per committed pass
    // COOLDOWN IS SET ON EXIT, not here -- entering ATTACK is not the same as
    // having swung, and the abort path must not pay it.
    const v = facts.victim || this.victim;
    this.victim = v;

    // WEAPON IS CHOSEN AT SWING TIME, NOT HERE.
    //
    // This used to pick the weapon from the distance on the frame ATTACK was
    // entered, while the swing itself was thrown on that same frame -- before
    // the rider had closed. A `kick` chosen at 3 m is out of range for a target
    // that is still 3 m behind, and `resolve` rejected it. The entry now only
    // records which weapon the persona FAVOURS; `_pickWeapon` re-decides at the
    // moment of the swing, using the same distance the arc test will use.
    this.attack = null;
    this.favouredWeapon = (facts.canChain && this.skill > 0.6) ? 'chain' : 'punch';
  }

  /** Re-decide the weapon from the CURRENT distance, at the moment of swinging. */
  _pickWeapon(facts, v) {
    if (!v) return 'punch';
    const ds = num(v.s, 0) - facts.s;
    const dl = num(v.lateral, 0) - facts.lateral;
    const close = Math.hypot(ds, dl);
    const r = this.rand();
    // A brawler with a chain uses it whenever it reaches (VIPER's signature).
    if (facts.canChain && (facts.fixated || facts.grudgeTarget) && close <= ATTACKS.chain.range && r < 0.8) {
      return 'chain';
    }
    // GRAB when wheel to wheel: close, level along the road, and a persona with
    // the nerve for it. The grab is the riskiest move (it ties both bikes
    // together), so it is gated on aggression rather than skill.
    if (Math.abs(ds) < 1.2 && close < ATTACKS.grapple.range - 0.2
        && r < 0.18 + this.persona.aggression * 0.35) {
      return 'grapple';
    }
    // Longest reach first when the gap is large, so a swing is not wasted on a
    // weapon that cannot cover the distance.
    if (facts.canChain && close > ATTACKS.kick.range - 0.5 && r < 0.55 + this.skill * 0.35) {
      return 'chain';
    }
    if (close > ATTACKS.punch.range - 0.35 && r < 0.7) return 'kick';
    return this.favouredWeapon === 'chain' && facts.canChain ? 'chain' : 'punch';
  }

  _updateATTACK(dt, facts) {
    this.attackTimer -= dt;
    const v = facts.victim || this.victim;

    // Steer slightly INTO the victim so the swing connects. This is a lane
    // target, not a physics write.
    let target = this.targetLateral;
    if (v) {
      const bias = Math.sign(num(v.lateral, 0) - facts.lateral) || this.huntSide || 1;
      target = num(this.targetLateral, this.laneHome) + bias * 0.25;
    }
    const lim = facts.halfWidth - NPC.LANE_CLAMP_MARGIN;
    target = clampNum(target, -lim, lim, this.laneHome);

    const steer = this._steerTo(target, facts);
    const pace = this._paceIntent(facts, this.persona.speedBias);
    let throttle = this._gapThrottle(pace.throttle, facts);

    // Hold the committed swing for SWING_ANIM, then break off into cooldown.
    if (this.attackTimer <= 0) {
      this.attack = null;
      const intent = this._updateRACE(dt, facts);
      return { intent, next: 'RACE' };
    }

    // ---- THE SWING FIRES ONCE, ON THE ENTRY FRAME -------------------------
    //
    // The dwell already proved the player was alongside and STAYED alongside, so
    // there is nothing left to decide: the swing is the commit the dwell earned.
    // `_pickWeapon` still refuses to waste a swing that cannot physically reach
    // (the victim may have drifted in the last fraction of a second), and if the
    // geometry has genuinely broken the rider simply holds the swinging pose for
    // SWING_ANIM and then takes its cooldown -- a miss, which is fair.
    let swing = null;
    if (v && this.swingFired !== true) {
      const kind = this._pickWeapon(facts, v);
      if (kind && this._inSwingReach(facts, v, kind)) {
        swing = kind;
        this.swingFired = true;
        this.metrics.attacks++;
      }
    }
    const out = { steer, throttle, brake: pace.brake, attack: swing, tuck: false };
    return out;
  }

  /**
   * Is `v` inside the swing arc for `kind` RIGHT NOW?
   *
   * Mirrors the tests `Fighter.resolve` will apply (range, then the forward
   * cone, then the along-road limit) so an intent that passes here is one the
   * fighter can actually land. Uses the same ATTACKS table, so tuning a weapon
   * cannot desync the two.
   */
  _inSwingReach(facts, v, kind) {
    if (!v || !kind) return false;
    const a = ATTACKS[kind];
    if (!a) return false;
    const ds = num(v.s, 0) - facts.s;
    const dl = num(v.lateral, 0) - facts.lateral;
    const dist = Math.hypot(ds, dl);
    if (dist > a.range) return false;
    // Along-road limit, exactly as resolve() applies it.
    if (Math.abs(ds) > a.range * 1.2) return false;
    // Forward cone. `resolve` measures this off the bike's own forward vector;
    // on the road frame the equivalent is "ahead of me", which is what `ds`
    // being positive means for an attacker chasing up the road. Allow a little
    // alongside slack so a rider level with the victim can still swing, since
    // resolve's cone at ~0.95 rad (~54 deg) already covers a fair overlap.
    if (ds < -a.range * 0.35) return false;
    return true;
  }

  _exitATTACK() {
    this.attackTimer = 0;
    // THE COOLDOWN, PER RIVAL. Set on leaving ATTACK, whether or not the swing
    // landed -- a missed swing is still a swing, and the player should get the
    // same breathing room from it. This is what makes one rider survivable and
    // three a gauntlet, with no difficulty scalar anywhere.
    const [lo, hi] = NPC.COOLDOWN;
    this.cooldown = lo + this.rand() * (hi - lo);
    // Aggression shortens the wait, so the brawler comes back sooner.
    this.cooldown = Math.max(1.5, this.cooldown * (1.25 - this.persona.aggression * 0.3));
    // Character: VIPER swings again sooner (cooldownMul 0.55), a grudge a bit.
    this.cooldown = Math.max(0.9, this.cooldown * (this.persona.cooldownMul || 1));
  }

  // --- EVADE ---------------------------------------------------------------
  // Get out of the fight: pick the side away from the nearest threat, open a
  // gap, and stay on the road.
  _enterEVADE(facts) {
    this.evadeTimer = NPC.EVADE_TIME;
    if (facts.flee) this._event('flee');
    const threat = facts.threat || facts.nearest;
    const threatLat = threat ? num(threat.lateral, 0) : 0;
    const away = Math.sign(facts.lateral - threatLat) || (this.rand() < 0.5 ? -1 : 1);
    const lim = facts.halfWidth - NPC.LANE_CLAMP_MARGIN;
    // Away from the threat, biased toward the inside of the corner so it does
    // not simply run to the kerb.
    const inside = Math.sign(facts.curvature) || away;
    const raw = facts.lateral + away * 2.6 + inside * 0.6;
    this.targetLateral = clampNum(raw, -lim, lim, this.laneHome);
  }

  _updateEVADE(dt, facts) {
    this.evadeTimer -= dt;
    if (this.evadeTimer <= 0) {
      const intent = this._updateRACE(dt, facts);
      return { intent, next: 'RACE' };
    }
    // COWARD'S RUN: far kerb, and either flat out (threat behind) or on the
    // brakes to let it go by (threat level or ahead) -- whichever opens the gap.
    if (facts.flee && facts.threat) {
      const t = facts.threat;
      const lim = this._lim(facts);
      this.targetLateral = clampNum(-Math.sign(num(t.lateral, 0) || 1) * lim, -lim, lim, this.laneHome);
      const ds = num(t.s, 0) - facts.s;
      const steer = this._steerTo(this.targetLateral, facts);
      if (ds < -3) return { steer, throttle: 1, brake: 0, attack: null, tuck: true };
      const slow = facts.speed > Math.max(8, num(t.speed, 0) - 6);
      return { steer, throttle: slow ? 0 : 0.4, brake: slow ? 0.45 : 0, attack: null, tuck: false };
    }
    const steer = this._steerTo(this.targetLateral, facts);
    const pace = this._paceIntent(facts, this.persona.speedBias);
    // Back the pace off slightly while hurt, but never to a crawl.
    let throttle = Math.min(pace.throttle, 0.8 + this.skill * 0.15);
    if (facts.hpFrac < NPC.HP_FLEE) throttle = Math.min(throttle, 0.6);
    throttle = this._gapThrottle(throttle, facts);
    this.attack = null;
    return { steer, throttle, brake: pace.brake, attack: null, tuck: facts.speed > 30 };
  }

  _exitEVADE() { this.evadeTimer = 0; }

  // --- RECOVER -------------------------------------------------------------
  // Straighten up: get back on the road and pointing down it before resuming.
  _enterRECOVER(facts) {
    this.recoverTimer = NPC.RECOVER_TIME;
    // Aim for a point well inside the tarmac, on the side we are already on, so
    // the correction does not cross the whole road.
    const side = Math.sign(facts.lateral) || 1;
    const lim = facts.halfWidth - NPC.LANE_CLAMP_MARGIN;
    this.targetLateral = clampNum(side * Math.min(lim, facts.halfWidth * 0.4), -lim, lim, 0);
  }

  _updateRECOVER(dt, facts) {
    if (this.down) return { steer: 0, throttle: 0, brake: 0, attack: null, tuck: false };
    this.recoverTimer -= dt;
    if (this.recoverTimer <= 0) {
      const intent = this._updateRACE(dt, facts);
      return { intent, next: 'RACE' };
    }
    const steer = this._steerTo(this.targetLateral, facts);
    const pace = this._paceIntent(facts, this.persona.speedBias);
    // Recover at a reduced pace while off the tarmac; full pace once back on.
    const throttle = facts.onRoad ? pace.throttle : Math.min(pace.throttle, 0.9);
    this.attack = null;
    return { steer, throttle, brake: pace.brake * 0.5, attack: null, tuck: false };
  }

  _exitRECOVER() { this.recoverTimer = 0; }
}