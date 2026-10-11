// Screenshots of the studio page in each state, in real Chrome, on a real dev server with the session routes STUBBED
// (tests/stubs/session-stub.mjs). Run through the graphics-card gate:  gpu-run.sh node tests/studio-shots.mjs <out dir> <port>
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGame } from '../lib/create.mjs';
import { ensureBrowser } from '../lib/chrome.mjs';
import { startDevServer } from '../server/index.mjs';
import { attachSessionStub } from './stubs/session-stub.mjs';

const out = path.resolve(process.argv[2] ?? 'shots'), basePort = Number(process.argv[3] ?? 5915);
await mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = path.join(os.tmpdir(), `gf-studio-shots-${process.pid}`);
const b = await ensureBrowser({});
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: b.path, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...(process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean)] });
const servers = [];
const results = [];
const note = (file, what) => { results.push({ file, what }); console.log(`${file}\t${what}`); };

async function boot(example, port) {
  const dir = path.join(root, example);
  await createGame(dir, { from: example });
  const srv = await startDevServer({ gameDir: dir, port, log: () => {}, watch: false });
  servers.push(srv);
  return { srv, dir, stub: attachSessionStub(srv), url: `http://127.0.0.1:${srv.port}/studio/` };
}
async function page(w, h, url) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.errors = errors;
  await p.goto(url, { waitUntil: 'load' });
  return p;
}
const tab = async (p, id) => { await p.click(`#tabs button[data-id="${id}"]`); await sleep(500); };
const shot = async (p, name, what) => { await sleep(400); await p.screenshot({ path: path.join(out, `${name}.png`) }); note(`${name}.png`, what); };
const noSideScroll = async (p, name) => { const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); if (w[0] > w[1]) console.log(`SIDEWAYS SCROLL on ${name}: ${w[0]} > ${w[1]}`); return w[0] <= w[1]; };

