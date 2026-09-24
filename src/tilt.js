// RideRash — tilt steering. Hold the phone like a wheel and turn it.
//
// ORIENTATION-INDEPENDENT BY CONSTRUCTION. The usual recipe reads `gamma` in
// portrait and `beta` in landscape, and has to get a sign right for every
// screen rotation. Instead: rebuild gravity in the DEVICE's frame from beta and
// gamma (W3C DeviceOrientation, R = Rz(alpha)·Rx(beta)·Ry(gamma); gravity is
// invariant under the alpha term), rotate it into SCREEN axes by the screen's
// own rotation angle, and read the angle of gravity within the screen plane.
// That angle IS the wheel angle: turn the phone clockwise and gravity swings
// anticlockwise across the screen, whatever way up the phone is.
//
//   device-frame gravity  g = ( sinγ·cosβ,  -sinβ,  -cosγ·cosβ )
//   screen axes at rotation θ:  right = (cosθ, -sinθ),  up = (sinθ, cosθ)
//   wheel = atan2(g·right, -(g·up))        0 when gravity points screen-down
//
// The first reading after enable/calibrate is taken as centre, so a player
// holding the phone at any comfortable angle starts straight.
const DEG = Math.PI / 180;
const DEAD = 4;          // degrees of wheel either side of centre that do nothing
const FULL = 30;         // degrees of wheel for full lock

export function tiltSupported() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export class Tilt {
  constructor(input) {
    this.input = input;
    this.active = false;
    this.base = null;
    this.wheel = 0;
    this._on = (e) => this._read(e);
  }

  /** Must run inside a user gesture: iOS 13+ asks permission there or nowhere. */
  async enable() {
    if (!tiltSupported()) return false;
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      try { if ((await DOE.requestPermission()) !== 'granted') return false; }
      catch (e) { return false; }
    }
    if (!this.active) addEventListener('deviceorientation', this._on);
    this.active = true;
    this.base = null;
    return true;
  }

  disable() {
    removeEventListener('deviceorientation', this._on);
    this.active = false;
    this.input.tiltSteer = 0;
  }

  /** Next reading becomes straight ahead (race start, or the player asks). */
  calibrate() { this.base = null; }

  _screenAngle() {
    const o = screen.orientation;
    if (o && Number.isFinite(o.angle)) return o.angle;
    return Number.isFinite(window.orientation) ? window.orientation : 0;   // old iOS
  }

  _read(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * DEG, g = e.gamma * DEG, t = this._screenAngle() * DEG;
    const gx = Math.sin(g) * Math.cos(b), gy = -Math.sin(b);
    const sx = gx * Math.cos(t) - gy * Math.sin(t);       // g · screen-right
    const sy = gx * Math.sin(t) + gy * Math.cos(t);       // g · screen-up
    // Phone lying flat: gravity is almost out of the screen and the in-plane
    // angle is noise. Hold straight rather than twitch.
    if (Math.hypot(sx, sy) < 0.25) { this.input.tiltSteer = 0; return; }
    const wheel = Math.atan2(sx, -sy) / DEG;
    if (this.base === null) this.base = wheel;
    let d = wheel - this.base;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    this.wheel = d;
    const a = Math.abs(d);
    this.input.tiltSteer = a < DEAD ? 0 : Math.sign(d) * Math.min(1, (a - DEAD) / (FULL - DEAD));
  }
}
