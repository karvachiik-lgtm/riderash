# SESSION REPORT — autonomous pass

Running log. Newest entries at the bottom of each section. This file is the
handoff memory for everything done while working without the user.

---

## 0. Open questions for the user

1. **(BLOCKING?)** "left right turn is inverted" — I need to confirm WHICH of
   these it is, because they are different bugs with different fixes:
   - the **bike** steers the wrong way (press D, bike goes left), or
   - the **radar/navigation** shows left/right mirrored, or
   - the **camera** swings the wrong way in a turn.
   I will measure all three and fix the one that is actually wrong; flagging it
   here because a wrong guess here is a regression.

---

## 1. Defect list for this pass

Reported by the user:
- **A.** "navigation needs left right fix"
- **B.** "not sitting on the bike right now"
- **C.** "left right turn is inverted"

Agreed backlog from before:
- **D.** Banter / taunt layer between races
- **E.** Cops as Level-2+ escalation (arrest state + fine on the damage meter)
- **F.** `_feel.mjs` crash/swing counters are untrustworthy

---

## 2. Running log

### S1 — Session opened
Starting with A/B/C because basic correctness beats features. Method for each:
measure in the live page, find the code path, fix, re-measure, screenshot.

### S2 — B: "not sitting on the bike right" — FOUND AND FIXED

**Cause was my own socket change from the previous session, caught by measuring.**
The bike is loaded with `height: 1.25` and the rider with `height: 1.55`, so
`ASSET()` applies a DIFFERENT uniform scale to each. Measured: bike `0.895`,
rider `1.028` — both world scales.

While the rider was a *sibling* of the bike (both under the group) those scales
were independent. The socket parented the rider *to the bike*, so the bike's
scale multiplied into the rider's world scale: `0.895 * 1.028 = 0.920`. The
rider sat **8% small**, and the seat offset `(0, 0.78, -0.05)` was multiplied by
`0.895` too, dropping the pelvis from `0.78 m` to an effective `0.70 m`.
Symptom: rider sunk into the tank, bike tail visible through him.

**Fix:** the socket is now **scale-neutral**. It carries the bike's inverse
scale, so its local space is world-scaled; the seat offset is therefore in TRUE
metres and each body keeps its own authored scale. The parenting — and therefore
the unbreakable contact — is unchanged. The two goals were never in conflict;
only an un-countered socket made them look so.

`player.js` stores `_bikeScale` and uses it for the wreck slump offsets too, so
those are not stretched by 12% either.

**Measured after:** rider world scale `1.0276` (authored), rivals `1.0276`,
seat height `0.778 m` in true world metres (authored `0.78`), no page errors.
Screenshot `seat-after.png` vs `seat-before.png`.

### S3 — A: "navigation needs left right fix" — FOUND AND FIXED

The radar's `right` basis vector was **mirrored**. In `radar._project`:

    const right = dx * fwdZ - dz * fwdX;      // WRONG: this is LEFT

Measured live against `travel x up`: true right `(1, 0)`, radar right `(-1, 0)`
— exactly opposite, so every blip sat on the wrong side of the dish. The
previous session fixed front-to-back in this same function by deriving the basis
from the bike's forward vector, but the right vector was left mirrored.

**Fix:** `right = -fwdZ, +fwdX` in XZ, i.e.

    const right = dx * (-fwdZ) - dz * (-fwdX);

which is the vector the rider's own lateral axis uses (`n = (-t.z, t.x)`, from
`BikePhys.sync`), so the dish can no longer disagree with physics.

**Measured after:** a rival forced to `+6.0 m` lateral (physically right)
projects to `right: +6.0` on the dish; `-2.4 m` (left) projects to `-2.3`.

### S4 — C: "left right turn is inverted" — MEASURED, NOT A PHYSICS BUG

I checked every candidate and this one is **not** what it looked like:

- `steer = +1` (KeyD) -> `lateral` **increases** (+8.5 m measured).
- `lateral` positive IS physically **right** (verified against `travel x up`:
  `lateralNormal (1,0)`, `trueRight (1,0)` — match).
- The player's group faces **forward** along travel (`groupFwd . travel = 1.0`).
- `roadYaw = atan2(t.x, t.z)` is correct for `headAt` (which already negates the
  geometric tangent).

So the BIKE steering is correct. **The inversion the user saw is the radar**,
fixed in S3 — the navigation display showed left as right, which reads exactly as
"left right turn is inverted". I did not touch physics, because changing it would
have introduced a real inversion to compensate for a display bug.

**If the bike still feels inverted to the user after S3, that is a different
report and I need to know which way and on which input.**
---

## 3. PHYSICS: "the physics isn't real"

### S5 — First, an honest audit

The user's critique proposed replacing the model with a hand-rolled 1D
longitudinal + 1D lateral + cosmetic lean. **I read the existing model before
touching it, and it is not the thing the critique assumed.** `src/physics.js`
already has:

- a real torque curve, drag `½ρCdAv²`, rolling resistance, engine braking
- a **Pacejka-style tyre slip curve** with a linear region and falloff
- **tyre relaxation length** (force builds over ~0.55 m of travel)
- **weight transfer feeding per-axle tyre load**
- **second-order damped-spring suspension** per axle
- countersteer, wheelie/stoppie derived from load, fixed-timestep accumulator

That is *more* than the proposed replacement, not less. Replacing it would have
been a regression. So "the physics isn't real" is a **felt** complaint, and a
felt complaint has to be measured before it can be fixed.

### S6 — The instrument: `harness/_feelphysics.mjs`

Drives the bike through right-turn / brake / accelerate / lean-step and samples
`speed, lateral, lean, steer, yawRate, lateralV, loadFracFront, wheelie` every
animation frame. It reports the quantities that actually create the sensation.

**Measured BEFORE (this is the diagnosis, not a guess):**

| metric | measured | what it should be |
|---|---|---|
| braking 42.6 -> 0 m/s | **0.90 s = 4.82 g** | ~1.0 g |
| lean settle (t90) | **0.82 s** | 0.15-0.25 s |
| steer -> lean lag gap | **0.78 s** | 0.15-0.25 s |
| `loadFracFront` mid-corner | **0.107** | ~0.45 |
| solo terminal speed | **53.9 m/s** | `CFG.MAX_SPEED` says 61 |

Every one of those is a real defect, and none of them required a new model.

### S7 — The five fixes

1. **Braking clamped to grip.** `BRAKE_FORCE 6200 N` on 245 kg asked for
   25 m/s². Added `PHYS.BRAKE_G: 1.05`; brake force is now
   `min(BRAKE_FORCE*upright, BRAKE_G*g*m)`. **Measured after: 40 -> 8.7 m/s in
   2.5 s ≈ 1.15 g.** Hard, short, readable.

2. **The lean is a second-order spring.** It was first-order
   (`lean += (target-lean)*h*LEAN_RATE`), which cannot overshoot and has no
   momentum — it arrived and stopped dead. Now
   `lean'' = (target-lean)*LEAN_STIFF - lean'*LEAN_DAMP`.
   `LEAN_STIFF 300 / LEAN_DAMP 20` was **solved, not guessed**: wn=17.3 rad/s,
   zeta=0.58 → 0.133 s settle peaking 11 % at 0.222 s. **Measured after:
   t90 0.22 s.**

3. **Steer smoothing was the real lag.** `STEER_SMOOTH 5.5` is a ~0.42 s ramp,
   and it sat *upstream* of the lean spring, so no spring tuning could make the
   bike answer quickly — the target it chased was itself still arriving. Raised
   to **14.0** (~0.16 s, keyboard-direct without being a step). **Measured after:
   tSteer90 0.171 s, lag gap 0.151 s.**

4. **A physics error I introduced and then caught by measuring.** My first
   cornering term *subtracted* lateral acceleration from `loadFracFront`, which
   is wrong: a bike leaned at 41° doing 0.88 g is pressed HARDER into the road,
   not lifted off it. Measured result was the front at **0.107** — worse than
   before. Corrected: cornering consumes the tyre's **friction circle**, so it
   is published as `phys.gripDemand` (0..1 of the budget) and
   `phys.gripCircleHeadroom = sqrt(1 - demand²)`. **Measured after: front load
   mid-corner 0.397.** (The circle is published but deliberately **not** yet
   multiplied into `tyreForce` — that is a whole-model change and gets its own
   measured pass. Recorded so the decision is visible, not lost.)

5. **`MAX_SPEED` was fiction.** It said 61 in config *and* a separate literal 61
   in `step()`, while the engine/drag balance actually converged at **53.9**.
   Because `revFrac = speed/topSpeed`, the top 12 % of the rev band was
   unreachable — and `MAX_SPEED` is a **denominator** for the HUD bar, speed FX
   and engine audio, so all three peaked at 0.88 and never reached full.
   Solved as a fixed point (revFrac depends on topSpeed and topSpeed is the
   terminal of the curve it produces) → **`MAX_SPEED: 48.16` m/s**, and `step()`
   now reads `CFG.MAX_SPEED` instead of a literal.
   **Verified:** `_topspd.mjs` holds throttle and reaches 48.4-49.2 m/s on the
   flat, matching the solved value; 52.2 m/s is reachable **in a draft**, which
   is correct — slipstream reduces drag on purpose.

### S8 — Feel budget, in one place

