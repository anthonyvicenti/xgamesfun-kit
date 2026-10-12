//! Fourth security review of loot 0.3 (2026-10-11): the fixes to the third review's ten
//! findings (commit be6560ec3), and what was added on top without a review: `Need`, `Keep`,
//! `Renew` and `times` on a recipe, the converter's removal, a lottery's `ticket_mint`, and
//! `create_game`'s check of a collection's Core plugins. LiteSVM against the built binary and
//! the real Metaplex Core program.
//!
//! `noted_*` is behaviour the reviewer raised that is by design: what a project's own keys can
//! do (the owner of its collection, its authority). The creator: "we always trust project auth".
//! `fixed_*` is a finding of this review turned round: the attack, which the program now
//! refuses. `sound_*` is an attack the program (or Core) refused from the start.
mod common;

use loot::{state::{DropEntry, Outcome}, BoxArgs};

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::{AccountMeta, Instruction},
        InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    common::*,
    loot::{
        state::{ItemKind, Life, Share, To},
        ContestArgs, Input, ItemArgs, Keep, LotteryArgs, Need, Origin, Output, RecipeArgs, Verdict,
    },
    mpl_core::{
        instructions::*,
        types::{
            BurnDelegate, Creator, ExternalCheckResult, ExternalPluginAdapterInitInfo, FreezeDelegate, HookableLifecycleEvent,
            LifecycleHookInitInfo, OracleInitInfo, PermanentBurnDelegate, PermanentFreezeDelegate, PermanentTransferDelegate, Plugin,
            PluginAuthority, PluginAuthorityPair, PluginType, Royalties, RuleSet, TransferDelegate, UpdateAuthority, UpdateDelegate,
        },
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 24 * 60 * 60;
// Core's errors, as they show in a failed transaction's log.
const CORE_INVALID_AUTHORITY: &str = "custom program error: 0x9";
const CORE_INVALID_COLLECTION: &str = "custom program error: 0x13";
const CORE_NO_APPROVALS: &str = "custom program error: 0x1a";
const CORE_MISSING_ADAPTER_ACCOUNT: &str = "custom program error: 0x22";
const CORE_NOT_AVAILABLE: &str = "custom program error: 0x17";
const CORE_ORACLE_REJECTS_ONLY: &str = "custom program error: 0x23";
const CORE_PERMANENT_DELEGATES: &str = "custom program error: 0x30";

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

/// Every attribute written on an asset, in order.
fn written(env: &Env, asset: &Pubkey) -> Vec<(String, String)> {
    let asset = mpl_core::Asset::from_bytes(&env.data(asset)).unwrap();
    let list = asset.plugin_list.attributes.unwrap().attributes.attribute_list;
    list.into_iter().map(|a| (a.key, a.value)).collect()
}

fn my(env: &Env, who: &Keypair, mint: &Pubkey) -> u64 {
    env.tokens(&ata(&who.pubkey(), mint))
}

fn version(env: &Env, id: u32) -> u32 {
    env.acc::<loot::Recipe>(&env.mechanic_pda(loot::RECIPE_SEED, id)).version
}

fn core_transfer(env: &mut Env, who: &Keypair, asset: Pubkey, collection: Option<Pubkey>, to: Pubkey) -> Result<Vec<String>, String> {
    let ix = TransferV1Builder::new().asset(asset).collection(collection).payer(who.pubkey()).authority(Some(who.pubkey())).new_owner(to).instruction();
    env.send(&[ix], &[who])
}

fn core_burn(env: &mut Env, who: &Keypair, asset: Pubkey, collection: Option<Pubkey>) -> Result<Vec<String>, String> {
    let ix = BurnV1Builder::new().asset(asset).collection(collection).payer(who.pubkey()).authority(Some(who.pubkey())).instruction();
    env.send(&[ix], &[who])
}

/// A royalties plugin whose rule refuses every transfer to or from an account of `program`.
fn royalties_denying(program: Pubkey) -> Plugin {
    Plugin::Royalties(Royalties {
        basis_points: 0,
        creators: vec![Creator { address: Pubkey::new_unique(), percentage: 100 }],
        rule_set: RuleSet::ProgramDenyList(vec![program]),
    })
}

/// An oracle adapter that can refuse transfers, reading `oracle`.
fn oracle_on_transfers(oracle: Pubkey) -> ExternalPluginAdapterInitInfo {
    ExternalPluginAdapterInitInfo::Oracle(OracleInitInfo {
        base_address: oracle,
        init_plugin_authority: None,
        lifecycle_checks: vec![(HookableLifecycleEvent::Transfer, ExternalCheckResult { flags: 4 })], // 4: can reject
        base_address_config: None,
        results_offset: None,
    })
}

/// What an oracle account says: 1 (V1), then create, transfer, burn, update (1 rejected, 2 pass).
fn oracle_says(env: &mut Env, oracle: Pubkey, transfer_rejected: bool) {
    let owner = env.creator.pubkey();
    env.put(oracle, owner, vec![1, 2, if transfer_rejected { 1 } else { 2 }, 2, 2]);
}

/// A second collection of the creator's.
fn new_collection(env: &mut Env, plugins: Vec<Plugin>, adapters: Vec<ExternalPluginAdapterInitInfo>) -> Result<Pubkey, String> {
    let creator = env.creator.insecure_clone();
    let collection = Keypair::new();
    let mut pairs: Vec<PluginAuthorityPair> = plugins.into_iter().map(|plugin| PluginAuthorityPair { plugin, authority: None }).collect();
    let game = pda(&[loot::GAME_SEED, collection.pubkey().as_ref()]);
    pairs.push(PluginAuthorityPair { plugin: Plugin::UpdateDelegate(UpdateDelegate { additional_delegates: vec![game] }), authority: None });
    let mut builder = CreateCollectionV2Builder::new();
    builder.collection(collection.pubkey()).update_authority(Some(creator.pubkey())).payer(creator.pubkey()).name("Other".into()).uri("x".into()).plugins(pairs);
    if !adapters.is_empty() {
        builder.external_plugin_adapters(adapters);
    }
    env.send(&[builder.instruction()], &[&creator, &collection])?;
    Ok(collection.pubkey())
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

/// By design: the project's own keys are trusted (the reviewer rated it high). "A hold always has a way out that needs nobody's permission" is false against
/// whoever controls the game's Core collection (its owner). Core asks the collection's
/// plugins about every transfer of an asset in it, and the collection's update authority can
/// add a `Royalties` plugin with a rule set at any time after `create_game`. A deny list that
/// names the loot program refuses every transfer whose signer or receiver is an account of
/// the loot program: that is exactly the game handing a held collectible back. `take_back`
/// then fails for every held collectible until the owner removes the plugin, while collectibles
/// in wallets still move. The same plugin added to one asset strands only that one.
/// `create_game` also accepts a collection that is born with it. A deny list naming the system
/// program freezes every player's collectible in their own wallet.
#[test]
fn noted_the_collections_owner_stops_every_take_back_with_a_royalties_rule() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let col = env.collection;
    let (p, q) = (player(&mut env, 0), player(&mut env, 0));
    env.upsert_item(80, collectible("Sword")).unwrap();
    let swords: Vec<Pubkey> = (0..4).map(|_| env.make(&authority, 80, p.pubkey()).unwrap()).collect();
    env.hold(&p, swords[0], 10).unwrap();
    env.hold(&p, swords[1], 10_000).unwrap();
    env.wait(11);

    let add = AddCollectionPluginV1Builder::new().collection(col).payer(owner.pubkey()).plugin(royalties_denying(loot::ID)).instruction();
    env.send(&[add], &[&owner]).unwrap();

    // The hold is over and the collectible does not come home.
    assert!(err(env.take_back(&c, swords[0], p.pubkey())).contains(CORE_INVALID_AUTHORITY));
    assert!(err(env.take_back(&p, swords[0], p.pubkey())).contains(CORE_INVALID_AUTHORITY));
    // Nor can the authority give back one whose hold still runs.
    assert!(err(env.award(&authority, swords[1], p.pubkey())).contains(CORE_INVALID_AUTHORITY));
    assert_eq!(holder(&env, &swords[0]), env.game);
    // A collectible in a wallet still moves: only what the game holds is stuck.
    core_transfer(&mut env, &p, swords[2], Some(col), q.pubkey()).unwrap();

    // It comes home when the owner allows it, and only then.
    let remove = RemoveCollectionPluginV1Builder::new().collection(col).payer(owner.pubkey()).plugin_type(PluginType::Royalties).instruction();
    env.send(&[remove], &[&owner]).unwrap();
    env.take_back(&c, swords[0], p.pubkey()).unwrap();

    // The same on one asset only.
    env.hold(&p, swords[3], 0).unwrap();
    let add = AddPluginV1Builder::new().asset(swords[3]).collection(Some(col)).payer(owner.pubkey()).plugin(royalties_denying(loot::ID)).instruction();
    env.send(&[add], &[&owner]).unwrap();
    assert!(err(env.take_back(&c, swords[3], p.pubkey())).contains(CORE_INVALID_AUTHORITY));
    env.hold(&p, swords[0], 0).unwrap();
    env.take_back(&c, swords[0], p.pubkey()).unwrap();

    // A deny list naming the system program: no wallet can send or receive one.
    let add = AddCollectionPluginV1Builder::new().collection(col).payer(owner.pubkey()).plugin(royalties_denying(SYSTEM)).instruction();
    env.send(&[add], &[&owner]).unwrap();
    assert!(err(core_transfer(&mut env, &q, swords[2], Some(col), p.pubkey())).contains(CORE_INVALID_AUTHORITY));

    // And `create_game` takes a collection born with such a rule.
    let mut env = world();
    env.init_platform(FEE).unwrap();
    env.collection = new_collection(&mut env, vec![royalties_denying(loot::ID)], vec![]).unwrap();
    env.game = pda(&[loot::GAME_SEED, env.collection.as_ref()]);
    env.create_game().unwrap();
}

/// By design, as above (rated high). The same, with an oracle. A Core collection can carry external plugin adapters, which
/// `create_game` does not look at (they are in a second registry) and which the update
/// authority can add later anyway. An `Oracle` adapter makes Core read an account its author
/// controls before every transfer. While that account says "rejected", no collectible of the
/// game moves: not in a wallet, not out of a hold. And even while it says "pass", every
/// `take_back`, `award` and `hold` fails, because Core then requires the oracle account in the
/// transaction and those instructions pass none on.
#[test]
fn noted_an_oracle_on_the_collection_stops_every_take_back_even_while_it_passes() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let col = env.collection;
    let (p, q) = (player(&mut env, 0), player(&mut env, 0));
    env.upsert_item(80, collectible("Sword")).unwrap();
    let held = env.make(&authority, 80, p.pubkey()).unwrap();
    let loose = env.make(&authority, 80, p.pubkey()).unwrap();
    env.hold(&p, held, 10).unwrap();
    env.wait(11);

    let oracle = Pubkey::new_unique();
    oracle_says(&mut env, oracle, true);
    let add = AddCollectionExternalPluginAdapterV1Builder::new().collection(col).payer(owner.pubkey()).init_info(oracle_on_transfers(oracle)).instruction();
    env.send(&[add], &[&owner]).unwrap();

    // Rejected: a player cannot move their own collectible.
    let mut transfer = TransferV1Builder::new().asset(loose).collection(Some(col)).payer(p.pubkey()).new_owner(q.pubkey()).instruction();
    transfer.accounts.push(AccountMeta::new_readonly(oracle, false));
    assert!(err(env.send(&[transfer.clone()], &[&p])).contains(CORE_INVALID_AUTHORITY));
    assert!(err(env.take_back(&c, held, p.pubkey())).contains(CORE_MISSING_ADAPTER_ACCOUNT));

    // Pass: the wallet transfer works, with the oracle account in the transaction.
    oracle_says(&mut env, oracle, false);
    env.send(&[transfer], &[&p]).unwrap();
    // The program's own transfers have no place for that account.
    assert!(err(env.take_back(&c, held, p.pubkey())).contains(CORE_MISSING_ADAPTER_ACCOUNT));
    assert!(err(env.hold(&q, loose, 0)).contains(CORE_MISSING_ADAPTER_ACCOUNT));
    assert_eq!(holder(&env, &held), env.game);

    // `create_game` takes a collection born with an oracle.
    let mut env = world();
    env.init_platform(FEE).unwrap();
    env.collection = new_collection(&mut env, vec![], vec![oracle_on_transfers(oracle)]).unwrap();
    env.game = pda(&[loot::GAME_SEED, env.collection.as_ref()]);
    env.create_game().unwrap();
}

