// RideRash — ADDITIONAL music, synthesised. This file is the additive twin of
// src/music.js: it re-uses the SAME voice vocabulary (a palm-muted power chord,
// a picked bass, a straight kit) but with new patterns, so the extra beds sound
// like the same band playing a different song rather than a different game.
//
// Nothing here is imported by music.js, and music.js is not modified: audio.js
// still renders and owns its two loops exactly as before. AudioExt is the only
// consumer.
//
// WHY SYNTHESIS AND NOT FILES: a per-map bed per map is five more audio files in
// a project whose whole portability thesis is "zip the folder and host it". An
// 8-bar bed is ~15 s of generated samples at 44.1 kHz — about 2.6 MB each as WAV
// and more decoded in RAM. Rendering five in an OfflineAudioContext costs one
// async pass at load and zero bytes on disk, and it keeps the deterministic
// guarantee music.js already documents: same build, same audio.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Deterministic noise, byte for byte the same xorshift music.js uses, so a bed
// and a kit hat never sound like they came from two different machines.
function noiseBuffer(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let h = 0x2545f491;
  for (let i = 0; i < n; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    d[i] = ((h >>> 0) / 4294967295) * 2 - 1;
  }
  return b;
}

function distCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

// --- voices, deliberately re-implemented here rather than imported -----------
// music.js does not export its voice functions, and importing them would mean
// editing music.js to add exports. A copy is the price of the additive rule;
// the parameters are chosen to match, so the timbre is the same.

function kitKick(ctx, out, t, v = 1) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.95 * v, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.34);
}

function kitSnare(ctx, noise, out, t, v = 1) {
  const n = ctx.createBufferSource(); n.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
  n.connect(bp).connect(g).connect(out);
  n.start(t, (t * 7.3) % 0.5); n.stop(t + 0.22);
}

function kitHat(ctx, noise, out, t, v = 1, open = false) {
  const n = ctx.createBufferSource(); n.buffer = noise;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
  const g = ctx.createGain();
  const len = open ? 0.22 : 0.045;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.connect(hp).connect(g).connect(out);
  n.start(t, (t * 3.1) % 0.5); n.stop(t + len + 0.02);
}

function kitCrash(ctx, noise, out, t, v = 1) {
  const n = ctx.createBufferSource(); n.buffer = noise;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
  n.connect(hp).connect(g).connect(out);
  n.start(t); n.stop(t + 1.0);
}

function power(ctx, out, t, root, dur, v, mute) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(mute ? 1100 : 2600, t);
  lp.Q.value = 0.9;
  const sh = ctx.createWaveShaper(); sh.curve = distCurve(28); sh.oversample = '2x';
  const pre = ctx.createGain(); pre.gain.value = 0.55;
  for (const [iv, det] of [[0, -6], [7, 5], [12, 3]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = NOTE(root + 12 + iv);
    o.detune.value = det;
    o.connect(pre);
    o.start(t); o.stop(t + dur + 0.05);
  }
  pre.connect(sh).connect(lp).connect(g).connect(out);
  const len = mute ? Math.min(dur, 0.16) : dur;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.006);
  g.gain.setTargetAtTime(0.0001, t + len * 0.6, len * 0.35);
}

function bass(ctx, out, t, note, dur, v) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator();
  o.type = 'sawtooth'; o2.type = 'square';
  o.frequency.value = NOTE(note); o2.frequency.value = NOTE(note) * 0.5;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(260, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.30 * v, t + 0.008);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.25);
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  o.connect(lp); o2.connect(g2).connect(lp);
  lp.connect(g).connect(out);
  o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

function lead(ctx, out, t, note, dur, v) {
  const o = ctx.createOscillator(); o.type = 'square';
  o.frequency.value = NOTE(note);
  const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
  const vg = ctx.createGain(); vg.gain.value = 6;
  vib.connect(vg).connect(o.detune);
  const sh = ctx.createWaveShaper(); sh.curve = distCurve(8);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.07 * v, t + 0.02);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.8, dur * 0.2);
  o.connect(sh).connect(lp).connect(g).connect(out);
  o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
}

// A sustained bed layer: filtered noise, used by the night and rain variants to
// give each map a weather the music itself acknowledges.
function air(ctx, out, t, dur, v, cutoff) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const b = noiseBuffer(ctx, dur);
  const n = ctx.createBufferSource(); n.buffer = b; n.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = cutoff; bp.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05 * v, t + dur * 0.2);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.75, dur * 0.2);
  n.connect(bp).connect(g).connect(out);
  n.start(t); n.stop(t + dur + 0.1);
}

// --- the beds ---------------------------------------------------------------
// Each map gets a key, a tempo, a root and a chord figure. The registers are
// chosen to be recognisably the same band: minor, guitar-led, straight kit. The
// differentiation is tempo and mode, which is exactly how a Road Rash soundtrack
// differed between a desert and a forest without leaving its genre.

