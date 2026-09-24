// RideRash roadside asset: horse.
// Horse (cow attempt C, re-read as a horse). v = coat.
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
  const hide = M([0x6a4030, 0x3a2a22, 0xa89880][V % 3], 0.85, 0, 'fabric'), dk = M(0x1b1b1e, 0.8, 0, 'fabric');
  const body = new THREE.BoxGeometry(0.55, 0.65, 1.6, 2, 2, 3); rough(body, 0.05); add(body, hide, 0, 1.35, 0);
  add(B(0.3, 0.9, 0.35), hide, 0, 1.85, 0.85, 0.55, 0, 0); add(B(0.25, 0.26, 0.6), hide, 0, 2.2, 1.25, 0.35, 0, 0); add(B(0.05, 0.7, 0.18), dk, 0, 1.95, 0.7, 0.55, 0, 0);
  for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.05, 0.16, 4), hide, s * 0.08, 2.4, 1.1);
  for (const x of [-0.18, 0.18]) for (const z of [-0.6, 0.6]) { add(B(0.12, 1.05, 0.14), hide, x, 0.55, z); add(B(0.13, 0.1, 0.15), dk, x, 0.05, z); }
  add(B(0.12, 0.8, 0.12), dk, 0, 1.1, -0.9, 0.35, 0, 0);
    },
    () => {
  const V = 1;
  const hide = M([0x6a4030, 0x3a2a22, 0xa89880][V % 3], 0.85, 0, 'fabric'), dk = M(0x1b1b1e, 0.8, 0, 'fabric');
  const body = new THREE.BoxGeometry(0.55, 0.65, 1.6, 2, 2, 3); rough(body, 0.05); add(body, hide, 0, 1.35, 0);
  add(B(0.3, 0.9, 0.35), hide, 0, 1.85, 0.85, 0.55, 0, 0); add(B(0.25, 0.26, 0.6), hide, 0, 2.2, 1.25, 0.35, 0, 0); add(B(0.05, 0.7, 0.18), dk, 0, 1.95, 0.7, 0.55, 0, 0);
  for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.05, 0.16, 4), hide, s * 0.08, 2.4, 1.1);
  for (const x of [-0.18, 0.18]) for (const z of [-0.6, 0.6]) { add(B(0.12, 1.05, 0.14), hide, x, 0.55, z); add(B(0.13, 0.1, 0.15), dk, x, 0.05, z); }
  add(B(0.12, 0.8, 0.12), dk, 0, 1.1, -0.9, 0.35, 0, 0);
    },
    () => {
  const V = 2;
  const hide = M([0x6a4030, 0x3a2a22, 0xa89880][V % 3], 0.85, 0, 'fabric'), dk = M(0x1b1b1e, 0.8, 0, 'fabric');
  const body = new THREE.BoxGeometry(0.55, 0.65, 1.6, 2, 2, 3); rough(body, 0.05); add(body, hide, 0, 1.35, 0);
  add(B(0.3, 0.9, 0.35), hide, 0, 1.85, 0.85, 0.55, 0, 0); add(B(0.25, 0.26, 0.6), hide, 0, 2.2, 1.25, 0.35, 0, 0); add(B(0.05, 0.7, 0.18), dk, 0, 1.95, 0.7, 0.55, 0, 0);
  for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.05, 0.16, 4), hide, s * 0.08, 2.4, 1.1);
  for (const x of [-0.18, 0.18]) for (const z of [-0.6, 0.6]) { add(B(0.12, 1.05, 0.14), hide, x, 0.55, z); add(B(0.13, 0.1, 0.15), dk, x, 0.05, z); }
  add(B(0.12, 0.8, 0.12), dk, 0, 1.1, -0.9, 0.35, 0, 0);
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
