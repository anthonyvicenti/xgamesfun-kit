// The games.fun loot program (items, shop and loot boxes): program addresses, instructions, accounts and published
// odds. Ported from games.fun's launchpad/loot/client/loot.mjs without @solana/web3.js, so the in-game kit uses it too.
import { addressBytes } from './base58.js';
import { decodeAccount, encodeInstruction } from './borsh.js';
import { randomBytes, readUintLE, uintLE, utf8 } from './bytes.js';
import LOOT_IDL from './loot-idl.js';
import { associatedTokenAddress, pdaOf, SYSVAR_SLOT_HASHES } from './pda.js';
import { computeUnitLimit, meta } from './programs.js';

export { LOOT_IDL };
export const LOOT_PROGRAM = LOOT_IDL.address;
/** MagicBlock's base-layer VRF oracle queue (the same address on devnet and mainnet). */
export const VRF_QUEUE = 'Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh';
/** An order nobody rolled may be refunded after this many slots. */
export const STALE_SLOTS = 1500n;

export const ItemKind = Object.freeze({ Normal: 'Normal', Collectible: 'Collectible' });
export const OrderStatus = Object.freeze({ Pending: 'Pending', Rolled: 'Rolled', Failed: 'Failed' });
export const LootAccount = Object.freeze({ Game: 'Game', Item: 'ItemDef', Box: 'LootBox', Order: 'Order', Platform: 'Platform' });

const OPEN_BOX_UNITS = 300_000;
/** A shop buy and its settle (which mints the Core asset) in one transaction. */
const BUY_AND_SETTLE_UNITS = 450_000;
const SETTLE_UNITS = 400_000;

const seed = (name) => {
  const value = LOOT_IDL.constants.find((c) => c.name === name)?.value;
  if (!value) throw new Error(`Loot IDL has no constant ${name}`);
  return Uint8Array.from(JSON.parse(value));
};
const SEED = {
  platform: seed('PLATFORM_SEED'),
  game: seed('GAME_SEED'),
  item: seed('ITEM_SEED'),
  box: seed('BOX_SEED'),
  order: seed('ORDER_SEED'),
  escrow: seed('ESCROW_SEED'),
  asset: seed('ASSET_SEED'),
};

/** The program's derived addresses. */
export const lootPda = {
  platform: () => pdaOf([SEED.platform], LOOT_PROGRAM),
  game: (collection) => pdaOf([SEED.game, addressBytes(collection)], LOOT_PROGRAM),
  item: (game, itemId) => pdaOf([SEED.item, addressBytes(game), uintLE(itemId, 4)], LOOT_PROGRAM),
  box: (game, boxId) => pdaOf([SEED.box, addressBytes(game), uintLE(boxId, 4)], LOOT_PROGRAM),
  order: (game, player, nonce) =>
    pdaOf([SEED.order, addressBytes(game), addressBytes(player), uintLE(nonce, 8)], LOOT_PROGRAM),
  escrow: (order) => pdaOf([SEED.escrow, addressBytes(order)], LOOT_PROGRAM),
  asset: (order) => pdaOf([SEED.asset, addressBytes(order)], LOOT_PROGRAM),
  vrfIdentity: () => pdaOf([utf8('identity')], LOOT_PROGRAM),
};

/** Any loot instruction from its IDL entry; `accounts` names each account the IDL leaves open. */
export function lootInstruction(name, args, accounts, remaining = []) {
  const def = LOOT_IDL.instructions.find((i) => i.name === name);
  if (!def) throw new Error(`Unknown loot instruction ${name}`);
  const keys = def.accounts.map((a) => {
    const pubkey = accounts[a.name] ?? a.address;
    if (!pubkey) throw new Error(`${name}: missing account ${a.name}`);
    return meta(pubkey, a.signer === true, a.writable === true);
  });
  return { programId: LOOT_PROGRAM, keys: [...keys, ...remaining], data: encodeInstruction(LOOT_IDL, name, args) };
}

/** Register a loot game for a Core collection, priced in `mint`, paying sales into `treasury`. */
export function createGameInstruction({ authority, collection, mint, treasury, burnBps = 0 }) {
  return lootInstruction(
    'create_game',
    { burn_bps: burnBps },
    { authority, game: lootPda.game(collection), collection, mint, treasury },
  );
}

/** An item as the program stores it. `price` 0n means loot boxes only; `maxSupply` 0 means unlimited. */
export function upsertItemInstruction({ admin, game, itemId, kind = ItemKind.Collectible, rarity = 0, soulbound = false, name, uri, maxSupply = 0, price = 0n, active = true }) {
  return lootInstruction(
    'upsert_item',
    {
      item_id: itemId,
      args: { kind, rarity, soulbound, name, uri, max_supply: maxSupply, price: BigInt(price), active },
    },
    { admin, game, item: lootPda.item(game, itemId) },
  );
}

