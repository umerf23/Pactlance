use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZq7FEfcYkgMQhgqJM6dS9");
pub const MAX_MILESTONES: usize = 32;
pub const FUNDED: u8 = 1;
pub const SUBMITTED: u8 = 2;
pub const SETTLED: u8 = 3;

#[program]
pub mod pactlance {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        require!(ctx.accounts.mint.decimals == 6, EscrowError::WrongMint);
        ctx.accounts.config.mint = ctx.accounts.mint.key();
        Ok(())
    }

    pub fn create_project(ctx: Context<CreateProject>, args: ProjectTerms) -> Result<()> {
        args.validate(Clock::get()?.unix_timestamp)?;
        require!(
            ctx.accounts.creator.key() == args.client
                || ctx.accounts.creator.key() == args.freelancer,
            EscrowError::Unauthorized
        );
        require_keys_eq!(ctx.accounts.mint.key(), args.mint, EscrowError::WrongMint);
        require!(ctx.accounts.mint.decimals == 6, EscrowError::WrongMint);
        let p = &mut ctx.accounts.project;
        p.terms = args;
        p.client_accepted = false;
        p.freelancer_accepted = false;
        p.next = 0;
        p.active = false;
        Ok(())
    }

    // Explicit on-chain acceptance; Phase 3 message signatures do not authorize escrow.
    pub fn accept_project(ctx: Context<AcceptProject>, commitment: [u8; 32]) -> Result<()> {
        let p = &mut ctx.accounts.project;
        require!(p.terms.commitment == commitment, EscrowError::TermsMismatch);
        require!(!p.active && p.next == 0, EscrowError::WrongState);
        let signer = ctx.accounts.participant.key();
        if signer == p.terms.client {
            p.client_accepted = true;
        } else if signer == p.terms.freelancer {
            p.freelancer_accepted = true;
        } else {
            return err!(EscrowError::Unauthorized);
        }
        Ok(())
    }

    pub fn fund_milestone(ctx: Context<FundMilestone>, index: u16) -> Result<()> {
        let p = &mut ctx.accounts.project;
        let terms = p.fundable(index, Clock::get()?.unix_timestamp)?;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.client.to_account_info(),
                },
            ),
            terms.amount,
            ctx.accounts.mint.decimals,
        )?;
        let m = &mut ctx.accounts.milestone;
        m.project = p.key();
        m.index = index;
        m.amount = terms.amount;
        m.delivery_deadline = terms.delivery_deadline;
        m.status = FUNDED;
        m.bump = ctx.bumps.milestone;
        m.submission = [0; 32];
        m.review_deadline = 0;
        p.active = true;
        emit!(MilestoneChanged {
            project: p.key(),
            index,
            status: FUNDED,
            amount: m.amount
        });
        Ok(())
    }

    pub fn submit_delivery(ctx: Context<SubmitDelivery>, commitment: [u8; 32]) -> Result<()> {
        let p = &ctx.accounts.project;
        let m = &mut ctx.accounts.milestone;
        require!(
            p.active && p.next == m.index && m.status == FUNDED,
            EscrowError::WrongState
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now < m.delivery_deadline, EscrowError::Deadline);
        require!(commitment != [0; 32], EscrowError::TermsMismatch);
        m.review_deadline = now
            .checked_add(p.terms.review_seconds)
            .ok_or(EscrowError::Overflow)?;
        m.submission = commitment;
        m.status = SUBMITTED;
        emit!(MilestoneChanged {
            project: p.key(),
            index: m.index,
            status: SUBMITTED,
            amount: m.amount
        });
        Ok(())
    }

    pub fn approve_milestone(ctx: Context<ApproveMilestone>) -> Result<()> {
        let p = &mut ctx.accounts.project;
        let m = &mut ctx.accounts.milestone;
        require!(
            p.active && p.next == m.index && m.status == SUBMITTED,
            EscrowError::WrongState
        );
        let project_key = p.key();
        let index = m.index.to_le_bytes();
        let bump = [m.bump];
        let seeds: &[&[u8]] = &[b"milestone", project_key.as_ref(), &index, &bump];
        // Pay the recorded obligation, not the vault balance: donations cannot inflate payout.
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                    authority: m.to_account_info(),
                },
                &[seeds],
            ),
            m.amount,
            ctx.accounts.mint.decimals,
        )?;
        m.status = SETTLED;
        p.active = false;
        p.next = p.next.checked_add(1).ok_or(EscrowError::Overflow)?;
        emit!(MilestoneChanged {
            project: p.key(),
            index: m.index,
            status: SETTLED,
            amount: m.amount
        });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct MilestoneTerms {
    pub amount: u64,
    pub funding_deadline: i64,
    pub delivery_deadline: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ProjectTerms {
    pub id: [u8; 16],
    pub version: u32,
    pub commitment: [u8; 32],
    pub client: Pubkey,
    pub freelancer: Pubkey,
    pub mint: Pubkey,
    pub reviewer: Pubkey,
    pub backup_reviewer: Pubkey,
    pub review_seconds: i64,
    pub backup_delay_seconds: i64,
    #[max_len(32)]
    pub milestones: Vec<MilestoneTerms>,
}
impl ProjectTerms {
    pub fn validate(&self, now: i64) -> Result<()> {
        require!(
            self.version > 0 && self.commitment != [0; 32],
            EscrowError::TermsMismatch
        );
        let parties = [
            self.client,
            self.freelancer,
            self.reviewer,
            self.backup_reviewer,
        ];
        for (i, key) in parties.iter().enumerate() {
            require!(
                *key != Pubkey::default() && !parties[..i].contains(key),
                EscrowError::Unauthorized
            );
        }
        require!(
            self.review_seconds > 0
                && self.review_seconds <= 2_592_000
                && self.backup_delay_seconds > 0
                && self.backup_delay_seconds <= 31_536_000,
            EscrowError::Deadline
        );
        require!(
            !self.milestones.is_empty() && self.milestones.len() <= MAX_MILESTONES,
            EscrowError::Sequence
        );
        let mut previous = (now, now);
        for m in &self.milestones {
            require!(m.amount > 0, EscrowError::Amount);
            require!(
                m.funding_deadline > previous.0
                    && m.delivery_deadline > previous.1
                    && m.funding_deadline < m.delivery_deadline,
                EscrowError::Deadline
            );
            m.delivery_deadline
                .checked_add(self.review_seconds)
                .ok_or(EscrowError::Overflow)?;
            previous = (m.funding_deadline, m.delivery_deadline);
        }
        Ok(())
    }
}
#[account]
#[derive(InitSpace)]
pub struct Project {
    pub terms: ProjectTerms,
    pub client_accepted: bool,
    pub freelancer_accepted: bool,
    pub next: u16,
    pub active: bool,
}
impl Project {
    pub fn fundable(&self, index: u16, now: i64) -> Result<MilestoneTerms> {
        require!(
            self.client_accepted && self.freelancer_accepted,
            EscrowError::NotAccepted
        );
        require!(!self.active && self.next == index, EscrowError::Sequence);
        let m = self
            .terms
            .milestones
            .get(index as usize)
            .ok_or(EscrowError::Sequence)?;
        require!(now < m.funding_deadline, EscrowError::Deadline);
        Ok(m.clone())
    }
}
#[account]
#[derive(InitSpace)]
pub struct Milestone {
    pub project: Pubkey,
    pub index: u16,
    pub amount: u64,
    pub delivery_deadline: i64,
    pub review_deadline: i64,
    pub submission: [u8; 32],
    pub status: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowConfig {
    pub mint: Pubkey,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint=program.programdata_address()? == Some(program_data.key()) @ EscrowError::Unauthorized)]
    pub program: Program<'info, crate::program::Pactlance>,
    #[account(constraint=program_data.upgrade_authority_address == Some(authority.key()) @ EscrowError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer=authority, space=8+EscrowConfig::INIT_SPACE, seeds=[b"config"], bump)]
    pub config: Account<'info, EscrowConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: ProjectTerms)]
pub struct CreateProject<'info> {
    #[account(seeds=[b"config"], bump, constraint=config.mint == mint.key() @ EscrowError::WrongMint)]
    pub config: Account<'info, EscrowConfig>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(init, payer=creator, space=8+Project::INIT_SPACE,
        seeds=[b"project", args.client.as_ref(), args.id.as_ref()], bump)]
    pub project: Account<'info, Project>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct AcceptProject<'info> {
    pub participant: Signer<'info>,
    #[account(mut)]
    pub project: Account<'info, Project>,
}
#[derive(Accounts)]
#[instruction(index: u16)]
pub struct FundMilestone<'info> {
    #[account(mut, address=project.terms.client)]
    pub client: Signer<'info>,
    #[account(mut)]
    pub project: Account<'info, Project>,
    #[account(address=project.terms.mint)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer=client, space=8+Milestone::INIT_SPACE,
        seeds=[b"milestone", project.key().as_ref(), &index.to_le_bytes()], bump)]
    pub milestone: Account<'info, Milestone>,
    #[account(init, payer=client, seeds=[b"vault", milestone.key().as_ref()], bump,
        token::mint=mint, token::authority=milestone)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint=mint, token::authority=client)]
    pub source: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SubmitDelivery<'info> {
    #[account(address=project.terms.freelancer)]
    pub freelancer: Signer<'info>,
    pub project: Account<'info, Project>,
    #[account(mut, has_one=project, seeds=[b"milestone", project.key().as_ref(), &milestone.index.to_le_bytes()], bump=milestone.bump)]
    pub milestone: Account<'info, Milestone>,
}
#[derive(Accounts)]
pub struct ApproveMilestone<'info> {
    #[account(address=project.terms.client)]
    pub client: Signer<'info>,
    #[account(mut)]
    pub project: Account<'info, Project>,
    #[account(mut, has_one=project, seeds=[b"milestone", project.key().as_ref(), &milestone.index.to_le_bytes()], bump=milestone.bump)]
    pub milestone: Account<'info, Milestone>,
    #[account(address=project.terms.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds=[b"vault", milestone.key().as_ref()], bump, token::mint=mint, token::authority=milestone)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint=mint, constraint=recipient.owner == project.terms.freelancer @ EscrowError::Unauthorized)]
    pub recipient: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[event]
