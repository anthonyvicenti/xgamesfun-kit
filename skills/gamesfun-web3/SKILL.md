---
name: gamesfun-web3
description: Add Solana devnet items, loot boxes, a shop and a token to a games.fun gf-three game. Use when the user asks for NFTs, items, cosmetics, skins, a shop, loot boxes, a token or wallet sign-in in their game, or when a game's gamesfun.json, gf/web3 kit or `gamesfun web3` command comes up.
---

# Web3 for a games.fun game (devnet)

A game can have a **token**, a **shop** of collectible items (Metaplex Core NFTs) and **loot boxes**
rolled on chain with MagicBlock VRF. Players can play as **guests**. A wallet is optional and only
adds cosmetics they own. Everything runs on **Solana devnet**. This kit has no mainnet.

There are two halves. You prepare both. The human approves anything that signs.

| Half | Who | Where |
| --- | --- | --- |
| Set up the token, items, boxes and prices | Creator: you draft, and the human approves in their wallet | `gamesfun web3 …` (CLI), the `web3_*` MCP tools, or the studio's **Token** and **Shop** tabs |
| Use them in the game: sign-in, owned looks, buy and open buttons | Players, through game code you write | The in-game kit `gf/web3/index.js` (`gf-web3`), which reads the game's `gamesfun.json` |

## Rules (always)

1. **You never sign, and you never ask for keys.** Launching a token and putting the shop on sale
   leave a **request**. Tell the human to open the studio (`npx gamesfun dev games/<name>`), go to the
   Token or Shop tab, press **Review and approve**, and confirm in their wallet. Never ask for a seed
   phrase, a private key or a keypair file. If they decline, don't repeat the request.
2. **Never put a secret in a game.** A game folder is public: `gamesfun.json`, game code, pictures.
   That rules out private keys, seed phrases, API keys and keyed RPC URLs (`?api-key=`, Helius,
   QuickNode). The creator's RPC goes in `gamesfun web3 settings --rpc <url>` (the kit's git-ignored
   `.gamesfun/`). See `references/secrets.md`.
3. **Guests play.** Never block a game on a wallet. Ask for one only when the player presses
   Connect, Buy or Open.
4. **Don't hand-edit addresses in `gamesfun.json`.** Change it through the CLI, the MCP tools or the
   studio. Reading it keeps only valid public fields. Schema: `web3/gamesfun.schema.json`.
5. **Ownership is read from the chain, and loadouts are trusted on the client for now.** That's fine
   for cosmetics. Don't sell power: an item changes how a player looks, not how the game is scored.

## Do this

- Add web3 to a game, wire the kit, and draft a shop: `references/add-web3.md`
- Make cosmetics a player owns show in the game, for everyone in multiplayer:
  `references/cosmetics.md`
- Add buy and open-box buttons: `references/buy-button.md`
- Test with the mock, then with a real wallet: `references/testing.md`
- The full in-game API: `references/api.md`
- What each creator step costs and asks the wallet: `references/creator-flow.md`
