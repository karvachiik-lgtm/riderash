// SHOWROOM — the character designer, and the maths interface for body placement.
//
// WHAT THIS IS FOR. Two jobs, and they are the same job:
//
//   1. A player-facing designer: sliders on the right, a live figure on the
//      left, saved to the career.
//   2. The place where body placement is worked out and SEEN. Every dimension
//      the rig uses is derived in src/bodyspec.js from the numbers these sliders
//      set, so this screen is the read-out of that maths. If a proportion is
//      wrong it is wrong HERE, visibly, before it reaches the game -- which is
//      how the rigging gets developed rather than guessed at.
//
// THE STAGE. The figure stands on a measured ground plane, lit on a turntable,
// with a dimension line down the side. The camera is orthographic so the figure
// does not change size as it turns, which is the whole point of a fitting room:
// you are comparing proportions, and perspective lies about them.
//
// NOT A SEPARATE RENDERER. The showroom reuses the game's renderer and its
// canvas, and switches the scene it draws, so there is one WebGL context and no
// second one to lose. `main.js` calls `showroom.frame()` instead of the game
// frame while the designer is open.

import * as THREE from 'three';
import { makeSpec, BUILDS, makeLook, LOOK_OPTIONS } from './bodyspec.js';
import { SCENES, buildScene, disposeScene } from './showscenes.js';
import { FLAG_OUTFITS, flagOutfitSpec } from './flagger.js';
import { cloneWithJoints } from './rigclone.js';
import { RIDING } from './reach.js';
import { CFG } from './config.js';
import { ATTACKS } from './combat.js';
import { clearAxes, applyAction, poseSeated, poseStanding, poseCombat, solveSeat, actionDuration, armAim, contrapposto } from './riderpose.js';
// The race's own rider builder. assets/rider.js may not import anything, but it
// may be imported: building the body here, from the live spec, is what makes a
// slider change the figure rather than just the numbers under it.
import buildRider from '../assets/rider.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PLAYER_CHAIN, setPlayerChain, CHAIN_LIMITS, CHAIN_MATERIALS, CHAIN_DEFAULTS, linkCount, chainAttack, chainState } from './chainweapon.js';

// The seat mount, read from the SAME config the game uses so the designer and the
// race cannot disagree about where the saddle is.
const CFG_SEAT = { x: CFG.SEAT_X, y: CFG.SEAT_Y, z: CFG.SEAT_Z };

// The palettes. Leathers and helmets are deliberately limited to plausible
// motorcycle kit rather than a colour wheel: a designer that lets you make a
// neon-green helmet makes every screenshot of the game worse.
// Leathers stay motorcycle-plausible; a TEE or a HOODIE can be any colour a
// shirt comes in, so the top palette runs from the leathers into brights.
export const PALETTE = {
  jacket: [0x2a2624, 0x1f2b3a, 0x4a1f1f, 0x24331f, 0x3a2a12, 0x6b6259, 0xd8d2c4, 0x14282a,
           0xf0efe8, 0x121314, 0xb3261e, 0x2a4fb0, 0xc8b48a, 0xd46a9a, 0xe08a2a, 0x4a7a4a],
  pants:  [0x3b4a63, 0x23262a, 0x2f3b2a, 0x4a3a22, 0x5a5f66, 0x1a1d20, 0x6d4a2a, 0xc8b48a, 0xe9e4da],
  helmet: [0xd8d2c4, 0x1a1d20, 0xd4622a, 0x2f4a6b, 0x8a1f1f, 0x3f5a3a, 0xb9a44a, 0xf0efe8, 0x7a2a8a, 0x2a8a8a],
  accent: [0xd4622a, 0xd8d2c4, 0xc4b03a, 0x3f8a6b, 0x8a3f6b, 0x2a6bd4, 0x1a1d20, 0xe0302a],
  skin:   [0xf1c9a5, 0xe0ac87, 0xc68e64, 0x9c7358, 0x7a5236, 0x5a3a24, 0x3f2a1c],
  hair:   [0x1a1512, 0x3b2616, 0x6b4526, 0xb08850, 0xe0cc8a, 0x9a9a9a, 0xe8e8e8, 0xc23a2a, 0x2a6bd4, 0x3fbf6b, 0xd44aa0],
  ink:    [0x1c2433, 0x121212, 0x6a1a1a, 0x1a3a5a],
  glove:  [0x232020, 0x1a1d20, 0x4a1f1f, 0x6b4a2a, 0xd8d2c4],
  boot:   [0x1f1c1a, 0x3a2a1a, 0x6b4a2a, 0xe9e4da, 0x121314],
  scarf:  [0x8a1f1f, 0x1f2b3a, 0x121314, 0xd8d2c4, 0x3f5a3a],
};
// The wardrobe controls, one row each: [look key, label, choices].
const CHOICE_LABELS = {
  full: 'Full-face', open: 'Open-face',
  smoke: 'Smoke', clear: 'Clear', gold: 'Gold', blue: 'Blue', mirror: 'Mirror',
  racing: 'Racing', twin: 'Twin', gloss: 'Gloss', matte: 'Matte',
  short: 'Short', buzz: 'Buzz', mohawk: 'Mohawk', spikes: 'Spikes', slick: 'Slick', long: 'Long',
  ponytail: 'Ponytail', bun: 'Bun', afro: 'Afro', dreads: 'Dreads', bald: 'Bald',
  stubble: 'Stubble', goatee: 'Goatee', moustache: 'Tache',
  leather: 'Leathers', tee: 'T-shirt', tank: 'Tank', hoodie: 'Hoodie', vest: 'Vest',
  tribal: 'Tribal', sleeve: 'Sleeve', flames: 'Flames', bands: 'Bands', neck: 'Neck',
  shades: 'Shades', aviator: 'Aviator', goggles: 'Goggles', silver: 'Silver',
  bandana: 'Bandana', fingerless: 'Fingerless',
  crop: 'Crop top', dress: 'Dress', jeans: 'Jeans', shorts: 'Shorts', skirt: 'Skirt',
  plain: 'Plain', floral: 'Floral', dots: 'Polka', stripes: 'Stripes', m: 'Masculine', f: 'Feminine',
  sunhat: 'Sun hat', cap: 'Cap', cowboy: 'Cowboy', flannel: 'Flannel', denimjacket: 'Denim jacket',
  bikini: 'Bikini', onepiece: 'Swimsuit', plaid: 'Plaid', stars: 'Stars', boots: 'Boots', low: 'Low shoes', sneakers: 'Sneakers',
};
const KEY_LABELS = {
  helmet: { none: 'No lid' }, beard: { full: 'Full beard', none: 'Clean' },
  gloves: { full: 'Race gloves', none: 'Bare hands' }, tattoo: { none: 'No ink' },
};
const lbl = (key, v) => (KEY_LABELS[key] && KEY_LABELS[key][v]) || CHOICE_LABELS[v] || (v === 'none' ? 'None' : v);

// STANCE: where the body is. ANIMS: what it is doing there. Two rows of
// buttons, because "on the bike, punching" and "standing, punching" are both
// real questions a player asks of their rider.
const STANCES = [
  { key: 'ride', label: 'Ride' },
  { key: 'stand', label: 'Stand' },
  { key: 'crash', label: 'Crash' },
];
const ANIMS = [
  { key: 'idle', label: 'Idle' },
  { key: 'walk', label: 'Walk', stance: 'stand' },
  { key: 'punch', label: 'Punch' },
  { key: 'kick', label: 'Kick' },
  { key: 'chain', label: 'Chain' },
  { key: 'grab', label: 'Grab' },
  { key: 'hit', label: 'Hit' },
  { key: 'tuck', label: 'Tuck', stance: 'ride' },
  // EMOTES: original celebration moves, played on foot. Procedural, like every
  // other motion here -- keyframed by function, no clips.
  { key: 'wave', label: 'Wave', stance: 'stand', emote: true },
  { key: 'victory', label: 'Victory', stance: 'stand', emote: true },
  { key: 'groove', label: 'Groove', stance: 'stand', emote: true },
  { key: 'robot', label: 'Robot', stance: 'stand', emote: true },
  { key: 'guitar', label: 'Air guitar', stance: 'stand', emote: true },
  { key: 'headbang', label: 'Headbang', stance: 'stand', emote: true },
  { key: 'flex', label: 'Flex', stance: 'stand', emote: true },
  { key: 'spin', label: 'Spin', stance: 'stand', emote: true },
];
// Loop lengths (s), each ending in a short rest so the motion reads as a move.
// The chain's loop is long enough to watch it settle and sway after the crack
// (a 1.6 m chain takes ~1.5 s to stop swinging).
const LOOP = { idle: 4, walk: 1.2, punch: 1.1, kick: 1.3, chain: 2.4, grab: 2.6, hit: 1.6, tuck: 3.2,
  wave: 2.4, victory: 2.0, groove: 2.0, robot: 3.2, guitar: 2.4, headbang: 1.6, flex: 3.0, spin: 2.6 };

