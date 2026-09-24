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
// THE AMBUSH (rewritten). The cop used to materialise 100 m behind you and sit
// on your shoulder until he got bored; he never touched you and you could not
// touch him. Now he is an NPC with a place in the world:
//
//   PARKED  -- he waits on the verge somewhere ahead, lights dark. You can see
//              him coming down the road, like a speed trap.
//   CHASE   -- you ride past and he pulls out: lights, siren, a faster machine
//              (BikePhys.setMachine), closing on you through the traffic.
//   TAKEDOWN-- alongside, he FIGHTS: he is a real combat Fighter, so his
//              punches and kicks go through the same code as the pack's, and a
//              knockdown with him in reach is a bust. You can hit him back.
//   DOWN    -- knock him off and he is thrown (the same ragdoll dismount as
//              every rider), and gives up the chase.
//
// Movement: his speed is steered each frame toward where he wants to be, with a
// real acceleration limit, and BikePhys integrates heading, lean and placement,
// so he banks through corners exactly like a rider.
import * as THREE from 'three';
import { BikePhys } from './physics.js';
import { CFG } from './config.js';
import { trafficNear } from './traffic.js';
import { trafficEscape } from './trafficavoid.js';
import { cloneWithJoints } from './rigclone.js';
import { paintBike } from './kit.js';
import { mergeJoints } from '../assetlib.js';
import { clearAxes, poseSeated, poseCombat, solveSeat } from './riderpose.js';
import { Fighter, ATTACKS } from './combat.js';
import { Dismount } from './dismount.js';

const MERGE_OPTS = { vertexColors: true, allNodes: true, keepColour: (h) => h === 0x1b1b1e };

// Tuning. Seconds and metres; all per-race, reset in reset().
export const COPS = {
  FIRST_DELAY: [6, 14],      // s after the flag before the first cop takes up a spot
  GAP_BY_LEVEL: [55, 45, 36, 30, 24],   // s between cops, level 1..5 (fewer early, as in the original)
  PARK_AHEAD: [520, 820],    // m ahead of the player he parks: far enough to see him coming
  PARK_OFF: 0.3,             // m beyond the tarmac edge: on the shoulder. 1.7 m past the kerb
                             // put him behind the verge fence, invisible (MEASURED in a screenshot)
  POWER: 1.75,               // machine power (top speed ~ sqrt(power) x the RAT's): he is faster
  ACCEL: 7.5,                // m/s^2 he can gain; the pull-out is a launch, not a teleport
  CHASE_FOR: 45,             // s of pursuit before he gives up and pulls off
  CLOSE_RATE: 11,            // m/s faster than the player while closing
  SIDE: 1.45,                // m: rides this far to the side of you once alongside
  STATION_GAP: 1.3,          // m he sits behind your centre, so you are in his swing
  REACH_S: 2.4,              // m along the road he swings from
  // s between swings once alongside. [1.1, 2.0] with the nightstick every time
  // won a straight fist-fight against the player in 4 s (MEASURED): a rider who
  // fights back must be able to win it.
  SWING_EVERY: [1.8, 3.0],
  HP: 80,
  BUST_RADIUS: 28,           // m: wreck inside this and you are nicked
  LOSE_DIST: 320,            // m: out-run him by this much and he is gone
  // Of the event purse, by level. 0.35 flat was MEASURED to end a fresh career
  // on its first bust: $350 in the bank, a $420 fine. The original's fines were
  // payable early and ruinous late, and that is the curve.
  FINE_BY_LEVEL: [0.15, 0.22, 0.28, 0.32, 0.35],
};

const PAINT = 0xe9ecef, DARK = 0x16181c, NAVY = 0x1d2a4a;

export class Cop {
  constructor(scene, assets) {
    this.scene = scene;
    // AI assists on (arcade: false): he steers himself, like the pack.
    this.phys = new BikePhys({ startS: -1000, lateral: 0, speed: 0, arcade: false });
    this.phys.setMachine({ power: COPS.POWER, grip: 1.15 });
    this.group = new THREE.Group();
    this.group.visible = false;
    this.name = 'POLICE';
    this.color = 0x3d7bff;               // radar dot; blinks, see update()
    // A REAL FIGHTER: his swings resolve through combat.js like anyone's, and
    // the player's resolve against him. Joined to world.fighters only while he
    // is chasing (see main.js), so nobody punches a parked cop.
    this.fighter = new Fighter(this.phys, { hp: COPS.HP, hasWeapon: true });

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
      const socket = this.socket = new THREE.Object3D();
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
    // He can be thrown off like anyone -- the same dismount machine as the pack,
    // used only for the fall (he gives up once he is on the ground).
    this.dismount = (this.rider && this.bike) ? new Dismount(this, { auto: true }) : null;
    this.reset(1);
  }

