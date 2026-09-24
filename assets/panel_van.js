// Boxy 1990s panel van, attempt B: side-profile extrusions, short sloped nose, sliding door and rear barn doors, 5.00 x 2.00 x 2.20 m -- built to the 404 asset contract (docs/asset-contract.md).
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
  const paint = paintMat(0xc9c3b4);
  const W = 2.00, R = 0.36, ZF = 1.55, ZR = -1.60, TX = 0.86;
  add(profileGeo(archBody(-2.50, 2.50, 0.36, [[ZR, 0.42], [ZF, 0.42]],
    [[2.52, 0.50], [2.52, 0.92], [2.36, 1.08], [1.78, 1.16], [1.12, 2.05], [0.85, 2.18], [-2.40, 2.18], [-2.52, 2.08], [-2.52, 0.50]]), W, 0.07), paint);
  for (const z of [ZR, ZF]) box(1.48, 0.46, 0.84, trim, 0, 0.55, z, 0.02);
  // Windscreen and cab door glass, proud of the body by 1-2 cm.
  add(profileGeo(poly([[1.82, 1.18], [1.16, 2.04], [0.58, 2.04], [0.58, 1.30], [1.30, 1.30]]), 2.02, 0.03), glass);
  pair((s) => {
    box(0.05, 0.08, 1.12, paint, s * 0.985, 1.62, 1.46, 0.02, 0.92); // A pillar
    box(0.05, 0.78, 0.10, paint, s * 0.99, 1.68, 0.55, 0.02);        // B pillar
    box(0.012, 1.4, 0.012, trim, s * 1.0, 1.1, 0.50, 0.003);         // cab door shut line
    box(0.012, 1.4, 0.012, trim, s * 1.0, 1.1, 1.15, 0.003);
    box(0.02, 0.03, 0.14, chrome, s * 1.01, 1.22, 0.62, 0.005);
    box(0.08, 0.26, 0.20, trim, s * 1.10, 1.55, 1.2, 0.02);          // mirror
    box(0.12, 0.03, 0.03, trim, s * 1.03, 1.45, 1.2, 0.01);
    box(0.03, 0.06, 4.2, trim, s * 1.0, 0.78, -0.2, 0.01);           // rubbing strip
    box(0.38, 0.14, 0.05, head, s * 0.66, 0.90, 2.53, 0.015);
    box(0.10, 0.14, 0.05, amber, s * 0.90, 0.90, 2.52, 0.01);
    box(0.14, 0.40, 0.05, tail, s * 0.90, 1.05, -2.53, 0.015);
    box(0.6, 0.50, 0.02, glass, s * 0.46, 1.62, -2.53, 0.01);        // rear door windows
    wheel(s * TX, R, ZF, R, 0.22); wheel(s * TX, R, ZR, R, 0.22);
  });
  // Sliding door on the kerb side (-x = right when facing +z): track, shut lines, handle.
  box(0.03, 0.04, 2.0, steel, -1.0, 1.98, -0.55, 0.01);
  for (const z of [0.42, -1.25]) box(0.012, 1.55, 0.012, trim, -1.0, 1.15, z, 0.003);
  box(0.02, 0.04, 0.16, chrome, -1.01, 1.2, 0.32, 0.005);
  // Ribbed panel sides on the load area (both sides), a roof rack and a vent.
  pair((s) => { for (let i = 0; i < 4; i++) box(0.015, 0.05, 1.6, paint, s * 1.005, 1.45 + i * 0.12 - 0.3, -1.1, 0.01); });
  for (let i = 0; i < 4; i++) box(1.7, 0.04, 0.04, steel, 0, 2.22, -1.8 + i * 0.7, 0.01);
  pair((s) => box(0.04, 0.05, 2.3, steel, s * 0.85, 2.22, -0.75, 0.01));
  box(0.012, 1.7, 0.012, trim, 0, 1.2, -2.525, 0.003);               // barn door split
  box(0.04, 0.12, 0.03, chrome, 0.08, 1.15, -2.53, 0.005);
  box(1.20, 0.22, 0.05, trim, 0, 0.88, 2.53, 0.01);                   // grille
  for (let i = 0; i < 3; i++) box(1.1, 0.02, 0.02, steel, 0, 0.8 + i * 0.08, 2.55, 0.004);
  box(2.04, 0.22, 0.18, trim, 0, 0.48, 2.56, 0.05);                   // black bumpers
  box(2.04, 0.22, 0.16, trim, 0, 0.48, -2.56, 0.05);
  box(0.52, 0.12, 0.02, plate, 0, 0.50, 2.66, 0.006);
  box(0.52, 0.12, 0.02, plate, 0, 0.72, -2.54, 0.006);
  box(1.98, 0.08, 2.3, grime, 0, 0.39, -0.05, 0.02);
  box(0.08, 0.08, 0.3, steel, 0.6, 0.28, -2.5, 0.01);
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
