#!/usr/bin/env node
// RideRash — fuzz / regression harness.
//
// Drives the REAL game in a headless browser: random riding and fighting,
// pauses, mid-race restarts, instant replays opened and closed, cops forced
// in, crashes, and every way off the results screen. After every step it
// checks the invariants that past bugs broke:
//
//   - no page errors or console errors
//   - player and rival physics finite; player on the road (|lateral| < 40)
//   - grabs consistent: a `heldBy` always has the matching `hold`, and back
//   - no duplicate fighters in world.fighters
//   - never stuck: on foot < 32 s, never stationary 12 s while riding
//   - pause / resume / replay transitions land on the right screen
//   - every race ends and shows the results screen; replay and highlights open
//
// Before the fuzz, targeted checks for bugs fixed in the audit:
//   - a throttle released during a replay is released in the race
//   - a race that ends mid-grab starts the next one un-grabbed
//
// Usage (from this folder):
//   npm install                      # playwright-core + three (served locally)
//   npx playwright-core install chromium   # once, unless CHROME_PATH is set
//   node fuzz.mjs [--races N] [--start RACE] [--seed S] [--no-checks] [--headed]
//
//   --races  races to fuzz (default 4)       --start  career race index 0-24
//   --seed   random seed (default 1)          CHROME_PATH=/path/to/chrome
//
// Exit code 0 when everything held, 1 when anything failed -- usable as a
// pre-push check. A run of 4 races takes a few minutes on software GL.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const THREE_DIR = path.join(HERE, 'node_modules', 'three');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const RACES = +arg('races', 4), START = +arg('start', 0), SEED = +arg('seed', 1);

// ---- a tiny static server for the repo ----------------------------------------
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary' };
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
  headless: !flag('headed'),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };

async function openGame(career) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 300 } });
  const page = await ctx.newPage();
  await page.addInitScript(([c]) => {
    localStorage.setItem('riderash.settings.v1', JSON.stringify({ quality: 'low', master: 0 }));
    localStorage.setItem('riderash.career.v1', JSON.stringify(c));
  }, [career]);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console.error: ' + m.text().slice(0, 240)); });
  // three.js from the local install when there is one (offline, pinned version)
  if (fs.existsSync(THREE_DIR)) {
    await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.169\.0\/(.*)/, (route) => {
      const m = route.request().url().match(/three@0\.169\.0\/(.*)$/);
      route.fulfill({ path: path.join(THREE_DIR, m[1]), contentType: 'application/javascript' });
    });
  }
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 180000 });
  return page;
}
const drainErrors = (page, label) => { for (const e of page.errors.splice(0)) fail(`${label}: ${e}`); };

// ---- targeted checks ---------------------------------------------------------------
if (!flag('no-checks')) {
  console.log('checks');
  const page = await openGame({ race: 3, cash: 5000 });
  // 1. a throttle released during a replay is released in the race
  await page.evaluate(() => { window.__HOLD__ = true; window.__START__(); window.__SIM__(4); });
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => window.__SIM__(6));
  await page.keyboard.press('Escape');
  await page.click('#p-replay');
  await page.keyboard.up('ArrowUp');
  await page.evaluate(() => window.__REPLAY__.exit());
  await page.keyboard.press('Escape');
  const thr = await page.evaluate(() => { const p = window.__PLAYERPHYS__; const v0 = p.speed; window.__SIM__(4); return { v0, v1: p.speed, paused: window.__STATE__.paused }; });
  if (thr.paused) fail('still paused after resume');
  if (!(thr.v1 < thr.v0 - 2)) fail(`throttle stuck after a replay (${thr.v0.toFixed(1)} -> ${thr.v1.toFixed(1)} m/s)`);
  else console.log('  ok  throttle released across a replay');
  // 2. a race that ends mid-grab starts the next one un-grabbed
  const hold = await page.evaluate(() => {
    const W = window, c = W.__COP__, p = W.__PLAYERPHYS__, pf = W.__PLAYER_FIGHTER__;
    W.__START__(); W.__SIM__(8);
    c.enabled = true; c.phys.reset({ s: p.s - 0.3, lateral: p.lateral + 1.05, speed: p.speed }); c.phys.sync();
    c.state = 'parked'; c.group.visible = true; c._startChase();
    c.fighter.hold = { target: pf, t: 0, side: 1, throwNow: false }; pf.heldBy = c.fighter;
    W.__SIM__(0.1);
    p.s = W.__STATE__.finishS - 1; p.speed = 30; p.sync(); W.__SIM__(0.3);
    const ended = W.__STATE__.raceOver;
    W.__START__(); W.__SIM__(4);
    return { ended, heldBy: !!pf.heldBy, copHold: !!c.fighter.hold, canPunch: pf.can('punch'), copInFighters: W.__WORLD__.fighters.includes(c.fighter) };
  });
  if (!hold.ended) fail('race did not end at the line while grabbed');
  if (hold.heldBy || hold.copHold || !hold.canPunch || hold.copInFighters) fail('grab state leaked into the next race ' + JSON.stringify(hold));
  else console.log('  ok  grab state reset between races');
  drainErrors(page, 'checks');
  await page.context().close();
}

