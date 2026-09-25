# HANDOFF.md — RideRash

**Read this first. It is written for an agent picking this up cold.**

---

## 1. What this is

A Road Rash-style bike combat racer in Three.js, built to `~/404-game-recipe/GAME.md`.
Five riders, one road, punch/kick/chain at 100+ mph. Single-page, no build step,
no network at runtime except the CDN import of three.js.

| | |
|---|---|
| **Game folder** | `~/riderash/` (OUTSIDE the recipe repo) |
| **Recipe repo** | `~/404-game-recipe/` |
| **Live URL** | http://localhost:9100/__game__/riderash/ |
| **Server** | `node harness/ridedish-serve.cjs 9100`, run from the recipe repo |
| **three.js** | 0.169.0, pinned, via importmap (`three/addons/` is mapped) |

**The URL prefix is `__game__` with double underscores on both sides.** `/game/riderash/`
is a 404. This has already cost one round-trip.

---

## 2. Current status

Run these from `~/404-game-recipe/`:

```
node harness/riderash-gate.mjs /Users/xavier/riderash   # gameplay + budget gate
node harness/ship.mjs /Users/xavier/riderash            # module parse + path safety
node harness/_measure.mjs ~/riderash/_shots/E-textured.png   # frame metrics
```

**Gate: ALL CHECKS PASS**, verified after the surface and backdrop changes.

```
ok  throttle advanced 376-388 m in 5.0 s of game time, peak 52.5 m/s
ok  steer moved lateral ~0 -> -1.0 m
ok  8 hits landed in 14 s
ok  draws 817-826 / 900
ok  tris ~224,000 / 1,500,000
```

**Ship: clean** (24 modules, all paths inside the folder).

`_measure.mjs` takes **no arguments** — it drives a live race itself and writes
`/tmp/rr_frame.png`. The old invocation in this file (passing a PNG) was wrong.

### Frame metrics, and where they stand against the bar

| metric | before §5.9 | now | bar | status |
|---|---|---|---|---|
| p98 luma | 196 | 233 | 239 | close |
| pixels >245 | 0.00% | 0.59% | 1.1% | close |
| high-saturation | 0.3% | 28.5% | 19% | **over** |
| hero height fraction | 0.12 | 0.29* | ~0.34 | close* |

\* the hero fraction is only meaningful on a run where the bike stayed on the
road; see §6.2. Every number in the "before" column was measured through a frame
in which **the road was not visible at all** — see §5.9, which is the single most
important thing in this file right now.

---

## 3. Architecture — the parts that matter

```
src/worldspine.js     THE WORLD AS A FUNCTION OF DISTANCE. Read this first.
src/surfacedriver.js  drives the road materials from the spine every frame
src/physics.js        fixed-step BikePhys: tyres, weight transfer, suspension, collision
src/combat.js         ATTACKS (directional impulses), Fighter, hit resolution
src/level.js          road/verge/kerb geometry + centreAt/centreTangent/headAt
src/world.js          town, hills, clutter, traffic (all spine-gated density)
src/sky.js            DynamicSky: blended panoramas, measured sun, cached PMREM env
src/textures.js       PROCEDURAL surface library (no image files) + texMaterial
src/postfx.js         EffectComposer, bloom, grade, stats capture
src/main.js           init order, frame loop, camera, harness contract
```

### 3.1 `worldspine.js` — the central idea

Everything visual was previously a constant chosen at load: one road surface, one
sky, one set of scenery. The track is now a **function of distance**.

- **Three maps**: `coastal`, `canyon`, `city`. Each is a list of `[biome, lengthMetres]`.
- **Six biomes**: coast, scrub, forest, town, canyon, night. Each is a set of
  *surface states* (road tint/roughness/metalness, verge tint, fog, haze, time of
  day, and a scenery density mix) — **not new assets**.
- **170 m transitions**, smoothstep-eased, so two biomes blend as you ride through.
- **Within-sector drift**: three slow sine waves on `s` so no biome is ever
  literally constant.
- **Weather**: a rain front arrives over the last third, and `wetness` **lags**
  `weather` in both directions, so the road stays wet after the sky clears.

```js
const st = spine.stateAt(s);   // the single source of truth for "what does the world look like here"
```

`stateAt` returns road tint/roughness/metalness, verge tint, fog colour and
density, haze, timeOfDay, and per-scenery-type density. **Every consumer reads
this one object**, which is why the road and the sky can never disagree.

### 3.2 `surfacedriver.js`

Holds references to four road materials and re-drives them from `stateAt` every
frame. Textures never change; only tint, roughness, metalness, normal scale and
env intensity are lerped. **Six generated surfaces therefore produce six biomes.**

The four materials are named `deck`, `worn`, `foliage`, `shoulder`. See §5.1 for
why the names matter so much.

### 3.3 `physics.js` — `BikePhys`

Fixed step at 1/120 with an accumulator (never frame-rate dependent), plus:

- **Torque curve** (`engineCurve`), not a constant.
- **Tyre slip curve** (`tyreForce`): linear → peak → falloff, so slides are
  progressive rather than a cliff.
- **Weight transfer**: `longAccel` shifts `loadFracFront/Rear`; braking takes the
  front from 0.42 to **0.87**, which is why it dives.
- **Suspension**: damped spring at each end, driven by transfer and by
  `surfaceInput` (which the road may supply). `pose().pitch` reads −0.161 under
  power and **+0.232 under brakes**.
- **Collision**: `contact(other)` is an impulse keyed on closing velocity along
  the contact normal; `hitRail()` slides along a wall rather than stopping dead.
  The contact pass runs in `main.js` **after every body has moved**.

### 3.4 Direction of travel — `headAt` vs `centreTangent`

**This is the single most expensive lesson in the project. Read §5.2.**

`centreTangent(z)` returns the road's **geometric** tangent, which points toward
**+z**. The road is built toward **−z** (`s = -z`), so the direction of **travel**
is the opposite.

- Use `centreTangent` only for its **normal** (`nx = -t.z, nz = t.x`) — sign-invariant.
- Use **`headAt(z)`** for anything that must **face** down the road: bike heading,
  chase camera, traffic, `yawAt` in `world.js`.

---

## 4. Hard constraints

### 4.1 Atlas
- **3D mesh generation is blocked** (`subscription_status: null` gates Tripo3D,
  Trellis, Meshy, Hyper3D Rodin, Hunyuan3D). **All meshes are code.** Do not spend
  time retrying mesh generation.
- **`quality_text_to_image` works.** 8 textures were generated this way.
- **`audio_sfx` works** (engine.mp3, impact.mp3, scrape.mp3).
- Project pid `68d0bdc8-7a63-4669-b86c-4ac5b587e599` ("RideRash Textures"), `workspace_read`.
- Downloads need `Authorization: Bearer $ATLAS_API_KEY` against
  `https://api.prod-market.atlas.design/0.2/download_binary_result/<fid>`.
- `atlas_prompt_project_agent` times out on long runs but **the agent keeps
  running**. A retry returning `AGENT_BUSY (HTTP 409)` means *still working* —
  **do not interrupt it.**

### 4.2 The 404 asset contract — CORRECTED, read this in full

An earlier version of this file said only that "textures cannot be applied through
`ASSET()`". That is true but it buried the larger rule, and the larger rule is the
one that decides what you are allowed to build:

- **NO IMPORTED MESHES. ANYWHERE. EVER.** Not in assets, not in game code, not as
  a "temporary" reference. `404.md` opens with *"404 generates 3D as code… No mesh
  files, no downloads."* There is no route to a `.glb`, `.fbx` or `.obj` at all.
  Geometry is built from Three.js primitives or written straight into
  `geometry.attributes.position`, which the contract explicitly permits. The
  permitted-primitive list "is a starting point, not a fence. What is forbidden is
  imports, files and the network, not techniques."
- **Asset modules (`assets/*.js`)**: one `export default THREE => Group`. No
  imports, no network, no `eval`, no timers, no animation loop, no Node APIs.
  `MeshStandardMaterial` with explicit flat colours per part — **no textures, no
  external files, no image loading**. Surfaces are applied afterwards, from
  outside, by `surfaces.js`.
- **Game code (`src/*.js`)** may import and may in principle read files — you own
  the folder — but the project's thesis is that it does not need to. See below.
- **Textures are generated, not loaded.** `src/textures.js` builds every surface
  map at load time from a seed (see §5.9). Two routes, both file-free:
  `surfaces.js` (the sanctioned recipe library: plaster, stone, timber, tile,
  metal, fabric, foliage, ground) and game-local recipes in `src/textures.js` for
  road materials the library has no recipe for.
- **The one declared deviation: `assets/tex/sky_day.jpg` and `sky_dusk.jpg`.**
  Equirectangular photographic panoramas. `DynamicSky` blends them and measures
  the sun's direction out of the image, and no procedural generator here can
  produce that. Two files, sky only, nothing structural. Everything else that was
  in `assets/tex/` has been retired to `~/riderash-atlas-backup/tex/`.
- **Second declared deviation: `assets/fonts/` (UI type only).** Anton (display) and
  Rajdhani (UI), SIL OFL 1.1 (licences alongside), ~65 KB of woff2, loaded by
  `@font-face` from inside the game folder -- no font service at runtime. They are
  UI chrome (menus, HUD, callouts); the in-world "no glyphs" rule is unchanged, and
  the only world text remains the pre-existing finish banner and trackside boards.
  (The startup intro VIDEO that briefly lived in `assets/video/` was removed: the
  intro is now rendered live by the game, see main.js `runAttract`.)
- **Atlas's role follows from this.** It cannot supply meshes (forbidden) and
  should not supply surface files (against the thesis). What it is *for* is
  everything upstream of the code: reference images — which `404.md` explicitly
  expects to come from an external image tool — the critic's bar frames, the sky
  panoramas, and audio. See §10.
- **The one-wheeler (`assets/bike_mono.js`) was drawn from an imported mesh, not
  built with one.** An Atlas-generated GLB (project "RideRash replay references",
  1.6 M triangles) was downloaded to a scratch folder OUTSIDE the repo and MEASURED:
  the wheel fitted as a circle, the body's top, belly and half-width sampled at 48
  stations. Those numbers are the tables in the asset; the body is lofted through
  them (superellipse sections on a Catmull-Rom spline). Silhouette IoU against the
  reference at 1:1 was side 0.87 / top 0.91 / front 0.77; it was then deliberately
  stretched (22% longer, 20% wider, raked) to read sportier, and painted after
  photographs of the real machine (orange fading to gold, a broad black band, a
  five-spoke silver rim). 33 k triangles. The GLB never enters the game or the repo.
- **The one-wheeler rides differently.** It is balanced, not braked: under throttle
  the nose dips and the tail rises and the rider leans in (player.js, pivoting on
  `userData.bike.hubZ`); braking tips it back. Stamp on the brakes above ~70 mph
  and you lean too far: LEANING BACK! then THROWN OFF THE BACK (main.js noseOver).
  Machine stats agility / brake / frail (physics.js setMachine, combat.js).
- **No glyphs anywhere.** Signage is shape and colour only. (The title screen is
  UI chrome, not game-world signage — text there is fine.)

### 4.3 Environment
- **Shell is zsh.** `declare -A` fails with `bad substitution`; use a here-doc read loop.
- **Puppeteer resolves ONLY from `~/404-game-recipe/`.** Any harness script that
  imports it **must live in `harness/`**. A `/tmp/*.mjs` script fails with
  `ERR_MODULE_NOT_FOUND`.
- **Port 8080 is a user-owned Python `serve.py` — do NOT kill it.**
- Only `sips` is available for image work (no `magick`/`convert`/PIL/pngjs).
  - `sips` gotcha: `-Z` chains into `.png` and re-encodes from the original,
    ignoring the resize. Use
    `sips --resampleHeightWidth W H -s format jpeg <src> --out <dst>`.

### 4.4 Operational (from AGENTS.md)
- **Never kill or modify training mid-run.** Never `rm -rf` blindly. Back up before
  anything destructive. One `in_progress` todo at a time.

---

## 5. Traps that have already cost time

