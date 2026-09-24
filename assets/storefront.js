// RideRash roadside asset: storefront.
// Small-town shop. v0-2: two-storey brick block with awning (attempt A + side detail). v3: stucco mission-style shop with arcade (attempt C).
// Built to docs/asset-contract.md: metres, base at y = 0, centred on x/z, front +Z,
// primitives/extrusions/lathes only, flat colours named from the contract list.
// Chosen by eye from three independent attempts (see scenery.js header); the
// losing attempts that still read well are kept as `opts.variant` so the road is
// not lined with one silhouette. Variants: 4. Flat shading on purpose: the
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
  const W = 8, D = 10, H = 7.5, br = M([0x8a4a3a, 0x9a8a70, 0x6e6a62][V % 3], 0.9, 0, 'stone'), tr = M(0xd8d2c4, 0.8, 0, 'plaster'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), aw = M([0x2f6f8f, 0xc4442a, 0x41502e][V % 3], 0.8, 0, 'fabric'), rf = M(0x3a3a3e, 0.8, 0.2, 'tile');
  add(B(W, H, D), br, 0, H / 2, 0); add(B(W + 0.4, 0.4, 0.5), tr, 0, H + 0.1, D / 2 - 0.1); add(B(W + 0.2, 0.9, 0.2), br, 0, H + 0.45, D / 2); add(B(W, 0.1, D), rf, 0, H + 0.02, 0);
  add(B(W - 1.6, 2.4, 0.08), gl, -0.6, 1.8, D / 2 + 0.02); add(B(1.1, 2.4, 0.08), M(0x3a2a22, 0.8, 0, 'timber'), W / 2 - 1.0, 1.4, D / 2 + 0.02); add(B(W, 0.25, 0.15), tr, 0, 3.25, D / 2 + 0.05); add(B(W, 0.4, 0.1), tr, 0, 0.2, D / 2 + 0.05);
  const aw1 = add(B(W - 0.6, 0.08, 1.6), aw, 0, 3.6, D / 2 + 0.75); aw1.rotation.x = 0.35; add(B(W - 0.6, 0.35, 0.05), aw, 0, 3.3, D / 2 + 1.5);
  for (const x of [-2.6, 0, 2.6]) { add(B(1.1, 1.7, 0.06), gl, x, 5.3, D / 2 + 0.02); add(B(1.35, 0.14, 0.2), tr, x, 6.25, D / 2 + 0.06); add(B(1.3, 0.1, 0.2), tr, x, 4.4, D / 2 + 0.06); add(B(1.1, 0.06, 0.08), tr, x, 5.3, D / 2 + 0.05); }
  for (const z of [-3, 0, 3]) for (const s of [-1, 1]) add(B(0.06, 1.5, 1.0), gl, s * (W / 2 + 0.02), 5.3, z);
  for (const x of [-2, 2]) add(B(1.0, 1.4, 0.06), gl, x, 5.3, -D / 2 - 0.02); add(B(1.0, 2.1, 0.06), M(0x3a2a22, 0.8, 0, 'timber'), 0, 1.05, -D / 2 - 0.02); add(B(0.6, 1.0, 0.6), rf, 2, H + 0.5, -2);
  // brick courses and pilasters on every face: the sides of a block are seen
  // at an angle from the road, and a flat slab reads as cardboard there.
  for (const y of [3.4, 6.6]) { add(B(W + 0.08, 0.12, D + 0.08), tr, 0, y, 0); }
  for (const s of [-1, 1]) { add(B(0.3, H, 0.3), br, s * (W / 2 - 0.1), H / 2, D / 2 + 0.05); add(B(0.1, H, 0.1), M(0x5a5f63, 0.5, 0.6, 'metal'), s * (W / 2 + 0.05), H / 2, -D / 2 + 0.4); }
  for (const z of [-3, 0, 3]) for (const s of [-1, 1]) { add(B(0.1, 0.1, 1.2), tr, s * (W / 2 + 0.04), 6.1, z); add(B(0.1, 0.1, 1.2), tr, s * (W / 2 + 0.04), 4.5, z); }
    },
    () => {
  const V = 1;
  const W = 8, D = 10, H = 7.5, br = M([0x8a4a3a, 0x9a8a70, 0x6e6a62][V % 3], 0.9, 0, 'stone'), tr = M(0xd8d2c4, 0.8, 0, 'plaster'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), aw = M([0x2f6f8f, 0xc4442a, 0x41502e][V % 3], 0.8, 0, 'fabric'), rf = M(0x3a3a3e, 0.8, 0.2, 'tile');
  add(B(W, H, D), br, 0, H / 2, 0); add(B(W + 0.4, 0.4, 0.5), tr, 0, H + 0.1, D / 2 - 0.1); add(B(W + 0.2, 0.9, 0.2), br, 0, H + 0.45, D / 2); add(B(W, 0.1, D), rf, 0, H + 0.02, 0);
  add(B(W - 1.6, 2.4, 0.08), gl, -0.6, 1.8, D / 2 + 0.02); add(B(1.1, 2.4, 0.08), M(0x3a2a22, 0.8, 0, 'timber'), W / 2 - 1.0, 1.4, D / 2 + 0.02); add(B(W, 0.25, 0.15), tr, 0, 3.25, D / 2 + 0.05); add(B(W, 0.4, 0.1), tr, 0, 0.2, D / 2 + 0.05);
  const aw1 = add(B(W - 0.6, 0.08, 1.6), aw, 0, 3.6, D / 2 + 0.75); aw1.rotation.x = 0.35; add(B(W - 0.6, 0.35, 0.05), aw, 0, 3.3, D / 2 + 1.5);
  for (const x of [-2.6, 0, 2.6]) { add(B(1.1, 1.7, 0.06), gl, x, 5.3, D / 2 + 0.02); add(B(1.35, 0.14, 0.2), tr, x, 6.25, D / 2 + 0.06); add(B(1.3, 0.1, 0.2), tr, x, 4.4, D / 2 + 0.06); add(B(1.1, 0.06, 0.08), tr, x, 5.3, D / 2 + 0.05); }
  for (const z of [-3, 0, 3]) for (const s of [-1, 1]) add(B(0.06, 1.5, 1.0), gl, s * (W / 2 + 0.02), 5.3, z);
  for (const x of [-2, 2]) add(B(1.0, 1.4, 0.06), gl, x, 5.3, -D / 2 - 0.02); add(B(1.0, 2.1, 0.06), M(0x3a2a22, 0.8, 0, 'timber'), 0, 1.05, -D / 2 - 0.02); add(B(0.6, 1.0, 0.6), rf, 2, H + 0.5, -2);
  // brick courses and pilasters on every face: the sides of a block are seen
  // at an angle from the road, and a flat slab reads as cardboard there.
  for (const y of [3.4, 6.6]) { add(B(W + 0.08, 0.12, D + 0.08), tr, 0, y, 0); }
  for (const s of [-1, 1]) { add(B(0.3, H, 0.3), br, s * (W / 2 - 0.1), H / 2, D / 2 + 0.05); add(B(0.1, H, 0.1), M(0x5a5f63, 0.5, 0.6, 'metal'), s * (W / 2 + 0.05), H / 2, -D / 2 + 0.4); }
  for (const z of [-3, 0, 3]) for (const s of [-1, 1]) { add(B(0.1, 0.1, 1.2), tr, s * (W / 2 + 0.04), 6.1, z); add(B(0.1, 0.1, 1.2), tr, s * (W / 2 + 0.04), 4.5, z); }
    },
    () => {
  const V = 2;
  const W = 8, D = 10, H = 7.5, br = M([0x8a4a3a, 0x9a8a70, 0x6e6a62][V % 3], 0.9, 0, 'stone'), tr = M(0xd8d2c4, 0.8, 0, 'plaster'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), aw = M([0x2f6f8f, 0xc4442a, 0x41502e][V % 3], 0.8, 0, 'fabric'), rf = M(0x3a3a3e, 0.8, 0.2, 'tile');
  add(B(W, H, D), br, 0, H / 2, 0); add(B(W + 0.4, 0.4, 0.5), tr, 0, H + 0.1, D / 2 - 0.1); add(B(W + 0.2, 0.9, 0.2), br, 0, H + 0.45, D / 2); add(B(W, 0.1, D), rf, 0, H + 0.02, 0);
  add(B(W - 1.6, 2.4, 0.08), gl, -0.6, 1.8, D / 2 + 0.02); add(B(1.1, 2.4, 0.08), M(0x3a2a22, 0.8, 0, 'timber'), W / 2 - 1.0, 1.4, D / 2 + 0.02); add(B(W, 0.25, 0.15), tr, 0, 3.25, D / 2 + 0.05); add(B(W, 0.4, 0.1), tr, 0, 0.2, D / 2 + 0.05);
  const aw1 = add(B(W - 0.6, 0.08, 1.6), aw, 0, 3.6, D / 2 + 0.75); aw1.rotation.x = 0.35; add(B(W - 0.6, 0.35, 0.05), aw, 0, 3.3, D / 2 + 1.5);
  for (const x of [-2.6, 0, 2.6]) { add(B(1.1, 1.7, 0.06), gl, x, 5.3, D / 2 + 0.02); add(B(1.35, 0.14, 0.2), tr, x, 6.25, D / 2 + 0.06); add(B(1.3, 0.1, 0.2), tr, x, 4.4, D / 2 + 0.06); add(B(1.1, 0.06, 0.08), tr, x, 5.3, D / 2 + 0.05); }
  for (const z of [-3, 0, 3]) for (const s of [-1, 1]) add(B(0.06, 1.5, 1.0), gl, s * (W / 2 + 0.02), 5.3, z);
  for (const x of [-2, 2]) add(B(1.0, 1.4, 0.06), gl, x, 5.3, -D / 2 - 0.02); add(B(1.0, 2.1, 0.06), M(0x3a2a22, 0.8, 0, 'timber'), 0, 1.05, -D / 2 - 0.02); add(B(0.6, 1.0, 0.6), rf, 2, H + 0.5, -2);
  // brick courses and pilasters on every face: the sides of a block are seen
  // at an angle from the road, and a flat slab reads as cardboard there.
  for (const y of [3.4, 6.6]) { add(B(W + 0.08, 0.12, D + 0.08), tr, 0, y, 0); }
  for (const s of [-1, 1]) { add(B(0.3, H, 0.3), br, s * (W / 2 - 0.1), H / 2, D / 2 + 0.05); add(B(0.1, H, 0.1), M(0x5a5f63, 0.5, 0.6, 'metal'), s * (W / 2 + 0.05), H / 2, -D / 2 + 0.4); }
  for (const z of [-3, 0, 3]) for (const s of [-1, 1]) { add(B(0.1, 0.1, 1.2), tr, s * (W / 2 + 0.04), 6.1, z); add(B(0.1, 0.1, 1.2), tr, s * (W / 2 + 0.04), 4.5, z); }
    },
    () => {
  const V = 0;
  const W = 9, D = 10, H = 5, st = M(0xe0d4b8, 0.9, 0, 'plaster'), rf = M(0x9a5a3a, 0.85, 0.05, 'tile'), gl = M(0x2a333c, 0.2, 0.4, 'tile'), tr = M(0x6a4a3a, 0.85, 0, 'timber');
  add(B(W, H, D), st, 0, H / 2, 0);
  const p = new THREE.Shape(); p.moveTo(-W / 2, 0); p.lineTo(W / 2, 0); p.lineTo(W / 2, 0.8); p.quadraticCurveTo(W / 4, 0.8, W / 6, 2.0); p.lineTo(-W / 6, 2.0); p.quadraticCurveTo(-W / 4, 0.8, -W / 2, 0.8); p.lineTo(-W / 2, 0);
  add(new THREE.ExtrudeGeometry(p, { depth: 0.4, bevelEnabled: false }), st, 0, H, D / 2 - 0.4);
  for (const x of [-3, 0, 3]) { const a = new THREE.Shape(); a.moveTo(-1.1, 0); a.lineTo(1.1, 0); a.lineTo(1.1, 1.6); a.absarc(0, 1.6, 1.1, 0, Math.PI, false); a.lineTo(-1.1, 0); add(new THREE.ShapeGeometry(a, 6), gl, x, 0.3, D / 2 + 0.02); add(B(2.4, 0.2, 0.2), tr, x, 0.2, D / 2 + 0.1); }
  add(B(W + 0.6, 0.2, 1.4), rf, 0, 3.6, D / 2 + 0.6, 0.25, 0, 0); for (const x of [-4.5, -1.5, 1.5, 4.5]) add(B(0.2, 0.2, 1.2), tr, x, 3.4, D / 2 + 0.6);
  for (const z of [-3, 0, 3]) for (const s of [-1, 1]) add(B(0.06, 1.2, 0.9), gl, s * (W / 2 + 0.02), 2.5, z); for (const x of [-2.5, 2.5]) add(B(1.0, 1.2, 0.06), gl, x, 2.5, -D / 2 - 0.02);
  add(B(W, 0.4, D), rf, 0, H + 0.2, -0.3);
    },
  ];
  _variants[VV % 4]();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  g.traverse((n) => { const p = n.isMesh && n.geometry.attributes.position; if (!p) return; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld)); });
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((o) => { o.position.x -= c.x; o.position.y -= box.min.y; o.position.z -= c.z; });
  return g;
}
