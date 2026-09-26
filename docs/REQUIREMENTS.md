# RideRash — components, status, and execution order

**How this is worked.** The game is split into nine components. One component is
taken at a time and finished. Measurement runs **once per component**, not once
per edit.

**Bar.** A worthy successor to Road Rash: a pack brawl at 100+ mph that is
*complete* — it starts, it progresses, it ends, it rewards.

**Hard rules** (`HANDOFF.md` §4.2): no imported meshes ever · no texture files
(the two sky panoramas are the one declared deviation) · no glyphs in the game
world · generated audio is fine · one folder, no build step.

**Verification suite** — the whole thing, once per component:
`riderash-gate` · `ship` · `_nondet` · `_measure` · `_gamecheck`

---

## Component status

| # | component | state | owns |
|---|---|---|---|
| C1 | Handling & physics | **mostly done** | `physics.js` |
| C2 | Pack AI & contact | **11/12 clean** | `rivals.js`, contact pass |
| C3 | Race loop & progression | **done** | `main.js`, `career.js`, `index.html` |
| C4 | Combat | partial | `combat.js`, `player.js` |
| C5 | World & traffic | **done** | `world.js`, `level.js`, `worldspine.js` |
| C6 | Camera & framing | **done** | `cameramodes.js` (data) + `main.js` (math) |
| C7 | Audio | **partial — music missing** | `audio.js` |
| C8 | HUD & menus | **partial — pause/menus missing** | `hud.js`, `radar.js`, `index.html` |
| C10 | NPC behaviour engine | **done** (`npc.js`, FSM + 4 personas) | `npc.js` |
| C11 | Dismount / walk / remount | **done** (12.03 s full cycle, zero input) | `dismount.js` |
| C9 | Harness & measurement | **done** | `~/404-game-recipe/harness/` |

**C10 and C11 landed** (HANDOFF §5.22–5.25). Both verified by reading the
filmstrip pixels, not just the gate — the gait is anti-phase and the walker is
framed on screen.

**The audio/front-end stream produced NO files** — no `menu.js`, and
`audio.js` / `hud.js` / `index.html` keep their pre-dispatch mtimes. C7 music
and C8 pause/menus are **not started**, not "in flight".

---

## C1 — Handling & physics  *(the model is now correct)*

Done: correct lean→yaw (`g·tanθ/v`, was wrong by 180×) · arcade assist as a
lateral-g budget, player-only · tyre relaxation length · full `BikePhys.reset()` ·
strand rescue · off-road recovery · **wheelie/stoppie, boost, jumps, slipstream**.

**The three handling faults, found with `_trace.mjs`** (HANDOFF §5.19) — none of
which any scalar-reporting harness could see:

| fault | was | is |
|---|---|---|
| `laneHome` initialised as an **array** → string concat → NaN through every rider | frozen game | a number |
| `TYRE_LAT_PEAK` in the wrong units — **9.4 g** of side force | bike flung off the road by its own cornering | 1.35 g |
| `slip` measured against the **road**, so the bike could only slide, never track | steering felt disconnected | measured against actual velocity |

Measured after: speed ramps and **plateaus** at 49.5 m/s · `onRoad` 1.00 for a
whole run · `lateral` inside ±1.3 m with no input · `_nondet` **4/4 clean, zero
pinned frames** · lane change in ~1.7 s.

Remaining:
- **C1.1** Wheelie / stoppie — the weight-transfer model already computes load
  fractions (0.42→0.87 under brakes); expose them as a pose and a gameplay verb.
- **C1.2** Boost with cooldown, for overtakes.
- **C1.3** Jumps off crests (road is 5.6% now) with a landing that can be
  botched.
- **C1.4** Slipstream behind a rival.

## C2 — Pack AI & contact  *(11/12 clean)*

Done: rivals pull alongside instead of into the victim · lane homes moved off
the centreline · `Rival.reset()` · starting grid staggered around the player ·
contact impulse absorbed at the rail rather than adding energy.

Remaining:
- **C2.1** `_nondet` is **11/12 clean** (was 3/12). The one failure is a 27-frame
  (0.45 s) excursion that recovers. Closed enough to move on; the remaining path
  if it regresses is to log every contact with both riders' `s`, `lateral` and
  impulse.
- **C2.2** Rival personalities: aggressive / clean / blocker, readable per rider.
- **C2.3** Rubber-banding so the pack stays racing rather than strung out.

## C3 — Race loop & progression  *(done)*

Done: finish line, results screen, restart — verified end to end by
`_racefinish.mjs` ("YOU WIN", 1st of 6, clean restart, no page errors).

