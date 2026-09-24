// RideRash — cars parked at the kerb in town.
//
// Road Rash's towns had cars parked along the edge of the road: a rider
// running wide, or knocked there in a fight, meets a stationary car. They sit
// in the outermost strip of the tarmac (the shoulder, clear of the lanes),
// singly or in short rows, only in town sectors, never at a crossroads,
// the start or the finish.
//
// Same vehicle builders as the traffic (baked to one mesh each), instanced by
// cloning a few prototypes -- a row of parked cars is the cheapest dressing
// in the game.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';
import { edgeAt, crossingNear } from './lanes.js';
import { VEHICLES, bakeVehicle } from './traffic.js';

const TYPES = ['sedan', 'sedan', 'pickup', 'van', 'sedan'];
const TOWN = new Set(['town', 'night']);

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export class Parked {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'parked';
    scene.add(this.group);
    // prototypes: a few paints per type
    this.protos = [];
    let k = 0;
    for (const type of TYPES) {
      const spec = VEHICLES[type];
      for (let v = 0; v < 2; v++) {
        const src = spec.gen(THREE, { paint: spec.paints[(k * 3 + v) % spec.paints.length], seed: 3000 + k * 97 + v });
        const mesh = bakeVehicle(src, 700 + k * 7 + v);
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        this.protos.push({ mesh, halfW: spec.halfW, halfL: (bb.max.z - bb.min.z) / 2 });
      }
      k++;
    }
    this.cars = [];
  }

  /** Line the town kerbs of this course (call per race, after lanes.setLanePlan). */
  build(spine, finishS) {
    for (const c of this.cars) this.group.remove(c.obj);
    this.cars = [];
    const r = prng(0x9a4c ^ (spine.mapId || '').length * 7919);
    const c = new THREE.Vector3(), t = new THREE.Vector3();
    for (let s = 200; s < finishS - 150; s += 30 + r() * 70) {
      const biome = spine.bounds[spine.sectorAt(s)].biome;
      if (!TOWN.has(biome) || crossingNear(s, 45)) continue;
      const side = r() < 0.6 ? 1 : -1;
      const n = 1 + Math.floor(r() * 3);                   // a short row
      for (let i = 0; i < n; i++) {
        const P = this.protos[Math.floor(r() * this.protos.length)];
        const sc = s + i * (P.halfL * 2 + 1.4);
        if (crossingNear(sc, 45)) break;
        const lat = side * (edgeAt(sc, side) - P.halfW - 0.15);   // tucked against the kerb
        const obj = P.mesh.clone();
        centreAt(-sc, c); centreTangent(-sc, t);
        const nx = t.z, nz = -t.x;                         // + lateral = the rider's right
        obj.position.set(c.x + nx * lat, c.y, c.z + nz * lat);
        // parked facing the way traffic on that side drives (models face -Z)
        obj.rotation.y = Math.atan2(t.x, t.z) + (side > 0 ? Math.PI : 0);
        obj.castShadow = true; obj.receiveShadow = true;
        this.group.add(obj);
        this.cars.push({ obj, s: sc, lat, halfW: P.halfW, halfL: P.halfL });
      }
      s += n * 6;
    }
    return this.cars.length;
  }

  /** As road obstacles for the AI's look (traffic.setTrafficExtras). */
  obstacles(s, back, fwd) {
    const out = [];
    for (const k of this.cars) {
      const d = k.s - s;
      if (d < -back - k.halfL || d > fwd + k.halfL) continue;
      out.push({ s: k.s, at: k.lat, halfL: k.halfL, halfW: k.halfW, vs: 0 });
    }
    return out;
  }

  /**
   * Keep a rider (BikePhys) out of the parked cars: a solid box. Returns the
   * closing speed of a fresh hit (0 if none) so the caller can decide a wipeout.
   */
  collide(p) {
    for (const k of this.cars) {
      const ds = p.s - k.s, dl = p.lateral - k.lat;
      const L = k.halfL + 0.9, W = k.halfW + 0.35;
      if (Math.abs(ds) > L || Math.abs(dl) > W) continue;
      // push out along the shallower axis
      const penS = L - Math.abs(ds), penL = W - Math.abs(dl);
      if (penL < penS) {
        p.lateral = k.lat + Math.sign(dl || 1) * W;
        const v = Math.abs(p.lateralV || 0);
        p.lateralV = Math.sign(dl || 1) * Math.max(0.5, v * 0.3);
        p.speed *= 0.9;
        return v;
      }
      // hit its end: stopped dead
      p.s = k.s + Math.sign(ds || -1) * L;
      const v = p.speed || 0;
      p.speed *= 0.1;
      return v;
    }
    return 0;
  }
}
