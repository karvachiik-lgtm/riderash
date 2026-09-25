// RideRash — LANDMARKS: the wonders you ride past.
//
// A race is two to four minutes of looking down a road; what makes a course a
// PLACE is the thing on the skyline you remember it by. Each course gets a few
// set pieces of the real Earth, all procedural (no meshes, no image files):
//
//   SIERRA NEVADA   a Yosemite valley: an El Capitan monolith with its dark
//                   water streaks, Half Dome, and a two-tier Yosemite Falls
//                   with its mist and a rainbow
//   PACIFIC COAST   Big Sur: sea stacks, a sea arch, a lighthouse on its rock
//                   with the lamp sweeping, a fall onto a cove (McWay)
//   NAPA VALLEY     hot-air balloons at dawn over the rows
//   PALM DESERT     Monument Valley buttes on their talus, a Delicate arch
//   PENINSULA       a red suspension bridge across the bay
//   GHAT ROAD       a Dudhsagar: a three-tier torrent down the far valley wall,
//                   with a rainbow in its spray
//   everywhere      birds wheeling over the open country
//
// Shapes are primitives DISPLACED by 3D value noise (so a monolith is a mass of
// buttresses, not a box), surfaced by terrainshader.js (rock, strata, streaks,
// bump). Water is scrolling alpha streaks; spray is soft sprites; the rainbow
// is a banded ring. Placed 350-900 m out, sunk below the ground, so nothing
// touches the road and the terrain hides their feet. ~3-6 draws a set piece.
import * as THREE from 'three';
import { centreAt, centreTangent, roadProfile } from './level.js';
import { enhanceTerrain } from './terrainshader.js';
import { ghatDropAt, GHAT_FLOOR } from './ghatdesign.js';

// ---- noise -----------------------------------------------------------------------
const H3 = (x, y, z) => { let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
function vn3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(H3(ix, iy, iz), H3(ix + 1, iy, iz), u), L(H3(ix, iy + 1, iz), H3(ix + 1, iy + 1, iz), u), v),
    L(L(H3(ix, iy, iz + 1), H3(ix + 1, iy, iz + 1), u), L(H3(ix, iy + 1, iz + 1), H3(ix + 1, iy + 1, iz + 1), u), v), w);
}
const fbm3 = (x, y, z, o = 4) => { let a = 0.5, s = 0, f = 1; for (let i = 0; i < o; i++) { s += a * vn3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, o)); };

/** Push every vertex along its (smooth) normal by fbm noise. amp in metres. */
// `yStretch` < 1 makes the noise long and vertical: a cliff's buttresses and
// the gullies between them run down the face, not across it
function displace(geo, amp, freq, bias = 0.5, mask = null, yStretch = 1) {
  geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal;
  // weld-safe: key identical positions so seams move together
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let d = cache.get(k);
    if (d === undefined) {
      const ridge = 1 - Math.abs(2 * fbm3(x * freq * 2.2 + 11, y * freq * 2.2 * yStretch, z * freq * 2.2 - 7, 3) - 1);
      // (fbm clusters near 0.5: stretch it to about +/-1 before scaling)
      d = ((fbm3(x * freq, y * freq * yStretch, z * freq) - bias) * 2.4 + (ridge - 0.5) * 1.6) * amp * (mask ? mask(x, y, z) : 1);
      cache.set(k, d);
    }
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}
// vertex colour by position, then GREEN wherever the surface faces up (ledges,
// crowns, talus benches hold soil and scrub) -- `veg` is how much
function vcolor(geo, fn, veg = 0, vegHex = 0x4f6a36) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color(), vc = new THREE.Color(vegHex);
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), col);
    if (veg && n) { const up = n.getY(i); const k = Math.max(0, Math.min(1, (up - 0.55) / 0.3)) * veg * (0.7 + 0.3 * vn3(p.getX(i) * 0.05, 0, p.getZ(i) * 0.05)); col.lerp(vc, k); }
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// ---- textures (generated) ---------------------------------------------------------
function streakTex() {
  const W = 64, H = 128, d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.sin(y * 0.17 + x * 0.5) * 1.8) * Math.sin(x * 0.31 + 1.3);
    const edge = Math.pow(Math.sin((x / (W - 1)) * Math.PI), 0.6);
    const i = (y * W + x) * 4;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = Math.round(255 * edge * (0.25 + 0.75 * s));
  }
  const t = new THREE.DataTexture(d, W, H); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}
