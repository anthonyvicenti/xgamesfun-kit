//! Third security review of loot 0.3: what was added on 2026-10-11 (the general recipe, share
//! destinations `Account` and `Holder`, a rising price, a collectible's life, a box in another
//! currency, holds, contests). LiteSVM against the built binary.
//!
//! The reviewer wrote each finding as a test of the bad behaviour. After the fixes each one is
//! turned round: `fixed_*` is the same attack, which the program now refuses.
//! `sound_*` is an attack the program refused from the start.
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
        state::{DropEntry, ItemKind, Life, Outcome, Share, To},
        BoxArgs, ContestArgs, Input, ItemArgs, Origin, Output, RecipeArgs, Verdict,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 24 * 60 * 60;

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

fn my(env: &Env, who: &Keypair, mint: &Pubkey) -> u64 {
    env.tokens(&ata(&who.pubkey(), mint))
}

fn version(env: &Env, id: u32) -> u32 {
    env.acc::<loot::Recipe>(&env.mechanic_pda(loot::RECIPE_SEED, id)).version
}

/// Replaces every meta of `ix` whose key is `old` with `new` (same flags).
fn swap(ix: &mut Instruction, old: Pubkey, new: Pubkey) {
    let mut hit = false;
    for meta in ix.accounts.iter_mut().filter(|m| m.pubkey == old) {
        meta.pubkey = new;
        hit = true;
    }
    assert!(hit, "the account to replace is not in the instruction");
}

fn spl_transfer(who: &Keypair, from: Pubkey, to: Pubkey, amount: u64) -> Instruction {
    spl_token::instruction::transfer(&spl_token::ID, &from, &to, &who.pubkey(), &[], amount).unwrap()
}

fn core_burn(env: &mut Env, who: &Keypair, asset: Pubkey) {
    let ix = mpl_core::instructions::BurnV1Builder::new().asset(asset).collection(Some(env.collection)).payer(who.pubkey()).instruction();
    env.send(&[ix], &[who]).unwrap();
}

fn contest(env: &Env, shares: Vec<Share>) -> ContestArgs {
    ContestArgs { sides: 2, closes_at: env.now() + 600, result_by: env.now() + 1_200, shares }
}

fn enter_ix(env: &Env, who: Pubkey, id: u32, side: u8, amount: u64, mint: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        loot::ID,
        &loot::instruction::Enter { side, amount, terms: env.contest(id).terms }.data(),
        loot::accounts::Enter {
            player: who,
            game: env.game,
            contest: env.contest_pda(id),
            entry: env.entry_pda(id, &who, side),
            pot: env.pot_pda(id),
            player_token: ata(&who, &mint),
            mint,
            token_program: spl_token::ID,
            token_2022_program: loot::tokens::TOKEN_2022_ID,
            fee: env.fee(),
        }
        .to_account_metas(None),
    )
}

// ================================================================ findings, fixed

