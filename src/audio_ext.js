// RideRash — audio ADDITIONS. Nothing here removes, replaces or edits any
// sound that src/audio.js already makes: this module is constructed with the
// live `Audio` instance and only ADDS new buffers, new buses, new loops and new
// methods onto it. audio.js keeps its own music, engine, wind, scrape, screech,
// siren and one-shot bank exactly as they were.
//
// Why a separate file rather than more lines in audio.js: the instruction was
// "ADD to it and not remove or edit", and a new module makes that verifiable —
// `git diff src/audio.js` stays empty no matter how far this grows.
//
// WHAT IT ADDS
//   A1  per-map race music beds        (sierra/coastal/valley/peninsula/desert)
//   A2  night + rain beds              (weather-aware beds)
//   A3  countdown beeps 3-2-1-GO       (synthesised, no files)
//   A4  chain rattle loop              gated by a weapon in hand
//   A5  crowd bed                      gated by how much town you are passing
//   A6  impact variants                metal / wood / body, keyed by surface
//   A7  downshift blip                 the gearbox's missing other half
//   A8  rider grunts                   short vocal stubs, keyed by roster id
//   A9  wet-road hiss                  gated by spine wetness
//
// Every buffer is optional: a file that failed to decode is a silent no-op (the
// same contract audio.js's oneShot uses), and every synthesised bed is built in
// an OfflineAudioContext so a slow device never blocks a frame on it.
import { renderBeds, renderBeeps, renderExtras } from './music_ext.js';

const MAP_KEYS = { sierra: 's', coastal: 'c', valley: 'v', peninsula: 'p', desert: 'd' };

// How loud a per-map bed sits under the game's own race loop.
//
// THE MEASUREMENT THAT SET THIS (harness/_audioexttrim2.mjs). The bed was first
// mixed as a second full rock loop, and that is wrong: the base race loop
// already uses the master headroom, so ANY bed level from 0.02 upward pushed the
// limiter harder and the whole mix came out 0.7-1.9 dB QUIETER — the bed cost
// loudness rather than adding music. (At 0.18 the master even clipped at 1.02.)
//
// So the bed is not a second song. It is a per-map AMBIENCE layer that sits far
// below the music, colouring the race without competing for the master. 0.06 is
// the top of the range that stays under the limiter's knee; anything above it
// starts trading the game's own loudness away.
const BED_TRIM = 0.06;

// Trims for the ADDED one-shots, mirroring audio.js's TRIM table. Only new
// names appear here; audio.js's own table is never consulted or mutated.
const EXT_TRIM = {
  chain: 0.7,      // a metallic rattle is loud for its level; sits it back
  crowd: 0.55,     // a bed, not a presence
  wet: 0.5,
  beep: 0.9,
  beepGo: 1.0,
  blip: 0.55,
  impactMetal: 1.0,
  impactWood: 0.9,
  impactBody: 0.8,
};

export class AudioExt {
  /**
   * @param {Audio} audio the live instance created in main.js. NOT replaced,
   *   NOT subclassed: the same object is handed back out of `init()` so main.js
   *   can keep using `audio` for everything it already does.
   */
  constructor(audio) {
    this.audio = audio;
    this.ready = false;
    this.beds = {};            // mapId -> AudioBuffer (race beds)
    this._beds = {};           // mapId -> { src, gain, name } live sources
    this._bedWant = null;
    this._curMap = null;
    this._beeps = null;
    this._beepStep = -1;
    this._lastCount = null;
    this._wet = 0;
    if (typeof window !== 'undefined') window.__AUDIOEXT__ = this;
  }

