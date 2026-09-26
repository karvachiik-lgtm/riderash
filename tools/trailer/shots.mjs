// RideRash trailer — the shot list. Each shot is staged in the real game with the
// clock held (__HOLD__), then stepped one output frame at a time.
//   setup(W)        runs in the page once, after a fresh load
//   frame(W, i, n)  runs in the page before each frame; returns the dt to step
//   hud             keep the game HUD (gameplay) or hide it (cinematic)
//   cap             caption: { t: title, s: subline, from, to } in frames (optional)
export const FPS = 24;

// in-page helpers, installed once per page
export const HELPERS = () => {
  const W = window;
  W.__K = (code, down) => W.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  W.__EASE = (x) => x * x * (3 - 2 * x);
  W.__ORBIT = (i, n, r, h, a0, a1) => {        // a camera circling the player
    const a = a0 + (a1 - a0) * W.__EASE(i / n);
    W.__FREECAM__ = { offset: [Math.sin(a) * r, h, Math.cos(a) * r], lookAtPlayer: true };
  };
  W.__THREE_RENDERER__.domElement.id = 'maincv';
  W.__GO = (v = 38) => {                        // riding, upright, at speed
    const D = W.__DISMOUNT__; if (D && D.onFoot) D.reset();
    const f = W.__PLAYER_FIGHTER__; f.down = false; f.hp = f.maxHp || 100;
    const p = W.__PLAYERPHYS__; p.speed = Math.max(p.speed, v);
  };
  W.__LOOKCAM = (px, py, pz, tx, ty, tz, fov = 45) => {
    const c = W.__CAM__; c.position.set(px, py, pz); c.up.set(0, 1, 0); c.lookAt(tx, ty, tz);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
    c.updateMatrixWorld(true);
  };
  W.__DRONE0 = () => {                         // remember where the drone shot starts
    const p = W.__PLAYERPHYS__, T = W.__THREE__;
    W.__D0 = { o: p.pos.clone(), f: new T.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)) };
  };
  W.__DRONE = (i, n, H, back, side, drift) => {  // high, behind and to one side; drifts along the road
    const D = W.__D0, p = W.__PLAYERPHYS__.pos, e = W.__EASE(i / n);
    const r = { x: D.f.z, z: -D.f.x };
    const cx = D.o.x - D.f.x * (back - drift * e) + r.x * side, cz = D.o.z - D.f.z * (back - drift * e) + r.z * side;
    W.__LOOKCAM(cx, D.o.y + H, cz, p.x, p.y, p.z, 55);
  };
  W.__TAP = (code) => { W.__K(code, true); W.__K(code, false); };
  W.__STARTRACE = (map) => {
    if (map) { W.__FREERIDE__(map, 3); } else { W.__START__(); }
    const S = W.__STATE__;
    for (let i = 0; i < 60 && S.countdown > 0; i++) W.__SIM__(0.25);
  };
  W.__RIVAL_BESIDE = (i, side = 1, ahead = 0.4) => {
    const p = W.__PLAYERPHYS__, r = W.__RIVALS__[i];
    r.phys.reset({ s: p.s + ahead, lateral: p.lateral + side * 1.35, speed: p.speed }); r.phys.sync();
    return r;
  };
  W.__COPIN = (back = 6, side = -1.8) => {
    const c = W.__COP__, p = W.__PLAYERPHYS__;
    c.enabled = true; c.fighter.down = false; c.fighter.hp = c.fighter.maxHp;
    c.phys.reset({ s: p.s - back, lateral: p.lateral + side, speed: p.speed }); c.phys.sync();
    c.state = 'parked'; c.group.visible = true; c._startChase();
  };
  // the caption layer: a lower third with a stars-and-stripes rule, baked into
  // the frame; `k` 0..1 is its slide-in / out
  const cap = document.createElement('div'); cap.id = 'cap';
  cap.innerHTML = '<div class="bar"><i></i><i></i><i></i></div><div class="t"></div><div class="s"></div>';
  document.body.appendChild(cap);
  const st = document.createElement('style');
  st.textContent = `
  #cap { position:fixed; left:88px; bottom:120px; z-index:9999; pointer-events:none; opacity:0; }
  #cap .bar { display:flex; width:420px; height:10px; margin-bottom:14px; }
  #cap .bar i { flex:1; } #cap .bar i:nth-child(1){background:#b22234} #cap .bar i:nth-child(2){background:#fff} #cap .bar i:nth-child(3){background:#3c3b6e}
  #cap .t { font:400 96px/0.95 Anton, Impact, sans-serif; color:#fff; letter-spacing:.02em; text-transform:uppercase;
            text-shadow:0 4px 0 #000, 0 0 28px rgba(0,0,0,.55); }
  #cap .s { font:700 30px/1.2 Rajdhani, sans-serif; color:#ffd9a0; letter-spacing:.28em; text-transform:uppercase; margin-top:12px;
            text-shadow:0 2px 0 #000, 0 0 18px rgba(0,0,0,.7); }
  body:not(.nohud) #cap { bottom:300px; left:120px; }   /* clear of the HUD's radar and distance */
  body.nohud * { visibility:hidden !important; }
  body.nohud #maincv, body.nohud #cap, body.nohud #cap * { visibility:visible !important; }
  body.nohud #cap, body #cap { visibility:visible !important; }
  #ui .pausebtn, #pausebtn { display:none !important; }`;
  document.head.appendChild(st);
  W.__CAP = (t, s, k) => {
    cap.querySelector('.t').textContent = t || ''; cap.querySelector('.s').textContent = s || '';
    const e = Math.max(0, Math.min(1, k));
    cap.style.opacity = e; cap.style.transform = `translateX(${(1 - e) * -60}px)`;
  };
};

