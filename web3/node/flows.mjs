// The two things a creator approves in their wallet: launching the game's token, and putting the shop on sale
// (collection, loot game, items, boxes). Each is a flow for flow-engine.mjs: uploads to Arweave through Irys (one
// signMessage each, paid from the wallet's Irys balance; small files are free on Irys), then the transactions,
// which the wallet approves together in one prompt. What lands is written to gamesfun.json as it lands.
import { readUintLE, utf8 } from '../gf-web3/chain/bytes.js';
import { createCollectionInstruction } from '../gf-web3/chain/core.js';
import { createPoolInstruction, dbcPda, firstBuyInstructions, readVirtualPool } from '../gf-web3/chain/dbc.js';
import { createGameInstruction, lootPda, upsertBoxInstruction, upsertItemInstruction } from '../gf-web3/chain/loot.js';
import { parseMetaplexMetadata } from '../gf-web3/chain/mint.js';
import { associatedTokenAddress, metadataAddress } from '../gf-web3/chain/pda.js';
import { computeUnitLimit, createAssociatedTokenAccountIdempotent, transferLamports } from '../gf-web3/chain/programs.js';
import { compileMessage, MAX_TRANSACTION_BYTES, readMessage, readTransaction, signersOf, wireTransaction } from '../gf-web3/chain/tx.js';
import { explorerUrl } from '../gf-web3/network.js';
import { fromUnits, gamePath, LIMIT, onChainUri, RuleError, text, ticker, toUnits } from '../gf-web3/rules.js';
import {
  chainStatus,
  collectionMetadata,
  collectionMetaSource,
  hashJson,
  itemMetadata,
  itemMetaSource,
  itemOnChainArgs,
  mintInfo,
  poolConfig,
  tokenMetadata,
} from './chain.mjs';
import { defaultCurrency } from './drafts.mjs';
import { freshKeypair } from './ed25519.mjs';
import { readConfig, readPicture, updateConfig } from './game.mjs';
import { irysNode, itemId, messageToSign, signedItem, unsignedItem } from './irys.mjs';

/** Irys stores files up to this size for free; bigger ones are paid from the wallet's Irys balance. */
export const FREE_UPLOAD_BYTES = 100 * 1024;
/** Pay this much more than the quoted price, so rounding never leaves an upload short. */
const DEPOSIT_MARGIN_PERCENT = 25n;
const MIN_DEPOSIT_LAMPORTS = 1_000_000n;
const BALANCE_POLLS = 30;
const BALANCE_POLL_MS = 2000;
const FIRST_BUY_SLACK_BPS = 50n;
const LAUNCH_UNITS = 400_000;
const LAUNCH_WITH_BUY_UNITS = 600_000;
const TOKEN_AMOUNT_OFFSET = 64;

const fail = (message) => {
  throw new RuleError(message);
};
const sol = (lamports) => `${fromUnits(lamports, 9)} SOL`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Plain names for the programs a transaction touches, for the approval screen. */
function programNames(network, wallet) {
  return {
    [wallet]: 'your wallet',
    '11111111111111111111111111111111': 'System',
    ComputeBudget111111111111111111111111111111: 'Compute budget',
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
    TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token Account',
    CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d: 'Metaplex Core',
    metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: 'Metaplex Token Metadata',
    [network.loot.program]: 'games.fun loot program',
    [network.launchpad.dbcProgram]: 'Meteora Dynamic Bonding Curve',
  };
}

/** The programs the transactions call, by name, for the approval screen. */
function describe(network, wallet, wires) {
  const names = programNames(network, wallet);
  const programs = new Set();
  for (const wire of wires) {
    const m = readMessage(readTransaction(wire).message);
    for (const ix of m.instructions) programs.add(m.keys[ix.programIndex]);
  }
  return [`Programs: ${[...programs].map((p) => names[p] ?? p).join(', ')}`];
}

/** A legacy transaction from the wallet, signed by any fresh keys it creates. */
function buildWire({ payer, blockhash, instructions, signers = [] }) {
  const message = compileMessage({ payer, blockhash, instructions });
  const signatures = signersOf(message).map((address) => signers.find((s) => s.address === address)?.sign(message));
  const wire = wireTransaction(message, signatures);
  if (wire.length > MAX_TRANSACTION_BYTES) throw new Error(`The transaction is ${wire.length} bytes; the limit is ${MAX_TRANSACTION_BYTES}.`);
  return wire;
}

