//! Orders in LiteSVM, against the real program binary and the real Metaplex Core and MagicBlock
//! VRF programs: a purchase, its roll, settle and refund; and the settings an owner signs.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    loot::{
        state::{DropEntry, ItemKind, Order, OrderStatus, Outcome},
        GameUpdate, ItemArgs,
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

fn err(r: Result<Vec<String>, String>) -> String {
    r.expect_err("expected the transaction to fail")
}

fn asset_of(env: &Env, key: &Pubkey) -> mpl_core::Asset {
    *mpl_core::Asset::from_bytes(&env.data(key)).unwrap()
}

fn update() -> GameUpdate {
    GameUpdate { owner: None, authority: None, paused: None }
}

/// The player's first order.
fn order_1(env: &Env) -> Pubkey {
    order_pda(&env.game, &env.player.pubkey(), 1)
}

fn box_entries() -> Vec<DropEntry> {
    vec![item_drop(1, 1), item_drop(2, 1)]
}

// ================================================================ the whole path

/// A box whose sale feeds a prize pool: open, roll, settle. Every coin and every lamport is
/// accounted for.
#[test]
fn open_a_box_roll_it_and_settle_into_pools() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let keeper = env.cranker.insecure_clone();
    let player = env.player.pubkey();
    env.open_pool(&owner, PRIZE, env.mint).unwrap();
    env.upsert_box(1, PRICE, vec![pool(PRIZE, 5_000), burn(1_000)], box_entries()).unwrap();
    let (order, vault) = (order_1(&env), ata(&env.game, &env.mint));
    let had = env.tokens(&ata(&player, &env.mint));
    let supply = env.supply(&env.mint);

    // Open: the price waits in the vault, the asset's rent and the fee wait in the escrow.
    env.open_box(1, 1).unwrap();
    assert_eq!(env.tokens(&ata(&player, &env.mint)), had - PRICE);
    assert_eq!(env.tokens(&vault), PRICE);
    assert_eq!(env.lamports(&escrow_pda(&order)), loot::ESCROW_LAMPORTS + FEE);
    assert_eq!(env.data(&order).len(), Order::SPACE);
    let o: Order = env.acc(&order);
    assert_eq!((o.status, o.paid, o.fee, o.shares.len()), (OrderStatus::Pending, PRICE, FEE, 2));
    assert!(env.settle(order, &keeper).is_err(), "not rolled yet");

    // Roll: 0 of weights [1, 1] picks item 1, the collectible.
    env.callback(order, rnd(0)).unwrap();
    let o: Order = env.acc(&order);
    assert_eq!((o.status, o.outcome, o.serial), (OrderStatus::Rolled, Outcome::Item(1), 1));
    assert_eq!(env.item_state(1).issued, 1);
    assert!(err(env.callback(order, rnd(1))).contains("BadOrderState"), "a roll happens once");

    // Settle: anyone can, and the asset goes to the player.
    let sol = env.lamports(&player);
    let asset = env.asset_pda(&order);
    env.settle(order, &keeper).unwrap();
    let a = asset_of(&env, &asset);
    assert_eq!((a.base.owner, a.base.name.as_str()), (player, "Gecko Crown #1"));
    assert!(a.plugin_list.permanent_freeze_delegate.is_none());
    dump_asset(&env, &asset, "core-asset-tradeable");

    // The payment: 50% to the prize, 10% burned, 40% left for the treasury. The vault is empty.
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZE)), PRICE / 2);
    assert_eq!(supply - env.supply(&env.mint), PRICE / 10);
    assert_eq!(env.tokens(&env.treasury), PRICE * 4 / 10);
    assert_eq!(env.tokens(&vault), 0);
    // The SOL: the fee to the platform, the asset's rent to the asset, everything else (the
    // order's rent and the escrow's change) back to the player.
    assert_eq!(env.fees(), FEE);
    assert!(!env.exists(&order) && !env.exists(&escrow_pda(&order)));
    let back = env.lamports(&player) - sol;
    assert_eq!(back, env.rent(Order::SPACE) + loot::ESCROW_LAMPORTS - env.lamports(&asset));
}

