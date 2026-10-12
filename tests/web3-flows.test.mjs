// The approval flows, offline: a fake chain and Irys node (tests/web3/fake-chain.mjs) and a wallet made of a fresh
// test key that signs exactly like a Wallet Standard wallet (signMessage on the text; signTransaction filling its
// own slot). Covers the engine's replay protection and signature checks, then a whole shop publish and a whole
// token launch through the HTTP routes, down to what lands in gamesfun.json.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromBase64, toBase64, utf8 } from '../web3/gf-web3/chain/bytes.js';
import { decodeLoot, lootPda } from '../web3/gf-web3/chain/loot.js';
import { associatedTokenAddress, TOKEN_2022_PROGRAM } from '../web3/gf-web3/chain/pda.js';
import { compileMessage, readMessage, readTransaction, wireTransaction, withSignature } from '../web3/gf-web3/chain/tx.js';
import { transferLamports } from '../web3/gf-web3/chain/programs.js';
import { freshKeypair } from '../web3/node/ed25519.mjs';
import { createFlowEngine } from '../web3/node/flow-engine.mjs';
import { queueRequest } from '../web3/node/requests.mjs';
import { fakeChain } from './web3/fake-chain.mjs';
import { makeGame, post, request, serve } from './web3/helpers.mjs';

const F = JSON.parse(await readFile(new URL('./web3/fixtures/chain.json', import.meta.url), 'utf8'));

/** A test wallet that signs the way a Wallet Standard wallet does. */
function testWallet() {
  const key = freshKeypair();
  return {
    address: key.address,
    signMessage: (text) => toBase64(key.sign(utf8(text))),
    signTransactions: (b64s) => b64s.map((b64) => {
      const wire = fromBase64(b64);
      return toBase64(withSignature(wire, key.address, key.sign(readTransaction(wire).message)));
    }),
  };
}

/** Run a started flow to the end through the routes, approving every step. Returns the final view. */
async function approveAll(port, flow, wallet, { tamper } = {}) {
  let view = flow;
  for (let guard = 0; !view.done && guard < 40; guard++) {
    const prepared = await post(port, '/flow/prepare', { flowId: view.id, wallet: wallet.address });
    assert.equal(prepared.status, 200, prepared.text);
    const p = prepared.json;
    const answer = p.kind === 'message' ? { signature: wallet.signMessage(p.text) } : { signed: wallet.signTransactions(tamper ? tamper(p.transactions) : p.transactions) };
    const done = await post(port, '/flow/complete', { flowId: view.id, prepareId: p.prepareId, ...answer });
    assert.equal(done.status, 200, done.text);
    view = done.json;
  }
  return view;
}

