# RideRash — critic round 1

Bar: three generated reference frames of the target (Road Rash's premise at modern
fidelity), viewed by eye. Floor: the one-pass build, six moving frames.
The critic is a fresh pair of eyes that is allowed to reject the round.

## The verdict

**The floor loses, decisively, on one property above all others:**

> The player's own motorcycle does not fill the frame, and its rider is not
> readable. In every bar frame the player's bike occupies the bottom third of
> the image and you can read the rider's back, jacket, helmet and mirrors. In
> every floor frame the player is a small dark object roughly 1/25th of the
> frame width, and it is frequently against dark road so its silhouette is lost.

Everything else the critic listed is downstream of that. This is the property to
fix first, and it is a camera-and-scale problem, not a modelling problem.

## What is measurably true of the bar, as checkable claims

1. **Hero scale.** The player bike's silhouette spans 25–40% of frame width, and
   sits in the bottom-centre. (floor: ~4%)
2. **Three depth bands, all populated.** Near (hero, sharp), mid (2–4 rivals at
   15–40 m), far (a town/headland at 400–1200 m, hazed to near-sky value).
   (floor: near only; the mid band is empty, the far band is a soft empty horizon)
3. **The road is wet.** A broad specular smear runs down the tarmac, brightest
   toward the sun. (floor: matte, no specular)
4. **Two colour temperatures on the same surface.** Warm key from the low sun on
   one side, cool sky fill on the other; both are visible in the asphalt itself.
   (floor: uniformly cool)
5. **The pack is countable.** 2–5 rivals visible, separated by bodywork colour.
   (floor: pack often off-screen entirely; when visible, indistinguishable)
6. **A single vanishing point** the road, rail, and poles all lead to.
   (floor: reached, but weakly)
7. **Dirt everywhere.** Patch marks, cracks, grit, scrub. (floor: clean surfaces)

## The one property to change first

Hero scale. Fix the camera and the bike's screen presence, re-run, and re-judge.

## Structural limits, recorded honestly

- Assets here are code with no image files. The bar frames have photographic
  surface detail — worn paint, texture, grime. A flat-colour code asset cannot
  reach that, and no round of this loop will close that gap. What code CAN reach
  is silhouette, scale, colour blocking and light, which is why the first fix is
  camera and scale rather than more modelling detail.
- No glyphs anywhere (per the style lock). The bar has legible UI and livery
  text. We do not attempt it.