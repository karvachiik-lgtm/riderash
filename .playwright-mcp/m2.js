async (page) => {
  const T='/Users/xavier/riderash/.playwright-mcp/';
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const hide=()=>p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000}); await hide();
    await p.tap('#design'); await p.waitForTimeout(1200);
    const sr = () => p.evaluate(()=>{const s=window.__SHOWROOMI__(); return {zoom:+s.zoom.toFixed(2), turn:+s.turnPhase.toFixed(2), h:s.spec.height};});
    out.stage = await p.evaluate(()=>{const r=document.getElementById('showstage').getBoundingClientRect(); return {h:Math.round(r.height)};});
    const cdp = await ctx.newCDPSession(p);
    const tp = (pts)=>pts.map((q,i)=>({x:q[0],y:q[1],id:i}));
    // one-finger drag turns
    const before = await sr();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:tp([[150,300]])});
    for (let x=160;x<=260;x+=20) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:tp([[x,300]])});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    out.drag = {before, after: await sr()};
    // pinch out zooms
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:tp([[180,300],[210,300]])});
    for (let d=40; d<=140; d+=20) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:tp([[195-d/2,300],[195+d/2,300]])});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    out.pinch = await sr();
    await p.waitForTimeout(400); await hide();
    await p.screenshot({path:T+'m_show_zoom.png'});
    // double tap resets
    for (let i=0;i<2;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:tp([[195,300]])}); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(120); }
    out.dbltap = await sr();
    // slider by touch drag
    const box = await p.evaluate(()=>{const e=document.getElementById('s-height'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y+r.height/2,w:r.width};});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:tp([[box.x+box.w*0.5,box.y]])});
    for (let f=0.55; f<=0.95; f+=0.1) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:tp([[box.x+box.w*f,box.y]])});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForTimeout(300);
    out.slider = await sr();
    // stance button
    await p.evaluate(()=>document.getElementById('showstage').scrollIntoView());
    const stand = await p.$('#s-pose button:nth-child(2)'); 
    if (stand) { out.standLabel = await stand.textContent(); await stand.tap(); await p.waitForTimeout(900); out.standSel = await stand.evaluate(b=>b.classList.contains('sel')); }
    await p.waitForTimeout(300); await hide(); await p.screenshot({path:T+'m_show_stand.png'});
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
