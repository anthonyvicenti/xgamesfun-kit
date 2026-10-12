//! Independent security review of loot 0.3 (2026-10-11).
//!
//! `fixed_*` tests are the reviewer's findings turned round after the fix: each asserts that
//! the attack now fails. `finding_*` tests pass WHILE a weakness exists (one is left, by
//! decision: a mint with a freeze authority).
//!
//! `sound_*` tests are attacks the review tried that the program refuses, where the other test
//! files did not already cover them.
mod common;

use {
    anchor_lang::{
        solana_program::instruction::{AccountMeta, Instruction},
        Discriminator,
    },
    anchor_spl::token::spl_token,
    common::*,
    loot::{
        state::{ItemKind, Order, OrderStatus},
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const PRIZE: u8 = 0;

fn funded(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    k
}

/// The failure's text. Panics if the transaction went through.
fn err(r: Result<Vec<String>, String>) -> String {
    r.expect_err("expected the transaction to fail")
}

fn order_1(env: &Env) -> Pubkey {
    order_pda(&env.game, &env.player.pubkey(), 1)
}

use anchor_lang::prelude::Pubkey;

// ================================================================ findings

/// FINDING 1 (medium), fixed. Every receipt used to pay its fee to a wallet the platform could
/// change at once; pointing it at an address no transaction can write stopped `payout` and
/// `settle`. Fees now collect in the platform record, which this program owns: there is no
/// wallet to repoint, and nothing the platform admin can sign stops what is owed.
#[test]
fn fixed_nothing_the_platform_signs_stops_a_payout_or_a_settle() {
    let mut env = setup();
    let (owner, authority, admin, keeper) =
        (env.creator.insecure_clone(), env.authority.insecure_clone(), env.admin.insecure_clone(), env.cranker.insecure_clone());
    env.open_pool(&owner, PRIZE, env.mint).unwrap();
    env.pay(10 * PRICE, vec![pool(PRIZE, 10_000)]).unwrap();
    env.buy(3, 1).unwrap();
    let order = order_1(&env);
    let to = ata(&env.player.pubkey(), &env.mint);

    // Everything the admin can do: the highest fee, the game suspended, the fees taken out
    // (to the program's own address, which can never be written), the platform handed away.
    env.set_fee(loot::MAX_FEE_LAMPORTS).unwrap();
    env.wait(loot::NOTICE_SECONDS + 1);
    env.set_suspended(&admin, true).unwrap();
    assert!(env.collect_fees(&admin, loot::ID).is_err());
    env.collect_fees(&admin, admin.pubkey()).unwrap();
    env.set_platform(&admin, loot::MAX_FEE_LAMPORTS, loot::ID).unwrap();

    env.payout(&authority, PRIZE, to, 10 * PRICE).unwrap();
    env.settle(order, &keeper).unwrap();
    assert_eq!(env.fees(), loot::MAX_FEE_LAMPORTS + FEE, "the payout at today's fee, the order at its own");
}

/// FINDING 2a (medium, conditional on the oracle), fixed. An order's address depends only on
/// (game, player, nonce) and is free again once the order closes, so a roll asked for a
/// refunded order used to be accepted by a new order at the same nonce, with randomness the
/// player had already seen. A roll now carries the ticket of its own purchase (the order and
/// the slot it was paid in), and an order takes only its own.
#[test]
fn fixed_a_late_roll_does_not_land_on_a_new_order_at_the_same_nonce() {
    let mut env = setup();
    let c = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.open_box(1, 1).unwrap();
    // The oracle's answer to this purchase, which arrives late.
    let late = env.callback_ix(scoped_identity(), order, rnd(0));
    env.wait_slots(loot::STALE_SLOTS + 1);
    env.refund(order).unwrap();
    assert!(env.send_unsigned(&[late.clone()], &c).is_err());

    // The player likes what they saw and opens the same nonce again.
    env.open_box(1, 1).unwrap();
    assert!(err(env.send_unsigned(&[late], &c)).contains("BadOrderState"));
    assert_eq!(env.acc::<Order>(&order).status, OrderStatus::Pending);
    // The new purchase's own roll is taken.
    env.callback(order, rnd(1)).unwrap();
}

/// FINDING 2b (low), fixed. An order's collectible sat at `["asset", order]`, so a second
/// purchase at the nonce of a settled order could never settle: its asset address was taken. The
/// address now includes the slot of the purchase.
#[test]
fn fixed_a_reused_nonce_buys_a_collectible_that_settles() {
    let mut env = setup();
    let keeper = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.buy(3, 1).unwrap();
    let first = env.asset_pda(&order);
    env.settle(order, &keeper).unwrap();

    env.wait_slots(1);
    env.buy(3, 1).unwrap(); // the same nonce
    let second = env.asset_pda(&order);
    env.settle(order, &keeper).unwrap();
    assert_ne!(first, second);
    assert!(env.exists(&first) && env.exists(&second));
}

/// FINDING 3 (low), fixed. `Paid.mint` was whatever account the payer passed unless the split
/// had a burn share. `pay` now checks it against the token account the payment comes from.
/// Still true, and harmless: the treasury's holder can "pay" the treasury from the treasury.
/// Nothing moves, and the receipt names that holder as the player.
#[test]
fn fixed_the_paid_receipt_names_the_mint_that_moved() {
    let mut env = setup();
    let (owner, p) = (env.creator.insecure_clone(), env.player.insecure_clone());
    let usdc = env.new_mint(owner.pubkey());
    for wrong in [usdc, env.cranker.pubkey()] {
        let mut ix = env.pay_ix(p.pubkey(), env.mint, PRICE, vec![]);
        ix.accounts[2].pubkey = wrong;
        assert!(err(env.send(&[ix], &[&p])).contains("ConstraintTokenMint"));
    }
    let logs = env.pay(5 * PRICE, vec![]).unwrap();
    let paid: loot::receipts::Paid = receipt(&logs);
    assert_eq!((paid.mint, paid.amount, paid.to_treasury), (env.mint, 5 * PRICE, 5 * PRICE));
}

/// FINDING 4 (low), fixed. A payment in another mint failed whenever its split rounded, because
/// the leftover unit went to the treasury, which holds the game's mint. When the shares take
/// the whole payment, the last share now takes the rounding too.
#[test]
fn fixed_pay_in_another_mint_works_when_the_split_rounds() {
    let mut env = setup();
    let (owner, p) = (env.creator.insecure_clone(), env.player.insecure_clone());
    let usdc = env.new_mint(owner.pubkey());
    env.fund(p.pubkey(), usdc, 100 * PRICE);
    env.open_pool(&owner, 7, usdc).unwrap();
    env.open_pool(&owner, 8, usdc).unwrap();

    let ix = env.pay_ix(p.pubkey(), usdc, 10 * PRICE + 1, vec![pool(7, 5_000), pool(8, 5_000)]);
    env.send(&[ix], &[&p]).unwrap();
    assert_eq!(env.tokens(&pool_pda(&env.game, 7)), 5 * PRICE);
    assert_eq!(env.tokens(&pool_pda(&env.game, 8)), 5 * PRICE + 1);
}

/// FINDING 5 (low), fixed. The token program closes a wrapped-SOL account with its whole
/// balance, so `close_pool` emptied a wrapped-SOL pool to the owner with no payout and no
/// receipt. `close_pool` now refuses a pool that holds anything.
#[test]
fn fixed_close_pool_refuses_a_wrapped_sol_pool_that_holds_sol() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    // The native mint, as it is on every cluster: 9 decimals, no authorities.
    let mut mint = vec![0u8; 82];
    mint[44] = 9;
    mint[45] = 1;
    env.put(spl_token::native_mint::ID, spl_token::ID, mint);
    env.open_pool(&owner, 9, spl_token::native_mint::ID).unwrap();
    let pool = pool_pda(&env.game, 9);
    env.svm.airdrop(&pool, 2_000_000_000).unwrap();
    let c = env.cranker.insecure_clone();
    env.send(&[spl_token::instruction::sync_native(&spl_token::ID, &pool).unwrap()], &[&c]).unwrap();

    assert!(err(env.close_pool(&owner, 9)).contains("PoolNotEmpty"));
    assert_eq!(env.tokens(&pool), 2_000_000_000);
}

/// FINDING 6 (low; by SPL's design, but against "an open order always has a way out"). OPEN:
/// refusing such mints would refuse USDC. A project's page should say when its mint can freeze.
/// `create_game` takes a mint with a freeze authority. Whoever holds it can freeze the game's
/// vault, or one player's token account: then neither settle nor refund can move that order's
/// payment, for as long as the freeze lasts. Nothing is stolen; the order is held hostage.
#[test]
fn finding_a_freeze_authority_holds_open_orders_hostage() {
    let mut env = world();
    let (owner, keeper) = (env.creator.insecure_clone(), env.cranker.insecure_clone());
    let player = env.player.pubkey();
    // The game's token, this time with a freeze authority.
    let mint = Keypair::new();
    let ixs = [
        solana_system_interface::instruction::create_account(&owner.pubkey(), &mint.pubkey(), env.rent(82), 82, &spl_token::ID),
        spl_token::instruction::initialize_mint2(&spl_token::ID, &mint.pubkey(), &owner.pubkey(), Some(&owner.pubkey()), 6).unwrap(),
    ];
    env.send(&ixs, &[&owner, &mint]).unwrap();
    env.mint = mint.pubkey();
    env.treasury = env.token_account(owner.pubkey(), env.mint);
    env.fund(player, env.mint, 100 * PRICE);
    env.init_platform(FEE).unwrap();
    env.create_game().unwrap();
    env.catalog();

    env.buy(3, 1).unwrap();
    let (order, vault) = (order_1(&env), ata(&env.game, &env.mint));
    let freeze = spl_token::instruction::freeze_account(&spl_token::ID, &vault, &env.mint, &owner.pubkey(), &[]).unwrap();
    env.send(&[freeze], &[&owner]).unwrap();

    assert!(env.settle(order, &keeper).is_err());
    env.wait_slots(loot::ROLLED_REFUND_SLOTS + 1);
    assert!(env.refund(order).is_err(), "the way out is shut too");
    assert_eq!(env.tokens(&vault), PRICE / 2);
}

// ================================================================ sound: attacks the program refuses

/// The roll is only as good as who may ask for one. `callback_roll` trusts any callback the VRF
/// program signs for this program, so the VRF program must take requests for loot's callback
/// from loot alone. It does: a request sent straight to the VRF program, naming loot's
/// `callback_roll` and an order of the sender's choice, is refused unless loot's own identity
/// PDA signs it (and only loot can sign for that).
#[test]
fn sound_nobody_else_can_ask_the_oracle_to_roll_an_order() {
    let mut env = setup();
    let attacker = funded(&mut env);
    let order = order_1(&env);
    env.open_box(1, 1).unwrap();

    let the_box = box_pda(&env.game, 1);
    let request = |identity: Pubkey| {
        let mut data = vec![10u8]; // scoped request, as `#[vrf]` sends it
        let sdk = ephemeral_rollups_sdk::vrf::instructions::create_request_randomness_ix(
            ephemeral_rollups_sdk::vrf::instructions::RequestRandomnessParams {
                payer: attacker.pubkey(),
                oracle_queue: QUEUE,
                callback_program_id: loot::ID,
                callback_discriminator: loot::instruction::CallbackRoll::DISCRIMINATOR.to_vec(),
                caller_seed: [42; 32], // a seed the attacker ground offline
                accounts_metas: Some(vec![
                    ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta { pubkey: order, is_signer: false, is_writable: true },
                    ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta { pubkey: the_box, is_signer: false, is_writable: false },
                ]),
                ..Default::default()
            },
        );
        data.extend_from_slice(&sdk.data[1..]);
        Instruction::new_with_bytes(
            VRF,
            &data,
            vec![
                AccountMeta::new(attacker.pubkey(), true),
                AccountMeta::new_readonly(identity, true),
                AccountMeta::new(QUEUE, false),
                AccountMeta::new_readonly(SYSTEM, false),
                AccountMeta::new_readonly(SLOT_HASHES, false),
            ],
        )
    };
    // With the attacker's own key as the "program identity": it really signs, and is refused.
    let ix = request(attacker.pubkey());
    assert!(env.send(&[ix], &[&attacker]).is_err());
    // Control: the same bytes with loot's identity are accepted when that PDA is taken as having
    // signed (sigverify is off in this harness; on a cluster only loot can sign for it). This
    // proves the request above was refused for its identity and not for its shape.
    let ix = request(pda(&[b"identity"]));
    env.send_unsigned(&[ix], &attacker).unwrap();
}

/// One order pays once. A second settle, or a refund after a settle, in the same transaction or
/// a later one, finds no order.
#[test]
fn sound_an_order_ends_once() {
    let mut env = setup();
    let keeper = env.cranker.insecure_clone();
    let (first, second) = (order_1(&env), order_pda(&env.game, &env.player.pubkey(), 2));
    env.buy(3, 1).unwrap();
    env.buy(3, 2).unwrap();
    let vault = ata(&env.game, &env.mint);
    assert_eq!(env.tokens(&vault), PRICE);

    // Twice in one transaction: all of it fails, nothing moved.
    let twice = [env.settle_ix(first, keeper.pubkey()), env.settle_ix(first, keeper.pubkey())];
    assert!(env.send(&twice, &[&keeper]).is_err());
    env.wait_slots(loot::ROLLED_REFUND_SLOTS + 1);
    let both = [env.settle_ix(first, keeper.pubkey()), env.refund_ix(first)];
    assert!(env.send(&both, &[&keeper]).is_err());
    let both = [env.refund_ix(first), env.settle_ix(first, keeper.pubkey())];
    assert!(env.send(&both, &[&keeper]).is_err());
    assert_eq!(env.tokens(&vault), PRICE);

    // Once each, then never again: the other order's payment stays where it is.
    let (settle_again, refund_again) = (env.settle_ix(first, keeper.pubkey()), env.refund_ix(first));
    env.settle(first, &keeper).unwrap();
    assert!(env.send(&[settle_again], &[&keeper]).is_err());
    assert!(env.send(&[refund_again], &[&keeper]).is_err());
    assert_eq!(env.tokens(&vault), PRICE / 2);
    env.refund(second).unwrap();
    assert_eq!(env.tokens(&vault), 0);
}

/// The vault and the pools are the game's, and no instruction lets a signer who is not the
/// game spend from them by naming them as the paying account.
#[test]
fn sound_nobody_pays_with_the_games_own_accounts() {
    let mut env = setup();
    let (owner, authority, p) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.player.insecure_clone());
    env.open_pool(&owner, PRIZE, env.mint).unwrap();
    env.open_pool(&owner, 1, env.mint).unwrap();
    env.pay(4 * PRICE, vec![pool(PRIZE, 10_000)]).unwrap();
    env.buy(3, 1).unwrap();
    let (vault, prize) = (ata(&env.game, &env.mint), pool_pda(&env.game, PRIZE));
    let player_token = ata(&p.pubkey(), &env.mint);

    for (who, from) in [(&p, vault), (&p, prize), (&authority, vault), (&authority, prize), (&owner, vault), (&owner, prize)] {
        // pay, from the vault or a pool, into the treasury.
        let mut ix = env.pay_ix(who.pubkey(), env.mint, PRICE / 2, vec![]);
        ix.accounts[3].pubkey = from;
        assert!(env.send(&[ix], &[who]).is_err());
        // deposit, from the vault or a pool, into pool 1.
        let ix = Instruction::new_with_bytes(
            loot::ID,
            &anchor_lang::InstructionData::data(&loot::instruction::Deposit { index: 1, amount: PRICE / 2 }),
            anchor_lang::ToAccountMetas::to_account_metas(
                &loot::accounts::Deposit {
                    depositor: who.pubkey(),
                    game: env.game,
                    pool: pool_pda(&env.game, 1),
                    from,
                    mint: env.mint,
                    token_program: spl_token::ID,
                    token_2022_program: loot::tokens::TOKEN_2022_ID,
                    fee: env.fee(),
                },
                None,
            ),
        );
        assert!(env.send(&[ix], &[who]).is_err());
    }
    // buy_item, paid for out of the vault.
    let mut ix = env.buy_ix(3, 2);
    let at = ix.accounts.iter().position(|m| m.pubkey == player_token).unwrap();
    ix.accounts[at].pubkey = vault;
    assert!(env.send(&[ix], &[&p]).is_err());

    assert_eq!((env.tokens(&vault), env.tokens(&prize)), (PRICE / 2, 4 * PRICE));
}

