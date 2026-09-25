// RideRash — HUD, wired to the DOM already in index.html.
import { CFG } from './config.js';
import { Island } from './island.js';

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      pos: document.getElementById('pos'),
      spd: document.getElementById('spd'),
      timer: document.getElementById('timer'),
      dist: document.getElementById('dist'),
      score: document.getElementById('score'),
      boxes: document.getElementById('boxes'),
      combofill: document.getElementById('combofill'),
      warn: document.getElementById('warn'),
      swap: document.getElementById('swap'),
      dmgvign: document.getElementById('dmgvign'),
      dmgnum: document.getElementById('dmg'),
      target: document.getElementById('target'),
      targetnm: document.getElementById('targetnm'),
      targetbar: document.getElementById('targetbar'),
      fps: document.getElementById('fpsbox'),
    };
    // The analog dial. Optional: a page without #speedo still runs the HUD.
    const cv = document.getElementById('speedo');
    this.speedo = cv ? new Speedo(cv) : null;
    this._lastT = performance.now();
    this._last = {};
    this._warnT = 0;
    this._swapT = 0;
    const host = document.getElementById('hud');
    this.island = host ? new Island(host) : null;
  }

  show(on) { this.el.hud.classList.toggle('on', on); }

  set(label, value, unit) {
    const e = this.el[label];
    if (!e) return;
    const key = value + '|' + unit;
    if (this._last[label] === key) return;
    this._last[label] = key;
    e.innerHTML = unit ? `${value}<small>${unit}</small>` : `${value}`;
  }

  update(g) {
    // Real elapsed time for the HUD's own fades. The warning used to decay by a
    // fixed 1/60 per call, so on a 120 Hz panel it flashed for half as long.
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._lastT) / 1000);
    this._lastT = now;
    this.set('pos', `${g.position}`, `/${g.field}`);
    if (this.speedo) this.speedo.update(g, dt);
    const t = g.time;
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    this.set('timer', `${mm}:${String(ss).padStart(2, '0')}`, '');
    this.set('dist', `${Math.floor(g.s)}`, 'M');
    this.set('score', `${Math.floor(g.score)}`, 'PTS');

    // health boxes
    const total = 8;
    const filled = Math.round((g.hp / g.maxHp) * total);
    if (this._filled !== filled) {
      this._filled = filled;
      let html = '';
      for (let i = 0; i < total; i++) html += `<i class="${i < filled ? '' : 'off'}"></i>`;
      // ridden from the right, so it reads as a bar draining leftward
      this.el.boxes.innerHTML = html;
    }

    // stamina / combo bar
    const cf = this.el.combofill;
    const pct = Math.max(0, Math.min(100, g.stamina));
    if (this._stam !== pct) { this._stam = pct; cf.style.width = pct + '%'; }
    cf.style.background = g.combo > 0
      ? `hsl(${Math.max(0, 30 - g.combo * 6)}, 78%, ${52 + Math.min(18, g.combo * 3)}%)`
      : '#d8342a';

    // damage vignette
    const dmg = 1 - g.hp / g.maxHp;
    this.el.dmgvign.style.opacity = dmg > 0.35 ? String(Math.min(0.9, (dmg - 0.35) * 1.6)) : '0';

    // THE PUNISHMENT METER, visible so the last crash is a DECISION and not a
    // surprise at the results screen. It shows what the machine has already cost
    // you this race, in dollars, updated the moment a crash lands.
    if (this.el.dmgnum) {
      const bill = g.repairBill || 0;
      const label = bill === 0 ? 'OK' : `-$${bill}`;
      if (this._dmgLabel !== label) {
        this._dmgLabel = label;
        this.el.dmgnum.innerHTML = bill === 0
          ? 'OK<small></small>'
          : `${label}<small>REPAIR</small>`;
        this.el.dmgnum.style.color = bill === 0 ? ''
          : bill < 1000 ? '#e8a81a' : '#d8342a';
      }
    }

    // warnings
    // every callout this frame goes to the island, which ranks and shows them
    if (this.island) {
      this.island.push(g.warns || (g.warn ? [g.warn] : null));
      this.island.setLive(g.live);
      this.island.update(dt);
    }
    this.el.swap.classList.toggle('on', g.swapped > 0);

    // the rider you are fighting: name and health, fading in only within range
    const tg = g.target;
    if (this.el.target) {
      this.el.target.classList.toggle('on', !!tg);
      if (tg) {
        const nm = tg.down ? `${tg.name} · DOWN` : tg.name;
        if (this._tgName !== nm) { this._tgName = nm; this.el.targetnm.textContent = nm; }
        const w = Math.round(tg.frac * 100);
        if (this._tgW !== w) {
          this._tgW = w;
          this.el.targetbar.style.width = w + '%';
          this.el.targetbar.style.background = w > 50 ? 'var(--amber)' : w > 25 ? '#e8a81a' : 'var(--red)';
        }
      }
    }
    if (this.el.fps) {
      this.el.fps.classList.toggle('on', !!g.showFps);
      if (g.showFps) {
        const f = Math.round(g.fps || 0);
        if (this._fps !== f) { this._fps = f; this.el.fps.textContent = `${f} FPS`; }
      }
    }
  }

  ended(title, body) {
    document.getElementById('overh').textContent = title;
    document.getElementById('overp').innerHTML = body;
    document.getElementById('over').classList.add('on');
    this.show(false);
  }
}

