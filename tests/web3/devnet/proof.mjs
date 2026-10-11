// The web3 devnet proof, without a human wallet. Core's real dev server (startDevServer) serves a real gf-three game
// (created from the Soak Squad example, with gf-web3 installed) and the studio. Chrome (playwright-core) gets a Wallet
// Standard wallet injected into the page, backed by a throwaway devnet key kept in the git-ignored .gamesfun/devnet/.
// The creator's steps are clicks in the real Token and Shop tabs; the player's go through the game's own gf-web3:
//   Irys uploads → token launch (no initial buy) → collection + loot game + items + box in one approval →
//   a player buys an item → the player opens the box (MagicBlock VRF roll, then settle) → owned items → loadout.
// The loot program 0.3 alone, without Chrome or the faucet (test keys from files): tests/web3/devnet/loot-0.3.mjs.
// It funds the keys from the public devnet faucet only. When the faucet refuses, it says so, runs what needs no SOL
// (Irys uploads are free under 100 KB) and stops; the offline tests cover the rest.
//   node tests/web3/devnet/proof.mjs
import { existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChrome } from '../../../lib/chrome.mjs';
import { createGame } from '../../../lib/create.mjs';
import { startDevServer } from '../../../server/index.mjs';
import { transferLamports } from '../../../web3/gf-web3/chain/programs.js';
import { compileMessage, wireTransaction, withSignature } from '../../../web3/gf-web3/chain/tx.js';
import { explorerUrl, networkConfig } from '../../../web3/gf-web3/network.js';
import { rpcClient } from '../../../web3/gf-web3/rpc.js';
import { keypairFromSecret } from '../../../web3/node/ed25519.mjs';
import { installGfWeb3 } from '../../../web3/node/install.mjs';
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
    const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    const secret = [...Buffer.from(jwk.d, 'base64url'), ...Buffer.from(jwk.x, 'base64url')];
    await mkdir(keyDir, { recursive: true });
    await writeFile(file, JSON.stringify(secret), { mode: 0o600 });
    return keypairFromSecret(Uint8Array.from(secret));
  }
}

/** The public faucet only. → { ok, signature } or { ok: false, message } */
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
  return now >= 600_000_000n ? { balance: now, airdrops: tries } : { blocked: tries.map((t) => t.message).join(' | '), balance: now, airdrops: tries };
}

/** A transfer between the proof's own throwaway keys, signed here. */
async function transfer(from, to, lamports) {
  const { blockhash, lastValidBlockHeight } = await rpc.latestBlockhash();
  const message = compileMessage({ payer: from.address, blockhash, instructions: [transferLamports(from.address, to, lamports)] });
  const signature = await rpc.send(withSignature(wireTransaction(message), from.address, from.sign(message)));
  await rpc.confirm(signature, { lastValidBlockHeight });
  return signature;
}

const uploadsIn = (texts) => texts.flatMap((t) => [...t.matchAll(/devnet\.irys\.xyz\/([1-9A-HJ-NP-Za-km-z]{40,50})/g)].map((m) => m[1]));

/** A real gf-three game (Soak Squad) with gf-web3 installed, a fresh gamesfun.json and small item pictures. */
async function proofGame() {
  const dir = path.join(keyDir, 'proof-game');
  if (!existsSync(path.join(dir, 'gf-three.json'))) await createGame(dir, { from: 'soak-squad' });
  await installGfWeb3(dir);
  await writeFile(path.join(dir, 'gamesfun.json'), `${JSON.stringify({ version: 1, network: 'devnet' }, null, 2)}\n`);
  await mkdir(path.join(dir, 'assets', 'web3'), { recursive: true });
  await writeFile(path.join(dir, 'assets', 'web3', 'icon.png'), png(240, 180, 20, 16, 16));
  await writeFile(path.join(dir, 'assets', 'web3', 'hat.png'), png(250, 210, 0, 16, 16));
  await writeFile(path.join(dir, 'assets', 'web3', 'skin.png'), png(40, 180, 250, 16, 16));
  return dir;
}