/// By design, as above (rated high). A third way, with no plugin at all. The collection's update authority can take any
/// asset out of the collection with Core's `UpdateV2`, whoever owns it. A held collectible that
/// is no longer in the game's collection can never be handed back: `take_back` names the game's
/// collection, and Core refuses the pair. A collectible in a wallet that is taken out stops
/// being one of its item for every recipe (and can no longer be held).
#[test]
fn noted_the_collections_owner_takes_a_held_collectible_out_of_the_collection() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let col = env.collection;
    let p = player(&mut env, 0);
    env.upsert_item(80, collectible("Sword")).unwrap();
    env.upsert_item(81, collectible("Blade")).unwrap();
    env.upsert_recipe(&owner, 1, merge_recipe(80, 1, 81)).unwrap();
    let held = env.make(&authority, 80, p.pubkey()).unwrap();
    let loose = env.make(&authority, 80, p.pubkey()).unwrap();
    env.hold(&p, held, 10).unwrap();
    env.wait(11);

    for asset in [held, loose] {
        let out = UpdateV2Builder::new()
            .asset(asset)
            .collection(Some(col))
            .payer(owner.pubkey())
            .new_update_authority(UpdateAuthority::Address(owner.pubkey()))
            .instruction();
        env.send(&[out], &[&owner]).unwrap();
    }

    assert!(err(env.take_back(&c, held, p.pubkey())).contains(CORE_INVALID_COLLECTION));
    assert_eq!(holder(&env, &held), env.game, "it stays with the game for good");
    assert!(err(env.craft(&p, 1, &[loose])).contains("ItemMismatch"), "the player's sword is no sword any more");
    assert!(env.hold(&p, loose, 0).is_err());
    // The owner cannot take it for themselves this way (see the `sound_` test below).
    assert!(err(core_transfer(&mut env, &owner, held, None, owner.pubkey())).contains(CORE_NO_APPROVALS));
}

