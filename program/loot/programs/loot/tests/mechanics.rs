//! The mechanics a game runs without its authority, in LiteSVM against the real program
//! binary: schedules, exchanges, the lottery, staking and merges. In every test below the
//! owner sets a mechanic up once; after that only players and a keeper with no key of the
//! game send anything.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    loot::{
        state::{ItemKind, To},
        Action, GameUpdate, Input, ItemArgs, LotteryArgs, Origin, Output, RecipeArgs, Round, ScheduleArgs,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 24 * 60 * 60;

/// A new wallet with SOL and `amount` of `mint`.
fn player(env: &mut Env, mint: Pubkey, amount: u64) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    env.fund(k.pubkey(), mint, amount);
    k
}

/// A new wallet with SOL and `amount` of the game's own token.
fn coin_player(env: &mut Env, amount: u64) -> Keypair {
    let mint = env.mint;
    player(env, mint, amount)
}

fn err<T>(r: Result<T, String>) -> String {
    r.err().expect("expected the transaction to fail")
}

// ================================================================ schedules

#[test]
fn an_emission_mints_on_its_timer_and_halves() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let points = env.new_mint(env.game); // a mint the game controls
    env.open_pool(&owner, 0, points).unwrap();
    let rewards = pool_pda(&env.game, 0);
    let start = env.now() + DAY;
    let emission = |max_runs| ScheduleArgs {
        active: true,
        action: Action::Issue { mint: points, pool: 0, amount: 1_000, halve_every: 2 },
        every: DAY,
        next_at: start,
        max_runs,
    };
    assert!(err(env.upsert_schedule(&authority, 1, emission(5))).contains("NotOwner"));
    assert!(err(env.upsert_schedule(&owner, 1, ScheduleArgs { every: 0, ..emission(5) })).contains("BadSchedule"));
    env.upsert_schedule(&owner, 1, emission(5)).unwrap();

    // Not before its time, and one run for each day that has passed.
    assert!(err(env.run_schedule(1, points, rewards)).contains("NotDue"));
    env.wait(DAY);
    env.run_schedule(1, points, rewards).unwrap();
    assert!(err(env.run_schedule(1, points, rewards)).contains("NotDue"));
    assert_eq!(env.tokens(&rewards), 1_000);

    // It fell three days behind: three runs catch it up. 1000, 1000, 500, 500.
    env.wait(3 * DAY);
    for _ in 0..3 {
        env.run_schedule(1, points, rewards).unwrap();
    }
    assert_eq!(env.tokens(&rewards), 3_000);
    // Switched off, it does not run. An edit keeps the count, so the fifth run is still the
    // last and still halved twice.
    env.upsert_schedule(&owner, 1, ScheduleArgs { active: false, next_at: env.now(), ..emission(5) }).unwrap();
    assert!(err(env.run_schedule(1, points, rewards)).contains("ScheduleOver"));
    env.upsert_schedule(&owner, 1, ScheduleArgs { next_at: env.now(), ..emission(5) }).unwrap();
    let logs = env.run_schedule(1, points, rewards).unwrap();
    let ran: loot::receipts::ScheduleRan = receipt(&logs);
    assert_eq!((ran.run, ran.amount), (5, 250));
    env.wait(DAY);
    assert!(err(env.run_schedule(1, points, rewards)).contains("ScheduleOver"));
    assert_eq!(env.supply(&points), 3_250);
    assert_eq!(env.fees(), 0, "running a schedule costs no fee");
}

#[test]
fn a_schedule_burns_or_moves_a_share_of_a_pool() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    for index in 0..3 {
        env.open_pool(&owner, index, env.mint).unwrap();
    }
    let (treasury_pool, stakers, other) = (pool_pda(&env.game, 0), pool_pda(&env.game, 1), pool_pda(&env.game, 2));
    env.fund(owner.pubkey(), env.mint, 1_000);
    env.deposit(&owner, 0, env.mint, 1_000).unwrap();
    let supply = env.supply(&env.mint);
    let now = env.now();
    let args = |action| ScheduleArgs { active: true, action, every: DAY, next_at: now, max_runs: 0 };
    env.upsert_schedule(&owner, 1, args(Action::Burn { pool: 0, bps: 500 })).unwrap();
    env.upsert_schedule(&owner, 2, args(Action::Move { from: 0, to: 1, bps: 2_000 })).unwrap();
    assert!(err(env.upsert_schedule(&owner, 3, args(Action::Burn { pool: 0, bps: 10_001 }))).contains("BadSchedule"));

    // 5% of 1000 burned, then 20% of the 950 left moved to the stakers' pool.
    env.run_schedule(1, env.mint, treasury_pool).unwrap();
    assert_eq!((env.tokens(&treasury_pool), supply - env.supply(&env.mint)), (950, 50));
    env.run_schedule(2, treasury_pool, stakers).unwrap();
    assert_eq!((env.tokens(&treasury_pool), env.tokens(&stakers)), (760, 190));

    // A schedule only touches the pools it names.
    env.wait(DAY);
    assert!(err(env.run_schedule(1, env.mint, other)).contains("WrongPool"));
    assert!(err(env.run_schedule(2, treasury_pool, other)).contains("WrongPool"));
    assert!(err(env.run_schedule(2, stakers, treasury_pool)).contains("WrongPool"));
    assert!(err(env.run_schedule(2, ata(&env.game, &env.mint), stakers)).contains("WrongPool"), "never the order vault");
}

