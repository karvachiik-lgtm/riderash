# tools/

## fuzz.mjs — the fuzz / regression harness

Plays the real game headlessly and checks it does not break: random riding and
fighting, pauses, mid-race restarts, instant replays, cops, crashes, and every
exit from the results screen, with invariants checked every step (no page
errors, finite physics, consistent grabs, nobody stuck, every race ends and
its replay opens). Targeted checks for fixed bugs run first.

```sh
cd tools
npm install                              # playwright-core + three (served locally, works offline)
npx playwright-core install chromium     # once; or set CHROME_PATH to an existing Chrome
node fuzz.mjs                            # 4 races from career race 0
node fuzz.mjs --races 5 --start 20       # late career: longer courses, harsher cops
node fuzz.mjs --seed 7 --no-checks       # a different random run, fuzz only
```

It serves the repo itself (no other server needed). Exit code 0 = all held,
1 = something failed (each failure is printed) — usable before a push.

## arrestcheck.mjs — the arrest / bust scene harness

Plays every bust scene (`src/arrest.js`: cuff, ticket, lecture, knees, ground)
on the real rigs and measures both bodies every frame, with the game's clock
held (`__HOLD__`) so nothing moves between measurements:

| check | fails when |
|---|---|
| upright, headOverPelvis | the cop leans past a crouch, or flips (torso up-vector, head over pelvis) |
| pelvisDrift, torsoRange, neckRange | a joint drifts from rest — the `+=` accumulation that turned him upside down |
| belowRoad, floating | any joint under the road, or standing feet off it (a raycast onto the real road mesh) |
| teleport, pop, scale | the pelvis jumps, the torso snaps, or the body changes size in a frame / re-parent |
| tooClose, tooFar, facing | he is inside the suspect, out of reach, or not squared up to them |
| cuffHands | his hands are not on the suspect's wrists while cuffing |
| suspect* | kneeling / prone / thrown suspect off the road, not kneeling, not face down, jumping |
| bikeFallen, bikeGround | the parked police bike tips over or floats |
| script, overrun, stuck | the phases run out of order, overrun, or the scene never clears |
| copPoseLeak, nextRace* | anything left over after the scene or in the next race |

Every variant runs at every kind of place on the course (straight, both bends,
up and down hill), crossed with the cop's side, the suspect's place across the
road, their state (seated, falling, lying) and the frame rate (30/60/144 Hz),
plus rival arrests, a skipped scene and three busts in a row.

```sh
node arrestcheck.mjs              # the covering set (35 cases, ~8 min on software GL)
node arrestcheck.mjs --quick      # one case per variant
node arrestcheck.mjs --full       # the whole cross product
node arrestcheck.mjs --only knees --trace   # some cases, with the walker traced
```

Each run writes a side-on filmstrip per case (a shot in every phase) and a
contact sheet to `tools/out/arrest/` (`index.html`, `sheet.png`) — look at it:
a pose can pass a number and still read badly.
