//! The building blocks added on 2026-10-11, in LiteSVM against the real program binary: the
//! general recipe, a box in another currency, shares that pay an account or whoever holds a
//! collectible, a price that rises, a collectible's life, holds, and contests. Each test is a
//! small economy a game could run.
mod common;

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::solana_program::instruction::AccountMeta,
    common::*,
    loot::{
        state::{ItemKind, Life, Order, Outcome, Rise, Share, To},
        receipts::{Crafted, Decided},
        BoxArgs, ContestArgs, GameUpdate, Input, ItemArgs, Keep, LotteryArgs, Need, Origin, Output, RecipeArgs, Verdict,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const HOUR: i64 = 60 * 60;
const DAY: i64 = 24 * HOUR;

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

fn alive(env: &Env, asset: &Pubkey) -> bool {
    mpl_core::Asset::from_bytes(&env.data(asset)).is_ok()
}

fn holder(env: &Env, asset: &Pubkey) -> Pubkey {
    mpl_core::Asset::from_bytes(&env.data(asset)).unwrap().base.owner
}

/// The number this program wrote on a collectible under `key`, read the way the program reads it.
fn written(env: &Env, asset: &Pubkey, key: &str) -> u32 {
    loot::asset::number(&loot::asset::attributes(&env.data(asset)).unwrap(), key)
}

fn my(env: &Env, who: &Keypair, mint: &Pubkey) -> u64 {
    env.tokens(&ata(&who.pubkey(), mint))
}

// ================================================================ recipes

/// A fishing game: a fish is sold for ore (salvage), ore buys a hook (a shop in another
/// currency), and two fish, a hook and gold make a trophy and some ore.
#[test]
fn a_recipe_takes_and_gives_collectibles_and_tokens() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    let ore = env.new_mint(env.game); // the game mints it
    env.open_pool(&owner, 0, gold).unwrap();
    for (id, name) in [(30, "Fish"), (31, "Hook"), (32, "Trophy")] {
        env.upsert_item(id, collectible(name)).unwrap();
    }
    let p = player(&mut env, 1_000);
    env.token_account(p.pubkey(), ore);

    let salvage = recipe(vec![Input::Burn { item: 30, count: 1 }], vec![Output::Tokens { mint: ore, amount: 5, from: Origin::Issue }]);
    let shop = recipe(vec![Input::Pay { mint: ore, amount: 8, to: To::Burn }], vec![Output::Item(31)]);
    let trophy = recipe(
        vec![Input::Burn { item: 30, count: 2 }, Input::Burn { item: 31, count: 1 }, Input::Pay { mint: gold, amount: 100, to: To::Pool(0) }],
        vec![Output::Item(32), Output::Tokens { mint: ore, amount: 1, from: Origin::Issue }],
    );
    assert!(err(env.upsert_recipe(&p, 1, salvage.clone())).contains("NotOwner"));
    env.upsert_recipe(&owner, 1, salvage).unwrap();
    env.upsert_recipe(&owner, 2, shop).unwrap();
    env.upsert_recipe(&owner, 3, trophy.clone()).unwrap();

    let fish: Vec<Pubkey> = (0..4).map(|_| env.make(&authority, 30, p.pubkey()).unwrap()).collect();

    // Not enough ore for a hook yet.
    assert!(env.craft(&p, 2, &[]).is_err());
    env.craft(&p, 1, &fish[..1]).unwrap();
    env.craft(&p, 1, &fish[1..2]).unwrap();
    assert_eq!((my(&env, &p, &ore), alive(&env, &fish[0]), alive(&env, &fish[1])), (10, false, false));

    let hook = env.craft(&p, 2, &[]).unwrap()[0];
    assert_eq!((my(&env, &p, &ore), env.supply(&ore), holder(&env, &hook)), (2, 2, p.pubkey()));

    // The collectibles go in the recipe's order: a hook is not a fish.
    assert!(err(env.craft(&p, 3, &[fish[2], hook, fish[3]])).contains("ItemMismatch"));
    let version = env.acc::<loot::Recipe>(&env.mechanic_pda(loot::RECIPE_SEED, 3)).version;
    let (ix, made) = env.craft_ix(p.pubkey(), 3, version, &[fish[2], fish[3], hook]);
    let logs = env.send(&[compute_limit(1_000_000), ix], &[&p, &made[0]]).unwrap();
    let r: Crafted = receipt(&logs);
    assert_eq!((r.burned, r.used, r.made), (vec![fish[2], fish[3], hook], vec![], vec![made[0].pubkey()]));
    assert_eq!(mpl_core::Asset::from_bytes(&env.data(&made[0].pubkey())).unwrap().base.name, "Trophy #1");
    assert_eq!((my(&env, &p, &gold), env.tokens(&pool_pda(&env.game, 0)), my(&env, &p, &ore)), (900, 100, 3));

    // An edit that lands first cannot change what the player signed for.
    let dearer = RecipeArgs { inputs: vec![Input::Pay { mint: gold, amount: 900, to: To::Pool(0) }], ..trophy };
    env.upsert_recipe(&owner, 3, dearer).unwrap();
    let (ix, made) = env.craft_ix(p.pubkey(), 3, version, &[]);
    assert!(err(env.send(&[ix], &[&p, &made[0]])).contains("RecipeChanged"));
    assert_eq!(my(&env, &p, &gold), 900);

    // The owner's pause stops a recipe like any other way in.
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(true) }).unwrap();
    assert!(err(env.craft(&p, 2, &[])).contains("Paused"));
}