// One-click starting points, so a player can land on a character and tweak it
// instead of assembling one from four sliders and a palette.
// STYLE PRESETS: whole characters -- body, colours and wardrobe -- so a player
// lands on a look and tweaks it. Original archetypes, not real people.
export const PRESETS = {
  Racer:   { height: 1.72, build: 'lean',   shoulderWide: 0.94, limbLong: 1.04,
             colors: { jacket: 0x1f2b3a, pants: 0x23262a, helmet: 0xf0efe8, accent: 0x2a6bd4 },
             look: { stripe: 'twin', visor: 'blue' } },
  Brawler: { height: 1.86, build: 'heavy',  shoulderWide: 1.16, limbLong: 0.98,
             colors: { jacket: 0x2a2624, pants: 0x3b4a63, helmet: 0x1a1d20, accent: 0xd4622a },
             look: { finish: 'matte', spikes: true } },
  Veteran: { height: 1.78, build: 'stocky', shoulderWide: 1.06, limbLong: 1.00,
             colors: { jacket: 0x3a2a12, pants: 0x4a3a22, helmet: 0xb9a44a, accent: 0xd8d2c4 },
             look: { helmet: 'open', beard: 'full', hairColor: 0x9a9a9a, glasses: 'goggles', scarf: 'bandana', scarfColor: 0x8a1f1f } },
  Rookie:  { height: 1.62, build: 'normal', shoulderWide: 0.92, limbLong: 1.02,
             colors: { jacket: 0x4a1f1f, pants: 0x5a5f66, helmet: 0xd4622a, accent: 0xc4b03a },
             look: { backpack: true } },
  // "just a white tee": the clean, sharp-jaw minimalist
  'Clean Cut': { height: 1.84, build: 'lean', shoulderWide: 1.08, limbLong: 1.02,
             colors: { jacket: 0xf0efe8, pants: 0x3b4a63, helmet: 0x1a1d20, accent: 0x1a1d20, skin: 0xe0ac87 },
             look: { helmet: 'none', top: 'tee', hair: 'slick', hairColor: 0x3b2616, gloves: 'none', bootColor: 0xe9e4da } },
  // the stadium visionary: all-black oversized hoodie, shades, gold
  Headliner: { height: 1.74, build: 'normal', shoulderWide: 1.0, limbLong: 1.0,
             colors: { jacket: 0x121314, pants: 0x1a1d20, helmet: 0x121314, accent: 0xc4b03a, skin: 0x5a3a24 },
             look: { helmet: 'none', top: 'hoodie', hair: 'buzz', hairColor: 0x1a1512, beard: 'stubble', glasses: 'shades',
                     chain: 'gold', earring: true, gloves: 'none', bootColor: 0x121314 } },
  'Street Punk': { height: 1.70, build: 'lean', shoulderWide: 0.96, limbLong: 1.04,
             colors: { jacket: 0x121314, pants: 0x23262a, helmet: 0x121314, accent: 0xe0302a, skin: 0xf1c9a5 },
             look: { helmet: 'none', top: 'tank', hair: 'mohawk', hairColor: 0xc23a2a, tattoo: 'sleeve', spikes: true,
                     gloves: 'fingerless', earring: true, chain: 'silver' } },
  Outlaw:  { height: 1.82, build: 'heavy', shoulderWide: 1.14, limbLong: 0.98,
             colors: { jacket: 0x2a2624, pants: 0x3b4a63, helmet: 0x1a1d20, accent: 0x8a1f1f, skin: 0xc68e64 },
             look: { helmet: 'open', top: 'vest', hair: 'long', hairColor: 0x3b2616, beard: 'full', tattoo: 'tribal',
                     glasses: 'shades', scarf: 'bandana', scarfColor: 0x1f2b3a, gloves: 'fingerless', finish: 'matte' } },
  Nomad:   { height: 1.76, build: 'lean', shoulderWide: 0.98, limbLong: 1.06,
             colors: { jacket: 0xc8b48a, pants: 0x6d4a2a, helmet: 0xd8d2c4, accent: 0x6d4a2a, skin: 0x7a5236 },
             look: { helmet: 'open', top: 'tee', hair: 'dreads', hairColor: 0x1a1512, glasses: 'goggles', scarf: 'bandana',
                     scarfColor: 0xd8d2c4, backpack: true, tattoo: 'bands', gloveColor: 0x6b4a2a, bootColor: 0x6b4a2a } },
  'Night Shift': { height: 1.78, build: 'normal', shoulderWide: 1.0, limbLong: 1.02,
             colors: { jacket: 0x1f2b3a, pants: 0x121314, helmet: 0x121314, accent: 0x2a8a8a },
             look: { top: 'hoodie', visor: 'mirror', stripe: 'twin', finish: 'matte', hair: 'ponytail' } },
  Showboat: { height: 1.80, build: 'stocky', shoulderWide: 1.1, limbLong: 1.0,
             colors: { jacket: 0xe08a2a, pants: 0xe9e4da, helmet: 0xc4b03a, accent: 0xd46a9a, skin: 0x7a5236 },
             look: { helmet: 'none', top: 'tee', hair: 'afro', hairColor: 0x1a1512, beard: 'moustache', glasses: 'aviator',
                     chain: 'gold', earring: true, gloves: 'none', bootColor: 0xe9e4da } },
  'Speed Demon': { height: 1.68, build: 'lean', shoulderWide: 0.92, limbLong: 1.06,
             colors: { jacket: 0xb3261e, pants: 0x121314, helmet: 0xb3261e, accent: 0xf0efe8 },
             look: { visor: 'gold', helmetSize: 1.08, hair: 'mohawk', hairColor: 0xf0efe8, gloveColor: 0x1a1d20 } },
};

export class Showroom {
  constructor(renderer, gameScene, gameCamera) {
    this.renderer = renderer;
    this.gameScene = gameScene;
    this.gameCamera = gameCamera;

    // ---- the stage: its own scene, so the game world is untouched ----
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16191c);

    // Orthographic, so the figure does not foreshorten as it turns. Frustum is
    // sized in METRES so a 2.05 m figure and a 1.50 m figure are compared on the
    // same scale and the height difference is real on screen.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
    this.camera.position.set(0, 0.95, 4.6);
    this.camera.lookAt(0, 0.95, 0);