// ================================================================ exchanges

/// What a converter was: a recipe of tokens only, crafted many times at once.
#[test]
fn a_recipe_of_tokens_is_an_exchange_at_the_owners_rate() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let gems = env.new_mint(owner.pubkey()); // what players give
    let points = env.new_mint(env.game); // minted by the game
    let p = player(&mut env, gems, 1_000);
    env.token_account(p.pubkey(), points);
    env.token_account(p.pubkey(), env.mint);
    env.open_pool(&owner, 0, gems).unwrap();
    env.open_pool(&owner, 1, env.mint).unwrap();
    env.fund(owner.pubkey(), env.mint, 500);
    env.deposit(&owner, 1, env.mint, 500).unwrap();

    // 1: burn gems, mint 3 points for every 2. 2: gems into a pool, coins out of another, 1 for 10.
    let exchange = |take, to, give_mint, give, from| RecipeArgs {
        active: true,
        inputs: vec![Input::Pay { mint: gems, amount: take, to }],
        outputs: vec![Output::Tokens { mint: give_mint, amount: give, from }],
        needs: vec![],
        keeps: vec![],
    };
    let burn_for_points = exchange(2, To::Burn, points, 3, Origin::Issue);
    assert!(err(env.upsert_recipe(&p, 1, burn_for_points.clone())).contains("NotOwner"));
    env.upsert_recipe(&owner, 1, burn_for_points.clone()).unwrap();
    env.upsert_recipe(&owner, 2, exchange(10, To::Pool(0), env.mint, 1, Origin::Pool(1))).unwrap();

    let (mut ix, _) = env.craft_ix(p.pubkey(), 1, 0, &[]);
    ix.data = anchor_lang::InstructionData::data(&loot::instruction::Craft { version: 0, times: 50 });
    let logs = env.send(&[ix], &[&p]).unwrap();
    let c: loot::receipts::Crafted = receipt(&logs);
    assert_eq!(c.times, 50);
    assert_eq!((env.supply(&gems), env.tokens(&ata(&p.pubkey(), &points))), (900, 150));

    env.craft_times(&p, 2, 25, &[]).unwrap();
    assert_eq!((env.tokens(&pool_pda(&env.game, 0)), env.tokens(&pool_pda(&env.game, 1))), (250, 475));
    assert_eq!(env.tokens(&ata(&p.pubkey(), &env.mint)), 25);

    // The player signs the recipe they saw: a worse rate that lands first does not short them.
    let (mut signed, _) = env.craft_ix(p.pubkey(), 1, 0, &[]);
    signed.data = anchor_lang::InstructionData::data(&loot::instruction::Craft { version: 0, times: 50 });
    env.upsert_recipe(&owner, 1, exchange(2, To::Burn, points, 2, Origin::Issue)).unwrap();
    assert!(err(env.send(&[signed], &[&p])).contains("RecipeChanged"));
    // Nothing at all; more than fits; a wrong pool; switched off; the owner's pause.
    assert!(err(env.craft_times(&p, 2, 0, &[])).contains("ZeroAmount"));
    assert!(err(env.craft_times(&p, 2, u64::MAX, &[])).contains("Overflow"));
    let (mut ix, _) = env.craft_ix(p.pubkey(), 2, 0, &[]);
    let at = ix.accounts.iter().position(|m| m.pubkey == pool_pda(&env.game, 1)).unwrap();
    ix.accounts[at].pubkey = ata(&env.game, &env.mint);
    assert!(err(env.send(&[ix], &[&p])).contains("WrongPool"));
    env.upsert_recipe(&owner, 1, RecipeArgs { active: false, ..burn_for_points }).unwrap();
    assert!(err(env.craft_times(&p, 1, 1, &[])).contains("NotForSale"));
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(true) }).unwrap();
    assert!(err(env.craft_times(&p, 2, 1, &[])).contains("Paused"));
}

