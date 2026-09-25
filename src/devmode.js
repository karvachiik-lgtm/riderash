// RideRash — developer mode.
//
// A passcode-gated debug panel in Settings: money, career position, bikes, god
// mode, the police, traffic, animals, time scale, instant finish and a live
// readout. For the developer, not for players.
//
// WHAT IS AND IS NOT SECRET. This is a static game: every byte of it is sent to
// the browser, so no check here can stop someone who edits the page or their
// own save in devtools -- nothing client-side can, and a single-player game has
// nothing to protect from its own player. What IS protected is the passcode:
// the source holds only a verifier, SHA-256(PBKDF2-SHA256(passcode, SALT,
// 310 000 rounds)). It cannot be read back, and each guess costs the 310k
// rounds, so the published verifier does not give the passcode away. The
// passcode itself is never in the repository.
//
// "Remember on this device" stores the PBKDF2 key K (not the passcode) in
// localStorage; on load, SHA-256(K) is checked against the verifier, so a
// forged flag does not unlock it -- only the key the passcode produces does.

const SALT_HEX = '8c2cdefaee52939aff1df3c88adaaca7';
const ROUNDS = 310000;
const VERIFY_HEX = '3d1a01de3a19d5a254ac6ed1a10be7b41b302c470327feba749b1a0b0c17a897';
const KEY_STORE = 'riderash.dev.key';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

function subtle() { return (globalThis.crypto && globalThis.crypto.subtle) || null; }

async function keyFor(pass) {
  const s = subtle();
  const base = await s.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(SALT_HEX), iterations: ROUNDS }, base, 256);
}
async function verifies(keyBuf) {
  const h = await subtle().digest('SHA-256', keyBuf);
  // constant-time-ish compare; the verifier is public anyway
  const a = hex(h);
  let d = a.length ^ VERIFY_HEX.length;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ VERIFY_HEX.charCodeAt(i);
  return d === 0;
}

/** Live debug switches the game loop reads (main.js). */
export const DEV = {
  on: false,
  god: false,          // health and bike damage held full
  noCops: false,       // no police this race
  timeScale: 1,
  readout: false,
};

const $ = (id) => document.getElementById(id);

/**
 * Build the Developer section of Settings. `api` is the game's side:
 * { career, series, bikes, setCash(n), addCash(n), setRace(i), ownAll(), resetCareer(),
 *   inRace(), spawnCop(), spawnAnimal(kind), winNow(), setTraffic(off), readout() }
 */