/// HIGH, fixed. A recipe line `Pay { mint, amount, to: Holder(asset) }` was paid in any mint:
/// `craft` checked the mint account but not that the paying token account was of it, and for a
/// `Holder` the other side is any token account the holder owns, which anyone can open in a
/// worthless mint. Now `craft` checks the paying account's mint, and `deliver` checks the
/// holder's account is of the payment's mint.
#[test]
fn fixed_a_recipe_payment_to_a_holder_is_paid_only_in_its_mint() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    let ore = env.new_mint(env.game);
    let junk = env.new_mint(owner.pubkey()); // stands for a mint the attacker made
    let landlord = player(&mut env, 0);
    let attacker = player(&mut env, 100);
    env.upsert_item(50, collectible("Plot")).unwrap();
    let plot = env.make(&authority, 50, landlord.pubkey()).unwrap();
    let pay = Input::Pay { mint: gold, amount: 100, to: To::Holder(plot) };
    env.upsert_recipe(&owner, 1, recipe(vec![pay], vec![Output::Tokens { mint: ore, amount: 5, from: Origin::Issue }])).unwrap();

    env.token_account(attacker.pubkey(), ore);
    env.fund(attacker.pubkey(), junk, 100);
    let landlords_junk = env.token_account(landlord.pubkey(), junk);

    // Paying from a junk account into a junk account of the landlord's.
    let (mut ix, _) = env.craft_ix(attacker.pubkey(), 1, version(&env, 1), &[]);
    swap(&mut ix, ata(&attacker.pubkey(), &gold), ata(&attacker.pubkey(), &junk));
    swap(&mut ix, ata(&landlord.pubkey(), &gold), landlords_junk);
    assert!(err(env.send(&[compute_limit(1_000_000), ix], &[&attacker])).contains("WrongMint"));

    // Paying real gold, but pointing the landlord's share at their junk account.
    let (mut ix, _) = env.craft_ix(attacker.pubkey(), 1, version(&env, 1), &[]);
    swap(&mut ix, ata(&landlord.pubkey(), &gold), landlords_junk);
    assert!(err(env.send(&[compute_limit(1_000_000), ix], &[&attacker])).contains("NotTheHolders"));

    env.craft(&attacker, 1, &[]).unwrap();
    assert_eq!((my(&env, &attacker, &ore), my(&env, &landlord, &gold), env.tokens(&landlords_junk)), (5, 100, 0));
}

/// HIGH, fixed. `unmake` signs Core's burn as the game, and Core lets an asset's owner burn it.
/// While a collectible is held the game is its owner, so the authority could burn a held
/// collectible that was never burnable, during the hold and after it. Now `unmake` refuses a
/// collectible the game is holding.
#[test]
fn fixed_the_authority_cannot_burn_a_collectible_the_game_is_holding() {
    let mut env = setup();
    let (authority, c) = (env.authority.insecure_clone(), env.cranker.insecure_clone());
    let p = player(&mut env, 0);
    env.upsert_item(80, collectible("Sword")).unwrap(); // burnable: false
    env.upsert_item(82, ItemArgs { burnable: true, ..collectible("Ticket") }).unwrap();
    let swords: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 80, p.pubkey()).unwrap()).collect();
    let ticket = env.make(&authority, 82, p.pubkey()).unwrap();

    assert!(env.unmake(&authority, swords[0]).is_err(), "not in the player's wallet");
    env.hold(&p, swords[0], 0).unwrap();
    assert!(err(env.unmake(&authority, swords[0])).contains("Held"), "not at a hold of no time");
    env.take_back(&c, swords[0], p.pubkey()).unwrap();

    env.hold(&p, swords[1], 600).unwrap();
    assert!(err(env.unmake(&authority, swords[1])).contains("Held"), "not while a hold runs");
    env.wait(601);
    assert!(err(env.unmake(&authority, swords[1])).contains("Held"), "not after it is over");
    env.take_back(&c, swords[1], p.pubkey()).unwrap();
    assert!(alive(&env, &swords[0]) && alive(&env, &swords[1]));

    // Not even a burnable one while it is held. In the wallet it still can be.
    env.hold(&p, ticket, 0).unwrap();
    assert!(err(env.unmake(&authority, ticket)).contains("Held"));
    env.take_back(&c, ticket, p.pubkey()).unwrap();
    env.unmake(&authority, ticket).unwrap();
}