// ================================================================ the lottery

const POT: u8 = 0;

/// A weekly lottery at 10 a ticket with a 10% cut, and three players holding tickets
/// 0..3, 3..4 and 4..10.
fn lottery_with_ten_tickets() -> (Env, [Keypair; 3]) {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, POT, env.mint).unwrap();
    let args = LotteryArgs { price: 10, pot: POT, cut_bps: 1_000, places: vec![], ticket_mint: Pubkey::default(), every: 7 * DAY, draws_at: env.now() + 7 * DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();
    let players = [coin_player(&mut env, 1_000), coin_player(&mut env, 1_000), coin_player(&mut env, 1_000)];
    for (who, count) in players.iter().zip([3, 1, 6]) {
        env.buy_tickets(who, 1, count, env.mint).unwrap();
    }
    (env, players)
}

#[test]
fn a_lottery_sells_draws_and_pays_with_no_key_of_the_game() {
    let (mut env, players) = lottery_with_ten_tickets();
    let owner = env.creator.insecure_clone();
    let lottery = env.mechanic_pda(loot::LOTTERY_SEED, 1);
    let pot = pool_pda(&env.game, POT);
    // 100 paid: 10 to the treasury, 90 in the pot. The owner adds a 500 jackpot.
    assert_eq!((env.tokens(&env.treasury), env.tokens(&pot), env.lottery(1).sold), (10, 90, 10));
    env.fund(owner.pubkey(), env.mint, 500);
    env.deposit(&owner, POT, env.mint, 500).unwrap();
    // Each purchase is one 40-byte line the buyer paid the rent of.
    let head = env.data(&lottery).len() - 3 * 40;
    assert_eq!(env.lamports(&lottery), env.rent(head + 120));
    // The owner cannot change the rules of a round that has sold tickets.
    let changed = LotteryArgs { price: 1, pot: POT, cut_bps: 10_000, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at: 0 };
    assert!(err(env.upsert_lottery(&owner, 1, changed)).contains("RoundRunning"));

    // Not drawn early; no sales once the draw is due.
    assert!(err(env.draw_lottery(1)).contains("NotDue"));
    env.wait(7 * DAY);
    assert!(err(env.buy_tickets(&players[0], 1, 1, env.mint)).contains("SalesClosed"));
    env.draw_lottery(1).unwrap();
    assert_eq!(env.lottery(1).status, Round::Drawing);
    assert!(err(env.draw_lottery(1)).contains("NotDue"), "asked once");

    // The oracle's number is 13: ticket 3 of 10, which the second player holds.
    let logs = env.lottery_callback(1, rnd(13)).unwrap();
    let drawn: loot::receipts::LotteryDrawn = receipt(&logs);
    let winner = players[1].pubkey();
    assert_eq!((drawn.winning_ticket, drawn.winners.clone(), drawn.round), (3, vec![winner], 0));
    assert!(env.lottery_callback(1, rnd(0)).is_err(), "drawn once");

    // Anyone pays the winner, and only the winner.
    let stranger_token = ata(&players[0].pubkey(), &env.mint);
    assert!(err(env.pay_lottery(1, stranger_token)).contains("NotThePlayers"));
    let (had, sol) = (env.tokens(&ata(&winner, &env.mint)), env.lamports(&winner));
    let logs = env.pay_lottery(1, ata(&winner, &env.mint)).unwrap();
    let paid: loot::receipts::LotteryPaid = receipt(&logs);
    assert_eq!((paid.amount, paid.winner), (590, winner));
    assert_eq!((env.tokens(&ata(&winner, &env.mint)) - had, env.tokens(&pot)), (590, 0));
    // The winner also gets the rent of the list, and the list is empty again.
    assert_eq!(env.lamports(&winner) - sol, env.rent(head + 120) - env.rent(head));
    assert_eq!(env.data(&lottery).len(), head);

    // The next round is open, a week on, and the owner may change it now.
    let l = env.lottery(1);
    assert_eq!((l.round, l.status, l.sold), (1, Round::Open, 0));
    assert!(l.draws_at > env.now() && l.draws_at <= env.now() + 7 * DAY);
    env.buy_tickets(&players[2], 1, 2, env.mint).unwrap();
    assert!(env.pay_lottery(1, stranger_token).is_err(), "nothing to pay until the next draw");
}

