//! The four pieces added after the list of 100 economies (2026-10-11), in LiteSVM against the
//! real program binary: a price that falls with time, odds that shrink with stock, a prize
//! that is a share of a pool, and a lottery with several places. Each test is a small economy
//! a game could run.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    loot::{
        receipts::{LotteryDrawn, LotteryPaid},
        state::{DropEntry, Fall, ItemKind, LootBox, Order, Outcome, Rise},
        BoxArgs, Input, ItemArgs, LotteryArgs, Output, RecipeArgs, Round,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const MINUTE: i64 = 60;
const DAY: i64 = 24 * 60 * MINUTE;

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

fn paid(env: &Env, nonce: u64) -> u64 {
    env.acc::<Order>(&order_pda(&env.game, &env.player.pubkey(), nonce)).paid
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

// ================================================================ a price that falls

/// A drop at 1,000 that falls 100 a minute, from a minute from now, down to 400.
#[test]
fn a_price_falls_with_time_and_each_sale_starts_it_again() {
    let mut env = setup();
    let start = env.now() + MINUTE;
    let fall = Some(Fall { step: 100, every: MINUTE as u32, floor: 400, since: start });
    env.upsert_item(50, ItemArgs { fall, ..item(ItemKind::Collectible, "Comet", 0, 1_000) }).unwrap();
    assert!(err(env.upsert_item(51, ItemArgs { fall: Some(Fall { every: 0, ..fall.unwrap() }), ..item(ItemKind::Collectible, "Bad", 0, 1) })).contains("BadPrice"));
    assert!(err(env.upsert_item(51, ItemArgs { fall: Some(Fall { step: 0, ..fall.unwrap() }), ..item(ItemKind::Collectible, "Bad", 0, 1) })).contains("BadPrice"));

    // Before the start it holds.
    env.buy(50, 1).unwrap();
    assert_eq!(paid(&env, 1), 1_000);

    // Three minutes past the start: 700. The buyer signed for 1,000 and pays 700.
    env.wait(4 * MINUTE);
    env.buy(50, 2).unwrap();
    assert_eq!(paid(&env, 2), 700);
    // The sale starts the fall again from 700.
    let comet = env.item_state(50);
    assert_eq!((comet.price, comet.fall.unwrap().since), (700, env.now()));
    env.wait(MINUTE - 1);
    env.buy(50, 3).unwrap();
    assert_eq!(paid(&env, 3), 700, "a minute has not passed since the last sale");

    // Then it rests on its floor.
    env.wait(DAY);
    env.buy(50, 4).unwrap();
    assert_eq!(paid(&env, 4), 400);
}

/// A throne that costs 50% more with each buyer and loses 10 a minute while nobody buys.
#[test]
fn a_price_that_rises_with_sales_and_falls_with_time() {
    let mut env = setup();
    let fall = Some(Fall { step: 10, every: MINUTE as u32, floor: 100, since: env.now() });
    let throne = ItemArgs { rise: Some(Rise { step: 0, growth_bps: 5_000 }), fall, ..item(ItemKind::Collectible, "Throne", 0, 200) };
    env.upsert_item(60, throne).unwrap();
    env.buy(60, 1).unwrap();
    assert_eq!((paid(&env, 1), env.item_state(60).price), (200, 300));
    env.wait(5 * MINUTE);
    env.buy(60, 2).unwrap();
    assert_eq!((paid(&env, 2), env.item_state(60).price), (250, 375));

    // A box falls the same way.
    let falling = BoxArgs { fall: Some(Fall { step: 100, every: MINUTE as u32, floor: 100, since: env.now() }), ..boxed(300, vec![item_drop(60, 1)]) };
    env.upsert_box_args(6, falling).unwrap();
    env.wait(MINUTE);
    env.open_box(6, 3).unwrap();
    assert_eq!(paid(&env, 3), 200);
    assert_eq!(env.acc::<LootBox>(&box_pda(&env.game, 6)).price, 200);
}

// ================================================================ odds that shrink with stock

/// A mythic of 11 and a common with no limit, at equal weights. Ten mythics are gone, so with
/// `stock_odds` the last one weighs 1,000 × 1/11, rounded up: 91.
#[test]
fn an_items_odds_shrink_with_what_is_left_of_it() {
    let mut env = setup();
    env.upsert_item(40, item(ItemKind::Collectible, "Mythic", 11, PRICE)).unwrap();
    env.upsert_item(41, item(ItemKind::Collectible, "Common", 0, PRICE)).unwrap();
    for nonce in 1..=9 {
        env.buy(40, nonce).unwrap();
    }
    let entries = vec![item_drop(40, 1_000), item_drop(41, 1_000)];
    env.upsert_box_args(7, boxed(PRICE, entries.clone())).unwrap();
    env.upsert_box_args(8, BoxArgs { stock_odds: true, ..boxed(PRICE, entries) }).unwrap();
    let p = env.player.pubkey();
    let roll = |env: &mut Env, box_id, nonce, number| {
        env.open_box(box_id, nonce).unwrap();
        env.callback_of(box_id, order_pda(&env.game, &p, nonce), rnd(number)).unwrap();
        env.acc::<Order>(&order_pda(&env.game, &p, nonce)).outcome
    };

    // In the plain box, 150 is a mythic (150 < 1,000): the tenth.
    assert_eq!(roll(&mut env, 7, 20, 150), Outcome::Item(40));
    // With stock odds, the same 150 is a common (the mythic is 91 of 1,091), and 90 still
    // wins the last mythic.
    assert_eq!(roll(&mut env, 8, 21, 150), Outcome::Item(41));
    assert_eq!(roll(&mut env, 8, 22, 90), Outcome::Item(40));
    assert_eq!(env.item_state(40).issued, 11);
}

// ================================================================ a share of a pool

/// A progressive jackpot: every box that misses feeds the pool, and a hit takes half of it.
#[test]
fn a_box_prize_can_be_a_share_of_what_a_pool_holds() {
    let mut env = setup();
    let c = env.cranker.insecure_clone();
    let p = env.player.pubkey();
    jackpot(&mut env, 1, 1_000);
    let entries = vec![DropEntry { outcome: Outcome::Share { pool: 1, bps: 5_000 }, weight: 1 }, DropEntry { outcome: Outcome::Nothing, weight: 1 }];
    let args = BoxArgs { shares: vec![pool(1, 10_000)], ..boxed(100, entries.clone()) };
    for bps in [0, 10_001] {
        let bad = vec![DropEntry { outcome: Outcome::Share { pool: 1, bps }, weight: 1 }];
        assert!(err(env.upsert_box_args(9, BoxArgs { entries: bad, ..args.clone() })).contains("BadEntries"));
    }
    env.upsert_box_args(9, args).unwrap();

    // A miss: the 100 paid goes into the jackpot.
    env.open_box(9, 1).unwrap();
    env.callback_of(9, order_pda(&env.game, &p, 1), rnd(1)).unwrap();
    env.settle_prize(order_pda(&env.game, &p, 1), None, &c).unwrap();
    assert_eq!(env.tokens(&pool_pda(&env.game, 1)), 1_100);

    // A hit: half of what the pool holds at the roll, fixed in the order then. This payment
    // joins the pool at the settle and stays for the next winner.
    let before = my(&env, &p);
    env.open_box(9, 2).unwrap();
    env.callback_of(9, order_pda(&env.game, &p, 2), rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&order_pda(&env.game, &p, 2)).outcome, Outcome::Pay { pool: 1, amount: 550 });
    env.settle_prize(order_pda(&env.game, &p, 2), Some(ata(&p, &env.mint)), &c).unwrap();
    assert_eq!((my(&env, &p) + 100 - before, env.tokens(&pool_pda(&env.game, 1))), (550, 650));

    // A share of an empty pool is nothing to win, and a box with nothing else is sold out.
    jackpot(&mut env, 2, 0);
    env.upsert_box_args(10, boxed(100, vec![DropEntry { outcome: Outcome::Share { pool: 2, bps: 5_000 }, weight: 1 }])).unwrap();
    assert!(err(env.open_box(10, 3)).contains("SoldOut"));
}

