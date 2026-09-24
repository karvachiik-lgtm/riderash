// RideRash — the world spine.
//
// THE IDEA. Everything visual in this game was a constant chosen at load: one
// road surface, one sky, one set of scenery, one fog colour. The bike could be
// anywhere on a 7 km road and the frame looked identical, which is why tuning it
// felt like whack-a-mole — I was chasing a single set of values that had to be
// right for every metre of track at once.
//
// This module makes the world a FUNCTION OF DISTANCE. Ask it where the rider is
// and it answers with a biome, a sector, a weather level and a time of day, all
// smoothly interpolated. Nothing new is drawn: the same seven Atlas textures and
// one set of scenery get LERPED through different states, and the track acquires
// variety it never had.
//
// Two axes, deliberately separate:
//
//   - MAP      chosen before the race. Three of them, visually distinct.
//   - SECTOR   position along the chosen map. Each sector has a biome, and the
//              biome drives surface tint, roughness, verge colour, scenery mix,
//              fog and time of day.
//
// Transitions ease over TRANSITION metres so nothing ever cuts.

import * as THREE from 'three';
import { CFG } from './config.js';

export const TRANSITION = 170;   // metres of blend between sectors

// ---------------------------------------------------------------------------
// VERGE TINTS WERE PUSHED TO CHASE A BROKEN MEASUREMENT. Read this before
// raising them again.
//
// These were `0xb8862a`, `0xc58e1e`, `0xd45a18` and friends -- near-pure hues,
// far outside the style lock's "desaturated, slightly dirty" palette. They got
// there because the frame's high-saturation metric sat at 0.3% against a bar of
// 19% and would not move however hard the tints were pushed. The reason it would
// not move was HANDOFF 5.9: a backdrop plane was covering the road and the verge,
// so the surface carrying the tint was not on screen at all.
//
// With the road visible the same tints measured 28.5% -- past the bar in the
// other direction -- and read as a slab of mustard from the kerb to the hills.
// They are now darkened by roughly a quarter of their value while keeping their
// hue, because the defect in frame was as much VALUE as chroma: the verge was
// blowing out under a low sun at p98 246 with 2.3% of pixels over 245.
//
// The honest trade: this will pull the saturation metric back down, and the bar
// is 19%. Hitting that number with one enormous mustard field is the wrong way
// to hit it -- the reference frames get their chroma from a whole scene, sky,
// sea, foliage and bike liveries. Spend the remaining gap on those, not here.
//
// ROAD METALNESS WAS ALSO TOO HIGH. The wet smear toward the sun is a feature --
// critic round 2 named a matte road as the single biggest remaining defect -- but
// a metalness of 0.24 on a surface whose roughness map runs down to 0.43 turned
// the sun's reflection into a blown white blob across a third of the carriageway
// (2.35% of pixels over 245, against a bar of 1.1%). Metalness is cut by ~40%
// across every biome: the smear survives, the clipping does not. Tarmac is a
// dielectric anyway; the gloss should come from roughness, not from metal.
//
// Biome definitions. These are the vocabulary the maps are written in.
// Each one is a set of SURFACE STATES, not new assets: the same wet-asphalt and
// dry-scrub maps, driven to different values.
// ---------------------------------------------------------------------------
export const BIOMES = {
  coast: {
    label: 'coast',
    roadTint: 0x24262a, roadRough: 0.60, roadMetal: 0.0,
    vergeTint: 0x8a6f2e, vergeRough: 0.94,        // dry golden scrub, DARKENED (see note)
    fog: 0x7fa8cc, fogDensity: 0.00030,
    haze: 0.44, timeOfDay: 0.55,
    scenery: { town: 0.22, trees: 0.35, rocks: 0.10, hoardings: 0.18 },
  },
  scrub: {
    label: 'scrubland',
    roadTint: 0x22242a, roadRough: 0.68, roadMetal: 0.0,
    vergeTint: 0x9a7a2c, vergeRough: 0.97,        // paler, dustier
    fog: 0xc9a878, fogDensity: 0.00042,
    haze: 0.55, timeOfDay: 0.68,
    scenery: { town: 0.10, trees: 0.22, rocks: 0.34, hoardings: 0.26 },
  },
  forest: {
    label: 'forest',
    roadTint: 0x1e2026, roadRough: 0.56, roadMetal: 0.0,
    vergeTint: 0x3a5a28, vergeRough: 0.96,        // green, damp shade
    fog: 0x74a882, fogDensity: 0.00052,
    haze: 0.40, timeOfDay: 0.44,
    scenery: { town: 0.06, trees: 0.92, rocks: 0.12, hoardings: 0.08 },
  },
  town: {
    label: 'outskirts',
    roadTint: 0x202228, roadRough: 0.52, roadMetal: 0.0,
    vergeTint: 0x5a6070, vergeRough: 0.92,        // kerbed, paved, grey
    fog: 0x9aa0c0, fogDensity: 0.00038,
    haze: 0.50, timeOfDay: 0.72,
    scenery: { town: 0.95, trees: 0.10, rocks: 0.04, hoardings: 0.55 },
  },
  canyon: {
    label: 'canyon',
    roadTint: 0x272320, roadRough: 0.72, roadMetal: 0.0,
    vergeTint: 0xa8542a, vergeRough: 0.95,        // red rock, bleached
    fog: 0xd49a68, fogDensity: 0.00046,
    haze: 0.60, timeOfDay: 0.50,
    scenery: { town: 0.08, trees: 0.12, rocks: 0.96, hoardings: 0.12 },
  },
  night: {
    label: 'night',
    roadTint: 0x16171b, roadRough: 0.44, roadMetal: 0.0,
    vergeTint: 0x24386e, vergeRough: 0.90,
    fog: 0x2a4a7a, fogDensity: 0.00056,
    haze: 0.30, timeOfDay: 0.97,
    scenery: { town: 0.72, trees: 0.08, rocks: 0.06, hoardings: 0.62 },
  },

  // -------------------------------------------------------------------------
  // THE FIVE-TRACK PALETTE (user, this session). Road Rash used a SATURATED BUT
  // NARROW palette per locale, and only the desert was yellow-brown. The
  // mustard-verge defect in 5.40's note was the world using ONE dry-gold verge
  // everywhere; these three vocabularies give the non-desert tracks GREEN.
  //
  // `sierra` is the short green opener (pine, granite, blue sky).
  // `valley` is warm golden-GREEN vineyard — green first, gold as the accent,
  //   so it does not read as another desert.
  // `desert` is the ONE genuinely yellow-brown place, and it is allowed to be
  //   hot because the game has earned it by putting green on the other four.
  // -------------------------------------------------------------------------
  sierra: {
    label: 'sierra',
    roadTint: 0x232528, roadRough: 0.58, roadMetal: 0.0,
    vergeTint: 0x4a6b34, vergeRough: 0.96,        // GREEN grass, alive
    fog: 0x86aac8, fogDensity: 0.00036,
    haze: 0.34, timeOfDay: 0.42,
    scenery: { town: 0.05, trees: 0.84, rocks: 0.28, hoardings: 0.06 },
  },
  valley: {
    label: 'valley',
    roadTint: 0x24242a, roadRough: 0.62, roadMetal: 0.0,
    vergeTint: 0x6f7a2e, vergeRough: 0.95,        // vine green with a gold cast
    fog: 0xa8b478, fogDensity: 0.00034,
    haze: 0.42, timeOfDay: 0.60,
    scenery: { town: 0.14, trees: 0.46, rocks: 0.08, hoardings: 0.30 },
  },
  desert: {
    label: 'desert',
    roadTint: 0x282420, roadRough: 0.74, roadMetal: 0.0,
    vergeTint: 0xb08a38, vergeRough: 0.97,        // the ONE yellow-brown place
    fog: 0xd8ae74, fogDensity: 0.00048,
    haze: 0.62, timeOfDay: 0.52,
    scenery: { town: 0.06, trees: 0.08, rocks: 0.72, hoardings: 0.20 },
  },
};

