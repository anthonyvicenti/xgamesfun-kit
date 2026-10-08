# gf-web3 API (`gf/web3/index.js`, version 1.0.0)

```js
import gfWeb3 from './gf/web3/index.js';   // from rules.js; create and upgrade keep gf/web3/ current
```

| Call | Returns | Notes |
| --- | --- | --- |
| `ready()` | the cleaned `gamesfun.json` | Reads `./gamesfun.json` once. Never throws: a missing or bad file gives an empty setup. |
| `mock`, `address`, `config`, `VERSION` | getters | `address` is null for a guest |
| `connect()` | the player's address | Opens the wallet picker when there are several wallets. Throws "No Solana wallet found…" or "No wallet chosen." |
| `disconnect()` | | |
| `signIn({ statement? })` | `{ address, message, signature, mock }` | A Sign In With Solana message signed with `signMessage`. This is client-side proof only. Nothing verifies it on a server yet. |
| `ownedItems()` | `[{ id, name, description, rarity, look, image, serial, asset }]` | This game's collection only. `[]` for a guest. |
| `owns(idOrName)` | boolean | |
| `shop.list()` | `[{ id, name, description, rarity, look, image, price, priceText, currency, forSale }]` | Listed items only. `price` is in base units. `forSale` is false for items only in boxes. |
| `shop.buy(idOrName)` | `{ item, asset, signatures, mock }` | One wallet approval |
| `boxes()` | `[{ id, name, price, priceText, odds: [{ id, item, chance }] }]` | `chance` is 0–1 |
| `openBox(id, { onStatus })` | `{ item, asset, order, signatures, mock }` | Two approvals (pay and roll, then claim). A failed roll throws after the refund. |
| `token()` | `{ mint, name, symbol, decimals, source, … }` or null | |
| `loadout(items)` | `{ loadout, worn }` | Pure. One item per slot. |
| `wear(items?)` | `{ loadout, worn }` | Sets `window.__GF_LOADOUT` (gf-three applies it). Remembered per game and wallet. |
| `wearOwned()` | `{ loadout, worn }` | The remembered choice, else every owned item (the rarest wins a slot) |
| `on(event, fn)` | an unsubscribe function | Events: `wallet` (address or null), `items` (a new item), `status` (text for the player), `loadout` |
| `configure({ rpc?, config?, mock? })` | | `rpc` must be keyless https |

URL switches: `?gamesfun_mock=1` turns the mock on. `?gamesfun_mock=0` forces the real chain.
`?gamesfun_owned=1,2` gives the mock wallet owned items.

`createGfWeb3(options)` makes a separate instance (for tests). The options are `{ config, configUrl,
fetchImpl, location, navigator, wallets, mock, rpc, storage, win }`.

## gamesfun.json (what the kit reads)

```json
{ "version": 1, "network": "devnet", "creator": "<wallet>",
  "token": { "mint": "…", "name": "Bean Brawl", "symbol": "BEAN", "decimals": 6, "program": "spl-token", "source": "launched", "pool": "…" },
  "shop": { "name": "Bean Brawl Items", "collection": "…", "game": "…", "treasury": "…",
            "currency": { "mint": "So111…112", "symbol": "SOL", "decimals": 9, "native": true },
            "items": [{ "id": 1, "name": "Golden Hat", "rarity": "Rare", "price": "50000000", "maxSupply": 0, "soulbound": false,
                        "look": { "values": { "character.tint.player": "#ffcc00" }, "files": {} },
                        "picture": "assets/hat.png", "image": "https://devnet.irys.xyz/…", "uri": "https://devnet.irys.xyz/…", "listed": true }],
            "boxes": [{ "id": 1, "name": "Mystery Box", "price": "10000000", "entries": [{ "item": 1, "weight": 60 }], "listed": true }] } }
```

The full schema is in `web3/gamesfun.schema.json` in the kit.
