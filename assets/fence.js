// RideRash roadside asset: fence.
// 4 m fence bay along X. v0: split-rail ranch fence (attempt A). v1: post-and-wire with steel T-posts (attempt C).
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
  const w = M(0x7a6048, 0.93, 0, 'timber'), wd = M(0x5e4a38, 0.93, 0, 'timber');
  for (const x of [-2, 2]) { add(rough(B(0.16, 1.35, 0.16), 0.02), wd, x, 0.675, 0); add(new THREE.ConeGeometry(0.13, 0.12, 4), wd, x, 1.41, 0, 0, Math.PI / 4, 0); }
  for (const y of [0.45, 0.8, 1.15]) add(rough(B(4.1, 0.12, 0.07), 0.02), w, 0, y, 0.1);
  add(B(0.08, 1.4, 0.06), w, 0, 0.8, 0.14, 0, 0, Math.atan2(4, 0.9) - Math.PI / 2 + 0.3);
    },
    () => {
  const V = 0;
  const wd = M(0x6a543e, 0.93, 0, 'timber'), st = M(0x5a5f63, 0.5, 0.6, 'metal'), wi = M(0x8a9199, 0.4, 0.8, 'metal');
  add(rough(C(0.09, 0.11, 1.3, 7), 0.02), wd, -2, 0.65, 0);
  for (const x of [-0.67, 0.67]) { add(B(0.05, 1.2, 0.03), st, x, 0.6, 0); add(B(0.1, 0.05, 0.05), st, x, 0.95, 0.02); }
  add(rough(C(0.09, 0.11, 1.3, 7), 0.02), wd, 2, 0.65, 0);
  for (const y of [0.4, 0.7, 1.0]) add(B(4.0, 0.015, 0.015), wi, 0, y, 0.03);
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
