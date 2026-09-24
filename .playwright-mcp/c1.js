async (page) => {
  const T='/Users/xavier/riderash/.playwright-mcp/';
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const hide=()=>p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
  const on=(id)=>p.evaluate((id)=>document.getElementById(id).classList.contains('on'), id);
  const pl=()=>p.evaluate(()=>{let q=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)q=o.userData.__player}); const d=q.dismount; return {st:d.state, ws: d.walk?+d.walk.s.toFixed(1):null, dist:+d._distToBike().toFixed(1)};});
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000}); await hide();
    await p.tap('#start'); await p.waitForTimeout(3800);
    await p.dispatchEvent('#tp-gas','pointerdown',{pointerId:3,pointerType:'touch',bubbles:true});
    await p.waitForTimeout(2500);
    await p.dispatchEvent('#tp-gas','pointerup',{pointerId:3,pointerType:'touch',bubbles:true});
    // 1. crash, then walk to the bike with the buttons
    await p.evaluate(()=>{let q=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)q=o.userData.__player}); q.dismount.beginFall({side:1}); q.fighter.down = true;});
    const seen=[]; let s;
    for (let i=0;i<8;i++){ await p.waitForTimeout(400); s=await pl(); seen.push(s.st); if (s.st==='WALKING'||s.st==='STANDING') break; }
    out.fall = {states:[...new Set(seen)], at:s};
    await hide(); await p.screenshot({path:T+'c_down.png'});
    const w0 = await pl();
    await p.dispatchEvent('#tp-gas','pointerdown',{pointerId:4,pointerType:'touch',bubbles:true});
    await p.waitForTimeout(1200);
    const w1 = await pl();
    out.walkWithGas = {before:w0, after:w1};
    await hide(); await p.screenshot({path:T+'c_walk.png'});
    for (let i=0;i<20;i++){ await p.waitForTimeout(500); s=await pl(); if (s.st==='RIDING') break; }
    await p.dispatchEvent('#tp-gas','pointerup',{pointerId:4,pointerType:'touch',bubbles:true});
    out.remounted = s.st;
    // 2. pause -> settings -> back -> resume
    await p.tap('#pausebtn'); await p.waitForTimeout(200);
    await p.tap('#p-settings'); await p.waitForTimeout(200);
    out.settingsFromPause = await on('settingsscreen');
    await p.tap('#set-done'); await p.waitForTimeout(200);
    out.backToPause = await on('pause');
    await p.tap('#p-resume'); await p.waitForTimeout(300);
    // 3. finish the race
    await p.evaluate(()=>{ window.__PLAYERPHYS__.s = window.__FINISHS__ - 25; });
    await p.dispatchEvent('#tp-gas','pointerdown',{pointerId:7,pointerType:'touch',bubbles:true});
    for (let i=0;i<20;i++){ await p.waitForTimeout(500); if (await on('over')) break; }
    await p.dispatchEvent('#tp-gas','pointerup',{pointerId:7,pointerType:'touch',bubbles:true});
    out.results = await on('over');
    out.buttonsHidden = await p.evaluate(()=>getComputedStyle(document.getElementById('hud')).display==='none');
    out.againVisible = await p.evaluate(()=>{const r=document.getElementById('again').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.width>0;});
    await hide(); await p.screenshot({path:T+'c_results.png'});
    await p.waitForTimeout(1300);
    await p.tap('#again'); await p.waitForTimeout(1500);
    out.rideAgain = {hud: await on('hud'), over: await on('over'), pad: await p.evaluate(()=>getComputedStyle(document.getElementById('touchpad')).display)};
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
