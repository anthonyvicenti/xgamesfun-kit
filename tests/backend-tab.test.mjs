// The studio's Saves & scores tool (the Backend tab, id 'backend') in Chrome on core's dev server: with no backend it
// opens on the picture cards and the services; the Supabase panel; pasting a secret key is refused; pasting the URL and publishable key connects; removing it goes
// back to none. Nothing reaches Supabase (no session, no sign-in). BACKEND_SHOTS=<dir> saves a screenshot per state.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { findChrome } from '../lib/chrome.mjs';
import { startDevServer } from '../server/index.mjs';
import { tempDir, tempGame } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch {}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const SERVICE_ROLE = `eyJhbGciOiJIUzI1NiJ9.${b64({ role: 'service_role' })}.c2lnbmF0dXJlLW5vdC1jaGVja2VkLWhlcmU`;
const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_publishable_AbCdEfGhIjKlMnOpQrSt';

describe('studio Saves & scores tab (backend) in Chrome', { skip: !chromium && 'playwright-core is not installed' }, () => {
  let browser, server, game, page, cfg;
  const shots = process.env.BACKEND_SHOTS ? path.resolve(process.env.BACKEND_SHOTS) : null;
  const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }); };
  const panel = () => page.locator('.panel:not([hidden])').filter({ hasText: /Saves|backend|Supabase/i }).last();

  before(async () => {
    const found = findChrome();
    for (const o of [found ? { executablePath: found.path } : null, {}].filter(Boolean)) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch {} }
    if (!browser) return;
    cfg = await tempDir('gamesfun-backend-tab-');
    process.env.GAMESFUN_CONFIG_DIR = cfg.dir;
    process.env.GAMESFUN_SECRET_STORE = 'file';
    game = await tempGame('soak-squad');
    server = await startDevServer({ gameDir: game.dir, port: 0, log: () => {}, watch: false });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('dialog', d => d.accept());
    await page.goto(`${server.url}studio/`);
  });
  after(async () => { await browser?.close(); await server?.close(); await game?.cleanup(); await cfg?.cleanup(); });

  it('is a Share tool of the layout: after Publish, before Economy (Economy stays last)', async t => {
    if (!browser) return t.skip('no browser');
    await page.getByRole('tab', { name: 'Saves & scores' }).waitFor();
    const tabs = await page.locator('#tabs [role="tab"]').evaluateAll(bs => bs.map(b => ({ id: b.dataset.id, group: b.dataset.group })));
    const at = id => tabs.findIndex(x => x.id === id);
    assert.equal(tabs.find(x => x.id === 'backend')?.group, 'Share', JSON.stringify(tabs));
    assert.equal(tabs.find(x => x.id === 'publish')?.group, 'Share', JSON.stringify(tabs));
    assert.ok(at('publish') < at('backend'), JSON.stringify(tabs));
    // Economy joins Share in the same rework (its own tab file); once it has, it comes after and stays last
    if (tabs.find(x => x.id === 'economy')?.group === 'Share') { assert.ok(at('backend') < at('economy'), JSON.stringify(tabs)); assert.equal(tabs.at(-1).id, 'economy'); }
    assert.equal(await page.locator('#tabs [data-id="backend"] svg.ico path').count(), 3, 'its own icon (a trophy)');
  });

  it('with no backend: the picture cards of what it gives, then the services with their lights', async t => {
    if (!browser) return t.skip('no browser');
    await page.getByRole('tab', { name: 'Saves & scores' }).click();
    const p = page.locator('#panel-backend');
    await p.getByRole('button', { name: 'Use Supabase' }).waitFor();
    assert.deepEqual(await p.locator('.sv-benefit').evaluateAll(cs => cs.map(c => c.dataset.id)), ['scores', 'saves', 'accounts', 'server']);
    assert.equal(await p.locator('.sv-benefit svg').count(), 4, 'each card has its picture');
    assert.deepEqual(await p.locator('.sv-service').evaluateAll(cs => cs.map(c => [c.dataset.id, c.dataset.tone])), [['supabase', 'off'], ['railway', 'off']]);
    const text = await p.innerText();
    assert.match(text, /works without this/);
    assert.ok(!/Connect Supabase|publishable|backend\.json/i.test(text), text);
    // one primary button: the service most games want
    assert.deepEqual(await p.locator('.sv-service-go button:not(.ghost)').allInnerTexts(), ['Use Supabase']);
    // a card shows which services give it
    await p.locator('.sv-benefit[data-id=server]').click();
    assert.deepEqual(await p.locator('.sv-service').evaluateAll(cs => cs.map(c => [c.dataset.id, c.dataset.match])), [['supabase', 'no'], ['railway', 'yes']]);
    await shot('1-none');
  });

  it('choosing Supabase shows its panel: the steps it will take, the one button (tests/backend-one-button-chrome.test.mjs), and the agent\'s way under "Other ways"', async t => {
    if (!browser) return t.skip('no browser');
    await page.getByRole('button', { name: 'Use Supabase' }).click();
    await page.locator('#panel-backend ol.flow-steps[data-plan="1"] li').first().waitFor();
    assert.equal(await page.locator('#panel-backend ol.flow-steps li').count(), 4, 'the plan, numbered');
    await shot('2-choose');
    // the one button is there; it is not pressed here (this test has no stand-in for games.fun or Supabase)
    await page.getByRole('button', { name: 'Connect Supabase' }).waitFor();
    // not pressed either: with no session it adds Supabase's MCP server to this machine's real agents
    await page.getByText('Other ways to connect').click();
    await page.getByRole('button', { name: 'Connect through your agent' }).waitFor();
    await shot('3-supabase');
  });

  it('a secret key is refused; the URL and publishable key connect; removing goes back to none', async t => {
    if (!browser) return t.skip('no browser');
    if (!(await page.getByText('Paste the URL and publishable key yourself').isVisible())) await page.getByText('Other ways to connect').click();
    await page.getByText('Paste the URL and publishable key yourself').click();
    await page.getByLabel('Project URL').fill(URL_);
    await page.getByLabel('Publishable key').fill(SERVICE_ROLE);
    await page.getByRole('button', { name: 'Use these' }).click();
    await page.getByText(/not public/).waitFor();
    await assert.rejects(stat(path.join(game.dir, 'backend.json')));
    await page.getByLabel('Publishable key').fill(KEY);
    await page.getByRole('button', { name: 'Use these' }).click();
    await page.locator('#panel-backend .sv-connected[data-tone=ok]').getByText('Connected to this game').waitFor();
    assert.equal(await page.locator('#panel-backend .sv-benefit[data-has=true]').count(), 3, 'scores, saves and accounts lit');
    await page.getByText(/No secrets in the game/).waitFor();
    const written = JSON.parse(await readFile(path.join(game.dir, 'backend.json'), 'utf8'));
    assert.equal(written.key, KEY);
    // a table is asked for in the conversation's box, with the backend as its chip
    await page.getByRole('button', { name: 'Ask my session for a table' }).click();
    await page.locator('.chat-context-label', { hasText: 'Saves & scores' }).waitFor();
    await shot('4-connected');
    if (shots) {
      await page.setViewportSize({ width: 390, height: 844 });
      await panel().scrollIntoViewIfNeeded();
      await shot('5-connected-phone');
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.getByRole('button', { name: 'Remove from this game' }).click();
    await page.getByRole('button', { name: 'Use Supabase' }).waitFor();
    await assert.rejects(stat(path.join(game.dir, 'backend.json')));
  });
});
