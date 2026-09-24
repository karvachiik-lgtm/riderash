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
  // THE LOOK (src/bodyspec.js makeLook): style, never stature. Its defaults are
  // the original rider -- full-face lid, leathers, gloves -- so a spec without a
  // look (an old save, a rival) builds the same body as before, mesh for mesh.
  const L = Object.assign({
    helmet: 'full', helmetSize: 1, headSize: 1, bust: 1, visor: 'smoke', stripe: 'racing', finish: 'gloss', hair: 'short',
    hairColor: 0x2a1d14, beard: 'none', top: 'leather', bottom: 'jeans', pattern: 'plain', figure: 'm',
    hat: 'none', shoes: 'boots', tattoo: 'none', inkColor: 0x1c2433,
    glasses: 'none', chain: 'none', scarf: 'none', scarfColor: 0x8a1f1f, earring: false,
    spikes: false, backpack: false, gloves: 'full', gloveColor: 0x232020, bootColor: 0x1f1c1a,
  }, S.look || {});
  const TOP = L.top;
  const leatherTop = TOP === 'leather';
  // a denim jacket is cut like the leathers (zip, collar, full sleeves) in cloth
  const jacketLike = leatherTop || TOP === 'denimjacket';
  const longCloth = TOP === 'hoodie' || TOP === 'flannel';
  const swim = TOP === 'bikini' || TOP === 'onepiece';
  const strapped = TOP === 'dress' || swim;
  const bareArms = TOP === 'tank' || TOP === 'vest' || strapped;
  // FIGURE: 'f' re-cuts the same rig -- waist in, hips out, a bust line, a
  // narrower yoke, slimmer limbs. Lengths and joints are the spec's either way.
  const FEM = L.figure === 'f';
  // what is below the waist: a dress brings its own skirt
  const BOTTOM = TOP === 'dress' ? 'dress' : swim ? 'swim' : L.bottom;
  const bareLegs = BOTTOM === 'skirt' || BOTTOM === 'dress' || BOTTOM === 'swim';
  const shortsOn = BOTTOM === 'shorts';
  const faceShown = L.helmet !== 'full';

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
  const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k);
  const shade = (hex, k) => {               // darker / lighter variant of a spec colour
    const col = new THREE.Color(hex); col.multiplyScalar(k); return col;
  };
  const leather = TOP === 'denimjacket' ? M(C.jacket, 0.9, 0.0, true) : P(C.jacket, 0.46, 0.08, 0.55, 0.28, true); leather.name = 'fabric';
  const seam    = P(shade(C.jacket, 0.55), 0.6, 0.05, 0.2, 0.5, true); seam.name = 'fabric';
  const pad     = P(shade(C.jacket, 0.75), 0.38, 0.10, 0.7, 0.2, true); pad.name = 'fabric';   // armour panels: harder hide
  const padIn   = pad.clone(); padIn.side = THREE.DoubleSide;   // open domes show their inside
  const denim   = M(C.pants, 0.90, 0.02, true);  denim.name = 'fabric';   // cloth stays matte
  const cuffMat = M(shade(C.pants, 1.25), 0.92, 0.02, true); cuffMat.name = 'fabric';  // turned-up hem shows the lighter inside
  const skin    = M(C.skin, 0.78, 0.0); skin.name = 'plaster';
  const VISOR = { smoke: [0x2a333c, 0.20], clear: [0x8fa3b3, 0.35], gold: [0xc9a04a, 0.95], blue: [0x2f5fa8, 0.85], mirror: [0xc4ccd4, 1.0] }[L.visor] || [0x2a333c, 0.20];
  const glass   = P(VISOR[0], 0.05, VISOR[1], 1.0, 0.01);        // visor: hard gloss
  const bone    = L.finish === 'matte' ? P(C.helmet, 0.62, 0.02, 0.0, 0.8)
                                       : P(C.helmet, 0.18, 0.08, 1.0, 0.03);   // helmet shell
  const trim    = M(0x1b1b1e, 0.6, 0.05, true); trim.name = 'fabric';   // helmet rubber, soles
  const boot    = P(L.bootColor, 0.52, 0.10, 0.45, 0.32, true); boot.name = 'fabric';
  const glove   = P(L.gloveColor, 0.62, 0.05, 0.3, 0.4, true); glove.name = 'fabric';
  // Cloth tops (tee, tank, hoodie) are matte cotton in the jacket colour.
  const cotton  = M(C.jacket, 0.92, 0.0, true); cotton.name = 'fabric';
  if (L.pattern !== 'plain') { cotton.map = patternTex(L.pattern, C.jacket); cotton.color.setHex(0xffffff); }
  if (swim) { cotton.roughness = 0.45; }                // swimwear: a lycra sheen
  const skirtMat = BOTTOM === 'dress' || BOTTOM === 'swim' ? cotton : M(C.pants, 0.85, 0.0, true); skirtMat.name = 'fabric';
  const cottonDk = M(shade(C.jacket, 0.72), 0.94, 0.0, true); cottonDk.name = 'fabric';
  const hairMat = M(L.hairColor, L.hair === 'slick' ? 0.32 : 0.86, 0.0, true); hairMat.name = 'fabric';
  const stubbleMat = M(mix(C.skin, L.hairColor, 0.55), 0.95, 0.0); stubbleMat.name = 'fabric';
  const ink = inkMaterial(L.tattoo === 'neck' ? 'none' : L.tattoo);
  const neckInk = L.tattoo === 'neck' || L.tattoo === 'sleeve' ? inkMaterial('tribal') : null;
  const gold    = M(0xd9ae4a, 0.28, 0.92); gold.name = 'metal';
  const silver  = M(0xcfd4d9, 0.22, 0.95); silver.name = 'metal';
  const dark    = M(0x121416, 0.35, 0.3);
  const white   = M(0xe9e4da, 0.5, 0.0);
  const lip     = FEM ? P(mix(C.skin, 0xb03a50, 0.7), 0.35, 0.0, 0.6, 0.2) : M(shade(C.skin, 0.62), 0.7, 0.0);
  const scarfMat = M(L.scarfColor, 0.88, 0.0, true); scarfMat.name = 'fabric';
  const lensMat = P(0x3a5a7a, 0.05, 0.6, 1, 0.02); lensMat.name = 'lens';
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
  const R0 = S.limbR * (FEM ? 0.86 : 1);
  // LOOK MESHES ARE NOT MEASURED. The rig is normalised by its bounding box
  // (see the bottom of this file) and a backpack or a ponytail must not slide
  // the body along the saddle; `lk` tags a mesh the normaliser skips.
  const lk = (m) => { m.userData.noMeasure = true; return m; };
  const add = (parent, m) => { parent.add(lk(m)); return m; };

  // FABRIC PRINTS for cloth tops and dresses: a repeating tile, pixel-painted.
  function patternTex(kind, baseHex) {
    const W = 32, H = 32, d = new Uint8Array(W * H * 4);
    const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    const base = rgb(baseHex), white = [246, 242, 232], pink = [238, 150, 170], sun = [242, 196, 70], leaf = [70, 130, 80];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = base;
      if (kind === 'dots') {
        const dx = (x % 16) - 8, dy = (y % 16) - 8;
        if (dx * dx + dy * dy < 12) c = white;
      } else if (kind === 'stripes') {
        if ((y % 8) < 3) c = white;
      } else if (kind === 'plaid') {
        // tartan: dark bands both ways, a fine light overcheck
        const bx = (x % 16) < 5, by = (y % 16) < 5;
        if (bx && by) c = c.map((v) => v * 0.35);
        else if (bx || by) c = c.map((v) => v * 0.62);
        if ((x % 16) === 10 || (y % 16) === 10) c = [214, 206, 190];
      } else if (kind === 'stars') {
        // white five-point stars on the colour, staggered rows
        const cx = (y >> 4) % 2 ? 8 : 0;
        const dx = ((x + cx) % 16) - 8, dy = (y % 16) - 8, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx) + Math.PI / 2;
        const star = 2.2 + 2.3 * Math.pow(Math.max(0, Math.cos((a * 5) / 2)), 3);
        if (r < star) c = white;
      } else if (kind === 'floral') {
        // two flowers per tile, five petals round a gold centre, a leaf
        for (const [fx, fy, pc] of [[8, 9, white], [24, 25, pink]]) {
          const dx = x - fx, dy = y - fy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
          if (r < 1.6) c = sun;
          else if (r < 3.2 + 1.6 * Math.cos(a * 5)) c = pc;
          else if (Math.abs(dx - 5) < 2.5 && Math.abs(dy + 4 - dx * 0.3) < 1.1) c = leaf;
        }
      }
      const i = (y * W + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    const t = new THREE.DataTexture(d, W, H);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 3);
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  // TATTOOS: ink painted into a small DataTexture over the skin tone -- pure
  // code, no canvas, no image. The lathe segments carry UVs with u around the
  // limb and v down it (0 at the joint), so a pattern is a function of (u, v).
  function inkMaterial(kind) {
    if (!kind || kind === 'none') return skin;
    const W = 64, H = 128, d = new Uint8Array(W * H * 4);
    const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    const base = rgb(C.skin), inkC = rgb(L.inkColor), fire = rgb(0xc8401a), gold2 = rgb(0xd09a2a);
    const TAU = Math.PI * 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      let col = null;
      if (kind === 'tribal') {
        const t = v - 0.5 - 0.16 * Math.sin(u * TAU * 2);
        const w = 0.05 + 0.06 * Math.pow(Math.sin(u * TAU * 5), 2);
        const thorn = Math.abs(v - 0.62 - 0.12 * Math.sin(u * TAU * 3 + 1.3)) < 0.022;
        if (Math.abs(t) < w || thorn) col = inkC;
      } else if (kind === 'sleeve') {
        const n = Math.sin(u * TAU * 3 + v * 9) * Math.sin(v * 15 - u * TAU * 2);
        const rose = Math.hypot(((u * 4) % 1) - 0.5, ((v * 5) % 1) - 0.5);
        if (n > 0.32 || Math.abs(n - 0.05) < 0.05 || (rose < 0.18 && Math.abs(rose - 0.1) > 0.035)) col = inkC;
        if (rose < 0.06) col = fire;
        if (v < 0.05 || v > 0.93) col = null;
      } else if (kind === 'flames') {
        const h = 0.42 + 0.22 * Math.abs(Math.sin(u * TAU * 3)) + 0.07 * Math.sin(u * TAU * 7);
        if (v > 1 - h) col = v > 1 - h + 0.05 ? (v > 1 - h + 0.16 ? gold2 : fire) : inkC;
      } else if (kind === 'bands') {
        const dm = Math.abs(((u * 8) % 1) - 0.5) + Math.abs(v - 0.46) * 5;
        if (Math.abs(v - 0.34) < 0.03 || Math.abs(v - 0.58) < 0.03 || (dm < 0.3 && dm > 0.16)) col = inkC;
      }
      const c = col || base, i = (y * W + x) * 4;
      // soft edge: ink sits IN the skin, so blend 85%
      d[i] = col ? c[0] * 0.85 + base[0] * 0.15 : c[0];
      d[i + 1] = col ? c[1] * 0.85 + base[1] * 0.15 : c[1];
      d[i + 2] = col ? c[2] * 0.85 + base[2] * 0.15 : c[2];
      d[i + 3] = 255;
    }
    const tex = new THREE.DataTexture(d, W, H);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.74, metalness: 0 });
    m.name = 'skin_ink';
    return m;
  }

  // ---- pelvis: the root everything hangs off -------------------------------
  // The spec gives the standing hip height; the rig is built so the PELVIS joint
  // sits at the hip. `seatContactY` (on the spec) is how far the BOTTOM of this
  // pelvis block is above the feet, which is what a saddle has to meet -- so the
  // seat block keeps its exact spec size and only gains a belt on top.
  const pelvis = new THREE.Group();
  pelvis.position.set(0, S.hipY, 0);
  g.add(pelvis);
  if (!FEM) pelvis.add(mk(cbox(S.pelvisW, S.pelvisH, S.pelvisD, 0.03), bareLegs ? skirtMat : denim, 0, 0, 0));
  else {
    // a rounded hip instead of the square seat block: an ellipsoid the size
    // of the block, which is what gives the waist-to-hip curve
    const sw = BOTTOM === 'swim';
    pelvis.add(mk(new THREE.SphereGeometry(S.pelvisW * (sw ? 0.5 : 0.54), 14, 10), bareLegs ? skirtMat : denim, 0, -S.pelvisH * (sw ? 0.1 : 0.05), 0));
    pelvis.children[pelvis.children.length - 1].scale.set(1, (S.pelvisH / S.pelvisW) * (sw ? 0.95 : 1.15), (S.pelvisD / S.pelvisW) * 1.02);
  }
  if (!bareLegs) {
    // belt, and a steel buckle at the front
    pelvis.add(mk(cbox(S.pelvisW * 1.03, S.pelvisH * 0.2, S.pelvisD * 1.03, 0.012), seam, 0, S.pelvisH * 0.42, 0));
    pelvis.add(mk(cbox(0.06, S.pelvisH * 0.2, 0.014, 0.004), steel, 0, S.pelvisH * 0.42, S.pelvisD * 0.52));
    // back pockets, as raised panels
    for (const s of [-1, 1]) pelvis.add(mk(cbox(S.pelvisW * 0.3, S.pelvisH * 0.42, 0.012, 0.004), denim, s * S.pelvisW * 0.22, -S.pelvisH * 0.04, -S.pelvisD * 0.51));
  } else if (BOTTOM !== 'swim') {
    // THE SKIRT: an open flared cone off the hips, to above the knee (a
    // dress) or mid-thigh (a skirt); a sash where a belt would be
    const len = S.thigh * (BOTTOM === 'dress' ? 0.82 : 0.66), top = S.pelvisW * (FEM ? 0.6 : 0.56);
    const sk = add(pelvis, mk(new THREE.CylinderGeometry(top, top * 1.75, len, 16, 2, true), skirtMat, 0, S.pelvisH * 0.3 - len / 2, 0));
    sk.scale.set(1, 1, (S.pelvisD / S.pelvisW) * 1.15);
    sk.material = skirtMat.clone(); sk.material.side = THREE.DoubleSide;
    const hemGeo = new THREE.TorusGeometry(top * 1.75, 0.008, 4, 24);
    const hem = add(pelvis, mk(hemGeo, BOTTOM === 'dress' ? accent : seam, 0, S.pelvisH * 0.3 - len, 0, Math.PI / 2));
    hem.scale.set(1, (S.pelvisD / S.pelvisW) * 1.15, 1);
    const sash = add(pelvis, mk(new THREE.CylinderGeometry(top * 1.02, top * 1.02, S.pelvisH * 0.16, 16), accent, 0, S.pelvisH * 0.42, 0));
    sash.scale.set(1, 1, (S.pelvisD / S.pelvisW) * 1.15);
  }

  if (FEM) {
    // hips and seat: two rounded masses on the back of the pelvis block, in
    // whatever covers it, and a little more width over the hip joints
    const gm = bareLegs ? skirtMat : denim, gr = S.pelvisW * 0.25;
    for (const s of [-1, 1]) {
      const gl = add(pelvis, mk(new THREE.SphereGeometry(gr, 12, 8), gm, s * S.pelvisW * 0.2, -S.pelvisH * 0.12, -S.pelvisD * 0.24));
      gl.scale.set(0.95, 1.0, 0.8);
    }
  }

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
  const TRUNK_PROF = FEM
    // hip, a nipped waist, the bust line, a narrower yoke
    ? [[0.0, 0.98], [0.10, 0.94], [0.38, 0.76], [0.60, 0.90], [0.78, 1.0], [1.0, 0.84]]
    : [[0.0, 0.86], [0.10, 0.90], [0.40, 1.02], [0.62, 1.14], [0.82, 1.24], [1.0, 1.18]];
  const TRUNK_LEN = T * 0.90;
  const trunkGeo = seg(TRUNK_LEN, TRUNK_PROF);
  trunkGeo.rotateX(Math.PI);                  // grow UP from the lumbar joint
  const torsoMat = (jacketLike || TOP === 'vest') ? leather : TOP === 'crop' || TOP === 'bikini' ? skin : cotton;
  const trunk = mk(trunkGeo, torsoMat, 0, 0.0, 0);
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
  if (TOP === 'crop') {
    // a cropped tee: the cloth from under the bust up, the midriff bare
    const from = 0.52, prof = [];
    for (const [t, r] of [[1.0, 0], [0.9, 0], [0.75, 0], [0.6, 0], [from, 0]]) {
      let rr = TRUNK_PROF[0][1];
      for (let i = 1; i < TRUNK_PROF.length; i++) if (t <= TRUNK_PROF[i][0]) { const [t0, r0] = TRUNK_PROF[i - 1], [t1, r1] = TRUNK_PROF[i]; rr = r0 + (r1 - r0) * (t - t0) / (t1 - t0); break; }
      prof.push([(1 - t) / (1 - from), rr * 1.05 + r]);
    }
    const band = add(torso, mk(seg(TRUNK_LEN * (1 - from), prof), cotton, 0, TRUNK_LEN, 0));
    band.scale.set(TW * 0.5, 1, TD * 0.5);
  }
  if (FEM) {
    // THE BUST: two soft masses on the chest, in whatever covers it (a
    // bikini's cups are the cloth; everything else wears them in the top)
    // Sized by the BUST slider; shaped as a TEARDROP -- fuller below the
    // centre, a gentle slope above -- set slightly apart and angled out, the
    // way a figure reads in profile, instead of a round ball.
    const k = L.bust, br = TW * 0.19 * k, by = T * (0.69 - 0.02 * (k - 1));
    const bustMat = TOP === 'bikini' || TOP === 'crop' ? cotton : torsoMat === skin ? cotton : torsoMat;
    const geo = new THREE.SphereGeometry(br, 16, 12);
    {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) / br, z = p.getZ(i) / br;
        // lower half fuller and further forward, upper half flatter
        const lower = Math.max(0, -y), upper = Math.max(0, y);
        p.setZ(i, p.getZ(i) * (1 + 0.28 * lower - 0.35 * upper) + (z > 0 ? br * 0.1 * lower : 0));
        p.setY(i, p.getY(i) * (y < 0 ? 0.92 : 1.05));
      }
      geo.computeVertexNormals();
    }
    for (const s of [-1, 1]) {
      const b = add(torso, mk(geo, bustMat, s * TW * 0.155 * (0.9 + 0.1 * k), by, surf(by) - br * 0.28));
      b.scale.set(1.0, 0.95, 0.8);
      b.rotation.set(0.12, s * 0.22, 0);
    }
    if (TOP === 'bikini') {
      // the underband, and a tie at the back
      const ry = T * 0.62, rr = TW * 0.5 * 0.9;
      const ub = add(torso, mk(new THREE.CylinderGeometry(rr, rr * 1.01, T * 0.035, 14, 1, true), cotton, 0, ry, 0));
      ub.scale.set(1, 1, TD / TW);
      ub.material = cotton.clone(); ub.material.side = THREE.DoubleSide;
      add(torso, mk(cbox(0.05, 0.03, 0.02, 0.005), cotton, 0, ry, -(surf(ry) + 0.01), 0, 0, Math.PI / 4));
    }
  }
  // THE SHOULDER LINE: one rounded mass from deltoid to deltoid, a lathe laid
  // along X -- full round over the trapezius, tapering into each shoulder
  // ball. This replaced a flat chamfered slab 1.4 shoulder-widths wide, which
  // from behind read as a robot's yoke (the old block also did this).
  {
    const half = S.shoulderW * (FEM ? 0.66 : 0.76);
    const pts = [];
    for (const [t, r] of [[-1.0, 0.0001], [-1.0, 0.62], [-0.8, 0.86], [-0.45, 1.0], [0.45, 1.0], [0.8, 0.86], [1.0, 0.62], [1.0, 0.0001]]) pts.push(new THREE.Vector2(r, t * half));
    const geo = new THREE.LatheGeometry(pts, 8);
    geo.rotateZ(Math.PI / 2);
    // a dress is cut on straps: the shoulders are bare skin, the straps cross them
    const yoke = mk(geo, TOP === 'crop' ? cotton : strapped ? skin : torsoMat, 0, T * 0.94, TD * 0.03);
    yoke.scale.set(1, T * (FEM ? 0.11 : 0.15), TD * (FEM ? 0.4 : 0.46));
    torso.add(yoke);
    if (strapped) {
      for (const s of [-1, 1]) {
        // a flat band over the top of the shoulder, front to back, lying on it
        const strap = add(torso, mk(new THREE.TorusGeometry(TD * 0.36, 0.008, 4, 12, Math.PI), cotton, s * S.shoulderW * 0.34, T * 0.9, TD * 0.03, 0, Math.PI / 2, 0));
        strap.scale.set(1, (T * 0.085) / (TD * 0.36), 1);
      }
      // the neckline: the bodice stops at the bust, skin above it
      if (TOP !== 'bikini') {
      const top = add(torso, mk(new THREE.CylinderGeometry(TW * 0.5 * 0.86, TW * 0.5 * 0.99, T * 0.18, 12, 1, true), skin, 0, T * 0.92, 0));
      top.scale.set(1, 1, TD / TW);
      }
    }
  }
  // yoke seam (front and back) and the side panel seams: raised dark welts
  // yoke seam front and back, a spine welt, and the offset biker's zip --
  // each a short run laid on the jacket surface at its own height
  // (the flat front face is 0.38 of the local radius each side of centre, so
  // every detail stays within |x| < 0.3 r and sits on it)
  const zipped = jacketLike || TOP === 'vest';
  if (zipped) for (const z of [1, -1]) torso.add(mk(cbox(TW * 0.36, 0.012, 0.012, 0.003), seam, 0, T * 0.78, z * (surf(T * 0.78) + 0.004)));
  for (let k = 0; zipped && k < 4; k++) {
    const y = T * (0.18 + k * 0.15);
    torso.add(mk(cbox(0.012, T * 0.15, 0.012, 0.003), seam, 0, y, -(surf(y) + 0.003)));
    const x = TW * (0.07 - k * 0.018);
    torso.add(mk(cbox(0.02, T * 0.155, 0.01, 0.003), seam, x, y, surf(y) + 0.002, 0, 0, -0.1));
    torso.add(mk(cbox(0.008, T * 0.155, 0.012, 0.002), steel, x, y, surf(y) + 0.006, 0, 0, -0.1));
  }
  if (zipped) torso.add(mk(cbox(0.02, 0.034, 0.014, 0.004), steel, TW * 0.03, T * 0.70, surf(T * 0.70) + 0.01));   // the pull
  // waistband: the hem of the jacket, a slightly proud ring over the belt
  const hem = mk(new THREE.CylinderGeometry(1, 1, T * 0.08, 8), zipped ? pad : TOP === 'bikini' || TOP === 'crop' ? skin : cottonDk, 0, T * 0.03, 0);
  hem.scale.set(TW * 0.47, 1, TD * 0.47);
  torso.add(hem);
  // jacket collar: a short open cone, stood up and open at the front
  const collar = mk(new THREE.CylinderGeometry(S.headR * 0.62, S.headR * 0.78, T * 0.12, 8, 1, true, Math.PI * 0.18, Math.PI * 1.64),
    leather, 0, T * 1.14, TD * 0.02);
  collar.material = leather.clone(); collar.material.side = THREE.DoubleSide; collar.material.name = 'fabric';
  // (theta 0 is +Z, so the 0.36 pi gap left by thetaStart/Length is at the front)
  if (zipped) torso.add(collar);
  else {
    // a crew neck: a ribbed band where the cloth meets the neck
    const crew = add(torso, mk(new THREE.TorusGeometry(S.headR * 0.62, S.headR * 0.09, 5, 12), cottonDk, 0, T * 1.10, TD * 0.03, Math.PI / 2 - 0.2));
    crew.scale.set(1, 1.15, 1);
  }
  if (TOP === 'flannel') {
    // a shirt: a button placket down the front, a pocket on each breast
    add(torso, mk(cbox(0.022, T * 0.7, 0.008, 0.003), cottonDk, 0, T * 0.5, surf(T * 0.5) + 0.004));
    for (const s of [-1, 1]) add(torso, mk(cbox(TW * 0.16, T * 0.12, 0.01, 0.003), cottonDk, s * TW * 0.14, T * 0.74, surf(T * 0.74) + 0.004));
  }
  if (TOP === 'hoodie') {
    // the hood lies folded behind the neck, the pouch pocket on the belly,
    // two drawstrings hanging from the neckline
    const hood = add(torso, mk(new THREE.SphereGeometry(S.headR * 1.05, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), cotton, 0, T * 1.02, -TD * 0.34, -1.25));
    hood.scale.set(1.05, 0.62, 0.9);
    hood.material = cotton.clone(); hood.material.side = THREE.DoubleSide;
    add(torso, mk(cbox(TW * 0.52, T * 0.2, 0.03, 0.01), cottonDk, 0, T * 0.22, surf(T * 0.22) + 0.006));
    for (const s of [-1, 1]) add(torso, mk(new THREE.CylinderGeometry(0.005, 0.005, T * 0.22, 4), white, s * S.headR * 0.28, T * 0.96, surf(T * 0.96) + 0.008, -0.1));
  }
  if (TOP === 'tank') {
    // armholes cut deep: a darker rib round each one
    for (const s of [-1, 1]) {
      const rib = add(torso, mk(new THREE.TorusGeometry(S.limbR * 1.5, 0.008, 4, 10), cottonDk, s * S.shoulderW * 0.64, T * 0.9, TD * 0.02, 0, Math.PI / 2, 0));
      rib.scale.set(1, 1.3, 1);
    }
  }
  // ---- neck jewellery and scarf, on the chest ----
  if (L.chain !== 'none') {
    const met = L.chain === 'gold' ? gold : silver;
    const ring = add(torso, mk(new THREE.TorusGeometry(S.headR * 0.78, 0.0065, 4, 22), met, 0, T * 1.06, TD * 0.1, Math.PI / 2 - 0.62));
    ring.scale.set(1.08, 1, 1);
    const pend = add(torso, mk(cbox(0.03, 0.04, 0.01, 0.004), met, 0, T * 0.93, surf(T * 0.93) + 0.012, 0, 0, Math.PI / 4));
    pend.rotation.set(-0.15, 0, Math.PI / 4);
  }
  if (L.backpack) {
    const by = T * 0.5;
    add(torso, mk(cbox(TW * 0.6, T * 0.56, TD * 0.34, 0.03), cottonDk.color.getHex() === dark.color.getHex() ? trim : M(0x2b2a28, 0.85, 0.02, true), 0, by, -(surf(by) + TD * 0.15)));
    add(torso, mk(cbox(TW * 0.5, T * 0.2, TD * 0.1, 0.02), accent, 0, by - T * 0.12, -(surf(by) + TD * 0.33)));
    for (const s of [-1, 1]) {
      add(torso, mk(cbox(0.035, T * 0.62, 0.012, 0.004), trim, s * TW * 0.17, T * 0.62, surf(T * 0.62) + 0.008, 0.08));
    }
  }

  // ---- head: helmet + visor + neck ----
  const neck = new THREE.Group();
  neck.position.set(0, T * 1.13, TD * 0.04);
  torso.add(neck);
  neck.add(mk(new THREE.CylinderGeometry(S.headR * (FEM ? 0.32 : 0.38), S.headR * (FEM ? 0.37 : 0.44), S.neckLen, 8), skin, 0, S.neckLen * 0.5, 0));
  const head = new THREE.Group();
  head.position.set(0, S.neckLen, 0);
  neck.add(head);
  const HC = new THREE.Vector3(0, S.headH * 0.34, 0);      // the lid's centre
  const lid = [];                                           // meshes the helmet-size slider scales
  const helm = (m) => { lid.push(m); return m; };
  // the default helmet: a full-face lid (gear_*.js overlays can replace it)
  if (L.helmet === 'full') {
  const shell = helm(mk(new THREE.SphereGeometry(S.headR, 14, 10), bone, 0, S.headH * 0.34, 0));
  shell.scale.set(1, 1.08, 1.12);
  head.add(shell);
  // VISOR: a band cut from a slightly larger sphere, so it wraps the face
  // instead of floating in front of it as a flat card
  const visor = helm(mk(new THREE.SphereGeometry(S.headR * 1.035, 14, 4, Math.PI * 0.5 - 1.0, 2.0, 0.86, 0.90), glass, 0, S.headH * 0.34, 0));
  visor.scale.set(1, 1.08, 1.12);
  visor.material.side = THREE.DoubleSide;
  head.add(visor);
  // chin bar, chamfered, and the rubber neck roll the lid sits on
  // CHIN BAR: the lower front of a larger sphere, pushed forward -- a guard
  // that wraps the jaw. It was a 1.3 x 0.9 head-radius cube on the face.
  const chin = helm(mk(new THREE.SphereGeometry(S.headR * 1.03, 14, 4, Math.PI * 0.5 - 1.15, 2.3, 1.62, 0.95), bone, 0, S.headH * 0.30, S.headR * 0.05));
  chin.scale.set(1.0, 1.3, 1.36);   // deeper and further forward than the shell: it has to read as a jaw guard
  chin.material = bone.clone(); chin.material.side = THREE.DoubleSide;
  head.add(chin);
  const roll = helm(mk(new THREE.CylinderGeometry(S.headR * 0.86, S.headR * 0.80, S.headH * 0.12, 10), trim, 0, -S.headH * 0.30, -S.headR * 0.08));
  roll.scale.set(1, 1, 1.1);
  head.add(roll);
  }
  if (L.helmet === 'open') {
    // OPEN-FACE: the shell with the face cut out, a short peak, and the chin
    // strap -- the face and whatever is on it stay in view.
    const shell = helm(mk(new THREE.SphereGeometry(S.headR, 14, 10, Math.PI * 0.5 + 0.95, Math.PI * 2 - 1.9, Math.PI * 0.3, Math.PI * 0.32), bone, 0, S.headH * 0.34, 0));
    shell.scale.set(1, 1.08, 1.12);
    shell.material = bone.clone(); shell.material.side = THREE.DoubleSide;
    const crown = helm(mk(new THREE.SphereGeometry(S.headR, 14, 5, 0, Math.PI * 2, 0, Math.PI * 0.3), shell.material, 0, S.headH * 0.34, 0));
    crown.scale.set(1, 1.08, 1.12);
    const peak = helm(mk(new THREE.SphereGeometry(S.headR * 1.04, 10, 3, Math.PI * 0.5 - 0.7, 1.4, Math.PI * 0.36, 0.1), bone, 0, S.headH * 0.34, S.headR * 0.12));
    peak.scale.set(1, 1.08, 1.3);
    peak.material = shell.material;
    for (const s of [-1, 1]) helm(mk(cbox(0.012, S.headH * 0.5, 0.02, 0.003), trim, s * S.headR * 0.8, S.headH * 0.02, S.headR * 0.1, 0.2));
    if (L.glasses === 'goggles') {
      for (const s of [-1, 1]) helm(mk(new THREE.CylinderGeometry(S.headR * 0.2, S.headR * 0.22, S.headR * 0.16, 10), lensMat, s * S.headR * 0.3, S.headH * 0.34 + S.headR * 0.62, S.headR * 0.86, Math.PI / 2 - 0.5));
    }
  }
  if (L.helmet === 'full' && L.glasses === 'goggles') {
    // goggles pushed up on the lid, strap round the back
    const strap = helm(mk(new THREE.TorusGeometry(S.headR * 1.1, S.headR * 0.06, 4, 20), dark, 0, S.headH * 0.34 + S.headR * 0.42, 0, Math.PI / 2 - 0.35));
    strap.scale.set(0.98, 1.1, 1);
    for (const s of [-1, 1]) helm(mk(new THREE.CylinderGeometry(S.headR * 0.2, S.headR * 0.22, S.headR * 0.16, 10), lensMat, s * S.headR * 0.3, S.headH * 0.34 + S.headR * 0.78, S.headR * 0.78, Math.PI / 2 - 0.75));
  }
  // helmet stripe, hazard colour -- no glyphs
  // A MERIDIAN BAND cut from a sphere 1.5% larger than the shell, front and
  // back, so the stripe lies ON the lid. It used to be a box 1.46 head-heights
  // tall standing through the shell, which read as a fin / mohawk on top.
  if (L.helmet !== 'none' && L.stripe !== 'none') {
    // 'racing' is the original single centre stripe; 'twin' two pinstripes
    const offs = L.stripe === 'twin' ? [-0.2, 0.2] : [0];
    const w = L.stripe === 'twin' ? 0.1 : 0.4;
    for (const o of offs) for (const ph of [Math.PI * 0.5, Math.PI * 1.5]) {
      const tl = L.helmet === 'open' && ph < Math.PI ? 0.3 : 0.62;
      const band = helm(mk(new THREE.SphereGeometry(S.headR * 1.015, 3, 8, ph + o - w / 2, w, 0, Math.PI * tl), accent, 0, S.headH * 0.34, 0));
      band.scale.set(1, 1.08, 1.12);
      head.add(band);
    }
  }
  // visor pivots
  if (L.helmet === 'full') for (const s of [-1, 1]) head.add(helm(mk(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8), steel, s * S.headR * 1.02, S.headH * 0.36, S.headR * 0.28, 0, 0, Math.PI / 2)));
  for (const m of lid) {
    if (!m.parent) head.add(m);
    // HELMET SIZE: every lid part scaled about the lid's centre, so a bigger lid
    // grows round the head instead of floating off it
    // (a lid is built round the head, so it grows with HEAD SIZE too)
    // (lid size about the lid's centre, then head size about the neck, which
    // is the point the bare skull grows from -- so the skull stays inside)
    if (L.helmetSize !== 1 || L.headSize !== 1) {
      m.position.sub(HC).multiplyScalar(L.helmetSize).add(HC).multiplyScalar(L.headSize);
      m.scale.multiplyScalar(L.helmetSize * L.headSize);
    }
    // the stock full-face lid is measured as it always was; anything else is look
    if (L.helmet !== 'full' || L.helmetSize !== 1 || L.headSize !== 1 || m.material === dark || m.material.name === 'lens') lk(m);
  }

  if (neckInk) neck.children[0].material = neckInk;
  if (L.scarf === 'bandana') {
    const knot = add(neck, mk(new THREE.TorusGeometry(S.headR * 0.5, S.headR * 0.16, 6, 12), scarfMat, 0, S.neckLen * 0.25, 0.005, Math.PI / 2));
    knot.scale.set(1, 1.1, 1);
    const flap = add(neck, mk(new THREE.ConeGeometry(S.headR * 0.42, S.headR * 0.7, 3), scarfMat, 0, -S.neckLen * 0.2, S.headR * 0.46, Math.PI, 0, 0));
    flap.scale.set(1, 1, 0.35);
  }
  // THE HEAD UNDER THE LID. Built whenever the face shows (open helmet or
  // none): skull, jaw, ears, nose, eyes and brows as chunky low-poly masses in
  // the STYLE-LOCK manner -- readable at race distance, not a portrait.
  // THE BARE HEAD matches the body's heroic scale (the torso and shoulders are
  // exaggerated per STYLE-LOCK; a true-to-life head on them read as a pinhead),
  // times the player's HEAD SIZE slider.
  const hR = S.headR * 0.98 * L.headSize, hy = S.headH * 0.30 * L.headSize;
  if (faceShown) {
    const skull = add(head, mk(new THREE.SphereGeometry(hR, 14, 10), skin, 0, hy, 0));
    skull.scale.set(0.9, 1.08, 1.0);
    const jawR = hR * 0.72, jawY = hy - hR * 0.45, jawZ = hR * 0.26;
    const jaw = add(head, mk(new THREE.SphereGeometry(jawR, 12, 8), skin, 0, jawY, jawZ));
    jaw.scale.set(0.95, 0.82, 0.95);
    const faceZ = (y, x = 0) => {   // skull surface depth at (x, y) relative to its centre
      const nx = x / (hR * 0.9), ny = y / (hR * 1.08);
      return hR * Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    };
    add(head, mk(cbox(hR * 0.22, hR * 0.36, hR * 0.3, 0.01), skin, 0, hy - hR * 0.14, faceZ(-hR * 0.14) + hR * 0.02, -0.12));
    for (const s of [-1, 1]) {
      const ex = s * hR * 0.33, ey = hy + hR * 0.1;
      add(head, mk(new THREE.SphereGeometry(hR * 0.13, 8, 6), white, ex, ey, faceZ(hR * 0.1, ex) - hR * 0.06));
      add(head, mk(new THREE.SphereGeometry(hR * 0.075, 6, 4), dark, ex, ey, faceZ(hR * 0.1, ex) + hR * 0.03));
      add(head, mk(cbox(hR * (FEM ? 0.3 : 0.34), hR * (FEM ? 0.05 : 0.08), hR * 0.1, 0.01), hairMat, ex, ey + hR * (FEM ? 0.24 : 0.2), faceZ(hR * 0.3, ex) + hR * 0.01, 0.1, 0, s * (FEM ? 0.2 : 0.12)));
      // lashes: a dark upper lid line, flicked out at the corner
      if (FEM) add(head, mk(cbox(hR * 0.3, hR * 0.045, hR * 0.06, 0.005), dark, ex + s * hR * 0.02, ey + hR * 0.1, faceZ(hR * 0.1, ex) + hR * 0.02, 0.2, 0, -s * 0.15));
      const ear = add(head, mk(new THREE.SphereGeometry(hR * 0.24, 8, 6), skin, s * hR * 0.88, hy - hR * 0.02, -hR * 0.05));
      ear.scale.set(0.42, 1, 0.7);
      if (L.earring) add(head, mk(new THREE.TorusGeometry(hR * 0.07, hR * 0.02, 4, 10), gold, s * hR * 0.93, hy - hR * 0.26, -hR * 0.02, 0, Math.PI / 2, 0));
    }
    const mouthZ = jawZ + jawR * 0.95 * 0.96;
    add(head, mk(cbox(hR * 0.38, hR * 0.06, hR * 0.06, 0.01), lip, 0, jawY + hR * 0.02, mouthZ));
    // ---- facial hair ----
    const beardMat = L.beard === 'stubble' ? stubbleMat : hairMat;
    if (L.beard === 'full' || L.beard === 'stubble') {
      const k = L.beard === 'full' ? 1.1 : 1.02;
      const b = add(head, mk(new THREE.SphereGeometry(jawR * k, 12, 8, 0, Math.PI, Math.PI * 0.3, Math.PI * 0.7), beardMat, 0, jawY - (k - 1) * jawR * 0.6, jawZ));
      b.scale.set(0.95, 0.82, 0.95);
      b.material = beardMat.clone(); b.material.side = THREE.DoubleSide;
    }
    if (L.beard === 'goatee') add(head, mk(cbox(hR * 0.26, hR * 0.3, hR * 0.14, 0.02), hairMat, 0, jawY - hR * 0.3, mouthZ - hR * 0.12, 0.3));
    if (L.beard === 'goatee' || L.beard === 'moustache' || L.beard === 'full') {
      add(head, mk(cbox(hR * 0.5, hR * 0.1, hR * 0.12, 0.02), hairMat, 0, jawY + hR * 0.12, mouthZ + hR * 0.01));
    }
    // ---- eyewear ----
    const ey = hy + hR * 0.1, ez = faceZ(hR * 0.1, hR * 0.33) + hR * 0.12;
    if (L.glasses === 'shades' || L.glasses === 'aviator') {
      const lens = L.glasses === 'shades' ? dark : P(0x6a4a22, 0.08, 0.9, 1.0, 0.02);
      for (const s of [-1, 1]) {
        if (L.glasses === 'shades') add(head, mk(cbox(hR * 0.4, hR * 0.24, hR * 0.05, 0.012), lens, s * hR * 0.33, ey, ez));
        else { const l = add(head, mk(new THREE.SphereGeometry(hR * 0.2, 10, 6), lens, s * hR * 0.33, ey - hR * 0.02, ez)); l.scale.set(1.05, 0.88, 0.25); }
        add(head, mk(cbox(0.006, 0.008, hR * 0.95, 0.002), L.glasses === 'aviator' ? gold : dark, s * hR * 0.56, ey + hR * 0.05, ez - hR * 0.46));
      }
      add(head, mk(cbox(hR * 0.24, 0.008, 0.008, 0.002), L.glasses === 'aviator' ? gold : dark, 0, ey + hR * 0.07, ez));
    }
    if (L.glasses === 'goggles' && L.helmet === 'none') {
      const strap = add(head, mk(new THREE.TorusGeometry(hR * 0.98, hR * 0.07, 4, 18), dark, 0, ey, 0, Math.PI / 2));
      strap.scale.set(0.95, 1.04, 1);
      for (const s of [-1, 1]) add(head, mk(new THREE.CylinderGeometry(hR * 0.2, hR * 0.22, hR * 0.18, 10), lensMat, s * hR * 0.33, ey, ez, Math.PI / 2));
    }
  }
  // ---- hair ----
  // Bare head: the whole style. Under a lid: only what a lid cannot hold in (a
  // ponytail, long hair, dreads) -- and a mohawk becomes a crest ON the lid,
  // which is what riders actually do with one.
  if (L.helmet === 'none') buildHair(true);
  else buildHair(false);
  // ---- hats (bare head only) ----
  if (L.helmet === 'none' && L.hat === 'sunhat') {
    const straw = M(0xd9bf86, 0.9, 0.0, true); straw.name = 'fabric';
    const hy2 = hy + hR * 0.62;
    const brim = add(head, mk(new THREE.CylinderGeometry(hR * 2.05, hR * 2.15, hR * 0.05, 20), straw, 0, hy2, -hR * 0.05, -0.12));
    void brim;
    const crown = add(head, mk(new THREE.SphereGeometry(hR * 1.08, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), straw, 0, hy2, -hR * 0.05, -0.12));
    crown.scale.set(0.95, 0.9, 1.0);
    add(head, mk(new THREE.CylinderGeometry(hR * 1.04, hR * 1.06, hR * 0.2, 16, 1, true), accent, 0, hy2 + hR * 0.1, -hR * 0.05, -0.12));
  }
  if (L.helmet === 'none' && L.hat === 'cowboy') {
    const felt = M(0x8a5a32, 0.8, 0.0, true); felt.name = 'fabric';
    const hy2 = hy + hR * 0.66;
    // brim: a lathe that turns up at the rim; crown with a pinched top
    const pts = [[0.0001, 0], [hR * 1.2, 0], [hR * 1.75, hR * 0.06], [hR * 2.05, hR * 0.32], [hR * 2.02, hR * 0.36]].map(([x, y]) => new THREE.Vector2(x, y));
    const brim = new THREE.LatheGeometry(pts, 18);
    const b = add(head, mk(brim, felt, 0, hy2, -hR * 0.05, -0.1));
    b.scale.set(0.95, 1, 1.18);
    b.material = felt.clone(); b.material.side = THREE.DoubleSide;
    const crown = add(head, mk(new THREE.CylinderGeometry(hR * 0.78, hR * 1.0, hR * 0.95, 12), felt, 0, hy2 + hR * 0.47, -hR * 0.05, -0.1));
    crown.scale.set(0.95, 1, 1.15);
    const dent = add(head, mk(new THREE.SphereGeometry(hR * 0.8, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.4), felt, 0, hy2 + hR * 0.72, -hR * 0.05, -0.1));
    dent.scale.set(0.9, 0.5, 1.1);
    add(head, mk(new THREE.CylinderGeometry(hR * 1.0, hR * 1.02, hR * 0.14, 12, 1, true), accent, 0, hy2 + hR * 0.1, -hR * 0.05, -0.1)).scale.set(0.95, 1, 1.15);
  }
  if (L.helmet === 'none' && L.hat === 'cap') {
    const cap = add(head, mk(new THREE.SphereGeometry(hR * 1.08, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), cottonDk, 0, hy + hR * 0.28, 0, -0.15));
    cap.scale.set(0.95, 0.85, 1.0);
    add(head, mk(cbox(hR * 1.2, hR * 0.06, hR * 0.9, 0.01), cottonDk, 0, hy + hR * 0.42, hR * 1.05, -0.12));
    add(head, mk(new THREE.SphereGeometry(hR * 0.1, 6, 4), accent, 0, hy + hR * 1.18, -hR * 0.1));
  }
  function buildHair(full) {
    const cap = (k, theta, tilt, mat) => {
      const c = add(head, mk(new THREE.SphereGeometry(hR * k, 14, 8, 0, Math.PI * 2, 0, theta), mat, 0, hy, 0, tilt));
      c.scale.set(0.9, 1.08, 1.0);
      c.material = mat.clone(); c.material.side = THREE.DoubleSide;
      return c;
    };
    const H = L.hair;
    if (full) {
      if (H === 'short' || H === 'long' || H === 'ponytail' || H === 'bun' || H === 'dreads') cap(1.07, 1.6, -0.42, hairMat);
      if (H === 'buzz') cap(1.02, 1.62, -0.42, stubbleMat);
      if (H === 'mohawk' || H === 'spikes') cap(1.015, 1.62, -0.42, stubbleMat);
      if (H === 'slick') { cap(1.06, 1.5, -0.5, hairMat); add(head, mk(new THREE.SphereGeometry(hR * 0.36, 8, 6), hairMat, 0, hy + hR * 0.86, hR * 0.46)).scale.set(1.6, 0.7, 1); }
      if (H === 'afro') {
        const a = cap(1.68, 2.0, -0.8, hairMat);
        a.position.set(0, hy + hR * 0.3, -hR * 0.1);
      }
      if (H === 'bun') add(head, mk(new THREE.SphereGeometry(hR * 0.38, 10, 8), hairMat, 0, hy + hR * 0.86, -hR * 0.62));
      if (H === 'spikes') {
        for (let i = 0; i < 16; i++) {
          const a = i * 2.39996, pol = 0.15 + 1.05 * Math.sqrt((i + 0.5) / 16);
          const dir = new THREE.Vector3(Math.sin(pol) * Math.cos(a), Math.cos(pol), Math.sin(pol) * Math.sin(a));
          if (dir.z > 0.55 && dir.y < 0.75) continue;     // keep the forehead clear
          const sp = add(head, mk(new THREE.ConeGeometry(hR * 0.14, hR * 0.55, 5), hairMat, dir.x * hR * 1.0, hy + dir.y * hR * 1.08, dir.z * hR));
          sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        }
      }
    }
    if (H === 'mohawk') {
      // the crest: fins stood radially along the midline, tallest mid-scalp
      const onLid = !full, R = onLid ? S.headR * 1.1 * L.helmetSize * L.headSize : hR * 1.02, cy = onLid ? HC.y * L.headSize : hy;
      const N = 9;
      for (let i = 0; i < N; i++) {
        const phi = 0.55 - (i / (N - 1)) * 2.35;          // front -> nape
        const h = (onLid ? 0.26 : 0.4) * hR * (0.7 + 0.6 * Math.sin(Math.PI * (i + 0.5) / N));
        const r = R + h * 0.5;
        const fin = add(head, mk(cbox(hR * (onLid ? 0.1 : 0.16), h, hR * 0.36, 0.01), hairMat,
          0, cy + Math.cos(phi) * r * (onLid ? 1.08 : 1.08), Math.sin(phi) * r * (onLid ? 1.12 : 1), phi));
        if (onLid) lid.push(fin);
      }
    }
    // what hangs below a lid as well as below a bare head
    if (H === 'long') {
      const cur = add(head, mk(new THREE.CylinderGeometry(hR * 1.0, hR * 1.2, hR * 1.7, 12, 1, true, Math.PI * 0.42, Math.PI * 1.16), hairMat, 0, hy - hR * 0.72, -hR * 0.06));
      cur.scale.set(0.95, 1, 0.95);
      cur.material = hairMat.clone(); cur.material.side = THREE.DoubleSide;
    }
    if (H === 'ponytail') {
      const tail = add(head, mk(seg(hR * 1.5, [[0, hR * 0.2], [0.3, hR * 0.24], [0.8, hR * 0.14], [1, hR * 0.04]], 6), hairMat, 0, hy - hR * 0.1, -hR * 0.98, 0.5));
      add(head, mk(new THREE.TorusGeometry(hR * 0.19, hR * 0.05, 4, 8), accent, 0, hy - hR * 0.18, -hR * 1.02, 0.5 + Math.PI / 2));
      void tail;
    }
    if (H === 'dreads') {
      for (let i = 0; i < 13; i++) {
        const a = Math.PI * (0.3 + 1.4 * i / 12);         // round the back
        const x = Math.cos(a) * hR * 0.92, z = -Math.abs(Math.sin(a)) * hR * 0.92 + (Math.sin(a) > 0 ? 0 : 0);
        const len = hR * (1.5 + 0.45 * ((i * 7) % 5) / 4);
        const out = full ? 1 : 1.3;                        // under a lid they fall from its rim
        add(head, mk(seg(len, [[0, hR * 0.1], [1, hR * 0.07]], 5), hairMat, x * out, hy + hR * (full ? 0.05 : -0.2), z * out, -0.14, 0, -x / hR * 0.2));
      }
    }
  }
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
    shoulder.position.set(s * S.shoulderW * (FEM ? 0.66 : 0.76), T * (FEM ? 0.95 : 0.97), TD * 0.04);
    torso.add(shoulder);
    // WHAT COVERS THE ARM: leathers all the way down; a hoodie's cotton; a
    // tee's short sleeve over bare (maybe inked) skin; a tank or vest, bare.
    const sleeveMat = jacketLike ? leather : longCloth ? cotton : ink;
    // (a bare or cotton shoulder is the arm's own size -- the leathers' 1.29 is
    // the armour under the hide, and on skin it read as a ball joint)
    shoulder.add(mk(new THREE.SphereGeometry(R0 * (leatherTop ? 1.29 : bareArms ? 1.0 : 1.12), 8, 6), bareArms ? ink : jacketLike ? leather : cotton, 0, 0, 0));
    // shoulder armour: a dome over the ball, tipped outward -- a cap that
    // follows the shoulder rather than a box standing on it
    if (leatherTop) {
      const cap = mk(new THREE.SphereGeometry(R0 * 1.42, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.5), padIn, s * R0 * 0.06, R0 * 0.02, 0, 0, 0, -s * 0.22);
      shoulder.add(cap);
    }
    if (L.spikes) {
      // studded pauldron: a steel dome and three spikes fanned outward
      const dome = add(shoulder, mk(new THREE.SphereGeometry(R0 * 1.5, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.5), steel, s * R0 * 0.1, R0 * 0.1, 0, 0, 0, -s * 0.3));
      void dome;
      for (let k = 0; k < 3; k++) {
        const sp = add(shoulder, mk(new THREE.ConeGeometry(R0 * 0.26, R0 * 1.1, 6), steel,
          s * R0 * (0.35 + 0.1 * k), R0 * 1.55, (k - 1) * R0 * 0.62, (k - 1) * 0.35, 0, -s * (0.45 + 0.1 * k)));
        void sp;
      }
    }

    const upper = new THREE.Group();          // pivots AT the shoulder
    shoulder.add(upper);
    // deltoid -> bicep -> narrowing to the elbow
    // (a bare arm is a touch slimmer than a sleeved one)
    const bk = jacketLike || longCloth ? 1 : 0.9;
    upper.add(mk(seg(S.upperArm, [[0.0, R0 * 1.05 * bk], [0.22, R0 * 1.10 * bk], [0.5, R0 * 1.0 * bk], [0.85, R0 * 0.84 * bk], [1.0, R0 * 0.80 * bk]]), sleeveMat, 0, 0, 0));
    // sleeve seam, and an accent piping down the outside of the sleeve
    if (leatherTop) upper.add(mk(cbox(0.01, S.upperArm * 0.8, 0.012, 0.003), accent, s * R0 * 1.0, -S.upperArm * 0.48, 0));
    if (TOP === 'tee' || TOP === 'crop') {
      // the short sleeve, open at the hem
      add(upper, mk(seg(S.upperArm * 0.46, [[0.0, R0 * 1.2], [0.5, R0 * 1.16], [1.0, R0 * 1.12]]), cotton, 0, R0 * 0.1, 0));
      add(upper, mk(new THREE.CylinderGeometry(R0 * 1.14, R0 * 1.14, S.upperArm * 0.05, 8), cottonDk, 0, -S.upperArm * 0.43, 0));
    }
    // REST POSE, from the ride table. The race re-asserts it every frame, but a
    // rig correct in its rest pose already reads as a rider in the showroom.
    upper.rotation.x = R.upperArm ?? -1.04;
    upper.rotation.z = s * (R.upperSplay ?? 0.13);

    const elbow = new THREE.Group();
    elbow.position.set(0, -S.upperArm, 0);
    upper.add(elbow);
    const foreMat = jacketLike ? leather : longCloth ? cotton : ink;
    elbow.add(mk(new THREE.SphereGeometry(R0 * 0.88 * bk, 8, 6), foreMat, 0, 0, 0));
    // ELBOW PAD on the point of the elbow. The arm flexes toward local +Z, so
    // the point is on -Z; the pad rides on the elbow joint, halfway between
    // the upper arm and the forearm, as a hard cap does.
    if (leatherTop) elbow.add(mk(cbox(R0 * 1.45, R0 * 1.55, R0 * 0.55, 0.012), pad, 0, -R0 * 0.25, -R0 * 0.78));
    elbow.rotation.x = R.elbow ?? -0.32;

    const fore = new THREE.Group();           // pivots AT the elbow
    elbow.add(fore);
    fore.add(mk(seg(S.forearm * 0.86, [[0.0, R0 * 0.86 * bk], [0.28, R0 * 0.92 * bk], [0.75, R0 * 0.74 * bk], [1.0, R0 * 0.68 * bk]]), foreMat, 0, 0, 0));
    if (longCloth) add(fore, mk(new THREE.CylinderGeometry(R0 * 0.8, R0 * 0.8, S.forearm * 0.1, 8), cottonDk, 0, -S.forearm * 0.8, 0));
    // GAUNTLET: the glove's flared cuff over the sleeve (a race glove only)
    if (L.gloves === 'full') {
      fore.add(mk(new THREE.CylinderGeometry(R0 * 0.98, R0 * 0.80, S.forearm * 0.26, 8), glove, 0, -S.forearm * 0.86, 0));
      fore.add(mk(cbox(R0 * 0.5, 0.012, R0 * 0.3, 0.003), steel, s * R0 * 0.72, -S.forearm * 0.80, 0, 0, 0, Math.PI / 2));  // cuff strap
    } else {
      // a bare wrist down to the hand
      add(fore, mk(new THREE.CylinderGeometry(R0 * 0.62, R0 * 0.6, S.forearm * 0.2, 8), skin, 0, -S.forearm * 0.9, 0));
    }
    // THE GLOVED FIST, gripping. Centred where the IK puts the grip
    // (0, -forearm - hand/2, 0.01): palm block, a curled finger block wrapped
    // FORWARD round the bar, knuckle ridge on top, thumb on the INSIDE (toward
    // the tank) closing the ring. Four masses; at race distance it reads as a
    // hand holding something, where the old single box read as a brick.
    const hy = -S.forearm - S.hand * 0.5, hz = 0.01;
    const palm = L.gloves === 'none' ? skin : glove, fingers = L.gloves === 'full' ? glove : skin;
    fore.add(mk(cbox(R0 * 1.40, S.hand * 0.62, R0 * 1.10, 0.012), palm, 0, hy + S.hand * 0.16, hz - R0 * 0.12));
    fore.add(mk(cbox(R0 * 1.34, S.hand * 0.40, R0 * 0.80, 0.014), fingers, 0, hy - S.hand * 0.24, hz + R0 * 0.30, -0.45, 0, 0));
    if (L.gloves === 'full') fore.add(mk(cbox(R0 * 1.30, S.hand * 0.16, R0 * 0.50, 0.008), pad, 0, hy + S.hand * 0.02, hz - R0 * 0.62));      // knuckle guard
    fore.add(mk(cbox(R0 * 0.44, S.hand * 0.42, R0 * 0.48, 0.010), fingers, -s * R0 * 0.74, hy - S.hand * 0.02, hz + R0 * 0.30, 0.35, 0, s * 0.30));

    arms[side] = { shoulder, upper, elbow, fore };
  }

  // ---- legs: hip -> thigh -> knee -> shin -> boot ----
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 1 : -1;       // anatomical: left is +X (see arms)
    const hip = new THREE.Group();
    hip.position.set(s * S.hipW * 0.5, -S.pelvisD * 0.17, 0.02);
    pelvis.add(hip);
    // BARE LEGS under a skirt or dress; SHORTS leave the thigh's top in denim
    const legMat = bareLegs || shortsOn ? skin : denim;
    hip.add(mk(new THREE.SphereGeometry(R0 * (bareLegs && FEM ? 1.22 : 1.40), 8, 6), bareLegs ? skin : denim, 0, 0, 0));
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
    const lk2 = legMat === denim ? 1 : 0.94;            // bare skin sits inside where denim stood
    thigh.add(mk(seg(S.thigh, [[0.0, R0 * 1.36 * lk2], [0.28, R0 * 1.42 * lk2], [0.7, R0 * 1.18 * lk2], [1.0, R0 * 1.02 * lk2]]), legMat, 0, 0, 0));
    // outseam: a darker welt down the outside of the jeans
    if (legMat === denim) thigh.add(mk(cbox(0.01, S.thigh * 0.84, 0.012, 0.003), seam, s * R0 * 1.30, -S.thigh * 0.5, 0));
    if (shortsOn) {
      add(thigh, mk(seg(S.thigh * 0.34, [[0.0, R0 * 1.46], [1.0, R0 * 1.44]]), denim, 0, R0 * 0.1, 0));
      add(thigh, mk(new THREE.CylinderGeometry(R0 * 1.47, R0 * 1.47, S.thigh * 0.04, 8), cuffMat, 0, -S.thigh * 0.33, 0));
    }

    const knee = new THREE.Group();
    knee.position.set(0, -S.thigh, 0);
    thigh.add(knee);
    knee.add(mk(new THREE.SphereGeometry(R0 * 1.08 * lk2, 8, 6), legMat, 0, 0, 0));
    // KNEE PAD on the kneecap. The knee folds the shin toward -Z, so the cap is
    // on +Z. A hard shell with a strap: the biker detail that reads at speed.
    if (legMat === denim) {
      knee.add(mk(cbox(R0 * 1.55, R0 * 1.85, R0 * 0.62, 0.016), pad, 0, -R0 * 0.35, R0 * 0.92));
      knee.add(mk(cbox(R0 * 2.30, R0 * 0.22, R0 * 2.10, 0.006), seam, 0, -R0 * 1.05, 0));
    }
    knee.rotation.x = R.knee ?? 2.44;          // + folds the shin BACK, down to the peg

    const shin = new THREE.Group();           // pivots AT the knee
    knee.add(shin);
    // (a bare calf tapers to a slim ankle; jeans hang straight)
    const calf = legMat === denim ? [[0.0, R0 * 1.10], [0.3, R0 * 1.16], [0.8, R0 * 1.00], [1.0, R0 * 1.00]]
      : [[0.0, R0 * 1.0], [0.3, R0 * 1.1], [0.75, R0 * 0.78], [1.0, R0 * 0.66]];
    shin.add(mk(seg(S.shin * 0.78, calf), legMat, 0, 0, 0));
    if (legMat === denim) {
      shin.add(mk(cbox(0.01, S.shin * 0.6, 0.012, 0.003), seam, s * R0 * 1.10, -S.shin * 0.40, 0));
      // TURNED-UP CUFF sitting on the boot shaft
      shin.add(mk(new THREE.CylinderGeometry(R0 * 1.18, R0 * 1.20, S.shin * 0.09, 8), cuffMat, 0, -S.shin * 0.70, 0));
    }
    // THE BOOT. Its BOTTOM is exactly where the old boot's was
    // (-shin - 0.695 foot): the rig normalises to its lowest point, and the
    // seat socket depends on that origin not moving.
    const sb = -S.shin - S.foot * 0.695;       // sole underside
    const shTop = -S.shin * 0.68, shBot = sb + S.foot * 0.36;
    const lowShoe = L.shoes !== 'boots';
    if (!lowShoe) shin.add(mk(cbox(R0 * 1.90, shTop - shBot, R0 * 2.05, 0.02), boot, 0, (shTop + shBot) / 2, -S.foot * 0.04));   // shaft
    else {
      // a low shoe: the leg carries on down to the ankle
      const aTop = -S.shin * 0.76, aBot = sb + S.foot * 0.46;
      add(shin, mk(new THREE.CylinderGeometry(legMat === denim ? R0 * 1.0 : R0 * 0.62, legMat === denim ? R0 * 1.0 : R0 * 0.6, aTop - aBot, 8), legMat, 0, (aTop + aBot) / 2, 0));
    }
    shin.add(mk(cbox(R0 * 1.80, S.foot * 0.40, S.foot * 0.92, 0.03), boot, 0, sb + S.foot * 0.10 + S.foot * 0.20, S.foot * 0.22));   // vamp
    shin.add(mk(cbox(R0 * 1.70, S.foot * 0.22, S.foot * 0.26, 0.03), pad, 0, sb + S.foot * 0.22, S.foot * 0.62));   // toe cap
    shin.add(mk(cbox(R0 * 1.96, S.foot * 0.10, S.foot * 1.02, 0.01), L.shoes === 'sneakers' ? white : trim, 0, sb + S.foot * 0.05, S.foot * 0.20));  // sole
    shin.add(mk(cbox(R0 * 1.86, S.foot * 0.24, S.foot * 0.30, 0.012), trim, 0, sb + S.foot * 0.12, -S.foot * 0.20)); // heel
    // strap and buckle across the instep, buckle on the outside
    if (!lowShoe) {
      shin.add(mk(cbox(R0 * 1.98, S.foot * 0.06, R0 * 2.12, 0.004), seam, 0, -S.shin * 0.92, -S.foot * 0.04));
      shin.add(mk(cbox(0.012, 0.034, 0.042, 0.003), steel, s * R0 * 0.99, -S.shin * 0.92, -S.foot * 0.02));
    }
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
    if (!p || n.userData.noMeasure) return;
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
