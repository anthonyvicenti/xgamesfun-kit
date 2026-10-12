// MCP tools for the game's web3 setup (docs/ARCHITECTURE.md, "MCP tools"). Agents prepare; humans approve.
// Drafts (items, boxes, currency, linking an existing token) only edit the game's gamesfun.json. The two tools that
// would sign or spend (launch a token, put the shop on sale) never do: they leave a request and return a step for
// the human, "open the studio and approve it in your wallet". No tool here signs or sees a key.
import { web3Action } from '../../web3/node/actions.mjs';
import { listPictures, playerLooks } from '../../web3/node/game.mjs';
import { KIT_ROOT, resolveGame } from '../../web3/node/game-dir.mjs';

const game = { type: 'string', description: 'The game folder (for example games/bean-brawl). Optional when there is only one game.' };
const look = {
  type: 'object',
  description: 'What owning the item changes in the game: a gf-three loadout fragment. Slot ids come from web3_player_looks.',
  properties: {
    values: { type: 'object', description: 'slot id → value: a colour "#rrggbb", a number, true/false or an option', additionalProperties: { type: ['string', 'number', 'boolean'] } },
    files: { type: 'object', description: 'slot id → a .glb or picture inside the game (assets/models/hat-gold.glb) or an https URL', additionalProperties: { type: 'string' } },
  },
  additionalProperties: false,
};
const itemProps = {
  name: { type: 'string', description: 'At most 32 bytes.' },
  picture: { type: 'string', description: 'A PNG, JPEG, WebP or GIF inside the game folder (see web3_list_pictures).' },
  rarity: { type: 'string', enum: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] },
  price: { type: 'string', description: 'In the shop’s currency, like "0.05". Empty or "0": loot boxes only.' },
  description: { type: 'string', description: 'What players see.' },
  maxSupply: { type: 'integer', minimum: 0, description: '0 or absent: no limit.' },
  soulbound: { type: 'boolean', description: 'true: it cannot be traded.' },
  look,
};

const call = (action, sub, values, ctx) => web3Action(action, sub, values, { kitRoot: ctx?.kitRoot ?? KIT_ROOT, cwd: ctx?.cwd ?? process.cwd(), from: 'mcp', ...(ctx?.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}), ...(ctx?.env ? { env: ctx.env } : {}) });
const result = (r) => ({ text: r.text, ...(r.data ?? {}), ...(r.approve ? { approve: r.approve } : {}) });
const itemValues = (input) => ({
  game: input.game,
  ...(input.id !== undefined ? { id: String(input.id) } : {}),
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.picture !== undefined ? { picture: input.picture } : {}),
  ...(input.rarity !== undefined ? { rarity: input.rarity } : {}),
  ...(input.price !== undefined ? { price: String(input.price) } : {}),
  ...(input.description !== undefined ? { description: input.description } : {}),
  ...(input.maxSupply !== undefined ? { supply: String(input.maxSupply) } : {}),
  ...(input.soulbound !== undefined ? { soulbound: input.soulbound } : {}),
  ...(input.look !== undefined ? { look: JSON.stringify(input.look) } : {}),
});