describe('the approval engine', () => {
  const wallet = testWallet();
  const message = { title: 'Sign', prepare: async () => ({ kind: 'message', text: 'hello' }), complete: async () => 'ok' };
  const blockhash = F.messages.blockhash;
  const tx = () => ({
    title: 'Pay',
    prepare: async () => ({ kind: 'transactions', transactions: [wireTransaction(compileMessage({ payer: wallet.address, blockhash, instructions: [transferLamports(wallet.address, F.loot.inputs.creator, 5n)] }))] }),
    complete: async (flow, answer) => `sent ${answer.transactions.length}`,
  });

  it('a prepared answer is used once: a replay is refused', async () => {
    const engine = createFlowEngine();
    const flow = engine.start({ kind: 't', title: 't', wallet: wallet.address, steps: [message, message] });
    const p = await engine.prepare(flow.id, wallet.address);
    const answer = { prepareId: p.prepareId, signature: wallet.signMessage(p.text) };
    assert.equal((await engine.complete(flow.id, answer)).next, 1);
    await assert.rejects(engine.complete(flow.id, answer), (e) => e.status === 409);
  });

  it('an answer for another prepare, an expired one, or from another wallet completes nothing', async () => {
    let clock = 1_000;
    const engine = createFlowEngine({ now: () => clock });
    const flow = engine.start({ kind: 't', title: 't', wallet: wallet.address, steps: [message] });
    const p = await engine.prepare(flow.id, wallet.address);
    await assert.rejects(engine.complete(flow.id, { prepareId: 'nope', signature: wallet.signMessage(p.text) }), (e) => e.status === 409);
    const q = await engine.prepare(flow.id, wallet.address);
    await assert.rejects(engine.complete(flow.id, { prepareId: q.prepareId, signature: testWallet().signMessage(q.text) }), (e) => e.status === 400);
    const r = await engine.prepare(flow.id, wallet.address);
    clock += 91_000;
    await assert.rejects(engine.complete(flow.id, { prepareId: r.prepareId, signature: wallet.signMessage(r.text) }), (e) => e.status === 410);
    await assert.rejects(engine.prepare(flow.id, testWallet().address), (e) => e.status === 409);
    assert.equal(engine.get(flow.id).next, 0);
  });

  it('refuses a transaction the wallet changed, one signed by another key, and a missing signature', async () => {
    const engine = createFlowEngine();
    const flow = engine.start({ kind: 't', title: 't', wallet: wallet.address, steps: [tx()] });
    const p1 = await engine.prepare(flow.id, wallet.address);
    const changed = wireTransaction(compileMessage({ payer: wallet.address, blockhash, instructions: [transferLamports(wallet.address, F.loot.inputs.player, 5_000_000_000n)] }));
    await assert.rejects(engine.complete(flow.id, { prepareId: p1.prepareId, signed: wallet.signTransactions([toBase64(changed)]) }), /changed the transaction/);
    const p2 = await engine.prepare(flow.id, wallet.address);
    const other = testWallet();
    const forged = p2.transactions.map((b64) => {
      const wire = fromBase64(b64);
      return toBase64(withSignature(wire, wallet.address, fromBase64(other.signMessage('x')).slice(0, 64)));
    });
    await assert.rejects(engine.complete(flow.id, { prepareId: p2.prepareId, signed: forged }), /signature/);
    const p3 = await engine.prepare(flow.id, wallet.address);
    await assert.rejects(engine.complete(flow.id, { prepareId: p3.prepareId, signed: p3.transactions }), /signature/);
    const p4 = await engine.prepare(flow.id, wallet.address);
    await assert.rejects(engine.complete(flow.id, { prepareId: p4.prepareId, signed: [] }), /does not match/);
    const p5 = await engine.prepare(flow.id, wallet.address);
    assert.equal((await engine.complete(flow.id, { prepareId: p5.prepareId, signed: wallet.signTransactions(p5.transactions) })).done, true);
  });

  it('caps how many flows wait at once, and nothing starts without a wallet or a step', () => {
    const engine = createFlowEngine({ maxFlows: 2 });
    engine.start({ kind: 't', title: 't', wallet: wallet.address, steps: [message] });
    engine.start({ kind: 't', title: 't', wallet: wallet.address, steps: [message] });
    assert.throws(() => engine.start({ kind: 't', title: 't', wallet: wallet.address, steps: [message] }), (e) => e.status === 429);
    assert.throws(() => createFlowEngine().start({ kind: 't', title: 't', wallet: 'nope', steps: [message] }), (e) => e.status === 400);
    assert.throws(() => createFlowEngine().start({ kind: 't', title: 't', wallet: wallet.address, steps: [] }), (e) => e.status === 409);
  });
});

