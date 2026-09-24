// RideRash — the surface driver.
//
// This is the thing that turns the world spine's numbers into what is actually
// on screen. It holds references to the level's road, wheel-track, shoulder and
// verge materials and re-drives them from the spine's interpolated state.
//
// WHY IT EXISTS SEPARATELY FROM level.js. Building the road and deciding what it
// looks like RIGHT NOW are two different jobs with two different lifetimes: the
// geometry is made once, the surface state changes every frame. Keeping them in
// one module is what produced a road that looked identical for seven kilometres.
//
// The trick that makes this cheap: the textures never change. Only tint,
// roughness, metalness and the normal strength get lerped. Four numbers per
// material per frame, and the same six GENERATED surfaces produce a road that
// reads as wet coast, dry scrub, shaded forest, hot canyon and city night.
// (They were seven downloaded JPEGs until the surfaces went procedural; the
// driver did not have to change, which is the point of driving tint rather than
// swapping maps.)
import * as THREE from 'three';

// WHICH MATERIAL GETS WHICH TREATMENT.
//
// This used to be "any material named ground or foliage", and almost every
// surface in level.js was named `ground` — the asphalt deck, the worn wheel
// tracks, the concrete shoulder, the road markings, the tar patches, even the
// SEA. The driver lumped them all together and drove them to one road tint,
// which is why the entire midground came out a single flat tan and the road
// stopped reading as a road.
//
// Naming each surface for what it IS (deck, worn, shoulder, marking, sea) lets
// the driver say precisely what it wants: the carriageway takes the road tint,
// the verge and shoulder take the verge tint, the markings and the sea are left
// alone because nothing about a biome should repaint a painted line or an ocean.
const ROAD_MATS = ['deck'];              // carriageway: road tint, wet gloss
const TRACK_MATS = ['worn'];             // polished wheel tracks: same tint, smoother
const VERGE_MATS = ['foliage', 'shoulder'];  // roadside: verge tint, dull
// Everything else -- marking, patch, crack, stone, metal, plaster, sea, timber
// -- is deliberately NOT driven. A blue-line road marking is white in every
// biome, and the sea is the sea.
const DRIVEN = new Set([...ROAD_MATS, ...TRACK_MATS, ...VERGE_MATS]);

export class SurfaceDriver {
  constructor(level, spine, scene) {
    this.spine = spine;
    this.scene = scene;
    this.level = level;
    this.enabled = true;

    // Materials the spine drives, collected by NAME from the level's road group.
    this.targets = [];
    const seen = new Set();
    level.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || !m.isMeshStandardMaterial) return;
      if (!DRIVEN.has(m.name)) return;
      if (seen.has(m.uuid)) return;
      seen.add(m.uuid);
      const isVerge = VERGE_MATS.includes(m.name);
      const isTrack = TRACK_MATS.includes(m.name);
      this.targets.push({
        mat: m,
        name: m.name,
        isVerge,
        isTrack,
        last: { tint: new THREE.Color(), rough: -1, metal: -1 },
        baseNormal: m.normalScale ? m.normalScale.x : 0,
        baseEnv: m.envMapIntensity !== undefined ? m.envMapIntensity : 1,
        // Surfaces are generated now, and a generated surface carries a real
        // roughness MAP -- which three.js multiplies `material.roughness` by.
        // Writing the spine's 0.52 straight onto a material whose map averages
        // 0.83 renders 0.43, and on the rail's band (mean 0.52) it would render
        // half of what the biome asked for. textures.js stashes the reciprocal
        // of the map's mean here so the driver can undo it. No map, gain of 1,
        // and this whole line costs nothing.
        roughGain: m.userData && m.userData.roughGain ? m.userData.roughGain : 1,
      });
    });

    this.lastState = null;
  }

  // Called every frame with the rider's distance along the road.
  update(s, dt) {
    if (!this.enabled || !this.targets.length) return null;
    const st = this.spine.stateAt(s, dt);
    this.lastState = st;

    for (const t of this.targets) {
      let want;
      if (t.isVerge) {
        want = { tint: st.vergeTint, rough: st.vergeRough, metal: 0.0 };
      } else if (t.isTrack) {
        // a wheel track is the same asphalt, POLISHED: a touch smoother and a
        // touch darker, so the road reads as having been ridden on
        want = {
          tint: st.roadTint.clone().multiplyScalar(0.86),
          rough: THREE.MathUtils.clamp(st.roadRough - 0.08, 0.26, 1.0),
          metal: st.roadMetal,
        };
      } else {
        want = { tint: st.roadTint, rough: st.roadRough, metal: st.roadMetal };
      }

      // Only write when the change is perceptible. Setting a THREE material
      // property marks its program dirty in some paths, and doing that for a
      // dozen materials every frame is a real cost for no visible gain.
      if (t.last.tint.getHex() !== want.tint.getHex()) {
        t.mat.color.copy(want.tint);
        t.last.tint.copy(want.tint);
      }
      if (Math.abs(t.last.rough - want.rough) > 0.004) {
        t.mat.roughness = Math.min(1, want.rough * t.roughGain);
        t.last.rough = want.rough;
      }
      if (Math.abs(t.last.metal - want.metal) > 0.004) {
        t.mat.metalness = want.metal;
        t.last.metal = want.metal;
      }
      // Standing water FILLS the texture's lows, so a wet road shows LESS relief,
      // not more. The old (1 + wet * 0.7) pushed the normal to ~1.8 in the rain
      // and the carriageway rendered as rippling water.
      if (t.baseNormal > 0) {
        const n = t.baseNormal * (1 - this.spine.wetness * 0.35);
        t.mat.normalScale.set(n, n);
      }
      // wet surfaces reflect more of the sky
      if (t.mat.envMapIntensity !== undefined) {
        t.mat.envMapIntensity = t.baseEnv * (1 + this.spine.wetness * 0.45);
      }
    }

    // Fog follows the sector, and thickens in the rain.
    if (this.scene.fog && this.scene.fog.color) {
      this.scene.fog.color.copy(st.fog);
      this.scene.fog.density = st.fogDensity;
    }
    return st;
  }
}