export const BED_DEFS = {
  sierra:    { bpm: 132, roots: [40, 40, 36, 38, 40, 40, 43, 45], lead: true },   // the opener: Em C D
  coastal:   { bpm: 126, roots: [45, 45, 43, 40, 45, 45, 43, 38], lead: true },   // A minor, salt-air
  valley:    { bpm: 138, roots: [43, 43, 45, 40, 43, 43, 45, 47], lead: true },   // G major-ish lift
  peninsula: { bpm: 144, roots: [40, 43, 45, 47, 40, 43, 45, 40], lead: true },   // fastest: the coast sprint
  desert:    { bpm: 120, roots: [36, 36, 43, 43, 45, 45, 36, 38], lead: true },   // C: heavy, sparse
  night:     { bpm: 116, roots: [40, 40, 40, 43, 40, 40, 38, 38], lead: true, air: 300 },
  rain:      { bpm: 128, roots: [45, 45, 40, 40, 43, 43, 45, 45], lead: true, air: 900 },
};

function renderBed(def, sr) {
  const bpm = def.bpm, beat = 60 / bpm, bars = 8, len = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const bus = ctx.createGain(); bus.gain.value = 0.8; bus.connect(ctx.destination);
  const noise = noiseBuffer(ctx, 1.0);

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const r = def.roots[bar];
    for (let e = 0; e < 8; e++) {
      const t = t0 + (e * beat) / 2;
      const acc = e === 0 || e === 3 || e === 6;
      power(ctx, bus, t, r, beat / 2, acc ? 1 : 0.7, !acc);
      bass(ctx, bus, t, r, (beat / 2) * 0.9, acc ? 1 : 0.8);
      kitHat(ctx, noise, bus, t, e % 2 ? 0.7 : 1, e === 7 && bar % 2 === 1);
    }
    kitKick(ctx, bus, t0);
    kitKick(ctx, bus, t0 + beat * 1.5, 0.8);
    kitKick(ctx, bus, t0 + beat * 2);
    kitSnare(ctx, noise, bus, t0 + beat);
    kitSnare(ctx, noise, bus, t0 + beat * 3);
    if (bar === 3 || bar === 7) {
      kitSnare(ctx, noise, bus, t0 + beat * 3.5, 0.7);
      kitSnare(ctx, noise, bus, t0 + beat * 3.75, 0.85);
    }
    if (bar === 0 || bar === 4) kitCrash(ctx, noise, bus, t0, bar === 0 ? 0.8 : 1);
    // the bed's own hook, one chord per bar, under the chugs
    if (def.lead && (bar === 2 || bar === 4 || bar === 6)) {
      lead(ctx, bus, t0, r + 24, beat * 2, 0.7);
    }
  }
  if (def.air) air(ctx, bus, 0, len, 1, def.air);
  return ctx.startRendering();
}

/**
 * Render the additive beds. Returns a map of name -> AudioBuffer, or {} if
 * OfflineAudioContext is unavailable. NEVER throws: a bed that fails to render
 * simply does not exist, and AudioExt treats a missing bed as silent.
 */
export async function renderBeds(sampleRate = 44100) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return {};
  const sr = Math.min(sampleRate, 44100);
  const out = {};
  for (const [name, def] of Object.entries(BED_DEFS)) {
    try { out[name] = await renderBed(def, sr); } catch (e) { /* silent */ }
  }
  return out;
}

/**
 * A3 — countdown beeps, synthesised: a clean 880 Hz blip for 3/2 and a 660 Hz
 * "one" so the ear hears the last second, then a longer 1320 Hz GO. Tones, not
 * noise, so they cut through the engine. ~0.35 s each.
 */
function renderTone(sr, freq, dur, shape = 'square') {
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * sr), sr);
  const o = ctx.createOscillator(); o.type = shape; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(0.6, 0.006);
  g.gain.setTargetAtTime(0.0001, dur * 0.55, dur * 0.2);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
  o.connect(lp).connect(g).connect(ctx.destination);
  o.start(0); o.stop(dur + 0.05);
  return ctx.startRendering();
}

export async function renderBeeps(sampleRate = 44100) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const sr = Math.min(sampleRate, 44100);
  const [beep, beepGo] = await Promise.all([
    renderTone(sr, 880, 0.30),
    renderTone(sr, 1320, 0.52),
  ]);
  return { beep, beepGo };
}