### 5.1 Material names are load-bearing
Almost every surface in `level.js` was named `ground` — the asphalt deck, the wheel
tracks, the shoulder, the road markings, the tar patches, **and the sea**. Anything
that groups materials by name (the surface driver, `bakeStatic`'s bucketing)
therefore treated them as one material and drove them all to a single tint.

They are now `deck`, `worn`, `shoulder`, `marking`, `patch`, `crack`, `sea`.
**If you add a surface, give it a distinct name and decide explicitly whether the
surface driver should drive it.** `marking`, `patch`, `crack` and `sea` are
deliberately NOT driven — a painted line is white in every biome.

### 5.2 The camera faced backward, and it was the road tangent
`BikePhys.sync()` used `centreTangent()` as the bike's heading. Because the tangent
points +z and travel is −z, **every bike faced backward** — and the chase camera,
placed relative to that heading, sat in front of the bike looking back down the
road it had come from.

Symptom: the frame's mid-band was a flat tan band. It looked exactly like the road
was being occluded by the verge. **It was not.** It was the verge *behind* the
rider, because the camera was pointed the wrong way. Several hours went into
editing road materials that were already correct.

**The one-minute diagnostic that would have found it:** cast a ray from the camera
and dot the camera's forward vector against the bike's. `dot(camForward, bikeForward)`
was negative. After the fix it is **0.998**.

Fixed by introducing `headAt()` and using it in `physics.js`, `world.js` (`yawAt`)
and `main.js` (traffic). **The tangent itself was left alone** because ~20 call
sites use only its normal, which is sign-invariant.

### 5.3 `renderer.info.render.calls` includes the shadow pass
`postfx._captureStats()` snapshots `renderer.info.render.calls` after the scene
pass, and three.js has already added the shadow map draws. So the gate's 900
budget is a **scene + shadow** budget. (Measured: disabling every shadow caster
changed 852 → 852, so in practice the scene dominates and shadow work was a red
herring.)

### 5.4 Fixed-step physics is not "call `step()` with the frame dt"
An early test called `phys.advance()` directly and got 82 m in 5 s, briefly
suggesting acceleration was broken (the gate wants 369 m). The physics was fine —
the direct call omits the road-frame integration the real update path applies.
**Measure through the real entry point** (`window.__PLAYERPHYS__` in a live race)
or you will "find" regressions that do not exist.

### 5.5 A bike pinned on the guard rail must be able to escape
Two bugs combined here:
1. **Silent lane drift.** `lateral` is measured from the road centreline but the
   bike travels along its own heading. A heading differing from the road's by a
   fraction of a degree slides the rider sideways over hundreds of metres — to the
   rail, with **zero contacts**. Fixed with a speed-damped lane-hold counter-steer
   in `step()`.
2. **Permanent pinning.** A blow taken while already against the barrier added
   lateral velocity straight into it; `hitRail` zeroed it and the next contact
   added it again. Measured: **283 consecutive pinned frames**, 5-second distance
   collapsing from 366 m to 41 m. Fixed by diverting a blocked lateral impulse into
   a forward one.

The pack also held station on the player's own lane. Rivals now have **lateral
lane homes**, so they jostle rather than press the player off the road.

### 5.6 NaN in a physics value kills the frame
A non-finite value reaching Web Audio's `setTargetAtTime` throws and takes the
frame down. `applyHit` and `contact()` now **guard their inputs and clamp their
outputs**. If you add a path that writes `speed`, `lateral`, `lateralV` or
`yawRate`, guard it too.

### 5.7 Caching materials is what keeps draw calls down
Uncached `mat()` factories in both `level.js` and `world.js` were producing
hundreds of identical `plaster`/`metal`/`fabric` materials. `bakeStatic` buckets by
material identity, so none of them merged. Both factories are now cached by value.
**If you add a material factory, cache it.**

Also: hoardings were added as one `Mesh` each (~200 draw calls for the most
repeated prop in the game). They are now instanced by colour.

### 5.8 Road length vs map length
`ROAD_SEGS` used to build 7200 m of road for maps that are 5000-5300 m long, so
~1900 m of scenery was placed past the finish line and drawn every frame the player
looked down the road. Now 5600 m, sized to the longest map (CANYON, 5300 m).
**If you add a longer map, raise `ROAD_SEGS`.**

---

### 5.9 THE BACKDROP PLANE WAS COVERING THE ROAD — and it faked three other bugs

**Symptom:** the bottom 55% of every captured frame was one flat tan sheet. No
road, no markings, no kerb, no rail. The hero was a speck at the horizon.

**Cause:** `buildBackdrop`'s "beach" strips in `level.js`. Two independent faults,
and the first one hid the second:

1. They are 600 m wide centred at `x = ±300`, so their inner edges meet at `x = 0`.
   They do not lie "either side" of the road — they tile the whole world, road
   included.
2. They sat at a **constant** `y = -0.55`, while `centreAt`'s elevation is
   `sin(z*0.0016+0.4)*2.6 + sin(z*0.0043)*0.9` — the road runs from **-3.11 m to
   +2.58 m**. For a large part of its length the road is below -0.55, and was
   buried.

**The diagnostic that found it in one run** (`harness/_whatis.mjs`): raycast from
the chase camera through a column of screen points and print the material name,
colour and *geometry size* of each hit. It came back
`stone #6b6252, size [600, 6200, 0]` at 1.7 m with the `deck` behind it at 3.2 m.
A 600 × 6200 m plane is not a beach; the size field is what named the culprit.
**Add the geometry size to any "what am I looking at" diagnostic** — the material
name alone said `stone`, which is also the kerb and half the town.

**Fix:** the floor is now placed below the road's lowest *possible* point, derived
from the amplitudes (`-(2.6+0.9) - 0.35`) rather than from a number that happened
to work at `z = 0`. Fault 1 was left alone deliberately: a continuous floor is what
stops a hole opening between the verge's outer edge and the beach.

**What it faked.** These were all recorded in §6 as separate open problems. One
change moved all three, because the thing being measured was not on screen:

| metric | with the plane | without it |
|---|---|---|
| p98 luma | 196 | 245 → 233 after retune |
| pixels >245 | 0.00% | 2.11% → 0.59% after retune |
| high-saturation | 0.2% | 10.9% → 28.5% |

**The lesson, and it is §5.2's lesson again:** *look at the frame before tuning
the thing you think is in it.* Hours went into pushing biome verge tints and the
grade's saturation to move a number that could not move, because the surface
carrying the tint was behind an undocumented plane. **The biome `vergeTint`s in
`worldspine.js` were pushed hard (coast is `0xb8862a`) to chase that dead metric
and are now visibly over-saturated — a mustard slab from kerb to hills. They should
be re-judged now that the measurement is real.**

### 5.10 Surfaces are generated, not loaded

`src/textures.js` was seven committed JPEGs (3.1 MB) loaded at startup. It is now a
generator. Nothing about the call sites changed — `texMaterial(name, opts)` and
`getTexture(name)` keep their signatures, and the public surface names
(`wet_asphalt`, `dry_scrub`, `concrete`, `plaster`, `metal_rail`, `kerb_stripe`)
are the ones `level.js` and `world.js` already said.

Three things worth knowing before you touch it:

- **Albedo is a tint multiplier, not a colour.** Every generated albedo sits near
  1.0 and the *material* carries the palette. This is why one asphalt map serves a
  wet coast road and a dusty canyon one, and it is also why the road must be tinted
  **dark**: a light map times a light tint is a white road that blooms.
- **Roughness maps multiply.** three.js multiplies `material.roughness` by the
  roughness map, so attaching a map whose mean is 0.83 makes every surface 17%
  glossier than the number you wrote — and on the rail's band (mean 0.52),
  twice as glossy. `texMaterial` divides the requested value by the map's mean and
  stashes the reciprocal in `material.userData.roughGain`; `surfacedriver.js`
  applies the same correction every frame. **If you add a driven material with a
  roughness map, carry `roughGain` or the biome's gloss will be wrong.**
- **Clones are keyed by (surface, repeat), not per material.** The town has five
  wall colours and three roof colours wanting pixel-identical maps; cloning per
  material would be eight GPU uploads and would fragment `bakeStatic`'s buckets.

Two files remain in `assets/tex/`: `sky_day.jpg` and `sky_dusk.jpg`. See §4.2.
The retired maps are in `~/riderash-atlas-backup/tex/`.

---

### 5.11 THE LEAN WAS FED INTO THE BICYCLE MODEL — steering was 180x too fast

**Symptom (reported by the user):** "the left/right keys turn it very fast", i.e.
the bike is uncontrollable.

**Cause:** `physics.js` computed `leanTurn = tan(lean) * (speed / WHEELBASE)`.
That is the bicycle model `yawRate = v·tan(δ)/L`, and `δ` in it is the **steer
angle at the front contact patch**, not the lean angle. Feeding the lean in is a
category error, and the 1.40 m wheelbase divides by a small number on top.
**Measured: at 50 m/s and full lean it asked for 31.3 rad/s — five revolutions per
second.** `yawOffset` self-centres at `yawRate/3.4`, so it slammed into its ±1.9 rad
clamp on any input; a heading 109° off the road does not read as steering.

**Fix:** the steady-turn balance, which is the correct relation for a motorcycle.
Leaning at θ, `tan θ = v²/(gR)` and `yawRate = v/R`, so

```
yawRate = g · tan(lean) / v        // 0.172 rad/s at 50 m/s full lean = a 291 m sweep
```

It falls with speed by construction, so the "fast bikes feel reluctant" behaviour
is now a property of the physics rather than a hand-tuned authority curve. Direct
bar steering is kept but **fades to nothing by 18 m/s** (`BAR_STEER_FADE`) — it was
scaled to *grow* with speed and contributed 0.72 rad/s at 50 m/s, four times the
whole lean term, which would have put the bug straight back.

New tunables in `PHYS`: `TURN_GAIN` (1.0 = physical), `TURN_MIN_SPEED`,
`BAR_STEER_FADE`, `STEER_SMOOTH`. `LEAN_RATE` went 5.2 → 7.0 to cut the dead time.

**Measured after** (`harness/_steerfeel.mjs`, in simulated time at ~48 m/s):
0.76 m at 1 s, 2.63 m at 1.5 s, crossing the 7.5 m carriageway in about 2 s of
held full lock. `_nondet.mjs`: 4 runs, 0 contacts, 0 pinned frames.

**And it exposed a broken instrument.** The gate's steer check held `KeyA` for
1400 ms of **wall clock** — but `main.js:436` clamps the frame delta to 0.05 s, so
at the ~4 fps this harness renders under swiftshader that is about **0.3 s of
simulation**. The assertion had been passing only because the physics was 180x too
fast. It now accumulates simulated time the same way the throttle check already
did, with the 0.35 m bar unchanged. **Any new gate assertion that waits must count
simulated time** — this is §5.4's lesson wearing a different hat.

---

### 5.12 THE RIDER HAD NEVER MOVED A LIMB — a declaration-depth bug

**Symptom:** none. That is the whole point of this entry.

While wiring baked motions in, a probe of the live player's joint map came back
holding only `pelvis, torso, neck, head, chain`. Every arm and leg key was
missing. So `poseRider`'s `rot(ra.upper, ...)`, `rot(ra.elbow, ...)` and
`rot(L.thigh, ...)` lines — the hand-written punch, kick and chain animations —
had been **writing to `undefined` for the entire project**. The rider rendered
perfectly, seated, and no still frame of a bike at 100 mph looks any different.

**Cause:** `assetlib.js`'s `carryDeclarations`. `ASSET(..., {keepHierarchy:true})`
cannot hand live nodes through a clone — three.js `Object3D.copy()` does
`JSON.parse(JSON.stringify(source.userData))`, which turns a node into a
`{metadata, geometries, materials, object}` blob. So the loader records joints by
NAME and `resolveDeclarations` rebuilds them per instance. That mechanism handled
**two levels**, and `assets/rider.js` publishes three:

```
joints = { pelvis, torso, neck, head, chain,          <- depth 1, carried
           arms: { left: { shoulder, upper, elbow, fore }, right: {…} },
           legs: { … },                                <- depth 3, DROPPED
           leftArm, rightArm, leftLeg, rightLeg }      <- depth 2, DROPPED
```

`leftArm` and friends alias `arms.left`, so they are objects *of* nodes rather
than nodes, and the old `Object.values(val).some(isObject3D)` test was false for
them.

**Fix:** `declareRefs`/`rebuild` in `assetlib.js` now recurse to any depth. This
is a **local modification to a harness file**, marked as such in the source, in
the same way `surfaces.js` already carries one. `rigclone.js` was given the same
recursive treatment.

**The lesson:** this is `docs/asset-contract.md`'s own warning — *"renders
perfectly and can never move a limb, and no still frame will show you"* — except
it arrived through the declaration mechanism rather than through the merge, which
is the case the contract does not warn about. **After touching a rig, assert on
the joint map, not on the screenshot:** `harness/_jointdump.mjs` prints every
joint map under the player and whether each entry is a real `Object3D`.

A second bug fell out of the same work: `addMotion` adds deltas onto whatever the
rest pose left on a node, which is only sound if the rest pose wrote that axis.
It did not — the riding pose sets `rotation.x` everywhere but `z` only on the
upper arms — so `rotation.z += delta` on an elbow compounded every frame.
Measured: the right elbow's z ran 1.5 → 7.8 → 12.3 → 16.2 over ten frames and
stuck. `clearMotionAxes` now zeroes `y` and `z` on every motion-driven joint
before the rest pose runs, so each frame is a pure function of (rest, motion).
**If you add a joint to a motion table, add it to `Player.MOTION_BONES`.**

---

### 5.13 Traffic drove in a straight line down a curving road

`main.js` advanced every car with `car.position.z += speed * dt` and nothing
else. `centreAt` wanders **±76 m in x** and now ±6 m in y over the route, so a
car spawned on the tarmac was off the side of it within a couple of hundred
metres, and floated above or sank below the surface as the road rose and fell.
It only ever looked correct in the moments just after a wrap, which is why it
survived.

`updateTraffic` in `world.js` now parameterises each car by **arc length `s`**
and resamples `centreAt`/`centreTangent` every frame — one sine pair per car.
Cars hold a lane with a slow weave, recycle around the *player* rather than
around the world, and run in **both directions** (two thirds oncoming): the
slow same-direction cars are the ones you come up behind at 120 mph.

Use `centreTangent` here, not `headAt` — the lane offset is along the road's
normal, which is sign-invariant. See §3.4.

### 5.14 Road elevation was decorative

MEASURED on the old profile: **0.8% maximum gradient** over 5.6 km, with seven
crests and dips in total. The suspension, weight transfer and camera were all
faithfully responding to what was effectively a flat plane.

Two wavelengths were added, chosen from `maxGradient = 2πA/L` rather than by
eye: 571 m swells at 2.0%, and 150 m crests at 4.6%. Combined: **7.4% at its
steepest, a crest every ~75 m**, y range −5.79 to +4.96 m. The road now breaks
the horizon and the far scenery drops out of sight behind it.

**`ROAD_Y_MIN` in `buildBackdrop` is derived from these amplitudes and must be
changed with them** — that is §5.9's bug, and the derivation is there so it
cannot silently return.

### 5.15 An assist for the player is not a change to the physics

An arcade steering assist was blended into `BikePhys` and the gate passed
cleanly. `_nondet.mjs` did not: **143, 255 and 256 pinned frames across four
runs**, with distance collapsing from ~140 m to 46 m — §5.5's rail pinning,
straight back.

`BikePhys` drives the rivals too, so the assist had given the whole AI pack half
again as much cornering authority; they pushed the player into the barrier. The
assist is now opt-in per instance (`new BikePhys({ arcade: true })`) and only
the player opts in.

**This is the entry that justifies §7's rule.** The gate does not test pinning.
Run `_nondet.mjs` after *any* physics change, including one you are confident is
only an input aid.

---

### 5.16 Three per-race leaks, found by one symptom

`_nondet.mjs` runs four races back to back. **Race 0 had zero bike contacts
every single time; races 1-3 had 3-16.** A first race that behaves differently
from every race after it is the signature of state surviving a reset, and there
turned out to be three separate leaks:

| leaked | symptom | fix |
|---|---|---|
| `BikePhys.lateralV` | previous race's sideways slide threw the rider into the rail before the throttle did anything -- 269-281 pinned frames, `maxV` 12, 42 m covered | `BikePhys.reset()` restores the whole integrator |
| `Rival.targetLateral`, `aggroTimer`, `wantsToAttack` | the pack spawned already converged on one lane and started the next race inside each other | `Rival.reset()` |
| traffic `s` | a saloon could be parked on the start line | `resetTraffic()` |

**Reset the whole object, not a chosen subset.** Each of these was a hand-written
list of four or five fields that looked complete. Anything omitted is a channel
for the last race to reach into this one, and the symptom surfaces somewhere far
from the cause.

### 5.17 A rescue that cannot lose

Being shoved off the road has to cost places, never the race. Every force-based
correction was eventually out-muscled by a rival leaning on the bike once a
second, and raising the force further started to make ordinary excursions feel
magnetic. `step()` §4 now walks a rider who has been off the tarmac for
`STRAND_TIME` back toward it **positionally**, at a bounded rate. A position
write cannot fail to converge because nothing opposes it.

Measured: permanent 250-281 frame strands with distance collapsing to 41 m
became bounded ~1-1.7 s excursions that recover. **Not fully closed** -- roughly
one run in four still shows one. See §6.6.

### 5.18 Tyre relaxation length

Side force was an algebraic function of the current slip angle, so the bike
answered the bars in a single step -- a large part of what "too sensitive"
means. A real tyre builds force over ~0.5 m of travel while the carcass
distorts. `TYRE_RELAX` adds that first-order lag **in distance, not time**,
which is why it behaves across the speed range: 0.55 m is 10 ms at 52 m/s and
100 ms at 5 m/s, and a bike genuinely is sharper at speed.

Measured full-lock response: 1.06 m at 1 s, 3.15 m at 1.5 s -- a lane change in
about 1.6 s, between the sluggish pre-assist figures and the over-eager ones.

---

### 5.19 THE HANDLING MODEL WAS WRONG IN THREE PLACES — found with a trace, not a screenshot

The report was *"there is no friction, it is too sensitive to steer, the motion
is all wrong."* All three were true and none of them were visible in any
existing harness, because every one of them reported a **scalar** — a distance,
a percentage, one frame. `harness/_trace.mjs` was written to fix that: it
records every integrator field every 25 ms for a scripted input, prints each as
a sparkline, and takes a filmstrip on the same clock. It found all three faults
in one run.

**1. `laneHome` was an array.** `rivals.js` initialised a rider's own lane as
`[0, 0, 0, 0, 0]` — the whole table. `chooseTargetLateral` then does
`laneAnchor + (Math.random() - 0.5) * 3.0`, and **array + number is string
concatenation**: `"0,0,0,0,0-1.23"`. `clamp()` of that is NaN, which ran down
`targetLateral → steer → lean → yawOffset → s`. It hid because §5.6's NaN guard
clamps `speed`, `lateral`, `lateralV` and `yawRate` back to zero, so the bikes
read as *stationary*, not broken, and nothing threw. It only surfaced when the
new slipstream code read a rival's `s` and carried the NaN into the player,
freezing the game outright.

**2. The tyres made 9.4 g.** `TYRE_LAT_PEAK` was `9.4`, and `tyreForce` returns
`m * loadN` — so at peak slip a tyre produced **9.4 times the weight on it** in
side force. A motorcycle tyre makes about 1.2–1.4×. MEASURED on a straight with
**zero steering input**: `lateralV` swung ±16 m/s, `yawOffset` reached 0.62 rad,
the bike was against the barrier by t=5 s and off the tarmac for the rest of the
run, grip 1.00 → 0.54, speed 41 → 10 m/s. It *felt* like no friction; the cause
was far too much force. Now 1.35.

**3. Slip was measured against the road, so the bike could never track.** The
code read `slip = this.yaw - (this.yaw - this.yawOffset)`, i.e. `slip ==
yawOffset`: it assumed the bike's velocity was **always along the road**, so
every degree of heading away from the centreline counted as sliding. A bike
pointed 3° off the line is not sliding — it is tracking, and it arrives 2.5 m
over in a second. With no way to express that, lateral motion could only come
from tyre slide, which is *why* the tyres had been given 7× too much grip: it
was the only way to make the thing move at all. Slip is now measured against the
bike's actual velocity, which closes the loop — heading off-axis → slip → side
force → lateral velocity → the velocity rotates toward the heading → slip falls
to zero.

**Measured after all three:** speed ramps to 49.5 m/s and *plateaus*; `onRoad`
stays 1.00 for a whole run; grip 1.00; `lateral` inside ±1.3 m with no input;
`_nondet` **4/4 clean with zero pinned frames** for the first time in the
project. The rail pinning of §5.5, §5.15 and §5.17 was largely this: the bike
was being flung by its own cornering force.

### 5.20 The rival AI held full steering lock permanently

With the physics fixed, the pack still looked wrong — five bikes leaning like
they were falling. MEASURED with `harness/_rivalpose.mjs`: every rival sat at
`lean` **0.719** against a `LEAN_MAX` of 0.72, while travelling essentially
straight (`yawOffset` 0.067). Permanently pegged at 41°.

`steer = clamp(err * (0.55 + skill * 0.5), -1, 1)` is proportional-only at a
gain near 1.0, so any lateral error over about a metre saturates it — and
`chooseTargetLateral` routinely picks a line two metres away. A P-only
controller also cannot settle: it removes the error and arrives with all its
lateral velocity intact, overshoots, and saturates the other way.

Now PD (`PHYS_RIVAL_P` 0.22, `PHYS_RIVAL_D` 0.16). Rivals lean ±0.3 rad and hold
distinct lanes.

### 5.21 The lane hold was fighting the player

`lateralV -= lateral * h * 1.35` was added in §5.5 to stop silent drift. The
drift's *cause* was §5.19's slip bug; with that fixed the hold only fought
deliberate steering — full lock for 2.5 s moved the bike 1.4 m, less than half a
lane. Reduced to `PHYS.LANE_HOLD` 0.45 and kept as insurance against numerical
bias on a long race. Steering now: **1.56 m at 1 s, 2.88 m at 1.5 s, 4.19 m at
2 s** — a lane change in about 1.7 s — with `_nondet` still 4/4 clean.

---

## 6. Open problems, with the measurement that would close each

### 6.1 High-saturation pixels — CLOSED by §5.9, and now OVERSHOT
Was 0.3% against a bar of 19%. The cause was §5.9: the verge and road carrying the
chroma were behind the backdrop plane. It now measures **28.5%**, i.e. past the bar
in the other direction, because the biome `vergeTint`s had been pushed hard to
chase the dead metric. **Next move is to pull them back**, not to push further:
`worldspine.js` coast `0xb8862a`, scrub `0xc58e1e`, canyon `0xd45a18` are all
near-pure hues and read as a mustard slab from kerb to hills. The style lock's
`foliage` is `0x41502e`.

### 6.2 Hero height fraction: 0.13 vs the bar's ~0.34
The camera looks further ahead than the hero, which is right for showing the road
but leaves the bike small. `CAM_BACK`/`CAM_UP`/`CAM_LOOK` have been adjusted twice
without reaching the bar. **Note:** the hero fraction is measured from the
screenshot; confirm the measurement box is actually tracking the bike and not, say,
the bike plus shadow.

### 6.3 Bloom / luminance — CLOSED by §5.9
Was p98 197 against a bar of 239 and `>245 = 0.0%` against 1.1%. Both were
measuring a frame with no road in it. Now **p98 233, >245 0.59%**, after pulling
the asphalt recipe's gloss band from `0.55..1.0` to `0.72..1.0` (the sun's smear
was blowing to pure white across a third of the carriageway) and the deck's
`normalScale` from 1.5 to 0.85. Bloom itself was not touched.

