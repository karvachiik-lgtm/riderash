// RideRash — gamepad. Standard-mapping controllers (Xbox / PlayStation / most
// Bluetooth pads, and what a phone sees when one is paired to it).
//
// It writes into the SAME `down` / `pressed` tables the keyboard and the touch
// pad fill, plus `input.padSteer` for the analog stick -- so no game code knows
// or cares which device a verb came from. Only this file knows the button map.
//
// Pads are POLLED (the Gamepad API has no button events), once per frame.
const DZ = 0.14;                       // stick deadzone
const TRIG = 0.15;                     // trigger travel that counts as pressed
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9,
            UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
// held = true: the action is held while the button is (throttle, tuck).
const RIDE = [
  [B.X, 'punch'], [B.Y, 'kick'], [B.B, 'chain'], [B.RB, 'grapple'], [B.A, 'boost'],
  [B.LB, 'tuck', true],
];

function dz(v) { const a = Math.abs(v); return a < DZ ? 0 : Math.sign(v) * (a - DZ) / (1 - DZ); }
function val(p, i) { const b = p.buttons[i]; return b ? (typeof b === 'object' ? b.value || (b.pressed ? 1 : 0) : b) : 0; }
function on(p, i) { const b = p.buttons[i]; return !!b && (b.pressed || val(p, i) > TRIG); }

export class Gamepads {
  constructor(input) {
    this.input = input;
    this.prev = [];                    // last frame's pressed state, per button
    this.held = Object.create(null);   // actions this pad is holding down
    this.index = null;
    addEventListener('gamepadconnected', (e) => { this.index = e.gamepad.index; });
    addEventListener('gamepaddisconnected', (e) => {
      if (this.index === e.gamepad.index) { this.index = null; this.release(); }
    });
  }

  get connected() { return this.index !== null; }

  _pad() {
    if (!navigator.getGamepads) return null;
    const list = navigator.getGamepads();
    if (this.index !== null && list[this.index]) return list[this.index];
    for (const p of list) if (p && p.connected) { this.index = p.index; return p; }
    return null;
  }

  _hold(action, v) {
    const inp = this.input;
    if (v) {
      if (!inp.down[action]) inp.pressed[action] = true;
      inp.down[action] = true; this.held[action] = true;
    } else if (this.held[action]) {
      inp.down[action] = false; inp.released[action] = true; delete this.held[action];
    }
  }

  release() {
    for (const a of Object.keys(this.held)) this._hold(a, false);
    this.input.padSteer = 0;
  }

  /**
   * One frame. `ctx.menu` is true when a menu screen is up (title, pause,
   * results, settings): the pad then drives focus instead of the bike.
   * Returns true if the pad was touched this frame (for the input-method switch).
   */
  poll(ctx = {}) {
    const p = this._pad();
    if (!p) return false;
    const now = p.buttons.map((_, i) => on(p, i));
    const edge = (i) => now[i] && !this.prev[i];
    const stick = dz(p.axes[0] || 0);
    let active = Math.abs(stick) > 0 || now.some(Boolean);

    if (edge(B.START)) ctx.onPause && ctx.onPause();
    if (ctx.menu) {
      this.release();
      if (edge(B.UP) || edge(B.LEFT)) ctx.onNav && ctx.onNav(-1);
      if (edge(B.DOWN) || edge(B.RIGHT)) ctx.onNav && ctx.onNav(1);
      if (edge(B.A)) ctx.onConfirm && ctx.onConfirm();
      if (edge(B.B)) ctx.onBack && ctx.onBack();
    } else {
      if (edge(B.VIEW)) ctx.onCamera && ctx.onCamera();
      const dpad = (now[B.RIGHT] ? 1 : 0) - (now[B.LEFT] ? 1 : 0);
      this.input.padSteer = stick !== 0 ? stick : dpad;
      this._hold('up', now[B.RT] || now[B.UP]);
      this._hold('down', now[B.LT] || now[B.DOWN]);
      for (const [i, action, held] of RIDE) {
        if (held) this._hold(action, now[i]);
        else if (edge(i)) { this.input.pressed[action] = true; this.input.down[action] = true; this.held[action] = true; }
        else if (!now[i] && this.held[action]) this._hold(action, false);
      }
    }
    this.prev = now;
    return active;
  }
}
