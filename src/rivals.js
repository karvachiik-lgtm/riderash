// RideRash — rival riders. Each is a bike + rider pair with a fighter and a
// behaviour machine that races, hunts, attacks, evades and recovers.
//
// THE AI LIVES IN npc.js NOW. This file builds the VISUAL, owns the physics
// instance and owns the FIGHTER, and applies the control intent the brain
// returns. It never decides anything itself. The split is the point: the same
// engine drives cops, and the brain cannot reach the physics because it only
// returns {steer, throttle, brake, attack, tuck}.
//
// The intent is applied in `update()` and ONLY by `update()`. There is exactly
// one place in this file where a control is written to BikePhys, and it is
// marked INTENT -> PHYSICS below.
import { trafficNear } from './traffic.js';
import { trafficEscape } from './trafficavoid.js';
import * as THREE from 'three';
import { BikePhys } from './physics.js';
import { Fighter, ATTACKS } from './combat.js';
import { edgeAt, halfAt } from './lanes.js';
import { CFG, RIVAL_COLORS, RIVAL_NAMES } from './config.js';
import { cloneWithJoints } from './rigclone.js';

import { mergeJoints } from '../assetlib.js';
// Colour into vertices; tyres/saddle keep their own material because main.js
// gives that colour a matte environment response by looking it up by hex.
const MERGE_OPTS = { vertexColors: true, allNodes: true, keepColour: (h) => h === 0x1b1b1e };
import { clearAxes, poseSeated, poseRideDynamics, poseCombat, solveSeat } from './riderpose.js';
import { NpcBrain } from './npc.js';
import { Dismount } from './dismount.js';

const _rivShift = new THREE.Vector3();
import { packKit, bikeSource, paintBike, dressRider } from './kit.js';
import { centreAt, headAt, roadProfile } from './level.js';
import { gridFor, ROSTER_SIZE } from './roster.js';

// The personas, in the order they are dealt to the pack when no roster entry is
// supplied. Roster entries carry their own temperament and are the normal path;
// this is only the fallback for a bare `new Rival(...)`.
const PERSONA_ROTATION = ['aggressive', 'clean', 'blocker', 'aggressive', 'clean'];

// Rival lane-keeping gains live in npc.js now; re-exported here so anything that
// imported them from rivals.js keeps working and there is still one value.
export { NPC } from './npc.js';

let nextId = 1;

