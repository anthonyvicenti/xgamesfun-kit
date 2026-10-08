// Chain reads for the creator surfaces: what a mint is, and where the game's token and shop stand on chain (each item
// and box: draft, published, or changed since it was published). Read-only; nothing here signs.
import { createHash } from 'node:crypto';
import { isAddress } from '../gf-web3/chain/base58.js';
import { readPoolConfig, readVirtualPool, dbcPda } from '../gf-web3/chain/dbc.js';
import { decodeLoot, LootAccount, lootPda } from '../gf-web3/chain/loot.js';
import { parseMint } from '../gf-web3/chain/mint.js';
import { metadataAddress, NATIVE_MINT } from '../gf-web3/chain/pda.js';
import { cleanLook, isEmptyLook } from '../gf-web3/looks.js';
import { explorerUrl } from '../gf-web3/network.js';
import { rarityIndex, RuleError } from '../gf-web3/rules.js';

/** What a mint is on this network, or a plain refusal. SOL is answered without a read. */
export async function mintInfo(rpc, address) {
  const mint = String(address ?? '').trim();
  if (!isAddress(mint)) throw new RuleError('That is not a Solana address. Paste the token’s mint address.');
  if (mint === NATIVE_MINT)
    return { mint, program: 'spl-token', native: true, decimals: 9, supply: null, mintAuthority: null, freezeAuthority: null, name: 'Solana', symbol: 'SOL', uri: null, lootReady: true };
  const [account, metadata] = await rpc.accounts([mint, metadataAddress(mint)]);
  if (!account) throw new RuleError('There is no token at that address on devnet.');
  const info = parseMint(mint, account.owner, account.data, metadata?.data ?? null);
  if (!info) throw new RuleError('That address is not a token mint (it may be a wallet, a pool or a token account).');
  return info;
}

/** Stable JSON (sorted keys), so a hash of it only changes when the content does. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hashJson = (value) => createHash('sha256').update(canonical(value)).digest('hex');

/** What an item's uploaded metadata depends on: when this changes, the metadata is uploaded again. */
export const itemMetaSource = (shop, item, image = item.image) => ({
  name: item.name,
  description: item.description,
  rarity: item.rarity,
  soulbound: item.soulbound,
  game: shop.name,
  image: image ?? null,
  look: cleanLook(item.look),
});
/** What the collection's uploaded metadata depends on. */
export const collectionMetaSource = (shop, image = shop.image) => ({ name: shop.name, description: shop.description, image: image ?? null });

/** The public metadata JSON of an item (what wallets and explorers show), from its config and uploaded picture. */
export function itemMetadata(shop, item, image, contentType) {
  const look = cleanLook(item.look);
  return {
    name: item.name,
    description: item.description,
    image,
    attributes: [
      { trait_type: 'Rarity', value: item.rarity },
      { trait_type: 'Game', value: shop.name },
      ...(item.soulbound ? [{ trait_type: 'Soulbound', value: 'Yes' }] : []),
    ],
    properties: {
      files: [{ uri: image, type: contentType }],
      category: 'image',
      ...(isEmptyLook(look) ? {} : { gameLook: look }),
    },
  };
}

/** The public metadata JSON of the shop's collection. */
export const collectionMetadata = (shop, image, contentType) => ({
  name: shop.name,
  description: shop.description || `Items for ${shop.name}.`,
  image,
  properties: { files: [{ uri: image, type: contentType }], category: 'image' },
});

/** The public metadata JSON of a launched token. */
export const tokenMetadata = ({ name, symbol, description, image, contentType }) => ({
  name,
  symbol,
  description,
  image,
  properties: { files: [{ uri: image, type: contentType }], category: 'image', launchpad: 'games.fun' },
});

/** How an item's on-chain definition should read, from its config. */
export const itemOnChainArgs = (item) => ({
  kind: 'Collectible',
  rarity: rarityIndex(item.rarity),
  soulbound: item.soulbound,
  name: item.name,
  uri: item.uri ?? '',
  maxSupply: item.maxSupply,
  price: BigInt(item.price),
  active: true,
});

const sameItem = (item, onChain) =>
  onChain.kind === 'Collectible' &&
  onChain.name === item.name &&
  onChain.uri === (item.uri ?? '') &&
  onChain.price === BigInt(item.price) &&
  onChain.max_supply === item.maxSupply &&
  onChain.soulbound === item.soulbound &&
  onChain.rarity === rarityIndex(item.rarity) &&
  onChain.active === true;

