// The studio from an idea to a game, in real Chrome on a real dev server started with no game, recorded: the start page,
// an idea typed and sent, a stand-in session (tests/stubs/loop-session.mjs: the bridge's real routes and the REAL build
// loop tools, no model) pitching three concepts, a concept picked on the page, the game made, the preview appearing on
// the right, and a verify (its browser run stood in) in the conversation.
// Run through the graphics-card gate:  gpu-run.sh node tests/studio-layout-demo.mjs <out dir> [port] [--keep]
// Writes <out>/demo.webm (the recording), <out>/demo-NN-*.png (one picture per step) and <out>/demo.json.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureBrowser } from '../lib/chrome.mjs';
import { GAMES, KIT_ROOT } from '../lib/paths.mjs';
import { startDevServer } from '../server/index.mjs';
import { loopSession } from './stubs/loop-session.mjs';

const args = process.argv.slice(2);
const out = path.resolve(args[0] ?? 'layout-demo'), port = Number(args[1] ?? 6045), keep = args.includes('--keep');
const W = Number(process.env.DEMO_W ?? 1440), H = Number(process.env.DEMO_H ?? 900);
await mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const notes = [], problems = [];
let n = 0;
const srv = await startDevServer({ port, log: () => {} });
const base = `http://127.0.0.1:${srv.port}`;
const b = await ensureBrowser({});
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: b.path, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...(process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean)] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: W, height: H } } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
const shot = async (name, what) => { await sleep(500); const f = `demo-${String(++n).padStart(2, '0')}-${name}.png`; await p.screenshot({ path: path.join(out, f) }); notes.push({ file: f, what }); console.log(`${f}\t${what}`); };
let st = null, game = null;
try {
  await p.goto(`${base}/studio/`);
  await p.waitForSelector('#start-input');
  await sleep(1200);
  await shot('start', 'The studio opened with no game: the start page. Nothing is playing. No session is connected yet, so the page says how to connect one.');
  st = await loopSession(base, { cwd: KIT_ROOT, onStep: s => console.log(`  session: ${s}`) });
  await sleep(4500);
  await shot('connected', 'A session connected (the stand-in, through the bridge\'s real routes): the line under the box says so.');
  await p.click('.idea >> nth=0');
  await sleep(600);
  await shot('idea', 'An idea from the chips, in the box (the person could type anything).');
  await p.click('#start-go');
  await p.waitForSelector('#chat-input', { timeout: 15000 });
  await sleep(1500);
  await shot('sent', 'Make it: the idea went to the session and the studio opened the new game\'s folder. The conversation is on the left; the right says the game appears once it is made.');
  game = await st.idea();
  await p.waitForSelector('[data-part=pitch] .concept-go', { timeout: 20000 });
  await sleep(800);
  await shot('pitch', 'The session pitched three concepts (the real pitch step checked them): they are cards in the conversation, each with "Make this one".');
  await p.locator('[data-part=pitch]').evaluate(e => e.scrollIntoView({ block: 'end' }));
  await p.click('[data-card=a] .concept-go');
  await sleep(800);
  await shot('picked', 'The person picked "Pillow Brawl": their pick is a message in the thread and goes to the session.');
  await st.choose();
  await p.waitForSelector('#tabs [role=tab]', { timeout: 30000 });
  await sleep(7000);
  await shot('made', 'The spec was locked and the game made (the real create): the page opened it. The preview is on the right, with the tools over it; the conversation keeps its thread.');
  await st.build();
  await p.waitForSelector('[data-part=verdict]', { timeout: 20000 });
  await sleep(1500);
  await shot('verified', 'The build round ended and verify ran (its browser run stood in by a passing verdict): the verdict is a message in the conversation, and the stages say the play-test is next.');
  await p.click('#tabs [role=tab][data-id=items]');
  await sleep(2500);
  await shot('tool', 'A tool open beside the game (Items): the conversation stays on the left.');
} catch (e) { problems.push(`stopped: ${e.stack ?? e.message}`); try { await shot('stopped', 'Where it stopped'); } catch {} }
finally {
  st?.close();
  const video = await p.video()?.path().catch(() => null);
  await ctx.close();
  if (video) await rename(video, path.join(out, 'demo.webm')).catch(() => {});
  await browser.close();
  await srv.close();
  if (errors.length) problems.push(`page errors: ${errors.join(' | ')}`);
  await writeFile(path.join(out, 'demo.json'), JSON.stringify({ when: new Date().toISOString(), size: [W, H], game, notes, problems }, null, 1));
  if (game && !keep) await rm(path.join(KIT_ROOT, game), { recursive: true, force: true });
  else if (game) console.log(`kept ${path.relative(GAMES, path.join(KIT_ROOT, game))}`);
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems');
}