#[test]
fn a_recipe_is_refused_when_it_is_too_large_or_has_an_empty_line() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let mint = env.mint;
    let burn = |count| Input::Burn { item: 30, count };
    let pay = |amount| Input::Pay { mint, amount, to: To::Burn };
    let bad = [
        recipe(vec![], vec![]),
        recipe(vec![pay(1); 9], vec![]),
        recipe(vec![], vec![Output::Item(1); 9]),
        recipe(vec![burn(5), burn(4)], vec![]),
        recipe(vec![burn(0)], vec![Output::Item(1)]),
        recipe(vec![pay(0)], vec![Output::Item(1)]),
        recipe(vec![burn(1)], vec![Output::Tokens { mint, amount: 0, from: Origin::Issue }]),
    ];
    for args in bad {
        assert!(err(env.upsert_recipe(&owner, 1, args)).contains("BadRecipe"));
    }
    env.upsert_recipe(&owner, 1, recipe(vec![burn(4), burn(3), Input::Use { item: 31 }, pay(1)], vec![])).unwrap();
}

/// Three gems for an upgrade attempt, and the attempt is the price of a box that gives a big
/// gem half the time. The box is priced in the attempt token and burns it.
#[test]
fn a_recipe_and_a_box_make_a_craft_left_to_chance() {
    let mut env = setup();
    let (owner, authority, p) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.player.insecure_clone());
    let attempt = env.new_mint(env.game);
    env.upsert_item(40, collectible("Gem")).unwrap();
    env.upsert_item(41, collectible("Big Gem")).unwrap();
    env.upsert_recipe(&owner, 1, recipe(vec![Input::Burn { item: 40, count: 3 }], vec![Output::Tokens { mint: attempt, amount: 1, from: Origin::Issue }])).unwrap();

    let entries = vec![item_drop(41, 1), loot::state::DropEntry { outcome: Outcome::Nothing, weight: 1 }];
    let fusion = BoxArgs { price: 1, currency: Some(attempt), rise: None, fall: None, stock_odds: false, active: true, shares: vec![burn(10_000)], entries };
    // The treasury holds the game's token only: a box in another one leaves it nothing.
    assert!(err(env.upsert_box_args(5, BoxArgs { shares: vec![burn(9_000)], ..fusion.clone() })).contains("BadShares"));
    env.upsert_box_args(5, fusion).unwrap();

    env.token_account(p.pubkey(), attempt);
    for _ in 0..3 {
        let gems: Vec<Pubkey> = (0..3).map(|_| env.make(&authority, 40, p.pubkey()).unwrap()).collect();
        env.craft(&p, 1, &gems).unwrap();
    }
    assert_eq!(my(&env, &p, &attempt), 3);
    let gold = my(&env, &p, &env.mint);

    // It works.
    let order = order_pda(&env.game, &p.pubkey(), 1);
    env.open_box(5, 1).unwrap();
    assert_eq!((env.acc::<Order>(&order).mint, env.tokens(&ata(&env.game, &attempt))), (attempt, 1));
    env.callback_of(5, order, rnd(0)).unwrap();
    let big = env.asset_pda(&order);
    let c = env.cranker.insecure_clone();
    env.settle(order, &c).unwrap();
    assert_eq!((holder(&env, &big), env.supply(&attempt), my(&env, &p, &attempt)), (p.pubkey(), 2, 2));

    // It fails: the attempt is burned all the same.
    let order = order_pda(&env.game, &p.pubkey(), 2);
    env.open_box(5, 2).unwrap();
    env.callback_of(5, order, rnd(1)).unwrap();
    assert_eq!(env.acc::<Order>(&order).outcome, Outcome::Nothing);
    env.settle_prize(order, None, &c).unwrap();
    assert_eq!((env.supply(&attempt), env.item_state(41).issued), (1, 1));

    // The oracle never answers: the attempt comes back, in its own token.
    let order = order_pda(&env.game, &p.pubkey(), 3);
    env.open_box(5, 3).unwrap();
    assert_eq!(my(&env, &p, &attempt), 0);
    env.wait_slots(loot::STALE_SLOTS + 1);
    env.refund(order).unwrap();
    assert_eq!((my(&env, &p, &attempt), my(&env, &p, &env.mint)), (1, gold), "none of it touched the game's own token");
}

// ================================================================ shares

