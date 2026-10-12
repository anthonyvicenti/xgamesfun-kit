//! Last check of loot 0.3 (2026-10-11): the fixes that came out of the fourth review, and one
//! more pass over the day's additions for plain bugs. LiteSVM against the built binary and the
//! real Metaplex Core program.
//!
//! A project's own keys are trusted (its owner, its authority, whoever controls its
//! collection), so nothing here is about what only they can do.
//! `fixed_*` is a finding of this check turned round after its fix, `noted_*` one that stays
//! (PROGRAM-0.3.md), and `sound_*` an attack or a mistake the program refuses.
mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::Instruction,
        InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    common::*,
    loot::{
        state::{DropEntry, ItemKind, Life, OrderStatus, Outcome, Share, To},
        BoxArgs, ContestArgs, Input, ItemArgs, LotteryArgs, Origin, Output, RecipeArgs, Round, Verdict,
    },
    mpl_core::instructions::*,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 24 * 60 * 60;
/// What the chain takes for one signature.
const TX_FEE: u64 = 5_000;

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

fn recipe(inputs: Vec<Input>, outputs: Vec<Output>) -> RecipeArgs {
    RecipeArgs { active: true, inputs, outputs, needs: vec![], keeps: vec![] }
}

fn collectible(name: &str) -> ItemArgs {
    item(ItemKind::Collectible, name, 0, 0)
}

/// Every attribute written on an asset, in order.
fn written(env: &Env, asset: &Pubkey) -> Vec<(String, String)> {
    let asset = mpl_core::Asset::from_bytes(&env.data(asset)).unwrap();
    let list = asset.plugin_list.attributes.unwrap().attributes.attribute_list;
    list.into_iter().map(|a| (a.key, a.value)).collect()
}

fn value(list: &[(String, String)], key: &str) -> Option<String> {
    list.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

fn keys(list: &[(String, String)]) -> Vec<&str> {
    list.iter().map(|(k, _)| k.as_str()).collect()
}

fn my(env: &Env, who: &Keypair, mint: &Pubkey) -> u64 {
    env.tokens(&ata(&who.pubkey(), mint))
}

/// A wrapped SOL mint and a funded wrapped SOL account for `who`.
fn wrapped_sol(env: &mut Env, who: &Pubkey, amount: u64) -> Pubkey {
    let wsol = spl_token::native_mint::ID;
    if !env.exists(&wsol) {
        let mut mint = vec![0u8; 82];
        mint[44] = 9; // decimals
        mint[45] = 1; // initialized
        env.put(wsol, spl_token::ID, mint);
    }
    let rent = env.rent(165);
    let mut bytes = token_account_bytes(&wsol, who, amount);
    bytes[109..113].copy_from_slice(&1u32.to_le_bytes()); // is_native: some
    bytes[113..121].copy_from_slice(&rent.to_le_bytes());
    env.put_with(ata(who, &wsol), spl_token::ID, rent + amount, bytes);
    wsol
}

// ================================================================ findings

/// MEDIUM, closed. An admin could edit the real item: put one the owner never sold on sale
/// for 1 and feed it to the owner's recipe, or point an item's revenue at the pool their own
/// stake draws from. First an admin was left only how an item looks; then the creator dropped
/// admins altogether (2026-10-11). Only a game's owner writes an item.
#[test]
fn closed_only_the_owner_writes_an_item() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let stranger = player(&mut env, 10);
    let fish = collectible("Fish");
    env.upsert_item(30, fish.clone()).unwrap();
    for who in [&stranger, &authority] {
        assert!(err(env.upsert_item_as(who, 30, ItemArgs { price: 1, ..fish.clone() })).contains("NotOwner"));
        assert!(err(env.upsert_item_as(who, 30, ItemArgs { rarity: 7, ..fish.clone() })).contains("NotOwner"));
        assert!(err(env.upsert_item_as(who, 31, fish.clone())).contains("NotOwner"));
    }
    env.upsert_item_as(&owner, 30, ItemArgs { price: 1, ..fish }).unwrap();
}

