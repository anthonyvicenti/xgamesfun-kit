//! Second security review of loot 0.3: what was written after the first one (box outcomes,
//! schedules, converters, the lottery, staking, merges). LiteSVM against the built binary.
//!
//! `fixed_*` is a finding of the review turned round after its fix: the attack now fails.
//! `noted_*` is behaviour that stays, by decision, and is written down where the owner reads it.
//! `sound_*` is an attack the program refuses.
mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::{AccountMeta, Instruction},
        InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    common::*,
    loot::{
        state::{DropEntry, ItemKind, Order, Outcome, To},
        Action, Input, ItemArgs, LotteryArgs, Origin, Output, RecipeArgs, ScheduleArgs,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 24 * 60 * 60;
const REVENUE: u8 = 0;
const REWARDS: u8 = 3;

/// A new wallet with SOL and `amount` of `mint`.
fn player(env: &mut Env, mint: Pubkey, amount: u64) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    env.fund(k.pubkey(), mint, amount);
    k
}

fn coin_player(env: &mut Env, amount: u64) -> Keypair {
    let mint = env.mint;
    player(env, mint, amount)
}

fn err<T>(r: Result<T, String>) -> String {
    r.err().expect("expected the transaction to fail")
}

/// A recipe that burns `take` of one token and gives `give` of another.
fn exchange(take_mint: Pubkey, take: u64, give_mint: Pubkey, give: u64, from: Origin) -> RecipeArgs {
    RecipeArgs {
        active: true,
        inputs: vec![Input::Pay { mint: take_mint, amount: take, to: To::Burn }],
        outputs: vec![Output::Tokens { mint: give_mint, amount: give, from }],
        needs: vec![],
        keeps: vec![],
    }
}

fn loot_ix(data: Vec<u8>, metas: Vec<AccountMeta>) -> Instruction {
    Instruction::new_with_bytes(loot::ID, &data, metas)
}

/// `stake` or `unstake` as one instruction, so several fit in one transaction.
fn staking_ix(env: &Env, who: Pubkey, id: u32, rewards_mint: Pubkey, data: Vec<u8>) -> Instruction {
    let stake = env.mechanic_pda(loot::STAKE_SEED, id);
    let s: loot::Stake = env.acc(&stake);
    loot_ix(
        data,
        loot::accounts::Staking {
            player: who,
            game: env.game,
            stake,
            position: env.position_pda(id, &who),
            staked_vault: env.staked_vault(id),
            rewards_vault: env.rewards_vault(id),
            rewards_pool: pool_pda(&env.game, s.rewards_pool),
            player_tokens: ata(&who, &s.mint),
            player_rewards: ata(&who, &rewards_mint),
            mint: s.mint,
            rewards_mint: s.rewards_mint,
            token_program: spl_token::ID,
            token_2022_program: loot::tokens::TOKEN_2022_ID,
            fee: env.fee(),
        }
        .to_account_metas(None),
    )
}

fn stake_ix(env: &Env, who: Pubkey, amount: u64, rewards_mint: Pubkey) -> Instruction {
    staking_ix(env, who, 1, rewards_mint, loot::instruction::Stake { amount }.data())
}

fn unstake_ix(env: &Env, who: Pubkey, amount: u64, rewards_mint: Pubkey) -> Instruction {
    staking_ix(env, who, 1, rewards_mint, loot::instruction::Unstake { amount }.data())
}

fn run_schedule_ix(env: &Env, id: u32, first: Pubkey, second: Pubkey) -> Instruction {
    let mut metas = loot::accounts::RunSchedule {
        game: env.game,
        schedule: env.mechanic_pda(loot::SCHEDULE_SEED, id),
        token_program: spl_token::ID,
        token_2022_program: loot::tokens::TOKEN_2022_ID,
    }
    .to_account_metas(None);
    metas.extend([AccountMeta::new(first, false), AccountMeta::new(second, false)]);
    metas.push(AccountMeta::new_readonly(env.mint_of(&first), false));
    loot_ix(loot::instruction::RunSchedule {}.data(), metas)
}