  /** Per race. `level` 1..5 sets how often he comes. */
  reset(level = 1, enabled = true) {
    this.level = Math.max(1, Math.min(5, level | 0));
    this.enabled = !!enabled;
    if (this.dismount) this.dismount.reset();
    this.state = 'off';
    this.active = false;              // chasing (siren, flag, radar): main.js reads this
    this.busted = false;
    this.chaseT = 0;
    this.t = 0;
    this.swingT = 0;
    this.downT = 0;
    const [a, b] = COPS.FIRST_DELAY;
    this.nextAt = a + Math.random() * (b - a);
    this.group.visible = false;
    this.phys.reset({ s: -1000, lateral: 0, speed: 0 });
    const f = this.fighter;
    f.down = false; f.downTimer = 0; f.hp = f.maxHp; f.active = null; f.invuln = 0;
    f.stamina = CFG.STAMINA_MAX;
    f.hasWeapon = true;           // a nightstick; the player can take it off him, like a chain
  }

  get pos() { return this.phys.pos; }
  get s() { return this.phys.s; }
  /** In the world at all (parked or chasing), for anything that draws him. */
  get present() { return this.state === 'parked' || this.state === 'chase' || this.state === 'down'; }

  // Take up a spot on the verge ahead of the player, facing down the road.
  _park(player, finishS) {
    const pp = player.phys;
    const [a, b] = COPS.PARK_AHEAD;
    const s = pp.s + a + Math.random() * (b - a);
    // Not past (or just before) the finish: there is no chase left to have.
    if (Number.isFinite(finishS) && s > finishS - 300) { this.nextAt = Infinity; return; }
    const side = Math.random() < 0.5 ? -1 : 1;
    const lat = side * (CFG.ROAD_W / 2 + COPS.PARK_OFF);
    // Angled in toward the road, the way a speed trap waits (yawOffset is +
    // toward +lateral, so a cop on the + verge turns toward -).
    this.phys.reset({ s, lateral: lat, speed: 0, yawOffset: -side * 0.35 });
    this.phys.sync();
    this.parkSide = side;
    this.state = 'parked';
    this.group.visible = true;
    this._visual(0);
  }

  _startChase() {
    this.state = 'chase';
    this.active = true;
    this.chaseT = 0;
    this.swingT = COPS.SWING_EVERY[0];
    this.onSpawn && this.onSpawn();
  }

  _leave() {
    this.state = 'off';
    this.active = false;
    this.group.visible = false;
    if (this.dismount) this.dismount.reset();
    const f = this.fighter;
    f.down = false; f.hp = f.maxHp; f.active = null;
    this.phys.reset({ s: -1000, lateral: 0, speed: 0 });
    this.nextAt = this.t + COPS.GAP_BY_LEVEL[this.level - 1] * (0.8 + Math.random() * 0.4);
  }