/// A box is not an item, and an item is not a box: the one-byte tags keep the hand-read
/// `ItemView` and the typed accounts apart.
#[test]
fn sound_an_item_and_a_box_are_never_taken_for_each_other() {
    let mut env = setup();
    let (p, c, keeper) = (env.player.insecure_clone(), env.cranker.insecure_clone(), env.cranker.insecure_clone());
    let (the_box, item_1) = (box_pda(&env.game, 1), item_pda(&env.game, 1));

    // open_box with the box where an item should be.
    let mut ix = env.open_box_ix(1, 1);
    ix.accounts.last_mut().unwrap().pubkey = the_box;
    assert!(err(env.send(&[ix], &[&p])).contains("AccountDidNotDeserialize"));
    // open_box with an item where the box should be.
    let mut ix = env.open_box_ix(1, 1);
    ix.accounts[0].pubkey = item_1;
    assert!(env.send(&[ix], &[&p]).is_err());
    // buy_item with a box where the item should be.
    let mut ix = env.buy_ix(3, 1);
    ix.accounts[0].pubkey = the_box;
    assert!(env.send(&[ix], &[&p]).is_err());

    env.open_box(1, 1).unwrap();
    let order = order_1(&env);
    // The roll with the box in an item's place.
    let mut ix = env.callback_ix(scoped_identity(), order, rnd(0));
    ix.accounts[4].pubkey = the_box;
    assert!(err(env.send_unsigned(&[ix], &c)).contains("AccountDidNotDeserialize"));
    env.callback(order, rnd(0)).unwrap();

    // settle with another item, or the box, in the item's place.
    for wrong in [item_pda(&env.game, 3), the_box] {
        let mut ix = env.settle_ix(order, keeper.pubkey());
        let at = ix.accounts.iter().position(|m| m.pubkey == item_1).unwrap();
        ix.accounts[at].pubkey = wrong;
        assert!(env.send(&[ix], &[&keeper]).is_err());
    }
    // The refund of a rolled order with the box as its item.
    env.wait_slots(loot::ROLLED_REFUND_SLOTS + 1);
    let mut ix = env.refund_ix(order);
    ix.accounts.last_mut().unwrap().pubkey = the_box;
    assert!(err(env.send(&[ix], &[&c])).contains("AccountDidNotDeserialize"));
    assert_eq!(env.item_state(1).issued, 1);
}

