# RideRash — the claims a round can be failed on

Before building, write down what is actually true of a Road Rash frame, as statements a
machine could check. These turn "make it look better" into things that can be measured.

## Measured claims (from the reference set)

1. **The road is most of the frame and it is never flat grey.** 55–75% of a racing frame is
   asphalt, and it carries two distinct values: a dark body and lighter worn wheel tracks. A
   single-value road fails.

2. **There are always two colour temperatures in frame.** A warm key (the low sun, ~3400K feel)
   and a cool fill (sky bounce, ~7500K). A frame lit by one temperature fails as flat.

3. **The rider and bike are the brightest saturated thing in the frame.** The player's bodywork
   is the highest-chroma object in view. If the background foliage or a guard rail is more
   saturated than the hero bike, the frame fails.

4. **Speed is carried by the world, not by motion blur.** Rows of placed objects (posts, kerbs,
   barriers, trees) recede with visible gaps between them; the gaps get smaller with distance.
   A frame with no repeating roadside object cannot read as fast.

5. **Contact shadows couple objects to the ground.** Every bike, rider and prop sits in a
   shadow that touches its base. A prop that floats on an unlit patch of road fails.

6. **Silhouette reads at distance.** A bike+ rider at 40 m is legible as bike+rider from its
   outline alone — bars, helmet, tucked body. A blob fails.

7. **The pack is visible and countable.** In a racing frame 2–5 rival bikes are in frame,
   differentiated by bodywork colour, arranged along the road's perspective lines.

## Claims that a screenshot cannot check (motion-only)

8. The player can be knocked off the bike and can remount.
9. A punch thrown at a rival in range connects and moves that rival's position.
10. The chase camera does not roll with the ground under the wheels.

## The floor

A one-pass build of the same game, no loop, no critic, kept for comparison. Every round is
measured between the floor and the bar, never against a feeling.
---

## Round 3 — textures, dynamic sky, post-FX (measured)

Applied an Atlas image API to the level surfaces and the sky, and built a
post-processing chain. Measured against the reference frames at 1280x720 after
9 s of throttle:

| metric            | before | after | bar    |
|-------------------|--------|-------|--------|
| p98 luma          | 203    | 243   | 239    |
| pixels > luma 245 | 0.00%  | 1.43% | 1.1%   |
| high-saturation   | 0.9%   | 13.9% | 19%    |
| hero height frac  | broken | 0.343 | lower third |
| draw calls        | —      | 276   | 900    |
| triangles         | —      | 225k  | 1.5M   |

### What produced each move
- **+40 p98 and +1.4% above 245**: a float-target bloom pass with threshold 0.94.
  The threshold is the whole knob. 0.72 gave 9.6% above 245 (a wash over the sky);
  0.92 gave 0.37%; 0.94 lands at 1.43% against a bar of 1.1%.
- **+13 points of saturation**: a two-temperature grade after bloom — warm
  highlights, cool shadows, saturation lifted on the mid-tones only.
- **The sky**: two Atlas equirectangular panoramas blended live in a shader, so
  the race runs from golden hour into dusk.

### THE SEAM — six wrong theories, one real cause
A hard vertical line divided every frame, warm on one side and cool on the other.
I blamed, in order: the bloom pass, the texture content, the horizon remap, the
mip derivatives at the equirect branch cut, the branch cut itself, and the
rotation of the sky. All six were wrong. The sky shader, rendered entirely alone,
showed a maximum column-to-column delta of 3/765 — it was clean.

The cause was world geometry: `buildBackdrop` draws a 9.2 km wide, 44 m tall
cylinder with `BackSide` inside the sky dome, at 40 radial segments. Each facet
was 9 degrees wide, so the flat-shaded edges read as vertical bands, and its cool
grey material (`#8b98a4`) split the frame into a warm half and a cool half along
its own u-wrap. The lesson is the one already in traps.md and that I still walked
into: **when a defect is on screen, isolate what the suspect actually produces
before editing it.** Rendering the sky alone would have found this in one step.

### THE OTHER SILENT FAILURE
`applySurfaces()` clones each material and REPLACES `map`, `roughnessMap` and
`normalMap` with its own procedural surfaces. It ran after the level assigned
Atlas maps, so it silently discarded every generated texture — the road rendered
as flat tan although the material I had authored was near-black (`#3a3d42`). A
raycast at the road centre proved it: it hit the 1.15 m wheel-track material
instead of the deck, because the tracks were tinted LIGHTER than the deck.

### Surface tint rule
Every `texMaterial` defaults to `color: 0xffffff`, i.e. the raw generated image
at full brightness. Against a bright sky that made the whole midground one pale
tan. A generated colour map must be tinted DARK on top — asphalt at `#3a3d42`,
verge at `#6a6048`, concrete at `#6e6a63`. The map is grain; the tint is value.

## Round 3b — the dynamic world, and an UNRESOLVED occlusion bug

### What was built and measured
`src/worldspine.js` makes the world a FUNCTION OF DISTANCE: three maps
(`coastal` / `canyon` / `city`), six biomes, transitions eased over 170 m, a
slow within-sector drift so no biome is ever literally constant, and a rain
front that arrives over the last third and then LINGERS on the road after the
sky clears (wetness lags weather in both directions). Verified by driving the
spine directly over all three maps: sectors blend, rock density falls 1.00 →
0.13 crossing canyon→forest, and road roughness drops 0.59 → 0.28 as the road
wets.

`src/surfacedriver.js` re-drives the level's road materials from that state
every frame. Textures never change; only tint, roughness, metalness, normal
scale and env intensity. Seven Atlas images therefore produce six biomes.

