// RideRash — THE GHAT ROAD, GENERATED. (No three.js: lanes.js, level.js,
// physics.js, scenery.js and ghat.js all read it.)
//
// A Western Ghats road is not one long cliff with the drop always on the same
// side. It clings to one flank, dives through a rock cutting or a tunnel and
// comes out on the other; it crosses gorges on narrow bridges; it coils down a
// face in tight SWIRLS; the monsoon takes a bite out of the valley-side lane
// and the repair crews leave a line of barrels and a strip of concrete.
//
// PROCEDURAL, the way the classic segment racers build their roads (Jake
// Gordon's javascript-racer `addRoad(enter, hold, leave, curve)` composed by
// helpers like `addSCurves`; Lou's Pseudo 3D page): a small GRAMMAR of pieces,
// each a helper that appends bends and tags to the road, chosen by a seeded
// random walk under constraints:
//
//   flank    := (sweepers | swirl)+ , with a broken lane / narrows / slabs dropped in
//   crossover:= cut | tunnel | bridge        -- the drop swaps (or not) across it
//   course   := grid-straight , (flank , crossover)* , run-out
//
// Every piece's bends sum to zero turn, so the road leaves each piece heading
// straight down the valley (x cannot fold back: level.js draws x(z)); headings
// stay under ~42 deg. A bend changes the slope dx/ds by `turn` over `len`
// metres with a raised-cosine curvature profile (the curve eases in and out,
// as addRoad's enter/leave do), and the centreline is baked to a 1 m table with
// slopes, read back by Hermite interpolation -- smooth, and O(1) per lookup.
//
// The seed is the course and its level (setGhatDesign), so each career level
// runs a different ghat, and the same one every time you race it.

const TAU = Math.PI * 2;
export const GHAT_LEN = 13500;               // longest course (5800 m x 2.05) plus run-out

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ---- the generator ---------------------------------------------------------------
export function generateGhat(seed, length = GHAT_LEN) {
  const r = prng(seed);
  const rr = (a, b) => a + r() * (b - a);
  const D = { sections: [], bends: [], broken: [], slabs: [], narrows: [] };
  let s = 0, side = 1, flankStart = 0;
  const bend = (len, turn) => { D.bends.push([s + len / 2, len, turn]); s += len; };
  const straight = (len) => { s += len; };
  const closeFlank = () => { if (s > flankStart) D.sections.push([flankStart, s, side, 'road']); };

  // PIECES (each leaves the heading where it found it)
  const sweepers = () => {
    const n = 2 + Math.floor(r() * 3), t = rr(0.3, 0.55) * (r() < 0.5 ? 1 : -1);
    const L = () => rr(130, 210);
    const s0 = s;
    bend(L() * 0.7, t);
    for (let i = 0; i < n; i++) { straight(rr(10, 60)); bend(L(), (i % 2 ? 2 : -2) * t); }
    bend(L() * 0.7, n % 2 ? t : -t);
    return [s0, s];
  };
  const swirl = () => {
    // n middle coils of `T`, half-bends at each end: + , -T, +T, ... , +/-
    const n = 3 + Math.floor(r() * 3), T = rr(1.45, 1.8) * (r() < 0.5 ? 1 : -1);
    const s0 = s;
    bend(rr(65, 80), T / 2);
    for (let i = 0; i < n; i++) bend(rr(100, 125), (i % 2 ? 1 : -1) * T);
    bend(rr(65, 80), n % 2 ? T / 2 : -T / 2);
    return [s0, s];
  };
  let nCross = 0;
  const crossover = () => {
    closeFlank();
    // every course gets its tunnel and its bridge early; after that, the dice
    const k = nCross === 0 ? 0.5 : nCross === 1 ? 0.9 : r();
    nCross++;
    if (k < 0.34) {                                       // a rock cutting
      const len = rr(90, 140);
      D.sections.push([s, s + len, 0, 'cut']); straight(len);
      side = r() < 0.75 ? -side : side;
    } else if (k < 0.67) {                                // a tunnel, cut in at each end
      const a = rr(15, 25), len = rr(80, 150), b = rr(15, 25);
      D.sections.push([s, s + a, 0, 'cut']); straight(a);
      D.sections.push([s, s + len, 0, 'tunnel']); straight(len);
      D.sections.push([s, s + b, 0, 'cut']); straight(b);
      side = -side;
    } else {                                              // a bridge over a gorge
      const len = rr(130, 190);
      D.sections.push([s, s + len, 2, 'bridge']); straight(len);
      side = r() < 0.5 ? -side : side;
    }
    flankStart = s;
  };

  // THE COURSE
  straight(260);                                          // the grid
  while (s < length) {
    // a flank: 1-3 pieces, never two swirls running (you need somewhere to pass)
    const pieces = r() < 0.4 ? 2 : 1;
    let last = '';
    for (let i = 0; i < pieces && s < length; i++) {
      const kind = last === 'swirl' || r() < 0.45 ? 'sweepers' : 'swirl';
      const [a, b] = kind === 'swirl' ? swirl() : sweepers();
      last = kind;
      // the monsoon's damage lands on the valley side, mostly in the sweepers
      if (kind === 'sweepers' && r() < 0.55) {
        const len = rr(55, 85), at = rr(a + 40, Math.max(a + 41, b - len - 40));
        D.broken.push([at, at + len, side]);
      } else if (kind === 'sweepers' && r() < 0.35) {
        const len = rr(140, 240), at = rr(a, Math.max(a + 1, b - len));
        D.narrows.push([at, at + len]);                  // single-track: both lanes squeezed
      }
      if (r() < 0.35) { const len = rr(160, 320), at = rr(a, Math.max(a + 1, b - len)); D.slabs.push([at, at + len]); }
      if (r() < 0.5) straight(rr(40, 160));
    }
    crossover();
  }
  closeFlank();
  D.sections.push([s, s + 1e6, side, 'road']);            // run-out past the end
  D.bends.sort((a, b) => a[0] - b[0]);
  return D;
}

