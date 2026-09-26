# HANDOFF_UPDATE — RideRash, the jam-submission session (24–26 Sep 2026)

**Read this first if you are picking RideRash up cold.** It records everything
done in the Claude Code session that took the game from a 74-commit work branch
to a deployed, gate-passing 404 Game Jam entry with a trailer. The older build
record (how the game itself was made) is in `docs/`; start there after this.

---

## 1. What RideRash is

A 3D motorcycle combat racer in Three.js (0.169, via import map from
jsDelivr): a pack of rivals, punches / kicks / chain / grabs at 100 mph, cops who
ambush, chase and arrest you, a five-level career, a garage of bikes, six
courses (Sierra Nevada, Pacific Coast, Napa Valley, Peninsula, Palm Desert, and
the Ghat cliff road). **Every 3D object is Three.js code** — no meshes, no
texture files except two sky panoramas. One folder, no build step.

| | |
|---|---|
| **Play** | https://riderash.vercel.app/ (Vercel production, builds `main`) |
| **Source** | https://github.com/karvachiik-lgtm/riderash (public) |
| **Jam entry** | https://github.com/404-Repo/404-game-jam/pull/30 |
| **Owner** | GitHub `karvachiik-lgtm`, X `@GFaang97609` |
| **Trailer** | `media/riderash-trailer.mp4` on branch `trailer` (and `handoff`) |

---

## 2. Branches (all on origin)

| branch | what it is | state |
|---|---|---|
| `main` | **the game as deployed and entered.** Head `6ee4d30` | live on Vercel |
| `handoff` | `trailer` + this file | newest of everything |
| `trailer` | `main` + the trailer video + `tools/trailer/` | not merged (does not change the game) |
| `claude/exciting-lamport-7yqyaa` | the earlier session's 74 commits (cops, arrests, one-wheeler, menus…) | fully contained in `main` |
| `claude/relaxed-cray-bsi7rh` | this session's first work (arrest fixes, garage bikes) | merged into `main` |
| `submission`, `submission-prune`, `submission-draws`, `fix-radar-pill` | one PR each, below | merged into `main` |

**Rule the owner set:** never push to `main` (or any existing branch) without
being asked. New work goes on a new branch; `main` changes only by a merged PR,
because Vercel redeploys `main` and the jam entry names a commit on it.

### Pull requests on `karvachiik-lgtm/riderash` (all merged)

| PR | branch | change |
|---|---|---|
| #1 | `submission` | repo cleanup for the jam (below), README, meta description |
| #2 | `submission-prune` | race music loads on demand → gate weight 10.2 → 9.2 MB |
| #3 | `submission-draws` | lighter *medium*-tier scenery → gate draw peak 901 → 859 |
| #4 | `fix-radar-pill` | radar AUTO/FOCUS/FULL pill hidden whenever the radar is |

---

## 3. What was done, in order

### 3.1 Read the project
The repo arrived as one "Initial commit" (24 Sep) on `main`; the real history
was on `claude/exciting-lamport-7yqyaa` (another session). This session's
branch was fast-forwarded onto it.

### 3.2 The arrest / bust scenes — fixed on the real rigs (`80fb41a`)
The owner's screenshot showed the cop walking up **upside down**. Root cause:
the on-foot gait (`dismount.poseOnFoot`) adds pelvis sway with `+=` and relies
on `ragdoll.restoreRest()` to undo it each frame; a cop never thrown by a
ragdoll had no rest snapshot, so the sway accumulated (pelvis roll 0 → 2.8 rad).
Fixes in `src/arrest.js`, `src/cops.js`, `src/main.js`:
- rest poses captured (`ensureRest`) for the cop at build and suspects at arrest
- step-off blended out of the riding pose (was a 2.2 rad one-frame torso snap)
- bodies eased onto the road, never through it; walker height follows the road (`roadY`)
- the cop walks to a **fixed** spot beside the suspect and squares up (a spot
  measured from himself spiralled him onto the seat); `WALK_MAX` 5.5 → 9 s
- the target is the suspect's body (pelvis), not the bike or the feet
- **cuffs on the wrists by two-bone IK** (`limbik.solveLimb`): each hand to its
  wrist; the near wrist in both hands for seated / sprawled suspects; bend at
  the waist only as far as needed; a sprawled suspect's arm is hauled up, a prone
  one's hands lifted
- a collared player's bike no longer paddles backwards (brake held at a
  standstill is the reverse; `STOPPED_INPUT`)