/// A farming game: a partner takes 10% of every payment, and whoever holds the plot takes 20%.
#[test]
fn a_share_pays_an_account_or_whoever_holds_a_collectible() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let gold = env.mint;
    let partner = env.token_account(Keypair::new().pubkey(), gold);
    let landlord = player(&mut env, 0);
    let buyer = player(&mut env, 0);
    env.upsert_item(50, collectible("Plot")).unwrap();
    let plot = env.make(&authority, 50, landlord.pubkey()).unwrap();
    let shares = vec![Share { to: To::Account(partner), bps: 1_000 }, Share { to: To::Holder(plot), bps: 2_000 }, burn(1_000)];

    let treasury = env.tokens(&env.treasury);
    env.pay(1_000, shares.clone()).unwrap();
    assert_eq!((env.tokens(&partner), my(&env, &landlord, &gold), env.tokens(&env.treasury) - treasury), (100, 200, 600));

    // A sale from the shop pays the plot's holder too, when it settles.
    env.upsert_item(51, ItemArgs { shares: vec![Share { to: To::Holder(plot), bps: 5_000 }], ..item(ItemKind::Collectible, "Crop", 0, 1_000) }).unwrap();
    env.buy(51, 1).unwrap();
    let c = env.cranker.insecure_clone();
    env.settle(order_pda(&env.game, &env.player.pubkey(), 1), &c).unwrap();
    assert_eq!(my(&env, &landlord, &gold), 700);

    // The share must go to the holder: nobody who sends a transaction can point it elsewhere.
    let p = env.player.insecure_clone();
    let mut ix = env.pay_ix(p.pubkey(), gold, 1_000, shares.clone());
    let last = ix.accounts.len() - 1;
    ix.accounts[last] = AccountMeta::new(partner, false);
    assert!(err(env.send(&[ix], &[&p])).contains("NotTheHolders"));

    // The plot is sold on: the share follows it.
    let sell = mpl_core::instructions::TransferV1Builder::new()
        .asset(plot)
        .collection(Some(env.collection))
        .payer(landlord.pubkey())
        .new_owner(buyer.pubkey())
        .instruction();
    env.send(&[sell], &[&landlord]).unwrap();
    env.pay(1_000, shares.clone()).unwrap();
    assert_eq!((my(&env, &landlord, &gold), my(&env, &buyer, &gold)), (700, 200));

    // The plot is burned: nobody holds it, and its share is burned with the 10% that always is.
    let burn_it = mpl_core::instructions::BurnV1Builder::new()
        .asset(plot)
        .collection(Some(env.collection))
        .payer(buyer.pubkey())
        .instruction();
    env.send(&[burn_it], &[&buyer]).unwrap();
    let (treasury, supply) = (env.tokens(&env.treasury), env.supply(&gold));
    env.pay(1_000, shares).unwrap();
    assert_eq!((my(&env, &buyer, &gold), env.tokens(&env.treasury) - treasury, supply - env.supply(&gold)), (200, 600, 300));
}

// ================================================================ a price that rises

/// A throne that costs 10% more each time, and a box that costs 50 more each time.
#[test]
fn a_price_rises_with_every_sale() {
    let mut env = setup();
    let p = env.player.insecure_clone();
    let gold = env.mint;
    let throne = ItemArgs { rise: Some(Rise { step: 0, growth_bps: 1_000 }), ..item(ItemKind::Collectible, "Throne Seat", 0, 1_000) };
    env.upsert_item(60, throne).unwrap();
    let before = my(&env, &p, &gold);

    // Two buyers saw 1,000. The second one's transaction lands at 1,100, and is refused.
    let late = env.buy_ix_max(60, 2, 1_000);
    env.buy(60, 1).unwrap();
    assert_eq!(env.item_state(60).price, 1_100);
    assert!(err(env.send(&[late], &[&p])).contains("PriceAboveMax"));
    env.buy(60, 2).unwrap();
    assert_eq!((env.item_state(60).price, before - my(&env, &p, &gold)), (1_210, 2_100));

    let rising = BoxArgs { price: 100, currency: None, rise: Some(Rise { step: 50, growth_bps: 0 }), fall: None, stock_odds: false, active: true, shares: vec![], entries: vec![item_drop(60, 1)] };
    env.upsert_box_args(6, rising).unwrap();
    env.open_box(6, 3).unwrap();
    env.open_box(6, 4).unwrap();
    assert_eq!(env.acc::<loot::state::LootBox>(&box_pda(&env.game, 6)).price, 200);
    assert_eq!(env.acc::<Order>(&order_pda(&env.game, &p.pubkey(), 4)).paid, 150);
}

// ================================================================ a collectible's life

/// An egg hatches after a day, and milk makes cheese only while it is fresh.
#[test]
fn a_collectible_is_taken_only_when_it_is_ready_and_before_it_expires() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = player(&mut env, 0);
    let life = |ready_after, lasts| Some(Life { ready_after, lasts, uses: 0, cooldown: 0 });
    env.upsert_item(70, ItemArgs { life: life(DAY as u32, 0), ..collectible("Egg") }).unwrap();
    env.upsert_item(71, collectible("Chick")).unwrap();
    env.upsert_item(72, ItemArgs { life: life(0, DAY as u32), ..collectible("Milk") }).unwrap();
    env.upsert_item(73, collectible("Cheese")).unwrap();
    env.upsert_recipe(&owner, 1, merge_recipe(70, 1, 71)).unwrap();
    env.upsert_recipe(&owner, 2, merge_recipe(72, 1, 73)).unwrap();

    let egg = env.make(&authority, 70, p.pubkey()).unwrap();
    let milk: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 72, p.pubkey()).unwrap()).collect();
    assert_eq!(written(&env, &egg, "made") as i64, env.now());

    assert!(err(env.craft(&p, 1, &[egg])).contains("NotReady"));
    env.craft(&p, 2, &milk[..1]).unwrap();
    env.wait(DAY - 1);
    assert!(err(env.craft(&p, 1, &[egg])).contains("NotReady"));
    env.wait(1);
    env.craft(&p, 1, &[egg]).unwrap();
    assert!(err(env.craft(&p, 2, &milk[1..])).contains("Expired"));
    assert!(alive(&env, &milk[1]), "it rots in the wallet; nothing burns it");

    // How long an item lives is part of what it is: it cannot change under its holders.
    let shorter = ItemArgs { life: life(0, 60), ..collectible("Milk") };
    assert!(err(env.upsert_item(72, shorter)).contains("KindLocked"));
}