try {
  const party = await boot('soak-squad', basePort);
  const { stub } = party;
  const pastDesktop = [];

  for (const [label, w, h] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
    stub.events.length = 0; stub.requests.length = 0; stub.permissions.length = 0; stub.decisions.length = 0; stub.n = 1; stub.session.state = 'idle'; stub.session.connected = false;
    const p = await page(w, h, party.url);
    await sleep(1200);
    // idle: the session started, did a turn, stopped; no wait open
    stub.emit('session-start', { cwd: '/stub', source: 'startup' });
    stub.emit('prompt', { text: 'Make the arena bigger' });
    stub.emit('tool-start', { tool: 'Edit', input: { file_path: 'config/world.json' } });
    stub.emit('tool-end', { tool: 'Edit', ok: true });
    stub.emit('stop', { allowed: true, reasons: [], lastMessage: 'Done' });
    await tab(p, 'session');
    await shot(p, `${label}-1-session-idle`, 'Session tab, idle with no wait open: press Enter in the terminal; timeline of what the session did');
    // a request waiting, with a selection chip
    await tab(p, 'assets');
    await p.click('.row .name.pick >> nth=0');
    await tab(p, 'session');
    await p.fill('textarea.ask', 'Make the first thing on the list twice as big');
    await shot(p, `${label}-2-request-chip`, 'Session tab, request typed, selection chip (the slot picked in Slots & assets) travels with it');
    await p.click('text=Send to your session');
    await sleep(600);
    await shot(p, `${label}-3-request-waiting`, 'Request waiting for the session, with Edit and Remove; chip shown on the request');
    // handed, then done, and one dropped
    const mk = (id, text, state) => ({ id, text, selection: null, session: 's1', state, via: null, created: Date.now(), handed: null, seen: null, done: null, note: null, refusals: 0 });
    stub.requests.push(mk('r_x_8', 'Swap the ground for sand', 'done'), mk('r_x_9', 'Add a boss', 'dropped'));
    stub.requests[0].state = 'handed';
    stub.session.connected = true; stub.session.state = 'idle'; stub.session.permissionMode = 'acceptEdits';
    await sleep(3400);
    await shot(p, `${label}-4-request-done`, 'Requests: handed over, done, and not done (Send again); session is listening');
    // permission
    stub.ask('Bash', { command: 'npx gamesfun verify --quick games/soak-squad' });
    await sleep(500);
    await shot(p, `${label}-5-permission`, 'Permission card with Allow and Deny and the note that the terminal prompt is also live; the own permission mode of the session is noted');
    await p.click('.perm >> text=Allow'); await sleep(500);
    if (stub.decisions[0]?.decision !== 'allow') console.log('PERMISSION NOT POSTED');
    // build: verdict with a failure
    const ev = path.join(party.dir, 'evidence', 'verify-1'); await mkdir(ev, { recursive: true });
    await writeFile(path.join(ev, 'verdict.json'), JSON.stringify({ pass: false, quick: true, seconds: 120, checks: [
      { n: 3, name: 'Plays end to end', ok: true, detail: '' },
      { n: 15, name: 'The loop is alive', ok: false, detail: 'waves: no enemy came closer than 2 m in 30 s. Rule: every mechanic shows a sign of life. Fix: check waves.target in config/game.json and the spawn rate.' }] }));
    await mkdir(path.join(party.dir, '.gf-loop'), { recursive: true });
    await writeFile(path.join(party.dir, '.gf-loop', 'state.json'), JSON.stringify({
      schema: 'gf-loop/1', kind: 'build', status: 'building', step: 'repair', why: 'the full verify failed: a repair round with each failed check\'s rule and fix', round: 2, repairs: 1, rescues: 0, verifies: 2, playtests: 1,
      verify: { n: 1, ok: false, playable: true, hash: 'x', at: new Date().toISOString(), failed: ['15'] },
      playtest: { round: 1, ok: false, verdict: 'fail', at: new Date().toISOString() }, pt: { notes: ['The enemies stand still at the far end of the arena.', 'The score never moves while I shoot.'] },
      fixes: [{ round: 1, fix: 'fair-on', file: 'config/game.json', pointer: '/fair/on', line: 'x' }], outcome: null,
      history: [{ step: 'create', next: 'agent', why: '', at: new Date().toISOString() }, { step: 'agent', next: 'fix', why: '', at: new Date().toISOString() }, { step: 'verify', next: 'repair', why: '', at: new Date().toISOString() }] }));
    await tab(p, 'build'); await sleep(2500);
    await shot(p, `${label}-6-build-verdict`, 'Build tab: step, round, failing check with its rule and fix, play-tester notes, automatic fixes, roll back (none saved yet)');
    // tune
    await tab(p, 'tune'); await sleep(600);
    await p.evaluate(() => { const r = document.querySelector('.row.tune input[type=range]'); if (r) { r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); } });
    await shot(p, `${label}-7-tune`, 'Tune tab on the party game: sliders and switches, each marked "applies with a reload", one edit staged');
    await p.close();
    pastDesktop.push(label);
  }

  // phone width: nothing scrolls sideways
  const phone = await page(390, 844, party.url);
  for (const id of ['session', 'build', 'assets', 'tune', 'verify', 'friends']) { await tab(phone, id); await noSideScroll(phone, `phone ${id}`); }
  await phone.close();

  // friend joined: a real room in the preview, a second tab joined by the room code
  const host = await page(1280, 800, party.url);
  await tab(host, 'friends');
  await host.click('text=1. Host a room in the preview');
  await sleep(2500);
  const fr = host.frames().find(f => f.parentFrame() === host.mainFrame());
  await fr.fill('#gfp-name', 'Hosta'); await fr.click('#gfp-host');
  await sleep(3000);
  await shot(host, 'desktop-8-friend-room', 'Friends tab: room hosted in the preview, the room code shown, waiting for the friend');
  const href = await host.getAttribute('a.button', 'href');
  console.log('second tab link', href);
  const joiner = await page(1280, 800, `http://127.0.0.1:${party.srv.port}${href}`);
  await sleep(1500);
  try { await joiner.fill('#gfp-name', 'Friend'); await joiner.click('#gfp-join'); } catch (e) { console.log('joiner click:', e.message.split('\n')[0]); }
  await sleep(4000);
  await shot(host, 'desktop-9-friend-joined', 'Friends tab after the friend joined in a second tab: the room code and the player count');
  await joiner.screenshot({ path: path.join(out, 'desktop-9b-friend-tab.png') }); note('desktop-9b-friend-tab.png', 'The second tab (the friend) in the same room');
  const phoneHost = await page(390, 844, party.url);
  await tab(phoneHost, 'friends');
  await shot(phoneHost, 'phone-8-friends', 'Friends tab at phone width');
  await phoneHost.close(); await joiner.close(); await host.close();

  // a scenic game
  const scenic = await boot('isle-run', basePort + 1);
  const sp = await page(1280, 800, scenic.url);
  await sleep(6000);
  await tab(sp, 'assets');
  await shot(sp, 'desktop-10-scenic-slots', 'Isle Run (scenic engine) in the preview with the Slots & assets tab');
  await tab(sp, 'tune'); await sleep(800);
  await shot(sp, 'desktop-11-scenic-tune', 'Isle Run, Tune tab');
  console.log('errors scenic:', sp.errors);
  await sp.close();
  const sphone = await page(390, 844, scenic.url);
  await sleep(5000);
  await tab(sphone, 'assets');
  await shot(sphone, 'phone-10-scenic-slots', 'Isle Run at phone width, Slots & assets');
  await noSideScroll(sphone, 'phone scenic assets');
  await sphone.close();
} finally {
  await browser.close();
  for (const s of servers) await s.close();
}
