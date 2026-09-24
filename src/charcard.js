// RideRash — CHARACTER CARDS. A read-only "showroom" for the rival riders.
//
// WHAT IT IS. Hover (desktop) or click/tap a rider's name in the TONIGHT'S
// FIELD row on the title screen, or in the standings on the pause screen, and a
// card opens: a small live 3D turntable of that rider on his bike, his bio,
// stat bars, signature move, quote, tonight's mood, and his CURRENT RACE
// numbers (position, speed, swings, hits landed, what his brain is doing).
// Nothing on it is editable -- these are characters, not your rider. The
// designer for YOUR rider is showroom.js.
//
// NOT IN-RACE. Cards open only from the title and pause screens, so the card
// never steals a click or a touch from the race controls. (A 3D raycast pick on
// the road was considered and rejected for the same reason: the pause overlay
// covers the canvas, and live-race picking would fight the touch pad.)
//
// THE TURNTABLE IS CHEAP. No second WebGL context: the game's own renderer
// draws a tiny scene (a clone of the rival's group sharing its geometry and
// materials, two lights, a disc) into a 280x320 WebGLRenderTarget at ~24 fps
// while a card is open, reads the pixels back, converts linear -> sRGB with a
// 256-entry LUT and puts them on a 2D canvas. Render-target output in three
// 0.169 is linear and un-tone-mapped, hence the LUT. Renderer state (target,
// clear colour/alpha, scissor) is saved and restored around the draw. Nothing
// runs while no card is open.
//
// ---------------------------------------------------------------------------
// EASTER EGGS (small, on purpose)
// ---------------------------------------------------------------------------
//   1. PORTRAIT x5. Click a rider's turntable five times: he sits up and waves,
//      a speech bubble shows his quote, and a synthesized "voice" (formant-
//      filtered sawtooth syllables, pitch per rider) mumbles it.
//   2. VIPER'S MUGSHOT. VIPER's card has a FLIP button (or click his name): the
//      card turns over to a police mugshot -- his silhouette against a height
//      chart, booking number and charges.
//   3. KONAMI CODE (up up down down left right left right B A), anywhere:
//      BIG HEAD MODE for the whole pack. Enter it again to turn it off.
//   4. THE GHOST. A secret rider (roster.js, `secret: true`) is dealt into a
//      level-5 field in ~15% of races (?secret=1 forces him). Clean, fast, and
//      his card says almost nothing.
//   5. Race taunts: riders shout a line (HTML toast) when they land a blow on
//      you or when you hit them. Not quite an egg, but they have favourites.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { riderById, gridFor, peekRaceSeed } from './roster.js';
import { CFG } from './config.js';
import { loadSettings } from './settings.js';

const W = 280, H = 320;
const STAT_KEYS = [['aggression', 'AGGRESSION'], ['pace', 'PACE'], ['skill', 'SKILL'], ['dirty', 'DIRTY'], ['grudge', 'GRUDGE']];
const MPH = 2.23694;

let C = null;          // init context
let card = null;       // DOM refs
let open = null;       // { slot, entry, row, rival, pinned }
let tt = null;         // turntable state
const cloneCache = new Map();

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initCharCard(opts) {
  C = opts;
  buildDom();
  mountField();
  mountStandings();
  konami();
  taunts();
  window.__CHARCARD__ = { open: (slot) => openCard(slot, true), close: closeCard, state: () => open && { slot: open.slot, id: open.entry && open.entry.id, flipped: card.root.classList.contains('flip') }, bigHead: () => bigHead };
}

