// K0's devnet proof: today's shop on the loot program 0.3, from the kit's own code only. The creator side goes
// through the same drafts and publish flow the studio's Shop tab drives (flow engine: the server prepares, the wallet
// signs, the server checks and sends); the player side goes through the in-game kit gf-web3 with a Wallet Standard
// wallet object. A local test key stands in for each wallet: in the product the person's own wallet signs in the page.
//
//   1. the shop example (two items, a box, priced in SOL) is published: uploads, then collection + game + items + box
//   2. a player buys an item (pay, then claim) and opens the box (MagicBlock's oracle rolls it on devnet, then claim)
//   3. a forced refund: the creator edits the box in the same transaction the player opens it, so the oracle's roll
//      finds another version of the box, the order fails, and the player gets it back at once (gf-web3 finish)
//   4. a shop priced in a Token-2022 coin that keeps 1% of every transfer: published, and an item bought and claimed
//
// Devnet only (the kit refuses any other network; this script also checks devnet's genesis hash). The keys are
// read from files named by environment variables, never printed or written:
//   GF_DEVNET_CREATOR_KEY=<path to the creator's keypair JSON> GF_DEVNET_PLAYER_KEY=<path to the player's> \
//     node tests/web3/devnet/loot-0.3.mjs
// The result (each step, its signatures and addresses, pass or fail) goes to tests/web3/devnet/loot-0.3-result.json.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressBytes } from '../../../web3/gf-web3/chain/base58.js';
import { concat, readUintLE, uintLE } from '../../../web3/gf-web3/chain/bytes.js';
import { parseCoreAsset } from '../../../web3/gf-web3/chain/core.js';
import { boxArgs, decodeLoot, LootAccount, lootEvents, lootPda, newNonce, openBoxIxs, upsertBoxIx } from '../../../web3/gf-web3/chain/loot.js';
import { associatedTokenAddress, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM } from '../../../web3/gf-web3/chain/pda.js';
import { createAssociatedTokenAccountIdempotent, meta, withSolWrap } from '../../../web3/gf-web3/chain/programs.js';
import { transferExtras } from '../../../web3/gf-web3/chain/token2022.js';
import { compileMessage, readTransaction, signersOf, wireTransaction } from '../../../web3/gf-web3/chain/tx.js';
import { createGfWeb3 } from '../../../web3/gf-web3/index.js';
import { explorerUrl, networkConfig } from '../../../web3/gf-web3/network.js';
import { rpcClient } from '../../../web3/gf-web3/rpc.js';
import { boxOnChainArgs } from '../../../web3/node/chain.mjs';
import { saveBox, saveItem, setCurrency } from '../../../web3/node/drafts.mjs';
import { freshKeypair, keypairFromSecret } from '../../../web3/node/ed25519.mjs';
import { createFlowEngine } from '../../../web3/node/flow-engine.mjs';
import { publishFlow } from '../../../web3/node/flows.mjs';
import { png } from '../helpers.mjs';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const here = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(here, '..', '..', '..');
const scratch = path.join(kitRoot, '.gamesfun', 'devnet', 'loot-0.3');
const network = networkConfig('devnet');
const rpc = rpcClient(process.env.GF_DEVNET_RPC ?? network.rpcUrl);
const result = { network: 'devnet', program: network.loot.program, platform: network.loot.platform, startedAt: new Date().toISOString(), steps: [] };
const tx = (signature) => explorerUrl(network, 'tx', signature);

/** Runs one step, records what it returned or how it failed, and carries on. */
async function step(name, run) {
  const at = new Date().toISOString();
  try {
    const out = (await run()) ?? {};
    result.steps.push({ name, at, ok: out.ok !== false, ...out });
    console.log(`${out.ok === false ? '✗' : '✓'} ${name}`);
    return out;
  } catch (error) {
    result.steps.push({ name, at, ok: false, error: error.message, logs: error.logs?.slice(-12) });
    console.log(`✗ ${name}: ${error.message}`);
    return null;
  }
}

async function key(variable) {
  const file = process.env[variable];
  if (!file) throw new Error(`Set ${variable} to the path of a devnet keypair file.`);
  return keypairFromSecret(Uint8Array.from(JSON.parse(await readFile(file, 'utf8'))));
}

/** A transaction signed here by the test keys (a wallet signs in the product), sent and confirmed. */
async function send(instructions, signers) {
  const { blockhash, lastValidBlockHeight } = await rpc.latestBlockhash();
  const message = compileMessage({ payer: signers[0].address, blockhash, instructions });
  const signatures = signersOf(message).map((a) => signers.find((s) => s.address === a).sign(message));
  const signature = await rpc.send(wireTransaction(message, signatures));
  await rpc.confirm(signature, { lastValidBlockHeight });
  return signature;
}

