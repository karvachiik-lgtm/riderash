// RideRash — main. Builds the world, runs the loop, exposes the harness contract.
import * as THREE from 'three';
import { CFG, PAL } from './config.js';
import { makeSpec } from './bodyspec.js';
import { RIDING } from './reach.js';
import { Showroom } from './showroom.js';
import { PLAYER_CHAIN, chainState } from './chainweapon.js';   // [chain agent]
import { buildRoad, buildRoadside, buildBackdrop, centreAt, centreTangent, headAt } from './level.js';
import { buildTraffic, updateTraffic, trafficHit, resetTraffic } from './world.js';
import { buildFinish, placeFinish } from './finishline.js';
import { trafficContact, applyTrafficHit } from './traffic.js';
import { buildLighting, followSun } from './lighting.js';
import { Player } from './player.js';
import { Rival } from './rivals.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { AudioExt } from './audio_ext.js';   // ADDITIVE audio: extra beds, countdown, variants
import { PostFX } from './postfx.js';
import { ASSET, bakeStatic } from '../assetlib.js';
import { Scenery, loadSceneryKit } from './scenery.js';
import { applySurfaces } from '../surfaces.js';
import { loadTextures, skyHorizonColour, getTexture } from './textures.js';
import { DynamicSky } from './sky.js';
import { WorldSpine, MAPS, MAP_ORDER, BIOMES } from './worldspine.js';
import { SurfaceDriver } from './surfacedriver.js';
import { Radar } from './radar.js';
import { Career, SERIES, BIKES, COURSES_UI, COURSE_COUNT } from './career.js';
import { gridFor, aggroFactorFor, takeRaceSeed } from './roster.js';
import { initCharCard } from './charcard.js';   // [npc-persona] character cards + easter eggs
import { CAM_MODES } from './cameramodes.js';
import { Rain } from './rain.js';
import { loadSettings, saveSettings } from './settings.js';
import { TouchPad, isTouchDevice } from './touchpad.js';
import { Tilt } from './tilt.js';
import { Gamepads } from './gamepad.js';
import { Cop } from './cops.js';
import { BIKE_FOR_TIER, bikeSource } from './kit.js';

const canvas = document.getElementById('c');
// NO WEBGL, NO GAME -- but say so. A constructor that throws here used to leave
// the loading bar at 0% forever with the reason only in the console.
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  window.__FATAL__?.('This browser or device could not start WebGL, which the game needs. '
    + 'Try a current Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.', String(e && e.message || e));
  throw e;
}
// A lost GPU context (driver reset, tab backgrounded on mobile) is recoverable:
// preventDefault asks the browser to restore it, and three.js re-uploads.
//
// MOBILE: iOS 17/18 drops the context when Safari is backgrounded or GPU memory
// runs short (three.js#26829). The race pauses with a note, RESUME is held back
// until the browser hands the context back, and if it never does the player is
// offered a reload instead of a frozen frame. three.js rebuilds programs,
// textures and render targets itself on restore; everything here is the UX.
let glLost = false, glTimer = 0;
const glNote = (t) => {
  const n = document.getElementById('glnote');
  if (n) { n.textContent = t || ''; n.style.display = t ? '' : 'none'; }
};
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  glLost = true;
  if (typeof pauseGame === 'function') pauseGame('context');
  glNote('Graphics were reset by the device - restoring...');
  const r = document.getElementById('p-resume'); if (r) r.disabled = true;
  clearTimeout(glTimer);
  glTimer = setTimeout(() => {
    if (!glLost) return;
    document.getElementById('fataltxt').textContent =
      'The device took the graphics away and has not given them back. Reload to carry on - your career is saved.';
    document.getElementById('fatalcode').textContent = 'webglcontextlost';
    document.getElementById('fatal').classList.add('on');
  }, 6000);
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  glLost = false;
  clearTimeout(glTimer);
  glNote('Graphics restored.');
  const r = document.getElementById('p-resume'); if (r) r.disabled = false;
  document.getElementById('fatal').classList.remove('on');
  // Render targets are sized lazily; re-assert the current tier so the shadow
  // map and post chain are rebuilt at the size they had.
  try { if (typeof applyQuality === 'function') applyQuality(tier); } catch (err) { /* next frame */ }
}, false);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);

const settings = loadSettings();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.CAM_FOV, innerWidth / innerHeight, 0.12, 6000);

// PORTRAIT (a phone held upright). CFG.CAM_FOV is a VERTICAL angle, tuned on a
// landscape screen. At aspect 0.46 the same 66 deg leaves a ~33 deg HORIZONTAL
// view: the road edges, the pack beside you and anything you could hit are all
// off-screen. In portrait the vertical angle is instead derived from a
// horizontal one (80% of the landscape vertical, capped), and the camera backs
// off and rises -- see updateCamera -- so the extra height shows road and pack
// rather than sky.
function portraitK() {
  return THREE.MathUtils.clamp((1 - camera.aspect) / 0.5, 0, 1);
}
function viewFov(v) {
  const a = camera.aspect;
  if (a >= 1) return v;
  const h = v * 0.8 * Math.PI / 180;
  const vp = 2 * Math.atan(Math.tan(h / 2) / a) * 180 / Math.PI;
  // Blend so a nearly-square window does not snap between the two rules.
  return THREE.MathUtils.lerp(v, Math.min(100, Math.max(v, vp)), portraitK());
}
camera.fov = viewFov(CFG.CAM_FOV);
camera.updateProjectionMatrix();
window.__SCENE__ = scene;
window.__THREE__ = THREE;
window.__CAM__ = camera;
// ---------------------------------------------------------------------------
// HARNESS SURFACE. These exist so a debugger can see and drive the game, and
// they are deliberately narrow.
//
// `__THREE_SCENE__` / `__THREE_RENDERER__` / `__THREE_CAMERA__` are the exact
// names the threejs-devtools bridge scans for (see its `kn()` discovery: it
// checks these three first, before falling back to walking every window key).
// Without them the bridge finds nothing and every tool in that MCP fails with
// "Three.js scene not found in page" -- which is what it did until this line.
// `window.THREE` is also required by its helper/BoxHelper construction.
window.__THREE_SCENE__ = scene;
window.__THREE_RENDERER__ = renderer;
window.__THREE_CAMERA__ = camera;
window.THREE = THREE;

// Lighting is built inside init(), AFTER the sky. The sun's direction is
// measured from the panorama and the fog colour is sampled from it, so building
// the lights first meant they were placed from hand-authored constants and then
// never reconciled with the sky above them.
let lights = null;

// Post-processing. renderer.render() is replaced by postfx.render() below, and
// willReadFrequently stays off: the harness reads pixels back off the canvas, and
// a float composer target is what keeps the highlights alive for the bloom.
let postfx = null;

// THE PLAYER'S BODY. Module-scoped because three things need it: the loader (to
// build the rig), the showroom (to edit it) and the harness (to read it). It is
// the one description of the player's figure and everything derives from it.
//
// IT STARTS FROM THE CAREER'S SAVED RIDER. `career` is constructed a little
// below, so this is assigned once it exists (see `syncPlayerSpecFromCareer`).
// A first-time player has no saved rider and gets the default body.
let playerSpec = makeSpec({ height: 1.75, build: 'normal', colors: { ...(CFG.PLAYER_COLORS || {}) } });

// The built assets, module-scoped for the same reason as playerSpec: the
// showroom needs the rider prototype to show the player's real body, and it is
// constructed after the loader has run. `loadAssets` fills it in.
const assets = { bike: null, rider: null };
let finishGantry = null;   // the FINISH banner, moved to each race's line in __START__

// The character designer. Constructed lazily the first time it is opened, so a
// player who never opens it never pays for its scene.
let showroom = null;
let sky = null;
// The spine owns the map, its sectors and the weather. It is created inside
// init() once the map choice is known, but the race-length maths below needs a
// value before then, so it starts on the default map.
let spine = new WorldSpine('sierra');
let surfaces = null;
let scenery = null;        // roadside world, rebuilt per course: see scenery.js

// ---------- world ----------
const world = {
  fighters: [],
  parts: [],            // Player and Rival entities, NOT their phys objects
  raceLen: spine.totalLength,
  started: false,
  over: false,

  fightersExcept(me) { return this.fighters.filter((f) => f !== me); },

  // nearest rider ahead of `who`, within `within` metres (Infinity = any)
  nearestAhead(who, within = Infinity) {
    let best = null, bd = within;
    for (const o of this.parts) {
      if (o === who) continue;
      const d = o.phys.s - who.phys.s;
      if (d > 0.5 && d < bd) { bd = d; best = o; }
    }
    return best;
  },

  // riders within `range` of `who` along the road, either direction
  neighbours(who, range) {
    const out = [];
    for (const o of this.parts) {
      if (o === who) continue;
      if (Math.abs(o.phys.s - who.phys.s) <= range) out.push(o);
    }
    return out;
  },

  // who is winning, by distance travelled
  standings() {
    return [...this.parts].sort((a, b) => b.phys.s - a.phys.s);
  },

  positionOf(p) {
    // p may be an entity or a phys; resolve to an entity
    let entity = p;
    if (!p.phys) {
      entity = this.parts.find((e) => e.phys === p);
      if (!entity) return this.parts.length;
    }
    return this.standings().indexOf(entity) + 1;
  },
};

// ---------- assets ----------
let player = null;
let rivals = [];
let cop = null;           // the police: see cops.js
// The roster entries for the current race, rebuilt by resetRace. Declared here
// so the loop that tries to read it before the first race gets `[]` rather than
// a ReferenceError.
let packForThisRace = [];
let fx = null;
let rain = null;
const PHYS_SLIP_RANGE = 22, PHYS_SLIP_LATERAL = 2.0;   // mirror of PHYS.SLIP_*
const hud = new HUD();
const career = new Career();
// ADOPT THE SAVED RIDER, now that the career exists. `makeSpec` re-derives every
// dimension from the four saved inputs, so the stored record never has to agree
// with the body by hand -- it cannot drift.
if (career.rider) {
  playerSpec = makeSpec({
    height: career.rider.height,
    build: career.rider.build,
    shoulderWide: career.rider.shoulderWide,
    limbLong: career.rider.limbLong,
    colors: { ...(CFG.PLAYER_COLORS || {}), ...career.rider.colors },
  });
}
// Costs no draw calls: it is a 2D canvas over the scene, which matters more in
// this project than anywhere else because the budget is 900 and we sit at ~810.
const radar = new Radar(document.getElementById('radar'));
const input = new Input(canvas);
// On-screen buttons on touch devices, inside the HUD so they hide with it.
document.body.classList.toggle('portrait', innerHeight > innerWidth);
// PHONE SESSION: keep the screen awake while racing (nobody touches a phone
// continuously enough to stop it dimming mid-race) and go fullscreen on RIDE so
// the browser's bars stop eating a third of an upright screen. Both are
// best-effort -- iOS Safari has no element fullscreen, and a refused wake lock
// just means the phone's own timeout applies.
const phone = {
  lock: null,
  async begin() {
    if (inputMethod !== 'touch' || navigator.webdriver) return;
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen) {
      d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    try { if (navigator.wakeLock && !this.lock) this.lock = await navigator.wakeLock.request('screen'); }
    catch (e) { this.lock = null; }
    if (this.lock) this.lock.addEventListener?.('release', () => { this.lock = null; });
  },
  end() {
    if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
  },
};
// The OS drops a wake lock whenever the page is hidden; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.running) phone.begin();
});
// CONTROLS FOLLOW THE INPUT IN USE. The pad used to be decided once, at load,
// by "is this a touch device" -- so a touchscreen laptop wore phone buttons over
// a keyboard game forever, and a phone with a Bluetooth pad could never lose
// them. Now: the last thing the player actually used (touch / keyboard /
// gamepad) decides, debounced so a stray event cannot flap it, and Settings ->
// Touch pad can force it ON or OFF. (Same model as RallyRoadRash's lastMethod.)
const touchpad = new TouchPad(input, document.getElementById('hud'));
window.__TOUCHPAD__ = touchpad;   // harness: drive and inspect the on-screen pad
const tilt = new Tilt(input);
const pads = new Gamepads(input);
let inputMethod = isTouchDevice() ? 'touch' : 'kb';
let methodT = -Infinity;
function applyTouchVisibility() {
  const on = settings.touch === 'on' || (settings.touch === 'auto' && inputMethod === 'touch');
  touchpad.show(on);
  document.body.classList.toggle('touch', on);
  document.body.classList.toggle('tilt', on && tilt.active);
  document.body.classList.toggle('padnav', inputMethod === 'pad');
  input.zones = !on;        // real buttons replace the canvas tap-zones
  if (!on) touchpad.reset();
}
function setInputMethod(m) {
  const now = performance.now();
  if (m === inputMethod) { methodT = now; return; }
  if (now - methodT < 300) return;
  inputMethod = m; methodT = now;
  applyTouchVisibility();
}
window.__INPUTMETHOD__ = () => inputMethod;
addEventListener('touchstart', () => setInputMethod('touch'), { passive: true, capture: true });
addEventListener('keydown', (e) => { if (!e.repeat) setInputMethod('kb'); }, true);
// pointerType, not mousedown: phones fire a compatibility mousedown after every
// tap, and Safari cannot say which ones were really a mouse.
addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') setInputMethod('kb'); }, true);
applyTouchVisibility();
const audio = new Audio();
const audioExt = new AudioExt(audio);   // ADDITIVE: never edits `audio`, only adds alongside it

const loadBar = document.getElementById('barf');
const loadMsg = document.getElementById('loadmsg');
function progress(p, msg) {
  loadBar.style.width = `${Math.round(p * 100)}%`;
  if (msg) loadMsg.textContent = msg;
}

