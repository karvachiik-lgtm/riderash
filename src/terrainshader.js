// RideRash — PROCEDURAL TERRAIN DETAIL, in the shader.
//
// The terrain skirt is big triangles (8 m rows, columns tens of metres apart
// out from the road) carrying ONE tiled texture and a vertex colour -- which
// from the saddle reads as flat painted sheets: a smooth brown rock wall, a
// tan plain, a green slab. Adding vertices everywhere would cost memory and
// build time and still look smooth between them. Detail per PIXEL costs
// neither, so it is injected into the standard material (lighting, shadows and
// fog untouched) with onBeforeCompile:
//
//   albedo   world-space value-noise fBm at three scales (40 m patches, 6 m
//            clumps, 0.8 m grain) modulating the vertex colour; dry/dirt
//            patches on the flats
//   rock     wherever the surface is steep: a rock colour per course, with
//            horizontal STRATA bands wobbling through the face and dark cracks
//            -- projected TRIPLANAR (by the dominant normal axis) so a cliff
//            face is not a stretched smear of the ground pattern
//   bump     the same noise perturbs the normal (derivative bump, no map),
//            fading out by ~160 m so the far field does not shimmer
//
// Everything is analytic: no textures, no files, one material per use.
import * as THREE from 'three';

const NOISE = /* glsl */`
float tr_hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tr_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tr_hash(i), tr_hash(i + vec2(1.0, 0.0)), u.x), mix(tr_hash(i + vec2(0.0, 1.0)), tr_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tr_fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * tr_noise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}
// the 2D coordinates for a surface: its plan view where it is flat, a side
// elevation where it is a wall
vec2 tr_plane(vec3 wp, vec3 wn) {
  vec3 a = abs(wn);
  if (a.y > 0.62) return wp.xz;
  return a.x > a.z ? wp.zy : wp.xy;
}
`;

/**
 * Give a MeshStandardMaterial procedural terrain detail.
 * opts: rock (hex), dirt (hex), rockAmt 0..1, bump, strata, tint 0..1
 */
export function enhanceTerrain(mat, opts = {}) {
  const U = {
    uRock: { value: new THREE.Color(opts.rock ?? 0x7a7068) },
    uDirt: { value: new THREE.Color(opts.dirt ?? 0x8a7458) },
    uRockAmt: { value: opts.rockAmt ?? 1 },
    uBump: { value: opts.bump ?? 1.0 },
    uStrata: { value: opts.strata ?? 1.0 },
    uDetail: { value: opts.detail ?? 1.0 },
  };
  mat.userData.terrainUniforms = U;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTrW;\nvarying vec3 vTrN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vTrW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTrN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTrW;
        varying vec3 vTrN;
        uniform vec3 uRock; uniform vec3 uDirt;
        uniform float uRockAmt; uniform float uBump; uniform float uStrata; uniform float uDetail;
        float trH;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wn = normalize(vTrN);
          vec2 q = tr_plane(vTrW, wn);
          float macro = tr_fbm(q * 0.025);
          float meso = tr_noise(q * 0.17);
          float grain = tr_noise(q * 1.25);
          float dist = length(vTrW - cameraPosition);
          float near = 1.0 - smoothstep(60.0, 260.0, dist);
          // colour variation: big patches, clumps, grain (the grain only up close)
          float k = 0.80 + 0.36 * macro + 0.14 * (meso - 0.5) + 0.10 * (grain - 0.5) * near;
          diffuseColor.rgb *= mix(1.0, k, uDetail);
          // dry, trodden patches on the flats
          float dirt = smoothstep(0.58, 0.74, tr_fbm(q * 0.06 + 7.0)) * smoothstep(0.7, 0.9, wn.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, uDirt * (0.8 + 0.3 * meso), dirt * 0.55 * uDetail);
          // rock wherever it is steep, in strata, with cracks
          float slope = 1.0 - wn.y;
          float rk = smoothstep(0.26, 0.46, slope + 0.12 * (meso - 0.5)) * uRockAmt;
          // far off, a steep face is mostly vegetated ledges: rock shows in streaks only
          float farV = smoothstep(150.0, 700.0, dist);
          rk *= 1.0 - farV * (0.75 - 0.5 * smoothstep(0.5, 0.8, macro));
          float band = 0.5 + 0.5 * sin(vTrW.y * 1.35 + tr_noise(vec2(q.x * 0.08, vTrW.y * 0.3)) * 5.0);
          // joints: thin, mostly vertical, and only here and there (a mask breaks the contour look)
          float crack = smoothstep(0.035, 0.0, abs(tr_noise(q * vec2(0.55, 0.12)) - 0.5)) * smoothstep(0.55, 0.75, tr_noise(q * 0.07 + 3.0)) * near;
          // strata fade with distance: fine bands alias into a paper-stack at 800 m
          float farK = 1.0 - smoothstep(120.0, 600.0, dist);
          vec3 rock = uRock * (0.72 + 0.34 * mix(0.5, band, uStrata * (0.25 + 0.75 * farK)) + 0.18 * (grain - 0.5) * near) * (1.0 - 0.45 * crack);
          // and far faces take on the big-patch variation instead (vegetated ledges)
          rock = mix(rock, rock * (0.7 + 0.6 * macro), 1.0 - farK);
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, rk);
          // the bump height: rock is rougher than soil
          trH = (macro * 0.6 + meso * 0.9 + grain * 0.45 * near) * (1.0 + 1.6 * rk) + band * rk * 0.8 * uStrata;
          trH *= near;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // derivative bump from trH (no texture): perturbNormalArb, inline
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec2 dh = vec2(dFdx(trH), dFdy(trH)) * uBump * 0.35;
          vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  // a stable program key so every enhanced material shares one compiled program
  mat.customProgramCacheKey = () => 'riderash-terrain-v1';
  mat.needsUpdate = true;
  return mat;
}

/** Per-course rock and dirt colours (what the ground is made of). */
export const TERRAIN_ROCK = {
  sierra: { rock: 0x8d8b86, dirt: 0x8a7a60 },      // granite
  coastal: { rock: 0x9c8a6e, dirt: 0xa08a64 },     // sandstone bluffs
  valley: { rock: 0x7c705e, dirt: 0x8c7454 },
  peninsula: { rock: 0x7f786c, dirt: 0x8a7a62 },
  desert: { rock: 0xa4623e, dirt: 0xb48a5a },      // red rock
  ghat: { rock: 0x5e564d, dirt: 0x8a5a3a },        // basalt, laterite soil
};