/** The receipts a landed transaction wrote. */
async function receipts(signature) {
  const t = await rpc.call('getTransaction', [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  return lootEvents(t?.meta?.logMessages ?? []).map((e) => e.name);
}

/** Answers every step of a flow with `wallet`, as the studio page does with the person's wallet. */
async function approveAll(engine, flow, wallet) {
  let view = flow;
  while (!view.done) {
    const p = await engine.prepare(view.id, wallet.address);
    if (p.kind === 'message') view = await engine.complete(view.id, { prepareId: p.prepareId, signature: Buffer.from(wallet.sign(new TextEncoder().encode(p.text))).toString('base64') });
    else {
      const signed = p.transactions.map((b64) => {
        const wire = new Uint8Array(Buffer.from(b64, 'base64'));
        const { message, signers, signatures: slots } = readTransaction(wire);
        const filled = signers.map((s, i) => (s === wallet.address ? wallet.sign(message) : slots[i]));
        return Buffer.from(wireTransaction(message, filled)).toString('base64');
      });
      view = await engine.complete(view.id, { prepareId: p.prepareId, signed });
    }
  }
  return view;
}

/** A Wallet Standard wallet object backed by a test key (what a browser wallet extension registers). */
function standardWallet(k) {
  const account = { address: k.address, publicKey: addressBytes(k.address), chains: ['solana:devnet'], features: [] };
  const sign = (wire) => {
    const { message, signers, signatures } = readTransaction(wire);
    return wireTransaction(message, signers.map((s, i) => (s === k.address ? k.sign(message) : signatures[i])));
  };
  return {
    version: '1.0.0', name: 'Proof Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', chains: ['solana:devnet'], accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async (...inputs) => inputs.map((i) => ({ signedTransaction: sign(i.transaction) })) },
      'solana:signMessage': { version: '1.0.0', signMessage: async (...inputs) => inputs.map((i) => ({ signedMessage: i.message, signature: k.sign(i.message) })) },
    },
  };
}

/** A fresh game folder with pictures and an empty gamesfun.json. */
async function gameFolder(name, title) {
  const dir = path.join(scratch, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), `<!doctype html><title>${title}</title>`);
  await writeFile(path.join(dir, 'gamesfun.json'), `${JSON.stringify({ version: 1, network: 'devnet' }, null, 2)}\n`);
  await writeFile(path.join(dir, 'assets', 'hat.png'), png(250, 210, 0, 16, 16));
  await writeFile(path.join(dir, 'assets', 'skin.png'), png(40, 180, 250, 16, 16));
  return dir;
}

const readConfig = async (dir) => JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
const kitFor = (config, player) =>
  createGfWeb3({ config, mock: false, location: { search: '', href: 'http://127.0.0.1/', host: '127.0.0.1', origin: 'http://127.0.0.1', pathname: '/' }, navigator: { webdriver: false, userAgent: 'node' }, wallets: [standardWallet(player)], rpc: rpc.url, rollPollMs: 2000 });
const ownerOf = async (asset) => {
  const [account] = await rpc.accounts([asset]);
  return account ? parseCoreAsset(account.data).owner : null;
};

/** Publish a game folder's shop with the creator's key answering the flow. */
async function publish(dir, creator) {
  const engine = createFlowEngine();
  const flow = engine.start(await publishFlow({ gameDir: dir, rpc, network }, creator.address));
  const done = await approveAll(engine, flow, creator);
  const config = await readConfig(dir);
  const landed = done.results.join(' ').match(/[1-9A-HJ-NP-Za-km-z]{80,90}/g) ?? [];
  const game = config.shop.game ? decodeLoot(LootAccount.Game, (await rpc.account(config.shop.game)).data) : null;
  return { config, results: done.results, signatures: landed, game };
}

// ---------------------------------------------------------------- a Token-2022 coin with a 1% transfer fee
const TOKEN_2022 = { transferFeeExtension: 26, initializeTransferFeeConfig: 0, initializeMint2: 20, mintTo: 7 };
const MINT_WITH_FEE_BYTES = 165 + 1 + 4 + 108;