### 6.6 Rail pinning is bounded, not eliminated
About one `_nondet` run in four still shows a 60-120 frame (1-2 s) excursion at
the barrier after a rival contact, costing ~half the race distance. §5.17 caps
it; it does not prevent it. The remaining path is contact frequency: the pack
still averages 2-4 contacts per five-second run. **The measurement that would
close it:** log every contact with both riders' `lateral` and the resulting
impulse, and find whether one rival is responsible or whether it is the pack
geometry at the start line.

### 6.4 A null object crashes a scene-wide raycast
A harness raycast over `scene.children` threw `Cannot read properties of null
(reading 'matrixWorld')` during a race, but recursive null-checking found **no null
children and no null grandchildren**. Suspect a transient `fx` particle object.
Not a confirmed game bug (the gate passes), but a scene-wide raycast during a race
is currently unsafe.

### 6.5 Map selection does not rebuild scenery
The title-screen picker changes the surface, sky, fog and race length
immediately, but the buildings/trees keep the layout they were built with until
**page reload**, because they are placed at load and baked. The UI says
"layout refreshes on reload" rather than silently half-applying. Making it live
means re-baking the static world, which costs seconds.

---

## 7. How to work on this

### Verify before and after every change
```bash
cd ~/404-game-recipe
node harness/riderash-gate.mjs /Users/xavier/riderash   # must end "all checks passed."
node harness/ship.mjs /Users/xavier/riderash            # must end "every module parses"
```

