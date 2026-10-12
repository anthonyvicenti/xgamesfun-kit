//! The three verbs in LiteSVM, against the real program binary: money in (`pay`, `deposit`),
//! money out (`payout`), and make (`issue`, `make`, `unmake`, `set`); the pools they move
//! between; and the platform's flat fee.
mod common;

use {
    common::*,
    loot::{
        state::ItemKind,
        GameUpdate, ItemArgs,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const PRIZE: u8 = 0;
const STAKERS: u8 = 1;

fn funded(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    k
}

/// The failure's text. Panics if the transaction went through.
fn err(r: Result<Vec<String>, String>) -> String {
    r.expect_err("expected the transaction to fail")
}

fn has_receipt(logs: &[String]) -> bool {
    logs.iter().any(|l| l.starts_with("Program data: "))
}

/// A game with a prize pool and a stakers' pool in its own mint.
fn game_with_pools() -> Env {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.open_pool(&owner, PRIZE, env.mint).unwrap();
    env.open_pool(&owner, STAKERS, env.mint).unwrap();
    env
}

// ================================================================ the worked example

/// The design's level game: pay to try, the entry feeds a prize pool, the final level pays it.
#[test]
fn pay_to_enter_then_the_authority_pays_the_prize() {
    let mut env = game_with_pools();
    let player = env.player.pubkey();
    let player_token = ata(&player, &env.mint);
    let (prize, stakers) = (pool_pda(&env.game, PRIZE), pool_pda(&env.game, STAKERS));
    let had = env.tokens(&player_token);
    let supply = env.supply(&env.mint);
    let sol = env.lamports(&player);

    // An attempt costs 5 coins: 70% to the prize, 10% to stakers, 5% burned, the rest (15%) to
    // the owner's treasury.
    let entry = 5 * PRICE;
    let logs = env.pay(entry, vec![pool(PRIZE, 7_000), pool(STAKERS, 1_000), burn(500)]).unwrap();
    assert!(has_receipt(&logs));
    assert_eq!(env.tokens(&player_token), had - entry);
    assert_eq!(env.tokens(&prize), entry * 70 / 100);
    assert_eq!(env.tokens(&stakers), entry * 10 / 100);
    assert_eq!(env.supply(&env.mint), supply - entry * 5 / 100);
    assert_eq!(env.tokens(&env.treasury), entry * 15 / 100);
    // The platform took its flat fee in SOL, and nothing of the payment.
    assert_eq!(env.fees(), FEE);
    assert_eq!(env.lamports(&player), sol - FEE - 5_000);

    // The player clears the final level; the game's authority pays the whole prize.
    let authority = env.authority.insecure_clone();
    let logs = env.payout(&authority, PRIZE, player_token, entry * 70 / 100).unwrap();
    assert!(has_receipt(&logs));
    assert_eq!(env.tokens(&prize), 0);
    assert_eq!(env.tokens(&player_token), had - entry + entry * 70 / 100);
    assert_eq!(env.fees(), 2 * FEE);
}

// ================================================================ pay

#[test]
fn a_split_with_nothing_named_all_goes_to_the_treasury() {
    let mut env = setup();
    env.pay(PRICE, vec![]).unwrap();
    assert_eq!(env.tokens(&env.treasury), PRICE);
}

#[test]
fn shares_round_down_and_the_treasury_gets_every_unit_left() {
    let mut env = game_with_pools();
    let supply = env.supply(&env.mint);
    // 7 units at 33.33% each: two shares of 2, and 3 left over.
    env.pay(7, vec![pool(PRIZE, 3_333), burn(3_333)]).unwrap();
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZE)), 2);
    assert_eq!(supply - env.supply(&env.mint), 2);
    assert_eq!(env.tokens(&env.treasury), 3);
}