/// LOW, noted (PROGRAM-0.3.md). A contest share for whoever holds a collectible must be paid into that holder's own
/// token account, and `decide` fails when the account it was sent with is not the holder's any
/// more. The holder decides when that is: they move the collectible to another wallet of
/// theirs and the result that was on its way fails. A result is refused after `result_by`, so
/// a holder who backed the losing side and keeps this up until then turns the loss into a
/// refund. This test shows one round of it; keeping it up for a whole contest means winning a
/// race with the authority every time, which this test does not show.
#[test]
fn noted_a_holder_who_moves_the_collectible_fails_the_result_that_was_sent() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let gold = env.mint;
    let (a, landlord) = (player(&mut env, 100), player(&mut env, 100));
    env.upsert_item(50, collectible("Arena")).unwrap();
    let arena = env.make(&authority, 50, landlord.pubkey()).unwrap();
    let (closes_at, result_by) = (env.now() + 600, env.now() + 1_200);
    let args = ContestArgs { sides: 2, closes_at, result_by, shares: vec![Share { to: To::Holder(arena), bps: 500 }] };
    env.open_contest(&authority, 1, gold, args).unwrap();
    env.enter(&a, 1, 0, 100).unwrap();
    env.enter(&landlord, 1, 1, 100).unwrap();

    // The authority's result: side 0 won. Built while the landlord holds the arena.
    let mut metas = loot::accounts::Decide {
        authority: authority.pubkey(),
        game: env.game,
        contest: env.contest_pda(1),
        mint: gold,
        pot: env.pot_pda(1),
        token_program: spl_token::ID,
        token_2022_program: loot::tokens::TOKEN_2022_ID,
        fee: env.fee(),
    }
    .to_account_metas(None);
    metas.extend(env.to_metas(To::Holder(arena), &gold));
    let decide = Instruction::new_with_bytes(loot::ID, &loot::instruction::Decide { side: 0, reference: REF }.data(), metas);

    // The landlord moves the arena to a second wallet first.
    let second = Keypair::new().pubkey();
    let moved = TransferV1Builder::new().asset(arena).collection(Some(env.collection)).payer(landlord.pubkey()).authority(Some(landlord.pubkey())).new_owner(second).instruction();
    env.send(&[moved], &[&landlord]).unwrap();
    assert!(err(env.send(&[decide], &[&authority])).contains("NotTheHolders"));
    assert_eq!(env.contest(1).verdict, Verdict::Open);

    // Kept up until the result is overdue, the contest can only be called off.
    env.wait(1_201);
    env.token_account(second, gold);
    assert!(err(env.decide(&authority, 1, 0)).contains("ResultOverdue"));
    env.call_off(&landlord, 1).unwrap();
    env.claim(1, landlord.pubkey(), 1, ata(&landlord.pubkey(), &gold)).unwrap();
    assert_eq!(my(&env, &landlord, &gold), 100, "the side that lost has its money back");
}

/// LOW, fixed. An order is only rolled on the version of the box it paid for, and fails at
/// once on any other. That was true only when the edit left the entries' accounts as they
/// were: the roll read the edited entries against the purchase's accounts before it looked at
/// the version, so an edit that named another item made the oracle's answer itself fail and
/// the player waited out 1,500 slots. Now the version is looked at first.
#[test]
fn fixed_a_box_edit_that_changes_an_entry_fails_the_order_at_once() {
    let mut env = setup();
    let keeper = env.cranker.insecure_clone();

    // An edit of the price alone: the order fails at once, as the document says.
    env.open_box(1, 1).unwrap();
    let order = order_pda(&env.game, &env.player.pubkey(), 1);
    let answer = env.callback_ix_of(1, scoped_identity(), order, rnd(0));
    env.upsert_box(1, PRICE * 2, vec![burn(2_000)], vec![item_drop(1, 1), item_drop(2, 1)]).unwrap();
    env.send_unsigned(&[answer], &keeper).unwrap();
    assert_eq!(env.acc::<loot::state::Order>(&order).status, OrderStatus::Failed);
    env.refund(order).unwrap();

    // An edit that swaps an entry for another item: the oracle's answer is refused.
    env.open_box(1, 2).unwrap();
    let order = order_pda(&env.game, &env.player.pubkey(), 2);
    let answer = env.callback_ix_of(1, scoped_identity(), order, rnd(0));
    env.upsert_box(1, PRICE * 2, vec![burn(2_000)], vec![item_drop(3, 1), item_drop(2, 1)]).unwrap();
    env.send_unsigned(&[answer], &keeper).unwrap();
    assert_eq!(env.acc::<loot::state::Order>(&order).status, OrderStatus::Failed);
    env.refund(order).unwrap();
}