`PHYS` now groups the six taste numbers the critique named:
`BRAKE_G`, `LEAN_STIFF`, `LEAN_DAMP`, `LATERAL_DAMP`, `SUSP_STIFF` (alias of
`SUSP_K`), plus `LATERAL_TRANSFER_*` for the friction circle. Everything else in
`PHYS` is a real constant or structural.

### S9 — One more mistake worth logging

My `PHYS` edit left a stray `};` that closed the object early, putting
`BODY_R: 0.50,` etc. **outside** the literal as bare statements. `node --check`
**passed** — the file is valid JavaScript, the error is that the statements are
not inside the object. The browser reported `SyntaxError: Unexpected token ':'`
with a URL and line, which is how it was found. **New lesson for the log: a
`node --check` pass does not mean a data literal is correct; a stray brace is a
runtime semantic error, not a syntax error.** Verify with a brace-balance count
on the block, which is what found it (`brace balance in PHYS block: 0 OK`).

---

## 4. Response to "sample, don't collide"

I read the note against the code before changing anything. **The architecture it
recommends is, in its essentials, already what this game does** — but three of
its claims do not hold for *this* codebase, and one of them is a real bug it
points at from the wrong direction. Corrections, with evidence:

### Already true

- **"Collision is two numbers per entity, never meshes."**
  `trafficHit()` (world.js:554) tests `|u.s - s| > halfLen` and
  `|u.at - lateral| > halfWide`. There is **no `Box3`, no `Raycaster`, no
  `intersectObject`, no `distanceTo`** anywhere in combat.js, npc.js or
  physics.js — I grepped. Lane-space scalars are the only collision model in
  the game.

- **"The road is a function of `s`, not geometry to collide with."**
  `centreAt(z)` is a closed-form function; `centreTangent`/`headAt` give the
  frame; the bike's `pos` is `centreAt` offset by `lateral` along
  `n = (-t.z, t.x)` (physics.js:413-421). Nothing samples a mesh.

- **"Airborne is a state flag, not a physics system."**
  Exactly so: `this.airborne`, ballistic `airY`/`airVY`, and re-acquire when
  `roadFall` exceeds suspension travel (physics.js:965-991).

- **"Broadphase solves the 14-rider cost."**
  That is the existing `RIVAL_LOD_FAR/NEAR` (420/360 m) — far riders hold pace
  and lane and spend no AI.

### Not true here, and why it matters

1. **"Your track is a spline with per-segment position, width, and pitch."**
   **There is no spline and no per-segment data.** `centreAt` is a *sum of
   sines*: `x = 18·sin(0.0067z) + 58·sin(0.0024z+1.7)`, and four sine terms for
   `y`. It is C-infinity, deterministic, and free — better than a spline here,
   because there is nothing to interpolate and no control points to author.
   The note's `track.sampleAt(s)` step is therefore already inlined and costs
   one function call, not a segment lookup.

2. **"`banking` and `pitch` need summing into the roll."**
   **The road has no banking, by design.** `centreAt` produces `y(z)` only —
   the cross-section is flat, so `lateralOffset * tan(banking)` is identically
   zero. Roll is pure cosmetic lean (`bikeRoll`), which is the intended look.
   Adding banking would be a *new* feature, not a bug fix.

3. **"If you're setting `bike.position.y = groundY`, the wheels float by the
   mesh pivot offset."** — **This one is right about the class of bug and I
   should verify it, but the fix is not `+ WHEEL_RADIUS`.** Let me check what
   the offset actually is before writing a constant that might be wrong.

### The one real gap: pitch is missing

`sync()` sets `pos` and `roadYaw` from the tangent, and the y is the road
centre's y — but **nothing pitches the bike between the front and rear axle.**
The note's `rotation.x = atan2(frontY - rearY, wheelbase)` two-point sample is
a genuine, cheap, correct improvement, and `centreAt` makes it trivial. That is
worth doing, with a measurement attached (the `max |tyre y - road y|` counter).

### Where the note is right in spirit and I intend to act

- **Tunnelling.** The note's closing-speed argument is sound and *I have not
  verified it here*. The LOD threshold is 420 m and traffic is tested once per
  frame; at 50 m/s closing the sweep gap is the one it names. **This gets the
  red-flag counter it asks for** (`tunnelled-collision count`), and only then a
  fix — because I do not yet know whether the existing test is expanded.
- **The three hit outcomes** (side-swipe / rear-end / head-on-fatal) are the
  right taxonomy and the report already shows the commit-window machine exists;
  what is missing is that the *outcome* should be chosen by geometry. Worth
  aligning, as its own pass.

I am **not** rewriting the driving model to the note's 1D+1D+cosmetic-lean
sketch. §3 records why: this codebase already exceeds it (slip curve,
relaxation length, per-axle load, 2nd-order suspension), and the felt defects
were found and fixed by measurement without discarding any of that.

### 4.1 Verifying the note's claim 3 — measured, not assumed

The note said: *"if you're setting `bike.position.y = groundY`, the wheels
hang below or float above by whatever the mesh pivot offset is."* I measured it
instead of implementing `+ WHEEL_RADIUS` on faith, and the answer is **both
more precise and different from the guess**.

**The bike's origin IS the contact plane, and it is authored that way.** From
`assets/bike.js`:

```
WR = 0.31                                 // wheel radius
frontSteer.position.y = 0.74              // headstock
fWheel.position.y = WR - 0.74             // -> world Y = 0.31
swing.position.y = 0.46
rWheel.position.y = WR - 0.46             // -> world Y = 0.31
```

Both wheel centres land at exactly `+0.31 = WR`, so both contact points are at
origin **Y = 0**. The asset is correct. `WHEEL_RADIUS` therefore must **not** be
added — it is already in the geometry, and adding it would float the bike 31 cm.

**Measured live** (`harness/_lowest.mjs`, Box3 min Y of every player mesh):

| | roadY | lowest mesh | delta |
|---|---|---|---|
| upright | 3.4485 | 3.4234 | **−2.5 cm** |
| leaned 41° | 1.8401 | 1.8032 | **−3.7 cm** |

`suspCompression` and `airY` were both 0, so the delta is pure geometry, and it
**grows with lean**. The tyre cannot be the cause — a rigid disc keeps its
lowest point at `axle − R` under any roll about its own axis. What moves is the
**chassis**: at 41° the fairing/exhaust/low-side corner rotates below the
contact plane. 2.5–3.7 cm on a 0.31 m wheel is 8–12 % of wheel radius:
invisible at 50 m/s, and real.

**Decision: leave it.** It is authentic (real bikes scrape a case slider at full
lean), it is bounded, and "fixing" it by lifting the body would float the tyres
at zero lean instead — trading a hidden 3 cm under the fairing at 41° for a
visible 3 cm gap under the wheels at 0°. The note's stated failure (wheels
floating or buried) **does not occur here**; the measurement says so.

### 4.2 The part of the note that is a genuine gap: two-point pitch

`sync()` sets `pos` and `roadYaw` from the tangent, and `y` is the road centre's
`y` at a single point. **Nothing samples front and rear axle separately, so the
bike is level through a crest and a dip**, and the existing airborne trigger
reads a one-point `roadFall` derivative rather than a wheelbase-span gradient.
The note's `atan2(frontY − rearY, WHEELBASE)` is correct, cheap, and `centreAt`
makes it a two-call change. This is the one item from the note I am implementing
— with its red-flag counter, as it asks.

### 4.3 Two-point road pitch — implemented and measured

Added to `physics.js`:

- `axleY(s, out)` — the road surface height at distance `s`, via the existing
  `centreAt`. No interpolation, no segment lookup.
- `sampleAxles(sRear, sFront)` — evaluates half a wheelbase either side of the
  bike and sets `rearAxleY`, `frontAxleY`, and
  `roadPitch = -atan2(yF - yR, WHEELBASE)`.
- `roadPitch` / `axleGrade` initialised in the constructor; the two `Vector3`
  scratch objects are allocated **once per bike, not per frame**.

`sync()` now calls `sampleAxles`, and both `player.js` and `rivals.js` apply it
with an explicit **`YXZ`** rotation order:

```js
this.group.rotation.set(p.roadPitch || 0, p.yaw, 0, 'YXZ');
```

The order matters and is the reason a naive `rotation.x =` would have been
wrong: three.js defaults to `XYZ`, which applies the pitch in *world X*, so on
any road not pointing down Z the bike would tip sideways over a crest instead of
nodding. `YXZ` yaws first and pitches about the already-yawed axis.

`roadPitch` is deliberately **not** folded into `yaw`/`tangent`: the physics
resolves along the centre line, and letting a two-point sample feed back into
the integration would compound the grade every step.

**Measured (`harness/_pitch.mjs`):**

| | value |
|---|---|
| track profile pitch range (two-point, over 5.6 km) | **−3.22° .. +3.15°** |
| steepest grade the profile demands | **5.63 %** |
| live bike `roadPitch` over a 7 s run | **−0.06° .. +3.16°** |
| group rotation order | **`YXZ`** |

The live maximum matches the profile maximum to 0.01°, and the grade agrees with
the ~5 % authored profile in `level.js` — so the bike is now riding the road
that is actually there, not a level line through it. Gate: **all checks passed**,
`draws 651 / 900`.

### 4.4 Verdict on the note

