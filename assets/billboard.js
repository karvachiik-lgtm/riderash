// RideRash roadside asset: billboard.
// Roadside billboard, poster art as colour blocks only. v0-3: steel two-post with catwalk (attempt A), four compositions. v4-5: old timber frame (attempt C).
// Built to docs/asset-contract.md: metres, base at y = 0, centred on x/z, front +Z,
// primitives/extrusions/lathes only, flat colours named from the contract list.
// Chosen by eye from three independent attempts (see scenery.js header); the
// losing attempts that still read well are kept as `opts.variant` so the road is
// not lined with one silhouette. Variants: 6. Flat shading on purpose: the
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
  // Artwork is COLOUR BLOCKS ONLY: the format cannot do legible text and a
  // smudge reads worse than an abstract, so each variant is a poster composition.
  const art = (par, W, H, z) => { const pal = [[0xd4622a, 0xb8912e, 0x2f6f8f, 0x1b1b1e, 0xd8d2c4], [0x2f6f8f, 0xd8d2c4, 0xc4442a, 0x1b1b1e, 0xb8912e], [0x6a4a7a, 0xd4622a, 0xd8d2c4, 0x2a2624, 0x41502e], [0xb8912e, 0xc4442a, 0x1b1b1e, 0xd8d2c4, 0x2f6f8f]][V % 4].map((c) => M(c, 0.7, 0.02, 'plaster'));
    add(B(W, H, 0.05), pal[0], 0, 0, z, 0, 0, 0, par);
    if (V % 4 === 0) { add(B(W, H * 0.3, 0.02), pal[1], 0, -H * 0.2, z + 0.04, 0, 0, 0, par); add(C(H * 0.28, H * 0.28, 0.02, 20), pal[1], W * 0.22, H * 0.08, z + 0.035, Math.PI / 2, 0, 0, par); add(B(W * 0.35, H * 0.18, 0.02), pal[3], -W * 0.25, -H * 0.3, z + 0.06, 0, 0, 0, par); add(B(W * 0.12, H * 0.1, 0.02), pal[4], -W * 0.33, -H * 0.22, z + 0.07, 0, 0, 0, par); }
    else if (V % 4 === 1) { add(B(W * 0.5, H, 0.02), pal[1], W * 0.25, 0, z + 0.04, 0, 0, 0, par); add(new THREE.CircleGeometry(H * 0.3, 16), pal[2], W * 0.25, 0, z + 0.06, 0, 0, 0, par); add(B(W * 0.36, H * 0.1, 0.02), pal[4], -W * 0.24, H * 0.2, z + 0.04, 0, 0, 0, par); add(B(W * 0.3, H * 0.1, 0.02), pal[4], -W * 0.27, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.24, H * 0.1, 0.02), pal[3], -W * 0.3, -H * 0.2, z + 0.04, 0, 0, 0, par); }
    else if (V % 4 === 2) { for (let i = 0; i < 5; i++) add(B(W, H * 0.08, 0.02), pal[1 + (i % 2)], 0, H * (-0.35 + i * 0.14), z + 0.04, 0, 0, 0, par); const tri = new THREE.Shape(); tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1.3); add(new THREE.ShapeGeometry(tri), pal[3], -W * 0.2, -H * 0.5, z + 0.06, 0, 0, 0, par).scale.set(H * 0.5, H * 0.6, 1); }
    else { add(B(W * 0.55, H * 0.55, 0.02), pal[1], -W * 0.15, H * 0.05, z + 0.04, 0, 0, 0.12, par); add(B(W * 0.2, H * 0.7, 0.02), pal[3], W * 0.32, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.16, H * 0.16, 0.02), pal[4], W * 0.32, H * 0.2, z + 0.06, 0, 0, 0, par); } };
  const W = 9, H = 3.6, st = M(0x6a7076, 0.5, 0.6, 'metal'), fr = M(0x2a2a2e, 0.6, 0.4, 'metal'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  for (const x of [-2.6, 2.6]) { add(B(0.35, 7, 0.22), st, x, 3.5, -0.3); add(B(0.06, 7, 0.4), st, x, 3.5, -0.3); }
  const pan = new THREE.Group(); pan.position.set(0, 6.6, 0); g.add(pan);
  add(B(W + 0.3, H + 0.3, 0.18), fr, 0, 0, -0.1, 0, 0, 0, pan); art(pan, W, H, 0.02);
  for (let x = -W / 2; x <= W / 2; x += 1.5) add(B(0.08, H, 0.12), st, x, 0, -0.28, 0, 0, 0, pan); for (const y of [-H / 2 + 0.2, 0, H / 2 - 0.2]) add(B(W, 0.08, 0.12), st, 0, y, -0.28, 0, 0, 0, pan);
  add(B(W, 0.06, 0.9), fr, 0, -H / 2 - 0.35, 0.45, 0, 0, 0, pan); add(B(W, 0.04, 0.04), st, 0, -H / 2 + 0.3, 0.88, 0, 0, 0, pan);
  for (const x of [-3, 0, 3]) { add(B(0.05, 0.05, 1.0), st, x, -H / 2 - 0.25, 0.5, 0.4, 0, 0, pan); add(B(0.4, 0.14, 0.2), lt, x, -H / 2 - 0.05, 0.95, -0.6, 0, 0, pan); }
  add(B(0.5, 6, 0.06), st, 3.4, 3.2, -0.45); for (let y = 0.6; y < 6; y += 0.4) add(B(0.5, 0.04, 0.04), st, 3.4, y, -0.45);
    },
    () => {
  const V = 1;
  // Artwork is COLOUR BLOCKS ONLY: the format cannot do legible text and a
  // smudge reads worse than an abstract, so each variant is a poster composition.
  const art = (par, W, H, z) => { const pal = [[0xd4622a, 0xb8912e, 0x2f6f8f, 0x1b1b1e, 0xd8d2c4], [0x2f6f8f, 0xd8d2c4, 0xc4442a, 0x1b1b1e, 0xb8912e], [0x6a4a7a, 0xd4622a, 0xd8d2c4, 0x2a2624, 0x41502e], [0xb8912e, 0xc4442a, 0x1b1b1e, 0xd8d2c4, 0x2f6f8f]][V % 4].map((c) => M(c, 0.7, 0.02, 'plaster'));
    add(B(W, H, 0.05), pal[0], 0, 0, z, 0, 0, 0, par);
    if (V % 4 === 0) { add(B(W, H * 0.3, 0.02), pal[1], 0, -H * 0.2, z + 0.04, 0, 0, 0, par); add(C(H * 0.28, H * 0.28, 0.02, 20), pal[1], W * 0.22, H * 0.08, z + 0.035, Math.PI / 2, 0, 0, par); add(B(W * 0.35, H * 0.18, 0.02), pal[3], -W * 0.25, -H * 0.3, z + 0.06, 0, 0, 0, par); add(B(W * 0.12, H * 0.1, 0.02), pal[4], -W * 0.33, -H * 0.22, z + 0.07, 0, 0, 0, par); }
    else if (V % 4 === 1) { add(B(W * 0.5, H, 0.02), pal[1], W * 0.25, 0, z + 0.04, 0, 0, 0, par); add(new THREE.CircleGeometry(H * 0.3, 16), pal[2], W * 0.25, 0, z + 0.06, 0, 0, 0, par); add(B(W * 0.36, H * 0.1, 0.02), pal[4], -W * 0.24, H * 0.2, z + 0.04, 0, 0, 0, par); add(B(W * 0.3, H * 0.1, 0.02), pal[4], -W * 0.27, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.24, H * 0.1, 0.02), pal[3], -W * 0.3, -H * 0.2, z + 0.04, 0, 0, 0, par); }
    else if (V % 4 === 2) { for (let i = 0; i < 5; i++) add(B(W, H * 0.08, 0.02), pal[1 + (i % 2)], 0, H * (-0.35 + i * 0.14), z + 0.04, 0, 0, 0, par); const tri = new THREE.Shape(); tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1.3); add(new THREE.ShapeGeometry(tri), pal[3], -W * 0.2, -H * 0.5, z + 0.06, 0, 0, 0, par).scale.set(H * 0.5, H * 0.6, 1); }
    else { add(B(W * 0.55, H * 0.55, 0.02), pal[1], -W * 0.15, H * 0.05, z + 0.04, 0, 0, 0.12, par); add(B(W * 0.2, H * 0.7, 0.02), pal[3], W * 0.32, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.16, H * 0.16, 0.02), pal[4], W * 0.32, H * 0.2, z + 0.06, 0, 0, 0, par); } };
  const W = 9, H = 3.6, st = M(0x6a7076, 0.5, 0.6, 'metal'), fr = M(0x2a2a2e, 0.6, 0.4, 'metal'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  for (const x of [-2.6, 2.6]) { add(B(0.35, 7, 0.22), st, x, 3.5, -0.3); add(B(0.06, 7, 0.4), st, x, 3.5, -0.3); }
  const pan = new THREE.Group(); pan.position.set(0, 6.6, 0); g.add(pan);
  add(B(W + 0.3, H + 0.3, 0.18), fr, 0, 0, -0.1, 0, 0, 0, pan); art(pan, W, H, 0.02);
  for (let x = -W / 2; x <= W / 2; x += 1.5) add(B(0.08, H, 0.12), st, x, 0, -0.28, 0, 0, 0, pan); for (const y of [-H / 2 + 0.2, 0, H / 2 - 0.2]) add(B(W, 0.08, 0.12), st, 0, y, -0.28, 0, 0, 0, pan);
  add(B(W, 0.06, 0.9), fr, 0, -H / 2 - 0.35, 0.45, 0, 0, 0, pan); add(B(W, 0.04, 0.04), st, 0, -H / 2 + 0.3, 0.88, 0, 0, 0, pan);
  for (const x of [-3, 0, 3]) { add(B(0.05, 0.05, 1.0), st, x, -H / 2 - 0.25, 0.5, 0.4, 0, 0, pan); add(B(0.4, 0.14, 0.2), lt, x, -H / 2 - 0.05, 0.95, -0.6, 0, 0, pan); }
  add(B(0.5, 6, 0.06), st, 3.4, 3.2, -0.45); for (let y = 0.6; y < 6; y += 0.4) add(B(0.5, 0.04, 0.04), st, 3.4, y, -0.45);
    },
    () => {
  const V = 2;
  // Artwork is COLOUR BLOCKS ONLY: the format cannot do legible text and a
  // smudge reads worse than an abstract, so each variant is a poster composition.
  const art = (par, W, H, z) => { const pal = [[0xd4622a, 0xb8912e, 0x2f6f8f, 0x1b1b1e, 0xd8d2c4], [0x2f6f8f, 0xd8d2c4, 0xc4442a, 0x1b1b1e, 0xb8912e], [0x6a4a7a, 0xd4622a, 0xd8d2c4, 0x2a2624, 0x41502e], [0xb8912e, 0xc4442a, 0x1b1b1e, 0xd8d2c4, 0x2f6f8f]][V % 4].map((c) => M(c, 0.7, 0.02, 'plaster'));
    add(B(W, H, 0.05), pal[0], 0, 0, z, 0, 0, 0, par);
    if (V % 4 === 0) { add(B(W, H * 0.3, 0.02), pal[1], 0, -H * 0.2, z + 0.04, 0, 0, 0, par); add(C(H * 0.28, H * 0.28, 0.02, 20), pal[1], W * 0.22, H * 0.08, z + 0.035, Math.PI / 2, 0, 0, par); add(B(W * 0.35, H * 0.18, 0.02), pal[3], -W * 0.25, -H * 0.3, z + 0.06, 0, 0, 0, par); add(B(W * 0.12, H * 0.1, 0.02), pal[4], -W * 0.33, -H * 0.22, z + 0.07, 0, 0, 0, par); }
    else if (V % 4 === 1) { add(B(W * 0.5, H, 0.02), pal[1], W * 0.25, 0, z + 0.04, 0, 0, 0, par); add(new THREE.CircleGeometry(H * 0.3, 16), pal[2], W * 0.25, 0, z + 0.06, 0, 0, 0, par); add(B(W * 0.36, H * 0.1, 0.02), pal[4], -W * 0.24, H * 0.2, z + 0.04, 0, 0, 0, par); add(B(W * 0.3, H * 0.1, 0.02), pal[4], -W * 0.27, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.24, H * 0.1, 0.02), pal[3], -W * 0.3, -H * 0.2, z + 0.04, 0, 0, 0, par); }
    else if (V % 4 === 2) { for (let i = 0; i < 5; i++) add(B(W, H * 0.08, 0.02), pal[1 + (i % 2)], 0, H * (-0.35 + i * 0.14), z + 0.04, 0, 0, 0, par); const tri = new THREE.Shape(); tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1.3); add(new THREE.ShapeGeometry(tri), pal[3], -W * 0.2, -H * 0.5, z + 0.06, 0, 0, 0, par).scale.set(H * 0.5, H * 0.6, 1); }
    else { add(B(W * 0.55, H * 0.55, 0.02), pal[1], -W * 0.15, H * 0.05, z + 0.04, 0, 0, 0.12, par); add(B(W * 0.2, H * 0.7, 0.02), pal[3], W * 0.32, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.16, H * 0.16, 0.02), pal[4], W * 0.32, H * 0.2, z + 0.06, 0, 0, 0, par); } };
  const W = 9, H = 3.6, st = M(0x6a7076, 0.5, 0.6, 'metal'), fr = M(0x2a2a2e, 0.6, 0.4, 'metal'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  for (const x of [-2.6, 2.6]) { add(B(0.35, 7, 0.22), st, x, 3.5, -0.3); add(B(0.06, 7, 0.4), st, x, 3.5, -0.3); }
  const pan = new THREE.Group(); pan.position.set(0, 6.6, 0); g.add(pan);
  add(B(W + 0.3, H + 0.3, 0.18), fr, 0, 0, -0.1, 0, 0, 0, pan); art(pan, W, H, 0.02);
  for (let x = -W / 2; x <= W / 2; x += 1.5) add(B(0.08, H, 0.12), st, x, 0, -0.28, 0, 0, 0, pan); for (const y of [-H / 2 + 0.2, 0, H / 2 - 0.2]) add(B(W, 0.08, 0.12), st, 0, y, -0.28, 0, 0, 0, pan);
  add(B(W, 0.06, 0.9), fr, 0, -H / 2 - 0.35, 0.45, 0, 0, 0, pan); add(B(W, 0.04, 0.04), st, 0, -H / 2 + 0.3, 0.88, 0, 0, 0, pan);
  for (const x of [-3, 0, 3]) { add(B(0.05, 0.05, 1.0), st, x, -H / 2 - 0.25, 0.5, 0.4, 0, 0, pan); add(B(0.4, 0.14, 0.2), lt, x, -H / 2 - 0.05, 0.95, -0.6, 0, 0, pan); }
  add(B(0.5, 6, 0.06), st, 3.4, 3.2, -0.45); for (let y = 0.6; y < 6; y += 0.4) add(B(0.5, 0.04, 0.04), st, 3.4, y, -0.45);
    },
    () => {
  const V = 3;
  // Artwork is COLOUR BLOCKS ONLY: the format cannot do legible text and a
  // smudge reads worse than an abstract, so each variant is a poster composition.
  const art = (par, W, H, z) => { const pal = [[0xd4622a, 0xb8912e, 0x2f6f8f, 0x1b1b1e, 0xd8d2c4], [0x2f6f8f, 0xd8d2c4, 0xc4442a, 0x1b1b1e, 0xb8912e], [0x6a4a7a, 0xd4622a, 0xd8d2c4, 0x2a2624, 0x41502e], [0xb8912e, 0xc4442a, 0x1b1b1e, 0xd8d2c4, 0x2f6f8f]][V % 4].map((c) => M(c, 0.7, 0.02, 'plaster'));
    add(B(W, H, 0.05), pal[0], 0, 0, z, 0, 0, 0, par);
    if (V % 4 === 0) { add(B(W, H * 0.3, 0.02), pal[1], 0, -H * 0.2, z + 0.04, 0, 0, 0, par); add(C(H * 0.28, H * 0.28, 0.02, 20), pal[1], W * 0.22, H * 0.08, z + 0.035, Math.PI / 2, 0, 0, par); add(B(W * 0.35, H * 0.18, 0.02), pal[3], -W * 0.25, -H * 0.3, z + 0.06, 0, 0, 0, par); add(B(W * 0.12, H * 0.1, 0.02), pal[4], -W * 0.33, -H * 0.22, z + 0.07, 0, 0, 0, par); }
    else if (V % 4 === 1) { add(B(W * 0.5, H, 0.02), pal[1], W * 0.25, 0, z + 0.04, 0, 0, 0, par); add(new THREE.CircleGeometry(H * 0.3, 16), pal[2], W * 0.25, 0, z + 0.06, 0, 0, 0, par); add(B(W * 0.36, H * 0.1, 0.02), pal[4], -W * 0.24, H * 0.2, z + 0.04, 0, 0, 0, par); add(B(W * 0.3, H * 0.1, 0.02), pal[4], -W * 0.27, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.24, H * 0.1, 0.02), pal[3], -W * 0.3, -H * 0.2, z + 0.04, 0, 0, 0, par); }
    else if (V % 4 === 2) { for (let i = 0; i < 5; i++) add(B(W, H * 0.08, 0.02), pal[1 + (i % 2)], 0, H * (-0.35 + i * 0.14), z + 0.04, 0, 0, 0, par); const tri = new THREE.Shape(); tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1.3); add(new THREE.ShapeGeometry(tri), pal[3], -W * 0.2, -H * 0.5, z + 0.06, 0, 0, 0, par).scale.set(H * 0.5, H * 0.6, 1); }
    else { add(B(W * 0.55, H * 0.55, 0.02), pal[1], -W * 0.15, H * 0.05, z + 0.04, 0, 0, 0.12, par); add(B(W * 0.2, H * 0.7, 0.02), pal[3], W * 0.32, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.16, H * 0.16, 0.02), pal[4], W * 0.32, H * 0.2, z + 0.06, 0, 0, 0, par); } };
  const W = 9, H = 3.6, st = M(0x6a7076, 0.5, 0.6, 'metal'), fr = M(0x2a2a2e, 0.6, 0.4, 'metal'), lt = M(0xeae6d0, 0.4, 0, 'plaster');
  for (const x of [-2.6, 2.6]) { add(B(0.35, 7, 0.22), st, x, 3.5, -0.3); add(B(0.06, 7, 0.4), st, x, 3.5, -0.3); }
  const pan = new THREE.Group(); pan.position.set(0, 6.6, 0); g.add(pan);
  add(B(W + 0.3, H + 0.3, 0.18), fr, 0, 0, -0.1, 0, 0, 0, pan); art(pan, W, H, 0.02);
  for (let x = -W / 2; x <= W / 2; x += 1.5) add(B(0.08, H, 0.12), st, x, 0, -0.28, 0, 0, 0, pan); for (const y of [-H / 2 + 0.2, 0, H / 2 - 0.2]) add(B(W, 0.08, 0.12), st, 0, y, -0.28, 0, 0, 0, pan);
  add(B(W, 0.06, 0.9), fr, 0, -H / 2 - 0.35, 0.45, 0, 0, 0, pan); add(B(W, 0.04, 0.04), st, 0, -H / 2 + 0.3, 0.88, 0, 0, 0, pan);
  for (const x of [-3, 0, 3]) { add(B(0.05, 0.05, 1.0), st, x, -H / 2 - 0.25, 0.5, 0.4, 0, 0, pan); add(B(0.4, 0.14, 0.2), lt, x, -H / 2 - 0.05, 0.95, -0.6, 0, 0, pan); }
  add(B(0.5, 6, 0.06), st, 3.4, 3.2, -0.45); for (let y = 0.6; y < 6; y += 0.4) add(B(0.5, 0.04, 0.04), st, 3.4, y, -0.45);
    },
    () => {
  const V = 1;
  // Artwork is COLOUR BLOCKS ONLY: the format cannot do legible text and a
  // smudge reads worse than an abstract, so each variant is a poster composition.
  const art = (par, W, H, z) => { const pal = [[0xd4622a, 0xb8912e, 0x2f6f8f, 0x1b1b1e, 0xd8d2c4], [0x2f6f8f, 0xd8d2c4, 0xc4442a, 0x1b1b1e, 0xb8912e], [0x6a4a7a, 0xd4622a, 0xd8d2c4, 0x2a2624, 0x41502e], [0xb8912e, 0xc4442a, 0x1b1b1e, 0xd8d2c4, 0x2f6f8f]][V % 4].map((c) => M(c, 0.7, 0.02, 'plaster'));
    add(B(W, H, 0.05), pal[0], 0, 0, z, 0, 0, 0, par);
    if (V % 4 === 0) { add(B(W, H * 0.3, 0.02), pal[1], 0, -H * 0.2, z + 0.04, 0, 0, 0, par); add(C(H * 0.28, H * 0.28, 0.02, 20), pal[1], W * 0.22, H * 0.08, z + 0.035, Math.PI / 2, 0, 0, par); add(B(W * 0.35, H * 0.18, 0.02), pal[3], -W * 0.25, -H * 0.3, z + 0.06, 0, 0, 0, par); add(B(W * 0.12, H * 0.1, 0.02), pal[4], -W * 0.33, -H * 0.22, z + 0.07, 0, 0, 0, par); }
    else if (V % 4 === 1) { add(B(W * 0.5, H, 0.02), pal[1], W * 0.25, 0, z + 0.04, 0, 0, 0, par); add(new THREE.CircleGeometry(H * 0.3, 16), pal[2], W * 0.25, 0, z + 0.06, 0, 0, 0, par); add(B(W * 0.36, H * 0.1, 0.02), pal[4], -W * 0.24, H * 0.2, z + 0.04, 0, 0, 0, par); add(B(W * 0.3, H * 0.1, 0.02), pal[4], -W * 0.27, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.24, H * 0.1, 0.02), pal[3], -W * 0.3, -H * 0.2, z + 0.04, 0, 0, 0, par); }
    else if (V % 4 === 2) { for (let i = 0; i < 5; i++) add(B(W, H * 0.08, 0.02), pal[1 + (i % 2)], 0, H * (-0.35 + i * 0.14), z + 0.04, 0, 0, 0, par); const tri = new THREE.Shape(); tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1.3); add(new THREE.ShapeGeometry(tri), pal[3], -W * 0.2, -H * 0.5, z + 0.06, 0, 0, 0, par).scale.set(H * 0.5, H * 0.6, 1); }
    else { add(B(W * 0.55, H * 0.55, 0.02), pal[1], -W * 0.15, H * 0.05, z + 0.04, 0, 0, 0.12, par); add(B(W * 0.2, H * 0.7, 0.02), pal[3], W * 0.32, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.16, H * 0.16, 0.02), pal[4], W * 0.32, H * 0.2, z + 0.06, 0, 0, 0, par); } };
  const W = 8, H = 3.4, wd = M(0x6a543e, 0.93, 0, 'timber'), fr = M(0xd8d2c4, 0.8, 0, 'plaster');
  for (const x of [-3.2, 0, 3.2]) { add(B(0.25, 6.2, 0.25), wd, x, 3.1, -0.3); add(B(0.14, 3.2, 0.14), wd, x, 1.6, -1.2, -0.55, 0, 0); }
  const pan = new THREE.Group(); pan.position.set(0, 5.6, 0); g.add(pan);
  add(B(W + 0.4, H + 0.4, 0.14), fr, 0, 0, -0.08, 0, 0, 0, pan); art(pan, W, H, 0.02);
  for (let x = -W / 2 + 0.2; x < W / 2; x += 0.8) add(B(0.1, H, 0.1), wd, x, 0, -0.22, 0, 0, 0, pan); add(B(W, 0.1, 0.1), wd, 0, H / 2 - 0.2, -0.22, 0, 0, 0, pan); add(B(W, 0.1, 0.1), wd, 0, -H / 2 + 0.2, -0.22, 0, 0, 0, pan);
  add(B(W + 0.4, 0.7, 0.08), fr, 0, 3.6, -0.02); for (let x = -W / 2; x <= W / 2; x += 0.5) add(B(0.06, 0.7, 0.1), wd, x, 3.6, 0.02);
    },
    () => {
  const V = 2;
  // Artwork is COLOUR BLOCKS ONLY: the format cannot do legible text and a
  // smudge reads worse than an abstract, so each variant is a poster composition.
  const art = (par, W, H, z) => { const pal = [[0xd4622a, 0xb8912e, 0x2f6f8f, 0x1b1b1e, 0xd8d2c4], [0x2f6f8f, 0xd8d2c4, 0xc4442a, 0x1b1b1e, 0xb8912e], [0x6a4a7a, 0xd4622a, 0xd8d2c4, 0x2a2624, 0x41502e], [0xb8912e, 0xc4442a, 0x1b1b1e, 0xd8d2c4, 0x2f6f8f]][V % 4].map((c) => M(c, 0.7, 0.02, 'plaster'));
    add(B(W, H, 0.05), pal[0], 0, 0, z, 0, 0, 0, par);
    if (V % 4 === 0) { add(B(W, H * 0.3, 0.02), pal[1], 0, -H * 0.2, z + 0.04, 0, 0, 0, par); add(C(H * 0.28, H * 0.28, 0.02, 20), pal[1], W * 0.22, H * 0.08, z + 0.035, Math.PI / 2, 0, 0, par); add(B(W * 0.35, H * 0.18, 0.02), pal[3], -W * 0.25, -H * 0.3, z + 0.06, 0, 0, 0, par); add(B(W * 0.12, H * 0.1, 0.02), pal[4], -W * 0.33, -H * 0.22, z + 0.07, 0, 0, 0, par); }
    else if (V % 4 === 1) { add(B(W * 0.5, H, 0.02), pal[1], W * 0.25, 0, z + 0.04, 0, 0, 0, par); add(new THREE.CircleGeometry(H * 0.3, 16), pal[2], W * 0.25, 0, z + 0.06, 0, 0, 0, par); add(B(W * 0.36, H * 0.1, 0.02), pal[4], -W * 0.24, H * 0.2, z + 0.04, 0, 0, 0, par); add(B(W * 0.3, H * 0.1, 0.02), pal[4], -W * 0.27, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.24, H * 0.1, 0.02), pal[3], -W * 0.3, -H * 0.2, z + 0.04, 0, 0, 0, par); }
    else if (V % 4 === 2) { for (let i = 0; i < 5; i++) add(B(W, H * 0.08, 0.02), pal[1 + (i % 2)], 0, H * (-0.35 + i * 0.14), z + 0.04, 0, 0, 0, par); const tri = new THREE.Shape(); tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1.3); add(new THREE.ShapeGeometry(tri), pal[3], -W * 0.2, -H * 0.5, z + 0.06, 0, 0, 0, par).scale.set(H * 0.5, H * 0.6, 1); }
    else { add(B(W * 0.55, H * 0.55, 0.02), pal[1], -W * 0.15, H * 0.05, z + 0.04, 0, 0, 0.12, par); add(B(W * 0.2, H * 0.7, 0.02), pal[3], W * 0.32, 0, z + 0.04, 0, 0, 0, par); add(B(W * 0.16, H * 0.16, 0.02), pal[4], W * 0.32, H * 0.2, z + 0.06, 0, 0, 0, par); } };
  const W = 8, H = 3.4, wd = M(0x6a543e, 0.93, 0, 'timber'), fr = M(0xd8d2c4, 0.8, 0, 'plaster');
  for (const x of [-3.2, 0, 3.2]) { add(B(0.25, 6.2, 0.25), wd, x, 3.1, -0.3); add(B(0.14, 3.2, 0.14), wd, x, 1.6, -1.2, -0.55, 0, 0); }
  const pan = new THREE.Group(); pan.position.set(0, 5.6, 0); g.add(pan);
  add(B(W + 0.4, H + 0.4, 0.14), fr, 0, 0, -0.08, 0, 0, 0, pan); art(pan, W, H, 0.02);
  for (let x = -W / 2 + 0.2; x < W / 2; x += 0.8) add(B(0.1, H, 0.1), wd, x, 0, -0.22, 0, 0, 0, pan); add(B(W, 0.1, 0.1), wd, 0, H / 2 - 0.2, -0.22, 0, 0, 0, pan); add(B(W, 0.1, 0.1), wd, 0, -H / 2 + 0.2, -0.22, 0, 0, 0, pan);
  add(B(W + 0.4, 0.7, 0.08), fr, 0, 3.6, -0.02); for (let x = -W / 2; x <= W / 2; x += 0.5) add(B(0.06, 0.7, 0.1), wd, x, 3.6, 0.02);
    },
  ];
  _variants[VV % 6]();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  g.traverse((n) => { const p = n.isMesh && n.geometry.attributes.position; if (!p) return; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld)); });
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((o) => { o.position.x -= c.x; o.position.y -= box.min.y; o.position.z -= c.z; });
  return g;
}