/// LOW, fixed. A lottery that sells its tickets in another token never touches its pot when a
/// ticket is bought, so nothing notices that the pot was never opened. `pay_lottery` failed on
/// the missing account and the round could not end until the owner opened that pool. Now a
/// pot that is not there holds nothing, and the round ends.
#[test]
fn fixed_a_lottery_without_its_pot_still_finishes_the_round() {
    let mut env = setup();
    env.wait(1_700_000_000);
    let owner = env.creator.insecure_clone();
    let gold = env.mint;
    let kills = env.new_mint(owner.pubkey());
    let p = player(&mut env, 0);
    env.fund(p.pubkey(), kills, 10);
    let args = LotteryArgs { price: 1, pot: 9, cut_bps: 0, places: vec![], ticket_mint: kills, every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args.clone()).unwrap();
    env.buy_tickets(&p, 1, 10, kills).unwrap();
    assert_eq!(env.supply(&kills), 0, "ten tickets burned");

    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(3)).unwrap();
    assert_eq!((env.lottery(1).status, env.lottery(1).winner), (Round::Drawn, p.pubkey()));
    assert!(err(env.upsert_lottery(&owner, 1, args)).contains("RoundRunning"));
    env.pay_lottery(1, ata(&p.pubkey(), &gold)).unwrap();
    assert_eq!((env.lottery(1).status, my(&env, &p, &gold)), (Round::Open, 0), "nothing to win, and the next round is open");
}

/// NOTE, fixed. A round nobody bought into moved its date by one period for each
/// `draw_lottery`, so a lottery left alone needed one transaction for every period it missed.
/// Now one call moves it to its next date that is still ahead.
#[test]
fn fixed_an_idle_lottery_comes_back_in_one_call() {
    let mut env = setup();
    env.wait(1_700_000_000);
    let owner = env.creator.insecure_clone();
    let gold = env.mint;
    env.open_pool(&owner, 0, gold).unwrap();
    let p = player(&mut env, 10);
    env.upsert_lottery(&owner, 1, LotteryArgs { price: 1, pot: 0, cut_bps: 0, places: vec![], ticket_mint: Pubkey::default(), every: 60, draws_at: env.now() + 60 }).unwrap();
    env.wait(30 * 60);
    let mut calls = 0;
    while env.buy_tickets(&p, 1, 1, gold).is_err() {
        env.draw_lottery(1).unwrap();
        calls += 1;
    }
    assert_eq!(calls, 1, "thirty minutes idle on a one-minute lottery: one transaction");
}

// ================================================================ the fourth review's fixes

