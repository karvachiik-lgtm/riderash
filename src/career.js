import { makeLook } from './bodyspec.js';
import { CFG } from './config.js';
// RideRash — the career.
//
// WHY THIS EXISTS. Road Rash is not one race, it is a ladder: you ride, you are
// paid by where you finished, you buy a faster bike, and the field gets harder.
// Without that the game is a very good ride with nothing around it — you cannot
// win, only stop.
//
// PERSISTENCE IS `localStorage`, WHICH IS NOT A FILE. The asset contract forbids
// files and the network; browser storage is neither, it is state the page owns.
// A missing or corrupt record degrades to a fresh career rather than throwing:
// a save that breaks the game is worse than no save.
//
// NO GLYPHS IN THE WORLD, but this is UI chrome, so names and numbers are fine
// here exactly as they are on the title screen.

const KEY = 'riderash.career.v1';

// ---------------------------------------------------------------------------
// THE LADDER: FIVE LEVELS x FIVE TRACKS = 25 RACES.
//
// This is the structure of Road Rash 1, agreed with the user this session. Each
// LEVEL runs the SAME FIVE COURSES, and:
//
//   - the field and purse escalate per level,
//   - HIGHER LEVELS RUN THE COURSES LONGER -- the track you learned in L1 keeps
//     going past where it used to end in L4. `lenMul` is that multiplier, and it
//     is applied to the map's sector lengths at load, so the reuse is not pure
//     repetition.
//
// PURSE PACING. Prizes are TOP-3 ONLY and scale with the level. The rule that
// makes the whole thing work is: ONE FULL LEVEL'S WINNINGS ~= ONE BIKE TIER, so
// the player is permanently one class behind the field and never comfortably
// rich. Levels 4-5 lose their teeth the moment that rule is broken.
//
// `skill`/`aggro` multiply the rival constants in config.js.
// ---------------------------------------------------------------------------

// One course per slot, in the order the five tracks are faced. `key` is stable
// and is what a career record stores, so reordering this list cannot corrupt an
// in-progress save into the wrong race.
const COURSES = [
  { map: 'sierra',    name: 'SIERRA NEVADA' },
  { map: 'coastal',   name: 'PACIFIC COAST' },
  { map: 'valley',    name: 'NAPA VALLEY' },
  { map: 'peninsula', name: 'PENINSULA' },
  { map: 'desert',    name: 'PALM DESERT' },
  { map: 'ghat',      name: 'GHAT ROAD' },     // the finale of every level: a cliff road
];

// `reference` is the ABSOLUTE pace the field is built around at this level: the
// top speed (m/s) of the bike tier the player is expected to own. MEASURED, not
// guessed -- the RAT sustains 46.1 m/s in the live physics, and the rest are
// that anchor scaled by the bike power multipliers (see BIKES below and
// 5.43 in HANDOFF.md for the derivation). Every rival's target speed is
// distributed around this number, which is why placement changes across the
// career WITHOUT any rival ever reading the player's speed.
// THE REFERENCE IS DERIVED, AND IT HAD DRIFTED. These were literals (46.1,
// 49.4, 52.0, 55.0, 58.1): the RAT's measured terminal times sqrt(power) for
// each tier. The physics was retuned afterwards and the RAT now sustains
// CFG.MAX_SPEED (48.16) -- and the bike power multipliers were never applied at
// all -- so every rival's pace sat below a player who just held the throttle.
// Now: the expected tier's real top speed, from the same numbers BikePhys uses.
export const TIER_POWER = [1.00, 1.14, 1.26, 1.40, 1.56];
const tierTop = (tier) => CFG.MAX_SPEED * Math.sqrt(TIER_POWER[tier - 1] || 1);
const LEVELS = [
  { tier: 1, lenMul: 1.00, purse: 1200, skill: 0.80, aggro: 0.60, reference: tierTop(1) },
  { tier: 2, lenMul: 1.20, purse: 2600, skill: 0.92, aggro: 0.78, reference: tierTop(2) },
  { tier: 3, lenMul: 1.45, purse: 5200, skill: 1.04, aggro: 0.96, reference: tierTop(3) },
  { tier: 4, lenMul: 1.75, purse: 9500, skill: 1.16, aggro: 1.14, reference: tierTop(4) },
  { tier: 5, lenMul: 2.05, purse: 17000, skill: 1.28, aggro: 1.32, reference: tierTop(5) },
];

