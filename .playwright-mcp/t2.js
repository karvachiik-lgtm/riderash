async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const on=(id)=>p.evaluate((id)=>document.getElementById(id).classList.contains('on'), id);
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    // enable tilt from the settings checkbox (the gesture)
    await p.tap('#opensettings'); await p.waitForTimeout(200);
    await p.tap('#set-tilt'); await p.waitForTimeout(300);
    out.tiltChecked = await p.evaluate(()=>document.getElementById('set-tilt').checked);
    await p.tap('#set-done'); await p.waitForTimeout(200);
    await p.tap('#start'); await p.waitForTimeout(3800);
    await p.evaluate(()=>{const q=window.__PLAYERPHYS__; const a=q.advance.bind(q); window.__ST__=0; q.advance=(dt,inp)=>{ window.__ST__=inp?inp.steer:null; return a(dt,inp);};});
    out.steerPadHidden = await p.evaluate(()=>getComputedStyle(document.getElementById('tp-steer')).display==='none');
    const orient = (beta, gamma) => p.evaluate(([b,g])=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:b,gamma:g})), [beta,gamma]);
    // held at 50deg back, straight: this is the calibration baseline
    await orient(50, 0); await p.waitForTimeout(60);
    out.tilt = {};
    for (const [lab, g] of [['straight',0],['small',2],['right15',15],['right40',40],['left20',-20]]) { await orient(50, g); await p.waitForTimeout(80); out.tilt[lab] = await p.evaluate(()=>+window.__ST__.toFixed(2)); }
    // landscape: rotate the viewport, baseline again, turn the phone like a wheel (beta changes)
    await orient(50,0);
    // AUDIO: iOS parks the context in 'interrupted'; emulate with suspend() behind the game's back
    out.audio0 = await p.evaluate(()=>window.__AUDIO__.ctx && window.__AUDIO__.ctx.state);
    await p.evaluate(()=>window.__AUDIO__.ctx.suspend());
    await p.waitForTimeout(150);
    out.audioSuspended = await p.evaluate(()=>window.__AUDIO__.ctx.state);
    await p.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    await p.waitForTimeout(300);
    out.audioAfterReturn = await p.evaluate(()=>window.__AUDIO__.ctx.state);
    // GPU CONTEXT LOSS
    const ext = await p.evaluate(()=>{ const gl=window.__THREE_RENDERER__.getContext(); window.__LC__=gl.getExtension('WEBGL_lose_context'); window.__LC__.loseContext(); return true; });
    await p.waitForTimeout(300);
    out.lost = { paused: await on('pause'), note: await p.evaluate(()=>document.getElementById('glnote').textContent), resumeDisabled: await p.evaluate(()=>document.getElementById('p-resume').disabled) };
    await p.evaluate(()=>document.getElementById('p-resume').click()); await p.waitForTimeout(100);
    out.resumeBlocked = await on('pause');
    await p.evaluate(()=>window.__LC__.restoreContext()); await p.waitForTimeout(800);
    out.restored = { note: await p.evaluate(()=>document.getElementById('glnote').textContent), resumeDisabled: await p.evaluate(()=>document.getElementById('p-resume').disabled), lost: await p.evaluate(()=>window.__THREE_RENDERER__.getContext().isContextLost()) };
    await p.tap('#p-resume'); await p.waitForTimeout(1500);
    out.afterResume = { paused: await on('pause'), draws: await p.evaluate(()=>window.__GAME__.draws), s: await p.evaluate(()=>Math.round(window.__PLAYERPHYS__.s)) };
    await p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
    await p.screenshot({path:'/Users/xavier/riderash/.playwright-mcp/t2_after_restore.png'});
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
