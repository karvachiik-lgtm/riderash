// RideRash -- THE ONE-WHEELER (easter egg machine), built to the 404 asset contract.
//
// A sport bike's bodywork balanced on ONE fat central wheel: a low chin fairing
// sweeping round the front of the tyre, a smoked screen over a black cowl, a
// long tank, thin side panels either side of the wheel, a stitched saddle and a
// kicked-up pointed tail with glowing exhaust ports.
//
// DRAWN FROM REFERENCES, NOT IMPORTED. An Atlas-generated mesh (1.6 M
// triangles, kept outside the game) was MEASURED -- the wheel fitted as a
// circle, the body's top line, belly line and half-width sampled at 48 stations
// -- and those numbers are the tables below, in the reference's own units. The
// paint (candy orange fading to metallic gold along the panels' bottom, one
// broad black band down the flank, a silver five-spoke rim) follows photographs
// of the real machine. The body is LOFTED through the tables: superellipse
// cross-sections on a Catmull-Rom spline, so the curves come through without a
// single imported vertex.
//
// SPORTIER THAN THE REFERENCE: 22% longer and 20% wider, stretched about the
// saddle so the contract's contacts do not move, the nose raked down, the tail
// kicked up, a fatter sport tyre.
//
// THE CONTRACT IS THE BIKE FAMILY'S (assets/bike.js header): real metres, front
// faces +Z, base at y = 0, symmetric in x; the same contacts (saddle top 0.875,
// grips (+/-0.25, 1.04, 0.40), pegs (+/-0.20, 0.44, -0.24)) and joint map. The
// one wheel is both `frontWheel` and `rearWheel`; `frontSteer` turns the bars.
// `userData.bike.hubZ` is the pivot the game rocks the machine about.