// ---------------------------------------------------------------------------
// DATA: which character is in slot i? In race: the rival's own entry. On the
// title: the field the NEXT race will deal (same seed resetRace will take).
// ---------------------------------------------------------------------------
function pendingField() {
  try { return gridFor(C.getEvent() || {}, C.count, { seed: peekRaceSeed() }); } catch (e) { return []; }
}
function entryFor(slot, fromTitle) {
  const rival = C.rivals[slot];
  const entry = fromTitle ? pendingField()[slot] : (rival && rival.entry);
  return { rival, entry, row: entry ? riderById(entry.id) : null };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
function buildDom() {
  const root = document.createElement('div');
  root.id = 'ccard';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Rider card');
  root.innerHTML = `
  <div class="cc-inner">
    <div class="cc-face cc-front">
      <button class="cc-x pe" aria-label="Close">&times;</button>
      <div class="cc-left">
        <canvas class="cc-tt" width="${W}" height="${H}" title="Click me"></canvas>
        <div class="cc-bubble"></div>
      </div>
      <div class="cc-right">
        <div class="cc-name"><span class="cc-nm"></span><span class="cc-mood"></span></div>
        <div class="cc-style"></div>
        <p class="cc-bio"></p>
        <div class="cc-stats"></div>
        <div class="cc-sig"></div>
        <div class="cc-quote"></div>
        <div class="cc-machine"></div>
        <div class="cc-race"></div>
        <button class="cc-flip pe">FLIP CARD</button>
      </div>
    </div>
    <div class="cc-face cc-back">
      <button class="cc-x pe" aria-label="Close">&times;</button>
      <canvas class="cc-mug" width="${W}" height="${H}"></canvas>
      <div class="cc-plac"></div>
      <button class="cc-flip pe">FLIP BACK</button>
    </div>
  </div>`;
  document.body.appendChild(root);
  card = {
    root,
    tt: root.querySelector('.cc-tt'), mug: root.querySelector('.cc-mug'),
    bubble: root.querySelector('.cc-bubble'), nm: root.querySelector('.cc-nm'),
    mood: root.querySelector('.cc-mood'), style: root.querySelector('.cc-style'),
    bio: root.querySelector('.cc-bio'), stats: root.querySelector('.cc-stats'),
    sig: root.querySelector('.cc-sig'), quote: root.querySelector('.cc-quote'),
    machine: root.querySelector('.cc-machine'), race: root.querySelector('.cc-race'),
    plac: root.querySelector('.cc-plac'), flips: root.querySelectorAll('.cc-flip'),
  };
  root.querySelectorAll('.cc-x').forEach((b) => b.addEventListener('click', closeCard));
  card.flips.forEach((b) => b.addEventListener('click', () => root.classList.toggle('flip')));
  card.nm.addEventListener('click', () => { if (open && open.row && open.row.mugshot) root.classList.toggle('flip'); });
  root.addEventListener('mouseenter', () => { if (open) open.hover = true; });
  // Any click on a peeking card pins it (so it does not vanish under the pointer).
  root.addEventListener('pointerdown', () => { if (open && !open.pinned) { open.pinned = true; root.classList.remove('peek'); } });
  root.addEventListener('mouseleave', () => { if (open) { open.hover = false; if (!open.pinned) setTimeout(maybeClosePeek, 180); } });
  // Portrait clicks -> easter egg 1.
  let clicks = 0, clickT = 0;
  card.tt.addEventListener('click', () => {
    const now = performance.now();
    clicks = (now - clickT < 900) ? clicks + 1 : 1;
    clickT = now;
    if (open) open.pinned = true;
    if (clicks >= 5) { clicks = 0; wave(); }
  });
  // Esc closes the card BEFORE the game's own Esc (resume) sees it.
  addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeCard(); }
  }, true);
  const toast = document.createElement('div');
  toast.id = 'cctoast';
  document.body.appendChild(toast);
  card.toast = toast;
}

function chipHTML(slot, e, extra = '') {
  const row = e && riderById(e.id);
  if (!row) return '';
  const style = (row.style || '').split(' - ')[0];
  return `<button class="ccchip pe" data-slot="${slot}">${extra}${esc(row.name)}<small>${esc(style)}</small></button>`;
}

function wireChips(host, fromTitle) {
  const hoverable = matchMedia && matchMedia('(hover: hover)').matches;
  host.querySelectorAll('.ccchip').forEach((b) => {
    const slot = Number(b.dataset.slot);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openCard(slot, true, fromTitle); });
    if (hoverable) {
      b.addEventListener('mouseenter', () => { if (!open || !open.pinned) openCard(slot, false, fromTitle); });
      b.addEventListener('mouseleave', () => setTimeout(maybeClosePeek, 180));
    }
  });
}

// TONIGHT'S FIELD, on the title screen.
function mountField() {
  const title = $('title');
  if (!title) return;
  const host = document.createElement('div');
  host.id = 'ccfield';
  const before = $('titleactions');
  if (before) title.insertBefore(host, before); else title.appendChild(host);
  const refresh = () => {
    const f = pendingField();
    host.innerHTML = `<div class="cclab">TONIGHT'S FIELD <span>hover or tap a rider</span></div><div class="ccrow">${f.map((e, i) => chipHTML(i, e)).join('')}</div>`;
    wireChips(host, true);
  };
  refresh();
  new MutationObserver(() => { if (title.classList.contains('on')) refresh(); }).observe(title, { attributes: true, attributeFilter: ['class'] });
  // Career / map / garage clicks can change the event: re-deal after them.
  title.addEventListener('click', (e) => { if (!host.contains(e.target)) setTimeout(refresh, 0); });
}

