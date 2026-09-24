// Rider — seated on a bike, articulated for combat and crashing.
//
// EVERY DIMENSION NOW COMES FROM A BODY SPEC (src/bodyspec.js). This file used
// to contain 40-odd literal numbers, which meant no two bodies could be made the
// same way and every joint had to be kept in agreement by hand. It now takes a
// spec and derives every position and every mesh size from it, so a body is
// consistent by construction and the showroom can rebuild one live.
//
// Joints named on userData. Arms have shoulder + elbow; legs hip + knee.
// Load with { keepHierarchy: true } — merging would weld the limbs solid.
export default function (THREE) {
  const g = new THREE.Group();
  const opts = arguments[1] || {};
  // THE SPEC IS REQUIRED AND IS PASSED IN. This module may not `import` (see
  // asset-contract.md:22 -- no imports, no network, no eval, no timers), so it
  // cannot reach src/bodyspec.js and must NOT grow a second copy of the
  // proportions: a duplicated table is a table that drifts, which is the whole
  // defect this refactor exists to remove. The caller builds the spec and hands
  // it over; a caller that forgets gets a clear error instead of a silently
  // mis-sized body.
  const S = opts.spec;
  if (!S) throw new Error('rider.js requires opts.spec -- build one with makeSpec() from src/bodyspec.js');
  if (typeof S.height !== 'number' || !(S.height > 0.5 && S.height < 2.6)) {
    throw new Error(`rider.js: implausible spec.height ${S.height}`);
  }
  // THE RIDING POSE, HANDED IN. This module may not import, so it cannot reach
  // src/reach.js and the pose constants have to arrive as an argument -- the same
  // rule, and the same reason, as `opts.spec`. The defaults below are the
  // measured values and match src/reach.js's RIDING table; a caller that passes
  // `opts.ride` overrides them. Keeping the literals ONLY here (as the fallback)
  // and reading the live values from the caller is what stops the rig's rest pose
  // from drifting away from the pose the race actually plays.
  const R = opts.ride || {};

  const C = S.colors;

  // ---- materials ----------------------------------------------------------
  // Worn leather is not matte -- a slightly glossy hide with a broad, soft
  // highlight -- and a helmet is a hard clearcoated shell, so both are clearcoat
  // materials. FLAT SHADING on the cloth and hide: STYLE-LOCK asks for chunky
  // low-poly masses with visible facets, and an 8-sided lathe smooth-shaded
  // reads as a plastic tube (the old capsules did exactly that); flat-shaded it
  // reads as a cut, hand-authored mass.
  const P = (c, r, m, cc, ccr, flat) => new THREE.MeshPhysicalMaterial({
    color: c, roughness: r, metalness: m, clearcoat: cc, clearcoatRoughness: ccr, flatShading: !!flat,
  });
  const M = (c, r, m, flat) => new THREE.MeshStandardMaterial({ color: c, roughness: r ?? 0.7, metalness: m ?? 0.05, flatShading: !!flat });
  const shade = (hex, k) => {               // darker / lighter variant of a spec colour
    const col = new THREE.Color(hex); col.multiplyScalar(k); return col;
  };
  const leather = P(C.jacket, 0.46, 0.08, 0.55, 0.28, true); leather.name = 'fabric';
  const seam    = P(shade(C.jacket, 0.55), 0.6, 0.05, 0.2, 0.5, true); seam.name = 'fabric';
  const pad     = P(shade(C.jacket, 0.75), 0.38, 0.10, 0.7, 0.2, true); pad.name = 'fabric';   // armour panels: harder hide
  const padIn   = pad.clone(); padIn.side = THREE.DoubleSide;   // open domes show their inside
  const denim   = M(C.pants, 0.90, 0.02, true);  denim.name = 'fabric';   // cloth stays matte
  const cuffMat = M(shade(C.pants, 1.25), 0.92, 0.02, true); cuffMat.name = 'fabric';  // turned-up hem shows the lighter inside
  const skin    = M(C.skin, 0.78, 0.0); skin.name = 'plaster';
  const glass   = P(0x2a333c, 0.05, 0.20, 1.0, 0.01);            // visor: hard gloss
  const bone    = P(C.helmet, 0.18, 0.08, 1.0, 0.03);            // helmet shell
  const trim    = M(0x1b1b1e, 0.6, 0.05, true); trim.name = 'fabric';   // helmet rubber, soles
  const boot    = P(0x1f1c1a, 0.52, 0.10, 0.45, 0.32, true); boot.name = 'fabric';
  const glove   = P(0x232020, 0.62, 0.05, 0.3, 0.4, true); glove.name = 'fabric';
  const accent  = M(C.accent, 0.55, 0.05, true);
  const steel   = M(0x8a9199, 0.34, 0.86); steel.name = 'metal';

  const mk = (geo, mat, x, y, z, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };

  // A CHAMFERED BOX: a rectangle extruded with a one-segment bevel, so every
  // edge is a 45-degree facet. STYLE-LOCK's "hard chamfered edges" -- a raw
  // BoxGeometry has knife edges that alias to a single-pixel line at speed.
  const cbox = (w, h, d, c) => {
    c = Math.max(0.001, Math.min(c, w * 0.3, h * 0.3, d * 0.3));
    const sh = new THREE.Shape();
    const x = w / 2 - c, y = h / 2 - c;
    sh.moveTo(-x, -y); sh.lineTo(x, -y); sh.lineTo(x, y); sh.lineTo(-x, y); sh.lineTo(-x, -y);
    const geo = new THREE.ExtrudeGeometry(sh, {
      depth: Math.max(0.001, d - 2 * c), bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1,
    });
    geo.translate(0, 0, -(d - 2 * c) / 2);
    return geo;
  };
  // A SHAPED SEGMENT: a lathe down local -Y from the joint, `prof` = [[t, r], ...]
  // with t 0..1 along `len` and r a radius. Capped at both ends. 8 sides: the
  // octagon is the chunky facet the style asks for, and a muscle / taper along
  // the length is what separates an arm from a pipe.
  // phiStart = pi/sides puts a FLAT FACE (not a vertex) at the front and back,
  // so a torso does not come out diamond-section and details lie on it.
  const seg = (len, prof, sides = 8) => {
    const pts = [new THREE.Vector2(0.0001, 0)];
    for (const [t, r] of prof) pts.push(new THREE.Vector2(r, -t * len));
    pts.push(new THREE.Vector2(0.0001, -len));
    return new THREE.LatheGeometry(pts, sides, Math.PI / sides);
  };
  const R0 = S.limbR;

  // ---- pelvis: the root everything hangs off -------------------------------
  // The spec gives the standing hip height; the rig is built so the PELVIS joint
  // sits at the hip. `seatContactY` (on the spec) is how far the BOTTOM of this
  // pelvis block is above the feet, which is what a saddle has to meet -- so the
  // seat block keeps its exact spec size and only gains a belt on top.
  const pelvis = new THREE.Group();
  pelvis.position.set(0, S.hipY, 0);
  g.add(pelvis);
  pelvis.add(mk(cbox(S.pelvisW, S.pelvisH, S.pelvisD, 0.03), denim, 0, 0, 0));
  // belt, and a steel buckle at the front
  pelvis.add(mk(cbox(S.pelvisW * 1.03, S.pelvisH * 0.2, S.pelvisD * 1.03, 0.012), seam, 0, S.pelvisH * 0.42, 0));
  pelvis.add(mk(cbox(0.06, S.pelvisH * 0.2, 0.014, 0.004), steel, 0, S.pelvisH * 0.42, S.pelvisD * 0.52));
  // back pockets, as raised panels
  for (const s of [-1, 1]) pelvis.add(mk(cbox(S.pelvisW * 0.3, S.pelvisH * 0.42, 0.012, 0.004), denim, s * S.pelvisW * 0.22, -S.pelvisH * 0.04, -S.pelvisD * 0.51));

  // ---- torso, pitched forward into a racing tuck ----
  const torso = new THREE.Group();
  torso.position.set(0, S.pelvisD * 0.42, 0);
  // POSITIVE x LEANS THE RIDER FORWARD. This was `-S.tuck`, and MEASURED live
  // that put the shoulder 0.41 m BEHIND the hip at a full lean -- the rider
  // reclining, not crouching. harness/_trunksign.mjs sweeps the joint and reads
  // the shoulder relative to the hip:
  //
  //     torso.x = -1.0  ->  shoulder 0.409 m BEHIND the hip
  //     torso.x = +0.2  ->  shoulder 0.108 m FORWARD
  //     torso.x = +1.0  ->  shoulder 0.420 m FORWARD
  //
  // The trunk's shoulder slab sits at +Y above the joint, so a NEGATIVE x
  // rotation swings it backwards. Every negative torso value in this project was
  // leaning the rider the wrong way, which is why his head sat over the tail and
  // his arms could never reach the bars: the shoulder was moving away from them.
  torso.rotation.x = R.torsoRest ?? S.tuck;
  pelvis.add(torso);
  const T = S.trunk, TW = S.torsoW, TD = S.torsoD;
  // THE JACKET: a lathe of the trunk, waist -> chest -> under the yoke, made
  // elliptical by scaling z. Radii in units of half the torso width; the chest
  // is 12% wider than the waist, which is the taper that says "man" rather than
  // "barrel". The back is the same lathe, so it reads from behind too.
  // The profile is exaggerated at the top (1.24x the waist at the pecs): the
  // spec's shoulder pivots sit 0.67 m apart at 1.75 m, so a chest the width of
  // the waist leaves the arms hanging off a pole. Chunky and heroic, per
  // STYLE-LOCK's "exaggerated proportions".
  const TRUNK_PROF = [[0.0, 0.86], [0.10, 0.90], [0.40, 1.02], [0.62, 1.14], [0.82, 1.24], [1.0, 1.18]];
  const TRUNK_LEN = T * 0.90;
  const trunkGeo = seg(TRUNK_LEN, TRUNK_PROF);
  trunkGeo.rotateX(Math.PI);                  // grow UP from the lumbar joint
  const trunk = mk(trunkGeo, leather, 0, 0.0, 0);
  trunk.scale.set(TW * 0.5, 1, TD * 0.5);
  // the jacket's surface half-depth at height y: details are placed ON it, not
  // at a guessed constant (at a constant they float 3 cm off the waist)
  const surf = (y) => {
    const t = Math.max(0, Math.min(1, y / TRUNK_LEN));
    for (let i = 1; i < TRUNK_PROF.length; i++) {
      const [t0, r0] = TRUNK_PROF[i - 1], [t1, r1] = TRUNK_PROF[i];
      if (t <= t1) return (r0 + (r1 - r0) * (t - t0) / (t1 - t0)) * TD * 0.5 * Math.cos(Math.PI / 8);
    }
    return TRUNK_PROF[TRUNK_PROF.length - 1][1] * TD * 0.5;
  };
  torso.add(trunk);
  // THE SHOULDER LINE: one rounded mass from deltoid to deltoid, a lathe laid
  // along X -- full round over the trapezius, tapering into each shoulder
  // ball. This replaced a flat chamfered slab 1.4 shoulder-widths wide, which
  // from behind read as a robot's yoke (the old block also did this).
  {
    const half = S.shoulderW * 0.76;
    const pts = [];
    for (const [t, r] of [[-1.0, 0.0001], [-1.0, 0.62], [-0.8, 0.86], [-0.45, 1.0], [0.45, 1.0], [0.8, 0.86], [1.0, 0.62], [1.0, 0.0001]]) pts.push(new THREE.Vector2(r, t * half));
    const geo = new THREE.LatheGeometry(pts, 8);
    geo.rotateZ(Math.PI / 2);
    const yoke = mk(geo, leather, 0, T * 0.94, TD * 0.03);
    yoke.scale.set(1, T * 0.15, TD * 0.46);
    torso.add(yoke);
  }
  // yoke seam (front and back) and the side panel seams: raised dark welts
  // yoke seam front and back, a spine welt, and the offset biker's zip --
  // each a short run laid on the jacket surface at its own height
  // (the flat front face is 0.38 of the local radius each side of centre, so
  // every detail stays within |x| < 0.3 r and sits on it)
  for (const z of [1, -1]) torso.add(mk(cbox(TW * 0.36, 0.012, 0.012, 0.003), seam, 0, T * 0.78, z * (surf(T * 0.78) + 0.004)));
  for (let k = 0; k < 4; k++) {
    const y = T * (0.18 + k * 0.15);
    torso.add(mk(cbox(0.012, T * 0.15, 0.012, 0.003), seam, 0, y, -(surf(y) + 0.003)));
    const x = TW * (0.07 - k * 0.018);
    torso.add(mk(cbox(0.02, T * 0.155, 0.01, 0.003), seam, x, y, surf(y) + 0.002, 0, 0, -0.1));
    torso.add(mk(cbox(0.008, T * 0.155, 0.012, 0.002), steel, x, y, surf(y) + 0.006, 0, 0, -0.1));
  }
  torso.add(mk(cbox(0.02, 0.034, 0.014, 0.004), steel, TW * 0.03, T * 0.70, surf(T * 0.70) + 0.01));   // the pull
  // waistband: the hem of the jacket, a slightly proud ring over the belt
  const hem = mk(new THREE.CylinderGeometry(1, 1, T * 0.08, 8), pad, 0, T * 0.03, 0);
  hem.scale.set(TW * 0.47, 1, TD * 0.47);
  torso.add(hem);
  // jacket collar: a short open cone, stood up and open at the front
  const collar = mk(new THREE.CylinderGeometry(S.headR * 0.62, S.headR * 0.78, T * 0.12, 8, 1, true, Math.PI * 0.18, Math.PI * 1.64),
    leather, 0, T * 1.14, TD * 0.02);
  collar.material = leather.clone(); collar.material.side = THREE.DoubleSide; collar.material.name = 'fabric';
  // (theta 0 is +Z, so the 0.36 pi gap left by thetaStart/Length is at the front)
  torso.add(collar);

  // ---- head: helmet + visor + neck ----
  const neck = new THREE.Group();
  neck.position.set(0, T * 1.13, TD * 0.04);
  torso.add(neck);
  neck.add(mk(new THREE.CylinderGeometry(S.headR * 0.38, S.headR * 0.44, S.neckLen, 8), skin, 0, S.neckLen * 0.5, 0));
  const head = new THREE.Group();
  head.position.set(0, S.neckLen, 0);
  neck.add(head);
  // the default helmet: a full-face lid (gear_*.js overlays can replace it)
  const shell = mk(new THREE.SphereGeometry(S.headR, 14, 10), bone, 0, S.headH * 0.34, 0);
  shell.scale.set(1, 1.08, 1.12);
  head.add(shell);
  // VISOR: a band cut from a slightly larger sphere, so it wraps the face
  // instead of floating in front of it as a flat card
  const visor = mk(new THREE.SphereGeometry(S.headR * 1.035, 14, 4, Math.PI * 0.5 - 1.0, 2.0, 0.86, 0.90), glass, 0, S.headH * 0.34, 0);
  visor.scale.set(1, 1.08, 1.12);
  visor.material.side = THREE.DoubleSide;
  head.add(visor);
  // chin bar, chamfered, and the rubber neck roll the lid sits on
  // CHIN BAR: the lower front of a larger sphere, pushed forward -- a guard
  // that wraps the jaw. It was a 1.3 x 0.9 head-radius cube on the face.
  const chin = mk(new THREE.SphereGeometry(S.headR * 1.03, 14, 4, Math.PI * 0.5 - 1.15, 2.3, 1.62, 0.95), bone, 0, S.headH * 0.30, S.headR * 0.05);
  chin.scale.set(1.0, 1.3, 1.36);   // deeper and further forward than the shell: it has to read as a jaw guard
  chin.material = bone.clone(); chin.material.side = THREE.DoubleSide;
  head.add(chin);
  const roll = mk(new THREE.CylinderGeometry(S.headR * 0.86, S.headR * 0.80, S.headH * 0.12, 10), trim, 0, -S.headH * 0.30, -S.headR * 0.08);
  roll.scale.set(1, 1, 1.1);
  head.add(roll);
  // helmet stripe, hazard colour -- no glyphs
  // A MERIDIAN BAND cut from a sphere 1.5% larger than the shell, front and
  // back, so the stripe lies ON the lid. It used to be a box 1.46 head-heights
  // tall standing through the shell, which read as a fin / mohawk on top.
  for (const ph of [Math.PI * 0.5, Math.PI * 1.5]) {
    const band = mk(new THREE.SphereGeometry(S.headR * 1.015, 3, 8, ph - 0.2, 0.4, 0, Math.PI * 0.62), accent, 0, S.headH * 0.34, 0);
    band.scale.set(1, 1.08, 1.12);
    head.add(band);
  }
  // visor pivots
  for (const s of [-1, 1]) head.add(mk(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8), steel, s * S.headR * 1.02, S.headH * 0.36, S.headR * 0.28, 0, 0, Math.PI / 2));

  // ---- arms: shoulder -> upper -> elbow -> forearm -> glove ----
  // EVERY length here is the spec's, and the joint positions are derived from
  // the segment lengths, so changing the spec cannot leave a limb floating.
  //
  // SIDES ARE ANATOMICAL. The rider faces +Z with +Y up, so his LEFT is +X.
  // This loop used to put `left` at -X, which made every "right arm" the
  // rider's left (the punch naming was mirrored on screen) and made every
  // outward splay written for `left` in poseStanding / dismount.js actually
  // fold the arm INTO the body. Joint NAMES are unchanged; which side of the
  // body each name is on is now the anatomical one.
  const arms = {};
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 1 : -1;
    const shoulder = new THREE.Group();
    shoulder.position.set(s * S.shoulderW * 0.76, T * 0.97, TD * 0.04);
    torso.add(shoulder);
    shoulder.add(mk(new THREE.SphereGeometry(R0 * 1.29, 8, 6), leather, 0, 0, 0));
    // shoulder armour: a dome over the ball, tipped outward -- a cap that
    // follows the shoulder rather than a box standing on it
    const cap = mk(new THREE.SphereGeometry(R0 * 1.42, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.5), padIn, s * R0 * 0.06, R0 * 0.02, 0, 0, 0, -s * 0.22);
    shoulder.add(cap);

    const upper = new THREE.Group();          // pivots AT the shoulder
    shoulder.add(upper);
    // deltoid -> bicep -> narrowing to the elbow
    upper.add(mk(seg(S.upperArm, [[0.0, R0 * 1.05], [0.22, R0 * 1.10], [0.5, R0 * 1.0], [0.85, R0 * 0.84], [1.0, R0 * 0.80]]), leather, 0, 0, 0));
    // sleeve seam, and an accent piping down the outside of the sleeve
    upper.add(mk(cbox(0.01, S.upperArm * 0.8, 0.012, 0.003), accent, s * R0 * 1.0, -S.upperArm * 0.48, 0));
    // REST POSE, from the ride table. The race re-asserts it every frame, but a
    // rig correct in its rest pose already reads as a rider in the showroom.
    upper.rotation.x = R.upperArm ?? -1.04;
    upper.rotation.z = s * (R.upperSplay ?? 0.13);

    const elbow = new THREE.Group();
    elbow.position.set(0, -S.upperArm, 0);
    upper.add(elbow);
    elbow.add(mk(new THREE.SphereGeometry(R0 * 0.88, 8, 6), leather, 0, 0, 0));
    // ELBOW PAD on the point of the elbow. The arm flexes toward local +Z, so
    // the point is on -Z; the pad rides on the elbow joint, halfway between
    // the upper arm and the forearm, as a hard cap does.
    elbow.add(mk(cbox(R0 * 1.45, R0 * 1.55, R0 * 0.55, 0.012), pad, 0, -R0 * 0.25, -R0 * 0.78));
    elbow.rotation.x = R.elbow ?? -0.32;

    const fore = new THREE.Group();           // pivots AT the elbow
    elbow.add(fore);
    fore.add(mk(seg(S.forearm * 0.86, [[0.0, R0 * 0.86], [0.28, R0 * 0.92], [0.75, R0 * 0.74], [1.0, R0 * 0.68]]), leather, 0, 0, 0));
    // GAUNTLET: the glove's flared cuff over the sleeve
    fore.add(mk(new THREE.CylinderGeometry(R0 * 0.98, R0 * 0.80, S.forearm * 0.26, 8), glove, 0, -S.forearm * 0.86, 0));
    fore.add(mk(cbox(R0 * 0.5, 0.012, R0 * 0.3, 0.003), steel, s * R0 * 0.72, -S.forearm * 0.80, 0, 0, 0, Math.PI / 2));  // cuff strap
    // THE GLOVED FIST, gripping. Centred where the IK puts the grip
    // (0, -forearm - hand/2, 0.01): palm block, a curled finger block wrapped
    // FORWARD round the bar, knuckle ridge on top, thumb on the INSIDE (toward
    // the tank) closing the ring. Four masses; at race distance it reads as a
    // hand holding something, where the old single box read as a brick.
    const hy = -S.forearm - S.hand * 0.5, hz = 0.01;
    fore.add(mk(cbox(R0 * 1.40, S.hand * 0.62, R0 * 1.10, 0.012), glove, 0, hy + S.hand * 0.16, hz - R0 * 0.12));
    fore.add(mk(cbox(R0 * 1.34, S.hand * 0.40, R0 * 0.80, 0.014), glove, 0, hy - S.hand * 0.24, hz + R0 * 0.30, -0.45, 0, 0));
    fore.add(mk(cbox(R0 * 1.30, S.hand * 0.16, R0 * 0.50, 0.008), pad, 0, hy + S.hand * 0.02, hz - R0 * 0.62));      // knuckle guard
    fore.add(mk(cbox(R0 * 0.44, S.hand * 0.42, R0 * 0.48, 0.010), glove, -s * R0 * 0.74, hy - S.hand * 0.02, hz + R0 * 0.30, 0.35, 0, s * 0.30));

    arms[side] = { shoulder, upper, elbow, fore };
  }

  // ---- legs: hip -> thigh -> knee -> shin -> boot ----
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 1 : -1;       // anatomical: left is +X (see arms)
    const hip = new THREE.Group();
    hip.position.set(s * S.hipW * 0.5, -S.pelvisD * 0.17, 0.02);
    pelvis.add(hip);
    hip.add(mk(new THREE.SphereGeometry(R0 * 1.40, 8, 6), denim, 0, 0, 0));
    // KNEES FORWARD. +x on this joint swings the thigh toward -Z, the TAIL (the
    // rider faces +Z), so the old +1.48 folded the thigh backwards and the rest
    // pose had the knee 0.33 m behind the hip -- the mirror-image leg. The race
    // re-places the legs by pole-vector IK (src/limbik.js); these defaults are
    // that solve's answer on the 1.75 m body, so the un-animated rig agrees.
    hip.rotation.x = R.hip ?? -1.60;
    // splay: SAME per-side convention as riderpose.poseSeated (left +, right -)
    hip.rotation.z = s * (R.hipSplay ?? 0.22);

    const thigh = new THREE.Group();          // pivots AT the hip
    hip.add(thigh);
    // quad bulk high, narrowing into the knee
    thigh.add(mk(seg(S.thigh, [[0.0, R0 * 1.36], [0.28, R0 * 1.42], [0.7, R0 * 1.18], [1.0, R0 * 1.02]]), denim, 0, 0, 0));
    // outseam: a darker welt down the outside of the jeans
    thigh.add(mk(cbox(0.01, S.thigh * 0.84, 0.012, 0.003), seam, s * R0 * 1.30, -S.thigh * 0.5, 0));

    const knee = new THREE.Group();
    knee.position.set(0, -S.thigh, 0);
    thigh.add(knee);
    knee.add(mk(new THREE.SphereGeometry(R0 * 1.08, 8, 6), denim, 0, 0, 0));
    // KNEE PAD on the kneecap. The knee folds the shin toward -Z, so the cap is
    // on +Z. A hard shell with a strap: the biker detail that reads at speed.
    knee.add(mk(cbox(R0 * 1.55, R0 * 1.85, R0 * 0.62, 0.016), pad, 0, -R0 * 0.35, R0 * 0.92));
    knee.add(mk(cbox(R0 * 2.30, R0 * 0.22, R0 * 2.10, 0.006), seam, 0, -R0 * 1.05, 0));
    knee.rotation.x = R.knee ?? 2.44;          // + folds the shin BACK, down to the peg

    const shin = new THREE.Group();           // pivots AT the knee
    knee.add(shin);
    shin.add(mk(seg(S.shin * 0.78, [[0.0, R0 * 1.10], [0.3, R0 * 1.16], [0.8, R0 * 1.00], [1.0, R0 * 1.00]]), denim, 0, 0, 0));
    shin.add(mk(cbox(0.01, S.shin * 0.6, 0.012, 0.003), seam, s * R0 * 1.10, -S.shin * 0.40, 0));
    // TURNED-UP CUFF sitting on the boot shaft
    shin.add(mk(new THREE.CylinderGeometry(R0 * 1.18, R0 * 1.20, S.shin * 0.09, 8), cuffMat, 0, -S.shin * 0.70, 0));
    // THE BOOT. Its BOTTOM is exactly where the old boot's was
    // (-shin - 0.695 foot): the rig normalises to its lowest point, and the
    // seat socket depends on that origin not moving.
    const sb = -S.shin - S.foot * 0.695;       // sole underside
    const shTop = -S.shin * 0.68, shBot = sb + S.foot * 0.36;
    shin.add(mk(cbox(R0 * 1.90, shTop - shBot, R0 * 2.05, 0.02), boot, 0, (shTop + shBot) / 2, -S.foot * 0.04));   // shaft
    shin.add(mk(cbox(R0 * 1.80, S.foot * 0.40, S.foot * 0.92, 0.03), boot, 0, sb + S.foot * 0.10 + S.foot * 0.20, S.foot * 0.22));   // vamp
    shin.add(mk(cbox(R0 * 1.70, S.foot * 0.22, S.foot * 0.26, 0.03), pad, 0, sb + S.foot * 0.22, S.foot * 0.62));   // toe cap
    shin.add(mk(cbox(R0 * 1.96, S.foot * 0.10, S.foot * 1.02, 0.01), trim, 0, sb + S.foot * 0.05, S.foot * 0.20));  // sole
    shin.add(mk(cbox(R0 * 1.86, S.foot * 0.24, S.foot * 0.30, 0.012), trim, 0, sb + S.foot * 0.12, -S.foot * 0.20)); // heel
    // strap and buckle across the instep, buckle on the outside
    shin.add(mk(cbox(R0 * 1.98, S.foot * 0.06, R0 * 2.12, 0.004), seam, 0, -S.shin * 0.92, -S.foot * 0.04));
    shin.add(mk(cbox(0.012, 0.034, 0.042, 0.003), steel, s * R0 * 0.99, -S.shin * 0.92, -S.foot * 0.02));
    // the gear-shift / brake scuff pad on top of the toe
    shin.add(mk(cbox(R0 * 1.2, 0.012, S.foot * 0.22, 0.004), trim, 0, sb + S.foot * 0.42, S.foot * 0.40));

    arms[`${side}Leg`] = { hip, thigh, knee, shin };
  }
  const legs = { left: arms.leftLeg, right: arms.rightLeg };

  // ---- the chain ----------------------------------------------------------
  // Rebuilt as a proper SEGMENTED chain: each link is a child of the previous,
  // so it can swing and trail instead of standing to attention. The old version
  // was seven torus meshes in a flat vertical stack parented to the forearm --
  // it could not bend, could not trail, and read as a rigid ladder glued to the
  // hand. Here each link is a group at a fixed offset from its parent, and the
  // pose code drives the joint angles, so the chain has real articulation.
  //
  // Links are SHORTER than the old 0.048 spacing so the same total length reads
  // as more, finer links: a motorcycle chain is not a tow rope.
  const CHAIN_LINKS = 11;
  const CHAIN_PITCH = 0.030;
  const chain = new THREE.Group();            // the anchor, at the fist
  const chainMat = M(0x2a2624, 0.42, 0.75); chainMat.name = 'metal';
  const chainJoints = [];
  let parent = chain;
  for (let i = 0; i < CHAIN_LINKS; i++) {
    const link = new THREE.Group();           // a JOINT, so it can bend
    link.position.set(0, i === 0 ? 0 : -CHAIN_PITCH, 0);
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.006, 4, 8), chainMat);
    // alternate the plane 90 degrees, the way a real chain's links do
    mesh.rotation.set(Math.PI / 2, (i % 2) * Math.PI / 2, 0);
    mesh.castShadow = true;
    link.add(mesh);
    parent.add(link);
    parent = link;
    chainJoints.push(link);
  }
  chain.visible = false;
  arms.right.fore.add(chain);
  // hang it from just below the fist
  chain.position.set(0, -S.hand * 1.05, 0.02);

  // ---- centre on x/z, base at y = 0 by measuring vertices ----
  //
  // MEASURE THE BODY IN A NEUTRAL, LEGS-DOWN POSE, NOT IN THE RIDING POSE.
  //
  // This block normalises the rig so its lowest point is y = 0 (the feet), which
  // is the origin every seat calculation depends on. It used to measure the rig
  // exactly as posed -- and that was fine only for as long as the riding pose kept
  // a BOOT below everything else. When the seated leg was re-solved the thigh
  // folded right up over the tank (hip = -3.25), so in the riding pose the
  // lowest thing on the body is no longer a boot: it is the pelvis and seat unit.
  // `box.min.y` therefore came out about 0.62 m too high, the shift lifted the
  // body 0.62 m too little, and the rider sat that far BELOW the saddle -- with
  // his boots near the road. A normalisation that depends on the pose is not a
  // normalisation; it is a second, hidden pose.
  //
  // So the leg joints are zeroed for the measurement only (a straight, standing
  // leg, which is what "how tall is this body" means), the box is taken, and the
  // riding rotations are restored immediately after. The result is the same
  // origin for every pose, and a change to the riding pose can no longer move it.
  const _hipRx = [], _kneeRx = [];
  for (const side of ['left', 'right']) {
    const L = legs[side];
    _hipRx.push(L.hip.rotation.x); _kneeRx.push(L.knee.rotation.x);
    L.hip.rotation.x = 0; L.knee.rotation.x = 0;
  }
  const box = new THREE.Box3(), v = new THREE.Vector3(), m = new THREE.Matrix4(), im = new THREE.Matrix4();
  g.updateMatrixWorld(true);
  g.traverse((n) => {
    const p = n.isMesh && n.geometry && n.geometry.attributes && n.geometry.attributes.position;
    if (!p) return;
    if (n.isInstancedMesh) {
      for (let c = 0; c < n.count; c++) {
        n.getMatrixAt(c, im);
        const mm = m.multiplyMatrices(n.matrixWorld, im);
        for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(mm));
      }
      return;
    }
    for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld));
  });
  // restore the riding pose before anything can read it
  let _i = 0;
  for (const side of ['left', 'right']) {
    const L = legs[side];
    L.hip.rotation.x = _hipRx[_i]; L.knee.rotation.x = _kneeRx[_i]; _i++;
  }
  g.updateMatrixWorld(true);
  const c = box.getCenter(new THREE.Vector3());
  const shift = new THREE.Group();
  shift.position.set(-c.x, -box.min.y, -c.z);
  while (g.children.length) shift.add(g.children[0]);
  g.add(shift);

  g.userData.joints = { pelvis, torso, neck, head, arms, legs, chain, chainJoints,
    leftArm: arms.left, rightArm: arms.right, leftLeg: legs.left, rightLeg: legs.right };
  // I HAVE MEASURED MYSELF. The `shift` above puts my feet-origin at y = 0 using a
  // neutral pose; the loader must not normalise me a second time in whatever pose
  // I am left in. See the note on the shift and the `grounded` check in assetlib.
  g.userData.grounded = true;
  // The spec travels WITH the body, so anything that needs a body dimension
  // (the camera aim, the seat offset, the showroom readout) reads it from the
  // rig rather than from a second copy of the numbers that can drift.
  g.userData.spec = S;
  g.userData.rider = { height: S.height, seatedShoulder: S.seatedShoulder };
  return g;
}