/// `Checkout` is a group of accounts inside `BuyItem` and `OpenBox`, and takes its `nonce` from
/// the instruction data that follows the outer struct's id. With an id and a nonce that share no
/// bytes, the order lands at the address of exactly that nonce, for both instructions.
#[test]
fn sound_checkout_reads_the_nonce_that_follows_the_id() {
    let mut env = setup();
    let player = env.player.pubkey();
    let (a, b) = (0xA1B2_C3D4_E5F6_0718u64, 0x0102_0304_0506_0708u64);
    env.buy(3, a).unwrap();
    env.open_box(1, b).unwrap();
    let (oa, ob): (Order, Order) = (env.acc(&order_pda(&env.game, &player, a)), env.acc(&order_pda(&env.game, &player, b)));
    assert_eq!((oa.nonce, oa.outcome, oa.status), (a, loot::state::Outcome::Item(3), OrderStatus::Rolled));
    assert_eq!((ob.nonce, ob.loot_box, ob.status), (b, box_pda(&env.game, 1), OrderStatus::Pending));
    // What a misread would have produced (the id's 4 bytes then the nonce's first 4) is empty.
    let misread = ((a & 0xFFFF_FFFF) << 32) | 3;
    assert!(!env.exists(&order_pda(&env.game, &player, misread)));
}