#[test]
fn a_normal_item_is_settled_by_one_of_the_games_two_keys() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let keeper = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.open_box(1, 1).unwrap();
    env.callback(order, rnd(1)).unwrap(); // item 2, normal
    let asset = env.asset_pda(&order);

    assert!(err(env.settle(order, &keeper)).contains("NotTheGames"));
    // The game's server, once its backend has delivered the item (the owner can too).
    env.settle(order, &authority).unwrap();
    assert!(!env.exists(&asset), "nothing is minted for a normal item");
    assert_eq!(env.tokens(&env.treasury), PRICE * 8 / 10);
    assert_eq!(env.fees(), FEE);
}

#[test]
fn a_shop_purchase_of_a_soulbound_collectible() {
    let mut env = setup();
    let keeper = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.buy(3, 1).unwrap();
    let o: Order = env.acc(&order);
    assert_eq!((o.status, o.outcome, o.serial, o.paid), (OrderStatus::Rolled, Outcome::Item(3), 1, PRICE / 2));
    let asset = env.asset_pda(&order);
    env.settle(order, &keeper).unwrap();

    let a = asset_of(&env, &asset);
    assert_eq!(a.base.name, "Founder Badge #1");
    assert!(a.plugin_list.permanent_freeze_delegate.unwrap().permanent_freeze_delegate.frozen);
    dump_asset(&env, &asset, "core-asset-soulbound");
    // It cannot be transferred.
    let p = env.player.insecure_clone();
    let ix = mpl_core::instructions::TransferV1Builder::new()
        .asset(asset)
        .collection(Some(env.collection))
        .payer(p.pubkey())
        .new_owner(keeper.pubkey())
        .instruction();
    assert!(env.send(&[ix], &[&p]).is_err());
}

// ================================================================ the roll

#[test]
fn only_the_oracle_rolls() {
    let mut env = setup();
    let order = order_1(&env);
    env.open_box(1, 1).unwrap();
    let c = env.cranker.insecure_clone();

    // Signed by someone who is not the oracle's identity for this program.
    for identity in [c.pubkey(), Pubkey::find_program_address(&[b"identity"], &VRF).0] {
        let ix = env.callback_ix(identity, order, rnd(0));
        assert!(env.send_unsigned(&[ix], &c).is_err());
    }
    // The right identity with the wrong items.
    let mut ix = env.callback_ix(scoped_identity(), order, rnd(0));
    ix.accounts.swap(4, 5);
    assert!(err(env.send_unsigned(&[ix], &c)).contains("ItemMismatch"));
    let o: Order = env.acc(&order);
    assert_eq!(o.status, OrderStatus::Pending);
}

// ================================================================ refunds

/// Everything in the box is sold out when the roll arrives: the player gets all of it back, at
/// once, and the platform takes no fee.
#[test]
fn a_failed_roll_refunds_everything() {
    let mut env = setup();
    let player = env.player.pubkey();
    // One item, supply 1, in a box of its own; two players' worth of orders.
    env.upsert_item(5, item(ItemKind::Collectible, "Last One", 1, 0)).unwrap();
    env.upsert_box(1, PRICE, vec![], vec![item_drop(5, 1)]).unwrap();
    let (first, second) = (order_1(&env), order_pda(&env.game, &player, 2));
    let had = env.tokens(&ata(&player, &env.mint));
    env.open_box(1, 1).unwrap();
    env.open_box(1, 2).unwrap();
    env.callback(first, rnd(0)).unwrap();
    env.callback(second, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&second).status, OrderStatus::Failed);
    assert!(err(env.open_box(1, 3)).contains("SoldOut"));

    let sol = env.lamports(&player);
    env.refund(second).unwrap();
    assert!(!env.exists(&second) && !env.exists(&escrow_pda(&second)));
    assert_eq!(env.tokens(&ata(&player, &env.mint)), had - PRICE, "only the first order's price is out");
    // All the SOL the order held: its rent, the asset's rent and the fee that was never due.
    assert_eq!(env.lamports(&player) - sol, env.rent(Order::SPACE) + loot::ESCROW_LAMPORTS + FEE);
    assert_eq!(env.fees(), 0);
}