/// MEDIUM, fixed. `enter` signed a contest's address, a side and an amount, and none of its
/// terms, and an id is free again once its contest closes. The authority could close an empty
/// contest and open another at the same id whose shares take the whole pot; an entry signed for
/// the first landed in the second. Now a contest carries a hash of its terms and an entry
/// names the hash it saw.
#[test]
fn fixed_an_entry_signs_the_contests_terms() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let gold = env.mint;
    let victim = player(&mut env, 1_000);
    let authoritys = env.token_account(authority.pubkey(), gold);

    let fair = contest(&env, vec![]);
    env.open_contest(&authority, 1, gold, fair.clone()).unwrap();
    assert_eq!(env.contest(1).terms, loot::terms(&gold, &fair));
    let signed = enter_ix(&env, victim.pubkey(), 1, 0, 1_000, gold);

    env.call_off(&authority, 1).unwrap();
    env.close_contest(1).unwrap();
    let rigged = ContestArgs { sides: 2, closes_at: fair.closes_at, result_by: fair.result_by, shares: vec![Share { to: To::Account(authoritys), bps: 10_000 }] };
    env.open_contest(&authority, 1, gold, rigged).unwrap();

    assert!(err(env.send(&[signed.clone()], &[&victim])).contains("TermsChanged"));
    assert_eq!(my(&env, &victim, &gold), 1_000);

    // The same terms again are the same deal: the entry is good there.
    env.call_off(&authority, 1).unwrap();
    env.close_contest(1).unwrap();
    env.open_contest(&authority, 1, gold, fair).unwrap();
    env.send(&[signed], &[&victim]).unwrap();
}

/// MEDIUM, closed. Admins edited items, shares included, and `To::Account` let an admin point
/// an item's whole revenue at an account of their own. A game has no admins any more (the
/// creator, 2026-10-11): only its owner writes an item.
#[test]
fn closed_only_the_owner_writes_where_an_items_revenue_goes() {
    let mut env = setup();
    let owner = env.creator.insecure_clone();
    let gold = env.mint;
    let admin = player(&mut env, 0);
    env.upsert_item(50, collectible("Plot")).unwrap();

    let crop = |to| ItemArgs { shares: vec![Share { to, bps: 10_000 }], ..item(ItemKind::Collectible, "Crop", 0, 1_000) };
    let admins = ata(&admin.pubkey(), &gold);
    env.upsert_item_as(&owner, 51, crop(To::Burn)).unwrap();
    for to in [To::Account(admins), To::Holder(admins), To::Pool(0)] {
        assert!(err(env.upsert_item_as(&admin, 51, crop(to))).contains("NotOwner"));
    }
    env.upsert_item_as(&owner, 51, crop(To::Account(admins))).unwrap();
}

/// MEDIUM, fixed. One collectible filled a `Use` line and then a `Burn` line of the same
/// recipe, so a recipe that asks for two of an item was crafted with one. Now a collectible
/// fills one place in a craft, whatever the lines.
#[test]
fn fixed_one_collectible_fills_one_place_in_a_craft() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = player(&mut env, 0);
    env.upsert_item(74, collectible("Mare")).unwrap();
    env.upsert_item(76, collectible("Foal")).unwrap();
    env.upsert_recipe(&owner, 1, recipe(vec![Input::Use { item: 74 }, Input::Burn { item: 74, count: 1 }], vec![Output::Item(76)])).unwrap();
    env.upsert_recipe(&owner, 2, recipe(vec![Input::Burn { item: 74, count: 1 }, Input::Use { item: 74 }], vec![Output::Item(76)])).unwrap();
    let mares: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 74, p.pubkey()).unwrap()).collect();

    assert!(err(env.craft(&p, 1, &[mares[0], mares[0]])).contains("ItemMismatch"));
    assert!(err(env.craft(&p, 2, &[mares[0], mares[0]])).contains("ItemMismatch"));
    assert!(alive(&env, &mares[0]));
    env.craft(&p, 1, &[mares[0], mares[1]]).unwrap();
    assert!(alive(&env, &mares[0]) && !alive(&env, &mares[1]));
}