/// Two mares, each good for two foals and one a hour, make a foal and are kept. A soulbound
/// pass pays its holder a coin a day.
#[test]
fn a_collectible_is_used_and_kept_only_so_many_times_and_only_so_often() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    env.open_pool(&owner, 0, gold).unwrap();
    let p = player(&mut env, 0);
    let other = player(&mut env, 0);
    let funder = player(&mut env, 100);
    env.deposit(&funder, 0, gold, 100).unwrap();

    let mare = Life { ready_after: 0, lasts: 0, uses: 2, cooldown: HOUR as u32 };
    let pass = Life { ready_after: 0, lasts: 0, uses: 0, cooldown: DAY as u32 };
    env.upsert_item(74, ItemArgs { life: Some(mare), ..collectible("Mare") }).unwrap();
    env.upsert_item(76, collectible("Foal")).unwrap();
    env.upsert_item(77, ItemArgs { soulbound: true, life: Some(pass), ..collectible("Pass") }).unwrap();
    env.upsert_item(78, ItemArgs { soulbound: true, ..collectible("Licence") }).unwrap();
    env.upsert_recipe(&owner, 1, recipe(vec![Input::Use { item: 74 }, Input::Use { item: 74 }], vec![Output::Item(76)])).unwrap();
    let coin = vec![Output::Tokens { mint: gold, amount: 1, from: Origin::Pool(0) }];
    env.upsert_recipe(&owner, 2, recipe(vec![Input::Use { item: 77 }], coin.clone())).unwrap();
    env.upsert_recipe(&owner, 3, recipe(vec![Input::Use { item: 78 }], coin)).unwrap();

    let mares: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 74, p.pubkey()).unwrap()).collect();
    let theirs = env.make(&authority, 74, other.pubkey()).unwrap();
    // The authority's own attributes sit beside the program's counts.
    let made = written(&env, &mares[0], "made").to_string();
    env.set(&authority, mares[0], &[("made", made.as_str()), ("speed", "9")]).unwrap();

    // One mare is not two parents, and someone else's mare is not yours.
    assert!(err(env.craft(&p, 1, &[mares[0], mares[0]])).contains("ItemMismatch"));
    assert!(err(env.craft(&p, 1, &[mares[0], theirs])).contains("ItemMismatch"));

    let foal = env.craft(&p, 1, &mares).unwrap()[0];
    assert_eq!(holder(&env, &foal), p.pubkey());
    for mare in &mares {
        assert_eq!((holder(&env, mare), written(&env, mare, "used"), written(&env, mare, "used_at") as i64), (p.pubkey(), 1, env.now()));
    }
    // What the program reads is what Metaplex Core's own reader finds.
    let core: Vec<(String, String)> = mpl_core::Asset::from_bytes(&env.data(&mares[0])).unwrap().plugin_list.attributes.unwrap().attributes.attribute_list.into_iter().map(|a| (a.key, a.value)).collect();
    let ours: Vec<(String, String)> = loot::asset::attributes(&env.data(&mares[0])).unwrap().into_iter().map(|a| (a.key, a.value)).collect();
    assert_eq!(core, ours);
    assert_eq!(ours[..2], [("made".to_string(), made), ("speed".to_string(), "9".to_string())]);

    assert!(err(env.craft(&p, 1, &mares)).contains("NotReady"), "an hour between foals");
    env.wait(HOUR);
    env.craft(&p, 1, &mares).unwrap();
    env.wait(HOUR);
    assert!(err(env.craft(&p, 1, &mares)).contains("UsedUp"), "two foals each");
    assert_eq!(env.item_state(76).issued, 2);

    // A daily claim: a soulbound pass can be used (never burned), once a day.
    let pass = env.make(&authority, 77, p.pubkey()).unwrap();
    env.craft(&p, 2, &[pass]).unwrap();
    assert!(err(env.craft(&p, 2, &[pass])).contains("NotReady"));
    env.wait(DAY);
    env.craft(&p, 2, &[pass]).unwrap();
    assert_eq!((my(&env, &p, &gold), written(&env, &pass, "used")), (2, 2));

    // An item with no life is only held: a licence opens a recipe as often as its holder likes.
    let licence = env.make(&authority, 78, p.pubkey()).unwrap();
    env.craft(&p, 3, &[licence]).unwrap();
    env.craft(&p, 3, &[licence]).unwrap();
    assert!(err(env.craft(&other, 3, &[licence])).contains("ItemMismatch"));
    assert_eq!((my(&env, &p, &gold), written(&env, &licence, "used")), (4, 0));
}