/// By design, as above (rated medium). All three ways above are open to every update delegate of the collection, not only
/// its update authority. The game itself has to be one (that is how it mints), and
/// `create_game` neither checks who else is, nor can it stop the owner adding one later: a
/// server key that was only meant to edit metadata can strand every held collectible.
#[test]
fn noted_any_update_delegate_of_the_collection_can_stop_take_back_too() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let (col, game) = (env.collection, env.game);
    let p = player(&mut env, 0);
    let delegate = player(&mut env, 0);
    env.upsert_item(80, collectible("Sword")).unwrap();
    let held = env.make(&authority, 80, p.pubkey()).unwrap();
    env.hold(&p, held, 0).unwrap();

    let delegates = Plugin::UpdateDelegate(UpdateDelegate { additional_delegates: vec![game, delegate.pubkey()] });
    let name = UpdateCollectionPluginV1Builder::new().collection(col).payer(owner.pubkey()).plugin(delegates).instruction();
    env.send(&[name], &[&owner]).unwrap();

    let add = AddCollectionPluginV1Builder::new().collection(col).payer(delegate.pubkey()).plugin(royalties_denying(loot::ID)).instruction();
    env.send(&[add], &[&delegate]).unwrap();
    assert!(err(env.take_back(&c, held, p.pubkey())).contains(CORE_INVALID_AUTHORITY));
}

