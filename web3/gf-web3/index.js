// gf-web3: the games.fun in-game kit. Optional wallet sign-in, the player's items from this game's collection,
// the shop, loot boxes and the game's token, all from the game's public gamesfun.json. Guests play without a
// wallet; nothing asks for one until the player presses something that needs it. Owned items' looks become a
// gf-three loadout (CONTRACT §6e), so everyone in a multiplayer match sees what each player wears.
//
//   import gfWeb3 from './gf/web3/index.js';
//   await gfWeb3.ready();                        // reads ./gamesfun.json
//   const items = await gfWeb3.shop.list();      // what is on sale, priced in the shop's currency
//   await gfWeb3.shop.buy(items[0].id);          // two wallet approvals: pay, then claim (the collectible is minted)
//   await gfWeb3.wearOwned();                    // the owned items' looks → window.__GF_LOADOUT
//
// Mock mode (no network, a pretend wallet, deterministic rolls) runs when the page is automated or headless
// (navigator.webdriver, HeadlessChrome: gf-three verify stays deterministic) or with ?gamesfun_mock=1.
// ?gamesfun_mock=0 forces the real chain. ?gamesfun_owned=1,2 gives the mock wallet items to start with.
//
// Reads go to the public devnet RPC, which rate-limits (about 100 requests per 10 s per IP) and has no DAS API, so
// ownedItems() asks getProgramAccounts for this collection's Core assets owned by the player (filtered on the node,
// about one call per refresh). Call it on connect and after a purchase, not every frame. A game may pass its own
// public, keyless RPC with configure({ rpc }); never put a keyed RPC URL in a game: everything in it is public.
import { encodeBase58, isAddress } from './chain/base58.js';
import { utf8 } from './chain/bytes.js';
import { ownedAssetFilters, parseCoreAsset, MPL_CORE_PROGRAM } from './chain/core.js';
import {
  ata,
  buyItemIxs,
  currentFees,
  decodeLoot,
  ESCROW_LAMPORTS,
  LOOT_PROGRAM,
  LootAccount,
  lootPda,
  openBoxIxs,
  OrderStatus,
  priceAt,
  refundable,
  refundOrderIx,
  settleOrderIxs,
} from './chain/loot.js';
import { NATIVE_MINT } from './chain/pda.js';
import { transferExtras } from './chain/token2022.js';
import { closeTokenAccount, withSolWrap } from './chain/programs.js';
import { sha256 } from './chain/sha256.js';
import { compileMessage, wireTransaction, transactionId } from './chain/tx.js';
import { CONFIG_FILE, emptyConfig, findBox, findItem, parseConfig } from './config.js';
import { loadoutOf } from './looks.js';
import { networkConfig } from './network.js';
import { rpcClient } from './rpc.js';
import { fromUnits, odds, secretLike } from './rules.js';
import * as walletKit from './wallet.js';

import { VERSION } from './version.js';

export { VERSION };
const ROLL_POLL_MS = 1000;
const ROLL_POLLS = 90;

const MESSAGE = {
  NoWallet: 'No Solana wallet found in this browser. Install one (Phantom, Solflare, Backpack…) and reload.',
  Cancelled: 'No wallet chosen.',
  NoShop: 'This game has no shop yet.',
  NotLive: 'This game’s shop is not on sale yet.',
  NoItem: (sku) => `There is no item ${sku} in this shop.`,
  NotForSale: (name) => `${name} is not sold directly; it comes from loot boxes.`,
  NoBox: (id) => `There is no loot box ${id} in this shop.`,
  Short: (need) => `You need ${need} for this.`,
  NoOrder: 'That order is gone: it was settled or refunded.',
  NotYet: (slot) => `This order can be refunded from slot ${slot} on.`,
  RollFailed: 'The roll failed (everything in the box is sold out). Your payment was refunded.',
  RollSlow: 'The box was opened but the roll has not arrived yet. Check your items again in a minute.',
};

/** Deterministic randomness for the mock (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A kit instance. In a game page, use the default export. Options (tests and special hosts):
 * { config, configUrl, fetchImpl, location, navigator, wallets (array of Wallet Standard wallets), mock, rpc, storage, win }
 */