// ---------------------------------------------------------------------------
// The three maps. Each is a list of sectors: [biome, length in metres].
// The lists are deliberately shaped so the DRIVE has a rhythm — a long opening
// you can learn, a compressed middle that keeps changing, a hard final act.
//
// LENGTH: these were ~5000 m, which is ~94 s of held throttle at the measured
// sustained 53 m/s (PLAYTEST.md OPEN-2). Road Rash races are short enough to
// retry immediately, and a 94 s opener makes the whole five-race career a
// grind. Scaled to ~62% (~3100 m, ~58 s) with the authored proportions and the
// biome ORDER untouched -- the rhythm is the design, the raw length was not.
// Every metre here is also geometry, so this cuts sector streaming cost too.
// ---------------------------------------------------------------------------
export const MAPS = {
  sierra: {
    label: 'SIERRA NEVADA',
    blurb: 'the short opener',
    sky: { day: 0.10, dusk: 0.40 },   // clean high-country daylight
    // ~90 s at the measured 53 m/s. The track you learn first.
    sectors: [
      ['sierra', 900],
      ['forest', 1100],
      ['sierra', 1300],
      ['town', 700],
      ['sierra', 800],
    ],
  },
  coastal: {
    label: 'PACIFIC COAST',
    blurb: 'trace the shore',
    sky: { day: 0.05, dusk: 0.58 },   // blue-grey marine light
    // ~2 min.
    sectors: [
      ['coast', 1200],
      ['town', 800],
      ['forest', 1000],
      ['coast', 1500],
      ['night', 900],
      ['coast', 1000],
    ],
  },
  valley: {
    label: 'NAPA VALLEY',
    blurb: 'golden rows and headwinds',
    sky: { day: 0.25, dusk: 0.72 },   // warm, low, hazy
    // ~2:15.
    sectors: [
      ['valley', 1400],
      ['town', 700],
      ['valley', 1800],
      ['forest', 900],
      ['valley', 1600],
      ['scrub', 600],
    ],
  },
  peninsula: {
    label: 'PENINSULA',
    blurb: 'no sleep, no limits',
    sky: { day: 0.70, dusk: 0.95 },   // urban, late, lit
    // ~2:30.
    sectors: [
      ['town', 1600],
      ['night', 1400],
      ['town', 1300],
      ['forest', 800],
      ['night', 1900],
      ['town', 1000],
    ],
  },
  desert: {
    label: 'PALM DESERT',
    blurb: 'the long, hot one',
    sky: { day: 0.30, dusk: 0.80 },   // bleached, late
    // ~3 min. The longest, and the only yellow-brown track in the game.
    sectors: [
      ['desert', 1800],
      ['canyon', 1700],
      ['desert', 2100],
      ['scrub', 1200],
      ['canyon', 1500],
      ['desert', 1700],
    ],
  },
};