    // ---- lighting: a key, a fill and a rim, which is what makes a body read
    // in three dimensions rather than as a flat silhouette. Brighter than the
    // first version, which left the leathers a black shape on a black room. ----
    const key = new THREE.DirectionalLight(0xfff4e2, 3.2); key.position.set(2.6, 4.2, 3.4);
    const fill = new THREE.DirectionalLight(0x9db4d0, 1.2); fill.position.set(-3.2, 1.6, 2.2);
    const rim = new THREE.DirectionalLight(0xffb45a, 1.6); rim.position.set(-1.4, 2.4, -3.6);
    const hemi = new THREE.HemisphereLight(0xc9d4e0, 0x2a2520, 1.4);
    this.scene.add(key, fill, rim, hemi);
    // the key casts: a rider standing on a set with no shadow floats over it
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.8, bottom: -1.2, near: 0.5, far: 14 });
    key.shadow.bias = -0.0005;
    this.lights = { key, fill, rim, hemi };
    this.brightness = 1;
    // AN ENVIRONMENT, because the leathers, helmet and paint are clearcoat PBR
    // materials: with nothing to reflect they rendered as black shapes on a
    // black room. A neutral studio is what a fitting room would be lit by.
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.85;
      pm.dispose();
    } catch (e) { /* lights alone still show the figure */ }

    // THE SET: a whole scene behind the figure (src/showscenes.js) -- the old
    // grey disc and ruler grid are the Studio set now.
    this.set_ = null;
    this.sceneKey = 'garage';
    try { const k = localStorage.getItem('riderash.showscene'); if (SCENES.some((x) => x.key === k)) this.sceneKey = k; } catch (e) { /* no storage */ }
    // PORTRAIT LENS by default: a long perspective lens, so the set has depth
    // and the floor is seen. FITTING is the old orthographic view, kept for
    // comparing proportions (perspective lies about them a little).
    this.lens = 'portrait';
    this.focus = 'full';          // full | rider | face
    this.pcam = new THREE.PerspectiveCamera(24, 1, 0.1, 600);
    this.useScene(this.sceneKey);

    // turntable the figure stands on
    this.turn = new THREE.Group();
    this.scene.add(this.turn);

    this.spec = makeSpec({});
    this.body = null;
    this.bike = null;           // the machine the rider is seated on
    this.socket = null;
    this.bikeAsset = null;
    this.stance = 'ride';
    this.anim = 'idle';
    this.animT = 0;
    this.spin = 0.22;           // rad/s, slow enough to read
    // START AT THREE-QUARTERS: a pure side view hides the bars behind the rider
    // and the far fork behind the near one -- exactly the contacts this screen
    // exists to show.
    this.turnPhase = -0.85;
    this.zoom = 1;
    this._dirty = true;         // body needs rebuilding from the spec
    this._frameDirty = true;    // camera framing needs re-measuring
    this._holdSpin = 0;         // s the auto-turn stays paused after a drag
    this.el = null;
    // THE CHAIN PREVIEW: slow motion, a close-up on the swinging arm, and an
    // airflow (the stage does not move, so the air does -- see chainweapon.js
    // `__chainWind`).
    this.timeScale = 1;
    this.chainCam = true;
    this.airspeed = 20;         // m/s the showroom rider "rides" at
    this._clock = 0;            // monotonic, scaled: the chain sim's step clock
    this._focus = null;         // smoothed close-up centre
    this._peak = 0;             // tip speed peak of the last swing (m/s)
  }

  /** Swap the set behind the figure and relight the stage to match it. */
  useScene(key) {
    if (this.set_) { this.scene.remove(this.set_); disposeScene(this.set_); }
    const { group, light } = buildScene(key);
    this.sceneKey = SCENES.some((x) => x.key === key) ? key : 'studio';
    this.set_ = group;
    this.scene.add(group);
    this._light = light;
    this._relight();
    this.scene.fog = light.fog ? new THREE.Fog(light.fog[0], light.fog[1], light.fog[2]) : null;
    this.scene.background = new THREE.Color(light.bg ?? 0x16191c);
    try { localStorage.setItem('riderash.showscene', this.sceneKey); } catch (e) { /* no storage */ }
    this._frameDirty = true;
    if (this.el) this._syncUI();
  }

  _relight() {
    const L = this._light, k = this.brightness;
    if (!L) return;
    const { key, fill, rim, hemi } = this.lights;
    key.color.setHex(L.key[0]); key.intensity = L.key[1] * k;
    key.position.fromArray(L.keyPos || [2.6, 4.2, 3.4]);
    fill.color.setHex(L.fill[0]); fill.intensity = L.fill[1] * k;
    rim.color.setHex(L.rim[0]); rim.intensity = L.rim[1] * k;
    hemi.color.setHex(L.hemi[0]); hemi.groundColor.setHex(L.hemi[1]); hemi.intensity = L.hemi[2] * k;
    this.scene.environmentIntensity = (L.env ?? 0.85) * k;
  }

  /** The camera the stage is drawn with. */
  get viewCam() { return this.lens === 'fitting' ? this.camera : this.pcam; }

  /**
   * The bike the body is judged against. The RIDER is no longer taken from a
   * prebuilt asset: it is built HERE, from the spec, by the same builder the
   * race uses -- which is the fix for "the sliders don't work". They did change
   * the spec; the figure was a clone of the one built at boot, so its limbs
   * never changed length and only the seat offset moved, opening a gap between
   * a 2.0 m spec and a 1.75 m body on the saddle.
   */
  useAsset(_asset, bikeAsset) {
    if (bikeAsset) this.bikeAsset = bikeAsset;
  }

  attach() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('showroom'), stage: $('showstage'), spec: $('showspec'),
      height: $('s-height'), vHeight: $('v-height'),
      shoulders: $('s-shoulders'), vShoulders: $('v-shoulders'),
      limbs: $('s-limbs'), vLimbs: $('v-limbs'),
      builds: $('s-builds'), stance: $('s-pose'), anims: $('s-anim'),
      presets: $('s-presets'), done: $('s-done'), random: $('s-random'), emotes: $('s-emote'),
      fit: $('s-fit'),
    };
    this._buildControls();
    this._bindStage();
    addEventListener('resize', () => { this._frameDirty = true; });
  }

  _buildControls() {
    const e = this.el;
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    const btn = (host, cls, label, on, data) => {
      const b = document.createElement('button');
      b.className = cls; b.textContent = label; b.onclick = on;
      if (data) Object.assign(b.dataset, data);
      host.appendChild(b);
      return b;
    };
    // Every control registers a sync function; _syncUI runs them all, so a
    // preset, a randomise or a slider leaves every button showing the truth.
    this._syncers = [];
    const grp = (host, title) => {
      const g = document.createElement('div');
      g.className = 'grp';
      if (title) { const h = document.createElement('h3'); h.textContent = title; g.appendChild(h); }
      host.appendChild(g);
      return g;
    };
    const sub = (host, text) => { const d = document.createElement('div'); d.className = 'sub'; d.textContent = text; host.appendChild(d); };
    const chips = (host, key, list = LOOK_OPTIONS[key]) => {
      const row = document.createElement('div'); row.className = 'chips'; host.appendChild(row);
      for (const v of list) btn(row, 'bd', lbl(key, v), () => this.set({ look: { [key]: v } }), { v });
      this._syncers.push(() => { for (const b of row.children) b.classList.toggle('sel', b.dataset.v === String(this.spec.look[key])); });
    };
    const toggles = (host, keys) => {
      const row = document.createElement('div'); row.className = 'chips'; host.appendChild(row);
      for (const [key, label] of keys) btn(row, 'bd', label, () => this.set({ look: { [key]: !this.spec.look[key] } }), { k: key });
      this._syncers.push(() => { for (const b of row.children) b.classList.toggle('sel', !!this.spec.look[b.dataset.k]); });
    };
    // colour row: `where` is 'colors' or 'look'
    const swatches = (host, where, key, list) => {
      const row = document.createElement('div'); row.className = 'swatches'; host.appendChild(row);
      for (const col of list) {
        const sw = btn(row, 'sws', '', () => this.set({ [where]: { [key]: col } }), { col });
        sw.style.background = hex(col);
        sw.setAttribute('aria-label', key + ' ' + hex(col));
      }
      this._syncers.push(() => { for (const sw of row.children) sw.classList.toggle('sel', +sw.dataset.col === this.spec[where][key]); });
    };
    const slider = (host, label, min, max, step, get, put, fmt) => {
      const r = document.createElement('div'); r.className = 'row2';
      r.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span>`;
      host.appendChild(r);
      const [, inp, val] = r.children;
      inp.addEventListener('input', () => put(parseFloat(inp.value)));
      this._syncers.push(() => { const v = get(); inp.value = v; val.textContent = fmt(v); });
    };

    // ---- tabs ----
    const TABS = [['looks', 'Looks'], ['body', 'Body'], ['head', 'Head'], ['outfit', 'Outfit'], ['chain', 'Chain'], ['scene', 'Scene']];
    const tabs = document.getElementById('s-tabs');
    this.tab = 'looks';
    if (tabs) {
      tabs.innerHTML = '';
      for (const [k, label] of TABS) btn(tabs, '', label, () => this.showTab(k), { tab: k });
    }

    // ---- LOOKS: style presets, each with its colour dots ----
    if (e.presets) {
      e.presets.innerHTML = '';
      for (const [name, P] of Object.entries(PRESETS)) {
        const b = btn(e.presets, '', '', () => this.applyPreset(name), { preset: name });
        const dots = document.createElement('span'); dots.className = 'dots';
        const L = P.look || {};
        for (const c of [L.helmet === 'none' ? (L.hairColor ?? 0x2a1d14) : P.colors.helmet, P.colors.jacket, P.colors.accent]) {
          const i = document.createElement('i'); i.style.background = hex(c); dots.appendChild(i);
        }
        b.appendChild(dots);
        b.appendChild(document.createTextNode(name));
      }
    }

    // ---- LOOKS: the race starter's outfits, to try on ----
    const looksTab = document.querySelector('#panel .tab[data-tab="looks"]');
    if (looksTab && !document.getElementById('s-starter')) {
      const g = grp(looksTab, 'Starter looks');
      const grid = document.createElement('div'); grid.className = 'pgrid'; grid.id = 's-starter'; g.appendChild(grid);
      for (const name of Object.keys(FLAG_OUTFITS)) {
        const O = FLAG_OUTFITS[name];
        const b = btn(grid, '', '', () => this.applyPreset(name), { preset: name });
        const dots = document.createElement('span'); dots.className = 'dots';
        for (const c of [O.look.hairColor, O.colors.jacket, O.colors.accent]) { const i = document.createElement('i'); i.style.background = hex(c); dots.appendChild(i); }
        b.appendChild(dots); b.appendChild(document.createTextNode(name));
      }
      this._syncers.push(() => { for (const b of grid.children) b.classList.toggle('sel', b.dataset.preset === this._preset); });
    }

    // ---- BODY ----
    e.builds.innerHTML = '';
    for (const [key, b] of Object.entries(BUILDS)) {
      btn(e.builds, 'bd', b.label, () => this.set({ build: key }), { build: key });
    }
    const skinHost = document.getElementById('s-skin');
    if (skinHost) { skinHost.remove(); swatches(document.querySelector('#panel .tab[data-tab="body"] .grp:last-child'), 'colors', 'skin', PALETTE.skin); }
    const bodyTab = document.querySelector('#panel .tab[data-tab="body"]');
    if (bodyTab && !bodyTab.querySelector('.figure')) {
      const g = grp(bodyTab, 'Figure'); g.classList.add('figure'); chips(g, 'figure');
      slider(g, 'Bust', 0.7, 2.0, 0.01, () => this.spec.look.bust, (v) => this.set({ look: { bust: v } }), (v) => Math.round(v * 100) + '%');
      slider(g, 'Seat', 0.6, 2.0, 0.01, () => this.spec.look.seat, (v) => this.set({ look: { seat: v } }), (v) => Math.round(v * 100) + '%');
      sub(g, 'Bust and seat apply to the feminine figure');
    }

    // ---- HEAD ----
    const H = document.getElementById('t-head');
    if (H) {
      H.innerHTML = '';
      let g = grp(H, 'Helmet');
      chips(g, 'helmet');
      slider(g, 'Size', 0.85, 1.3, 0.01, () => this.spec.look.helmetSize, (v) => this.set({ look: { helmetSize: v } }), (v) => Math.round(v * 100) + '%');
      swatches(g, 'colors', 'helmet', PALETTE.helmet);
      sub(g, 'Visor'); chips(g, 'visor');
      sub(g, 'Stripe'); chips(g, 'stripe');
      sub(g, 'Finish'); chips(g, 'finish');
      g = grp(H, 'Hair');
      chips(g, 'hair');
      swatches(g, 'look', 'hairColor', PALETTE.hair);
      sub(g, 'Under a full-face lid only a mohawk (as a crest), long hair, a ponytail or dreads show');
      g = grp(H, 'Face');
      slider(g, 'Head size', 0.85, 1.8, 0.01, () => this.spec.look.headSize, (v) => this.set({ look: { headSize: v } }), (v) => Math.round(v * 100) + '%');
      sub(g, 'Facial hair'); chips(g, 'beard');
      sub(g, 'Eyewear'); chips(g, 'glasses');
      sub(g, 'Hat (without a lid)'); chips(g, 'hat');
      toggles(g, [['earring', 'Earrings']]);
    }

    // ---- OUTFIT ----
    const O = document.getElementById('t-outfit');
    if (O) {
      O.innerHTML = '';
      let g = grp(O, 'Top');
      chips(g, 'top');
      swatches(g, 'colors', 'jacket', PALETTE.jacket);
      sub(g, 'Print (cloth tops and dresses)'); chips(g, 'pattern');
      g = grp(O, 'Bottoms'); chips(g, 'bottom'); swatches(g, 'colors', 'pants', PALETTE.pants);
      sub(g, 'A dress or swimwear brings its own bottom');
      g = grp(O, 'Accent'); swatches(g, 'colors', 'accent', PALETTE.accent);
      g = grp(O, 'Tattoos');
      chips(g, 'tattoo');
      swatches(g, 'look', 'inkColor', PALETTE.ink);
      sub(g, 'Ink shows on bare skin: pick a T-shirt, tank or vest');
      g = grp(O, 'Hands and feet');
      chips(g, 'gloves');
      swatches(g, 'look', 'gloveColor', PALETTE.glove);
      sub(g, 'Footwear'); chips(g, 'shoes'); swatches(g, 'look', 'bootColor', PALETTE.boot);
      g = grp(O, 'Accessories');
      sub(g, 'Neck chain'); chips(g, 'chain');
      sub(g, 'Scarf'); chips(g, 'scarf');
      swatches(g, 'look', 'scarfColor', PALETTE.scarf);
      toggles(g, [['spikes', 'Shoulder spikes'], ['backpack', 'Backpack']]);
    }

    // ---- SCENE ----
    const SC = document.getElementById('t-scene');
    if (SC) {
      SC.innerHTML = '';
      let g = grp(SC, 'Set');
      const grid = document.createElement('div'); grid.className = 'scn'; g.appendChild(grid);
      for (const sc of SCENES) {
        const b = btn(grid, '', '', () => this.useScene(sc.key), { scene: sc.key });
        const i = document.createElement('i'); i.style.background = sc.swatch; b.appendChild(i);
        b.appendChild(document.createTextNode(sc.label));
      }
      this._syncers.push(() => { for (const b of grid.children) b.classList.toggle('sel', b.dataset.scene === this.sceneKey); });
      g = grp(SC, 'Camera');
      const lens = document.createElement('div'); lens.className = 'chips'; g.appendChild(lens);
      btn(lens, 'bd', 'Portrait', () => { this.lens = 'portrait'; this._frameDirty = true; this._syncUI(); }, { v: 'portrait' });
      btn(lens, 'bd', 'Fitting (flat)', () => { this.lens = 'fitting'; this._frameDirty = true; this._syncUI(); }, { v: 'fitting' });
      this._syncers.push(() => { for (const b of lens.children) b.classList.toggle('sel', b.dataset.v === this.lens); });
      const foc = document.createElement('div'); foc.className = 'chips'; g.appendChild(foc);
      for (const [k, label] of [['full', 'Full'], ['rider', 'Rider'], ['face', 'Face']]) {
        btn(foc, 'bd', label, () => this.setFocus(k), { v: k });
      }
      this._syncers.push(() => { for (const b of foc.children) b.classList.toggle('sel', b.dataset.v === this.focus); });
      slider(g, 'Turntable', 0, 1, 0.01, () => this.spin, (v) => { this.spin = v; }, (v) => (v < 0.01 ? 'off' : v.toFixed(2)));
      slider(g, 'Light', 0.5, 1.6, 0.01, () => this.brightness, (v) => { this.brightness = v; this._relight(); }, (v) => Math.round(v * 100) + '%');
    }

    e.stance.innerHTML = '';
    for (const st of STANCES) btn(e.stance, '', st.label, () => this.setStance(st.key), { stance: st.key });
    if (e.anims) {
      e.anims.innerHTML = '';
      for (const a of ANIMS) if (!a.emote) btn(e.anims, '', a.label, () => this.setAnim(a.key), { anim: a.key });
    }
    if (e.emotes) {
      e.emotes.innerHTML = '';
      for (const a of ANIMS) if (a.emote) btn(e.emotes, '', a.label, () => this.setAnim(a.key), { anim: a.key });
    }
    // Sliders: `input` fires continuously while dragging. The rebuild is
    // deferred to the next frame (`_dirty`), so a fast drag costs one body per
    // frame, not one per event.
    const bind = (input, key) => input.addEventListener('input', () => this.set({ [key]: parseFloat(input.value) }));
    bind(e.height, 'height');
    bind(e.shoulders, 'shoulderWide');
    bind(e.limbs, 'limbLong');
    e.random.onclick = () => this.randomise();
    e.done.onclick = () => this.close();
    this._buildChainPanel();
    this.showTab(this.tab);
  }

  setFocus(k) { this.focus = k; this._focus = null; this._frameDirty = true; this._syncUI(); }

  showTab(k) {
    this.tab = k;
    for (const t of document.querySelectorAll('#panel .tab')) t.classList.toggle('on', t.dataset.tab === k);
    const tabs = document.getElementById('s-tabs');
    if (tabs) for (const b of tabs.children) b.classList.toggle('sel', b.dataset.tab === k);
    // the chain tab previews the swing; the head tab moves in on the face
    if (k === 'chain' && this.anim !== 'chain') this.setAnim('chain');
    if (this.el && this._syncers) {
      if (k === 'head' && this.focus === 'full') this.setFocus('face');
      else if (k !== 'head' && k !== 'scene' && this.focus === 'face') this.setFocus('full');
    }
  }

  /**
   * THE CHAIN PANEL. Built here rather than in index.html so the chain's
   * controls live with the code that reads them. Every change writes
   * PLAYER_CHAIN (chainweapon.js), which is saved and is the object the race's
   * Fighter swings, and switches the preview to the chain swing.
   */
  _buildChainPanel() {
    const panel = document.getElementById('t-chain') || document.getElementById('panel');
    if (!panel || document.getElementById('s-chain')) return;
    const grp = document.createElement('div');
    grp.className = 'grp'; grp.id = 's-chain';
    const L = CHAIN_LIMITS;
    grp.innerHTML = `
      <h3>Chain</h3>
      <div class="row2"><label for="c-length">Length</label>
        <input type="range" id="c-length" min="${L.length[0]}" max="${L.length[1]}" step="0.05">
        <span class="val" id="cv-length"></span></div>
      <div class="row2"><label for="c-link">Link size</label>
        <input type="range" id="c-link" min="${L.link[0]}" max="${L.link[1]}" step="0.005">
        <span class="val" id="cv-link"></span></div>
      <div class="row2"><label for="c-weight">Weight</label>
        <input type="range" id="c-weight" min="${L.weight[0]}" max="${L.weight[1]}" step="0.1">
        <span class="val" id="cv-weight"></span></div>
      <div class="builds" id="c-mat" role="group" aria-label="Chain material"></div>
      <div class="builds" id="c-view" role="group" aria-label="Chain preview"></div>
      <div class="row2"><label for="c-air">Airspeed</label>
        <input type="range" id="c-air" min="0" max="45" step="1">
        <span class="val" id="cv-air"></span></div>
      <div id="c-stats" style="font-size:10px;line-height:1.7;color:#7f858c;letter-spacing:.06em"></div>`;
    const actions = panel.querySelector(':scope > .actions');
    panel.insertBefore(grp, actions || null);
    const $ = (id) => document.getElementById(id);
    const c = this.el.chain = {
      length: $('c-length'), link: $('c-link'), weight: $('c-weight'), air: $('c-air'),
      vLength: $('cv-length'), vLink: $('cv-link'), vWeight: $('cv-weight'), vAir: $('cv-air'),
      mat: $('c-mat'), view: $('c-view'), stats: $('c-stats'),
    };
    const edit = (patch) => {
      setPlayerChain(patch);
      if (this.anim !== 'chain') this.setAnim('chain');
      this._syncChainUI();
    };
    c.length.addEventListener('input', () => edit({ length: parseFloat(c.length.value) }));
    c.link.addEventListener('input', () => edit({ link: parseFloat(c.link.value) }));
    c.weight.addEventListener('input', () => edit({ weight: parseFloat(c.weight.value) }));
    c.air.addEventListener('input', () => { this.airspeed = parseFloat(c.air.value); this._syncChainUI(); });
    for (const [key, m] of Object.entries(CHAIN_MATERIALS)) {
      const b = document.createElement('button');
      b.className = 'bd'; b.textContent = m.label; b.dataset.mat = key;
      b.style.boxShadow = `inset 0 -3px 0 #${m.color.toString(16).padStart(6, '0')}`;
      b.onclick = () => edit({ material: key });
      c.mat.appendChild(b);
    }
    const tog = (label, key, on) => {
      const b = document.createElement('button');
      b.className = 'bd'; b.textContent = label; b.dataset.view = key;
      b.onclick = on;
      c.view.appendChild(b);
    };
    tog('Swing', 'swing', () => { this.setAnim('chain'); this.turnPhase = 0.75; this._holdSpin = 4; });
    tog('Slow-mo', 'slow', () => { this.timeScale = this.timeScale < 1 ? 1 : 0.25; this._syncChainUI(); });
    tog('Close-up', 'cam', () => { this.chainCam = !this.chainCam; this._frameDirty = true; this._syncChainUI(); });
    tog('Reset', 'reset', () => edit({ ...CHAIN_DEFAULTS }));
    this._syncChainUI();
  }

  _syncChainUI() {
    const c = this.el && this.el.chain;
    if (!c) return;
    const C = PLAYER_CHAIN;
    c.length.value = C.length; c.vLength.textContent = C.length.toFixed(2) + ' m';
    c.link.value = C.link; c.vLink.textContent = (C.link * 100).toFixed(1) + ' cm';
    c.weight.value = C.weight; c.vWeight.textContent = C.weight.toFixed(1) + ' kg';
    c.air.value = this.airspeed; c.vAir.textContent = Math.round(this.airspeed * 2.237) + ' mph';
    for (const b of c.mat.children) b.classList.toggle('sel', b.dataset.mat === C.material);
    for (const b of c.view.children) {
      const k = b.dataset.view;
      b.classList.toggle('sel', (k === 'swing' && this.anim === 'chain') || (k === 'slow' && this.timeScale < 1)
        || (k === 'cam' && this.chainCam));
    }
    const base = ATTACKS.chain, sp = chainAttack(base, C);
    // delta vs the stock chain, green when it is the better direction
    const d = (v, b2, u, f = 2, lowerBetter = false) => `<b>${v.toFixed(f)}</b>${u}${Math.abs(v - b2) > 1e-6
      ? ` <span style="color:${((v > b2) !== lowerBetter) ? '#8fc27a' : '#e0704f'}">${v > b2 ? '+' : '−'}${Math.abs(v - b2).toFixed(f)}</span>` : ''}`;
    c.stats.innerHTML =
      `${linkCount(C)} links &nbsp; reach ${d(sp.range, base.range, ' m')}<br>` +
      `wind-up ${d(sp.wind, base.wind, ' s', 2, true)} &nbsp; damage ${d(sp.dmg, base.dmg, '', 0)}<br>` +
      `knock-back ${d(sp.push, base.push, '')} &nbsp; stamina ${sp.stamina}<br>` +
      `tip speed <b id="c-tip">${this._peak ? this._peak.toFixed(0) + ' m/s' : '—'}</b>`;
  }

  /**
   * Drag to turn the figure, wheel -- or pinch, on a phone -- to zoom, and
   * double-click or double-tap to reset. Auto-turn resumes after a pause.
   */
  _bindStage() {
    const st = this.el.stage;
    if (!st) return;
    const pts = new Map();          // pointerId -> clientX/Y, for the pinch
    let drag = null, pinch = null, lastTap = 0;
    const reset = () => { this.zoom = 1; this.turnPhase = -0.85; };
    const spread = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    st.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button, input')) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      try { st.setPointerCapture(ev.pointerId); } catch (err) { /* pointer gone */ }
      if (pts.size === 2) {
        drag = null;                // a second finger turns a drag into a pinch
        pinch = { d: spread(), z: this.zoom };
        return;
      }
      drag = { x: ev.clientX, id: ev.pointerId };
      st.classList.add('dragging');
      // Double-tap: dblclick is unreliable on touch screens, so time it here.
      if (ev.pointerType === 'touch') {
        const now = performance.now();
        if (now - lastTap < 300) reset();
        lastTap = now;
      }
    });
    st.addEventListener('pointermove', (ev) => {
      if (!pts.has(ev.pointerId)) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && pts.size === 2) {
        const d = spread();
        if (pinch.d > 0) this.zoom = THREE.MathUtils.clamp(pinch.z * d / pinch.d, 0.7, 2.6);
        this._holdSpin = 3;
        return;
      }
      if (!drag || ev.pointerId !== drag.id) return;
      this.turnPhase += (ev.clientX - drag.x) * 0.012;
      drag.x = ev.clientX;
      this._holdSpin = 3;
    });
    const end = (ev) => {
      pts.delete(ev.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) { drag = null; st.classList.remove('dragging'); }
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    st.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-ev.deltaY * 0.0012), 0.7, 2.6);
    }, { passive: false });
    st.addEventListener('dblclick', reset);
  }

  /** Any change: rebuild the spec now, the body on the next frame. */
  set(patch) {
    const o = { ...this.spec, ...patch };
    o.colors = { ...this.spec.colors, ...(patch.colors || {}) };
    o.look = { ...this.spec.look, ...(patch.look || {}) };
    // `build` is the NAME the UI picks; the spec carries it as `buildName`
    // (and `build` as the numeric scale). Take the name from whichever the
    // patch set, so the rebuild never re-derives from a stale one.
    const buildName = typeof patch.build === 'string' ? patch.build
      : (patch.buildName || this.spec.buildName);
    this.spec = makeSpec({
      height: o.height, build: buildName,
      shoulderWide: o.shoulderWide, limbLong: o.limbLong, colors: o.colors, look: o.look,
    });
    this._dirty = true;
    this._preset = null;
    this._syncUI();
  }

  applyPreset(name) {
    const P = PRESETS[name] || (FLAG_OUTFITS[name] ? flagOutfitSpec(name) : null);
    if (!P) return;
    // a preset is a whole character: anything it does not name goes back to stock
    this.spec = makeSpec({ ...P, colors: { skin: 0x9c7358, ...P.colors }, look: makeLook(P.look) });
    this._dirty = true;
    this._preset = name;
    this._syncUI();
    this._flash(name);
  }

  randomise() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    this.spec = makeSpec({
      height: 1.55 + Math.random() * 0.45,
      build: pick(Object.keys(BUILDS)),
      shoulderWide: 0.88 + Math.random() * 0.3,
      limbLong: 0.94 + Math.random() * 0.16,
      colors: {
        jacket: pick(PALETTE.jacket), pants: pick(PALETTE.pants),
        helmet: pick(PALETTE.helmet), accent: pick(PALETTE.accent), skin: pick(PALETTE.skin),
      },
      // a whole random wardrobe, weighted toward the plausible (most riders
      // wear a lid; most accessories are off)
      look: {
        helmet: pick(['full', 'full', 'open', 'none']), helmetSize: 0.92 + Math.random() * 0.2, headSize: 0.92 + Math.random() * 0.2,
        visor: pick(LOOK_OPTIONS.visor), stripe: pick(LOOK_OPTIONS.stripe), finish: pick(LOOK_OPTIONS.finish),
        hair: pick(LOOK_OPTIONS.hair), hairColor: pick(PALETTE.hair), beard: pick(['none', 'none', ...LOOK_OPTIONS.beard]),
        top: pick(LOOK_OPTIONS.top), tattoo: pick(['none', ...LOOK_OPTIONS.tattoo]), inkColor: pick(PALETTE.ink),
        glasses: pick(['none', 'none', ...LOOK_OPTIONS.glasses]), chain: pick(['none', 'none', 'gold', 'silver']),
        scarf: pick(['none', 'none', 'bandana']), scarfColor: pick(PALETTE.scarf),
        earring: Math.random() < 0.3, spikes: Math.random() < 0.2, backpack: Math.random() < 0.25,
        gloves: pick(['full', 'full', 'fingerless', 'none']), gloveColor: pick(PALETTE.glove), bootColor: pick(PALETTE.boot),
        figure: pick(['m', 'm', 'f']), bottom: pick(['jeans', 'jeans', 'jeans', 'shorts', 'skirt']),
        pattern: pick(['plain', 'plain', 'plain', ...LOOK_OPTIONS.pattern]), hat: pick(['none', 'none', 'none', 'sunhat', 'cap']),
        shoes: pick(['boots', 'boots', 'low', 'sneakers']),
      },
    });
    this._preset = null;
    this._dirty = true;
    this._syncUI();
  }

  setStance(key) {
    this.stance = key;
    // an animation that only exists in the other stance falls back to idle
    const a = ANIMS.find((x) => x.key === this.anim);
    if (a && a.stance && a.stance !== key) this.anim = 'idle';
    this.animT = 0;
    this._placeBody();
    this._syncUI();
  }

  setAnim(key) {
    const a = ANIMS.find((x) => x.key === key);
    if (!a) return;
    this.anim = key;
    this.animT = 0;
    if (a.stance && a.stance !== this.stance) { this.stance = a.stance; this._placeBody(); }
    // the chain is in the RIGHT fist (-X, see `__plusArm`); turn that side and
    // the front toward the camera so the swing is seen, not its back
    if (key === 'chain') { this.turnPhase = 0.75; this._holdSpin = 4; }
    this._frameDirty = true;
    this._syncUI();
    this._syncChainUI();
  }

  _flash(text) {
    const e = this.el && this.el.fit;
    if (!e) return;
    e.dataset.flash = text;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { delete e.dataset.flash; }, 900);
  }

  _syncUI() {
    const e = this.el;
    if (!e) return;
    const S = this.spec;
    e.height.value = S.height.toFixed(2);
    e.vHeight.textContent = S.height.toFixed(2) + ' m';
    e.shoulders.value = S.shoulderWide.toFixed(2);
    e.vShoulders.textContent = S.shoulderWide.toFixed(2);
    e.limbs.value = S.limbLong.toFixed(2);
    e.vLimbs.textContent = S.limbLong.toFixed(2);
    for (const b of e.builds.children) b.classList.toggle('sel', b.dataset.build === S.buildName);
    for (const f of this._syncers || []) f();
    if (e.presets) for (const b of e.presets.children) b.classList.toggle('sel', b.dataset.preset === this._preset);
    // THE POSE BUTTONS NEVER SHOWED WHICH ONE WAS ON. `sel` was set once when
    // the buttons were built and never again, so pressing Stand left Tuck lit
    // and the screen looked like it had ignored the click.
    for (const b of e.stance.children) b.classList.toggle('sel', b.dataset.stance === this.stance);
    if (e.anims) for (const b of e.anims.children) b.classList.toggle('sel', b.dataset.anim === this.anim);
    if (e.emotes) for (const b of e.emotes.children) b.classList.toggle('sel', b.dataset.anim === this.anim);
    // the readout: the derived numbers, which is the whole point of the screen
    if (e.spec) {
      e.spec.innerHTML =
        `trunk <b>${S.trunk.toFixed(3)}</b> m &nbsp; arm <b>${(S.upperArm + S.forearm).toFixed(3)}</b> m ` +
        `&nbsp; leg <b>${(S.thigh + S.shin).toFixed(3)}</b> m<br>` +
        `shoulder at <b>${S.shoulderY.toFixed(3)}</b> m &nbsp; hip at <b>${S.hipY.toFixed(3)}</b> m ` +
        `&nbsp; seated shoulder <b>${S.seatedShoulder.toFixed(3)}</b> m`;
    }
    this._syncFit();
  }

  /**
   * FIT: do the hands find the grips and the boots find the pegs? MEASURED on
   * the live figure in the solved riding pose, in the bike's own frame -- the
   * geometric estimate in reach.js said "short" for bodies whose fists were
   * measured 3 mm from the grips, and a readout that contradicts the picture is
   * worse than none.
   */
  _measureFit() {
    const b = this.body, bike = this.bike;
    this._fit = null;
    if (!b || !bike || this.stance !== 'ride') return;
    const c = findContacts(bike);
    if (!c || !c.grip || !c.peg) return;
    const j = b.userData.joints, S = this.spec;
    clearAxes(j);
    poseSeated(j, 1);
    bike.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(bike.matrixWorld).invert();
    const at = (node, x, y, z) => node.localToWorld(new THREE.Vector3(x, y, z)).applyMatrix4(inv);
    let hand = 0, foot = 0;
    for (const side of ['left', 'right']) {
      const A = j[side + 'Arm'], L = j[side + 'Leg'];
      const fist = at(A.fore, 0, -S.forearm - S.hand * 0.5, 0.01);
      const sole = at(L.shin, 0, -S.shin - S.foot * 0.5, 0);
      const gx = Math.sign(fist.x || 1) * Math.abs(c.grip.x), px = Math.sign(sole.x || 1) * Math.abs(c.peg.x);
      hand = Math.max(hand, fist.distanceTo(new THREE.Vector3(gx, c.grip.y, c.grip.z)));
      foot = Math.max(foot, sole.distanceTo(new THREE.Vector3(px, c.peg.y, c.peg.z)));
    }
    this._fit = { hand, foot };
  }

  _syncFit() {
    const e = this.el && this.el.fit;
    if (!e) return;
    const F = this._fit;
    if (!F) { e.textContent = this.stance === 'ride' ? '' : 'on foot — choose Ride to check the fit'; return; }
    const tag = (d, ok) => `<span class="${d <= ok ? 'ok' : 'bad'}">${d <= ok ? '✓' : '✗'} ${(d * 100).toFixed(1)} cm</span>`;
    e.innerHTML = `hands to grips ${tag(F.hand, 0.05)} &nbsp; boots to pegs ${tag(F.foot, 0.09)}`;
  }

  /** Build the rider from the spec, with the race's own builder and pose. */
  rebuildBody() {
    this._dirty = false;
    if (this.body) {
      this.body.removeFromParent();
      this.body.traverse((n) => { if (n.isMesh) { n.geometry.dispose(); } });
    }
    this.body = null;
    if (!this.bike && this.bikeAsset) {
      this.bike = cloneWithJoints(this.bikeAsset);
      this.turn.add(this.bike);
    }
    let b;
    try {
      b = buildRider(THREE, { spec: this.spec, ride: RIDING });
    } catch (err) {
      console.warn('[showroom] rider build failed:', err);
      return;
    }
    b.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    // The grab reaches with the arm facing the camera at the start of a turn.
    // (`left` is +X since the rig's sides became anatomical -- same physical arm)
    b.userData.joints.__plusArm = 'left';
    this.body = b;
    this._placeBody();
  }

  /** Put the body where the stance says: on the saddle, beside the bike, or down. */
  _placeBody() {
    const b = this.body;
    if (!b) return;
    b.removeFromParent();
    b.rotation.set(0, 0, 0);
    b.position.set(0, 0, 0);
    if (this.stance === 'ride' && this.bike) {
      // The SAME socket arithmetic as player.js and rivals.js: bike -> socket
      // -> rider, in bike-local units. A designer that seats the rider
      // differently from the race makes you tune the wrong thing.
      if (!this.socket) {
        this.socket = new THREE.Object3D();
        this.socket.name = 'showroomSocket';
        this.bike.add(this.socket);
      }
      this.socket.position.set(
        CFG_SEAT.x,
        CFG_SEAT.y - (this.spec.seatContactY || 0) + (this.spec.seatBob || 0),
        CFG_SEAT.z,
      );
      this.socket.add(b);
      solveSeat(b, this.bike);
      this._measureFit();
    } else {
      this._fit = null;
      // Off the bike: standing on the grid beside it, level with the tank, so
      // the rider's stature reads against the machine's.
      this.turn.add(b);
      b.position.set(-0.85, 0, 0.1);
      if (this.stance === 'crash') {
        b.rotation.set(-Math.PI / 2, 0, 0.25, 'YXZ');
        b.position.set(-0.95, 0.14, 0.7);
      }
    }
    this._frameDirty = true;
    this._syncFit();
  }

  /** Pose the body for this frame: stance rest, then the animation on top. */
  _animate(dt) {
    const b = this.body;
    if (!b) return;
    const j = b.userData.joints;
    const L = LOOP[this.anim] || 2;
    dt *= this.timeScale;                // slow-mo scales every animation
    this._clock += dt;
    this.animT = (this.animT + dt) % L;
    const t = this.animT;
    const seated = this.stance === 'ride';

    // ---- the rest pose for the stance ----
    if (seated) {
      clearAxes(j);
      // Tuck: fold down onto the tank and back up, so the blend the race runs
      // with speed is visible as a motion rather than as two static buttons.
      const tuck = this.anim === 'tuck' ? 0.5 - 0.5 * Math.cos((t / L) * Math.PI * 2) : 0.35;
      poseSeated(j, tuck);
    } else if (this.stance === 'stand') {
      const walking = this.anim === 'walk';
      poseStanding(j, walking ? (t / L) * Math.PI * 2 : 0, walking ? 1 : 0);
      // a walk bobs: the body is highest at mid-stance, twice per cycle
      b.position.y = walking ? Math.abs(Math.sin((t / L) * Math.PI * 2)) * 0.03 : 0;
      b.rotation.y = 0;
      if (j.pelvis) j.pelvis.rotation.z = 0;
      // a feminine figure at rest stands in contrapposto
      if (this.anim === 'idle' && this.spec.look && this.spec.look.figure === 'f') { contrapposto(j, 1, 'right'); b.position.y -= 0.008; }
      const emote = EMOTES[this.anim];
      if (emote) { j.__chainAlwaysOut = false; if (j.chain) j.chain.visible = false; emote(j, t, b, this.spec); return; }
    } else {
      poseStanding(j, 0, 0);
      poseCrash(j, t);
      return;
    }

    // ---- the action ----
    // Breathing, always: a still figure reads as a statue, not a person.
    if (j.torso) j.torso.rotation.x += Math.sin(t * 1.7) * 0.02;
    if (j.neck) j.neck.rotation.y = Math.sin(t * 0.9) * 0.18 * (this.anim === 'idle' ? 1 : 0.3);

    const fighter = { hasWeapon: this.anim === 'chain', active: null, hold: null, heldBy: null, holdEnd: null, aimSide: 1,
      chainCfg: PLAYER_CHAIN };
    const phys = { speed: seated ? 30 : 0, lateral: 0 };
    const kind = { punch: 'punch', kick: 'kick', chain: 'chain' }[this.anim];
    // the chain swings FOREHAND, out on the holding (right, -X) side
    if (kind === 'chain') fighter.aimSide = -1;
    // THE AIRFLOW the chain streams in: the bike's forward (+Z of the turntable)
    // against the air, i.e. the air moves at -forward * airspeed
    const th = this.turn.rotation.y, air = seated ? this.airspeed : 0;
    j.__chainWind = (j.__chainWind || new THREE.Vector3()).set(-Math.sin(th) * air, 0, -Math.cos(th) * air);
    if (kind) {
      // play the move over its real combat duration (combat.js ends an attack
      // at wind + 0.22 s -- NOT cd * 0.7, which cut the chain off at 47%), then
      // hold the rest pose. The chain's wind-up is the PLAYER'S chain's.
      const spec = kind === 'chain' ? chainAttack(ATTACKS.chain, PLAYER_CHAIN) : ATTACKS[kind];
      const dur = spec.wind + (spec.recover ?? 0.22);
      if (t < dur) fighter.active = { kind, t, wind: spec.wind, dur, side: fighter.aimSide };
    } else if (this.anim === 'grab') {
      // reach 0.2 s, hold and haul 1.2 s, throw 0.6 s, rest
      if (t < 0.2) fighter.active = { kind: 'grapple', t: t * (ATTACKS.grapple.wind / 0.2) };
      else if (t < 1.4) fighter.hold = { t: t - 0.2, side: 1 };
      else if (t < 2.0) fighter.holdEnd = { kind: 'throw', t: t - 1.4, side: 1 };
    } else if (this.anim === 'hit') {
      if (t < 1.0) applyAction(j, 'knockdown', t);
    }
    // the monotonic clock, not the looping `t`: the chain sim steps on its delta
    // The showroom's Chain panel edits the chain: keep it out on display (the
    // race stows it between swings -- see riderpose.poseCombat).
    j.__chainAlwaysOut = true;
    poseCombat(j, fighter, phys, this._clock, ATTACKS);
    if (kind === 'chain') {
      const cs = chainState(j);
      if (cs) {
        if (fighter.active) this._swingPeak = Math.max(t < 0.05 ? 0 : (this._swingPeak || 0), cs.tipRel);
        else if (this._swingPeak) { this._peak = this._swingPeak; this._swingPeak = 0; this._syncChainUI(); }
      }
    }
  }

  _onResize() {
    if (!this.el || !this.el.stage) return;
    const r = this.el.stage.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const aspect = w / h;
    // FRAME THE SUBJECT, measured over the whole rig at turntable zero. Done
    // only when the rig or the stance changes -- measuring every frame made
    // the camera breathe with every punch.
    if (this._frameDirty) {
      this._frameDirty = false;
      const savedY = this.turn.rotation.y;
      this.turn.rotation.y = 0;
      this.turn.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.turn);
      this.turn.rotation.y = savedY;
      if (Number.isFinite(box.min.y) && box.max.y > box.min.y) {
        const pad = (box.max.y - box.min.y) * 0.10 + 0.05;
        const topY = box.max.y + pad;
        const botY = Math.min(-0.02, box.min.y) - pad * 0.35;
        // the turntable sweeps, so hold the footprint's worst horizontal extent
        const reach = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z), 0.8);
        this._frame = { midY: (topY + botY) / 2, halfH: (topY - botY) / 2, reach: reach + 0.08 };
      } else {
        this._frame = { midY: 0.8, halfH: 0.9, reach: 1.2 };
      }
    }
    let F = this._frame;
    // THE CHAIN CLOSE-UP: frame the rider's upper body and the chain's whole
    // sweep (centred on the chest, sized by the chain's length) instead of the
    // whole bike, and follow the chest smoothly as the turntable carries it.
    let cx = 0, cz = 0;
    const j = this.body && this.body.userData.joints;
    // FOLLOW a part of the body (smoothly, as the turntable carries it): the
    // chest for the chain close-up, the waist for RIDER, the head for FACE.
    const follow = (node, dy, half) => {
      const p = node.getWorldPosition(new THREE.Vector3());
      p.y += dy;
      if (!this._focus) this._focus = p.clone();
      else this._focus.lerp(p, 0.12);
      F = { midY: this._focus.y, halfH: half, reach: half };
      cx = this._focus.x; cz = this._focus.z;
    };
    if (this.anim === 'chain' && this.chainCam && j && j.torso) {
      // the torso joint is the waist: the swing lives from the tank to a
      // chain's length above the helmet, so centre ~0.3 m up
      follow(j.torso, 0.30, 0.36 + PLAYER_CHAIN.length * 0.42);
    } else if (this.focus === 'face' && j && j.head) {
      follow(j.head, this.spec.headH * 0.55, 0.2 + this.spec.headH * 0.55);
    } else if (this.focus === 'rider' && j && j.torso) {
      follow(j.torso, this.spec.trunk * 0.35, this.spec.height * 0.46);
    } else this._focus = null;
    // KEEP THE FIGURE OUT FROM UNDER THE CHROME. The title and the stance and
    // animation rows cover the top of the stage and the fit readout the
    // bottom, so the subject is framed into the band BETWEEN them, not the full
    // rect -- otherwise a tall rider's helmet sits under the buttons.
    const topBand = this.el.stage.querySelector('#showbar');
    const foot = this.el.stage.querySelector('#showfoot');
    const tb = topBand ? topBand.getBoundingClientRect().bottom - r.top + 10 : 0;
    const fb = foot ? r.bottom - foot.getBoundingClientRect().top + 6 : 0;
    const fTop = THREE.MathUtils.clamp(tb / h, 0, 0.4), fBot = THREE.MathUtils.clamp(fb / h, 0, 0.3);
    const band = 1 - fTop - fBot;
    const contentHalf = Math.max(F.halfH, F.reach / aspect) / this.zoom;
    const halfH = contentHalf / band;
    const halfW = halfH * aspect;
    // shift the eye so the content's centre lands in the middle of the band
    const midY = F.midY + (fTop - fBot) * halfH;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.position.set(cx, midY, cz + 4.6);
    this.camera.lookAt(cx, midY, cz);
    this.camera.updateProjectionMatrix();
    // PORTRAIT: the same framing through a long lens -- the distance that makes
    // the frustum's half-height at the subject equal the ortho half-height, set
    // back by the turntable's reach so the near side of the bike is not cropped,
    // and raised a touch so the floor of the set reads.
    const pc = this.pcam, tf = Math.tan(THREE.MathUtils.degToRad(pc.fov / 2));
    const dist = halfH / tf + F.reach * 0.6;
    pc.aspect = aspect;
    pc.position.set(cx, midY + dist * 0.1, cz + dist);
    pc.lookAt(cx, midY, cz);
    pc.updateProjectionMatrix();
    // DRAW ONLY THE STAGE REGION. WebGL's origin is bottom-left, the DOM's is
    // top-left; read the rect so a restyled panel cannot desynchronise them.
    const pr = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1;
    const H = this.renderer.domElement.height / pr;
    this._stageRect = {
      x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(H - r.bottom)),
      w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)),
    };
  }

  /** Called every frame while the showroom is open. Draws the stage. */
  frame(dt) {
    if (this._dirty) this.rebuildBody();
    if (this._holdSpin > 0) this._holdSpin -= dt;
    // the chain preview turns at a quarter speed: it is the swing you watch
    else this.turnPhase += dt * this.spin * (this.anim === 'chain' ? 0.25 : 1);
    this.turn.rotation.y = this.turnPhase;
    this._animate(dt);
    // The stage rect is re-read every frame: the first measurement used to be
    // taken while the screen was display:none (0x0) and kept forever.
    this._onResize();
    const r = this._stageRect;
    if (r) {
      this.renderer.setViewport(r.x, r.y, r.w, r.h);
      this.renderer.setScissor(r.x, r.y, r.w, r.h);
      this.renderer.setScissorTest(true);
      this.renderer.clear(true, true, false);
      this.renderer.render(this.scene, this.viewCam);
    }
  }

  open(_asset, bikeAsset) {
    if (bikeAsset) this.bikeAsset = bikeAsset;
    this.el.root.classList.add('on');
    // `main.js` hands in the body the game is using as `this.spec`; normalise
    // it through makeSpec so a saved spec from an older build is complete.
    this.spec = makeSpec({
      height: this.spec.height, build: this.spec.buildName,
      shoulderWide: this.spec.shoulderWide, limbLong: this.spec.limbLong, colors: this.spec.colors,
      look: this.spec.look,
    });
    this._dirty = true;
    this._frameDirty = true;
    this._syncUI();
  }

  close() {
    this.el.root.classList.remove('on');
    this.renderer.setScissorTest(false);
    const c = this.renderer.domElement;
    const pr = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1;
    this.renderer.setViewport(0, 0, c.width / pr, c.height / pr);
    if (this.onClose) this.onClose(this.spec);
  }

  get isOpen() { return !!(this.el && this.el.root.classList.contains('on')); }
}

