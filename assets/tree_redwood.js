// RideRash roadside asset: tree_redwood.
// Coast redwood. v0: lathe trunk with buttress flare and sawtooth spire (attempt B). v1: fluted trunk with clump canopy (attempt A).
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
  const H = 30;
  const bark = M(0x5a3426, 0.96, 0, 'timber'), f = M(0x2a4526, 0.92, 0, 'foliage');
  const tp = [[0, 0], [1.9, 0], [1.2, 0.8], [0.95, 3], [0.7, H * 0.5], [0.3, H]].map(([x, y]) => new THREE.Vector2(x, y));
  const tg = new THREE.LatheGeometry(tp, 10); rough(tg, 0.15); add(tg, bark);
  const pts = [[0, H * 0.42]]; for (let i = 0; i < 9; i++) { const t = i / 9; const y = H * (0.42 + 0.58 * t); const r = 3.6 * (1 - t) + 0.6; pts.push([r, y], [r * 0.55, y + H * 0.05]); } pts.push([0, H * 1.05]);
  const fg = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 9); rough(fg, 0.5); add(fg, f).material.side = THREE.DoubleSide;
    },
    () => {
  const V = 0;
  const H = 30;
  const bark = M(0x5a3426, 0.96, 0, 'timber'), f1 = M(0x243d22, 0.92, 0, 'foliage'), f2 = M(0x2f4c2a, 0.92, 0, 'foliage');
  add(rough(C(0.35, 1.25, H, 9, 1), 0.12), bark, 0, H / 2, 0);
  for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; add(new THREE.ConeGeometry(0.5, 2.4, 4), bark, Math.cos(a) * 1.0, 1.0, Math.sin(a) * 1.0, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); }
  for (let i = 0; i < 16; i++) { const t = i / 15; const y = H * (0.45 + 0.52 * t); const r = (1 - t) * 3.2 + 1.0; const a = i * 2.4; const d = r * 0.55; const geo = rough(new THREE.IcosahedronGeometry(r * 0.75, 0), 0.3); geo.scale(1, 0.7, 1); add(geo, i % 2 ? f1 : f2, Math.cos(a) * d, y, Math.sin(a) * d, 0, R() * 6, 0); }
  add(new THREE.ConeGeometry(0.9, 3.5, 6), f2, 0, H + 0.8, 0);
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
