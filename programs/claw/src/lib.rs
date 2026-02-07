use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("QiAZtS7YfibVDTTarBM8bXfCtPFaMJ24BwSijZHg9W8"); // Placeholder

#[program]
pub mod claw {
    use super::*;

    /// Creates a new Claw vault with bounded spending authority
    pub fn create_vault(
        ctx: Context<CreateVault>,
        max_amount: u64,
        expiry: Option<i64>,
        vault_bump: u8,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.funder = ctx.accounts.funder.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.token_account = ctx.accounts.vault_token_account.key();
        vault.max_amount = max_amount;
        vault.spent_amount = 0;
        vault.expiry = expiry;
        vault.claw_nft_mint = Pubkey::default(); // Set when Claw is minted
        vault.bump = vault_bump;
        vault.is_active = true;
        
        emit!(VaultCreated {
            vault: vault.key(),
            funder: vault.funder,
            token_mint: vault.token_mint,
            max_amount,
            expiry,
        });
        
        Ok(())
    }

    /// Fund the vault with tokens
    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        require!(vault.is_active, ClawError::VaultInactive);
        
        // Transfer tokens from funder to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.funder_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        emit!(VaultFunded {
            vault: vault.key(),
            amount,
            new_balance: ctx.accounts.vault_token_account.amount + amount,
        });
        
        Ok(())
    }

    /// Mint Claw NFT and assign to agent
    pub fn mint_claw(ctx: Context<MintClaw>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        
        require!(vault.is_active, ClawError::VaultInactive);
        require!(
            vault.claw_nft_mint == Pubkey::default(),
            ClawError::ClawAlreadyMinted
        );
        
        // Store the NFT mint in vault state
        vault.claw_nft_mint = ctx.accounts.claw_mint.key();
        
        // The NFT minting is handled by Metaplex CPI in a real implementation
        // For now, we just track the mint address
        
        emit!(ClawMinted {
            vault: vault.key(),
            claw_mint: vault.claw_nft_mint,
            recipient: ctx.accounts.recipient.key(),
        });
        
        Ok(())
    }

    /// Spend from vault - agent must hold the Claw NFT
    pub fn spend(
        ctx: Context<Spend>,
        amount: u64,
        memo: Option<String>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        
        // Validations
        require!(vault.is_active, ClawError::VaultInactive);
        require!(
            ctx.accounts.spender_claw_account.amount == 1,
            ClawError::MustHoldClaw
        );
        
        // Check expiry
        if let Some(expiry) = vault.expiry {
            require!(clock.unix_timestamp < expiry, ClawError::ClawExpired);
        }
        
        // Check spending limit
        let remaining = vault.max_amount
            .checked_sub(vault.spent_amount)
            .ok_or(ClawError::Overflow)?;
        require!(amount <= remaining, ClawError::ExceedsLimit);
        
        // Update spent amount
        vault.spent_amount = vault.spent_amount
            .checked_add(amount)
            .ok_or(ClawError::Overflow)?;
        
        // Transfer tokens from vault to recipient
        let seeds = &[
            b"claw_vault".as_ref(),
            vault.funder.as_ref(),
            vault.token_mint.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        
        emit!(ClawSpent {
            vault: vault.key(),
            spender: ctx.accounts.spender.key(),
            recipient: ctx.accounts.recipient_token_account.key(),
            amount,
            remaining: vault.max_amount - vault.spent_amount,
            memo,
        });
        
        Ok(())
    }

    /// Burn Claw and recover unspent funds (funder only)
    pub fn burn_claw(ctx: Context<BurnClaw>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        
        require!(vault.is_active, ClawError::VaultInactive);
        require!(
            ctx.accounts.funder.key() == vault.funder,
            ClawError::NotFunder
        );
        
        // Calculate remaining funds
        let remaining = ctx.accounts.vault_token_account.amount;
        
        // Transfer remaining funds back to funder
        if remaining > 0 {
            let seeds = &[
                b"claw_vault".as_ref(),
                vault.funder.as_ref(),
                vault.token_mint.as_ref(),
                &[vault.bump],
            ];
            let signer = &[&seeds[..]];
            
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.funder_token_account.to_account_info(),
                authority: vault.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, remaining)?;
        }
        
        // Mark vault as inactive
        vault.is_active = false;
        
        // Note: Actual NFT burning would require Metaplex CPI
        
        emit!(ClawBurned {
            vault: vault.key(),
            funder: vault.funder,
            recovered: remaining,
            total_spent: vault.spent_amount,
        });
        
        Ok(())
    }
}

