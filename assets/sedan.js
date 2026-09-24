// Four-door 1990s sedan, attempt B: side-profile extrusions (body with cut wheel arches, separate glasshouse), 4.70 x 1.80 x 1.42 m -- built to the 404 asset contract (docs/asset-contract.md).
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
  const paint = paintMat(0x7a3a36);
  const paintLo = M(shade(opts.paint == null ? 0x7a3a36 : opts.paint, 0.78), 0.7, 0.2, 'metal');
  const W = 1.80, R = 0.32, ZF = 1.40, ZR = -1.35, TX = 0.78;
  // Body: sill 0.30, arches r 0.37, hood/boot decks, chamfered all round.
  add(profileGeo(archBody(-2.35, 2.35, 0.30, [[ZR, 0.37], [ZF, 0.37]],
    [[2.38, 0.46], [2.38, 0.68], [2.28, 0.82], [1.15, 0.90], [-1.55, 0.92], [-2.30, 0.88], [-2.38, 0.70], [-2.38, 0.46]]), W, 0.06), paint);
  // Wheel wells: dark liners so the arch does not show daylight through the car.
  for (const z of [ZR, ZF]) box(1.34, 0.42, 0.78, trim, 0, 0.5, z, 0.02);
  // Glasshouse, narrower than the body (tumblehome), then roof + pillars in paint.
  add(profileGeo(poly([[1.18, 0.86], [0.36, 1.37], [-0.86, 1.39], [-1.58, 0.88]]), 1.56, 0.04), glass);
  box(1.50, 0.07, 1.26, paint, 0, 1.40, -0.25, 0.03);
  pair((s) => {
    box(0.06, 0.07, 0.96, paint, s * 0.765, 1.12, 0.77, 0.02, 0.56);   // A pillar
    box(0.06, 0.52, 0.12, paint, s * 0.775, 1.12, -0.22, 0.02);        // B pillar
    box(0.06, 0.07, 0.88, paint, s * 0.765, 1.14, -1.22, 0.02, -0.62); // C pillar
    box(0.03, 0.05, 3.3, trim, s * 0.905, 0.62, 0.0, 0.01);           // rubbing strip
    for (const z of [1.05, -0.22, -1.25]) box(0.012, 0.5, 0.012, trim, s * 0.905, 0.62, z, 0.003); // door shut lines
    for (const z of [0.45, -0.75]) box(0.02, 0.03, 0.14, chrome, s * 0.91, 0.78, z, 0.005);        // handles
    box(0.10, 0.10, 0.16, paint, s * 0.94, 0.98, 1.0, 0.02);            // mirror
    box(0.012, 0.07, 0.12, glass, s * 0.995, 0.98, 1.0, 0.003);
    box(0.34, 0.13, 0.05, head, s * 0.60, 0.66, 2.37, 0.015);           // square headlights
    box(0.12, 0.08, 0.05, amber, s * 0.84, 0.64, 2.35, 0.01);
    box(0.40, 0.15, 0.05, tail, s * 0.58, 0.74, -2.37, 0.015);          // tail clusters
    box(0.06, 0.08, 0.10, amber, s * 0.905, 0.72, -2.2, 0.01);
    wheel(s * TX, R, ZF, R, 0.21); wheel(s * TX, R, ZR, R, 0.21);
  });
  // Lower body in a darker, worn tone: sills and valance carry road grime.
  box(1.82, 0.08, 2.1, grime, 0, 0.33, 0.02, 0.02);
  box(1.86, 0.20, 0.16, chrome, 0, 0.44, 2.40, 0.04);   // chrome bumpers
  box(1.86, 0.20, 0.16, chrome, 0, 0.44, -2.40, 0.04);
  box(1.80, 0.06, 0.12, paintLo, 0, 0.32, 2.33, 0.02);  // valance
  box(0.92, 0.16, 0.04, trim, 0, 0.66, 2.38, 0.01);      // grille
  for (let i = -3; i <= 3; i++) box(0.02, 0.14, 0.02, chrome, i * 0.12, 0.66, 2.40, 0.004);
  box(0.50, 0.12, 0.02, plate, 0, 0.44, 2.49, 0.006);    // blank plates
  box(0.50, 0.12, 0.02, plate, 0, 0.60, -2.39, 0.006);
  box(1.78, 0.012, 0.012, trim, 0, 0.90, 1.15, 0.003);   // hood and boot shut lines
  box(1.78, 0.012, 0.012, trim, 0, 0.92, -1.58, 0.003);
  box(0.06, 0.05, 0.25, steel, 0.45, 0.24, -2.35, 0.01); // exhaust tip
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