/// A golden ticket cashed in for a tenth of the treasure, whatever it holds by then.
#[test]
fn a_recipe_can_give_a_share_of_what_a_pool_holds() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let gold = env.mint;
    jackpot(&mut env, 0, 1_000);
    let p = player(&mut env, 100);
    let cash_in = |bps| RecipeArgs {
        active: true,
        inputs: vec![Input::Pay { mint: gold, amount: 10, to: loot::state::To::Burn }],
        outputs: vec![Output::Share { mint: gold, pool: 0, bps }],
        needs: vec![],
        keeps: vec![],
    };
    assert!(err(env.upsert_recipe(&owner, 1, cash_in(0))).contains("BadRecipe"));
    assert!(err(env.upsert_recipe(&owner, 1, cash_in(10_001))).contains("BadRecipe"));
    env.upsert_recipe(&owner, 1, cash_in(1_000)).unwrap();

    env.craft(&p, 1, &[]).unwrap();
    assert_eq!((my(&env, &p.pubkey()), env.tokens(&pool_pda(&env.game, 0))), (90 + 100, 900));
    env.craft(&p, 1, &[]).unwrap();
    assert_eq!((my(&env, &p.pubkey()), env.tokens(&pool_pda(&env.game, 0))), (80 + 190, 810));
    assert!(err(env.craft_times(&p, 1, 2, &[])).contains("OnceAtATime"), "a share is taken one craft at a time");
}

// ================================================================ a lottery with places

