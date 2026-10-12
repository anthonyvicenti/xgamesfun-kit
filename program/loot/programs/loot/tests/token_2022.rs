//! Token-2022 and the two fees (2026-10-11), in LiteSVM against the real program binary and the
//! real Token-2022 program (v10, shipped with LiteSVM). Each test is a small economy: a box and
//! a pool in a Token-2022 currency, a currency with a transfer fee, one with a transfer hook,
//! and a game whose players pay the player fee while its project pays the project fee.
mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::instruction::AccountMeta},
    common::*,
    loot::{
        state::{DropEntry, Fees, Order, OrderStatus, Outcome},
        BoxArgs, ContestArgs,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 24 * 60 * 60;
const HOOK: Pubkey = Pubkey::from_str_const("Hook111111111111111111111111111111111111111");

fn err<T>(r: Result<T, String>) -> String {
    r.err().expect("expected the transaction to fail")
}

fn player(env: &mut Env, mint: Pubkey, amount: u64) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    env.fund(k.pubkey(), mint, amount);
    k
}

fn my(env: &Env, who: &Pubkey, mint: &Pubkey) -> u64 {
    env.tokens(&ata(who, mint))
}

/// A box in `mint` whose whole price goes to pool 1, and that gives nothing or `prize` from it.
fn box_in(mint: Pubkey, price: u64, prize: Option<u64>) -> BoxArgs {
    let mut entries = vec![DropEntry { outcome: Outcome::Nothing, weight: 1 }];
    if let Some(amount) = prize {
        entries.push(DropEntry { outcome: Outcome::Pay { pool: 1, amount }, weight: 1 });
    }
    BoxArgs { price, currency: Some(mint), rise: None, fall: None, stock_odds: false, active: true, shares: vec![pool(1, 10_000)], entries }
}

/// The player opens box `id` as order `nonce`, the oracle answers `number`, and anyone settles.
fn open_and_settle(env: &mut Env, id: u32, nonce: u64, number: u64) -> Order {
    let p = env.player.pubkey();
    let order = order_pda(&env.game, &p, nonce);
    env.open_box(id, nonce).unwrap();
    env.callback_of(id, order, rnd(number)).unwrap();
    let rolled: Order = env.acc(&order);
    let mint = rolled.mint;
    let c = env.cranker.insecure_clone();
    env.settle_prize(order, Some(ata(&p, &mint)), &c).unwrap();
    rolled
}

// ================================================================ a Token-2022 currency

/// Everything a classic currency does: a pool, a box priced in it, a prize from the pool, a
/// deposit, a payout, a burn share, and the pool closed when it is empty.
#[test]
fn a_token_2022_currency_works_like_a_classic_one() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let coin = env.new_mint_2022(None, None);
    let p = env.player.pubkey();
    env.fund(p, coin, 10_000);
    env.open_pool(&owner, 1, coin).unwrap();
    assert_eq!(env.svm.get_account(&pool_pda(&env.game, 1)).unwrap().owner, loot::tokens::TOKEN_2022_ID);
    env.upsert_box_args(9, box_in(coin, 1_000, Some(500))).unwrap();

    // A miss fills the pool, a hit pays from it.
    open_and_settle(&mut env, 9, 1, 0);
    assert_eq!(env.tokens(&pool_pda(&env.game, 1)), 1_000);
    let hit = open_and_settle(&mut env, 9, 2, 1);
    assert_eq!(hit.outcome, Outcome::Pay { pool: 1, amount: 500 });
    assert_eq!((my(&env, &p, &coin), env.tokens(&pool_pda(&env.game, 1))), (8_500, 1_500));
    // The game's vault for the coin is a Token-2022 account.
    assert_eq!(env.svm.get_account(&ata(&env.game, &coin)).unwrap().owner, loot::tokens::TOKEN_2022_ID);

    // A sponsor deposits, the authority pays out, a payment burns.
    let sponsor = player(&mut env, coin, 100);
    env.deposit(&sponsor, 1, coin, 100).unwrap();
    env.payout(&authority, 1, ata(&p, &coin), 1_600).unwrap();
    let pc = env.player.insecure_clone();
    let ix = env.pay_ix(p, coin, 100, vec![burn(10_000)]);
    env.send(&[ix], &[&pc]).unwrap();
    assert_eq!((my(&env, &p, &coin), env.supply(&coin)), (10_000, 10_000));

    // An empty pool closes.
    env.close_pool(&owner, 1).unwrap();
    assert!(!env.exists(&pool_pda(&env.game, 1)));
}