/// MEDIUM, fixed. A recipe recognised a collectible by its name alone, and an admin can write
/// a new item with the name of an existing one and sell it for next to nothing: what it sold
/// was, to every recipe, the real thing, and an admin emptied a pool through the owner's own
/// recipe. Now a recipe also reads the item number written on the collectible, which `set`
/// never changes.
#[test]
fn fixed_an_item_with_anothers_name_is_not_taken_for_it() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    env.open_pool(&owner, 0, gold).unwrap();
    let funder = player(&mut env, 10_000);
    env.deposit(&funder, 0, gold, 10_000).unwrap();
    env.upsert_item(30, collectible("Fish")).unwrap(); // not for sale: the game hands fish out
    let salvage = recipe(vec![Input::Burn { item: 30, count: 1 }], vec![Output::Tokens { mint: gold, amount: 5_000, from: Origin::Pool(0) }]);
    env.upsert_recipe(&owner, 1, salvage).unwrap();

    let admin = env.player.insecure_clone();
    // (When this was found an admin could write the look-alike. A game has no admins now, so
    // here the owner makes the mistake of two items with one name.)
    let fake = ItemArgs { shares: vec![], ..item(ItemKind::Collectible, "Fish", 0, 1) };
    assert!(err(env.upsert_item_as(&admin, 999, fake.clone())).contains("NotOwner"));
    env.upsert_item(999, fake).unwrap();

    env.buy(999, 1).unwrap();
    let order = order_pda(&env.game, &admin.pubkey(), 1);
    let fish = env.asset_pda(&order);
    env.settle(order, &admin).unwrap();
    assert!(err(env.craft(&admin, 1, &[fish])).contains("ItemMismatch"));
    // Nor after the authority writes on it: which item a collectible is never changes.
    env.set(&authority, fish, &[("item_id", "30"), ("level", "2")]).unwrap();
    assert!(err(env.craft(&admin, 1, &[fish])).contains("ItemMismatch"));
    assert_eq!(env.tokens(&pool_pda(&env.game, 0)), 10_000);

    let real = env.make(&authority, 30, admin.pubkey()).unwrap();
    env.craft(&admin, 1, &[real]).unwrap();
}

/// MEDIUM, fixed. The third review's finding 6 was closed by burning a `Holder` share nobody
/// holds, and wrapped SOL cannot be burned: in wrapped SOL the holder of a named collectible
/// could stop a contest's result (or a box's settles) for good by burning the collectible. Now
/// a split that is carried out later takes no share that burns when it is in wrapped SOL.
#[test]
fn fixed_a_later_split_in_wrapped_sol_has_no_share_that_burns() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let landlord = player(&mut env, 0);
    let wsol = wrapped_sol(&mut env, &landlord.pubkey(), 1_000);
    env.upsert_item(50, collectible("Arena")).unwrap();
    let arena = env.make(&authority, 50, landlord.pubkey()).unwrap();
    let contest = |shares| ContestArgs { sides: 2, closes_at: 600, result_by: 1_200, shares };
    for to in [To::Holder(arena), To::Burn] {
        let e = err(env.open_contest(&authority, 1, wsol, contest(vec![Share { to, bps: 500 }])));
        assert!(e.contains("BadShares") || e.contains("BadContest"), "{e}");
    }
    let nothing = vec![DropEntry { outcome: Outcome::Nothing, weight: 1 }];
    let wsol_box = |shares, entries| BoxArgs { price: 10, currency: Some(wsol), rise: None, fall: None, stock_odds: false, active: true, shares, entries };
    for to in [To::Holder(arena), To::Burn] {
        assert!(err(env.upsert_box_args(5, wsol_box(vec![Share { to, bps: 10_000 }], nothing.clone()))).contains("BadShares"));
    }
    let burns = vec![DropEntry { outcome: Outcome::Burn, weight: 1 }];
    assert!(err(env.upsert_box_args(5, wsol_box(vec![pool(0, 10_000)], burns))).contains("BadEntries"));
    env.upsert_box_args(5, wsol_box(vec![pool(0, 10_000)], nothing)).unwrap();
    env.open_contest(&authority, 1, wsol, contest(vec![pool(0, 500)])).unwrap();
}

// ================================================================ smaller ones, fixed

/// By design. A contest's shares are written by the authority and can pay an account or a
/// holder (the arena's owner). The reviewer raised it because the third review's fix 4 lets
/// only the owner write such a share on an item; that rule is about admins. The authority is
/// one of the project's own keys, which the program trusts, and every entry signs the terms.
#[test]
fn noted_the_authority_writes_a_contests_shares_and_every_entry_signs_them() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let gold = env.mint;
    let (a, b) = (player(&mut env, 100), player(&mut env, 100));
    let arena_owner = env.token_account(Keypair::new().pubkey(), gold);
    let args = ContestArgs { sides: 2, closes_at: env.now() + 600, result_by: env.now() + 1_200, shares: vec![Share { to: To::Account(arena_owner), bps: 1_000 }] };
    env.open_contest(&authority, 1, gold, args).unwrap();
    env.enter(&a, 1, 0, 100).unwrap();
    env.enter(&b, 1, 1, 100).unwrap();
    env.decide(&authority, 1, 0).unwrap();
    env.claim(1, a.pubkey(), 0, ata(&a.pubkey(), &gold)).unwrap();
    assert_eq!((env.tokens(&arena_owner), my(&env, &a, &gold)), (20, 180));
}

