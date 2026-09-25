// RideRash — the highway's LANE LAYOUT along each course.
//
// The road was one fixed 11 m carriageway (one lane each way plus wide
// shoulders) from start to finish on every map. Real highways -- and Road
// Rash's -- widen and narrow: a passing lane on a climb, four lanes through
// town, a lane that ends and merges, a crossroads with cars coming across.
//
// THE MODEL. The road keeps its centreline (level.js centreAt). Either side of
// it are whole lanes of LANE metres plus a SHOULDER: the player's direction is
// +lateral (the right, see traffic.js), oncoming is -lateral. A course is a
// list of STRETCHES, each giving the lane count on each side from a distance
// on; between stretches the count changes over a TAPER (a merge or a
// diverge), so the edge slides out or in along a smooth curve rather than
// stepping. Everything that needs the road's edges -- the deck, the markings,
// kerbs and rails, the physics wall, traffic lanes, the AI's limits, the radar,
// scenery clearance -- asks this module instead of reading CFG.ROAD_W.
//
// The default (one lane each way) reproduces the old road exactly: 3.6 + 1.9 =
// 5.5 m each side of the centreline = CFG.ROAD_W / 2.
//
// PER-MAP CHARACTER (distances in metres at lenMul 1, scaled with the course):
//   sierra     two-lane mountain road, one passing-lane climb
//   coastal    two lanes on the shore, four through town
//   valley     two <-> three lanes, a crossroads at each town
//   peninsula  a four-lane divided highway, lanes dropping and adding at ramps
//   desert     long four-lane stretches narrowing to two at the bridges
import { CFG } from './config.js';
import { ghatRanges } from './ghatdesign.js';

export const LANE = 3.6;
export const SHOULDER = 1.9;
export const TAPER = 160;                 // m over which a lane appears or merges away
export const MAX_LANES = 2;               // per side
export const MAX_HALF = MAX_LANES * LANE + SHOULDER;   // 9.1 m: the widest the road gets

// [s, lanesWithPlayer (+lateral), lanesOncoming (-lateral)]
const PLANS = {
  sierra: {
    stretches: [[0, 1, 1], [1500, 2, 1], [2500, 1, 1], [3600, 1, 1]],
    crossings: [3200],
  },
  coastal: {
    stretches: [[0, 1, 1], [1100, 2, 2], [2050, 1, 1], [3200, 2, 1], [3900, 1, 1], [5200, 2, 2]],
    crossings: [1500, 5500],
  },
  valley: {
    stretches: [[0, 1, 1], [900, 2, 1], [1350, 2, 2], [2150, 1, 1], [3600, 2, 1], [4500, 1, 1], [5300, 2, 2], [6100, 1, 1]],
    crossings: [1700, 5700],
  },
  peninsula: {
    stretches: [[0, 2, 2], [1500, 1, 2], [2200, 2, 2], [3300, 2, 1], [4200, 2, 2], [5600, 1, 1], [6400, 2, 2]],
    crossings: [800, 3600, 7200],
  },
  desert: {
    stretches: [[0, 1, 1], [700, 2, 2], [2400, 1, 1], [2900, 2, 2], [5200, 2, 1], [6000, 1, 1], [6600, 2, 2], [8600, 1, 1]],
    crossings: [4000, 7800],
  },
};

// The live plan (set per race in main.js __START__).
let plan = { stretches: [[0, 1, 1]], crossings: [] };
let planKey = '';

/** Choose the course's layout. Returns true when it changed (the road must be rebuilt). */
// THE GHAT (ghatdesign.js): one lane each way, except where the monsoon took
// the valley-side lane -- it narrows to a third of a lane over a short 25 m
// taper (a collapse, not a planned merge) and comes back after the break.
// Positions are the design's own metres, repeated (not scaled) with lenMul.
const BROKEN_LANE = 0.35, BROKEN_TAPER = 25;
// NARROWS: a single-track stretch, both lanes squeezed to 0.7 (traffic and the
// pack have to take turns), over a 40 m taper.
const NARROW_LANE = 0.7, NARROW_TAPER = 40;
function ghatPlan(lenMul) {
  const R = ghatRanges(6000 * lenMul + 600);
  const ev = [];
  for (const [a, b, side] of R.broken) {
    const n = side > 0 ? [BROKEN_LANE, 1] : [1, BROKEN_LANE];
    ev.push([a + BROKEN_TAPER / 2, n[0], n[1], BROKEN_TAPER], [b - BROKEN_TAPER / 2, 1, 1, BROKEN_TAPER]);
  }
  for (const [a, b] of R.narrows) ev.push([a + NARROW_TAPER / 2, NARROW_LANE, NARROW_LANE, NARROW_TAPER], [b - NARROW_TAPER / 2, 1, 1, NARROW_TAPER]);
  ev.sort((x, y) => x[0] - y[0]);
  // (a narrows that overlaps a break keeps the break's own lane counts)
  const st = [[0, 1, 1]];
  for (const e of ev) if (e[0] - st[st.length - 1][0] > 30) st.push(e);
  return { stretches: st, crossings: [] };
}

