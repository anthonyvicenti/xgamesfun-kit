//! Seventh review of loot 0.3 (2026-10-11): Token-2022 in every token role and the two fees,
//! commit cc5105410. LiteSVM against the built binary and the real Token-2022 (v10).
//!
//! A project's own keys are trusted (its owner, its authority), and so is its choice of mint,
//! so nothing here is about what only they can do. `fixed_*` is a finding: its doc comment says
//! what the problem was, and the test shows the fix holds. `noted_*` is a finding kept by
//! design, shown as it behaves. `sound_*` is an attack or an edge the program handles.
mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::instruction::{AccountMeta, Instruction}},
    anchor_spl::token::spl_token,
    common::*,
    loot::{
        state::{DropEntry, Fees, Order, OrderStatus, Outcome, Share, To},
        BoxArgs, ContestArgs,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
    spl_token_2022_interface as t22,
};

const T22: Pubkey = loot::tokens::TOKEN_2022_ID;
const HOOK: Pubkey = Pubkey::from_str_const("Hook111111111111111111111111111111111111111");
const DAY: i64 = 24 * 60 * 60;

fn err<T>(r: Result<T, String>) -> String {
    r.err().expect("expected the transaction to fail")
}

/// A new wallet with SOL and `amount` of `mint`.
fn wallet(env: &mut Env, mint: Pubkey, amount: u64) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    env.fund(k.pubkey(), mint, amount);
    k
}

fn my(env: &Env, who: &Pubkey, mint: &Pubkey) -> u64 {
    env.tokens(&ata(who, mint))
}

/// A box in `mint` whose whole price goes to pool 1 and pool 2 (half each), giving `entries`.
fn box_in(mint: Pubkey, price: u64, entries: Vec<DropEntry>, shares: Vec<Share>) -> BoxArgs {
    BoxArgs { price, currency: Some(mint), rise: None, fall: None, stock_odds: false, active: true, shares, entries }
}

fn nothing() -> DropEntry {
    DropEntry { outcome: Outcome::Nothing, weight: 1 }
}

/// A transfer hook's list of extra accounts for `mint`, owned by `program`: each (key, signer,
/// writable). The test hook writes a counter into the first one.
fn install_validation(env: &mut Env, mint: &Pubkey, program: &Pubkey, extras: &[(Pubkey, bool, bool)]) -> Pubkey {
    let validation = Pubkey::find_program_address(&[b"extra-account-metas", mint.as_ref()], program).0;
    let n = extras.len() as u32;
    let mut data = vec![105, 37, 101, 197, 75, 251, 102, 26];
    data.extend_from_slice(&(4 + 35 * n).to_le_bytes());
    data.extend_from_slice(&n.to_le_bytes());
    for (key, signer, writable) in extras {
        data.push(0);
        data.extend_from_slice(key.as_ref());
        data.extend_from_slice(&[*signer as u8, *writable as u8]);
    }
    let account = solana_account::Account { lamports: env.rent(data.len()), data, owner: *program, executable: false, rent_epoch: 0 };
    env.svm.set_account(validation, account).unwrap();
    validation
}

fn new_counter(env: &mut Env) -> Pubkey {
    let counter = Pubkey::new_unique();
    let account = solana_account::Account { lamports: env.rent(16), data: vec![0u8; 16], owner: HOOK, executable: false, rent_epoch: 0 };
    env.svm.set_account(counter, account).unwrap();
    counter
}

fn count(env: &Env, counter: &Pubkey) -> (u64, u64) {
    let d = env.data(counter);
    (u64::from_le_bytes(d[..8].try_into().unwrap()), u64::from_le_bytes(d[8..16].try_into().unwrap()))
}

fn load_hook(env: &mut Env) {
    env.svm.add_program(HOOK, &std::fs::read(format!("{FIXTURES}/test_hook.so")).expect("run scripts/fetch-fixtures.sh")).unwrap();
}

/// A coin with the test hook, whose list asks for a counter and nothing else. Returns the coin
/// and the accounts any of its transfers needs.
fn hooked_coin(env: &mut Env) -> (Pubkey, Vec<AccountMeta>, Pubkey) {
    load_hook(env);
    let coin = env.new_mint_2022(None, Some(HOOK));
    let counter = new_counter(env);
    let validation = install_validation(env, &coin, &HOOK, &[(counter, false, true)]);
    let metas = vec![AccountMeta::new_readonly(HOOK, false), AccountMeta::new_readonly(validation, false), AccountMeta::new(counter, false)];
    (coin, metas, counter)
}