fn nothing(weight: u32) -> DropEntry {
    DropEntry { outcome: Outcome::Nothing, weight }
}

/// A stake of the game's coin whose rewards pool (in the coin too) is fed by a weekly
/// schedule that moves all of the revenue pool. One honest staker holds 100.
fn stake_fed_by_a_schedule() -> (Env, Keypair) {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, REVENUE, env.mint).unwrap();
    env.open_pool(&owner, REWARDS, env.mint).unwrap();
    env.open_stake(&owner, 1, env.mint, REWARDS, env.mint, 7 * DAY).unwrap();
    let honest = coin_player(&mut env, 100);
    env.stake(&honest, 1, 100, env.mint).unwrap();

    env.fund(owner.pubkey(), env.mint, 10_000);
    env.deposit(&owner, REVENUE, env.mint, 10_000).unwrap();
    let weekly = ScheduleArgs {
        active: true,
        action: Action::Move { from: REVENUE, to: REWARDS, bps: 10_000 },
        every: 7 * DAY,
        next_at: env.now() + 7 * DAY,
        max_runs: 0,
    };
    env.upsert_schedule(&owner, 1, weekly).unwrap();
    (env, honest)
}

// ================================================================ findings

/// HIGH, fixed. Rewards are credited to whoever is staked at the first stake/unstake after
/// they reach the rewards pool, and anyone decides when they reach it. In one transaction an
/// attacker staked a large borrowed sum, ran the schedule that feeds the pool, and unstaked,
/// taking the week's rewards from the staker who had held all week. A stake now has a lock,
/// set by the owner when it is opened: nothing comes out until it has run since the
/// position's last stake. With a lock as long as the gap between rewards, capital has to sit
/// for a whole period to earn that period's share, which is what staking means.
#[test]
fn fixed_a_flash_stake_cannot_leave_with_the_distribution() {
    let (mut env, honest) = stake_fed_by_a_schedule(); // lock: 7 days
    env.wait(7 * DAY);

    let attacker = coin_player(&mut env, 1_000_000);
    let (a, mint) = (attacker.pubkey(), env.mint);
    let ixs = [
        stake_ix(&env, a, 1_000_000, mint),
        run_schedule_ix(&env, 1, pool_pda(&env.game, REVENUE), pool_pda(&env.game, REWARDS)),
        unstake_ix(&env, a, 1_000_000, mint),
    ];
    assert!(err(env.send(&ixs, &[&attacker])).contains("StillLocked"));
    assert_eq!(env.tokens(&ata(&a, &mint)), 1_000_000, "nothing happened");

    // The honest staker runs the schedule and collects the week.
    env.run_schedule(1, pool_pda(&env.game, REVENUE), pool_pda(&env.game, REWARDS)).unwrap();
    let logs = env.unstake(&honest, 1, 100, mint).unwrap();
    assert_eq!(receipt::<loot::receipts::Unstaked>(&logs).rewards, 10_000);
}

/// HIGH against the stated model, fixed. `unstake` read the rewards pool before anything
/// else, so the owner could stop every unstake by closing that pool, or by reopening it in
/// another mint. A pool that is gone, or holds another mint than the one the stake was opened
/// with, now simply brings no rewards.
#[test]
fn fixed_closing_or_swapping_the_rewards_pool_stops_no_unstake() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let usd = env.new_mint(owner.pubkey());
    env.open_pool(&owner, REWARDS, usd).unwrap();
    env.open_stake(&owner, 1, env.mint, REWARDS, usd, 0).unwrap();
    let a = coin_player(&mut env, 1_000);
    env.token_account(a.pubkey(), usd);
    env.stake(&a, 1, 100, usd).unwrap();

    // 1. The pool is gone.
    env.close_pool(&owner, REWARDS).unwrap();
    env.unstake(&a, 1, 40, usd).unwrap();

    // 2. The pool is back in another mint and holds something.
    let other = env.new_mint(owner.pubkey());
    env.open_pool(&owner, REWARDS, other).unwrap();
    env.fund(owner.pubkey(), other, 1);
    env.deposit(&owner, REWARDS, other, 1).unwrap();
    env.unstake(&a, 1, 60, usd).unwrap();
    assert_eq!(env.tokens(&ata(&a.pubkey(), &env.mint)), 1_000);
    assert_eq!(env.tokens(&pool_pda(&env.game, REWARDS)), 1, "and the other mint was left alone");
}