#[test]
fn pay_refuses_what_it_should() {
    let mut env = game_with_pools();
    let p = env.player.insecure_clone();
    let owner = env.creator.insecure_clone();

    assert!(err(env.pay(0, vec![])).contains("ZeroAmount"));
    assert!(err(env.pay(PRICE, vec![burn(6_000), pool(PRIZE, 4_001)])).contains("BadShares"));
    assert!(err(env.pay(PRICE, vec![burn(1); 5])).contains("BadShares"));

    // A share that names a pool must come with that pool's own account.
    let mut ix = env.pay_ix(p.pubkey(), env.mint, PRICE, vec![pool(PRIZE, 5_000)]);
    ix.accounts.pop();
    assert!(err(env.send(&[ix], &[&p])).contains("WrongPool"));
    for wrong in [pool_pda(&env.game, STAKERS), ata(&env.game, &env.mint), env.treasury, ata(&p.pubkey(), &env.mint)] {
        let mut ix = env.pay_ix(p.pubkey(), env.mint, PRICE, vec![pool(PRIZE, 5_000)]);
        ix.accounts.last_mut().unwrap().pubkey = wrong;
        assert!(err(env.send(&[ix], &[&p])).contains("WrongPool"));
    }
    // A pool that was never opened.
    assert!(env.pay(PRICE, vec![pool(9, 5_000)]).is_err());

    // The treasury is the game's, by address, and the receipt names the mint that moved.
    let mut ix = env.pay_ix(p.pubkey(), env.mint, PRICE, vec![]);
    ix.accounts[4].pubkey = ata(&p.pubkey(), &env.mint);
    assert!(err(env.send(&[ix], &[&p])).contains("ConstraintAddress"));
    let mut ix = env.pay_ix(p.pubkey(), env.mint, PRICE, vec![]);
    ix.accounts[2].pubkey = env.collection;
    assert!(err(env.send(&[ix], &[&p])).contains("ConstraintTokenMint"));

    // The owner's switch.
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(true) }).unwrap();
    assert!(err(env.pay(PRICE, vec![])).contains("Paused"));

    // Nothing above moved a coin or paid a fee.
    assert_eq!(env.tokens(&env.treasury), 0);
    assert_eq!(env.fees(), 0);
}

/// An entry fee in another currency than the shop's, all of it into a pool of that currency.
#[test]
fn pay_in_another_mint_when_the_shares_take_all_of_it() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let p = env.player.insecure_clone();
    let usdc = env.new_mint(owner.pubkey());
    env.fund(p.pubkey(), usdc, 100 * PRICE);
    env.open_pool(&owner, 7, usdc).unwrap();

    let ix = env.pay_ix(p.pubkey(), usdc, 10 * PRICE, vec![pool(7, 10_000)]);
    env.send(&[ix], &[&p]).unwrap();
    assert_eq!(env.tokens(&pool_pda(&env.game, 7)), 10 * PRICE);

    // Shares that take all of it leave nothing to rounding either.
    env.open_pool(&owner, 8, usdc).unwrap();
    let ix = env.pay_ix(p.pubkey(), usdc, 7, vec![pool(7, 5_000), pool(8, 5_000)]);
    env.send(&[ix], &[&p]).unwrap();
    assert_eq!(env.tokens(&pool_pda(&env.game, 8)), 4);

    // Anything left over would have to go to the treasury, which holds the game's own mint.
    let ix = env.pay_ix(p.pubkey(), usdc, 10 * PRICE, vec![pool(7, 9_000)]);
    assert!(env.send(&[ix], &[&p]).is_err());
    // And a pool only takes its own mint.
    assert!(env.pay(PRICE, vec![pool(7, 5_000)]).is_err());
}

// ================================================================ pools and deposit

