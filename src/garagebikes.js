// RideRash — the garage cards' bikes: a small model of each machine, standing
// still in its card, that turns slowly through 360 degrees while the card is
// hovered (or focused from the keyboard / pad).
//
// ONE RENDERER FOR EVERY CARD. A WebGL context per card would be six contexts
// on the title screen next to the game's own; browsers cap them and drop the
// oldest. Instead one small offscreen renderer draws each bike and the frame is
// copied into that card's plain 2D canvas (drawImage straight after render, so
// no preserveDrawingBuffer). A still card costs nothing after its one draw; only
// the card being hovered is redrawn, and only while it moves.
//
// THE MODEL IS THE GAME'S. The same prototype the race loads for that tier
// (kit.js BIKE_FOR_TIER -> bikeSource) in the same livery (paintBike), so the
// card shows the machine you will actually ride.
import * as THREE from 'three';
import { BIKE_FOR_TIER, bikeSource, paintBike } from './kit.js';
import { cloneWithJoints } from './rigclone.js';

export const GARAGE_BIKE = {
  REST_YAW: 1.1,       // rad: the resting three-quarter profile, front to the right
  FILL: 0.62,          // of the bounding-sphere fit: a bike is long and flat, the sphere is not
  TURN_S: 6,           // s per revolution while hovered: slow, a turntable
  EASE: 5,             // 1/s: back to rest once the pointer leaves
  PITCH: 0.2,          // rad the camera looks down on it
  DPR_MAX: 2,
};

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

export class GarageBikes {
  constructor() {
    this.assets = null;
    this.models = new Map();     // bike id -> { root, radius, centre }
    this.cards = new Set();      // live bindings { canvas, bike, yaw, spin }
    this.renderer = null;
    this._raf = 0;
    this._last = 0;
    this._tick = (now) => this._frame(now);
  }

  /** The game's assets are loaded: draw every card that was waiting for them. */
  setAssets(assets) {
    this.assets = assets;
    for (const c of this.cards) this._draw(c);
  }

  /**
   * Give a card its bike. `card` is the button (hover / focus target), `canvas`
   * the 2D canvas inside it, `bike` the career BIKES entry.
   */
  bind(card, canvas, bike) {
    // cards are rebuilt from scratch on every refresh: forget the old ones
    for (const c of this.cards) if (!c.canvas.isConnected) this.cards.delete(c);
    const c = { canvas, bike, yaw: GARAGE_BIKE.REST_YAW, spin: false };
    this.cards.add(c);
    const on = () => { if (reduced()) return; c.spin = true; this._wake(); };
    const off = () => { c.spin = false; this._wake(); };
    card.addEventListener('pointerenter', on);
    card.addEventListener('pointerleave', off);
    card.addEventListener('focus', on);
    card.addEventListener('blur', off);
    this._draw(c);
    return c;
  }

  _model(bike) {
    let m = this.models.get(bike.id);
    if (m) return m;
    const src = bikeSource(this.assets, BIKE_FOR_TIER[bike.id] || 'sport');
    if (!src) return null;
    const root = cloneWithJoints(src);
    if (bike.colour != null) paintBike(root, bike.colour, 0xd8d2c4);   // the player's livery (player.setBike)
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    // turn about the machine's own middle, not its origin
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    root.position.set(-centre.x, -centre.y, -centre.z);
    pivot.add(root);
    m = { root: pivot, radius: box.getSize(new THREE.Vector3()).length() / 2 };
    this.models.set(bike.id, m);
    return m;
  }

  _setup() {
    if (this.renderer) return true;
    try {
      const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      r.setClearColor(0x000000, 0);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
    } catch (e) { this.renderer = null; return false; }
    // studio light: a warm key from the front-right, a cool rim from behind,
    // a soft sky fill -- the locked style's low warm sun and cool bounce
    const s = this.scene = new THREE.Scene();
    s.add(new THREE.HemisphereLight(0xcfd8e6, 0x2a2622, 1.35));
    const key = new THREE.DirectionalLight(0xffe2bf, 2.4); key.position.set(3, 4, 4); s.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.3); rim.position.set(-4, 2.5, -3); s.add(rim);
    this.camera = new THREE.PerspectiveCamera(26, 2, 0.05, 50);
    return true;
  }

  _draw(c) {
    if (!this.assets || !c.canvas.isConnected || !this._setup()) return;
    const m = this._model(c.bike);
    if (!m) return;
    const cv = c.canvas;
    const dpr = Math.min(GARAGE_BIKE.DPR_MAX, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const r = this.renderer;
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    // frame the whole machine at any aspect: fit its bounding sphere to the
    // tighter of the two fields of view
    const cam = this.camera;
    cam.aspect = w / h;
    const vf = THREE.MathUtils.degToRad(cam.fov) / 2, hf = Math.atan(Math.tan(vf) * cam.aspect);
    const dist = m.radius / Math.sin(Math.min(vf, hf)) * GARAGE_BIKE.FILL;
    cam.position.set(0, Math.sin(GARAGE_BIKE.PITCH) * dist, Math.cos(GARAGE_BIKE.PITCH) * dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    m.root.rotation.y = c.yaw;
    this.scene.add(m.root);
    r.render(this.scene, cam);
    this.scene.remove(m.root);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.domElement, 0, 0, w, h);
  }

  _wake() {
    if (this._raf) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  _frame(now) {
    this._raf = 0;
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    let moving = false;
    for (const c of this.cards) {
      if (!c.canvas.isConnected) { this.cards.delete(c); continue; }
      if (c.spin) {
        c.yaw += dt * Math.PI * 2 / GARAGE_BIKE.TURN_S;
      } else {
        // back to rest the short way round
        let e = GARAGE_BIKE.REST_YAW - c.yaw;
        e -= Math.round(e / (Math.PI * 2)) * Math.PI * 2;
        if (Math.abs(e) < 0.002) { if (c.yaw !== GARAGE_BIKE.REST_YAW) { c.yaw = GARAGE_BIKE.REST_YAW; this._draw(c); } continue; }
        c.yaw += e * Math.min(1, dt * GARAGE_BIKE.EASE);
      }
      this._draw(c);
      moving = true;
    }
    if (moving) this._raf = requestAnimationFrame(this._tick);
  }
}