/** Flattened 25-race schedule. Index is the career race number. */
export const SERIES = [];
for (const lv of LEVELS) {
  COURSES.forEach((c, ci) => {
    // WITHIN A LEVEL THE RACES GET HARDER TOO: each course a touch quicker and
    // smarter than the last (+1.5% pace, +0.04 skill, +0.04 aggression), so a
    // level ramps toward its last race instead of being five equal ones.
    const k = ci / Math.max(1, COURSES.length - 1);
    SERIES.push({
      key: `L${lv.tier}-${c.map}`,
      name: c.name,
      level: lv.tier,
      map: c.map,
      lenMul: lv.lenMul,
      reference: lv.reference * (1 + 0.015 * ci),
      purse: lv.purse,
      skill: lv.skill + 0.04 * ci,
      aggro: lv.aggro + 0.04 * ci,
      ramp: k,
      field: 15,
    });
  });
}

export const LEVEL_COUNT = LEVELS.length;
export const COURSE_COUNT = COURSES.length;
export const COURSES_UI = COURSES.map((c) => ({ map: c.map, name: c.name }));

// ---------------------------------------------------------------------------
// The garage. Each bike is a set of MULTIPLIERS on the tuned PHYS values rather
// than a second set of absolutes, so the handling work stays in one place and a
// faster bike cannot quietly become a differently-behaving one.
//
// `mesh` picks the bodywork treatment in assets/bike.js territory — it is a
// colour and a scale hint, not a model file.
// ---------------------------------------------------------------------------
// Prices are set against the PURSE LADDER above so that clearing one level
// (five races, top-3 finishes) buys roughly ONE tier -- the player is always
// riding one class behind the field, which is the engine of the game. Level 1
// won clean is ~3.5-4k; each tier then roughly matches a level's take.
export const BIKES = [
  { id: 'rat',     name: 'RAT',     price: 0,      power: TIER_POWER[0], grip: 1.00, mass: 1.00, colour: 0xc4442a,
    blurb: 'Sun-bleached and rusted. It is what you have.' },
  { id: 'racer',   name: 'RACER',   price: 4200,   power: TIER_POWER[1], grip: 1.08, mass: 0.96, colour: 0x2f6f8f,
    blurb: 'Lighter, stickier, and it revs out properly.' },
  { id: 'brawler', name: 'BRAWLER', price: 11000,  power: TIER_POWER[2], grip: 1.13, mass: 1.09, colour: 0xb8912e,
    blurb: 'Heavy enough to win a shoving match. Fast enough to matter.' },
  { id: 'works',   name: 'WORKS',   price: 26000,  power: TIER_POWER[3], grip: 1.19, mass: 1.04, colour: 0x6a3fd4,
    blurb: 'Factory parts, a team truck, and no excuses left.' },
  { id: 'super',   name: 'SUPERBIKE', price: 52000, power: TIER_POWER[4], grip: 1.25, mass: 1.00, colour: 0x1fbf6a,
    blurb: 'The fastest thing on the coast. Ride it like you stole it.' },
  // THE EASTER EGG: a sport bike's bodywork on ONE fat wheel (assets/bike_mono.js).
  // The fastest thing in the garage and the hardest to ride: more top end than
  // the superbike, a lane change like a thought, but less grip in the bends,
  // softer brakes, and 2.2x the heft of any bike: it shrugs off
  // shoves, traffic and rammers, and is slow to haul back up after a wreck. Not for sale
  // until Level 4 -- anyone can take it for a TEST RIDE.
  { id: 'mono', name: 'ONE-WHEELER', price: 90000, power: 1.64, grip: 0.9, mass: 1.15, heft: 2.2, agility: 1.35, brake: 0.8, frail: 1.0,
    colour: 0xe0501c, unlockLevel: 4, isNew: true,
    blurb: 'One wheel. No brakes worth mentioning. No regrets.' },
];