/// Three places of 50%, 30% and 10% of the pot, and three players holding tickets 0..3, 3..4
/// and 4..10.
fn lottery_with_places(places: Vec<u16>) -> (Env, [Keypair; 3]) {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    jackpot(&mut env, 0, 0);
    let args = LotteryArgs { price: 10, pot: 0, cut_bps: 0, places, ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();
    let players = [player(&mut env, 1_000), player(&mut env, 1_000), player(&mut env, 1_000)];
    for (who, count) in players.iter().zip([3, 1, 6]) {
        env.buy_tickets(who, 1, count, env.mint).unwrap();
    }
    (env, players)
}

#[test]
fn a_lottery_pays_each_place_its_share_and_rolls_the_rest_over() {
    let (mut env, [a, b, c]) = lottery_with_places(vec![5_000, 3_000, 1_000]);
    let owner = env.creator.insecure_clone();
    let pot = pool_pda(&env.game, 0);
    env.fund(owner.pubkey(), env.mint, 1_000);
    env.deposit(&owner, 0, env.mint, 1_000).unwrap();
    assert_eq!(env.tokens(&pot), 1_100);

    // 13 picks ticket 3 for first place (b's). Ten tickets, three places: the others are
    // three tickets on, 6 and 9, both c's.
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    let drawn: LotteryDrawn = receipt(&env.lottery_callback(1, rnd(13)).unwrap());
    assert_eq!((drawn.winning_ticket, drawn.winners), (3, vec![b.pubkey(), c.pubkey(), c.pubkey()]));

    // Each place is paid on its own, to its own winner, once.
    let gold = env.mint;
    let to = |who: &Keypair| ata(&who.pubkey(), &gold);
    assert!(err(env.pay_lottery_place(1, 1, to(&b))).contains("NotThePlayers"));
    assert!(err(env.pay_lottery_place(1, 1, to(&a))).contains("NotThePlayers"));
    let first: LotteryPaid = receipt(&env.pay_lottery_place(1, 0, to(&b)).unwrap());
    assert_eq!((first.place, first.winner, first.amount), (0, b.pubkey(), 550));
    assert!(err(env.pay_lottery_place(1, 0, to(&b))).contains("PlacePaid"));
    assert!(err(env.pay_lottery_place(1, 3, to(&c))).contains("PlacePaid"), "there is no fourth place");

    // Money that arrives meanwhile does not change the shares: they are of the pot at payout.
    env.fund(owner.pubkey(), env.mint, 500);
    env.deposit(&owner, 0, env.mint, 500).unwrap();
    env.pay_lottery_place(1, 2, to(&c)).unwrap();
    assert_eq!(env.lottery(1).status, Round::Drawn, "one place is still unpaid");
    env.pay_lottery_place(1, 1, to(&c)).unwrap();
    assert_eq!((my(&env, &b.pubkey()), my(&env, &c.pubkey())), (990 + 550, 940 + 330 + 110));

    // The last place paid ends the round. 10% of the pot, and the deposit, roll over.
    let l = env.lottery(1);
    assert_eq!((l.round, l.status, l.sold, l.paid), (1, Round::Open, 0, 0));
    assert_eq!(env.tokens(&pot), 1_100 - 550 - 330 - 110 + 500);
}

#[test]
fn a_round_with_fewer_tickets_than_places_has_fewer_winners() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    jackpot(&mut env, 0, 0);
    let args = LotteryArgs { price: 10, pot: 0, cut_bps: 0, places: vec![5_000, 5_000], ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY };
    for places in [vec![5_000, 0, 1], vec![1; 9], vec![5_000, 5_001]] {
        assert!(err(env.upsert_lottery(&owner, 1, LotteryArgs { places, ..args.clone() })).contains("BadLottery"));
    }
    env.upsert_lottery(&owner, 1, args).unwrap();
    let a = player(&mut env, 100);
    env.buy_tickets(&a, 1, 1, env.mint).unwrap();
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(7)).unwrap();
    assert!(err(env.pay_lottery_place(1, 1, ata(&a.pubkey(), &env.mint))).contains("PlacePaid"), "one ticket, one winner");
    env.pay_lottery_place(1, 0, ata(&a.pubkey(), &env.mint)).unwrap();
    // Half the pot was won; second place's half stays for next round.
    assert_eq!((env.lottery(1).round, env.tokens(&pool_pda(&env.game, 0))), (1, 5));
}

#[test]
fn every_place_has_its_own_ticket() {
    // Ten tickets and three places, three apart: from any first ticket, three different ones.
    for number in 0..10u64 {
        let (mut env, _) = lottery_with_places(vec![3_000, 3_000, 3_000]);
        env.wait(DAY);
        env.draw_lottery(1).unwrap();
        env.lottery_callback(1, rnd(number)).unwrap();
        let l = env.lottery(1);
        let tickets: Vec<u64> = (0..3).map(|place| l.ticket_of_place(place)).collect();
        assert_eq!(tickets, vec![number, (number + 3) % 10, (number + 6) % 10]);
    }
}
