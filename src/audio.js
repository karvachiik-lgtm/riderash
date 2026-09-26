// RideRash — audio. Engine pitch tracks revs, impacts fire on hits, tyre scrape
// follows how hard you are leaning and whether you are off the road, and a
// generated rock loop plays under the race.
//
// The files live in ./assets/audio/ INSIDE the game folder, loaded by relative
// path, so the folder can be zipped and hosted anywhere. A path that reaches
// above the game directory works in the harness and 404s on deploy — traps.md
// names that one, and the smell of it is a game that plays locally and is silent
// on a host.
//
// THE BUS LAYOUT. Every source routes through one of two buses, and both through
// a master gain:
//
//     engine, scrape, one-shots --> sfx   --\
//                                            +--> master --> destination
//     music loop                 --> music --/
//
// Before this, one-shots went straight to the destination, so M muted the
// engine and left every punch, crash and horn at full volume. Mute, volume and
// pause now each act in exactly one place.
import { renderMusic } from './music.js';

// Per-sample loudness trims, so the `amp` a caller passes means roughly the
// same loudness whatever file it names. Measured on the decoded files (RMS
// over the sounding part): horn -2.7 dBFS (a near-square wave -- the loudest
// thing in the game at amp 0.55), boost -11.5, crash -15.7, skid -10.7,
// swing -19.0, impact -16.5 (but only ~40 ms long, so it reads quieter).
const HORN_MAX_S = 2.0;       // no single horn blast sounds longer than this
const TRIM = { horn: 0.42, boost: 0.8, skid: 0.8, swing: 0.9, crash: 1.0, impact: 1.0, shift: 0.45,
  // finish stings (Atlas ElevenLabs SFX, measured below): cheer -14.3,
  // stinger -23.6 (a hit and a ringing chord), fail -10.2 dB active RMS.
  cheer: 0.6, stinger: 1.8, fail: 0.5 };
const MUSIC_TRIM = 0.56;         // -5.0 dB, see the bus comment in _init