#[test]
fn only_the_owner_opens_and_closes_pools() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let stranger = funded(&mut env);
    let key = pool_pda(&env.game, PRIZE);

    assert!(err(env.open_pool(&stranger, PRIZE, env.mint)).contains("NotOwner"));
    assert!(err(env.open_pool(&authority, PRIZE, env.mint)).contains("NotOwner"));

    // Lamports someone parked at the address do not block the owner.
    env.svm.airdrop(&key, 1_000).unwrap();
    let before = env.lamports(&owner.pubkey());
    env.open_pool(&owner, PRIZE, env.mint).unwrap();
    assert_eq!(env.data(&key).len(), 165);
    assert_eq!(env.lamports(&key), env.rent(165));
    assert_eq!(before - env.lamports(&owner.pubkey()), env.rent(165) - 1_000 + 5_000);
    // The pool is the game's: its token authority is the game's own address.
    assert_eq!(env.data(&key)[32..64], env.game.to_bytes());
    assert!(env.open_pool(&owner, PRIZE, env.mint).is_err(), "a pool opens once");

    // A pool that holds something cannot be closed. An empty one returns its rent.
    env.deposit(&owner, PRIZE, env.mint, 0).unwrap_err();
    let from = env.fund(owner.pubkey(), env.mint, 50);
    assert_eq!(env.tokens(&from), 50);
    env.deposit(&owner, PRIZE, env.mint, 50).unwrap();
    assert!(err(env.close_pool(&owner, PRIZE)).contains("PoolNotEmpty"));
    env.payout(&authority, PRIZE, from, 50).unwrap();
    assert!(err(env.close_pool(&stranger, PRIZE)).contains("NotOwner"));
    let before = env.lamports(&owner.pubkey());
    env.close_pool(&owner, PRIZE).unwrap();
    assert!(!env.exists(&key));
    assert_eq!(env.lamports(&owner.pubkey()) - before, env.rent(165) - 5_000);
}

#[test]
fn anyone_deposits_and_a_suspended_game_still_takes_it() {
    let mut env = game_with_pools();
    let admin = env.admin.insecure_clone();
    let sponsor = funded(&mut env);
    env.fund(sponsor.pubkey(), env.mint, 40 * PRICE);

    env.set_suspended(&admin, true).unwrap();
    let logs = env.deposit(&sponsor, PRIZE, env.mint, 40 * PRICE).unwrap();
    assert!(has_receipt(&logs));
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZE)), 40 * PRICE);
    assert_eq!(env.fees(), FEE);
}

// ================================================================ payout

#[test]
fn only_the_authority_pays_out_and_nothing_bounds_it() {
    let mut env = game_with_pools();
    let owner = env.creator.insecure_clone();
    let authority = env.authority.insecure_clone();
    let admin = env.admin.insecure_clone();
    let player = env.player.insecure_clone();
    let winner = env.token_account(Keypair::new().pubkey(), env.mint);
    env.pay(10 * PRICE, vec![pool(PRIZE, 10_000)]).unwrap();

    // Not the owner, not the player, not the platform, not a stranger.
    for who in [&owner, &player, &admin, &funded(&mut env)] {
        assert!(err(env.payout(who, PRIZE, winner, 1)).contains("NotAuthority"));
    }
    assert!(err(env.payout(&authority, PRIZE, winner, 0)).contains("ZeroAmount"));
    // More than the pool holds: the token program refuses.
    assert!(env.payout(&authority, PRIZE, winner, 10 * PRICE + 1).is_err());

    // Paused by the owner and suspended by the platform: what is owed still goes out.
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(true) }).unwrap();
    env.set_suspended(&admin, true).unwrap();
    env.payout(&authority, PRIZE, winner, 3 * PRICE).unwrap();
    // No cap: the rest in one go.
    env.payout(&authority, PRIZE, winner, 7 * PRICE).unwrap();
    assert_eq!(env.tokens(&winner), 10 * PRICE);
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZE)), 0);
}

/// A payout can only come from a pool. The vault, where the payments of open orders wait, is
/// the game's too, and the authority cannot reach it.
#[test]
fn the_authority_cannot_reach_the_order_vault() {
    let mut env = game_with_pools();
    let authority = env.authority.insecure_clone();
    env.buy(3, 1).unwrap();
    let vault = ata(&env.game, &env.mint);
    assert_eq!(env.tokens(&vault), PRICE / 2);

    let to = ata(&env.player.pubkey(), &env.mint);
    let mut ix = env.payout_ix(authority.pubkey(), PRIZE, to, 1);
    let at = ix.accounts.iter().position(|m| m.pubkey == pool_pda(&env.game, PRIZE)).unwrap();
    ix.accounts[at].pubkey = vault;
    assert!(err(env.send(&[ix], &[&authority])).contains("ConstraintSeeds"));
    assert_eq!(env.tokens(&vault), PRICE / 2);
}