#[test]
fn a_roll_that_never_arrives_refunds_after_ten_minutes() {
    let mut env = setup();
    let order = order_1(&env);
    env.open_box(1, 1).unwrap();
    assert!(err(env.refund(order)).contains("NotStale"));
    env.wait_slots(loot::STALE_SLOTS);
    assert!(err(env.refund(order)).contains("NotStale"));
    env.wait_slots(1);
    env.refund(order).unwrap();
    assert_eq!(env.tokens(&ata(&env.game, &env.mint)), 0);
    assert_eq!(env.fees(), 0);
}

/// A game that never settles cannot keep the money: after 7 days anyone refunds the order, and
/// its serial number goes back to the item when it was the last one handed out.
#[test]
fn an_unsettled_order_refunds_after_seven_days() {
    let mut env = setup();
    let player = env.player.pubkey();
    let had = env.tokens(&ata(&player, &env.mint));
    let (first, second) = (order_1(&env), order_pda(&env.game, &player, 2));
    env.buy(3, 1).unwrap();
    env.buy(3, 2).unwrap();
    assert_eq!(env.item_state(3).issued, 2);

    env.wait_slots(loot::ROLLED_REFUND_SLOTS);
    assert!(err(env.refund(first)).contains("NotStale"));
    env.wait_slots(1);
    // Without its item, or with another one, a rolled order is not refunded.
    let c = env.cranker.insecure_clone();
    let mut ix = env.refund_ix(first);
    ix.accounts.pop();
    assert!(err(env.send(&[ix], &[&c])).contains("ItemMismatch"));
    let mut ix = env.refund_ix(first);
    ix.accounts.last_mut().unwrap().pubkey = item_pda(&env.game, 1);
    assert!(err(env.send(&[ix], &[&c])).contains("ItemMismatch"));

    // Serial 1 is not the last handed out: it stays a gap. Serial 2 is: it is free again.
    env.refund(first).unwrap();
    assert_eq!(env.item_state(3).issued, 2);
    env.refund(second).unwrap();
    assert_eq!(env.item_state(3).issued, 1);
    assert_eq!(env.tokens(&ata(&player, &env.mint)), had);
    assert_eq!(env.tokens(&env.treasury), 0);
}

/// A refund pays the order's player and nobody else, whoever sends it.
#[test]
fn a_refund_cannot_be_redirected() {
    let mut env = setup();
    let c = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.open_box(1, 1).unwrap();
    env.wait_slots(loot::STALE_SLOTS + 1);

    let thief = c.pubkey();
    let thief_token = env.token_account(thief, env.mint);
    let mut ix = env.refund_ix(order);
    ix.accounts[2].pubkey = thief; // the player
    assert!(err(env.send(&[ix], &[&c])).contains("ConstraintHasOne"));
    let mut ix = env.refund_ix(order);
    let at = ix.accounts.iter().position(|m| m.pubkey == ata(&env.player.pubkey(), &env.mint)).unwrap();
    ix.accounts[at].pubkey = thief_token;
    assert!(err(env.send(&[ix], &[&c])).contains("ConstraintAddress"));
}

// ================================================================ what a purchase fixes

#[test]
fn a_purchase_never_costs_more_than_the_player_signed() {
    let mut env = setup();
    let p = env.player.insecure_clone();
    // The player signs for the price they were shown; the owner's raise lands first.
    let buy = env.buy_ix(3, 1);
    let open = env.open_box_ix(1, 2);
    env.upsert_item(3, ItemArgs { soulbound: true, ..item(ItemKind::Collectible, "Founder Badge", 0, PRICE) }).unwrap();
    env.upsert_box(1, 2 * PRICE, vec![], box_entries()).unwrap();
    assert!(err(env.send(&[buy], &[&p])).contains("PriceAboveMax"));
    assert!(err(env.send(&[open], &[&p])).contains("PriceAboveMax"));
    // A cut is fine: the player pays the lower price.
    let buy = env.buy_ix_max(3, 1, 5 * PRICE);
    env.send(&[buy], &[&p]).unwrap();
    assert_eq!(env.acc::<Order>(&order_1(&env)).paid, PRICE);
}

