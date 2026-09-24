// RideRash — THE ROSTER.
//
// WHAT THIS REPLACES, and why it existed at all.
//
// Before this file, a rival's identity was DERIVED BY ARITHMETIC from its grid
// slot:
//
//     name    = RIVAL_NAMES[index]                              // config.js
//     persona = PERSONA_ROTATION[index % PERSONA_ROTATION.length] // rivals.js
//     skill   = clamp(0.5 + ((index * 0.37) % 1) * SPREAD)       // rivals.js
//     weapon  = index % 3 === 2                                  // rivals.js
//
// So "HALVERSON is aggressive and good with a chain" was not a decision anybody
// made -- it was the residue of `index % 3` and a hash. Adding a sixth rival
// silently re-rolled who everybody was, and two riders could not share a
// temperament or a weapon without breaking the cycle. Nothing was tunable and
// nothing was readable.
//
// This file makes identity AUTHORED DATA. A rider is a record: a name, a
// temperament, how good they are, what they carry, and what they are known for.
// The pack is then a list of records. Adding a rider means adding a row.
//
// ---------------------------------------------------------------------------
// WHY THESE FIELDS, AND WHERE THEY COME FROM
// ---------------------------------------------------------------------------
//
// From the Road Rash design (see ROADRASH.md, researched from the 1991 manual):
//
//   * Opponents have INDIVIDUAL NAMES AND CHARACTERS, and were given banter
//     between races. The developers added this specifically "to increase the
//     player's sense of immersion" -- so name, voice and temperament are
//     designed features, not decoration.
//   * SOME OPPONENTS WIELD CLUBS, and you take one by attacking its owner as
//     they hold it out. So "carries a weapon" is a per-character trait with a
//     counterplay, not a random flag.
//   * Rivals are ejected when their stamina runs out, exactly like the player.
//
// So a roster row answers: who is this, how good are they, and what do they do
// that nobody else does? `specialty` is the last of those -- a readable label
// for the player AND a documented intent for the tuning.
//
// ---------------------------------------------------------------------------
// HOW IT IS CONSUMED
// ---------------------------------------------------------------------------
//
// `fieldFor(event, count)` returns the pack for a race. It reads the event's
// `skill` and `aggro` (career.js SERIES) and scales each rider's authored
// numbers, so the same character is genuinely harder in GRUDGE MATCH than in
// COAST OPENER without anybody editing a table. Authored identity, scaled
// difficulty.
//
// Nothing here imports anything or calls Math.random: it is a constant table
// plus functions of (event, count, seed). The one impurity is reading the
// session seed (`?seed=`, else crypto) once at load -- see PER-RACE RANDOMNESS.

// Temperaments. These are the names `npc.js` PERSONAS actually implements; a
// roster row must name one of them or construction throws loudly rather than
// silently falling back to `clean`, which is how a missing persona would
// otherwise hide.
//
// SAME MACHINE, DIFFERENT RIDER (user, this session): "bike limits should be
// the same for all ... the interesting part is how they behave". Nothing in a
// roster row touches the engine, the drag, the grip or the top speed -- every
// rival rides a BikePhys with the player's own CFG.MAX_SPEED terminal. What a
// row changes is BEHAVIOUR: how hard the rider pushes (a preferred pace, capped
// by the machine), when and whom he fights, how he takes a line, whether he
// tows, blocks, runs or remembers. See npc.js PERSONAS for the numbers.
//
//   aggressive  swings first, chases the wounded
//   clean       races; side-steps anybody who comes alongside
//   blocker     mirrors the line of whoever is on his tail
//   rowdy       VIPER. Inside ~15 m of you he stops racing: matches your speed,
//               swerves into you and swings again and again
//   coward      fine until hurt, then runs from anybody near him
//   grudge      remembers who hit him and hunts that rider, not the race
//   drafter     sits in your tow, then slingshots past
//   cop         cops.js only
export const TEMPERAMENTS = ['aggressive', 'clean', 'blocker', 'rowdy', 'coward', 'grudge', 'drafter', 'cop'];

// Weapons a character can carry. `null` means bare hands, which is what most of
// the field has -- the club is supposed to be a threat you notice.
export const WEAPONS = [null, 'chain'];