/// NOTE, fixed. `Renew` set `used` to 0, and `Use` only checked the cooldown when `used` was
/// not 0, so a renewal was also a skipped cooldown. Now the cooldown counts from the last use
/// whatever the count says: a repair is not a turn.
#[test]
fn fixed_a_renew_does_not_skip_the_cooldown() {
    let mut env = setup();
    env.wait(1_700_000_000);
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let ore = env.new_mint(env.game);
    let p = player(&mut env, 0);
    env.token_account(p.pubkey(), ore);
    env.upsert_item(60, ItemArgs { life: Some(Life { ready_after: 0, lasts: 0, uses: 2, cooldown: DAY as u32 }), ..collectible("Mine") }).unwrap();
    env.upsert_recipe(&owner, 1, recipe(vec![Input::Use { item: 60 }], vec![Output::Tokens { mint: ore, amount: 1, from: Origin::Issue }])).unwrap();
    env.upsert_recipe(&owner, 2, recipe(vec![Input::Renew { item: 60 }], vec![])).unwrap();
    let mine = env.make(&authority, 60, p.pubkey()).unwrap();

    env.craft(&p, 1, &[mine]).unwrap();
    env.craft(&p, 2, &[mine]).unwrap();
    assert!(err(env.craft(&p, 1, &[mine])).contains("NotReady"), "renewed, and still once a day");
    for _ in 0..3 {
        env.wait(DAY);
        env.craft(&p, 1, &[mine]).unwrap();
        env.craft(&p, 2, &[mine]).unwrap();
    }
    assert_eq!(my(&env, &p, &ore), 4, "a renewal lifts the count of uses, never the wait");
}

/// NOTE, fixed. Two `Keep`s of one key into the same new collectible wrote the key twice, and
/// everything that reads a number read the first. Now a recipe keeps a key once per collectible.
#[test]
fn fixed_a_recipe_keeps_a_key_once_for_each_new_collectible() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    env.upsert_item(74, collectible("Mare")).unwrap();
    env.upsert_item(75, collectible("Stud")).unwrap();
    env.upsert_item(76, collectible("Foal")).unwrap();
    let breed = |keeps| RecipeArgs { keeps, ..recipe(vec![Input::Use { item: 74 }, Input::Use { item: 75 }], vec![Output::Item(76), Output::Item(76)]) };
    let keep = |from, to| Keep { key: "speed".into(), from, to };
    assert!(err(env.upsert_recipe(&owner, 1, breed(vec![keep(0, 0), keep(1, 0)]))).contains("BadRecipe"));
    env.upsert_recipe(&owner, 1, breed(vec![keep(0, 0), keep(1, 1)])).unwrap();
}

// ================================================================ sound

/// The collection-plugin question, the part that holds. After `create_game` nobody can give the
/// collection, or an asset in it, a plugin that moves or burns what someone else owns: Core
/// refuses a permanent freeze, transfer or burn delegate anywhere but at creation, refuses an
/// owner's freeze, transfer or burn delegate on a collection at all, refuses it on an asset to
/// anyone but the asset's owner, refuses to move an asset into a collection that has permanent
/// delegates, and refuses a lifecycle hook. So the owner can strand a collectible (the findings
/// above) but cannot take or burn one: not from a wallet, not from the game.
#[test]
fn sound_nothing_added_after_create_game_moves_or_burns_a_collectible() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let col = env.collection;
    let p = player(&mut env, 0);
    env.upsert_item(80, collectible("Sword")).unwrap();
    let held = env.make(&authority, 80, p.pubkey()).unwrap();
    let loose = env.make(&authority, 80, p.pubkey()).unwrap();
    env.hold(&p, held, 10).unwrap();
    env.wait(11);

    let seizing = || {
        vec![
            Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true }),
            Plugin::PermanentTransferDelegate(PermanentTransferDelegate {}),
            Plugin::PermanentBurnDelegate(PermanentBurnDelegate {}),
            Plugin::FreezeDelegate(FreezeDelegate { frozen: true }),
            Plugin::TransferDelegate(TransferDelegate {}),
            Plugin::BurnDelegate(BurnDelegate {}),
        ]
    };
    for plugin in seizing() {
        let add = AddCollectionPluginV1Builder::new().collection(col).payer(owner.pubkey()).plugin(plugin).instruction();
        assert!(err(env.send(&[add], &[&owner])).contains(CORE_INVALID_AUTHORITY));
    }
    for asset in [held, loose] {
        for plugin in seizing() {
            let add = AddPluginV1Builder::new().asset(asset).collection(Some(col)).payer(owner.pubkey()).plugin(plugin).instruction();
            assert!(env.send(&[add], &[&owner]).is_err());
        }
    }
    let hook = ExternalPluginAdapterInitInfo::LifecycleHook(LifecycleHookInitInfo {
        hooked_program: owner.pubkey(),
        init_plugin_authority: None,
        lifecycle_checks: vec![(HookableLifecycleEvent::Transfer, ExternalCheckResult { flags: 2 })], // 2: can approve
        extra_accounts: None,
        data_authority: None,
        schema: None,
    });
    let add = AddCollectionExternalPluginAdapterV1Builder::new().collection(col).payer(owner.pubkey()).init_info(hook).instruction();
    assert!(err(env.send(&[add], &[&owner])).contains(CORE_NOT_AVAILABLE));
    // An oracle can refuse and never approve.
    let mut approving = oracle_on_transfers(Pubkey::new_unique());
    if let ExternalPluginAdapterInitInfo::Oracle(oracle) = &mut approving {
        oracle.lifecycle_checks[0].1.flags = 2;
    }
    let add = AddCollectionExternalPluginAdapterV1Builder::new().collection(col).payer(owner.pubkey()).init_info(approving).instruction();
    assert!(err(env.send(&[add], &[&owner])).contains(CORE_ORACLE_REJECTS_ONLY));

    // Into a collection of the owner's that was born with permanent delegates.
    let trap = new_collection(&mut env, vec![Plugin::PermanentTransferDelegate(PermanentTransferDelegate {}), Plugin::PermanentBurnDelegate(PermanentBurnDelegate {})], vec![]).unwrap();
    for asset in [held, loose] {
        let moved = UpdateV2Builder::new()
            .asset(asset)
            .collection(Some(col))
            .payer(owner.pubkey())
            .new_collection(Some(trap))
            .new_update_authority(UpdateAuthority::Collection(trap))
            .instruction();
        assert!(err(env.send(&[moved], &[&owner])).contains(CORE_PERMANENT_DELEGATES));
        assert!(core_transfer(&mut env, &owner, asset, Some(col), owner.pubkey()).is_err());
        assert!(core_burn(&mut env, &owner, asset, Some(col)).is_err());
    }
    env.take_back(&c, held, p.pubkey()).unwrap();
    assert_eq!((holder(&env, &held), holder(&env, &loose)), (p.pubkey(), p.pubkey()));
}

