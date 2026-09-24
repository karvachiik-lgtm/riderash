async (page) => {
  const ctx = await page.context().browser().newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const p = await ctx.newPage();
  await p.goto('http://localhost:62170/__game__/riderash/');
  await p.waitForFunction(()=>window.__READY__, null, {timeout:60000});
  const r = await p.evaluate(()=>{
    const kids=[...document.body.children].map(e=>e.tagName+'#'+e.id+'.'+e.className+' sr='+!!e.shadowRoot+' z='+getComputedStyle(e).zIndex);
    const t=[...document.querySelectorAll('.screen.on')].map(e=>({id:e.id,sh:e.scrollHeight,ch:e.clientHeight,st:e.scrollTop,jc:getComputedStyle(e).justifyContent,ov:getComputedStyle(e).overflowY}));
    const start=document.getElementById('start').getBoundingClientRect();
    return {kids,t,start:{y:start.y,h:start.height}};
  });
  await ctx.close(); return r;
}
