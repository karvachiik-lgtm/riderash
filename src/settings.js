// RideRash — player settings. Persisted in localStorage next to the career, and
// validated on read the same way: a malformed or stale record falls back to the
// defaults field by field instead of taking the menu down.
const KEY = 'riderash.settings.v1';

export const QUALITY = ['auto', 'high', 'medium', 'low'];
export const TOUCH = ['auto', 'on', 'off'];

// GRAPHICS: HIGH RESOLUTION is the default (everything on, budgeted to about
// 250 MB). A phone or a low-memory device starts on LOW / MOBILE instead: no
// grass, lighter landmarks and props, no post effects, a small canvas -- about
// half the memory, and a steadier frame rate. Either can be changed in Settings.
function mobileDevice() {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
    return !!(coarse || lowMem);
  } catch (e) { return false; }
}
const DEFAULTS = {
  master: 0.8,
  sfx: 1.0,
  music: 0.55,
  quality: mobileDevice() ? 'low' : 'high',
  camMode: 5,        // DRONE; see main.js state.camMode
  showFps: false,
  touch: 'auto',     // on-screen controls: auto = shown while touch is the input in use
  tilt: false,       // steer by tilting the phone (needs a permission tap on iOS)
  vibration: true,   // phone vibration / gamepad rumble on hits (feel.js)
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
    vibration: typeof r.vibration === 'boolean' ? r.vibration : DEFAULTS.vibration,
  };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: play on */ }
}