// === ACCOUNTS ===

#[derive(Accounts)]
#[instruction(max_amount: u64, expiry: Option<i64>, vault_bump: u8)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    
    #[account(
        init,
        payer = funder,
        space = 8 + ClawVault::INIT_SPACE,
        seeds = [b"claw_vault", funder.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, ClawVault>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = funder,
        associated_token::mint = token_mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    
    #[account(
        mut,
        constraint = vault.funder == funder.key() @ ClawError::NotFunder,
    )]
    pub vault: Account<'info, ClawVault>,
    
    #[account(
        mut,
        associated_token::mint = vault.token_mint,
        associated_token::authority = funder,
    )]
    pub funder_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = vault_token_account.key() == vault.token_account,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MintClaw<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    
    #[account(
        mut,
        constraint = vault.funder == funder.key() @ ClawError::NotFunder,
    )]
    pub vault: Account<'info, ClawVault>,
    
    /// The NFT mint for the Claw
    #[account(mut)]
    pub claw_mint: Account<'info, Mint>,
    
    /// Where the Claw NFT goes
    /// CHECK: Will be validated by Metaplex
    pub recipient: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Spend<'info> {
    pub spender: Signer<'info>,
    
    #[account(mut)]
    pub vault: Account<'info, ClawVault>,
    
    /// Spender's Claw NFT token account - proves they hold the authority
    #[account(
        constraint = spender_claw_account.owner == spender.key(),
        constraint = spender_claw_account.mint == vault.claw_nft_mint @ ClawError::WrongClaw,
    )]
    pub spender_claw_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = vault_token_account.key() == vault.token_account,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnClaw<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    
    #[account(
        mut,
        constraint = vault.funder == funder.key() @ ClawError::NotFunder,
    )]
    pub vault: Account<'info, ClawVault>,
    
    #[account(
        mut,
        constraint = vault_token_account.key() == vault.token_account,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = vault.token_mint,
        associated_token::authority = funder,
    )]
    pub funder_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

// === STATE ===

#[account]
#[derive(InitSpace)]
pub struct ClawVault {
    /// The human who funded this vault
    pub funder: Pubkey,
    /// Token mint (USDC, SOL, etc.)
    pub token_mint: Pubkey,
    /// Token account holding the funds
    pub token_account: Pubkey,
    /// Maximum spending authority
    pub max_amount: u64,
    /// Amount already spent
    pub spent_amount: u64,
    /// Optional expiry timestamp
    pub expiry: Option<i64>,
    /// The NFT mint representing spending authority
    pub claw_nft_mint: Pubkey,
    /// PDA bump
    pub bump: u8,
    /// Whether vault is active
    pub is_active: bool,
}

// === EVENTS ===

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub funder: Pubkey,
    pub token_mint: Pubkey,
    pub max_amount: u64,
    pub expiry: Option<i64>,
}

#[event]
pub struct VaultFunded {
    pub vault: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct ClawMinted {
    pub vault: Pubkey,
    pub claw_mint: Pubkey,
    pub recipient: Pubkey,
}

#[event]
pub struct ClawSpent {
    pub vault: Pubkey,
    pub spender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub remaining: u64,
    pub memo: Option<String>,
}

#[event]
pub struct ClawBurned {
    pub vault: Pubkey,
    pub funder: Pubkey,
    pub recovered: u64,
    pub total_spent: u64,
}

// === ERRORS ===

#[error_code]
pub enum ClawError {
    #[msg("Vault is not active")]
    VaultInactive,
    #[msg("Claw NFT already minted for this vault")]
    ClawAlreadyMinted,
    #[msg("Must hold the Claw NFT to spend")]
    MustHoldClaw,
    #[msg("Wrong Claw NFT for this vault")]
    WrongClaw,
    #[msg("Spending amount exceeds remaining limit")]
    ExceedsLimit,
    #[msg("Claw has expired")]
    ClawExpired,
    #[msg("Only the funder can perform this action")]
    NotFunder,
    #[msg("Arithmetic overflow")]
    Overflow,
}
