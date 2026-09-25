// RideRash -- THE ONE-WHEELER (easter egg machine), built to the 404 asset contract.
//
// A sport bike's bodywork balanced on ONE fat central wheel: a low orange chin
// fairing sweeping round the front of the tyre, a smoked screen over a black
// cowl, a long tank, side pontoons that wrap down either side of the wheel, a
// black saddle and a kicked-up tail with exhaust ports -- the wheel turning in
// the gap between the pontoons, carried on a short swingarm each side.
//
// DRAWN FROM A REFERENCE, NOT IMPORTED. An Atlas-generated mesh (1.6 M
// triangles, kept outside the game) was MEASURED -- the wheel fitted as a
// circle, and the body's top line, belly line and half-width sampled at 48
// stations along its length -- and those numbers are the tables below (in the
// reference's own units, `R.*`). The body is LOFTED through them: smooth
// superellipse cross-sections interpolated along the length with a cubic, so
// the reference's curves come through without a single imported vertex.
//
// THE CONTRACT IS THE HERO BIKE'S (assets/bike.js header): real metres, front
// faces +Z, base at y = 0, symmetric in x; the same contacts (saddle top 0.875,
// grips (+/-0.25, 1.04, 0.40), pegs (+/-0.20, 0.44, -0.24)) and the same joint
// map, so the rider's IK, the seat socket and the camera need nothing new. The
// one wheel is both `frontWheel` and `rearWheel` (the game writes the same spin
// to each), `frontSteer` turns the clip-on bars only.
//
// Materials: the five classes of the bike family (paint, metal, chrome, rubber,
// lens), body paint tagged `userData.livery = 'body'`, black cowl/seat
// `'accent'`, so the garage colour and a rival recolour work unchanged.

