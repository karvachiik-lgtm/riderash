// RideRash -- road traffic: the vehicles, how they drive, and what happens when
// a bike meets one.
//
// Split out of world.js (which re-exports buildTraffic/updateTraffic/
// resetTraffic/trafficHit from here, so main.js's import line is unchanged).
//
// WHAT WAS WRONG, measured before this file existed:
//   * One vehicle: a 1.82 x 4.30 m box saloon, five muted greys. No bus, no
//     truck, nothing the size of a Road Rash lorry to thread between.
//   * A traffic hit was never a crash. main.js did applyHit + 26 hp and only
//     called knockDown when hp reached 0, so a head-on at 78 m/s closing cost a
//     quarter of the health bar and the rider rode on THROUGH the car -- that is
//     the "there are no collisions" the user reported.
//   * Rivals and the cop never tested traffic at all: they rode through every
//     car on the road.
//   * Cars never slowed for anything, so two same-lane cars could sit inside
//     each other after a recycle.
//
// WHAT THIS DOES
//   * Six vehicle types built from assets/<type>.js (404 asset contract, one
//     generate(THREE, {paint, seed}) module each), baked here to ONE draw per
//     vehicle (see bakeVehicle) with per-instance paint.
//   * Per-type hit box (halfL/halfW from the baked geometry) used by every
//     contact test.
//   * Car-following: each car slows for the vehicle -- or the downed rider --
//     ahead in its lane, and recycled cars are placed clear of each other.
//   * trafficContact(): a SWEPT road-frame test that also says HOW the rider
//     arrived (through an end face = rear-end / head-on, or from the side =
//     side-swipe) and the closing speeds, so the response can be scaled.
//   * applyTrafficHit(): the physical response shared by player and rivals.
//   * trafficNear(): plain-number records for the NPC brain and the cop.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { centreAt, centreTangent } from './level.js';
import { edgeAt, openLanes, LANE, medianAt, MEDIAN_HALF } from './lanes.js';
import genSedan from '../assets/sedan.js';
import genPickup from '../assets/pickup_truck.js';
import genVan from '../assets/panel_van.js';
import genBoxTruck from '../assets/box_truck.js';
import genBus from '../assets/city_bus.js';
import genSemi from '../assets/semi_truck.js';

// ---------------------------------------------------------------------------
// Vehicle catalogue.
//
// halfW is the BODY half-width (mirrors excluded: a mirror glancing a rider's
// shoulder is not a crash); halfL is measured from the baked geometry, so it
// includes the bumpers. `mass` is only used as a ratio against a ~250 kg bike +
// rider, to decide how much the VEHICLE feels a hit. `pace` scales the cruise
// speed: a loaded semi or a bus does not run with the saloons. `wheelHalf` is
// half the span between the outermost axles, for the grade pitch.
// `weight` is the spawn share; sedans dominate, as on a real road.
// ---------------------------------------------------------------------------
const MUTED = [0x7a3a36, 0x3d5a45, 0x2f4f6f, 0x8a8a86, 0xb0a898, 0x2a2c30, 0x6a5a3a, 0x5a2f4a, 0xc9c3b4, 0x4a5a6a];
export const VEHICLES = {
  sedan:    { gen: genSedan,    halfW: 0.90, mass: 1400,  pace: 1.00, wheelHalf: 1.38, weight: 0.30, horn: 1.10, paints: MUTED },
  pickup:   { gen: genPickup,   halfW: 0.98, mass: 2100,  pace: 0.97, wheelHalf: 1.65, weight: 0.16, horn: 0.95, paints: MUTED },
  van:      { gen: genVan,      halfW: 1.00, mass: 2400,  pace: 0.93, wheelHalf: 1.58, weight: 0.14, horn: 1.00, paints: [0xc9c3b4, 0xd8d2c4, 0x8a8a86, 0x2f4f6f, 0x6a5a3a] },
  boxTruck: { gen: genBoxTruck, halfW: 1.20, mass: 7500,  pace: 0.82, wheelHalf: 2.65, weight: 0.13, horn: 0.78, paints: [0x2f5f7f, 0x8a2e26, 0xd8d2c4, 0x3d5a45, 0xb8912e] },
  bus:      { gen: genBus,      halfW: 1.28, mass: 12000, pace: 0.72, wheelHalf: 3.20, weight: 0.13, horn: 0.70, paints: [0xd8d2c4, 0xc9a23a, 0xb0a898] },
  semi:     { gen: genSemi,     halfW: 1.30, mass: 30000, pace: 0.80, wheelHalf: 7.40, weight: 0.14, horn: 0.60, paints: [0x8a2e26, 0x2f4f6f, 0xd8d2c4, 0x2a2c30, 0x3d5a45, 0xb8912e] },
};
const BIKE_MASS = 250;

