// Today's `shop` section of gamesfun.json (loot program 0.1/0.2: one currency, collectible items, boxes of items)
// → an `economy` section on loot 0.3. `migrateShop` is pure; `migrateFile` reads and writes a game's file.
//
// Program 0.3 lives at a new address, so a shop that was live there is not live here: its addresses are kept under
// `economy.previous` for the record, and the economy goes live fresh (a new collection and game).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { secretLike } from '../gf-web3/rules.js';
import { WSOL, fromUnits } from './model.mjs';

/** A key from a name: "Golden Sword!" → "golden-sword", unique within `taken`. */
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

/**
 * The config with its `shop` turned into an `economy`. Returns { config, changed, notes }. A config that already has
 * an economy, or has no shop, comes back unchanged.
 */
export function migrateShop(config) {
  const notes = [];
  if (!config?.shop) return { config, changed: false, notes: ['There is no shop to move.'] };
  if (config.economy) return { config, changed: false, notes: ['This game already has an economy; its shop was left as it is.'] };
  const shop = config.shop;
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
      program: same ? linked.program : 'spl-token',
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
  if (shop.collection || shop.game) {
    economy.previous = { program: '0.2', ...(shop.collection ? { collection: shop.collection } : {}), ...(shop.game ? { game: shop.game } : {}), ...(shop.treasury ? { treasury: shop.treasury } : {}) };
    notes.push(`The shop was live on loot program 0.2 (collection ${shop.collection ?? 'unknown'}). Program 0.3 is a new program: the economy goes live fresh, with a new collection; the old one is kept under economy.previous.`);
  }
  notes.push(`Moved ${items.length} item${items.length === 1 ? '' : 's'} and ${boxes.length} box${boxes.length === 1 ? '' : 'es'} into the economy, priced in ${tokens[0].symbol ?? 'SOL'}.`);
  const { shop: _, ...rest } = config;
  return { config: { ...rest, economy }, changed: true, notes };
}

/** Migrates a game's gamesfun.json. With `write`, saves it (refusing anything that looks like a secret). */
export async function migrateFile(gameDir, { write = false } = {}) {
  const file = path.join(gameDir, 'gamesfun.json');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { changed: false, notes: ['This game has no gamesfun.json.'] };
  }
  const result = migrateShop(JSON.parse(text));
  if (result.changed && write) {
    const out = `${JSON.stringify(result.config, null, 2)}\n`;
    if (secretLike(out.replace(/"signature": "[1-9A-HJ-NP-Za-km-z]{64,88}"/g, '""'))) throw new Error('Refusing to write gamesfun.json: something in it looks like a key or secret.');
    await writeFile(file, out);
  }
  return { ...result, file, written: result.changed && write };
}