/// Fix 5, and what it has to hold against. A collectible is one of an item only when the item
/// number written on it says so, and nothing a player or an admin can reach writes that
/// number: an admin's item with the same name carries its own number; an asset of the game's
/// collection with the right name and no attribute list is refused, and so is one whose list
/// has no item number.
#[test]
fn sound_a_recipe_reads_the_item_number_and_only_the_game_writes_it() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    env.open_pool(&owner, 0, gold).unwrap();
    let p = player(&mut env, 10_000);
    env.deposit(&p, 0, gold, 10_000).unwrap();
    env.upsert_item(30, collectible("Fish")).unwrap();
    let salvage = recipe(vec![Input::Burn { item: 30, count: 1 }], vec![Output::Tokens { mint: gold, amount: 5_000, from: Origin::Pool(0) }]);
    env.upsert_recipe(&owner, 1, salvage).unwrap();

    // The right name and collection, minted straight through Core with no attributes, and
    // with attributes that name no item. (Only the collection's owner can mint these: the
    // point is what the program does with one.)
    let mut bare = vec![];
    for attributes in [None, Some(vec![("level", "9")]), Some(vec![("item_id", "x30")])] {
        let asset = Keypair::new();
        let mut create = CreateV2Builder::new();
        create.asset(asset.pubkey()).collection(Some(env.collection)).payer(owner.pubkey()).authority(Some(owner.pubkey())).owner(Some(p.pubkey())).name("Fish #7".into()).uri("x".into());
        if let Some(list) = attributes {
            let attribute_list = list.into_iter().map(|(k, v)| mpl_core::types::Attribute { key: k.into(), value: v.into() }).collect();
            create.plugins(vec![mpl_core::types::PluginAuthorityPair { plugin: mpl_core::types::Plugin::Attributes(mpl_core::types::Attributes { attribute_list }), authority: None }]);
        }
        env.send(&[create.instruction()], &[&owner, &asset]).unwrap();
        assert!(err(env.craft(&p, 1, &[asset.pubkey()])).contains("ItemMismatch"));
        bare.push(asset.pubkey());
    }
    // `set` cannot write on an asset with no attribute list (Core refuses), and on the others
    // it writes no item number.
    assert!(env.set(&authority, bare[0], &[("item_id", "30")]).is_err());
    env.set(&authority, bare[1], &[("item_id", "30")]).unwrap();
    assert_eq!(written(&env, &bare[1]), vec![]);
    assert!(err(env.craft(&p, 1, &[bare[1]])).contains("ItemMismatch"));

    // Another item called Fish, bought by a player: its number is its own.
    let admin = player(&mut env, 0);
    env.upsert_item(999, ItemArgs { shares: vec![], ..item(ItemKind::Collectible, "Fish", 0, 1) }).unwrap();
    env.buy(999, 1).unwrap();
    let order = order_pda(&env.game, &env.player.pubkey(), 1);
    let fake = env.asset_pda(&order);
    env.settle(order, &admin).unwrap();
    assert_eq!(value(&written(&env, &fake), "item_id").as_deref(), Some("999"));
    let buyer = env.player.insecure_clone();
    assert!(err(env.craft(&buyer, 1, &[fake])).contains("ItemMismatch"));
    assert_eq!(env.tokens(&pool_pda(&env.game, 0)), 10_000);
}

/// Fix "set keeps the program's numbers", case by case, on the real Core program: an empty
/// list, a list that names the fixed three, one that names the other three, twice in a row,
/// and a burned asset. No key is ever written twice, and the list Core holds afterwards is the
/// one a recipe reads.
#[test]
fn sound_set_keeps_the_fixed_three_writes_nothing_twice_and_core_takes_every_list() {
    let mut env = setup();
    env.wait(1_700_000_000);
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let ore = env.new_mint(env.game);
    let p = player(&mut env, 0);
    env.token_account(p.pubkey(), ore);
    env.upsert_item(60, ItemArgs { burnable: true, life: Some(Life { ready_after: 0, lasts: 0, uses: 5, cooldown: 0 }), ..collectible("Mine") }).unwrap();
    env.upsert_recipe(&owner, 1, recipe(vec![Input::Use { item: 60 }], vec![Output::Tokens { mint: ore, amount: 1, from: Origin::Issue }])).unwrap();
    let mine = env.make(&authority, 60, p.pubkey()).unwrap();
    let fresh = written(&env, &mine);
    assert_eq!(keys(&fresh), ["item_id", "rarity", "serial", "made"]);

    // An empty list on a new collectible: the four stay.
    env.set(&authority, mine, &[]).unwrap();
    assert_eq!(written(&env, &mine), fresh);

    env.craft(&p, 1, &[mine]).unwrap();
    let used = written(&env, &mine);
    assert_eq!(keys(&used), ["item_id", "rarity", "serial", "made", "used", "used_at"]);

    // An empty list on a used one: all six stay, as they were.
    env.set(&authority, mine, &[]).unwrap();
    assert_eq!(written(&env, &mine), used);

    // A list that tries the fixed three and writes one of the others.
    env.set(&authority, mine, &[("item_id", "1"), ("rarity", "9"), ("serial", "77"), ("level", "3"), ("used", "4")]).unwrap();
    let now = written(&env, &mine);
    assert_eq!(keys(&now), ["level", "used", "item_id", "rarity", "serial", "made", "used_at"]);
    for key in ["item_id", "rarity", "serial", "made", "used_at"] {
        assert_eq!(value(&now, key), value(&used, key), "{key}");
    }
    assert_eq!(value(&now, "used").as_deref(), Some("4"));

    // The same list again changes nothing, and the recipe still reads the collectible.
    env.set(&authority, mine, &[("level", "3"), ("used", "4")]).unwrap();
    assert_eq!(written(&env, &mine), now);
    env.craft(&p, 1, &[mine]).unwrap();
    assert_eq!(value(&written(&env, &mine), "used").as_deref(), Some("5"));
    assert!(err(env.craft(&p, 1, &[mine])).contains("UsedUp"));

    // A burned one: nothing to read, and Core refuses.
    env.unmake(&authority, mine).unwrap();
    assert!(env.set(&authority, mine, &[("level", "1")]).is_err());
}