export function initDevMode(api) {
  const host = $('devsec');
  if (!host) return;
  host.innerHTML = `
    <div class="setg" id="devlock">
      <span>Developer</span>
      <input type="password" id="dev-pass" autocomplete="off" spellcheck="false" placeholder="passcode" aria-label="Developer passcode">
      <button class="btn pe small" id="dev-go">UNLOCK</button>
      <span></span><label class="ck" style="grid-column:2 / 4"><input type="checkbox" id="dev-remember"> remember on this device</label>
      <span></span><span id="dev-msg" class="hint" style="grid-column:2 / 4;text-transform:none"></span>
    </div>
    <div class="setg" id="devpanel" style="display:none">
      <span>Cash</span><input type="number" id="dev-cash" step="100" aria-label="Cash"><button class="btn pe small" id="dev-setcash">SET</button>
      <span></span><button class="btn pe small" id="dev-add10k">+$10,000</button><button class="btn pe small" id="dev-add100k">+$100,000</button>
      <span>Race</span><select id="dev-race" aria-label="Career race"></select><button class="btn pe small" id="dev-setrace">JUMP</button>
      <span>Bikes</span><button class="btn pe small" id="dev-ownall">OWN ALL</button><button class="btn pe small" id="dev-reset">RESET CAREER</button>
      <span>God mode</span><label class="ck" style="grid-column:2 / 4"><input type="checkbox" id="dev-god"> health and bike damage held full</label>
      <span>Police</span><label class="ck" style="grid-column:auto"><input type="checkbox" id="dev-nocops"> no cops</label><button class="btn pe small" id="dev-cop">SPAWN COP</button>
      <span>Traffic</span><label class="ck" style="grid-column:2 / 4"><input type="checkbox" id="dev-notraffic"> empty road</label>
      <span>Animals</span><span style="grid-column:2 / 4;display:flex;gap:6px"><button class="btn pe small" data-animal="cow">COW</button><button class="btn pe small" data-animal="deer">DEER</button><button class="btn pe small" data-animal="moose">MOOSE</button></span>
      <span>Time</span><select id="dev-time" aria-label="Time scale">
        <option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option>
      </select><span></span>
      <span>Finish</span><button class="btn pe small" id="dev-win">WIN NOW</button><span></span>
      <span>Readout</span><label class="ck" style="grid-column:2 / 4"><input type="checkbox" id="dev-readout"> live debug numbers</label>
      <span></span><button class="btn pe small" id="dev-lock">LOCK DEV MODE</button><span id="dev-note" class="hint" style="text-transform:none"></span>
    </div>`;

  const note = (t) => { const n = $('dev-note'); if (n) n.textContent = t; };
  const msg = (t) => { const n = $('dev-msg'); if (n) n.textContent = t; };
  const sync = () => {
    $('dev-cash').value = String(api.career.state.cash);
    const sel = $('dev-race');
    if (!sel.options.length) api.series.forEach((ev, i) => {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = `${i + 1} · L${ev.level} ${ev.name}`;
      sel.appendChild(o);
    });
    sel.value = String(Math.min(api.series.length - 1, api.career.state.race || 0));
    $('dev-god').checked = DEV.god;
    $('dev-nocops').checked = DEV.noCops;
    $('dev-notraffic').checked = !!window.__TRAFFIC_OFF__;
    $('dev-time').value = String(DEV.timeScale);
    $('dev-readout').checked = DEV.readout;
  };
  const show = (on) => {
    DEV.on = on;
    $('devlock').style.display = on ? 'none' : '';
    $('devpanel').style.display = on ? '' : 'none';
    if (on) sync();
    if (!on) { DEV.god = false; DEV.noCops = false; DEV.timeScale = 1; DEV.readout = false; api.readout(false); }
  };

  async function unlock() {
    if (!subtle()) { msg('needs a secure page (https or localhost)'); return; }
    const pass = $('dev-pass').value.trim();
    if (!pass) return;
    msg('checking…');
    try {
      const k = await keyFor(pass);
      if (!(await verifies(k))) { msg('wrong passcode'); $('dev-pass').value = ''; return; }
      if ($('dev-remember').checked) { try { localStorage.setItem(KEY_STORE, hex(k)); } catch (e) { /* private mode */ } }
      $('dev-pass').value = '';
      msg('');
      show(true);
    } catch (e) { msg('could not check: ' + (e && e.message)); }
  }
  $('dev-go').addEventListener('click', unlock);
  $('dev-pass').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') unlock(); });
  $('dev-lock').addEventListener('click', () => { try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ } show(false); });

  // the panel
  $('dev-setcash').addEventListener('click', () => { api.setCash(Math.round(+$('dev-cash').value || 0)); sync(); note('cash set'); });
  $('dev-add10k').addEventListener('click', () => { api.addCash(10000); sync(); });
  $('dev-add100k').addEventListener('click', () => { api.addCash(100000); sync(); });
  $('dev-setrace').addEventListener('click', () => { api.setRace(+$('dev-race').value); sync(); note('next race: ' + (+$('dev-race').value + 1)); });
  $('dev-ownall').addEventListener('click', () => { api.ownAll(); note('all bikes owned'); });
  $('dev-reset').addEventListener('click', () => { api.resetCareer(); sync(); note('career reset'); });
  $('dev-god').addEventListener('change', (e) => { DEV.god = e.target.checked; });
  $('dev-nocops').addEventListener('change', (e) => { DEV.noCops = e.target.checked; });
  $('dev-notraffic').addEventListener('change', (e) => { api.setTraffic(e.target.checked); });
  $('dev-time').addEventListener('change', (e) => { DEV.timeScale = +e.target.value || 1; });
  $('dev-readout').addEventListener('change', (e) => { DEV.readout = e.target.checked; api.readout(DEV.readout); });
  $('dev-cop').addEventListener('click', () => note(api.inRace() ? (api.spawnCop() ? 'cop pulling out behind you' : 'no cop available') : 'start a race first'));
  $('dev-win').addEventListener('click', () => note(api.inRace() ? (api.winNow(), 'finish line moved to you') : 'start a race first'));
  for (const b of host.querySelectorAll('[data-animal]')) {
    b.addEventListener('click', () => note(api.inRace() ? (api.spawnAnimal(b.dataset.animal) ? b.dataset.animal + ' ahead' : 'none free') : 'start a race first'));
  }

  // remembered on this device?
  let saved = null;
  try { saved = localStorage.getItem(KEY_STORE); } catch (e) { /* ignore */ }
  if (saved && /^[0-9a-f]{64}$/.test(saved) && subtle()) {
    verifies(unhex(saved)).then((ok) => { if (ok) show(true); else { try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ } } });
  }
  return { refresh: () => { if (DEV.on) sync(); } };
}