const sameBox = (box, onChain) =>
  onChain.price === BigInt(box.price) &&
  onChain.active === true &&
  onChain.entries.length === box.entries.length &&
  onChain.entries.every((e, i) => e.item_id === box.entries[i].item && e.weight === box.entries[i].weight);

/**
 * The game's token and shop as the chain has them. `pictureHash(path)` returns the current sha256 of a game picture
 * (or null), so an item whose picture changed since its upload reads as changed. Returns:
 * { token: {exists, pool?, explorer}, shop: {exists, game?, items: {id: {state, issued, onChain}}, boxes: {...}} }
 */
export async function chainStatus(rpc, network, config, { pictureHash = async () => null } = {}) {
  const token = config.token;
  const shop = config.shop;
  const game = shop?.collection ? lootPda.game(shop.collection) : null;
  const addresses = [
    token?.mint,
    token?.pool,
    shop?.collection,
    game,
    ...(game ? (shop.items ?? []).map((i) => lootPda.item(game, i.id)) : []),
    ...(game ? (shop.boxes ?? []).map((b) => lootPda.box(game, b.id)) : []),
  ].filter(Boolean);
  const accounts = addresses.length ? await rpc.accounts(addresses) : [];
  const byAddress = new Map(addresses.map((a, i) => [a, accounts[i]]));
  const out = { token: null, shop: null };
  if (token) {
    let pool = null;
    try {
      pool = token.pool && byAddress.get(token.pool) ? readVirtualPool(byAddress.get(token.pool).data) : null;
    } catch {
      pool = null;
    }
    out.token = {
      exists: Boolean(byAddress.get(token.mint)),
      pool: pool ? { creator: pool.creator, baseReserve: pool.baseReserve.toString(), quoteReserve: pool.quoteReserve.toString(), isMigrated: pool.isMigrated } : null,
      explorer: explorerUrl(network, 'address', token.mint),
    };
  }
  if (shop) {
    let gameAccount = null;
    try {
      gameAccount = game && byAddress.get(game) ? decodeLoot(LootAccount.Game, byAddress.get(game).data) : null;
    } catch {
      gameAccount = null;
    }
    const items = {};
    for (const item of shop.items) {
      let onChain = null;
      try {
        const a = game ? byAddress.get(lootPda.item(game, item.id)) : null;
        onChain = a ? decodeLoot(LootAccount.Item, a.data) : null;
      } catch {
        onChain = null;
      }
      const currentPicture = item.picture ? await pictureHash(item.picture) : null;
      const pictureChanged = Boolean(currentPicture && item.imageHash && currentPicture !== item.imageHash);
      const needsPicture = !item.image && !currentPicture;
      const metaStale = !item.uri || pictureChanged || !item.image || item.metaHash !== hashJson(itemMetaSource(shop, item));
      let state = 'draft';
      if (onChain) state = sameItem(item, onChain) && !metaStale ? 'published' : 'changed';
      items[item.id] = {
        state,
        issued: onChain ? onChain.issued : 0,
        onChain: onChain ? { name: onChain.name, uri: onChain.uri, price: onChain.price.toString(), maxSupply: onChain.max_supply, active: onChain.active } : null,
        needsPicture,
        needsUpload: !item.image || pictureChanged || metaStale,
      };
    }
    const boxes = {};
    for (const box of shop.boxes) {
      let onChain = null;
      try {
        const a = game ? byAddress.get(lootPda.box(game, box.id)) : null;
        onChain = a ? decodeLoot(LootAccount.Box, a.data) : null;
      } catch {
        onChain = null;
      }
      boxes[box.id] = {
        state: onChain ? (sameBox(box, onChain) ? 'published' : 'changed') : 'draft',
        opened: onChain ? Number(onChain.opened) : 0,
      };
    }
    out.shop = {
      exists: Boolean(gameAccount),
      collectionExists: Boolean(shop.collection && byAddress.get(shop.collection)),
      game: gameAccount ? { mint: gameAccount.mint, treasury: gameAccount.treasury, authority: gameAccount.authority, paused: gameAccount.paused, orders: Number(gameAccount.orders) } : null,
      explorer: shop.collection ? explorerUrl(network, 'address', shop.collection) : null,
      items,
      boxes,
    };
  }
  return out;
}

/** games.fun's live curve config. */
export async function poolConfig(rpc, network) {
  const account = await rpc.account(network.launchpad.config);
  if (!account) throw new Error('games.fun’s curve config is missing on this network.');
  return readPoolConfig(account.data);
}

export { dbcPda };
