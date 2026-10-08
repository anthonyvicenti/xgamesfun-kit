# Testing web3 in a game

## The mock: automatic in verify and headless browsers

`gfWeb3.mock` is `true` and nothing touches the network when:

- the page is automated or headless (`navigator.webdriver`, HeadlessChrome), so **`gamesfun verify`
  stays deterministic**;
- the URL has `?gamesfun_mock=1`.

In the mock:

- `connect()` returns a pretend address and `signIn()` a pretend signature.
- `shop.list()` and `boxes()` come from the real `gamesfun.json`.
- `shop.buy()` and `openBox()` succeed at once. Box rolls use the box's weights with seeded
  randomness, so the same run gives the same rolls.
- `?gamesfun_owned=1,2` (item ids or names) gives the pretend wallet items to start with, so you can
  check that `wearOwned()` changes the player and that every other player sees it.
- What the mock buys or opens is owned until the page reloads.

Use it to check that the buttons appear, the looks apply, errors show, and the game still runs for a
guest who never connects. Run `npx gamesfun verify games/<name> --quick` after wiring web3: the kit runs the mock
there, and verify's loadout leg (check 5) still has to pass.

## A real wallet on devnet

The human does this part. You can't approve a wallet prompt, and you must never ask for a key.

1. Run `npx gamesfun dev games/<name>`. It opens the studio in the human's own Chrome profile, where their
   wallet extension is. The game is at `/game/`. A normal Chrome window is not automated, so the mock is off.
   In an automated browser, add `?gamesfun_mock=0`.
2. Ask them to switch the wallet (Phantom, Solflare, Backpack…) to **devnet** and get devnet SOL
   (https://faucet.solana.com).
3. Have them connect, buy an item and open a box, approving each in the wallet. Then check the result
   with `gamesfun web3 status` and `gfWeb3.ownedItems()`.

## Limits of the public devnet RPC

Players read through `https://api.devnet.solana.com`. It rate-limits (about 100 requests per 10 s
per IP, 40 per method) and has no DAS API. `ownedItems()` makes one filtered `getProgramAccounts`
call over the collection's Core assets. Call it on connect and after a purchase, never every frame.
A game may set a public, **keyless** RPC with `gfWeb3.configure({ rpc })`. A keyed URL is refused,
because every player could read it.