/// `create_game` refuses a collection born with a permanent freeze, transfer or burn delegate,
/// and Core refuses to create a collection with an owner's delegate.
#[test]
fn sound_create_game_refuses_a_collection_born_able_to_seize() {
    let permanent = [
        Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: false }),
        Plugin::PermanentTransferDelegate(PermanentTransferDelegate {}),
        Plugin::PermanentBurnDelegate(PermanentBurnDelegate {}),
    ];
    for plugin in permanent {
        let mut env = world();
        env.init_platform(FEE).unwrap();
        env.collection = new_collection(&mut env, vec![plugin], vec![]).unwrap();
        env.game = pda(&[loot::GAME_SEED, env.collection.as_ref()]);
        assert!(err(env.create_game()).contains("CollectionCanSeize"));
    }
    let mut env = world();
    for plugin in [Plugin::FreezeDelegate(FreezeDelegate { frozen: true }), Plugin::TransferDelegate(TransferDelegate {}), Plugin::BurnDelegate(BurnDelegate {})] {
        assert!(err(new_collection(&mut env, vec![plugin], vec![])).contains(CORE_INVALID_AUTHORITY));
    }
}

/// The third review could not check a delegate and a hold. A player's own transfer, burn and
/// freeze delegates end when the collectible goes to the game: the delegate cannot pull it out
/// of a hold, burn it there, or freeze it so that it never comes back. A delegate can itself
/// start a hold, and then the collectible comes back to the delegate: no more than the
/// transfer it could already make.
#[test]
fn sound_a_players_delegates_do_not_reach_into_a_hold() {
    let mut env = setup();
    let (authority, c) = (env.authority.insecure_clone(), env.cranker.insecure_clone());
    let col = env.collection;
    let p = player(&mut env, 0);
    let friend = player(&mut env, 0);
    env.upsert_item(80, collectible("Sword")).unwrap();
    let sword = env.make(&authority, 80, p.pubkey()).unwrap();
    let delegates = |env: &mut Env, p: &Keypair| {
        for plugin in [Plugin::TransferDelegate(TransferDelegate {}), Plugin::BurnDelegate(BurnDelegate {}), Plugin::FreezeDelegate(FreezeDelegate { frozen: false })] {
            let add = AddPluginV1Builder::new().asset(sword).collection(Some(col)).payer(p.pubkey()).plugin(plugin).init_authority(PluginAuthority::Address { address: friend.pubkey() }).instruction();
            env.send(&[add], &[p]).unwrap();
        }
    };
    delegates(&mut env, &p);
    env.hold(&p, sword, 1_000).unwrap();

    assert!(err(core_transfer(&mut env, &friend, sword, Some(col), friend.pubkey())).contains(CORE_NO_APPROVALS));
    assert!(err(core_burn(&mut env, &friend, sword, Some(col))).contains(CORE_NO_APPROVALS));
    let freeze = UpdatePluginV1Builder::new().asset(sword).collection(Some(col)).payer(friend.pubkey()).plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true })).instruction();
    assert!(err(env.send(&[freeze], &[&friend])).contains(CORE_NO_APPROVALS));
    env.wait(1_000);
    env.take_back(&c, sword, p.pubkey()).unwrap();
    assert_eq!(holder(&env, &sword), p.pubkey());

    // The delegate's own hold: the collectible returns to the delegate.
    let plugins = [PluginType::TransferDelegate, PluginType::BurnDelegate, PluginType::FreezeDelegate];
    for plugin_type in plugins {
        let remove = RemovePluginV1Builder::new().asset(sword).collection(Some(col)).payer(p.pubkey()).plugin_type(plugin_type).instruction();
        env.send(&[remove], &[&p]).unwrap();
    }
    delegates(&mut env, &p);
    env.hold(&friend, sword, 0).unwrap();
    assert!(err(env.take_back(&c, sword, p.pubkey())).contains("NotThePlayers"));
    env.take_back(&c, sword, friend.pubkey()).unwrap();
}