/// A hero of level 10 or more is reborn: the new hero keeps its name and its eyes. A pickaxe
/// good for two swings is repaired for a coin.
#[test]
fn a_recipe_asks_for_a_number_keeps_attributes_and_renews_uses() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    let ore = env.new_mint(env.game);
    let p = player(&mut env, 10);
    env.token_account(p.pubkey(), ore);
    env.upsert_item(90, collectible("Hero")).unwrap();
    env.upsert_item(91, collectible("Reborn Hero")).unwrap();
    let two_swings = Life { ready_after: 0, lasts: 0, uses: 2, cooldown: 0 };
    env.upsert_item(92, ItemArgs { life: Some(two_swings), ..collectible("Pickaxe") }).unwrap();

    let need = |key: &str| Need { place: 0, key: key.into(), at_least: 10 };
    let keep = |key: &str| Keep { key: key.into(), from: 0, to: 0 };
    let rebirth = RecipeArgs {
        needs: vec![need("level")],
        keeps: vec![keep("name"), keep("eyes"), keep("tail")],
        ..recipe(vec![Input::Burn { item: 90, count: 1 }], vec![Output::Item(91)])
    };
    // A need or a keep names a collectible the recipe has, and never the program's own numbers.
    for bad in [
        RecipeArgs { needs: vec![Need { place: 1, ..need("level") }], ..rebirth.clone() },
        RecipeArgs { needs: vec![need("")], ..rebirth.clone() },
        RecipeArgs { keeps: vec![Keep { from: 1, ..keep("name") }], ..rebirth.clone() },
        RecipeArgs { keeps: vec![Keep { to: 1, ..keep("name") }], ..rebirth.clone() },
        RecipeArgs { keeps: vec![keep("serial")], ..rebirth.clone() },
        RecipeArgs { keeps: vec![keep("used")], ..rebirth.clone() },
    ] {
        assert!(err(env.upsert_recipe(&owner, 1, bad)).contains("BadRecipe"));
    }
    env.upsert_recipe(&owner, 1, rebirth).unwrap();

    let heroes: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 90, p.pubkey()).unwrap()).collect();
    env.set(&authority, heroes[0], &[("level", "9"), ("name", "Bo"), ("eyes", "green")]).unwrap();
    assert!(err(env.craft(&p, 1, &heroes[..1])).contains("NeedNotMet"));
    assert!(err(env.craft(&p, 1, &heroes[1..])).contains("NeedNotMet"), "no level written is no level");
    env.set(&authority, heroes[0], &[("level", "10"), ("name", "Bo"), ("eyes", "green")]).unwrap();
    let reborn = env.craft(&p, 1, &heroes[..1]).unwrap()[0];
    let on_it: Vec<(String, String)> = loot::asset::attributes(&env.data(&reborn)).unwrap().into_iter().map(|a| (a.key, a.value)).collect();
    let keys: Vec<&str> = on_it.iter().map(|(key, _)| key.as_str()).collect();
    assert_eq!(keys, ["item_id", "rarity", "serial", "made", "name", "eyes"], "its own four, then what it kept; the hero had no tail");
    assert_eq!((on_it[0].1.as_str(), on_it[4].1.as_str(), on_it[5].1.as_str()), ("91", "Bo", "green"));

    // The pickaxe: two swings, then a repair that costs a coin, then two more.
    let swing = recipe(vec![Input::Use { item: 92 }], vec![Output::Tokens { mint: ore, amount: 1, from: Origin::Issue }]);
    let repair = recipe(vec![Input::Renew { item: 92 }, Input::Pay { mint: gold, amount: 1, to: To::Burn }], vec![]);
    env.upsert_recipe(&owner, 2, swing).unwrap();
    env.upsert_recipe(&owner, 3, repair).unwrap();
    let pickaxe = env.make(&authority, 92, p.pubkey()).unwrap();
    env.craft(&p, 2, &[pickaxe]).unwrap();
    env.craft(&p, 2, &[pickaxe]).unwrap();
    assert!(err(env.craft(&p, 2, &[pickaxe])).contains("UsedUp"));
    env.craft(&p, 3, &[pickaxe]).unwrap();
    assert_eq!((written(&env, &pickaxe, "used"), my(&env, &p, &gold)), (0, 9));
    env.craft(&p, 2, &[pickaxe]).unwrap();
    assert_eq!((my(&env, &p, &ore), holder(&env, &pickaxe)), (3, p.pubkey()));

    // A recipe with a collectible in it is crafted once at a time.
    assert!(err(env.craft_times(&p, 2, 2, &[pickaxe])).contains("OnceAtATime"));
}