**`tools/arrestcheck.mjs`** — the harness that found and proves these: every
variant (cuff, ticket, lecture, knees, ground) × place (straight, bends, hills)
× side × lane × suspect state × 30/60/144 Hz, rival arrests, skip, repeat busts.
Per-frame checks: posture, joint drift, ground (raycast on the real road),
continuity, contact, suspect pose, parked bike, script, teardown. Writes a
filmstrip + `tools/out/arrest/sheet.png`. **35/35 passed.** See `tools/README.md`.

Harness hooks added to `main.js`: `__SIM__(sec, render, dt)`,
`__ENDINGS__.arrestRival(i, variant)`, `window.__KEEP_BUFFERS__`.

### 3.3 Garage cards show their bike (`9d9fa7f`)
`src/garagebikes.js`: each garage card has the real model (class + livery from
`kit.js`), still, turning slowly through 360° on hover/focus (6 s a turn),
easing back on leave; no spin under reduced motion. One shared offscreen WebGL
renderer copies into each card's 2D canvas (no extra contexts).

### 3.4 Jam cleanup (PR #1)
Removed ~150 MB the game never loads: `_shots/`, `_playtest/`,
`.playwright-mcp/`, and six large AI "quality bar" reference PNGs from `_refs/`.
Moved the build record into `docs/` and the small Atlas references into
`docs/refs/`. Added `README.md` (controls, how it is made, every non-code file
declared) and a root `.gitignore`. Meta description no longer names Road Rash
(the jam bans trademarked names; code comments mentioning it are design notes).