fn with(mut ix: Instruction, extra: &[AccountMeta]) -> Instruction {
    ix.accounts.extend_from_slice(extra);
    ix
}

/// The player's associated account of a Token-2022 `mint` made to require a memo on every
/// incoming transfer (the account's owner signs; nobody else can).
fn require_memos(env: &mut Env, owner: &Keypair, mint: &Pubkey) -> Pubkey {
    use t22::extension::{memo_transfer, ExtensionType};
    let account = env.token_account(owner.pubkey(), *mint);
    let ixs = [
        t22::instruction::reallocate(&T22, &account, &owner.pubkey(), &owner.pubkey(), &[], &[ExtensionType::MemoTransfer]).unwrap(),
        memo_transfer::instruction::enable_required_transfer_memos(&T22, &account, &owner.pubkey(), &[]).unwrap(),
    ];
    env.send(&ixs, &[owner]).unwrap();
    account
}

/// A plain (not associated) Token-2022 account of `mint` owned by `owner`, opened by anyone.
fn fresh_account(env: &mut Env, mint: &Pubkey, owner: &Pubkey) -> Pubkey {
    let k = Keypair::new();
    let payer = env.cranker.insecure_clone();
    let ixs = [
        solana_system_interface::instruction::create_account(&payer.pubkey(), &k.pubkey(), env.rent(165), 165, &T22),
        t22::instruction::initialize_account3(&T22, &k.pubkey(), mint, owner).unwrap(),
    ];
    env.send(&ixs, &[&payer, &k]).unwrap();
    k.pubkey()
}

// ================================================================ mints of the wrong kind

/// Every mint a stranger hands in is checked by the token program it goes to: a classic mint
/// where the pool is Token-2022 (and the other way round), another Token-2022 mint, a prize
/// mint that is not the pool's. Each one fails, and nothing moves.
#[test]
fn sound_a_mint_of_the_wrong_program_or_another_mint_is_refused() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let gold = env.mint; // classic
    let coin = env.new_mint_2022(None, None);
    let other = env.new_mint_2022(None, None);
    env.open_pool(&owner, 1, coin).unwrap();
    env.open_pool(&owner, 2, gold).unwrap();
    let sponsor = wallet(&mut env, coin, 1_000);
    env.fund(sponsor.pubkey(), gold, 1_000);
    env.fund(sponsor.pubkey(), other, 1_000);
    env.deposit(&sponsor, 1, coin, 500).unwrap();
    env.deposit(&sponsor, 2, gold, 500).unwrap();

    // A classic mint and account into the Token-2022 pool, and the other way round.
    let mut ix = env.deposit_ix(&sponsor.pubkey(), 1, gold, 100);
    ix.accounts[3].pubkey = ata(&sponsor.pubkey(), &gold);
    assert!(err(env.send(&[ix], &[&sponsor])).contains("Account not associated with this Mint"));
    let ix = env.deposit_ix(&sponsor.pubkey(), 2, coin, 100);
    assert!(err(env.send(&[ix], &[&sponsor])).contains("IncorrectProgramId"));
    // Another Token-2022 mint, with an account of it.
    let ix = env.deposit_ix(&sponsor.pubkey(), 1, other, 100);
    assert!(err(env.send(&[ix], &[&sponsor])).contains("Account not associated with this Mint"));

    // The authority's payout names a mint of the other program, or another mint.
    for wrong in [gold, other] {
        let mut ix = env.payout_ix(authority.pubkey(), 1, ata(&sponsor.pubkey(), &coin), 100);
        ix.accounts[4].pubkey = wrong;
        let e = err(env.send(&[ix], &[&authority]));
        assert!(e.contains("InvalidAccountData") || e.contains("Account not associated with this Mint"), "{e}");
    }
    assert_eq!((env.tokens(&pool_pda(&env.game, 1)), env.tokens(&pool_pda(&env.game, 2))), (500, 500));

    // A keeper settling a prize names the box's currency as the prize's mint, when the prize
    // pool is in another mint.
    env.open_pool(&owner, 3, other).unwrap();
    env.deposit(&sponsor, 3, other, 1_000).unwrap();
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), coin, 1_000);
    env.token_account(p.pubkey(), other);
    let entries = vec![DropEntry { outcome: Outcome::Pay { pool: 3, amount: 300 }, weight: 1 }];
    env.upsert_box_args(9, box_in(coin, 100, entries, vec![pool(1, 10_000)])).unwrap();
    env.open_box(9, 1).unwrap();
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.callback_of(9, order, rnd(0)).unwrap();
    let c = env.cranker.insecure_clone();
    let mut ix = env.settle_prize_ix(order, Some(ata(&p.pubkey(), &other)), c.pubkey());
    let at = ix.accounts.iter().position(|m| m.pubkey == other).unwrap();
    ix.accounts[at].pubkey = coin;
    assert!(err(env.send(&[ix], &[&c])).contains("Account not associated with this Mint"));
    // With the right one it settles.
    env.settle_prize(order, Some(ata(&p.pubkey(), &other)), &c).unwrap();
    assert_eq!(my(&env, &p.pubkey(), &other), 300);
}

