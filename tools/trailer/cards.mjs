// node cards.mjs  -> frames/intro/*.jpg (4 s) and frames/outro/*.jpg (5.5 s) at 24 fps
import fs from 'node:fs';
import { serve, launch } from './lib.mjs';
const HERE = new URL('.', import.meta.url).pathname;
import { ROOT } from './lib.mjs';
fs.mkdirSync(ROOT + '/tools/out', { recursive: true });
fs.copyFileSync(HERE + 'cards.html', ROOT + '/tools/out/_cards.html');
const { server, base } = await serve();
const b = await launch();
const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.goto(base + '/tools/out/_cards.html');
await page.evaluate(() => document.fonts.ready);
for (const [name, secs] of [['intro', 4.0], ['outro', 5.5]]) {
  const dir = HERE + 'frames/' + name; fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(secs * 24);
  for (let i = 0; i < n; i++) {
    await page.evaluate(([nm, t]) => window.setCard(nm, t), [name, i / 24]);
    await page.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
  }
  console.log(name, n, 'frames');
}
fs.unlinkSync(ROOT + '/tools/out/_cards.html');
await b.close(); server.close();
