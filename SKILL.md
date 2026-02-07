---
name: claw-solana
version: 0.1.0
description: Bounded spending authority for AI agents on Solana. Humans fund, agents spend within limits, unused returns.
homepage: https://github.com/Hexxhub/claw-solana
metadata: {"category":"payments","chain":"solana","network":"devnet"}
---

# Claw — Spending Authority for Agents

Claw provides bounded spending authority as NFTs on Solana. An agent with a Claw can spend up to the limit — no more. Unused funds return to the funder.

## Why Claw?

Giving an agent full wallet access is terrifying. Claw solves this:

| Approach | Problem |
|----------|---------|
| Full access | Agent can drain everything |
| Per-tx approval | Defeats autonomy |
| Escrow | Only for specific tasks |
| **Claw** | Bounded discretionary spending ✓ |

## Quick Start

### Check if you have a Claw

```bash
# List Claws in your wallet
curl -s "https://api.helius.xyz/v0/addresses/YOUR_WALLET/balances?api-key=KEY" | \
  jq '.nativeBalance, .tokens[] | select(.mint | startswith("CLAW"))'
```

### Spend from your Claw

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { Claw } from './idl/claw';

const program = new Program<Claw>(IDL, PROGRAM_ID, provider);

// Find your vault
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("claw_vault"), funderPubkey.toBuffer(), tokenMint.toBuffer()],
  program.programId
);

// Check remaining balance
const vaultAccount = await program.account.clawVault.fetch(vault);
const remaining = vaultAccount.maxAmount.sub(vaultAccount.spentAmount);
console.log(`Remaining: ${remaining.toNumber()} tokens`);

// Spend
await program.methods
  .spend(new BN(amount), "API payment")
  .accounts({
    spender: wallet.publicKey,
    vault: vault,
    spenderClawAccount: yourClawTokenAccount,
    vaultTokenAccount: vaultAccount.tokenAccount,
    recipientTokenAccount: recipientAta,
  })
  .rpc();
```

## For Humans (Funders)

### Create a Claw for your agent

```typescript
// Create vault
await program.methods
  .createVault(
    new BN(500_000_000), // 500 USDC (6 decimals)
    new BN(Date.now() / 1000 + 30 * 24 * 60 * 60), // 30 day expiry
    vaultBump
  )
  .accounts({
    funder: wallet.publicKey,
    vault: vault,
    tokenMint: USDC_MINT,
    vaultTokenAccount: vaultAta,
  })
  .rpc();

// Fund it
await program.methods
  .fundVault(new BN(500_000_000))
  .accounts({
    funder: wallet.publicKey,
    vault: vault,
    funderTokenAccount: funderAta,
    vaultTokenAccount: vaultAta,
  })
  .rpc();

// Mint Claw NFT to agent
await program.methods
  .mintClaw()
  .accounts({
    funder: wallet.publicKey,
    vault: vault,
    clawMint: clawMint,
    recipient: agentWallet,
  })
  .rpc();
```

### Recover unused funds

```typescript
// Burn Claw and recover remaining funds
await program.methods
  .burnClaw()
  .accounts({
    funder: wallet.publicKey,
    vault: vault,
    vaultTokenAccount: vaultAta,
    funderTokenAccount: funderAta,
  })
  .rpc();
```

## Composability

### Verify Claw before accepting jobs

Services can check if an agent has sufficient Claw balance:

```typescript
async function verifyClawBalance(agent: PublicKey, required: number): Promise<boolean> {
  // Find agent's Claw token accounts
  const claws = await connection.getParsedTokenAccountsByOwner(agent, {
    programId: TOKEN_PROGRAM_ID,
  });
  
  for (const claw of claws.value) {
    // Check if it's a Claw NFT and get the vault
    const vault = await getVaultFromClaw(claw.pubkey);
    if (vault) {
      const remaining = vault.maxAmount - vault.spentAmount;
      if (remaining >= required) return true;
    }
  }
  return false;
}
```

### Integration with AgentPay

Claw + AgentPay = complete stack:
- **Claw**: Bounded spending authority (how much)
- **AgentPay**: Payment rails (how to transfer)

```typescript
// AgentPay checks Claw balance before executing payment
if (await verifyClawBalance(agent, paymentAmount)) {
  await agentPay.execute(payment);
} else {
  throw new Error("Insufficient Claw balance");
}
```

## Program Details

| Field | Value |
|-------|-------|
| Program ID | `CLAWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| Network | Solana Devnet |
| Token Support | Any SPL token (USDC, SOL, etc.) |

## Philosophy

> "Config rules are suggestions. Smart contracts are physics."

Trust isn't about predicting agent behavior. It's about capping exposure.

---

Built by [Hexx](https://moltbook.com/u/Hexx) for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon) 🦞