// STANDINGS, on the pause screen.
function mountStandings() {
  const pause = $('pause');
  if (!pause) return;
  const host = document.createElement('div');
  host.id = 'ccstand';
  const before = $('pausemenu');
  if (before) pause.insertBefore(host, before); else pause.appendChild(host);
  const refresh = () => {
    const w = C.world;
    if (!w || !w.parts) { host.innerHTML = ''; return; }
    const rows = w.parts.filter((p) => p.phys).map((p) => ({ p, pos: w.positionOf(p.phys) })).sort((a, b) => a.pos - b.pos);
    host.innerHTML = `<div class="cclab">STANDINGS <span>tap a rider</span></div><div class="ccrow">${rows.map(({ p, pos }) => {
      if (p === w.player) return `<span class="ccchip you">${pos}. YOU<small>&nbsp;</small></span>`;
      const slot = C.rivals.indexOf(p);
      return chipHTML(slot, p.entry, `${pos}. `);
    }).join('')}</div>`;
    wireChips(host, false);
  };
  new MutationObserver(() => { if (pause.classList.contains('on')) refresh(); else closeCard(); }).observe(pause, { attributes: true, attributeFilter: ['class'] });
}

function maybeClosePeek() {
  if (!open || open.pinned || open.hover) return;
  if (document.querySelector('.ccchip:hover')) return;
  closeCard();
}

// ---------------------------------------------------------------------------
// OPEN / FILL / CLOSE
// ---------------------------------------------------------------------------
function openCard(slot, pinned, fromTitle) {
  if (fromTitle === undefined) fromTitle = !(C.world && C.world.player && C.world.player.phys && document.getElementById('pause')?.classList.contains('on'));
  const d = entryFor(slot, fromTitle);
  if (!d.row) return;
  const same = open && open.slot === slot && open.fromTitle === fromTitle;
  open = { slot, fromTitle, ...d, pinned: !!pinned || (same && open.pinned), hover: false };
  if (!same) { card.root.classList.remove('flip'); fill(); startTurntable(d.rival); }
  card.root.classList.add('on');
  card.root.classList.toggle('peek', !open.pinned);
  // Sit ABOVE the chip row that opened it, so hovering along the row keeps
  // every chip reachable (a centred card covered them).
  const row = document.querySelector(fromTitle ? '#ccfield .ccrow' : '#ccstand .ccrow');
  const rr = row && row.getBoundingClientRect();
  const ch = card.root.getBoundingClientRect().height;
  if (rr && rr.height && rr.top - ch - 10 >= 4) {
    card.root.style.top = (rr.top - ch - 10) + 'px';
    card.root.style.transform = 'translateX(-50%)';
  } else if (rr && rr.height && rr.bottom + ch + 10 <= innerHeight - 4) {
    card.root.style.top = (rr.bottom + 10) + 'px';
    card.root.style.transform = 'translateX(-50%)';
  } else { card.root.style.top = ''; card.root.style.transform = ''; }
}

function closeCard() {
  if (!card) return;
  card.root.classList.remove('on', 'flip', 'peek');
  open = null;
  stopTurntable();
}

function fill() {
  const { row, entry, rival } = open;
  card.nm.textContent = row.name;
  card.nm.classList.toggle('link', !!row.mugshot);
  card.mood.textContent = entry && entry.moodLabel ? `TONIGHT: ${entry.moodLabel}` : '';
  card.style.textContent = row.style || '';
  card.bio.textContent = row.bio || row.blurb || '';
  card.stats.innerHTML = STAT_KEYS.map(([k, lab]) => {
    const v = Math.max(0, Math.min(10, (row.stats && row.stats[k]) || 0));
    return `<div class="ccst"><span>${lab}</span><i><b style="width:${v * 10}%"></b></i><em>${v}</em></div>`;
  }).join('');
  card.sig.innerHTML = `<b>SIGNATURE</b> ${esc(row.signature || row.specialty)}`;
  card.quote.textContent = `"${row.quote || ''}"`;
  const bikeClass = rival && rival.group && rival.group.userData.bikeClass;
  card.machine.innerHTML = `<b>MACHINE</b> ${esc(row.bike || '')}${bikeClass ? ` &middot; ${esc(String(bikeClass).toUpperCase())}` : ''} &middot; ${row.weapon ? 'CARRIES A CHAIN &middot; ' : ''}limited to ${Math.round(CFG.MAX_SPEED * MPH)} MPH, same as yours`;
  card.flips.forEach((b) => { b.style.display = row.mugshot ? '' : 'none'; });
  if (row.mugshot) {
    card.plac.innerHTML = `<div class="pn">${esc(row.name)}</div><div class="pb">${esc(row.mugshot.number)}</div><div class="pc">${esc(row.mugshot.charges)}</div>`;
  }
  card.bubble.classList.remove('on');
  fillRace();
}

