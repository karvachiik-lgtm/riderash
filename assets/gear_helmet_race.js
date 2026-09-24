// Full-face race helmet -- a rider cosmetic that REPLACES the base helmet on the head joint.
//
// Drawn from the Atlas gear sheet (reference only, never loaded): a rounded shell that
// sits well clear of the skull, a big dark visor with a pivot boss each side, chin vents,
// a brow vent, a small rear spoiler and a rubber neck roll. Distinct from the base
// rider's sphere-and-box helmet at racing distance mostly by the spoiler and the visor.
//
// Built in the rider's HEAD-joint frame (assets/rider.js: origin at the top of the neck,
// +Y up the head, +Z the face) at the default body (headR 0.1027), then scaled to the
// body passed in opts.spec. Published `userData.mount = { joint: 'head', position }`
// says where this module's origin goes inside that joint. Materials are the rider's own
// classes so the race's per-joint merge folds this into the head's existing draws.
//
// opts: { spec, shell, accent, visor, trim }  (colours as hex)
// Real metres. Base at y = 0, centred on x and z, front faces +Z.
export default function (THREE) {
  const opts = arguments[1] || {};
  // ---- shared gear kit (duplicated per module: the contract forbids imports) ----
  // MATERIALS MATCH assets/rider.js PARAMETER FOR PARAMETER (roughness, metalness,
  // clearcoat, name). The race merges a joint's meshes by everything EXCEPT colour
  // (assetlib.mergeJoints, vertexColors), so gear built from the rider's own material
  // classes fuses into the draws the joint already has instead of adding new ones.
  const P = (c, r, m, cc, ccr, name) => {
    const x = new THREE.MeshPhysicalMaterial({ color: c, roughness: r, metalness: m, clearcoat: cc, clearcoatRoughness: ccr });
    if (name) x.name = name;
    return x;
  };
  const S = (c, r, m, name) => {
    const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    if (name) x.name = name;
    return x;
  };
  const shellMat = (c) => P(c, 0.18, 0.08, 1.0, 0.03);          // rider.js `bone`
  const glassMat = (c) => P(c, 0.05, 0.20, 1.0, 0.01);          // rider.js `glass`
  const leatherMat = (c) => P(c, 0.46, 0.08, 0.55, 0.28, 'fabric'); // rider.js `leather`
  const flatMat = (c) => S(c, 0.55, 0.05);                      // rider.js `accent`
  const skinMat = (c) => S(c, 0.78, 0.0, 'plaster');            // rider.js `skin`
  const steelMat = () => S(0x8a9199, 0.34, 0.86, 'metal');      // rider.js `steel`
  const TAU = Math.PI * 2;
  const mesh = (geo, mat, x, y, z, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  // chamfered box, extruded along Z
  const cbox = (w, h, d, c) => {
    c = Math.min(c ?? Math.min(w, h) * 0.18, w * 0.45, h * 0.45);
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + c, -h / 2); s.lineTo(w / 2 - c, -h / 2); s.lineTo(w / 2, -h / 2 + c);
    s.lineTo(w / 2, h / 2 - c); s.lineTo(w / 2 - c, h / 2); s.lineTo(-w / 2 + c, h / 2);
    s.lineTo(-w / 2, h / 2 - c); s.lineTo(-w / 2, -h / 2 + c); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    geo.translate(0, 0, -d / 2);
    return geo;
  };
  // Loft of superellipse stations [c, v, a, ht, hb, p] along 'z' (sections in x,y) or
  // 'y' (sections in x,z); faceted normals, the locked low-poly style. See assets/bike.js.
  const loft = (st, o) => {
    o = o || {};
    const n = o.n || 16, axis = o.axis || 'z';
    const sec = o.section || ((s, t) => {
      const ang = t * TAU, c = Math.cos(ang), sn = Math.sin(ang), p = s[5] || 2.5;
      const x = s[2] * Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
      const b = sn >= 0 ? s[3] : s[4];
      return [x, s[1] + b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p)];
    });
    const pos = [], idx = [];
    const Pp = (u, v, w) => (axis === 'y' ? pos.push(u, w, v) : pos.push(u, v, w));
    st.forEach((s) => { for (let j = 0; j < n; j++) { const [u, v] = sec(s, j / n); Pp(u, v, s[0]); } });
    const flip = axis === 'y';
    const tri = (a, b, c) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
    for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n);
      tri(a, b, a + n); tri(b, b + n, a + n);
    }
    const cap = (i, end) => {
      let su = 0, sv = 0;
      for (let j = 0; j < n; j++) { const [u, v] = sec(st[i], j / n); su += u; sv += v; }
      const ci = pos.length / 3; Pp(su / n, sv / n, st[i][0]);
      for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + ((j + 1) % n); end ? tri(ci, a, b) : tri(ci, b, a); }
    };
    cap(0, false); cap(st.length - 1, true);
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    return geo;
  };
  const crescent = (thick) => (s, t) => {
    const half = t < 0.5, k = half ? t * 2 : (t - 0.5) * 2;
    const x = half ? -s[2] + 2 * s[2] * k : s[2] - 2 * s[2] * k;
    return [x, s[1] + s[3] * (1 - (x / s[2]) ** 2) - (half ? 0 : thick)];
  };
  // FINISH: parts were authored in the JOINT's own frame at the default body size. Scale
  // to this body, then re-origin to the contract (base y = 0, centred on x and z) and
  // publish where that origin sits in the joint's frame, so the game can mount it with
  // one position and no knowledge of how it was built.
  const finish = (g, joint, k) => {
    g.scale.setScalar(k);
    const box = new THREE.Box3(), v = new THREE.Vector3();
    g.updateMatrixWorld(true);
    g.traverse((n) => {
      const p = n.isMesh && n.geometry.attributes.position; if (!p) return;
      for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld));
    });
    const c = box.getCenter(new THREE.Vector3());
    const off = new THREE.Vector3(c.x, box.min.y, c.z);
    const root = new THREE.Group();
    g.position.sub(off);
    root.add(g);
    root.userData.mount = { joint, position: [off.x, off.y, off.z] };
    root.userData.grounded = true;
    return root;
  };
  const spec = opts.spec || {};
  const k = (spec.headR || 0.10267) / 0.10267;
  const col = spec.colors || {};
  const shell = shellMat(opts.shell ?? col.helmet ?? 0xd8d2c4);
  const accent = shellMat(opts.accent ?? col.accent ?? 0xd4622a);
  const visor = glassMat(opts.visor ?? 0x2a333c);
  const trim = flatMat(opts.trim ?? 0x1a1d20);
  const steel = steelMat();
  const g = new THREE.Group();

  // shell: an egg lofted fore-aft, fuller at the back, cut down at the chin
  g.add(mesh(loft([
    [-0.150, 0.060, 0.020, 0.018, 0.020, 2.0],
    [-0.135, 0.058, 0.070, 0.060, 0.070, 2.2],
    [-0.110, 0.070, 0.105, 0.105, 0.125, 2.4],
    [-0.040, 0.078, 0.124, 0.130, 0.165, 2.5],
    [0.030, 0.074, 0.124, 0.125, 0.172, 2.5],
    [0.095, 0.058, 0.108, 0.100, 0.160, 2.4],
    [0.128, -0.020, 0.084, 0.035, 0.080, 2.2],
    [0.142, -0.040, 0.035, 0.015, 0.045, 2.0],
  ], { n: 20 }), shell));
  // visor: a curved dark crescent across the face, raked, with a lip
  g.add(mesh(loft([
    [-0.010, 0.128, 0.096, 0.036, 0, 0], [0.050, 0.124, 0.100, 0.038, 0, 0], [0.112, 0.098, 0.088, 0.034, 0, 0],
  ], { axis: 'y', n: 18, section: crescent(0.02) }), visor));
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10).rotateZ(Math.PI / 2), steel, s * 0.124, 0.055, 0.045));
  // chin vents and brow vent
  for (let i = 0; i < 3; i++) g.add(mesh(cbox(0.012, 0.030, 0.012, 0.003), trim, (i - 1) * 0.022, -0.045, 0.142, 0.35));
  g.add(mesh(cbox(0.05, 0.012, 0.03, 0.004), trim, 0, 0.185, 0.085, -0.6));
  // accent stripe running over the crown
  g.add(mesh(loft([
    [-0.120, 0.160, 0.022, 0.012, 0.004, 2], [-0.040, 0.205, 0.024, 0.008, 0.004, 2],
    [0.030, 0.197, 0.024, 0.008, 0.004, 2], [0.080, 0.170, 0.020, 0.008, 0.004, 2],
  ], { n: 8 }), accent));
  // rear spoiler: a raked wedge off the back of the crown
  g.add(mesh(loft([
    [-0.150, 0.120, 0.040, 0.010, 0.006, 2], [-0.110, 0.150, 0.050, 0.020, 0.010, 2.4], [-0.050, 0.175, 0.030, 0.010, 0.005, 2],
  ], { n: 10 }), accent));
  // rubber neck roll
  g.add(mesh(new THREE.TorusGeometry(0.095, 0.016, 6, 18).rotateX(Math.PI / 2).scale(1, 1, 1.12), trim, 0, -0.095, -0.005));

  return finish(g, 'head', k);
}
