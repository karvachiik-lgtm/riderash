// RideRash — instant replay: the whole race, from any angle.
//
// WHAT IS RECORDED. The simulation is not deterministic (every brain, the
// traffic and the animals draw Math.random), so replaying the INPUTS would not
// reproduce the race. What is recorded is what was on screen: the transform of
// every rider, bike and joint, and of the traffic, the animals and the starter,
// 15 times a second, interpolated back (lerp / slerp) to smooth motion. A replay
// is then exact -- crashes, ragdolls, throws -- because it is a recording of the
// result, not a re-run of the cause.
//
// WHAT IT COSTS. Only what is near the player is kept (riders within 320 m,
// vehicles and animals within 260 m): a far rider is invisible anyway. Angles are
// quantised to 16-bit quaternions (8 bytes) and positions kept as float32. A
// sample is ~1.5-2.5 KB, so ~25-35 KB/s: a 4-minute race is 6-8 MB -- smaller
// than one texture, fine on a phone. The store is capped (32 MB desktop, 16 MB
// on touch devices) and, if a very long race ever reached it, drops the oldest
// second first. `stats()` reports the real numbers.
//
// HIGHLIGHTS. While the race runs, the game logs events (hits, knockdowns,
// wrecks, T-bones, animal strikes, busts, near misses, big air...), each with a
// weight and the rider it concerns. Events closer than 2.5 s are one MOMENT; a
// moment's score is its weights summed, doubled when it involves the player.
// The best five become clips (2.5 s before to 2 s after), played in race order
// with a slow-motion beat at each one's peak and the broadcast camera cutting.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';
import { edgeAt } from './lanes.js';

const RATE = 15;                        // samples per second
const CHUNK = 1 << 20;                  // 1 MB storage blocks
const NEAR_RIDER = 320, NEAR_THING = 260;
const QS = 32767;

const RIDER_JOINTS = (j) => {
  const out = [j.pelvis, j.torso, j.neck, j.head];
  for (const side of ['left', 'right']) {
    const A = j[side + 'Arm'] || (j.arms && j.arms[side]);
    if (A) out.push(A.shoulder, A.upper, A.elbow, A.fore);
    const L = j[side + 'Leg'] || (j.legs && j.legs[side]);
    if (L) out.push(L.hip, L.thigh, L.knee, L.shin);
  }
  return out.filter((n) => n && n.isObject3D);
};
const BIKE_JOINTS = (b) => {
  const j = b && b.userData && b.userData.joints;
  return j ? [j.frontSteer, j.frontWheel, j.rearWheel, j.swing].filter((n) => n && n.isObject3D) : [];
};

const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _v = new THREE.Vector3(), _va = new THREE.Vector3(), _vb = new THREE.Vector3();

// ---- low-level codec --------------------------------------------------------
function wq(dv, o, q) {
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  dv.setInt16(o, Math.round(x * QS), true); dv.setInt16(o + 2, Math.round(y * QS), true);
  dv.setInt16(o + 4, Math.round(z * QS), true); dv.setInt16(o + 6, Math.round(w * QS), true);
  return o + 8;
}
function rq(dv, o, q) {
  q.set(dv.getInt16(o, true) / QS, dv.getInt16(o + 2, true) / QS, dv.getInt16(o + 4, true) / QS, dv.getInt16(o + 6, true) / QS).normalize();
  return o + 8;
}
function wv(dv, o, v) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); return o + 12; }
function rv(dv, o, v) { v.set(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)); return o + 12; }

// Event weights and colours, by kind
export const EV = {
  crash: { w: 4, col: '#ff5142' },
  hit:   { w: 1.2, col: '#ffb13b' },
  grab:  { w: 2.5, col: '#ffb13b' },
  cop:   { w: 3, col: '#5b8cff' },
  good:  { w: 1, col: '#4fe08e' },
  air:   { w: 1.2, col: '#7fc9ff' },
  finish:{ w: 2, col: '#ffffff' },
};