export default function (THREE) {
  const opts = arguments[1] || {};
  const g = new THREE.Group();
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- materials
  const CLASS = {
    // metallic-flake paint under a hard clearcoat: reads as a painted machine, not plastic
    paint:  (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.24, metalness: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.04 }),
    metal:  (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0.86, clearcoat: 0.2, clearcoatRoughness: 0.18 }),
    chrome: (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.10, metalness: 1.0 }),
    rubber: (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.0 }),
    lens:   (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 }),
    // lamps and the embers in the exhaust ports: self-lit, so they read at dusk
    lamp:   (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.4 }),
    // the saddle: satin, not gloss
    satin:  (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.72, metalness: 0.05, clearcoat: 0.15, clearcoatRoughness: 0.5 }),
  };
  const mat = (cls, c, livery) => { const m = CLASS[cls](c); if (livery) m.userData.livery = livery; return m; };
  const orange = mat('paint', opts.bodyColor ?? 0xec4a0e, 'body');
  const black  = mat('paint', opts.accentColor ?? 0x0e0f10, 'accent');
  const amber  = mat('paint', 0xe7701a);           // the fade: orange -> amber -> gold
  const gold   = mat('paint', 0xe3a321);
  const seatM  = mat('satin', 0x262628);
  const alloy  = mat('metal', 0xa4a5a8);
  const chrome = mat('chrome', 0xd8dade);
  const rubber = mat('rubber', 0x1b1b1e);
  const smoke  = mat('lens', 0x2a333c);
  const port   = mat('metal', 0x2a2c30);
  const head   = mat('lamp', 0xfff1c8);
  const tailL  = mat('lamp', 0xd01c12);
  const ember  = mat('lamp', 0xff6a1a);

  // ------------------------------------------------- the reference -> metres
  // Reference frame: x along the bike (front = -x), y up, z across. Scaled so
  // the reference saddle (y 0.378) lands on the contract's 0.875 m saddle top,
  // then stretched LEN / WID about the saddle, with the RAKE (nose down, tail up).
  const K = 0.825, GROUND = -0.682, LEN = 1.22, WID = 1.2;
  const Z = (x) => -(x - 0.3) * K * LEN - 0.28;
  const RAKE = (x) => (x < -0.2 ? -0.07 * Math.min(1, (-0.2 - x) / 0.75) : 0) + (x > 0.5 ? 0.06 * Math.min(1, (x - 0.5) / 0.45) : 0);
  const Y = (y, x = 0.3) => (y - GROUND + RAKE(x)) * K;
  const W = (w) => w * K * WID;
  const WHEEL = { x: -0.018, y: -0.24, r: 0.442, half: 0.081 };

  // ---------------------------------------------------------------- lofting
  // Stations [x, top, bottom, halfWidth, centreOffset?] in ref units. Cubic
  // (Catmull-Rom) through them, superellipse rings (n 2 = ellipse, higher is
  // boxier), vertex normals smoothed, ends capped.
  function crm(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function loft(st, { n = 2.6, ring = 20, steps = 6, off = 0 } = {}) {
    const rows = [];
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[Math.max(0, i - 1)], b = st[i], c = st[i + 1], d = st[Math.min(st.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        rows.push([0, 1, 2, 3, 4].map((k) => crm(a[k] ?? 0, b[k] ?? 0, c[k] ?? 0, d[k] ?? 0, t)));
      }
    }
    { const l = st[st.length - 1]; rows.push([l[0], l[1], l[2], l[3], l[4] ?? 0]); }
    const pos = [], idx = [], e = 2 / n;
    for (const [x, top, bot, hw, o5] of rows) {
      const cy = (top + bot) / 2, hh = Math.max(0.004, (top - bot) / 2), offR = off + (o5 || 0);
      for (let k = 0; k < ring; k++) {
        const th = (k / ring) * TAU, c = Math.cos(th), s = Math.sin(th);
        const px = Math.sign(c) * Math.pow(Math.abs(c), e) * hw;
        const py = Math.sign(s) * Math.pow(Math.abs(s), e) * hh;
        pos.push(W(px + offR), Y(cy + py, x), Z(x));
      }
    }
    const R = rows.length;
    for (let r = 0; r < R - 1; r++) for (let k = 0; k < ring; k++) {
      const a = r * ring + k, b = r * ring + (k + 1) % ring, c = (r + 1) * ring + k, d = (r + 1) * ring + (k + 1) % ring;
      idx.push(a, c, b, b, c, d);
    }
    for (const [r, flip] of [[0, false], [R - 1, true]]) {           // end caps
      const [x, top, bot, , o5] = rows[r];
      const ci = pos.length / 3;
      pos.push(W(off + (o5 || 0)), Y((top + bot) / 2, x), Z(x));
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
  const fairing = new THREE.Group(); g.add(fairing);
  // THE CHIN: slim and pointed, sweeping from the nose down round the tyre
  mesh(loft([
    [-0.95, 0.165, 0.14, 0.02], [-0.89, 0.165, 0.10, 0.055], [-0.81, 0.16, 0.00, 0.095],
    [-0.73, 0.15, -0.19, 0.12], [-0.64, 0.12, -0.26, 0.14], [-0.54, 0.10, -0.24, 0.16], [-0.46, 0.12, -0.19, 0.175],
    [-0.40, 0.15, -0.13, 0.18],
  ], { n: 3.2 }), orange, fairing);
  // its belly carries the gold fade too
  mesh(loft([[-0.86, 0.06, 0.03, 0.07], [-0.74, -0.12, -0.19, 0.118], [-0.62, -0.19, -0.265, 0.138], [-0.50, -0.17, -0.235, 0.165], [-0.42, -0.10, -0.14, 0.176]], { n: 3.2, ring: 16 }), gold, fairing);
  // THE COWL: black, over the chin, up to the screen and the lamp
  mesh(loft([
    [-0.955, 0.255, 0.15, 0.035], [-0.90, 0.33, 0.14, 0.085], [-0.84, 0.40, 0.13, 0.115],
    [-0.76, 0.46, 0.13, 0.15], [-0.66, 0.47, 0.13, 0.17], [-0.56, 0.45, 0.16, 0.18],
  ], { n: 2.6 }), black, fairing);
  // THE HEADLAMP: a lit slit in the nose
  mesh(loft([[-0.958, 0.24, 0.20, 0.02], [-0.925, 0.27, 0.19, 0.06], [-0.88, 0.29, 0.19, 0.07]], { n: 3, ring: 16 }), head, fairing);
  // THE SCREEN: a curved smoked shell rising back from the cowl to its peak
  {
    const rows = [[-0.80, 0.44, 0.12], [-0.74, 0.56, 0.135], [-0.69, 0.665, 0.125], [-0.64, 0.66, 0.11], [-0.60, 0.60, 0.10]];
    const pos = [], idx = [], cols = 9;
    rows.forEach(([x, y, hw], r) => {
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1) * 2 - 1;
        pos.push(W(u * hw), Y(y - 0.05 * u * u, x), Z(x + 0.02 * u * u));
        if (r && c) { const a = (r - 1) * cols + c - 1, b = a + 1, d = r * cols + c - 1; idx.push(a, d, b, b, d, d + 1); }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const scr = mesh(geo, smoke, fairing); scr.material = smoke.clone(); scr.material.side = THREE.DoubleSide;
  }
  // THE TANK AND UPPER BODY: orange, boxy-shouldered, behind the screen to the saddle
  mesh(loft([
    [-0.60, 0.40, 0.17, 0.16], [-0.52, 0.47, 0.20, 0.215], [-0.42, 0.53, 0.21, 0.226], [-0.30, 0.57, 0.21, 0.222],
    [-0.18, 0.585, 0.22, 0.226], [-0.06, 0.56, 0.23, 0.232], [0.06, 0.51, 0.245, 0.22], [0.14, 0.45, 0.26, 0.205], [0.20, 0.40, 0.27, 0.19],
  ], { n: 3.6 }), orange);
  // a black knee-recess stripe along each flank of the tank
  for (const s of [-1, 1]) mesh(loft([[-0.40, 0.44, 0.40, 0.012], [-0.20, 0.47, 0.42, 0.014], [0.02, 0.44, 0.40, 0.012]], { n: 2, ring: 10, off: s * 0.226 }), black);

  // THE SIDE PANELS: thin fairing blades either side of the wheel (3 cm of
  // shell), following the measured belly and width lines, with the fork legs
  // and hub showing in the gap to the tyre. Orange above, fading through amber
  // to gold at the belly, a black edge along the bottom.
  for (const s of [-1, 1]) {
    const T = 0.022;
    const st = [
      [-0.47, 0.20, -0.19, 0.216], [-0.40, 0.21, -0.12, 0.218], [-0.32, 0.22, -0.16, 0.216], [-0.24, 0.23, -0.31, 0.224],
      [-0.15, 0.24, -0.42, 0.238], [-0.06, 0.25, -0.38, 0.238], [0.04, 0.26, -0.34, 0.232], [0.12, 0.27, -0.25, 0.222],
      [0.20, 0.29, -0.12, 0.208], [0.30, 0.30, -0.02, 0.204], [0.40, 0.31, 0.05, 0.198], [0.50, 0.32, 0.10, 0.186], [0.58, 0.33, 0.14, 0.17],
    ].map(([x, t, b, w]) => [x, t, b, T, s * (w - T)]);
    mesh(loft(st, { n: 4, ring: 16 }), orange);
    mesh(loft(st.map(([x, t, b, , o]) => [x, b + 0.13, b + 0.06, T * 1.06, o]), { n: 4, ring: 12 }), amber);
    mesh(loft(st.map(([x, t, b, , o]) => [x, b + 0.07, b + 0.012, T * 1.1, o]), { n: 4, ring: 12 }), gold);
    mesh(loft(st.map(([x, t, b, , o]) => [x, b + 0.016, b, T * 1.14, o]), { n: 4, ring: 12 }), black);
    // the scoop: a black vent let into the panel
    mesh(loft([[-0.33, 0.13, 0.00, T * 1.3, s * 0.20], [-0.22, 0.11, -0.10, T * 1.3, s * 0.205], [-0.10, 0.07, -0.15, T * 1.3, s * 0.22]], { n: 3, ring: 10 }), black);
  }

  // THE SADDLE: satin charcoal, dipped (contract: top 0.875 m), with a welt
  mesh(loft([
    [0.12, 0.41, 0.27, 0.19], [0.22, 0.383, 0.28, 0.18], [0.34, 0.382, 0.29, 0.17], [0.46, 0.40, 0.30, 0.16], [0.58, 0.43, 0.31, 0.14],
  ], { n: 3.2 }), seatM);
  for (const s of [-1, 1]) mesh(loft([[0.16, 0.405, 0.395, 0.006], [0.34, 0.387, 0.377, 0.006], [0.56, 0.43, 0.42, 0.006]], { n: 2, ring: 8, off: s * 0.12 }), black);

  // THE TAIL: kicked up and tapering to a point
  mesh(loft([
    [0.54, 0.44, 0.15, 0.17], [0.62, 0.47, 0.18, 0.155], [0.72, 0.50, 0.23, 0.135], [0.82, 0.507, 0.29, 0.11], [0.90, 0.513, 0.36, 0.085], [0.955, 0.516, 0.42, 0.065],
  ], { n: 3.6 }), orange);
  mesh(loft([[0.60, 0.475, 0.44, 0.10], [0.78, 0.51, 0.48, 0.09], [0.92, 0.518, 0.49, 0.06]], { n: 3, ring: 14 }), black);
  // the tail light: a red strip across the blunt end
  mesh(loft([[0.94, 0.49, 0.43, 0.06], [0.962, 0.492, 0.432, 0.064]], { n: 3, ring: 14, steps: 2 }), tailL);
  // the exhaust ports on the tail's flanks, embers glowing inside
  for (const s of [-1, 1]) {
    const p = mesh(new THREE.CylinderGeometry(W(0.05), W(0.06), W(0.12), 14), port);
    p.scale.set(1, 1, 0.55); p.rotation.z = Math.PI / 2;
    p.position.set(s * W(0.12), Y(0.34, 0.76), Z(0.76));
    const glow = mesh(new THREE.CircleGeometry(W(0.036), 12), ember);
    glow.position.set(s * W(0.183), Y(0.34, 0.76), Z(0.76)); glow.rotation.y = s * Math.PI / 2;
  }

  // THE BLACK BAND: one broad graphic sweeping from the headstock down and
  // back across the side panel (the real machine's signature), and a pinstripe
  // down the tail -- flat strips laid on the paint, tapering to points
  const SIDE = [[-0.50, 0.216], [-0.32, 0.216], [-0.15, 0.238], [0.04, 0.232], [0.20, 0.208], [0.40, 0.198], [0.58, 0.17], [0.72, 0.135], [0.82, 0.11], [0.92, 0.085]];
  const sideW = (x) => {
    for (let i = 0; i < SIDE.length - 1; i++) if (x <= SIDE[i + 1][0]) {
      const [x0, w0] = SIDE[i], [x1, w1] = SIDE[i + 1], t = (x - x0) / (x1 - x0);
      return w0 + (w1 - w0) * Math.max(0, Math.min(1, t));
    }
    return SIDE[SIDE.length - 1][1];
  };
  for (const s of [-1, 1]) for (const path of [
    [[0.93, 0.47, 0.44], [0.80, 0.44, 0.40], [0.64, 0.38, 0.33], [0.50, 0.31, 0.26]],
    [[-0.50, 0.30, 0.20], [-0.36, 0.24, 0.10], [-0.20, 0.14, 0.01], [-0.02, 0.04, -0.07], [0.16, -0.04, -0.12]],
  ]) {
    const st = path.map(([x, t, b], i) => {
      const k = Math.sin((i / (path.length - 1)) * Math.PI) * 0.8 + 0.2;
      const m = (t + b) / 2, h = (t - b) / 2 * k;
      return [x, m + h, m - h, 0.004, s * (sideW(x) + 0.002)];
    });
    mesh(loft(st, { n: 4, ring: 8 }), black);
  }

  // THE SILVER STRUCTURE: twin fork legs from the body down to the hub either
  // side of the tyre, and a brushed under-tray between the panels
  const hub = { y: Y(WHEEL.y), z: Z(WHEEL.x) };
  const WR = WHEEL.r * K, TW = WHEEL.half * K * 1.3;            // a fatter sport tyre
  for (const s of [-1, 1]) {
    const x = s * (TW + 0.03);
    const pts = [new THREE.Vector3(x, Y(0.16, -0.30), Z(-0.30)), new THREE.Vector3(x, Y(0.0, -0.16), Z(-0.16)), new THREE.Vector3(x, hub.y, hub.z)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.024, 8), alloy);
  }
  mesh(loft([[-0.40, 0.21, 0.17, 0.10], [-0.10, 0.23, 0.19, 0.11], [0.20, 0.27, 0.23, 0.10]], { n: 3, ring: 12 }), alloy);

  // ---------------------------------------------------------------- the wheel
  const wheel = new THREE.Group(); wheel.position.set(0, hub.y, hub.z); g.add(wheel);
  const tyre = mesh(new THREE.TorusGeometry(WR - TW * 0.9, TW * 0.95, 14, 48), rubber, wheel);
  tyre.rotation.y = Math.PI / 2; tyre.scale.set(1, 1, 1.05);
  // rim: a chrome lip, a silver dish, FIVE thick spokes (the real machine's)
  const rimR = WR - TW * 1.75;
  const lip = mesh(new THREE.TorusGeometry(rimR, TW * 0.14, 8, 48), chrome, wheel); lip.rotation.y = Math.PI / 2;
  const dish = mesh(new THREE.CylinderGeometry(rimR * 0.98, rimR * 0.98, TW * 0.45, 36, 1, true), alloy, wheel); dish.rotation.z = Math.PI / 2;
  dish.material = alloy.clone(); dish.material.side = THREE.DoubleSide;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU, pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, r = 0.1 + t * (rimR - 0.1), bend = 0.12 * Math.sin(t * Math.PI);
      pts.push(new THREE.Vector3(0, Math.sin(a + bend) * r, Math.cos(a + bend) * r));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.024, 7), alloy, wheel);
  }
  // THE HUB MOTOR: a finned silver drum, chrome caps
  const hubM = mesh(new THREE.CylinderGeometry(0.11, 0.11, TW * 1.2, 24), alloy, wheel); hubM.rotation.z = Math.PI / 2;
  for (let i = -2; i <= 2; i++) {
    const fin = mesh(new THREE.TorusGeometry(0.112, 0.006, 4, 24), alloy, wheel);
    fin.rotation.y = Math.PI / 2; fin.position.x = i * TW * 0.22;
  }
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 16), chrome, wheel);
    cap.rotation.z = Math.PI / 2; cap.position.x = s * TW * 0.62;
  }
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
    const peg = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.09, 8), rubber, swing);   // contract: +/-0.20, 0.44, -0.24
    peg.rotation.z = Math.PI / 2; peg.position.set(s * 0.20, 0.44, -0.24);
    const hang = new THREE.CatmullRomCurve3([new THREE.Vector3(x, hub.y + 0.02, hub.z - 0.02), new THREE.Vector3(s * 0.17, 0.44, -0.20)]);
    mesh(new THREE.TubeGeometry(hang, 4, 0.014, 6), alloy, swing);
  }

  // ------------------------------------------------------------- the bars
  const frontSteer = new THREE.Group(); frontSteer.position.set(0, 0.95, 0.43); g.add(frontSteer);
  const bars = new THREE.Group(); frontSteer.add(bars);
  mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.10, 12), alloy, bars);
  for (const s of [-1, 1]) {
    const pts = [new THREE.Vector3(s * 0.04, 0.02, 0), new THREE.Vector3(s * 0.14, 0.07, -0.02), new THREE.Vector3(s * 0.20, 0.09, -0.03)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.013, 6), chrome, bars);
    const grip = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.11, 10), rubber, bars);   // contract grip (+/-0.25, 1.04, 0.40)
    grip.rotation.z = Math.PI / 2; grip.position.set(s * 0.25, 0.09, -0.03);
  }

  g.userData.joints = { frontSteer, frontWheel: wheel, rearWheel: wheel, swing, bars, fairing };
  g.userData.grounded = true;
  g.userData.contacts = {
    seat:  new THREE.Vector3(0, 0.875, -0.28),
    grip:  new THREE.Vector3(0.25, 1.04, 0.40),
    peg:   new THREE.Vector3(0.20, 0.44, -0.24),
  };
  g.userData.bike = { kind: 'mono', wheelR: WR, wheelbase: 0, length: Z(-0.955) - Z(0.955), height: Y(0.68, -0.69), mono: true, hubZ: hub.z };
  return g;
}
