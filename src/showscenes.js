// SHOWROOM SCENES — where the rider is shown off.
//
// The designer used to be a grey disc in a black room behind a dark overlay:
// fine for measuring a body, no good for selling one. These are the sets the
// figure can be shot in. Every one is code-built (HANDOFF §4.2: no imported
// meshes, no image files): boxes, lathes, a gradient sky and a few DataTextures
// painted pixel by pixel. They share one contract:
//
//   buildScene(key) -> { group, light }
//
// `group` is added behind the turntable (the figure stands at the origin, the
// camera looks down -Z), and `light` tunes the stage's own key / fill / rim /
// hemisphere rig, so every set lights the rider the way the set looks lit.
import * as THREE from 'three';

export const SCENES = [
  { key: 'studio',   label: 'Studio',     swatch: '#3b4048' },
  { key: 'garage',   label: 'Garage',     swatch: '#6f6a60' },
  { key: 'loft',     label: 'Home',       swatch: '#7a5536' },
  { key: 'rooftop',  label: 'Rooftop',    swatch: '#23264a' },
  { key: 'desert',   label: 'Desert',     swatch: '#d9803a' },
  { key: 'pitlane',  label: 'Pit lane',   swatch: '#9aa3ad' },
  { key: 'showroom', label: 'Dealer',     swatch: '#15171a' },
];

// ---- builders --------------------------------------------------------------
const std = (color, rough = 0.8, metal = 0.02, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const glow = (color, k = 1) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: k, roughness: 1 });

function place(g, mesh, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
const box = (g, w, h, d, mat, x, y, z, ry = 0, shadow = true) =>
  place(g, new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y + h / 2, z, 0, ry, 0, shadow);
const cyl = (g, rt, rb, h, mat, x, y, z, seg = 12) =>
  place(g, new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat), x, y + h / 2, z);

function floor(g, mat, size = 60) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = -0.003; m.receiveShadow = true;
  g.add(m);
  return m;
}

/** A big inside-out sphere with a vertical colour gradient: the sky. */
function sky(g, stops, r = 220) {
  const geo = new THREE.SphereGeometry(r, 24, 16);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const cs = stops.map(([t, c]) => [t, new THREE.Color(c)]);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / r;                        // -1 .. 1
    let k = 0;
    while (k < cs.length - 2 && t > cs[k + 1][0]) k++;
    const [t0, c0] = cs[k], [t1, c1] = cs[k + 1];
    tmp.copy(c0).lerp(c1, THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1));
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  g.add(m);
  return m;
}

/** A pixel-painted texture: fn(u, v) -> [r, g, b] (0..255). */
function paint(w, h, fn, repeat = [1, 1]) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x / w, y / h, x, y), i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, w, h);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
// a deterministic hash, so a set looks the same every time it is opened
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Lit-window facade for night buildings. */
function windowsTex(seed, lit = 0.35) {
  return paint(32, 64, (u, v, x, y) => {
    const cx = x % 4, cy = y % 4;
    if (cx === 0 || cy === 0 || cy === 3) return [10, 12, 18];
    const on = hash(seed + Math.floor(x / 4) * 7.1 + Math.floor(y / 4) * 13.7) < lit;
    return on ? (hash(seed + x * 0.3 + y) < 0.5 ? [255, 214, 140] : [190, 220, 255]) : [16, 20, 30];
  });
}

