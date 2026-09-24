// RideRash roadside asset: mailbox.
// Rural mailbox. v0: arch box on a post (A). v1: two boxes on a cross-arm (C).
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
  const wd = M(0x6a543e, 0.93, 0, 'timber'), bx = M(0x8a9199, 0.45, 0.6, 'metal'), fl = M(0xc4442a, 0.6, 0.1, 'plaster');
  add(rough(B(0.11, 1.1, 0.11), 0.01), wd, 0, 0.55, 0); add(B(0.3, 0.05, 0.55), wd, 0, 1.12, 0);
  const s = new THREE.Shape(); s.moveTo(-0.12, 0); s.lineTo(0.12, 0); s.lineTo(0.12, 0.13); s.absarc(0, 0.13, 0.12, 0, Math.PI, false); s.lineTo(-0.12, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: 6 }); geo.translate(0, 0, -0.25); add(geo, bx, 0, 1.15, 0);
  add(B(0.02, 0.22, 0.03), fl, 0.14, 1.35, -0.1); add(B(0.02, 0.07, 0.1), fl, 0.14, 1.44, -0.05);
    },
    () => {
  const V = 0;
  const wd = M(0x6a543e, 0.93, 0, 'timber'), bx = M(0x8a9199, 0.45, 0.6, 'metal'), b2 = M(0x2f4a3a, 0.5, 0.3, 'metal'), fl = M(0xc4442a, 0.6, 0.1, 'plaster');
  add(B(0.12, 1.1, 0.12), wd, 0, 0.55, 0); add(B(0.9, 0.08, 0.3), wd, 0, 1.1, 0); add(B(0.05, 0.4, 0.05), wd, 0.25, 0.9, 0, 0, 0, 0.7); add(B(0.05, 0.4, 0.05), wd, -0.25, 0.9, 0, 0, 0, -0.7);
  for (const [x, m] of [[-0.25, bx], [0.25, b2]]) { add(B(0.24, 0.16, 0.45), m, x, 1.22, 0); add(C(0.12, 0.12, 0.45, 8, 1), m, x, 1.3, 0, Math.PI / 2, 0, 0); add(B(0.02, 0.18, 0.03), fl, x + 0.13, 1.35, -0.1); }
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
