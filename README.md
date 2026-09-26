# RIDERASH

A three-dimensional motorcycle combat racer: a pack brawl at a hundred miles an
hour. Race a field of rivals down mountain, coast, valley, desert and cliff roads and
fight your way through it — punch, kick, grab and swing the chain — while the
police wait on the verge for anyone who goes down near them.

Built for the [404 game jam](https://github.com/404-Repo/404-game-jam) with the
[404 game recipe](https://github.com/404-Repo/404-game-recipe). Three.js, one
folder, no build step.

## Play

Open `index.html` from any static server (`python3 -m http.server`, then
http://localhost:8000/). It plays on a phone (touch pad on screen), with a
keyboard, or with a gamepad.

| key | does |
|---|---|
| W / ↑ | throttle |
| S / ↓ | brake (held at a standstill: back up) |
| A / D | steer |
| J / K / L | punch / kick / chain |
| G | grab, then throw |
| Shift | tuck |
| Space | nitro |
| E | swerve |
| C, 1–7 | camera, views |
| N | radar |
| M | mute |
| Esc / P | pause |

**The game.** A career of five levels. Finish fourth or better to advance,
win prize money, buy faster machines in the garage. Stamina is the fight: run
out and you are thrown. Wreck with a cop in reach and you are busted — he pulls
over, walks up and cuffs you, tickets you, or makes you kneel — and the fine
comes out of the bank.

## How it is made

- **Every 3D object is Three.js code** (`assets/*.js`, `src/*.js`): bikes,
  riders, traffic, buildings, the road. No imported meshes; `harness/ship.mjs`
  from the recipe passes clean.
- **Surfaces are generated at load** from a seed (`src/textures.js`,
  `surfaces.js`); no texture images except the two sky panoramas.
- **Files that are not code**, all declared:
  - `assets/tex/sky_day.jpg`, `sky_dusk.jpg` — sky panoramas, generated on Atlas
  - `assets/audio/**` — sound effects and music, generated on Atlas
    (briefs in `docs/refs/audio_briefs.md`)
  - `assets/fonts/*` — Anton and Rajdhani, SIL Open Font License (texts included)
  - `icons/*` — app icons
- **Agents and models**: Claude Code (Claude models) and opencode (DeepSeek);
  images and audio on Atlas.

## Repository

| path | what |
|---|---|
| `index.html`, `src/`, `assets/`, `icons/` | the game |
| `assetlib.js`, `rig.js`, `surfaces.js` | the recipe's asset loader and rig helpers |
| `tools/` | test harnesses: `fuzz.mjs` (plays whole careers), `arrestcheck.mjs` (every bust scene, measured frame by frame) — see `tools/README.md` |
| `docs/` | the build record: architecture, handoffs, session reports, critiques, playtests, the style lock, references |

Start with `docs/ARCHITECTURE.md` to change the game, `docs/HANDOFF.md` for
the history of how it got here.
