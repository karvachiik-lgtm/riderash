// RideRash motorcycles, built to the 404 asset contract, one builder for all four classes.
//
// FILE LAYOUT. assets/bike.js is the source. assets/bike_naked.js,
// assets/bike_super.js and assets/bike_muscle.js are exact copies of it that differ only
// in the `KIND` line just below. The contract forbids imports, so a shared kit cannot live
// in a module of its own, and duplicating the file is the price of that. Edit bike.js,
// then regenerate the copies from the repo root with:
//
//   for k in naked super muscle; do sed "s/^const KIND = 'sport';/const KIND = '$k';/" \
//     assets/bike.js > assets/bike_$k.js; done
//
// THE FOUR CLASSES (Road Rash had Rat / Sport / Superbike tiers, and a pack that was
// six copies of one bike could not show them):
//   sport  : 1990s sport-tourer. Frame-mounted full fairing, twin round lamps, tall screen,
//            inline four, four headers into one muffler, twin shocks. The hero, the default.
//   naked  : standard or "rat" bike. Round lamp bucket on the forks, no fairing, air-cooled
//            finned inline four, 4-into-2 upswept megaphones, wire wheels, tube cradle frame.
//   super  : race replica. Sharp low fairing with a bubble screen, slit lamps, alloy
//            twin-spar frame, gold upside-down forks, 3-spoke wheels, braced swingarm,
//            monoshock, tail-up solo cowl and a high can.
//   muscle : power cruiser, the heavy one. V4 with finned barrels, big scooped tank, small
//            headlight cowl, drag bars, fat rear tyre, stacked twin pipes on the right.
// The Atlas concept images these were drawn from are kept outside the game, as the
// contract requires (reference only, never loaded).
//
// THE INVARIANTS SHARED BY EVERY CLASS. The rider's IK, the seat socket and the camera
// were all measured against the original bike, so every class keeps them:
//   - wheelbase 1.40, wheel centres at (0, 0.31, +/-0.70), tyres touching y = 0,
//     overall length 2.02 (the tyres), width set by the bars at +/-0.31;
//   - contacts: saddle top y 0.875 from z -0.06 to -0.50, grips (+/-0.25, 1.04, 0.40),
//     pegs (+/-0.20, 0.44, -0.24);
//   - the joint map { frontSteer, frontWheel, rearWheel, swing, bars, fairing } and the
//     steering pivot at (0, 0.74, 0.50);
//   - the SPORT bike's native height is 1.396 (screen top). main.js scales the hero by
//     1.25 / nativeHeight and CFG.SEAT_* are in those units, so the hero must not grow.
//     The other classes are loaded at the hero's scale, not at their own height.
//   - NO recentring shift. The old builder recentred on its measured bounding box, which is
//     harmless while nothing moves but would slide the saddle every time a part was added
//     at one end. Geometry is authored in the final frame instead: symmetric about x = 0,
//     tyres at y = 0, wheel centres at z = +/-0.70.
//
// DRAW CALLS ARE SET BY MATERIAL CLASSES, NOT BY PART COUNT. The game merges each node's
// direct meshes with vertex colours (assetlib.mergeJoints, vertexColors: true), so all
// parts sharing roughness / metalness / clearcoat collapse into ONE draw per node whatever
// their colour. Five classes are used (paint, metal, chrome, rubber, lens) and meshes live
// in four nodes (chassis, frontSteer, front wheel, rear wheel), so a bike costs at most
// about 20 draws however much detail is added. Adding a sixth material class, or a new
// node with meshes, is what would cost draws. Triangles are the cheaper budget here.
//
// LIVERY. Body paint is tagged `material.userData.livery = 'body'` and the secondary
// colour `'accent'`, so rivals/cops can recolour exactly those and nothing else (the old
// rule was a list of hex codes to skip, which silently painted any new colour).
//
// Real metres. Base at y = 0, centred on x and z, front faces +Z.
const KIND = 'muscle';

