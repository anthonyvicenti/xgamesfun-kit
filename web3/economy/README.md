# web3/economy: a game's economy as one spec

A game's economy is the `economy` section of its `gamesfun.json`. It says what the game's money and collectibles are, where they flow, and which rules run by themselves on games.fun's loot program 0.3 (devnet). The schema is `economy.schema.json`; `fixtures/coin-flip-arena.json` is a whole example.

Plain ES modules, no build step, no dependencies. Nothing here signs or talks to the chain. (The schema landed first; the tools in the table land in the commits after it.)

| File | Does |
| --- | --- |
| `economy.schema.json` | the spec's shape |
| `validate.mjs` | checks a spec against the schema (no schema library needed) |
| `check.mjs` | refusals (each with a code, what it means and the fix) and warnings |
| `simulate.mjs` | the quick simulation: what each box, ticket and craft is worth, how long each pool lasts, who pays what |
| `cost.mjs` | what going live costs: each account's rent, each call's fee, network fees |
| `compile.mjs` | the setup plan: the program's instructions in order, split into transactions that fit; `diff` for a change |
| `migrate.mjs` | today's `shop` section → an `economy` section |
| `slots.mjs` | every number in the spec as a value slot |

From a terminal: `npx gamesfun economy check|simulate|cost|plan [game-dir]` (add `--json` for machines).

## How to write one

- **Amounts are in whole units of their currency**: `0.1` is 0.1 SOL, not lamports. Write `"0.1"` as text when it must be exact.
- **Shares are percents**: `2.5` is 2.5%. The program counts hundredths of a percent, so at most two decimals.
- **Times are durations**: `"45s"`, `"30m"`, `"6h"`, `"7d"`, `"2w"`, or seconds. A start is `"publish"`, `"publish+7d"` or a date like `"2026-11-01T18:00:00Z"`.
- **Every part has a `key`** (lower case, digits, dashes). Other parts name it: a box pays from `"pool": "house"`, a split sends to `"pool:house"`. Slots use it too: `economy.box.flip.price`.
- **Ids are the program's.** `id` on items, boxes, recipes, schedules, lotteries and stakes, and `index` on pools, are written when the economy goes live. Leave them out in a new spec and never change them after.

## The parts

| Part | What it is | Who acts at play time |
| --- | --- | --- |
| `tokens` | the currencies. `sol`; `curve` (the game's token on games.fun's curve); `existing` (any mint by address: classic or Token-2022, pump.fun included); `game` (a token the game mints itself: points, tickets, shards) | |
| `currency` | the game's own currency: shop prices and the treasury | |
| `collection`, `items` | the collectibles (minted to the player) and normal items (kept by the game's backend), with supply, price, a price that rises or falls, and a `life` (ready after, lasts, uses, cooldown) | the player buys |
| `pools` | vaults only the game can spend from: prizes, pots, rewards. `seed` is what the creator puts in at the start | |
| `boxes` | a paid roll: an item, a prize from a pool, a share of a pool (a jackpot), a burn of the payment, or nothing | the player opens; anyone settles |
| `payments` | a player pays for something the game gives off chain (an attempt, an entry), split as it says | the player |
| `recipes` | collectibles and tokens in, collectibles and tokens out: merges, salvage, an exchange, breeding, a daily claim | the player |
| `schedules` | on a timer: mint into a pool, burn a share of a pool, or move a share between pools | anyone |
| `lotteries` | tickets into a pot, a draw on a timer, up to 8 places | players buy; anyone draws and pays |
| `stakes` | players lock a token and share what arrives in a rewards pool | the player |
| `contests` | players back a side; the side the authority names shares the pot | players enter; the authority opens and decides |
| `holds` | a player hands a collectible to the game for a time; the authority says where it goes | the player, then the authority or anyone |
| `decisions` | the authority's rules in words: what only the game knows (who cleared the level) and what the program then does | the authority |
| `keys.authority` | who signs the decisions: `"owner"` (the creator's wallet) or another wallet's public address | |
| `scenario` | what the quick simulation assumes: how many of each a day | |
| `live` | addresses written when it goes live | |

A **split** is up to four shares of a payment, each `{ "to": ..., "percent": ... }`, where `to` is `"burn"`, `"pool:<key>"`, `"account:<token account>"` or `"holder:<collectible address>"`. What the shares leave goes to the treasury.

A **box's outcomes** each have a `chance` (percents that add up to 100) or each a `weight` (whole numbers, as the program keeps them). `gives` is `item` (with `item`), `pay` (with `pool` and `amount`), `share` (with `pool` and `percent`), `burn` or `nothing`. The payment is split as the box says, except on `burn`, which burns all of it.

## What the program does that a spec must respect

Read `launchpad/loot/PROGRAM-0.3.md` in games.fun for the whole program. The checker enforces the parts a creator can trip on: a stake takes everything in its rewards pool, so that pool is its alone; wrapped SOL cannot be burned; a box or payment in a currency other than the game's must send all of it somewhere (the treasury only holds the game's currency); a lottery's cut only works in the game's currency; a stake and a contest cannot be edited once open; the authority signs every payout, so a rule that pays out needs the authority at play time.

## Fees

The program charges two flat fees in SOL: **0.002 SOL** when a player signs for something of their own (`pay`, `buy_item`, `open_box`, `buy_tickets`, `stake`, `unstake`, `craft`, `hold`, `enter`), and **0.00001 SOL** for everything else that is charged (`deposit`, `payout`, `burn`, `issue`, `make`, `unmake`, `set`, `roll`, `award`, `open_contest`, `decide`). Setting the economy up (`create_game`, `open_pool`, the `upsert_*` calls, `open_stake`) pays rent and network fees only. Finishing what is already decided (`settle`, `run_schedule`, `draw_lottery`, `pay_lottery`, `claim`, ...) is free.