// First sample within 20 dB of the peak, less 4 ms of pre-roll. impact.mp3
// opens with 307 ms of silence: every punch was heard a third of a second
// after it landed.
function onsetOf(buf) {
  const d = buf.getChannelData(0);
  let pk = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
  const th = pk * 0.1;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > th) return Math.max(0, i / buf.sampleRate - 0.004);
  }
  return 0;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.buffers = {};
    this.offsets = {};          // per-buffer start offset: leading silence, measured at load
    this.nodes = {};
    this.muted = false;
    this.volume = { master: 0.8, sfx: 1.0, music: 0.55 };
    this._initP = null;
    this._musicWant = null;     // 'race' | 'menu' | null, applied once the loop exists
    // harness: the mix probe taps nodes.master / nodes.limiter / the buses
    if (typeof window !== 'undefined') window.__AUDIO__ = this;
  }

  // Must be called from a user gesture: browsers refuse to start audio otherwise,
  // and a game that begins with silence because of it reads as broken. Idempotent
  // and re-entrant: every gesture handler may call it, only the first builds.
  init() {
    if (!this._initP) this._initP = this._init();
    else this.wake();
    return this._initP;
  }

  /**
   * Bring the context back unless WE paused it. Checks `!== 'running'`, not
   * `=== 'suspended'`: iOS Safari parks the context in a NON-STANDARD
   * 'interrupted' state after a phone call, Siri or an app switch, and a
   * suspended-only check leaves the game silent for the rest of the session
   * (WebAudio/web-audio-api#2585). Called from statechange, page return and the
   * next touch -- iOS will only honour some of those without a fresh gesture.
   */
  wake() {
    const c = this.ctx;
    if (!c || this.paused || c.state === 'running' || c.state === 'closed') return;
    c.resume().catch(() => {});
  }

  _bindWake() {
    const w = () => this.wake();
    this.ctx.addEventListener?.('statechange', () => {
      if (this.ctx.state === 'interrupted') setTimeout(w, 250);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) w(); });
    addEventListener('pageshow', w);
    addEventListener('focus', w);
    for (const ev of ['touchend', 'pointerup', 'keydown']) addEventListener(ev, w, { passive: true });
  }

  async _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this._bindWake();
    try { await this.ctx.resume(); } catch (e) { /* user gesture pending */ }

    const c = this.ctx;
    this.nodes.master = c.createGain();
    // A gentle limiter on the master, so six simultaneous impacts over the
    // engine and the music cannot clip the output into a crackle.
    // Measured (mix probe, 2026-09): the old -6 dB / 8:1 / 3 ms setting let a
    // wipeout stack reach -0.2 dBFS out of +0.7 in. Chrome's compressor adds
    // automatic makeup gain derived from threshold and ratio, so a harder knee
    // and higher ratio both catch the peak AND add less lift to the bed.
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -5; lim.knee.value = 2; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.15;
    this.nodes.master.connect(lim).connect(c.destination);
    this.nodes.limiter = lim;
    this.nodes.sfx = c.createGain();
    this.nodes.music = c.createGain();
    // Internal bus trims, BELOW the player's sliders so the settings keep their
    // meaning. Measured at cruise with slider defaults: the music bus sat at
    // -23.0 dB RMS and the whole SFX bus at -24.8 -- the band was louder than
    // the bike. The target is music ~6 dB under the SFX bed.
    this.nodes.musicTrim = c.createGain(); this.nodes.musicTrim.gain.value = MUSIC_TRIM;
    // Ducker: a heavy hit pulls the music down a few dB for a beat, so the
    // impact lands on top instead of inside the guitars.
    this.nodes.duck = c.createGain(); this.nodes.duck.gain.value = 1;
    this.nodes.sfx.connect(this.nodes.master);
    this.nodes.music.connect(this.nodes.musicTrim).connect(this.nodes.duck).connect(this.nodes.master);
    this._applyVolumes(true);

    const load = async (name, url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const buf = await res.arrayBuffer();
        this.buffers[name] = await c.decodeAudioData(buf);
        this.offsets[name] = onsetOf(this.buffers[name]);
      } catch (e) {
        console.warn(`[riderash] audio ${name} failed:`, e.message);
      }
    };
    await Promise.all([
      load('engine', './assets/audio/engine.mp3'),
      load('impact', './assets/audio/impact.mp3'),
      load('scrape', './assets/audio/scrape.mp3'),
      // Generated with Atlas audio_sfx. Audio is not covered by the no-mesh,
      // no-download rule -- that is about geometry -- and the project already
      // shipped three of these. A racer with one impact sound reads unfinished.
      load('crash', './assets/audio/crash.mp3'),
      load('swing', './assets/audio/swing.mp3'),
      load('horn', './assets/audio/horn.mp3'),
      load('skid', './assets/audio/skid.mp3'),
      // Atlas audio_sfx (ElevenLabs SFX v2), RideRash Audio project. Measured
      // before use: shift is a ~260 Hz transient gone in 60 ms (an exhaust pop),
      // boost swells then fades with a hiss-heavy spectrum. A third, "passby",
      // was rejected -- its energy was all in the first 60 ms, an impact rather
      // than an approach -- and the Doppler'd rival engine covers passing.
      load('shift', './assets/audio/shift.mp3'),
      load('boost', './assets/audio/boost.mp3'),
      // Finish stings, Atlas audio_sfx (ElevenLabs), measured before use and
      // trimmed/faded with ffmpeg. The captions came back wrong (the fail sting
      // was described as "bright, celebratory"), so they were checked by
      // measurement: cheer is broadband, aperiodic (autocorr < 0.31, centroid
      // 1.7 kHz), swells from -22 to -11 dB in 0.8 s; stinger is tonal
      // (autocorr 0.5-0.87), ~170 Hz then ~410-540 Hz partials over a 16 dB/s
      // exponential decay from a hard onset; fail steps DOWN from ~750 Hz to a
      // sagging ~490 Hz (-0.6 st droop) and ends near 292 Hz, over an octave
      // below where it began. All three sound from their first 10 ms.
      // The one-wheeler's own voices, Atlas audio_sfx (ElevenLabs SFX v2),
      // project "RideRash monowheel concept": 6 s generations cut to a steady
      // 4.5 s with a 0.5 s equal-power seam and normalised. MEASURED: the V-twin
      // fires at ~88 Hz, steady RMS 0.19; the hub motor is a clean whine with
      // partials at ~623 and ~1308 Hz.
      load('monoVtwin', './assets/audio/mono_vtwin.mp3'),
      load('monoMotor', './assets/audio/mono_ev_motor.mp3'),
      load('cheer', './assets/audio/cheer.mp3'),
      load('stinger', './assets/audio/stinger.mp3'),
      load('fail', './assets/audio/fail.mp3'),
    ]);

    // --- engine: a looping source whose playback rate and gain track the revs ---
    if (this.buffers.engine) {
      const src = c.createBufferSource();
      src.buffer = this.buffers.engine;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1600;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.nodes.sfx);
      src.start(0);
      this.nodes.engine = { src, filter, gain };
    }
    // the one-wheeler's engine and motor: loops that run silent until used
    const loopNode = (buf, type, freq) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const filter = c.createBiquadFilter(); filter.type = type; filter.frequency.value = freq;
      const gain = c.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.nodes.sfx); src.start(0);
      return { src, filter, gain };
    };
    if (this.buffers.monoVtwin) this.nodes.monoEngine = loopNode(this.buffers.monoVtwin, 'lowpass', 1800);
    if (this.buffers.monoMotor) this.nodes.monoMotor = loopNode(this.buffers.monoMotor, 'lowpass', 5000);

    // --- rival engine: the same loop, panned and Doppler-shifted for whoever is
    // closest. One voice, not six: the ear tracks the nearest bike, and six
    // detuned copies of one sample phase against each other into a drone.
    if (this.buffers.engine) {
      const src = c.createBufferSource();
      src.buffer = this.buffers.engine;
      src.loop = true;
      src.loopStart = 0.37;              // offset from the player's loop so they never phase-lock
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      src.connect(filter).connect(gain);
      if (pan) gain.connect(pan).connect(this.nodes.sfx); else gain.connect(this.nodes.sfx);
      src.start(0, 0.37);
      this.nodes.rival = { src, filter, gain, pan };
    }

    // --- wind: band-passed noise, gain with the SQUARE of speed (drag is v^2,
    // and so is what you hear in a helmet). This is most of the sense of speed
    // at 90 mph; the engine alone sounds the same at 50 and at 100.
    {
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 500; filter.Q.value = 0.7;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.nodes.sfx);
      src.start(0);
      this.nodes.wind = { src, filter, gain };
    }
    this._gear = 1;
    this._shiftT = 0;

    // --- scrape: continuous, gain follows lean and off-road state ---
    if (this.buffers.scrape) {
      const src = c.createBufferSource();
      src.buffer = this.buffers.scrape;
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.nodes.sfx);
      src.start(0);
      this.nodes.scrape = { src, gain };
    }

    // --- brake screech: the sustained middle of the skid sample, looped, gated
    // by how hard the bike is slowing. Hard braking was silent; Road Rash's
    // tyres squeal. Deceleration is measured here, from the speed the game
    // already passes, so no caller has to report the brake.
    if (this.buffers.skid) {
      const src = c.createBufferSource();
      src.buffer = this.buffers.skid;
      src.loop = true; src.loopStart = 0.30; src.loopEnd = 0.95;
      const gain = c.createGain(); gain.gain.value = 0;
      src.connect(gain).connect(this.nodes.sfx);
      src.start(0, 0.30);
      this.nodes.screech = { src, gain };
    }
    this._decel = 0; this._lastV = 0; this._lastT = 0;

    // --- impact: a small bank of one-shots, so several hits can overlap ---
    this.nodes.impactGain = c.createGain();
    this.nodes.impactGain.gain.value = 1.2;
    this.nodes.impactGain.connect(this.nodes.sfx);

    this.ready = true;

    // Music is rendered AFTER the game is audible, so a slow device never holds
    // the engine note back waiting on a synthesiser.
    try {
      this.music = await renderMusic(c.sampleRate);
    } catch (e) {
      console.warn('[riderash] music render failed:', e);
      this.music = null;
    }
    if (this._musicWant) this.playMusic(this._musicWant, true);
  }

  _applyVolumes(immediate = false) {
    if (!this.ctx || !this.nodes.master) return;
    const t = this.ctx.currentTime;
    const set = (node, v) => {
      if (immediate) node.gain.value = v;
      else node.gain.setTargetAtTime(v, t, 0.05);
    };
    set(this.nodes.master, this.muted ? 0 : this.volume.master);
    set(this.nodes.sfx, this.volume.sfx);
    set(this.nodes.music, this.volume.music);
  }

  setVolumes(v = {}) {
    for (const k of ['master', 'sfx', 'music']) {
      if (Number.isFinite(v[k])) this.volume[k] = Math.max(0, Math.min(1, v[k]));
    }
    this._applyVolumes();
  }

  setMuted(m) { this.muted = !!m; this._applyVolumes(); }

  // Pause suspends the whole context: the engine loop, the scrape and the music
  // all stop exactly where they are and resume from there.
  setPaused(p) {
    this.paused = !!p;
    if (!this.ctx) return;
    if (p) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  // Crossfade to one of the generated loops. `name` null fades music out.
  playMusic(name, force = false) {
    this._musicWant = name;
    if (!this.ctx || !this.music) return;
    if (!force && this._musicName === name) return;
    const c = this.ctx, t = c.currentTime;
    const old = this.nodes.musicSrc;
    if (old) {
      old.g.gain.setTargetAtTime(0, t, 0.35);
      try { old.src.stop(t + 2); } catch (e) { /* already stopped */ }
    }
    this.nodes.musicSrc = null;
    this._musicName = name;
    const buf = name && this.music[name];
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, t, 0.5);
    src.connect(g).connect(this.nodes.music);
    src.start(t);
    this.nodes.musicSrc = { src, g };
  }

  // Called every frame with the game's state.
  update(g) {
    if (!this.ready || !this.ctx) return;
    const t = this.ctx.currentTime;

    // engine: a virtual SIX-SPEED GEARBOX. The note used to be one straight
    // line from idle to redline, which is the sound of a vacuum cleaner, not a
    // motorcycle. Revs now climb through each gear and drop at the shift, with
    // hysteresis so a speed sitting on a boundary cannot hunt between gears.
    const e = this.nodes.engine;
    const vmax = g.maxSpeed || 61;
    const sp = Math.max(0, g.speed || 0) / vmax;
    if (e) {
      const TOP = [0, 0.16, 0.30, 0.46, 0.63, 0.82, 1.08];   // gear top speeds, fraction of vmax
      let gear = this._gear;
      if (gear < 6 && sp > TOP[gear] * 0.97) {
        gear++; this._shiftT = t;
        // the pop only under power: an upshift while coasting is silent
        if (!g.silent && g.throttle && (g.engineMix ?? 1) > 0.5) this.oneShot('shift', 0.35 + gear * 0.04, 0.92 + Math.random() * 0.16);
      }
      else if (gear > 1 && sp < TOP[gear - 1] * 0.80) gear--;
      this._gear = gear;
      const lo = TOP[gear - 1] * 0.55, hi = TOP[gear];
      const rpm = Math.max(0, Math.min(1, (sp - lo) / (hi - lo)));
      // a brief dip in the first 90 ms after an upshift: the clutch
      const shifting = t - this._shiftT < 0.09;
      // (enginePitch: a machine's own voice -- the one-wheeler is higher-strung)
      const rate = (0.60 + rpm * 1.15 + (gear - 1) * 0.04 - (shifting ? 0.12 : 0)) * (g.enginePitch || 1);
      // the one-wheeler (g.voice 'mono') speaks with its own V-twin
      const me = this.nodes.monoEngine, useMono = g.voice === 'mono' && !!me;
      e.src.playbackRate.setTargetAtTime(rate, t, shifting ? 0.02 : 0.05);
      if (me) me.src.playbackRate.setTargetAtTime(rate / (g.enginePitch || 1) * 0.95, t, shifting ? 0.02 : 0.05);
      // off the throttle the engine note falls back: overrun, not drive
      const load = g.throttle === undefined ? 1 : 0.55 + 0.45 * Math.max(0, g.throttle);
      // +4.5 dB at cruise, +5.6 dB at idle over the old curve: the engine was
      // 2.5 dB over the wind and buried under the music on the grid.
      const want = g.silent ? 0 : (0.115 + rpm * 0.16 + sp * 0.09) * load * (g.engineMix ?? 1);
      e.gain.gain.setTargetAtTime(useMono ? 0 : want, t, 0.06);
      e.filter.frequency.setTargetAtTime(800 + rpm * 2200 + sp * 1200, t, 0.08);
      if (me) {
        me.gain.gain.setTargetAtTime(useMono ? want * 0.85 : 0, t, 0.06);
        me.filter.frequency.setTargetAtTime(900 + rpm * 2600 + sp * 1400, t, 0.08);
      }
    }

    // THE ELECTRIC MOTOR (EV / hybrid one-wheeler): no gears, so one rising
    // note locked to the wheel speed -- a sawtooth fundamental through a band
    // filter, plus the inverter's high whine at ~2.9x -- louder under load.
    // Synthesised, so it costs no download and never loops audibly.
    const mm = this.nodes.monoMotor;
    if (mm) {
      // the sampled hub motor: one gear, pitch locked to wheel speed (its
      // ~623 Hz partial runs from ~220 Hz at a standstill to ~1.1 kHz at 50 m/s)
      const v = Math.max(0, g.speed || 0);
      mm.src.playbackRate.setTargetAtTime(0.35 + v * 0.028, t, 0.05);
      const load = g.throttle ? 1 : 0.4;
      const want = g.silent ? 0 : (g.motor || 0) * (0.05 + 0.10 * load * Math.min(1, v / 6) + Math.min(1, v / 50) * 0.05);
      mm.gain.gain.setTargetAtTime(want, t, 0.07);
    } else if ((g.motor || 0) > 0 || this.nodes.motor) {
      const m = this.nodes.motor || (this.nodes.motor = this._makeMotor());
      const v = Math.max(0, g.speed || 0);
      const f = 55 + v * 15;
      m.o1.frequency.setTargetAtTime(f, t, 0.05);
      m.o2.frequency.setTargetAtTime(f * 2.9, t, 0.05);
      m.bp.frequency.setTargetAtTime(f * 1.8, t, 0.08);
      const load = g.throttle ? 1 : 0.35;
      const want = g.silent ? 0 : (g.motor || 0) * (0.035 + 0.075 * load * Math.min(1, v / 6) + Math.min(1, v / 50) * 0.04);
      m.gain.gain.setTargetAtTime(want, t, 0.07);
    }

    const w = this.nodes.wind;
    if (w) {
      // capped 0.15 (was 0.20): wind now sits ~8 dB under the engine at cruise
      // instead of 2.5 dB, so it is speed you feel without masking the revs.
      const want = g.silent ? 0 : Math.min(0.15, sp * sp * 0.15);
      w.gain.gain.setTargetAtTime(want, t, 0.15);
      w.filter.frequency.setTargetAtTime(350 + sp * 900, t, 0.2);
    }

    // rival: nearest bike. `rival.closing` > 0 means it is approaching: the
    // Doppler ratio c/(c - v) raises the pitch as it comes and drops it as it
    // goes, which is the one sound that says "overtaken" without looking.
    const r = this.nodes.rival;
    if (r) {
      const rv = g.rival;
      if (!rv || g.silent || !(rv.dist < 60)) {
        r.gain.gain.setTargetAtTime(0, t, 0.12);
      } else {
        const C = 343;
        const dopp = C / (C - Math.max(-60, Math.min(60, rv.closing || 0)));
        const rrev = Math.min(1, (rv.speed || 0) / vmax);
        r.src.playbackRate.setTargetAtTime((0.62 + rrev * 1.05) * dopp, t, 0.05);
        const near = 1 / (1 + (rv.dist / 6) ** 2);
        r.gain.gain.setTargetAtTime(0.16 * near, t, 0.06);
        r.filter.frequency.setTargetAtTime(600 + near * 2600, t, 0.08);
        if (r.pan) r.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, rv.pan || 0)), t, 0.05);
      }
    }

    // screech: smoothed deceleration in m/s^2. Coasting at the top end is
    // ~2.7 (drag); the threshold sits well above it.
    const v = Math.max(0, g.speed || 0), dtv = t - this._lastT;
    if (dtv > 0.001 && dtv < 0.25) {
      const dec = (this._lastV - v) / dtv;
      this._decel += (Math.max(-20, Math.min(40, dec)) - this._decel) * Math.min(1, dtv * 6);
    }
    this._lastV = v; this._lastT = t;
    const sc = this.nodes.screech;
    if (sc) {
      const hard = Math.max(0, Math.min(1, (this._decel - 7) / 10));
      const want = (g.silent || g.down || g.offRoad || v < 8) ? 0 : hard * Math.min(1, v / 25) * 0.16;
      sc.gain.gain.setTargetAtTime(want, t, 0.06);
      sc.src.playbackRate.setTargetAtTime(0.85 + Math.min(1, v / vmax) * 0.3, t, 0.1);
    }

    // scrape: hard lean on tarmac, or any speed off it
    const s = this.nodes.scrape;
    if (s) {
      const lean = Math.abs(g.lean || 0);
      let want = 0;
      if (g.offRoad && g.speed > 4) want = Math.min(0.22, g.speed / 61 * 0.22);
      else if (lean > 0.25 && g.speed > 12) want = Math.min(0.10, (lean - 0.25) * 0.30);
      // a downed rider is all scrape
      if (g.down && g.speed > 3) want = 0.26;
      if (g.silent) want = 0;
      s.gain.gain.setTargetAtTime(want, t, 0.07);
      s.src.playbackRate.setTargetAtTime(0.9 + Math.min(1, g.speed / 61) * 0.5, t, 0.1);
    }
  }

  _makeMotor() {
    const c = this.ctx;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 170;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.8; bp.frequency.value = 200;
    const gain = c.createGain(); gain.gain.value = 0;
    o1.connect(bp); o2.connect(g2).connect(bp);
    bp.connect(gain).connect(this.nodes.sfx);
    o1.start(); o2.start();
    return { o1, o2, bp, gain };
  }

  /**
   * The police siren, synthesised: a square wave through a low-pass, its pitch
   * swept by a slow triangle LFO between ~650 and ~1450 Hz -- the American
   * "wail". Synthesised rather than sampled so it loops with no seam and costs
   * no download. `level` 0 fades it out; `pan` -1..1 places it.
   */
  siren(level = 0, pan = 0) {
    if (!this.ready || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    if (!this.nodes.siren) {
      if (level <= 0) return;
      const osc = c.createOscillator(); osc.type = 'square'; osc.frequency.value = 1050;
      const lfo = c.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 0.42;
      const depth = c.createGain(); depth.gain.value = 400;
      lfo.connect(depth).connect(osc.frequency);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const gain = c.createGain(); gain.gain.value = 0;
      const pn = c.createStereoPanner ? c.createStereoPanner() : null;
      osc.connect(lp).connect(gain);
      if (pn) gain.connect(pn).connect(this.nodes.sfx); else gain.connect(this.nodes.sfx);
      osc.start(); lfo.start();
      this.nodes.siren = { gain, pn };
    }
    const sn = this.nodes.siren;
    this._sirenAt = level > 0 ? performance.now() : 0;
    if (level > 0 && !this._sirenDog) {
      // WATCHDOG. The chase refreshes the wail every frame; a code path that
      // stops calling siren() (a restart mid-chase, a map with no cop, a frame
      // that threw) must not leave it wailing for the rest of the session.
      this._sirenDog = setInterval(() => {
        if (this._sirenAt && performance.now() - this._sirenAt > 500) this.siren(0);
        if (!this._sirenAt) { clearInterval(this._sirenDog); this._sirenDog = null; }
      }, 250);
    }
    // 0.095 (was 0.07): measured, the old level put the wail at the engine's
    // own level; this sits it ~3 dB over the bike and still under the horn.
    sn.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.095, t, 0.12);
    if (sn.pn) sn.pn.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, pan)), t, 0.06);
  }

  // Engine and scrape to silence, for the title and results screens.
  idle() { this.update({ speed: 0, silent: true }); this.siren(0); this.stopHorns(); }

  /**
   * One-shot from any loaded buffer. `impact()` predates this and is kept
   * because it carries the per-attack mix; everything new goes through here.
   *
   * A missing buffer is a silent no-op rather than a throw: a sound that failed
   * to decode must not take down the frame it was supposed to decorate.
   */
  oneShot(name, amp = 1, rate = 1) {
    if (!this.ready || !this.ctx || !this.buffers[name]) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    const g = this.ctx.createGain();
    const a = Math.max(0.05, Math.min(1.2, amp));
    g.gain.value = a * (TRIM[name] ?? 1);
    src.playbackRate.value = Math.max(0.5, Math.min(2.0, rate));
    src.connect(g).connect(this.nodes.impactGain);
    src.start(0, this.offsets[name] || 0);
    if (name === 'crash') this._duck(a);
    if (name === 'horn') this._trackHorn(src, g);
    return src;
  }

  /**
   * HORNS NEVER OUTSTAY THEIR WELCOME. A horn is a short blast: at most two
   * sound at once (a third steals the oldest), each is hard-stopped after
   * HORN_MAX_S whatever its buffer or rate, and stopHorns() cuts them all when
   * the race stops, restarts or pauses.
   */
  _trackHorn(src, g) {
    const hs = this._horns || (this._horns = []);
    hs.push({ src, g });
    src.onended = () => { const i = hs.findIndex((h) => h.src === src); if (i >= 0) hs.splice(i, 1); };
    while (hs.length > 2) this._killHorn(hs.shift());
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t + HORN_MAX_S - 0.08);
    g.gain.linearRampToValueAtTime(0.0001, t + HORN_MAX_S);
    try { src.stop(t + HORN_MAX_S + 0.02); } catch (e) { /* already stopped */ }
  }
  _killHorn(h) {
    const t = this.ctx.currentTime;
    try { h.g.gain.cancelScheduledValues(t); h.g.gain.setTargetAtTime(0, t, 0.02); h.src.stop(t + 0.1); } catch (e) { /* already stopped */ }
  }
  stopHorns() {
    if (!this.ctx || !this._horns) return;
    for (const h of this._horns.splice(0)) this._killHorn(h);
  }

  impact(intensity = 1, kind = 'hit') {
    if (!this.ready || !this.ctx || !this.buffers.impact) return;
    // chain and kick read heavier than a punch
    const base = kind === 'chain' ? 1.0 : kind === 'kick' ? 0.85 : 0.62;
    const amp = Math.max(0.08, Math.min(1.0, base * intensity));
    // ONE BLOW, ONE SOUND. A landed player hit reaches here twice in the same
    // frame (combat.js fires onHitImpact from applyDamage AND onHit, and
    // main.js plays an impact from both). Two copies of one sample started
    // together sum coherently: +6 dB, which put a kick at +9 dBFS into the
    // limiter and ducked the whole mix ~8 dB. Within 30 ms, keep the louder.
    const now = this.ctx.currentTime, L = this._lastImpact;
    if (L && now - L.t < 0.03 && L.kind === kind) {
      if (amp > L.amp) { L.amp = amp; L.g.gain.value = amp * TRIM.impact; }
      return L.src;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.impact;
    const g = this.ctx.createGain();
    this._lastImpact = { t: now, g, amp, src, kind };
    g.gain.value = amp * TRIM.impact;
    src.playbackRate.value = kind === 'chain' ? 0.82 : kind === 'kick' ? 0.92 : 1.06;
    src.connect(g).connect(this.nodes.impactGain);
    src.start(0, this.offsets.impact || 0);
    this._duck(amp * 0.6);
    return src;
  }

  /**
   * Race result sting. 'win' = rock stinger over a crowd; 'qualify' = the
   * crowd alone, a notch quieter; 'fail' = the sour brass. The music is held
   * down for ~2.5 s so the sting is not fighting the menu loop fading in.
   */
  finish(kind = 'fail') {
    if (!this.ready || !this.ctx) return;
    if (kind === 'win') { this.oneShot('stinger', 1.0, 1.0); this.oneShot('cheer', 1.0, 1.0); }
    else if (kind === 'qualify') this.oneShot('cheer', 0.75, 1.0);
    else this.oneShot('fail', 1.0, 0.94);
    const d = this.nodes.duck, t = this.ctx.currentTime;
    if (d) {
      d.gain.cancelScheduledValues(t);
      d.gain.setValueAtTime(d.gain.value, t);
      d.gain.linearRampToValueAtTime(0.35, t + 0.05);
      d.gain.setValueAtTime(0.35, t + 2.2);
      d.gain.linearRampToValueAtTime(1, t + 3.2);
    }
  }

  // Pull the music down by up to ~5 dB and let it recover over ~0.4 s.
  _duck(strength) {
    const d = this.nodes.duck;
    if (!d) return;
    const t = this.ctx.currentTime;
    const floor = 1 - Math.min(0.45, 0.45 * strength);
    d.gain.cancelScheduledValues(t);
    d.gain.setValueAtTime(Math.min(d.gain.value, 1), t);
    d.gain.linearRampToValueAtTime(Math.min(d.gain.value, floor), t + 0.015);
    d.gain.setTargetAtTime(1, t + 0.12, 0.15);
  }
}