/// The largest recipes: eight collectibles burned for one, and four burned and four used for
/// two more and some tokens. Each fits in one transaction and its compute limit.
#[test]
fn the_largest_recipes_fit_in_one_transaction() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let ore = env.new_mint(env.game);
    let p = player(&mut env, 1_000);
    env.token_account(p.pubkey(), ore);
    env.upsert_item(30, collectible("Shard")).unwrap();
    env.upsert_item(31, ItemArgs { life: Some(Life { ready_after: 0, lasts: 0, uses: 9, cooldown: 0 }), ..collectible("Rune") }).unwrap();
    env.upsert_item(32, collectible("Relic")).unwrap();
    let rune = |_| Input::Use { item: 31 };
    let wide = RecipeArgs {
        keeps: vec![Keep { key: "made_by".into(), from: 0, to: 0 }],
        ..recipe(
            vec![Input::Burn { item: 30, count: 4 }, rune(0), rune(1), rune(2), rune(3), Input::Pay { mint: env.mint, amount: 5, to: To::Burn }],
            vec![Output::Item(32), Output::Item(32), Output::Tokens { mint: ore, amount: 1, from: Origin::Issue }],
        )
    };
    env.upsert_recipe(&owner, 1, merge_recipe(30, 8, 32)).unwrap();
    env.upsert_recipe(&owner, 2, wide).unwrap();

    let shards: Vec<Pubkey> = (0..12).map(|_| env.make(&authority, 30, p.pubkey()).unwrap()).collect();
    let runes: Vec<Pubkey> = (0..4).map(|_| env.make(&authority, 31, p.pubkey()).unwrap()).collect();
    for (id, assets) in [(1, shards[..8].to_vec()), (2, [&shards[8..], &runes[..]].concat())] {
        let (ix, made) = env.craft_ix(p.pubkey(), id, 0, &assets);
        let ixs = [compute_limit(1_400_000), ix];
        let message = solana_message::Message::new(&ixs, Some(&p.pubkey()));
        let bytes = 1 + 64 * (1 + made.len()) + message.serialize().len();
        let mut signers = vec![&p];
        signers.extend(made.iter());
        env.send(&ixs, &signers).unwrap();
        let units = env.cus.last().unwrap().1;
        eprintln!("LIMIT recipe {id}: {bytes} bytes, {units} compute units");
        assert!(bytes <= 1232, "a transaction is at most 1,232 bytes; this one is {bytes}");
        assert!(units <= 1_400_000);
    }
}

/// A game with a collection that can move or freeze every asset in it cannot open here: a
/// player's collectible would not be theirs, and one the game holds might never come back.
#[test]
fn a_collection_that_can_seize_its_assets_cannot_open_a_game() {
    use anchor_lang::{InstructionData, ToAccountMetas};
    use mpl_core::types::{PermanentBurnDelegate, PermanentFreezeDelegate, PermanentTransferDelegate, Creator, Plugin, PluginAuthorityPair, Royalties, RuleSet};
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let mut open_with = |plugins: Vec<Plugin>| {
        let collection = Keypair::new();
        let create = mpl_core::instructions::CreateCollectionV2Builder::new()
            .collection(collection.pubkey())
            .update_authority(Some(owner.pubkey()))
            .payer(owner.pubkey())
            .name("Other".into())
            .uri("https://example.invalid/other.json".into())
            .plugins(plugins.into_iter().map(|plugin| PluginAuthorityPair { plugin, authority: None }).collect())
            .instruction();
        env.send(&[create], &[&owner, &collection]).unwrap();
        let game = pda(&[loot::GAME_SEED, collection.pubkey().as_ref()]);
        env.ix(
            loot::instruction::CreateGame { authority: owner.pubkey() }.data(),
            loot::accounts::CreateGame { owner: owner.pubkey(), game, collection: collection.pubkey(), mint: env.mint, treasury: env.treasury, system_program: SYSTEM }
                .to_account_metas(None),
            &[&owner],
        )
    };
    assert!(err(open_with(vec![Plugin::PermanentTransferDelegate(PermanentTransferDelegate {})])).contains("CollectionCanSeize"));
    assert!(err(open_with(vec![Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: false })])).contains("CollectionCanSeize"));
    assert!(err(open_with(vec![Plugin::PermanentBurnDelegate(PermanentBurnDelegate {})])).contains("CollectionCanSeize"));
    // No plugin at all, and a plain royalty, are fine.
    open_with(vec![]).unwrap();
    open_with(vec![Plugin::Royalties(Royalties { basis_points: 500, creators: vec![Creator { address: owner.pubkey(), percentage: 100 }], rule_set: RuleSet::None })]).unwrap();
}

/// Every monster killed earns a ticket, and the tickets are drawn for a pot of coins. The
/// tickets are their own token and are burned; the pot is filled by the owner.
#[test]
fn a_lottery_sells_tickets_in_one_token_for_a_prize_in_another() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    let kills = env.new_mint(env.game);
    env.open_pool(&owner, 0, gold).unwrap();
    let funder = player(&mut env, 500);
    env.deposit(&funder, 0, gold, 500).unwrap();
    let (a, b) = (player(&mut env, 0), player(&mut env, 0));
    for (who, earned) in [(&a, 3), (&b, 1)] {
        let to = env.token_account(who.pubkey(), kills);
        env.issue(&authority, kills, to, earned).unwrap();
    }

    let args = LotteryArgs { price: 1, pot: 0, cut_bps: 0, places: vec![], ticket_mint: kills, every: DAY, draws_at: env.now() + DAY };
    assert!(err(env.upsert_lottery(&owner, 1, LotteryArgs { cut_bps: 100, ..args.clone() })).contains("BadLottery"), "nothing to take a cut of");
    env.upsert_lottery(&owner, 1, args).unwrap();

    assert!(env.buy_tickets(&a, 1, 4, kills).is_err(), "three kills are three tickets");
    env.buy_tickets(&a, 1, 3, kills).unwrap();
    env.buy_tickets(&b, 1, 1, kills).unwrap();
    assert_eq!((env.supply(&kills), env.tokens(&pool_pda(&env.game, 0)), env.lottery(1).sold), (0, 500, 4));

    env.wait(DAY);
    env.draw_lottery(1).unwrap();
    env.lottery_callback(1, rnd(3)).unwrap();
    assert_eq!(env.lottery(1).winner, b.pubkey(), "ticket 3 is b's");
    env.pay_lottery(1, ata(&b.pubkey(), &gold)).unwrap();
    assert_eq!(my(&env, &b, &gold), 500);
}

