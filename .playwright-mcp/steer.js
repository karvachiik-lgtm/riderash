async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:1280,height:720} });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const run = async (throttleCpu) => {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    await p.click('#start'); await p.waitForTimeout(4500);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(1500);
    if (throttleCpu) { const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate',{rate:throttleCpu}); }
    const yawA = await p.evaluate(()=>window.__PLAYERPHYS__.yawOffset);
    await p.keyboard.down('KeyA');
    const r = await p.evaluate(async () => {
      let sim=0, last=performance.now(), frames=0;
      while (sim < 1.5 && frames < 2000) { await new Promise(r=>requestAnimationFrame(r)); const now=performance.now(); sim += Math.min(0.05,(now-last)/1000); last=now; frames++; }
      return { sim, frames, yaw: window.__PLAYERPHYS__.yawOffset, mph: Math.round(window.__PLAYERPHYS__.mph) };
    });
    await p.keyboard.up('KeyA'); await p.keyboard.up('KeyW');
    if (throttleCpu) { const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate',{rate:1}); }
    return { deg: +((Math.abs(r.yaw - yawA))*180/Math.PI).toFixed(1), frames: r.frames, mph: r.mph };
  };
  try { out.normal = await run(0); out.slow = await run(12); } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
