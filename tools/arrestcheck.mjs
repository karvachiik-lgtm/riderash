#!/usr/bin/env node
// RideRash — the ARREST harness: every bust scene, under every condition,
// measured frame by frame on the real rigs.
//
// WHY. The arrest (src/arrest.js) is a scripted scene played on rigs that were
// built to ride: the cop steps off, walks, kneels, writes, wags a finger; the
// suspect is made to kneel or lie down. Nothing in the fuzz looks at a pose,
// so a cop who walked over UPSIDE DOWN (the gait's `+=` pelvis sway, never
// reset because no ragdoll had captured his rest pose -- MEASURED here: pelvis
// roll climbing 0.05 rad a frame to 2.8 rad) passed every other check.
//
// WHAT IT DOES. For each case it plays a real race, puts the player (or a
// rival) somewhere on the course in some state, forces the bust, and steps the
// game one frame at a time, measuring from the rigs' world transforms:
//
//   upright     torso up-vector and head over pelvis, per phase (a crouch
//               over the cuffs may lean; walking may not)
//   joints      no joint drifts: the pelvis stays near its rest orientation
//               (the accumulation bug), torso and neck stay inside a human range
//   ground      nothing below the road (raycast onto the real road mesh, so a
//               banked or sloped road counts); standing feet ON it, not floating
//   continuity  no teleports (pelvis step per frame), no pops (torso turn per
//               frame), no size change (world scale), across the step-off and
//               every re-parent
//   contact     during the cuffs / ticket / lecture he is at arm's length from
//               the suspect's BODY and faces it; cuffing hands are on the body
//   suspect     knees: upright on the knees, hands up; ground: flat, face down,
//               on the road. A thrown suspect stays on the road.
//   bike        the parked police bike stands on its wheels
//   script      the phases run in the variant's order, none times out (a walk
//               that hits WALK_MAX snaps him to the target: a teleport)
//   teardown    after the scene everyone is back on their bikes at their own
//               scale, and the NEXT race starts with clean riding poses
//
// CONDITIONS. Every variant (cuff, ticket, lecture, knees, ground) is played
// at every kind of place on the course (straight, left and right bends, up and
// down hill), and each case also turns one of: which side the cop comes from,
// where across the road the suspect is (centre, near either edge), what state
// they are in (seated and collared, thrown and still falling, thrown and
// lying), and the frame rate (30 / 60 / 144 Hz). Rival arrests, a skipped
// scene, and three busts in a row (leaks) run as well. --full plays the whole
// cross product instead of the covering set.
//
// OUTPUT. A pass/fail line per case with the worst values, a filmstrip per
// case (side-on shot at each phase) and one contact sheet:
//   tools/out/arrest/index.html   tools/out/arrest/sheet.png
//
// Usage (from this folder, after `npm install`):
//   node arrestcheck.mjs                 # the covering set (~40 cases)
//   node arrestcheck.mjs --quick         # one case per variant
//   node arrestcheck.mjs --full          # the full cross product (slow)
//   node arrestcheck.mjs --only cuff     # cases whose name contains "cuff"
//   node arrestcheck.mjs --no-shots      # measurements only
//   CHROME_PATH=/path/to/chrome node arrestcheck.mjs
//
// Exit code 0 when every case held, 1 otherwise.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const THREE_DIR = path.join(HERE, 'node_modules', 'three');
const OUT = path.join(HERE, 'out', 'arrest');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const SHOTS = !flag('no-shots');
const ONLY = arg('only', '');
const TRACE = flag('trace');           // print the walker / target every 15 frames

// ---- the cases -------------------------------------------------------------------
const VARIANTS = ['cuff', 'ticket', 'lecture', 'knees', 'ground'];
const PLACES = ['straight', 'bendL', 'bendR', 'uphill', 'downhill'];
const SIDES = [1, -1];                      // cop comes up on the suspect's right / left
const LATS = ['centre', 'edgeL', 'edgeR'];  // where across the road the suspect is
const STATES = ['seated', 'falling', 'lying'];
const RATES = [60, 30, 144];
// knees / ground are for a rider still on the bike; thrown, they fall back to cuff
const statesFor = (v) => (v === 'knees' || v === 'ground' ? ['seated'] : STATES);