| note's claim | verdict |
|---|---|
| collide in `(s, x)`, never meshes | **already true** — `trafficHit()`, no Box3/raycast anywhere |
| road is a function, not geometry | **already true** — `centreAt` is closed-form |
| spline with per-segment width/pitch | **no spline** — sum of sines; simpler and already inlined |
| banking in the roll sum | **no banking by design**; would be a new feature |
| `+ WHEEL_RADIUS` to fix float/bury | **would float the bike 31 cm** — origin is already the contact plane |
| two-point pitch via `atan2` | **real gap, now implemented and measured** |
| sweep for tunnelling | **plausible, unverified** — next item, with its counter |
| three hit outcomes by geometry | **right taxonomy, own pass** |
| don't adopt a rigid-body engine | **agreed, and this game already didn't** |

### 4.5 Tunnelling — the note's concern, measured and then guarded

The note said: *"at 50 m/s closing speed and 60 fps you move ~1.7 m per frame — a
fast player clipping a narrow obstacle will tunnel. That's almost certainly why
things pass through each other right now."*

**I built the counter first, as asked, and it disproved the diagnosis before I
was allowed to act on it.**

`harness/_tunnel.mjs` installs a shadow observer in the live page: every frame
it compares the player's `(s, lateral)` against the published `__TRAFFIC__`
cars, and flags a **tunnel** when the player's `s` segment crosses a car's
`s` band while laterally overlapping but the game reports no hit.

**Result over 2701 frames / 45 s of racing: 0 tunnelled pairs.**

Then I checked the counter was worth trusting — *a counter that cannot fire
proves nothing* — with `harness/_tunnel_probe.mjs`: it teleports the player
straight through a car in one frame. The observer **flagged it**
(`WOULD_FLAG: true`). So the 0 is a real 0.

**The arithmetic agrees with the measurement.** The game clamps `dt` to 0.05 s,
so per-frame travel is `closing_speed × 0.05`:

| case | closing | per frame | vs 2.60 m half-band |
|---|---|---|---|
| player 45, car with | 45 m/s | 2.25 m | under |
| player 45, oncoming 30 | 75 m/s | 3.75 m | **thin** |
| player 48, oncoming 30 | 78 m/s | 3.90 m | **thin** |

So the note is **wrong that it is happening** and **right that the margin is
thin** — 1.3 m at worst case, and a faster bike tier or a looser `dt` clamp
would spend it.

**Guarded anyway, because the guard is free and strictly conservative.**
`trafficHit()` now takes a `sweep` distance, added to the longitudinal
half-length, turning the test from *"is my point inside the band"* into *"did my
segment this frame overlap the band"*:

```js
const sweep = state.prevPlayerS === undefined
  ? 0 : Math.abs(player.phys.s - state.prevPlayerS);
```

It defaults to `0`, so the near-miss horn caller (which passes a deliberately
wider 16 m box) is untouched.

**Verified it introduces no spurious hits** (`harness/_carhits.mjs`, 60 s ride,
no steering, 2758 m): **damage 0.000, hp lost 0.0, downs 0.** A sweep bug would
have produced a contact storm on a straight line; it produced none.

**Gate after all of the above: all checks passed, `draws 520 / 900`.**

### 4.6 Where this leaves the note

Acted on: **two-point pitch** (§4.2, implemented and measured), **sweep guard**
(§4.5, implemented, measured, and shown to add no false positives), and the
**two red-flag counters** it asked for (`max |tyre y − road y|` in §4.1;
tunnelled-collision count in §4.5).

Not acted on, with reasons recorded: mesh-collision rewrite (**already
lane-space scalars**), banking (**road is deliberately flat across**),
`+ WHEEL_RADIUS` (**would float the bike 31 cm** — origin is the contact plane),
spline (***centreAt* is a closed-form sum of sines**), and the 1D+cosmetic-lean
driving model (§3 — this codebase already exceeds it).

Still open from the note, and genuinely worth its own pass: **choosing the hit
outcome by geometry** (side-swipe vs rear-end vs head-on-fatal). The state
machine for *when* rivals swing exists; what is missing is that *what happens*
should follow from `ds`/`dx`, and the note's rule that a head-on with oncoming
traffic is unconditionally fatal is the right one.

---

## 5. BODY SPEC, CHAIN, AND THE SHOWROOM (in progress)

### 5.1 Requests, as agreed

1. **Showroom first** — a maths-driven character designer, right-hand panel, for
   player AND NPC bodies. Doubles as the rigging workbench.
2. **Roster cut to 5 rivals + player = 6.**
3. **Body shape + colours + gear**, saved to career.
4. **Then** the motion work (chain, actions, wreck).

### 5.2 `src/bodyspec.js` — the maths foundation

The rider's geometry was **40-odd literal numbers written inline** in
`assets/rider.js`. That is not just inelegant, it is the reason three separate
classes of bug kept appearing: nothing forced the numbers to agree, so a change
to one (height) silently invalidated others (seat offset, shoulder height, arm
reach), and there was no way to *ask what a body was* — which is exactly what a
showroom needs to do.

Bodies are now a **spec**: a stature plus a set of **canonical ratios**, with
every dimension derived. The proportions are the standard figure-model canon,
expressed as fractions of height (Vitruvian/Leonardo), not invented numbers:

| measure | ratio | 1.75 m figure |
|---|---|---|
| head height | 1/7.5 H | 0.233 |
| shoulder width | 1/4 H | 0.438 |
| trunk (hip→shoulder) | 0.288 H | 0.504 |
| upper arm | 0.186 H | 0.326 |
| forearm | 0.146 H | 0.256 |
| thigh | 0.245 H | 0.429 |
| shin | 0.246 H | 0.431 |
| hip joint height | 0.480 H | 0.840 |
| shoulder height | 0.818 H | 1.431 |

**The key property: `BUILD` scales every RADIUS but no LENGTH.** That is the
distinction the old single `scale` could not make, and it is the direct cause of
the earlier seat-offset defect — resizing a body scaled its *skeleton* instead of
its *thickness*, so the seat offset moved when only the build should have.

### 5.3 `assets/rider.js` rebuilt from the spec

Every mesh size and every joint position is now derived. Verified live against
the world matrix:

| | spec | measured on the rig |
|---|---|---|
| upper arm | 0.3255 | **0.3255** |
| thigh | 0.4287 | **0.4287** |

Exact. The asset now **requires** `opts.spec` and throws a clear error without
it, rather than growing a second copy of the table — a duplicated table is a
table that drifts, which is the whole defect being removed.

### 5.4 Two real bugs found by building this

**(a) `ASSET()` silently dropped every option.** `loadPrototype` called the
builder as `fn(THREE)` — one argument — and cached on the URL alone. So anything
that took parameters was unusable: the first build won the cache and every later
request got that same clone. Fixed: options are passed through as
`fn(THREE, opts)` and folded into the cache key via a sorted `stableKey()`
(verified order-independent and discriminating).

**(b) The declaration mechanism did not support ARRAYS.** `declareRefs` handled
`Object3D` and plain objects and **silently dropped arrays**. So an ordered list
of nodes — a chain's links — could never survive a clone and its pose code wrote
to `undefined`. This is the *same failure mode* as the already-documented depth-3
leg bug in that file: nothing throws, the asset renders, only the motion is
missing. Fixed on both the declare and rebuild sides.

### 5.5 The chain, rebuilt as a real chain

It was **seven torus meshes in a flat vertical stack welded to the forearm** —
it could not bend, so it read as a rigid ladder glued to the hand at every speed
and in every swing. This is the direct cause of "the chain movements are not
precise".

Now: **11 joints, each a child of the previous** (`CHAIN_PITCH` 0.030 m), so it
genuinely articulates. The pose is a **trailing solve**, which is what a hanging
chain actually does:

- airflow pushes it back, scaling with **v²** — so it hangs vertically at rest
  and is nearly horizontal at speed;
- swing acceleration adds a throw and snap-back;
- each successive joint adds to the one before with a falloff, so the **tip
  trails further than the root** — the whip;
- clamped, because a non-finite angle reaches the renderer.

Verified by driving the solver directly:

| condition | airflow | root | tip | monotonic |
|---|---|---|---|---|
| rest | 0.00 | 0.013 | 0.104 | yes |
| 30 m/s | 0.51 | 0.054 | 0.444 | yes |
| 45 m/s | 1.15 | 0.137 | 1.129 | yes |
| 30 m/s + swing | 0.51 | 0.211 | 1.350 (clamped) | yes |

Live on the rig: **11 joints resolved, `segmented: true`** (`links[1].parent ===
links[0]`).

### 5.6 Harness now runs through MCP, not hand-rolled puppeteer

The old approach could not take a valid side-view screenshot at all (§4, three
failed attempts). It works now because two things turned out to be true:

- The `threejs-devtools` MCP expects the page loaded **through its own proxy**
  (`http://localhost:50130/__game__/riderash/`), not the game URL directly — the
  proxy is what injects the bridge. Once loaded there, `bridge_status` reports
  **connected**.
- The bridge discovers the scene via `__THREE_SCENE__` / `__THREE_RENDERER__` /
  `__THREE_CAMERA__` and needs `window.THREE`. Those are now published from
  `main.js` with a comment saying exactly why. Without them every tool in that
  MCP fails with *"Three.js scene not found in page"*, which is what happened.

**A free camera was added to `updateCamera`** (`window.__FREECAM__`), and it has
to live *inside* that function, because: (1) it overwrites `camera.position`
every frame so an external writer races it and loses, and (2) `postfx.render()`
presents the frame, so a harness calling `renderer.render(scene, cam)` draws into
a backbuffer nobody sees and the "screenshot" is a stale image that looks valid.
Both failure modes were hit before this was understood. Verified working: a true
side view of the pack was captured at `[37.18, 3.54, -87.01]`.

