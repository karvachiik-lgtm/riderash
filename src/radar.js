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

  update(dt, player, rivals, traffic) {
    if (!this.cv || !player) return;
    const g = this.ctx, R = this.r, S = this.size;
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
          g.globalAlpha = r.fighter && r.fighter.down ? 0.4 : 1;
          g.save(); g.translate(rx, ry); g.rotate(a);
          g.beginPath(); g.moveTo(0, -4); g.lineTo(3.2, 2); g.lineTo(-3.2, 2); g.closePath(); g.fill();
          g.restore();
          g.globalAlpha = 1;
          continue;
        }
        const hex = '#' + (r.color != null ? r.color.toString(16).padStart(6, '0') : '999999');
        g.fillStyle = hex;
        g.globalAlpha = r.fighter && r.fighter.down ? 0.35 : 1;
        g.beginPath(); g.arc(pt[0], pt[1], 3.1, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
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

    // the zoom controls on the lower rim: [-] zooms out (left), [+] in (right),
    // the current range between them (amber while the game has zoomed out)
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, S * 0.80, S, S * 0.2);
    g.fillStyle = 'rgba(232,228,220,0.9)';
    g.font = `${Math.round(S * 0.13)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('\u2212', S * 0.30, S * 0.89);
    g.fillText('+', S * 0.70, S * 0.89);
    g.font = `${Math.round(S * 0.075)}px sans-serif`;
    g.fillStyle = this.auto ? 'rgba(255,190,90,0.95)' : 'rgba(232,228,220,0.6)';
    g.fillText(`${Math.round(this.range)}m`, S * 0.5, S * 0.89);
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
