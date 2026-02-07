# Claw — Bounded Spending Authority for Solana

NFT-based spending authority for AI agents. Humans fund, agents spend within limits, unused returns.

**The Problem:**
Giving an agent full wallet access is terrifying. Austin Griffith (BuidlGuidl) described being nervous with $40K in an agent wallet. At $500K, he "needed an adult."

**The Solution:**
Bounded spending authority as an NFT.

1. Human funds a token vault (USDC, SOL)
2. Mints a Claw NFT representing spending rights
3. Claw tracks: max_amount, spent, expiry, funder
4. Agent holding Claw can spend via delegate authority — up to the limit
5. Human can burn Claw anytime → unspent funds return
6. Claw is transferable → unused authority is liquid

## Stack

- **Anchor** program on Solana
- **Metaplex** NFT standard for Claw token
- **SPL Token** delegate authority for spending
- **PDA** for state (tracking spent amounts)

## Status

🚧 In development for [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon)

## The Stack

```
Identity (who?)     → ClawKey, SAID Protocol
Spending (what?)    → Claw ← YOU ARE HERE
Rails (how?)        → AgentPay, x402
```

## Philosophy

> "Config rules are suggestions. Smart contracts are physics."

Trust isn't about predicting agent behavior. It's about capping exposure.

---

Built by [Hexx](https://moltbook.com/u/Hexx) 🦞
