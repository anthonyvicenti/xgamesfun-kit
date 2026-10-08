// The Token and Shop studio tabs in real Chrome, driven by clicks, with a Wallet Standard wallet injected into the
// page (its key stays in Node) and the fake chain behind the routes: launch a token, then make two items and a box
// and put them on sale in one approval. Skipped when Playwright or a browser is not available.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromBase64 } from '../web3/gf-web3/chain/bytes.js';
import { freshKeypair } from '../web3/node/ed25519.mjs';
import { fakeChain } from './web3/fake-chain.mjs';
import { startHarness } from './web3/harness/server.mjs';
import { injectWallet } from './web3/inject-wallet.mjs';
import { makeGame } from './web3/helpers.mjs';
import { findChrome } from '../lib/chrome.mjs';

const F = JSON.parse(await readFile(new URL('./web3/fixtures/chain.json', import.meta.url), 'utf8'));
let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
} catch {}

async function launch() {
  const found = findChrome();
  for (const options of [found ? { executablePath: found.path } : null, {}].filter(Boolean)) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch {}
  }
  return null;
}

describe('studio tabs in Chrome (fake chain)', { skip: !chromium && 'playwright-core is not installed' }, () => {
  let browser;
  let harness;
  let game;
  let chain;
  let page;
  const wallet = freshKeypair();
  const signed = [];
  const config = async () => JSON.parse(await readFile(path.join(game.gameDir, 'gamesfun.json'), 'utf8'));

  before(async () => {
    browser = await launch();
    if (!browser) return;
    game = await makeGame();
    chain = fakeChain();
    chain.put(F.accounts.poolConfig.address, F.accounts.poolConfig.owner, fromBase64(F.accounts.poolConfig.data));
    harness = await startHarness({ gameDir: game.gameDir, kitRoot: game.kitRoot, extra: { fetchImpl: chain.fetchImpl, env: {} } });
    page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await injectWallet(page, wallet, { log: signed });
  });
  after(async () => {
    await browser?.close();
    await harness?.close();
  });

  it('launches a token from the Token tab', async (t) => {
    if (!browser) return t.skip('no browser');
    await page.goto(`${harness.url}?tab=token`);
    await page.getByTestId('token-launch').click();
    await page.getByTestId('token-picture').click();
    await page.locator('.pickgrid button').first().click();
    assert.equal(await page.getByTestId('token-symbol').inputValue(), 'BEAN');
    await page.getByTestId('token-launch-go').click();
    await page.getByTestId('approve').click();
    await page.getByTestId('token-card').waitFor({ timeout: 20_000 });
    const c = await config();
    assert.equal(c.token.symbol, 'BEAN');
    assert.equal(c.creator, wallet.address);
    // Two uploads (each a signMessage) and one transaction, approved in the wallet.
    assert.deepEqual(signed.map((s) => s.kind), ['message', 'message', 'transaction']);
  });

  it('makes items and a box in the Shop tab and puts them on sale in one approval', async (t) => {
    if (!browser) return t.skip('no browser');
    signed.length = 0;
    await page.goto(`${harness.url}?tab=shop`);
    for (const [name, price] of [['Golden Hat', '0.05'], ['Ice Skin', '']]) {
      await page.getByTestId('shop-add-item').click();
      await page.getByTestId('item-picture').click();
      await page.locator('.pickgrid button').nth(name === 'Golden Hat' ? 0 : 2).click();
      await page.getByTestId('item-name').fill(name);
      await page.getByTestId('item-price').fill(price);
      await page.getByTestId('item-save').click();
      await page.getByText(name, { exact: true }).waitFor();
    }
    await page.getByTestId('shop-add-box').click();
    await page.getByTestId('box-price').fill('0.01');
    await page.getByTestId('box-save').click();
    await page.getByTestId('shop-box').waitFor();
    await page.getByTestId('shop-publish-go').click();
    await page.getByTestId('approve').click();
    await page.getByTestId('approval').waitFor({ state: 'detached', timeout: 30_000 });
    const c = await config();
    assert.ok(c.shop.collection, 'the collection was recorded');
    assert.deepEqual(c.shop.items.map((i) => i.listed), [true, true]);
    assert.equal(c.shop.boxes[0].listed, true);
    // The shop is priced in the game's own token, launched in the test before.
    assert.equal(c.shop.currency.mint, c.token.mint);
    const kinds = signed.map((s) => s.kind);
    assert.equal(kinds.filter((k) => k === 'transaction').length, chain.sent.length - 1, 'every transaction in one approval');
    assert.equal(kinds.at(-1), 'transaction');
    await page.screenshot({ path: path.join(game.root, 'shop.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll at 390 px');
  });
});
