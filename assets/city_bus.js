// 1990s city transit bus, attempt B: one long profile extrusion with cut arches, window band, doors on the kerb side, 12.00 x 2.55 x 3.20 m -- built to the 404 asset contract (docs/asset-contract.md).
// Real metres, base at y = 0, centred on x and z, front faces +Z.
// Style: STYLE-LOCK.md -- chunky low-poly masses, hard chamfered edges, panel
// breaks, worn desaturated paint. No text anywhere: plates and signs are shape.
// opts (second argument, optional): { paint: 0xRRGGBB, seed: int } so one module
// yields per-instance paint variation in the game.
export default function generate(THREE, opts) {
  opts = opts || {};
  const g = new THREE.Group();
  let _s = ((opts.seed == null ? 7 : opts.seed) >>> 0) || 7;
  const rnd = () => ((_s = (Math.imul(_s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const M = (c, r, m, n) => {
    const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    if (n) x.name = n;
    return x;
  };
  const shade = (hex, k) => {
    const c = new THREE.Color(hex); c.multiplyScalar(k); return c.getHex();
  };
  // shared finishes
  const trim   = M(0x1b1b1e, 0.82, 0.08, 'fabric');   // rubber seals, bumpers, grille
  const chrome = M(0x8a9199, 0.32, 0.85, 'metal');
  const steel  = M(0x4a4e54, 0.6, 0.6, 'metal');      // chassis, tanks
  const glass  = M(0x1d2831, 0.1, 0.7, 'tile');
  const head   = M(0xe8e2cc, 0.2, 0.1, 'plaster');
  head.emissive = new THREE.Color(0xfff0c8); head.emissiveIntensity = 0.55;
  const tail   = M(0xa8231c, 0.3, 0.1, 'plaster');
  tail.emissive = new THREE.Color(0x8a1010); tail.emissiveIntensity = 0.45;
  const amber  = M(0xd4622a, 0.3, 0.1, 'plaster');
  const tyre   = M(0x1b1b1e, 0.92, 0.0, 'fabric');
  const hub    = M(0x6d7278, 0.45, 0.7, 'metal');
  const plate  = M(0xd0cbbb, 0.6, 0.1, 'plaster');   // blank plate: shape, never text
  const grime  = M(0x2a2a2c, 0.95, 0.05, 'fabric');   // road grime along sills
  const paintMat = (hex, r) => M(opts.paint == null ? hex : opts.paint, r == null ? 0.58 : r, 0.28, 'metal');

  const add = (geo, mat, x, y, z, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m); return m;
  };
  // A box with a hard single-segment chamfer on every edge.
  const cboxGeo = (w, h, d, b) => {
    b = Math.max(0.002, Math.min(b == null ? 0.04 : b, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
    const hw = w / 2 - b, hh = h / 2 - b, s = new THREE.Shape();
    s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.lineTo(-hw, -hh);
    const geo = new THREE.ExtrudeGeometry(s, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1 });
    geo.translate(0, 0, -(d - 2 * b) / 2);
    return geo;
  };
  const box = (w, h, d, mat, x, y, z, b, rx, ry, rz) => add(cboxGeo(w, h, d, b), mat, x, y, z, rx, ry, rz);
  // A side profile in (z, y) extruded across the width (x), chamfered.
  // pts: [[z, y], ...]; arcs: optional wheel arches handled by the caller.
  const profileGeo = (shape, width, b) => {
    b = b == null ? 0.05 : b;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 8 });
    geo.rotateY(-Math.PI / 2);            // shape x -> world z, extrude -> world -x
    geo.translate((width - 2 * b) / 2, 0, 0);
    return geo;
  };
  const poly = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.lineTo(pts[0][0], pts[0][1]); return s; };
  // Body outline with semicircular wheel arches cut into the sill line.
  // arches: [[zCentre, radius], ...] sorted rear -> front. top: [[z,y],...] from front to rear.
  const archBody = (zr, zf, sill, arches, top) => {
    const s = new THREE.Shape();
    s.moveTo(zr, sill);
    for (const [ac, ar] of arches) {
      s.lineTo(ac - ar, sill);
      s.absarc(ac, sill, ar, Math.PI, 0, true);
    }
    s.lineTo(zf, sill);
    for (const p of top) s.lineTo(p[0], p[1]);
    s.lineTo(zr, sill);
    return s;
  };
  // A wheel: tyre, sidewall bead, dished rim, hub nut. Axis along x.
  const wheel = (x, y, z, r, w, dual) => {
    const side = Math.sign(x) || 1;
    add(new THREE.CylinderGeometry(r, r, w, 16), tyre, x, y, z, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(r * 0.9, r * 0.9, w + 0.012, 16), tyre, x, y, z, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(r * 0.6, r * 0.62, 0.03, 10), hub, x + side * (w / 2 + 0.005), y, z, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(r * 0.16, r * 0.2, 0.05, 6), chrome, x + side * (w / 2 + 0.03), y, z, 0, 0, Math.PI / 2);
    if (dual) add(new THREE.CylinderGeometry(r, r, w, 16), tyre, x - side * (w + 0.03), y, z, 0, 0, Math.PI / 2);
  };
  // A chamfered box whose TOP face is shrunk/shifted: tumblehome and raked screens.
  // tw/td: top width/depth; tz: top z shift.
  const taperGeo = (w, h, d, tw, td, tz, b) => {
    const geo = cboxGeo(w, h, d, b), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * tw / w); p.setZ(i, p.getZ(i) * td / d + (tz || 0)); }
    geo.computeVertexNormals();
    return geo;
  };
  // Symmetric pair helper: fn(sign) called for -1 and +1.
  const pair = (fn) => { fn(-1); fn(1); };
  const paint = paintMat(0xd8d2c4);
  const livery = M(0x2f4f7f, 0.6, 0.2, 'metal');
  const R = 0.50, ZF = 3.70, ZR = -2.70, TX = 0.98;
  add(profileGeo(archBody(-6.00, 6.00, 0.34, [[ZR, 0.60], [ZF, 0.60]],
    [[6.03, 0.45], [6.06, 2.92], [5.92, 3.08], [-5.92, 3.08], [-6.03, 2.92], [-6.03, 0.45]]), 2.55, 0.08), paint);
  for (const z of [ZR, ZF]) box(1.7, 0.6, 1.16, trim, 0, 0.62, z, 0.02);
  // Window band both sides, with pillars every 1.2 m, and the livery stripe.
  box(2.57, 0.98, 10.2, glass, 0, 2.30, -0.55, 0.02);
  pair((s) => {
    for (let i = 0; i < 10; i++) {
      const z = 4.4 - i * 1.13;
      if (s < 0 && z > 4.0) continue;             // front door bay is glass floor-to-roof
      box(0.02, 1.0, 0.10, paint, s * 1.285, 2.30, z, 0.005);
    }
    box(0.02, 0.26, 11.6, livery, s * 1.28, 1.20, 0, 0.005);
    box(0.02, 0.06, 11.6, livery, s * 1.28, 1.45, 0, 0.005);
    box(0.02, 0.05, 11.2, trim, s * 1.285, 2.82, -0.1, 0.005);     // window top seal
    box(0.03, 0.10, 11.4, trim, s * 1.28, 0.56, 0, 0.01);           // rub rail
    for (let z = -4.6; z < 3; z += 2.3) box(0.012, 1.3, 0.012, trim, s * 1.285, 1.18, z, 0.003); // skirt panel breaks
    box(0.06, 0.08, 0.10, amber, s * 1.29, 0.8, 1.0, 0.01);
    box(0.34, 0.18, 0.05, head, s * 0.92, 0.78, 6.07, 0.015);
    box(0.14, 0.14, 0.05, amber, s * 0.62, 0.78, 6.07, 0.01);
    box(0.20, 0.44, 0.05, tail, s * 1.05, 1.05, -6.04, 0.015);
    box(0.40, 0.06, 0.06, steel, s * 1.35, 2.55, 5.95, 0.01);       // mirror arm
    box(0.08, 0.36, 0.22, trim, s * 1.55, 2.35, 5.95, 0.02);
    wheel(s * TX, R, ZF, R, 0.3);
    wheel(s * 1.0, R, ZR, R, 0.28, true);
  });
  // Doors, kerb side (-x): front bi-fold at the nose, centre door behind the front axle.
  for (const [z, w] of [[5.35, 1.05], [0.4, 1.2]]) {
    box(0.03, 2.35, w, glass, -1.285, 1.55, z, 0.01);
    box(0.035, 2.4, 0.06, trim, -1.29, 1.55, z, 0.005);
    box(0.035, 0.06, w + 0.1, trim, -1.29, 2.74, z, 0.005);
    box(0.035, 0.06, w + 0.1, trim, -1.29, 0.36, z, 0.005);
  }
  // Nose: big windscreen, destination box (dark slab, no text), bumper, route lamp.
  box(2.34, 1.55, 0.05, glass, 0, 2.08, 6.06, 0.02);
  box(0.06, 1.55, 0.06, trim, 0, 2.08, 6.08, 0.01);
  box(1.70, 0.28, 0.05, M(0x26241f, 0.4, 0.1, 'tile'), 0, 2.97, 6.07, 0.01);
  box(1.50, 0.12, 0.02, M(0xb88a2a, 0.5, 0.1, 'plaster'), 0, 2.97, 6.10, 0.005);
  box(2.58, 0.30, 0.20, trim, 0, 0.46, 6.10, 0.05);
  box(2.58, 0.30, 0.20, trim, 0, 0.46, -6.10, 0.05);
  box(0.52, 0.12, 0.02, plate, 0, 0.66, 6.08, 0.006);
  box(1.8, 0.03, 0.03, chrome, 0, 1.15, 6.08, 0.005);
  // Tail: engine louvres, rear window, plate.
  box(2.1, 0.8, 0.05, glass, 0, 2.3, -6.04, 0.02);
  for (let i = 0; i < 6; i++) box(1.6, 0.04, 0.04, trim, 0, 0.8 + i * 0.1, -6.05, 0.005);
  box(0.52, 0.12, 0.02, plate, 0, 1.48, -6.05, 0.006);
  // Roof: A/C pod and hatches.
  box(1.7, 0.26, 2.4, M(0xb8b2a4, 0.7, 0.2, 'metal'), 0, 3.2, 0.6, 0.06);
  for (const z of [3.8, -2.8]) box(0.8, 0.08, 0.8, steel, 0, 3.12, z, 0.02);
  box(2.50, 0.08, 7.8, grime, 0, 0.37, 0.5, 0.02);
  // Placement: measure vertices (not Box3.setFromObject) and move base to y=0,
  // centred on x and z.
  const box3 = new THREE.Box3(), v = new THREE.Vector3(), mm = new THREE.Matrix4(), im = new THREE.Matrix4();
  g.updateMatrixWorld(true);
  g.traverse((n) => {
    const p = n.isMesh && n.geometry.attributes.position; if (!p) return;
    const put = (mat) => { for (let i = 0; i < p.count; i++) box3.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(mat)); };
    if (n.isInstancedMesh) { for (let c = 0; c < n.count; c++) { n.getMatrixAt(c, im); put(mm.multiplyMatrices(n.matrixWorld, im)); } return; }
    put(n.matrixWorld);
  });
  const c = box3.getCenter(new THREE.Vector3());
  g.children.forEach((o) => { o.position.x -= c.x; o.position.y -= box3.min.y; o.position.z -= c.z; });
  return g;
}