#[test]
fn every_ticket_wins_for_its_holder() {
    for (number, holder) in [(0u64, 0usize), (2, 0), (3, 1), (4, 2), (9, 2), (10, 0), (19, 2)] {
        let (mut env, players) = lottery_with_ten_tickets();
        env.wait(7 * DAY);
        env.draw_lottery(1).unwrap();
        env.lottery_callback(1, rnd(number)).unwrap();
        assert_eq!(env.lottery(1).winner, players[holder].pubkey(), "number {number}");
    }
}

#[test]
fn a_draw_the_oracle_never_answers_is_asked_again_and_only_the_newest_counts() {
    let (mut env, _) = lottery_with_ten_tickets();
    let c = env.cranker.insecure_clone();
    env.wait(7 * DAY);
    env.draw_lottery(1).unwrap();
    let first = env.lottery(1).asked_slot;
    env.wait_slots(loot::STALE_SLOTS);
    assert!(err(env.draw_lottery(1)).contains("NotDue"));
    env.wait_slots(1);
    env.draw_lottery(1).unwrap();

    // The first request's answer arrives late: refused. The second's is taken.
    let late = env.lottery_callback_ix(1, first, rnd(0));
    assert!(err(env.send_unsigned(&[late], &c)).contains("NotDue"));
    env.lottery_callback(1, rnd(0)).unwrap();
    // Only the oracle answers at all.
    let (mut env, _) = lottery_with_ten_tickets();
    env.wait(7 * DAY);
    env.draw_lottery(1).unwrap();
    let mut ix = env.lottery_callback_ix(1, env.lottery(1).asked_slot, rnd(0));
    ix.accounts[0].pubkey = c.pubkey();
    assert!(env.send_unsigned(&[ix], &c).is_err());
}

#[test]
fn a_round_nobody_bought_into_moves_to_its_next_date() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, POT, env.mint).unwrap();
    let due = env.now() + DAY;
    let args = LotteryArgs { price: 10, pot: POT, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at: due };
    assert!(err(env.upsert_lottery(&owner, 1, LotteryArgs { price: 0, ..args.clone() })).contains("BadLottery"));
    env.upsert_lottery(&owner, 1, args).unwrap();
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    let l = env.lottery(1);
    assert_eq!((l.status, l.draws_at, l.round), (Round::Open, due + DAY, 0));
}

// ================================================================ staking

const REWARDS: u8 = 3;

#[test]
fn stakers_share_what_flows_into_the_rewards_pool() {
    let mut env = setup();
    let (owner, authority, admin) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.admin.insecure_clone());
    let usd = env.new_mint(owner.pubkey()); // rewards in another currency than the stake
    env.open_pool(&owner, REWARDS, usd).unwrap();
    assert!(err(env.open_stake(&authority, 1, env.mint, REWARDS, usd, DAY)).contains("NotOwner"));
    env.open_stake(&owner, 1, env.mint, REWARDS, usd, DAY).unwrap();
    let (a, b) = (coin_player(&mut env, 1_000), coin_player(&mut env, 1_000));
    let (a_usd, b_usd) = (env.token_account(a.pubkey(), usd), env.token_account(b.pubkey(), usd));
    env.fund(owner.pubkey(), usd, 1_000);
    let reward = |env: &mut Env, amount| env.deposit(&owner, REWARDS, usd, amount).unwrap();

    // A stakes 100. 30 arrive: all A's. B stakes 300. 40 arrive: 10 A's, 30 B's.
    reward(&mut env, 5); // before anyone staked: it waits for the first stakers
    env.stake(&a, 1, 100, usd).unwrap();
    reward(&mut env, 25);
    env.stake(&b, 1, 300, usd).unwrap();
    assert_eq!(env.tokens(&env.staked_vault(1)), 400);
    reward(&mut env, 40);

    let logs = env.unstake(&a, 1, 0, usd).unwrap(); // zero: only collect
    let collected: loot::receipts::Unstaked = receipt(&logs);
    assert_eq!((collected.rewards, collected.staked, env.tokens(&a_usd)), (40, 100, 40));
    env.unstake(&a, 1, 0, usd).unwrap();
    assert_eq!(env.tokens(&a_usd), 40, "paid once");

    // Staked tokens and credited rewards are out of the authority's reach.
    for vault in [env.staked_vault(1), env.rewards_vault(1)] {
        let mut ix = env.payout_ix(authority.pubkey(), REWARDS, a_usd, 1);
        let at = ix.accounts.iter().position(|m| m.pubkey == pool_pda(&env.game, REWARDS)).unwrap();
        ix.accounts[at].pubkey = vault;
        assert!(err(env.send(&[ix], &[&authority])).contains("ConstraintSeeds"));
    }

    // Nothing comes out before the stake's lock has run: a day after the last stake.
    assert!(err(env.unstake(&b, 1, 300, usd)).contains("StillLocked"));
    env.wait(DAY);

    // Suspended and paused: no new stakes, and everyone still gets out with their rewards.
    env.set_suspended(&admin, true).unwrap();
    assert!(err(env.stake(&a, 1, 1, usd)).contains("Suspended"));
    assert!(err(env.unstake(&b, 1, 301, usd)).contains("MoreThanStaked"));
    let sol = env.lamports(&b.pubkey());
    let position = env.position_pda(1, &b.pubkey());
    let rent = env.lamports(&position);
    env.unstake(&b, 1, 300, usd).unwrap();
    assert_eq!((env.tokens(&b_usd), env.tokens(&ata(&b.pubkey(), &env.mint))), (30, 1_000));
    // A position that is empty is closed, and its rent comes back.
    assert!(!env.exists(&position));
    assert_eq!(env.lamports(&b.pubkey()) - sol, rent - FEE - 5_000);
    env.unstake(&a, 1, 100, usd).unwrap();
    assert_eq!((env.tokens(&env.staked_vault(1)), env.tokens(&env.rewards_vault(1))), (0, 0));
}

