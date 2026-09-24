// RideRash roadside asset: road_sign.
// Roadside warning signs as SHAPE only, no glyphs. v0: curve-arrow diamond (A). v1: chevron board (B). v2: stop octagon (C). v3: speed-zone panel (C).
// Built to docs/asset-contract.md: metres, base at y = 0, centred on x/z, front +Z,
// primitives/extrusions/lathes only, flat colours named from the contract list.
// Chosen by eye from three independent attempts (see scenery.js header); the
// losing attempts that still read well are kept as `opts.variant` so the road is
// not lined with one silhouette. Variants: 5 (v4: v0 mirrored for left bends). Flat shading on purpose: the
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
  const post = M(0x8a9199, 0.45, 0.7, 'metal'), yel = M(0xd8a82a, 0.6, 0.05, 'plaster'), blk = M(0x1b1b1e, 0.7, 0, 'plaster'), back = M(0x7a8088, 0.5, 0.6, 'metal');
  add(B(0.08, 2.4, 0.08), post, 0, 1.2, -0.05);
  add(B(0.9, 0.9, 0.04), yel, 0, 2.3, 0, 0, 0, Math.PI / 4); add(B(0.94, 0.94, 0.02), back, 0, 2.3, -0.03, 0, 0, Math.PI / 4);
  const s = new THREE.Shape(); s.moveTo(-0.12, -0.32); s.lineTo(-0.12, 0.05); s.quadraticCurveTo(-0.12, 0.16, 0.0, 0.16); s.lineTo(0.08, 0.16); s.lineTo(0.08, 0.26); s.lineTo(0.26, 0.1); s.lineTo(0.08, -0.06); s.lineTo(0.08, 0.04); s.lineTo(0.0, 0.04); s.quadraticCurveTo(0.0, 0.04, 0.0, 0.03); s.lineTo(0.0, -0.32); s.lineTo(-0.12, -0.32);
  add(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }), blk, (V % 2 ? -1 : 1) * 0.0, 2.3, 0.02, 0, V % 2 ? Math.PI : 0, 0);
  add(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }), blk, 0, 2.3, -0.045, 0, Math.PI, 0);
  add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.45, -0.08); add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.05, -0.08); for (const y of [2.45, 2.05]) for (const x of [-0.03, 0.03]) add(C(0.02, 0.02, 0.06, 6), M(0x5a5f63, 0.5, 0.6, 'metal'), x, y, -0.12, Math.PI / 2, 0, 0);
    },
    () => {
  const V = 0;
  const post = M(0x8a9199, 0.45, 0.7, 'metal'), yel = M(0xd8a82a, 0.6, 0.05, 'plaster'), blk = M(0x1b1b1e, 0.7, 0, 'plaster');
  for (const x of [-0.5, 0.5]) add(B(0.07, 1.6, 0.07), post, x, 0.8, -0.05);
  add(B(1.3, 0.75, 0.04), yel, 0, 1.55, 0); add(B(1.34, 0.79, 0.03), blk, 0, 1.55, -0.03);
  const ch = new THREE.Shape(); ch.moveTo(-0.1, 0.28); ch.lineTo(0.08, 0); ch.lineTo(-0.1, -0.28); ch.lineTo(0.04, -0.28); ch.lineTo(0.22, 0); ch.lineTo(0.04, 0.28);
  for (const x of [-0.42, -0.1, 0.22]) add(new THREE.ExtrudeGeometry(ch, { depth: 0.01, bevelEnabled: false }), blk, x, 1.55, 0.02);
    },
    () => {
  const V = 1;
  const post = M(0x8a9199, 0.45, 0.7, 'metal'), wh = M(0xd8d2c4, 0.6, 0.02, 'plaster'), rd = M(0xb8382a, 0.6, 0.05, 'plaster'), back = M(0x7a8088, 0.5, 0.6, 'metal'), blk = M(0x2a2a2e, 0.7, 0, 'plaster');
  add(C(0.04, 0.04, 2.3, 8), post, 0, 1.15, -0.05);
  if (V % 2) { add(C(0.42, 0.42, 0.04, 8), rd, 0, 2.2, 0, Math.PI / 2, 0, Math.PI / 8); add(new THREE.TorusGeometry(0.36, 0.025, 4, 8), wh, 0, 2.2, 0.025, 0, 0, Math.PI / 8); add(B(0.5, 0.1, 0.01), wh, 0, 2.2, 0.025); add(C(0.43, 0.43, 0.02, 8), back, 0, 2.2, -0.03, Math.PI / 2, 0, Math.PI / 8); }
  else { add(B(0.62, 0.8, 0.04), wh, 0, 2.15, 0); add(B(0.66, 0.84, 0.02), back, 0, 2.15, -0.03); add(new THREE.TorusGeometry(0.2, 0.035, 5, 16), rd, 0, 2.28, 0.025); add(B(0.4, 0.06, 0.01), blk, 0, 1.92, 0.025); add(B(0.3, 0.06, 0.01), blk, 0, 1.82, 0.025); }
  add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.45, -0.08); add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.05, -0.08); for (const y of [2.45, 2.05]) for (const x of [-0.03, 0.03]) add(C(0.02, 0.02, 0.06, 6), M(0x5a5f63, 0.5, 0.6, 'metal'), x, y, -0.12, Math.PI / 2, 0, 0);
    },
    () => {
  const V = 0;
  const post = M(0x8a9199, 0.45, 0.7, 'metal'), wh = M(0xd8d2c4, 0.6, 0.02, 'plaster'), rd = M(0xb8382a, 0.6, 0.05, 'plaster'), back = M(0x7a8088, 0.5, 0.6, 'metal'), blk = M(0x2a2a2e, 0.7, 0, 'plaster');
  add(C(0.04, 0.04, 2.3, 8), post, 0, 1.15, -0.05);
  if (V % 2) { add(C(0.42, 0.42, 0.04, 8), rd, 0, 2.2, 0, Math.PI / 2, 0, Math.PI / 8); add(new THREE.TorusGeometry(0.36, 0.025, 4, 8), wh, 0, 2.2, 0.025, 0, 0, Math.PI / 8); add(B(0.5, 0.1, 0.01), wh, 0, 2.2, 0.025); add(C(0.43, 0.43, 0.02, 8), back, 0, 2.2, -0.03, Math.PI / 2, 0, Math.PI / 8); }
  else { add(B(0.62, 0.8, 0.04), wh, 0, 2.15, 0); add(B(0.66, 0.84, 0.02), back, 0, 2.15, -0.03); add(new THREE.TorusGeometry(0.2, 0.035, 5, 16), rd, 0, 2.28, 0.025); add(B(0.4, 0.06, 0.01), blk, 0, 1.92, 0.025); add(B(0.3, 0.06, 0.01), blk, 0, 1.82, 0.025); }
  add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.45, -0.08); add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.05, -0.08); for (const y of [2.45, 2.05]) for (const x of [-0.03, 0.03]) add(C(0.02, 0.02, 0.06, 6), M(0x5a5f63, 0.5, 0.6, 'metal'), x, y, -0.12, Math.PI / 2, 0, 0);
    },
    () => {
  const V = 0;
  // v4: the same sign for a LEFT-hand bend. The arrow is mirrored in X; a
  // mirrored extrusion is inside-out, so that one material goes double-sided.
  const post = M(0x8a9199, 0.45, 0.7, 'metal'), yel = M(0xd8a82a, 0.6, 0.05, 'plaster'), blk = M(0x1b1b1e, 0.7, 0, 'plaster', true), back = M(0x7a8088, 0.5, 0.6, 'metal');
  add(B(0.08, 2.4, 0.08), post, 0, 1.2, -0.05);
  add(B(0.9, 0.9, 0.04), yel, 0, 2.3, 0, 0, 0, Math.PI / 4); add(B(0.94, 0.94, 0.02), back, 0, 2.3, -0.03, 0, 0, Math.PI / 4);
  const s = new THREE.Shape(); s.moveTo(-0.12, -0.32); s.lineTo(-0.12, 0.05); s.quadraticCurveTo(-0.12, 0.16, 0.0, 0.16); s.lineTo(0.08, 0.16); s.lineTo(0.08, 0.26); s.lineTo(0.26, 0.1); s.lineTo(0.08, -0.06); s.lineTo(0.08, 0.04); s.lineTo(0.0, 0.04); s.quadraticCurveTo(0.0, 0.04, 0.0, 0.03); s.lineTo(0.0, -0.32); s.lineTo(-0.12, -0.32);
  add(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }).scale(-1, 1, 1), blk, (V % 2 ? -1 : 1) * 0.0, 2.3, 0.02, 0, V % 2 ? Math.PI : 0, 0);
  add(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }).scale(-1, 1, 1), blk, 0, 2.3, -0.045, 0, Math.PI, 0);
  add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.45, -0.08); add(B(0.9, 0.06, 0.05), M(0x5a5f63, 0.5, 0.6, 'metal'), 0, 2.05, -0.08); for (const y of [2.45, 2.05]) for (const x of [-0.03, 0.03]) add(C(0.02, 0.02, 0.06, 6), M(0x5a5f63, 0.5, 0.6, 'metal'), x, y, -0.12, Math.PI / 2, 0, 0);
    },
  ];
  _variants[VV % 5]();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  g.traverse((n) => { const p = n.isMesh && n.geometry.attributes.position; if (!p) return; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld)); });
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((o) => { o.position.x -= c.x; o.position.y -= box.min.y; o.position.z -= c.z; });
  return g;
}