export function setLanePlan(mapId, lenMul = 1) {
  const k = (mapId || '') + ':' + lenMul;
  if (k === planKey) return false;
  planKey = k;
  if (mapId === 'ghat') plan = ghatPlan(lenMul);
  else {
    const P = PLANS[mapId] || { stretches: [[0, 1, 1]], crossings: [] };
    plan = {
      stretches: P.stretches.map(([s, r, l]) => [s * lenMul, r, l]),
      crossings: P.crossings.map((s) => s * lenMul),
    };
  }
  plan.medians = buildMedians(plan);
  return true;
}
export function lanePlanKey() { return planKey; }

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Lanes on each side at distance s, FRACTIONAL inside a taper (1.4 = a second
 * lane 40% opened). The change is centred on the stretch's start.
 */
export function lanesAt(s, out = { r: 1, l: 1 }) {
  // the first stretch's counts plus every later change, each eased in over
  // its own taper -- continuous everywhere, exact between tapers
  const S = plan.stretches;
  let r = S[0][1], l = S[0][2];
  for (let i = 1; i < S.length; i++) {
    const tp = S[i][3] || TAPER;
    const k = ease((s - (S[i][0] - tp / 2)) / tp);
    if (k <= 0) break;
    r += (S[i][1] - S[i - 1][1]) * k;
    l += (S[i][2] - S[i - 1][2]) * k;
  }
  out.r = r; out.l = l;
  return out;
}

const _L = { r: 1, l: 1 };
/** Distance from the centreline to the tarmac edge on `side` (+1 right / with the player, -1 oncoming). */
export function edgeAt(s, side) {
  lanesAt(s, _L);
  return (side >= 0 ? _L.r : _L.l) * LANE + SHOULDER;
}
/** The half-width a symmetric test would use: the nearer edge. */
export function halfAt(s) { return Math.min(edgeAt(s, 1), edgeAt(s, -1)); }

/**
 * The centre of lane `i` (0 = next to the centreline) on `side`, or null if
 * that lane is not open at s. A lane that is merging away (fraction < 1) still
 * returns its centre, so a car in it can see it closing.
 */
export function laneCentre(s, side, i) {
  lanesAt(s, _L);
  const n = side >= 0 ? _L.r : _L.l;
  if (i > Math.ceil(n - 1e-3) - 1) return null;
  return side * (i * LANE + LANE * 0.5 + 0.35);
}
/** Whole lanes open on a side at s (a lane counts once it is more than half open). */
export function openLanes(s, side) {
  lanesAt(s, _L);
  return Math.max(1, Math.round(side >= 0 ? _L.r : _L.l));
}
/** How open the outer lane on `side` is at s: 1 = fully, 0 = gone. Used to steer merges. */
export function outerLaneOpen(s, side) {
  lanesAt(s, _L);
  const n = side >= 0 ? _L.r : _L.l;
  return n - Math.floor(n) || (n >= 2 ? 1 : 0);
}

/** Lane changes along the course, for signage: [{s, side, kind: 'ends'|'adds'}]. */
export function laneEvents() {
  const S = plan.stretches, out = [];
  for (let i = 1; i < S.length; i++) {
    for (const [side, k] of [[1, 1], [-1, 2]]) {
      const d = S[i][k] - S[i - 1][k];
      if (d) out.push({ s: S[i][0], side, kind: d < 0 ? 'ends' : 'adds' });
    }
  }
  return out;
}

// ---- MEDIANS ----------------------------------------------------------------
// Road Rash's roads had BRIEF divided sections. A raised concrete divider
// runs down the middle of each four-lane stretch -- its middle 60%, at least
// 300 m of it -- with a gap either side of any crossroads. Where the divider
// stands, nobody (rider, traffic, AI) crosses the centreline.
export const MEDIAN_HALF = 0.45;          // half-width of the barrier itself
function buildMedians(P) {
  const out = [];
  const S = P.stretches;
  for (let i = 0; i < S.length; i++) {
    if (S[i][1] < 2 || S[i][2] < 2) continue;
    const a = S[i][0] + TAPER, b = (i + 1 < S.length ? S[i + 1][0] : a + 3000) - TAPER;
    const len = b - a;
    if (len < 300) continue;
    const pad = len * 0.2;
    let segs = [[a + pad, b - pad]];
    for (const c of P.crossings) {
      segs = segs.flatMap(([x, y]) => (c + 40 < x || c - 40 > y ? [[x, y]] : [[x, c - 40], [c + 40, y]].filter(([u, v]) => v - u > 60)));
    }
    out.push(...segs);
  }
  return out;
}
/** Is there a median at s? */
export function medianAt(s) {
  const M = plan.medians || [];
  for (const [a, b] of M) if (s >= a && s <= b) return true;
  return false;
}
/** The median runs (for building the barrier and its end markers). */
export function medians() { return plan.medians || []; }

/** Crossroads along the course (distances). */
export function crossings() { return plan.crossings; }
export const CROSS_HALF = 5.5;            // half-width of the cross road's deck (along s)
/** The crossing within `range` of s, or null. */
export function crossingNear(s, range = CROSS_HALF) {
  for (const c of plan.crossings) if (Math.abs(s - c) <= range) return c;
  return null;
}

// sanity: the default must be the old road
if (Math.abs(LANE + SHOULDER - CFG.ROAD_W / 2) > 1e-6) {
  console.warn('[lanes] the one-lane edge no longer matches CFG.ROAD_W / 2');
}