/// A "mint" that is a copy of a real one but owned by another program is no mint (`NotAMint`),
/// and a copy owned by Token-2022 at another address is refused by Token-2022.
#[test]
fn sound_a_fake_mint_is_refused() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let coin = env.new_mint_2022(Some(100), None);
    env.open_pool(&owner, 1, coin).unwrap();
    let sponsor = wallet(&mut env, coin, 1_000);
    env.deposit(&sponsor, 1, coin, 1_000).unwrap();
    let real = env.svm.get_account(&coin).unwrap();
    for program in [loot::ID, SYSTEM, T22] {
        let fake = Pubkey::new_unique();
        env.svm.set_account(fake, solana_account::Account { owner: program, ..real.clone() }).unwrap();
        let mut ix = env.payout_ix(authority.pubkey(), 1, ata(&sponsor.pubkey(), &coin), 100);
        ix.accounts[4].pubkey = fake;
        let e = err(env.send(&[ix], &[&authority]));
        match program == T22 {
            true => assert!(e.contains("Account not associated with this Mint"), "{e}"),
            false => assert!(e.contains("NotAMint"), "{e}"),
        }
    }
    assert_eq!(env.tokens(&pool_pda(&env.game, 1)), 990);
}

/// `tokens::read` and `tokens::decimals` tell a token account from a mint by their length, and
/// a Token-2022 one by its type byte at 165. A Multisig of either program is 355 bytes and has
/// no type byte: byte 165 is part of its sixth signer's key, which whoever makes it chooses.
/// So a multisig passes for a token account (with a mint, owner and amount spelled by its
/// signers' keys) or for a mint. Token-2022's own reader refuses any account of 355 bytes for
/// exactly this reason. Shown here on `create_game`: a game made with a multisig as its
/// currency and another as its treasury. Every stranger-facing read the review found either
/// reads a pool, pot or vault at a program address, or is followed by a token call that
/// refuses the multisig, or moves nothing (a claim, a lottery place, a holder's share of 0);
/// so this is a parsing gap, not a way to move value. Note, fixed: an account of 355 bytes is
/// neither a token account nor a mint.
#[test]
fn fixed_a_multisig_is_neither_a_mint_nor_a_token_account() {
    let mut env = world();
    env.init_platform(FEE).unwrap();
    let c = env.cranker.insecure_clone();

    // A multisig of `n` signers at `at`, whose signers' keys spell `bytes` at the given offsets
    // of its data (signer k starts at 3 + 32k).
    let multisig = |env: &mut Env, at: Pubkey, m: u8, n: u8, spell: &[(usize, u8)], prefix: &[u8]| {
        env.svm.set_account(at, solana_account::Account { lamports: env.rent(355), data: vec![0; 355], owner: spl_token::ID, executable: false, rent_epoch: 0 }).unwrap();
        let mut data = vec![0u8; 3 + 32 * n as usize];
        data[3..3 + prefix.len()].copy_from_slice(prefix);
        for (at, b) in spell {
            data[*at] = *b;
        }
        let signers: Vec<Pubkey> = (0..n as usize).map(|k| Pubkey::new_from_array(data[3 + 32 * k..35 + 32 * k].try_into().unwrap())).collect();
        let refs: Vec<&Pubkey> = signers.iter().collect();
        let ix = spl_token::instruction::initialize_multisig2(&spl_token::ID, &at, &refs, m).unwrap();
        env.send(&[ix], &[&c]).unwrap();
        assert_eq!(env.data(&at)[..3], [m, n, 1]);
    };

    // The "mint": initialized (byte 45), 6 decimals (byte 44), a Token-2022 mint's type byte.
    let mint = Pubkey::new_from_array([[1, 6, 1].as_slice(), &[7u8; 29]].concat().try_into().unwrap());
    multisig(&mut env, mint, 1, 6, &[(44, 6), (45, 1), (165, 1)], &[]);
    // The "treasury": its first 32 bytes are the mint above (m = 1, n = 6, initialized, then
    // the first signer's key), initialized (byte 108), a Token-2022 account's type byte.
    let treasury = Pubkey::new_unique();
    multisig(&mut env, treasury, 1, 6, &[(108, 1), (165, 2)], &[7u8; 29]);
    assert_eq!(env.data(&treasury)[..32], mint.to_bytes());

    env.mint = mint;
    env.treasury = treasury;
    assert!(err(env.create_game()).contains("NotAMint"));
}