/// HIGH/MEDIUM, fixed. Converters, schedules, lotteries, recipes and boxes move pools and mint
/// with no authority, and any admin could write one: an admin emptied a pool and minted a
/// token the game controls, each in two transactions. Everything that can move a pool or mint
/// became the owner's alone, and on 2026-10-11 the creator dropped admins altogether: a game has
/// two keys, its owner and its authority.
#[test]
fn fixed_only_the_owner_writes_a_mechanic() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let admin = Keypair::new();
    env.svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    env.open_pool(&owner, 0, env.mint).unwrap();
    let junk = env.new_mint(owner.pubkey());

    // What was a converter is a recipe of tokens now.
    let drain = exchange(junk, 1, env.mint, 5_000, Origin::Pool(0));
    assert!(err(env.upsert_recipe(&admin, 8, drain)).contains("NotOwner"));
    let burn_all = ScheduleArgs { active: true, action: Action::Burn { pool: 0, bps: 10_000 }, every: 1, next_at: 0, max_runs: 0 };
    assert!(err(env.upsert_schedule(&admin, 9, burn_all)).contains("NotOwner"));
    let pot = LotteryArgs { price: 1, pot: 0, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: 1, draws_at: 0 };
    assert!(err(env.upsert_lottery(&admin, 9, pot)).contains("NotOwner"));
    let recipe = merge_recipe(1, 1, 3);
    assert!(err(env.upsert_recipe(&admin, 9, recipe)).contains("NotOwner"));
    let c = std::mem::replace(&mut env.creator, admin.insecure_clone());
    assert!(err(env.upsert_box(9, PRICE, vec![], vec![pay_drop(0, 5_000, 1)])).contains("NotOwner"));
    // Nor an item.
    assert!(err(env.upsert_item(30, item(ItemKind::Collectible, "Admin's Hat", 0, 0))).contains("NotOwner"));
    env.creator = c;
}

/// MEDIUM, fixed. A paid box order was rolled against the box as it was when the oracle
/// answered, so an edit between the payment and the answer changed the odds and prizes of a
/// purchase already made. A box now counts its edits, and an order paid for another
/// version is not rolled at all: it fails, and the player is refunded at once.
#[test]
fn fixed_a_box_edited_after_the_purchase_refunds_that_purchase() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, 0, env.mint).unwrap();
    env.fund(owner.pubkey(), env.mint, 1_000);
    env.deposit(&owner, 0, env.mint, 1_000).unwrap();
    env.upsert_box(1, PRICE, vec![], vec![pay_drop(0, 500, 1), nothing(1)]).unwrap();
    env.wait_slots(1);

    let had = env.tokens(&ata(&env.player.pubkey(), &env.mint));
    env.open_box(1, 1).unwrap();
    let order = order_pda(&env.game, &env.player.pubkey(), 1);
    env.wait_slots(1);
    env.upsert_box(1, PRICE, vec![], vec![pay_drop(0, 1, 1), nothing(1_000_000)]).unwrap();
    env.callback(order, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&order).status, loot::state::OrderStatus::Failed);
    env.refund(order).unwrap();
    assert_eq!(env.tokens(&ata(&env.player.pubkey(), &env.mint)), had);

    // A purchase made after the edit is rolled on the box as it is now.
    env.wait_slots(1);
    env.open_box(1, 2).unwrap();
    let order = order_pda(&env.game, &env.player.pubkey(), 2);
    env.callback(order, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&order).outcome, Outcome::Pay { pool: 0, amount: 1 });
}

