# RideRash — critic round 2

Fresh critic. Round 1 named ONE property to change first: **hero scale**. This is
the re-judge after that change.

## What changed

The round-1 fix was not a modelling change, and the root cause turned out not to
be one either. Two measured defects:

1. **`updateCamera()` was written but never called.** The chase camera was
   defined, tuned, and dead code. The idle orbit camera ran instead and the
   player simply drove away from it: measured camera-to-player separation
   **302 m**. This single line explains every "the hero is a speck" frame and
   every "the hero left the frame" frame, and no still image showed the cause.
2. **The look-ahead was too far** (`CAM_LOOK × 2.0` at speed ≈ 13 m), which
   aimed the camera at the horizon and pushed the hero out of the bottom of the
   frame even once the camera followed correctly.

Secondary fixes found by looking: bike lean was 34° in ordinary riding and read
as fallen over; the rider's back occluded the horizon; camera roll was too strong.

## Verdict on the round-1 property

**Fixed.** Measured: camera-to-player separation 302 m → **1.44 m**; the player's
screen space x is 0 (dead centre); the bike's rider, jacket and tail fill the
bottom-centre third, which is what the bar frames do.

Compare the round-1 filmstrip (hero a 1/25th-frame speck, often off screen) with
this one (helmet and jacket across the bottom third, road sweeping to a vanishing
point, rivals visible alongside and down). The property the critic named moved.

## What is now true, measured against the bar

| claim | bar | round 1 | now |
|---|---|---|---|
| hero spans 25–40% of frame width | yes | ~4% | yes, matches |
| near/mid/far depth bands populated | 3 | 1 | 3 (rivals, town, hills, headland) |
| pack countable in frame | 2–5 | 0–1 | 2–4 |
| road leads to a single vanishing point | yes | weak | yes |
| two colour temperatures on the surface | yes | no | partly (warm sun on one side) |
| road is wet, with a specular smear | yes | no | no |
| dirt: patch marks, cracks, grit | yes | no | partly (patches added, grit no) |
| surfaces are photographic | yes | no | **structurally out of reach** |

## The next property to change first

**The road itself: it is matte and clean, and it is 55–75% of every frame.**
The bar's road is wet with a broad specular smear toward the sun and carries
visible grit, patch edges and cracks. Ours is a flat tone with occasional patches.
This is the highest-leverage remaining item because of how much of the frame the
road occupies, and because it is reachable with code (a wet specular response and
procedural surface detail) rather than being blocked by the no-image-files limit.

## Structural limits, recorded honestly

Surfaces here are procedural, generated from a seed and a material name, with no
image files. That is a real ceiling: the bar frames have photographic texture and
we cannot match them by looping. What is reachable is silhouette, scale, colour,
light, and a wet specular response. The loop should spend its rounds there and
not on trying to reach photographic texture, which it cannot.