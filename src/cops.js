// RideRash — the police.
//
// Road Rash's third pillar after racing and fighting: a cop rides into the pack,
// runs you down, and if you WRECK within his reach you are BUSTED -- the race is
// over, you do not qualify, and the fine comes out of the bank. It is the one
// threat in the game that punishes crashing rather than losing, and it is why a
// player with a cop on his tail stops brawling and starts riding.
//
// `npc.js` has had a 'cop' persona since the brain was written, but nothing ever
// spawned one. This module is deliberately SELF-CONTAINED: the cop is not a
// fighter and not in the standings, so it cannot perturb the race logic, the
// pack AI or the combat tables. It only reads the player and writes nothing but
// its own model and one `busted` flag the race loop checks.
//
// Movement is KINEMATIC ON THE REAL ROAD: the cop's speed is set each frame (a
// police bike is simply faster than yours; there is no per-bike power in
// BikePhys to express that), and BikePhys still integrates heading, lean, wheel
// spin and road placement, so he banks through corners exactly like a rider.
import * as THREE from 'three';
import { BikePhys } from './physics.js';
import { CFG } from './config.js';
import { trafficNear } from './traffic.js';
import { trafficEscape } from './trafficavoid.js';
import { cloneWithJoints } from './rigclone.js';
import { paintBike } from './kit.js';
import { mergeJoints } from '../assetlib.js';
import { clearAxes, poseSeated, solveSeat } from './riderpose.js';

const MERGE_OPTS = { vertexColors: true, allNodes: true, keepColour: (h) => h === 0x1b1b1e };

// Tuning. Seconds and metres; all per-race, reset in reset().
export const COPS = {
  FIRST_DELAY: [22, 38],     // s after the flag before the first cop can appear
  GAP_BY_LEVEL: [70, 55, 45, 36, 28],   // s between cops, level 1..5 (fewer early, as in the original)
  SPAWN_BEHIND: 100,         // m behind the player -- he arrives, siren first
  CHASE_FOR: 32,             // s of pursuit before he gives up and pulls off
  CLOSE_RATE: 9,             // m/s faster than the player while closing
  SHADOW_GAP: 4,             // m: once alongside, he sits here and waits for you to fall
  BUST_RADIUS: 28,           // m: wreck inside this and you are nicked
  LOSE_DIST: 260,            // m: out-run him by this much and he is gone
  // Of the event purse, by level. 0.35 flat was MEASURED to end a fresh career
  // on its first bust: $350 in the bank, a $420 fine. The original's fines were
  // payable early and ruinous late, and that is the curve.
  FINE_BY_LEVEL: [0.15, 0.22, 0.28, 0.32, 0.35],
};

const PAINT = 0xe9ecef, DARK = 0x16181c, NAVY = 0x1d2a4a;

