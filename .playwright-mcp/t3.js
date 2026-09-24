async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:1280,height:720} });
  await ctx.addInitScript(() => {
    const btn = () => ({ pressed:false, value:0, touched:false });
    window.__FAKEPAD__ = { index:0, id:'Fake Xbox', connected:true, mapping:'standard', axes:[0,0,0,0], buttons:Array.from({length:17}, btn), timestamp:0 };
    navigator.getGamepads = () => [window.__FAKEPAD__];
    window.__press = (i, v=1) => { const b=window.__FAKEPAD__.buttons[i]; b.pressed = v>0.5; b.value=v; };
  });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const on=(id)=>p.evaluate((id)=>document.getElementById(id).classList.contains('on'), id);
  const tapBtn = async (i) => { await p.evaluate((i)=>window.__press(i,1), i); await p.waitForTimeout(90); await p.evaluate((i)=>window.__press(i,0), i); await p.waitForTimeout(90); };
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    await p.waitForTimeout(1300);
    // A on the title starts a race
    await tapBtn(0);
    await p.waitForTimeout(500);
    out.started = { hud: await on('hud'), method: await p.evaluate(()=>window.__INPUTMETHOD__()), padnav: await p.evaluate(()=>document.body.classList.contains('padnav')), touchpadHidden: await p.evaluate(()=>getComputedStyle(document.getElementById('touchpad')).display==='none') };
    await p.waitForTimeout(3600);
    await p.evaluate(()=>{const q=window.__PLAYERPHYS__; const a=q.advance.bind(q); window.__IN__={}; q.advance=(dt,inp)=>{ window.__IN__={steer:inp.steer, thr:inp.throttle, tuck:inp.tuck}; return a(dt,inp);};});
    const s0 = await p.evaluate(()=>window.__PLAYERPHYS__.s);
    await p.evaluate(()=>window.__press(7, 0.9));           // RT throttle
    await p.waitForTimeout(2000);
    out.rt = { advanced: +(await p.evaluate(()=>window.__PLAYERPHYS__.s) - s0).toFixed(1), thr: await p.evaluate(()=>window.__IN__.thr) };
    await p.evaluate(()=>{ window.__FAKEPAD__.axes[0] = 0.5; }); await p.waitForTimeout(120);
    out.stickHalf = await p.evaluate(()=>+window.__IN__.steer.toFixed(2));
    await p.evaluate(()=>{ window.__FAKEPAD__.axes[0] = 0.08; }); await p.waitForTimeout(120);
    out.stickDeadzone = await p.evaluate(()=>window.__IN__.steer);
    await p.evaluate(()=>{ window.__FAKEPAD__.axes[0] = -1; }); await p.waitForTimeout(120);
    out.stickFullLeft = await p.evaluate(()=>+window.__IN__.steer.toFixed(2));
    await p.evaluate(()=>{ window.__FAKEPAD__.axes[0] = 0; });
    await p.evaluate(()=>window.__press(4,1)); await p.waitForTimeout(120); out.lbTuck = await p.evaluate(()=>window.__IN__.tuck); await p.evaluate(()=>window.__press(4,0));
    const kind = () => p.evaluate(()=>{let q=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)q=o.userData.__player}); return q.fighter.active&&q.fighter.active.kind;});
    out.attacks = {};
    for (const [i,k] of [[2,'X'],[3,'Y'],[1,'B'],[5,'RB']]) { await p.waitForTimeout(900); await p.evaluate((i)=>window.__press(i,1), i); await p.waitForTimeout(60); out.attacks[k] = await kind(); await p.evaluate((i)=>window.__press(i,0), i); }
    const cam0 = await p.evaluate(()=>JSON.parse(localStorage.getItem('riderash.settings.v1')||'{}').camMode ?? 5);
    await tapBtn(8);
    out.viewCamera = { before: cam0, after: await p.evaluate(()=>JSON.parse(localStorage.getItem('riderash.settings.v1')).camMode) };
    // START pauses; d-pad moves focus; A activates; B backs out
    await tapBtn(9);
    out.paused = await on('pause');
    await tapBtn(13); await tapBtn(13);
    out.focused = await p.evaluate(()=>document.activeElement && document.activeElement.id);
    await tapBtn(0); await p.waitForTimeout(200);
    out.settingsViaA = await on('settingsscreen');
    await tapBtn(1); await p.waitForTimeout(200);
    out.backToPause = { settings: await on('settingsscreen'), pause: await on('pause') };
    await tapBtn(1); await p.waitForTimeout(200);
    out.resumedViaB = !(await on('pause'));
    await p.evaluate(()=>window.__press(7, 0));
    // PIXEL BUDGET on a big tablet (1366x1024 @2, touch => medium tier)
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{});
  try {
    const t = await page.context().browser().newContext({ viewport:{width:1366,height:1024}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const q = await t.newPage();
    await q.goto('http://127.0.0.1:8787/'); await q.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    out.ipad = await q.evaluate(()=>{ const r=window.__THREE_RENDERER__; const pr=r.getPixelRatio(); return { pr:+pr.toFixed(3), pixels: Math.round(innerWidth*innerHeight*pr*pr) }; });
    await t.close();
  } catch(e) { errs.push('ERR2 '+e.message.slice(0,200)); }
  return {errs, out};
}
