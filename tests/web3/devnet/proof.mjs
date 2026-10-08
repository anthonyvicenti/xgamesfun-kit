// The web3 devnet proof, without a human wallet: real Chrome (Playwright) with a Wallet Standard wallet injected into
// the page, backed by a throwaway devnet key kept in the git-ignored .gamesfun/devnet/. The creator's steps go
// through the real studio tabs (clicks), the player's through the real in-game kit:
//   Irys uploads → token launch (no initial buy) → collection + loot game + items + box in one approval →
//   a player buys an item → the player opens the box (MagicBlock VRF roll, then settle) → owned items → loadout.
// It funds the keys from the public devnet faucet only. When the faucet refuses, it says so and runs what needs no
// SOL (Irys uploads are free under 100 KB), then stops; the offline tests cover the rest.
//   node tests/web3/devnet/proof.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { networkConfig, explorerUrl } from '../../../web3/gf-web3/network.js';
import { rpcClient } from '../../../web3/gf-web3/rpc.js';
import { compileMessage, wireTransaction } from '../../../web3/gf-web3/chain/tx.js';
import { transferLamports } from '../../../web3/gf-web3/chain/programs.js';
import { withSignature } from '../../../web3/gf-web3/chain/tx.js';
import { generateKeyPairSync } from 'node:crypto';
import { keypairFromSecret } from '../../../web3/node/ed25519.mjs';
import { startHarness } from '../harness/server.mjs';
import { injectWallet } from '../inject-wallet.mjs';
import { png } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(here, '..', '..', '..');
const keyDir = path.join(kitRoot, '.gamesfun', 'devnet');
const network = networkConfig('devnet');
const rpc = rpcClient(network.rpcUrl);
const result = { network: 'devnet', startedAt: new Date().toISOString(), steps: [], blocked: null };
const step = (name, data) => {
  result.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log(`✓ ${name}`, JSON.stringify(data));
};

async function key(name) {
  const file = path.join(keyDir, `${name}.keypair.json`);
  try {
    return keypairFromSecret(Uint8Array.from(JSON.parse(await readFile(file, 'utf8'))));
  } catch {
    const { privateKey } = generateKeyPairSync('ed25519');
    const jwk = privateKey.export({ format: 'jwk' });
    const secret = [...Buffer.from(jwk.d, 'base64url'), ...Buffer.from(jwk.x, 'base64url')];
    await mkdir(keyDir, { recursive: true });
    await writeFile(file, JSON.stringify(secret), { mode: 0o600 });
    return keypairFromSecret(Uint8Array.from(secret));
  }
}