// Length is part of the difficulty curve, exactly as in the original: the short
// opener is L1's track, the three-minute desert is the last thing you face.
export const MAP_ORDER = ['sierra', 'coastal', 'valley', 'peninsula', 'desert'];

// ---------------------------------------------------------------------------
// WorldSpine
// ---------------------------------------------------------------------------
export class WorldSpine {
  constructor(mapId = 'coastal') {
    this.setMap(mapId);
  }

  /**
   * Choose a map. `lenMul` stretches every sector, which is how higher LEVELS
   * run the same five courses LONGER: the track you learned in L1 keeps going
   * past where it used to end. Sector PROPORTIONS and biome order are untouched,
   * so a lengthened course is the same course, not a different one.
   */
  setMap(mapId, lenMul = 1) {
    this.mapId = MAPS[mapId] ? mapId : 'sierra';
    this.map = MAPS[this.mapId];
    this.lenMul = lenMul;
    this._buildStops();
    // weathering: 0 = dry, 1 = full rain. The front arrives in the last third.
    this.weather = 0;
    this.wetness = 0;        // lags weather: the road dries after the rain stops
    this._t = 0;
    return this;
  }

  // Precompute each sector's start distance and its blended stop list.
  _buildStops() {
    let s = 0;
    this.bounds = [];
    for (const [biome, len] of this.map.sectors) {
      const L = len * (this.lenMul || 1);
      this.bounds.push({ biome, start: s, end: s + L });
      s += L;
    }
    this.length = s;
  }

