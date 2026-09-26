// RideRash — the radar.
//
// A LOCAL SWEEP, NOT A TRACK MAP, and that is a design decision rather than a
// shortcut. A rider at a hundred miles an hour does not have a survey of the
// route in their head; they have what is coming at them. Drawing the whole
// course would hand the player knowledge the fiction says they do not have, and
// it would also be unreadable — 5.6 km squeezed into 150 px is a squiggle.
//
// So it shows RADAR_M metres around the rider, heading-up, and the road slides
// through it. A bend appears when it is close enough to matter. That is also the
// only presentation that stays legible when the map changes under you, which
// worldspine.js does constantly.
//
// Drawn on a 2D canvas, not in the scene: it costs zero draw calls against the
// 900 budget, which matters more here than anywhere else in the project.
//
// NO GLYPHS. The style lock forbids legible text in the game world, and while a
// HUD is chrome rather than world, this stays shape-and-colour anyway: the rider
// is a triangle, rivals are their own bodywork colour, traffic is a dull slab.
import { centreAt, centreTangent } from './level.js';
import { edgeAt, lanesAt, LANE, crossings, CROSS_HALF } from './lanes.js';
const _LN = { r: 1, l: 1 };
import { CFG } from './config.js';

const RADAR_M = 130;        // (legacy) metres of road shown ahead and behind
// ZOOM LEVELS, metres from the centre to the rim. 130 m fixed drew the whole
// carriageway as one thin stroke -- two lanes read as a single line. Zoomed in
// (the default) the road is wide enough to show both edges and the centre
// line; zoomed out it shows the pack. While the player is down or on foot the
// radar zooms out on its own so he can see where the bike and the field are.
export const RADAR_ZOOMS = [45, 90, 180, 420];
const STEP_M = 6;           // sampling interval along the road
// the cruise view: how long it must be quiet first, how fast it eases out and
// snaps back in, and how much road it draws ahead
const CRUISE = { AFTER: 2.5, OUT: 1.1, IN: 7, AHEAD: 720 };
const MODES = ['auto', 'focus', 'full'];