// ---- THE SPEEDOMETER --------------------------------------------------------
// Road Rash put an analog dial in the dashboard, and a number alone does not
// read at a glance: the eye takes a needle ANGLE in peripheral vision, while a
// digit has to be foveated. So the dial carries the reading and the digits in
// its open bottom sector are for the moment you actually look.
//
// THE SCALE IS FIXED. Every bike shares one terminal speed, CFG.MAX_SPEED
// (48.16 m/s = 107.7 mph, the measured fixed point of the engine/drag balance --
// see config.js), so the dial is printed once: 0..120 mph, the next multiple of
// 20 above the top speed, with the redline band starting at 100. Flat out, the
// needle rests just inside the red, which is where a rider expects "pinned" to be.
// BOOST can push past terminal for 1.6 s; the needle may climb into the band but
// stops at the end stop rather than wrapping.
//
// COST. The face (ticks, numbers, redline) is rendered ONCE into an offscreen
// canvas at device resolution and blitted; per frame only the needle, the lit
// arc, the digits and the gear are drawn, and only when something visible
// changed (needle moved > 0.05 mph, a new gear, boost state). Zero draw calls
// against the WebGL budget.
const MPS_TO_MPH = 2.23694;
const A0 = Math.PI * (150 / 180);          // 0 mph: lower-left
const SWEEP = Math.PI * (240 / 180);       // clockwise to lower-right
// The gearbox the engine audio plays (audio.js, `TOP`, fractions of top speed).
// Used only when the audio engine is not running (muted before first gesture,
// headless) so the gear digit never disagrees with what you hear when it is.
const GEAR_TOP = [0, 0.16, 0.30, 0.46, 0.63, 0.82, 1.08];