/// A share of every sale goes to the stakers, by a split and nothing else.
#[test]
fn a_sale_feeds_the_stakers() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, REWARDS, env.mint).unwrap();
    env.open_stake(&owner, 1, env.mint, REWARDS, env.mint, 0).unwrap();
    let staker = coin_player(&mut env, 100);
    env.stake(&staker, 1, 100, env.mint).unwrap();

    env.pay(1_000, vec![pool(REWARDS, 2_500)]).unwrap();
    env.unstake(&staker, 1, 100, env.mint).unwrap();
    assert_eq!(env.tokens(&ata(&staker.pubkey(), &env.mint)), 100 + 250);
}

// ================================================================ merges

#[test]
fn a_player_merges_three_shards_into_a_key() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = coin_player(&mut env, 0);
    let other = coin_player(&mut env, 0);
    env.upsert_item(20, item(ItemKind::Collectible, "Shard", 0, 0)).unwrap();
    env.upsert_item(21, item(ItemKind::Collectible, "Shard Key", 1, 0)).unwrap();
    env.upsert_item(22, ItemArgs { soulbound: true, ..item(ItemKind::Collectible, "Shar", 0, 0) }).unwrap();
    let recipe = merge_recipe(20, 3, 21);
    assert!(err(env.upsert_recipe(&p, 1, recipe.clone())).contains("NotOwner"));
    assert!(err(env.upsert_recipe(&owner, 1, merge_recipe(20, 9, 21))).contains("BadRecipe"));
    env.upsert_recipe(&owner, 1, recipe.clone()).unwrap();

    let shards: Vec<Pubkey> = (0..4).map(|_| env.make(&authority, 20, p.pubkey()).unwrap()).collect();
    let theirs = env.make(&authority, 20, other.pubkey()).unwrap();
    let key_item_as_input = env.make(&authority, 22, p.pubkey()).unwrap(); // "Shar #1": another item

    // Too few, someone else's, another item's, the same one twice.
    assert!(err(env.merge(&p, 1, &shards[..2])).contains("ItemMismatch"));
    assert!(err(env.merge(&p, 1, &[shards[0], shards[1], theirs])).contains("ItemMismatch"));
    assert!(err(env.merge(&p, 1, &[shards[0], shards[1], key_item_as_input])).contains("ItemMismatch"));
    assert!(env.merge(&p, 1, &[shards[0], shards[1], shards[1]]).is_err());

    let key = env.merge(&p, 1, &shards[..3]).unwrap();
    let a = *mpl_core::Asset::from_bytes(&env.data(&key)).unwrap();
    assert_eq!((a.base.owner, a.base.name.as_str()), (p.pubkey(), "Shard Key #1"));
    for shard in &shards[..3] {
        assert!(mpl_core::Asset::from_bytes(&env.data(shard)).is_err(), "burned");
    }
    assert!(mpl_core::Asset::from_bytes(&env.data(&shards[3])).is_ok());

    // The output's own supply holds (one key), and a recipe can be switched off.
    let more: Vec<Pubkey> = (0..3).map(|_| env.make(&authority, 20, p.pubkey()).unwrap()).collect();
    assert!(err(env.merge(&p, 1, &more)).contains("SoldOut"));
    assert!(mpl_core::Asset::from_bytes(&env.data(&more[0])).is_ok(), "nothing was burned");
    env.upsert_recipe(&owner, 1, RecipeArgs { active: false, ..recipe }).unwrap();
    assert!(err(env.merge(&p, 1, &more)).contains("NotForSale"));
}