// ================================================================ holds

/// A raid: a player takes a sword in for ten minutes. If they die in that time the authority
/// gives it to whoever killed them; if they do not, it comes home.
#[test]
fn a_player_hands_a_collectible_to_the_game_for_a_time_they_choose() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let p = player(&mut env, 0);
    let killer = Keypair::new().pubkey();
    env.upsert_item(80, collectible("Sword")).unwrap();
    env.upsert_item(81, ItemArgs { soulbound: true, ..collectible("Oath") }).unwrap();
    let swords: Vec<Pubkey> = (0..3).map(|_| env.make(&authority, 80, p.pubkey()).unwrap()).collect();
    let oath = env.make(&authority, 81, p.pubkey()).unwrap();

    // The first sword: lost in the raid.
    let before = env.lamports(&p.pubkey());
    env.hold(&p, swords[0], 600).unwrap();
    let h: loot::Hold = env.acc(&env.hold_pda(&swords[0]));
    assert_eq!((holder(&env, &swords[0]), h.player, h.free_at), (env.game, p.pubkey(), env.now() + 600));
    assert!(err(env.take_back(&c, swords[0], p.pubkey())).contains("StillHeld"));
    assert!(err(env.award(&owner, swords[0], killer)).contains("NotAuthority"));
    env.award(&authority, swords[0], killer).unwrap();
    assert_eq!(holder(&env, &swords[0]), killer);
    assert!(!env.exists(&env.hold_pda(&swords[0])));
    assert_eq!(before - env.lamports(&p.pubkey()), FEE + 5_000, "the hold's rent came back; the fee and the signature did not");

    // The second: the raid ends, and the authority's say with it.
    env.hold(&p, swords[1], 600).unwrap();
    env.wait(600);
    assert!(err(env.award(&authority, swords[1], killer)).contains("HoldOver"));
    assert!(err(env.take_back(&c, swords[1], killer)).contains("NotThePlayers"));
    env.take_back(&c, swords[1], p.pubkey()).unwrap();
    assert_eq!(holder(&env, &swords[1]), p.pubkey());

    // The third: no time at all is a hold nobody but the player ever decides.
    env.hold(&p, swords[2], 0).unwrap();
    assert!(err(env.award(&authority, swords[2], killer)).contains("HoldOver"));
    // Neither the owner's pause nor the platform's suspension keeps it from going home.
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(true) }).unwrap();
    let admin = env.admin.insecure_clone();
    env.set_suspended(&admin, true).unwrap();
    env.take_back(&p, swords[2], p.pubkey()).unwrap();
    assert!(err(env.hold(&p, swords[2], 0)).contains("Paused"));

    // A soulbound collectible never moves, so it cannot be held.
    env.set_suspended(&admin, false).unwrap();
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(false) }).unwrap();
    assert!(env.hold(&p, oath, 0).is_err());
    assert_eq!(holder(&env, &oath), p.pubkey());
}

// ================================================================ contests

fn contest(env: &Env, shares: Vec<Share>) -> ContestArgs {
    ContestArgs { sides: 2, closes_at: env.now() + 600, result_by: env.now() + 1_200, shares }
}