// ================================================================ transfer hooks

/// A mint whose hook is loot itself. Every transfer loot makes calls Token-2022, which calls
/// the hook: loot would be entered again, and the runtime refuses it. A transfer someone makes
/// directly reaches loot with the hook's data, which is no instruction of loot's.
#[test]
fn sound_a_hook_cannot_reenter_loot() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let coin = env.new_mint_2022(None, Some(loot::ID));
    let validation = install_validation(&mut env, &coin, &loot::ID, &[]);
    let hook = [AccountMeta::new_readonly(loot::ID, false), AccountMeta::new_readonly(validation, false)];
    env.open_pool(&owner, 1, coin).unwrap();
    let sponsor = wallet(&mut env, coin, 1_000);

    let e = err(env.send(&[with(env.deposit_ix(&sponsor.pubkey(), 1, coin, 100), &hook)], &[&sponsor]));
    assert!(e.to_lowercase().contains("reentrancy"), "{e}");

    let to = env.token_account(owner.pubkey(), coin);
    let ix = t22::instruction::transfer_checked(&T22, &ata(&sponsor.pubkey(), &coin), &coin, &to, &sponsor.pubkey(), &[], 100, 6).unwrap();
    assert!(err(env.send(&[with(ix, &hook)], &[&sponsor])).contains("InstructionFallbackNotFound"));
    assert_eq!((env.tokens(&pool_pda(&env.game, 1)), my(&env, &sponsor.pubkey(), &coin)), (0, 1_000));
}

/// A hook whose list asks for the player as a signer, on a transfer the player signs. The
/// transfer goes through and the hook sees no signer: it never gets the player's signature.
#[test]
fn sound_a_hook_never_gets_the_players_signature() {
    let mut env = setup();
    load_hook(&mut env);
    let owner = env.creator.insecure_clone();
    let coin = env.new_mint_2022(None, Some(HOOK));
    let sponsor = Keypair::new();
    env.svm.airdrop(&sponsor.pubkey(), 10_000_000_000).unwrap();
    let counter = new_counter(&mut env);
    let validation = install_validation(&mut env, &coin, &HOOK, &[(counter, false, true), (sponsor.pubkey(), true, false)]);
    env.fund(sponsor.pubkey(), coin, 1_000);
    env.open_pool(&owner, 1, coin).unwrap();
    let hook = [
        AccountMeta::new_readonly(HOOK, false),
        AccountMeta::new_readonly(validation, false),
        AccountMeta::new(counter, false),
        AccountMeta::new_readonly(sponsor.pubkey(), false),
    ];
    let r = env.send(&[with(env.deposit_ix(&sponsor.pubkey(), 1, coin, 100), &hook)], &[&sponsor]);
    r.unwrap();
    assert_eq!(count(&env, &counter), (1, 0), "the hook ran and saw no signer");
}

/// The hook's first account is written by the test hook. When that account is one of the
/// game's (a pool, the game itself) the runtime refuses: a hook can only write what it owns,
/// whatever the instruction marks writable.
#[test]
fn sound_a_hook_cannot_write_the_games_accounts() {
    let mut env = setup();
    load_hook(&mut env);
    let owner = env.creator.insecure_clone();
    let coin = env.new_mint_2022(None, Some(HOOK));
    env.open_pool(&owner, 1, coin).unwrap();
    env.open_pool(&owner, 2, coin).unwrap();
    let sponsor = wallet(&mut env, coin, 1_000);
    for target in [pool_pda(&env.game, 2), env.game] {
        let validation = install_validation(&mut env, &coin, &HOOK, &[(target, false, true)]);
        let before = env.data(&target);
        let hook = [AccountMeta::new_readonly(HOOK, false), AccountMeta::new_readonly(validation, false), AccountMeta::new(target, false)];
        let e = err(env.send(&[with(env.deposit_ix(&sponsor.pubkey(), 1, coin, 100), &hook)], &[&sponsor]));
        assert!(e.contains("ExternalAccountDataModified"), "{e}");
        assert_eq!(env.data(&target), before);
    }
}

