// RideRash — melee combat. Three attacks, each with a wind-up, an arc test,
// and a different reach/damage/stamina profile.
//
// The attacks are driven by real input (J/K/L) or by an AI's decision, and both
// go through the same commit() call, so a gate that presses keys tests the same
// path the player uses.
import * as THREE from 'three';
import { CFG } from './config.js';
// ---- [chain agent] chain properties (src/chainweapon.js) -------------------
// A fighter with `chainCfg` (the player's, set in main.js from the showroom's
// Chain panel) swings THAT chain: longer = more reach and a slower wind-up,
// heavier = more damage and push. No chainCfg = ATTACKS.chain unchanged.
import { chainAttack } from './chainweapon.js';
function specOf(f, kind) {
  return kind === 'chain' && f && f.chainCfg ? chainAttack(ATTACKS.chain, f.chainCfg) : ATTACKS[kind];
}
// ---- [/chain agent] ---------------------------------------------------------

// The longitudinal window a swing counts in, in metres. Deliberately a local
// constant rather than an import from npc.js: npc.js imports combat.js, and
// reaching back the other way would make the two modules a cycle for the sake of
// one number. It is the same value the AI commits from, and the comment on
// CFG's combat block is where the reasoning lives.
const ALONGSIDE_LONG = 2.2;
const FLANK_S = 1.4;            // m along the road: 'level with you' for the flank rule in resolve()

export const ATTACKS = {
  // Every attack is now a DIRECTIONAL impulse, not a scalar shove. `along` is the
  // component along the road (+ = the target is driven up the road, - = dragged
  // back), `yaw` is how much the blow spins their bike, `scrub` is how much of
  // their own drive it costs them. That is what gives each one a character:
  //
  //   punch  a fast jab. Barely moves them, but it twists the bars, so it is a
  //          tool for unsettling a rider who is already leaning.
  //   kick   heavy and slow. Drives them ACROSS the road, which is how you put
  //          someone into the rail or off into the dirt.
  //   chain  long reach, swung from behind. DRAGS them back down the road, so it
  //          is how you defend a position and how you steal a place.
  punch: {
    name: 'punch', range: CFG.PUNCH_RANGE, arc: CFG.PUNCH_ARC, dmg: CFG.PUNCH_DMG,
    cd: CFG.PUNCH_CD, wind: CFG.PUNCH_WIND, stamina: CFG.STAMINA_COST.punch,
    push: 0.55, reach: 0.9, arm: 'right', anim: 'punch',
    along: -0.10, yaw: 1.25, scrub: 0.7,
  },
  kick: {
    name: 'kick', range: CFG.KICK_RANGE, arc: CFG.KICK_ARC, dmg: CFG.KICK_DMG,
    cd: CFG.KICK_CD, wind: CFG.KICK_WIND, stamina: CFG.STAMINA_COST.kick,
    push: 1.15, reach: 0.7, arm: 'left', anim: 'kick',
    along: 0.35, yaw: 0.85, scrub: 1.0,
  },
  chain: {
    name: 'chain', range: CFG.CHAIN_RANGE, arc: CFG.CHAIN_ARC, dmg: CFG.CHAIN_DMG,
    cd: CFG.CHAIN_CD, wind: CFG.CHAIN_WIND, stamina: CFG.STAMINA_COST.chain,
    push: 1.9, reach: 1.5, arm: 'right', anim: 'chain', needsWeapon: true,
    along: -0.55, yaw: 0.70, scrub: 1.4,
  },
  // grapple  reach across and GRAB. A landed grapple does not shove: it starts a
  //          HOLD (see Fighter._updateHold) that ties the two bikes together,
  //          drags the victim onto your line and ends in a THROW -- the biggest
  //          lateral impulse in the game, and the way to put a rider into the
  //          rail at speed. Press grapple again mid-hold to throw early.
  grapple: {
    name: 'grapple', range: CFG.GRAPPLE_RANGE, arc: CFG.GRAPPLE_ARC, dmg: CFG.GRAPPLE_DMG,
    cd: CFG.GRAPPLE_CD, wind: CFG.GRAPPLE_WIND, stamina: CFG.STAMINA_COST.grapple,
    push: 2.6, reach: 1.0, arm: 'near', anim: 'grapple', hold: true,
    along: -0.25, yaw: 1.35, scrub: 1.3,
  },
};