### 3.5 Passing the jam gate (PRs #2, #3)
Gate = `node harness/jam.mjs <url> --start="#start" --commit=<sha>` from
`404-Repo/404-game-recipe` (phone viewport, 4G, real touch). **`--start="#start"`
is required** (the game's start button is `#start`, not `#startb`).
- Weight 10.2 MB > 10: all four race music tracks (4.2 MB) were fetched at boot
  → `src/soundtrack.js` loads a race's track when the race picks it.
- Draws 901 > 900 on the start grid (medium tier = phones): measured breakdown
  riders ≈ 60 draws each, scenery ≈ 270 → medium scenery now
  `visR 700, nearR 150, density 0.5, grass 0` (`src/scenery.js` SCENERY_TIERS).
  Shadows off saved nothing (the gate does not count the shadow pass).

**Last verdict (owner's M4, against `riderash.vercel.app`): PASS** — ready 10.0 s,
weight 9.2 MB, draws 859/900, tris 625k, 0 errors, 0 404s. (That run was
stamped with an older `--commit`; see §5.)

### 3.6 Radar pill bug (PR #4)
The AUTO/FOCUS/FULL pill (on `<body>`, outside the HUD) stayed on screen over
the intro, cutscenes and menus. `radar.js` now judges the dish's real
visibility (`checkVisibility`, ancestors' opacity included), hides under
`body.cine` and the intro, and `syncPill()` runs every frame from `frameBody`.

### 3.7 The jam submission
Entry `entries/riderash.json` on the owner's fork (`karvachiik-lgtm/404-game-jam`,
branch `patch-1`), PR **404-Repo/404-game-jam#30**: play
`https://riderash.vercel.app/`, commit `645b7d2…`, genre racing, agent
"Claude Code, opencode", models Claude / DeepSeek / Atlas, wallet "later",
contact `@GFaang97609`, a "what I found" paragraph (the brawl, cops who arrest
you on the real rigs, everything built in code). **It was opened after the
25 Sep 23:59 UTC deadline**; the rules say late PRs are not judged — the owner
posted in the 404 Discord to ask.

### 3.8 The trailer (`trailer` branch)
`media/riderash-trailer.mp4`: 40.6 s, 1920×1080, 24 fps, ~25 MB, the game's own
music. Intro card (stars and stripes, "100 MPH · NO RULES · ALL-AMERICAN
ASPHALT") → landmark flyover → Sierra drone → Sierra / Pacific Coast / Palm
Desert hero shots → Ghat drone over the hairpins → the brawl → slow-motion
wipeout → cops → secret one-wheeler → the win → outro ("MORE COMING SOON:
multiplayer, new states, more bikes…", "PLAY FREE NOW riderash.vercel.app").
Made with `tools/trailer/` (see its README): shots staged in the real game with
the clock held, rendered frame by frame on the high tier (~6 s/frame in software),
title cards as HTML, cut with ffmpeg. **Not in the cut:** the bust (camera loses
the figures once the cop steps off) and the cliff plunge (bike leaves frame).

---

## 4. Assets and images — what is in the repo

| path | what | origin |
|---|---|---|
| `assets/*.js` | every 3D object as code: 4 bike classes + `bike_mono` (one-wheeler), `rider.js`, cars/trucks/bus, buildings, trees, animals, props, gear | written through the 404 recipe |
| `assets/*.expect.json`, `assets/_verify/` | asset-contract expectations and verification sheets | recipe `verify` |
| `assets/tex/sky_day.jpg`, `sky_dusk.jpg` | the two sky panoramas (the one declared image exception) | Atlas |
| `assets/audio/*.mp3`, `assets/audio/music/*.mp3` | sound effects; music: title, race1–4, win, bust, rev, select | Atlas (briefs in `docs/refs/audio_briefs.md`) |
| `assets/fonts/` | Anton, Rajdhani (woff2) + OFL licence texts | SIL Open Font License |
| `icons/` | app icons (PWA) | — |
| `docs/refs/concepts/`, `docs/refs/ghat/` | small Atlas concept/reference images for the arrest, ghat road, PCH tunnel | Atlas, reference only (never loaded) |
| `media/riderash-trailer.mp4` | the trailer (branch `trailer`/`handoff`) | rendered from the game |
| `media/riderash-trailer-1080p-hq.mp4` | the trailer at high bitrate (1080p, ~10.6 Mbps, 55 MB) for uploads where quality matters (branch `trailer-hq`) | re-encoded from the render master |
| `media/riderash-trailer-audio.m4a`, `.mp3` | the trailer's mixed soundtrack alone (race1 bed + rev + win stinger), 40.6 s (branch `trailer-audio`) | extracted from the trailer |
| `assetlib.js`, `rig.js`, `surfaces.js` | the recipe's loader, rig and procedural-surface helpers | 404 recipe |

Deleted in PR #1 (still in git history before `952f35f`): `_shots/`,
`_playtest/`, `.playwright-mcp/` (debug captures) and `_refs/bar1–3.png`,
`flux.png`, `gemini31.png`, `gemini3pro.png` (AI-generated "quality bar"
target images, never loaded by the game).

---

## 5. Open items / next steps

1. **Jam entry commit.** PR #30 names `645b7d2`; `main` is now `6ee4d30`
   (radar-pill fix). Rerun the gate with `--commit=6ee4d30564f0a7e3a9c3d6fc956c835798a8c96c`
   against `https://riderash.vercel.app/`, then edit `entries/riderash.json`
   (`"commit"`) and the verdict block in PR #30. Do not push to `main` while
   judging runs.
2. **Trailer extras:** fix the bust camera (frame `cop.rider` + `A.targetPoint`
   after the step-off; the `post` hook in `tools/trailer/shots.mjs`) and the
   plunge (place the camera at the lip before `__ENDINGS__.plunge()`).
3. **Draw-call headroom** is thin on the start grid (859/900). Real lever:
   riders are ~60 draws each (per-node merge) — a skinned or fully merged
   rider would halve the grid peak.
4. **Owner's list of further fixes** (mentioned, not yet specified).
5. Teased in the trailer: multiplayer, new states, more bikes.

---

## 6. How to work on it (environment notes)

- Run locally: `python3 -m http.server` in the repo root → `http://localhost:8000/`.
- Tests: `cd tools && npm install`, then `node fuzz.mjs` (plays careers) and
  `node arrestcheck.mjs --quick` (bust scenes). `CHROME_PATH=` if Playwright's
  Chrome is not installed. Both route three.js from `tools/node_modules` so
  they work offline.
- In a sandbox without CDN access the game shows "A game script failed to
  load" — that is the jsDelivr import of three.js, not a game bug.
- Harness globals worth knowing: `__START__`, `__SIM__`, `__HOLD__`,
  `__RENDER__`, `__STATE__`, `__PLAYERPHYS__`, `__PLAYER_FIGHTER__`,
  `__RIVALS__`, `__COP__`, `__DISMOUNT__`, `__FREECAM__`, `__FREERIDE__(map)`,
  `__TRIAL__` (one-wheeler), `__ENDINGS__.bust/plunge/arrestRival`,
  `__BUST_VARIANT__`, `__ATTRACT_NEXT__`.
- Quality tiers: `src/main.js` `TIERS` (high / medium / low; phones get medium)
  and `src/scenery.js` `SCENERY_TIERS`.