/** Send signed wires in order, each confirmed before the next; on failure, say which landed. */
async function sendInOrder(rpc, wires, lastValidBlockHeight) {
  const landed = [];
  for (const wire of wires) {
    try {
      const signature = await rpc.send(wire);
      await rpc.confirm(signature, { lastValidBlockHeight });
      landed.push(signature);
    } catch (error) {
      error.landed = landed;
      throw error;
    }
  }
  return landed;
}

// ---------------------------------------------------------------- steps

/**
 * An upload to Arweave through Irys. `build(flow)` returns { label, bytes, contentType }; `done(flow, upload)` records
 * { url, id, contentType, size }. A file over the free size first asks the wallet for an Irys deposit when its
 * balance is short (a SOL transfer the wallet approves), then for the upload's signature.
 */
function uploadStep(ctx, { title, build, done }) {
  const node = irysNode(ctx.network.irys, ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {});
  const state = { item: null, file: null, deposit: null, forceDeposit: false };
  return {
    title,
    async prepare(flow) {
      const file = await build(flow);
      state.file = file;
      const size = file.bytes.length;
      if (size > FREE_UPLOAD_BYTES || state.forceDeposit) {
        const price = await node.price(size + 2048);
        const balance = await node.balance(flow.wallet);
        if (balance < price) {
          let lamports = ((price - balance) * (100n + DEPOSIT_MARGIN_PERCENT)) / 100n;
          if (lamports < MIN_DEPOSIT_LAMPORTS) lamports = MIN_DEPOSIT_LAMPORTS;
          const to = await node.depositAddress();
          const { blockhash, lastValidBlockHeight } = await ctx.rpc.latestBlockhash();
          const wire = buildWire({ payer: flow.wallet, blockhash, instructions: [transferLamports(flow.wallet, to, lamports)] });
          await ctx.rpc.simulate(wire);
          state.deposit = { lamports, to, lastValidBlockHeight };
          return {
            kind: 'transactions',
            transactions: [wire],
            details: [`${file.label} is ${Math.ceil(size / 1024)} KB, over Irys’s free size. This adds ${sol(lamports)} to your Irys storage balance (node ${to}).`],
          };
        }
      }
      state.deposit = null;
      state.item = unsignedItem({ owner: flow.wallet, data: file.bytes, tags: [{ name: 'Content-Type', value: file.contentType }, { name: 'App-Name', value: 'games.fun' }] });
      return {
        kind: 'message',
        text: messageToSign(state.item),
        details: [`${file.label}: ${file.contentType}, ${Math.max(1, Math.ceil(size / 1024))} KB, stored on Arweave through Irys${size <= FREE_UPLOAD_BYTES ? ' (free at this size)' : ''}.`, 'Your wallet signs a receipt code for this file. It moves no funds.'],
      };
    },
    async complete(flow, answer) {
      if (answer.kind === 'transactions') {
        const [signature] = await sendInOrder(ctx.rpc, answer.transactions, state.deposit.lastValidBlockHeight);
        await node.registerDeposit(signature);
        for (let poll = 0; poll < BALANCE_POLLS; poll++) {
          if ((await node.balance(flow.wallet)) > 0n) break;
          await sleep(ctx.balancePollMs ?? BALANCE_POLL_MS);
        }
        state.forceDeposit = false;
        return { result: `Added ${sol(state.deposit.lamports)} to your Irys balance: ${explorerUrl(ctx.network, 'tx', signature)}`, again: true };
      }
      const bytes = signedItem(state.item, answer.signature);
      let id;
      try {
        id = await node.upload(bytes);
      } catch (error) {
        if (/\(402\)/.test(error.message)) {
          state.forceDeposit = true;
          return { result: 'Irys asked for payment for this file. Approve the deposit next.', again: true };
        }
        throw error;
      }
      if (id !== itemId(answer.signature)) throw new Error('Irys stored the file under an unexpected id.');
      const url = node.url(id);
      await done(flow, { url, id, contentType: state.file.contentType, size: state.file.bytes.length });
      return `Uploaded ${state.file.label}: ${url}`;
    },
  };
}

