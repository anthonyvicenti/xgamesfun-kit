//! Sixth review of loot 0.3 (2026-10-11): the four pieces from the list of 100 economies (a
//! price that falls with time, odds that shrink with stock, a prize that is a share of a pool,
//! a lottery with up to 8 places), commit e672353a2. LiteSVM against the built binary.
//!
//! A project's own keys are trusted (its owner, its authority), so nothing here is about what
//! only they can do. `fixed_*` is a finding: it says what the problem was, and the test shows
//! that the fix holds. `sound_*` is an attack or an edge the
//! program handles.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    loot::{
        pick::by_stock,
        receipts::{LotteryPaid, OrderSettled},
        state::{DropEntry, Fall, ItemKind, Order, Outcome},
        Action, BoxArgs, Input, ItemArgs, Lottery, LotteryArgs, Output, RecipeArgs, Round, ScheduleArgs,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 24 * 60 * 60;

/// A new wallet with SOL and `amount` of the game's own token.
fn player(env: &mut Env, amount: u64) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    let mint = env.mint;
    env.fund(k.pubkey(), mint, amount);
    k
}

fn err<T>(r: Result<T, String>) -> String {
    r.err().expect("expected the transaction to fail")
}

fn my(env: &Env, who: &Pubkey) -> u64 {
    env.tokens(&ata(who, &env.mint))
}

fn boxed(price: u64, entries: Vec<DropEntry>) -> BoxArgs {
    BoxArgs { price, currency: None, rise: None, fall: None, stock_odds: false, active: true, shares: vec![], entries }
}

/// The owner opens pool `index` in the game's mint and puts `amount` in it.
fn jackpot(env: &mut Env, index: u8, amount: u64) {
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, index, env.mint).unwrap();
    if amount > 0 {
        env.fund(owner.pubkey(), env.mint, amount);
        env.deposit(&owner, index, env.mint, amount).unwrap();
    }
}

/// `who` opens box `box_id` at `nonce` and the oracle answers `number`. Returns the order.
fn open_as(env: &mut Env, who: &Keypair, box_id: u32, nonce: u64, number: u64) -> Pubkey {
    let me = env.player.insecure_clone();
    env.player = who.insecure_clone();
    env.open_box(box_id, nonce).unwrap();
    env.player = me;
    let order = order_pda(&env.game, &who.pubkey(), nonce);
    env.callback_of(box_id, order, rnd(number)).unwrap();
    order
}

