async (page) => {
  const W=390, H=844, TAG='p390';
  const T='/Users/xavier/riderash/.playwright-mcp/';
  const ctx = await page.context().browser().newContext({ viewport:{width:W,height:H}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; let res=null;
  p.on('pageerror', e=>errs.push(String(e)));
  try {
    await p.goto('http://127.0.0.1:8787/');
    await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
    await p.evaluate(()=>{const e=document.getElementById('__tdt'); if(e) e.style.display='none';});
    await p.tap('#start'); await p.waitForTimeout(5000);
    res = await p.evaluate(()=>{
      const sel = ['.tp','#tp-steer','.hb','#hud .hud-tl','#hud .hud-tr','#hud .hud-br','#boxes','#healthlab','#stamlab','#combobar','#radar','#target'];
      const items=[];
      for (const s of sel) for (const e of document.querySelectorAll(s)) {
        const cs=getComputedStyle(e); if (cs.display==='none'||cs.visibility==='hidden') continue;
        const r=e.getBoundingClientRect(); if (!r.width||!r.height) continue;
        items.push({n:e.id||(s+'#'+[...document.querySelectorAll(s)].indexOf(e)), r:{l:r.left,t:r.top,rt:r.right,b:r.bottom,w:r.width,h:r.height}, btn:e.tagName==='BUTTON'});
      }
      const hit=[], off=[], small=[];
      for (let i=0;i<items.length;i++){ const a=items[i].r;
        if (a.l<0||a.t<0||a.rt>innerWidth||a.b>innerHeight) off.push(items[i].n);
        if (items[i].btn && (a.w<44||a.h<32)) small.push(items[i].n+' '+Math.round(a.w)+'x'+Math.round(a.h));
        for (let j=i+1;j<items.length;j++){ const b=items[j].r;
          const ox=Math.min(a.rt,b.rt)-Math.max(a.l,b.l), oy=Math.min(a.b,b.b)-Math.max(a.t,b.t);
          if (ox>1&&oy>1) hit.push(items[i].n+' × '+items[j].n+' ('+Math.round(ox)+'x'+Math.round(oy)+')'); } }
      return {n:items.length, hit, off, small, portrait: document.body.classList.contains('portrait')};
    });
    await p.screenshot({path:T+'lay_'+TAG+'.png'});
  } catch(e) { errs.push('ERR '+e.message.slice(0,300)); }
  await ctx.close().catch(()=>{}); return {TAG, errs, res};
}