const KINDS = Object.keys(ATTACKS);

export class Fighter {
  constructor(owner, opts = {}) {
    this.owner = owner;                    // anything with pos/forward/yaw/speed
    this.stamina = CFG.STAMINA_MAX;
    this.hp = opts.hp ?? CFG.HP_MAX;
    this.maxHp = this.hp;
    this.cooldowns = { punch: 0, kick: 0, chain: 0, grapple: 0 };
    this.active = null;                    // {kind, t, windDone, hitDone, targets}
    this.anim = { punch: 0, kick: 0, chain: 0, grapple: 0, recoil: 0 };
    // THE HOLD. `hold` is set on the attacker ({target, t, side}); `heldBy` on
    // the victim. Both are cleared together by _endHold, never one alone.
    this.hold = null;
    this.heldBy = null;
    this.breakMeter = 0;
    // how the last hold ended, for the pose: {kind:'throw'|'break', t}
    this.holdEnd = null;
    this.aimSide = 1;                      // +1/-1 lateral side a grab reaches to
    this.combo = 0;
    this.comboTimer = 0;
    this.hasWeapon = opts.hasWeapon ?? false;
    // THE COLLAR (the police grab): instead of a throw at the end of the hold,
    // the holder hangs on for COLLAR_HOLD and lets go -- he is braking to pull
    // you over, and cops.js decides the bust. `grip` divides every struggle
    // press, so a firmer grip takes more mashing to slip.
    this.collar = !!opts.collar;
    this.grip = opts.grip ?? 1;
    this.down = false;
    this.downTimer = 0;
    this.invuln = 0;
    this.lastHitBy = null;
    this.hitFlash = 0;
  }

  get busy() { return !!this.active; }

  can(kind) {
    if (this.down) return false;
    if (this.heldBy) return false;         // held: you can only struggle
    if (this.hold) return false;           // holding: grapple again = throw (see commit)
    const a = specOf(this, kind);   // [chain agent]
    if (!a) return false;
    if (this.cooldowns[kind] > 0) return false;
    if (this.active) return false;
    if (this.stamina < a.stamina) return false;
    if (a.needsWeapon && !this.hasWeapon) return false;
    return true;
  }

  // Commit an attack. Returns true if it started.
  commit(kind) {
    // While HELD every attack key is a struggle; while HOLDING, grapple throws.
    if (this.heldBy) { this.struggle(); return false; }
    if (this.hold) { if (kind === 'grapple') this.hold.throwNow = true; return false; }
    if (!this.can(kind)) return false;
    const a = specOf(this, kind);   // [chain agent]
    this.stamina -= a.stamina;
    this.cooldowns[kind] = a.cd;
    // [chain agent] `dur`: a slower chain stretches its recovery too, so the
    // hit test stays at the same point of the swing (u = 0.5) for any chain
    this.active = { kind, t: 0, wind: a.wind, dur: a.wind + (a.recover ?? 0.22), hit: false, targets: new Set() };
    this.anim[kind] = 0.0001;
    return true;
  }

  // Called every frame. `others` is the list of Fighters in the world.
  update(dt, others, hooks = {}) {
    for (const k of KINDS) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }
    // stamina: recovers, faster at speed
    const spd = this.owner.speed || 0;
    if (!this.active && !this.hold) {
      this.stamina = Math.min(CFG.STAMINA_MAX, this.stamina + (CFG.STAMINA_REGEN + spd * CFG.STAMINA_REGEN_SPEED) * dt);
    }
    // combo decay
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    // hp trickle
    if (!this.down && this.hp < this.maxHp && this.hp > 0) {
      this.hp = Math.min(this.maxHp, this.hp + CFG.HP_REGEN * dt);
    }