  /**
   * Called right after audio.init() resolves. Adds the new buses/loops to the
   * EXISTING graph: everything routes into audio.nodes.sfx, so mute, the master
   * volume slider, the limiter and pause all keep working with no changes to
   * audio.js.
   */
  async init() {
    const a = this.audio;
    if (!a) return false;
    // The base layer builds its context asynchronously AND lazily: audio.init()
    // is only called from a real user gesture (__START__ / first pointer). If
    // main.js calls us in the same tick, a.ctx is still null and there is no
    // promise to await yet. So make sure the base init has been KICKED OFF at
    // all — calling init() again is idempotent and returns the same promise —
    // then await it. Nothing here mutates audio.js; we only use its own API.
    if (!a.ctx && typeof a.init === 'function') { try { a.init(); } catch (e) { /* gesture pending */ } }
    if (a._initP) { try { await a._initP; } catch (e) { /* base init failed; nothing to attach to */ } }
    if (!a.ctx || !a.nodes || !a.nodes.sfx) return false;
    if (this.ready) return true;                 // idempotent
    const c = a.ctx;

    // A private sub-bus for the additions, so their collective level can be
    // moved without touching the SFX bus the rest of the game already uses.
    this.nodes = {
      ext: c.createGain(),
      bed: c.createGain(),        // the per-map music beds
      crowd: c.createGain(),
      chain: c.createGain(),
      wet: c.createGain(),
      shot: c.createGain(),
    };
    this.nodes.ext.gain.value = 1;
    // The bed bus is a STATIC unity node; the fade lives on each bed's own
    // source gain. It was 0 here once, which muted every bed at the bus however
    // loud the source was — the per-source fade-to-1 multiplied by a zero.
    // Measured by _audioextmix.mjs, which asserts this node is non-zero while a
    // bed is playing.
    this.nodes.bed.gain.value = 1;
    this.nodes.ext.connect(a.nodes.sfx);
    // The beds are music, so they join the MUSIC bus: volume slider, music duck
    // and the finish-sting duck all apply to them for free.
    this.nodes.bed.connect(a.nodes.music);

    // Optional file-backed one-shots. Each one is an OPTIONAL enrichment: the
    // game must sound complete without any of them. A missing file is therefore
    // expected, not an error — a 404 here is normal and is not logged to the
    // console, because a console full of red for a by-design absence trains
    // everyone to ignore the console. A file that EXISTS but fails to decode is
    // a real problem and IS warned about.
    const loadOptional = async (name, url) => {
      let res;
      try {
        res = await fetch(url);
      } catch (e) {
        return;                                  // offline / file simply absent
      }
      if (!res.ok) return;                       // absent: silent no-op, no warning
      try {
        a.buffers[name] = await c.decodeAudioData(await res.arrayBuffer());
        a.offsets[name] = 0;
      } catch (e) {
        console.warn(`[riderash] audio_ext ${name} present but failed to decode:`, e.message);
      }
    };
    await Promise.all([
      loadOptional('chain', './assets/audio/chain.mp3'),
      loadOptional('crowd', './assets/audio/crowd.mp3'),
      loadOptional('wet', './assets/audio/wet.mp3'),
      loadOptional('blip', './assets/audio/blip.mp3'),
      loadOptional('impactMetal', './assets/audio/impact_metal.mp3'),
      loadOptional('impactWood', './assets/audio/impact_wood.mp3'),
      loadOptional('impactBody', './assets/audio/impact_body.mp3'),
    ]);

    // A4 chain rattle: a loop, gated on a weapon being in hand.
    // A7/A9 fallbacks FIRST, so the loops below have something to build from
    // even when no mp3s exist. Files win where they exist; these cover the gap.
    // Measured requirement: a LOOP must be seamless, and none of the Atlas
    // one-shots looped (edge ratios 300-5000), so these are synthesised.
    try {
      this.extras = await renderExtras(c.sampleRate);
      if (this.extras) {
        if (!a.buffers.wet) a.buffers.wet = this.extras.wet;
        if (!a.buffers.blip) a.buffers.blip = this.extras.blip;
        if (!a.buffers.impactWood) a.buffers.impactWood = this.extras.impactWood;
        if (!a.buffers.impactBody) a.buffers.impactBody = this.extras.impactBody;
      }
    } catch (e) { /* silent */ }

    // A4 chain rattle: a loop, gated on a weapon being in hand.
    if (a.buffers.chain) this.nodes.chainLoop = this._loop(a.buffers.chain, this.nodes.chain, 0.42);
    // A5 crowd bed: a loop, gated by town density.
    if (a.buffers.crowd) this.nodes.crowdLoop = this._loop(a.buffers.crowd, this.nodes.crowd, 0.1);
    // A9 wet hiss: a loop, gated by wetness.
    if (a.buffers.wet) this.nodes.wetLoop = this._loop(a.buffers.wet, this.nodes.wet, 0.9);

    // A3 countdown beeps, synthesised (no files).
    try { this._beeps = await renderBeeps(c.sampleRate); } catch (e) { this._beeps = null; }
    this.nodes.shot.connect(a.nodes.sfx);
    this.nodes.chain.connect(this.nodes.ext);
    this.nodes.crowd.connect(this.nodes.ext);
    this.nodes.wet.connect(this.nodes.ext);

    // A1/A2 per-map beds. Synthesised last so a slow device never holds back
    // the sounds that fire on frame one.
    try { this.beds = await renderBeds(c.sampleRate); } catch (e) { this.beds = {}; }

    this.ready = true;
    // A bed can be requested before init finished (the title screen asks for
    // the menu bed immediately); honour the last request now.
    if (this._bedWant) this.playBed(this._bedWant, true);
    return true;
  }