// ---------------------------------------------------------------------------
// A9/A7 — the two loops and the blip that Atlas did not deliver as loops.
//
// WHY SYNTHESISED. Atlas returned a crowd bed that loops (edge ratio 2.5) and a
// sustained noise bed that loops (edge ratio 1.1, reused as the chain rattle) —
// but every other file it produced was a TRANSIENT: measured edge ratios of
// 300-5000, i.e. a hit followed by silence, which is the opposite of a loop. A
// wet-road hiss and a blip are cheap to synthesise correctly and deterministically,
// and a synthesised loop is seamless BY CONSTRUCTION, which a trimmed one-shot is not.
// ---------------------------------------------------------------------------

// A seamless loop: filtered noise with a gentle amplitude wander, optionally
// with a periodic spray flick. `flickerHz` 0 = a pure hiss; > 0 adds the
// rhythmic throw of water off a tyre.
function renderLoopNoise(sr, dur, cutoff, q, wander, flickerHz, v) {
  const n = Math.ceil(dur * sr);
  const ctx = new OfflineAudioContext(1, n, sr);
  const b = noiseBuffer(ctx, dur);
  const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = cutoff; bp.Q.value = q;
  const g = ctx.createGain();
  // amplitude modulation over whole cycles of the loop length, so the seam is
  // continuous: the LFO completes an integer number of periods in `dur`.
  g.gain.setValueAtTime(v, 0);
  if (wander > 0) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = Math.round(dur) / dur;   // 1 whole cycle
    const depth = ctx.createGain(); depth.gain.value = v * wander;
    lfo.connect(depth).connect(g.gain);
    lfo.start(0); lfo.stop(dur);
  }
  if (flickerHz > 0) {
    const f = ctx.createOscillator();
    f.type = 'sawtooth';
    f.frequency.value = Math.round(flickerHz * dur) / dur;
    const fd = ctx.createGain(); fd.gain.value = v * 0.35;
    f.connect(fd).connect(g.gain);
    f.start(0); f.stop(dur);
  }
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200;
  src.connect(bp).connect(hp).connect(g).connect(ctx.destination);
  src.start(0); src.stop(dur);
  return ctx.startRendering();
}

// A short downshift blip: a low pulse with a fast pitch drop, then gone.
function renderBlip(sr, dur) {
  const n = Math.ceil(dur * sr);
  const ctx = new OfflineAudioContext(1, n, sr);
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(210, 0);
  o.frequency.exponentialRampToValueAtTime(95, dur * 0.55);
  o.frequency.exponentialRampToValueAtTime(70, dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, 0);
  lp.frequency.exponentialRampToValueAtTime(500, dur);
  const sh = ctx.createWaveShaper(); sh.curve = distCurve(10);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(0.5, 0.008);
  g.gain.setTargetAtTime(0.0001, dur * 0.45, dur * 0.25);
  o.connect(sh).connect(lp).connect(g).connect(ctx.destination);
  o.start(0); o.stop(dur + 0.02);
  return ctx.startRendering();
}

/**
 * A7/A9 — synthesised fallbacks for `wet` and `blip`, plus a synthesised
 * `impactWood` and `impactBody` so the game has a full set even with no files.
 * Files, when present, win: AudioExt only uses these if the mp3 was absent.
 */
export async function renderExtras(sampleRate = 44100) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return {};
  const sr = Math.min(sampleRate, 44100);
  const out = {};
  try { out.wet = await renderLoopNoise(sr, 3.0, 2600, 0.6, 0.35, 0, 0.22); } catch (e) { /* silent */ }
  try { out.blip = await renderBlip(sr, 0.30); } catch (e) { /* silent */ }
  try { out.impactWood = await renderWood(sr); } catch (e) { /* silent */ }
  try { out.impactBody = await renderBody(sr); } catch (e) { /* silent */ }
  return out;
}

// A wood/plastic knock: a bandpassed noise crack with a short resonant ring.
function renderWood(sr) {
  const dur = 0.22;
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * sr), sr);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.25);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 3.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(0.65, 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, 0.18);
  n.connect(bp).connect(g).connect(ctx.destination);
  n.start(0); n.stop(dur);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 420;
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, 0);
  og.gain.exponentialRampToValueAtTime(0.18, 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, 0.12);
  o.connect(og).connect(ctx.destination); o.start(0); o.stop(dur);
  return ctx.startRendering();
}

// A dull body thud: low sine drop plus a filtered noise slap.
function renderBody(sr) {
  const dur = 0.26;
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * sr), sr);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, 0);
  o.frequency.exponentialRampToValueAtTime(48, 0.14);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(0.7, 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, 0.24);
  o.connect(g).connect(ctx.destination); o.start(0); o.stop(dur);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.1);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, 0);
  ng.gain.exponentialRampToValueAtTime(0.28, 0.004);
  ng.gain.exponentialRampToValueAtTime(0.0001, 0.09);
  n.connect(lp).connect(ng).connect(ctx.destination); n.start(0); n.stop(0.12);
  return ctx.startRendering();
}