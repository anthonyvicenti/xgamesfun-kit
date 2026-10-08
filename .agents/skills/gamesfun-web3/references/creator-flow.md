# What the creator approves, and what it costs (devnet)

Everything is built on the human's machine with their RPC (`gamesfun web3 settings --rpc`, default
the public devnet RPC). Their wallet signs in the studio page, which is a real Chrome page on
127.0.0.1, so wallet extensions work. The studio shows each step and what it touches before the
wallet asks.

## Launch a token (Token tab, or `web3_prepare_launch`)

1. **Upload the picture** to Arweave through Irys: one `signMessage`. It moves no funds and is free
   up to 100 KB. Over that, the wallet first approves a small SOL deposit to its Irys balance.
2. **Upload the token details** (name, symbol, description, image): one `signMessage`.
3. **One transaction**: the Meteora DBC `createPool` on games.fun's config `antisnipe-v1`, quoted in
   **MAIN-dev**, with partner fees to games.fun. The wallet becomes the pool creator. A fresh base-mint
   address signs too. Its one-time key lives in memory and is then dropped. Rent and fees come to
   about 0.03 SOL.
   - **Optional initial buy in MAIN-dev**, in the same transaction, so nobody buys first. The
     minimum the creator receives comes from a dry run of that exact transaction, minus 0.5%. The
     buy must stay below the curve's graduation amount (48,050 MAIN-dev), and the wallet must
     already hold the MAIN-dev. Paying the initial buy in SOL is not built yet.

The name, ticker and picture are permanent.

## Put the shop on sale (Shop tab, or `web3_prepare_publish`)

1. **Uploads**, one `signMessage` each: every new item picture, the collection details (the first
   time only), and the details of every new or changed item. Items whose details didn't change (a
   price or supply change) skip this step.
2. **One approval for every transaction** (up to 12; the wallet signs them together):
   - the first time: the Core collection (the creator's wallet is its update authority, with a 5%
     resale royalty to them; a fresh collection address signs once), the creator's treasury account,
     and `create_game` on the loot program, priced in the chosen currency (fixed from then on);
   - `upsert_item` for each new or changed item, then `upsert_box` for each box whose items are on
     sale.
3. What lands is written to `gamesfun.json` as it lands. If a later transaction fails, the earlier
   ones stay recorded, and the next publish carries on.

## Player purchases (in the game, not the studio)

A buy is one approval. A box is two (pay and roll, then claim). The loot program keeps 5%, and the
creator's treasury receives the rest in the shop's currency (wrapped SOL for a SOL shop).
