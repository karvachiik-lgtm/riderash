async (page) => {
  const T='/Users/xavier/riderash/.playwright-mcp/';
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; const out={};
  p.on('pageerror', e=>errs.push(String(e)));
  const hide=()=>p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
  let pid=20;
  const down=(id)=>p.dispatchEvent('#'+id,'pointerdown',{pointerId:++pid,pointerType:'touch',bubbles:true}).then(()=>pid);
  const up=(id,i)=>p.dispatchEvent('#'+id,'pointerup',{pointerId:i,pointerType:'touch',bubbles:true});
  const tapBtn=async(id)=>{const i=await down(id); await p.waitForTimeout(40); await up(id,i);};
  const ph=()=>p.evaluate(()=>{const q=window.__PLAYERPHYS__; return {speed:+q.speed.toFixed(1), lat:+q.lateral.toFixed(2), boost:+(q.boost||0).toFixed(2), s:+q.s.toFixed(0)};});
  const fighter=()=>p.evaluate(()=>{let pl=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)pl=o.userData.__player}); const f=pl.fighter; return {active:f.active?f.active.kind:null, stamina:Math.round(f.stamina)};});
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000}); await hide();
    await p.tap('#start'); await p.waitForTimeout(3800);
    // record the input the physics actually receives
    await p.evaluate(()=>{const q=window.__PLAYERPHYS__; const a=q.advance.bind(q); window.__LASTIN__={}; q.advance=(dt,inp)=>{ if(inp && inp.tuck) window.__LASTIN__.tuck=true; return a(dt,inp);};});
    const gas = await down('tp-gas');
    await p.waitForTimeout(3000); out.gas = await ph();
    const tk = await down('tp-tuck'); await p.waitForTimeout(300); out.tuckSeen = await p.evaluate(()=>!!window.__LASTIN__.tuck); await up('tp-tuck',tk);
    await tapBtn('tp-boost'); await p.waitForTimeout(100); out.boost = await ph();
    let l0=(await ph()).lat; const L=await down('tp-left'); await p.waitForTimeout(700); await up('tp-left',L); out.left = +( (await ph()).lat - l0).toFixed(2);
    l0=(await ph()).lat; const R=await down('tp-right'); await p.waitForTimeout(700); await up('tp-right',R); out.right = +((await ph()).lat - l0).toFixed(2);
    out.attacks={};
    for (const k of ['punch','kick','chain','grapple']) { await p.waitForTimeout(900); await tapBtn('tp-'+k); await p.waitForTimeout(30); out.attacks[k]=(await fighter()).active; }
    await up('tp-gas',gas);
    const v0=(await ph()).speed; const B=await down('tp-brake'); await p.waitForTimeout(1000); await up('tp-brake',B); out.brake={from:v0,to:(await ph()).speed};
    // camera + mute buttons
    const cm0 = await p.evaluate(()=>JSON.parse(localStorage.getItem('riderash.settings.v1')||'{}').camMode);
    await p.tap('#cambtn'); await p.waitForTimeout(200);
    out.cam = {before:cm0, after: await p.evaluate(()=>{for(const k of Object.keys(localStorage)) if(/setting/i.test(k)) return JSON.parse(localStorage.getItem(k)).camMode;}), warn: await p.evaluate(()=>document.getElementById('warn').textContent)};
    await p.tap('#cambtn'); await p.waitForTimeout(100);
    for (let i=0;i<5;i++){ await p.tap('#cambtn'); await p.waitForTimeout(60);} // back round to start
    await p.tap('#mutebtn'); await p.waitForTimeout(100);
    out.mute = await p.evaluate(()=>document.getElementById('mutebtn').textContent);
    await p.tap('#mutebtn');
    // grapple context: fake a hold both ways
    out.ctx = await p.evaluate(async()=>{let pl=null; window.__SCENE__.traverse(o=>{if(o.userData&&o.userData.__player)pl=o.userData.__player}); const f=pl.fighter; const r=window.__RIVALS__[0].fighter;
      f.hold={target:r,t:0}; await new Promise(z=>setTimeout(z,120)); const lab=document.getElementById('tp-grapple').textContent; f.hold=null;
      f.heldBy=r; await new Promise(z=>setTimeout(z,120)); const mash=document.getElementById('tp-kick').classList.contains('mash'); f.heldBy=null;
      await new Promise(z=>setTimeout(z,120)); return {holdLabel:lab, mash, after:document.getElementById('tp-grapple').textContent};});
    // pause via HUD button, then resume
    const g2 = await down('tp-gas');
    await p.tap('#pausebtn'); await p.waitForTimeout(200);
    out.pause = {on: await p.evaluate(()=>document.getElementById('pause').classList.contains('on')), gasReleased: await p.evaluate(()=>!document.getElementById('tp-gas').classList.contains('on'))};
    await hide(); await p.screenshot({path:T+'r_pause.png'});
    await p.tap('#p-resume'); await p.waitForTimeout(300);
    out.resumed = await p.evaluate(()=>!document.getElementById('pause').classList.contains('on') && document.getElementById('hud').classList.contains('on'));
    // a finger on the road must not steer any more
    const lat0=(await ph()).lat; await p.dispatchEvent('#c','pointerdown',{pointerId:99,pointerType:'touch',clientX:10,clientY:400,bubbles:true}); await p.waitForTimeout(600); await p.dispatchEvent('#c','pointerup',{pointerId:99,pointerType:'touch',clientX:10,clientY:400,bubbles:true});
    out.canvasZoneDrift = +((await ph()).lat-lat0).toFixed(2);
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {errs, out};
}