// ---- the sets ----------------------------------------------------------------
const BUILD = {
  // A photographer's cove: floor sweeping up into the back wall with no seam,
  // two softboxes on stands, and the measuring grid (this is still a fitting room).
  studio(g) {
    const paper = std(0x444a52, 0.95);
    floor(g, paper);
    const cove = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 30, 24, 1, true, Math.PI * 0.5, Math.PI * 0.5), paper);
    cove.material = paper.clone(); cove.material.side = THREE.BackSide;
    cove.rotation.z = Math.PI / 2; cove.position.set(0, 2.2, -3.2); g.add(cove);
    box(g, 30, 20, 0.1, paper, 0, 2.2, -5.45, 0, false);
    const grid = new THREE.GridHelper(4.8, 24, 0x5a616a, 0x4a5058); grid.position.y = 0.001; g.add(grid);
    for (const s of [-1, 1]) {
      const stand = std(0x1a1c1f, 0.5, 0.6);
      cyl(g, 0.02, 0.02, 2.3, stand, s * 2.9, 0, -1.6, 6);
      const sb = box(g, 0.9, 1.2, 0.12, std(0x16181b, 0.6), s * 2.9, 1.7, -1.6, -s * 0.6);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 1.1), glow(0xfff6e8, 1.6));
      face.position.set(0, 0, 0.065); sb.add(face);
    }
    return { hemi: [0xc9d4e0, 0x2a2520, 1.4], key: [0xfff4e2, 3.2], fill: [0x9db4d0, 1.2], rim: [0xffb45a, 1.6], env: 0.85, fog: null };
  },

  // HOME GARAGE: the bike lives here. Pegboard of tools, bench, red tool chest,
  // tyre stack, shelving, strip lights, an oil stain under the machine.
  garage(g) {
    const concrete = std(0x77736d, 0.92, 0.0, { map: paint(64, 64, (u, v, x, y) => {
      const n = 110 + hash(x * 3.1 + y * 17.3) * 22 + (x % 32 === 0 || y % 32 === 0 ? -35 : 0);
      return [n, n - 3, n - 7];
    }, [8, 8]) });
    floor(g, concrete, 30);
    const stain = new THREE.Mesh(new THREE.CircleGeometry(0.8, 20), std(0x2c2a27, 0.35, 0.1, { transparent: true, opacity: 0.55 }));
    stain.rotation.x = -Math.PI / 2; stain.position.set(0.3, 0.002, 0.2); g.add(stain);
    const wall = std(0x8c8e84, 0.95);
    box(g, 12, 3.4, 0.2, wall, 0, 0, -3.4);
    box(g, 0.2, 3.4, 8, wall, -5.2, 0, 0);
    box(g, 0.2, 3.4, 8, wall, 5.2, 0, 0);
    // pegboard with tools
    const peg = std(0xb89a6a, 0.9, 0, { map: paint(32, 16, (u, v, x, y) => (x % 4 === 2 && y % 4 === 2 ? [70, 55, 38] : [184, 154, 106]), [3, 2]) });
    box(g, 2.6, 1.3, 0.04, peg, -0.2, 1.25, -3.28);
    const tool = std(0x2b2f33, 0.45, 0.8), redT = std(0xa8231c, 0.5, 0.2);
    for (let i = 0; i < 9; i++) {
      const x = -1.3 + i * 0.3, h = 0.25 + hash(i) * 0.35;
      box(g, 0.04, h, 0.03, i % 3 === 1 ? redT : tool, x, 1.95 - h, -3.24);
      if (i % 2 === 0) place(g, new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 4, 10), tool), x + 0.12, 1.45, -3.24);
    }
    // workbench
    const wood = std(0x7a5a3a, 0.75);
    box(g, 2.2, 0.08, 0.7, wood, 2.9, 0.9, -2.9);
    for (const x of [1.9, 3.9]) for (const z of [-3.15, -2.65]) box(g, 0.07, 0.9, 0.07, tool, x, 0, z);
    box(g, 0.35, 0.22, 0.25, std(0xd4a02a, 0.5, 0.3), 2.5, 0.98, -2.9);  // a vice / case
    box(g, 0.5, 0.3, 0.3, std(0x3f5a3a, 0.7), 3.3, 0.98, -2.95);
    // red roll cab
    const cab = box(g, 0.8, 1.1, 0.5, std(0xa8231c, 0.4, 0.4), -3.2, 0, -2.9);
    for (let k = 0; k < 5; k++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.012, 0.01), std(0x8a9199, 0.3, 0.9));
      d.position.set(0, -0.4 + k * 0.2, 0.255); cab.add(d);
    }
    box(g, 0.84, 0.05, 0.54, std(0x1b1b1e, 0.6), -3.2, 1.1, -2.9);
    // tyre stack
    const rubber = std(0x151617, 0.85);
    for (let k = 0; k < 3; k++) place(g, new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.11, 8, 18), rubber), -2.1, 0.11 + k * 0.22, -2.6, Math.PI / 2);
    // shelving with boxes
    const shelf = std(0x5a5f66, 0.6, 0.5), card = std(0xa07a4a, 0.9);
    for (const y of [0.4, 1.2, 2.0]) box(g, 0.5, 0.03, 2.2, shelf, 4.8, y, 0.3);
    for (let k = 0; k < 7; k++) box(g, 0.4, 0.25 + hash(k + 3) * 0.2, 0.4, k % 3 ? card : std(0x2f4a6b, 0.8), 4.8, [0.43, 1.23, 2.03][k % 3], -0.6 + (k % 4) * 0.55);
    // strip lights
    for (const x of [-2, 2]) box(g, 1.4, 0.05, 0.12, glow(0xf2f6ff, 2.2), x, 3.1, -1, 0, false);
    // a poster: stripes of colour, no words
    const poster = paint(16, 24, (u, v) => (v > 0.7 ? [212, 98, 42] : v > 0.62 ? [30, 30, 30] : v > 0.3 ? [216, 210, 196] : [42, 107, 212]));
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), new THREE.MeshStandardMaterial({ map: poster, roughness: 0.8 }));
    pm.position.set(1.9, 2.1, -3.29); g.add(pm);
    return { hemi: [0xe8ecf2, 0x3a342c, 1.2], key: [0xf6f4ee, 2.8], fill: [0xa9bcd4, 1.0], rim: [0xffc890, 1.3], env: 0.7, fog: null, bg: 0x2a2a28 };
  },

  // AT HOME: a loft living room -- the bike parked on the rug like it belongs
  // there. Sofa, lamp, TV, bookshelf, a plant, a night window on the city.
  loft(g) {
    const planks = std(0x7a5536, 0.7, 0, { map: paint(16, 64, (u, v, x, y) => {
      const plank = Math.floor(x / 4), n = 118 + hash(plank * 9.1 + Math.floor((y + plank * 21) / 32) * 3.3) * 30;
      return x % 4 === 0 ? [60, 40, 26] : [n, n * 0.72, n * 0.48];
    }, [6, 3]) });
    floor(g, planks, 30);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), std(0x8a3a2f, 0.95, 0, { map: paint(32, 32, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5);
      return Math.abs(r - 0.3) < 0.04 || Math.abs(r - 0.43) < 0.02 ? [226, 196, 150] : [138, 58, 47];
    }) }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.004; rug.receiveShadow = true; g.add(rug);
    const wall = std(0xcfc6b8, 0.95);
    box(g, 14, 3.6, 0.2, wall, 0, 0, -3.6);
    // big window: night city beyond
    const pane = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: windowsTex(3, 0.45), emissiveIntensity: 0.9 });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0), pane); win.position.set(-2.3, 1.75, -3.49); g.add(win);
    const frame = std(0x1b1b1e, 0.5, 0.4);
    for (const x of [-3.9, -2.3, -0.7]) box(g, 0.06, 2.1, 0.08, frame, x, 0.7, -3.46);
    for (const y of [0.7, 1.75, 2.78]) box(g, 3.26, 0.06, 0.08, frame, -2.3, y - 0.03, -3.46);
    // sofa
    const fab = std(0x3a4a5a, 0.95);
    box(g, 2.4, 0.42, 0.9, fab, 2.3, 0, -2.9);
    box(g, 2.4, 0.5, 0.25, fab, 2.3, 0.42, -3.25);
    for (const s of [-1, 1]) box(g, 0.22, 0.62, 0.9, fab, 2.3 + s * 1.2, 0, -2.9);
    for (const x of [1.7, 2.9]) box(g, 0.5, 0.35, 0.14, std(0xd4a02a, 0.95), x, 0.45, -3.05, 0.1);
    // TV on the wall, glowing
    box(g, 1.5, 0.86, 0.05, std(0x0c0d0f, 0.3, 0.5), 2.3, 1.55, -3.48);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.78), glow(0x3a6aa8, 0.8)); scr.position.set(2.3, 1.98, -3.45); g.add(scr);
    // floor lamp
    cyl(g, 0.015, 0.015, 1.6, frame, 4.1, 0, -2.6, 6);
    cyl(g, 0.18, 0.13, 0.05, frame, 4.1, 0, -2.6);
    const shade = cyl(g, 0.16, 0.24, 0.3, glow(0xffd29a, 1.3), 4.1, 1.55, -2.6);
    shade.castShadow = false;
    const lamp = new THREE.PointLight(0xffc27a, 6, 6, 1.6); lamp.position.set(4.1, 1.6, -2.4); g.add(lamp);
    // bookshelf
    box(g, 1.1, 2.2, 0.35, std(0x5a3a22, 0.8), -4.6, 0, -3.3);
    const cols = [0xa8231c, 0x2f4a6b, 0xd8d2c4, 0x3f5a3a, 0xd4a02a, 0x1a1d20];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) {
      const h = 0.26 + hash(r * 7 + k) * 0.12;
      box(g, 0.1, h, 0.25, std(cols[(r * 3 + k) % cols.length], 0.8), -5.0 + k * 0.13, 0.1 + r * 0.52, -3.25);
    }
    // plant
    cyl(g, 0.2, 0.16, 0.4, std(0xb86a3a, 0.8), -1.1, 0, -3.1);
    for (let k = 0; k < 6; k++) {
      const leaf = place(g, new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 5), std(0x3f7a3a, 0.8)), -1.1 + Math.cos(k) * 0.12, 0.8, -3.1 + Math.sin(k) * 0.12);
      leaf.rotation.set(Math.sin(k * 2) * 0.4, 0, Math.cos(k * 2) * 0.4);
    }
    // framed pictures
    for (const [x, c] of [[0.6, 0xd4622a], [1.1, 0x2a6bd4]]) {
      box(g, 0.4, 0.5, 0.03, frame, x, 2.2, -3.49);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.42), std(c, 0.8)); p.position.set(x, 2.45, -3.47); g.add(p);
    }
    return { hemi: [0xffe6c8, 0x4a3424, 1.1], key: [0xffe9cc, 2.6], fill: [0x8aa4c8, 0.9], rim: [0xffb45a, 1.8], env: 0.6, fog: null, bg: 0x1d1814 };
  },

  // ROOFTOP AT NIGHT: parapet, water tower, string lights, a neon sign, and a
  // skyline of lit windows under a violet sky.
  rooftop(g) {
    sky(g, [[-1, 0x05060a], [0, 0x2a1f48], [0.25, 0x141836], [1, 0x05060e]]);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf2ecd8, fog: false }));
    moon.scale.setScalar(2.4); moon.position.set(-60, 75, -520); g.add(moon);
    floor(g, std(0x2a2c30, 0.9), 40);
    const conc = std(0x4a4d52, 0.9);
    box(g, 16, 0.9, 0.3, conc, 0, 0, -3.2);
    // the skyline: two rows, far enough off that it reads as a city and not a wall
    for (let i = 0; i < 60; i++) {
      const row = i % 2, x = -260 + (i >> 1) * 18 + hash(i) * 8;
      const z = row ? -330 - hash(i + 9) * 60 : -170 - hash(i + 9) * 50;
      const h = (row ? 60 : 30) + hash(i + 4) * (row ? 90 : 55), w = 10 + hash(i + 2) * 14;
      const t = windowsTex(i, 0.28); t.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 8)));
      const m = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.9, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: row ? 0.55 : 0.8 });
      box(g, w, h, w, m, x, -40, z, 0, false);
    }
    // water tower
    const wood = std(0x5a3f2a, 0.9), iron = std(0x2b2f33, 0.6, 0.5);
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) cyl(g, 0.06, 0.06, 2.4, iron, 5 + dx, 0, -7 + dz, 6);
    cyl(g, 1.2, 1.2, 2.2, wood, 5, 2.4, -7);
    place(g, new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.8, 12), iron), 5, 5.0, -7);
    // neon sign on a frame
    for (const x of [-4.6, -2.4]) cyl(g, 0.04, 0.04, 2.8, iron, x, 0.9, -3.0, 6);
    box(g, 2.6, 0.9, 0.08, std(0x111214, 0.6), -3.5, 2.6, -3.0);
    const neonP = glow(0xff3fa0, 2.4), neonB = glow(0x3fd8ff, 2.4);
    place(g, new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 6, 20), neonP), -4.2, 3.05, -2.93, 0, 0, 0, false);
    box(g, 1.2, 0.06, 0.03, neonB, -3.1, 3.2, -2.93, 0, false);
    box(g, 1.2, 0.06, 0.03, neonP, -3.1, 2.85, -2.93, 0, false);
    const np = new THREE.PointLight(0xff5fb0, 4, 6, 1.5); np.position.set(-3.5, 3, -2.4); g.add(np);
    // string lights sagging between two poles
    for (const x of [-5.5, 5.5]) cyl(g, 0.03, 0.03, 3.2, iron, x, 0, -2.6, 6);
    for (let k = 0; k <= 22; k++) {
      const t = k / 22, x = -5.5 + 11 * t, y = 3.1 - Math.sin(Math.PI * t) * 0.8;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), glow(0xffd28a, 2.5)); b.position.set(x, y, -2.6); g.add(b);
    }
    // AC units
    for (const x of [2.6, 3.8]) box(g, 1.0, 0.7, 0.8, std(0x8a9199, 0.5, 0.6), x, 0, -2.4);
    return { hemi: [0x5a6aa8, 0x1a1420, 0.9], key: [0xbfd0ff, 2.0], fill: [0xff5fb0, 1.1], rim: [0x3fd8ff, 2.2], env: 0.45, fog: [0x1a1c3a, 120, 420], bg: 0x0a0b14 };
  },

  // DESERT SUNSET: the open road, mesas on the horizon, saguaros, a low sun.
  desert(g) {
    sky(g, [[-1, 0x7a4a2a], [0, 0xff9a4a], [0.12, 0xe8704a], [0.35, 0x7a3f6a], [1, 0x241a3a]]);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false }));
    sun.position.set(25, 12, -200); g.add(sun);
    floor(g, std(0xc79a62, 0.95, 0, { map: paint(32, 32, (u, v, x, y) => {
      const n = 196 + hash(x * 5.3 + y * 1.7) * 22 + Math.sin(y * 0.8 + x * 0.1) * 8;
      return [n, n * 0.78, n * 0.52];
    }, [20, 20]) }), 400);
    // the road, running away from the camera into the sunset
    const road = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 420), std(0x2e2c2a, 0.9));
    road.rotation.x = -Math.PI / 2; road.position.set(3.4, 0.002, -200); road.receiveShadow = true; g.add(road);
    const dash = std(0xe0b83a, 0.6);
    for (let k = 0; k < 44; k++) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 2.4), dash);
      d.rotation.x = -Math.PI / 2; d.position.set(3.4, 0.004, 6 - k * 9);
      g.add(d);
    }
    // mesas and buttes
    const rock = std(0x9a4a2a, 0.95), rockD = std(0x7a3a22, 0.95);
    for (let i = 0; i < 9; i++) {
      const x = -120 + i * 30 + hash(i) * 12, z = -90 - hash(i + 3) * 60, h = 10 + hash(i + 7) * 22, r = 8 + hash(i + 1) * 16;
      cyl(g, r * 0.8, r, h, i % 2 ? rock : rockD, x, 0, z, 7);
    }
    // saguaros
    const cactus = std(0x3f6a3a, 0.85);
    for (const [x, z, h] of [[-3.2, -4.5, 2.4], [-6.5, -9, 3.0], [6.5, -12, 2.6], [-12, -18, 3.2]]) {
      cyl(g, 0.16, 0.2, h, cactus, x, 0, z, 8);
      for (const s of [-1, 1]) {
        const ay = h * (0.4 + 0.1 * s);
        const arm = place(g, new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 8), cactus), x + s * 0.3, ay, z, 0, 0, Math.PI / 2);
        void arm;
        cyl(g, 0.11, 0.11, 0.7, cactus, x + s * 0.52, ay, z, 8);
      }
    }
    for (let k = 0; k < 14; k++) {
      const r = place(g, new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + hash(k) * 0.5, 0), rockD), -8 + hash(k + 2) * 16, 0.1, -3 - hash(k + 5) * 14);
      r.scale.y = 0.6;
    }
    return { hemi: [0xffc28a, 0x6a3a2a, 1.1], key: [0xffb070, 3.0], fill: [0x8a6ac8, 0.9], rim: [0xff7a3a, 2.4], env: 0.6, fog: [0xe8905a, 60, 260], bg: 0xe8905a, keyPos: [4.5, 2.2, -1.5] };
  },

  // PIT LANE: pit wall with kerb stripes, stacked tyre walls, garage fronts,
  // a checkered banner, the start lights.
  pitlane(g) {
    sky(g, [[-1, 0x8a9aa8], [0, 0xcfd8e0], [0.3, 0x8fb0d0], [1, 0x4a78b0]]);
    floor(g, std(0x3c3e42, 0.9, 0, { map: paint(32, 32, (u, v, x, y) => { const n = 60 + hash(x * 7 + y * 13) * 14; return [n, n, n + 3]; }, [30, 30]) }), 200);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.12), std(0xe8e2d4, 0.7));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.003, 1.6); g.add(line);
    // garages
    const panel = std(0x9aa3ad, 0.6, 0.3), door = std(0x2a2e33, 0.6, 0.4);
    box(g, 40, 4.5, 0.4, panel, 0, 0, -6.5);
    for (let k = -3; k <= 3; k++) {
      box(g, 3.6, 3.2, 0.1, door, k * 5, 0, -6.28);
      box(g, 3.6, 0.3, 0.12, std([0xd4622a, 0x2a6bd4, 0xc4b03a, 0x3f8a6b][(k + 3) % 4], 0.5), k * 5, 3.3, -6.26);
    }
    // pit wall with kerb stripes
    const kerb = std(0xffffff, 0.7, 0, { map: paint(8, 2, (u) => (u < 0.5 ? [200, 40, 32] : [232, 228, 220]), [20, 1]) });
    box(g, 40, 1.0, 0.4, kerb, 0, 0, -3.3);
    // tyre walls
    const rubber = std(0x131415, 0.85), band = std(0xd8d2c4, 0.8);
    for (const x of [-4.2, -3.5, 3.5, 4.2]) for (let k = 0; k < 4; k++) {
      place(g, new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.11, 8, 16), k === 3 ? band : rubber), x, 0.11 + k * 0.22, -2.6, Math.PI / 2);
    }
    // checkered banner on a gantry
    const check = paint(16, 4, (u, v, x, y) => ((x + y) % 2 ? [20, 20, 22] : [236, 234, 228]), [4, 1]);
    const iron = std(0x2b2f33, 0.5, 0.6);
    for (const x of [-6, 6]) cyl(g, 0.12, 0.12, 5.4, iron, x, 0, -4.2, 8);
    box(g, 12.4, 0.2, 0.2, iron, 0, 5.2, -4.2);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.9), new THREE.MeshStandardMaterial({ map: check, roughness: 0.8, side: THREE.DoubleSide }));
    ban.position.set(0, 4.7, -4.1); g.add(ban);
    for (let k = 0; k < 5; k++) {
      box(g, 0.34, 0.34, 0.2, std(0x111214, 0.5), -1.0 + k * 0.5, 3.8, -4.1);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), glow(0xff2a1a, 2.4)); l.position.set(-1.0 + k * 0.5, 3.97, -3.99); g.add(l);
    }
    // cones
    for (const x of [-2.4, 2.4]) {
      place(g, new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 10), std(0xff6a1a, 0.6)), x, 0.225, 1.2);
    }
    return { hemi: [0xdce8f4, 0x4a4a48, 1.5], key: [0xfff6e8, 3.4], fill: [0xa9bcd4, 1.1], rim: [0xffe0b0, 1.4], env: 0.9, fog: [0xcfd8e0, 40, 200], bg: 0xcfd8e0 };
  },

  // DEALER FLOOR: gloss black floor, a lit dais, spotlight cones, a light band.
  showroom(g) {
    floor(g, std(0x0c0d0f, 0.12, 0.35), 60);
    const dais = cyl(g, 1.75, 1.85, 0.08, std(0x1c1f23, 0.3, 0.6), 0, -0.08, 0, 48);
    dais.position.y = -0.04;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.018, 6, 64), glow(0xffb45a, 3));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.005; g.add(ring);
    const wall = std(0x1a1c20, 0.6, 0.1);
    box(g, 30, 6, 0.2, wall, 0, 0, -5);
    box(g, 14, 0.12, 0.05, glow(0xffb45a, 2.6), 0, 3.4, -4.88, 0, false);
    box(g, 14, 0.04, 0.05, glow(0xffffff, 1.6), 0, 3.2, -4.88, 0, false);
    // wall bays: helmets on plinths, lit from above
    const plinth = std(0x2a2d32, 0.35, 0.4);
    const shells = [0xf0efe8, 0xd4622a, 0x2f4a6b, 0x8a1f1f, 0xb9a44a];
    for (let k = 0; k < 5; k++) {
      const x = -5 + k * 2.5;
      if (Math.abs(x) < 1.5) continue;
      box(g, 0.6, 1.1, 0.6, plinth, x, 0, -4.2);
      const h = place(g, new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), std(shells[k], 0.15, 0.1)), x, 1.3, -4.2);
      h.scale.set(1, 1.08, 1.12);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      beam.position.set(x, 2.5, -4.2); g.add(beam);
    }
    // the hero spot over the dais
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff4e2, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.position.set(0, 3, 0); g.add(cone);
    return { hemi: [0xc9d4e0, 0x101010, 0.9], key: [0xfff4e2, 3.6], fill: [0x9db4d0, 0.8], rim: [0xffb45a, 2.4], env: 0.9, fog: null, bg: 0x0b0c0e };
  },
};

/** Build a set. Unknown keys fall back to the studio. */
export function buildScene(key) {
  const group = new THREE.Group();
  group.name = 'showscene:' + key;
  const fn = BUILD[key] || BUILD.studio;
  const light = fn(group);
  return { group, light };
}

/** Free a set's GPU resources. */
export function disposeScene(group) {
  group.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    const m = n.material;
    if (m) for (const mm of (Array.isArray(m) ? m : [m])) {
      for (const k of ['map', 'emissiveMap']) if (mm[k]) mm[k].dispose();
      mm.dispose();
    }
  });
}
