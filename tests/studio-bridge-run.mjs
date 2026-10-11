// The studio page in real Chrome on a REAL `gamesfun dev` (the bridge's real routes), no model. A scripted "session"
// (tests/stubs/session-driver.mjs) posts what the plugin's hooks post; the page is driven with real clicks.
//   gpu-run.sh node tests/studio-bridge-run.mjs <out dir> <port>        (--no-open is always on; never the person's Chrome)
// Exit code 1 when any check fails. Every check prints PASS or FAIL.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../lib/create.mjs';
import { ensureBrowser } from '../lib/chrome.mjs';
import { sessionDriver } from './stubs/session-driver.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? 'shots'), port = Number(process.argv[3] ?? 5915);
await mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 8000, what = 'condition') => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(50); } throw new Error(`timed out: ${what}`); };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const shots = [];
const shot = async (p, name, what) => { await sleep(350); await p.screenshot({ path: path.join(out, `${name}.png`) }); shots.push([`${name}.png`, what]); console.log(`SHOT  ${name}.png  ${what}`); };

const game = path.join(os.tmpdir(), `gf-bridge-run-${process.pid}`, 'soak-squad');
await createGame(game, { from: 'soak-squad' });
let dev = null;
async function startDev() {
  dev = spawn(process.execPath, [path.join(KIT, 'bin', 'gamesfun.mjs'), 'dev', game, '--port', String(port), '--no-open'], { cwd: KIT, stdio: ['ignore', 'pipe', 'pipe'] });
  dev.stdout.on('data', d => process.stdout.write(`[dev] ${d}`)); dev.stderr.on('data', d => process.stdout.write(`[dev!] ${d}`));
  await until(async () => (await fetch(`http://127.0.0.1:${port}/api/session/token`, { headers: { 'sec-fetch-site': 'same-origin' } })).ok, 20000, 'dev server up');
}
async function stopDev() {
  const d = dev; dev = null;
  if (!d) return;
  const gone = new Promise(r => d.once('exit', r));
  d.kill('SIGTERM');
  await Promise.race([gone, sleep(5000)]);
}
const base = `http://127.0.0.1:${port}`;
const b = await ensureBrowser({});
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: b.path, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean)] });
const tab = async (p, id) => { await p.click(`#tabs button[data-id="${id}"]`); await sleep(400); };
const text = (p, sel) => p.locator(sel).allInnerTexts().then(a => a.join('\n'));
const clipped = p => p.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('#tabs button, .bar a, .bar .badge, .bar button')) { if (el.offsetParent && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') bad.push(el.textContent); }
  return bad;
});