/// A lottery with these places on pool 0, the pot topped up to 1,100, and three players holding
/// tickets 0..3, 3..4 and 4..10. The draw is due.
fn lottery(places: Vec<u16>) -> (Env, [Keypair; 3]) {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    jackpot(&mut env, 0, 1_000);
    let args = LotteryArgs { price: 10, pot: 0, cut_bps: 0, places, ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();
    let players = [player(&mut env, 1_000), player(&mut env, 1_000), player(&mut env, 1_000)];
    for (who, count) in players.iter().zip([3, 1, 6]) {
        env.buy_tickets(who, 1, count, env.mint).unwrap();
    }
    env.wait(DAY);
    (env, players)
}

/// A bare lottery record for the pure arithmetic.
fn record(sold: u64, set: usize, first_ticket: u64) -> Lottery {
    let mut places = [0u16; 8];
    places[..set].fill(1);
    Lottery {
        game: Pubkey::default(),
        id: 0,
        bump: 0,
        price: 1,
        pot: 0,
        cut_bps: 0,
        places,
        ticket_mint: Pubkey::default(),
        every: 1,
        draws_at: 0,
        round: 0,
        status: Round::Drawn,
        sold,
        asked_slot: 0,
        winner: Pubkey::default(),
        first_ticket,
        paid: 0,
        pot_at_payout: 0,
    }
}

// ================================================================ findings, and their fixes

/// FINDING 1 (Medium), fixed. A `Share` box prize was sized when the order was settled, and
/// anyone may settle any order in any sequence: two orders that rolled the same 100% jackpot
/// both counted as hits, whoever was settled first took the pool, and the other, who hit
/// first, was settled for nothing with no refund. The two receipts were the same.
///
/// Now the roll turns a share into `Pay` with the amount it is of the pool at the roll, so it
/// is paid like any fixed prize: a settle the pool cannot pay fails, and that order refunds
/// after 7 days. (Two hits on one pool before either settles is the same race every fixed
/// prize already has; a keeper settles right after the roll.)
#[test]
fn fixed_a_share_prize_is_fixed_at_the_roll() {
    let mut env = setup();
    let c = env.cranker.insecure_clone();
    jackpot(&mut env, 1, 1_000);
    let jackpot_entry = DropEntry { outcome: Outcome::Share { pool: 1, bps: 10_000 }, weight: 1 };
    env.upsert_box_args(20, boxed(100, vec![jackpot_entry])).unwrap();
    let a = env.player.insecure_clone();
    let b = player(&mut env, 1_000);

    let order_a = open_as(&mut env, &a, 20, 1, 0);
    let order_b = open_as(&mut env, &b, 20, 1, 0);
    let won = Outcome::Pay { pool: 1, amount: 1_000 };
    assert_eq!((env.acc::<Order>(&order_a).outcome, env.acc::<Order>(&order_b).outcome), (won, won), "each order names its amount");

    // B is settled first and paid. A's settle fails, and A gets their payment back.
    let b_before = my(&env, &b.pubkey());
    let rb: OrderSettled = receipt(&env.settle_prize(order_b, Some(ata(&b.pubkey(), &env.mint)), &c).unwrap());
    assert_eq!((my(&env, &b.pubkey()) - b_before, rb.outcome), (1_000, won));
    assert!(env.settle_prize(order_a, Some(ata(&a.pubkey(), &env.mint)), &c).is_err());
    let a_before = my(&env, &a.pubkey());
    env.wait_slots(loot::ROLLED_REFUND_SLOTS + 1);
    env.refund(order_a).unwrap();
    assert_eq!(my(&env, &a.pubkey()) - a_before, 100);
}

/// FINDING 1, the other side, fixed. A winner who held their order unsettled while later
/// players fed the pool used to take what those players paid in. Now they take what they won.
#[test]
fn fixed_a_share_winner_cannot_wait_for_the_jackpot_to_grow() {
    let mut env = setup();
    let c = env.cranker.insecure_clone();
    jackpot(&mut env, 1, 1_000);
    let entries = vec![DropEntry { outcome: Outcome::Share { pool: 1, bps: 10_000 }, weight: 1 }, DropEntry { outcome: Outcome::Nothing, weight: 1 }];
    env.upsert_box_args(21, BoxArgs { shares: vec![pool(1, 10_000)], ..boxed(100, entries) }).unwrap();
    let a = env.player.insecure_clone();
    let b = player(&mut env, 1_000);

    let order_a = open_as(&mut env, &a, 21, 1, 0);
    assert_eq!(env.acc::<Order>(&order_a).outcome, Outcome::Pay { pool: 1, amount: 1_000 });
    for nonce in 1..=5 {
        let order = open_as(&mut env, &b, 21, nonce, 1);
        env.settle_prize(order, None, &c).unwrap();
    }
    assert_eq!(env.tokens(&pool_pda(&env.game, 1)), 1_500);
    let before = my(&env, &a.pubkey());
    env.settle_prize(order_a, Some(ata(&a.pubkey(), &env.mint)), &c).unwrap();
    assert_eq!(my(&env, &a.pubkey()) - before, 1_000, "the jackpot as it was when A hit it");
    assert_eq!(env.tokens(&pool_pda(&env.game, 1)), 600, "B's 500 and A's own 100 stay for the next winner");
}

/// FINDING 2 (Low), fixed. Each place was a share of `pot_at_payout` sent from what the pot
/// held then, so anything that took from the pot between payouts (here a stranger running the
/// owner's burn schedule) made the rest unpayable and the round could never end. Now a place
/// is paid its share or what the pot still holds, whichever is less.
#[test]
fn fixed_a_lottery_round_ends_when_the_pot_shrinks_between_places() {
    let (mut env, [_, b, c]) = lottery(vec![5_000, 5_000]);
    let owner = env.creator.insecure_clone();
    let pot = pool_pda(&env.game, 0);
    let burn_tenth = ScheduleArgs { active: true, action: Action::Burn { pool: 0, bps: 1_000 }, every: DAY, next_at: env.now(), max_runs: 0 };
    env.upsert_schedule(&owner, 1, burn_tenth).unwrap();

    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(13)).unwrap();
    let gold = env.mint;
    env.pay_lottery_place(1, 0, ata(&b.pubkey(), &gold)).unwrap();
    env.run_schedule(1, gold, pot).unwrap();
    assert_eq!(env.tokens(&pot), 495);

    let paid: LotteryPaid = receipt(&env.pay_lottery_place(1, 1, ata(&c.pubkey(), &gold)).unwrap());
    assert_eq!((paid.amount, env.tokens(&pot)), (495, 0), "what was left");
    assert_eq!((env.lottery(1).round, env.lottery(1).status), (1, Round::Open));
}