// The two assets are code modules returning a Group, loaded through ASSET.
// If either fails we still start, with a primitives fallback, so the game is
// never a black screen — but we say so, loudly, because the trap is that a
// failing import prints one line and the game carries on emptier.
async function loadAssets() {

  progress(0.15, 'loading bike');
  try {
    // keepHierarchy, because the bike is NOT scenery -- it has a steering head,
    // two wheels and a fairing that the game animates every frame. Loading it
    // merged collapsed those nodes and destroyed `userData.joints`, so
    // `frontWheel.rotation.x = wheelSpin` and `frontSteer.rotation.y = steer`
    // had been writing to undefined for the whole project: THE WHEELS NEVER
    // TURNED and the bars never moved. Nothing threw and no still frame showed
    // it. Verified live before the fix: `bikeJointsPresent: false` and no node
    // named wheel/steer anywhere in the tree.
    //
    // The draw-call saving is kept by merging WITHIN the joints rather than
    // across them -- see mergeJoints in assetlib, which is exactly what the
    // rider already does.
    assets.bike = await ASSET('./assets/bike.js', { height: 1.25, keepHierarchy: true });
    // THE OTHER BIKE CLASSES (src/kit.js deals them to the pack and the garage). They
    // share the hero's joints and contacts, and they are put at the HERO'S SCALE rather
    // than scaled to their own height: CFG.SEAT_* and every contact are in bike-local
    // units, so one scale for every machine is what keeps each rider on his saddle.
    assets.bikes = { sport: assets.bike };
    for (const k of ['naked', 'super', 'muscle']) {
      const b = await ASSET(`./assets/bike_${k}.js`, { keepHierarchy: true });
      if (b.userData && b.userData.joints && b.userData.joints.frontWheel) {
        b.scale.copy(assets.bike.scale);
        assets.bikes[k] = b;
      } else console.warn('[riderash] bike class failed to load:', k);
    }
    progress(0.6, 'loading rider');
  } catch (e) {
    console.warn('[riderash] bike asset failed:', e);
    assets.bike = fallbackBike();
  }
  try {
    assets.rider = await ASSET('./assets/rider.js', { spec: playerSpec, ride: RIDING, keepHierarchy: true });
    progress(0.85, 'loading rider');
  } catch (e) {
    console.warn('[riderash] rider asset failed:', e);
    assets.rider = fallbackRider();
  }
  return assets;
}

function fallbackBike() {
  const g = new THREE.Group();
  const M = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 1.6), M(PAL.framePainted)); b.position.y = 0.6; g.add(b);
  const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.14, 14), M(PAL.saddle));
  w1.rotation.z = Math.PI / 2; w1.position.set(0, 0.31, 0.7); g.add(w1);
  const w2 = w1.clone(); w2.position.z = -0.7; g.add(w2);
  g.traverse((n) => { if (n.isMesh) { n.castShadow = true; } });
  g.userData.joints = {};
  return g;
}
function fallbackRider() {
  const g = new THREE.Group();
  const M = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.26), M(PAL.leather)); t.position.y = 1.1; g.add(t);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), M(PAL.helmet)); h.position.y = 1.45; g.add(h);
  g.traverse((n) => { if (n.isMesh) { n.castShadow = true; } });
  g.userData.joints = {};
  return g;
}

// ---------- build the game ----------
async function init() {
  progress(0.02, 'textures');
  // Textures FIRST: the level builds its materials from them, so loading after
  // the world exists would mean every surface silently kept its flat colour.
  // The failure mode is quiet — a missing map is not an error in three.js — so
  // the order here is load-bearing.
  try {
    await loadTextures((p, name) => progress(0.02 + p * 0.10, name));
  } catch (e) { console.warn('[riderash] textures failed:', e); }
  try {
    sky = new DynamicSky(renderer, { sky_day: getTexture('sky_day'), sky_dusk: getTexture('sky_dusk') });
    if (sky.ok) {
      scene.add(sky.mesh);
      scene.userData.sky = sky;
      // Build the environment from the sky's own blend, so reflections match it.
      sky.refreshEnv(scene, 0.55);
    }
  } catch (e) { console.warn('[riderash] sky failed:', e); }

  // Lighting AFTER the sky: sun direction and fog colour both come from it.
  lights = buildLighting(scene, renderer, camera, sky);

  progress(0.14, 'building road');
  // THE ROAD IS AS LONG AS THE LONGEST RACE, DERIVED, NOT HAND-SET.
  //
  // `ROAD_SEGS` was sized once to the longest map of the day (5300 m) and the
  // maps were lengthened afterwards -- coastal 6400 m, desert 10000 m, and then
  // stretched again by each level's `lenMul` (up to 2.05x, a 20.5 km desert).
  // The tarmac, kerbs and rail simply STOPPED at 5600 m, short of every finish
  // line but the Sierra opener's. The schedule is the source of truth for how
  // far anyone can ride, so the road is sized from it, plus the camera's
  // look-ahead past the line.
  {
    let longest = 0;
    for (const ev of SERIES) {
      const m = MAPS[ev.map];
      if (!m) continue;
      const len = m.sectors.reduce((a, [, l]) => a + l, 0) * (ev.lenMul || 1);
      if (len > longest) longest = len;
    }
    const need = Math.ceil((longest + CFG.ROAD_PAST_FINISH) / CFG.SEG);
    if (need > CFG.ROAD_SEGS) CFG.ROAD_SEGS = need;
  }
  const road = buildRoad();
  const side = buildRoadside();
  const back = buildBackdrop();
  // THE ROADSIDE WORLD (scenery.js) replaces world.js's buildTown/buildHills/
  // buildClutter. It is dressed PER COURSE from the spine's biomes, so it is
  // built here for the course the career will run first (a throwaway spine,
  // because the live one is only switched in __START__) and rebuilt there
  // whenever the course changes.
  progress(0.16, 'roadside');
  try {
    const kit = await loadSceneryKit();
    scenery = new Scenery(scene, camera, kit);
    const ev0 = career.event;
    scenery.setCourse(new WorldSpine(ev0.map).setMap(ev0.map, ev0.lenMul));
    window.__SCENERY__ = scenery;   // harness: chunk stats, rebuild timing
  } catch (e) { console.warn('[riderash] scenery:', e); }
  const traffic = buildTraffic();
  scene.add(road, side, back, traffic);
  finishGantry = buildFinish();
  scene.add(finishGantry);
  world.traffic = traffic;

  // fills the MODULE-SCOPE `assets`, so the showroom can reach the rider later
  await loadAssets();

  // surfaces are applied at load time, never baked into the asset
  try { applySurfaces(THREE, road); applySurfaces(THREE, side); } catch (e) { console.warn('[riderash] surfaces:', e); }

  // The surface driver takes over the road's materials and re-drives their tint,
  // roughness and metalness from where the rider is. Built AFTER applySurfaces,
  // because applySurfaces replaces materials and a driver holding the old ones
  // would be writing to objects no longer in the scene.
  try {
    surfaces = new SurfaceDriver(road, spine, scene);
    console.log('[riderash] surface driver tracking', surfaces.targets.length, 'materials');
  } catch (e) { console.warn('[riderash] surface driver:', e); }

  // Distant scenery does not cast a shadow anyone can see. The sun's shadow
// camera is only 90 m wide, so every mesh outside it is drawn a second time for
// a shadow map in which it cannot appear -- that is where the draw budget was
// going. Hills and the town are the big offenders: they are large, they are
// almost always in frustum, and their shadows are meaningless at this scale.
  //
  // Shadows are thrown by the NEAR-FIELD only: the bikes, the roadside clutter,
  // the traffic. That is what the eye reads, and it is what the 90 m shadow
  // camera can actually resolve.
  const noShadow = (root) => root.traverse((n) => { if (n.isMesh) n.castShadow = false; });
  // Hills, town AND the roadside clutter. The road itself still receives
  // shadows, and the bikes, traffic and riders still cast them -- those are the
  // shadows the eye actually reads at 50 m/s. What is dropped is the second
  // draw of every bollard, hoarding and canopy for a shadow map that cannot
  // resolve them at the distance most of them sit.
  for (const part of [side]) noShadow(part);

  // bake the static world PER BLOCK to keep draw calls down. Traps.md is
  // explicit that a single bake over the whole world cannot be frustum-culled,
  // so every building behind the camera still draws.
  for (const part of [road, side]) {
    try { bakeStatic(part); } catch (e) { /* non-fatal */ }
  }
  // Traffic is NOT baked here: traffic.js already welds each vehicle into one
  // mesh (one draw) with a shared material. The old per-car bakeStatic call
  // here discarded its return value, so it never did anything.

  player = new Player(scene, assets);
  world.player = player;
  world.parts.push(player);
  world.fighters.push(player.fighter);
  // [chain agent] the player swings the chain built in the showroom (a live
  // object: edits there reach the next swing, no re-plumbing)
  player.fighter.chainCfg = PLAYER_CHAIN;
  window.__CHAIN__ = () => ({ cfg: { ...PLAYER_CHAIN }, state: chainState(player.rider && player.rider.userData && player.rider.userData.joints) });

  for (let i = 0; i < CFG.RIVAL_COUNT; i++) {
    // Identity comes from the ROSTER (src/roster.js), not from the grid index.
    // This is the load-time build; `resetRace` re-applies the roster with the
    // CURRENT career event's skill/aggro scaling, so the same character is
    // harder in race five than in race one without rebuilding the meshes.
    const r = new Rival(scene, assets, i, { startS: 7 + i * 4 });
    rivals.push(r);
    world.parts.push(r);
    world.fighters.push(r.fighter);
  }

  try { cop = new Cop(scene, assets); } catch (e) { console.warn('[riderash] cop:', e); cop = null; }
  window.__COP__ = cop;      // harness: force a spawn, read a bust

  fx = new FX(scene);
  rain = new Rain(scene);

  postfx = new PostFX(renderer, scene, camera);

  // The wet road and the painted bodywork need the environment on the MATERIAL,
  // not just on the scene: three.js 0.169 overrides a material's envMapIntensity
  // with the scene's value whenever the material's own envMap is null, so a
  // per-material intensity is silently ignored. See lighting.js.
  const setEnv = scene.userData.setMaterialEnv;
  if (setEnv) {
    road.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (!m || !m.color) continue;
        const hex = m.color.getHex();
        if (hex === PAL.asphalt || hex === PAL.asphaltWorn) setEnv(m, 1.0);
        else if (m.name === 'ground') setEnv(m, 0.85);
      }
    });
    const glossy = (root) => {
      root.traverse((n) => {
        if (!n.isMesh || !n.material) return;
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) {
          if (!m || !m.color) continue;
          // The hero's surfaces are the ones that must read as MATERIAL, so they
          // get the environment map assigned directly (the 0.169 trap) and a
          // strong intensity. This was 0.95 when the environment was a flat grey
          // gradient; now that it is the actual Atlas sky, anything under ~1.3
          // does not pick up enough of it to read as paint or chrome.
          const hex = m.color.getHex();
          if (m.name === 'metal') setEnv(m, 1.85);
          else if (hex === PAL.saddle) setEnv(m, 0.55);      // tyres stay matte
          else setEnv(m, 1.45);
          // Clearcoat needs its own intensity or the coat layer reflects at the
          // scene default and the paint looks uniformly wet rather than lacquered.
          if (m.clearcoat > 0) m.clearcoatEnvMapIntensity = 1.6;
        }
      });
    };
    glossy(player.group);
    for (const r of rivals) glossy(r.group);
  }

  // HUD boxes for the pack
  const boxes = document.getElementById('boxes');
  let html = '';
  for (let i = 0; i < CFG.RIVAL_COUNT; i++) html += '<i class="off"></i>';
  boxes.setAttribute('data-pack', 'rivals');

  addEventListener('resize', () => {
    // Through applyQuality, not a bare setSize: the pixel budget depends on the
    // window size, so a rotation or a resized tablet window re-derives it.
    applyQuality(tier);
    camera.aspect = innerWidth / innerHeight;
    // Rotating the phone flips the FOV rule; snap rather than ease across it.
    camera.fov = viewFov(CFG.CAM_FOV);
    camera.updateProjectionMatrix();
    if (postfx) postfx.setSize(innerWidth, innerHeight);
    document.body.classList.toggle('portrait', innerHeight > innerWidth);
  });

  applyQuality(settings.quality === 'auto' ? autoTier() : settings.quality);
  await prewarm();
  progress(1, 'ready');
  document.getElementById('load').style.display = 'none';

  // [npc-persona] character cards (title field, pause standings), easter eggs.
  try {
    initCharCard({ renderer, rivals, world, getEvent: () => career.event,
      isRacing: () => state.running && !state.paused, count: CFG.RIVAL_COUNT });
  } catch (e) { console.warn('[riderash] charcard:', e); }

  state.ready = true;
  window.__READY__ = true;
}

// Compile shaders and upload one frame before we let the player in, so the
// first real frame is not a stutter.
async function prewarm() {
  progress(0.92, 'compiling');
  renderer.compile(scene, camera);
  if (postfx) postfx.render(0.016, 0);
  else renderer.render(scene, camera);
  await new Promise((r) => setTimeout(r, 40));
}

// ---------- camera ----------
// A chase camera. It rolls from the track's own banking and is clamped; it
// never inherits the road normal under the wheels, which is the trap.
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camRoll = 0, camYaw = 0, camInitialised = false;
// Smoothed 0..1 "the wreck is in the air" factor for the crash camera. Module
// scope so it survives between frames and can be reset with the rest.
let crashHold = 0;
let slideDustT = 0;
const _slideV = new THREE.Vector3();