/// The split and the fee are fixed when the player pays. Later edits do not touch the order.
#[test]
fn an_order_keeps_the_split_and_the_fee_it_was_paid_under() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let keeper = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.open_pool(&owner, PRIZE, env.mint).unwrap();
    env.buy(3, 1).unwrap(); // under: burn 20%, fee 0.001 SOL

    let edited = ItemArgs { soulbound: true, shares: vec![pool(PRIZE, 10_000)], ..item(ItemKind::Collectible, "Founder Badge", 0, PRICE / 2) };
    env.upsert_item(3, edited).unwrap();
    env.set_fee(0).unwrap();
    env.settle(order, &keeper).unwrap();
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZE)), 0);
    assert_eq!(env.tokens(&env.treasury), PRICE / 2 * 8 / 10);
    assert_eq!(env.fees(), FEE);
}

/// A box is its odds. An order paid for one version of a box is never rolled on another: it
/// fails, and the player is refunded at once.
#[test]
fn an_order_is_not_rolled_on_a_box_that_was_edited_after_it_was_paid() {
    let mut env = setup();
    let player = env.player.pubkey();
    let had = env.tokens(&ata(&player, &env.mint));
    let order = order_1(&env);
    env.open_box(1, 1).unwrap();
    env.upsert_box(1, PRICE, vec![], vec![item_drop(2, 1), item_drop(1, 1_000)]).unwrap();
    env.upsert_box(1, PRICE, vec![burn(2_000)], box_entries()).unwrap(); // even edited back

    env.callback(order, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&order).status, OrderStatus::Failed);
    assert_eq!(env.item_state(1).issued, 0, "no serial was handed out");
    env.refund(order).unwrap();
    assert_eq!(env.tokens(&ata(&player, &env.mint)), had);
}

#[test]
fn the_switches_stop_money_in_and_never_what_is_owed() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let admin = env.admin.insecure_clone();
    let keeper = env.cranker.insecure_clone();
    let stranger = funded(&mut env);
    let (rolled, pending) = (order_1(&env), order_pda(&env.game, &env.player.pubkey(), 2));
    env.open_box(1, 1).unwrap();
    env.open_box(1, 2).unwrap();

    assert!(err(env.set_suspended(&stranger, true)).contains("NotPlatform"));
    assert!(err(env.set_suspended(&owner, true)).contains("NotPlatform"));
    env.set_suspended(&admin, true).unwrap();
    assert!(err(env.open_box(1, 3)).contains("Suspended"));
    assert!(err(env.buy(3, 3)).contains("Suspended"));
    assert!(err(env.pay(PRICE, vec![])).contains("Suspended"));

    // The owner cannot lift the platform's switch, and has their own.
    env.update_game(&owner, GameUpdate { paused: Some(true), ..update() }).unwrap();
    env.set_suspended(&admin, false).unwrap();
    assert!(err(env.open_box(1, 3)).contains("Paused"));
    assert!(err(env.buy(3, 3)).contains("Paused"));
    env.set_suspended(&admin, true).unwrap();

    // Both switches on: the roll, the settle and the refund of paid orders all go through.
    env.callback(rolled, rnd(0)).unwrap();
    env.settle(rolled, &keeper).unwrap();
    env.wait_slots(loot::STALE_SLOTS + 1);
    env.refund(pending).unwrap();
}

// ================================================================ settle cannot be bent

#[test]
fn lamports_parked_at_the_asset_address_do_not_block_settle() {
    let mut env = setup();
    let keeper = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.buy(3, 1).unwrap();
    let asset = env.asset_pda(&order);
    // Core's create refuses an address that holds SOL, and anyone can send some there.
    env.svm.airdrop(&asset, 12_345).unwrap();
    let sol = env.lamports(&env.player.pubkey());
    env.settle(order, &keeper).unwrap();
    assert_eq!(asset_of(&env, &asset).base.owner, env.player.pubkey());
    // Whoever parked them paid the player.
    let back = env.lamports(&env.player.pubkey()) - sol;
    assert_eq!(back, 12_345 + env.rent(Order::SPACE) + loot::ESCROW_LAMPORTS - env.lamports(&asset));
}