/**
 * THE ROSTER. Fourteen riders: a full Road Rash field plus the player, and one
 * secret row (`secret: true`) that only the level-5 easter egg ever deals.
 *
 * `skill` is 0..1 and is the base before the event scales it. It is COMPETENCE
 * (lines, look-ahead, how cleanly a swing is timed) and the rider's rank in the
 * field's preferred pace -- never engine power.
 *
 * Card fields (src/charcard.js shows them, read-only):
 *   bio        two sentences of who he is
 *   bike       what he calls his machine (the machine itself is the paddock's
 *              standard spec -- same limits as yours)
 *   style      the behaviour label, in plain words
 *   stats      0..10 bars: aggression, pace, skill, dirty, grudge. AUTHORED to
 *              agree with the persona numbers; if you retune one, retune both.
 *   signature  the move to watch for
 *   quote      what he says on the card
 *   taunts     { hit: [...], hurt: [...] } -- toasts in race (HTML, not 3D)
 */
export const ROSTER = [
  {
    id: 'brega', name: 'BREGA', temperament: 'clean', skill: 0.55, weapon: null,
    specialty: 'Metronome',
    blurb: 'Holds the same line all race. Beat him on the brakes or not at all.',
    bio: 'Ex-courier who rides like he is still on the clock. Has never once been seen throwing the first punch.',
    bike: 'Old Faithful', style: 'Clean racer - steps aside when you pull alongside',
    stats: { aggression: 2, pace: 5, skill: 5, dirty: 1, grudge: 2 },
    signature: 'The Sidestep - drifts a lane wide the moment you draw level',
    quote: 'I race the road, not you.',
    taunts: { hit: ['Sorry. Reflex.'], hurt: ['Not my fight, pal.', 'Hey! Eyes on the road!'] },
  },
  {
    id: 'viper', name: 'VIPER', temperament: 'rowdy', skill: 0.58, weapon: 'chain',
    specialty: 'Cheap shot',
    blurb: 'Swings the moment you are alongside, never before.',
    bio: 'Banned from three counties and proud of every one. Would rather finish last with your blood on his chain than first without it.',
    bike: 'The Fang', style: 'Rowdy - within 15 m he eases off to your speed and comes at you',
    stats: { aggression: 10, pace: 5, skill: 5, dirty: 10, grudge: 7 },
    signature: 'Snake Bite - brakes to your wheel, swerves in, swings again',
    quote: 'Slow down. I wanna talk to you.',
    taunts: { hit: ['Hssss.', 'Tag, you\'re it!', 'Say goodnight.', 'Again? Again!'], hurt: ['Oh, now it\'s personal.', 'Cute.'] },
    mugshot: { number: 'RR-0666', charges: 'Assault with a chain / Reckless riding / Stealing a police horse' },
  },
  {
    id: 'delaney', name: 'DELANEY', temperament: 'coward', skill: 0.62, weapon: null,
    specialty: 'Runs away',
    blurb: 'Breaks off the moment a fight turns. Hard to finish, easy to out-race.',
    bio: 'Fast when nobody is looking at him. The first hit sends him to the far kerb and he stays there.',
    bike: 'Getaway', style: 'Coward - fine until hurt, then runs from anyone near',
    stats: { aggression: 3, pace: 6, skill: 6, dirty: 3, grudge: 1 },
    signature: 'The Vanishing Act - hurt, he brakes and lets you go by',
    quote: 'Race you? Sure. Fight you? Ha. No.',
    taunts: { hit: ['Sorry sorry sorry!'], hurt: ['I\'m out! I\'m out!', 'Not the face!'] },
  },
  {
    id: 'biff', name: 'BIFF', temperament: 'grudge', skill: 0.66, weapon: null,
    specialty: 'Leans on you',
    blurb: 'Rides into you rather than past you and calls it racing.',
    bio: 'Forgets his own birthday; never forgets a face that hit him. Will give up a podium to settle a score.',
    bike: 'Payback', style: 'Grudge-holder - hunts whoever last hit him',
    stats: { aggression: 6, pace: 6, skill: 6, dirty: 6, grudge: 10 },
    signature: 'The Receipt - rides past three riders to hit the one who hit him',
    quote: 'I remember you.',
    taunts: { hit: ['Paid in full.', 'Remember me now?'], hurt: ['Big mistake.', 'I\'m writing this down.'] },
  },
  {
    id: 'halverson', name: 'HALVERSON', temperament: 'aggressive', skill: 0.70, weapon: null,
    specialty: 'First to swing',
    blurb: 'Comes at you before you have decided to fight. Punch and go.',
    bio: 'Former amateur boxer with a riding licence of doubtful origin. Treats every pass as round one.',
    bike: 'Southpaw', style: 'Aggressive - picks fights with whoever is in front',
    stats: { aggression: 8, pace: 7, skill: 7, dirty: 6, grudge: 4 },
    signature: 'One-Two - jab, kick, gone',
    quote: 'Ding ding.',
    taunts: { hit: ['Ding ding!', 'Stay down.'], hurt: ['Lucky.', 'Round two.'] },
  },
  {
    id: 'natasha', name: 'NATASHA', temperament: 'drafter', skill: 0.72, weapon: null,
    specialty: 'Late braker',
    blurb: 'Out-brakes you into the corner and is gone on the exit.',
    bio: 'Physics student. Knows exactly how much air you are pushing and intends to ride in the hole you leave.',
    bike: 'Vacuum', style: 'Drafter - sits in your tow, then slingshots past',
    stats: { aggression: 4, pace: 7, skill: 8, dirty: 3, grudge: 3 },
    signature: 'The Slingshot - six metres off your tail, then gone',
    quote: 'Thanks for the tow.',
    taunts: { hit: ['Excuse me.'], hurt: ['Rude.', 'You\'ll keep.'] },
  },
  {
    id: 'nakamura', name: 'K. NAKAMURA', temperament: 'blocker', skill: 0.76, weapon: null,
    specialty: 'Roadblock',
    blurb: 'Parks on your line and refuses to be passed. You have to go around.',
    bio: 'Watches mirrors more than the road. Whatever line you pick, he was on it first.',
    bike: 'Mirror', style: 'Blocker - copies your line when you are on his tail',
    stats: { aggression: 5, pace: 7, skill: 8, dirty: 5, grudge: 4 },
    signature: 'The Door - slams across the gap you were aiming for',
    quote: 'After you. No, actually -- after me.',
    taunts: { hit: ['Door\'s shut.'], hurt: ['Go around.'] },
  },
  {
    id: 'axel', name: 'AXEL', temperament: 'aggressive', skill: 0.80, weapon: 'chain',
    specialty: 'Heavy hands',
    blurb: 'Carries the club and is not subtle about using it.',
    bio: 'Bouncer by night, bouncer by day. Swings the chain like he is paid by the swing.',
    bike: 'Doorman', style: 'Aggressive - chain first, questions never',
    stats: { aggression: 9, pace: 8, skill: 8, dirty: 8, grudge: 5 },
    signature: 'Last Orders - a full chain swing from behind',
    quote: 'You\'re not on the list.',
    taunts: { hit: ['Not on the list.', 'Out you go.'], hurt: ['That\'s a ban.'] },
  },
  {
    id: 'voss', name: 'VOSS', temperament: 'grudge', skill: 0.83, weapon: 'chain',
    specialty: 'Carries',
    blurb: 'Swings the club. Take it off him by hitting him mid-swing.',
    bio: 'Quiet, patient, keeps a list. Your name goes on it the first time you touch him.',
    bike: 'Ledger', style: 'Grudge-holder with a chain',
    stats: { aggression: 6, pace: 8, skill: 8, dirty: 7, grudge: 9 },
    signature: 'Collections - hunts his debtor across the whole field',
    quote: 'Everyone pays eventually.',
    taunts: { hit: ['Account settled.'], hurt: ['Noted.'] },
  },
  {
    id: 'kim', name: 'KIM', temperament: 'clean', skill: 0.86, weapon: null,
    specialty: 'Smooth operator',
    blurb: 'Never makes a mistake, never gives you one either.',
    bio: 'Club racer slumming it on public roads. Thinks fighting is for people who cannot corner.',
    bike: 'Apex', style: 'Clean racer - fast, tidy, avoids contact',
    stats: { aggression: 2, pace: 9, skill: 9, dirty: 1, grudge: 2 },
    signature: 'The Apex - takes the inside and never looks back',
    quote: 'Fighting is for people who can\'t corner.',
    taunts: { hit: ['Oops.'], hurt: ['Seriously?'] },
  },
  {
    id: 'ferreira', name: 'FERREIRA', temperament: 'clean', skill: 0.88, weapon: null,
    specialty: 'Smooth',
    blurb: 'Never out of shape, never off the road. The pace everybody else chases.',
    bio: 'Two-time hillclimb champion. Sets the pace and dares the field to keep it.',
    bike: 'Metronomo', style: 'Clean racer - the pace-setter',
    stats: { aggression: 2, pace: 9, skill: 9, dirty: 1, grudge: 3 },
    signature: 'The Gap - by the second bend you are racing his dust',
    quote: 'Catch me first.',
    taunts: { hit: ['Stay back.'], hurt: ['Amateur.'] },
  },
  {
    id: 'kessler', name: 'KESSLER', temperament: 'drafter', skill: 0.91, weapon: null,
    specialty: 'Wheelsucker',
    blurb: 'Sits on your tail and takes the place the moment you make a mistake.',
    bio: 'Has not led a lap since 1989 and has won a lot of races since 1989.',
    bike: 'Shadow', style: 'Drafter - lives in your slipstream',
    stats: { aggression: 4, pace: 9, skill: 9, dirty: 4, grudge: 3 },
    signature: 'The Shadow - you never see him until he is past',
    quote: 'Don\'t mind me.',
    taunts: { hit: ['Pardon.'], hurt: ['Tut tut.'] },
  },
  {
    id: 'okonkwo', name: 'OKONKWO', temperament: 'aggressive', skill: 0.95, weapon: 'chain',
    specialty: 'Brawler',
    blurb: 'Would rather win the fight than the race. Both are possible.',
    bio: 'Undefeated in the parking-lot league. Rides like the race is the interval between fights.',
    bike: 'Knuckles', style: 'Aggressive - fast AND angry',
    stats: { aggression: 9, pace: 10, skill: 10, dirty: 7, grudge: 6 },
    signature: 'The Hammer - grabs, drags, throws you into the rail',
    quote: 'Win the fight, win the race.',
    taunts: { hit: ['Next!', 'Too easy.'], hurt: ['Finally, a fight.'] },
  },
  {
    id: 'slater', name: 'SLATER', temperament: 'blocker', skill: 1.00, weapon: null,
    specialty: 'The wall',
    blurb: 'Fastest rider in the field and impossible to move off a line.',
    bio: 'The man everybody is chasing, and he knows it. Watches his mirrors like they owe him money.',
    bike: 'The Wall', style: 'Blocker - fastest in the field and never lets you by',
    stats: { aggression: 5, pace: 10, skill: 10, dirty: 5, grudge: 5 },
    signature: 'The Wall - every line you try, he is already on',
    quote: 'You\'re not getting past.',
    taunts: { hit: ['Wall.'], hurt: ['Nope.'] },
  },
  // --- EASTER EGG: the secret rider -----------------------------------------
  // Never in fieldFor's pool. gridFor deals him into a level-5 field with a small
  // seeded chance (or always with ?secret=1). He is a ghost of the 1991 cover
  // rider: a clean pace-setter who waves as you pass and never fights.
  {
    id: 'ghost', name: 'THE GHOST', temperament: 'clean', skill: 0.97, weapon: null,
    secret: true,
    specialty: '1991',
    blurb: 'Some say he is still out there on the Pacific Coast Highway.',
    bio: 'Nobody has seen his face. Rides an orange tank from a game box nobody remembers buying.',
    bike: '16-Bit', style: '??? - never fights, never loses',
    stats: { aggression: 0, pace: 10, skill: 10, dirty: 0, grudge: 0 },
    signature: 'Insert Coin',
    quote: '...',
    taunts: { hit: ['...'], hurt: ['...'] },
  },
];

