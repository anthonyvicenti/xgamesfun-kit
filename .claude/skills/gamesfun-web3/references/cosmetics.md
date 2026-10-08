# The cosmetics loop: own it, wear it, everyone sees it

An item's `look` is a **gf-three loadout fragment** (gf-three CONTRACT §6e). It holds the player-look
slots that owning the item changes:

```json
{ "values": { "character.tint.player": "#ffcc00", "mechanic.projectile.color": "#2457ff" },
  "files":  { "character.hat.player": "assets/models/hat-gold.glb" } }
```

- **Slots.** These are the game's `scope: "player"` slots. Ask `web3_player_looks`, or read
  `assets.json`. Every gf-three game has `character.tint.player` (body colour),
  `character.hat.player` and `character.body.player` (models), and each aimed mechanic's
  `mechanic.projectile.color`.
- **Values.** A colour is `#rrggbb`. A number, a toggle or an enum option is also allowed.
- **Files.** A file is a path inside the game, or an https URL every player can load. A body has to
  be a gf-humanoid-1 rig. `data:` and `blob:` URLs are refused.

## Wear what the player owns

In `rules.js` (game code never goes in `main.js`, `index.html` or `gf/`):

```js
import gfWeb3 from './gf/web3/index.js';

export default {
  setup(ctx) {
    const wear = () => gfWeb3.wearOwned().catch(() => {});
    gfWeb3.ready().then(() => gfWeb3.address && wear());
    gfWeb3.on('wallet', (address) => address && wear());   // after the player connects (see buy-button.md)
    gfWeb3.on('items', wear);                               // after a buy or a box opens
  },
};
```

`wearOwned()` sets `window.__GF_LOADOUT`. gf-three's `kit/net/looks.js` applies it to this player, and every
other copy in the match draws it too (the `lk`/`lo` loadout messages). You write no multiplayer code for this.
`ctx.looks.apply(loadout)` is the same thing from inside the rules, so
`ctx.looks.apply((await gfWeb3.wear(ids)).loadout)` works too.

- **One item per slot.** With no choice made, the rarest owned item wins each slot. To let the
  player choose, call `gfWeb3.wear([itemId, …])`. Their order wins, and the choice is remembered per
  game and wallet.
- **Invalid looks are dropped.** gf-three checks the loadout against the game's slots again and
  drops anything that doesn't fit (P4: never fatal).
- **Guests** wear the game's defaults. `ownedItems()` returns `[]` for them.

## Making a look exist

When an item should change something the game doesn't have yet (a rainbow skin, a trail), add a
player-look slot to the game first (gf-three CONTRACT §6e: `config/game.json` → `loadout.slots`,
`tools/slots.mjs`). Then set the item's look to it with `web3_update_item`. Once players own copies,
an item's look can't change. Make a new item instead.