/// Fix 6, looked at from the other side: a game whose own mint is wrapped SOL. Nothing that is
/// carried out later can be written with a burn in it (an item's split, a box's split, a box
/// entry that burns, a holder's share), and what can be written settles: a shop sale splits to
/// a pool and the treasury, a box in the game's own mint pays, a lottery pays its pot out.
#[test]
fn sound_a_game_in_wrapped_sol_writes_no_burn_for_later_and_settles_what_it_sells() {
    let mut env = world();
    env.wait(1_700_000_000);
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let buyer = env.player.insecure_clone();
    let wsol = wrapped_sol(&mut env, &owner.pubkey(), 0);
    wrapped_sol(&mut env, &buyer.pubkey(), 1_000_000);
    env.mint = wsol;
    env.treasury = ata(&owner.pubkey(), &wsol);
    env.init_platform(FEE).unwrap();
    env.create_game().unwrap();
    env.open_pool(&owner, 0, wsol).unwrap();

    assert!(err(env.upsert_item(50, collectible("Arena"))).contains("BadShares"), "the tests' usual item burns 20%");
    env.upsert_item(50, ItemArgs { shares: vec![], ..collectible("Arena") }).unwrap();
    let arena = env.make(&authority, 50, buyer.pubkey()).unwrap();
    let sword = |shares| ItemArgs { shares, ..item(ItemKind::Collectible, "Sword", 0, 1_000) };
    for to in [To::Burn, To::Holder(arena)] {
        assert!(err(env.upsert_item(1, sword(vec![Share { to, bps: 100 }]))).contains("BadShares"));
        let entries = vec![DropEntry { outcome: Outcome::Nothing, weight: 1 }];
        let args = BoxArgs { price: 10, currency: None, rise: None, fall: None, stock_odds: false, active: true, shares: vec![Share { to, bps: 100 }], entries };
        assert!(err(env.upsert_box_args(1, args)).contains("BadShares"));
    }
    let burns = BoxArgs { price: 10, currency: None, rise: None, fall: None, stock_odds: false, active: true, shares: vec![], entries: vec![DropEntry { outcome: Outcome::Burn, weight: 1 }] };
    assert!(err(env.upsert_box_args(1, burns)).contains("BadEntries"));

    // A shop sale: half to a pool, the rest to the treasury.
    env.upsert_item(1, sword(vec![pool(0, 5_000)])).unwrap();
    env.buy(1, 1).unwrap();
    let order = order_pda(&env.game, &buyer.pubkey(), 1);
    let keeper = env.cranker.insecure_clone();
    env.settle(order, &keeper).unwrap();
    assert_eq!((env.tokens(&pool_pda(&env.game, 0)), env.tokens(&env.treasury)), (500, 500));

    // A box that pays a prize from the pool or gives nothing, with what is left to the treasury.
    env.upsert_box(1, 100, vec![pool(0, 1_000)], vec![pay_drop(0, 200, 1), DropEntry { outcome: Outcome::Nothing, weight: 1 }]).unwrap();
    for (nonce, roll) in [(2, 0), (3, 1)] {
        env.open_box(1, nonce).unwrap();
        let order = order_pda(&env.game, &buyer.pubkey(), nonce);
        env.callback_of(1, order, rnd(roll)).unwrap();
        env.settle_prize(order, Some(ata(&buyer.pubkey(), &wsol)), &keeper).unwrap();
    }
    assert_eq!((env.tokens(&pool_pda(&env.game, 0)), env.tokens(&env.treasury)), (500 + 10 - 200 + 10, 500 + 90 + 90));

    // A lottery with a cut: the cut to the treasury, the pot to the winner.
    env.open_pool(&owner, 1, wsol).unwrap();
    env.upsert_lottery(&owner, 1, LotteryArgs { price: 100, pot: 1, cut_bps: 1_000, places: vec![], ticket_mint: Pubkey::default(), every: DAY, draws_at: env.now() + DAY }).unwrap();
    env.buy_tickets(&buyer, 1, 3, wsol).unwrap();
    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(1)).unwrap();
    let had = env.tokens(&ata(&buyer.pubkey(), &wsol));
    env.pay_lottery(1, ata(&buyer.pubkey(), &wsol)).unwrap();
    assert_eq!((env.tokens(&ata(&buyer.pubkey(), &wsol)), env.tokens(&env.treasury)), (had + 270, 680 + 30));

    // What still burns in wrapped SOL fails in the transaction that asks for it, and holds
    // nothing up: a `pay` with a burn share is the payer's own.
    assert!(env.pay(100, vec![burn(1_000)]).is_err());
    env.pay(100, vec![pool(0, 1_000)]).unwrap();
}