/// LOW/MEDIUM, noted (`stake.rs` and `lottery.rs` now say so at the top; a setup checker
/// should refuse it before it reaches the chain). A stake takes everything its
/// rewards pool holds each time anyone stakes or unstakes. Nothing stops that pool from also
/// being a lottery's pot (or a box's prize pool, or a converter's stock, or a second stake's
/// rewards pool). Here a holder of one staked coin takes the pot before the winner is paid.
#[test]
fn noted_a_stake_sweeps_a_pot_that_shares_its_pool() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, 0, env.mint).unwrap();
    env.open_stake(&owner, 1, env.mint, 0, env.mint, 0).unwrap();
    let args = LotteryArgs { price: 10, pot: 0, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: 7 * DAY, draws_at: env.now() + 7 * DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();

    let staker = coin_player(&mut env, 1);
    env.stake(&staker, 1, 1, env.mint).unwrap();
    let buyer = coin_player(&mut env, 1_000);
    env.buy_tickets(&buyer, 1, 9, env.mint).unwrap();
    env.wait(7 * DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(0)).unwrap();

    env.unstake(&staker, 1, 0, env.mint).unwrap();
    assert_eq!(env.tokens(&ata(&staker.pubkey(), &env.mint)), 90, "the whole pot");
    let logs = env.pay_lottery(1, ata(&buyer.pubkey(), &env.mint)).unwrap();
    let paid: loot::receipts::LotteryPaid = receipt(&logs);
    assert_eq!(paid.amount, 0, "the winner is paid nothing");
}

/// LOW, fixed. `pay_lottery` sent the rent of the ticket list straight to the winner's wallet.
/// With three lines or fewer that is less than an empty wallet needs to exist, and a
/// validator refuses such a transaction, so an empty-handed winner could not be paid. The
/// rent now stays in the lottery when the winner's wallet cannot take it, and pays for the
/// next round's first lines. (LiteSVM does not enforce that rule itself, so this shows the
/// program's side.)
#[test]
fn fixed_pay_lottery_does_not_leave_an_empty_winner_wallet_below_rent() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, 0, env.mint).unwrap();
    let args = LotteryArgs { price: 10, pot: 0, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();
    let buyer = coin_player(&mut env, 100);
    env.buy_tickets(&buyer, 1, 1, env.mint).unwrap();
    let all = env.lamports(&buyer.pubkey()) - 5_000;
    let out = solana_system_interface::instruction::transfer(&buyer.pubkey(), &owner.pubkey(), all);
    env.send(&[out], &[&buyer]).unwrap();

    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(0)).unwrap();
    env.pay_lottery(1, ata(&buyer.pubkey(), &env.mint)).unwrap();
    assert_eq!(env.lamports(&buyer.pubkey()), 0, "the wallet was left as it was");
    assert_eq!(env.tokens(&ata(&buyer.pubkey(), &env.mint)), 100, "and the pot was paid");
}

/// LOW, fixed. `convert` cut a result that did not fit in 64 bits down to its low bits. It
/// was refused, and the converter is a recipe of tokens now, which refuses it too.
#[test]
fn fixed_a_conversion_too_big_for_64_bits_is_refused() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let gems = env.new_mint(owner.pubkey());
    let points = env.new_mint(env.game);
    let p = player(&mut env, gems, 10);
    env.token_account(p.pubkey(), points);
    env.upsert_recipe(&owner, 1, exchange(gems, 1, points, 1 << 63, Origin::Issue)).unwrap();
    assert!(err(env.craft_times(&p, 1, 3, &[])).contains("Overflow"));
    assert_eq!(env.supply(&gems), 10);
}

