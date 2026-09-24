async (page) => {
  const T='/Users/xavier/riderash/.playwright-mcp/';
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(String(e)));
  const hide=()=>p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
  try {
  await p.goto('http://127.0.0.1:8787/');
  await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
  await hide(); await p.screenshot({path:T+'ph_title.png'});
  await p.tap('#start'); await p.waitForTimeout(3800);
  var s0 = await p.evaluate(()=>window.__GAME__.s);
  await p.dispatchEvent('#tp-gas','pointerdown',{pointerId:7,pointerType:'touch',isPrimary:true,bubbles:true});
  await p.waitForTimeout(4000);
  var s1 = await p.evaluate(()=>window.__GAME__.s);
  await p.dispatchEvent('#tp-punch','pointerdown',{pointerId:8,pointerType:'touch',bubbles:true});
  await p.waitForTimeout(80);
  var punching = await p.evaluate(()=>{let pl=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)pl=o.userData.__player}); return pl && pl.fighter.active ? pl.fighter.active.kind : null;});
  await p.dispatchEvent('#tp-punch','pointerup',{pointerId:8,pointerType:'touch',bubbles:true});
  var heroY=[];
  for(let i=0;i<4;i++){ await p.waitForTimeout(300); heroY.push(await p.evaluate(()=>{let pl=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)pl=o.userData.__player}); const v=pl.group.getWorldPosition(new window.__THREE__.Vector3()); v.y+=0.9; v.project(window.__CAM__); return +((1-v.y)/2).toFixed(2);})); }
  await hide(); await p.screenshot({path:T+'ph_race.png'});
  await p.setViewportSize({width:844,height:390}); await p.waitForTimeout(1200); await hide();
  await p.screenshot({path:T+'ph_land.png'});
  var cls = await p.evaluate(()=>document.body.className);
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, s0, s1, punching, cls:typeof cls!=='undefined'?cls:null, heroY:typeof heroY!=='undefined'?heroY:null};
}