/// FINDING 3 (Low), fixed. The rent of the list went to whichever place was paid last, so
/// whoever sent the payouts chose who got it. Now it goes to first place, in any sequence.
#[test]
fn fixed_the_list_rent_goes_to_first_place_in_any_sequence() {
    for b_last in [true, false] {
        let (mut env, [_, b, c]) = lottery(vec![5_000, 3_000, 1_000]);
        env.draw_lottery(1).unwrap();
        env.lottery_callback(1, rnd(13)).unwrap(); // places: b, c, c
        let gold = env.mint;
        let (bt, ct) = (ata(&b.pubkey(), &gold), ata(&c.pubkey(), &gold));
        let sequence = if b_last { vec![(1, ct), (2, ct), (0, bt)] } else { vec![(0, bt), (1, ct), (2, ct)] };
        let lottery_key = env.mechanic_pda(loot::LOTTERY_SEED, 1);
        let list_rent = env.lamports(&lottery_key) - env.rent(env.data(&lottery_key).len() - 3 * 40);
        let (b_sol, c_sol) = (env.lamports(&b.pubkey()), env.lamports(&c.pubkey()));
        for (place, to) in sequence {
            env.pay_lottery_place(1, place, to).unwrap();
        }
        assert!(list_rent > 0);
        assert_eq!((env.lamports(&b.pubkey()) - b_sol, env.lamports(&c.pubkey()) - c_sol), (list_rent, 0));
    }
}

/// FINDING 4 (Note), fixed. A fall that started near `i64::MIN` overflowed on every sale, so
/// the item could never sell. A fall's start may no longer be before 1970, and the arithmetic
/// saturates.
#[test]
fn fixed_a_fall_cannot_start_before_1970() {
    let mut env = setup();
    for since in [i64::MIN, -1] {
        let fall = Some(Fall { step: 1, every: 1, floor: 1, since });
        assert!(err(env.upsert_item(70, ItemArgs { fall, ..item(ItemKind::Collectible, "Relic", 0, 1_000) })).contains("BadPrice"));
    }
    let fall = Some(Fall { step: 1, every: 1, floor: 1, since: 0 });
    env.upsert_item(70, ItemArgs { fall, ..item(ItemKind::Collectible, "Relic", 0, 1_000) }).unwrap();
    env.buy(70, 1).unwrap();
}

/// FINDING 5 (Note), fixed. `ticket_of_place` added before taking the remainder, so a round of
/// more than about 2^63 tickets overflowed. It now goes round the end of the list by subtraction.
#[test]
fn fixed_ticket_of_place_holds_in_a_huge_round() {
    let l = record(u64::MAX, 8, u64::MAX - 1);
    assert_eq!(l.ticket_of_place(0), u64::MAX - 1);
    assert_eq!(l.ticket_of_place(7), 7 * (u64::MAX / 8) - 1);
}

// ================================================================ sound