// By id, for the results screen and for anything that wants to name a rider it
// has only seen a number for.
const BY_ID = Object.fromEntries(ROSTER.map((r) => [r.id, r]));
export function riderById(id) { return BY_ID[id] || null; }

/** How many riders the roster can supply for a race. */
// The secret row is not part of the regular field.
const REGULAR = ROSTER.filter((r) => !r.secret);
export const ROSTER_SIZE = REGULAR.length;

/**
 * The pack for one race.
 *
 * @param {object} event   a SERIES entry: { skill, aggro, field, ... }
 * @param {number} count   how many riders to send (<= ROSTER_SIZE)
 * @returns {Array} roster rows with a per-race `scaled` block attached
 *
 * Scaling is MULTIPLICATIVE on the authored numbers, so the character survives
 * it: the aggressive rider is still the aggressive one in race five, he is just
 * faster and angrier. `skill` is clamped to 0..1 because the brain's tuning
 * assumes that range; `aggro` is NOT clamped, because it is a multiplier on
 * persona weight rather than a probability, and the career's 1.35 for GRUDGE
 * MATCH is meant to bite.
 *
 * The LAST `count` riders are dropped, not the first: the career should open
 * against the metronome and the runner, not against the wall.
 */
export function fieldFor(event = {}, count = 5) {
  const n = Math.max(0, Math.min(ROSTER_SIZE, Math.floor(count)));
  // ORDERED BY AUTHORED SKILL, so "the last `count` riders are dropped, not the
  // first" actually means what the header says: a smaller field is the SLOW half
  // of the roster, and the fastest rider in the game only appears in a full
  // field. Relying on this file's row order would silently break the moment
  // somebody appended a rider, which is exactly what happened when the roster
  // grew from nine to fourteen.
  const base = [...REGULAR].sort((a, b) => a.skill - b.skill).slice(0, n);
  // Race 1 sits at ~0.82 skill / 0.70 aggro against a roster baseline of 1.0,
  // so the opening field is deliberately the slow end of the ladder.
  const skillScale = Number.isFinite(event.skill) ? event.skill : 1.0;
  const aggroScale = Number.isFinite(event.aggro) ? event.aggro : 1.0;
  return base.map((r) => ({
    ...r,
    scaled: {
      skill: Math.max(0, Math.min(1, r.skill * skillScale)),
      aggro: Math.max(0, Math.min(2.0, aggroScale)),
    },
  }));
}

