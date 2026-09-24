// RideRash roadside asset: farmhouse.
// v0: two-storey clapboard farmhouse with porch (attempt A). v1: single-storey ranch house with carport (attempt B). v2: A in sage.
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
  const W = 9, D = 7, H = 6, wall = M([0xd8d2c4, 0xc8c0a8, 0xb8c0b4][V % 3], 0.85, 0, 'plaster'), trim = M(0xeae6dc, 0.75, 0, 'plaster'), rf = M(0x4a3f3a, 0.85, 0.05, 'tile'), gl = M(0x2a333c, 0.25, 0.3, 'tile'), br = M(0x7a4a3a, 0.9, 0, 'stone'), dr = M(0x6a3a2a, 0.8, 0, 'timber'), st = M(0x6e6a62, 0.95, 0, 'stone');
  add(B(W + 0.2, 0.5, D + 0.2), st, 0, 0.25, 0); add(B(W, H, D), wall, 0, 0.5 + H / 2, 0);
  for (let y = 0.8; y < H + 0.4; y += 0.32) { add(B(W + 0.04, 0.05, 0.03), trim, 0, y, D / 2 + 0.01); add(B(W + 0.04, 0.05, 0.03), trim, 0, y, -D / 2 - 0.01); add(B(0.03, 0.05, D), trim, W / 2 + 0.01, y, 0); add(B(0.03, 0.05, D), trim, -W / 2 - 0.01, y, 0); }
  const gab = new THREE.Shape(); gab.moveTo(-D / 2, 0); gab.lineTo(D / 2, 0); gab.lineTo(0, 3); gab.lineTo(-D / 2, 0); const gg = new THREE.ExtrudeGeometry(gab, { depth: W, bevelEnabled: false }); gg.translate(0, 0, -W / 2); gg.rotateY(Math.PI / 2); add(gg, wall, 0, H + 0.5, 0);
  const L = Math.hypot(D / 2, 3) + 0.6; for (const sz of [-1, 1]) { const o = add(B(W + 0.8, 0.16, L), rf, 0, H + 0.5 + 1.55, sz * D / 4); o.rotation.x = sz * Math.atan2(3, D / 2); }
  add(B(0.8, 2.2, 0.8), br, W / 2 - 1.2, H + 2.6, -0.8);
  const win = (x, y, z, ry) => { const gp = new THREE.Group(); gp.position.set(x, y, z); gp.rotation.y = ry; g.add(gp); add(B(1.0, 1.4, 0.06), gl, 0, 0, 0, 0, 0, 0, gp); add(B(1.2, 0.1, 0.12), trim, 0, 0.75, 0.03, 0, 0, 0, gp); add(B(1.25, 0.1, 0.16), trim, 0, -0.75, 0.05, 0, 0, 0, gp); add(B(0.1, 1.5, 0.1), trim, -0.55, 0, 0.03, 0, 0, 0, gp); add(B(0.1, 1.5, 0.1), trim, 0.55, 0, 0.03, 0, 0, 0, gp); add(B(0.05, 1.4, 0.08), trim, 0, 0, 0.03, 0, 0, 0, gp); add(B(0.35, 1.45, 0.05), dr, -0.8, 0, 0.02, 0, 0, 0, gp); add(B(0.35, 1.45, 0.05), dr, 0.8, 0, 0.02, 0, 0, 0, gp); };
  for (const x of [-2.8, 2.8]) { win(x, 2.2, D / 2 + 0.05, 0); win(x, 4.9, D / 2 + 0.05, 0); win(x, 3.5, -D / 2 - 0.05, Math.PI); }
  win(0, 4.9, D / 2 + 0.05, 0); for (const z of [-1.5, 1.5]) { win(W / 2 + 0.05, 3.5, z, Math.PI / 2); win(-W / 2 - 0.05, 3.5, z, -Math.PI / 2); }
  add(B(1.1, 2.2, 0.1), dr, 0, 1.6, D / 2 + 0.05);
  // porch
  add(B(W, 0.25, 2.4), M(0x6b5a48, 0.9, 0, 'timber'), 0, 0.62, D / 2 + 1.2); for (const x of [-4.2, -1.4, 1.4, 4.2]) add(B(0.18, 2.6, 0.18), trim, x, 2.0, D / 2 + 2.25);
  const pr = add(B(W + 0.4, 0.14, 2.8), rf, 0, 3.45, D / 2 + 1.25); pr.rotation.x = 0.18; add(B(W, 0.1, 0.08), trim, 0, 1.4, D / 2 + 2.3); for (let x = -4.2; x <= 4.2; x += 0.3) if (Math.abs(x) > 0.8) add(B(0.04, 0.6, 0.04), trim, x, 1.05, D / 2 + 2.3);
  add(B(1.6, 0.2, 0.6), st, 0, 0.3, D / 2 + 2.7);
    },
    () => {
  const V = 0;
  const W = 13, D = 7, H = 3, wall = M(0xc8b89c, 0.85, 0, 'plaster'), trim = M(0xe8e2d4, 0.75, 0, 'plaster'), rf = M(0x5a4a40, 0.85, 0.05, 'tile'), gl = M(0x2a333c, 0.25, 0.3, 'tile'), dr = M(0x3b4a63, 0.7, 0, 'timber'), st = M(0x7a5a48, 0.95, 0, 'stone'), mt = M(0x8a9199, 0.5, 0.6, 'metal');
  add(B(W, H, D), wall, 0, H / 2 + 0.3, 0); add(B(W + 0.2, 0.3, D + 0.2), st, 0, 0.15, 0);
  const hp = new THREE.ConeGeometry(1, 1, 4, 1); hp.rotateY(Math.PI / 4); hp.scale(W * 0.78, 2.0, D * 0.8); add(hp, rf, 0, H + 1.3, 0);
  add(B(3.6, 1.6, 0.08), gl, -2.4, 2.0, D / 2 + 0.03); add(B(3.8, 0.12, 0.2), trim, -2.4, 1.15, D / 2 + 0.08); add(B(0.1, 1.6, 0.1), trim, -3.3, 2.0, D / 2 + 0.06); add(B(0.1, 1.6, 0.1), trim, -1.5, 2.0, D / 2 + 0.06);
  add(B(1.0, 2.1, 0.08), dr, 1.0, 1.35, D / 2 + 0.03); add(B(1.2, 0.1, 0.12), trim, 1.0, 2.45, D / 2 + 0.06);
  for (const x of [3.6, 5.2]) { add(B(1.0, 1.1, 0.08), gl, x, 2.1, D / 2 + 0.03); add(B(1.15, 0.1, 0.12), trim, x, 1.5, D / 2 + 0.08); }
  for (const x of [-4.5, 0, 4.5]) { add(B(1.0, 1.1, 0.08), gl, x, 2.1, -D / 2 - 0.03); }
  for (const z of [-1.5, 1.5]) { add(B(0.08, 1.1, 1.0), gl, W / 2 + 0.03, 2.1, z); add(B(0.08, 1.1, 1.0), gl, -W / 2 - 0.03, 2.1, z); }
  add(B(3.2, 0.12, 5.5), rf, -W / 2 - 1.6, 3.0, 0.5); for (const z of [-2, 3]) add(C(0.07, 0.07, 2.8, 6), mt, -W / 2 - 3.0, 1.5, z);
  add(B(0.7, 1.6, 0.7), st, 3.5, H + 1.8, -1.2);
    },
    () => {
  const V = 2;
  const W = 9, D = 7, H = 6, wall = M([0xd8d2c4, 0xc8c0a8, 0xb8c0b4][V % 3], 0.85, 0, 'plaster'), trim = M(0xeae6dc, 0.75, 0, 'plaster'), rf = M(0x4a3f3a, 0.85, 0.05, 'tile'), gl = M(0x2a333c, 0.25, 0.3, 'tile'), br = M(0x7a4a3a, 0.9, 0, 'stone'), dr = M(0x6a3a2a, 0.8, 0, 'timber'), st = M(0x6e6a62, 0.95, 0, 'stone');
  add(B(W + 0.2, 0.5, D + 0.2), st, 0, 0.25, 0); add(B(W, H, D), wall, 0, 0.5 + H / 2, 0);
  for (let y = 0.8; y < H + 0.4; y += 0.32) { add(B(W + 0.04, 0.05, 0.03), trim, 0, y, D / 2 + 0.01); add(B(W + 0.04, 0.05, 0.03), trim, 0, y, -D / 2 - 0.01); add(B(0.03, 0.05, D), trim, W / 2 + 0.01, y, 0); add(B(0.03, 0.05, D), trim, -W / 2 - 0.01, y, 0); }
  const gab = new THREE.Shape(); gab.moveTo(-D / 2, 0); gab.lineTo(D / 2, 0); gab.lineTo(0, 3); gab.lineTo(-D / 2, 0); const gg = new THREE.ExtrudeGeometry(gab, { depth: W, bevelEnabled: false }); gg.translate(0, 0, -W / 2); gg.rotateY(Math.PI / 2); add(gg, wall, 0, H + 0.5, 0);
  const L = Math.hypot(D / 2, 3) + 0.6; for (const sz of [-1, 1]) { const o = add(B(W + 0.8, 0.16, L), rf, 0, H + 0.5 + 1.55, sz * D / 4); o.rotation.x = sz * Math.atan2(3, D / 2); }
  add(B(0.8, 2.2, 0.8), br, W / 2 - 1.2, H + 2.6, -0.8);
  const win = (x, y, z, ry) => { const gp = new THREE.Group(); gp.position.set(x, y, z); gp.rotation.y = ry; g.add(gp); add(B(1.0, 1.4, 0.06), gl, 0, 0, 0, 0, 0, 0, gp); add(B(1.2, 0.1, 0.12), trim, 0, 0.75, 0.03, 0, 0, 0, gp); add(B(1.25, 0.1, 0.16), trim, 0, -0.75, 0.05, 0, 0, 0, gp); add(B(0.1, 1.5, 0.1), trim, -0.55, 0, 0.03, 0, 0, 0, gp); add(B(0.1, 1.5, 0.1), trim, 0.55, 0, 0.03, 0, 0, 0, gp); add(B(0.05, 1.4, 0.08), trim, 0, 0, 0.03, 0, 0, 0, gp); add(B(0.35, 1.45, 0.05), dr, -0.8, 0, 0.02, 0, 0, 0, gp); add(B(0.35, 1.45, 0.05), dr, 0.8, 0, 0.02, 0, 0, 0, gp); };
  for (const x of [-2.8, 2.8]) { win(x, 2.2, D / 2 + 0.05, 0); win(x, 4.9, D / 2 + 0.05, 0); win(x, 3.5, -D / 2 - 0.05, Math.PI); }
  win(0, 4.9, D / 2 + 0.05, 0); for (const z of [-1.5, 1.5]) { win(W / 2 + 0.05, 3.5, z, Math.PI / 2); win(-W / 2 - 0.05, 3.5, z, -Math.PI / 2); }
  add(B(1.1, 2.2, 0.1), dr, 0, 1.6, D / 2 + 0.05);
  // porch
  add(B(W, 0.25, 2.4), M(0x6b5a48, 0.9, 0, 'timber'), 0, 0.62, D / 2 + 1.2); for (const x of [-4.2, -1.4, 1.4, 4.2]) add(B(0.18, 2.6, 0.18), trim, x, 2.0, D / 2 + 2.25);
  const pr = add(B(W + 0.4, 0.14, 2.8), rf, 0, 3.45, D / 2 + 1.25); pr.rotation.x = 0.18; add(B(W, 0.1, 0.08), trim, 0, 1.4, D / 2 + 2.3); for (let x = -4.2; x <= 4.2; x += 0.3) if (Math.abs(x) > 0.8) add(B(0.04, 0.6, 0.04), trim, x, 1.05, D / 2 + 2.3);
  add(B(1.6, 0.2, 0.6), st, 0, 0.3, D / 2 + 2.7);
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
