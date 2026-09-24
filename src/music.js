// RideRash — generated music. No files: two loops are synthesised once at load
// in an OfflineAudioContext and handed back as AudioBuffers that loop cleanly.
//
// Road Rash's soundtrack was driving guitar rock, and that is the register here:
// palm-muted power-chord chugs, a picked bass, a straight rock kit. The menu loop
// is the same key at half the energy, so moving from the title into a race
// reads as the band kicking in rather than as a different record.
//
// Everything is deterministic (a fixed-seed noise buffer, fixed patterns), so the
// same build always produces the same audio.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);   // MIDI -> Hz
// E minor. Roots as MIDI numbers for the bass (E2 = 40).
const E = 40, G = 43, A = 45, C = 36, D = 38;

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

class Kit {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    this.noise = noiseBuffer(ctx, 1.0);
  }
  kick(t, v = 1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.34);
  }
  snare(t, v = 1) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
    n.connect(bp).connect(g).connect(this.out);
    n.start(t, (t * 7.3) % 0.5); n.stop(t + 0.22);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(190, t);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35 * v, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(og).connect(this.out); o.start(t); o.stop(t + 0.1);
  }
  hat(t, v = 1, open = false) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const g = c.createGain();
    const len = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(hp).connect(g).connect(this.out);
    n.start(t, (t * 3.1) % 0.5); n.stop(t + len + 0.02);
  }
  crash(t, v = 1) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    n.connect(hp).connect(g).connect(this.out);
    n.start(t); n.stop(t + 1.0);
  }
}

// A palm-muted power chord: root + fifth + octave, sawtooth into a waveshaper.
// `mute` shortens it and closes the filter, which is what makes a chug a chug.
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

function pad(ctx, out, t, notes, dur, v) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05 * v, t + dur * 0.3);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  for (const n of notes) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  lp.connect(g).connect(out);
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

async function renderRace(sr) {
  const bpm = 138, beat = 60 / bpm, bars = 8, len = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const bus = ctx.createGain(); bus.gain.value = 0.8; bus.connect(ctx.destination);
  const kit = new Kit(ctx, bus);
  // Em  Em  C  D  |  Em  Em  G  A  -- one root per bar
  const roots = [E, E, C, D, E, E, G, A];
  // A lead motif over the second half, in E minor pentatonic.
  const motif = [[64, 1], [67, 0.5], [69, 0.5], [71, 1], [69, 0.5], [67, 0.5],
                 [64, 1.5], [62, 0.5], [64, 2], [67, 1], [69, 1], [71, 0.5], [74, 0.5], [71, 1], [69, 2]];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const r = roots[bar];
    for (let e = 0; e < 8; e++) {
      const t = t0 + e * beat / 2;
      // Accents on 1 and the "and" of 2: a gallop against the straight hats.
      const acc = e === 0 || e === 3 || e === 6;
      power(ctx, bus, t, r, beat / 2, acc ? 1 : 0.7, !acc);
      bass(ctx, bus, t, r, beat / 2 * 0.9, acc ? 1 : 0.8);
      kit.hat(t, e % 2 ? 0.7 : 1, e === 7 && bar % 2 === 1);
    }
    kit.kick(t0); kit.kick(t0 + beat * 1.5, 0.8); kit.kick(t0 + beat * 2);
    kit.snare(t0 + beat); kit.snare(t0 + beat * 3);
    if (bar === 3 || bar === 7) {   // fill into the turnaround
      kit.snare(t0 + beat * 3.5, 0.7); kit.snare(t0 + beat * 3.75, 0.85);
    }
    if (bar === 0 || bar === 4) kit.crash(t0, bar === 0 ? 0.8 : 1);
  }
  let t = 4 * 4 * beat;
  for (const [n, d] of motif) {
    if (t >= len) break;
    lead(ctx, bus, t, n, d * beat, 1);
    t += d * beat;
  }
  return ctx.startRendering();
}

async function renderMenu(sr) {
  const bpm = 92, beat = 60 / bpm, bars = 8, len = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const bus = ctx.createGain(); bus.gain.value = 0.85; bus.connect(ctx.destination);
  const kit = new Kit(ctx, bus);
  // Em  C  G  D, twice
  const chords = [[E, [64, 67, 71]], [C, [60, 64, 67]], [G, [62, 67, 71]], [D, [62, 66, 69]]];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const [r, notes] = chords[bar % 4];
    pad(ctx, bus, t0, notes, 4 * beat, 1);
    for (let q = 0; q < 4; q++) bass(ctx, bus, t0 + q * beat, r, beat * 0.8, q === 0 ? 0.9 : 0.55);
    for (let e = 0; e < 8; e++) kit.hat(t0 + e * beat / 2, e % 2 ? 0.35 : 0.55);
    kit.kick(t0, 0.7); kit.kick(t0 + beat * 2.5, 0.5);
    kit.snare(t0 + beat * 2, 0.45);
    if (bar % 2 === 1) power(ctx, bus, t0 + beat * 3, r, beat, 0.45, false);
  }
  return ctx.startRendering();
}

export async function renderMusic(sampleRate = 44100) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const sr = Math.min(sampleRate, 44100);
  const [race, menu] = await Promise.all([renderRace(sr), renderMenu(sr)]);
  return { race, menu };
}