/// A raise of the fee that takes effect while an order is open changes nothing for it: the
/// escrow holds the fee the player was shown, pays exactly that, and returns the rest.
#[test]
fn sound_a_fee_raise_between_purchase_and_settle_costs_the_order_nothing_more() {
    let mut env = setup();
    let keeper = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.set_fee(0).unwrap();
    env.buy(3, 1).unwrap(); // under a fee of 0
    env.set_fee(loot::MAX_FEE_LAMPORTS).unwrap();
    env.wait(loot::NOTICE_SECONDS + 1);
    assert_eq!(env.platform().fees(env.now()).player, loot::MAX_FEE_LAMPORTS);

    let sol = env.lamports(&env.player.pubkey());
    let asset = env.asset_pda(&order);
    env.settle(order, &keeper).unwrap();
    assert_eq!(env.fees(), 0, "the order was bought at a fee of 0");
    let back = env.lamports(&env.player.pubkey()) - sol;
    assert_eq!(back, env.rent(Order::SPACE) + loot::ESCROW_LAMPORTS - env.lamports(&asset));
    assert_eq!(env.lamports(&escrow_pda(&order)), 0);
}

/// SOL parked at a catalog address before its first write does not block the write (a plain
/// `create_account` would fail), and the account ends exactly as big as what it holds.
#[test]
fn sound_a_prefunded_catalog_address_is_still_created() {
    let mut env = setup();
    let (item_9, box_9) = (item_pda(&env.game, 9), box_pda(&env.game, 9));
    env.svm.airdrop(&item_9, 1).unwrap();
    env.svm.airdrop(&box_9, 50_000_000).unwrap();
    env.upsert_item(9, item(ItemKind::Normal, "Parked", 0, PRICE)).unwrap();
    env.upsert_box(9, PRICE, vec![], vec![item_drop(9, 1)]).unwrap();
    assert_eq!(env.item_state(9).name, "Parked");
    assert_eq!(env.lamports(&item_9), env.rent(env.data(&item_9).len()));
    assert!(env.lamports(&box_9) >= 50_000_000);

    // An asset key that is already an asset cannot be made again.
    let authority = env.authority.insecure_clone();
    let made = env.make(&authority, 1, authority.pubkey()).unwrap();
    let ix = Instruction::new_with_bytes(
        loot::ID,
        &anchor_lang::InstructionData::data(&loot::instruction::Make { reference: REF }),
        anchor_lang::ToAccountMetas::to_account_metas(
            &loot::accounts::Make {
                authority: authority.pubkey(),
                game: env.game,
                item: item_pda(&env.game, 1),
                collection: env.collection,
                asset: made,
                owner: authority.pubkey(),
                mpl_core_program: mpl_core::ID,
                fee: env.fee(),
            },
            None,
        ),
    );
    assert!(env.send_unsigned(&[ix], &authority).is_err());
    assert_eq!(env.item_state(1).issued, 1);
}
