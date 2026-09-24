async (page) => {
  const T='/Users/xavier/riderash/.playwright-mcp/';
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(String(e)));
  const hide=()=>p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
  await p.goto('http://localhost:62170/__game__/riderash/');
  await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
  await hide(); await p.screenshot({path:T+'ph_title.png'});
  await p.tap('#start'); await p.waitForTimeout(3800);
  await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w'})));
  await p.waitForTimeout(6000); await hide(); await p.screenshot({path:T+'ph_race.png'});
  await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC',key:'c'})));
  await p.waitForTimeout(1500); await p.screenshot({path:T+'ph_race2.png'});
  const info = await p.evaluate(()=>({fov:+document.querySelector('canvas').width, gs:window.__GAME__.s, draws:window.__GAME__.draws}));
  await ctx.close(); return {errs, info};
}
