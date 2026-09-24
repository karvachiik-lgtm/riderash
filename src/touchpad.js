// RideRash — on-screen controls for touch devices.
//
// The canvas-zone scheme in input.js (edges steer, top half throttles) allows
// ONE action per finger and has no way to attack, so a phone could steer or
// accelerate but never both, and never fight. These are real buttons, one per
// action, each tracking its own pointer, so any combination can be held at once.
//
// Every button writes into the SAME `down` / `pressed` tables the keyboard
// fills, so the game reads one input path whatever the device. The table below
// is the whole keyboard's riding vocabulary (see KEYMAP/EDGE_KEYS in input.js):
// if a verb is added there and not here, a phone cannot perform it.
const LAYOUT = [
  // id, label, action, edge-triggered?
  ['tp-gas', 'GAS', 'up', false],
  ['tp-brake', 'BRAKE', 'down', false],
  ['tp-punch', 'PUNCH', 'punch', true],
  ['tp-kick', 'KICK', 'kick', true],
  ['tp-chain', 'CHAIN', 'chain', true],
  ['tp-grapple', 'GRAB', 'grapple', true],
  ['tp-boost', 'BOOST', 'boost', true],
  ['tp-swerve', 'DODGE', 'swerve', true],
  ['tp-tuck', 'TUCK', 'tuck', false],
];

export function isTouchDevice() {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
}

export class TouchPad {
  constructor(input, host) {
    this.input = input;
    this.buttons = {};
    this.el = document.createElement('div');
    this.el.id = 'touchpad';
    for (const [id, label, action, edge] of LAYOUT) {
      const b = document.createElement('button');
      b.id = id; b.className = 'tp pe'; b.textContent = label;
      b.setAttribute('aria-label', action);
      b.dataset.action = action;
      let pid = null;                       // the one pointer holding this button
      const on = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (pid !== null) return;           // a second finger on a held button
        pid = e.pointerId;
        b.classList.add('on');
        if (!input.down[action]) input.pressed[action] = true;
        input.down[action] = true;
        input.anyInput = true;
        // LAST, and guarded: it throws NotFoundError when the pointer is already
        // gone (a very short tap, a cancelled touch), and when it ran first that
        // throw skipped the lines above -- the button lit up and did nothing.
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* not capturable; fine */ }
        if (navigator.vibrate && edge) navigator.vibrate(12);
      };
      const off = (e) => {
        if (e && pid !== null && e.pointerId !== pid) return;
        if (e && e.cancelable) e.preventDefault();
        pid = null;
        b.classList.remove('on');
        if (input.down[action]) input.released[action] = true;
        input.down[action] = false;
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      // Capture can be refused or lost (an OS gesture, a notification). Without
      // these a held GAS stays held after the finger has gone.
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('pointerleave', (e) => {
        if (pid === e.pointerId && !b.hasPointerCapture?.(e.pointerId)) off(e);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b._release = () => off(null);
      this.buttons[action] = b;
      this.el.appendChild(b);
    }
    this._buildSteer();
    host.appendChild(this.el);
    // An app switch or incoming call drops every touch without a pointerup.
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    // BACKSTOP. Per-button release events can be lost (an OS gesture steals the
    // touch, a capture is refused). But when the LAST finger lifts, nothing can
    // honestly be held any more -- so everything is released, whatever the
    // individual buttons believe. Same idea as RallyRoadRash's live-touch
    // reconcile, reduced to the one case that is always unambiguous.
    const lastUp = (e) => { if (e.touches && e.touches.length === 0) this.reset(); };
    addEventListener('touchend', lastUp, { passive: true, capture: true });
    addEventListener('touchcancel', lastUp, { passive: true, capture: true });
  }

  /**
   * ANALOG STEERING. One pad where the two on/off arrows were: the finger's
   * distance from the centre IS the steering amount, so a small correction is
   * a small movement instead of a stab at a full-lock button. A dead band
   * around the centre lets a resting thumb ride straight; touching the far
   * edge is still full lock, so the old tap-an-arrow habit keeps working.
   */
  _buildSteer() {
    const input = this.input;
    const pad = document.createElement('div');
    pad.id = 'tp-steer'; pad.className = 'pe';
    pad.setAttribute('role', 'slider'); pad.setAttribute('aria-label', 'steer');
    pad.innerHTML = '<i class="tick l"></i><i class="tick c"></i><i class="tick r"></i>'
      + '<span class="arrow l">◀</span><span class="arrow r">▶</span><b class="nub"></b>';
    const nub = pad.querySelector('.nub');
    let pid = null;
    const DEAD = 0.1;
    const set = (x) => {
      const r = pad.getBoundingClientRect();
      const half = r.width / 2;
      let v = (x - (r.left + half)) / (half * 0.82);          // full lock short of the edge
      v = Math.max(-1, Math.min(1, v));
      const a = Math.abs(v);
      v = a < DEAD ? 0 : Math.sign(v) * (a - DEAD) / (1 - DEAD); // dead band, rescaled
      input.touchSteer = v;
      nub.style.transform = `translateX(${(v * half * 0.78).toFixed(1)}px)`;
    };
    const release = (e) => {
      if (e && pid !== null && e.pointerId !== pid) return;
      pid = null;
      input.touchSteer = 0;
      pad.classList.remove('on');
      nub.style.transform = '';
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pid !== null) return;
      pid = e.pointerId;
      pad.classList.add('on');
      input.anyInput = true;
      set(e.clientX);
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e.clientX); });
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    pad.addEventListener('lostpointercapture', release);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
    this.steerPad = pad;
    this._releaseSteer = () => release(null);
    this.el.appendChild(pad);
  }

  show(on) { this.el.classList.toggle('on', !!on); }

  /** Release every button: pause, blur, race end. */
  reset() {
    for (const b of Object.values(this.buttons)) b._release();
    if (this._releaseSteer) this._releaseSteer();
  }

  /**
   * Per-frame context from the player's fighter, so the buttons say what they
   * will do NOW. GRAB becomes THROW while you are holding someone, and while
   * you are the one held, every attack button pulses: any of them struggles.
   */
  sync(fighter) {
    if (!fighter) return;
    const holding = !!fighter.hold, held = !!fighter.heldBy;
    const g = this.buttons.grapple;
    const label = holding ? 'THROW' : 'GRAB';
    if (g.textContent !== label) g.textContent = label;
    if (held !== this._held) {
      this._held = held;
      for (const k of ['punch', 'kick', 'chain', 'grapple']) this.buttons[k].classList.toggle('mash', held);
    }
  }
}
