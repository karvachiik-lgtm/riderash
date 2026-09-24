# PLAYTEST — hunting the reported gameplay issues

**Method note first, because it decided most of this session.** The user said
"lots of issues in the gameplay" and every scalar harness was green. So I played
the game through `chrome-devtools` + the `threejs` bridge, driving real key
events and reading `__GAME__`. Three of my first four "bugs" were **my own test
methodology**, not the game. Recording them here because the same traps will
catch the next person.

---

## The traps that produced FALSE POSITIVES

### FP-1 — A one-frame key press is not a key press
`input.js` sets `pressed[kind] = true` on keydown and `endFrame()` clears the
whole table at the end of each frame. My probes did:

```js
key('keydown','KeyJ'); await sleep(30); key('keyup','KeyJ');
```

At ~4 fps under swiftshader a frame is 250 ms, so **down and up landed inside
one frame** and the edge was consumed before `player.update` read it. I
concluded "combat is broken, 40 punches did zero damage".

**Truth:** holding the key for ≥3 frames works perfectly. Measured: 30 realistic
mashes → DELANEY 27→0 hp (knocked down), NAKAMURA 60→39, `knockDowns: 1`,
`combo: 2`, stamina 100→34.

**The rule:** when driving a frame-rate-independent input system from a test,
hold the key for several frames. `_nondet` and the gate both have this bug in
their attack loop — see GATE-1 below.

### FP-2 — Racing the countdown looks like a hung game
Sampling immediately after `__START__()` showed `speed: 0`, `s` frozen at 37.7,
`steer: 0`, `lean: 0` — which reads exactly like a dead integrator. It was the
countdown holding the grid (`gridInput`, § following). Once `countdown === 0`
the same code accelerates 0→50 m/s in 339 m.

**The rule:** always `waitOutCountdown` before measuring anything.

### FP-3 — Reading field names off `__GAME__` by assumption
`__GAME__` publishes `over`, not `raceOver`; there is no `time`, `onRoad` or
`camMode` on it. A probe using the wrong name threw
`Cannot read properties of undefined` and looked like a crash in the game.

### FP-4 — `performance_snapshot` mid-frame
Reported `drawCalls: 1, triangles: 1`. The read landed between the
post-processing passes. Use the gate's `draws` counter.

---

## The REAL bug found and fixed

### BUG-1 — `Space` was declared twice in `KEYMAP`, so BOOST was unreachable
`src/input.js` had:

```js
Space: 'boost',
Space: 'brake',
```

A duplicate key in an object literal silently keeps the **last** one. So
`KEYMAP.Space === 'brake'` and the string `'boost'` appeared **nowhere in the
map**. Every `input.attackPressed('boost')` in `player.js` read a flag that
nothing could ever set — the entire boost verb (`physics.js` `tryBoost`,
`BOOST_FORCE: 3400`, `BOOST_TIME: 1.6`) was dead code from the day it was
written.

**The UI already promised it**: `index.html:138` reads
`<kbd>Space</kbd> boost`. So this was a broken promise to the player, not a
design question.

**Symptom, measured:** pressing Space at 10.2 m/s did **not** raise `boost`
(0) and the bike did not accelerate; pressing it while riding made the bike
*slow down*, because it was braking.

**Fix:** `Space` moved out of `KEYMAP` into its own `EDGE_KEYS` table
(edge-triggered, like the attacks), and `get brake` no longer reads a
`down.brake` field that nothing sets (brake is `S` / `ArrowDown` → `'down'`).

**Verified after:** Space sets `boost: 1.54` and raises speed 10.2 → 12.0, while
`S` still brakes (15.9 → 8.9). Both behaviours confirmed live.

**Why nothing caught it earlier:** the gate drives throttle/steer only and never
presses Space. No harness had ever tested a riding verb's *input binding* — they
all test the physics behind it. That is the blind spot.

---

## Found by the same audit, still open

### OPEN-1 — `GATE-1`: the gate's own attack loop is FP-1
The gate reports `56 punches, 56 kicks, 56 chains thrown` but only **8 hits
landed in 14 s**. It presses and releases within one frame, so most of those
"thrown" attacks are edges the game never saw. The gate is therefore measuring
its own input timing, not the combat system. It passes either way, which is why
it never surfaced.

### OPEN-2 — A race is ~94 s of straight-line driving
Coastal is 900+620+780+900+1100+700 = **5000 m**. At the measured ~53 m/s
sustained that is ~94 s per race with no corners to break it up, ×5 races in the
career. Road Rash races are short and repeatable; this is a slog. `TRACK_LEN:
5200` and the map sector tables are the levers.

