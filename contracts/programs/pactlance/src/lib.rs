use anchor_lang::prelude::*;

// Local scaffold ID only. Generate a deployment keypair and run `anchor keys sync`
// before local-validator/devnet deployment. Never commit that keypair.
declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZq7FEfcYkgMQhgqJM6dS9");

#[program]
pub mod pactlance {
    use super::*;
    /// Connectivity smoke instruction only. Does not create escrow or move funds.
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("Pactlance phase 2 foundation; payments unavailable");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub caller: Signer<'info>,
}

/// Shared arithmetic building block for later settlement instructions.
/// No instruction currently exposes it or permits token transfers.
pub fn validate_allocation(funded: u64, client: u64, freelancer: u64) -> Result<()> {
    require!(funded > 0, FoundationError::InvalidAllocation);
    require!(
        client.checked_add(freelancer) == Some(funded),
        FoundationError::InvalidAllocation
    );
    Ok(())
}

#[error_code]
pub enum FoundationError {
    #[msg("Settlement allocation must equal the positive funded amount")]
    InvalidAllocation,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_full_refund_payout_and_split() {
        assert!(validate_allocation(250, 250, 0).is_ok());
        assert!(validate_allocation(250, 0, 250).is_ok());
        assert!(validate_allocation(250, 100, 150).is_ok());
    }
    #[test]
    fn rejects_overflow_and_unbalanced_allocations() {
        assert!(validate_allocation(u64::MAX, u64::MAX, 1).is_err());
        assert!(validate_allocation(250, 100, 151).is_err());
        assert!(validate_allocation(250, 100, 149).is_err());
        assert!(validate_allocation(0, 0, 0).is_err());
    }
}
