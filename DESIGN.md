# Claw Solana — Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Funder Wallet                         │
│  (Human's wallet that funds the Claw)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 1. Create vault + fund
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      ClawVault (PDA)                        │
│  - funder: Pubkey                                           │
│  - token_mint: Pubkey (USDC/SOL)                           │
│  - token_account: Pubkey (holds the funds)                 │
│  - max_amount: u64                                          │
│  - spent_amount: u64                                        │
│  - expiry: Option<i64>                                      │
│  - claw_nft_mint: Pubkey                                   │
│  - bump: u8                                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 2. Mint Claw NFT
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Claw NFT (Metaplex)                    │
│  - Standard NFT (transferable)                              │
│  - Metadata points to vault PDA                            │
│  - Holder = current spending authority                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 3. Transfer to agent
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Agent Wallet                          │
│  - Holds Claw NFT                                           │
│  - Can call spend() up to (max - spent)                    │
└─────────────────────────────────────────────────────────────┘

## Instructions

### 1. create_vault
Creates a new ClawVault PDA and associated token account.

**Accounts:**
- funder (signer, mut) - pays for creation
- vault (PDA, init)
- token_mint - USDC/SOL mint
- vault_token_account (init) - ATA for vault
- system_program, token_program, associated_token_program

**Args:**
- max_amount: u64
- expiry: Option<i64> (Unix timestamp)

**Seeds:** ["claw_vault", funder.key, token_mint.key, nonce]

### 2. fund_vault
Transfers tokens from funder to vault.

**Accounts:**
- funder (signer, mut)
- funder_token_account (mut)
- vault (mut)
- vault_token_account (mut)
- token_program

**Args:**
- amount: u64

### 3. mint_claw
Mints the Claw NFT representing spending authority.

**Accounts:**
- funder (signer, mut)
- vault (mut)
- claw_mint (init) - new NFT mint
- claw_metadata (init) - Metaplex metadata
- claw_token_account - where NFT goes initially
- recipient - who receives the Claw (agent)
- metaplex_program, token_program, system_program

**Behavior:**
- Can only be called once per vault
- NFT minted to recipient (agent)
- Metadata includes vault address for verification

### 4. spend
Agent spends from vault using their Claw.

**Accounts:**
- spender (signer) - must hold Claw NFT
- spender_claw_account - proves Claw ownership
- vault (mut)
- vault_token_account (mut)
- recipient_token_account (mut) - where funds go
- token_program

**Args:**
- amount: u64
- memo: Option<String> (for audit trail)

**Validation:**
- spender holds Claw NFT for this vault
- amount <= (max_amount - spent_amount)
- not expired (if expiry set)

### 5. burn_claw
Funder burns Claw and recovers unspent funds.

**Accounts:**
- funder (signer, mut)
- vault (mut)
- vault_token_account (mut)
- funder_token_account (mut)
- claw_mint (mut)
- claw_holder_account (mut) - whoever holds it
- token_program

**Behavior:**
- Burns the NFT
- Transfers remaining funds to funder
- Closes vault PDA

## Key Design Decisions

### Why PDA vault instead of delegate?
SPL Token delegates have a single delegate and can be changed. A vault PDA gives:
- Immutable spending rules (written to chain state)
- No risk of agent removing the delegation
- Clean separation of authority from custody

### Why NFT for authority?
- **Transferable** — Agent can move to new wallet
- **Visible** — Easy to check who has spending rights
- **Composable** — Other programs can gate on "holds Claw"
- **Tradeable** — Secondary market for unused authority

### Recovery mechanism
Funder can always recover funds by burning Claw. This is the "safety valve" that makes humans comfortable funding larger amounts.

## On-Chain Metadata

Claw NFT metadata (Metaplex):
```json
{
  "name": "Claw #1234",
  "symbol": "CLAW",
  "description": "Spending authority: 500 USDC",
  "image": "https://arweave.net/...",
  "attributes": [
    {"trait_type": "max_amount", "value": "500"},
    {"trait_type": "token", "value": "USDC"},
    {"trait_type": "vault", "value": "Abc123..."},
    {"trait_type": "funder", "value": "Xyz789..."}
  ]
}
```

## Security Considerations

1. **Vault PDA authority** — Only the program can move funds
2. **Claw verification** — spend() checks NFT ownership on-chain
3. **Expiry enforcement** — Expired Claws can't spend
4. **Burn permissions** — Only funder can burn (not agent)
5. **Amount tracking** — spent_amount updated atomically with transfer

## Integration Points

### For agents:
```rust
// Check remaining balance
remaining = vault.max_amount - vault.spent_amount

// Spend
claw_program.spend(amount, recipient, memo)
```

### For services (gating):
```rust
// Verify agent has valid Claw with sufficient balance
fn verify_claw(agent: Pubkey, required: u64) -> bool {
    // Check agent holds Claw NFT
    // Check vault has sufficient remaining
    // Check not expired
}
```

---

## TODO

- [ ] Set up Anchor project
- [ ] Implement create_vault
- [ ] Implement fund_vault  
- [ ] Implement mint_claw
- [ ] Implement spend
- [ ] Implement burn_claw
- [ ] Write tests
- [ ] Deploy to devnet
- [ ] Create skill.md for agents