export class Cop {
  constructor(scene, assets) {
    this.scene = scene;
    this.phys = new BikePhys({ startS: -1000, lateral: 0, speed: 0, arcade: true });
    this.group = new THREE.Group();
    this.group.visible = false;
    this.name = 'POLICE';
    this.color = 0x3d7bff;               // radar dot; blinks, see update()
    this.fighter = { down: false };      // the radar reads this shape

    if (assets.bike) {
      this.bike = cloneWithJoints(assets.bike);
      // Police livery: white bodywork, black trim. Recoloured BEFORE the merge,
      // which bakes colour into vertices (see rivals.js).
      // Livery by the bike's own paint tags (src/kit.js paintBike): white body, black
      // accent. The saturation rule below is the fallback for an untagged bike -- it
      // also caught the copper headers and turned them white.
      if (!paintBike(this.bike, PAINT, DARK)) this.bike.traverse((n) => {
        if (!n.isMesh || !n.material || Array.isArray(n.material) || !n.material.color) return;
        // BY SATURATION, NOT BY NAME. The bodywork paint is a clearcoat named
        // 'metal', exactly like the chrome, so a name test left the police bike
        // in the rat's red (measured). Chrome, steel and rubber are all near-grey;
        // paint is the only saturated colour on the machine.
        const hsl = n.material.color.getHSL({});
        if (hsl.s < 0.25) return;
        n.material = n.material.clone();
        n.material.color.setHex(hsl.l > 0.18 ? PAINT : DARK);
      });
      try { mergeJoints(this.bike, MERGE_OPTS); } catch (e) { /* unmerged is fine */ }
      this.group.add(this.bike);

      // The light bar: two emissive blocks above the tail, alternated in update().
      // MeshBasic so no light is added (a new light recompiles every lit shader).
      // Up on a mast behind the rider's back, where the camera can see it: at
      // y 1.22 it sat level with his hips and was hidden in the chase view.
      const geo = new THREE.BoxGeometry(0.22, 0.12, 0.10);
      this.lampR = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }));
      this.lampB = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2a6bff, toneMapped: false }));
      this.lampR.position.set(-0.14, 1.62, -0.92);
      this.lampB.position.set(0.14, 1.62, -0.92);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.62, 6),
        new THREE.MeshStandardMaterial({ color: 0x2b3238, metalness: 0.6, roughness: 0.4 }));
      mast.position.set(0, 1.28, -0.92);
      this.bike.add(mast);
      this.bike.add(this.lampR, this.lampB);
    }

    if (assets.rider && this.bike) {
      this.rider = cloneWithJoints(assets.rider);
      this.rider.traverse((n) => {
        if (!n.isMesh || !n.material || Array.isArray(n.material) || !n.material.color) return;
        const hex = n.material.color.getHex();
        if (hex === 0x2a2624) { n.material = n.material.clone(); n.material.color.setHex(NAVY); }
        if (hex === 0x3b4a63) { n.material = n.material.clone(); n.material.color.setHex(DARK); }
      });
      // Same mount socket as every rider: see player.js.
      const spec = this.rider.userData && this.rider.userData.spec;
      const socket = new THREE.Object3D();
      socket.position.set(CFG.SEAT_X, CFG.SEAT_Y - (spec ? spec.seatContactY : 0) + ((spec && spec.seatBob) || 0), CFG.SEAT_Z);
      this.bike.add(socket);
      socket.add(this.rider);
      try { mergeJoints(this.rider, MERGE_OPTS); } catch (e) { /* unmerged is fine */ }
      // Hands to the grips and KNEES FORWARD by IK, like every other rider --
      // without this the cop fell back to the bare angle table.
      try { solveSeat(this.rider, this.bike); } catch (e) { /* table fallback */ }
    }
    this.group.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = true; } });
    scene.add(this.group);
    this.reset(1);
  }

  /** Per race. `level` 1..5 sets how often he comes. */
  reset(level = 1, enabled = true) {
    this.level = Math.max(1, Math.min(5, level | 0));
    this.enabled = !!enabled;
    this.active = false;
    this.busted = false;
    this.chaseT = 0;
    this.t = 0;
    const [a, b] = COPS.FIRST_DELAY;
    this.nextAt = a + Math.random() * (b - a);
    this.group.visible = false;
    this.phys.reset({ s: -1000, lateral: 0, speed: 0 });
  }

  get pos() { return this.phys.pos; }
  get s() { return this.phys.s; }

  _spawn(player) {
    const pp = player.phys;
    if (pp.s < COPS.SPAWN_BEHIND + 50) { this.nextAt = this.t + 5; return; }
    this.phys.reset({ s: pp.s - COPS.SPAWN_BEHIND, lateral: pp.lateral * 0.5, speed: pp.speed + COPS.CLOSE_RATE });
    this.active = true;
    this.chaseT = 0;
    this.group.visible = true;
    this.onSpawn && this.onSpawn();
  }

  _leave() {
    this.active = false;
    this.group.visible = false;
    this.nextAt = this.t + COPS.GAP_BY_LEVEL[this.level - 1] * (0.8 + Math.random() * 0.4);
  }

  /**
   * One frame. `player` is read only. Returns 'busted' on the frame a bust
   * happens, 'arrived' when a cop appears, else null.
   */
  update(dt, player, racing, traffic = null) {
    this.t += dt;
    if (!racing || !this.enabled) return null;
    if (!this.active) {
      if (this.t >= this.nextAt) { this._spawn(player); return this.active ? 'arrived' : null; }
      return null;
    }

    const pp = player.phys, p = this.phys;
    this.chaseT += dt;
    const gap = pp.s - p.s;                       // > 0: the player is ahead of him

    // THE BUST. Road Rash's rule, exactly: crash anywhere near a cop and you are
    // nicked. Not being caught -- WRECKING while he is there.
    const dist = Math.hypot(gap, pp.lateral - p.lateral);
    if (player.fighter.down && dist < COPS.BUST_RADIUS && !this.busted) {
      this.busted = true;
      return 'busted';
    }

    if (this.chaseT > COPS.CHASE_FOR || gap > COPS.LOSE_DIST) { this._leave(); return 'gone'; }

    // Pace: close fast, then shadow the player a few metres back and to one side.
    const want = gap > COPS.SHADOW_GAP + 6 ? pp.speed + COPS.CLOSE_RATE
      : gap < COPS.SHADOW_GAP - 2 ? pp.speed - 4
      : pp.speed + (gap - COPS.SHADOW_GAP) * 0.8;
    p.speed += (Math.max(0, want) - p.speed) * Math.min(1, dt * 2.5);

    // Line: tuck in beside the player's rear wheel, never on top of him.
    const side = pp.lateral > 0 ? -1.6 : 1.6;
    const lim = CFG.ROAD_W / 2 - 1.2;
    const targetLat = Math.max(-lim, Math.min(lim, gap < 15 ? pp.lateral + side : pp.lateral));
    let tLat = targetLat;
    // TRAFFIC. The cop rides the same road and used to ride straight through
    // every vehicle on it. He is kinematic (not in main.js's contact pass), so
    // avoidance is the whole of it: a trained rider's 2.8 s look, swerve to the
    // nearer clear flank, and if boxed in, drop to the vehicle's speed.
    if (traffic) {
      const esc = trafficEscape(trafficNear(traffic, p.s, 5, 110), p.s, p.lateral, p.speed, 2.8, lim);
      if (esc) {
        tLat = esc.target;
        if (esc.brake) p.speed = Math.min(p.speed, Math.max(0, esc.vs) + 2);
      }
    }
    const steer = Math.max(-1, Math.min(1, (tLat - p.lateral) * 0.35 - (p.lateralV || 0) * 0.15));
    p.advance(dt, { throttle: true, brake: false, steer, tuck: false });
    this._visual(dt);
    return null;
  }

  _visual(dt) {
    const p = this.phys;
    this.group.position.copy(p.pos);
    this.group.rotation.set(p.roadPitch || 0, p.yaw, 0, 'YXZ');
    if (this.bike) {
      this.bike.rotation.z = p.lean * 0.92;       // + is right: see rivals.js
      const j = this.bike.userData.joints;
      if (j) {
        if (j.frontSteer) j.frontSteer.rotation.y = p.steerAngle || 0;
        if (j.frontWheel) j.frontWheel.rotation.x = p.wheelSpin;
        if (j.rearWheel) j.rearWheel.rotation.x = p.wheelSpin;
      }
    }
    // Alternate the lamps at ~3 Hz, and the radar dot with them.
    const on = Math.floor(this.t * 6) % 2 === 0;
    if (this.lampR) { this.lampR.visible = on; this.lampB.visible = !on; }
    this.color = on ? 0xff2a2a : 0x2a6bff;
    const j = this.rider && this.rider.userData.joints;
    if (j) { clearAxes(j); poseSeated(j, Math.min(1, p.speed / 45)); }
  }

  /** The fine for a bust at this event. */
  static fine(event) {
    const k = COPS.FINE_BY_LEVEL[Math.max(1, Math.min(5, event.level || 1)) - 1];
    return Math.round((event.purse || 1200) * k);
  }
}