#[test]
fn settle_pays_only_where_the_game_and_the_order_say() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let keeper = env.cranker.insecure_clone();
    let order = order_1(&env);
    env.open_pool(&owner, PRIZE, env.mint).unwrap();
    env.open_pool(&owner, 1, env.mint).unwrap();
    env.upsert_item(3, ItemArgs { shares: vec![pool(PRIZE, 5_000)], ..item(ItemKind::Collectible, "Founder Badge", 0, PRICE) }).unwrap();
    env.buy(3, 1).unwrap();
    let thief = keeper.pubkey();
    let thief_token = env.token_account(thief, env.mint);

    let swaps = [
        (env.treasury, thief_token, "ConstraintAddress"),
        (env.player.pubkey(), thief, "ConstraintHasOne"),
        (ata(&env.game, &env.mint), thief_token, "ConstraintAddress"),
        (pool_pda(&env.game, PRIZE), thief_token, "WrongPool"),
        (pool_pda(&env.game, PRIZE), pool_pda(&env.game, 1), "WrongPool"),
        (env.collection, Keypair::new().pubkey(), "ConstraintAddress"),
    ];
    for (right, wrong, why) in swaps {
        let mut ix = env.settle_ix(order, keeper.pubkey());
        let at = ix.accounts.iter().position(|m| m.pubkey == right).unwrap();
        ix.accounts[at].pubkey = wrong;
        assert!(err(env.send(&[ix], &[&keeper])).contains(why), "{why}");
    }
    // The pool account left out altogether.
    let mut ix = env.settle_ix(order, keeper.pubkey());
    ix.accounts.pop();
    assert!(err(env.send(&[ix], &[&keeper])).contains("WrongPool"));

    env.settle(order, &keeper).unwrap();
    assert_eq!(env.tokens(&thief_token), 0);
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZE)), PRICE / 2);
    assert_eq!(env.tokens(&env.treasury), PRICE / 2);
}

// ================================================================ the owner's settings

#[test]
fn only_the_owner_edits_the_catalog() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let admin = funded(&mut env);
    let crown = || item(ItemKind::Collectible, "Gecko Crown", 2, 0);

    assert!(err(env.upsert_item_as(&admin, 1, crown())).contains("NotOwner"));
    assert!(err(env.upsert_item_as(&authority, 1, crown())).contains("NotOwner"), "the authority pays out; it does not edit");
    env.upsert_item_as(&owner, 1, crown()).unwrap();

    // What an entry may hold.
    assert!(err(env.upsert_item(1, ItemArgs { name: "n".repeat(33), ..crown() })).contains("StringTooLong"));
    assert!(err(env.upsert_item(1, ItemArgs { uri: "u".repeat(201), ..crown() })).contains("StringTooLong"));
    assert!(err(env.upsert_item(1, ItemArgs { shares: vec![burn(10_001)], ..crown() })).contains("BadShares"));
    assert!(err(env.upsert_box(1, PRICE, vec![burn(1); 5], box_entries())).contains("BadShares"));
    assert!(err(env.upsert_box(1, PRICE, vec![], vec![])).contains("BadEntries"));
    assert!(err(env.upsert_box(1, PRICE, vec![], vec![item_drop(1, 0)])).contains("BadEntries"));
    assert!(err(env.upsert_box(1, PRICE, vec![], vec![item_drop(1, 1); 9])).contains("BadEntries"));

    // Once one is out, what the item is cannot change under its holders.
    env.make(&authority, 1, admin.pubkey()).unwrap();
    assert!(err(env.upsert_item(1, ItemArgs { kind: ItemKind::Normal, ..crown() })).contains("KindLocked"));
    assert!(err(env.upsert_item(1, ItemArgs { soulbound: true, ..crown() })).contains("KindLocked"));
    assert!(err(env.upsert_item(1, ItemArgs { burnable: true, ..crown() })).contains("KindLocked"));
    env.make(&authority, 1, admin.pubkey()).unwrap();
    assert!(err(env.upsert_item(1, ItemArgs { max_supply: 1, ..crown() })).contains("SupplyBelowIssued"));
    // The count survives an edit.
    env.upsert_item(1, ItemArgs { price: 9, max_supply: 0, ..crown() }).unwrap();
    assert_eq!((env.item_state(1).issued, env.item_state(1).price), (2, 9));
}