function buildCases() {
  const cases = [];
  const add = (c) => { c.name = c.name || `${c.who === 'rival' ? 'rival-' : ''}${c.variant}-${c.state}-${c.place}-${c.lat}-${c.side > 0 ? 'R' : 'L'}${c.hz !== 60 ? '-' + c.hz + 'hz' : ''}${c.skip ? '-skip' : ''}`; cases.push(c); };
  if (flag('full')) {
    for (const variant of VARIANTS) for (const state of statesFor(variant)) for (const place of PLACES)
      for (const lat of LATS) for (const side of SIDES) add({ who: 'player', variant, state, place, lat, side, hz: 60 });
  } else if (flag('quick')) {
    VARIANTS.forEach((variant, i) => add({ who: 'player', variant, state: statesFor(variant)[i % statesFor(variant).length], place: PLACES[i], lat: LATS[i % 3], side: SIDES[i % 2], hz: 60 }));
  } else {
    // THE COVERING SET: every variant at every place, and the other axes turned
    // through with co-prime strides so each value meets each variant
    let k = 0;
    for (const variant of VARIANTS) for (const place of PLACES) {
      const st = statesFor(variant);
      add({ who: 'player', variant, place, state: st[k % st.length], lat: LATS[(k * 2) % 3], side: SIDES[k % 2], hz: RATES[Math.floor(k / 2) % 3] });
      k++;
    }
    // the other side of the road for every variant, seated (the common collar)
    VARIANTS.forEach((variant, i) => add({ who: 'player', variant, state: 'seated', place: PLACES[(i + 2) % 5], lat: LATS[(i + 1) % 3], side: -SIDES[i % 2], hz: 60 }));
    // rivals: the cop arrests a rider he finds down while you ride on
    ['cuff', 'ticket', 'lecture'].forEach((variant, i) => add({ who: 'rival', variant, state: 'lying', place: PLACES[i * 2], lat: LATS[i], side: SIDES[i % 2], hz: 60 }));
    // skipped by a key press a second in
    add({ who: 'player', variant: 'lecture', state: 'seated', place: 'straight', lat: 'centre', side: 1, hz: 60, skip: true });
  }
  // three busts in a row, then a clean race: nothing may leak between them
  if (!flag('quick')) add({ name: 'repeat-x3', who: 'player', variant: 'knees', state: 'seated', place: 'bendL', lat: 'centre', side: 1, hz: 60, repeat: 3 });
  return cases.filter((c) => !ONLY || c.name.includes(ONLY)).map((c) => ({ ...c, trace: TRACE }));
}

// ---- a tiny static server for the repo (as fuzz.mjs) ----------------------------------
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function openGame() {
  const ctx = await browser.newContext({ viewport: { width: 560, height: 350 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('riderash.settings.v1', JSON.stringify({ quality: 'low', master: 0 }));
    localStorage.setItem('riderash.career.v1', JSON.stringify({ race: 3, cash: 50000 }));
    window.__NO_INTRO__ = true;
    window.__KEEP_BUFFERS__ = true;      // the road's geometry stays raycastable
  });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console.error: ' + m.text().slice(0, 240)); });
  if (fs.existsSync(THREE_DIR)) {
    await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.169\.0\/(.*)/, (route) => {
      const m = route.request().url().match(/three@0\.169\.0\/(.*)$/);
      route.fulfill({ path: path.join(THREE_DIR, m[1]), contentType: 'application/javascript' });
    });
  }
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 180000 });
  // the filmstrip is of the 3D scene: no HUD, and not the cutscene's dip to black
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  await page.evaluate(INPAGE);
  return page;
}