### OPEN-3 — Rivals and the player trade almost no damage in some runs
Run-to-run variance is extreme: one measured run took the player from hp 100 to
**0** (knocked down, 197 down-frames, finished 6th) while another held **hp 100
and pos 2** for 620 m with the throttle pinned. The NPC FSM is working
(`RACE/HUNT/ATTACK/EVADE` all observed), so this is a tuning/asymmetry question
rather than a dead system. Worth measuring: how often does a rival actually
commit an attack that reaches the player?

### OPEN-4 — The camera is invisible to the player on foot... fixed, but read it
The walk cycle is real but was framed off the bottom of the screen. Fixed in
`main.js` this session (`focus`, reach ×0.45, look-ahead ×0.25 while
`player.onFoot`). Confirmed by re-reading the `_seq` crops.
---

## TRAFFIC COLLISION — investigated at the user's request. It WORKS.

The report was "the cars don't have collision". They do. Three independent
tests, all live, all passing:

**Test 1 — staged head-on.** Take a real car from `traffic.userData.cars`, set
`dir = 1` (the oncoming convention), place it 40 m ahead in the player's lane,
and ride. Closing sequence `39.1 → 20.5 → 1.5 → 0.0` m, then:

```
hp 100 → 74     (exactly CAR_HIT_DMG: 26 for an oncoming car)
contacts +1
```

**Test 2 — natural driving.** Ride at speed, steer into the oncoming lane for
900 frames, no teleporting:

```
4 traffic hits, hp 100 → 15, minimum separation 0.45 m
17 cars: 8 oncoming (dir=+1), 9 with the player (dir=-1)
```

**Test 3 — scene health.** All 17 cars `visible`, parents visible, rooted in the
scene, correctly positioned by `s`/`at`.

### Why it *looks* like there is no collision — the three real traps

1. **The `dir` convention is inverted from its own comment.** The comment says
   *"Oncoming traffic closes on the player, so its s FALLS"*, and the code is
   `u.s += (u.dir > 0 ? -u.speed : u.speed) * dt`, which means **`dir = +1` is
   ONCOMING** and `dir = -1` is *with* the player. But `buildTraffic` also says
   `car.userData.dir = r() < 0.34 ? -1 : 1; // +1 oncoming`. So `dir=+1` is
   oncoming in both places and the motion is right — but the *first* comment
   claims `dir>0` means the s falls, which reads as same-direction. Anyone
   testing from that comment sets `dir = -1` and gets **no hit**, because that
   is a car driving away from them. I made exactly this error.

2. **The collision box is generous, so people expect a knock and get a scrape.**
   The car's body is `BoxGeometry(1.82, 0.72, 4.3)` → half-width **0.91 m**,
   half-length **2.15 m**. `trafficHit` defaults to `halfWide: 1.35, halfLen:
   2.9` — a box roughly **1.5× the car** in width and **1.35×** in length. So a
   rider can visually pass *through the corner* of a car and register nothing,
   while the hit that does land feels like it came from nowhere. This is an
   arcade-forgiving choice, and it is defensible, but it is also why "the cars
   don't collide" is a reasonable thing to believe while looking at the screen.

3. **`updateTraffic` overwrites `at` and `{s}` every frame.** A car's `at` is
   recomputed from its lane (including the weave), and its `s` is clamped and
   recycled around the player. So a test that parks a car by poking `userData`
   has that edit erased on the next frame — the car snaps back to its lane or is
   teleported 700 m away by the recycle rule. Setting the fields is not enough;
   the placement has to survive an update tick.

### Verdict
**No fix needed for "cars have no collision" — the feature is implemented and
measurably working.** What I would change is the *size mismatch* (item 2), since
a 1.5×-wide invisible box is what makes the system feel absent. That is a
tuning change, not a repair, and it is listed under OPEN-5 rather than silently
"fixed", because the current box is deliberately forgiving and shrinking it
makes the game harder.

### OPEN-5 — the traffic hit box is ~1.5x the car
`trafficHit(..., halfLen = 2.9, halfWide = 1.35)` against a car of
`0.91 x 2.15`. Levers: widen the car mesh (it is a 1.82 m box — narrow for a
saloon on a two-lane road) or tighten the box to ~`2.2 / 1.0`. Measure after:
`contacts` per run should rise, and `_nondet`'s `pinnedFrames` must stay 0 —
a tighter box near the rail is exactly the change that produced the 229-frame
pinning in §5.5.

---

## FIXED THIS ROUND

### BUG-2 — Rivals committed attacks they could not land (the pack "didn't fight")
**Symptom:** the player's hp sat at 100 for 620 m with the throttle pinned. A
race where nothing can touch you is a time trial with decoration.