  /**
   * One frame. `player` is read only. Returns 'busted' on the frame a bust
   * happens, 'arrived' when he pulls out after you, 'gone' when he gives up,
   * 'down' when you knock him off, else null.
   */
  update(dt, player, racing, traffic = null, hooks = {}, finishS = Infinity) {
    this.t += dt;
    if (!racing || !this.enabled) return null;
    const pp = player.phys, p = this.phys;

    if (this.state === 'off') {
      if (this.t >= this.nextAt) this._park(player, finishS);
      return null;
    }

    // THE BUST. Road Rash's rule, exactly: crash anywhere near a cop and you are
    // nicked -- parked or chasing. Not being caught: WRECKING while he is there.
    const gap = pp.s - p.s;                       // > 0: the player is ahead of him
    const dist = Math.hypot(gap, pp.lateral - p.lateral);
    if (player.fighter.down && dist < COPS.BUST_RADIUS && this.state !== 'down' && !this.busted) {
      this.busted = true;
      return 'busted';
    }

    if (this.state === 'parked') {
      // Waiting. He goes the moment you are past him (or if you somehow slipped
      // by far ahead without his noticing -- he has a radio).
      if (gap > 3) { this._startChase(); return 'arrived'; }
      if (gap < -1500) { this._leave(); return null; }       // you are nowhere near: re-park later
      this._visual(dt);
      return null;
    }

    if (this.state === 'down') {
      // Thrown off: the dismount machine runs his fall. Once he is lying still
      // the chase is over.
      this.downT += dt;
      if (this.dismount) {
        this.dismount.update(dt, null);
        if (this.dismount.onFoot) this.dismount.render(dt);
        if (this.dismount.state === 'STANDING' || this.dismount.state === 'WALKING' || this.downT > 5) {
          this._leave(); return 'gone';
        }
      } else if (this.downT > 2) { this._leave(); return 'gone'; }
      return null;
    }

    // ---- CHASE -------------------------------------------------------------
    this.chaseT += dt;
    const f = this.fighter;
    if (f.down) {                                  // the player (or a rival) knocked him off
      this.state = 'down';
      this.active = false;
      this.downT = 0;
      if (this.dismount) this.dismount.beginFall({ side: Math.sign(p.lateralV || 0) || 1 });
      return 'down';
    }
    if (this.chaseT > COPS.CHASE_FOR || gap > COPS.LOSE_DIST) { this._leave(); return 'gone'; }

    // Pace: close fast, then hold station ALONGSIDE (gap ~0), where he can reach.
    // The closing speed is proportional to the gap, so he arrives MATCHING your
    // speed instead of flying past: at 58 m/s with a fixed closing rate he
    // overshot by 12 m and took 8 s to drop back (MEASURED).
    // He holds station a little BEHIND your centre (STATION_GAP): a swing only
    // lands inside the attacker's forward arc, and sitting level he drifted 0.7 m
    // ahead of you and missed 15 swings out of 17 (MEASURED).
    const want = pp.speed + THREE.MathUtils.clamp((gap - COPS.STATION_GAP) * 0.7, -8, COPS.CLOSE_RATE);
    const dv = THREE.MathUtils.clamp(Math.max(0, want) - p.speed, -9 * dt, COPS.ACCEL * dt);
    p.speed = Math.min(p.topSpeed * 1.02, Math.max(0, p.speed + dv));
    const needPower = want > p.speed + 0.3;

    // Line: off the verge onto the road, into your slipstream while closing, then
    // beside you on the side with more room.
    const lim = CFG.ROAD_W / 2 - 1.0;
    if (Math.abs(gap) < 18 && !this.sideLock) this.sideLock = pp.lateral > 0 ? -1 : 1;
    if (Math.abs(gap) > 30) this.sideLock = 0;
    let tLat = Math.abs(gap) < 18 ? pp.lateral + (this.sideLock || 1) * COPS.SIDE : pp.lateral;
    tLat = Math.max(-lim, Math.min(lim, tLat));
    // TRAFFIC. A trained rider's 2.8 s look: swerve to the nearer clear flank,
    // and if boxed in, drop to the vehicle's speed.
    if (traffic) {
      // He uses the whole road (a cop on a call rides the oncoming lane), and he
      // brakes only for a REAL overlap. The shared helper brakes whenever the
      // escape line cannot be reached in time, inside a threat band 0.8 m wider
      // than the car -- MEASURED, that held him at the car's speed + 2 (29 m/s)
      // for eight seconds while he sat clear of its flank.
      const wide = CFG.ROAD_W / 2 - 0.6;
      const esc = trafficEscape(trafficNear(traffic, p.s, 5, 110), p.s, p.lateral, p.speed, 2.8, wide, 0.7, 2.2);
      if (esc) {
        tLat = esc.target;
        const c = esc.car;
        const overlap = c && Math.abs(c.at - p.lateral) < c.halfW + 0.55;
        if (esc.brake && overlap && esc.ttc < 1.2) p.speed = Math.min(p.speed, Math.max(0, esc.vs) + 2);
      }
    }
    // Firmer steering than the pack: a pursuit rider.
    const steer = Math.max(-1, Math.min(1, (tLat - p.lateral) * 0.6 - (p.lateralV || 0) * 0.2));
    p.advance(dt, { throttle: needPower, brake: false, steer, tuck: false });

    // THE TAKEDOWN. Alongside and in reach: he swings, on a rhythm with a little
    // randomness so it cannot be timed. The fighter decides whether it lands.
    this.swingT -= dt;
    const alongside = Math.abs(gap) < COPS.REACH_S && Math.abs(pp.lateral - p.lateral) < 2.4;
    if (alongside && this.swingT <= 0 && !f.busy && !player.fighter.down) {
      // The nightstick when it is ready (the weapon swing: wider arc, hits hard),
      // fists and boots in between.
      const kind = (f.can('chain') && Math.random() < 0.35) ? 'chain' : (Math.random() < 0.55 ? 'punch' : 'kick');
      if (f.commit(kind)) {
        const [a, b] = COPS.SWING_EVERY;
        this.swingT = a + Math.random() * (b - a);
      }
    }
    f.update(dt, [player.fighter], hooks);
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
    // Parked: a slow blink, so you see him waiting from down the road (a dark
    // bike on the verge was invisible at 60 m in the screenshots). Chasing: the
    // full ~3 Hz strobe, and the radar dot with it.
    const chasing = this.state === 'chase';
    const on = Math.floor(this.t * 6) % 2 === 0;
    const idle = this.state === 'parked' && (this.t % 1.6) < 0.25;
    if (this.lampR) {
      this.lampR.visible = (chasing && on) || idle; this.lampB.visible = (chasing && !on) || idle;
      // Bigger while parked: at race distance a motorcycle is a few pixels, and
      // the light bar (unlit, un-tonemapped, so it blooms) is what you spot.
      const k = this.state === 'parked' ? 2.6 : 1;
      this.lampR.scale.setScalar(k); this.lampB.scale.setScalar(k);
    }
    this.color = on ? 0xff2a2a : 0x2a6bff;
    const j = this.rider && this.rider.userData.joints;
    if (j) {
      clearAxes(j);
      poseSeated(j, Math.min(1, p.speed / 45));
      if (chasing) poseCombat(j, this.fighter, p, this.t, ATTACKS);
    }
  }

  /** The fine for a bust at this event. */
  static fine(event) {
    const k = COPS.FINE_BY_LEVEL[Math.max(1, Math.min(5, event.level || 1)) - 1];
    return Math.round((event.purse || 1200) * k);
  }
}
