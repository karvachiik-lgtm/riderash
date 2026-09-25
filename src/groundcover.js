// RideRash — GROUND COVER: grass and wild flowers along the verge.
//
// The roadside between the placed shrubs was bare ground -- a flat tint from
// the kerb to the tree line. A real verge is thousands of tufts. They are one
// procedural geometry (a tuft of thin blades, dark at the root, bright at the
// tip), instanced per scenery chunk into its NEAR group, so they are drawn only
// within the tier's near radius (150-300 m) and cost nothing past it. Wind is
// a vertex-shader sway (no CPU work): the blade tip moves, the root does not.
import * as THREE from 'three';

let _geo = null;
/** One tuft: N blades around the origin, height 1, vertex colours root->tip. */
export function tuftGeometry(blades = 11) {
  if (_geo) return _geo;
  const pos = [], col = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.6;
    const r = 0.05 + 0.1 * ((i * 7) % 3) / 2;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const w = 0.06 + 0.03 * (i % 2);
    const lean = 0.18 + 0.14 * ((i * 5) % 3) / 2;
    const h = 0.65 + 0.35 * ((i * 3) % 4) / 3;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;                  // across the blade
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    col.push(0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 1.15, 1.15, 1.1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // blades are lit as if their normal were up: grass reads as a surface, not
  // as a thousand edge-on triangles going black
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  _geo = g;
  return g;
}

export const GRASS_TIME = { value: 0 };
let _mat = null;
export function tuftMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.name = 'grass';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrassT = GRASS_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGrassT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 root = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float h = position.y;
          float gust = 0.6 + 0.4 * sin(uGrassT * 0.35 + root.x * 0.013 + root.z * 0.011);
          transformed.x += sin(uGrassT * 1.9 + root.x * 0.37 + root.z * 0.23) * 0.16 * h * h * gust;
          transformed.z += cos(uGrassT * 1.5 + root.z * 0.31) * 0.10 * h * h * gust;
        }`);
  };
  m.customProgramCacheKey = () => 'riderash-grass-v1';
  _mat = m;
  return m;
}
