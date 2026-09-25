// RideRash — the race island: one place for everything the game tells you.
//
// The old warning was a single line of thin red capitals that blinked on and
// off, the same colour for "NEAR MISS" as for "WIPEOUT", and the last message
// written in a frame won -- a CONTACT could bury a COLLARED. Mid-race the
// player reads it out of the corner of the eye, and peripheral vision reads
// COLOUR, CONTRAST and MOTION, not fine type; nor can it rank twelve messages
// that all look alike.
//
// So, in the manner of a phone's dynamic island:
//   - a dark glass pill, top centre, that MORPHS (spring-eased width and
//     height) between a compact state and an expanded one
//   - COMPACT carries ongoing state (a live activity): the cop on your tail
//     and how close; nothing at all when there is nothing to say
//   - EXPANDED carries an event: an icon, a title and an optional sub-line,
//     tinted by TONE, so the colour alone says good / bad / heads-up
//   - events are RANKED: danger pre-empts a heads-up, a heads-up waits behind
//     danger; repeats bump a x2 counter instead of re-animating; stale queued
//     messages are dropped rather than shown late
//   - being COLLARED is a live activity with a break-free meter, because the
//     answer (mash) and the progress are the whole moment
//
// Text in: the same strings the game always wrote to state.warn, classified
// here, so no call site had to change.