  get totalLength() { return this.length; }

  // Which map sector contains this distance.
  sectorAt(s) {
    const b = this.bounds;
    for (let i = 0; i < b.length; i++) {
      if (s < b[i].end || i === b.length - 1) return i;
    }
    return b.length - 1;
  }

  // -------------------------------------------------------------------
  // The core: a fully interpolated world state at distance `s`.
  // Everything downstream — road material, verge, fog, sky, scenery density —
  // reads from here, so there is exactly ONE place that decides what the world
  // looks like at any point on the track.
  // -------------------------------------------------------------------
  stateAt(s, dt = 0) {
    const b = this.bounds;
    const i = this.sectorAt(s);
    const cur = BIOMES[b[i].biome];

    // --- blend with the neighbouring biomes inside the transition window ---
    // A sector that ENDS soon blends forward into the next; a sector that
    // recently BEGAN blends back into the previous. This is what makes entering
    // a forest from open scrub feel like arriving rather than switching.
    let prevB = cur, nextB = cur, wPrev = 0, wNext = 0;
    const toEnd = b[i].end - s;
    const fromStart = s - b[i].start;
    if (toEnd < TRANSITION && i + 1 < b.length) {
      wNext = 1 - (toEnd / TRANSITION);
      nextB = BIOMES[b[i + 1].biome];
    } else if (fromStart < TRANSITION && i > 0) {
      wPrev = 1 - (fromStart / TRANSITION);
      prevB = BIOMES[b[i - 1].biome];
    }
    // ease so the middle of a transition is where the change is fastest
    const ease = (x) => x * x * (3 - 2 * x);
    wNext = ease(wNext); wPrev = ease(wPrev);

    const mix3 = (a, bb, c, wa, wc) => {
      // weighted 3-way on scalars
      const base = 1 - wa - wc;
      return a * base + bb * wa + c * wc;
    };
    const mixCol = (a, bb, c, wa, wc) => {
      const col = new THREE.Color(a).multiplyScalar(1 - wa - wc)
        .add(new THREE.Color(bb).multiplyScalar(wa))
        .add(new THREE.Color(c).multiplyScalar(wc));
      return col;
    };

    // The scenery mix blends too, so a treeline thins out over 170 m rather
    // than stopping at a line.
    const sc = {};
    for (const k of ['town', 'trees', 'rocks', 'hoardings']) {
      sc[k] = mix3(cur.scenery[k], prevB.scenery[k], nextB.scenery[k], wPrev, wNext);
    }

    // WITHIN-SECTOR DRIFT. Even a "constant" biome should not be literally
// constant: a 1400 m canyon at one roughness reads as a still image once the
// rider is inside it. Three slow independent oscillations nudge the surface,
// the fog and the light, at wavelengths far longer than a transition, so the
// world keeps breathing without ever contradicting the biome it is in.
    // The frequencies are chosen to be mutually irrational-ish so the pattern
    // does not visibly repeat over a 5 km race.
    const ph = s * 0.0017, ph2 = s * 0.00071, ph3 = s * 0.00023;
    const driftRough = Math.sin(ph) * 0.045;
    const driftTod = Math.sin(ph2 + 1.3) * 0.075;
    const driftFog = Math.sin(ph3 + 0.7) * 0.11;      // multiplier, not a delta
    const driftTint = Math.sin(ph2 * 1.7 + 2.1) * 0.030;
    const driftScenery = Math.sin(ph + 0.9) * 0.10;

    const st = {
      sector: i,
      sectorCount: b.length,
      biome: cur.label,
      biomes: [prevB.label, cur.label, nextB.label],
      blend: { prev: wPrev, next: wNext },
      roadTint: mixCol(cur.roadTint, prevB.roadTint, nextB.roadTint, wPrev, wNext),
      roadRough: mix3(cur.roadRough, prevB.roadRough, nextB.roadRough, wPrev, wNext),
      roadMetal: mix3(cur.roadMetal, prevB.roadMetal, nextB.roadMetal, wPrev, wNext),
      vergeTint: mixCol(cur.vergeTint, prevB.vergeTint, nextB.vergeTint, wPrev, wNext),
      vergeRough: mix3(cur.vergeRough, prevB.vergeRough, nextB.vergeRough, wPrev, wNext),
      fog: mixCol(cur.fog, prevB.fog, nextB.fog, wPrev, wNext),
      fogDensity: mix3(cur.fogDensity, prevB.fogDensity, nextB.fogDensity, wPrev, wNext),
      haze: mix3(cur.haze, prevB.haze, nextB.haze, wPrev, wNext),
      timeOfDay: mix3(cur.timeOfDay, prevB.timeOfDay, nextB.timeOfDay, wPrev, wNext),
      scenery: sc,
      weather: this.weather,
      wetness: this.wetness,
    };

    // apply the drift
    st.roadRough = THREE.MathUtils.clamp(st.roadRough + driftRough, 0.16, 0.92);
    st.roadTint = st.roadTint.clone().offsetHSL(0, 0, driftTint);
    st.timeOfDay = THREE.MathUtils.clamp(st.timeOfDay + driftTod, 0, 1);
    st.fogDensity *= (1 + driftFog);
    for (const k of ['town', 'trees', 'rocks', 'hoardings']) {
      st.scenery[k] = THREE.MathUtils.clamp(st.scenery[k] * (1 + driftScenery), 0, 1);
    }

    // Wet changes the road: glossier, darker, and the fog thickens. This is the
    // only place weather touches the surface.
    if (this.wetness > 0) {
      const w = this.wetness;
      // Water is a DIELECTRIC film. Wet tarmac gets its gloss from a lower
      // roughness, never from metalness: the old lerp toward metal 0.55 made
      // the road a tinted mirror, and a low sun down the road blew a third of
      // the frame to white while the storm sky above it went black.
      st.roadRough = THREE.MathUtils.lerp(st.roadRough, 0.30, w * 0.85);
      st.roadTint = st.roadTint.clone().multiplyScalar(1 - w * 0.30);
      st.fogDensity *= (1 + w * 0.55);
      st.haze = THREE.MathUtils.lerp(st.haze, 0.92, w);
      st.timeOfDay = THREE.MathUtils.lerp(st.timeOfDay, 0.88, w * 0.5);
    }
    return st;
  }