/// Each place's ticket is a bijection of the first ticket, so every ticket has the same chance
/// at every place, and no ticket wins twice in one draw. The expected value of any set of
/// tickets is its share of the tickets, wherever they sit in the list. (Places are correlated:
/// a buyer can make winning several places together, or winning exactly one, more likely, but
/// not their expected share larger.)
#[test]
fn sound_every_place_is_a_fair_draw() {
    for sold in 1..=40u64 {
        for set in 1..=8usize {
            let winners = record(sold, set, 0).winners();
            assert_eq!(winners, (set as u64).min(sold));
            let mut wins = vec![vec![0u32; sold as usize]; winners as usize];
            for first in 0..sold {
                let l = record(sold, set, first);
                let tickets: Vec<u64> = (0..winners as u8).map(|p| l.ticket_of_place(p)).collect();
                let mut unique = tickets.clone();
                unique.sort();
                unique.dedup();
                assert_eq!(unique.len(), tickets.len(), "a ticket won twice: sold {sold}, set {set}, first {first}");
                for (place, ticket) in tickets.into_iter().enumerate() {
                    wins[place][ticket as usize] += 1;
                }
            }
            assert!(wins.iter().all(|place| place.iter().all(|n| *n == 1)), "sold {sold}, set {set}");
        }
    }
}

/// The old lottery (no places given): one winner, the whole pot as it is at payout, the list's
/// rent to the winner, the next round open. A second place does not exist.
#[test]
fn sound_a_single_winner_lottery_still_takes_the_whole_pot() {
    let (mut env, [a, _, _]) = lottery(vec![]);
    let gold = env.mint;
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(2)).unwrap(); // ticket 2: a's
    assert_eq!(env.lottery(1).winner, a.pubkey());
    // A sponsor's deposit after the draw is won with the rest, as before.
    let sponsor = player(&mut env, 300);
    env.deposit(&sponsor, 0, gold, 300).unwrap();
    assert!(err(env.pay_lottery_place(1, 1, ata(&a.pubkey(), &gold))).contains("PlacePaid"));
    let before = my(&env, &a.pubkey());
    let paid: LotteryPaid = receipt(&env.pay_lottery(1, ata(&a.pubkey(), &gold)).unwrap());
    assert_eq!((paid.amount, my(&env, &a.pubkey()) - before), (1_400, 1_400));
    assert_eq!(env.tokens(&pool_pda(&env.game, 0)), 0);
    let l = env.lottery(1);
    assert_eq!((l.round, l.status, l.sold, l.paid, l.pot_at_payout), (1, Round::Open, 0, 0, 0));
}

/// A stranger who adds to the pot before the first payout raises every place by the same
/// share and loses what the places leave; after the first payout it only rolls over. Neither
/// moves value from one winner to another. Place numbers are checked, and so is each winner.
#[test]
fn sound_a_stranger_cannot_move_value_between_places() {
    let (mut env, [a, b, c]) = lottery(vec![5_000, 3_000, 1_000]);
    let gold = env.mint;
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(13)).unwrap(); // b, c, c
    let stranger = player(&mut env, 1_000);
    env.deposit(&stranger, 0, gold, 900).unwrap(); // the pot is 2,000
    let (bt, ct) = (ata(&b.pubkey(), &gold), ata(&c.pubkey(), &gold));
    for place in [8u8, 9, 255] {
        assert!(err(env.pay_lottery_place(1, place, ct)).contains("PlacePaid"));
    }
    assert!(err(env.pay_lottery_place(1, 0, ata(&a.pubkey(), &gold))).contains("NotThePlayers"));
    assert!(err(env.pay_lottery_place(1, 0, ct)).contains("NotThePlayers"));
    let mut amounts = vec![];
    for (place, to) in [(2u8, ct), (0, bt), (1, ct)] {
        let paid: LotteryPaid = receipt(&env.pay_lottery_place(1, place, to).unwrap());
        amounts.push((paid.place, paid.amount));
        if place == 2 {
            // After the first payout, more money only rolls over.
            env.deposit(&stranger, 0, gold, 100).unwrap();
        }
    }
    assert_eq!(amounts, vec![(2, 200), (0, 1_000), (1, 600)]);
    assert_eq!(env.tokens(&pool_pda(&env.game, 0)), 200 + 100, "the 10% the places leave, and the late deposit, roll over");
}