/**
 * The roster's own baseline aggression. The SERIES `aggro` values (0.70 .. 1.35)
 * were authored as multipliers against an IMPLICIT baseline of 1.0, but the
 * personas they multiply were tuned BEFORE the pack learned to fight: once
 * `_inSwingReach` made rival attacks actually land (PLAYTEST.md BUG-2), the same
 * multipliers produced a pack that mauled the player off the road in race one.
 *
 * MEASURED: `_nondet` player distance fell 113 m -> 96 m, peak speed 39 -> 29.5
 * m/s, contacts 1-2 -> 4-5, and one run in four ended with the player DOWN.
 *
 * So the scale is damped and re-centred: `AGGRO_DAMP` shrinks how far the
 * multiplier moves from neutral, and `AGGRO_PIVOT` is the value that means
 * "unchanged". Race 3 (aggro 1.00) is neutral, as authored; race 1 is gentler
 * and race 5 is harder, but neither is a 35% swing on a 1.45-aggression
 * persona, which is what 0.70 and 1.35 were actually doing.
 */
const AGGRO_PIVOT = 1.0;
const AGGRO_DAMP = 0.45;

export function aggroFactorFor(event = {}) {
  const raw = Number.isFinite(event.aggro) ? event.aggro : 1.0;
  const damped = 1 + (raw - AGGRO_PIVOT) * AGGRO_DAMP;
  return Math.max(0.6, Math.min(1.5, damped));
}

