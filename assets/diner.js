// RideRash roadside asset: diner.
// Streamline railcar diner, rooftop sign frame (attempt A). v = body finish.
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
  const L = 14, body = M([0xb8c0c4, 0xd8d2c4, 0x9ab0b4][V % 3], 0.35, 0.55, 'metal'), band = M(0xc4442a, 0.55, 0.1, 'plaster'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), rf = M(0x6a6e72, 0.6, 0.4, 'metal'), conc = M(0x6e6a62, 0.95, 0, 'stone'), sg = M(0x2f6f8f, 0.5, 0.1, 'plaster'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  const p = new THREE.Shape(); p.moveTo(-2.8, 0); p.lineTo(2.8, 0); p.lineTo(2.8, 2.8); p.quadraticCurveTo(2.8, 3.9, 0, 4.1); p.quadraticCurveTo(-2.8, 3.9, -2.8, 2.8); p.lineTo(-2.8, 0);
  const geo = new THREE.ExtrudeGeometry(p, { depth: L, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 3, curveSegments: 6 }); geo.rotateY(Math.PI / 2); geo.translate(-L / 2, 0, 0); add(geo, body, 0, 0.6, 0);
  add(B(L + 1.6, 0.6, 6.2), conc, 0, 0.3, 0);
  for (const zf of [1, -1]) { add(B(L - 1, 1.1, 0.08), gl, 0, 2.4, zf * 3.32); for (let x = -L / 2 + 1; x < L / 2 - 0.5; x += 1.3) add(B(0.1, 1.2, 0.12), body, x, 2.4, zf * 3.33); add(B(L + 0.6, 0.3, 0.06), band, 0, 1.5, zf * 3.33); add(B(L + 0.6, 0.08, 0.06), lt, 0, 1.2, zf * 3.33); add(B(L + 0.6, 0.08, 0.06), lt, 0, 3.15, zf * 3.33); }
  add(B(2.2, 3.2, 1.6), band, 0, 1.9, 3.9); add(B(1.2, 2.2, 0.08), gl, 0, 1.7, 4.72); add(B(2.6, 0.2, 2.0), rf, 0, 3.6, 3.9);
  add(B(0.15, 1.6, 0.15), rf, -3, 5.3, 0); add(B(0.15, 1.6, 0.15), rf, 3, 5.3, 0); add(B(7.4, 1.6, 0.3), sg, 0, 6.6, 0); add(B(7.6, 0.12, 0.34), lt, 0, 7.45, 0); add(B(7.6, 0.12, 0.34), lt, 0, 5.75, 0); for (const x of [-2.4, -0.8, 0.8, 2.4]) add(B(1.1, 0.8, 0.36), band, x, 6.6, 0);
  add(B(1.5, 1.2, 1.2), rf, 4, 4.9, -1);
    },
    () => {
  const V = 1;
  const L = 14, body = M([0xb8c0c4, 0xd8d2c4, 0x9ab0b4][V % 3], 0.35, 0.55, 'metal'), band = M(0xc4442a, 0.55, 0.1, 'plaster'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), rf = M(0x6a6e72, 0.6, 0.4, 'metal'), conc = M(0x6e6a62, 0.95, 0, 'stone'), sg = M(0x2f6f8f, 0.5, 0.1, 'plaster'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  const p = new THREE.Shape(); p.moveTo(-2.8, 0); p.lineTo(2.8, 0); p.lineTo(2.8, 2.8); p.quadraticCurveTo(2.8, 3.9, 0, 4.1); p.quadraticCurveTo(-2.8, 3.9, -2.8, 2.8); p.lineTo(-2.8, 0);
  const geo = new THREE.ExtrudeGeometry(p, { depth: L, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 3, curveSegments: 6 }); geo.rotateY(Math.PI / 2); geo.translate(-L / 2, 0, 0); add(geo, body, 0, 0.6, 0);
  add(B(L + 1.6, 0.6, 6.2), conc, 0, 0.3, 0);
  for (const zf of [1, -1]) { add(B(L - 1, 1.1, 0.08), gl, 0, 2.4, zf * 3.32); for (let x = -L / 2 + 1; x < L / 2 - 0.5; x += 1.3) add(B(0.1, 1.2, 0.12), body, x, 2.4, zf * 3.33); add(B(L + 0.6, 0.3, 0.06), band, 0, 1.5, zf * 3.33); add(B(L + 0.6, 0.08, 0.06), lt, 0, 1.2, zf * 3.33); add(B(L + 0.6, 0.08, 0.06), lt, 0, 3.15, zf * 3.33); }
  add(B(2.2, 3.2, 1.6), band, 0, 1.9, 3.9); add(B(1.2, 2.2, 0.08), gl, 0, 1.7, 4.72); add(B(2.6, 0.2, 2.0), rf, 0, 3.6, 3.9);
  add(B(0.15, 1.6, 0.15), rf, -3, 5.3, 0); add(B(0.15, 1.6, 0.15), rf, 3, 5.3, 0); add(B(7.4, 1.6, 0.3), sg, 0, 6.6, 0); add(B(7.6, 0.12, 0.34), lt, 0, 7.45, 0); add(B(7.6, 0.12, 0.34), lt, 0, 5.75, 0); for (const x of [-2.4, -0.8, 0.8, 2.4]) add(B(1.1, 0.8, 0.36), band, x, 6.6, 0);
  add(B(1.5, 1.2, 1.2), rf, 4, 4.9, -1);
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