pub struct MilestoneChanged {
    pub project: Pubkey,
    pub index: u16,
    pub status: u8,
    pub amount: u64,
}
#[error_code]
pub enum EscrowError {
    #[msg("Wrong participant or recipient")]
    Unauthorized,
    #[msg("Agreement commitment or version is invalid")]
    TermsMismatch,
    #[msg("Both participants must accept on chain")]
    NotAccepted,
    #[msg("Milestone is not in the required state")]
    WrongState,
    #[msg("Wrong milestone order or another escrow is active")]
    Sequence,
    #[msg("Deadline is invalid or expired")]
    Deadline,
    #[msg("Wrong token mint or decimals")]
    WrongMint,
    #[msg("Amount must be positive")]
    Amount,
    #[msg("Arithmetic overflow")]
    Overflow,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project() -> Project {
        Project {
            terms: ProjectTerms {
                id: [1; 16],
                version: 1,
                commitment: [2; 32],
                client: Pubkey::new_unique(),
                freelancer: Pubkey::new_unique(),
                mint: Pubkey::new_unique(),
                reviewer: Pubkey::new_unique(),
                backup_reviewer: Pubkey::new_unique(),
                review_seconds: 72 * 3600,
                backup_delay_seconds: 168 * 3600,
                milestones: vec![
                    MilestoneTerms {
                        amount: 250_000_000,
                        funding_deadline: 100,
                        delivery_deadline: 200,
                    },
                    MilestoneTerms {
                        amount: 250_000_000,
                        funding_deadline: 300,
                        delivery_deadline: 400,
                    },
                ],
            },
            client_accepted: true,
            freelancer_accepted: true,
            next: 0,
            active: false,
        }
    }
    #[test]
    fn requires_both_acceptances() {
        let mut p = project();
        p.freelancer_accepted = false;
        assert!(p.fundable(0, 99).is_err());
    }
    #[test]
    fn rejects_simultaneous_and_out_of_order_funding() {
        let mut p = project();
        assert!(p.fundable(1, 99).is_err());
        p.active = true;
        assert!(p.fundable(0, 99).is_err());
    }
    #[test]
    fn funding_boundary_is_exclusive() {
        let p = project();
        assert!(p.fundable(0, 99).is_ok());
        assert!(p.fundable(0, 100).is_err());
    }
    #[test]
    fn settled_sequence_advances_only_once() {
        let mut p = project();
        p.next = 1;
        assert!(p.fundable(0, 101).is_err());
        assert!(p.fundable(1, 101).is_ok());
        p.next = 2;
        assert!(p.fundable(2, 101).is_err());
    }
    #[test]
    fn rejects_bad_terms() {
        let mut p = project();
        assert!(p.terms.validate(0).is_ok());
        p.terms.milestones[0].amount = 0;
        assert!(p.terms.validate(0).is_err());
    }
    #[test]
    fn reviewers_cannot_be_participants() {
        let mut p = project();
        p.terms.reviewer = p.terms.client;
        assert!(p.terms.validate(0).is_err());
    }
}
