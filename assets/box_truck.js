// Medium box truck, attempt B: profile-extruded cab with a cut front arch, separate tall cargo box, dual rear wheels, roll-up door, 7.30 x 2.40 x 3.45 m -- built to the 404 asset contract (docs/asset-contract.md).
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
  const paint = paintMat(0x2f5f7f);
  const boxM = M(0xd8d2c4, 0.8, 0.05, 'metal');
  const boxRib = M(0xb8b2a4, 0.7, 0.2, 'metal');
  const R = 0.50, ZF = 2.75, ZR = -2.55, TX = 0.86;
  // Cab (2.20 wide): nose, hood, raked screen.
  add(profileGeo(archBody(1.30, 3.62, 0.56, [[ZF, 0.56]],
    [[3.64, 0.80], [3.64, 1.34], [3.50, 1.48], [3.10, 1.56], [2.62, 2.55], [2.42, 2.62], [1.30, 2.62]]), 2.20, 0.07), paint);
  box(1.6, 0.6, 1.0, trim, 0, 0.8, ZF, 0.02);
  add(profileGeo(poly([[3.16, 1.60], [2.64, 2.50], [2.05, 2.50], [2.05, 1.72], [2.60, 1.62]]), 2.22, 0.03), glass);
  pair((s) => {
    box(0.05, 0.08, 1.05, paint, s * 1.085, 2.05, 2.88, 0.02, 1.1);   // A pillar
    box(0.012, 1.7, 0.012, trim, s * 1.105, 1.6, 1.98, 0.003);      // door shut lines
    box(0.012, 1.7, 0.012, trim, s * 1.105, 1.6, 3.05, 0.003);
    box(0.02, 0.04, 0.16, chrome, s * 1.11, 1.75, 2.15, 0.005);
    box(0.20, 0.22, 0.30, steel, s * 1.08, 0.72, 2.2, 0.03);        // step
    box(0.07, 0.42, 0.20, trim, s * 1.34, 2.05, 2.95, 0.02);         // west-coast mirror
    box(0.25, 0.03, 0.03, chrome, s * 1.2, 2.25, 2.95, 0.01);
    box(0.25, 0.03, 0.03, chrome, s * 1.2, 1.85, 2.95, 0.01);
    box(0.36, 0.20, 0.05, head, s * 0.74, 1.10, 3.65, 0.015);
    box(0.10, 0.20, 0.05, amber, s * 1.0, 1.10, 3.63, 0.01);
    // cargo box ribs and rub rails
    for (let i = 0; i < 8; i++) box(0.03, 2.30, 0.06, boxRib, s * 1.21, 2.25, 1.0 - i * 0.68, 0.01);
    box(0.04, 0.10, 5.2, boxRib, s * 1.21, 1.14, -1.4, 0.02);
    box(0.04, 0.08, 5.2, boxRib, s * 1.21, 3.37, -1.4, 0.02);
    box(0.06, 0.08, 0.12, amber, s * 1.22, 1.2, -0.4, 0.01);          // side marker
    box(0.14, 0.30, 0.05, tail, s * 1.0, 0.95, -3.98, 0.015);
    box(0.30, 0.02, 0.60, trim, s * 0.86, 1.08, ZR, 0.01);            // rear wheel fender
    box(0.36, 0.40, 0.02, trim, s * 0.86, 0.55, ZR - 0.62, 0.005);    // mud flap
    wheel(s * TX, R, ZF, R, 0.26);
    wheel(s * 0.92, R, ZR, R, 0.24, true);
  });
  box(2.40, 2.30, 5.30, boxM, 0, 2.25, -1.35, 0.05);                  // cargo box
  box(2.2, 0.28, 5.2, steel, 0, 0.94, -1.35, 0.02);                   // box sill / crossmembers
  box(0.9, 0.30, 6.6, steel, 0, 0.72, -0.35, 0.02);                   // chassis rails
  // Roll-up rear door: slats and a pull handle; rear frame.
  for (let i = 0; i < 9; i++) box(2.10, 0.20, 0.03, boxRib, 0, 1.30 + i * 0.235, -4.01, 0.01);
  box(0.30, 0.05, 0.05, steel, 0, 1.30, -4.05, 0.01);
  box(2.30, 0.18, 0.18, steel, 0, 0.62, -3.95, 0.03);                 // rear bumper / step
  box(0.45, 0.12, 0.02, plate, 0, 0.62, -4.05, 0.006);
  box(1.3, 0.12, 0.08, amber, 0, 3.32, 1.28, 0.02);                   // cab clearance lamps
  box(1.44, 0.46, 0.05, trim, 0, 1.18, 3.65, 0.01);                   // grille
  for (let i = 0; i < 5; i++) box(1.36, 0.03, 0.03, chrome, 0, 1.0 + i * 0.09, 3.67, 0.005);
  box(2.26, 0.26, 0.22, steel, 0, 0.70, 3.70, 0.05);                  // front bumper
  box(0.50, 0.12, 0.02, plate, 0, 0.70, 3.82, 0.006);
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12), steel, -0.95, 0.8, 0.4, Math.PI / 2, 0, 0); // fuel tank
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), steel, 0.7, 0.45, -3.9, 0, 0, Math.PI / 2);  // exhaust
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