export const tools = [
  {
    name: 'web3_status',
    description: 'The game’s web3 setup (devnet): its token, shop currency, items and loot boxes from gamesfun.json, each checked on chain (draft, on sale, or changed), and any request waiting for the creator’s approval. Read-only.',
    inputSchema: { type: 'object', properties: { game, offline: { type: 'boolean', description: 'Skip the chain check.' } }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('status', null, { game: input.game, offline: input.offline }, ctx)),
  },
  {
    name: 'web3_list_pictures',
    description: 'Pictures inside the game folder that a token, an item or the collection can use (PNG, JPEG, WebP, GIF). Read-only.',
    inputSchema: { type: 'object', properties: { game }, additionalProperties: false },
    handler: async (input, ctx) => {
      const dir = await resolveGame(input.game, { kitRoot: ctx?.kitRoot ?? KIT_ROOT, cwd: ctx?.cwd ?? process.cwd() });
      const pictures = await listPictures(dir);
      return { text: pictures.length ? pictures.join('\n') : 'No pictures in this game yet.', pictures };
    },
  },
  {
    name: 'web3_player_looks',
    description: 'What an item can change for the player who owns it: the game’s player-look slots (gf-three CONTRACT §6e: body colour, shot colour, hat, character, and any the game adds). Use these ids in an item’s look. Read-only.',
    inputSchema: { type: 'object', properties: { game }, additionalProperties: false },
    handler: async (input, ctx) => {
      const dir = await resolveGame(input.game, { kitRoot: ctx?.kitRoot ?? KIT_ROOT, cwd: ctx?.cwd ?? process.cwd() });
      const looks = await playerLooks(dir);
      return { text: looks.length ? looks.map((l) => `${l.id}: ${l.label} (${l.type})`).join('\n') : 'This game declares no player looks; items are collectibles only.', looks };
    },
  },
  {
    name: 'web3_link_token',
    description: 'Use a token the creator already has as the game’s token (reads the mint on devnet and records it). No signature, no cost.',
    inputSchema: { type: 'object', required: ['mint'], properties: { game, mint: { type: 'string', description: 'The token’s mint address.' } }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('link', null, { game: input.game, mint: input.mint }, ctx)),
  },
  {
    name: 'web3_unlink_token',
    description: 'Stop using a linked token (no signature). A token launched here stays with the game.',
    inputSchema: { type: 'object', properties: { game }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('unlink', null, { game: input.game }, ctx)),
  },
  {
    name: 'web3_set_currency',
    description: 'What players pay with in the shop: SOL, MAIN (MAIN-dev), USDC (USDC-dev), token (the game’s own) or any mint address, classic SPL or Token-2022. Fixed once the shop is live. No signature.',
    inputSchema: { type: 'object', required: ['currency'], properties: { game, currency: { type: 'string' } }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('currency', input.currency, { game: input.game }, ctx)),
  },
  {
    name: 'web3_add_item',
    description: 'Draft a shop item (a Metaplex Core collectible) from a game picture, with what owning it changes in the game. It goes on sale only when the creator approves web3_prepare_publish. No signature.',
    inputSchema: { type: 'object', required: ['name', 'picture'], properties: { game, ...itemProps }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('item', 'add', itemValues(input), ctx)),
  },
  {
    name: 'web3_update_item',
    description: 'Change a draft or listed item. Once players own copies, only its price and supply can change. Changes go live with web3_prepare_publish.',
    inputSchema: { type: 'object', required: ['id'], properties: { game, id: { type: 'integer', minimum: 1 }, ...itemProps }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('item', 'set', itemValues(input), ctx)),
  },
  {
    name: 'web3_remove_item',
    description: 'Remove a draft item: one that was never on sale and is in no loot box. No signature.',
    inputSchema: { type: 'object', required: ['id'], properties: { game, id: { type: 'integer', minimum: 1 } }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('item', 'remove', { game: input.game, id: String(input.id) }, ctx)),
  },
  {
    name: 'web3_add_box',
    description: 'Draft a loot box: a price and up to 8 items with drop weights ("1:60,2:25"; omit odds to take every item weighted by rarity: Common 60, Uncommon 25, Rare 10, Epic 4, Legendary 1). Rolled on chain by MagicBlock VRF. No signature.',
    inputSchema: { type: 'object', required: ['name', 'price'], properties: { game, name: { type: 'string' }, price: { type: 'string' }, odds: { type: 'string', description: '"itemId:weight" pairs' } }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('box', 'add', { game: input.game, name: input.name, price: String(input.price), ...(input.odds ? { odds: input.odds } : {}) }, ctx)),
  },
  {
    name: 'web3_update_box',
    description: 'Change a loot box’s name, price or odds. Changes go live with web3_prepare_publish.',
    inputSchema: { type: 'object', required: ['id'], properties: { game, id: { type: 'integer', minimum: 1 }, name: { type: 'string' }, price: { type: 'string' }, odds: { type: 'string' } }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('box', 'set', { game: input.game, id: String(input.id), ...(input.name !== undefined ? { name: input.name } : {}), ...(input.price !== undefined ? { price: String(input.price) } : {}), ...(input.odds !== undefined ? { odds: input.odds } : {}) }, ctx)),
  },
  {
    name: 'web3_remove_box',
    description: 'Remove a draft loot box: one that was never on sale. No signature.',
    inputSchema: { type: 'object', required: ['id'], properties: { game, id: { type: 'integer', minimum: 1 } }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('box', 'remove', { game: input.game, id: String(input.id) }, ctx)),
  },
  {
    name: 'web3_prepare_launch',
    description: 'Prepare launching the game’s token on games.fun’s Meteora curve (devnet, quoted in MAIN-dev). This does NOT launch it: it leaves a request and returns a step for the human, who opens the studio’s Economy tab (the token is one part of the game’s economy) and approves each step in their own wallet (two upload signatures and one transaction). For a whole economy (shop, boxes, lotteries, stakes, crafting…) use the economy_* tools and the gamesfun-economy skill.',
    inputSchema: {
      type: 'object',
      required: ['name', 'symbol', 'picture'],
      properties: {
        game,
        name: { type: 'string', description: 'At most 32 bytes.' },
        symbol: { type: 'string', description: '2–10 letters or digits.' },
        picture: { type: 'string', description: 'A picture inside the game folder.' },
        description: { type: 'string' },
        initialBuy: { type: 'string', description: 'Optional MAIN-dev to buy at launch, in the same transaction.' },
      },
      additionalProperties: false,
    },
    handler: async (input, ctx) => result(await call('launch', null, { game: input.game, name: input.name, symbol: input.symbol, picture: input.picture, description: input.description, buy: input.initialBuy }, ctx)),
  },
  {
    name: 'web3_prepare_publish',
    description: 'Prepare putting the shop on sale: the collection and loot game the first time, then every new or changed item and box. This does NOT publish: it leaves a request and returns a step for the human, who opens the studio’s Economy tab (the shop is part of the game’s economy: it moves into the economy section and goes live with the rest of it) and approves in their wallet (a signature per new upload, then one approval for all the transactions). economy_publish is the same for an economy written with the economy_* tools.',
    inputSchema: { type: 'object', properties: { game }, additionalProperties: false },
    handler: async (input, ctx) => result(await call('shop', 'publish', { game: input.game }, ctx)),
  },
];

export default tools;