/** A loot box: one to eight items with drop weights. */
export function upsertBoxInstruction({ admin, game, boxId, price, active = true, entries }) {
  return lootInstruction(
    'upsert_box',
    {
      box_id: boxId,
      price: BigInt(price),
      active,
      entries: entries.map((e) => ({ item_id: e.itemId, weight: e.weight })),
    },
    { admin, game, loot_box: lootPda.box(game, boxId) },
  );
}

/** A fresh order nonce: a random u64. */
export const newNonce = () => readUintLE(randomBytes(8), 0, 8);

/**
 * What a settle needs, read from the chain (the treasury or fee wallet may have changed since the shop was made):
 * { game, gameMint, treasury, collection, feeWallet, player, itemId }.
 */
function settleInstruction(signer, order, s) {
  return lootInstruction('settle', {}, {
    signer,
    order,
    player: s.player,
    game: s.game,
    item: lootPda.item(s.game, s.itemId),
    platform: lootPda.platform(),
    escrow: lootPda.escrow(order),
    mint: s.gameMint,
    vault: associatedTokenAddress(s.game, s.gameMint),
    treasury: s.treasury,
    fee_wallet: s.feeWallet,
    fee_token: associatedTokenAddress(s.feeWallet, s.gameMint),
    collection: s.collection,
    asset: lootPda.asset(order),
  });
}

/** Settle a rolled order: mint the collectible to its player and split the payment. Anyone may sign it. */
export const settleInstructions = (signer, order, s) => [computeUnitLimit(SETTLE_UNITS), settleInstruction(signer, order, s)];

/**
 * Buy an item from the shop and settle it in the same transaction, so the player approves once. A shop buy rolls
 * nothing: the order is Rolled as soon as buy_item runs, and the settle that follows mints the Core asset.
 */
export function buyAndSettleInstructions(player, s, nonce = newNonce()) {
  const order = lootPda.order(s.game, player, nonce);
  const buy = lootInstruction('buy_item', { item_id: s.itemId, nonce }, {
    player,
    game: s.game,
    item: lootPda.item(s.game, s.itemId),
    platform: lootPda.platform(),
    order,
    escrow: lootPda.escrow(order),
    mint: s.gameMint,
    player_token: associatedTokenAddress(player, s.gameMint),
    vault: associatedTokenAddress(s.game, s.gameMint),
  });
  return {
    instructions: [computeUnitLimit(BUY_AND_SETTLE_UNITS), buy, settleInstruction(player, order, s)],
    order,
    asset: lootPda.asset(order),
  };
}

/** Open a loot box. MagicBlock's oracle rolls it a moment later (callback_roll); settle after that. */
export function openBoxInstructions({ player, game, mint, boxId, itemIds, nonce = newNonce(), clientSeed = randomBytes(32) }) {
  const order = lootPda.order(game, player, nonce);
  const remaining = itemIds.map((id) => meta(lootPda.item(game, id), false, false));
  const open = lootInstruction(
    'open_box',
    { box_id: boxId, nonce, client_seed: clientSeed },
    {
      player,
      game,
      loot_box: lootPda.box(game, boxId),
      platform: lootPda.platform(),
      order,
      escrow: lootPda.escrow(order),
      mint,
      player_token: associatedTokenAddress(player, mint),
      vault: associatedTokenAddress(game, mint),
      oracle_queue: VRF_QUEUE,
      program_identity: lootPda.vrfIdentity(),
      slot_hashes: SYSVAR_SLOT_HASHES,
    },
    remaining,
  );
  return { instructions: [computeUnitLimit(OPEN_BOX_UNITS), open], order, nonce };
}

/** Refund a failed or stale order to its player. Anyone may sign it. */
export function refundInstruction({ signer, order, player, game, mint }) {
  return lootInstruction('refund', {}, {
    signer,
    order,
    player,
    game,
    escrow: lootPda.escrow(order),
    mint,
    vault: associatedTokenAddress(game, mint),
    player_token: associatedTokenAddress(player, mint),
  });
}

/** A loot account's fields, decoded (u64 fields are bigints). */
export const decodeLoot = (name, data) => decodeAccount(LOOT_IDL, name, data);

/** Published odds for a box, exactly as the program picks: items that are sold out or inactive drop out. */
export function boxOdds(entries, available = () => true) {
  const total = entries.reduce((n, e) => n + (available(e.itemId) ? e.weight : 0), 0);
  return entries.map((e) => ({ ...e, chance: total && available(e.itemId) ? e.weight / total : 0 }));
}

/** Whether an on-chain item can still be issued. */
export const itemAvailable = (item) =>
  Boolean(item) && item.active && (item.max_supply === 0 || item.issued < item.max_supply);
