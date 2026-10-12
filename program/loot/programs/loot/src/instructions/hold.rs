//! A hold: a player hands a collectible to the game for a time they choose. A sword taken
//! into a raid, a hero sent on a heist, an item lent out, a stake of things that are not
//! alike.
//!
//! The time is what the player agrees to. While it runs, the game's authority decides where
//! the collectible goes: back to the player, or to someone else (`award`). Once it is over the
//! authority can do nothing, and anyone can send the collectible home (`take_back`). A hold of
//! zero seconds is a lock only the player's own patience keeps.
//!
//! The collectible itself moves: the game is its owner until it leaves, so it cannot be sold
//! or put into a recipe meanwhile. A soulbound one cannot be held: it never moves.
//!
//! The way home goes through Metaplex Core, and whoever controls the game's collection there
//! can make Core refuse it (a royalties rule, an oracle adapter, taking the collectible out of
//! the collection). That is the project itself, which this program trusts.
use anchor_lang::prelude::*;

use crate::{
    constants::*,
    core_cpi::{Core, MPL_CORE_ID},
    error::LootError,
    rail::*,
    receipts::*,
    state::*,
};

/// At `["hold", asset]`. The player pays its rent and gets it back when the hold ends.
#[account(discriminator = &[12])]
#[derive(InitSpace)]
pub struct Hold {
    pub game: Pubkey,
    pub asset: Pubkey,
    /// Who handed it in, and who it goes back to.
    pub player: Pubkey,
    /// Unix time the authority's say ends.
    pub free_at: i64,
    /// The game's own label: the raid, the borrower.
    pub reference: [u8; 32],
    pub bump: u8,
}

// ---------------------------------------------------------------- hold

#[derive(Accounts)]
pub struct HoldItem<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [GAME_SEED, game.collection.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,
    #[account(init, payer = player, space = 1 + Hold::INIT_SPACE, seeds = [HOLD_SEED, asset.key().as_ref()], bump)]
    pub hold: Account<'info, Hold>,
    /// CHECK: the collectible. Core checks that the player owns it and that it is in `collection`.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the game's Core collection, by address.
    #[account(address = game.collection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub fee: Fee<'info>,
    pub system_program: Program<'info, System>,
}

/// The player hands the collectible to the game for `seconds`.
pub fn handle_hold(ctx: Context<HoldItem>, seconds: i64, reference: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.game.paused, LootError::Paused);
    require!(!a.game.suspended, LootError::Suspended);
    a.fee.charge_player(&a.player)?;
    Core {
        program: &a.mpl_core_program,
        asset: &a.asset,
        collection: &a.collection,
        authority: &a.player,
        payer: &a.player,
        system: &a.system_program,
    }
    .transfer(&a.game.to_account_info(), &[])?;

    let (game, asset, player) = (a.game.key(), a.asset.key(), a.player.key());
    let free_at = Clock::get()?.unix_timestamp.saturating_add(seconds.max(0));
    ctx.accounts.hold.set_inner(Hold { game, asset, player, free_at, reference, bump: ctx.bumps.hold });
    emit!(Held { game, asset, player, free_at, reference });
    Ok(())
}

// ---------------------------------------------------------------- take_back and award

/// The accounts both ways out of a hold take.
#[derive(Accounts)]
pub struct Release<'info> {
    /// Anyone, for `take_back`. The game's authority, for `award`.
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [GAME_SEED, game.collection.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,
    #[account(mut, close = player, has_one = game, has_one = asset, has_one = player)]
    pub hold: Account<'info, Hold>,
    /// CHECK: the held collectible.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: who handed it in. Gets the hold's rent.
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    /// CHECK: who gets the collectible: the player for `take_back`, anyone for `award`.
    pub to: UncheckedAccount<'info>,
    /// CHECK: the game's Core collection, by address.
    #[account(address = game.collection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub fee: Fee<'info>,
}

impl Release<'_> {
    /// The game hands the collectible to `to`.
    fn send(&self) -> Result<()> {
        Core {
            program: &self.mpl_core_program,
            asset: &self.asset,
            collection: &self.collection,
            authority: &self.game.to_account_info(),
            payer: &self.signer,
            system: &self.fee.system_program,
        }
        .transfer(&self.to, &[&[GAME_SEED, self.game.collection.as_ref(), &[self.game.bump]]])
    }
}

/// Once the hold is over, anyone sends the collectible back to its player. No switch of the
/// owner or the platform stops it, and it costs no fee.
pub fn handle_take_back(ctx: Context<Release>) -> Result<()> {
    let a = &ctx.accounts;
    require!(Clock::get()?.unix_timestamp >= a.hold.free_at, LootError::StillHeld);
    require_keys_eq!(a.to.key(), a.hold.player, LootError::NotThePlayers);
    a.send()?;
    emit!(Returned { game: a.game.key(), asset: a.asset.key(), player: a.hold.player });
    Ok(())
}

/// While the hold runs, the authority gives the collectible to `to`: back to its player
/// early, or to whoever won it.
pub fn handle_award(ctx: Context<Release>, reference: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts;
    require_keys_eq!(a.signer.key(), a.game.authority, LootError::NotAuthority);
    require!(Clock::get()?.unix_timestamp < a.hold.free_at, LootError::HoldOver);
    a.fee.charge_project(&a.signer)?;
    a.send()?;
    emit!(Awarded {
        game: a.game.key(),
        authority: a.signer.key(),
        asset: a.asset.key(),
        player: a.hold.player,
        to: a.to.key(),
        reference,
    });
    Ok(())
}