/// LOW, fixed. A merge recognised its inputs by the asset's name. Renaming an item used to
/// strand the collectibles already minted under the old name: an item's name is locked once
/// one is issued. Two items of one game with the same name were interchangeable as inputs:
/// since the fourth review a recipe also reads the item number written on the collectible.
#[test]
fn fixed_a_recipe_goes_by_name_and_number_and_a_name_cannot_change_once_issued() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = coin_player(&mut env, 0);
    env.upsert_item(20, item(ItemKind::Collectible, "Shard", 0, 0)).unwrap();
    env.upsert_item(21, item(ItemKind::Collectible, "Shard Key", 0, 0)).unwrap();
    env.upsert_item(23, ItemArgs { rarity: 9, ..item(ItemKind::Collectible, "Shard", 0, 0) }).unwrap();
    env.upsert_recipe(&owner, 1, merge_recipe(20, 2, 21)).unwrap();

    let others: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 23, p.pubkey()).unwrap()).collect();
    assert!(err(env.merge(&p, 1, &others)).contains("ItemMismatch"), "two collectibles of item 23 are not item 20");

    env.make(&authority, 20, p.pubkey()).unwrap();
    assert!(err(env.upsert_item(20, item(ItemKind::Collectible, "Fragment", 0, 0))).contains("KindLocked"));
}

/// LOW, noted (said at the top of `lottery.rs`). Two things about a lottery's cut. (1) It is rounded down per purchase, so tickets
/// bought one at a time pay none when `price * cut_bps < 10,000`. (2) The cut goes to the
/// game's treasury, which is in the game's mint; a lottery whose pot is in another mint is
/// accepted with a cut, and then no ticket can ever be bought.
#[test]
fn noted_the_lottery_cut_rounds_down_and_needs_a_pot_in_the_games_mint() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, 0, env.mint).unwrap();
    let usd = env.new_mint(owner.pubkey());
    env.open_pool(&owner, 1, usd).unwrap();
    let draws_at = env.now() + DAY;
    env.upsert_lottery(&owner, 1, LotteryArgs { price: 5, pot: 0, cut_bps: 1_000, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at }).unwrap();
    env.upsert_lottery(&owner, 2, LotteryArgs { price: 5, pot: 1, cut_bps: 1_000, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at }).unwrap();

    let p = coin_player(&mut env, 100);
    let before = env.tokens(&env.treasury);
    env.buy_tickets(&p, 1, 1, env.mint).unwrap();
    env.buy_tickets(&p, 1, 1, env.mint).unwrap();
    assert_eq!(env.tokens(&env.treasury) - before, 0, "two tickets, no cut");
    env.buy_tickets(&p, 1, 2, env.mint).unwrap();
    assert_eq!(env.tokens(&env.treasury) - before, 1, "the same two at once pay it");

    env.fund(p.pubkey(), usd, 100);
    assert!(env.buy_tickets(&p, 2, 2, usd).is_err(), "the cut cannot reach a treasury in another mint");
}

/// LOW, noted (said at the top of `craft.rs`). A soulbound collectible is frozen for
/// good, and Core refuses to burn a frozen asset even for its owner, so a recipe whose input
/// item is soulbound fails every merge. `upsert_recipe` accepts it.
#[test]
fn noted_a_recipe_with_a_soulbound_input_can_never_be_merged() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = coin_player(&mut env, 0);
    env.upsert_item(20, ItemArgs { soulbound: true, ..item(ItemKind::Collectible, "Badge", 0, 0) }).unwrap();
    env.upsert_item(21, item(ItemKind::Collectible, "Medal", 0, 0)).unwrap();
    env.upsert_recipe(&owner, 1, merge_recipe(20, 1, 21)).unwrap();
    let badge = env.make(&authority, 20, p.pubkey()).unwrap();
    let e = err(env.merge(&p, 1, &[badge]));
    assert!(e.contains("permanent_freeze_delegate") && e.contains("Reject"), "{e}");
    assert!(mpl_core::Asset::from_bytes(&env.data(&badge)).is_ok(), "still there");
}

