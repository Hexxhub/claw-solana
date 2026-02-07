import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMint,
  MINT_SIZE,
} from "@solana/spl-token";
import { expect } from "chai";
// Type will be inferred from workspace

describe("claw", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Claw as Program;
  const funder = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  let tokenMint: PublicKey;
  let funderTokenAccount: PublicKey;
  let vaultPda: PublicKey;
  let vaultBump: number;
  let vaultTokenAccount: PublicKey;
  let clawMint: Keypair;
  let agentKeypair: Keypair;
  let agentClawTokenAccount: PublicKey;
  let recipientKeypair: Keypair;
  let recipientTokenAccount: PublicKey;

  const MAX_AMOUNT = new BN(1_000_000); // 1M tokens
  const FUND_AMOUNT = new BN(500_000);
  const EXPIRY_FUTURE = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now
  const EXPIRY_PAST = new BN(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago

  before(async () => {
    // Create token mint
    tokenMint = await createMint(
      connection,
      funder.payer,
      funder.publicKey,
      null,
      6
    );

    // Create funder's token account and mint tokens
    const funderAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funder.payer,
      tokenMint,
      funder.publicKey
    );
    funderTokenAccount = funderAta.address;

    await mintTo(
      connection,
      funder.payer,
      tokenMint,
      funderTokenAccount,
      funder.payer,
      2_000_000
    );

    // Derive vault PDA
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("claw_vault"),
        funder.publicKey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      program.programId
    );

    // Derive vault's associated token account
    vaultTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      vaultPda,
      true // allowOwnerOffCurve for PDA
    );

    // Setup agent keypair
    agentKeypair = Keypair.generate();

    // Setup recipient
    recipientKeypair = Keypair.generate();

    // Airdrop SOL to agent for tx fees
    const sig = await connection.requestAirdrop(
      agentKeypair.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig);
  });

  it("1. Creates a vault with max amount and expiry", async () => {
    const tx = await program.methods
      .createVault(MAX_AMOUNT, EXPIRY_FUTURE, vaultBump)
      .accounts({
        funder: funder.publicKey,
        vault: vaultPda,
        tokenMint: tokenMint,
        vaultTokenAccount: vaultTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vault = await program.account.clawVault.fetch(vaultPda);
    expect(vault.funder.toBase58()).to.equal(funder.publicKey.toBase58());
    expect(vault.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(vault.maxAmount.toNumber()).to.equal(MAX_AMOUNT.toNumber());
    expect(vault.spentAmount.toNumber()).to.equal(0);
    expect(vault.expiry.toNumber()).to.equal(EXPIRY_FUTURE.toNumber());
    expect(vault.isActive).to.be.true;
    expect(vault.bump).to.equal(vaultBump);
  });

  it("2. Funds the vault with tokens", async () => {
    const tx = await program.methods
      .fundVault(FUND_AMOUNT)
      .accounts({
        funder: funder.publicKey,
        vault: vaultPda,
        funderTokenAccount: funderTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vaultAccount = await getAccount(connection, vaultTokenAccount);
    expect(Number(vaultAccount.amount)).to.equal(FUND_AMOUNT.toNumber());
  });

  it("3. Mints a Claw NFT for the vault", async () => {
    // Create a mint for the Claw NFT
    clawMint = Keypair.generate();
    const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

    const createMintTx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: funder.publicKey,
        newAccountPubkey: clawMint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        clawMint.publicKey,
        0,
        funder.publicKey,
        null
      )
    );
    await provider.sendAndConfirm(createMintTx, [clawMint]);

    // Mint 1 NFT to the agent
    agentClawTokenAccount = await getAssociatedTokenAddress(
      clawMint.publicKey,
      agentKeypair.publicKey
    );

    const mintNftTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        funder.publicKey,
        agentClawTokenAccount,
        agentKeypair.publicKey,
        clawMint.publicKey
      ),
      createMintToInstruction(
        clawMint.publicKey,
        agentClawTokenAccount,
        funder.publicKey,
        1
      )
    );
    await provider.sendAndConfirm(mintNftTx);

    // Now call mint_claw to register it in the vault
    const tx = await program.methods
      .mintClaw()
      .accounts({
        funder: funder.publicKey,
        vault: vaultPda,
        clawMint: clawMint.publicKey,
        recipient: agentKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vault = await program.account.clawVault.fetch(vaultPda);
    expect(vault.clawNftMint.toBase58()).to.equal(clawMint.publicKey.toBase58());
  });

  it("4. Spends from vault (verify amount tracking)", async () => {
    const spendAmount = new BN(100_000);

    // Create recipient token account
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funder.payer,
      tokenMint,
      recipientKeypair.publicKey
    );
    recipientTokenAccount = recipientAta.address;

    const tx = await program.methods
      .spend(spendAmount, "test payment")
      .accounts({
        spender: agentKeypair.publicKey,
        vault: vaultPda,
        spenderClawAccount: agentClawTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agentKeypair])
      .rpc();

    const vault = await program.account.clawVault.fetch(vaultPda);
    expect(vault.spentAmount.toNumber()).to.equal(spendAmount.toNumber());

    const recipientAccount = await getAccount(connection, recipientTokenAccount);
    expect(Number(recipientAccount.amount)).to.equal(spendAmount.toNumber());
  });

  it("5. Spend exceeding limit should fail", async () => {
    // Try to spend more than remaining (max 1M, spent 100K, remaining 900K, but vault only has 400K tokens)
    // Let's try to exceed the max_amount limit
    const excessAmount = new BN(950_000); // more than remaining 900K limit

    try {
      await program.methods
        .spend(excessAmount, null)
        .accounts({
          spender: agentKeypair.publicKey,
          vault: vaultPda,
          spenderClawAccount: agentClawTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          recipientTokenAccount: recipientTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agentKeypair])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.contain("ExceedsLimit");
    }
  });

  it("6. Spend after expiry should fail", async () => {
    // We need a vault with a past expiry. Since we can only create one vault per (funder, mint),
    // we'll create a new mint and vault with past expiry.
    const expiredMint = await createMint(
      connection,
      funder.payer,
      funder.publicKey,
      null,
      6
    );

    const [expiredVaultPda, expiredVaultBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("claw_vault"),
        funder.publicKey.toBuffer(),
        expiredMint.toBuffer(),
      ],
      program.programId
    );

    const expiredVaultTokenAccount = await getAssociatedTokenAddress(
      expiredMint,
      expiredVaultPda,
      true
    );

    // Create vault with past expiry
    await program.methods
      .createVault(MAX_AMOUNT, EXPIRY_PAST, expiredVaultBump)
      .accounts({
        funder: funder.publicKey,
        vault: expiredVaultPda,
        tokenMint: expiredMint,
        vaultTokenAccount: expiredVaultTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Fund it
    const funderExpiredAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funder.payer,
      expiredMint,
      funder.publicKey
    );
    await mintTo(connection, funder.payer, expiredMint, funderExpiredAta.address, funder.payer, 1_000_000);

    await program.methods
      .fundVault(FUND_AMOUNT)
      .accounts({
        funder: funder.publicKey,
        vault: expiredVaultPda,
        funderTokenAccount: funderExpiredAta.address,
        vaultTokenAccount: expiredVaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Create claw NFT for expired vault
    const expiredClawMint = Keypair.generate();
    const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const createMintTx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: funder.publicKey,
        newAccountPubkey: expiredClawMint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(expiredClawMint.publicKey, 0, funder.publicKey, null)
    );
    await provider.sendAndConfirm(createMintTx, [expiredClawMint]);

    const agentExpiredClawAta = await getAssociatedTokenAddress(
      expiredClawMint.publicKey,
      agentKeypair.publicKey
    );
    const mintNftTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(funder.publicKey, agentExpiredClawAta, agentKeypair.publicKey, expiredClawMint.publicKey),
      createMintToInstruction(expiredClawMint.publicKey, agentExpiredClawAta, funder.publicKey, 1)
    );
    await provider.sendAndConfirm(mintNftTx);

    await program.methods
      .mintClaw()
      .accounts({
        funder: funder.publicKey,
        vault: expiredVaultPda,
        clawMint: expiredClawMint.publicKey,
        recipient: agentKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Create recipient ATA for expired mint
    const recipientExpiredAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funder.payer,
      expiredMint,
      recipientKeypair.publicKey
    );

    // Try to spend - should fail due to expiry
    try {
      await program.methods
        .spend(new BN(1000), null)
        .accounts({
          spender: agentKeypair.publicKey,
          vault: expiredVaultPda,
          spenderClawAccount: agentExpiredClawAta,
          vaultTokenAccount: expiredVaultTokenAccount,
          recipientTokenAccount: recipientExpiredAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agentKeypair])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.contain("ClawExpired");
    }
  });

  it("7. Burns claw and recovers funds (funder only)", async () => {
    const funderBalanceBefore = await getAccount(connection, funderTokenAccount);
    const vaultBalanceBefore = await getAccount(connection, vaultTokenAccount);

    await program.methods
      .burnClaw()
      .accounts({
        funder: funder.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultTokenAccount,
        funderTokenAccount: funderTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vault = await program.account.clawVault.fetch(vaultPda);
    expect(vault.isActive).to.be.false;

    const funderBalanceAfter = await getAccount(connection, funderTokenAccount);
    expect(Number(funderBalanceAfter.amount)).to.equal(
      Number(funderBalanceBefore.amount) + Number(vaultBalanceBefore.amount)
    );

    const vaultBalanceAfter = await getAccount(connection, vaultTokenAccount);
    expect(Number(vaultBalanceAfter.amount)).to.equal(0);
  });

  it("8. Non-funder trying to burn should fail", async () => {
    // Create a fresh vault for this test
    const freshMint = await createMint(connection, funder.payer, funder.publicKey, null, 6);
    const [freshVaultPda, freshVaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("claw_vault"), funder.publicKey.toBuffer(), freshMint.toBuffer()],
      program.programId
    );
    const freshVaultTokenAccount = await getAssociatedTokenAddress(freshMint, freshVaultPda, true);

    await program.methods
      .createVault(MAX_AMOUNT, null, freshVaultBump)
      .accounts({
        funder: funder.publicKey,
        vault: freshVaultPda,
        tokenMint: freshMint,
        vaultTokenAccount: freshVaultTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Agent (non-funder) tries to burn
    // The constraint check is on-chain: vault.funder == funder.key()
    // We need the agent's ATA for fresh mint as funder_token_account
    const agentFreshAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funder.payer, // payer
      freshMint,
      agentKeypair.publicKey
    );

    try {
      await program.methods
        .burnClaw()
        .accounts({
          funder: agentKeypair.publicKey,
          vault: freshVaultPda,
          vaultTokenAccount: freshVaultTokenAccount,
          funderTokenAccount: agentFreshAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agentKeypair])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // Could be constraint error or NotFunder
      expect(err.toString()).to.match(/NotFunder|ConstraintHasOne|Constraint|2012|6006/);
    }
  });
});