class Speedo {
  constructor(cv) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.topMph = CFG.MAX_SPEED * MPS_TO_MPH;
    this.maxMph = Math.ceil(this.topMph / 20) * 20;              // 120
    this.redMph = Math.min(this.maxMph - 10, Math.floor(this.topMph * 0.92 / 10) * 10); // 100
    this.shown = 0;          // smoothed mph the needle points at
    this._gear = 1;
    this._key = '';
    this.size = 0;
    // CSS decides the size per device/orientation (index.html media queries);
    // the backing store follows it so the face is never a blurry upscale.
    this._resize();
    if (window.ResizeObserver) new ResizeObserver(() => this._resize()).observe(cv);
    else addEventListener('resize', () => this._resize());
  }

  _resize() {
    const s = Math.round(this.cv.clientWidth);
    if (!s) return;                          // HUD hidden; next observe fires on show
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (s === this.size && dpr === this.dpr) return;
    this.size = s; this.dpr = dpr;
    this.cv.width = this.cv.height = Math.round(s * dpr);
    this.face = this._drawFace(s, dpr);
    this._key = '';                          // force a redraw
  }

  _ang(mph) { return A0 + SWEEP * Math.max(0, Math.min(1, mph / this.maxMph)); }

  _drawFace(s, dpr) {
    const f = document.createElement('canvas');
    f.width = f.height = Math.round(s * dpr);
    const c = f.getContext('2d');
    c.scale(dpr, dpr);
    const r = s / 2, cx = r, cy = r;
    // body: a dark smoked disc, legible over white sky and black storm alike
    const bg = c.createRadialGradient(cx, cy * 0.8, r * 0.1, cx, cy, r);
    bg.addColorStop(0, 'rgba(26,28,32,.78)');
    bg.addColorStop(1, 'rgba(8,9,11,.82)');
    c.fillStyle = bg;
    c.beginPath(); c.arc(cx, cy, r - 1, 0, Math.PI * 2); c.fill();
    c.lineWidth = Math.max(1, s * 0.012);
    c.strokeStyle = 'rgba(232,228,220,.32)';
    c.stroke();
    // redline band on the outer edge
    c.lineWidth = s * 0.05;
    c.strokeStyle = 'rgba(216,52,42,.9)';
    c.beginPath(); c.arc(cx, cy, r * 0.86, this._ang(this.redMph), this._ang(this.maxMph)); c.stroke();
    // ticks: minor every 5, mid every 10, major every 20
    for (let m = 0; m <= this.maxMph; m += 5) {
      const a = this._ang(m), major = m % 20 === 0, mid = m % 10 === 0;
      const r1 = r * 0.90, r0 = r * (major ? 0.74 : mid ? 0.79 : 0.83);
      c.lineWidth = major ? Math.max(1.5, s * 0.018) : Math.max(1, s * 0.009);
      c.strokeStyle = m >= this.redMph ? '#ff6a5a' : major ? '#e8e4dc' : 'rgba(232,228,220,.55)';
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    // numerals: every 20 on a big dial, every 40 on a small one (9 px floor)
    const step = s >= 120 ? 20 : 40;
    c.font = `600 ${Math.max(9, Math.round(s * 0.085))}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let m = 0; m <= this.maxMph; m += step) {
      const a = this._ang(m), rr = r * 0.60;
      c.fillStyle = m >= this.redMph ? '#ff7b6b' : '#b4b9bf';
      c.fillText(String(m), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    return f;
  }

  update(g, dt) {
    if (!this.size) { this._resize(); if (!this.size) return; }
    const mph = Math.max(0, g.mph || 0);
    // Needle inertia: exponential approach, frame-rate independent. Physics
    // speed steps on impacts; a real needle is a damped mass and so is this.
    this.shown += (mph - this.shown) * (1 - Math.exp(-dt * 12));
    let gear = g.gear;
    if (typeof gear !== 'number' || !gear) {
      // mirror of the audio gearbox, with its hysteresis
      const sp = mph / this.topMph;
      let k = this._gear;
      if (k < 6 && sp > GEAR_TOP[k] * 0.97) k++;
      else if (k > 1 && sp < GEAR_TOP[k - 1] * 0.80) k--;
      gear = this._gear = k;
    }
    const boosting = !!g.boost;
    const ready = !boosting && !g.boostCool;
    const pulse = boosting ? Math.floor(performance.now() / 90) & 1 : 0;
    const key = `${this.shown.toFixed(1)}|${Math.round(mph)}|${gear}|${boosting}|${ready}|${pulse}`;
    if (key === this._key) return;
    this._key = key;

    const c = this.ctx, s = this.size, r = s / 2, cx = r, cy = r, dpr = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.drawImage(this.face, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    // BOOST: the rim burns blue while the charge runs -- the same colour family
    // as the flame -- flickering so it registers in peripheral vision.
    if (boosting) {
      c.lineWidth = s * 0.045;
      c.strokeStyle = pulse ? 'rgba(110,200,255,.95)' : 'rgba(70,140,255,.7)';
      c.shadowColor = '#5ab4ff'; c.shadowBlur = s * 0.08;
      c.beginPath(); c.arc(cx, cy, r - s * 0.03, 0, Math.PI * 2); c.stroke();
      c.shadowBlur = 0;
    }

    // lit sweep from 0 to the needle, amber turning red in the band
    const an = this._ang(this.shown);
    c.lineWidth = s * 0.028;
    c.strokeStyle = this.shown >= this.redMph ? '#ff5a4a' : 'rgba(255,180,90,.85)';
    c.beginPath(); c.arc(cx, cy, r * 0.935, A0, an); c.stroke();

    // gear: a boxed digit above the hub, printed on the face (under the needle)
    const gs = Math.round(s * 0.13);
    c.font = `700 ${gs}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.strokeStyle = 'rgba(232,228,220,.35)'; c.lineWidth = 1;
    c.strokeRect(cx - gs * 0.55, cy - r * 0.32 - gs * 0.6, gs * 1.1, gs * 1.2);
    c.fillStyle = mph < 0.5 ? '#8fc27a' : '#e8e4dc';
    c.fillText(mph < 0.5 ? 'N' : String(gear), cx, cy - r * 0.32 + gs * 0.04);

    // digits in the open bottom sector
    const ds = Math.round(s * 0.2);
    c.font = `700 ${ds}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    c.fillStyle = boosting ? '#8fd0ff' : '#e8e4dc';
    c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 3;
    c.fillText(String(Math.round(mph)), cx, cy + r * 0.50);
    c.shadowBlur = 0;
    c.font = `600 ${Math.max(8, Math.round(s * 0.075))}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    c.fillStyle = '#8b9097';
    c.fillText('MPH', cx + r * 0.06, cy + r * 0.76);

    // nitro lamp, beside MPH: green = a charge is ready, blue = burning
    const lx = cx - r * 0.30, ly = cy + r * 0.76, lr = Math.max(2.5, s * 0.03);
    c.fillStyle = boosting ? (pulse ? '#8fd0ff' : '#3d7dff') : ready ? '#6fcf5a' : '#2c3036';
    c.beginPath(); c.arc(lx, ly, lr, 0, Math.PI * 2); c.fill();

    // needle: tail through the hub, tapered, amber like the position readout
    const ca = Math.cos(an), sa = Math.sin(an), nx = -sa, ny = ca;
    const tip = r * 0.82, tail = r * 0.14, w = Math.max(1.5, s * 0.022);
    c.fillStyle = '#ffb45a';
    c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 3;
    c.beginPath();
    c.moveTo(cx + ca * tip, cy + sa * tip);
    c.lineTo(cx - ca * tail + nx * w, cy - sa * tail + ny * w);
    c.lineTo(cx - ca * tail - nx * w, cy - sa * tail - ny * w);
    c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#1a1c20'; c.strokeStyle = '#ffb45a'; c.lineWidth = Math.max(1, s * 0.012);
    c.beginPath(); c.arc(cx, cy, s * 0.05, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}
