// RideRash — the live sky.
//
// WHY THIS IS A SHADER AND NOT A BACKGROUND IMAGE. Two reasons, and both of
// them were visible in the first build.
//
// 1. A static panorama never changes. Same clouds, same sun angle at 0 s and at
//    300 s, which the eye reads as a painted backdrop rather than a sky. Here
//    two Atlas panoramas (a warm low-sun dusk and a cool higher-sun day) are
//    blended along one `timeOfDay` uniform, so the race can run from golden hour
//    into blue dusk and the sky actually moves through it.
//
// 2. A static image cannot agree with the light. The sun LIGHT and the sun IN
//    THE IMAGE were two independent numbers I had to hand-match, and any edit to
//    one silently broke the other. Here the sun's direction is MEASURED from the
//    panorama at load (findSun), converted to yaw/pitch, and the directional
//    light is PLACED there. Light, shadow, specular smear and the visible sun
//    now agree by construction — that whole class of bug is gone.
//
// The environment map is regenerated from the same blend, so every reflective
// surface in the world reflects the actual sky it is standing under.
import * as THREE from 'three';

// Find the sun in an equirectangular panorama.
//
// NAIVE VERSION FAILED: "take the brightest pixel" found a bright cirrus streak
// at v=0.35 (lum 237), well above the horizon, and put the light 27 degrees up.
// The sun disc is not the brightest single pixel in a sky full of lit cloud —
// it is the brightest point that is BOTH near the horizon AND a compact blob
// with a steep falloff around it. So: score candidates on brightness weighted by
// proximity to the horizon, then take the centroid of the winning blob.
export function findSun(tex) {
  const FALLBACK = { yaw: 2.35, pitch: 0.105 };
  const img = tex && tex.image;
  if (!img || !img.width) return FALLBACK;
  try {
    const W = 256, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(W * H);
    for (let i = 0, px = 0; i < d.length; i += 4, px++) {
      lum[px] = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    }

    // Only consider the band around the horizon, and require a compact bright
    // blob: high value in the centre, much lower a few pixels out.
    const yTop = Math.floor(H * 0.33), yBot = Math.floor(H * 0.58);
    let best = -1, bx = 0, by = 0;
    for (let y = yTop; y < yBot; y++) {
      for (let x = 2; x < W - 2; x++) {
        const v = lum[y * W + x];
        if (v < 0.80) continue;                       // must be genuinely hot
        const ring = (
          lum[(y) * W + (x - 3)] + lum[(y) * W + (x + 3)] +
          lum[(Math.max(0, y - 3)) * W + x] + lum[(Math.min(H - 1, y + 3)) * W + x]
        ) / 4;
        const compact = v - ring;                     // falls off quickly == a disc
        // weight by how close to the horizon it is: the sun we authored is ON it
        const horizonW = 1 - Math.min(1, Math.abs(y - H * 0.5) / (H * 0.16));
        const score = compact * 2.2 + v * 0.8 + horizonW * 1.6;
        if (score > best) { best = score; bx = x; by = y; }
      }
    }
    if (best < 0) {
      // no compact blob found: fall back to the brightest horizon-band pixel
      let bl = -1;
      for (let y = yTop; y < yBot; y++) {
        for (let x = 0; x < W; x++) {
          const v = lum[y * W + x];
          if (v > bl) { bl = v; bx = x; by = y; }
        }
      }
    }

    const u = bx / W;
    const v = by / H;
    // PURE IMAGE-SPACE yaw, in the same units as the shader's yaw before
    // rotation: yaw = (u - 0.5) * 2pi. No rotation is applied here — the shader
    // applies ONE rotation to both the sky and the sun, derived from this value.
    const yaw = (u - 0.5) * Math.PI * 2;
    const rawPitch = (0.5 - v) * Math.PI;
    // Clamp the ELEVATION, not the image position: a light exactly on the
    // horizon grazes the ground plane and produces no shadow definition at all.
    // 8-20 degrees of elevation is what gives long raking shadows AND lit
    // surfaces.
    const pitch = Math.max(0.14, Math.min(0.42, rawPitch));
    return { yaw, pitch, rawPitch, blobV: v, u, found: best >= 0 };
  } catch (e) {
    return FALLBACK;
  }
}