// ================================================================ sound

/// Rewards that are already in the pool when someone stakes go to those who were staked
/// before, and someone with no stake collects nothing.
#[test]
fn sound_a_late_stake_gets_nothing_of_what_had_already_arrived() {
    let (mut env, honest) = stake_fed_by_a_schedule();
    env.wait(7 * DAY);
    env.run_schedule(1, pool_pda(&env.game, REVENUE), pool_pda(&env.game, REWARDS)).unwrap();

    let late = coin_player(&mut env, 1_000_000);
    let mint = env.mint;
    env.stake(&late, 1, 1_000_000, mint).unwrap();
    let logs = env.unstake(&late, 1, 0, mint).unwrap();
    assert_eq!(receipt::<loot::receipts::Unstaked>(&logs).rewards, 0);

    let stranger = coin_player(&mut env, 0);
    let logs = env.unstake(&stranger, 1, 0, mint).unwrap();
    assert_eq!(receipt::<loot::receipts::Unstaked>(&logs).rewards, 0);
    assert!(!env.exists(&env.position_pda(1, &stranger.pubkey())));

    let logs = env.unstake(&honest, 1, 100, mint).unwrap();
    assert_eq!(receipt::<loot::receipts::Unstaked>(&logs).rewards, 10_000);
    assert_eq!(env.tokens(&env.rewards_vault(1)), 0);
}

/// A position at an address someone sent SOL to is still opened; and closing a position and
/// opening it again inside one transaction neither pays twice nor loses the stake.
#[test]
fn sound_a_position_survives_a_prefunded_address_and_a_close_and_reopen() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, REWARDS, env.mint).unwrap();
    env.open_stake(&owner, 1, env.mint, REWARDS, env.mint, 0).unwrap();
    let a = coin_player(&mut env, 1_000);
    let b = coin_player(&mut env, 1_000);
    let (ak, mint) = (a.pubkey(), env.mint);
    let position = env.position_pda(1, &ak);
    env.svm.airdrop(&position, 5_000_000).unwrap();

    env.stake(&a, 1, 100, mint).unwrap();
    env.stake(&b, 1, 100, mint).unwrap();
    env.fund(owner.pubkey(), mint, 200);
    env.deposit(&owner, REWARDS, mint, 200).unwrap();

    // Out, in, out, in: the 100 owed is paid once, the stake ends where it began.
    let ixs = [
        unstake_ix(&env, ak, 100, mint),
        stake_ix(&env, ak, 100, mint),
        unstake_ix(&env, ak, 100, mint),
        stake_ix(&env, ak, 100, mint),
        unstake_ix(&env, ak, 0, mint),
    ];
    env.send(&ixs, &[&a]).unwrap();
    assert_eq!(env.tokens(&ata(&ak, &mint)), 900 + 100);
    let p: loot::Position = env.acc(&position);
    assert_eq!(p.amount, 100);

    // The other staker's half is still there for them, and the vaults add up.
    let logs = env.unstake(&b, 1, 100, mint).unwrap();
    assert_eq!(receipt::<loot::receipts::Unstaked>(&logs).rewards, 100);
    env.unstake(&a, 1, 100, mint).unwrap();
    assert_eq!((env.tokens(&env.staked_vault(1)), env.tokens(&env.rewards_vault(1))), (0, 0));
    assert!(!env.exists(&position), "closed, with the SOL that was parked there");
}