/// MEDIUM, fixed. A `Holder` share nobody could take fell to the treasury, which only holds the
/// game's mint, so the holder of a named collectible could stop every settle of a box in
/// another mint by handing the collectible to the game. Now a share nobody holds is burned, in
/// the mint it was paid in.
#[test]
fn fixed_a_share_nobody_holds_is_burned_and_stops_no_settle() {
    let mut env = setup();
    let (owner, authority, c) = (env.creator.insecure_clone(), env.authority.insecure_clone(), env.cranker.insecure_clone());
    let gems = env.new_mint(owner.pubkey());
    let landlord = player(&mut env, 0);
    env.token_account(landlord.pubkey(), gems);
    env.fund(env.player.pubkey(), gems, 100);
    env.upsert_item(50, collectible("Plot")).unwrap();
    let plot = env.make(&authority, 50, landlord.pubkey()).unwrap();
    let entries = vec![DropEntry { outcome: Outcome::Nothing, weight: 1 }];
    let shares = vec![burn(5_000), Share { to: To::Holder(plot), bps: 5_000 }];
    env.upsert_box_args(5, BoxArgs { price: 10, currency: Some(gems), rise: None, fall: None, stock_odds: false, active: true, shares, entries }).unwrap();

    for nonce in [1, 2] {
        env.open_box(5, nonce).unwrap();
        env.callback_of(5, order_pda(&env.game, &env.player.pubkey(), nonce), rnd(0)).unwrap();
    }
    env.hold(&landlord, plot, 3_600).unwrap();
    env.settle_prize(order_pda(&env.game, &env.player.pubkey(), 1), None, &c).unwrap();
    assert_eq!((my(&env, &landlord, &gems), env.supply(&gems)), (0, 90), "all 10 burned: the landlord's half too");

    env.wait(3_600);
    env.take_back(&c, plot, landlord.pubkey()).unwrap();
    env.settle_prize(order_pda(&env.game, &env.player.pubkey(), 2), None, &c).unwrap();
    assert_eq!((my(&env, &landlord, &gems), env.supply(&gems)), (5, 85));
}

/// LOW, fixed. A recipe line paid to `Holder(asset)` cost nothing when nobody held the asset:
/// the line was skipped and every output still given. Now the payment is burned instead.
#[test]
fn fixed_a_recipe_payment_to_a_holder_is_never_free() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    let ore = env.new_mint(env.game);
    let landlord = player(&mut env, 0);
    let poor = player(&mut env, 0);
    let p = player(&mut env, 250);
    env.token_account(poor.pubkey(), ore);
    env.token_account(p.pubkey(), ore);
    env.upsert_item(50, collectible("Plot")).unwrap();
    let plot = env.make(&authority, 50, landlord.pubkey()).unwrap();
    let pay = Input::Pay { mint: gold, amount: 100, to: To::Holder(plot) };
    env.upsert_recipe(&owner, 1, recipe(vec![pay], vec![Output::Tokens { mint: ore, amount: 5, from: Origin::Issue }])).unwrap();

    env.hold(&landlord, plot, 0).unwrap();
    assert!(env.craft(&poor, 1, &[]).is_err(), "held by the game: it still costs 100 gold");
    let supply = env.supply(&gold);
    env.craft(&p, 1, &[]).unwrap();
    assert_eq!((my(&env, &p, &gold), supply - env.supply(&gold), my(&env, &landlord, &gold)), (150, 100, 0));

    env.take_back(&poor, plot, landlord.pubkey()).unwrap();
    core_burn(&mut env, &landlord, plot);
    assert!(env.craft(&poor, 1, &[]).is_err(), "burned: it still costs 100 gold");
    env.craft(&p, 1, &[]).unwrap();
    assert_eq!((my(&env, &p, &gold), my(&env, &p, &ore)), (50, 10));
}

/// LOW, fixed. `decide` had no deadline, so a result could be named long after it was due and
/// "every entry takes its own money back" was a race. Now no result is taken after `result_by`.
#[test]
fn fixed_no_result_is_taken_after_it_was_due() {
    let mut env = setup();
    let (authority, c) = (env.authority.insecure_clone(), env.cranker.insecure_clone());
    let gold = env.mint;
    let (a, b) = (player(&mut env, 100), player(&mut env, 100));
    let args = contest(&env, vec![]);
    env.open_contest(&authority, 1, gold, args).unwrap();
    env.enter(&a, 1, 0, 100).unwrap();
    env.enter(&b, 1, 1, 100).unwrap();
    env.wait(1_201);
    assert!(err(env.decide(&authority, 1, 1)).contains("ResultOverdue"));
    env.call_off(&c, 1).unwrap();
    env.claim(1, a.pubkey(), 0, ata(&a.pubkey(), &gold)).unwrap();
    assert_eq!((env.contest(1).verdict, my(&env, &a, &gold)), (Verdict::Off, 100));
}