### The material-name collapse (FIXED)
Almost every surface in `level.js` was named `ground` — the asphalt deck, the
wheel tracks, the shoulder, the markings, the tar patches, and the SEA. The
driver grouped by name, so it drove all of them to one road tint. `deck`,
`worn`, `shoulder`, `marking`, `patch`, `crack`, `sea` are now distinct names
and the driver names exactly which it drives.

### THE OCCLUSION BUG — still open, and honestly described
The frame's MID-BAND (roughly y 0.45–0.70 of screen height) still renders tan.

What is PROVEN:
  - Pixel samples at the BOTTOM of the frame (y 0.72–0.95) are dark asphalt:
    `#383c43`, `#212a36`, `#292e38`. The material and tint are correct.
  - A camera ray through the mid-band hits `deck` at every screen point tried,
    with the right dark colour and the right world height.
  - The deck mesh spans y −3.1 to +3.4 over a 7.2 km road; the camera sits at
    y 1.92; the player at y −0.22.

So the road is dark, is hit by rays, and is NOT what fills the mid-band. The
leading explanation is GEOMETRIC, not material: the verge ribbon is 27 m wide
and, at the chase camera's grazing pitch, its projected screen height in the
mid-band exceeds the road's. No tint change can fix a ribbon that is not the
road.

The measurement that would settle it, and that I did NOT run: project the deck
and verge ribbons to screen space at the real camera pitch and compare their
covered frame height. That is the next step, not another material edit. I
walked into this twice by editing the road when the evidence pointed at
everything except the road — the same mistake the sky-seam post-mortem records.

## Round 3c — the physics package

`src/physics.js` was already a real model (fixed step at 1/120 with an
accumulator, a torque curve, tyre slip curves with a peak and falloff,
counter-steer, off-road grip). Three things were missing to make it a package,
and all three are now in.

### 1. Longitudinal weight transfer
Load was hard-coded at 45/55 front/rear, so braking was a flat deceleration and
there was no mechanism for an endo or a rear-wheel spin-up. `longAccel` now
drives `loadFracFront/Rear` through `TRANSFER_GAIN`, and the tyre forces read
the shifted load. Measured: braking from 12 m/s takes `loadFracFront` from 0.42
to **0.87**; the front tyre therefore does most of the stopping, which is what a
bike actually does and why it dives.

### 2. Suspension
A damped spring at each end, driven by the weight transfer and by a
`surfaceInput` the road can supply. It is a real second-order system, so it
overshoots and settles rather than snapping. Measured `pose().pitch`: -0.161
under power (nose up), **+0.232 under brakes** (nose buried). This is what makes
the bike read as a machine reacting to the rider rather than a sprite.

### 3. Collision
`contact(other)` resolves bike-to-bike overlap as an IMPULSE keyed on the
closing velocity along the contact normal, so a side-by-side brush barely
interacts while a rear wheel into a front wheel is a real event. `hitRail()`
replaced the old positional clamp: the bike now slides along a wall and loses
speed in proportion to how square it hit. Measured: a 14.1 m/s T-bone threw the
victim 50 -> 35.5 m/s with a 2.26 rad/s yaw kick; a 14 s race logged **14
contacts and 6 landed hits**.

The contact pass runs AFTER every body has moved, against final positions, so a
pair is never left interpenetrating because one stepped first.

### A measurement trap worth recording
I wrote a test that called `phys.advance()` directly, got 82 m in 5 s, and
briefly believed I had broken acceleration (the gate wants 369 m). The physics
was fine: the direct-advance test omits the road-frame integration that the real
update path applies. **The gate, run afterwards, reported 369.3 m / 52.4 m/s
unchanged, all checks green.** Lesson: measure through the real entry point, or
you will "find" regressions that do not exist.

### Gate after the physics work
  ok  throttle 369.3 m in 5.0 s, peak 52.4 m/s
  ok  steer moved lateral 0.1 -> -1.3 m
  ok  7 hits landed in 14 s
  ok  1 knockdown
  ok  draws 315 / 900, tris 212,232 / 1,500,000
all checks passed.

## Round 3d — TWO bugs solved by one line

### The camera faced backward, and it was the road tangent all along
`centreTangent()` is the road's GEOMETRIC tangent, which points toward +z. But
the road is built toward NEGATIVE z (`s = -z`), so the direction of TRAVEL is the
opposite. `BikePhys.sync()` used the tangent as the bike's heading, so every bike
faced backward down the road — and the chase camera, which is placed relative to
that heading, sat in FRONT of the bike looking back down the road it had come
from.

Measured before: `dot(camForward, bikeForward)` was negative. After: **0.998**,
with the bike 8.13 m ahead of the camera and `bikeAheadOfCam` 0.972.

This also closes the "tan mid-band" investigation, and the lesson is expensive:
the road was never covered by the verge. The camera was pointed backward, so the
mid-band was the verge and the terrain BEHIND the rider. Every material edit I
made while chasing that was work on a surface that was already correct. The
diagnostic I should have run first was one dot product of the camera's forward
vector against the bike's, and it would have taken one minute instead of a
session. The raycasts kept saying "the road is right here" and they were right.

The tangent is left as-is and a new `headAt()` returns the direction of travel.
Callers that only need the tangent's NORMAL (`nx = -t.z, nz = t.x`) are
unaffected and keep using `centreTangent`; anything that must FACE down the road
(bike heading, camera, traffic, `yawAt`) now uses `headAt`.
