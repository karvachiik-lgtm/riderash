// RideRash — THE CHAIN, as a real chain.
//
// WHAT IT REPLACES. assets/rider.js builds an 11-link nested joint chain and
// riderpose.animateChain used to write each link's angle from a hand-authored
// travelling-wave formula. It never knew where the hand actually went: the IK
// strike path (motions.js STRIKES.chain) moved the fist over the shoulder and
// out, and the chain waved the same canned wave in the fist's local frame, so a
// backhand, a lean, a braking bike all looked identical. It was 0.33 m long,
// half the 0.60 m the style lock fixes.
//
// NOW: N code-built links (an oval torus each, every other one turned 90 deg,
// the way a real chain's links interlock) sit on N+1 VERLET particles in WORLD
// space. Particle 0 is pinned to the fist every sub-step, the rest integrate
// gravity + quadratic air drag and are pulled back to the link pitch by a few
// PBD sweeps and one exact follow-the-leader pass. Everything the chain does is
// then a CONSEQUENCE of what the hand and the bike do:
//
//   * wind-up: the fist rises over the shoulder, the chain lags and trails;
//   * the crack: the fist whips forward and stops, the wave runs down the chain
//     and the TIP overtakes the hand (MEASURED below, `tipPeak`);
//   * follow-through: the momentum carries it round, low and across;
//   * riding: it hangs from the grip and streams back in the 40 m/s airflow,
//     swings forward when the bike brakes, out when it leans -- none of that is
//     authored, it is the bike's own acceleration seen by a free body.
//
// FIXED STEP. The sim sub-steps at 240 Hz whatever the frame rate, and the
// pinned fist is INTERPOLATED across the sub-steps from last frame's position to
// this frame's. Without that, at 10 fps and 40 m/s the fist jumps 4 m per frame
// and the chain is yanked through the pin. Sub-steps are capped (32), a jump
// larger than any bike can make in the frame is treated as a teleport (reset),
// and every particle is NaN-checked, so a hitch can never explode it.
//
// ONE DRAW CALL per chain: the links are one InstancedMesh parented to the
// rider's chain anchor (so `joints.chain.visible` still hides it and the rig
// clone carries it); the instance matrices are world matrices pre-multiplied by
// the anchor's inverse world matrix, so the sim stays in world space.
//
// PROPERTIES (the showroom's Chain panel edits PLAYER_CHAIN; rivals use the
// defaults): length, link size, weight, material. Gameplay reads them through
// chainAttack(): longer = more reach but a slower wind-up, heavier = more
// damage and knock-back, a slower swing and more stamina.
import * as THREE from 'three';

const KEY = 'riderash.chain.v1';

// The 0.60 m hanging length is STYLE-LOCK.md's; the blackened finish is the
// style lock's `leather 0x2a2624` "the chain" colour with a metal response.
export const CHAIN_DEFAULTS = Object.freeze({
  length: 0.60,      // m, fist to tip
  link: 0.045,       // m, link pitch (centre to centre)
  weight: 1.2,       // kg
  material: 'black',
});
export const CHAIN_LIMITS = {
  length: [0.60, 1.60],
  link: [0.030, 0.070],
  weight: [0.5, 3.0],
};
export const CHAIN_MATERIALS = {
  black: { label: 'Black', color: 0x2a2624, roughness: 0.42, metalness: 0.75 },
  steel: { label: 'Steel', color: 0x8a9199, roughness: 0.30, metalness: 0.95 },
  rusty: { label: 'Rusty', color: 0x6e3b22, roughness: 0.86, metalness: 0.45 },
  gold:  { label: 'Gold',  color: 0xc9a23c, roughness: 0.24, metalness: 1.0 },
};
const MAX_LINKS = 40;

const clampN = (v, [a, b], d) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d);

/** Validate a stored / edited record field by field, like settings.js does. */
export function normChain(r) {
  const o = r && typeof r === 'object' ? r : {};
  return {
    length: clampN(+o.length, CHAIN_LIMITS.length, CHAIN_DEFAULTS.length),
    link: clampN(+o.link, CHAIN_LIMITS.link, CHAIN_DEFAULTS.link),
    weight: clampN(+o.weight, CHAIN_LIMITS.weight, CHAIN_DEFAULTS.weight),
    material: CHAIN_MATERIALS[o.material] ? o.material : CHAIN_DEFAULTS.material,
  };
}