#[test]
fn the_owner_rotates_the_authority() {
    let mut env = game_with_pools();
    let owner = env.creator.insecure_clone();
    let old = env.authority.insecure_clone();
    let new = funded(&mut env);
    let to = ata(&env.player.pubkey(), &env.mint);
    env.pay(PRICE, vec![pool(PRIZE, 10_000)]).unwrap();

    // Only the owner changes it: the authority cannot hand itself on.
    let update = |key| GameUpdate { owner: None, authority: Some(key), paused: None };
    assert!(err(env.update_game(&old, update(new.pubkey()))).contains("NotOwner"));
    env.update_game(&owner, update(new.pubkey())).unwrap();

    assert!(err(env.payout(&old, PRIZE, to, 1)).contains("NotAuthority"));
    env.payout(&new, PRIZE, to, 1).unwrap();
}

// ================================================================ issue

#[test]
fn the_authority_issues_a_token_the_game_controls() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let owner = env.creator.insecure_clone();
    let player_wallet = env.player.pubkey();

    // A soft currency whose mint authority is the game's address.
    let points = env.new_mint(env.game);
    let to = env.token_account(player_wallet, points);
    let logs = env.issue(&authority, points, to, 250).unwrap();
    assert!(has_receipt(&logs));
    assert_eq!((env.tokens(&to), env.supply(&points)), (250, 250));
    assert_eq!(env.fees(), FEE);

    assert!(err(env.issue(&owner, points, to, 1)).contains("NotAuthority"));
    assert!(err(env.issue(&authority, points, to, 0)).contains("ZeroAmount"));
    // The shop's mint belongs to its creator, not to the game: the token program refuses.
    let player_token = ata(&player_wallet, &env.mint);
    assert!(env.issue(&authority, env.mint, player_token, 1).is_err());
}

// ================================================================ make, unmake, set

fn asset_of(env: &Env, key: &anchor_lang::prelude::Pubkey) -> mpl_core::Asset {
    *mpl_core::Asset::from_bytes(&env.data(key)).unwrap()
}

fn attributes(env: &Env, key: &anchor_lang::prelude::Pubkey) -> Vec<(String, String)> {
    let list = asset_of(env, key).plugin_list.attributes.unwrap().attributes.attribute_list;
    list.into_iter().map(|a| (a.key, a.value)).collect()
}

#[test]
fn the_authority_makes_a_collectible_without_a_sale() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let owner = env.creator.insecure_clone();
    let winner = Keypair::new().pubkey();

    // Item 1 has a supply of 2.
    let fees_before = env.fees();
    let asset = env.make(&authority, 1, winner).unwrap();
    let a = asset_of(&env, &asset);
    assert_eq!((a.base.owner, a.base.name.as_str()), (winner, "Gecko Crown #1"));
    assert_eq!(a.base.update_authority, mpl_core::types::UpdateAuthority::Collection(env.collection));
    assert!(a.plugin_list.permanent_burn_delegate.is_none(), "not a burnable item");
    assert_eq!(env.item_state(1).issued, 1);
    assert_eq!(env.fees() - fees_before, FEE);

    assert!(err(env.make(&owner, 1, winner).map(|_| vec![])).contains("NotAuthority"));
    // A normal item lives in the game's backend: there is nothing to mint.
    assert!(err(env.make(&authority, 2, winner).map(|_| vec![])).contains("NotCollectible"));
    // The item's own supply holds, and sales share it.
    assert!(err(env.buy(1, 1)).contains("NotForSale"), "item 1 has no shop price");
    env.make(&authority, 1, winner).unwrap();
    assert!(err(env.make(&authority, 1, winner).map(|_| vec![])).contains("SoldOut"));
    // The owner raises it, and the authority makes again.
    env.upsert_item(1, item(ItemKind::Collectible, "Gecko Crown", 3, 0)).unwrap();
    let third = env.make(&authority, 1, winner).unwrap();
    assert_eq!(asset_of(&env, &third).base.name, "Gecko Crown #3");
}