/// LOW, fixed. `close_contest` burns what is left in the pot, and the token program refuses to
/// burn wrapped SOL, so one stray lamport kept a wrapped SOL contest from ever closing. Now a
/// wrapped SOL pot is closed without a burn, and what is in it leaves with the rent.
#[test]
fn fixed_a_stray_lamport_of_wrapped_sol_does_not_keep_a_contest_open() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let wsol = spl_token::native_mint::ID;
    if !env.exists(&wsol) {
        let mut mint = vec![0u8; 82];
        mint[44] = 9; // decimals
        mint[45] = 1; // initialized
        env.put(wsol, spl_token::ID, mint);
    }
    let args = contest(&env, vec![]);
    env.open_contest(&authority, 1, wsol, args).unwrap();
    env.call_off(&authority, 1).unwrap();

    // A stranger's wrapped SOL account with one lamport in it.
    let stranger = player(&mut env, 0);
    let from = Keypair::new().pubkey();
    let rent = env.rent(165);
    let mut bytes = token_account_bytes(&wsol, &stranger.pubkey(), 1);
    bytes[109..113].copy_from_slice(&1u32.to_le_bytes()); // is_native: some
    bytes[113..121].copy_from_slice(&rent.to_le_bytes());
    env.put_with(from, spl_token::ID, rent + 1, bytes);
    let stray = spl_transfer(&stranger, from, env.pot_pda(1), 1);
    env.send(&[stray], &[&stranger]).unwrap();

    env.close_contest(1).unwrap();
    assert!(!env.exists(&env.contest_pda(1)) && !env.exists(&env.pot_pda(1)));
}

/// NOTE, fixed. An item's `Life` is counted from numbers on the collectible, and `set` replaces
/// the whole list: a level written without `made` made an egg hatch at once and fresh milk
/// expire. Now `set` keeps the program's three numbers unless the new list names them.
#[test]
fn fixed_a_set_keeps_the_programs_numbers_unless_it_names_them() {
    let mut env = setup();
    env.wait(1_700_000_000); // the test chain starts in 1970; a real one does not
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = player(&mut env, 0);
    let life = |ready_after, lasts| Some(Life { ready_after, lasts, uses: 0, cooldown: 0 });
    env.upsert_item(70, ItemArgs { life: life(DAY as u32, 0), ..collectible("Egg") }).unwrap();
    env.upsert_item(71, collectible("Chick")).unwrap();
    env.upsert_item(72, ItemArgs { life: life(0, DAY as u32), ..collectible("Milk") }).unwrap();
    env.upsert_recipe(&owner, 1, merge_recipe(70, 1, 71)).unwrap();
    env.upsert_recipe(&owner, 2, merge_recipe(72, 1, 71)).unwrap();
    let egg = env.make(&authority, 70, p.pubkey()).unwrap();
    let milk = env.make(&authority, 72, p.pubkey()).unwrap();

    env.set(&authority, egg, &[("level", "2")]).unwrap();
    assert!(err(env.craft(&p, 1, &[egg])).contains("NotReady"), "a level-up hatches nothing");
    env.set(&authority, milk, &[("level", "2")]).unwrap();
    env.craft(&p, 2, &[milk]).unwrap();

    // The authority is still the authority: it can write the number itself.
    env.set(&authority, egg, &[("made", "0")]).unwrap();
    env.craft(&p, 1, &[egg]).unwrap();
}

// ================================================================ sound

