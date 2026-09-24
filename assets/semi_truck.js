// American semi, attempt B: long-nose conventional tractor (profile-extruded hood with cut front arch), sleeper cab, stacks, silver box trailer, 16.50 x 2.60 x 4.05 m -- built to the 404 asset contract (docs/asset-contract.md).
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
  const paint = paintMat(0x8a2e26);
  const silver = M(0xa9adb0, 0.45, 0.55, 'metal');
  const rib = M(0x8d9194, 0.5, 0.6, 'metal');
  const R = 0.52, ZF = 7.10, TX = 0.95;
  // Hood and fenders (2.30 wide), cab behind.
  add(profileGeo(archBody(5.60, 8.25, 0.70, [[ZF, 0.62]],
    [[8.28, 0.90], [8.28, 1.72], [8.12, 1.88], [6.60, 2.02], [5.60, 2.02]]), 2.30, 0.08), paint);
  box(1.8, 0.6, 1.26, trim, 0, 0.9, ZF, 0.02);
  box(2.46, 2.10, 1.90, paint, 0, 2.38, 5.55, 0.07);                   // day cab
  box(2.46, 2.30, 1.30, paint, 0, 2.48, 3.98, 0.07);                   // sleeper
  add(taperGeo(2.40, 0.55, 1.9, 2.1, 1.4, -0.2, 0.05), paint, 0, 3.70, 4.95);  // roof fairing
  box(2.20, 0.82, 0.05, glass, 0, 2.82, 6.50, 0.02, -0.12);            // split screen
  box(0.06, 0.84, 0.06, paint, 0, 2.82, 6.52, 0.01, -0.12);
  pair((s) => {
    box(0.03, 0.72, 0.95, glass, s * 1.235, 2.85, 5.85, 0.01);          // door glass
    box(0.012, 1.9, 0.012, trim, s * 1.235, 2.2, 4.65, 0.003);
    box(0.012, 1.9, 0.012, trim, s * 1.235, 2.2, 6.45, 0.003);
    box(0.30, 0.10, 0.50, chrome, s * 1.25, 1.30, 5.55, 0.02);          // steps
    box(0.30, 0.10, 0.50, chrome, s * 1.25, 0.85, 5.55, 0.02);
    box(0.08, 0.60, 0.22, chrome, s * 1.52, 2.75, 6.40, 0.02);          // mirrors
    box(0.30, 0.03, 0.03, chrome, s * 1.36, 3.0, 6.40, 0.01);
    add(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 10), chrome, s * 1.33, 2.65, 4.62);   // stacks
    add(new THREE.CylinderGeometry(0.30, 0.30, 1.30, 14), chrome, s * 1.02, 0.95, 5.35, Math.PI / 2, 0, 0); // tanks
    box(0.36, 0.20, 0.05, head, s * 0.82, 1.35, 8.28, 0.015);
    box(0.10, 0.10, 0.05, amber, s * 1.08, 1.70, 8.10, 0.01);
    box(0.40, 0.30, 0.36, paint, s * 0.95, 1.12, 3.90, 0.03);          // drive-axle fenders
    wheel(s * TX, R, ZF, R, 0.3);
    for (const z of [3.9, 2.6, -6.3, -7.55]) wheel(s * 1.0, R, z, R, 0.28, true);
    // Trailer side ribs, rails, markers; landing leg.
    for (let i = 0; i < 13; i++) box(0.03, 2.75, 0.07, rib, s * 1.29, 2.64, 3.7 - i * 0.98, 0.01);
    box(0.04, 0.12, 12.2, rib, s * 1.29, 1.30, -2.2, 0.02);
    box(0.04, 0.10, 12.2, rib, s * 1.29, 3.98, -2.2, 0.02);
    for (const z of [3.5, -2.2, -8.0]) box(0.05, 0.08, 0.10, amber, s * 1.31, 1.32, z, 0.01);
    box(0.10, 0.9, 0.10, steel, s * 0.8, 0.75, 1.6, 0.02);
    box(0.25, 0.05, 0.25, steel, s * 0.8, 0.30, 1.6, 0.01);
    box(0.20, 0.54, 0.05, tail, s * 1.05, 1.05, -8.34, 0.01);
    box(0.02, 2.50, 0.02, chrome, s * 0.45, 2.6, -8.33, 0.005);       // door lock rods
    box(0.36, 0.45, 0.02, trim, s * 1.0, 0.45, -8.1, 0.005);           // mud flaps
  });
  box(1.36, 1.00, 0.05, chrome, 0, 1.36, 8.29, 0.02);                 // tall grille
  for (let i = 0; i < 7; i++) box(1.24, 0.04, 0.04, trim, 0, 0.95 + i * 0.13, 8.31, 0.005);
  box(2.50, 0.30, 0.28, chrome, 0, 0.72, 8.35, 0.06);                 // bumper
  box(1.0, 0.30, 7.2, steel, 0, 0.95, 4.6, 0.02);                     // frame rails
  add(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 14), steel, 0, 1.18, 3.3); // fifth wheel
  box(2.60, 2.80, 12.30, silver, 0, 2.65, -2.18, 0.05);                // trailer
  box(0.012, 2.6, 0.012, trim, 0, 2.62, -8.335, 0.003);                // rear door split
  box(2.4, 0.15, 0.2, steel, 0, 0.72, -8.1, 0.02);                     // underride bar
  pair((s) => box(0.10, 0.55, 0.10, steel, s * 0.9, 0.98, -8.1, 0.01));
  box(0.45, 0.12, 0.02, plate, 0.6, 1.12, -8.35, 0.006);
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