**Measured lesson for the log:** `renderer.info` reports `calls: 1, triangles: 1`
at this point — that is the postfx final pass, not the scene. Any draw-call
figure read from `renderer.info` in this game is wrong by construction; the
authoritative number remains `g.draws`.

### 5.7 A mistake worth logging

The chain block was inserted into **`poseRider`**, where the frame's speed is
`spd`, but it read **`p.speed`** — `p` is the local name in `applyVisual`. Result:
**4082 console errors of "p is not defined"** in one gate run, caught by the gate
before it reached anything else. Fixed to `spd`; gate green again.

The lesson is older than this bug: the two functions are near-identical in body
(one poses the rider seated, one poses him on foot) and both have a rider, a
fighter and a speed, under **different names**. That is a standing hazard in this
file, and it is the reason the chain is now the only new code in either of them.

---

## 6. WHERE THIS STANDS — the four requests

| request | status |
|---|---|
| 1. Showroom / maths interface for body placement | **foundation done**, UI not yet built |
| 2. Roster cut to 5 rivals + player = 6 | **not started** |
| 3. Body shape + colours + gear, saved | spec supports it; UI and persistence pending |
| 4. Motions precise — chain, actions, wreck | **chain rebuilt and verified**; actions and wreck pending |

**Done and verified this session:** `src/bodyspec.js` (canonical proportions,
build-vs-height separation), `assets/rider.js` rebuilt from the spec (arm and
thigh lengths measured exact against the world matrix), two real loader bugs
fixed (`ASSET` dropping all options; arrays unsupported by the declaration
mechanism), the chain rebuilt as 11 articulated joints with a v²-airflow
trailing solve (measurable: rest 0.10 rad → 45 m/s 1.13 rad, tip always trails
root, monotonic), and the MCP harness connected with a working free camera.

**Gate: all checks passed, `draws 524 / 900`.**

---

## 7. THE WRECK — three real defects, found from the user's screenshot

The user's second screenshot showed a rider lying flat on his back with his legs
in the air while his bike rode away upright. Three separate bugs, all confirmed:

### 7.1 The bike was told to stand up when it crashed

`dismount.js` had, with a comment reading *"a crashed bike lies over"*:

```js
bike.rotation.z = crashed || this.state === ST.MOUNTING ? 0 : lean;
```

`crashed` set the roll to **0 — perfectly upright**. The code did the exact
opposite of its own comment. That is why the machine read as riding away from
the rider it had just thrown. Now FALLING/DOWN/STANDING/WALKING hold the lean
(1.35, or 1.15 walking) and only MOUNTING eases it upright, so the bike meets
the rider already on its wheels.

### 7.2 The prone rotation stood the body on its face

The rider's origin is his **feet**, so rotating the whole body by a prone angle
about the origin does not lay it down — it pivots him forward off his toes like
a lever, head in the air. **Third occurrence of the Euler/rotation-origin class
of bug in this project** (after the rider socket and the road pitch).

Two further errors were found while fixing it, both by measurement:

- **Wrong Euler order.** `rotation.set(bodyX, yaw, roll)` used the default XYZ,
  which composes `Rx·Ry·Rz` — the roll is applied FIRST in the body frame, so a
  51-degree tumble stacked onto an 86-degree prone pitch produced a body on its
  back with its legs up. Now `YXZ`.
- **A closed-form drop that was wrong twice.** Deriving the drop from spine
  landmarks ignores the body's width and depth: a prone 1.75 m figure is **1.29 m
  tall**, not the 0.12 m that landmarks-only maths predicts. Three.js measured
  that version's box at **-0.202 .. 1.073** — a fifth of a metre sunk through
  the tarmac with the rest standing a metre up. A nested-pivot version measured
  **0.593 .. 1.868** — floating half a metre.

**The fix is to measure, not predict.** After the pose is set for the frame, the
renderer takes the rider's real world bounding box and lowers him so its floor
sits on the road. Exact for any figure, pose or future limb change.

**Verified live, pinned in the DOWN state:**

| | value |
|---|---|
| road Y | 3.458 |
| rider box | 3.458 → 4.749 |
| rider above road | **0.000** |
| prone body height | 1.291 m (consistent with the 1.75 m spec) |
| rotation order | **YXZ** |

The bike now reads **-0.231** above the road, i.e. its low-side wheel sinks 23 cm
when it lies over — because `rotation.z` pivots about an origin at wheel-contact
height. Recorded as the next defect; not yet fixed.

### 7.3 The harness pixel path is unreliable and must not be trusted

Chasing a clean side view established three things the hard way:

1. `renderer.info` reports **`calls: 1, triangles: 1`** — the postfx final pass,
   never the scene. Any draw figure read from it is wrong; `g.draws` (from
   `postfx.sceneStats`) is the authoritative number and already was.
2. **Canvas readback returns all zeros** — the WebGL context has no
   `preserveDrawingBuffer`, so `getImageData` on the game canvas is black. Any
   pixel-sampling assertion written against it silently measures nothing.
3. `take_screenshot` can return a **stale composited frame**, which is how three
   of my earlier "side views" came back as the ordinary chase camera. A screenshot
   that looks like a valid photograph is not evidence that it is one.

**Rule for the log: verify by reading the world matrix, not by looking at a
picture.** Every claim in 7.1-7.2 above is backed by a number from the transform,
which is what the GPU is given, and those numbers are unambiguous.

### 7.4 The 0.409 m float was a test artifact, not a bug — and that matters

Pinning the wreck into the DOWN state to measure it also prevented `airY` from
integrating down (`_stepFalling` is the only place the hop lands), so the body
was frozen mid-hop at **0.409 m** and the bike matched it. Two lessons:

1. **A state-pinned measurement measures the pin.** The same number appeared on
   both bodies, which should have been the tell — two independent objects do not
   share a floor by coincidence.
2. The correction code compares the box floor against
   `player.group.position.y`, which *includes* `airY` and is therefore the right
   reference: it asks "is this body resting on the surface it is above", not "is
   it at road height". That is why it correctly did nothing while the body was
   legitimately airborne.

**Re-measured with the sequence free-running (354 samples across all five
states):**

| check | result |
|---|---|
| `airY` decay over the fall | 0.478 → 0.403 → 0.066 → 0 (lands correctly) |
| states visited | FALLING, DOWN, STANDING, MOUNTING, RIDING |
| **prone gap on the road, all DOWN frames** | **0.000 (7/7)** |

So the rider now lies flat on the tarmac through the whole prone beat, and gets
up, walks, and remounts.

---

## §8 SEATING, ROAD CONTACT, AND THE DEAD-JOINT CLASS

### 8.1 The bike's joint map was dead — nothing on the machine moved

`player.js` and `rivals.js` built their bikes with a bare `assets.bike.clone()`.
`Object3D.clone` copies `userData` as plain data, so the asset's six live
`Object3D` joints arrived as six plain `Object`s with no `.rotation`. The first
joint write in `applyVisual` threw:

```
TypeError: Cannot set properties of undefined (setting 'y')
    at j.frontSteer.rotation.y = p.steer * 0.30
```

Everything after it — **steer, wheel spin, the lean, the wheelie, the suspension
dive** — silently never ran. Nothing threw out of the game loop, the bike
rendered correctly, and a still frame of a bike at 100 mph looks identical either
way.

**Fix:** `cloneWithJoints` (which re-points the joint map at the clone's own
nodes by tree path) for the bike as well as the rider, and guard the joint writes
on `.rotation` so one bad node cannot kill the pose below it.

**MEASURED, before → after:**

| channel | before | after |
|---|---|---|
| `frontSteer` joint | plain Object (throws) | **Object3D** |
| `bike.rotation.z` (lean) | `0.0000` always | **0.15 .. 0.52 rad** |
| `bike.rotation.x` (pitch) | `0.0000` always | **-0.65 .. +0.25** |
| braking pitch | dead | **-0.03 .. +0.42** (dive) |
| `frontSteer.rotation.y` | dead | **-0.30** (bars turn) |
| `frontWheel.rotation.x` | dead | **0 .. 206 rad** (wheels roll) |

A related, separate break: `dismount.js` did `bike.rotation.set(0, yaw, 0)` with
no Euler-order argument, which **resets the order to XYZ** on every remount and
silently undid the order `player.js` establishes.

### 8.2 Euler order on the bike

The bike carried yaw, pitch and roll while still on the default `XYZ`, so roll
was applied first in world axes and the pitch axis left the machine's own
centreline — the machine tipped but never nosed. Now explicit `YXZ` on the bike
as well as the group (the group already had it).

### 8.3 The suspension was computed and never drawn

`suspFront` / `suspRear` are metres of compression, integrated as a damped spring
every physics step — and were read by nothing. The machine was a rigid slab that
ignored its own suspension, which is exactly what "only can tilt, not real
dynamics" describes. Pitch is now three real effects summed: road pitch (group),
wheelie/stoppie (weight transfer), and **suspension squat/dive**
(`atan2(suspRear - suspFront, WHEELBASE)`).

### 8.4 THE SEATING DEFECT — the socket counter-scale