/// The cooldown fix at its edges: an item with a cooldown and no count of uses. A renewal
/// before the first use is not a use; a renewal after one does not shorten the wait; and
/// neither does the authority writing something else on it.
#[test]
fn sound_a_cooldown_counts_from_the_last_use_through_a_renewal_and_a_set() {
    let mut env = setup();
    env.wait(1_700_000_000);
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let ore = env.new_mint(env.game);
    let p = player(&mut env, 0);
    env.token_account(p.pubkey(), ore);
    env.upsert_item(60, ItemArgs { soulbound: true, life: Some(Life { ready_after: 0, lasts: 0, uses: 0, cooldown: DAY as u32 }), ..collectible("Pass") }).unwrap();
    env.upsert_recipe(&owner, 1, recipe(vec![Input::Use { item: 60 }], vec![Output::Tokens { mint: ore, amount: 1, from: Origin::Issue }])).unwrap();
    env.upsert_recipe(&owner, 2, recipe(vec![Input::Renew { item: 60 }], vec![])).unwrap();
    let pass = env.make(&authority, 60, p.pubkey()).unwrap();

    env.craft(&p, 2, &[pass]).unwrap(); // renewed before it was ever used
    assert_eq!(value(&written(&env, &pass), "used_at"), None);
    env.craft(&p, 1, &[pass]).unwrap();
    for _ in 0..2 {
        env.craft(&p, 2, &[pass]).unwrap();
        env.set(&authority, pass, &[("level", "2")]).unwrap();
        env.wait(DAY - 1);
        assert!(err(env.craft(&p, 1, &[pass])).contains("NotReady"));
        env.wait(1);
        env.craft(&p, 1, &[pass]).unwrap();
    }
    assert_eq!(my(&env, &p, &ore), 3);
    assert_eq!(keys(&written(&env, &pass)).iter().filter(|k| **k == "used" || **k == "used_at").count(), 2, "each written once");
}

/// The receipt fix: `Crafted` names the version that was crafted, and a craft signed for an
/// older version is refused, so the version on a receipt is the one whose lines moved.
#[test]
fn sound_the_crafted_receipt_names_the_version_whose_lines_moved() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let points = env.new_mint(env.game);
    let p = player(&mut env, 100);
    let gold = env.mint;
    env.token_account(p.pubkey(), points);
    let rate = |amount| recipe(vec![Input::Pay { mint: gold, amount: 2, to: To::Burn }], vec![Output::Tokens { mint: points, amount, from: Origin::Issue }]);
    env.upsert_recipe(&owner, 1, rate(3)).unwrap();
    let (mut old, _) = env.craft_ix(p.pubkey(), 1, 0, &[]);
    old.data = loot::instruction::Craft { version: 0, times: 5 }.data();
    env.upsert_recipe(&owner, 1, rate(1)).unwrap();
    assert!(err(env.send(&[old], &[&p])).contains("RecipeChanged"));

    let (mut new, _) = env.craft_ix(p.pubkey(), 1, 1, &[]);
    new.data = loot::instruction::Craft { version: 1, times: 5 }.data();
    let logs = env.send(&[new], &[&p]).unwrap();
    let crafted: loot::receipts::Crafted = receipt(&logs);
    assert_eq!((crafted.id, crafted.version, crafted.times, crafted.player), (1, 1, 5, p.pubkey()));
    assert_eq!((my(&env, &p, &gold), my(&env, &p, &points)), (90, 5));
}