/** The instructions that make it: create the account, the fee config, the mint; then the player's account and coins. */
async function coinInstructions(creator, mint, player, amount) {
  const rent = BigInt(await rpc.call('getMinimumBalanceForRentExemption', [MINT_WITH_FEE_BYTES]));
  const createAccount = { programId: SYSTEM_PROGRAM, keys: [meta(creator.address, true, true), meta(mint.address, true, true)], data: concat(uintLE(0, 4), uintLE(rent, 8), uintLE(MINT_WITH_FEE_BYTES, 8), addressBytes(TOKEN_2022_PROGRAM)) };
  const feeConfig = {
    programId: TOKEN_2022_PROGRAM,
    keys: [meta(mint.address, false, true)],
    data: concat(Uint8Array.of(TOKEN_2022.transferFeeExtension, TOKEN_2022.initializeTransferFeeConfig, 1), addressBytes(creator.address), Uint8Array.of(1), addressBytes(creator.address), uintLE(100, 2), uintLE(10n ** 15n, 8)),
  };
  const init = { programId: TOKEN_2022_PROGRAM, keys: [meta(mint.address, false, true)], data: concat(Uint8Array.of(TOKEN_2022.initializeMint2, 6), addressBytes(creator.address), Uint8Array.of(0), new Uint8Array(32)) };
  const playerAccount = associatedTokenAddress(player, mint.address, TOKEN_2022_PROGRAM);
  const mintTo = { programId: TOKEN_2022_PROGRAM, keys: [meta(mint.address, false, true), meta(playerAccount, false, true), meta(creator.address, true, false)], data: concat(Uint8Array.of(TOKEN_2022.mintTo), uintLE(amount, 8)) };
  return [createAccount, feeConfig, init, createAssociatedTokenAccountIdempotent(creator.address, player, mint.address, TOKEN_2022_PROGRAM), mintTo];
}

const tokenAmount = async (account) => {
  const [a] = await rpc.accounts([account]);
  return a ? readUintLE(a.data, 64, 8) : 0n;
};

// ---------------------------------------------------------------- the run