// ---- the in-page instrument ----------------------------------------------------------
// Installed once as window.__AC__. Everything is measured in world space from
// the rigs' own nodes; `spec` (the rig's body dimensions) places the soles and
// the hands.
const INPAGE = () => {
  const W = window, T = W.__THREE__, S = W.__STATE__;
  const V = () => new T.Vector3(), Q = () => new T.Quaternion();
  const LIM = {
    // CROUCH: kneeling or bent over the cuffs he may lean in, not fold over
    // (a sprawled suspect's arm is hauled up to him: see arrest._haulArm)
    UP_STAND: 0.75, UP_CROUCH: 0.45, HEAD_STAND: 0.35, HEAD_CROUCH: 0.2, TORSO_CROUCH: 1.25,
    PELVIS_DRIFT: 0.4, TORSO_LOCAL: 1.25, NECK_LOCAL: 1.25,
    SINK: 0.05, FLOAT: 0.07, KNEEL_GAP: 0.12,
    STEP: 0.14, TURN: 0.45, SCALE: 0.01,
    REACH_MIN: 0.3, REACH_MAX: 1.2, FACE: 0.45, HANDS: 0.15,
    BIKE_ROLL: 0.25, BIKE_GAP: 0.09, TOTAL: 22,
  };
  const ORDER = {
    cuff: ['stop', 'off', 'walk', 'cuff', 'hold'], knees: ['stop', 'off', 'walk', 'cuff', 'hold'], ground: ['stop', 'off', 'walk', 'cuff', 'hold'],
    ticket: ['stop', 'off', 'walk', 'write', 'hand', 'hold'], lecture: ['stop', 'off', 'walk', 'wag', 'write', 'hand', 'hold'],
  };
  const ST = { STAND: new Set(['walk', 'write', 'wag', 'hand']), TALK: new Set(['cuff', 'write', 'wag', 'hand']) };

  // THE ROAD, measured: a downward ray onto the road meshes (so camber, slope and
  // the verge count), cached on a 0.2 m grid for the case
  let ground = [], gcache = new Map();
  const ray = new T.Raycaster();
  const GROUND = new Set(['deck', 'worn', 'shoulder', 'foliage', 'patch', 'marking', 'crack', 'ground']);
  function collectGround() {
    ground = []; gcache = new Map();
    W.__SCENE__.traverse((n) => { if (n.isMesh && !n.isInstancedMesh && n.visible && n.material && GROUND.has(n.material.name) && n.geometry.attributes.position && n.geometry.attributes.position.array && (!n.geometry.index || n.geometry.index.array)) ground.push(n); });
  }
  function groundY(p) {
    const k = Math.round(p.x * 5) + ',' + Math.round(p.z * 5);
    if (gcache.has(k)) return gcache.get(k);
    ray.set(new T.Vector3(p.x, p.y + 4, p.z), new T.Vector3(0, -1, 0)); ray.far = 12;
    // mesh by mesh: a chunk whose CPU arrays were dropped after upload (scenery
    // streams its own) cannot be hit, and leaves the list
    let y = NaN;
    for (let i = ground.length - 1; i >= 0; i--) {
      let hits;
      try { hits = ray.intersectObject(ground[i], false); } catch (e) { ground.splice(i, 1); continue; }
      if (hits.length && !(hits[0].point.y <= y)) y = hits[0].point.y;
    }
    C && (C.gSamples = (C.gSamples || 0) + 1, Number.isFinite(y) || (C.gMiss = (C.gMiss || 0) + 1));
    gcache.set(k, y);
    return y;
  }

  // one rig, in world space
  function body(rider) {
    const j = rider.userData.joints, sp = rider.userData.spec || { shin: 0.45, foot: 0.26, forearm: 0.27, hand: 0.09 };
    rider.updateWorldMatrix(true, true);
    const at = (n, x = 0, y = 0, z = 0) => n.localToWorld(V().set(x, y, z));
    const sole = -sp.shin - sp.foot * 0.695;
    const b = {
      head: at(j.head), neck: at(j.neck), pelvis: at(j.pelvis), torso: at(j.torso),
      handL: at(j.leftArm.fore, 0, -sp.forearm - sp.hand * 0.5), handR: at(j.rightArm.fore, 0, -sp.forearm - sp.hand * 0.5),
      footL: at(j.leftLeg.shin, 0, sole, sp.foot * 0.2), footR: at(j.rightLeg.shin, 0, sole, sp.foot * 0.2),
      toes: [j.leftLeg, j.rightLeg].flatMap((L) => [at(L.shin, 0, sole, sp.foot * 0.62), at(L.shin, 0, sole, -sp.foot * 0.25)]),
      kneeL: at(j.leftLeg.knee), kneeR: at(j.rightLeg.knee),
      up: V().set(0, 1, 0).applyQuaternion(j.torso.getWorldQuaternion(Q())),
      fwd: V().set(0, 0, 1).applyQuaternion(j.pelvis.getWorldQuaternion(Q())),
      torsoQ: j.torso.getWorldQuaternion(Q()),
      scale: rider.getWorldScale(V()).x,
      pelvisLocal: j.pelvis.quaternion.clone(), torsoLocal: j.torso.quaternion.clone(), neckLocal: j.neck.quaternion.clone(),
    };
    b.points = [b.head, b.neck, b.pelvis, b.handL, b.handR, b.footL, b.footR, b.kneeL, b.kneeR];
    return b;
  }
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const ang = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  const angBetween = (a, b) => ang(a.clone().invert().multiply(b));

  let C = null;   // the case in progress

  function fail(check, detail) {
    const k = C.fails[check];
    if (!k) C.fails[check] = { n: 1, first: { f: C.f, t: +C.t.toFixed(2), ph: C.phase, detail } };
    else k.n++;
  }
  function worst(key, v, hi = true) { const w = C.worst; if (!(key in w) || (hi ? v > w[key] : v < w[key])) w[key] = +v.toFixed(3); }

  // THE SUSPECT: whose body, and where it is
  function suspectRig() {
    const tg = C.target;
    const d = tg.dismount;
    return d && d.player && d.player.rider;
  }

  function setup(c) {
    const cop = W.__COP__, p = W.__PLAYERPHYS__, pf = W.__PLAYER_FIGHTER__;
    W.__BUST_VARIANT__ = c.variant;
    // THE CLOCK IS OURS: the game's own rAF loop otherwise keeps stepping in real
    // time while a screenshot is taken, and the scene jumped 0.35 m (measured)
    W.__HOLD__ = true;
    W.__START__();
    for (let i = 0; i < 40 && S.countdown > 0; i++) W.__SIM__(0.25);
    W.__SIM__(0.5);
    collectGround();

    // THE PLACE: scan the course with a scratch integrator for the straightest
    // bit, the tightest bends each way and the steepest climb and descent
    if (!W.__AC_PLACES__) {
      const ph = cop.phys, fin = S.finishS || 3000, rows = [];
      for (let s = 260; s < fin - 260; s += 12) {
        ph.reset({ s, lateral: 0, speed: 0 }); ph.sync();
        const y0 = ph.yaw, pit = ph.roadPitch || 0;
        ph.reset({ s: s + 12, lateral: 0, speed: 0 }); ph.sync();
        let dy = ph.yaw - y0; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        rows.push({ s, curv: dy / 12, pit });
      }
      const pick = (f) => rows.reduce((a, b) => (f(b) > f(a) ? b : a)).s;
      W.__AC_PLACES__ = {
        straight: pick((r) => -Math.abs(r.curv) * 50 - Math.abs(r.pit)),
        bendL: pick((r) => r.curv), bendR: pick((r) => -r.curv),
        uphill: pick((r) => -r.pit), downhill: pick((r) => r.pit),
      };
      cop._leave();
    }
    const s = W.__AC_PLACES__[c.place];
    const half = W.__CFG__.ROAD_W / 2 - 0.9;
    const lat = c.lat === 'centre' ? 0 : c.lat === 'edgeL' ? -half : half;

    // the cop: chasing, alongside-ish, on the chosen side
    const placeCop = (ts, tl, v) => {
      cop.enabled = true;
      cop.state = 'parked'; cop.group.visible = true; cop._startChase();
      cop.phys.reset({ s: ts - 18, lateral: Math.max(-half, Math.min(half, tl + c.side * 1.6)), speed: v }); cop.phys.sync();
    };

    let target;
    if (c.who === 'rival') {
      const r = W.__RIVALS__[0];
      p.s = s + 120; p.lateral = 0; p.speed = 20; p.sync();       // away (> 45 m), not lost (< LOSE_DIST)
      r.phys.reset({ s, lateral: lat, speed: 22 }); r.phys.sync();
      // one ordinary frame at the new spot first: knocked down on the frame of
      // the move, the crash was thrown from the old one (measured: s 1184 -> 10)
      W.__SIM__(1 / 60);
      r.fighter.hp = 0; r.fighter.down = true; r.fighter.downTimer = 3;
      W.__SIM__(1 / 60);
      for (let i = 0; i < 40 && r.dismount && r.dismount.state === 'FALLING'; i++) W.__SIM__(0.1);
      // the arrest starts on the frame he is placed (his own rival check would
      // otherwise take the rider first, with a random scene)
      placeCop(r.phys.s, r.phys.lateral, 6);
      if (!W.__ENDINGS__.arrestRival(0, c.variant)) return { error: 'arrestRival refused' };
      target = { phys: r.phys, fighter: r.fighter, dismount: r.dismount };
      C = { c, arrest: S.copArrest, key: 'copArrest', target };
    } else {
      p.s = s; p.lateral = lat; p.speed = c.state === 'seated' ? 14 : 24; p.lateralV = 0; p.sync();
      W.__SIM__(1 / 60);
      if (c.state === 'seated') {
        placeCop(p.s, p.lateral, p.speed);
        W.__SIM__(1 / 60);
        W.__ENDINGS__.bust();
      } else {
        // a crash: on the frame (falling) the cop's own bust check fires; lying,
        // he arrives once the body has come to rest
        if (c.state === 'lying') { cop.enabled = false; cop._leave(); }
        else placeCop(p.s, p.lateral, p.speed);
        pf.hp = 0; pf.down = true; pf.downTimer = 3;
        for (let i = 0; i < 30 && !S.arrest; i++) W.__SIM__(1 / 60);
        if (c.state === 'lying') {
          for (let i = 0; i < 40 && W.__DISMOUNT__ && W.__DISMOUNT__.state === 'FALLING'; i++) W.__SIM__(0.1);
          placeCop(p.s, p.lateral, 6);
          W.__SIM__(1 / 60);
          if (!S.arrest) W.__ENDINGS__.bust();
        }
      }
      if (!S.arrest) return { error: 'no arrest started' };
      target = { phys: p, fighter: pf, dismount: W.__DISMOUNT__ };
      C = { c, arrest: S.arrest, key: 'arrest', target };
    }
    const A = C.arrest;
    Object.assign(C, {
      f: 0, t: 0, phase: A.phase, phases: [A.phase], phaseT: {}, fails: {}, worst: {}, shotAt: 0, shots: [],
      variant: A.variant, dt: 1 / c.hz,
      copScale0: cop.rider.getWorldScale(V()).x, copRest: cop.rider.userData.joints.pelvis.quaternion.clone(),
      suspectScale0: suspectRig() ? suspectRig().getWorldScale(V()).x : 0,
      prev: null, prevS: null,
    });
    return { ok: true, variant: A.variant, s, lat, places: W.__AC_PLACES__ };
  }

  // the per-frame measurement
  function measure() {
    const A = C.arrest, cop = W.__COP__, ph = A.phase;
    const on = A._detached;                           // he is off the bike
    const b = body(cop.rider);
    const nums = [...b.points.flatMap((p) => [p.x, p.y, p.z]), b.up.y, b.scale];
    if (!nums.every(Number.isFinite)) { fail('finite', 'non-finite cop joint'); return; }

    // scale: the cop is the same size on the bike, off it, and back on it
    const ds = Math.abs(b.scale / C.copScale0 - 1); worst('scaleErr', ds);
    if (ds > LIM.SCALE) fail('scale', `cop world scale ${b.scale.toFixed(3)} vs ${C.copScale0.toFixed(3)}`);

    // joints: the accumulation bug and anything like it
    const pd = angBetween(C.copRest, b.pelvisLocal); worst('pelvisDrift', pd);
    if (pd > LIM.PELVIS_DRIFT) fail('pelvisDrift', `pelvis ${pd.toFixed(2)} rad off rest`);
    const tl = ang(b.torsoLocal), nl = ang(b.neckLocal);
    if (tl > (C.phase === 'cuff' || C.phase === 'hold' ? LIM.TORSO_CROUCH : LIM.TORSO_LOCAL)) fail('torsoRange', `torso local ${tl.toFixed(2)} rad`);
    if (nl > LIM.NECK_LOCAL) fail('neckRange', `neck local ${nl.toFixed(2)} rad`);

    if (on) {
      // upright
      const crouch = ph === 'cuff' || (ph === 'hold' && (C.variant === 'cuff' || C.variant === 'knees' || C.variant === 'ground'));
      worst('upMin', b.up.y, false);
      const hp = b.head.y - b.pelvis.y; worst('headOverPelvis', hp, false);
      if (b.up.y < (crouch ? LIM.UP_CROUCH : LIM.UP_STAND)) fail('upright', `torso up.y ${b.up.y.toFixed(2)}`);
      if (hp < (crouch ? LIM.HEAD_CROUCH : LIM.HEAD_STAND)) fail('headOverPelvis', `head ${hp.toFixed(2)} m over pelvis`);
      // ground: nothing under the road; standing feet on it
      let sink = 0;
      for (const p of b.points) { const g = groundY(p); if (Number.isFinite(g)) sink = Math.max(sink, g - p.y); }
      worst('sink', sink);
      if (sink > LIM.SINK) fail('belowRoad', `${sink.toFixed(3)} m under the road`);
      if (ph !== 'off') {
        // (a knee JOINT rides ~4 cm above its kneecap: that is what touches)
        const low = Math.min(...[[b.footL, 0], [b.footR, 0], [b.kneeL, 0.04], [b.kneeR, 0.04], ...b.toes.map((p) => [p, 0])].map(([p, r]) => p.y - r - groundY(p)).filter(Number.isFinite));
        worst('footGap', low);
        if (low > LIM.FLOAT) fail('floating', `lowest foot/knee ${low.toFixed(3)} m above the road`);
      }
      // continuity
      if (C.prev) {
        const step = b.pelvis.distanceTo(C.prev.pelvis), lim = Math.max(LIM.STEP, 6 * C.dt);
        worst('step', step);
        if (step > lim) fail('teleport', `pelvis moved ${step.toFixed(2)} m in one frame (root ${cop.rider.position.distanceTo(C.prevRoot || cop.rider.position).toFixed(2)}, A.t ${A.t.toFixed(2)}, dismount ${cop.dismount && cop.dismount.state})`);
        const turn = angBetween(C.prev.torsoQ, b.torsoQ); worst('turn', turn);
        if (turn > LIM.TURN * Math.max(1, C.dt * 60)) fail('pop', `torso turned ${turn.toFixed(2)} rad in one frame`);
      }
      // the parked bike stands
      cop.bike.updateWorldMatrix(true, true);
      const bq = cop.bike.getWorldQuaternion(Q());
      const bup = V().set(0, 1, 0).applyQuaternion(bq);
      if (Math.acos(Math.min(1, bup.y)) > LIM.BIKE_ROLL) fail('bikeFallen', `bike tilted ${Math.acos(bup.y).toFixed(2)} rad`);
      const bb = new T.Box3().setFromObject(cop.bike, true), bc = bb.getCenter(V());
      const bg = groundY(bc);
      if (Number.isFinite(bg) && Math.abs(bb.min.y - bg) > LIM.BIKE_GAP) fail('bikeGround', `bike ${(bb.min.y - bg).toFixed(2)} m off the road`);
    }

    // CONTACT: with the suspect's body during the scene's business
    const sr = suspectRig();
    let sb = null;
    if (sr) {
      sb = body(sr);
      const pts = [sb.pelvis, sb.torso, sb.handL, sb.handR, sb.head];
      const sjw = sr.userData.joints, spw = sr.userData.spec || { forearm: 0.27 };
      const wrists = [sjw.leftArm, sjw.rightArm].map((A) => A.fore.localToWorld(V().set(0, -spw.forearm, 0)));
      if (ST.TALK.has(ph) && A.t > 0.5) {
        // cuffing, he is AT the wrists by design: inside-the-body means the trunk
        const cuffing = ph === 'cuff';
        const reach = Math.min(...(cuffing ? [sb.pelvis, sb.torso, sb.head] : pts).map((p) => flat(p, b.pelvis)));
        worst('reachMin', reach, false); worst('reachMax', reach);
        if (reach < LIM.REACH_MIN) fail('tooClose', `cop ${reach.toFixed(2)} m from the body (inside it)`);
        if (reach > LIM.REACH_MAX) fail('tooFar', `cop ${reach.toFixed(2)} m from the body`);
        const aim = cuffing ? V().addVectors(wrists[0], wrists[1]).multiplyScalar(0.5) : sb.pelvis;
        const to = V().subVectors(aim, b.pelvis); to.y = 0; to.normalize();
        const fw = b.fwd.clone(); fw.y = 0; fw.normalize();
        const face = Math.acos(Math.max(-1, Math.min(1, fw.dot(to)))); worst('faceErr', face);
        if (face > LIM.FACE) fail('facing', `facing ${(face * 57.3).toFixed(0)} deg off the suspect`);
      }
      if (ph === 'cuff' && A.t > 0.6) {
        const sp = sr.userData.spec || { forearm: 0.27 }, sj = sr.userData.joints;
        const wr = [sj.leftArm, sj.rightArm].map((A) => A.fore.localToWorld(V().set(0, -sp.forearm, 0)));
        const hd = Math.max(...[b.handL, b.handR].map((h) => Math.min(...wr.map((p) => p.distanceTo(h)))));
        worst('cuffHands', hd);
        if (hd > LIM.HANDS) fail('cuffHands', `cuffing hand ${hd.toFixed(2)} m from the suspect's wrists`);
      }
      // the suspect's own body
      if (Number.isFinite(sb.scale) && C.suspectScale0) {
        const e = Math.abs(sb.scale / C.suspectScale0 - 1);
        if (e > LIM.SCALE) fail('suspectScale', `suspect world scale ${sb.scale.toFixed(3)} vs ${C.suspectScale0.toFixed(3)}`);
      }
      const onFoot = C.target.dismount && C.target.dismount.onFoot;
      if (A.suspect || onFoot) {
        let sink = 0;
        for (const p of sb.points) { const g = groundY(p); if (Number.isFinite(g)) sink = Math.max(sink, g - p.y); }
        worst('suspectSink', sink);
        if (sink > LIM.SINK + 0.03) fail('suspectBelowRoad', `${sink.toFixed(3)} m under the road`);
      }
      if (A.suspect && A.suspect.t > 2.2) {
        if (C.variant === 'knees') {
          if (sb.up.y < 0.6) fail('suspectKneel', `kneeling suspect torso up.y ${sb.up.y.toFixed(2)}`);
          const kg = Math.min(sb.kneeL.y - groundY(sb.kneeL), sb.kneeR.y - groundY(sb.kneeR));
          worst('suspectKneeGap', kg);
          if (kg > LIM.KNEEL_GAP) fail('suspectKneesUp', `knees ${kg.toFixed(2)} m off the road`);
          if (Math.min(sb.handL.y, sb.handR.y) < sb.neck.y - 0.08) fail('suspectHands', 'hands not up behind the head');
        }
        if (C.variant === 'ground' && A.suspect.t > 3.0) {
          if (Math.abs(sb.up.y) > 0.4) fail('suspectProne', `prone suspect torso up.y ${sb.up.y.toFixed(2)}`);
          const pg = sb.pelvis.y - groundY(sb.pelvis);
          worst('suspectPelvisGap', pg);
          if (pg > 0.35) fail('suspectFloating', `prone pelvis ${pg.toFixed(2)} m off the road`);
          const chest = V().set(0, 0, 1).applyQuaternion(sr.userData.joints.torso.getWorldQuaternion(Q()));
          if (chest.y > -0.5) fail('suspectFaceDown', `chest faces ${chest.y.toFixed(2)} (want down)`);
        }
      }
      // (a suspect still riding or still falling moves fast for real; once
      // detached for the scene or lying on the road they may not jump)
      const falling = C.target.dismount && C.target.dismount.state === 'FALLING';
      if (C.prevS && ((A.suspect && A.suspect.pos) || (onFoot && !falling))) {
        const st = sb.pelvis.distanceTo(C.prevS.pelvis);
        if (st > Math.max(0.2, 8 * C.dt)) fail('suspectTeleport', `suspect pelvis moved ${st.toFixed(2)} m in one frame`);
      }
    }
    C.prev = b; C.prevS = sb; C.prevRoot = cop.rider.position.clone();
  }

  // step until done, a shot is due, or the frame budget runs out
  function run(maxFrames, shotEvery) {
    const A = C.arrest;
    for (let i = 0; i < maxFrames; i++) {
      if (A.done || !S[C.key]) return { done: true };
      if (C.c.skip && A.total > 1.2 && !C.skipped) { C.skipped = true; A.finish(); return { done: true }; }
      W.__SIM__(C.dt, false, C.dt);
      C.f++; C.t += C.dt;
      if (A.phase !== C.phase) {
        const order = ORDER[C.variant] || [];
        C.phaseT[C.phase] = +(C.t - (C.phaseStart || 0)).toFixed(2);
        C.phaseStart = C.t;
        C.phase = A.phase; C.phases.push(A.phase);
        const want = order[C.phases.length - 1];
        if (want !== A.phase) fail('script', `phase ${A.phase}, expected ${want} (${C.phases.join('>')})`);
        C.nextShot = C.t + 0.45;     // a shot 0.45 s into every phase
      }
      if (A.done) break;
      measure();
      if (C.c.trace && C.f % 15 === 0 && A.walker) {
        const tp = A.targetPoint(V()), sp = A.standPoint(tp, A.walker.pos, V()), w = A.walker;
        (C.trace = C.trace || []).push(`${C.t.toFixed(2)} ${A.phase} w(${w.pos.x.toFixed(2)},${w.pos.z.toFixed(2)}) f${w.facing.toFixed(2)} tp(${tp.x.toFixed(2)},${tp.y.toFixed(2)},${tp.z.toFixed(2)}) sp(${sp.x.toFixed(2)},${sp.z.toFixed(2)}) bike v${C.target.phys.speed.toFixed(1)} ik ${(A._ikRes || 0).toFixed(2)} std ${A.standCuff} susp ${A.suspect ? A.suspect.t.toFixed(1) + ' par ' + (suspectRig() && suspectRig().parent && suspectRig().parent.type) + ' det ' + A.suspect.detached : 'none'}`);
      }
      if (C.t > LIM.TOTAL) { fail('overrun', `still ${A.phase} after ${LIM.TOTAL} s`); return { done: true }; }
      if (shotEvery && C.nextShot && C.t >= C.nextShot) { C.nextShot = 0; return { shot: A.phase, t: C.t }; }
      if (shotEvery && !C.shotStop && A.phase === 'stop' && C.t > 1.0) { C.shotStop = true; return { shot: 'stop', t: C.t }; }
    }
    return { more: true };
  }

  // the side-on shot of the two of them
  function frameShot() {
    const A = C.arrest, cam = W.__CAM__;
    const cp = A.focus.clone ? A.focus.clone() : V().copy(A.focus);
    // while he is still riding in / stepping off, the shot is of HIM; once he is
    // on foot, of the two of them (and never wider than the scene needs)
    const tp = A.phase === 'stop' || A.phase === 'off' ? cp.clone() : A.targetPoint(V());
    const mid = V().addVectors(cp, tp).multiplyScalar(0.5);
    const d = V().subVectors(tp, cp); d.y = 0;
    if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
    d.normalize();
    const side = V().set(-d.z, 0, d.x);
    const r = Math.min(7, Math.max(3.4, flat(cp, tp) * 1.1 + 2.2));
    cam.position.set(mid.x + side.x * r, mid.y + 1.2, mid.z + side.z * r);
    cam.fov = 45; cam.updateProjectionMatrix();
    cam.lookAt(mid.x, mid.y + 0.55, mid.z);
    cam.updateMatrixWorld(true);
    W.__RENDER__();
  }

  // after the scene: everyone back on their bikes, at their own scale
  function teardown() {
    // the ground checks only mean something if the road was found under the bodies
    if (C.gSamples && (C.gMiss || 0) / C.gSamples > 0.25) fail('groundUnknown', `no road under ${C.gMiss}/${C.gSamples} sampled points`);
    C.worst.groundMiss = +(C.gSamples ? (C.gMiss || 0) / C.gSamples : 1).toFixed(2);
    const out = { trace: C.trace, fails: C.fails, worst: C.worst, phases: C.phases, phaseT: C.phaseT, t: +C.t.toFixed(2), variant: C.variant };
    const cop = W.__COP__;
    for (let i = 0; i < 60 && S[C.key]; i++) W.__SIM__(0.25);       // the photo, then the results
    if (S[C.key]) fail('stuck', 'arrest never cleared');
    if (cop.rider.parent !== cop.socket) fail('copNotRemounted', 'cop rider not back on the bike socket');
    const sc = cop.rider.getWorldScale(V()).x;
    if (Math.abs(sc / C.copScale0 - 1) > LIM.SCALE) fail('copScaleAfter', `cop scale ${sc.toFixed(3)} after, ${C.copScale0.toFixed(3)} before`);
    const pd = angBetween(C.copRest, cop.rider.userData.joints.pelvis.quaternion);
    if (pd > 0.05) fail('copPoseLeak', `cop pelvis ${pd.toFixed(2)} rad off rest after release`);
    const sr = suspectRig();
    if (C.c.who === 'player' && C.arrest.suspect && sr) {
      const o = C.arrest.suspect.owner;
      if (sr.parent !== o.socket) fail('suspectNotRemounted', 'suspect rider not back on the socket');
    }
    // the NEXT race: clean riding poses for everyone
    W.__START__();
    for (let i = 0; i < 40 && S.countdown > 0; i++) W.__SIM__(0.25);
    W.__SIM__(2);
    const pr = W.__PLAYER_RIDER__;
    const pb = body(pr);
    if (pb.up.y < 0.55) fail('nextRacePlayerPose', `player torso up.y ${pb.up.y.toFixed(2)} next race`);
    if (pr.parent && pr.parent.parent !== W.__PLAYER_BIKE__) fail('nextRacePlayerSeat', 'player rider not on the bike next race');
    const cpd = angBetween(C.copRest, cop.rider.userData.joints.pelvis.quaternion);
    if (cpd > 0.4) fail('nextRaceCopPose', `cop pelvis ${cpd.toFixed(2)} rad off rest next race`);
    if (S.arrest || S.copArrest) fail('nextRaceArrest', 'an arrest carried into the next race');
    out.fails = C.fails;
    return out;
  }

  W.__AC__ = { setup, run, frameShot, teardown, LIM };
};

