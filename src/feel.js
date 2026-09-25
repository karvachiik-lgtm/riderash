// RideRash — FEEL: what a hit does to the camera, the screen and your hands.
//
// One place turns the game's single "how violent was that" number
// (state.shake, raised by every hit, crash, landing and scrape) into:
//
//   SHAKE     trauma-model camera shake: intensity = trauma^2, so a tap is a
//             twitch and a wreck is a jolt; smooth noise (not per-frame random
//             jitter, which reads as a broken camera), translation AND rotation
//   HAPTICS   on a phone navigator.vibrate(); on a gamepad the dual-rumble
//             actuator -- a pulse proportional to each new jolt, a double tap
//             for nitro, a low engine rumble at speed on the pad
//   POST      numbers for postfx.js's grade pass: speed (radial blur and
//             streaks), impact (a flash with chromatic fringing), boost (blue
//             edge glow), hurt (a red pulse at the edges when you are nearly out)
//
// Haptics obey the settings toggle and never fire before the page has had a
// user gesture (browsers ignore it then anyway).
export class Feel {
  constructor(settings) {
    this.settings = settings;
    this.t = 0;
    this.prevShake = 0;
    this.impact = 0;          // 0..1, decays fast: the flash
    this.boostK = 0;          // eased 0..1
    this.hurt = 0;            // 0..1
    this.speed = 0;           // 0..1
    this.cam = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
    this._rumbleT = 0;
    this._armed = false;
    const arm = () => { this._armed = true; };
    addEventListener('pointerdown', arm, { once: true, capture: true });
    addEventListener('keydown', arm, { once: true, capture: true });
  }

  get hapticsOn() { return this._armed && this.settings.vibration !== false; }

  /** A pulse: strength 0..1, ms for the phone. */
  pulse(strength, ms) {
    if (!this.hapticsOn || strength <= 0.02) return;
    try { if (navigator.vibrate) navigator.vibrate(Math.round(ms ?? 12 + strength * 70)); } catch (e) { /* not allowed */ }
    this._pad(strength, (ms ?? 60 + strength * 160));
  }
  pattern(p, padStrength = 0.4) {
    if (!this.hapticsOn) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not allowed */ }
    this._pad(padStrength, p.reduce((a, b) => a + b, 0));
  }
  _pad(strength, ms, weakOnly = false) {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        const a = gp && gp.vibrationActuator;
        if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: weakOnly ? 0 : Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.8 + 0.1) }).catch(() => {});
      }
    } catch (e) { /* no pads */ }
  }

  /**
   * Per frame. `g`: { shake, speedFrac, boosting, hpFrac, running }.
   * Returns the camera offsets to apply after lookAt.
   */
  update(dt, g) {
    this.t += dt;
    const shake = g.shake || 0;
    // every new jolt is an impact: a haptic pulse and a flash
    const d = shake - this.prevShake;
    if (d > 0.12 && g.running) {
      this.pulse(Math.min(1, d * 0.9));
      this.impact = Math.min(1, this.impact + d * 0.8);
    }
    this.prevShake = shake;
    this.impact = Math.max(0, this.impact - dt * 4.5);
    this.boostK += ((g.boosting ? 1 : 0) - this.boostK) * Math.min(1, dt * (g.boosting ? 6 : 2.5));
    this.speed += ((g.speedFrac || 0) - this.speed) * Math.min(1, dt * 3);
    const hp = g.hpFrac ?? 1;
    this.hurt = g.running && hp < 0.3 ? (0.3 - hp) / 0.3 : Math.max(0, this.hurt - dt);

    // the engine through a gamepad's weak motor, at speed only
    if (g.running && this.speed > 0.55 && this.hapticsOn) {
      this._rumbleT -= dt;
      if (this._rumbleT <= 0) { this._rumbleT = 0.45; this._pad(0.08 + 0.12 * this.speed + 0.25 * this.boostK, 480, true); }
    }

    // TRAUMA SHAKE: smooth noise, intensity squared
    const tr = Math.min(1, shake / 1.4), k = tr * tr;
    const t = this.t;
    const n = (a, b, c) => Math.sin(t * a + c) * 0.6 + Math.sin(t * b + c * 1.7) * 0.4;
    const c = this.cam;
    // plus a fine buzz at speed and under boost (the road through the bars)
    const buzz = 0.012 * this.speed * this.speed + 0.03 * this.boostK;
    c.x = n(31, 47, 1.3) * (0.55 * k) + n(90, 131, 4.1) * buzz;
    c.y = n(37, 53, 2.1) * (0.45 * k) + n(97, 143, 0.7) * buzz;
    c.z = n(29, 41, 3.7) * (0.3 * k);
    c.pitch = n(23, 39, 5.3) * 0.045 * k;
    c.yaw = n(27, 43, 6.1) * 0.04 * k;
    c.roll = n(19, 33, 7.7) * 0.07 * k;
    return c;
  }

  /** Numbers for postfx.js. */
  post() { return { speed: this.speed, impact: this.impact, boost: this.boostK, hurt: this.hurt, time: this.t }; }
}