    // animation decay
    for (const k of KINDS) {
      if (this.anim[k] > 0) this.anim[k] = Math.max(0, this.anim[k] - dt / (ATTACKS[k].cd * 0.85));
    }
    if (this.anim.recoil > 0) this.anim.recoil = Math.max(0, this.anim.recoil - dt * 4);
    if (this.holdEnd) { this.holdEnd.t += dt; if (this.holdEnd.t > 0.6) this.holdEnd = null; }

    // downtime (crashed)
    if (this.down) {
      if (this.hold || this.heldBy) this._endHold('break', hooks);
      this.downTimer -= dt;
      if (this.downTimer <= 0 && !this._remountHandled) {
        this._remountHandled = true;
        hooks.onRemount?.(this);
      }
      return;
    }
    this._remountHandled = false;

    // advance an active attack
    if (this.active) {
      const a = specOf(this, this.active.kind);   // [chain agent]
      this.active.t += dt;
      // A grab reaches toward SOMEONE: aim the arm at the nearest rider during
      // the wind-up, so the pose reads before the arc test decides the hit.
      if (a.hold && !this.active.hit) {
        let best = null, bd = Infinity;
        for (const f of others) {
          if (f === this || f.down) continue;
          const d = Math.hypot(f.owner.s - this.owner.s, f.owner.lateral - this.owner.lateral);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) this.aimSide = Math.sign((best.owner.lateral - this.owner.lateral) || 1);
      }
      // EVERY STRIKE PICKS ITS SIDE ONCE, on its first frame: the lateral side
      // (+1/-1) of the nearest rider alongside, within 1.5x the attack's reach.
      // riderpose.poseCombat throws the punch / kick with the limb on THAT side.
      // It used to be fixed per attack (punch = rig 'right'), so a rider on your
      // other side was punched at with the far arm swinging into empty air.
      // Locked once rather than re-aimed each frame, so a swing never flips
      // arms halfway through. Nobody near: keep the last side.
      if (this.active.side === undefined) {
        let best = null, bd = Infinity;
        for (const f of others) {
          if (f === this || f.down) continue;
          const ds = Math.abs(f.owner.s - this.owner.s), dl = f.owner.lateral - this.owner.lateral;
          if (ds > ALONGSIDE_LONG || Math.abs(dl) > (a.range || 2) * 1.5) continue;
          const d = Math.hypot(ds, dl);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) this.aimSide = Math.sign((best.owner.lateral - this.owner.lateral) || 1);
        this.active.side = this.aimSide || 1;
      }
      this.anim[a.name] = Math.min(1, this.active.t / (a.cd * 0.7));
      if (!this.active.hit && this.active.t >= a.wind) {
        this.active.hit = true;
        const hit = this.resolve(a, others);
        if (hit.length && a.hold) {
          // A grab takes ONE rider: the nearest one the arc found.
          this._startHold(a, hit[0], hooks);
          hooks.onHit?.(this, [hit[0]], a);
        } else if (hit.length) {
          for (const f of hit) this.applyDamage(a, f, hooks);
          hooks.onHit?.(this, hit, a);
        } else {
          hooks.onMiss?.(this, a);
        }
      }
      if (this.active.t >= (this.active.dur || a.wind + 0.22)) {   // [chain agent] dur
        this.active = null;
      }
    }