/// A lottery that burns `ticket_mint` tickets, with two places and a pot that was never opened,
/// still ends: both places are paid nothing and the next round opens.
#[test]
fn sound_a_ticket_mint_lottery_with_places_and_no_pot_still_ends() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let kills = env.new_mint(owner.pubkey());
    let args = LotteryArgs { price: 1, pot: 5, cut_bps: 0, places: vec![6_000, 4_000], ticket_mint: kills, every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();
    let (a, b) = (player(&mut env, 0), player(&mut env, 0));
    for who in [&a, &b] {
        env.fund(who.pubkey(), kills, 5);
        env.buy_tickets(who, 1, 5, kills).unwrap();
    }
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(0)).unwrap(); // tickets 0 (a) and 5 (b)
    env.pay_lottery_place(1, 1, ata(&b.pubkey(), &kills)).unwrap();
    env.pay_lottery_place(1, 0, ata(&a.pubkey(), &kills)).unwrap();
    assert_eq!((env.lottery(1).round, env.lottery(1).status), (1, Round::Open));
}

/// The weight arithmetic at its edges: no overflow, never above the weight, 0 only when none
/// is left, at least 1 while one is.
#[test]
fn sound_stock_odds_at_the_edges() {
    assert_eq!(by_stock(u32::MAX, 1, 0), u32::MAX);
    assert_eq!(by_stock(u32::MAX, u32::MAX, u32::MAX - 1), 1);
    assert_eq!(by_stock(1, u32::MAX, 0), 1);
    assert_eq!(by_stock(1, u32::MAX, u32::MAX - 1), 1);
    assert_eq!(by_stock(7, 10, 11), 0, "more issued than the supply: nothing left");
    assert_eq!(by_stock(7, 0, u32::MAX), 7);
    for weight in [1u32, 2, 3, 999, u32::MAX] {
        for max in [1u32, 2, 7, 100, u32::MAX] {
            for issued in [0u32, 1, max / 2, max.saturating_sub(1), max] {
                let w = by_stock(weight, max, issued);
                assert!(w <= weight);
                assert_eq!(w == 0, issued >= max);
            }
        }
    }
}

/// A sold-out item in a `stock_odds` box is skipped like in any box, and the other entries keep
/// their weights.
#[test]
fn sound_a_stock_odds_box_skips_what_is_sold_out() {
    let mut env = setup();
    env.upsert_item(40, item(ItemKind::Collectible, "Mythic", 1, PRICE)).unwrap();
    env.upsert_item(41, item(ItemKind::Collectible, "Common", 0, PRICE)).unwrap();
    env.buy(40, 1).unwrap();
    env.upsert_box_args(8, BoxArgs { stock_odds: true, ..boxed(PRICE, vec![item_drop(40, u32::MAX), item_drop(41, 1)]) }).unwrap();
    let p = env.player.insecure_clone();
    for (nonce, number) in [(2, 0), (3, u64::MAX)] {
        let order = open_as(&mut env, &p, 8, nonce, number);
        assert_eq!(env.acc::<Order>(&order).outcome, Outcome::Item(41));
    }
}