function puffTex() {
  const N = 64, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / (N - 1) * 2 - 1, v = y / (N - 1) * 2 - 1, r = Math.hypot(u, v);
    const a = Math.max(0, 1 - r) ** 1.8 * (0.85 + 0.15 * Math.sin(x * 0.9) * Math.sin(y * 0.7));
    const i = (y * N + x) * 4;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
  }
  const t = new THREE.DataTexture(d, N, N); t.needsUpdate = true;
  return t;
}

const RAINBOW_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const RAINBOW_FS = `varying vec2 vUv; uniform float uA;
  vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
  void main(){ float r = vUv.y; float a = smoothstep(0.0,0.15,r)*smoothstep(1.0,0.85,r);
    // fade the arc's feet into the spray
    a *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    gl_FragColor = vec4(hue(0.02 + r*0.72), a*uA); }`;

// ---- the road frame --------------------------------------------------------------
const _c = new THREE.Vector3(), _t = new THREE.Vector3();
/** world point at (s, rider-lateral) and height dy over the road there */
function at(s, lat, dy = 0, out = new THREE.Vector3()) {
  centreAt(-s, _c); centreTangent(-s, _t);
  return out.set(_c.x + _t.z * lat, _c.y + dy, _c.z - _t.x * lat);
}
function yawAt(s) { centreTangent(-s, _t); return Math.atan2(_t.x, _t.z); }

