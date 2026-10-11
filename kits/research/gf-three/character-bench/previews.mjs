#!/usr/bin/env node
// Body previews for library/bodies.json (Studio's slot picker, the lookdev bench): one 3/4-front idle shot per body on
// the real GPU, 320×400 JPEG → library/bodies/<id>.preview.jpg.   node research/gf-three/character-bench/previews.mjs
//   [--only id,id] (just these bodies)   BENCH_PORT=<port> when 5792 is taken by another checkout's bench server
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../../foundations/qa/browser.mjs';
import { serve } from './serve.mjs';
import { sharp } from '../tools/lib/char-deps.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lib = JSON.parse(readFileSync(join(here, '../library/bodies.json'), 'utf8'));
const PORT = +(process.env.BENCH_PORT ?? 5792);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
let server = null;
try { await fetch(`http://127.0.0.1:${PORT}/character-bench/`); } catch { server = await serve(PORT); }
const browser = await launchChrome({ gpu: 'webgl' });
for (const b of lib.bodies.filter(b => !only || only.includes(b.id))) {
  const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
  await page.goto(`http://127.0.0.1:${PORT}/character-bench/?body=${b.id}&notint`);
  await page.waitForFunction(() => window.__bench?.ready, null, { timeout: 90000 });
  await page.evaluate(h => { const B = window.__bench; document.getElementById('ui').style.display = 'none'; B.freeze(true); B.hidePlates(); B.advance(0.6);
    B.setOrbit({ yaw: 0.45, pitch: 0.1, dist: 0.35 + 1.75 * h, target: [0, h * 0.5, 0] }); }, b.height);
  await page.waitForTimeout(250);
  const png = await page.screenshot();
  await sharp(png).resize(320, 400).jpeg({ quality: 84, mozjpeg: true }).toFile(join(here, '../library/bodies', `${b.id}.preview.jpg`));
  console.log(`${b.id}.preview.jpg`);
  await page.close();
}
await browser.close();
server?.close();