export class Rival {
  constructor(scene, assets, index, opts = {}) {
    this.id = nextId++;
    this.index = index;

    // ---- IDENTITY COMES FROM THE ROSTER, NOT FROM ARITHMETIC -------------
    //
    // This used to be:
    //     this.name = RIVAL_NAMES[index % RIVAL_NAMES.length]
    //     const persona = PERSONA_ROTATION[index % PERSONA_ROTATION.length]
    //     this.skill = clamp(0.5 + ((index * 0.37) % 1) * SPREAD)
    //     hasWeapon: index % 3 === 2
    // i.e. who a rider WAS depended on a modulo. Adding a rival re-rolled
    // everybody; two riders could not share a temperament; and "VOSS carries a
    // club" was not a decision anyone made. Now `opts.entry` is an authored
    // roster record (src/roster.js) and everything below just reads it.
    //
    // The fallback keeps the harnesses and any caller that constructs a Rival
    // bare working: it builds a roster entry on the fly for the given slot.
    const e = opts.entry || gridFor({}, CFG.RIVAL_COUNT)[index % ROSTER_SIZE] || null;

    this.name = (e && e.name) || RIVAL_NAMES[index % RIVAL_NAMES.length];
    this.color = RIVAL_COLORS[index % RIVAL_COLORS.length];
    this.riderId = (e && e.id) || null;
    this.specialty = (e && e.specialty) || null;
    this.blurb = (e && e.blurb) || null;

    const persona = (e && e.persona) || opts.persona || PERSONA_ROTATION[index % PERSONA_ROTATION.length];
    this.personaName = persona;

    this.phys = new BikePhys({
      startS: opts.startS ?? 3 + index * 2.2,
      lateral: opts.lateral ?? (index - 2) * 1.7,
      speed: opts.speed ?? CFG.RIVAL_LAUNCH,
    });
    this.fighter = new Fighter(this.phys, {
      hp: CFG.RIVAL_HP,
      // Carrying a club is a CHARACTER TRAIT from the roster, not `index % 3`.
      // ROADRASH.md: some opponents wield clubs, and you take one by hitting
      // them mid-swing. Which opponents is an authored decision.
      hasWeapon: e ? !!e.hasWeapon : (index % 3 === 2),
    });

    // skill: how well this rider corners, when they attack, how they drift.
    // Authored per character and scaled by the event, so "SLATER is the fastest
    // rider in the field" survives from race one to race five.
    this.skill = e && Number.isFinite(e.skill)
      ? THREE.MathUtils.clamp(e.skill, 0, 1)
      : THREE.MathUtils.clamp(0.5 + ((index * 0.37) % 1) * CFG.RIVAL_SKILL_SPREAD, 0, 1);

    // THE BRAIN. It owns the FSM, the lane home and every random draw. Its seed
    // is the grid slot, so the same rider behaves identically run to run.
    this.brain = new NpcBrain({
      kind: 'rival',
      index,
      persona,
      seed: 0x1000 + index * 977,
      skill: this.skill,
      roadHalf: CFG.ROAD_W / 2,
      // ==== [npc-persona] same machine for everyone: preferred pace is capped
      // at the player's own terminal speed. See npc.js assignPace.
      maxSpeed: CFG.MAX_SPEED,
      // ==== [npc-persona] END
    });
    // ==== [npc-persona] BEGIN character bookkeeping (charcard.js reads these)
    this.entry = e || null;
    this._resetCharStats();
    // ==== [npc-persona] END

    // ABSOLUTE PACE, ASSIGNED FROM THE LEVEL. `paceRank` is where this rider sits
    // in the field by roster skill (0 slowest .. 1 fastest); `assignPace` turns
    // that and the level's reference speed into a fixed target speed the rider
    // holds all race. It is set here and re-set every race in applyEntry, and it
    // NEVER reads the player. See NpcBrain._paceIntent for the bug this fixes.
    this.paceRank = 0.5;
    this.fitMachine(opts.reference || CFG.RIVAL_REFERENCE_PACE);

    // laneHome is a NUMBER (§5.19). It is owned by the brain now; mirrored here
    // because other modules and the harness read `rival.laneHome`.
    this.laneHome = this.brain.laneHome;
    this.targetLateral = this.phys.lateral;
    this.decisionTimer = 0;
    this.aggroTimer = 0;
    this.wantsToAttack = null;

    // --- build the visual: bike + rider, coloured per rival ---
    // THE PACK IS MIXED. Each grid slot has an authored kit (src/kit.js): a bike class
    // (naked / sport / super / muscle -- all on one joint + contact contract), a second
    // livery colour, a helmet and optional torso gear. Before this every rival was the
    // hero bike and the base rider recoloured, and the pack read as six copies.
    this.kit = packKit(index);
    const bikeSrc = bikeSource(assets, this.kit.bike);
    const riderSrc = assets.npcRider || assets.rider;
    this.group = new THREE.Group();

    // cloneWithJoints, not a bare .clone() -- see the long note in player.js.
    // Every rival carried the same dead joint map, so no rival's wheels turned,
    // no rival's front end steered, and every rival bike leaned not at all.
    this.bike = bikeSrc ? cloneWithJoints(bikeSrc) : null;
    if (this.bike) {
      // BAKE THE BIKE'S ROOT TRANSFORM, exactly as player.js does.
      //
      // This was missing and it is the second half of the seating defect. The
      // source bike sits at (0.501, 0, 0.288) in its own file; `mergeByMaterial`
      // bakes each mesh's WORLD matrix into the geometry and hands back a group
      // at the identity, so a cloned-but-unbaked bike carries a half-metre
      // displacement of its own. The player was fixed in assetlib+player; every
      // rival kept the old offset, which is why the hero looked seated and the
      // pack did not.
      // mergeJoints, not bakeStatic -- see the long note in player.js. A merged
      // bike loses `userData.joints`, so every rival's wheels and steering head
      // were dead too. Merging only within the joints keeps them animatable.
      // recolour the bodywork. Materials are shared after clone, so clone the
      // ones we change, and only the painted ones, to keep draw calls down.
      // Livery by TAG (paintBike): the bike modules mark their paint `body`/`accent`.
      // The hex-exclusion rule below is kept only for an untagged (older) bike asset.
      if (!paintBike(this.bike, this.color, this.kit.accent)) {
        this.bike.traverse((n) => {
          if (!n.isMesh || !n.material) return;
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          for (let i = 0; i < mats.length; i++) {
            const m = mats[i];
            // the bodywork is whatever is not black/steel/tyre — recolour by
            // matching the asset's own paint colour family
            if (m.color && m.color.getHex() !== 0x1b1b1e && m.color.getHex() !== 0x8a9199 &&
                m.color.getHex() !== 0x17191b && m.color.getHex() !== 0xb9c0c7 &&
                m.color.getHex() !== 0x7d838a && m.color.getHex() !== 0x2b3238 &&
                m.color.getHex() !== 0xe8e2d2 && m.color.getHex() !== 0xd4622a &&
                m.color.getHex() !== 0xa8231c && m.color.getHex() !== 0x8a6a4e) {
              const c = m.clone(); c.color.setHex(this.color);
              if (Array.isArray(n.material)) n.material[i] = c; else n.material = c;
            }
          }
        });
      }
      // MERGE AFTER RECOLOURING. The merge bakes colour into vertices, so the
      // livery has to be on the parts before they are fused -- a recolour pass
      // after the merge finds one white vertex-coloured material and paints the
      // whole joint, tyres and chrome included.
      try {
        mergeJoints(this.bike, MERGE_OPTS);
      } catch (e) {
        // non-fatal: unmerged is correct, just slower
      }
      this.group.add(this.bike);
    }

    this.rider = riderSrc ? cloneWithJoints(riderSrc) : null;
    if (this.rider) {
      this.rider.traverse((n) => {
        if (!n.isMesh || !n.material) return;
        const m = n.material;
        if (m.color && m.color.getHex() === 0x2a2624) { n.material = m.clone(); n.material.color.setHex(this.color).multiplyScalar(0.6); }
        if (m.color && m.color.getHex() === 0x3b4a63) { n.material = m.clone(); n.material.color.setHex(0x2a2f38); }
      });
      // THE MOUNT SOCKET, same as the player's (see player.js for the full note).
      // A rival rider used to be parented to the rival GROUP with the seat offset
      // in road space, and its rider was rolled `+p.lean` against a bike rolled
      // `-p.lean` -- opposite signs, so every cornering rival visibly leaned off
      // the saddle. Parenting the rider to a socket ON THE BIKE makes contact a
      // property of the scene graph: one chain, group -> bike -> socket -> rider,
      // so the bike's roll carries the rider exactly and no sign can drift.
      if (!this.socket) {
        this.socket = new THREE.Object3D();
        this.socket.name = 'riderSocket';
        this.bike.add(this.socket);
      }
      // NO COUNTER-SCALE, and the seat offset is in BIKE-LOCAL units -- see the
      // long note at the socket in player.js. The counter-scale multiplied every
      // internal offset of the rider, lifting the pelvis 32 cm clear of the
      // saddle and putting the grips beyond the reach of the arms.
      const seatContactY = (this.rider.userData && this.rider.userData.spec)
        ? this.rider.userData.spec.seatContactY : 0;
      const seatBob = (this.rider.userData && this.rider.userData.spec && this.rider.userData.spec.seatBob) || 0;
      this.socket.position.set(
        CFG.SEAT_X,
        CFG.SEAT_Y - seatContactY + seatBob,
        CFG.SEAT_Z,
      );
      this.socket.add(this.rider);
      this.rider.position.set(0, 0, 0);
      // per-body seat: see riderpose.solveSeat (the pack has mixed statures)
      this.seatFit = solveSeat(this.rider, this.bike);

      // MERGE THE RIVAL'S RIDER TOO -- see the long note in player.js. Each rider
      // is 141 meshes (111 of them unmerged detail primitives), and the peak draw
      // count is dominated by having six of them on screen. `mergeJoints` only
      // bundles direct mesh children of `__part__` joints, so the joints -- and
      // therefore the whole riding pose -- survive untouched.
      // Helmet / vest / backpack from the kit, re-parented onto the head and torso
      // joints BEFORE the merge so they fold into those joints' draws.
      try { dressRider(this.rider, this.kit); } catch (e) { console.warn('[riderash] rival gear:', e); }
      try {
        mergeJoints(this.rider, MERGE_OPTS);
      } catch (e) {
        // non-fatal: unmerged is correct, just 111 more draws
      }
    }

// Rivals RECEIVE shadows but do not CAST them.
    //
    // The player's bike and rider are the hero and cast a shadow the eye reads
    // at speed. Five rivals casting as well doubled the shadow pass for six
    // silhouettes that, at racing distance, mostly land on top of each other and
    // on the player's own shadow. The draw budget is 900 and the riders are ~300
    // of it; this is the cheapest honest saving available, and it is invisible
    // in motion.
    this.group.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = true; } });
    this.group.userData.__rival = this.name;
    // Read-only data for UI (character cards): the machine class and the gear worn.
    this.group.userData.bikeClass = this.kit.bike;
    this.group.userData.gearIds = (this.rider && this.rider.userData.gearIds) || [];
    scene.add(this.group);
    this.scene = scene;
    // THE SAME CRASH AS THE PLAYER. A rival used to "go down" by slumping in the
    // saddle of a bike that kept rolling, then popping upright at WRECK_TIME. Now
    // the body is thrown (ragdoll), lies there, gets up and walks back to its own
    // machine, which stays where it stopped -- the Road Rash beat, for everyone.
    this.dismount = new Dismount(this, { auto: true });
    this._wasDown = false;
  }

  /**
   * Put the rider back to a starting state for a new race.
   *
   * Reset the PHYSICS, the FIGHTER and the BRAIN. This was `BikePhys.reset()`
   * alone, then `BikePhys` + the AI's hand-written fields, and each round the
   * leak was the same: a race that behaved differently from every race after it
   * is a field somebody forgot. The brain now owns every piece of AI state, so
   * `brain.reset()` clears all of it in one call.
   */
  /**
   * Apply a roster entry (and its per-event scaling) to this rider.
   *
   * Called at construction and again from `reset()` on every race, so the pack
   * for GRUDGE MATCH is the same NINE CHARACTERS as COAST OPENER but faster and
   * angrier. The visual is not rebuilt -- only the numbers the brain reads and
   * the weapon the fighter carries.
   */
  // ==== [npc-persona] BEGIN
  /** Per-race numbers the character card shows and the harness measures. */
  _resetCharStats() {
    this.cstats = { swings: 0, hits: 0, hitsOnPlayer: 0, nearT: 0, taken: 0 };
    this.lastSay = null;
    this._sayCd = 0;
  }

  /** Pick a taunt line for `kind` ('hit' | 'hurt') and publish it for the HUD toast. */
  _say(kind) {
    const e = this.entry, lines = e && e.taunts && e.taunts[kind];
    if (!lines || !lines.length || this._sayCd > 0) return;
    const i = Math.floor(this.brain.rand() * lines.length) % lines.length;
    this.lastSay = { text: lines[i], kind, t: performance.now() };
    this._sayCd = 4;
  }
  // ==== [npc-persona] END

  applyEntry(entry, slot = this.index) {
    if (!entry) return this;
    // ==== [npc-persona] BEGIN the roster deals a (possibly different) character
    // to this slot each race: temperament, per-race seed and mood go with him.
    this.entry = entry;
    if (this.brain) {
      if (entry.persona) { this.brain.setPersona(entry.persona); this.personaName = entry.persona; }
      if (Number.isFinite(entry.seed)) this.brain.seed = entry.seed >>> 0;
      this.brain.applyMood(entry.mood || 0, entry.paceTrim || 1);
    }
    this._resetCharStats();
    // ==== [npc-persona] END
    this.riderId = entry.id || this.riderId;
    this.name = entry.name || this.name;
    this.specialty = entry.specialty || this.specialty;
    this.blurb = entry.blurb || this.blurb;
    this.skill = Number.isFinite(entry.skill) ? THREE.MathUtils.clamp(entry.skill, 0, 1) : this.skill;

    // RE-ASSIGN THE ABSOLUTE PACE FOR THIS RACE. The level supplies the reference
    // speed (career.event.reference, measured from the expected bike tier) and
    // the roster supplies the rider's rank, so SLATER is near the front of the
    // field at every level while BREGA is near the back -- the field's absolute
    // pace rises with the level and the standing within it stays the character's.
    if (Number.isFinite(entry.paceRank)) this.paceRank = entry.paceRank;
    if (this.brain) {
      this.brain.skill = this.skill;
      this.fitMachine(entry.reference || CFG.RIVAL_REFERENCE_PACE);
    }
    // A club is re-issued every race: a rider who lost it to the player last
    // race should have it back at the next start line.
    this.fighter.hasWeapon = !!entry.hasWeapon;
    // The persona table is shared and mutable, so the event's aggro must not be
    // written INTO it -- that would compound every race (race 2 would scale the
    // already-scaled race 1 values). The brain keeps its own copy.
    if (entry.aggroScale && this.brain && this.brain.persona) {
      // [npc-persona] x per-race mood (+-22%): a FIRED UP rider swings more.
      const moodMul = 1 + 0.22 * (Number.isFinite(entry.mood) ? entry.mood : 0);
      this.brain.persona = { ...this.brain.personaBase, aggression: this.brain.personaBase.aggression * entry.aggroScale * moodMul };
    }
    return this;
  }

  reset(opts = {}) {
    this.out = false; this._pl = null;             // back from over the edge (a cliff course)
    if (this.group) this.group.visible = true;
    // Back on the bike before anything else reads the rig.
    if (this.dismount) this.dismount.reset();
    this._wasDown = false;
    // Re-apply the roster entry for THIS race first, so the per-race skill and
    // aggression scaling is in place before the brain is reset. `opts.entry` is
    // supplied by resetRace for the current career event.
    if (opts.entry) this.applyEntry(opts.entry, opts.slot ?? this.index);
    this.phys.reset(opts);
    this.brain.reset();
    this.laneHome = this.brain.laneHome;
    this.targetLateral = this.phys.lateral;
    this.decisionTimer = 0;
    this.aggroTimer = 0;
    this.wantsToAttack = null;
    this.fighter.resetCombat();
    return this;
  }

  /**
   * Assign this rider's pace for the level, then fit a machine that can reach
   * it. The brain used to be capped at CFG.MAX_SPEED -- the RAT's terminal -- so
   * however fast a contender was meant to be, it rode a RAT and could never pass
   * a player holding the throttle. The machine is the rider's, like a Road Rash
   * rival's bike: power is solved from the pace (top speed ~ sqrt(power)), with
   * a small margin so the pace is reachable out of a corner, never below a RAT.
   */
  fitMachine(reference) {
    this.brain.maxSpeed = Infinity;
    const pace = this.brain.assignPace(reference, this.paceRank);
    const power = Math.max(1, Math.pow((pace * 1.02) / CFG.MAX_SPEED, 2));
    this.phys.setMachine({ power });
    this.brain.maxSpeed = this.phys.topSpeed;
    return pace;
  }

  get pos() { return this.phys.pos; }
  get speed() { return this.phys.speed; }
  get lateral() { return this.phys.lateral; }
  get stateLabel() { return this.brain.stateName; }

  /**
   * Build the context the brain reads. This is the whole coupling between the
   * rider and the engine: everything the brain is allowed to know is assembled
   * here, and it is all plain numbers. Nothing passes a BikePhys or a scene
   * object in, so a brain cannot reach the physics even by accident.
   */
  // [npc-persona] map a Fighter back to its rider key ('player' | 'r<id>').
  _keyOfFighter(fi, world) {
    if (!fi || !world) return null;
    if (world.player && world.player.fighter === fi) return 'player';
    for (const o of (world.parts || [])) if (o.fighter === fi && o !== world.player) return 'r' + o.id;
    return null;
  }

  buildContext(dt, world) {
    const p = this.phys, f = this.fighter;
    const parts = (world && world.parts) ? world.parts : [];

    // Others: every other rider entity, flattened to numbers.
    //
    // `place` is the 1-based RACE POSITION and it is the field that makes the
    // pack race rather than orbit: the brain chooses who to fight by places
    // gained, not by proximity (see npc.js `_facts`). Supplied here because the
    // callee must stay pure data -- the brain never sees `world`.
    const others = [];
    for (const o of parts) {
      if (o === this || !o.phys) continue;
      const of = o.fighter;
      others.push({
        s: o.phys.s, lateral: o.phys.lateral, speed: o.phys.speed,
        hp: of ? of.hp : 100, maxHp: of ? of.maxHp : 100,
        down: of ? !!of.down : false,
        index: (typeof o.index === 'number') ? o.index : -1,
        place: (world && world.positionOf) ? world.positionOf(o.phys) : 0,
        // [npc-persona] identity for grudges / fixation
        key: (world && o === world.player) ? 'player' : ('r' + o.id),
      });
    }

    // The player is a rider like any other; pass it flat, and guard the null.
    let player = null;
    if (world && world.player && world.player.phys) {
      const pp = world.player.phys;
      const pf = world.player.fighter;
      player = {
        s: pp.s, lateral: pp.lateral, speed: pp.speed,
        hp: pf ? pf.hp : 100, maxHp: pf ? pf.maxHp : 100,
      };
    }

    // The nearest rider ahead along the road, for gap control.
    const aheadEnt = (world && world.nearestAhead) ? world.nearestAhead(this, 14) : null;
    const ahead = aheadEnt && aheadEnt.phys
      ? { s: aheadEnt.phys.s, lateral: aheadEnt.phys.lateral, speed: aheadEnt.phys.speed }
      : null;

    // Road curvature: the tangent's rate of change, finite and signed. Positive
    // means the road is bending toward +x.
    // CURVATURE, NOT HEADING. This was `atan2(t.x, t.z)` -- the road's absolute
    // HEADING in radians -- fed to a brain that compares it with CORNER_CUT
    // (0.010 = a 100 m radius) and steers to the inside by its sign. Heading is
    // ~0.1-0.3 rad almost everywhere, so every rival believed it was in a hairpin
    // for the whole race and picked its "inside" line from which way the road
    // happened to point on the map. The real quantity is the bend ahead,
    // measured in THIS rider's lateral frame so its sign means "the inside is
    // +lateral": offset of the centreline LOOK m ahead, projected on the road
    // normal here, gives curvature = 2*offset/LOOK^2.
    const curv = roadCurvature(p.s);
    const cornerV = this._cornerV = cornerSpeed(this, p.s, dt);

    // Was this rider hit since the last frame? contactImpulse is reset by the
    // caller after it reads it, so a non-zero value here is this frame's hit.
    const contact = (p.contactImpulse > 0.2) || (f.hitFlash > 0);

    return {
      dt,
      self: {
        s: p.s, lateral: p.lateral, speed: p.speed, lateralV: p.lateralV,
        lean: p.lean, yawOffset: p.yawOffset,
        hp: f.hp, maxHp: f.maxHp,
        down: f.down, busy: f.busy, canChain: !!f.hasWeapon,
        onRoad: p.onRoad,
        // [npc-persona] who landed the last blow, as an `others[].key`
        lastHitBy: this._keyOfFighter(f.lastHitBy, world),
        struck: f.hitFlash > 0,
        // This rider's own 1-based race position. Read by the victim scoring so
        // "who is worth attacking" is answered in PLACES, not metres.
        place: (world && world.positionOf) ? world.positionOf(p) : 0,
      },
      player,
      others,
      ahead,
      lead: world && world.player && world.player.phys ? p.s - world.player.phys.s : 0,
      // (the nearer edge where the road is lopsided: a brain that thinks the
      // road is symmetric must not steer off the narrow side)
      road: { halfWidth: halfAt(p.s), curvature: curv, cornerV },
      contact,
      // Vehicles within 5 m behind .. 110 m ahead, as plain numbers (traffic.js
      // trafficNear). The brain steers round them -- see npc.js _avoidTraffic.
      traffic: world && world.traffic ? trafficNear(world.traffic, p.s, 5, 110) : null,
    };
  }

  update(dt, world, hooks) {
    const p = this.phys, f = this.fighter;

    // ---- SIMULATION LOD: NO AI, NO CONTEXT, WHEN FAR ------------------------
    //
    // The field is fourteen riders strung over miles; at most a handful are ever
    // near the player. A rider hundreds of metres away does not need to choose a
    // line, pick a victim or steer -- it needs to HOLD ITS OWN PACE and keep its
    // position, so the standings stay right and you can catch it. This is a
    // LOD, not a leash: it never reads the player's speed, and a far rider is
    // not pulled back toward you -- it simply stops thinking.
    //
    // The distance used is the same `_cullDist` the visual cull uses, so the two
    // agree about what "far" means. Hysteresis on the AI band (LOD_NEAR <
    // LOD_FAR) stops a rider at the boundary from toggling its brain every frame,
    // which would make its state machine chatter.
    if (world && world.player && world.player.phys) {
      const pp = world.player.phys;
      const ds = Math.abs(p.s - pp.s);
      const dl = Math.abs(p.lateral - pp.lateral);
      this._cullDist = Math.hypot(ds, dl);
    } else {
      this._cullDist = 0;
    }
    // ---- THE CRASH: thrown, down, up, walk back, remount ------------------
    // Runs for near and far riders alike, so the standings see the same walk.
    if (f.down && !this._wasDown && this.rider && this.socket) {
      this.dismount.beginFall({ side: Math.sign(p.lateralV || 0) || 0 });
    }
    this._wasDown = f.down;
    if (this.dismount.onFoot && !f.down) this.dismount.reset();
    if (this.dismount.onFoot) {
      // The dismount ends the crash (it clears `f.down` on the remount), so the
      // fighter's WRECK_TIME must not pop the rider back onto a distant bike.
      if (f.down) f.downTimer = Math.max(f.downTimer, 0.5);
      f.update(dt, world.fightersExcept(this), this._charHooks(hooks, world));
      this.dismount.update(dt, null);
      this.dismount.render(dt);
      return;
    }

    if (this._lodFar === undefined) this._lodFar = false;
    if (this._lodFar) { if (this._cullDist < CFG.RIVAL_LOD_NEAR) this._lodFar = false; }
    else if (this._cullDist > CFG.RIVAL_LOD_FAR) this._lodFar = true;

    if (this._lodFar) {
      this._updateLod(dt, world, hooks);
      return;
    }

    // ---- AI: one call, one intent -----------------------------------------
    const ctx = this.buildContext(dt, world);
    const intent = this.brain.think(ctx);

    // Mirror the brain's decision onto the rival, for the HUD, the harness and
    // anything else that reads the old fields. These are READS of the brain's
    // state, never writes to the physics.
    this.targetLateral = this.brain.lineTarget;
    this.stateLabelCache = this.brain.stateName;

    // ---- INTENT -> PHYSICS. The ONLY control write in this file. ----------
    // THE THROTTLE IS ANALOG IN THE BRAIN AND BOOLEAN IN THE ENGINE. It used to
    // be thresholded at 0.05, and the brain never asks for less than 0.15 -- so
    // every rival rode flat out all race, the pace controller's trim did
    // nothing, `_gapThrottle`'s "back off behind the rider in front" (0.15) was
    // full throttle straight into his back wheel, and over-pace was held by
    // braking WITH the throttle open. A duty cycle turns the analog request into
    // the right average force: 0.45 is on 45% of frames.
    // THE BEND AHEAD OVERRULES EVERY MODE (hunting, fleeing, drafting all ask
    // for full throttle): see cornerSpeed.
    if (p.speed > (this._cornerV ?? Infinity)) {
      const over = p.speed - this._cornerV;
      intent.throttle = over > 1 ? 0 : Math.min(intent.throttle, 0.3);
      intent.brake = Math.max(intent.brake || 0, Math.min(1, over * 0.18));
    }
    this._thrDuty = (this._thrDuty || 0) + intent.throttle;
    const thrOn = this._thrDuty >= 1;
    if (thrOn) this._thrDuty -= 1;
    this._brkDuty = (this._brkDuty || 0) + intent.brake;
    const brkOn = this._brkDuty >= 1;
    if (brkOn) this._brkDuty -= 1;
    let steer = intent.steer;
    // HOLDING SOMEONE: ride with them. The brain's lane controller would steer
    // back to its own line and fight the grab.
    if (f.hold) {
      const tp = f.hold.target.owner;
      const err = (tp.lateral - f.hold.side * CFG.GRAPPLE_GAP) - p.lateral;
      steer = Math.max(-1, Math.min(1, err * 0.3 - (p.lateralV || 0) * 0.12));
      // Throw them INTO the rail if they are already on that side of the road.
      const half = edgeAt(Math.max(0, tp.s), Math.sign(tp.lateral) || 1);
      if (f.hold.t > 0.45 && Math.sign(tp.lateral) === f.hold.side && Math.abs(tp.lateral) > half * 0.55) {
        f.hold.throwNow = true;
      }
    }
    // HELD: fight it. Skill decides how often a rival wriggles out.
    if (f.heldBy) f.struggle((0.12 + this.brain.skill * 0.4) * dt);   // ~0.2-0.5/s: good riders sometimes slip a long hold
    const control = {
      throttle: thrOn && !brkOn,
      brake: brkOn,
      steer,
      tuck: intent.tuck,
    };
    this._aiBoost(dt, world, control);
    p.advance(dt, control);
    // ----------------------------------------------------------------------

    // ---- the intent's combat half -----------------------------------------
    // The brain says WHICH attack; the fighter owns the wind-up, the arc test
    // and the damage. Same path the player's keys take.
    if (intent.attack && !f.busy && !f.down && f.can(intent.attack)) {
      f.commit(intent.attack);
      this.wantsToAttack = intent.attack;
      this.aggroTimer = 0.6;
      if (this.cstats) this.cstats.swings++;        // [npc-persona]
    } else if (!f.busy) {
      this.wantsToAttack = null;
    }

    // ==== [npc-persona] BEGIN race stats + taunts
    if (this.cstats) {
      if (this._sayCd > 0) this._sayCd -= dt;
      if (this._cullDist !== undefined && this._cullDist < 15 && !f.down) this.cstats.nearT += dt;
      if (f.hitFlash >= 0.2 && !this._wasFlash) { this.cstats.taken++; if (f.lastHitBy && world.player && f.lastHitBy === world.player.fighter) this._say('hurt'); }
      this._wasFlash = f.hitFlash >= 0.2;
    }
    f.update(dt, world.fightersExcept(this), this._charHooks(hooks, world));
    // ==== [npc-persona] END
    this.applyVisual(dt);
  }

  // [npc-persona] Wrap the game's combat hooks so this rider's landed blows are
  // counted (and taunted) without touching main.js. Built once per hooks object.
  _charHooks(hooks, world) {
    if (!hooks) return hooks;
    if (this._hkBase === hooks && this._hk) return this._hk;
    const self = this;
    this._hkBase = hooks;
    this._hk = Object.assign(Object.create(hooks), {
      onHit(attacker, targets, a) {
        if (attacker === self.fighter && self.cstats) {
          self.cstats.hits += targets ? targets.length : 1;
          const pf = world && world.player && world.player.fighter;
          if (pf && targets && targets.includes(pf)) { self.cstats.hitsOnPlayer++; self._say('hit'); }
        }
        return hooks.onHit ? hooks.onHit.call(hooks, attacker, targets, a) : undefined;
      },
    });
    return this._hk;
  }

  /**
   * THE CHEAP PATH for a rider far from the player: hold pace, hold lane, keep
   * the position honest, spend no AI.
   *
   * This is NOT a behavioural shortcut that changes the race -- the rider still
   * travels, still holds its assigned absolute pace, and still takes its place in
   * the standings, so a player who closes on it finds it exactly where the field
   * says it should be. It just stops thinking while nobody can see it.
   *
   * `_cullDist` is measured in ARC LENGTH plus lateral offset, the same metric
   * the visual cull uses, so "far" means the same thing to both.
   */
  _updateLod(dt, world, hooks) {
    const p = this.phys, f = this.fighter;

    // Hold the assigned absolute pace, with the same corner lift the full brain
    // applies so a far rider does not out-corner a near one.
    const target = f.down ? 0 : (this.brain.paceSpeed || CFG.RIVAL_REFERENCE_PACE);
    const control = {
      throttle: p.speed < target - 1.5,
      brake: f.down || p.speed > target + 3.0,
      steer: 0,
      tuck: false,
    };
    // Keep it on the road: a gentle pull back toward its lane home. This reads
    // no player state -- it is the same lane the brain would hold.
    const lim = edgeAt(Math.max(0, p.s), Math.sign(p.lateral) || 1) - 1.6;
    const laneErr = (this.brain.laneHome ?? 0) - p.lateral;
    control.steer = Math.max(-1, Math.min(1, laneErr * 0.22));
    if (Math.abs(p.lateral) > lim) control.steer = -Math.sign(p.lateral) * 0.6;
    // TRAFFIC. The far path has no brain, but it is still on a road full of
    // vehicles (traffic recycles within ~1 km of the player and LOD_FAR is
    // 420 m), and main.js's traffic contact applies to it. Without this the
    // unseen pack wiped out on every bus. A fixed, competent 2.4 s look.
    // [npc-persona] the far path keeps the rider's traffic personality: a
    // reckless look-ahead and the same seeded eyes-off-the-road windows.
    const care = (this.brain && this.brain.persona && this.brain.persona.trafficLook) || 1;
    if (world && world.traffic && !f.down && (!this.brain || this.brain.trafficAttention(dt, false) > 0)) {
      const esc = trafficEscape(trafficNear(world.traffic, p.s, 5, 100), p.s, p.lateral, p.speed, 2.4 * Math.min(1, care), halfAt(p.s) - 1.0);
      if (esc) {
        control.steer = Math.max(-1, Math.min(1, (esc.target - p.lateral) * 1.5 - (p.lateralV || 0) * 0.25));
        if (esc.brake) { control.brake = true; control.throttle = false; }
      }
    }

    // the same braking for the bends ahead as the full brain (cornerSpeed)
    this._cornerV = cornerSpeed(this, p.s, dt);
    if (p.speed > this._cornerV) { control.throttle = false; control.brake = p.speed > this._cornerV + 0.8; }
    this._aiBoost(dt, world, control);
    p.advance(dt, control);
    f.update(dt, world.fightersExcept(this), hooks);
    this.applyVisual(dt);
  }

  /**
   * THE PACK BOOSTS TOO: same charge, same cooldown, same cap as the player.
   * A rider fires it to pass the player just ahead, to answer the player going
   * by, to defend when the player closes from behind; the contenders race for
   * the win and spend every charge they get. Skill decides the timing. While a
   * charge burns the rider holds the throttle open (the pace law would
   * otherwise brake it straight back to its cruising pace and waste it).
   */
  _aiBoost(dt, world, control) {
    const p = this.phys, f = this.fighter;
    if (f.down) return;
    if (p.boost > 0) {
      if (!control.brake) { control.throttle = true; control.tuck = true; }
      return;
    }
    if (p.speed <= 15 || p.boostCool > 0 || control.brake) return;
    const pl = world && world.player && world.player.phys;
    const gap = pl ? pl.s - p.s : 999;                              // + = the player is ahead
    const passing = pl && gap > 2 && gap < 70;
    const answered = pl && gap > -8 && gap <= 2 && pl.boost > 0;
    const defending = pl && gap <= 2 && gap > -60;
    const contender = (this.paceRank ?? 0) >= 0.86;
    // NITRO IS EARNED (physics.js), so a charge is worth spending well: a
    // skilled rider keeps it for a pass, an answer or a defence, and only burns
    // one idly when the tank is about to overflow. A weak one fires at random.
    if (p.nitro < 1) return;
    if ((this._cornerV ?? Infinity) < p.speed + 10) return;       // never into a bend
    const sk = this.skill ?? 0.7;
    const full = p.nitro >= 2.7;
    const rate = passing || answered ? 1.4 : defending ? 0.9 : full ? 0.6 : contender ? 0.25 * (1 - sk) + 0.05 : 0.12 * (1 - sk);
    if (Math.random() < dt * rate * (0.5 + sk * 0.5)) p.tryBoost();
  }

  applyVisual(dt) {
    const p = this.phys;
    this._animT = (this._animT || 0) + (dt || 0);   // monotonic, for the chain sway

    // ---- DISTANCE CULLING ---------------------------------------------------
    //
    // THE FIELD SIZE IS A SIMULATION NUMBER; THE DRAW COST IS A VISIBILITY
    // NUMBER, and until now they were the same number because every rival was
    // drawn every frame. Road Rash's field was ~15 riders spread over miles of
    // track, but you only ever contested with 2-4 at once -- the rest were ahead
    // or behind and simply not on screen. Raising the field toward that without
    // this would multiply the draw budget for silhouettes nobody can see.
    //
    // The brain and the physics run regardless; only the meshes stop drawing.
    // `CULL_NEAR`/`CULL_FAR` are a hysteresis band: a rider is drawn inside
    // `CULL_FAR` and only hidden past `CULL_NEAR`, so a rival hovering at the
    // boundary cannot flicker in and out.
    const d = this._cullDist;
    // Draw inside CULL_FAR; hide only past CULL_NEAR. The band between the two
    // is hysteresis so a rider at the boundary cannot strobe.
    if (d !== undefined) {
      if (!this.group.visible) { if (d < CFG.RIVAL_CULL_FAR) this.group.visible = true; }
      else if (d > CFG.RIVAL_CULL_NEAR) this.group.visible = false;
    }

    if (!this.group.visible) return;   // nothing to transform

    this.group.position.copy(p.pos);
    this.group.position.add(p.rearPivotShift(_rivShift));
    // the bike leans with the steer, and pitches slightly under power
    this.group.rotation.set(p.roadPitch || 0, p.yaw, 0, 'YXZ');
    if (this.bike) {
      const j = this.bike.userData.joints;
      if (j) {
        if (j.frontSteer) j.frontSteer.rotation.y = p.steerAngle || 0;
        if (j.frontWheel) j.frontWheel.rotation.x = p.wheelSpin;
        if (j.rearWheel) j.rearWheel.rotation.x = p.wheelSpin;
      }
      // POSITIVE, and it was negative. The bike model faces +Z, so a positive
      // `rotation.z` tips it toward +X, which is the rider's RIGHT (the chase cam
      // looks down -Z and screen-right is +X). MEASURED in the live scene: z=-0.4
      // tips screen-left, z=+0.4 screen-right, and a right-hand turn gives
      // `p.lean > 0`. The old `-p.lean` banked every rival into the OUTSIDE of the
      // corner, mirrored exactly like the player's bike. See the long note in
      // player.js applyVisual for the measurement.
      this.bike.rotation.z = p.lean * 0.92;
    }
    if (this.rider) {
      const f = this.fighter;
      const j = this.rider.userData.joints;
      // THE RIDER LEANS WITH THE BIKE, by construction -- see player.js.
      //
      // This was `this.rider.rotation.z = -p.lean * 0.30` while the bike rolled
      // `-p.lean * 0.92`: same sign but a different magnitude, on top of a seat
      // offset hand-rotated by the bike's roll. The rider is now a child of a
      // socket on the bike, so it inherits the bike's roll EXACTLY, and the only
      // term here is the small extra body lean a rider adds on top. Nothing in
      // this block can put the rider off the saddle, because the saddle is its
      // parent.
      if (j) {
        // crash pose: rider goes down with the bike, expressed in the socket's
        // frame (a drop and a slide back relative to the machine, not the road)
        if (f.down) {
          // the frame before the dismount takes over: hold the riding pose,
          // the ragdoll is measured off it (see player.js)
          this.rider.position.set(0, 0, 0);
        } else {
          // The extra body lean ON TOP of the bike's roll (which this rider
        // inherits through the socket). Same sign as the bike's for the same
        // reason -- a rider leaning into his own corner, not out of it.
        this.rider.rotation.set(0, 0, p.lean * 0.06);
          this.rider.position.set(0, 0, 0);
          this.poseRider(j, f);
        }
      }
    }
  }

  poseRider(j, f) {
    if (!j) return;
    // A deterministic per-rider phase: the old idle used performance.now(), so
    // every rival's idle motion was tied to wall-clock time and could never be
    // reproduced. The brain's accumulated state time is a simulated clock and
    // is the right source.
    const t = this.brain ? this.brain.stateTime + this.brain.transitions * 0.37 : 0;
    const rot = (node, x, y, z) => {
      if (!node || !node.rotation) return;
      if (x !== undefined) node.rotation.x = x;
      if (y !== undefined) node.rotation.y = y;
      if (z !== undefined) node.rotation.z = z;
    };
    // Clear the axes the rest pose does not itself write, or the deltas below
    // accumulate. See riderpose.clearAxes for the measurement.
    clearAxes(j);

    // THE SAME SOLVED SEAT AS THE PLAYER -- see riderpose.poseSeated. The
    // hand-written copy that stood here put every rival's fists 0.65 m above
    // the bars with the torso reclined.
    const tuck = Math.min(1, (this.phys ? this.phys.speed : 0) / 45);
    poseSeated(j, tuck);
    poseRideDynamics(j, this.phys, this._animT || 0, this.id || 0);

    // Recoil and idle sway move the torso, so they go BEFORE poseCombat, which
    // re-solves the arms onto the grips by IK from wherever the torso is (see
    // the same note in player.js: after the solve they dragged the fists off).
    // (a recoil is a lean BACK from the seated rest; positive x leans forward)
    if (f.hitFlash > 0) {
      const r = f.hitFlash / 0.22;
      if (j.torso) j.torso.rotation.x -= r * 0.30;
    }
    // idle body motion so the pack does not look frozen
    if (!f.down && j.torso) {
      rot(j.torso, undefined, undefined, j.torso.rotation.z + Math.sin(t * 3.1 + this.id) * 0.02);
    }

    // attacks, grab, hold, chain -- the SAME layer as the player
    poseCombat(j, f, this.phys, this._animT || 0, ATTACKS);
  }
}