/// `times` and the converter's removal. An exchange is a recipe of tokens crafted `times` over.
/// What the converter's `min_out` gave, the signed version gives: an edit of the rate that lands
/// first fails the craft. Amounts are multiplied with a check, a recipe with a collectible on
/// either side is crafted once, a pool in the place of the recipe's pool is refused, and a pool
/// that cannot pay the whole of it pays none of it.
#[test]
fn sound_an_exchange_is_a_recipe_crafted_many_times_at_the_rate_the_player_signed() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    let gems = env.new_mint(owner.pubkey());
    let points = env.new_mint(env.game);
    env.open_pool(&owner, 0, gold).unwrap();
    env.open_pool(&owner, 1, gold).unwrap();
    let funder = player(&mut env, 2_000);
    env.deposit(&funder, 0, gold, 1_000).unwrap();
    env.deposit(&funder, 1, gold, 1_000).unwrap();
    let p = player(&mut env, 0);
    env.fund(p.pubkey(), gems, 1_000);
    env.token_account(p.pubkey(), points);

    let rate = |out| recipe(vec![Input::Pay { mint: gems, amount: 2, to: To::Burn }], vec![Output::Tokens { mint: points, amount: out, from: Origin::Issue }]);
    env.upsert_recipe(&owner, 1, rate(3)).unwrap();
    assert!(err(env.craft_times(&p, 1, 0, &[])).contains("ZeroAmount"));
    assert!(err(env.craft_times(&p, 1, u64::MAX, &[])).contains("Overflow"));
    assert!(env.craft_times(&p, 1, 501, &[]).is_err(), "1,002 gems are not there");
    env.craft_times(&p, 1, 100, &[]).unwrap();
    assert_eq!((my(&env, &p, &gems), my(&env, &p, &points)), (800, 300));

    // The owner cuts the rate while the player's transaction is on its way.
    let (mut signed, _) = env.craft_ix(p.pubkey(), 1, version(&env, 1), &[]);
    signed.data = loot::instruction::Craft { version: version(&env, 1), times: 100 }.data();
    env.upsert_recipe(&owner, 1, rate(1)).unwrap();
    assert!(err(env.send(&[signed], &[&p])).contains("RecipeChanged"));
    assert_eq!(my(&env, &p, &gems), 800);

    // From a pool: all of it or none, and only the pool the recipe names.
    env.upsert_recipe(&owner, 2, recipe(vec![Input::Pay { mint: gems, amount: 1, to: To::Burn }], vec![Output::Tokens { mint: gold, amount: 300, from: Origin::Pool(0) }])).unwrap();
    assert!(env.craft_times(&p, 2, 4, &[]).is_err(), "the pool holds 1,000");
    let (mut ix, _) = env.craft_ix(p.pubkey(), 2, version(&env, 2), &[]);
    ix.accounts.iter_mut().filter(|m| m.pubkey == pool_pda(&env.game, 0)).for_each(|m| m.pubkey = pool_pda(&env.game, 1));
    assert!(err(env.send(&[ix], &[&p])).contains("WrongPool"));
    env.craft_times(&p, 2, 3, &[]).unwrap();
    assert_eq!((my(&env, &p, &gems), my(&env, &p, &gold), env.tokens(&pool_pda(&env.game, 1))), (797, 900, 1_000));

    // A collectible on either side: once at a time.
    env.upsert_item(30, collectible("Fish")).unwrap();
    env.upsert_recipe(&owner, 3, recipe(vec![Input::Pay { mint: gems, amount: 1, to: To::Burn }], vec![Output::Item(30)])).unwrap();
    env.upsert_recipe(&owner, 4, recipe(vec![Input::Use { item: 30 }], vec![Output::Tokens { mint: points, amount: 1, from: Origin::Issue }])).unwrap();
    let fish = env.make(&authority, 30, p.pubkey()).unwrap();
    assert!(err(env.craft_times(&p, 3, 2, &[])).contains("OnceAtATime"));
    assert!(err(env.craft_times(&p, 4, 2, &[fish])).contains("OnceAtATime"));
}

/// `Need` and `Keep`. A need is read from the collectible in its own place and nowhere else, a
/// value that is not a number is 0, a player cannot write one, and a recipe cannot be written
/// to carry the program's own numbers (`made`, `used`, `used_at`, the serial) to a new
/// collectible, or to name a place it does not have.
#[test]
fn sound_a_need_is_read_from_its_own_place_and_a_keep_never_carries_the_programs_numbers() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let col = env.collection;
    let p = player(&mut env, 0);
    env.upsert_item(40, collectible("Hero")).unwrap();
    env.upsert_item(41, collectible("Sword")).unwrap();
    env.upsert_item(42, collectible("Medal")).unwrap();
    let quest = |needs, keeps| RecipeArgs { needs, keeps, ..recipe(vec![Input::Use { item: 40 }, Input::Burn { item: 41, count: 2 }], vec![Output::Item(42)]) };
    let need = |place, at_least| Need { place, key: "level".into(), at_least };
    let keep = |key: &str, from, to| Keep { key: key.into(), from, to };

    for bad in [vec![need(3, 1)], vec![Need { place: 0, key: "".into(), at_least: 1 }]] {
        assert!(err(env.upsert_recipe(&owner, 1, quest(bad, vec![]))).contains("BadRecipe"));
    }
    for bad in [keep("made", 0, 0), keep("used", 0, 0), keep("used_at", 0, 0), keep("serial", 0, 0), keep("item_id", 0, 0), keep("level", 3, 0), keep("level", 0, 1)] {
        assert!(err(env.upsert_recipe(&owner, 1, quest(vec![], vec![bad]))).contains("BadRecipe"));
    }
    // The hero of level 10, and the second sword of level 2.
    env.upsert_recipe(&owner, 1, quest(vec![need(0, 10), need(2, 2)], vec![keep("level", 0, 0)])).unwrap();
    let hero = env.make(&authority, 40, p.pubkey()).unwrap();
    let swords: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 41, p.pubkey()).unwrap()).collect();

    assert!(err(env.craft(&p, 1, &[hero, swords[0], swords[1]])).contains("NeedNotMet"), "nothing written");
    // The player cannot write a level: the attribute list is the collection's.
    let forge = UpdatePluginV1Builder::new()
        .asset(hero)
        .collection(Some(col))
        .payer(p.pubkey())
        .plugin(Plugin::Attributes(mpl_core::types::Attributes { attribute_list: vec![mpl_core::types::Attribute { key: "level".into(), value: "99".into() }] }))
        .instruction();
    assert!(err(env.send(&[forge], &[&p])).contains(CORE_NO_APPROVALS));

    env.set(&authority, hero, &[("level", "ten")]).unwrap();
    env.set(&authority, swords[0], &[("level", "50")]).unwrap();
    assert!(err(env.craft(&p, 1, &[hero, swords[0], swords[1]])).contains("NeedNotMet"), "not a number");
    env.set(&authority, hero, &[("level", "10")]).unwrap();
    assert!(err(env.craft(&p, 1, &[hero, swords[0], swords[1]])).contains("NeedNotMet"), "the level is on the first sword, asked of the second");
    let medal = env.craft(&p, 1, &[hero, swords[1], swords[0]]).unwrap()[0];
    let on_medal = written(&env, &medal);
    assert!(on_medal.contains(&("level".into(), "10".into())) && on_medal.iter().filter(|(key, _)| key == "made").count() == 1);
    assert!(alive(&env, &hero) && !alive(&env, &swords[0]));
}