// hardcode that. Neither of these panoramas does. Scanning the luminance profile
// top to bottom, the biggest downward step is where sky meets sea or land:
//
//   sky_dusk  aspect 4.02  horizon at v=0.711  (71% sky — a generous sky image)
//   sky_day   aspect 2.00  horizon at v=0.352  (only 35% sky)
//
// With the horizon hardcoded at 0.5, the dusk image was read with a 0.5 offset,
// which pulled its SEA up into the overhead view: the first render had a rock
// cliff where the sky should be. The horizon line has to be measured per image.
export function findHorizon(tex) {
  const FALLBACK = 0.5;
  const img = tex && tex.image;
  if (!img || !img.width) return FALLBACK;
  try {
    const W = 64, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        s += (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
      }
      lum[y] = s / W;
    }
    // The horizon is the largest single downward step, searched only in the
    // middle 80% so a dark vignette at the very edges cannot win.
    let best = 0, at = Math.round(H * 0.5);
    const lo = Math.floor(H * 0.12), hi = Math.floor(H * 0.88);
    for (let y = lo + 1; y < hi; y++) {
      const drop = lum[y - 1] - lum[y];
      if (drop > best) { best = drop; at = y; }
    }
    // Guard: a very flat image has no real horizon, so keep the default.
    if (best < 0.012) return FALLBACK;
    return at / H;
  } catch (e) {
    return FALLBACK;
  }
}

// Does a panorama wrap? A sky is only usable if its left and right edge columns
// match; otherwise the sphere shows a hard vertical seam. Measured, this is what
// separated the two Atlas skies: sky_dusk 4.6 (seamless) vs sky_day 42.4 (broken,
// which drew a seam straight down the middle of the frame).
export function edgeDiff(tex) {
  const img = tex && tex.image;
  if (!img || !img.width) return 999;
  try {
    const W = 256, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let diff = 0;
    for (let y = 0; y < H; y++) {
      const a = (y * W) * 4, z = (y * W + (W - 1)) * 4;
      diff += Math.abs(d[a] - d[z]) + Math.abs(d[a + 1] - d[z + 1]) + Math.abs(d[a + 2] - d[z + 2]);
    }
    return diff / H / 3;
  } catch (e) { return 999; }
}