function updateCamera(dt, g) {
  const p = player.phys;
  // WHILE ON FOOT, FRAME THE MAN, NOT THE MACHINE.
  //
  // The camera aims CAM_LOOK (8 m) ahead of `phys` and sits CAM_BACK back,
  // which is right for a bike: the subject is long and the view should reach
  // down the road. For a 1.55 m walker it is wrong twice over -- the reach puts
  // him near the bottom edge, and the look-ahead pushes him off it. The
  // dismount/down/walk/remount mechanic was live and correct but INVISIBLE,
  // which is indistinguishable from broken from the player's seat.
  //
  // `player.focus` is the same point either way (the bike while riding), so
  // substituting it costs the riding camera nothing. The shortened reach and
  // look-ahead apply only on foot, so the walking figure fills the frame the
  // way the rider does.
  const focus = player.focus || p.pos;
  const onFootReach = player.onFoot ? 0.45 : 1;
  const onFootLook = player.onFoot ? 0.25 : 1;
  const speedFrac = p.speed / CFG.MAX_SPEED;

  // ---- THE WRECK LEAVES THE FRAME -----------------------------------------
  // Road Rash's crash is memorable because the camera does NOT chase the fallen
  // rider: the bike keeps going, the camera stays with the road, and the body
  // tumbles out of shot. Ours followed the rider through the whole fall, which
  // is why a 17 m separation read as "he stayed close" -- the camera closed the
  // gap for the viewer even though the world was opening it.
  //
  // So during FALLING the camera holds its ground: reach is pinned and growns
  // slightly, and it looks at the LAST RIDING point rather than the tumbling
  // body, so the rider crosses the frame and exits it. From DOWN onward the
  // camera eases back onto him, which is what makes the walk back to the bike
  // legible.
  //
  // `1 - crashHold` scales the whole effect so the recovery is smooth and the
  // camera never snaps when the state changes.
  const dState = player.dismount && player.dismount.state;
  const crashPhase = (dState === 'FALLING') ? 1 : 0;
  crashHold += (crashPhase - crashHold) * Math.min(1, dt * (crashPhase ? 9 : 2.5));
  const crashReach = 1 + crashHold * 0.55;   // hold the camera back, let him fly
  const crashLook = 1 - crashHold * 0.75;    // stop tracking where he went

  // target position: behind and above, along the road's own direction
  const pk = portraitK();
  const back = CFG.CAM_BACK + speedFrac * 1.4 - pk * 0.9;
  // Camera HEIGHT falls with speed. At 50 m/s the old fixed 2.70 m put the near
  // tarmac below the bottom edge of the frame, so the road read as missing and
  // the lane dashes looked like they floated over dirt.
  const up = THREE.MathUtils.lerp(CFG.CAM_UP, CFG.CAM_UP_FAST, speedFrac) + pk * 0.35;
  const yaw = p.yaw;

  // body-shift during an attack, so a punch reads on screen
  let shift = 0;
  const f = player.fighter;
  if (f.active) {
    const k = Math.sin(Math.min(1, f.active.t / 0.3) * Math.PI);
    const dir = f.active.kind === 'kick' ? -1 : 1;
    shift = dir * k * CFG.CAM_SHIFT * (f.active.kind === 'chain' ? 1.5 : 1);
  }

  // ---- CAMERA MODES -------------------------------------------------------
  // Seven views, cycled with C (or picked directly with 1-7). Road Rash shipped
  // one camera; a modern racer is expected to offer the bumper, the bar-cam and
  // a replay angle, and each of them shows something the chase cam cannot --
  // the bar-cam sells speed, the far cam reads the pack, the drone reads the
  // road ahead of a blind crest.
  //
  // Every mode computes an OFFSET behind/above/beside the rider plus a look
  // target, and then shares one smoothing path, so adding a mode is four
  // numbers rather than a new code path. CHASE keeps exactly the framing the
  // critic rounds tuned; nothing below changes it.
  const M = CAM_MODES[state.camMode % CAM_MODES.length];

  // LAG COMPENSATION, and without it the framing is a function of speed by
  // accident. `camPos` chases its target exponentially, so it settles
  // `speed * CAM_LAG` behind wherever the target is -- 52 m/s times 0.085 is a
  // further 4.4 m. MEASURED: a 7.5 m offset produced an 11.5 m camera-to-rider
  // separation at racing speed, and the hero shrank to 1.9% of frame width
  // against a bar of 25-40%. Critic round 1 named hero scale as THE property to
  // fix and round 2 measured it fixed at 1.44 m; the lag had quietly undone it.
  //
  // Folding the expected lag back into the target means CAM_LAG does the job it
  // is for -- smoothing bumps, hits and kerb strikes -- without deciding how big
  // the rider is. The floor keeps the camera from ever reaching the bike.
  // `back` and `up` come from the mode; CHASE's are the tuned defaults.
  const mBack = back * M.back;
  const mUp = up * M.up + M.upAdd;
  // DRONE tracks sideways with the steering, like a chase helicopter leaning
  // into the corner, instead of sitting rigidly behind the tail.
  if (M.drone) {
    state.camSide += ((-p.steer * 5.5) - state.camSide) * Math.min(1, dt * 2.2);
  } else {
    state.camSide += (0 - state.camSide) * Math.min(1, dt * 4.0);
  }
  const side = state.camSide + (M.side || 0);

  const eff = Math.max(M.minBack ?? 1.4, mBack - p.speed * CFG.CAM_LAG * (M.lag ?? 1)) * onFootReach * crashReach;
  const tx = focus.x - Math.sin(yaw) * eff + Math.cos(yaw) * (shift + side);
  const tz = focus.z - Math.cos(yaw) * eff - Math.sin(yaw) * (shift + side);
  const ty = focus.y + mUp;

  if (!camInitialised) { camPos.set(tx, ty, tz); camInitialised = true; }
  const k = 1 - Math.exp(-dt / CFG.CAM_LAG);
  camPos.x += (tx - camPos.x) * k;
  camPos.y += (ty - camPos.y) * k;
  camPos.z += (tz - camPos.z) * k;

  // Look WELL ahead at every speed. The camera's job here is to show the road
  // and the pack; the hero occupies the lower third and nothing more.
  const ahead = p.forward;
  const lookDist = CFG.CAM_LOOK * (CFG.CAM_LOOK_MIN + speedFrac * 0.80) * onFootLook * crashLook;
  // The look point drops with speed too, and by slightly more than the camera
  // does — so the view tilts DOWN as it accelerates and the road surface stays
  // anchored in the lower third instead of sliding off the bottom.
  // The look point also decides WHERE IN FRAME the hero sits, not just how far
  // ahead the view reaches. The bar frames put the rider across the bottom
  // third; ours measured dead centre, because the camera aimed low and the bike
  // rose to meet it. Aiming higher pushes the rider down the frame where the
  // reference puts him, and leaves the road reading through the upper middle.
  const lookY = (1.70 - speedFrac * CFG.CAM_LOOK_DROP) * M.lookY + (M.lookYAdd || 0);
  const mLook = lookDist * M.look;
  camLook.set(
    focus.x + ahead.x * mLook,
    focus.y + lookY,
    focus.z + ahead.z * mLook);

  // Hide what the camera is looking out of. Restored every frame by the mode
  // that does not hide it, so switching back can never leave the rider invisible.
  if (player.rider) player.rider.visible = !M.hideRider;
  if (player.bike) player.bike.visible = !M.hideBike;

  camera.position.copy(camPos);

  // ---- FREE CAMERA (harness only) -----------------------------------------
  //
  // WHY THIS EXISTS. A harness kept trying to verify "is the bike actually
  // pitched over this crest" by setting `camera.position` from outside, and
  // every screenshot came back as the ordinary chase view. Two reasons, and
  // both have to be defeated in the same place:
  //
  //   1. This function runs every frame and overwrites `camera.position`. A
  //      harness that writes the camera from its own rAF is racing the game and
  //      loses about half the time.
  //   2. Even when the camera IS moved, `postfx.render()` is what presents the
  //      frame. A harness calling `renderer.render(scene, cam)` directly draws
  //      into a backbuffer nobody ever sees, so the screenshot is of the last
  //      composited frame -- a stale image that looks like a valid photograph.
  //
  // The fix is to move the camera HERE, inside the same function that would
  // otherwise overwrite it, so it is presented through the real postfx path.
  // `window.__FREECAM__` is a small object the harness sets; when it is absent
  // this costs one property read per frame.
  //
  //   __FREECAM__ = { offset: [x,y,z], look: [x,y,z], lookAtPlayer: bool }
  //   offsets are in the BIKE's frame (x = right, y = up, z = forward), so a
  //   side-on view stays side-on around a corner instead of drifting.
  if (window.__FREECAM__) {
    const fc = window.__FREECAM__;
    const off = fc.offset || [0, 2, -8];
    const rr = new THREE.Vector3(Math.cos(player.phys.yaw), 0, -Math.sin(player.phys.yaw));
    const ff = new THREE.Vector3(Math.sin(player.phys.yaw), 0, Math.cos(player.phys.yaw));
    const base = player.phys.pos;
    camera.position.set(
      base.x + rr.x * off[0] + ff.x * off[2],
      base.y + off[1],
      base.z + rr.z * off[0] + ff.z * off[2]);
    camera.up.set(0, 1, 0);
    const t = fc.lookAtPlayer === false
      ? (fc.look || [base.x, base.y, base.z])
      : [base.x, base.y + 0.6, base.z];
    camera.lookAt(t[0], t[1], t[2]);
    // Roll ABOUT THE VIEW AXIS. Assigning rotation.z after lookAt overwrote one
    // Euler component of the look rotation and tipped every side view ~70 deg.
    if (fc.roll) camera.rotateZ(fc.roll);
    return;   // skip the chase-camera math and its shake entirely
  }

  // shake on hits
  const shake = g.shake;
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.35;
    camera.position.y += (Math.random() - 0.5) * shake * 0.30;
    camera.position.z += (Math.random() - 0.5) * shake * 0.35;
  }

  camera.lookAt(camLook);
  // Portrait pitches the view DOWN by a fixed angle (~10 deg): a tall frame
  // otherwise spends its top 40% on sky and parks the hero under the thumb
  // controls. An angle, not a lower look point -- at drone distance a 1.6 m
  // drop of the target moved the horizon by barely 4 deg.
  if (pk > 0) camera.rotateX(-0.17 * pk);
  // ...and a LENS SHIFT that grows as speed falls. At a standstill (the grid,
  // a crash, walking back to the bike) the chase camera sits closer and the
  // hero drops to ~80% of screen height -- behind the thumb buttons. A shift
  // moves the whole image up without the perspective change a steeper pitch
  // would bring, and fades out by racing speed where the pitch alone frames it.
  const shiftY = pk * 0.16 * (1 - Math.min(1, speedFrac * 1.25));
  if (shiftY > 0.002) {
    const w = innerWidth, h = innerHeight;
    camera.setViewOffset(w, h, 0, shiftY * h, w, h);
  } else if (camera.view && camera.view.enabled) {
    camera.clearViewOffset();
  }

  // roll from the bike's lean, clamped, eased. This is the camera's own roll,
  // not the ground's.
  //
  // THE SIGN FOLLOWS THE LEAN, AND IT WAS NEGATED.
  //
  // The camera rides BEHIND the bike looking down its own local -Z, so
  // `rotateZ(+a)` rotates the image counter-clockwise on screen: the horizon's
  // right end rises. A rider banking RIGHT (`p.lean > 0`) tips his head right,
  // which makes the world appear to tilt left under him -- the right side of the
  // horizon goes UP. So a right-hand lean needs a POSITIVE camera roll.
  //
  // MEASURED in the live page before this fix, holding right at 51 mph:
  // `p.lean = +0.554` produced `camRoll = -0.154`, i.e. the image rotated
  // clockwise and the horizon's right end DROPPED while the machine leaned
  // right. The machine was right and the view was mirrored, which is the
  // "the left/right tilt is inverted" report -- the bike leans into the corner
  // and the camera rolls out of it, so the whole frame reads wrong.
  const targetRoll = THREE.MathUtils.clamp(p.lean * 0.28, -0.16, 0.16);
  camRoll += (targetRoll - camRoll) * Math.min(1, dt * 4.5);
  camera.rotateZ(camRoll);
  window.__CAMROLL__ = camRoll;

  // fov opens with speed
  const targetFov = viewFov(THREE.MathUtils.lerp(CFG.CAM_FOV, CFG.CAM_FOV_FAST, speedFrac));
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3.2);
    camera.updateProjectionMatrix();
  }
}

// ---------- game state ----------
const state = {
  ready: false,
  running: false,
  ready_: false,
  time: 0,
  countdown: 0,        // seconds of grid hold left; 0 = racing
  // DEFAULT VIEW IS THE DRONE: far, high and behind. CHASE (0) is still the
  // framing the critic rounds measured and is one press of C away, but the
  // high-wide view is what reads the pack and the road ahead over a crest,
  // which is what this game is actually about.
  camMode: settings.camMode,   // index into CAM_MODES; C cycles, 1-7 pick; persisted
  paused: false,
  // -Infinity, not 0: 0 read as "a race ended at page load", so the results
  // guard below also swallowed the first 1.2 s of keyboard starts on a fast load.
  endedAt: -Infinity,  // performance.now() at the finish; guards the results screen
  camSide: 0,          // smoothed sideways offset, used by DRONE
  score: 0,
  hits: 0,
  knockDowns: 0,
  contacts: 0,
  shake: 0,
  // HITSTOP. Seconds of near-frozen time remaining on a wreck. The biggest
  // perceived-impact upgrade in the whole crash presentation, and it costs one
  // multiplier on `dt`: freeze the world for ~90 ms at the instant a body is
  // thrown and the eye reads a collision, not a transition. Kept short --
  // genuinely freezing longer than ~120 ms stops reading as impact and starts
  // reading as a dropped frame.
  hitstop: 0,
  swapped: 0,
  warn: '',
  lastPos: 6,
  finishS: CFG.TRACK_LEN,
  raceOver: false,
  weather: 0,
  timeOfDay: 0.55,
};

// ---------- per-frame ----------
let last = performance.now();
let fps = 0, fpsAcc = 0, fpsFrames = 0;