export function createGfWeb3(options = {}) {
  const win = options.win ?? (typeof window === 'undefined' ? null : window);
  const loc = options.location ?? win?.location ?? null;
  const nav = options.navigator ?? (typeof navigator === 'undefined' ? null : navigator);
  const query = new URLSearchParams(loc?.search ?? '');
  const forced = query.get('gamesfun_mock');
  const automated = Boolean(nav?.webdriver) || /HeadlessChrome/.test(nav?.userAgent ?? '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const network = networkConfig('devnet');
  const state = {
    mock: options.mock ?? (forced === '1' ? true : forced === '0' ? false : automated || win?.__GF_WEB3_MOCK === true),
    config: options.config ? parseConfig(JSON.stringify(options.config)) : null,
    loading: null,
    rpcUrl: options.rpc ?? null,
    wallet: null,
    account: null,
    mockAddress: null,
    mockOwned: [],
    mockOpened: 0,
    worn: null,
    listeners: new Map(),
  };
  const storage = options.storage ?? (() => {
    try {
      return win?.localStorage ?? null;
    } catch {
      return null;
    }
  })();

  const emit = (event, detail) => {
    for (const fn of state.listeners.get(event) ?? []) {
      try {
        fn(detail);
      } catch (error) {
        console.error(error);
      }
    }
  };
  const status = (text) => emit('status', text);
  const rpc = () => rpcClient(state.rpcUrl ?? network.rpcUrl, fetchImpl ? { fetchImpl } : {});
  const mockAddress = encodeBase58(sha256(utf8('gamesfun mock player')));

  async function loadConfig() {
    if (state.config) return state.config;
    try {
      const url = options.configUrl ?? new URL(CONFIG_FILE, loc?.href ?? 'http://localhost/').toString();
      const response = await fetchImpl(url, { cache: 'no-store' });
      return response.ok ? parseConfig(await response.text()) : emptyConfig();
    } catch (error) {
      if (/network this kit does not support|unknown version|not valid JSON/.test(error.message)) console.warn(`gf-web3: ${error.message}`);
      return emptyConfig();
    }
  }

  const ownedOf = (item, asset, serial) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    rarity: item.rarity,
    look: item.look ?? null,
    image: item.image ?? null,
    serial,
    asset,
  });

  /** Read gamesfun.json (once) and get ready. Call it before anything else; it never throws. */
  async function ready() {
    state.loading ??= loadConfig().then((config) => {
      state.config = config;
      if (state.mock) {
        const wanted = (query.get('gamesfun_owned') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        state.mockOwned = wanted.map((sku) => findItem(config, sku)).filter(Boolean).map((item, i) => ownedOf(item, `mock-asset-${i + 1}`, i + 1));
      } else {
        walletKit.listenForWallets();
        for (const w of options.wallets ?? []) walletKit.registerWallet(w);
      }
      return config;
    });
    return state.loading;
  }

  const address = () => (state.mock ? state.mockAddress : (state.account?.address ?? null));

  /** Ask the player to connect a wallet (only when they press something that needs it). Returns their address. */
  async function connect() {
    await ready();
    if (state.mock) {
      state.mockAddress = mockAddress;
      emit('wallet', mockAddress);
      return mockAddress;
    }
    if (address()) return address();
    const list = await walletKit.waitForWallets();
    if (!list.length) throw new Error(MESSAGE.NoWallet);
    const wallet = await walletKit.pickWallet(list);
    if (!wallet) throw new Error(MESSAGE.Cancelled);
    state.account = await walletKit.connectWallet(wallet);
    state.wallet = wallet;
    walletKit.onAccountChange(wallet, (account) => {
      state.account = account;
      if (!account) state.wallet = null;
      emit('wallet', account?.address ?? null);
    });
    emit('wallet', state.account.address);
    return state.account.address;
  }

  async function disconnect() {
    const wallet = state.wallet;
    state.wallet = null;
    state.account = null;
    state.mockAddress = null;
    emit('wallet', null);
    await walletKit.disconnectWallet(wallet);
  }

  /** Optional sign-in: the wallet signs a one-time message (Sign In With Solana style). A client-side proof for now. */
  async function signIn({ statement } = {}) {
    const player = await connect();
    const config = await ready();
    const host = loc?.host ?? 'game';
    const message = [
      `${host} wants you to sign in with your Solana account:`,
      player,
      '',
      statement ?? `Sign in to ${config.shop?.name ?? 'this game'} on games.fun. This costs nothing and moves no funds.`,
      '',
      `URI: ${loc?.origin ?? ''}`,
      `Chain ID: ${network.chain}`,
      `Nonce: ${encodeBase58(globalThis.crypto.getRandomValues(new Uint8Array(12)))}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join('\n');
    if (state.mock) return { address: player, message, signature: 'mock', mock: true };
    const signature = await walletKit.signText(state.wallet, state.account, message);
    return { address: player, message, signature: encodeBase58(signature), mock: false };
  }

  /** Compile, have the wallet sign, send and confirm one transaction. */
  async function signAndSend(player, instructions) {
    const client = rpc();
    const { blockhash, lastValidBlockHeight } = await client.latestBlockhash();
    const wire = wireTransaction(compileMessage({ payer: player, blockhash, instructions }));
    await client.simulate(wire);
    const [signed] = await walletKit.signTransactions(state.wallet, state.account, network.chain, [wire]);
    if (!signed) throw new Error('The wallet returned nothing to send.');
    const signature = await client.send(signed);
    await client.confirm(signature, { lastValidBlockHeight });
    return signature;
  }

  function liveShop(config) {
    const shop = config.shop;
    if (!shop) throw new Error(MESSAGE.NoShop);
    if (!shop.game || !shop.collection || !shop.currency) throw new Error(MESSAGE.NotLive);
    return shop;
  }

  const priceText = (shop, units) => `${fromUnits(units, shop.currency?.decimals ?? 9)} ${shop.currency?.symbol ?? ''}`.trim();

  /** What the shop sells: listed items, priced in the shop's currency. */
  async function listShop() {
    const config = await ready();
    const shop = config.shop;
    if (!shop) return [];
    return shop.items
      .filter((item) => item.listed || state.mock)
      .map((item) => ({
        id: item.id,
        sku: item.id,
        name: item.name,
        description: item.description,
        rarity: item.rarity,
        look: item.look ?? null,
        image: item.image ?? null,
        price: item.price,
        priceText: item.price === '0' ? 'Loot boxes only' : priceText(shop, item.price),
        currency: shop.currency?.symbol ?? null,
        forSale: item.price !== '0',
      }));
  }

  /** The game's loot boxes with their published odds. */
  async function boxes() {
    const config = await ready();
    const shop = config.shop;
    if (!shop) return [];
    return shop.boxes
      .filter((b) => b.listed || state.mock)
      .map((box) => ({
        id: box.id,
        name: box.name,
        price: box.price,
        priceText: priceText(shop, box.price),
        odds: odds(box.entries).map((e) => ({ id: e.item, item: findItem(config, e.item)?.name ?? `Item ${e.item}`, chance: e.chance })),
      }));
  }

  /** The on-chain Game and Platform, and any item or box accounts a purchase needs. */
  async function readShop(shop, extra = []) {
    const [game, platform, ...rest] = await rpc().accounts([shop.game, lootPda.platform(), ...extra]);
    if (!game || !platform) throw new Error(MESSAGE.NotLive);
    return { game: decodeLoot(LootAccount.Game, game.data), platform: decodeLoot(LootAccount.Platform, platform.data), rest };
  }

  /** The token program that owns a mint (classic SPL or Token-2022). */
  async function tokenProgramOf(mint) {
    const [account] = await rpc().accounts([mint]);
    if (!account) throw new Error(MESSAGE.NotLive);
    return account.owner;
  }

  /** The player holds the price, and the SOL an order holds until it ends (returned) plus the player fee. */
  async function checkFunds(player, mint, price, platform, shop, tokenProgram) {
    const client = rpc();
    const sol = await client.balance(player);
    const lamports = ESCROW_LAMPORTS + BigInt(currentFees(platform).player);
    if (mint === NATIVE_MINT) {
      if (sol < BigInt(price) + lamports) throw new Error(MESSAGE.Short(`${priceText(shop, BigInt(price) + lamports)} (the price, ${fromUnits(lamports, 9)} SOL held until it is delivered, and the fee)`));
      return;
    }
    if ((await client.tokenBalance(ata(player, mint, tokenProgram))) < BigInt(price)) throw new Error(MESSAGE.Short(priceText(shop, price)));
    if (sol < lamports) throw new Error(MESSAGE.Short(`${fromUnits(lamports, 9)} SOL (held until it is delivered, and the fee)`));
  }

  /** An order as the chain has it now, or null once it ended. */
  async function readOrder(order) {
    const [account] = await rpc().accounts([order]);
    return account ? decodeLoot(LootAccount.Order, account.data) : null;
  }

  /** Wait until an order is no longer Pending (the oracle rolled it), or give up. */
  async function waitForRoll(order) {
    let o = null;
    for (let poll = 0; poll < ROLL_POLLS; poll++) {
      o = await readOrder(order);
      if (!o || o.status !== OrderStatus.Pending) return o;
      await new Promise((resolve) => setTimeout(resolve, options.rollPollMs ?? ROLL_POLL_MS));
    }
    return o;
  }

  /** The player signs the end of a rolled order: the collectible is minted to them, the payment goes to the game. */
  async function settleOrder(player, order, o, game) {
    const tokenProgram = await tokenProgramOf(o.mint);
    const extras = await transferExtras(rpc(), o.mint, [{ source: ata(o.game, o.mint, tokenProgram), destination: game.treasury, authority: o.game, amount: o.paid }]);
    return signAndSend(player, settleOrderIxs({ signer: player, order, orderAccount: o, gameAccount: game, tokenProgram, extras }));
  }

  /** The player signs a refund of their order; a SOL shop's refund is unwrapped back to plain SOL. */
  async function refundOrder(player, order, o) {
    const tokenProgram = await tokenProgramOf(o.mint);
    const extras = await transferExtras(rpc(), o.mint, [{ source: ata(o.game, o.mint, tokenProgram), destination: ata(o.player, o.mint, tokenProgram), authority: o.game, amount: o.paid }]);
    const instructions = [refundOrderIx({ signer: player, order, orderAccount: o, tokenProgram, extras })];
    if (o.mint === NATIVE_MINT) instructions.push(closeTokenAccount(ata(player, NATIVE_MINT), player, player));
    return signAndSend(player, instructions);
  }

  const wonItem = (config, o, order) => {
    const id = o.outcome?.Item?.[0];
    const item = id === undefined ? null : findItem(config, id);
    const asset = id === undefined ? null : lootPda.asset(order, o.requested_slot);
    return item ? ownedOf(item, asset, o.serial) : { id: id ?? null, name: id === undefined ? 'Nothing' : `Item ${id}`, rarity: 'Common', look: null, image: null, serial: o.serial, asset };
  };

  /**
   * Buy an item (by id or name). Two wallet approvals: the purchase, then the claim that mints the collectible (its
   * address depends on the slot the purchase lands in, so it cannot ride in the same transaction).
   */
  async function buy(sku, { onStatus } = {}) {
    const say = (text) => (status(text), onStatus?.(text));
    const config = await ready();
    const item = findItem(config, sku);
    if (!item) throw new Error(MESSAGE.NoItem(sku));
    if (item.price === '0') throw new Error(MESSAGE.NotForSale(item.name));
    if (!state.mock) liveShop(config);
    const player = await connect();
    if (state.mock) {
      const bought = ownedOf(item, `mock-asset-${state.mockOwned.length + 1}`, state.mockOwned.length + 1);
      state.mockOwned.push(bought);
      emit('items', bought);
      return { item: bought, signatures: [], mock: true };
    }
    const shop = liveShop(config);
    say('Getting the shop ready…');
    const { game, platform, rest } = await readShop(shop, [lootPda.item(shop.game, item.id)]);
    const onChain = rest[0] ? decodeLoot(LootAccount.Item, rest[0].data) : null;
    const price = onChain ? priceAt(onChain) : 0n;
    if (!onChain?.active || price === 0n) throw new Error(MESSAGE.NotForSale(item.name));
    const tokenProgram = await tokenProgramOf(game.mint);
    await checkFunds(player, game.mint, price, platform, shop, tokenProgram);
    const extras = await transferExtras(rpc(), game.mint, [{ source: ata(player, game.mint, tokenProgram), destination: ata(shop.game, game.mint, tokenProgram), authority: player, amount: price }]);
    const sale = buyItemIxs({ player, game: shop.game, mint: game.mint, itemId: item.id, maxPrice: price, tokenProgram, extras });
    say('Approve the purchase in your wallet…');
    const paid = await signAndSend(player, withSolWrap(player, game.mint, price, sale.instructions));
    const o = await readOrder(sale.order);
    if (!o) throw new Error(MESSAGE.NoOrder);
    say('Approve claiming it in your wallet…');
    const claimed = await settleOrder(player, sale.order, o, game);
    const bought = wonItem(config, o, sale.order);
    emit('items', bought);
    say('');
    return { item: bought, asset: bought.asset, order: sale.order, signatures: [paid, claimed], mock: false };
  }

  /** Open a loot box: pay and roll (one approval), wait for MagicBlock's VRF, then claim what it rolled (a second approval). */
  async function openBox(id, { onStatus } = {}) {
    const say = (text) => (status(text), onStatus?.(text));
    const config = await ready();
    const box = findBox(config, id);
    if (!box) throw new Error(MESSAGE.NoBox(id));
    if (!state.mock) liveShop(config);
    const player = await connect();
    if (state.mock) {
      const roll = seeded(box.id * 7919 + ++state.mockOpened)();
      const total = box.entries.reduce((n, e) => n + e.weight, 0);
      let pick = roll * total;
      const entry = box.entries.find((e) => (pick -= e.weight) < 0) ?? box.entries.at(-1);
      const item = findItem(config, entry.item);
      const won = ownedOf(item, `mock-asset-${state.mockOwned.length + 1}`, state.mockOwned.length + 1);
      state.mockOwned.push(won);
      emit('items', won);
      return { item: won, signatures: [], mock: true };
    }
    const shop = liveShop(config);
    say('Getting the box ready…');
    const { game, platform, rest } = await readShop(shop, [lootPda.box(shop.game, box.id)]);
    const onChain = rest[0] ? decodeLoot(LootAccount.Box, rest[0].data) : null;
    if (!onChain?.active) throw new Error(MESSAGE.NoBox(id));
    const mint = onChain.currency ?? game.mint;
    const price = priceAt(onChain);
    const tokenProgram = await tokenProgramOf(mint);
    await checkFunds(player, mint, price, platform, shop, tokenProgram);
    const extras = await transferExtras(rpc(), mint, [{ source: ata(player, mint, tokenProgram), destination: ata(shop.game, mint, tokenProgram), authority: player, amount: price }]);
    const open = openBoxIxs({ player, game: shop.game, mint, boxId: box.id, box: onChain, maxPrice: price, tokenProgram, extras });
    say('Approve opening the box in your wallet…');
    const opened = await signAndSend(player, withSolWrap(player, mint, price, open.instructions));
    say('Rolling…');
    const o = await waitForRoll(open.order);
    if (!o) throw new Error(MESSAGE.NoOrder);
    if (o.status === OrderStatus.Pending) throw new Error(MESSAGE.RollSlow);
    if (o.status === OrderStatus.Failed) {
      say('Nothing left to win: approve the refund in your wallet…');
      await refundOrder(player, open.order, o);
      throw new Error(MESSAGE.RollFailed);
    }
    say(o.outcome?.Item ? 'You won something! Approve claiming it in your wallet…' : 'Approve finishing the box in your wallet…');
    const claimed = await settleOrder(player, open.order, o, game);
    const won = wonItem(config, o, open.order);
    if (won.asset) emit('items', won);
    say('');
    return { item: won, asset: won.asset, order: open.order, signatures: [opened, claimed], mock: false };
  }

  /** The connected player's orders in this game that have not ended yet (a claim they did not approve, a slow roll). */
  async function orders() {
    const config = await ready();
    const player = address();
    if (state.mock || !player || !config.shop?.game) return [];
    const filters = [
      { memcmp: { offset: 0, bytes: encodeBase58(Uint8Array.of(5)) } },
      { memcmp: { offset: 1, bytes: config.shop.game } },
      { memcmp: { offset: 33, bytes: player } },
    ];
    const found = await rpc().programAccounts(LOOT_PROGRAM, filters);
    return found.map(({ pubkey, account }) => ({ order: pubkey, ...decodeLoot(LootAccount.Order, account.data) }));
  }

  /** Finish an order: claim it when it was rolled, refund it when it failed or waited too long. */
  async function finish(order) {
    const config = await ready();
    const shop = liveShop(config);
    const player = await connect();
    const o = await readOrder(order);
    if (!o) throw new Error(MESSAGE.NoOrder);
    const { game } = await readShop(shop);
    if (o.status === OrderStatus.Rolled) {
      const signature = await settleOrder(player, order, o, game);
      const won = wonItem(config, o, order);
      if (won.asset) emit('items', won);
      return { settled: true, item: won, signatures: [signature] };
    }
    const when = refundable(o, await rpc().call('getSlot', [{ commitment: 'confirmed' }]));
    if (!when.ok) throw new Error(MESSAGE.NotYet(when.atSlot));
    return { refunded: true, signatures: [await refundOrder(player, order, o)] };
  }

  /** The connected player's items from this game's collection (none for a guest). */
  async function ownedItems() {
    const config = await ready();
    const player = address();
    if (!player || !config.shop) return [];
    if (state.mock) return [...state.mockOwned];
    if (!config.shop.collection) return [];
    const assets = await rpc().programAccounts(MPL_CORE_PROGRAM, ownedAssetFilters(player, config.shop.collection));
    return assets.flatMap(({ pubkey, account }) => {
      try {
        const asset = parseCoreAsset(account.data);
        const item = findItem(config, Number(asset.attributes.item_id));
        return item ? [ownedOf(item, pubkey, asset.attributes.serial ? Number(asset.attributes.serial) : null)] : [];
      } catch {
        return [];
      }
    });
  }

  /** Whether the player owns an item, by id or name. */
  async function owns(sku) {
    const config = await ready();
    const item = findItem(config, sku);
    return Boolean(item) && (await ownedItems()).some((i) => i.id === item.id);
  }

  /** The game's token (launched or linked), or null. */
  async function token() {
    return (await ready()).token ?? null;
  }

  // ------------------------------------------------------------ looks → gf-three loadout

  const wornKey = () => `gf-web3:worn:${loc?.pathname ?? ''}:${address() ?? 'guest'}`;

  /** The loadout these items make (one item per slot; `items` in the player's order of choice, else rarest first). */
  function loadout(items, { byRarity = !Array.isArray(state.worn) } = {}) {
    return loadoutOf(items ?? [], { byRarity });
  }

  /**
   * Wear items: their looks become this player's gf-three loadout (window.__GF_LOADOUT, which gf-three's
   * kit/net/looks.js applies and sends to every other player). `items`: owned items or their ids. Remembered per
   * game and wallet. Returns { loadout, worn }.
   */
  async function wear(items) {
    const owned = await ownedItems();
    const chosen = (items ?? owned).map((x) => (typeof x === 'object' ? x : owned.find((o) => o.id === Number(x)))).filter(Boolean);
    const result = loadout(chosen, { byRarity: !items });
    state.worn = result.worn;
    try {
      storage?.setItem(wornKey(), JSON.stringify(result.worn));
    } catch {}
    if (win) win.__GF_LOADOUT = result.loadout;
    emit('loadout', result);
    return result;
  }

  /** Wear what the player owns: their remembered choice for this game, else every owned item (rarest wins a slot). */
  async function wearOwned() {
    const owned = await ownedItems();
    let saved = null;
    try {
      saved = JSON.parse(storage?.getItem(wornKey()) ?? 'null');
    } catch {}
    const chosen = Array.isArray(saved) ? saved.map((id) => owned.find((o) => o.id === id)).filter(Boolean) : null;
    return wear(chosen?.length ? chosen : undefined);
  }

  function on(event, fn) {
    const set = state.listeners.get(event) ?? new Set();
    set.add(fn);
    state.listeners.set(event, set);
    return () => set.delete(fn);
  }

  /** Another public RPC for reads and sends (keyless only: everything in a game is public), or a config object. */
  function configure({ rpc: url, config, mock } = {}) {
    if (url !== undefined) {
      if (secretLike(url) || !/^https:\/\//.test(url)) throw new Error('Use a public, keyless https RPC in a game. A keyed URL would be visible to every player.');
      state.rpcUrl = url;
    }
    if (config) {
      state.config = parseConfig(JSON.stringify(config));
      state.loading = null;
    }
    if (mock !== undefined) state.mock = Boolean(mock);
  }

  return {
    VERSION,
    get mock() {
      return state.mock;
    },
    get address() {
      return address();
    },
    get config() {
      return state.config;
    },
    ready,
    configure,
    connect,
    disconnect,
    signIn,
    ownedItems,
    owns,
    shop: { list: listShop, buy },
    boxes,
    openBox,
    orders,
    finish,
    token,
    loadout,
    wear,
    wearOwned,
    on,
    isAddress,
    transactionId,
  };
}

const gfWeb3 = createGfWeb3();
export default gfWeb3;