// Make a nearly-seamless panorama actually seamless across its u = 0/1 wrap.
//
// "Edge diff 4.6" is an AVERAGE over every row. Row by row, sky_dusk's first
// and last columns differ by up to 26 levels (row 500 of 1024: rgb 79/78/92 vs
// 105/87/85). Once the texture repeats, that step is drawn as a vertical line,
// and the shader's zenith chroma lift (uSkySat 5.2) amplifies it: MEASURED in
// the chase view at screen row 150, rgb 146/161/193 -> 100/139/182 across one
// pixel column. The wrap sits 17 deg right of the start straight, so every
// camera sees it on some bend.
//
// So remove the low-frequency step at load: per row, take the mean colour of
// the 4 columns at each edge (smoothed over +-6 rows so single cloud pixels
// don't drive it), and spread HALF the difference as a linear ramp into each
// side over `band` columns. The edges then meet at their average with no step,
// the correction is invisible elsewhere (96 of 4112 columns = 8.4 deg a side),
// and the cloud detail is untouched -- only an offset is added. Done once, on
// a canvas; the texture then points at the canvas.
function featherWrap(tex, band = 96) {
  const img = tex && tex.image;
  if (!img || !img.width || tex.userData.feathered) return;
  try {
    const W = img.width, H = img.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const L = g.getImageData(0, 0, band, H);
    const R = g.getImageData(W - band, 0, band, H);
    const E = 4, SM = 6;
    // raw per-row edge difference (right edge minus left edge), per channel
    const raw = new Float32Array(H * 3);
    for (let y = 0; y < H; y++) {
      for (let ch = 0; ch < 3; ch++) {
        let l = 0, r = 0;
        for (let i = 0; i < E; i++) {
          l += L.data[(y * band + i) * 4 + ch];
          r += R.data[(y * band + (band - 1 - i)) * 4 + ch];
        }
        raw[y * 3 + ch] = (r - l) / E;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0, n = 0;
        for (let k = Math.max(0, y - SM); k <= Math.min(H - 1, y + SM); k++) { s += raw[k * 3 + ch]; n++; }
        const half = (s / n) * 0.5;
        for (let i = 0; i < band; i++) {
          const w = 1 - i / band;                       // 1 at the edge, 0 inside
          const li = (y * band + i) * 4 + ch;
          const ri = (y * band + (band - 1 - i)) * 4 + ch;
          L.data[li] = Math.max(0, Math.min(255, L.data[li] + half * w));
          R.data[ri] = Math.max(0, Math.min(255, R.data[ri] - half * w));
        }
      }
    }
    g.putImageData(L, 0, 0);
    g.putImageData(R, W - band, 0);
    tex.image = c;
    tex.userData.feathered = true;
    tex.needsUpdate = true;
  } catch (e) { /* a tainted canvas leaves the image as it was: a faint seam, not a failure */ }
}

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = `
  uniform sampler2D tDay;      // cool, higher sun
  uniform sampler2D tDusk;     // warm, sun on the horizon
  uniform float uMix;          // 0 = day, 1 = dusk
  uniform float uSkySat;       // zenith chroma lift; see the note at its use
  uniform float uHorizonDay;   // where the horizon sits in each image, 0..1
  uniform float uDaySame;      // 1 when both slots sample the same texture
  uniform float uSkyRotation;  // yaw offset placing the u wrap opposite the sun
  uniform float uHorizonDusk;
  uniform float uSunYaw;       // where the sun is, measured from the panorama
  uniform float uSunPitch;
  uniform vec3  uSunTint;
  uniform vec3  uFogColour;
  uniform float uHaze;         // extra horizon haze, raised when it rains
  uniform float uExposure;
  varying vec3 vDir;

  // Luminance-preserving warm/cool balance, so blending skies does not just
  // average them into mud.
  vec3 balance(vec3 c, float warm) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 warmC = vec3(l * 1.10, l * 0.97, l * 0.80);
    vec3 coolC = vec3(l * 0.86, l * 0.96, l * 1.16);
    return c + mix(coolC, warmC, warm) * 0.85 - c * 0.0;
  }

  void main() {
    vec3 d = normalize(vDir);

    // Spherical lookup for a three.js equirectangular texture.
    //
    // THE FLIP. First attempt used uv.y = 0.5 - pitch/PI, which put the GROUND
    // half of the panorama in the upper view: the "sky" was a rock cliff and the
    // horizon ran across the top of the frame. three.js samples an equirect with
    // v=0 at the image's TOP row mapping to +Y (up), so v must INCREASE downward
    // in world terms, i.e. uv.y = 0.5 + pitch/PI. Get this backwards and the
    // world is upside down in a way that still looks like a plausible image.
    // The SEAM. atan(d.x, -d.z) puts yaw=0 straight ahead (-Z), so uv.x = 0.5 lands
    // dead centre of the view — exactly where the texture's u=0/u=1 wrap is, and
    // a visible vertical line ran down the middle of every frame. Rotating half a
    // turn puts the wrap BEHIND the rider, where it is never looked at. This is a
    // whole-turn rotation of the sky, which is free and invisible.
    //
    // ...EXCEPT IT WASN'T, AND "BEHIND THE RIDER" IS WHERE THE NOSE CAM LOOKS.
    // Two separate discontinuities were being treated as one:
    //   (a) atan()'s branch cut. It is ALWAYS at world +Z (d.x = 0, d.z > 0);
    //       adding uSkyRotation to the result cannot move it. uv.x jumps by
    //       exactly 1.0 across it.
    //   (b) The texture's own edge. The panoramas load with three's default
    //       ClampToEdge, and uv.x ran over [0.453, 1.453] (uSkyRotation 2.847),
    //       so 47% of the dome -- every direction with atan > +0.294 -- sampled
    //       the u = 1 column smeared sideways.
    // MEASURED in the NOSE view (camera ahead of the bike looking back, i.e.
    // looking at +Z): a hard vertical step down the middle of the frame,
    // rgb 112/156/210 -> 233/227/228 between x = 643 and 644, sky blue on one
    // side and a white horizontal smear on the other. It moved and swapped
    // sides as the camera rolled with the lean, which is the reported flicker.
    //
    // The fix is at both roots: the textures now REPEAT (DynamicSky ctor), and
    // uv.x is taken mod 1 here, so (b) is gone and the only cut left is (a),
    // where the uv jump of 1.0 is invisible to a repeating texture. What (a)
    // still does is blow up the screen-space derivative for one pixel column,
    // which drags the sampler to its 1x1 mip and draws a flat-coloured line --
    // so pick, per pixel, whichever of two parameterisations has no cut here
    // (fract(u), cut at u = 0; fract(u + 0.5) - 0.5, cut at u = 0.5). Both
    // address the same texel under RepeatWrapping; only the derivative, and
    // therefore the mip level, differs. (Tarini 2012, "Cylindrical and toroidal
    // parameterizations without vertex seams".)
    float yaw = atan(d.x, -d.z) + uSkyRotation;
    float pitch = asin(clamp(d.y, -1.0, 1.0));
    float u0 = yaw / 6.2831853 + 0.5;
    float uA = fract(u0);
    float uB = fract(u0 + 0.5) - 0.5;
    float uX = fwidth(uA) <= fwidth(uB) + 1e-6 ? uA : uB;
    vec2 uv = vec2(uX, 0.5 + pitch / 3.1415927);

    // Each panorama's own horizon line, so a 4:1 image with 71% sky is read as
    // 71% sky rather than being cropped to the middle half.
    //
    // THE SEAM, PART TWO. When the day slot falls back to the dusk image, these
    // two remaps used different horizon values (0.352 vs 0.711) and therefore
    // produced two DIFFERENTLY-STRETCHED copies of the same photograph. Where
    // uv.x wrapped, the two samples met and their mismatch drew a hard vertical
    // line down the centre of the frame — warm on one side, cool on the other.
    // With one image in both slots there is only one correct correction: use the
    // dusk horizon for both.
    float hDay  = mix(uHorizonDay, uHorizonDusk, uDaySame);
    vec2 uvDay  = vec2(uv.x, (uv.y - 0.5) * (0.5 / hDay) + 0.5);
    vec2 uvDusk = vec2(uv.x, (uv.y - 0.5) * (0.5 / uHorizonDusk) + 0.5);

    // ONE SOURCE, ONE CORRECTION.
    //
    // Every theory I tried for the vertical seam was wrong until I removed the
    // second sample. The real cause is structural: when the day slot falls back
    // to the dusk image, the shader samples the SAME texture twice through two
    // slightly different vertical remaps (horizon 0.695 vs 0.711) and averages
    // them. Those two samples are near-identical almost everywhere, so the blend
    // looks fine — but at the u wrap their small difference becomes a visible
    // step, which is the seam. The fix is not a better resampling trick; it is to
    // not sample twice when there is only one image to sample.
    vec3 sky = texture2D(tDusk, uvDusk).rgb;
    vec3 day  = sky;
    vec3 dusk = sky;
    if (uDaySame < 0.5) {
      day = texture2D(tDay, uvDay).rgb;
    }

    // If the day panorama failed the seam test it was replaced by the dusk image
    // (see DynamicSky), so both samples would be identical and the blend would do
    // nothing. Shift the "day" end cool and brighter here instead, so time of day
    // is still a real variable rather than a no-op the player never notices.
    if (uDaySame > 0.5) {
      float dl = dot(day, vec3(0.2126, 0.7152, 0.0722));
      day = mix(day, vec3(dl * 0.82, dl * 0.94, dl * 1.22) + vec3(0.0, 0.03, 0.09), 0.75);
      day *= 1.16;
    }

    // Blend, then rebalance toward warm as we move to dusk. A straight mix of a
    // blue sky and an orange sky gives grey; the balance keeps the chroma.
    vec3 c = mix(day, dusk, uMix);
    c = balance(c, uMix);

    // --- ZENITH CHROMA ---
    //
    // MEASURED by gridding the frame (harness/_blown.mjs) at a fixed distance:
    // the sky band carried **0.2%** high-saturation pixels while occupying about
    // 42% of the picture. The largest surface on screen was contributing almost
    // no colour, and every attempt to reach the reference set's 19% by pushing
    // the VERGE instead produced a slab of mustard from the kerb to the hills --
    // a bad way to hit a good number.
    //
    // The cause is the source: these panoramas are photographs, and photographic
    // skies are hazy. A real sky deepens toward the zenith because there is less
    // atmosphere to look through, so the lift is weighted by pitch -- full
    // strength overhead, nothing at the horizon where haze genuinely does wash
    // the colour out. Saturation only; luminance is untouched, so this cannot
    // brighten the frame or push anything past the bloom threshold.
    float up = clamp(pitch / 0.85, 0.0, 1.0);
    float cl = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(c, vec3(cl) + (c - vec3(cl)) * uSkySat, up * up), 0.0, 1.0);

    // --- the sun itself ---
    // Drawn analytically rather than read from the image, so it can be sized and
    // can bloom, and so it stays put when the two panoramas disagree about where
    // their suns are. This is the one place I do NOT want to average them.
    float sd = max(dot(d, normalize(vec3(
      sin(uSunYaw) * cos(uSunPitch),
      sin(uSunPitch),
      -cos(uSunYaw) * cos(uSunPitch)))), 0.0);
    // A wide soft core with a tight hot centre. The hot centre is what pushes
    // pixels past the bloom threshold and gives the frame its highlight range.
    // MEASURED. The first values (0.55 / 26.0 / 1.4) were authored when the sun
    // sat off to the side, where a huge broad halo is mostly out of frame. With
    // the sky rotated so the sun is DOWN THE ROAD — which is the composition the
    // style lock wants — the camera looks straight into it and that halo blew the
    // entire frame to white. The sun in the panorama is already bright; this is
    // only the extra bloom-able core on top of it, so it must be restrained.
    float glow = pow(sd, 6.0) * 0.28 + pow(sd, 160.0) * 7.0 + pow(sd, 28.0) * 0.55;
    c += uSunTint * glow;

    // --- horizon haze, WITH COLOUR ---
    // A band of warm haze around the horizon line, widened at dusk and by rain.
    //
    // Measured problem: the sky band was 0.30% high-saturation while the ground
    // was 21.7%, and the sky is 42% of the frame -- which is why the whole-frame
    // figure sat at 0.3% against a bar of 19%. The haze was mixing toward
    // uFogColour at up to 0.64 strength, and the fog colour is a pale grey, so
    // the largest surface on screen was being washed toward neutral.
    //
    // Real haze is not grey: it scatters blue and takes its hue from the sky it
    // sits under. This keeps the band's LIGHTNESS (so the horizon still reads as
    // distance) while restoring its CHROMA, by mixing toward a saturated version
    // of the fog colour rather than the fog colour itself.
    float hz = exp(-pow(abs(pitch) * 3.1, 1.6));
    vec3 hazeCol = mix(uFogColour, uSunTint, uMix * 0.55);
    float hazeL = dot(hazeCol, vec3(0.2126, 0.7152, 0.0722));
    // push away from the luminance grey by 1.9x -- same value, far more hue
    vec3 hazeSat = clamp(hazeL + (hazeCol - vec3(hazeL)) * 1.9, 0.0, 1.0);
    c = mix(c, hazeSat, hz * (uHaze + uMix * 0.22));

    // --- ground half ---
    // Below the horizon the panorama's own sea is used, but flattened toward the
    // fog colour so it reads as distance and not as a photo pasted underfoot.
    float below = smoothstep(0.0, -0.18, pitch);
    c = mix(c, uFogColour * 0.92, below * 0.55);

    gl_FragColor = vec4(c * uExposure, 1.0);
  }`;