    if (this.hold) this._updateHold(dt, hooks);
  }

  // ---- THE HOLD -----------------------------------------------------------
  //
  // Two bikes tied together by an arm. Everything here is expressed as
  // VELOCITY nudges on the owners' own integrators (lateralV, speed), never as
  // position writes: the physics keeps owning where a bike is, so a hold cannot
  // teleport anyone through a rail or a car, and the bike-to-bike contact solver
  // still separates them if the pull overshoots.
  _startHold(a, target, hooks) {
    if (!target || target.hold || target.heldBy) return;
    const side = Math.sign((target.owner.lateral - this.owner.lateral) || 1);
    this.hold = { target, t: 0, side, throwNow: false };
    target.heldBy = this;
    target.breakMeter = 0;
    target.active = null;                  // a grab interrupts their swing
    target.hp = Math.max(0, target.hp - a.dmg * (target.frail || 1));
    target.hitFlash = 0.22;
    target.lastHitBy = this;
    this.combo++;
    this.comboTimer = CFG.COMBO_WINDOW;
    hooks.onGrab?.(this, target);
  }

  _updateHold(dt, hooks) {
    const h = this.hold, tgt = h.target;
    h.t += dt;
    const me = this.owner, them = tgt.owner;
    const ds = them.s - me.s;
    const dl = them.lateral - me.lateral;
    // Broken by distance: one of the bikes braked, crashed or ran off.
    if (tgt.down || Math.abs(ds) > 3.6 || Math.abs(dl) > 3.2) { this._endHold('break', hooks); return; }
    // Broken by the victim: enough struggle presses (or the AI's grit).
    if (tgt.breakMeter >= 1) { this._endHold('break', hooks); return; }

    // PULL to a fixed gap, like a spring with a damper. The victim takes most of
    // it; the holder is dragged a little too, which is what a grab at 90 mph is.
    // A VELOCITY SERVO, not a spring. The first version added `err * k` to
    // lateralV every frame -- an undamped spring -- and MEASURED it pulled the
    // victim straight through the holder (gap 1.19 -> -0.57 m in a second).
    // Driving the RELATIVE lateral velocity toward -err*rate is critically
    // damped by construction: it closes the gap and stops at it.
    const want = h.side * CFG.GRAPPLE_GAP;
    const err = dl - want;
    const relV = (them.lateralV || 0) - (me.lateralV || 0);
    const vWant = THREE.MathUtils.clamp(-err * 3.2, -2.5, 2.5);
    const blend = Math.min(1, 9 * dt);
    const dv0 = (vWant - relV) * blend;
    if (Number.isFinite(them.lateralV)) them.lateralV += dv0 * 0.8;
    if (Number.isFinite(me.lateralV)) me.lateralV -= dv0 * 0.2;
    // match speeds and close the along-road gap: the victim is towed.
    // TOWED: the victim's speed is servoed to the holder's, plus a correction
    // that closes the along-road gap. The first cut added a weak force and the
    // victim fell 3 m behind and out of the hold in 1.2 s (MEASURED).
    const vTow = me.speed - THREE.MathUtils.clamp(ds, -2, 2) * 1.8;
    them.speed += (vTow - them.speed) * Math.min(1, 6 * dt);
    if (them.speed < 0) them.speed = 0;
    // it hurts, and it tires you out
    tgt.hp = Math.max(0, tgt.hp - CFG.GRAPPLE_DPS * dt * (tgt.frail || 1));
    tgt.stamina = Math.max(0, tgt.stamina - 10 * dt);
    this.stamina = Math.max(0, this.stamina - 4 * dt);
    tgt.hitFlash = Math.max(tgt.hitFlash, 0.06);
    if (tgt.hp <= 0) { this._endHold('throw', hooks); return; }
    if (this.collar) { if (h.t >= CFG.COLLAR_HOLD) this._endHold('release', hooks); return; }
    if (h.throwNow && h.t > 0.25) { this._endHold('throw', hooks); return; }
    if (h.t >= CFG.GRAPPLE_HOLD) this._endHold('throw', hooks);
  }

  _endHold(kind, hooks = {}) {
    const holder = this.hold ? this : this.heldBy;
    if (!holder || !holder.hold) { this.heldBy = null; this.hold = null; return; }
    const tgt = holder.hold.target;
    const side = holder.hold.side;
    holder.hold = null;
    tgt.heldBy = null;
    tgt.breakMeter = 0;
    holder.holdEnd = { kind, t: 0, side };
    tgt.holdEnd = { kind: kind === 'throw' ? 'thrown' : 'freed', t: 0, side: -side };
    if (kind === 'throw') {
      // THE THROW: shoved AWAY from the holder, hard, and spun.
      const a = ATTACKS.grapple;
      const mult = 1 + holder.combo * CFG.COMBO_MULT;
      tgt.hp = Math.max(0, tgt.hp - CFG.GRAPPLE_THROW_DMG * mult * (tgt.frail || 1));
      tgt.hitFlash = 0.22;
      tgt.anim.recoil = 1;
      const behind = holder.owner.s < tgt.owner.s ? 1 : -1;
      tgt.owner.applyHit(a.push, { side, dir: behind, along: a.along, yaw: a.yaw, scrub: a.scrub });
      // applyHit's lateral shove is sized for a blow; a throw is a body flung
      // across the road, so it gets the rest of the arm behind it.
      if (Number.isFinite(tgt.owner.lateralV)) tgt.owner.lateralV += side * 2.4;
      // a thrown rider lets go of whatever he was holding -- into your hand
      if (tgt.hasWeapon && !holder.hasWeapon) {
        tgt.hasWeapon = false;
        holder.hasWeapon = true;
        hooks.onSteal?.(holder, tgt);
      }
      hooks.onThrow?.(holder, tgt);
      hooks.onHitImpact?.(holder, tgt, a, side);
      if (tgt.hp <= 0) holder.knockDown(tgt, hooks);
    } else {
      // broken free: a small shove apart so they do not re-grab next frame
      tgt.owner.lateralV += side * 0.9;
      holder.owner.lateralV -= side * 0.4;
      tgt.invuln = Math.max(tgt.invuln, 0.35);
      if (kind === 'release') hooks.onRelease?.(holder, tgt);
      else hooks.onBreak?.(holder, tgt);
    }
  }

  /** One struggle press while held. Five presses in the hold window break it. */
  struggle(amount = CFG.GRAPPLE_BREAK) {
    if (!this.heldBy) return;
    this.breakMeter += amount / (this.heldBy.grip || 1);
    this.stamina = Math.max(0, this.stamina - 2);
  }

  // Arc test: in range, in the forward cone, roughly at the same place along
  // the road. Returns the fighters hit.
  resolve(a, others) {
    const out = [];
    const me = this.owner;
    const fwd = me.forward;
    const yaw = me.yaw;
    for (const f of others) {
      if (f === this || f.down) continue;
      if (a.hold && (f.hold || f.heldBy || f.invuln > 0)) continue;
      const o = f.owner;
      const dx = o.pos.x - me.pos.x;
      const dz = o.pos.z - me.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > a.range) continue;
      if (dist < 0.001) { out.push(f); continue; }
      // angle of the target relative to my forward
      const dot = (dx * fwd.x + dz * fwd.z) / dist;
      const ang = Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
      // the chain sweeps a wider arc, and even reaches slightly behind
      const arc = a.arc + (this.combo * 0.06);
      // BESIDE YOU IS ALWAYS IN REACH. A rider level with you (within FLANK_S
      // along the road) and off to one side is where a punch or a boot goes,
      // whatever the bearing. The pure bearing test missed a rider sitting half
      // a bike behind your hip: the cop holds station 0.5 m back and 1.5 m
      // across (~110 deg off your nose), outside the punch's 106 and the kick's
      // 97, and the player's blows passed through him 23 times in 24 while his
      // own swing -- you are in HIS forward arc -- landed (MEASURED).
      const flank = Math.abs(o.s - me.s) <= FLANK_S && Math.abs(o.lateral - me.lateral) >= 0.4;
      if (ang > arc && !flank) continue;
      // MUST BE ALONGSIDE, not twenty metres up the road. This is the same
      // condition the AI uses to commit (`NPC.ALONGSIDE_LONG`), and it is what
      // stops a swing connecting with a rider far ahead simply because the road
      // curves. It is a LONGITUDINAL gate, deliberately wider than the arc, so an
      // alongside pass -- which is at ~90 degrees and 1-2 m of `s` -- is never
      // rejected here.
      if (Math.abs(o.s - me.s) > ALONGSIDE_LONG) continue;
      out.push(f);
    }
    // a swing hits at most two riders -- the NEAREST two, so a grab takes the
    // rider beside you rather than whoever happened to be first in the list.
    const me2 = this.owner;
    out.sort((a2, b2) => Math.hypot(a2.owner.s - me2.s, a2.owner.lateral - me2.lateral)
      - Math.hypot(b2.owner.s - me2.s, b2.owner.lateral - me2.lateral));
    return out.slice(0, 2);
  }

  applyDamage(a, target, hooks) {
    if (target.invuln > 0) return;
    const mult = 1 + this.combo * CFG.COMBO_MULT;
    let dmg = a.dmg * mult;
    // landing a hit on someone mid-wind-up is a counter: more damage
    if (target.active && !target.active.hit) { dmg *= 1.5; hooks.onCounter?.(this); }
    target.hp = Math.max(0, target.hp - dmg * (target.frail || 1));
    target.hitFlash = 0.22;
    target.anim.recoil = 1;
    target.lastHitBy = this;

    // push the target sideways, and now also along the road and in yaw. The sign
// of the lateral push is which side the blow came from; `dir` is +1 when the
// attacker is BEHIND the target (so a `along` of -0.55 drags the target back
// toward the attacker, which is what a chain swung from behind does).
    const side = Math.sign((target.owner.lateral - this.owner.lateral) || 1);
    const attackerBehind = this.owner.s < target.owner.s ? 1 : -1;
    target.owner.applyHit(a.push, {
      side, dir: attackerBehind,
      along: a.along || 0,
      yaw: a.yaw ?? 0.85,
      scrub: a.scrub ?? 1,
    });
    hooks.onHitImpact?.(this, target, a, side);

    // combo builds on the attacker
    this.combo++;
    this.comboTimer = CFG.COMBO_WINDOW;

    if (a.name === 'chain' && target.hasWeapon && Math.random() < CFG.CHAIN_DISARM) {
      target.hasWeapon = false;
      hooks.onDisarm?.(target);
    }
    // THE ROAD RASH STEAL: knock the weapon out of a rider's hand with your
    // bare fist and it is yours. A disarm that only destroyed the weapon made
    // the fight for it pointless.
    if (a.name === 'punch' && target.hasWeapon && !this.hasWeapon && target.active
        && target.active.kind === 'chain' && !target.active.hit) {
      target.hasWeapon = false;
      this.hasWeapon = true;
      hooks.onSteal?.(this, target);
    }
    if (target.hp <= 0) this.knockDown(target, hooks);
  }

  knockDown(target, hooks) {
    if (target.hold || target.heldBy) target._endHold('break', hooks);
    target.down = true;
    target.downTimer = CFG.WRECK_TIME;
    target.active = null;
    target.owner.speed *= CFG.CRASH_SPEED_LOSS;
    target.owner.yawOffset += (Math.random() - 0.5) * 1.6;
    target.owner.lateral += (Math.random() - 0.5) * 1.2;
    target.invuln = CFG.INVULN_AFTER;
    hooks.onKnockDown?.(this, target);
  }

  /**
   * A FRESH FIGHTER for a new race (or a cop pulling out again). Every field a
   * race can leave behind, including BOTH ends of a hold: a race that ended
   * mid-grab used to start the next one with the player still "held" (every
   * key a struggle, no attacks) or with the cop still holding him.
   */
  resetCombat() {
    if (this.hold && this.hold.target && this.hold.target.heldBy === this) this.hold.target.heldBy = null;
    if (this.heldBy && this.heldBy.hold && this.heldBy.hold.target === this) this.heldBy.hold = null;
    this.hold = null; this.heldBy = null; this.breakMeter = 0; this.holdEnd = null;
    this.hp = this.maxHp; this.stamina = CFG.STAMINA_MAX;
    this.down = false; this.downTimer = 0; this._remountHandled = false;
    this.combo = 0; this.comboTimer = 0; this.active = null;
    this.hitFlash = 0; this.invuln = 0; this.lastHitBy = null;
    for (const k in this.cooldowns) this.cooldowns[k] = 0;
    for (const k in this.anim) this.anim[k] = 0;
  }

  get speedFactor() { return Math.min(1, (this.owner.speed || 0) / 20); }
}