// RideRash — player settings. Persisted in localStorage next to the career, and
// validated on read the same way: a malformed or stale record falls back to the
// defaults field by field instead of taking the menu down.
const KEY = 'riderash.settings.v1';

export const QUALITY = ['auto', 'high', 'medium', 'low'];
export const TOUCH = ['auto', 'on', 'off'];

const DEFAULTS = {
  master: 0.8,
  sfx: 1.0,
  music: 0.55,
  quality: 'auto',
  camMode: 5,        // DRONE; see main.js state.camMode
  showFps: false,
  touch: 'auto',     // on-screen controls: auto = shown while touch is the input in use
  tilt: false,       // steer by tilting the phone (needs a permission tap on iOS)
};

function clamp01(v, d) { return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d; }

export function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    master: clamp01(r.master, DEFAULTS.master),
    sfx: clamp01(r.sfx, DEFAULTS.sfx),
    music: clamp01(r.music, DEFAULTS.music),
    quality: QUALITY.includes(r.quality) ? r.quality : DEFAULTS.quality,
    camMode: Number.isInteger(r.camMode) && r.camMode >= 0 && r.camMode < 16 ? r.camMode : DEFAULTS.camMode,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : DEFAULTS.showFps,
    touch: TOUCH.includes(r.touch) ? r.touch : DEFAULTS.touch,
    tilt: typeof r.tilt === 'boolean' ? r.tilt : DEFAULTS.tilt,
  };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: play on */ }
}