Done: 3.2 s countdown with a real standing-start grid (pack staggered around
the player, controls locked) · prize money by position · five-race series in
`career.js`, `localStorage` persisted and validated on read · three buyable
bikes · per-race skill/aggro scaling · career strip and garage on the title
screen.

**Per the current direction, no more depth here** — mechanics and visuals first.

## C4 — Combat  *(partial)*

Done: punch / kick / chain on cooldowns · MDM-baked motion on all six riders ·
knockdown and remount · disarm.

Remaining:
- **C4.1** Weapon pickup — take the chain off a rider rather than owning it.
- **C4.2** A defensive verb (block or lean-away) so combat is two-sided.
- **C4.3** Bike condition: damage degrades handling.
- **C4.4** Cops — the Road Rash signature, with a bust state.

## C5 — World & traffic  *(done)*

Procedural surfaces · road elevation 5.6% · traffic path-follows in both
directions in lanes, with collision and near-miss horn · biome spine.

## C6 — Camera & framing  *(done)*

7 modes on `C` / `1`–`7`, measured by `_cams.mjs`. Hero 0.357 of frame height
against a 0.34 bar, now stable across runs.

## C7 — Audio  *(partial)*

Done: engine, impact, scrape, crash, swing, horn, skid.
Remaining: **C7.1** music per biome · **C7.2** crowd/finish sting.

## C8 — HUD & menus  *(partial)*

Done: radar, position, speed, timer, distance, health, combo, warnings.
Remaining: **C8.1** pause + settings (volume, default camera) ·
**C8.2** results polish · **C8.3** map/bike select.

## C9 — Harness & measurement  *(done)*

`_measure` samples at a **fixed `s = 420` and a fixed speed**, and reports the
state it sampled at. Verified reproducible: hero 0.358/0.358/0.358 and p98
244/244/243 on three consecutive runs. It previously swung p98 209–246 and
saturation 4.9–19.5% on *identical builds*, which made two tuning passes
meaningless.

Fixing `s` alone was not enough: a contact on the way leaves the bike slower,
and the chase camera's distance scales with speed, so the hero's size still
moved (0.358 vs 0.48). Both have to be pinned.

`_nondet` and `riderash-gate` now wait out the grid countdown, or five seconds
of measurement is mostly a stationary bike.

Also: `_racefinish` · `_cams` · `_carhit` · `_carnear` · `_steerfeel` ·
`_blown` · `_whatis` · `_jointdump` · `_drift`.

---

## In flight — parallel workstreams

Three agents, **disjoint file ownership** so they cannot conflict. None touches
`main.js`; each reports the wiring it needs and integration is done centrally.

| stream | owns | task |
|---|---|---|
| **NPC engine** | `npc.js` (new), `rivals.js` | explicit FSM — RACE / HUNT / ATTACK / EVADE / RECOVER — with personas. Rivals output a control *intent*, never write to `BikePhys`. Shared so cops reuse it. |
| **Dismount & walk** | `dismount.js` (new), `player.js`, `motions.js` | crash → rider and bike separate and slide to rest → stand → **walk to the bike** → remount. Procedural gait on the existing joint rig. |
| **Audio & front-end** | `audio.js`, `menu.js` (new), `index.html`, `hud.js` | procedural music (Web Audio, no files), finish sting, pause + settings, results polish |

Reserved for central integration: **cops** (`cops.js`), which build on the NPC
engine, and all `main.js` wiring.

## Execution order

Per the current direction — **mechanics and visuals before depth**:

1. **C1** — riding verbs: wheelie/stoppie, boost, jumps off the crests,
   slipstream. These are what the ride is missing, and the weight-transfer model
   already computes everything they need.
2. **C4.1–C4.2** — weapon pickup and a defensive verb, so the brawl is
   two-sided rather than a damage race.
3. **Frame quality** — close the last of the saturation gap and the single
   sun-specular cell that carries all the clipping.
4. **C4.4** — cops.
5. **C7 / C8** — music, pause, menus.

## Frame metrics, against the reference

Measured at a fixed `s = 420` **and** a fixed speed, so these now repeat.

| metric | now | bar | note |
|---|---|---|---|
| hero height fraction | **0.358** | ~0.34 | 0.358 on three consecutive runs |
| p98 luma | 244 | 239 | |
| pixels > 245 | 1.9% | 1.1% | one sun-specular cell carries all of it |
| high-saturation | 13–16% | 19% | was 6.7% before the zenith chroma lift |

**The saturation fix was the sky, not the ground.** Gridding the frame showed
the sky occupying ~42% of the picture and contributing **0.2%** of the
saturated pixels — photographic panoramas are hazy. Deepening chroma toward the
zenith (where a real sky has less atmosphere to look through) took the whole
frame from 6.7% to 13–16%. Every previous attempt pushed the *verge* instead and
produced a slab of mustard.
