// RideRash — cross traffic at the crossroads.
//
// A crossroads (lanes.js) is where cars come ACROSS the race, left to right
// and right to left, and Road Rash made you thread them at full speed. They do
// not stop and they do not see you: the rider judges the gap.
//
// FAIRNESS. Cross traffic only runs while a rider is within reach of the
// crossing, it is spaced (never a wall of cars), and each car is visible on the
// cross road well before it reaches the carriageway -- the crossing sign 200 m
// out and the cars rolling in from 180 m either side are the warning. A car on
// the crossing only blocks the lanes it is actually over.
//
// Vehicles come from the same builders as the rest of the traffic (traffic.js
// VEHICLES, baked to one mesh each), so they read as the same world.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';
import { crossings, edgeAt } from './lanes.js';
import { VEHICLES, bakeVehicle } from './traffic.js';

export const CROSS = {
  POOL: 6,              // cars shared by every crossing (only the near ones run)
  RANGE: 700,           // m: a crossing runs its traffic while a rider is this close
  SPAWN: 185,           // m out on the cross road where a car appears
  SPEED: [11, 17],      // m/s
  GAP: [3.2, 6.5],      // s between cars in one direction
  LANE: 2.4,            // m either side of the crossing's centre line (by direction)
  PAD_S: 0.9, PAD_L: 0.35,   // rider pads, as traffic.js
};

const TYPES = ['sedan', 'sedan', 'pickup', 'van', 'sedan', 'boxTruck'];

export class CrossTraffic {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'crosstraffic';
    scene.add(this.group);
    this.cars = [];
    for (let i = 0; i < CROSS.POOL; i++) {
      const type = TYPES[i % TYPES.length], spec = VEHICLES[type];
      const src = spec.gen(THREE, { paint: spec.paints[(i * 3) % spec.paints.length], seed: 900 + i * 71 });
      const mesh = bakeVehicle(src, 500 + i * 13);
      const car = new THREE.Group();
      car.add(mesh);
      car.visible = false;
      const bb = mesh.geometry.boundingBox;
      car.userData = { type, halfW: spec.halfW, halfL: (bb.max.z - bb.min.z) / 2, active: false, cs: 0, x: 0, dir: 1, v: 0 };
      this.group.add(car);
      this.cars.push(car);
    }
    this.timers = new Map();      // `${cs}:${dir}` -> seconds to the next car
  }

  reset() {
    for (const c of this.cars) { c.userData.active = false; c.visible = false; }
    this.timers.clear();
  }

  /** `riderS` is a list of rider distances (the player first). */
  update(dt, riderS) {
    const near = crossings().filter((cs) => riderS.some((s) => Math.abs(s - cs) < CROSS.RANGE));
    // spawn: per crossing and direction, on a spaced timer
    for (const cs of near) for (const dir of [-1, 1]) {
      const k = cs + ':' + dir;
      let t = this.timers.has(k) ? this.timers.get(k) : Math.random() * 2;
      t -= dt;
      if (t <= 0) {
        const car = this.cars.find((c) => !c.userData.active);
        if (car) {
          const u = car.userData;
          u.active = true; u.cs = cs; u.dir = dir; u.x = -dir * CROSS.SPAWN;
          u.v = CROSS.SPEED[0] + Math.random() * (CROSS.SPEED[1] - CROSS.SPEED[0]);
          car.visible = true;
        }
        t = CROSS.GAP[0] + Math.random() * (CROSS.GAP[1] - CROSS.GAP[0]);
      }
      this.timers.set(k, t);
    }
    // move and place
    const c = new THREE.Vector3(), tg = new THREE.Vector3();
    for (const car of this.cars) {
      const u = car.userData;
      if (!u.active) continue;
      u.prevX = u.x;
      u.x += u.dir * u.v * dt;
      if (Math.abs(u.x) > CROSS.SPAWN + 5 || !near.includes(u.cs)) { u.active = false; car.visible = false; continue; }
      // drive on the right of the cross road: +dir traffic on one side of its centre line
      u.sOff = -u.dir * CROSS.LANE;
      centreAt(-(u.cs + u.sOff), c); centreTangent(-(u.cs + u.sOff), tg);
      const nx = tg.z, nz = -tg.x;         // + lateral = the rider's right (traffic.js)
      car.position.set(c.x + nx * u.x, c.y, c.z + nz * u.x);
      // facing along the cross road, the way it is going
      // (vehicle models face their local -Z: see traffic.js, where an oncoming
      // car -- travelling -tangent -- is yawed to the tangent itself)
      car.rotation.set(0, Math.atan2(nx * u.dir, nz * u.dir) + Math.PI, 0);
    }
  }

  /**
   * A rider (BikePhys) against the crossing cars. Returns null or
   * { car, closing } -- a T-bone: the rider hit a car's flank, or a car hit
   * the rider's. The caller decides the wipeout.
   */
  contact(p) {
    for (const car of this.cars) {
      const u = car.userData;
      if (!u.active) continue;
      // in the road frame the car is long across the road, narrow along it
      const S = u.halfW + CROSS.PAD_S, L = u.halfL + CROSS.PAD_L;
      const ds = p.s - (u.cs + u.sOff);
      if (Math.abs(ds) > S) continue;
      const x0 = Math.min(u.x, u.prevX ?? u.x) - L, x1 = Math.max(u.x, u.prevX ?? u.x) + L;
      if (p.lateral < x0 || p.lateral > x1) continue;
      return { car, closing: Math.hypot(p.speed || 0, u.v) };
    }
    return null;
  }

  /** Cars over the carriageway right now, for the AI: [{s, lat0, lat1}]. */
  blockers() {
    const out = [];
    for (const car of this.cars) {
      const u = car.userData;
      if (!u.active) continue;
      const eR = edgeAt(u.cs, 1), eL = edgeAt(u.cs, -1);
      if (u.x + u.halfL < -eL - 2 || u.x - u.halfL > eR + 2) continue;
      out.push({ s: u.cs + u.sOff, lat0: u.x - u.halfL, lat1: u.x + u.halfL, vx: u.dir * u.v });
    }
    return out;
  }
}
