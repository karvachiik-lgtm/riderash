// RideRash roadside asset: tree_palm.
// Palm. v0: curved Canary/date palm, tube trunk and extruded fronds (attempt B). v1: straight fan palm with dead-frond skirt (attempt C).
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
  const H = 12;
  const bark = M(0x5e5242, 0.95, 0, 'timber'), fr = M(0x4b6b2e, 0.9, 0, 'foliage', true), dead = M(0x8a6e44, 0.95, 0, 'foliage', true);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, H * 0.35, 0), new THREE.Vector3(0.7, H * 0.7, 0.1), new THREE.Vector3(1.2, H, 0.2)]);
  const tube = new THREE.TubeGeometry(curve, 16, 0.3, 7, false); const p = tube.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const s = 1 + 0.08 * Math.sin(y * 9); const c = curve.getPoint(Math.max(0, Math.min(1, y / H))); p.setX(i, c.x + (p.getX(i) - c.x) * s); p.setZ(i, c.z + (p.getZ(i) - c.z) * s); } tube.computeVertexNormals(); add(tube, bark);
  const top = curve.getPoint(1);
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.55, 1.6, 0.05, 4.0); sh.quadraticCurveTo(-0.55, 1.6, 0, 0);
  for (let k = 0; k < 13; k++) { const a = k / 13 * 6.28; const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 3 });
    const pp = geo.attributes.position; for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); pp.setZ(i, pp.getZ(i) - 0.09 * y * y + Math.abs(pp.getX(i)) * 0.4); } geo.computeVertexNormals(); geo.rotateX(-Math.PI / 2 + 0.35);
    add(geo, fr, top.x, top.y, top.z, 0, a, 0); }
  for (let k = 0; k < 9; k++) { const a = k / 9 * 6.28; const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 2 }); geo.scale(0.7, 0.6, 1); geo.rotateX(Math.PI - 0.25); add(geo, dead, top.x, top.y - 0.2, top.z, 0, a, 0); }
    },
    () => {
  const V = 0;
  const H = 13;
  const bark = M(0x6e5a42, 0.95, 0, 'timber'), fr = M(0x55733a, 0.9, 0, 'foliage'), dead = M(0x8e7048, 0.95, 0, 'foliage');
  add(rough(C(0.3, 0.42, H, 8), 0.04), bark, 0, H / 2, 0);
  const sk = rough(new THREE.CylinderGeometry(0.75, 0.5, 3.2, 9), 0.2); add(sk, dead, 0, H - 1.3, 0);
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28; const el = (k % 2 ? 0.2 : -0.25) + R() * 0.2; const geo = new THREE.ConeGeometry(1.1, 3.4, 4); geo.scale(1, 1, 0.12); geo.rotateZ(-Math.PI / 2); geo.translate(1.8, 0, 0); add(geo, fr, 0, H + 0.2, 0, 0, a, el); }
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
