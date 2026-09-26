# RideRash — architecture and extension seams

**Read this to add content without editing the engine.**

Most of what a designer wants to change is **data in a table**, not code in a
loop. Where that is true it is listed below with the file and the shape. Where
it is not yet true, it is marked as such, honestly.

---

## The rule that shapes everything

`HANDOFF.md` §4.2. No imported meshes, ever. No texture files — surfaces are
generated at load from a seed. The two sky panoramas are the one declared
deviation. Generated audio is fine. One folder, no build step.

So **new content is new code and new numbers**, never new files. That sounds
like a constraint on content; in practice it is why every axis below is a table.

---

## Extension seams

| to add… | edit | shape |
|---|---|---|
| a **camera view** | `src/cameramodes.js` | one row of multipliers on the tuned chase values |
| a **fighting move** | `src/combat.js` `ATTACKS` | range, arc, damage, cooldown, stamina, animation name |
| the **motion** for a move | `src/motions.js` `MOTIONS` | keyframe table of joint deltas, 0..1 normalised time |
| a **biome** | `src/worldspine.js` `BIOMES` | road/verge tint, roughness, fog, haze, time of day, scenery mix |
| a **map** | `src/worldspine.js` `MAPS` | ordered list of `[biome, lengthMetres]` |
| a **surface** | `src/textures.js` `RR_RECIPES` | height field + shade + roughness functions |
| a **bike** | `src/career.js` `BIKES` | price and multipliers on `PHYS` |
| a **race** | `src/career.js` `SERIES` | map, purse, skill and aggro scaling |
| a **rider rig** | anything publishing `userData.joints` | see `src/riderpose.js` |
| **tuning** of anything | `src/config.js` `CFG`, `src/physics.js` `PHYS` | named constants, commented with what measured them |

**Not yet a seam, and it should be:** the camera *math* still lives in
`main.js` `updateCamera`. The table is extracted; the integrator is not.
`main.js` is ~1000 lines and remains the one module that knows about everything.

---

## Module map

### The world is a function of distance

```
worldspine.js   stateAt(s) -> road tint, roughness, verge, fog, haze, scenery mix
      |
      +-- surfacedriver.js   re-drives the level's materials every frame
      +-- sky.js             blends panoramas, derives the sun, builds the env
      +-- world.js           scenery density, town, traffic
```

`stateAt` is the **single source of truth** for "what does the world look like
here", which is why the road and the sky can never disagree. Every consumer
reads that one object.

### Surfaces are generated, never loaded

```
surfaces.js (harness)  plaster · stone · timber · tile · metal · fabric · foliage · ground
textures.js (game)     asphalt · scrub · kerb   + the six public names the level asks for
```

Albedo is a **tint multiplier**, not a colour — the material keeps its palette,
which is why one asphalt map serves a wet coast road and a dusty canyon one.
Roughness maps **multiply** `material.roughness`, so `texMaterial` divides the
requested value by the map's mean and stashes `roughGain` for the surface driver.

### Riders

```
assets/rider.js   publishes userData.joints (pelvis, torso, neck, head, arms, legs, chain)
      |
riderpose.js      ONE bone resolver + delta applier      <- player and rivals both use this
      |
motions.js        baked keyframe tables (MDM-generated, see HANDOFF §11)
```

`riderpose.js` exists because that resolver was written **twice** and the copies
had already drifted — one cleared the motion axes before posing and one did not,
which is the difference between a punch that returns to rest and one that winds
up over five seconds. **A new character works by publishing the same joint
names**, and every motion table applies to it for free.

### Physics

`physics.js` `BikePhys` is a fixed-step integrator (1/120 with an accumulator).
One class drives the player and all five rivals; the only per-instance
difference is `opts.arcade`, the player's steering assist.

**`reset()` restores the whole integrator.** Three separate per-race leaks were
found by one symptom — race 0 behaving differently from every race after it —
and the fix in each case was "reset the whole object, not a chosen subset".
See `HANDOFF.md` §5.16.

---

## Invariants — break these and something subtle goes wrong

1. **`centreTangent` points +z; travel is −z.** Use `headAt` for anything that
   must *face* down the road; use the tangent only for its normal, which is
   sign-invariant. (§3.4 — the most expensive lesson in the project.)
2. **`ROAD_Y_MIN` in `buildBackdrop` is derived from `centreAt`'s amplitudes.**
   Change the elevation, change it too, or the backdrop plane buries the whole
   road. (§5.9.)
3. **Rest pose before deltas, every frame.** `riderpose.clearAxes` first, or
   `rotation.z +=` compounds.
4. **Give every material a distinct `name`.** The surface driver and
   `bakeStatic` bucket by it. Naming the sea `ground` drove the ocean to the
   road tint. (§5.1.)
5. **Cache every material factory.** `bakeStatic` merges by material identity;
   uncached factories produced hundreds of identical materials and hundreds of
   draw calls. (§5.7.)
6. **A new gate assertion that waits must count *simulated* time.** `main.js`
   clamps frame delta to 0.05 s, so wall-clock waits measure almost nothing
   under the harness. (§5.11.)
7. **Run `_nondet.mjs` after any physics change**, including one you are sure is
   only an input aid. (§5.15.)

---

## Harness

Everything lives in `~/404-game-recipe/harness/` because puppeteer resolves
from there, not from the game folder.

| script | answers |
|---|---|
| `riderash-gate.mjs` | the real gate: throttle, steer, combat, camera, budget |
| `ship.mjs` | every module parses, every path stays inside the folder |
| `_measure.mjs` | frame metrics **at a fixed `s = 420`** — reproducible |
| `_nondet.mjs` | four races back to back; flags rail pinning |
| `_racefinish.mjs` | can a race be finished, and can the next one start |
| `_cams.mjs` | every camera mode: separation, facing, hero size |
| `_blown.mjs` | *where* in frame the blown and saturated pixels are |
| `_steerfeel.mjs` | steering response in simulated time |
| `_jointdump.mjs` | every joint map under the player, and whether it is live |
| `_carhit.mjs` / `_carnear.mjs` | traffic collision and closest approach |
| `_recover.mjs` | recovery from a standstill on road, dirt and rail |
| `_gamecheck.mjs` | `__GAME__` dump and page errors; catches NaN |

**`_measure` samples at a fixed distance, not after N seconds.** The road is a
function of distance, so a frame grabbed "after 10 s" came from wherever the
bike reached — p98 swung 209–246 and saturation 4.9–19.5% on *identical builds*,
and two tuning passes were spent chasing that noise.
