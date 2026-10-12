# What the creator approves, and what it costs (devnet)

Everything is built on the human's machine with their RPC (`gamesfun web3 settings --rpc`, default
the public devnet RPC). Their wallet signs in the studio page, which is a real Chrome page on
127.0.0.1, so wallet extensions work. The studio shows each step and what it touches before the
wallet asks.

## Launch a token (the token part of the Economy tab, or `web3_prepare_launch`)

A token on games.fun's curve is one part of the game's economy (`tokens` → `source: "curve"`). When the economy goes
live, it launches first, in its own approval; the Economy tab's token part can also launch it alone.

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

## Put the economy live (the Economy tab's "Put it live", `economy_publish`, or the old `web3_prepare_publish`)

`economy_publish` (and `npx gamesfun economy publish`) only checks the saved spec, adds up the cost and hands over the
studio link (`#economy?flow=economy`). The creator opens the Economy tab, looks it over, and presses **Put it live**
(**Put the changes live** once it is live). A game that still has an old `shop` has it moved into its economy first,
so `web3_prepare_publish` leads to the same flow. Then:

1. **A token launched on games.fun's curve**, when the economy has one that isn't live yet (above).
2. **Uploads**, one `signMessage` each: every new item picture, the details of every new or changed item, and the
   collection's details (the first time only). Items whose details didn't change (a price or supply change) skip this.
3. **One approval for every setup transaction** (the wallet signs them together; more than one approval only when it
   takes more than 12 transactions):
   - the first time: the Core collection (the creator's wallet is its update authority, with the royalty the spec
     says), the creator's treasury account, and `create_game` on the loot program 0.3, priced in the economy's
     currency (fixed from then on). The creator's wallet is the game's owner (settings and catalog) and, unless the
     spec names another key, its authority (payouts and decisions);
   - then every part: pools and their seeds, tokens the game mints, items, boxes, recipes, schedules, lotteries and
     stakes (a contest is opened by the authority while the game runs).
4. What lands is written to `gamesfun.json` as it lands (`economy.live`: the game, collection, treasury, each part's
   id, the signatures, and `live.published`, the spec as it is on chain). If a later transaction fails, the earlier
   ones stay recorded, and the next publish carries on. A later change sends only the difference; the checker refuses
   what the program cannot change (an open stake, a pool's token, the currency).

`economy_cost` says what going live costs before anyone signs: each account's rent, each call's fee, network fees.

## What players sign (in the game, through the page)

The page that hosts the game signs a player's moves with their wallet when they press an economy button in the kit's
menu (`buy-button.md`). A buy is two approvals (pay, then claim); a box is two (pay and roll, then claim); a ticket,
a stake, a craft, a hold or an entry is one. Each payment goes where the spec's split says, the rest to the creator's
treasury (wrapped SOL for a SOL economy; a Token-2022 coin's own transfer fee, if it has one, is kept by the token).
games.fun's loot program charges the player a flat 0.002 SOL, in SOL, for each thing they sign for themselves, on top
of the price.