### The harness contract (`window`)
`__READY__` · `__START__()` · `__GAME__` · `__PLAYERPHYS__` · `__SCENE__` · `__CAM__` · `__THREE__`

`__GAME__` exposes: `pos, fps, speed, score, over, draws, tris, hp, stamina, combo,
hits, knockDowns, lateral, position, s, down, contacts, map, weather, wetness,
biome, sector, sectors, roadRough, timeOfDay`.

**`__GAME__` is how you diagnose a visual regression.** "The road turned grey" is
unactionable; "roughness 0.30 in sector 4, wetness 0.7" is not.

### Diagnostic scripts already written (in `~/404-game-recipe/harness/`)
| script | what it answers |
|---|---|
| `riderash-gate.mjs` | the real gate: throttle, steer, combat, camera, budget |
| `ship.mjs` | parse + path safety |
| `_measure.mjs` | p98 luma, >245, hiSat, black, hero fractions from a PNG |
| `_spine.mjs` | every biome/sector state for all three maps |
| `_transit.mjs` | transitions + weather arc over a whole race |
| `_phys2.mjs` `_phys3.mjs` | weight transfer, suspension, contact impulses |
| `_recover.mjs` | recovery from 0 m/s on road / in dirt / on the rail |
| `_nondet.mjs` | **run this after any physics change** — 4 identical runs, flags pinning |
| `_drawcount.mjs` `_calls.mjs` `_frustum.mjs` | draw-call attribution |
| `_gamecheck.mjs` | dumps `__GAME__` and any page errors; catches NaN |
| `_px.mjs` | dependency-free PNG reader (**no pngjs available**) |

### The method that works here
1. **Measure through the real entry point**, not a synthetic one (§5.4).
2. **When something looks wrong on screen, isolate what the suspect actually
   produces before editing it.** The camera bug cost hours of editing road
   materials because the road was never the problem.
3. **Run `_nondet.mjs` after any physics change.** Nondeterminism hides as
   "sometimes the gate fails".
4. **Check `__GAME__` for nulls** after touching the physics — NaN reaches the
   audio graph and throws.

---

## 8. Suggested order of work

1. **Saturation** (§6.1) — biggest gap, and the histogram measurement is the key.
2. **Hero framing** (§6.2) — verify the measurement first.
3. **Bloom/luminance** (§6.3) — re-measure the threshold against the real sky.
4. Then: the null-raycast hardening (§6.4) and live map rebuild (§6.5).

---

## 9. File inventory

```
~/riderash/
  index.html                    shell, title screen, map picker, HUD markup
  assetlib.js                   ASSET loader, bakeStatic, mergeByMaterialValues
  rig.js  surfaces.js
  src/
    main.js worldspine.js surfacedriver.js physics.js combat.js
    level.js world.js sky.js textures.js postfx.js lighting.js
    player.js rivals.js rigclone.js fx.js hud.js audio.js input.js config.js
  assets/
    bike.js rider.js            code meshes (verified: 5412 / 4310 tris)
    tex/                        7 x 1024^2 PBR maps + sky_day.jpg + sky_dusk.jpg
    audio/                      engine.mp3 impact.mp3 scrape.mp3
  _shots/                       captures (E-textured.png is the current one)
  _refs/                        bar1-3.png target frames
  CLAIMS.md                     measured results + post-mortems (read this too)
  HANDOFF.md                    this file
```

---

## 10. Atlas, and what it is actually for here

Atlas cannot supply the thing it looks like it should supply. §4.2 is the binding
rule: **no imported meshes, ever**, and committed surface files are against the
project's thesis even where the contract permits them. So the question is not
"how do we get assets out of Atlas" — it is "what part of this loop is Atlas the
right tool for", and the answer is **everything upstream of the code**.

`404.md` is explicit about this: *"This repo does not ship an image generator —
your agent sources the references itself."* The reference image is named there as
"the cheapest quality win available". That is Atlas's job.

| use | status | why it is allowed |
|---|---|---|
| **Reference images** for objects still to be built as code | used (`_refs/`) | never ships; it is what the geometry is written *from* |
| **Bar frames** for the critic loop | used (pid `baae7906…`) | never ships; it is what the round is judged against |
| **Sky panoramas** | shipped, declared §4.2 | procedurally unreachable; two files, sky only |
| **Audio** (`audio_sfx`) | shipped | the no-files rule is about meshes and downloads of geometry |
| **Vision critique of our own frames** | **not yet used — the biggest gap** | see below |
| **Mesh generation** | blocked *and* forbidden | do not retry it |

### The unused half: Atlas as the critic, not the supplier

Every asset in the workspace comes back from `list_workspace_assets` carrying a
model-written `description` that names what is in the image and what is cropped.
That same vision capability run over **our own rendered frame** is the missing
instrument in this project, and §5.9 is the proof: the road was invisible for an
entire session and every numeric gate still passed. `draws 817/900` and
`throttle advanced 387 m` cannot see a flat tan plane. A describe-this-frame pass
would have opened with "a flat tan surface fills the lower half; no road is
visible", which is exactly the sentence nobody wrote for hours.

Concretely, and in the order worth doing:

1. **Frame description.** Feed `_shots/*.png` to an Atlas graph that describes the
   image, each round. Cheap, and it catches whole-frame failures that metrics miss.
2. **Bar-vs-ours comparison.** Both images in, "name the three biggest differences"
   out. This is CRITIC-1 and CRITIC-2's job, done by something that is not the
   agent that wrote the code.
3. **Export it as a project API** (`export_project_api`) so the harness can call it
   from `riderash-gate.mjs` rather than it being a manual step.

The workspace is `f6b73e40-…` ("Xinghua Zhang's 404 Game Jam Workspace"), role
**owner**. Existing projects: RideRash Textures, Audio, Assets, Assets 2, Bar
Frames. `prompt_project_agent` is stateless — send fully self-contained prompts.

---

## 11. The motion pipeline (MDM), and why it is allowed