/// A lottery's `ticket_mint`. Tickets are burned from the player's own account of that mint and
/// from nowhere else: leaving the mint out, naming another, or paying from an account of the
/// pot's token are all refused, the pot is never touched by a purchase, and the owner cannot
/// switch the lottery to another ticket while tickets of the round are out.
#[test]
fn sound_a_lotterys_tickets_in_another_mint_are_burned_from_the_buyer_only() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let gold = env.mint;
    let kills = env.new_mint(owner.pubkey());
    let other = env.new_mint(owner.pubkey());
    env.open_pool(&owner, 0, gold).unwrap();
    let p = player(&mut env, 500);
    env.deposit(&p, 0, gold, 400).unwrap();
    env.fund(p.pubkey(), kills, 10);
    env.fund(p.pubkey(), other, 10);
    let args = LotteryArgs { price: 1, pot: 0, cut_bps: 0, places: vec![], ticket_mint: kills, every: DAY, draws_at: env.now() + DAY };
    env.upsert_lottery(&owner, 1, args.clone()).unwrap();

    let buy = |env: &Env, from: Pubkey, ticket_mint: Option<Pubkey>| {
        Instruction::new_with_bytes(
            loot::ID,
            &loot::instruction::BuyTickets { count: 5, max_price: 1 }.data(),
            loot::accounts::BuyTickets {
                player: p.pubkey(),
                game: env.game,
                lottery: env.mechanic_pda(loot::LOTTERY_SEED, 1),
                player_token: from,
                pot: pool_pda(&env.game, 0),
                treasury: env.treasury,
                mint: ticket_mint.unwrap_or(gold),
                token_program: spl_token::ID,
                token_2022_program: loot::tokens::TOKEN_2022_ID,
                fee: env.fee(),
            }
            .to_account_metas(None),
        )
    };
    let (in_kills, in_gold, in_other) = (ata(&p.pubkey(), &kills), ata(&p.pubkey(), &gold), ata(&p.pubkey(), &other));
    let attempts = [(in_kills, None), (in_kills, Some(other)), (in_other, Some(other)), (in_gold, Some(kills)), (in_other, Some(kills)), (in_gold, None)];
    for (from, mint) in attempts {
        let ix = buy(&env, from, mint);
        assert!(env.send(&[ix], &[&p]).is_err());
    }
    assert_eq!((env.lottery(1).sold, env.tokens(&pool_pda(&env.game, 0)), my(&env, &p, &gold)), (0, 400, 100));

    let ix = buy(&env, in_kills, Some(kills));
    env.send(&[ix], &[&p]).unwrap();
    assert_eq!((env.lottery(1).sold, env.supply(&kills), env.tokens(&pool_pda(&env.game, 0))), (5, 5, 400));
    assert!(err(env.upsert_lottery(&owner, 1, LotteryArgs { ticket_mint: other, ..args })).contains("RoundRunning"));
}

/// The third review's fixes 3 and 8, at their edges. A result is taken up to and including the
/// second it was due and a stranger's `call_off` only after it, so there is no second in which
/// both work or neither does. The terms an entry signs name the token as well: the same
/// numbers in another mint are other terms.
#[test]
fn sound_a_result_and_a_call_off_never_share_a_second_and_terms_name_the_mint() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let gold = env.mint;
    let gems = env.new_mint(owner.pubkey());
    let a = player(&mut env, 200);
    let args = ContestArgs { sides: 2, closes_at: env.now() + 600, result_by: env.now() + 1_200, shares: vec![] };
    for id in [1, 2] {
        env.open_contest(&authority, id, gold, args.clone()).unwrap();
        env.enter(&a, id, 0, 100).unwrap();
    }
    env.open_contest(&authority, 3, gems, args.clone()).unwrap();
    assert_ne!(env.contest(1).terms, env.contest(3).terms);
    assert_eq!(env.contest(1).terms, env.contest(2).terms);

    env.wait(1_200);
    assert!(err(env.call_off(&c, 1)).contains("NotDue"));
    env.decide(&authority, 1, 0).unwrap();
    env.wait(1);
    assert!(err(env.decide(&authority, 2, 0)).contains("ResultOverdue"));
    env.call_off(&c, 2).unwrap();
    assert_eq!((env.contest(1).verdict, env.contest(2).verdict), (Verdict::Won, Verdict::Off));
}
