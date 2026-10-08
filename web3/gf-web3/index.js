// gf-web3: the games.fun in-game kit. Optional wallet sign-in, the player's items from this game's collection,
// the shop, loot boxes and the game's token, all from the game's public gamesfun.json. Guests play without a
// wallet; nothing asks for one until the player presses something that needs it. Owned items' looks become a
// gf-three loadout (CONTRACT §6e), so everyone in a multiplayer match sees what each player wears.
//
//   import gfWeb3 from './gf/web3/index.js';
//   await gfWeb3.ready();                        // reads ./gamesfun.json
//   const items = await gfWeb3.shop.list();      // what is on sale, priced in the shop's currency
//   await gfWeb3.shop.buy(items[0].id);          // one wallet approval: pay, mint, deliver
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
import { buyAndSettleInstructions, decodeLoot, LootAccount, lootPda, openBoxInstructions, OrderStatus, refundInstruction, settleInstructions } from './chain/loot.js';
import { associatedTokenAddress, NATIVE_MINT } from './chain/pda.js';
import { closeTokenAccount, withSolWrap } from './chain/programs.js';
import { sha256 } from './chain/sha256.js';
import { compileMessage, wireTransaction, transactionId } from './chain/tx.js';
import { CONFIG_FILE, emptyConfig, findBox, findItem, parseConfig } from './config.js';
import { loadoutOf } from './looks.js';
import { networkConfig } from './network.js';
import { rpcClient } from './rpc.js';
import { fromUnits, odds, secretLike } from './rules.js';
import * as walletKit from './wallet.js';

export const VERSION = '1.0.0';
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

  /** The on-chain Game, Platform and (optionally) item or box accounts a purchase needs. */
  async function readShop(shop, extra = []) {
    const [game, platform, ...rest] = await rpc().accounts([shop.game, lootPda.platform(), ...extra]);
    if (!game || !platform) throw new Error(MESSAGE.NotLive);
    return { game: decodeLoot(LootAccount.Game, game.data), platform: decodeLoot(LootAccount.Platform, platform.data), rest };
  }

  async function checkFunds(player, mint, price, shop) {
    const client = rpc();
    const have = mint === NATIVE_MINT ? await client.balance(player) : await client.tokenBalance(associatedTokenAddress(player, mint));
    if (have < BigInt(price)) throw new Error(MESSAGE.Short(priceText(shop, price)));
  }

  /** Buy an item (by id or name): one wallet approval pays, mints the collectible and delivers it. */
  async function buy(sku) {
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
    status('Getting the shop ready…');
    const { game, platform, rest } = await readShop(shop, [lootPda.item(shop.game, item.id)]);
    const onChain = rest[0] ? decodeLoot(LootAccount.Item, rest[0].data) : null;
    if (!onChain?.active || onChain.price === 0n) throw new Error(MESSAGE.NotForSale(item.name));
    await checkFunds(player, game.mint, onChain.price, shop);
    const context = { game: shop.game, gameMint: game.mint, treasury: game.treasury, collection: game.collection, feeWallet: platform.fee_wallet, player, itemId: item.id };
    const sale = buyAndSettleInstructions(player, context);
    status('Approve the purchase in your wallet…');
    const signature = await signAndSend(player, withSolWrap(player, game.mint, onChain.price, sale.instructions));
    const bought = ownedOf(item, sale.asset, null);
    emit('items', bought);
    status('');
    return { item: bought, asset: sale.asset, signatures: [signature], mock: false };
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
    await checkFunds(player, game.mint, onChain.price, shop);
    const open = openBoxInstructions({ player, game: shop.game, mint: game.mint, boxId: box.id, itemIds: onChain.entries.map((e) => e.item_id) });
    say('Approve opening the box in your wallet…');
    const opened = await signAndSend(player, withSolWrap(player, game.mint, onChain.price, open.instructions));
    say('Rolling…');
    let order = null;
    for (let poll = 0; poll < ROLL_POLLS; poll++) {
      const [account] = await rpc().accounts([open.order]);
      order = account ? decodeLoot(LootAccount.Order, account.data) : null;
      if (order && order.status !== OrderStatus.Pending) break;
      await new Promise((resolve) => setTimeout(resolve, options.rollPollMs ?? ROLL_POLL_MS));
    }
    if (!order || order.status === OrderStatus.Pending) throw new Error(MESSAGE.RollSlow);
    const context = { game: shop.game, gameMint: game.mint, treasury: game.treasury, collection: game.collection, feeWallet: platform.fee_wallet, player, itemId: order.item_id };
    if (order.status === OrderStatus.Failed) {
      say('Nothing left to win: approve the refund in your wallet…');
      const refund = [refundInstruction({ signer: player, order: open.order, player, game: shop.game, mint: game.mint })];
      // A SOL shop refunds into a re-created wrapped-SOL account: close it so the player keeps plain SOL.
      if (game.mint === NATIVE_MINT) refund.push(closeTokenAccount(associatedTokenAddress(player, NATIVE_MINT), player, player));
      await signAndSend(player, refund);
      throw new Error(MESSAGE.RollFailed);
    }
    say('You won something! Approve claiming it in your wallet…');
    const claimed = await signAndSend(player, settleInstructions(player, open.order, context));
    const item = findItem(config, order.item_id);
    const won = item ? ownedOf(item, lootPda.asset(open.order), order.serial) : { id: order.item_id, name: `Item ${order.item_id}`, rarity: 'Common', look: null, image: null, serial: order.serial, asset: lootPda.asset(open.order) };
    emit('items', won);
    say('');
    return { item: won, asset: won.asset, order: open.order, signatures: [opened, claimed], mock: false };
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
