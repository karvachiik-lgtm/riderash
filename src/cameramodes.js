// RideRash — camera modes, as DATA.
//
// Extracted from main.js so that adding a view is adding a row to a table
// rather than editing the frame loop. Every field is a MULTIPLIER on the tuned
// chase values, not an absolute, so re-tuning the chase camera re-tunes every
// view with it and they cannot drift apart.
//
//   back / up   multiply CFG.CAM_BACK / CFG.CAM_UP
//   upAdd       metres added after the multiply
//   look        multiplies the look-ahead distance
//   lookY       multiplies the look height; lookYAdd offsets it
//   minBack     floor on the lag-compensated offset (see updateCamera)
//   lag         scales how much lag compensation this view gets
//   side        constant sideways offset, in metres
//   drone       the view swings sideways with the steering
//   hideRider / hideBike   hide what the camera is looking out of
//
// CHASE is index 0 and is exactly what the critic rounds measured: the hero at
// 0.357 of frame height against a reference bar of 0.34. **Do not retune CHASE
// to suit another mode** -- add a row instead.
//
// harness/_cams.mjs measures every entry: separation, height above the rider,
// whether it faces the rider, and the hero's projected size. It is how BARS and
// BUMPER were caught sitting INSIDE the rider, with projected hero heights of
// 4.4 and 135 screen heights -- the near faces of the model filling the view.
export const CAM_MODES = [
  { name: 'CHASE',     back: 1.00, up: 1.00, upAdd: 0.0,  look: 1.00, lookY: 1.00, minBack: 1.4 },
  // MEASURED with harness/_cams.mjs: at back 0.06 and -0.34 these sat INSIDE the
  // rider -- the hero's projected height came back as 4.4 and 135 screen
  // heights, i.e. the near faces of the model filling the view. A first-person
  // camera has to be ahead of the body it belongs to, and the body it is
  // looking out of has to be hidden, or you are looking at the inside of a
  // jacket. `hideRider`/`hideBike` do the second half.
  { name: 'BARS',      back: -0.30, up: 0.62, upAdd: 0.52, look: 1.35, lookY: 1.05, minBack: -0.60, lag: 0.25, hideRider: true },
  { name: 'BUMPER',    back: -1.05, up: 0.26, upAdd: 0.16, look: 1.45, lookY: 0.95, minBack: -1.6, lag: 0.20, hideRider: true, hideBike: true },
  { name: 'HIGH',      back: 1.45, up: 2.10, upAdd: 1.4,  look: 0.95, lookY: 0.75, minBack: 3.0 },
  { name: 'FAR',       back: 2.60, up: 1.45, upAdd: 0.6,  look: 0.85, lookY: 0.95, minBack: 7.0 },
  { name: 'DRONE',     back: 1.80, up: 1.90, upAdd: 1.0,  look: 1.10, lookY: 0.85, minBack: 4.0, drone: true },
  { name: 'NOSE',      back: -1.15, up: 0.55, upAdd: 0.30, look: -0.30, lookY: 1.15, minBack: -4.0, lag: 0.15 },
];