function fillRace() {
  if (!open) return;
  const { rival, fromTitle, entry } = open;
  if (fromTitle || !rival || !C.world || !C.world.player) {
    card.race.innerHTML = `<b>GRID</b> slot ${open.slot + 1} of ${C.count} &middot; seed ${esc(window.__SEED__)}`;
    return;
  }
  const w = C.world, cs = rival.cstats || {};
  const pos = w.positionOf(rival.phys);
  const hp = rival.fighter ? Math.round(100 * rival.fighter.hp / Math.max(1, rival.fighter.maxHp)) : 0;
  const st = rival.fighter && rival.fighter.down ? 'DOWN' : (rival.brain ? rival.brain.stateName : '');
  card.race.innerHTML = `<b>THIS RACE</b> P${pos}/${w.parts.length} &middot; ${Math.round(rival.phys.speed * MPH)} MPH &middot; HP ${hp}% &middot; SWINGS ${cs.swings || 0} &middot; HITS ${cs.hits || 0}${cs.hitsOnPlayer ? ` (${cs.hitsOnPlayer} on you)` : ''} &middot; ${esc(st)}${rival.brain && rival.brain.grudgeKey === 'player' ? ' &middot; <span class="red">HOLDS A GRUDGE AGAINST YOU</span>' : ''}`;
  void entry;
}

// ---------------------------------------------------------------------------
// TURNTABLE
// ---------------------------------------------------------------------------
const LUT = new Uint8ClampedArray(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LUT[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
}

function ensureStage() {
  if (tt) return tt;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe6eeff, 0x3a3026, 1.6));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6); key.position.set(3, 4, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb45a, 1.8); rim.position.set(-3, 2.5, -4); scene.add(rim);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.9 }));
  disc.rotation.x = -Math.PI / 2; scene.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.62, 64), new THREE.MeshBasicMaterial({ color: 0xffb45a }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; scene.add(ring);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  tt = { scene, cam, rt, buf: new Uint8Array(W * H * 4), img: card.tt.getContext('2d').createImageData(W, H),
    model: null, raf: 0, last: 0, angle: 0.6, waveT: 0 };
  return tt;
}

function modelFor(rival) {
  if (!rival || !rival.group) return null;
  let m = cloneCache.get(rival);
  if (!m) {
    m = cloneLive(rival.group);
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.visible = true;
    m.traverse((n) => { n.frustumCulled = false; });
    let joints = null;
    m.traverse((n) => { if (!joints && n.userData && n.userData.joints && n.userData.joints.arms) joints = n.userData.joints; });
    m.userData.ccJoints = joints;
    cloneCache.set(rival, m);
  }
  return m;
}

/**
 * Clone a LIVE rider group. rigclone.cloneWithJoints cannot be used here: a
 * posed rider's userData carries IK caches with cycles (`joints.__ik`), and
 * Object3D.copy JSON-stringifies userData -- it throws "circular structure".
 * So userData is lifted off every node for the clone and put back, and only the
 * joint map (Object3D refs, any depth, `__` keys skipped) is rebuilt on the copy.
 */
function cloneLive(src) {
  const saved = [];
  src.traverse((n) => { saved.push([n, n.userData]); n.userData = {}; });
  let copy;
  try { copy = src.clone(true); } finally { for (const [n, u] of saved) n.userData = u; }
  const map = new Map();
  (function walk(a, b) {
    map.set(a, b);
    const k = Math.min(a.children.length, b.children.length);
    for (let i = 0; i < k; i++) walk(a.children[i], b.children[i]);
  })(src, copy);
  const remap = (v, d) => {
    if (!v || typeof v !== 'object' || d > 5) return undefined;
    if (v.isObject3D) return map.get(v);
    const out = {};
    for (const key of Object.keys(v)) { if (key.startsWith('__')) continue; const r = remap(v[key], d + 1); if (r !== undefined) out[key] = r; }
    return out;
  };
  for (const [n] of saved) {
    const u = n.userData;
    const c = map.get(n);
    if (c && u && u.joints) c.userData.joints = remap(u.joints, 0);
  }
  return copy;
}