// Rider pads added to a vehicle's half-extents for the contact box. A bike is
// 2.10 m long (half 1.05) but its CENTRE is what `s` tracks and the front wheel
// is what hits first, so 0.9 m along; across, 0.30 m of bars and elbows. These
// replace CFG.TRAFFIC_HIT_HALF_L/_W (2.60/1.15 absolute, sedan-only): for the
// sedan they give 3.39 (bumper to bumper 4.98/2 + 0.9) and 1.20, i.e. the old
// sideways forgiveness and a box that now actually reaches the bumpers.
export const TRAFFIC_PAD_L = 0.9;
export const TRAFFIC_PAD_W = 0.30;

// Closing speeds that turn a contact into a WIPEOUT. 8.5 m/s is ~19 mph: below
// it a rear-end is a nudge you ride off (the bike is matched to the car's speed
// and shoved), above it you go over the bars. A side-swipe needs 6 m/s of
// LATERAL closing (a hard deliberate swerve into the door) to put you down;
// ordinary lane drift is 1-3 m/s, which scrapes and shoves.
export const TRAFFIC_WRECK_END = 8.5;
export const TRAFFIC_WRECK_SIDE = 6.0;

// ---------------------------------------------------------------------------
// ONE DRAW PER VEHICLE.
//
// The asset modules are built the contract's way: many parts, a MeshStandard
// material per finish (paint, glass, chrome, rubber, lamps). Loaded as-is a
// sedan is 68 meshes; bakeStatic by material would still be ~9 draws, times
// ~11 vehicles. Here every part is welded into ONE geometry whose per-vertex
// attributes carry what the materials carried:
//   color  -- the finish colour, darkened toward the sills and jittered a few
//             percent per vertex for worn, uneven paint (STYLE-LOCK: "worn
//             industrial paint ... slightly dirty"),
//   pbr    -- (roughness, metalness, emissive) of the source material,
// and ONE shared material reads `pbr` in its shader. So glass stays glossy,
// chrome stays metal, lamps still glow, and the whole fleet is one program and
// one draw per vehicle.
// ---------------------------------------------------------------------------
let _sharedMat = null;
function vehicleMaterial() {
  if (_sharedMat) return _sharedMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.name = 'metal';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pbr;\nvarying vec3 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vPbr.z;');
  };
  m.customProgramCacheKey = () => 'riderash-vehicle-pbr';
  _sharedMat = m;
  return m;
}