try {
  await startDev();
  for (const [label, w, h] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
    console.log(`\n== ${label} ${w}x${h}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(`${base}/studio/`, { waitUntil: 'load' });
    await tab(p, 'session');
    const s = await sessionDriver(base, { id: `run-${label}`, cwd: game });
    await until(() => p.locator('.conn').first().innerText(), 5000, 'banner');
    check(/No session connected/.test(await text(p, '.conn')), `${label}: with no session the page says to start the agent`);
    await shot(p, `${label}-1-no-session`, 'Session tab before any session: "No session connected yet", start your agent in this folder');
    check((await clipped(p)).length === 0, `${label}: no clipped label in the header or tab row (${JSON.stringify(await clipped(p))})`);

    // session starts, does a turn, stops: idle, no wait open
    await s.start(); await s.prompt('Make the arena bigger'); await s.tool('Edit', { file_path: 'config/world.json' }); await s.stop();
    await until(async () => /idle/i.test(await text(p, '.conn')), 6000, 'idle banner');
    check(/Press Enter in the terminal/.test(await text(p, '.conn')), `${label}: idle and not connected: press Enter in the terminal`);
    await shot(p, `${label}-2-idle`, 'Session idle with no wait open: press Enter once; the timeline shows the prompt and the Edit');

    // a request typed in the page
    await p.fill('textarea.ask', 'make the enemies faster');
    await p.click('text=Send to your session');
    await until(async () => (await p.locator('.req').count()) === 1, 6000, 'request row');
    check(await p.locator('.req[data-state="waiting"]').count() === 1, `${label}: the typed request shows as waiting`);
    check(/Waiting for your session/.test(await text(p, '.req')), `${label}: the waiting words`);
    const q1 = await s.queue();
    check(q1.requests.length >= 1 && q1.requests.at(-1).text === 'make the enemies faster' && q1.requests.at(-1).state === 'waiting', `${label}: the bridge holds it as waiting`);
    const rid = q1.requests.at(-1).id;
    await shot(p, `${label}-3-request-waiting`, 'The request waiting (Edit and Remove offered), session idle');

    // the session's wait opens: handed; then it collects with the tool and reports done
    const wait = await s.wait();
    await until(() => wait.lines.length, 4000, 'wake');
    check(wait.lines[0]?.type === 'requests' && /GF_REQUEST/.test(wait.lines[0].text), `${label}: the wait delivered the request as GF_REQUEST`);
    await until(async () => /Handed over/.test(await text(p, '.req')), 6000, 'handed in page');
    check(true, `${label}: the page says handed over`);
    await shot(p, `${label}-4-request-handed`, 'Request handed over to the session; the session is listening/working');
    await s.prompt(wait.lines[0].text);
    await until(async () => /has seen it/.test(await text(p, '.req')), 6000, 'seen in page');
    check(true, `${label}: the page says seen after the session acted`);
    check(!/Done/.test(await text(p, '.req-state')), `${label}: not shown as done before the session reported`);
    const got = await s.collect();
    check(got.body.requests.some(r => r.id === rid), `${label}: GET requests returned it`);
    await s.done(rid, 'enemy speed 4 to 6');
    await until(async () => /Done/.test(await text(p, '.req-state')), 6000, 'done in page');
    check(true, `${label}: the page says Done after the tool reported`);
    await shot(p, `${label}-5-request-done`, 'Request Done after the session reported it through the tool');
    await s.stop('Done');

    // permission: Allow
    await s.prompt('run the checks');
    const heldAllow = s.ask('Bash', { command: 'npx gamesfun verify --quick games/soak-squad' });
    await until(() => p.locator('.perm').count(), 6000, 'permission card');
    check(/Your session asks to use Bash/.test(await text(p, '.perm')) && /Your terminal can answer this too/.test(await text(p, '.perm')), `${label}: the card names the tool and says the terminal can answer too`);
    await shot(p, `${label}-6-permission`, 'Permission card for Bash with Allow, Deny and the terminal note');
    await p.click('.perm >> text=Allow');
    const ra = await Promise.race([heldAllow, sleep(6000).then(() => null)]);
    check(ra?.status === 200 && ra.body?.hookSpecificOutput?.hookEventName === 'PermissionRequest' && ra.body.hookSpecificOutput.decision?.behavior === 'allow', `${label}: the hook's HTTP response carried the allow decision (${ra?.text})`);
    await until(async () => (await p.locator('.perm').count()) === 0, 6000, 'card gone');
    check(true, `${label}: the card went away after the click`);
    await shot(p, `${label}-7-allowed`, 'After Allow: the card is gone and the toast says Allowed');

    // permission: Deny
    const heldDeny = s.ask('Bash', { command: 'rm -rf games' });
    await until(() => p.locator('.perm').count(), 6000, 'second card');
    await p.click('.perm >> text=Deny');
    const rd = await Promise.race([heldDeny, sleep(6000).then(() => null)]);
    check(rd?.status === 200 && rd.body?.hookSpecificOutput?.decision?.behavior === 'deny', `${label}: the hook's HTTP response carried the deny decision (${rd?.text})`);
    await until(async () => (await p.locator('.perm').count()) === 0, 6000, 'card gone 2');
    await shot(p, `${label}-8-denied`, 'After Deny: card gone');

    // the person answers in the terminal: the card retires by itself
    const heldTerm = s.ask('Edit', { file_path: 'rules.js' });
    await until(() => p.locator('.perm').count(), 6000, 'third card');
    await s.tool('Edit', { file_path: 'rules.js' });
    await until(async () => (await p.locator('.perm').count()) === 0, 6000, 'card retired');
    check((await heldTerm).text === '', `${label}: answered in the terminal: the card is retired and the hook got an empty 200`);

    // a request dropped by the stop guard, and Remove on it does not error
    await s.stop();
    const w2 = await s.wait();                                 // listening: a new request is handed at once
    const sent2 = (await s.call('POST', 'request', { text: 'add a boss' })).body;
    await until(() => w2.lines.length, 4000, 'second wake');
    await sleep(3300);                                         // a request handed under 3 s ago is not refused at the stop
    await s.prompt(w2.lines[0].text);
    for (let i = 0; i < 2; i++) check((await s.stop()).body?.decision === 'block', `${label}: stop ${i + 1} with the request unreported is refused`);
    await s.stop();                                            // the third is let through; the request is dropped
    await until(async () => (await s.queue()).requests.find(r => r.id === sent2.id)?.state === 'dropped', 6000, 'dropped');
    await until(async () => /send again/i.test(await text(p, '.req-state')), 6000, 'dropped in page');
    await shot(p, `${label}-9-dropped`, 'A request the session ended two turns without reporting: "Not done: send again"');
    await p.locator('.req', { hasText: 'add a boss' }).locator('text=Remove').click();
    await sleep(500);
    check(!(await text(p, '.toast.error')), `${label}: Remove on a dropped request raises no error (${await text(p, '.toast.error')})`);
    check((await p.locator('.req', { hasText: 'add a boss' }).count()) === 0, `${label}: the dropped request is gone from the list`);

    // the stop guard gives up on a stuck build
    await mkdir(path.join(game, '.gf-loop'), { recursive: true });
    await writeFile(path.join(game, '.gf-loop', 'state.json'), JSON.stringify({ schema: 'gf-loop/1', kind: 'build', status: 'building', step: 'verify', why: 'the full verify is running', round: 1 }));
    await s.prompt('go on');
    let last;
    for (let i = 0; i < 4; i++) last = await s.stop();
    check(/./.test(last.body?.systemMessage ?? ''), `${label}: the 4th stop is let through with a notice in the terminal`);
    await until(async () => /The build is waiting for you/.test(await text(p, '.conn')), 6000, 'guard banner');
    check(true, `${label}: the page shows the stop-guard notice`);
    await shot(p, `${label}-10-guard`, 'The stop guard gave up on a stuck build: banner "The build is waiting for you", timeline shows the refused stops');
    await rm(path.join(game, '.gf-loop'), { recursive: true, force: true });
    check(errors.length === 0, `${label}: no page errors (${errors.join('; ')})`);
    const wide = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(wide[0] <= wide[1], `${label}: no sideways scroll (${wide})`);
    s.closeAll(); await s.end();
    if (label === 'desktop') {
      // the studio restarts: a new token, new ids. The same open page has to pick up again with no reload.
      console.log('\n== restart of the studio under an open page');
      await stopDev(); await sleep(800); await startDev();
      const s2 = await sessionDriver(base, { id: 'after-restart', cwd: game });
      await s2.start(); await s2.prompt('after the restart');
      await until(async () => /after the restart/.test(await text(p, '.timeline')), 12000, 'timeline after restart');
      check(true, `desktop: after a restart the open page reconnects (new token) and shows the new session's events`);
      await p.fill('textarea.ask', 'a request after the restart'); await p.click('text=Send to your session');
      await until(async () => /a request after the restart/.test(await text(p, '.queue')), 8000, 'request after restart');
      check(true, `desktop: sending after the restart works (401 retried with the new token)`);
      const hold = s2.ask('Bash', { command: 'ls' });
      await until(() => p.locator('.perm').count(), 8000, 'card after restart');
      await p.click('.perm >> text=Allow');
      const ar = await Promise.race([hold, sleep(6000).then(() => null)]);
      check(ar?.body?.hookSpecificOutput?.decision?.behavior === 'allow', 'desktop: a permission after the restart is answered by the click');
      await shot(p, 'desktop-11-after-restart', 'After the studio restarted under the open page: the new session, the new request, no reload');
      // a request still waiting when its session ends goes to the next session that connects (bridge behaviour), so clear it
      for (const r of (await s2.queue()).requests.filter(x => x.state === 'waiting')) await s2.call('DELETE', `request/${r.id}`);
      s2.closeAll(); await s2.end();
    }
    await ctx.close();
  }
} finally {
  await browser.close().catch(() => {});
  await stopDev();
  await rm(path.dirname(game), { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${failed ? 'FAILED' : 'ALL PASSED'}: ${failed} failing`);
process.exit(failed ? 1 : 0);