// ================================================================ a transfer fee

/// A coin that keeps 1% of every transfer. What the program writes down is what arrived, so
/// every account it keeps can always pay out what it owes, and the fees the mint withheld are
/// swept before an account closes.
#[test]
fn a_transfer_fee_is_counted_where_the_program_keeps_amounts() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let coin = env.new_mint_2022(Some(100), None);
    let p = env.player.pubkey();
    env.fund(p, coin, 100_000);
    env.open_pool(&owner, 1, coin).unwrap();
    env.upsert_box_args(9, box_in(coin, 10_000, None)).unwrap();

    // An order paid 10,000 holds the 9,900 that arrived; its settle sends 9,900 on (99 kept).
    let order = open_and_settle(&mut env, 9, 1, 0);
    assert_eq!(order.paid, 9_900);
    assert_eq!(env.tokens(&pool_pda(&env.game, 1)), 9_801);
    assert_eq!(env.tokens(&ata(&env.game, &coin)), 0, "the vault owes nothing and holds nothing");

    // A refund gives back what the order holds.
    let refunded = order_pda(&env.game, &p, 2);
    env.open_box(9, 2).unwrap();
    env.upsert_box_args(9, box_in(coin, 10_000, None)).unwrap(); // an edit: the roll fails
    env.callback_of(9, refunded, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&refunded).status, OrderStatus::Failed);
    let before = my(&env, &p, &coin);
    env.refund(refunded).unwrap();
    assert_eq!(my(&env, &p, &coin) - before, 9_801);

    // A stake counts what arrived, credits what arrived in its rewards vault, and pays it all.
    env.open_pool(&owner, 3, coin).unwrap();
    env.open_stake(&owner, 1, coin, 3, coin, 0).unwrap();
    let staker = player(&mut env, coin, 10_000);
    env.stake(&staker, 1, 10_000, coin).unwrap();
    assert_eq!(env.acc::<loot::Position>(&env.position_pda(1, &staker.pubkey())).amount, 9_900);
    env.fund(owner.pubkey(), coin, 1_000);
    env.deposit(&owner, 3, coin, 1_000).unwrap();
    env.unstake(&staker, 1, 0, coin).unwrap();
    assert!(env.tokens(&env.rewards_vault(1)) <= 1, "every reward credited was paid, but for the rounding a stake always keeps");
    env.unstake(&staker, 1, 9_900, coin).unwrap();
    assert_eq!(env.tokens(&env.staked_vault(1)), 0);
    assert!(!env.exists(&env.position_pda(1, &staker.pubkey())));

    // A contest counts what arrived, pays out its whole pot, and closes with fees withheld in it.
    let (a, b) = (player(&mut env, coin, 1_000), player(&mut env, coin, 2_000));
    env.open_contest(&authority, 1, coin, ContestArgs { sides: 2, closes_at: env.now() + 600, result_by: env.now() + 1_200, shares: vec![] }).unwrap();
    env.enter(&a, 1, 0, 1_000).unwrap();
    env.enter(&b, 1, 1, 2_000).unwrap();
    assert_eq!(env.contest(1).sides, vec![990, 1_980]);
    env.wait(700);
    env.decide(&authority, 1, 0).unwrap();
    env.claim(1, a.pubkey(), 0, ata(&a.pubkey(), &coin)).unwrap();
    env.claim(1, b.pubkey(), 1, ata(&b.pubkey(), &coin)).unwrap();
    assert_eq!(env.tokens(&env.pot_pda(1)), 0);
    env.close_contest(1).unwrap();
    assert!(!env.exists(&env.pot_pda(1)));

    // A pool that held fees withheld by the mint closes once it is empty.
    let rest = env.tokens(&pool_pda(&env.game, 1));
    env.payout(&authority, 1, ata(&p, &coin), rest).unwrap();
    env.close_pool(&owner, 1).unwrap();
    assert!(!env.exists(&pool_pda(&env.game, 1)));
}

// ================================================================ a transfer hook