// ---- gamepad glue: the pad drives the bike in a race and FOCUS in a menu ----
function topScreen() {
  const on = [...document.querySelectorAll('.screen.on')];
  return on.length ? on[on.length - 1] : null;
}
function padFocusables(scr) {
  return [...scr.querySelectorAll('button, select, input')].filter((e) =>
    !e.disabled && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden');
}
function pollPad() {
  const scr = topScreen();
  const menu = !!scr || !state.running || state.paused;
  const used = pads.poll({
    menu,
    onPause() {
      if ($('settingsscreen').classList.contains('on')) { closeSettings(); return; }
      if (state.paused) resumeGame(); else pauseGame('user');
    },
    onCamera() { setCamera(state.camMode + 1); },
    onNav(d) {
      if (!scr) return;
      const els = padFocusables(scr);
      if (!els.length) return;
      const i = els.indexOf(document.activeElement);
      const next = els[(i + d + els.length) % els.length];
      next.focus({ preventScroll: false });
      next.scrollIntoView?.({ block: 'nearest' });
    },
    onConfirm() {
      const a = document.activeElement;
      if (scr && a && scr.contains(a) && (a.tagName === 'BUTTON' || a.type === 'checkbox')) { a.click(); return; }
      if (canKeyStart()) window.__START__();
    },
    onBack() {
      if ($('settingsscreen').classList.contains('on')) closeSettings();
      else if (state.paused) resumeGame();
      else if (showroom && showroom.isOpen) showroom.close();
    },
  });
  if (used) setInputMethod('pad');
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  // HARNESS: `__HOLD__` hands the clock to __SIM__ entirely.
  if (window.__HOLD__) return;
  pollPad();

  // THE DESIGNER TAKES THE WHOLE FRAME. Checked here, at the top, so none of the
  // game's simulation runs while it is open -- otherwise the pack would keep
  // racing and the rider would keep riding behind the panel.
  if (showroom && showroom.isOpen) {
    showroom.frame(Math.min(0.05, rawDt));
    return;
  }
  // PAUSED: nothing advances and nothing is re-rendered. The canvas keeps the
  // last presented frame under the menu, and the GPU idles.
  if (state.paused) { input.endFrame(); return; }
  // REAL fps from real elapsed time. Never divide by a clamped delta.
  fpsAcc += rawDt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    autoQuality(fps);
  }

  const dt = Math.min(0.05, rawDt);

  // HITSTOP. Run the world at 12% speed for a short beat after a wreck, then
  // release. The timer runs on RAW time (not the scaled dt) or it would never
  // expire -- a mechanism that slows its own clock is the classic way to write
  // a freeze that lasts forever.
  //
  // 0.12 and not 0: a true 0 would also stop the crash's own launch from
  // advancing, so the body would hang motionless instead of leaving the bike,
  // and the release would then snap it. Slowed-but-moving is what reads as the
  // impact holding its breath.
  let simDt = dt;
  if (state.hitstop > 0) {
    state.hitstop = Math.max(0, state.hitstop - rawDt);
    simDt = dt * 0.12;
  }

  // ONE BAD FRAME MUST NOT BE A DEAD GAME. An exception anywhere below used to
  // abandon the frame after the simulation but before `input.endFrame()`, so
  // edge-triggered presses stayed "pressed" and re-fired every frame, and the
  // canvas froze on its last image with the loop still spinning. The frame body
  // is contained: the error is logged (throttled), input is always consumed, and
  // a fault that repeats for a whole second pauses the race instead of letting
  // it run blind.
  try {
    frameBody(simDt);
    frameErrors = 0;
  } catch (err) {
    frameErrors++;
    frameErrorTotal++;
    if (frameErrorTotal <= 3 || frameErrorTotal % 300 === 0) {
      console.error(`[riderash] frame error (#${frameErrorTotal}):`, err);
    }
    if (frameErrors >= 60 && state.running && !state.paused) {
      frameErrors = 0;
      pauseGame('error');
    }
  }
  input.endFrame();
}

let frameErrors = 0, frameErrorTotal = 0;

// A NaN in one integrator reaches the camera, the standings and every contact
// test within a frame, and a NaN camera renders black forever. Snapshot each
// body while it is healthy and restore the last good state if it is not.
const _finite = (...v) => v.every(Number.isFinite);
function guardBodies() {
  const bodies = player ? [player, ...rivals] : rivals;
  for (const b of bodies) {
    const p = b && b.phys;
    if (!p) continue;
    if (_finite(p.s, p.lateral, p.speed, p.yaw, p.pos.x, p.pos.y, p.pos.z)) {
      const g = b._lastGood || (b._lastGood = {});
      g.s = p.s; g.lateral = p.lateral; g.speed = p.speed;
    } else {
      const g = b._lastGood || { s: 0, lateral: 0, speed: 0 };
      console.warn(`[riderash] non-finite physics on ${b.name || 'player'}; restored s=${g.s.toFixed(1)}`);
      p.reset({ s: g.s, lateral: g.lateral, speed: g.speed * 0.5 });
    }
  }
}

function frameBody(dt) {
  // COUNTDOWN. A race should begin, not fade in. The world runs -- traffic
  // moves, the pack idles, the camera settles -- but throttle and steering are
  // locked until the lights go out, so nobody is already at 50 m/s when the
  // flag drops and the grid stays a grid.
  if (state.countdown > 0) {
    state.countdown -= dt;
    const n = Math.ceil(state.countdown);
    state.warn = n > 0 ? String(n) : 'GO';
    if (state.countdown <= 0) { state.countdown = 0; state.warn = 'GO'; }
  }

  if (state.running && !state.raceOver) {
    stepGame(dt);
    guardBodies();
  }

  // The camera MUST be driven on every frame. updateCamera was defined but
  // never called, so the chase camera stayed wherever the idle orbit left it
  // while the player drove away: measured 302 m of separation, which is why the
  // hero read as a tiny speck and then left the frame entirely.
  if (state.running) {
    updateCamera(dt, state);
  } else {
    updateCameraIdle(dt);
  }

  const speedFrac = state.running ? player.phys.speed / CFG.MAX_SPEED : 0;

  // ---- the world as a function of distance ----
  // One call re-drives the road surface, the verge, the fog and the sky from
  // where the rider actually is. This is what makes the track change under you:
  // wet coast, dry scrub, shaded forest, hot canyon, city night. Everything
  // downstream reads the SAME state object, so the road and the sky can never
  // disagree about what time it is.
  if (state.running && spine) {
    spine.update(dt, player.phys.s);
    if (surfaces) {
      const ws = surfaces.update(player.phys.s, dt);
      if (ws && sky && sky.ok) {
        // sector time-of-day blended with the map's own preference, then nudged
        // by the weather — the sky, the surfaces and the fog all move together
        const sk = MAPS[spine.mapId].sky;
        const tod = THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(sk.day, sk.dusk, ws.timeOfDay) * (1 - spine.weather * 0.25)
          + spine.weather * 0.22, 0, 1);
        sky.update(dt, { timeOfDay: tod, weather: spine.weather });
        applyWeatherLight(spine.weather);
        if (!sky._envCache.has(Math.round(sky.uniforms.uMix.value * 10) / 10)) {
          sky.refreshEnv(scene);
        }
      }
    }
  }

  if (rain) {
    const vel = state.running && player
      ? { x: player.phys.forward.x * player.phys.speed, z: player.phys.forward.z * player.phys.speed }
      : null;
    rain.update(dt, camera, state.running && spine ? spine.weather : 0, vel);
  }

  // HARNESS: `__NORENDER__` skips the present so a software-GL harness can step
  // the real game loop quickly (see __SIM__); `__RENDER__` presents on demand.
  if (window.__NORENDER__) return;
  if (postfx) postfx.render(dt, speedFrac);
  else renderer.render(scene, camera);
}

// HARNESS: advance the real game loop by `sec` of simulated time at a fixed
// 60 Hz without presenting, then (optionally) render one frame. Under a software
// GL the game manages ~1.5 fps and a 3 s countdown costs 40 s of wall clock; this
// runs the same frameBody the browser does, just without waiting on the GPU.
window.__STATE__ = state;
window.__CFG__ = CFG;       // harness: flip tunables at runtime
window.__SIM__ = (sec, renderAfter = false) => {
  const prev = window.__NORENDER__;
  window.__NORENDER__ = true;
  const n = Math.max(1, Math.round(sec * 60));
  try { for (let i = 0; i < n; i++) { frameBody(1 / 60); input.endFrame(); } }
  finally { window.__NORENDER__ = prev; }
  if (renderAfter) window.__RENDER__();
  return n;
};
window.__RENDER__ = () => {
  const speedFrac = state.running && player ? player.phys.speed / CFG.MAX_SPEED : 0;
  if (postfx) postfx.render(1 / 60, speedFrac); else renderer.render(scene, camera);
};

// WEATHER DRIVES THE LIGHT. The sky, fog and road all followed the weather front
// while the sun stayed at full strength, so a storm rendered as a black sky over
// a sunlit, hard-shadowed road. Under overcast the direct key collapses and the
// sky dome becomes the light source; that is what these ratios express.
const LIGHT_BASE = new WeakMap();
function applyWeatherLight(w) {
  if (!lights) return;
  const base = (l) => { if (!LIGHT_BASE.has(l)) LIGHT_BASE.set(l, l.intensity); return LIGHT_BASE.get(l); };
  const k = THREE.MathUtils.clamp(w, 0, 1);
  if (lights.sun) lights.sun.intensity = base(lights.sun) * (1 - 0.72 * k);
  if (lights.rim) lights.rim.intensity = base(lights.rim) * (1 - 0.5 * k);
  if (lights.sky2) lights.sky2.intensity = base(lights.sky2) * (1 - 0.18 * k);
}

let idleAngle = 0;
function updateCameraIdle(dt) {
  if (state.running) return;
  idleAngle += dt * 0.10;
  const s = 40;
  const p = centreAt(-s);
  camera.position.set(p.x + Math.cos(idleAngle) * 9, p.y + 3.4, p.z + Math.sin(idleAngle) * 9);
  camera.lookAt(p.x, p.y + 1.2, p.z - 20);
}