/// A match with a 5% rake that is burned. Two players back themselves, and a spectator backs
/// the first. The authority says who won and never touches the pot.
#[test]
fn players_back_a_side_and_the_winners_share_the_pot() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    let (a, b, fan) = (player(&mut env, 1_000), player(&mut env, 1_000), player(&mut env, 1_000));
    let acct = |k: &Keypair| ata(&k.pubkey(), &gold);

    let args = contest(&env, vec![burn(500)]);
    assert!(err(env.open_contest(&owner, 1, gold, args.clone())).contains("NotAuthority"));
    assert!(err(env.open_contest(&authority, 1, gold, ContestArgs { sides: 1, ..args.clone() })).contains("BadContest"));
    assert!(err(env.open_contest(&authority, 1, gold, ContestArgs { result_by: args.closes_at - 1, ..args.clone() })).contains("BadContest"));
    env.open_contest(&authority, 1, gold, args.clone()).unwrap();
    assert!(err(env.open_contest(&authority, 1, gold, args)).contains("ContestOpen"), "one contest at an id");

    env.enter(&a, 1, 0, 100).unwrap();
    env.enter(&b, 1, 1, 100).unwrap();
    env.enter(&fan, 1, 0, 50).unwrap();
    env.enter(&a, 1, 0, 50).unwrap();
    assert!(err(env.enter(&a, 1, 2, 1)).contains("BadContest"));
    assert!(err(env.enter(&a, 1, 0, 0)).contains("ZeroAmount"));
    let state = env.contest(1);
    assert_eq!((state.sides.clone(), state.entries, env.tokens(&env.pot_pda(1))), (vec![200, 100], 3, 300));

    // Nothing is paid, and nothing can be closed, before there is a result.
    assert!(err(env.claim(1, a.pubkey(), 0, acct(&a))).contains("ContestOpen"));
    assert!(err(env.close_contest(1)).contains("ContestOpen"));
    assert!(err(env.decide(&owner, 1, 0)).contains("NotAuthority"));

    env.wait(600);
    assert!(err(env.enter(&fan, 1, 1, 10)).contains("ContestNotOpen"), "entries closed");
    let supply = env.supply(&gold);
    let logs = env.decide(&authority, 1, 0).unwrap();
    let d: Decided = receipt(&logs);
    assert_eq!((d.pot, d.prize, supply - env.supply(&gold)), (300, 285, 15));
    assert!(err(env.decide(&authority, 1, 1)).contains("ContestNotOpen"), "a result is final");
    assert!(err(env.call_off(&authority, 1)).contains("ContestNotOpen"));

    // A winner's money can only go to that winner.
    assert!(err(env.claim(1, a.pubkey(), 0, acct(&b))).contains("NotThePlayers"));
    env.claim(1, a.pubkey(), 0, acct(&a)).unwrap();
    assert_eq!(my(&env, &a, &gold), 850 + 213, "150 of the 200 on the winning side: 285 * 150 / 200, rounded down");
    assert!(err(env.close_contest(1)).contains("EntriesLeft"));
    env.claim(1, b.pubkey(), 1, acct(&b)).unwrap();
    env.claim(1, fan.pubkey(), 0, acct(&fan)).unwrap();
    assert_eq!((my(&env, &b, &gold), my(&env, &fan, &gold)), (900, 950 + 72), "the last winner takes what rounding left");
    assert!(env.claim(1, a.pubkey(), 0, acct(&a)).is_err(), "an entry is claimed once");

    let before = env.lamports(&authority.pubkey());
    env.close_contest(1).unwrap();
    assert!(!env.exists(&env.contest_pda(1)) && !env.exists(&env.pot_pda(1)));
    assert!(env.lamports(&authority.pubkey()) > before, "the rent went back to whoever opened it");
    // The id is free again.
    let again = contest(&env, vec![]);
    env.open_contest(&authority, 1, gold, again).unwrap();
}

/// A contest with no result gives every entry its own money back: the authority calls it off,
/// or anyone does once the result is overdue.
#[test]
fn a_contest_with_no_result_gives_everyone_their_money_back() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let gold = env.mint;
    let (a, b) = (player(&mut env, 1_000), player(&mut env, 1_000));
    let acct = |k: &Keypair| ata(&k.pubkey(), &gold);

    // The authority names a side nobody backed: that is not a result.
    let args = contest(&env, vec![burn(500)]);
    env.open_contest(&authority, 1, gold, args).unwrap();
    env.enter(&a, 1, 0, 100).unwrap();
    env.enter(&b, 1, 0, 300).unwrap();
    assert!(err(env.decide(&authority, 1, 1)).contains("NoWinner"));
    assert!(err(env.call_off(&c, 1)).contains("NotDue"));
    env.call_off(&authority, 1).unwrap();
    assert_eq!(env.contest(1).verdict, Verdict::Off);
    assert!(err(env.enter(&a, 1, 0, 1)).contains("ContestNotOpen"));
    // Even with the game paused and suspended.
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(true) }).unwrap();
    let admin = env.admin.insecure_clone();
    env.set_suspended(&admin, true).unwrap();
    env.claim(1, a.pubkey(), 0, acct(&a)).unwrap();
    env.claim(1, b.pubkey(), 0, acct(&b)).unwrap();
    assert_eq!((my(&env, &a, &gold), my(&env, &b, &gold)), (1_000, 1_000), "no rake on a contest that never happened");
    env.set_suspended(&admin, false).unwrap();
    env.update_game(&owner, GameUpdate { owner: None, authority: None, paused: Some(false) }).unwrap();

    // Tokens someone sent straight to the pot belong to nobody: closing burns them.
    let pot = env.pot_pda(1);
    let stray = spl_transfer(&a, acct(&a), pot, 7);
    env.send(&[stray], &[&a]).unwrap();
    let supply = env.supply(&gold);
    env.close_contest(1).unwrap();
    assert_eq!(supply - env.supply(&gold), 7);

    // The authority goes silent: once the result is overdue, anyone calls it off.
    let args = contest(&env, vec![]);
    env.open_contest(&authority, 2, gold, args).unwrap();
    env.enter(&a, 2, 1, 40).unwrap();
    env.wait(1_200);
    assert!(err(env.call_off(&c, 2)).contains("NotDue"), "not until the promised time has passed");
    env.wait(1);
    env.call_off(&c, 2).unwrap();
    env.claim(2, a.pubkey(), 1, acct(&a)).unwrap();
    assert_eq!(my(&env, &a, &gold), 993);
}

fn spl_transfer(who: &Keypair, from: Pubkey, to: Pubkey, amount: u64) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_spl::token::spl_token::instruction::transfer(&anchor_spl::token::spl_token::ID, &from, &to, &who.pubkey(), &[], amount).unwrap()
}