#[test]
fn the_authority_sets_attributes_and_burns_what_is_burnable() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let owner = env.creator.insecure_clone();
    let holder = Keypair::new().pubkey();
    env.upsert_item(8, ItemArgs { burnable: true, ..item(ItemKind::Collectible, "Arena Ticket", 0, 0) }).unwrap();

    let ticket = env.make(&authority, 8, holder).unwrap();
    let crown = env.make(&authority, 1, holder).unwrap();
    let burner = asset_of(&env, &ticket).plugin_list.permanent_burn_delegate.unwrap();
    assert_eq!(burner.base.authority, mpl_core::types::PluginAuthority::Address { address: env.game }.into());

    // set: a level gained. The whole list is replaced, except the program's own numbers.
    assert_eq!(attributes(&env, &crown).len(), 4, "item id, rarity, serial, and when it was made");
    let logs = env.set(&authority, crown, &[("item_id", "1"), ("serial", "1"), ("level", "7"), ("repaired", "yes")]).unwrap();
    assert!(has_receipt(&logs));
    let now = attributes(&env, &crown);
    assert_eq!(now.len(), 6, "level and repaired; which item it is (item id, rarity, serial) and `made` stay");
    assert!(now.contains(&("level".into(), "7".into())) && now.iter().any(|(key, _)| key == "made"));
    assert!(err(env.set(&owner, crown, &[])).contains("NotAuthority"));

    // unmake: the ticket is used at the door, whoever holds it. The crown cannot be burned.
    assert!(err(env.unmake(&owner, ticket)).contains("NotAuthority"));
    assert!(env.unmake(&authority, crown).is_err(), "Core refuses: the game is not its burn delegate");
    let logs = env.unmake(&authority, ticket).unwrap();
    assert!(has_receipt(&logs));
    assert!(mpl_core::Asset::from_bytes(&env.data(&ticket)).is_err(), "burned");
    assert!(env.set(&authority, ticket, &[]).is_err());
}

/// The authority of one game has no say over another game's collectibles.
#[test]
fn a_games_authority_cannot_touch_another_collection() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let other_owner = funded(&mut env);
    let collection = Keypair::new();
    let asset = Keypair::new();
    let ixs = [
        mpl_core::instructions::CreateCollectionV2Builder::new()
            .collection(collection.pubkey())
            .payer(other_owner.pubkey())
            .name("Someone Else".into())
            .uri("https://example.invalid/else.json".into())
            .instruction(),
        mpl_core::instructions::CreateV2Builder::new()
            .asset(asset.pubkey())
            .collection(Some(collection.pubkey()))
            .payer(other_owner.pubkey())
            .name("Theirs".into())
            .uri("https://example.invalid/theirs.json".into())
            .instruction(),
    ];
    env.send(&ixs, &[&other_owner, &collection, &asset]).unwrap();

    assert!(env.set(&authority, asset.pubkey(), &[("stolen", "1")]).is_err());
    assert!(env.unmake(&authority, asset.pubkey()).is_err());
}

// ================================================================ the platform's fee

#[test]
fn a_fee_raise_waits_seven_days_and_a_cut_applies_at_once() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let stranger = funded(&mut env);
    let paid = |env: &Env| env.fees();

    assert!(err(env.set_platform(&stranger, 0, stranger.pubkey())).contains("NotPlatform"));
    assert!(err(env.set_fee(loot::MAX_FEE_LAMPORTS + 1)).contains("FeeAboveCap"));

    // A raise is only announced.
    env.set_fee(3 * FEE).unwrap();
    let p = env.platform();
    assert_eq!((p.fees.player, p.pending.player, p.pending_at), (FEE, 3 * FEE, env.now() + loot::NOTICE_SECONDS));
    env.pay(PRICE, vec![]).unwrap();
    assert_eq!(paid(&env), FEE);

    // One second before the notice has run, still the old fee. Then the new one.
    env.wait(loot::NOTICE_SECONDS - 1);
    env.pay(PRICE, vec![]).unwrap();
    assert_eq!(paid(&env), 2 * FEE);
    env.wait(1);
    env.pay(PRICE, vec![]).unwrap();
    assert_eq!(paid(&env), 5 * FEE);

    // A cut applies now, and drops a raise that was waiting.
    env.set_fee(loot::MAX_FEE_LAMPORTS).unwrap();
    env.set_fee(FEE).unwrap();
    let p = env.platform();
    assert_eq!((p.fees.player, p.pending_at), (FEE, 0));
    env.wait(2 * loot::NOTICE_SECONDS);
    env.pay(PRICE, vec![]).unwrap();
    assert_eq!(paid(&env), 6 * FEE);

    // Free is allowed.
    env.set_fee(0).unwrap();
    env.pay(PRICE, vec![]).unwrap();
    assert_eq!(paid(&env), 6 * FEE);

    // Only the admin takes the fees out, all of them, and the record keeps its rent.
    let bank = Keypair::new().pubkey();
    assert!(err(env.collect_fees(&stranger, stranger.pubkey())).contains("NotPlatform"));
    env.collect_fees(&admin, bank).unwrap();
    assert_eq!((env.lamports(&bank), paid(&env)), (6 * FEE, 0));
    // The admin hands the platform on.
    env.set_platform(&admin, 0, stranger.pubkey()).unwrap();
    assert!(err(env.collect_fees(&admin, bank)).contains("NotPlatform"));
}