export const SHOTS = {
  // ---- the landmarks, from the title screen's own flythrough ----
  landmarks: {
    hud: false, n: 60,
    setup(W) { W.__ATTRACT_NEXT__(); W.__SIM__(0.1); },
    frame(W, i) { return 1 / 24; },
    capFn(W, i) { const a = W.__ATTRACT__(); const nm = a.shot && a.shot.name; return { t: 'CALIFORNIA DREAMIN', s: 'every town, tree and road · built in code', k: Math.min((i - 6) / 8, (58 - i) / 8) }; },
  },
  // ---- the roads ----
  road_sierra: {
    hud: false, n: 60, map: 'sierra',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(9); W.__GO(); },
    frame(W, i, n) { W.__GO(); W.__ORBIT(i, n, 4.2, 1.3, 0.6, 1.5); return 1 / 24; },
    cap: { t: 'SIERRA NEVADA', s: 'mountain passes · 100 mph' },
  },
  road_coastal: {
    hud: false, n: 60, map: 'coastal',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(14); W.__GO(); },
    frame(W, i, n) { const e = W.__EASE(i / n); W.__FREECAM__ = { offset: [2.6 - 5 * e, 1.2, 4.2 - 1.5 * e], lookAtPlayer: true }; W.__GO(); return 1 / 24; },
    cap: { t: 'PACIFIC COAST HWY', s: 'california · ocean on your right' },
  },
  road_desert: {
    hud: false, n: 60, map: 'desert',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(12); W.__GO(); },
    frame(W, i, n) { W.__FREECAM__ = { offset: [-3.2 + 1.2 * i / n, 1.0, 2.6 - 5.5 * i / n], lookAtPlayer: true }; W.__GO(); return 1 / 24; },
    cap: { t: 'PALM DESERT', s: 'heat · dust · no speed limit' },
  },
  // ---- from the air: the ghat's hairpins, and a long run of the coast ----
  drone_ghat: {
    hud: false, n: 84, map: 'ghat',
    setup(W) {
      window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(4); W.__GO(30);
      // to the tightest run of bends on the course (scanned with the cop's integrator)
      const c = W.__COP__.phys, fin = W.__STATE__.finishS || 3000; let best = 400, bv = -1;
      for (let s = 300; s < fin - 400; s += 20) {
        let turn = 0, prev = null;
        for (let k = 0; k <= 8; k++) { c.reset({ s: s + k * 25, lateral: 0, speed: 0 }); c.sync(); if (prev !== null) { let d = c.yaw - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += Math.abs(d); } prev = c.yaw; }
        if (turn > bv) { bv = turn; best = s; }
      }
      W.__COP__._leave();
      const p = W.__PLAYERPHYS__; p.s = best; p.lateral = 0; p.speed = 26; p.sync(); W.__SIM__(1); W.__GO(26);
      W.__FREECAM__ = null; W.__DRONE0();
    },
    frame(W) { W.__GO(24); return 1 / 24; },
    post(W, i, n) { W.__DRONE(i, n, 150, 40, 70, 90); },
    cap: { t: 'THE GHAT ROAD', s: 'hairpins · waterfalls · sheer drops', from: 10, to: 84 },
  },
  drone_sierra: {
    hud: false, n: 60, map: 'sierra',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(12); W.__GO(40); W.__FREECAM__ = null; W.__DRONE0(); },
    frame(W) { W.__GO(); return 1 / 24; },
    post(W, i, n) { W.__DRONE(i, n, 85, 50, 55, 80); },
    cap: { t: 'ENDLESS ROADS', s: 'every mile · built in code', from: 8, to: 60 },
  },
  // ---- the brawl ----
  brawl: {
    hud: true, n: 168, map: 'coastal',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(10); W.__GO(); W.__RIVAL_BESIDE(0, 1, 0.3); W.__RIVAL_BESIDE(1, -1, 1.2); W.__SIM__(0.2); },
    frame(W, i) {
      const P = { 6: 'KeyJ', 34: 'KeyK', 62: 'KeyL', 96: 'KeyJ', 118: 'KeyK', 140: 'KeyL' };
      if (P[i]) W.__TAP(P[i]);
      if (i % 40 === 0) { const p = W.__PLAYERPHYS__; for (const [k, sd] of [[0, 1], [1, -1]]) { const r = W.__RIVALS__[k]; if (!r.fighter.down && Math.abs(r.phys.s - p.s) > 3) W.__RIVAL_BESIDE(k, sd, 0.4); } }
      W.__FREECAM__ = { offset: [1.8 + Math.sin(i / 40) * 0.5, 1.6, -3.6], lookAtPlayer: true };
      return 1 / 24;
    },
    cap: { t: 'BRAWL AT 100 MPH', s: 'punch · kick · swing the chain', from: 4, to: 70 },
  },
  // ---- the wipeout (slow motion) ----
  crash: {
    hud: false, n: 72, map: 'valley',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(10); W.__GO(40); },
    frame(W, i) {
      if (i === 8) { const f = W.__PLAYER_FIGHTER__; f.hp = 0; f.down = true; f.downTimer = 4; }
      W.__FREECAM__ = { offset: [-3.4, 1.0, 1.8], lookAtPlayer: true };
      return i < 8 ? 1 / 24 : 1 / 72;
    },
    cap: { t: 'WIPE OUT', s: 'full ragdoll · get up · walk it back', from: 20, to: 72 },
  },
  // ---- the cops ----
  cops: {
    hud: true, n: 60, map: 'sierra',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(10); W.__GO(); W.__COPIN(2.5, -1.7); W.__SIM__(0.2); },
    frame(W, i, n) { W.__GO(); W.__FREECAM__ = { offset: [-1.2, 1.7, -5.5 + 1.2 * i / n], lookAtPlayer: true }; return 1 / 24; },
    cap: { t: 'COPS ON YOUR TAIL', s: 'lights · siren · no mercy' },
  },
  bust: {
    hud: false, n: 96, map: 'sierra',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(8); W.__GO(); W.__COPIN(14, 1.6); W.__BUST_VARIANT__ = 'knees'; W.__PLAYERPHYS__.speed = 12; W.__ENDINGS__.bust(); W.__FREECAM__ = null; },
    frame(W, i) { const A = W.__STATE__.arrest; const ph = A && A.phase; return ph === 'stop' || ph === 'walk' || ph === 'off' ? 1 / 10 : 1 / 24; },
    post(W, i, n) {
      const A = W.__STATE__.arrest, T = W.__THREE__; if (!A) return;
      const cop = W.__COP__, j = cop.rider && cop.rider.userData.joints;
      const c = (j ? j.pelvis : cop.group).getWorldPosition(new T.Vector3());
      const t = A.targetPoint(new T.Vector3()), m = c.clone().lerp(t, 0.5);
      const d = t.clone().sub(c); d.y = 0; if (d.lengthSq() < 1e-4) d.set(1, 0, 0); d.normalize();
      const side = new T.Vector3(-d.z, 0, d.x), r = Math.min(6.5, Math.max(3.6, c.distanceTo(t) * 0.9 + 2.4));
      W.__LOOKCAM(m.x + side.x * r, m.y + 0.9, m.z + side.z * r, m.x, m.y + 0.1, m.z, 40);
    },
    cap: { t: 'BUSTED', s: 'wreck near a cop and pay the fine', from: 40, to: 96 },
  },
  // ---- over the edge ----
  plunge: {
    hud: false, n: 72, map: 'ghat',
    setup(W) {
      window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(8); W.__GO(34);
      const p = W.__PLAYERPHYS__; p.lateral = W.__CFG__.ROAD_W / 2 - 0.4; p.lateralV = 6; p.sync(); W.__SIM__(1 / 24);
      W.__ENDINGS__.plunge(); W.__FREECAM__ = null;
      const P = W.__STATE__.plunge, g = W.__PLAYER_BIKE__.parent || W.__PLAYER_BIKE__;
      const o = g.position.clone(); W.__PL0 = { o, n: P.n.clone(), f: P.f.clone() };
    },
    frame() { return 1 / 24; },
    post(W) {
      const Q = W.__PL0, g = W.__PLAYER_BIKE__.parent || W.__PLAYER_BIKE__, T = W.__THREE__;
      const c = Q.o.clone().addScaledVector(Q.n, -2.5).addScaledVector(Q.f, -7); c.y += 3.2;
      const t = g.position.clone().lerp(Q.o, 0.25);
      W.__LOOKCAM(c.x, c.y, c.z, t.x, t.y, t.z, 50);
    },
    cap: { t: "DON'T LOOK DOWN", s: 'the cliff road bites', from: 12, to: 72 },
  },
  // ---- the easter egg ----
  monowheel: {
    hud: false, n: 72,
    setup(W) { W.__TRIAL__(); const S = W.__STATE__; for (let i = 0; i < 60 && S.countdown > 0; i++) W.__SIM__(0.25); W.__K('KeyW', true); W.__SIM__(7); },
    frame(W, i, n) { W.__GO(); W.__ORBIT(i, n, 3.6, 1.1, 1.0, 2.4); return 1 / 24; },
    cap: { t: 'SECRET ONE-WHEELER', s: 'easter egg · test ride it from the garage' },
  },
  // ---- the win ----
  win: {
    hud: true, n: 62, map: 'desert',
    setup(W) { window.__TRAFFIC_OFF__ = true; W.__K('KeyW', true); W.__SIM__(6); W.__GO(40); const p = W.__PLAYERPHYS__; p.s = W.__STATE__.finishS - 45; p.speed = 40; p.sync(); for (const r of W.__RIVALS__) { r.phys.s = p.s - 30 - Math.random() * 20; r.phys.sync(); } W.__SIM__(0.1); },
    frame(W, i) { W.__FREECAM__ = i < 60 ? { offset: [1.5, 1.4, 7 - i * 0.05], lookAtPlayer: true } : null; return 1 / 24; },
    cap: { t: 'TAKE THE WIN', s: 'prize money · faster bikes', from: 14, to: 62 },
  },
};
