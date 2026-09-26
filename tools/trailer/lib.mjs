// shared: serve the repo, open the game at 1080p on the highest settings, frame-step it
import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), THREE_DIR = ROOT + '/tools/node_modules/three';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm' };
export async function serve(root = ROOT) {
  const server = http.createServer((q, s) => { const u = decodeURIComponent(new URL(q.url, 'http://x').pathname); const f = path.join(root, u === '/' ? 'index.html' : u);
    fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(b); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
export async function launch() {
  return chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
}
export async function openGame(browser, base, { w = 1920, h = 1080, career = { race: 3, cash: 60000 }, quality = 'high', settings = {} } = {}) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  await page.addInitScript(([c, q, st]) => {
    localStorage.setItem('riderash.settings.v1', JSON.stringify({ quality: q, master: 0, ...st }));
    localStorage.setItem('riderash.career.v1', JSON.stringify(c));
    window.__NO_INTRO__ = true;
  }, [career, quality, settings]);
  page.setDefaultTimeout(300000);           // a 1080p software frame can take a while under load
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.169\.0\/(.*)/, (r) => { const m = r.request().url().match(/three@0\.169\.0\/(.*)$/); r.fulfill({ path: path.join(THREE_DIR, m[1]), contentType: 'application/javascript' }); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 240000 });
  return page;
}