#[test]
fn only_the_upgrade_authority_creates_the_platform() {
    let mut env = world();
    let stranger = funded(&mut env);
    assert!(err(env.init_platform_as(&stranger, program_data(), FEE)).contains("NotPlatform"));
    // Another program's ProgramData, where the stranger is the upgrade authority, is not ours.
    let theirs = Keypair::new().pubkey();
    let mut data = env.data(&program_data());
    data[13..45].copy_from_slice(stranger.pubkey().as_ref());
    env.put(theirs, anchor_lang::solana_program::bpf_loader_upgradeable::ID, data);
    assert!(err(env.init_platform_as(&stranger, theirs, FEE)).contains("ConstraintSeeds"));

    assert!(err(env.init_platform(loot::MAX_FEE_LAMPORTS + 1)).contains("FeeAboveCap"));
    env.init_platform(FEE).unwrap();
    assert!(env.init_platform(FEE).is_err(), "once");
    assert_eq!(env.data(&platform_pda()).len(), loot::state::Platform::SPACE);
}

/// A split is the player's to sign, so a careless or hostile one must not reach anywhere but
/// this game.
#[test]
fn a_pool_of_another_game_is_not_a_pool_of_this_one() {
    let mut env = game_with_pools();
    let p = env.player.insecure_clone();
    // A second game, with its own pool 0.
    let other_owner = funded(&mut env);
    let collection = Keypair::new();
    let other_game = pda(&[loot::GAME_SEED, collection.pubkey().as_ref()]);
    let ix = mpl_core::instructions::CreateCollectionV2Builder::new()
        .collection(collection.pubkey())
        .update_authority(Some(other_owner.pubkey()))
        .payer(other_owner.pubkey())
        .name("Other".into())
        .uri("https://example.invalid/other.json".into())
        .instruction();
    env.send(&[ix], &[&other_owner, &collection]).unwrap();
    let treasury = env.token_account(other_owner.pubkey(), env.mint);
    let (mine, mine_collection) = (env.game, env.collection);
    (env.game, env.collection, env.treasury) = (other_game, collection.pubkey(), treasury);
    let saved = std::mem::replace(&mut env.creator, other_owner.insecure_clone());
    env.create_game().unwrap();
    env.open_pool(&other_owner, PRIZE, env.mint).unwrap();
    env.creator = saved;
    (env.game, env.collection) = (mine, mine_collection);
    env.treasury = ata(&env.creator.pubkey(), &env.mint);

    let mut ix = env.pay_ix(p.pubkey(), env.mint, PRICE, vec![pool(PRIZE, 5_000)]);
    ix.accounts.last_mut().unwrap().pubkey = pool_pda(&other_game, PRIZE);
    assert!(err(env.send(&[ix], &[&p])).contains("WrongPool"));
}

// ================================================================ burn

