// RideRash -- traffic avoidance for riders that are not the player.
//
// PURE: no imports, plain numbers in and out, so npc.js (whose brains must not
// hold scene objects) and cops.js can both use it.
//
// Given the vehicles near a rider ({s, at, halfL, halfW, vs} with vs the
// vehicle's velocity along +s), find the one the rider will hit soonest if it
// holds its line, and return a lateral to steer to and whether to brake.
//
//   look   -- seconds of anticipation. A rider only reacts to a vehicle whose
//             time-to-contact is inside this. npc.js scales it with skill
//             (0.9 s for a backmarker, 2.3 s for the best), so the weakest
//             riders still plough into the back of a bus now and then -- which is
//             Road Rash, not a bug.
//   lim    -- how far from the centreline the escape line may go.
//   pad    -- clearance past the vehicle's flank to aim for.
//
// The escape side is the flank nearer the rider that fits inside `lim`; if
// neither fits, or the rider cannot get across in time, it brakes as well.
//
// LATERAL AUTHORITY is the number that decides whether a swerve is possible,
// and it is LOW. MEASURED on a rival at 43 m/s with a proportional steer of
// -0.5: lateral speed built from 0 to 0.9 m/s over 1.2 s and never passed 0.92
// -- a bike leans before it turns. The first version assumed 3 m/s, swerved
// too late and too gently, and the rival hit the semi 0.1 m inside its flank.
// 1.5 m/s is what full steer sustains; the brake test below uses it.
export function trafficEscape(cars, s, lateral, speed, look = 1.8, lim = 4.2, pad = 0.9, authority = 1.5) {
  if (!cars || !cars.length) return null;
  let best = null, bestT = Infinity;
  for (const c of cars) {
    if (c.s + c.halfL < s - 1) continue;                  // already behind us
    const close = speed - c.vs;
    if (close <= 0.5) continue;                           // not closing
    const gap = Math.max(0, c.s - c.halfL - s - 1.0);
    const ttc = gap / close;
    if (ttc > look) continue;
    // Consider a band 0.8 m WIDER than the escape line. Without that margin
    // the threat vanished the moment the rider reached the escape line, the
    // brain steered straight back to its race line, and (MEASURED) it was
    // re-entering the semi's flank 3.5 m after drawing level.
    if (Math.abs(c.at - lateral) > c.halfW + pad + 0.8) continue;
    if (ttc < bestT) { bestT = ttc; best = c; }
  }
  if (!best) return null;
  const left = best.at - best.halfW - pad, right = best.at + best.halfW + pad;
  const okL = left >= -lim, okR = right <= lim;
  let target;
  if (okL && okR) target = Math.abs(left - lateral) <= Math.abs(right - lateral) ? left : right;
  else if (okL) target = left;
  else if (okR) target = right;
  else target = lateral;
  // Already outside the escape line on that side: HOLD it, do not steer in.
  if (target === left && lateral <= left) return { target: lateral, brake: false, ttc: bestT, vs: best.vs, hold: true };
  if (target === right && lateral >= right) return { target: lateral, brake: false, ttc: bestT, vs: best.vs, hold: true };
  const need = Math.abs(target - lateral);
  const brake = (!okL && !okR) || need / authority > bestT;
  return { target, brake, ttc: bestT, vs: best.vs };
}
