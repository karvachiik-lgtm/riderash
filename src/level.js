// RideRash — the coast road. Everything here is built as code and baked per
// block so a few hundred props don't cost a few hundred draw calls.
import * as THREE from 'three';
import { CFG, PAL } from './config.js';
import { texMaterial, getTexture } from './textures.js';
import { edgeAt, lanesAt, LANE, crossings, CROSS_HALF, medians, MEDIAN_HALF } from './lanes.js';

// ---------------------------------------------------------------------------
// ASPHALT IN DAYLIGHT, NOT A WET MIRROR.
//
// MEASURED (chase cam, mean of the lower-centre road band, 1280x720): the road
// rendered rgb 134/135/138 with 15.3% of the band blown to white by the sun's
// specular lobe, and -- once that glare was out of shot -- rgb 35/61/95: navy.
// Decomposed live, one term at a time:
//   - sun off, hemisphere off, rim off: each moved the band by <= 2 levels.
//     The deck's albedo is 0x24262a (worldspine roadTint) x a light-grey grain
//     map = ~0.02 linear. Coal. Direct light has almost nothing to reflect.
//   - scene.environment off: 91/100/123 -> 72/79/89. The sky PMREM -- blue at
//     the zenith -- was the road's dominant light, as both IBL irradiance and
//     a grazing-angle Fresnel reflection. That is what read "blue and glossy".
// So the road was a near-black mirror lit by a blue sky. STYLE-LOCK wants
// asphalt 0x2b2b2f -- a neutral dusty grey that reads as tarmac under sun.
//
// The per-biome tint and roughness are re-written every frame by the surface
// driver from worldspine.js, so they cannot be fixed here by setting colour.
// Instead the asphalt materials get a small shader patch with shared uniforms:
//   albedoGain   lifts the driven tint to a realistic asphalt albedo (~0.08)
//   iblSat       desaturates the image-based light ON THE ROAD only, so a blue
//                sky tints it grey-cool rather than navy
//   iblGain / specGain  scale that IBL's diffuse and reflective parts
// and the roughness gain the driver already honours (userData.roughGain) is
// raised so the spine's 0.52-0.74 lands at an effective ~0.75-0.95: a modest
// broad sheen, not a mirror. Rain (roadRough -> 0.30) still reads glossier.
// The uniforms are shared, so live tuning one road material tunes them all.
export const ASPHALT_LOOK = {
  uAlbedoGain: { value: 2.6 },
  uDust: { value: new THREE.Vector3(1.2, 1.0, 0.72) },
  uIblSat: { value: 0.25 },
  uIblGain: { value: 0.85 },
  uSpecGain: { value: 0.45 },
};
const ROUGH_LIFT = 1.35;
function asphaltLook(m) {
  if (m.userData.roughGain) m.userData.roughGain *= ROUGH_LIFT;
  m.roughness = Math.min(1, m.roughness * ROUGH_LIFT);
  m.userData.asphaltLook = ASPHALT_LOOK;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ASPHALT_LOOK);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uAlbedoGain, uIblSat, uIblGain, uSpecGain;\nuniform vec3 uDust;\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= uAlbedoGain * uDust;')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
  {
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    iblIrradiance = mix(vec3(dot(iblIrradiance, LW)), iblIrradiance, uIblSat) * uIblGain;
    radiance = mix(vec3(dot(radiance, LW)), radiance, uIblSat) * uSpecGain;
  }`);
  };
  // one program for every asphalt material, not one per material instance
  m.customProgramCacheKey = () => 'asphalt-look-v1';
  return m;
}

// ROAD BEHIND THE GRID. The road used to start exactly at z = 0 (s = 0) and
// the grid sits at s = 7-27, so the NOSE camera -- ahead of the bike, looking
// back -- saw the tarmac, kerbs and rails stop ~20 m behind the rider with the
// flat backdrop plane beyond: an unfinished edge in the first seconds of every
// race. The carriageway, shoulders, verge, markings, kerbs and guard rail are
// now built from s = -ROAD_BEHIND_M (19 segments = 152 m; z = +152). The
// backdrop's beach strips already reach z = +300. Scenery with a random layout
// (bushes, poles, town, hills) is NOT extended here: shifting their loop starts
// would re-roll every later random draw and move the whole roadside.
// 100 segments = 800 m of road BEHIND the grid (was 19 = 152 m: the world
// visibly ended a few seconds behind the start line).
export const ROAD_BEHIND_SEGS = 100;
export const ROAD_BEHIND_M = ROAD_BEHIND_SEGS * CFG.SEG;

// One deterministic RNG for the whole world, so the level is the same shape
// every run and a critic comparing two builds is comparing the same place.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// Every `mat()` call used to make a BRAND NEW material. Two hundred and
// seventy-seven of them ended up named `plaster`, all with identical values, and
// none of them could be merged by bakeStatic -- which buckets by material
// identity. That is the single largest source of draw calls in the scene: the
// buildings, rails, canopies and rocks all wanted the same handful of materials
// and got hundreds instead.
//
// Caching by value means identical requests return the SAME object, so the bake
// merges them and a town stops costing 277 draws.
const _matCache = new Map();
const mat = (c, r, m) => {
  const key = `${c}|${r ?? 0.8}|${m ?? 0.1}`;
  const hit = _matCache.get(key);
  if (hit) return hit;
  const x = new THREE.MeshStandardMaterial({ color: c, roughness: r ?? 0.8, metalness: m ?? 0.1 });
  _matCache.set(key, x);
  return x;
};

// ---- the road ribbon itself ----
// A long coastal road with gentle but READABLE curves. The old wavelengths
// (480 m and 1350 m) were so long that 100 m of visible road was straight, so
// the frame had no curvature to read speed from and every bend came as a
// surprise. These are ~150 m and ~420 m, which is a highway sweep.
// ELEVATION, and it used to be decorative rather than felt.
//
// MEASURED on the old profile: a maximum gradient of **0.8%** over the whole
// 5.6 km, with seven crests and dips in total -- one every 800 m. A real coast
// road runs 6-10%. The suspension, the weight transfer and the camera were all
// responding correctly to a road that was, in practice, a flat plane.
//
// Two wavelengths are added. A sine of amplitude A and wavelength L has a
// maximum gradient of 2*pi*A/L, which is how these were chosen rather than
// tuned by eye:
//
//   0.011 rad/m, A=2.3  ->  571 m rolling swells,  2.5% grade
//   0.042 rad/m, A=0.55 ->  150 m crests and dips, 2.3% grade
//
// The short wavelength was first set to A=1.1 (4.6%), and the road is much
// better for having had it reduced. Sharp 150 m crests at 52 m/s unsettled the
// pack badly enough that rival contacts in _nondet went from 0 to 4-15 per run,
// and each contact was a chance to be shoved into the barrier. The weight has
// moved into the LONG swell instead, which gives the same sense of a road
// rising and falling through a landscape without throwing the bikes about.
// Combined: ~5% at its steepest, against the 0.8% this started from.
//
// IF YOU CHANGE THESE AMPLITUDES, change ROAD_Y_MIN in buildBackdrop with them.
// It is derived from this sum on purpose: the backdrop plane sits just below
// the road's lowest possible point, and getting that wrong is what buried the
// entire carriageway for a whole session (HANDOFF 5.9).
// THE TWISTIES. The two sweeps above never bend tighter than R ~880 m, which
// at 48 m/s is a 0.27 g motorway curve: MEASURED, a whole race could be won
// holding only the throttle with the bars never touched. Road Rash was raced on
// back roads. So a third, shorter wave (~500 m, amplitude 14 m -> tightest
// R ~460 m, ~0.5 g flat out) is faded in and out by a slow envelope: the course
// alternates between open sweepers and ~1.7 km twisty sections where you have
// to lean, and where running wide puts you into the oncoming lane.
// AMP 24 (R ~270 m) was tried first and MEASURED too much for the pack: one
// rival wrecked on traffic 9-12 times a race. At 14 the field wrecks ~2 times a
// race in total, and a rider who never steers still runs wide into traffic.
// The envelope is zero at z = 0, so every race still starts on a straight.
// Height is untouched, so ROAD_Y_MIN below does not change.
export const TWIST = { AMP: 14, FREQ: 0.0125, ENV: 0.0009 };
export function centreAt(z, out = new THREE.Vector3()) {
  const env = Math.sin(z * TWIST.ENV);
  const x = Math.sin(z * 0.0067) * 18 + Math.sin(z * 0.0024 + 1.7) * 58
          + env * env * TWIST.AMP * Math.sin(z * TWIST.FREQ + 0.6);
  const y = Math.sin(z * 0.0016 + 0.4) * 2.6 + Math.sin(z * 0.0043) * 0.9
          + Math.sin(z * 0.011 + 2.1) * 2.3 + Math.sin(z * 0.042 + 1.3) * 0.55;
  return out.set(x, y, z);
}

export function centreTangent(z, out = new THREE.Vector3()) {
  const dz = 0.5;
  const a = centreAt(z - dz, _t1), b = centreAt(z + dz, _t2);
  // Returns a unit vector along the road. NOTE: this is the road's GEOMETRIC
  // tangent, which points toward +z. The direction of travel is the opposite,
  // because the road is built toward negative z (s = -z). Callers that need the
  // direction of travel must negate it -- see `headAt` below, and BikePhys.sync.
  //
  // This is deliberately left as-is because most callers only use it for its
  // normal (nx = -t.z, nz = t.x), which is sign-invariant.
  return out.copy(b).sub(a).normalize();
}

// The direction of TRAVEL at a road position: the direction in which s
// increases. Everything that cares about "forward" -- the chase camera, the
// traffic, the bike's own heading -- must use this, not centreTangent.
export function headAt(z, out = new THREE.Vector3()) {
  return centreTangent(z, out).negate();
}
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();

export function buildRoad() {
  const g = new THREE.Group();
  const N = CFG.ROAD_SEGS;
  const SEG = CFG.SEG;

  // CRITIC ROUND 2, property to fix first: the road is 55-75% of every frame
  // and ours was matte and clean. The bar's road is WET — it carries a broad
  // specular smear toward the sun — and it is dirty: grit, patch edges, cracks.
  //
  // Now surfaced with the Atlas wet-asphalt map. The texture is a macro of
  // coarse aggregate, so the repeat matters more than the map: at 1 tile per
  // 6 m the ~10 cm stones in the source land at about 1 cm on the road, which
  // is tarmac. Looser than that and the road reads as gravel, which is exactly
  // how the first attempt looked.
  const asphalt = (() => {
    // The strip geometry carries world-space UVs (see the uvScale note below),
    // so the repeat stays 1:1 -- setting it on the texture as well double-tiles.
    //
    // MEASURED, and it still holds now the map is generated rather than loaded:
    // the aggregate map is a light-grey MACRO and the albedo is a tint
    // multiplier, so the material's own colour is the thing that makes tarmac
    // black. Tinting it 0xb8bcc0 (also light grey) multiplied light by light and
    // the road rendered near-white, which then bloomed. The tint must be DARK
    // and the map is only the grain on top of it.
    const m = texMaterial('wet_asphalt', {
      repeat: 1,
      color: 0x3a3d42,
      roughness: 0.52,          // wet tarmac is smoother than dry
      metalness: 0.0,           // tarmac is a dielectric; see worldspine.js
      // 1.5 was carried over from the JPEG era, where the normal was derived
      // from a photo's luminance and was mostly noise. The generated normal
      // comes from the real height field and is far stronger for the same
      // number; the surface driver then multiplies it again by (1 + wetness).
      normalScale: 0.60,
    });
    m.name = 'deck';
    return asphaltLook(m);
  })();
  const worn = (() => {
    // These are the two polished wheel tracks, 1.15 m wide, laid 12 mm above the
    // deck. They were tinted 0xa8a49c — LIGHTER than the deck — which meant the
    // road's own dark surface was never visible: a raycast at left/right of
    // centre hit the track material every time, and the tarmac read as tan
    // concrete. A worn track is where the aggregate is POLISHED, so it should be
    // slightly darker and smoother than the deck, never lighter.
    //
    // The track takes the SAME asphalt surface at a slightly tighter repeat, so
    // the grain does not line up with the deck's and the two strips read as two
    // passes over one road rather than as two materials. It carries the normal
    // and roughness maps too now: a polished track with a broken specular is
    // most of what sells the wet road at a grazing camera angle.
    const m = texMaterial('wet_asphalt', {
      repeat: 0.7, color: 0x2e3136, roughness: 0.40, metalness: 0.0, normalScale: 0.70,
    });
    m.name = 'worn';
    return asphaltLook(m);
  })();
  const kerbM = (() => {
    const m = texMaterial('kerb_stripe', { repeat: 1, roughness: 0.80, metalness: 0.06 });
    m.color.set(0xffffff);
    m.name = 'stone';
    return m;
  })();
  const railM = (() => {
    const m = texMaterial('metal_rail', { repeat: 1, roughness: 0.38, metalness: 0.85, useNormal: false });
    m.name = 'metal';
    return m;
  })();

  // Build the deck as a triangulated strip, with a worn strip either side of
  // the centre — that gives the two-value road claim 1 asks for, for free.
  const half = CFG.ROAD_W / 2;
  // THE ROAD'S EDGES MOVE (lanes.js): every strip is built between two lateral
  // offsets that are functions of distance. `build(width, offset)` is the old
  // fixed-width call, kept as a wrapper.
  const E = (s, side) => edgeAt(Math.max(0, s), side);
  const buildF = (fA, fB, material, yOff, uvScale) => {
    const pos = [], uv = [], idx = [];
    for (let i = -ROAD_BEHIND_SEGS; i <= N; i++) {
      const j = i + ROAD_BEHIND_SEGS;             // vertex-pair index from 0
      const z = -i * SEG;
      const c = centreAt(z);
      const t = centreTangent(z);
      const nx = -t.z, nz = t.x;                 // left normal in xz
      for (const s of [-1, 1]) {
        const o = s < 0 ? fA(-z) : fB(-z);
        pos.push(c.x + nx * o, c.y + yOff, c.z + nz * o);
        uv.push(s * 0.5 + 0.5, (z * uvScale));
      }
      if (j > 0) {
        const a = (j - 1) * 2, b = a + 1, cc = j * 2, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  };
  const build = (width, offset, material, yOff, uvScale) =>
    buildF(() => offset - width / 2, () => offset + width / 2, material, yOff, uvScale);

  // uvScale is TILES PER METRE along the road. The deck is 7.5 m wide and the
  // texture is square, so for the map not to stretch, one U unit must span the
  // same distance as one V unit: U runs 0..1 across 7.5 m, so V must advance
  // 1/7.5 = 0.133 per metre for a square tile. The old 0.06 was 16.7 m per tile
  // vertically against 7.5 m horizontally — a 2.2:1 stretch that read as smeared
  // streaks. 0.133 is square, and at ~7.5 m per tile the generated aggregate
  // lands at roughly real tarmac grain.
  g.add(buildF((s) => -E(s, -1), (s) => E(s, 1), asphalt, 0, 0.133));   // main deck, edge to edge
  // wheel tracks: polished in the middle of the OUTER lane each side
  g.add(buildF((s) => -E(s, -1) + 1.15 - 0.575 - 0.6, (s) => -E(s, -1) + 1.15 + 0.575 - 0.6, worn, 0.012, 0.133 * 1.9));
  g.add(buildF((s) => E(s, 1) - 1.15 - 0.575 + 0.6, (s) => E(s, 1) - 1.15 + 0.575 + 0.6, worn, 0.012, 0.133 * 1.9));

  // UV SCALE, and it was double-applied. `build` generates V as z * uvScale, so
  // the deck's 7200 m becomes 7200 * 0.06 = 432 V units across the strip. Setting
  // the TEXTURE's repeat on top of that (2, 1) compounded it, so the asphalt map
  // was squeezed into a few millimetres per tile and averaged to flat grey — the
  // road looked like bare dirt because the texture had effectively vanished.
  // The strip geometry carries its own world-space UVs, so the texture repeat
  // must stay at 1:1.
  for (const name of ['wet_asphalt', 'wet_asphalt_n', 'wet_asphalt_r']) {
    const t = getTexture(name);
    if (t) { t.repeat.set(1, 1); t.needsUpdate = true; }
  }
  // a faint centre line, lighter than the deck
  // The centre line and dashes. 0x8a8778 read as near-white once bloom was
  // applied over a bright sky — road paint is weathered and off-white, not
  // bright, and bright paint is what pushes the highlight metric past the bar.
  const line = mat(0xe8e2d2, 0.80, 0.0); line.name = 'marking';
  g.add(build(0.14, 0, line, 0.016, 0.2));

  // --- dashed lane edges, as instanced slabs: repeating along the road is
  // claim 4's engine, the thing that makes 60 m/s readable. ---
  const dashGeo = new THREE.BoxGeometry(0.13, 0.012, 2.4);
  const edgeCount = Math.floor((CFG.ROAD_SEGS * CFG.SEG + ROAD_BEHIND_M) / 12) + 2;
  const dashInst = new THREE.InstancedMesh(dashGeo, line, edgeCount * 2);
  dashInst.receiveShadow = true;
  const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), ds = new THREE.Vector3(1, 1, 1), dp = new THREE.Vector3();
  let di = 0;
  for (let z = ROAD_BEHIND_M - 6; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 12) {
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x;
    const yaw = Math.atan2(t.x, t.z);
    for (const s of [-1, 1]) {
      const off = s * (E(-z, s) - 0.55);
      dp.set(c.x + nx * off, c.y + 0.018, c.z + nz * off);
      dq.setFromEuler(new THREE.Euler(0, yaw, 0));
      dm.compose(dp, dq, ds);
      dashInst.setMatrixAt(di++, dm);
    }
  }
  dashInst.count = di;
  dashInst.instanceMatrix.needsUpdate = true;
  g.add(dashInst);

  // --- CENTRELINE: the road is 11 m wide now, which is three lanes, and a wide
  // strip with only edge dashes reads as one enormous carriageway. A centre
  // divider gives it a middle, which is also what makes the oncoming traffic
  // legible: oncoming vehicles are on the far side of THIS line, so the whole
  // risk/reward of an overtake is visible before it starts.
  //
  // INSTANCED DASHES, NOT A LONG BAR. A 5.6 km straight slab cannot follow a
  // curving road -- it would cut across every bend and lie off the deck in the
  // verge. The centreline is therefore the same instanced recipe as the edge
  // dashes, one instance per 12 m segment, each placed on the road's own centre
  // and yawed to its tangent. It is effectively free: one more InstancedMesh.
  const centreGeo = new THREE.BoxGeometry(0.12, 0.012, 3.2);
  const centreInst = new THREE.InstancedMesh(centreGeo, line, edgeCount);
  centreInst.receiveShadow = true;
  let ci2 = 0;
  for (let z = ROAD_BEHIND_M - 6; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 12) {
    const c = centreAt(z), t = centreTangent(z);
    dp.set(c.x, c.y + 0.016, c.z);
    dq.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z), 0));
    dm.compose(dp, dq, ds);
    centreInst.setMatrixAt(ci2++, dm);
  }
  centreInst.count = ci2;
  centreInst.instanceMatrix.needsUpdate = true;
  g.add(centreInst);

  // --- LANE DIVIDERS: short dashes between the lanes of one direction,
  // wherever a second lane is open on that side (lanes.js). Through a taper
  // they run on until the lane is half gone, then stop, as real paint does at
  // a merge.
  const laneGeo = new THREE.BoxGeometry(0.12, 0.012, 3.0);
  const laneInst = new THREE.InstancedMesh(laneGeo, line, edgeCount * 2);
  laneInst.receiveShadow = true;
  let li = 0;
  const LL = { r: 1, l: 1 };
  for (let z = ROAD_BEHIND_M - 6; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 12) {
    lanesAt(Math.max(0, -z), LL);
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x, yaw = Math.atan2(t.x, t.z);
    for (const [side, n] of [[1, LL.r], [-1, LL.l]]) {
      if (n < 1.5) continue;
      const off = side * LANE;
      dp.set(c.x + nx * off, c.y + 0.017, c.z + nz * off);
      dq.setFromEuler(new THREE.Euler(0, yaw, 0));
      dm.compose(dp, dq, ds);
      laneInst.setMatrixAt(li++, dm);
    }
  }
  laneInst.count = li;
  laneInst.instanceMatrix.needsUpdate = true;
  g.add(laneInst);

  // --- MEDIANS: a concrete jersey barrier down the centreline of the divided
  // sections (lanes.js), one instanced segment per SEG, with a striped
  // end block at each end where the road stops being divided.
  {
    const w = MEDIAN_HALF, sh = new THREE.Shape();
    // the jersey profile: a wide foot, a sloped face, a narrow cap
    sh.moveTo(-w, 0); sh.lineTo(-w, 0.08); sh.lineTo(-w * 0.62, 0.3); sh.lineTo(-w * 0.34, 0.82);
    sh.lineTo(w * 0.34, 0.82); sh.lineTo(w * 0.62, 0.3); sh.lineTo(w, 0.08); sh.lineTo(w, 0); sh.lineTo(-w, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: SEG + 0.04, bevelEnabled: false });
    geo.translate(0, 0, -(SEG + 0.04) / 2);
    const conc = mat(0xb9b4aa, 0.9, 0.02); conc.name = 'stone';
    const runs = medians();
    const count = runs.reduce((a, [x, y]) => a + Math.ceil((y - x) / SEG) + 1, 0);
    if (count > 0) {
      const inst = new THREE.InstancedMesh(geo, conc, count);
      inst.castShadow = true; inst.receiveShadow = true;
      let k = 0;
      for (const [a, b] of runs) {
        for (let sM = a + SEG / 2; sM < b; sM += SEG) {
          const c = centreAt(-sM), t = centreTangent(-sM);
          dp.set(c.x, c.y, c.z);
          dq.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z), 0));
          dm.compose(dp, dq, ds.set(1, 1, 1));
          inst.setMatrixAt(k++, dm);
        }
      }
      inst.count = k;
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
      // end blocks: yellow and black, facing the traffic that meets them
      const endM = mat(0xf2c313, 0.6, 0.05); endM.name = 'stone';
      const stripeM = mat(0x151515, 0.6, 0.05); stripeM.name = 'stone';
      for (const [a, b] of runs) for (const sE of [a, b]) {
        const c = centreAt(-sE), t = centreTangent(-sE);
        const blk = new THREE.Mesh(new THREE.BoxGeometry(w * 2.1, 0.95, 0.5), endM);
        blk.position.set(c.x, c.y + 0.475, c.z);
        blk.rotation.y = Math.atan2(t.x, t.z);
        blk.castShadow = true;
        for (let q = -1; q <= 1; q++) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.52), stripeM);
          st.position.set(q * w * 0.6, 0, 0); st.rotation.z = 0.6;
          blk.add(st);
        }
        g.add(blk);
      }
    }
  }

  // --- CROSSROADS: the cross road's deck running out both sides, a stop line
  // across our road either side of it, and zebra stripes (lanes.js crossings).
  for (const cs of crossings()) {
    const z = -cs, c = centreAt(z), t = centreTangent(z);
    const yaw = Math.atan2(t.x, t.z);
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(CROSS_HALF * 2, 420), asphalt);
    const holder = new THREE.Group();
    holder.position.set(c.x, c.y - 0.004, c.z);
    holder.rotation.y = yaw;
    cross.rotation.set(-Math.PI / 2, 0, Math.PI / 2);   // runs across ours (local x), 420 m long
    cross.receiveShadow = true;
    holder.add(cross);
    for (const d of [-1, 1]) {
      // stop lines across our carriageway, and the cross road's own centre line
      const stop = new THREE.Mesh(new THREE.BoxGeometry(E(cs, 1) + E(cs, -1), 0.012, 0.4), line);
      stop.position.set((E(cs, 1) - E(cs, -1)) / 2, 0.02, d * (CROSS_HALF + 1.2));
      holder.add(stop);
      for (let k = 0; k < 6; k++) {
        const zeb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.012, 2.6), line);
        zeb.position.set(-E(cs, -1) + 1 + k * ((E(cs, 1) + E(cs, -1) - 2) / 5), 0.019, d * (CROSS_HALF + 3.2));
        holder.add(zeb);
      }
    }
    // the cross road's centre line, stopping at our kerbs
    for (const d of [-1, 1]) {
      const from = d > 0 ? E(cs, 1) + 1 : E(cs, -1) + 1;
      const cl = new THREE.Mesh(new THREE.BoxGeometry(205 - from, 0.012, 0.12), line);
      cl.position.set(d * (from + (205 - from) / 2), 0.02, 0);
      holder.add(cl);
    }
    g.add(holder);
  }

  // --- tar patches: irregular dark blotches, so the deck is not one flat tone.
  // They are what gives the road a history rather than making it a strip. ---
  // 0x42403c, was 0x232326. Once the deck took a real asphalt albedo (see
  // ASPHALT_LOOK) a 0x232326 patch rendered ~40/255 against a ~90/255 road: a
  // black slab that read as a hole in the tarmac, not a repair. A repair is a
  // shade darker than the road around it, not a void.
  const patch = mat(0x42403c, 0.95, 0.02); patch.name = 'patch';
  // MORE, SMALLER PATCHES. These are a fixed absolute size, so widening the road
  // from 7.5 m to 11 m made the deck 47% larger while the patch count stayed at
  // 220 -- the same tarmac history spread over more area, which reads as bare.
  // Raised to 320 and trimmed the maximum scale, so the marks stay marks: a
  // 3 x 4.4 m slab is a fifth of a lane and reads as a black rectangle rather
  // than as a repair.
  const PATCHES = 320;
  const patchInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 1), patch, PATCHES);
  patchInst.receiveShadow = true;
  let pi2 = 0;
  const prand = rng(99);
  for (let i = 0; i < PATCHES; i++) {
    const z = -prand() * CFG.ROAD_SEGS * CFG.SEG;
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x;
    const off = -E(-z, -1) + 0.7 + prand() * (E(-z, 1) + E(-z, -1) - 1.4);
    dp.set(c.x + nx * off, c.y + 0.02, c.z + nz * off);
    dq.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z) + (prand() - 0.5) * 0.5, 0));
    ds.set(0.5 + prand() * 1.5, 1, 0.7 + prand() * 2.2);
    dm.compose(dp, dq, ds);
    patchInst.setMatrixAt(pi2++, dm);
  }
  patchInst.count = pi2;
  patchInst.instanceMatrix.needsUpdate = true;
  g.add(patchInst);

  // --- cracks: long thin dark slivers laid at shallow angles. They break the
  // deck into plates, which is what makes wet tarmac read as a surface with a
  // history rather than a strip. ---
  const crack = mat(0x1d1d20, 0.55, 0.30); crack.name = 'crack';
  const crackInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.016, 1), crack, 180);
  let ci = 0;
  const crand = rng(1234);
  for (let i = 0; i < 180; i++) {
    const z = -crand() * CFG.ROAD_SEGS * CFG.SEG;
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x;
    const off = -E(-z, -1) + 0.4 + crand() * (E(-z, 1) + E(-z, -1) - 0.8);
    dp.set(c.x + nx * off, c.y + 0.022, c.z + nz * off);
    dq.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z) + (crand() - 0.5) * 1.4, 0));
    ds.set(1, 1, 3 + crand() * 16);
    dm.compose(dp, dq, ds);
    crackInst.setMatrixAt(ci++, dm);
  }
  crackInst.count = ci;
  crackInst.instanceMatrix.needsUpdate = true;
  g.add(crackInst);

  // --- grit along the shoulder, where the surface breaks up. Small stones
  // catch the low sun and give the near field sparkle. ---
  const grit = mat(0x6a655c, 0.9, 0.05); grit.name = 'stone';
  const gritInst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 0), grit, 900);
  let gi = 0;
  const grand = rng(777);
  for (let i = 0; i < 900; i++) {
    const z = -grand() * CFG.ROAD_SEGS * CFG.SEG;
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x;
    const side = grand() > 0.5 ? 1 : -1;
    const off = side * (E(-z, side) + CFG.KERB_W * 0.5 + grand() * 1.6);
    dp.set(c.x + nx * off, c.y + 0.04, c.z + nz * off);
    dq.setFromEuler(new THREE.Euler(grand() * 3, grand() * 3, grand() * 3));
    const sc2 = 0.5 + grand() * 1.5;
    ds.set(sc2, sc2 * 0.7, sc2);
    dm.compose(dp, dq, ds);
    gritInst.setMatrixAt(gi++, dm);
  }
  gritInst.count = gi;
  gritInst.instanceMatrix.needsUpdate = true;
  g.add(gritInst);

  // kerbs: a low box run each side, segmented so it recedes
  for (const s of [-1, 1]) {
    const kerb = new THREE.Group();
    const geoK = new THREE.BoxGeometry(CFG.KERB_W, CFG.KERB_H, SEG + 0.05);
    const inst = new THREE.InstancedMesh(geoK, kerbM, N + ROAD_BEHIND_SEGS);
    inst.receiveShadow = true; inst.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    for (let i = -ROAD_BEHIND_SEGS; i < N; i++) {
      const z = -i * SEG - SEG / 2;
      const c = centreAt(z), t = centreTangent(z);
      const nx = -t.z, nz = t.x;
      const ko = E(-z, s) + CFG.KERB_W / 2;
      // no kerb across a crossroads
      if (crossings().some((cs) => Math.abs(-z - cs) < CROSS_HALF + 2)) { m.makeScale(0, 0, 0); inst.setMatrixAt(i + ROAD_BEHIND_SEGS, m); continue; }
      const p = new THREE.Vector3(c.x + nx * s * ko, c.y + CFG.KERB_H / 2 - 0.02, c.z + nz * s * ko);
      // through a taper the kerb angles out with the edge instead of stepping
      const dE = E(-z + SEG / 2, s) - E(-z - SEG / 2, s);
      q.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z) - Math.atan2(s * dE, SEG), 0));
      m.compose(p, q, sc);
      inst.setMatrixAt(i + ROAD_BEHIND_SEGS, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }

  // verge: a wide band either side, at road level so it catches the same light.
  // It used to sit at y=-0.05 with a near-black material, which made the road a
  // plank over a void: the floor is most of the screen and it has to be lit.
  // Both of these were left at the texMaterial default colour of 0xffffff, i.e.
// the raw generated texture at full brightness. Against a bright sky that made
// the entire midground one pale tan and destroyed the frame's saturation. The
// verge and shoulder are DIRT and CONCRETE — they need a dark tint over the map.
  const verge = texMaterial('dry_scrub', { repeat: 6, color: 0x6a6048, roughness: 0.96, metalness: 0.0 });
  verge.name = 'foliage';
  const shoulder = texMaterial('concrete', { repeat: 3, color: 0x4a4844, roughness: 0.94, metalness: 0.0 });
  shoulder.name = 'shoulder';
  // VERGE PLACEMENT, and this is why the road looked like dirt.
  //
  // `build(width, offset, ...)` centres a ribbon of `width` on `offset`. The old
  // verge was 27 m wide (VERGE_W * 3) centred at 20.25 m out, so it spanned
  // 6.75 m to 33.75 m — and the carriageway is only 7.5 m across, so the verge
  // reached UNDER the road. At the grazing angle of a chase camera the huge verge
  // ribbon won the depth fight against the thin road ribbon and the asphalt was
  // hidden behind it. The road was rendering correctly the entire time; it was
  // simply covered.
  //
  // The verge's INNER edge must sit outside the shoulder's OUTER edge, and its
  // centre must be offset by width/2 so that is true by construction:
  //   shoulder: offset half + KERB_W + 1.1, width 2.2  -> outer edge at +2.2/2
  //   verge:    inner edge must start there, so offset = outerEdge + width/2
  const shoulderW = 2.2;
  const shoulderOff = half + CFG.KERB_W + shoulderW / 2;      // centres the shoulder
  const vergeW = CFG.VERGE_W * 3;
  const vergeInner = shoulderOff + shoulderW / 2;             // = 6.95 m out
  const vergeOff = vergeInner + vergeW / 2;                   // so the inner edge lands there
  // (shoulder and verge follow the moving edge; `half` above is the one-lane edge)
  const sOff = (x, side) => E(x, side) - half;
  for (const s of [-1, 1]) {
    const lo = (a) => (x) => s * (a + sOff(x, s));
    const inS = shoulderOff - shoulderW / 2, outS = shoulderOff + shoulderW / 2;
    const inV = vergeOff - vergeW / 2, outV = vergeOff + vergeW / 2;
    if (s > 0) {
      g.add(buildF(lo(inS), lo(outS), shoulder, -0.02, 0.090));
      g.add(buildF(lo(inV), lo(outV), verge, -0.06, 0.018));
    } else {
      g.add(buildF(lo(outS), lo(inS), shoulder, -0.02, 0.090));
      g.add(buildF(lo(outV), lo(inV), verge, -0.06, 0.018));
    }
  }

  return g;
}

// ---- roadside furniture: what makes the speed readable ----
// Claim 4: rows of placed objects with visible gaps that shrink with distance.
export function buildRoadside(seed = 7) {
  const r = rng(seed);
  const N = CFG.ROAD_SEGS;
  const SEG = CFG.SEG;
  const g = new THREE.Group();

  // The rail is now a real galvanised-steel texture rather than a flat grey.
  // Rail beams are thin in one axis, so the UVs stretch; the map is subtle
  // enough that this reads as weathering rather than as smeared.
  const steel = texMaterial('metal_rail', { repeat: 2, roughness: 0.40, metalness: 0.82, useNormal: false });
  steel.name = 'metal';
  const white = texMaterial('plaster', { repeat: 1, color: 0xe8e2d4, roughness: 0.80, metalness: 0.02 });
  white.name = 'plaster';
  const red = mat(0xd4622a, 0.62, 0.05); red.name = 'plaster';
  const foliage = mat(PAL.foliage, 0.95, 0.0); foliage.name = 'foliage';
  const timber = mat(0x6b543c, 0.9, 0.02); timber.name = 'timber';

  // --- guard rail: posts every 4 m, two rails, on the seaward side ---
  const postGeo = new THREE.BoxGeometry(0.09, 0.75, 0.09);
  const postInst = new THREE.InstancedMesh(postGeo, steel, (N + ROAD_BEHIND_SEGS * 2) * 2);
  postInst.castShadow = true; postInst.receiveShadow = true;
  let pi = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const postPositions = [];
  // Starts ROAD_BEHIND_M behind the line with the road (posts every SEG/2).
  for (let i = -ROAD_BEHIND_SEGS * 4; i < N * 2; i++) {
    const s = (i & 1) === 0 ? -1 : 1;           // rail both sides, alternating
    const z = -(i >> 1) * (SEG / 2) - 2;
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x;
    if (crossings().some((cs) => Math.abs(-z - cs) < CROSS_HALF + 3)) continue;   // open at a crossroads
    const off = s * (edgeAt(Math.max(0, -z), s) + CFG.KERB_W + 0.55);
    p.set(c.x + nx * off, c.y + 0.37, c.z + nz * off);
    q.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z), 0));
    m.compose(p, q, sc);
    postInst.setMatrixAt(pi++, m);
    postPositions.push({ z, s, x: p.x, y: p.y, zz: p.z, t: t.clone() });
  }
  postInst.count = pi;
  postInst.instanceMatrix.needsUpdate = true;
  g.add(postInst);

  // --- rail beams: instanced, because these were the bulk of the draw calls ---
  // Two rails per post pair. Built as two instanced meshes (one per height)
  // rather than a few hundred individual boxes.
  const beamsByHeight = [[], []];
  for (let k = 0; k < postPositions.length; k += 2) {
    const a = postPositions[k];
    const b = postPositions[Math.min(k + 1, postPositions.length - 1)];
    if (a.s !== b.s) continue;
    const len = Math.hypot(b.x - a.x, b.zz - a.zz) || SEG / 2;
    const yaw = Math.atan2(b.x - a.x, b.zz - a.zz);
    const cx = (a.x + b.x) / 2, cz = (a.zz + b.zz) / 2;
    beamsByHeight[0].push([cx, a.y + 0.44 - 0.37, cz, yaw, len]);
    beamsByHeight[1].push([cx, a.y + 0.68 - 0.37, cz, yaw, len]);
  }
  const beamGeo = new THREE.BoxGeometry(0.05, 0.13, 1);
  for (let h = 0; h < 2; h++) {
    const list = beamsByHeight[h];
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(beamGeo, steel, list.length);
    inst.castShadow = true;
    const m2 = new THREE.Matrix4(), q2 = new THREE.Quaternion(), s2 = new THREE.Vector3(), p2 = new THREE.Vector3();
    list.forEach(([x, y, z, yaw, len], i) => {
      p2.set(x, y, z);
      q2.setFromEuler(new THREE.Euler(0, yaw, 0));
      s2.set(1, 1, len + 0.1);
      m2.compose(p2, q2, s2);
      inst.setMatrixAt(i, m2);
    });
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  }

  // --- hazard chevron boards at the outside of bends, shape only, no glyphs ---
  //
  // INSTANCED, like every other repeated prop in the game. These used to be one
  // Group per board with six child Meshes -- a back panel, three chevrons and
  // two legs -- added straight to the group. At one board every 130 m over a
  // 5600 m road that is ~43 boards, i.e. ~260 individual draw calls for the
  // single most expensive un-instanced prop left in the world. It was measured
  // as the bulk of the visible world mesh count (plaster 187, metal 112) and it
  // was over half the draw budget on its own.
  //
  // The two-sided board is built as ONE instanced geometry instead of six
  // meshes: the parts are merged into a single BufferGeometry first, then placed
  // once per site. Same appearance, ~260 draws -> 1.
  {
    // Each repeated PART becomes ONE instanced mesh for the whole road, so the
    // board costs 5 draws total (one panel, three chevrons, one leg) regardless
    // of how many boards there are -- rather than 6 per board.
    const sites = [];
    for (let z = -40; z > -N * SEG; z -= 130) {
      const s = r() > 0.5 ? -1 : 1;
      const c = centreAt(z), t = centreTangent(z);
      const nx = -t.z, nz = t.x;
      const off = s * (edgeAt(Math.max(0, -z), s) + CFG.KERB_W + 2.3);
      sites.push({
        x: c.x + nx * off, y: c.y, z: c.z + nz * off,
        ry: Math.atan2(t.x, t.z) + Math.PI / 2 * s,
      });
    }
    const boardGeoCache = {
      back: new THREE.BoxGeometry(1.5, 0.62, 0.07),
      chev: new THREE.BoxGeometry(0.22, 0.5, 0.02),
      leg: new THREE.BoxGeometry(0.05, 0.56, 0.05),
    };
    const placeInst = (geo, material, part) => {
      if (!sites.length) return;
      const inst = new THREE.InstancedMesh(geo, material, sites.length);
      inst.castShadow = true; inst.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1);
      const pv = new THREE.Vector3(), local = new THREE.Vector3();
      sites.forEach((site, i) => {
        q.setFromEuler(new THREE.Euler(0, site.ry, 0));
        local.set(part.x, part.y, part.z).applyQuaternion(q);
        pv.set(site.x + local.x, site.y + local.y, site.z + local.z);
        m.compose(pv, q, sv);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
    };
    placeInst(boardGeoCache.back, white, { x: 0, y: 0.85, z: 0 });
    for (let i = 0; i < 3; i++) placeInst(boardGeoCache.chev, red, { x: -0.45 + i * 0.45, y: 0.85, z: 0.045 });
    for (const ss of [-1, 1]) placeInst(boardGeoCache.leg, steel, { x: ss * 0.55, y: 0.28, z: 0 });
  }

  // --- scrub clumps: crossed planes read at distance, cones up close ---
  const bushGeoA = new THREE.ConeGeometry(0.55, 1.15, 5);
  const bushGeoB = new THREE.IcosahedronGeometry(0.6, 0);
  const bushA = new THREE.InstancedMesh(bushGeoA, foliage, 420);
  const bushB = new THREE.InstancedMesh(bushGeoB, foliage, 300);
  bushA.castShadow = true; bushB.castShadow = true;
  let ba = 0, bb = 0;
  for (let z = -18; z > -N * SEG; z -= 9) {
    for (const s of [-1, 1]) {
      if (r() > 0.62) continue;
      const c = centreAt(z), t = centreTangent(z);
      const nx = -t.z, nz = t.x;
      const off = s * (edgeAt(Math.max(0, -z), s) + CFG.KERB_W + 1.8 + r() * 14);
      const y = c.y - 0.1;
      p.set(c.x + nx * off, y + 0.5, c.z + nz * off);
      q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0));
      const s3 = 0.6 + r() * 0.9;
      sc.set(s3, s3 * (0.7 + r() * 0.8), s3);
      m.compose(p, q, sc);
      if (r() > 0.45 && ba < 420) { bushA.setMatrixAt(ba++, m); }
      else if (bb < 300) { bushB.setMatrixAt(bb++, m); }
    }
  }
  bushA.count = ba; bushB.count = bb;
  bushA.instanceMatrix.needsUpdate = true; bushB.instanceMatrix.needsUpdate = true;
  g.add(bushA); g.add(bushB);

  // --- telegraph poles: a hard vertical rhythm along the road ---
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.15, 7.4, 7);
  const poleCount = Math.floor(N * SEG / 46) + 1;
  const poleInst = new THREE.InstancedMesh(poleGeo, timber, poleCount);
  poleInst.castShadow = true;
  const armGeo = new THREE.BoxGeometry(1.9, 0.09, 0.11);
  const armInst = new THREE.InstancedMesh(armGeo, timber, poleCount);
  armInst.castShadow = true;
  let pcount = 0;
  const ma = new THREE.Matrix4(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(1, 1, 1), pa = new THREE.Vector3();
  for (let z = -30; z > -N * SEG; z -= 46) {
    const s = -1;
    const c = centreAt(z), t = centreTangent(z);
    const nx = -t.z, nz = t.x;
    const off = s * (edgeAt(Math.max(0, -z), s) + CFG.KERB_W + 5.5);
    p.set(c.x + nx * off, c.y + 3.7, c.z + nz * off);
    q.setFromEuler(new THREE.Euler(0, 0, 0));
    sc.set(1, 1, 1);
    m.compose(p, q, sc);
    poleInst.setMatrixAt(pcount, m);
    // cross arm
    pa.set(p.x, p.y + 1.0, p.z);
    qa.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z) + Math.PI / 2, 0));
    ma.compose(pa, qa, sa);
    armInst.setMatrixAt(pcount, ma);
    pcount++;
  }
  poleInst.count = pcount;
  armInst.count = pcount;
  poleInst.instanceMatrix.needsUpdate = true;
  armInst.instanceMatrix.needsUpdate = true;
  g.add(poleInst);
  g.add(armInst);

  return g;
}

// ---- distant scenery: the coast. Silhouette only, and it must read as
// DISTANCE, not as a wall. Every trap here is the same one: an object big
// enough to fill the frame is a wall, however you name it.
export function buildBackdrop(seed = 11) {
  const r = rng(seed);
  const g = new THREE.Group();
  const cliffFar = mat(0x4f5560, 1.0, 0.0); cliffFar.name = 'stone';
  const cliffNear = mat(0x565046, 0.98, 0.0); cliffNear.name = 'stone';
  const sea = mat(0x3f5a66, 0.22, 0.15); sea.name = 'sea';
  // The beach is the single largest surface in the frame after the sky, and it
  // was a flat colour with no map at all -- `buildBackdrop` is not passed
  // through applySurfaces, so nothing else was going to surface it. Once the
  // plane stopped burying the road (see below) it became a solid slab of tone
  // running from the kerb to the hills. It takes the generated scrub surface
  // now, at a 10 m tile: fine enough to break the slab up, coarse enough that
  // a 6.2 km plane does not moire at the horizon.
  const beach = texMaterial('dry_scrub', { repeat: 60, repeatY: 620, color: 0x6b6252, roughness: 0.97, metalness: 0.0 });
  beach.name = 'stone';

  // --- the sea: a large plane, but pushed down and out so it reads as a
  // horizon rather than a surface you stand on ---
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000, 1, 1), sea);
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(0, -18, -CFG.ROAD_SEGS * CFG.SEG / 2);
  g.add(seaMesh);

  // --- the coast: a low band of beach either side, so the road is not a
  // plank over a void. This is the fix for "the world only exists near you". ---
  //
  // AND IT WAS COVERING THE ROAD. Measured: a centre-screen raycast from the
  // chase camera hit this plane at 1.7 m and the `deck` only at 3.2 m, with the
  // plane's hit point at y = -0.6 and the road's at y = -1.4. The plane was
  // ABOVE the carriageway, so the bottom 55% of every frame was one flat tan
  // sheet and no road was visible at all.
  //
  // Two faults, and the first one hides the second:
  //
  //  1. The strips are 600 m wide centred at x = +/-300, so their inner edges
  //     meet at x = 0 -- they do not sit "either side" of anything, they tile
  //     the whole world including the ground under the road.
  //  2. They sat at a CONSTANT y = -0.55 while the road undulates. centreAt's
  //     elevation is sin(z*0.0016+0.4)*2.6 + sin(z*0.0043)*0.9, so the road
  //     runs from -3.11 m to +2.58 m -- below -0.55 for a large part of its
  //     length, and buried every time.
  //
  // Fault 1 is left as it is, deliberately: a continuous floor under the world
  // is what stops a hole appearing between the verge's outer edge and the
  // beach. Fault 2 is the real one, and the floor is now placed below the
  // road's LOWEST POSSIBLE point rather than at a number that happened to work
  // at z = 0. Derived from the amplitudes rather than measured off one frame,
  // so changing the road's shape cannot quietly re-bury it.
  const ROAD_Y_MIN = -(2.6 + 0.9 + 2.3 + 0.55);  // centreAt's worst case, by construction
  const BEACH_Y = ROAD_Y_MIN - 0.35;        // clear of the verge, which rides 0.06 below the deck
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(600, CFG.ROAD_SEGS * CFG.SEG + 600), beach);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(s * 300, BEACH_Y, -CFG.ROAD_SEGS * CFG.SEG / 2);
    g.add(strip);
  }

  // --- headlands: far, low, overlapping ridges. Placed 400-1400 m out, so
  // they occupy the lower sky and leave the horizon visible above them. ---
  for (let i = 0; i < 14; i++) {
    const depth = 900 + i * 320 + r() * 300;
    const s = i % 2 === 0 ? -1 : 1;
    const w = 500 + r() * 700;
    // A far ridge should be a LOW band on the horizon, not a mountain. Height
    // grows with distance only enough to keep it off the water line.
    const h = 20 + depth * 0.012 + r() * 16;
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(w, h, 300 + r() * 240), cliffFar);
    ridge.position.set(
      s * (300 + depth * 0.26 + r() * 200),
      h / 2 - 14,
      -depth * 1.15 - r() * 400);
    ridge.rotation.y = (r() - 0.5) * 0.5;
    ridge.rotation.z = (r() - 0.5) * 0.04;
    g.add(ridge);
  }

  // --- the near coast on the landward side: a low, DISTANT line of bluffs.
  // These were 120-250 m wide at 135-225 m out, which from a low camera filled
  // two fifths of the frame and read as a wall beside the road. The lesson is
  // in traps.md and I walked into it anyway: an object big enough to fill the
  // frame is a wall, whatever you call it. Push them out, shrink them, and let
  // them sit BELOW the horizon line.
  for (let z = 60; z > -CFG.ROAD_SEGS * CFG.SEG; z -= 340) {
    const c = centreAt(z);
    const s = -1;
    const w = 90 + r() * 110;
    const h = 9 + r() * 14;                 // low: they must not reach the skyline
    const bluff = new THREE.Mesh(new THREE.BoxGeometry(w, h, 130 + r() * 80), cliffNear);
    bluff.position.set(c.x + s * (410 + r() * 150), h / 2 - 8 + r() * 3, c.z - r() * 140);
    bluff.rotation.y = (r() - 0.5) * 0.8;
    g.add(bluff);
  }

  // --- a far horizon band ---
  // THIS WAS THE VERTICAL SEAM. It is a 9.2 km wide cylinder, 44 m tall, with
  // BackSide, drawn INSIDE the sky dome. Two faults: 40 radial segments meant
  // each facet was 9 degrees wide and the flat-shaded edges read as vertical
  // bands, and its material is a cool grey (#8b98a4) so the band visibly split
  // the frame into a warm half and a cool half along the seam. It also completely
  // hid the Atlas sky at the horizon.
  //
  // The whole point of the band was to give the sea a soft horizon line when the
  // sky was a flat gradient. The Atlas panorama already contains a real sea and a
  // real horizon, so the band is not just broken, it is redundant. Retired: the
  // panorama's own horizon does this job, correctly, for free.
  //
  // Kept behind a flag rather than deleted, because a fallback sky (failed
  // texture load) still needs a horizon line or the world sits on a hard edge.
  if (!getTexture('sky_dusk')) {
    const bandMat = mat(0x8b98a4, 1.0, 0.0); bandMat.name = 'stone';
    bandMat.side = THREE.BackSide;
    bandMat.fog = true;
    // 160 segments, not 40: a 9 km cylinder needs ~2 degrees per facet before the
    // flat shading stops reading as vertical stripes.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(4600, 4600, 44, 160, 1, true), bandMat);
    band.position.set(0, 0, -CFG.ROAD_SEGS * CFG.SEG / 2);
    g.add(band);
  }

  return g;
}