// ---- the live design, baked ---------------------------------------------------------
let DES = null, XT = null, DT = null, KEY = '';
function bake(D) {
  // x and dx/ds at every metre, by summing each bend's closed form
  const N = GHAT_LEN + 400;
  XT = new Float64Array(N + 1); DT = new Float64Array(N + 1);
  for (const [c, L, turn] of D.bends) {
    const a = c - L / 2;
    for (let i = Math.max(0, Math.floor(a)); i <= N; i++) {
      const t = (i - a) / L;
      if (t <= 0) continue;
      if (t >= 1) { XT[i] += turn * (L * 0.5 + (i - (c + L / 2))); DT[i] += turn; continue; }
      XT[i] += turn * L * (t * t / 2 + (Math.cos(TAU * t) - 1) / (2 * TAU * Math.PI));
      DT[i] += turn * (t - Math.sin(TAU * t) / TAU);
    }
  }
}
/** Pick the course's ghat: `key` seeds it (map id + level). Returns true if it changed. */
export function setGhatDesign(key = 'ghat') {
  if (key === KEY && DES) return false;
  KEY = key;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  DES = generateGhat(h >>> 0);
  bake(DES);
  return true;
}
export function ghatDesign() { if (!DES) setGhatDesign(); return DES; }

/** Lateral position of the centreline (world x, before the z flip) at s. Hermite on the 1 m table. */
export function ghatX(s) {
  if (!XT) setGhatDesign();
  if (s <= 0) return 0;
  const N = XT.length - 1;
  if (s >= N) return XT[N] + DT[N] * (s - N);
  const i = Math.floor(s), t = s - i;
  const p0 = XT[i], p1 = XT[i + 1], m0 = DT[i], m1 = DT[i + 1];
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
}
/** Height of the deck at s: a long climb and descent, plus a ripple. */
export const GHAT_Y_AMP = 26;
/** The valley floor, one absolute height for the whole course: 110-165 m under the deck. */
export const GHAT_FLOOR = -GHAT_Y_AMP - 2 - 110;
export function ghatY(s) {
  return -GHAT_Y_AMP * Math.cos(TAU * s / 5800) + 2 * Math.sin(s * 0.011);
}

// ---- lookups ------------------------------------------------------------------------
/** The section at s: [s0, s1, side, kind]. */
export function ghatSection(s) {
  const S = ghatDesign().sections;
  if (s <= 0) return S[0];
  let lo = 0, hi = S.length - 1;                          // binary search: sections are contiguous
  while (lo < hi) { const m = (lo + hi) >> 1; if (S[m][1] <= s) lo = m + 1; else hi = m; }
  return S[lo];
}
/** Does the rider's `sgn` side (+1 right / -1 left) drop away at s? */
export function ghatDropAt(s, sgn) {
  const sd = ghatSection(s)[2];
  return sd === 2 || sd === sgn;
}
/** 0..1 how much the `sgn` side is a drop (1) rather than rock (0), eased ~25 m either side of a change. */
export function ghatDropK(s, sgn) {
  let k = 0;
  for (let i = -2; i <= 2; i++) k += ghatDropAt(s + i * 12, sgn) ? 1 : 0;
  return k / 5;
}
/** The broken stretch covering s on `sgn` side (any side if omitted), or null. */
export function ghatBrokenAt(s, sgn) {
  for (const b of ghatDesign().broken) if (s >= b[0] && s <= b[1] && (sgn === undefined || b[2] === sgn)) return b;
  return null;
}
/** Every section / broken / slab / narrows range that starts before `len`. */
export function ghatRanges(len) {
  const D = ghatDesign(), f = (a) => a.filter((x) => x[0] < len);
  return { sections: f(D.sections), broken: f(D.broken), slabs: f(D.slabs), narrows: f(D.narrows) };
}