function stepGame(dt) {
  state.time += dt;
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.6);
  if (state.swapped > 0) state.swapped -= dt;

  const hooks = {
    onHit(attacker, targets, a) {
      state.hits++;
      state.score += CFG.PTS_PER_HIT * (1 + attacker.combo * CFG.COMBO_MULT) * (a.name === 'chain' ? 1.6 : 1);
      // audio: ONE SOUND PER BLOW. combat.js reports a landed blow twice by
      // design -- onHitImpact per target from applyDamage (the physical
      // impulse) and onHit once per swing (bookkeeping) -- and a grab also
      // fires onGrab. All three used to play an impact, so a player's kick was
      // two coherent copies (+6 dB into the limiter). The player's melee hits
      // sound in onHitImpact, grabs in onGrab; only a rival's blow sounds here.
      if (attacker !== player.fighter && !a.hold) audio.impact(1.25, a.name);
      if (attacker === player.fighter) {
        state.shake = Math.min(1.2, state.shake + CFG.CAM_SHAKE_HIT);
        const t = targets[0];
        if (t) fx.spark(t.owner.pos.clone().setY(t.owner.pos.y + 1.1), t.owner.forward, 12, 1);
      }
    },
    onCounter() { state.score += 40; },
    // THE GRAB. Telegraphed loudly both ways: a player who is grabbed must know
    // at once that mashing is the answer, and one who grabs, that G throws.
    onGrab(attacker, target) {
      audio.impact(0.8, 'punch');
      if (attacker === player.fighter) { state.warn = 'GRABBED HIM — G TO THROW'; state.shake = Math.min(1.2, state.shake + 0.25); }
      else if (target === player.fighter) { state.warn = 'GRABBED! MASH J K L'; state.shake = Math.min(1.2, state.shake + 0.4); }
    },
    onThrow(attacker, target) {
      state.score += attacker === player.fighter ? 60 : 0;
      state.shake = Math.min(1.4, state.shake + (attacker === player.fighter || target === player.fighter ? 0.6 : 0));
      audio.oneShot('swing', 0.9, 0.8);
      if (attacker === player.fighter) state.warn = 'THROWN!';
      else if (target === player.fighter) state.warn = 'YOU GOT THROWN';
    },
    onSteal(thief, victim) {
      if (thief === player.fighter) { state.warn = 'GOT HIS CHAIN'; state.score += 50; }
      else if (victim === player.fighter) state.warn = 'LOST YOUR CHAIN';
    },
    onBreak(holder, target) {
      if (target === player.fighter) { state.warn = 'BROKE FREE'; state.score += 25; }
      else if (holder === player.fighter) state.warn = 'HE SLIPPED THE GRIP';
    },
    // Impact feedback for the new directional impulses: a chain landed from
    // behind throws a longer spark trail than a jab, because it is a bigger
    // event and the player should be able to tell them apart without reading
    // the HUD.
    onHitImpact(attacker, target, a, side) {
      if (attacker !== player.fighter) return;
      const at = target.owner.pos.clone().setY(target.owner.pos.y + 1.05);
      const n = a.name === 'chain' ? 20 : a.name === 'kick' ? 14 : 9;
      const dir = target.owner.forward.clone().multiplyScalar(a.along >= 0 ? 0.6 : -0.6);
      dir.x += side * 0.5; dir.y = 0.5;
      fx.spark(at, dir, n, a.name === 'chain' ? 1.7 : 1.0);
      audio.impact(a.name === 'chain' ? 1.3 : a.name === 'kick' ? 1.0 : 0.7, a.name);
      if (a.name === 'chain') audio.oneShot('swing', 0.8, 1.0);
    },
    onDisarm(target) {
      state.warn = 'DISARMED';
      if (target === player.fighter) state.score = Math.max(0, state.score - 30);
    },
    onKnockDown(attacker, target) {
      state.knockDowns++;
      state.shake = Math.min(1.4, state.shake + 0.7);
      // THE HITSTOP. Fired here, at the one choke point every wreck passes
      // through, so a punch knockout, a bike-to-bike wreck and a traffic wipeout
      // all get the same beat. Scaled by the target's speed at the moment of the
      // hit: a 45 m/s wipeout holds longer than a 10 m/s bump, because the eye
      // reads the freeze as proportional to the energy it is standing in for.
      {
        const v = (target && target.owner && target.owner.phys && target.owner.phys.speed) || 0;
        state.hitstop = Math.max(state.hitstop, 0.05 + Math.min(0.09, v * 0.0022));
      }
      // A wipeout is the loudest thing that happens in this game and it used to
      // share the generic impact sample with a thrown punch.
      audio.oneShot('crash', target === player.fighter ? 1.1 : 0.55,
        target === player.fighter ? 1.0 : 1.12);
      fx.spark(target.owner.pos.clone().setY(target.owner.pos.y + 0.8), target.owner.forward, 22, 1.6);
      fx.dust(target.owner.pos, 8, 0x8a8070);
      if (attacker === player.fighter) {
        state.score += CFG.PTS_PER_KNOCKDOWN;
        const pos = world.positionOf(target.owner);
        state.warn = `TOOK OUT ${target === player.fighter ? '' : 'RIVAL'}`;
      } else if (target === player.fighter) {
        state.warn = 'YOU WENT DOWN';
      }
    },
    onRemount(f) {
      f.down = false;
      f.hp = Math.max(20, f.maxHp * 0.55);
      f.invuln = CFG.INVULN_AFTER;
      if (f === player.fighter) state.warn = 'REMOUNT';
    },
    onMiss() {},
  };
  // Published on `state` so the crash harness can reach the real hooks from the
  // module-level expose block, which is a different scope (see __HOOKS__ below).
  state.hooks = hooks;

  // player
  // During the countdown every rider is held: the player's input is masked and
  // the pack is not stepped, so the grid stays a grid. `gridInput` is a real
  // input object rather than a null, because player.update reads several fields
  // and a null would be a branch in the hot path for three seconds of the race.
  const gridInput = state.countdown > 0
    ? { throttle: 0, brake: 0.35, steer: 0, tuck: false,
        attackPressed: () => false, pressed: {} }
    : input;
  player.update(dt, gridInput, world, hooks);
  // SLIDE DUST. A thrown body scrubbing along the tarmac kicks up grit, and the
  // trail dying away with its speed is half of what reads as "he slid".
  {
    const rag = player.dismount && player.dismount.rag;
    if (rag && rag.contact > 0.15) {
      const v = rag.velocity(_slideV).length();
      slideDustT -= dt;
      if (v > 3 && slideDustT <= 0) {
        slideDustT = 0.05;
        fx.dust(rag.pelvis, v > 12 ? 3 : 1, 0x8a8070);
      }
    }
  }
  if (touchpad) touchpad.sync(player.fighter);

  // rivals
  // SLIPSTREAM. The integrator deliberately knows nothing about the pack, so
  // the tow is computed here, where the positions are, and handed to it as a
  // single 0..1. Sitting in clean air behind a rider is worth ~45% of the drag,
  // which at 50 m/s is a real closing tool and the reason to stay in the pack
  // rather than fight your way out of it early.
  {
    const p = player.phys;
    let tow = 0;
    for (const r of rivals) {
      if (!r.phys || r.fighter.down) continue;
      const ahead = r.phys.s - p.s;                       // +ve = they are in front
      if (ahead <= 1.5 || ahead > PHYS_SLIP_RANGE) continue;
      if (Math.abs(r.phys.lateral - p.lateral) > PHYS_SLIP_LATERAL) continue;
      // strongest right behind them, fading out to nothing at the limit
      tow = Math.max(tow, 1 - (ahead - 1.5) / (PHYS_SLIP_RANGE - 1.5));
    }
    // Guarded, per §5.6: a non-finite value entering here reaches the drag term
    // and then every other field in the integrator. This caught a real NaN once
    // (see rivals.js laneHome) and the guard stays because reading another
    // object's state is exactly where one gets in.
    if (Number.isFinite(tow)) p.slipstream += (tow - p.slipstream) * Math.min(1, dt * 3.0);
  }

  if (state.countdown <= 0) { for (const r of rivals) r.update(dt, world, hooks); }
  // THE POLICE. After the pack, so a bust is judged on this frame's crash.
  if (cop && state.countdown <= 0) {
    const ev = cop.update(dt, player, state.running && !state.raceOver, world.traffic, hooks, state.finishS);
    // A CHASING cop is a fighter like anyone: in the list while he chases (so the
    // player's punches can find him), out of it otherwise (nobody punches a
    // parked cop, and a cop who left is not a target).
    const inList = world.fighters.includes(cop.fighter);
    if (cop.active && !inList) world.fighters.push(cop.fighter);
    else if (!cop.active && inList) world.fighters.splice(world.fighters.indexOf(cop.fighter), 1);
    if (ev === 'arrived') state.warn = 'COPS!';
    else if (ev === 'down') state.warn = 'COP DOWN!';
    else if (ev === 'gone') state.warn = cop.fighter.down ? '' : 'LOST THE COP';
    else if (ev === 'busted' && !state.raceOver) { state.raceOver = true; bustRace(); }
    const flag = document.getElementById('copflag');
    if (flag) flag.classList.toggle('on', cop.active && !state.raceOver);
    if (cop.active) {
      const gap = player.phys.s - cop.phys.s;
      audio.siren(1 / (1 + (Math.hypot(gap, player.phys.lateral - cop.phys.lateral) / 25) ** 2),
        (cop.phys.lateral - player.phys.lateral) / 4);
    } else audio.siren(0);
  }
  else { for (const r of rivals) { r.phys.speed *= 0.94; r.applyVisual(dt); } }

  // ---- bike-to-bike contact -------------------------------------------
  // Resolved AFTER every body has moved, against final positions, so a pair is
  // never left interpenetrating because one of them stepped first. This is the
  // difference between five riders being five independent objects and five
  // riders sharing one road.
  const bodies = [player, ...rivals];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i].phys, b = bodies[j].phys;
      if (bodies[i].fighter.down || bodies[j].fighter.down) continue;  // a fallen rider is not a solid body
      // Thresholds live in CFG (see CONTACT_NOISE / NOTIFY / WRECK) rather than as
      // literals here, because they are the difference between "the pack raced
      // me" and "the pack deleted me" and they needed to be tunable together.
      const closing = a.contact(b);
      if (closing > CFG.CONTACT_NOISE) {
        // a real hit: sparks, a thud, and the pair visibly shove apart
        const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
        const dir = a.pos.clone().sub(b.pos).normalize().multiplyScalar(0.5, 0.6, 0.5);
        fx.spark(mid, dir, Math.round(8 + Math.min(14, closing * 1.2)), Math.min(2.0, closing * 0.12));
        audio.impact(Math.min(1, closing / 14), 'body');
        state.shake = Math.max(state.shake, Math.min(0.45, closing * 0.035));
        if (closing > CFG.CONTACT_NOTIFY) state.warn = 'CONTACT';
        state.contacts++;
        if (closing > CFG.CONTACT_WRECK) {
          // A very hard hit (a rear wheel into a front wheel at racing speed)
          // puts the SLOWER rider down. The knockdown is applied through the
          // SAME hook a punch uses, so a collision wreck and a punch wreck score
          // and spark identically -- one code path, not two.
          const vi = a.speed < b.speed ? i : j;
          const v = bodies[vi];
          const f = v.fighter;
          if (!f.down && !f.invuln) {
            { const who = 'contact:' + (v === player ? 'player' : (v.name || 'rival'));
              (state.wrecksBy = state.wrecksBy || {})[who] = (state.wrecksBy[who] || 0) + 1; }
            f.down = true;
            f.downTimer = CFG.WRECK_TIME;
            f.active = null;
            f.invuln = CFG.INVULN_AFTER;
            v.phys.speed *= CFG.CRASH_SPEED_LOSS;
            v.phys.yawOffset += (Math.random() - 0.5) * 1.6;
            hooks.onKnockDown(v === player ? null : player.fighter, f);
            if (v === player) state.warn = 'DOWN';
          }
        }
      }
    }
  }

  // occasional dust from hard contact, plus the usual off-road dust
  for (const o of bodies) {
    if (o.phys.contactImpulse > 3.5) {
      fx.dust(o.phys.pos, 3, 0x9a8f7a);
      o.phys.contactImpulse = 0;
    }
  }

  // dust when a rider is off the road
  for (const o of world.parts) {
    if (!o.phys.onRoad && o.phys.speed > 3) {
      fx.dust(o.pos, 2, 0x8f8570);
    }
  }

  fx.update(dt, player.pos, player.speed / CFG.MAX_SPEED);

  // audio: engine pitch from revs, scrape from lean and surface
  // The nearest rival along the road, for the passing engine note. `closing`
  // is the rate the gap shrinks: behind and faster, or ahead and slower.
  let near = null;
  for (const r of rivals) {
    const dS = r.phys.s - player.phys.s;
    const dist = Math.hypot(dS, r.phys.lateral - player.phys.lateral);
    if (!near || dist < near.dist) {
      near = { dist, speed: r.phys.speed,
               closing: -Math.sign(dS) * (r.phys.speed - player.phys.speed),
               pan: (r.phys.lateral - player.phys.lateral) / 4 };
    }
  }
  audio.update({
    speed: player.phys.speed,
    maxSpeed: CFG.MAX_SPEED,
    throttle: input.down.up ? 1 : 0,
    rival: near,
    lean: player.phys.lean,
    offRoad: !player.phys.onRoad,
    down: player.fighter.down,
    muted: state.muted,
  });

  // ADDITIVE AUDIO. A separate pass over the same frame state: the per-map bed,
  // the 3-2-1-GO beeps, the chain rattle, the crowd bed and the wet-road hiss.
  // Nothing above changes, and `audio` is untouched — this only reads state.
  audioExt.update({
    map: spine ? spine.mapId : null,
    speed: player.phys.speed,
    muted: state.muted,
    weapon: !!(player.fighter && player.fighter.hasWeapon),
    town: surfaces && surfaces.lastState ? (surfaces.lastState.scenery && surfaces.lastState.scenery.town) || 0 : 0,
    wetness: spine ? spine.wetness : 0,
    countdown: state.countdown,
  });

  // Traffic follows the ROAD, in lanes, in both directions. The old loop
  // advanced each car in world z only, which walked them off a road that
  // wanders 76 m sideways -- see updateTraffic in world.js.
  // The riders are passed so a car slows behind a bike in its lane and every
  // car stops short of a rider lying in the road (traffic.js updateTraffic).
  if (window.__TRAFFIC_OFF__ && world.traffic) {
    // HARNESS: an empty road, to test the pack or the cop without the traffic.
    world.traffic.visible = false;
    for (const c of (world.traffic.userData.cars || [])) { const u = c.userData; u.s = u.prevS = -1e5; u.at = u.prevAt = 0; u.speed = 0; }
  } else updateTraffic(world.traffic, player.phys.s, dt, state.time || 0, world.parts);

  // RIDING-VERB FEEDBACK. A verb the player cannot see or hear is a number in
  // a file: the landing needs a thump, the boost needs a note, and both need a
  // word on the HUD or nobody learns the key exists.
  {
    const p = player.phys;
    if (p.landHit > 0) {
      const hard = p.landHit > 6.0;
      audio.oneShot(hard ? 'crash' : 'impact', hard ? 0.85 : 0.45, hard ? 1.1 : 1.35);
      fx.dust(p.pos, hard ? 10 : 5, 0x8a8070);
      if (hard) { state.shake = Math.min(1.2, state.shake + 0.45); state.warn = 'HARD LANDING'; }
      p.landHit = 0;                               // consumed; one sound per landing
    }
    if (p.boost > 0 && !state.wasBoosting) { audio.oneShot(audio.buffers.boost ? 'boost' : 'swing', 0.7, 1.0); state.warn = 'BOOST'; }
    state.wasBoosting = p.boost > 0;
    if (p.airborne && p.airTime > 0.45) state.warn = 'AIRBORNE';
    else if (p.wheelie > 0.30) state.warn = 'WHEELIE';
    else if (p.slipstream > 0.55) state.warn = 'SLIPSTREAM';
  }

  // ---- TRAFFIC: horn, and REAL contact for every rider -------------------
  //
  // HORN. A driver leans on it when a bike is about to be where they are: any
  // vehicle, either direction, whose time-to-contact with the player along the
  // player's line is under 1.4 s. Pitch by type (traffic.js VEHICLES.horn): a
  // semi's air horn at 0.6x, a sedan's at 1.1x.
  state.hornCd = Math.max(0, (state.hornCd || 0) - dt);
  const tcars = world.traffic && world.traffic.userData ? world.traffic.userData.cars : null;
  if (tcars && state.hornCd <= 0 && player.phys.speed > 12 && !player.fighter.down) {
    const p = player.phys;
    for (const car of tcars) {
      const u = car.userData;
      if (u.at === undefined || Math.abs(u.at - p.lateral) > u.halfW + 1.6) continue;
      const d = u.s - p.s, carVs = u.dir > 0 ? -u.speed : u.speed;
      const close = d > 0 ? p.speed - carVs : carVs - p.speed;
      if (close <= 2) continue;
      const ttc = (Math.abs(d) - u.halfL - 1) / close;
      if (ttc > 0 && ttc < 1.4) {
        state.hornCd = 2.4;
        audio.oneShot('horn', 0.6, (u.hornPitch || 1) * (0.96 + Math.random() * 0.08));
        break;
      }
    }
  }

  // CONTACT. Traffic used to cost a quarter of the health bar and let the rider
  // ride on THROUGH the car; rivals were never tested at all. Now every upright
  // rider -- player and pack alike -- runs the swept road-frame test in
  // traffic.js, and the response depends on HOW they hit:
  //   end face (rear-end / head-on) above 8.5 m/s closing -> WIPEOUT;
  //   below that -> bump: matched to the vehicle's speed, put back on its face;
  //   side -> side-swipe: shoved off the flank, speed scrubbed, and a wipeout
  //   only above 6 m/s of lateral closing.
  // A per-(vehicle, rider) cooldown of 0.6 s lives in traffic.js, so one car
  // cannot score a hit every frame it overlaps.
  if (CFG.TRAFFIC_COLLISION && tcars) {
    for (const rd of world.parts) {
      const f = rd.fighter;
      if (!rd.phys || !f || f.down) continue;
      const hit = window.__TRAFFIC_OFF__ ? null : trafficContact(world.traffic, rd.phys);
      if (!hit) continue;
      const res = applyTrafficHit(rd.phys, hit, f.invuln > 0);
      if (res.quiet) continue;              // still solid, but the hit was already scored
      const isP = rd === player;
      state.trafficHits = (state.trafficHits || 0) + 1;
      f.hp = Math.max(0, f.hp - (isP ? res.dmg : res.dmg * 0.8));
      const dist = Math.hypot(rd.phys.s - player.phys.s, rd.phys.lateral - player.phys.lateral);
      const vol = isP ? 1 : Math.max(0, 1 - dist / 140);
      if (vol > 0.03) {
        audio.oneShot(res.wreck ? 'crash' : 'impact', vol * (res.wreck ? 1.0 : 0.75), res.wreck ? 1.0 : 1.2);
        if (hit.kind === 'side') audio.oneShot('scrape', vol * 0.7, 1.0);
      }
      if (dist < 160) {
        const at = rd.phys.pos.clone(); at.y += 0.8;
        fx.spark(at, new THREE.Vector3(0, 0.6, 0), res.wreck ? 24 : 10, res.wreck ? 1.6 : 0.9);
      }
      if (res.wreck || (f.hp <= 0 && !(f.invuln > 0))) {
        const who = isP ? 'player' : (rd.name || 'rival');
        (state.wrecksBy = state.wrecksBy || {})[who] = (state.wrecksBy[who] || 0) + 1;
        // Same fields the bike-to-bike wreck sets, attacker-less: a traffic
        // wipeout is nobody's knockdown, so it does not score for the player.
        if ((f.hold || f.heldBy) && f._endHold) f._endHold('break', hooks);
        f.down = true;
        f.downTimer = CFG.WRECK_TIME;
        f.active = null;
        f.invuln = CFG.INVULN_AFTER;
        rd.phys.yawOffset += (Math.random() - 0.5) * 1.6;
        state.trafficWrecks = (state.trafficWrecks || 0) + 1;
        if (isP) { state.warn = 'WIPEOUT'; state.shake = Math.min(1.4, state.shake + 0.8); hooks.onImpact?.(1.0);
          state.hitstop = Math.max(state.hitstop, 0.05 + Math.min(0.09, rd.phys.speed * 0.0022)); }
        else if (dist < 60) state.warn = 'RIVAL HIT TRAFFIC';
      } else if (isP) {
        state.warn = hit.kind === 'side' ? 'SIDE-SWIPE' : 'BUMP';
        state.shake = Math.min(1.0, state.shake + 0.25 + res.severity * 0.02);
        hooks.onImpact?.(0.5);
      }
    }
  }

  // sun follows the player so shadow detail stays near
  followSun(lights.sun, player.pos);

  // Sky, road surface, fog and weather are all driven from WorldSpine in the
  // frame loop, so they are never updated from two places with two opinions.

  // score from distance
  state.score += player.phys.speed * dt * CFG.PTS_PER_METER;

  // race end
  const pos = world.positionOf(player.phys);
  if (pos !== state.lastPos) { state.lastPos = pos; if (pos === 1) state.warn = 'LEADING'; }
  if (player.phys.s >= state.finishS && !state.raceOver) {
    state.raceOver = true;
    endRace(pos);
  }

  // HUD
  try {
    // The cop is on the radar from the moment he takes up his spot, not only
    // once he is chasing: the ambush is something you should see coming.
    radar.update(dt, player, cop && cop.present ? [...rivals, cop] : rivals,
      world.traffic && world.traffic.userData ? world.traffic.userData.cars : null);
  } catch (e) { /* the radar must never take the frame down */ }

  hud.update({
    position: world.positionOf(player.phys),
    field: world.parts.length,
    mph: player.phys.mph,
    // speedometer (hud.js Speedo): nitro lamp/flash and the gear the engine
    // audio is actually in, so the digit matches the note you hear
    boost: player.phys.boost > 0,
    boostCool: player.phys.boostCool > 0,
    gear: audio._gear,
    time: state.time,
    s: player.phys.s,
    hp: player.fighter.hp,
    maxHp: player.fighter.maxHp,
    stamina: player.fighter.stamina,
    combo: player.fighter.combo,
    score: state.score,
    warn: state.warn,
    swapped: state.swapped,
    // The meter reads what the MACHINE HAS COST so far this race, so a crash is
    // a decision the player can see rather than a bill at the finish.
    repairBill: career.repairBill(player.damage || 0),
    fps,
    showFps: settings.showFps,
    target: hudTarget(),
  });
  state.warn = '';
}