// ---------------------------------------------------------------------------
// PER-RACE RANDOMNESS (user, this session: "randomness will be there such that
// each game will be different").
//
// Every draw below comes from ONE seeded PRNG, so a race is still exactly
// reproducible from its seed -- the `_nondet` contract survives, it just keys on
// a seed instead of on nothing. The SESSION seed is `?seed=N` from the URL if
// given (for debugging a specific race) or a fresh random 32-bit number per page
// load; it is published as `window.__SEED__`. Each race then takes
// `raceSeed(n) = mix(sessionSeed, n)`, so restarting gives a different race and
// reloading with the same ?seed= replays the same sequence of races.
//
// What varies, and by how much (all BEHAVIOUR, none of it machine):
//   * WHO ENTERS. The field is drawn from the `count + 2` slowest regular riders
//     rather than always being exactly the `count` slowest, so the opening race
//     is not always the same five people. Difficulty moves by at most two rungs.
//   * GRID ORDER. Shuffled.
//   * MOOD. Each rider gets a mood in -1..1: aggression x(1 + 0.22*mood), a
//     preferred-pace trim of +-2% (the machine's limit still caps it), and a
//     label for the card (FIRED UP / ON EDGE / CALM / SULKING).
//   * BRAIN SEED. Per rider per race, so mid-race decisions (lane wander, when
//     to swing, mood swings -- npc.js _moodTick) differ every race.
//   * SECRET RIDER. Level 5 only, ~15% of races (always with ?secret=1).
// ---------------------------------------------------------------------------