// ================================================================ plain bugs looked for, not found

/// A contest at its limits: 255 sides, amounts near the top of 64 bits, and three shares that
/// each round down. Nothing overflows, the account never changes size, every entry's rent
/// comes back, and the pot is paid out to the last unit.
#[test]
fn sound_a_contest_of_the_largest_numbers_pays_out_to_the_last_unit_and_closes() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let big = env.new_mint(owner.pubkey());
    env.open_pool(&owner, 0, big).unwrap();
    let third = u64::MAX / 3;
    let players: Vec<Keypair> = (0..3).map(|_| player(&mut env, 0)).collect();
    for p in &players {
        env.fund(p.pubkey(), big, third);
    }
    let args = ContestArgs { sides: 255, closes_at: env.now() + 600, result_by: env.now() + 1_200, shares: vec![burn(3_333), pool(0, 3_333), burn(1)] };
    env.open_contest(&authority, 1, big, args).unwrap();
    let size = env.data(&env.contest_pda(1)).len();
    let before: Vec<u64> = players.iter().map(|p| env.lamports(&p.pubkey())).collect();
    env.enter(&players[0], 1, 254, third).unwrap();
    env.enter(&players[0], 1, 254, 0).unwrap_err();
    env.enter(&players[1], 1, 254, third - 1).unwrap();
    env.enter(&players[1], 1, 254, 1).unwrap();
    env.enter(&players[2], 1, 0, third).unwrap();
    assert!(err(env.enter(&players[2], 1, 255, 1)).contains("BadContest"));
    env.decide(&authority, 1, 254).unwrap();
    assert_eq!(env.data(&env.contest_pda(1)).len(), size);
    for (p, side) in [(&players[2], 0), (&players[1], 254), (&players[0], 254)] {
        env.claim(1, p.pubkey(), side, ata(&p.pubkey(), &big)).unwrap();
    }
    assert_eq!(env.tokens(&env.pot_pda(1)), 0);
    let paid: u64 = players.iter().map(|p| my(&env, p, &big)).sum();
    assert_eq!(paid, env.contest(1).prize);
    env.close_contest(1).unwrap();
    assert!(!env.exists(&env.contest_pda(1)) || env.data(&env.contest_pda(1)).is_empty());
    // The first and the third each sent one entry that landed and one that was refused; the
    // second sent two that landed.
    let spent = [FEE + 2 * TX_FEE, 2 * (FEE + TX_FEE), FEE + 2 * TX_FEE];
    for ((p, had), spent) in players.iter().zip(before).zip(spent) {
        assert_eq!(env.lamports(&p.pubkey()), had - spent, "only the fees are gone: the entry's rent came back");
    }
}

/// A hold's rent and its way home, with nobody the player has to ask: a stranger with no
/// stake in it sends the collectible back, the player gets the hold's rent, and the address
/// is free for the next hold. A hold of the longest time does not overflow.
#[test]
fn sound_a_holds_rent_comes_back_and_its_address_is_free_again() {
    let mut env = setup();
    env.wait(1_700_000_000);
    let authority = env.authority.insecure_clone();
    let p = player(&mut env, 0);
    let keeper = env.cranker.insecure_clone();
    env.upsert_item(40, collectible("Sword")).unwrap();
    let sword = env.make(&authority, 40, p.pubkey()).unwrap();
    for _ in 0..2 {
        let had = env.lamports(&p.pubkey());
        env.hold(&p, sword, 60).unwrap();
        assert!(err(env.take_back(&keeper, sword, p.pubkey())).contains("StillHeld"));
        env.wait(60);
        assert!(err(env.take_back(&keeper, sword, keeper.pubkey())).contains("NotThePlayers"));
        env.take_back(&keeper, sword, p.pubkey()).unwrap();
        assert_eq!(env.lamports(&p.pubkey()), had - FEE - TX_FEE, "only the fees are gone: the hold's rent came back");
        assert!(env.data(&env.hold_pda(&sword)).is_empty());
    }
    env.hold(&p, sword, i64::MAX).unwrap();
    assert_eq!(env.acc::<loot::Hold>(&env.hold_pda(&sword)).free_at, i64::MAX);
    env.award(&authority, sword, p.pubkey()).unwrap();
}