export class Radar {
  constructor(canvas) {
    this.cv = canvas || null;
    if (!this.cv) return;
    this.ctx = this.cv.getContext('2d');
    // Back the canvas at device resolution or the road edges crawl with
    // stair-steps on a retina panel, which reads as a rendering fault.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = this.cv.clientWidth || 148;
    this.cv.width = this.size * dpr;
    this.cv.height = this.size * dpr;
    this.ctx.scale(dpr, dpr);
    this.r = this.size / 2;
    this._t = 0;
    this.zoomIx = 0;              // the player's chosen level
    this.range = RADAR_ZOOMS[0];  // what is drawn (eases toward the target)
    this.auto = false;            // true while the game has zoomed it out
    // CRUISE: nothing going on for a while -> the dish tips back into a far
    // 3D view down the road with the distance to the flag; anything happening
    // (a swing, a hit, an island callout, a rider or the cop close) snaps it
    // straight back to the close top-down sweep.
    this.calm = 0;                // 0 = the close sweep, 1 = the cruise view
    this.quiet = 0;               // seconds since anything happened
    // THE MODE, the player's (the pill above the dish, or N):
    //   auto   the above: close sweep while things happen, far view when calm
    //   focus  always the close top-down sweep, at the chosen radius
    //   full   the whole route to the flag, fitted to the dish
    this.mode = 'auto';
    try { const m = localStorage.getItem('riderash.radarMode'); if (MODES.includes(m)) this.mode = m; } catch (e) { /* private mode */ }
    this.full = 0;                // 0..1, the full-route view's fade
    this._route = null;           // cached route polyline for `full`
    this.pill = document.createElement('button');
    this.pill.type = 'button'; this.pill.id = 'radarmode';
    this.pill.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.cycleMode(); });
    document.body.appendChild(this.pill);
    this._pillKey = '';
    // + / - are drawn on the lower rim; a tap on the left half zooms out, the
    // right half zooms in. The canvas takes pointer events for this alone.
    this.cv.classList.add('pe');
    this.cv.addEventListener('pointerdown', (e) => {
      const r = this.cv.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height, x = (e.clientX - r.left) / r.width;
      if (y < 0.62) return;
      e.preventDefault();
      this.zoom(x < 0.5 ? +1 : -1);
    });
  }

  cycleMode() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    try { localStorage.setItem('riderash.radarMode', this.mode); } catch (e) { /* private mode */ }
    this._pillKey = '';
  }

  /** Keep the pill with the dish, 4 times a second. Called every frame by the
   *  game loop, in races AND menus: it used to be updated only from update(),
   *  which does not run outside a race, so the pill stayed on screen over the
   *  intro, the cutscenes and the menus. */
  syncPill(dt) {
    this._pillT = (this._pillT || 0) - (dt || 0.016);
    if (this._pillT <= 0 || !this._pillKey) { this._pillT = 0.25; this._placePill(); }
  }

  /** The pill sits centred on the dish's top edge, wherever CSS put the dish. */
  _placePill() {
    // The pill lives on <body> (the HUD layer does not take pointer events), so
    // it does NOT inherit the HUD's hiding: judge the DISH's real visibility,
    // ancestors included (the cutscenes fade the HUD by opacity), and hide it
    // under the intro and the cutscenes outright.
    const cv = this.cv, r = cv.getBoundingClientRect(), body = document.body;
    const intro = document.getElementById('intro');
    const seen = typeof cv.checkVisibility === 'function'
      ? cv.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      : getComputedStyle(cv).visibility !== 'hidden' && getComputedStyle(cv).display !== 'none';
    const shown = r.width > 0 && seen && !body.classList.contains('replaying') && !body.classList.contains('cine')
      && !(intro && !intro.hidden);
    const key = `${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.width)}|${shown}|${this.mode}`;
    if (key === this._pillKey) return;
    this._pillKey = key;
    const P = this.pill;
    P.style.display = shown ? '' : 'none';
    P.style.left = `${r.left + r.width / 2}px`;
    P.style.top = `${r.top + 1}px`;
    P.innerHTML = MODES.map((m) => `<span class="${m === this.mode ? 'on' : ''}">${m.toUpperCase()}</span>`).join('');
  }

  /** +1 = zoom OUT (more road), -1 = zoom IN. */
  zoom(dir) {
    this.zoomIx = Math.max(0, Math.min(RADAR_ZOOMS.length - 1, this.zoomIx + dir));
  }

  // world XZ -> radar pixels, rotated so the rider's heading is up.
  //
  // THE BASIS COMES FROM THE BIKE'S OWN FORWARD VECTOR, not from an assumed yaw
  // convention. This used to rotate by `-p.yaw` on the stated belief that "the
  // bike travels toward -z at yaw 0". It does not: BikePhys.sync sets
  // `yaw = roadYaw + yawOffset` and `forward = (sin yaw, 0, cos yaw)`, so at rest
  // on the start straight the yaw is already ~PI, and the old rotation put the
  // road AHEAD of the rider at the BOTTOM of the radar. Everything on the dish
  // was mirrored front-to-back -- reported as "the bottom left navigation is
  // facing the opposite direction".
  //
  // Taking the forward and right vectors directly (fwd = (sin yaw, cos yaw),
  // right = (cos yaw, -sin yaw) in XZ) makes the mapping correct for ANY
  // convention, so it cannot drift out of sync with physics.js again.
  //
  // THE `right` FORMULA WAS MIRRORED, and this is the second half of the same
  // complaint. Deriving the basis from the bike's forward vector fixed
  // front-to-back, but the right vector was `(cos yaw, -sin yaw)`, which is the
  // NEGATIVE of the true right. Measured against `travel x up` in the live
  // page: true right (1, 0), radar right (-1, 0) -- exactly opposite, so every
  // contact on the dish sat on the wrong side. The rider's own lateral axis,
  // `n = (-t.z, t.x)`, is the correct one and is what `BikePhys.sync` uses.
  //
  // The true right of a forward `f = (fx, fz)` in a Y-up right-handed frame is
  // `f x up = (fz, 0, -fx)`... which is what was written. The catch is the
  // SIGN OF f: `fwd = (sin yaw, cos yaw)` is the direction the GROUP faces,
  // and the group faces along travel, so `fz = cos yaw` is the +Z component.
  // `f x up` with up = +Y gives `(fz, 0, -fx)`, but three.js XZ screen-space is
  // left-handed once flattened (x right, z DOWN the screen), so the sign flips
  // exactly once. Rather than argue the handedness, the vector is written to
  // match the measured `n = (-t.z, t.x)`: right = (-fz, 0, fx).
  _project(x, z, px, pz, fwdX, fwdZ, out) {
    const dx = x - px, dz = z - pz;
    // Component along the heading becomes "up" (smaller canvas y); the component
    // to the rider's right becomes "right" (larger canvas x).
    const ahead = dx * fwdX + dz * fwdZ;
    const right = dx * (-fwdZ) - dz * (-fwdX);
    out[0] = this.r + right * this.scale;
    out[1] = this.r - ahead * this.scale;
    return out;
  }

  // ---- THE CRUISE VIEW ------------------------------------------------------
  // A perspective drawing of the ground plane, still on the 2D canvas (zero
  // draw calls): a camera behind and above the rider, heading-up, ~700 m of
  // road ahead. The camera pulls back as `k` rises, so the change reads as a
  // pull-out rather than a cut. Distance ticks every 50 m stream past, so
  // speed shows even on a dead straight.
  _persp(x, z, px, pz, fx, fz, k, out) {
    const dx = x - px, dz = z - pz;
    const ahead = dx * fx + dz * fz, right = dx * (-fz) - dz * (-fx);
    const S = this.size, D0 = 24 + 52 * k, CH = 16 + 32 * k;
    const F = (S * 0.46) * D0 / CH, d = ahead + D0;   // the rider sits at 66% down, clear of the readout
    if (d < 4) return false;
    out[0] = this.r + right * F / d;
    out[1] = S * 0.2 + CH * F / d;
    out[2] = F / d;                                   // pixels per metre there
    return true;
  }

  _cruise(g, p, rivals, traffic, finishS, k) {
    const S = this.size, R = this.r, px = p.pos.x, pz = p.pos.z;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), pt = [0, 0, 0];
    g.save();
    g.globalAlpha = k;
    // sky above the horizon, ground below it
    const hz = S * 0.2;
    const sky = g.createLinearGradient(0, 0, 0, hz + 6);
    sky.addColorStop(0, 'rgba(40,46,58,0.9)'); sky.addColorStop(1, 'rgba(90,86,80,0.7)');
    g.fillStyle = sky; g.fillRect(0, 0, S, hz);
    g.fillStyle = 'rgba(26,30,26,0.85)'; g.fillRect(0, hz, S, S - hz);
    // the road: its two edges, sampled finer near the rider
    const end = Math.min(p.s + CRUISE.AHEAD, Number.isFinite(finishS) ? finishS + 40 : Infinity);
    const L = [], Rr = [], C = [];
    for (let s = Math.max(0, p.s - 30); s <= end; s += s - p.s < 80 ? 4 : 12) {
      const c = centreAt(-s), t = centreTangent(-s), nx = t.z, nz = -t.x;
      const eR = edgeAt(s, 1), eL = edgeAt(s, -1);
      if (!this._persp(c.x + nx * eR, c.z + nz * eR, px, pz, fx, fz, k, pt)) continue;
      Rr.push(pt[0], pt[1]);
      this._persp(c.x - nx * eL, c.z - nz * eL, px, pz, fx, fz, k, pt); L.push(pt[0], pt[1]);
      this._persp(c.x, c.z, px, pz, fx, fz, k, pt); C.push(pt[0], pt[1], pt[2], s);
    }
    if (L.length >= 4) {
      g.beginPath();
      g.moveTo(L[0], L[1]);
      for (let i = 2; i < L.length; i += 2) g.lineTo(L[i], L[i + 1]);
      for (let i = Rr.length - 2; i >= 0; i -= 2) g.lineTo(Rr[i], Rr[i + 1]);
      g.closePath();
      g.fillStyle = 'rgba(62,66,72,0.97)'; g.fill();
      g.strokeStyle = 'rgba(228,222,210,0.55)'; g.lineWidth = 1; g.stroke();
      // distance ticks every 50 m on both edges: the road streaming past
      g.fillStyle = 'rgba(236,230,217,0.85)';
      for (let i = 0; i + 3 < C.length; i += 4) {
        const s = C[i + 3];
        const prev = i >= 4 ? C[i - 1] : s - 1;
        if (Math.floor(s / 50) !== Math.floor(prev / 50)) {
          const w = Math.max(0.6, 1.8 * C[i + 2]), j = i / 2;
          if (L[j] !== undefined) { g.fillRect(L[j] - w, L[j + 1] - w * 0.3, w * 2, w * 0.6); g.fillRect(Rr[j] - w, Rr[j + 1] - w * 0.3, w * 2, w * 0.6); }
        }
      }
    }
    // THE FLAG: a chequered bar across the road when it is in range, a flag
    // pin at the end of the drawn road when it is not
    if (Number.isFinite(finishS)) {
      if (finishS <= p.s + CRUISE.AHEAD) {
        const c = centreAt(-finishS), t = centreTangent(-finishS), nx = t.z, nz = -t.x, hw = edgeAt(finishS, 1);
        const a = [0, 0, 0], b = [0, 0, 0];
        if (this._persp(c.x - nx * hw, c.z - nz * hw, px, pz, fx, fz, k, a) && this._persp(c.x + nx * hw, c.z + nz * hw, px, pz, fx, fz, k, b)) {
          const n = 8, h = Math.max(1.5, 2.2 * a[2]);
          for (let i = 0; i < n; i++) {
            g.fillStyle = i % 2 ? '#0b0b0c' : '#ece6d9';
            const x0 = a[0] + (b[0] - a[0]) * i / n, y0 = a[1] + (b[1] - a[1]) * i / n;
            g.fillRect(x0, y0 - h, (b[0] - a[0]) / n + 0.5, h * 2);
          }
          this._flagIcon(g, b[0] + 3, b[1] - 6, Math.max(4, 5 * a[2]));
        }
      } else if (C.length >= 4) {
        this._flagIcon(g, C[C.length - 4], C[C.length - 3] - 5, 5);
      }
    }
    // traffic and the pack, sized by distance
    if (traffic) for (const car of traffic) {
      if (!car.visible || !this._persp(car.position.x, car.position.z, px, pz, fx, fz, k, pt) || pt[1] < hz) continue;
      const w = Math.max(1, 1.8 * pt[2]);
      g.fillStyle = 'rgba(150,150,156,0.8)'; g.fillRect(pt[0] - w, pt[1] - w * 1.4, w * 2, w * 1.6);
    }
    if (rivals) for (const r of rivals) {
      if (!r || !r.phys || !this._persp(r.phys.pos.x, r.phys.pos.z, px, pz, fx, fz, k, pt) || pt[1] < hz) continue;
      g.fillStyle = '#' + (r.color != null ? r.color.toString(16).padStart(6, '0') : '999999');
      g.globalAlpha = k * (r.fighter && r.fighter.down ? 0.4 : 1);
      g.beginPath(); g.arc(pt[0], pt[1] - 1, Math.max(1.4, 1.5 * pt[2]), 0, Math.PI * 2); g.fill();
      g.globalAlpha = k;
    }
    // the rider, at the camera's feet
    this._persp(px, pz, px, pz, fx, fz, k, pt);
    g.fillStyle = '#e8e4dc';
    g.beginPath(); g.moveTo(R, pt[1] - 7); g.lineTo(R + 4.6, pt[1] + 4); g.lineTo(R, pt[1] + 1.6); g.lineTo(R - 4.6, pt[1] + 4); g.closePath(); g.fill();
    g.restore();
  }

  // ---- THE FULL VIEW ---------------------------------------------------------
  // The whole course, start to flag, top-down and fitted to the dish: the part
  // already ridden dim, what is left bright, the flag, the pack and you on it.
  // North-up would spin nothing but also show a winding course sideways; it is
  // turned so the START->FLAG line runs up the dish, and never rotates after.
  _full(g, p, rivals, finishS, k) {
    const S = this.size, R = this.r;
    const F = Number.isFinite(finishS) ? finishS : 3000;
    if (!this._route || this._route.F !== F || this._route.c0 !== centreAt(0).x) {
      const pts = [];
      for (let s = 0; s <= F; s += Math.max(10, F / 300)) { const c = centreAt(-s); pts.push(c.x, c.z, s); }
      const e = centreAt(-F); pts.push(e.x, e.z, F);
      const a = centreAt(0);
      const ang = Math.atan2(e.x - a.x, e.z - a.z);           // start->flag heading
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rot = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i] - a.x, z = pts[i + 1] - a.z;
        const u = x * ca - z * sa, v = x * sa + z * ca;       // v along start->flag
        rot.push(u, v, pts[i + 2]);
        minX = Math.min(minX, u); maxX = Math.max(maxX, u); minY = Math.min(minY, v); maxY = Math.max(maxY, v);
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      let ext = 1;
      for (let i = 0; i < rot.length; i += 3) ext = Math.max(ext, Math.hypot(rot[i] - cx, rot[i + 1] - cy));
      this._route = { F, c0: a.x, rot, cx, cy, sc: (R * 0.74) / ext, ax: a.x, az: a.z, ca, sa };
    }
    const T = this._route;
    const map = (x, z, out) => {
      const dx = x - T.ax, dz = z - T.az;
      const u = dx * T.ca - dz * T.sa, v = dx * T.sa + dz * T.ca;
      out[0] = R + (u - T.cx) * T.sc; out[1] = R * 0.92 - (v - T.cy) * T.sc; return out;
    };
    g.save();
    g.globalAlpha = k;
    g.fillStyle = 'rgba(14,16,18,0.9)'; g.fillRect(0, 0, S, S);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const line = (from, to, style, w) => {
      g.beginPath(); let started = false;
      for (let i = 0; i < T.rot.length; i += 3) {
        const s = T.rot[i + 2]; if (s < from || s > to) continue;
        const x = R + (T.rot[i] - T.cx) * T.sc, y = R * 0.92 - (T.rot[i + 1] - T.cy) * T.sc;
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      g.strokeStyle = style; g.lineWidth = w; g.stroke();
    };
    line(0, p.s, 'rgba(236,230,217,0.22)', 3);
    line(p.s, T.F, 'rgba(236,230,217,0.9)', 3);
    const pt = [0, 0];
    // start and flag
    map(centreAt(0).x, centreAt(0).z, pt); g.fillStyle = 'rgba(236,230,217,0.5)'; g.fillRect(pt[0] - 2, pt[1] - 2, 4, 4);
    const fe = centreAt(-T.F); map(fe.x, fe.z, pt); this._flagIcon(g, pt[0], pt[1], 7);
    // the pack
    if (rivals) for (const r of rivals) {
      if (!r || !r.phys) continue;
      map(r.phys.pos.x, r.phys.pos.z, pt);
      g.fillStyle = '#' + (r.color != null ? r.color.toString(16).padStart(6, '0') : '999999');
      g.globalAlpha = k * (r.fighter && r.fighter.down ? 0.4 : 1);
      g.beginPath(); g.arc(pt[0], pt[1], 2.6, 0, Math.PI * 2); g.fill();
      g.globalAlpha = k;
    }
    // you: an arrow along your heading, in the map's frame
    map(p.pos.x, p.pos.z, pt);
    const hx = Math.sin(p.yaw), hz = Math.cos(p.yaw);
    const du = hx * T.ca - hz * T.sa, dv = hx * T.sa + hz * T.ca;
    const a = Math.atan2(du, dv);
    g.save(); g.translate(pt[0], pt[1]); g.rotate(a);
    g.fillStyle = '#e3b93c'; g.strokeStyle = '#0b0b0c'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.restore();
  }

  /** A little chequered flag on a pole, `h` px tall. */
  _flagIcon(g, x, y, h) {
    g.fillStyle = 'rgba(236,230,217,0.95)';
    g.fillRect(x - 0.6, y - h, 1.2, h * 1.6);
    const w = h * 1.2, q = w / 3, r = h * 0.6 / 2;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#0b0b0c' : '#ece6d9';
      g.fillRect(x + 0.6 + i * q, y - h + j * r, q, r);
    }
  }

  update(dt, player, rivals, traffic, opts = {}) {
    if (!this.cv || !player) return;
    const g = this.ctx, R = this.r, S = this.size;
    // CALM: quick to snap in when something happens, slow to ease out again
    // (placed at 4 Hz: it reads layout, which is not free every frame)
    this.syncPill(dt);
    this.quiet = opts.active ? 0 : this.quiet + (dt || 0);
    const calmWant = this.mode === 'auto' && !opts.active && this.quiet > CRUISE.AFTER && !(player.onFoot || (player.fighter && player.fighter.down)) ? 1 : 0;
    this.full += ((this.mode === 'full' ? 1 : 0) - this.full) * Math.min(1, (dt || 0.016) * 6);
    if (this.full < 0.002) this.full = 0;
    this.calm += (calmWant - this.calm) * Math.min(1, (dt || 0.016) * (calmWant ? CRUISE.OUT : CRUISE.IN));
    if (this.calm < 0.002) this.calm = 0;
    const A = 1 - Math.max(this.calm, this.full);      // the close sweep's opacity
    // AUTO ZOOM-OUT while down or walking: the far level, back to the player's
    // own level the moment he is riding again.
    this.auto = !!(player.onFoot || (player.fighter && player.fighter.down));
    const want = this.auto ? RADAR_ZOOMS[RADAR_ZOOMS.length - 1] : RADAR_ZOOMS[this.zoomIx];
    this.range += (want - this.range) * Math.min(1, (dt || 0.016) * 4);
    const RADAR_M = this.range;
    this.scale = R / RADAR_M;
    this._t += dt;

    const p = player.phys;
    const px = p.pos.x, pz = p.pos.z;
    // The rider's heading, straight off the physics: forward is the direction of
    // travel, so "ahead" on the road always maps to "up" on the dish.
    const fwdX = Math.sin(p.yaw), fwdZ = Math.cos(p.yaw);
    const pt = [0, 0];

    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();

    // dish
    g.fillStyle = 'rgba(10,12,14,0.62)';
    g.fillRect(0, 0, S, S);
    if (this.calm > 0) this._cruise(g, p, rivals, traffic, opts.finishS, this.calm);
    if (this.full > 0) this._full(g, p, rivals, opts.finishS, this.full);
    g.globalAlpha = A;
    if (A > 0.01) {

    // ---- the road, as a thick ribbon sampled from the same centreAt() the
    // geometry uses, so the radar can never disagree with the track ----
    const s0 = p.s - RADAR_M, s1 = p.s + RADAR_M;
    const pts = [];
    for (let s = s0; s <= s1; s += STEP_M) {
      if (s < 0) continue;
      const c = centreAt(-s);
      this._project(c.x, c.z, px, pz, fwdX, fwdZ, pt);
      pts.push(pt[0], pt[1]);
    }
    if (pts.length >= 4) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      // the carriageway, at its real width in radar metres. Zoomed in it gets
      // pale EDGES and a DASHED centre line -- two lanes, not one line.
      const roadPx = CFG.ROAD_W * this.scale;
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      if (roadPx > 7) {
        g.strokeStyle = 'rgba(228,222,210,0.45)';
        g.lineWidth = roadPx + 2;
        g.stroke();
      }
      g.strokeStyle = roadPx > 7 ? 'rgba(52,56,62,0.95)' : 'rgba(126,134,142,0.34)';
      g.lineWidth = Math.max(3, roadPx);
      g.stroke();
      // ZOOMED IN, THE REAL SHAPE (lanes.js): the tarmac between its actual
      // edges, so a road that widens to four lanes or narrows at a merge looks
      // it; lane dividers where a side has two lanes; the crossroads.
      if (roadPx > 7) {
        const L = [], Rr = [], divs = [];
        for (let s = Math.max(0, s0); s <= s1; s += STEP_M) {
          const c = centreAt(-s), t = centreTangent(-s), nx = t.z, nz = -t.x;
          const eR = edgeAt(s, 1), eL = edgeAt(s, -1);
          this._project(c.x + nx * eR, c.z + nz * eR, px, pz, fwdX, fwdZ, pt); Rr.push(pt[0], pt[1]);
          this._project(c.x - nx * eL, c.z - nz * eL, px, pz, fwdX, fwdZ, pt); L.push(pt[0], pt[1]);
          lanesAt(s, _LN);
          for (const [side, n] of [[1, _LN.r], [-1, _LN.l]]) if (n >= 1.5) {
            this._project(c.x + nx * side * LANE, c.z + nz * side * LANE, px, pz, fwdX, fwdZ, pt); divs.push(pt[0], pt[1]);
          }
        }
        if (L.length >= 4) {
          g.beginPath();
          g.moveTo(L[0], L[1]);
          for (let i = 2; i < L.length; i += 2) g.lineTo(L[i], L[i + 1]);
          for (let i = Rr.length - 2; i >= 0; i -= 2) g.lineTo(Rr[i], Rr[i + 1]);
          g.closePath();
          g.fillStyle = 'rgba(52,56,62,0.95)';
          g.fill();
          g.strokeStyle = 'rgba(228,222,210,0.45)';
          g.lineWidth = 1.2;
          g.stroke();
          g.fillStyle = 'rgba(228,222,210,0.45)';
          for (let i = 0; i < divs.length; i += 2) g.fillRect(divs[i] - 0.6, divs[i + 1] - 0.6, 1.2, 1.2);
        }
        for (const cs of crossings()) {
          if (cs < s0 || cs > s1) continue;
          const c = centreAt(-cs), t = centreTangent(-cs), nx = t.z, nz = -t.x;
          g.beginPath();
          this._project(c.x - nx * 60, c.z - nz * 60, px, pz, fwdX, fwdZ, pt); g.moveTo(pt[0], pt[1]);
          this._project(c.x + nx * 60, c.z + nz * 60, px, pz, fwdX, fwdZ, pt); g.lineTo(pt[0], pt[1]);
          g.strokeStyle = 'rgba(52,56,62,0.95)';
          g.lineWidth = CROSS_HALF * 2 * this.scale;
          g.stroke();
        }
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      }
      // centre line
      g.strokeStyle = roadPx > 7 ? 'rgba(228,222,210,0.6)' : 'rgba(228,222,210,0.30)';
      g.lineWidth = 1;
      if (roadPx > 7) g.setLineDash([Math.max(2, 3 * this.scale), Math.max(2, 6 * this.scale)]);
      g.stroke();
      g.setLineDash([]);
    }

    // ---- traffic: dull slabs, because they are obstacles and not opponents ----
    if (traffic && traffic.length) {
      g.fillStyle = 'rgba(150,150,156,0.75)';
      for (const car of traffic) {
        if (!car.visible) continue;
        this._project(car.position.x, car.position.z, px, pz, fwdX, fwdZ, pt);
        if (Math.hypot(pt[0] - R, pt[1] - R) > R - 3) continue;
        g.fillRect(pt[0] - 1.5, pt[1] - 2.5, 3, 5);
      }
    }

    // ---- rivals, in their own bodywork colour: the pack is countable on the
    // radar for the same reason critic round 1 wanted it countable in frame ----
    if (rivals) {
      for (const r of rivals) {
        if (!r || !r.phys) continue;
        this._project(r.phys.pos.x, r.phys.pos.z, px, pz, fwdX, fwdZ, pt);
        const d = Math.hypot(pt[0] - R, pt[1] - R);
        if (d > R - 3) {
          // OFF THE RADAR: a marker on the rim pointing at him. A rider far up
          // or down the road pins to the top / bottom of the rim.
          const ds = r.phys.s - p.s;
          const ang = Math.atan2(pt[0] - R, -(pt[1] - R));
          const a = Math.abs(ds) > this.range * 1.5 ? (ds > 0 ? 0 : Math.PI) : ang;
          const rx = R + Math.sin(a) * (R - 6), ry = R - Math.cos(a) * (R - 6);
          g.fillStyle = '#' + (r.color != null ? r.color.toString(16).padStart(6, '0') : '999999');
          g.globalAlpha = (r.fighter && r.fighter.down ? 0.4 : 1) * A;
          g.save(); g.translate(rx, ry); g.rotate(a);
          g.beginPath(); g.moveTo(0, -4); g.lineTo(3.2, 2); g.lineTo(-3.2, 2); g.closePath(); g.fill();
          g.restore();
          g.globalAlpha = A;
          continue;
        }
        const hex = '#' + (r.color != null ? r.color.toString(16).padStart(6, '0') : '999999');
        g.fillStyle = hex;
        g.globalAlpha = (r.fighter && r.fighter.down ? 0.35 : 1) * A;
        g.beginPath(); g.arc(pt[0], pt[1], 3.1, 0, Math.PI * 2); g.fill();
        g.globalAlpha = A;
      }
    }

    // ---- the rider: a triangle at the centre, always pointing up ----
    g.fillStyle = '#e8e4dc';
    g.beginPath();
    g.moveTo(R, R - 6);
    g.lineTo(R + 4.2, R + 5);
    g.lineTo(R, R + 2.6);
    g.lineTo(R - 4.2, R + 5);
    g.closePath();
    g.fill();
    }
    g.globalAlpha = 1;

    // the zoom controls on the lower rim: [-] zooms out (left), [+] in (right),
    // the current range between them (amber while the game has zoomed out).
    // In the cruise view the band carries the distance to the flag instead.
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, S * 0.80, S, S * 0.2);
    const farK = Math.max(this.calm, this.full);
    if (farK > 0.02 && Number.isFinite(opts.finishS)) {
      g.globalAlpha = farK;
      const left = Math.max(0, opts.finishS - p.s);
      const txt = left >= 1000 ? `${(left / 1000).toFixed(1)} KM` : `${Math.round(left / 10) * 10} M`;
      g.font = `700 ${Math.round(S * 0.12)}px Anton, Rajdhani, system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(236,230,217,0.95)';
      g.fillText(txt, S * 0.54, S * 0.885);
      this._flagIcon(g, S * 0.54 - g.measureText(txt).width / 2 - 10, S * 0.885, 7);
      // how much of the race is behind you
      const frac = Math.min(1, Math.max(0, p.s / Math.max(1, opts.finishS)));
      g.fillStyle = 'rgba(236,230,217,0.18)'; g.fillRect(S * 0.2, S * 0.955, S * 0.6, 2);
      g.fillStyle = 'rgba(227,185,60,0.95)'; g.fillRect(S * 0.2, S * 0.955, S * 0.6 * frac, 2);
      g.globalAlpha = 1 - farK;
    } else g.globalAlpha = 1;
    g.fillStyle = 'rgba(232,228,220,0.9)';
    g.font = `700 ${Math.round(S * 0.14)}px Rajdhani, system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('\u2212', S * 0.30, S * 0.89);
    g.fillText('+', S * 0.70, S * 0.89);
    g.font = `700 ${Math.round(S * 0.085)}px Rajdhani, system-ui, sans-serif`;
    g.fillStyle = this.auto ? 'rgba(255,190,90,0.95)' : 'rgba(232,228,220,0.6)';
    g.fillText(`${Math.round(this.range)}m`, S * 0.5, S * 0.89);
    g.globalAlpha = 1;
    g.restore();

    // ---- bezel, and a sweep tick so the thing reads as live even when the
    // road ahead is dead straight and nothing else in it moves ----
    g.strokeStyle = 'rgba(216,52,42,0.55)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
    const sweep = (this._t * 1.1) % (Math.PI * 2);
    g.strokeStyle = 'rgba(216,52,42,0.30)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(R, R);
    g.lineTo(R + Math.cos(sweep - Math.PI / 2) * (R - 2), R + Math.sin(sweep - Math.PI / 2) * (R - 2));
    g.stroke();
  }
}