/// The mechanics name pools by index and take nothing else in a pool's place: not the order
/// vault, not a stake's vaults.
#[test]
fn sound_no_mechanic_takes_a_vault_for_a_pool() {
    let (mut env, _) = stake_fed_by_a_schedule();
    let owner = env.creator.insecure_clone();
    let (staked, rewards, vault) = (env.staked_vault(1), env.rewards_vault(1), ata(&env.game, &env.mint));
    let c = env.cranker.insecure_clone();
    env.wait(7 * DAY);

    // A schedule.
    for from in [staked, rewards, vault] {
        let ix = run_schedule_ix(&env, 1, from, pool_pda(&env.game, REWARDS));
        assert!(err(env.send(&[ix], &[&c])).contains("WrongPool"));
    }

    // An exchange (a recipe of tokens) that pays from the revenue pool.
    let junk = env.new_mint(owner.pubkey());
    let p = player(&mut env, junk, 10);
    env.token_account(p.pubkey(), env.mint);
    env.upsert_recipe(&owner, 1, exchange(junk, 1, env.mint, 1, Origin::Pool(REVENUE))).unwrap();
    for from in [staked, rewards, vault] {
        let (mut ix, _) = env.craft_ix(p.pubkey(), 1, 0, &[]);
        let at = ix.accounts.iter().position(|m| m.pubkey == pool_pda(&env.game, REVENUE)).unwrap();
        ix.accounts[at].pubkey = from;
        assert!(err(env.send(&[ix], &[&p])).contains("WrongPool"));
    }

    // A lottery's pot.
    let buyer = coin_player(&mut env, 100);
    let args = LotteryArgs { price: 10, pot: REVENUE, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();
    env.buy_tickets(&buyer, 1, 1, env.mint).unwrap();
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(0)).unwrap();
    for from in [staked, rewards, vault] {
        let ix = loot_ix(
            loot::instruction::PayLottery { place: 0 }.data(),
            loot::accounts::PayLottery {
                game: env.game,
                lottery: env.mechanic_pda(loot::LOTTERY_SEED, 1),
                first_place: buyer.pubkey(),
                pot: from,
                to: ata(&buyer.pubkey(), &env.mint),
                mint: env.mint,
                token_program: spl_token::ID,
                token_2022_program: loot::tokens::TOKEN_2022_ID,
            }
            .to_account_metas(None),
        );
        assert!(err(env.send(&[ix], &[&c])).contains("WrongPool"));
    }
    assert_eq!(env.tokens(&staked), 100);
}

/// An answer to a draw of an earlier round (asked twice, answered once) cannot decide a later
/// round, whichever of the old requests it belongs to.
#[test]
fn sound_an_old_rounds_answer_does_not_draw_a_new_round() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let c = env.cranker.insecure_clone();
    env.open_pool(&owner, 0, env.mint).unwrap();
    let args = LotteryArgs { price: 10, pot: 0, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args).unwrap();
    let (a, b) = (coin_player(&mut env, 100), coin_player(&mut env, 100));

    // Round 0: asked, never answered, asked again, answered, paid.
    env.buy_tickets(&a, 1, 1, env.mint).unwrap();
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    let first = env.lottery(1).asked_slot;
    env.wait_slots(loot::STALE_SLOTS + 1);
    env.draw_lottery(1).unwrap();
    let second = env.lottery(1).asked_slot;
    env.lottery_callback(1, rnd(0)).unwrap();
    env.pay_lottery(1, ata(&a.pubkey(), &env.mint)).unwrap();

    // Round 1: a sells out to two players, and is being drawn.
    env.buy_tickets(&a, 1, 1, env.mint).unwrap();
    env.buy_tickets(&b, 1, 1, env.mint).unwrap();
    for slot in [first, second] {
        let ix = env.lottery_callback_ix(1, slot, rnd(1));
        assert!(err(env.send_unsigned(&[ix], &c)).contains("NotDue"), "tickets still on sale");
    }
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    for slot in [first, second] {
        let ix = env.lottery_callback_ix(1, slot, rnd(1));
        assert!(err(env.send_unsigned(&[ix], &c)).contains("NotDue"), "not this draw's request");
    }
    env.lottery_callback(1, rnd(1)).unwrap();
    assert_eq!(env.lottery(1).winner, b.pubkey());
}