/// A refund reads its item as the first remaining account and hands everything to the hook;
/// the hook's accounts after the item are fine, and a keeper who puts them first is refused.
#[test]
fn sound_hook_accounts_do_not_disturb_a_refunds_item() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let (coin, hook, counter) = hooked_coin(&mut env);
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), coin, 1_000);
    env.open_pool(&owner, 1, coin).unwrap();
    env.upsert_box_args(9, box_in(coin, 100, vec![item_drop(1, 1)], vec![pool(1, 10_000)])).unwrap();
    env.send(&[with(env.open_box_ix(9, 1), &hook)], &[&p]).unwrap();
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.callback_of(9, order, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&order).outcome, Outcome::Item(1));
    assert_eq!(env.item_state(1).issued, 1);
    env.wait_slots(loot::ROLLED_REFUND_SLOTS + 1);

    let c = env.cranker.insecure_clone();
    let mut first = env.refund_ix(order);
    let item = first.accounts.pop().unwrap();
    first.accounts.extend(hook.clone());
    first.accounts.push(item);
    assert!(err(env.send(&[first], &[&c])).contains("AccountOwnedByWrongProgram"));
    env.send(&[with(env.refund_ix(order), &hook)], &[&c]).unwrap();
    assert_eq!((my(&env, &p.pubkey(), &coin), env.item_state(1).issued, count(&env, &counter).0), (1_000, 0, 2));
}

/// A hook decides each transfer for itself, so it can let a payment and its refund through and
/// refuse the settle in between (here: the test hook refuses any transfer of 13; a box of 26
/// split in two halves). The roll was "nothing", nobody can settle it, and after 7 days the
/// player gets the whole price back. A hook allied with a player can turn losing rolls into
/// refunds. A classic freeze authority can do the same by freezing the box's pools for 7 days,
/// though not for one order alone; the mint is the project's choice either way. Note.
#[test]
fn noted_a_hook_can_refuse_a_settle_and_let_the_refund_through() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let (coin, hook, _) = hooked_coin(&mut env);
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), coin, 1_000);
    env.open_pool(&owner, 1, coin).unwrap();
    env.open_pool(&owner, 2, coin).unwrap();
    env.upsert_box_args(9, box_in(coin, 26, vec![nothing()], vec![pool(1, 5_000), pool(2, 5_000)])).unwrap();
    env.send(&[with(env.open_box_ix(9, 1), &hook)], &[&p]).unwrap();
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.callback_of(9, order, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&order).outcome, Outcome::Nothing);

    let c = env.cranker.insecure_clone();
    let e = err(env.send(&[with(env.settle_prize_ix(order, None, c.pubkey()), &hook)], &[&c]));
    assert!(e.contains("custom program error: 0xd"), "{e}");
    env.wait_slots(loot::ROLLED_REFUND_SLOTS + 1);
    env.send(&[with(env.refund_ix(order), &hook)], &[&c]).unwrap();
    assert_eq!(my(&env, &p.pubkey(), &coin), 1_000, "a losing roll, refunded in full");
}

// ================================================================ accounts that refuse to receive

/// Token-2022 lets an account's owner require a memo before every incoming transfer, and a
/// program's transfer never has one. A holder whose share is due can do that to their
/// account, but the share goes to any token account the holder owns, and anyone can open one
/// in the holder's name: the keeper does, and the settle goes through. (Since the fix to finding
/// 1, passing the Memo program works too.)
#[test]
fn sound_a_holder_cannot_block_a_settle_by_requiring_memos() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let coin = env.new_mint_2022(None, None);
    let holder = wallet(&mut env, coin, 0);
    let asset = env.make(&authority, 1, holder.pubkey()).unwrap();
    let memo_only = require_memos(&mut env, &holder, &coin);
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), coin, 1_000);
    env.open_pool(&env.creator.insecure_clone(), 1, coin).unwrap();
    let shares = vec![Share { to: To::Holder(asset), bps: 5_000 }, pool(1, 5_000)];
    env.upsert_box_args(9, box_in(coin, 100, vec![nothing()], shares)).unwrap();
    env.open_box(9, 1).unwrap();
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.callback_of(9, order, rnd(0)).unwrap();

    let c = env.cranker.insecure_clone();
    let e = err(env.settle_prize(order, None, &c));
    assert!(e.contains("MemoNeeded"), "{e}");
    let fresh = fresh_account(&mut env, &coin, &holder.pubkey());
    let mut ix = env.settle_prize_ix(order, None, c.pubkey());
    ix.accounts.iter_mut().find(|m| m.pubkey == memo_only).unwrap().pubkey = fresh;
    env.send(&[ix], &[&c]).unwrap();
    assert_eq!((env.tokens(&fresh), env.tokens(&pool_pda(&env.game, 1))), (50, 50));
}