#[test]
fn the_authority_burns_from_a_pool() {
    let mut env = game_with_pools();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    env.pay(10 * PRICE, vec![pool(PRIZE, 10_000)]).unwrap();
    let supply = env.supply(&env.mint);
    let fees = env.fees();

    assert!(err(env.burn_from_pool(&owner, PRIZE, env.mint, 1)).contains("NotAuthority"));
    assert!(err(env.burn_from_pool(&authority, PRIZE, env.mint, 0)).contains("ZeroAmount"));
    assert!(env.burn_from_pool(&authority, PRIZE, env.mint, 10 * PRICE + 1).is_err(), "more than the pool holds");

    let logs = env.burn_from_pool(&authority, PRIZE, env.mint, 4 * PRICE).unwrap();
    let burned: loot::receipts::Burned = receipt(&logs);
    assert_eq!((burned.pool, burned.mint, burned.amount, burned.reference), (PRIZE, env.mint, 4 * PRICE, REF));
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZE)), 6 * PRICE);
    assert_eq!(supply - env.supply(&env.mint), 4 * PRICE);
    assert_eq!(env.fees() - fees, FEE);
}

// ================================================================ roll

#[test]
fn the_authority_rolls_a_number_for_any_rule() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let draw = [42u8; 32]; // the game's label: this week's lottery draw

    // The real oracle program takes the request, from the authority only.
    assert!(err(env.roll(&owner, draw)).contains("NotAuthority"));
    env.roll(&authority, draw).unwrap();
    assert_eq!(env.fees(), FEE);

    // Only the oracle answers.
    let ix = env.random_ix(c.pubkey(), draw, rnd(7));
    assert!(env.send_unsigned(&[ix], &c).is_err());
    // Its answer is a receipt with the label and the number, and nothing else changes.
    let logs = env.random(draw, rnd(7)).unwrap();
    let rolled: loot::receipts::Rolled = receipt(&logs);
    assert_eq!((rolled.game, rolled.reference, rolled.randomness), (env.game, draw, rnd(7)));
}

// ================================================================ a random sink

/// The creator's example: a player pays in the game's token, and a roll decides what becomes
/// of it. 40% it is burned, 20% it becomes an NFT, 30% it pays out in USD, 10% in SOL.
/// The odds are the box's own bytes, and the program carries out every outcome: a keeper who
/// holds no key of the game sends the settles, and the authority signs nothing.
#[test]
fn a_box_whose_roll_burns_mints_or_pays_in_another_currency() {
    use loot::state::{DropEntry, Order, Outcome};
    const USD: u8 = 1;
    const SOL: u8 = 2;
    let mut env = setup();
    let (owner, keeper) = (env.creator.insecure_clone(), env.cranker.insecure_clone());
    let player = env.player.pubkey();
    let (usd, sol) = (env.new_mint(owner.pubkey()), env.new_mint(owner.pubkey())); // stand-ins
    env.open_pool(&owner, USD, usd).unwrap();
    env.open_pool(&owner, SOL, sol).unwrap();
    env.fund(owner.pubkey(), usd, 1_000);
    env.fund(owner.pubkey(), sol, 1_000);
    env.deposit(&owner, USD, usd, 1_000).unwrap();
    env.deposit(&owner, SOL, sol, 1_000).unwrap();
    let (player_usd, player_sol) = (env.token_account(player, usd), env.token_account(player, sol));

    env.upsert_item(11, item(ItemKind::Collectible, "Lucky Charm", 0, 0)).unwrap();
    let entries = vec![
        DropEntry { outcome: Outcome::Burn, weight: 40 },
        item_drop(11, 20),
        pay_drop(USD, 30, 30),
        pay_drop(SOL, 5, 10),
    ];
    env.upsert_box(1, PRICE, vec![], entries).unwrap();

    // One purchase per outcome: a roll of 0..40 burns, 40..60 mints, 60..90 pays USD, 90..100 SOL.
    let supply = env.supply(&env.mint);
    for (nonce, roll) in [(1u64, 39u64), (2, 40), (3, 89), (4, 99)] {
        let order = order_pda(&env.game, &player, nonce);
        env.open_box(1, nonce).unwrap();
        env.callback(order, rnd(roll)).unwrap();
        match env.acc::<Order>(&order).outcome {
            Outcome::Item(_) => {
                let asset = env.asset_pda(&order);
                env.settle(order, &keeper).unwrap();
                assert!(env.exists(&asset));
            }
            Outcome::Pay { pool: USD, .. } => drop(env.settle_prize(order, Some(player_usd), &keeper).unwrap()),
            Outcome::Pay { .. } => drop(env.settle_prize(order, Some(player_sol), &keeper).unwrap()),
            _ => drop(env.settle_prize(order, None, &keeper).unwrap()),
        }
        assert!(!env.exists(&order));
    }
    assert_eq!(supply - env.supply(&env.mint), PRICE, "one whole payment was burned");
    assert_eq!(env.tokens(&env.treasury), 3 * PRICE, "the other three went to the treasury");
    assert_eq!((env.tokens(&player_usd), env.tokens(&player_sol)), (30, 5));
    assert_eq!(env.tokens(&ata(&env.game, &env.mint)), 0, "nothing is left in the vault");
}