// ---- EMOTES ----------------------------------------------------------------
// Original moves, built on one helper: aim an upper arm along a direction (in
// the torso's frame: +x the rider's left, +y up, +z forward), bend the elbow
// toward a hint direction by `flex` radians. Writing arm poses as "point the
// arm there" instead of three Euler angles is what makes eight emotes short
// enough to read and impossible to mirror by accident.
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const sm = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
/** Bend both knees by `a` and lower the body so the boots stay on the floor. */
function squat(j, a, b, S) {
  for (const side of ['left', 'right']) {
    const L = j[side + 'Leg'] || (j.legs && j.legs[side]);
    if (!L) continue;
    if (L.thigh) L.thigh.rotation.x = -a;                  // thigh forward
    if (L.knee) L.knee.rotation.x = 2 * a;                 // shin back under the hip
  }
  b.position.y -= (S.thigh + S.shin) * (1 - Math.cos(a));
  if (j.torso) j.torso.rotation.x += a * 0.45;
}
const EMOTES = {
  wave(j, t) {
    armAim(j, 'right', [-0.85, 0.5, 0.2], [0.2, 1, 0.3], 1.25 + 0.45 * Math.sin(t * 9));
    armAim(j, 'left', [0.12, -1, 0.05], [0, 0, 1], 0.25);
    if (j.neck) { j.neck.rotation.z = -0.14; j.neck.rotation.x = -0.06; }
    if (j.torso) j.torso.rotation.z = 0.06;
  },
  victory(j, t, b, S) {
    const hop = t < 0.9 ? Math.max(0, Math.sin(Math.PI * (t - 0.25) / 0.5)) : 0;
    const crouch = t < 0.25 ? sm(t / 0.25) * 0.35 : t < 0.75 ? 0 : t < 0.95 ? (1 - sm((t - 0.75) / 0.2)) * 0.25 : 0;
    b.position.y = hop * 0.16;
    squat(j, crouch, b, S);
    for (const [side, s] of [['left', 1], ['right', -1]]) {
      armAim(j, side, [s * 0.45, 0.88, 0.12], [0, 0, 1], 0.15 + 0.12 * Math.sin(t * 7 + s));
    }
    if (j.neck) j.neck.rotation.x = -0.3;
  },
  groove(j, t, b, S) {
    const ph = t * Math.PI * 4;                            // two beats a second
    if (j.pelvis) j.pelvis.rotation.z = 0.09 * Math.sin(ph / 2);
    if (j.torso) { j.torso.rotation.z = -0.12 * Math.sin(ph / 2); j.torso.rotation.y = 0.22 * Math.sin(ph / 2); }
    for (const [side, s] of [['left', 1], ['right', -1]]) {
      armAim(j, side, [s * 0.4, -0.5 + 0.35 * Math.sin(ph + (s > 0 ? 0 : Math.PI)), 0.65], [0, 1, 0.2], 1.7);
    }
    squat(j, 0.1 + 0.12 * (0.5 + 0.5 * Math.cos(ph)), b, S);
    if (j.neck) j.neck.rotation.x = 0.12 * Math.sin(ph);
  },
  robot(j, t, b) {
    const P = [
      { l: [[1, 0, 0], [0, 1, 0], 1.57], r: [[-1, 0, 0], [0, -1, 0], 1.57], n: 0.55, y: 0 },
      { l: [[1, 0, 0], [0, -1, 0], 1.57], r: [[-1, 0, 0], [0, 1, 0], 1.57], n: -0.55, y: 0 },
      { l: [[0.2, -0.25, 1], [0, 1, 0], 1.57], r: [[-0.2, -0.25, 1], [0, 1, 0], 1.57], n: 0, y: 0.45 },
      { l: [[0.2, -0.25, 1], [0, 1, 0], 1.57], r: [[-0.2, -0.25, 1], [0, 1, 0], 1.57], n: 0, y: -0.45 },
      { l: [[0.15, -1, 0], [0, 0, 1], 1.57], r: [[-1, 0, 0], [0, 1, 0], 1.57], n: -0.55, y: 0 },
      { l: [[0.2, -1, 0], [0, 0, 1], 0.05], r: [[-0.2, -1, 0], [0, 0, 1], 0.05], n: 0, y: 0 },
    ];
    const step = 0.5, k = Math.floor(t / step) % P.length, prev = P[(k + P.length - 1) % P.length], cur = P[k];
    const e = sm(((t % step) / 0.09));                    // SNAP to each pose, then hold dead still
    armAim(j, 'left', lerp3(prev.l[0], cur.l[0], e), lerp3(prev.l[1], cur.l[1], e), prev.l[2] + (cur.l[2] - prev.l[2]) * e);
    armAim(j, 'right', lerp3(prev.r[0], cur.r[0], e), lerp3(prev.r[1], cur.r[1], e), prev.r[2] + (cur.r[2] - prev.r[2]) * e);
    if (j.neck) j.neck.rotation.y = prev.n + (cur.n - prev.n) * e;
    if (j.torso) j.torso.rotation.y = prev.y + (cur.y - prev.y) * e;
    b.position.y += (t % step) < 0.09 ? 0.012 : 0;
  },
  guitar(j, t, b, S) {
    if (j.torso) { j.torso.rotation.x = -0.2; j.torso.rotation.z = 0.06; }
    armAim(j, 'left', [0.62, -0.35, 0.7], [-0.7, 0.3, 0.5], 1.0);
    armAim(j, 'right', [-0.3, -0.85, 0.4], [0.75, 0.2, 0.7], 1.45 + 0.35 * Math.sin(t * 20));
    if (j.neck) j.neck.rotation.x = 0.12 + 0.16 * Math.sin(t * 10);
    for (const [side, s] of [['left', 1], ['right', -1]]) {
      const L = j[side + 'Leg'] || (j.legs && j.legs[side]);
      if (L && L.hip) L.hip.rotation.z = s * 0.16;
    }
    squat(j, 0.14, b, S);
  },
  headbang(j, t, b, S) {
    const w = t * 11;
    if (j.neck) j.neck.rotation.x = 0.2 + 0.42 * Math.sin(w);
    if (j.torso) j.torso.rotation.x = 0.15 + 0.12 * Math.sin(w - 0.6);
    armAim(j, 'right', [-0.3, 0.92, 0.2], [0, 0, 1], 0.45);          // horns up
    armAim(j, 'left', [0.35, -0.55 + 0.3 * Math.sin(w), 0.6], [0, 1, 0.1], 1.3);
    squat(j, 0.16, b, S);
  },
  flex(j, t, b, S) {
    if (t < 1.5) {
      // double biceps, facing out
      for (const [side, s] of [['left', 1], ['right', -1]]) armAim(j, side, [s, 0.14, 0.05], [0, 1, 0], 1.95 + 0.08 * Math.sin(t * 14));
      if (j.torso) j.torso.rotation.x = -0.06;
      if (j.neck) { j.neck.rotation.x = -0.12; j.neck.rotation.y = 0.3 * sm((t - 0.3) / 0.4); }
    } else {
      // the crab: fists together in front, everything tensed
      for (const [side, s] of [['left', 1], ['right', -1]]) armAim(j, side, [s * 0.4, -0.75, 0.5], [-s, 0, 0.35], 1.35);
      if (j.neck) j.neck.rotation.x = 0.2;
      squat(j, 0.22, b, S);
      if (j.torso) j.torso.rotation.x += 0.15 + 0.03 * Math.sin(t * 30);
    }
  },
  spin(j, t, b, S) {
    const k = sm(t / 1.1);
    b.rotation.y = k * Math.PI * 2;
    if (t < 1.1) {
      for (const [side, s] of [['left', 1], ['right', -1]]) armAim(j, side, [s, 0.25, 0], [0, 0, 1], 0.15);
      b.position.y = Math.sin(Math.PI * Math.min(1, t / 1.1)) * 0.06;
    } else {
      // land it: point at the camera, other hand on the hip
      armAim(j, 'right', [-0.25, 0.25, 1], [0, 1, 0], 0.08);
      armAim(j, 'left', [0.75, -0.6, -0.2], [-0.8, 0.2, 0.3], 1.9);
      squat(j, 0.1, b, S);
      if (j.neck) j.neck.rotation.z = -0.12;
    }
  },
};