export function loadChain() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
  return normChain(raw);
}
export function saveChain(c) {
  try { localStorage.setItem(KEY, JSON.stringify(normChain(c))); } catch (e) { /* private mode */ }
}

// THE PLAYER'S CHAIN: one live object. The showroom mutates it in place (and
// saves it), main.js hands it to the player's Fighter as `chainCfg`, so a change
// in the showroom is the chain in the next race without any plumbing.
export const PLAYER_CHAIN = loadChain();
PLAYER_CHAIN.rev = 0;
export function setPlayerChain(patch) {
  Object.assign(PLAYER_CHAIN, normChain({ ...PLAYER_CHAIN, ...patch }));
  PLAYER_CHAIN.rev = (PLAYER_CHAIN.rev || 0) + 1;
  saveChain(PLAYER_CHAIN);
  return PLAYER_CHAIN;
}

/** Links in a chain of this length and pitch. */
export function linkCount(c) {
  return Math.max(6, Math.min(MAX_LINKS, Math.round(c.length / c.link)));
}

/**
 * GAMEPLAY. The chain's attack spec for these properties, derived from the base
 * ATTACKS.chain (combat.js) so the defaults ARE the base numbers exactly:
 *   reach   +1 m of chain is +1 m of reach (the arc test is centre to centre)
 *   wind    +45% per extra metre and +20% per extra 1.2 kg: a long heavy chain
 *           is swung round, not flicked
 *   damage  ~ weight^0.6 * length^0.3 (tip energy grows with both, sub-linearly
 *           because a slower swing gives some of it back)
 *   push    ~ weight^0.7, stamina ~ weight^0.5
 */
const _specCache = new WeakMap();
export function chainAttack(base, cfg) {
  if (!cfg) return base;
  const key = `${cfg.length}|${cfg.weight}|${cfg.link}`;
  const hit = _specCache.get(cfg);
  if (hit && hit.key === key && hit.base === base) return hit.spec;
  const c = normChain(cfg), D = CHAIN_DEFAULTS;
  const wm = Math.max(0.8, Math.min(1.8, 1 + 0.45 * (c.length - D.length) + 0.20 * (c.weight - D.weight) / D.weight));
  const w = c.weight / D.weight, l = c.length / D.length;
  const spec = {
    ...base,
    range: base.range + (c.length - D.length),
    wind: base.wind * wm,
    // the recovery stretches by the same factor, so the hit stays at the
    // middle of the swing path (combat.js active.dur = wind + recover)
    recover: 0.22 * wm,
    cd: base.cd * (0.6 + 0.4 * wm),
    dmg: Math.round(base.dmg * Math.pow(w, 0.6) * Math.pow(l, 0.3)),
    push: base.push * Math.pow(w, 0.7),
    stamina: Math.round(base.stamina * Math.pow(w, 0.5)),
  };
  _specCache.set(cfg, { key, base, spec });
  return spec;
}

// ---------------------------------------------------------------------------
// THE SIMULATION
// ---------------------------------------------------------------------------
const G = -9.81;
const H = 1 / 240;           // sub-step
const MAX_SUB = 32;
const _mats = {};
function materialFor(key) {
  if (!_mats[key]) {
    const m = CHAIN_MATERIALS[key] || CHAIN_MATERIALS.black;
    _mats[key] = new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness });
    _mats[key].name = 'metal';
  }
  return _mats[key];
}