// ---- run ---------------------------------------------------------------------------------
const cases = buildCases();
fs.mkdirSync(OUT, { recursive: true });
console.log(`arrestcheck: ${cases.length} cases${SHOTS ? ', filmstrips in tools/out/arrest/' : ''}`);
let failed = 0;
const results = [];
let page = await openGame();
for (const c of cases) {
  const t0 = Date.now();
  const reps = c.repeat || 1;
  let res = null, err = null, shots = [];
  try {
    for (let rep = 0; rep < reps; rep++) {
      const s = await page.evaluate((c) => window.__AC__.setup(c), c);
      if (s.error) throw new Error(s.error);
      for (let guard = 0; guard < 400; guard++) {
        const r = await page.evaluate((shots) => window.__AC__.run(240, shots), SHOTS && rep === reps - 1);
        if (r.shot) {
          await page.evaluate(() => window.__AC__.frameShot());
          const f = path.join(OUT, `${c.name}__${String(shots.length).padStart(2, '0')}-${r.shot}.png`);
          await page.screenshot({ path: f });
          shots.push({ file: path.basename(f), phase: r.shot, t: r.t.toFixed(1) });
        }
        if (r.done) break;
      }
      const out = await page.evaluate(() => window.__AC__.teardown());
      if (!res) res = out;
      else for (const [k, v] of Object.entries(out.fails)) if (!res.fails[k]) res.fails[k] = { ...v, rep };
    }
  } catch (e) { err = e.message.split('\n').slice(0, 6).join(' / '); }
  for (const e of page.errors.splice(0)) { res = res || { fails: {} }; res.fails['pageError'] = res.fails['pageError'] || { n: 0, first: { detail: e } }; res.fails['pageError'].n++; }
  const fails = res ? Object.entries(res.fails) : [];
  const ok = !err && fails.length === 0;
  if (!ok) failed++;
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const wv = res && res.worst ? res.worst : {};
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${c.name.padEnd(44)} ${res ? res.variant + ' ' + (res.phases || []).join('>') : ''}  (${secs}s)`);
  if (ok && res) console.log(`         up>=${wv.upMin} head>=${wv.headOverPelvis} pelvisDrift<=${wv.pelvisDrift} sink<=${wv.sink} feet<=${wv.footGap} reach ${wv.reachMin}-${wv.reachMax} face<=${wv.faceErr} noRoad ${wv.groundMiss}`);
  if (err) console.log(`         error: ${err}`);
  for (const [k, v] of fails) console.log(`         ${k.padEnd(20)} x${v.n}  first at ${v.first.ph || ''} t=${v.first.t ?? ''}: ${v.first.detail}`);
  if (res && res.trace) for (const l of res.trace) console.log('         · ' + l);
  results.push({ case: c, ok, err, res, shots });
  // a fresh page after an error, so one broken case cannot poison the rest
  if (err) { await page.context().close(); page = await openGame(); }
}

// ---- the contact sheet -----------------------------------------------------------------
if (SHOTS) {
  const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const rows = results.map((r) => `<section class="${r.ok ? 'ok' : 'bad'}"><h3>${r.ok ? 'ok' : 'FAIL'} &nbsp; ${esc(r.case.name)} <small>${esc(r.res ? r.res.phases.join(' › ') : r.err || '')}</small></h3>
${r.ok ? '' : `<p>${Object.entries((r.res && r.res.fails) || {}).map(([k, v]) => `<b>${esc(k)}</b> ×${v.n}: ${esc(v.first.detail)}`).join('<br>') || esc(r.err)}</p>`}
<div class="strip">${r.shots.map((s) => `<figure><img src="${s.file}"><figcaption>${esc(s.phase)} · ${s.t}s</figcaption></figure>`).join('')}</div></section>`).join('\n');
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Arrest check</title>
<style>body{background:#111;color:#ddd;font:12px ui-monospace,monospace;margin:12px}h3{margin:14px 0 4px;font-weight:500}small{color:#888}
section.bad h3{color:#ff6b5a}section.ok h3{color:#8fd18f}p{color:#e0a090;margin:2px 0 6px}
.strip{display:flex;gap:4px;flex-wrap:wrap}figure{margin:0}img{width:280px;display:block}figcaption{color:#999;font-size:10px}</style>
<h2>RideRash arrest check — ${results.filter((r) => r.ok).length}/${results.length} cases held</h2>${rows}`);
  const sheet = await (await browser.newContext({ viewport: { width: 1480, height: 800 } })).newPage();
  await sheet.goto('file://' + path.join(OUT, 'index.html'));
  await sheet.screenshot({ path: path.join(OUT, 'sheet.png'), fullPage: true });
}

console.log(failed ? `\n${failed}/${cases.length} cases FAILED` : `\nall ${cases.length} cases held`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