function startTurntable(rival) {
  const s = ensureStage();
  if (s.model) s.scene.remove(s.model);
  s.model = modelFor(rival);
  if (s.model) {
    s.scene.add(s.model);
    // Frame it: bike ~2 m long, rider ~1.5 m tall.
    s.cam.position.set(3.05, 1.5, 3.55);
    s.cam.lookAt(0, 0.82, 0);
  }
  s.waveT = 0;
  if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(tick); }
}

function stopTurntable() {
  if (tt && tt.raf) { cancelAnimationFrame(tt.raf); tt.raf = 0; }
}

let raceFillT = 0;
function tick(now) {
  if (!tt || !open) { if (tt) tt.raf = 0; return; }
  tt.raf = requestAnimationFrame(tick);
  const dt = (now - tt.last) / 1000;
  if (dt < 1 / 24) return;                 // ~24 fps is plenty for a turntable
  tt.last = now;
  const d = Math.min(0.1, dt);
  tt.angle += d * 0.55;
  if (tt.model) {
    tt.model.rotation.y = tt.angle;
    animateWave(d);
  }
  renderStage();
  raceFillT -= d;
  if (raceFillT <= 0) { raceFillT = 0.25; fillRace(); }
}

const _cc = new THREE.Color();
function renderStage() {
  const r = C.renderer;
  if (!r || !tt) return;
  const prevRT = r.getRenderTarget();
  r.getClearColor(_cc); const prevA = r.getClearAlpha();
  const prevSc = r.getScissorTest(), prevAuto = r.autoClear;
  try {
    r.setRenderTarget(tt.rt);
    r.setScissorTest(false);
    r.setClearColor(0x000000, 0);
    r.autoClear = true;
    r.clear();
    r.render(tt.scene, tt.cam);
    r.readRenderTargetPixels(tt.rt, 0, 0, W, H, tt.buf);
  } catch (e) { /* context trouble: skip the frame */ }
  r.setRenderTarget(prevRT);
  r.setClearColor(_cc, prevA);
  r.setScissorTest(prevSc);
  r.autoClear = prevAuto;
  // Flip rows (GL is bottom-up) and linear -> sRGB.
  const src = tt.buf, dst = tt.img.data;
  for (let y = 0; y < H; y++) {
    const si = (H - 1 - y) * W * 4, di = y * W * 4;
    for (let x = 0; x < W * 4; x += 4) {
      dst[di + x] = LUT[src[si + x]]; dst[di + x + 1] = LUT[src[si + x + 1]];
      dst[di + x + 2] = LUT[src[si + x + 2]]; dst[di + x + 3] = src[si + x + 3];
    }
  }
  card.tt.getContext('2d').putImageData(tt.img, 0, 0);
  if (card.root.classList.contains('flip')) drawMugshot();
}

// EASTER EGG 2: the back of VIPER's card -- a silhouette on a height chart.
function drawMugshot() {
  const g = card.mug.getContext('2d');
  g.fillStyle = '#c9c4b6'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(40,40,40,.55)'; g.lineWidth = 1;
  for (let y = 20; y < H; y += 20) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(y % 100 === 0 ? W : 36, y + 0.5); g.stroke(); }
  // silhouette: the turntable frame, alpha only, filled black
  const off = drawMugshot.off || (drawMugshot.off = document.createElement('canvas'));
  off.width = W; off.height = H;
  const o = off.getContext('2d');
  o.clearRect(0, 0, W, H);
  o.drawImage(card.tt, 0, 0);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = '#111'; o.fillRect(0, 0, W, H);
  o.globalCompositeOperation = 'source-over';
  g.drawImage(off, 0, 0);
}

// ---------------------------------------------------------------------------
// EASTER EGG 1: five clicks on the portrait -> wave + voice + quote bubble.
// ---------------------------------------------------------------------------
function wave() {
  if (!open || !tt) return;
  tt.waveT = 2.4;
  card.bubble.textContent = open.row.quote || '...';
  card.bubble.classList.add('on');
  setTimeout(() => card.bubble.classList.remove('on'), 2600);
  voice(open.row);
}

