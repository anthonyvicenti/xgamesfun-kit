//! What each instruction costs: compute units, and the rent of what it creates. `COSTS.md` is
//! written from this output.
//!
//!   cargo test --test costs -- --nocapture
mod common;

use {
    common::*,
    loot::state::{ItemKind, Order, Platform},
    loot::ItemArgs,
    solana_signer::Signer,
};

#[test]
fn cost_table() {
    let mut env = setup();
    let (owner, authority, keeper, admin) =
        (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone(), env.admin.insecure_clone());
    let player = env.player.pubkey();
    let player_token = ata(&player, &env.mint);

    // Settings.
    env.open_pool(&owner, 0, env.mint).unwrap();
    env.open_pool(&owner, 1, env.mint).unwrap();
    env.upsert_item(8, ItemArgs { burnable: true, ..item(ItemKind::Collectible, "Arena Ticket", 0, PRICE) }).unwrap();
    env.upsert_box(1, PRICE, vec![pool(0, 5_000), burn(1_000)], vec![item_drop(1, 1), item_drop(2, 1)]).unwrap();

    // In.
    env.pay(PRICE, vec![]).unwrap();
    env.cus.last_mut().unwrap().0 = "Pay (all to the treasury)".into();
    env.pay(PRICE, vec![pool(0, 7_000), pool(1, 1_000), burn(500)]).unwrap();
    env.cus.last_mut().unwrap().0 = "Pay (two pools, a burn, the treasury)".into();
    env.fund(owner.pubkey(), env.mint, PRICE);
    env.deposit(&owner, 0, env.mint, PRICE).unwrap();
    env.open_box(1, 1).unwrap();
    let order = order_pda(&env.game, &player, 1);
    env.callback(order, rnd(0)).unwrap();
    env.settle(order, &keeper).unwrap();
    env.cus.last_mut().unwrap().0 = "Settle (a collectible, one pool, a burn)".into();
    env.buy(8, 2).unwrap();
    env.open_box(1, 3).unwrap();
    env.wait_slots(loot::STALE_SLOTS + 1);
    env.refund(order_pda(&env.game, &player, 3)).unwrap();

    // Out and make.
    env.payout(&authority, 0, player_token, PRICE).unwrap();
    let points = env.new_mint(env.game);
    let to = env.token_account(player, points);
    env.issue(&authority, points, to, 100).unwrap();
    let ticket = env.make(&authority, 8, player).unwrap();
    env.set(&authority, ticket, &[("level", "7")]).unwrap();
    env.unmake(&authority, ticket).unwrap();

    // Platform.
    env.set_fee(2 * FEE).unwrap();
    env.set_suspended(&admin, true).unwrap();

    println!("\n| Instruction | Compute units |\n| --- | ---: |");
    let mut seen = std::collections::BTreeMap::new();
    for (name, cu) in &env.cus {
        let slot = seen.entry(name.clone()).or_insert(0u64);
        *slot = (*slot).max(*cu);
    }
    for (name, cu) in seen {
        println!("| `{name}` | {cu} |");
    }

    println!("\n| Account | Bytes | Rent, lamports |\n| --- | ---: | ---: |");
    let sizes = [
        ("Platform", env.data(&platform_pda()).len()),
        ("Game", env.data(&env.game).len()),
        ("Item (11-character name, 40-character URI, one share)", env.data(&item_pda(&env.game, 1)).len()),
        ("Box (2 entries, 2 shares)", env.data(&box_pda(&env.game, 1)).len()),
        ("Order", Order::SPACE),
        ("Pool", env.data(&pool_pda(&env.game, 0)).len()),
    ];
    for (name, len) in sizes {
        println!("| {name} | {len} | {} |", env.rent(len));
    }
    assert_eq!(env.data(&platform_pda()).len(), Platform::SPACE);
}
