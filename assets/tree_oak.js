// RideRash roadside asset: tree_oak.
// Valley/live oak. v0: wide limb-and-cluster oak (attempt C). v1: round clumped oak (attempt A).
// Built to docs/asset-contract.md: metres, base at y = 0, centred on x/z, front +Z,
// primitives/extrusions/lathes only, flat colours named from the contract list.
// Chosen by eye from three independent attempts (see scenery.js header); the
// losing attempts that still read well are kept as `opts.variant` so the road is
// not lined with one silhouette. Variants: 2. Flat shading on purpose: the
// style lock wants visible facets, and at 50 m/s the facet edges are what read.
export default function generate(THREE) {
  const g = new THREE.Group();
  const O = arguments[1] || {};
  const VV = O.variant | 0;
  let _s = 1234567 + VV * 7919;
  const R = () => (_s = (_s * 16807) % 2147483647) / 2147483647;
  const M = (c, r = 0.9, m = 0, n = '', side) => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, flatShading: true }); x.name = n; if (side) x.side = THREE.DoubleSide; return x; };
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, par = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); par.add(o); return o; };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (rt, rb, h, n = 8) => new THREE.CylinderGeometry(rt, rb, h, n);
  // Jitter every vertex a little, so a primitive reads as a hand-cut facet
  // rather than a CAD solid. Keyed by position so shared seams stay closed.
  const rough = (geo, a) => { const p = geo.attributes.position; const k = new Map(); for (let i = 0; i < p.count; i++) { const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; if (!k.has(key)) k.set(key, [(R() - 0.5) * a, (R() - 0.5) * a, (R() - 0.5) * a]); const d = k.get(key); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]); } geo.computeVertexNormals(); return geo; };
  const _variants = [
    () => {
  const V = 0;
  const bark = M(0x564535, 0.95, 0, 'timber'), f1 = M(0x3f5d2e, 0.9, 0, 'foliage'), f2 = M(0x4d6c36, 0.9, 0, 'foliage'), f3 = M(0x304a26, 0.9, 0, 'foliage');
  add(rough(C(0.38, 0.6, 2.6, 8), 0.08), bark, 0, 1.3, 0);
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * 6.28 + R() * 0.5, L = 3.6 + R() * 1.4, el = 0.55 + R() * 0.35;
    const dx = Math.cos(a) * Math.cos(el), dz = Math.sin(a) * Math.cos(el), dy = Math.sin(el);
    const geo = C(0.12, 0.26, L, 6); geo.translate(0, L / 2, 0);
    const o = new THREE.Mesh(geo, bark); o.position.set(0, 2.4, 0); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz)); g.add(o);
    const tx = dx * L, ty = 2.4 + dy * L, tz = dz * L;
    for (let j = 0; j < 3; j++) { const r = 1.5 + R() * 0.9; const cg = rough(new THREE.DodecahedronGeometry(r, 0), 0.3); cg.scale(1.1, 0.7, 1.1); add(cg, [f1, f2, f3][(k + j) % 3], tx + (R() - 0.5) * 2, ty + 0.4 + (R() - 0.3) * 1.2, tz + (R() - 0.5) * 2, 0, R() * 6, 0); }
  }
  const top = rough(new THREE.DodecahedronGeometry(2.6, 0), 0.3); top.scale(1.2, 0.7, 1.2); add(top, f2, 0, 6.6, 0);
    },
    () => {
  const V = 0;
  const bark = M(0x4f4032, 0.95, 0, 'timber'), f1 = M(0x3c5a2c, 0.9, 0, 'foliage'), f2 = M(0x4a6a34, 0.9, 0, 'foliage'), f3 = M(0x2f4824, 0.9, 0, 'foliage');
  add(rough(C(0.32, 0.5, 3.2, 7), 0.06), bark, 0, 1.6, 0);
  const limbs = [[0.6, 0.0, 0.5], [-0.55, 0.3, 0.45], [0.1, -0.6, 0.35], [-0.1, 0.55, -0.3]];
  for (const [lx, lz, tilt] of limbs) { const L = 3.2; const o = add(C(0.14, 0.26, L, 6), bark, lx * 0.9, 3.0 + L * 0.4, lz * 0.9); o.rotation.set(lz * 0.9, 0, -lx * 0.9); }
  const clumps = [[0, 7.0, 0, 3.0], [2.6, 6.2, 0.6, 2.3], [-2.4, 6.4, 0.9, 2.4], [0.4, 6.0, -2.5, 2.3], [-0.9, 6.6, 2.4, 2.2], [1.8, 7.6, -1.2, 2.0], [-1.8, 7.8, -1.0, 1.9], [2.2, 5.4, 2.2, 1.7]];
  clumps.forEach(([x, y, z, r], i) => { const geo = rough(new THREE.IcosahedronGeometry(r, 1), 0.35); geo.scale(1, 0.78, 1); add(geo, [f1, f2, f3][i % 3], x, y, z, 0, R() * 6, 0); });
    },
  ];
  _variants[VV % 2]();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  g.traverse((n) => { const p = n.isMesh && n.geometry.attributes.position; if (!p) return; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld)); });
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((o) => { o.position.x -= c.x; o.position.y -= box.min.y; o.position.z -= c.z; });
  return g;
}