const ICON = {
  danger: '<path d="M12 3 2 21h20L12 3Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v5M12 18v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  cop: '<rect x="4" y="9" width="16" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 9V6h6v3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="18" r="1.6" fill="currentColor"/><circle cx="16" cy="18" r="1.6" fill="currentColor"/>',
  animal: '<circle cx="7" cy="9" r="2" fill="currentColor"/><circle cx="12" cy="6.5" r="2" fill="currentColor"/><circle cx="17" cy="9" r="2" fill="currentColor"/><path d="M12 12c-3.5 0-6 3.4-6 5.6 0 1.6 1.4 2.4 3 2.4 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.6 0 3-.8 3-2.4C18 15.4 15.5 12 12 12Z" fill="currentColor"/>',
  hit: '<path d="m12 2 2.2 6.3L21 7l-4.4 5L21 17l-6.8-1.3L12 22l-2.2-6.3L3 17l4.4-5L3 7l6.8 1.3L12 2Z" fill="currentColor"/>',
  good: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  fist: '<path d="M7 11V8.5a1.5 1.5 0 0 1 3 0V11m0-1.5V7.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v1.5m0-.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1.5A5.5 5.5 0 0 1 5 14.5V12a1.5 1.5 0 0 1 2-1.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="currentColor"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  flag: '<path d="M5 21V4m0 0h12l-2.5 4L17 12H5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  slick: '<path d="M12 3c3 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.8 6-11Z" fill="currentColor"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ICON.info}</svg>`;

// tone -> priority and how long an event holds the island (s)
const TONE = {
  count:  { pri: 5, hold: 0.9 },
  danger: { pri: 4, hold: 1.7 },
  warn:   { pri: 3, hold: 1.3 },
  good:   { pri: 2, hold: 1.4 },
  info:   { pri: 1, hold: 1.0 },
};

// [pattern, tone, icon] -- first match wins
const RULES = [
  [/^\d$|^GO$/, 'count', 'flag'],
  [/COLLARED|PULLING YOU OVER|^COPS!|BUSTED/, 'danger', 'cop'],
  [/^GRABBED!|YOU GOT THROWN/, 'danger', 'fist'],
  [/^(COW|DEER|MOOSE)!|^HIT A /, 'danger', 'animal'],
  [/ONCOMING|WIPEOUT|T-BONED$|^DOWN$|WENT DOWN|PARKED CAR|^OVER THE EDGE/, 'danger', 'danger'],
  [/YOU PUT .* OVER THE EDGE|COP WENT OVER/, 'good', 'fist'],
  [/WENT OVER THE EDGE/, 'warn', 'danger'],
  [/^OIL/, 'danger', 'slick'],
  [/GRAVEL/, 'warn', 'slick'],
  [/BUMPED A |CAR HIT A /, 'warn', 'animal'],
  [/SIDE-SWIPE|^BUMP$|SCRAPE|CONTACT|HARD LANDING/, 'warn', 'hit'],
  [/LOST YOUR CHAIN|DISARMED|SLIPPED THE GRIP/, 'warn', 'fist'],
  [/WANTS HIS PLACE BACK/, 'warn', 'fist'],
  [/RIVAL (HIT TRAFFIC|T-BONED)/, 'info', 'hit'],
  [/COP DOWN|LOST THE COP|COP TAKEDOWN/, 'good', 'cop'],
  [/TOOK OUT|THROWN!|GOT HIS CHAIN|GRABBED HIM|BROKE FREE|LOST HIS GRIP/, 'good', 'fist'],
  [/NEAR MISS|LEADING|REMOUNT|CLEAN LINE|BIG AIR|OVERTAKE/, 'good', 'good'],
  [/BOOST/, 'info', 'bolt'],
  [/SLIPSTREAM/, 'info', 'wind'],
];

function classify(text, touch) {
  let t = String(text).trim();
  // "TITLE — sub" or "TITLE! MASH J K L": a title and a sub-line
  let title = t, sub = '';
  const dash = t.split(/\s+—\s+/);
  if (dash.length > 1) { title = dash[0]; sub = dash.slice(1).join(' — '); }
  else {
    const m = t.match(/^(.*?!)\s+(MASH .*)$/);
    if (m) { title = m[1]; sub = m[2]; }
  }
  if (touch) sub = sub.replace(/MASH J K L!?/, 'MASH THE ATTACK BUTTONS').replace(/G TO THROW/, 'GRAB AGAIN TO THROW');
  let tone = 'info', icon = 'info';
  for (const [re, tn, ic] of RULES) if (re.test(t)) { tone = tn; icon = ic; break; }
  return { key: t, title, sub, tone, icon };
}

export class Island {
  constructor(host) {
    this.el = document.createElement('div');
    this.el.id = 'island';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = '<div class="is-in"><span class="is-ic"></span><span class="is-tx"><b class="is-t"></b><small class="is-s"></small></span><i class="is-n"></i></div><div class="is-bar"><i></i></div>';
    host.appendChild(this.el);
    this.ic = this.el.querySelector('.is-ic');
    this.tt = this.el.querySelector('.is-t');
    this.st = this.el.querySelector('.is-s');
    this.nn = this.el.querySelector('.is-n');
    this.bar = this.el.querySelector('.is-bar i');
    this.cur = null;       // the event showing: {key, title, sub, tone, icon, t, n}
    this.queue = [];       // waiting events, each with an age
    this.live = {};        // ongoing state from the game: { cop: m | null, collar: 0..1 | null }
    this._shown = '';      // what the DOM holds, so it is only rewritten on change
  }

  /** Messages this frame, in the order they were written. */
  push(list) {
    this._frame = (this._frame || 0) + 1;          // one push per HUD frame
    if (!list || !list.length) return;
    const touch = document.body.classList.contains('touch');
    for (const raw of list) {
      const e = classify(raw, touch);
      if (this.cur && this.cur.key === e.key) {
        // the same thing again. Written again within 0.3 s it is the SAME
        // moment still going (the countdown writes every frame): just hold it.
        // Later than that it is a new one: count it (x2, x3).
        // (at any frame rate: written on the previous frame counts as "still")
        const still = this.cur.since < 0.3 || this._frame - (this.cur.frame ?? -9) <= 1;
        if (!still && e.tone !== 'count' && e.tone !== 'info') this.cur.n++;   // states (tow, air) do not count
        this.cur.since = 0; this.cur.frame = this._frame;
        this.cur.t = Math.max(this.cur.t, TONE[e.tone].hold * 0.7);
        this._bumped = true;
        continue;
      }
      const q = this.queue.find((x) => x.key === e.key);
      if (q) { q.age = 0; continue; }                   // still pending: keep it fresh, do not count
      e.t = TONE[e.tone].hold + Math.min(0.6, e.title.length * 0.02);
      e.n = 1; e.age = 0; e.since = 0; e.frame = this._frame;
      if (!this.cur || TONE[e.tone].pri >= TONE[this.cur.tone].pri) {
        if (this.cur && this.cur.t > 0.25 && TONE[this.cur.tone].pri >= 3) { this.cur.age = 0; this.queue.unshift(this.cur); }
        this.cur = e;
      } else this.queue.push(e);
    }
    this.queue.sort((a, b) => TONE[b.tone].pri - TONE[a.tone].pri);
    this.queue.length = Math.min(this.queue.length, 3);
  }

  setLive(live) { this.live = live || {}; }

  /** New race: nothing from the last one (or from the menus) carries over. */
  clear() { this.cur = null; this.queue = []; this.live = {}; this._shown = ''; this.el.className = ''; }

  update(dt) {
    for (const q of this.queue) q.age += dt;
    this.queue = this.queue.filter((q) => q.age < 1.4);   // late news is no news
    if (this.cur) { this.cur.since = (this.cur.since || 0) + dt; this.cur.t -= dt; if (this.cur.t <= 0) this.cur = this.queue.shift() || null; }

    // what to show: the collar outranks everything; then an event; then the
    // compact live state; else nothing
    const L = this.live;
    let view;
    if (L.collar != null) {
      view = { mode: 'x', tone: 'danger', icon: 'cop', title: 'PULLING YOU OVER',
        sub: document.body.classList.contains('touch') ? 'MASH THE ATTACK BUTTONS' : 'MASH J K L', bar: Math.max(0, Math.min(1, L.collar)), key: 'collar' };
    } else if (this.cur && !(L.cop != null && this.cur.tone === 'info')) {   // a cop on you outranks the tow/air states
      view = { mode: this.cur.tone === 'count' ? 'c' : 'x', ...this.cur };
    } else if (L.cop != null) {
      view = { mode: 's', tone: 'danger', icon: 'cop', title: L.cop < 8 ? 'COP ON YOU' : `COP ${L.cop} M`, sub: '', key: 'cop:' + (L.cop < 8 ? 'on' : Math.round(L.cop / 5)) };
    } else view = null;

    const el = this.el;
    if (!view) { if (this._shown !== '') { el.className = ''; this._shown = ''; } return; }
    const sig = view.mode + '|' + view.key + '|' + (view.n || 1);
    if (sig !== this._shown) {
      const fresh = !this._shown.includes('|' + view.key + '|');
      this._shown = sig;
      this.ic.innerHTML = svg(view.icon);
      this.tt.textContent = view.title;
      this.st.textContent = view.sub || '';
      this.nn.textContent = view.n > 1 ? '×' + view.n : '';
      el.className = `on m-${view.mode} t-${view.tone}${view.sub ? ' has-sub' : ''}${view.bar != null ? ' has-bar' : ''}`;
      // MORPH: the pill takes the width of what it now holds (the CSS eases it)
      const inner = this.el.firstChild;
      inner.classList.remove('fade'); void inner.offsetWidth; inner.classList.add('fade');
      el.style.width = Math.ceil(inner.offsetWidth) + 'px';
      // a new danger event lands with a jolt; everything else just morphs
      if (fresh && (view.tone === 'danger' || view.tone === 'count')) {
        el.classList.remove('jolt'); void el.offsetWidth; el.classList.add('jolt');
      }
    }
    if (view.bar != null) this.bar.style.transform = `scaleX(${view.bar})`;
    this.el.classList.toggle('pulse', view.mode === 's' && L.cop != null && L.cop < 20);
  }
}
