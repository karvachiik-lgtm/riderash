async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const vis=(id)=>p.evaluate((id)=>{const e=document.getElementById(id); return !!e && getComputedStyle(e).display!=='none' && e.offsetParent!==null;}, id);
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    out.assets = await p.evaluate(async()=>{const r={}; for (const u of ['manifest.webmanifest','icons/icon-192.png','icons/icon-512.png']) r[u]=(await fetch(u)).status; return r;});
    out.method0 = await p.evaluate(()=>window.__INPUTMETHOD__());
    await p.tap('#start'); await p.waitForTimeout(3800);
    await p.evaluate(()=>{const q=window.__PLAYERPHYS__; const a=q.advance.bind(q); window.__ST__=0; q.advance=(dt,inp)=>{ window.__ST__=inp?inp.steer:null; return a(dt,inp);};});
    out.padVisible = await vis('tp-steer');
    const box = await p.evaluate(()=>{const r=document.getElementById('tp-steer').getBoundingClientRect(); return {x:r.left,w:r.width,y:r.top+r.height/2};});
    const cx = box.x + box.w/2, half = box.w/2;
    const steerAt = async (frac) => {
      await p.dispatchEvent('#tp-steer','pointerdown',{pointerId:11,pointerType:'touch',clientX:cx+frac*half,clientY:box.y,bubbles:true});
      await p.waitForTimeout(120);
      const v = await p.evaluate(()=>+window.__ST__.toFixed(2));
      await p.dispatchEvent('#tp-steer','pointerup',{pointerId:11,pointerType:'touch',clientX:cx+frac*half,clientY:box.y,bubbles:true});
      await p.waitForTimeout(60);
      return v;
    };
    out.steer = { centre: await steerAt(0.04), right30: await steerAt(0.3), right60: await steerAt(0.6), left_edge: await steerAt(-0.98), right_edge: await steerAt(0.98) };
    // drag: press centre then move right
    await p.dispatchEvent('#tp-steer','pointerdown',{pointerId:12,pointerType:'touch',clientX:cx,clientY:box.y,bubbles:true});
    await p.dispatchEvent('#tp-steer','pointermove',{pointerId:12,pointerType:'touch',clientX:cx+half*0.5,clientY:box.y,bubbles:true});
    await p.waitForTimeout(120); out.dragged = await p.evaluate(()=>+window.__ST__.toFixed(2));
    await p.dispatchEvent('#tp-steer','pointerup',{pointerId:12,pointerType:'touch',bubbles:true});
    await p.waitForTimeout(100); out.afterRelease = await p.evaluate(()=>window.__ST__);
    // BACKSTOP: GAS held by a pointer whose pointerup never arrives; then the last real finger lifts elsewhere
    await p.dispatchEvent('#tp-gas','pointerdown',{pointerId:13,pointerType:'touch',bubbles:true});
    out.gasHeld = await p.evaluate(()=>document.getElementById('tp-gas').classList.contains('on'));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:420,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForTimeout(80);
    out.gasAfterLastFinger = await p.evaluate(()=>document.getElementById('tp-gas').classList.contains('on'));
    // input method follows use
    await p.keyboard.press('KeyW'); await p.waitForTimeout(400);
    out.afterKey = { method: await p.evaluate(()=>window.__INPUTMETHOD__()), pad: await vis('touchpad') };
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:420,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForTimeout(100);
    out.afterTouch = { method: await p.evaluate(()=>window.__INPUTMETHOD__()), pad: await vis('touchpad') };
    // settings: touch pad OFF sticks through touches, then AUTO again
    await p.tap('#pausebtn'); await p.waitForTimeout(150); await p.tap('#p-settings'); await p.waitForTimeout(150);
    await p.selectOption('#set-touch','off'); await p.tap('#set-done'); await p.tap('#p-resume'); await p.waitForTimeout(200);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:420,id:3}]}); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    out.settingOff = { pad: await vis('touchpad'), saved: await p.evaluate(()=>JSON.parse(localStorage.getItem('riderash.settings.v1')).touch) };
    await p.evaluate(()=>{ const s=document.getElementById('set-touch'); s.value='auto'; s.dispatchEvent(new Event('change')); });
    out.settingAuto = { pad: await vis('touchpad') };
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