/// The hook's list of extra accounts for `mint`: the counter, writable, then any `asks_to_sign`
/// as signers.
fn install_hook_asking(env: &mut Env, mint: &Pubkey, asks_to_sign: &[Pubkey]) -> (Pubkey, Pubkey) {
    let validation = Pubkey::find_program_address(&[b"extra-account-metas", mint.as_ref()], &HOOK).0;
    let counter = Pubkey::new_unique();
    // TLV: the execute instruction's discriminator, a length, then the list of accounts.
    let n = 1 + asks_to_sign.len() as u32;
    let mut data = vec![105, 37, 101, 197, 75, 251, 102, 26];
    data.extend_from_slice(&(4 + 35 * n).to_le_bytes());
    data.extend_from_slice(&n.to_le_bytes());
    data.push(0); // a fixed address
    data.extend_from_slice(counter.as_ref());
    data.extend_from_slice(&[0, 1]); // not a signer, writable
    for key in asks_to_sign {
        data.push(0);
        data.extend_from_slice(key.as_ref());
        data.extend_from_slice(&[1, 0]); // a signer
    }
    for (key, data) in [(validation, data), (counter, vec![0u8; 16])] {
        let account = solana_account::Account { lamports: env.rent(data.len()), data, owner: HOOK, executable: false, rent_epoch: 0 };
        env.svm.set_account(key, account).unwrap();
    }
    (validation, counter)
}

fn install_hook(env: &mut Env, mint: &Pubkey) -> (Pubkey, Pubkey) {
    install_hook_asking(env, mint, &[])
}

fn count(env: &Env, counter: &Pubkey) -> u64 {
    u64::from_le_bytes(env.data(counter)[..8].try_into().unwrap())
}

/// A coin with a transfer hook. Its accounts follow whatever else the instruction reads in its
/// remaining accounts, the program hands them on to every transfer of the coin, and the hook
/// runs (here it counts) or refuses.
#[test]
fn a_transfer_hook_runs_with_the_accounts_it_asks_for() {
    let mut env = setup();
    env.svm.add_program(HOOK, &std::fs::read(format!("{FIXTURES}/test_hook.so")).expect("run scripts/fetch-fixtures.sh")).unwrap();
    let owner = env.creator.insecure_clone();
    let coin = env.new_mint_2022(None, Some(HOOK));
    let (validation, counter) = install_hook(&mut env, &coin);
    let hook = [AccountMeta::new_readonly(HOOK, false), AccountMeta::new_readonly(validation, false), AccountMeta::new(counter, false)];
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), coin, 10_000);
    env.open_pool(&owner, 1, coin).unwrap();
    env.upsert_box_args(9, box_in(coin, 1_000, Some(400))).unwrap();

    // Without the hook's accounts the coin cannot move.
    assert!(env.open_box(9, 1).is_err());
    assert_eq!(count(&env, &counter), 0);

    // With them, the purchase runs the hook once, and the settle once more.
    let mut ix = env.open_box_ix(9, 1);
    ix.accounts.extend(hook.clone());
    env.send(&[ix], &[&p]).unwrap();
    assert_eq!(count(&env, &counter), 1);
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.callback_of(9, order, rnd(0)).unwrap();
    let c = env.cranker.insecure_clone();
    let mut ix = env.settle_prize_ix(order, None, c.pubkey());
    ix.accounts.extend(hook.clone());
    env.send(&[ix], &[&c]).unwrap();
    assert_eq!((count(&env, &counter), env.tokens(&pool_pda(&env.game, 1))), (2, 1_000));

    // A prize paid from the pool, and a deposit.
    let mut ix = env.open_box_ix(9, 2);
    ix.accounts.extend(hook.clone());
    env.send(&[ix], &[&p]).unwrap();
    let order = order_pda(&env.game, &p.pubkey(), 2);
    env.callback_of(9, order, rnd(1)).unwrap();
    let mut ix = env.settle_prize_ix(order, Some(ata(&p.pubkey(), &coin)), c.pubkey());
    ix.accounts.extend(hook.clone());
    env.send(&[ix], &[&c]).unwrap();
    assert_eq!((count(&env, &counter), my(&env, &p.pubkey(), &coin)), (5, 8_400));

    // The hook refuses a transfer of 13, and the program's instruction fails with it.
    let sponsor = player(&mut env, coin, 100);
    let mut ix = env.deposit_ix(&sponsor.pubkey(), 1, coin, 13);
    ix.accounts.extend(hook);
    assert!(err(env.send(&[ix], &[&sponsor])).contains("custom program error: 0xd"));
}

// ================================================================ the two fees