// Ordinals for a field as large as Road Rash's. The pack is strung out over the
// whole course, so a 4th of 15 has to read correctly.
const ORDINALS = (() => {
  const a = [];
  for (let i = 1; i <= 32; i++) {
    const s = ['TH', 'ST', 'ND', 'RD'][(i % 100 - 20) % 10] || ['TH', 'ST', 'ND', 'RD'][i % 100] || 'TH';
    a.push(i + s);
  }
  return a;
})();

// BUSTED: a wreck with a cop in reach. The race is void and the fine is due.
function bustRace() {
  document.getElementById('copflag')?.classList.remove('on');
  const ev = career.event;
  const fine = Cop.fine(ev);
  const damage = player.damage || 0;
  const res = career.bust(fine, damage);
  const lines = [
    `<b>${ev.name}</b> &nbsp;·&nbsp; <b>Level ${ev.level}/5</b> — you went down with a cop on your tail.`,
    `Fine: <b>-$${res.fine}</b>`,
  ];
  if (res.bill > 0) lines.push(`Repairs for ${damage.toFixed(2)} damage: <b>-$${res.bill}</b>`);
  lines.push(`Bank <b>$${res.cash}</b>`);
  lines.push(res.over ? "<b>CAN'T PAY THE FINE.</b> Career over." : 'No placing, no prize. Ride it again.');
  audio.siren(0);
  audio.oneShot('horn', 0.6, 0.8);
  hud.ended(res.over ? "YOU'RE OUT OF THE GAME" : 'BUSTED!', lines.join('<br>'));
  state.running = false;
  state.endedAt = performance.now();
  audio.idle();
  audio.playMusic('menu');
  refreshTitle();
}

function endRace(pos) {
  audio.siren(0);
  document.getElementById('copflag')?.classList.remove('on');
  const names = ORDINALS;
  const bonus = Math.max(0, (world.parts.length - pos)) * CFG.PTS_POSITION_BONUS;
  state.score += bonus;

  // The career is settled HERE, not on the title screen, so a result counts the
  // moment it happens and closing the tab cannot lose a win.
  const ev = career.event;
  // THE BILL IS COMPUTED FROM THE RACE'S ACCRUED DAMAGE and passed in, so the
  // result -- including the career ending -- is settled in one place.
  const damage = player.damage || 0;
  const res = career.finish(pos, world.parts.length, state.time, damage);
  // Result sting: a win gets the rock stinger and the crowd, a qualifying
  // finish (4th or better) the crowd, anything else -- or going broke -- the
  // sour brass.
  audio.finish(res.over ? 'fail' : pos === 1 ? 'win' : res.advanced ? 'qualify' : 'fail');

  let title = pos === 1 ? 'YOU WIN' : pos <= 3 ? 'ON THE PODIUM' : 'RACE OVER';
  if (res.over) title = "YOU'RE OUT OF THE GAME";
  const mm = Math.floor(state.time / 60), ss = Math.floor(state.time % 60);
  const clock = `${mm}:${String(ss).padStart(2, '0')}`;
  const lines = [
    `<b>${ev.name}</b> &nbsp;·&nbsp; <b>Level ${ev.level}/5</b> — finished <b>${names[pos - 1] || pos}</b> of ${world.parts.length} in ${clock}`,
    `${state.hits} hits landed &nbsp; ${state.knockDowns} riders taken out`,
  ];
  // The bill is shown BEFORE the money, because that is the order it is charged
  // and the order the player needs to feel it in.
  if (res.bill > 0) lines.push(`Repairs for ${damage.toFixed(2)} damage: <b>-$${res.bill}</b>`);
  if (res.paid > 0) lines.push(`Prize: <b>+$${res.paid}</b>`);
  else lines.push('Outside the top three — <b>no prize money</b>.');
  lines.push(`Bank <b>$${res.cash}</b>`);

  if (res.over) {
    lines.push('<b>BROKE AND WRECKED.</b> There is no ride home. Career over.');
  } else if (res.complete) {
    lines.push('<b>SERIES COMPLETE</b> — you won every level.');
  } else if (res.advanced) {
    lines.push(`Next up: <b>${career.event.name}</b> — Level ${career.event.level}/5`);
  } else {
    lines.push('Fourth or better to move on. Ride it again.');
  }
  // THE FIELD, in finishing order. Riders still on the road are ranked by
  // distance, which is exactly the order they would cross the line in.
  const board = world.standings().map((e, i) => {
    const me = e === player;
    const nm = me ? 'YOU' : (e.name || 'RIDER');
    const down = e.fighter && e.fighter.down ? ' · down' : '';
    return `<tr class="${me ? 'me' : ''}"><td>${names[i] || i + 1}</td><td>${nm}${down}</td></tr>`;
  }).join('');
  const table = `<table class="board">${board}</table>`;
  hud.ended(title, lines.join('<br>') + table);
  if (touchpad) touchpad.reset();
  phone.end();                   // menus may let the phone sleep
  state.running = false;
  state.endedAt = performance.now();
  audio.idle();
  audio.playMusic('menu');
  refreshTitle();
}

// ---------- harness contract ----------
window.__READY__ = false;
window.__START__ = () => {
  // DROP FOCUS FROM WHATEVER STARTED THE RACE. A focused <button> is activated
  // by Space and Enter, so with the RIDE button still focused the boost key
  // re-fired it and restarted the race mid-lap -- measured as a top speed of
  // 7.8 m/s, which is the 8 m/s the grid resets to. Any key bound to a game
  // action is a hazard while a button holds focus.
  try { document.activeElement?.blur?.(); } catch (e) { /* not fatal */ }
  document.getElementById('title').classList.remove('on');
  document.getElementById('over').classList.remove('on');
  hud.show(true);
  // THE CAREER EVENT PICKS THE COURSE AND ITS LENGTH. A level is five races on
  // the same five tracks, and higher levels run them LONGER (`lenMul`). The
  // finish line is a property of that decision, so it is set here, per race,
  // rather than at load -- a race always ends where its own level says.
  const ev = career.event;
  spine.setMap(ev.map, ev.lenMul);
  // Re-dress the roadside for this course (no-op when it is already dressed).
  try { if (scenery) scenery.setCourse(spine); } catch (e) { console.warn('[riderash] scenery:', e); }
  state.finishS = spine.totalLength;
  placeFinish(finishGantry, state.finishS);
  world.raceLen = spine.totalLength;
  resetRace();
  state.running = true;
  phone.begin();                 // a real tap on RIDE: allowed to go fullscreen
  // Tilt: a saved preference must be re-granted after a reload, and the RIDE
  // tap is a gesture iOS accepts. Either way, straight-ahead is re-taken now.
  if (settings.tilt && !tilt.active) tilt.enable().then(() => applyTouchVisibility());
  tilt.calibrate();
  window.__READY__ = true;
  // Audio needs a real user gesture to start. __START__ is wired to the real
  // RIDE button, so this is that gesture. If it is called from a test harness
  // there is no gesture and the context stays suspended, which is fine.
  audio.init().catch(() => {});
  audio.playMusic('race');
  audioExt.init().catch(() => {});   // ADDITIVE: extra beds/beeps, after the base mix exists
  state.paused = false;
  document.getElementById('pause').classList.remove('on');
  document.getElementById('settingsscreen').classList.remove('on');
};
// M to mute. A silent game reads as unfinished, but so does one that cannot be
// silenced.
// Camera and mute are FUNCTIONS, not key handlers, because a phone reaches
// them through HUD buttons (CAM / SND) and both paths must behave identically.
function setCamera(n) {
  state.camMode = ((n % CAM_MODES.length) + CAM_MODES.length) % CAM_MODES.length;
  state.warn = CAM_MODES[state.camMode].name;
  settings.camMode = state.camMode; saveSettings(settings);
  camInitialised = false;          // do not smear between two very different views
}
function toggleMute() {
  state.muted = !state.muted;
  audio.setMuted(state.muted);
  state.warn = state.muted ? 'MUTED' : 'SOUND ON';
}
addEventListener('keydown', (e) => {
  // C cycles the camera; 1-7 pick one directly. Announced through the same
  // warn line the mute key uses, so the mode is readable without extra chrome.
  if (e.code === 'KeyC') setCamera(state.camMode + 1);
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5)) - 1;
    if (n >= 0 && n < CAM_MODES.length) setCamera(n);
  }
  if (e.code === 'KeyM') toggleMute();
});
// On a phone, camera and sound are PAUSE-MENU items (the HUD keeps one pause
// button in the corner). Labels carry the current state so a tap is legible.
function refreshPauseItems() {
  const c = document.getElementById('p-camera');
  const m = document.getElementById('p-sound');
  if (c) c.textContent = `CAMERA · ${CAM_MODES[state.camMode % CAM_MODES.length].name}`;
  if (m) m.textContent = `SOUND · ${state.muted ? 'OFF' : 'ON'}`;
}
document.getElementById('p-camera').addEventListener('click', () => { setCamera(state.camMode + 1); refreshPauseItems(); });
document.getElementById('p-sound').addEventListener('click', () => { toggleMute(); refreshPauseItems(); });
window.__GAME__ = {
  pos: [0, 0], fps: 0, speed: 0, score: 0, over: false, draws: 0, tris: 0,
  // extras for our own gate
  hp: 100, stamina: 100, combo: 0, hits: 0, knockDowns: 0,
  hitstop: 0,
  lateral: 0, position: 6, s: 0, down: false,
};