The socket carried the bike's inverse scale (1.117) to "protect the rider's own
scale". The premise was stale: the rider is loaded with **no height** and sits at
scale 1.000, so there was no second scale to protect, and the counter-scale had
nothing to cancel. What it did was multiply **every internal offset of the
rider** by 1.117.

**MEASURED in the bike frame:** pelvis at y **1.193** with the saddle top at
0.875; shoulders at **1.79** with the bars at 1.04. The rider floated 32 cm above
his own saddle, and his arms could not reach the grips — closest approach
**1.06 m** against an arm **0.58 m** long. That is why no set of joint angles
could look right.

**Fix:** no counter-scale; seat offset in bike-local units (the units a child
position already means).

### 8.5 `seatContactY` was measuring the wrong thing

It was `hipY - pelvisH/2` — the pelvis *underside* of a flat box. The rig is
**posed**, so the pelvis is tilted with the torso. Measured by parking the socket
at the bike origin: the pelvis joint lands at **0.8435 m** for a 1.75 m body, i.e.
`hipY`. Now `seatContactY = hipY`.

### 8.6 The seat was 23 cm too far forward and 7 cm too low

`CFG.SEAT_*` were `(0, 0.78, -0.05)`. The actual saddle slab in `assets/bike.js`
is `BoxGeometry(0.29, 0.06, 0.44)` at `(0, 0.845, -0.28)`. The rider had been
sitting on the **tank** with the whole tail of the machine empty behind him —
which is exactly what a side elevation showed, and what no scalar test caught
because every number was self-consistent.

`SEAT_Z` also needed to be the **front of the saddle** (−0.20), not its centre:
at the centre the shoulder sits 0.50 m behind the bike origin and the grips are
0.98 m away.

**FINAL, all six riders identical:**

| check | result |
|---|---|
| pelvis in bike frame | **0.8785** (saddle 0.875 → **3.5 mm**) |
| spread across player + 5 rivals | **0.0000** |

### 8.7 OPEN — the arms are ~0.2 m short of the grips

Sweeping the shoulder rotation and reading the FIST position in the bike frame
(`harness/_armframe.mjs`), the closest the hand gets is **0.226 m** from the grip.
Arm (upper + fore + hand) is **0.770 m**; shoulder-to-grip is **~0.98 m**.

More torso lean makes it **worse**, not better (measured across −0.50 … −1.30:
residual 0.226 → 0.391), because the torso pivots at the hips while the bars are
forward of them.

The arm lift was changed from **−1.26** (which threw the arms up and back over the
shoulders) to the measured best **−0.60**, which points them forward and down at
the bars. The residual is a **spec or layout decision**: lengthen the arm, move
the grips, or accept the gap. Not changed silently.

### 8.8 Roster cut to 5

`CFG.RIVAL_COUNT: 14 → 5` (player + 5 = 6). Fifteen rigs down to six in the scene
graph.

### 8.9 Showroom built and wired

`src/showroom.js` — a character designer that is also the maths read-out: live
figure on a measured 1 m grid, orthographic so heights compare honestly, with the
derived body dimensions printed underneath (`trunk 0.504 / arm 0.581 / leg 0.859 /
shoulder 1.431 / hip 0.840 / seat 0.531`). Panel: stature, build, shoulders,
limbs, four colour rows, and pose.

Defects found and fixed in it: bare `.clone()` (same dead-joint class as 8.1), a
one-pixel scissor from measuring while `display:none`, framing that cropped the
subject (now **measures the assembled rig** and fits), and **three copies of the
seat formula** — one of which had already drifted.

## §9 — The pose, solved rather than tuned

### 9.1 The problem stated correctly

The seated pose is **six coupled unknowns** (`SEAT_Z`, `torso`, `upper`, `elbow`,
`hip`, `knee`) and **four contacts** (pelvis→saddle, fist→grip ×2, sole→peg ×2).
Eight hours of this session were spent fixing them one at a time with a live
sweep per question, and every fix invalidated the previous one:

    leg angle → seat height → arm reach → seat Z → leg angle again

That loop cannot converge, because the quantities are coupled. It is the
signature of a missing **solver**, not of bad numbers. The step back was to build
the solver (`harness/_solvepose.mjs`): one browser, one loop, iterate to a fixed
point, anatomy gate on the leg branch, `--write` patches the source so no number
is transcribed by hand.

**Result at 1.75 m, verified in-game in the static state:**

| contact         | residual | note                                             |
|-----------------|----------|--------------------------------------------------|
| pelvis → saddle | 0.000 m  | `(0, 0.873, -0.28)` vs slab `(0, 0.875, -0.28)`   |
| fist → grip     | 0.0025 m | 2.5 mm                                            |
| sole → peg      | 0.0546 m | structural: boot ~3 cm inboard of the peg         |
| knee below hip  | yes      | 0.794 < 0.832                                     |

Written: `torso 0.30`, `upperArm -1.04`, `splay 0.13`, `elbow -0.32`,
`hip 1.48`, `knee -2.34`, `hipSplay 0.16`, `SEAT_Z 0.056`.

### 9.2 The two root causes

**DOUBLE NORMALISATION.** `assets/rider.js` centres the rig so its feet are at
y = 0, and then `assetlib.js` centred it AGAIN with `merged.position.y =
-box.min.y` — measured in whatever pose the asset was left in, which for a rider
is the racing crouch, where the lowest point is the PELVIS and not a boot. So the
second normalisation subtracted a number that meant nothing and dropped the whole
body **0.62 m below the saddle**, with the boots near the road. Fixed with a
`userData.grounded` contract: an asset that has measured itself declares it and
the loader does not re-normalise.

The rider's own normalisation ALSO had to change: it measured itself in the
riding pose, so the folded racing leg pulled the origin up and the shift collapsed
to 0.245 instead of 0.84. It now measures in a **neutral, legs-down pose**, so a
change to the riding pose can no longer move the origin. A normalisation that
depends on the pose is not a normalisation, it is a second hidden pose.

**THREE COPIES OF THE POSE.** `player.js`, `showroom.js` and `assets/rider.js`
each held their own literals, and they had already drifted. Now one table in
`src/reach.js`; the asset may not import (asset-contract.md:22), so the table is
handed in as `opts.ride`, exactly as the spec is handed in as `opts.spec`.

### 9.3 Bugs found in the showroom along the way

- **Stacking clones.** `rebuildBody` did `this.turn.remove(this.body)`, but once
  the bike exists the body is parented to `this.socket`, so `remove` matched
  nothing and returned false. Every slider change STACKED another figure.
  `Object3D.remove` does not fail loudly on a non-child. Fixed by removing from
  `.parent`. MEASURED: 141 meshes before and after ten randomises, constant.
- **`this.spec = p = rebuild(next)`** — an assignment to an undeclared `p`.
  Works in a sloppy script, throws in a module. Any showroom edit crashed.
- **`onClose` was never assigned.** `close()` called `this.onClose(this.spec)`
  and nothing ever set it, so DONE did nothing: no rebuild, no save.
- **`set({ build: key })` did nothing**, because `rebuild` read `buildName` while
  the patch sets `build` (and `buildScale` then won inside makeSpec).
- **Stale asset.** The showroom held the first `assets.rider` forever, so a second
  visit rendered the first body. It now takes the live asset on `open()`.

### 9.4 The designed rider persists

`career.setRider()` stores the four slider inputs plus colours, validated on read
the same way the rest of the save is. On boot, `makeSpec` re-derives the whole
body from those four, so the save cannot disagree with the body. MEASURED round
trip: design `1.93 m / heavy / shoulders 1.17 / limbs 1.09 / red helmet` → saved
→ reloaded → **built into the game** (trunk 0.606, vs 0.504 for the default).

### 9.5 Harness hygiene

245 one-off probes were written this session. They are archived under
`harness/probes/` with a README; six earned a permanent place. Puppeteer was
orphaning a temp Chrome profile per run (~150 MB across the session, on a disk
with 1.5 GB free), so every probe now launches through `harness/_launch.mjs`,
which reuses one root directory and removes its profile on close.

### 9.6 Gate

All checks passed: throttle, steering, hits, knockdown/remount, camera clamp,
**draws 673 / 900**, tris 214k, fps reported 3.5. No page errors.

---

## 10. Friction: the bike was on ice, and the number proved it

### 10.1 The report, and why it was worth taking seriously

"it looks like theres ice right now and its sliding on tyres". That is a
subjective-sounding complaint about a *feel*, and the temptation is to answer it
with a tuning nudge. It was not a feel problem. It was a measurable, structural
omission, and the arithmetic below is what says so.

### 10.2 The measurement

`harness/_icetest.mjs` holds full lock one way for 1.5 s, then the other, then
releases everything, sampling the integrator every 250 ms. The baseline:

| phase | `lateralV` | `lateral` |
|---|---|---|
| full lock right | 0.17 → 6.43 m/s | 0.01 → 4.11 m |
| full lock left | 5.36 → −6.90 m/s | 6.62 → 1.71 m |
| **bars released** | **−8.06 → −3.85 m/s** | keeps sliding |

The bike is carrying **eight metres per second of pure sideways velocity** more
than a second after the rider let go of the bars. At 30 m/s that is a slip angle
of about 15 degrees, sustained. That is ice, and it was not a tuning error -- it
was three separate pieces of a tyre model that were simply absent.

### 10.3 The diagnosis: this is a lightly-damped oscillator, not a slide

Linearising the model about zero slip at 30 m/s:

```
wn = 1.78 rad/s     zeta = 0.25     settling time 8.9 s
```

ζ = 0.25 is a wallowing spring, and 8.9 s is the wallow. A real motorcycle
settles a lane change in 0.3-0.5 s, which needs ζ ≥ 0.7. Three causes, each
standard in every serious tyre model and each missing here:

1. **NO TYRE DAMPING.** A tyre is rubber: it dissipates energy as the carcass
   deforms, and in a real model that damping is what stops the contact patch
   oscillating. The only lateral damping in the whole vehicle was
   `PHYS.LATERAL_DAMP = 0.90/s`, a *chassis* term, doing a job it cannot do.
2. **THE PEAK SLIP ANGLE WAS FAR TOO LOW.** `TYRE_SLIP_PEAK = 0.14 rad` (8°), and
   past the peak the force curve *falls* (`TYRE_SLIP_FALLOFF`). So sliding harder
   produced less grip -- negative damping in exactly the regime that needs grip.
   The cornering stiffness was 9.6x load/rad, unrealistically stiff and therefore
   violently saturating.
3. **THE FRICTION CIRCLE WAS COMPUTED AND THROWN AWAY.** `gripDemand` and
   `gripCircleHeadroom` were published every step with a comment saying they were
   "deliberately NOT yet applied ... wiring it in is a separate, measured
   decision". This is that measurement. A tyre has one grip budget; without the
   circle, cornering force was bounded by nothing.

### 10.4 The fix, and what it measured

- `TYRE_LATERAL_DAMP` (new, 0.28): a slip-rate damper scaled by load and by the
  relaxation length -- the standard formulation, and the term that brings ζ up.
- `TYRE_SLIP_PEAK` 0.14 → 0.22 rad; cornering stiffness now 6.1x load/rad, in the
  real range for a motorcycle tyre.
- The friction circle is now applied to the side force (`gripCircleHeadroom`,
  floored at 0.15 so a limit corner understeers rather than snapping).
- `LATERAL_DAMP` 0.90 → 0.35, demoted to a small chassis term now that the TYRE
  is what makes the grip.

MEASURED after, same probe:

| | before | after |
|---|---|---|
| peak `lateralV` in a lane change | **8.06 m/s** | **0.32 m/s** |
| `lateral` excursion | 4.1 → 5.5 m sliding | 0.03 → 0.25 m tracking |
| speed retained through the manoeuvre | 43 → 26 m/s | 41 → 46 m/s |

And the lateral mode, by the same linearisation: ζ = **0.60-1.69** across 6-48
m/s, settling in about 1.5 s in the linear model and faster in practice. A
full-lock corner now holds a steady 0.60 rad of heading from 18 to 32 m/s with
`gripDemand` pinned at 1.00 -- a grip-limited corner, honestly reported.

### 10.5 The knock-on: the gate was measuring the wrong thing

With the bike gripping instead of sliding, the steering check FAILED: "steering
changed lateral by only 0.32 m". But lateral offset is a *terrible* test of
steering -- it is large when the bike SLIDES and small when it GRIPS, so the
check failed on an improvement. MEASURED: 1.5 s of full lock gives 0.39 m of
lateral travel but **35.9 degrees of heading change**. The gate now asserts
heading (bar 0.20 rad), which is what cornering actually is.

### 10.6 Combat: an arc that could not see the fight

The gate then failed with ZERO hits over 120 s. Instrumenting a real alongside
pass (`harness/_combatdiag.mjs`) showed the player at **1.58 m** from a rival with
an attack active, and the target at **73-131 degrees off the nose** -- while
`PUNCH_ARC` was `±0.95 rad` (54°) of FORWARD. The design of this game is the
roadside brawl: you pull ALONGSIDE and swing. The AI already commits from 3.2 m
of lateral offset, so it was attacking from a place its own arc test rejects.

Fixed by widening the arcs to reach the flank (punch 1.85 rad, kick 1.70, chain
2.30), raising the ranges to match the alongside window, and replacing the
redundant `range * 1.2` longitudinal gate with the same 2.2 m the AI uses.
MEASURED: 4 hits with a closest approach of 1.44 m.

### 10.7 The gate

All checks passed.

```
ok   throttle advanced 327.4 m in 5.0 s of game time, peak 45.3 m/s
ok   steer turned 41.8 deg of heading, lateral -0.8 m, in 1.5 s
ok   4 hits landed (closest approach 1.44 m)
ok   player knocked down in window: false, remounted: false
ok   camera roll within clamp (-0.160 rad, limit 0.45)
ok   draws 398 / 900, tris 195,874 / 1,500,000
ok   fps reported 3.6, measured 4.0
```

---

## 11. The tyre model was the wrong KIND of model

The user's verdict on §10 was "look online for the correct formula and model
this is wrong", and that was the right call. §10 had built a *plausible-looking*
curve — ramp up to a peak, fall away after it — and a sliding-mode damper bolted
on beside it. It passed its own measurements (§10.7) and it was still the wrong
species of model, in three specific ways that each had to be diagnosed
separately.

### 11.1 A piecewise-LINEAR curve is a kink, and a kink is a stiffness jump

The §10 curve was two straight lines meeting at the peak. It had the right
qualitative shape (rise, peak, fall) and it was wrong at the one point that
matters. Cornering stiffness is the *derivative* of side force with respect to
slip angle, and it is what the entire lateral dynamics are made of. A straight
ramp meeting a straight falloff has a **discontinuity in that derivative**: at
the exact moment a rider probes the limit, the model's stiffness jumps from
positive to negative. The bike snaps instead of going progressively loose, and no
amount of tuning removes it because it is the *shape* of the curve.

Pacejka's Magic Formula, which is what the reference (racer.nl, and Pacejka's own
book) gives:

```
y(x) = D · sin{ C · arctan[ B·x − E·(B·x − arctan(B·x)) ] }
```

It is smooth everywhere, and each factor does one job:

| | what it is | what it controls |
|---|---|---|
| `D` | peak value | the friction coefficient, `mu = D/load` |
| `C` | shape factor | where the peak sits, how the curve leaves the origin |
| `B` | stiffness factor | **zero-slip cornering stiffness is exactly `mu·C·B`** |
| `E` | curvature factor | rounds the peak so the slide is progressive |

**The first attempt at this was still wrong, and the probe caught it.** Setting
`B` from the stiffness (`B = C_slip/C`) while also *choosing* `C = 1.30` and
`E = 0.97` gave a curve with **no usable peak at all**: it was still rising at
52°, so force never fell away past the limit and the tyre got *better* the harder
it slid — negative damping, the exact instability the rewrite existed to remove.
Measured with `_tyreshape.mjs`: peak slip 51.6° against a published 12.6°.

The insight is that **`C` is not free**. For a 12.6° peak with a real cornering
stiffness, the shape only closes for `C >= ~1.6`. With `C = 1.6`:

```
B = C_slip / (mu · C)          = 11.5 / (1.35 · 1.6) = 5.32
u* = B · peakSlip              = 1.171
E = (u* − tan(pi/2C))/(u* − atan u*)  = −1.059
```

`E` comes out **negative**. That is correct, not a bug: a peak this late with a
stiffness this low has a very round shoulder, and negative `E` is how the Magic
Formula expresses a rounder-than-baseline approach. It sits outside the 0..1 band
that gets quoted, so the harness asserts the *shape that matters* — monotone
rise, peak at the published slip, gentle falloff — rather than `E`'s sign.

The final curve, verified in `_tyreshape.mjs`:

```
slip(deg)   Fy/load
    0.0      0.0000
    4.0      0.7542
    8.0      1.2213
   12.6      1.3500   <- peak, at the published slip
   20.0      1.2576
   45.0      1.0136   <- still ~75% of peak when fully sideways
```

and smoothness proved *by refinement* — halving the step divides the second
difference by **4.00**, which is what convergence looks like. The old curve does
not converge; it is a kink.

### 11.2 The friction circle was circular

§10 applied the circle as `sideForce *= sqrt(1 − gripDemand²)`, where
`gripDemand` is `|v·yawRate|/g` — **derived from the side force itself**. So the
side force's clamp depended on the side force. It was stable only because
`gripDemand` is read one step stale, and a feedback loop that needs a delay to
stay stable is not a physical constraint. It was also measuring the wrong axis:
`gripDemand` is a lateral-g fraction, while the friction circle is about
**longitudinal** force.

The reference gives the correct simple combination, to use when there are no
full combined-slip coefficients:

```
Fy = Fy0 · sqrt(1 − (Fx / Fx0)²)
```

with `Fx` the *actual* longitudinal force at the contact patch and `Fx0 = mu·load`
its maximum. So a new `FxTyre` is tracked through the longitudinal block —
engine, brake and boost, and deliberately **not** aero drag or rolling
resistance, which act on the body through the air and the bearings rather than
through the rubber. `_frcircle.mjs` asserts the identity, its limits, and (by
reading the source) that the block is driven by `FxTyre` and never mentions
`gripDemand` again.

The behaviour that falls out, measured in `_gripbudget.mjs`:

```
tag           v(m/s)  rev   headroom
start           1.5   0.03      1.000
throttle+2     22.4   0.56      0.779
throttle+4     36.8   0.84      0.869
throttle+8     45.1   1.00      0.959
coast+3        34.4   0.67      1.000
```