async function waitForApproval(tab, timeout) {
  const outcome = await Promise.race([
    tab.getByTestId('approval').waitFor({ state: 'detached', timeout }).then(() => 'done'),
    tab.getByTestId('approval-done').waitFor({ timeout }).then(() => 'done'),
    tab.locator('[data-testid="approval"] .note.error').waitFor({ timeout }).then(() => 'error'),
  ]);
  const texts = await tab.locator('[data-testid="approval"] .results li').allInnerTexts().catch(() => []);
  const error = outcome === 'error' ? await tab.locator('[data-testid="approval"] .note.error').innerText() : null;
  return { ok: outcome === 'done', texts, error };
}

async function main() {
  const creator = await key('creator');
  const player = await key('player');
  Object.assign(result, { creator: creator.address, player: player.address });
  const gameDir = await proofGame();
  const config = async () => JSON.parse(await readFile(path.join(gameDir, 'gamesfun.json'), 'utf8'));

  const funding = await fund(creator);
  step('fund the creator from the public devnet faucet', { creator: creator.address, ...funding, balance: String(funding.balance) });
  if (funding.blocked) result.blocked = { faucet: funding.blocked };

  const server = await startDevServer({ gameDir, port: 0, log: () => {}, watch: false });
  const chrome = findChrome();
  const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome.path } : {}) });
  try {
    const signed = [];
    const studio = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    studio.on('pageerror', (e) => console.error('studio pageerror', e.message));
    await injectWallet(studio, creator, { name: 'Proof Wallet', log: signed });
    await studio.goto(`${server.url}studio/`);
    const tab = studio.locator('.panel:not([hidden])');

    // ---- Token tab: launch with no initial buy (two Irys uploads, one transaction)
    await studio.getByRole('tab', { name: 'Token' }).click();
    await tab.getByTestId('token-launch').click();
    await tab.getByTestId('token-picture').click();
    await studio.locator('.pickgrid button', { hasText: 'icon.png' }).click();
    await tab.getByTestId('token-name').fill('Proof Brawl');
    await tab.getByTestId('token-symbol').fill('PROOF');
    await tab.getByTestId('token-launch-go').click();
    await tab.getByTestId('approve').click();
    const launch = await waitForApproval(tab, 180_000);
    step('Irys uploads from the Token tab (signed by the wallet with signMessage, free under 100 KB)', { uploads: uploadsIn(launch.texts), prompts: signed.map((s) => s.kind) });
    await studio.screenshot({ path: path.join(keyDir, 'proof-token.png'), fullPage: true });
    if (!launch.ok) {
      step('token launch transaction', { ok: false, error: launch.error });
      if (result.blocked) return;
      throw new Error(`launch failed: ${launch.error}`);
    }
    const token = (await config()).token;
    step('token launched (Meteora DBC antisnipe-v1, MAIN-dev quote, no initial buy)', { mint: token.mint, pool: token.pool, signature: token.signature, metadataUri: token.metadataUri, explorer: explorerUrl(network, 'tx', token.signature) });

    // ---- Shop tab: SOL currency, two items, one box, one approval for the transactions
    signed.length = 0;
    await studio.getByRole('tab', { name: 'Shop' }).click();
    await tab.getByRole('radio', { name: 'SOL' }).click();
    await tab.getByText('Your shop is priced in SOL.').waitFor();
    for (const [name, picture, price] of [['Golden Hat', 'hat.png', '0.01'], ['Ice Skin', 'skin.png', '']]) {
      await tab.getByTestId('shop-add-item').click();
      await studio.getByTestId('item-picture').click();
      await studio.locator('.pickgrid button', { hasText: picture }).click();
      await studio.getByTestId('item-name').fill(name);
      await studio.getByTestId('item-price').fill(price);
      if (name === 'Golden Hat') await studio.getByTestId('look-character.tint.player').check();
      await studio.getByTestId('item-save').click();
      await tab.getByText(name, { exact: true }).waitFor();
    }
    await tab.getByTestId('shop-add-box').click();
    await studio.getByTestId('box-price').fill('0.005');
    await studio.getByTestId('box-save').click();
    await tab.getByTestId('shop-box').waitFor();
    await tab.getByTestId('shop-publish-go').click();
    await tab.getByTestId('approve').click();
    const publish = await waitForApproval(tab, 300_000);
    const shop = (await config()).shop;
    step('shop on sale: uploads, then collection + loot game + 2 items + 1 box in one wallet approval', {
      ok: publish.ok,
      error: publish.error,
      prompts: signed.map((s) => s.kind),
      collection: shop.collection ?? null,
      game: shop.game ?? null,
      items: shop.items.map((i) => ({ id: i.id, name: i.name, uri: i.uri ?? null, listed: i.listed })),
      boxes: shop.boxes.map((b) => ({ id: b.id, listed: b.listed })),
      results: publish.texts,
    });
    await studio.screenshot({ path: path.join(keyDir, 'proof-shop.png'), fullPage: true });
    if (!publish.ok) throw new Error(`publish failed: ${publish.error}`);
    const state = await (await fetch(`${server.url}api/web3/state`)).json();
    step('chain status after publish', { shopLive: state.chain.shop.exists, items: state.chain.shop.items, boxes: state.chain.shop.boxes });

    // ---- Player: funded by the creator, then buys and opens through the game's own gf-web3
    step('fund the player from the creator (test keys)', { signature: await transfer(creator, player.address, 300_000_000n) });
    const game = await browser.newPage();
    game.on('pageerror', (e) => console.error('game pageerror', e.message));
    await injectWallet(game, player, { name: 'Player Wallet' });
    await game.goto(`${server.url}game/?gamesfun_mock=0`);
    await game.waitForFunction(() => Boolean(window.__game), null, { timeout: 60_000 }).catch(() => {});
    const gf = (fn) => game.evaluate(fn);
    const bought = await gf(async () => {
      const kit = (await import('/game/gf/web3/index.js')).default;
      const r = await kit.shop.buy(1);
      return { mock: kit.mock, item: r.item.name, asset: r.asset, signatures: r.signatures };
    });
    step('the player buys Golden Hat (buy_item with SOL wrapped around it, then settle: two approvals)', { ...bought, explorer: explorerUrl(network, 'tx', bought.signatures[0]) });
    const opened = await gf(async () => {
      const kit = (await import('/game/gf/web3/index.js')).default;
      const r = await kit.openBox(1);
      return { item: r.item.name, serial: r.item.serial, asset: r.asset, order: r.order, signatures: r.signatures };
    });
    step('the player opens Mystery Box (open_box → MagicBlock VRF callback_roll → settle)', { ...opened, explorer: opened.signatures.map((s) => explorerUrl(network, 'tx', s)) });
    await game.waitForTimeout(4000);
    const owned = await gf(async () => {
      const kit = (await import('/game/gf/web3/index.js')).default;
      const items = await kit.ownedItems();
      const worn = await kit.wearOwned();
      await new Promise((r) => setTimeout(r, 1500));
      const looks = window.__game?.looks?.() ?? null;
      return { items: items.map((i) => ({ id: i.id, name: i.name, asset: i.asset })), loadout: worn.loadout, gfThree: looks ? { local: looks.local, me: looks.players?.find((p) => p.id === looks.me) ?? null } : null };
    });
    step('the player’s items, read from the collection (getProgramAccounts on the public devnet RPC) and worn as a gf-three loadout', owned);
  } finally {
    await browser.close();
    await server.close();
    result.finishedAt = new Date().toISOString();
    await writeFile(path.join(here, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log('wrote tests/web3/devnet/result.json');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
