// The Token and Shop tabs in the real studio, in Chrome: core's dev server (startDevServer) serves studio/ and mounts
// server/routes/web3.mjs; the tabs use core's ctx.api and ctx.wallet; a Wallet Standard wallet is injected into the
// page (its key stays in Node). The chain and the Irys node are the offline fake (tests/web3/fake-chain.mjs), reached
// through this process's fetch, so the run is deterministic. Clicks launch a token, then make two items and a box and
// put them on sale in one approval. Skipped when no browser is available.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromBase64 } from '../web3/gf-web3/chain/bytes.js';
import { freshKeypair } from '../web3/node/ed25519.mjs';
import { startDevServer } from '../server/index.mjs';
import { findChrome } from '../lib/chrome.mjs';
import { fakeChain } from './web3/fake-chain.mjs';
import { injectWallet } from './web3/inject-wallet.mjs';
import { makeGame } from './web3/helpers.mjs';

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

/** Route this process's Solana JSON-RPC and Irys calls to the fake chain; everything else goes out as usual. */
function useFakeChain(chain) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.startsWith('https://devnet.irys.xyz')) return chain.fetchImpl(u, init);
    if (init?.method === 'POST' && typeof init.body === 'string' && init.body.includes('"jsonrpc"')) return chain.fetchImpl(u, init);
    return real(url, init);
  };
  return () => (globalThis.fetch = real);
}

describe('studio Token and Shop tabs on core’s dev server, in Chrome (fake chain)', { skip: !chromium && 'playwright-core is not installed' }, () => {
  let browser;
  let server;
  let game;
  let chain;
  let page;
  let restore;
  const wallet = freshKeypair();
  const signed = [];
  const config = async () => JSON.parse(await readFile(path.join(game.gameDir, 'gamesfun.json'), 'utf8'));
  const openTab = async (label) => {
    await page.getByRole('tab', { name: label }).click();
    await page.locator(`.panel:not([hidden]) [data-testid="tab-${label.toLowerCase()}"]`).waitFor();
  };

  before(async () => {
    browser = await launch();
    if (!browser) return;
    game = await makeGame();
    chain = fakeChain();
    chain.put(F.accounts.poolConfig.address, F.accounts.poolConfig.owner, fromBase64(F.accounts.poolConfig.data));
    restore = useFakeChain(chain);
    process.env.GAMESFUN_WEB3 = '1';      // the tabs are off unless asked for (tests/web3-switch.test.mjs)
    server = await startDevServer({ gameDir: game.gameDir, port: 0, log: () => {}, watch: false });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await injectWallet(page, wallet, { log: signed });
    await page.goto(`${server.url}studio/`);
  });
  after(async () => {
    await browser?.close();
    await server?.close();
    restore?.();
    delete process.env.GAMESFUN_WEB3;
  });

  it('lists the tabs after core’s own and mounts them', async (t) => {
    if (!browser) return t.skip('no browser');
    await page.getByRole('tab', { name: 'Shop' }).waitFor();
    const tabs = await page.getByRole('tab').allInnerTexts();
    assert.deepEqual(tabs.slice(-2), ['Token', 'Shop']);
  });

  it('launches a token from the Token tab, through ctx.wallet', async (t) => {
    if (!browser) return t.skip('no browser');
    await openTab('Token');
    const tab = page.locator('.panel:not([hidden])');
    await tab.getByTestId('token-launch').click();
    await tab.getByTestId('token-picture').click();
    await page.locator('.pickgrid button', { hasText: 'icon.png' }).click();
    assert.equal(await tab.getByTestId('token-symbol').inputValue(), 'BEAN');
    await tab.getByTestId('token-launch-go').click();
    await tab.getByTestId('approve').click();
    await tab.getByTestId('token-card').waitFor({ timeout: 20_000 });
    const c = await config();
    assert.equal(c.token.symbol, 'BEAN');
    assert.equal(c.creator, wallet.address);
    assert.deepEqual(signed.map((s) => s.kind), ['message', 'message', 'transaction']);
    // core's studio header shows the same connection
    assert.match(await page.locator('#wallet-btn').innerText(), /Wallet /);
  });

  it('makes items and a box in the Shop tab and puts them on sale in one approval', async (t) => {
    if (!browser) return t.skip('no browser');
    signed.length = 0;
    await openTab('Shop');
    const tab = page.locator('.panel:not([hidden])');
    for (const [name, picture, price] of [['Golden Hat', 'hat.png', '0.05'], ['Ice Skin', 'skin.png', '']]) {
      await tab.getByTestId('shop-add-item').click();
      await page.getByTestId('item-picture').click();
      await page.locator('.pickgrid button', { hasText: picture }).click();
      await page.getByTestId('item-name').fill(name);
      await page.getByTestId('item-price').fill(price);
      await page.getByTestId('item-save').click();
      await tab.getByText(name, { exact: true }).waitFor();
    }
    await tab.getByTestId('shop-add-box').click();
    await page.getByTestId('box-price').fill('0.01');
    await page.getByTestId('box-save').click();
    await tab.getByTestId('shop-box').waitFor();
    await tab.getByTestId('shop-publish-go').click();
    await tab.getByTestId('approve').click();
    await tab.getByTestId('approval').waitFor({ state: 'detached', timeout: 30_000 });
    const c = await config();
    // The shop goes live as part of the game's economy (decision 2, 2026-10-11).
    assert.ok(c.economy.live.collection, 'the collection was recorded');
    assert.deepEqual(c.economy.items.map((i) => Number.isInteger(i.id)), [true, true]);
    assert.ok(c.economy.live.transactions.some((t) => t.parts.includes('box:mystery-box')), 'the box landed');
    assert.equal(c.economy.tokens.find((t) => t.key === c.economy.currency).mint, c.token.mint, 'priced in the game’s own token by default');
    const kinds = signed.map((s) => s.kind);
    assert.equal(kinds.at(-1), 'transaction');
    assert.equal(kinds.filter((k) => k === 'transaction').length, chain.sent.length - 1, 'every shop transaction in one approval');
    await page.screenshot({ path: path.join(game.root, 'studio-shop.png'), fullPage: true });
  });
});
