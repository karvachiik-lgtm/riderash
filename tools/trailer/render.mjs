// node render.mjs <shot...> [--preview]
//   full:    every frame at 1920x1080 JPEG -> frames/<shot>/00000.jpg
//   preview: steps every frame but saves 3 stills at 960x540 -> preview/<shot>-k.jpg
import fs from 'node:fs';
import { serve, launch, openGame } from './lib.mjs';
import { SHOTS, HELPERS } from './shots.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const PREVIEW = process.argv.includes('--preview');
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { server, base } = await serve();
const browser = await launch();

for (const name of names) {
  const S = SHOTS[name];
  if (!S) { console.log('no shot', name); continue; }
  const t0 = Date.now();
  const page = await openGame(browser, base, PREVIEW ? { w: 960, h: 540 } : {});
  await page.evaluate(HELPERS);
  await page.evaluate(() => { window.__HOLD__ = true; });
  if (S.map !== undefined || S.race) await page.evaluate((m) => window.__STARTRACE(m), S.map || null);
  await page.evaluate(`(${S.setup.toString().replace(/^setup/, 'function')})(window)`);
  await page.evaluate((h) => document.body.classList.toggle('nohud', !h), !!S.hud);
  const out = PREVIEW ? HERE + (process.env.PREV || 'preview') : HERE + 'frames/' + name;
  fs.mkdirSync(out, { recursive: true });
  const keep = PREVIEW ? new Set([0, Math.floor(S.n / 2), S.n - 1]) : null;
  const frameSrc = S.frame.toString().replace(/^frame/, 'function');
  const capSrc = S.capFn ? S.capFn.toString().replace(/^capFn/, 'function') : null;
  for (let i = 0; i < S.n; i++) {
    const render = !keep || keep.has(i);
    await page.evaluate(`(() => {
      const W = window, i = ${i}, n = ${S.n};
      const dt = (${frameSrc})(W, i, n) || 1 / 24;
      W.__SIM__(dt, false, dt);
      ${S.post ? `(${S.post.toString().replace(/^post/, 'function')})(W, i, n);` : ''}
      const cap = ${JSON.stringify(S.cap || null)};
      let c = null;
      ${capSrc ? `c = (${capSrc})(W, i, n);` : `if (cap) { const a = cap.from ?? 6, b = cap.to ?? n; c = { t: cap.t, s: cap.s, k: Math.min((i - a) / 8, (b - i) / 8) }; }`}
      W.__CAP(c && c.t, c && c.s, c ? c.k : 0);
      if (${render}) W.__RENDER__();
    })()`);
    if (render) await page.screenshot({ path: PREVIEW ? `${out}/${name}-${i}.jpg` : `${out}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: PREVIEW ? 80 : 93 });
  }
  console.log(`${name}: ${S.n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s${page.errors.length ? '  ERRORS ' + page.errors.join(' | ') : ''}`);
  await page.context().close();
}
await browser.close(); server.close();