#[test]
fn a_prize_goes_only_to_the_player_and_only_from_its_pool() {
    use loot::state::{Order, OrderStatus};
    const PRIZES: u8 = 1;
    let mut env = setup();
    let (owner, keeper, p) = (env.creator.insecure_clone(), env.cranker.insecure_clone(), env.player.insecure_clone());
    env.open_pool(&owner, PRIZES, env.mint).unwrap();
    env.open_pool(&owner, 2, env.mint).unwrap();
    env.fund(owner.pubkey(), env.mint, 100);
    env.deposit(&owner, PRIZES, env.mint, 60).unwrap();
    env.deposit(&owner, 2, env.mint, 40).unwrap();
    assert!(err(env.upsert_box(1, PRICE, vec![], vec![pay_drop(PRIZES, 0, 1)])).contains("BadEntries"));
    env.upsert_box(1, PRICE, vec![], vec![pay_drop(PRIZES, 50, 1)]).unwrap();
    let player_token = ata(&p.pubkey(), &env.mint);
    let thief_token = env.token_account(keeper.pubkey(), env.mint);
    let order = order_pda(&env.game, &p.pubkey(), 1);

    // The entry's pool account is checked when the box is opened.
    let mut ix = env.open_box_ix(1, 1);
    ix.accounts.last_mut().unwrap().pubkey = pool_pda(&env.game, 2);
    assert!(err(env.send(&[ix], &[&p])).contains("WrongPool"));
    env.open_box(1, 1).unwrap();
    env.callback(order, rnd(0)).unwrap();

    // Not to someone else, not from another pool, not through the item settle.
    assert!(err(env.settle(order, &keeper)).contains("WrongSettle"));
    assert!(err(env.settle_prize(order, Some(thief_token), &keeper)).contains("NotThePlayers"));
    assert!(err(env.settle_prize(order, None, &keeper)).contains("NotThePlayers"));
    let mut ix = env.settle_prize_ix(order, Some(player_token), keeper.pubkey());
    let at = ix.accounts.iter().position(|m| m.pubkey == pool_pda(&env.game, PRIZES)).unwrap();
    ix.accounts[at].pubkey = pool_pda(&env.game, 2);
    assert!(err(env.send(&[ix], &[&keeper])).contains("WrongPool"));

    let had = env.tokens(&player_token);
    env.settle_prize(order, Some(player_token), &keeper).unwrap();
    assert_eq!(env.tokens(&player_token) - had, 50);
    assert_eq!(env.tokens(&pool_pda(&env.game, PRIZES)), 10);

    // The pool now holds 10, less than the prize: the roll skips it, and with nothing else in
    // the box the order fails and refunds at once.
    let second = order_pda(&env.game, &p.pubkey(), 2);
    assert!(err(env.open_box(1, 3)).contains("SoldOut"));
    env.fund(owner.pubkey(), env.mint, 40);
    env.deposit(&owner, PRIZES, env.mint, 40).unwrap();
    env.open_box(1, 2).unwrap();
    let authority = env.authority.insecure_clone();
    env.payout(&authority, PRIZES, thief_token, 50).unwrap(); // the pool is emptied before the roll
    env.callback(second, rnd(0)).unwrap();
    assert_eq!(env.acc::<Order>(&second).status, OrderStatus::Failed);
    env.refund(second).unwrap();
    assert_eq!(env.tokens(&player_token), had + 50, "the second box cost the player nothing");
}
