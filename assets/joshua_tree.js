// RideRash roadside asset: joshua_tree.
// Joshua tree / tree yucca: recursive forked limbs with spiky tips (cactus attempt C).
// Built to docs/asset-contract.md: metres, base at y = 0, centred on x/z, front +Z,
// primitives/extrusions/lathes only, flat colours named from the contract list.
// Chosen by eye from three independent attempts (see scenery.js header); the
// losing attempts that still read well are kept as `opts.variant` so the road is
// not lined with one silhouette. Variants: 1. Flat shading on purpose: the
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
  const bark = M(0x6a5a44, 0.96, 0, 'timber'), sp = M(0x5e6e3a, 0.88, 0, 'foliage');
  const limb = (x0, y0, z0, dx, dy, dz, L, r, depth) => { const dir = new THREE.Vector3(dx, dy, dz).normalize(); const geo = C(r * 0.8, r, L, 6); geo.translate(0, L / 2, 0); rough(geo, 0.05); const o = new THREE.Mesh(geo, bark); o.position.set(x0, y0, z0); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(o);
    const ex = x0 + dir.x * L, ey = y0 + dir.y * L, ez = z0 + dir.z * L;
    if (depth === 0) { for (let k = 0; k < 2; k++) { const s = new THREE.ConeGeometry(0.55, 1.3, 7); rough(s, 0.1); add(s, sp, ex, ey + 0.5, ez, k * 3.1, R() * 6, 0); } return; }
    for (let k = 0; k < 2; k++) { const a = R() * 6.28; limb(ex, ey, ez, dir.x + Math.cos(a) * 0.9, 1, dir.z + Math.sin(a) * 0.9, L * 0.75, r * 0.72, depth - 1); } };
  limb(0, 0, 0, 0, 1, 0, 2.6, 0.32, 2);
    },
  ];
  _variants[VV % 1]();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  g.traverse((n) => { const p = n.isMesh && n.geometry.attributes.position; if (!p) return; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld)); });
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((o) => { o.position.x -= c.x; o.position.y -= box.min.y; o.position.z -= c.z; });
  return g;
}