Coasting leaves the whole circle; full throttle costs 4–22% of it depending on
speed. That is trail-braking and power-slide behaviour, which the game is about,
and it never parks on the 0.15 floor.

### 11.3 THE REAL ICE: the tyre force and the heading were decoupled

This is the one that mattered, and neither of the first two fixes touched it.
With a correct smooth curve and a correct friction circle, a lane change *still*
did not settle. `_lanesettle.mjs` was written to measure the right quantity —
not peak lateral velocity (a hard lane change should carry some) but the
**decay ratio** once the bars centre:

```
BEFORE (curve and circle fixed, slide still unfixed):
  peak |latV| = 2.33 m/s
  latV at release = 2.07 m/s, at end = 1.03 m/s
  decay ratio = 0.496          <- half the slide survives
  settle below 0.5 m/s: NEVER
```

The trace shows why. During settle, `lean` returns to **0** and `yawOffset`
decays to zero, while `latV` stays at 2.3 m/s. The bike is upright, capable of
60 m/s² of tyre force, and carrying a two-metre-per-second slide **for seconds**.
The diagnosis is arithmetic: `slip = yawOffset − atan2(latV, fwdV)`, so with
`yawOffset ≈ 0` and `latV = 2.3`, the slip is ≈ 3° and *shrinking* — the tyre
has almost nothing to push against because there is no heading error any more,
and the residual lateral velocity can only be killed by the `LATERAL_DAMP`
chassis term, which is 0.35/s.

**Everything that turns the bike was kinematic.** `targetYawRate` is a function
of the bars, the lean and the speed — it does not know the bike is sliding. The
side force changed `lateralV` and nothing else. So the heading could return to
zero while the velocity vector stayed pointed 3° off, and nothing connected them.

On a real motorcycle the rear tyre's side force acts *behind* the centre of mass,
at the wheelbase, so it **turns** the bike. That is the mechanism by which a
sliding bike recovers, and it was not in the model. The fix adds it as a yaw-rate
term, derived twice because this is where sign errors live:

```
M_z = r × F,  with r = −a·x̂ (behind the CG) and F = +F·ŷ (to the right)
    = r_x·F_y = −a·F
so    slideYaw = −slipRear · SLIDE_YAW_GAIN     (NEGATIVE)
```

Cross-checked against the existing lateral force, which already treats positive
slip as force to the right — the two agree. It fades to nothing when the bike is
not sliding, so a straight line and a steady corner are unchanged.

```
AFTER:
  peak |latV| = 2.01 m/s
  latV at release = 1.96 m/s, at end = 0.072 m/s
  decay ratio = 0.037          <- the slide dies
  settle below 0.5 m/s: 2.00 s
```

And the trace now shows the relationship a real bike has: `yawOffset` **tracks**
`lateralV` (peaking together at 0.227 / 2.01) instead of diverging, then both
decay in lockstep to zero. Before the fix `yawOffset` went to −0.446 while `latV`
was −2.3 — heading and velocity in *opposite* senses, which is a spin, not a
corner.

### 11.4 Why the gate passed both times

The gate's steering check measures **heading change**, and the kinematic steering
model has always changed the heading on demand. The ice was never a steering
failure; it was a *velocity-vector* failure. The gate is a smoke test and it is
honest about that — `_lanesettle.mjs` is the probe for this, and it is now a
permanent regression diagnostic.

### 11.5 The gate

All checks passed (`/tmp/gate-tyre2.log`):

```
ok   throttle advanced 327.4 m in 5.0 s of game time, peak 45.3 m/s
ok   steer turned 14.3 deg of heading, lateral -2.2 m, in 1.5 s of game time
ok   5 hits landed (32 punches, 32 kicks, 32 chains thrown, closest approach 1.15 m)
ok   1 knockdown(s)
ok   player knocked down in window: false, remounted: false
ok   camera roll within clamp (0.113 rad, limit 0.45)
ok   draws 248 / 900, tris 185,774 / 1,500,000
ok   fps reported 4.4, measured 4.8
```

### 11.6 What is still ad-hoc, and the next thing to replace

`TYRE_LATERAL_DAMP` (§10) is still in the model, and it is still a slip-rate
damper with a hand-picked coefficient. Now that the yaw coupling exists, it is
worth re-measuring whether it is carrying any load at all — it may be a
left-over, or it may still be the difference between 2 s and 3 s of settle. The
physically-derived replacement is the carcass relaxation already parameterised by
`TYRE_RELAX`, whose time constant is set by the relaxation length; the damper
should be the *derivative* term of that same lag rather than a separate constant.
Also not yet modelled: **camber thrust**, which on a motorcycle supplies a large
share of cornering force and is the reason a bike can corner with the bars nearly
straight.

---

## §12 — Camber thrust, the Lean verification layer, and two corrections

### 12.1 Camber thrust: implemented, and got wrong TWICE before right

The gap §11.6 left open. On a motorcycle camber thrust can be the **largest**
contributor to cornering force, and for a tyre leaned over with the bars straight
it is the **sole** contributor — it is why a bike holds a car's cornering radius
with a much smaller steering angle. The model had none of it.

`src/physics.js` now computes it in step 3, alongside the slip force:

    Fcamber = sign(lean) * CAMBER_STIFF * loadN * grip * |lean| * fade * circle

with three properties taken directly from the sources (Foale/Cossalter/Pacejka, via
the camber-thrust literature):

1. **Linear in camber angle** for small angles — so the law is `STIFF * |lean|`.
   On a bike the camber angle IS the lean angle.
2. **No relaxation length** — it reaches steady value "nearly instantaneously",
   so it is evaluated from `this.lean` DIRECTLY and deliberately does NOT go
   through the `slipFront`/`slipRear` relaxation lag.
3. **It is side force**, so it is scaled by the same friction-circle `circle` and
   does not get a private budget.

**The magnitude was wrong twice, and both errors were algebraic.**

- Attempt 1 hand-typed `CAMBER_STIFF: 5.0`, reasoning it looked like "a third to
  a half of the cornering stiffness" (11.5). It produced **12017 N/rad**: at
  0.72 rad of lean that is 8652 N of side force against a **2403 N** vertical
  load — 3.6× the load, and more than 3× the entire centripetal force the corner
  needs. It was a real force in the velocity update, so it would have thrown the
  bike at the inside of every corner. MEASURED: `_camberverify.mjs` now catches
  exactly this (`0.27 of the 2108 N required`).
- Attempt 2 derived it but kept `MASS * g / TYRE_LAT_PEAK`, forgetting that the
  force term already multiplies by `loadN = MASS * g`, so the mass appears twice.
  Same order of magnitude, different algebra.

The correct derivation, now in the source: setting the force equal to the share
of the cornering requirement `MASS * g * tan(lean)` at the reference lean, **the
mass cancels exactly**:

    CAMBER_STIFF = CAMBER_SHARE * tan(CAMBER_REF_LEAN) / CAMBER_REF_LEAN

which is `0.492` — dimensionless-ish, order 0.5, and it says what it should: at
the reference lean camber supplies ~45% of the cornering force, realised as
**0.27 of the requirement at 0.72 rad** (the fade takes the rest) and **never
more than 0.18 of the friction budget**. No `mu` appears either, for the same
reason: `grip` is applied once.

`harness/_camberverify.mjs` (new) asserts direction (right→+, left→−), symmetry,
that the force is a FRACTION of the requirement and inside the budget — the two
assertions that would have caught 5.0 — and that it is an INSTANT function of
lean (0.0% spread of `camberForce/lean` through the linear region while slip is
still settling). All pass.

### 12.2 Camber broke the combat stage, and the fix is the physical one

With camber at its correct strength the gate dropped from **4 hits / 1 knockdown**
to **2 hits / none**, closest approach 1.05 m → 1.71 m. Attribution confirmed by
running the gate with `CAMBER_SHARE: 0`, which restored 4 hits exactly.

The cause is sound and not a defect in camber: camber now supplies turn-in the
kinematic bicycle model was already providing, so the two together over-turn and
the player overshoots the pack. The physically correct response is to make the
bicycle relation deliver LESS yaw once camber exists — which is *precisely the
real-world effect* camber has. `BICYCLE_GAIN` went 1.0 → 0.75 → 0.55 → **0.65**,
the last value chosen because it is the only one satisfying BOTH gate constraints
at once (steering ≥ 11.5°, combat ≥ 4 hits). Measured at 0.65: **11.8° steering,
4 hits, 1 knockdown, 1.10 m**. Everything but the draw budget passes.

### 12.3 TWO CORRECTIONS — I was wrong about draw calls, twice

Worth recording plainly, because both were confident and both were wrong.

**Correction 1: "the 248-vs-933 flip is a sampling bug."** I asserted the gate's
single-snapshot draw read was luck. I changed the gate to sample the peak over a
2.5 s window. That was a genuine improvement to the *measurement*, but the
conclusion I drew from it was wrong: the peak really is ~930, and 248 is the
outlier (a frame when the pack was culled). The gate was not flaky; it was
sampling an unlucky frame, and the honest peak is above the tripwire.

**Correction 2: "the peak is the 900 m rival cull distance."** I reasoned that
five rivals inside 900 m cost ~680 draws and cut `RIVAL_CULL_FAR` to 520. Draws
did not move. Measured directly (**`_draws.mjs`**): each rival group is **141
meshes**, and during the combat stage all six vehicles are close, so culling can
never help the *peak*. The 900 m number was a real inefficiency but not the
mechanism.