export default function (THREE) {
  const opts = arguments[1] || {};
  const g = new THREE.Group();
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- materials
  const CLASS = {
    paint:  (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, metalness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.05 }),
    metal:  (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0.86, clearcoat: 0.2, clearcoatRoughness: 0.18 }),
    chrome: (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.10, metalness: 1.0 }),
    rubber: (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.0 }),
    lens:   (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 }),
  };
  const mat = (cls, c, livery) => { const m = CLASS[cls](c); if (livery) m.userData.livery = livery; return m; };
  const orange = mat('paint', opts.bodyColor ?? 0xe0501c, 'body');
  const black  = mat('paint', opts.accentColor ?? 0x17181a, 'accent');
  const alloy  = mat('metal', 0x9a9ea3);
  const chrome = mat('chrome', 0xd8dade);
  const rubber = mat('rubber', 0x1b1b1e);
  const smoke  = mat('lens', 0x2a333c);
  const port   = mat('metal', 0x2a2c30);

  // ------------------------------------------------- the reference -> metres
  // Reference frame: x along the bike (front = -x), y up, z across. Scaled so
  // the reference saddle (y 0.378) lands on the contract's 0.875 m saddle top.
  const K = 0.825, GROUND = -0.682;
  const Z = (x) => -(x - 0.3) * K - 0.28;          // ref x -> game z (front +z)
  const Y = (y) => (y - GROUND) * K;               // ref y -> game y
  const W = (w) => w * K;                           // ref half-width -> metres
  const WHEEL = { x: -0.018, y: -0.24, r: 0.442, half: 0.081 };

  // ---------------------------------------------------------------- lofting
  // Stations [x, top, bottom, halfWidth, (optional centre-x offset)], ref units.
  // Cubic (Catmull-Rom) through them, superellipse rings (exponent n: 2 is an
  // ellipse, higher is boxier), vertex normals smoothed, ends capped.
  function crm(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function loft(st, { n = 2.6, ring = 20, steps = 6, off = 0, flatBottom = 0 } = {}) {
    const rows = [];
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[Math.max(0, i - 1)], b = st[i], c = st[i + 1], d = st[Math.min(st.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        rows.push([0, 1, 2, 3].map((k) => crm(a[k], b[k], c[k], d[k], t)));
      }
    }
    rows.push(st[st.length - 1].slice(0, 4));
    const pos = [], idx = [];
    const e = 2 / n;
    for (const [x, top, bot, hw] of rows) {
      const cy = (top + bot) / 2, hh = Math.max(0.004, (top - bot) / 2);
      for (let k = 0; k < ring; k++) {
        const th = (k / ring) * TAU, c = Math.cos(th), s = Math.sin(th);
        const px = Math.sign(c) * Math.pow(Math.abs(c), e) * hw;
        let py = Math.sign(s) * Math.pow(Math.abs(s), s < 0 ? e * (1 - flatBottom) + flatBottom * 0.2 : e) * hh;
        pos.push(W(px + off), Y(cy + py), Z(x));
      }
    }
    const R = rows.length;
    for (let r = 0; r < R - 1; r++) for (let k = 0; k < ring; k++) {
      const a = r * ring + k, b = r * ring + (k + 1) % ring, c = (r + 1) * ring + k, d = (r + 1) * ring + (k + 1) % ring;
      idx.push(a, c, b, b, c, d);
    }
    // caps: a fan to each end's centre
    for (const [r, flip] of [[0, false], [R - 1, true]]) {
      const [x, top, bot] = rows[r];
      const ci = pos.length / 3;
      pos.push(W(off), Y((top + bot) / 2), Z(x));
      for (let k = 0; k < ring; k++) {
        const a = r * ring + k, b = r * ring + (k + 1) % ring;
        if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }
  const mesh = (geo, m, parent = g) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };

  // ---------------------------------------------------------- the bodywork
  // (tables are the measured reference stations, lightly smoothed)
  const fairing = new THREE.Group(); g.add(fairing);
  // THE CHIN: the low orange fairing in front of the tyre, sweeping from the
  // nose down to the belly and meeting the pontoons
  mesh(loft([
    [-0.95, 0.165, 0.13, 0.03], [-0.89, 0.165, 0.10, 0.075], [-0.81, 0.16, 0.00, 0.125],
    [-0.73, 0.15, -0.20, 0.155], [-0.64, 0.12, -0.27, 0.172], [-0.54, 0.10, -0.25, 0.19], [-0.46, 0.12, -0.20, 0.20],
  ], { n: 2.4 }), orange, fairing);
  // THE COWL: black, over the chin, up to the screen and the lamp
  mesh(loft([
    [-0.955, 0.255, 0.15, 0.035], [-0.90, 0.33, 0.14, 0.085], [-0.84, 0.40, 0.13, 0.115],
    [-0.76, 0.46, 0.13, 0.15], [-0.66, 0.47, 0.13, 0.17], [-0.56, 0.45, 0.16, 0.18],
  ], { n: 2.3 }), black, fairing);
  // headlamp: a smoked slit in the nose
  mesh(loft([[-0.95, 0.24, 0.20, 0.02], [-0.92, 0.27, 0.19, 0.06], [-0.88, 0.29, 0.19, 0.07]], { n: 3, ring: 16 }), smoke, fairing);
  // THE SCREEN: a curved smoked shell rising back from the cowl to its peak
  {
    const rows = [[-0.80, 0.44, 0.12], [-0.74, 0.56, 0.135], [-0.69, 0.665, 0.125], [-0.64, 0.66, 0.11], [-0.60, 0.60, 0.10]];
    const pos = [], idx = [], cols = 9;
    rows.forEach(([x, y, hw], r) => {
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1) * 2 - 1;                 // -1..1 across
        pos.push(W(u * hw), Y(y - 0.05 * u * u), Z(x + 0.02 * u * u));
        if (r && c) { const a = (r - 1) * cols + c - 1, b = a + 1, d = r * cols + c - 1, e2 = d + 1; idx.push(a, d, b, b, d, e2); }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const s = mesh(geo, smoke, fairing); s.material.side = THREE.DoubleSide;
  }
  // THE TANK AND UPPER BODY: orange, from behind the screen to the saddle
  mesh(loft([
    [-0.60, 0.40, 0.17, 0.16], [-0.52, 0.47, 0.20, 0.215], [-0.42, 0.53, 0.21, 0.226], [-0.30, 0.57, 0.21, 0.222],
    [-0.18, 0.585, 0.22, 0.236], [-0.06, 0.56, 0.23, 0.25], [0.06, 0.51, 0.245, 0.236], [0.14, 0.45, 0.26, 0.22], [0.20, 0.40, 0.27, 0.205],
  ], { n: 2.8 }), orange);
  // a black knee-recess stripe along the tank's flank
  for (const s of [-1, 1]) mesh(loft([[-0.40, 0.44, 0.40, 0.012], [-0.20, 0.47, 0.42, 0.014], [0.02, 0.44, 0.40, 0.012]], { n: 2, ring: 10, off: s * 0.236 }), black);
  // THE PONTOONS: either side of the wheel, from the chin back under the seat,
  // dropping round the hub -- the belly line is the reference's orange bottom
  for (const s of [-1, 1]) {
    const inner = WHEEL.half + 0.035;
    // [x, top, bottom, outer half-width] -- the belly and width lines measured
    // off the reference, running on under the saddle to meet the tail
    const st = [
      [-0.47, 0.20, -0.20, 0.226], [-0.40, 0.21, -0.12, 0.226], [-0.32, 0.22, -0.16, 0.222], [-0.24, 0.23, -0.32, 0.232],
      [-0.15, 0.24, -0.43, 0.252], [-0.06, 0.25, -0.39, 0.251], [0.04, 0.26, -0.35, 0.243], [0.12, 0.27, -0.26, 0.232],
      [0.20, 0.29, -0.13, 0.216], [0.30, 0.30, -0.02, 0.215], [0.40, 0.31, 0.05, 0.208], [0.50, 0.32, 0.10, 0.194], [0.58, 0.33, 0.14, 0.175],
    ].map(([x, t, b, w]) => [x, t, b, (w - inner) / 2, w]);
    mesh(loft(st.map((r) => r.slice(0, 4)), { n: 1.7, ring: 18, off: s * (inner + (0.235 - inner) / 2) }), orange);
    // the scoop: a black vent on the pontoon's face
    mesh(loft([[-0.32, 0.12, -0.02, 0.012], [-0.20, 0.10, -0.10, 0.015], [-0.08, 0.06, -0.14, 0.012]], { n: 2, ring: 10, off: s * 0.245 }), black);
  }
  // THE SADDLE: black, dipped, the rider's seat (contract: top 0.875 m)
  mesh(loft([
    [0.12, 0.41, 0.27, 0.19], [0.22, 0.383, 0.28, 0.18], [0.34, 0.382, 0.29, 0.17], [0.46, 0.40, 0.30, 0.16], [0.58, 0.43, 0.31, 0.14],
  ], { n: 3.2 }), black);
  // THE TAIL: orange, kicked up, tapering to a blunt end
  mesh(loft([
    [0.54, 0.44, 0.13, 0.18], [0.62, 0.47, 0.16, 0.165], [0.72, 0.50, 0.21, 0.148], [0.82, 0.507, 0.26, 0.128], [0.90, 0.513, 0.33, 0.108], [0.955, 0.516, 0.40, 0.09],
  ], { n: 2.6 }), orange);
  // the tail's black top cap and the exhaust ports on its flanks
  mesh(loft([[0.60, 0.475, 0.44, 0.10], [0.78, 0.51, 0.48, 0.09], [0.92, 0.518, 0.49, 0.06]], { n: 3, ring: 14 }), black);
  for (const s of [-1, 1]) {
    const p = mesh(new THREE.CylinderGeometry(W(0.05), W(0.06), W(0.12), 14), port);
    p.scale.set(1, 1, 0.55); p.rotation.z = Math.PI / 2;
    p.position.set(s * W(0.14), Y(0.34), Z(0.76));
    const glow = mesh(new THREE.CircleGeometry(W(0.036), 12), mat('metal', 0x3a1a10));
    glow.position.set(s * W(0.205), Y(0.34), Z(0.76)); glow.rotation.y = s * Math.PI / 2;
  }

  // ---------------------------------------------------------------- the wheel
  const hub = { y: Y(WHEEL.y), z: Z(WHEEL.x) };
  const wheel = new THREE.Group(); wheel.position.set(0, hub.y, hub.z); g.add(wheel);
  const WR = WHEEL.r * K, TW = WHEEL.half * K;
  // tyre: a fat torus with a lathed flat tread
  const tyre = mesh(new THREE.TorusGeometry(WR - TW * 0.9, TW * 0.95, 14, 48), rubber, wheel);
  tyre.rotation.y = Math.PI / 2; tyre.scale.set(1, 1, 1.05);
  // rim: a chrome lip and a dark alloy dish with five curved spokes
  const rimR = WR - TW * 1.75;
  const lip = mesh(new THREE.TorusGeometry(rimR, TW * 0.16, 8, 48), chrome, wheel); lip.rotation.y = Math.PI / 2;
  const dish = mesh(new THREE.CylinderGeometry(rimR * 0.98, rimR * 0.98, TW * 0.5, 36, 1, true), alloy, wheel); dish.rotation.z = Math.PI / 2;
  dish.material = alloy.clone(); dish.material.side = THREE.DoubleSide;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const pts = [];
    for (let k = 0; k <= 6; k++) {                       // a swept, curved spoke
      const t = k / 6, r = 0.07 + t * (rimR - 0.07), bend = 0.35 * Math.sin(t * Math.PI);
      pts.push(new THREE.Vector3(0, Math.sin(a + bend) * r, Math.cos(a + bend) * r));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.014, 6), alloy, wheel);
  }
  const hubM = mesh(new THREE.CylinderGeometry(0.075, 0.075, TW * 1.3, 18), chrome, wheel); hubM.rotation.z = Math.PI / 2;
  // a brake disc on the left
  const disc = mesh(new THREE.CylinderGeometry(rimR * 0.62, rimR * 0.62, 0.008, 28), chrome, wheel);
  disc.rotation.z = Math.PI / 2; disc.position.x = -TW * 0.55;

  // --------------------------------------------- the swingarms and the pegs
  const swing = new THREE.Group(); g.add(swing);
  for (const s of [-1, 1]) {
    const x = s * (TW + 0.05);
    const pts = [new THREE.Vector3(x, hub.y, hub.z), new THREE.Vector3(x * 1.1, Y(-0.12), Z(0.30)), new THREE.Vector3(x * 1.2, Y(0.10), Z(0.50))];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.024, 8), alloy, swing);
    const axle = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), chrome, swing);
    axle.rotation.z = Math.PI / 2; axle.position.set(x, hub.y, hub.z);
    // the peg (contract: +/-0.20, 0.44, -0.24) on its hanger
    const peg = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.09, 8), rubber, swing);
    peg.rotation.z = Math.PI / 2; peg.position.set(s * 0.20, 0.44, -0.24);
    const hang = new THREE.CatmullRomCurve3([new THREE.Vector3(x, hub.y + 0.02, hub.z - 0.02), new THREE.Vector3(s * 0.17, 0.44, -0.20)]);
    mesh(new THREE.TubeGeometry(hang, 4, 0.014, 6), alloy, swing);
  }

  // ------------------------------------------------------------- the bars
  // clip-ons at the contract grips; `frontSteer` turns them (and only them)
  const frontSteer = new THREE.Group(); frontSteer.position.set(0, 0.95, 0.43); g.add(frontSteer);
  const bars = new THREE.Group(); frontSteer.add(bars);
  const clamp = mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.10, 12), alloy, bars); clamp.position.set(0, 0.0, 0);
  for (const s of [-1, 1]) {
    const pts = [new THREE.Vector3(s * 0.04, 0.02, 0), new THREE.Vector3(s * 0.14, 0.07, -0.02), new THREE.Vector3(s * 0.20, 0.09, -0.03)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.013, 6), chrome, bars);
    const grip = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.11, 10), rubber, bars);
    grip.rotation.z = Math.PI / 2; grip.position.set(s * 0.25, 0.09, -0.03);
  }

  // CONTACT POINTS and the joint map: the bike family's, unchanged
  g.userData.joints = { frontSteer, frontWheel: wheel, rearWheel: wheel, swing, bars, fairing };
  g.userData.grounded = true;
  g.userData.contacts = {
    seat:  new THREE.Vector3(0, 0.875, -0.28),
    grip:  new THREE.Vector3(0.25, 1.04, 0.40),
    peg:   new THREE.Vector3(0.20, 0.44, -0.24),
  };
  g.userData.bike = { kind: 'mono', wheelR: WR, wheelbase: 0, length: Z(-0.955) - Z(0.955), height: Y(0.68), mono: true };
  return g;
}