/** Ask the public faucet; returns { ok, message }. */
async function airdrop(address, lamports) {
  try {
    const signature = await rpc.call('requestAirdrop', [address, lamports]);
    await rpc.confirm(signature, { timeoutMs: 60_000 });
    return { ok: true, signature };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function fund(creator) {
  const balance = await rpc.balance(creator.address);
  if (balance >= 1_500_000_000n) return { balance };
  const tries = [];
  for (const lamports of [2_000_000_000, 1_000_000_000]) {
    const r = await airdrop(creator.address, lamports);
    tries.push({ lamports, ...r });
    if (r.ok) return { balance: await rpc.balance(creator.address), airdrops: tries };
  }
  const now = await rpc.balance(creator.address);
  return now >= 300_000_000n ? { balance: now, airdrops: tries } : { blocked: tries.map((t) => t.message).join(' | '), balance: now };
}

/** A transfer from one test key to another, signed here (the proof's own throwaway keys only). */
async function transfer(from, to, lamports) {
  const { blockhash, lastValidBlockHeight } = await rpc.latestBlockhash();
  const message = compileMessage({ payer: from.address, blockhash, instructions: [transferLamports(from.address, to, lamports)] });
  const wire = withSignature(wireTransaction(message), from.address, from.sign(message));
  const signature = await rpc.send(wire);
  await rpc.confirm(signature, { lastValidBlockHeight });
  return signature;
}

const signaturesIn = (texts) => texts.flatMap((t) => [...t.matchAll(/\/tx\/([1-9A-HJ-NP-Za-km-z]{64,88})/g)].map((m) => m[1]));
const uploadsIn = (texts) => texts.flatMap((t) => [...t.matchAll(/https:\/\/devnet\.irys\.xyz\/([1-9A-HJ-NP-Za-km-z]{40,50})/g)].map((m) => m[1]));

async function main() {
  const creator = await key('creator');
  const player = await key('player');
  result.creator = creator.address;
  result.player = player.address;
  const gameDir = path.join(keyDir, 'game');
  await mkdir(path.join(gameDir, 'assets'), { recursive: true });
  await writeFile(path.join(gameDir, 'index.html'), '<!doctype html><title>Proof Brawl</title>');
  await writeFile(path.join(gameDir, 'assets', 'icon.png'), png(240, 180, 20, 16, 16));
  await writeFile(path.join(gameDir, 'assets', 'hat.png'), png(250, 210, 0, 16, 16));
  await writeFile(path.join(gameDir, 'assets', 'skin.png'), png(40, 180, 250, 16, 16));
  // A fresh setup each run (a token launch is once per game).
  await writeFile(path.join(gameDir, 'gamesfun.json'), JSON.stringify({ version: 1, network: 'devnet' }));

  const funding = await fund(creator);
  step('fund creator from the public devnet faucet', { creator: creator.address, ...funding, balance: String(funding.balance) });
  if (funding.blocked) result.blocked = { faucet: funding.blocked };

  const harness = await startHarness({ gameDir, kitRoot: path.join(keyDir, 'kit-state') });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const signed = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await injectWallet(page, creator, { name: 'Proof Wallet', log: signed });

    // ---- Token tab: launch with no initial buy
    await page.goto(`${harness.url}?tab=token`);
    await page.getByTestId('token-launch').click();
    await page.getByTestId('token-picture').click();
    await page.locator('.pickgrid button', { hasText: 'icon.png' }).click();
    await page.getByTestId('token-name').fill('Proof Brawl');
    await page.getByTestId('token-symbol').fill('PROOF');
    await page.getByTestId('token-launch-go').click();
    await page.getByTestId('approve').click();
    const launched = await Promise.race([
      page.getByTestId('token-card').waitFor({ timeout: 150_000 }).then(() => true),
      page.locator('[data-testid="approval"] .note.error').waitFor({ timeout: 150_000 }).then(() => false),
    ]);
    const launchTexts = launched ? [] : await page.locator('[data-testid="approval"] .results li').allInnerTexts();
    const afterLaunch = JSON.parse(await readFile(path.join(gameDir, 'gamesfun.json'), 'utf8'));
    if (!launched) {
      const error = await page.locator('[data-testid="approval"] .note.error').innerText();
      step('Irys uploads through the Token tab (free under 100 KB, signed by the wallet)', { uploads: uploadsIn(launchTexts), results: launchTexts });
      step('token launch transaction', { ok: false, error });
      await page.screenshot({ path: path.join(keyDir, 'proof-token.png'), fullPage: true });
      if (result.blocked) return;
      throw new Error(`launch failed: ${error}`);
    }
    step('token launch (Meteora DBC antisnipe-v1, MAIN-dev quote, no initial buy)', {
      mint: afterLaunch.token.mint,
      pool: afterLaunch.token.pool,
      signature: afterLaunch.token.signature,
      metadataUri: afterLaunch.token.metadataUri,
      image: afterLaunch.token.image,
      explorer: explorerUrl(network, 'tx', afterLaunch.token.signature),
    });

    // ---- Shop tab: SOL currency, two items, one box, one approval
    await page.goto(`${harness.url}?tab=shop`);
    await page.getByRole('radio', { name: 'SOL' }).click();
    await page.getByText('Your shop is priced in SOL.').waitFor();
    for (const [name, picture, price] of [['Golden Hat', 'hat.png', '0.01'], ['Ice Skin', 'skin.png', '']]) {
      await page.getByTestId('shop-add-item').click();
      await page.getByTestId('item-picture').click();
      await page.locator('.pickgrid button', { hasText: picture }).click();
      await page.getByTestId('item-name').fill(name);
      await page.getByTestId('item-price').fill(price);
      await page.getByTestId('item-save').click();
      await page.getByText(name, { exact: true }).waitFor();
    }
    await page.getByTestId('shop-add-box').click();
    await page.getByTestId('box-price').fill('0.005');
    await page.getByTestId('box-save').click();
    await page.getByTestId('shop-box').waitFor();
    signed.length = 0;
    await page.getByTestId('shop-publish-go').click();
    await page.getByTestId('approve').click();
    const results = page.locator('[data-testid="approval"] .results li');
    await Promise.race([
      page.getByTestId('approval').waitFor({ state: 'detached', timeout: 240_000 }),
      page.locator('[data-testid="approval"] .note.error').waitFor({ timeout: 240_000 }).then(async () => {
        throw new Error(`publish failed: ${await page.locator('[data-testid="approval"] .note.error').innerText()}`);
      }),
    ]);
    const shop = JSON.parse(await readFile(path.join(gameDir, 'gamesfun.json'), 'utf8')).shop;
    step('shop on sale: Irys uploads, then collection + loot game + 2 items + 1 box in one wallet approval', {
      collection: shop.collection,
      game: shop.game,
      walletPrompts: signed.map((s) => s.kind),
      items: shop.items.map((i) => ({ id: i.id, name: i.name, uri: i.uri, image: i.image, listed: i.listed })),
      boxes: shop.boxes.map((b) => ({ id: b.id, listed: b.listed })),
      results: await results.allInnerTexts().catch(() => []),
    });
    const state = await (await fetch(`${harness.url}api/web3/state`)).json();
    step('chain status after publish', { items: state.chain.shop.items, boxes: state.chain.shop.boxes, shopLive: state.chain.shop.exists });

    // ---- Player: fund from the creator, then buy and open in the game page through gf-web3
    const funded = await transfer(creator, player.address, 400_000_000n);
    step('fund player from the creator (test keys)', { signature: funded });
    const game = await browser.newPage();
    game.on('pageerror', (e) => console.error('game pageerror', e.message));
    await injectWallet(game, player, { name: 'Player Wallet' });
    await game.goto(`${harness.url}game/?gamesfun_mock=0`);
    await game.waitForFunction(() => window.__gfReady === true, null, { timeout: 30_000 });
    const bought = await game.evaluate(async () => {
      const r = await window.gf.shop.buy(1);
      return { item: r.item.name, asset: r.asset, signatures: r.signatures };
    });
    step('player buys Golden Hat (buy_item + settle, SOL wrapped, one approval)', { ...bought, explorer: explorerUrl(network, 'tx', bought.signatures[0]) });
    const opened = await game.evaluate(async () => {
      const r = await window.gf.openBox(1);
      return { item: r.item.name, serial: r.item.serial, asset: r.asset, order: r.order, signatures: r.signatures };
    });
    step('player opens Mystery Box (open_box → MagicBlock VRF callback_roll → settle)', { ...opened, explorer: opened.signatures.map((s) => explorerUrl(network, 'tx', s)) });
    await game.waitForTimeout(3000);
    const owned = await game.evaluate(async () => {
      const items = await window.gf.ownedItems();
      const worn = await window.gf.wearOwned();
      return { items: items.map((i) => ({ id: i.id, name: i.name, asset: i.asset })), loadout: worn.loadout, onWindow: window.__GF_LOADOUT };
    });
    step('player’s owned items read from the collection (getProgramAccounts on public devnet RPC), worn as a gf-three loadout', owned);
  } finally {
    await browser.close();
    await harness.close();
    result.finishedAt = new Date().toISOString();
    const file = path.join(here, 'result.json');
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${path.relative(kitRoot, file)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