/// The authority's `payout` and `burn`, and a recipe's pool output, name a pool by its index:
/// a contest's pot or the order vault put in the pool's place is refused.
#[test]
fn sound_no_pool_instruction_reaches_a_contests_pot_or_the_order_vault() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let gold = env.mint;
    env.open_pool(&owner, 0, gold).unwrap();
    let funder = player(&mut env, 500);
    env.deposit(&funder, 0, gold, 100).unwrap();
    let a = player(&mut env, 100);
    let args = contest(&env, vec![]);
    env.open_contest(&authority, 1, gold, args).unwrap();
    env.enter(&a, 1, 0, 100).unwrap();
    env.buy(3, 1).unwrap(); // an open order: its payment is in the vault
    let (pot, vault, pool) = (env.pot_pda(1), ata(&env.game, &gold), pool_pda(&env.game, 0));
    let to = env.token_account(authority.pubkey(), gold);

    for target in [pot, vault] {
        let mut ix = env.payout_ix(authority.pubkey(), 0, to, 50);
        swap(&mut ix, pool, target);
        assert!(err(env.send(&[ix], &[&authority])).contains("ConstraintSeeds"));
    }

    env.upsert_recipe(&owner, 1, recipe(vec![], vec![Output::Tokens { mint: gold, amount: 50, from: Origin::Pool(0) }])).unwrap();
    for target in [pot, vault] {
        let (mut ix, _) = env.craft_ix(a.pubkey(), 1, version(&env, 1), &[]);
        swap(&mut ix, pool, target);
        assert!(err(env.send(&[ix], &[&a])).contains("WrongPool"));
    }
    assert_eq!((env.tokens(&pot), env.tokens(&vault)), (100, PRICE / 2));
}

/// A recipe's lines are matched to accounts strictly: one asset cannot be burned twice, a
/// cheaper item cannot stand in for the one a line names, someone else's asset is not the
/// player's, and missing accounts are refused. Accounts after the last line are for a transfer
/// hook (since Token-2022 support): they are accepted and nothing is done with them here.
#[test]
fn sound_a_recipes_accounts_cannot_be_substituted_or_repeated() {
    let mut env = setup();
    let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
    let p = player(&mut env, 0);
    let other = player(&mut env, 0);
    env.upsert_item(30, collectible("Fish")).unwrap();
    env.upsert_item(31, collectible("Fish Bone")).unwrap(); // a name that starts the same
    env.upsert_item(32, collectible("Trophy")).unwrap();
    env.upsert_recipe(&owner, 1, merge_recipe(30, 2, 32)).unwrap();
    let fish = env.make(&authority, 30, p.pubkey()).unwrap();
    let bones: Vec<Pubkey> = (0..2).map(|_| env.make(&authority, 31, p.pubkey()).unwrap()).collect();
    let theirs = env.make(&authority, 30, other.pubkey()).unwrap();

    assert!(env.craft(&p, 1, &[fish, fish]).is_err(), "one fish is not two");
    assert!(err(env.craft(&p, 1, &bones)).contains("ItemMismatch"), "a bone is not a fish");
    assert!(err(env.craft(&p, 1, &[fish, theirs])).contains("ItemMismatch"));
    assert!(err(env.craft(&p, 1, &[fish])).contains("ItemMismatch"), "too few");

    // The item account of the line swapped for the cheaper item's.
    let (mut ix, made) = env.craft_ix(p.pubkey(), 1, version(&env, 1), &bones);
    let at = ix.accounts.iter().position(|m| m.pubkey == item_pda(&env.game, 30)).unwrap();
    ix.accounts[at].pubkey = item_pda(&env.game, 31);
    assert!(err(env.send(&[compute_limit(1_000_000), ix], &[&p, &made[0]])).contains("ItemMismatch"));

    // An extra account after the last line: someone else's fish, which stays theirs.
    let fish2 = env.make(&authority, 30, p.pubkey()).unwrap();
    let (mut ix, made) = env.craft_ix(p.pubkey(), 1, version(&env, 1), &[fish, fish2]);
    ix.accounts.push(AccountMeta::new(theirs, false));
    env.send(&[compute_limit(1_000_000), ix], &[&p, &made[0]]).unwrap();
    assert!(!alive(&env, &fish) && !alive(&env, &fish2) && env.item_state(32).issued == 1);
    assert!(alive(&env, &theirs) && holder(&env, &theirs) == other.pubkey());
}

