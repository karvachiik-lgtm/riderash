// RideRash — THE LAST PICTURE: every race ends on something to smile about.
//
// However it ends -- a win, a podium, last place, cuffed on the verge, or at
// the bottom of the valley -- the moment is FROZEN into a photo and dressed as
// the thing it is, with a line to go with it:
//
//   win / podium   a polaroid, a gold tape, confetti on a win
//   loss           a polaroid with a tabloid-style jab
//   bust           a MUGSHOT: height chart behind you, a booking placard with
//                  your name and a charge nobody would write down
//   plunge         a POSTCARD from the valley floor
//
// The photo is a real frame of the game: main.js asks for a snap, and the
// canvas is copied straight after it renders (no preserveDrawingBuffer
// needed). It holds for a beat (Enter / Space / Esc / a tap skips), then stays pinned to the
// results card. Everything here is DOM + a 2D canvas; no assets.

const pick = (a) => a[Math.floor(Math.random() * a.length)];

const LINES = {
  win: [
    'First across the line. Your mother still thinks you work in accounts.',
    '{field} riders tried. {field} riders ate your exhaust.',
    'Champion of {course}. Please return the traffic cones.',
    'Undefeated, unhinged, unbothered.',
    'The trophy is a hubcap. You will treasure it forever.',
  ],
  trial: [
    'One wheel, zero chill. Your chiropractor says hi.',
    'Balance: questionable. Fun: confirmed.',
    'Now you know why nobody sells these.',
    'The garage has a new favourite. The bank account does not.',
  ],
  podium: [
    'Close enough to smell the trophy. It smells like gasoline.',
    'Through to the next round. The bike is held together by spite and zip ties.',
    'Podium! Your knuckles would like a word.',
    'Not first, but first in our hearts. Second in the results.',
  ],
  loss: [
    'Participation award: a sticker and a tetanus shot.',
    'You finished. The bike finished you first.',
    'Look on the bright side: the view from the back is lovely.',
    'Scouts report: great hair, questionable racing line.',
    'Moral victory. The other kind is available next race.',
  ],
  bust: [
    'Resisting a rest',
    'Unlicensed low-altitude flying',
    'Doing 107 in a 55 while punching',
    'Parking on a police officer',
    'Assault with a bicycle chain',
    'Excessive fun in a public place',
    'Aggravated wheelie',
  ],
  ticket: [
    'Operating a motorcycle in a manner best described as "yes"',
    'Excessive enthusiasm, second degree',
    'Failure to yield to common sense',
    'Speeding, fighting, and speeding while fighting',
    'Wearing that jacket at those speeds',
  ],
  ticketSub: [
    'Signed, sealed, and slapped on your visor.',
    'He wrote slowly. On purpose.',
    'Payable in cash, tears, or both.',
  ],
  bustSub: [
    'You have the right to remain silent. You were already screaming.',
    'Bail is set at one (1) bike.',
    'Smile! It is going on the fridge at the station.',
  ],
  plunge: [
    'The view is lovely. The landing, less so.',
    'Wish you were here. Actually, glad you are not.',
    'Gravity 1 · You 0.',
    'Took the scenic route. Straight down.',
  ],
};
const TITLE = { trial: 'TEST RIDE', win: 'WINNER', podium: 'QUALIFIED', loss: 'ALSO RAN', bust: 'BOOKED', ticket: 'TICKETED', plunge: 'GREETINGS FROM THE VALLEY' };