export function bakeVehicle(group, seed) {
  group.updateMatrixWorld(true);
  const parts = [];
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const col = new THREE.Color();
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    geo.applyMatrix4(o.matrixWorld);
    const mat = o.material;
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3), p = new Float32Array(n * 3);
    col.copy(mat.color);   // THREE.Color is already linear working space
    const em = mat.emissiveIntensity && mat.emissive && mat.emissive.getHex() ? mat.emissiveIntensity * 1.6 : 0;
    const pos = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      // Grime toward the ground: x0.70 at the sill line, full colour by 1.3 m.
      const y = pos.getY(i);
      const grime = em > 0 ? 1 : 0.70 + 0.30 * THREE.MathUtils.smoothstep(y, 0.15, 1.3);
      const wear = em > 0 ? 1 : 0.95 + rnd() * 0.08;
      c[i * 3] = col.r * grime * wear; c[i * 3 + 1] = col.g * grime * wear; c[i * 3 + 2] = col.b * grime * wear;
      p[i * 3] = mat.roughness; p[i * 3 + 1] = mat.metalness; p[i * 3 + 2] = em;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('pbr', new THREE.BufferAttribute(p, 3));
    parts.push(geo);
  });
  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(merged, vehicleMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function pickType(r) {
  let x = r(), acc = 0;
  for (const [k, v] of Object.entries(VEHICLES)) { acc += v.weight; if (x < acc) return k; }
  return 'sedan';
}

// Lane centre for a vehicle. dir +1 = ONCOMING (s falls), -1 = with the player.
// Oncoming keep 0.6 m off the far edge, same-direction sit at 58% of the half-
// width (the old tuning) unless that would put a wide body within 0.45 m of the
// near edge. MEASURED widths on the 11 m road (half 5.50): sedan -4.00/+3.19,
// bus -3.62/+3.19 (bus edge at +4.47). The 4.6 m between the lanes is the
// threading gap the bikes live in.
function laneFor(u) {
  const half = CFG.ROAD_W / 2;
  const base = u.dir > 0 ? -(half - 0.6 - u.halfW) : Math.min(half * 0.58, half - 0.45 - u.halfW);
  // MULTI-LANE (lanes.js): the lane above is the INNER lane of the car's side;
  // an outer lane sits one LANE further out. A car wants its own lane (slow
  // heavies keep right, others pick), but only if that lane is open where the
  // car will be in a few seconds -- so it merges in before a lane ends, not at
  // the taper, and moves out once a new lane has opened.
  const side = u.dir > 0 ? -1 : 1, fwd = u.dir > 0 ? -1 : 1;
  const idx = Math.min(u.laneIdx || 0, openLanes(u.s + fwd * 140, side) - 1, openLanes(u.s, side) - 1);
  return base + side * idx * LANE;
}

function cruiseFor(u, r) {
  const base = u.dir > 0 ? 16 + r() * 12 : 20 + r() * 10;
  return base * VEHICLES[u.type].pace;
}

// ---------------------------------------------------------------------------
// Build. Vehicles are laid along the road every TRAFFIC_GAP_MIN..+SPAN metres,
// as before (see config.js for the density measurement).
// ---------------------------------------------------------------------------
export function buildTraffic(seed = 73) {
  let st = seed >>> 0;
  const r = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
  const g = new THREE.Group();
  g.name = 'traffic';
  const cars = [];
  let n = 0;
  // THE FLEET IS SIZED TO A FIXED LENGTH, NOT TO THE ROAD. Cars recycle to
  // within ~1 km of the player (see updateTraffic), so the number of cars -- not
  // the road length -- is the traffic density you meet. The road now grows to
  // the longest race (up to ~21 km); laying cars along all of it would have
  // quadrupled the fleet, the draw calls and the density.
  const fleetLen = Math.min(CFG.ROAD_SEGS * CFG.SEG, CFG.TRAFFIC_FLEET_LEN);
  for (let z = -120; z > -fleetLen; z -= CFG.TRAFFIC_GAP_MIN + r() * CFG.TRAFFIC_GAP_SPAN) {
    // Guarantee at least one of each big type early in the fleet so a race
    // always meets a bus and a lorry; after that the weighted draw decides.
    const forced = ['bus', 'semi', 'boxTruck', 'van', 'pickup'][n];
    const type = forced || pickType(r);
    const spec = VEHICLES[type];
    const paint = spec.paints[Math.floor(r() * spec.paints.length)];
    const src = spec.gen(THREE, { paint, seed: 1 + Math.floor(r() * 1e6) });
    const mesh = bakeVehicle(src, 11 + n * 31);
    const car = new THREE.Group();
    car.add(mesh);
    car.rotation.order = 'YXZ';   // yaw first, then the grade pitch (see updateTraffic)
    const bb = mesh.geometry.boundingBox;
    const u = car.userData;
    u.type = type;
    u.halfW = spec.halfW;
    u.halfL = (bb.max.z - bb.min.z) / 2;
    u.wheelHalf = spec.wheelHalf;
    u.mass = spec.mass;
    u.hornPitch = spec.horn;
    u.s = -z;
    // +1 oncoming, -1 with the player: every third vehicle runs with the
    // player, so two thirds oncoming as before. A fixed pattern, not a draw:
    // MEASURED, the seeded draw made all 9 vehicles oncoming on seed 73, and
    // the road had nothing to come up behind.
    u.dir = n % 3 === 1 ? -1 : 1;
    // which lane it takes when there is more than one: heavies keep to the
    // outside (slow lane), cars split between the two
    u.laneIdx = spec.halfW > 1.05 ? 1 : (r() < 0.5 ? 1 : 0);
    u.lane = laneFor(u);
    u.cruise = cruiseFor(u, r);
    u.speed = u.cruise;
    u.weave = r() * Math.PI * 2;
    u.stun = 0;
    u.cd = new Map();
    car.position.set(0, -9999, 0);
    g.add(car);
    cars.push(car);
    n++;
  }
  g.userData.cars = cars;
  return g;
}

// ---------------------------------------------------------------------------
// Drive the traffic ALONG THE ROAD, parameterised by arc length s (see the
// history in HANDOFF 3.4 for why a world-z integrator walked cars off the road).
// `riders` (optional): [{phys}] -- cars slow for a rider in their lane ahead,
// and ANY car stops for a downed rider lying in its lane.
// ---------------------------------------------------------------------------
let _clock = 0;
const _carY1 = new THREE.Vector3(), _carY2 = new THREE.Vector3();
const _c = new THREE.Vector3(), _tg = new THREE.Vector3();
function roadY(s, out) { centreAt(-s, out); return out.y; }

// Push `s` along `step` until no same-direction vehicle sits within a clear
// headway of it. Six tries of 45 m covers the worst case (a semi recycled onto
// a queue of two) without an unbounded loop.
function clearSpot(cars, u, s, step) {
  for (let k = 0; k < 6; k++) {
    let blocked = false;
    for (const o of cars) {
      const v = o.userData;
      if (v === u || v.off || v.dir !== u.dir) continue;
      if (Math.abs(v.s - s) < v.halfL + u.halfL + 30) { blocked = true; break; }
    }
    if (!blocked) return s;
    s += step;
  }
  return s;
}

export function updateTraffic(traffic, playerS, dt, t = 0, riders = null) {
  if (!traffic || !traffic.userData || !traffic.userData.cars) return;
  const cars = traffic.userData.cars;
  const half = CFG.ROAD_W / 2;
  const LEN = CFG.ROAD_SEGS * CFG.SEG;
  _clock += dt;

  for (const car of cars) {
    const u = car.userData;
    if (u.off) continue;                          // parked for this race's traffic level
    u.prevS = u.s;
    u.prevAt = u.at;
    // ---- target speed: cruise, then the vehicle (or rider) ahead ---------
    // travel sign along s: oncoming (dir +1) moves toward FALLING s.
    const fwd = u.dir > 0 ? -1 : 1;
    let target = u.cruise;
    for (const o of cars) {
      const v = o.userData;
      if (v === u || v.dir !== u.dir) continue;
      const d = (v.s - u.s) * fwd;
      if (d <= 0 || d > 120) continue;
      const gap = d - v.halfL - u.halfL;
      const want = 8 + u.speed * 1.4;          // 1.4 s time headway + 8 m standstill
      if (gap < want) target = Math.min(target, Math.max(0, v.speed + (gap - want) * 0.5));
    }
    let blockedBy = null;
    if (riders && !(u.passT > 0)) {
      for (const rd of riders) {
        const p = rd && rd.phys;
        if (!p) continue;
        const down = rd.fighter && rd.fighter.down;
        // Same-direction cars follow bikes in their lane; oncoming cars only
        // stop for a rider who is DOWN in front of them. A Road Rash car does not
        // dodge an upright bike coming at it -- that is the rider's problem.
        if (u.dir > 0 && !down) continue;
        if (Math.abs(p.lateral - (u.at ?? u.lane)) > u.halfW + 0.9) continue;
        const d = (p.s - u.s) * fwd;
        if (d <= 0 || d > 60) continue;
        const gap = d - u.halfL - 1.2;
        const want = 6 + u.speed * 1.2;
        const rv = down ? 0 : Math.max(0, p.speed * (u.dir > 0 ? -1 : 1));
        if (gap < want) target = Math.min(target, Math.max(0, rv + (gap - want) * 0.6));
        if (gap < 14 && rv < 3) blockedBy = p;
      }
    }
    // A DRIVER GOES ROUND. A car that stopped for a rider in its lane used to sit
    // there for good, and a rider remounting in front of it pushed into it
    // until the contacts wore him out -- MEASURED, ten wrecks in a row at a
    // standstill. After a moment's wait it pulls out and passes on the other
    // side, ignoring that rider while it does.
    if (blockedBy) {
      u.blockedT = (u.blockedT || 0) + dt;
      if (u.blockedT > 1.6) {
        u.passT = 4.0;
        u.passDir = Math.sign((u.at ?? u.lane) - blockedBy.lateral) || -Math.sign(u.lane || 1);
        u.blockedT = 0;
      }
    } else u.blockedT = 0;
    if (u.passT > 0) { u.passT -= dt; target = Math.max(target, Math.min(u.cruise, 9)); }
    if (u.stun > 0) { u.stun -= dt; target = 0; }   // just hit something: stand on the brakes
    // accelerate gently (2.2 m/s^2, a loaded vehicle), brake hard (7 m/s^2)
    u.speed += THREE.MathUtils.clamp(target - u.speed, -7 * dt, 2.2 * dt);
    if (u.speed < 0) u.speed = 0;
    u.s += fwd * u.speed * dt;

    // ---- recycle around the player, clear of other vehicles --------------
    let moved = false;
    // RECYCLED OUT OF SIGHT. Cars used to be re-placed 200-760 m ahead, and a
    // same-direction car that got too far ahead was dropped within 100 m of the
    // player -- right beside him, out of nowhere. The fog is thin (exp2 density
    // ~0.0004 leaves ~85% visible at 1 km), so it cannot hide a pop; distance
    // does: past ~1 km a car is a pixel or two. Ahead: 1.0-1.6 km. Behind: well
    // behind the camera, which looks forward.
    const far = CFG.TRAFFIC_SPAWN_AHEAD;
    if (u.dir > 0 && u.s < playerS - 120) { u.s = clearSpot(cars, u, playerS + far + Math.random() * 600, 45); moved = true; }
    else if (u.dir > 0 && u.s > playerS + far + 900) { u.s = clearSpot(cars, u, playerS + far + Math.random() * 300, 45); moved = true; }
    else if (u.dir < 0 && u.s < playerS - 300) { u.s = clearSpot(cars, u, playerS + far + Math.random() * 600, 45); moved = true; }
    else if (u.dir < 0 && u.s > playerS + far + 900) { u.s = clearSpot(cars, u, playerS - 380 - Math.random() * 250, -45); moved = true; }
    u.s = Math.max(10, Math.min(LEN - 10, u.s));
    if (moved) { u.prevS = u.s; u.speed = u.cruise; u.stun = 0; u.at = undefined; }

    const z = -u.s;
    const c = centreAt(z, _c), tg = centreTangent(z, _tg);
    // THE LATERAL SIGN. BikePhys `lateral` is + to the rider's RIGHT, which on
    // this road (travel toward -z, right = +x) is the road normal (tg.z, -tg.x).
    // The old placement used (-tg.z, tg.x) -- the OPPOSITE side. MEASURED with a
    // car at u.at = -3.75 and a bike reset to the same (s, lateral): car at
    // x = 42.91, bike at 33.83, road centre 39.18 -- the car was drawn 3.7 m to
    // the RIGHT of the centreline while every hit test put it 3.7 m LEFT. So the
    // car you could see was not where it could hit you, and the one that hit you
    // was invisible: the old "traffic has no collisions" in one sign.
    const nx = tg.z, nz = -tg.x;
    // A driver holds a lane, not a ruler. The weave shrinks with body width:
    // +/-0.28 m for a sedan, +/-0.14 for a semi, so a lorry does not wander
    // across the threading gap.
    const amp = 0.28 * Math.min(1, (0.9 / u.halfW) ** 2);
    // CARS DRIFT OVER THE LINE. With every car pinned to its lane the gap
    // between the lanes was a guaranteed-safe corridor: riding the centre line
    // with the throttle held never met a car. Road Rash traffic did not behave;
    // now and then a car or van ahead of the player (never a lorry or a bus)
    // wanders 2.3 m toward the centre for a few seconds -- overtaking,
    // cutting the bend, not looking -- and eases back. Rare, eased, and only in
    // front of the player, so it reads as a hazard you can see coming.
    const ahead = u.s - playerS;
    if (u.swerveT > 0) u.swerveT -= dt;
    else if (u.halfW < 1.05 && ahead > 60 && ahead < 220 && Math.random() < dt * CFG.TRAFFIC_SWERVE_RATE) {
      u.swerveT = 2.5 + Math.random() * 2.5;
    }
    const swTarget = u.passT > 0 ? u.passDir * (u.halfW * 2 + 1.4)
      : u.swerveT > 0 ? -Math.sign(u.lane || 1) * 2.3 : 0;
    u.swerve = (u.swerve || 0) + (swTarget - (u.swerve || 0)) * Math.min(1, dt * 1.2);
    u.lane = laneFor(u);                          // lanes open and close along the road
    const eR = edgeAt(Math.max(0, u.s), 1), eL = edgeAt(Math.max(0, u.s), -1);
    const lane = u.lane + u.swerve + Math.sin(t * 0.55 + u.weave) * amp;
    let want = Math.max(-eL + u.halfW + 0.1, Math.min(eR - u.halfW - 0.1, lane));
    // a divided section: stay on your own side of the barrier (look ahead so
    // a car over the line is back before the barrier starts)
    const side = u.dir > 0 ? -1 : 1, look = u.s + (u.dir > 0 ? -1 : 1) * 60;
    if (medianAt(u.s) || medianAt(look)) {
      const inner = MEDIAN_HALF + 0.35 + u.halfW;
      if (want * side < inner) want = side * inner;
    }
    // LATERAL INERTIA. The lane position used to be written straight from the
    // target, so a swerve or a pass began and ended with no build-up -- a car
    // slid sideways like a cursor. A car is a mass on four tyres: a damped
    // spring toward the lane it wants, with its sideways acceleration capped by
    // grip (softer for the big, heavy bodies).
    const heavy = (u.mass || 1500) > 6000;
    const aMax = heavy ? 1.6 : 2.8;
    if (moved || u.lp === undefined || !Number.isFinite(u.lp)) { u.lp = want; u.lv = 0; }
    const aLat = THREE.MathUtils.clamp((want - u.lp) * 2.2 - u.lv * 2.4, -aMax, aMax);
    u.lv += aLat * dt;
    u.lp += u.lv * dt;
    const off = Math.max(-eL + u.halfW + 0.05, Math.min(eR - u.halfW - 0.05, u.lp));
    car.position.set(c.x + nx * off, c.y, c.z + nz * off);
    // Oncoming cars face the road's geometric tangent (+z, the way they drive);
    // same-direction ones are flipped. The asset's front is +Z. A car moving
    // sideways POINTS where it is going: yaw by the angle of its lateral
    // velocity against its forward speed (sign flips with the direction).
    const dirSign = u.dir > 0 ? 1 : -1;
    const dyaw = THREE.MathUtils.clamp(-dirSign * Math.atan2(u.lv, Math.max(3, u.speed)), -0.35, 0.35);
    car.rotation.y = Math.atan2(tg.x, tg.z) + (u.dir > 0 ? 0 : Math.PI) + dyaw;
    // BODY MOTION on the springs, on the mesh (the group stays on the road):
    // roll away from the turn, dive under braking / squat under power, and a
    // little road jitter that grows with speed. Heavier bodies roll more.
    const body = car.children[0];
    if (body) {
      const aLong = dt > 0 ? (u.speed - (u._lastSpeed ?? u.speed)) / dt : 0;
      u._lastSpeed = u.speed;
      u._aL = (u._aL || 0) + (aLong - (u._aL || 0)) * Math.min(1, dt * 6);
      const rollK = heavy ? 0.022 : 0.012;
      const j = Math.min(1, u.speed / 25) * (heavy ? 1.4 : 1);
      const ph = _clock * 11 + (u.weave || 0) * 7;
      body.rotation.z = THREE.MathUtils.clamp(-dirSign * rollK * aLat, -0.07, 0.07)
        + Math.sin(ph * 1.3) * 0.004 * j;
      body.rotation.x = THREE.MathUtils.clamp(-0.008 * u._aL, -0.05, 0.05)
        + Math.sin(ph * 0.9 + 1.1) * 0.003 * j;
      body.position.y = (Math.sin(ph) * 0.008 + Math.sin(ph * 2.3 + 0.7) * 0.005) * j;
    }
    // Sit ON the grade: sample the road at both end axles and pitch to the line
    // between them (same as BikePhys.sampleAxles). Local +z is the front.
    const wh = u.wheelHalf;
    const yF = roadY(u.s + fwd * wh, _carY1), yR = roadY(u.s - fwd * wh, _carY2);
    car.rotation.x = -Math.atan2(yF - yR, wh * 2);
    car.position.y = (yF + yR) / 2;
    if (u.prevAt === undefined) u.prevAt = off;
    u.latV = u.lv;                                // real lateral velocity, for hits
    u.at = off;                                   // lane actually used, for hits
  }
}

/**
 * Spread the traffic out again for a new race (see the _nondet history: a race
 * that begins with a car on the grid shoves the player into the pack). Lanes are
 * re-derived FROM THE DIRECTION: this used to alternate lanes by index, which
 * put some oncoming cars in the player's lane after the first reset.
 */
export function resetTraffic(traffic, playerS = 0, density = 1) {
  if (!traffic || !traffic.userData || !traffic.userData.cars) return;
  const cars = traffic.userData.cars;
  // TRAFFIC LEVEL. The fleet is built once; each race puts a share of it on
  // the road (career level: quiet early, heavy late). Parked cars keep
  // `at === undefined`, which every contact / avoidance query already skips.
  const active = Math.max(1, Math.round(cars.length * Math.max(0, Math.min(1, density))));
  cars.forEach((car, i) => {
    const u = car.userData;
    u.off = i >= active;
    car.visible = !u.off;
    u.s = playerS + 260 + i * 165 + Math.random() * 90;
    u.lane = laneFor(u);
    u.swerve = 0; u.swerveT = 0; u.passT = 0; u.blockedT = 0; u.lp = undefined; u.lv = 0;
    u.at = undefined; u.prevAt = undefined; u.prevS = u.s;
    u.speed = u.cruise; u.stun = 0;
    if (u.cd) u.cd.clear();
    car.position.y = -9999;    // parked out of sight until updateTraffic places it
  });
}

// ---------------------------------------------------------------------------
// CONTACT.
//
// Swept in the road frame. For each vehicle the rider's position RELATIVE to it
// is compared this frame and last frame: the along-road interval between them
// must overlap the box, so an oncoming pass at 78 m/s closing (3.9 m per 0.05 s
// frame against a 3.39 m sedan half-box -- the thin margin the old point test
// relied on) can never step over a vehicle. Relative, not absolute: the old
// sweep added only the RIDER'S travel and missed the car's own 1.4 m/frame.
//
// And it says how the rider arrived. If last frame the rider was already
// inside the vehicle's lateral band, the contact came through an END face:
// rear-ending it, or head-on. Otherwise it came from the side: a side-swipe.
// ---------------------------------------------------------------------------
const _prev = new WeakMap();

export function trafficContact(traffic, p, padL = TRAFFIC_PAD_L, padW = TRAFFIC_PAD_W) {
  if (!traffic || !traffic.userData || !traffic.userData.cars || !p) return null;
  let pv = _prev.get(p);
  const now = { s: p.s, lat: p.lateral };
  // a teleport (race reset, remount placement) is not motion
  if (!pv || Math.abs(pv.s - p.s) > 25 || Math.abs(pv.lat - p.lateral) > 4) pv = now;
  _prev.set(p, now);
  for (const car of traffic.userData.cars) {
    const u = car.userData;
    if (u.at === undefined) continue;
    const L = u.halfL + padL, W = u.halfW + padW;
    const relNow = p.s - u.s, relPrev = pv.s - (u.prevS ?? u.s);
    if (Math.max(relNow, relPrev) < -L || Math.min(relNow, relPrev) > L) continue;
    const latNow = p.lateral - u.at, latPrev = pv.lat - (u.prevAt ?? u.at);
    if (Math.abs(latNow) > W && (Math.abs(latPrev) > W || Math.sign(latNow) === Math.sign(latPrev))) continue;
    // Inside the per-pair cooldown the contact is still SOLID, just silent:
    // MEASURED, suppressing it outright let a bumped rider (still faster than
    // the semi) ride 3.3 m into its tail during the 0.6 s window.
    const cd = u.cd && u.cd.get(p);
    const quiet = !!(cd && cd > _clock);
    const carVs = u.dir > 0 ? -u.speed : u.speed;               // vehicle velocity along +s
    const riderVs = p.speed * Math.cos(p.yawOffset || 0);
    const face = relPrev !== 0 ? Math.sign(relPrev) : (relNow >= 0 ? 1 : -1);
    const closeAlong = face < 0 ? riderVs - carVs : carVs - riderVs;
    const side = Math.sign(latPrev) || Math.sign(latNow) || 1;
    const closeLat = Math.max(0, -side * ((p.lateralV || 0) - (u.latV || 0)));
    const end = Math.abs(latPrev) <= W && Math.abs(relPrev) >= L * 0.6 && closeAlong > 0;
    return {
      car, kind: end ? 'end' : 'side', face, side, L, W, quiet,
      closeAlong: Math.max(0, closeAlong), closeLat, carVs,
      relAlong: Math.abs(riderVs - carVs),
    };
  }
  return null;
}

/**
 * Apply a contact's physics to a bike, and to the vehicle. Returns
 * { wreck, severity, dmg }; the caller owns the fighter state, audio and FX.
 *
 * END (rear-end / head-on): the rider is put back on the face they hit -- a
 * bike does not pass through a bus -- and their speed along the road is set to
 * the vehicle's, less a bounce of 15% of the closing speed. Above
 * TRAFFIC_WRECK_END it is a wipeout. The vehicle loses closing * m_bike /
 * (m_bike + m_car) of its speed (a sedan ~15%, a semi <1%) and brakes.
 *
 * SIDE: the rider is placed on the vehicle's flank and shoved away at
 * 1.5 m/s + half the lateral closing, and loses speed to scrub in proportion to
 * the along-road sliding speed (an oncoming side-swipe at 70 m/s relative
 * scrubs 22%, a same-way nudge 5%). Above TRAFFIC_WRECK_SIDE lateral closing,
 * a wipeout.
 */
export function applyTrafficHit(p, hit, invuln = false) {
  const u = hit.car.userData;
  const lim = edgeAt(Math.max(0, p.s || 0), (p.lateral || 0) >= 0 ? 1 : -1) + CFG.KERB_W + 0.6;
  if (hit.quiet) {
    // positional constraint only: no damage, no wreck, no impulse to the car
    if (hit.kind === 'end') {
      p.s = u.s + hit.face * (hit.L + 0.05);
      if (hit.face < 0) p.speed = Math.min(p.speed, Math.max(0, hit.carVs));
    } else {
      p.lateral = Math.max(-lim, Math.min(lim, u.at + hit.side * (hit.W + 0.03)));
      if ((p.lateralV || 0) * hit.side < 0.5) p.lateralV = hit.side * 0.5;
    }
    return { wreck: false, severity: 0, dmg: 0, quiet: true };
  }
  if (u.cd) u.cd.set(p, _clock + 0.6);
  if (hit.kind === 'end') {
    const v = hit.closeAlong;
    p.s = u.s + hit.face * (hit.L + 0.05);
    if (hit.face < 0) p.speed = Math.max(0, Math.min(p.speed, Math.max(0, hit.carVs)) - v * 0.15);
    else p.speed = Math.max(p.speed, Math.max(0, hit.carVs) + 1.5);   // shunted from behind
    p.lateralV = (p.lateralV || 0) * 0.5 + (Math.random() - 0.5) * 2.0;
    u.speed = Math.max(0, u.speed - v * BIKE_MASS / (BIKE_MASS + u.mass));
    // A NUDGE IS NOT A CRASH. Leaning on a stopped car at walking pace used to
    // cost 3+ HP every contact and stun the car in place, which pinned both.
    if (v < 2) return { wreck: false, severity: v, dmg: 0 };
    u.stun = Math.max(u.stun || 0, v > TRAFFIC_WRECK_END ? 2.5 : 0.8);
    const wreck = !invuln && v > TRAFFIC_WRECK_END;
    return { wreck, severity: v, dmg: wreck ? 28 + v * 0.9 : 3 + v * 1.4 };
  }
  const vl = hit.closeLat;
  p.lateral = Math.max(-lim, Math.min(lim, u.at + hit.side * (hit.W + 0.03)));
  p.lateralV = hit.side * (1.5 + vl * 0.5);
  p.speed *= 1 - Math.min(0.25, 0.04 + hit.relAlong / 400);
  const wreck = !invuln && vl > TRAFFIC_WRECK_SIDE;
  const soft = vl < 1.5 && Math.abs(hit.relAlong || 0) < 3;
  return { wreck, severity: Math.max(vl, hit.relAlong * 0.08), dmg: soft ? 0 : 4 + vl * 2.5 };
}

/**
 * Plain-number view of the vehicles near `s`, for brains that must not hold
 * scene objects (npc.js) and for the cop. `vs` is velocity along +s.
 */
export function trafficNear(traffic, s, back = 10, fwd = 120) {
  const out = [];
  if (!traffic || !traffic.userData || !traffic.userData.cars) return out;
  for (const car of traffic.userData.cars) {
    const u = car.userData;
    if (u.at === undefined) continue;
    const d = u.s - s;
    if (d < -back - u.halfL || d > fwd + u.halfL) continue;
    out.push({ s: u.s, at: u.at, halfL: u.halfL, halfW: u.halfW, vs: u.dir > 0 ? -u.speed : u.speed });
  }
  return out;
}

/**
 * Legacy point/box query, kept for callers that only ask "is there a vehicle
 * here". Pads are ADDED to each vehicle's own half-extents.
 */
export function trafficHit(traffic, s, lateral, padL = TRAFFIC_PAD_L, padW = TRAFFIC_PAD_W, sweep = 0) {
  if (!traffic || !traffic.userData || !traffic.userData.cars) return null;
  for (const car of traffic.userData.cars) {
    const u = car.userData;
    if (u.at === undefined) continue;
    if (Math.abs(u.s - s) > u.halfL + padL + Math.max(0, sweep)) continue;
    if (Math.abs(u.at - lateral) > u.halfW + padW) continue;
    return car;
  }
  return null;
}