// ---------------------------------------------------------------------------
// THE LOSS CONDITION: THE PUNISHMENT METER (user, this session).
//
// Crashes accrue damage. The repair bill is charged at RESULTS, BEFORE the prize
// becomes usable. If cash goes NEGATIVE, the career is over -- "you're out of
// the game". This is what makes finishing 4th meaningful: you advance but earn
// nothing, so a crashy 4th sets you backward.
//
// Cop fines land on the same meter once cops exist, as a second and larger bill.
// ---------------------------------------------------------------------------
export const REPAIR = {
  // THE BILL SCALES WITH THE LEVEL, because the purse does. A flat cost per
  // damage would be a brutal 7.5% of the L1 purse and a trivial 1% of L5's,
  // which is backwards: the early game would break a mid-skill player while the
  // late game paid for itself. Cost is a FRACTION OF THE EVENT PURSE instead, so
  // the pressure is the same at every tier.
  //
  // 0.075 means one full wreck costs 7.5% of the race purse; a typical race with
  // two crashes is ~15%, which is why finishing 4th with crashes is a real loss.
  COST_FRAC_OF_PURSE: 0.075,
  // Damage per event type. These are the DURING-RACE accruals the meter shows.
  WRECK: 1.00,
  CAR_HIT: 0.45,
  WALL_HIT: 0.30,
  // A bike nobody has crashed is free to run; damage only ever costs money.
  MAX_DAMAGE: 3.0,          // beyond this the machine is a write-off
};

const FRESH = {
  race: 0, cash: 350, bike: 'rat', owned: ['rat'], best: {}, wins: 0, finished: false,
  over: false,               // the career has ENDED: broke with a wrecked bike
  rider: null,               // the designed rider's SPEC, or null for the default
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...FRESH, owned: [...FRESH.owned], best: {} };
    const d = JSON.parse(raw);
    // Validate rather than trust. A hand-edited or half-written record should
    // start a clean career, not put the game in a state no code path expects.
    if (typeof d !== 'object' || d === null) return { ...FRESH, owned: [...FRESH.owned], best: {} };
    return {
      race: Number.isFinite(d.race) ? Math.max(0, Math.min(SERIES.length, Math.floor(d.race))) : 0,
      // Cash may legitimately go NEGATIVE -- that is what ends a career -- so it
      // is NOT clamped at 0 here. Clamping would turn the loss condition into a
      // soft-lock at zero.
      cash: Number.isFinite(d.cash) ? d.cash : FRESH.cash,
      bike: BIKES.some((b) => b.id === d.bike) ? d.bike : FRESH.bike,
      // THE GARAGE. `owns()` always read this, but nothing ever wrote it and
      // read() dropped it, so buying a second bike threw the first away and
      // switching back cost full price again. Older saves have no list: they
      // own the free bike and whatever they were riding.
      owned: ownedList(d.owned, d.bike),
      best: bestTimes(d.best),
      wins: Number.isFinite(d.wins) ? d.wins : 0,
      finished: !!d.finished,
      over: !!d.over,
      // THE DESIGNED RIDER. The showroom's spec is a flat object of numbers and a
      // small colour map, so it round-trips through JSON unchanged. It is
      // VALIDATED the same way as everything else here: only the four inputs the
      // showroom actually derives from are kept, so a hand-edited record cannot
      // inject a body the showroom would not build. Everything downstream
      // (trunk, arm, leg, seat contact) is re-derived by makeSpec from these
      // four, which is the whole reason the spec exists as a derived object.
      rider: sanitiseRider(d.rider),
    };
  } catch (e) {
    return { ...FRESH, owned: [...FRESH.owned], best: {} };
  }
}

function ownedList(list, riding) {
  const ids = new Set(Array.isArray(list) ? list.filter((id) => BIKES.some((b) => b.id === id)) : []);
  for (const b of BIKES) if (b.price === 0) ids.add(b.id);
  if (BIKES.some((b) => b.id === riding)) ids.add(riding);
  return BIKES.filter((b) => ids.has(b.id)).map((b) => b.id);
}