describe('putting a shop on sale, end to end (offline)', () => {
  let game;
  let chain;
  let server;
  const wallet = testWallet();
  before(async () => {
    game = await makeGame();
    chain = fakeChain();
    server = await serve({ gameDir: game.gameDir, kitRoot: game.kitRoot, fetchImpl: chain.fetchImpl, env: {}, log: () => {} });
  });
  after(() => server.close());

  it('drafts items and a box, then one approval for every transaction', async () => {
    assert.equal((await post(server.port, '/item/save', { name: 'Golden Hat', picture: 'assets/hat.png', rarity: 'Rare', price: '0.05', look: { values: { 'character.tint.player': '#ffcc00' } } })).status, 200);
    assert.equal((await post(server.port, '/item/save', { name: 'Ice Skin', picture: 'assets/skin.png', rarity: 'Epic' })).status, 200);
    assert.equal((await post(server.port, '/item/save', { name: 'No Picture Yet' })).status, 200);
    const box = await post(server.port, '/box/save', { name: 'Mystery Box', price: '0.01', odds: '1:60,2:40' });
    assert.equal(box.status, 200, box.text);
    const state = await request(server.port, { path: '/api/web3/state' });
    assert.equal(state.json.chain.shop.items[1].state, 'draft');

    const started = await post(server.port, '/flow/start', { kind: 'publish', wallet: wallet.address });
    assert.equal(started.status, 200, started.text);
    // 2 pictures + collection details + 2 item details + one transactions approval; the item with no picture waits.
    assert.equal(started.json.steps.length, 6);
    assert.match(started.json.lines.join(' '), /No Picture Yet still needs a picture/);
    const done = await approveAll(server.port, started.json, wallet);
    assert.equal(done.done, true);
    assert.equal(chain.uploads.length, 5);
    assert.ok(chain.sent.length >= 1 && chain.sent.length <= 3, `sent ${chain.sent.length}`);

    const config = JSON.parse(await readFile(path.join(game.gameDir, 'gamesfun.json'), 'utf8'));
    assert.equal(config.creator, wallet.address);
    assert.equal(config.shop.currency.symbol, 'SOL');
    assert.equal(config.shop.game, lootPda.game(config.shop.collection));
    assert.deepEqual(config.shop.items.map((i) => i.listed), [true, true, false]);
    assert.equal(config.shop.boxes[0].listed, true);
    assert.match(config.shop.items[0].uri, /^https:\/\/devnet\.irys\.xyz\/[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    const item = decodeLoot('Item', chain.accounts.get(lootPda.item(config.shop.game, 1)).data);
    assert.equal(item.price, 50_000_000n);
    assert.equal(item.uri, config.shop.items[0].uri);
    // The item details uploaded are real Metaplex JSON with the look under properties.gameLook.
    // A data item (ANS-104, no target): 2 + 64 + 32 + 1 + 1 + 32 + 8 bytes, then the tags' length (u64), the tags, the data.
    const dataItem = chain.uploads.find((u) => u.id === config.shop.items[0].uri.split('/').pop()).bytes;
    const tagsLength = Number(new DataView(dataItem.buffer, dataItem.byteOffset).getBigUint64(140, true));
    const meta = JSON.parse(new TextDecoder().decode(dataItem.subarray(148 + tagsLength)));
    assert.deepEqual(meta.properties.gameLook, { values: { 'character.tint.player': '#ffcc00' }, files: {} });

    const after = await request(server.port, { path: '/api/web3/state' });
    assert.equal(after.json.chain.shop.items[1].state, 'published');
    assert.equal(after.json.chain.shop.boxes[1].state, 'published');
  });

  it('a later change is one more approval, with no new upload when only the price changed', async () => {
    const uploads = chain.uploads.length;
    assert.equal((await post(server.port, '/item/save', { id: 2, price: '0.2' })).status, 200);
    const started = await post(server.port, '/flow/start', { kind: 'publish', wallet: wallet.address });
    assert.equal(started.json.steps.length, 1, started.text);
    await approveAll(server.port, started.json, wallet);
    assert.equal(chain.uploads.length, uploads);
    const config = JSON.parse(await readFile(path.join(game.gameDir, 'gamesfun.json'), 'utf8'));
    assert.equal(decodeLoot('Item', chain.accounts.get(lootPda.item(config.shop.game, 2)).data).price, 200_000_000n);
    assert.equal((await post(server.port, '/shop/currency', { currency: 'USDC' })).status, 400);
  });

  it('the loot game is the creator’s: its owner and its authority, the whole sale to the treasury', async () => {
    const config = JSON.parse(await readFile(path.join(game.gameDir, 'gamesfun.json'), 'utf8'));
    const g = decodeLoot('Game', chain.accounts.get(config.shop.game).data);
    assert.deepEqual([g.owner, g.authority, g.treasury, g.mint], [wallet.address, wallet.address, config.shop.treasury, config.shop.currency.mint]);
    assert.equal(config.shop.currency.program, 'spl-token');
    const box = decodeLoot('LootBox', chain.accounts.get(lootPda.box(config.shop.game, 1)).data);
    assert.deepEqual(box.entries, [{ outcome: { Item: [1] }, weight: 60 }, { outcome: { Item: [2] }, weight: 40 }]);
    assert.deepEqual([box.currency, box.shares], [null, []]);
  });

  it('only the shop’s wallet can change it', async () => {
    const r = await post(server.port, '/flow/start', { kind: 'publish', wallet: testWallet().address });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /belongs to the wallet/);
  });
});

describe('a shop priced in a Token-2022 token (offline)', () => {
  it('prices in it, opens the treasury under Token-2022, and the game takes that mint', async () => {
    const game = await makeGame();
    const chain = fakeChain();
    const mint = testWallet().address;
    const data = new Uint8Array(82);
    data[44] = 6;
    data[45] = 1;
    chain.put(mint, TOKEN_2022_PROGRAM, data);
    const server = await serve({ gameDir: game.gameDir, kitRoot: game.kitRoot, fetchImpl: chain.fetchImpl, env: {}, log: () => {} });
    const wallet = testWallet();
    try {
      const priced = await post(server.port, '/shop/currency', { currency: mint });
      assert.equal(priced.status, 200, priced.text);
      assert.equal((await post(server.port, '/item/save', { name: 'Golden Hat', picture: 'assets/hat.png', price: '2.5' })).status, 200);
      const started = await post(server.port, '/flow/start', { kind: 'publish', wallet: wallet.address });
      assert.equal(started.status, 200, started.text);
      assert.equal((await approveAll(server.port, started.json, wallet)).done, true);
      const config = JSON.parse(await readFile(path.join(game.gameDir, 'gamesfun.json'), 'utf8'));
      assert.equal(config.shop.currency.program, 'token-2022');
      assert.equal(config.shop.treasury, associatedTokenAddress(wallet.address, mint, TOKEN_2022_PROGRAM));
      const g = decodeLoot('Game', chain.accounts.get(config.shop.game).data);
      assert.deepEqual([g.mint, g.treasury], [mint, config.shop.treasury]);
      assert.equal(decodeLoot('Item', chain.accounts.get(lootPda.item(config.shop.game, 1)).data).price, 2_500_000n);
    } finally {
      await server.close();
    }
  });
});

describe('launching a token, end to end (offline)', () => {
  it('uploads the picture and details, then creates the pool, and records what the chain shows', async () => {
    const game = await makeGame();
    const chain = fakeChain();
    const config = F.accounts.poolConfig;
    chain.put(config.address, config.owner, fromBase64(config.data));
    const server = await serve({ gameDir: game.gameDir, kitRoot: game.kitRoot, fetchImpl: chain.fetchImpl, env: {}, log: () => {} });
    const wallet = testWallet();
    try {
      const request = await queueRequest(game.kitRoot, { kind: 'launch', gameDir: game.gameDir, input: { name: 'Bean Brawl', symbol: 'BEAN', picture: 'assets/icon.png', description: 'The bean game' }, from: 'test' });
      const started = await post(server.port, '/flow/start', { requestId: request.id, wallet: wallet.address });
      assert.equal(started.status, 200, started.text);
      assert.equal(started.json.steps.length, 3);
      const done = await approveAll(server.port, started.json, wallet);
      assert.equal(done.done, true);
      const saved = JSON.parse(await readFile(path.join(game.gameDir, 'gamesfun.json'), 'utf8'));
      assert.equal(saved.token.symbol, 'BEAN');
      assert.equal(saved.token.source, 'launched');
      assert.equal(saved.token.decimals, 6);
      assert.equal(saved.creator, wallet.address);
      // The launch transaction was signed by both the fresh mint key and the wallet (the fake chain checks both).
      const m = chain.simulated.at(-1);
      assert.equal(m.header.numRequiredSignatures, 2);
      assert.ok(m.keys.includes(saved.token.mint));
      // The request was used up.
      const state = await (await import('./web3/helpers.mjs')).request(server.port, { path: '/api/web3/state?chain=0' });
      assert.equal(state.json.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it('with an initial buy, the minimum out comes from a dry run of the same atomic transaction', async () => {
    const game = await makeGame();
    const chain = fakeChain();
    const config = F.accounts.poolConfig;
    chain.put(config.address, config.owner, fromBase64(config.data));
    const wallet = testWallet();
    const { associatedTokenAddress } = await import('../web3/gf-web3/chain/pda.js');
    const quoteAta = associatedTokenAddress(wallet.address, '4ikj24Byduo7WZGhnxNYkqstpm9xUVeZH7eLQbjGDL7N');
    const balance = new Uint8Array(165);
    new DataView(balance.buffer).setBigUint64(64, 5_000_000_000n, true);
    chain.put(quoteAta, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', balance);
    const server = await serve({ gameDir: game.gameDir, kitRoot: game.kitRoot, fetchImpl: chain.fetchImpl, env: {}, log: () => {} });
    try {
      const started = await post(server.port, '/flow/start', { kind: 'launch', wallet: wallet.address, input: { name: 'Bean Brawl', symbol: 'BEAN', picture: 'assets/icon.png', initialBuy: '1000' } });
      assert.equal(started.status, 200, started.text);
      let view = started.json;
      for (let i = 0; i < 2; i++) {
        const p = (await post(server.port, '/flow/prepare', { flowId: view.id, wallet: wallet.address })).json;
        view = (await post(server.port, '/flow/complete', { flowId: view.id, prepareId: p.prepareId, signature: wallet.signMessage(p.text) })).json;
      }
      const p = (await post(server.port, '/flow/prepare', { flowId: view.id, wallet: wallet.address })).json;
      assert.match(p.details.join(' '), /Initial buy: 1000 MAIN-dev for about 47388825\.736462 \$BEAN \(at least 47151881\.607779\)/);
      const swap = readMessage(readTransaction(fromBase64(p.transactions[0])).message).instructions.at(-1).data;
      assert.equal(new DataView(swap.buffer, swap.byteOffset).getBigUint64(8, true), 1_000_000_000n);
      assert.equal(new DataView(swap.buffer, swap.byteOffset).getBigUint64(16, true), 47_151_881_607_779n);
      const tooBig = await post(server.port, '/flow/start', { kind: 'launch', wallet: wallet.address, input: { name: 'B', symbol: 'BB', picture: 'assets/icon.png', initialBuy: '60000' } });
      assert.match(tooBig.json.error, /graduation/);
    } finally {
      await server.close();
    }
  });
});