**Not the cause:** the pack being passive. `harness/_aggro.mjs` measured 29
commits across the five rivals with heavy `ATTACK` state time (VOSS: 676
frames). They attacked constantly.

**The cause:** `_updateATTACK` returned `attack: this.attack` on the **first
frame of the ATTACK state**, which is the frame the state was *entered*. But the
class enters ATTACK when a victim is merely *viable* (`HUNT_RANGE`), and the
victim may be behind or abreast. `_enterATTACK` also picked the weapon from the
distance at that instant. `Fighter.resolve` then correctly rejected everything,
because its arc test wants the target in **front**.

**Measured** by wrapping `Fighter.resolve` (`harness/_whymiss.mjs`):
```
24 swings, 3 hits
rejections: 87 far, 18 arc, 0 along
mean rejected angle: 2.42 rad  (~139 degrees -> the victims were BEHIND)
```

**Fix:** the rival now closes and swings only when the geometry is real.
`_inSwingReach` mirrors the three tests `resolve` applies (range, along-road
limit, forward cone) using the same `ATTACKS` table, so tuning a weapon cannot
desync the two. The weapon is re-picked at **swing** time (`_pickWeapon`) from
the current distance, rather than at entry.

**Measured after:**
| | before | after |
|---|---|---|
| swings | 24 | **14** (fewer wasted) |
| hits | 3 | **4** |
| hit rate | 12.5% | **28.6%** |
| mean miss angle | 2.42 rad | **1.78 rad** |
| player hp over the run | 100 (untouched) | **17 → 0 (knocked out)** |

**And the gate independently agrees:** `8 hits landed in 14 s (5 punches, 5
kicks, 5 chains thrown)` — a **53%** hit rate, up from 4.8%.

### BUG-3 — the gate was measuring its own input timing
The gate fired `keydown` and `keyup` in the same JavaScript task. `input.js`
clears its whole `pressed` edge table in `endFrame()` at the end of every frame,
so **the game never saw a single punch**. It reported "56 punches thrown, 8
hits" and passed. Every attack test in this project has been measuring nothing.

**Fix:** each press now dwells for 4 `requestAnimationFrame` ticks. Reported
throws fell 168 → 26 because the count is finally honest, and the hit rate went
4.8% → 53%.

### BUG-4 — the `dir` comment in `world.js` was backwards from its code
The comment above `u.s += (u.dir > 0 ? -u.speed : u.speed) * dt` read
*"Oncoming traffic closes on the player, so its s FALLS"*, which a reader takes
as `dir > 0` = same-direction. It is the **opposite**: `dir = +1` is ONCOMING
(`buildTraffic` sets `dir = r() < 0.34 ? -1 : 1`, two thirds oncoming). Anyone
testing traffic collision from that comment sets `dir = -1`, gets a car driving
away at the same speed, and concludes traffic collision is unimplemented. It is
implemented and works (three live tests, below). The comment was the bug.

### TUNED — traffic hit box was ~1.5x the car
`trafficHit` defaulted to `halfWide: 1.35, halfLen: 2.9` against a car mesh of
`BoxGeometry(1.82, 0.72, 4.3)` → half **0.91 x 2.15**. A box half again wider
than the car is why a rider can pass visibly through a corner and register
nothing. Now `CFG.TRAFFIC_HIT_HALF_W: 1.15, TRAFFIC_HIT_HALF_L: 2.60` — still
forgiving at the corners, no longer wider than the car by half.
`_nondet` `pinnedFrames` stayed **0** across 12 runs, which was the risk: a
tighter box near the rail is what produced the 229-frame pinning in §5.5.

### TUNED — races were ~94 s; now ~58 s
`MAPS` were ~5000 m, i.e. ~94 s of held throttle at the measured 53 m/s
sustained. Road Rash races are short enough to retry immediately. Scaled to
~62% (coastal 3105 m, canyon 3290 m, city 3165 m) with the authored sector
proportions and biome ORDER untouched — the rhythm is the design, the raw length
was not. `ROAD_SEGS: 700` still builds 5600 m of road, so nothing ran short.
Finish/results/restart path re-verified after the change.

---

## The traffic collision investigation (for the record)

The report was "the cars don't have collision". **They do.** Three live tests:

**Staged head-on** — real car, `dir = 1`, 40 m ahead in the player's lane:
```
closing 39.1 -> 20.5 -> 1.5 -> 0.0 m
hp 100 -> 74   (exactly CAR_HIT_DMG: 26 for an oncoming car)
```
**Natural driving** — 900 frames in the oncoming lane, no teleporting:
```
4 traffic hits, hp 100 -> 15, minimum separation 0.45 m
17 cars: 8 oncoming, 9 with the player
```
**Scene health** — all 17 cars visible, parented, correctly placed by `s`/`at`.
