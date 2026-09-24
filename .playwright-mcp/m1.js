async (page) => {
  const T='/Users/xavier/riderash/.playwright-mcp/';
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const hide=()=>p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
  const on=(id)=>p.evaluate((id)=>document.getElementById(id).classList.contains('on'), id);
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000}); await hide();
    out.startVisible = await p.evaluate(()=>{const r=document.getElementById('start').getBoundingClientRect(); return r.bottom<=innerHeight && r.top>=0;});
    out.hscroll = await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth || [...document.querySelectorAll('.screen.on')].some(s=>s.scrollWidth>s.clientWidth+1));
    await p.tap('#opensettings'); await p.waitForTimeout(300);
    out.settingsOpen = await on('settingsscreen');
    out.settingsFits = await p.evaluate(()=>{const s=document.getElementById('settingsscreen'); return {sw:s.scrollWidth,cw:s.clientWidth,sh:s.scrollHeight,ch:s.clientHeight};});
    await p.screenshot({path:T+'m_settings.png'});
    await p.tap('#set-done'); await p.waitForTimeout(300);
    out.backToTitle = await on('title');
    await p.tap('#design'); await p.waitForTimeout(1500); await hide();
    out.showroomOpen = await on('showroom');
    out.showroomFits = await p.evaluate(()=>{const s=document.getElementById('showroom'); const b=document.getElementById('s-done').getBoundingClientRect(); return {sw:s.scrollWidth,cw:s.clientWidth, doneReachable: b.width>0};});
    await p.screenshot({path:T+'m_showroom.png'});
    await p.evaluate(()=>document.getElementById('s-done').scrollIntoView());
    await p.tap('#s-done'); await p.waitForTimeout(800);
    out.afterShowroom = {title: await on('title'), showroom: await on('showroom')};
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