/** One oval link, long axis along +Y, pitch `p` between neighbours' centres. */
function linkGeometry(p) {
  // A real link's inside length is about the pitch plus two wire thicknesses:
  // that is what lets the next link sit inside it. Wire 0.2 p, width 0.72 p.
  const wire = p * 0.2, width = p * 0.72, len = p * 1.38;
  const g = new THREE.TorusGeometry((width - wire) / 2, wire / 2, 5, 12);
  g.scale(1, (len - wire) / (width - wire), 1);
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

function riderRoot(joints) {
  for (let n = joints.chain; n; n = n.parent) if (n.userData && n.userData.joints === joints) return n;
  return null;
}

function build(joints, cfg) {
  const old = joints.__chainSim;
  if (old && old.mesh) { old.mesh.removeFromParent(); old.mesh.geometry.dispose(); old.mesh.dispose(); }
  const N = linkCount(cfg);
  const pitch = cfg.length / N;
  const mesh = new THREE.InstancedMesh(linkGeometry(pitch), materialFor(cfg.material), N);
  mesh.name = 'chainLinks';
  mesh.frustumCulled = false;          // instances are placed in world space
  mesh.castShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  joints.chain.add(mesh);
  // HIDE THE OLD RIGID LINKS -- whatever rider.js (or a merge) left under the
  // anchor, everything except this mesh.
  joints.chain.traverse((n) => { if (n.isMesh && n !== mesh) n.visible = false; });
  const sim = {
    key: `${N}|${cfg.length}|${cfg.material}`, N, pitch, mesh,
    p: new Float64Array((N + 1) * 3), o: new Float64Array((N + 1) * 3),
    anchor: new THREE.Vector3(), rootPos: new THREE.Vector3(), rootV: new THREE.Vector3(),
    t: null, ready: false, tipSpeed: 0, tipRel: 0, tipPeak: 0, root: riderRoot(joints), resets: 0,
  };
  joints.__chainSim = sim;
  return sim;
}

/** Hang the chain straight down from the fist, moving with it. */
function reset(sim, anchor, vel) {
  const { p, o, N, pitch } = sim;
  for (let i = 0; i <= N; i++) {
    p[i * 3] = anchor.x; p[i * 3 + 1] = anchor.y - i * pitch; p[i * 3 + 2] = anchor.z;
    o[i * 3] = p[i * 3] - vel.x * H; o[i * 3 + 1] = p[i * 3 + 1] - vel.y * H; o[i * 3 + 2] = p[i * 3 + 2] - vel.z * H;
  }
  sim.ready = true;
  sim.resets++;
}

/**
 * Advance and draw one rider's chain. Called by riderpose.poseCombat after the
 * limbs are solved, so the fist is where the IK put it this frame.
 *   joints   the rider's joint map (joints.chain = the anchor below the fist)
 *   f        the Fighter (f.chainCfg: the player's properties; none = defaults)
 *   ph       attack phase 0..1, or < 0 when just carried
 *   time     a clock (s) that advances with the game; its delta is the step
 */
export function driveChain(joints, f, ph, time) {
  if (!joints || !joints.chain) return;
  const cfg = (f && f.chainCfg) || CHAIN_DEFAULTS;
  const N = linkCount(cfg);
  let sim = joints.__chainSim;
  if (!sim || sim.key !== `${N}|${cfg.length}|${cfg.material}`) sim = build(joints, cfg);
  const mesh = sim.mesh;

  joints.chain.updateWorldMatrix(true, false);
  const anchor = _a.setFromMatrixPosition(joints.chain.matrixWorld);
  let dt = sim.t === null ? 0 : time - sim.t;
  sim.t = time;
  // the showroom's loop clock wraps: a negative step is one ordinary frame
  if (dt < 0) dt = 1 / 60;
  const root = sim.root || riderRoot(joints);
  sim.root = root;
  const rootNow = root ? root.getWorldPosition(_d) : anchor;

  const moved = sim.ready ? anchor.distanceTo(sim.anchor) : 0;
  // A TELEPORT (race reset, respawn, re-shown after a long hide): more than any
  // bike can cover in the step. Re-hang instead of dragging the chain across.
  if (!sim.ready || dt > 0.5 || moved > 2.5 + 95 * dt) {
    sim.rootV.set(0, 0, 0);
    reset(sim, anchor, sim.rootV);
    sim.anchor.copy(anchor);
    sim.rootPos.copy(rootNow);
    dt = 0;
  }
  if (dt > 0) {
    dt = Math.min(dt, 0.25);
    sim.rootV.subVectors(rootNow, sim.rootPos).multiplyScalar(1 / dt);
    step(sim, joints, cfg, dt, anchor, ph);
    sim.rootPos.copy(rootNow);
  }
  sim.anchor.copy(anchor);
  write(sim, joints, anchor);
}

const _wind = new THREE.Vector3();
const _sph = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
function step(sim, joints, cfg, dt, anchorNow, ph) {
  const { p, o, N, pitch } = sim;
  const n = Math.min(MAX_SUB, Math.max(1, Math.ceil(dt / H - 1e-6)));
  const h = dt / n, h2 = h * h;
  // AIR. Quadratic drag against still air, per unit mass: a heavier chain of
  // the same length streams less. 0.010 at 1.2 kg MEASURED to trail the chain
  // ~55 deg back at 40 m/s (drag 16 m/s^2 vs gravity 9.8), the old formula's
  // "air 1.25 rad at top speed" feel. `__chainWind` is the showroom's fake
  // airflow (the stage does not move, the air does).
  const kd = 0.010 * Math.sqrt(CHAIN_DEFAULTS.weight / cfg.weight);
  const wind = joints.__chainWind || _wind.set(0, 0, 0);
  // Per-sub-step velocity retention: a little internal friction so a carried
  // chain settles instead of pendulum-ing forever. Heavier = swings longer.
  const keep = Math.pow(0.35 + 0.1 * Math.min(2, cfg.weight / 1.2), h);
  // BODY SPHERES (collision-lite): chest and head, so the wind-up over the
  // shoulder wraps the chain round the rider instead of through him.
  let ns = 0;
  if (joints.torso && joints.neck) {
    joints.neck.updateWorldMatrix(true, false);
    const t0 = _b.setFromMatrixPosition(joints.torso.matrixWorld), n0 = _c.setFromMatrixPosition(joints.neck.matrixWorld);
    const L = t0.distanceTo(n0);
    _sph[ns++].set(t0.x + (n0.x - t0.x) * 0.55, t0.y + (n0.y - t0.y) * 0.55, t0.z + (n0.z - t0.z) * 0.55, Math.max(0.12, L * 0.38));
    if (joints.head) {
      const hd = _b.setFromMatrixPosition(joints.head.matrixWorld);
      _sph[ns++].set(hd.x, hd.y + 0.08, hd.z, 0.14);
    }
  }
  // the ground: the bike's (road) origin, or the rider's feet off the bike
  const ik = joints.__ik;
  let gy = -Infinity;
  if (ik && ik.bike) gy = ik.bike.matrixWorld.elements[13] + 0.02;
  else if (sim.root) gy = sim.root.matrixWorld.elements[13] + 0.02;

  const ax0 = sim.anchor.x, ay0 = sim.anchor.y, az0 = sim.anchor.z;
  // THE WRIST SNAP. A fist on a spline cannot turn its wrist, and a real
  // chain-swinger's crack is mostly wrist: in a short window round the hit test
  // (u 0.50) the links are thrown along the fist's own direction of travel,
  // more toward the tip. MEASURED without it: the tip peaked on the wind-up
  // lift (37 m/s at u 0.19) and was only 34 m/s at contact.
  let fx = 0, fy = 0, fz = 0;
  if (ph >= 0) {
    const env = Math.max(0, 1 - Math.abs(ph - 0.49) / 0.09);
    if (env > 0 && dt > 0) {
      const hx = (anchorNow.x - ax0) / dt - sim.rootV.x, hy = (anchorNow.y - ay0) / dt - sim.rootV.y, hz = (anchorNow.z - az0) / dt - sim.rootV.z;
      const hl = Math.hypot(hx, hy, hz);
      if (hl > 0.5) { const A = 850 * env * env / hl; fx = hx * A; fy = hy * A; fz = hz * A; }
    }
  }
  const iters = 3;
  for (let s = 1; s <= n; s++) {
    const k = s / n;
    // pinned fist, interpolated across the frame
    const px = ax0 + (anchorNow.x - ax0) * k, py = ay0 + (anchorNow.y - ay0) * k, pz = az0 + (anchorNow.z - az0) * k;
    p[0] = px; p[1] = py; p[2] = pz; o[0] = px; o[1] = py; o[2] = pz;
    for (let i = 1; i <= N; i++) {
      const j = i * 3;
      const vx = (p[j] - o[j]) / h, vy = (p[j + 1] - o[j + 1]) / h, vz = (p[j + 2] - o[j + 2]) / h;
      const rx = vx - wind.x, ry = vy - wind.y, rz = vz - wind.z;
      const sp = Math.sqrt(rx * rx + ry * ry + rz * rz);
      // drag clamped so one sub-step can never reverse the relative velocity
      const dk = Math.min(kd * sp, 0.5 / h);
      const fw = (i / N) * (i / N);
      const ax = -dk * rx + fx * fw, ay = G - dk * ry + fy * fw, az = -dk * rz + fz * fw;
      const nx = p[j] + (p[j] - o[j]) * keep + ax * h2;
      const ny = p[j + 1] + (p[j + 1] - o[j + 1]) * keep + ay * h2;
      const nz = p[j + 2] + (p[j + 2] - o[j + 2]) * keep + az * h2;
      o[j] = p[j]; o[j + 1] = p[j + 1]; o[j + 2] = p[j + 2];
      p[j] = nx; p[j + 1] = ny; p[j + 2] = nz;
    }
    // PBD sweeps: equal masses, the pin infinitely heavy
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a = i * 3, b = a + 3;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const c = (d - pitch) / d;
        if (i === 0) { p[b] -= dx * c; p[b + 1] -= dy * c; p[b + 2] -= dz * c; }
        else {
          const hc = c * 0.5;
          p[a] += dx * hc; p[a + 1] += dy * hc; p[a + 2] += dz * hc;
          p[b] -= dx * hc; p[b + 1] -= dy * hc; p[b + 2] -= dz * hc;
        }
      }
    }
    // collisions, then ONE exact follow-the-leader pass: the links are steel,
    // they do not stretch, and FTL from the pin makes every pitch exact
    for (let i = 1; i <= N; i++) {
      const j = i * 3;
      for (let q = 0; q < ns; q++) {
        const S = _sph[q];
        const dx = p[j] - S.x, dy = p[j + 1] - S.y, dz = p[j + 2] - S.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < S.w * S.w && d2 > 1e-12) {
          const d = Math.sqrt(d2), m = (S.w - d) / d;
          p[j] += dx * m; p[j + 1] += dy * m; p[j + 2] += dz * m;
        }
      }
      if (p[j + 1] < gy) {
        p[j + 1] = gy;
        // scraping along the tarmac: friction on the horizontal velocity
        o[j] += (p[j] - o[j]) * 0.25; o[j + 2] += (p[j + 2] - o[j + 2]) * 0.25;
      }
    }
    for (let i = 0; i < N; i++) {
      const a = i * 3, b = a + 3;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(d > 1e-9)) { p[b] = p[a]; p[b + 1] = p[a + 1] - pitch; p[b + 2] = p[a + 2]; continue; }
      const m = pitch / d;
      p[b] = p[a] + dx * m; p[b + 1] = p[a + 1] + dy * m; p[b + 2] = p[a + 2] + dz * m;
    }
  }
  // NaN GUARD: a non-finite particle anywhere re-hangs the chain
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(o[i])) { reset(sim, anchorNow, sim.rootV); break; }
  }
  // tip speed, world and relative to the rider (the crack is the latter)
  const t = N * 3;
  const vx = (p[t] - o[t]) / h, vy = (p[t + 1] - o[t + 1]) / h, vz = (p[t + 2] - o[t + 2]) / h;
  sim.tipSpeed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const r = sim.rootV;
  sim.tipRel = Math.hypot(vx - r.x, vy - r.y, vz - r.z);
  if (ph >= 0) sim.tipPeak = Math.max(sim.tipPeak, sim.tipRel);
  else sim.tipPeak = 0;
  sim.ph = ph;
}