function resetRace() {
  // The garage's bike is the machine you see: tier -> class (src/kit.js), tier colour.
  try {
    if (player && career.bike) player.setBike(bikeSource(assets, BIKE_FOR_TIER[career.bike.id] || 'sport'), career.bike.colour);
  } catch (e) { console.warn('[riderash] setBike:', e); }
  state.time = 0; state.score = 0; state.hits = 0; state.knockDowns = 0; state.contacts = 0; state.trafficHits = 0; state.trafficWrecks = 0;
  state.raceOver = false; state.shake = 0; state.hitstop = 0; state.wrecksBy = {}; state.swapped = 0; state.lastPos = 6;
  camInitialised = false; camRoll = 0; crashHold = 0;
  // THE PACK FOR THIS RACE, built once from the roster and the career event.
  // Built here rather than at load because the event changes between races and
  // the same characters have to get harder; built ONCE rather than per rival so
  // all five entries come from one consistent draw of the roster.
  // [npc-persona] seeded per race (window.__SEED__ / ?seed=): who enters, grid
  // order, moods and every brain's mid-race draws differ race to race.
  packForThisRace = gridFor(career.event, CFG.RIVAL_COUNT, { seed: takeRaceSeed() }).map((e) => ({
    ...e,
    // Damped, not raw -- see aggroFactorFor. A raw 0.70/1.35 on a persona whose
    // base aggression is already 1.45 produced a race-one brawl once rival
    // attacks started landing.
    aggroScale: aggroFactorFor(career.event),
  }));
  // The on-foot machine is per-race state too. A race that ends while the
  // player is walking would otherwise leak FALLING/DOWN/WALKING into the next
  // race and start it with a man on foot and no bike (§5.16, same class as the
  // BikePhys/Rival/Fighter leaks). Player.update self-heals if this is missed,
  // but depending on self-healing is how the other three leaks survived.
  player.reset();
  // No police in the career's very first race: that one teaches the ride and
  // the fight. Every race after it can have a cop.
  if (cop) cop.reset(career.event.level, career.state.race > 0 || career.state.wins > 0);
  // Full integrator reset -- see BikePhys.reset. Setting four fields by hand
  // leaked lateralV from the previous race and started the next one at the rail.
  // The player's machine is the bike they bought -- see BikePhys.setMachine.
  if (career.bike) player.phys.setMachine(career.bike);
  // START BEHIND THE PACK. The player used to line up on the front row, level
  // with the leaders, so the race began already won. Road Rash puts you at the
  // back: you have to ride through the field, and that is where the fights are.
  player.phys.reset({ s: 1.5, lateral: 1.1, yawOffset: 0, speed: 8 });
  // The player's fighter, reset in FULL -- same class of leak as BikePhys and
  // Rival (§5.16). `downTimer`, `invuln`, `hitFlash` and the per-attack
  // cooldowns were all carrying into the next race.
  const pf = player.fighter;
  pf.hp = pf.maxHp;
  pf.stamina = CFG.STAMINA_MAX;
  pf.down = false; pf.downTimer = 0;
  pf.combo = 0; pf.active = null;
  pf.hitFlash = 0; pf.invuln = 0;
  pf.hasWeapon = true;
  for (const k in pf.cooldowns) pf.cooldowns[k] = 0;
  state.carHitCd = 0; state.hornCd = 0;
  state.countdown = CFG.COUNTDOWN;
  player.phys.sync();
  rivals.forEach((r, i) => {
    // Rival.reset clears the AI as well as the physics -- see its comment for
    // why race 0 behaved differently from every race after it.
    // A REAL STARTING GRID.
    //
    // Rivals used to line up at s = 7..23 directly ahead of a player who starts
    // at s = 0 doing 8 m/s. The player accelerated straight into the back of
    // the pack, was knocked sideways at low speed, and off-road drag did the
    // rest: _nondet runs that failed all showed `maxV` around 17 m/s, meaning
    // the bike never got going at all rather than being knocked off later.
    //
    // Now the pack is staggered AROUND the player -- two behind, three ahead --
    // each on its own lane home, everyone rolling at the same speed. Nobody is
    // rear-ended before the race has started.
    //
    // Grid speeds are a FIXED per-slot offset, not Math.random(). A random
    // draw here was the last nondeterminism in the pack path, and it made
    // _nondet's "4 identical runs" claim false: the runs only ever *looked*
    // identical because the variance (<2 m of player distance) hid inside the
    // tolerance. The offset is a constant, like a colour, so the whole race is
    // now reproducible from the seed-free frame loop alone.
    // A FOURTEEN-RIDER GRID. The arrays are generated rather than hand-listed: 14
    // riders stagger back in rows across the road, paced off the grid so nobody is
    // rear-ended before the start. With 14 riders, a five-entry array modulo'd
    // would stack three riders on every slot.
    //
    // FIVE COLUMNS, NOT FOUR. Four columns across the old 7.5 m road put the outer
    // pair at +/-3.1 m, which is 0.65 m from the white line -- a rival could not
    // hold its own start line, and the two inside riders had 2.05 m of tarmac
    // between them, less than two bike widths. The road is now 11.0 m, and the
    // grid is laid out on it in five columns spanning +/-4.4 m: the rows are
    // further apart laterally than the bikes are long, so the pack launches as a
    // grid rather than as a queue.
    const COLS = 5;
    const row = Math.floor(i / COLS), col = i % COLS;
    const lanesCol = [-4.4, -2.2, 0, 2.2, 4.4];
    const gridS = 8 + row * 3.4 - (col & 1 ? 1.7 : 0);
    const gridSpeedJitter = [0.11, -0.07, 0.04, -0.12, 0.09, -0.05, 0.08, -0.03,
      0.06, -0.09, 0.02, -0.11, 0.07, -0.04][i % 14];
    r.reset({ s: Math.max(0, gridS), lateral: lanesCol[col],
      yawOffset: 0,
      speed: 8 + gridSpeedJitter * 3 * 0.35,   // ~±0.4 m/s of launch jitter
      // THE ROSTER, for the CURRENT career event. This is what makes the pack
      // nine named characters rather than five slots of arithmetic, and it is
      // what carries the event's difficulty: `career.event` supplies skill and
      // aggro, `gridFor` scales each rider's authored numbers by them, so the
      // same SLATER is the wall in race one and unbeatable in race five.
      entry: packForThisRace[i] || null,
      slot: i });
  });
  // Traffic is per-race state too -- see resetTraffic for the leak this closes.
  if (world && world.traffic) resetTraffic(world.traffic, 0);
  hud.show(true);
}

function publishState() {
  if (!player) return;
  const g = window.__GAME__;
  g.pos = [player.phys.pos.x, player.phys.pos.z];
  window.__PLAYERPOS__ = [player.phys.pos.x, player.phys.pos.y, player.phys.pos.z];
  g.fps = fps;
  g.speed = player.phys.speed;
  // Countdown and the riding verbs, published HERE -- on __GAME__, which is the
  // harness contract -- and not on the audio update object, which is where they
  // first landed. Two things went wrong silently because of that: the gate's
  // `countdown > 0` wait never waited (undefined is not > 0, so it returned
  // immediately and folded the whole grid hold into the throttle measurement),
  // and _verbs.mjs read every verb as zero and reported four working mechanics
  // as NEVER FIRED.
  g.countdown = state.countdown;
  g.wheelie = player.phys.wheelie;
  g.airborne = player.phys.airborne;
  g.airY = player.phys.airY;
  g.boost = player.phys.boost;
  g.boostCool = player.phys.boostCool;
  g.slipstream = player.phys.slipstream;
  g.score = state.score;
  g.over = state.raceOver;
  g.draws = postfx && postfx.sceneStats ? postfx.sceneStats.calls : renderer.info.render.calls;
  g.tris = postfx && postfx.sceneStats ? postfx.sceneStats.triangles : renderer.info.render.triangles;
  g.hp = player.fighter.hp;
  g.stamina = player.fighter.stamina;
  g.combo = player.fighter.combo;
  g.hits = state.hits;
  g.knockDowns = state.knockDowns;
  g.hitstop = state.hitstop;                  // harness: the wreck freeze is live
  g.contacts = state.contacts;
  g.trafficHits = state.trafficHits || 0;     // traffic.js contacts, all riders
  g.trafficWrecks = state.trafficWrecks || 0; // ...of which wipeouts
  g.lateral = player.phys.lateral;
  g.position = world.positionOf(player.phys);
  g.s = player.phys.s;
  g.down = player.fighter.down;
  // THE PUNISHMENT METER, published for the harness. `damage` is the accrued
  // units; `repairBill` is what they would cost at this level's purse. Both are
  // needed: damage is the physics-side fact, the bill is the economy-side fact,
  // and the three-series feel harness reads the damage.
  g.damage = player.damage || 0;
  g.repairBill = career.repairBill(player.damage || 0);
  g.careerOver = career.over;
  g.level = career.event.level;
  g.course = career.event.name;
  g.raceIndex = career.raceIndex;
  // World-spine state: which map, which sector, which biome, how much rain.
  // This is what makes a visual regression diagnosable — "the road turned grey"
  // is unactionable, whereas "roughness 0.30 in sector 4, wetness 0.7" is not.
  if (spine) {
    const ws = surfaces && surfaces.lastState;
    g.map = spine.mapId;
    g.weather = spine.weather;
    g.wetness = spine.wetness;
    g.biome = ws ? ws.biome : null;
    g.sector = ws ? ws.sector : null;
    g.sectors = ws ? ws.sectorCount : null;
    g.roadRough = ws ? ws.roadRough : null;
    g.timeOfDay = ws ? ws.timeOfDay : null;
  }
  // expose the physical state for the harness: lateral drift, grip and slip are
  // the three values that explain any handling regression, and without them a
  // "the bike left the road" report is unactionable.
  window.__PLAYERPHYS__ = player.phys;
  // The rider and bike NODES, and the crash state machine. The user reported the
  // wreck "doesn't feel like an impact, the body stays close to the bike": that
  // is a claim about rider-bike world separation and about which parent the rider
  // hangs under, and neither can be read from `phys`. A harness that can only see
  // `phys` can only re-assert the bug, not measure it. These three expose the two
  // bodies and the state name so `_crashsep.mjs` can measure the separation
  // directly rather than trusting a comment in dismount.js.
  window.__PLAYER_RIDER__ = player.rider;
  window.__PLAYER_BIKE__ = player.bike;
  window.__DISMOUNT__ = player.dismount;
  // And the player's own fighter, so the harness can trigger a wreck through the
  // exact hook combat uses instead of trying to reach a crash by driving into
  // things (which makes the crash direction random and the measurement useless).
  window.__PLAYER_FIGHTER__ = player.fighter;
  // The game's own combat hooks. A wreck triggered from the harness must go
  // through the SAME hook object the game uses, or a probe reports "no hitstop"
  // while the game is firing it correctly -- exactly the false negative this
  // costs one property to prevent. `__PLAYER_FIGHTER__.knockDown(f, __HOOKS__)`.
  //
  // A GETTER, not a snapshot: this module-level block runs once at load, before
  // frameBody has ever assigned `state.hooks`, so a plain assignment here would
  // publish `undefined` forever and the probe would silently measure nothing.
  Object.defineProperty(window, '__HOOKS__', { get: () => state.hooks, configurable: true });
  // The road's own centre-line height at a world z, so a crash probe can measure
  // how far the thrown body rose ABOVE THE ROAD rather than above a bike that is
  // itself falling. Without it the launch is measured against a moving reference
  // and reads ~0.2 m low.
  window.__ROADY__ = (z) => centreAt(z).y;
  // The live body spec, so the showroom and the harness can both see what the
  // player is actually made of rather than re-deriving it.
  window.__BODYSPEC__ = player.rider && player.rider.userData ? player.rider.userData.spec : null;
  window.__RIVALS__ = rivals;   // harness: the pack, for contact and slipstream diagnosis
  // The traffic, for the oncoming near-miss meter in _feel.mjs. `dir === 1` is
  // ONCOMING (see world.js), so the harness can count only the cars that come at
  // you -- which is the pressure the feel meter is about.
  window.__TRAFFIC__ = (world.traffic && world.traffic.userData) ? world.traffic.userData.cars : null;
  // The finish distance, so the harness can end a race honestly rather than by
  // a timeout.
  window.__FINISHS__ = state.finishS;
}

// ---- the map picker ----
// Three maps, previewed by their own surface palettes. Picking one calls
// spine.setMap() and, because the scenery gating reads the spine, the world
// rebuilds for that map. The rebuild is why this can only happen on the title
// screen: it is a load-time decision, not a live one.
function buildMapPicker() {
  const host = document.getElementById('maps');
  if (!host) return;
  host.innerHTML = '';
  // THE FIVE COURSES OF THE CURRENT LEVEL. This was a free map picker over three
// maps; now the CAREER owns which course you ride (level = five courses, in
// order), so this is a schedule display rather than a chooser. It shows the
// five tracks of the level, marks the one you are on, and is honest that the
// course order is the level's, not the player's.
const ev = career.event;
const currentIdx = career.raceIndex % COURSE_COUNT;
COURSES_UI.forEach((c, i) => {
  const m = MAPS[c.map];
  const first = m.sectors[0][0];
  const last = m.sectors[m.sectors.length - 1][0];
  const b0 = BIOMES[first], b1 = BIOMES[last];
  const el = document.createElement('div');
  el.className = 'map' + (i === currentIdx ? ' sel' : '') + (i < currentIdx ? ' done' : '');
  el.innerHTML =
    `<span class="nm">${m.label}</span>` +
    `<span class="sw">` +
      `<i style="background:#${new THREE.Color(b0.roadTint).getHexString()}"></i>` +
      `<i style="background:#${new THREE.Color(b0.vergeTint).getHexString()}"></i>` +
      `<i style="background:#${new THREE.Color(b1.roadTint).getHexString()}"></i>` +
      `<i style="background:#${new THREE.Color(b1.vergeTint).getHexString()}"></i>` +
    `</span>` +
    `<span class="bl">${c.name}</span>`;
  host.appendChild(el);
});
const note = document.getElementById('mapnote');
if (note) {
  // Length is the level's difficulty, and it is visible so the player can see
  // the courses getting longer as they climb.
  note.textContent =
    `Level ${ev.level}/5 · this course runs ${ev.lenMul.toFixed(2)}× standard`;
}
}

// ---------------------------------------------------------------------------
// The career strip and the garage.
//
// Both are rebuilt from the Career object rather than mutated in place, because
// buying a bike changes three things at once (cash, selection, what is now
// affordable) and a partial update is how a menu ends up lying about the state
// the game is actually in.
// ---------------------------------------------------------------------------
function buildCareer() {
  const host = document.getElementById('career');
  if (!host) return;
  const ev = career.event;
  const done = career.complete;
  // The strip shows the LEVEL, because that is the structure now: five levels of
  // five courses. Cash can be negative (the loss condition), so the sign is
  // shown rather than assumed.
  host.innerHTML =
    `<span>level <b>${done ? '5/5' : ev.level + '/5'}</b></span>` +
    `<span>course <b>${ev.name}</b></span>` +
    `<span>race <b>${Math.min(career.raceIndex + 1, SERIES.length)}</b>/${SERIES.length}</span>` +
    `<span>bank <b>$${career.cash}</b></span>` +
    `<span>wins <b>${career.wins}</b></span>`;
}

function buildGarage() {
  const host = document.getElementById('garage');
  if (!host) return;
  host.innerHTML = '';
  const ridingId = career.bike.id;
  for (const b of BIKES) {
    const riding = b.id === ridingId;
    const owned = career.owns(b.id);
    const affordable = riding || owned || career.cash >= b.price;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'map bike' + (riding ? ' sel' : '') + (affordable ? '' : ' locked');
    el.innerHTML =
      `<span class="nm">${b.name}</span>` +
      `<span class="sw">` +
        `<i style="background:#${new THREE.Color(b.colour).getHexString()}"></i>` +
        `<i style="background:#1b1b1e"></i>` +
        `<i style="background:#8a9199"></i>` +
      `</span>` +
      `<span class="bl">${b.blurb}</span>` +
      `<span class="pr">${riding ? 'RIDING' : owned ? 'OWNED' : '$' + b.price}</span>`;
    el.addEventListener('click', () => {
      if (state.running || riding) return;
      const r = career.buy(b.id);
      const note = document.getElementById('garagenote');
      if (note) note.textContent = r.ok ? `now riding the ${r.bike.name}` : r.why;
      refreshTitle();
    });
    host.appendChild(el);
  }
}