/// A player pays 0.002 SOL when they sign for something of their own; anything else that is
/// charged costs 0.00001 SOL. An airdrop to 10,000 players costs the project 0.1 SOL in fees.
#[test]
fn players_pay_the_player_fee_and_projects_the_project_fee() {
    let mut env = world();
    let admin = env.admin.insecure_clone();
    let fees = Fees { player: loot::PLAYER_FEE_LAMPORTS, project: loot::PROJECT_FEE_LAMPORTS };
    assert_eq!(fees, Fees { player: 2_000_000, project: 10_000 });
    env.init_platform_fees(&admin, program_data(), fees).unwrap();
    env.create_game().unwrap();
    env.catalog();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    env.open_pool(&owner, 0, gold).unwrap();

    let charged = |env: &mut Env, run: &mut dyn FnMut(&mut Env)| {
        let before = env.fees();
        run(env);
        env.fees() - before
    };
    // The player's own: a payment, a purchase (paid at settle, from the order's escrow).
    assert_eq!(charged(&mut env, &mut |env| { env.pay(PRICE, vec![pool(0, 10_000)]).unwrap(); }), 2_000_000);
    env.buy(3, 1).unwrap();
    let order = order_pda(&env.game, &env.player.pubkey(), 1);
    assert_eq!(env.acc::<Order>(&order).fee, 2_000_000);
    // The project's: a deposit, a payout, an issue of tokens.
    env.fund(owner.pubkey(), gold, PRICE);
    assert_eq!(charged(&mut env, &mut |env| { env.deposit(&owner, 0, gold, PRICE).unwrap(); }), 10_000);
    let to = ata(&env.player.pubkey(), &gold);
    assert_eq!(charged(&mut env, &mut |env| { env.payout(&authority, 0, to, PRICE).unwrap(); }), 10_000);

    // Fees that raise either one wait out the notice, together; fees that raise neither apply now.
    let p = |player, project| Fees { player, project };
    env.set_platform_fees(&admin, p(1_000_000, 20_000), admin.pubkey()).unwrap();
    assert_eq!((env.platform().fees, env.platform().pending, env.platform().pending_at > 0), (fees, p(1_000_000, 20_000), true));
    env.set_platform_fees(&admin, p(1_000_000, 5_000), admin.pubkey()).unwrap();
    assert_eq!((env.platform().fees, env.platform().pending_at), (p(1_000_000, 5_000), 0));
    env.wait(loot::NOTICE_SECONDS + DAY);
    assert_eq!(env.platform().fees(env.now()), p(1_000_000, 5_000), "the raise that was waiting was dropped");
    assert!(err(env.set_platform_fees(&admin, p(loot::MAX_FEE_LAMPORTS + 1, 0), admin.pubkey())).contains("FeeAboveCap"));
}

/// A hook whose list asks for the game's own address as a signer. The game signs its own
/// transfers (a payout, a settle), and a hook that got that signature could move everything
/// the game holds. It does not get it: Token-2022 calls a hook with no signer at all.
#[test]
fn a_transfer_hook_never_gets_the_games_signature() {
    let mut env = setup();
    env.svm.add_program(HOOK, &std::fs::read(format!("{FIXTURES}/test_hook.so")).expect("run scripts/fetch-fixtures.sh")).unwrap();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let coin = env.new_mint_2022(None, Some(HOOK));
    let game = env.game;
    let (validation, counter) = install_hook_asking(&mut env, &coin, &[game]);
    let hook = [
        AccountMeta::new_readonly(HOOK, false),
        AccountMeta::new_readonly(validation, false),
        AccountMeta::new(counter, false),
        AccountMeta::new_readonly(game, false),
    ];
    env.open_pool(&owner, 1, coin).unwrap();
    let sponsor = player(&mut env, coin, 1_000);
    let mut ix = env.deposit_ix(&sponsor.pubkey(), 1, coin, 1_000);
    ix.accounts.extend(hook.clone());
    env.send(&[ix], &[&sponsor]).unwrap();

    // The game pays out of the pool: the game signs this transfer.
    let to = ata(&sponsor.pubkey(), &coin);
    let mut ix = env.payout_ix(authority.pubkey(), 1, to, 500);
    ix.accounts.extend(hook);
    env.send(&[ix], &[&authority]).unwrap();
    // The hook ran both times, and saw no signer: Token-2022 hands it none, whatever it asks.
    let signed = u64::from_le_bytes(env.data(&counter)[8..16].try_into().unwrap());
    assert_eq!((count(&env, &counter), signed), (2, 0));
}
