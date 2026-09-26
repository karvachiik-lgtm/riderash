// RideRash — THE SOUNDTRACK: a band, not a synthesiser.
//
// The music used to be synthesised at load (music.js): honest, file-free, and
// soulless -- a sine-and-noise rock kit. These are ORIGINAL instrumental
// recordings generated for this game (Atlas; see docs/refs/audio_briefs.md for the
// briefs), in the register of 90s bike-combat racers: a riff-led hard-rock title
// theme, fast hard rock, bluesy stoner rock, double-kick metal and a grungy
// biker groove -- generated with the model's instrumental flag ON (no vocals),
// no artist, song or game imitated.
//
//   title      the menu and the intro flythrough
//   race1..4   one per race, rotated (a course keeps its track across retries)
//   win / bust stingers over the results
//   rev        a V-twin revving away when you press RIDE
//   select     menu confirm (click only)
//
// Loaded after the game is audible, title first; if anything fails to load the
// synthesised loops (music.js) and beds (audio_ext.js) simply stay in charge.
const BASE = './assets/audio/music/';
const FILES = {
  title: 'title.mp3', race1: 'race1.mp3', race2: 'race2.mp3', race3: 'race3.mp3', race4: 'race4.mp3',
  win: 'win.mp3', bust: 'bust.mp3', rev: 'rev.mp3', select: 'select.mp3',
};
const RACES = ['race1', 'race2', 'race3', 'race4'];
const LEVEL = { title: 0.9, race1: 0.8, race2: 0.8, race3: 0.8, race4: 0.8, win: 0.9, bust: 0.9, rev: 0.8, select: 0.4 };

export class Soundtrack {
  constructor(audio, audioExt) {
    this.audio = audio; this.ext = audioExt;
    this.buf = {};
    this.ready = false;
    this._uiBound = false;
  }

  async _load(name) {
    if (this.buf[name]) return this.buf[name];
    const c = this.audio.ctx;
    const res = await fetch(BASE + FILES[name]);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    this.buf[name] = await c.decodeAudioData(await res.arrayBuffer());
    return this.buf[name];
  }

  /** After audio.init(): load the title first (it is heard first), then the rest. */
  async init() {
    const a = this.audio;
    if (!a || !a.ctx) return;
    try {
      await this._load('title');
      a.music = a.music || {};
      a.music.menu = this.buf.title;
      this.ready = true;
      if (a._musicWant === 'menu') a.playMusic('menu', true);
    } catch (e) { console.warn('[soundtrack] title:', e); return; }
    for (const n of ['select', 'rev', 'win', 'bust', ...RACES]) {
      try { await this._load(n); } catch (e) { console.warn('[soundtrack]', n, e); }
    }
    this._patchBeds();
  }

  // the synthesised per-map beds sat UNDER the old loops; under a real band
  // they are mud. While a recorded race track is available they stay silent.
  _patchBeds() {
    const x = this.ext, self = this;
    if (!x || x._stPatched || !x.playBed) return;
    x._stPatched = true;
    const orig = x.playBed.bind(x);
    x.playBed = function (name, force) { return orig(self.hasRace() ? null : name, force); };
    try { x.playBed(null, true); } catch (e) { /* not ready */ }
  }

  hasRace() { return RACES.some((r) => this.buf[r]); }

  /** Choose this race's track (stable per course key) before playMusic('race'). */
  pickRace(key = '') {
    const a = this.audio;
    const have = RACES.filter((r) => this.buf[r]);
    if (!have.length || !a) return;
    let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const name = have[h % have.length];
    a.music = a.music || {};
    if (a.music.race !== this.buf[name]) {
      a.music.race = this.buf[name];
      if (a._musicName === 'race') a.playMusic('race', true);
    }
  }

  /** A one-shot on the music bus (stingers) or the sfx bus (UI, rev). */
  play(name, { music = false, duck = false } = {}) {
    const a = this.audio, b = this.buf[name];
    if (!a || !a.ctx || !b || a.muted) return;
    const c = a.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = b;
    g.gain.value = LEVEL[name] ?? 0.8;
    src.connect(g).connect(music ? a.nodes.music : a.nodes.sfx);
    src.start();
    if (duck && a.nodes.musicSrc) {
      // pull the loop down under the stinger, bring it back after
      const mg = a.nodes.musicSrc.g.gain, t = c.currentTime;
      mg.cancelScheduledValues(t); mg.setValueAtTime(mg.value, t);
      mg.linearRampToValueAtTime(0.15, t + 0.15);
      mg.setValueAtTime(0.15, t + b.duration - 0.4);
      mg.linearRampToValueAtTime(1, t + b.duration + 1.2);
    }
  }

  /** Menu sounds: a confirm on click, the engine on RIDE. (No hover sound: a
   *  tick on every pointer-over was noise, not feedback.) */
  bindUI(root = document) {
    if (this._uiBound) return;
    this._uiBound = true;
    const isBtn = (el) => el && el.closest && el.closest('button, .btn, .map, .bike, select');
    root.addEventListener('click', (e) => {
      const b = isBtn(e.target);
      if (!b) return;
      if (b.id === 'start' || b.id === 'again') this.play('rev');
      else this.play('select');
    }, true);
  }
}