// ---- the fuzz ------------------------------------------------------------------------
console.log(`fuzz: ${RACES} races from career race ${START}, seed ${SEED}`);
const page = await openGame({ race: START, cash: 50000 });
for (let race = 0; race < RACES; race++) {
  const r = await page.evaluate(([race, seed]) => {
    let st = (seed * 9973 + race * 7919) >>> 0;
    const rnd = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
    const W = window, S = W.__STATE__, $ = (id) => document.getElementById(id);
    const key = (code, down) => W.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code }));
    const tap = (code) => { key(code, true); W.__SIM__(1 / 60); key(code, false); };
    const issues = [];
    const bad = (m) => { if (issues.length < 25 && !issues.includes(m)) issues.push(m); };
    W.__HOLD__ = true;
    W.__START__();
    const held = new Set();
    const setKey = (code, on) => { if (on && !held.has(code)) { held.add(code); key(code, true); } else if (!on && held.has(code)) { held.delete(code); key(code, false); } };
    let t = 0, footT = 0, stillT = 0, lastS = 0;
    const acts = { pause: 0, restart: 0, replay: 0, cop: 0, crash: 0 };
    const cap = 70 + rnd() * 40;
    for (; t < cap && !S.raceOver; t += 0.25) {
      setKey('ArrowUp', rnd() < 0.9); setKey('ArrowDown', rnd() < 0.04);
      const sv = rnd(); setKey('ArrowLeft', sv < 0.18); setKey('ArrowRight', sv > 0.82);
      setKey('ShiftLeft', rnd() < 0.3);
      const a = rnd();
      if (a < 0.10) tap('KeyJ'); else if (a < 0.16) tap('KeyK'); else if (a < 0.19) tap('KeyL'); else if (a < 0.21) tap('KeyG');
      else if (a < 0.24) tap('Space'); else if (a < 0.26) tap('KeyE'); else if (a < 0.265) tap('KeyC');
      const x = rnd();
      if (x < 0.006) { tap('Escape'); acts.pause++; if (!S.paused) bad('Escape did not pause'); tap('Escape'); if (S.paused) bad('Escape did not resume'); }
      else if (x < 0.008 && t > 5) {
        tap('Escape'); $('p-replay').click(); const R = W.__REPLAY__;
        if (!R.active) bad('replay did not open from pause');
        for (let i = 0; i < 20; i++) R.update(0.05);
        R.exit();
        if (!S.paused) bad('not back in pause after the replay');
        if (!$('pause').classList.contains('on')) bad('pause menu not shown after the replay');
        tap('Escape'); acts.replay++;
      } else if (x < 0.009 && t > 8 && acts.restart < 1) { tap('Escape'); $('p-restart').click(); acts.restart++; t = 0; footT = 0; stillT = 0; lastS = 0; }
      else if (x < 0.013 && t > 10) {
        const c = W.__COP__, p = W.__PLAYERPHYS__;
        if (c && c.state === 'off') { c.enabled = true; c.phys.reset({ s: p.s - 50, lateral: p.lateral + 2, speed: p.speed }); c.phys.sync(); c.state = 'parked'; c.group.visible = true; c._startChase(); acts.cop++; }
      } else if (x < 0.015 && t > 6) {
        const pf = W.__PLAYER_FIGHTER__;
        if (!pf.down) { pf.hp = 0; W.__PLAYERPHYS__.speed = Math.max(W.__PLAYERPHYS__.speed, 30); pf.down = true; pf.downTimer = 2.5; acts.crash++; }
      }
      if (S.raceOver) break;
      W.__SIM__(0.25);
      const p = W.__PLAYERPHYS__, pf = W.__PLAYER_FIGHTER__;
      for (const [nm, v] of [['s', p.s], ['lateral', p.lateral], ['speed', p.speed], ['yaw', p.yaw]]) if (!Number.isFinite(v)) bad('player ' + nm + ' not finite');
      for (const rv of W.__RIVALS__) if (!Number.isFinite(rv.phys.s) || !Number.isFinite(rv.phys.lateral)) bad('rival ' + rv.name + ' NaN');
      if (pf.heldBy && (!pf.heldBy.hold || pf.heldBy.hold.target !== pf)) bad('player heldBy without a matching hold');
      for (const f of W.__WORLD__.fighters) if (f.hold && f.hold.target.heldBy !== f) bad('hold without a matching heldBy');
      const fl = W.__WORLD__.fighters; if (new Set(fl).size !== fl.length) bad('duplicate fighter in world.fighters');
      if (pf.hp < 0 || pf.hp > pf.maxHp + 1e-6) bad('hp out of range ' + pf.hp);
      if (S.countdown <= 0) {
        const D = W.__DISMOUNT__;
        if (D && D.onFoot) footT += 0.25; else footT = 0;
        if (footT > 32) bad('player on foot > 32 s (state ' + (D && D.state) + ')');
        if (!(D && D.onFoot) && !pf.down && Math.abs(p.s - lastS) < 0.3) stillT += 0.25; else stillT = 0;
        if (stillT > 12) bad('player not moving for 12 s while riding (speed ' + p.speed.toFixed(1) + ')');
        lastS = p.s;
      }
      if (Math.abs(p.lateral) > 40) bad('player lateral ' + p.lateral.toFixed(1));
    }
    for (const c of [...held]) setKey(c, false);
    const ended = S.raceOver ? 'natural' : 'forced';
    if (!S.raceOver) {
      const p = W.__PLAYERPHYS__;
      for (let i = 0; i < 40 && (W.__PLAYER_FIGHTER__.down || (W.__DISMOUNT__ && W.__DISMOUNT__.onFoot)); i++) W.__SIM__(1);
      p.s = S.finishS - 3; p.speed = Math.max(p.speed, 25); p.sync(); W.__SIM__(1);
    }
    if (!S.raceOver) bad('race did not end after crossing the line');
    if (!$('over').classList.contains('on')) bad('results screen not shown');
    const title = $('overh').textContent, btn = $('again').textContent;
    const R = W.__REPLAY__, stats = R.stats();
    $('rp-hl').click();
    if (R.times.length && !R.active) bad('highlights did not open');
    for (let i = 0; i < 30; i++) R.update(0.1);
    R.exit();
    if (!$('over').classList.contains('on')) bad('results not shown after the replay');
    let objs = 0; W.__SCENE__.traverse(() => objs++);
    const exit = rnd() < 0.3 ? 'menu' : 'again';
    if (exit === 'menu') { $('tomenu').click(); if (!$('title').classList.contains('on')) bad('GARAGE & MENU did not show the title'); }
    return { race, ended, t: +t.toFixed(1), title, btn, exit, acts, replayKB: Math.round(stats.bytes / 1024), sceneObjects: objs,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, issues };
  }, [race, SEED]);
  console.log(`  race ${race + 1}: ${r.title} (${r.ended}, ${r.t}s) -> ${r.exit}; replay ${r.replayKB} KB, ${r.sceneObjects} objects, ${r.heapMB} MB heap; ${JSON.stringify(r.acts)}`);
  for (const i of r.issues) fail(`race ${race + 1}: ${i}`);
  drainErrors(page, `race ${race + 1}`);
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall held');
process.exit(failures ? 1 : 0);