/// A hold takes only a collectible of this game's collection, from whoever owns it. The second
/// the hold ends is the player's: `award` is refused from `free_at` on and `take_back` before
/// it, so there is no second in which both work or neither does.
#[test]
fn sound_a_hold_takes_only_the_games_collectibles_and_its_last_second_belongs_to_one_side() {
    let mut env = setup();
    let (authority, c) = (env.authority.insecure_clone(), env.cranker.insecure_clone());
    let p = player(&mut env, 0);
    let thief = player(&mut env, 0);
    env.upsert_item(80, collectible("Sword")).unwrap();
    let sword = env.make(&authority, 80, p.pubkey()).unwrap();

    // An asset outside the collection.
    let loose = Keypair::new();
    let ix = mpl_core::instructions::CreateV2Builder::new()
        .asset(loose.pubkey())
        .payer(p.pubkey())
        .owner(Some(p.pubkey()))
        .name("Sword #9".into())
        .uri("x".into())
        .instruction();
    env.send(&[ix], &[&p, &loose]).unwrap();
    assert!(env.hold(&p, loose.pubkey(), 0).is_err());
    assert_eq!(holder(&env, &loose.pubkey()), p.pubkey());

    // Someone else's sword.
    assert!(env.hold(&thief, sword, 0).is_err());

    env.hold(&p, sword, 600).unwrap();
    assert!(err(env.hold(&p, sword, 600)).contains("already in use"), "one hold at a time");
    env.wait(599);
    assert!(err(env.take_back(&c, sword, p.pubkey())).contains("StillHeld"));
    env.wait(1);
    assert!(err(env.award(&authority, sword, thief.pubkey())).contains("HoldOver"));
    // Only the player's own address, and only the Hold of this asset.
    assert!(err(env.take_back(&c, sword, thief.pubkey())).contains("NotThePlayers"));
    env.take_back(&c, sword, p.pubkey()).unwrap();
    assert_eq!(holder(&env, &sword), p.pubkey());
}

/// A contest never pays out more than its pot and leaves nothing behind, whatever the order of
/// the claims, with shares and amounts that do not divide.
#[test]
fn sound_a_contest_pays_out_exactly_its_pot_in_any_order_of_claims() {
    for order in [[0usize, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]] {
        let mut env = setup();
        let (owner, authority) = (env.creator.insecure_clone(), env.authority.insecure_clone());
        let gold = env.mint;
        env.open_pool(&owner, 0, gold).unwrap();
        let stakes = [(0u8, 7u64), (0, 13), (0, 1), (1, 1_000_003)];
        let players: Vec<Keypair> = stakes.iter().map(|(_, amount)| player(&mut env, *amount)).collect();
        let args = contest(&env, vec![burn(333), pool(0, 777)]);
        env.open_contest(&authority, 1, gold, args).unwrap();
        for (p, (side, amount)) in players.iter().zip(stakes) {
            env.enter(p, 1, side, amount).unwrap();
        }
        let pot = env.tokens(&env.pot_pda(1));
        env.decide(&authority, 1, 0).unwrap();
        let prize = env.contest(1).prize;
        assert_eq!(env.tokens(&env.pot_pda(1)), prize);
        assert!(prize <= pot);

        for i in order {
            let p = &players[i];
            env.claim(1, p.pubkey(), stakes[i].0, ata(&p.pubkey(), &gold)).unwrap();
        }
        let paid: u64 = players.iter().map(|p| my(&env, p, &gold)).sum();
        assert_eq!((paid, env.tokens(&env.pot_pda(1)), my(&env, &players[3], &gold)), (prize, 0, 0));
        env.close_contest(1).unwrap();
    }
}

