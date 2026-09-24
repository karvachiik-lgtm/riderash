async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  let pid=40;
  const down=(id)=>p.dispatchEvent('#'+id,'pointerdown',{pointerId:++pid,pointerType:'touch',bubbles:true}).then(()=>pid);
  const up=(id,i)=>p.dispatchEvent('#'+id,'pointerup',{pointerId:i,pointerType:'touch',bubbles:true});
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    await p.tap('#start'); await p.waitForTimeout(3800);
    await p.evaluate(()=>{const q=window.__PLAYERPHYS__; const a=q.advance.bind(q); window.__ST__=[]; q.advance=(dt,inp)=>{ window.__ST__.push(inp?inp.steer:null); return a(dt,inp);};});
    const g=await down('tp-gas'); await p.waitForTimeout(1500);
    for (const side of ['left','right']) {
      await p.evaluate(()=>window.__ST__=[]);
      const i=await down('tp-'+side); await p.waitForTimeout(400); 
      out[side]={steer: await p.evaluate(()=>window.__ST__.slice(-3)), yaw0:null};
      await up('tp-'+side,i); await p.waitForTimeout(100);
      out[side].afterRelease = await p.evaluate(()=>window.__ST__.slice(-1)[0]);
    }
    // two fingers at once: steer right while holding gas and punching
    const r=await down('tp-right'); const pu=await down('tp-punch'); await p.waitForTimeout(60);
    out.combo = await p.evaluate(()=>{let pl=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)pl=o.userData.__player}); return {steer:window.__ST__.slice(-1)[0], attack: pl.fighter.active&&pl.fighter.active.kind, gasHeld: document.getElementById('tp-gas').classList.contains('on')};});
    await up('tp-punch',pu); await up('tp-right',r); await up('tp-gas',g);
    out.sync = await p.evaluate(()=>{const t=window.__TOUCHPAD__; t.sync({hold:{}}); const a=document.getElementById('tp-grapple').textContent; t.sync({}); const b=document.getElementById('tp-grapple').textContent; return {holding:a, after:b};});
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