/// A refund only ever goes to the player's associated account, at a fixed address. A player who
/// requires memos on it cannot be refunded until they lift it. Only their own order is stuck
/// (its payment, its rent): nobody else's money or the game's is held up, and a stranger cannot
/// do this to a player. Note, fixed with finding 1: the refund sends a memo first when the Memo
/// program is passed with it.
#[test]
fn fixed_memos_required_on_a_players_own_account_do_not_hold_up_their_refund() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let coin = env.new_mint_2022(None, None);
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), coin, 1_000);
    env.open_pool(&owner, 1, coin).unwrap();
    env.upsert_box_args(9, box_in(coin, 100, vec![nothing()], vec![pool(1, 10_000)])).unwrap();
    env.open_box(9, 1).unwrap();
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.upsert_box_args(9, box_in(coin, 100, vec![nothing()], vec![pool(1, 10_000)])).unwrap(); // an edit: the roll fails
    env.callback_of(9, order, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&order).status, OrderStatus::Failed);

    require_memos(&mut env, &p, &coin);
    assert!(err(env.refund(order)).contains("MemoNeeded"));
    let ix = with(env.refund_ix(order), &[AccountMeta::new_readonly(loot::tokens::MEMO_ID, false)]);
    let c = env.cranker.insecure_clone();
    env.send(&[ix], &[&c]).unwrap();
    assert_eq!(my(&env, &p.pubkey(), &coin), 1_000);
}

// ================================================================ transfer fees

/// After every entry is claimed, a stranger sends tokens of a fee-taking coin to the pot, so
/// the pot holds them and fees withheld for the mint. Closing still works: what was sent is
/// burned, the withheld fees are swept to the mint, and the pot closes.
#[test]
fn sound_a_stranger_cannot_block_closing_a_pot_with_withheld_fees() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let coin = env.new_mint_2022(Some(100), None);
    let (a, b) = (wallet(&mut env, coin, 1_000), wallet(&mut env, coin, 1_000));
    let now = env.now();
    env.open_contest(&authority, 1, coin, ContestArgs { sides: 2, closes_at: now + 600, result_by: now + 1_200, shares: vec![] }).unwrap();
    env.enter(&a, 1, 0, 1_000).unwrap();
    env.enter(&b, 1, 1, 1_000).unwrap();
    env.wait(700);
    env.decide(&authority, 1, 0).unwrap();
    env.claim(1, a.pubkey(), 0, ata(&a.pubkey(), &coin)).unwrap();
    env.claim(1, b.pubkey(), 1, ata(&b.pubkey(), &coin)).unwrap();

    let stranger = wallet(&mut env, coin, 10_000);
    let pot = env.pot_pda(1);
    let ix = t22::instruction::transfer_checked(&T22, &ata(&stranger.pubkey(), &coin), &coin, &pot, &stranger.pubkey(), &[], 10_000, 6).unwrap();
    env.send(&[ix], &[&stranger]).unwrap();
    assert_eq!(env.tokens(&pot), 9_900);
    env.close_contest(1).unwrap();
    assert!(!env.exists(&pot));
}

/// A transfer fee can eat a whole small amount (1 token at 1% is a fee of 1). An entry of 1
/// then counts 0, and a stake of 1 stakes nothing: no side or position is credited with what
/// never arrived, the contest still decides, claims and closes, and the stake's total does not
/// move.
#[test]
fn sound_an_amount_the_fee_eats_whole_counts_as_nothing() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let coin = env.new_mint_2022(Some(100), None);
    let (a, b) = (wallet(&mut env, coin, 1_000), wallet(&mut env, coin, 1_000));
    let now = env.now();
    env.open_contest(&authority, 1, coin, ContestArgs { sides: 3, closes_at: now + 600, result_by: now + 1_200, shares: vec![] }).unwrap();
    env.enter(&a, 1, 0, 1).unwrap();
    env.enter(&a, 1, 2, 1).unwrap();
    env.enter(&b, 1, 1, 1_000).unwrap();
    assert_eq!((env.contest(1).sides, env.contest(1).entries), (vec![0, 990, 0], 3));
    env.wait(700);
    assert!(err(env.decide(&authority, 1, 0)).contains("NoWinner"));
    env.decide(&authority, 1, 1).unwrap();
    for (who, side) in [(a.pubkey(), 0), (a.pubkey(), 2), (b.pubkey(), 1)] {
        env.claim(1, who, side, ata(&who, &coin)).unwrap();
    }
    env.close_contest(1).unwrap();

    env.open_pool(&owner, 3, coin).unwrap();
    env.open_stake(&owner, 1, coin, 3, coin, 0).unwrap();
    env.stake(&a, 1, 1, coin).unwrap();
    let stake: loot::Stake = env.acc(&env.mechanic_pda(loot::STAKE_SEED, 1));
    assert_eq!(stake.total, 0);
    assert!(!env.exists(&env.position_pda(1, &a.pubkey())));
}