/** The bike publishes its contacts on whichever node the asset put them. */
function findContacts(root) {
  let c = null;
  root.traverse((n) => { if (!c && n.userData && n.userData.contacts) c = n.userData.contacts; });
  return c;
}

/** Lying where he landed: face down, one arm out, a knee drawn up, breathing. */
function poseCrash(j, t) {
  const set = (n, x, z) => { if (n && n.rotation) { n.rotation.x = x; if (z !== undefined) n.rotation.z = z; } };
  const la = j.leftArm || (j.arms && j.arms.left), ra = j.rightArm || (j.arms && j.arms.right);
  set(j.torso, -0.08 + Math.sin(t * 1.3) * 0.02);
  set(j.neck, 0.35, 0.3);
  if (la) { set(la.upper, -2.6, 0.5); set(la.elbow, -0.9); }
  if (ra) { set(ra.upper, 0.3, -0.35); set(ra.elbow, -0.4); }
  const ll = j.leftLeg || (j.legs && j.legs.left), rl = j.rightLeg || (j.legs && j.legs.right);
  // knee drawn up: thigh FORWARD (hip -x) and shin folded BACK (knee +x) -- the
  // old +0.9 / -1.5 was the mirror-image leg, the same bug as the seated pose
  if (ll) { set(ll.hip, -0.9, 0.2); set(ll.knee, 1.5); }
  if (rl) { set(rl.hip, -0.05, -0.08); set(rl.knee, 0.2); }
}
