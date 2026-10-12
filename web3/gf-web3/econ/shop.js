// A game that still has a `shop` (gf-web3 2.0.0 and earlier) and no `economy`: the economy it stands for, so every
// call reads one shape. The parts are exactly what web3/economy/migrate.mjs `migrateShop` writes (a test holds the
// two together); that module reads files with node:fs, so the game page cannot import it.
//
// One difference, on purpose: a shop gf-web3 2.0.0 published is already on the loot program 0.3 (its game is the 0.3
// address of its collection), so it stays live here (`live`); a shop of 0.1/0.2 is not, and is kept as `previous`,
// as the migration keeps it.
import { lootPda } from '../chain/loot.js';
import { fromUnits, WSOL } from './spec.js';

/** A key from a name: "Golden Sword!" → "golden-sword", unique within `taken` (migrate.mjs keyFrom). */
export function keyFrom(name, taken = new Set(), fallback = 'part') {
  let base = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  if (!/^[a-z]/.test(base)) base = `${fallback}${base ? `-${base}` : ''}`.slice(0, 28);
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

/** The economy a config's shop stands for, or null when it has none (or already has an economy). */
export function economyFromShop(config) {
  const shop = config?.shop;
  if (!shop || config.economy) return null;
  const cur = shop.currency ?? { mint: WSOL, symbol: 'SOL', decimals: 9, native: true };
  const tokenKeys = new Set();
  const tokens = [];
  let currency;
  const linked = config.token;
  if (cur.native || cur.mint === WSOL) {
    currency = keyFrom('sol', tokenKeys);
    tokens.push({ key: currency, source: 'sol' });
  } else {
    currency = keyFrom(cur.symbol, tokenKeys, 'coin');
    const same = linked?.mint === cur.mint;
    tokens.push({
      key: currency,
      source: same && linked.source === 'launched' ? 'curve' : 'existing',
      mint: cur.mint,
      ...(same ? { name: linked.name } : {}),
      symbol: String(cur.symbol).slice(0, 10),
      decimals: cur.decimals,
      program: same ? linked.program : (cur.program ?? 'spl-token'),
      ...(same && linked.source === 'launched' ? { venue: 'games.fun' } : {}),
    });
  }
  if (linked && linked.mint !== cur.mint)
    tokens.push({ key: keyFrom(linked.symbol, tokenKeys, 'coin'), source: linked.source === 'launched' ? 'curve' : 'existing', mint: linked.mint, name: linked.name, symbol: linked.symbol, decimals: linked.decimals, program: linked.program, ...(linked.source === 'launched' ? { venue: 'games.fun' } : {}) });

  const itemKeys = new Set();
  const keyOf = new Map();
  const items = (shop.items ?? []).map((it) => {
    const key = keyFrom(it.name, itemKeys, 'item');
    keyOf.set(it.id, key);
    return {
      key,
      id: it.id,
      name: it.name,
      ...(it.description ? { description: it.description } : {}),
      kind: 'collectible',
      rarity: it.rarity ?? 'Common',
      soulbound: !!it.soulbound,
      supply: it.maxSupply ?? 0,
      price: fromUnits(BigInt(it.price ?? '0'), cur.decimals),
      ...(it.uri ? { uri: it.uri } : {}),
      ...(it.image ? { image: it.image } : {}),
      ...(it.picture ? { picture: it.picture } : {}),
      ...(it.look ? { look: it.look } : {}),
    };
  });
  const boxKeys = new Set();
  const boxes = (shop.boxes ?? []).map((b) => ({
    key: keyFrom(b.name, boxKeys, 'box'),
    id: b.id,
    name: b.name,
    price: fromUnits(BigInt(b.price), cur.decimals),
    outcomes: b.entries.filter((e) => keyOf.has(e.item)).map((e) => ({ gives: 'item', item: keyOf.get(e.item), weight: e.weight })),
  }));

  const economy = {
    version: 1,
    network: 'devnet',
    name: shop.name,
    currency,
    tokens,
    collection: {
      name: shop.name,
      ...(shop.description ? { description: shop.description } : {}),
      royaltyPercent: (shop.royaltyBps ?? 500) / 100,
      ...(shop.metadataUri ? { uri: shop.metadataUri } : {}),
      ...(shop.image ? { image: shop.image } : {}),
    },
    items,
    boxes,
  };
  const onLoot03 = shop.collection && shop.game && lootPda.game(shop.collection) === shop.game;
  if (onLoot03) economy.live = { game: shop.game, collection: shop.collection, ...(shop.treasury ? { treasury: shop.treasury } : {}) };
  else if (shop.collection || shop.game)
    economy.previous = { program: '0.2', ...(shop.collection ? { collection: shop.collection } : {}), ...(shop.game ? { game: shop.game } : {}), ...(shop.treasury ? { treasury: shop.treasury } : {}) };
  return economy;
}
