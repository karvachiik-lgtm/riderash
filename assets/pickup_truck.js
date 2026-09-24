// Full-size 1990s pickup, attempt B: side-profile extrusions with cut arches, open bed built from walls, 5.40 x 1.95 x 1.85 m -- built to the 404 asset contract (docs/asset-contract.md).
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
  const paint = paintMat(0x3d5a45);
  const W = 1.95, R = 0.40, ZF = 1.75, ZR = -1.55, TX = 0.83;
  // Lower body: full length to the bed floor, hood deck forward of the cab.
  add(profileGeo(archBody(-2.70, 2.70, 0.46, [[ZR, 0.47], [ZF, 0.47]],
    [[2.72, 0.62], [2.72, 0.98], [2.60, 1.14], [0.95, 1.20], [-0.60, 1.20], [-0.62, 0.86], [-2.70, 0.86], [-2.72, 0.62]]), W, 0.06), paint);
  for (const z of [ZR, ZF]) box(1.40, 0.5, 0.9, trim, 0, 0.62, z, 0.02);
  // Cab glasshouse + roof.
  add(profileGeo(poly([[0.92, 1.16], [0.30, 1.76], [-0.42, 1.78], [-0.56, 1.16]]), 1.78, 0.04), glass);
  box(1.74, 0.07, 0.80, paint, 0, 1.80, -0.07, 0.03);
  box(1.80, 0.40, 0.08, paint, 0, 1.40, -0.57, 0.02);      // cab back panel around rear glass
  // Bed: floor ribs, walls, tailgate with a panel break.
  pair((s) => {
    box(0.10, 0.44, 2.10, paint, s * 0.925, 1.07, -1.66, 0.03);   // bed side wall
    box(0.12, 0.04, 2.10, trim, s * 0.925, 1.30, -1.66, 0.01);    // bed rail cap
    box(0.06, 0.07, 0.72, paint, s * 0.87, 1.47, 0.60, 0.02, 0.77); // A pillar
    box(0.03, 0.05, 1.5, trim, s * 0.985, 0.80, 0.9, 0.01);       // rubbing strip
    box(0.012, 0.6, 0.012, trim, s * 0.985, 0.88, 0.92, 0.003);   // door shut lines
    box(0.012, 0.6, 0.012, trim, s * 0.985, 0.88, -0.56, 0.003);
    box(0.02, 0.03, 0.16, chrome, s * 0.99, 1.05, -0.35, 0.005);  // handle
    box(0.06, 0.24, 0.24, trim, s * 1.08, 1.30, 0.72, 0.02);      // tall truck mirror
    box(0.18, 0.03, 0.03, trim, s * 1.0, 1.22, 0.72, 0.01);
    box(0.30, 0.20, 0.05, head, s * 0.66, 1.00, 2.73, 0.015);     // square lamps
    box(0.10, 0.20, 0.05, amber, s * 0.88, 1.00, 2.71, 0.01);
    box(0.14, 0.32, 0.05, tail, s * 0.90, 1.05, -2.73, 0.015);    // vertical tail lamps
    box(0.03, 0.12, 0.30, trim, s * 0.99, 0.95, ZF + 0.55, 0.01); // fender flare edge
    wheel(s * TX, R, ZF, R, 0.26); wheel(s * TX, R, ZR, R, 0.26);
  });
  box(1.76, 0.04, 2.02, trim, 0, 0.88, -1.66, 0.01);             // bed liner
  for (let i = -3; i <= 3; i++) box(0.05, 0.03, 2.0, steel, i * 0.24, 0.91, -1.66, 0.01);
  box(1.80, 0.44, 0.08, paint, 0, 1.07, -0.64, 0.02);            // bed front wall
  box(1.95, 0.46, 0.08, paint, 0, 1.07, -2.68, 0.02);            // tailgate
  box(1.2, 0.012, 0.012, trim, 0, 1.18, -2.725, 0.003);
  box(0.30, 0.06, 0.02, trim, 0, 1.18, -2.73, 0.005);            // tailgate latch
  box(1.44, 0.36, 0.05, trim, 0, 0.98, 2.73, 0.01);               // black grille
  for (let i = -2; i <= 2; i++) box(0.03, 0.34, 0.03, steel, i * 0.26, 0.98, 2.75, 0.005);
  box(1.46, 0.03, 0.03, chrome, 0, 1.16, 2.75, 0.005);
  box(2.02, 0.24, 0.22, chrome, 0, 0.60, 2.78, 0.05);            // chrome bumpers
  box(2.02, 0.22, 0.20, chrome, 0, 0.62, -2.78, 0.05);
  box(0.55, 0.13, 0.02, plate, 0, 0.62, 2.90, 0.006);
  box(0.55, 0.13, 0.02, plate, 0, 0.62, -2.89, 0.006);
  box(1.92, 0.08, 2.3, grime, 0, 0.49, 0.1, 0.02);
  box(1.95, 0.012, 0.012, trim, 0, 1.19, 0.95, 0.003);           // hood shut line
  box(0.9, 0.18, 1.2, steel, 0, 0.35, 0.1, 0.02);                // transmission/underbody
  box(0.08, 0.08, 0.3, steel, -0.6, 0.35, -2.7, 0.01);           // exhaust
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