/// A falling price at its edges: a floor above the price, a step bigger than the price, a start
/// in the future, a fall to 0, and the buyer's `max_price`.
#[test]
fn sound_a_fall_at_its_edges() {
    let mut env = setup();
    let now = env.now();
    let paid = |env: &Env, nonce| env.acc::<Order>(&order_pda(&env.game, &env.player.pubkey(), nonce)).paid;

    // A floor above the price: it never moves.
    env.upsert_item(80, ItemArgs { fall: Some(Fall { step: 10, every: 1, floor: 500, since: now }), ..item(ItemKind::Collectible, "A", 0, 100) }).unwrap();
    // A step of everything, every second: the floor at once.
    env.upsert_item(81, ItemArgs { fall: Some(Fall { step: u64::MAX, every: 1, floor: 7, since: now }), ..item(ItemKind::Collectible, "B", 0, 100) }).unwrap();
    // A start a year away: the price holds, and a sale leaves the start alone.
    env.upsert_item(82, ItemArgs { fall: Some(Fall { step: 10, every: 1, floor: 1, since: now + 365 * DAY }), ..item(ItemKind::Collectible, "C", 0, 100) }).unwrap();
    // A floor of 0: the price reaches 0 and the item is no longer for sale.
    env.upsert_item(83, ItemArgs { fall: Some(Fall { step: 50, every: 1, floor: 0, since: now }), ..item(ItemKind::Collectible, "D", 0, 100) }).unwrap();
    env.wait(DAY);

    env.buy(80, 1).unwrap();
    env.buy(81, 2).unwrap();
    env.buy(82, 3).unwrap();
    assert_eq!((paid(&env, 1), paid(&env, 2), paid(&env, 3)), (100, 7, 100));
    assert_eq!(env.item_state(82).fall.unwrap().since, now + 365 * DAY);
    assert!(err(env.buy(83, 4)).contains("NotForSale"));
    assert_eq!(env.item_state(83).price, 100, "a refused sale changes nothing");

    // The buyer's limit is checked against the fallen price.
    env.upsert_item(84, ItemArgs { fall: Some(Fall { step: 10, every: 1, floor: 50, since: env.now() }), ..item(ItemKind::Collectible, "E", 0, 100) }).unwrap();
    env.wait(2);
    let p = env.player.insecure_clone();
    let ix = env.buy_ix_max(84, 5, 79);
    assert!(err(env.send(&[ix], &[&p])).contains("PriceAboveMax"));
    let ix = env.buy_ix_max(84, 5, 80);
    env.send(&[ix], &[&p]).unwrap();
}

/// A box priced in another mint can carry a `Share` of a pool in the game's mint: the prize is
/// paid in the pool's mint, only to an account of the player in that mint.
#[test]
fn sound_a_share_from_a_box_in_another_currency_pays_in_the_pools_mint() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let c = env.cranker.insecure_clone();
    let gems = env.new_mint(owner.pubkey());
    jackpot(&mut env, 1, 1_000);
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), gems, 100);
    let entries = vec![DropEntry { outcome: Outcome::Share { pool: 1, bps: 5_000 }, weight: 1 }];
    let args = BoxArgs { currency: Some(gems), shares: vec![burn(10_000)], ..boxed(10, entries) };
    env.upsert_box_args(30, args).unwrap();
    let order = open_as(&mut env, &p, 30, 1, 0);
    assert!(env.settle_prize(order, Some(ata(&p.pubkey(), &gems)), &c).is_err(), "not into the player's gem account");
    let stranger = player(&mut env, 0);
    assert!(err(env.settle_prize(order, Some(ata(&stranger.pubkey(), &env.mint)), &c)).contains("NotThePlayers"));
    let before = my(&env, &p.pubkey());
    env.settle_prize(order, Some(ata(&p.pubkey(), &env.mint)), &c).unwrap();
    assert_eq!((my(&env, &p.pubkey()) - before, env.tokens(&ata(&p.pubkey(), &gems))), (500, 90));
}

/// A recipe's `Share` only pays from a pool of the mint it names, and never `times` over.
#[test]
fn sound_a_recipe_share_names_its_mint() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let gold = env.mint;
    let other = env.new_mint(owner.pubkey());
    jackpot(&mut env, 0, 1_000);
    let p = player(&mut env, 100);
    env.token_account(p.pubkey(), other);
    let recipe = |mint| RecipeArgs {
        active: true,
        inputs: vec![Input::Pay { mint: gold, amount: 10, to: loot::state::To::Burn }],
        outputs: vec![Output::Share { mint, pool: 0, bps: 1_000 }],
        needs: vec![],
        keeps: vec![],
    };
    env.upsert_recipe(&owner, 1, recipe(other)).unwrap();
    assert!(err(env.craft(&p, 1, &[])).contains("WrongPool"));
    env.upsert_recipe(&owner, 1, recipe(gold)).unwrap();
    assert!(err(env.craft_times(&p, 1, 3, &[])).contains("OnceAtATime"));
    env.craft(&p, 1, &[]).unwrap();
    assert_eq!(env.tokens(&pool_pda(&env.game, 0)), 900);
}