// Only positive finite times survive: a NaN best would make every later time
// "not a best" (every comparison with NaN is false) and silently freeze it.
function bestTimes(b) {
  const out = {};
  if (b && typeof b === 'object') {
    for (const [k, v] of Object.entries(b)) if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

function write(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: play on */ }
}

// The four inputs the showroom derives a body from, plus its colours. Kept HERE
// rather than in bodyspec so the persistence layer owns the shape it stores -- if
// the showroom ever grows a fifth slider, this is the one place that has to learn
// about it, and the failure mode is a dropped field rather than a corrupt save.
const RIDER_BUILDS = ['lean', 'normal', 'stocky', 'heavy'];
// the default head went from 1.0 to 1.25x: a save still on an old default (1.0,
// or the brief 1.5) moves with it once; a size the player chose is left alone
function headV3(r, look) {
  if (!r.headV3 && (look.headSize === 1 || look.headSize === 1.5)) look.headSize = 1.25;
  return look;
}
function sanitiseRider(r) {
  if (!r || typeof r !== 'object') return null;
  const num = (v, lo, hi, fb) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb);
  const col = (v, fb) => (Number.isFinite(v) ? (v >>> 0) & 0xffffff : fb);
  const c = (r.colors && typeof r.colors === 'object') ? r.colors : {};
  return {
    height: num(r.height, 1.45, 2.10, 1.75),
    build: RIDER_BUILDS.includes(r.build) ? r.build : 'normal',
    shoulderWide: num(r.shoulderWide, 0.70, 1.30, 1),
    limbLong: num(r.limbLong, 0.85, 1.15, 1),
    colors: {
      jacket: col(c.jacket, 0x2a2624),
      pants:  col(c.pants,  0x3b4a63),
      helmet: col(c.helmet, 0xd8d2c4),
      accent: col(c.accent, 0xd4622a),
      skin:   col(c.skin,   0x9c7358),
    },
    // the wardrobe: bodyspec.makeLook validates every field on the way in
    look: headV3(r, makeLook(r.look)),
    headV3: true,
  };
}

export class Career {
  constructor() { this.state = read(); }

  get cash() { return this.state.cash; }
  get raceIndex() { return Math.min(this.state.race, SERIES.length - 1); }
  get event() { return SERIES[this.raceIndex]; }
  get complete() { return this.state.race >= SERIES.length && !this.state.over; }
  get over() { return !!this.state.over; }
  get bike() { return BIKES.find((b) => b.id === this.state.bike) || BIKES[0]; }
  get wins() { return this.state.wins; }

  /**
   * The player's designed rider, or null to use the default body. Returned as a
   * plain object of the four slider inputs plus colours; the caller derives a
   * full spec from it with makeSpec, so the saved record can never disagree with
   * the body the game builds.
   */
  get rider() { return this.state.rider; }

  /** Save the designed rider. Idempotent; called when the showroom closes. */
  setRider(spec) {
    if (!spec) return;
    const s = sanitiseRider({
      height: spec.height,
      build: spec.buildName || spec.build,
      shoulderWide: spec.shoulderWide,
      limbLong: spec.limbLong,
      colors: spec.colors,
      look: spec.look,
      headV3: true,
    });
    if (!s) return;
    this.state.rider = s;
    write(this.state);
  }

  /** Which level (1-based) the player is currently riding in. */
  get level() { return this.event.level; }
  /** How many of the 25 races are done, for the HUD. */
  get progress() { return { race: this.state.race, total: SERIES.length }; }

  owns(id) {
    const b = BIKES.find((x) => x.id === id);
    return !!b && (b.price === 0 || this.state.owned.includes(id) || this.state.bike === id);
  }

  /** Prize money by finishing position, plus a win bonus. TOP 3 ONLY. */
  payout(pos, field) {
    const purse = this.event.purse;
    // TOP THREE ONLY, as in the original. This is the whole point: a 4th-place
    // finish ADVANCES you but pays nothing, so a crashy 4th is a net loss once
    // the repair bill lands. Payouts below 3rd are deliberately zero, not small.
    const share = [0.45, 0.28, 0.17][pos - 1] ?? 0;
    return Math.round(purse * share) + (pos === 1 ? Math.round(purse * 0.12) : 0);
  }