/// With a 3% fee, odd amounts, several stakers and rewards arriving twice, everyone leaves in
/// full and the vaults never owe more than they hold; a contest with three winners, a loser and
/// shares pays every winner and empties its pot.
#[test]
fn sound_every_staker_and_winner_gets_out_with_a_transfer_fee() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let coin = env.new_mint_2022(Some(300), None);
    env.open_pool(&owner, 3, coin).unwrap();
    env.open_stake(&owner, 1, coin, 3, coin, 0).unwrap();
    let stakers: Vec<Keypair> = [7_777u64, 3_333, 12_345].iter().map(|n| wallet(&mut env, coin, *n)).collect();
    for (k, n) in stakers.iter().zip([7_777u64, 3_333, 12_345]) {
        env.stake(k, 1, n, coin).unwrap();
    }
    let sponsor = wallet(&mut env, coin, 100_000);
    env.deposit(&sponsor, 3, coin, 1_001).unwrap();
    env.unstake(&stakers[1], 1, 0, coin).unwrap();
    env.deposit(&sponsor, 3, coin, 2_999).unwrap();
    for k in stakers.iter().rev() {
        let staked = env.acc::<loot::Position>(&env.position_pda(1, &k.pubkey())).amount;
        env.unstake(k, 1, staked, coin).unwrap();
    }
    assert_eq!(env.tokens(&env.staked_vault(1)), 0);
    assert!(env.tokens(&env.rewards_vault(1)) <= 3, "only the rounding a stake keeps");

    let now = env.now();
    let shares = vec![burn(333), pool(3, 1_000)];
    env.open_contest(&authority, 1, coin, ContestArgs { sides: 2, closes_at: now + 600, result_by: now + 1_200, shares }).unwrap();
    let players: Vec<(Keypair, u8, u64)> = [(1_234u64, 0u8), (987, 0), (55_555, 0), (4_321, 1)]
        .iter()
        .map(|(n, side)| (wallet(&mut env, coin, *n), *side, *n))
        .collect();
    for (k, side, n) in &players {
        env.enter(k, 1, *side, *n).unwrap();
    }
    env.wait(700);
    env.decide(&authority, 1, 0).unwrap();
    for (k, side, _) in &players {
        env.claim(1, k.pubkey(), *side, ata(&k.pubkey(), &coin)).unwrap();
    }
    assert_eq!(env.tokens(&env.pot_pda(1)), 0);
    env.close_contest(1).unwrap();
}

// ================================================================ the two fees

/// A raise of either fee never applies before its notice: a raise of one with a cut of the
/// other waits whole; repeating a raise restarts the wait; cancelling it and raising again
/// starts a new one. Each time, what a payment is really charged is the old fee until the day.
#[test]
fn sound_a_fee_raise_never_applies_early() {
    let mut env = world();
    let admin = env.admin.insecure_clone();
    let f = |player, project| Fees { player, project };
    let start = f(2_000_000, 10_000);
    env.init_platform_fees(&admin, program_data(), start).unwrap();
    assert!(err(env.init_platform_fees(&admin, program_data(), start)).len() > 0);
    env.create_game().unwrap();
    env.catalog();
    let owner = env.creator.insecure_clone();
    let gold = env.mint;
    env.open_pool(&owner, 0, gold).unwrap();
    let charged = |env: &mut Env| {
        let before = env.fees();
        env.pay(10, vec![pool(0, 10_000)]).unwrap();
        env.fees() - before
    };

    // A raise of the player fee with a cut of the project fee: neither applies now.
    env.set_platform_fees(&admin, f(3_000_000, 5_000), admin.pubkey()).unwrap();
    assert_eq!(charged(&mut env), 2_000_000);
    env.wait(loot::NOTICE_SECONDS - 10);
    assert_eq!(charged(&mut env), 2_000_000);
    // Setting the same raise again restarts the wait.
    env.set_platform_fees(&admin, f(3_000_000, 5_000), admin.pubkey()).unwrap();
    env.wait(20);
    assert_eq!(charged(&mut env), 2_000_000);
    // Cancelling (setting the fees in force) and raising again starts over.
    env.set_platform_fees(&admin, start, admin.pubkey()).unwrap();
    env.set_platform_fees(&admin, f(3_000_000, 5_000), admin.pubkey()).unwrap();
    env.wait(loot::NOTICE_SECONDS - 1);
    assert_eq!(charged(&mut env), 2_000_000);
    env.wait(1);
    assert_eq!(charged(&mut env), 3_000_000);
    // Each fee is capped on its own.
    assert!(err(env.set_platform_fees(&admin, f(0, loot::MAX_FEE_LAMPORTS + 1), admin.pubkey())).contains("FeeAboveCap"));
    assert_eq!(env.svm.get_account(&platform_pda()).unwrap().data.len(), loot::state::Platform::SPACE);
    let _ = DAY;
}

