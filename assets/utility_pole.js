// RideRash roadside asset: utility_pole.
// Telephone pole. v0: crossarm, braces, glass insulators, step bolts (attempt A). v1: same with transformer can. v2: H-frame rural line (attempt C).
// Built to docs/asset-contract.md: metres, base at y = 0, centred on x/z, front +Z,
// primitives/extrusions/lathes only, flat colours named from the contract list.
// Chosen by eye from three independent attempts (see scenery.js header); the
// losing attempts that still read well are kept as `opts.variant` so the road is
// not lined with one silhouette. Variants: 3. Flat shading on purpose: the
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
  const t = M(0x5f4c3a, 0.95, 0, 'timber'), gl = M(0x3a5a4a, 0.4, 0.1, 'tile'), st = M(0x5a5f63, 0.5, 0.6, 'metal');
  add(rough(C(0.13, 0.17, 9.5, 8), 0.02), t, 0, 4.75, 0);
  add(B(2.4, 0.12, 0.12), t, 0, 8.7, 0.1);
  for (const x of [-0.6, 0.6]) add(B(0.05, 0.8, 0.03), st, x * 0.55, 8.35, 0.1, 0, 0, x > 0 ? -0.8 : 0.8);
  for (const x of [-1.1, -0.5, 0.5, 1.1]) { add(C(0.035, 0.035, 0.12, 6), st, x, 8.83, 0.1); add(C(0.06, 0.08, 0.14, 8), gl, x, 8.96, 0.1); }
  for (let i = 0; i < 6; i++) add(B(0.22, 0.03, 0.03), st, 0, 2.6 + i * 0.9, 0, 0, i % 2 ? 0 : Math.PI / 2, 0);
  if (V % 2) { add(C(0.28, 0.28, 0.9, 10), M(0x7b8084, 0.5, 0.5, 'metal'), 0, 7.1, 0.35); }
    },
    () => {
  const V = 1;
  const t = M(0x5f4c3a, 0.95, 0, 'timber'), gl = M(0x3a5a4a, 0.4, 0.1, 'tile'), st = M(0x5a5f63, 0.5, 0.6, 'metal');
  add(rough(C(0.13, 0.17, 9.5, 8), 0.02), t, 0, 4.75, 0);
  add(B(2.4, 0.12, 0.12), t, 0, 8.7, 0.1);
  for (const x of [-0.6, 0.6]) add(B(0.05, 0.8, 0.03), st, x * 0.55, 8.35, 0.1, 0, 0, x > 0 ? -0.8 : 0.8);
  for (const x of [-1.1, -0.5, 0.5, 1.1]) { add(C(0.035, 0.035, 0.12, 6), st, x, 8.83, 0.1); add(C(0.06, 0.08, 0.14, 8), gl, x, 8.96, 0.1); }
  for (let i = 0; i < 6; i++) add(B(0.22, 0.03, 0.03), st, 0, 2.6 + i * 0.9, 0, 0, i % 2 ? 0 : Math.PI / 2, 0);
  if (V % 2) { add(C(0.28, 0.28, 0.9, 10), M(0x7b8084, 0.5, 0.5, 'metal'), 0, 7.1, 0.35); }
    },
    () => {
  const V = 0;
  const t = M(0x5a4838, 0.95, 0, 'timber'), gl = M(0x3a5a4a, 0.4, 0.1, 'tile');
  for (const x of [-1.2, 1.2]) add(rough(C(0.14, 0.18, 10, 8), 0.02), t, x, 5, 0);
  add(B(3.4, 0.16, 0.16), t, 0, 9.3, 0);
  add(B(0.08, 3.2, 0.08), t, 0, 7.8, 0.1, 0, 0, 0.72); add(B(0.08, 3.2, 0.08), t, 0, 7.8, 0.1, 0, 0, -0.72);
  for (const x of [-1.4, 0, 1.4]) add(C(0.06, 0.09, 0.3, 7), gl, x, 9.55, 0);
    },
  ];
  _variants[VV % 3]();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  g.traverse((n) => { const p = n.isMesh && n.geometry.attributes.position; if (!p) return; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld)); });
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((o) => { o.position.x -= c.x; o.position.y -= box.min.y; o.position.z -= c.z; });
  return g;
}