  /**
   * The repair bill for a race's accumulated damage, scaled to THIS event's
   * purse so the pressure is constant across the five tiers.
   */
  repairBill(damage) {
    const per = this.event.purse * REPAIR.COST_FRAC_OF_PURSE;
    return Math.round(Math.max(0, damage) * per);
  }

  /**
   * Record a finished race. Returns what changed, for the results screen.
   *
   * ORDER MATTERS AND IS THE WHOLE DESIGN: the damage the rider did to the
   * machine is billed BEFORE the prize is banked, so the results screen can show
   * the bill first and the money second. `damage` is accrued during the race
   * (career.REPAIR) and is passed in by the race loop.
   */
  finish(pos, field, timeSec, damage = 0) {
    const bill = this.repairBill(damage);
    const paid = this.payout(pos, field);
    this.state.cash += paid - bill;

    const key = this.event.key || this.event.name;
    const prev = this.state.best[key];
    const isBest = !prev || timeSec < prev;
    if (isBest) this.state.best[key] = timeSec;
    if (pos === 1) this.state.wins++;

    // Advance at 4th or better (the original's rule), NOT only a podium. You
    // progress on a 4th, but a 4th pays nothing -- so the bill is what decides
    // whether that progress was actually worth it.
    const advanced = pos <= 4;
    if (advanced) this.state.race = Math.min(SERIES.length, this.state.race + 1);
    if (this.state.race >= SERIES.length) this.state.finished = true;

    // THE LOSS CONDITION. Busted to below zero and nothing left to sell: the run
    // is over. `finished` means you won the ladder; `over` means it beat you.
    if (this.state.cash < 0) {
      this.state.over = true;
      this.state.finished = false;
    }

    write(this.state);
    return {
      paid, bill, isBest, advanced, complete: this.complete, over: this.state.over,
      cash: this.state.cash,
    };
  }

  /**
   * BUSTED. The race is void: no placing, no prize, no progress -- and the fine
   * lands on top of the repair bill. In the original a bust you could not pay
   * ended the game, and that is exactly the loss condition finish() uses.
   */
  bust(fine, damage = 0) {
    const bill = this.repairBill(damage);
    this.state.cash -= fine + bill;
    if (this.state.cash < 0) { this.state.over = true; this.state.finished = false; }
    write(this.state);
    return { fine, bill, over: this.state.over, cash: this.state.cash };
  }

  buy(id) {
    const b = BIKES.find((x) => x.id === id);
    if (!b) return { ok: false, why: 'no such bike' };
    if (this.state.over) return { ok: false, why: 'career is over' };
    if (this.state.bike === id) return { ok: false, why: 'already riding it' };
    // Switching to a bike already in the garage is free.
    if (this.owns(id)) {
      this.state.bike = id;
      write(this.state);
      return { ok: true, bike: b, cash: this.state.cash, switched: true };
    }
    if (b.unlockLevel && this.level < b.unlockLevel) return { ok: false, why: `on sale from Level ${b.unlockLevel} - take it for a test ride` };
    if (this.state.cash < b.price) return { ok: false, why: 'not enough cash' };
    this.state.cash -= b.price;
    this.state.bike = id;
    this.state.owned = ownedList([...this.state.owned, id], id);
    write(this.state);
    return { ok: true, bike: b, cash: this.state.cash };
  }

  // Deep enough to matter: a shallow copy would share FRESH's `owned` array and
  // `best` object, so the first purchase after a reset would edit FRESH itself.
  /** Developer mode only (devmode.js): patch the saved state directly. */
  devSet(patch) {
    Object.assign(this.state, patch);
    write(this.state);
    return this.state;
  }

  reset() {
    this.state = { ...FRESH, owned: [...FRESH.owned], best: {} };
    write(this.state);
    return this.state;
  }
}
