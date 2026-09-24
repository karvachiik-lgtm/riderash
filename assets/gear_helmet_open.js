// Open-face jet helmet with goggles and a bandana -- a rider cosmetic that REPLACES the
// base helmet on the head joint (so it brings its own face, jaw and scarf).
//
// From the Atlas gear sheet (reference only): a leather-brown open shell with ear flaps,
// a short peak, round goggles on a strap over the eyes; the lower face is a scarf, which
// is the Road Rash biker look and saves modelling a mouth nobody sees at 90 mph.
//
// Head-joint frame, default body, scaled by spec.headR -- see gear_helmet_race.js.
// opts: { spec, shell, accent (scarf), lens, skin }
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
  const shell = shellMat(opts.shell ?? col.helmet ?? 0x3a2a1c);
  const scarf = leatherMat(opts.accent ?? col.accent ?? 0x8a1f1f);
  const lens = glassMat(opts.lens ?? 0x3b5566);
  const skin = skinMat(opts.skin ?? col.skin ?? 0x9c7358);
  const trim = flatMat(0x1a1d20);
  const steel = steelMat();
  const g = new THREE.Group();

  // face and jaw under the shell
  g.add(mesh(loft([
    [-0.080, 0.040, 0.070, 0.090, 0.110, 2.2], [0.000, 0.045, 0.086, 0.100, 0.125, 2.4],
    [0.070, 0.040, 0.076, 0.090, 0.115, 2.4], [0.098, 0.030, 0.050, 0.070, 0.090, 2.2],
  ], { n: 16 }), skin));
  g.add(mesh(cbox(0.022, 0.040, 0.030, 0.006), skin, 0, 0.030, 0.105, -0.2));            // nose
  // bandana over mouth and jaw, knotted at the back
  g.add(mesh(loft([
    [-0.085, -0.020, 0.080, 0.050, 0.060, 2.4], [0.010, -0.025, 0.094, 0.050, 0.070, 2.6], [0.090, -0.040, 0.080, 0.040, 0.050, 2.4], [0.110, -0.050, 0.050, 0.030, 0.040, 2.2],
  ], { n: 16 }), scarf));
  g.add(mesh(cbox(0.03, 0.05, 0.02, 0.008), scarf, 0, -0.06, -0.095, 0.4));
  // open shell: upper egg, stopping above the brow at the front, ear flaps down the sides
  g.add(mesh(loft([
    [-0.140, 0.095, 0.020, 0.015, 0.015, 2.0], [-0.125, 0.092, 0.070, 0.060, 0.060, 2.2], [-0.090, 0.095, 0.108, 0.100, 0.090, 2.4],
    [-0.010, 0.100, 0.118, 0.110, 0.060, 2.5], [0.060, 0.100, 0.110, 0.095, 0.035, 2.4], [0.100, 0.100, 0.085, 0.060, 0.018, 2.2],
  ], { n: 20 }), shell));
  for (const s of [-1, 1]) {
    g.add(mesh(cbox(0.016, 0.10, 0.08, 0.02), shell, s * 0.112, 0.020, -0.010));
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 8).rotateZ(Math.PI / 2), steel, s * 0.121, 0.040, 0.02));
    g.add(mesh(cbox(0.006, 0.07, 0.012, 0.002), trim, s * 0.105, -0.045, 0.030, 0.3));   // chin strap
  }
  // short peak
  g.add(mesh(cbox(0.13, 0.008, 0.05, 0.004), shell, 0, 0.115, 0.118, -0.25));
  // goggles: strap band round the shell, two round lenses in steel rims over the eyes
  g.add(mesh(new THREE.TorusGeometry(0.113, 0.009, 4, 24).rotateX(Math.PI / 2).scale(1, 1, 1.05), trim, 0, 0.068, 0));
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.CylinderGeometry(0.032, 0.030, 0.026, 14).rotateX(Math.PI / 2), steel, s * 0.040, 0.066, 0.100, 0, s * 0.25));
    g.add(mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 14).rotateX(Math.PI / 2), lens, s * 0.042, 0.066, 0.114, 0, s * 0.25));
  }
  g.add(mesh(cbox(0.02, 0.012, 0.012, 0.003), steel, 0, 0.064, 0.108));                  // bridge

  return finish(g, 'head', k);
}
