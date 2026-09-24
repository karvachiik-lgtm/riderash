// RideRash roadside asset: shrub.
// Roadside scrub. v0: clump of faceted balls (attempt A). v1: grass/sage tuft of splayed blades (attempt C).
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
  const f1 = M(0x3f5530, 0.92, 0, 'foliage'), f2 = M(0x4c6238, 0.92, 0, 'foliage'), tw = M(0x4a3b2c, 0.95, 0, 'timber');
  for (let i = 0; i < 6; i++) { const a = i * 2.3, d = i ? 0.55 + R() * 0.3 : 0; const r = i ? 0.45 + R() * 0.25 : 0.7; const geo = rough(new THREE.IcosahedronGeometry(r, 0), 0.15); geo.scale(1, 0.8, 1); add(geo, i % 2 ? f1 : f2, Math.cos(a) * d, r * 0.75 + (i ? 0 : 0.2), Math.sin(a) * d); }
  for (let k = 0; k < 4; k++) add(C(0.02, 0.04, 0.7, 4), tw, (R() - 0.5) * 0.8, 0.3, (R() - 0.5) * 0.8, (R() - 0.5), 0, (R() - 0.5));
    },
    () => {
  const V = 0;
  const f1 = M(0x5a6a38, 0.92, 0, 'foliage'), f2 = M(0x6e7440, 0.92, 0, 'foliage');
  for (let i = 0; i < 22; i++) { const a = R() * 6.28, lean = 0.25 + R() * 0.55, L = 0.7 + R() * 0.7; const geo = new THREE.ConeGeometry(0.07, L, 3); geo.translate(0, L / 2, 0);
    const o = add(geo, i % 2 ? f1 : f2, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12); o.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean); }
  const base = rough(new THREE.IcosahedronGeometry(0.35, 0), 0.1); base.scale(1, 0.5, 1); add(base, f1, 0, 0.12, 0);
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
