# loot 0.3: Economy for Anything, the program

**Status (2026-10-11):** deployed to devnet (see "Not done, and open"); nothing on mainnet. The building blocks (recipes, holds, contests, new shares, rising prices, a collectible's life) were added the same day and reviewed three times by independent agents: a third review, a fourth that also checked the third's fixes, and a last check of the fourth's fixes. The fixes that came out of the last check (five, all small) are tested and not reviewed. After that the creator dropped game admins: a game has two keys, its owner and its authority. Then four more general pieces were added from the list of 100 economies (`research/gf-economy/ECONOMIES-100.md`): a price that falls with time, odds that shrink with stock, a prize that is a share of a pool, and a lottery with several places. They are tested (`tests/pieces.rs`) and were reviewed by a sixth agent (`tests/review_6.rs`): nothing lets a player or a stranger take funds; one Medium, two Lows and three notes were fixed, and the fixes are not reviewed. Last, every token role now takes Token-2022 (transfer hooks and transfer fees included), and the fee became two: 0.002 SOL when a player signs for something of their own, 0.00001 SOL for everything else (see "The fee" and "Token-2022"). Tested (`tests/token_2022.rs`) and reviewed by a seventh agent (`tests/review_7.rs`): nothing serious; its fixes are not reviewed.

## The whole program in one screen

A project is one record, a `Game`. Value moves in four ways, and each move writes a public receipt.

| Verb | Instructions | Who signs |
| --- | --- | --- |
| **In**: a player pays | `pay`, `deposit`, `buy_item`, `open_box` | the player |
| **Out**: a pool pays out or burns | `payout`, `burn` | the game's authority |
| **Make**: tokens and items are made | `issue`, `make`, `unmake`, `set` | the game's authority |
| **Decide**: the game names an outcome and the program carries it out | `award`, `open_contest`, `decide` | the game's authority |

**The authority is only needed for what only the game knows:** who cleared the level, who won the match. Everything the chain can decide by itself runs without it. The owner writes a mechanic once, and after that players and anyone at all carry it out:

| Mechanic | What it does | Written by the owner | Then sent by |
| --- | --- | --- | --- |
| **Box** | a weighted roll that gives an item, pays a prize from a pool, burns the payment, or gives nothing | `upsert_box` | the player (`open_box`), then anyone (`settle`, `settle_prize`) |
| **Schedule** | mints into a pool, burns a share of a pool, or moves a share between pools, on a timer | `upsert_schedule` | anyone (`run_schedule`) |
| **Lottery** | tickets into a pot, a random draw on a timer, up to 8 places that each take a share of the pot | `upsert_lottery` | players (`buy_tickets`), then anyone (`draw_lottery`, `pay_lottery`) |
| **Stake** | players lock a token and share what flows into a rewards pool | `open_stake` | the player (`stake`, `unstake`) |
| **Recipe** | collectibles and tokens in, collectibles and tokens out: a merge, a shop in any currency, a salvage, a breeding, an exchange at a fixed rate | `upsert_recipe` | the player (`craft`) |
| **Hold** | a player hands a collectible to the game for a time they choose; while it runs the authority says where it goes | nothing to write | the player (`hold`), then the authority (`award`) or anyone (`take_back`) |
| **Contest** | players put money on a side; the side the authority names shares the pot | the authority opens one (`open_contest`) | players (`enter`), the authority (`decide`), then anyone (`claim`, `call_off`, `close_contest`) |

Chance comes from MagicBlock's VRF oracle: box rolls, lottery draws, and `roll`, which gives the authority a labelled random number for any rule of its own.

A project has two keys, its owner and its authority (the creator: "I think we only need 2"), and both are trusted, as is whoever controls its collection ("we always trust project auth"). The program keeps players safe from each other, from the platform and from mistakes, not from the project they chose to play. Within that, who signs is the whole security model:

- A player signs what they pay, and the most they agree to pay.
- The game's **authority** key signs everything that leaves a pool or gets made on the game's say-so. The program checks that signature and nothing else. There are no caps. It cannot pay out of the vaults that hold open orders, a stake's vaults or a contest's pot, and it cannot move a held collectible once its hold is over. In a contest it writes the terms every entry signs, and names the winning side.
- The game's **owner** signs its settings and writes every mechanic, because a mechanic can move a pool or mint. It also writes the catalog: every item and box.
- The platform signs only its own fee (setting it, collecting it) and the suspend switch. Nothing it can sign stops a payout, a settle, a refund or an unstake.
- Anyone may finish what is already decided: `settle`, `settle_prize`, `refund`, `run_schedule`, `draw_lottery`, `pay_lottery`, `take_back`, `claim`, `call_off` (once a contest's result is overdue), `close_contest`, `recheck_token`.

## Where to read

Read `lib.rs` first: it lists every instruction under its group. Each mechanic is one file that reads top to bottom: its account, then its instructions.

| File | What is in it |
| --- | --- |
| `src/lib.rs` | every instruction, grouped; the security model in its header |
| `src/state.rs` | the five core accounts, then their tests |
| `src/rail.rs` | the fee, the split, and the one function that sends a share where it says |
| `src/tokens.rs` | the five token moves the program makes, each one call |
| `src/receipts.rs` | every receipt |
| `src/instructions/pay.rs` | `pay`, `deposit` |
| `src/instructions/payout.rs` | `payout`, `burn` |
| `src/instructions/make.rs` | `issue`, `make`, `unmake`, `set` |
| `src/instructions/roll.rs` | `roll`, `callback_random` |
| `src/instructions/order.rs` | `buy_item`, `open_box`, `callback_roll` |
| `src/instructions/settle.rs` | `settle`, `settle_prize`, `refund` |
| `src/instructions/schedule.rs` | `upsert_schedule`, `run_schedule` |
| `src/instructions/lottery.rs` | `upsert_lottery`, `buy_tickets`, `draw_lottery`, `callback_lottery`, `pay_lottery` |
| `src/instructions/stake.rs` | `open_stake`, `stake`, `unstake` |
| `src/instructions/craft.rs` | `upsert_recipe`, `craft` |
| `src/instructions/hold.rs` | `hold`, `take_back`, `award` |
| `src/instructions/contest.rs` | `open_contest`, `enter`, `decide`, `call_off`, `claim`, `close_contest` |
| `src/asset.rs` | reading a collectible: who holds it, which item it is one of, the numbers written on it |
| `src/instructions/game.rs` | `create_game`, `update_game`, `open_pool`, `close_pool` |
| `src/instructions/catalog.rs` | `upsert_item`, `upsert_box` |
| `src/instructions/platform.rs` | `init_platform`, `set_platform`, `collect_fees`, `set_suspended` |
| `src/rent.rs`, `pick.rs`, `core_cpi.rs`, `constants.rs`, `error.rs` | helpers: account sizing, the weighted pick, the four Metaplex Core calls, numbers, errors |
| `src/venue.rs`, `instructions/token.rs` | the registry (official tokens). Not part of the economy; unchanged from 0.2 |

The source was 6,795 lines (7,057 after the four pieces, 7,371 with Token-2022 and the two fees), of which `venue.rs` is 567 and tests inside the source files about 600.

## Accounts

| Account | Address | Holds | Who pays its rent |
| --- | --- | --- | --- |
| Platform | `platform` | admin, partner, the fee and a pending raise; the fees paid wait in its own SOL balance | us, once |
| Game | `game`, collection | owner, authority, collection, mint, treasury, order count, paused, suspended, official token | owner |
| Pool | `pool`, game, index | nothing of ours: a plain token account that only the game can spend | owner |
| Item | `item`, game, id | kind, rarity, soulbound, burnable, supply, issued, price, how the price rises, its life, active, its split, name, URI | owner |
| Box | `box`, game, id | price, the mint it is in, how it rises, active, opened count, its split, up to 8 drop entries | owner |
| Order | `order`, game, player, nonce | one purchase, and the mint it was paid in, until it is settled or refunded | player, returned |
| Schedule | `schedule`, game, id | what it does, how often, when next, runs so far | owner |
| Lottery | `lottery`, game, id | price, pot, cut, timing, round, winner; then 40 bytes per purchase of the round | owner; each buyer pays their line, the winner gets the lines' rent |
| Stake | `stake`, game, id | the staked mint, the rewards pool, the total staked, rewards per token; plus two token vaults | owner |
| Position | `position`, stake, player | one player's stake | player, returned when they unstake everything |
| Recipe | `recipe`, game, id | its version, up to 8 lines in and 8 lines out | owner |
| Hold | `hold`, asset | the player, when the authority's say ends, the game's label | player, returned |
| Contest | `contest`, game, id | the mint, the two deadlines, the verdict, what each side put in, its shares; plus its pot, a token vault | the authority that opened it, returned when it closes |
| Entry | `entry`, contest, player, side | what one player put on one side | player, returned at claim |

Every account is as big as what it holds and no bigger. A pay, a payout, a deposit, a schedule run and a craft or a make of tokens write no account, so they cost no rent. Making a collectible creates its Core asset, whose rent the caller pays.

## What a box can give

Each entry of a box has a weight and one of four outcomes. The roll picks one, and the program carries it out.

| Outcome | What happens |
| --- | --- |
| An item | `settle` mints the collectible to the player (a normal item is settled by the game's owner or authority, once its backend delivered it) |
| Pay an amount from a pool | `settle_prize` pays it to a token account the player owns |
| Burn | `settle_prize` burns the player's whole payment, in place of the box's split |
| A share of a pool | the roll turns it into an amount: a share (basis points) of what the pool holds at the roll. From there it is paid like a fixed prize. A jackpot that grows until someone hits it |
| Nothing | `settle_prize` splits the payment as usual |

A box can be priced in any mint (`currency`): the payment waits in the game's vault for that mint, and a refund returns the same token. The game's treasury only holds the game's own mint, so a box in another one must have shares that take the whole payment. A box or a shop item can also carry a `rise`: after each sale the price becomes `price + step + price × growth ÷ 10,000`. The buyer's `max_price` still holds, so a sale that lands after the price moved is refused.

A box or a shop item can also carry a `fall`: from `since`, its price falls by `step` every `every` seconds, never below `floor`. Each sale after `since` pays the fallen price, takes any `rise` from there, and starts the fall again at the time of the sale. With a fall alone it is a drop whose price comes down until it sells; with both it is a price that climbs with demand and cools off while nobody buys. A price that falls to 0 is no longer for sale.

A box with `stock_odds` scales each item's weight by the share of its supply still left, rounded up, so the last of an item can still be won: the last mythic of 100 is a hundred times rarer than the first. Items with no supply limit, and the other outcomes, keep their weight.

An order is only ever rolled on the version of the box it paid for: if the owner edits the box in between, the order fails and can be refunded at once.

The roll skips what cannot be won at that moment: an item that is sold out, and a prize its pool does not hold. If nothing is left, the order fails and refunds at once. If a pool is emptied between the roll and the settle, the settle fails and the order refunds after 7 days.

## The other mechanics, in a few sentences each

- **Schedule.** Every `every` seconds, one run. `Issue` mints an amount into a pool, and the amount can halve every N runs. `Burn` and `Move` take a share of whatever the pool holds at that moment. A schedule that fell behind catches up one call at a time. `max_runs` ends it, and `active` switches it off.
- **Lottery.** Ticket money goes to the pot (a pool), less a cut to the treasury. When the draw is due, anyone asks the oracle; its number picks first place's ticket, and up to 7 more places follow at even steps around the list of tickets from it, so no ticket wins twice and every ticket has the same chance at every place. Each place takes its share of what the pot held when the first place was paid, or what the pot still holds if that is less (by default one place of 100%: the winner takes all). Anyone pays each place on its own; the last payment gives the rent of the list to first place and opens the next round. A round with fewer tickets than places has fewer winners, and whatever the places leave stays in the pot for the next round. If the oracle does not answer in about 10 minutes, anyone asks again and only the newest request counts. A lottery can sell its tickets in another token than its prize (`ticket_mint`): those tickets are burned, and the pot is filled from elsewhere. The owner can only change a lottery between rounds.
- **Stake.** Whatever arrives in the rewards pool is credited to everyone staked the next time anyone stakes or unstakes, each by their share. A stake has a lock, set when it is opened: nothing comes out until it has run since the position's last stake. Set it at least as long as the gap between rewards, and give the stake a rewards pool of its own. Staked tokens and credited rewards sit in two vaults the authority cannot pay out of. A stake cannot be edited once it is open. `unstake(0)` only collects rewards.
- **Recipe.** Up to 8 lines in and 8 lines out, and everything named happens in one transaction or none of it does. A line in is: collectibles of an item that are burned, one collectible that is used and kept, or an amount of a token that is burned or sent where a share could send it. A line out is: one new collectible, an amount of a token that is minted or paid from a pool, or a share (basis points) of what a pool holds at that moment; a recipe with a share is crafted once at a time. The player signs the recipe's version, so an edit that lands first cannot change what they agreed to. The program recognises a collectible by its owner, its collection, its name (always "<item name> #<serial>") and the item number written on it, which the authority's `set` never changes. A recipe has no chance in it: for that it gives a token that a box is priced in, and the box rolls. A recipe of tokens only is an exchange at a fixed rate and can be crafted many times at once (`times`): this is what the converter was. A recipe can ask that a number the authority wrote on a handed-in collectible is at least so much (`needs`: a hero of level 10), a new collectible can take named attributes from one handed in (`keeps`: a foal with its mother's coat), and a `Renew` line keeps a collectible and counts its uses from zero again (a repair; the cooldown still counts from its last use).
- **A collectible's life.** An item can say when a recipe may take one of it: not until `ready_after` seconds after it was made (an egg), not once `lasts` seconds have passed (milk), at most `uses` times when it is used and kept (a mare, a mine), and not more often than every `cooldown` seconds (a daily pass). The program writes `made`, `used` and `used_at` on the collectible itself, as attributes a wallet shows. An item with no life that a recipe uses only has to be held: a licence. An item's life cannot change once one is issued. The authority's `set` keeps these three numbers unless it names them. One collectible fills one place in a craft.
- **Hold.** The collectible itself moves to the game, so it cannot be sold or crafted meanwhile. The player chooses the seconds. Until they are up, the authority can `award` the collectible to anyone (back to the player early, or to whoever won it). After that the authority can do nothing and anyone can send it home with `take_back`. The authority can never `unmake` a collectible the game is holding. The way home goes through Metaplex Core, so whoever controls the game's collection there could make Core refuse it: that is the project itself, which is trusted. A hold of zero seconds is one the authority never decides. A soulbound collectible cannot be held.
- **Contest.** The authority opens one with a number of sides, a time entries close and a time a result is due. Players `enter` on a side, as often as they like, and each entry names the hash of the contest's terms it saw (`Contest::terms`), so it cannot land in another contest opened at the same id. `decide` names the side that won, no later than the result was due: the contest's shares leave the pot (a rake that is burned, a cut to a pool, a share for whoever holds the arena) and the rest is the prize, split by what each winner put in; the last winner to claim also takes the rounding. `call_off` gives every entry its own money back, with no cut: the authority can do it while the contest is open, and anyone can once the result is overdue. Naming a side nobody backed is refused. A contest cannot be edited.

## The split

A split is a list of up to four shares. Each share is a number of basis points (10,000 is the whole) with a destination: burned, one of the game's pools, a named token account (a partner, a creator), or whoever holds a named collectible at that moment (the owner of a plot, a stud, an arena). Whatever the shares leave goes to the game's treasury.

A share for a holder must be paid into a token account that holder owns; whoever sends the transaction cannot point it elsewhere. When nobody holds the collectible (it was burned, or the game is holding it), that share is burned. The owner writes the split of an item and of a box; the authority writes a contest's. Wrapped SOL cannot be burned, so a split in it that is carried out later (a sale, a box, a contest) takes no share that burns. Shares round down, so the treasury also gets the rounding.

- An item and a box each carry their own split, set by the owner. An order copies it at purchase, so a later edit does not touch a paid order.
- When the shares take the whole payment, the last one also takes the rounding, so nothing is owed to the treasury.
- `pay` takes its split from the transaction the player signs. The app that asked for the payment reads the receipt and admits the player when the amount, the split and the reference are the ones it asked for.

## The fee

There are two flat fees in SOL (the creator, 2026-10-11: a project paying out to ten thousand players should not pay a fortune for it, and each player only sees their own fee once):

| Fee | Starts at | Charged on the spot by | Why |
| --- | --- | --- | --- |
| **Player fee** | 0.002 SOL (`PLAYER_FEE_LAMPORTS`) | `pay`, `buy_tickets`, `stake`, `unstake`, `craft`, `hold`, `enter`; and `buy_item`, `open_box` through the order | a player signs for something of their own |
| **Project fee** | 0.00001 SOL (`PROJECT_FEE_LAMPORTS`) | `deposit`, `payout`, `burn`, `issue`, `make`, `unmake`, `set`, `roll`, `award`, `open_contest`, `decide` | everything else that is charged: an airdrop of 10,000 payouts costs 0.1 SOL in fees |

An order pays the player fee once: it waits in the order's escrow, goes to the platform at settle, and goes back to the player at `refund`. `deposit` is at the project fee because a deposit is how a project or a sponsor funds a pool, even when a player sends it.

Finishing what is already decided is free, or nobody would do it: `run_schedule`, `draw_lottery`, `pay_lottery`, `take_back`, `call_off`, `claim`, `close_contest`.

Fees collect in the platform record itself, an account the program owns, and the platform admin takes them out with `collect_fees`. There is no fee wallet to point somewhere unwritable, so the platform cannot stop a payout by breaking the fee.

Each fee is capped at 0.01 SOL (`MAX_FEE_LAMPORTS`). `set_platform` takes both: if it raises either one, the pair waits 7 days together; if it raises neither, it applies at once and drops any raise that was waiting. `init_platform` takes the fees to start with; the two constants are the ones the creator chose.

## Token-2022

Every token the program moves can be a classic SPL token or a Token-2022 token, in any role: a game's currency, a box's currency, a pool, a stake and its rewards, a contest's pot, a recipe's lines, a lottery's pot or tickets. All token calls are in `tokens.rs`, written out by hand (the two programs share the instructions used, byte for byte), and each goes to the program that owns its mint. So every instruction that moves tokens takes both programs (`token_program`, `token_2022_program`), and each one names the mint of every token it moves.

| Token-2022 brings | What the program does |
| --- | --- |
| Transfers must be checked for mints with a fee or a hook | every transfer is `TransferChecked` (the classic program takes it too) |
| A **transfer hook** runs on every transfer of its mint, with extra accounts it names | the hook's accounts come at the end of the instruction's remaining accounts, after whatever the instruction itself reads there; every Token-2022 transfer hands them all on, and Token-2022 takes the ones its hook names by address. The hook gets no signature of ours, even when the game signs the transfer and the hook's list asks for the game as a signer: Token-2022 calls a hook with no signer at all (`tests/token_2022.rs` checks it). A hook can refuse a transfer, as a freeze can |
| A **transfer fee** keeps part of what is sent | where the program writes an amount down, it writes what arrived: what an order paid, what a player staked, the rewards a stake credits, what an entry put on a side. So every account the program keeps can pay out what it owes. Payouts arrive less the fee, as any transfer of that mint does |
| Fees the mint withholds sit in the receiving account, and block closing it | before closing a pool or a contest's pot, the program sweeps them to the mint (`HarvestWithheldTokensToMint`, which anyone may do) |
| An account of a Token-2022 mint can need more than 165 bytes | pools, stake vaults and pots ask Token-2022 their size (`GetAccountDataSize`); the vaults and player accounts are associated token accounts, which the associated token program sizes |
| An account's owner can **require a memo** on every transfer into it | a transfer into such an account first sends a memo through the Memo program, which the sender passes with the hook's accounts (`MemoNeeded` without it). So nobody stops what is owed to them, or anyone else, by turning memos on |
| A multisig of either program has no type byte | an account of its length (355 bytes) is never read as a token account or a mint |
| Token-2022 wrapped SOL | treated like classic wrapped SOL: no share that burns it |
| Everything else (a permanent delegate, a default frozen state, a pause, non-transferable, interest, metadata, confidential balances) | the mint's own business, as a classic mint's freeze authority already is. A permanent delegate can move tokens out of the game's own accounts, a frozen or paused account stops transfers in and out, and a hook decides each transfer for itself (it can refuse an order's settle and let its refund through 7 days later, as freezing the box's pools for 7 days could); the project chose the mint |

A recipe and a box no longer refuse accounts after their last line: those are for a hook. An extra account there is handed to the hook, if any, and to nothing else.

## Building blocks added on 2026-10-11

The creator listed 50 economies people would want (burning, merging, rarity mints, breeding, raids, betting) and asked how far the program gets with no rule written for any one of them. Seven pieces were missing, each general, and each is now in the program:

| Missing piece | What was added | Economies it opens |
| --- | --- | --- |
| One recipe for any mix of things | `craft`: collectibles and tokens in, collectibles and tokens out; it replaced `merge` | salvage, a shop in any currency, multi-part sets, breeding, daily claims |
| Chance on a craft | a box priced in any mint (`currency`): the recipe gives the token, the box rolls | gem fusion, risky upgrades, pity counters |
| Paying a player as a share | `To::Account`, `To::Holder` | stud fees, land that earns, a recipe's finder, an arena's owner |
| A price that is a formula | `Rise` on items and boxes | bonding-curve mints, a throne that costs more each time |
| State on an item the program can check | `Life`: ready after, lasts, uses, cooldown | eggs, rot, mortal pets, breed counts, mines that run dry, daily turns |
| Holding and moving an item | `hold`, `award`, `take_back` | raids with real loot, heists, lending |
| The game names an outcome without touching the money | `open_contest`, `enter`, `decide`, `claim`, `call_off` | duels, betting on a match, faction seasons, tournaments |
| A recipe that looks at what the game wrote | `needs`, `keeps`, `Renew` | rebirth at max level, traits passed on, repairs and refills |
| A prize in another token than the ticket | `ticket_mint` on a lottery | a ticket per monster killed, drawn for a pot of coins |

How the pieces go together, with no new rule for any of them:

- **A craft left to chance.** A recipe burns three gems and gives one "attempt" token. A box priced in that token gives the big gem half the time. A failed roll that never arrives refunds the attempt.
- **A pity counter.** The recipe that sells a pull also gives a pity token; a second recipe turns 50 pity tokens into the epic.
- **A daily claim.** A soulbound pass with a cooldown of a day, used and kept by a recipe that pays one coin from a pool.
- **A stud fee.** The stud's holder crafts a "cover" token from the stud (used and kept, so many times, so often) and sells it; the breeder's recipe takes a mare and a cover and gives a foal.
- **Staking things that are alike.** A recipe burns a sheep for one share token and another gives it back; the share token is staked like any other.
- **An exchange.** A recipe that burns 2 gems and mints 3 points, crafted 500 times in one transaction. The separate converter mechanic was removed for this: two instructions and one kind of account less. The shop (`buy_item`) was looked at and kept, because a sale opens an order: a normal item is delivered by the game's backend before it is settled, anyone can settle a collectible for the buyer, and what a split leaves goes to the treasury.
- **A pet that must be fed.** The pet lasts a day. The feeding recipe burns it with some food and gives a new one.

## What changed from 0.2

| Change | Why |
| --- | --- |
| The fee is a flat amount of SOL, not a percent in the sale's token | creator's choice. No fee token account per currency, no fee rounding rule |
| `authority` on the game; `payout`, `burn`, `issue`, `make`, `unmake`, `set`, `roll` | the out and make verbs, and a random number for any rule |
| Pools, `open_pool`, `close_pool`, `deposit` | named vaults for prizes, rewards and stakers |
| A split per item, per box and per `pay`, replacing the game's one burn rate | money in can feed pools |
| Box entries are outcomes; `settle_prize` | a box can pay, burn or give nothing, with nobody's signature |
| Schedules, lotteries, stakes, recipes (a converter was written too, and later folded into the recipe) | creator: the authority only for game-time decisions |
| `burnable` on an item | only a burnable collectible can be unmade by the authority |
| `Game.authority` (0.2) is now `Game.owner` | the owner signs settings, the authority signs payouts |
| One-byte tags on every account; fixed fields first on an item | 7 bytes less rent each; a box roll reads items at fixed places |
| `migrate_platform`, `migrate_game`, `apply_pending_fee` and the 0.1 layouts are gone | creator's choice: a clean start |
| A roll carries the ticket of its own request; a collectible's address includes the slot of its purchase | an address is free again once its account closes, and a reused one must not inherit a late roll (first review) |

Kept as they were: the order flow with its ways out (a failed roll, a roll that never arrives after 1,500 slots, an unsettled order after 7 days), `max_price`, the authenticated oracle callback, the suspend switch that never stops what is owed, and the registry.

## Size

The program is 909,064 bytes with Token-2022, the two fees and the seventh review's fixes (904,952 after the four pieces of the list of 100 and the sixth review's fixes) (888,200 is the last size written here before them), against 505,136 for 0.2, with 49 instructions against 19 (740,056 bytes and 42 instructions before the building blocks). That is about 2.6 SOL more rent than 0.2, paid once by us. A recipe at its limits fits in one transaction, with the compute limit raised above the default 200,000: eight collectibles burned for one took 888 bytes and about 198,000 compute units; four burned and four used for two new ones and tokens took 1,154 of the 1,232 bytes and about 337,000. A contest entry took about 45,000 and a hold about 33,000.

## Independent reviews, 2026-10-11

### First review: the base

An agent that had not written the code, given only the code and the security model, tried to break 0.3 and wrote its tests in `tests/review_0_3.rs`. It found nothing that steals funds. Its six findings:

| # | Finding | Now |
| --- | --- | --- |
| 1 | The platform could stop `payout` and `settle` by pointing its fee wallet at an unwritable address | fixed: fees collect in the platform record |
| 2a | A roll that arrives after a refund could land on a new order at the same nonce, with randomness the player had seen | fixed: the ticket |
| 2b | A purchase at the nonce of a settled collectible order could never settle | fixed: the asset address includes the slot |
| 3 | The `Paid` receipt named whatever mint account the payer passed | fixed: checked against the paying token account |
| 4 | A payment in another mint failed whenever its split rounded | fixed: the last of a 100% split takes the rounding |
| 5 | `close_pool` emptied a wrapped-SOL pool to the owner with no receipt | fixed: a pool that holds anything is refused |
| 6 | A mint with a freeze authority can freeze the vault and hold open orders | **open**: refusing such mints would refuse USDC |

It also asked one thing it could not check: `open_box` accepts MagicBlock's test queue as well as its default queue, and what serves the test queue on mainnet is unknown. That needs an answer before mainnet.

### Second review: everything added after the first

A second agent reviewed the box outcomes, `burn`, `roll`, schedules, converters (since folded into the recipe), the lottery, staking and merges, and wrote its tests in `tests/review_2.rs`. It found three serious weaknesses and eight smaller ones.

| # | Finding | Now |
| --- | --- | --- |
| 1 | High: in one transaction, someone could stake a large borrowed sum, trigger the rewards, and unstake, taking a whole distribution from the real stakers | fixed: a stake has a lock, set when it is opened; nothing comes out until it has run |
| 2 | High: the owner could stop every unstake by closing the rewards pool, or reopening it in another mint | fixed: a missing or foreign pool just brings no rewards |
| 3 | High: any admin could write a converter, schedule, lottery or box that empties a pool or mints, with no authority | fixed: everything that can move a pool or mint is the owner's alone (and a game has no admins any more) |
| 4 | Medium: a box edited after a purchase decided that purchase | fixed: an order remembers the box version it paid for, and fails and refunds on any other |
| 5 | A stake takes all its rewards pool holds, so a pool shared with a lottery's pot is emptied | **noted**: said at the top of `stake.rs` and `lottery.rs`; a setup checker should refuse it |
| 6 | `pay_lottery` could not pay a winner whose wallet was empty | fixed |
| 7 | `convert` cut an oversized result to its low bits | fixed: refused |
| 8 | A merge goes by item name: renaming an item stranded its collectibles, and two items with one name are interchangeable | fixed: a name is locked once issued, and since the fourth review a recipe also reads the item number on the collectible |
| 9 | A lottery's cut rounds down per purchase, and breaks a pot that is not in the game's mint | **noted** in `lottery.rs` |
| 10 | A recipe with a soulbound input can never be merged | **noted** in `craft.rs` |
| 11 | A prize pool or a pot is still a pool: the authority can pay it out between a roll and its settle | **by design**: the authority is unbounded over pools. The player gets the 7-day refund |

The fixes to findings 1 to 4 were written after this review and have not been reviewed themselves.

### Third review: the building blocks

A third agent reviewed everything in "Building blocks added on 2026-10-11" and wrote its tests in `tests/review_3.rs`. It found nine weaknesses, two of them serious, and one note. All ten are fixed, and the fourth review checked the fixes.

| # | Finding | Now |
| --- | --- | --- |
| 1 | High: a recipe payment to a holder could be paid in any mint, into a worthless account opened in the holder's name | fixed: the paying account and the holder's account must be of the line's mint |
| 2 | High: the authority could `unmake` a held collectible, burnable or not, even after its hold was over, because the game is its owner meanwhile | fixed: `unmake` refuses a collectible the game is holding |
| 3 | Medium: an entry signed none of a contest's terms, and the authority could reopen an id with terms that take the whole pot | fixed: an entry names the hash of the terms |
| 4 | Medium: an admin could point an item's whole revenue at their own account with the new `Account` share | fixed: only the owner writes a share that pays an account or a holder |
| 5 | Medium: one collectible filled a used line and a burned line of one recipe | fixed: one collectible fills one place |
| 6 | Medium: the holder of a named collectible could stop every settle of a box in another mint by handing it to the game (the untaken share fell to a treasury in the wrong mint) | fixed: a share nobody holds is burned |
| 7 | Low: a recipe payment to a holder was free when nobody held the collectible | fixed by the same rule: it is burned |
| 8 | Low: a result was accepted long after it was due | fixed: `decide` is refused after `result_by` |
| 9 | Low: one stray lamport of wrapped SOL kept a contest from ever closing | fixed: a wrapped SOL pot closes without a burn |
| note | A `set` that left out `made`, `used` and `used_at` reset a collectible's life | fixed: `set` keeps them unless it names them |

It could not check a collection created with its own Core plugins, a transfer delegate calling `hold`, or Token-2022 mints. The fourth review checked the first two; Token-2022 was unchecked then (the program took the classic token program only); it is supported since 2026-10-11, see "Token-2022".

Still true, and the owner's or the players' to know:
- The authority names a contest's winner, so it is trusted not to bet: it can enter its own contest and decide before entries close.
- If the owner of an `Account` share closes that account, every settle that pays it fails until the owner edits the split; open orders refund after 7 days.
- `upsert_box` does not check that the pools a box in another currency names hold that currency. If they do not, its orders refund after 7 days.
- A rising price does not come back down when an order is refunded, and an edit of the item or box sets the price anew.
- An expired collectible cannot go into any recipe, a recipe that would burn it included.

### Fourth review: the third's fixes, and what was added after

A fourth agent checked the ten fixes above and the second pass (`needs`, `keeps`, `Renew`, `times`, the converter's removal, `ticket_mint`, the collection check). Its tests are in `tests/review_4.rs`. It found the ten fixes sound except one gap, and nothing that lets anyone move or burn a collectible they do not own.

**By design.** The reviewer showed that the owner of a game's collection (its Core update authority) can stop a held collectible from coming back: with a Core royalties rule that denies this program, with an oracle adapter on transfers, by taking the collectible out of the collection, or through any update delegate it names. None of it can be checked when the game is created, and the only fix is to take the collection away from its owner. The creator's answer: "we always trust project auth". A project's own keys are trusted, so this stays as it is, and so does a contest whose shares the authority writes (finding 7 below).

Fixed:

| # | Finding | Now |
| --- | --- | --- |
| 5 | Medium: an admin could write an item with another item's name and sell it cheap; a recipe took it for the real one and paid out of a pool | a recipe also reads the item number on the collectible, and `set` never changes which item a collectible is |
| 6 | Medium: the third review's "a share nobody holds is burned" fails in wrapped SOL, which cannot be burned, so a holder could stop a contest's result or a box's settles for good | a split that is carried out later takes no share that burns when it is in wrapped SOL |
| 7 | Low: the authority, which writes contests, could give one shares that pay outside the game | by design: the authority is one of the project's keys, and every entry signs the contest's terms |
| 8 | Note: a `Renew` also skipped the cooldown | the cooldown counts from the last use whatever the count says |
| 9 | Note: two keeps of one key wrote it twice | a recipe keeps a key once for each new collectible |
| 10 | Note: the `Crafted` receipt named no amounts | it names the recipe's version, whose lines say what moved |

The reviewer answered the collection question by test against the real Core program: a permanent freeze, transfer or burn delegate cannot be added to a collection or an asset after it is created, and nothing the update authority adds later moves or burns a collectible someone else owns. What it can do is block transfers (the table above). Not checked by anyone: Core's `ExecuteV1`, groups, compression and its other adapters; a Core upgrade on mainnet could change these answers.

### Last check: the fourth review's fixes, and plain bugs

A fifth agent, told that a project's own keys are trusted, checked the fourth review's fixes (all hold) and read the day's additions once more for plain bugs. Its tests are in `tests/review_5.rs`. It found no way for a player or a stranger to take or destroy value.

| # | Finding | Now |
| --- | --- | --- |
| 1 | Medium: an admin could put an item the owner never sold on sale for 1, buy it, and craft the owner's recipe that pays from a pool | closed: a game has no admins any more; only its owner writes an item |
| 2 | Medium: an admin could point an item's revenue at the pool their own stake draws from | closed the same way |
| 3 | Low: a contest share for a collectible's holder fails `decide` when the collectible moved after the transaction was built; a holder who keeps moving it until the result is due turns a loss into a refund | **noted**: the authority sends `decide` again with the new holder's account; it wrote that share, and it is trusted |
| 4 | Low: an order on an edited box failed at once only when the edit kept the same items; otherwise the oracle's answer itself failed and the player waited about 10 minutes | fixed: the version is looked at before any entry |
| 5 | Low: a lottery with a `ticket_mint` whose pot was never opened could not end its round | fixed: a pot that is not there holds nothing |
| 6 | Note: an idle lottery came back one period per call | fixed: one call moves it to its next date ahead |
| 7 | Note: a sale failed when the next price would overflow | fixed: a price that can rise no further stays put |
| 8 | Note: within a craft, a payment to a collectible's holder reaches them only if it comes before the line that burns that collectible | said at the top of `craft.rs` |
| 9 | Note: an item, box, recipe, schedule, lottery and stake have no close, so their rent is never returned; the game's vault for a currency is paid by its first buyer | **noted**, not built |

### Sixth review: the four pieces from the list of 100

A sixth agent reviewed commit e672353a2 (a price that falls, odds that shrink with stock, a prize that is a share of a pool, lottery places) and wrote its tests in `tests/review_6.rs`. It found nothing that lets a player or a stranger take funds or mint. The draw was checked for every round of 1 to 40 tickets and 1 to 8 places: no ticket wins twice and each ticket's expected share is its share of the tickets.

| # | Finding | Now |
| --- | --- | --- |
| 1 | Medium: a share prize was sized at settle, and anyone settles in any order: of two orders that rolled one 100% jackpot, the one settled first took it and the other was settled for 0 with no refund; a winner could also wait for the jackpot to grow on later players' money | fixed: the roll turns the share into a fixed amount (`Pay`), so a settle the pool cannot pay fails and that order refunds after 7 days, and the receipt names the amount |
| 2 | Low: a place was a share of the pot at the first payout but sent from the pot as it is; anything that took from the pot in between (a schedule anyone runs) made the round unable to end | fixed: a place gets its share or what the pot still holds, whichever is less |
| 3 | Low: the rent of the ticket list went to whichever place was paid last, chosen by whoever sent the payouts | fixed: it goes to first place in any order (`pay_lottery` takes first place's wallet, checked) |
| 4 | Note: a fall starting near `i64::MIN` overflowed on every sale | fixed: a fall cannot start before 1970, and the subtraction saturates |
| 5 | Note: `ticket_of_place` overflowed above about 2^63 tickets | fixed: going round the end of the list is a subtraction |
| 6 | Note: stale comments in `lottery.rs` and this file | fixed |

Two fixed prizes that roll on one pool before either is settled still race, as they did before this review: a keeper settles right after each roll.

### Seventh review: Token-2022 and the two fees

A seventh agent reviewed commit cc5105410 and wrote its tests in `tests/review_7.rs` (16). It found nothing that lets a player, a stranger or a third-party mint authority take value, reach the game's signature, or block what is owed to someone else. Checked sound: a mint of the wrong program or a fake mint is refused; a hook never gets the game's or the player's signature, cannot write the game's accounts, cannot re-enter loot, and its accounts do not disturb what an instruction reads; with a transfer fee every staker, winner and order balances; a stranger cannot block a pot's close with withheld fees; a fee raise never applies early.

| # | Finding | Now |
| --- | --- | --- |
| 1 | Low: the owner of an account a split names (a partner) could require memos on it; no transfer of the program carried one, so every settle paying it failed and each order was refunded after 7 days, losing rolls included | fixed: a transfer into an account that requires memos sends one first through the Memo program, passed with the hook's accounts |
| 2 | Note: a multisig (355 bytes, no type byte) passed for a token account and for a mint (`create_game` took one as its currency) | fixed: an account of 355 bytes is neither |
| 3 | Note: a hook can refuse an order's settle and let its refund through | kept, by design: the mint is the project's choice; written under "Token-2022" |
| 4 | Note: a player who requires memos on their own account held up their own refund | fixed with 1 |

## Not done, and open

- **Deployed to devnet on 2026-10-11** (the creator: "You can deploy this current version"), fresh, at `88Labq6tdVnBQsjHSfic6qqgvo5b9NGmy99AYj7KVXqM` (source commit a02c20281, 909,064 bytes, SHA-256 `7b91abf9…5450` checked against the program data on chain), upgrade authority `loot-deployer`; platform `DFbnNkPG…L2cm9` with the player fee 2,000,000 and the project fee 10,000 lamports and the launch partner `8yPDcNeK…3rnNV`. Record: `devnet-deploy-0.3-result.json`; addresses under `loot03` in `launchpad/devnet.json`. **The devnet run passed** (`devnet-e2e-0.3.mjs`, record `devnet-e2e-0.3-result.json`, real MagicBlock oracle): two boxes rolled by the oracle (a collectible minted to the player, and nothing), each sending a fifth of its price to a pool; a lottery with two places drawn by the oracle, paid by anyone, and rolled to its next round; a stake that earned 20 of 20 reward tokens and emptied; and a box priced in a Token-2022 coin with a 1% transfer fee, whose order held the 99 that arrived and whose pool got 98.01. The run builds 0.3 instructions from the IDL (`target/idl/loot.json`) with `client/codec.mjs`, which now encodes enums that carry data; the 0.2 client is otherwise unchanged. 0.2 stays at `FWVap91…` for production Studio's devnet shop. Nothing on mainnet.
- **The JS client, the API and the keeper** (`client/`, `api.mjs`) still build 0.2 transactions. They need the 0.3 IDL (`target/idl/loot.json` after `anchor build`) before anything can run against a 0.3 deployment.
- **`README.md`, `COSTS.md`, `BUILD.md` and `REVIEW-2026-10-10.md` describe 0.2**, which is what devnet runs.
- **Payout by voucher and a limited keeper key** are not built. Both shrink what the authority's signature can do for game-time decisions; the creator has not chosen between them.
- **Not built in the mechanics:** staking weighted by lock time or by held items, an exchange with vesting, a trait picked by chance from two parents, a family tree, a forced sale (a throne or land that anyone can buy from its holder at a price), a buy-back along a rising price, "the last buyer wins when the timer runs out", an auction, a payout of 1/N of a pool where N is what is left of an item (the program cannot count burns: a holder can burn a collectible through Metaplex Core directly), and taking anything from a wallet with no signature.
- **The sixth review's fixes are not reviewed. Token-2022 support and the two fees were reviewed by a seventh agent** (`tests/review_7.rs`): nothing serious; its Low (an account requiring memos could block every settle that pays it) and one note (a multisig read as a mint or an account) are fixed, and those fixes are not reviewed. `pick.rs` says the TypeScript odds display mirrors the pick; that display (JS client, still 0.2) knows neither `stock_odds` nor a share outcome.
- **An authority that is another program's address** must be a plain system address holding SOL, because it pays the flat fee with a system transfer.
- **`create_game` checks two things about the collection** (its update authority is the owner who signs, and it has no permanent freeze, transfer or burn delegate) and not that the collection lets the game mint. The owner grants that on the collection (an update delegate) and can take it back. Without it, collectible orders wait 7 days and refund.
- **Numbers that are mine, not the creator's:** the 0.01 SOL fee cap, four shares per split, eight lines a side and eight collectibles per recipe.

## Run it

```bash
cd launchpad/loot
scripts/fetch-fixtures.sh        # once: the Metaplex Core and MagicBlock VRF programs, and the test hook
cargo build-sbf && cargo test    # the tests load target/deploy/loot.so
```

| Test file | What it proves |
| --- | --- |
| `tests/economy.rs` | pay, deposit, payout, burn, roll, issue, make, unmake, set, pools, the fee, and a box whose roll burns, mints or pays in another currency |
| `tests/orders.rs` | a purchase, its roll, settle, refund, and the owner's settings |
| `tests/mechanics.rs` | schedules, exchanges, the lottery, staking and recipes, each run with no key of the game |
| `tests/token_2022.rs` | Token-2022 and the two fees, each as a small economy: a box and a pool in a Token-2022 coin, a coin that keeps 1% of every transfer (orders, refunds, a stake, a contest and a pool all balance, and close), a coin with a transfer hook (the test hook in `test-hook/` counts each transfer and refuses one of 13), and a game whose players pay 0.002 SOL while its project pays 0.00001 |
| `tests/pieces.rs` | the four pieces from the list of 100, each as a small economy: a drop whose price falls, a throne that rises with sales and cools off, a mythic whose odds shrink as it sells, a progressive jackpot, a golden ticket cashed in for a tenth of a pool, a lottery with three places that rolls the rest over |
| `tests/blocks.rs` | the building blocks of 2026-10-11, each as a small economy: a fishing game's recipes, a craft left to chance, a plot whose holder earns, a throne that costs more each time, an egg and milk, mares and a daily pass, a raid's hold, a match and a contest called off |
| `tests/registry.rs` | official tokens, from the 0.2 suite and the review of 2026-10-10 |
| `tests/review_0_3.rs`, `tests/review_2.rs`, `tests/review_3.rs`, `tests/review_4.rs`, `tests/review_5.rs`, `tests/review_6.rs`, `tests/review_7.rs` | the seven independent reviews: findings turned into tests that the attack now fails, and attacks the program refuses |
| `tests/costs.rs` | compute units and rent of the base instructions |