/** Instance matrices: each link between two particles, frames parallel-transported down the chain. */
function write(sim, joints, anchor) {
  const { p, N, mesh } = sim;
  _inv.copy(joints.chain.matrixWorld).invert();
  // start the frame from the fist's own orientation, so link 0 does not spin
  joints.chain.getWorldQuaternion(_q);
  const prevDir = _b.set(0, -1, 0).applyQuaternion(_q);
  // links hang along -Y of the anchor; our link geometry is along Y (symmetric)
  for (let i = 0; i < N; i++) {
    const a = i * 3, b = a + 3;
    const dir = _c.set(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    const len = dir.length();
    if (len > 1e-9) dir.multiplyScalar(1 / len); else dir.copy(prevDir);
    _q2.setFromUnitVectors(prevDir, dir);
    _q.premultiply(_q2);
    prevDir.copy(dir);
    const qi = i & 1 ? _q2.copy(_q).multiply(_q90) : _q2.copy(_q);
    _d.set((p[a] + p[b]) * 0.5, (p[a + 1] + p[b + 1]) * 0.5, (p[a + 2] + p[b + 2]) * 0.5);
    _m.compose(_d, qi, _s).premultiply(_inv);
    mesh.setMatrixAt(i, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/** Debug / harness read-out of one rider's chain. */
export function chainState(joints) {
  const s = joints && joints.__chainSim;
  if (!s) return null;
  const t = s.N * 3;
  return {
    links: s.N, pitch: s.pitch, tipSpeed: s.tipSpeed, tipRel: s.tipRel, tipPeak: s.tipPeak, resets: s.resets,
    tip: [s.p[t], s.p[t + 1], s.p[t + 2]], anchor: s.anchor.toArray(),
    finite: Array.prototype.every.call(s.p, Number.isFinite),
    span: Math.hypot(s.p[t] - s.p[0], s.p[t + 1] - s.p[1], s.p[t + 2] - s.p[2]),
  };
}
