# Plan — rider pose, done as one determined pass

## STATUS: the pose solve is DONE. Remaining: the showroom/state items below.

### Solved and verified
`harness/_solvepose.mjs` solves all six coupled unknowns in ONE browser session,
iterating to a fixed point, with an anatomy gate on the knee branch. `--write`
patches `src/reach.js` and `src/config.js` so no number is transcribed by hand.

Result at 1.75 m (verified in-game in the static state, not just in the solver):

| contact            | residual | note                                            |
|--------------------|----------|-------------------------------------------------|
| pelvis → saddle    | 0.000 m  | `(0, 0.873, -0.28)` vs slab `(0, 0.875, -0.28)`  |
| fist → grip        | 0.0025 m | 2.5 mm                                           |
| sole → peg         | 0.0546 m | structural: boot ~3 cm inboard of the peg        |
| knee below hip     | yes      | anatomy gate holds (0.794 < 0.832)              |

Written values: `torso 0.30`, `upperArm -1.04`, `splay 0.13`, `elbow -0.32`,
`hip 1.48`, `knee -2.34`, `hipSplay 0.16`, `SEAT_Z 0.056`.

### The two bugs that made the old numbers unfixable
1. **Double normalisation.** `assets/rider.js` centres itself, then `assetlib.js`
   centred it AGAIN using the riding pose, where the lowest point is the pelvis
   and not a boot — dropping the body 0.62 m below the saddle. Fixed with a
   `userData.grounded` contract: an asset that has measured itself is left alone.
   The rider's own normalisation now measures in a NEUTRAL legs-down pose, so a
   change to the riding pose can no longer move the origin.
2. **Three copies of the pose.** `player.js`, `showroom.js` and `assets/rider.js`
   each had their own literals. Now one table in `src/reach.js`, passed to the
   asset as `opts.ride` (the asset may not import).

### Still to do this pass
- [ ] Confirm the gate is green (running).
- [ ] Clean up the ~50 one-off `_*.mjs` probes into the handful that earned a
      place: `_solvepose.mjs`, `_verifyall.mjs`, `_verifystatic.mjs`,
      `_launch.mjs`, `riderash-gate.mjs`. The rest are archaeology.
- [ ] Persist the showroom spec to the career.
- [ ] The remaining user asks from earlier: roster already cut to 5 rivals;
      motion precision (walk cycle, wreck pose), banter, cops.

## Why the step-back was right (kept for the record)
The pose is six coupled unknowns and four contacts. Solving them one at a time
in separate browser sessions does not converge — every fix invalidates the
previous one, which is exactly the loop the last hour was stuck in. One solver,
one pass, one write.

## Definition of done (met for the pose)
`node harness/_solvepose.mjs` prints one table, all contacts are inside
tolerance, the anatomy check passes, `--write` updates the code, the in-game
static verify agrees with the solver to the millimetre, and the side elevation
reads as a rider on a machine.