/// Catalog accounts are exactly as big as what they hold, and an edit settles the rent.
#[test]
fn an_edit_resizes_the_account_and_settles_the_rent() {
    let mut env = setup();
    let owner = env.creator.pubkey();
    let (item_key, box_key) = (item_pda(&env.game, 1), box_pda(&env.game, 1));
    let short = item(ItemKind::Collectible, "A", 0, 0);
    let long = ItemArgs { name: "N".repeat(32), uri: "u".repeat(200), shares: vec![pool(0, 1); 4], ..short.clone() };

    for args in [long.clone(), short.clone(), long, short] {
        let before = env.lamports(&owner) + env.lamports(&item_key);
        env.upsert_item(1, args).unwrap();
        let len = env.data(&item_key).len();
        assert_eq!(env.lamports(&item_key), env.rent(len), "exactly rent-exempt at {len} bytes");
        assert_eq!(before - env.lamports(&owner) - env.lamports(&item_key), 5_000, "only the network fee is gone");
        // 59 fixed bytes, a byte each for no rise, no fall and no life, then the shares, the name
        // and the URI, each behind a 4-byte length.
        let it = env.item_state(1);
        let shares: usize = it.shares.iter().map(|s| if s.to == loot::state::To::Burn { 3 } else { 4 }).sum();
        assert_eq!(len, 59 + 3 + 4 + shares + 4 + it.name.len() + 4 + it.uri.len());
    }
    for n in [8usize, 1, 5] {
        env.upsert_box(1, PRICE, vec![], vec![item_drop(1, 1); n]).unwrap();
        assert_eq!(env.data(&box_key).len(), 59 + 4 + 4 + 4 + 9 * n, "a byte each for no currency, no rise, no fall and no stock odds");
        assert_eq!(env.lamports(&box_key), env.rent(env.data(&box_key).len()));
    }
}

#[test]
fn only_the_owner_changes_the_game_and_can_hand_it_on() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let next = funded(&mut env);
    assert_eq!(env.data(&env.game).len(), 173);

    assert!(err(env.update_game(&authority, update())).contains("NotOwner"));
    assert!(err(env.update_game(&next, GameUpdate { owner: Some(next.pubkey()), ..update() })).contains("NotOwner"));

    env.update_game(&owner, GameUpdate { owner: Some(next.pubkey()), ..update() }).unwrap();
    assert!(err(env.update_game(&owner, update())).contains("NotOwner"));
    env.update_game(&next, GameUpdate { paused: Some(true), ..update() }).unwrap();
    let g = env.game_state();
    assert_eq!((g.owner, g.authority, g.paused), (next.pubkey(), authority.pubkey(), true));
}

#[test]
fn a_game_needs_a_collection_its_creator_controls() {
    let mut env = world();
    env.init_platform(FEE).unwrap();
    // Someone who does not control the collection cannot open its game.
    let stranger = funded(&mut env);
    let real = std::mem::replace(&mut env.creator, stranger);
    assert!(err(env.create_game()).contains("BadCollection"));
    env.creator = real;
    // Nor can a game be opened for something that is not a Core collection.
    let (collection, game) = (env.collection, env.game);
    env.collection = env.mint;
    env.game = pda(&[loot::GAME_SEED, env.mint.as_ref()]);
    assert!(err(env.create_game()).contains("BadCollection"));
    (env.collection, env.game) = (collection, game);

    env.create_game().unwrap();
    let g = env.game_state();
    assert_eq!((g.owner, g.authority), (env.creator.pubkey(), env.authority.pubkey()));
    assert!(env.create_game().is_err(), "one game per collection");
}