// Control icons: drawn, one stroke weight, currentColor -- the emoji glyphs
// (⏪ ⏩ ◀ ▶) rendered as coloured system emoji and read as clip art.
const svgI = (d, fill = false) => `<svg class="rp-i" viewBox="0 0 24 24" aria-hidden="true">${fill ? d : `<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</g>`}</svg>`;
const ICON = {
  play: svgI('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>', true),
  pause: svgI('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>', true),
  back: svgI('<path d="M11 6 5 12l6 6"/><path d="M19 6l-6 6 6 6"/>'),
  fwd: svgI('<path d="M13 6l6 6-6 6"/><path d="M5 6l6 6-6 6"/>'),
  prev: svgI('<path d="M15 5l-7 7 7 7"/>'),
  next: svgI('<path d="M9 5l7 7-7 7"/>'),
};

export class Replay {
  /** `scene`: the world root (detached bikes and riders live there). */
  constructor(scene, camera, host, hooks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.hooks = hooks;             // { render(), followSun(pos), onExit(from) }
    this.slots = [];
    this.active = false;
    this.cap = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ? 16 << 20 : 32 << 20;
    this._reset();
    this._ui(host);
  }

  _reset() {
    this.chunks = [];
    this.times = []; this.sChunk = []; this.sOff = [];
    this.clock = 0; this.nextAt = 0; this.bytes = 0;
    this.events = [];
    this.recording = false;
  }

  // ======================================================================
  // RECORDING
  // ======================================================================
  /**
   * New race: what to record. riders: [{name, group, bike, rider, phys, fighter}]
   * cars / crossCars / animals: arrays of Object3D; flagger: {group, body, joints}
   */
  begin({ riders = [], cars = [], crossCars = [], animals = [], flagger = null }) {
    this._reset();
    this.slots = [];
    this.byFighter = new Map();
    for (const r of riders) {
      if (!r || !r.group) continue;
      const rj = r.rider && r.rider.userData && r.rider.userData.joints;
      const slot = { kind: 1, name: r.name, group: r.group, bike: r.bike || null, rider: r.rider || null, phys: r.phys,
        joints: rj ? RIDER_JOINTS(rj) : [], bjoints: BIKE_JOINTS(r.bike), chain: rj && rj.chain, pelvis: rj && rj.pelvis,
        // where each lives when riding (the rider sits in a seat socket, not in
        // the group): only the scene root counts as "detached" (a crash, on foot)
        riderHome: r.rider ? r.rider.parent : null, bikeHome: r.bike ? r.bike.parent : null };
      slot.max = 3 + 20 + 20 + 20 + 20 + 12 + 8 * (slot.joints.length + slot.bjoints.length);
      if (r.fighter) this.byFighter.set(r.fighter, this.slots.length);
      this.slots.push(slot);
    }
    for (const c of cars) this.slots.push({ kind: 2, obj: c, max: 23 });
    for (const c of crossCars) this.slots.push({ kind: 2, obj: c, max: 23 });
    for (const a of animals) {
      const u = a.userData || {};
      const js = [];
      for (const leg of u.legs || []) { js.push(leg); if (leg.userData && leg.userData.knee) js.push(leg.userData.knee); }
      for (const n of [u.head, u.skull, u.jaw, u.tail]) if (n && n.isObject3D) js.push(n);
      this.slots.push({ kind: 3, obj: a, joints: js, max: 23 + 8 * js.length });
    }
    if (flagger && flagger.group) {
      const js = flagger.joints ? RIDER_JOINTS(flagger.joints) : [];
      this.slots.push({ kind: 4, obj: flagger.group, body: flagger.body, joints: js, max: 43 + 8 * js.length });
    }
    this.maxSample = 8 + this.slots.reduce((a, s) => a + s.max, 0);
    this.recording = true;
  }

  /** Called every simulated frame. `focus`: the player's world position. */
  capture(dt, focus) {
    if (!this.recording || this.active) return;
    this.clock += dt;
    if (this.clock < this.nextAt) return;
    this.nextAt = this.clock + 1 / RATE;
    this._writeSample(this.clock, focus, false);
  }

  /** A moment worth remembering. `fighter` (optional) picks the rider it concerns. */
  event(kind, label, fighter = null, weight = null) {
    if (!this.recording) return;
    const slot = fighter != null && this.byFighter ? (this.byFighter.get(fighter) ?? 0) : 0;
    this.events.push({ t: this.clock, kind, label, slot, w: weight ?? (EV[kind] ? EV[kind].w : 1) });
  }

  stop() { this.recording = false; }

  stats() {
    const dur = this.times.length ? this.times[this.times.length - 1] - this.times[0] : 0;
    return { samples: this.times.length, seconds: dur, bytes: this.bytes, perSecond: dur > 0 ? this.bytes / dur : 0, events: this.events.length };
  }