async function main() {
  const genesis = await rpc.call('getGenesisHash');
  if (genesis !== DEVNET_GENESIS) throw new Error(`This RPC is not devnet (genesis ${genesis}). The kit runs on devnet only.`);
  const creator = await key('GF_DEVNET_CREATOR_KEY');
  const player = await key('GF_DEVNET_PLAYER_KEY');
  Object.assign(result, { creator: creator.address, player: player.address });
  const start = { creator: await rpc.balance(creator.address), player: await rpc.balance(player.address) };
  await step('wallets on devnet', async () => ({ creatorLamports: String(start.creator), playerLamports: String(start.player), ok: start.creator > 300_000_000n && start.player > 150_000_000n }));

  // 1. The shop example, published.
  const shopDir = await gameFolder('shop', 'Proof Brawl');
  const ctx = { gameDir: shopDir, rpc, network };
  const shop = await step('the shop example is published: uploads, then collection + loot game + 2 items + 1 box in one approval', async () => {
    await setCurrency(ctx, { currency: 'SOL' });
    await saveItem(ctx, { name: 'Golden Hat', picture: 'assets/hat.png', rarity: 'Rare', price: '0.01', look: { values: { 'character.tint.player': '#ffcc00' } } });
    await saveItem(ctx, { name: 'Ice Skin', picture: 'assets/skin.png', rarity: 'Epic' });
    await saveBox(ctx, { name: 'Mystery Box', price: '0.005' });
    const out = await publish(shopDir, creator);
    const s = out.config.shop;
    return {
      collection: s.collection, game: s.game, treasury: s.treasury, signatures: out.signatures, results: out.results,
      gameOnChain: out.game && { owner: out.game.owner, authority: out.game.authority, mint: out.game.mint, treasury: out.game.treasury },
      items: s.items.map((i) => ({ id: i.id, name: i.name, uri: i.uri, listed: i.listed })), boxes: s.boxes.map((b) => ({ id: b.id, listed: b.listed })),
      ok: Boolean(out.game) && out.game.owner === creator.address && s.items.every((i) => i.listed) && s.boxes.every((b) => b.listed),
    };
  });
  if (!shop?.ok) return;
  const config = await readConfig(shopDir);
  const kit = kitFor(config, player);

  // 2. A player buys and opens a box.
  await step('a player buys Golden Hat: pay (buy_item), then claim (settle mints the collectible)', async () => {
    const r = await kit.shop.buy(1);
    const owner = await ownerOf(r.asset);
    return { order: r.order, asset: r.asset, assetOwner: owner, signatures: r.signatures, receipts: await Promise.all(r.signatures.map(receipts)), explorer: r.signatures.map(tx), ok: owner === player.address };
  });
  await step('the player opens Mystery Box: pay and roll (open_box), MagicBlock’s oracle rolls it on devnet, then claim (settle)', async () => {
    const r = await kit.openBox(1);
    const owner = r.asset ? await ownerOf(r.asset) : null;
    return { order: r.order, item: r.item.name, serial: r.item.serial, asset: r.asset, assetOwner: owner, signatures: r.signatures, receipts: await Promise.all(r.signatures.map(receipts)), explorer: r.signatures.map(tx), ok: owner === player.address };
  });
  await step('the player’s items, read from the collection', async () => {
    const items = await kit.ownedItems();
    return { items: items.map((i) => ({ id: i.id, name: i.name, serial: i.serial, asset: i.asset })), ok: items.length >= 2 };
  });

  // 3. A forced refund: the box is edited in the transaction that opens it, so the roll finds another version.
  await step('a forced refund: the creator edits the box in the transaction the player opens it in; the roll fails, the player refunds at once', async () => {
    const game = config.shop.game;
    const box = decodeLoot(LootAccount.Box, (await rpc.account(lootPda.box(game, 1))).data);
    const nonce = newNonce();
    const open = openBoxIxs({ player: player.address, game, mint: box.currency ?? decodeLoot(LootAccount.Game, (await rpc.account(game)).data).mint, boxId: 1, box, nonce });
    const edit = upsertBoxIx({ owner: creator.address, game, boxId: 1, args: boxArgs(boxOnChainArgs(config.shop.boxes[0])) });
    const opened = await send(withSolWrap(player.address, 'So11111111111111111111111111111111111111112', box.price, [...open.instructions, edit]), [player, creator]);
    let order = null;
    for (let i = 0; i < 90 && (!order || order.status === 'Pending'); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const [a] = await rpc.accounts([open.order]);
      order = a ? decodeLoot(LootAccount.Order, a.data) : null;
    }
    if (order?.status !== 'Failed') return { order: open.order, opened, status: order?.status ?? 'gone', ok: false };
    const before = await rpc.balance(player.address);
    const finished = await kit.finish(open.order);
    const after = await rpc.balance(player.address);
    const [gone] = await rpc.accounts([open.order]);
    return {
      order: open.order, status: order.status, signatures: [opened, ...finished.signatures], receipts: [await receipts(opened), await receipts(finished.signatures[0])],
      explorer: [opened, ...finished.signatures].map(tx), playerLamportsBack: String(after - before), orderClosed: !gone, ok: finished.refunded === true && !gone,
    };
  });

  // 4. A shop priced in a Token-2022 coin with a 1% transfer fee.
  const coin = freshKeypair();
  const coinStep = await step('a Token-2022 coin with a 1% transfer fee (made here for the test), 1000 to the player', async () => {
    const signature = await send(await coinInstructions(creator, coin, player.address, 1000n * 1_000_000n), [creator, coin]);
    return { mint: coin.address, signature, explorer: tx(signature) };
  });
  coin.drop();
  if (!coinStep) return finishRun(start, creator, player);
  const coinDir = await gameFolder('token-2022-shop', 'Proof Coin Shop');
  const coinShop = await step('a shop priced in the Token-2022 coin is published', async () => {
    const c = { gameDir: coinDir, rpc, network };
    await setCurrency(c, { currency: coinStep.mint });
    await saveItem(c, { name: 'Coin Crown', picture: 'assets/hat.png', rarity: 'Legendary', price: '10' });
    const out = await publish(coinDir, creator);
    return { game: out.config.shop.game, treasury: out.config.shop.treasury, currency: out.config.shop.currency, signatures: out.signatures, ok: out.config.shop.currency.program === 'token-2022' && out.config.shop.items[0].listed };
  });
  if (coinShop?.ok) {
    await step('the player buys Coin Crown in the Token-2022 coin (the Memo program rides along); the treasury gets what the coin’s fee leaves', async () => {
      const coinConfig = await readConfig(coinDir);
      const before = await tokenAmount(coinConfig.shop.treasury);
      const r = await kitFor(coinConfig, player).shop.buy(1);
      const got = (await tokenAmount(coinConfig.shop.treasury)) - before;
      const owner = await ownerOf(r.asset);
      const extras = await transferExtras(rpc, coinStep.mint);
      // 10 coins: 1% stays withheld on the way into the vault, 1% of the rest on the way to the treasury.
      const expected = 10_000_000n - 100_000n - (9_900_000n / 100n);
      return { order: r.order, asset: r.asset, assetOwner: owner, treasuryGot: String(got), expected: String(expected), extras: extras.map((m) => m.pubkey), signatures: r.signatures, explorer: r.signatures.map(tx), ok: owner === player.address && got === expected };
    });
  }
  return finishRun(start, creator, player);
}

async function finishRun(start, creator, player) {
  result.lamportsSpent = { creator: String(start.creator - (await rpc.balance(creator.address))), player: String(start.player - (await rpc.balance(player.address))) };
}

try {
  await main();
} catch (error) {
  result.steps.push({ name: 'run', ok: false, error: error.message });
  console.error(error);
}
result.finishedAt = new Date().toISOString();
result.ok = result.steps.length > 0 && result.steps.every((s) => s.ok);
await writeFile(path.join(here, 'loot-0.3-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.ok ? 'K0 devnet proof: every step passed' : 'K0 devnet proof: some steps failed', '→ tests/web3/devnet/loot-0.3-result.json');
process.exitCode = result.ok ? 0 : 1;
