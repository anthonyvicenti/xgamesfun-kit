# Add web3 to a game

## 1. The kit is in the game

A game made with `npx gamesfun create` carries the in-game kit at `gf/web3/` (a copy of the kit's
`web3/gf-web3/`). A game made before that needs the folder copied in. Don't edit that copy. It's
the kit's, and it's updated as a whole.

```js
// main.js (or wherever the game boots)
import gfWeb3 from './gf/web3/index.js';
await gfWeb3.ready(); // reads ./gamesfun.json; never throws; an empty setup when there is none
```

A game with no `gamesfun.json` still loads. The shop is just empty.

## 2. Draft the setup (no signature needed)

Use the CLI or the MCP tools. Each changes only `gamesfun.json`:

```bash
npx gamesfun web3 status --game games/bean-brawl
npx gamesfun web3 currency SOL                     # or MAIN, USDC, token (the game's own), or a mint
npx gamesfun web3 item add --name "Golden Hat" --picture assets/hat.png --rarity Rare --price 0.05 \
  --look '{"values":{"character.tint.player":"#ffcc00"}}'
npx gamesfun web3 item add --name "Ice Skin" --picture assets/skin.png --rarity Epic   # no price: boxes only
npx gamesfun web3 box add --name "Mystery Box" --price 0.01                           # odds from rarity
```

The MCP tools are the same operations: `web3_status`, `web3_list_pictures`, `web3_player_looks`,
`web3_add_item`, `web3_update_item`, `web3_add_box`, `web3_set_currency`, `web3_link_token`.

- **Pictures** must be PNG, JPEG, WebP or GIF files inside the game folder (`web3_list_pictures`).
  Up to 100 KB is free on Irys devnet. A bigger picture asks the wallet for a small SOL deposit first.
- **What an item does in the game** is its `look`. Its slot ids come from `web3_player_looks`. See
  `cosmetics.md`.
- **Currency.** A shop needs no token. It can be priced in SOL or in any classic SPL token, and the
  price is fixed once the shop is live.
- **A token** is optional. To link an existing one, use `gamesfun web3 link --mint <address>`. To
  launch one, see step 3.

## 3. Ask the human to approve

```bash
npx gamesfun web3 launch --name "Bean Brawl" --symbol BEAN --picture assets/icon.png   # optional
npx gamesfun web3 shop publish
```

Or use `web3_prepare_launch` and `web3_prepare_publish`. Each one prints a step for the human. Relay
it as-is: "Open the studio's Shop tab and press **Review and approve**." The studio shows every step
before the wallet asks (`creator-flow.md`). Afterwards, `gamesfun web3 status` shows the items as
listed and on chain.

## 4. Use it in the game

- Owned cosmetics: `cosmetics.md`
- Buy and open buttons: `buy-button.md`
- Test it: `testing.md`
