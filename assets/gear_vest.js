// Padded race vest with an aero back hump -- a rider cosmetic for the TORSO joint.
//
// From the Atlas gear sheet (reference only): a padded leather vest over the jacket,
// quilted panels, a zip line, contrast side panels and the racer's hump behind the
// neck. It is an over-shell, sized a little larger than the jacket box in assets/rider.js
// so it covers it at any lean without the jacket's corners poking through.
//
// Torso-joint frame, default body, sized by spec torsoW / torsoD / trunk.
// opts: { spec, leather, accent }
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
  const hide = leatherMat(opts.leather ?? 0x1f2b3a);
  const accent = leatherMat(opts.accent ?? 0xd4622a);
  const trim = flatMat(0x1a1d20);
  const steel = steelMat();
  const g = new THREE.Group();
  // superellipse p = 6 at 1.12 x the jacket half-sizes contains the jacket box's corners
  const a = tW * 0.56, b = tD * 0.58;
  // shell lofted UP the trunk (axis 'y'; sections in x, z)
  g.add(mesh(loft([
    [trunk * 0.08, 0, a * 0.98, b * 0.98, b * 0.98, 6],
    [trunk * 0.40, 0, a, b, b, 6],
    [trunk * 0.78, 0, a * 1.02, b, b * 1.02, 6],
    [trunk * 0.90, 0, a * 0.90, b * 0.92, b * 0.95, 5],
  ], { axis: 'y', n: 24 }), hide));
  // quilting: horizontal welts front and back
  for (let i = 0; i < 4; i++) {
    const y = trunk * (0.18 + i * 0.16);
    for (const s of [-1, 1]) g.add(mesh(cbox(a * 1.5, 0.010, 0.012, 0.003), trim, 0, y, s * (b + 0.004)));
  }
  // contrast side panels
  for (const s of [-1, 1]) g.add(mesh(cbox(0.012, trunk * 0.62, b * 1.1, 0.01), accent, s * (a + 0.004), trunk * 0.46, 0));
  // zip line and pull
  g.add(mesh(cbox(0.012, trunk * 0.78, 0.008, 0.003), steel, 0, trunk * 0.48, b + 0.006));
  g.add(mesh(cbox(0.018, 0.03, 0.01, 0.004), steel, 0, trunk * 0.84, b + 0.01));
  // aero hump behind the neck
  g.add(mesh(loft([
    [trunk * 0.55, -b + 0.01, 0.06, 0.02, 0.01, 2.2], [trunk * 0.70, -b, 0.09, 0.03, 0.06, 2.4],
    [trunk * 0.86, -b, 0.10, 0.03, 0.09, 2.6], [trunk * 0.98, -b + 0.01, 0.06, 0.03, 0.05, 2.2],
  ], { axis: 'y', n: 16 }), hide));
  g.add(mesh(cbox(0.03, 0.16, 0.012, 0.004), accent, 0, trunk * 0.80, -b - 0.085, 0.12));

  return finish(g, 'torso', 1);
}
