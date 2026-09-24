// Leather rucksack -- a rider cosmetic for the TORSO joint.
//
// From the Atlas gear sheet (reference only): a flap-top leather pack with two buckled
// straps, twin side pockets, shoulder straps over the collar, a rolled blanket strapped
// on top. The shape that reads from the chase camera is the box on the back and the
// roll across the top; the buckles are for the close-ups.
//
// Built in the rider's TORSO-joint frame (assets/rider.js: origin at the torso pivot,
// +Y up the trunk, +Z forward; the jacket box is torsoW x trunk*0.91 x torsoD centred at
// y = trunk*0.5) at the default body, sized to the spec's trunk and torso depth.
// opts: { spec, leather, strap, roll }
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
  const trunk = spec.trunk || 0.504, tD = spec.torsoD || 0.26, tW = spec.torsoW || 0.34;
  const hide = leatherMat(opts.leather ?? 0x6b4a2e);
  const strap = leatherMat(opts.strap ?? 0x2a1f18);
  const roll = flatMat(opts.roll ?? 0x4a5a3a);
  const steel = steelMat();
  const g = new THREE.Group();
  const back = -tD / 2;               // the jacket's back face
  const cy = trunk * 0.55;

  // body of the pack: lofted along Z (away from the back), rounded box
  g.add(mesh(loft([
    [back - 0.14, cy, 0.105, 0.14, 0.15, 3.2], [back - 0.10, cy, 0.125, 0.16, 0.16, 3.6], [back - 0.005, cy, 0.125, 0.16, 0.16, 3.6],
  ], { n: 16 }), hide));
  // flap over the top and down the back, with two strap-and-buckle runs
  g.add(mesh(cbox(0.23, 0.13, 0.02, 0.02), hide, 0, cy + 0.10, back - 0.145, -0.08));
  g.add(mesh(cbox(0.23, 0.02, 0.13, 0.01), hide, 0, cy + 0.165, back - 0.07));
  for (const s of [-1, 1]) {
    g.add(mesh(cbox(0.028, 0.20, 0.012, 0.004), strap, s * 0.06, cy + 0.03, back - 0.152));
    g.add(mesh(cbox(0.036, 0.024, 0.008, 0.003), steel, s * 0.06, cy - 0.02, back - 0.160));
    // side pocket
    g.add(mesh(loft([[back - 0.12, cy - 0.06, 0.03, 0.06, 0.06, 3], [back - 0.02, cy - 0.06, 0.03, 0.06, 0.06, 3]], { n: 12 }), hide));
    g.children[g.children.length - 1].position.x = s * 0.14;
    // shoulder straps: up the back, over the shoulder, down the chest
    g.add(mesh(cbox(0.04, 0.012, 0.16, 0.004), strap, s * tW * 0.30, trunk * 1.02, 0.0));
    g.add(mesh(cbox(0.04, trunk * 0.45, 0.012, 0.004), strap, s * tW * 0.30, trunk * 0.78, tD / 2 + 0.008, 0.05));
    g.add(mesh(cbox(0.04, trunk * 0.40, 0.012, 0.004), strap, s * tW * 0.30, trunk * 0.80, back - 0.004));
  }
  // bedroll across the top, strapped on
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 10).rotateZ(Math.PI / 2), roll, 0, cy + 0.22, back - 0.07));
  for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.058, 0.007, 4, 12).rotateY(Math.PI / 2), strap, s * 0.11, cy + 0.22, back - 0.07));

  return finish(g, 'torso', 1);
}