export class EndPhoto {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'endphoto';
    document.body.appendChild(this.el);
    this.img = null;          // the frozen frame, a data URL
    this.card = '';           // the dressed photo's HTML, for the results card
    this.onDone = null;
    this.t = 0; this.hold = 0;
  }

  /** Copy the canvas right after it rendered: a downscaled JPEG. */
  snap(canvas) {
    try {
      const w = 640, h = Math.round(w * canvas.height / canvas.width);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(canvas, 0, 0, w, h);
      this.img = c.toDataURL('image/jpeg', 0.82);
    } catch (e) { this.img = null; }
  }

  /**
   * Show the dressed photo. `kind`: win | podium | loss | bust | plunge.
   * `ctx`: { name, course, field, place }. Calls `done()` after `hold` s of
   * update() time, or at once on skip().
   */
  show(kind, ctx, hold, done) {
    const f = (s) => s.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');
    const img = this.img ? `<img src="${this.img}" alt="">` : '<i class="ep-blank"></i>';
    let html;
    if (kind === 'bust') {
      const charge = pick(LINES.bust);
      html = `<div class="ep ep-mug"><div class="ep-frame">${img}<i class="ep-chart"></i></div>
        <div class="ep-plac"><small>RIDERASH COUNTY SHERIFF · ${f('{course}').toUpperCase()}</small>
        <b>${(ctx.name || 'RIDER').toUpperCase()}</b><span>CHARGE: ${charge.toUpperCase()}</span>
        <em>No. ${String(100000 + Math.floor(Math.random() * 899999))}</em></div>
        <p class="ep-line">${pick(LINES.bustSub)}</p></div>`;
    } else if (kind === 'ticket') {
      // A CITATION: the pad the cop just tore it off, the violation, the fine,
      // his scrawl -- and on a lecture, the FINAL WARNING stamp
      const fine = ctx.fine ? `$${ctx.fine}` : '$0 (FREE RIDE)';
      html = `<div class="ep ep-cite"><div class="ep-cite-h">RIDERASH COUNTY · UNIFORM TRAFFIC CITATION<em>No. ${String(40000 + Math.floor(Math.random() * 59999))}</em></div>
        <div class="ep-cite-b"><div class="ep-frame">${img}</div><div class="ep-cite-f">
        <small>NAME</small><b>${(ctx.name || 'RIDER').toUpperCase()}</b>
        <small>LOCATION</small><b>${f('{course}').toUpperCase()}</b>
        <small>VIOLATION</small><b>${pick(LINES.ticket)}</b>
        <small>FINE</small><b class="ep-fine">${fine}</b>
        <i class="ep-sig"></i></div></div>
        <p class="ep-line">${pick(LINES.ticketSub)}</p>${ctx.final ? '<i class="ep-final">FINAL WARNING</i>' : ''}</div>`;
    } else if (kind === 'plunge') {
      html = `<div class="ep ep-post"><div class="ep-frame">${img}<b class="ep-greet">GREETINGS FROM<br><span>${f('{course}').toUpperCase()}</span></b></div>
        <p class="ep-line">${f(pick(LINES.plunge))}</p><i class="ep-stamp">VALLEY FLOOR<br>POST</i></div>`;
    } else {
      const conf = kind === 'win' ? '<i class="ep-confetti"></i>'.repeat(26) : '';
      html = `<div class="ep ep-pola ep-${kind}"><i class="ep-tape"></i><div class="ep-frame">${img}</div>
        <b class="ep-title">${TITLE[kind]}${ctx.place && kind !== 'trial' ? ` · ${ctx.place}` : ''}</b>
        <p class="ep-line">${f(pick(LINES[kind]))}</p>${conf}</div>`;
    }
    this.card = html;
    this.el.innerHTML = `<i class="ep-flash"></i>${html}<small class="ep-skip">enter / tap</small>`;
    this.el.className = 'on';
    // confetti: each piece its own spot, colour and fall
    this.el.querySelectorAll('.ep-confetti').forEach((c, i) => {
      c.style.left = (4 + Math.random() * 92) + '%';
      c.style.animationDelay = (Math.random() * 0.8) + 's';
      c.style.background = ['#ffd06a', '#ece6d9', '#e0782e', '#8fc1e3', '#b8e08a'][i % 5];
      c.style.transform = `rotate(${Math.random() * 180}deg)`;
    });
    this.t = 0; this.hold = hold; this.onDone = done;
  }

  get active() { return !!this.onDone; }

  update(dt) {
    if (!this.onDone) return;
    this.t += dt;
    if (this.t >= this.hold) this.skip();
  }

  /** Straight on to the results. The photo stays in `card`. */
  skip() {
    const d = this.onDone;
    this.onDone = null;
    this.el.className = '';
    this.el.innerHTML = '';
    if (d) d();
  }

  /** Career over: the bank's stamp slammed across the photo. */
  repossess() {
    if (!this.card) return;
    const i = this.card.lastIndexOf('</div>');
    this.card = this.card.slice(0, i) + '<i class="ep-repo">REPOSSESSED</i><i class="ep-repo-note">The bank took the bike. And the jacket. Keep the helmet, it is dented.</i>' + this.card.slice(i);
  }

  /** The photo, small and pinned, for the results card. */
  pinned() { return this.card ? `<div class="ep-pin">${this.card}</div>` : ''; }

  clear() { this.onDone = null; this.el.className = ''; this.el.innerHTML = ''; this.card = ''; this.img = null; }
}