  _alloc(need) {
    let c = this.chunks[this.chunks.length - 1];
    if (!c || c.used + need > CHUNK) {
      c = { buf: new ArrayBuffer(CHUNK), used: 0 };
      c.dv = new DataView(c.buf);
      this.chunks.push(c);
      // over the cap: drop the oldest block and every sample in it
      while (this.chunks.length * CHUNK > this.cap && this.chunks.length > 2) {
        const dead = this.chunks.shift();
        let k = 0;
        while (k < this.sChunk.length && this.sChunk[k] === dead) k++;
        this.times.splice(0, k); this.sChunk.splice(0, k); this.sOff.splice(0, k);
        this.bytes -= dead.used;
        const t0 = this.times[0] ?? 0;
        this.events = this.events.filter((e) => e.t >= t0);
      }
    }
    return c;
  }

  _writeSample(t, focus, all, into = null) {
    const c = into || this._alloc(this.maxSample);
    const dv = c.dv;
    let o = c.used;
    const start = o;
    dv.setFloat32(o, t, true); o += 4;
    const countAt = o; o += 2;
    let count = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.kind === 1) {
        const g = s.group;
        if (!all) {
          const off = s.rider && s.rider.parent === this.scene;
          if (!g.visible && !(off && s.rider.visible)) continue;
          if (focus && (off ? s.rider.position : g.position).distanceTo(focus) > NEAR_RIDER) continue;
        }
        const rIn = !!(s.rider && s.rider.parent === this.scene), bIn = !!(s.bike && s.bike.parent === this.scene);
        let flags = (g.visible ? 1 : 0) | (s.rider && s.rider.visible ? 2 : 0) | (s.bike && s.bike.visible ? 4 : 0)
          | (s.chain && s.chain.visible ? 8 : 0) | (rIn ? 16 : 0) | (bIn ? 32 : 0);
        dv.setUint16(o, i, true); o += 2;
        dv.setUint8(o, flags); o += 1;
        const p = s.phys;
        const focusPos = rIn ? s.rider.position : g.position;
        dv.setFloat32(o, p ? p.s : 0, true); o += 4;
        dv.setFloat32(o, p && Number.isFinite(p.yaw) ? p.yaw : g.rotation.y, true); o += 4;
        o = wv(dv, o, focusPos);
        o = wv(dv, o, g.position); o = wq(dv, o, g.quaternion);
        if (s.bike) { o = wv(dv, o, s.bike.position); o = wq(dv, o, s.bike.quaternion); }
        if (s.rider) { o = wv(dv, o, s.rider.position); o = wq(dv, o, s.rider.quaternion); }
        if (s.pelvis) o = wv(dv, o, s.pelvis.position);
        for (const n of s.joints) o = wq(dv, o, n.quaternion);
        for (const n of s.bjoints) o = wq(dv, o, n.quaternion);
      } else {
        const ob = s.obj;
        if (!all) {
          if (!ob.visible) continue;
          if (focus && ob.getWorldPosition(_v).distanceTo(focus) > NEAR_THING) continue;
        }
        dv.setUint16(o, i, true); o += 2;
        dv.setUint8(o, ob.visible ? 1 : 0); o += 1;
        o = wv(dv, o, ob.position); o = wq(dv, o, ob.quaternion);
        if (s.kind === 4 && s.body) { o = wv(dv, o, s.body.position); o = wq(dv, o, s.body.quaternion); }
        if (s.joints) for (const n of s.joints) o = wq(dv, o, n.quaternion);
      }
      count++;
    }
    dv.setUint16(countAt, count, true);
    c.used = o;
    if (!into) {
      this.times.push(t); this.sChunk.push(c); this.sOff.push(start);
      this.bytes += o - start;
    }
    return o - start;
  }

  /** Map slot index -> byte offset, for one stored sample. */
  _index(k, out) {
    out.clear();
    const c = this.sChunk[k], dv = c.dv;
    let o = this.sOff[k] + 4;
    const n = dv.getUint16(o, true); o += 2;
    for (let i = 0; i < n; i++) {
      const id = dv.getUint16(o, true);
      out.set(id, o);
      o += this._slotBytes(this.slots[id]);
    }
    out.dv = dv;
    return out;
  }
  _slotBytes(s) {
    if (s.kind === 1) return 3 + 8 + 12 + 20 + (s.bike ? 20 : 0) + (s.rider ? 20 : 0) + (s.pelvis ? 12 : 0) + 8 * (s.joints.length + s.bjoints.length);
    return 3 + 20 + (s.kind === 4 && s.body ? 20 : 0) + 8 * (s.joints ? s.joints.length : 0);
  }

  // ======================================================================
  // PLAYBACK
  // ======================================================================
  get duration() { return this.times.length ? this.times[this.times.length - 1] : 0; }
  get start() { return this.times.length ? this.times[0] : 0; }

  _parentFor(obj, inScene, home) {
    const want = inScene ? this.scene : (home || obj.parent);
    if (obj.parent !== want) {
      if (!this._moved.has(obj)) this._moved.set(obj, obj.parent);
      want.add(obj);
    }
  }

  /** Put the world at time t (interpolated). Returns the focus info per slot. */
  seek(t) {
    const T = this.times;
    if (!T.length) return;
    t = Math.max(T[0], Math.min(T[T.length - 1], t));
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    const f = hi > lo ? (t - T[lo]) / (T[hi] - T[lo]) : 0;
    this._ia = this._index(lo, this._ia || new Map());
    this._ib = this._index(hi, this._ib || new Map());
    this._applyPair(this._ia, this._ib, Math.max(0, Math.min(1, f)));
    this.t = t;
  }

  _applyPair(A, B, f) {
    this.focus = this.focus || [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const oa = A.get(i), ob = B.get(i);
      const obj = s.kind === 1 ? s.group : s.obj;
      if (oa === undefined && ob === undefined) {
        obj.visible = false;
        if (s.kind === 1) {
          if (s.rider && s.rider.parent === this.scene) s.rider.visible = false;
          if (s.bike && s.bike.parent === this.scene) s.bike.visible = false;
        }
        this.focus[i] = null;
        continue;
      }
      // present in only one: hold it (no interpolation partner)
      const da = oa !== undefined ? A.dv : B.dv, db = ob !== undefined ? B.dv : A.dv;
      let pa = oa !== undefined ? oa : ob, pb = ob !== undefined ? ob : oa;
      const k = oa !== undefined && ob !== undefined ? f : 0;
      const flags = (k < 0.5 ? da : db).getUint8((k < 0.5 ? pa : pb) + 2);
      pa += 3; pb += 3;
      if (s.kind === 1) {
        const fo = this.focus[i] || (this.focus[i] = { pos: new THREE.Vector3(), s: 0, yaw: 0, name: s.name });
        fo.s = da.getFloat32(pa, true) + (db.getFloat32(pb, true) - da.getFloat32(pa, true)) * k;
        let ya = da.getFloat32(pa + 4, true), yb = db.getFloat32(pb + 4, true);
        yb = ya + Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya));
        fo.yaw = ya + (yb - ya) * k;
        pa += 8; pb += 8;
        pa = rv(da, pa, _va); pb = rv(db, pb, _vb); fo.pos.lerpVectors(_va, _vb, k);
        const g = s.group;
        g.visible = !!(flags & 1);
        pa = rv(da, pa, _va); pb = rv(db, pb, _vb); g.position.lerpVectors(_va, _vb, k);
        pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); g.quaternion.slerpQuaternions(_qa, _qb, k);
        if (s.bike) {
          this._parentFor(s.bike, !!(flags & 32), s.bikeHome);
          s.bike.visible = !!(flags & 4);
          pa = rv(da, pa, _va); pb = rv(db, pb, _vb); s.bike.position.lerpVectors(_va, _vb, k);
          pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); s.bike.quaternion.slerpQuaternions(_qa, _qb, k);
        }
        if (s.rider) {
          this._parentFor(s.rider, !!(flags & 16), s.riderHome);
          s.rider.visible = !!(flags & 2);
          pa = rv(da, pa, _va); pb = rv(db, pb, _vb); s.rider.position.lerpVectors(_va, _vb, k);
          pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); s.rider.quaternion.slerpQuaternions(_qa, _qb, k);
        }
        if (s.pelvis) { pa = rv(da, pa, _va); pb = rv(db, pb, _vb); s.pelvis.position.lerpVectors(_va, _vb, k); }
        for (const n of s.joints) { pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); n.quaternion.slerpQuaternions(_qa, _qb, k); }
        for (const n of s.bjoints) { pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); n.quaternion.slerpQuaternions(_qa, _qb, k); }
        if (s.chain) s.chain.visible = !!(flags & 8);
      } else {
        obj.visible = !!(flags & 1);
        pa = rv(da, pa, _va); pb = rv(db, pb, _vb); obj.position.lerpVectors(_va, _vb, k);
        pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); obj.quaternion.slerpQuaternions(_qa, _qb, k);
        if (s.kind === 4 && s.body) {
          pa = rv(da, pa, _va); pb = rv(db, pb, _vb); s.body.position.lerpVectors(_va, _vb, k);
          pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); s.body.quaternion.slerpQuaternions(_qa, _qb, k);
        }
        if (s.joints) for (const n of s.joints) { pa = rq(da, pa, _qa); pb = rq(db, pb, _qb); n.quaternion.slerpQuaternions(_qa, _qb, k); }
      }
    }
  }

  // ---- highlights -----------------------------------------------------------
  highlights(max = 5) {
    const ev = [...this.events].sort((a, b) => a.t - b.t);
    const groups = [];
    for (const e of ev) {
      const g = groups[groups.length - 1];
      if (g && e.t - g.t1 < 2.5) { g.t1 = e.t; g.ev.push(e); }
      else groups.push({ t0: e.t, t1: e.t, ev: [e] });
    }
    for (const g of groups) {
      g.score = g.ev.reduce((a, e) => a + e.w * (e.slot === 0 ? 2 : 1), 0);
      const top = g.ev.reduce((a, e) => (e.w > a.w ? e : a), g.ev[0]);
      g.peak = top.t; g.slot = top.slot; g.label = top.label; g.kind = top.kind;
      g.a = Math.max(this.start, g.t0 - 2.5); g.b = Math.min(this.duration, g.t1 + 2);
    }
    return groups.sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.a - b.a);
  }

  // ======================================================================
  // THE VIEWER
  // ======================================================================
  /** Open the viewer. mode 'full' | 'highlights'; from: who to hand back to. */
  enter(mode = 'full', from = 'pause') {
    if (!this.times.length) return false;
    this.from = from;
    this.active = true;
    this._moved = new Map();
    // the world as it is now, to put back exactly on exit
    const lc = { buf: new ArrayBuffer(this.maxSample + 64), used: 0 };
    lc.dv = new DataView(lc.buf);
    this._writeSample(0, null, true, lc);
    this._live = lc;
    const cam = this.camera;
    this._cam = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
    this.speed = 1; this.playing = true;
    this.camMode = 'chase'; this.target = 0;
    this._orbit = { az: 0.6, el: 0.25, r: 7, auto: true };
    this._tv = null;
    this.clips = mode === 'highlights' ? this.highlights() : null;
    this.clip = 0;
    if (this.clips && !this.clips.length) this.clips = null;
    this.mode = this.clips ? 'highlights' : 'full';
    this.t = this.clips ? this.clips[0].a : Math.max(this.start, this.duration - 12);
    if (this.clips) { this.target = this.clips[0].slot; this.camMode = 'tv'; }
    this.el.classList.add('on');
    this._buildMarkers();
    this._syncUi();
    this.seek(this.t);
    return true;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    // parents back, then every transform and visibility as it was
    for (const [obj, parent] of this._moved) parent.add(obj);
    this._moved.clear();
    const L = this._live;
    const idx = new Map();
    let o = 4; const n = L.dv.getUint16(o, true); o += 2;
    for (let i = 0; i < n; i++) { const id = L.dv.getUint16(o, true); idx.set(id, o); o += this._slotBytes(this.slots[id]); }
    idx.dv = L.dv;
    this._applyPair(idx, idx, 0);
    for (const [obj, parent] of this._moved) parent.add(obj);   // (the live state's own parents)
    this._moved.clear();
    const cam = this.camera;
    cam.position.copy(this._cam.p); cam.quaternion.copy(this._cam.q); cam.fov = this._cam.fov; cam.updateProjectionMatrix();
    this.el.classList.remove('on');
    if (this.hooks.onExit) this.hooks.onExit(this.from);
  }

  /** Per real frame while open. */
  update(rdt) {
    if (!this.active) return;
    let spd = this.speed;
    if (this.mode === 'highlights' && this.clips) {
      const c = this.clips[this.clip];
      // the beat: slow motion around the peak of the moment
      if (Math.abs(this.t - c.peak) < 0.8) spd *= 0.35;
      if (this.playing) this.t += rdt * spd;
      if (this.t >= c.b) {
        this.clip++;
        if (this.clip >= this.clips.length) { this.clip = 0; }
        const n = this.clips[this.clip];
        this.t = n.a; this.target = n.slot; this._tv = null;
        this.camMode = this.clip % 2 ? 'orbit' : 'tv';
        this._syncUi();
      }
    } else if (this.playing) {
      this.t += rdt * spd;
      if (this.t >= this.duration) { this.t = this.duration; this.playing = false; this._syncUi(); }
    }
    this.seek(this.t);
    this._camera(rdt);
    this._timeUi();
  }

  _focus() {
    let f = this.focus && this.focus[this.target];
    if (!f) {
      // the chosen rider is not in the recording here: fall back to the player
      f = this.focus && this.focus[0];
    }
    return f;
  }

  _camera(rdt) {
    const f = this._focus();
    if (!f) return;
    const cam = this.camera;
    const fwd = _v.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    const P = f.pos;
    const k = Math.min(1, rdt * 6);
    const want = new THREE.Vector3(), look = new THREE.Vector3(P.x, P.y + 1.1, P.z);
    let fov = 60;
    switch (this.camMode) {
      case 'heli':
        want.set(P.x - fwd.x * 16, P.y + 20, P.z - fwd.z * 16); fov = 50; break;
      case 'orbit': {
        const O = this._orbit;
        if (O.auto && this.playing) O.az += rdt * 0.35;   // paused: hold still for a look
        want.set(P.x + Math.sin(O.az) * Math.cos(O.el) * O.r, P.y + 1 + Math.sin(O.el) * O.r, P.z + Math.cos(O.az) * Math.cos(O.el) * O.r);
        fov = 55; break;
      }
      case 'onboard':
        want.set(P.x + fwd.x * 0.35, P.y + 1.55, P.z + fwd.z * 0.35);
        look.set(P.x + fwd.x * 30, P.y + 1.2, P.z + fwd.z * 30); fov = 72; break;
      case 'tv': {
        // a camera on the verge ahead; cut to the next one once they are past
        if (!this._tv || f.s > this._tv.s + 18 || f.s < this._tv.s - 90) {
          const side = this._tv ? -this._tv.side : 1;
          const s = f.s + 55 + Math.random() * 20;
          const c = centreAt(-s, new THREE.Vector3()), tg = centreTangent(-s, new THREE.Vector3());
          const nx = tg.z, nz = -tg.x;
          const lat = side * (edgeAt(Math.max(0, s), side) + 4);
          this._tv = { s, side, pos: new THREE.Vector3(c.x + nx * lat, c.y + 1.6 + Math.random() * 2.2, c.z + nz * lat) };
          cam.position.copy(this._tv.pos);
        }
        want.copy(this._tv.pos);
        const d = want.distanceTo(P);
        fov = THREE.MathUtils.clamp(2 * Math.atan(5 / Math.max(1, d)) * 180 / Math.PI, 9, 55);
        break;
      }
      default: // chase
        want.set(P.x - fwd.x * 6.5, P.y + 2.4, P.z - fwd.z * 6.5); fov = 62;
    }
    if (this.camMode === 'tv') cam.position.copy(want);
    else cam.position.lerp(want, this.camMode === 'onboard' ? 1 : k);
    cam.lookAt(look);
    cam.fov += (fov - cam.fov) * Math.min(1, rdt * 4);
    cam.updateProjectionMatrix();
    if (this.hooks.followSun) this.hooks.followSun(P);
  }

  // ---- UI ---------------------------------------------------------------------
  _ui(host) {
    const el = this.el = document.createElement('div');
    el.id = 'replay';
    el.innerHTML = `
      <div class="rp-view"></div>
      <div class="rp-badge"><i></i>REPLAY <span class="rp-mode"></span></div>
      <div class="rp-clip"></div>
      <div class="rp-hint">PAUSED · drag to rotate · scroll / pinch to zoom · shift + ← → one frame</div>
      <div class="rp-bar">
        <div class="rp-row">
          <button class="rp-b rp-play" title="Play / pause (Space)" aria-label="Play or pause">${ICON.pause}</button>
          <button class="rp-b rp-back" title="Back 5 s (←)" aria-label="Back 5 seconds">${ICON.back}</button><button class="rp-b rp-fwd" title="Forward 5 s (→)" aria-label="Forward 5 seconds">${ICON.fwd}</button>
          <div class="rp-tl"><div class="rp-marks"></div><input type="range" class="rp-seek" min="0" max="1000" step="1" aria-label="Replay timeline"></div>
          <span class="rp-time">0:00</span>
        </div>
        <div class="rp-row rp-ctl">
          <span class="rp-grp rp-speeds">${[0.25, 0.5, 1, 2].map((s) => `<button class="rp-b" data-speed="${s}">${s}×</button>`).join('')}</span>
          <span class="rp-grp rp-cams">${['chase', 'tv', 'heli', 'orbit', 'onboard'].map((c) => `<button class="rp-b" data-cam="${c}">${c.toUpperCase()}</button>`).join('')}</span>
          <span class="rp-grp rp-who"><button class="rp-b" data-who="-1" aria-label="Previous rider">${ICON.prev}</button><span class="rp-name">YOU</span><button class="rp-b" data-who="1" aria-label="Next rider">${ICON.next}</button></span>
          <span class="rp-grp"><button class="rp-b rp-hl">HIGHLIGHTS</button><button class="rp-b rp-exit">EXIT</button></span>
        </div>
      </div>`;
    host.appendChild(el);
    const $ = (s) => el.querySelector(s);
    this.ui = { play: $('.rp-play'), seek: $('.rp-seek'), time: $('.rp-time'), name: $('.rp-name'), marks: $('.rp-marks'),
      mode: $('.rp-mode'), clip: $('.rp-clip'), hl: $('.rp-hl'), view: $('.rp-view') };
    this.ui.play.addEventListener('click', () => { this.playing = !this.playing; if (this.playing && this.t >= this.duration) this.t = this.start; this._syncUi(); });
    this.ui.seek.addEventListener('input', () => {
      const v = +this.ui.seek.value / 1000;
      this.t = this.start + v * (this.duration - this.start);
      if (this.mode === 'highlights') { this.mode = 'full'; this.clips = null; }
      this._syncUi();
    });
    el.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { this.speed = +b.dataset.speed; this._syncUi(); }));
    el.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => { this.camMode = b.dataset.cam; this._tv = null; this._syncUi(); }));
    el.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => this._cycle(+b.dataset.who)));
    this.ui.hl.addEventListener('click', () => {
      if (this.mode === 'highlights') { this.mode = 'full'; this.clips = null; }
      else { this.clips = this.highlights(); this.clip = 0; if (this.clips.length) { this.mode = 'highlights'; this.t = this.clips[0].a; this.target = this.clips[0].slot; this.camMode = 'tv'; this._tv = null; } else this.clips = null; }
      this.playing = true; this._syncUi();
    });
    $('.rp-exit').addEventListener('click', () => this.exit());
    $('.rp-back').addEventListener('click', () => { this.t = Math.max(this.start, this.t - 5); });
    $('.rp-fwd').addEventListener('click', () => { this.t = Math.min(this.duration, this.t + 5); });
    // orbit: drag to turn, wheel / pinch to zoom
    const v = this.ui.view, pts = new Map();
    v.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); v.setPointerCapture(e.pointerId);
      if (this.camMode !== 'orbit') {
        // start the orbit from where the camera is now, so grabbing it does not jump
        const f = this._focus();
        if (f) { const d = this.camera.position.clone().sub(f.pos); this._orbit.r = THREE.MathUtils.clamp(d.length(), 2.5, 40); this._orbit.az = Math.atan2(d.x, d.z); this._orbit.el = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp((d.y - 1) / this._orbit.r, -1, 1)), -0.05, 1.35); }
        this.camMode = 'orbit';
      }
      this._orbit.auto = false; this._syncUi(); });
    v.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { this._orbit.az -= (e.clientX - p.x) * 0.008; this._orbit.el = THREE.MathUtils.clamp(this._orbit.el + (e.clientY - p.y) * 0.006, -0.05, 1.35); }
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const [c, d] = [...pts.values()]; const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        if (d0 > 0) this._orbit.r = THREE.MathUtils.clamp(this._orbit.r * d0 / d1, 2.5, 40);
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e) => pts.delete(e.pointerId);
    v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', (e) => { e.preventDefault(); this._orbit.r = THREE.MathUtils.clamp(this._orbit.r * (1 + Math.sign(e.deltaY) * 0.1), 2.5, 40); this._orbit.auto = false; }, { passive: false });
    // keys, ahead of the game's own handlers while the viewer is open
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const k = e.code;
      let used = true;
      if (k === 'Space') { this.playing = !this.playing; }
      else if (k === 'ArrowLeft') this.t -= e.shiftKey ? 1 / RATE : 3;
      else if (k === 'ArrowRight') this.t += e.shiftKey ? 1 / RATE : 3;
      else if (k === 'KeyC') { const C = ['chase', 'tv', 'heli', 'orbit', 'onboard']; this.camMode = C[(C.indexOf(this.camMode) + 1) % C.length]; this._tv = null; }
      else if (k === 'KeyT' || k === 'ArrowUp' || k === 'ArrowDown') this._cycle(k === 'ArrowUp' ? -1 : 1);
      else if (k === 'KeyH') this.ui.hl.click();
      else if (k === 'Escape' || k === 'KeyP') this.exit();
      else if (/^Digit[1-5]$/.test(k)) { this.camMode = ['chase', 'tv', 'heli', 'orbit', 'onboard'][+k.slice(5) - 1]; this._tv = null; }
      else used = false;
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); this._syncUi(); }
    }, true);
    // key-UPS are NOT swallowed: a throttle released while watching must reach
    // the game's input, or the bike comes back from the replay still accelerating
  }

  _cycle(d) {
    const riders = this.slots.map((s, i) => (s.kind === 1 && this.focus && this.focus[i] ? i : -1)).filter((i) => i >= 0);
    if (!riders.length) return;
    const at = Math.max(0, riders.indexOf(this.target));
    this.target = riders[(at + d + riders.length) % riders.length];
    this._tv = null;
    this._syncUi();
  }

  _buildMarkers() {
    const M = this.ui.marks;
    M.innerHTML = '';
    const a = this.start, span = Math.max(0.001, this.duration - a);
    for (const e of this.events) {
      const i = document.createElement('i');
      i.style.left = ((e.t - a) / span * 100).toFixed(2) + '%';
      i.style.background = (EV[e.kind] || EV.good).col;
      if (e.w >= 3) i.className = 'big';
      i.title = e.label;
      M.appendChild(i);
    }
  }

  _syncUi() {
    const u = this.ui;
    { const k = this.playing ? 'pause' : 'play'; if (u.play.dataset.i !== k) { u.play.dataset.i = k; u.play.innerHTML = ICON[k]; } }
    this.el.classList.toggle('paused', !this.playing);
    this.el.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('sel', +b.dataset.speed === this.speed));
    this.el.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('sel', b.dataset.cam === this.camMode));
    const s = this.slots[this.target];
    u.name.textContent = s && s.name ? s.name : 'YOU';
    u.hl.classList.toggle('sel', this.mode === 'highlights');
    u.mode.textContent = this.mode === 'highlights' && this.clips ? `HIGHLIGHT ${this.clip + 1}/${this.clips.length}` : '';
    if (this.mode === 'highlights' && this.clips) {
      const c = this.clips[this.clip], who = this.slots[c.slot] && this.slots[c.slot].name;
      u.clip.innerHTML = `<b>${c.kind === 'crash' ? 'RACE INCIDENT' : c.kind === 'cop' ? 'POLICE' : c.kind === 'hit' || c.kind === 'grab' ? 'BRAWL' : 'MOMENT'}:</b> ${c.label}${who ? ` <span>· ${who}</span>` : ''}`;
    } else u.clip.textContent = '';
    u.clip.classList.toggle('on', !!(this.mode === 'highlights' && this.clips));
  }

  _timeUi() {
    const u = this.ui, a = this.start, span = Math.max(0.001, this.duration - a);
    if (document.activeElement !== u.seek) u.seek.value = String(Math.round((this.t - a) / span * 1000));
    const s = Math.max(0, this.t - a), m = Math.floor(s / 60);
    const tot = Math.max(0, this.duration - a);
    const txt = `${m}:${String(Math.floor(s % 60)).padStart(2, '0')} / ${Math.floor(tot / 60)}:${String(Math.floor(tot % 60)).padStart(2, '0')}`;
    if (u.time.textContent !== txt) u.time.textContent = txt;
  }
}