/** mulberry32 -- the same generator npc.js uses. */
function rng32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Mix two 32-bit ints into one (a cheap avalanche, good enough for seeds). */
export function mixSeed(a, b) {
  let h = (a >>> 0) ^ Math.imul((b >>> 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// The session seed. Read once. `?seed=` wins; otherwise crypto, then time.
let SESSION_SEED = 0;
let raceCounter = 0;
const URLQ = (() => { try { return new URLSearchParams(globalThis.location ? location.search : ''); } catch (e) { return new URLSearchParams(''); } })();
(function initSeed() {
  const q = URLQ.get('seed');
  if (q !== null && q !== '') SESSION_SEED = /^\d+$/.test(q) ? (Number(q) >>> 0) : hashStr(q);
  else {
    try { const u = new Uint32Array(1); crypto.getRandomValues(u); SESSION_SEED = u[0]; }
    catch (e) { SESSION_SEED = (Date.now() * 2654435761) >>> 0; }
  }
  try { globalThis.__SEED__ = SESSION_SEED; } catch (e) { /* no global */ }
})();
export function sessionSeed() { return SESSION_SEED; }
/** The seed the NEXT race will use, without consuming it (the title preview). */
export function peekRaceSeed() { return mixSeed(SESSION_SEED, raceCounter); }
/** Consume and return the next race seed. resetRace calls this once per race. */
export function takeRaceSeed() {
  const s = mixSeed(SESSION_SEED, raceCounter++);
  try { globalThis.__RACESEED__ = s; } catch (e) { /* no global */ }
  return s;
}

const MOODS = [
  { min: 0.45, label: 'FIRED UP' },
  { min: 0.10, label: 'ON EDGE' },
  { min: -0.35, label: 'CALM' },
  { min: -2, label: 'SULKING' },
];
function moodLabel(m) { for (const x of MOODS) if (m >= x.min) return x.label; return 'CALM'; }

/**
 * The pack for a race, resolved against a rider COUNT and a set of grid slots.
 *
 * This is the single call the game makes. It returns everything `Rival` needs
 * to be constructed, so no identity arithmetic survives at the call site -- the
 * whole point of the module.
 *
 * `opts.seed` switches on the per-race variation above. Without it the result is
 * the old fixed field in skill order (harnesses and the bare-Rival fallback).
 * `opts.field` (array of ids, or `?field=a,b,c` in the URL) forces the entrants
 * -- a debugging hook, used by the behaviour measurement script.
 */
export function gridFor(event = {}, count = 5, opts = {}) {
  const seeded = Number.isFinite(opts.seed);
  const rnd = seeded ? rng32(opts.seed) : null;
  const n = Math.max(0, Math.min(ROSTER_SIZE, Math.floor(count)));
  const forced = opts.field || (URLQ.get('field') ? URLQ.get('field').split(',') : null);

  let rows;
  if (forced && forced.length) {
    rows = forced.map((id) => BY_ID[String(id).trim().toLowerCase()]).filter(Boolean).slice(0, n);
    // top up from the slow end if the list was short
    for (const r of [...REGULAR].sort((a, b) => a.skill - b.skill)) {
      if (rows.length >= n) break;
      if (!rows.includes(r)) rows.push(r);
    }
  } else if (seeded) {
    const pool = [...REGULAR].sort((a, b) => a.skill - b.skill).slice(0, Math.min(ROSTER_SIZE, n + 2));
    // Partial Fisher-Yates: n distinct draws from the pool.
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    rows = pool.slice(0, n);
    // EASTER EGG: the Ghost, level 5 only.
    const lvl = Number.isFinite(event.level) ? event.level : 0;
    const forceSecret = URLQ.get('secret') === '1' || opts.secret === true;
    if (n > 0 && (forceSecret || (lvl >= 5 && rnd() < 0.15))) rows[n - 1] = BY_ID.ghost;
  } else {
    rows = [...REGULAR].sort((a, b) => a.skill - b.skill).slice(0, n);
  }

  // Grid order: shuffled when seeded (a full Fisher-Yates on the entrants).
  if (seeded) {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  }

  const skillScale = Number.isFinite(event.skill) ? event.skill : 1.0;
  const aggroScale = Number.isFinite(event.aggro) ? event.aggro : 1.0;
  // `paceRank` is the rider's standing WITHIN THIS FIELD, 0 (slowest) .. 1
  // (fastest), from authored skill. Rival.assignPace turns it into an absolute
  // PREFERRED speed around the level's reference pace, which the machine then
  // caps at the same limit as the player's. Computing it here rather than from
  // the grid index is what keeps "SLATER is at the front" true at every level.
  const lo = Math.min(...rows.map((r) => r.skill));
  const hi = Math.max(...rows.map((r) => r.skill));
  const span = Math.max(1e-6, hi - lo);
  return rows.map((r, i) => {
    const mood = seeded ? (rnd() * 2 - 1) : 0;
    return {
      id: r.id,
      name: r.name,
      persona: r.temperament,
      skill: Math.max(0, Math.min(1, r.skill * skillScale)),
      paceRank: (r.skill - lo) / span,
      reference: Number.isFinite(event.reference) ? event.reference : null,
      hasWeapon: r.weapon === 'chain',
      specialty: r.specialty,
      blurb: r.blurb,
      slot: i,
      scaled: { skill: Math.max(0, Math.min(1, r.skill * skillScale)), aggro: Math.max(0, Math.min(2.0, aggroScale)) },
      // PER-RACE PERSONALITY. `mood` scales aggression; `paceTrim` is a +-2%
      // trim on PREFERRED pace (npc.js caps the result at the machine limit).
      mood,
      moodLabel: moodLabel(mood),
      paceTrim: 1 + (seeded ? (rnd() - 0.5) * 0.04 : 0),
      // Deterministic per-slot seed when unseeded (the old contract); per-rider
      // per-race when seeded, so mid-race decisions differ between races.
      seed: seeded ? mixSeed(opts.seed, hashStr(r.id)) : 0x1000 + i * 977,
    };
  });
}

/**
 * Validate the roster against the personas the engine implements.
 *
 * Called once at load. A typo in `temperament` would otherwise fall back to
 * `clean` inside `NpcBrain` and the rider would simply not be who the table
 * says -- a silent failure of exactly the kind this project keeps finding.
 */
export function validateRoster(personaNames) {
  const bad = [];
  for (const r of ROSTER) {
    if (!r.id || !r.name) bad.push(`roster row missing id/name: ${JSON.stringify(r)}`);
    if (!TEMPERAMENTS.includes(r.temperament)) {
      bad.push(`${r.name}: temperament "${r.temperament}" is not one of ${TEMPERAMENTS.join(', ')}`);
    }
    if (personaNames && !personaNames.includes(r.temperament)) {
      bad.push(`${r.name}: npc.js has no PERSONAS entry for "${r.temperament}"`);
    }
    if (!(r.skill >= 0 && r.skill <= 1)) {
      bad.push(`${r.name}: skill ${r.skill} is outside 0..1`);
    }
    if (!r.specialty) bad.push(`${r.name}: no specialty`);
  }
  return bad;
}