  _loop(buffer, out, startFrac = 0) {
    const c = this.audio.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (startFrac) src.loopStart = buffer.duration * 0;      // loop from 0, offset the start below
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(g).connect(out);
    src.start(0, startFrac ? buffer.duration * startFrac : 0);
    return { src, gain: g };
  }

  // -------------------------------------------------------------------------
  // A1/A2 — per-map race beds. `name` is a mapId ('sierra'…'desert'). A bed
  // neither replaces nor stops the game's own races: it is an ADDITIONAL layer
  // that sits under `audio.playMusic`. Passing null fades the bed out.
  // -------------------------------------------------------------------------
  playBed(name, force = false) {
    this._bedWant = name;
    const a = this.audio;
    if (!this.ready || !a || !a.ctx) return;
    if (!force && this._curMap === name) return;
    const c = a.ctx, t = c.currentTime;
    const old = this._beds[name === null ? this._curMap : this._curMap];
    if (old) {
      // Same time-constant trap as the fade-in: cancel anything scheduled and
      // ramp the old bed to silence over a clear 0.8 s.
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0.0001, t + 0.8);
      try { old.src.stop(t + 1.6); } catch (e) { /* already stopped */ }
    }
    this._beds = {};
    this._curMap = name;
    if (name === null) return;
    const buf = this.beds[name];
    if (!buf) return;                 // bed not synthesised (yet): silent, not an error
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = c.createGain();
    // A LINEAR ramp to the trim over 1.2 s. This was setTargetAtTime(BED_TRIM,
    // t, 1.0), whose time CONSTANT is 1 s -- so it reached only ~1% of target in
    // the first 10 ms and took ~5 s to arrive. Measured: a bed gain of 0.001
    // reading as "silent" long after the race had started. A ramp reaches the
    // level it names in the time it names.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(BED_TRIM, t + 1.2);
    src.connect(g).connect(this.nodes.bed);
    src.start(t);
    this._beds[name] = { src, gain: g };
  }

  // -------------------------------------------------------------------------
  // A3 — countdown beeps. Called every frame with the seconds left. Fires once
  // per whole second, so a frame rate change cannot double-fire.
  // -------------------------------------------------------------------------
  countdown(secondsLeft) {
    if (!this.ready || !this._beeps) return;
    const a = this.audio;
    if (!a.ctx || a.muted) return;
    if (secondsLeft <= 0) {
      if (this._lastCount !== null && this._lastCount > 0) this._beep('beepGo', 1.0, 1.0, 0.9);
      this._lastCount = 0;
      this._beepStep = -1;
      return;
    }
    const n = Math.ceil(secondsLeft);
    if (n !== this._lastCount) {
      // the first three seconds: high beep. The last (1) drops a tone, so the
      // ear hears 1 approaching without looking at the HUD.
      this._beep('beep', 1.0, n <= 1 ? 0.78 : 1.0, 0.35);
      this._lastCount = n;
      this._beepStep = n;
    }
  }

  _beep(name, amp, rate, dur) {
    const a = this.audio, c = a.ctx, buf = this._beeps && this._beeps[name];
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    const trim = name === 'beepGo' ? EXT_TRIM.beepGo : EXT_TRIM.beep;
    g.gain.value = Math.max(0.05, Math.min(1.2, amp)) * trim;
    src.connect(g).connect(this.nodes.shot);
    src.start(0);
    // A short manual envelope, since the synth buffer is a flat tone.
    const t = c.currentTime;
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
    try { src.stop(t + dur + 0.3); } catch (e) { /* not started */ }
  }

  /**
   * Called every frame AFTER audio.update(). Reads the same game state object.
   * `g` may carry the additions in addition to what audio.update already took:
   *   owner      the mapId for the bed (optional: falls back to g.map)
   *   countdown  seconds left on the grid (optional)
   *   weapon     truthy when the player has a chain/club in hand
   *   town       0..1 how much town is being passed (from the spine)
   *   wetness    0..1 road wetness
   */
  update(g = {}) {
    const a = this.audio;
    if (!this.ready || !a || !a.ctx) return;
    const t = a.ctx.currentTime;
    const silent = g.silent || a.muted || a.paused;

    // A1/A2 bed: the map decides which bed. g.bed overrides for night/rain.
    const bedName = g.bed || (g.map ? String(g.map) : null);
    if (bedName && bedName !== this._bedWant) this.playBed(bedName);

    // A4 chain rattle
    const ch = this.nodes.chainLoop;
    if (ch) {
      const want = silent ? 0 : (g.weapon ? 0.05 + Math.min(0.06, (g.speed || 0) / 61 * 0.06) : 0);
      ch.gain.gain.setTargetAtTime(want, t, 0.08);
      ch.src.playbackRate.setTargetAtTime(0.9 + Math.min(1, (g.speed || 0) / 61) * 0.35, t, 0.1);
    }

    // A5 crowd bed
    const cr = this.nodes.crowdLoop;
    if (cr) {
      const want = silent ? 0 : Math.max(0, Math.min(1, g.town || 0)) * 0.09;
      cr.gain.gain.setTargetAtTime(want, t, 0.4);
    }

    // A9 wet hiss
    const wt = this.nodes.wetLoop;
    if (wt) {
      this._wet += ((g.wetness || 0) - this._wet) * 0.05;
      const want = silent ? 0 : this._wet * Math.min(1, (g.speed || 0) / 40) * 0.07;
      wt.gain.gain.setTargetAtTime(want, t, 0.2);
      wt.src.playbackRate.setTargetAtTime(0.85 + Math.min(1, (g.speed || 0) / 61) * 0.5, t, 0.15);
    }

    if (g.countdown !== undefined) this.countdown(g.countdown);
  }

  // -------------------------------------------------------------------------
  // A6 — impact variants by surface/material. Falls back to audio.js's own
  // impact() when the variant file is missing, so a build without the extras
  // sounds exactly as it did before.
  // -------------------------------------------------------------------------
  impactMaterial(intensity = 1, material = 'body') {
    const a = this.audio;
    if (!a || !a.ctx || !a.buffers.impact) return;
    const name = material === 'metal' ? 'impactMetal' : material === 'wood' ? 'impactWood' : 'impactBody';
    const buf = a.buffers[name];
    if (!buf) return this._fallbackImpact(intensity, material);
    const amp = Math.max(0.08, Math.min(1.0, intensity));
    const src = a.ctx.createBufferSource();
    src.buffer = buf;
    const g = a.ctx.createGain();
    g.gain.value = amp * (EXT_TRIM[name] ?? 1);
    src.connect(g).connect(this.nodes.shot);
    src.start(0);
    a._duck && a._duck(amp * 0.6);
    return src;
  }

  _fallbackImpact(intensity, material) {
    const kind = material === 'metal' ? 'chain' : material === 'wood' ? 'kick' : 'hit';
    return this.audio.impact(intensity, kind);
  }

  // A7 — downshift blip. Up-shifts already pop (audio.js background); this is
  // the other half. Silent when the file is absent.
  downshift(gear = 1) {
    const a = this.audio;
    if (!a || !a.ready || !a.ctx || !this.nodes) return;
    const buf = a.buffers.blip || a.buffers.shift;
    if (!buf) return;
    const src = a.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1.18 - gear * 0.05;
    const g = a.ctx.createGain();
    g.gain.value = (EXT_TRIM.blip ?? 0.55) * (a.buffers.blip ? 1 : 0.5);
    src.connect(g).connect(this.nodes.shot);
    src.start(0, a.offsets && a.offsets.blip ? a.offsets.blip : 0);
    return src;
  }

  // A8 — a short grunt per rider. `voice` is an index into whatever the roster
  // provides; a missing voice is silent. Wired but not yet fed by the roster,
  // so it can grow one rival at a time without touching any existing call.
  grunt(voice = 0, amp = 0.6) {
    const a = this.audio;
    if (!a || !a.ready || !a.ctx || !this.nodes) return;
    const name = `grunt${voice}`;
    const buf = a.buffers[name] || a.buffers.grunt;
    if (!buf) return null;
    const src = a.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.9 + (voice % 5) * 0.06;
    const g = a.ctx.createGain();
    g.gain.value = Math.max(0.05, Math.min(1, amp));
    src.connect(g).connect(this.nodes.shot);
    src.start(0);
    return src;
  }

  // Per-frame level for the addition bus, driven from the settings screen's
  // existing sliders. Does not touch audio.js's volumes.
  setLevel(v = 1) {
    if (!this.nodes) return;
    this.nodes.ext.gain.value = Math.max(0, Math.min(1, v));
  }
}