**The actual mechanism, measured:** 111 of a rider's 141 meshes were unmerged
detail primitives, and `mergeJoints` had only ever been called on the BIKE, never
the rider. Merging the rider is now done in both `player.js` and `rivals.js`
(rider subtree 141 → **37** meshes, articulation preserved because `mergeJoints`
only bundles direct mesh children of `__part__` joints). That alone was not
enough, because the merge buckets by MATERIAL and a joint with six materials
keeps six meshes.

**And the real multiplier, found last:** the 971 is a **scene + shadow** budget
(`_captureStats` in `postfx.js`). Every mesh that casts costs TWICE. `player.js`
set `castShadow = true` on every mesh in the group, so ~50 meshes per vehicle
were paying a second time in the shadow pass. Casting is now limited by
bounding-sphere radius (`SHADOW_CAST_MIN_RADIUS = 0.22`): bodywork, wheels and
limbs still cast; brake discs, grips and footpegs — sub-pixel smudges at race
speed — no longer do. `receiveShadow` stays on everything, since receiving is a
free shader term.

### 12.4 The Lean 4 verification layer

A formal companion to the physics core now lives at
`404-game-recipe/verify/RideRashProof/`, with a full write-up in
`verify/README.md`. **Nothing ships**; it is a sibling of the harness, outside the
one-folder game, exactly as the asset contract requires.

**20 theorems, zero `sorry`.** Toolchain: Lean 4.34.0 + Mathlib via `elan`, built
in `~/.elan`. Build with `lake build`; the routine check is
`node harness/_leanconform.mjs`.

What it proves, and — more importantly — what it does NOT:

| Established by PROOF | Established by MEASUREMENT | EMPIRICAL, unprovable |
| --- | --- | --- |
| friction circle ≤ 1 | no kink at the tyre peak | `TYRE_LAT_PEAK 1.35` |
| friction circle is not circular | the coupling that caused the ice bug | `CAMBER_SHARE 0.45` |
| more Fx ⇒ less side headroom | every feel property | `BICYCLE_GAIN 0.65` |
| camber sign matches lean | | the 12.6° peak slip |
| camber is odd / symmetric | | |
| camber ≤ share of the requirement | | |
| camber has no relaxation lag | | |
| tyre force zero at zero slip | | |
| tyre force continuous and odd | | |
| tyre force ≤ friction limit | | |

The divide is the honest part of the deliverable. A prover bought us the friction
circle and the sign/shape invariants; it bought **nothing** for the coupling bug
(that needs a running bike), for feel, or for the constants. That is the correct
expectation for applying proofs to a game, and §11's three bugs map onto it
exactly: the circular friction circle was provable, the inverted lean sign was
provable *as an oddness property*, and the decoupled tyre/heading bug was not.

**The conformance check is the load-bearing piece.** Lean cannot see
`src/physics.js` and the browser cannot see the proofs. `_leanconform.mjs` reads
the actual source, extracts every constant, and fails on drift — and also guards
two *structural* regressions: that `CAMBER_STIFF` stays DERIVED (not hand-typed
again, the 5.0 bug) and that the camber force keeps reading `this.lean` directly
(a relaxation lag would silently void the no-relaxation proof). Regexes over
source are brittle; that trade is deliberate and documented.

### 12.5 Operational notes

- **Disk:** `~/.cache` hit 9.9 GB early in this work and the volume reached
  286 MB free. The user cleared the caches. Mathlib needs 4–6 GB and would not
  have fit at that point; it fits now (~7 GB free) and is installed.
- **Installing Lean removed nothing, but clearing the caches DID remove Puppeteer's
  Chrome** (`~/.cache/puppeteer`). Every browser probe failed with
  `Could not find Chrome (ver. 152.0.7977.42)` until it was reinstalled with
  `npx puppeteer browsers install chrome@152.0.7977.42`. If the harness suddenly
  cannot launch a browser after any cache cleanup, this is why.
- **The game server on 9100 had died** and was restarted with
  `node harness/serve.mjs /Users/xavier/riderash 9100`. 8080 (`serve.py`) is the
  user's and was not touched.

---

## 13. The crash looked limp: a real launch, a hitstop, and a camera that lets go

The report was: *"the impact of the crash doesn't seem there, the body just
stays close to the bike and the connections are not right."* Along with it came
a confident diagnosis — the rider is still parented to the bike, and the two
share one velocity — plus a detailed proposal for a Verlet ragdoll.

### 13.1 The diagnosis was wrong, and measurably so

Both predictions were checked rather than assumed, because the code already
claimed to have handled each.

- **"Parented to the bike."** `dismount.js` has reparented through
  `Object3D.attach` for a while. Measured over a whole wreck: the rider was a
  descendant of the bike on **0 of 150 frames**.
- **"Sharing one velocity."** Rider and bike diverge to **17.2 m** within 2.3 s.
  The "under 1 m means parenting bug" tripwire the report proposed passes with
  4× headroom.

So the two named causes were both already fixed. This is the third time in this
project that a plausible-sounding report pointed at a mechanism the code had
already addressed, and the reason to measure before editing held again — a
ragdoll built to fix "the parent bug" would have been a large piece of work aimed
at a line of code that was already correct.

### 13.2 What was actually wrong

The separation was longitudinal only. **The body never left the road.**
`RIDER_HOP 2.1` against `RIDER_GRAVITY 15.0` gives an apogee of
`v²/2g = 0.147 m` and an airtime of `2v/g = 0.28 s` — the body is thrown fifteen
centimetres for a quarter of a second — and `airY` already starts at `0.35`, so
half of even that is spent before the first frame. Measured: `riderY` went
`-0.72 → -1.36` and stayed there for the entire fall. A 43 m/s wreck was producing
**zero air**. The wreck read as a man sliding along the tarmac in a tumble
costume, which is precisely "the body stays close, the impact is not there."

Note the two metrics that were being watched (separation, and impact-to-rest
time) were both **passing**. The number that should have been asserted — how far
the body rises above the road — was not measured at all.

### 13.3 The fix, in three layers

**Launch (`dismount.js`).** `RIDER_HOP` becomes `RIDER_HOP_MAX 5.5` /
`RIDER_HOP_MIN 1.6` and **scales with crash speed** against `RIDER_HOP_REF 32.0`.
At racing speed that is a ~1.0 m apogee (`v = sqrt(2·15·1.0) = 5.5`); at a
walking-pace knock it is a 9 cm stumble. The tumble spin scales with the same
factor. `RIDER_AIR_START 0.30` replaces the magic `0.35`. The gravity is
deliberately left at the heavy 15.0 so the higher hop still resolves inside
`FALL_TIME` — raising the hop without the gravity would push the wreck past the
3 s the eye tolerates.

Measured after: **launch height 1.50–1.54 m above the road, 1.05–1.4 s clear of
the bike**, and a 42 m/s wreck throws the body **+0.72 m** where a 7 m/s one moves
it **−0.13 m**. The crashes now look different from each other, which they never
did before.

**Hitstop (`main.js`).** A new `state.hitstop`, started in `hooks.onKnockDown`
(the one choke point every wreck passes through) and scaled by the target's speed
at impact: `0.05 + min(0.09, v·0.0022)`. The world runs at 12% speed while it is
positive. Two details worth keeping: the timer runs on **raw** time, not the
scaled `dt`, or a mechanism that slows its own clock would never expire; and it
scales to **0.12, not 0**, or the crash's own launch would freeze and the release
would snap the body.

**Camera (`main.js`).** A smoothed `crashHold` factor pulls the chase camera back
(`crashReach`) and stops it tracking the body (`crashLook`) during `FALLING`, then
eases back from `DOWN` onward. Road Rash's crash is memorable because the camera
holds the road while the body tumbles out of shot; ours was closing the gap for
the viewer even as the world opened it.

### 13.4 Verification

- `harness/_crashsep.mjs` (new) — separation, launch height, airtime, and the
  parented-frame count. Asserts the launch, which is the missing metric.
- `harness/_crashfeel.mjs` (new) — hitstop fires, and the launch scales with
  speed.
- `harness/_crashshot.mjs` (new) — four frames for the eye.
- **Gate: all checks passed.** steering 14.4°, 5 hits, 1 knockdown, peak draws
  **788/900** (the budget that was failing before now passes), peak tris 346,430.

### 13.5 Two harness traps, both paid for

- **A probe must trigger a mechanic the way the GAME does.** The first hitstop
  measurement read 0 while the feature worked, because the probe knocked with an
  empty `{}` hooks object and the freeze lives inside `hooks.onKnockDown`. The
  fix was to expose the game's real hook object as `window.__HOOKS__`. A probe
  that invents its own call path measures the probe.
- **A module-level expose block runs once, before per-frame state exists.**
  `window.__HOOKS__ = state.hooks` published `undefined` forever. A getter is
  required. Same class as the `__PLAYERPHYS__` is-a-value note.

### 13.6 What is still not right

The launch, the freeze and the camera now sell the impact. What does not yet read
as a *person* is the body itself: in the captured frames the rider lands as a
folded blue-grey lump, limbs gathered into the torso. That is the "the
connections are not right" half of the original report, and it is genuinely the
ragdoll piece — spring-driven limb targets over a Verlet skeleton, tense on
impact and limp on rest. It is a separate, larger job and it is on the backlog;
building it on a body that never left the ground would have been wasted, which is
why the launch came first.
