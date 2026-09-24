async (page) => {
  const out={}; const errs=[];
  for (const [W,H,tag] of [[390,844,'p'],[667,375,'l']]) {
    const ctx = await page.context().browser().newContext({ viewport:{width:W,height:H}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const p = await ctx.newPage(); p.on('pageerror', e=>errs.push(String(e)));
    try {
      await p.goto('http://127.0.0.1:8787/');
      await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
      await p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
      await p.tap('#start'); await p.waitForTimeout(3500);
      await p.tap('#pausebtn'); await p.waitForTimeout(250);
      const lab = (id)=>p.evaluate((id)=>document.getElementById(id).textContent, id);
      const r = { paused: await p.evaluate(()=>document.getElementById('pause').classList.contains('on')), cam0: await lab('p-camera'), snd0: await lab('p-sound') };
      await p.tap('#p-camera'); await p.waitForTimeout(100); r.cam1 = await lab('p-camera');
      await p.tap('#p-sound'); await p.waitForTimeout(100); r.snd1 = await lab('p-sound');
      r.mutedAudio = await p.evaluate(()=>window.__AUDIO__.muted);
      r.allReachable = await p.evaluate(()=>[...document.querySelectorAll('#pausemenu .btn')].map(b=>{b.scrollIntoView({block:'nearest'}); const q=b.getBoundingClientRect(); return q.top>=0 && q.bottom<=innerHeight;}).every(Boolean));
      await p.evaluate(()=>document.getElementById('pause').scrollTop=0);
      await p.screenshot({path:`/Users/xavier/riderash/.playwright-mcp/pm_${tag}.png`});
      await p.tap('#p-resume'); await p.waitForTimeout(200);
      r.resumed = !(await p.evaluate(()=>document.getElementById('pause').classList.contains('on')));
      out[tag]=r;
    } catch(e) { errs.push(tag+' ERR '+e.message.slice(0,200)); }
    await ctx.close().catch(()=>{});
  }
  return {errs, out};
}