/// A contest's entries cannot be claimed against another contest's pot, an entry is one per
/// player and side, and a contest cannot close or reopen while an entry is unclaimed, so an old
/// entry never meets a new contest at the same address.
#[test]
fn sound_an_entry_belongs_to_one_contest_and_holds_its_id_until_it_is_claimed() {
    let mut env = setup();
    let authority = env.authority.insecure_clone();
    let gold = env.mint;
    let (a, b) = (player(&mut env, 100), player(&mut env, 100));
    for id in [1, 2] {
        let args = contest(&env, vec![]);
        env.open_contest(&authority, id, gold, args).unwrap();
    }
    env.enter(&a, 1, 0, 10).unwrap();
    env.enter(&b, 2, 0, 100).unwrap();
    env.call_off(&authority, 1).unwrap();
    env.call_off(&authority, 2).unwrap();

    // a's entry of contest 1, claimed from contest 2's pot.
    let c = env.cranker.insecure_clone();
    let ix = Instruction::new_with_bytes(
        loot::ID,
        &loot::instruction::Claim {}.data(),
        loot::accounts::Claim {
            game: env.game,
            contest: env.contest_pda(2),
            entry: env.entry_pda(1, &a.pubkey(), 0),
            player: a.pubkey(),
            pot: env.pot_pda(2),
            to: ata(&a.pubkey(), &gold),
            mint: gold,
            token_program: spl_token::ID,
            token_2022_program: loot::tokens::TOKEN_2022_ID,
        }
        .to_account_metas(None),
    );
    assert!(err(env.send(&[ix], &[&c])).contains("ConstraintHasOne"));

    assert!(err(env.close_contest(1)).contains("EntriesLeft"));
    let again = contest(&env, vec![]);
    assert!(err(env.open_contest(&authority, 1, gold, again)).contains("ContestOpen"));
    env.claim(1, a.pubkey(), 0, ata(&a.pubkey(), &gold)).unwrap();
    assert!(env.claim(1, a.pubkey(), 0, ata(&a.pubkey(), &gold)).is_err());
    assert_eq!((my(&env, &a, &gold), env.tokens(&env.pot_pda(2))), (100, 100));
}

/// At settle, whoever sends the transaction cannot point a `Holder` or `Account` share
/// anywhere else, and cannot name another collectible as the one whose holder is paid.
#[test]
fn sound_a_settle_cannot_redirect_a_share() {
    let mut env = setup();
    let (authority, c) = (env.authority.insecure_clone(), env.cranker.insecure_clone());
    let gold = env.mint;
    let landlord = player(&mut env, 0);
    let thief = player(&mut env, 0);
    let partner = env.token_account(Keypair::new().pubkey(), gold);
    env.upsert_item(50, collectible("Plot")).unwrap();
    let plot = env.make(&authority, 50, landlord.pubkey()).unwrap();
    let thiefs_plot = env.make(&authority, 50, thief.pubkey()).unwrap();
    let shares = vec![Share { to: To::Holder(plot), bps: 5_000 }, Share { to: To::Account(partner), bps: 5_000 }];
    env.upsert_item(51, ItemArgs { shares, ..item(ItemKind::Collectible, "Crop", 0, 1_000) }).unwrap();
    env.buy(51, 1).unwrap();
    let order = order_pda(&env.game, &env.player.pubkey(), 1);
    let thiefs = ata(&thief.pubkey(), &gold);

    let mut ix = env.settle_ix(order, c.pubkey());
    swap(&mut ix, ata(&landlord.pubkey(), &gold), thiefs);
    assert!(err(env.send(&[ix], &[&c])).contains("NotTheHolders"));

    let mut ix = env.settle_ix(order, c.pubkey());
    swap(&mut ix, plot, thiefs_plot);
    swap(&mut ix, ata(&landlord.pubkey(), &gold), thiefs);
    assert!(err(env.send(&[ix], &[&c])).contains("WrongPool"));

    let mut ix = env.settle_ix(order, c.pubkey());
    swap(&mut ix, partner, thiefs);
    assert!(err(env.send(&[ix], &[&c])).contains("WrongPool"));

    env.settle(order, &c).unwrap();
    assert_eq!((my(&env, &landlord, &gold), env.tokens(&partner), env.tokens(&thiefs)), (500, 500, 0));
    assert!(!env.exists(&order));
}