/// A winner who requires memos on their own account cannot hold up a contest's close either:
/// a claim goes to any token account the player owns, and a keeper opens one.
#[test]
fn sound_a_winner_cannot_hold_up_a_contests_close_by_requiring_memos() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let coin = env.new_mint_2022(None, None);
    let (a, b) = (wallet(&mut env, coin, 1_000), wallet(&mut env, coin, 1_000));
    let now = env.now();
    env.open_contest(&authority, 1, coin, ContestArgs { sides: 2, closes_at: now + 600, result_by: now + 1_200, shares: vec![] }).unwrap();
    env.enter(&a, 1, 0, 1_000).unwrap();
    env.enter(&b, 1, 1, 1_000).unwrap();
    env.wait(700);
    env.decide(&authority, 1, 0).unwrap();
    let memo_only = require_memos(&mut env, &a, &coin);
    assert!(err(env.claim(1, a.pubkey(), 0, memo_only)).contains("MemoNeeded"));
    let fresh = fresh_account(&mut env, &coin, &a.pubkey());
    env.claim(1, a.pubkey(), 0, fresh).unwrap();
    env.claim(1, b.pubkey(), 1, ata(&b.pubkey(), &coin)).unwrap();
    env.close_contest(1).unwrap();
    assert_eq!(env.tokens(&fresh), 2_000);
}

/// A split can name a token account (`To::Account`: a partner, a creator). Its owner can
/// require memos on it, and no transfer the program makes carries one, so every settle of every
/// order whose split names it fails, and after 7 days each order is refunded in full, losing
/// rolls included. Nobody can route around it: the address is fixed in the order. With a
/// classic token the same owner could only close the account, and when it is an associated
/// account anyone re-creates it and settles in the same transaction; Token-2022 makes the
/// block lasting. The same holds for a contest's `To::Account` share (its `decide` fails until
/// the result is overdue, and the contest is called off) and for the game's treasury when it
/// is someone else's account. The project named the account, so this is Low. Fixed: a transfer
/// into an account that requires memos sends one first, through the Memo program the sender
/// passes with the hook's accounts (without it, `MemoNeeded`).
#[test]
fn fixed_a_named_account_that_requires_memos_cannot_block_a_settle() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let coin = env.new_mint_2022(None, None);
    let partner = wallet(&mut env, coin, 0);
    let partner_account = ata(&partner.pubkey(), &coin);
    let p = env.player.insecure_clone();
    env.fund(p.pubkey(), coin, 1_000);
    env.open_pool(&owner, 1, coin).unwrap();
    let shares = vec![Share { to: To::Account(partner_account), bps: 1_000 }, pool(1, 9_000)];
    env.upsert_box_args(9, box_in(coin, 100, vec![nothing()], shares)).unwrap();
    env.open_box(9, 1).unwrap();
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.callback_of(9, order, rnd(0)).unwrap();

    require_memos(&mut env, &partner, &coin);
    let c = env.cranker.insecure_clone();
    assert!(err(env.settle_prize(order, None, &c)).contains("MemoNeeded"));
    let ix = with(env.settle_prize_ix(order, None, c.pubkey()), &[AccountMeta::new_readonly(loot::tokens::MEMO_ID, false)]);
    env.send(&[ix], &[&c]).unwrap();
    assert_eq!((my(&env, &partner.pubkey(), &coin), my(&env, &p.pubkey(), &coin)), (10, 900), "the losing roll is settled");
}
