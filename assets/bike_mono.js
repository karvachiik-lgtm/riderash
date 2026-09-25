// RideRash -- THE ONE-WHEELER (easter egg machine), built to the 404 asset contract.
//
// A film-style monowheel superbike: ONE HUGE car-width tyre (1.28 m across,
// 0.48 m wide, chunky block tread, a deep black dish with an orange lip),
// wrapped by an angular armoured nose that straddles the tyre like a tunnel,
// a big glass bubble screen with a glowing heads-up display on its inside, a
// padded spine the rider lies on, very wide clip-on bars, rear-set pegs, a
// thin kicked-up tail boom and four exhausts hanging under it.
//
// DRAWN FROM A REFERENCE, NOT IMPORTED. The design language (gunmetal armour
// in flat facets, burnt-orange slash panels, bubble HUD screen, the rider laid
// flat behind it) follows Atlas concept art generated for it (FLUX.2 Max, side
// and 3/4 views, kept outside the game). Every vertex here is code: faceted
// hulls lofted through hand-set cross-sections, lathed tyre and rim, extruded
// side plates, and flat shading so the curves read LOW-POLY on purpose.
//
// THE CONTRACT IS THE BIKE FAMILY'S (assets/bike.js header): real metres, front
// faces +Z, base at y = 0, symmetric in x, livery tags 'body' / 'accent', and
// the same joint map. The one wheel is both `frontWheel` and `rearWheel`;
// `frontSteer` turns the bars. Two things are this machine's own:
//   * the saddle is 0.52 m HIGHER than the family's (the tyre is taller than
//     their saddles): `userData.bike.seatLift`, which player.js adds to the
//     rider socket, and the seat contact below says the same;
//   * the rider may lie down further than the family's 0.9 rad crouch
//     (`userData.bike.maxLean`), chest on the spine pad, head up behind the
//     screen -- riderpose.solveSeat searches the lean up to it.
// `userData.bike.hubZ` is the pivot the game rocks the machine about.