/// One line on the list, any number; a purchase too large to price; nothing bought.
#[test]
fn sound_the_ticket_list_at_its_edges() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, 0, env.mint).unwrap();
    let args = LotteryArgs { price: 10, pot: 0, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args.clone()).unwrap();
    let a = coin_player(&mut env, 100);
    assert!(err(env.buy_tickets(&a, 1, 0, env.mint)).contains("ZeroAmount"));
    assert!(err(env.buy_tickets(&a, 1, u64::MAX, env.mint)).contains("Overflow"));
    env.buy_tickets(&a, 1, 1, env.mint).unwrap();
    // A round with tickets sold cannot be rewritten, which is also what keeps its list.
    assert!(err(env.upsert_lottery(&owner, 1, args)).contains("RoundRunning"));
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, [0xff; 32]).unwrap();
    assert_eq!(env.lottery(1).winner, a.pubkey());
}

/// The key of the asset a merge gives cannot be one of the assets it burns: Core keeps a
/// burned asset's address taken.
#[test]
fn sound_a_merge_cannot_give_back_an_address_it_just_burned() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = coin_player(&mut env, 0);
    env.upsert_item(20, item(ItemKind::Collectible, "Shard", 0, 0)).unwrap();
    env.upsert_item(21, item(ItemKind::Collectible, "Shard Key", 0, 0)).unwrap();
    env.upsert_recipe(&owner, 1, merge_recipe(20, 1, 21)).unwrap();
    let shard = env.make(&authority, 20, p.pubkey()).unwrap();

    // The recipe's accounts, with the shard itself as the new collectible's key (signed for,
    // as its maker could).
    let (mut ix, _) = env.craft_ix(p.pubkey(), 1, 0, &[shard]);
    let last = ix.accounts.len() - 1;
    ix.accounts[last] = AccountMeta::new(shard, true);
    let e = err(env.send_unsigned(&[ix], &p));
    assert!(e.contains("already in use"), "{e}");
    assert!(mpl_core::Asset::from_bytes(&env.data(&shard)).is_ok());
    assert_eq!(env.item_state(21).issued, 0);
}

/// A schedule that mints takes its mint and its pool in that order and no other accounts, and
/// one whose pool is in another mint fails without counting a run.
#[test]
fn sound_an_emission_names_its_mint_and_its_pool() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let c = env.cranker.insecure_clone();
    let points = env.new_mint(env.game);
    let other = env.new_mint(env.game);
    env.open_pool(&owner, 0, points).unwrap();
    env.open_pool(&owner, 1, env.mint).unwrap();
    let start = env.now() - 100 * DAY;
    let args = |pool| ScheduleArgs {
        active: true,
        action: Action::Issue { mint: points, pool, amount: 1_000, halve_every: 1 },
        every: DAY,
        next_at: start,
        max_runs: 0,
    };
    env.upsert_schedule(&owner, 1, args(0)).unwrap();
    env.upsert_schedule(&owner, 2, args(1)).unwrap();
    let (p0, p1) = (pool_pda(&env.game, 0), pool_pda(&env.game, 1));

    for (first, second) in [(p0, points), (other, p0), (points, p1), (points, ata(&env.game, &env.mint))] {
        let ix = run_schedule_ix(&env, 1, first, second);
        assert!(err(env.send(&[ix], &[&c])).contains("WrongPool"));
    }
    assert!(env.run_schedule(2, points, p1).is_err(), "the pool holds another mint");
    let s: loot::Schedule = env.acc(&env.mechanic_pda(loot::SCHEDULE_SEED, 2));
    assert_eq!(s.runs, 0);

    // Halving every run: 1000, 500, 250.
    for _ in 0..3 {
        env.run_schedule(1, points, p0).unwrap();
    }
    assert_eq!(env.tokens(&p0), 1_750);
}
