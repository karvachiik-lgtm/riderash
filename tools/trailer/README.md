# tools/trailer — the RIDERASH trailer, rendered from the real game

The trailer (`media/riderash-trailer.mp4`, 40.6 s, 1080p24) is real in-game
footage: every shot is staged in the game with its clock held (`__HOLD__`) and
stepped one frame at a time, so it renders at full quality on any machine,
even without a GPU (about 6 s a frame in software).

| file | what |
|---|---|
| `shots.mjs` | the shot list: setup, per-frame camera / input, caption, frame count |
| `render.mjs` | renders shots to `frames/<shot>/*.jpg` (`--preview`: 3 small stills per shot) |
| `cards.html`, `cards.mjs` | the intro and outro title cards, animated and captured per frame |
| `assemble.py` | crossfades the shots, adds the game's own music and stingers, encodes H.264 |
| `lib.mjs` | serves the repo and opens the game at 1920x1080 on the high tier |

```sh
cd tools && npm install                      # playwright-core + three
cd trailer
node render.mjs road_sierra --preview        # check framing first
node render.mjs landmarks drone_sierra road_sierra road_coastal road_desert drone_ghat \
  brawl crash cops monowheel win             # the full render (run several in parallel)
node cards.mjs                               # intro + outro
python3 assemble.py riderash-trailer-1080p.mp4 intro landmarks drone_sierra road_sierra \
  road_coastal road_desert drone_ghat brawl crash cops monowheel win outro
```

Needs `ffmpeg` with libx264 on the PATH, and Chrome/Chromium (`CHROME_PATH=...`
if Playwright's own is not installed). Not in the cut yet: `bust` (the camera
loses the two figures once the cop steps off) and the cliff plunge.