`src/motions.js` holds keyframe tables for punch, kick, chain, knockdown and tuck.
They were generated with [Motion Diffusion Model](https://github.com/GuyTevet/motion-diffusion-model)
(`humanml_trans_enc_512`) on a GPU box, retargeted, and **baked into source**.

**Why this does not break the rules.** The contract constrains *geometry*: "no
mesh files, no downloads", and asset modules may not import, fetch or animate
themselves. It says nothing about where joint angles come from — and
`docs/asset-contract.md`'s "Anything that moves" section positively expects game
code to drive named joints. A keyframe table is a constant, like a colour or a
road wavelength. The line that matters:

| | |
|---|---|
| baked into JS source | **allowed** — code, diffable, survives a folder copy |
| loaded at runtime from `.bvh`/`.npy`/`.json` | **not** — a file dependency |
| SMPL's mesh | **never** — forbidden outright |

MDM is a tool that ran once, exactly as an image generator is a tool that makes
reference frames. Nothing is fetched at runtime.

### Reproducing it

The box install has been removed (it cost 6.3 GB). The artefacts that matter —
`results.npy`, the retargeted `riderash_motions.json`, `retarget.py`, `bake.py`
and the prompt list — were kept. To redo it: `uv venv --python 3.10`, install
torch/clip/spacy/smplx, `numpy<2`, `moviepy<2`, `matplotlib<3.10`, then
`prepare/download_smpl_files.sh` and the `humanml_trans_enc_512` checkpoint.

**Four traps, all paid for already:**

- **`chumpy` is required and does not build cleanly.** `smplx` unpickles
  `SMPL_NEUTRAL.pkl`, which holds chumpy objects. It needs `pip` present with
  `--no-build-isolation`, and its `from numpy import bool, int, float, …` line
  must be cut to `from numpy import nan, inf` — numpy removed those aliases in
  1.24.
- **Pin the old libraries.** `generate.py` does `from moviepy.editor import …`
  (gone in moviepy 2.x) and the plotter calls `canvas.tostring_rgb()` (gone in
  matplotlib 3.10). `results.npy` is written *before* the video, so a plotting
  failure still leaves usable data.
- **`gdown` 6.x removed `--fuzzy`** — the repo's `prepare/*.sh` scripts fail
  silently against it. Pass the bare Drive file id instead.
- **MDM answers "a punch" with four seconds of repeated jabs.** Resampling
  keyframes across all of them aliases into an every-other-key zigzag that
  smoothing will not fix, because it is not noise. `bake.py` windows strike
  actions around the primary bone's largest peak.

### Why the numbers are deltas

MDM animates a **standing** figure; this rider is **seated**. Absolute angles
would stand him on the tank. `retarget.py` measures each bone's direction change
relative to the clip's first frame, in its parent's frame (arms in the torso's,
legs in the pelvis's), and `player.js` applies them as `rest + delta`.

One trap inside the retargeting: a bone's rest direction decides the formula.
Limbs hang along −Y, but the spine, neck and head point **+Y**, and measuring an
up-pointing bone with the down-pointing formula parks it exactly on `atan2`'s
branch cut, where noise flips it between +π and −π. That produced a "torso moved
6.28 rad" (2π) reading in all eighteen clips before it was fixed.

---

## 12. Third-party sources, checked before use

Three repositories were proposed as sources. Each was checked for **licence**,
**whether it loads mesh files**, and **whether the technique survives our speeds**.
The last question turned out to matter most.

| repo | licence | verdict |
|---|---|---|
| [mini-driving-simulator-3d](https://github.com/lianeheidemann/mini-driving-simulator-3d) | MIT | **idea adopted, code not.** See below. |
| [Claude-of-Tanks](https://github.com/Kevin-Liu-01/Claude-of-Tanks) | MIT **with carve-outs** | **not usable.** "procedural vehicle and battlefield source, fleet and map data, generated game assets … expressly excluded as proprietary Reserved Content" — the world-generation source *is* the excluded part. Its approach is useful confirmation, though: engine-free pure Three.js, all geometry procedural, no mesh files. |
| [NotBlox](https://github.com/iErcann/NotBlox) | MIT + anti-crypto clause | **not usable.** Physics is **Rapier.js**, a WASM download; maps are **GLB/GLTF**; and its README documents no NPC/AI system at all. |

### What was taken from mini-driving-simulator-3d, and what could not be

Its entire steering model is one line:

```js
car.rotation.y -= steering * Math.min(Math.abs(this.speed)/3, 1) * Math.sign(this.speed) * 1.5 * dt
```

The **directness** is worth having: yaw answers the key immediately instead of
waiting for a lean to build, which is what an arcade racer feels like.

The **constant is not transferable**. `min(|v|/3, 1)` saturates at 3 m/s, so
above walking pace it asks for a flat 1.5 rad/s at any speed. At that project's
16.7 m/s top speed that is an 11 m radius — fine. At our 52 m/s it is a 35 m
radius, which is **7.8 g**, and it is precisely the bug §5.11 removed:

| speed | their model | as g | our assist | as g |
|---|---|---|---|---|
| 10 m/s | 1.50 rad/s | 1.5 g | 1.13 rad/s | 1.1 g |
| 25 m/s | 1.50 rad/s | 3.8 g | 0.45 rad/s | 1.1 g |
| 52 m/s | 1.50 rad/s | **8.0 g** | 0.22 rad/s | 1.1 g |

So the constant rate became a **lateral-acceleration budget** (`ARCADE_LAT_G`),
which is the same idea in a form that survives an eightfold change in top speed.
It is **blended**, not substituted: the lean model is what makes this a
motorcycle rather than a car, and it still carries the weight transfer, the
slides and the visual lean. Attribution is in `physics.js` at the use site.

**The general lesson:** a technique lifted from a project with different
constants is not portable just because the licence allows it. Check the regime
it was tuned for.

---

## 13. Cameras, and the rest of the feature surface

### 13.1 Seven camera modes (`C` cycles, `1`-`7` pick)

`CAM_MODES` in `main.js` is a table of MULTIPLIERS on the tuned chase values,
not absolute numbers, so re-tuning the chase camera re-tunes every view with it.

| key | mode | what it is for |
|---|---|---|
| 1 | CHASE | the tuned default -- hero at 0.36 of frame height against a bar of 0.34 |
| 2 | BARS | cockpit: tank and handlebars, rider hidden. Sells speed. |
| 3 | BUMPER | at the front wheel, rider and bike hidden |
| 4 | HIGH | raised chase, reads the road further ahead |
| 5 | FAR | 12 m back -- the pack becomes countable |
| 6 | DRONE | high and wide, swings sideways with the steering |
| 7 | NOSE | ahead of the bike looking back at the rider |

**Do not retune CHASE to suit another mode.** It is the one the critic rounds
measured.

`harness/_cams.mjs` measures every mode: camera separation, height above the
rider, whether it faces the rider, and the hero's projected size. It is how BARS
and BUMPER were caught sitting INSIDE the rider -- projected hero heights of 4.4
and 135 screen heights, i.e. the near faces of the model filling the view. A
first-person camera must be ahead of the body it belongs to, and that body must
be hidden (`hideRider` / `hideBike`), or you are looking at the inside of a
jacket.

### 13.2 Traffic collides

`trafficHit` in `world.js` tests in the road frame `(s, lateral)`, which is exact
for a vehicle that follows a lane. Hitting a car costs speed and health;
oncoming hurts more. Verified with `harness/_carhit.mjs`: riding the oncoming
lane took health 100 -> 85.7 with `contacts: 0`, proving it was traffic and not
a rival.

The shove pushes **toward the road, not away from the car**. Away-from-the-car
is the intuitive choice and it is wrong half the time -- when the rider is
outboard of the car it drives them into the barrier.

### 13.3 Audio

`crash`, `swing`, `horn` and `skid` were generated with Atlas `audio_sfx` and
sit alongside the original `engine`, `impact` and `scrape`. Audio is not covered
by the no-mesh, no-download rule -- that rule is about geometry.

The horn is a **near miss**, not a collision: a wider box than `trafficHit` uses,
oncoming traffic only, on a cooldown. Squeezing past an oncoming car is the most
Road Rash thing that happens on this road and it used to be silent.

`audio.oneShot(name, amp, rate)` is the path for anything new. A missing buffer
is a silent no-op, never a throw.

**The soundtrack (`src/soundtrack.js`, `assets/audio/music/`, ~5.5 MB).** The
synthesised menu/race loops in `music.js` are replaced, when the files load, by
ORIGINAL instrumentals generated in the Atlas project "RideRash Audio": the
title and four race loops with Stable Audio 3 (`is_instrumental: true`, so no
vocals; the first MiniMax takes had singing and were dropped), win/bust
stingers with MiniMax Music, `rev`/`select` with ElevenLabs SFX. Briefs in
`_refs/audio_briefs.md` (90s bike-combat register; no artist, song or game
named or imitated). Each loop: fade-out trimmed, a 1.5 s equal-power crossfade
seam, normalised to 0.89 peak, 128 kbps. There is no hover sound on purpose.
If any file fails, the synthesised music stays in charge.

---

## 14. `_trace.mjs` — the instrument for anything that MOVES

Every other harness here reports a scalar. That is why three separate handling
faults (§5.19) survived weeks of green gates: a distance, a percentage and a
single frame cannot show motion. An agent cannot watch a video, so the
substitute is a dense per-frame record **plus** a filmstrip on the same clock.

```
node harness/_trace.mjs [scenario] [seconds]      # straight | steer | brake | fight | free
```

Writes to `_shots/trace/`: `trace.csv` (every integrator field, every 25 ms),
`trace.json` (summary, NaN report, page errors), `frame-NN.png` (filmstrip), and
prints a sparkline per field.

**Read the sparklines first.** They are the point:

| shape | meaning |
|---|---|
| speed ramps then plateaus | drag and friction are working |
| speed rises forever, or collapses | a force term is wrong |
| `lateral` wanders with `steer` flat | drift — §5.19 |
| `onRoad` dropping to 0 mid-run | the bike is being put off the road |
| `grip` pinned at 0.54 | it is *staying* off the road |
| any field showing `(no data)` | that field is **NaN** — JSON turns NaN into null |

The scenarios drive a **known input as a function of time**, which is the only
way a trace reads as cause and effect rather than as a squiggle. Add one by
adding a row to `SCRIPTS`.

**Companions:** `_rivalpose.mjs` dumps every rival's physical state and the euler
angles actually on its bike and rider nodes — that is what caught the pack
riding at full lean (§5.20). `_nanhunt.mjs` stringifies every physics field, so
NaN survives the trip out of the page.

---

## 15. The NPC behaviour engine, and the crash-walk (§5.22–5.24)

Three workstreams were dispatched as parallel subagents on disjoint file
ownership. **Two landed; one never produced a file.** What follows records the
landed work, and one correction to an earlier claim.

### 5.22 The subagent split, and what it actually produced

| stream | owns | outcome |
|---|---|---|
| NPC engine | `npc.js`, `rivals.js` | **landed** — 807 + 365 lines |
| Dismount / walk / remount | `dismount.js`, `player.js`, `motions.js` | **landed** — 646 + 271 + 188 lines |
| Audio & front-end | `audio.js`, `menu.js`, `index.html`, `hud.js` | **never produced a file** |

The audio/menu stream was started but wrote nothing: no `menu.js`, and
`audio.js`/`hud.js`/`index.html` still carry their pre-dispatch mtimes. C7
(music) and C8 (pause/menus) are therefore still **open**, not in flight.
Third attempt at this — the lesson is that a stream whose deliverable is a new
file should be checked for the file's existence, not for the agent's report.

**No agent touched `main.js`.** That was the right call and it held: the two
landed streams only needed small wiring, applied centrally (§5.25).

### 5.23 The NPC engine (`src/npc.js`)

An explicit FSM — `RACE / HUNT / ATTACK / EVADE / RECOVER` — with enter/update/
exit and a transition table, four personas (`aggressive / clean / blocker /
cop`), and a single output: a control **INTENT**

```js
{ steer, throttle, brake, attack, tuck }   // attack: 'punch'|'kick'|'chain'|null
```

The brain never receives a `BikePhys` or a scene object, so it **cannot** write
to physics even by accident. That is the seam cops reuse:
`new NpcBrain({ kind: 'cop', index, seed })`.

Determinism: no `Math.random`, no `performance.now`. Two brains seeded `42`
produced byte-identical intents over 300 frames.

`laneHomeFor(index, roadHalf)` replaces the old per-rival lane table —
remember §5.19 fault #1, where `laneHome` was initialised as the whole *array*
and string-concatenated into NaN for every rider. The helper returns a number,
and `npc.js` exports `num(v, fallback)` as the coercion guard.

Measured after: leans all ≤0.117 against `LEAN_MAX` 0.72 (was 0.719 *while going
straight*, §5.20); five distinct lanes; all riders moving ~40 m/s; none frozen.

### 5.24 Dismount, walk, remount (`src/dismount.js`)

State machine: `RIDING → FALLING → DOWN → STANDING → WALKING → MOUNTING →
RIDING`. Bike and rider rest independently (the machine slides on while the
man tumbles). The gait is a procedural sine on the **existing** joints, driven
through `riderpose.clearAxes` first — mandatory, or `rotation.z +=` compounds
(§5.12) and the pose sticks.

**Measured, zero input, crash at 26 m/s: full cycle in 12.03 s**, no page
errors. The gait is provably anti-phase, not a bob:

```
gait-00  WALKING  Rthigh=0.75 Rknee=-1.88  Lthigh=1.57 Lknee=-1.55
gait-04  WALKING  Rthigh=1.58 Rknee=-1.55  Lthigh=0.74 Lknee=-1.83
```

Right and left thighs swap 0.75↔1.58 in exact antiphase. A harness `_gait.mjs`
paints the player's rider **magenta** so he cannot be confused with a rival;
the frames in `_shots/gait/` and `_shots/seq/` show a man upright, mid-stride,
on the road, legs split fore/aft — not a T-pose and not a slide.

### 5.25 Central wiring applied to `main.js`

1. **The camera had to change or the mechanic was invisible.** `updateCamera`
   aimed `CAM_LOOK` (8 m) *ahead* of `phys` and sat `CAM_BACK` back — correct
   for a bike, wrong for a 1.55 m walker, who sat at the bottom edge and mostly
   off it. Now `focus = player.focus`, with reach ×0.45 and look-ahead ×0.25
   applied **only** while `player.onFoot`; riding framing is bit-for-bit
   unchanged. Verified by re-reading the `_seq` crops: the walker is now framed.
   *The mechanic was live and correct before this fix — it was simply invisible,
   which from the player's seat is the same as broken.*
2. **`resetRace()` now calls `player.reset()`.** The on-foot machine is per-race
   state; a race ending mid-walk would leak `WALKING` into the next race. Same
   class as the `BikePhys` / `Rival` / `Fighter` leaks (§5.16). `Player.update`
   also self-heals, but depending on self-healing is how the other three leaks
   survived as long as they did.
3. **Grid speeds are no longer `Math.random()`** — a fixed per-slot offset.
   See §5.26 for why this did *not* make `_nondet` exactly identical.

### 5.26 `_nondet` does not prove what its name says

The grid-speed `Math.random()` at `main.js:970` was **real** nondeterminism and
is now a constant. But `_nondet` still reports `ds` spread 112.9–114.2 m, and
before claiming the AI was at fault, the harness was read:

- It measures **wall-clock** `performance.now()` for 5200 ms. Under swiftshader
  at ~4 fps that is a few dozen frames, and the frame count varies per run — so
  part of the spread is the harness sampling a different number of frames, not
  the game diverging. This is the same wall-clock trap already documented for
  the gate (§ `waitOutCountdown`).
- Genuine nondeterminism remains in the *shove* path: `combat.js:212-213` and
  `main.js:719` add a random `yawOffset`/`lateral` on a knockdown, and
  `world.js:410-413` randomises traffic recycling. Runs have 1–2 contacts each,
  so trajectories legitimately diverge from there.

**Verdict: the pack AI is deterministic (proven directly, seeded, 300 frames);
the end-to-end run is not, by design** — a knockdown that always threw the bike
the same direction would be worse, not better. `_nondet`'s real value is its
`pinnedFrames=0` and `lat[0,0]` columns, and both hold.

### 5.27 Current measured state (post-integration)

| check | result |
|---|---|
| `ship.mjs` | 31 modules, every module parses |
| `riderash-gate.mjs` | **all checks passed** — 349.5 m/5 s, **peak 52.2 m/s**, 5 hits, draws 777/900, tris 218k/1.5M |
| `_nondet.mjs` | 4 runs, `pinnedFrames=0`, `lat[0,0]`, no `down` |
| `_gamecheck.mjs` | `errors: none`, no NaN |
| `_strand.mjs` | full cycle 12.03 s, no input, no errors |
| `_racefinish.mjs` | "1ST of 6", restart `s=11 hp=100 lateral=0`, 0 page errors |

**Peak speed is now 52.2 m/s ≈ 117 mph**, against the objective's "100+ mph" —
up from 36.5 m/s at the start of this session.

### 5.28 Still open

- **Cops (`cops.js`)** — the Road Rash signature, and the objective explicitly
  names it as what makes this a worthy successor. `NpcBrain({kind:'cop'})`
  exists and is verified; the cop *roster, pursuit and takedown* do not.
- **C7 music / C8 pause+menus** — the third workstream produced nothing (§5.22).
- **C4** weapon pickups and a defensive verb.
- Visual gap, understood and reproducible: hiSat 13–16% → 19%,
  `>245` 1.9% → 1.1%.

---

## 16. The devtools MCP servers (§5.29)

Two MCP servers were added to `~/.config/opencode/opencode.json` (user scope):

```json
"threejs-devtools": { "type": "local", "command": ["npx","-y","threejs-devtools-mcp"],  "enabled": true },
"chrome-devtools":  { "type": "local", "command": ["npx","-y","chrome-devtools-mcp@latest"], "enabled": true }
```

Config was verified by parsing it and diffing against the backup: **purely
additive, no drift**, and `type: "local"` matches the existing convention
(blender, arxiv, zai). Both servers loaded — their tools are in the toolset.

### 5.29 The bridge only works through its own proxy

A trap worth recording, because the failure mode is silent:

**The threejs bridge does NOT see a page loaded directly on the game port.** It
injects a script via its own proxy, so the game must be opened at the **proxy**
URL, not the server URL:

```
wrong:  http://localhost:9100/__game__/riderash/        -> "No Three.js app connected"
right:  http://localhost:50496/__game__/riderash/        -> Bridge: connected
```

The proxy defaults to forwarding `:3000`; RideRash serves on **:9100**, so
`set_dev_port(9100)` is required first. With that done the bridge reads the live
scene: `find_objects` returns the procedural surface meshes by material name
(`deck`, `worn`, `crack`, `stone`, `plaster`), and `memory_stats` /
`texture_list` work.

### 5.30 What the new tooling found immediately

`memory_stats` reports something no existing harness ever measured — the gate
counts **draw calls**, never **VRAM**:

| | |
|---|---|
| total texture memory | **68.4 MB** |
| single largest texture | **21.4 MB — `sky_dusk.jpg`, 4112×1024** |
| geometries / materials / textures | 619 / 345 / 41 |

So the backdrop panorama is by far the largest consumer in a project whose
*asset* budget was deliberately cut to 1.1 MB (§5.10). The two panoramas are the
one declared deviation, so they are legal — but a 4K-wide sky is worth a
downsample if VRAM ever matters for the gate. Note this is a **new axis**, not a
regression: nothing before this tooling could see it.

**Caveat on `performance_snapshot`:** it reported `drawCalls: 1, triangles: 1`
because the read landed between the game's post-processing render passes. Those
two fields are unreliable on this game; use the gate's `draws` counter and
`memory_stats` instead.

**Caveat on `take_screenshot`:** returns a mostly-black frame, because the
bridge captures the canvas outside the `EffectComposer` pass. Use the harness
screenshots (`_shots/`) for visual checks; the bridge is for **scene graph,
memory and live state introspection**, which it does well.

---

## 17. The gameplay pass (§5.31–5.36)

The user reported "lots of issues in the gameplay; find out what's wrong and fix
autonomously". Every scalar harness was green, which meant they were measuring
the wrong thing. `PLAYTEST.md` is the full record, including **four false
positives of my own making** — recording those matters, because the same traps
will catch the next person and three of my first four "bugs" were not bugs.

### 5.31 Play the game, do not read the harness
The instruments that found everything below were `chrome-devtools-mcp`
(driving real key events at the live page) plus `threejs-devtools-mcp`
(introspecting the running scene). Two new harnesses were needed and written:
`_aggro.mjs` (does each rival commit an attack, and does it reach the player)
and `_whymiss.mjs` (wraps `Fighter.resolve` and classifies WHY a swing missed —
far / arc / along). "Never attacks" and "attacks miss" are different bugs with
different fixes, and only the second one was true.

### 5.32 The false positives (read `PLAYTEST.md` before testing input)
1. **A one-frame key press is not a key press.** Driving `keydown`+`keyup`
   inside one `setTimeout` at ~4 fps lands both in one frame, and `endFrame()`
   clears the edge before `player.update` reads it. Concluded "combat is
   broken". It is not: holding ≥3 frames works, and 30 realistic mashes took
   DELANEY 27 → 0 hp.
2. **Sampling during the countdown looks like a hung integrator.** `speed: 0`,
   `s` frozen, `steer: 0`, `lean: 0`. It is `gridInput` holding the grid.
   Always `waitOutCountdown` first.
3. **Reading `__GAME__` field names by assumption.** It publishes `over`, not
   `raceOver`, and has no `time`/`onRoad`/`camMode`.
4. **`performance_snapshot` mid-frame** reports `drawCalls: 1`. Use the gate's
   counter.

### 5.33 BUG — `Space` was declared twice, so BOOST was unreachable
`input.js` had `Space: 'boost'` **and** `Space: 'brake'`. A duplicate key in an
object literal silently keeps the last, so `KEYMAP.Space === 'brake'` and the
string `'boost'` appeared nowhere in the map. Every
`input.attackPressed('boost')` in `player.js` read a flag nothing could set: the
whole boost verb (`tryBoost`, `BOOST_FORCE 3400`) was dead from the day it was
written, and `index.html:138` already promised `<kbd>Space</kbd> boost`.

**This is the class of bug the gate cannot see.** Every harness tests the
physics *behind* a verb; none tested a verb's *input binding*.

Fix: `Space` moved to its own `EDGE_KEYS` table; `get brake` no longer reads a
`down.brake` field nothing sets. Verified: Space sets `boost: 1.54` and raises
speed 10.2 → 12.0; `S` still brakes 15.9 → 8.9.

### 5.34 BUG — rivals committed attacks they could not land
29 commits and 0-2 lands. `_updateATTACK` returned `attack` on the **entry**
frame of the ATTACK state, when the victim was merely *viable* and typically
**behind** — measured mean rejected angle **2.42 rad (~139°)**. `resolve`
correctly threw them all out.

Fixed: `_inSwingReach` mirrors the three tests `resolve` uses; the weapon is
re-picked at swing time from the current distance. Hit rate **12.5% → 28.6%**,
mean miss angle **2.42 → 1.78 rad**, and the player now actually takes damage
(hp 100 → 0 in a run where it was previously untouched).

### 5.35 BUG — the gate was measuring its own input timing
`riderash-gate.mjs` fired keydown and keyup in the same task, so the game never
saw a punch. It reported "56 punches thrown, 8 hits" and **passed**. Now each
press dwells 4 frames; reported throws fall 168 → 26 (the count is finally
honest) and the hit rate reads **53%** instead of 4.8%.

**A harness that drives input must dwell across at least one frame.** This is
the same lesson as §5.31(1), and it was sitting in the project's own gate.

### 5.36 Also fixed / tuned
- **`world.js` `dir` comment was backwards** from its own code — `dir = +1` is
  ONCOMING, and the comment read as the opposite. Anyone testing traffic
  collision from it concludes the feature is missing (§ PLAYTEST).
- **Traffic hit box** `1.35 / 2.9` against a car of `0.91 / 2.15` — half again
  wider than the car, which is why "the cars don't collide" is a reasonable
  belief. Now `CFG.TRAFFIC_HIT_HALF_W: 1.15`, `_L: 2.60`. `pinnedFrames` stayed
  **0** over 12 `_nondet` runs — the specific risk, since a tighter box near the
  rail caused the 229-frame pinning in §5.5.
- **Races shortened** ~5000 m → ~3105 m (coastal) / 3290 (canyon) / 3165 (city),
  i.e. ~94 s → ~58 s. Authored sector proportions and biome order untouched.
  Finish/results/restart re-verified.

### 5.37 State after the pass
`gate` all checks passed (peak 52.2 m/s, 8 hits from 15 swings, draws 797/900) ·
`_nondet` 4×3 runs, `pinnedFrames` 0 · `_racefinish` clean · `_gamecheck`
`errors: none`.

**Correction to §5.26:** traffic collision was never missing and rivals were
never passive. Both were real systems with real defects elsewhere — the hit box
size and the swing timing — and in both cases the first plausible explanation
was wrong. Test the layer the symptom is in before rewriting the layer below it.

### 5.39 BUG — the seating fix stopped at the hero; the whole pack was still off
The user said "again misalignment there" and "look at the seatings" **after** the
player's seat had been fixed. That was the correct read and the fix had been
half-done, which is worse than not done: it makes the defect look fixed.

Two independent displacements, both present on all five rivals:
1. **Rivals never called `bakeStatic`.** `assets.bike` sits at
   `(0.501, 0, 0.288)`; `mergeByMaterial` bakes each mesh's WORLD matrix into the
   geometry and returns a group at the identity, so a *cloned-but-unbaked* bike
   carries a half-metre sideways offset on its own. `player.js` bakes; `rivals.js`
   did not.
2. **Rivals still used the old literal seat `(0, 0.62, -0.22)`** in three places
   (construction, idle rest, crash pose). That literal was itself compensating
   for defect 1. `player.js` had already moved to `CFG.SEAT_*`.

Net effect: the hero looked seated and the pack did not — exactly the reported
symptom.

Fix: rivals call `bakeStatic` (keeping its return value, as `player.js` does) and
every rider position reads `CFG.SEAT_*`. Measured live over all five:

    bike box x  -0.248 → 0.248   (dead centre; was 0.19 → 0.81)
    bike ctr    (0, 0.56, 0)
    rider       (0, 0.78, -0.05) == CFG.SEAT_*

**Lesson: when a transform bug is found, grep for the literal everywhere.** The
seat was one fact written in six places; fixing one of them produced a frame that
looked right and a pack that did not.

### 5.40 Rival distance culling — the field size is a SIMULATION number
Nothing ever culled rivals: the constructor does `scene.add(this.group)` and no
code path ever set `group.visible`. So draw cost scaled 1:1 with field size, and
raising the field toward Road Rash's ~15 would have multiplied the budget for
silhouettes off screen.

Road Rash's field was ~15 riders spread over miles, but you contested 2–4 at a
time. That is the model: **simulate the whole field, draw what is near.**

`CFG.RIVAL_CULL_FAR: 900`, `RIVAL_CULL_NEAR: 980` — a hysteresis band (draw
inside 900, hide past 980) so a rider at the boundary cannot strobe. Distance is
`hypot(Δs, Δlateral)` against the player, computed in `update()`; `applyVisual`
early-returns when hidden.

Verified live: a rival forced to `_cullDist 1264` went `visible: false` while the
other four at 2–11 m stayed drawn, and it **re-appeared** on return (hysteresis
confirmed). Draws fell with the visible count. Riders beyond the band still race,
still place, and can still be attacked when caught — they are only not paid for.

### 5.41 THE AGREED SHAPE (user, this session) — build to this
Settled with the user directly. These are the stopping condition and the rules
that were previously guessed at:

- **Done = 5 levels × 5 tracks = 25 races.** Each level replays the same five
  courses, harder, and **higher levels run the courses LONGER** — the track you
  learned in L1 keeps going past where it used to end. 25 races × 90 s–3 min ≈ a
  1–2 hour career.
- **Purse: top-3 only, scaled by level.** Bikes get dramatically more expensive
  per tier. Pacing rule: **one full level's winnings ≈ one bike tier**, so the
  player is permanently one class behind the field. Never comfortably rich.
- **Loss condition = the punishment meter, not a soft-lock.** Crashes accrue
  damage; repairs are billed at results **before** the prize is usable; cash
  going negative ends the career ("you're out of the game"). The damage meter
  must be **visible during the race** so the last crash is a decision. Cop fines
  are a second, larger bill on the same meter.
- **This is why 4th matters:** you advance but earn nothing, so a crashy 4th
  sets you backward. Advance at 4th or better; money at top 3.
- **Race length: faithful and VARYING.** Shortest ~90 s, longest ~3 min, spread
  between. Equal-length tracks is what makes five tracks feel like one track with
  different textures. Retry must be instant; cap the long track at ~2:30 until it
  is.
- **Five tracks as palettes/layouts over the existing system**, not a new
  component: Sierra Nevada (short opener) · Pacific Coast · Napa Valley ·
  Peninsula · Palm Desert. Locale tint per track; **only Palm Desert is
  yellow-brown.** This is what makes the mustard verge correct in one place
  instead of wrong in three.
- **Pack aggression = commit state machine, per rival:**
  `SEEKING → ALONGSIDE (in arc, |Δlong| < ~1 bike length) → hold ~1.0 s →
   SWING (commit, ~0.4 s anim, resolve) → COOLDOWN (3–5 s, no Seeking)`.
  Leaving ALONGSIDE before the dwell completes **aborts the wind-up** (no hit,
  short ~1 s re-arm). The dwell *is* the telegraph, and the counterplay is
  braking / accelerating / drifting a lane — evasion becomes a skill. Cooldown is
  **per rival**, so a 3-rival pack is a gauntlet and 1 is survivable: emergent
  difficulty, no difficulty scalar.
- **Three INDEPENDENT feel series, never summed:**
  `rival hits taken 2–4 / race` · `crashes 1–3 / race (clean run possible, rare)` ·
  `oncoming near-misses: high and constant`. If hits are in band but it still
  feels mauled, the culprit is crash frequency or the post-crash penalty — you
  would never see that with one damage counter.
- **Roster: keep the specialties, ADD THE BANTER.** RR1's cast expressed
  personality through trash talk (taunt screens between races), not stat blocks.
  Banter is cheap and delivers most of the character.
- **Input stays RR1-faithful:** one attack button, swing at whoever is beside
  you. **No directional-attack rework** (that is RR2) unless deliberately chosen.
- **Process:** ask on anything that changes a system's SHAPE (input scheme, race
  length, progression rules); go autonomous inside an already-agreed system. The
  three corrections this session were all shape decisions.

### 5.43 THE PACE LEASH — the real "rivals hover around the player" bug
The user reported this twice. The first pass (§5.28) fixed `HUNT_RANGE` (30 → 12)
and the victim scoring, and measured that HALVERSON/DELANEY now spend most of
their time in RACE rather than HUNT. That was real but it was **not the cause**.

The cause was `NpcBrain._paceIntent`, and it was structural:

    target = facts.player.speed * speedBias + (home - lead) * gain

Every rival's desired speed was **the player's instantaneous speed** times a
multiplier near 1.0, plus a spring pulling it back toward a position `home`
metres from the player, hard-clamped inside ±`AHEAD_LIMIT`/`BEHIND_LIMIT`
(9 m / 12 m). Measured, before the fix, with the player at 24 m/s:

    all 14 rivals inside ±10 m of the player, every one doing 33-38 m/s

Not a race. A swarm. And no purchase could ever change the outcome, because the
field matched whatever the player did — which also flattened the garage economy
the whole progression rests on.

**The fix (user's specification, this session): ABSOLUTE PACE, NO LEASH.**

- `NpcBrain.assignPace(reference, rank)` gives each rider a **fixed target
  speed** for the race, from `career.SERIES[].reference` (the level's expected
  bike top speed) and the rider's standing in the field (`paceRank`, derived from
  authored roster skill in `gridFor`).
- `_paceIntent` **no longer reads `facts.player` at all.** It holds
  `this.paceSpeed * speedBias`; `speedBias` became a small intrinsic trim, not a
  player multiplier.
- `PACE_GAIN`, `AHEAD_LIMIT`, `BEHIND_LIMIT` and `paceHomeFor` are **deleted**,
  with a note where they were, because leaving them is how the leash comes back.

**Reference paces are MEASURED, not guessed.** RAT sustains 46.1 m/s in the live
physics; the other tiers are that anchor scaled by the bike power multipliers
(49.4 / 52.0 / 55.0 / 58.1). The band is centred on the reference so the field is
**beatable**: the pace setter sits at the reference (the expected bike can just
beat him), the contenders a touch above (you need the next bike), the back
markers ~9 m/s below. Verified spread at L1: 36.9 .. 46.6 m/s over 14 riders.

**Measured after the fix** (fast player, RAT, Level 1, one run):

| player s | position | furthest behind | ahead | rivals <30 m |
|---|---|---|---|---|
| 103 | 11th | -10 m | +18 | 14 |
| 291 | 6th | -36 | +10 | 11 |
| 453 | 2nd | -92 | +3 | 7 |
| 618 | **1st** | **-120** | -9 | **2** |

The field strings out, the near-pack thins from 14 to 2 as you pull away, and
draw calls fall 1243 → 539. A slow player sits mid-pack fighting the cluster —
which is the honest outcome and the pressure to buy a better bike.

### 5.44 SIMULATION LOD — fourteen riders for the price of a few
A rival beyond `CFG.RIVAL_LOD_FAR` (420 m) takes the cheap path in
`Rival._updateLod`: hold the assigned absolute pace, hold the lane, run the
physics and the fighter, **spend no AI** — no `buildContext`, no `think`, no
victim selection. Hysteresis at 360 m.

This is a LOD, **not a leash**: it never reads the player's speed and a far rider
is never pulled back toward you. It travels, it holds its place in the standings,
and a player who closes on it finds it where the field says it should be — it
just stops thinking while nobody can see it. Verified: a forced-far rider at
701 m entered LOD, held 35.4 m/s toward its 36.9 target, with 14/14 moving and
zero NaN.

**Two bugs found and fixed while wiring this, both by measurement:**
- `CFG.RIVAL_SPEED_SPREAD` was deleted with the old pace block but still read by
  `resetRace`'s grid, so `speed: NaN` — every rival reset to NaN and the whole
  field's `s` went NaN. **A deleted constant used elsewhere is silent.** Now a
  literal with a comment.
- The 14-rider grid was generated with five-entry arrays modulo'd, stacking three
  riders per slot. Now rows of four across the road.

### 5.45 DRAW-BUDGET MEASUREMENT for a 14-rider field — the decision point
`gate` now fails ONE check: `draw calls 1024 exceed the 900 budget`. Everything
else passes (throttle 326.8 m / peak 49.2 m/s, steering, 8 hits from 48 swings,
3 knockdowns, camera roll 0.000, fps).

Measured properly rather than from the gate's single sample:

    world + player alone ............ 429 draws
    world + player + full pack ...... 971 (min) .. 1177 (p50) .. 1282 (max)
    per visible rival ............... ~49 draws  (49 meshes, 45 UNIQUE materials)

So the pack costs ~750 draws and the field is over budget for the WHOLE race,
not only at the grid. **The rider is the cost: 38 of the 49 meshes per rival are
the rider rig, and almost no materials are shared.**

Per the user's stated priority order (cull -> raise budget and measure -> reduce
field), culling is done and this is the measurement. The remaining options:

1. **Merge each rival's rider by material** — the same trick that cut the
   player's rig. A jointed rig cannot merge fully, but ~38 unmerged meshes with
   45 unique materials suggests per-part merging is available. Expected to cut
   the ~49/rival substantially; unknown until measured.
2. **Raise the budget and measure frame time** — the budget was inherited, not
   derived (user said so explicitly), and the game holds 60 fps with 1282 draws
   on this machine. But "one machine" is not the minimum target.
3. **Reduce the field** — the ONLY option that changes the game rather than the
   rendering, and the user named it last for exactly that reason.

This is unresolved and needs a decision before more tuning, because field size
affects race feel, the three-series harness, and the pace distribution.

### 5.46 THE MERGE, AND WHAT THE DRAW BUDGET ACTUALLY IS
**`mergeJoints`** added to `assetlib.js`, called from `ASSET()` immediately after
`resolveDeclarations` (order is load-bearing: it finds joints by the `__part__`
prefix, so merging first would silently do nothing).

The measurement that chose the design:

    rider meshes .................................... 38
    per joint, merging by MATERIAL OBJECT identity ... 35   (saves 3)
    per joint, merging by APPEARANCE (materialKey) ... 27   (saves 11)
        ... the chain alone:                            7 -> 1

The rig is **material-bound, not mesh-bound**: 38 meshes carry 35 distinct
material objects, which have only **9 distinct appearances**. Keying on
`materialKey` -- the same key `mergeByMaterialValues` uses -- is what pays.
Merging happens WITHIN a joint, whose meshes never move relative to each other,
so the rig stays fully animatable; merging across joints would weld an elbow to a
shoulder. Verified live: rider 38 -> 27 meshes, chain 7 -> 1, and the rig still
poses.

**THEN THE NUMBERS REFRAMED THE PROBLEM.** Measured with `sceneStats` (the
post-scene-pass counter, not the mid-frame one):

    world + player, mid-track ............... 467 .. 562   (p50 515)
    world + player + pack at peak density ... 745 .. 773   (all 14 visible)
    pack's marginal cost at peak density .... ~240
    pack's cost with LOD+cull active ........ ~24   (only ~2-6 rivals draw)
    world ALONE, desert at s~1100 ........... 1084 peak, 51/120 samples over 900

So the desert track **breaks the 900 budget on its own, with the pack hidden
entirely.** The budget was never fundamentally about rival count. Two separate
facts, both true:
1. The merge paid off -- a visible rival went ~49 -> ~43 meshes, the chain 7 -> 1.
2. Culling + LOD mean only ~2-6 rivals ever draw, so the field costs ~24 draws
   in normal racing and ~240 only when all 14 are forced together.

**The gate's 977 is a real spike from the START-LINE scenery plus a mid-desert
scenery peak**, not from the 14 riders: at the grid, hiding all 14 rivals moved
draws by less than the measurement noise.

Per the user: 900 is a TRIPWIRE, not a law (inherited, no derivation). The real
budget is frame time on a minimum target machine. **That target machine is still
undecided, and it is a shape question to answer explicitly** -- until it is, the
draw count keeps silently constraining work that is actually about the world.

**THE ACTUAL BUDGET BUG WAS UN-INSTANCED CHEVRON BOARDS.** With the pack hidden,
the visible world mesh count broke down as `plaster 187, metal 112, foliage 88,
stone 81, fabric 55` -- 521 plain (non-instanced) meshes against only 35
instanced ones. The clutter (trees, rocks, bushes, bollards, hoardings) was all
already instanced. The culprit was `level.js`'s **hazard chevron boards**: one
`Group` per board with SIX child `Mesh`es (back panel, 3 chevrons, 2 legs), added
straight to the group, one board every 130 m over a 5600 m road -- **~43 boards,
~260 individual draw calls** for the single most expensive un-instanced prop in
the world. Exactly the same mistake the hoardings note already records, missed
for the chevrons.

Fixed by instancing each PART (5 instanced meshes total for the whole road,
regardless of board count). Measured on the desert track over 90 samples:

    p50 draws  865 -> 747
    max draws 1084 -> 938
    samples over 900  51/120 -> 3/90

**`gate` now passes ALL checks, draws 467 / 900** (was 977). There is headroom
for the desert peak and the cop layer.

**Lesson, and it is the same one as §5.39:** I spent the first half of this
investigation assuming the pack was the cost because the pack was what I had
recently changed. Hiding the pack entirely is what proved it was the world.
**When a budget regresses after a change, measure the thing you did NOT change.**

**The merge is verified to preserve animation.** Forcing a punch and sampling the
rival's arm every 60 ms appeared to show NO movement, which looked like the merge
had detached the rig. It had not: calling `applyAction` directly moved the arm
cleanly through -1.15 -> -1.31 -> -1.25 -> -1.19 -> -0.56. The samples had simply
all landed on the same frame at the harness's ~4 fps. **Same false positive class
as the one-frame key press (§5.31(1)) -- do not sample faster than the thing
being measured.** Joint resolution was confirmed correct at the same time:
`node(j,'armR_upper') === joints.rightArm.upper`, and the joint map points at
real in-scene nodes.

### 5.42 Still open
- **Cops (`cops.js`)** — Level-2+ escalation, mechanically an aggressive rider
  plus an arrest state on the same `NpcBrain` (`kind:'cop'` exists and is
  verified). Pack first, then cops. A cop fine is the second bill on the meter.
- **Banter layer** — between-race taunt screens from whoever beat or lost to you.
- **The three-series feel harness** — the instrument that would have caught the
  felt problems the scalar harnesses were green through.
- **C7 music / C8 pause+menus** — the third subagent stream never wrote a file.
- **C4** weapon pickups, defensive verb.
- Visual: hiSat 13–16% → 19%, `>245` 1.9% → 1.1%.
- **C7 music / C8 pause+menus** — the third subagent stream never wrote a file.
- **C4** weapon pickups, defensive verb.
- Visual: hiSat 13–16% → 19%, `>245` 1.9% → 1.1%.
- §6.6 pack-contact variance: `_nondet` `ds` now spreads 96–115 m as the pack
  fights harder. Bounded (`pinnedFrames` 0), but the spread grew with 5.34.

---

## §6 Rigging, connection and the boundary: the four defects in one session

The brief was four sentences and each one named a real defect. They turned out to
share a cause, which is why they are recorded together.

### 6.1 "Why is the bike moving when he's walking" — a PARENTING bug, not numbers

The rider was parented to the player **group** for the whole on-foot sequence,
with `rider.position` written as if in road space. But `player.phys` is the
walker's transform and the group carries it, while the BIKE is a separate child
that slides and spins after a crash. So every on-foot write to `rider.position`
was applied in the wrong frame, and the moving bike dragged the walker with it.

three.js composes a node as `matrix = T * R * S` (`Object3D.updateMatrix`), so
`position` is applied in the PARENT's space and `rotation` turns the node about
its OWN origin — which is also exactly why the rider could separate from the bike
when it leaned. The old code "fixed" that by hand-rotating the seat offset by the
visual lean, duplicating in one place what a parent transform does for free, and
still pivoting about the wrong origin.

**The fix is a MOUNT SOCKET: `group -> bike -> socket -> rider`.**

- `player.js` / `rivals.js`: an empty `Object3D` is parented to the BIKE at
  `CFG.SEAT_*`; the rider is parented to the socket at the origin.
- Bike lean, wheelie pitch and air offset now carry the rider **by construction**.
  There is no offset to rotate and no sign to get wrong. Verified live:
  `lean -0.516, bikeRotZ -0.516, riderRotZ -0.093, parent "riderSocket",
  riderPos [0,0,0]` — pelvis on the saddle exactly.
- `dismount._setRidingRig(riding)` re-parents on the crash and on the remount,
  using `Object3D.attach` on the way out so the world transform is preserved and
  the swap cannot pop.
- The rival had the same bug **worse**: bike rolled `-p.lean*0.92`, rider rolled
  `+p.lean*0.30` — opposite signs — so every cornering rival leaned off its own
  saddle. Now both inherit the socket.

This is the standard attachment pattern. `Object3D.attach` re-parents while
preserving world transform; a socket is the declarative form of the same idea,
and is what Unity's child-of constraint and glTF node parenting express.

### 6.2 The walker was PRONE the whole way home — a latched-vs-clock bug

`poseOnFoot` computed `rise = easeInOut(this.t / STAND_TIME)`, and `this.t`
**resets to 0 on entering WALKING**. So the blend was 0 for the entire walk:
torso stayed at its -1.05 prone fold, arms splayed, legs trailing. The rise
animated during the 0.95 s STANDING beat and was then thrown away. Photographed
in the filmstrip as frame 16 (WALKING t=0.25) already horizontal.

The rise belongs to the BODY, not the state's clock. It is now `walk.rise`, which
**ratchets** to 1 over STAND_TIME and stays there. Verified: walking-frame torso
`-1.10` (was `-1.05`), thighs on the standing values, rider upright in the crop.
`_renderMounting`'s hard-coded `0.62` was also a second, independent seat height;
it is now `CFG.SEAT_Y`, so the rise lands exactly on the socket.

### 6.3 The boundary: 7.5 m was sized for a lane count, not a 15-rider field

At 7.5 m the carriageway was 2.08 bike-widths across and less usable once the
rails are excluded, so a 15-rider field had nowhere to be three-abreast: the pack
compressed into one line, every pass was a shove, and the commit-window attack
had no room to get ALONGSIDE. **The road was the binding constraint on the
combat.**

- `CFG.ROAD_W` 7.5 -> **11.0** (~3.05 bike-widths each side; 3 lanes at 3.6 m).
  Everything derives from it — deck, kerbs, rails, scenery, radar, AI limits — so
  the widening propagates without a second edit.
- `laneHomeFor` was an **absolute** table `[-3.1, 2.9, …]` authored for 3.75 half.
  Left alone it would have kept every rival in a 6 m band of an 11 m road. It is
  now **fractions of the half-width** (the old metres / 3.75), so it keeps its
  shape at any width and is provably identical at the old width.
- The grid went 4 columns -> **5** across ±4.4 m.
- A **centreline** was added as instanced dashes, which is what makes the
  oncoming traffic legible.
- **`buildTraffic` lane side is now DERIVED FROM DIRECTION.** It was
  `(ROAD_W/2-0.9) * coinflip` with the direction drawn independently, so an
  oncoming car could appear in your own lane. Invisible at 7.5 m where every car
  sat near the centreline; at 11 m it is a truck bearing down on you in your lane.

### 6.4 The draw budget was the HILLS, and the merge was never broken

The road doubling and the wider view pushed the gate to **742/900**. Measuring
the scene instead of guessing found it:

- **`buildHills` built one `Mesh` per hill with a fresh `SphereGeometry` each
  time — 126 draws for scenery that never moves.** Now one `InstancedMesh` per
  layer, one shared sphere, **three draws total**.
- **Traffic cars were 6 meshes each.** The shell is now built at the origin and
  baked *before* placement (baking after placement folds the car's road position
  into its geometry and then applies it again). `worldMeshes 425 -> 267`.

**A false alarm worth recording.** The rival bike measured "38 meshes", which
looked like a failed merge. It is **11**: the other 27 are the RIDER, which is a
child of the socket and therefore *inside the bike's subtree*. Counting a subtree
is not counting the object. **The third time this session that measuring the
wrong thing produced a confident wrong answer** — see §5.41's lesson, which this
repeats one level down.

**Final: `gate` passes, `draws 220 / 900`** (was 742 before the fixes, 373 before
the wider road).

### 6.5 The rig, honestly: what it is and what it is not

The rider is a **hierarchical rigid-node rig** — `Group` nodes carrying box and
capsule meshes, addressed by `userData.joints`. It is **not** a `SkinnedMesh` and
it has **no `Bone`, no `AnimationClip`, no `AnimationMixer`**: `motions.js` holds
hand-baked keyframe **tables** that `riderpose.applyAction` samples and writes
straight onto `node.rotation`.

That is a deliberate consequence of §4.2, not an oversight:

- **NO IMPORTED MESHES. ANYWHERE. EVER.** Not in assets, not in game code, not as
  a reference. Geometry is built from three.js primitives or written into
  `geometry.attributes.position`.
- **Asset modules may not import, fetch or animate.** A glTF/skinned clip is a
  file, and there is no route to one.
- **Atlas is scoped to everything UPSTREAM of the code** (§10): reference images,
  bar frames, the two sky panoramas, and audio. It is explicitly *not* a mesh or
  animation-clip supplier. **The Atlas MCP is also currently unauthenticated in
  this environment — `ATLAS_API_KEY` is unset, so its tools do not load at all**,
  which is why it could not be queried for rigging features.

So "use the model and get the bone/skeleton animations" is blocked by the binding
rule, not by capability. **If the user wants real bone animation, the rule has to
change first** — that is their call and it should be made explicitly. The
alternative, which stays inside the rules, is to **extend the existing table
approach with the missing states** (acceleration, braking, cornering already
exist as procedural pose terms in `player.poseRider`; they can be promoted to
baked tables in `motions.js` the same way `punch`/`kick`/`chain` were).

---

## §7 RIGGING: can we rig a three.js object, and is it allowed?

The question was whether a real bone rig is possible here and whether it breaks
the rules. **It is possible, and it does not break them.** This section is the
evidence, and `harness/_skinproof.mjs` is the reproducible proof.

### 7.1 The rule, read exactly

`404.md` line 4: *"404 generates 3D as **code**: one JavaScript module per object
that returns a Three.js `Group`. **No mesh files, no downloads.**"*

`docs/asset-contract.md`: *"No imports, no network access, no `eval`, no timers,
no animation loop, no Node APIs."* — and the sentence that decides this whole
question: *"The permitted geometry list above is a starting point, **not a
fence**… writing to `geometry.attributes.position` after construction are all
fine and all in use… **What is forbidden is imports, files and the network, not
techniques.**"*

So the rule forbids **where geometry comes from**, not **what you do with it**. A
rig is a technique. It was never forbidden — nobody had asked the question
precisely enough to notice.

### 7.2 What three.js actually requires (read from the r169 source, not recalled)

- **`Bone` is 17 lines and is literally `class Bone extends Object3D { isBone=true }`.**
  No file, no data. A bone is a transform with a flag.
- **`Skeleton`** takes an array of `Bone`s, computes `boneInverses` with
  `matrixWorld.invert()` if you do not supply them, and writes `boneMatrices`
  into a **generated `DataTexture`**. Pure maths plus a texture built in memory.
- **`SkinnedMesh`** requires exactly two geometry attributes:
  `skinIndex` (4 bone ids/vertex) and `skinWeight` (4 weights/vertex). Both are
  ordinary `BufferAttribute`s you can write by hand from arrays.
- `Skeleton`, `SkinnedMesh`, `Bone`, `AnimationMixer`, `AnimationClip` and every
  `KeyframeTrack` are all **core three.js exports** (`src/Three.js`), not addons.
  No loader is involved at any point.
- The deformation is four matrix multiplies blended in the **vertex shader**
  (`skinning_vertex.glsl`), reading `boneTexture` via `texelFetch`. There is no
  CPU-side skinning and no external resource.

### 7.3 The proof

`harness/_skinproof.mjs` builds a 3-bone chain and a rigidly-skinned segmented
column **from primitives only**, in the live page, and then moves the bones:

| check | result |
|---|---|
| `Bone instanceof Object3D` | **true** |
| `bone.isMesh` | false |
| a translated root moves the tip | `[0,2,0]` -> `[2,2,0]` |
| a 90° root rotation swings it | `[2,2,0]` -> `[-2,0,0]` |
| `AnimationMixer` + hand-written `QuaternionKeyframeTrack` | interpolates `[0,0,0.383,0.924]` -> `[0,0,0,1]` |
| loader / file / network required | **none** |
| page errors | none |

**A rig that "renders perfectly and never moves a limb" is this project's named
failure class (§5.12), so the proof measures MOTION, not a screenshot.**

### 7.4 What this means for the rider, and the honest cost

The current rider is a hierarchical **rigid-node** rig — `Group`s carrying boxes
and capsules, driven by `motions.js` tables written onto `node.rotation`. It is
legal and it works, and everything above says a **`SkinnedMesh` rider is equally
legal** and would give real skin deformation instead of visible seams between
rigid segments.

Three honest caveats before anyone starts:

1. **It is a rewrite of the rider, not an addition.** `assets/rider.js` becomes a
   bone chain plus a skinned body, and every pose in `riderpose.js`,
   `player.poseRider`, `rivals.poseRider` and `dismount.poseOnFoot` has to be
   re-expressed against bones instead of nested groups. That is a large, risky
   change to a system that currently passes every check.
2. **It buys deformation, not animation.** Bone animation is only as good as the
   clips, and clips still have to be authored as keyframe tables in code —
   `motions.js` already does exactly this and is the model to copy. There is no
   free motion to import.
3. **`AnimationMixer` is optional.** For a rider that is posed procedurally from
   physics every frame, writing `bone.rotation` directly (which is what
   `riderpose.applyAction` already does to groups) is simpler and has no mixer
   overhead. The proof shows the mixer works if a clip is the right shape; it
   does not argue you should use one.

**Recommendation: not now.** The rider passes every check, the four defects in §6
were connection bugs rather than a rig limitation, and a skinned rewrite is the
single largest change available to the project at the moment it is at its most
fragile. Recorded here so the decision is available and evidenced rather than
mysterious. If the rider is ever rebuilt, this is the sanctioned route and §7.3
is how you verify the rebuild did not silently stop animating.
