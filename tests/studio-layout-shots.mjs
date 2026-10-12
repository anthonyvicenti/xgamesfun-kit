// The studio's views at three screen sizes, in real Chrome on a real dev server (its own games folder in a temp
// directory): the start page, a game the build loop is pitching (the concepts waiting on the person), and two made
// games (a 3D one and a 2D one) with no tool open and with each tool open. Checks that no view scrolls sideways.
// Run through the graphics-card gate:  gpu-run.sh node tests/studio-layout-shots.mjs <out dir> [port]
// Writes <out>/<size>/<NN>-<view>.jpg, <out>/contact-<size>.jpg and <out>/shots.json. SHOT_SIZES=laptop narrows a run.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGame } from '../lib/create.mjs';
import { ensureBrowser } from '../lib/chrome.mjs';
import { startDevServer } from '../server/index.mjs';
import { call, pillowPitch } from './stubs/loop-session.mjs';

const out = path.resolve(process.argv[2] ?? 'layout-shots'), port = Number(process.argv[3] ?? 6045);
const SIZES = [['4k', 3840, 2160], ['laptop', 1440, 900], ['phone', 390, 844]].filter(([n]) => !process.env.SHOT_SIZES || process.env.SHOT_SIZES.split(',').includes(n));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = await mkdtemp(path.join(os.tmpdir(), 'gf-layout-shots-'));
const games = path.join(root, 'games');
await mkdir(games, { recursive: true });
await createGame(path.join(games, 'pillow-brawl'), { spec: new URL('./fixtures/pillow-brawl.spec.json', import.meta.url).pathname });
await createGame(path.join(games, 'coin-hop'), { from: 'coin-hop' });
// a game the build loop is pitching: the real pitch step, the concepts accepted, waiting on the person's pick
const pitching = path.join(games, 'pillow-fight-backyard-friends');
await call('gamesfun_step_pitch', { game: pitching, idea: 'A pillow fight in a backyard with my friends' });
const pitched = await call('gamesfun_step_spec', { game: pitching, pitch: await pillowPitch() });
if (pitched.valid !== true) throw new Error(`the stand-in pitch was refused: ${JSON.stringify(pitched).slice(0, 400)}`);

const srv = await startDevServer({ gamesRoot: games, port, log: () => {}, watch: false });
const base = `http://127.0.0.1:${srv.port}`;
const open = name => fetch(`${base}/api/studio/project`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ name }) });
const b = await ensureBrowser({});
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: b.path, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...(process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean)] });
const shots = [];
try {
  for (const [size, w, h] of SIZES) {
    await mkdir(path.join(out, size), { recursive: true });
    let n = 0;
    const page = async () => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
      return p;
    };
    const shot = async (p, view, label) => {
      const file = path.join(size, `${String(++n).padStart(2, '0')}-${view}.jpg`);
      const width = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      await p.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 86, fullPage: size === 'phone' });
      shots.push({ file, size, view, label, sideways: width[0] > width[1], errors: [...p.errors] });
      console.log(`${file}\t${width[0] > width[1] ? `SIDEWAYS ${width[0]} > ${width[1]}` : 'ok'}${p.errors.length ? `\terrors: ${p.errors.join(' | ')}` : ''}`);
      p.errors.length = 0;
    };
    // the start page
    await open(null);
    let p = await page();
    await p.goto(`${base}/studio/`); await p.waitForSelector('#start-input'); await sleep(1500);
    await shot(p, 'start', 'Start page');
    await p.context().close();
    // a game being pitched
    await open('pillow-fight-backyard-friends');
    p = await page();
    await p.goto(`${base}/studio/`); await p.waitForSelector('[data-part=pitch]', { timeout: 15000 }); await sleep(1200);
    await shot(p, 'pitching', 'A new game: the concepts waiting on the pick');
    await p.context().close();
    // two made games, each tool
    for (const g of ['pillow-brawl', 'coin-hop']) {
      await open(g);
      p = await page();
      await p.goto(`${base}/studio/`); await p.waitForSelector('#tabs [role=tab]', { timeout: 20000 }); await sleep(5000);
      await shot(p, `${g}-game`, `${g}: no tool open`);
      const tabs = await p.$$eval('#tabs [role=tab]', els => els.map(e => ({ id: e.dataset.id, label: e.textContent.trim() })));
      for (const t of tabs) {
        await p.click(`#tabs [role=tab][data-id="${t.id}"]`); await sleep(1800);
        await shot(p, `${g}-${t.id}`, `${g}: ${t.label}`);
      }
      await p.context().close();
    }
  }
  await writeFile(path.join(out, 'shots.json'), JSON.stringify({ at: new Date().toISOString(), shots }, null, 1));
  for (const [size] of SIZES) {
    const list = shots.filter(s => s.size === size), cell = size === 'phone' ? 220 : 520, cols = size === 'phone' ? 6 : 4;
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0a0c16;color:#f4f4f5;font:13px Arial,sans-serif;padding:12px}.g{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:10px}figure{margin:0}figure>div{${size === 'phone' ? 'height:900px;overflow:hidden;' : ''}border:1px solid #343b50}img{width:${cell}px;display:block}figcaption{padding:4px 0 8px}</style><h1 style="font-size:18px">${size} · ${new Date().toISOString().slice(0, 10)}</h1><div class="g">${list.map(s => `<figure><div><img src="${pathToFileURL(path.join(out, s.file)).href}"></div><figcaption>${s.label}${s.sideways ? ' · SIDEWAYS' : ''}</figcaption></figure>`).join('')}</div>`;
    const f = path.join(out, `contact-${size}.html`);
    await writeFile(f, html);
    const pg = await browser.newPage({ viewport: { width: cols * (cell + 10) + 24, height: 800 } });
    await pg.goto(pathToFileURL(f).href); await sleep(800);
    await pg.screenshot({ path: path.join(out, `contact-${size}.jpg`), type: 'jpeg', quality: 85, fullPage: true });
    await pg.close();
    await rm(f, { force: true });
  }
  const bad = shots.filter(s => s.sideways), errs = shots.filter(s => s.errors.length);
  console.log(`${shots.length} shots; sideways scroll: ${bad.length ? bad.map(s => s.file).join(', ') : 'none'}; page errors: ${errs.length}`);
} finally {
  await browser.close();
  await srv.close();
  await rm(root, { recursive: true, force: true });
}