export default function (THREE) {
  const opts = arguments[1] || {};
  const kind = opts.kind || KIND;
  const g = new THREE.Group();
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const ZERO = V3(0, 0, 0), UP = V3(0, 1, 0), XAX = V3(1, 0, 0);
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- materials
  const DEFAULT_BODY = { sport: 0xc4442a, naked: 0x9a3b28, super: 0x2f6f8f, muscle: 0xb8912e };
  const DEFAULT_ACCENT = { sport: 0xd8d2c4, naked: 0x1b1b1e, super: 0xd8d2c4, muscle: 0x17191b };
  const bodyColor = opts.bodyColor ?? DEFAULT_BODY[kind] ?? 0xc4442a;
  const accentColor = opts.accentColor ?? DEFAULT_ACCENT[kind] ?? 0xd8d2c4;

  const CLASS = {
    // clearcoat over colour: the sharp highlight on top of a softer base is what reads as
    // paint rather than plastic. Gloss-black frame parts share the class so they merge.
    paint:  (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.32, metalness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.05 }),
    // cast and machined metal: engine cases, fins, forks, swingarm, headers, brackets
    metal:  (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0.86, clearcoat: 0.2, clearcoatRoughness: 0.18 }),
    // polished: mirrors the Atlas sky through the PMREM
    chrome: (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.10, metalness: 1.0, clearcoat: 0, clearcoatRoughness: 0 }),
    // tyres, seat, grips, hoses. main.js finds this by its hex (0x1b1b1e) for a matte
    // environment response, and the merge keeps that colour as its own material.
    rubber: (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.74, metalness: 0.10 }),
    // lamp lenses, indicators, screen tint, gauge faces
    lens:   (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.08, metalness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.02 }),
  };
  const NAME = { paint: 'metal', metal: 'metal', chrome: 'metal', rubber: 'fabric', lens: 'plaster' };
  const matCache = new Map();
  const MAT = (cls, hex, livery) => {
    const k = cls + ':' + hex + ':' + (livery || '');
    if (matCache.has(k)) return matCache.get(k);
    const m = CLASS[cls](hex);
    m.name = NAME[cls];
    if (livery) m.userData.livery = livery;
    matCache.set(k, m);
    return m;
  };
  const paint   = MAT('paint', bodyColor, 'body');
  const accent  = MAT('paint', accentColor, 'accent');
  const black   = MAT('paint', 0x17191b);          // gloss black frame, covers
  const alloy   = MAT('metal', 0x7d838a);          // cast alloy cases, swingarm
  const steel   = MAT('metal', 0x8a9199);          // bright steel brackets, pegs
  const iron    = MAT('metal', 0x2e3033);          // black cast barrels, calipers
  const heat    = MAT('metal', 0x8a6a4e);          // heat-blued headers
  const gold    = MAT('metal', 0xa8873a);          // USD fork tubes, calipers on the super
  const chrome  = MAT('chrome', 0xb9c0c7);
  const rubber  = MAT('rubber', 0x1b1b1e);
  const lamp    = MAT('lens', 0xe8e2d2);
  const amber   = MAT('lens', 0xd4622a);
  const red     = MAT('lens', 0xa8231c);
  const tint    = MAT('lens', 0x2b3238);           // screen, gauge glass

  // ------------------------------------------------------------------- nodes
  // Every part is AUTHORED IN BIKE COORDINATES and converted into its parent's frame
  // here. At rest every parent is a pure translation, so the conversion is a subtraction;
  // doing it in one place is what lets the fork be written where the fork actually is.
  const ORG = new Map();
  ORG.set(g, ZERO);
  const org = (p) => ORG.get(p) || ZERO;
  const node = (parent, x, y, z) => {
    const n = new THREE.Group();
    const o = org(parent);
    n.position.set(x - o.x, y - o.y, z - o.z);
    ORG.set(n, V3(x, y, z));
    parent.add(n);
    return n;
  };
  const mesh = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const put = (parent, geo, mat, x, y, z, rx, ry, rz) => {
    const m = mesh(geo, mat);
    const o = org(parent);
    m.position.set(x - o.x, y - o.y, z - o.z);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  };
  const mirror = (fn) => { fn(-1); fn(1); };

  // --------------------------------------------------------------- geometry kit
  // Chamfered box: an octagonal section extruded along Z. Hard chamfered edges are the
  // locked style, and they catch a highlight a plain box never does.
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
  // Place a Z-aligned geometry so it spans a -> b (bike coordinates). `up` fixes the roll:
  // the geometry's local X ends up along up x dir.
  const along = (parent, geo, mat, a, b, up) => {
    const m = mesh(geo, mat);
    const o = org(parent);
    m.position.copy(a).add(b).multiplyScalar(0.5).sub(o);
    const dir = b.clone().sub(a).normalize();
    const u = up || (Math.abs(dir.y) > 0.92 ? XAX : UP);
    const M = new THREE.Matrix4().lookAt(b, a, u);
    m.quaternion.setFromRotationMatrix(M);
    parent.add(m);
    return m;
  };
  // Same, but centred on c with its Z axis along dir.
  const orient = (parent, geo, mat, c, dir, up) => along(parent, geo, mat,
    c.clone().addScaledVector(dir, -0.01), c.clone().addScaledVector(dir, 0.01), up);
  const rodGeo = (r0, r1, len, seg) => new THREE.CylinderGeometry(r1, r0, len, seg || 8).rotateX(Math.PI / 2);
  const rod = (parent, a, b, r, mat, seg, r1) => along(parent, rodGeo(r, r1 ?? r, a.distanceTo(b), seg), mat, a, b);
  const beam = (parent, a, b, w, h, mat, ch, up) => along(parent, cbox(w, h, a.distanceTo(b), ch), mat, a, b, up);
  // Tube along a smooth curve through bike-coordinate points.
  const tube = (parent, pts, r, mat, seg, rad, closed) => {
    const o = org(parent);
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => V3(p[0] - o.x, p[1] - o.y, p[2] - o.z)), !!closed);
    const m = mesh(new THREE.TubeGeometry(curve, seg || 24, r, rad || 8, !!closed), mat);
    parent.add(m);
    return m;
  };
  // Lathe about the bike's X axis (wheels, covers, lamp shells facing sideways) or Z axis
  // (lamps facing forward, mufflers). Profile is [[radius, axial], ...].
  const latheGeo = (prof, seg, axis) => {
    const geo = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), seg || 24);
    if (axis === 'x') geo.rotateZ(-Math.PI / 2);
    else if (axis === 'z') geo.rotateX(Math.PI / 2);
    return geo;
  };
  // Side-profile slab: a polygon drawn in (z, y) as seen from the right, extruded across X.
  // `bevel` rounds the edges and GROWS the outline by that much (traps.md), so profiles
  // are drawn that much inside the intended surface. `taper` narrows the slab toward one
  // end: [zFrom, zTo, scaleAtZTo]. Scaling x linearly in z keeps every cap face planar.
  const side = (pts, width, bevel, taper) => {
    const s = new THREE.Shape();
    pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    s.closePath();
    const bv = bevel || 0;
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: width, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: 4,
    });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(-Math.PI / 2);        // (u, v, depth) -> (z = u, y = v, x = -depth)
    if (taper) {
      const [z0, z1, s1] = taper;
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = Math.min(1, Math.max(0, (p.getZ(i) - z0) / (z1 - z0)));
        p.setX(i, p.getX(i) * (1 + (s1 - 1) * t));
      }
      geo.computeVertexNormals();
    }
    return geo;
  };
  // LOFT: the tool that makes bodywork look sculpted instead of cut from sheet. A run of
  // cross-sections (stations) joined into a closed skin. Each station is
  //   [c, v, a, ht, hb, p]  -- position along the loft axis, section centre, half-width,
  //                            height above / below the centre, superellipse exponent
  // (p = 2 ellipse, 3-4 a rounded box, <2 a diamond). Axis 'z' runs fore-aft with sections
  // in (x, y); axis 'y' runs upward with sections in (x, z). Stations must be in increasing
  // c. `flat` gives faceted normals -- the locked style's hard low-poly facets.
  // `section(st, t)` overrides the section shape (t in [0, 1)).
  const FLAT = opts.flat ?? true;
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
    const P = (u, v, w) => (axis === 'y' ? pos.push(u, w, v) : pos.push(u, v, w));
    st.forEach((s) => { for (let j = 0; j < n; j++) { const [u, v] = sec(s, j / n); P(u, v, s[0]); } });
    const flip = axis === 'y';
    const tri = (a, b, c) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
    for (let i = 0; i < st.length - 1; i++) {
      for (let j = 0; j < n; j++) {
        const a = i * n + j, b = i * n + ((j + 1) % n), c = a + n, d = b + n;
        tri(a, b, c); tri(b, d, c);
      }
    }
    if (o.caps !== false) {
      const cap = (i, end) => {
        let su = 0, sv = 0;
        for (let j = 0; j < n; j++) { const [u, v] = sec(st[i], j / n); su += u; sv += v; }
        const ci = pos.length / 3; P(su / n, sv / n, st[i][0]);
        for (let j = 0; j < n; j++) {
          const a = i * n + j, b = i * n + ((j + 1) % n);
          end ? tri(ci, a, b) : tri(ci, b, a);
        }
      };
      cap(0, false); cap(st.length - 1, true);
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    if (o.flat ?? FLAT) geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    return geo;
  };
  const body = (st, mat, o) => put(g, loft(st, o), mat, 0, 0, 0);
  // Crescent section for screens: a thin arc bulging toward +v, `thick` deep.
  const crescent = (thick) => (s, t) => {
    const half = t < 0.5, k = half ? t * 2 : (t - 0.5) * 2;
    const x = half ? -s[2] + 2 * s[2] * k : s[2] - 2 * s[2] * k;
    const bulge = s[3] * (1 - (x / s[2]) ** 2);
    return [x, s[1] + bulge - (half ? 0 : thick)];
  };

  // Thin panel in (z, y) at a given x (for fairing sides, side covers).
  const panel = (parent, pts, x, thick, mat, bevel, toe) => {
    const m = put(parent, side(pts, thick, bevel || 0), mat, x, 0, 0, 0, toe || 0, 0);
    return m;
  };
  // Coil spring between two points (a helix swept as a tube).
  const spring = (parent, a, b, R, r, turns, mat) => {
    const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
    const u = Math.abs(dir.y) > 0.9 ? XAX.clone() : UP.clone();
    const e1 = u.clone().cross(dir).normalize(), e2 = dir.clone().cross(e1).normalize();
    const pts = [];
    const N = Math.round(turns * 10);
    for (let i = 0; i <= N; i++) {
      const t = i / N, ang = t * turns * TAU;
      const p = a.clone().addScaledVector(dir, t * len)
        .addScaledVector(e1, Math.cos(ang) * R).addScaledVector(e2, Math.sin(ang) * R);
      pts.push([p.x, p.y, p.z]);
    }
    return tube(parent, pts, r, mat, N, 5);
  };
  // Toothed ring (sprockets), extruded star with a lightening hole, axis along X.
  const sprocketGeo = (R, teeth, t) => {
    const s = new THREE.Shape();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * TAU, r = i % 2 ? R * 0.9 : R;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, R * 0.45, 0, TAU, true);
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 10 });
    geo.translate(0, 0, -t / 2);
    geo.rotateY(Math.PI / 2);
    return geo;
  };

  // ------------------------------------------------------------------- wheels
  const WR = 0.31;
  // o: { w: tyre width, rimR, spokes, spokeMat, rimMat, discs: [x...], discR, discMat,
  //      sprocketX, sprocketR }
  const wheel = (parent, c, o) => {
    const W = node(parent, c.x, c.y, c.z);
    const w = o.w, rr = o.rimR, h = WR - rr;
    // Tyre: a squared-off lathe section, not a torus -- a torus is round like a bicycle
    // tyre, and a motorcycle tyre's flat sidewall and crown are its silhouette.
    const tyre = [
      [rr + 0.004, -w * 0.40], [rr + h * 0.30, -w * 0.50], [rr + h * 0.72, -w * 0.49],
      [WR - h * 0.12, -w * 0.40], [WR - h * 0.02, -w * 0.22], [WR, 0],
      [WR - h * 0.02, w * 0.22], [WR - h * 0.12, w * 0.40], [rr + h * 0.72, w * 0.49],
      [rr + h * 0.30, w * 0.50], [rr + 0.004, w * 0.40],
    ];
    put(W, latheGeo(tyre, 40, 'x'), rubber, c.x, c.y, c.z);
    // sidewall bead ring: a slightly raised band where the rim meets the rubber
    const rimMat = o.rimMat || alloy;
    const rim = [
      [rr - 0.022, w * 0.34], [rr + 0.010, w * 0.42], [rr + 0.012, w * 0.36], [rr - 0.004, w * 0.30],
      [rr - 0.004, -w * 0.30], [rr + 0.012, -w * 0.36], [rr + 0.010, -w * 0.42], [rr - 0.022, -w * 0.34],
      [rr - 0.022, w * 0.34],
    ];
    put(W, latheGeo(rim, 36, 'x'), rimMat, c.x, c.y, c.z);
    // hub and axle
    put(W, rodGeo(0.05, 0.05, w * 0.78, 14).rotateY(Math.PI / 2), o.spokeMat || alloy, c.x, c.y, c.z);
    mirror((s) => put(W, rodGeo(0.022, 0.022, 0.02, 6).rotateY(Math.PI / 2), chrome, c.x + s * (w * 0.39 + 0.012), c.y, c.z));
    // spokes
    const P = (r, a, x) => V3(c.x + (x || 0), c.y + r * Math.cos(a), c.z + r * Math.sin(a));
    const tang = (a) => V3(0, -Math.sin(a), Math.cos(a));
    const sm = o.spokeMat || rimMat;
    const rIn = 0.045, rOut = rr - 0.012;
    if (o.spokes === 'wire') {
      // 40 laced spokes, alternate flanges, crossing tangentially: what makes a wire
      // wheel read as a wire wheel even at speed is the moire of the crossings.
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU, s = i % 2 ? 1 : -1, cross = (i % 4 < 2 ? 1 : -1) * 0.38;
        rod(W, P(0.05, a, s * w * 0.28), P(rOut, a + cross, s * w * 0.06), 0.0028, chrome, 3);
      }
      mirror((s) => put(W, rodGeo(0.06, 0.06, 0.012, 16).rotateY(Math.PI / 2), alloy, c.x + s * w * 0.28, c.y, c.z));
    } else if (o.spokes === 'cast3') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.3;
        const split = rr * 0.42;
        beam(W, P(rIn, a), P(split, a), w * 0.36, 0.05, sm, 0.01, tang(a));
        for (const d of [-0.33, 0.33]) beam(W, P(split - 0.01, a), P(rOut, a + d), w * 0.30, 0.03, sm, 0.008, tang(a + d));
      }
    } else if (o.spokes === 'cast10') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        beam(W, P(rIn, a), P(rOut, a), w * 0.34, 0.03, sm, 0.008, tang(a));
      }
    } else {
      // cast5: five twin spokes
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        for (const d of [-0.11, 0.11]) beam(W, P(rIn, a), P(rOut, a + d * 1.4), w * 0.32, 0.024, sm, 0.007, tang(a));
      }
    }
    // brake discs: bright ring, drilled holes, alloy carrier with bolts
    for (const dx of o.discs || []) {
      const R = o.discR || 0.15;
      put(W, rodGeo(R, R, 0.006, 40).rotateY(Math.PI / 2), o.discMat || chrome, c.x + dx, c.y, c.z);
      put(W, rodGeo(R * 0.62, R * 0.62, 0.012, 20).rotateY(Math.PI / 2), alloy, c.x + dx - Math.sign(dx) * 0.003, c.y, c.z);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        put(W, rodGeo(0.0065, 0.0065, 0.009, 5).rotateY(Math.PI / 2), rubber, c.x + dx, c.y + Math.cos(a) * R * 0.82, c.z + Math.sin(a) * R * 0.82);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.3;
        put(W, rodGeo(0.008, 0.008, 0.016, 6).rotateY(Math.PI / 2), chrome, c.x + dx, c.y + Math.cos(a) * R * 0.55, c.z + Math.sin(a) * R * 0.55);
      }
    }
    if (o.sprocketX) {
      put(W, sprocketGeo(o.sprocketR || 0.10, 38, 0.008), steel, c.x + o.sprocketX, c.y, c.z);
    }
    return W;
  };

  // --------------------------------------------------------- shared structure
  const F = V3(0, WR, 0.70), R = V3(0, WR, -0.70);
  const frontSteer = node(g, 0, 0.74, 0.50);
  const fairing = node(frontSteer, 0, 1.04, 0.60);   // joint kept for the contract
  const bars = node(frontSteer, 0, 1.04, 0.40);      // joint kept for the contract
  const swing = node(g, 0, 0.46, -0.16);             // pivot; carries the rear wheel

  // Fork geometry: raked 24 degrees, legs at +/- forkX.
  const RAKE = 0.42;
  const fd = V3(0, Math.cos(RAKE), -Math.sin(RAKE));
  const onFork = (t, x) => F.clone().addScaledVector(fd, t).add(V3(x || 0, 0, 0));

  // Telescopic or upside-down forks, clamps, axle, calipers.
  const forks = (o) => {
    const fx = o.forkX || 0.10;
    mirror((s) => {
      if (o.usd) {
        rod(frontSteer, onFork(0.03, s * fx), onFork(0.30, s * fx), 0.020, chrome, 12);   // thin stanchion at the bottom
        rod(frontSteer, onFork(0.26, s * fx), onFork(0.64, s * fx), 0.036, gold, 14);     // fat outer tube at the top
        rod(frontSteer, onFork(0.24, s * fx), onFork(0.29, s * fx), 0.039, iron, 14);     // seal collar
        put(frontSteer, cbox(0.05, 0.07, 0.07, 0.012), iron, s * fx, F.y + 0.01, F.z - 0.01); // axle foot
      } else {
        rod(frontSteer, onFork(0.02, s * fx), onFork(0.28, s * fx), 0.034, o.sliderMat || alloy, 12); // slider
        rod(frontSteer, onFork(0.27, s * fx), onFork(0.30, s * fx), 0.036, rubber, 12);              // dust seal
        rod(frontSteer, onFork(0.28, s * fx), onFork(0.64, s * fx), 0.024, chrome, 12);              // stanchion
        if (o.gaiters) rod(frontSteer, onFork(0.28, s * fx), onFork(0.44, s * fx), 0.032, rubber, 10);
      }
      // brake caliper, trailing the fork leg, straddling the disc rim
      const cal = cbox(0.04, 0.075, 0.10, 0.012);
      put(frontSteer, cal, o.caliperMat || iron, s * (o.discX || 0.075), F.y + 0.105, F.z - 0.085, -0.95, 0, 0);
    });
    // axle
    put(frontSteer, rodGeo(0.014, 0.014, fx * 2 + 0.06, 8).rotateY(Math.PI / 2), steel, 0, F.y, F.z);
    // lower and upper triple clamps
    const lc = onFork(0.47), tc = onFork(0.62);
    put(frontSteer, cbox(fx * 2 + 0.09, 0.045, 0.10, 0.015), o.clampMat || black, 0, lc.y, lc.z - 0.02, -RAKE + 0.0, 0, 0);
    put(frontSteer, cbox(fx * 2 + 0.08, 0.030, 0.11, 0.012), o.clampMat || alloy, 0, tc.y, tc.z - 0.02, -RAKE, 0, 0);
    put(frontSteer, rodGeo(0.022, 0.022, 0.02, 10).rotateX(Math.PI / 2), chrome, 0, tc.y + 0.02, tc.z - 0.04); // stem nut
  };

  // Front mudguard as a chunky arc of chamfered segments that follows the tyre.
  const fender = (parent, c, R0, a0, a1, n, w, mat, thick) => {
    for (let i = 0; i < n; i++) {
      const aa = a0 + (a1 - a0) * (i / n), ab = a0 + (a1 - a0) * ((i + 1) / n);
      const pa = V3(c.x, c.y + R0 * Math.sin(aa), c.z + R0 * Math.cos(aa));
      const pb = V3(c.x, c.y + R0 * Math.sin(ab), c.z + R0 * Math.cos(ab));
      const am = (aa + ab) / 2;
      beam(parent, pa, pb, w, thick || 0.02, mat, 0.008, V3(0, Math.sin(am), Math.cos(am)));
    }
  };

  // Handlebar from the top clamp to the grips; grips at the contract point.
  const GRIP = V3(0.25, 1.04, 0.40);
  const handlebars = (o) => {
    const tc = onFork(0.62);
    mirror((s) => {
      const clamp = V3(s * 0.07, tc.y + 0.02, tc.z - 0.02);
      const pts = o.path(s, clamp);
      tube(frontSteer, pts, 0.011, o.barMat || chrome, 16, 8);
      // grip, bar-end weight, lever, switch pod, master cylinder / clutch perch
      rod(frontSteer, V3(s * 0.19, GRIP.y, GRIP.z), V3(s * 0.31, GRIP.y, GRIP.z), 0.017, rubber, 10);
      rod(frontSteer, V3(s * 0.31, GRIP.y, GRIP.z), V3(s * 0.33, GRIP.y, GRIP.z), 0.014, chrome, 8);
      put(frontSteer, cbox(0.035, 0.03, 0.04, 0.008), black, s * 0.17, GRIP.y + 0.01, GRIP.z);
      beam(frontSteer, V3(s * 0.16, GRIP.y + 0.002, GRIP.z + 0.03), V3(s * 0.29, GRIP.y - 0.004, GRIP.z + 0.07), 0.014, 0.008, steel, 0.003);
      put(frontSteer, cbox(0.04, 0.035, 0.045, 0.01), s > 0 ? black : iron, s * 0.13, GRIP.y + 0.035, GRIP.z + 0.01);
      // cable looping from the perch down to the headstock
      tube(frontSteer, [[s * 0.13, GRIP.y + 0.01, GRIP.z + 0.03], [s * 0.10, GRIP.y + 0.06, GRIP.z + 0.12], [s * 0.05, tc.y - 0.02, tc.z + 0.05], [s * 0.03, tc.y - 0.12, tc.z - 0.02]], 0.004, rubber, 12, 4);
    });
  };

  // Round mirrors on stalks (frontSteer when bar-mounted).
  const mirrors = (parent, base, top, R0, shape) => {
    mirror((s) => {
      const b = V3(s * base.x, base.y, base.z), t = V3(s * top.x, top.y, top.z);
      rod(parent, b, t, 0.006, steel, 6);
      if (shape === 'round') {
        put(parent, rodGeo(R0, R0, 0.022, 14), black, t.x, t.y + R0 * 0.6, t.z);
        put(parent, rodGeo(R0 * 0.86, R0 * 0.86, 0.004, 14), chrome, t.x, t.y + R0 * 0.6, t.z - 0.012);
      } else {
        put(parent, cbox(R0 * 2.4, R0 * 1.3, 0.03, 0.012), shape === 'paint' ? paint : black, t.x + s * R0 * 0.5, t.y + R0 * 0.4, t.z, 0, s * 0.15, 0);
        put(parent, cbox(R0 * 2.1, R0 * 1.0, 0.004, 0.01), chrome, t.x + s * R0 * 0.5, t.y + R0 * 0.4, t.z - 0.017, 0, s * 0.15, 0);
      }
    });
  };

  // Round headlamp: chrome shell (lathe), bright lens facing +Z.
  const roundLamp = (parent, x, y, z, r, shellMat) => {
    put(parent, latheGeo([[0.001, -r * 0.9], [r * 0.6, -r * 0.8], [r * 0.95, -r * 0.4], [r * 1.02, 0], [r * 1.04, r * 0.08], [r * 0.9, r * 0.1]], 18, 'z'), shellMat || chrome, x, y, z);
    put(parent, latheGeo([[r * 0.92, 0], [r * 0.7, r * 0.12], [r * 0.35, r * 0.18], [0.001, r * 0.19]], 18, 'z'), lamp, x, y, z + r * 0.05);
  };

  // Rear set: pegs (contract point), hanger plates, levers, pillion pegs.
  const PEG = V3(0.20, 0.44, -0.24);
  const rearsets = (o) => {
    mirror((s) => {
      rod(g, V3(s * 0.15, PEG.y, PEG.z), V3(s * 0.25, PEG.y, PEG.z), 0.014, rubber, 8);
      put(g, cbox(0.012, 0.13, 0.10, 0.02), o.hangerMat || alloy, s * 0.14, PEG.y + 0.05, PEG.z - 0.02, 0.4, 0, 0);
      // heel plate
      put(g, cbox(0.006, 0.07, 0.09, 0.02), alloy, s * 0.155, PEG.y + 0.07, PEG.z - 0.05, 0.3, 0, 0);
      // brake pedal (right) / gear lever (left)
      beam(g, V3(s * 0.165, PEG.y - 0.01, PEG.z + 0.01), V3(s * 0.175, PEG.y - 0.03, PEG.z + 0.18), 0.012, 0.018, steel, 0.004);
      put(g, rodGeo(0.009, 0.009, 0.04, 6).rotateY(Math.PI / 2), rubber, s * 0.19, PEG.y - 0.03, PEG.z + 0.18);
      // pillion peg
      if (o.pillion !== false) rod(g, V3(s * 0.14, 0.53, -0.54), V3(s * 0.21, 0.53, -0.54), 0.011, rubber, 6);
    });
  };

  // Chain drive: countershaft sprocket, closed chain loop, rear sprocket on the wheel.
  const CXD = -0.105, CX = CXD;
  const chain = (fs, rs, cx) => {
    const CX = cx ?? CXD;
    const FS = V3(CX, 0.40, -0.06);
    put(g, sprocketGeo(fs, 15, 0.012), steel, FS.x, FS.y, FS.z);
    const pts = [];
    const loop = (c, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([CX, c.y + r * Math.sin(a), c.z + r * Math.cos(a)]); } };
    loop(FS, fs + 0.006, Math.PI / 2, -Math.PI / 2, 6);                 // over the front of the small sprocket
    loop(R, rs + 0.006, -Math.PI / 2, -Math.PI * 1.5, 12);              // round the back of the rear
    tube(g, pts, 0.007, iron, 60, 4, true);
    // chain guard above the top run
    beam(g, V3(CX - 0.012, 0.47, -0.30), V3(CX - 0.012, 0.44, -0.62), 0.006, 0.05, black, 0.004);
  };

  // Swingarm: box-section arms from the pivot to the axle, adjuster blocks, brace.
  const swingarm = (o) => {
    const sx = o.x || 0.135;
    mirror((s) => {
      const piv = V3(s * sx, 0.46, -0.16), ax = V3(s * sx, R.y, R.z);
      beam(g, piv, ax.clone().add(V3(0, 0, -0.03)), 0.04, o.h || 0.075, o.mat || alloy, 0.012);
      put(g, cbox(0.045, 0.04, 0.05, 0.01), steel, s * sx, R.y, R.z - 0.03);              // adjuster
      put(g, rodGeo(0.03, 0.03, 0.05, 12).rotateY(Math.PI / 2), black, s * sx, 0.46, -0.16); // pivot boss
      if (o.braced) {
        const mid = piv.clone().lerp(ax, 0.5);
        beam(g, piv.clone().add(V3(0, 0.03, -0.02)), mid.clone().add(V3(0, -0.075, 0)), 0.03, 0.03, o.mat || alloy, 0.008);
        beam(g, mid.clone().add(V3(0, -0.075, 0)), ax.clone().add(V3(0, -0.02, 0.06)), 0.03, 0.03, o.mat || alloy, 0.008);
      }
    });
    put(g, rodGeo(0.012, 0.012, sx * 2 + 0.07, 8).rotateY(Math.PI / 2), steel, 0, R.y, R.z);  // axle
    beam(g, V3(-sx, 0.43, -0.34), V3(sx, 0.43, -0.34), 0.03, 0.05, o.mat || alloy, 0.01, UP); // cross brace
    // rear caliper and torque arm on the right
    put(g, cbox(0.035, 0.06, 0.08, 0.01), iron, 0.095, R.y + 0.09, R.z + 0.05, 0.7, 0, 0);
  };

  // Twin shocks: chrome body, spring, eye mounts.
  const twinShocks = (topZ, topY, springMat) => {
    mirror((s) => {
      const a = V3(s * 0.14, R.y + 0.04, R.z + 0.10), b = V3(s * 0.13, topY, topZ);
      rod(g, a, b, 0.014, chrome, 8);
      const d = b.clone().sub(a);
      spring(g, a.clone().addScaledVector(d, 0.2), a.clone().addScaledVector(d, 0.82), 0.026, 0.0055, 7, springMat || black);
      rod(g, a.clone().addScaledVector(d, 0.8), a.clone().addScaledVector(d, 0.98), 0.03, springMat === chrome ? black : chrome, 12);
    });
  };

  // Inline four (sport, super, naked). `air` adds deep cooling fins.
  const inlineFour = (o) => {
    const cm = o.caseMat || alloy, bm = o.blockMat || iron;
    // crankcase, sump
    put(g, cbox(0.36, 0.20, 0.34, 0.05), cm, 0, 0.41, 0.04);
    put(g, cbox(0.26, 0.07, 0.26, 0.02), cm, 0, 0.28, 0.06);
    for (let i = 0; i < 5; i++) put(g, cbox(0.25, 0.012, 0.012, 0.003), cm, 0, 0.255, -0.04 + i * 0.05); // sump ribs
    // clutch cover (right) and alternator cover (left): domed lathes
    put(g, latheGeo([[0.001, 0.036], [0.05, 0.034], [0.085, 0.022], [0.10, 0.0], [0.10, -0.01]], 20, 'x'), o.coverMat || chrome, 0.19, 0.41, -0.02);
    put(g, latheGeo([[0.001, -0.032], [0.045, -0.030], [0.07, -0.018], [0.08, 0.0], [0.08, 0.01]], 18, 'x'), o.coverMat || chrome, -0.19, 0.44, 0.14);
    put(g, cbox(0.02, 0.10, 0.12, 0.03), cm, -0.185, 0.41, -0.07);  // sprocket cover
    // bolt heads around the clutch cover
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; put(g, rodGeo(0.007, 0.007, 0.012, 6).rotateY(Math.PI / 2), steel, 0.225, 0.41 + Math.cos(a) * 0.092, -0.02 + Math.sin(a) * 0.092); }
    // oil filter
    put(g, rodGeo(0.035, 0.035, 0.08, 12).rotateX(-0.9), black, 0, 0.33, 0.24);
    // cylinder block, canted forward, head, cam cover, plug caps
    const tilt = o.tilt ?? 0.40;
    const bd = V3(0, Math.cos(tilt), Math.sin(tilt));
    const base = V3(0, 0.50, 0.10);
    const at = (t) => base.clone().addScaledVector(bd, t);
    along(g, cbox(0.34, 0.20, 0.15, 0.03), bm, at(0), at(0.15), UP);
    if (o.air) {
      for (let i = 0; i < 8; i++) {
        const p = at(0.02 + i * 0.017);
        orient(g, cbox(0.40, 0.23, 0.006, 0.03), i % 2 ? bm : alloy, p, bd, UP);
      }
    } else {
      for (let i = 0; i < 3; i++) orient(g, cbox(0.35, 0.21, 0.008, 0.03), bm, at(0.03 + i * 0.045), bd, UP);
    }
    const hp = at(0.19);
    orient(g, cbox(0.36, 0.20, 0.075, 0.03), cm, hp, bd, UP);
    const cp = at(0.245);
    orient(g, cbox(0.32, 0.17, 0.04, 0.035), o.camMat || black, cp, bd, UP);
    for (let i = 0; i < 4; i++) {
      const px = -0.114 + i * 0.076, p = at(0.27);
      orient(g, rodGeo(0.011, 0.011, 0.035, 6), rubber, V3(px, p.y + 0.01, p.z + 0.01), bd);
    }
    // four throttle bodies / carbs behind the head
    for (let i = 0; i < 4; i++) {
      const px = -0.114 + i * 0.076;
      rod(g, V3(px, 0.64, 0.12), V3(px, 0.68, -0.02), 0.026, o.carbMat || alloy, 10);
    }
    return { port: (i) => V3(-0.114 + i * 0.076, 0.0, 0.0).add(at(0.12)).add(V3(0, -0.06, 0.10)) };
  };

  // Four headers from the ports: down the front of the engine and back underneath.
  const headers = (eng, o) => {
    for (let i = 0; i < 4; i++) {
      const p = eng.port(i), x = p.x;
      const pts = [[x, p.y, p.z], [x * 1.02, p.y - 0.10, p.z + 0.06], [x * 0.95, 0.30, p.z + 0.02],
        [x * 0.8, 0.24, 0.18], [x * 0.55 + o.collX * 0.3, 0.22, 0.00]];
      pts.push(...o.tail(i, x));
      tube(g, pts, 0.019, o.mat || heat, 28, 8);
    }
  };

  // Radiator with a finned core, hoses, and a guard (liquid-cooled classes).
  const radiator = (y, z, w, h, lean) => {
    put(g, cbox(w, h, 0.05, 0.02), black, 0, y, z, -lean, 0, 0);
    for (let i = 0; i < 9; i++) put(g, cbox(w - 0.03, 0.006, 0.012, 0.002), alloy, 0, y - h * 0.40 + i * h * 0.1, z + 0.03 + i * 0.1 * h * Math.sin(lean), -lean, 0, 0);
    put(g, rodGeo(0.03, 0.03, 0.05, 10).rotateX(Math.PI / 2), black, w * 0.3, y + h * 0.5 + 0.02, z - 0.01); // filler neck
    tube(g, [[w * 0.36, y - h * 0.3, z - 0.02], [w * 0.36, y - h * 0.42, z - 0.10], [0.17, 0.44, 0.18]], 0.015, rubber, 10, 6);
  };

  // Tail light, rear indicators, number plate hanger (a plain dark plate, no glyphs).
  const tailLights = (y, z, o) => {
    put(g, cbox(o.w || 0.12, o.h || 0.05, 0.03, 0.012), red, 0, y, z);
    mirror((s) => {
      rod(g, V3(s * 0.06, y - 0.06, z + 0.03), V3(s * 0.15, y - 0.06, z + 0.01), 0.006, black, 6);
      put(g, cbox(0.035, 0.025, 0.045, 0.01), amber, s * 0.16, y - 0.06, z + 0.005);
    });
    beam(g, V3(0, y - 0.04, z + 0.05), V3(0, 0.62, z - 0.02), 0.08, 0.012, black, 0.004, V3(0, 0, 1));
    put(g, cbox(0.20, 0.13, 0.008, 0.012), steel, 0, 0.60, z - 0.035, 0.25, 0, 0);
  };

  // Tank from a side profile, tapered to the rear, with knee pads: the "recess" the rider's
  // knees sit in reads as a darker inset at the tank's rear flank.
  const tank = (prof, width, taper, knee) => {
    put(g, side(prof, width, 0.035, taper), paint, 0, 0, 0);
    if (knee) mirror((s) => put(g, cbox(0.012, knee.h, knee.d, 0.02), rubber, s * knee.x, knee.y, knee.z, 0, s * -0.12, 0));
  };
  const fuelCap = (y, z) => {
    put(g, rodGeo(0.045, 0.045, 0.012, 16).rotateX(-Math.PI / 2), chrome, 0, y, z);
    put(g, rodGeo(0.02, 0.02, 0.012, 10).rotateX(-Math.PI / 2), black, 0, y + 0.01, z);
  };

  // Seat from a side profile: bevel adds 0.02 all round, so the drawn top is 0.855 for a
  // 0.875 saddle (the contract).
  const saddle = (prof, width, taper) => put(g, side(prof, width, 0.02, taper), rubber, 0, 0, 0);

  // Headstock tube along the rake.
  const headstock = (mat) => rod(g, onFork(0.40).add(V3(0, 0, -0.06)), onFork(0.64).add(V3(0, 0, -0.06)), 0.04, mat || black, 12);

  // ------------------------------------------------------------------ classes
  let fW, rW;
  const discX = 0.075;

  if (kind === 'naked') {
    // ============ NAKED / STANDARD: round lamp, air-cooled four, 4-into-2, wire wheels
    fW = wheel(frontSteer, F, { w: 0.115, rimR: 0.215, spokes: 'wire', rimMat: chrome, discs: [-discX, discX], discR: 0.14 });
    rW = wheel(swing, R, { w: 0.14, rimR: 0.215, spokes: 'wire', rimMat: chrome, discs: [0.085], discR: 0.11, sprocketX: CX, sprocketR: 0.10 });
    forks({ forkX: 0.10, gaiters: true, sliderMat: alloy });
    fender(frontSteer, F, WR + 0.035, 0.35, 2.25, 7, 0.12, paint);
    mirror((s) => rod(frontSteer, V3(s * 0.08, F.y + 0.05, F.z - 0.02), V3(s * 0.07, F.y + 0.30, F.z - 0.06), 0.006, steel, 6)); // fender stays
    // headlamp on ears from the fork, gauges on the top clamp
    const hl = onFork(0.55).add(V3(0, 0.0, 0.14));
    roundLamp(frontSteer, 0, hl.y, hl.z, 0.095);
    mirror((s) => beam(frontSteer, onFork(0.50, s * 0.10), V3(s * 0.085, hl.y, hl.z - 0.04), 0.012, 0.03, black, 0.005));
    mirror((s) => { put(frontSteer, cbox(0.03, 0.025, 0.04, 0.008), amber, s * 0.15, hl.y - 0.01, hl.z - 0.05); rod(frontSteer, V3(s * 0.10, hl.y - 0.01, hl.z - 0.06), V3(s * 0.14, hl.y - 0.01, hl.z - 0.05), 0.006, black, 6); });
    const tc = onFork(0.62);
    mirror((s) => {
      orient(frontSteer, rodGeo(0.038, 0.042, 0.06, 14), black, V3(s * 0.055, tc.y + 0.06, tc.z + 0.03), V3(0, 0.75, -0.66));
      orient(frontSteer, rodGeo(0.035, 0.035, 0.005, 14), tint, V3(s * 0.055, tc.y + 0.083, tc.z + 0.005), V3(0, 0.75, -0.66));
    });
    handlebars({ path: (s, c) => [[c.x, c.y, c.z], [s * 0.10, c.y + 0.07, c.z + 0.02], [s * 0.15, GRIP.y - 0.005, GRIP.z + 0.03], [s * 0.20, GRIP.y, GRIP.z]] });
    mirrors(frontSteer, V3(0.16, GRIP.y + 0.03, GRIP.z + 0.01), V3(0.21, 1.17, GRIP.z + 0.03), 0.045, 'round');

    // tubular double cradle
    headstock(black);
    mirror((s) => {
      tube(g, [[s * 0.03, 0.86, 0.40], [s * 0.09, 0.80, 0.22], [s * 0.11, 0.78, -0.04], [s * 0.12, 0.77, -0.20], [s * 0.10, 0.80, -0.62], [s * 0.07, 0.83, -0.82]], 0.017, black, 28, 8);  // top rail + seat rail
      tube(g, [[s * 0.02, 0.76, 0.43], [s * 0.08, 0.50, 0.38], [s * 0.11, 0.26, 0.26], [s * 0.12, 0.23, 0.0], [s * 0.13, 0.36, -0.16], [s * 0.12, 0.62, -0.16], [s * 0.12, 0.77, -0.20]], 0.019, black, 32, 8); // down tube + cradle
      rod(g, V3(s * 0.12, 0.62, -0.18), V3(s * 0.10, 0.80, -0.50), 0.013, black, 6);  // seat stay
    });
    const ENG = inlineFour({ air: true, caseMat: alloy, blockMat: iron, camMat: alloy, tilt: 0.28, carbMat: alloy });

    // tank: big teardrop, rounded, knee pads
    body([
      [-0.06, 0.83, 0.10, 0.045, 0.05, 2.3],
      [0.02, 0.86, 0.14, 0.075, 0.08, 2.4],
      [0.16, 0.875, 0.165, 0.085, 0.10, 2.5],
      [0.30, 0.865, 0.16, 0.08, 0.10, 2.4],
      [0.40, 0.85, 0.12, 0.06, 0.08, 2.2],
    ], paint, { n: 20 });
    mirror((s) => put(g, cbox(0.012, 0.06, 0.11, 0.02), rubber, s * 0.14, 0.85, 0.03, 0, s * -0.2, 0));   // knee pads
    fuelCap(0.985, 0.22);
    mirror((s) => put(g, cbox(0.006, 0.04, 0.14, 0.015), chrome, s * 0.165, 0.87, 0.22, 0, 0, 0)); // tank badge bar (shape, not text)
    // long flat bench to the tail with a chrome grab rail
    body([
      [-0.78, 0.82, 0.105, 0.035, 0.04, 3.5], [-0.74, 0.825, 0.12, 0.05, 0.05, 4],
      [-0.12, 0.825, 0.125, 0.05, 0.05, 4], [-0.03, 0.82, 0.11, 0.045, 0.05, 3.2],
    ], rubber, { n: 20 });
    put(g, loft([[-0.76, 0.795, 0.123, 0.008, 0.008, 3], [-0.06, 0.795, 0.128, 0.008, 0.008, 3]], { n: 12 }), chrome, 0, 0, 0);  // seat trim band
    rod(g, V3(-0.10, 0.86, -0.46), V3(-0.10, 0.86, -0.84), 0.011, chrome, 8);
    rod(g, V3(0.10, 0.86, -0.46), V3(0.10, 0.86, -0.84), 0.011, chrome, 8);
    tube(g, [[-0.10, 0.86, -0.84], [-0.06, 0.87, -0.89], [0.06, 0.87, -0.89], [0.10, 0.86, -0.84]], 0.011, chrome, 10, 8);
    // short tail cowl + round tail lamp
    body([[-0.93, 0.775, 0.07, 0.03, 0.04, 2.6], [-0.86, 0.785, 0.09, 0.04, 0.05, 2.8], [-0.62, 0.765, 0.10, 0.03, 0.05, 2.8]], paint, { n: 16 });
    put(g, rodGeo(0.045, 0.045, 0.03, 16), red, 0, 0.77, -0.93);
    tailLights(0.75, -0.94, { w: 0.02, h: 0.02 });
    fender(g, R, WR + 0.04, 2.2, 3.2, 6, 0.13, paint, 0.015);
    // triangular side covers under the seat, with a louvre strip
    mirror((s) => {
      panel(g, [[-0.05, 0.60], [-0.02, 0.78], [-0.36, 0.78], [-0.30, 0.62]], s * 0.125, 0.025, paint, 0.008);
      for (let i = 0; i < 3; i++) put(g, cbox(0.006, 0.012, 0.13, 0.004), black, s * 0.142, 0.735 - i * 0.03, -0.17, 0, 0, 0);
    });
    // air box / battery box in the frame triangle
    put(g, cbox(0.20, 0.14, 0.18, 0.03), iron, 0, 0.66, -0.20);
    // exhaust: 4-into-2, two upswept megaphones
    headers(ENG, { collX: 0, mat: chrome, tail: (i, x) => {
      const s = x < 0 ? -1 : 1;
      return [[s * 0.15, 0.23, -0.18], [s * 0.17, 0.27, -0.30]];
    } });
    mirror((s) => {
      put(g, latheGeo([[0.03, -0.325], [0.066, -0.32], [0.064, -0.30], [0.058, -0.12], [0.05, 0.18], [0.032, 0.33], [0.001, 0.33]], 16, 'z'), chrome, s * 0.18, 0.37, -0.60, 0.22, 0, 0);
      put(g, cbox(0.02, 0.03, 0.10, 0.008), black, s * 0.16, 0.44, -0.55);   // hanger
    });
    swingarm({ x: 0.13, h: 0.06, mat: black });
    twinShocks(-0.48, 0.80, chrome);
    chain(0.045, 0.10);
    rearsets({ hangerMat: black });
    // side stand, folded
    rod(g, V3(-0.12, 0.30, -0.08), V3(-0.14, 0.22, -0.34), 0.012, black, 6);
  } else if (kind === 'super') {
    // ============ SUPERBIKE: sharp low fairing, beam frame, USD forks, 3-spoke, monoshock
    fW = wheel(frontSteer, F, { w: 0.12, rimR: 0.215, spokes: 'cast3', rimMat: iron, spokeMat: iron, discs: [-discX, discX], discR: 0.16 });
    rW = wheel(swing, R, { w: 0.18, rimR: 0.215, spokes: 'cast3', rimMat: iron, spokeMat: iron, discs: [0.095], discR: 0.105, sprocketX: CX, sprocketR: 0.095 });
    forks({ forkX: 0.10, usd: true, caliperMat: gold, clampMat: alloy, discX });
    fender(frontSteer, F, WR + 0.03, 0.55, 2.05, 5, 0.11, paint);
    handlebars({ barMat: black, path: (s, c) => [[s * 0.10, GRIP.y - 0.02, GRIP.z + 0.03], [s * 0.15, GRIP.y - 0.005, GRIP.z + 0.01], [s * 0.19, GRIP.y, GRIP.z]] });
    mirror((s) => rod(frontSteer, V3(s * 0.10, onFork(0.64).y, onFork(0.64).z), V3(s * 0.10, GRIP.y - 0.02, GRIP.z + 0.03), 0.02, gold, 10)); // clip-on posts

    // twin-spar alloy beam frame, big and visible: the class's signature
    headstock(alloy);
    mirror((s) => {
      beam(g, V3(s * 0.05, 0.84, 0.40), V3(s * 0.17, 0.76, 0.12), 0.05, 0.13, alloy, 0.02);
      beam(g, V3(s * 0.17, 0.76, 0.12), V3(s * 0.165, 0.62, -0.14), 0.05, 0.14, alloy, 0.02);
      put(g, cbox(0.04, 0.26, 0.14, 0.03), alloy, s * 0.16, 0.52, -0.15);                    // pivot plate
      beam(g, V3(s * 0.08, 0.76, -0.12), V3(s * 0.06, 0.86, -0.74), 0.02, 0.03, black, 0.006); // subframe
      beam(g, V3(s * 0.12, 0.56, -0.20), V3(s * 0.06, 0.84, -0.56), 0.018, 0.022, black, 0.005);
    });
    const eng = inlineFour({ caseMat: iron, coverMat: iron, camMat: MAT('paint', 0x6a1f1c), tilt: 0.55 });
    radiator(0.60, 0.34, 0.40, 0.30, 0.25);
    headers(eng, { collX: 0.04, mat: heat, tail: () => [[0.06, 0.19, -0.18], [0.10, 0.28, -0.36]] });
    // high can: tapered hexagon-ish silencer under the tail on the right
    put(g, rodGeo(0.07, 0.06, 0.38, 7).scale(1, 1.25, 1), alloy, 0.15, 0.50, -0.56, 0.34, 0, 0);
    put(g, rodGeo(0.076, 0.076, 0.02, 7).scale(1, 1.25, 1), iron, 0.15, 0.563, -0.739, 0.34, 0, 0);
    put(g, rodGeo(0.03, 0.03, 0.05, 10), chrome, 0.15, 0.571, -0.762, 0.34, 0, 0);
    tube(g, [[0.10, 0.28, -0.36], [0.13, 0.36, -0.40], [0.15, 0.43, -0.42]], 0.028, heat, 8, 8);

    // fairing: sharp nose, twin slit lamps, big side panels with vents, belly pan
    // SHARP y-lofted fairing: lower exponent and fewer facets than the tourer, so it reads
    // as creased and angular. Lower and tighter; the frame beam shows through above it.
    put(g, loft([
      [0.22, 0.18, 0.13, 0.18, 0.20, 2.0],
      [0.28, 0.20, 0.175, 0.19, 0.24, 2.2],
      [0.44, 0.23, 0.20, 0.17, 0.26, 2.4],
      [0.60, 0.30, 0.205, 0.24, 0.24, 2.4],
      [0.76, 0.46, 0.205, 0.40, 0.22, 2.2],
      [0.90, 0.60, 0.19, 0.42, 0.14, 2.0],
      [1.02, 0.66, 0.16, 0.36, 0.14, 1.9],
      [1.10, 0.66, 0.11, 0.26, 0.12, 1.8],
    ], { axis: 'y', n: 14 }), paint, 0, 0, 0);
    mirror((s) => {
      // slit lamps set into the nose flanks, indicators in the mirror pods
      put(g, cbox(0.09, 0.03, 0.03, 0.01), lamp, s * 0.07, 0.975, 1.005, -0.2, s * 0.5, s * 0.2);
      put(g, cbox(0.03, 0.02, 0.02, 0.006), amber, s * 0.19, 0.99, 0.80, 0, 0, 0);
      // colour-split accent flash and vents on the flank
      put(g, side([[0.62, 0.56], [0.50, 0.34], [0.14, 0.26], [0.16, 0.32], [0.50, 0.44]], 0.01, 0.004), accent, s * 0.207, 0, 0);
      for (let i = 0; i < 3; i++) put(g, cbox(0.008, 0.02, 0.14, 0.006), black, s * 0.21, 0.70 - i * 0.045, 0.36 - i * 0.02, 0.35, 0, 0);
    });
    put(g, cbox(0.07, 0.07, 0.04, 0.02), iron, 0, 0.93, 1.00, 0.2, 0, 0);   // ram-air intake between the lamps
    mirrors(g, V3(0.19, 1.00, 0.72), V3(0.25, 1.07, 0.70), 0.04, 'paint');
    // tall bubble screen, lofted upward off the nose
    put(g, loft([[1.07, 0.80, 0.14, 0.05, 0, 0], [1.18, 0.70, 0.14, 0.06, 0, 0], [1.28, 0.58, 0.11, 0.05, 0, 0]], { axis: 'y', n: 18, section: crescent(0.008) }), tint, 0, 0, 0);
    put(g, cbox(0.24, 0.05, 0.09, 0.02), iron, 0, 1.12, 0.52);   // dash
    orient(g, rodGeo(0.035, 0.035, 0.005, 14), tint, V3(-0.04, 1.147, 0.50), V3(0, 0.75, -0.66));
    put(g, cbox(0.06, 0.004, 0.035, 0.005), tint, 0.05, 1.15, 0.52, -0.7, 0, 0);
    // tank: short, high, angular
    body([
      [-0.07, 0.84, 0.12, 0.05, 0.06, 2.0],
      [0.02, 0.88, 0.15, 0.09, 0.09, 2.2],
      [0.18, 0.89, 0.17, 0.11, 0.11, 2.4],
      [0.34, 0.88, 0.16, 0.10, 0.10, 2.2],
      [0.44, 0.86, 0.12, 0.07, 0.08, 2.0],
    ], paint, { n: 14 });
    mirror((s) => put(g, cbox(0.012, 0.07, 0.12, 0.02), rubber, s * 0.14, 0.85, 0.02, 0, s * -0.2, 0));
    put(g, rodGeo(0.035, 0.035, 0.012, 8).rotateX(-Math.PI / 2), alloy, 0, 1.015, 0.23);  // aircraft filler
    // solo seat + tail-up cowl with a hump
    body([[-0.50, 0.82, 0.10, 0.035, 0.04, 3.5], [-0.46, 0.825, 0.12, 0.05, 0.05, 4], [-0.12, 0.825, 0.125, 0.05, 0.05, 4], [-0.03, 0.82, 0.11, 0.045, 0.05, 3.2]], rubber, { n: 20 });
    body([
      [-0.98, 0.94, 0.05, 0.03, 0.04, 1.9],
      [-0.90, 0.93, 0.09, 0.05, 0.07, 2.0],
      [-0.66, 0.89, 0.11, 0.07, 0.11, 2.2],
      [-0.50, 0.84, 0.12, 0.05, 0.12, 2.2],
      [-0.12, 0.76, 0.12, 0.04, 0.08, 2.4],
    ], paint, { n: 14 });
    body([[-0.94, 0.965, 0.05, 0.015, 0.01, 2], [-0.62, 0.945, 0.07, 0.02, 0.01, 2]], accent, { n: 10 });   // cowl hump stripe
    tailLights(0.90, -0.975, { w: 0.10, h: 0.025 });
    // monoshock: central spring and linkage under the seat
    spring(g, V3(0, 0.40, -0.30), V3(0, 0.66, -0.20), 0.032, 0.006, 6, MAT('paint', 0xa8231c));
    rod(g, V3(0, 0.38, -0.31), V3(0, 0.70, -0.19), 0.016, chrome, 10);
    put(g, rodGeo(0.022, 0.022, 0.12, 10).rotateX(1.2), alloy, 0.05, 0.64, -0.26);   // reservoir
    swingarm({ x: 0.14, h: 0.09, braced: true, mat: alloy });
    chain(0.042, 0.095);
    rearsets({ hangerMat: alloy, pillion: false });
    // steering damper
    rod(g, V3(-0.08, 0.84, 0.42), V3(-0.14, 0.80, 0.24), 0.012, gold, 8);
  } else if (kind === 'muscle') {
    // ============ MUSCLE / POWER CRUISER: V4, scooped tank, cowl, drag bars, fat rear
    fW = wheel(frontSteer, F, { w: 0.13, rimR: 0.20, spokes: 'cast10', rimMat: iron, spokeMat: alloy, discs: [-discX - 0.005, discX + 0.005], discR: 0.14 });
    rW = wheel(swing, R, { w: 0.22, rimR: 0.19, spokes: 'cast10', rimMat: iron, spokeMat: alloy, discs: [0.12], discR: 0.11, sprocketX: -0.13, sprocketR: 0.11 });
    forks({ forkX: 0.11, sliderMat: iron, discX: discX + 0.005 });
    fender(frontSteer, F, WR + 0.03, 0.55, 2.2, 5, 0.14, paint);
    const hl = onFork(0.55).add(V3(0, 0.0, 0.14));
    roundLamp(frontSteer, 0, hl.y, hl.z, 0.09, black);
    // bikini cowl over the lamp
    put(frontSteer, loft([
      [hl.z - 0.13, hl.y + 0.03, 0.12, 0.08, 0.07, 2.4], [hl.z - 0.02, hl.y + 0.05, 0.12, 0.09, 0.07, 2.6], [hl.z + 0.07, hl.y + 0.08, 0.09, 0.06, 0.04, 2.2],
    ], { n: 16 }), paint, 0, 0, 0);
    put(frontSteer, cbox(0.16, 0.004, 0.07, 0.01), tint, 0, hl.y + 0.165, hl.z - 0.04, 0.9, 0, 0);
    mirror((s) => { put(frontSteer, cbox(0.035, 0.03, 0.05, 0.01), amber, s * 0.16, hl.y - 0.02, hl.z - 0.04); rod(frontSteer, V3(s * 0.10, hl.y - 0.02, hl.z - 0.06), V3(s * 0.15, hl.y - 0.02, hl.z - 0.04), 0.007, chrome, 6); });
    handlebars({ path: (s, c) => [[c.x, c.y, c.z], [s * 0.07, GRIP.y - 0.01, GRIP.z + 0.04], [s * 0.12, GRIP.y, GRIP.z + 0.01], [s * 0.20, GRIP.y, GRIP.z]] });
    mirror((s) => rod(frontSteer, V3(s * 0.07, onFork(0.62).y + 0.02, onFork(0.62).z - 0.02), V3(s * 0.07, GRIP.y - 0.01, GRIP.z + 0.04), 0.016, chrome, 10)); // risers
    mirrors(frontSteer, V3(0.15, GRIP.y + 0.03, GRIP.z + 0.01), V3(0.23, 1.16, GRIP.z), 0.045, 'round');
    const tc = onFork(0.62);
    orient(frontSteer, rodGeo(0.045, 0.05, 0.05, 16), chrome, V3(0, tc.y + 0.05, tc.z + 0.03), V3(0, 0.75, -0.66));
    orient(frontSteer, rodGeo(0.042, 0.042, 0.005, 16), tint, V3(0, tc.y + 0.07, tc.z + 0.012), V3(0, 0.75, -0.66));

    headstock(black);
    mirror((s) => {
      tube(g, [[s * 0.03, 0.86, 0.40], [s * 0.10, 0.82, 0.18], [s * 0.12, 0.78, -0.10], [s * 0.11, 0.80, -0.60], [s * 0.08, 0.84, -0.80]], 0.02, black, 24, 8);
      tube(g, [[s * 0.02, 0.76, 0.43], [s * 0.10, 0.44, 0.40], [s * 0.13, 0.20, 0.26], [s * 0.14, 0.18, -0.02], [s * 0.14, 0.36, -0.16], [s * 0.12, 0.78, -0.12]], 0.021, black, 30, 8);
    });
    // V4: two banks of two finned barrels, round heads, big covers
    put(g, cbox(0.34, 0.22, 0.46, 0.06), alloy, 0, 0.34, 0.06);
    put(g, latheGeo([[0.001, 0.04], [0.07, 0.038], [0.11, 0.022], [0.125, 0.0], [0.125, -0.01]], 22, 'x'), chrome, 0.17, 0.33, 0.02);
    put(g, latheGeo([[0.001, -0.035], [0.06, -0.033], [0.09, -0.018], [0.10, 0.0], [0.10, 0.01]], 20, 'x'), chrome, -0.17, 0.36, 0.14);
    for (const bank of [{ a: 0.62, z: 0.14 }, { a: -0.62, z: -0.06 }]) {
      const d = V3(0, Math.cos(bank.a), Math.sin(bank.a));
      for (const x of [-0.075, 0.075]) {
        const b0 = V3(x, 0.44, bank.z);
        for (let i = 0; i < 9; i++) {
          const p = b0.clone().addScaledVector(d, 0.02 + i * 0.022), wf = 0.15 - Math.abs(i - 4) * 0.004;
          orient(g, rodGeo(wf * 0.5, wf * 0.5, 0.007, 14), i % 2 ? iron : alloy, p, d);
        }
        const hp = b0.clone().addScaledVector(d, 0.23);
        orient(g, cbox(0.13, 0.13, 0.06, 0.03), alloy, hp, d, UP);
        const cp = b0.clone().addScaledVector(d, 0.275);
        orient(g, rodGeo(0.06, 0.055, 0.03, 12), chrome, cp, d);
      }
    }
    put(g, cbox(0.22, 0.10, 0.12, 0.03), iron, 0, 0.66, 0.04);        // carbs/airbox in the V
    // pushrod-style tube and oil lines
    tube(g, [[0.12, 0.30, 0.26], [0.13, 0.50, 0.30], [0.08, 0.60, 0.30]], 0.008, rubber, 8, 5);
    // exhaust: two headers per side merging into STACKED twin pipes on the right
    const ports = [[-0.075, 0.14, 0.62], [0.075, 0.14, 0.62], [-0.075, -0.06, -0.62], [0.075, -0.06, -0.62]];
    ports.forEach(([x, z, a], i) => {
      const p = V3(x, 0.44, z).addScaledVector(V3(0, Math.cos(a), Math.sin(a)), 0.15).add(V3(0, 0, a > 0 ? 0.07 : -0.07));
      const lower = i % 2 === 0;
      const endY = lower ? 0.22 : 0.33;
      const pts = a > 0
        ? [[p.x, p.y, p.z], [x * 1.1, p.y - 0.12, p.z + 0.08], [0.16, 0.26, 0.30], [0.19, endY, 0.10], [0.20, endY, -0.20]]
        : [[p.x, p.y, p.z], [x + 0.06, p.y - 0.05, p.z - 0.10], [0.16, endY + 0.06, -0.26], [0.20, endY, -0.36]];
      tube(g, pts, 0.024, a > 0 ? heat : chrome, 24, 8);
    });
    for (const y of [0.24, 0.35]) {
      put(g, latheGeo([[0.001, -0.40], [0.04, -0.40], [0.045, 0.38], [0.05, 0.40], [0.035, 0.405]], 14, 'z'), chrome, 0.21, y + 0.03, -0.62, 0.06, 0, 0);
    }
    put(g, cbox(0.03, 0.17, 0.06, 0.01), black, 0.19, 0.33, -0.66);   // pipe hanger
    // tank: big, wide, with side scoops and black grilles
    body([
      [-0.08, 0.84, 0.13, 0.06, 0.07, 2.4],
      [0.02, 0.87, 0.18, 0.10, 0.10, 2.6],
      [0.18, 0.88, 0.20, 0.10, 0.11, 2.8],
      [0.34, 0.87, 0.18, 0.09, 0.10, 2.6],
      [0.44, 0.85, 0.12, 0.06, 0.08, 2.2],
    ], paint, { n: 20 });
    mirror((s) => {
      // fake air scoop on each tank flank, black grille in its mouth
      put(g, loft([[0.06, 0.86, 0.03, 0.05, 0.05, 2.4], [0.26, 0.86, 0.045, 0.07, 0.07, 3], [0.31, 0.86, 0.045, 0.07, 0.07, 3]], { n: 14 }), paint, s * 0.195, 0, 0);
      for (let i = 0; i < 4; i++) put(g, cbox(0.05, 0.01, 0.012, 0.003), black, s * 0.20, 0.82 + i * 0.026, 0.315);
      // side cover with grille under the seat
      panel(g, [[-0.08, 0.58], [-0.06, 0.76], [-0.32, 0.76], [-0.34, 0.60]], s * 0.14, 0.03, paint, 0.01);
      for (let i = 0; i < 4; i++) put(g, cbox(0.008, 0.01, 0.20, 0.003), black, s * 0.162, 0.62 + i * 0.03, -0.20);
    });
    fuelCap(0.99, 0.18);
    // stepped seat: rider at the contract height, pillion raised, pad behind
    body([
      [-0.78, 0.88, 0.10, 0.03, 0.04, 3.2], [-0.74, 0.88, 0.13, 0.03, 0.05, 4], [-0.52, 0.875, 0.13, 0.03, 0.05, 4],
      [-0.46, 0.825, 0.15, 0.05, 0.05, 4], [-0.14, 0.825, 0.15, 0.05, 0.05, 4], [-0.05, 0.82, 0.12, 0.045, 0.05, 3],
    ], rubber, { n: 20 });
    // tail: short ducktail and a big rear fender over the fat tyre
    body([[-0.93, 0.80, 0.09, 0.03, 0.05, 2.6], [-0.80, 0.815, 0.12, 0.04, 0.07, 2.8], [-0.48, 0.79, 0.13, 0.04, 0.07, 2.8]], paint, { n: 16 });
    fender(g, R, WR + 0.04, 1.9, 3.1, 6, 0.24, paint, 0.02);
    tailLights(0.79, -0.93, { w: 0.13, h: 0.04 });
    swingarm({ x: 0.155, h: 0.08, mat: black });
    twinShocks(-0.46, 0.80, chrome);
    chain(0.05, 0.11, -0.13);
    rearsets({ hangerMat: black });
    rod(g, V3(-0.13, 0.28, -0.06), V3(-0.15, 0.20, -0.32), 0.013, black, 6);   // side stand
  } else {
    // ============ SPORT-TOURER (the hero): full frame-mounted fairing, twin round lamps
    fW = wheel(frontSteer, F, { w: 0.12, rimR: 0.215, spokes: 'cast5', rimMat: alloy, discs: [-discX, discX], discR: 0.15 });
    rW = wheel(swing, R, { w: 0.16, rimR: 0.215, spokes: 'cast5', rimMat: alloy, discs: [0.09], discR: 0.11, sprocketX: CX, sprocketR: 0.10 });
    forks({ forkX: 0.10, discX });
    fender(frontSteer, F, WR + 0.03, 0.45, 2.15, 6, 0.13, paint);
    handlebars({ path: (s, c) => [[c.x, c.y, c.z], [s * 0.11, c.y + 0.10, c.z - 0.01], [s * 0.15, GRIP.y - 0.005, GRIP.z + 0.02], [s * 0.19, GRIP.y, GRIP.z]] });

    // perimeter frame, gloss black
    headstock(black);
    mirror((s) => {
      beam(g, V3(s * 0.05, 0.84, 0.40), V3(s * 0.15, 0.76, 0.16), 0.04, 0.09, black, 0.012);
      beam(g, V3(s * 0.15, 0.76, 0.16), V3(s * 0.15, 0.64, -0.10), 0.04, 0.09, black, 0.012);
      put(g, cbox(0.03, 0.22, 0.13, 0.03), black, s * 0.145, 0.53, -0.15);
      beam(g, V3(s * 0.10, 0.74, -0.10), V3(s * 0.08, 0.80, -0.82), 0.025, 0.035, black, 0.008);
      beam(g, V3(s * 0.13, 0.56, -0.20), V3(s * 0.08, 0.80, -0.56), 0.02, 0.025, black, 0.006);
      rod(g, V3(s * 0.03, 0.76, 0.43), V3(s * 0.10, 0.44, 0.30), 0.018, black, 8);   // down tubes
    });
    const eng = inlineFour({ caseMat: alloy, tilt: 0.40 });
    radiator(0.62, 0.33, 0.38, 0.28, 0.2);
    headers(eng, { collX: 0.02, mat: heat, tail: () => [[0.03, 0.22, -0.26], [0.07, 0.25, -0.40]] });
    // collector box and the big polished muffler, high on the right, slash-cut
    put(g, rodGeo(0.05, 0.055, 0.14, 12).rotateX(0.1), iron, 0.08, 0.25, -0.44);
    tube(g, [[0.08, 0.26, -0.50], [0.13, 0.31, -0.56]], 0.035, chrome, 6, 10);
    put(g, latheGeo([[0.001, -0.25], [0.045, -0.25], [0.065, -0.21], [0.072, 0.16], [0.07, 0.23], [0.05, 0.24], [0.03, 0.25]], 16, 'z'), chrome, 0.15, 0.39, -0.74, 0.12, 0, 0);
    put(g, cbox(0.028, 0.085, 0.26, 0.012), alloy, 0.225, 0.40, -0.74, 0.12, 0, 0);      // heat shield band
    put(g, cbox(0.025, 0.12, 0.06, 0.01), black, 0.14, 0.50, -0.70);                         // hanger

    // FULL FAIRING: ONE lofted shell, built bottom-up (axis 'y') so its front edge can
    // slant back behind the front wheel low down and reach forward over it up top -- the
    // side silhouette of a real fairing, which a fore-aft loft cannot make. Sections are in
    // (x, z): [y, zCentre, halfWidth, forwardReach, rearReach, exponent]. Low stations are
    // kept behind the tyre (measured: tyre back edge z 0.40 at y 0.40, 0.50 at y 0.55).
    put(g, loft([
      [0.25, 0.17, 0.14, 0.16, 0.18, 2.6],
      [0.30, 0.19, 0.18, 0.17, 0.20, 2.8],
      [0.42, 0.21, 0.205, 0.16, 0.22, 3.0],
      [0.56, 0.25, 0.215, 0.20, 0.22, 3.0],
      [0.70, 0.38, 0.215, 0.27, 0.26, 3.0],
      [0.84, 0.53, 0.22, 0.39, 0.28, 2.8],
      [0.97, 0.63, 0.215, 0.35, 0.22, 2.6],
      [1.09, 0.67, 0.19, 0.29, 0.20, 2.4],
      [1.19, 0.66, 0.15, 0.22, 0.16, 2.2],
      [1.235, 0.64, 0.09, 0.14, 0.09, 2.0],
    ], { axis: 'y', n: 24 }), paint, 0, 0, 0);
    // twin rectangular lamps under one lens line, and a black intake below them
    mirror((s) => {
      put(g, cbox(0.13, 0.065, 0.05, 0.015), chrome, s * 0.072, 1.045, 0.945, -0.35, s * 0.28, 0);
      put(g, cbox(0.115, 0.05, 0.02, 0.012), lamp, s * 0.073, 1.047, 0.968, -0.35, s * 0.28, 0);
    });
    // accent flash along the flank, lamps, indicators, louvre vents
    mirror((s) => {
      put(g, side([[0.54, 0.64], [0.46, 0.44], [0.10, 0.36], [0.12, 0.42], [0.46, 0.52]], 0.01, 0.004), accent, s * 0.214, 0, 0);
      for (let i = 0; i < 3; i++) put(g, cbox(0.012, 0.016, 0.15, 0.004), black, s * 0.222, 0.74 - i * 0.042, 0.32 - i * 0.012, 0.3, 0, 0);
      put(g, cbox(0.03, 0.035, 0.06, 0.01), amber, s * 0.21, 1.00, 0.80);
    });
    mirrors(g, V3(0.21, 1.08, 0.72), V3(0.26, 1.14, 0.70), 0.045, 'paint');
    // bubble screen: one curved crescent, raked, lofted upward. Top at y 1.396.
    put(g, loft([
      [1.19, 0.70, 0.19, 0.06, 0, 0], [1.28, 0.62, 0.18, 0.055, 0, 0], [1.396, 0.52, 0.15, 0.045, 0, 0],
    ], { axis: 'y', n: 20, section: crescent(0.008) }), tint, 0, 0, 0);
    // twin gauges and a dash panel behind the screen
    put(g, cbox(0.26, 0.05, 0.10, 0.02), black, 0, 1.16, 0.50, -0.3, 0, 0);
    mirror((s) => {
      orient(g, rodGeo(0.045, 0.045, 0.05, 14), black, V3(s * 0.055, 1.20, 0.50), V3(0, 0.75, -0.66));
      orient(g, rodGeo(0.038, 0.038, 0.004, 14), tint, V3(s * 0.055, 1.219, 0.4835), V3(0, 0.75, -0.66));
    });
    // tank, lofted: full at the front, pinched at the rear flank where the knees go
    body([
      [-0.07, 0.84, 0.12, 0.05, 0.06, 2.6],
      [0.02, 0.87, 0.15, 0.08, 0.09, 2.8],
      [0.16, 0.88, 0.175, 0.10, 0.11, 3.0],
      [0.32, 0.87, 0.175, 0.10, 0.10, 3.0],
      [0.44, 0.86, 0.14, 0.07, 0.08, 2.6],
    ], paint, { n: 20 });
    mirror((s) => put(g, cbox(0.012, 0.07, 0.12, 0.02), rubber, s * 0.148, 0.85, 0.03, 0, s * -0.2, 0));   // knee pads
    fuelCap(0.985, 0.24);
    // dual seat, lofted: flat top at the contract height, pillion stepped up
    body([
      [-0.76, 0.855, 0.10, 0.03, 0.05, 3.5],
      [-0.72, 0.86, 0.115, 0.03, 0.06, 4],
      [-0.54, 0.86, 0.12, 0.03, 0.06, 4],
      [-0.50, 0.835, 0.13, 0.04, 0.05, 4],
      [-0.12, 0.83, 0.135, 0.045, 0.05, 4],
      [-0.04, 0.83, 0.12, 0.045, 0.05, 3.2],
    ], rubber, { n: 20 });
    // tail unit, lofted, rising and narrowing to the lamp
    body([
      [-0.96, 0.86, 0.06, 0.03, 0.05, 2.6],
      [-0.90, 0.855, 0.09, 0.045, 0.08, 2.8],
      [-0.70, 0.815, 0.115, 0.045, 0.11, 3.0],
      [-0.40, 0.77, 0.13, 0.05, 0.12, 3.0],
      [-0.12, 0.74, 0.13, 0.05, 0.10, 3.0],
    ], paint, { n: 20 });
    mirror((s) => {
      for (let i = 0; i < 3; i++) put(g, cbox(0.012, 0.016, 0.11, 0.004), black, s * 0.132, 0.74 - i * 0.032, -0.30 + i * 0.012, 0.30, 0, 0);
      rod(g, V3(s * 0.12, 0.90, -0.56), V3(s * 0.11, 0.93, -0.80), 0.011, black, 6);
    });
    rod(g, V3(-0.11, 0.93, -0.80), V3(0.11, 0.93, -0.80), 0.011, black, 6);
    tailLights(0.85, -0.955, { w: 0.13, h: 0.05 });
    fender(g, R, WR + 0.04, 2.2, 2.9, 4, 0.16, paint, 0.015);    // hugger
    swingarm({ x: 0.135, h: 0.08, mat: alloy });
    twinShocks(-0.44, 0.78, black);
    chain(0.045, 0.10);
    rearsets({ hangerMat: alloy });
    rod(g, V3(-0.12, 0.30, -0.08), V3(-0.14, 0.22, -0.34), 0.012, black, 6);   // side stand
  }

  // CONTACT POINTS. Where a rider actually touches the machine, in the bike's own frame.
  // Identical for every class -- see the header.
  g.userData.joints = { frontSteer, frontWheel: fW, rearWheel: rW, swing, bars, fairing };
  g.userData.grounded = true;
  g.userData.contacts = {
    seat:  new THREE.Vector3(0, 0.875, -0.28),
    grip:  new THREE.Vector3(0.25, 1.04, 0.40),
    peg:   new THREE.Vector3(0.20, 0.44, -0.24),
  };
  g.userData.bike = { kind, wheelR: WR, wheelbase: 1.40, length: 2.10, height: 1.25 };
  return g;
}
