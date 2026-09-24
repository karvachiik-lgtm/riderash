// RideRash roadside asset: rock.
// Boulder. v0: granite pile of three stones (attempt B, detail raised). v1: single displaced boulder (attempt A).
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
  const st = M(0x8a8278, 0.95, 0, 'stone'), dk = M(0x6a655e, 0.95, 0, 'stone');
  const parts = [[0, 0.7, 0, 1.0, 1.3, 0.8, 1.1], [0.95, 0.45, 0.35, 0.7, 1, 0.7, 0.9], [-0.8, 0.35, -0.3, 0.6, 1.2, 0.6, 0.8]];
  parts.forEach(([x, y, z, r, sx, sy, sz], i) => { const geo = rough(new THREE.DodecahedronGeometry(r, 1), 0.3 * r); geo.scale(sx, sy, sz); add(geo, i === 2 ? dk : st, x, y, z, R() * 0.4, R() * 6, R() * 0.4); });
    },
    () => {
  const V = 0;
  const st = M(0x857d72, 0.95, 0, 'stone');
  const geo = new THREE.IcosahedronGeometry(1.2, 1); const p = geo.attributes.position; const k = new Map();
  for (let i = 0; i < p.count; i++) { const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`; if (!k.has(key)) k.set(key, 0.75 + R() * 0.45); const s = k.get(key); let y = p.getY(i) * s * 0.7; if (y < -0.25) y = -0.25; p.setXYZ(i, p.getX(i) * s * 1.2, y, p.getZ(i) * s); }
  geo.computeVertexNormals(); add(geo, st, 0, 0.25, 0);
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
