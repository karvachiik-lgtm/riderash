// RideRash roadside asset: gas_station.
// 1970s gas station: flat canopy, pump islands, shop, pylon (attempt A). v = band colour.
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
  const cn = M(0xd8d2c4, 0.7, 0.05, 'plaster'), band = M([0xc4442a, 0x2f6f8f, 0xb8912e][V % 3], 0.6, 0.05, 'plaster'), col = M(0x8a9199, 0.45, 0.6, 'metal'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), wall = M(0xc8bca4, 0.85, 0, 'plaster'), conc = M(0x6e6a62, 0.95, 0, 'stone'), dk = M(0x1b1b1e, 0.7, 0.1, 'metal'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  add(B(16, 0.15, 12), conc, 0, 0.075, 2);
  add(B(12, 0.7, 7), cn, 0, 5.2, 4); add(B(12.1, 0.45, 7.1), band, 0, 5.05, 4); for (const x of [-4.8, 4.8]) for (const z of [2, 6]) add(B(0.4, 4.9, 0.4), col, x, 2.5, z);
  for (let x = -5; x <= 5; x += 2.5) add(B(0.8, 0.05, 0.8), lt, x, 4.83, 4);
  for (const x of [-2.4, 2.4]) { add(B(1.2, 0.25, 4.4), conc, x, 0.27, 4); for (const z of [2.8, 5.2]) { add(B(0.8, 1.6, 0.55), band, x, 1.2, z); add(B(0.82, 0.35, 0.57), lt, x, 2.15, z); add(B(0.5, 0.35, 0.02), gl, x, 1.45, z + 0.29); add(B(0.5, 0.35, 0.02), gl, x, 1.45, z - 0.29); add(C(0.03, 0.03, 0.9, 5), dk, x + 0.45, 1.2, z, 0.3, 0, 0); } }
  add(B(10, 3.6, 5), wall, 0, 1.95, -3.5); add(B(10.3, 0.4, 5.3), band, 0, 3.95, -3.5); add(B(6, 2.0, 0.08), gl, -1.2, 1.6, -0.98); for (let x = -4.2; x <= 1.8; x += 1.5) add(B(0.1, 2.1, 0.12), col, x, 1.6, -0.95); add(B(1.1, 2.3, 0.08), gl, 3.3, 1.3, -0.98); add(B(1.3, 0.12, 0.14), col, 3.3, 2.5, -0.95);
  add(B(1.2, 0.6, 0.8), col, -3, 4.4, -4.5); add(B(0.1, 1.5, 1.2), gl, 5.05, 2.0, -3.5);
  add(B(0.3, 7, 0.3), col, 7, 3.5, 6.5); add(B(2.2, 2.6, 0.4), band, 7, 7.5, 6.5); add(B(1.9, 0.5, 0.42), lt, 7, 7.9, 6.5); add(B(1.9, 0.5, 0.42), dk, 7, 7.1, 6.5); add(new THREE.CylinderGeometry(0.8, 0.8, 0.44, 14), lt, 7, 9.3, 6.5, Math.PI / 2, 0, 0);
    },
    () => {
  const V = 1;
  const cn = M(0xd8d2c4, 0.7, 0.05, 'plaster'), band = M([0xc4442a, 0x2f6f8f, 0xb8912e][V % 3], 0.6, 0.05, 'plaster'), col = M(0x8a9199, 0.45, 0.6, 'metal'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), wall = M(0xc8bca4, 0.85, 0, 'plaster'), conc = M(0x6e6a62, 0.95, 0, 'stone'), dk = M(0x1b1b1e, 0.7, 0.1, 'metal'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  add(B(16, 0.15, 12), conc, 0, 0.075, 2);
  add(B(12, 0.7, 7), cn, 0, 5.2, 4); add(B(12.1, 0.45, 7.1), band, 0, 5.05, 4); for (const x of [-4.8, 4.8]) for (const z of [2, 6]) add(B(0.4, 4.9, 0.4), col, x, 2.5, z);
  for (let x = -5; x <= 5; x += 2.5) add(B(0.8, 0.05, 0.8), lt, x, 4.83, 4);
  for (const x of [-2.4, 2.4]) { add(B(1.2, 0.25, 4.4), conc, x, 0.27, 4); for (const z of [2.8, 5.2]) { add(B(0.8, 1.6, 0.55), band, x, 1.2, z); add(B(0.82, 0.35, 0.57), lt, x, 2.15, z); add(B(0.5, 0.35, 0.02), gl, x, 1.45, z + 0.29); add(B(0.5, 0.35, 0.02), gl, x, 1.45, z - 0.29); add(C(0.03, 0.03, 0.9, 5), dk, x + 0.45, 1.2, z, 0.3, 0, 0); } }
  add(B(10, 3.6, 5), wall, 0, 1.95, -3.5); add(B(10.3, 0.4, 5.3), band, 0, 3.95, -3.5); add(B(6, 2.0, 0.08), gl, -1.2, 1.6, -0.98); for (let x = -4.2; x <= 1.8; x += 1.5) add(B(0.1, 2.1, 0.12), col, x, 1.6, -0.95); add(B(1.1, 2.3, 0.08), gl, 3.3, 1.3, -0.98); add(B(1.3, 0.12, 0.14), col, 3.3, 2.5, -0.95);
  add(B(1.2, 0.6, 0.8), col, -3, 4.4, -4.5); add(B(0.1, 1.5, 1.2), gl, 5.05, 2.0, -3.5);
  add(B(0.3, 7, 0.3), col, 7, 3.5, 6.5); add(B(2.2, 2.6, 0.4), band, 7, 7.5, 6.5); add(B(1.9, 0.5, 0.42), lt, 7, 7.9, 6.5); add(B(1.9, 0.5, 0.42), dk, 7, 7.1, 6.5); add(new THREE.CylinderGeometry(0.8, 0.8, 0.44, 14), lt, 7, 9.3, 6.5, Math.PI / 2, 0, 0);
    },
    () => {
  const V = 2;
  const cn = M(0xd8d2c4, 0.7, 0.05, 'plaster'), band = M([0xc4442a, 0x2f6f8f, 0xb8912e][V % 3], 0.6, 0.05, 'plaster'), col = M(0x8a9199, 0.45, 0.6, 'metal'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), wall = M(0xc8bca4, 0.85, 0, 'plaster'), conc = M(0x6e6a62, 0.95, 0, 'stone'), dk = M(0x1b1b1e, 0.7, 0.1, 'metal'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  add(B(16, 0.15, 12), conc, 0, 0.075, 2);
  add(B(12, 0.7, 7), cn, 0, 5.2, 4); add(B(12.1, 0.45, 7.1), band, 0, 5.05, 4); for (const x of [-4.8, 4.8]) for (const z of [2, 6]) add(B(0.4, 4.9, 0.4), col, x, 2.5, z);
  for (let x = -5; x <= 5; x += 2.5) add(B(0.8, 0.05, 0.8), lt, x, 4.83, 4);
  for (const x of [-2.4, 2.4]) { add(B(1.2, 0.25, 4.4), conc, x, 0.27, 4); for (const z of [2.8, 5.2]) { add(B(0.8, 1.6, 0.55), band, x, 1.2, z); add(B(0.82, 0.35, 0.57), lt, x, 2.15, z); add(B(0.5, 0.35, 0.02), gl, x, 1.45, z + 0.29); add(B(0.5, 0.35, 0.02), gl, x, 1.45, z - 0.29); add(C(0.03, 0.03, 0.9, 5), dk, x + 0.45, 1.2, z, 0.3, 0, 0); } }
  add(B(10, 3.6, 5), wall, 0, 1.95, -3.5); add(B(10.3, 0.4, 5.3), band, 0, 3.95, -3.5); add(B(6, 2.0, 0.08), gl, -1.2, 1.6, -0.98); for (let x = -4.2; x <= 1.8; x += 1.5) add(B(0.1, 2.1, 0.12), col, x, 1.6, -0.95); add(B(1.1, 2.3, 0.08), gl, 3.3, 1.3, -0.98); add(B(1.3, 0.12, 0.14), col, 3.3, 2.5, -0.95);
  add(B(1.2, 0.6, 0.8), col, -3, 4.4, -4.5); add(B(0.1, 1.5, 1.2), gl, 5.05, 2.0, -3.5);
  add(B(0.3, 7, 0.3), col, 7, 3.5, 6.5); add(B(2.2, 2.6, 0.4), band, 7, 7.5, 6.5); add(B(1.9, 0.5, 0.42), lt, 7, 7.9, 6.5); add(B(1.9, 0.5, 0.42), dk, 7, 7.1, 6.5); add(new THREE.CylinderGeometry(0.8, 0.8, 0.44, 14), lt, 7, 9.3, 6.5, Math.PI / 2, 0, 0);
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
