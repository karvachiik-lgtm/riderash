// RideRash roadside asset: barn.
// Gambrel barn, big X-braced doors toward +Z (attempt A). v1 adds the grain silo from attempt C. v2: weathered colourway.
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
  const W = 10, D = 13, red = M([0x8a3324, 0x7a3a2a, 0x6b4a3a][V % 3], 0.9, 0, 'timber'), wh = M(0xd8d2c4, 0.8, 0, 'plaster'), rf = M(0x4a4a4e, 0.6, 0.4, 'metal'), dk = M(0x3a2a22, 0.9, 0, 'timber'), stn = M(0x6e6a62, 0.95, 0, 'stone');
  const gam = (w, h1, h2, s) => { const p = new THREE.Shape(); p.moveTo(-w / 2, 0); p.lineTo(w / 2, 0); p.lineTo(w / 2, h1); p.lineTo(w * 0.32, h1 + (h2 - h1) * 0.62); p.lineTo(0, h2); p.lineTo(-w * 0.32, h1 + (h2 - h1) * 0.62); p.lineTo(-w / 2, h1); p.lineTo(-w / 2, 0); return p; };
  const body = new THREE.ExtrudeGeometry(gam(W, 4.2, 8.4), { depth: D, bevelEnabled: false }); body.translate(0, 0, -D / 2); add(body, red, 0, 0.5, 0);
  add(B(W + 0.3, 0.5, D + 0.3), stn, 0, 0.25, 0);
  // roof: four slabs following the gambrel
  const slab = (x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0) + 0.35; const o = add(B(L, 0.16, D + 0.8), rf, (x0 + x1) / 2, (y0 + y1) / 2 + 0.5 + 0.1, 0); o.rotation.z = Math.atan2(y1 - y0, x1 - x0); };
  const y1 = 4.2, y2 = 4.2 + 4.2 * 0.62, y3 = 8.4; slab(-W / 2 - 0.2, y1 - 0.1, -W * 0.32, y2); slab(-W * 0.32, y2, 0, y3); slab(W / 2 + 0.2, y1 - 0.1, W * 0.32, y2); slab(W * 0.32, y2, 0, y3);
  for (const zf of [1, -1]) { const z = zf * (D / 2 + 0.06);
    add(B(4.2, 3.6, 0.1), red, 0, 2.3, z); add(B(4.5, 0.22, 0.14), wh, 0, 4.2, z); add(B(0.22, 3.8, 0.14), wh, -2.2, 2.3, z); add(B(0.22, 3.8, 0.14), wh, 2.2, 2.3, z); add(B(0.16, 3.6, 0.14), wh, 0, 2.3, z);
    for (const sx of [-1, 1]) { const o = add(B(0.16, 4.6, 0.12), wh, sx * 1.05, 2.3, z + zf * 0.02); o.rotation.z = sx * 0.52; const o2 = add(B(0.16, 4.6, 0.12), wh, sx * 1.05, 2.3, z + zf * 0.02); o2.rotation.z = -sx * 0.52; }
    add(B(1.6, 1.5, 0.1), dk, 0, 6.0, z); add(B(1.9, 0.16, 0.14), wh, 0, 6.8, z); add(B(1.9, 0.16, 0.14), wh, 0, 5.2, z);
    for (const sx of [-1, 1]) { add(B(0.2, 4.2, 0.16), wh, sx * W / 2, 2.6, z); } }
  for (const sx of [-1, 1]) for (const zz of [-3.5, 0, 3.5]) { add(B(0.1, 1.1, 1.0), wh, sx * (W / 2 + 0.05), 2.6, zz); add(B(0.08, 0.9, 0.8), dk, sx * (W / 2 + 0.08), 2.6, zz); }
  add(B(1.3, 1.1, 1.3), wh, 0, 9.2, 0); add(new THREE.ConeGeometry(1.1, 1.0, 4), rf, 0, 10.2, 0, 0, Math.PI / 4, 0); add(B(0.06, 1.0, 0.06), rf, 0, 11.0, 0);
    },
    () => {
  const V = 0;
  const W = 10, D = 13, red = M([0x8a3324, 0x7a3a2a, 0x6b4a3a][V % 3], 0.9, 0, 'timber'), wh = M(0xd8d2c4, 0.8, 0, 'plaster'), rf = M(0x4a4a4e, 0.6, 0.4, 'metal'), dk = M(0x3a2a22, 0.9, 0, 'timber'), stn = M(0x6e6a62, 0.95, 0, 'stone');
  const gam = (w, h1, h2, s) => { const p = new THREE.Shape(); p.moveTo(-w / 2, 0); p.lineTo(w / 2, 0); p.lineTo(w / 2, h1); p.lineTo(w * 0.32, h1 + (h2 - h1) * 0.62); p.lineTo(0, h2); p.lineTo(-w * 0.32, h1 + (h2 - h1) * 0.62); p.lineTo(-w / 2, h1); p.lineTo(-w / 2, 0); return p; };
  const body = new THREE.ExtrudeGeometry(gam(W, 4.2, 8.4), { depth: D, bevelEnabled: false }); body.translate(0, 0, -D / 2); add(body, red, 0, 0.5, 0);
  add(B(W + 0.3, 0.5, D + 0.3), stn, 0, 0.25, 0);
  // roof: four slabs following the gambrel
  const slab = (x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0) + 0.35; const o = add(B(L, 0.16, D + 0.8), rf, (x0 + x1) / 2, (y0 + y1) / 2 + 0.5 + 0.1, 0); o.rotation.z = Math.atan2(y1 - y0, x1 - x0); };
  const y1 = 4.2, y2 = 4.2 + 4.2 * 0.62, y3 = 8.4; slab(-W / 2 - 0.2, y1 - 0.1, -W * 0.32, y2); slab(-W * 0.32, y2, 0, y3); slab(W / 2 + 0.2, y1 - 0.1, W * 0.32, y2); slab(W * 0.32, y2, 0, y3);
  for (const zf of [1, -1]) { const z = zf * (D / 2 + 0.06);
    add(B(4.2, 3.6, 0.1), red, 0, 2.3, z); add(B(4.5, 0.22, 0.14), wh, 0, 4.2, z); add(B(0.22, 3.8, 0.14), wh, -2.2, 2.3, z); add(B(0.22, 3.8, 0.14), wh, 2.2, 2.3, z); add(B(0.16, 3.6, 0.14), wh, 0, 2.3, z);
    for (const sx of [-1, 1]) { const o = add(B(0.16, 4.6, 0.12), wh, sx * 1.05, 2.3, z + zf * 0.02); o.rotation.z = sx * 0.52; const o2 = add(B(0.16, 4.6, 0.12), wh, sx * 1.05, 2.3, z + zf * 0.02); o2.rotation.z = -sx * 0.52; }
    add(B(1.6, 1.5, 0.1), dk, 0, 6.0, z); add(B(1.9, 0.16, 0.14), wh, 0, 6.8, z); add(B(1.9, 0.16, 0.14), wh, 0, 5.2, z);
    for (const sx of [-1, 1]) { add(B(0.2, 4.2, 0.16), wh, sx * W / 2, 2.6, z); } }
  for (const sx of [-1, 1]) for (const zz of [-3.5, 0, 3.5]) { add(B(0.1, 1.1, 1.0), wh, sx * (W / 2 + 0.05), 2.6, zz); add(B(0.08, 0.9, 0.8), dk, sx * (W / 2 + 0.08), 2.6, zz); }
  add(B(1.3, 1.1, 1.3), wh, 0, 9.2, 0); add(new THREE.ConeGeometry(1.1, 1.0, 4), rf, 0, 10.2, 0, 0, Math.PI / 4, 0); add(B(0.06, 1.0, 0.06), rf, 0, 11.0, 0);
  { const si = M(0x9aa0a4, 0.5, 0.6, 'metal'), rfs = M(0x4a4a4e, 0.6, 0.4, 'metal'), stn2 = M(0x6e6a62, 0.95, 0, 'stone'); const sx = 10 / 2 + 3.2, sz = -3;
    add(C(2.2, 2.2, 13, 14), si, sx, 6.5, sz); add(new THREE.SphereGeometry(2.25, 14, 6, 0, 6.29, 0, Math.PI / 2), si, sx, 13, sz); add(C(2.35, 2.35, 0.6, 14), stn2, sx, 0.3, sz);
    for (let y = 1.5; y < 13; y += 1.6) add(new THREE.TorusGeometry(2.22, 0.05, 3, 14), rfs, sx, y, sz, Math.PI / 2, 0, 0); add(B(0.5, 12.5, 0.08), rfs, sx, 6.5, sz + 2.25); }
    },
    () => {
  const V = 2;
  const W = 10, D = 13, red = M([0x8a3324, 0x7a3a2a, 0x6b4a3a][V % 3], 0.9, 0, 'timber'), wh = M(0xd8d2c4, 0.8, 0, 'plaster'), rf = M(0x4a4a4e, 0.6, 0.4, 'metal'), dk = M(0x3a2a22, 0.9, 0, 'timber'), stn = M(0x6e6a62, 0.95, 0, 'stone');
  const gam = (w, h1, h2, s) => { const p = new THREE.Shape(); p.moveTo(-w / 2, 0); p.lineTo(w / 2, 0); p.lineTo(w / 2, h1); p.lineTo(w * 0.32, h1 + (h2 - h1) * 0.62); p.lineTo(0, h2); p.lineTo(-w * 0.32, h1 + (h2 - h1) * 0.62); p.lineTo(-w / 2, h1); p.lineTo(-w / 2, 0); return p; };
  const body = new THREE.ExtrudeGeometry(gam(W, 4.2, 8.4), { depth: D, bevelEnabled: false }); body.translate(0, 0, -D / 2); add(body, red, 0, 0.5, 0);
  add(B(W + 0.3, 0.5, D + 0.3), stn, 0, 0.25, 0);
  // roof: four slabs following the gambrel
  const slab = (x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0) + 0.35; const o = add(B(L, 0.16, D + 0.8), rf, (x0 + x1) / 2, (y0 + y1) / 2 + 0.5 + 0.1, 0); o.rotation.z = Math.atan2(y1 - y0, x1 - x0); };
  const y1 = 4.2, y2 = 4.2 + 4.2 * 0.62, y3 = 8.4; slab(-W / 2 - 0.2, y1 - 0.1, -W * 0.32, y2); slab(-W * 0.32, y2, 0, y3); slab(W / 2 + 0.2, y1 - 0.1, W * 0.32, y2); slab(W * 0.32, y2, 0, y3);
  for (const zf of [1, -1]) { const z = zf * (D / 2 + 0.06);
    add(B(4.2, 3.6, 0.1), red, 0, 2.3, z); add(B(4.5, 0.22, 0.14), wh, 0, 4.2, z); add(B(0.22, 3.8, 0.14), wh, -2.2, 2.3, z); add(B(0.22, 3.8, 0.14), wh, 2.2, 2.3, z); add(B(0.16, 3.6, 0.14), wh, 0, 2.3, z);
    for (const sx of [-1, 1]) { const o = add(B(0.16, 4.6, 0.12), wh, sx * 1.05, 2.3, z + zf * 0.02); o.rotation.z = sx * 0.52; const o2 = add(B(0.16, 4.6, 0.12), wh, sx * 1.05, 2.3, z + zf * 0.02); o2.rotation.z = -sx * 0.52; }
    add(B(1.6, 1.5, 0.1), dk, 0, 6.0, z); add(B(1.9, 0.16, 0.14), wh, 0, 6.8, z); add(B(1.9, 0.16, 0.14), wh, 0, 5.2, z);
    for (const sx of [-1, 1]) { add(B(0.2, 4.2, 0.16), wh, sx * W / 2, 2.6, z); } }
  for (const sx of [-1, 1]) for (const zz of [-3.5, 0, 3.5]) { add(B(0.1, 1.1, 1.0), wh, sx * (W / 2 + 0.05), 2.6, zz); add(B(0.08, 0.9, 0.8), dk, sx * (W / 2 + 0.08), 2.6, zz); }
  add(B(1.3, 1.1, 1.3), wh, 0, 9.2, 0); add(new THREE.ConeGeometry(1.1, 1.0, 4), rf, 0, 10.2, 0, 0, Math.PI / 4, 0); add(B(0.06, 1.0, 0.06), rf, 0, 11.0, 0);
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
