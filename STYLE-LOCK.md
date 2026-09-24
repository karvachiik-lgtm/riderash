# RideRash — the locked style

> Every object is a chunky low-poly mass with hard chamfered edges and hand-authored
> panel breaks, finished in worn industrial paint and unpainted cast metal — desaturated,
> slightly dirty, dense with readable silhouette detail at racing speed, never glossy plastic.

This is the Road Rash look rendered with modern rendering: the geometry language stays
1990s-arcade (few, large, confident masses; visible facets; exaggerated proportions), and the
quality comes from physically-based lighting, ambient occlusion and wet asphalt rather than
from polygon count.

| role | hex | where it belongs |
|---|---|---|
| asphalt | `0x2b2b2f` | road surface, wet-dark, the dominant material of every frame |
| asphalt-worn | `0x3a3a3e` | worn wheel tracks, patched tarmac, lighter than the road |
| saddle | `0x1b1b1e` | bike seats, grips, tyres, cables, the dark mass of every vehicle |
| frame-steel | `0x8a9199` | bare chrome-moly tube, exhaust, fork sliders, bare engine cases |
| frame-painted | `0xc4442a` | the player's bike bodywork, sun-bleached red with rust at the edges |
| rival-a | `0x2f6f8f` | rival bike bodywork, teal |
| rival-b | `0xb8912e` | rival bike bodywork, mustard |
| rival-c | `0x6a4a7a` | rival bike bodywork, plum |
| skin | `0x9c7358` | riders' faces, arms, hands; grimy and unlit-looking |
| denim | `0x3b4a63` | rider jeans, weathered blue |
| leather | `0x2a2624` | rider jackets, gloves, boots, the chain, the tyre iron |
| helmet-paint | `0xd8d2c4` | cracked bone-white helmet shell with grime in the cracks |
| kerb | `0x6e6a62` | kerb stones, concrete barriers, bridge parapets |
| foliage | `0x41502e` | roadside scrub, dark olive, low and dry |
| hazard | `0xd4622a` | barrier chevrons, cones, roadwork signage as SHAPE colour only |
| glyph | `0xd0cbbb` | place name boards rendered as lit shape and silhouette, never legible text |

## Fixed decisions

- **Metres.** Bike is 2.10 m long, 1.25 m tall over the bars, wheelbase 1.40 m, wheel diameter
  0.62 m. Rider seated is 1.55 m tall, 0.72 m from hip to shoulder. Chain segment is 0.60 m
  hanging. Road width is 7.5 m, one lane 3.6 m. Kerb is 0.15 m high. Guard rail 0.75 m.
- Base at y = 0, centred on x and z, front faces +Z.
- Flat colours with sensible roughness; surfaces are applied at load time. No image files, ever.
- Material names from the contract's list (`plaster | stone | timber | tile | metal | fabric |
  foliage | ground`), not a shortened one.
- **No glyphs anywhere.** Place names, race banners and hazard signs are carried as lit shape,
  colour blocks and silhouette. Do not attempt legible printed text; the format cannot do it and
  a smudge is worse than an abstract.
- Lighting is modern: a low warm key sun, a cool sky bounce, contact shadows, and wet-road
  specular. The geometry is 1995; the light is not.

## The game in one line

A three-dimensional Road Rash. You race a pack of five riders down coastal and industrial
routes, and the racing is really a brawl — punches, kicks and a swinging chain at ninety miles
an hour, with riders who fight back, wipe out, and remount.