function refreshTitle() {
  buildCareer();
  buildGarage();
  buildMapPicker();
}

buildMapPicker();
refreshTitle();

document.getElementById('resetcareer').addEventListener('click', () => {
  if (state.running) return;
  career.reset();
  const note = document.getElementById('garagenote');
  if (note) note.textContent = 'career reset';
  refreshTitle();
});

// ---- BUILD RIDER: the character designer ----
function openShowroom() {
  if (state.running) return;
  if (!showroom) {
    showroom = new Showroom(renderer, scene, camera);
    showroom.useAsset(assets.rider, assets.bike);
    showroom.attach();
    // THE HAND-BACK. `Showroom.close()` calls `this.onClose(spec)` and nothing was
    // ever assigning it, so pressing DONE did nothing: the designer's figure was
    // never rebuilt into the race and the spec was never saved. Wiring it here,
    // where the game owns the career and the assets, keeps the showroom free of
    // any knowledge of either.
    showroom.onClose = closeShowroom;
  }
  // Hand it the body the game is actually using, so the designer opens on the
  // player's real figure rather than a default.
  showroom.spec = playerSpec;
  showroom.open(assets.rider, assets.bike);
  document.getElementById('title').classList.remove('on');
}
async function closeShowroom(spec) {
  playerSpec = spec;
  // SAVE IT. The designed rider belongs to the career, so the next boot builds
  // the same body. Persisted as the four inputs, not the derived dimensions, so
  // the save stays valid if the proportion canon is ever retuned.
  try { career.setRider(spec); } catch (e) { console.warn('[riderash] rider save failed:', e); }
  // REBUILD THE PLAYER FROM THE NEW SPEC. The rig is cloned from the asset, so
  // a change means a fresh clone -- the joints and every derived dimension come
  // from the new body, and nothing from the old one survives.
  try {
    const rebuilt = await ASSET('./assets/rider.js', { spec: playerSpec, ride: RIDING, keepHierarchy: true });
    if (rebuilt && rebuilt.children && rebuilt.children.length) {
      assets.rider = rebuilt;
      if (player) {
        player.setRider(rebuilt);
        // Same environment response the load-time rider got in init().
        const setEnv = scene.userData.setMaterialEnv;
        if (setEnv) player.rider.traverse((n) => {
          if (!n.isMesh || !n.material || !n.material.color) return;
          setEnv(n.material, n.material.color.getHex() === PAL.saddle ? 0.55 : 1.45);
        });
      }
    }
  } catch (e) {
    console.warn('[riderash] rider rebuild failed:', e);
  }
  document.getElementById('title').classList.add('on');
  refreshTitle();
}
document.getElementById('design').addEventListener('click', openShowroom);
window.__SHOWROOM__ = () => (showroom ? { open: showroom.isOpen, spec: showroom.spec } : null);
// the live instance, for the harness: camera frustum, stage rect and whether the
// body actually has geometry. Exposed rather than guessed at.
window.__SHOWROOMI__ = () => showroom;
window.__OPENSHOWROOM__ = openShowroom;

// the menu button and any key start the game
document.getElementById('start').addEventListener('click', () => window.__START__());
document.getElementById('again').addEventListener('click', () => window.__START__());
// KEYBOARD START, GUARDED. Any of Enter / Space / W starts a race from the
// title or results screen, but only when that screen is actually the one on
// top, only on a fresh press (not auto-repeat), and never within a second of
// the finish -- the player crosses the line holding W, and the old listener
// took the key's auto-repeat as "ride again" and skipped the results entirely.
// It also fired behind the character designer and the settings panel.
function canKeyStart() {
  if (state.running || !state.ready) return false;
  if (showroom && showroom.isOpen) return false;
  if (document.getElementById('settingsscreen').classList.contains('on')) return false;
  if (document.getElementById('fatal').classList.contains('on')) return false;
  if (performance.now() - state.endedAt < 1200) return false;
  return document.getElementById('title').classList.contains('on')
      || document.getElementById('over').classList.contains('on');
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyW') && canKeyStart()) {
    e.preventDefault();
    window.__START__();
  }
});

// ---------------------------------------------------------------------------
// PAUSE, SETTINGS, QUALITY.
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function pauseGame(reason = 'user') {
  if (!state.running || state.raceOver || state.paused) return;
  state.paused = true;
  input.down = Object.create(null);          // no key is "still held" on resume
  if (touchpad) touchpad.reset();            // nor any on-screen button
  audio.setPaused(true);
  $('pause').classList.add('on');
  refreshPauseItems();
  hud.show(false);
  if (reason === 'user') $('p-resume').focus({ preventScroll: true });
}
function resumeGame() {
  if (!state.paused || glLost) return;       // nothing to draw with until restored
  glNote('');
  tilt.calibrate();                          // the phone has moved while paused
  state.paused = false;
  $('pause').classList.remove('on');
  $('settingsscreen').classList.remove('on');
  try { document.activeElement?.blur?.(); } catch (e) { /* not fatal */ }
  hud.show(true);
  audio.setPaused(false);
  last = performance.now();                  // no giant dt on the first frame back
}
function quitToTitle() {
  phone.end();
  state.paused = false;
  state.running = false;
  state.raceOver = false;
  audio.setPaused(false);
  audio.idle();
  audio.playMusic('menu');
  if (rain) rain.reset();
  $('pause').classList.remove('on');
  $('settingsscreen').classList.remove('on');
  hud.show(false);
  $('title').classList.add('on');
  refreshTitle();
}
$('p-resume').addEventListener('click', resumeGame);
// Touch has no Escape key; the HUD carries a pause button. Stop the pointer
// event reaching the canvas, where a tap would also register as an attack.
$('pausebtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); });
$('pausebtn').addEventListener('click', (e) => { e.stopPropagation(); pauseGame('user'); });
$('p-restart').addEventListener('click', () => { audio.setPaused(false); window.__START__(); });
$('p-quit').addEventListener('click', quitToTitle);

// Tab hidden, window blurred or GPU context lost mid-race: pause, never keep
// simulating a race nobody can see.
// Automation is exempt: a headless page can report blur while the harness is
// driving it, and a gate that silently paused would measure a parked bike.
if (!navigator.webdriver) {
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame('hidden'); });
  addEventListener('blur', () => pauseGame('blur'));
}

addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && e.code !== 'KeyP') return;
  if ($('settingsscreen').classList.contains('on')) { closeSettings(); return; }
  if (state.paused) resumeGame();
  else pauseGame('user');
});

// ---- settings panel -------------------------------------------------------
let settingsFrom = null;          // 'title' | 'pause'
function openSettings(from) {
  settingsFrom = from;
  const sel = $('set-camera');
  if (!sel.options.length) {
    CAM_MODES.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = `${i + 1} · ${m.name}`;
      sel.appendChild(o);
    });
  }
  for (const k of ['master', 'sfx', 'music']) {
    $('set-' + k).value = String(settings[k]);
    $('o-' + k).textContent = Math.round(settings[k] * 100);
  }
  $('set-quality').value = settings.quality;
  sel.value = String(settings.camMode);
  $('set-fps').checked = settings.showFps;
  $('set-touch').value = settings.touch;
  $('set-tilt').checked = tilt.active;
  $(from === 'pause' ? 'pause' : 'title').classList.remove('on');
  $('settingsscreen').classList.add('on');
  $('set-done').focus({ preventScroll: true });
}
function closeSettings() {
  $('settingsscreen').classList.remove('on');
  $(settingsFrom === 'pause' ? 'pause' : 'title').classList.add('on');
  saveSettings(settings);
}
for (const k of ['master', 'sfx', 'music']) {
  $('set-' + k).addEventListener('input', (e) => {
    settings[k] = Number(e.target.value);
    $('o-' + k).textContent = Math.round(settings[k] * 100);
    audio.setVolumes(settings);
  });
}
$('set-quality').addEventListener('change', (e) => {
  settings.quality = e.target.value;
  applyQuality(settings.quality === 'auto' ? autoTier() : settings.quality);
});
$('set-camera').addEventListener('change', (e) => {
  settings.camMode = Number(e.target.value);
  state.camMode = settings.camMode;
  camInitialised = false;
});
$('set-fps').addEventListener('change', (e) => { settings.showFps = e.target.checked; });
$('set-touch').addEventListener('change', (e) => {
  settings.touch = e.target.value;
  saveSettings(settings);
  applyTouchVisibility();
});
// The checkbox tap IS the user gesture iOS demands for the motion permission,
// so the request happens here, not at race start.
$('set-tilt').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const ok = await tilt.enable();
    if (!ok) {
      e.target.checked = false;
      const n = $('tiltnote');
      if (n) n.textContent = 'Tilt needs motion access: allow it when asked (and HTTPS on iPhone).';
    }
    settings.tilt = ok;
  } else {
    tilt.disable();
    settings.tilt = false;
  }
  saveSettings(settings);
  applyTouchVisibility();
});
$('set-done').addEventListener('click', closeSettings);
$('p-settings').addEventListener('click', () => openSettings('pause'));
$('opensettings').addEventListener('click', () => { if (!state.running) openSettings('title'); });
audio.setVolumes(settings);

// ---- quality tiers ----------------------------------------------------------
// Three tiers over the three costs that actually scale with the machine: pixel
// count, the shadow map, and the full-screen post chain. `auto` starts high and
// steps DOWN (never up, so it cannot oscillate) when a race holds under 50 fps
// for four seconds. Disabled under automation, where frame rate is not a
// property of the game and the gate's numbers must stay comparable.
// `px` is a PIXEL BUDGET on top of the ratio cap: a 12.9" iPad at ratio 2 is
// 5.6 M pixels, which no mobile GPU fills at 60 through the post chain. The
// ratio falls until width*height*ratio^2 fits (RallyRoadRash does the same).
const TIERS = {
  high:   { pr: 2.0,  px: 3.7e6, shadow: 2048, post: true,  shadows: true },
  medium: { pr: 1.25, px: 2.1e6, shadow: 1024, post: true,  shadows: true },
  low:    { pr: 1.0,  px: 1.2e6, shadow: 1024, post: false, shadows: false },
};
const TIER_ORDER = ['high', 'medium', 'low'];
let tier = 'high', lowFpsTicks = 0;
// [perf job] The starting tier for `auto`, from what the device IS rather than
// waiting for it to struggle: a SOFTWARE rasteriser (SwiftShader, llvmpipe,
// WARP/"Basic Render" -- what a blocklisted GPU or a VM falls back to) renders
// the high-tier frame at ~1 fps, measured; low-memory / few-core touch devices
// are the phones that cannot hold medium. Everything else desktop starts high.
function autoTier() {
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch (e) { /* unknown: judge by the device below */ }
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) return 'low';
  if (isTouchDevice()) {
    const weak = (navigator.deviceMemory && navigator.deviceMemory <= 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    return weak ? 'low' : 'medium';
  }
  return 'high';
}
function applyQuality(name) {
  const t = TIERS[name] || TIERS.high;
  tier = name in TIERS ? name : 'high';
  // Scenery: draw distance, full-detail distance and density per tier (see
  // scenery.js SCENERY_TIERS). Mid-race only the distances change.
  try { if (scenery) scenery.setQuality(tier, !state.running); } catch (e) { /* non-fatal */ }
  const pr = Math.max(0.5, Math.min(devicePixelRatio || 1, t.pr,
    Math.sqrt(t.px / Math.max(1, innerWidth * innerHeight))));
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  if (postfx) {
    postfx.enabled = t.post;
    postfx.setPixelRatio?.(pr);
    postfx.setSize(innerWidth, innerHeight);
  }
  if (lights && lights.sun) {
    const sh = lights.sun.shadow;
    lights.sun.castShadow = t.shadows;
    if (sh.mapSize.x !== t.shadow) {
      sh.mapSize.set(t.shadow, t.shadow);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
  }
}
function autoQuality(currentFps) {
  if (settings.quality !== 'auto' || navigator.webdriver) return;
  if (!state.running || state.paused || state.countdown > 0 || document.hidden) { lowFpsTicks = 0; return; }
  // Under 50 fps for 4 s steps down; under 25 fps (a 40 ms frame) counts
  // double, so a genuinely struggling device steps down within 2 s.
  lowFpsTicks = currentFps < 25 ? lowFpsTicks + 2 : currentFps < 50 ? lowFpsTicks + 1 : Math.max(0, lowFpsTicks - 1);
  if (lowFpsTicks >= 8) {
    const i = TIER_ORDER.indexOf(tier);
    if (i < TIER_ORDER.length - 1) {
      applyQuality(TIER_ORDER[i + 1]);
      console.log('[riderash] auto quality ->', tier);
    }
    lowFpsTicks = 0;
  }
}

// ---- HUD: the rider you are fighting ---------------------------------------
// Road Rash always showed the nearest opponent's stamina next to yours, so the
// player could see a fight turning. The nearest rival within brawling range,
// with their name and health.
function hudTarget() {
  if (!player) return null;
  let best = null, bd = 14;
  for (const r of rivals) {
    if (!r.phys) continue;
    const d = Math.hypot(r.phys.s - player.phys.s, r.phys.lateral - player.phys.lateral);
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return null;
  const f = best.fighter;
  return { name: best.name, frac: f.down ? 0 : Math.max(0, f.hp / (f.maxHp || 1)), down: f.down };
}

// publish at a steady rate independent of frame rate, for the harness
setInterval(publishState, 50);

// Chromium suspends an AudioContext created without a gesture. Arm the first
// real interaction as a fallback, so a player who starts by pressing a key
// rather than clicking also gets sound.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  addEventListener(ev, () => {
    audio.init().catch(() => {});
    if (!state.running) audio.playMusic('menu');
    audioExt.init().catch(() => {});   // ADDITIVE: extra beds/beeps
  }, { once: true });
}

try {
  await init();
} catch (e) {
  console.error('[riderash] init failed:', e);
  window.__FATAL__?.('The game could not finish loading.', String(e && (e.stack || e.message) || e));
  throw e;
}
requestAnimationFrame(frame);