/**
 * The transactions of a flow, approved together. `build(flow, blockhash)` returns { wires, details, simulate: n }
 * (dry-run the first n), `landed(flow, signatures, partial)` records what landed and returns the result line.
 */
function transactionsStep(ctx, { title, build, landed }) {
  const state = { lastValidBlockHeight: null };
  return {
    title,
    async prepare(flow) {
      const { blockhash, lastValidBlockHeight } = await ctx.rpc.latestBlockhash();
      state.lastValidBlockHeight = lastValidBlockHeight;
      const built = await build(flow, blockhash);
      for (const wire of built.wires.slice(0, built.simulate ?? 1)) await ctx.rpc.simulate(wire);
      return { kind: 'transactions', transactions: built.wires, details: [...(built.details ?? []), ...describe(ctx.network, flow.wallet, built.wires)] };
    },
    async complete(flow, answer) {
      try {
        const signatures = await sendInOrder(ctx.rpc, answer.transactions, state.lastValidBlockHeight);
        return await landed(flow, signatures, false);
      } catch (error) {
        if (error.landed?.length) await landed(flow, error.landed, true);
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------- launch a token

/**
 * Launch the game's token on games.fun's curve: picture and details to Arweave, then one transaction that creates
 * the pool (and, optionally, the creator's first buy in MAIN-dev, in the same atomic transaction).
 * input: { name, symbol, picture, description?, initialBuy? (MAIN-dev, e.g. "1000") }
 */
export async function launchFlow(ctx, input, wallet) {
  const config = await readConfig(ctx.gameDir);
  if (config.token) fail(config.token.source === 'launched' ? `This game already launched $${config.token.symbol}.` : `This game uses $${config.token.symbol}. Stop using it before launching a new token.`);
  if (config.creator && config.creator !== wallet) fail(`This game belongs to the wallet ${config.creator}. Connect that wallet.`);
  const name = text(input.name, 'Token name', { maxBytes: LIMIT.TokenNameBytes });
  const symbol = ticker(input.symbol);
  const description = text(input.description, 'Description', { maxChars: LIMIT.DescriptionChars, required: false });
  const picturePath = gamePath(input.picture, 'Picture');
  const picture = await readPicture(ctx.gameDir, picturePath);
  const { launchpad } = ctx.network;
  const curve = await poolConfig(ctx.rpc, ctx.network);
  if (curve.quoteMint !== launchpad.quoteMint) fail('games.fun’s curve config does not match this network’s quote token.');
  const buyText = String(input.initialBuy ?? '').trim();
  const firstBuy = buyText && buyText !== '0' ? toUnits(buyText, launchpad.quoteDecimals) : null;
  if (firstBuy !== null) {
    if (firstBuy >= curve.migrationQuoteThreshold) fail(`An initial buy must stay below the curve’s graduation amount (${fromUnits(curve.migrationQuoteThreshold, launchpad.quoteDecimals)} ${launchpad.quoteSymbol}).`);
    const have = await ctx.rpc.tokenBalance(associatedTokenAddress(wallet, launchpad.quoteMint));
    if (have < firstBuy) fail(`Your wallet holds ${fromUnits(have, launchpad.quoteDecimals)} ${launchpad.quoteSymbol}; the initial buy needs ${buyText}.`);
  }
  const mint = freshKeypair();
  const pool = dbcPda.pool(launchpad.quoteMint, mint.address, launchpad.config);
  const links = { image: null, metadata: null };
  const steps = [
    uploadStep(ctx, {
      title: 'Upload the token picture',
      build: async () => ({ label: 'The token picture', bytes: picture.bytes, contentType: picture.contentType }),
      done: async (flow, upload) => {
        links.image = upload.url;
      },
    }),
    uploadStep(ctx, {
      title: 'Upload the token details',
      build: async () => ({ label: 'The token details', bytes: utf8(JSON.stringify(tokenMetadata({ name, symbol, description, image: links.image, contentType: picture.contentType }))), contentType: 'application/json' }),
      done: async (flow, upload) => {
        links.metadata = onChainUri(upload.url);
      },
    }),
    transactionsStep(ctx, {
      title: `Create $${symbol} on games.fun’s ${launchpad.quoteSymbol} curve${firstBuy ? ' and make your initial buy' : ''}`,
      build: async (flow, blockhash) => {
        const create = createPoolInstruction({ configAddress: launchpad.config, config: curve, baseMint: mint.address, creator: wallet, name, symbol, uri: links.metadata });
        const base = [computeUnitLimit(firstBuy ? LAUNCH_WITH_BUY_UNITS : LAUNCH_UNITS), create];
        let minimumAmountOut = 0n;
        let expected = null;
        if (firstBuy) {
          // The pool is created and bought in one atomic transaction, so nothing can trade in between: a dry run
          // gives the exact amount. The minimum keeps 0.5% slack for rounding only.
          const probe = firstBuyInstructions({ configAddress: launchpad.config, config: curve, baseMint: mint.address, buyer: wallet, amountIn: firstBuy, minimumAmountOut: 0n });
          const dry = buildWire({ payer: wallet, blockhash, instructions: [...base, ...probe.instructions], signers: [mint] });
          const run = await ctx.rpc.simulate(dry, { accounts: [probe.output] });
          const account = run.accounts[0];
          expected = account ? readUintLE(account.data, TOKEN_AMOUNT_OFFSET, 8) : 0n;
          if (!expected) fail('That initial buy is too small to receive any tokens.');
          minimumAmountOut = (expected * (10_000n - FIRST_BUY_SLACK_BPS)) / 10_000n;
        }
        const buy = firstBuy ? firstBuyInstructions({ configAddress: launchpad.config, config: curve, baseMint: mint.address, buyer: wallet, amountIn: firstBuy, minimumAmountOut }).instructions : [];
        const wire = buildWire({ payer: wallet, blockhash, instructions: [...base, ...buy], signers: [mint] });
        return {
          wires: [wire],
          details: [
            `Mint ${mint.address} (a fresh address; its one-time key signs here and is then forgotten). Pool ${pool}.`,
            firstBuy ? `Initial buy: ${buyText} ${launchpad.quoteSymbol} for about ${fromUnits(expected, curve.tokenDecimal)} $${symbol} (at least ${fromUnits(minimumAmountOut, curve.tokenDecimal)}).` : 'No initial buy.',
            'Your wallet becomes the token’s creator and pays the network fee and the new accounts’ rent (about 0.03 SOL).',
          ],
        };
      },
      landed: async (flow, signatures) => {
        const signature = signatures[0];
        // Trust the chain, not the page: the pool must exist with this mint, config and creator, and the token's
        // metadata must point at the uploaded details.
        const [poolAccount, metadataAccount] = await ctx.rpc.accounts([pool, metadataAddress(mint.address)]);
        const onChain = poolAccount ? readVirtualPool(poolAccount.data) : null;
        const checks = {
          poolExists: Boolean(onChain),
          baseMint: onChain?.baseMint === mint.address,
          config: onChain?.config === launchpad.config,
          creator: onChain?.creator === wallet,
          metadata: curve.tokenType !== 0 || (metadataAccount ? parseMetaplexMetadata(metadataAccount.data).uri === links.metadata : false),
        };
        mint.drop();
        const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
        if (failed.length) throw new Error(`The launch transaction ${signature} landed, but the chain does not show the token as expected (${failed.join(', ')}).`);
        await updateConfig(ctx.gameDir, (c) => {
          c.creator = wallet;
          c.token = {
            mint: mint.address,
            name,
            symbol,
            decimals: curve.tokenDecimal,
            program: curve.tokenType === 0 ? 'spl-token' : 'token-2022',
            source: 'launched',
            image: links.image,
            metadataUri: links.metadata,
            pool,
            config: launchpad.config,
            quoteMint: launchpad.quoteMint,
            signature,
          };
          return c;
        });
        return `$${symbol} is live: ${explorerUrl(ctx.network, 'tx', signature)}`;
      },
    }),
  ];
  return {
    kind: 'launch',
    title: `Launch $${symbol} for this game`,
    lines: [`${name}${description ? `: ${description}` : ''}`, `Picture: ${picture.path}. Network: devnet.`, firstBuy ? `Initial buy: ${buyText} ${launchpad.quoteSymbol}.` : 'No initial buy.'],
    wallet,
    steps,
    context: { mint: mint.address, pool },
    onFinish: async () => ({ token: (await readConfig(ctx.gameDir)).token }),
  };
}

// ---------------------------------------------------------------- put the shop on sale

/** Pack instructions into as few transactions as fit, keeping each group's ids (what landed with which). */
function pack(payer, blockhash, entries, maxTransactions) {
  const groups = [];
  let current = { instructions: [], ids: [] };
  const size = (list) => {
    try {
      return wireTransaction(compileMessage({ payer, blockhash, instructions: list })).length;
    } catch {
      return Infinity;
    }
  };
  for (const entry of entries) {
    if (current.instructions.length && size([...current.instructions, entry.instruction]) > MAX_TRANSACTION_BYTES) {
      groups.push(current);
      current = { instructions: [], ids: [] };
    }
    current.instructions.push(entry.instruction);
    current.ids.push(entry.id);
  }
  if (current.instructions.length) groups.push(current);
  return { kept: groups.slice(0, maxTransactions), partial: groups.length > maxTransactions };
}

/**
 * Everything the shop still needs, in one wallet approval for the transactions: the collection and loot game the
 * first time (priced in the shop's currency, fixed from then on), every new or changed item that has a picture, and
 * every box whose items are on sale or going on sale now. Uploads come first (one signature each).
 */
export async function publishFlow(ctx, wallet) {
  const config = await readConfig(ctx.gameDir);
  const shop = config.shop;
  if (!shop?.items.length) fail('Add an item before opening the shop.');
  if (config.creator && config.creator !== wallet) fail(`This game belongs to the wallet ${config.creator}. Connect that wallet.`);
  const status = await chainStatus(ctx.rpc, ctx.network, config, { pictureHash: async (p) => readPicture(ctx.gameDir, p).then((x) => x.sha256).catch(() => null) });
  const live = status.shop.exists;
  if (live && status.shop.game.authority !== wallet) fail(`This shop’s loot game belongs to ${status.shop.game.authority}. Connect that wallet.`);
  const currency = live ? shop.currency : shop.currency ?? defaultCurrency(config);
  if (!live && !currency.native) {
    const info = await mintInfo(ctx.rpc, currency.mint);
    if (!info.lootReady) fail('Shops take classic SPL tokens and SOL; the chosen currency is Token-2022.');
  }
  const pictures = new Map();
  for (const item of shop.items) if (item.picture) pictures.set(item.id, await readPicture(ctx.gameDir, item.picture).catch(() => null));
  const publishing = shop.items.filter((item) => status.shop.items[item.id].state !== 'published' && (item.image || pictures.get(item.id)));
  const ids = new Set(publishing.map((i) => i.id));
  const onSale = (id) => ids.has(id) || (shop.items.find((i) => i.id === id)?.listed && status.shop.items[id]?.state === 'published');
  const boxes = shop.boxes.filter((b) => status.shop.boxes[b.id].state !== 'published' && b.entries.every((e) => onSale(e.item)));
  const skipped = shop.items.filter((i) => status.shop.items[i.id].state !== 'published' && !i.image && !pictures.get(i.id));
  if (live && !publishing.length && !boxes.length) fail(skipped.length ? 'The items waiting need a picture first.' : 'Everything is already on sale.');
  if (!live && !publishing.length) fail('Give an item a picture before opening the shop.');

  // Uploads: item pictures, then (for a new shop) the collection's details, then item details.
  const steps = [];
  for (const item of publishing) {
    const picture = pictures.get(item.id);
    if (picture && (!item.image || item.imageHash !== picture.sha256)) {
      steps.push(
        uploadStep(ctx, {
          title: `Upload the picture of ${item.name}`,
          build: async () => ({ label: `The picture of ${item.name}`, bytes: picture.bytes, contentType: picture.contentType }),
          done: async (flow, upload) =>
            updateConfig(ctx.gameDir, (c) => {
              const it = c.shop.items.find((i) => i.id === item.id);
              Object.assign(it, { image: upload.url, imageHash: picture.sha256 });
              return c;
            }),
        }),
      );
    }
  }
  const collection = live ? null : freshKeypair();
  if (!live) {
    steps.push(
      uploadStep(ctx, {
        title: 'Upload the collection’s details',
        build: async () => {
          const c = await readConfig(ctx.gameDir);
          const image = c.shop.image ?? c.token?.image ?? c.shop.items.find((i) => i.image)?.image;
          if (!image) fail('The collection needs a picture: give an item a picture first.');
          const type = c.shop.image || c.token?.image ? 'image/png' : pictures.get(c.shop.items.find((i) => i.image)?.id)?.contentType ?? 'image/png';
          return { label: 'The collection details', bytes: utf8(JSON.stringify(collectionMetadata(c.shop, image, type))), contentType: 'application/json', image };
        },
        done: async (flow, upload) =>
          updateConfig(ctx.gameDir, (c) => {
            const image = c.shop.image ?? c.token?.image ?? c.shop.items.find((i) => i.image)?.image;
            Object.assign(c.shop, { image, metadataUri: onChainUri(upload.url), metaHash: hashJson(collectionMetaSource(c.shop, image)) });
            return c;
          }),
      }),
    );
  }
  // Items whose details are already uploaded and current (a price or supply change) skip straight to the transaction.
  const upToDate = (it, c) => it.uri && it.image && it.metaHash === hashJson(itemMetaSource(c.shop, it));
  for (const item of publishing) {
    const picture = pictures.get(item.id);
    const newPicture = picture && (!item.image || item.imageHash !== picture.sha256);
    if (!newPicture && upToDate(item, config)) continue;
    steps.push(
      uploadStep(ctx, {
        title: `Upload the details of ${item.name}`,
        build: async () => {
          const c = await readConfig(ctx.gameDir);
          const it = c.shop.items.find((i) => i.id === item.id);
          const type = pictures.get(item.id)?.contentType ?? 'image/png';
          return { label: `The details of ${item.name}`, bytes: utf8(JSON.stringify(itemMetadata(c.shop, it, it.image, type))), contentType: 'application/json' };
        },
        done: async (flow, upload) =>
          updateConfig(ctx.gameDir, (c) => {
            const it = c.shop.items.find((i) => i.id === item.id);
            Object.assign(it, { uri: onChainUri(upload.url), metaHash: hashJson(itemMetaSource(c.shop, it)) });
            return c;
          }),
      }),
    );
  }
  const unit = (units) => `${fromUnits(units, currency.decimals)} ${currency.symbol}`;
  const treasury = associatedTokenAddress(wallet, currency.mint);
  let plan = null;
  steps.push(
    transactionsStep(ctx, {
      title: live ? 'Put the changes on sale' : `Open the shop, priced in ${currency.symbol}`,
      build: async (flow, blockhash) => {
        const c = await readConfig(ctx.gameDir);
        const s = c.shop;
        const game = live ? lootPda.game(s.collection) : lootPda.game(collection.address);
        const entries = [];
        const setup = [];
        if (!live) {
          setup.push(
            createCollectionInstruction({ collection: collection.address, creator: wallet, name: s.name, uri: s.metadataUri, royaltyBps: s.royaltyBps }),
            createAssociatedTokenAccountIdempotent(wallet, wallet, currency.mint),
            createGameInstruction({ authority: wallet, collection: collection.address, mint: currency.mint, treasury, burnBps: 0 }),
          );
        }
        for (const item of publishing) {
          const it = s.items.find((i) => i.id === item.id);
          if (!upToDate(it, c)) fail(`${it.name}’s details were not uploaded. Press Approve again.`);
          entries.push({ id: `item:${it.id}`, instruction: upsertItemInstruction({ admin: wallet, game, itemId: it.id, ...itemOnChainArgs(it) }) });
        }
        for (const box of boxes) {
          const b = s.boxes.find((x) => x.id === box.id);
          entries.push({ id: `box:${b.id}`, instruction: upsertBoxInstruction({ admin: wallet, game, boxId: b.id, price: BigInt(b.price), entries: b.entries.map((e) => ({ itemId: e.item, weight: e.weight })) }) });
        }
        const groups = [];
        if (setup.length) {
          const size = wireTransaction(compileMessage({ payer: wallet, blockhash, instructions: setup })).length;
          if (size <= MAX_TRANSACTION_BYTES) groups.push({ instructions: setup, ids: ['setup'], signers: [collection] });
          else {
            groups.push({ instructions: [setup[0]], ids: ['collection'], signers: [collection] });
            groups.push({ instructions: setup.slice(1), ids: ['game'], signers: [] });
          }
        }
        const packed = pack(wallet, blockhash, entries, LIMIT.PublishTransactions - groups.length);
        groups.push(...packed.kept.map((g) => ({ ...g, signers: [] })));
        plan = { groups, partial: packed.partial, game };
        const wires = groups.map((g) => buildWire({ payer: wallet, blockhash, instructions: g.instructions, signers: g.signers }));
        const itemCount = groups.flatMap((g) => g.ids).filter((id) => id.startsWith('item:')).length;
        const boxCount = groups.flatMap((g) => g.ids).filter((id) => id.startsWith('box:')).length;
        return {
          wires,
          // Later transactions depend on the first landing (the loot game must exist), so only a live shop's are all dry-run.
          simulate: live ? wires.length : 1,
          details: [
            ...(live ? [] : [`Collection ${collection.address} (Metaplex Core): your wallet is its update authority; ${s.royaltyBps / 100}% resale royalty to you. The loot program may mint into it.`, `Priced in ${currency.symbol}, fixed from now on. Sales go to your account ${treasury}; games.fun’s loot program keeps ${ctx.network.loot.platformFeeBps / 100}%.`]),
            ...publishing.map((i) => `${i.name} (${i.rarity}): ${i.price === '0' ? 'loot boxes only' : unit(i.price)}`),
            ...boxes.map((b) => `Loot box ${b.name}: ${unit(b.price)}`),
            ...(packed.partial ? ['That is more than one approval holds; press “Put it on sale” again afterwards for the rest.'] : []),
            `${wires.length} transaction${wires.length === 1 ? '' : 's'}, one approval. ${itemCount} item${itemCount === 1 ? '' : 's'}, ${boxCount} loot box${boxCount === 1 ? '' : 'es'}.`,
          ],
        };
      },
      landed: async (flow, signatures, partial) => {
        const landedIds = new Set(plan.groups.slice(0, signatures.length).flatMap((g) => g.ids));
        await updateConfig(ctx.gameDir, (c) => {
          if (landedIds.has('setup') || landedIds.has('collection')) {
            c.creator = wallet;
            Object.assign(c.shop, { collection: collection.address, currency });
          }
          if (landedIds.has('setup') || landedIds.has('game')) Object.assign(c.shop, { game: plan.game, treasury, currency });
          for (const it of c.shop.items) if (landedIds.has(`item:${it.id}`)) it.listed = true;
          for (const b of c.shop.boxes) if (landedIds.has(`box:${b.id}`)) b.listed = true;
          return c;
        });
        collection?.drop();
        const links = signatures.map((s) => explorerUrl(ctx.network, 'tx', s));
        if (partial) return `Part of it landed (${signatures.length} of ${plan.groups.length} transactions): ${links.join(' ')}`;
        return `${live ? 'Your changes are on sale' : 'Your shop is open'}${plan.partial ? ' (press again for the rest)' : ''}: ${links.join(' ')}`;
      },
    }),
  );
  return {
    kind: 'publish',
    title: live ? 'Put the changes on sale' : `Open the shop for ${shop.name}`,
    lines: [
      `Players pay in ${currency.symbol}.`,
      `${publishing.length} item${publishing.length === 1 ? '' : 's'} and ${boxes.length} loot box${boxes.length === 1 ? '' : 'es'}.`,
      ...(skipped.length ? [`${skipped.map((i) => i.name).join(', ')} still need${skipped.length === 1 ? 's' : ''} a picture and will wait.`] : []),
      `${steps.length - 1} upload${steps.length === 2 ? '' : 's'} (a signature each), then one approval for the transactions.`,
    ],
    wallet,
    steps,
    onFinish: async () => {
      const c = await readConfig(ctx.gameDir);
      return { collection: c.shop?.collection ?? null, game: c.shop?.game ?? null, explorer: c.shop?.collection ? explorerUrl(ctx.network, 'address', c.shop.collection) : null };
    },
  };
}