export default function (THREE) {
  const opts = arguments[1] || {};
  const g = new THREE.Group();
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- materials
  // FLAT SHADED everywhere: the facets are the look.
  const std = (c, r, m, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, flatShading: true, ...extra });
  const tag = (m, livery) => { m.userData.livery = livery; return m; };
  const orange = tag(std(opts.bodyColor ?? 0xe0621a, 0.42, 0.35), 'body');
  const trim   = tag(std(opts.accentColor ?? 0x15161a, 0.5, 0.4), 'accent');
  const armour = std(0x2c2f35, 0.5, 0.55);          // matte gunmetal
  const dark   = std(0x16171a, 0.62, 0.3);
  const metal  = std(0x7d828a, 0.32, 0.85);
  const rubber = std(0x151516, 0.92, 0.0);
  const seatM  = std(0x1d1d20, 0.8, 0.05);
  const glass  = new THREE.MeshPhysicalMaterial({ color: 0x9fd6e8, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.28,
    side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, flatShading: true });
  const hud    = new THREE.MeshBasicMaterial({ color: 0x46e6ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const lamp   = std(0xfff3d6, 0.4, 0.0, { emissive: 0xfff3d6, emissiveIntensity: 1.8 });
  const amber  = std(0xffa12a, 0.4, 0.0, { emissive: 0xff8a10, emissiveIntensity: 1.4 });
  const redL   = std(0xd81e12, 0.4, 0.0, { emissive: 0xd01c12, emissiveIntensity: 1.6 });
  const ember  = std(0xff6a1a, 0.5, 0.0, { emissive: 0xff5a10, emissiveIntensity: 1.5 });

  const mesh = (geo, m, parent = g) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };

  // ------------------------------------------------------------ geometry kit
  /** Connect equal-length rings of [x,y,z] into a closed-ended tube. */
  function rings(R, caps = true) {
    const pos = [], idx = [], n = R[0].length;
    for (const r of R) for (const p of r) pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < R.length - 1; i++) for (let k = 0; k < n; k++) {
      const a = i * n + k, b = i * n + (k + 1) % n, c = a + n, d = b + n;
      idx.push(a, b, c, b, d, c);
    }
    if (caps) for (const [ri, flip] of [[0, true], [R.length - 1, false]]) {
      const r = R[ri], ci = pos.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; }
      pos.push(cx / n, cy / n, cz / n);
      for (let k = 0; k < n; k++) {
        const a = ri * n + k, b = ri * n + (k + 1) % n;
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }
  /**
   * A HULL, symmetric in x: stations {z, pts} where pts is the right half of
   * the cross-section, from the centreline at the bottom round to the
   * centreline at the top ([0, y] ... [0, y]). Mirrored into a closed ring.
   */
  function hull(st, dx = 0) {
    return rings(st.map(({ z, pts }) => {
      const right = pts.map(([x, y]) => [x + dx, y, z]);
      const left = pts.slice(1, -1).reverse().map(([x, y]) => [-x + dx, y, z]);
      return [...right, ...left];
    }));
  }
  /** A flat plate: polygon [[z, y], ...] extruded `t` thick, its outer face at x = xOut (sign = side). */
  function plate(poly, t, xOut, m, parent = g) {
    const sh = new THREE.Shape(poly.map(([z, y]) => new THREE.Vector2(z, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2);                 // shape x -> +z, extrusion -> -x
    const o = mesh(geo, m, parent);
    o.position.x = xOut > 0 ? xOut : xOut + t;
    return o;
  }
  /** Merge plain (non-indexed or indexed) geometries into one. */
  function merge(list) {
    const pos = [], idx = []; let base = 0;
    for (const geo of list) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
      if (geo.index) for (const i of geo.index.array) idx.push(i + base);
      else for (let i = 0; i < p.length / 3; i++) idx.push(i + base);
      base += p.length / 3;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setIndex(idx); out.computeVertexNormals();
    return out;
  }

  // ------------------------------------------------------------- dimensions
  const R = 0.64, TW = 0.24;                     // tyre radius, half width
  const hub = { y: R, z: 0.20 };
  const LIFT = 0.52, SEAT_Y = 0.875 + LIFT;       // this machine's saddle top
  const tyreTop = (z) => { const d = z - hub.z; return Math.abs(d) >= R ? 0 : hub.y + Math.sqrt(R * R - d * d); };

  // ---------------------------------------------------------------- the wheel
  const wheel = new THREE.Group(); wheel.position.set(0, hub.y, hub.z); g.add(wheel);
  {
    // THE TYRE: a fat car-like section lathed in 28 facets
    const prof = [[0.40, -0.215], [0.50, -0.245], [0.585, -0.24], [0.625, -0.20], [R, -0.12], [R, 0.12], [0.625, 0.20], [0.585, 0.24], [0.50, 0.245], [0.40, 0.215]];
    const tg = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), 28);
    tg.rotateZ(Math.PI / 2);
    mesh(tg, rubber, wheel);
    // CHUNKY TREAD: staggered blocks, three across, one merged mesh
    const blocks = [];
    const N = 28;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const xs = i & 1 ? [-0.165, 0.0, 0.165] : [-0.115, 0.115];
      for (const x of xs) {
        const b = new THREE.BoxGeometry(i & 1 ? 0.085 : 0.12, 0.036, 0.085);
        b.translate(x, R + 0.012, 0);
        b.rotateX(a + (i & 1 ? 0 : TAU / N / 2));
        blocks.push(b);
      }
      // shoulder lugs down each sidewall
      for (const s of [-1, 1]) {
        const b = new THREE.BoxGeometry(0.03, 0.07, 0.07);
        b.translate(s * (TW + 0.004), R - 0.06, 0);
        b.rotateX(a);
        blocks.push(b);
      }
    }
    mesh(merge(blocks), rubber, wheel);
    // THE RIM: a deep black dish, an orange lip each side
    const rim = [[0.40, -0.205], [0.385, -0.17], [0.27, -0.13], [0.21, -0.15], [0.21, 0.15], [0.27, 0.13], [0.385, 0.17], [0.40, 0.205]];
    const rg = new THREE.LatheGeometry(rim.map(([r, a]) => new THREE.Vector2(r, a)), 18);
    rg.rotateZ(Math.PI / 2);
    const rimM = mesh(rg, dark, wheel); rimM.material = dark.clone(); rimM.material.side = THREE.DoubleSide;
    for (const s of [-1, 1]) {
      const lip = mesh(new THREE.TorusGeometry(0.395, 0.016, 4, 18), orange, wheel);
      lip.rotation.y = Math.PI / 2; lip.position.x = s * 0.2;
      // six heavy wedge spokes
      for (let i = 0; i < 6; i++) {
        const sp = mesh(new THREE.BoxGeometry(0.05, 0.19, 0.07), armour, wheel);
        const a = (i / 6) * TAU + (s > 0 ? 0 : TAU / 12);
        sp.position.set(s * 0.15, Math.sin(a) * 0.29, Math.cos(a) * 0.29);
        sp.rotation.x = -a + Math.PI / 2;
      }
    }
    // THE HUB MOTOR: a faceted drum with orange covers and a black cap
    const drum = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 10), armour, wheel); drum.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) {
      const cov = mesh(new THREE.CylinderGeometry(0.155, 0.17, 0.03, 10), orange, wheel);
      cov.rotation.z = Math.PI / 2; cov.position.x = s * 0.19;
      const cap = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 8), dark, wheel);
      cap.rotation.z = Math.PI / 2; cap.position.x = s * 0.215;
    }
  }

  // ------------------------------------------------------- the armoured nose
  // An inverted-U hull straddling the tyre: the tunnel roof clears the tread by
  // 3 cm, the flanks come down either side, and it closes into a sharp beak in
  // front of the tyre.
  const fairing = new THREE.Group(); g.add(fairing);
  {
    const WI = TW + 0.035;
    const S = (z, roof, yb, top, wo, wt, ridge, wi = WI) => ({ z, pts: [
      [0, roof], [wi, roof], [wi, yb], [wo, yb], [wo + 0.02, (yb + top) / 2], [wt, top], [0, top + ridge],
    ] });
    const st = [
      S(-0.12, tyreTop(-0.12) + 0.03, 1.10, 1.36, 0.33, 0.20, 0.02),
      S(0.08, tyreTop(0.08) + 0.03, 1.00, 1.42, 0.40, 0.24, 0.03),
      S(0.34, tyreTop(0.34) + 0.03, 0.88, 1.44, 0.45, 0.27, 0.03),
      S(0.58, tyreTop(0.58) + 0.03, 0.72, 1.42, 0.46, 0.28, 0.02),
      S(0.80, tyreTop(0.80) + 0.03, 0.58, 1.34, 0.45, 0.28, 0.02),
      S(0.98, 0.55, 0.50, 1.20, 0.42, 0.26, 0.02, 0.05),
      S(1.16, 0.58, 0.54, 1.06, 0.34, 0.20, 0.02, 0.04),
      S(1.30, 0.72, 0.70, 0.92, 0.18, 0.10, 0.01, 0.02),
      S(1.40, 0.84, 0.83, 0.86, 0.03, 0.02, 0.0, 0.01),
    ];
    mesh(hull(st), armour, fairing);
    // a dark chin splitter under the beak
    mesh(hull([
      { z: 0.90, pts: [[0, 0.46], [0.38, 0.46], [0.38, 0.51], [0, 0.51]] },
      { z: 1.30, pts: [[0, 0.66], [0.14, 0.66], [0.14, 0.70], [0, 0.70]] },
    ]), dark, fairing);
    // THE SLASH PANELS: orange, the concept's Z-cut down each flank, with black vents
    for (const s of [-1, 1]) {
      const xo = (x) => s * x;
      plate([[-0.08, 1.20], [0.44, 1.16], [0.92, 0.96], [1.10, 0.74], [0.84, 0.70], [0.50, 0.96], [0.02, 1.07]], 0.02, xo(0.48), orange, fairing);
      plate([[0.30, 0.84], [0.70, 0.70], [0.78, 0.60], [0.40, 0.66]], 0.02, xo(0.48), orange, fairing);
      plate([[0.10, 0.99], [0.56, 0.92], [0.68, 0.84], [0.30, 0.88], [0.06, 0.94]], 0.02, xo(0.48), trim, fairing);
      for (let i = 0; i < 3; i++) {
        const v = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), dark, fairing);
        v.position.set(s * 0.475, 1.13 - i * 0.045, 0.30 + i * 0.07); v.rotation.x = 0.35;
      }
      // twin nose lamps, angular slits, and an amber marker on each cheek
      const l = mesh(new THREE.BoxGeometry(0.13, 0.03, 0.05), lamp, fairing);
      l.position.set(s * 0.10, 0.93, 1.28); l.rotation.set(-0.5, s * 0.35, s * 0.18);
      const a = mesh(new THREE.BoxGeometry(0.02, 0.025, 0.08), amber, fairing);
      a.position.set(s * 0.44, 1.14, 0.80);
    }
    // the orange ridge stripe along the top of the nose
    mesh(hull([
      { z: 0.00, pts: [[0, 1.385], [0.05, 1.385], [0.05, 1.40], [0, 1.405]] },
      { z: 0.40, pts: [[0, 1.435], [0.07, 1.435], [0.07, 1.452], [0, 1.456]] },
      { z: 0.85, pts: [[0, 1.30], [0.06, 1.30], [0.06, 1.32], [0, 1.322]] },
      { z: 1.28, pts: [[0, 0.93], [0.03, 0.93], [0.03, 0.95], [0, 0.952]] },
    ]), orange, fairing);
  }

  // ------------------------------------------------ the screen and the HUD
  // A big glass bubble over the nose; the heads-up display is drawn on its
  // inside in shapes only (rings, bars, an arc), facing the rider.
  {
    const cols = 11, rowsZ = [0.16, 0.30, 0.46, 0.64, 0.82, 0.98, 1.12, 1.24];
    // base: where the glass meets the nose; top: its crown, over the helmet
    const base = (z) => (z < 0.6 ? 1.45 : z < 1.0 ? 1.45 - (z - 0.6) * 0.6 : 1.21 - (z - 1.0) * 1.2);
    const top = (z) => (z < 0.34 ? 1.60 + (z - 0.16) * 0.8 : z < 0.64 ? 1.744 : z < 1.0 ? 1.744 - (z - 0.64) * 0.75 : 1.474 - (z - 1.0) * 1.9);
    const half = (z) => (z < 0.8 ? 0.39 : 0.39 - (z - 0.8) * 0.6);
    const pos = [], idx = [];
    rowsZ.forEach((z, r) => {
      for (let c = 0; c < cols; c++) {
        const u = (c / (cols - 1)) * 2 - 1;
        const h = Math.pow(Math.cos(u * Math.PI / 2), 0.55);
        pos.push(u * half(z), base(z) + (top(z) - base(z)) * h, z);
        if (r && c) { const a = (r - 1) * cols + c - 1, b = a + 1, d = r * cols + c - 1; idx.push(a, d, b, b, d, d + 1); }
      }
    });
    // the rear edge closed down to the spine, so it reads as a bubble
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const scr = mesh(geo, glass, fairing); scr.castShadow = false;
    // a dark frame along its base
    for (const s of [-1, 1]) {
      const pts = rowsZ.map((z) => new THREE.Vector3(s * half(z), base(z), z));
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.014, 4), trim, fairing);
    }
    // HUD: a tilted panel of lit shapes behind the glass, facing back at the rider
    const H = new THREE.Group(); H.position.set(0, 1.55, 0.78); H.rotation.x = -0.75; H.scale.setScalar(1.3); fairing.add(H);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.085, 20), hud); ring.position.set(0, 0.02, 0); H.add(ring);
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.095, 0.11, 20, 1, Math.PI * 0.15, Math.PI * 0.7), hud); arc.position.set(0, 0.02, 0); H.add(arc);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.02, 8), hud); dot.position.set(0, 0.02, 0); H.add(dot);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.07 - i * 0.012, 0.012), hud);
        bar.position.set(s * 0.18, 0.06 - i * 0.03, 0); H.add(bar);
      }
      const bracket = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.12), hud); bracket.position.set(s * 0.13, 0.02, 0); H.add(bracket);
    }
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.004), hud); line.position.set(0, -0.08, 0); H.add(line);
    H.traverse((n) => { if (n.isMesh) { n.rotation.y = Math.PI; n.castShadow = false; n.receiveShadow = false; } });
  }

  // ----------------------------------------- the spine, the saddle, the tail
  // THE SPINE: a padded ridge from the saddle up onto the nose -- what the
  // rider's chest rests on
  mesh(hull([
    { z: -0.20, pts: [[0, tyreTop(-0.20) + 0.03], [0.17, tyreTop(-0.20) + 0.03], [0.19, 1.30], [0.13, 1.35], [0, 1.36]] },
    { z: 0.00, pts: [[0, tyreTop(0.0) + 0.03], [0.19, tyreTop(0.0) + 0.03], [0.21, 1.33], [0.14, 1.37], [0, 1.38]] },
    { z: 0.22, pts: [[0, tyreTop(0.22) + 0.03], [0.19, tyreTop(0.22) + 0.03], [0.21, 1.36], [0.14, 1.41], [0, 1.42]] },
  ]), seatM);
  // THE SADDLE: its top is this machine's seat contact
  mesh(hull([
    { z: -0.60, pts: [[0, 1.26], [0.12, 1.26], [0.15, 1.33], [0.10, SEAT_Y + 0.02], [0, SEAT_Y + 0.025]] },
    { z: -0.40, pts: [[0, 1.26], [0.17, 1.26], [0.19, 1.33], [0.13, SEAT_Y - 0.005], [0, SEAT_Y]] },
    { z: -0.20, pts: [[0, 1.24], [0.17, 1.24], [0.19, 1.32], [0.13, SEAT_Y - 0.005], [0, SEAT_Y]] },
  ]), seatM);
  // THE BODY under the saddle, behind the tyre: battery / motor box with vents
  mesh(hull([
    { z: -1.10, pts: [[0, 1.12], [0.12, 1.12], [0.17, 1.20], [0.15, 1.30], [0, 1.31]] },
    { z: -0.80, pts: [[0, 0.92], [0.21, 0.92], [0.28, 1.06], [0.25, 1.27], [0, 1.28]] },
    { z: -0.48, pts: [[0, 0.86], [0.22, 0.86], [0.31, 1.02], [0.27, 1.27], [0, 1.28]] },
  ]), armour);
  // THE TAIL BOOM: thin, rising, a sharp tip, an orange blade on top
  mesh(hull([
    { z: -0.60, pts: [[0, 1.27], [0.17, 1.27], [0.19, 1.36], [0.12, 1.41], [0, 1.42]] },
    { z: -1.05, pts: [[0, 1.32], [0.14, 1.32], [0.16, 1.42], [0.10, 1.48], [0, 1.49]] },
    { z: -1.50, pts: [[0, 1.46], [0.07, 1.46], [0.08, 1.52], [0.04, 1.56], [0, 1.57]] },
    { z: -1.72, pts: [[0, 1.56], [0.01, 1.56], [0.01, 1.58], [0.005, 1.59], [0, 1.59]] },
  ]), armour);
  mesh(hull([
    { z: -0.66, pts: [[0, 1.415], [0.08, 1.415], [0.08, 1.425], [0, 1.43]] },
    { z: -1.50, pts: [[0, 1.56], [0.035, 1.56], [0.035, 1.572], [0, 1.575]] },
  ]), orange);
  // the tail lamp: a red blade under the tip
  { const t = mesh(new THREE.BoxGeometry(0.16, 0.03, 0.06), redL); t.position.set(0, 1.45, -1.50); t.rotation.x = -0.3; }

  // ------------------------------------------ the side beams to the hub axle
  const swing = new THREE.Group(); g.add(swing);
  for (const s of [-1, 1]) {
    const xo = s * (TW + 0.10);
    plate([[-0.90, 1.26], [-0.44, 1.26], [0.02, 0.88], [0.30, 0.74], [0.30, 0.54], [0.08, 0.54], [-0.46, 0.96], [-0.90, 1.02]], 0.055, xo, armour, swing);
    plate([[-0.84, 1.20], [-0.46, 1.20], [-0.08, 0.88], [-0.02, 0.82], [-0.40, 1.02], [-0.84, 1.06]], 0.012, s * (TW + 0.112), orange, swing);
    const axle = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.08, 8), metal, swing);
    axle.rotation.z = Math.PI / 2; axle.position.set(s * (TW + 0.09), hub.y, hub.z);
    // the rear-set peg on a short hanger
    const peg = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6), rubber, swing);
    peg.rotation.z = Math.PI / 2; peg.position.set(s * 0.36, 0.92, -0.70);
    const hang = mesh(new THREE.BoxGeometry(0.03, 0.2, 0.05), metal, swing);
    hang.position.set(s * 0.33, 1.00, -0.68); hang.rotation.x = 0.3;
  }

  // ------------------------------------------------------------ the exhausts
  // four pipes under the tail, two a side, dark tips with embers inside
  for (const s of [-1, 1]) for (const [x, y] of [[0.12, 1.14], [0.24, 1.08]]) {
    const pts = [new THREE.Vector3(s * x * 0.8, y - 0.1, -0.45), new THREE.Vector3(s * x, y, -0.90), new THREE.Vector3(s * x, y + 0.1, -1.40)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.05, 7), dark);
    const tip = mesh(new THREE.CylinderGeometry(0.068, 0.06, 0.2, 7), metal);
    tip.rotation.x = Math.PI / 2 + 0.2; tip.position.set(s * x, y + 0.12, -1.46);
    const glow = mesh(new THREE.CircleGeometry(0.048, 7), ember);
    glow.position.set(s * x, y + 0.14, -1.565); glow.rotation.set(0.2, Math.PI, 0);
  }

  // ------------------------------------------------------------- the bars
  // very wide clip-ons out of the nose's flanks, well outboard of the screen
  const GRIP = { x: 0.56, y: 1.36, z: 0.62 };
  // A MONOWHEEL STEERS BY LEANING: the bars are fixed to the nose. The contract's
  // `frontSteer` is still published (the game writes the steer angle to it every
  // frame) but carries nothing -- on 0.56 m clip-ons a real steer angle swung
  // the grips 16 cm out from under the rider's hands.
  const frontSteer = new THREE.Group(); frontSteer.position.set(0, GRIP.y, GRIP.z); g.add(frontSteer);
  const bars = new THREE.Group(); bars.position.copy(frontSteer.position); fairing.add(bars);
  for (const s of [-1, 1]) {
    const arm = mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), metal, bars); arm.position.set(s * 0.40, -0.02, 0.0); arm.rotation.z = s * -0.12;
    const grip = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), rubber, bars);
    grip.rotation.z = Math.PI / 2; grip.position.set(s * GRIP.x, 0, 0);
    const end = mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8), orange, bars);
    end.rotation.z = Math.PI / 2; end.position.set(s * (GRIP.x + 0.075), 0, 0);
    const lever = mesh(new THREE.BoxGeometry(0.14, 0.012, 0.02), metal, bars);
    lever.position.set(s * (GRIP.x - 0.02), 0, 0.07); lever.rotation.y = s * 0.2;
  }

  g.userData.joints = { frontSteer, frontWheel: wheel, rearWheel: wheel, swing, bars, fairing };
  g.userData.grounded = true;
  g.userData.contacts = {
    seat:  new THREE.Vector3(0, SEAT_Y, -0.28),
    grip:  new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z),
    peg:   new THREE.Vector3(0.36, 0.92, -0.70),
  };
  g.userData.bike = { kind: 'mono', wheelR: R, wheelbase: 0, length: 3.1, height: 1.75, mono: true, hubZ: hub.z,
    seatLift: LIFT, minLean: 1.45, maxLean: 1.55 };
  return g;
}