export class Landmarks {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'landmarks';
    scene.add(this.group);
    this.anim = [];               // per-frame updaters
    this.streak = streakTex();
    this.puff = puffTex();
    this.t = 0;
  }
  _clear() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); }
    this.anim = [];
  }
  _rock(color, o = {}) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0 });
    enhanceTerrain(m, { rock: color, rockAmt: o.rockAmt ?? 1, strata: o.strata ?? 0.6, streak: o.streak ?? 0, farVeg: 0, bump: o.bump ?? 1.6, dirt: o.dirt ?? color });
    if (this.setEnv) this.setEnv(m, 0.35);
    return m;
  }

  /** Dress the course. `mapId`, `finishS`, `env` = scene.userData.setMaterialEnv */
  build(mapId, finishS, setEnv, lite = false) {
    this._clear();
    this.setEnv = setEnv;
    // LOW / MOBILE: the set pieces stay (they are what a course is remembered
    // by) but lighter -- coarser rock, no birds, no spray puffs or surf rings
    this.lite = lite;
    const L = finishS;
    const put = (fn, ...a) => { try { fn.apply(this, a); } catch (e) { console.warn('[landmarks]', e); } };
    if (mapId === 'sierra') {
      put(this._monolith, L * 0.1, 1, 560, { w: 520, h: 430, d: 320, color: 0xc2bdb2, streak: 1 });           // El Capitan
      put(this._falls, L * 0.28, 1, 470, { h: 420, tiers: [0.45, 0.4], cliff: 0xbab5aa, rainbow: true });     // Yosemite Falls
      put(this._dome, L * 0.46, -1, 700, { r: 260, color: 0xc8c3b8 });                                          // Half Dome
      put(this._falls, L * 0.74, -1, 430, { h: 260, tiers: [0.9], cliff: 0xb6b1a6, rainbow: false, w: 14 });   // Bridalveil
      put(this._birds, L * 0.3, 1, 180, 16);
      put(this._birds, L * 0.7, -1, 220, 12);
    } else if (mapId === 'coastal') {
      put(this._stacks, L * 0.06, -1, 330);
      put(this._lighthouse, L * 0.14, -1, 420);
      put(this._seaArch, L * 0.58, -1, 380);
      put(this._stacks, L * 0.66, -1, 300);
      put(this._falls, L * 0.9, -1, 300, { h: 62, tiers: [0.72], cliff: 0x9c8a6e, rainbow: false, w: 6, cove: true, baseDy: -35 });   // McWay, onto the cove
      put(this._birds, L * 0.2, -1, 160, 14);
      put(this._birds, L * 0.62, -1, 180, 14);
    } else if (mapId === 'valley') {
      put(this._balloons, L * 0.05, L * 0.7, lite ? 4 : 9);
      put(this._birds, L * 0.4, 1, 150, 12);
    } else if (mapId === 'desert') {
      put(this._butte, L * 0.1, 1, 700, { r: 120, h: 260 });
      put(this._butte, L * 0.16, -1, 820, { r: 90, h: 210 });
      put(this._arch, L * 0.34, 1, 420, { span: 70, h: 55 });
      put(this._butte, L * 0.52, -1, 650, { r: 160, h: 220, mesa: true });
      put(this._butte, L * 0.58, 1, 900, { r: 70, h: 300, spire: true });
      put(this._butte, L * 0.8, 1, 720, { r: 130, h: 240 });
      put(this._birds, L * 0.45, 1, 220, 8);
    } else if (mapId === 'peninsula') {
      put(this._bridge, L * 0.3, 1, 720);
      put(this._birds, L * 0.32, 1, 120, 14);
    } else if (mapId === 'ghat') {
      put(this._ghatFalls, L * 0.36);
      put(this._ghatFalls, L * 0.78);
      put(this._birds, L * 0.2, 1, 120, 10);
      put(this._birds, L * 0.6, -1, 140, 10);
    }
    // (drop the JS copies of these one-off geometries once uploaded: see scenery.js)
    this.group.traverse((o) => {
      const g = o.geometry;
      if (!g || o.isSprite || g === this._shared) return;
      // bounds FIRST: three computes them lazily at render, from these arrays
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingBox) g.computeBoundingBox();
      if (o.isInstancedMesh && !o.boundingSphere && o.frustumCulled) o.computeBoundingSphere();
      for (const k in g.attributes) { const a = g.attributes[k]; if (a.onUpload) a.onUpload(function () { this.array = null; }); }
      if (g.index && g.index.onUpload) g.index.onUpload(function () { this.array = null; });
    });
    return this.group.children.length;
  }

  update(dt, camPos) {
    this.t += dt;
    for (const f of this.anim) f(dt, this.t, camPos);
  }

  // ---- SET PIECES ----------------------------------------------------------------

  // a granite monolith: a rounded block, shattered by noise, streaked
  _monolith(s, side, D, o) {
    const g = this.lite ? new THREE.BoxGeometry(1, 1, 1, 14, 12, 10) : new THREE.BoxGeometry(1, 1, 1, 26, 22, 18);
    // round it (superellipsoid-ish) so it is a mass, not a box
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, z) || 1;
      const k = 0.5 + 0.5 * Math.max(Math.abs(x), Math.abs(z)) / r;
      x *= k; z *= k;
      const top = y > 0.3 ? (y - 0.3) : 0;                         // the crown rounds over
      x *= 1 - top * 0.9; z *= 1 - top * 0.5;
      p.setXYZ(i, x * o.w, (y + 0.5) * o.h, z * o.d);
    }
    displace(g, Math.min(o.w, o.d) * 0.22, 0.009, 0.5, null, 0.35);
    vcolor(g, (x, y, z, c) => c.setHex(0x5f6b48).lerp(new THREE.Color(o.color), Math.min(1, y / 60)).multiplyScalar(0.85 + 0.25 * vn3(x * 0.02, y * 0.004, z * 0.02)), o.veg ?? 0.8);
    const m = new THREE.Mesh(g, this._rock(o.color, { streak: o.streak, strata: 0.15 }));
    // (rotated so its width runs ALONG the road and its depth away from it)
    m.position.copy(at(s, side * (D + o.d / 2), o.baseDy ?? -70)); m.rotation.y = yawAt(s) + Math.PI / 2 + 0.12 * side;
    this.group.add(m);
    return m;
  }

  // Half Dome: a dome with its face sheared off
  _dome(s, side, D, o) {
    const g = this.lite ? new THREE.SphereGeometry(1, 36, 22) : new THREE.SphereGeometry(1, 64, 40);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0) y *= 0.25;                                          // sunk
      if (x > 0.32) x = 0.32 + (x - 0.32) * 0.06;                    // the sheer face
      p.setXYZ(i, x * o.r * 0.9, y * o.r * 1.25, z * o.r);
    }
    displace(g, 24, 0.014, 0.5, null, 0.5);
    vcolor(g, (x, y, z, c) => c.setHex(0x55653f).lerp(new THREE.Color(o.color), Math.min(1, y / 70)), 0.5);
    const m = new THREE.Mesh(g, this._rock(o.color, { streak: 0.7, strata: 0.25 }));
    m.position.copy(at(s, side * (D + o.r), -60));
    // the sheared face looks at the road
    m.rotation.y = yawAt(s) + (side > 0 ? Math.PI : 0);          // (local +x is the rider's right)
    this.group.add(m);
  }

  // a waterfall down a cliff: tiers of falling water, spray, a pool, a rainbow
  _falls(s, side, D, o) {
    const w = o.w || 22;
    const baseDy = o.baseDy ?? -70;
    const cliff = this._monolith(s, side, D, { w: o.cove ? 140 : 360, h: o.h * 1.05, d: o.cove ? 60 : 160, color: o.cliff, streak: 0.8, baseDy });
    // the lip the water leaves: on the cliff's road-facing side
    const yaw = yawAt(s);
    const toRoad = new THREE.Vector3(-Math.sin(yaw + Math.PI / 2) * side, 0, -Math.cos(yaw + Math.PI / 2) * side);
    const base = at(s, side * D, baseDy);
    let top = o.h * 1.0 - 70;                                        // height of the lip over the road
    const faceOff = 8;
    let y = base.y + o.h * 1.02;
    let tierTop = y;
    for (let ti = 0; ti < o.tiers.length; ti++) {
      const th = o.h * o.tiers[ti];
      const g = new THREE.PlaneGeometry(w * (1 + ti * 0.3), th, 1, 24);
      // arc out from the lip, then fall straight
      const pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const v = 0.5 - pp.getY(i) / th;                             // 0 at the lip .. 1 at the foot
        pp.setZ(i, faceOff + 10 * Math.sqrt(Math.max(0, v)) + (Math.sin(pp.getX(i) * 0.4) * 1.5));
      }
      const mat = new THREE.MeshBasicMaterial({ color: 0xf2f8fa, map: this.streak, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: true });
      mat.map = this.streak.clone(); mat.map.needsUpdate = true; mat.map.repeat.set(1.5, th / 40);
      const fall = new THREE.Mesh(g, mat);
      const c = base.clone().setY(tierTop - th / 2).addScaledVector(toRoad, 20 + ti * 8);
      fall.position.copy(c);
      fall.lookAt(c.clone().add(toRoad));
      this.group.add(fall);
      const speed = 1.1 + ti * 0.2;
      this.anim.push((dt) => { mat.map.offset.y += dt * speed; });
      // a ledge between tiers: spray there too
      this._spray(c.clone().setY(tierTop - th), w * 2.2, ti);
      tierTop -= th * 1.08;
    }
    // the pool and the river leaving it
    const pool = new THREE.Mesh(new THREE.CircleGeometry(w * 2.4, 24), new THREE.MeshStandardMaterial({ color: 0x3f8f86, roughness: 0.15, metalness: 0.1 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.copy(base.clone().setY(o.cove ? -17.7 : tierTop + 1).addScaledVector(toRoad, 20 + w * 1.5));
    this.group.add(pool);
    if (o.rainbow) this._rainbow(pool.position.clone().setY(pool.position.y + 10), w * 4, toRoad);
    void top; void cliff;
  }

  _spray(p, size, i) {
    if (this.lite && i > 0) return;
    const mat = new THREE.SpriteMaterial({ map: this.puff, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: true });
    const puffs = [];
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Sprite(mat.clone());
      sp.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * size * 0.6, Math.random() * size * 0.3, (Math.random() - 0.5) * size * 0.6));
      const sc = size * (0.6 + Math.random() * 0.6); sp.scale.set(sc, sc, 1);
      sp.userData.base = sc; sp.userData.ph = Math.random() * 6.28 + i;
      this.group.add(sp); puffs.push(sp);
    }
    this.anim.push((dt, t) => { for (const sp of puffs) { const k = 1 + 0.12 * Math.sin(t * 0.9 + sp.userData.ph); sp.scale.set(sp.userData.base * k, sp.userData.base * k, 1); sp.material.opacity = 0.42 + 0.14 * Math.sin(t * 0.7 + sp.userData.ph); } });
  }

  _rainbow(p, r, toRoad) {
    const mat = new THREE.ShaderMaterial({ vertexShader: RAINBOW_VS, fragmentShader: RAINBOW_FS, uniforms: { uA: { value: 0.32 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    // a half ring, uv.y across the band
    const g = new THREE.RingGeometry(r * 0.86, r, 64, 1, 0, Math.PI);
    const uv = g.attributes.uv, pp = g.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), rr = Math.hypot(x, y);
      uv.setXY(i, Math.atan2(y, x) / Math.PI, (rr - r * 0.86) / (r * 0.14));
    }
    const m = new THREE.Mesh(g, mat);
    m.position.copy(p);
    m.lookAt(p.clone().add(toRoad));
    this.group.add(m);
    this.anim.push((dt, t) => { mat.uniforms.uA.value = 0.26 + 0.08 * Math.sin(t * 0.3); });
  }

  // Big Sur sea stacks: fluted columns in the surf, green-topped
  _stacks(s, side, D) {
    const mat = this._rock(0x8a7a62, { strata: 0.9 });
    for (let i = 0; i < 6; i++) {
      const r = 10 + Math.random() * 22, h = 25 + Math.random() * 55;
      const g = new THREE.CylinderGeometry(r * 0.75, r * 1.15, h + 30, 20, 10);
      displace(g, r * 0.4, 0.05, 0.5, null, 0.35);
      vcolor(g, (x, y, z, c) => c.setHex(0x8a7a62).multiplyScalar(0.85 + 0.25 * vn3(x * 0.1, y * 0.05, z * 0.1)), 1, 0x6f8a4a);
      const m = new THREE.Mesh(g, mat);
      m.position.copy(at(s + (Math.random() - 0.5) * 260, side * (D + Math.random() * 260), 0)).setY(-18 + (h - 30) / 2);
      m.rotation.y = Math.random() * 6.28;
      this.group.add(m);
      this._surf(m.position.clone().setY(-17.6), r * 1.6);
    }
  }
  _surf(p, r) {
    if (this.lite) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: this.puff, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r * 1.5, 24), mat);
    m.rotation.x = -Math.PI / 2; m.position.copy(p);
    this.group.add(m);
    const ph = Math.random() * 6.28;
    this.anim.push((dt, t) => { const k = 1 + 0.08 * Math.sin(t * 1.3 + ph); m.scale.set(k, k, 1); mat.opacity = 0.35 + 0.2 * Math.sin(t * 1.3 + ph); });
  }

  _seaArch(s, side, D) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-45, -25, 0), new THREE.Vector3(-40, 20, 0), new THREE.Vector3(-22, 48, 3),
      new THREE.Vector3(5, 56, 0), new THREE.Vector3(30, 44, -3), new THREE.Vector3(44, 12, 0), new THREE.Vector3(48, -25, 0),
    ]);
    const g = new THREE.TubeGeometry(curve, 60, 14, 14, false);
    displace(g, 7, 0.07, 0.5);
    vcolor(g, (x, y, z, c) => c.setHex(0x8a7a62), 1, 0x6f8a4a);
    const m = new THREE.Mesh(g, this._rock(0x8a7a62, { strata: 1 }));
    m.position.copy(at(s, side * (D + 60), 0)).setY(-18);
    m.rotation.y = yawAt(s) + 0.4;
    this.group.add(m);
    this._surf(m.position.clone().setY(-17.6).add(new THREE.Vector3(-40, 0, 0)), 20);
    this._surf(m.position.clone().setY(-17.6).add(new THREE.Vector3(45, 0, 0)), 20);
  }

  _lighthouse(s, side, D) {
    const p = at(s, side * D, 0).setY(-18);
    // its rock
    const rock = new THREE.CylinderGeometry(40, 60, 50, 22, 8);
    displace(rock, 12, 0.05, 0.5);
    vcolor(rock, (x, y, z, c) => c.setHex(0x8a7a62), 1, 0x6f8a4a);
    const rm = new THREE.Mesh(rock, this._rock(0x8a7a62, { strata: 0.8 }));
    rm.position.copy(p).setY(p.y + 8); this.group.add(rm);
    const topY = p.y + 33;
    // the tower: white with a red band, a gallery, a glowing lantern
    const tower = new THREE.CylinderGeometry(3.2, 4.4, 26, 18, 6);
    vcolor(tower, (x, y, z, c) => c.setHex(y > 4 && y < 8 ? 0xb8302a : 0xf2efe8));
    const tm = new THREE.Mesh(tower, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    tm.position.copy(p).setY(topY + 13); this.group.add(tm);
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.8, 18), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    gallery.position.copy(p).setY(topY + 26.4); this.group.add(gallery);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3.2, 12), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd978, emissiveIntensity: 2.4 }));
    lamp.position.copy(p).setY(topY + 28.4); this.group.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3.2, 12), new THREE.MeshStandardMaterial({ color: 0xb8302a, roughness: 0.5 }));
    cap.position.copy(p).setY(topY + 31.6); this.group.add(cap);
    const house = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 7), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8 }));
    house.position.copy(p).setY(topY + 3).add(new THREE.Vector3(8, 0, 4)); this.group.add(house);
    // the beam: a long faint cone, sweeping
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beamG = new THREE.ConeGeometry(14, 220, 16, 1, true); beamG.translate(0, -110, 0); beamG.rotateZ(Math.PI / 2);
    const pivot = new THREE.Group(); pivot.position.copy(lamp.position);
    const beam = new THREE.Mesh(beamG, beamMat); pivot.add(beam);
    const beam2 = new THREE.Mesh(beamG, beamMat); beam2.rotation.y = Math.PI; pivot.add(beam2);
    this.group.add(pivot);
    this.anim.push((dt) => { pivot.rotation.y += dt * 0.7; });
    this._surf(p.clone().setY(-17.6), 70);
  }

  // hot-air balloons drifting over the valley
  _balloons(s0, s1, n) {
    const gores = [0xd8412f, 0xf2c14e, 0x2f7fd8, 0xf2efe8, 0x3fa65a, 0x8e3fd8, 0xf28c2f];
    for (let i = 0; i < n; i++) {
      const s = s0 + (s1 - s0) * (i + Math.random() * 0.6) / n;
      const side = Math.random() < 0.5 ? -1 : 1;
      const lat = side * (140 + Math.random() * 380);
      const hgt = 70 + Math.random() * 160;
      const R = 8 + Math.random() * 3;
      const g = new THREE.SphereGeometry(R, 24, 18);
      const pp = g.attributes.position;
      for (let k = 0; k < pp.count; k++) { const y = pp.getY(k); if (y < 0) { const t = -y / R; pp.setX(k, pp.getX(k) * (1 - 0.55 * t * t)); pp.setZ(k, pp.getZ(k) * (1 - 0.55 * t * t)); } pp.setY(k, y * 1.18); }
      g.computeVertexNormals();
      const a = gores[i % gores.length], b = gores[(i * 3 + 2) % gores.length];
      vcolor(g, (x, y, z, c) => c.setHex(Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 6)) % 2 ? a : b));
      const env = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
      const basket = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }));
      basket.position.y = -R * 1.18 - 4.5;
      const ropes = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, 1.1, 3.4, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x2a2a2a, wireframe: true }));
      ropes.position.y = -R * 1.18 - 2.2;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 8), new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.9 }));
      flame.position.y = -R * 1.18 - 3.0; flame.rotation.x = Math.PI;
      const b1 = new THREE.Group(); b1.add(env, basket, ropes, flame);
      const home = at(s, lat, hgt);
      b1.position.copy(home);
      this.group.add(b1);
      const ph = Math.random() * 6.28, dx = (Math.random() - 0.5) * 0.6, dz = (Math.random() - 0.5) * 0.6;
      this.anim.push((dt, t) => {
        b1.position.set(home.x + Math.sin(t * 0.05 + ph) * 30 + dx * t, home.y + Math.sin(t * 0.21 + ph) * 4, home.z + Math.cos(t * 0.04 + ph) * 30 + dz * t);
        b1.rotation.y = t * 0.03 + ph;
        flame.visible = Math.sin(t * 0.9 + ph * 3) > 0.55;
      });
    }
  }

  // Monument Valley: a butte (or a mesa, or a spire) on its talus skirt
  _butte(s, side, D, o) {
    const mat = this._rock(0xa4583a, { strata: 1, bump: 2 });
    const r = o.r, h = o.h;
    const topR = o.spire ? r * 0.4 : o.mesa ? r * 1.0 : r * 0.9;
    const g = new THREE.CylinderGeometry(topR, r, h, 32, 18);
    displace(g, r * 0.22, 0.02, 0.5, (x, y) => (y > h / 2 - 2 ? 0.25 : 1), 0.25);
    // banded sandstone: the Organ Rock / de Chelly layers read as colour bands
    vcolor(g, (x, y, z, c) => c.setHex(0x9a5a36).lerp(new THREE.Color(0xc07a4a), 0.5 + 0.5 * Math.sin(y * 0.09)).multiplyScalar(0.9 + 0.2 * vn3(x * 0.03, y * 0.01, z * 0.03)));
    const m = new THREE.Mesh(g, mat);
    const talusG = new THREE.CylinderGeometry(r * 1.05, r * 2.3, h * 0.38, 32, 6);
    displace(talusG, r * 0.2, 0.02, 0.5);
    vcolor(talusG, (x, y, z, c) => c.setHex(0xb07a4e), 0.25, 0x8a7a48);
    const tm = new THREE.Mesh(talusG, this._rock(0xb07a4e, { strata: 0.4, rockAmt: 0.6 }));
    // (on the ground: the course's desert floor rolls, so sink the talus well in)
    const p = at(s, side * (D + r), -45);
    m.position.copy(p).setY(p.y + h * 0.5 + h * 0.08);
    tm.position.copy(p).setY(p.y + h * 0.12);
    this.group.add(m, tm);
  }

  // a free-standing arch (Delicate Arch)
  _arch(s, side, D, o) {
    const S = o.span / 2, H = o.h;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-S, -6, 0), new THREE.Vector3(-S * 0.95, H * 0.5, 0), new THREE.Vector3(-S * 0.55, H * 0.95, 0),
      new THREE.Vector3(0, H * 1.05, 0), new THREE.Vector3(S * 0.55, H * 0.9, 0), new THREE.Vector3(S * 0.9, H * 0.45, 0), new THREE.Vector3(S, -6, 0),
    ]);
    const g = new THREE.TubeGeometry(curve, 60, 7, 12, false);
    const pp = g.attributes.position;
    // legs thick, the span thin
    for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); const k = 1 + 0.8 * Math.max(0, 1 - y / (H * 0.6)); pp.setZ(i, pp.getZ(i) * k); }
    displace(g, 4, 0.08, 0.5);
    vcolor(g, (x, y, z, c) => c.setHex(0xb0603a));
    const m = new THREE.Mesh(g, this._rock(0xb0603a, { strata: 1 }));
    const p = at(s, side * D, 0);
    m.position.copy(p); m.rotation.y = yawAt(s) + 0.25;
    this.group.add(m);
  }

  // a red suspension bridge over a bay
  _bridge(s, side, D) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc0402c, roughness: 0.55, metalness: 0.2 });
    const g = new THREE.Group();
    const span = 900, towerH = 220, deckY = 70;
    const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
    for (const tx of [-span / 2, span / 2]) {
      for (const tz of [-12, 12]) box(8, towerH, 7, tx, towerH / 2, tz);
      for (const y of [deckY + 30, towerH * 0.62, towerH * 0.85, towerH - 6]) box(7, 8, 24, tx, y, 0);
    }
    box(span * 1.7, 5, 26, 0, deckY, 0);                                    // the deck
    // main cables and hangers
    const hang = [];
    for (const tz of [-12, 12]) {
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const x = -span * 0.85 + (span * 1.7) * i / 80;
        const inMain = Math.abs(x) <= span / 2;
        const y = inMain ? deckY + 8 + (towerH - deckY - 8) * Math.pow(x / (span / 2), 2) : towerH - (towerH - deckY - 4) * Math.min(1, (Math.abs(x) - span / 2) / (span * 0.35));
        pts.push(new THREE.Vector3(x, y, tz));
        if (i % 2 === 0 && y > deckY + 6) hang.push([x, deckY, y, tz]);
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 1.2, 6, false), mat);
      g.add(tube);
    }
    const hg = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1, 0.4), mat, hang.length);
    const mm = new THREE.Matrix4();
    hang.forEach(([x, y0, y1, z], i) => { mm.compose(new THREE.Vector3(x, (y0 + y1) / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, y1 - y0, 1)); hg.setMatrixAt(i, mm); });
    g.add(hg);
    // the bay under it
    const bay = new THREE.Mesh(new THREE.PlaneGeometry(span * 2.6, 700), new THREE.MeshStandardMaterial({ color: 0x35606e, roughness: 0.2, metalness: 0.15 }));
    bay.rotation.x = -Math.PI / 2; bay.position.set(0, 0.5, 0); g.add(bay);
    const p = at(s, side * (D + 200), 0);
    g.position.set(p.x, p.y - 45, p.z);
    g.rotation.y = yawAt(s) + Math.PI / 2 + 0.35;
    this.group.add(g);
  }

  // the ghat's torrent: a sheer wall on the far side of the valley, three tiers
  _ghatFalls(s) {
    const side = ghatDropAt(s, 1) ? 1 : ghatDropAt(s, -1) ? -1 : 1;
    const D = 520;
    const floor = GHAT_FLOOR;
    centreAt(-s, _c);
    const lift = floor - _c.y;                                           // (at() is relative to the deck)
    const wall = this._monolith(s, side, D + 30, { w: 700, h: 330, d: 200, color: 0x5e564d, streak: 0.6, veg: 1.4 });
    wall.position.y = floor - 20;
    const yaw = yawAt(s);
    const toRoad = new THREE.Vector3(-Math.sin(yaw + Math.PI / 2) * side, 0, -Math.cos(yaw + Math.PI / 2) * side);
    const base = at(s, side * D, lift);
    let tierTop = floor + 300;
    const w = 26;
    for (const [frac, k] of [[0.38, 0], [0.3, 1], [0.24, 2]]) {
      const th = 300 * frac;
      const g = new THREE.PlaneGeometry(w * (1 + k * 0.4), th, 1, 20);
      const mat = new THREE.MeshBasicMaterial({ color: 0xf4f9fa, map: this.streak.clone(), transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide, fog: true });
      mat.map.needsUpdate = true; mat.map.repeat.set(2, th / 35);
      const f = new THREE.Mesh(g, mat);
      const c = base.clone().setY(tierTop - th / 2).addScaledVector(toRoad, 30 + k * 14);
      f.position.copy(c); f.lookAt(c.clone().add(toRoad));
      this.group.add(f);
      this.anim.push((dt) => { mat.map.offset.y += dt * (1.2 + k * 0.15); });
      this._spray(c.clone().setY(tierTop - th), w * 2.6, k);
      tierTop -= th * 1.1;
    }
    this._rainbow(base.clone().setY(floor + 30).addScaledVector(toRoad, 90), 110, toRoad);
  }

  // birds wheeling: a few dozen dark Vs, flapping
  _birds(s, side, D, n) {
    if (this.lite) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.4, -1.2, 0.25, -0.2, 0, 0, -0.1, 0, 0, 0.4, 1.2, 0.25, -0.2, 0, 0, -0.1], 3));
    g.computeVertexNormals();
    const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x1c1c20, side: THREE.DoubleSide, fog: true }), n);
    const centre = at(s, side * D, 70 + Math.random() * 40);
    const birds = [];
    for (let i = 0; i < n; i++) birds.push({ r: 25 + Math.random() * 45, ph: Math.random() * 6.28, h: Math.random() * 18, sp: 0.25 + Math.random() * 0.2, fl: Math.random() * 6.28 });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    im.frustumCulled = false;
    this.group.add(im);
    this.anim.push((dt, t) => {
      birds.forEach((b, i) => {
        const a = t * b.sp + b.ph;
        p.set(centre.x + Math.cos(a) * b.r, centre.y + b.h + Math.sin(t * 0.5 + b.ph) * 4, centre.z + Math.sin(a) * b.r);
        e.set(0, -a, Math.sin(a) * 0.3); q.setFromEuler(e);
        const flap = 0.4 + 0.6 * Math.abs(Math.sin(t * 7 + b.fl));
        sc.set(1.6, 1.6 * flap, 1.6);
        im.setMatrixAt(i, m.compose(p, q, sc));
      });
      im.instanceMatrix.needsUpdate = true;
    });
  }
}
