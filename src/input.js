// RideRash — input. Real key, pointer and touch events, so a gate that drives
// the game with events tests the same path a person does.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyJ: 'punch',
  KeyK: 'kick',
  KeyL: 'chain',
  KeyG: 'grapple',
  // NOTE: `Space` is deliberately NOT in this table. It was declared TWICE --
  // once as 'boost' and once as 'brake' -- and a duplicate key in an object
  // literal silently keeps the LAST one, so `KEYMAP.Space` resolved to 'brake'
  // and the string 'boost' never appeared in the map at all. Every
  // `input.attackPressed('boost')` in player.js read a flag nothing ever set,
  // so the boost verb (physics.js `tryBoost`, BOOST_FORCE 3400) was unreachable
  // from the keyboard: pressing Space just braked.
  //
  // Space is now bound to BOOST in EDGE_KEYS, which is what index.html's own
  // key list promises ("<kbd>Space</kbd> boost"). Braking keeps S / ArrowDown
  // (mapped to 'down' above, which `get brake` reads).
  ShiftLeft: 'tuck', ShiftRight: 'tuck',
  KeyR: 'restart',
  Escape: 'pause',
};

// Keys that are handled OUTSIDE the action table. Boost is here because it is an
// edge-triggered verb with its own semantics, like the attacks.
const EDGE_KEYS = {
  Space: 'boost',
  // the agility burst: a sharp sidestep the way you are steering
  KeyE: 'swerve',
};

export class Input {
  constructor(target) {
    this.down = Object.create(null);
    this.pressed = Object.create(null);   // edge, consumed once per frame
    this.released = Object.create(null);
    this.touch = { active: false, x: 0, y: 0, sx: 0, sy: 0, id: null, tap: false };
    this.pointerNdc = { x: 0, y: 0 };
    this.anyInput = false;
    // The canvas-zone scheme below (edges steer, top half throttles). Switched
    // OFF when the on-screen buttons are up: a thumb that slides off GAS onto
    // the road would otherwise start steering or braking on its own.
    this.zones = true;
    // Analog steering from the touch pad (touchpad.js) or a gamepad stick,
    // -1..1. Summed with the keys in `get steer`, so every source is one path.
    this.touchSteer = 0;
    this.padSteer = 0;
    this.tiltSteer = 0;

    this._onKey = (e, isDown) => {
      // Edge-bound keys first (boost). They share the `down`/`pressed` tables
      // with the held actions so `attackPressed('boost')` and any future
      // `input.down.boost` read work without a second code path.
      const edge = EDGE_KEYS[e.code];
      if (edge) {
        if (e.repeat && isDown) { e.preventDefault?.(); return; }
        e.preventDefault?.();
        if (isDown) { if (!this.down[edge]) this.pressed[edge] = true; this.down[edge] = true; }
        else { this.down[edge] = false; this.released[edge] = true; }
        this.anyInput = true;
        return;
      }
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.repeat && isDown) { e.preventDefault?.(); return; }
      e.preventDefault?.();
      if (isDown) { if (!this.down[a]) this.pressed[a] = true; this.down[a] = true; }
      else { this.down[a] = false; this.released[a] = true; }
      this.anyInput = true;
    };

    this._kd = (e) => this._onKey(e, true);
    this._ku = (e) => this._onKey(e, false);
    window.addEventListener('keydown', this._kd, { passive: false });
    window.addEventListener('keyup', this._ku, { passive: false });
    window.addEventListener('blur', () => { this.down = Object.create(null); this.touchSteer = 0; this.padSteer = 0; });

    const el = target || window;

    // Pointer: a click on the left/right edge steers, centre taps attack.
    this._pd = (e) => {
      if (!this.zones) return;
      try { el.setPointerCapture?.(e.pointerId); } catch (err) { /* pointer already gone */ }
      this._setPointer(e);
      this.touch.active = true; this.touch.id = e.pointerId;
      this.touch.sx = e.clientX; this.touch.sy = e.clientY;
      this.anyInput = true;
    };
    this._pm = (e) => { if (this.touch.active) this._setPointer(e); };
    this._pu = (e) => {
      if (e.pointerId !== this.touch.id) return;
      const dx = e.clientX - this.touch.sx, dy = e.clientY - this.touch.sy;
      if (Math.hypot(dx, dy) < 14) this.touch.tap = true;
      this.touch.active = false; this.touch.id = null;
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerdown', this._pd, { passive: true });
    el.addEventListener('pointermove', this._pm, { passive: true });
    el.addEventListener('pointerup', this._pu, { passive: true });
    el.addEventListener('pointercancel', this._pu, { passive: true });

    window.addEventListener('mousemove', (e) => {
      this.pointerNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerNdc.y = -((e.clientY / window.innerHeight) * 2 - 1);
    });

    this._preventScroll = (e) => { if (e.target === el) e.preventDefault(); };
  }

  _setPointer(e) {
    this.touch.x = e.clientX; this.touch.y = e.clientY;
  }

  // Actions, from keys or pointer/touch, in one place.
  get throttle() { return this.down.up || this._touchTop(); }
  // Brake reads the dedicated brake keys, not Space. Space is the BOOST verb --
  // see EDGE_KEYS and the note above KEYMAP; the on-screen key list in
  // index.html documents `<kbd>Space</kbd> boost`, so Space braking was the
  // duplicate-key accident, not the design.
  get brake()    { return this.down.down || this.down.brakeKey || this._touchBottom(); }
  get tuck()     { return !!this.down.tuck; }
  get steer() {
    let s = 0;
    if (this.down.left) s -= 1;
    if (this.down.right) s += 1;
    s += this.touchSteer + this.padSteer + this.tiltSteer;
    if (this.touch.active) {
      const edge = window.innerWidth * 0.28;
      if (this.touch.x < edge) s -= 1;
      else if (this.touch.x > window.innerWidth - edge) s += 1;
    }
    return Math.max(-1, Math.min(1, s));
  }

  _touchTop()    { return this.touch.active && this.touch.y < window.innerHeight * 0.55 && this._notSteerEdge(); }
  _touchBottom() { return this.touch.active && this.touch.y >= window.innerHeight * 0.55 && this._notSteerEdge(); }
  _notSteerEdge() {
    const edge = window.innerWidth * 0.28;
    return this.touch.x >= edge && this.touch.x <= window.innerWidth - edge;
  }

  attackPressed(kind) { return !!this.pressed[kind]; }

  // Called once at the end of every frame.
  endFrame() {
    this.pressed = Object.create(null);
    this.released = Object.create(null);
    this.touch.tap = false;
  }

  // For any tap/click that means "start" / "continue": the game reads this even
  // when a menu is up.
  consumeTap() { const t = this.touch.tap; this.touch.tap = false; return t; }

  get startSignal() { return !!this.pressed.up || !!this.pressed.punch || this.touch.tap || this._clicked; }
  set clicked(v) { this._clicked = v; }
  get clicked() { return this._clicked; }
}