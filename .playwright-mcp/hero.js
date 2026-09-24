async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:360,height:740}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out=[];
  p.on('pageerror', e=>errs.push(String(e)));
  const hy=()=>p.evaluate(()=>{let pl=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)pl=o.userData.__player}); const v=pl.group.getWorldPosition(new window.__THREE__.Vector3()); v.y+=0.9; v.project(window.__CAM__); return {y:+((1-v.y)/2).toFixed(2), mph:Math.round(pl.phys.mph)};});
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    await p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
    await p.tap('#start'); await p.waitForTimeout(1500); out.push(await hy());
    await p.waitForTimeout(2200); out.push(await hy());
    await p.dispatchEvent('#tp-gas','pointerdown',{pointerId:5,pointerType:'touch',bubbles:true});
    for (let i=0;i<5;i++){ await p.waitForTimeout(1000); out.push(await hy()); }
    await p.screenshot({path:'/Users/xavier/riderash/.playwright-mcp/hero_fast.png'});
    await p.dispatchEvent('#tp-gas','pointerup',{pointerId:5,pointerType:'touch',bubbles:true});
    const b=6; await p.dispatchEvent('#tp-brake','pointerdown',{pointerId:b,pointerType:'touch',bubbles:true});
    await p.waitForTimeout(4000); out.push(await hy());
    await p.screenshot({path:'/Users/xavier/riderash/.playwright-mcp/hero_slow.png'});
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
