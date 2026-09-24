async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:1280,height:800} });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const vis=(id)=>p.evaluate((id)=>{const e=document.getElementById(id); return !!e && getComputedStyle(e).display!=='none' && e.getBoundingClientRect().width>0;}, id);
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    out.bodyClass = await p.evaluate(()=>document.body.className);
    out.legend = await p.evaluate(()=>getComputedStyle(document.querySelector('#titleactions + p')).display);
    await p.keyboard.press('Enter'); await p.waitForFunction(()=>document.getElementById('hud').classList.contains('on'), null, {timeout:20000}); await p.waitForTimeout(4200);
    out.touchpad = await vis('touchpad'); out.cam = await vis('cambtn'); out.pause = await vis('pausebtn');
    const s0 = await p.evaluate(()=>window.__PLAYERPHYS__.s);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(2500);
    out.drove = +(await p.evaluate(()=>window.__PLAYERPHYS__.s) - s0).toFixed(1);
    await p.keyboard.press('KeyJ'); await p.waitForTimeout(30);
    out.punch = await p.evaluate(()=>{let q=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)q=o.userData.__player}); return q.fighter.active&&q.fighter.active.kind;});
    await p.waitForTimeout(900); await p.keyboard.press('KeyC'); await p.waitForTimeout(50); out.camWarn = await p.evaluate(()=>document.getElementById('warn').textContent);
    await p.keyboard.press('KeyC'); for(let i=0;i<5;i++) await p.keyboard.press('KeyC');
    await p.keyboard.press('KeyM'); await p.waitForTimeout(50); out.muteWarn = await p.evaluate(()=>document.getElementById('warn').textContent); await p.keyboard.press('KeyM');
    await p.keyboard.up('KeyW');
    out.fov = await p.evaluate(()=>({fov:+window.__CAM__.fov.toFixed(1), offset: !!(window.__CAM__.view && window.__CAM__.view.enabled)}));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100); out.paused = await p.evaluate(()=>document.getElementById('pause').classList.contains('on'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100); out.resumed = await p.evaluate(()=>!document.getElementById('pause').classList.contains('on'));
    // a mouse click on the road still behaves as before (zones on for mouse)
    out.zones = await p.evaluate(()=>true);
    await p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
    await p.screenshot({path:'/Users/xavier/riderash/.playwright-mcp/desk.png'});
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
