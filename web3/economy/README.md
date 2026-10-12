# web3/economy: a game's economy as one spec

A game's economy is the `economy` section of its `gamesfun.json`. It says what the game's money and collectibles are, where they flow, and which rules run by themselves on games.fun's loot program 0.3 (devnet). The schema is `economy.schema.json`; `fixtures/coin-flip-arena.json` is a whole example. It replaced the old `shop` section, and the studio's Economy tab replaced the Token and Shop tabs (a shop is part of the economy; launching the game's token is one of its parts).

Plain ES modules, no build step, no dependencies. Nothing here signs or talks to the chain.

## What a creator does

From a sentence to a live economy, on devnet, without ever handing anyone a key:

1. **Say it.** "A coin-flip arena: 2% house edge to people who stake, and a weekly lottery fed by 10% of every flip." The agent (the `gamesfun-economy` skill) starts from the nearest of the 100 ideas (`ideas.json`) and writes the spec, keeping the sentence in `prompt`. Or build it by hand in the studio's **Economy tab**.
2. **Read what it does.** The checker refuses what the program cannot do (each refusal names its fix) and flags chance that pays tokens; the quick simulation says what each play costs and is worth and how long each pool lasts; the cost says what going live costs. The agent tells it in plain words (`economy_explain`); the Economy tab shows the same beside the parts.
3. **Change it until it is right.** "Make the house edge 3%", "a bigger seed": change, check, simulate again. Every number is a slot (`slots.mjs`).
4. **Save it** into the game's `gamesfun.json`: `economy_save` writes only a spec that checks; the tab saves a moment after each change, once it has the schema's shape.
5. **Put it live.** The agent hands over the studio link (`economy_publish`); the creator opens the Economy tab, looks over every step and its cost, presses **Put it live** and approves in their own wallet. What lands is written back as it lands.
6. **Play it.** The game shows the economy's buttons in the kit's own menu and HUD (a buy, a box, tickets, a stake, a claim), offered by the page that hosts the game, which signs with the player's wallet. The game's code holds none of it.
7. **Watch it and decide.** `economy status` (and the tab) shows each part on chain, the pools and the recent receipts. A rule only the game can judge (a payout, a contest's winner) is signed by the authority; preparing those for the creator's wallet exists (`economy_decide`), the page that signs them comes next (K4).

## What is here

| File | Does |
| --- | --- |
| `economy.schema.json` | the spec's shape |
| `validate.mjs` | checks a spec against the schema (no schema library needed) |
| `check.mjs` | refusals (each with a code, what it means and the fix) and warnings |
| `simulate.mjs` | the quick simulation: what each box, ticket and craft is worth, how long each pool lasts, who pays what |
| `cost.mjs` | what going live costs: each account's rent, each call's fee, network fees |
| `compile.mjs` | the setup plan: the program's instructions in order, split into transactions that fit; `diff` for a change |
| `actions.mjs` | `playerActions(economy)`: what a player can do, as the buttons the kit draws (`{ id, part, kind, label, price, says, where, asks }`); `economyState(economy, reads, player)`: the state the page sends the game. Re-exports the in-game kit's `gf-web3/econ/actions.js`, so the tools and the game never disagree |
| `migrate.mjs` | an old `shop` section → an `economy` section: `migrateFile` (`gamesfun economy migrate --write`; `gamesfun upgrade` does it by default, `--dry-run` shows it; the publish flow, the Economy tab and `economyStatus` move a shop on read). The pure `migrateShop` is the in-game kit's (`gf-web3/econ/shop.js`, browser-safe), so gf-web3 reads an old shop through the same function (with `keepLive`, a shop gf-web3 2.0.0 already put on loot 0.3 stays live there) |
| `slots.mjs` | every number in the spec as a value slot |
| `ideas.json` | the 100 economies of games.fun's `research/gf-economy/ECONOMIES-100.md`, each with how it fits loot 0.3 (`economy_examples` searches them) |
| `fixtures/` | eleven whole economies on real devnet addresses (below) |
| `evals/` | the 20 frozen prompts for the agent (`cases.json`), reference specs and `score.mjs` (the `gamesfun-economy` skill's `references/evals.md`) |
| `model.mjs`, `steps.mjs`, `txsize.mjs`, `idl.mjs` | the shared parts: units and the program's numbers; one setup step per instruction; transaction sizes; loot 0.3's IDL (`loot-0.3.json`, trimmed from the deployed program's) |

**From a terminal:** `npx gamesfun economy check|simulate|cost|plan|migrate|publish|status [game-dir]` (`--spec <file>` for a spec outside a game, `--json` for machines). `publish` never signs: it leaves a request and prints the studio link where the creator's wallet approves it (`--picture <file>` for a token launched on games.fun's curve with it). `status` reads the economy back from devnet. Being built: `economy check --devnet`, the same check read against devnet itself.

**The agent tools** (`mcp/tools/economy.mjs`, on with `GAMESFUN_WEB3=1`; skill `gamesfun-economy`): `economy_catalog` (the parts and their fields), `economy_examples` (the 100 ideas and the fixtures), `economy_check`, `economy_simulate`, `economy_cost`, `economy_explain` (the plain-words summary), `economy_save` (only a spec that checks; a live economy keeps its ids), `economy_publish` (the studio link; never signs), `economy_status` and `economy_decide` (a decision prepared for the creator's wallet). None signs or asks for a key.

**The Economy tab** (`studio/tabs/economy.js`, off unless web3 is on or the game has a `gamesfun.json`): the money flow drawn, the parts with every number editable, the quick simulation and the checker's notes beside them, the cost, **Put it live** (the `economy` flow below), then the live state and the receipts. Its routes (`web3/node/economy-routes.mjs`, under `/api/web3`): GET and POST `/economy` (read and save the spec), POST `/economy/check`, `/economy/simulate`, `/economy/cost`; `GET /economy/status` is `economyStatus`. `#economy?flow=economy` (the link `economy_publish` returns) opens it with Put it live offered.

**In the game** (gf-three CONTRACT §6g W2): the game's code holds no wallet or economy code. The page that hosts the game runs gf-web3, which reads this section and has one call per thing a player signs (`gfWeb3.economy.buy`, `openBox`, `pay`, `craft`, `buyTickets`, `stake`, `unstake`, `hold`, `enter`, `claim`, and `act(id)` for any entry of `playerActions`; the reads `actions()`, `state()`, `pools()`, `boxOdds()`, `lottery()`, `stakePosition()`, `contest()`, `receipts()`; `skills/gamesfun-web3/references/api.md`). The page offers the actions to the game in `gf:host` → `economy.actions` and its state in `gf:economy`; the kit's menu, pause menu, results card and HUD draw them, and a click comes back as `gf:econ-action`. The studio preview's side of that bridge is being built. `tests/web3/devnet/play.mjs` plays a small economy on devnet through `gfWeb3.economy` only (`play-result.json`).

## Going live (`web3/node/economy.mjs`, `web3/node/flows.mjs`)

- `planToInstructions(plan, ctx)` turns each plan step into a real instruction with the kit's builders (`gf-web3/chain/loot.js` `lootIx`, Core, SPL, Metaplex): names become addresses, decimal strings bigints, `{ Pool: 3 }` the codec's `{ Pool: [3] }`, a Token-2022 deposit gets its `transferExtras`.
- Flow kind `economy` (`POST /api/web3/flow/start { kind: 'economy', wallet }`; the old `publish` starts it too) puts everything the economy still needs live: a token launched on the curve first (its own uploads and transaction), item pictures and details to Arweave, then every setup transaction in one wallet approval (more only when it takes more than 12). Each transaction is written to `gamesfun.json` as it lands: each part's program id, a new token's mint, `live.game`, `live.collection`, `live.treasury`, `live.at`, `live.transactions` (signatures) and `live.published`, the spec as it is on chain. The next publish sends only `diff(live.published, spec)`; "publish" in the spec always means `live.at`.
- `economyStatus(gameDir, opts)` and `GET /api/web3/economy/status`: each part on chain or not and whether it still matches the spec, each pool's balance, the recent receipts.
- Devnet proof: `tests/web3/devnet/economies.mjs` puts every fixture live through the same flow and reads it back (`economies-result.json`).

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

## The setup plan (`compile.mjs`)

`compile(spec)` returns `{ ok, program, before, transactions, play, warnings, notes }`, or `{ ok: false, refusals }`.

- `transactions`: `[{ signer, signers, bytes, says, steps }]`, in order. Each is one wallet signature's worth; `signer` is `owner` (the setup) or `authority` (a seed of a token the game mints, when the authority is another key).
- A step: `{ id, program, ix, args, accounts, signer, signers, says, data, creates }`.
  - `program` is `loot` for loot 0.3, where `ix` and the names in `args` are exactly the IDL's (`upsert_box` with `box_id` and `args: { price, currency, rise, fall, stock_odds, active, shares, entries }`). Other steps are `system`, `spl-token`, `associated-token`, `mpl-core` and `mpl-token-metadata`.
  - In `args`, a u64 is a decimal string in base units; a pubkey is an address, or `@<name>` for one that exists only after an earlier step (`@mint:points`, `@wallet:owner`, `@pda:game`); an enum is `{ Variant: fields }`, `{ Variant: {} }` without fields, `{ Pool: 3 }` with one unnamed field.
  - `accounts` maps the IDL's account names (nested ones flattened, `fee.platform`) to names that stand for one address each: `wallet:owner`, `pda:game`, `pda:pool/0`, `pda:item/3`, `mint:<token key>`, `ata:owner/<token key>`, `new:collection` (a key made for this setup; it signs), `program:system`.
  - `data` is the instruction data's size in bytes; `creates` lists the accounts it opens and their bytes (for the rent).
- `before`: steps outside this plan (a token launched on games.fun's curve has its own approval).
- `play`: what each part needs while the game runs: `{ part, ix, signer, says }` (`open_box` by the player, `settle_prize` by anyone, `decide` by the authority).
- Sizes never come out below the real transaction: every account is counted once per name, loot data is sized from the IDL byte for byte, no lookup tables. Transactions are packed to 1,168 bytes, leaving 64 of the network's 1,232 for the wallet's own compute-budget instructions.

`diff(liveSpec, newSpec)` returns the same shape with only what a change needs: parts keep their program ids by key, a removed item, box, recipe or schedule is switched off (the program has no close for them), a removed pool is closed, a bigger seed deposits the difference. It refuses what the program cannot change: an open stake (`E-STAKE-FIXED`), a pool's token (`E-POOL-FIXED`), the game's currency (`E-CURRENCY-FIXED`).

## The fixtures

Ten economies from `research/gf-economy/ECONOMIES-100.md` (games.fun) and the coin-flip arena of `KIT-PLAN.md` §1. The tests check, simulate and compile all of them.

| Fixture | From the list | What it exercises |
| --- | --- | --- |
| `coin-flip-arena` | KIT-PLAN §1 (#61) | a box that pays from a pool, a split into three pools, a lottery with three places, a stake on a curve token |
| `blind-forge` | #1, #8 | a Token-2022 coin with a 1% transfer fee; a box of items with a rising price and stock odds; a lottery with a cut |
| `spark-pity` | #2 | two tokens the game mints; a recipe that pays SOL into a pool and mints both; a box priced in a game token whose split burns it all; a prize from a pool; a recipe that burns 90 Sparks for an item |
| `halving-seasons` | #81, #6, #96 | a schedule that mints with a halving and a run limit; a schedule that moves a share between pools; a soulbound pass with a cooldown, used by a recipe that pays from a pool; a stake |
| `scorched-treasury` | #14 (needs the authority) | a schedule that burns a share; a seed; a payment into a pool; the authority's payouts |
| `merge-2048` | #21 | an existing pump.fun-style mint (a devnet stand-in: classic SPL, 6 decimals, no mint or freeze authority); recipes that burn two for one; a share of a pool as a craft's prize |
| `stud-farm` | #31, #19, #26 | uses and a cooldown, ready-after and lasts; a recipe that uses, burns and pays the stud's holder; needs and keeps; renew |
| `sacrifice-raffle` | #15, #67 | recipes that burn an item for minted tickets; a lottery whose tickets are another token (burned) with eight places |
| `falling-drop` | #92, #40, #74, #20 | a price that falls, a price that rises, payments with a share to an account, a share that burns |
| `duel-arena` | #69, #47 (needs the authority) | a contest with a share for a collectible's holder and a burn; a hold; decisions signed by a separate authority key |
| `starforce` | #22 | a recipe that gives an attempt token; a box in that token whose outcomes are an item, the same item again, a burn, and a share of the jackpot |

Every address is a real devnet one: USDC-dev, MAIN-dev, the Token-2022 coin of the 0.3 devnet run (`7MJWx2u…`), and the accounts `tests/web3/devnet/economies.mjs --make-fixtures` made on 2026-10-12 (`economies-fixtures-result*.json`): the pump.fun-style TILE mint `Cywvs…`, the stud `3rzrH…` and the arena deed `9rAE9…` (Core collectibles held by test wallets), the partners' accounts (the launchpad partner wallet's wrapped SOL `6U3Xn…`, a test wallet's MAIN-dev `3pVhH…`) and the duel arena's authority, the launchpad keeper wallet `Hby5B…`. No fixture needs a secret.

## Where it stands (the phases of games.fun's `research/gf-economy/KIT-PLAN.md`)

| Phase | Built | Not yet |
| --- | --- | --- |
| K0, the program and the old shop | the kit on loot 0.3 (devnet `88Labq6t…`), Token-2022 allowed; devnet proof `tests/web3/devnet/loot-0.3.mjs`, 9 of 9 steps on 2026-10-11 (its script now goes through the economy; not run again since) | the CI devnet run |
| K1, the spec and its tools | everything in the tables above; every fixture went live on devnet through the economy flow (`economies-result.json`, 13 of 13) | `economy check --devnet` (being built) |
| K2, economies in games | the in-game calls (`gfWeb3.economy`, devnet play proof `play.mjs`, 12 of 12); the kit's menu and HUD draw offered actions (gf-three §6g W2, verify check 22: built in games.fun on a branch, not yet in this checkout's `kits/`) | W2 in `kits/` (the next kit sync); the studio preview's side of the page bridge (being built); an example game of each kind carrying an economy |
| K3, the agent and the page | the `economy_*` tools, the `gamesfun-economy` skill, the Economy tab, the 20 frozen evals | the build loop learning the economy (pitch, spec, deliver); a scored eval run |
| K4, decisions | decisions prepared for the creator's wallet (`economy_decide`) | the page that signs them, the local keeper, the full simulation |

The kit's `playerActions` also lists a `pay` action for a payment part; gf-three's W2 offer accepts nine kinds without `pay`, so the kit's menu drops it until one of the two changes.
