// Today's `shop` section of gamesfun.json (loot program 0.1/0.2: one currency, collectible items, boxes of items)
// → an `economy` section on loot 0.3. The pure `migrateShop` is the in-game kit's (web3/gf-web3/econ/shop.js: no Node
// import, so the game page reads an old shop through the same function); this module adds `migrateFile`, which reads
// and writes a game's file.
//
// Program 0.3 lives at a new address, so a shop that was live on 0.1/0.2 is not live here: its addresses are kept
// under `economy.previous` for the record, and the economy goes live fresh (a new collection and game).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { migrateShop } from '../gf-web3/econ/shop.js';
import { secretLike } from '../gf-web3/rules.js';

export { keyFrom, migrateShop, shopOnLoot03 } from '../gf-web3/econ/shop.js';

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