export class DynamicSky {
  constructor(renderer, textures) {
    this.renderer = renderer;
    const day = textures.sky_day || textures.sky_dusk;
    const dusk = textures.sky_dusk || textures.sky_day;
    if (!day || !dusk) { this.ok = false; return; }
    this.ok = true;

    // The sun position comes from the DUSK panorama: it is the one authored to
    // have the sun on the horizon, which is the look the whole style lock targets.
    this.sun = findSun(dusk);
    this.horizonDay = findHorizon(day);
    this.horizonDusk = findHorizon(dusk);

    // SEAM CHECK. A panorama is only usable as a sky if its left and right edge
    // columns match; otherwise the sphere shows a hard vertical line. Measured:
    // sky_dusk edge difference 4.6 (seamless), sky_day 42.4 (broken — a hard
    // seam down the middle of the frame plus a mirrored mountain). So the day
    // image is used ONLY as a fallback tint source and never as the primary,
    // and `uDayIsSeamless` lets the shader synthesise the day end of the blend
    // from the dusk image instead of sampling a seam.
    this.daySeamless = edgeDiff(day) < 16;
    const dayTex = this.daySeamless ? day : dusk;

    // WRAP HORIZONTALLY. TextureLoader leaves wrapS at ClampToEdge (1001, read
    // back live), and with the shader's uv.x spanning a full turn from an offset
    // start, half the dome clamped to the image's last column -- the vertical
    // seam and white smear the NOSE camera looks straight at. A seamless
    // panorama (edge diff 4.6) must repeat in u. wrapT stays clamped: the poles
    // must not wrap top-to-bottom. needsUpdate re-sends the sampler state in
    // case the texture was already uploaded by the loading screen.
    for (const t of new Set([dayTex, dusk])) {
      featherWrap(t);
      if (t.wrapS !== THREE.RepeatWrapping) { t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true; }
    }

    // Place the u=0/u=1 wrap as far from the sun as possible: directly opposite
    // it. The sky is a sphere, so rotating it is free and invisible, and this
    // guarantees the seam never crosses the sun's glow — which is what made it
    // visible. Measure first, then rotate.
    this.skyRotation = this.sun.yaw + Math.PI;

    // WHERE THE SUN IS DRAWN, IN THE WORLD. `sun.yaw` is an IMAGE-space angle
    // (u - 0.5) * 2pi. The shader rotates the panorama by skyRotation, so the
    // sun disc and its glow land at world yaw (sun.yaw - skyRotation) = -pi:
    // world +Z, behind the grid. lighting.js used to aim the DirectionalLight
    // at the raw image yaw (-0.294 -> world direction -0.28/0.22/-0.93, i.e.
    // DOWN THE ROAD), 180 deg from the sun on screen. MEASURED consequence: the
    // chase cam looked straight into a specular lobe from a sun that was not in
    // its sky (15.3% of the road band blown white), and the NOSE cam looked at
    // a blazing sun that lit nothing facing it. `worldYaw` is the one number
    // both the dome and the light now use.
    this.sun.worldYaw = this.sun.yaw - this.skyRotation;

    this.uniforms = {
      tDay: { value: dayTex },
      tDusk: { value: dusk },
      uMix: { value: 0.55 },
      uSkySat: { value: 5.2 },
      uHorizonDay: { value: this.horizonDay },
      uDaySame: { value: this.daySeamless ? 0 : 1 },
      uSkyRotation: { value: this.skyRotation },
      uHorizonDusk: { value: this.horizonDusk },
      uSunYaw: { value: this.sun.worldYaw },
      uSunPitch: { value: this.sun.pitch },
      uSunTint: { value: new THREE.Color(0xffd9a0) },
      uFogColour: { value: new THREE.Color(0xa8b4bc) },
      uHaze: { value: 0.42 },
      // MEASURED. 1.30 blew the whole frame to white once the sky was a real
      // photograph: the panorama's own sea and haze are far brighter than the old
      // gradient shader, and the bloom then multiplied that. The exposure that
      // keeps the sky readable AND leaves the road its texture is well under 1.
      uExposure: { value: 0.82 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;

    // THE DOME TRAVELS WITH THE CAMERA. It used to sit at the world origin, and
    // the road is 5600 m of -Z (CFG.SEG 8 x ROAD_SEGS 700), so the rider rode
    // AWAY from the centre of a 4200 m sphere all race:
    //   - looking back, the wall behind is (4200 + d) away, past camera.far
    //     (6000) once d > 1800 m. It is far-clipped to the clear colour: a
    //     black arch over the road. MEASURED in the NOSE view at s = 3000
    //     (camera 3245 m from the dome centre): 10-15% of the top half of the
    //     frame near-black (sum rgb < 40), 0% at s = 1500.
    //   - past d = 4200 the camera is OUTSIDE the sphere, and BackSide shows
    //     only the far hemisphere: at s = 4500 the CHASE view was 71-78%
    //     near-black in the top half, with the rain streaks drawn over void.
    // Because the shader reads direction from the vertex's LOCAL position
    // (vDir = normalize(position)), translating the mesh changes nothing about
    // what is drawn in any direction -- it only keeps every direction at 4200 m,
    // inside `far` by 1800 m. onBeforeRender runs before three computes the
    // modelViewMatrix, so this is the same frame's camera, including the
    // freecam and the PMREM cube cameras (whose clone of the mesh is separate).
    this.mesh.onBeforeRender = (r, s, cam) => {
      this.mesh.position.setFromMatrixPosition(cam.matrixWorld);
      this.mesh.updateMatrixWorld();
    };

    this._envCache = new Map();
    this._envRT = null;
  }

  // Rebuild the PMREM environment from the current blend. This is what makes the
  // world's reflections change with the time of day, and it is cached per mix
  // bucket because a PMREM is expensive and the blend is quantised anyway.
  refreshEnv(scene, mixOverride = null) {
    if (!this.ok) return null;
    const mix = mixOverride ?? this.uniforms.uMix.value;
    const bucket = Math.round(mix * 10) / 10;
    if (this._envCache.has(bucket)) {
      scene.environment = this._envCache.get(bucket);
      return this._envCache.get(bucket);
    }

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromScene(this._envScene(bucket), 0, 0.1, 100);
    pmrem.dispose();

    const tex = rt.texture;
    this._envCache.set(bucket, tex);
    if (this._envRT) { /* keep old ones: they are cheap relative to reuse */ }
    this._envRT = rt;
    scene.environment = tex;
    return tex;
  }

  // A one-off scene containing just this sky, used as the PMREM source.
  _envScene(mix) {
    const s = new THREE.Scene();
    const m = this.material.clone();
    m.uniforms = Object.assign({}, this.uniforms, { uMix: { value: mix } });
    m.side = THREE.BackSide;
    m.depthWrite = false;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), m);
    s.add(mesh);
    return s;
  }

  update(dt, { timeOfDay = 0.55, weather = 0 } = {}) {
    if (!this.ok) return;
    // ease so a change of time is a drift, not a jump
    const target = THREE.MathUtils.clamp(timeOfDay, 0, 1);
    this.uniforms.uMix.value += (target - this.uniforms.uMix.value) * Math.min(1, dt * 0.35);
    this.uniforms.uHaze.value += ((0.42 + weather * 0.5) - this.uniforms.uHaze.value) * Math.min(1, dt * 0.5);
    // a wet sky is a duller sky
    this.uniforms.uExposure.value += ((0.82 - weather * 0.18) - this.uniforms.uExposure.value) * Math.min(1, dt * 0.5);
  }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}