  // -------------------------------------------------------------------
  // Advance the weather. A front arrives over the final third of the race and
  // the road stays wet afterwards for a while, then dries.
  // -------------------------------------------------------------------
  update(dt, s) {
    const frac = THREE.MathUtils.clamp(s / this.length, 0, 1);
    // the front builds from 0.62 to 0.80, holds, then eases toward the flag
    let target = 0;
    if (frac > 0.62) target = Math.min(1, (frac - 0.62) / 0.20);
    if (frac > 0.90) target *= 1 - (frac - 0.90) * 3.0;   // clears near the line
    target = THREE.MathUtils.clamp(target, 0, 1);
    // ease in/out so the front rolls rather than snaps
    target = target * target * (3 - 2 * target);

    this._t += dt;
    // weather rolls in over ~4 s, which at racing speed is a few hundred metres
    this.weather += (target - this.weather) * Math.min(1, dt * 0.28);
    // the road SOAKS and DRIES more slowly than the sky changes — wetness lags
    // weather in both directions, which is what makes the surface feel real
    const lag = this.weather > this.wetness ? 0.55 : 0.14;
    this.wetness += (this.weather - this.wetness) * Math.min(1, dt * lag);
    return this.weather;
  }

  // Progress through the race, for the HUD.
  progress(s) { return THREE.MathUtils.clamp(s / this.length, 0, 1); }
}