// THE SPEED FOR THE BENDS AHEAD. On a cliff course (level.js profile with a
// cliff) the bends are tight enough -- down to ~40 m radius in the swirls --
// that a rider who only lifts the throttle runs wide into the rail or through
// a gap. So the pack brakes: for each point up to 140 m ahead, the fastest this
// rider can take the bend there (sqrt(a_lat / k)) plus what braking over the
// distance buys (v^2 = vc^2 + 2 a d); the lowest wins. a_lat is where SKILL
// shows: a good rider carries ~25% more lateral g than a weak one, and every
// rider misjudges each bend by a few percent (re-rolled every couple of
// seconds) -- the weak ones by more, which is how they end up in the rail.
// Other courses: Infinity (their gentle roads were balanced without it).
const CORNER = { LOOK: [0, 12, 25, 40, 60, 85, 110, 140], BRAKE: 7.5, ALAT: [6.6, 8.6], JIT: [0.12, 0.04], REROLL: 2.2 };
function cornerSpeed(r, s, dt) {
  if (!roadProfile().cliff) return Infinity;
  const sk = r.skill ?? 0.7;
  r._cjT = (r._cjT || 0) - (dt || 0);
  if (r._cjT <= 0) { r._cjT = CORNER.REROLL * (0.7 + Math.random() * 0.6); const j = CORNER.JIT[0] + (CORNER.JIT[1] - CORNER.JIT[0]) * sk; r._cj = 1 + (Math.random() * 2 - 1) * j; }
  const aLat = (CORNER.ALAT[0] + (CORNER.ALAT[1] - CORNER.ALAT[0]) * sk) * (r._cj || 1);
  let v = Infinity;
  for (const d of CORNER.LOOK) {
    const k = Math.abs(roadCurvature(s + d, 16));
    if (k < 1e-4) continue;
    const vc = Math.sqrt(aLat / k);
    v = Math.min(v, Math.sqrt(vc * vc + 2 * CORNER.BRAKE * d));
  }
  return v;
}

// Signed curvature of the road LOOK m ahead of `s`, in the rider's lateral
// frame: positive means the bend's inside is +lateral. See buildContext.
const _cA = new THREE.Vector3(), _cB = new THREE.Vector3(), _cT = new THREE.Vector3();
function roadCurvature(s, LOOK = 30) {
  centreAt(-s, _cA);
  centreAt(-(s + LOOK), _cB);
  headAt(-s, _cT);
  // lateral normal exactly as BikePhys.sync builds it
  const nx = -_cT.z, nz = _cT.x;
  const off = (_cB.x - _cA.x) * nx + (_cB.z - _cA.z) * nz;
  const k = 2 * off / (LOOK * LOOK);
  return Number.isFinite(k) ? k : 0;
}