function animateWave(dt) {
  const j = tt.model && tt.model.userData.ccJoints;
  if (!j || !j.arms || !j.arms.right) return;
  const arm = j.arms.right;
  const up = arm.upper || arm.shoulder;
  if (!up) return;
  if (!up.userData.ccRest) up.userData.ccRest = up.rotation.clone();
  const fore = arm.fore || arm.elbow;
  if (fore && !fore.userData.ccRest) fore.userData.ccRest = fore.rotation.clone();
  if (tt.waveT > 0) {
    tt.waveT -= dt;
    const k = Math.min(1, Math.min(tt.waveT, 2.4 - tt.waveT) * 4);   // ease in/out
    const r = up.userData.ccRest;
    up.rotation.set(r.x - 2.3 * k, r.y, r.z + 0.5 * k);
    if (fore) { const f = fore.userData.ccRest; fore.rotation.set(f.x - 0.4 * k, f.y, f.z + Math.sin(performance.now() / 110) * 0.6 * k); }
  } else {
    up.rotation.copy(up.userData.ccRest);
    if (fore) fore.rotation.copy(fore.userData.ccRest);
  }
}

let actx = null;
function voice(row) {
  try {
    const st = loadSettings();
    const vol = st.master * st.sfx;
    if (vol <= 0.01) return;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    let h = 0; for (const ch of row.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const base = 95 + (h % 90);                       // a pitch per rider
    const syl = Math.max(3, Math.min(8, Math.round((row.quote || '...').length / 5)));
    const t0 = actx.currentTime + 0.02;
    const out = actx.createGain(); out.gain.value = 0.22 * vol; out.connect(actx.destination);
    const vowels = [[730, 1090], [270, 2290], [570, 840], [300, 870], [530, 1840]];
    for (let i = 0; i < syl; i++) {
      const ts = t0 + i * 0.13, dur = 0.11;
      const osc = actx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * (1 + ((h >> i) & 3) * 0.06), ts);
      osc.frequency.linearRampToValueAtTime(base * (i === syl - 1 ? 0.8 : 1.1), ts + dur);
      const env = actx.createGain(); env.gain.setValueAtTime(0, ts);
      env.gain.linearRampToValueAtTime(1, ts + 0.02); env.gain.linearRampToValueAtTime(0, ts + dur);
      const v = vowels[(h + i * 7) % vowels.length];
      for (const f of v) {
        const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 7;
        osc.connect(bp); bp.connect(env);
      }
      env.connect(out);
      osc.start(ts); osc.stop(ts + dur + 0.02);
    }
  } catch (e) { /* no audio: the wave still happens */ }
}

// ---------------------------------------------------------------------------
// EASTER EGG 3: Konami code -> big-head mode for the pack.
// ---------------------------------------------------------------------------
let bigHead = false;
function konami() {
  const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let i = 0;
  addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    i = (k === seq[i]) ? i + 1 : (k === seq[0] ? 1 : 0);
    if (i === seq.length) { i = 0; setBigHead(!bigHead); }
  });
}
function setBigHead(on) {
  bigHead = on;
  const s = on ? 1.75 : 1;
  const apply = (root) => root && root.traverse((n) => { const j = n.userData && n.userData.joints; if (j && j.head && j.head.isObject3D && j.arms) j.head.scale.setScalar(s); });
  for (const r of C.rivals) apply(r.group);
  for (const m of cloneCache.values()) apply(m);
  showToast(on ? 'BIG HEAD MODE' : 'big head mode off');
}

// ---------------------------------------------------------------------------
// TAUNTS: a rival's `lastSay` (rivals.js) becomes a short toast, in race only.
// ---------------------------------------------------------------------------
let toastT = 0;
function showToast(text) {
  card.toast.textContent = text;
  card.toast.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => card.toast.classList.remove('on'), 2200);
}
function taunts() {
  let seen = 0;
  setInterval(() => {
    if (!C.isRacing || !C.isRacing()) return;
    let best = null;
    for (const r of C.rivals) if (r.lastSay && r.lastSay.t > seen && (!best || r.lastSay.t > best.lastSay.t)) best = r;
    if (!best) return;
    seen = best.lastSay.t;
    if (performance.now() - seen < 1500) showToast(`${best.name}: "${best.lastSay.text}"`);
  }, 200);
}
